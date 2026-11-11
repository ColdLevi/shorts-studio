#!/usr/bin/env python3
"""Sound pass (step4-sound): place the generated effects on the camera and the layers, then step back.
  whip-*           whoosh_fast just before the cut         push-through   whoosh_soft          carry-*   swish
  hook callout     hit_low                                  callout/corner-text   tick (a number: hit_low)
  illustration / asset / icon   pop
Rules: anchored to the picture clips (so a new voice re-times them), at least 0.45 s apart, the stronger effect wins a clash,
and never more than about one effect per 2.2 s. Settle (the quick camera punch) stays silent on purpose.
Regenerated each run: only the ones this pass made (ids gs1, gs2, ...) are replaced. Never fails the build."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

SFX_DIR = "library/sfx/gen/"
PRIO = {"whoosh_fast": 5, "hit_low": 4, "whoosh_soft": 3, "swish": 3, "pop": 2, "tick": 1, "riser": 4}
VOL = {"whoosh_fast": 0.42, "whoosh_soft": 0.34, "swish": 0.55, "hit_low": 0.38, "pop": 0.3, "tick": 0.28, "riser": 0.3}
_NUM = re.compile(r"\d")


def sound_pass(t):
    tr = t.setdefault("tracks", {})
    vis = tr.get("visuals") or []
    if not vis:
        return t
    spec_off = str((t.get("meta") or {}).get("sound", "")).lower() in ("off", "none")
    if spec_off:
        return t
    byid = {v["id"]: v for v in vis}
    ev = []     # (time, name, anchor, offset)
    for i, c in enumerate(vis):
        trn = c.get("transition") or {}
        ty, du = trn.get("type"), float(trn.get("duration") or 0)
        if i == 0 or not ty or not du:
            continue
        if ty.startswith("whip"):
            ev.append((c["start"] - du * 0.75, "whoosh_fast", c["id"], -du * 0.75))
        elif ty == "push-through":
            ev.append((c["start"] - du * 0.6, "whoosh_soft", c["id"], -du * 0.6))
        elif ty.startswith("carry"):
            ev.append((c["start"] - du * 0.5, "swish", c["id"], -du * 0.5))
    for l in tr.get("layers") or []:
        a = byid.get(l.get("anchor"))
        k = l.get("kind")
        if not a:
            continue
        at, off = l["start"], round(float(l.get("delay") or 0.15), 3)
        if k in ("kinetic", "corner-text", "depth-text"):
            hard = bool(_NUM.search(l.get("text") or "")) or k == "depth-text"
            ev.append((at, "hit_low" if hard else "tick", a["id"], off))
        elif k in ("illustration", "asset", "icon-pop"):
            ev.append((at + 0.12, "pop", a["id"], round(off + 0.12, 3)))
    ev.sort(key=lambda e: (e[0], -PRIO[e[1]]))
    keep = []
    for e in ev:
        if keep and e[0] - keep[-1][0] < 0.45:
            if PRIO[e[1]] > PRIO[keep[-1][1]]:
                keep[-1] = e
            continue
        keep.append(e)
    dur = float(t.get("duration") or vis[-1]["end"])
    cap = max(3, int(dur / 2.2))
    if len(keep) > cap:
        keep = sorted(sorted(keep, key=lambda e: -PRIO[e[1]])[:cap], key=lambda e: e[0])
    old = [s for s in tr.get("sfx") or [] if not str(s.get("id", "")).startswith("gs")]
    new = [{"id": "gs%d" % (n + 1), "src": SFX_DIR + e[1] + ".wav", "at": round(max(0.0, e[0]), 3), "volume": VOL[e[1]], "anchor": e[2], "offset": round(e[3], 3)}
           for n, e in enumerate(keep)]
    tr["sfx"] = old + new
    t.setdefault("meta", {})["sound"] = "%d effects: %s" % (len(new), ", ".join(sorted({e[1] for e in keep})))
    return t


def main():
    pid = sys.argv[1]
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    sound_pass(t)
    json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)
    print("sound_pass:", (t.get("meta") or {}).get("sound"))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("sound_pass: skipped (", e, ")")
