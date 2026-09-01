# Filling in `DEFAULT_BY_ROLE`

A short guide to the one hand-tuned table in
`scripts/manifest_edit.py:76-95`.

> **Read `docs/CHOREOGRAPHY.md` first** — it states what these defaults are *for*
> (stills from scientific and artistic NotebookLM decks), gives the
> information-vs-atmosphere rule that decides every effect choice, and carries the
> recommended values. This file is the mechanics of editing the table; that one is
> the taste.

## What it drives

`manifest_edit.py apply-preset <selector> --preset auto` — the "make this deck feel
alive" path. For each selected element it looks up the element's `role` and writes
that entrance and idle list. Elements smaller than `TINY_AREA` (0.4 % of the slide)
skip the table entirely and get `entrance: none`, no idle — page numbers and corner
marks stay still on purpose.

The other presets (`float`, `glow`, `underwater`, `drift`, `sparkle`, `heartbeat`)
are copied verbatim from the editor and should not be edited here; changing them
would make the CLI and the GUI disagree. This table is the one place your taste
belongs.

## The shape

```python
DEFAULT_BY_ROLE = {
    "<role>": ( <entrance dict>, <list of idle dicts>, <parallax 0-1> ),
}
```

Roles are exactly `title`, `body`, `figure` — the set the importers assign. Anything
with an unknown or missing role falls back to `figure`. All three tuple slots are
written on every matched element, so `apply-preset --preset auto` overwrites
`entrance`, `idle` **and** `parallax`.

## The three decisions

**1. How much does `body` move?**
It ships with a `float` at amplitude 0.003 — deliberately at the threshold of
perception, because body text is what people are reading and motion under text
costs legibility. This is the one role where more is not better: 0.004 is about
the ceiling before it fights the reader. Raise it only for decks that are more
poster than document.

**2. What does `figure` idle with?**
It ships with `breath` 0.012 / 6 s plus a soft `glow` — noticeably livelier than
the importer's near-subliminal 0.007. Figures are the atmosphere-carrying role and
the one worth spending motion on. `pulse` reads as "look here"; `ripple`/`swirl`
are the loudest options but are mesh effects, so add them per element once you can
see whether the figure is an illustration or a chart (see `docs/CHOREOGRAPHY.md`).

**3. Do you own `delay`, or does `auto_choreo`?**
This is the real trade-off. `auto_choreo.py` staggers body text by
`0.6 + k * 0.25` in reading order, because it sees the whole slide at once.
`apply-preset --preset auto` works element-by-element and cannot — so every body
element gets the same delay and they all land together.

- **Keep `delay` in the table** → predictable, but no cascade.
- **Drop `delay` from the `body` entry** → the key is absent, the runtime defaults
  it to 0, and you re-run `python -m skull_studio.auto_choreo` afterwards to lay in
  the cascade. Better-looking, one more step.

If most of your use is "fix up a few elements", keep the delays. If it is "restyle
a whole deck", drop them and let `auto_choreo` finish the job.

## Rules that will bite

| Rule | Where |
|---|---|
| `type` must be in `ENTRANCES` / `IDLES` | same file, lines 31-38 |
| `ease` must be in `EASES` — otherwise it **silently** becomes `power2.out` | line 41 |
| Parameter names are not validated; a typo is ignored and the default is used | `references/effects-reference.md` |
| `distance` is a fraction of `deck.designHeight`, not pixels | 0.035 ≈ 25 px on a 720 pt deck |
| `idle` must be a **list**, even for one effect | `[{...}]` |
| Mesh idles (`wave`, `ripple`, `swirl`, `meshWave`) force a MeshPlane view | costs more per frame; avoid deck-wide |

`back.out(1.3)` is **not** in the ease whitelist — `1.4` and `1.7` are. That exact
mistake is live in `make_showcase.py:247` today.

## Three coherent starting points

The shipped table sits between Lively and Cinematic. If you want a different
overall register, pick one of these wholesale and adjust, rather than mixing
effects per role. Note these predate the `parallax` third tuple element — add one
(0.08 / 0.12 / 0.25 is the shipped spread) when you paste them in.

**Restrained** (reports, technical decks) — motion only where the eye already is:

```python
"title":  ({"type": "fadeUp", "delay": 0.2, "duration": 1.0, "ease": "power3.out",
            "distance": 0.03}, []),
"body":   ({"type": "fadeUp", "duration": 0.8, "distance": 0.02}, []),
"figure": ({"type": "fadeIn", "delay": 0.4, "duration": 0.9},
           [{"type": "breath", "amount": 0.005, "period": 8}]),
```

**Lively** (pitches, marketing) — everything arrives with intent:

```python
"title":  ({"type": "scaleIn", "delay": 0.15, "duration": 0.8,
            "ease": "back.out(1.4)", "from": 0.9}, []),
"body":   ({"type": "fadeUp", "duration": 0.9, "ease": "power3.out", "distance": 0.04},
           [{"type": "float", "amplitude": 0.004, "period": 7}]),
"figure": ({"type": "maskReveal", "delay": 0.5, "duration": 1.2, "direction": "left"},
           [{"type": "glow", "amount": 0.35, "period": 3, "color": "#66ccff"}]),
```

**Cinematic** (talks, showreels) — slow, wide, deliberate:

```python
"title":  ({"type": "blurIn", "delay": 0.3, "duration": 1.6, "ease": "power2.out",
            "fromBlur": 16}, []),
"body":   ({"type": "fadeIn", "duration": 1.2, "ease": "sine.out"}, []),
"figure": ({"type": "maskReveal", "delay": 0.6, "duration": 1.8,
            "ease": "power2.inOut", "direction": "center"},
           [{"type": "breath", "amount": 0.01, "period": 9}]),
```

## Testing your edit

Back up first — `apply-preset` overwrites both `entrance` and `idle`:

```bash
cp work/manifest.json work/manifest.backup.json

S=.claude/skills/skull-studio-manifest/scripts
python $S/manifest_edit.py apply-preset all --preset auto --dry-run   # read the diff
python $S/manifest_edit.py apply-preset all --preset auto
node skull_studio/build.mjs
```

Open `dist/presentation.html` and watch one full slide cycle — idles need a few
seconds before they read as anything. To go back:

```bash
cp work/manifest.backup.json work/manifest.json && node skull_studio/build.mjs
```

Try it on a real deck, not the feature showcase: the showcase's elements are
uniform demo tiles and every role default will look the same on them.
