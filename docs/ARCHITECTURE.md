# Architecture

## Big picture

```
 deck (PDF/PPTX)
   │  render (PyMuPDF / LibreOffice)        ── skull_studio/extract*.py
   │  detect (MinerU OCR + python-pptx)
   ▼
 work/manifest.json  ◄── the single source of truth (edited live by the editor)
   │  crop + patch                          ── crop_and_patch.py
   │  (optional) bake clips                 ── render_clips.py  (numpy + OpenCV + ffmpeg)
   ▼
 build  ── build.mjs (HTML) │ build_baked.mjs (no-WebGL HTML) │ export_pptx.py (PPTX)
   ▼
 dist/  presentation.html · editor.html · baked.html · presentation.pptx
```

`skull_studio/studio.py` is a stdlib HTTP server (the "Studio" app): it serves the
editor, exposes `/api/*` (manifest get/save, run a task, browse the filesystem,
region OCR), and runs the Python/Node scripts above as subprocesses.

## Manifest schema (`work/manifest.json`)

```jsonc
{
  "version": "1.0",
  "meta":  { "title": "...", "docId": "deck-<hash>", "sourcePdf"|"sourcePptx": "..." },
  "deck":  { "designWidth": 1280, "designHeight": 720, "pixelScale": 2,
             "background": "#000000",
             "transition": { "type": "crossfade", "duration": 0.9 },
             "navigation": { "keyboard": true, "click": true },
             "buildOptions": { "bgQuality": 78, "bgScale": 1.0 } },
  "slides": [{
    "id": "s01", "index": 0,
    "background": { "src": "slides_webp/slide_01.webp",
                    "idle": { "type": "kenBurns", "scale": 1.04, "duration": 14, "yoyo": true } },
    "elements": [{
      "id": "s01_e02", "name": "Title", "type": "text|image|shape", "role": "title|body|figure",
      "text": "...(OCR/real)...",
      "bbox": [x0,y0,x1,y1], "cropBbox": [...],          // normalized 0–1, top-left origin
      "crop": "crops/s01_e02.webp", "polygon": null, "regions": null,
      "z": 10, "cleanup": "none|auto|fill|blur", "fillColor": "#0b0a08", "patch": null,
      "blurRadius": 40, "hidden": false, "blendMode": "normal", "opacity": 1,
      "entrance": { "type": "fadeUp", "delay": 0.3, "duration": 1.1, "ease": "power3.out" },
      "idle": [{ "type": "breath", "amount": 0.008, "period": 6 }],
      "parallax": 0.25,
      "rig": { /* see below, or null */ }
    }]
  }]
}
```

**Coordinate conventions** — all bboxes are normalized `[x0,y0,x1,y1]`, top-left
origin, y-down (matches MinerU, PixiJS, and PowerPoint after EMU scaling). The
deck design space is the slide size in **points** (1 pt = 12700 EMU for PPTX).

## Runtime modules (`runtime/src/`, plain IIFEs concatenated in numeric order)

| # | File | Role |
|---|---|---|
| 00 | core | namespace, math, ease whitelist, bbox helpers |
| 10 | assets | base64 / URL → `PIXI.Texture` (dual source: built file vs studio) |
| 20 | stage | `Application.init`, letterbox + dockable workspace inset |
| 30 | slides | scene graph, navigation, transitions, the one-writer node stack |
| 40 | anim | entrance + idle effect registry → GSAP/ticker |
| 45 | parallax | global pointer tracker (freezes the rigged element) |
| 50 | deform | **rig**: pins/bones, auto-weights, CPU skinning |
| 60–66 | editor | core/inspector/rig/timeline/persist/menus/presets (stripped from viewer builds) |
| 90 | main | boot: parse manifest, apply stored edits, start |

**One-writer rule** — each element nests `parallaxNode → animNode → idleNode →
view`; exactly one system writes each node (parallax / entrance timeline / idle /
rig vertex buffer), so GSAP and the ticker can never fight over a property.

Viewer builds strip modules `60–63,65,66` (editor only); `64-persist` stays so
localStorage overrides still apply. `build.mjs` toggles this with `--editor` /
`--embed-editor` and comment-marker regions in `template.html`.

## Rig (`50-deform.js`, ported to Python in `render_clips.py`)

A `PIXI.MeshPlane` grid over the crop; **pins** are length-0 bones
(`{id, parent, x, y, angle, length}`, normalized to the crop). Weights are
inverse-distance-to-bone-segment, top-k, normalized. Per frame: GSAP tweens each
bone's pose, world matrices are composed down parent chains, vertices are
skinned (`Σ wᵢ·Mᵢ·localᵢ`) and the buffer re-uploaded. `render_clips.py`
reproduces this in numpy and warps the crop with `cv2.remap` for video baking.

## Export internals

- **HTML** (`build.mjs`) — escape `</`, inline vendor + manifest + base64 assets +
  concatenated runtime. `--out` honours absolute paths.
- **PPTX** (`export_pptx.py`) — points→EMU (×12700). Text → text boxes; images →
  pictures at their bbox; blend elements → flattened PNG composited over the
  background; clips → `add_movie` (mp4) / `add_picture` (gif). **Exactly one
  `<p:timing>` per slide** is required by the schema — the exporter strips any
  existing timing (including the one `add_movie` injects) and writes a single
  combined block of Fade entrances + media auto-play. Multiple timings is the
  classic cause of PowerPoint's "repair" prompt.
- **Baked HTML** (`build_baked.mjs`) — a DOM/CSS slideshow; animated elements are
  `<video loop autoplay>`/`<img>`, others static `<img>`; CSS entrances; assets
  base64 or in a sibling folder.

## Clip render (`render_clips.py`)

For each element with idle/rig motion: composite the transformed crop over its own
background region per frame (so the clip is opaque and drops seamlessly back at the
bbox), then `ffmpeg` encodes mp4 (libx264/yuv420p) or gif (palettegen/paletteuse,
`--max-dim` downscale). Writes `work/clips/<id>.<ext>` + a poster + `index.json`
consumed by the exporters.
