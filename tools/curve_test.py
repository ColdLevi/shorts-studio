import copy, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import curve_pass as cp
menu = set(json.load(open(os.path.join(HERE, "motion_curves.json")))["curves"]) - {"custom"}
bad = []
def chk(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        bad.append(name)
def mk():
    return [{"id": "ly1", "kind": "color-wash", "anchor": "a", "start": 0, "end": 4},
            {"id": "ly2", "kind": "callout", "anchor": "a", "start": 0.15, "end": 4},
            {"id": "ly3", "kind": "icon", "anchor": "b", "start": 4.15, "end": 8},
            {"id": "ly4", "kind": "callout", "anchor": "c", "start": 8, "end": 8.8},
            {"id": "ly5", "kind": "callout", "anchor": "d", "start": 9, "end": 13, "keyframes": [{"t": 0, "values": {"opacity": 1}}]}]
src = mk()
L, n = cp.apply(copy.deepcopy(src), {}, "t1")
chk("wash untouched", "keyframes" not in L[0])
chk("short layer untouched", "keyframes" not in L[3])
chk("script keyframes untouched", L[4]["keyframes"] == src[4]["keyframes"])
chk("callout animated", bool(L[1].get("keyframes")))
ok = True
for l in (L[1], L[2]):
    dur = l["end"] - l["start"]
    ts = [k["t"] for k in l["keyframes"]]
    ok = ok and ts == sorted(ts) and ts[0] == 0 and ts[-1] <= round(dur, 2)
    ok = ok and all(k.get("ease", "linear") in menu for k in l["keyframes"])
chk("keyframes ordered, inside the layer, curves from the menu", ok)
chk("hook layer is the only out-quint", L[1]["keyframes"][0]["ease"] == "out-quint" and L[2]["keyframes"][0]["ease"] != "out-quint")
L2, _ = cp.apply(copy.deepcopy(src), {}, "t1")
chk("deterministic", L == L2)
L3, n3 = cp.apply(copy.deepcopy(src), {"curves": "off"}, "t1")
chk("off switch", all("keyframes" not in x for x in L3[:4]))
chk("no bounce without light tone", "bounce-soft" not in json.dumps(L))
many = [{"id": "m%d" % i, "kind": "icon", "anchor": "s", "start": i * 0.1, "end": 5} for i in range(5)]
L4, _ = cp.apply(many, {"tone": "light"}, "t2")
chk("at most one bounce per scene", json.dumps(L4).count("bounce-soft") <= 1)
print(n[0])
sys.exit(1 if bad else 0)
