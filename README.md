# Shorts Studio

Free cloud video renderer for the Telegram bot, running on GitHub Actions. The bot (the `llm-proxy` repo, on Vercel)
writes the script, plans the scenes and calls the workflows here. Everything is rendered by one Remotion composition,
`Studio`, from an editable project timeline.

## How a video gets made
1. You message the bot a topic (or a reference video to copy the look of).
2. The bot researches (or not, for personal stories), writes the script and picks scenes with the director.
3. `make-short.yml` records the voice (edge-tts), paints the pictures (Cloudflare FLUX), renders `Studio` with
   Remotion, normalises loudness and sends the MP4 to Telegram.
4. Every video is saved as a project: `media/projects/<id>/timeline.json` plus version history, assets on the
   release `project-<id>`. Details: `timeline/README.md`.

## Looks
- **Style learning (`learn-style.yml`)**: send the bot a reference video (link, or file up to 20 MB). It measures cuts,
  shot-length spread, hook length, tempo, how many cuts land on the beat, motion, colour and loudness
  (`tools/learn_style.py`, `tools/style_metrics.py`), has Gemini describe the style, and saves it as a reusable recipe.
  Several videos from one creator can be merged into one style.
- **What If pack** (`remotion/src/packs/whatif/`): the cartoon "what if..." look with insert shots, one room and one
  mood per video. The bot picks it for "what if" topics unless you name another look.

## Chat edits
Tell the bot any change in plain words ("make scene 4 a close-up"). It shows what changes (Apply/Cancel, or start with
"just"), then re-renders, re-voicing only changed lines and repainting only changed pictures. Every applied edit is a
version: `/scenes`, `/history`, `/undo`, `/restore <n>`, `/project`.

## Workflows (`.github/workflows/`)
- `make-short.yml`: render a video for the bot (`repository_dispatch` `make-short`).
- Re-rendering a saved project with a JSON patch is triggered by `repository_dispatch` `render-project`.
- `learn-style.yml`: learn a style from a reference video.
- `scene-test.yml`: manual test render of the What If scenes, with a contact sheet.

## Secrets (Settings > Secrets and variables > Actions)
`TELEGRAM_TOKEN`, `CHAT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`.

## Notes
- The old hand-built shorts and their render workflow were removed in commit `881ffbb`. Restore with `git revert 881ffbb`.
- Engine: hassancs91/claude-faceless-shorts-creator (MIT).
