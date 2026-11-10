import sys, shutil
P = "tools/build_short.py"
dry = "--dry-run" in sys.argv
s = open(P, encoding="utf-8").read()
BLOCK = r'''STOCK_STOP = set("a an the of in on at to and with for from by is are was were be as it its this that these those very highly detailed cinematic illustration style digital art painting photo photograph render rendering lighting light shot view close closeup wide angle background high quality ultra realistic vertical portrait composition subject centered".split())


def _stock_query(prompt, query=""):
    q = (query or "").strip()
    if not q:
        words = [w for w in re.findall(r"[A-Za-z]+", prompt or "") if w.lower() not in STOCK_STOP and len(w) > 2]
        q = " ".join(words[:5])
    return q[:80] or "abstract background"


def stock_photo(prompt, path, seed=0, query=""):
    """Last-resort still: a free Pexels / Pixabay photo that matches the beat's keywords."""
    import urllib.parse
    q = _stock_query(prompt, query)
    portrait = CV["height"] >= CV["width"]
    pex, pix = os.getenv("PEXELS_API_KEY", "").strip(), os.getenv("PIXABAY_API_KEY", "").strip()
    urls, errs = [], []
    if pex:
        try:
            u = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": q, "per_page": 8, "orientation": "portrait" if portrait else "landscape"})
            r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": pex, "User-Agent": "shorts-studio/1.0"}), timeout=30))
            urls += [p["src"].get("large2x") or p["src"].get("large") or p["src"]["original"] for p in r.get("photos", [])]
        except Exception as e:
            errs.append("pexels: %s" % str(e)[:80])
    if pix:
        try:
            u = "https://pixabay.com/api/?" + urllib.parse.urlencode({"key": pix, "q": q, "image_type": "photo", "orientation": "vertical" if portrait else "horizontal", "per_page": 8, "safesearch": "true"})
            r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "shorts-studio/1.0"}), timeout=30))
            urls += [h.get("largeImageURL") or h["webformatURL"] for h in r.get("hits", [])]
        except Exception as e:
            errs.append("pixabay: %s" % str(e)[:80])
    if not urls:
        raise RuntimeError("stock photo: nothing for '%s' (%s)" % (q, "; ".join(errs) or "no results"))
    for k in range(min(len(urls), 4)):
        try:
            data = urllib.request.urlopen(urllib.request.Request(urls[(seed + k) % len(urls)], headers={"User-Agent": "shorts-studio/1.0"}), timeout=60).read()
            if len(data) < 5000:
                continue
            _save_image(data, path)
            return True
        except Exception as e:
            errs.append(str(e)[:80])
    raise RuntimeError("stock photo download failed: %s" % "; ".join(errs))


def paint(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0, query=""):
    """Paint a still; if every image provider fails, fall back to a stock photo before giving up."""
    try:
        return _paint_inner(prompt, path, tool, style, hero=hero, gemini_ok=gemini_ok, seed=seed)
    except Exception as e:
        try:
            stock_photo(prompt, path, seed, query)
        except Exception as g:
            print("stock photo fallback", g)
            _FB_ERR.append("stock: " + str(g)[:100])
            raise e
        if not USAGE.get("stock_photos"):
            USAGE["stock_photos"] = 0
            tg("🖼 The AI image quota is out, so I'm using free stock photos for the pictures that couldn't be painted.")
        USAGE["stock_photos"] += 1
        print("stock photo fallback ok")
        return {"pixel": False}


'''
edits = [
 ('def paint(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0):', 'def _paint_inner(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0):'),
 ("PAID_NOTES = []", BLOCK + "PAID_NOTES = []"),
 ('seed=1000 + i)["pixel"]', 'seed=1000 + i, query=b.get("query") or "")["pixel"]'),
]
for a, b in edits:
    n = s.count(a)
    if n != 1:
        sys.exit("ANCHOR MISMATCH (%d matches): %s" % (n, a[:60]))
    s = s.replace(a, b)
compile(s, P, "exec")
print("ok: 3 edits, syntax fine")
if not dry:
    shutil.copy(P, P + ".bak-stockphoto")
    open(P, "w", encoding="utf-8").write(s)
    print("written")
