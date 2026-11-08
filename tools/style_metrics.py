#!/usr/bin/env python3
"""Extra style measurements and style merging for learn_style.py. Standard library + ffmpeg only.

rhythm(path, dur, cut_times)  -> cut-length spread, hook length, tempo (BPM), cuts on the beat, motion level
merge_prev(style, prev)       -> fold a new learned style into a previously learned one (several videos, one creator)

CLI:  python3 tools/style_metrics.py rhythm video.mp4
      python3 tools/style_metrics.py merge old-style.json new-style.json > merged.json
"""
import array, copy, json, math, re, subprocess, sys

BEAT_TOL = 0.08          # a cut counts as "on the beat" within 80 ms
BPM_MIN, BPM_MAX = 70, 180
ENV_FPS = 100            # onset envelope resolution (frames per second)


def _run(cmd, timeout=300):
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def _pct(sorted_vals, p):
    if not sorted_vals:
        return None
    i = (len(sorted_vals) - 1) * p
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


# ---------- cut lengths ----------
def cut_stats(cut_times, dur):
    pts = [0.0] + sorted(t for t in cut_times if 0 < t < dur) + [dur]
    shots = [b - a for a, b in zip(pts, pts[1:]) if b - a > 0.05]
    if not shots:
        return {}
    s = sorted(shots)
    mean = sum(shots) / len(shots)
    sd = math.sqrt(sum((x - mean) ** 2 for x in shots) / len(shots))
    cv = sd / mean if mean else 0
    out = {
        "shot_s_median": round(_pct(s, 0.5), 2),
        "shot_s_p10": round(_pct(s, 0.1), 2),
        "shot_s_p90": round(_pct(s, 0.9), 2),
        "shot_spread": round(cv, 2),
        "shot_spread_label": "too few cuts" if len(shots) < 6 else "steady" if cv < 0.25 else "varied" if cv < 0.6 else "wild",
    }
    if cut_times:
        out["hook_s"] = round(shots[0], 2)      # length of the first shot = how long the hook holds before the first cut
    return out


# ---------- tempo + beat alignment ----------
def _pcm(path, seconds=90, rate=8000):
    r = _run(["ffmpeg", "-v", "error", "-t", str(seconds), "-i", path, "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"], 300)
    a = array.array("h")
    a.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    return a


def _onsets(samples, rate=8000):
    hop = rate // ENV_FPS
    env = []
    for i in range(0, len(samples) - hop, hop):
        seg = samples[i:i + hop]
        env.append(math.log1p(math.sqrt(sum(x * x for x in seg) / hop) / 30.0))
    on = [0.0] + [max(0.0, env[i] - env[i - 1]) for i in range(1, len(env))]
    mean = sum(on) / len(on) if on else 0
    return [x - mean for x in on]


def tempo(path):
    """Return {tempo_bpm, tempo_confidence, _beat_period, _beat_phase} or {} when there is no steady beat."""
    samples = _pcm(path)
    if len(samples) < 8000 * 6:
        return {}
    on = _onsets(samples)
    n = len(on)
    ac0 = sum(x * x for x in on) / n
    if ac0 <= 0:
        return {}
    lo, hi = int(ENV_FPS * 60 / BPM_MAX) - 1, int(ENV_FPS * 60 / BPM_MIN) + 1
    ac = {}
    for lag in range(lo, hi + 2):
        ac[lag] = sum(on[i] * on[i + lag] for i in range(n - lag)) / (n - lag) / ac0
    best = max(range(lo + 1, hi + 1), key=lambda L: ac[L])
    a, b, c = ac[best - 1], ac[best], ac[best + 1]
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if den else 0.0
    period = best + max(-1.0, min(1.0, off))
    bpm = 60.0 * ENV_FPS / period
    conf = b
    # phase of the beat grid: where do onsets pile up?
    pi = max(1, int(period))
    def score(ph):
        k, tot = 0, 0.0
        while True:
            j = int(round(ph + k * period))
            if j >= n:
                return tot
            tot += on[j]
            k += 1
    phase = max(range(pi), key=score)
    return {"tempo_bpm": round(bpm, 1), "tempo_confidence": round(conf, 2), "_beat_period": period, "_beat_phase": phase, "_on": on}


GRIDS = ((1.0, "1x"), (2.0, "2x"), (0.5, "0.5x"))   # same pulse, double-time, half-time


def _best_phase(on, period):
    """Offset (in envelope frames) where onsets pile up for a grid of this period. Uses audio only, never the cuts."""
    n, pi = len(on), max(1, int(period))
    def score(ph):
        k, tot = 0, 0.0
        while True:
            j = int(round(ph + k * period))
            if j >= n:
                return tot
            tot += on[j]
            k += 1
    return max(range(pi), key=score)


def _grid_hits(cut_times, period, phase):
    tol = min(BEAT_TOL, 0.2 * period / ENV_FPS)       # fast grids get a tighter window so chance stays honest
    near = 0
    for ct in cut_times:
        d = (ct * ENV_FPS - phase) % period
        if min(d, period - d) / ENV_FPS <= tol:
            near += 1
    share = near / len(cut_times)
    chance = min(1.0, 2 * tol * ENV_FPS / period)
    return share, chance, bool(len(cut_times) >= 4 and share >= chance + 0.25)


def beat_alignment(cut_times, t):
    """Do the cuts land on the beat? Tries the measured pulse, double-time and half-time; reports the best grid that snaps."""
    if not t or len(cut_times) < 3:
        return {}
    base, on = t["_beat_period"], t.get("_on")
    first = None
    best = None
    for mult, label in GRIDS:
        period = base / mult
        if period < 20:                                # faster than 300 BPM is not a beat
            continue
        if mult == 1.0 or not on:
            phase = t["_beat_phase"]
        else:
            phase = _best_phase(on, period)
        share, chance, snap = _grid_hits(cut_times, period, phase)
        row = {"cuts_on_beat": round(share, 2), "cuts_on_beat_chance": round(chance, 2), "cuts_snap_to_beat": snap}
        if first is None:
            first = row
        if snap and (best is None or share - chance > best[0]):
            best = (share - chance, dict(row, beat_grid=label, beat_grid_bpm=round(60.0 * ENV_FPS / period, 1)))
    return best[1] if best else (first or {})


# ---------- motion ----------
def motion(path):
    r = _run(["ffmpeg", "-hide_banner", "-t", "60", "-i", path, "-vf", "fps=10,scale=160:-2,signalstats,metadata=print", "-an", "-f", "null", "-"], 300)
    vals = sorted(float(x) for x in re.findall(r"signalstats\.YDIF=([\d.]+)", (r.stderr or b"").decode("utf-8", "ignore")))
    if len(vals) < 5:
        return {}
    med = _pct(vals, 0.5)           # median ignores the spikes at cuts
    label = "static" if med < 1.0 else "gentle" if med < 3.0 else "moderate" if med < 8.0 else "fast"
    return {"motion_ydif": round(med, 2), "motion_level": label}


def rhythm(path, dur, cut_times):
    out = {}
    for fn in (lambda: cut_stats(cut_times, dur), lambda: motion(path)):
        try:
            out.update(fn())
        except Exception as e:
            print("rhythm part failed:", str(e)[:120])
    try:
        t = tempo(path)
        out.update({k: v for k, v in t.items() if not k.startswith("_")})
        # a weak autocorrelation peak means no steady beat: say so instead of reporting a made-up BPM
        if t and t["tempo_confidence"] < MIN_CONF:
            out["tempo_bpm"] = None
            t = {}
        out.update(beat_alignment(cut_times, t))
    except Exception as e:
        print("tempo failed:", str(e)[:120])
    return out


MIN_CONF = 0.12
RHYTHM_KEYS = ["shot_s_median", "shot_s_p10", "shot_s_p90", "shot_spread_label", "hook_s", "tempo_bpm", "cuts_on_beat",
               "cuts_snap_to_beat", "beat_grid", "beat_grid_bpm", "motion_level"]


def rhythm_summary(metrics):
    return {k: metrics[k] for k in RHYTHM_KEYS if metrics.get(k) is not None}


# ---------- merging several videos into one style ----------
def _fields(s):
    st = s.get("style_tokens") or {}
    cap, fx = st.get("caption") or {}, st.get("fx") or {}
    f = {"base": s.get("base"), "mode": s.get("mode"), "music": s.get("music"), "format": s.get("format"),
         "motion": st.get("motion"), "backdrop": st.get("backdrop"), "font": st.get("font"), "texture": fx.get("texture"),
         "caption_preset": cap.get("preset"), "caption_font": cap.get("font"), "accent": st.get("accent")}
    return {k: v for k, v in f.items() if v}


def _add(tally, s, w):
    for k, v in _fields(s).items():
        d = tally.setdefault(k, {})
        d[v] = d.get(v, 0) + w
    for t in (s.get("style_tokens") or {}).get("transitions") or []:
        d = tally.setdefault("transitions", {})
        d[t] = d.get(t, 0) + w


def _win(tally, key, current):
    d = tally.get(key) or {}
    if not d:
        return current
    top = max(d.values())
    return current if d.get(current) == top else max(d, key=lambda v: d[v])   # ties keep the earlier choice


def _wmean(x, nx, y, ny):
    if not isinstance(x, (int, float)) or isinstance(x, bool):
        return y
    if not isinstance(y, (int, float)) or isinstance(y, bool):
        return x
    return (x * nx + y * ny) / (nx + ny)


def merge_styles(a, b):
    na, nb = int(a.get("samples") or 1), int(b.get("samples") or 1)
    tally = copy.deepcopy(a.get("_tally")) if a.get("_tally") else {}
    if not tally:
        _add(tally, a, na)
    _add(tally, b, nb)
    out = copy.deepcopy(a)
    st = out.setdefault("style_tokens", {})
    cap, fx = st.setdefault("caption", {}), st.setdefault("fx", {})
    for k in ("base", "mode", "music", "format"):
        out[k] = _win(tally, k, out.get(k))
    for k in ("motion", "backdrop", "font", "accent"):
        v = _win(tally, k, st.get(k))
        if v:
            st[k] = v
    v = _win(tally, "texture", fx.get("texture"))
    if v:
        fx["texture"] = v
    for src, dst in (("caption_preset", "preset"), ("caption_font", "font")):
        v = _win(tally, src, cap.get(dst))
        if v:
            cap[dst] = v
    tr = sorted((tally.get("transitions") or {}).items(), key=lambda kv: -kv[1])[:5]
    if tr:
        st["transitions"] = [t for t, _ in tr]
        st["transition"] = {"type": st["transitions"][0], "duration": 0 if st["transitions"][0] == "cut" else 0.35}
    for k in ("graphic_ratio", "beat_seconds"):
        if k in a or k in b:
            out[k] = round(_wmean(a.get(k), na, b.get(k), nb), 2)
    ma, mb = a.get("metrics") or {}, b.get("metrics") or {}
    m = dict(mb)
    m.update(ma)
    for k in set(ma) | set(mb):
        va, vb = ma.get(k), mb.get(k)
        if isinstance(va, bool) and isinstance(vb, bool):
            m[k] = (int(va) * na + int(vb) * nb) / (na + nb) >= 0.5
        elif isinstance(va, bool) or isinstance(vb, bool):
            m[k] = vb if vb is not None else va
        elif isinstance(va, (int, float)) or isinstance(vb, (int, float)):
            m[k] = round(_wmean(va, na, vb, nb), 2)
    out["metrics"] = m
    out["rhythm"] = rhythm_summary(m)
    out["samples"] = na + nb
    out["_tally"] = tally
    out["source"] = f"merged from {na + nb} videos"
    if b.get("name"):
        out["name"] = b["name"]
    return out


def merge_prev(style, prev):
    """prev = JSON text, a file path, or empty. Returns the merged style, or the new one unchanged."""
    if not prev:
        return style
    try:
        if isinstance(prev, str):
            prev = prev.strip()
            if prev in ("", "null", "{}"):
                return style
            try:
                prev = json.loads(prev)
            except ValueError:
                prev = json.load(open(prev))
        if not isinstance(prev, dict) or not prev.get("style_tokens"):
            return style
        merged = merge_styles(prev, style)
        print(f"merged with previous style ({merged['samples']} videos)")
        return merged
    except Exception as e:
        print("merge skipped:", str(e)[:160])
        return style


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "rhythm":
        p = sys.argv[2]
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout or 0)
        sc = subprocess.run(["ffmpeg", "-hide_banner", "-i", p, "-vf", "select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"], capture_output=True, text=True)
        cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", sc.stderr or "")]
        print(json.dumps(rhythm(p, d, cuts), indent=2))
    elif len(sys.argv) >= 4 and sys.argv[1] == "merge":
        print(json.dumps(merge_styles(json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))), indent=2))
    else:
        print(__doc__)
