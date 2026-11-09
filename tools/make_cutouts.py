#!/usr/bin/env python3
"""Subject cutouts for depth-text layers: writes <image>_cut.png and sets layer.cutout in the project timeline.
Runs in GitHub Actions only (needs rembg). Never fails the build: bad cutouts are skipped."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

pid = sys.argv[1]
tp = os.path.join(TL.project_dir(pid), "timeline.json")
t = json.load(open(tp))
layers = [l for l in (t.get("tracks", {}).get("layers") or []) if l.get("kind") == "depth-text" and l.get("src") and not l.get("cutout")]
if not layers:
    print("no depth-text layers, nothing to cut")
    sys.exit(0)
from PIL import Image
from rembg import remove
changed = False
for l in layers:
    p = TL.asset_path(pid, l["src"])
    if not p or not os.path.exists(p):
        print("missing", l["src"]); continue
    out_rel = os.path.splitext(l["src"])[0] + "_cut.png"
    out = TL.asset_path(pid, out_rel)
    try:
        im = Image.open(p).convert("RGB")
        cut = remove(im)
        a = cut.getchannel("A")
        hist = a.histogram()
        cover = sum(hist[128:]) / float(sum(hist) or 1)
        if not (0.04 <= cover <= 0.75):
            print("cutout rejected (subject covers %.0f%%):" % (cover * 100), l["src"]); continue
        cut.save(out)
        l["cutout"] = out_rel
        changed = True
        print("cutout ok (%.0f%% subject):" % (cover * 100), out_rel)
    except Exception as e:
        print("cutout failed (ignored):", e)
if changed:
    json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)
