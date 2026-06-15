# Changelog

All notable changes to this project are documented here. This project follows
loose [semantic versioning](https://semver.org/) while pre-1.0.

## [Unreleased]

### 3D models (PowerPoint → three.js, round-trip)
- **Import** inserted PowerPoint 3D models (`am3d:model3d`). Each becomes a
  `model3d` element: the GLB is extracted to `work/models/`, and camera,
  transform, embedded-animation clip and the original XML are read straight from
  the slide (python-pptx can't see them, so we parse the raw package).
- **Tier 1 (no new deps):** every model already works as a static element via
  its rendered 2D preview — the universal fallback (no WebGL, GLB too big, etc.).
- **Tier 2 (three.js):** models render live, composited into the PixiJS scene
  (render-to-texture, so z-order, parallax, transitions and entrances all apply).
  Baked glTF animation clips play via `AnimationMixer`; `autoRotate` adds spin.
- **Editor:** a *3D model* inspector section (animation clip, loop, auto-rotate,
  camera FOV), applied live.
- **Export:** true round-trip — models are spliced back into the exported `.pptx`
  (`mc:Choice` 3D model + `mc:Fallback` preview), verbatim when unedited, and the
  slide's 3D **scene animations replay** (original `<p:timing>` captured on import
  and re-emitted with shape-ids remapped). Reopens without a "repair" prompt.
- **three.js** is pinned to r137 (last UMD/global build) and shipped as classic
  `<script>` so 3D works even from `file://`. Delivery is an export choice: *inline*
  or *vendor* folder; with *embed 3D models* the whole deck is one double-clickable
  file. Included only for decks that contain 3D.
- New: `skull_studio/extract_model3d.py`, `export_model3d.py`,
  `runtime/src/51-model3d.js`, `make_sample_glb.mjs`, `make_sample_3d.py`.

## [0.1.0] — initial public release

First open-source release. Everything below shipped together.

### Pipeline
- Import **PDF** (PyMuPDF) and **PPTX** (LibreOffice render + python-pptx geometry).
- **MinerU OCR** to recover text baked into slide images.
- Auto-segmentation: large pictures → backgrounds; pictures/shapes → elements;
  text (OCR or real) → text elements.
- Automatic first-pass choreography; element crops + fill/blur footprint patches.
- One-command headless `pipeline` and per-stage modules.

### Editor (PixiJS + GSAP)
- Element list with thumbnails, filter, rename, duplicate, z-order.
- Entrances (fade family, scaleIn, maskReveal, blurIn, drawOn, staggerText),
  idle loops (float, breath, pulse, sway, shimmer, meshWave), Ken-Burns
  backgrounds, mouse parallax.
- Compositing: 13 blend modes + opacity.
- **Mesh & 2D-bone rigging**: pins/anchors, bone chains, rotate, quick-motion
  presets, a keyframe timeline with draggable playhead/keyframes, Setup/Animate
  modes, auto loop-home keyframes.
- Draw **box / polygon** elements (alpha-masked cutouts), boolean **mask areas**,
  **footprint patches** and **censor/hide**, **region OCR**, deck options.
- Dockable workspace, tooltips, in-app help, custom import/export paths with a
  server-backed **Browse** picker.

### Export
- **HTML**: self-contained viewer, editor app, or embedded-editor hybrid.
- **PPTX**: editable text boxes, Fade entrances, baked **mp4/GIF** motion clips,
  PNG/JPEG, font-size override, patch layer. One-timing-per-slide (no "repair").
- **Baked HTML**: no-WebGL DOM slideshow with video/GIF assets (base64 or folder).

### Packaging
- pip-installable package with a `skull-studio` console command.
- Cross-platform `install.py`; vendored PixiJS/GSAP fetched on install.
- Original sample deck generator; MIT licensed; full docs.
