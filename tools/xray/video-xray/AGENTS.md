# AGENTS.md — operating procedure for any coding agent

You (Codex, Cursor, Windsurf, Claude Code, or any LLM agent with a shell) are being asked to
reverse-engineer a video's style. Follow this procedure exactly. Full doctrine: `SKILL.md`.

## Step 0 — Environment check (30 s)

```bash
ffmpeg -version | head -1 && python3 --version && python3 -c "import numpy, PIL" && echo OK
```

If missing: `apt install ffmpeg tesseract` (or `brew install ffmpeg tesseract`), then
`pip install numpy pillow pytesseract`. Do not continue until OK.

## Step 1 — Locate the video

- Local file: use the path the user gave.
- URL (YouTube/TikTok/etc.): the user must download the file with a tool they are entitled to
  use (e.g. their platform's export, or yt-dlp where lawful) and give you the path. You do
  not need the platform original, but note in your summary that re-encoded downloads lose
  grain evidence and require the review step.
- If the file is not a video (`ffprobe` fails), stop and tell the user.

## Step 2 — Run the pipeline (one command)

```bash
python <package>/scripts/video_xray.py analyze /path/video.mp4 --out out/ref
```

Read stderr as it runs. It prints each shot's verdict and flags `review` shots.

## Step 3 — Read the breakdown (in this order, token-efficient)

1. `out/ref/VIDEO.md` → **L0 card only** (≈150 tokens). It answers 80% of style questions:
   verdict mix, pacing, BPM, caption tracks, file map.
2. `out/ref/VIDEO.md` → **L2 timeline** (one line per shot) when the user asks about
   structure or a specific moment.
3. `out/ref/shots/shot_NN.md` (L3) only for the specific shot in question.
4. Never paste `evidence.json` into context; query it (jq/python) for one field if needed.

## Step 4 — Resolve the review queue (mandatory if non-empty)

If `out/ref/review_queue.md` lists shots:
- If you can see images: open each `out/ref/sheets/shot_NN.png`, apply the rubric in
  `review_prompt.md`, and decide `live|ai|code|screen|avatar|3d` + confidence + reasons +
  subject + caption text + a remake prompt for `ai` shots.
- Otherwise, hand the user `review_prompt.md` + sheets for any vision model they use, or ask
  them to eyeball it.
- Save answers to `out/ref/review.json` (schema at the end of `review_prompt.md`), then:

```bash
python <package>/scripts/video_xray.py apply-review out/ref
```

## Step 5 — Present results to the user

Structure your answer as:
1. **How it was made** — verdict mix with the 2-3 strongest pieces of evidence (quote actual
   numbers, e.g. "shot S4: sensor grain σ=0.0117, organic motion, rigidity 0.31 → live").
2. **The style system** — pacing (cuts/min, median shot, beat sync %), captions (tracks +
   text + style), audio class + BPM, palette.
3. **The remake plan** — summarise `out/ref/remake_plan.md`: setups to film, generation
   batches (after filling `capabilities.json` with the user's models), code-rebuild list,
   materials the user must supply.
4. **Caveats** — name the review-resolved shots, re-compression warnings, audio-estimate
   warnings.
5. Point to `out/ref/report.html` for the visual version.

## Hard rules

- Never claim a verdict without citing the evidence line that produced it.
- Review-queue shots stay "uncertain" until the review step resolves them.
- Remake = style transfer with the user's own material. Refuse 1:1 reposts/clones and
  identity reuse (faces, logos, music, characters). Say why in one line, offer the legal path.
- Do not invent model capabilities: `capabilities.json` ships placeholders — make the user
  fill it, or verify the vendor docs yourself before quoting limits.
- Keep edits to thresholds in `scripts/xray_lib.py` (constants at the top), never in
  `video_xray.py::verdict` logic, so the doctrine stays auditable.

## Extension tasks you may be asked to do

- **Batch mode**: loop `analyze` over a folder; aggregate verdict mixes into one summary table.
- **Watch mode**: after `apply-review`, offer to draft the per-shot AI prompts into a
  copy-paste block for the user's video model.
- **Style library**: file each finished `VIDEO.md` under a library folder; future remakes
  retrieve style by verdict mix + pacing signature.
