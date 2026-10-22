# Project timelines (engine step 1)

Every video is now a saved, editable **project**:

```
media/projects/<id>/
  timeline.json      the video: canvas, style tokens, tracks  (committed)
  history/r<N>.json  every revision, full snapshot             (committed)
  history/log.jsonl  rev, time, message, JSON patch per revision
  renders.json       each MP4 made from it (release links)
  assets/            voice, images, clips  (gitignored, kept on release project-<id>)
```

`remotion/src/studio` holds the universal **Studio** composition: it renders any timeline at any
canvas size (9:16, 16:9, 1:1, 4:5, any WxH). Layout adapts per shape: caption height, title, the
motion-graphics zone and type size. Stills that don't match the canvas get a blurred fill.

## Timeline shape (full schema: timeline.schema.json, example: example.json)
- `canvas`: `{width, height, fps, background?}`
- `style`: `accent`, `font`, `caption` {preset, font, weight, size, color, highlight, stroke, background,
  case, position, words_per_group}, `transition` {type, duration}, `motion` (kenburns|static), `grade`
  (CSS filter), `progress_bar`, `vignette`, `title`, `graphic_sfx`
  - caption presets: bold-pop, karaoke-box, clean, subtitle, neon, word-by-word, none
  - style presets (tools/timeline.py): bold-pop, documentary, minimal, neon, karaoke, punchy, comic
  - transitions: cut, fade, dissolve, slide-left/right/up/down, zoom-in, zoom-out, wipe, blur, flash
  - fonts: Montserrat, Anton, Bebas Neue, Inter, Poppins, Oswald, Roboto, Playfair Display, Bangers,
    Space Grotesk, Archivo Black, Lora, DM Serif Display, Permanent Marker, Rubik Mono One
- `tracks.visuals[]`: `{id, kind: image|ai_video|graphic|stock|upload|color, start, end, src, fit, motion,
  transition, trim, playbackRate, loop, volume, graphic, narration, gen}`
- `tracks.captions`: `{enabled, words[{word,start,end}], style?}`
- `tracks.voice[]`, `tracks.music[]`: `{id, src, start, end, volume, loop, fade_in, fade_out, duck, gen}`
- `tracks.sfx[]`: `{id, src, at, volume, anchor?, offset?}` (anchor = a visual id: moves with it)
- `tracks.overlays[]`: title, text, lower-third, image (logo)
- `gen` on a clip = how it was made (tool, prompt, model, motion...). Change it and that clip is remade.
- `src`: `assets/x.jpg` (this project), `library/...`, `projects/<other>/...` or an https URL.

## Commands (tools/project.py, run from the repo root)
```
python3 tools/project.py info <id>
python3 tools/project.py patch <id> patch.json -m "why"   # RFC 6902, id paths: /tracks/visuals/@v3/gen/prompt
python3 tools/project.py build <id>                       # remakes only dirty/missing assets
python3 tools/project.py reformat <id> 16:9               # same assets, new canvas
python3 tools/project.py style <id> documentary [neon]    # style preset [+ caption preset]
python3 tools/project.py history <id> | revert <id> <rev>
python3 tools/project.py migrate old/props.json <id>      # old StoryShort props -> timeline
cd remotion && node scripts/timeline-frames.mjs ../media/projects/<id>/timeline.json --at=1,5   # QA stills
```

## Re-render from the bot (GitHub repository_dispatch)
`render-project` `{chat_id, project_id, patch?, message?}` -> pull assets, apply patch, remake only what
changed, render, send to Telegram. The bot's /reformat and /captions use it. Step 2's edit agent only has
to turn a chat request into a patch like:
```json
[{"op":"replace","path":"/tracks/visuals/@v3/gen/prompt","value":"a woman holding a brick of banknotes"},
 {"op":"replace","path":"/tracks/visuals/@v4/narration","value":"Then the country gave up on its own money."},
 {"op":"remove","path":"/tracks/visuals/@v2"},
 {"op":"replace","path":"/style/caption/preset","value":"karaoke-box"}]
```
Changing a narration re-records the voice and re-times every clip, caption and anchored SFX.
Extra op `merge` shallow-merges an object (e.g. `{"op":"merge","path":"/tracks/visuals/@v1","value":{"fit":"contain"}}`).
