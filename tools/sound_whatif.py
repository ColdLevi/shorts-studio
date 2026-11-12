#!/usr/bin/env python3
"""What If sound step (stage 5). Runs AFTER tools/sound_pass.py in make-short.yml.
sound_pass only listens to camera transitions and layers; a What If short is hard-cut `scene` clips with neither,
so this places effects on what Pip does instead:
  title card          whoosh_soft as it lands        fact card   hit_low as the number starts, tick for a readout
  prop pops in        pop        prop vanishes       swish      multiply   pop per copy (max 3, staggered)
  pose2 cheer/react   pop / hit_low at the moment `at`          walk across   none (quiet on purpose)
Rules: anchored to the clips (a new voice re-times them), at least 0.35 s apart, the stronger effect wins a clash,
about one effect per 1.6 s at most, nothing within 0.3 s of an effect sound_pass already placed.
Only this step's own ids (ws1, ws2, ...) are replaced on a re-run. Does nothing unless the timeline has What If scenes.
Uses only the generated effects from tools/sfx_gen.py. Never fails the build."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

SFX_DIR = "library/sfx/gen/"
PRIO = {"hit_low": 5, "whoosh_soft": 4, "swish": 3, "pop": 2, "tick": 1}
VOL = {"hit_low": 0.36, "whoosh_soft": 0.32, "swish": 0.5, "pop": 0.3, "tick": 0.26}


def _is_whatif(v):
    s = v.get("scene") if v.get("kind") == "scene" else None
    return isinstance(s, dict) and s.get("pack", "whatif") == "whatif"


def events(vis):
    ev = []   # (time, name, anchor id, offset)
    for i, v in enumerate(vis):
        if not _is_whatif(v):
            continue
        s, a, b = v["scene"], float(v["start"]), float(v["end"])
        d = max(0.2, b - a)
        kind = s.get("scene") or "stage"
        add = lambda off, name: ev.append((a + off, name, v["id"], round(off, 3)))
        if kind == "title":
            add(0.05, "whoosh_soft")
            continue
        if kind == "fact":
            add(0.15, "hit_low")
            continue
        fx = s.get("fx") or "none"
        if s.get("prop"):
            if fx == "pop":
                add(min(0.25, d * 0.2), "pop")
            elif fx == "vanish":
                add(min(d * 0.5, d - 0.1), "swish")
            elif fx == "multiply":
                n = max(1, min(3, int(s.get("count") or 3)))
                for k in range(n):
                    add(min(0.2 + 0.4 * k, d - 0.1), "pop")
        p2 = s.get("pose2")
        if p2 in ("cheer", "react"):
            try:
                at = float(s.get("at") if s.get("at") is not None else 0.4)
            except (TypeError, ValueError):
                at = 0.4
            add(max(0.05, min(d - 0.05, d * max(0.0, min(1.0, at)))), "pop" if p2 == "cheer" else "hit_low")
        if s.get("readout"):
            add(min(d * 0.45, d - 0.1), "tick")
    return ev


def sound_whatif(t):
    tr = t.setdefault("tracks", {})
    vis = tr.get("visuals") or []
    if not any(_is_whatif(v) for v in vis):
        return t
    if str((t.get("meta") or {}).get("sound", "")).lower() in ("off", "none"):
        return t
    ev = events(vis)
    ev.sort(key=lambda e: (e[0], -PRIO[e[1]]))
    other = [s for s in tr.get("sfx") or [] if not str(s.get("id", "")).startswith("ws")]
    taken = [float(s.get("at") or 0) for s in other]
    keep = []
    for e in ev:
        if any(abs(e[0] - x) < 0.3 for x in taken):
            continue
        if keep and e[0] - keep[-1][0] < 0.35:
            if PRIO[e[1]] > PRIO[keep[-1][1]]:
                keep[-1] = e
            continue
        keep.append(e)
    dur = float(t.get("duration") or vis[-1]["end"])
    cap = max(4, int(dur / 1.6))
    if len(keep) > cap:
        keep = sorted(sorted(keep, key=lambda e: -PRIO[e[1]])[:cap], key=lambda e: e[0])
    new = [{"id": "ws%d" % (n + 1), "src": SFX_DIR + e[1] + ".wav", "at": round(max(0.0, e[0]), 3),
            "volume": VOL[e[1]], "anchor": e[2], "offset": e[3]} for n, e in enumerate(keep)]
    tr["sfx"] = other + new
    old = str((t.get("meta") or {}).get("sound", ""))
    t.setdefault("meta", {})["sound"] = (old + "; " if old else "") + "what-if: %d effects" % len(new)
    return t


def main():
    pid = sys.argv[1]
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    sound_whatif(t)
    json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)
    print("sound_whatif:", (t.get("meta") or {}).get("sound"))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("sound_whatif: skipped (", e, ")")
