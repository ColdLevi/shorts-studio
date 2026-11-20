# Review queue — visual check needed

These shots' offline evidence was inconclusive (usually: no sensor grain but organic motion, or grain lost to platform re-compression). Look at each sheet and answer with the JSON schema at the end of review_prompt.md. Then:

    python scripts/video_xray.py apply-review out/ref

## S004 · 00:24.0–00:30.0
- look at: sheets/shot004.png
- current guess: ai @ 0.55 — no sensor grain yet organic/parallax motion — typical of AI video; 50 unique colours (quantised)
- decide: live | ai | code | screen | avatar | 3d (+ confidence + reasons)
- also give: subject description (for the AI prompt) and caption text if any
