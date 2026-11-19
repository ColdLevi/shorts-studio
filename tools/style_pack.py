"""Style packs: one folder per style, styles/<id>/pack.json + sounds/ + refs.json.
CLI: python3 tools/style_pack.py list | validate <id> | init <id> <legacy-id>
Numbers are never invented: unmeasured values are the text 'not measured: <reason>'."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLES = os.path.join(ROOT, "styles")
REQUIRED = ["pack_version", "id", "name", "look", "motion", "pacing", "sounds"]


def pack_dir(pid):
    return os.path.join(STYLES, pid)


def load_pack(pid):
    p = os.path.join(pack_dir(pid), "pack.json")
    if not os.path.isfile(p):
        return None
    with open(p) as f:
        return json.load(f)


def list_packs():
    out = []
    try:
        for n in sorted(os.listdir(STYLES)):
            if os.path.isfile(os.path.join(STYLES, n, "pack.json")):
                out.append(n)
    except OSError:
        pass
    return out


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _measured_ok(v):
    if _num(v):
        return True
    if isinstance(v, str):
        return v.startswith("not measured:")
    if isinstance(v, list) and v:
        return all(_num(x) for x in v)
    return False


def validate_pack(p):
    errors, warnings = [], []
    for k in REQUIRED:
        if k not in p:
            errors.append("missing key: " + k)
    if errors:
        return errors, warnings
    if p["sounds"].get("mode") not in ("pack-only", "mixed"):
        errors.append("sounds.mode must be pack-only or mixed")
    if not _measured_ok(p["pacing"].get("beat_seconds")):
        errors.append("pacing.beat_seconds must be a number or 'not measured: reason'")
    recipes = p["motion"].get("recipes", [])
    if not recipes:
        warnings.append("no measured recipes yet (motion.recipes is empty)")
    seen = set()
    for r in recipes:
        rid = r.get("id")
        if not rid or rid in seen:
            errors.append("recipe id missing or duplicated: %r" % (rid,))
        seen.add(rid)
        if r.get("fps") != 30:
            errors.append("recipe %s: fps must be 30" % rid)
        for k in ("duration_frames", "easing"):
            if not _measured_ok(r.get(k)):
                errors.append("recipe %s: %s must be measured or 'not measured: reason'" % (rid, k))
    return errors, warnings


def init_from_legacy(pid, src):
    lp = os.path.join(STYLES, src + ".json")
    with open(lp) as f:
        old = json.load(f)
    d = pack_dir(pid)
    if os.path.exists(os.path.join(d, "pack.json")):
        raise SystemExit("pack already exists: " + pid)
    tok = old.get("style_tokens") or {}
    pack = {
        "pack_version": 1,
        "id": pid,
        "name": old.get("name") or pid,
        "summary": old.get("summary", ""),
        "look": {k: tok.get(k) for k in ("caption", "font", "backdrop", "grade", "accent", "palette")},
        "motion": {"base": old.get("base"), "transitions": tok.get("transitions", []),
                   "motion": tok.get("motion"), "recipes": []},
        "pacing": {"beat_seconds": "not measured: legacy loose summary says %s" % old.get("beat_seconds"),
                   "graphic_ratio": "not measured: legacy loose summary says %s" % old.get("graphic_ratio")},
        "sounds": {"mode": "pack-only", "roles": {}},
        "legacy": old,
    }
    os.makedirs(os.path.join(d, "sounds"), exist_ok=True)
    with open(os.path.join(d, "pack.json"), "w") as f:
        json.dump(pack, f, indent=2)
    with open(os.path.join(d, "refs.json"), "w") as f:
        json.dump({"refs": [], "licence_note": "unconfirmed: owner has not said these clips are his own or licensed"}, f, indent=2)
    return pack


def main(argv):
    if len(argv) >= 2 and argv[1] == "list":
        print("\n".join(list_packs()) or "(no packs)")
    elif len(argv) >= 3 and argv[1] == "validate":
        p = load_pack(argv[2])
        if p is None:
            raise SystemExit("no such pack: " + argv[2])
        e, w = validate_pack(p)
        for x in e:
            print("ERROR:", x)
        for x in w:
            print("WARN:", x)
        print("problems: %d, warnings: %d" % (len(e), len(w)))
        raise SystemExit(1 if e else 0)
    elif len(argv) >= 4 and argv[1] == "init":
        init_from_legacy(argv[2], argv[3])
        print("created styles/%s/pack.json" % argv[2])
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
