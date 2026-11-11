#!/usr/bin/env python3
"""Resolve the "asset" layers of a timeline (step3-assets): find the checked cutout in the library, or generate it once.
Layers that cannot be resolved fall back to the matching code illustration, or are dropped (a quiet frame beats a wrong one).
Env: ASSET_MAX_NEW (default 3 new cutouts per run). Never fails the build."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL
import assets as AS


def main():
    pid = sys.argv[1]
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    layers = (t.get("tracks") or {}).get("layers") or []
    wants = [l for l in layers if l.get("kind") == "asset" and not l.get("src")]
    AS.seed()
    if not wants:
        return
    budget = int(os.getenv("ASSET_MAX_NEW", "3"))
    keep, changed = [], False
    for l in layers:
        if l not in wants:
            keep.append(l)
            continue
        aid = AS.slug(l.get("subject") or l.get("fallback") or "")
        ent = AS.find(aid)
        if not ent and budget > 0:
            budget -= 1
            ent = AS.factory(l.get("subject") or aid, aid)
        if ent:
            l["src"] = "library/assets/" + os.path.basename(ent["file"])
            keep.append(l)
        elif l.get("fallback"):
            l["kind"], l["asset"] = "illustration", l["fallback"]
            l["w"] = 0.3
            keep.append(l)
            print("assets_step: no cutout for %r, using the %s illustration" % (l.get("subject"), l["fallback"]))
        else:
            print("assets_step: dropped %r (no cutout)" % l.get("subject"))
        changed = True
    if changed:
        t["tracks"]["layers"] = keep
        json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("assets_step: skipped (", e, ")")
