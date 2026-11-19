#!/usr/bin/env python3
"""Add many sounds from one zip: add_sfx_zip.py --file-id ID [--role R] [--tags T]  (or --src pack.zip).
Role = folder name or filename prefix inside the zip (hit/boom.wav, hit_boom.wav), else --role.
Last line: 'OK ...' or 'ERROR: ...'."""
import argparse, os, re, shutil, subprocess, sys, tempfile, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import add_sfx
EXT = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".opus", ".aif", ".aiff"}
MAX_FILES, MAX_TOTAL = 60, 300 * 1024 * 1024

def role_for(rel, default):
    parts = rel.replace("\\", "/").split("/")
    stem = os.path.splitext(parts[-1])[0].lower()
    cands = [re.split(r"[_\- .]", stem)[0]] + [p.lower() for p in reversed(parts[:-1])]
    for c in cands:
        c = add_sfx.ALIAS.get(c.replace("-", "_"), c.replace("-", "_"))
        if c in add_sfx.ROLES:
            return c
    return default

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file-id", default=""); ap.add_argument("--src", default=""); ap.add_argument("--role", default="")
    ap.add_argument("--tags", default=""); ap.add_argument("--name", default="")
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="addzip_")
    try:
        src = a.src or (add_sfx.download(a.file_id, os.path.join(tmp, "pack")) if a.file_id else add_sfx.die("give --file-id or --src"))
        try:
            zf = zipfile.ZipFile(src)
        except Exception:
            add_sfx.die("that is not a readable zip file")
        items = [i for i in zf.infolist() if not i.is_dir() and os.path.splitext(i.filename)[1].lower() in EXT
                 and "__MACOSX" not in i.filename and not os.path.basename(i.filename).startswith("._")]
        if not items: add_sfx.die("no audio files found in the zip")
        if sum(i.file_size for i in items) > MAX_TOTAL: add_sfx.die("the zip unpacks to over 300 MB")
        extra = max(0, len(items) - MAX_FILES); items = items[:MAX_FILES]
        added, skipped = 0, []
        for n, it in enumerate(items):
            stem = os.path.splitext(os.path.basename(it.filename))[0]
            p = os.path.join(tmp, "f%d%s" % (n, os.path.splitext(it.filename)[1].lower()))
            with zf.open(it) as r, open(p, "wb") as f:
                shutil.copyfileobj(r, f)
            role = role_for(it.filename, a.role)
            tags = (a.tags + " " + re.sub(r"[_\-.]+", " ", stem)).strip()
            cmd = [sys.executable, os.path.join(HERE, "add_sfx.py"), "--src", p, "--role", role, "--tags", tags, "--name", stem]
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=240).stdout.strip().splitlines()
            except Exception:
                out = ["ERROR: timed out"]
            last = out[-1] if out else "ERROR: no output"
            print(stem[:30], "->", last[:140])
            if last.startswith("OK "): added += 1
            else: skipped.append("%s (%s)" % (stem[:24], last.replace("ERROR: ", "")[:50]))
        msg = "%d of %d added" % (added, len(items) + extra)
        if extra: msg += "; %d over the 60-file limit were left out" % extra
        if skipped: msg += "; skipped: " + ", ".join(skipped)
        msg = msg[:600]
        if added == 0: add_sfx.die(msg)
        print("OK " + msg)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
