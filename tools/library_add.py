#!/usr/bin/env python3
"""Adds the finished short to library.json (read by the Studio mini app in Telegram).
Usage: python tools/library_add.py <release-tag>      (run from the repo root, after `gh release create`)
       python tools/library_add.py --button           prints the Telegram 'Open in Studio' button JSON"""
import json, os, subprocess, sys, time

if sys.argv[1:] == ["--button"]:
    url = os.getenv("APP_URL", "")
    rows = [[{"text": "🎞 Open in Studio", "web_app": {"url": url}}]] if url.startswith("https://") else []
    print(json.dumps({"inline_keyboard": rows}))
    sys.exit(0)

tag = sys.argv[1]
repo = os.getenv("GITHUB_REPOSITORY", "ColdLevi/shorts-studio")
spec = json.load(open("job/spec.json"))
try:
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "job/final.mp4"]).decode().strip())
except Exception:
    dur = 0.0
base = f"https://github.com/{repo}/releases/download/{tag}/{tag}"
entry = {"id": tag, "title": spec.get("title", tag), "hook": spec.get("hook") or spec["beats"][0]["narration"],
         "accent": spec.get("accent", "#FFD43B"), "duration": round(dur, 1), "created": int(time.time() * 1000),
         "url": base + ".mp4", "poster": base + ".jpg"}
try:
    lib = json.load(open("library.json"))
except Exception:
    lib = {"shorts": []}
lib["shorts"] = [s for s in lib.get("shorts", []) if s.get("id") != tag] + [entry]
json.dump(lib, open("library.json", "w"), indent=2)
print("library:", len(lib["shorts"]), "shorts")
