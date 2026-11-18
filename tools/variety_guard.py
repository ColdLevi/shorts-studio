"""No-repeat guard for the director pass: a layer kind may not recur within `window` beats.
Writer-chosen callouts (locked) are never changed or dropped. Nothing is ever dropped."""
import copy

SKIP = {"color-wash", "draw-line"}
SHORT = 12


def _alts(kind, settle):
    if kind in ("kinetic", "settle-title"):
        return ["corner-text"]
    if kind == "corner-text":
        return ["settle-title" if settle else "kinetic"]
    return []


def _convert(layer, new_kind, nth_corner):
    keep = {k: layer[k] for k in ("id", "anchor", "delay", "start", "end") if k in layer}
    keep["kind"] = new_kind
    keep["text"] = layer.get("text", "")
    if new_kind == "corner-text":
        keep["side"] = "tr" if nth_corner % 2 == 1 else "tl"
        keep["y"] = 0.12
    else:
        keep["y"] = 0.14
    return keep


def enforce(layers, beat_ids, locked_ids=(), window=5, settle=False):
    order = {b: i for i, b in enumerate(beat_ids)}
    locked = set(locked_ids)
    out = copy.deepcopy(layers)
    notes, recent, swapped, drop_lines = [], {}, 0, set()
    idxs = sorted(range(len(out)), key=lambda i: (order.get(out[i].get("anchor"), 10 ** 6), i))
    for i in idxs:
        L = out[i]
        kind, anchor = L.get("kind"), L.get("anchor")
        if kind in SKIP or anchor not in order:
            continue
        b = order[anchor]
        last = recent.get(kind)
        clash = last is not None and last != b and (b - last) < window
        if clash and anchor not in locked:
            done = False
            for alt in _alts(kind, settle):
                la = recent.get(alt)
                if alt == "corner-text" and len(str(L.get("text", ""))) > SHORT:
                    continue
                if la is not None and la != b and (b - la) < window:
                    continue
                swapped += 1
                out[i] = _convert(L, alt, swapped)
                if kind == "kinetic":
                    drop_lines.add(anchor)
                notes.append("Beat %d: %s would repeat %s from beat %d, so I used %s instead." % (b + 1, kind, kind, last + 1, alt))
                kind, done = alt, True
                break
            if not done:
                notes.append("Beat %d: %s repeats beat %d and has no alternative here, so I kept it." % (b + 1, kind, last + 1))
        recent[kind] = b
    if drop_lines:
        out = [x for x in out if not (x.get("kind") == "draw-line" and x.get("anchor") in drop_lines)]
    return out, notes
