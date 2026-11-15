#!/usr/bin/env python3
"""Fetch instrumental, commercial-safe tracks from Jamendo into the music library.
  python3 tools/fetch_jamendo.py [--dry-run]
Env: JAMENDO_CLIENT_ID. Keeps only CC-BY and CC0. Credits go to catalog.json."""
import os, sys, json, re, subprocess, urllib.request, urllib.parse
ROOT = os.path.join("media", "library", "music")
CLIPS = os.path.join(ROOT, "clips")
CAT = os.path.join(ROOT, "catalog.json")
DRY = "--dry-run" in sys.argv
SLOTS = {
    "cinematic": ("cinematic,epic,dramatic", "story", 2),
    "ambient": ("ambient,calm,atmospheric", "mood", 2),
    "lofi": ("lofi,chillhop,relaxing", "explainer", 2),
    "tech": ("electronic,technology,corporate", "explainer", 2),
    "upbeat": ("upbeat,energetic,happy", "promo", 2),
}


def lic_ok(u):
    u = u or ""
    return bool(re.search(r"/licenses/by/\d", u) or "publicdomain" in u or "/zero/" in u)


def api(cid, tags):
    q = urllib.parse.urlencode({"client_id": cid, "format": "json", "limit": 40,
                                "fuzzytags": tags, "vocalinstrumental": "instrumental",
                                "audioformat": "mp32", "order": "popularity_total"})
    req = urllib.request.Request("https://api.jamendo.com/v3.0/tracks/?" + q, headers={"User-Agent": "shorts-studio"})
    return json.load(urllib.request.urlopen(req, timeout=30)).get("results") or []


def main():
    cid = os.environ.get("JAMENDO_CLIENT_ID", "").strip()
    if not cid:
        print("fetch_jamendo: JAMENDO_CLIENT_ID missing, stopped"); return
    cat = json.load(open(CAT)) if os.path.exists(CAT) else {"clips": []}
    clips = cat.setdefault("clips", [])
    used = {str(c.get("jamendo_id")) for c in clips if c.get("jamendo_id")}
    os.makedirs(CLIPS, exist_ok=True)
    got = 0
    for slot, (tags, category, count) in SLOTS.items():
        try:
            cands = api(cid, tags)
        except Exception as e:
            print("%s: API failed (%s)" % (slot, str(e)[:100])); continue
        ok = [t for t in cands if lic_ok(t.get("license_ccurl")) and t.get("audio") and int(float(t.get("duration") or 0)) >= 60 and str(t.get("id")) not in used]
        print("%s: %d results, %d usable" % (slot, len(cands), len(ok)))
        for n in range(1, count + 1):
            cid2 = "jam-%s-%d" % (slot, n)
            out = os.path.join(CLIPS, cid2 + ".mp3")
            if os.path.exists(out):
                continue
            if not ok:
                print("  %s: no candidate left" % cid2); break
            t = ok.pop(0)
            used.add(str(t["id"]))
            dur = min(100, int(float(t["duration"])))
            print("  %s <- %s by %s | %s" % (cid2, t.get("name"), t.get("artist_name"), t.get("license_ccurl")))
            if DRY:
                continue
            tmp = "/tmp/" + cid2 + ".src.mp3"
            try:
                req = urllib.request.Request(t["audio"], headers={"User-Agent": "shorts-studio"})
                open(tmp, "wb").write(urllib.request.urlopen(req, timeout=90).read())
                r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-t", str(dur),
                                    "-af", "afade=t=out:st=%d:d=4,loudnorm=I=-20:TP=-1.5:LRA=11" % (dur - 4),
                                    "-ac", "2", "-b:a", "128k", out])
                if r.returncode != 0 or not os.path.exists(out):
                    print("  %s: ffmpeg failed, skipped" % cid2); continue
            except Exception as e:
                print("  %s: download failed (%s)" % (cid2, str(e)[:100])); continue
            clips[:] = [c for c in clips if c.get("id") != cid2]
            clips.append({"id": cid2, "file": "clips/%s.mp3" % cid2, "category": category,
                          "tags": tags.split(",") + ["jamendo", "bed"], "duration": dur,
                          "source": "jamendo", "jamendo_id": str(t["id"]), "title": t.get("name"),
                          "artist": t.get("artist_name"), "license_url": t.get("license_ccurl"),
                          "share_url": t.get("shareurl")})
            got += 1
    if not DRY and got:
        json.dump(cat, open(CAT, "w"), indent=2, ensure_ascii=False)
    print("fetch_jamendo: %d new tracks%s" % (got, " (dry run, nothing written)" if DRY else ""))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("fetch_jamendo: skipped (%s)" % str(e)[:150])
