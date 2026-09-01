# Working on / with Skull Studio

Three skills in `.claude/skills/` cover this project. Use them rather than
re-deriving the pipeline from source:

| Skill | Use it for |
|---|---|
| **skull-studio-install** | installing, upgrading or repairing an install; prerequisite checks (`scripts/doctor.py`) |
| **skull-studio-pipeline** | importing decks, building HTML, exporting PPTX / baked HTML / clips, driving a running studio over HTTP |
| **skull-studio-manifest** | anything creative: entrances, idle loops, particles, rigs, 3D models, element boxes, censoring — all by editing `work/manifest.json` |

They are also published as a plugin: `/plugin marketplace add TriasJ/skull-studio`.

## Things to know before touching anything

- **`work/manifest.json` is the whole project.** The importer writes it, the editor
  mutates it, every exporter reads it. Back it up before an import — importing
  **replaces** it.
- **The repo root is the working directory, always.** Every module resolves
  `ROOT = Path(__file__).resolve().parent.parent` and uses `work/` and `dist/`
  there, whatever the cwd. There is no project-directory flag.
- **`python install.py` blocks on an interactive prompt** unless you pass
  `--no-ocr`.
- **Validate before you build:** `python -m skull_studio.validate_manifest` — it is
  the authoritative schema gate and names the offending element.
- **Box, mask and cleanup edits need `python -m skull_studio.crop_and_patch`**
  before they show up; animation edits do not.
- There is **no test suite**. Verify by running the real flow (see
  `CONTRIBUTING.md`): `python -c "import ast; ast.parse(open(F).read())"` for Python
  and `node --check FILE.mjs` for the build scripts.

## Layout

```
skull_studio/   Python stages + Node build scripts + the local server (studio.py)
runtime/src/    browser runtime, plain IIFE modules concatenated in numeric order
                (00-90; the editor modules 60-67 are stripped from viewer builds)
work/           intermediate artifacts (gitignored) - manifest.json lives here
dist/           built deliverables (gitignored)
docs/           ARCHITECTURE (schema + internals), USAGE, TROUBLESHOOTING
```

Full internals: `docs/ARCHITECTURE.md`.
