# 3D models — design notes, insights, caveats & solutions

A durable record of the PowerPoint-3D-model feature: the plan, what was learned,
every gotcha hit during implementation, and how each was solved. Companion to the
user-facing sections in `USAGE.md` and the architecture summary in `ARCHITECTURE.md`.

## Goal

Import PowerPoint 3D models (**Insert → 3D Models**) into the web runtime, render
them live with **three.js** composited into the existing PixiJS scene, and export
them back to PPTX — a true round-trip, animations included.

## How PowerPoint stores 3D (verified against a real deck)

- The model is a standard **glTF 2.0 binary** at `ppt/media/model3dN.glb`
  (PowerPoint converts FBX/OBJ/STL to glTF on insert). Content-type override
  `model/gltf.binary`; the slide rel type is `…/office/2017/06/relationships/model3d`.
- On the slide it lives in `<mc:AlternateContent>`:
  - `<mc:Choice Requires="am3d">` → `<p:graphicFrame>` → `<a:graphicData uri=".../2017/model3d">`
    → `<am3d:model3d>` with `am3d:camera`, `am3d:trans` (rotation in 60000ths-degree),
    `am3d:raster` (→ preview PNG), `am3d:objViewport`, lighting (`ambientLight`/`ptLight`).
  - `<mc:Fallback>` → a plain `<p:pic>` of a rendered preview PNG at the same box.
- Scene animations are **glTF clips baked into the GLB**, referenced from the slide
  by `<a3danim:embedAnim animId="N">` (+ `posterFrame`) and *triggered* by a
  `<p:timing>` `presetClass="emph"` node whose `embedded1` value tweens 0→1 (looping
  when `repeatCount="indefinite"`).

## Architecture (where each piece lives)

- **`skull_studio/extract_model3d.py`** — raw-OOXML reader (python-pptx can't see
  `mc:AlternateContent`). Per slide returns `{models, timing}`; each model carries
  bbox, GLB/preview parts, camera, transform, clip ref, original `spid`, and the
  verbatim `<am3d:model3d>` XML.
- **`skull_studio/extract_pptx.py`** — `_add_models()` emits `model3d` elements and
  stashes `slide.model3dTiming`; `_prune_unsupported()` strips `mc:AlternateContent`
  + `p:contentPart` so python-pptx's shape loop doesn't crash.
- **`runtime/src/51-model3d.js`** — one offscreen three.js `WebGLRenderer` per model;
  its canvas is a `PIXI.Texture` used as the element's `view` (so z-order, parallax,
  transitions, GSAP entrances all compose). `AnimationMixer` plays the clip.
- **`skull_studio/export_model3d.py`** — post-processes the saved `.pptx` zip: adds
  GLB + preview parts, wires rels, splices `mc:AlternateContent` (verbatim or
  regenerated), and re-attaches/synthesizes the `<p:timing>`.
- **`skull_studio/build.mjs` / `fetch_libs.mjs`** — vendor + inline/​vendor three.js;
  GLB sidecar vs `--embed-models`.
- **`skull_studio/make_sample_glb.mjs` / `make_sample_3d.py`** — dependency-free GLB
  generator (sphere/cone/torus, with a baked 3-axis rotation clip) + sample deck.

## Insights

- **PowerPoint does the hard part:** everything is already glTF, which is exactly
  what three.js consumes — no model conversion needed.
- **Two renderers, cleanly separated:** rather than share a WebGL context, three.js
  renders to its own canvas that Pixi samples as a texture each frame. The 3D
  inherits all 2D compositing for free, and the "one-writer" scene graph is untouched.
- **`mc:Fallback` guarantees a 2D preview** for every model (OOXML forward-compat) —
  so a no-dependency "preview image" tier works everywhere and is the universal
  fallback (no WebGL, GLB too big, etc.). LibreOffice renders this fallback, so the
  normal crop pipeline captures it automatically.
- **Round-trip fidelity = reuse, don't re-synthesize.** Storing the model's original
  XML verbatim and only repointing embed ids (and remapping timing shape-ids) is far
  safer than regenerating, because the XML came from PowerPoint in the first place.

## Caveats & solutions (every gotcha, and the fix)

1. **python-pptx crashes on the deck** (`has_ph_elm` AttributeError). Its shape loop
   chokes on `mc:AlternateContent` (3D) and `p:contentPart` (ink).
   → `_prune_unsupported()` removes those from the in-memory tree before iterating;
   3D is read separately from the raw package, ink isn't imported.

2. **3D shows only flat shapes when the HTML is opened from disk (`file://`).**
   three.js is ESM-only and browsers block ES-module loading over `file://`.
   → Pin three.js to **r137** (last UMD build) + classic GLTFLoader, shipped as plain
   `<script>` globals. No modules, no import map.

3. **…and even then the models don't load from `file://`.** GLBs were sidecar files,
   and `fetch()` of a sibling file is also blocked over `file://`.
   → For a double-click single file use **inline three + `--embed-models`** (base64
   GLBs as `data:` URLs — `fetch` of a `data:` URL is allowed). Big decks: serve over http.

4. **PowerPoint says the exported file is corrupt and strips the models on repair.**
   The *regenerated* `am3d:model3d` (for models with no original XML) was missing
   `objViewport` + lighting and had a zero `spPr` extent — schema-invalid.
   → Regenerate the *full* structure PowerPoint itself writes.

5. **Materials look blown-out in PowerPoint.** The regenerated point light was at
   intensity ~9.8.
   → Lower the synthesized ambient/point-light values; also retune the three.js
   studio lights for r137's (pre-physical) intensity scale.

6. **Exported PPTX loses 3D animations.** The model data round-tripped, but the
   `<p:timing>` that *triggers* the clip was dropped.
   → Capture the slide's original `<p:timing>` on import (`slide.model3dTiming`) and
   replay it on export with shape-ids remapped (two-phase placeholder swap so
   overlapping old/new id ranges can't clobber). For generated models with a baked
   clip but no captured timing, *synthesize* a `<p:timing>` emph node (mirrors the
   real structure) + an `embedAnim` reference in the model3d.

7. **PowerPoint marks the shape animated but Play does nothing.** PowerPoint owns the
   **root node's** transform (from `am3d:trans`) and ignores animation on the root —
   the real Microsoft models always animate **child** nodes (verified: their root is
   an un-animated group; channels target descendants). Our generated GLB animated the
   single root node, so three.js played it but PowerPoint discarded it.
   → Generate the GLB with a root *group* node + a named child mesh node, and target
   the **child** with the rotation clip.

8. **Animation didn't play in three.js after the child-node change.** three binds
   animation tracks to nodes **by name**; the nodes were unnamed.
   → Name the nodes (`root`, `spin`). (PowerPoint uses the node *index*, so names
   don't affect it — but they're required for three.js track binding.)

9. **Synthetic models open zoomed-in / clipped in PowerPoint** (each shape fills its
   whole box). The regenerated `am3d:camera`/scale didn't match the model's size:
   model radius ~1 unit × `meterPerModelUnit=1` = ~1 m, but camera ~1.4 m at a narrow
   32° FOV frames only ~0.4 m → ~2.6× too big.
   → Reverse-engineered the real Hubble's proven framing: camera-z `67286916` (≈1.87 m,
   1 m ≈ 36e6 EMU), 45° FOV, model physical radius ≈ model-units × `meterPerModelUnit`,
   framed when radius ≈ distance × sin(fov/2). Fix: **normalize sample GLB geometry to
   unit bounding radius** (centered) and regenerate with camera-z `67286916`, 45° FOV,
   `meterPerModelUnit=0.5` → ~0.5 m model at 1.87 m → ~70% of frame. (Three.js is
   unaffected — its runtime camera auto-frames from the bounding box.)

### Still open / hardest part
**3D scene-animation playback for *synthetic* models in PowerPoint is unconfirmed.**
The XML matches PowerPoint's own structure (child-node clip, embedAnim, emph timing),
but it can't be verified without PowerPoint, and PowerPoint may only replay embedded
clips it imported/processed itself. The reliable path is **verbatim**: exporting a deck
that was *imported from PowerPoint* reuses PowerPoint's own camera + animation XML
(only shape-ids remapped), so framing and animation are PowerPoint-authored. Test
order: real-deck round-trip first (verbatim), then the generated sample. Also recall
3D scene animations typically only run in **Slideshow**, often on click (the timing
sits in the interactive main sequence).

## Things to keep in mind / verify with real PowerPoint

- 3D **scene animations typically only play in Slideshow mode** (F5 / Present), not
  in the normal-view animation-pane *Play* preview — a long-standing PowerPoint quirk.
  If a model "won't play," test the actual slideshow first.
- Diagnostic split: `dist/sample3d.pptx` exercises the **generated** animation path;
  exporting the real imported deck exercises the **verbatim** path. Testing both
  isolates whether an issue is in our synthesis or deeper.
- Editor edits persist to `localStorage` keyed by deck `docId`; a viewer on the same
  `docId` re-applies them. Hard-refresh / clear site data if a viewer shows stale
  edits. (Disk/export are unaffected — they read `work/manifest.json`.)

## Non-goals (deliberately out of scope)

- Editing model geometry/materials (we pose/animate/clip-select and round-trip, not model).
- PowerPoint UI-preset animations (Turntable/Swing authored in PowerPoint, encoded in
  `<p:timing>` rather than as glTF clips) — the validated deck used embedded glTF clips.
- DRACO/KTX2-compressed GLBs (none encountered; would need extra decoders).
- A fully relocatable wheel: the editable-install model (assets beside the repo) stands.
