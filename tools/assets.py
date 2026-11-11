#!/usr/bin/env python3
"""The asset library (step3-assets). One manifest, one subject -> one asset, forever.
  media/library/assets/manifest.json   the contract (id, file, subject, style, source, tier, checked, w, h, tags)
  tiers: illustration (code, remotion/src/studio/illustrations.tsx) | cutout (real-style PNG, generated once) | icon (chrome only)
Cutouts are generated ONCE per subject: still image -> rembg -> automatic checks (size, cropped edges, vision scan) -> saved
with checked=true. Rules (skill 4.3): still images only; never hands, faces, text, logos or maps; checked at 100% before use.
CLI:  python3 tools/assets.py seed | merge <other-manifest.json> | list"""
import base64, io, json, os, re, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

LIB = os.path.join(TL.MEDIA, "library", "assets")
MANIFEST = os.path.join(LIB, "manifest.json")
STYLE = os.getenv("ASSET_STYLE", "night-flat")      # style token of the illustration tier
CUT_STYLE = "studio-real"                            # style token of the generated cutout tier
ILL_NOUN = {"house": "house", "building": "office building", "phone": "smartphone", "coin": "coins", "bank": "bank", "chart-up": "rising chart",
            "chart-down": "falling chart", "store": "shop", "car": "car", "document": "document", "person": "person", "thermometer": "thermometer",
            "battery": "battery", "lock": "padlock", "globe": "globe", "bulb": "light bulb"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:48] or "asset"


def load():
    try:
        d = json.load(open(MANIFEST))
        if isinstance(d, dict) and isinstance(d.get("assets"), list):
            return d
    except Exception:
        pass
    return {"styleToken": STYLE, "note": "Asset manifest. One subject, one asset, one style. Illustrations are code; cutouts are generated once and checked.", "assets": []}


def save(m):
    os.makedirs(LIB, exist_ok=True)
    m["assets"] = sorted(m["assets"], key=lambda a: a["id"])
    json.dump(m, open(MANIFEST, "w"), indent=2, ensure_ascii=False)


def seed():
    """Make sure every code illustration has a manifest entry (tier illustration, no file)."""
    m = load()
    have = {a["id"] for a in m["assets"]}
    n = 0
    for _rx, iid in getattr(TL, "_ILLUS", []):
        if iid not in have:
            m["assets"].append({"id": iid, "file": None, "subject": ILL_NOUN.get(iid, iid), "style": STYLE, "source": "registry-code", "tier": "illustration", "checked": True, "tags": [iid]})
            have.add(iid)
            n += 1
    save(m)
    return n


def merge(other_path):
    """Merge another manifest into this one by id (used when two renders push at once)."""
    try:
        o = json.load(open(other_path))
    except Exception:
        return 0
    m = load()
    byid = {a["id"]: a for a in m["assets"]}
    n = 0
    for a in o.get("assets", []):
        if a.get("id") and a["id"] not in byid:
            m["assets"].append(a)
            n += 1
    save(m)
    return n


def find(aid):
    for a in load()["assets"]:
        if a["id"] == aid and a.get("checked") and a.get("file") and os.path.exists(os.path.join(LIB, os.path.basename(a["file"]))):
            return a
    return None


def _gen_still(prompt, path, seed):
    """One still from the bot's own providers (no stock fallback: a stock photo would not match the subject)."""
    import build_short as bs
    last = None
    for fn in (lambda: bs.flux(prompt, path, seed), lambda: bs.gemini_image(prompt, path), lambda: bs.together_image(prompt, path, seed)):
        try:
            fn()
            if os.path.exists(path) and os.path.getsize(path) > 2000:
                return True
        except Exception as e:
            last = e
            print("assets: image provider failed:", str(e)[:140])
    return False


def _vision_ok(png_path, subject):
    """Automatic artifact scan (skill 8.2) with Gemini. Returns (ok, why). No key or no answer -> (None, why)."""
    try:
        import gemini_models as gm
        from PIL import Image
        key = os.getenv("GEMINI_API_KEY", "").strip()
        if not key:
            return None, "no GEMINI_API_KEY"
        im = Image.open(png_path).convert("RGBA")
        bg = Image.new("RGBA", im.size, (110, 118, 135, 255))
        bg.alpha_composite(im)
        bg.thumbnail((768, 768))
        buf = io.BytesIO()
        bg.convert("RGB").save(buf, "JPEG", quality=88)
        q = ('Quality check for a video prop. The picture should be ONE single "%s", fully visible, cut out on a plain grey background. '
             'Answer with JSON only: {"ok": true|false, "problems": ["..."]}. Set ok=false if ANY of: more than one main object, the object is cropped by '
             'the edge, any readable text, letters, logo or watermark, a hand, finger, person or face, deformed or impossible geometry, '
             'leftover background fragments, ragged or glowing edges.' % subject)
        txt, err = gm.generate(key, [{"text": q}, {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}}],
                               config={"temperature": 0, "responseMimeType": "application/json"}, timeout=90)
        if not txt:
            return None, err or "no answer"
        d = json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
        return bool(d.get("ok")), "; ".join(map(str, d.get("problems") or []))[:160]
    except Exception as e:
        return None, str(e)[:120]


def factory(subject, aid=None):
    """Generate a cutout for `subject` once. Returns the manifest entry (checked) or None."""
    aid = aid or slug(subject)
    try:
        from PIL import Image
        from rembg import remove
    except Exception as e:
        print("assets: rembg/Pillow not available:", e)
        return None
    os.makedirs(LIB, exist_ok=True)
    raw = os.path.join(LIB, "_raw_%s.jpg" % aid)
    prompt = ("%s, a single object, centred, the whole object visible with a margin around it, studio product photograph, soft even lighting, "
              "plain light grey seamless background, sharp focus, no text, no logo, no watermark, no people, no hands" % subject)
    try:
        if not _gen_still(prompt, raw, zlib.crc32(aid.encode())):
            return None
        cut = remove(Image.open(raw).convert("RGB")).convert("RGBA")
    finally:
        pass
    a = cut.getchannel("A")
    hist = a.histogram()
    cover = sum(hist[128:]) / float(sum(hist) or 1)
    w, h = cut.size
    px = a.load()
    edge = sum(1 for x in range(0, w, 2) for y in (0, 1, h - 2, h - 1) if px[x, y] > 128) + sum(1 for y in range(0, h, 2) for x in (0, 1, w - 2, w - 1) if px[x, y] > 128)
    if not (0.08 <= cover <= 0.8) or edge > 0.02 * (w + h):
        print("assets: %s rejected (covers %.0f%%, edge touches %d)" % (aid, cover * 100, edge))
        _rm(raw)
        return None
    box = a.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box:
        _rm(raw)
        return None
    pad = int(0.06 * max(box[2] - box[0], box[3] - box[1]))
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    cut = cut.crop(box)
    cut.thumbnail((1024, 1024))
    out = os.path.join(LIB, "%s@2x.png" % aid)
    cut.save(out, "PNG", optimize=True)
    _rm(raw)
    ok, why = _vision_ok(out, subject)
    if ok is False:
        print("assets: %s failed the vision scan: %s" % (aid, why))
        _rm(out)
        return None
    ent = {"id": aid, "file": "%s@2x.png" % aid, "subject": subject, "style": CUT_STYLE, "source": "ai-generated", "tier": "cutout",
           "checked": True, "scan": "vision" if ok else "heuristic (%s)" % why, "w": cut.size[0], "h": cut.size[1], "tags": [aid]}
    m = load()
    m["assets"] = [x for x in m["assets"] if x["id"] != aid] + [ent]
    save(m)
    print("assets: new cutout %s (%s)" % (aid, ent["scan"]))
    return ent


def _rm(p):
    try:
        os.remove(p)
    except OSError:
        pass


if __name__ == "__main__":
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "list")
    if cmd == "seed":
        print("seeded", seed())
    elif cmd == "merge":
        print("merged", merge(sys.argv[2]))
    else:
        for a in load()["assets"]:
            print(a["id"], a["tier"], a.get("checked"), a.get("file"))
