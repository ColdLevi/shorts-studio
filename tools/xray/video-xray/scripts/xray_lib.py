"""
video-xray · core analysis library
==================================
Measured-evidence toolkit for reverse-engineering how a video was made.

Every function here returns MEASUREMENTS (numbers with units), never verdicts.
Verdict rules live in video_xray.py so agents can audit and retune them.

Requirements : Python 3.10+, ffmpeg/ffprobe on PATH, numpy, Pillow (sheets only)
Optional     : pytesseract + tesseract (caption OCR)
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field

import numpy as np

# --------------------------------------------------------------------------
# tunable constants (exported so SKILL.md doctrine and code stay in sync)
# --------------------------------------------------------------------------
SCALE_W = 320          # analysis decode width (px)
MAX_FRAMES = 2400      # cap on decoded evidence frames
CADENCE_SECONDS = 10   # native-fps window used for frame-cadence scan
CADENCE_SCALE_W = 160

NOISE_PRESENT = 0.0040   # laplacian sigma in flat areas above this -> sensor grain
NOISE_CLEAN = 0.0015     # below this -> clean synthetic render
STATIC_TOTAL = 0.008     # mean |frame diff| below this -> static shot (covers grain-free stills)
RIGID_RATIO = 0.75       # 1 - residual/total above this -> whole plane moves together
ORGANIC_RATIO = 0.45     # below this -> parallax / subject motion
FLAT_COV_HIGH = 0.35     # top-8 quantized colour coverage -> flat graphic fills
FLAT_COV_GRAPHIC = 0.85  # near-total flat fills (flat-design motion graphics)
CRISP_GRAPHIC = 0.90     # nearly every edge pixel in top decile -> vector-crisp graphics
CRISP_RATIO = 0.25       # edge pixels in top decile -> crisp synthetic edges
UNIQUE_COLORS_GRAPHIC = 400   # (4-bit/channel, 160x90) below this -> limited palette
EDGE_PERSIST_BAND = 0.30      # per-row persistent edge density -> caption band
EDGE_PERSIST_PIXEL = 0.50     # per-pixel persistence inside a band

AUDIO_SR = 22050
BPM_MIN, BPM_MAX = 60, 180

# strings that identify AI *generation* tools when found in container metadata
AIGC_GENERATORS = [
    "sora", "veo", "kling", "runway", "gen-3", "gen-4", "pika", "luma",
    "dream machine", "pixverse", "minimax", "hailuo", "vidu", "seedance",
    "wan 2", "wanx", "hunyuan", "cogvideo", "suno", "udio", "heygen",
    "synthesia", "d-id", "viggle", "stable diffusion", "comfyui",
    "midjourney", "flux.1", "grok imagine",
]
# video *editors* that are NOT evidence of AI generation
AIGC_EDITORS = ["capcut", "premiere", "final cut", "davinci", "after effects", "vn editor"]


class XrayError(RuntimeError):
    pass


def check_env() -> list[str]:
    """Return list of problems; empty list = ready."""
    problems = []
    if shutil.which("ffmpeg") is None:
        problems.append("ffmpeg not found on PATH (install: apt install ffmpeg / brew install ffmpeg)")
    if shutil.which("ffprobe") is None:
        problems.append("ffprobe not found on PATH")
    return problems


def run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


# --------------------------------------------------------------------------
# 1. probe + metadata AIGC scan
# --------------------------------------------------------------------------
def ffprobe_json(path: str) -> dict:
    p = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path])
    if p.returncode != 0:
        raise XrayError(f"ffprobe failed: {p.stderr.strip()[:400]}")
    return json.loads(p.stdout)


def parse_fps(rate: str | None) -> float:
    if not rate:
        return 0.0
    m = re.match(r"^(\d+)/(\d+)$", rate)
    if m:
        d = int(m.group(2))
        return float(m.group(1)) / d if d else 0.0
    try:
        return float(rate)
    except ValueError:
        return 0.0


def scan_metadata(probe: dict) -> dict:
    """Look for AIGC generator / editor fingerprints in container+stream TAG VALUES only.

    Codec names/long-names are deliberately NOT scanned (e.g. 'udio' is a substring
    of 'Audio (Advanced Audio Coding)'). Matching uses word boundaries so tool
    names cannot hit inside ordinary words.
    """
    blobs: list[tuple[str, str]] = []
    fmt = probe.get("format", {})
    for k, v in (fmt.get("tags") or {}).items():
        blobs.append((f"format.tags.{k}", str(v)))
    for s in probe.get("streams", []):
        for k, v in (s.get("tags") or {}).items():
            blobs.append((f"stream[{s.get('index')}].tags.{k}", str(v)))
    generators, editors = [], []
    for where, text in blobs:
        low = text.lower()
        for g in AIGC_GENERATORS:
            if re.search(r"(?<![\w])" + re.escape(g) + r"(?![\w])", low):
                generators.append({"tool": g, "where": where, "value": text[:120]})
        for e in AIGC_EDITORS:
            if re.search(r"(?<![\w])" + re.escape(e) + r"(?![\w])", low):
                editors.append({"tool": e, "where": where, "value": text[:120]})
    # de-duplicate
    generators = [dict(t) for t in {(x["tool"], x["where"], x["value"]): x for x in generators}.values()]
    editors = [dict(t) for t in {(x["tool"], x["where"], x["value"]): x for x in editors}.values()]
    return {"generators": generators, "editors": editors,
            "all_tags": [{"where": w, "value": v[:200]} for w, v in blobs][:40]}


# --------------------------------------------------------------------------
# 2. shot boundary detection (ffmpeg scene scores)
# --------------------------------------------------------------------------
def detect_shots(path: str, threshold: float = 0.25,
                 min_shot_s: float = 0.8, max_shots: int = 400,
                 duration: float | None = None) -> list[dict]:
    """Return ordered boundaries [{'t': s, 'score': x}, ...] starting at 0.0."""
    p = run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
             "-vf", f"select='gt(scene,{threshold})',metadata=print:file=-",
             "-an", "-f", "null", "-"], timeout=900)
    times: list[float] = [0.0]
    scores: list[float] = [1.0]
    cur_t = None
    for line in (p.stdout + "\n" + p.stderr).splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            cur_t = float(m.group(1))
            continue
        m = re.search(r"lavfi\.scene_score=([\d.]+)", line)
        if m and cur_t is not None:
            times.append(cur_t)
            scores.append(float(m.group(1)))
            cur_t = None
    if duration is None:
        duration = times[-1] + 5.0  # fallback if caller did not pass duration
    merged: list[dict] = [{"t": 0.0, "score": 1.0}]
    for t, sc in zip(times[1:], scores[1:]):
        if t - merged[-1]["t"] >= min_shot_s:
            merged.append({"t": t, "score": sc})
    if len(merged) > max_shots:
        merged = merged[:max_shots]
        sys.stderr.write(f"[video-xray] warning: capped at {max_shots} shots\n")
    return merged


def shots_from_boundaries(bounds: list[dict], duration: float) -> list[dict]:
    out = []
    for i, b in enumerate(bounds):
        end = bounds[i + 1]["t"] if i + 1 < len(bounds) else duration
        out.append({"id": i + 1, "start": b["t"], "end": min(end, duration),
                    "cut_score": b["score"]})
    return [s for s in out if s["end"] - s["start"] > 0.05]


# --------------------------------------------------------------------------
# 3. decode frames for evidence (low-res, fixed fps)
# --------------------------------------------------------------------------
def decode_frames(path: str, fps: float, width: int = SCALE_W,
                  max_frames: int = MAX_FRAMES) -> tuple[list[float], np.ndarray]:
    """Decode whole video at `fps` into RGB uint8 array (N,H,W,3) + times."""
    probe = ffprobe_json(path)
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    W = int(vstream["width"]); H = int(vstream["height"])
    sw = min(width, W)
    sh = int(round(H * sw / W / 2)) * 2
    duration = float(probe["format"].get("duration", 0) or 0)
    if duration > 0 and duration * fps > max_frames:
        fps = max_frames / duration
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", path, "-vf", f"fps={fps:.4f},scale={sw}:{sh}:flags=bilinear",
           "-an", "-sn", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, timeout=900).stdout
    n = len(raw) // (sw * sh * 3)
    if n == 0:
        raise XrayError("no frames decoded — file unreadable or unsupported codec")
    frames = np.frombuffer(raw[:n * sw * sh * 3], dtype=np.uint8)\
                .reshape(n, sh, sw, 3)
    times = [round(i / fps, 3) for i in range(n)]
    return times, frames


# --------------------------------------------------------------------------
# 4. frame cadence (native-fps duplicate scan at video midpoint)
# --------------------------------------------------------------------------
def cadence_scan(path: str, nominal_fps: float) -> dict:
    """Detect low effective fps (animation / AI / screen) via duplicate frames."""
    probe = ffprobe_json(path)
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    W = int(vstream["width"]); H = int(vstream["height"])
    duration = float(probe["format"].get("duration", 0) or 0)
    mid = max(0.0, duration / 2 - CADENCE_SECONDS / 2)
    sw = min(CADENCE_SCALE_W, W)
    sh = int(round(H * sw / W / 2)) * 2
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-ss", f"{mid:.2f}", "-t", str(CADENCE_SECONDS), "-i", path,
           "-vf", f"scale={sw}:{sh}:flags=bilinear",
           "-an", "-sn", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, timeout=300).stdout
    n = len(raw) // (sw * sh * 3)
    if n < 8:
        return {"effective_fps": nominal_fps, "nominal_fps": nominal_fps,
                "duplicate_ratio": 0.0, "note": "sample too short"}
    frames = np.frombuffer(raw[:n * sw * sh * 3], dtype=np.uint8).reshape(n, sh, sw, 3)
    g = frames.astype(np.float32) / 255.0
    diffs = np.abs(g[1:] - g[:-1]).mean(axis=(1, 2, 3))
    dup = diffs < 0.002
    eff = (n - 1 - dup.sum()) / CADENCE_SECONDS if duration else nominal_fps
    # effective fps if content were captured at full sample rate:
    measured_seconds = (n - 1) / nominal_fps if nominal_fps else CADENCE_SECONDS
    eff = (n - 1 - int(dup.sum())) / measured_seconds if measured_seconds > 0 else nominal_fps
    return {"effective_fps": round(float(min(eff, nominal_fps)), 2),
            "nominal_fps": round(nominal_fps, 2),
            "duplicate_ratio": round(float(dup.mean()), 3),
            "sampled_seconds": round(measured_seconds, 2),
            "note": "measured at video midpoint at native fps"}


# --------------------------------------------------------------------------
# 5. frame-level evidence primitives (all inputs float32 gray 0..1)
# --------------------------------------------------------------------------
def laplacian(g: np.ndarray) -> np.ndarray:
    lap = (np.roll(g, 1, 0) + np.roll(g, -1, 0) +
           np.roll(g, 1, 1) + np.roll(g, -1, 1) - 4 * g)
    return np.abs(lap[2:-2, 2:-2])


def noise_sigma(g: np.ndarray) -> float:
    """Sensor-grain proxy: MAD of Laplacian inside flat (low-gradient) regions."""
    lap = laplacian(g)
    flat = lap < 0.02
    if flat.sum() < 500:
        flat = lap < np.percentile(lap, 60)
    v = lap[flat]
    med = np.median(v)
    return float(1.4826 * np.median(np.abs(v - med)))


def edge_crispness(g: np.ndarray) -> float:
    """Fraction of edge pixels whose magnitude is in the top decile (bimodal edges)."""
    lap = laplacian(g).ravel()
    hi = np.percentile(lap, 90)
    edge = lap > max(0.03, np.percentile(lap, 70))
    if edge.sum() < 50:
        return 0.0
    return float((lap[edge] >= hi).mean())


def color_stats(rgb: np.ndarray) -> dict:
    """Palette flatness / variety on a small thumbnail."""
    thumb = rgb[::2, ::2]  # ~160px
    q = (thumb >> 4).astype(np.uint8)          # 16 levels/channel
    packed = (q[..., 0].astype(np.int32) << 8) | (q[..., 1].astype(np.int32) << 4) | q[..., 2]
    vals, counts = np.unique(packed, return_counts=True)
    total = packed.size
    top8 = float(np.sort(counts)[::-1][:8].sum() / total)
    mx = thumb.max(axis=2).astype(np.float32); mn = thumb.min(axis=2).astype(np.float32)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0.0)
    return {"unique_colors": int(len(vals)),
            "flat_top8_coverage": round(top8, 3),
            "mean_saturation": round(float(sat.mean()), 3),
            "high_sat_fraction": round(float((sat > 0.5).mean()), 3)}


def _signed_shift(corr: np.ndarray) -> tuple[int, int]:
    H, W = corr.shape
    dy, dx = np.unravel_index(int(np.argmax(corr)), corr.shape)
    if dy > H // 2: dy -= H
    if dx > W // 2: dx -= W
    return int(dy), int(dx)


def global_motion(g1: np.ndarray, g2: np.ndarray) -> dict:
    """Phase-correlation translation + residual motion after compensation."""
    h, w = g1.shape
    win = np.hanning(h)[:, None] * np.hanning(w)[None, :]
    a = np.fft.fft2((g1 - g1.mean()) * win)
    b = np.fft.fft2((g2 - g2.mean()) * win)
    r = a * np.conj(b)
    r /= np.maximum(np.abs(r), 1e-9)
    dy, dx = _signed_shift(np.fft.ifft2(r).real)
    moved = np.roll(np.roll(g2, -dy, axis=0), -dx, axis=1)
    c = slice(int(h * 0.1), int(h * 0.9)), slice(int(w * 0.1), int(w * 0.9))
    total = float(np.abs(g2[c] - g1[c]).mean())
    resid = float(np.abs(moved[c] - g1[c]).mean())
    ratio = 1.0 - resid / total if total > 1e-5 else 1.0
    # zoom proxy: change of gradient-energy radius
    def radius(g):
        e = laplacian(g)
        ys, xs = np.mgrid[0:e.shape[0], 0:e.shape[1]]
        m = e.sum() + 1e-9
        cy = (ys * e).sum() / m; cx = (xs * e).sum() / m
        return float(math.sqrt((((ys - cy) ** 2) * e).sum() / m +
                               (((xs - cx) ** 2) * e).sum() / m))
    r1, r2 = radius(g1), radius(g2)
    zoom = (r2 - r1) / max(r1, 1e-6)
    return {"dx": dx, "dy": dy, "total": round(total, 5),
            "residual": round(resid, 5), "rigid_ratio": round(ratio, 3),
            "zoom_delta": round(float(zoom), 4)}


def motion_class(mov: dict) -> str:
    # order matters: rigid-plane needs real movement; tiny diffs are static even
    # when a compensating shift cannot be found (cursor blink, caption pop)
    if mov["total"] >= STATIC_TOTAL and mov["rigid_ratio"] >= RIGID_RATIO:
        return "rigid"          # whole plane moves together (screen pan, slide, code tween)
    if mov["total"] < STATIC_TOTAL:
        return "static"
    if mov["rigid_ratio"] < ORGANIC_RATIO:
        return "organic"        # parallax / subject motion (live or rich AI)
    return "mixed"


# --------------------------------------------------------------------------
# 6. persistent overlays: caption bands + sticker/PiP blobs
# --------------------------------------------------------------------------
def caption_bands(edge_stack: list[np.ndarray], shot_start: float, shot_end: float) -> list[dict]:
    """Rows of consistently-edgy pixels across a shot -> caption/overlay bands."""
    if len(edge_stack) < 2:
        return []
    P = np.stack(edge_stack).mean(axis=0)          # H x W persistence 0..1
    H, W = P.shape
    row = P.mean(axis=1)
    bands = []
    r0 = None
    for i, v in enumerate(row):
        if v >= EDGE_PERSIST_BAND and r0 is None:
            r0 = i
        elif v < EDGE_PERSIST_BAND and r0 is not None:
            if i - r0 >= max(3, int(H * 0.02)):
                seg = P[r0:i]
                col = seg.mean(axis=0)
                cols = np.where(col > EDGE_PERSIST_BAND * 0.6)[0]
                if len(cols) and (cols[-1] - cols[0]) < 0.92 * W:
                    c0, c1 = int(cols[0]), int(cols[-1])
                    bands.append({"row0": r0, "row1": i, "col0": c0, "col1": c1,
                                  "persist": round(float(seg.mean()), 3),
                                  "start": shot_start, "end": shot_end,
                                  "pos": ("top" if (r0 + i) / H < 0.33 else
                                          "bottom" if (r0 + i) / H > 0.66 else "middle")})
            r0 = None
    return bands


def merge_tracks(bands: list[dict]) -> list[dict]:
    """Merge same-position bands across consecutive shots into overlay tracks."""
    tracks: list[dict] = []
    for b in sorted(bands, key=lambda x: (x["start"], x["row0"])):
        for t in tracks:
            if (t["pos"] == b["pos"] and
                    abs(t["row0"] - b["row0"]) <= 4 and
                    b["start"] - t["end"] <= 0.75):
                t["end"] = b["end"]
                t["persist"] = max(t["persist"], b["persist"])
                break
        else:
            tracks.append(dict(b))
    return [t for t in tracks if t["end"] - t["start"] >= 0.5]


def ocr_band(path: str, t: float, band: dict, upscale: int = 3) -> str | None:
    """OCR a caption band from a native-resolution still (needs pytesseract).

    Band coordinates are in the 320-px analysis frame (minus the 2-px Laplacian
    crop), so they are mapped back through the scaled frame size first.
    """
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return None
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name
    try:
        p = run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{t:.2f}",
                 "-i", path, "-frames:v", "1", tmp], timeout=60)
        if p.returncode != 0:
            return None
        img = Image.open(tmp)
        W, H = img.size
        probe = ffprobe_json(path)
        v = next(s for s in probe["streams"] if s["codec_type"] == "video")
        nw, nh = int(v["width"]), int(v["height"])
        sw_s = min(SCALE_W, nw)
        sh_s = int(round(nh * sw_s / nw / 2)) * 2
        y0 = int((band["row0"] + 2) / sh_s * H) - 3
        y1 = int((band["row1"] + 2) / sh_s * H) + 3
        x0 = int((band["col0"] + 2) / sw_s * W)
        x1 = int((band["col1"] + 2) / sw_s * W)
        crop = img.crop((max(0, x0), max(0, y0), min(W, x1), min(H, y1)))
        crop = crop.resize((crop.width * upscale, crop.height * upscale), Image.LANCZOS)
        txt = pytesseract.image_to_string(crop, config="--psm 6").strip()
        return " ".join(txt.split()) or None
    except Exception:
        return None
    finally:
        import os
        try: os.unlink(tmp)
        except OSError: pass


# --------------------------------------------------------------------------
# 7. audio evidence
# --------------------------------------------------------------------------
def audio_metrics(path: str) -> dict | None:
    probe = ffprobe_json(path)
    if not any(s["codec_type"] == "audio" for s in probe["streams"]):
        return None
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", str(AUDIO_SR),
           "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, timeout=600).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    if x.size < AUDIO_SR:
        return {"note": "audio track too short to measure"}
    hop = AUDIO_SR // 100                      # 10 ms
    n = (x.size // hop) * hop
    rms = np.sqrt((x[:n].reshape(-1, hop) ** 2).mean(axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    # onsets: rectified energy flux
    flux = np.maximum(0.0, np.diff(db))
    thr = np.median(flux) + 3 * 1.4826 * np.median(np.abs(flux - np.median(flux)))
    peaks = [i for i in range(1, len(flux) - 1)
             if flux[i] > max(thr, 3.0) and flux[i] >= flux[i - 1] and flux[i] > flux[i + 1]]
    onsets = [round(i / 100.0, 2) for i in peaks][:200]
    # BPM: autocorrelation of onset strength over 60-180 BPM lags
    c = flux - flux.mean()
    ac = np.correlate(c, c, "full")[len(c):] / max(np.dot(c, c), 1e-9)
    lo, hi = int(100 * 60 / BPM_MAX), int(100 * 60 / BPM_MIN)   # lags in 10ms hops
    if hi < len(ac):
        seg = ac[lo:hi]
        k = int(np.argmax(seg)) + lo
        bpm = round(60.0 / (k / 100.0), 1)
        prominence = round(float(seg.max() / (np.median(np.abs(seg)) + 1e-9)), 2)
    else:
        bpm, prominence = None, 0.0
    # speech vs music proxy (ESTIMATE — labelled as such everywhere)
    med_db = float(np.median(db))
    floor_db = float(np.percentile(db, 5))
    pause = ((db < med_db - 12) & (db > floor_db + 3)).mean()
    if prominence >= 1.8 and pause < 0.08:
        sound = "music-like"
    elif pause > 0.12 and prominence < 1.6:
        sound = "speech-like"
    else:
        sound = "mixed/unclear"
    # leading / trailing silence
    loud = db > floor_db + 6
    lead = float(np.argmax(loud) / 100.0) if loud.any() else 0.0
    trail = float((len(loud) - 1 - np.argmax(loud[::-1])) / 100.0) if loud.any() else 0.0
    return {"duration_s": round(x.size / AUDIO_SR, 2),
            "bpm_estimate": bpm, "bpm_prominence": prominence,
            "onsets": onsets, "onset_count": len(onsets),
            "sound_class_estimate": sound, "pause_ratio": round(float(pause), 3),
            "lead_silence_s": round(lead, 2), "trail_silence_s": round(trail, 2),
            "note": "voice/music/SFX separation is heuristic; UVR-class models give real stems"}


def beat_align(cut_times: list[float], audio: dict | None) -> dict | None:
    """% of cuts landing on the inferred beat grid."""
    if not audio or not audio.get("bpm_estimate") or audio.get("bpm_prominence", 0) < 1.5:
        return None
    period = 60.0 / audio["bpm_estimate"]
    if not cut_times:
        return None
    phases = [(t / period) % 1.0 for t in cut_times]
    ang = [p * 2 * math.pi for p in phases]
    sx, sy = sum(math.cos(a) for a in ang), sum(math.sin(a) for a in ang)
    best = math.atan2(sy, sx) / (2 * math.pi) % 1.0
    on = sum(1 for p in phases if min(abs(p - best), 1 - abs(p - best)) * period < 0.06)
    return {"on_beat_pct": round(100.0 * on / len(phases), 1),
            "phase": round(best, 3), "bpm_used": audio["bpm_estimate"],
            "note": "grid-aligned phase search, ±60 ms tolerance"}
