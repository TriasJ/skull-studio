"""Generate a tiny original 3D sample deck (one slide, three primitives).

Run `node skull_studio/make_sample_glb.mjs` first to create sample/models/*.glb,
then this to assemble a ready-to-build project in work/:
    python -m skull_studio.make_sample_3d
    node skull_studio/build.mjs            # dist/presentation.html (live 3D)
    python -m skull_studio.export_pptx dist/sample3d.pptx   # round-trip test

Everything here is our own content (drawn previews + generated GLBs); nothing is
copied from PowerPoint. The models carry no `sourceXml`, so exporting this deck
exercises the regenerated-am3d path of the PPTX exporter.
"""
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
SAMPLE_MODELS = ROOT / "sample" / "models"
W, H = 1280, 720
GOLD, INK = (201, 162, 39), (11, 11, 16)


def _font(sz):
    for name in ("seguisb.ttf", "segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def _centered(d, cx, y, text, font, fill):
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((cx - (r - l) / 2, y), text, font=font, fill=fill)


def background():
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    for y in range(H):                                  # subtle vertical gradient
        k = y / H
        d.line([(0, y), (W, y)], fill=(int(11 + 9 * k), int(11 + 9 * k), int(16 + 14 * k)))
    d.rectangle([18, 18, W - 18, H - 18], outline=(60, 54, 30), width=1)
    _centered(d, W / 2, 40, "Skull Studio", _font(54), GOLD)
    _centered(d, W / 2, 104, "3D models  ·  imported, animated, exported", _font(22), (170, 170, 180))
    d.text((W - 150, H - 40), "Skull Studio", font=_font(16), fill=(90, 90, 100))
    (WORK / "slides_webp").mkdir(parents=True, exist_ok=True)
    img.save(WORK / "slides_webp" / "slide_01.webp", "WEBP", quality=82)


def icon(kind, color, name):
    """A simple drawn preview tile (shown until the live GLB loads)."""
    w, h = 420, 470
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy, r = w // 2, h // 2 - 20, 130
    if kind == "sphere":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=4)
        for k in (0.45, 0.8):
            d.ellipse([cx - r, cy - r * k, cx + r, cy + r * k], outline=color, width=2)
        d.line([cx, cy - r, cx, cy + r], fill=color, width=2)
    elif kind == "cone":
        d.polygon([(cx, cy - r), (cx - r, cy + r), (cx + r, cy + r)], outline=color, width=4)
        d.ellipse([cx - r, cy + r - 26, cx + r, cy + r + 26], outline=color, width=3)
    else:  # torus
        d.ellipse([cx - r, cy - r * 0.6, cx + r, cy + r * 0.6], outline=color, width=4)
        d.ellipse([cx - r * 0.45, cy - r * 0.28, cx + r * 0.45, cy + r * 0.28], outline=color, width=3)
    _centered(d, cx, cy + r + 36, name, _font(30), (225, 225, 230))
    (WORK / "crops").mkdir(parents=True, exist_ok=True)
    img.save(WORK / "crops" / f"{kind}.webp", "WEBP", quality=90)


def model_el(kind, bbox, clip_name, dur_ms):
    return {
        "id": kind, "type": "model3d", "role": "figure", "name": clip_name,
        "text": clip_name, "bbox": bbox, "crop": f"crops/{kind}.webp", "cropBbox": None,
        "z": 2, "cleanup": "none", "fillColor": None, "patch": None,
        "entrance": {"type": "scaleIn", "delay": 0.2, "duration": 0.9, "ease": "back.out(1.4)"},
        "idle": [], "parallax": 0.05, "lines": None, "rig": None,
        "blendMode": None, "opacity": 1, "hidden": False,
        "modelSrc": f"models/{kind}.glb",
        # play the GLB's baked 3-axis "tumble" clip (loops); also round-trips to PPTX
        "model3d": {"clip": 0, "loop": True, "durationMs": dur_ms, "autoRotate": 0,
                    "camera": {"fov": 32}, "transform": {"rot": [0.35, 0.6, 0], "scale": [1, 1, 1]},
                    "previewSrc": None, "sourceXml": None},
    }


def main():
    if not (SAMPLE_MODELS / "sphere.glb").exists():
        raise SystemExit("Run `node skull_studio/make_sample_glb.mjs` first (sample/models/*.glb missing).")
    WORK.mkdir(exist_ok=True)
    (WORK / "models").mkdir(parents=True, exist_ok=True)
    for g in ("sphere.glb", "cone.glb", "torus.glb"):
        shutil.copyfile(SAMPLE_MODELS / g, WORK / "models" / g)

    background()
    icon("sphere", (80, 165, 235), "Sphere")
    icon("cone", (235, 165, 55), "Cone")
    icon("torus", (210, 175, 50), "Torus")

    manifest = {
        "version": "1.0",
        "meta": {"title": "Skull Studio 3D sample", "sourcePptx": "(generated)",
                 "docId": "deck-sample3d"},
        "deck": {"designWidth": W, "designHeight": H, "pixelScale": 2.0, "background": "#0b0b10",
                 "transition": {"type": "crossfade", "duration": 0.8, "ease": "power2.inOut"},
                 "navigation": {"keyboard": True, "click": True}},
        "slides": [{
            "id": "s01", "index": 0,
            "background": {"src": "slides_webp/slide_01.webp", "idle": None},
            "elements": [   # durations match the baked clips in make_sample_glb.mjs
                model_el("sphere", [0.06, 0.30, 0.32, 0.82], "Sphere", 5000),
                model_el("cone", [0.375, 0.28, 0.625, 0.85], "Cone", 6000),
                model_el("torus", [0.68, 0.30, 0.94, 0.82], "Torus", 7000),
            ],
        }],
    }
    (WORK / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"3D sample deck -> {WORK / 'manifest.json'}  (3 models: sphere, cone, torus)")


if __name__ == "__main__":
    main()
