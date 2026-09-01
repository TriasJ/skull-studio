# Skull Studio CLI reference

Every flag below is taken from the argparse definitions in the source. Run everything
from the **repo root** — `work/` and `dist/` always resolve there.

---

## `skull-studio` — the studio server
`skull_studio/studio.py:493-498` · equivalents: `python -m skull_studio.studio`, `python launch.py`

| Flag | Default | Meaning |
|---|---|---|
| `--port N` | `8765` | binds 127.0.0.1; walks forward up to 20 ports if busy and prints the real one |
| `--no-browser` | off | do not open a browser (use this in agent contexts) |
| `--editor` | off | open `/editor` instead of the home page |

---

## `python -m skull_studio.pipeline <deck>` — import in one command
`skull_studio/pipeline.py:63-74`

| Flag | Default | Meaning |
|---|---|---|
| `deck` (positional) | — | `.pdf` or `.pptx`; PPTX routes through `extract_pptx` and needs LibreOffice |
| `--ocr mineru\|rapid\|none` | `mineru` | **prefer the default** - full layout, trust its segmentation. `rapid` = bundled RapidOCR fallback, text only, no download. `none` = backgrounds only |
| `--skip-mineru` | off | alias for `--ocr none` |
| `--no-choreo` | off | do not auto-assign entrances/idles |
| `--bg-quality N` | `78` | background WebP quality |
| `--no-build` | off | stop after crops; do not build HTML |
| `--out PATH` | `dist/presentation.html` | output HTML path |

Stages run: render → OCR → draft manifest → auto_choreo → debug_overlay →
crop_and_patch → validate → `build.mjs` (+ `build.mjs --editor`).

**This replaces `work/manifest.json`.** Back it up first.

---

## `python -m skull_studio.export_pptx [out.pptx]`
`skull_studio/export_pptx.py:329-348`

| Flag | Default | Meaning |
|---|---|---|
| `out` (positional) | `dist/presentation.pptx` | relative paths resolve against the repo root |
| `--format png\|jpg` | `png` | jpg is roughly 7x smaller |
| `--quality N` | `85` | JPEG quality |
| `--patches` | off | also export the footprint patch layer |
| `--font-size N` | `0` (auto) | fixed pt for text boxes |
| `--font-scale F` | `1.0` | multiplier on the auto/fixed size |
| `--animate` | off | entrances become PowerPoint Fade, staggered, auto-play |
| `--clips none\|mp4\|gif` | `none` | embed looping clips for animated elements — **run `render_clips` first** |
| `--fps N` | `18` | clip frame rate |
| `--models picture\|3d` | `picture` | `3d` writes synthetic/editor models back as real am3d 3D |

Text elements without a blend mode export as **editable text boxes**; blend-mode
elements are flattened to images.

---

## `python -m skull_studio.render_clips`
`skull_studio/render_clips.py:615-623`

| Flag | Default | Meaning |
|---|---|---|
| `--format mp4\|gif` | `mp4` | |
| `--fps N` | `18` | |
| `--max-dur S` | `6.0` | seconds per loop |
| `--max-dim N` | `800` | longest side in px; `600` keeps PPTX small |
| `--element-id ID` | all | bake only this element |

Writes `work/clips/<id>.<ext>`, `<id>_poster.png` and `work/clips/index.json`, which
both `export_pptx --clips` and `build_baked.mjs` read. Needs **ffmpeg on PATH**.

---

## `python -m skull_studio.crop_and_patch`
`skull_studio/crop_and_patch.py:147-151`

| Flag | Default | Meaning |
|---|---|---|
| `--bg-quality N` | `78` | background WebP quality |
| `--bg-scale F` | `1.0` | background downscale factor |

Regenerates `work/crops/*.webp` and `work/patches/*` from the manifest's boxes. **Run
this after changing any `bbox`, `polygon`, `regions`, `cleanup`, `fillColor` or
`blurRadius`** — those are baked into pixels on disk.

---

## Stage scripts with positional sub-commands

| Command | Purpose |
|---|---|
| `python -m skull_studio.extract render\|mineru\|draft <deck.pdf>` | PDF render (2x PNG) / MinerU run / draft manifest |
| `python -m skull_studio.extract_pptx render\|mineru\|draft <deck.pptx>` | LibreOffice render, OCR, merge exact shape geometry + real text frames |
| `python -m skull_studio.extract_ocr <deck.pdf>` | RapidOCR draft manifest (same shape as `extract draft`) |
| `python -m skull_studio.extract_model3d <deck.pptx>` | probe: print the 3D models found in a PPTX as JSON |
| `python -m skull_studio.export_element <element-id> png\|jpg` | one element → `work/export/<id>.<fmt>` |
| `python -m skull_studio.validate_manifest [path]` | schema gate; defaults to `work/manifest.json`; exit ≠ 0 on error |

## No-argument scripts

| Command | Purpose |
|---|---|
| `python -m skull_studio.auto_choreo` | assign default entrances/idles, in place |
| `python -m skull_studio.debug_overlay` | numbered bbox overlays → `work/debug/overlay_NN.png` |
| `python -m skull_studio.make_sample` | regenerate `sample/demo.pdf` |
| `python -m skull_studio.make_sample_3d` | 1-slide, 3-model demo project into `work/` |
| `python -m skull_studio.make_showcase` | the 4-slide feature showcase into `work/` |

---

## Node build scripts

### `node skull_studio/build.mjs`
`skull_studio/build.mjs:15-28`

| Flag | Default | Meaning |
|---|---|---|
| `--manifest PATH` | `work/manifest.json` | |
| `--out PATH` | `dist/presentation.html` (or `dist/editor.html` with `--editor`) | absolute paths honoured |
| `--editor` | off | build the editor page |
| `--embed-editor` | off | viewer that can toggle the editor with **E** |
| `--apply overrides.json` | — | bake single-file-editor edits; **throws if `docId` mismatches** |
| `--threejs inline\|vendor` | `inline` | only matters for decks containing 3D |
| `--embed-models` | off | base64 the `.glb` files into the page |

For a 3D deck that opens by double-click (`file://`) you need `--threejs inline`
(default) **and** `--embed-models`. Otherwise serve it over http.

### `node skull_studio/build_baked.mjs`
`skull_studio/build_baked.mjs:17-20`

| Flag | Default | Meaning |
|---|---|---|
| `--manifest PATH` | `work/manifest.json` | |
| `--out PATH` | `dist/baked.html` | |
| `--format mp4\|gif` | `mp4` | |
| `--assets base64\|folder` | `base64` | `folder` writes a sibling `<name>_assets/` dir |

No WebGL: animated elements become `<video>`/`<img>`, everything else a static image.
Run `render_clips` first.

### `node skull_studio/fetch_libs.mjs`
No flags. Downloads PixiJS 8.16.0, GSAP 3.12.7, three r137 + GLTFLoader into
`runtime/vendor/`. The only network step in the whole tool.

### `node skull_studio/make_sample_glb.mjs [outDir]`
Default outDir `sample/models`; writes `sphere.glb`, `cone.glb`, `torus.glb` with baked
tumble animations. Single-primitive mode:

```bash
node skull_studio/make_sample_glb.mjs one <plane|cube|sphere|cylinder|cone|torus> <#rrggbb> <out.glb>
```

---

## Common chains

```bash
# import a PDF, review the detection, rebuild
python -m skull_studio.pipeline deck.pdf --ocr mineru
python -m skull_studio.debug_overlay          # read work/debug/overlay_NN.png
# ...fix bboxes in work/manifest.json...
python -m skull_studio.crop_and_patch
python -m skull_studio.validate_manifest
node skull_studio/build.mjs

# full-fat PowerPoint
python -m skull_studio.render_clips --format mp4 --max-dim 600
python -m skull_studio.export_pptx dist/deck.pptx --format jpg --clips mp4 --animate --models 3d

# no-WebGL slideshow
python -m skull_studio.render_clips --format mp4
node skull_studio/build_baked.mjs --out dist/baked.html --format mp4 --assets base64

# regenerate the feature showcase (all entrances, idles, particles, 3D)
node skull_studio/make_sample_glb.mjs
python -m skull_studio.make_showcase
node skull_studio/build.mjs
```
