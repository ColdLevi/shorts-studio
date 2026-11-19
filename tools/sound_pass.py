#!/usr/bin/env python3
"""Sound pass (step4-sound): place the generated effects on the camera and the layers, then step back.
  whip-*           whoosh_fast just before the cut         push-through   whoosh_soft          carry-*   swish
  hook callout     hit_low                                  callout/corner-text   tick (a number: hit_low)
  illustration / asset / icon   pop
Rules: anchored to the picture clips (so a new voice re-times them), at least 0.45 s apart, the stronger effect wins a clash,
and never more than about one effect per 2.2 s. Settle (the quick camera punch) stays silent on purpose.
Regenerated each run: only the ones this pass made (ids gs1, gs2, ...) are replaced. Never fails the build."""
import json, os, re, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

SFX_DIR = "library/sfx/gen/"
PRIO = {"whoosh_fast": 5, "hit_low": 4, "whoosh_soft": 3, "swish": 3, "pop": 2, "tick": 1, "riser": 4}
VOL = {"whoosh_fast": 0.42, "whoosh_soft": 0.34, "swish": 0.55, "hit_low": 0.38, "pop": 0.3, "tick": 0.28, "riser": 0.3}
_NUM = re.compile(r"\d")

CL = "library/sfx/clips/"
VARIANTS = {
    "whoosh_fast": [(CL + "whoosh-soft.mp3", 0.85)],
    "whoosh_soft": [(CL + "whoosh-soft.mp3", 0.85), (CL + "whoosh-wind.mp3", 0.85)],
    "swish": [(CL + "whoosh-wind.mp3", 0.6)],
    "hit_low": [(CL + "impact-soft.mp3", 0.85), (CL + "impact-deep-soft.mp3", 0.7)],
    "tick": [(CL + "ui-click-soft.mp3", 0.9)],
    "pop": [(CL + "pop-reveal.mp3", 0.85)],
    "riser": [(CL + "riser-soft.mp3", 0.85)],
}


def _user_opts(root, name):
    """The owner's own uploaded sounds for this role (catalog.json, source user-upload*). Preferred when present."""
    if os.environ.get("SFX_USER_PREFER", "on").lower() == "off":
        return []
    try:
        cat = json.load(open(os.path.join(root, "media", "library", "sfx", "catalog.json"), encoding="utf-8"))
        out = []
        for c in cat.get("clips") or []:
            if c.get("role") == name and str(c.get("source", "")).startswith("user-upload"):
                rel = "library/sfx/" + str(c.get("file", ""))
                if os.path.exists(os.path.join(root, "media", rel)):
                    out.append((rel, 0.85))
        return out
    except Exception:
        return []


def _pk(name, n, seed):
    key = (name, n)
    if key in _pk.memo:
        return _pk.memo[key]
    k = _pk.cnt.get(name, 0)
    _pk.cnt[name] = k + 1
    root = getattr(TL, "ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    opts = [(SFX_DIR + name + ".wav", 1.0)] + [o for o in VARIANTS.get(name, []) if os.path.exists(os.path.join(root, "media", o[0]))]
    opts = _user_opts(root, name) or opts
    _pk.memo[key] = opts[(seed + k) % len(opts)]
    return _pk.memo[key]


_pk.memo, _pk.cnt = {}, {}


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
        if k in ("kinetic", "settle-title", "corner-text", "depth-text", "chapter-card"):
            hard = bool(_NUM.search(l.get("text") or "")) or k in ("depth-text", "chapter-card")
            ev.append((at, "hit_low" if hard else "tick", a["id"], off))
        elif k in ("illustration", "asset", "icon-pop", "chart", "panel"):
            ev.append((at + 0.12, "pop", a["id"], round(off + 0.12, 3)))
    ev.sort(key=lambda e: (e[0], -PRIO[e[1]]))
    keep = []
    for e in ev:
        if keep and e[0] - keep[-1][0] < 1.0:
            if PRIO[e[1]] > PRIO[keep[-1][1]]:
                keep[-1] = e
            continue
        keep.append(e)
    dur = float(t.get("duration") or vis[-1]["end"])
    cap = max(2, int(dur / 6))
    if len(keep) > cap:
        keep = sorted(sorted(keep, key=lambda e: -PRIO[e[1]])[:cap], key=lambda e: e[0])
    _pk.memo.clear(); _pk.cnt.clear()
    _seed = zlib.crc32(str((vis[0].get("narration") or vis[0].get("id") or "") + str(len(vis))).encode())
    old = [s for s in tr.get("sfx") or [] if not str(s.get("id", "")).startswith("gs")]
    new = [{"id": "gs%d" % (n + 1), "src": _pk(e[1], n, _seed)[0], "at": round(max(0.0, e[0]), 3), "volume": round(VOL[e[1]] * _pk(e[1], n, _seed)[1], 3), "anchor": e[2], "offset": round(e[3], 3)}
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
