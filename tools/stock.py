"""Real stock footage for Shorts Studio, from Pixabay (free).

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


def _judge(clip, query):
    """Score 0-10 how well a frame of the clip shows the query (Gemini). None = judge unavailable."""
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        return None
    try:
        import base64
        import re as _re
        jpg = clip + ".jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", clip, "-frames:v", "1",
                        "-vf", "scale=480:-2", jpg], check=True, capture_output=True)
        b64 = base64.b64encode(open(jpg, "rb").read()).decode()
        ask = ('Score 0-10 how well this video frame shows: "%s". Ignore style words like cinematic. '
               '9-10 = clearly exactly that, 5-6 = loosely related, 0-2 = unrelated. Reply with only the number.' % query)
        body = json.dumps({"contents": [{"parts": [{"text": ask}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]}],
                           "generationConfig": {"temperature": 0}}).encode()
        for m in ("gemini-2.5-flash", "gemini-2.0-flash"):
            try:
                req = urllib.request.Request(
                    "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s" % (m, key),
                    data=body, headers={"Content-Type": "application/json"})
                d = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
                t = d["candidates"][0]["content"]["parts"][0]["text"]
                return float(_re.search(r"\d+(\.\d+)?", t).group())
            except Exception:
                continue
    except Exception:
        pass
    return None


def fetch(query, dest, beat_len, W, H):
    """Download + trim + crop one clip to dest (mp4, no audio). Returns (duration, credit)."""
    query = (query or "").strip()
    if not query:
        raise RuntimeError("no search query")
    key = (os.environ.get("PIXABAY_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("PIXABAY_API_KEY is not set")
    W, H = W - W % 2, H - H % 2
    portrait = H > W
    ranked = []
    for idx, hit in enumerate(search(query, key)):
        r = _rendition(hit)
        dur = float(hit.get("duration") or 0)
        if not r or dur < 1.5 or dur < beat_len * 0.6 or hit.get("id") in USED:
            continue
        match = (int(r.get("height") or 0) > int(r.get("width") or 0)) == portrait
        ranked.append((not match, dur < beat_len, idx, hit, r))
    if not ranked:
        raise RuntimeError("no usable Pixabay clip for '%s'" % query)
    ranked.sort(key=lambda t: t[:3])
    last = None
    for _, _, _, hit, r in ranked[:3]:
        try:
            os.makedirs(CACHE, exist_ok=True)
            src = os.path.join(CACHE, "pb_%s.mp4" % hit["id"])
            if not os.path.exists(src):
                tmp = src + ".part"
                with open(tmp, "wb") as f:
                    f.write(_get(r["url"], timeout=90))
                os.replace(tmp, src)
            dur = _probe(src)
            if dur < 1.0:
                raise RuntimeError("unreadable clip")
            want = min(dur, beat_len + 0.3)
            vf = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=30,format=yuv420p" % (W, H, W, H)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-t", "%.2f" % want, "-vf", vf,
                            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                            "-movflags", "+faststart", dest], check=True, capture_output=True)
            score = _judge(dest, query)
            if score is not None and score < 6:
                raise RuntimeError("clip does not show '%s' (score %s)" % (query, score))
            USED.add(hit.get("id"))
            return _probe(dest), "Pixabay"
        except Exception as e:
            last = e
    raise RuntimeError("stock download failed: %s" % str(last)[:120])


if __name__ == "__main__":
    q, ln, w, h = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    out = os.path.join(tempfile.gettempdir(), "stock_test.mp4")
    d, c = fetch(q, out, ln, w, h)
    print("ok", round(d, 2), c, out)
