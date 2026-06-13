# Troubleshooting

A grab-bag of the issues you're most likely to hit, with fixes. If something here
doesn't help, open a GitHub issue with the exact command, the error text, and your
OS / Python / Node versions.

## Install & launch

**`skull-studio: command not found` (or not recognized)**
- The console script is created by `pip install -e .`. Re-open your terminal so it
  picks up the updated PATH, or run it without the shim:
  `python -m skull_studio.studio` (or `uv run skull-studio`).
- On some setups pip's scripts dir isn't on PATH; `python -m skull_studio.studio`
  always works.

**`install.py` fails on `pip install -e .`**
- Make sure you're in the repo root (where `pyproject.toml` lives).
- Behind a proxy or offline? `opencv-python` / `rapidocr-onnxruntime` are large
  wheels — ensure pip can reach PyPI.
- Try `uv` instead: `uv run install.py`.

**`fetch_libs.mjs` fails / editor shows no slides, console says PIXI undefined**
- The vendored libs didn't download. Re-run `node skull_studio/fetch_libs.mjs`
  (needs internet once). They land in `runtime/vendor/`.

**The browser didn't open**
- The server still started — open the URL it printed (e.g.
  `http://localhost:8765`). Use `--no-browser` to suppress auto-open.

## Import

**PPTX import does nothing / "LibreOffice not found"**
- Install LibreOffice and ensure `soffice` (or `libreoffice`) is on PATH, or that
  it's in a standard location (`/Applications/LibreOffice.app/…`, `C:\Program
  Files\LibreOffice\…`). PDF import does **not** need LibreOffice.

**Imported deck shows only backgrounds, no editable text/elements**
- You ran `--skip-mineru`, or MinerU isn't installed. Install it
  (`uv tool install "mineru[core]"`) and re-import, **or** add elements by hand
  with the Box/Polygon tools. PPTX decks with *real* text boxes still get that text
  without MinerU; decks whose text is *baked into images* need OCR.

**First import is very slow / downloads gigabytes**
- MinerU downloads its OCR models on first use (one-time). Subsequent imports are
  fast. If HuggingFace stalls, set `MINERU_MODEL_SOURCE=modelscope`.

**OCR put boxes in the wrong place / merged things**
- Select the element, drag its detection box / gold corner to fix it, change its
  type, or delete it; draw missing ones with **▭ Box** / **⬡ Poly**; then
  **Re-crop & reload**.

## Editor

**Edits seem to revert / "STALE TAB — reload"**
- You have two editor tabs open on the same project. Saves use an optimistic lock;
  keep **one** tab per project and reload the stale one.

**Patch / mask / detection-box change didn't take effect**
- Those regenerate pixels on disk — click **Re-crop & reload**. Animation, blend,
  and opacity changes are instant.

**"Different server" / it opened on a different port than expected**
- Only run one `skull-studio` at a time. If a previous one is still running, the
  new one walks to the next free port and prints the URL — use that, or stop the
  old process.

**A rigged element drifts away from its pins while editing**
- Fixed in current versions (parallax is frozen during rig editing). Reload the
  editor if you're on an old build.

## Export

**PowerPoint asks to "repair" the exported `.pptx`**
- Re-export with the current version — the exporter writes exactly one animation
  timing block per slide (multiple blocks were the cause). If it still happens,
  use the **GIF** animated-assets option (GIFs embed as plain pictures with no
  timing) or turn animated assets off.

**Exported `.pptx` is enormous**
- Switch image format to **JPEG**, and prefer **mp4** over GIF for animated assets.
  A photographic deck is ~20 MB as mp4 vs >100 MB as GIF.

**Video doesn't autoplay in PowerPoint**
- It should play on slide entry; if your PowerPoint blocks autoplay, click the
  video, or use GIF clips (which always loop in slideshow). ffmpeg must be
  installed for any clip baking.

**Baked HTML videos don't move**
- Browsers only autoplay **muted** video (the export sets `muted loop autoplay`).
  If a browser still blocks it, click the slide. Use the **folder** asset mode if
  the base64 single-file is too large to load.

## Performance

- Baking clips (especially mesh/bone rigs) runs the animation math per frame in
  Python — a rig can take a minute. Lower `--fps` or `--max-dim` for faster, smaller
  clips.
- Large decks: prefer JPEG backgrounds (deck options → image quality) to keep HTML
  and PPTX sizes down.
