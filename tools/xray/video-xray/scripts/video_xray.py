#!/usr/bin/env python3
"""
video-xray · orchestrator
=========================
Reverse-engineer how any video was made, shot by shot.

  python video_xray.py analyze <video> [--out out/ref] [--fps 2] ...
  python video_xray.py apply-review out/ref          # merge review.json (VLM/human verdicts)
  python video_xray.py report out/ref                # regenerate VIDEO.md + report.html

Pipeline (mirrors the rea-video doctrine taught in the source video):
  1. SPLIT   — ffmpeg scene-cut detection + audio timing
  2. MEASURE — frame cadence, sensor noise, rigid-plane motion, palette,
               metadata AIGC tags, persistent caption bands, BPM/onsets
  3. DECIDE  — hard evidence beats "looks like"; conflicts -> review queue
  4. PLAN    — remake plan batched by verdict type (+ capabilities.json)
Outputs land in one folder: VIDEO.md (agent-facing, layered), report.html,
contact sheets, evidence.json, remake_plan.md, review_queue.md.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import xray_lib as L  # noqa: E402

VERSION = "0.1.0"


# --------------------------------------------------------------------------
# per-shot evidence
# --------------------------------------------------------------------------
def shot_evidence(shot, times, frames, edges, prev_frame) -> dict:
    idx = [i for i, t in enumerate(times) if shot["start"] - 1e-6 <= t < shot["end"]]
    if not idx:
        idx = [min(range(len(times)), key=lambda i: abs(times[i] - shot["start"]))]
    g = [frames[i].astype(np.float32).mean(axis=2) / 255.0 for i in idx]
    rgb = [frames[i] for i in idx]

    noise = float(np.median([L.noise_sigma(x) for x in g]))
    crisp = float(np.median([L.edge_crispness(x) for x in g]))
    colors = [L.color_stats(r) for r in rgb]
    flat_cov = float(np.median([c["flat_top8_coverage"] for c in colors]))
    unique = int(np.median([c["unique_colors"] for c in colors]))
    sat = float(np.median([c["mean_saturation"] for c in colors]))

    moves = []
    for a, b in zip(g, g[1:]):
        moves.append(L.global_motion(a, b))
    if prev_frame is not None and g:
        moves.insert(0, L.global_motion(prev_frame, g[0]))
    if moves:
        total = float(np.median([m["total"] for m in moves]))
        rigid = float(np.median([m["rigid_ratio"] for m in moves]))
        zoom = float(np.median([abs(m["zoom_delta"]) for m in moves]))
        dxs = [m["dx"] for m in moves]; dys = [m["dy"] for m in moves]
        jitter = float(np.std(dxs) + np.std(dys)) if len(moves) > 2 else 0.0
        pan = (int(np.median(dxs)), int(np.median(dys)))
        mclass = L.motion_class({"total": total, "rigid_ratio": rigid})
    else:
        total = rigid = zoom = jitter = 0.0
        pan = (0, 0); mclass = "static"

    bands = L.caption_bands([edges[i] for i in idx], shot["start"], shot["end"])

    cam = {"static": "locked-off / tripod", "rigid": "plane move (pan, slide, screen scroll)",
           "organic": "handheld / subject motion / parallax", "mixed": "mixed motion"}[mclass]
    if mclass == "organic" and total >= L.STATIC_TOTAL and jitter > 1.2 and max(map(abs, pan)) < 4:
        cam = "handheld jitter"
    if zoom > 0.03 and mclass != "static":
        cam += " + zoom/push"

    return {
        "id": shot["id"], "start": round(shot["start"], 2), "end": round(shot["end"], 2),
        "dur": round(shot["end"] - shot["start"], 2), "cut_score": round(shot["cut_score"], 3),
        "frames_used": len(idx), "frame_times": [times[i] for i in idx][:8],
        "noise_sigma": round(noise, 5), "edge_crispness": round(crisp, 3),
        "flat_top8_coverage": round(flat_cov, 3), "unique_colors": unique,
        "mean_saturation": round(sat, 3),
        "motion": {"class": mclass, "total": round(total, 5), "rigid_ratio": round(rigid, 3),
                   "median_dx": pan[0], "median_dy": pan[1],
                   "jitter": round(jitter, 2), "zoom": round(zoom, 3)},
        "camera_estimate": cam,
        "caption_bands": bands,
    }


def verdict(ev: dict, metadata_scan: dict, cadence: dict) -> dict:
    """DECIDE stage — hard evidence first, conflicts go to the review queue."""
    tags = metadata_scan["generators"]
    reasons: list[str] = []
    noise, flat, crisp = ev["noise_sigma"], ev["flat_top8_coverage"], ev["edge_crispness"]
    mclass = ev["motion"]["class"]
    unique = ev["unique_colors"]

    if tags:
        return {"verdict": "ai", "confidence": 0.9, "uncertain": False,
                "reasons": [f"AIGC metadata tag: {t['tool']} in {t['where']}" for t in tags[:3]]}

    grain = noise >= L.NOISE_PRESENT
    clean = noise <= L.NOISE_CLEAN

    if clean and flat >= L.FLAT_COV_HIGH and crisp >= L.CRISP_RATIO and mclass in ("rigid", "static"):
        reasons += [f"no sensor grain (sigma {noise:.4f})", f"flat fills {flat:.0%}",
                    f"crisp edges {crisp:.0%}", f"{mclass} motion"]
        return {"verdict": "code", "confidence": 0.8, "uncertain": False, "reasons": reasons}
    if clean and flat >= L.FLAT_COV_GRAPHIC and crisp >= L.CRISP_GRAPHIC \
            and unique <= L.UNIQUE_COLORS_GRAPHIC // 6:
        reasons += [f"vector-crisp edges ({crisp:.0%}) + near-total flat fills ({flat:.0%}) "
                    f"with only {unique} colours — flat-design graphics",
                    "multi-layer motion breaks single-plane tracking, but AI video never "
                    "renders this flat and this crisp"]
        return {"verdict": "code", "confidence": 0.75, "uncertain": False, "reasons": reasons}
    if clean and mclass == "static" and flat >= 0.15:
        reasons += ["no grain", "static frame", "limited palette (screen/UI-like)"]
        return {"verdict": "screen", "confidence": 0.65, "uncertain": False, "reasons": reasons}
    if grain and mclass == "organic":
        reasons += [f"sensor grain present (sigma {noise:.4f})",
                    f"organic motion (rigid ratio {ev['motion']['rigid_ratio']:.2f})"]
        return {"verdict": "live", "confidence": 0.8, "uncertain": False, "reasons": reasons}
    if grain and mclass == "rigid":
        reasons += ["grain present but whole plane moves as one — filmed screen? or gimbal"]
        return {"verdict": "live", "confidence": 0.55, "uncertain": True, "reasons": reasons}
    if clean and mclass == "organic":
        reasons += ["no sensor grain yet organic/parallax motion — typical of AI video",
                    f"{unique} unique colours (quantised)"]
        return {"verdict": "ai", "confidence": 0.55, "uncertain": True, "reasons": reasons}
    if grain and mclass == "static":
        reasons += ["grain present, static frame — locked-off camera"]
        return {"verdict": "live", "confidence": 0.7, "uncertain": False, "reasons": reasons}
    if 0.0015 < noise < 0.0040 and mclass == "organic":
        reasons += ["grain inconclusive (re-compressed platform upload?)", "organic motion"]
        return {"verdict": "uncertain", "confidence": 0.3, "uncertain": True,
                "reasons": reasons + ["needs visual review: live vs AI not separable offline"]}

    reasons += ["evidence mix does not match a clean rule"]
    return {"verdict": "uncertain", "confidence": 0.3, "uncertain": True,
            "reasons": reasons + ["needs visual review"]}


# --------------------------------------------------------------------------
# analyze
# --------------------------------------------------------------------------
def cmd_analyze(args) -> int:
    problems = L.check_env()
    if problems:
        for p in problems: print("ERROR:", p, file=sys.stderr)
        return 2
    try:
        import numpy  # noqa
    except ImportError:
        print("ERROR: numpy required (pip install numpy)", file=sys.stderr); return 2

    src = Path(args.video).expanduser().resolve()
    if not src.exists():
        print(f"ERROR: {src} not found", file=sys.stderr); return 2
    out = Path(args.out).resolve()
    (out / "shots").mkdir(parents=True, exist_ok=True)
    (out / "sheets").mkdir(exist_ok=True)
    (out / "stills").mkdir(exist_ok=True)
    t0 = time.time()
    print(f"[video-xray] source: {src}")
    print(f"[video-xray] output: {out}")

    # -- probe ------------------------------------------------------------
    probe = L.ffprobe_json(str(src))
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    duration = float(probe["format"].get("duration", 0) or 0)
    nominal_fps = L.parse_fps(vstream.get("avg_frame_rate")) or L.parse_fps(vstream.get("r_frame_rate"))
    info = {"file": str(src), "duration_s": round(duration, 2),
            "width": vstream["width"], "height": vstream["height"],
            "nominal_fps": round(nominal_fps, 3),
            "video_codec": vstream.get("codec_name"),
            "audio_codec": next((s.get("codec_name") for s in probe["streams"]
                                 if s["codec_type"] == "audio"), None),
            "bit_rate": probe["format"].get("bit_rate")}
    print(f"[1/6] probe: {info['width']}x{info['height']} @ {info['nominal_fps']} fps, {info['duration_s']} s")

    # -- metadata AIGC scan ----------------------------------------------
    meta = L.scan_metadata(probe)
    print(f"[2/6] metadata scan: {len(meta['generators'])} generator tag(s), "
          f"{len(meta['editors'])} editor tag(s), {len(meta['all_tags'])} raw tags")

    # -- cadence ----------------------------------------------------------
    cadence = L.cadence_scan(str(src), nominal_fps)
    print(f"[3/6] cadence: effective {cadence['effective_fps']} fps "
          f"(nominal {cadence['nominal_fps']}, dup {cadence['duplicate_ratio']:.0%})")

    # -- shots ------------------------------------------------------------
    bounds = L.detect_shots(str(src), threshold=args.scene_threshold,
                            min_shot_s=args.min_shot, duration=duration)
    shots = L.shots_from_boundaries(bounds, duration)
    print(f"[4/6] shots: {len(shots)} shots "
          f"({duration / max(len(shots), 1):.1f} s median)" if shots else "[4/6] shots: 1")
    if len(shots) > 400:
        print("      (capped — consider a higher --scene-threshold)")

    # -- decode + per-shot evidence ---------------------------------------
    fps = args.fps
    times, frames = L.decode_frames(str(src), fps)
    print(f"[5/6] evidence: decoded {len(frames)} frames at {fps:.2f} fps "
          f"({frames.shape[2]}x{frames.shape[1]})")
    edges = [(L.laplacian(f.astype(np.float32).mean(axis=2) / 255.0) > 0.055)
             for f in frames]
    evidence_shots = []
    prev = None
    for sh in shots:
        idx = [i for i, t in enumerate(times) if sh["start"] - 1e-6 <= t < sh["end"]]
        ev = shot_evidence(sh, times, frames, edges, prev)
        ev["verdict"] = verdict(ev, meta, cadence)
        if ev["verdict"]["verdict"] in ("ai", "code") and ev["camera_estimate"].startswith("handheld"):
            ev["camera_estimate"] = "no physical camera (content motion, not sensor)"
        evidence_shots.append(ev)
        prev = frames[idx[-1]].astype(np.float32).mean(axis=2) / 255.0 if idx else None
        v = ev["verdict"]
        print(f"      shot {sh['id']:>3} {sh['start']:7.2f}-{sh['end']:7.2f}s "
              f"{v['verdict']:<9} conf {v['confidence']:.2f}"
              f"{'  <== review' if v['uncertain'] else ''}")
    shots = evidence_shots

    # -- audio ------------------------------------------------------------
    audio = L.audio_metrics(str(src))
    if audio:
        print(f"[6/6] audio: {audio['sound_class_estimate']}, "
              f"BPM ~{audio.get('bpm_estimate')}, {audio['onset_count']} onsets")
    else:
        print("[6/6] audio: none")
    cuts = [s["start"] for s in shots[1:]]
    beat = L.beat_align(cuts, audio)

    # -- pacing -----------------------------------------------------------
    durs = [s["dur"] for s in shots]
    pacing = {"shots": len(shots),
              "cuts_per_minute": round(60.0 * (len(shots) - 1) / max(duration, 0.1), 1),
              "median_shot_s": round(float(np.median(durs)), 2) if durs else 0,
              "shortest_s": round(min(durs), 2) if durs else 0,
              "longest_s": round(max(durs), 2) if durs else 0,
              "beat_alignment": beat}

    # -- persist raw evidence ---------------------------------------------
    review = [s for s in shots if s["verdict"]["uncertain"]]
    document = {
        "tool": "video-xray", "version": VERSION,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "args": {"fps": args.fps, "scene_threshold": args.scene_threshold,
                 "min_shot": args.min_shot},
        "info": info, "metadata_scan": meta, "cadence": cadence,
        "pacing": pacing, "audio": audio, "shots": shots,
        "caption_tracks": L.merge_tracks([b for s in shots for b in s["caption_bands"]]),
        "review_ids": [s["id"] for s in review],
    }
    (out / "evidence.json").write_text(json.dumps(document, indent=2))

    import xray_report as R
    R.write_all(document, out, src, ocr=args.ocr, max_ocr=args.max_ocr_tracks)
    print(f"\n[video-xray] done in {time.time() - t0:.1f}s")
    print(f"  VIDEO.md        {out / 'VIDEO.md'}")
    print(f"  report.html     {out / 'report.html'}")
    print(f"  remake_plan.md  {out / 'remake_plan.md'}")
    if review:
        print(f"  review_queue.md {out / 'review_queue.md'}  ({len(review)} shot(s) need visual review)")
        print("  -> run the VLM review in review_prompt.md, save review.json, then:")
        print(f"     python {Path(__file__).name} apply-review {out}")
    return 0


# --------------------------------------------------------------------------
# apply-review
# --------------------------------------------------------------------------
def cmd_apply_review(args) -> int:
    out = Path(args.out).resolve()
    ev_path = out / "evidence.json"
    rev_path = out / "review.json"
    if not ev_path.exists() or not rev_path.exists():
        print("ERROR: need out/evidence.json and out/review.json", file=sys.stderr)
        return 2
    document = json.loads(ev_path.read_text())
    review = json.loads(rev_path.read_text())
    by_id = {int(r["shot"]): r for r in review["shots"] if str(r.get("shot")).isdigit()}
    changed = 0
    for s in document["shots"]:
        r = by_id.get(s["id"])
        if not r:
            continue
        v = r.get("verdict", "").lower()
        if v not in ("live", "ai", "code", "screen", "avatar", "3d", "uncertain"):
            continue
        s["verdict"] = {"verdict": v,
                        "confidence": float(r.get("confidence", 0.7)),
                        "uncertain": v == "uncertain",
                        "reasons": [f"visual review: {x}" for x in r.get("reasons", [])],
                        "reviewed": True}
        if r.get("subject"): s["subject"] = r["subject"]
        if r.get("caption_text"): s["caption_text"] = r["caption_text"]
        if r.get("prompt"): s["ai_prompt"] = r["prompt"]
        changed += 1
    document["review_ids"] = [s["id"] for s in document["shots"] if s["verdict"]["uncertain"]]
    # caption text from review?
    for t in document.get("caption_tracks", []):
        for r in review.get("captions", []):
            if abs(r.get("start", -1) - t["start"]) < 0.4 and r.get("text"):
                t["text"] = r["text"]
    ev_path.write_text(json.dumps(document, indent=2))
    import xray_report as R
    src = document["info"]["file"]
    R.write_all(document, out, Path(src), ocr=False, max_ocr=0)
    print(f"[video-xray] merged {changed} reviewed verdict(s); outputs regenerated.")
    print(f"  remaining review shots: {len(document['review_ids'])}")
    return 0


def cmd_report(args) -> int:
    out = Path(args.out).resolve()
    document = json.loads((out / "evidence.json").read_text())
    import xray_report as R
    R.write_all(document, out, Path(document["info"]["file"]), ocr=False, max_ocr=0)
    print(f"[video-xray] outputs regenerated in {out}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="video-xray",
                                 description="Reverse-engineer how a video was made, shot by shot.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze", help="full pipeline: split -> measure -> decide -> plan")
    a.add_argument("video")
    a.add_argument("--out", default="out/ref", help="output folder (default out/ref)")
    a.add_argument("--fps", type=float, default=2.0, help="evidence sampling fps (default 2)")
    a.add_argument("--scene-threshold", type=float, default=0.25,
                   help="ffmpeg scene-cut sensitivity (default 0.25; lower = more cuts)")
    a.add_argument("--min-shot", type=float, default=0.8,
                   help="minimum shot length in seconds (default 0.8)")
    a.add_argument("--ocr", action="store_true", default=True,
                   help="OCR caption bands when pytesseract is available (default on)")
    a.add_argument("--no-ocr", dest="ocr", action="store_false")
    a.add_argument("--max-ocr-tracks", type=int, default=20)
    a.set_defaults(func=cmd_analyze)

    b = sub.add_parser("apply-review", help="merge review.json verdicts and regenerate outputs")
    b.add_argument("out", nargs="?", default="out/ref")
    b.set_defaults(func=cmd_apply_review)

    c = sub.add_parser("report", help="regenerate VIDEO.md / report.html from evidence.json")
    c.add_argument("out", nargs="?", default="out/ref")
    c.set_defaults(func=cmd_report)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
