"""Text motion: seeded entrance animations (keyframes) for the director's own text layers.

The renderer (remotion/src/studio/Layers.tsx) already animates any layer that carries `keyframes`
({t seconds from layer start, values{x,y in % of the frame, scale, opacity...}, ease}). Nothing wrote them.
This pass adds a short entrance to text-only layers (corner-text, kinetic) and nothing else.

Safe by design:
  * never touches depth-text (its wrapper also holds the subject cutout), charts, panels, cards
  * never overwrites a layer that already has keyframes (idempotent)
  * any bad layer is skipped, never raises out of animate_text_layers
  * off switches: env STUDIO_TEXT_MOTION=off, or spec["text_motion"] == "off"
  * seeded like director_styles: same project + variation_seed gives the same plan

CLI (read-only unless --write):
  python tools/text_motion.py --scan                      # which saved projects have eligible layers
  python tools/text_motion.py media/projects/<id>/timeline.json          # print the plan
  python tools/text_motion.py media/projects/<id>/timeline.json --write /tmp/copy.json
"""
import json
import os
import random
import sys

TEXT_KINDS = ("corner-text", "kinetic")
MIN_SECONDS = 0.8

# Every recipe: list of keyframes, t = seconds from the layer's own start, x/y in percent of the frame.
RECIPES = {
    "slide-up":   [{"t": 0.0, "values": {"opacity": 0, "y": 7}},
                   {"t": 0.35, "values": {"opacity": 1, "y": 0}}],
    "fade-rise":  [{"t": 0.0, "values": {"opacity": 0, "y": 3}},
                   {"t": 0.5, "values": {"opacity": 1, "y": 0}}],
    "scale-pop":  [{"t": 0.0, "values": {"opacity": 0, "scale": 0.85}},
                   {"t": 0.3, "values": {"opacity": 1, "scale": 1}}],
    "slide-left": [{"t": 0.0, "values": {"opacity": 0, "x": 8}},
                   {"t": 0.35, "values": {"opacity": 1, "x": 0}}],
    "slide-right": [{"t": 0.0, "values": {"opacity": 0, "x": -8}},
                    {"t": 0.35, "values": {"opacity": 1, "x": 0}}],
}
EASE = {"scale-pop": "back-out"}


def _frames(name):
    ease = EASE.get(name, "ease-out")
    return [dict(kf, values=dict(kf["values"]), ease=ease) for kf in RECIPES[name]]


def _off(spec):
    if str(os.environ.get("STUDIO_TEXT_MOTION", "")).lower() == "off":
        return True
    return isinstance(spec, dict) and str(spec.get("text_motion", "")).lower() == "off"


def plan(t, spec=None):
    """Return [(layer, recipe_name)] without changing anything."""
    spec = spec if isinstance(spec, dict) else {}
    if _off(spec) or not isinstance(t, dict):
        return []
    layers = (t.get("tracks") or {}).get("layers") if isinstance(t.get("tracks"), dict) else None
    if not isinstance(layers, list):
        return []
    rng = random.Random("%s|textmotion|%s" % (t.get("id"), spec.get("variation_seed", 0)))
    pool = rng.sample(sorted(RECIPES), rng.choice((2, 3)))   # a small vocabulary per video
    out, last = [], None
    for l in layers:
        try:
            if not isinstance(l, dict) or l.get("kind") not in TEXT_KINDS or l.get("keyframes"):
                continue
            if float(l["end"]) - float(l["start"]) < MIN_SECONDS:
                continue
        except Exception:
            continue
        choices = [r for r in pool if r != last] or pool
        last = rng.choice(choices)
        out.append((l, last))
    return out


def animate_text_layers(t, spec=None):
    """Add keyframes to eligible text layers. Returns how many layers were animated."""
    n = 0
    try:
        for l, name in plan(t, spec):
            l["keyframes"] = _frames(name)
            n += 1
    except Exception:
        return n
    return n


def _scan():
    import glob
    rows = []
    for f in sorted(glob.glob("media/projects/*/timeline.json")):
        try:
            t = json.load(open(f))
            p = plan(t)
            kinds = {}
            for l, _ in p:
                kinds[l["kind"]] = kinds.get(l["kind"], 0) + 1
            if p:
                rows.append((f, len(p), kinds))
        except Exception:
            continue
    for f, n, k in rows[-12:]:
        print("%3d eligible  %s  %s" % (n, f, k))
    print("projects with eligible layers: %d" % len(rows))


def main(argv):
    if "--scan" in argv:
        return _scan()
    paths = [a for a in argv if a.endswith(".json") and not a.startswith("--")]
    if not paths:
        print(__doc__); return
    t = json.load(open(paths[0]))
    p = plan(t)
    for l, name in p:
        print("%-12s %-12s %5.2f-%5.2f  %s" % (l.get("id"), l.get("kind"), float(l["start"]), float(l["end"]), name))
    print("would animate %d layer(s); nothing written" % len(p))
    if "--write" in argv:
        out = argv[argv.index("--write") + 1]
        animate_text_layers(t)
        json.dump(t, open(out, "w"))
        print("wrote copy:", out)


if __name__ == "__main__":
    main(sys.argv[1:])
