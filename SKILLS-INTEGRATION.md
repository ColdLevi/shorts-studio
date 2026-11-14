# Integration contract for Short Studio

## Correct insertion point

The renderer repository README says the bot/proxy service writes the script, plans scenes and calls the GitHub Actions workflows, while this repository renders the editable timeline with Remotion. Therefore, the selector belongs in the **bot/creative-director service**, not inside Remotion's frame-render loop.

This foundation can live in either repository as a shared package, but the first runtime call must happen in the service that interprets the user's request.

## Request flow

```text
User brief
  -> parse intent (topic, audience, duration, format, genre, creative direction)
  -> load user profile and explicit style choice
  -> Skills selector (this package)
  -> Creative Director / script writer
  -> storyboard + asset plan
  -> existing timeline contract
  -> existing Remotion + motion-engine renderer
  -> QC and delivery
```

## Example call (ESM)

```js
import { selectSkills } from "./skills/runtime/selector.mjs";

const selection = await selectSkills({
  brief: userMessage,
  format: "vertical",
  durationSeconds: 45,
  genre: "documentary",
  audience: "general",
  requestedCapabilities: ["research", "maps", "kinetic-typography"],
  userProfile: {
    // Optional, user-scoped preferences. Do not write these into global skill manifests.
    preferredPacing: "measured",
    captionPreference: "clean"
  }
});

const creativeContext = [
  "SELECTED PRODUCTION SKILLS:",
  selection.context,
  "SELECTED SKILL IDS:",
  selection.skills.map(s => s.id).join(", ")
].join("\\n");

// Add creativeContext to the director's planning prompt.
// Keep the existing style recipe as a separate parameter.
// Do not pass the whole skills directory to the model.
```

## What to persist

Persist only lightweight project metadata, for example:

```json
{
  "creative_intelligence": {
    "skill_registry_version": 1,
    "selected_skill_ids": [
      "storytelling.core",
      "shortform.retention",
      "documentary.research",
      "motion.map-animation"
    ]
  }
}
```

Do not change `timeline/timeline.schema.json` just to store this metadata until the bot's project persistence contract is inspected. If project metadata cannot be stored safely yet, log the selection with the project ID.

## User preference separation

- Global skills: shared, versioned, reviewed capabilities.
- User profile: private preferences such as pacing, caption density, preferred visual complexity and tone.
- Learned styles: existing reference-derived style recipes.
- Per-project overrides: explicit user instructions for one video.

Priority order: explicit current request > project overrides > user profile > selected skill defaults.

## Importing `iart-ai/motion-skills`

Use the source as an initial reference library, not as a trusted executable dependency. Review its current license and each skill's provenance before importing. Convert skills into this manifest format, preserve attribution, remove unsafe commands and keep imported items in `review`. Do not claim that installing skills fine-tunes a model; skills provide contextual production instructions.

## Rollout gates

1. Unit tests pass.
2. Registry validation passes.
3. Selector output is deterministic and includes explanations.
4. Dependency cycles and missing dependencies fail validation.
5. A vertical short and a landscape video both render using the unchanged renderer.
6. Compare output quality with selector disabled vs enabled.
7. Enable gradually; retain a feature flag and rollback path.
