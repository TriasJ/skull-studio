# Changelog

All notable changes to this project are documented here. This project follows
loose [semantic versioning](https://semver.org/) while pre-1.0.

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
