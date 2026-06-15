# Usage guide

## The pipeline

A deck goes through these stages (run automatically on import, or by hand):

1. **Render** — each slide → a 2× PNG (`work/slides/`). PDF via PyMuPDF; PPTX via
   LibreOffice (pptx → pdf → PNG).
2. **Detect** — MinerU OCRs the rendered slides for text regions; for PPTX,
   python-pptx adds exact shape geometry and any real text frames. Large pictures
   (>60 % of a slide) become the background.
3. **Choreograph** — `auto_choreo.py` assigns sensible default entrances/idles
   (you refine these in the editor).
4. **Crop & patch** — each element is cut from the render (`work/crops/`), and a
   "footprint patch" (sampled fill colour or blurred backdrop) is generated so an
   element can animate away from its spot cleanly.
5. **Build** — `build.mjs` inlines PixiJS + GSAP + the manifest + base64 assets
   into a single `dist/presentation.html`.

One-command headless run:

```bash
python -m skull_studio.pipeline sample/demo.pdf
# flags: --skip-mineru (backgrounds only), --no-choreo, --bg-quality N, --out PATH, --no-build
```

The result is `dist/presentation.html` (viewer) and `dist/editor.html` (editor).

## The editor (Skull Studio)

Launch `skull-studio`, import a deck from the home page, then open the editor.
Press **E** to toggle the editor overlay in any built file.

**Navigation & layout** — arrow keys / click / swipe move between slides. With the
editor open, panels dock around the slide: element list (left), inspector (right),
menu bar + transport (top), rig timeline (bottom, when rigging).

**Element list** — thumbnails, a filter box, and per-element selection. The first
entry is **■ Background** (slide-level idle like Ken Burns). Each element shows its
name; rename in the inspector.

**Inspector** (per element)
- **Name** — friendly label; kept in HTML and PPTX exports.
- **Duplicate / ▲ Fwd / ▼ Back** — clone, or change stacking order.
- **Entrance** — fade / fadeUp·Down·Left·Right / scaleIn / maskReveal / blurIn /
  drawOn / staggerText, with delay/duration/ease.
- **Idle** — float / breath / pulse / sway / shimmer / meshWave (continuous loops).
- **Parallax** — mouse-depth.
- **Compositing** — blend mode (normal/add/screen/multiply/overlay/…) + opacity.
- **Element** (studio) — type, z-order, and the detection box (drag to move, gold
  corner to resize, then **Re-crop**).
- **Footprint patch** — none / auto / solid fill (colour) / blur (strength), plus
  **hide (censor)** to cover a logo or unwanted text.
- **Mask areas** — FineReader-style **+/− Box** and **+/− Poly** to add/subtract
  from an element's alpha mask.
- **Mesh deform** — see below.

**Tools menu / toolbar** — **▭ Box** and **⬡ Poly** draw new elements (polygons
become alpha-masked cutouts). **OCR** reads an element's text from the slide image.

**Mesh & 2D-bone rigging**
- Enable mesh deform, or pick a **Quick motion** preset (Breathe, Sway, Float,
  Pendulum, Wave).
- **① Setup pins** — click the image to add pins; gray = anchor (holds still),
  gold = animated. `Shift`+click a pin then click = child bone (chain);
  `Alt`+drag = rotate; `Delete` removes; **+ Pin / − Pin** buttons; **Pin role**
  toggles anchor⇄animated.
- **② Animate** — move the playhead, drag a pin to record a keyframe. The first
  keyframe auto-seeds rest keys at 0 s and the end so it loops home. **▶ Play**
  previews.
- **Timeline** — labeled ruler, per-pin rows; drag the playhead to scrub, drag a
  diamond to re-time, right-click to delete.

**Saving** — Studio autosaves to `work/manifest.json` (~1 s after edits). The
single-file editor saves to browser localStorage; **Export overrides.json** then
`build.mjs --apply overrides.json` bakes them in.

## Export options (File menu)

- **Preview** — builds and opens the final viewer.
- **Export HTML…** — single self-contained file; optional embedded editor; choose
  the output path (with **Browse**).
- **Export baked HTML (video/GIF)…** — a **no-WebGL** DOM slideshow: animated
  elements become looping `<video>`/`<img>`, the rest static images. Pick mp4/gif,
  fps, and **base64** (single portable file) or **folder** (small HTML + assets).
- **Export PPTX (PowerPoint)…**
  - image format **PNG** (lossless) or **JPEG** (much smaller),
  - **font size** override,
  - **animate entrances** → PowerPoint Fade (auto-play, staggered),
  - **animated assets**: bake idle/rig motion into looping **mp4** or **GIF**
    embedded at each element,
  - **patch layer** (export the footprint covers),
  - output path with **Browse**.
  - Text elements export as **editable text boxes**; blend-mode elements are
    flattened to images.

> **mp4 vs GIF for PPTX/baked HTML:** mp4 is far smaller and smooth; GIF is
> universal and loops with zero extra machinery but is large for photographic
> content. Prefer **mp4** unless you specifically need GIF compatibility.

## Tips

- Importing **replaces** the active project (`work/manifest.json`). Export
  `manifest.json` first if you want a backup.
- Patch, mask, and detection-box edits need **Re-crop & reload** to take effect
  (pixels are regenerated on disk); animation/blend/opacity edits are instant.
- Keep one editor tab open per project (saves use an optimistic lock to avoid a
  stale tab clobbering newer state).

## 3D models (PowerPoint)

Decks created with **Insert → 3D Models** import automatically — each model lands
as a `model3d` element.

- Out of the box it shows PowerPoint's rendered **preview image**, so it works
  everywhere (and is the fallback when WebGL is unavailable).
- With three.js it renders **live**: any animation baked into the model plays, and
  you can add spin. Select the model and use the **3D model** inspector section:
  *clip* (baked animation), *loop*, *auto-rotate °/s*, *camera FOV*.
- **Export → HTML** offers a *three.js* choice: **inline** (one self-contained
  file, ~0.7 MB heavier) or **vendor folder** (smaller HTML + a `vendor/` folder
  beside it); *embed 3D models* base64s the `.glb` for a true single file,
  otherwise they ride in a `models/` folder. three.js is added only when the deck
  actually contains 3D.
- **Export → PowerPoint** writes the models back as real 3D (a round-trip);
  PowerPoint shows the live model, other apps show the preview.

Try it without PowerPoint:

```bash
node skull_studio/make_sample_glb.mjs     # sphere/cone/torus -> sample/models
python -m skull_studio.make_sample_3d     # assemble a 1-slide deck in work/
node skull_studio/build.mjs               # dist/presentation.html (live 3D)
python -m skull_studio.export_pptx dist/sample3d.pptx   # round-trip
```
