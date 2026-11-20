---
format: video-xray VIDEO.md v1 (layered breakdown; inspired by the open VIDEO.md idea)
source: test_video.mp4
duration_s: 30.0
shots: 4
generated: 2026-11-20T05:11:22 by video-xray 0.1.0
---

# L0 · Card  (~150 tokens — read this first)
- Video: 640x360 @ 30.033 fps, 30.0 s, 4 shots.
- Verdict mix: ai x1, code x2, live x1. Uncertain/review: 1.
- Pacing: 6.0 cuts/min, median shot 8.0 s, 33.3% cuts on beat (~122.4 BPM).
- Audio: music-like (estimate), BPM ~122.4, 59 SFX-like onsets. voice/music/SFX separation is heuristic; UVR-class models give real stems
- Caption/overlay tracks: 1 (text known).
- Files: L1 overview below · L2 timeline below · L3 per-shot in shots/ · sheets in sheets/ · machine data in evidence.json · remake recipe in remake_plan.md.
- Evidence hierarchy: metadata AIGC tags > frame cadence > sensor grain > motion structure > palette. 'Looks like' never beats measurement.

# L1 · Overview & Map
## File map (read only what a question needs)
| file | contains |
|---|---|
| VIDEO.md (this file) | card, overview, timeline |
| shots/shot_NN.md | full per-shot evidence + remake hint (~200 tok each) |
| sheets/shot_NN.png | labelled contact sheet per shot |
| evidence.json | every measurement, machine-readable |
| remake_plan.md | batched remake recipe |
| review_queue.md | shots awaiting visual review + how to answer |

## Global findings
- Cadence: effective 18.78 fps vs nominal 30.03 fps — low effective fps suggests animation/AI/screen content.
- Overlay track: bottom band rows 149-163, 00:08.0-00:16.0 text="MOTION GRAP"
- SFX-like hits at (first 12): [0.49, 0.99, 1.49, 1.99, 2.49, 2.99, 3.49, 3.99, 4.5, 5.0, 5.5, 6.0] s

## Shot map
| id | start | dur | verdict | conf | key evidence |
|---|---|---|---|---|---|
| S001 | 00:00.0 | 8.0s | live | 0.80 | noise 0.0077, organic |
| S002 | 00:08.0 | 8.0s | code | 0.75 | noise 0.0000, organic |
| S003 | 00:16.0 | 8.0s | code | 0.80 | noise 0.0000, static |
| S004 | 00:24.0 | 6.0s | ai | 0.55 | noise 0.0000, organic |

# L2 · Timeline (one line per shot)
- 00:00.0–00:08.0 S001 live/0.80 [organic·noise 0.0077]
- 00:08.0–00:16.0 S002 code/0.75 [organic·noise 0.0000] +caption
- 00:16.0–00:24.0 S003 code/0.80 [static·noise 0.0000]
- 00:24.0–00:30.0 S004 ai/0.55 [organic·noise 0.0000]

# L3 · Per-shot files