"""Stage 1: render PDF pages, run MinerU layout/OCR, emit draft manifest.

Usage:
  python -m skull_studio.extract render  <pdf>          # -> work/slides/slide_NN.png (2x)
  python -m skull_studio.extract mineru  <pdf>          # -> work/mineru/** (subprocess, slow on first run)
  python -m skull_studio.extract draft   <pdf>          # -> work/manifest.json from MinerU output
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
SCALE = 2.0


def render(pdf_path: Path) -> None:
    out = WORK / "slides"
    out.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf_path)
    sizes = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), alpha=False)
        dest = out / f"slide_{i + 1:02d}.png"
        pix.save(dest)
        sizes.append([page.rect.width, page.rect.height])
        print(f"  {dest.name}  {pix.width}x{pix.height}")
        pix = None
    (WORK / "page_sizes.json").write_text(json.dumps(sizes))
    print(f"Rendered {len(doc)} pages at {SCALE}x")
    doc.close()


def run_mineru(pdf_path: Path) -> None:
    # Prefer the isolated uv-tool env: the global install is prone to
    # transformers/tokenizers version conflicts (seen on this machine).
    if shutil.which("uv"):
        prefix = ["uv", "tool", "run", "--from", "mineru[core]", "mineru"]
    elif shutil.which("mineru"):
        prefix = ["mineru"]
    else:
        sys.exit("Neither uv nor mineru on PATH. Fix: uv tool install \"mineru[core]\"")
    cmd = prefix + ["-p", str(pdf_path), "-o", str(WORK / "mineru"),
                    "-m", "ocr", "-l", "latin", "-b", "pipeline", "-d", "cpu",
                    "-f", "false", "-t", "false"]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def _find(pattern: str) -> Path | None:
    hits = sorted((WORK / "mineru").rglob(pattern))
    return hits[0] if hits else None


def draft(pdf_path: Path) -> None:
    content_path = _find("*content_list.json")
    if not content_path:
        sys.exit("No content_list.json under work/mineru/ - run the mineru stage first.")
    content = json.loads(content_path.read_text(encoding="utf-8"))

    page_sizes = json.loads((WORK / "page_sizes.json").read_text())
    middle_path = _find("*middle.json")
    if middle_path:
        middle = json.loads(middle_path.read_text(encoding="utf-8"))
        ms = [p.get("page_size") for p in middle.get("pdf_info", [])]
        if all(ms):
            page_sizes = ms

    n_pages = len(page_sizes)
    slides = [{"id": f"s{i + 1:02d}", "index": i,
               "background": {"src": f"slides_webp/slide_{i + 1:02d}.webp", "idle": None},
               "elements": []} for i in range(n_pages)]

    # Unit detection: MinerU 3.3.x content_list bboxes are 0-1000 normalized
    # per axis. Detect: any bbox coordinate exceeds its axis page dimension
    # (impossible in page units) while the global max stays <= 1000.
    all_boxes = [i["bbox"] for i in content if i.get("bbox") and i.get("page_idx", 0) < n_pages]
    global_max = max((max(b) for b in all_boxes), default=0)
    exceeds_page = any(
        b[1] > page_sizes[i.get("page_idx", 0)][1] or b[3] > page_sizes[i.get("page_idx", 0)][1]
        or b[0] > page_sizes[i.get("page_idx", 0)][0] or b[2] > page_sizes[i.get("page_idx", 0)][0]
        for i, b in ((it, it["bbox"]) for it in content
                     if it.get("bbox") and it.get("page_idx", 0) < n_pages)
    )
    permille = exceeds_page and global_max <= 1000.5
    if permille:
        print("  bbox units: 0-1000 normalized (detected)")

    counters = [0] * n_pages
    for item in content:
        pg = item.get("page_idx", 0)
        if pg >= n_pages or "bbox" not in item or not item["bbox"]:
            continue
        pw, ph = page_sizes[pg]
        bbox = list(item["bbox"])
        if permille:
            norm = [round(v / 1000, 4) for v in bbox]
        else:
            norm = [round(bbox[0] / pw, 4), round(bbox[1] / ph, 4),
                    round(bbox[2] / pw, 4), round(bbox[3] / ph, 4)]
        norm = [min(max(v, 0.0), 1.0) for v in norm]
        if norm[2] - norm[0] < 0.005 or norm[3] - norm[1] < 0.005:
            continue
        counters[pg] += 1
        etype = item.get("type", "text")
        if etype not in ("text", "image"):
            etype = "image" if etype in ("table", "equation") else "text"
        role = "title" if item.get("text_level") == 1 else (
            "figure" if etype == "image" else "body")
        eid = f"s{pg + 1:02d}_e{counters[pg]:02d}"
        slides[pg]["elements"].append({
            "id": eid, "type": etype, "role": role,
            "text": (item.get("text") or "").strip()[:300],
            "bbox": norm, "crop": f"crops/{eid}.webp", "cropBbox": None,
            "z": counters[pg], "cleanup": "none", "fillColor": None, "patch": None,
            "entrance": {"type": "fadeIn", "delay": 0.2, "duration": 0.8, "ease": "power2.out"},
            "idle": [], "parallax": 0.0, "lines": None, "rig": None,
        })

    doc_id = "deck-" + hashlib.sha1(pdf_path.read_bytes()).hexdigest()[:8]
    title = re.sub(r"[_-]+", " ", pdf_path.stem)
    manifest = {
        "version": "1.0",
        "meta": {"title": title, "sourcePdf": pdf_path.name, "docId": doc_id},
        "deck": {"designWidth": round(page_sizes[0][0]), "designHeight": round(page_sizes[0][1]),
                 "pixelScale": SCALE, "background": "#000000",
                 "transition": {"type": "crossfade", "duration": 0.9, "ease": "power2.inOut"},
                 "navigation": {"keyboard": True, "click": True}},
        "slides": slides,
    }
    dest = WORK / "manifest.json"
    dest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(counters)
    print(f"Draft manifest: {n_pages} slides, {total} elements -> {dest}")
    for i, c in enumerate(counters):
        print(f"  slide {i + 1:02d}: {c} elements")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("render", "mineru", "draft"):
        sys.exit(__doc__)
    stage, pdf = sys.argv[1], Path(sys.argv[2]).resolve()
    {"render": render, "mineru": run_mineru, "draft": draft}[stage](pdf)
