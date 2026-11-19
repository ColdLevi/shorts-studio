"""curve_pass.py: gives director layers pro easing curves as layer-local keyframes.
Menu-driven: every curve name comes from tools/motion_curves.json and is checked against its menu.
Script directions win: a layer that already carries keyframes is never touched.
Renderer: Layers.tsx LayerStack already runs evaluateKeyframes on layer.keyframes (seconds from layer start).
Only opacity and scale are animated, so no layout units are involved."""
import json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP_KINDS = ("color-wash",)
POP_HINTS = ("icon", "callout", "sticker", "badge", "stat", "number")
LIGHT = ("light", "fun", "funny", "playful", "upbeat")
START_SCALE = {"entrance": 0.92, "pop": 0.78, "emphasis": 0.7}

def _off(spec):
    return str((spec or {}).get("curves", "")).lower() in ("off", "none", "false") or os.environ.get("STUDIO_CURVES", "").lower() == "off"

def apply(layers, spec=None, seed="job"):
    spec = spec or {}
    if _off(spec):
        return layers, ["Curves: off."]
    try:
        with open(os.path.join(HERE, "motion_curves.json")) as f:
            d = json.load(f)
        menu = set(d["curves"].keys()) - {"custom"}
        roles = d["roles"]
    except Exception as e:
        return layers, ["Curves skipped: could not read motion_curves.json (%s)." % e]
    rnd = random.Random(str(seed))
    light = str(spec.get("tone") or "").lower() in LIGHT
    bounced, used, left = set(), {}, 0
    ex = roles.get("exit") or {}
    ecurve = ex.get("curve")
    for i, l in enumerate(layers):
        kind = str(l.get("kind") or "")
        try:
            dur = float(l["end"]) - float(l["start"])
        except (KeyError, TypeError, ValueError):
            left += 1
            continue
        if kind in SKIP_KINDS or l.get("keyframes") or dur < 1.0:
            left += 1
            continue
        role = "pop" if any(h in kind for h in POP_HINTS) else "entrance"
        first = not used
        if first:
            role = "entrance"
        elif role == "pop" and light and l.get("anchor") not in bounced:
            role = "emphasis"
        r = roles.get(role) or {}
        curve = r.get("hero") if (first and r.get("hero")) else r.get("curve")
        if curve not in menu or ecurve not in menu:
            left += 1
            continue
        if role == "emphasis":
            bounced.add(l.get("anchor"))
        lo, hi = r.get("seconds", [0.4, 0.6])
        t_in = round(min(lo + (hi - lo) * rnd.random(), dur * 0.5), 2)
        elo, ehi = ex.get("seconds", [0.25, 0.35])
        t_out = round(elo + (ehi - elo) * rnd.random(), 2)
        kf = [{"t": 0, "values": {"opacity": 0, "scale": START_SCALE[role]}, "ease": curve},
              {"t": t_in, "values": {"opacity": 1, "scale": 1}, "ease": "linear"}]
        if dur >= t_in + t_out + 0.4:
            kf.append({"t": round(dur - t_out, 2), "values": {"opacity": 1, "scale": 1}, "ease": ecurve})
            kf.append({"t": round(dur, 2), "values": {"opacity": 0, "scale": 0.97}})
        l["keyframes"] = kf
        key = "%s %s" % (role, curve)
        used[key] = used.get(key, 0) + 1
    if not used:
        return layers, ["Curves: nothing to animate (%d layer(s) left alone)." % left]
    parts = ", ".join("%s x%d" % (k, v) for k, v in sorted(used.items()))
    return layers, ["Curves: %s; %d layer(s) left alone (washes, short layers, or script-set motion)." % (parts, left)]
