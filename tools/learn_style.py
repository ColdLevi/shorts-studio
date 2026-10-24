#!/usr/bin/env python3
"""Learn a video style from a reference video and hand it to the Studio bot as a reusable style recipe.

Runs on GitHub Actions (workflow learn-style.yml), started by the bot when the user sends a reference
(a YouTube/TikTok/any link, or a video file uploaded in Telegram).

1. Get the video: Telegram file (bot API, up to 20 MB) or yt-dlp (first 3 minutes, 720p max).
2. Measure it with ffmpeg: shape, fps, cuts per minute and average shot length, how many frames are
   held/duplicated (stop-motion feel), brightness and colour saturation, loudness.
3. Make a contact sheet of 12 frames across the video.
4. Gemini looks at the contact sheet + measurements (and watches the video itself when it is on YouTube)
   and writes a style recipe in Shorts Studio's own render tokens (captions, transitions, camera motion,
   texture, frame hold, backdrop, grade, palette, graphics mix, pacing, image style).
5. POST it to the bot (<proxy>/api/studio?event=style), which saves it to shared memory and uses it.

Env: SOURCE (url or tg:<file_id>), STYLE_NAME, TELEGRAM_TOKEN, CHAT_ID, GEMINI_API_KEY, APP_URL.
"""
import base64, glob, hashlib, json, os, re, subprocess, sys, urllib.request

OUT = "job/ref"
os.makedirs(OUT, exist_ok=True)
SRC = (os.environ.get("SOURCE") or "").strip()
NAME = re.sub(r"[^a-z0-9-]+", "-", (os.environ.get("STYLE_NAME") or "my-style").lower()).strip("-")[:30] or "my-style"
TG = os.environ.get("TELEGRAM_TOKEN") or ""
CHAT = os.environ.get("CHAT_ID") or ""
GEM = os.environ.get("GEMINI_API_KEY") or ""
APP = os.environ.get("APP_URL") or ""

RECIPES = ["stop-motion", "documentary", "motion-explainer", "blueprint", "kinetic-news", "cinematic", "retro-vhs", "anime", "vlog",
           "bold-pop", "minimal", "neon", "punchy", "comic", "karaoke"]
TRANSITIONS = ["cut", "fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down", "zoom-in", "zoom-out", "wipe", "blur", "flash"]
CAPTIONS = ["bold-pop", "karaoke-box", "clean", "subtitle", "neon", "word-by-word", "none"]
FONTS = ["Montserrat", "Anton", "Bebas Neue", "Inter", "Poppins", "Oswald", "Roboto", "Playfair Display", "Bangers", "Space Grotesk",
         "Archivo Black", "Lora", "DM Serif Display", "Permanent Marker", "Rubik Mono One"]
MUSIC = ["docu-pluck", "cinematic-min", "ambient-pad", "lofi-warm", "tech-pulse", "lullaby-tender"]


def tg(text):
    if TG and CHAT:
        try:
            urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{TG}/sendMessage",
                data=json.dumps({"chat_id": CHAT, "text": text[:3500]}).encode(), headers={"Content-Type": "application/json"}), timeout=20)
        except Exception as e:
            print("tg", e)


def run(cmd, timeout=600):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def download():
    if SRC.startswith("tg:"):
        fid = SRC[3:]
        d = json.loads(urllib.request.urlopen(f"https://api.telegram.org/bot{TG}/getFile?file_id={fid}", timeout=30).read())
        path = d["result"]["file_path"]
        dest = os.path.join(OUT, "ref" + (os.path.splitext(path)[1] or ".mp4"))
        with open(dest, "wb") as f:
            f.write(urllib.request.urlopen(f"https://api.telegram.org/file/bot{TG}/{path}", timeout=120).read())
        return dest
    run([sys.executable, "-m", "pip", "install", "-q", "-U", "yt-dlp"], 300)
    r = run([sys.executable, "-m", "yt_dlp", "-q", "--no-playlist", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
             "--download-sections", "*0-180", "--max-filesize", "300M", "-o", os.path.join(OUT, "ref.%(ext)s"), SRC], 900)
    files = [f for f in glob.glob(os.path.join(OUT, "ref.*")) if not f.endswith((".part", ".ytdl"))]
    if not files:
        print("yt-dlp failed:", (r.stderr or "")[-600:])
        return None
    return files[0]


def measure(path):
    m = {}
    pr = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", path])
    j = json.loads(pr.stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    w, h = int(st.get("width") or 0), int(st.get("height") or 0)
    num, _, den = (st.get("r_frame_rate") or "30/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30
    dur = float((j.get("format") or {}).get("duration") or 0)
    m.update(width=w, height=h, fps=round(fps, 2), duration_s=round(dur, 1),
             aspect="9:16" if h > w * 1.4 else "4:5" if h > w * 1.1 else "1:1" if h > w * 0.85 else "16:9")
    # cuts: scene-change score above 0.32
    sc = run(["ffmpeg", "-hide_banner", "-i", path, "-vf", "select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"], 900)
    cuts = len(re.findall(r"pts_time:", sc.stderr or ""))
    m["cuts"] = cuts
    m["cuts_per_min"] = round(cuts / max(0.1, dur / 60), 1)
    m["avg_shot_s"] = round(dur / max(1, cuts + 1), 2)
    # held frames: share of frames mpdecimate drops as duplicates (stop motion / animation on twos)
    md = run(["ffmpeg", "-hide_banner", "-i", path, "-t", "60", "-vf", "mpdecimate,showinfo", "-an", "-f", "null", "-"], 600)
    kept = len(re.findall(r"pts_time:", md.stderr or ""))
    total = max(1, int(min(60, dur) * fps))
    m["held_frame_share"] = round(max(0.0, 1 - kept / total), 2)
    # brightness / saturation (YUV averages, 0-255)
    ss = run(["ffmpeg", "-hide_banner", "-i", path, "-t", "90", "-vf", "fps=2,signalstats,metadata=print", "-an", "-f", "null", "-"], 600)
    ys = [float(x) for x in re.findall(r"signalstats\.YAVG=([\d.]+)", ss.stderr or "")]
    sats = [float(x) for x in re.findall(r"signalstats\.SATAVG=([\d.]+)", ss.stderr or "")]
    if ys:
        m["brightness_0_255"] = round(sum(ys) / len(ys))
    if sats:
        m["saturation_0_128"] = round(sum(sats) / len(sats))
    ln = run(["ffmpeg", "-hide_banner", "-i", path, "-t", "90", "-af", "ebur128", "-f", "null", "-"], 600)
    lu = re.findall(r"I:\s+(-?[\d.]+) LUFS", ln.stderr or "")
    if lu:
        m["loudness_lufs"] = float(lu[-1])
    return m


def contact_sheet(path, dur):
    frames = []
    for k in range(12):
        t = max(0.3, dur * (k + 0.5) / 12)
        f = os.path.join(OUT, f"f{k:02d}.jpg")
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", "-vf", "scale=360:360:force_original_aspect_ratio=decrease,pad=360:360:(ow-iw)/2:(oh-ih)/2:black", f])
        if os.path.exists(f):
            frames.append(f)
    if not frames:
        return None
    sheet = os.path.join(OUT, "sheet.jpg")
    inputs = sum([["-i", f] for f in frames], [])
    n = len(frames)
    layout = "|".join(f"{(i % 4) * 360}_{(i // 4) * 360}" for i in range(n))
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", f"xstack=inputs={n}:layout={layout}:fill=black", "-frames:v", "1", "-q:v", "4", sheet])
    return sheet if os.path.exists(sheet) else None


PROMPT = """You are an expert motion designer and video editor. Study this reference video and describe its STYLE so a
code-based renderer can reproduce it on any topic. %s
Measurements from ffmpeg (trust these over guesses): %s

Return JSON only:
{"summary": "2-3 sentences: what makes this style recognisable",
 "base": one of %s (the closest built-in look),
 "mode": "motion-graphics" (mostly drawn animation, icons, charts, kinetic type) | "footage" (real video) | "illustrated" (still art/AI images) | "stop-motion" | "mixed",
 "graphic_ratio": 0.0-1.0 (share of scenes that are drawn motion graphics rather than pictures or footage),
 "beat_seconds": typical seconds per scene (use avg_shot_s),
 "image_style": "one sentence art direction for image prompts (medium, lighting, palette, texture, camera)",
 "format": "vertical" | "landscape" | "square",
 "music": one of %s,
 "pacing": "1 sentence",
 "writer_notes": "2-3 sentences: narration tone, hook style, structure, humour",
 "style_tokens": {
   "caption": {"preset": one of %s, "font": one of %s, "case": "upper"|"none", "position": "auto"|"top"|"middle"|"bottom", "highlight": "#hex", "color": "#hex"},
   "font": one of the fonts (titles and graphics),
   "transitions": [2 to 5 of %s, the ones this editor uses, in rough order of frequency],
   "motion": "kenburns" | "static" | "parallax" | "drift" | "handheld",
   "fx": {"hold": 1-3 (2 = animated on twos / stop motion; use held_frame_share > 0.35 as the sign), "jitter": 0-8, "texture": "none"|"paper"|"grain"|"film"|"vhs", "letterbox": 0-0.12, "flicker": true|false},
   "backdrop": "none"|"grid"|"gradient"|"paper"|"blueprint"|"dots" (background behind motion graphics),
   "grade": "CSS filter, e.g. contrast(1.08) saturate(0.85) sepia(0.15)",
   "accent": "#hex (the main highlight colour)", "palette": ["#hex background", "#hex second colour"],
   "progress_bar": true|false, "vignette": true|false}}"""


def gemini(sheet, metrics):
    parts = []
    yt = re.search(r"(youtube\.com|youtu\.be)/", SRC or "")
    watch = "Watch the whole video (picture and sound)." if yt else "You see a contact sheet of 12 frames across the video, left to right, top to bottom."
    if yt:
        parts.append({"file_data": {"file_uri": SRC}})
    if sheet:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(open(sheet, "rb").read()).decode()}})
    parts.append({"text": PROMPT % (watch, json.dumps(metrics), json.dumps(RECIPES), json.dumps(MUSIC), json.dumps(CAPTIONS), json.dumps(FONTS), json.dumps(TRANSITIONS))})
    body = {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "mediaResolution": "MEDIA_RESOLUTION_LOW"}}
    errs = []
    for model in [os.environ.get("GEMINI_VIDEO_MODEL"), "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"]:
        if not model:
            continue
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                         data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": GEM})
            d = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
            t = "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"])
            return json.loads(t[t.find("{"): t.rfind("}") + 1])
        except Exception as e:
            errs.append(f"{model}: {str(e)[:120]}")
    raise RuntimeError("; ".join(errs))


def clean(r, metrics):
    """Keep only tokens the renderer understands."""
    st = r.get("style_tokens") or {}
    hexc = lambda v: v if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None
    cap = st.get("caption") or {}
    cap = {k: v for k, v in {"preset": cap.get("preset") if cap.get("preset") in CAPTIONS else None,
                             "font": cap.get("font") if cap.get("font") in FONTS else None,
                             "case": cap.get("case") if cap.get("case") in ("upper", "none", "lower") else None,
                             "position": cap.get("position") if cap.get("position") in ("auto", "top", "middle", "bottom") else None,
                             "highlight": hexc(cap.get("highlight")), "color": hexc(cap.get("color"))}.items() if v}
    fx = st.get("fx") or {}
    fxo = {}
    try:
        fxo["hold"] = max(1, min(3, int(fx.get("hold") or 1)))
        fxo["jitter"] = max(0, min(8, float(fx.get("jitter") or 0)))
        fxo["letterbox"] = max(0, min(0.12, float(fx.get("letterbox") or 0)))
    except (TypeError, ValueError):
        pass
    if metrics.get("held_frame_share", 0) > 0.4 and fxo.get("hold", 1) == 1:
        fxo["hold"] = 2
    if fx.get("texture") in ("none", "paper", "grain", "film", "vhs"):
        fxo["texture"] = fx["texture"]
    if isinstance(fx.get("flicker"), bool):
        fxo["flicker"] = fx["flicker"]
    tokens = {
        "caption": cap or None,
        "font": st.get("font") if st.get("font") in FONTS else None,
        "transitions": [x for x in (st.get("transitions") or []) if x in TRANSITIONS][:5] or None,
        "motion": st.get("motion") if st.get("motion") in ("kenburns", "static", "parallax", "drift", "handheld") else None,
        "fx": fxo or None,
        "backdrop": st.get("backdrop") if st.get("backdrop") in ("none", "grid", "gradient", "paper", "blueprint", "dots") else None,
        "grade": st.get("grade") if isinstance(st.get("grade"), str) and re.fullmatch(r"[a-z\-]+\([0-9.\-]+(deg|%|px)?\)( [a-z\-]+\([0-9.\-]+(deg|%|px)?\))*", st["grade"].strip()) else None,
        "accent": hexc(st.get("accent")),
        "palette": [c for c in (st.get("palette") or []) if hexc(c)][:3] or None,
        "progress_bar": st.get("progress_bar") if isinstance(st.get("progress_bar"), bool) else None,
        "vignette": st.get("vignette") if isinstance(st.get("vignette"), bool) else None,
    }
    tokens = {k: v for k, v in tokens.items() if v is not None}
    if tokens.get("transitions"):
        tokens["transition"] = {"type": tokens["transitions"][0], "duration": 0 if tokens["transitions"][0] == "cut" else 0.35}
    try:
        gr = max(0.0, min(1.0, float(r.get("graphic_ratio") or 0)))
    except (TypeError, ValueError):
        gr = 0.3
    try:
        beat = max(1.5, min(12.0, float(r.get("beat_seconds") or metrics.get("avg_shot_s") or 4)))
    except (TypeError, ValueError):
        beat = 4.0
    fmt = r.get("format") if r.get("format") in ("vertical", "landscape", "square") else {"9:16": "vertical", "16:9": "landscape", "1:1": "square"}.get(metrics.get("aspect"), "vertical")
    return {"name": NAME, "source": SRC if not SRC.startswith("tg:") else "telegram upload", "summary": str(r.get("summary") or "")[:400],
            "base": r.get("base") if r.get("base") in RECIPES else "bold-pop", "mode": r.get("mode") if r.get("mode") in ("motion-graphics", "footage", "illustrated", "stop-motion", "mixed") else "mixed",
            "graphic_ratio": round(gr, 2), "beat_seconds": round(beat, 1), "image_style": str(r.get("image_style") or "")[:300],
            "format": fmt, "music": r.get("music") if r.get("music") in MUSIC else "docu-pluck", "pacing": str(r.get("pacing") or "")[:200],
            "writer_notes": str(r.get("writer_notes") or "")[:500], "style_tokens": tokens, "metrics": metrics}


def main():
    if not SRC:
        sys.exit("SOURCE missing")
    tg("🔬 Studying your reference video: cuts, pacing, motion, colours, captions...")
    path = download()
    metrics, sheet = {}, None
    if path:
        metrics = measure(path)
        sheet = contact_sheet(path, metrics.get("duration_s") or 10)
    elif not re.search(r"(youtube\.com|youtu\.be)/", SRC):
        tg("⚠️ I couldn't download that video. Send it as a file in this chat (up to 20 MB), or a YouTube link.")
        sys.exit(1)
    print("metrics", json.dumps(metrics))
    style = clean(gemini(sheet, metrics), metrics)
    json.dump(style, open(os.path.join(OUT, "style.json"), "w"), indent=2)
    print(json.dumps(style, indent=2))
    if not APP:
        return
    base = APP.split("/api/")[0]
    key = hashlib.sha256(TG.encode()).hexdigest()[:32]
    req = urllib.request.Request(base + "/api/studio?event=style", data=json.dumps({"style": style}).encode(),
                                 headers={"Content-Type": "application/json", "x-studio-key": key})
    print(urllib.request.urlopen(req, timeout=60).read()[:300])


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        tg(f"⚠️ I couldn't learn that style: {str(e)[:300]}")
        raise
