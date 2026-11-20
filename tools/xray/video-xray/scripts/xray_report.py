"""
video-xray · output writers
===========================
Turns evidence.json into the deliverables:
  VIDEO.md         layered agent-readable breakdown (L0 card -> L1 overview ->
                   L2 timeline -> L3 per-shot files)  [VIDEO.md-style open layering]
  report.html      human-readable report with contact sheets
  remake_plan.md   batched remake recipe per verdict type
  review_queue.md  what the vision model / human must check next
  captions.srt     only when caption text is known (OCR or review.json)
"""
from __future__ import annotations

import base64
import html
import json
import math
from pathlib import Path

import numpy as np

import xray_lib as L

SCALE_W = 320

VERDICT_COLORS = {
    "live": "#2e7d32", "ai": "#c62828", "code": "#1565c0",
    "screen": "#6a1b9a", "avatar": "#ef6c00", "3d": "#00838f",
    "uncertain": "#795548",
}


def _fmt_t(s: float) -> str:
    m, sec = int(s // 60), s % 60
    return f"{m:02d}:{sec:04.1f}"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


# --------------------------------------------------------------------------
# contact sheets + stills
# --------------------------------------------------------------------------
def write_sheet(doc: dict, shot: dict, out: Path, decode_fn=None) -> Path | None:
    """Tile the shot's sampled frames into a labelled contact sheet PNG."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    times_path = out / "stills"
    stills = sorted(times_path.glob(f"shot{shot['id']:03d}_*.png"))
    if not stills:
        return None
    imgs = [Image.open(p) for p in stills]
    cw, ch = imgs[0].size
    cols = min(4, len(imgs))
    rows = math.ceil(len(imgs) / cols)
    pad = 3
    W = cols * cw + (cols + 1) * pad
    H = rows * ch + (rows + 1) * pad + 22
    sheet = Image.new("RGB", (W, H), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=14)
        font_s = ImageFont.load_default(size=11)
    except TypeError:
        font = ImageFont.load_default(); font_s = font
    v = shot["verdict"]["verdict"]
    color = VERDICT_COLORS.get(v, "#555555")
    d.rectangle([0, 0, W, 22], fill=color)
    d.text((6, 3), f"S{shot['id']:03d}  {shot['start']:.2f}-{shot['end']:.2f}s  "
                   f"{v} {shot['verdict']['confidence']:.2f}", fill=(255, 255, 255), font=font)
    for i, im in enumerate(imgs):
        r, c = divmod(i, cols)
        x = pad + c * (cw + pad); y = 22 + pad + r * (ch + pad)
        sheet.paste(im, (x, y))
        if i < len(shot.get("frame_times", [])):
            d.text((x + 3, y + 2), f"{shot['frame_times'][i]:.2f}s",
                   fill=(255, 255, 0), font=font_s,
                   stroke_width=2, stroke_fill=(0, 0, 0))
    p = out / "sheets" / f"shot{shot['id']:03d}.png"
    sheet.save(p)
    return p


def write_stills(doc: dict, src: Path, out: Path) -> None:
    """One representative still per shot at sheet resolution (via ffmpeg)."""
    import subprocess
    stills = out / "stills"
    stills.mkdir(exist_ok=True)
    sw = min(SCALE_W, doc["info"]["width"])
    sh = int(round(doc["info"]["height"] * sw / doc["info"]["width"] / 2)) * 2
    for s in doc["shots"]:
        mid = (s["start"] + s["end"]) / 2
        frames_wanted = max(3, min(6, int(s["dur"] * doc["args"]["fps"]) or 3))
        span = s["end"] - s["start"]
        ts = [s["start"] + span * (i + 0.5) / frames_wanted for i in range(frames_wanted)]
        for k, t in enumerate(ts):
            p = stills / f"shot{s['id']:03d}_f{k}.png"
            if p.exists():
                continue
            subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error",
                            "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                            "-vf", f"scale={sw}:{sh}", str(p)],
                           capture_output=True, timeout=60)


# --------------------------------------------------------------------------
# VIDEO.md (layered, agent-facing)
# --------------------------------------------------------------------------
def _evidence_line(ev: dict) -> str:
    m = ev["motion"]
    return (f"noise {ev['noise_sigma']:.4f} · motion {m['class']} (rigid {m['rigid_ratio']:.2f}, "
            f"jitter {m['jitter']:.1f}) · flat {_pct(ev['flat_top8_coverage'])} · "
            f"{ev['unique_colors']} colours · crisp {_pct(ev['edge_crispness'])} · "
            f"cam: {ev['camera_estimate']}")


def _remake_hint(ev: dict) -> str:
    v = ev["verdict"]["verdict"]
    if v == "live":
        return (f"Film it: {ev['camera_estimate']}; replicate lighting and framing from stills; "
                f"shot length {ev['dur']}s.")
    if v == "ai":
        return ("Generate: build a text/image-to-video prompt from stills + subject description "
                "(see review prompt for the per-shot prompt template); batch with same-set shots.")
    if v == "code":
        return ("Rebuild in code: motion-graphics tween (Remotion / CSS / canvas); "
                "copy text, palette and easing from sheet; no camera needed.")
    if v == "screen":
        return ("Record the real UI yourself (or rebuild in HTML); match cursor path and scroll "
                "timing from the sheet.")
    if v in ("avatar", "3d"):
        return f"{v} path: confirm with visual review, then follow the dedicated recipe in SKILL.md."
    return "Pending visual review — decide live/ai/code after the review step."


def write_video_md(doc: dict, out: Path) -> None:
    info, pacing, audio = doc["info"], doc["pacing"], doc.get("audio") or {}
    meta = doc.get("metadata_scan") or {}
    cadence = doc.get("cadence") or {}
    tracks = doc.get("caption_tracks") or []
    shots = doc["shots"]
    mix: dict[str, int] = {}
    for s in shots:
        mix[s["verdict"]["verdict"]] = mix.get(s["verdict"]["verdict"], 0) + 1
    mix_s = ", ".join(f"{v} x{n}" for v, n in sorted(mix.items())) or "none"

    lines = []
    lines.append("---")
    lines.append("format: video-xray VIDEO.md v1 (layered breakdown; inspired by the open VIDEO.md idea)")
    lines.append(f"source: {info['file']}")
    lines.append(f"duration_s: {info['duration_s']}")
    lines.append(f"shots: {len(shots)}")
    lines.append(f"generated: {doc.get('generated_at')} by video-xray {doc.get('version')}")
    lines.append("---")
    lines.append("")
    lines.append("# L0 · Card  (~150 tokens — read this first)")
    lines.append(f"- Video: {info['width']}x{info['height']} @ {info['nominal_fps']} fps, "
                 f"{info['duration_s']} s, {len(shots)} shots.")
    lines.append(f"- Verdict mix: {mix_s}. Uncertain/review: {len(doc.get('review_ids', []))}.")
    lines.append(f"- Pacing: {pacing['cuts_per_minute']} cuts/min, median shot "
                 f"{pacing['median_shot_s']} s"
                 + (f", {pacing['beat_alignment']['on_beat_pct']}% cuts on beat "
                    f"(~{pacing['beat_alignment']['bpm_used']} BPM)" if pacing.get("beat_alignment") else "") + ".")
    if audio:
        lines.append(f"- Audio: {audio.get('sound_class_estimate', '?')} "
                     f"(estimate), BPM ~{audio.get('bpm_estimate', '?')}, "
                     f"{audio.get('onset_count', 0)} SFX-like onsets. {audio.get('note', '')}")
    if meta.get("generators"):
        lines.append(f"- Metadata AIGC tags: {', '.join(t['tool'] for t in meta['generators'])}.")
    if tracks:
        lines.append(f"- Caption/overlay tracks: {len(tracks)} "
                     + ("(text known)" if any(t.get("text") for t in tracks) else "(text needs OCR/VLM)") + ".")
    lines.append("- Files: L1 overview below · L2 timeline below · L3 per-shot in shots/ · "
                 "sheets in sheets/ · machine data in evidence.json · remake recipe in remake_plan.md.")
    lines.append("- Evidence hierarchy: metadata AIGC tags > frame cadence > sensor grain > "
                 "motion structure > palette. 'Looks like' never beats measurement.")
    lines.append("")
    lines.append("# L1 · Overview & Map")
    lines.append("## File map (read only what a question needs)")
    lines.append("| file | contains |")
    lines.append("|---|---|")
    lines.append("| VIDEO.md (this file) | card, overview, timeline |")
    lines.append("| shots/shot_NN.md | full per-shot evidence + remake hint (~200 tok each) |")
    lines.append("| sheets/shot_NN.png | labelled contact sheet per shot |")
    lines.append("| evidence.json | every measurement, machine-readable |")
    lines.append("| remake_plan.md | batched remake recipe |")
    lines.append("| review_queue.md | shots awaiting visual review + how to answer |")
    lines.append("")
    lines.append("## Global findings")
    lines.append(f"- Cadence: effective {cadence.get('effective_fps', '?')} fps vs nominal "
                 f"{cadence.get('nominal_fps', '?')} fps — "
                 + ("low effective fps suggests animation/AI/screen content."
                    if isinstance(cadence.get("effective_fps"), (int, float)) and
                    isinstance(cadence.get("nominal_fps"), (int, float)) and
                    cadence.get("nominal_fps") and
                    cadence["effective_fps"] < cadence["nominal_fps"] * 0.7
                    else "no duplicated-frame signature.") if cadence else "- Cadence: n/a")
    if meta.get("editors"):
        lines.append(f"- Editor fingerprints in metadata: {', '.join(t['tool'] for t in meta['editors'])}.")
    for t in tracks:
        txt = f' text="{t.get("text")}"' if t.get("text") else ""
        lines.append(f"- Overlay track: {t['pos']} band rows {t['row0']}-{t['row1']}, "
                     f"{_fmt_t(t['start'])}-{_fmt_t(t['end'])}{txt}")
    if audio and audio.get("onsets"):
        lines.append(f"- SFX-like hits at (first 12): {audio['onsets'][:12]} s")
    lines.append("")
    lines.append("## Shot map")
    lines.append("| id | start | dur | verdict | conf | key evidence |")
    lines.append("|---|---|---|---|---|---|")
    for s in shots:
        v = s["verdict"]
        key = f"noise {s['noise_sigma']:.4f}, {s['motion']['class']}"
        lines.append(f"| S{s['id']:03d} | {_fmt_t(s['start'])} | {s['dur']:.1f}s | "
                     f"{v['verdict']} | {v['confidence']:.2f} | {key} |")
    lines.append("")
    lines.append("# L2 · Timeline (one line per shot)")
    for s in shots:
        v = s["verdict"]
        caps = " +caption" if s["caption_bands"] else ""
        lines.append(f"- {_fmt_t(s['start'])}–{_fmt_t(s['end'])} S{s['id']:03d} "
                     f"{v['verdict']}/{v['confidence']:.2f} [{s['motion']['class']}"
                     f"·noise {s['noise_sigma']:.4f}]{caps}")
    lines.append("")
    lines.append("# L3 · Per-shot files")
    for s in shots:
        p = out / "shots" / f"shot_{s['id']:03d}.md"
        v = s["verdict"]
        body = [
            f"# Shot S{s['id']:03d} — {v['verdict']} (confidence {v['confidence']:.2f})"
            + ("  · NEEDS VISUAL REVIEW" if v["uncertain"] else ""),
            "",
            f"- Time: {_fmt_t(s['start'])} → {_fmt_t(s['end'])} ({s['dur']} s) · "
            f"cut score {s['cut_score']}",
            f"- Camera estimate: {s['camera_estimate']}",
            f"- Measured: {_evidence_line(s)}",
            f"- Evidence rule fired: {'; '.join(v['reasons'])}",
            "",
            "## Visuals",
            f"- Sheet: sheets/shot{s['id']:03d}.png ({len(s.get('frame_times', []))} frames)",
            f"- Stills: stills/shot{s['id']:03d}_f*.png",
            "",
            "## Remake hint",
            _remake_hint(s),
            "",
        ]
        if s.get("caption_bands"):
            body.append("## Caption/overlay in this shot")
            for b in s["caption_bands"]:
                body.append(f"- {b['pos']} band rows {b['row0']}-{b['row1']} "
                            f"cols {b['col0']}-{b['col1']} persist {b['persist']}")
            body.append("")
        if s.get("ai_prompt"):
            body.append("## Reviewed AI prompt")
            body.append(f"```text\n{s['ai_prompt']}\n```")
            body.append("")
        body.append(f"_{len(json.dumps(s)) // 4} tokens estimated for the JSON form_")
        p.write_text("\n".join(body))
    (out / "VIDEO.md").write_text("\n".join(lines))


# --------------------------------------------------------------------------
# remake plan
# --------------------------------------------------------------------------
def _load_caps(out: Path) -> dict:
    for p in [out / "capabilities.json",
              Path(__file__).resolve().parent.parent / "capabilities.json"]:
        if p.exists():
            return json.loads(p.read_text())
    return {"targets": []}


def write_remake_plan(doc: dict, out: Path) -> None:
    shots = doc["shots"]
    groups: dict[str, list] = {}
    for s in shots:
        groups.setdefault(s["verdict"]["verdict"], []).append(s)
    caps = _load_caps(out)
    n = [f"# Remake plan", "",
         "Generated from measured evidence. Live shots must be filmed; AI shots are batched "
         "per target-model limits; code shots become a motion-graphics project; screen shots "
         "must be re-recorded with material you own.", ""]
    n.append("## 1. Shot budget by verdict")
    n.append("| verdict | shots | total s | how to remake |")
    n.append("|---|---|---|---|")
    how = {
        "live": "film from the shooting plan below (section 3)",
        "ai": "batch into video-model generations (section 4)",
        "code": "one Remotion/HTML/canvas project (section 5)",
        "screen": "re-record the UI or rebuild in HTML (section 5)",
        "avatar": "portrait + audio + lip-sync tool (section 4)",
        "3d": "3D render (Blender/Three.js) or video model (section 4/5)",
        "uncertain": "resolve via review step, then re-plan",
    }
    for v, ss in sorted(groups.items()):
        n.append(f"| {v} | {len(ss)} | {sum(x['dur'] for x in ss):.1f} | {how.get(v, '?')} |")
    n.append("")
    n.append("## 2. Edit & audio plan")
    pacing = doc["pacing"]
    n.append(f"- Timeline: keep the original cut structure — {pacing['shots']} shots, "
             f"{pacing['cuts_per_minute']} cuts/min, median {pacing['median_shot_s']} s.")
    if pacing.get("beat_alignment"):
        n.append(f"- Cuts hit the beat grid (~{pacing['beat_alignment']['bpm_used']} BPM, "
                 f"{pacing['beat_alignment']['on_beat_pct']}% on beat) — cut your remake on the "
                 "same BPM grid.")
    a = doc.get("audio") or {}
    if a:
        n.append(f"- Audio: {a.get('sound_class_estimate', '?')} — {a.get('note', '')}. "
                 "Use music/VO/SFX you have rights to.")
    n.append("")
    n.append("## 3. Shooting plan (live shots)")
    live = groups.get("live", [])
    if live:
        setups = []
        for s in live:
            key = s["camera_estimate"].split(" +")[0]
            m = next((x for x in setups if x["camera"] == key), None)
            if m:
                m["shots"].append(s["id"]); m["seconds"] += s["dur"]
            else:
                setups.append({"camera": key, "shots": [s["id"]], "seconds": s["dur"]})
        n.append("| setup | shots | seconds |")
        n.append("|---|---|---|")
        for x in setups:
            n.append(f"| {x['camera']} | {', '.join('S%03d' % i for i in x['shots'])} | {x['seconds']:.1f} |")
        n.append("- Same-set detection is palette-based (proxy): check the stills to merge or split setups.")
    else:
        n.append("- No live shots to film.")
    n.append("")
    n.append("## 4. Generation plan (AI / avatar / 3D shots)")
    ai = groups.get("ai", []) + groups.get("avatar", []) + groups.get("3d", [])
    targets = caps.get("targets", [])
    if ai and targets:
        n.append("Batch shots so every generation fits inside the target model's limits "
                 "(max clip length, shots per generation, reference images). "
                 "Current capability table (verify current values before use):")
        n.append("| target | max clip s | shots/gen | ref images | notes |")
        n.append("|---|---|---|---|---|")
        for t in targets:
            n.append(f"| {t['name']} | {t.get('max_clip_s', '?')} | {t.get('shots_per_gen', '?')} | "
                     f"{t.get('ref_images', '?')} | {t.get('notes', '')[:60]} |")
        n.append("")
        n.append("Suggested batches (same-set = same dominant palette & motion class):")
        batches = []
        for s in ai:
            placed = False
            for b in batches:
                if b["verdict"] == s["verdict"]["verdict"] and \
                   b["palette"] == s.get("palette_key") and \
                   b["dur"] + s["dur"] <= (targets[0].get("max_clip_s") or 10):
                    b["shots"].append(s["id"]); b["dur"] += s["dur"]; placed = True
                    break
            if not placed:
                batches.append({"verdict": s["verdict"]["verdict"],
                                "palette": s.get("palette_key"),
                                "shots": [s["id"]], "dur": s["dur"]})
        for i, b in enumerate(batches, 1):
            n.append(f"- Gen {i} ({b['verdict']}): shots {', '.join('S%03d' % x for x in b['shots'])} "
                     f"· {b['dur']:.1f}s total")
        n.append("- Per-shot prompt template: describe subject + setting + camera move + pacing "
                 "from the sheet; the VLM review step (review_prompt.md) can draft these.")
    elif ai:
        n.append(f"- {len(ai)} AI-type shots. No capability table found — fill capabilities.json "
                 "with your target model's limits, then rerun `report`.")
    else:
        n.append("- No AI-type shots to generate.")
    n.append("")
    n.append("## 5. Code plan (motion graphics / screen)")
    code = groups.get("code", []) + groups.get("screen", [])
    if code:
        n.append(f"- {len(code)} shot(s) are rebuildable as code (Remotion / HTML / canvas). "
                 "Copy text content (from OCR/review), colours, and tween timings from the sheets.")
        for s in code:
            n.append(f"  - S{s['id']:03d} {s['dur']}s: {s['motion']['class']} motion, "
                     f"{s['unique_colors']} colours, camera ≈ {s['camera_estimate']}")
    else:
        n.append("- No code-rebuildable shots.")
    n.append("")
    n.append("## 6. Materials you must supply")
    n.append("- Screen recordings, screenshots, product photos, brand assets — anything the "
             "original author filmed or owned. rea-doctrine: remake with material you have "
             "rights to; never repost someone else's footage, music, characters or likeness.")
    n.append("")
    n.append("## 7. Honest limits of this plan")
    n.append("- Same-set grouping uses palette proxies; AI/3D calls on re-compressed uploads can "
             "be wrong; audio classes are estimates. Fix them in the visual review step.")
    (out / "remake_plan.md").write_text("\n".join(n))


# --------------------------------------------------------------------------
# review queue + captions.srt
# --------------------------------------------------------------------------
def write_review_queue(doc: dict, out: Path) -> None:
    ids = set(doc.get("review_ids", []))
    shots = [s for s in doc["shots"] if s["id"] in ids]
    if not shots:
        (out / "review_queue.md").write_text("# Review queue\n\nEmpty — every shot got a confident verdict.\n")
        return
    n = ["# Review queue — visual check needed", "",
         "These shots' offline evidence was inconclusive (usually: no sensor grain but organic "
         "motion, or grain lost to platform re-compression). Look at each sheet and answer with "
         "the JSON schema at the end of review_prompt.md. Then:", "",
         f"    python {Path(__file__).parent.name}/video_xray.py apply-review {out}", ""]
    for s in shots:
        n.append(f"## S{s['id']:03d} · {_fmt_t(s['start'])}–{_fmt_t(s['end'])}")
        n.append(f"- look at: sheets/shot{s['id']:03d}.png")
        n.append(f"- current guess: {s['verdict']['verdict']} @ {s['verdict']['confidence']:.2f} "
                 f"— {'; '.join(s['verdict']['reasons'])}")
        n.append(f"- decide: live | ai | code | screen | avatar | 3d (+ confidence + reasons)")
        n.append(f"- also give: subject description (for the AI prompt) and caption text if any")
        n.append("")
    (out / "review_queue.md").write_text("\n".join(n))


def write_srt(doc: dict, out: Path) -> bool:
    tracks = [t for t in (doc.get("caption_tracks") or []) if t.get("text")]
    if not tracks:
        return False

    def ts(t: float) -> str:
        h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
        return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

    lines = []
    for i, t in enumerate(tracks, 1):
        lines += [str(i), f"{ts(t['start'])} --> {ts(t['end'])}", t["text"], ""]
    (out / "captions.srt").write_text("\n".join(lines))
    return True


# --------------------------------------------------------------------------
# report.html
# --------------------------------------------------------------------------
def write_report_html(doc: dict, out: Path, src: Path) -> None:
    e = html.escape
    info, pacing, audio = doc["info"], doc["pacing"], doc.get("audio") or {}
    shots = doc["shots"]
    mix: dict[str, int] = {}
    for s in shots:
        mix[s["verdict"]["verdict"]] = mix.get(s["verdict"]["verdict"], 0) + 1
    chips = " ".join(f'<span class="chip" style="background:{VERDICT_COLORS.get(v, "#555")}">'
                     f'{v} × {n}</span>' for v, n in sorted(mix.items()))

    rows = []
    for s in shots:
        v = s["verdict"]
        sheet = out / "sheets" / f"shot{s['id']:03d}.png"
        still = out / "stills" / f"shot{s['id']:03d}_f0.png"
        img = f'<img src="sheets/shot{s["id"]:03d}.png" width="320">'
        rows.append(f"""
<tr>
  <td class="cid">S{s['id']:03d}<br><small>{_fmt_t(s['start'])}–{_fmt_t(s['end'])}</small><br>
      <small>{s['dur']}s</small></td>
  <td>{img}</td>
  <td class="v" style="color:{VERDICT_COLORS.get(v['verdict'], '#555')}">{v['verdict']}
      <br><small>conf {v['confidence']:.2f}{' · review' if v['uncertain'] else ''}</small></td>
  <td class="ev">{"<br>".join(e(r) for r in v['reasons'])}
      <br><small class="mono">{e(_evidence_line(s))}</small></td>
</tr>""")

    audio_html = ""
    if audio:
        audio_html = f"""
<h2>Audio</h2>
<table class="kv">
<tr><td>Class (estimate)</td><td><b>{e(str(audio.get('sound_class_estimate')))}</b></td></tr>
<tr><td>BPM estimate</td><td>{audio.get('bpm_estimate', '?')} (prominence {audio.get('bpm_prominence', '?')})</td></tr>
<tr><td>Onset hits</td><td>{audio.get('onset_count', 0)} — first at {audio['onsets'][:8]}</td></tr>
<tr><td>Pauses / silence</td><td>pause ratio {audio.get('pause_ratio', '?')} · lead {audio.get('lead_silence_s', 0)}s · trail {audio.get('trail_silence_s', 0)}s</td></tr>
<tr><td>Note</td><td>{e(str(audio.get('note', '')))}</td></tr>
</table>"""

    tracks_html = ""
    if doc.get("caption_tracks"):
        tr = "".join(f"<li>{t['pos']} band rows {t['row0']}–{t['row1']} · "
                     f"{_fmt_t(t['start'])}–{_fmt_t(t['end'])}"
                     + (f' · text: <b>{e(t["text"])}</b>' if t.get("text") else " · text unknown")
                     + "</li>" for t in doc["caption_tracks"])
        tracks_html = f"<h2>Captions & overlays</h2><ul>{tr}</ul>"

    meta_html = ""
    meta = doc.get("metadata_scan") or {}
    if meta.get("generators") or meta.get("editors"):
        gen = ", ".join(t["tool"] for t in meta.get("generators", [])) or "—"
        ed = ", ".join(t["tool"] for t in meta.get("editors", [])) or "—"
        meta_html = f"""
<h2>Metadata fingerprints</h2>
<table class="kv"><tr><td>AI generators</td><td><b>{e(gen)}</b></td></tr>
<tr><td>Editors</td><td>{e(ed)}</td></tr></table>"""

    cad = doc.get("cadence") or {}
    report = f"""<!doctype html><html><head><meta charset="utf-8">
<title>video-xray report — {e(Path(info['file']).name)}</title>
<style>
 body{{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#14151a;color:#e8e8ee}}
 .wrap{{max-width:1060px;margin:0 auto;padding:32px 20px 60px}}
 h1{{font-size:26px;margin:0 0 4px}} h2{{font-size:18px;margin:32px 0 8px;color:#9fb4ff}}
 .sub{{color:#8b8b98;font-size:13px}}
 .chip{{display:inline-block;padding:3px 10px;border-radius:99px;color:#fff;font-size:12px;margin-right:6px}}
 table{{border-collapse:collapse;width:100%}} td{{vertical-align:top}}
 tr:nth-child(odd) td{{background:#1c1e26}}
 td{{padding:10px 8px;border-bottom:1px solid #262933}}
 .cid{{white-space:nowrap;font-weight:600}} .v{{white-space:nowrap;font-weight:700}}
 .ev{{font-size:12.5px;color:#c3c6d4}}
 .mono{{font-family:ui-monospace,monospace;color:#7f8698}}
 .kv td{{border:none;padding:4px 8px}} .kv td:first-child{{color:#8b8b98;width:180px}}
 img{{border-radius:4px;display:block}}
 .note{{background:#20242f;border-left:3px solid #9fb4ff;padding:10px 14px;font-size:13px;
        border-radius:4px;margin-top:24px;color:#b9bdd0}}
</style></head><body><div class="wrap">
<h1>video-xray report</h1>
<div class="sub">{e(Path(info['file']).name)} · {info['width']}×{info['height']} ·
 {info['nominal_fps']} fps · {info['duration_s']} s · {len(shots)} shots ·
 effective {cad.get('effective_fps','?')} fps · video-xray {doc.get('version')}</div>
<div style="margin:14px 0">{chips}</div>

<h2>Shot map</h2>
<table>{''.join(rows)}</table>

<h2>Pacing</h2>
<table class="kv">
<tr><td>Cuts / minute</td><td><b>{pacing['cuts_per_minute']}</b></td></tr>
<tr><td>Shot length</td><td>median {pacing['median_shot_s']}s · min {pacing['shortest_s']}s · max {pacing['longest_s']}s</td></tr>
{f"<tr><td>Beat sync</td><td>{pacing['beat_alignment']['on_beat_pct']}% of cuts on the "
 f"~{pacing['beat_alignment']['bpm_used']} BPM grid</td></tr>" if pacing.get('beat_alignment') else ''}
</table>
{audio_html}{tracks_html}{meta_html}
<h2>Remake</h2>
<p>See <b>remake_plan.md</b> — shooting plan, generation batches, code-rebuild list.</p>
<div class="note">Verdicts come from measured evidence (metadata tags → cadence → sensor grain →
 motion structure → palette). Shots marked “review” need a visual check
 (review_queue.md + review_prompt.md). Learn structure and pacing from the original, but remake
 only with material you own the rights to.</div>
<div class="sub" style="margin-top:18px">generated {e(str(doc.get('generated_at')))} ·
 source command: <span class="mono">video_xray.py analyze {e(str(src.name))}</span></div>
</div></body></html>"""
    (out / "report.html").write_text(report)


# --------------------------------------------------------------------------
def write_all(doc: dict, out: Path, src: Path, ocr: bool = True, max_ocr: int = 20) -> None:
    out.mkdir(parents=True, exist_ok=True)
    write_stills(doc, src, out)
    # OCR caption tracks (first N tracks with a band)
    if ocr:
        done = 0
        for t in doc.get("caption_tracks", []):
            if done >= max_ocr:
                break
            if t.get("text"):
                continue
            txt = L_ocr(doc, out, t)
            if txt:
                t["text"] = txt
                done += 1
    for s in doc["shots"]:
        write_sheet(doc, s, out)
    write_video_md(doc, out)
    write_remake_plan(doc, out)
    write_review_queue(doc, out)
    write_srt(doc, out)
    write_report_html(doc, out, src)
    # keep evidence.json in sync with any OCR text added
    (out / "evidence.json").write_text(json.dumps(doc, indent=2))


def L_ocr(doc: dict, out: Path, track: dict):
    src = Path(doc["info"]["file"])
    t = (track["start"] + track["end"]) / 2
    return L.ocr_band(str(src), t, track)
