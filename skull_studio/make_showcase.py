"""Generate a feature-showcase deck demonstrating every animation the runtime can do.

Builds a ready-to-build project in work/ (drawn backgrounds + labelled crop tiles +
a fully-wired manifest), then `build.mjs` turns it into dist/showcase.html:

    node skull_studio/make_sample_glb.mjs          # sample/models/*.glb (animated)
    python -m skull_studio.make_showcase           # work/manifest.json + assets
    node skull_studio/build.mjs                     # dist/presentation.html (live)

Four slides:
  1. Entrances   — every entrance type, staggered (fade family, scale, mask, blur,
                   drawOn, staggerText, rotateIn, scaleIn3D)
  2. Idle loops  — float / breath / pulse / sway / shimmer + the mesh effects
                   wave / meshWave / ripple / swirl + glow
  3. Particles   — sparkle / snow / embers / floatUp / bubbles (each a different shape)
  4. 3D models   — sphere / cone / torus (baked tumble) + cube / cylinder / plane
                   (auto-rotate)

Everything is our own drawn/generated content; nothing is copied from third parties.
"""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
SAMPLE_MODELS = ROOT / "sample" / "models"
GLB_SCRIPT = ROOT / "skull_studio" / "make_sample_glb.mjs"
W, H = 1280, 720
GOLD, INK, DIM = (201, 162, 39), (11, 11, 16), (170, 170, 180)

# a small accent palette cycled across tiles
PALETTE = [(80, 165, 235), (235, 165, 55), (210, 175, 50), (120, 210, 150),
           (220, 120, 200), (120, 180, 240), (240, 150, 110), (160, 200, 90)]


# ------------------------------------------------------------------ drawing helpers
def _font(sz, bold=False):
    names = ("seguisb.ttf", "segoeuib.ttf") if bold else ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf")
    for name in names + ("DejaVuSans.ttf",):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def _centered(d, cx, y, text, font, fill):
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((cx - (r - l) / 2, y), text, font=font, fill=fill)


def background(idx, title, subtitle):
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    for y in range(H):                                  # subtle vertical gradient
        k = y / H
        d.line([(0, y), (W, y)], fill=(int(11 + 9 * k), int(11 + 9 * k), int(16 + 16 * k)))
    d.rectangle([18, 18, W - 18, H - 18], outline=(60, 54, 30), width=1)
    d.text((64, 40), title, font=_font(40, bold=True), fill=GOLD)
    d.text((66, 92), subtitle, font=_font(20), fill=DIM)
    d.text((W - 156, H - 38), "Skull Studio", font=_font(15), fill=(90, 90, 100))
    (WORK / "slides_webp").mkdir(parents=True, exist_ok=True)
    img.save(WORK / "slides_webp" / f"slide_{idx:02d}.webp", "WEBP", quality=84)


def _px(bbox, lo=120):
    """Tile pixel size MUST equal the element's bbox in background pixels — render_clips
    composites the crop at its native resolution, so any mismatch overflows/clips the
    baked video. (Also avoids stretch in the live HTML, where the sprite fills the box.)"""
    return max(lo, round((bbox[2] - bbox[0]) * W)), max(lo, round((bbox[3] - bbox[1]) * H))


def _card(d, w, h, accent):
    pad = max(5, round(min(w, h) * 0.035))
    rad = max(10, round(min(w, h) * 0.09))
    d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=rad,
                        fill=(22, 22, 30, 255), outline=accent + (255,),
                        width=max(2, round(min(w, h) * 0.013)))
    return pad


def _label(d, w, h, label, accent):
    _centered(d, w / 2, h * 0.82, label, _font(max(12, round(min(w, h) * 0.13)), bold=True),
              (232, 232, 238))


def tile(name, label, accent, pattern, bbox):
    """A labelled rounded-card crop tile sized to its bbox. `pattern` picks the inner
    motif so the effect reads well (a grid warps visibly under the mesh idles)."""
    w, h = _px(bbox)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = _card(d, w, h, accent)
    cx, cy, R = w / 2, h * 0.42, min(w, h) * 0.24
    lw = max(2, round(R * 0.09))
    if pattern == "grid":                               # mesh effects (wave/ripple/swirl)
        x0, y0, x1, y1 = pad + lw, pad + lw, w - pad - lw, h * 0.66
        for gx in range(1, 9):
            x = x0 + gx * (x1 - x0) / 9
            d.line([(x, y0), (x, y1)], fill=accent + (120,), width=max(1, lw - 1))
        for gy in range(1, 7):
            y = y0 + gy * (y1 - y0) / 7
            d.line([(x0, y), (x1, y)], fill=accent + (120,), width=max(1, lw - 1))
    elif pattern == "glow":                             # glow / pulse — a bright disc
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=accent + (255,))
    elif pattern == "rings":
        for k in (0.5, 0.75, 1.0):
            r = R * k
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=accent + (220,), width=lw)
    else:                                               # default: a filled diamond glyph
        d.polygon([(cx, cy - R), (cx + R, cy), (cx, cy + R), (cx - R, cy)], fill=accent + (235,))
    _label(d, w, h, label, accent)
    (WORK / "crops").mkdir(parents=True, exist_ok=True)
    img.save(WORK / "crops" / f"{name}.webp", "WEBP", quality=90)
    return f"crops/{name}.webp"


def model_tile(name, label, accent, kind, bbox):
    """3D-preview tile: recognizable line-art of the primitive (this is what PowerPoint
    bakes as the static picture for our synthetic models, since it can't show live 3D)."""
    w, h = _px(bbox)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = _card(d, w, h, accent)
    cx, cy, R = w / 2, h * 0.42, min(w, h) * 0.28
    col = accent + (255,)
    lw = max(2, round(R * 0.07))
    thin = max(1, lw - 1)
    if kind == "sphere":
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=col, width=lw)
        d.ellipse([cx - R, cy - R * 0.34, cx + R, cy + R * 0.34], outline=col, width=thin)
        d.ellipse([cx - R * 0.38, cy - R, cx + R * 0.38, cy + R], outline=col, width=thin)
    elif kind == "cone":
        d.line([(cx, cy - R), (cx - R * 0.85, cy + R)], fill=col, width=lw)
        d.line([(cx, cy - R), (cx + R * 0.85, cy + R)], fill=col, width=lw)
        d.ellipse([cx - R * 0.85, cy + R - R * 0.24, cx + R * 0.85, cy + R + R * 0.24], outline=col, width=lw)
    elif kind == "torus":
        d.ellipse([cx - R, cy - R * 0.62, cx + R, cy + R * 0.62], outline=col, width=lw)
        d.ellipse([cx - R * 0.42, cy - R * 0.26, cx + R * 0.42, cy + R * 0.26], outline=col, width=lw)
    elif kind == "cube":                                # wireframe box (front + offset back)
        s, dx, dy = R * 1.1, R * 0.5, R * 0.5
        fx0, fy0 = cx - s * 0.62, cy - s * 0.3
        front = [(fx0, fy0), (fx0 + s, fy0), (fx0 + s, fy0 + s), (fx0, fy0 + s)]
        back = [(x + dx, y - dy) for x, y in front]
        d.polygon(front, outline=col, width=lw)
        d.polygon(back, outline=col, width=thin)
        for (a, b) in zip(front, back):
            d.line([a, b], fill=col, width=thin)
    elif kind == "cylinder":
        rx, ry, top, bot = R * 0.7, R * 0.22, cy - R * 0.7, cy + R * 0.7
        d.line([(cx - rx, top), (cx - rx, bot)], fill=col, width=lw)
        d.line([(cx + rx, top), (cx + rx, bot)], fill=col, width=lw)
        d.ellipse([cx - rx, bot - ry, cx + rx, bot + ry], outline=col, width=lw)
        d.ellipse([cx - rx, top - ry, cx + rx, top + ry], outline=col, width=lw)
    else:                                               # plane — a tilted parallelogram
        p = [(cx - R, cy + R * 0.45), (cx - R * 0.25, cy - R * 0.5),
             (cx + R, cy - R * 0.45), (cx + R * 0.25, cy + R * 0.5)]
        d.polygon(p, outline=col, width=lw)
        d.line([((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2),
                ((p[2][0] + p[3][0]) / 2, (p[2][1] + p[3][1]) / 2)], fill=col, width=thin)
    _label(d, w, h, label, accent)
    (WORK / "crops").mkdir(parents=True, exist_ok=True)
    img.save(WORK / "crops" / f"{name}.webp", "WEBP", quality=90)
    return f"crops/{name}.webp"


# ------------------------------------------------------------------ layout
def grid(n, cols, area, gap=0.014):
    x0, y0, x1, y1 = area
    rows = math.ceil(n / cols)
    cw = (x1 - x0 - gap * (cols - 1)) / cols
    ch = (y1 - y0 - gap * (rows - 1)) / rows
    out = []
    for i in range(n):
        r, c = divmod(i, cols)
        bx0, by0 = x0 + c * (cw + gap), y0 + r * (ch + gap)
        out.append([round(bx0, 4), round(by0, 4), round(bx0 + cw, 4), round(by0 + ch, 4)])
    return out


# ------------------------------------------------------------------ element factory
def el(eid, bbox, crop, *, entrance=None, idle=None, etype="image", extra=None):
    d = {
        "id": eid, "type": etype, "role": "figure", "name": eid, "text": "",
        "bbox": bbox, "crop": crop, "cropBbox": None, "z": 2, "cleanup": "none",
        "fillColor": None, "patch": None,
        "entrance": entrance or {"type": "fadeIn", "delay": 0.1, "duration": 0.7, "ease": "power2.out"},
        "idle": idle or [], "parallax": 0.04, "lines": None, "rig": None,
        "blendMode": None, "opacity": 1, "hidden": False,
    }
    if extra:
        d.update(extra)
    return d


# ------------------------------------------------------------------ slide builders
def slide_entrances():
    demos = [
        ("fadeIn", "Fade in"), ("fadeUp", "Fade up"), ("fadeDown", "Fade down"),
        ("fadeLeft", "Fade left"), ("fadeRight", "Fade right"), ("scaleIn", "Scale in"),
        ("maskReveal", "Mask reveal"), ("blurIn", "Blur in"), ("drawOn", "Draw on"),
        ("staggerText", "Stagger"), ("rotateIn", "Rotate in"), ("scaleIn3D", "Scale 3D"),
    ]
    boxes = grid(len(demos), 4, (0.04, 0.20, 0.96, 0.95))
    els = []
    for i, ((etype, label), bbox) in enumerate(zip(demos, boxes)):
        accent = PALETTE[i % len(PALETTE)]
        crop = tile(f"ent_{etype}", label, accent, "shape", bbox)
        els.append(el(f"ent_{etype}", bbox, crop, entrance={
            "type": etype, "delay": 0.25 + i * 0.22, "duration": 0.8, "ease": "power3.out",
        }))
    return {"id": "s01", "index": 0,
            "background": {"src": "slides_webp/slide_01.webp", "idle": None}, "elements": els}


def slide_idles():
    demos = [
        ("float", "Float", "shape", {"amplitude": 0.04, "period": 3}),
        ("breath", "Breath", "rings", {"amount": 0.05, "period": 3.5}),
        ("pulse", "Pulse", "glow", {"amount": 0.4, "period": 2}),
        ("sway", "Sway", "shape", {"degrees": 5, "period": 3}),
        ("shimmer", "Shimmer", "rings", {"amount": 0.5, "period": 2.5}),
        ("wave", "Wave", "grid", {"amplitude": 0.03, "speed": 0.7, "axis": "y"}),
        ("meshWave", "Mesh wave", "grid", {"amplitude": 0.03, "speed": 0.6}),
        ("ripple", "Ripple", "grid", {"amplitude": 0.014, "speed": 0.5, "waves": 3}),
        ("swirl", "Swirl", "grid", {"degrees": 14, "speed": 0.5, "radius": 0.8}),
        ("glow", "Glow", "glow", {"amount": 0.6, "period": 2}),
    ]
    boxes = grid(len(demos), 5, (0.04, 0.20, 0.96, 0.95))
    els = []
    for i, ((itype, label, pat, params), bbox) in enumerate(zip(demos, boxes)):
        accent = PALETTE[i % len(PALETTE)]
        if itype == "glow":
            params = {**params, "color": "#%02x%02x%02x" % accent}
        crop = tile(f"idle_{itype}", label, accent, pat, bbox)
        els.append(el(f"idle_{itype}", bbox, crop,
                      entrance={"type": "scaleIn", "delay": 0.1 + i * 0.05, "duration": 0.6, "ease": "back.out(1.3)"},
                      idle=[{"type": itype, **params}]))
    return {"id": "s02", "index": 1,
            "background": {"src": "slides_webp/slide_02.webp", "idle": None}, "elements": els}


def slide_particles():
    demos = [
        ("sparkle", "Sparkle", "star", "#ffd86b"),
        ("snow", "Snow", "dot", "#ffffff"),
        ("embers", "Embers", "triangle", "#ff7a2a"),
        ("floatUp", "Float up", "circle", "#bfe0ff"),
        ("bubbles", "Bubbles", "ring", "#aad8ff"),
    ]
    boxes = grid(len(demos), 5, (0.04, 0.22, 0.96, 0.93))
    els = []
    for i, ((preset, label, shape, color), bbox) in enumerate(zip(demos, boxes)):
        accent = PALETTE[i % len(PALETTE)]
        crop = tile(f"par_{preset}", label, accent, "shape", bbox)
        els.append(el(f"par_{preset}", bbox, crop,
                      entrance={"type": "fadeIn", "delay": 0.1 + i * 0.08, "duration": 0.7},
                      idle=[{"type": "particles", "preset": preset, "shape": shape, "size": 1.1, "color": color}]))
    return {"id": "s03", "index": 2,
            "background": {"src": "slides_webp/slide_03.webp", "idle": None}, "elements": els}


def _model_el(eid, kind, bbox, *, clip=None, dur_ms=0, auto=0, color=(120, 180, 240)):
    crop = model_tile(eid, kind.capitalize(), color, kind, bbox)
    m3d = {"clip": clip, "loop": True, "durationMs": dur_ms, "autoRotate": auto,
           "camera": {"fov": 45}, "transform": {"rot": [0.35, 0.6, 0], "scale": [1, 1, 1]},
           "previewSrc": None, "sourceXml": None}
    return el(eid, bbox, crop, etype="model3d",
              entrance={"type": "scaleIn", "delay": 0.2, "duration": 0.9, "ease": "back.out(1.4)"},
              extra={"modelSrc": f"models/{kind}.glb", "model3d": m3d, "role": "figure"})


def slide_models():
    # baked-tumble GLBs (clip 0) + auto-rotated static primitives
    animated = [("sphere", 5000, (80, 165, 235)), ("cone", 6000, (235, 165, 55)),
                ("torus", 7000, (210, 175, 50))]
    static = [("cube", (120, 210, 150)), ("cylinder", (220, 120, 200)), ("plane", (120, 180, 240))]
    boxes = grid(6, 3, (0.03, 0.20, 0.97, 0.96))
    els = []
    for i, (kind, dur, col) in enumerate(animated):
        els.append(_model_el(kind, kind, boxes[i], clip=0, dur_ms=dur, color=col))
    for j, (kind, col) in enumerate(static):
        els.append(_model_el(kind, kind, boxes[3 + j], clip=None, auto=36, color=col))
    return {"id": "s04", "index": 3,
            "background": {"src": "slides_webp/slide_04.webp", "idle": None}, "elements": els}


# ------------------------------------------------------------------ assemble
def _ensure_models():
    (WORK / "models").mkdir(parents=True, exist_ok=True)
    # animated tumble GLBs (generated by make_sample_glb.mjs default run)
    for g in ("sphere.glb", "cone.glb", "torus.glb"):
        src = SAMPLE_MODELS / g
        if not src.exists():
            raise SystemExit("Run `node skull_studio/make_sample_glb.mjs` first (sample/models/*.glb missing).")
        shutil.copyfile(src, WORK / "models" / g)
    # static primitives for the auto-rotate tiles
    for kind, color in (("cube", "#78d296"), ("cylinder", "#dc78c8"), ("plane", "#78b4f0")):
        out = WORK / "models" / f"{kind}.glb"
        subprocess.run(["node", str(GLB_SCRIPT), "one", kind, color, str(out)],
                       check=True, stdout=subprocess.DEVNULL)


def main():
    WORK.mkdir(exist_ok=True)
    _ensure_models()
    background(1, "Entrances", "Every entrance type — staggered as the slide enters")
    background(2, "Idle loops", "Looping ambient motion: transforms, mesh warps, and glow")
    background(3, "Particles", "Emitters: presets × shapes × colour (HTML + baked video)")
    background(4, "3D models", "Live three.js — baked tumble and auto-rotate, exports to PPTX")

    slides = [slide_entrances(), slide_idles(), slide_particles(), slide_models()]
    manifest = {
        "version": "1.0",
        "meta": {"title": "Skull Studio — feature showcase", "sourcePptx": "(generated)",
                 "docId": "deck-showcase"},
        "deck": {"designWidth": W, "designHeight": H, "pixelScale": 2.0, "background": "#0b0b10",
                 "transition": {"type": "crossfade", "duration": 0.8, "ease": "power2.inOut"},
                 "navigation": {"keyboard": True, "click": True}},
        "slides": slides,
    }
    (WORK / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    n = sum(len(s["elements"]) for s in slides)
    print(f"Showcase deck -> {WORK / 'manifest.json'}  ({len(slides)} slides, {n} elements)")


if __name__ == "__main__":
    main()
