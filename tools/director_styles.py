"""Directing styles for director_pass: varies layer density, hook treatment and callout look per video.
Deterministic per project id (re-renders and /undo stay stable). Optional spec keys:
  director_style: force one style by name
  recent_styles:  list of the last styles used (newest last); the last two are avoided
  variation_seed: change it to get a different plan for the same project
"""
import random

# Knobs consumed by director_pass:
#   gap_mul      spacing between layers (smaller = busier)
#   callout_mul  / icon_mul  scale the caps on callouts / icons
#   hook         behind (text behind the subject cutout, else top band) | top (always top band) | quiet (no hook text)
#   wash         opacity of the soft colour wash on the hook beat
#   callout      mixed (alternate corner / big + underline) | corner | underline | plain (big text, no underline)
STYLES = {
    "classic":      dict(blurb="the standard plan", gap_mul=1.0, callout_mul=1.0, icon_mul=1.0, hook="behind", wash=0.35, callout="mixed"),
    "restrained":   dict(blurb="few layers, lots of air", gap_mul=1.5, callout_mul=0.6, icon_mul=0.5, hook="top", wash=0.2, callout="plain"),
    "kinetic":      dict(blurb="busy and punchy", gap_mul=0.6, callout_mul=1.6, icon_mul=1.3, hook="behind", wash=0.5, callout="mixed"),
    "editorial":    dict(blurb="corner type and clean top lines", gap_mul=1.0, callout_mul=1.2, icon_mul=0.8, hook="top", wash=0.25, callout="corner"),
    "cold-open":    dict(blurb="opens quiet and lets the picture speak", gap_mul=1.2, callout_mul=1.0, icon_mul=0.8, hook="quiet", wash=0.15, callout="underline"),
    "data-forward": dict(blurb="numbers first", gap_mul=0.8, callout_mul=1.8, icon_mul=0.6, hook="top", wash=0.3, callout="underline"),
}
DEFAULT = dict(STYLES["classic"], name="classic")   # exactly what director_pass did before styles existed

_W_DEFAULT = {"classic": 1.5, "restrained": 1, "kinetic": 1, "editorial": 1, "cold-open": 1, "data-forward": 1}
WEIGHTS = {
    "documentary":      {"classic": 2, "restrained": 2, "editorial": 1.5, "cold-open": 2, "data-forward": 0.5, "kinetic": 0},
    "cinematic":        {"classic": 1, "restrained": 2, "editorial": 1, "cold-open": 3, "data-forward": 0, "kinetic": 0},
    "stop-motion":      {"classic": 2, "restrained": 2, "editorial": 1, "cold-open": 2, "data-forward": 0, "kinetic": 0},
    "kinetic-news":     {"classic": 1, "restrained": 0, "editorial": 1, "cold-open": 0, "data-forward": 3, "kinetic": 3},
    "motion-explainer": {"classic": 2, "restrained": 1, "editorial": 2, "cold-open": 0.5, "data-forward": 2, "kinetic": 1},
    "blueprint":        {"classic": 2, "restrained": 1, "editorial": 2, "cold-open": 0.5, "data-forward": 2, "kinetic": 1},
    "bold-pop":         {"classic": 1.5, "restrained": 0, "editorial": 1.5, "cold-open": 0, "data-forward": 1, "kinetic": 3},
}


def pick(t, spec=None):
    spec = spec or {}
    forced = str(spec.get("director_style") or "").strip().lower()
    if forced in STYLES:
        return dict(STYLES[forced], name=forced)
    recipe = str((t.get("style") or {}).get("recipe") or "")
    w = dict(WEIGHTS.get(recipe, _W_DEFAULT))
    recent = [str(x) for x in (spec.get("recent_styles") or [])][-2:]
    avoided = {k: w[k] for k in recent if k in w}
    for k in avoided:
        w[k] = 0
    if sum(w.values()) <= 0:                       # never end up with nothing to choose
        w = dict(WEIGHTS.get(recipe, _W_DEFAULT))
    rng = random.Random("%s|%s" % (t.get("id"), spec.get("variation_seed", 0)))
    names = sorted(w)
    total = sum(w[n] for n in names)
    x = rng.random() * total
    for n in names:
        x -= w[n]
        if x < 0 and w[n] > 0:
            return dict(STYLES[n], name=n)
    return dict(STYLES["classic"], name="classic")
