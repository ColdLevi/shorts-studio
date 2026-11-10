#!/usr/bin/env python3
"""Subjects before the director (step1-subjects), plus the camera (step2-camera).
1) Cut out the subject of each beat picture (rembg, Actions only) -> <image>_cut.png, and remember it on the clip (c["cutout"]).
2) Run the director again so it can see the subjects: text behind the subject on the hook, no callout or icon over a face.
3) Run the camera director (moves and transitions; orbit and 2.5D parallax need the cutouts).
Never fails the build: any problem keeps the timeline as it was."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

MAX_IMAGES = int(os.getenv("SUBJECT_MAX", "14"))
BUDGET_S = float(os.getenv("SUBJECT_BUDGET_S", "330"))


def beats_worth_cutting(t):
    out = []
    for c in t.get("tracks", {}).get("visuals") or []:
        if c.get("kind") != "image" or not c.get("src"):
            continue
        if not (c.get("narration") or "").strip() or (c["end"] - c["start"]) < 1.4:
            continue
        out.append(c)
    return out[:MAX_IMAGES]


def cut_all(pid, t):
    """Returns how many clips gained a cutout (new or already on disk)."""
    try:
        from PIL import Image
        from rembg import remove
    except Exception as e:
        print("subjects: rembg not available, no cutouts this time:", e)
        remove = None
    t0, made = time.time(), 0
    for c in beats_worth_cutting(t):
        p = TL.asset_path(pid, c["src"])
        if not p or not os.path.exists(p):
            continue
        out_rel = os.path.splitext(c["src"])[0] + "_cut.png"
        out = TL.asset_path(pid, out_rel)
        if out and os.path.exists(out):
            if c.get("cutout") != out_rel:
                c["cutout"] = out_rel
                made += 1
            continue
        if remove is None:
            continue
        if time.time() - t0 > BUDGET_S:
            print("subjects: time budget reached, remaining beats keep face-detection only")
            break
        try:
            cut = remove(Image.open(p).convert("RGB"))
            hist = cut.getchannel("A").histogram()
            cover = sum(hist[128:]) / float(sum(hist) or 1)
            if not (0.04 <= cover <= 0.75):
                print("subjects: rejected (subject covers %.0f%%): %s" % (cover * 100, c["src"]))
                continue
            cut.save(out)
            c["cutout"] = out_rel
            made += 1
            print("subjects: cutout ok (%.0f%%): %s" % (cover * 100, out_rel))
        except Exception as e:
            print("subjects: cutout failed (ignored):", e)
    return made


def redirect(pid, t):
    """Re-run the director with subjects known. Returns the spec when it ran, else None."""
    sp = os.path.join(TL.ROOT, "job", "spec.json")
    if not os.path.exists(sp):
        print("subjects: no job/spec.json (an edit of an existing project), layers left as they are")
        return None
    spec = json.load(open(sp))
    if not spec.get("beats"):
        return None
    old = (t.get("tracks") or {}).get("layers")
    os.environ.pop("DIRECTOR_DEFER", None)
    t["tracks"].pop("layers", None)
    try:
        TL.director_pass(t, spec)
    except Exception as e:
        print("subjects: director re-run failed, keeping the first pass:", e)
        if old:
            t["tracks"]["layers"] = old
        return spec
    return spec


def main():
    pid = sys.argv[1]
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    made = cut_all(pid, t)
    spec = redirect(pid, t)
    if spec is not None and hasattr(TL, "camera_pass"):
        try:
            TL.camera_pass(t, spec)
        except Exception as e:
            print("subjects: camera pass failed (ignored):", e)
    if made or spec is not None:
        json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("subjects: skipped (", e, ")")
