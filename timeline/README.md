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

# Engine step 2: chat re-edits

The Studio bot edits the **current project** from plain chat. Any message about the video ("swap scene 3 for a rocket
launch", "make the hook punchier", "cut scene 5", "slower pacing", "bigger yellow captions", "change the music",
"make it 16:9", "rewrite the ending") goes to ONE edit-model call that returns a JSON patch with `@id` paths. The bot
(`llm-proxy/api/_timeline.mjs`) sanitises it (replace on a missing key becomes add; machine fields like `src`, `words`,
`segments`, `hash`, `rev` are dropped), applies it to the saved timeline, validates it against `timeline.schema.json`,
and shows a short summary with what will be remade, plus **Apply / Cancel**. Start the message with "just" to apply at once.

Bot commands: `/scenes` (scenes 1..N with words and visual type), `/history` (versions), `/undo`, `/restore <n>`,
`/project [n|id]` (which video edits go to), `/edit <change>`; `/reformat` and `/captions` use the same edit queue.

## Edit queue (nothing gets lost)
`render-project` now carries `edits: [{id, patch | revert, message}]`: every edit the bot sent that the repo has not
logged yet. `project.py edits <id> job/edits.json` skips ids already in `history/log.jsonl`, applies the rest in order and
saves **one version per edit** (`edit_id`, `kind`, `remade` in the log). Runs are grouped per project, so a newer run can
replace a queued one without dropping its edit. Exit code 4 = nothing could be applied (bot is told, no render);
5 = everything was already applied (no render).

## Change-aware rebuild
- **Voice:** the voiceover is kept as per-scene segments (`tracks.voice[0].segments`). Old single-file projects are
  split at the scene boundaries on their first edit. A rebuild re-records only lines whose words changed (or all of
  them if the voice or rate changed), joins the segments sample-exactly and re-times every scene, caption word,
  anchored SFX and overlay from the real segment lengths. Cutting or reordering scenes re-records nothing.
- **Pictures:** only scenes whose recipe (`gen`, `kind`, or `dirty`) changed are repainted (Cloudflare FLUX etc.).
- Everything else comes from the project release `project-<id>`; then Remotion renders and FFmpeg normalises.

## Versions
`/history` = `project.py versions <id>` (a step-1 "rebuilt ..." revision folds into the edit before it).
`/undo` goes to the version before the current state (an undo after an undo keeps going back); `/restore <n>` makes
v<n> current again as a new version. Restores reuse saved assets, so they only re-render.

```
python3 tools/project.py scenes <id>
python3 tools/project.py versions <id>
python3 tools/project.py edits <id> job/edits.json
python3 tools/project.py diff old.json new.json        # what would be re-voiced / repainted
python3 tests/test_edits.py                           # patch/diff/rebuild tests (offline, needs ffmpeg)
node tests/bot_timeline.test.mjs && node tests/bot_flow.test.mjs   # bot-side tests (finds ../llm-proxy)
```
