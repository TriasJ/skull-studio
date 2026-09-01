# Rigs and 3D models

The two element features with the most structure. Both are optional: `rig` is
`null` on most elements, `model3d` exists only on `type: "model3d"`.

---

# `element.rig` — mesh / 2D-bone deformation

Puppet-warp on a PIXI MeshPlane. Schema, verbatim from
`runtime/src/50-deform.js:1-13`:

```jsonc
{
  "mesh":    { "verticesX": 12, "verticesY": 12 },
  "bones":   [{ "id": "chest", "parent": null, "x": 0.5, "y": 0.42,
                "angle": 0, "length": 0 }],
  "weights": { "mode": "auto", "falloff": 2.0, "maxInfluences": 2 },
  "anim":    { "duration": 4, "loop": true, "ease": "sine.inOut",
               "tracks": { "chest": [ { "t": 0, "x": 0.5, "y": 0.42, "angle": 0 } ] } }
}
```

Rules that are easy to get wrong:

- **All coordinates are normalized to the CROP**, not to the slide — 0-1 within
  the element's own image. Angles are **degrees**.
- **Pins are length-0 bones.** The editor only ever creates flat pins; `parent`
  chains are schema-ready but not exposed in the UI.
- **Tracks hold ABSOLUTE poses**, not deltas. Each keyframe is a full
  `{t, x, y, angle}`.
- A child bone **without** its own track follows its parent; **with** a track, its
  own absolute pose wins.
- To loop cleanly, the first and last keyframes must match. The editor seeds rest
  keys at `t: 0` and `t: duration` automatically when you record the first one —
  do the same by hand.
- The editor's default when a rig is enabled:
  `anim: { duration: 3.0, loop: true, ease: "sine.inOut", tracks: {} }`
  (`runtime/src/61-editor-inspector.js:542`).
- Rigs are CPU-skinned in the browser and re-implemented in numpy by
  `render_clips.py`, so rigged motion **does** bake to mp4/GIF for PowerPoint.

## Quick-motion presets

`runtime/src/66-editor-rig-presets.js` builds these; each anchors the bottom corners
and animates one pin with an 8-step sine sampled into keyframes.

| id | label | motion |
|---|---|---|
| `breathe` | Breathe | chest pin at (0.5, 0.42) rises/falls ±0.025 on y, base planted, 4 s |
| `sway` | Sway | top pin at (0.5, 0.1) moves side to side, 5 s |
| `float` | Float | whole shape bobs |
| `pendulum` | Pendulum | rotation about a top anchor |
| `wave` | Wave | travelling deformation across the mesh |

Hand-authoring a breathe-style rig:

```json
"rig": {
  "mesh": { "verticesX": 12, "verticesY": 12 },
  "bones": [
    { "id": "base_l", "parent": null, "x": 0.06, "y": 0.97, "angle": 0, "length": 0 },
    { "id": "base_r", "parent": null, "x": 0.94, "y": 0.97, "angle": 0, "length": 0 },
    { "id": "chest",  "parent": null, "x": 0.50, "y": 0.42, "angle": 0, "length": 0 }
  ],
  "weights": { "mode": "auto", "falloff": 2.0, "maxInfluences": 2 },
  "anim": {
    "duration": 4, "loop": true, "ease": "sine.inOut",
    "tracks": {
      "chest": [
        { "t": 0,   "x": 0.5, "y": 0.420, "angle": 0 },
        { "t": 1,   "x": 0.5, "y": 0.395, "angle": 0 },
        { "t": 2,   "x": 0.5, "y": 0.420, "angle": 0 },
        { "t": 3,   "x": 0.5, "y": 0.445, "angle": 0 },
        { "t": 4,   "x": 0.5, "y": 0.420, "angle": 0 }
      ]
    }
  }
}
```

For a simple breathing look, prefer the `breath` **idle** — it is a plain transform
and much cheaper. Reach for a rig only when different parts of the image must move
differently.

---

# `element.model3d` and `modelSrc`

A `type: "model3d"` element carries a `.glb` path plus a settings object.

```jsonc
"modelSrc": "models/prim_1.glb",
"model3d": {
  "clip": 0,                 // baked glTF animation index, or null
  "loop": true,
  "durationMs": 5000,
  "autoRotate": 30,          // degrees per second, editor-added spin
  "camera": { "fov": 45 },
  "transform": { "rot": [0.35, 0.6, 0], "scale": [1, 1, 1] },   // rot in RADIANS
  "orbit": false,            // interactive camera in the HTML viewer
  "previewSrc": "models/prim_1_prev.png",
  "sourceXml": null,         // see below
  "sourceSpid": null
}
```

## The one rule that decides everything: `sourceXml`

| `sourceXml` | Where it came from | PPTX export |
|---|---|---|
| **present** (verbatim am3d OOXML) | imported from a PowerPoint deck that used Insert → 3D Models | round-trips as **real, live 3D**, animations included, regardless of flags |
| **absent / null** | an editor primitive or anything synthetic | baked to a **flat picture** — unless you export with `--models 3d` |

```bash
python -m skull_studio.export_pptx dist/deck.pptx --models 3d
```

Note the HTTP `export-pptx-custom` task has **no** models option
(`studio.py:184-209`), so real 3D for synthetic models is CLI-only.

## Rendering behaviour

- Without WebGL, or before three.js loads, the element shows `previewSrc` — so a
  3D deck degrades gracefully everywhere.
- With three.js (r137, pinned for its UMD global and classic GLTFLoader) the model
  renders live into a texture composited into the 2D PixiJS scene.
- `idle: [{ "type": "autoRotate", "degrees": 30 }]` spins it; `model3d.autoRotate`
  carries the same value for the inspector.
- Entrances `rotateIn` and `scaleIn3D` are the 3D-aware ones.
- `orbit: true` enables drag-to-orbit / scroll-to-zoom / shift-drag-to-pan in the
  editor **and** the exported HTML. It is off by default so that a normal click
  still advances the slide.

## Shipping a 3D deck as HTML

| Goal | Build flags |
|---|---|
| one file, opens by double-click (`file://`) | `--threejs inline` (default) **and** `--embed-models` |
| smaller HTML, served over http | `--threejs vendor` (writes `dist/vendor/`) |
| default | inline three.js, models as sidecars in `dist/models/` — needs http |

With sidecar models or a vendor folder the browser blocks file-to-file requests.
Serve with `python -m http.server -d dist 8080`, or through the studio itself at
`http://localhost:8765/dist/presentation.html`.

three.js is only added to decks that actually contain 3D — a 2D deck pays nothing.

## Generating primitives

```bash
node skull_studio/make_sample_glb.mjs one <plane|cube|sphere|cylinder|cone|torus> <#rrggbb> <out.glb>
```

or, against a running studio:

```bash
curl -X POST http://localhost:8765/api/add3d \
  -H 'content-type: application/json' \
  -d '{"shape":"cube","color":"#cc4422"}'
# -> {"modelSrc": "models/prim_3.glb"}
```

or with the cookbook script, which does both the generation and the manifest entry:

```bash
python manifest_edit.py add-3d --slide s01 --shape cube --color '#cc4422' \
    --bbox 0.4,0.05,0.6,0.19 --auto-rotate 30
```

`node skull_studio/make_sample_glb.mjs` with no arguments writes
`sample/models/{sphere,cone,torus}.glb` with baked tumble animations — useful as
test fixtures for the animation path.
