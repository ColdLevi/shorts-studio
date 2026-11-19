#!/usr/bin/env python3
"""Measure motion recipes from reference clips (ffmpeg only) and write them into a style pack.

  python3 tools/measure_recipes.py selftest
  python3 tools/measure_recipes.py measure <pack-id> <clip> [<clip> ...] [--dry] [--seconds N]

Method: resample to 30 fps, take the luma difference between consecutive frames (signalstats YDIF).
  hard cut      = one isolated spike frame
  gradual move  = a run of >= 5 changing frames; easing is fitted by comparing the cumulative
                  frame difference with standard cubic-bezier curves (approximate, says so)
Nothing is invented: unmeasurable values are the text 'not measured: reason'."""
import json, os, re, shutil, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style_metrics as sm
import style_pack as sp

FPS = 30
HARD_MIN = 12.0        # a hard cut must jump at least this much (YDIF, 0-255 scale)
SPIKE_RATIO = 3.0      # ... and be at least 3x both neighbouring frames
EVENT_FLOOR = 2.0      # a frame counts as moving above max(floor, K * median)
EVENT_K = 2.5
SHORT_MIN = 3          # runs shorter than this are ignored
FIT_MIN = 5            # runs shorter than this are not curve-fitted
FIT_MAX_RMSE = 0.10    # worse fit than this = no curve claimed
CURVES = {
    "linear": [0, 0, 1, 1],
    "ease": [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
    "in-quad": [0.11, 0, 0.5, 0],
    "out-quad": [0.5, 1, 0.89, 1],
    "in-out-quad": [0.45, 0, 0.55, 1],
    "in-cubic": [0.32, 0, 0.67, 0],
    "out-cubic": [0.33, 1, 0.68, 1],
    "in-out-cubic": [0.65, 0, 0.35, 1],
    "out-quint": [0.22, 1, 0.36, 1],
    "out-back": [0.34, 1.56, 0.64, 1],
}


def run(cmd, timeout=600):
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def probe(path):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height,r_frame_rate:format=duration", "-of", "json", path], 60)
    j = json.loads(r.stdout.decode("utf-8", "ignore") or "{}")
    st = (j.get("streams") or [{}])[0]
    num, _, den = str(st.get("r_frame_rate", "0/1")).partition("/")
    try:
        fps = round(float(num) / float(den or 1), 3)
    except Exception:
        fps = None
    try:
        dur = round(float((j.get("format") or {}).get("duration")), 3)
    except Exception:
        dur = None
    return {"width": st.get("width"), "height": st.get("height"), "source_fps": fps, "duration_s": dur}


def ydif_series(path, seconds):
    r = run(["ffmpeg", "-hide_banner", "-t", str(seconds), "-i", path, "-vf",
             "fps=%d,scale=160:-2,signalstats,metadata=print" % FPS, "-an", "-f", "null", "-"], 900)
    cur, vals = None, {}
    for line in (r.stderr or b"").decode("utf-8", "ignore").splitlines():
        m = re.search(r"frame:(\d+)", line)
        if m:
            cur = int(m.group(1))
        m = re.search(r"signalstats\.YDIF=([\d.]+)", line)
        if m and cur is not None:
            vals[cur] = float(m.group(1))
    if not vals:
        return []
    return [vals.get(i, 0.0) for i in range(max(vals) + 1)]


def bez_y(x, c):
    x1, y1, x2, y2 = c
    lo, hi = 0.0, 1.0
    for _ in range(30):
        t = (lo + hi) / 2
        bx = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3
        if bx < x:
            lo = t
        else:
            hi = t
    t = (lo + hi) / 2
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3


def fit_curve(d):
    total = sum(d)
    if total <= 0:
        return None
    L, acc, pts = len(d), 0.0, []
    for k, v in enumerate(d, 1):
        acc += v
        pts.append((k / L, acc / total))
    best = None
    for name, c in CURVES.items():
        err = (sum((bez_y(x, c) - p) ** 2 for x, p in pts) / L) ** 0.5
        if best is None or err < best[2]:
            best = (name, c, err)
    return best


def detect(y):
    n = len(y)
    y2, hard = list(y), []
    for i in range(1, n):
        a = y[i - 1]
        b = y[i + 1] if i < n - 1 else 0.0
        if y[i] >= HARD_MIN and y[i] >= SPIKE_RATIO * max(a, b):
            hard.append(i)
            y2[i] = min(a, b)
    med = sm._pct(sorted(y2), 0.5) or 0.0
    thr = max(EVENT_FLOOR, EVENT_K * med)
    idx = [i for i, v in enumerate(y2) if v > thr]
    runs = []
    for i in idx:
        if runs and i - runs[-1][1] <= 2:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    events = []
    for s, e in runs:
        L = e - s + 1
        if L < SHORT_MIN:
            continue
        ev = {"start": s, "frames": L, "peak": round(max(y2[s:e + 1]), 1),
              "kind": "gradual" if L >= FIT_MIN else "short"}
        if ev["kind"] == "gradual":
            f = fit_curve(y2[s:e + 1])
            if f and f[2] <= FIT_MAX_RMSE:
                ev["fit"] = (f[0], f[1], round(f[2], 3))
            else:
                ev["fit_failed"] = round(f[2], 3) if f else None
        events.append(ev)
    return hard, events, {"median_ydif": round(med, 2), "threshold": round(thr, 2)}


def _med(vals):
    return sm._pct(sorted(vals), 0.5)


def build_recipes(all_events, n_hard, sources):
    recipes = []
    groups = {}
    for ev in all_events:
        if "fit" in ev:
            key = ("fit", ev["fit"][0])
        elif ev["kind"] == "short":
            key = ("short", "")
        else:
            key = ("unfit", "")
        groups.setdefault(key, []).append(ev)
    ordered = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    if n_hard:
        recipes.append({"id": "R01", "kind": "hard-cut", "fps": FPS, "duration_frames": 1,
                        "easing": "not measured: instantaneous cut has no curve",
                        "count": n_hard, "sources": sources})
    for (kind, name), evs in ordered:
        r = {"id": "R%02d" % (len(recipes) + 1), "fps": FPS, "count": len(evs), "sources": sources,
             "duration_frames": int(round(_med([e["frames"] for e in evs]))),
             "duration_range": [min(e["frames"] for e in evs), max(e["frames"] for e in evs)],
             "peak_ydif_median": round(_med([e["peak"] for e in evs]), 1)}
        if kind == "fit":
            r["kind"] = "gradual-move"
            r["easing"] = CURVES[name]
            r["easing_name"] = name
            r["fit_rmse"] = round(_med([e["fit"][2] for e in evs]), 3)
            r["easing_note"] = "fitted from frame difference, approximate"
        elif kind == "short":
            r["kind"] = "short-move"
            r["easing"] = "not measured: run shorter than %d frames, too few points to fit" % FIT_MIN
        else:
            r["kind"] = "gradual-move"
            r["easing"] = "not measured: no standard curve fits within rmse %.2f" % FIT_MAX_RMSE
        recipes.append(r)
    return recipes


def analyse(path, seconds):
    info = probe(path)
    y = ydif_series(path, seconds)
    if len(y) < 10:
        raise SystemExit("could not read frames from " + path)
    hard, events, stats = detect(y)
    return info, y, hard, events, stats


def show(name, info, y, hard, events, stats):
    print("clip:", name, info)
    print("  frames analysed:", len(y), stats)
    print("  hard cuts (%d), frames:" % len(hard), hard[:25])
    for ev in events:
        fit = ev.get("fit")
        print("  move: start %d, %d frames, peak %s, %s" % (
            ev["start"], ev["frames"], ev["peak"],
            ("best fit %s rmse %s" % (fit[0], fit[2])) if fit else
            ev["kind"] + (", no fit (rmse %s)" % ev["fit_failed"] if "fit_failed" in ev else "")))


def selftest():
    out = os.path.expanduser("~/selftest_motion.mp4")
    fc = ("[0:v][1:v]xfade=transition=fade:duration=0.5:offset=1.5,fps=30,setsar=1,format=yuv420p[a];"
          "[2:v]fps=30,setsar=1,format=yuv420p[c];[a][c]concat=n=2:v=1:a=0[v]")
    r = run(["ffmpeg", "-y", "-v", "error",
             "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2",
             "-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=2",
             "-f", "lavfi", "-i", "color=c=0x808080:s=320x180:r=30:d=2",
             "-filter_complex", fc, "-map", "[v]", "-r", "30", "-pix_fmt", "yuv420p", out], 120)
    if r.returncode != 0:
        print("could not build the test clip:", (r.stderr or b"").decode("utf-8", "ignore")[:400])
        raise SystemExit(2)
    info, y, hard, events, stats = analyse(out, 30)
    show("selftest", info, y, hard, events, stats)
    grad = [e for e in events if e["kind"] == "gradual"]
    ok_hard = len(hard) == 1 and abs(hard[0] - 105) <= 1
    ok_grad = (len(grad) == 1 and 13 <= grad[0]["frames"] <= 17 and 44 <= grad[0]["start"] <= 47
               and "fit" in grad[0] and grad[0]["fit"][0] == "linear")
    print("expected: 1 hard cut at frame 105, 1 linear move of about 15 frames starting near 45")
    print("hard cut check:", "PASS" if ok_hard else "FAIL")
    print("dissolve check:", "PASS" if ok_grad else "FAIL")
    raise SystemExit(0 if (ok_hard and ok_grad) else 1)


def measure(argv):
    dry = "--dry" in argv
    seconds = 90
    if "--seconds" in argv:
        seconds = int(argv[argv.index("--seconds") + 1])
    args, skip = [], False
    for i, a in enumerate(argv):
        if skip:
            skip = False
            continue
        if a == "--seconds":
            skip = True
        elif not a.startswith("--"):
            args.append(a)
    if len(args) < 2:
        raise SystemExit("usage: measure <pack-id> <clip> [<clip> ...] [--dry] [--seconds N]")
    pid, clips = args[0], args[1:]
    pack = sp.load_pack(pid)
    if pack is None:
        raise SystemExit("no such pack: " + pid)
    all_events, n_hard, shots, hooks, refs, names = [], 0, [], [], [], []
    for c in clips:
        c = os.path.expanduser(c)
        name = os.path.basename(c)
        info, y, hard, events, stats = analyse(c, seconds)
        show(name, info, y, hard, events, stats)
        names.append(name)
        n_hard += len(hard)
        all_events += events
        pts = [0] + hard + [len(y)]
        shots += [(b - a) / FPS for a, b in zip(pts, pts[1:]) if b - a >= 2]
        if hard:
            hooks.append(hard[0] / FPS)
        refs.append(dict(info, file=name, frames_analysed=len(y),
                         licence="unconfirmed: owner has not said this clip is his own or licensed"))
    recipes = build_recipes(all_events, n_hard, names)
    s = sorted(shots)
    if len(s) >= 6:
        pacing = {"beat_seconds": round(sm._pct(s, 0.5), 2), "shot_s_p10": round(sm._pct(s, 0.1), 2),
                  "shot_s_p90": round(sm._pct(s, 0.9), 2), "shots_counted": len(s)}
        if hooks:
            pacing["hook_s"] = round(_med(hooks), 2)
    else:
        pacing = {"beat_seconds": "not measured: only %d shots found, need 6" % len(s)}
    print("recipes:", json.dumps(recipes, indent=1))
    print("pacing:", pacing)
    if dry:
        print("dry run, nothing written")
        return
    d = sp.pack_dir(pid)
    shutil.copy(os.path.join(d, "pack.json"),
                os.path.expanduser("~/backups/pack-%s-%s.json" % (pid, time.strftime("%Y%m%d%H%M%S"))))
    pack["motion"]["recipes"] = recipes
    pack["motion"]["measured_from"] = names
    pack["pacing"].update(pacing)
    with open(os.path.join(d, "pack.json"), "w") as f:
        json.dump(pack, f, indent=2)
    rp = os.path.join(d, "refs.json")
    try:
        rj = json.load(open(rp))
    except Exception:
        rj = {"refs": []}
    keep = [r for r in rj.get("refs", []) if r.get("file") not in names]
    rj["refs"] = keep + refs
    with open(rp, "w") as f:
        json.dump(rj, f, indent=2)
    e, w = sp.validate_pack(pack)
    for x in e:
        print("ERROR:", x)
    for x in w:
        print("WARN:", x)
    print("written. validator problems: %d, warnings: %d" % (len(e), len(w)))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
        selftest()
    elif len(sys.argv) >= 2 and sys.argv[1] == "measure":
        measure(sys.argv[2:])
    else:
        print(__doc__)
