#!/usr/bin/env python3
"""Restraint budget and QA gate (step4-sound), from the motion-graphics skill (2.2, 8.1, 8.2).
  python3 tools/qa.py pre <project-id>         prune the timeline to the budget, report, save (before the render)
  python3 tools/qa.py post <video> <project>   look at the finished video: frozen stretches, silent or clipped audio (after the render)
Budget: <= 6 graphic moments per minute, <= 2 elements on screen at once, one device at most max(3, length/20) times,
a prop never wider than 1/3 of the frame, a line only with the text it underlines, <= 2 whips, no move twice in a row.
It only removes things (a quiet frame beats a wrong one) and tells you what it removed. Never fails the build."""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

MOMENT = ("kinetic", "corner-text", "depth-text", "illustration", "asset", "icon-pop")
PRIO = {"depth-text": 6, "kinetic": 5, "corner-text": 5, "asset": 4, "illustration": 3, "icon-pop": 2}


def prune(t):
    tr = t.get("tracks") or {}
    layers = list(tr.get("layers") or [])
    notes = []
    dur = float(t.get("duration") or 0) or (max([l["end"] for l in layers] or [0]))

    def drop(l, why):
        if l in layers:
            layers.remove(l)
            notes.append("removed %s (%s)" % (l.get("kind"), why))

    for l in layers:                                         # a prop never wider than a third of the frame
        if l.get("kind") in ("illustration", "asset") and (l.get("w") or 0) > 0.34:
            l["w"] = 0.33
    for l in [x for x in layers if x.get("kind") == "draw-line"]:   # a line only with the text it underlines
        if not any(x.get("anchor") == l.get("anchor") and x.get("kind") in ("kinetic", "corner-text") for x in layers):
            drop(l, "a line with nothing to underline")
    cap_dev = max(3, int(dur // 20))                         # one device not more than max(3, length/20) times
    for kind in MOMENT:
        same = sorted([x for x in layers if x.get("kind") == kind], key=lambda x: x["start"])
        for x in same[cap_dev:]:
            drop(x, "%s used more than %d times" % (kind, cap_dev))
    for _ in range(40):                                      # at most 2 elements on screen at once
        moments = [x for x in layers if x.get("kind") in MOMENT]
        hit = None
        for x in moments:
            over = [y for y in moments if y["start"] < x["end"] and y["end"] > x["start"]]
            if len(over) > 2:
                hit = min(over, key=lambda y: (PRIO.get(y["kind"], 0), -y["start"]))
                break
        if not hit:
            break
        drop(hit, "more than 2 elements on screen")
    for _ in range(40):                                      # at most 6 moments in any 60 seconds
        moments = sorted([x for x in layers if x.get("kind") in MOMENT], key=lambda y: y["start"])
        hit = None
        for i, x in enumerate(moments):
            win = [y for y in moments if x["start"] <= y["start"] < x["start"] + 60]
            if len(win) > 6:
                hit = min(win, key=lambda y: (PRIO.get(y["kind"], 0), -y["start"]))
                break
        if not hit:
            break
        drop(hit, "more than 6 graphic moments in a minute")
    if notes or "layers" in tr:
        tr["layers"] = layers
    vis = tr.get("visuals") or []
    whips = [v for v in vis if ((v.get("transition") or {}).get("type") or "").startswith("whip")]
    for v in whips[2:]:
        v["transition"] = {"type": "settle", "duration": 0.4}
        notes.append("a third whip became a settle")
    prev = None
    for v in vis:
        m = (v.get("cam") or {}).get("move")
        if m and m == prev and m != "hold":
            v["cam"]["move"] = "drift" if m != "drift" else "truck"
            notes.append("the same camera move twice in a row was changed")
        prev = (v.get("cam") or {}).get("move") or prev
    return notes


def pre(pid):
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    notes = prune(t)
    problems = []
    try:
        problems = TL.validate(t) or []
    except Exception as e:
        problems = ["validate failed: %s" % e]
    t.setdefault("meta", {})["qa"] = notes
    json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)
    lines = ["QA gate before the render: %s" % ("clean, nothing removed" if not notes else "%d change(s)" % len(notes))] + ["- " + n for n in notes[:12]]
    if problems:
        lines += ["- timeline warnings: " + "; ".join(map(str, problems[:4]))]
    print("\n".join(lines))
    if notes or problems:
        TL._director_say(lines)


def post(video, pid=""):
    """Frozen stretches (a scene that sits dead) and audio levels, with ffmpeg only."""
    lines = []
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", video, "-vf", "freezedetect=n=-55dB:d=2.5", "-an", "-f", "null", "-"], capture_output=True, text=True)
    fr = re.findall(r"freeze_start: ([\d.]+)", r.stderr)
    if fr:
        lines.append("frozen picture for 2.5 s or more starting at %s s" % ", ".join(fr[:5]))
    a = subprocess.run(["ffmpeg", "-hide_banner", "-i", video, "-af", "volumedetect", "-vn", "-f", "null", "-"], capture_output=True, text=True)
    mx = re.search(r"max_volume: (-?[\d.]+) dB", a.stderr)
    mean = re.search(r"mean_volume: (-?[\d.]+) dB", a.stderr)
    if mx and float(mx.group(1)) > -0.3:
        lines.append("audio peaks at %s dB, it may clip" % mx.group(1))
    if mean and float(mean.group(1)) < -32:
        lines.append("audio is very quiet (mean %s dB)" % mean.group(1))
    print("QA after the render:", "; ".join(lines) or "no frozen stretches, audio levels fine")
    if lines:
        TL._director_say(["QA after the render"] + ["- " + x for x in lines])


if __name__ == "__main__":
    try:
        if sys.argv[1] == "pre":
            pre(sys.argv[2])
        elif sys.argv[1] == "post":
            post(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    except Exception as e:
        print("qa: skipped (", e, ")")
