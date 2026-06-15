"""Lightweight OCR draft (RapidOCR) — a no-big-download alternative to MinerU.

Runs the already-bundled RapidOCR (rapidocr-onnxruntime, the same engine the editor
uses for region OCR) over the rendered slide PNGs and emits TEXT elements in the exact
manifest shape `extract.draft()` produces. It recovers text + boxes, grouped into
blocks in top->bottom reading order.

It does NOT do layout analysis: no figure/table detection. For image regions, draw
them by hand in the editor; PPTX picture shapes are still detected separately by
`extract_pptx`. Models ship inside the wheel (tens of MB) — no ~GB download, no
network, no system binary.

Usage (after the render stage):
  python -m skull_studio.extract_ocr <pdf>
"""
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract  # reuse ROOT/WORK/SCALE and the render contract

ROOT, WORK, SCALE = extract.ROOT, extract.WORK, extract.SCALE
_ENGINE = None


def _engine():
    global _ENGINE
    if _ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR
        _ENGINE = RapidOCR()
    return _ENGINE


def _ocr_slide(png: Path):
    """Return detected text lines as normalized {x0,y0,x1,y1,text} dicts."""
    import numpy as np
    from PIL import Image
    img = Image.open(png).convert("RGB")
    w, h = img.size
    result, _ = _engine()(np.asarray(img))
    lines = []
    for box, text, _score in (result or []):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        t = (text or "").strip()
        if t:
            lines.append({"x0": min(xs) / w, "y0": min(ys) / h,
                          "x1": max(xs) / w, "y1": max(ys) / h, "text": t})
    return lines


def _merge_blocks(lines):
    """Greedily merge vertically-adjacent, horizontally-overlapping lines (in reading
    order) into paragraph-ish blocks — closer to MinerU's blocks than raw OCR lines."""
    if not lines:
        return []
    lines = sorted(lines, key=lambda l: (round(l["y0"], 3), l["x0"]))
    hs = sorted(l["y1"] - l["y0"] for l in lines)
    lh = hs[len(hs) // 2] or 0.02                      # median line height
    blocks = []
    for l in lines:
        b = blocks[-1] if blocks else None
        x_overlap = b and (min(b["x1"], l["x1"]) - max(b["x0"], l["x0"])) > 0
        gap = (l["y0"] - b["y1"]) if b else 1.0
        if b and x_overlap and -0.5 * lh <= gap <= 0.8 * lh:
            b["x0"], b["y0"] = min(b["x0"], l["x0"]), min(b["y0"], l["y0"])
            b["x1"], b["y1"] = max(b["x1"], l["x1"]), max(b["y1"], l["y1"])
            b["text"] += "\n" + l["text"]
        else:
            blocks.append(dict(l))
    return blocks


def draft(pdf_path: Path) -> None:
    page_sizes = json.loads((WORK / "page_sizes.json").read_text())
    n = len(page_sizes)
    slides = [{"id": f"s{i + 1:02d}", "index": i,
               "background": {"src": f"slides_webp/slide_{i + 1:02d}.webp", "idle": None},
               "elements": []} for i in range(n)]
    total = 0
    for i in range(n):
        png = WORK / "slides" / f"slide_{i + 1:02d}.png"
        if not png.exists():
            continue
        blocks = _merge_blocks(_ocr_slide(png))
        blocks.sort(key=lambda b: (round(b["y0"], 3), b["x0"]))   # reading order
        c = 0
        for b in blocks:
            norm = [round(min(max(v, 0.0), 1.0), 4) for v in (b["x0"], b["y0"], b["x1"], b["y1"])]
            if norm[2] - norm[0] < 0.005 or norm[3] - norm[1] < 0.005:
                continue
            c += 1
            eid = f"s{i + 1:02d}_e{c:02d}"
            slides[i]["elements"].append({
                "id": eid, "type": "text", "role": "title" if norm[1] < 0.18 else "body",
                "text": b["text"][:300],
                "bbox": norm, "crop": f"crops/{eid}.webp", "cropBbox": None,
                "z": c, "cleanup": "none", "fillColor": None, "patch": None,
                "entrance": {"type": "fadeIn", "delay": 0.2, "duration": 0.8, "ease": "power2.out"},
                "idle": [], "parallax": 0.0, "lines": None, "rig": None,
            })
        total += c
        print(f"  slide {i + 1:02d}: {c} text blocks")

    doc_id = "deck-" + hashlib.sha1(pdf_path.read_bytes()).hexdigest()[:8]
    manifest = {
        "version": "1.0",
        "meta": {"title": re.sub(r"[_-]+", " ", pdf_path.stem),
                 "sourcePdf": pdf_path.name, "docId": doc_id},
        "deck": {"designWidth": round(page_sizes[0][0]), "designHeight": round(page_sizes[0][1]),
                 "pixelScale": SCALE, "background": "#000000",
                 "transition": {"type": "crossfade", "duration": 0.9, "ease": "power2.inOut"},
                 "navigation": {"keyboard": True, "click": True}},
        "slides": slides,
    }
    (WORK / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"RapidOCR draft: {n} slides, {total} text blocks -> {WORK / 'manifest.json'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    draft(Path(sys.argv[1]).resolve())
