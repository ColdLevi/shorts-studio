#!/usr/bin/env python3
"""xray_brain.py: turn video-xray evidence.json files into a PROPOSAL for a style pack.

Rules (owner's design rules):
- Only measured values are proposed. Anything not measured stays unset and is listed under "skipped".
- Every proposed field has a director note that says what was measured and from how many clips.
- Nothing is written to a pack here. This script only prints / writes a proposal file.
- It refuses to run until the owner confirms the clips are his own or licensed (--licence-ok).

Usage:
  python3 tools/xray_brain.py evidence1.json evidence2.json [--pack styles/upload-3/pack.json]
         [--out proposal.json] --licence-ok [--min-clips 2]
"""
import argparse, json, statistics, sys

# Thresholds live here so they can be audited and changed in one place.
BEAT_SYNC_MIN = 50.0     # median % of cuts on the beat grid needed before proposing cut-on-beat
UNCERTAIN_MAX = 0.25     # share of screen time with undecided shots above which graphic_ratio is not proposed
GRAPHIC_VERDICTS = ("code", "screen")


def med(xs):
    return statistics.median(xs) if xs else None


def load(paths):
    out = []
    for p in paths:
        with open(p) as f:
            out.append((p, json.load(f)))
    return out


def get_path(d, dotted):
    for k in dotted.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def propose(evs, min_clips=2):
    fields, notes, skipped = {}, [], []
    n = len(evs)
    if n < min_clips:
        notes.append("Only %d clip(s) measured; %d or more give a steadier result, so treat this as a rough read." % (n, min_clips))

    # 1. shot length and cut rate
    meds = [e["pacing"]["median_shot_s"] for _, e in evs if get_path(e, "pacing.median_shot_s") is not None]
    cpm = [e["pacing"]["cuts_per_minute"] for _, e in evs if get_path(e, "pacing.cuts_per_minute") is not None]
    if meds:
        v = round(med(meds), 1)
        fields["pacing.beat_seconds"] = v
        notes.append("pacing.beat_seconds = %s: median shot length across %d clip(s) (per clip: %s s)." % (v, len(meds), ", ".join("%.1f" % m for m in meds)))
    else:
        skipped.append("pacing.beat_seconds: no shot lengths in the evidence")
    if cpm:
        v = round(med(cpm), 1)
        fields["pacing.cuts_per_minute"] = v
        notes.append("pacing.cuts_per_minute = %s: median over %d clip(s) (per clip: %s)." % (v, len(cpm), ", ".join("%.1f" % m for m in cpm)))

    # 2. graphic ratio from verdicts, weighted by shot time
    tot = gfx = unsure = 0.0
    mix = {}
    for _, e in evs:
        for s in e.get("shots", []):
            d = float(s.get("dur") or 0)
            v = s.get("verdict") or {}
            tot += d
            label = v.get("verdict", "?")
            mix[label] = mix.get(label, 0.0) + d
            if v.get("uncertain") or str(label).endswith("?"):
                unsure += d
            elif label in GRAPHIC_VERDICTS:
                gfx += d
    if tot > 0:
        notes.append("Shot mix by time: " + ", ".join("%s %.0f%%" % (k, 100 * x / tot) for k, x in sorted(mix.items(), key=lambda kv: -kv[1])) + ".")
        if unsure / tot > UNCERTAIN_MAX:
            skipped.append("pacing.graphic_ratio: %.0f%% of the time is still undecided; resolve the review queue first" % (100 * unsure / tot))
        else:
            fields["pacing.graphic_ratio"] = round(gfx / (tot - unsure), 2) if tot > unsure else None
            notes.append("pacing.graphic_ratio = %s: share of decided screen time built as code or screen (not filmed or AI)." % fields["pacing.graphic_ratio"])

    # 3. caption position, time-weighted majority of measured caption bands
    pos = {}
    for _, e in evs:
        for t in e.get("caption_tracks", []):
            if t.get("pos"):
                pos[t["pos"]] = pos.get(t["pos"], 0.0) + max(0.0, float(t.get("end", 0)) - float(t.get("start", 0)))
    if pos:
        best = max(pos, key=pos.get)
        fields["look.caption.position"] = best
        notes.append("look.caption.position = %s: caption bands measured there for %.0f s of %s s of tracked text (%s)." % (best, pos[best], "%.0f" % sum(pos.values()), ", ".join("%s %.0fs" % kv for kv in pos.items())))
    else:
        skipped.append("look.caption.position: no caption band was measured")

    # 4. beat sync
    onb = [e["pacing"]["beat_alignment"]["on_beat_pct"] for _, e in evs if get_path(e, "pacing.beat_alignment.on_beat_pct") is not None]
    bpm = [e["audio"]["bpm_estimate"] for _, e in evs if get_path(e, "audio.bpm_estimate")]
    if onb:
        m = med(onb)
        if m >= BEAT_SYNC_MIN and bpm:
            fields["pacing.cut_on_beat_bpm"] = round(med(bpm), 1)
            notes.append("pacing.cut_on_beat_bpm = %.1f: a median %.0f%% of cuts land on the beat (needs %.0f%% or more)." % (med(bpm), m, BEAT_SYNC_MIN))
        else:
            skipped.append("pacing.cut_on_beat_bpm: only %.0f%% of cuts land on the beat (needs %.0f%%), so no beat sync is claimed" % (m, BEAT_SYNC_MIN))

    # 5. kit evidence is a note only; xray cannot tell which kit a shot was.
    screens = sum(1 for _, e in evs for s in e.get("shots", []) if (s.get("verdict") or {}).get("verdict") == "screen")
    if screens:
        notes.append("%d shot(s) read as screen recordings: the style can support screen kits. Which kit is the writer's choice." % screens)
    return {"clips": [p for p, _ in evs], "fields": fields, "notes": notes, "skipped": skipped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("evidence", nargs="+")
    ap.add_argument("--pack")
    ap.add_argument("--out")
    ap.add_argument("--min-clips", type=int, default=2)
    ap.add_argument("--licence-ok", action="store_true", help="owner confirms the clips are his own or licensed")
    a = ap.parse_args()
    if not a.licence_ok:
        print("STOP: the owner has not said these reference clips are his own or licensed. Re-run with --licence-ok once he has.")
        return 2
    res = propose(load(a.evidence), a.min_clips)
    if a.pack:
        pk = json.load(open(a.pack))
        res["current"] = {k: get_path(pk, k) for k in res["fields"]}
    print(json.dumps(res, indent=2))
    if a.out:
        json.dump(res, open(a.out, "w"), indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
