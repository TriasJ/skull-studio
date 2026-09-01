---
name: skull-studio-pipeline
description: Drive Skull Studio headlessly to turn a PDF or PPTX deck into animated HTML, an editable PowerPoint, a baked video slideshow, or mp4/GIF clips. Use when the user wants to animate a slide deck, import a PDF/PPTX into Skull Studio, build or preview a presentation, export to PPTX with looping video and real 3D models, bake animations to mp4/GIF, export a single element as PNG/GIF/MP4, run the import pipeline or any `python -m skull_studio.*` stage, or control a running studio server through its HTTP task API.
---

<objective>
Run the whole Skull Studio pipeline from the command line or the local job API:
import -> choreograph -> crop -> build -> export, plus the review loop that lets a
vision-capable agent check and fix element detection. No GUI required at any step.
</objective>

<critical_rules>
1. **The repo root is the project directory, always.** Every module computes
   `ROOT = Path(__file__).resolve().parent.parent` and reads/writes `work/` and
   `dist/` **there**, whatever your cwd. There is no flag to point it elsewhere. Run
   commands from the repo root and pass deck paths relative to it.

2. **Importing REPLACES `work/manifest.json`** — the user's entire current project.
   Before any import, back it up:
   `cp work/manifest.json work/manifest.backup.json`. Say so if the user has
   unsaved work.

3. **One project at a time, one studio at a time.** A second `skull-studio` binds
   8766+ and serves the same `work/` from a different port — confusing, not parallel.

4. **`--models 3d` is required for editor-made 3D primitives to survive PPTX export.**
   Models imported *from* PowerPoint carry `model3d.sourceXml` and round-trip as
   real 3D either way; synthetic ones bake to a flat picture unless you pass it.

5. **A `file://`-openable 3D deck needs BOTH** `--threejs inline` (the default) **and**
   `--embed-models`. With sidecar models or a vendor folder the browser blocks
   file-to-file requests — serve over http instead.

6. **Always validate before building.** `python -m skull_studio.validate_manifest`
   exits non-zero and names the bad element. The `build` task runs it first for a
   reason.
</critical_rules>

<mental_model>
Everything is one JSON document, `work/manifest.json`. The importer writes it, the
editor mutates it, and **every** exporter reads it. So the pipeline is:

```
deck.pdf/.pptx
    |  extract / extract_pptx / extract_ocr        -> work/slides/*.png, draft manifest
    |  auto_choreo                                  -> entrances + idles assigned
    |  crop_and_patch                               -> work/crops/*.webp, patches
    v
work/manifest.json  ---- validate_manifest ---->  build.mjs        -> dist/presentation.html
                                                  build_baked.mjs  -> dist/baked.html
                                                  export_pptx.py   -> dist/*.pptx
                                                  render_clips.py  -> work/clips/*.mp4
```

Creative changes = edit that JSON (see the **skull-studio-manifest** skill), then
re-run the affected downstream stage.
</mental_model>

<control_surfaces>
Four ways in, in order of preference:

| Surface | Use when | How |
|---|---|---|
| **CLI modules** | default for anything scripted or batch; no server needed | `python -m skull_studio.<stage>`, `node skull_studio/*.mjs` — see `references/cli-reference.md` |
| **Manifest edits** | any creative change (animations, boxes, 3D, particles) | the **skull-studio-manifest** skill |
| **HTTP task API** | a studio is already running, or you want to hand the project to a human in the editor afterwards | `scripts/ss_task.py` — see `references/http-api.md` |
| **Chrome MCP on `/editor`** | **verification only** — screenshot the rendered deck | never the primary control path; it is slow and brittle |
</control_surfaces>

<workflow>

## Import a deck

```bash
# DEFAULT - MinerU full layout analysis: figures, tables, reading order
python -m skull_studio.pipeline deck.pdf --ocr mineru

# fallback when MinerU is not installed - bundled RapidOCR, text only, no download
python -m skull_studio.pipeline deck.pdf --ocr rapid

# backgrounds only, no OCR
python -m skull_studio.pipeline deck.pdf --ocr none

# PPTX (needs LibreOffice); pipeline routes it through extract_pptx automatically
python -m skull_studio.pipeline deck.pptx --ocr mineru
```

**Prefer MinerU and trust its output.** It is the default for a reason: it returns
layout, not just text, so figures, tables and reading order come out segmented
correctly. Treat that segmentation as authoritative — review it, fix genuine
misses, but do not hand-redraw boxes it got right. Its models download once
(~GB, several minutes); after that it costs nothing extra. Use `--ocr rapid` when
MinerU is not installed or the download is not worth it, accepting text-only
recovery with no reading order.

Useful flags: `--no-choreo` (skip auto animation assignment), `--no-build` (stop
before HTML), `--bg-quality N` (background WebP quality, default 78),
`--out PATH` (default `dist/presentation.html`).

The pipeline ends with `dist/presentation.html` (viewer) and `dist/editor.html`.

## Review what the importer detected (the vision loop)

`debug_overlay.py` exists specifically so an agent can check the segmentation:

```bash
python -m skull_studio.debug_overlay      # -> work/debug/overlay_NN.png
```

Read those PNGs. Each element's bbox is drawn and numbered. Fix **genuine misses**
only — MinerU's layout output is the segmentation of record, so do not hand-redraw
boxes it got right. For a real miss, fix `bbox` in the manifest and regenerate the
pixels:

```bash
python -m skull_studio.crop_and_patch
node skull_studio/build.mjs
```

## Build outputs

```bash
node skull_studio/build.mjs                                  # dist/presentation.html
node skull_studio/build.mjs --editor                         # dist/editor.html
node skull_studio/build.mjs --embed-editor --out dist/both.html   # viewer + press E
node skull_studio/build.mjs --embed-models                   # 3D deck that opens from disk
node skull_studio/build.mjs --threejs vendor                 # smaller HTML + vendor/ folder
node skull_studio/build.mjs --apply overrides.json           # bake single-file-editor edits
```

## Export to PowerPoint

```bash
# plain, editable text boxes, lossless images
python -m skull_studio.export_pptx dist/deck.pptx

# the full-fat version: small images, entrance animations,
# idle/rig/particle motion as looping mp4, real 3D models
python -m skull_studio.render_clips --format mp4 --max-dim 600
python -m skull_studio.export_pptx dist/deck.pptx --format jpg --clips mp4 --animate --models 3d
```

`render_clips` must run **before** `export_pptx --clips`; the exporter reads
`work/clips/index.json`. Prefer mp4 over gif — far smaller for photographic content.

## Export a baked (no-WebGL) slideshow

```bash
python -m skull_studio.render_clips --format mp4
node skull_studio/build_baked.mjs --out dist/baked.html --format mp4 --assets base64
# --assets folder writes a small HTML + a sibling assets dir instead
```

## Export a single element

```bash
python -m skull_studio.export_element s01_e02 png          # -> work/export/s01_e02.png
python -m skull_studio.render_clips --element-id s01_e02 --format mp4
```

## Drive a running studio instead

```bash
skull-studio --no-browser &                       # or: python launch.py --no-browser
python .claude/skills/skull-studio-pipeline/scripts/ss_task.py --state
python .claude/skills/skull-studio-pipeline/scripts/ss_task.py --task import-rapid --arg deck.pdf
python .claude/skills/skull-studio-pipeline/scripts/ss_task.py --task preview
```

The script finds the live port (8765-8785), starts the job, then polls
`/api/status` and streams the log until it finishes. Jobs are serialized — a second
task while one runs returns 409.

</workflow>

<verification>
After any pipeline run, confirm rather than assume:

1. `python -m skull_studio.validate_manifest` — exits 0, prints slide/element counts.
2. The expected artifact exists and is a plausible size:
   `dist/presentation.html` is typically 1-3 MB (assets are inlined as base64); a
   file under ~100 KB means assets are missing.
3. For a visual check, open the built file with Chrome MCP and screenshot it. For 3D
   or sidecar-asset builds, serve it over http first
   (`python -m http.server -d dist 8080`) — `file://` blocks those requests.
4. For PPTX, confirm it opens:
   `python -c "from pptx import Presentation; print(len(Presentation('dist/deck.pptx').slides))"`

If PowerPoint asks to "repair" a file, re-export with the current version: PowerPoint
allows exactly one `<p:timing>` block per slide and the exporter merges all entrance
and media-play timing into one. If it persists, fall back to `--clips gif`.
</verification>

<references>
- `references/cli-reference.md` — every module, every flag, with defaults.
- `references/http-api.md` — endpoints, the full task table, option-object shapes,
  and the manifest optimistic-lock protocol.
- Repo docs: `docs/USAGE.md`, `docs/ARCHITECTURE.md`, `docs/TROUBLESHOOTING.md`.
</references>
