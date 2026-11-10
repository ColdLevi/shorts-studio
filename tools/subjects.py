#!/usr/bin/env python3
"""Subjects before the director (step1-subjects).
1) Cut out the subject of each beat picture (rembg, Actions only) -> <image>_cut.png next to it.
2) Run the director again so it can see the subjects: text behind the subject on the hook, no callout or icon over a face.
Never fails the build: any problem keeps the timeline as it was."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

MAX_IMAGES = int(os.getenv("SUBJECT_MAX", "14"))
BUDGET_S = float(os.getenv("SUBJECT_BUDGET_S", "330"))


def beats_worth_cutting(t):
    out = []
    for i, c in enumerate(t.get("tracks", {}).get("visuals") or []):
        if c.get("kind") != "image" or not c.get("src"):
            continue
        if not (c.get("narration") or "").strip() or (c["end"] - c["start"]) < 1.4:
            continue
        out.append(c)
    return out[:MAX_IMAGES]


def cut_all(pid, t):
    try:
        from PIL import Image
        from rembg import remove
    except Exception as e:
        print("subjects: rembg not available, no cutouts this time:", e)
        return 0
    t0, made = time.time(), 0
    for c in beats_worth_cutting(t):
        if time.time() - t0 > BUDGET_S:
            print("subjects: time budget reached, remaining beats keep face-detection only")
            break
        p = TL.asset_path(pid, c["src"])
        if not p or not os.path.exists(p):
            continue
        out_rel = os.path.splitext(c["src"])[0] + "_cut.png"
        out = TL.asset_path(pid, out_rel)
        if out and os.path.exists(out):
            continue
        try:
            cut = remove(Image.open(p).convert("RGB"))
            hist = cut.getchannel("A").histogram()
            cover = sum(hist[128:]) / float(sum(hist) or 1)
            if not (0.04 <= cover <= 0.75):
                print("subjects: rejected (subject covers %.0f%%): %s" % (cover * 100, c["src"]))
                continue
            cut.save(out)
            made += 1
            print("subjects: cutout ok (%.0f%%): %s" % (cover * 100, out_rel))
        except Exception as e:
            print("subjects: cutout failed (ignored):", e)
    return made


def redirect(pid, t):
    sp = os.path.join(TL.ROOT, "job", "spec.json")
    if not os.path.exists(sp):
        print("subjects: no job/spec.json (an edit of an existing project), layers left as they are")
        return False
    spec = json.load(open(sp))
    if not spec.get("beats"):
        return False
    old = (t.get("tracks") or {}).get("layers")
    os.environ.pop("DIRECTOR_DEFER", None)
    t["tracks"].pop("layers", None)
    try:
        TL.director_pass(t, spec)
    except Exception as e:
        print("subjects: director re-run failed, keeping the first pass:", e)
        if old:
            t["tracks"]["layers"] = old
        return bool(old)
    return True


def main():
    pid = sys.argv[1]
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    cut_all(pid, t)
    if redirect(pid, t):
        json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("subjects: skipped (", e, ")")
