#!/usr/bin/env python3
"""make_boards_patch.py PROJECT_ID: puts one board overlay on each scene of a rendered project (anchored to the scene, so timing follows the voice).
Writes ~/patch.json. Captions go off (the boards carry the words)."""
import json, os, sys
pid = sys.argv[1]
t = json.load(open("media/projects/%s/timeline.json" % pid))
vis = sorted(t["tracks"]["visuals"], key=lambda v: v["start"])
kinds = ["cards", "book", "lanes", "triangle", "funding", "bars", "leg", "check", "close"]
if len(vis) != len(kinds):
    sys.exit("expected %d scenes, project has %d. Send me this number." % (len(kinds), len(vis)))
ops = [{"op": "add", "path": "/tracks/overlays/-",
        "value": {"id": "b%d" % (i + 1), "kind": "board", "board": k, "anchor": v["id"], "start": v["start"], "end": v["end"]}}
       for i, (k, v) in enumerate(zip(kinds, vis))]
ops.append({"op": "merge", "path": "/style/caption", "value": {"preset": "none"}})
json.dump(ops, open(os.path.expanduser("~/patch.json"), "w"))
print("wrote ~/patch.json:", len(ops), "ops, scenes", [v["id"] for v in vis])
