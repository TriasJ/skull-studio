# Skull Studio HTTP API

A running studio (`skull-studio --no-browser`) serves a small JSON API on
`127.0.0.1`. No auth, localhost only. Source: `skull_studio/studio.py:361-490`.

**Port:** 8765 by default, but `studio.py:503-511` walks forward up to 20 ports if it
is busy and prints the one it got. Probe 8765-8785 rather than assuming — that is what
`scripts/ss_task.py` does.

---

## GET

| Endpoint | Returns |
|---|---|
| `/` | the Studio home page |
| `/editor` | the editor page |
| `/api/manifest` | `work/manifest.json` verbatim, plus an **`x-manifest-rev`** header (mtime in ns). 404 when nothing is imported. |
| `/api/status` | `{"running": <task name or null>, "ok": <bool or null>, "log": [<last 120 lines>]}` |
| `/api/state` | `{"pdfs": [...], "pptxs": [...], "manifest": bool, "slides": int, "elements": int, "dist": [...]}` — `pdfs`/`pptxs` are decks sitting at the repo root |
| `/api/browse?path=DIR&ext=pdf,pptx` | `{path,label,parent,sep,dirs,files}`; `path=::drives` lists Windows drive roots |
| `/runtime/*`, `/work/*`, `/dist/*` | static files, path-escape guarded |

## POST

| Endpoint | Body | Notes |
|---|---|---|
| `/api/manifest` | the full manifest JSON | send the `x-manifest-rev` you read or get **409**; write is atomic (tmp + replace) |
| `/api/ocr` | `{"page": 0, "bbox": [x0,y0,x1,y1]}` | RapidOCR on `work/slides/slide_NN.png` → `{"text": "..."}` |
| `/api/add3d` | `{"shape": "cube", "color": "#8899aa"}` | shape ∈ plane, cube, sphere, cylinder, cone, torus → `{"modelSrc": "models/prim_N.glb"}` |
| `/api/asset` | `{"path": "crops/x.png", "dataURL": "data:image/png;base64,..."}` | only `crops/`, `models/`, `particles/` prefixes are accepted |
| `/api/run` | `{"task": "...", "arg": ...}` | starts a background job; **409 while another job runs** |

### The optimistic lock

```
GET  /api/manifest            -> body + header x-manifest-rev: 1781579567255767400
(edit the JSON)
POST /api/manifest            with header x-manifest-rev: 1781579567255767400
```

A mismatch means someone else (an open editor tab, another agent) wrote the file
first. The server returns **409 `manifest changed on disk - reload this tab`**. The
fix is always: re-read, re-apply your edit to the fresh copy, re-post. Never retry
without the re-read — that is exactly the clobber the lock exists to prevent.

---

## Task registry

`studio.py:78-137`. Jobs are **serialized** — one at a time, log streamed via
`/api/status`.

### Import (`arg` = a deck path relative to the repo root; validated to exist)

| Task | What it runs |
|---|---|
| `import` | `pipeline.py --no-build` (MinerU OCR) |
| `import-nomineru` | `pipeline.py --no-build --skip-mineru` |
| `import-rapid` | `pipeline.py --no-build --ocr rapid` |
| `import-pptx` | extract_pptx render → mineru → draft → choreo → crops → overlays |
| `import-pptx-rapid` | same but RapidOCR on the LibreOffice-made PDF |
| `import-file` | `pipeline.py --no-build` on an **absolute or root-relative** path |
| `mineru` | re-run MinerU + redraft on an existing deck |

### Stages (no `arg`)

`choreo` · `crops` (crop_and_patch + debug_overlay) · `overlays`

### Build (no `arg` unless noted)

| Task | Output |
|---|---|
| `preview` | validate + `dist/presentation.html` (fastest path) |
| `build` | validate + `dist/presentation.html` + `dist/editor.html` |
| `build-embed` | `dist/presentation_with_editor.html` |
| `build-custom` | `arg`: `{"out": "...", "embedEditor": bool, "threejs": "inline\|vendor", "embedModels": bool}` |

### Export

| Task | `arg` |
|---|---|
| `export-pptx` | — (PNG, no clips) |
| `export-pptx-jpg` | — |
| `export-pptx-layers` | — (adds the patch layer) |
| `export-pptx-custom` | `{"out","format":"png\|jpg","quality","fontSize","fontScale","patches":bool,"animate":bool,"clips":"none\|mp4\|gif","fps"}` — runs `render_clips` first when `clips` is set |
| `export-baked` | `{"out","format":"mp4\|gif","fps","assets":"base64\|folder"}` — always runs `render_clips` first |
| `render-clips` | `{"format":"mp4\|gif","fps"}` |
| `export-element` | `{"id":"s01_e02","format":"png\|jpg"}` |
| `render-element-clip` | `{"id":"s01_e02","format":"mp4\|gif","fps"}` |

> **Gotcha:** `export-pptx-custom` has **no `models` option** (`studio.py:184-209`
> builds no `--models` flag). To get editor-made 3D primitives into PowerPoint as real
> 3D, use the CLI instead:
> `python -m skull_studio.export_pptx out.pptx --models 3d`.

### Demo content

| Task | Effect |
|---|---|
| `showcase` | regenerate the 4-slide feature showcase into `work/` and build it — **replaces the current project** |
| `showcase-pptx` | bake the showcase to `dist/showcase.pptx` with mp4 clips and real 3D |

---

## Raw examples

```bash
curl http://localhost:8765/api/state

curl -X POST http://localhost:8765/api/run \
  -H 'content-type: application/json' \
  -d '{"task":"import-rapid","arg":"deck.pdf"}'

curl http://localhost:8765/api/status

curl -X POST http://localhost:8765/api/run \
  -H 'content-type: application/json' \
  -d '{"task":"export-pptx-custom","arg":{"out":"dist/deck.pptx","format":"jpg","animate":true,"clips":"mp4","fps":18}}'
```

Or just use the wrapper, which handles port discovery, polling and the lock:

```bash
python scripts/ss_task.py --state
python scripts/ss_task.py --task import-rapid --arg deck.pdf
python scripts/ss_task.py --task export-pptx-custom --arg '{"out":"dist/deck.pptx","format":"jpg"}'
python scripts/ss_task.py --get-manifest edited.json
python scripts/ss_task.py --put-manifest edited.json
```
