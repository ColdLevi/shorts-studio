#!/usr/bin/env python3
"""sound_finder.py - find commercial-safe sound effects and background music.

Uses the Openverse API (no key needed). Keeps only sounds whose licence is
CC0, public domain or CC BY (commercial use AND edits allowed). Downloads a
few candidates per search, measures each with ffmpeg, rejects bad files, and
writes a review sheet so a human can pick by ear.

Usage:
    python3 tools/sound_finder.py --kind both --per-query 3 --out sounds
    python3 tools/sound_finder.py --kind sfx --query "rain on window" --out sounds

Needs: Python 3 and ffmpeg. No pip packages.
Writes: OUT/sfx/*, OUT/music/*, OUT/manifest.jsonl, OUT/REVIEW.md, OUT/CREDITS.md
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.openverse.org/v1/audio/"
UA = "shorts-studio-sound-finder/1.0"
OK_LICENSES = {"cc0", "pdm", "by"}          # commercial + edits allowed
SFX_LEN = (0.3, 8.0)                        # seconds
MUSIC_LEN = (60.0, 400.0)
MAX_BYTES = {"sfx": 3_000_000, "music": 9_000_000}

SFX_QUERIES = ["whoosh", "swoosh transition", "ui click", "notification chime",
               "error buzzer", "success ding", "impact hit", "riser",
               "keyboard typing", "camera shutter", "glitch", "pop"]
MUSIC_QUERIES = ["ambient technology", "calm electronic", "uplifting corporate",
                 "lofi chill", "cinematic tension", "inspiring piano"]


class RateLimited(Exception):
    pass


def http_get(url, binary=False, limit=None, tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if limit is not None:
                    data = r.read(limit + 1)
                    if len(data) > limit:
                        return None
                else:
                    data = r.read()
                return data if binary else data.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RateLimited(e.headers.get("Retry-After", "unknown"))
            last = e
            if e.code < 500:
                break
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"download failed: {last}")


def search(q, category, page_size=20):
    params = {"q": q, "category": category, "page_size": page_size,
              "license_type": "commercial,modification"}
    url = API + "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url)).get("results", [])


def lic_code(item):
    return (item.get("license") or "").lower()


def usable(item, kind):
    if lic_code(item) not in OK_LICENSES or not item.get("url"):
        return False
    dur = (item.get("duration") or 0) / 1000.0
    lo, hi = SFX_LEN if kind == "sfx" else MUSIC_LEN
    if item.get("duration") is None:
        return kind == "sfx"          # unknown length is risky for music
    return lo <= dur <= hi


def rank(item):
    order = {"cc0": 0, "pdm": 0, "by": 1}
    return order.get(lic_code(item), 9)


def ext_of(item):
    ft = (item.get("filetype") or "").lower().strip(".")
    if ft in ("mp3", "wav", "ogg", "flac", "m4a", "oga"):
        return ft
    m = re.search(r"\.([a-z0-9]{2,4})(?:\?|$)", item["url"].lower())
    return m.group(1) if m else "mp3"


def measure(path):
    """Decoded length, sample peak, mean level, silence share, loudness."""
    d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        dur = float(d.stdout.strip())
    except ValueError:
        return None
    v = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
                        "-af", "volumedetect,silencedetect=n=-45dB:d=0.3,ebur128=peak=true",
                        "-vn", "-f", "null", "-"], capture_output=True, text=True).stderr

    def grab(pat):
        m = re.findall(pat, v)
        return float(m[-1]) if m else None
    sil = sum(float(x) for x in re.findall(r"silence_duration: ([\d.]+)", v))
    return {"duration_s": round(dur, 2),
            "max_db": grab(r"max_volume: (-?[\d.]+) dB"),
            "mean_db": grab(r"mean_volume: (-?[\d.]+) dB"),
            "lufs": grab(r"I:\s+(-?[\d.]+) LUFS"),
            "silence_share": round(min(1.0, sil / dur), 3) if dur > 0 else 1.0}


def judge(m, kind):
    """Return list of reasons to reject (empty = keep)."""
    if not m:
        return ["could not decode"]
    r = []
    if m["max_db"] is None or m["max_db"] < -30:
        r.append("too quiet")
    if kind == "music" and m["silence_share"] > 0.25:
        r.append("too much silence")
    if kind == "sfx" and m["silence_share"] > 0.7:
        r.append("mostly silence")
    return r


def load_manifest(path):
    seen = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            try:
                j = json.loads(line)
                seen[j["id"]] = j
            except Exception:
                pass
    return seen


def find(kind, queries, per_query, out, manifest):
    category = "sound_effect" if kind == "sfx" else "music"
    folder = os.path.join(out, kind)
    os.makedirs(folder, exist_ok=True)
    kept = []
    for q in queries:
        try:
            items = search(q, category)
        except RateLimited as e:
            print(f"RATE LIMITED by Openverse (retry after {e}). Stopping; partial results kept.")
            return kept, True
        except Exception as e:
            print(f"search failed for '{q}': {e}")
            continue
        cands = sorted([i for i in items if usable(i, kind)], key=rank)
        print(f"[{kind}] '{q}': {len(items)} results, {len(cands)} usable", flush=True)
        got = 0
        for it in cands:
            if got >= per_query:
                break
            if it["id"] in manifest:
                continue
            path = os.path.join(folder, f"{it['id']}.{ext_of(it)}")
            try:
                data = http_get(it["url"], binary=True, limit=MAX_BYTES[kind])
            except RateLimited:
                print("RATE LIMITED while downloading; stopping.")
                return kept, True
            except Exception as e:
                print(f"  skip {it['id']}: {e}")
                continue
            if data is None:
                print(f"  skip {it['id']}: file over size limit")
                continue
            with open(path, "wb") as f:
                f.write(data)
            m = measure(path)
            why = judge(m, kind)
            if why:
                os.remove(path)
                print(f"  reject {it['id']}: {', '.join(why)}")
                continue
            rec = {"id": it["id"], "kind": kind, "query": q, "file": path,
                   "title": it.get("title"), "creator": it.get("creator"),
                   "license": lic_code(it), "license_version": it.get("license_version"),
                   "license_url": it.get("license_url"),
                   "attribution": it.get("attribution"),
                   "source": it.get("source") or it.get("provider"),
                   "page": it.get("foreign_landing_url"), "measure": m}
            manifest[it["id"]] = rec
            kept.append(rec)
            got += 1
            print(f"  kept {it['id']}: {rec['title']} [{rec['license']}] {m['duration_s']}s", flush=True)
        time.sleep(1.0)
    return kept, False


def write_outputs(out, manifest):
    with open(os.path.join(out, "manifest.jsonl"), "w", encoding="utf-8") as f:
        for rec in manifest.values():
            f.write(json.dumps(rec) + "\n")
    L = ["# Review sheet\n", "Listen, then keep or delete. Hot = sample peak at or above -1 dB.\n"]
    for kind in ("sfx", "music"):
        rows = [r for r in manifest.values() if r["kind"] == kind]
        if not rows:
            continue
        L.append(f"\n## {kind} ({len(rows)})\n")
        L.append("| file | search | title | license | sec | peak dB | LUFS | page |")
        L.append("|---|---|---|---|---|---|---|---|")
        for r in rows:
            m = r["measure"]
            hot = " HOT" if (m["max_db"] is not None and m["max_db"] >= -1) else ""
            L.append(f"| {os.path.basename(r['file'])} | {r['query']} | {(r['title'] or '')[:40]} | "
                     f"{r['license']} | {m['duration_s']} | {m['max_db']}{hot} | {m['lufs']} | "
                     f"{r['page'] or ''} |")
    open(os.path.join(out, "REVIEW.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    C = ["# Credits\n", "Every kept sound, with its licence. CC BY sounds MUST be credited "
         "in the video description. CC0 and public domain need no credit.\n"]
    for r in manifest.values():
        need = "CREDIT REQUIRED" if r["license"] == "by" else "no credit needed"
        C.append(f"- {os.path.basename(r['file'])}: {r['title']} by {r['creator']} "
                 f"({r['license'].upper()} {r['license_version'] or ''}, {need}). "
                 f"{r['attribution'] or ''} {r['page'] or ''}")
    open(os.path.join(out, "CREDITS.md"), "w", encoding="utf-8").write("\n".join(C) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--kind", choices=["sfx", "music", "both"], default="both")
    ap.add_argument("--per-query", type=int, default=3)
    ap.add_argument("--out", default="sounds")
    ap.add_argument("--query", help="one custom search instead of the built-in list")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    manifest = load_manifest(os.path.join(a.out, "manifest.jsonl"))
    kinds = ["sfx", "music"] if a.kind == "both" else [a.kind]
    stopped = False
    for kind in kinds:
        qs = [a.query] if a.query else (SFX_QUERIES if kind == "sfx" else MUSIC_QUERIES)
        pq = a.per_query if kind == "sfx" else max(1, a.per_query - 2)
        _, stopped = find(kind, qs, pq, a.out, manifest)
        if stopped:
            break
    write_outputs(a.out, manifest)
    print(f"\nTotal kept: {len(manifest)}. See {a.out}/REVIEW.md and CREDITS.md")
    if stopped:
        print("Run again later to continue; already-kept sounds are skipped.")


if __name__ == "__main__":
    main()
