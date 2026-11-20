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

KIT_KINDS = ("screen-scene", "glass-ui", "terminal-typing", "notification-stack", "counter-graph", "browser-page-load", "checkout", "alert-glitch", "transfer-progress", "keyed-clip")
STEPPED = tuple(k for k in KIT_KINDS if k not in ("screen-scene", "keyed-clip"))

MOMENT = ("kinetic", "corner-text", "depth-text", "illustration", "asset", "icon-pop", "chapter-card", "chart", "panel", "settle-title")
PRIO = {"depth-text": 6, "chapter-card": 6, "kinetic": 5, "settle-title": 5, "corner-text": 5, "chart": 5, "asset": 4, "panel": 4, "illustration": 3, "icon-pop": 2}


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
    ids = {v.get("id") for v in (tr.get("visuals") or [])}
    for l in [x for x in layers if x.get("kind") in KIT_KINDS]:   # kit scenes: a guard for edited or odd timelines
        if l.get("anchor") and ids and l["anchor"] not in ids:
            drop(l, "its scene is not in the timeline")
        elif l.get("kind") in STEPPED and not l.get("steps"):
            drop(l, "a kit scene with nothing written in it")
        elif l.get("kind") == "keyed-clip" and not l.get("src"):
            drop(l, "a green-screen clip with no file")
    for _ in range(20):    # two kit scenes never share the screen; a green-screen clip gives way to a kit scene
        ks = sorted([x for x in layers if x.get("kind") in KIT_KINDS], key=lambda y: (y.get("kind") == "keyed-clip", y.get("start", 0)))
        hit = None
        for i, x in enumerate(ks):
            hit = next((y for y in ks[i + 1:] if y.get("start", 0) < x.get("end", 0) and y.get("end", 0) > x.get("start", 0)), None)
            if hit:
                break
        if not hit:
            break
        drop(hit, "a green-screen clip on a kit scene" if hit.get("kind") == "keyed-clip" else "two kit scenes on screen at once")
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
    try:   # black stretches and a video that is not the length the timeline promised (reports only)
        bk = subprocess.run(["ffmpeg", "-hide_banner", "-i", video, "-vf", "blackdetect=d=1.0:pic_th=0.98:pix_th=0.04", "-an", "-f", "null", "-"], capture_output=True, text=True)
        dm = re.search(r"Duration: (\d+):(\d+):([\d.]+)", bk.stderr)
        vd = int(dm.group(1)) * 3600 + int(dm.group(2)) * 60 + float(dm.group(3)) if dm else 0.0
        bl = [(float(a0), float(z0)) for a0, z0 in re.findall(r"black_start:([\d.]+)\s+black_end:([\d.]+)", bk.stderr)]
        bl = [x for x in bl if not (vd and x[1] >= vd - 0.3)]
        if bl:
            lines.append("black picture for 1 s or more starting at %s s" % ", ".join("%.1f" % x[0] for x in bl[:5]))
        if pid and vd:
            want = float(json.load(open(os.path.join(TL.project_dir(pid), "timeline.json"))).get("duration") or 0)
            if want and abs(vd - want) > 2.0:
                lines.append("the video is %.1f s long but the timeline says %.1f s" % (vd, want))
    except Exception as e:
        print("qa: extra checks skipped (", e, ")")
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
