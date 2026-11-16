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
for _s in STYLES.values():
    _s["spoken"] = True              # also catch spelled-out years ("nineteen eighty-five" -> 1985) as callouts
STYLES["classic"]["spoken"] = False  # classic stays exactly as before
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


# ---------------------------------------------------------------- spelled-out years
import re as _re
_C = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
      "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_UNITS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
_TEENS = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
          "seventeen": 17, "eighteen": 18, "nineteen": 19}
_YEAR_RX = _re.compile(
    r"\b(%s)[ ]+(?:oh[ -](%s)|(%s)(?:[ -](%s))?|(%s)|(hundred))\b" % (
        "|".join(_C), "|".join(_UNITS), "|".join(_TENS), "|".join(_UNITS), "|".join(_TEENS)), _re.I)


def spoken_fact(text):
    """First spelled-out year in the text as digits ("nineteen eighty-five" -> "1985"), else ""."""
    for m in _YEAR_RX.finditer(text or ""):
        c = _C[m.group(1).lower()]
        if m.group(2):
            rest = _UNITS[m.group(2).lower()]
        elif m.group(3):
            rest = _TENS[m.group(3).lower()] + (_UNITS[m.group(4).lower()] if m.group(4) else 0)
        elif m.group(5):
            rest = _TEENS[m.group(5).lower()]
        else:
            rest = 0
        return str(c * 100 + rest)
    return ""


# ---------------------------------------------------------------- camera styles
# Knobs consumed by camera_pass:
#   orbit_every/phase  a cutout picture orbits when i % every == phase
#   truck_every/phase  a picture trucks when i % every == phase
#   base               baseline moves cycled by picture index (classic: just drift)
#   amp_mul            scales move amplitude
#   whips              max whip transitions in the video
#   pt_mod             push-through every Nth sentence-end change (1 = always, 2 = every other, 3 = rarer); others carry/settle
#   last_opts          move for the final picture (one is chosen per project)
CAMERA_STYLES = {
    "classic":       dict(blurb="the standard camera", orbit_every=3, truck_every=4, base=["drift"], amp_mul=1.0, whips=2, pt_mod=2, last_opts=["pull-out"]),
    "steady":        dict(blurb="calm and mostly still", orbit_every=4, truck_every=5, base=["drift", "push-in"], amp_mul=0.85, whips=0, pt_mod=3, last_opts=["pull-out", "hold"]),
    "observational": dict(blurb="slow push-ins, like watching", orbit_every=5, truck_every=5, base=["push-in", "drift"], amp_mul=0.9, whips=0, pt_mod=3, last_opts=["push-in", "pull-out"]),
    "restless":      dict(blurb="side moves and quick changes", orbit_every=2, truck_every=3, base=["truck", "drift"], amp_mul=1.2, whips=3, pt_mod=1, last_opts=["pull-out", "push-in"]),
    "sweep":         dict(blurb="big, flowing moves", orbit_every=3, truck_every=5, base=["drift", "truck", "push-in"], amp_mul=1.1, whips=1, pt_mod=2, last_opts=["pull-out"]),
}
CAM_WEIGHTS = {
    "documentary":      {"classic": 2, "steady": 2, "observational": 2.5, "restless": 0, "sweep": 1.5},
    "cinematic":        {"classic": 1, "steady": 1.5, "observational": 2, "restless": 0, "sweep": 3},
    "stop-motion":      {"classic": 2, "steady": 2, "observational": 1, "restless": 0, "sweep": 1},
    "kinetic-news":     {"classic": 1, "steady": 0, "observational": 0, "restless": 3, "sweep": 1},
    "motion-explainer": {"classic": 2, "steady": 1.5, "observational": 1, "restless": 1.5, "sweep": 1},
    "blueprint":        {"classic": 2, "steady": 1.5, "observational": 1, "restless": 1, "sweep": 1},
    "bold-pop":         {"classic": 1.5, "steady": 0, "observational": 0, "restless": 3, "sweep": 1.5},
}
_CW_DEFAULT = {"classic": 1.5, "steady": 1, "observational": 1, "restless": 1, "sweep": 1}


def pick_camera(t, spec=None):
    spec = spec or {}
    forced = str(spec.get("camera_style") or "").strip().lower()
    recipe = str((t.get("style") or {}).get("recipe") or "")
    rng = random.Random("%s|cam|%s" % (t.get("id"), spec.get("variation_seed", 0)))
    if forced in CAMERA_STYLES:
        name = forced
    else:
        w = dict(CAM_WEIGHTS.get(recipe, _CW_DEFAULT))
        for k in [str(x) for x in (spec.get("recent_camera") or [])][-2:]:
            if k in w:
                w[k] = 0
        if sum(w.values()) <= 0:
            w = dict(CAM_WEIGHTS.get(recipe, _CW_DEFAULT))
        names = sorted(w)
        x = rng.random() * sum(w[n] for n in names)
        name = "classic"
        for n in names:
            x -= w[n]
            if x < 0 and w[n] > 0:
                name = n
                break
    c = dict(CAMERA_STYLES[name], name=name)
    c["orbit_phase"] = 0 if name == "classic" else rng.randrange(c["orbit_every"])
    c["truck_phase"] = 2 if name == "classic" else rng.randrange(c["truck_every"])
    if name == "classic":
        c["orbit_phase"], c["truck_phase"] = 0, 2
    c["last"] = c["last_opts"][rng.randrange(len(c["last_opts"]))]
    c["base"] = list(c["base"])
    return c
