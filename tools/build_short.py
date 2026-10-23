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
        for attempt in range(2):
            try:
                open(path, "wb").write(base64.b64decode(_cf_call(model, prompt, acc, tok)))
                USAGE.setdefault("image_models", {})
                USAGE["image_models"][model] = USAGE["image_models"].get(model, 0) + 1
                return True
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")
                last = f"{model}: {e.code} {body[:160]}"
                if e.code == 429 or re.search(r"4006|neuron|daily|quota|allocation", body, re.I):
                    quota_hit = last
                    break  # out of budget for this model: a cheaper one may still fit
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
            "no text, no watermark.").replace(". .", ".")


def paint(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0):
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
        if gemini_ok:
            try:
                gemini_image(full, path)
                return {"pixel": False}
            except Exception as g:
                print("gemini image", g)
        raise e


PAID_NOTES = []


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
    text = " ".join(b["narration"].strip() for b in beats)

    tg("🎙️ Recording the voiceover...")
    voice_path = os.path.join(OUT, "voice.mp3")
    words, total = voice(text, spec.get("voice"), spec.get("rate", "+0%"), voice_path)
    print(f"voice {total:.1f}s, {len(words)} words")

    n_gfx = sum(1 for b in beats if b.get("graphic"))
    tg(f"🎨 Painting {len(beats) - n_gfx} images" + (f" and animating {n_gfx} graphic(s)..." if n_gfx else "..."))
    fallbacks, errors, quota = [], [], []
    PIXEL = set()

    def make(i):
        b = beats[i]
        if b.get("graphic"):
            return ""  # drawn in code by Remotion: no image, no Cloudflare neurons
        path = os.path.join(OUT, f"img_{i + 1:02d}.jpg")
        tool = (b.get("tool") or "flux").lower()
        if tool in ("higgsfield", "huggingface", "stock"):
            tool = b.get("still") or "flux"
        try:
            if paint(b["image_prompt"], path, tool, style, hero=(i == 0), gemini_ok=bool(spec.get("gemini_images")), seed=1000 + i)["pixel"]:
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
        raise SystemExit(75)
    if fallbacks:
        why = "the free daily image quota ran out" if quota else (errors[0][:140] if errors else "unknown error")
        tg(f"⚠️ Images failed for beat(s) {sorted(fallbacks)} ({why}); used plain backgrounds there.")

    times = split_beats(beats, words, total)

    # Motion beats: hand the finished stills to Hugging Face in parallel, then fold the clips back in.
    clips = {}
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
                d, credit = STOCK.fetch(beats[i].get("query") or "", out, beat_len, int(cv["width"]), int(cv["height"]))
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
            tg(f"🎞️ Real footage: {len(stock_ok)} clip(s) from Pixabay.")
        if stock_notes:
            tg(f"ℹ️ Stock footage didn't deliver for {len(stock_notes)} shot(s) ({stock_notes[0][:100]}), so I kept the picture there.")
    if PAID_NOTES:
        tg(f"ℹ️ A paid tool didn't deliver ({PAID_NOTES[0][:120]}), so I used a still for that shot.")
    json.dump({**USAGE, "motion_requested": len(motion), "motion_used": len([i for i in clips if i in motion]), "stock_requested": len(stock), "stock_used": len(stock_ok)}, open(os.path.join(OUT, "usage.json"), "w"))
    music = spec.get("music") or "docu-pluck"
    mpath = f"library/music/clips/{music}.mp3"
    wide = TL.format_name(cv) == "landscape"
    props = {
        "title": spec.get("title", ""),
        "audio": f"{JOB}/voice.mp3",
        "music": mpath if os.path.exists(os.path.join(ROOT, "media", mpath)) else None,
        "musicVolume": float(spec.get("music_volume", 0.1)),
        "accent": spec.get("accent", "#FFD43B"),
        "duration": round(total + 0.8, 2),
        "beats": [{"image": img, "text": b["narration"], **t, **clips.get(i, {}), **({"pixel": True} if i in PIXEL else {}),
                   **({"graphic": b["graphic"]} if b.get("graphic") else {})}
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
