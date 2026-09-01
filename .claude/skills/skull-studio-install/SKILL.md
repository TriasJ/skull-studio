---
name: skull-studio-install
description: Install, upgrade, verify or repair a Skull Studio installation (the local tool that turns PDF/PPTX decks into animated HTML, PowerPoint and video). Use when the user wants to install or set up Skull Studio, clone it from GitHub, run install.py, when `skull-studio` is "not found" or won't start, when PPTX import silently does nothing, when a build fails with missing PixiJS/GSAP/three vendor files, when ffmpeg/LibreOffice/MinerU/Node prerequisites need checking, or before any first-time use of the skull-studio-pipeline or skull-studio-manifest skills.
---

<objective>
Get Skull Studio installed and provably working, on Windows, macOS or Linux, without
ever blocking on an interactive prompt. Ends with a green `doctor.py` report and a
running studio, or a precise list of what is missing and the exact command to fix it.
</objective>

<critical_rules>
1. **`python install.py` blocks on `input()`.** It asks "Install the heavier MinerU
   backend now? [y/N]" (`install.py:138`). In any scripted / agent context pass
   **`--no-ocr`** or the install hangs forever. MinerU can always be added later.

2. **Python >= 3.10 and Node >= 18 are hard gates** — `install.py:36-44` exits if
   either is missing. ffmpeg, LibreOffice and MinerU are optional and only warn.

3. **The repo root is the working directory, permanently.** Every module resolves
   `ROOT = Path(__file__).resolve().parent.parent` and reads/writes `work/` and
   `dist/` *there*, whatever your cwd is. Install where the user is happy to keep
   the project; there is no `--project-dir` flag.

4. **`node skull_studio/fetch_libs.mjs` is the only network step after pip.** It
   vendors pinned PixiJS 8.16.0, GSAP 3.12.7, three r137 and its GLTFLoader into
   `runtime/vendor/`. If that dir is empty every build produces a blank page. Builds
   never touch the network again.

5. **ffmpeg must be on PATH; LibreOffice need not be.** `render_clips.py:28` does
   `shutil.which("ffmpeg") or "ffmpeg"`, but `extract_pptx.py:42-52` also probes
   `C:\Program Files\LibreOffice\program\soffice.exe` and the (x86) variant, plus
   `libreoffice` on POSIX.

6. **No LibreOffice means no PPTX import.** PDF import is unaffected. Say this
   plainly rather than letting the user watch an import do nothing.
</critical_rules>

<workflow>

## 1. Decide the install mode

| Mode | Command | When |
|---|---|---|
| **Standard** | `python install.py --no-ocr` | normal; adds a `skull-studio` command to PATH |
| **Install-free** | `python launch.py` | no pip install wanted; runs in place, auto-fetches vendor libs on first run |
| **uv** | `uv run install.py --no-ocr` then `uv run skull-studio` | user prefers uv; also the clean path for MinerU |

## 2. Get the code

```bash
git clone https://github.com/TriasJ/skull-studio.git
cd skull-studio
```

If the repo is already present, `git pull` instead. Never re-clone over existing work —
`work/` holds the user's current project and is gitignored.

## 3. Prerequisites

Check what is present *before* installing; only install what is missing.

| Requirement | Needed for | Windows | macOS | Linux |
|---|---|---|---|---|
| **Python >= 3.10** | required | [python.org](https://www.python.org/) | `brew install python` | `apt install python3` |
| **Node >= 18** | required (HTML build) | `winget install OpenJS.NodeJS` | `brew install node` | `apt install nodejs` |
| **ffmpeg** | mp4/GIF baking | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `apt install ffmpeg` |
| **LibreOffice** | **PPTX import only** | `winget install TheDocumentFoundation.LibreOffice` | `brew install --cask libreoffice` | `apt install libreoffice` |
| **MinerU** | full-layout OCR, ~GB models | `uv tool install "mineru[core]"` | same | same |
| RapidOCR | bundled OCR fallback | installed by pip automatically | | |

After a `winget`/`brew`/`apt` install, **open a new shell** so PATH updates land.

## 4. Install

```bash
python install.py --no-ocr
```

It runs: prereq check -> `uv pip install -e .` (or `python -m pip install -e .` when uv
is absent, `install.py:70-73`) -> `node skull_studio/fetch_libs.mjs` -> launcher setup.

## 5. Verify — always run this

```bash
python .claude/skills/skull-studio-install/scripts/doctor.py
```

Exits 0 when everything required is present, 1 when a hard gate fails. It prints one
line per check and an exact fix command for every failure. Run it again after fixing
anything. Add `--json` for machine-readable output.

## 6. Smoke test

```bash
skull-studio --no-browser        # prints the URL; Ctrl+C to stop
```

If `skull-studio` is not found, use `python launch.py` or
`python -m skull_studio.studio` — the console-script shim just is not on PATH yet
(a new shell usually fixes it).

For a real end-to-end check without the GUI:

```bash
python -m skull_studio.pipeline sample/demo.pdf --ocr rapid   # smoke test only
```

`--ocr rapid` is used here only because it downloads nothing; **MinerU is the
recommended engine for real decks** (see the skull-studio-pipeline skill). This
**overwrites**
`work/manifest.json` — back it up first if the user has a project in progress.

## 7. Optional: MinerU

Recommended for real work - MinerU returns full layout (figures, tables, reading
order), not just text, which is what these decks need. Install it unless the user
specifically wants to avoid the download.

```bash
uv tool install "mineru[core]"
# if the HuggingFace download stalls:
MINERU_MODEL_SOURCE=modelscope uv tool run --from "mineru[core]" mineru --help
```

First MinerU-backed import downloads ~GB of models once and takes several minutes.

</workflow>

<verification>
Installation is done when **all** of these hold:

- `python .claude/skills/skull-studio-install/scripts/doctor.py` exits 0
- `runtime/vendor/` contains `pixi.min.js`, `gsap.min.js`, `three.min.js`,
  `three.GLTFLoader.js`
- `python -c "import skull_studio"` succeeds
- `skull-studio --no-browser` prints `Skull Studio is running at: http://localhost:8765`

Report to the user which optional components are absent and what that costs them
(no ffmpeg -> no video baking; no LibreOffice -> no PPTX import; no MinerU -> use
`--ocr rapid`, at the cost of layout and reading order).
</verification>

<next_steps>
- To import a deck and export it: use the **skull-studio-pipeline** skill.
- To change animations, boxes, particles or 3D by editing JSON: use the
  **skull-studio-manifest** skill.
- Install-specific failures: `references/troubleshooting-install.md`.
</next_steps>
