#!/usr/bin/env python3
"""Spec (from the Telegram bot) -> voice + word timings + one visual per beat -> a saved project timeline.
Usage: python tools/build_short.py spec.json   (run from the repo root)
Writes media/projects/<id>/timeline.json (rendered by the "Studio" composition), its assets in
media/projects/<id>/assets/, a legacy props.json (StoryShort) and job/project_id.txt.
<id> = spec.project_id, or a slug of the title plus the run number.
Canvas = spec.canvas ("9:16", "16:9", "1:1", "4:5", "1280x720" or {width,height,fps}) or spec.format.
Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (images), TELEGRAM_TOKEN + CHAT_ID (progress, optional)."""
import asyncio, base64, json, os, re, subprocess, sys, textwrap, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL  # noqa: E402

PID = "job"
JOB = "projects/job/assets"           # public path prefix of this project's assets (under media/)
OUT = os.path.join(ROOT, "media", JOB)
CV = TL.canvas("vertical")            # output canvas


def set_project(pid, cv=None):
    """Point asset output at media/projects/<pid>/assets and size images for the canvas."""
    global PID, JOB, OUT, CV, W, H
    PID, JOB = pid, f"projects/{pid}/assets"
    OUT = os.path.join(ROOT, "media", JOB)
    os.makedirs(OUT, exist_ok=True)
    if cv:
        CV = cv
        W, H = TL.gen_size(cv)


def tg(text):
    tok, chat = os.getenv("TELEGRAM_TOKEN"), os.getenv("CHAT_ID")
    if not (tok and chat):
        return
    try:
        urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage",
            data=json.dumps({"chat_id": chat, "text": text, "disable_notification": True}).encode(),
            headers={"Content-Type": "application/json"}), timeout=15)
    except Exception as e:
        print("tg", e)


# ---------- voice ----------
async def _synth(text, voice, rate, out):
    import edge_tts
    try:
        c = edge_tts.Communicate(text, voice=voice, rate=rate, boundary="WordBoundary")
    except TypeError:
        c = edge_tts.Communicate(text, voice=voice, rate=rate)
    words = []
    with open(out, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"word": ch["text"], "start": round(ch["offset"] / 1e7, 3),
                              "end": round((ch["offset"] + ch["duration"]) / 1e7, 3)})
    return words


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def chars(s):
    return len(re.sub(r"[^0-9A-Za-z]", "", s))


def split_beats(beats, words, total):
    """Each beat starts on the exact first word of its slice, a hair before the voice (cuts can land mid-sentence).
    Falls back to the letter-share method when the word counts do not line up."""
    counts = [len(str(b["narration"]).split()) for b in beats]
    if words and all(c > 0 for c in counts) and sum(counts) == len(words):
        starts, k = [], 0
        for c in counts:
            starts.append(float(words[k]["start"]))
            k += c
        starts[0] = 0.0
        for i in range(1, len(starts)):
            starts[i] = max(starts[i - 1] + 0.25, starts[i] - 0.06)
        if starts[-1] < total - 0.2:
            return [{"start": round(starts[i], 3), "end": round(starts[i + 1] if i + 1 < len(starts) else total, 3)} for i in range(len(starts))]
    return _split_beats_letters(beats, words, total)


def _split_beats_letters(beats, words, total):
    """Assign each beat a start/end from the word timings, by share of letters spoken."""
    sizes = [max(1, chars(b["narration"])) for b in beats]
    bounds, acc = [], 0
    for s in sizes[:-1]:
        acc += s
        bounds.append(acc / sum(sizes))
    wl = [max(1, chars(w["word"])) for w in words]
    wt = sum(wl) or 1
    starts, cum, bi = [0.0], 0, 0
    for w, n in zip(words, wl):
        if bi < len(bounds) and cum / wt >= bounds[bi]:
            starts.append(w["start"])
            bi += 1
        cum += n
    while len(starts) < len(beats):  # not enough words matched: spread evenly
        starts.append(starts[-1] + (total - starts[-1]) / 2)
    out = []
    for i, b in enumerate(beats):
        end = starts[i + 1] if i + 1 < len(beats) else total
        out.append({"start": round(starts[i], 3), "end": round(end, 3)})
    return out


def punctuate(words, text):
    """Edge drops punctuation from word boundaries; put sentence ends back for caption grouping."""
    toks = text.split()
    j = 0
    for w in words:
        key = re.sub(r"\W", "", w["word"]).lower()
        for k in range(j, min(j + 4, len(toks))):
            if re.sub(r"\W", "", toks[k]).lower().startswith(key[:3] or "~"):
                if re.search(r"[.!?,;:]$", toks[k]) and not re.search(r"[.!?,;:]$", w["word"]):
                    w["word"] += toks[k][-1]
                j = k + 1
                break
    return words


# ---------- images ----------
# Best free Cloudflare model first, cheaper ones as fallbacks. Neurons per portrait image (10,000 free a day):
# flux-2-klein-9b ~1,400 (best detail, used for the hook shot), flux-2-klein-4b ~110 (FLUX.2 quality, most shots),
# flux-1-schnell ~80 (old, last resort).
HERO_MODELS = ["flux-2-klein-9b", "flux-2-klein-4b", "flux-1-schnell"]
STD_MODELS = ["flux-2-klein-4b", "flux-1-schnell"]
W, H = 768, 1344  # generation size: set_project() matches it to the canvas aspect (multiples of 16)


def _cf_call(model, prompt, acc, tok):
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/ai/run/@cf/black-forest-labs/{model}"
    if model.startswith("flux-2"):
        b = "----hark" + str(int(time.time() * 1000))
        parts = [("prompt", prompt[:2000]), ("width", str(W)), ("height", str(H))]
        data = b"".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in parts) + f"--{b}--\r\n".encode()
        ctype = "multipart/form-data; boundary=" + b
    else:
        data, ctype = json.dumps({"prompt": prompt[:2000], "steps": 8}).encode(), "application/json"
    req = urllib.request.Request(url, data=data, headers={"Authorization": "Bearer " + tok, "Content-Type": ctype})
    return json.load(urllib.request.urlopen(req, timeout=150))["result"]["image"]


def flux(prompt, path, seed=0, hero=False):
    acc, tok = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip(), os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if not (acc and tok):
        raise RuntimeError("no Cloudflare keys")
    last, quota_hit = None, None
    for model in (HERO_MODELS if hero else STD_MODELS):
        for attempt in range(3):
            try:
                open(path, "wb").write(base64.b64decode(_cf_call(model, prompt, acc, tok)))
                USAGE.setdefault("image_models", {})
                USAGE["image_models"][model] = USAGE["image_models"].get(model, 0) + 1
                return True
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")
                last = f"{model}: {e.code} {body[:160]}"
                if re.search(r"4006|daily free allocation|used up your daily", body, re.I):
                    quota_hit = last
                    break  # real daily quota: a cheaper model may still fit
                if e.code == 429 or e.code >= 500:
                    time.sleep(4 + attempt * 8)  # per-minute rate limit or hiccup: wait, retry the same model
                    continue
                if e.code in (400, 401, 403, 404):
                    break
            except Exception as e:
                last = f"{model}: {e}"
        print("image model fallback:", last)
    if quota_hit:
        raise QuotaError(quota_hit)
    raise RuntimeError(f"flux failed: {last}")


class QuotaError(Exception):
    pass


# ---------- delegated tools (picked per beat by the bot's director step) ----------
def _key(*names):
    for n in names:
        v = (os.getenv(n) or "").strip()
        if v:
            return v
    return ""


class PaidToolError(Exception):
    pass


def pixellab(prompt, path):
    """Pixel-art still from PixelLab (paid credits, about a cent an image), upscaled crisp to 1080x1920."""
    tok = _key("PIXELLAB_API_KEY", "PIXELLAB_TOKEN", "PIXELLAB_SECRET")
    if not tok:
        raise PaidToolError("no PixelLab key")
    a = W / H
    pw, ph = (256, max(64, round(256 / a))) if a >= 1 else (max(64, round(256 * a)), 256)
    body = {"description": prompt[:900], "image_size": {"width": pw, "height": ph}}
    req = urllib.request.Request("https://api.pixellab.ai/v1/generate-image-pixflux", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        raise PaidToolError(f"PixelLab {e.code} {e.read().decode('utf-8', 'ignore')[:140]}")
    b64 = r["image"]["base64"].split(",", 1)[-1]
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    img.resize((CV["width"], CV["height"]), Image.NEAREST).save(path, quality=95)
    USAGE["pixellab_usd"] = round(USAGE.get("pixellab_usd", 0) + float((r.get("usage") or {}).get("usd") or 0.01), 4)
    return True


def public_url(path):
    """A public image URL for tools that need one: attach the still to a short-lived prerelease on this repo."""
    repo, run = os.getenv("GITHUB_REPOSITORY"), os.getenv("GITHUB_RUN_ID", "local")
    tag = f"frames-{run}"
    subprocess.run(["gh", "release", "view", tag], capture_output=True) .returncode == 0 or \
        subprocess.run(["gh", "release", "create", tag, "--prerelease", "--title", "frames (temporary)", "--notes", "temporary"], check=True, capture_output=True)
    subprocess.run(["gh", "release", "upload", tag, path, "--clobber"], check=True, capture_output=True)
    return f"https://github.com/{repo}/releases/download/{tag}/{os.path.basename(path)}"


def hf_token():
    """Hugging Face token: HF_TOKEN, or a Hugging Face token saved in the old Higgsfield slot."""
    t = _key("HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_TOKEN")
    if t:
        return t
    for name in ("HF_API_KEY_ID", "HF_API_KEY_SECRET"):
        v = _key(name)
        if v.startswith("hf_") and "-" not in v and ":" not in v:
            return v
    return ""


def hf_motion(still, motion, out):
    """Free image-to-video on Hugging Face ZeroGPU (Wan 2.2). Uses the account's daily GPU minutes."""
    import shutil
    from gradio_client import Client, handle_file
    tok = hf_token()
    spaces = [s.strip() for s in os.getenv("HF_VIDEO_SPACES", "zerogpu-aoti/wan2-2-fp8da-aoti-faster").split(",") if s.strip()]
    last = None
    for space in spaces:
        try:
            c = Client(space, token=tok or None, verbose=False)
            r = c.predict(input_image=handle_file(still), prompt=motion[:500], steps=6,
                          duration_seconds=float(os.getenv("HF_VIDEO_SECONDS", "4")), randomize_seed=True,
                          api_name="/generate_video")
            v = r[0] if isinstance(r, (list, tuple)) else r
            if isinstance(v, dict):
                v = v.get("video") or v.get("path") or v.get("value")
            if not v or not os.path.exists(v):
                raise RuntimeError(f"no video file from {space}")
            shutil.copyfile(v, out)
            USAGE["hf_clips"] = USAGE.get("hf_clips", 0) + 1
            print(f"hugging face motion ok via {space}")
            return duration(out)
        except Exception as e:
            last = e
            print(f"hugging face {space} failed: {str(e)[:200]}")
    raise PaidToolError(f"Hugging Face video failed: {str(last)[:160]}")


def higgsfield(still, motion, out):
    """Old tool name kept so saved projects still open. Runs Hugging Face video."""
    return hf_motion(still, motion, out)


def gemini_image(prompt, path):
    """Backup still from Gemini when Cloudflare can't deliver (opt-in: /tools > Gemini backup images)."""
    key = _key("GEMINI_API_KEY")
    if not key:
        raise PaidToolError("no Gemini key")
    model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": TL.aspect_label(CV)}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise PaidToolError(f"Gemini {e.code} {e.read().decode('utf-8', 'ignore')[:140]}")
    for part in r["candidates"][0]["content"]["parts"]:
        data = (part.get("inlineData") or part.get("inline_data") or {}).get("data")
        if data:
            open(path, "wb").write(base64.b64decode(data))
            USAGE["gemini_images"] = USAGE.get("gemini_images", 0) + 1
            return True
    raise PaidToolError("Gemini returned no image")


USAGE = {}


def placeholder(text, path, i):
    from PIL import Image, ImageDraw, ImageFont
    w, h = CV["width"], CV["height"]
    top = [(30, 30, 60), (60, 20, 40), (15, 50, 60), (50, 40, 15)][i % 4]
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c * (1 - k) + 8 * k) for c in top))
    img.save(path, quality=90)


def framing(cv):
    shape = TL.format_name(cv)
    return {"vertical": "Vertical 9:16 composition, subject centered",
            "portrait": "Portrait 4:5 composition, subject centered",
            "square": "Square 1:1 composition, subject centered",
            "landscape": f"Wide {TL.aspect_label(cv)} cinematic composition"}[shape]


def image_prompt(prompt, style, cv):
    return (f"{prompt}. {style}. {framing(cv)}, cinematic lighting, rich colour, sharp focus, highly detailed, "
            "natural anatomy, no extra limbs, empty space across the top fifth of the frame, no text, no watermark.").replace(". .", ".")


def _save_image(data, path):
    import io
    from PIL import Image
    Image.open(io.BytesIO(data)).convert("RGB").save(path, "JPEG", quality=92)


def together_image(prompt, path, seed=0):
    key = os.getenv("TOGETHER_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no TOGETHER_API_KEY")
    last = None
    for model in ("black-forest-labs/FLUX.1-schnell-Free", "black-forest-labs/FLUX.1-schnell"):
        try:
            body = json.dumps({"model": model, "prompt": prompt[:1500], "width": W, "height": H, "steps": 4, "n": 1, "response_format": "b64_json"}).encode()
            req = urllib.request.Request("https://api.together.xyz/v1/images/generations", data=body,
                                         headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
            d = json.load(urllib.request.urlopen(req, timeout=120))
            _save_image(base64.b64decode(d["data"][0]["b64_json"]), path)
            USAGE.setdefault("image_models", {})
            USAGE["image_models"]["together-" + model.split("/")[-1]] = USAGE["image_models"].get("together-" + model.split("/")[-1], 0) + 1
            return True
        except Exception as e:
            last = e
    raise RuntimeError("together failed: %s" % last)


_POLL_LOCK = __import__("threading").Semaphore(1)


def _poll_fetch(req):
    last = None
    with _POLL_LOCK:
        for attempt in range(4):
            try:
                return urllib.request.urlopen(req, timeout=150).read()
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")[:120]
                last = "HTTP %s %s" % (e.code, body)
                if e.code in (400, 401, 402, 403, 404):
                    break
                time.sleep(6 + attempt * 10)
            except Exception as e:
                last = str(e)[:120]
                time.sleep(4)
    raise RuntimeError("pollinations: %s" % last)


def pollinations_image(prompt, path, seed=0):
    import urllib.parse
    q = urllib.parse.quote(prompt[:900])
    url = "https://image.pollinations.ai/prompt/%s?width=%d&height=%d&seed=%d&model=flux&nologo=true" % (q, W, H, seed)
    req = urllib.request.Request(url, headers={"User-Agent": "shorts-studio/1.0"})
    data = _poll_fetch(req)
    if len(data) < 5000:
        raise RuntimeError("pollinations returned too little data")
    _save_image(data, path)
    USAGE.setdefault("image_models", {})
    USAGE["image_models"]["pollinations"] = USAGE["image_models"].get("pollinations", 0) + 1
    return True


def _paint_inner(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0):
    """One still for a clip, with the bot's tool choice and every fallback. Returns {'pixel': bool}.
    Raises QuotaError / RuntimeError when nothing could make it (caller decides on a placeholder)."""
    full = image_prompt(prompt, style, CV)
    tool = (tool or "flux").lower()
    if tool == "pixellab":
        try:
            pixellab(f"{prompt}. {style}", path)
            return {"pixel": True}
        except PaidToolError as e:
            print("pixellab", e)
            PAID_NOTES.append(str(e))
    try:
        flux(full, path, seed, hero=hero)
        return {"pixel": False}
    except Exception as e:
        if gemini_ok or os.getenv("GEMINI_API_KEY"):
            try:
                gemini_image(full, path)
                return {"pixel": False}
            except Exception as g:
                print("gemini image", g); _FB_ERR.append("gemini: " + str(g)[:100])
        for _name, _fn in (("together", together_image),):
            try:
                _fn(full, path, seed)
                print("image fallback ok:", _name)
                return {"pixel": False}
            except Exception as g:
                print("image fallback", _name, g); _FB_ERR.append("%s: %s" % (_name, str(g)[:100]))
        raise e


STOCK_STOP = set("a an the of in on at to and with for from by is are was were be as it its this that these those very highly detailed cinematic illustration style digital art painting photo photograph render rendering lighting light shot view close closeup wide angle background high quality ultra realistic vertical portrait composition subject centered".split())


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


PAID_NOTES = []
_FB_ERR = []


def voice(text, voice_name, rate, path):
    """Edge TTS voice + punctuated word timings. Returns (words, seconds)."""
    import time
    text = (text or "").strip()
    if not text:
        raise SystemExit("No narration text in the spec, nothing to voice")
    words, last = [], None
    tries = [(voice_name or "en-US-AndrewMultilingualNeural", rate or "+0%")] * 3 + [("en-US-AndrewMultilingualNeural", "+0%"), ("en-US-GuyNeural", "+0%")]
    for i, (v, r) in enumerate(tries):
        try:
            words = asyncio.run(_synth(text, v, r, path))
            if words and os.path.getsize(path) > 1000:
                if i:
                    print(f"voice ok on try {i + 1} ({v})")
                break
            words = []
        except Exception as e:
            last = e
            print(f"edge-tts try {i + 1} with {v} {r} failed: {e}")
        time.sleep(3 * (i + 1))
    if not words:
        print("edge-tts gave nothing, using Google TTS backup with estimated word timings")
        try:
            from gtts import gTTS
            gTTS(text, lang="en", tld="com.ng").save(path)
        except Exception as e:
            raise SystemExit(f"Both voices failed. edge-tts: {last}; Google TTS: {e}")
        toks = text.split()
        total_s = duration(path)
        weights = [len(re.sub(r"[^0-9A-Za-z]", "", t)) + 2 for t in toks]
        span, t0 = total_s * 0.98 / sum(weights), total_s * 0.01
        for tok, wt in zip(toks, weights):
            w = re.sub(r"[^0-9A-Za-z'-]", "", tok) or tok
            words.append({"word": w, "start": round(t0, 3), "end": round(t0 + span * wt * 0.9, 3)})
            t0 += span * wt
    if not words:
        raise SystemExit("edge-tts returned no word timings")
    return punctuate(words, text), duration(path)


# ---------- flow: tighter pauses + the writer's [beat]/[pause]/*emphasis* cues ----------
# pace "tight" (default) shortens long gaps after full stops and commas, "fast" shortens more, "natural" leaves them alone.
# A cue the writer put in (b["cues"]) is honoured exactly: a longer pause is added, a shorter one is cut to that length.
PACE_CAPS = {"tight": (0.28, 0.16, 0.12), "fast": (0.18, 0.12, 0.12)}  # after . ? !  |  after , ; :  |  between other words


def _tighten_plan(words, beats, caps):
    """Returns (cuts, inserts) in seconds, plus marks cue words as emphasised. Pure function, easy to test."""
    counts = [len(str(b["narration"]).split()) for b in beats]
    want = {}
    if sum(counts) == len(words):
        off = 0
        for b, n in zip(beats, counts):
            c = b.get("cues") or {}
            for p in c.get("pauses", []) or []:
                try:
                    a, sec = int(p.get("after", 0)), float(p.get("s", 0.3))
                except Exception:
                    continue
                if 1 <= a <= n:
                    want[off + a - 1] = max(want.get(off + a - 1, 0.0), max(0.12, min(1.5, sec)))
            for e in c.get("emphasis", []) or []:
                try:
                    e = int(e)
                except Exception:
                    continue
                if 0 <= e < n:
                    words[off + e]["em"] = True
            off += n
    elif any(b.get("cues") for b in beats):
        print("cues skipped: word count differs from the voice's words")
    cuts, inserts = [], []
    for g in range(len(words) - 1):
        a_end, b_start = float(words[g]["end"]), float(words[g + 1]["start"])
        nat = max(0.0, b_start - a_end)
        last = (words[g]["word"] or "")[-1:]
        cap = caps[0] if last in ".?!" else caps[1] if last in ",;:" else caps[2]
        target = want.get(g, cap)
        if nat > target + 0.06:
            cuts.append((a_end + target / 2, b_start - target / 2))
        elif g in want and nat < target - 0.02:
            inserts.append((a_end + nat / 2, target - nat))
    return cuts, inserts


def _map_time(t, cuts, inserts):
    shift = 0.0
    for a, b in cuts:
        if t >= b:
            shift -= (b - a)
        elif t > a:
            shift -= (t - a)
    for p, d in inserts:
        if t >= p:
            shift += d
    return max(0.0, t + shift)


def tighten_voice(words, total, path, beats, spec):
    """Shorten long pauses in the one-take voice and re-sync every word time. Any problem keeps the original audio."""
    pace = str(spec.get("pace") or "tight").lower()
    caps = PACE_CAPS.get(pace)
    has_cues = any(b.get("cues") for b in beats)
    if caps is None and not has_cues:
        return words, total
    caps = caps or (9.0, 9.0, 9.0)
    try:
        cuts, inserts = _tighten_plan(words, beats, caps)
        if not cuts and not inserts:
            return words, total
        events = sorted([("cut", a, b) for a, b in cuts] + [("ins", p, d) for p, d in inserts], key=lambda e: e[1])
        ops, cur = [], 0.0
        for kind, x, y in events:
            if kind == "cut":
                if x > cur:
                    ops.append(("seg", cur, x))
                cur = max(cur, y)
            else:
                if x > cur:
                    ops.append(("seg", cur, x))
                    cur = x
                ops.append(("sil", y, 0))
        if total > cur:
            ops.append(("seg", cur, total))
        sr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path],
                            capture_output=True, text=True).stdout.strip() or "24000"
        lines, names = [], []
        for i, (kind, x, y) in enumerate(ops):
            if kind == "seg":
                d = y - x
                f = min(0.008, d / 3)
                lines.append(f"[0:a]atrim=start={x:.4f}:end={y:.4f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={f:.4f},afade=t=out:st={d - f:.4f}:d={f:.4f}[a{i}]")
            else:
                lines.append(f"anullsrc=r={sr}:cl=mono,atrim=duration={x:.4f}[a{i}]")
            names.append(f"[a{i}]")
        lines.append("".join(names) + f"concat=n={len(names)}:v=0:a=1[out]")
        script, tmp = path + ".filter.txt", path + ".tight.mp3"
        open(script, "w").write(";\n".join(lines))
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-filter_complex_script", script, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "3", tmp],
                           capture_output=True, text=True)
        if r.returncode or not os.path.exists(tmp):
            print("pause tightening skipped (ffmpeg):", (r.stderr or "")[:160])
            return words, total
        new_total = duration(tmp)
        expect = total - sum(b - a for a, b in cuts) + sum(d for _, d in inserts)
        if abs(new_total - expect) > 0.6 or new_total < total * 0.5:
            print(f"pause tightening skipped (length check: {new_total:.1f}s vs {expect:.1f}s)")
            os.remove(tmp)
            return words, total
        for w in words:
            w["start"] = round(_map_time(float(w["start"]), cuts, inserts), 3)
            w["end"] = round(_map_time(float(w["end"]), cuts, inserts), 3)
        os.replace(tmp, path)
        os.remove(script)
        print(f"pauses tightened ({pace}): {total:.1f}s -> {new_total:.1f}s, {len(cuts)} cut, {len(inserts)} added")
        return words, new_total
    except Exception as e:
        print("pause tightening skipped:", e)
        return words, total


def polish_voice(path, total):
    """High-pass the rumble, compress lightly, then two-pass loudness to -16 LUFS with -3 dBTP peaks.
    Word times are untouched (nothing here changes timing). Any problem keeps the original audio."""
    try:
        chain = "highpass=f=70,acompressor=threshold=-21dB:ratio=2:attack=15:release=180:makeup=1"
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", chain + ",loudnorm=I=-16:TP=-3:LRA=11:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True)
        m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr or "", re.S)
        if r.returncode or not m:
            print("voice polish skipped (measure)")
            return total
        j = json.loads(m.group(0))
        ln = ("loudnorm=I=-16:TP=-3:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true"
              % (float(j["input_i"]), float(j["input_tp"]), float(j["input_lra"]), float(j["input_thresh"]), float(j["target_offset"])))
        sr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path],
                            capture_output=True, text=True).stdout.strip() or "24000"
        tmp = path + ".polish.mp3"
        r2 = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-af", chain + "," + ln, "-ar", sr, "-c:a", "libmp3lame", "-q:a", "2", tmp],
                            capture_output=True, text=True)
        if r2.returncode or not os.path.exists(tmp):
            print("voice polish skipped (ffmpeg):", (r2.stderr or "")[:140])
            return total
        new_total = duration(tmp)
        if abs(new_total - total) > 0.3:
            print("voice polish skipped (length changed)")
            os.remove(tmp)
            return total
        os.replace(tmp, path)
        print("voice polished: %.1f LUFS -> -16 LUFS" % float(j["input_i"]))
        return new_total
    except Exception as e:
        print("voice polish skipped:", e)
        return total


def project_id(spec):
    pid = TL.slug(spec.get("project_id"), 60) if spec.get("project_id") else TL.new_id(spec.get("title", "video"))
    return pid


def main():
    spec = json.load(open(sys.argv[1]))
    cv = TL.canvas(spec.get("canvas") or spec.get("format") or "vertical", int(spec.get("fps") or 30))
    pid = project_id(spec)
    set_project(pid, cv)
    os.makedirs(os.path.join(ROOT, "job"), exist_ok=True)
    open(os.path.join(ROOT, "job", "project_id.txt"), "w").write(pid)
    print(f"project {pid}: {cv['width']}x{cv['height']} @{cv['fps']}fps, images {W}x{H}")
    beats = spec["beats"]
    style = spec.get("style", "").strip()
    # learned styles (style-fix): put the learned look's art direction in front of the image prompts
    try:
        _lid, _learned = TL.find_learned(spec.get("style_preset") or "")
        if not _learned:
            _lid, _learned = TL.find_learned(style)
        if _learned:
            _is = (_learned.get("image_style") or "").strip()
            if _is and _is.lower() not in style.lower():
                style = f"{_is}. {style}".strip(". ")
            spec.setdefault("style_preset", _lid)
            print(f"learned style '{_lid}' applied")
    except Exception as _e:
        print("learned style lookup skipped:", _e)
    try:   # step-assets
        import user_assets as UA
        UA_ITEMS = UA.fetch_all(spec)
        UMAP = UA.plan(spec, beats, tg)
    except Exception as _e:
        print("user assets skipped:", _e)
        UA, UA_ITEMS, UMAP = None, [], {}
    text = " ".join(b["narration"].strip() for b in beats)

    tg("🎙️ Recording the voiceover...")
    voice_path = os.path.join(OUT, "voice.mp3")
    UVO = UA.voiceover(spec, UA_ITEMS, beats, voice_path, tg) if UA else None   # step-assets
    if UVO:
        words, total = UVO
    else:
        words, total = voice(text, spec.get("voice"), spec.get("rate", "+0%"), voice_path)
        words, total = tighten_voice(words, total, voice_path, beats, spec)
        total = polish_voice(voice_path, total)
    print(f"voice {total:.1f}s, {len(words)} words")

    n_gfx = sum(1 for b in beats if b.get("graphic") or b.get("scene"))
    tg(f"🎨 Animating {n_gfx} motion-graphic scenes..." if n_gfx == len(beats) else f"🎨 Painting {len(beats) - n_gfx} images" + (f" and animating {n_gfx} graphic(s)..." if n_gfx else "..."))
    fallbacks, errors, quota = [], [], []
    PIXEL = set()

    def make(i):
        b = beats[i]
        if UA and i in UMAP:   # step-assets
            return UA.make_still(UMAP[i], os.path.join(OUT, f"img_{i + 1:02d}.jpg"), W, H, f"{JOB}/img_{i + 1:02d}.jpg")
        if b.get("graphic") or b.get("scene"):
            return ""  # drawn in code by Remotion: no image, no Cloudflare neurons
        path = os.path.join(OUT, f"img_{i + 1:02d}.jpg")
        tool = (b.get("tool") or "flux").lower()
        if tool in ("higgsfield", "huggingface", "stock"):
            tool = b.get("still") or "flux"
        try:
            if paint(b["image_prompt"], path, tool, style, hero=(i == 0 and bool(spec.get("hq"))), gemini_ok=bool(spec.get("gemini_images")), seed=1000 + i, query=b.get("query") or "")["pixel"]:
                PIXEL.add(i)
        except Exception as e:
            print("image", i + 1, e)
            (quota if isinstance(e, QuotaError) else errors).append(str(e))
            fallbacks.append(i + 1)
            placeholder(b["narration"], path, i)
        return f"{JOB}/img_{i + 1:02d}.jpg"

    with ThreadPoolExecutor(4) as ex:
        images = list(ex.map(make, range(len(beats))))
    if quota and not spec.get("allow_plain"):
        # Pause instead of shipping a plain video: the bot saves the job and resumes when the quota resets.
        os.makedirs("job", exist_ok=True)
        open("job/paused.txt", "w").write("images: " + quota[0][:200])
        print("PAUSED: image quota used up")
        tg("⏸️ Cloudflare said: " + quota[0][:200] + "\nFallbacks: " + (" | ".join(_FB_ERR[-4:]) or "none ran"))
        raise SystemExit(75)
    if fallbacks:
        why = "the free daily image quota ran out" if quota else (errors[0][:140] if errors else "unknown error")
        tg(f"⚠️ Images failed for beat(s) {sorted(fallbacks)} ({why}); used plain backgrounds there.")

    times = split_beats(beats, words, total)

    # Motion beats: hand the finished stills to Hugging Face in parallel, then fold the clips back in.
    clips = {}
    if UA and UMAP:   # step-assets
        UA.apply_videos(UMAP, clips, times, cv, OUT, JOB, tg)
    motion = [i for i, b in enumerate(beats) if (b.get("tool") or "").lower() in ("higgsfield", "huggingface") and (i + 1) not in fallbacks]
    if motion:
        tg(f"🎥 Animating {len(motion)} key shot(s) with Hugging Face...")

        def animate(i):
            out = os.path.join(OUT, f"clip_{i + 1:02d}.mp4")
            try:
                d = higgsfield(os.path.join(OUT, f"img_{i + 1:02d}.jpg"), beats[i].get("motion") or beats[i]["image_prompt"], out)
                beat_len = times[i]["end"] - times[i]["start"]
                if d / 0.6 >= beat_len:
                    clips[i] = {"video": f"{JOB}/clip_{i + 1:02d}.mp4", "videoDuration": round(d, 2)}
            except Exception as e:
                print("hugging face motion", i + 1, e); PAID_NOTES.append(str(e))

        with ThreadPoolExecutor(3) as ex:
            list(ex.map(animate, motion))
        try:
            subprocess.run(["gh", "release", "delete", f"frames-{os.getenv('GITHUB_RUN_ID', 'local')}", "-y", "--cleanup-tag"], capture_output=True)
        except Exception:
            pass
    # Stock footage beats: real Pixabay clips (free). Any failure keeps the painted still.
    stock = [i for i, b in enumerate(beats) if (b.get("tool") or "").lower() == "stock" and (i + 1) not in fallbacks and i not in clips]
    stock_notes, stock_ok = [], []
    if stock:
        tg(f"🎞️ Finding {len(stock)} real footage clip(s)...")
        try:
            import importlib.util
            _sp = importlib.util.spec_from_file_location("stock", os.path.join(os.path.dirname(os.path.abspath(__file__)), "stock.py"))
            STOCK = importlib.util.module_from_spec(_sp)
            _sp.loader.exec_module(STOCK)
        except Exception as e:
            STOCK = None
            stock_notes.append(f"stock module: {e}")

        def fetch_stock(i):
            out = os.path.join(OUT, f"clip_{i + 1:02d}.mp4")
            beat_len = times[i]["end"] - times[i]["start"]
            try:
                if STOCK is None:
                    raise RuntimeError("stock module not loaded")
                d, credit = STOCK.fetch(beats[i].get("query") or "", out, beat_len, int(cv["width"]), int(cv["height"]), narration=beats[i].get("narration") or "")
                if d / 0.6 >= beat_len:
                    clips[i] = {"video": f"{JOB}/clip_{i + 1:02d}.mp4", "videoDuration": round(d, 2)}
                    stock_ok.append(i)
                else:
                    raise RuntimeError("clip too short")
            except Exception as e:
                print("stock footage", i + 1, e)
                stock_notes.append(str(e))

        with ThreadPoolExecutor(3) as ex:
            list(ex.map(fetch_stock, stock))
        if stock_ok:
            tg(f"🎞️ Real footage: {len(stock_ok)} clip(s), each checked by eye against its line.")
        if stock_notes:
            tg(f"ℹ️ Stock footage didn't deliver for {len(stock_notes)} shot(s) ({stock_notes[0][:100]}), so I kept the picture there.")
    if PAID_NOTES:
        tg(f"ℹ️ A paid tool didn't deliver ({PAID_NOTES[0][:120]}), so I used a still for that shot.")
    json.dump({**USAGE, "motion_requested": len(motion), "motion_used": len([i for i in clips if i in motion]), "stock_requested": len(stock), "stock_used": len(stock_ok)}, open(os.path.join(OUT, "usage.json"), "w"))
    music = spec.get("music") or "docu-pluck"
    mpath = f"library/music/clips/{music}.mp3"
    if UA:   # step-assets
        mpath = UA.music_path(spec, UA_ITEMS, OUT, JOB, mpath)
    wide = TL.format_name(cv) == "landscape"
    props = {
        "title": spec.get("title", ""),
        "audio": f"{JOB}/voice.mp3",
        "music": mpath if os.path.exists(os.path.join(ROOT, "media", mpath)) else None,
        "musicVolume": float(spec.get("music_volume", 0.1)),
        "accent": spec.get("accent", "#FFD43B"),
        "duration": round(total + 0.8, 2),
        "beats": [{"image": img, "text": b["narration"], **t, **clips.get(i, {}), **({"pixel": True} if i in PIXEL else {}),
                   **({"graphic": b["graphic"]} if b.get("graphic") else {}), **({"scene": b["scene"]} if b.get("scene") else {})}
                  for i, (img, b, t) in enumerate(zip(images, beats, times))],
        "words": words,
        "format": "landscape" if wide else "vertical",
    }
    pdir = TL.project_dir(pid)
    json.dump(props, open(os.path.join(pdir, "props.json"), "w"), indent=1)  # legacy StoryShort props
    # The project timeline: what gets rendered, saved and re-edited later.
    t = TL.from_props(props, spec, pid, cv)
    for i in fallbacks:
        t["tracks"]["visuals"][i - 1]["dirty"] = True  # placeholder: remake it on the next build
    rev = TL.save(t, "first build from the bot's spec")
    errs = TL.validate(t)
    if errs:
        print("timeline warnings:", errs[:5])
    tg(f"🎬 Editing the video ({total:.0f}s)...")
    print(f"timeline r{rev} written: media/projects/{pid}/timeline.json")


if __name__ == "__main__":
    main()
