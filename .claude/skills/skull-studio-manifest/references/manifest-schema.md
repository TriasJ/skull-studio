# `work/manifest.json` — field reference

The single source of truth for a deck. Written by the importers, mutated by the
editor, read by every exporter. The enforceable contract is
`skull_studio/validate_manifest.py`; the prose spec is `docs/ARCHITECTURE.md:23-56`.
A machine-readable JSON Schema mirroring the validator ships alongside this file as
`manifest.schema.json`.

**Coordinates everywhere are normalized `[x0, y0, x1, y1]`, 0-1, top-left origin,
y down.**

---

## Top level

| Field | Type | Notes |
|---|---|---|
| `version` | `"1.0"` | the only value in use |
| `meta` | object | see below |
| `deck` | object | see below |
| `slides` | array | see below |

All four are **required** — the validator fails immediately if any is missing.

### `meta`

| Field | Notes |
|---|---|
| `title` | shown in the HTML `<title>` |
| `docId` | `"deck-<sha1[:8]>"`. Keys the editor's localStorage **and gates `build.mjs --apply overrides.json`** — a mismatch throws. Never hand-edit. |
| `sourcePdf` / `sourcePptx` | one or the other, informational |

### `deck`

| Field | Type | Default | Notes |
|---|---|---|---|
| `designWidth` / `designHeight` | number | 1280 / 720 | slide size in **PDF points**; 1 pt = 12700 EMU on PPTX export |
| `pixelScale` | number | 2.0 | render scale of `work/slides/*.png` |
| `background` | `#rrggbb` | `#000000` | letterbox / flatten colour |
| `transition` | object | `{"type":"crossfade","duration":0.9,"ease":"power2.inOut"}` | |
| `navigation` | object | `{"keyboard":true,"click":true}` | |
| `buildOptions` | object | `{"bgQuality":78,"bgScale":1.0}` | optional; read by `crop_and_patch.py:72-76`, overridden by CLI flags |

---

## Slide

| Field | Type | Notes |
|---|---|---|
| `id` | `"sNN"` | |
| `index` | int, 0-based | drives the `work/slides/slide_{index+1:02d}.png` naming — keep it consistent with the array order |
| `background.src` | path under `work/` | usually `slides_webp/slide_NN.webp`; missing file = validator **warning** |
| `background.idle` | idle spec or `null` | slide-level motion, typically `kenBurns` |
| `elements` | array | |
| `model3dTiming` | raw OOXML string | only on PPTX imports containing 3D; captured at import and replayed on export. Do not edit. |

---

## Element

| Field | Type | Notes |
|---|---|---|
| `id` | string | **unique deck-wide**; importers use `sNN_eMM`. Duplicate = validator error |
| `name` | string | friendly label, preserved in HTML and PPTX |
| `type` | `text` \| `image` \| `shape` \| `model3d` | anything else = error |
| `role` | `title` \| `body` \| `figure` | drives `auto_choreo` heuristics |
| `text` | string | importers truncate to 300 chars. For `type: "text"` without a blend mode this becomes an **editable PPTX text box** |
| `bbox` | `[x0,y0,x1,y1]` | required; must be length 4, all in `[0,1]`, `x1>x0`, `y1>y0` |
| `cropBbox` | same or `null` | written back by `crop_and_patch.py` (bbox + 6 px pad) |
| `crop` | `"crops/<id>.webp"` | missing file = warning |
| `polygon` | `[[x,y],...]` or `null` | base alpha-mask shape, page coords |
| `regions` | `[{"op":"add"\|"sub","pts":[[x,y],...]}]` or `null` | boolean mask edits |
| `z` | int | stacking order |
| `cleanup` | `none` \| `auto` \| `fill` \| `blur` | footprint patch mode. `fill` **requires** `fillColor` |
| `fillColor` | `#rrggbb` | |
| `patch` | `"patches/<id>_patch.webp"` or `null` | written for `cleanup: "blur"`; a missing patch file is an **error**, not a warning |
| `blurRadius` | number | for `cleanup: "blur"` |
| `hidden` | bool | censor: cover the element with its patch |
| `blendMode` | see effects reference, or `null` | flattened to an image on PPTX export |
| `opacity` | 0-1 | |
| `parallax` | 0-1 | mouse-depth |
| `entrance` | object | one spec |
| `idle` | **array** of specs | several loops can coexist |
| `rig` | object or `null` | mesh / 2D-bone deformation |
| `lines` | always `null` | reserved for per-line text crops; never populated or read — ignore it |
| `modelSrc` | `"models/<name>.glb"` | `model3d` only; missing = warning (preview-only) |
| `model3d` | object | `model3d` only |

---

## What the validator actually enforces

`validate_manifest.py`, exit 1 on any **error**:

**Errors**
- a missing top-level key (`version`, `meta`, `deck`, `slides`)
- duplicate element `id`
- `type` outside `{text, image, shape, model3d}`
- `bbox` not length 4, any value outside `[0,1]`, or degenerate
- `cleanup` outside `{none, fill, blur, auto}`
- `entrance.type` outside the entrance enum
- any `idle[].type` outside the idle enum
- `patch` set but the file is missing on disk
- `cleanup == "fill"` with no `fillColor`

**Warnings** (informational, exit still 0)
- `background.src` missing on disk
- `crop` missing on disk
- `model3d` element without `modelSrc`
- `modelSrc` set but the `.glb` is missing

Parameters *inside* an entrance or idle spec are **not** validated. A typo like
`"amout": 0.5` is silently ignored and the default is used.

---

## Which edits need pixels regenerated

| Changed | Then run |
|---|---|
| `entrance`, `idle`, `parallax`, `blendMode`, `opacity`, `rig`, `name`, `z`, `hidden` | `node skull_studio/build.mjs` |
| `bbox`, `cropBbox`, `polygon`, `regions`, `cleanup`, `fillColor`, `blurRadius` | `python -m skull_studio.crop_and_patch` **then** build |

The second group is baked into `work/crops/*.webp` and `work/patches/*` on disk.
Editing the JSON alone changes nothing visible.

---

## Related files

| File | Written by | Read by |
|---|---|---|
| `work/clips/index.json` | `render_clips.py` | `export_pptx.py --clips`, `build_baked.mjs` — maps element id to `{clip, poster, bbox, format}` |
| `work/page_sizes.json` | the importers | sizing; `[[w,h], ...]` in points per page |
| `overrides.json` | the single-file editor's "Export overrides" | `build.mjs --apply` — `{"docId": ..., "elements": {id: patch}, "slides": {id: patch}}`, whole-value replacement of `entrance, idle, parallax, rig, cleanup, blendMode, opacity, hidden, blurRadius, fillColor, regions, polygon, bbox, name, z, model3d, modelSrc` |

---

## Minimal hand-authored deck

From `skull_studio/make_sample_3d.py` — the smallest complete manifest that builds:

```json
{
  "version": "1.0",
  "meta": { "title": "Demo", "sourcePdf": "(generated)", "docId": "deck-demo0001" },
  "deck": {
    "designWidth": 1280, "designHeight": 720, "pixelScale": 2.0,
    "background": "#0b0b10",
    "transition": { "type": "crossfade", "duration": 0.8, "ease": "power2.inOut" },
    "navigation": { "keyboard": true, "click": true }
  },
  "slides": [{
    "id": "s01", "index": 0,
    "background": { "src": "slides_webp/slide_01.webp", "idle": null },
    "elements": [{
      "id": "s01_e01", "type": "image", "role": "figure", "name": "Logo", "text": "",
      "bbox": [0.06, 0.30, 0.32, 0.82], "cropBbox": null, "crop": "crops/s01_e01.webp",
      "z": 2, "cleanup": "none", "fillColor": null, "patch": null,
      "entrance": { "type": "scaleIn", "delay": 0.2, "duration": 0.9, "ease": "back.out(1.4)" },
      "idle": [], "parallax": 0.05, "lines": null, "rig": null,
      "blendMode": null, "opacity": 1, "hidden": false
    }]
  }]
}
```

The referenced `work/slides_webp/slide_01.webp` and `work/crops/s01_e01.webp` must
exist or the page renders blank — the validator only warns about them.
