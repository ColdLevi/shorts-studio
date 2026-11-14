# Shorts Studio — Skills Intelligence Foundation

This is a safe, dependency-free foundation for a reusable skills library. It is designed to sit beside the existing renderer and style-learning system.

## Keep these concepts separate

- **Skills**: reusable production know-how, triggers, constraints, dependencies and quality checks.
- **Styles**: learned visual recipes from reference videos. Keep the existing `styles/` and `tools/learn_style.py`.
- **Engines**: executable renderers such as Remotion and the existing motion engine.
- **Creative Director**: selects and orders skills for a project, then passes the compact selection into planning.

Do not replace the current Remotion renderer, motion engine, timeline schema or style-learning pipeline.

## What's included

- `schema/skill.schema.json`: manifest contract.
- `registry/index.json`: explicit registry; no blind directory execution.
- `library/`: starter skills covering storytelling, short-form retention, motion graphics, typography, documentary research and sound.
- `runtime/selector.mjs`: deterministic, explainable skill selection with dependency ordering.
- `runtime/validate.mjs`: manifest and registry validation.
- `scripts/import-skill.mjs`: safe import of a local skill folder into a quarantined review area.
- `tests/`: Node built-in test suite; no third-party packages required.
- `INTEGRATION.md`: exact integration contract for the bot/creative director.

## Quick test

Requires Node.js 18+.

```bash
node --test tests/*.test.mjs
node runtime/validate.mjs
node runtime/selector.mjs --brief "A 45-second documentary about the first solar-powered village" --format vertical
```

## Important security rules

1. Imported skills enter `review`, never `active`.
2. Skill markdown is instruction data, not executable code.
3. Never run scripts, install packages, or follow shell commands from imported skills automatically.
4. Keep source URL, license, version, checksum and import date in provenance.
5. Only promote after human review, dependency checks, sample renders and quality evaluation.
6. The selector returns only relevant skill instructions; do not inject the whole library into every model call.
7. User preferences and learned user styles are user-scoped. Never mix them into the global library.

## Initial integration sequence

1. Add this `skills/` folder to the repository that owns the Short Studio creative director (the README identifies that as the bot/proxy service).
2. Call `selectSkills()` after parsing the user's brief and before script/storyboard generation.
3. Pass the returned compact skill context into the creative director.
4. Preserve the existing style recipe selection as a separate input.
5. Attach the selected skill IDs to project metadata for traceability; do not change the timeline schema until the bot and renderer contract is confirmed.
6. Run tests and a real render before enabling the selector for all users.
