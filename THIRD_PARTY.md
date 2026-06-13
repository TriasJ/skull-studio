# Third-party components

## Bundled into the browser runtime (fetched on install)

| Component | License | Notes |
|---|---|---|
| [PixiJS](https://pixijs.com/) v8.x | MIT | WebGL renderer (sprites, meshes) for the live HTML output |
| [GSAP](https://gsap.com/) v3.x | "No Charge" / standard (free for commercial use since the Webflow acquisition) | Animation timelines/easing |

These are downloaded by `skull_studio/fetch_libs.mjs` into `runtime/vendor/` and
inlined (base64/concatenated) into the exported single-file HTML. Their licenses
permit redistribution; if you ship exported HTML, you are redistributing them.

## Python dependencies (installed via pip)

PyMuPDF (AGPL/commercial — note below), Pillow (HPND/MIT-CMU), NumPy (BSD),
OpenCV-Python (Apache-2.0 / MIT bindings), jsonschema (MIT), python-pptx (MIT),
RapidOCR (Apache-2.0).

> **PyMuPDF is AGPL-3.0** (with a commercial option). It is a Python dependency
> used at runtime for rendering; if you redistribute a product built on it,
> review the AGPL terms or obtain a commercial license from Artifex.

## Optional external tools (not bundled)

| Tool | License | Role |
|---|---|---|
| [MinerU](https://github.com/opendatalab/MinerU) | **AGPL-3.0** | OCR/layout for recovering text baked into slide images. Installed and run as a **separate tool/process** (not imported or bundled). Optional — use `--skip-mineru` to omit. |
| [LibreOffice](https://www.libreoffice.org/) | MPL-2.0 | Renders PPTX → PDF on import. Invoked as an external process. |
| [ffmpeg](https://ffmpeg.org/) | LGPL/GPL | Encodes baked mp4/GIF clips. Invoked as an external process. |

Because MinerU, LibreOffice, and ffmpeg are invoked as separate executables
(not statically linked or imported), this project itself remains MIT; their
licenses govern their own binaries, which you install separately.
