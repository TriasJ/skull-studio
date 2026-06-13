"""Manifest-driven crops + move-away patches + WebP backgrounds.

Reads work/manifest.json (the source of truth - re-run freely after editing it).
  - crops/{id}.webp        element crop, bbox + 6px pad; cropBbox written back
  - patches/{id}_patch.webp  only when cleanup=="blur"
  - cleanup=="fill" stores fillColor (sampled border median) - no file
  - slides_webp/slide_NN.webp  background conversions

Usage: python -m skull_studio.crop_and_patch [--bg-quality 78] [--bg-scale 1.0]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
DEFAULT_BG_QUALITY = 78
PAD = 6
RING = 12          # border ring width sampled for fill color
FLAT_STD = 12.0    # below this stddev the surround counts as flat -> fill


def px_box(bbox, W, H, pad=0):
    x0 = max(0, round(bbox[0] * W) - pad)
    y0 = max(0, round(bbox[1] * H) - pad)
    x1 = min(W, round(bbox[2] * W) + pad)
    y1 = min(H, round(bbox[3] * H) + pad)
    return x0, y0, x1, y1


def border_ring_stats(img_arr, box):
    x0, y0, x1, y1 = box
    H, W = img_arr.shape[:2]
    ox0, oy0 = max(0, x0 - RING), max(0, y0 - RING)
    ox1, oy1 = min(W, x1 + RING), min(H, y1 + RING)
    outer = img_arr[oy0:oy1, ox0:ox1].astype(np.float32)
    mask = np.ones(outer.shape[:2], bool)
    mask[(y0 - oy0):(y1 - oy0), (x0 - ox0):(x1 - ox0)] = False
    ring = outer[mask]
    if ring.size == 0:
        return np.array([0, 0, 0]), 999.0
    return np.median(ring, axis=0), float(ring.std(axis=0).mean())


def element_mask(el, box, W, H, size):
    """Alpha mask from base shape (polygon, else full box) +/- boolean regions.

    regions: [{"op": "add"|"sub", "pts": [[x,y], ...]}] - normalized page coords.
    Returns None when the element is a plain rectangle (no masking needed)."""
    if not el.get("polygon") and not el.get("regions"):
        return None
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    to_local = lambda pts: [((px * W) - box[0], (py * H) - box[1]) for px, py in pts]
    if el.get("polygon"):
        d.polygon(to_local(el["polygon"]), fill=255)
    else:
        d.rectangle([0, 0, size[0], size[1]], fill=255)
    for r in el.get("regions") or []:
        pts = to_local(r["pts"])
        if len(pts) >= 3:
            d.polygon(pts, fill=255 if r.get("op") == "add" else 0)
    return mask.filter(ImageFilter.GaussianBlur(2))


def process(args):
    manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    # editor-set options (Options menu) override script defaults; CLI overrides both
    bo = manifest.get("deck", {}).get("buildOptions") or {}
    if args.bg_quality == DEFAULT_BG_QUALITY and "bgQuality" in bo:
        args.bg_quality = int(bo["bgQuality"])
    if args.bg_scale == 1.0 and "bgScale" in bo:
        args.bg_scale = float(bo["bgScale"])
    crops_dir, patch_dir, bg_dir = WORK / "crops", WORK / "patches", WORK / "slides_webp"
    for d in (crops_dir, patch_dir, bg_dir):
        d.mkdir(exist_ok=True)

    n_crops = n_fill = n_blur = 0
    for slide in manifest["slides"]:
        src_png = WORK / "slides" / f"slide_{slide['index'] + 1:02d}.png"
        img = Image.open(src_png).convert("RGB")
        W, H = img.size
        arr = None  # lazy

        # background webp
        bg = img if args.bg_scale == 1.0 else img.resize(
            (round(W * args.bg_scale), round(H * args.bg_scale)), Image.LANCZOS)
        bg.save(bg_dir / f"slide_{slide['index'] + 1:02d}.webp",
                "WEBP", quality=args.bg_quality, method=6)

        for el in slide["elements"]:
            box = px_box(el["bbox"], W, H, PAD)
            q = {"text": 92, "shape": 92}.get(el["type"], 85)
            crop = img.crop(box)
            mask = element_mask(el, box, W, H, crop.size)
            if mask is not None:
                crop = crop.convert("RGBA")
                crop.putalpha(mask)
            crop.save(crops_dir / f"{el['id']}.webp", "WEBP", quality=q, method=6)
            el["crop"] = f"crops/{el['id']}.webp"
            el["cropBbox"] = [round(box[0] / W, 4), round(box[1] / H, 4),
                              round(box[2] / W, 4), round(box[3] / H, 4)]
            n_crops += 1

            if el.get("cleanup") in ("fill", "blur", "auto"):
                # explicit editor choices win; only "auto" gets border sampling
                mode = el["cleanup"]
                if mode == "fill" and el.get("fillColor"):
                    el["patch"] = None
                    n_fill += 1
                    continue
                if mode != "blur":
                    if arr is None:
                        arr = np.asarray(img)
                    color, std = border_ring_stats(arr, box)
                if mode != "blur" and (std < FLAT_STD or mode == "fill"):
                    el["cleanup"] = "fill"
                    el["fillColor"] = "#{:02x}{:02x}{:02x}".format(*[int(c) for c in color])
                    el["patch"] = None
                    n_fill += 1
                else:
                    el["cleanup"] = "blur"
                    radius = int(el.get("blurRadius") or 40)
                    ex = px_box(el["bbox"], W, H, max(radius, 12))
                    patch = img.crop(ex).filter(ImageFilter.GaussianBlur(radius))
                    inner = (box[0] - ex[0], box[1] - ex[1],
                             box[0] - ex[0] + (box[2] - box[0]),
                             box[1] - ex[1] + (box[3] - box[1]))
                    patch = patch.crop(inner)
                    patch.save(patch_dir / f"{el['id']}_patch.webp", "WEBP", quality=80, method=6)
                    el["patch"] = f"patches/{el['id']}_patch.webp"
                    el["fillColor"] = None
                    n_blur += 1
            else:
                el["fillColor"] = None
                el["patch"] = None

    (WORK / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"crops: {n_crops}  fill-patches: {n_fill}  blur-patches: {n_blur}")
    print("backgrounds ->", bg_dir)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg-quality", type=int, default=DEFAULT_BG_QUALITY)
    ap.add_argument("--bg-scale", type=float, default=1.0)
    process(ap.parse_args())
