# Shorts Studio

Free cloud renderer for vertical Remotion shorts, running on GitHub Actions.

## Render a short
- Phone browser: repo > Actions > "Render short" > Run workflow > type the shot id > Run.
- Or from Termux: `echo Short10Fees > render-request.txt && git add -A && git commit -m render && git push`
- When it finishes (about 5 to 8 minutes), the MP4 is under Releases, with a direct download link.

## Add a new short
1. Put its composition in `remotion/src/shots/<name>/` and add it to `remotion/src/shots.manifest.json`.
2. Put its audio and images in `media/projects/<name>/`.
3. Push, then render it by id.

Engine: hassancs91/claude-faceless-shorts-creator (MIT).

## Telegram bot renders (make-short.yml)
The bot sends `repository_dispatch` `make-short` with `{chat_id, spec}`. The workflow records the voice (edge-tts),
paints one image per beat (Cloudflare FLUX), renders `StoryShort` with Remotion, normalises loudness and sends the MP4
to Telegram. Secrets needed here: TELEGRAM_TOKEN, CHAT_ID, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN.

## Video engine: project timelines (step 1)
Every bot video is saved as an editable project (`media/projects/<id>/timeline.json` + version history; assets on
release `project-<id>`) and rendered by the universal `Studio` composition at any canvas size (9:16, 16:9, 1:1, 4:5,
any WxH) with caption, font, transition and colour style tokens. Re-render a saved project with a JSON patch via
`repository_dispatch` `render-project`. Details: `timeline/README.md`. Old `StoryShort` props still render.
