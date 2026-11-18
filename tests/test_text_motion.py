import copy, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import text_motion as tm


def tl(pid="p1", kinds=("corner-text", "kinetic", "depth-text", "chart", "corner-text")):
    layers = [{"id": "ly%d" % (i + 1), "kind": k, "anchor": "c%d" % i, "start": 1.0 + 3 * i, "end": 3.5 + 3 * i}
              for i, k in enumerate(kinds)]
    return {"id": pid, "tracks": {"layers": layers}}


def test_only_text_kinds_are_animated():
    t = tl(); n = tm.animate_text_layers(t)
    assert n == 3
    for l in t["tracks"]["layers"]:
        assert bool(l.get("keyframes")) == (l["kind"] in ("corner-text", "kinetic"))


def test_depth_text_never_touched():
    t = tl(kinds=("depth-text", "depth-text")); assert tm.animate_text_layers(t) == 0


def test_idempotent():
    t = tl(); tm.animate_text_layers(t); snap = copy.deepcopy(t)
    assert tm.animate_text_layers(t) == 0 and t == snap


def test_existing_keyframes_kept():
    t = tl(kinds=("kinetic",)); kf = [{"t": 0, "values": {"opacity": 0.5}}]
    t["tracks"]["layers"][0]["keyframes"] = kf
    assert tm.animate_text_layers(t) == 0 and t["tracks"]["layers"][0]["keyframes"] == kf


def test_seed_is_deterministic_and_varies():
    a, b = tl("x"), tl("x"); tm.animate_text_layers(a, {"variation_seed": 3}); tm.animate_text_layers(b, {"variation_seed": 3})
    assert a == b
    seen = set()
    for i in range(40):
        t = tl("proj%d" % i); tm.animate_text_layers(t)
        seen.add(tuple(l["keyframes"][0]["values"].get("y", 0) for l in t["tracks"]["layers"] if l.get("keyframes")))
    assert len(seen) > 3


def test_no_same_recipe_twice_in_a_row():
    for i in range(30):
        names = [n for _, n in tm.plan(tl("q%d" % i, kinds=("kinetic",) * 6))]
        assert all(a != b for a, b in zip(names, names[1:]))


def test_kill_switches(monkeypatch):
    assert tm.animate_text_layers(tl(), {"text_motion": "off"}) == 0
    monkeypatch.setenv("STUDIO_TEXT_MOTION", "off")
    assert tm.animate_text_layers(tl()) == 0


def test_short_layers_skipped():
    t = tl(kinds=("kinetic",)); t["tracks"]["layers"][0]["end"] = t["tracks"]["layers"][0]["start"] + 0.5
    assert tm.animate_text_layers(t) == 0


def test_bad_input_never_raises():
    for bad in (None, {}, {"tracks": None}, {"tracks": {"layers": None}}, {"tracks": {"layers": [None, 5, {"kind": "kinetic"}]}}, []):
        tm.animate_text_layers(bad)


def test_keyframes_are_sane():
    for name in tm.RECIPES:
        f = tm._frames(name)
        assert [k["t"] for k in f] == sorted(k["t"] for k in f) and f[0]["t"] == 0
        for k in f:
            v = k["values"]
            assert abs(v.get("x", 0)) <= 15 and abs(v.get("y", 0)) <= 15
            assert 0.7 <= v.get("scale", 1) <= 1.2 and 0 <= v.get("opacity", 1) <= 1
        assert f[-1]["values"].get("opacity") == 1 and f[-1]["values"].get("y", 0) == 0 and f[-1]["values"].get("x", 0) == 0
