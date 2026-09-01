---
name: skull-studio-manifest
description: Read, edit and author Skull Studio's work/manifest.json - the single JSON document that defines every slide, element, bounding box, entrance, idle loop, particle emitter, mesh rig and 3D model in a deck. Use when the user wants to change how a deck animates (make the logo breathe, add snow or sparkles, slide a title in, add a glow or ripple), fix a wrongly detected element box, add or remove elements, drop in a 3D cube or sphere, censor or patch something out, build a deck from scratch without importing, or when validate_manifest reports an error.
---

<objective>
Make creative changes to a Skull Studio deck by editing JSON rather than clicking in
the GUI, and know exactly which downstream stage has to re-run for the change to
appear in the output.
</objective>

<critical_rules>
1. **`work/manifest.json` is the whole project.** Importer writes it, editor mutates
   it, every exporter reads it. Back it up before large edits:
   `cp work/manifest.json work/manifest.backup.json`.

2. **Validate after every edit, before every build:**
   `python -m skull_studio.validate_manifest` — exits non-zero and names the bad
   element id. The `build` task runs it first for exactly this reason.

3. **Some edits are instant; some need pixels regenerated.**

   | Changed field | Then run |
   |---|---|
   | `entrance`, `idle`, `parallax`, `blendMode`, `opacity`, `rig`, `name`, `z`, `hidden` | `node skull_studio/build.mjs` |
   | `bbox`, `cropBbox`, `polygon`, `regions`, `cleanup`, `fillColor`, `blurRadius` | `python -m skull_studio.crop_and_patch` **first**, then build |

   Skipping `crop_and_patch` after a box change is the single most common reason "my
   edit did nothing" — the crop on disk is still the old rectangle.

4. **Only the enums in `validate_manifest.py:13-21` exist.** Anything else fails the
   gate. Unknown *ease* strings are worse: they do not fail, they silently fall back
   to `power2.out` (`runtime/src/00-core.js:6-15`).

5. **All coordinates are normalized 0-1, top-left origin, y down**, as
   `[x0, y0, x1, y1]`. The validator rejects anything outside `[0,1]` or degenerate
   (`x1 <= x0`).

6. **Element ids must be unique deck-wide**, not just per slide.

7. **A live editor tab will overwrite your file.** If a studio is running with the
   editor open, either close it or go through `POST /api/manifest` with the
   `x-manifest-rev` lock (see the **skull-studio-pipeline** skill).
</critical_rules>

<shape>
```jsonc
{
  "version": "1.0",
  "meta":  { "title": "...", "docId": "deck-<hash>", "sourcePdf": "..." },
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
      "id": "s01_e02", "name": "Title", "type": "text", "role": "title",
      "text": "...", "bbox": [0.1, 0.1, 0.9, 0.25], "crop": "crops/s01_e02.webp",
      "z": 10, "cleanup": "auto", "opacity": 1, "parallax": 0.12,
      "entrance": { "type": "fadeUp", "delay": 0.3, "duration": 1.1, "ease": "power3.out" },
      "idle": [{ "type": "breath", "amount": 0.008, "period": 6 }],
      "rig": null
    }]
  }]
}
```

Enums, verbatim from the validator:

- **type** — `text` `image` `shape` `model3d`
- **entrance.type** — `none` `fadeIn` `fadeUp` `fadeDown` `fadeLeft` `fadeRight`
  `scaleIn` `maskReveal` `blurIn` `drawOn` `staggerText` `rotateIn` `scaleIn3D`
- **idle[].type** — `none` `float` `pulse` `sway` `shimmer` `breath` `glow` `wave`
  `ripple` `swirl` `meshWave` `particles` `kenBurns` `autoRotate`
- **cleanup** — `none` `auto` `fill` `blur` (`fill` **requires** `fillColor`)

`idle` is an **array** — elements can carry several loops at once. `entrance` is a
single object.

Full field-by-field tables: `references/manifest-schema.md`.
Per-effect parameters, eases, blend modes: `references/effects-reference.md`.
Rig and 3D model objects: `references/rig-and-3d.md`.
Tuning the role-based defaults behind `apply-preset --preset auto`:
`references/role-defaults.md`.

**Which effect to choose, and why:** `docs/CHOREOGRAPHY.md` in the repo. The
defaults target stills from scientific and artistic NotebookLM decks, and the rule
is *information or atmosphere* — never mesh-deform a chart or a labelled diagram
(`wave`, `ripple`, `swirl`, `meshWave` and rigs move pixels relative to each other
and change what the image asserts); save those, particles and parallax for
illustration and backdrop. Scientific slides spend their motion on entrances,
artistic ones on idles.
</shape>

<workflow>

## Use the cookbook script for common edits

```bash
S=.claude/skills/skull-studio-manifest/scripts

python $S/manifest_edit.py list                       # ids, types, names, boxes
python $S/manifest_edit.py list --slide s01

python $S/manifest_edit.py set-entrance s01_e02 --type fadeUp --delay 0.3 --duration 1.1
python $S/manifest_edit.py set-idle s01_e04 --type breath --amount 0.015 --period 4
python $S/manifest_edit.py set-idle s01_e04 --type glow --amount 0.6 --period 2 --append
python $S/manifest_edit.py add-particles s02_e01 --preset snow --shape dot --color '#ffffff'
python $S/manifest_edit.py apply-preset s01_e03 --preset underwater
python $S/manifest_edit.py bg-idle --slide all --type kenBurns --scale 1.04 --duration 14
python $S/manifest_edit.py add-3d --slide s01 --shape cube --color '#8899aa' --bbox 0.6,0.3,0.9,0.8
python $S/manifest_edit.py add-element --slide s01 --bbox 0.1,0.1,0.4,0.3 --type image --name Logo
python $S/manifest_edit.py hide s01_e07                # censor: cover with its patch
```

Selectors accept an element id, `all`, a slide prefix (`s01:*`), or a filter
(`--role title`, `--type image`). Every write re-runs the validator; `--dry-run`
prints the diff without touching the file.

## Or edit the JSON directly

Read `work/manifest.json`, mutate, write back with `indent=2` and
`ensure_ascii=False` (matching what the studio writes), then validate. Do not
reformat the whole file — keep diffs small so a running editor's optimistic lock
stays meaningful.

## Then rebuild

```bash
python -m skull_studio.crop_and_patch     # ONLY if you changed boxes/masks/cleanup
python -m skull_studio.validate_manifest
node skull_studio/build.mjs
```

## Fixing a mis-detected element

```bash
python -m skull_studio.debug_overlay      # -> work/debug/overlay_NN.png
```

Read the overlay image. Each box is drawn and numbered against the real slide. Adjust
`bbox` for the wrong ones, then `crop_and_patch` + build. This vision-in-the-loop
review is what `debug_overlay.py` was written for.

## Authoring a deck from scratch

Copy the pattern in `skull_studio/make_showcase.py` (4 slides exercising every
feature) or `skull_studio/make_sample_3d.py` (a minimal 1-slide 3D deck). You must
supply real background images at `work/slides_webp/slide_NN.webp` and crops at
`work/crops/<id>.webp` — the validator warns about missing assets and the build will
render blanks without them.

</workflow>

<gotchas>
- **`type: "fill"` cleanup without `fillColor` fails the validator.** Sample the
  colour from the slide first, or use `cleanup: "auto"`.
- **Particles are HTML-only in the live runtime but DO bake** — `render_clips.py`
  re-simulates them deterministically for mp4/GIF, so they survive into PowerPoint
  and baked HTML.
- **`element.lines` is present in every generated manifest but never populated or
  read.** Ignore it. `staggerText` consequently degrades to a downward `maskReveal`.
- **Mesh idles (`wave`, `ripple`, `swirl`, `meshWave`) force a mesh view** for that
  element; they cost more per frame than the transform-only idles.
- **`meta.docId` gates `build.mjs --apply overrides.json`** — a mismatch throws.
  Never hand-edit `docId`.
- **3D: `model3d.sourceXml` decides the PPTX fate.** Present (imported from
  PowerPoint) → round-trips as live 3D. Absent (editor/synthetic primitive) → baked
  to a flat picture unless you export with `--models 3d`.
</gotchas>

<verification>
```bash
python -m skull_studio.validate_manifest        # must print OK: N slides, M elements
node skull_studio/build.mjs
```

Then look at the result rather than trusting the exit code: open
`dist/presentation.html` with Chrome MCP and screenshot the slide you changed. Idle
loops and particles need a second or two of settling before the screenshot is
meaningful.
</verification>
