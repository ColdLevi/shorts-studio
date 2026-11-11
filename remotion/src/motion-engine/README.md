# Motion Engine — Phase 1

This is the first additive engine layer for Shorts Studio. It does not replace
the existing `shorts-studio/timeline@1` projects or renderer.

## Keyframe model

A layer may now carry an optional `keyframes` array. Times are seconds relative
to the layer's own `start` time. Each keyframe stores one or more numeric
properties:

```json
{
  "id": "title-main",
  "kind": "kinetic",
  "start": 0,
  "end": 3,
  "text": "THE FUTURE",
  "keyframes": [
    { "t": 0, "values": { "x": -12, "opacity": 0, "scale": 0.82, "rotation": -4 }, "ease": "back-out" },
    { "t": 0.55, "values": { "x": 0, "opacity": 1, "scale": 1, "rotation": 0 }, "ease": "smooth" },
    { "t": 2.7, "values": { "opacity": 1 } },
    { "t": 3, "values": { "opacity": 0 } }
  ]
}
```

Supported properties: `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`,
`opacity`, `width`, `height`, `blur`, `brightness`, and `saturation`.

Supported easing: `linear`, `hold`, `ease-in`, `ease-out`, `ease-in-out`,
`smooth`, `back-out`.

`evaluateKeyframes()` is pure and deterministic. `motionStyle()` converts
evaluated values into CSS. Phase 1 deliberately establishes and tests the
animation data contract before adding more visual layer types, masks, blend
modes, and editor controls.

## Compatibility

- Existing projects without `keyframes` remain unchanged.
- Keyframes are optional metadata on a layer; existing timeline fields retain
  their meaning.
- This does not claim Alight Motion project-file compatibility. A separate
  exporter will be designed after inspecting a legally obtained sample project
  and documenting the supported interchange format.
