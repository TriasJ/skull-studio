# Skull Studio

Turn **PDF / PowerPoint slide decks into interactive, animated HTML** — with a
browser-based editor, mesh & 2D-bone rigging (Rive-style, but free for commercial
use), and export back to PowerPoint or self-contained video/GIF slideshows.

> ⚠️ **Vibe-coded, provided as-is.** This project was built rapidly and
> iteratively with heavy AI assistance ("vibe coding"). It works and is fairly
> well tested, but it has **not** had a formal security or production audit.
> Treat it as a capable hobby/creative tool: read the code, run it on a trusted
> local machine, and review before relying on it for anything important. No
> warranty of any kind. See [`SECURITY.md`](SECURITY.md).

---

## What it does

1. **Import** a PDF or PPTX. Slides are rendered, text/images are detected
   (OCR via MinerU + PPTX shape geometry), and large pictures become backgrounds.
2. **Edit** in the browser (PixiJS + GSAP): per-element entrances, idle loops,
   mouse parallax, blend modes, **mesh/2D-bone rigs** (puppet-warp with
   keyframes), draw box/polygon elements, OCR regions, rename, duplicate, reorder.
3. **Export**:
   - self-contained **animated HTML** (live PixiJS), with an optional bundled editor,
   - **editable PowerPoint** (`.pptx`) — OCR text as real text boxes, entrances as
     Fade animations, and idle/rig motion baked into looping **mp4/GIF** clips,
   - a no-WebGL **"baked" HTML** slideshow (video/GIF assets, max compatibility).

## Quick start

```bash
git clone https://github.com/TriasJ/skull-studio.git
cd skull-studio
python install.py            # checks deps, installs the package, vendors PixiJS/GSAP
skull-studio                 # launches the editor in your browser
```

Then, on the Studio home page, **import `sample/demo.pdf`** (a small original demo
deck included in the repo) to try import → edit → export end-to-end.

> No internet after install? The runtime libs are vendored during `install.py`.
> Prefer `uv`? `uv run install.py` and `uv run skull-studio` also work.

## Dependencies

| Requirement | Why | Install |
|---|---|---|
| **Python ≥ 3.10** | pipeline + server | python.org |
| **Node.js ≥ 18** | builds the HTML output | nodejs.org · `winget install OpenJS.NodeJS` · `brew install node` · `apt install nodejs` |
| **ffmpeg** *(optional)* | bake idle/rig motion to mp4/GIF | `winget install Gyan.FFmpeg` · `brew install ffmpeg` · `apt install ffmpeg` |
| **LibreOffice** *(optional)* | render PPTX slides on import | `winget install TheDocumentFoundation.LibreOffice` · `brew install --cask libreoffice` · `apt install libreoffice` |
| **MinerU** *(optional, heavy)* | OCR text baked into slide images | `uv tool install "mineru[core]"` |

Python packages (installed automatically): PyMuPDF, Pillow, NumPy, OpenCV,
jsonschema, python-pptx, RapidOCR. The browser runtime bundles **PixiJS** and
**GSAP** (MIT; fetched on install). Without ffmpeg you can't bake video; without
LibreOffice you can't import PPTX (PDF still works); without MinerU, import with
`--skip-mineru` (backgrounds only, no recovered text).

## How it's organized

```
skull_studio/      Python pipeline + Node build scripts + the local server (studio.py)
runtime/src/       editor/player runtime (plain JS modules, 00–66)
runtime/template.html, runtime/vendor/   HTML shell + vendored PixiJS/GSAP
work/              intermediate artifacts (manifest.json, crops, clips) — gitignored
dist/              built deliverables — gitignored
sample/demo.pdf    a small original deck to try
docs/              USAGE and ARCHITECTURE guides
```

Run the whole pipeline headless on any deck:

```bash
python -m skull_studio.pipeline sample/demo.pdf        # PDF or PPTX; --skip-mineru, --no-choreo, ...
```

See **[docs/USAGE.md](docs/USAGE.md)** for the editor guide and every export
option, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the manifest
schema, runtime module map, and the rig/clip internals.

## License

MIT — see [`LICENSE`](LICENSE). Third-party components and the AGPL-licensed,
optional MinerU backend are noted in [`THIRD_PARTY.md`](THIRD_PARTY.md).
