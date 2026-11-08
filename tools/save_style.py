#!/usr/bin/env python3
"""Save the learned style into the repo's durable style store. (style-fix)
Usage: python3 tools/save_style.py [style.json]      (default: job/ref/style.json)
Writes styles/<id>.json and rebuilds styles/index.json (bot + renderer read this)."""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "styles")


def _load(p):
    with open(p) as f:
        return json.load(f)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "job", "ref", "style.json")
    st = _load(src)
    base = re.sub(r"[^a-z0-9-]+", "-", (st.get("name") or "style").lower()).strip("-")[:40] or "style"
    os.makedirs(DIR, exist_ok=True)
    sid, n = base, 2
    while os.path.exists(os.path.join(DIR, sid + ".json")):
        try:
            old = _load(os.path.join(DIR, sid + ".json"))
            if old.get("summary") == st.get("summary") and old.get("style_tokens") == st.get("style_tokens"):
                sid = old.get("id") or sid
                break  # identical style already saved
        except Exception:
            pass
        sid = f"{base}-{n}"
        n += 1
    st["id"] = sid
    st.setdefault("learned_at", int(time.time() * 1000))
    with open(os.path.join(DIR, sid + ".json"), "w") as f:
        json.dump(st, f, indent=2)
    idx = {}
    for f in sorted(os.listdir(DIR)):
        if f.endswith(".json") and f != "index.json":
            try:
                d = _load(os.path.join(DIR, f))
                idx[d.get("id") or f[:-5]] = {"name": d.get("name") or f[:-5], "base": d.get("base", ""),
                                              "summary": (d.get("summary") or "")[:140],
                                              "learned_at": d.get("learned_at", 0)}
            except Exception:
                pass
    with open(os.path.join(DIR, "index.json"), "w") as f:
        json.dump({"styles": idx}, f, indent=2)
    print(f"styles/{sid}.json saved ({len(idx)} styles in index)")


if __name__ == "__main__":
    main()
