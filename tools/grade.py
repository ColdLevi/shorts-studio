#!/usr/bin/env python3
"""Colour grade for the final video. Prints an ffmpeg -vf filter string for this project's style
(prints nothing = no grade). Reads job/spec.json. Usage: python3 tools/grade.py <project_id>
Spec keys: "grade": "off" | {"contrast":1.1,"sat":1.2,"gamma":1,"warm":0.5,"tealshadow":true,"vig":0.4,"grain":5}"""
import json, os, sys

DEFAULT = {"contrast": 1.05, "sat": 1.08, "gamma": 1.0, "warm": 0.0, "tealshadow": False, "vig": 0.3, "grain": 0}
# subtle on purpose: a grade should be felt, not seen
PRESETS = [
    ("what-if", {"contrast": 1.03, "sat": 1.05, "vig": 0.0, "grain": 0}),
    ("whatif", {"contrast": 1.03, "sat": 1.05, "vig": 0.0, "grain": 0}),
    ("retro", {"contrast": 1.06, "sat": 1.2, "warm": 0.6, "vig": 0.5, "grain": 12}),
    ("vhs", {"contrast": 1.06, "sat": 1.2, "warm": 0.6, "vig": 0.5, "grain": 12}),
    ("stop-motion", {"contrast": 1.04, "sat": 1.05, "warm": 0.4, "vig": 0.3, "grain": 6}),
    ("anime", {"contrast": 1.06, "sat": 1.3, "vig": 0.0, "grain": 0}),
    ("cinematic", {"contrast": 1.12, "sat": 0.92, "gamma": 0.97, "warm": 0.5, "tealshadow": True, "vig": 0.6, "grain": 5}),
    ("documentary", {"contrast": 1.05, "sat": 0.95, "warm": 0.2, "vig": 0.4, "grain": 4}),
    ("blueprint", {"contrast": 1.06, "sat": 1.05, "warm": -0.3, "vig": 0.3, "grain": 0}),
    ("motion", {"contrast": 1.06, "sat": 1.08, "vig": 0.3, "grain": 0}),
    ("news", {"contrast": 1.1, "sat": 1.1, "vig": 0.3, "grain": 0}),
    ("vlog", {"contrast": 1.05, "sat": 1.1, "warm": 0.4, "vig": 0.35, "grain": 3}),
    ("bold", {"contrast": 1.1, "sat": 1.25, "vig": 0.35, "grain": 0}),
]

def params(spec):
    g = spec.get("grade")
    if g in ("off", False, 0):
        return None
    p = dict(DEFAULT)
    text = " ".join(str(spec.get(k, "")) for k in ("style_recipe", "style_preset", "learned_style")).lower()
    for key, vals in PRESETS:
        if key in text:
            p.update(vals)
            break
    if isinstance(g, dict):
        p.update({k: v for k, v in g.items() if k in p})
    return p

def build(p):
    f = [f"eq=contrast={p['contrast']:.3f}:saturation={p['sat']:.3f}:gamma={p['gamma']:.3f}"]
    w = float(p["warm"])
    rs, bs, rh, bh = 0.0, 0.0, 0.04 * w, -0.04 * w
    if p["tealshadow"]:
        rs, bs = -0.03, 0.04
    if any(abs(x) > 1e-6 for x in (rs, bs, rh, bh)):
        f.append(f"colorbalance=rs={rs:.3f}:bs={bs:.3f}:rh={rh:.3f}:bh={bh:.3f}")
    if p["vig"] > 0:
        f.append(f"vignette=angle={0.9 - 0.6 * min(1.0, float(p['vig'])):.3f}")
    if p["grain"] > 0:
        f.append(f"noise=alls={int(p['grain'])}:allf=t")
    return ",".join(f)

def main():
    try:
        spec = json.load(open(os.path.join("job", "spec.json"), encoding="utf-8"))
    except Exception:
        spec = {}
    p = params(spec)
    if p:
        print(build(p))

if __name__ == "__main__":
    main()
