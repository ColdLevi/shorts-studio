# user_assets.py: the user's own clips, images, voice-over and music -> placed into the build (step-assets)
# Called from tools/build_short.py. Everything here fails soft: a problem means "generate it instead".
import os, re, sys, json, shutil, subprocess, urllib.request, urllib.parse

TMP = "/tmp/user_assets"
STOP = set("the a an and or but of to in on at for with from by is are was were be been it its this that these those as you your i we our they their he she his her not no so do does did".split())


def _run(cmd, timeout=300):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def duration(path):
    try:
        r = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], 60)
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def _download(file_id, dest_base):
    tok = os.environ.get("TELEGRAM_TOKEN", "")
    if not tok or not file_id:
        return None
    try:
        q = urllib.parse.urlencode({"file_id": file_id})
        info = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getFile?{q}", timeout=30))
        fp = info["result"]["file_path"]
        ext = os.path.splitext(fp)[1] or ".bin"
        dest = dest_base + ext
        with urllib.request.urlopen(f"https://api.telegram.org/file/bot{tok}/{fp}", timeout=120) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
        return dest
    except Exception as e:
        print("user asset download failed:", str(e)[:160])
        return None


def fetch_all(spec, outdir=None):
    items = [dict(x) for x in (spec.get("user_assets") or []) if isinstance(x, dict)]
    os.makedirs(TMP, exist_ok=True)
    for i, it in enumerate(items):
        if not it.get("path"):
            it["path"] = _download(it.get("file_id"), os.path.join(TMP, f"u{i + 1}"))
    spec["user_assets"] = [it for it in items if it.get("path") and os.path.exists(it["path"])]
    print(f"user assets: {len(spec['user_assets'])} of {len(items)} downloaded")
    return spec["user_assets"]


def _words(s):
    return {w for w in re.findall(r"[a-z0-9']+", str(s).lower()) if len(w) > 2 and w not in STOP}


def plan(spec, beats, tg=print):
    # which beat gets which image or clip: "beat 3" in the caption, else best word overlap, else spread evenly
    items = [x for x in (spec.get("user_assets") or []) if x.get("kind") in ("image", "video")]
    if not items:
        return {}
    n = len(beats)
    taken, rest = {}, []
    for it in items:
        m = re.search(r"(?:beat|scene|shot|slide|clip|line|#)\s*(\d{1,2})", it.get("caption") or "", re.I)
        k = int(m.group(1)) - 1 if m else -1
        if 0 <= k < n and k not in taken:
            taken[k] = it
        else:
            rest.append(it)
    free = [i for i in range(n) if i not in taken and not (beats[i].get("graphic") or beats[i].get("scene"))]
    left = []
    for it in rest:
        cw = _words(it.get("caption") or "")
        best, bs = None, 0
        for i in free:
            sc = len(cw & _words(str(beats[i].get("narration", "")) + " " + str(beats[i].get("image_prompt", ""))))
            if sc > bs:
                best, bs = i, sc
        if best is not None:
            taken[best] = it
            free.remove(best)
        else:
            left.append(it)
    dropped = 0
    if left and free:
        m = min(len(left), len(free))
        picks = [free[0]] if m == 1 else [free[round(k * (len(free) - 1) / (m - 1))] for k in range(m)]
        for it, i in zip(left, picks):
            taken[i] = it
        dropped = len(left) - m
    else:
        dropped = len(left)
    for i in taken:
        b = beats[i]
        b["tool"] = "flux"
        for k in ("graphic", "scene", "motion", "query"):
            b.pop(k, None)
    if taken:
        parts = [f"{'clip' if it['kind'] == 'video' else 'image'} on beat {i + 1}" for i, it in sorted(taken.items())]
        tg("📎 Your files: " + ", ".join(parts) + (f". {dropped} extra file(s) had no free beat, so I left them out." if dropped else "."))
    return taken


def _fit_image(src, dst, W, H):
    from PIL import Image, ImageOps
    im = Image.open(src)
    im = ImageOps.exif_transpose(im).convert("RGB")
    ImageOps.fit(im, (int(W), int(H)), Image.LANCZOS).save(dst, quality=92)


def make_still(item, dst, W, H, ref):
    src = item["path"]
    if item["kind"] == "video":
        frame = os.path.join(TMP, os.path.basename(dst))
        _run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.3", "-i", src, "-frames:v", "1", frame], 120)
        if not os.path.exists(frame):
            _run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-frames:v", "1", frame], 120)
        src = frame
    _fit_image(src, dst, W, H)
    return ref


def apply_videos(umap, clips, times, cv, OUT, JOB, tg=print):
    w, h, fps = int(cv["width"]), int(cv["height"]), int(cv.get("fps") or 30)
    for i, it in sorted(umap.items()):
        if it["kind"] != "video":
            continue
        want = (times[i]["end"] - times[i]["start"]) + 0.4
        out = os.path.join(OUT, f"clip_{i + 1:02d}.mp4")
        vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps},format=yuv420p"
        r = _run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", it["path"], "-t", f"{want:.2f}", "-vf", vf,
                  "-an", "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", out], 400)
        d = duration(out) if os.path.exists(out) else 0
        if r.returncode or d < 0.5:
            print("user clip failed, keeping its first frame as a still:", r.stderr[:160])
            continue
        clips[i] = {"video": f"{JOB}/clip_{i + 1:02d}.mp4", "videoDuration": round(d, 2)}


def _asr(path):
    try:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "faster-whisper"], capture_output=True, timeout=500)
            if r.returncode:
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--break-system-packages", "faster-whisper"], check=True, timeout=500)
            from faster_whisper import WhisperModel
        model = WhisperModel(os.environ.get("UA_WHISPER", "small"), device="cpu", compute_type="int8")
        segs, _ = model.transcribe(path, word_timestamps=True, beam_size=1)
        words = []
        for sg in segs:
            for w in (sg.words or []):
                t = w.word.strip()
                if t:
                    words.append({"word": t, "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
        return words
    except Exception as e:
        print("speech timing failed, using estimated timing:", str(e)[:200])
        return []


def _estimate(beats, total):
    toks = " ".join(str(b["narration"]).strip() for b in beats).split()
    weights = [len(re.sub(r"[^0-9A-Za-z]", "", t)) + 2 for t in toks]
    span, t0, out = total * 0.97 / sum(weights), total * 0.015, []
    for tok, wt in zip(toks, weights):
        out.append({"word": tok, "start": round(t0, 3), "end": round(t0 + span * wt * 0.9, 3)})
        t0 += span * wt
    return out


def _norm(t):
    return re.sub(r"[^0-9a-z]", "", str(t).lower())


def _script_cuts(beats, words, fallback):
    """Index of the spoken word where each beat after the first starts, found by aligning the script to the spoken words
    (so a skipped, added or reworded line does not shift the cuts). Returns (cuts, per-beat match scores), or (fallback, None)
    when too little of the script was found in the speech."""
    import difflib
    W = len(words)
    stoks, owner, bounds = [], [], []
    for bi, b in enumerate(beats):
        for x in str(b["narration"]).split():
            x = _norm(x)
            if x:
                stoks.append(x)
                owner.append(bi)
        bounds.append(len(stoks))
    wtoks = [(_norm(w["word"]) or "\0%d" % k) for k, w in enumerate(words)]
    if not stoks or not W:
        return fallback, None
    anchors = []
    for a, b, n in difflib.SequenceMatcher(None, stoks, wtoks, autojunk=False).get_matching_blocks():
        for k in range(n):
            anchors.append((a + k, b + k))
    if len(anchors) < 0.5 * len(stoks):
        return fallback, None

    def where(sp):
        prev, nxt = (-1, -1), (len(stoks), W)
        for a in anchors:
            if a[0] < sp:
                prev = a
            else:
                nxt = a
                break
        gs, gw = nxt[0] - prev[0] - 1, nxt[1] - prev[1] - 1
        return prev[1] + 1 + int(round((sp - (prev[0] + 1)) * gw / max(1, gs)))

    cuts = [where(bounds[k]) for k in range(len(beats) - 1)]
    hit = [0] * len(beats)
    for a in anchors:
        hit[owner[a[0]]] += 1
    cnt = [max(1, sum(1 for o in owner if o == bi)) for bi in range(len(beats))]
    return cuts, [round(hit[bi] / cnt[bi], 2) for bi in range(len(beats))]


def _report(tg, est, beats, words, total):
    """Plain-language check of the voice-over cut: estimates, too short or too long scenes, lines said differently."""
    notes = []
    if est:
        notes.append("I could not read the timing of your voice-over, so the cuts are estimates")
    k = 0
    for i, b in enumerate(beats):
        c = len(str(b["narration"]).split())
        if not c or k >= len(words):
            continue
        t0 = float(words[k]["start"]) if i else 0.0
        t1 = float(words[min(len(words), k + c) - 1]["end"])
        k += c
        if t1 - t0 < 1.0:
            notes.append("scene %d is short (%.1fs)" % (i + 1, t1 - t0))
        elif t1 - t0 > 6.0:
            notes.append("scene %d runs long (%.1fs)" % (i + 1, t1 - t0))
        m = b.get("vo_match")
        if m is not None and m < 0.6:
            notes.append("scene %d: you said it differently from the script" % (i + 1))
    print("VO REPORT:", notes or "all scenes matched the script")
    if notes:
        try:
            tg("🎙️ Voice-over check: " + "; ".join(notes[:6]))
        except Exception:
            pass


def align(beats, words):
    # re-cut the beats on the voice-over's own words, near the old proportions, snapped to sentence ends
    n, W = len(beats), len(words)
    if n == 0 or W < n:
        return
    old = [max(1, len(str(b["narration"]).split())) for b in beats]
    tot = float(sum(old))
    cuts, acc = [], 0.0
    for c in old[:-1]:
        acc += c
        cuts.append(int(round(acc / tot * W)))
    cuts, scores = _script_cuts(beats, words, cuts)
    orig = [str(b["narration"]) for b in beats]
    snapped, prev = [], 0
    for k, c in enumerate(cuts):
        lo, hi = prev + 1, W - (n - 1 - k)
        best, bd = max(lo, min(hi, c)), 99
        for j in range(max(lo, c - 3), min(hi, c + 3) + 1):
            if words[j - 1]["word"][-1:] in ".?!,;:":
                d = abs(j - c) + (0 if words[j - 1]["word"][-1:] in ".?!" else 1)
                if d < bd:
                    best, bd = j, d
        snapped.append(best)
        prev = best
    edges = [0] + snapped + [W]
    for i, b in enumerate(beats):
        b["narration"] = " ".join(w["word"] for w in words[edges[i]:edges[i + 1]])
        b["script_text"] = orig[i]
        if scores is not None:
            b["vo_match"] = scores[i]


def _to_mp3(src, dst, limit=None):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-ar", "44100", "-b:a", "192k"]
    if limit:
        cmd += ["-t", str(limit)]
    r = _run(cmd + [dst], 400)
    return r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 1000


def voiceover(spec, items, beats, voice_path, tg=print):
    vo = next((x for x in items if x.get("role") == "voiceover"), None)
    if not vo or not _to_mp3(vo["path"], voice_path):
        return None
    total = duration(voice_path)
    if total < 2:
        return None
    tg("🎙️ Using your voice-over (replacing the AI voice)...")
    words = _asr(voice_path)
    est = False
    if len(words) < len(beats):
        words = _estimate(beats, total)
        est = True
    align(beats, words)
    _report(tg, est, beats, words, total)
    return words, total


def music_path(spec, items, OUT, JOB, default):
    mu = next((x for x in items if x.get("role") == "music"), None)
    if mu and _to_mp3(mu["path"], os.path.join(OUT, "user_music.mp3"), 240):
        return f"{JOB}/user_music.mp3"
    return default


KEY_RX = re.compile(r"green\s*-?screen|blue\s*-?screen|chroma\s*-?key|^\s*key\b", re.I)
KEY_POS = {"full": (0.5, 0.5, 1.0), "center": (0.5, 0.6, 0.7), "left": (0.3, 0.6, 0.55), "right": (0.7, 0.6, 0.55)}
KEY_MENU = [(8, 0.08, 0.04), (20, 0.14, 0.08), (999, 0.22, 0.12)]   # edge colour spread -> (similarity, blend)


def split_key(spec):
    try:
        keep, keyed = [], []
        for it in spec.get("user_assets") or []:
            if it.get("kind") == "video" and KEY_RX.search(it.get("caption") or ""):
                keyed.append(it)
            else:
                keep.append(it)
        if keyed:
            spec["user_assets"] = keep
            spec["_key_items"] = keyed
        return keyed
    except Exception as e:
        print("key split skipped:", e)
        return []


def key_clips(spec, beats, times, cv, OUT, JOB, tg=print, taken=None):
    import subprocess, tempfile
    items = spec.pop("_key_items", None) or []
    if not items:
        return
    from PIL import Image

    def has(flag, name):
        r = subprocess.run(["ffmpeg", "-hide_banner", flag], capture_output=True, text=True)
        return name in (r.stdout or "") + (r.stderr or "")

    if not (has("-filters", "chromakey") and has("-encoders", "libvpx-vp9")):
        tg("🟩 Your green-screen clip is left out: ffmpeg on this machine cannot make transparent video.")
        return
    n, used, done = len(beats), set(taken or {}), []
    spec["keyed"] = done
    for k, it in enumerate(items):
        cap = it.get("caption") or ""
        m = re.search(r"(?:beat|scene|shot|slide|clip|line|#)\s*(\d{1,2})", cap, re.I)
        i = int(m.group(1)) - 1 if m else (n // 2 if len(items) == 1 else round(k * (n - 1) / (len(items) - 1)))
        while i in used and i < n - 1:
            i += 1
        if not (0 <= i < n) or i in used or i >= len(times):
            tg("🟩 No free beat for a green-screen clip, so I left it out.")
            continue
        src = it.get("path")
        if not src or not os.path.exists(src):
            tg("🟩 I could not read your green-screen clip, so I left it out.")
            continue
        fr = os.path.join(tempfile.mkdtemp(), "f.jpg")
        for ss in (["-ss", "0.3"], []):
            if not os.path.exists(fr):
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error"] + ss + ["-i", src, "-frames:v", "1", fr], capture_output=True)
        if not os.path.exists(fr):
            tg("🟩 I could not read a frame from your green-screen clip, so I left it out.")
            continue
        im = Image.open(fr).convert("RGB")
        ar = im.size[0] / float(im.size[1])
        sm = im.resize((48, 48))
        px = [sm.getpixel((x, y)) for x in range(48) for y in range(48) if min(x, y, 47 - x, 47 - y) < 3]
        mean = [sum(p[c] for p in px) / float(len(px)) for c in range(3)]
        spread = sum(abs(p[c] - mean[c]) for p in px for c in range(3)) / (3.0 * len(px))
        if not (mean[1] - max(mean[0], mean[2]) > 40 or mean[2] - max(mean[0], mean[1]) > 40):
            tg("🟩 Beat %d: the clip has no flat green or blue background at its edges, so I left it out." % (i + 1))
            continue
        sim, blend = next((a, b) for lim, a, b in KEY_MENU if spread < lim)
        hexc = "0x%02x%02x%02x" % tuple(int(round(v)) for v in mean)
        want = (times[i]["end"] - times[i]["start"]) + 0.4
        out = os.path.join(OUT, "key_%02d.webm" % (i + 1))
        vf = "scale='min(720,iw)':-2,chromakey=%s:%.2f:%.2f,format=yuva420p" % (hexc, sim, blend)
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", src, "-t", "%.2f" % want, "-vf", vf, "-an",
                            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "34",
                            "-deadline", "realtime", "-cpu-used", "5", out], capture_output=True, text=True, timeout=900)
        if r.returncode or not os.path.exists(out):
            print("key encode failed:", (r.stderr or "")[:200])
            tg("🟩 Beat %d: keying your clip failed, so I left it out." % (i + 1))
            continue
        pos = next((w for w in ("left", "right", "center", "full") if re.search(r"\b" + w + r"\b", cap, re.I)), None)
        pos = pos or ("center" if ar < 0.8 else "full")
        x, y, w = KEY_POS[pos]
        done.append({"beat": i, "src": "%s/key_%02d.webm" % (JOB, i + 1), "ar": round(ar, 4), "x": x, "y": y, "w": w, "pos": pos})
        used.add(i)
        tg("🟩 Green-screen clip keyed on beat %d (%s)." % (i + 1, pos))
