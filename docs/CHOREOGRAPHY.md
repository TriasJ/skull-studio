# Choreography — what Skull Studio's default motion is *for*

The mechanism is documented in [ARCHITECTURE.md](ARCHITECTURE.md) and the vocabulary
in [USAGE.md](USAGE.md). This note covers the thing neither of them says: **what the
defaults are trying to achieve, and why they are set where they are.**

Until now the only written statement of intent was one sentence in
`skull_studio/auto_choreo.py`:

> titles fade up, body text cascades in reading order, images mask-reveal from their
> side and breathe, tiny corner marks stay static, backgrounds get a slow ken burns

That is still a fair summary of the code. This note explains the target it was aimed
at, and how to extend it now that the effect vocabulary is much larger than it was
when that line was written.

---

## The target deck

Skull Studio's defaults are tuned for **stills from NotebookLM slide decks** — the
scientific and artistic kind — brought to life without hand-animating anything.

That target has specific consequences, because those decks share a shape:

- **Image-forward.** Usually one generated illustration or diagram dominating the
  slide, plus a title and a short text block. Not bullet-heavy corporate decks.
- **Text is often baked into the image.** It is not a real text frame; it is pixels.
  The importer recovers it via OCR into its own element, whose crop is a rectangle
  cut out of the illustration behind it.
- **Static by construction.** They are stills. There is no source motion to preserve
  or match — every bit of movement is something we are adding.
- **Two very different moods** under one file format: a labelled pathway diagram and
  an atmospheric generated illustration arrive through exactly the same pipeline.

The first two are practical constraints. The last one is the design problem.

---

## The governing rule: information or atmosphere?

Role (`title` / `body` / `figure`) is not enough to decide how something should move,
because **`figure` covers both a bar chart and a mood illustration**, and those want
opposite treatment.

The real question for any element is:

> **Does this element carry information, or atmosphere?**

| | Information | Atmosphere |
|---|---|---|
| examples | charts, labelled diagrams, molecular structures, tables, axis text, callout labels | generated illustrations, textures, backdrops, ornament, hero art |
| distortion | **never** — a rippling graph is a false graph | encouraged — mesh, ripple, swirl, wave |
| motion budget | arrival only, then still | arrival plus a persistent idle |
| parallax | **none** — depth detaches a label from what it labels | yes, it is what makes a flat render read as a space |
| particles | no | yes |
| what motion is for | **sequencing** — controlling the order things are understood in | **presence** — making a still feel inhabited |

This is the rule to reason from. Everything below is a consequence of it.

### Why distortion on data is the hard line

Mesh idles (`wave`, `ripple`, `swirl`, `meshWave`) and rigs physically move pixels
relative to each other. On an illustration that is expressive. On a plotted chart,
a labelled anatomy figure, or a structural formula it **changes what the image
asserts** — a bar becomes momentarily taller, an arrow points somewhere it does not.
It is the one effect in the vocabulary that can make a scientific slide lie.

Transform-only idles (`float`, `breath`, `sway`, `pulse`, `shimmer`, `glow`) move the
element as a rigid whole and never have this problem. When in doubt on a scientific
deck, they are always the safe family.

---

## The two profiles

### Scientific — motion as sequencing

The deck is explaining something. Motion's job is to control the order of
understanding and then get out of the way.

- **Entrances carry the whole load.** Reveal in explanatory order, not just reading
  order, and use the delay to give each idea a beat.
- **`maskReveal` beats `fade` for diagrams** — it reads as *drawing* the figure, which
  matches "here is how this is built up".
- **Idles: near-zero, or none.** A `breath` at 0.005 keeps the slide from feeling
  frozen. Anything more competes with the content the viewer is trying to read.
- **No parallax on anything labelled.**
- **Backgrounds: no Ken Burns** if the background *is* the diagram. Slow drift on a
  figure someone is reading is quietly hostile.
- Particles: no.

### Artistic — motion as presence

The deck is evoking something. Motion's job is to make a flat generated still feel
like a place.

- **Idles carry the load.** This is where `ripple`, `swirl`, `glow` and rigs belong;
  it is what the mesh work exists for.
- **Parallax is the cheapest win.** `0.25` on a foreground subject over a drifting
  background does more for perceived depth than any single effect.
- **Ken Burns on backgrounds**, 1.035–1.05 over 14 s. Long and slow enough that it is
  felt rather than seen.
- **Particles suit generated art** — `embers`, `floatUp` and `bubbles` sit naturally
  in the kind of atmospheric renders these decks produce. They cost nothing at export
  time: `render_clips.py` re-simulates them deterministically, so they survive into
  PowerPoint and baked HTML.
- Entrances can be softer and slower; nothing is waiting to be read.

---

## Consequences of baked-in text

Two things follow from OCR-recovered text that catch people out:

**1. Moving text leaves a hole.** The text element's crop was cut out of the
illustration behind it, so any entrance that moves or fades it exposes the gap.
This is what `cleanup` is for, and why `auto_choreo` sets `cleanup: "auto"` on every
text element it animates. **If you animate recovered text, give it a cleanup.**

**2. There is no per-line stagger.** `staggerText` degrades to a downward
`maskReveal` — `element.lines` is never populated. A real cascade has to come from
OCR having split the text into separate block elements, staggered by delay. On these
decks it usually has.

**Use MinerU, and trust what it returns.** These decks are exactly the case MinerU
is built for — full layout analysis: figures, tables and reading order, not just
text. Its segmentation is the segmentation of record. Don't hand-redraw boxes it
produced or second-guess its figure/text split; review the numbered overlays from
`python -m skull_studio.debug_overlay`, fix the genuine misses, and choreograph the
rest as given. RapidOCR (`--ocr rapid`) is the fallback for when MinerU is not
installed or the download is not worth it — it recovers text only, with no layout,
so the reading order that drives a body-text cascade has to be inferred from
geometry instead.

---

## Where `DEFAULT_BY_ROLE` fits

`.claude/skills/skull-studio-manifest/scripts/manifest_edit.py` carries a
`DEFAULT_BY_ROLE` table behind `apply-preset --preset auto`. It keys on role alone,
which — per the rule above — is the coarser of the two axes.

**Lean generous.** The asymmetry runs the opposite way to what "be conservative"
instinct suggests, and it is the reason this tool exists: **setting animation up is
the expensive part; switching it off is one edit.** `clear-idle`, or an entrance
type of `none`, and the element is static again. A deck that arrives over-animated
gets tuned down in a minute; a deck that arrives under-animated leaves the user
doing the very work they installed Skull Studio to avoid. These are stills — the
starting point is *zero* motion, so erring toward less means erring toward doing
nothing.

Recommended values, which is what ships:

```python
DEFAULT_BY_ROLE = {
    "title":  ({"type": "fadeUp", "delay": 0.2, "duration": 1.0,
                "ease": "power3.out", "distance": 0.035},
               [{"type": "float", "amplitude": 0.004, "period": 7}], 0.08),

    # no delay: re-run auto_choreo afterwards to lay in the reading-order cascade,
    # which it can do because it sees the whole slide and this table cannot
    "body":   ({"type": "fadeUp", "duration": 0.9, "ease": "power3.out",
                "distance": 0.03},
               [{"type": "float", "amplitude": 0.003, "period": 8}], 0.12),

    # maskReveal reads as "drawing" the figure; breath + a soft glow give it presence
    "figure": ({"type": "maskReveal", "delay": 0.5, "duration": 1.3,
                "direction": "left"},
               [{"type": "breath", "amount": 0.012, "period": 6},
                {"type": "glow", "amount": 0.3, "period": 4, "color": "#8fd3ff"}],
               0.25),
}
```

The third tuple element is `parallax`, applied at the same time.

The one thing the table stays out of is **mesh distortion**. Not out of caution
about intensity — `wave`, `ripple`, `swirl`, `meshWave` and rigs are the loudest and
best effects here — but because they are the only family whose correctness depends
on what the image *is*, and a role-keyed default cannot tell a chart from an
illustration. Add them per element, generously, once you can see the slide:

```bash
python manifest_edit.py apply-preset all --preset auto        # safe baseline
python manifest_edit.py apply-preset hero_art --preset underwater
python manifest_edit.py add-particles backdrop --preset embers
python manifest_edit.py bg-idle --slide all --type kenBurns --scale 1.04
```

---

## The `choreograph.py` question

`auto_choreo.py:5-6` refers to *"a per-deck script (see `choreograph.py`)"*. **That
file has never existed** in any commit. The original design had three layers:

```
auto_choreo.py     generic, sees any deck, knows nothing about it
choreograph.py     per-deck taste          <- never built
the editor         per-element, manual
```

The gap is real: generic heuristics cannot tell a chart from an illustration, and the
editor is too slow for a whole deck. `DEFAULT_BY_ROLE` plus targeted `apply-preset`
calls now occupies that slot, driven by an agent that **can** look at the slides —
via `python -m skull_studio.debug_overlay` and the numbered overlays in
`work/debug/`. That is the layer working as intended, just scripted per-run instead
of committed per-deck.

So `choreograph.py` is **not a missing file — it is a fallback**. The default path
is the scripted one above; a committed per-deck script stays a legitimate option for
a deck that needs bespoke handling and will be regenerated often enough to be worth
the file. Nothing depends on one existing, and none ships. The docstring in
`auto_choreo.py` now says exactly this and points here.

---

## Rules of thumb

1. **Ask information-or-atmosphere before choosing any effect.**
2. **Never mesh-deform data.**
3. **Scientific decks spend their motion budget on entrances; artistic decks spend it
   on idles.**
4. **Parallax implies depth. Only claim depth where depth exists.**
5. **Slower than feels right.** These are stills being brought to life, not motion
   graphics. 14 s Ken Burns, 6–8 s breath periods. Generous means *more elements
   moving*, not faster movement.
6. **Animated recovered text needs a `cleanup`.**
7. **When unsure, over-animate.** Turning motion off is one edit; setting it up is
   the job. The only exception is rule 2 — distorting data is not "too much
   motion", it is a wrong picture, and no amount of easy-to-undo makes it a
   reasonable default.
