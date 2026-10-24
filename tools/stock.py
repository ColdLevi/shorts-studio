"""Real stock footage for Shorts Studio, from Pixabay and Pexels (free), checked by a vision judge.

Written for this project. The idea (stock sources, clip cache, trim to the beat)
follows OpenMontage's stock tools: https://github.com/calesthio/OpenMontage (AGPL-3.0).
Pixabay Content License: free to use in videos, credit appreciated, no reselling clips as stock.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

API = "https://pixabay.com/api/videos/"
CACHE = os.path.join(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir(), "stock-cache")
USED = set()


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "shorts-studio/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return float((r.stdout or "0").strip().split("\n")[0])
    except ValueError:
        return 0.0


def search(query, key):
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, "q_" + hashlib.sha1(query.lower().encode()).hexdigest()[:16] + ".json")
    if os.path.exists(cpath):
        try:
            return json.load(open(cpath))
        except Exception:
            pass
    qs = urllib.parse.urlencode({"key": key, "q": query[:100], "video_type": "film",
                                 "safesearch": "true", "per_page": 20, "order": "popular"})
    data = json.loads(_get(API + "?" + qs).decode("utf-8"))
    hits = data.get("hits") or []
    json.dump(hits, open(cpath, "w"))
    return hits


def _size(v):
    return int(v.get("size") or 0) or 10 ** 9


def _rendition(hit):
    vids = [v for v in (hit.get("videos") or {}).values() if isinstance(v, dict) and v.get("url")]
    ok = [v for v in vids if int(v.get("width") or 0) >= 1280 and _size(v) <= 60_000_000]
    if ok:
        return min(ok, key=_size)
    return max(vids, key=lambda v: int(v.get("width") or 0)) if vids else None


PEXELS = "https://api.pexels.com/videos/search"


def search_pexels(query, key, portrait):
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, "px_" + hashlib.sha1((query.lower() + str(portrait)).encode()).hexdigest()[:16] + ".json")
    if os.path.exists(cpath):
        try:
            return json.load(open(cpath))
        except Exception:
            pass
    qs = urllib.parse.urlencode({"query": query[:100], "per_page": 15, "orientation": "portrait" if portrait else "landscape", "size": "medium"})
    req = urllib.request.Request(PEXELS + "?" + qs, headers={"Authorization": key, "User-Agent": "shorts-studio/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        vids = json.loads(r.read().decode("utf-8")).get("videos") or []
    hits = []
    for v in vids:
        files = [f for f in (v.get("video_files") or []) if f.get("link") and (f.get("file_type") or "").endswith("mp4")]
        ok = [f for f in files if int(f.get("width") or 0) >= 1080 or int(f.get("height") or 0) >= 1080] or files
        if not ok:
            continue
        f = min(ok, key=lambda f: int(f.get("width") or 0) * int(f.get("height") or 0))
        hits.append({"id": "px%s" % v.get("id"), "duration": v.get("duration") or 0, "src": "Pexels",
                     "r": {"url": f["link"], "width": f.get("width"), "height": f.get("height")}})
    json.dump(hits, open(cpath, "w"))
    return hits


def _frames(clip, n=3):
    """n small JPEGs spread across the clip (start, middle, end) for the judge."""
    dur = _probe(clip) or 1.0
    out = []
    for k in range(n):
        t = max(0.2, min(dur - 0.2, dur * (k + 0.5) / n))
        jpg = "%s.%d.jpg" % (clip, k)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "%.2f" % t, "-i", clip, "-frames:v", "1", "-vf", "scale=448:-2", jpg],
                       check=True, capture_output=True)
        out.append(jpg)
    return out


def _judge(clip, query, narration=""):
    """Gemini looks at 3 frames and scores 0-10 whether the clip SHOWS what the narration is about.
    Returns (score, best_frame_index) or (None, 0) when no judge is available."""
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        return None, 0
    try:
        import base64
        import re as _re
        parts = [{"text": (
            "You check stock footage for a narrated video. The narrator says: \"%s\". The clip was searched for: \"%s\".\n"
            "Here are 3 frames (start, middle, end). Score 0-10 how well the clip SHOWS that subject as its main, clearly visible subject.\n"
            "9-10: exactly that subject, clearly. 6-7: right subject but weak. 3-5: related scene but the subject is not the focus "
            "(for example hands, faces or people when the line is about an object). 0-2: unrelated.\n"
            "Penalise visible text, logos, watermarks, and close-ups of hands or faces unless the narration is about them.\n"
            'Reply JSON only: {"score": n, "best": index of the best frame 0-2, "sees": "4-8 words of what is actually shown"}'
        ) % ((narration or query)[:300], query[:80])}]
        for jpg in _frames(clip):
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(open(jpg, "rb").read()).decode()}})
        body = json.dumps({"contents": [{"parts": parts}], "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}}).encode()
        for m in (os.environ.get("GEMINI_JUDGE_MODEL") or "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"):
            try:
                req = urllib.request.Request(
                    "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % m,
                    data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key})
                d = json.loads(urllib.request.urlopen(req, timeout=40).read().decode())
                t = d["candidates"][0]["content"]["parts"][0]["text"]
                try:
                    j = json.loads(t)
                    print("  judge %s: %s (%s)" % (query, j.get("score"), j.get("sees")))
                    return float(j.get("score")), int(j.get("best") or 0)
                except Exception:
                    return float(_re.search(r"\d+(\.\d+)?", t).group()), 0
            except Exception:
                continue
    except Exception as e:
        print("  judge error", e)
    return None, 0


def _candidates(query, W, H, beat_len):
    portrait = H > W
    out = []
    pb = (os.environ.get("PIXABAY_API_KEY") or "").strip()
    px = (os.environ.get("PEXELS_API_KEY") or "").strip()
    if not pb and not px:
        raise RuntimeError("PIXABAY_API_KEY (or PEXELS_API_KEY) is not set")
    lists = []
    if pb:
        try:
            lists.append([{"id": h.get("id"), "duration": h.get("duration"), "src": "Pixabay", "r": _rendition(h)} for h in search(query, pb)])
        except Exception as e:
            print("  pixabay", e)
    if px:
        try:
            lists.append(search_pexels(query, px, portrait))
        except Exception as e:
            print("  pexels", e)
    # interleave the sources so both get a chance in the top picks
    for k in range(max([len(l) for l in lists] or [0])):
        for l in lists:
            if k < len(l):
                out.append((k, l[k]))
    ranked = []
    for rank, h in out:
        r, dur = h.get("r"), float(h.get("duration") or 0)
        if not r or dur < 1.5 or dur < beat_len * 0.6 or h.get("id") in USED:
            continue
        match = (int(r.get("height") or 0) > int(r.get("width") or 0)) == portrait
        ranked.append((not match, rank, h))
    ranked.sort(key=lambda t: t[:2])
    return [h for _, _, h in ranked]


def fetch(query, dest, beat_len, W, H, narration="", tries=None):
    """Find the clip that really shows the beat: up to `tries` candidates from Pixabay/Pexels are cut to the beat
    and judged by Gemini on 3 frames; the best one scoring >= STOCK_MIN_SCORE (default 7) wins.
    Returns (duration, credit). Raises when nothing is good enough, so the caller keeps the picture instead."""
    query = (query or "").strip()
    if not query:
        raise RuntimeError("no search query")
    W, H = W - W % 2, H - H % 2
    tries = tries or int(os.environ.get("STOCK_TRIES") or 5)
    need = float(os.environ.get("STOCK_MIN_SCORE") or 7)
    cands = _candidates(query, W, H, beat_len)
    if not cands:
        raise RuntimeError("no usable stock clip for '%s'" % query)
    best, last = None, None
    vf = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=30,format=yuv420p" % (W, H, W, H)
    for n, hit in enumerate(cands[:tries]):
        try:
            os.makedirs(CACHE, exist_ok=True)
            src = os.path.join(CACHE, "%s_%s.mp4" % (hit["src"][:2].lower(), hit["id"]))
            if not os.path.exists(src):
                tmp = src + ".part"
                with open(tmp, "wb") as f:
                    f.write(_get(hit["r"]["url"], timeout=90))
                os.replace(tmp, src)
            dur = _probe(src)
            if dur < 1.0:
                raise RuntimeError("unreadable clip")
            cand = "%s.cand%d.mp4" % (dest, n)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", vf + ",scale=480:-2", "-an", "-t", "%.2f" % min(dur, 30),
                            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", cand], check=True, capture_output=True)
            score, bi = _judge(cand, query, narration)
            if score is None:  # no judge: take the first usable clip, as before
                score, bi = 6.5, 0
                need = min(need, 6.5)
            if best is None or score > best[0]:
                best = (score, bi, hit, src, dur)
            if score >= 8.5:
                break
        except Exception as e:
            last = e
    if not best or best[0] < need:
        raise RuntimeError("no clip really shows '%s' (best score %s)%s" % (query, best[0] if best else "-", (": %s" % str(last)[:80]) if last and not best else ""))
    score, bi, hit, src, dur = best
    want = min(dur, beat_len + 0.3)
    # start the cut around the frame the judge liked best
    start = max(0.0, min(dur - want, dur * (bi + 0.5) / 3 - want / 2))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "%.2f" % start, "-i", src, "-t", "%.2f" % want, "-vf", vf,
                    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", dest], check=True, capture_output=True)
    USED.add(hit.get("id"))
    return _probe(dest), hit["src"]


if __name__ == "__main__":
    q, ln, w, h = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    out = os.path.join(tempfile.gettempdir(), "stock_test.mp4")
    d, c = fetch(q, out, ln, w, h)
    print("ok", round(d, 2), c, out)
