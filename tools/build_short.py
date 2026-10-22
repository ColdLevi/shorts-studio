#!/usr/bin/env python3
"""Spec (from the Telegram bot) -> voice + word timings + one image per beat -> Remotion props.
Usage: python tools/build_short.py spec.json   (run from the repo root)
Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (images), TELEGRAM_TOKEN + CHAT_ID (progress, optional)."""
import asyncio, base64, json, os, re, subprocess, sys, textwrap, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOB = "projects/job"
OUT = os.path.join(ROOT, "media", JOB)
os.makedirs(OUT, exist_ok=True)


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
def flux(prompt, path, seed):
    acc, tok = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip(), os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if not (acc and tok):
        raise RuntimeError("no Cloudflare keys")
    body = {"prompt": prompt, "steps": 8, "seed": seed}
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acc}/ai/run/@cf/black-forest-labs/flux-1-schnell",
                                 data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    last = None
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=120))
            open(path, "wb").write(base64.b64decode(r["result"]["image"]))
            return True
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            if e.code == 429 or re.search(r"4006|neuron|daily|quota|allocation", body, re.I):
                raise QuotaError(f"{e.code} {body[:160]}")
            last = f"{e.code} {body[:160]}"
            if e.code in (401, 403):
                break
        except Exception as e:
            last = e
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
    body = {"description": prompt[:900], "image_size": {"width": 144, "height": 256}}
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
    img.resize((1080, 1920), Image.NEAREST).save(path, quality=95)
    USAGE["pixellab_usd"] = round(USAGE.get("pixellab_usd", 0) + float((r.get("usage") or {}).get("usd") or 0.01), 4)
    return True


def public_url(path):
    """Higgsfield needs a public image URL: attach the still to a short-lived prerelease on this repo."""
    repo, run = os.getenv("GITHUB_REPOSITORY"), os.getenv("GITHUB_RUN_ID", "local")
    tag = f"frames-{run}"
    subprocess.run(["gh", "release", "view", tag], capture_output=True) .returncode == 0 or \
        subprocess.run(["gh", "release", "create", tag, "--prerelease", "--title", "frames (temporary)", "--notes", "temporary"], check=True, capture_output=True)
    subprocess.run(["gh", "release", "upload", tag, path, "--clobber"], check=True, capture_output=True)
    return f"https://github.com/{repo}/releases/download/{tag}/{os.path.basename(path)}"


def higgsfield(still, motion, out):
    """Bring a still to life with Higgsfield image-to-video (paid credits). Returns the clip length in seconds."""
    kid, sec = _key("HF_API_KEY_ID", "HIGGSFIELD_API_KEY", "HF_API_KEY"), _key("HF_API_KEY_SECRET", "HIGGSFIELD_SECRET", "HF_SECRET")
    both = _key("HF_KEY", "HF_CREDENTIALS")
    auth = f"Key {kid}:{sec}" if kid and sec else (f"Key {both}" if ":" in both else "")
    if not auth:
        raise PaidToolError("no Higgsfield keys")
    model = os.getenv("HF_MODEL", "kling-video/v2.5-turbo/standard/image-to-video")
    body = {"prompt": motion[:900], "image_url": public_url(still), "duration": 5}
    hdr = {"Authorization": auth, "Content-Type": "application/json", "Idempotency-Key": f"{os.getenv('GITHUB_RUN_ID', 'x')}-{os.path.basename(out)}"}
    try:
        sub = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api.higgsfield.ai/{model}", data=json.dumps(body).encode(), headers=hdr), timeout=60))
    except urllib.error.HTTPError as e:
        raise PaidToolError(f"Higgsfield {e.code} {e.read().decode('utf-8', 'ignore')[:140]}")
    status_url = sub.get("status_url") or f"https://api.higgsfield.ai/requests/{sub['request_id']}/status"
    for _ in range(80):  # up to about 8 minutes
        time.sleep(6)
        st = json.load(urllib.request.urlopen(urllib.request.Request(status_url, headers={"Authorization": auth}), timeout=30))
        if st.get("status") == "completed":
            url = (st.get("video") or {}).get("url")
            urllib.request.urlretrieve(url, out)
            USAGE["higgsfield_clips"] = USAGE.get("higgsfield_clips", 0) + 1
            return duration(out)
        if st.get("status") in ("failed", "nsfw", "canceled"):
            raise PaidToolError(f"Higgsfield {st.get('status')} {str(st.get('error'))[:120]}")
    raise PaidToolError("Higgsfield timed out")


def gemini_image(prompt, path):
    """Backup still from Gemini when Cloudflare can't deliver (opt-in: /tools > Gemini backup images)."""
    key = _key("GEMINI_API_KEY")
    if not key:
        raise PaidToolError("no Gemini key")
    model = os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}}}
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
    w, h = 1080, 1920
    top = [(30, 30, 60), (60, 20, 40), (15, 50, 60), (50, 40, 15)][i % 4]
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c * (1 - k) + 8 * k) for c in top))
    img.save(path, quality=90)


def main():
    spec = json.load(open(sys.argv[1]))
    beats = spec["beats"]
    style = spec.get("style", "").strip()
    text = " ".join(b["narration"].strip() for b in beats)

    tg("🎙️ Recording the voiceover...")
    voice_path = os.path.join(OUT, "voice.mp3")
    words = asyncio.run(_synth(text, spec.get("voice") or "en-US-AndrewMultilingualNeural", spec.get("rate", "+0%"), voice_path))
    total = duration(voice_path)
    if not words:
        raise SystemExit("edge-tts returned no word timings")
    words = punctuate(words, text)
    print(f"voice {total:.1f}s, {len(words)} words")

    tg(f"🎨 Painting {len(beats)} images...")
    fallbacks, errors, quota, paid_notes = [], [], [], []
    PIXEL = set()

    def make(i):
        b = beats[i]
        path = os.path.join(OUT, f"img_{i + 1:02d}.jpg")
        prompt = f"{b['image_prompt']}. {style}. Vertical 9:16 composition, subject centered, no text, no watermark."
        tool = (b.get("tool") or "flux").lower()
        try:
            if tool == "pixellab" or (tool == "higgsfield" and b.get("still") == "pixellab"):
                try:
                    pixellab(f"{b['image_prompt']}. {style}", path)
                    PIXEL.add(i)
                except PaidToolError as e:
                    print("pixellab", i + 1, e); paid_notes.append(str(e)); flux(prompt, path, 1000 + i)
            else:
                flux(prompt, path, 1000 + i)
        except Exception as e:
            print("image", i + 1, e)
            if spec.get("gemini_images"):
                try:
                    gemini_image(prompt, path)
                    return f"{JOB}/img_{i + 1:02d}.jpg"
                except Exception as g:
                    print("gemini image", i + 1, g)
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

    # Motion beats: hand the finished stills to Higgsfield in parallel, then fold the clips back in.
    clips = {}
    motion = [i for i, b in enumerate(beats) if (b.get("tool") or "").lower() == "higgsfield" and (i + 1) not in fallbacks]
    if motion:
        tg(f"🎥 Animating {len(motion)} key shot(s) with Higgsfield...")

        def animate(i):
            out = os.path.join(OUT, f"clip_{i + 1:02d}.mp4")
            try:
                d = higgsfield(os.path.join(OUT, f"img_{i + 1:02d}.jpg"), beats[i].get("motion") or beats[i]["image_prompt"], out)
                beat_len = times[i]["end"] - times[i]["start"]
                if d / 0.6 >= beat_len:
                    clips[i] = {"video": f"{JOB}/clip_{i + 1:02d}.mp4", "videoDuration": round(d, 2)}
            except Exception as e:
                print("higgsfield", i + 1, e); paid_notes.append(str(e))

        with ThreadPoolExecutor(3) as ex:
            list(ex.map(animate, motion))
        try:
            subprocess.run(["gh", "release", "delete", f"frames-{os.getenv('GITHUB_RUN_ID', 'local')}", "-y", "--cleanup-tag"], capture_output=True)
        except Exception:
            pass
    if paid_notes:
        tg(f"ℹ️ A paid tool didn't deliver ({paid_notes[0][:120]}), so I used a still for that shot.")
    json.dump({**USAGE, "motion_requested": len(motion), "motion_used": len(clips)}, open(os.path.join(OUT, "usage.json"), "w"))
    music = spec.get("music") or "docu-pluck"
    mpath = f"library/music/clips/{music}.mp3"
    props = {
        "title": spec.get("title", ""),
        "audio": f"{JOB}/voice.mp3",
        "music": mpath if os.path.exists(os.path.join(ROOT, "media", mpath)) else None,
        "musicVolume": float(spec.get("music_volume", 0.1)),
        "accent": spec.get("accent", "#FFD43B"),
        "duration": round(total + 0.8, 2),
        "beats": [{"image": img, "text": b["narration"], **t, **clips.get(i, {}), **({"pixel": True} if i in PIXEL else {})}
                  for i, (img, b, t) in enumerate(zip(images, beats, times))],
        "words": words,
    }
    json.dump(props, open(os.path.join(OUT, "props.json"), "w"), indent=1)
    tg(f"🎬 Editing the video ({total:.0f}s)...")
    print("props written")


if __name__ == "__main__":
    main()
