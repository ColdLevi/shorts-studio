#!/usr/bin/env python3
"""Spec (from the Telegram bot) -> voice + word timings + one image per beat -> Remotion props.
Usage: python tools/build_short.py spec.json   (run from the repo root)
Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (images), TELEGRAM_TOKEN + CHAT_ID (progress, optional)."""
import asyncio, base64, json, os, re, subprocess, sys, textwrap, urllib.request
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
        except Exception as e:
            last = e
    raise RuntimeError(f"flux failed: {last}")


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
    fallbacks = []

    def make(i):
        b = beats[i]
        path = os.path.join(OUT, f"img_{i + 1:02d}.jpg")
        prompt = f"{b['image_prompt']}. {style}. Vertical 9:16 composition, subject centered, no text, no watermark."
        try:
            flux(prompt, path, 1000 + i)
        except Exception as e:
            print("image", i + 1, e)
            fallbacks.append(i + 1)
            placeholder(b["narration"], path, i)
        return f"{JOB}/img_{i + 1:02d}.jpg"

    with ThreadPoolExecutor(4) as ex:
        images = list(ex.map(make, range(len(beats))))
    if fallbacks:
        tg(f"⚠️ Image generation failed for beat(s) {fallbacks}; used plain backgrounds there.")

    times = split_beats(beats, words, total)
    music = spec.get("music") or "docu-pluck"
    mpath = f"library/music/clips/{music}.mp3"
    props = {
        "title": spec.get("title", ""),
        "audio": f"{JOB}/voice.mp3",
        "music": mpath if os.path.exists(os.path.join(ROOT, "media", mpath)) else None,
        "musicVolume": float(spec.get("music_volume", 0.1)),
        "accent": spec.get("accent", "#FFD43B"),
        "duration": round(total + 0.8, 2),
        "beats": [{"image": img, "text": b["narration"], **t} for img, b, t in zip(images, beats, times)],
        "words": words,
    }
    json.dump(props, open(os.path.join(OUT, "props.json"), "w"), indent=1)
    tg(f"🎬 Editing the video ({total:.0f}s)...")
    print("props written")


if __name__ == "__main__":
    main()
