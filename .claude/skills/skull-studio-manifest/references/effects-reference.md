# Effects reference — entrances, idles, particles, eases, blends

Parameter names and defaults come from the runtime source
(`runtime/src/40-anim.js`, `52-particles.js`, `00-core.js`). The enum *membership*
is enforced by `skull_studio/validate_manifest.py`; the *parameters* are not
validated at all — a misspelled key is silently ignored, so copy the names exactly.

---

## Entrances

One object per element: `"entrance": { "type": ..., ... }`.
Shared keys: `delay` (seconds, default 0), `duration` (seconds), `ease`.

| `type` | Extra params | Default duration | Notes |
|---|---|---|---|
| `none` | — | — | element is simply present |
| `fadeIn` | — | 0.8 | |
| `fadeUp` / `fadeDown` / `fadeLeft` / `fadeRight` | `distance` (0.04) | 1.0 | `distance` is a fraction of `deck.designHeight`; default ease `power3.out` |
| `scaleIn` | `from` (0.82) | 1.0 | default ease `back.out(1.4)` |
| `maskReveal` | `direction`: `left` `right` `up` `down` `center` | 1.2 | default ease `power2.inOut` |
| `blurIn` | `fromBlur` (12, px) | 1.0 | |
| `drawOn` | `direction` (default `left`) | 1.2 | a `maskReveal` alias |
| `staggerText` | `direction` (default `down`) | 1.0 | **degrades to `maskReveal`** — per-line sub-crops (`element.lines`) are never populated |
| `scaleIn3D` | as `scaleIn` | 1.0 | intended for `model3d` |
| `rotateIn` | `turns` (1) | — | `fadeIn` plus a spin, on live 3D models |

Example:

```json
"entrance": { "type": "fadeUp", "delay": 0.3, "duration": 1.1,
              "ease": "power3.out", "distance": 0.035 }
```

---

## Idle loops

`"idle"` is an **array** — several loops can run at once (e.g. a `breath` plus a
`glow`).

| `type` | Params (defaults) | Bakes to video/PPTX? | Notes |
|---|---|---|---|
| `float` | `amplitude` (0.006 of designHeight), `period` (5) | yes | vertical bob |
| `breath` | `amount` or `amplitude` (0.015), `period` (4) | yes | gentle scale |
| `pulse` | `amount` (0.18), `period` (3) | yes | opacity/scale throb |
| `sway` | `degrees` (1.2), `period` (6) | yes | rotation |
| `shimmer` | `amount` (0.15), `period` (4) | yes | brightness |
| `glow` | `amount` (0.4), `period` (2), `color` (`#rrggbb`) | yes | pulsing bloom |
| `wave` | `amplitude` (0.02), `speed` (0.6), `waves` (2), `axis` `x`\|`y` | yes | **mesh** |
| `ripple` | `amplitude` (0.012), `speed` (0.5), `waves` (1-3) | yes | **mesh**, underwater feel |
| `swirl` | `degrees` (12), `speed` (0.5), `radius` (0.7) | yes | **mesh** |
| `meshWave` | `amplitude` (0.01), `speed` (0.8), `axis` | yes | **mesh** |
| `particles` | see below | yes (re-simulated) | emitter |
| `kenBurns` | `scale` (1.05), `duration` (14), `yoyo` (true) | background-level | put it on `slide.background.idle` |
| `autoRotate` | `degrees` or `amount` (30, deg/s) | 3D only | spin a `model3d` |

**Mesh** idles force a MeshPlane view for that element — more per-frame cost than
the transform-only ones. Use them deliberately, not deck-wide.

Example:

```json
"idle": [
  { "type": "breath", "amount": 0.008, "period": 6 },
  { "type": "glow", "amount": 0.6, "period": 2, "color": "#66ccff" }
]
```

---

## Particles

```json
{ "type": "particles", "preset": "snow", "shape": "dot",
  "color": "#ffffff", "rate": 18, "size": 1.1 }
```

| Key | Meaning |
|---|---|
| `preset` | `sparkle` `snow` `embers` `floatUp` `bubbles` — sets rate, lifetime, size range, speed, direction, gravity, blend, colour, twinkle, sway and spawn region |
| `shape` | `dot` `circle` `ring` `square` `triangle` `star` `custom` (default `dot`) |
| `texture` | required when `shape` is `custom`: `"particles/<file>.png"` under `work/` |
| `color` | `#rrggbb`, overrides the preset colour |
| `rate` | particles per second, overrides the preset |
| `size` | **multiplier** on the preset's size range (default 1), not an absolute size |

Preset physics (`52-particles.js:50-55`) — all sizes and speeds are fractions of the
element box height, so they are resolution-independent:

| preset | rate | life (s) | size | speed | dir | gravity | blend | colour | spawns from |
|---|---|---|---|---|---|---|---|---|---|
| `sparkle` | 24 | 0.6-1.4 | .02-.06 | 0-.05 | any | 0 | add | `#fff2b0` | area |
| `snow` | 18 | 3-6 | .015-.04 | .03-.08 | down | +0.02 | normal | `#ffffff` | top edge |
| `embers` | 20 | 1-2.5 | .015-.05 | .06-.14 | up | -0.03 | add | `#ff7a2a` | bottom edge |
| `floatUp` | 14 | 2-4 | .02-.06 | .04-.09 | up | -0.01 | add | `#bfe0ff` | bottom edge |
| `bubbles` | 12 | 2.5-5 | .02-.07 | .03-.08 | up | -0.01 | screen | `#aad8ff` | bottom edge |

Particles look HTML-only but **do** reach PowerPoint and baked HTML:
`render_clips.py:33-40` mirrors these tables and re-simulates them deterministically
(seeded and loop-periodic) into the mp4/GIF.

---

## Ease whitelist

`runtime/src/00-core.js:6-15`. An ease outside this set does **not** error — it
silently becomes `power2.out`, which is why a "my custom ease does nothing" bug is
easy to miss.

```
none
power1.in  power1.out  power1.inOut
power2.in  power2.out  power2.inOut
power3.in  power3.out  power3.inOut
power4.in  power4.out  power4.inOut
sine.in    sine.out    sine.inOut
expo.in    expo.out    expo.inOut
back.out   back.out(1.4)   back.out(1.7)   back.inOut
elastic.out   elastic.out(1,0.4)
circ.out   circ.inOut
```

---

## Blend modes

`element.blendMode`, one of (`runtime/src/61-editor-inspector.js:14-16`):

```
normal  add  screen  multiply  overlay  darken  lighten
color-dodge  color-burn  hard-light  soft-light  difference  exclusion
```

Paired with `opacity` (0-1). **An element with a blend mode is flattened to an image
on PPTX export** — it cannot stay an editable text box.

---

## The editor's one-click looks

`runtime/src/67-effect-presets.js`. `manifest_edit.py apply-preset` writes exactly
these.

| id | label | entrance | idle |
|---|---|---|---|
| `float` | Gentle float | `fadeUp` 0.2/0.9 power3.out | `float` amplitude .008 period 5 |
| `glow` | Neon glow | `fadeIn` 0.2/0.8 power2.out | `glow` amount .6 period 2 colour `#66ccff` |
| `underwater` | Underwater | `fadeIn` 0.2/1.0 power2.out | `ripple` amplitude .015 speed .5 waves 3 |
| `drift` | Drift in | `fadeLeft` 0.2/0.9 power3.out distance .06 | `sway` degrees 1.2 period 6 |
| `sparkle` | Sparkle | `scaleIn` 0.15/0.8 back.out(1.4) | `particles` preset sparkle rate 24 |
| `heartbeat` | Heartbeat | `scaleIn` 0.15/0.7 back.out(1.4) | `pulse` amount .12 period 1.2 |

## The importer's defaults

`skull_studio/auto_choreo.py` — worth matching when you add elements by hand so the
deck stays coherent:

- every slide background gets `kenBurns` scale 1.035, duration 14, yoyo
- **titles** (topmost text, or `role: "title"`): `fadeUp` delay 0.2, duration 1.1,
  `power3.out`, distance 0.035, `cleanup: "auto"`, parallax 0.08
- **body text**, in reading order: `fadeUp` delay `0.6 + k*0.25`, duration 0.9,
  distance 0.03, parallax 0.12
- **images** under half the slide: `maskReveal` delay 0.6, duration 1.3, direction
  = the side they sit on; over half the slide: `entrance: none` (they read as
  backdrops). Both get `breath` amount 0.007 period 7, parallax 0.25
- anything under **0.4 % of slide area**: `entrance: none`, `cleanup: none`,
  `parallax: 0` — page numbers and corner marks stay still on purpose
