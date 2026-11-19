#!/usr/bin/env python3
"""Add one of the owner's own sounds to the shared SFX library (called by .github/workflows/add-sfx.yml).
  python3 tools/add_sfx.py --file-id TELEGRAM_FILE_ID --role hit --tags "deep boom" [--name my-hit]
  python3 tools/add_sfx.py --src local.wav --role tick            (local file, for tests)
It downloads the file (Telegram, TELEGRAM_TOKEN), loudness-matches it to the library standard (-20 LUFS, -1.5 dBFS ceiling),
writes media/library/sfx/clips/<id>.mp3 and adds an entry to media/library/sfx/catalog.json. Existing clips are never touched.
Last line printed is 'OK <id> ...' or 'ERROR: ...' (exit code 1). Needs ffmpeg/ffprobe."""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, urllib.parse, urllib.request

ROLES = {"whoosh_fast": ("motion", "whoosh_fast"), "whoosh_soft": ("motion", "whoosh_soft"), "swish": ("motion", "swish"),
         "hit_low": ("impact", "hit_low"), "pop": ("ui", "pop"), "tick": ("ui", "tick"), "riser": ("motion", "riser")}
ALIAS = {"hit": "hit_low", "impact": "hit_low", "boom": "hit_low", "whoosh": "whoosh_soft", "fastwhoosh": "whoosh_fast",
         "click": "tick", "ui": "tick", "rise": "riser", "swoosh": "swish"}
MAX_S, MIN_S, MAX_BYTES = 10.0, 0.03, 20 * 1024 * 1024
LUFS, TP = -20.0, -1.5

def die(msg):
    print("ERROR: " + msg); sys.exit(1)

def run(cmd, timeout=180):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

def download(file_id, dest_base):
    tok = os.environ.get("TELEGRAM_TOKEN", "")
    if not tok: die("no TELEGRAM_TOKEN in this job")
    try:
        info = json.load(urllib.request.urlopen("https://api.telegram.org/bot%s/getFile?%s" % (tok, urllib.parse.urlencode({"file_id": file_id})), timeout=30))
        fp = info["result"]["file_path"]
        dest = dest_base + (os.path.splitext(fp)[1] or ".bin")
        with urllib.request.urlopen("https://api.telegram.org/file/bot%s/%s" % (tok, fp), timeout=120) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
        return dest
    except Exception as e:
        die("could not download the file from Telegram (%s)" % str(e)[:100])

def probe(path):
    r = run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json", path], 60)
    try:
        d = json.loads(r.stdout)
        if not d.get("streams"): return None
        return float(d["format"]["duration"])
    except Exception:
        return None

def loud(path, extra=""):
    """loudnorm analysis pass -> dict, or None when the clip is too short or quiet to measure."""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "loudnorm=I=%s:TP=%s:LRA=11%s:print_format=json" % (LUFS, TP, extra), "-f", "null", "-"])
    m = re.findall(r"\{[^{}]*\}", r.stderr, re.S)
    try:
        d = json.loads(m[-1]); float(d["input_i"]); return d
    except Exception:
        return None

def maxvol(path):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", r.stderr)
    return float(m.group(1)) if m else None

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file-id", default=""); ap.add_argument("--src", default=""); ap.add_argument("--role", default="")
    ap.add_argument("--tags", default=""); ap.add_argument("--name", default=""); ap.add_argument("--license", default="")
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    a = ap.parse_args()
    for t in ("ffmpeg", "ffprobe"):
        if not shutil.which(t): die(t + " is not installed here")
    lib = os.path.join(a.root, "media", "library", "sfx"); cat_path = os.path.join(lib, "catalog.json")
    if not os.path.exists(cat_path): die("catalog.json not found at " + cat_path)
    cat = json.load(open(cat_path, encoding="utf-8")); clips = cat.get("clips")
    if not isinstance(clips, list): die("catalog.json has no clips list")
    role = a.role.strip().lower().replace("-", "_"); role = ALIAS.get(role, role)
    warn = ""
    if role and role not in ROLES:
        warn = " (role '%s' is not one the studio plays automatically; saved in the library only)" % role; role = ""
    tmp = tempfile.mkdtemp(prefix="addsfx_")
    try:
        src = a.src or (download(a.file_id, os.path.join(tmp, "in")) if a.file_id else die("give --file-id or --src"))
        if os.path.getsize(src) > MAX_BYTES: die("file is over 20 MB")
        dur = probe(src)
        if dur is None: die("that file has no audio I can read")
        if dur > MAX_S: die("%.1f s is too long for a sound effect (max %d s)" % (dur, MAX_S))
        if dur < MIN_S: die("that sound is too short (%.3f s)" % dur)
        used = {c.get("id") for c in clips}
        base = slug(a.name) or slug((role or "sfx") + "-" + a.tags) or "sfx"
        cid, n = base, 2
        while cid in used or os.path.exists(os.path.join(lib, "clips", cid + ".mp3")):
            cid = "%s-%d" % (base, n); n += 1
        sv = maxvol(src)
        if sv is None or sv < -50: die("that sound is silent")
        peak_mode, m = False, loud(src)
        if m and float(m["input_i"]) > -70 and dur >= 0.5:
            af = "loudnorm=I=%s:TP=%s:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true" % (
                LUFS, TP, m["input_i"], m["input_tp"], m["input_lra"], m["input_thresh"], m["target_offset"])
            how = "loudness-matched to %d LUFS" % LUFS
        else:
            mv = maxvol(src)
            if mv is None: die("could not measure that sound")
            af = "volume=%.2fdB" % (-3.0 - mv); how = "too short to measure loudness, peak set to -3 dBFS"; peak_mode = True
        os.makedirs(os.path.join(lib, "clips"), exist_ok=True)
        out = os.path.join(lib, "clips", cid + ".mp3")
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", out])
        if r.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) < 500:
            if os.path.exists(out): os.remove(out)
            die("conversion failed: " + r.stderr.strip()[:120])
        pk = maxvol(out)
        if peak_mode and pk is not None and abs(pk + 3.0) > 1.0:      # mp3 priming can eat a very short transient: correct once
            af2 = "volume=%.2fdB" % (-3.0 - mv + (-3.0 - pk))
            r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-af", af2, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", out])
            if r.returncode == 0: pk = maxvol(out)
        mo = loud(out)
        cats = {c.get("category") for c in clips}
        want = ROLES[role][0] if role else "user"
        entry = {"id": cid, "file": "clips/%s.mp3" % cid, "category": want if want in cats else "user",
                 "tags": sorted({t for t in re.split(r"[\s,]+", a.tags.lower()) if t} | ({role} if role else set())),
                 "duration_s": round(probe(out) or dur, 2), "peak_dbfs": pk, "loudness_lufs": round(float(mo["input_i"]), 1) if mo and float(mo["input_i"]) > -70 else None,
                 "source": "user-upload:telegram", "license": a.license or "supplied by the repo owner; the owner is responsible for the licence",
                 "prompt": "", "used_in": [], "role": role}
        clips.append(entry)
        tmpcat = cat_path + ".tmp"
        json.dump(cat, open(tmpcat, "w", encoding="utf-8"), indent=2, ensure_ascii=False); os.replace(tmpcat, cat_path)
        print("OK %s | %.2f s | %s | peak %s dBFS | role %s%s" % (cid, entry["duration_s"], how, pk, role or "none", warn))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
