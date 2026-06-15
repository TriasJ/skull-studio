"""One-command pipeline: PDF of slide images -> animated single-file HTML.

  python -m skull_studio.pipeline MyDeck.pdf [options]

Options:
  --skip-mineru     no OCR/layout pass (backgrounds + ken burns only; add
                    elements by hand in work/manifest.json or via the editor)
  --no-choreo       keep the draft manifest untouched (no auto animations)
  --bg-quality N    background WebP quality (default 78)
  --out PATH        output html (default dist/presentation.html)

Produces dist/presentation.html AND dist/editor.html (same deck, boots into
Editor Mode). Review work/debug/overlay_NN.png to fix segmentation by editing
work/manifest.json, then re-run from step "crops":
  python -m skull_studio.crop_and_patch && node skull_studio/build.mjs
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent          # the skull_studio package dir
ROOT = SCRIPTS.parent                               # repo root (holds runtime/, work/)
WORK = ROOT / "work"
sys.path.insert(0, str(SCRIPTS))

import extract  # noqa: E402
import extract_pptx  # noqa: E402
import extract_ocr  # noqa: E402  (lightweight RapidOCR draft)


def step(name):
    print(f"\n=== {name} " + "=" * max(0, 50 - len(name)))


def run(cmd, **kw):
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def minimal_manifest(pdf: Path):
    """Degraded path when MinerU is unavailable: backgrounds only."""
    import hashlib
    sizes = json.loads((WORK / "page_sizes.json").read_text())
    manifest = {
        "version": "1.0",
        "meta": {"title": pdf.stem.replace("_", " "), "sourcePdf": pdf.name,
                 "docId": "deck-" + hashlib.sha1(pdf.read_bytes()).hexdigest()[:8]},
        "deck": {"designWidth": round(sizes[0][0]), "designHeight": round(sizes[0][1]),
                 "pixelScale": extract.SCALE, "background": "#000000",
                 "transition": {"type": "crossfade", "duration": 0.9, "ease": "power2.inOut"},
                 "navigation": {"keyboard": True, "click": True}},
        "slides": [{"id": f"s{i+1:02d}", "index": i,
                    "background": {"src": f"slides_webp/slide_{i+1:02d}.webp", "idle": None},
                    "elements": []} for i in range(len(sizes))],
    }
    (WORK / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"minimal manifest: {len(sizes)} slides, 0 elements")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--ocr", choices=("mineru", "rapid", "none"), default="mineru",
                    help="text recovery: mineru (full layout, ~GB) | rapid (RapidOCR, "
                         "bundled, text-only) | none (backgrounds only)")
    ap.add_argument("--skip-mineru", action="store_true", help="alias for --ocr none")
    ap.add_argument("--no-choreo", action="store_true")
    ap.add_argument("--bg-quality", type=int, default=78)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--out", default="dist/presentation.html")
    a = ap.parse_args()
    if a.skip_mineru:
        a.ocr = "none"
    src = a.pdf.resolve()
    if not src.exists():
        sys.exit(f"not found: {src}")
    WORK.mkdir(exist_ok=True)
    is_pptx = src.suffix.lower() == ".pptx"

    if is_pptx:
        step("1/7 render slides (LibreOffice + PyMuPDF)")
        extract_pptx.render(src)
        pdf = WORK / "pptx" / (src.stem + ".pdf")
        if a.ocr == "none":
            step("2/7 OCR (skipped) + 3/7 shapes-only manifest")
            minimal_manifest(src)
        elif a.ocr == "rapid":
            step("2/7 RapidOCR (lightweight) + 3/7 text + shapes")
            extract_ocr.draft(pdf)
        else:
            step("2/7 MinerU OCR on slides")
            try:
                extract_pptx.mineru(src)
            except Exception as e:
                print(f"WARN MinerU failed ({e}); shapes-only")
                minimal_manifest(src)
            step("3/7 merge OCR + shapes -> manifest")
        extract_pptx.draft(src)  # always merge real pptx shapes onto the manifest
    else:
        step("1/7 render pages")
        extract.render(src)
        if a.ocr == "none":
            step("2/7 OCR (skipped) + 3/7 minimal manifest")
            minimal_manifest(src)
        elif a.ocr == "rapid":
            step("2/7 RapidOCR (lightweight) + 3/7 draft manifest")
            extract_ocr.draft(src)
        else:
            step("2/7 MinerU layout/OCR")
            try:
                extract.run_mineru(src)
            except Exception as e:
                print(f"WARN MinerU failed ({e}); continuing background-only")
                minimal_manifest(src)
            else:
                step("3/7 draft manifest")
                extract.draft(src)

    if not a.no_choreo:
        step("4/7 auto choreography")
        run([sys.executable, SCRIPTS / "auto_choreo.py"])

    step("5/7 debug overlays (for review)")
    run([sys.executable, SCRIPTS / "debug_overlay.py"])

    step("6/7 crops + patches + webp")
    run([sys.executable, SCRIPTS / "crop_and_patch.py", "--bg-quality", a.bg_quality])
    run([sys.executable, SCRIPTS / "validate_manifest.py"])

    if a.no_build:
        print("\n(skipping build per --no-build)")
        return
    step("7/7 build (presentation + standalone editor)")
    run(["node", SCRIPTS / "build.mjs", "--out", a.out])
    run(["node", SCRIPTS / "build.mjs", "--editor"])

    print("\nDone:")
    print(f"  {ROOT / a.out}   <- share this")
    print(f"  {ROOT / 'dist' / 'editor.html'}   <- open to edit animations")
    print(f"  Review {WORK / 'debug'} overlays and edit work/manifest.json to refine, then:")
    print("    python -m skull_studio.crop_and_patch && node skull_studio/build.mjs")
    print("  Or just run 'skull-studio' and edit in the browser.")


if __name__ == "__main__":
    main()
