#!/usr/bin/env python3
"""listen.py - measure how a video SOUNDS: speech, music bed, sound effects.

Usage:
    python3 tools/listen.py VIDEO_FILE [OUT_DIR] [--model base]

Needs: ffmpeg, numpy. Optional: faster-whisper (speech words, pace, pauses,
transcript). Without faster-whisper the speech parts fall back to a crude
energy detector and the transcript/words-per-minute are skipped.

Writes OUT_DIR/listen.json, OUT_DIR/LISTEN.md, OUT_DIR/transcript.txt.

Everything here is a MEASUREMENT or a rule-of-thumb label on a measurement.
It does not "hear" taste. Labels are marked heuristic.
"""
import json
import math
import os
import re
import subprocess
import sys

import numpy as np

SR = 16000
N = 1024            # fft window (64 ms)
HOP = 320           # 20 ms
FPS = SR / HOP      # frames per second (50)


# ---------------------------------------------------------------- loading
def load_audio(path):
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1",
         "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True)
    if p.returncode != 0 or not p.stdout:
        sys.exit("ffmpeg could not read audio: " + p.stderr.decode()[-300:])
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def loudness(path):
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn",
         "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True)
    tail = p.stderr.split("Summary:")[-1]
    out = {}
    for key, pat in (("lufs", r"I:\s+(-?[\d.]+) LUFS"),
                     ("lra", r"LRA:\s+([\d.]+) LU"),
                     ("true_peak_db", r"Peak:\s+(-?[\d.]+) dBFS")):
        m = re.search(pat, tail)
        out[key] = float(m.group(1)) if m else None
    return out


# ---------------------------------------------------------------- features
def frame_features(x):
    """Per 20 ms frame: rms_db, flux, centroid_hz, low/mid/high power share."""
    nfr = 1 + (len(x) - N) // HOP
    if nfr < 10:
        sys.exit("audio too short")
    win = np.hanning(N).astype(np.float32)
    freqs = np.fft.rfftfreq(N, 1 / SR).astype(np.float32)
    lo = freqs < 250
    hi = freqs >= 4000
    mid = ~lo & ~hi
    rms = np.zeros(nfr, np.float32)
    flux = np.zeros(nfr, np.float32)
    cen = np.zeros(nfr, np.float32)
    share = np.zeros((nfr, 3), np.float32)
    prev = None
    step = 2000
    for a in range(0, nfr, step):
        b = min(nfr, a + step)
        idx = (np.arange(a, b)[:, None] * HOP) + np.arange(N)[None, :]
        fr = x[idx]
        rms[a:b] = np.sqrt((fr ** 2).mean(1) + 1e-12)
        mag = np.abs(np.fft.rfft(fr * win, axis=1)).astype(np.float32)
        lm = np.log1p(mag * 50.0)
        d = np.diff(lm, axis=0, prepend=(lm[:1] if prev is None else prev[None, :]))
        flux[a:b] = np.maximum(d, 0).sum(1)
        prev = lm[-1]
        p2 = mag ** 2
        tot = p2.sum(1) + 1e-12
        cen[a:b] = (mag * freqs).sum(1) / (mag.sum(1) + 1e-12)
        share[a:b, 0] = p2[:, lo].sum(1) / tot
        share[a:b, 1] = p2[:, mid].sum(1) / tot
        share[a:b, 2] = p2[:, hi].sum(1) / tot
    rms_db = 20 * np.log10(rms + 1e-9)
    return rms_db, flux, cen, share


# ---------------------------------------------------------------- speech
def transcribe(path, model_size):
    """Return (words, segments, info) or None when faster-whisper is absent."""
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segs, info = model.transcribe(path, word_timestamps=True, vad_filter=True)
    words, segments = [], []
    for s in segs:
        segments.append((float(s.start), float(s.end), s.text.strip()))
        for w in (s.words or []):
            words.append((float(w.start), float(w.end), w.word.strip()))
    return words, segments, {"language": info.language,
                             "language_prob": round(float(info.language_probability), 3)}


def energy_vad(rms_db, cen):
    """Crude fallback: loud-enough frames with speech-like centroid."""
    floor = np.percentile(rms_db, 10)
    ceil = np.percentile(rms_db, 90)
    thr = floor + 0.35 * (ceil - floor)
    m = (rms_db > thr) & (cen > 300) & (cen < 3500)
    # smooth: close holes under 0.3 s, drop blips under 0.2 s
    return smooth_mask(m, close=int(0.3 * FPS), drop=int(0.2 * FPS))


def smooth_mask(m, close, drop):
    m = m.copy()
    runs = _runs(m)
    for i in range(1, len(runs) - 1):
        v, a, b = runs[i]
        if not v and (b - a) < close:
            m[a:b] = True
    runs = _runs(m)
    for v, a, b in runs:
        if v and (b - a) < drop:
            m[a:b] = False
    return m


def _runs(m):
    out, a = [], 0
    for i in range(1, len(m) + 1):
        if i == len(m) or m[i] != m[a]:
            out.append((bool(m[a]), a, i))
            a = i
    return out


def spans_to_mask(spans, nfr, pad=0.0):
    m = np.zeros(nfr, bool)
    for a, b in spans:
        m[max(0, int((a - pad) * FPS)):min(nfr, int((b + pad) * FPS) + 1)] = True
    return m


def speech_stats(words, dur):
    if not words:
        return None
    n = len(words)
    gaps = [words[i + 1][0] - words[i][1] for i in range(n - 1)]
    pauses = [g for g in gaps if g >= 0.4]
    # speaking time = total span minus long pauses
    spoken = sum(w[1] - w[0] for w in words) + sum(g for g in gaps if 0 < g < 0.4)
    wpm_speaking = n / (spoken / 60) if spoken > 0 else None
    wpm_overall = n / (dur / 60)
    return {
        "words": n,
        "words_per_min_overall": round(wpm_overall, 1),
        "words_per_min_while_speaking": round(wpm_speaking, 1) if wpm_speaking else None,
        "pauses_over_0_4s": len(pauses),
        "pauses_per_min": round(len(pauses) / (dur / 60), 2),
        "mean_pause_s": round(float(np.mean(pauses)), 2) if pauses else 0.0,
        "longest_pause_s": round(float(max(pauses)), 2) if pauses else 0.0,
    }


def pitch_stats(x, speech_mask):
    """Median F0 and spread from autocorrelation on voiced speech frames."""
    idx = np.flatnonzero(speech_mask)
    if len(idx) == 0:
        return None
    pick = idx[::10]  # every 200 ms
    lag_min, lag_max = int(SR / 400), int(SR / 70)
    f0 = []
    for fi in pick:
        s = fi * HOP
        seg = x[s:s + N]
        if len(seg) < N or np.sqrt((seg ** 2).mean()) < 0.005:
            continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, "full")[N - 1:]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        k = lag_min + int(np.argmax(ac[lag_min:lag_max]))
        if ac[k] > 0.45:
            f0.append(SR / k)
    if len(f0) < 30:
        return None
    f0 = np.array(f0)
    semis = 12 * np.log2(f0 / np.median(f0))
    return {"voiced_samples": int(len(f0)),
            "median_f0_hz": round(float(np.median(f0)), 1),
            "p10_f0_hz": round(float(np.percentile(f0, 10)), 1),
            "p90_f0_hz": round(float(np.percentile(f0, 90)), 1),
            "spread_semitones_std": round(float(np.std(semis)), 2)}


# ---------------------------------------------------------------- music / sfx
def tempo(flux, lo_bpm=60, hi_bpm=180):
    f = flux - flux.mean()
    if f.std() < 1e-6:
        return None
    n = len(f)
    ac = np.correlate(f, f, "full")[n - 1:]
    ac = ac / (ac[0] + 1e-9)
    lmin = int(FPS * 60 / hi_bpm)
    lmax = int(FPS * 60 / lo_bpm)
    k = lmin + int(np.argmax(ac[lmin:lmax]))
    return {"bpm": round(60 * FPS / k, 1), "strength": round(float(ac[k]), 3)}


def music_bed(rms_db, speech_mask):
    gap = ~speech_mask
    # drop frames close to speech (breath, tails)
    near = np.convolve(speech_mask.astype(float), np.ones(int(0.3 * FPS) * 2 + 1), "same") > 0
    gap = gap & ~near
    sp = speech_mask
    if gap.sum() < FPS * 5 or sp.sum() < FPS * 5:
        return {"verdict": "not enough gap or speech to judge"}
    g = float(np.median(rms_db[gap]))
    s = float(np.median(rms_db[sp]))
    above = float((rms_db[gap] > -50).mean())
    if g < -60:
        v = "gaps are silent: no continuous music bed (heuristic)"
    elif g > -50 and g - s > -25:
        v = "continuous bed or loud room sound under the gaps (heuristic)"
    else:
        v = "quiet bed or room tone in the gaps (heuristic)"
    return {"gap_median_db": round(g, 1), "speech_median_db": round(s, 1),
            "gap_minus_speech_db": round(g - s, 1),
            "gap_share_above_minus50db": round(above, 3),
            "gap_frames_used_s": round(float(gap.sum() / FPS), 1), "verdict": v}


def sfx_events(flux, cen, share, speech_mask, rms_db):
    med = float(np.median(flux))
    mad = float(np.median(np.abs(flux - med))) + 1e-6
    thr = med + 8 * mad
    ev = []
    w = int(0.1 * FPS)
    for i in range(w, len(flux) - w):
        if flux[i] > thr and flux[i] == flux[i - w:i + w + 1].max():
            c = float(cen[i + 2]) if i + 2 < len(cen) else float(cen[i])
            if c < 500:
                kind = "low thud/whoosh"
            elif c < 2500:
                kind = "mid pop/tone/typing"
            else:
                kind = "high click/ping/hiss"
            ev.append({"t": round(i / FPS, 2), "strength": round(float(flux[i] / mad), 1),
                       "centroid_hz": round(c), "level_db": round(float(rms_db[i]), 1),
                       "in_speech": bool(speech_mask[i]), "kind_guess": kind})
    return ev


# ---------------------------------------------------------------- report
def timeline(rms_db, cen, speech_mask, events, dur, step=15):
    rows = []
    for t0 in range(0, int(dur), step):
        a, b = int(t0 * FPS), min(len(rms_db), int((t0 + step) * FPS))
        if b - a < 5:
            continue
        n_ev = sum(1 for e in events if t0 <= e["t"] < t0 + step)
        rows.append({"t": t0,
                     "speech_pct": round(100 * float(speech_mask[a:b].mean())),
                     "rms_db_median": round(float(np.median(rms_db[a:b])), 1),
                     "centroid_hz_mean": round(float(cen[a:b].mean())),
                     "sfx_events": n_ev})
    return rows


def label_pace(wpm):
    if wpm is None:
        return None
    if wpm < 140:
        return "slow (heuristic)"
    if wpm < 165:
        return "calm to conversational (heuristic)"
    if wpm < 190:
        return "brisk (heuristic)"
    return "fast (heuristic)"


def label_pitch(sd):
    if sd is None:
        return None
    if sd < 2.5:
        return "flat / monotone-leaning (heuristic)"
    if sd < 4.5:
        return "normal variation (heuristic)"
    return "expressive (heuristic)"


def main():
    args = [a for a in sys.argv[1:]]
    model = "base"
    if "--model" in args:
        i = args.index("--model")
        model = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    video = args[0]
    out = args[1] if len(args) > 1 else "listen-out"
    os.makedirs(out, exist_ok=True)

    x = load_audio(video)
    dur = len(x) / SR
    print(f"audio {dur:.1f}s", flush=True)
    loud = loudness(video)
    rms_db, flux, cen, share = frame_features(x)
    nfr = len(rms_db)

    tr = transcribe(video, model)
    words = segments = info = None
    if tr:
        words, segments, info = tr
        spans = [(w[0], w[1]) for w in words]
        speech_mask = smooth_mask(spans_to_mask(spans, nfr), close=int(0.4 * FPS), drop=1)
        vad = "faster-whisper words"
        with open(os.path.join(out, "transcript.txt"), "w", encoding="utf-8") as f:
            for a, b, t in segments:
                f.write(f"[{a:7.1f} - {b:7.1f}] {t}\n")
    else:
        speech_mask = energy_vad(rms_db, cen)
        vad = "energy fallback (install faster-whisper for words and pace)"

    events = sfx_events(flux, cen, share, speech_mask, rms_db)
    in_gaps = [e for e in events if not e["in_speech"]]
    mins = dur / 60
    kinds = {}
    for e in events:
        kinds[e["kind_guess"]] = kinds.get(e["kind_guess"], 0) + 1

    sp = speech_stats(words, dur) if words else None
    result = {
        "file": os.path.basename(video),
        "duration_s": round(dur, 1),
        "loudness": loud,
        "band_share_pct": {
            "low_under_250hz": round(100 * float(share[:, 0].mean()), 1),
            "mid_250_4000hz": round(100 * float(share[:, 1].mean()), 1),
            "high_over_4000hz": round(100 * float(share[:, 2].mean()), 1)},
        "speech_detector": vad,
        "speech_share_pct": round(100 * float(speech_mask.mean()), 1),
        "language": info,
        "speech": sp,
        "pace_label": label_pace(sp["words_per_min_while_speaking"]) if sp else None,
        "voice_pitch": pitch_stats(x, speech_mask),
        "music_bed": music_bed(rms_db, speech_mask),
        "tempo_whole_track": tempo(flux),
        "sfx": {"events_total": len(events),
                "events_per_min": round(len(events) / mins, 1),
                "events_in_speech_gaps": len(in_gaps),
                "kind_counts": kinds,
                "note": "transients only; cannot tell what the sound IS (heuristic)",
                "first_60": events[:60]},
        "timeline_15s": timeline(rms_db, cen, speech_mask, events, dur),
    }
    vp = result["voice_pitch"]
    result["pitch_label"] = label_pitch(vp["spread_semitones_std"]) if vp else None

    with open(os.path.join(out, "listen.json"), "w") as f:
        json.dump(result, f, indent=1)
    write_md(result, os.path.join(out, "LISTEN.md"))
    print(open(os.path.join(out, "LISTEN.md")).read())


def write_md(r, path):
    L = []
    L.append(f"# Listen report: {r['file']}\n")
    L.append(f"Duration {r['duration_s']} s. Speech detector: {r['speech_detector']}.\n")
    if r["speech_detector"].startswith("energy"):
        L.append("WARNING: speech share, pitch and music-bed numbers below come from a crude "
                 "energy detector and are unreliable (music or noise counts as speech). "
                 "Run with faster-whisper for trustworthy results.\n")
    l = r["loudness"]
    L.append("## Loudness")
    L.append(f"- Integrated {l['lufs']} LUFS, range {l['lra']} LU, true peak {l['true_peak_db']} dBFS")
    b = r["band_share_pct"]
    L.append(f"- Power share: low {b['low_under_250hz']}%, mid {b['mid_250_4000hz']}%, high {b['high_over_4000hz']}%\n")
    L.append("## Voice")
    L.append(f"- Speech covers {r['speech_share_pct']}% of the video")
    if r["language"]:
        L.append(f"- Language {r['language']['language']} (confidence {r['language']['language_prob']})")
    s = r["speech"]
    if s:
        L.append(f"- {s['words']} words, {s['words_per_min_while_speaking']} wpm while speaking "
                 f"({s['words_per_min_overall']} overall), pace: {r['pace_label']}")
        L.append(f"- Pauses over 0.4 s: {s['pauses_over_0_4s']} ({s['pauses_per_min']} per min), "
                 f"mean {s['mean_pause_s']} s, longest {s['longest_pause_s']} s")
    else:
        L.append("- Words and pace not measured (faster-whisper missing)")
    p = r["voice_pitch"]
    if p:
        L.append(f"- Pitch median {p['median_f0_hz']} Hz (p10 {p['p10_f0_hz']}, p90 {p['p90_f0_hz']}), "
                 f"spread {p['spread_semitones_std']} semitones: {r['pitch_label']}")
    L.append("")
    m = r["music_bed"]
    L.append("## Music bed")
    L.append(f"- {m['verdict']}")
    if "gap_median_db" in m:
        L.append(f"- Level in gaps {m['gap_median_db']} dB vs speech {m['speech_median_db']} dB "
                 f"(difference {m['gap_minus_speech_db']} dB)")
    t = r["tempo_whole_track"]
    if t:
        L.append(f"- Beat tempo guess {t['bpm']} BPM, strength {t['strength']} (below 0.15 means no clear beat)")
    L.append("")
    x = r["sfx"]
    L.append("## Sound-effect-like events")
    L.append(f"- {x['events_total']} transients, {x['events_per_min']} per min, "
             f"{x['events_in_speech_gaps']} in speech gaps")
    L.append(f"- Kinds: {x['kind_counts']}")
    L.append(f"- {x['note']}\n")
    L.append("## Timeline (every 15 s)")
    L.append("| t (s) | speech % | level dB | centroid Hz | sfx |")
    L.append("|---|---|---|---|---|")
    for row in r["timeline_15s"]:
        L.append(f"| {row['t']} | {row['speech_pct']} | {row['rms_db_median']} | "
                 f"{row['centroid_hz_mean']} | {row['sfx_events']} |")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
