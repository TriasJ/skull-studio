# Install & startup troubleshooting

Every symptom below is traced to the code that causes it, so you can confirm the
diagnosis instead of guessing.

## `install.py` hangs and never finishes

It is waiting on `input()` at `install.py:138` — the "Install the heavier MinerU
backend now? [y/N]" prompt. Kill it and re-run with **`--no-ocr`**
(`install.py:122`). Piping EOF (`< /dev/null`) also works, but `--no-ocr` is explicit.

## `skull-studio: command not found`

The console-script shim (`pyproject.toml` `[project.scripts]`) is installed into your
Python's `Scripts/` (Windows) or `bin/` (POSIX) dir, which may not be on PATH yet.

1. Open a **new** terminal — PATH changes do not apply to already-open shells.
2. Otherwise use an equivalent that needs no PATH entry:
   - `python -m skull_studio.studio`
   - `python launch.py` (works even when the package was never pip-installed)
   - `uv run skull-studio`

## The built HTML is blank / "PIXI is not defined"

`runtime/vendor/` is empty or partial. Re-fetch:

```bash
node skull_studio/fetch_libs.mjs
```

This is the only step that needs internet. It downloads four pinned files
(`pixi.min.js`, `gsap.min.js`, `three.min.js`, `three.GLTFLoader.js`) and validates
each by byte size plus a probe string, so a captive-portal HTML error page is
rejected rather than silently saved. Behind a proxy, set `HTTPS_PROXY` before
running it.

`python launch.py` runs this automatically when `runtime/vendor/pixi.min.js` is
missing.

## PPTX import does nothing / produces no slides

LibreOffice is missing. `extract_pptx.py` shells out to `soffice` to convert
pptx → pdf → PNG. It looks for `soffice` and `libreoffice` on PATH and then probes
the default install locations (`extract_pptx.py:42-52`), including
`C:\Program Files\LibreOffice\program\soffice.exe`, so on Windows you do **not**
need to add it to PATH — but you do need it installed.

PDF import has no such dependency.

## Import produces backgrounds but no text elements

Expected when OCR was skipped. Choose an engine:

| Flag | Engine | Cost |
|---|---|---|
| `--ocr mineru` (default, **recommended**) | MinerU full layout: figures, tables, reading order | ~GB model download on first use |
| `--ocr rapid` (fallback) | bundled RapidOCR, text only, no reading order | none — already installed |
| `--ocr none` / `--skip-mineru` | no OCR | none |

PPTX decks with real text boxes still get their text via python-pptx regardless of
the OCR engine. Only decks whose text is *baked into images* need MinerU.

## MinerU download stalls

HuggingFace is unreachable or rate-limiting. Switch the model source:

```bash
MINERU_MODEL_SOURCE=modelscope uv tool run --from "mineru[core]" mineru -p deck.pdf -o work/mineru
```

(On PowerShell: `$env:MINERU_MODEL_SOURCE = "modelscope"` first.)

## "Different server" warning, or the editor talks to the wrong project

More than one studio is running. `studio.py:503-511` binds 8765 and walks forward up
to 20 ports when it is busy, printing the port it actually got — so a second instance
silently lands on 8766 and serves a *different* `work/`. Run only one at a time; check
with the doctor's "Studio server" row, and read the URL the server prints rather than
assuming 8765.

## ffmpeg errors during clip baking

`render_clips.py:28` resolves `shutil.which("ffmpeg") or "ffmpeg"` — unlike
LibreOffice there is no fallback probe, so ffmpeg **must** be on PATH. On Windows,
`winget install Gyan.FFmpeg` then open a new shell.

## Everything installed but a build still fails

Run the validator — a malformed manifest stops the build before Node even starts
(the `build` task runs `validate_manifest.py` first, `studio.py:119-121`):

```bash
python -m skull_studio.validate_manifest
```

Errors exit non-zero and name the offending element id. See the
**skull-studio-manifest** skill for what each rule means.

## Reinstalling cleanly

```bash
pip uninstall skull-studio
python install.py --no-ocr
```

`work/` and `dist/` are untouched by (re)installs — they are gitignored working
directories, not package data. Nothing in the installer deletes a user's project.
