# Remake plan

Generated from measured evidence. Live shots must be filmed; AI shots are batched per target-model limits; code shots become a motion-graphics project; screen shots must be re-recorded with material you own.

## 1. Shot budget by verdict
| verdict | shots | total s | how to remake |
|---|---|---|---|
| ai | 1 | 6.0 | batch into video-model generations (section 4) |
| code | 2 | 16.0 | one Remotion/HTML/canvas project (section 5) |
| live | 1 | 8.0 | film from the shooting plan below (section 3) |

## 2. Edit & audio plan
- Timeline: keep the original cut structure — 4 shots, 6.0 cuts/min, median 8.0 s.
- Cuts hit the beat grid (~122.4 BPM, 33.3% on beat) — cut your remake on the same BPM grid.
- Audio: music-like — voice/music/SFX separation is heuristic; UVR-class models give real stems. Use music/VO/SFX you have rights to.

## 3. Shooting plan (live shots)
| setup | shots | seconds |
|---|---|---|
| handheld jitter | S001 | 8.0 |
- Same-set detection is palette-based (proxy): check the stills to merge or split setups.

## 4. Generation plan (AI / avatar / 3D shots)
Batch shots so every generation fits inside the target model's limits (max clip length, shots per generation, reference images). Current capability table (verify current values before use):
| target | max clip s | shots/gen | ref images | notes |
|---|---|---|---|---|
| YOUR_VIDEO_MODEL_HERE | 10 | 1 | 1 | replace with your model; add one block per model available t |

Suggested batches (same-set = same dominant palette & motion class):
- Gen 1 (ai): shots S004 · 6.0s total
- Per-shot prompt template: describe subject + setting + camera move + pacing from the sheet; the VLM review step (review_prompt.md) can draft these.

## 5. Code plan (motion graphics / screen)
- 2 shot(s) are rebuildable as code (Remotion / HTML / canvas). Copy text content (from OCR/review), colours, and tween timings from the sheets.
  - S002 8.0s: organic motion, 27 colours, camera ≈ no physical camera (content motion, not sensor)
  - S003 8.0s: static motion, 18 colours, camera ≈ locked-off / tripod

## 6. Materials you must supply
- Screen recordings, screenshots, product photos, brand assets — anything the original author filmed or owned. rea-doctrine: remake with material you have rights to; never repost someone else's footage, music, characters or likeness.

## 7. Honest limits of this plan
- Same-set grouping uses palette proxies; AI/3D calls on re-compressed uploads can be wrong; audio classes are estimates. Fix them in the visual review step.