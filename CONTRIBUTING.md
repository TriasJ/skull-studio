# Contributing

Thanks for your interest! This is a small, vibe-coded creative tool — contributions
are welcome, with no formal process or SLA. Be kind and patient.

## Getting set up

```bash
git clone https://github.com/TriasJ/skull-studio.git
cd skull-studio
python install.py            # editable install + vendored libs
skull-studio                 # run it
```

The package installs editable (`pip install -e .`), so your source edits take
effect immediately. The Studio server also serves `runtime/src/*.js` live — just
**reload the browser** after editing a runtime module; no rebuild needed.

## How the codebase is organized

- **`skull_studio/*.py`** — the pipeline stages and the local server. Each script
  resolves the repo root as `Path(__file__).resolve().parent.parent` and reads/
  writes `work/` and `dist/` there.
- **`skull_studio/*.mjs`** — the Node build scripts (HTML / baked HTML / lib fetch).
  They use only Node's standard library.
- **`runtime/src/NN-*.js`** — the editor/player, plain IIFE modules concatenated in
  numeric order. `00`–`50` are the player; `60`–`66` are editor-only (stripped from
  viewer builds); `90` boots.
- **`docs/ARCHITECTURE.md`** — read this first. It covers the manifest schema, the
  "one-writer" scene graph, the rig skinning math, and the PPTX timing rule.

## Conventions

- **No build step for the runtime** — keep it plain IIFE modules attaching to
  `window.SKULL`; the build just concatenates them. No bundler, no framework.
- **`work/manifest.json` is the single source of truth.** New per-element features
  should live in the element spec and be added to the persistence `KEYS` list
  (`runtime/src/64-editor-persist.js`) so they survive export/`--apply`.
- **Coordinates** are normalized `[x0,y0,x1,y1]`, top-left origin, everywhere.
- **No new heavy deps** without good reason — the value is that it runs on free,
  common tools.
- Match the surrounding style (concise comments explaining *why*, not *what*).

## Testing your change

There's no formal test suite; verify by running the real flow:

```bash
python -m skull_studio.make_sample                 # regenerate sample/demo.pdf
python -m skull_studio.pipeline sample/demo.pdf --skip-mineru   # render + build
skull-studio                                       # open the editor, exercise your change
```

Lint quickly with `python -c "import ast; ast.parse(open('FILE').read())"` and
`node --check FILE.mjs`. For PPTX/anim changes, confirm the file reopens in
python-pptx and converts via LibreOffice (a lenient check) — and ideally in real
PowerPoint (the strict one).

## Pull requests

- Keep PRs focused; describe what you changed and how you verified it.
- Update the relevant doc (`README.md` / `docs/USAGE.md` / `docs/ARCHITECTURE.md`)
  when you add or change user-facing behavior.
- By contributing you agree your work is licensed under the project's MIT license.
