# video-xray

**Reverse-engineer how any video was made — shot by shot — and hand the recipe to you or
your AI agent.**

Give it an MP4 and it returns: for every shot, whether it was **filmed**, **AI-generated**,
**built in code** (motion graphics/UI), or **screen-recorded** — with the measured evidence
for each call — plus the style system around them: cut points, pacing, beat-sync, caption
tracks (with OCR text + SRT export), audio class and BPM, and a **remake plan** batched to
your video model's limits.

```
   your video ──▶ SPLIT ──▶ MEASURE ──▶ DECIDE ──▶ PLAN
                 shots      grain       verdicts    remake
                            cadence     + review    batches
                            motion      queue       prompts
                            palette
                            metadata
```

Inspired by the method taught in *"How to reverse engineer any editing style (Turned it into
a skill)"* and the open-source [rea-video](https://github.com/JuneYaooo/rea-video) project
(Apache-2.0) it demonstrates. This package is an **independent, dependency-light
re-implementation** of that doctrine (ffmpeg + numpy + Pillow; no repo install required),
built so any agent — Claude Code, Codex, Cursor, Windsurf, or a plain LLM with a shell — can
run it end to end.

## Install (once)

```bash
apt install ffmpeg tesseract        # or: brew install ffmpeg tesseract
pip install numpy pillow pytesseract
```

## Use (humans)

```bash
python scripts/video_xray.py analyze video.mp4 --out out/ref
open out/ref/report.html            # visual report
```

## Use (agents)

Say to your agent, or hand it `AGENTS.md`:

> Install video-xray from this folder, then break down this video: /path/to/video.mp4

`SKILL.md` carries the full doctrine (evidence hierarchy, decision table, review flow,
remake rules, ethics). `AGENTS.md` carries the step-by-step operating procedure.

## The human-in-the-loop checkpoint

Offline measurement alone is ~99% accurate on original files but degrades on
platform-recompressed downloads (grain evidence is wiped out). So the pipeline **stops** and
writes `review_queue.md` for shots it cannot decide, you (or any vision model, using
`review_prompt.md`) look at the contact sheets, save `review.json`, and one command merges
everything back:

```bash
python scripts/video_xray.py apply-review out/ref
```

## Output folder anatomy

```
out/ref/
├── VIDEO.md          ← layered breakdown for agents (L0 card → L1 map → L2 timeline → L3 per-shot)
├── report.html       ← human report with contact sheets
├── evidence.json     ← every measurement
├── remake_plan.md    ← shooting plan / generation batches / code-rebuild list
├── review_queue.md   ← what still needs eyes (if any)
├── captions.srt      ← when caption text is known
├── shots/  sheets/  stills/
```

## Files in this package

| file | purpose |
|---|---|
| `SKILL.md` | agent skill: doctrine, decision table, thresholds, review + remake flow |
| `AGENTS.md` | universal step-by-step procedure for any CLI agent |
| `review_prompt.md` | exact prompt + JSON schema for the vision review step |
| `capabilities.json` | EDITABLE template of your video-model limits for remake batching |
| `scripts/video_xray.py` | CLI: `analyze` / `apply-review` / `report` |
| `scripts/xray_lib.py` | measurements: probe, scene cuts, cadence, grain, motion, palette, captions, audio |
| `scripts/xray_report.py` | output writers: VIDEO.md layers, report.html, sheets, SRT, remake plan |
| `example_output/` | a complete real run on a 30 s four-style demo clip (live / code / screen / ai) — read `example_output/VIDEO.md` to see the breakdown format before your first run |
| `LICENSE` | MIT |

## Honesty section

- Accuracy ceiling: the original rea-video project publishes ~98–99% (tools-only) on original
  files and ~88.6% on re-encoded platform downloads, rising to 99.6–100% with a vision
  review — this re-implementation uses the same evidence classes with simpler heuristics, so
  run the review step on anything downloaded from a platform.
- Audio voice/music/SFX classes are estimates, not stem-separated audio.
- Model capability numbers in `capabilities.json` are placeholders you must fill/verify.
- Breakdowns are for learning structure and technique. Remake only with material you own the
  rights to; do not repost or clone other people's videos, and follow AI-content labelling
  rules when publishing.

## Credits

- Method & doctrine: [rea-video](https://github.com/JuneYaooo/rea-video) by JuneYaooo
  (Apache-2.0) and the REA ("Reverse Engineer Anything") idea it credits: work back from what
  you see, back every claim with evidence, verify by measuring.
- Source video that inspired this package: "How to reverse engineer any editing style
  (Turned it into a skill)" — https://youtu.be/KnqTiAXUH7M
- Sound-stem tooling in the original project (not bundled here): UVR MDX-Net, Bandit v2
  (weights CC BY-SA 4.0).
