---
name: video-xray
description: >
  Reverse-engineer how ANY video was made, shot by shot — whether it was filmed,
  AI-generated, built in code, or screen-recorded — plus captions, cuts, pacing,
  audio, and a batched remake plan. Use when the user gives a video file (or a
  downloaded URL file) and asks "how was this made", "break down this edit",
  "copy this style", "recreate this video", "what's the pacing/structure", or
  wants to remake a reference video with their own material. Works offline with
  ffmpeg + numpy; optional vision-model review step closes the accuracy gap on
  platform-recompressed files. Doctrine and code inspired by the open-source
  rea-video method (github.com/JuneYaooo/rea-video, Apache-2.0); this package is
  an independent implementation.
---

# video-xray — reverse-engineer any video style

## What you (the agent) are doing

You are a forensic analyst. A video arrives. You produce a **shot-by-shot verdict** of how it
was made (live / AI / code / screen / avatar / 3d), the **evidence** behind every call, the
**style system** (cuts, pacing, captions, audio, palette), and a **remake plan** the user can
execute with their own material. You never repost or clone identity elements; you extract
structure, timing and technique.

The four-stage pipeline (this mirrors the rea-video doctrine):

1. **SPLIT** — cut the video into shots; time the audio track.
2. **MEASURE** — gather hard evidence: frame cadence, sensor noise, rigid-plane motion,
   palette statistics, metadata AIGC tags, persistent caption bands, BPM and onsets.
3. **DECIDE** — hard evidence beats "looks like". Metadata tags and cadence outrank grain;
   grain outranks palette; conflicts go to a visual review step and stop there for the user.
4. **PLAN** — batch the remake by verdict type against what the target video model can
   actually do (clip length, multi-shot, reference images — see capabilities.json).

## Setup (run once)

Requirements: Python 3.10+, `ffmpeg`/`ffprobe` on PATH, `numpy`, `Pillow` (sheets), and
optionally `pytesseract` + `tesseract` for caption OCR.

```bash
# debian/ubuntu            # macOS
apt install ffmpeg tesseract  brew install ffmpeg tesseract
pip install numpy pillow pytesseract
```

Sanity check: `python scripts/video_xray.py analyze /path/to/video.mp4 --out out/ref`

## The one command that does everything

```bash
python scripts/video_xray.py analyze <video.mp4> --out out/ref [--fps 2] \
    [--scene-threshold 0.25] [--min-shot 0.8] [--no-ocr]
```

What runs, in order (progress prints to stderr): probe → metadata AIGC scan → cadence scan →
scene-cut detection → per-shot evidence decode (320 px, 2 fps) → verdicts → audio metrics →
all outputs written to `out/ref/`.

Tuning:
- Music-video / fast-cut content: `--scene-threshold 0.15 --min-shot 0.4`
- Long calm vlogs: `--scene-threshold 0.3`
- Slower, denser evidence sampling: `--fps 3` (cost: decode time)

## Outputs (in `--out`, default `out/ref`)

| file | audience | what it is |
|---|---|---|
| `VIDEO.md` | **you (the agent)** | layered breakdown: L0 card (~150 tok) → L1 overview/map → L2 one-line-per-shot timeline → L3 `shots/shot_NN.md` per-shot files. Read L0 first; open L3 only for the question at hand |
| `report.html` | the user | visual report: colour-coded shot map with contact sheets, pacing, audio, captions |
| `evidence.json` | you / tools | every measurement, machine-readable |
| `sheets/shot_NN.png` | review step | labelled contact sheet (timestamps burned in) |
| `stills/shot_NN_f*.png` | review step / remake | sampled frames per shot |
| `remake_plan.md` | the user | shooting plan, generation batches, code-rebuild list, materials list |
| `review_queue.md` | you | which shots need visual review and exactly what to answer |
| `captions.srt` | the user | written only when caption text is known (OCR or review) |

## The decision doctrine (memorise this)

Evidence hierarchy — a higher class always outranks everything below it:

1. **Metadata AIGC tags** (container says "Sora/Kling/Seedance/Suno/…") → `ai`. Editor tags
   (CapCut, Premiere) do NOT prove AI — they say nothing about shot origin.
2. **Frame cadence** — effective fps far below nominal fps (duplicate frames) ⇒ animation,
   AI or screen content, never "live camera".
3. **Sensor grain** — Laplacian sigma inside flat regions (threshold `NOISE_PRESENT = 0.0040`,
   `NOISE_CLEAN = 0.0015` in `scripts/xray_lib.py`). Grain ⇒ camera. Clean ⇒ synthetic.
4. **Motion structure** — rigid-plane (whole frame translates as one) vs organic (parallax,
   subject motion) vs static. Phase-correlation residual after compensating global shift.
5. **Palette / edge stats** — flat fills + crisp edges + few colours ⇒ code/graphics;
   many colours + soft edges ⇒ gradient-y AI or film.

Decision table as implemented in `video_xray.py::verdict()` (retune constants, not logic):

| # | metadata | grain | motion | palette/edges | verdict | conf |
|---|---|---|---|---|---|---|
| 1 | AIGC tag | any | any | any | ai | 0.90 |
| 2 | — | clean | rigid/static | flat+crisp | code | 0.80 |
| 2b | — | clean | any | near-total flat fills ≥85% + crisp edges ≥90% + ≤64 colours | code (flat-design graphics) | 0.75 |
| 3 | — | clean | static | limited | screen | 0.65 |
| 4 | — | present | organic | any | live | 0.80 |
| 5 | — | present | rigid | any | live? (filmed screen?) | 0.55 → review |
| 6 | — | clean | organic | any | ai? | 0.55 → review |
| 7 | — | present | static | any | live (locked-off) | 0.70 |
| 8 | — | mid | organic | any | uncertain → review | 0.30 |

Rule 2b exists because multi-layer motion-graphics tweens break single-plane tracking
(motion reads "organic"), yet no AI video model renders 98% flat fills with 27 colours and
100% vector-crisp edges — the palette/edge signature decides. Static threshold covers
grain-free stills (`STATIC_TOTAL = 0.008`); "static" UI shots with real cursor movement,
scrolling or typing get caught by the review step.

Anything reaching the review queue **stops the pipeline** — that is the human-in-the-loop
checkpoint from the source method ("measures every frame, stops for your OK").

## The visual review step (when `review_queue.md` is non-empty)

1. Read `out/ref/review_queue.md` — it lists uncertain shots with sheet paths and current
   guesses.
2. You are the vision model if you can see images: open each sheet
   (`out/ref/sheets/shot_NN.png`) and apply `review_prompt.md`'s rubric. Otherwise send
   sheet + evidence to any vision-capable model (the prompt file includes the JSON schema).
3. Write the answers to `out/ref/review.json`.
4. Merge and regenerate:
   `python scripts/video_xray.py apply-review out/ref`
   → verdicts, caption text, per-shot AI prompts and the remake plan all update.

Extra things only eyes can catch (check during review): avatar shots (lip-synced presenter,
slightly waxy skin, static single-subject framing + speech audio), 3d renders
(orbit-perfect cameras, subsurface shading), AI tells (morphing text, wrong hands, background
elements that change identity between frames of one shot).

## Remake planning (stage 4)

`remake_plan.md` is generated automatically; your job is to sanity-check and present it:
- **live shots** → grouped into camera setups (palette-similarity proxy — verify against
  stills); the user films them following the sheet framing/camera notes.
- **ai shots** → batched so each generation fits the target model's limits. Fill
  `capabilities.json` with the models the user can actually call, rerun `report`, and the
  batches regroup. Per-shot prompt drafts come from the review step (`ai_prompt` field).
  Describe generic subjects only — never the original's people/brands/artwork.
- **code shots** → one Remotion/HTML/canvas project; text content from OCR/review, colours
  and tween timing from the sheets.
- **screen shots** → the user re-records real UI (or rebuilds it in HTML).
- **audio** → classes are estimates; the user supplies rights-cleared music/VO. If cuts hit
  a BPM grid (pacing shows `beat_alignment`), tell them to cut on that grid.
- **captions** → if `captions.srt` exists, re-style it to match the original's look
  (position, colour, outline from caption track metadata).

## Accuracy expectations (be honest with the user)

Published numbers for the original rea-video method (their eval, weighted by shot duration;
see github.com/JuneYaooo/rea-video, eval/RESULTS.md): tools-only 98.3–99.6% on original
files, ~88.6% on platform-recompressed files; adding a vision model or agent visual review
brings recompressed files back to 99.6–100%. Shot-boundary detection there: 95% recall /
94% precision on hand-labelled clips. This package re-implements the same evidence classes
with simpler heuristics, so treat those numbers as the ceiling, not the guarantee — and
always run the review step on platform downloads (TikTok/Reels/WeChat re-encodes destroy
grain evidence).

## What this cannot do (tell the user up front)

- No audio stem separation (voice/music/SFX). Classes are heuristic; for real stems use a
  UVR-class model, then feed timing back by hand.
- Caption **text** needs OCR (tesseract) or the review step; stylised/kerned fonts defeat OCR.
- Intent, narrative and "why it works" are yours to analyse from L0/L2 — the tools measure,
  they don't editorialise.
- One video per run. Multi-episode stories need per-episode runs (see rea-toon for that use).
- Severely re-compressed videos may need `--scene-threshold` lowered and the review step.
- AI prompts are drafts from evidence + review; they are style recipes, not guarantees any
  model reproduces the shot.

## Ethics & legality (never skip)

Breakdowns are for **learning structure, pacing and technique**. Do not reuse the original's
footage, music, characters, logos or likeness. Remake with material the user owns. Follow
platform rules and local AI-content labelling laws when publishing. If the user asks to
repost or clone 1:1, refuse that part and offer the style-transfer path instead.

## Troubleshooting

- `ffmpeg not found` → install it; video-xray is a thin orchestrator over ffmpeg.
- Too many shots / shot-chopping → raise `--scene-threshold` or `--min-shot`.
- Missed hard cuts in dark scenes → lower `--scene-threshold` to 0.12.
- Long video slow → evidence decode is capped at 2400 frames automatically (fps scales down).
- OCR garbage → run with `--no-ocr` and get text in the review step instead.
- `apply-review` complains → `review.json` needs `{"shots":[{"shot": <int id>, "verdict": ...}]}`.
