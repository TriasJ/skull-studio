"""Export one element's static raster (its crop) as PNG or JPG.

  python -m skull_studio.export_element <element-id> <png|jpg>

PNG keeps transparency; JPG flattens over the deck background colour. Writes
work/export/<id>.<fmt> (served back to the editor for download).
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"


def main(el_id: str, fmt: str) -> None:
    m = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    el = next((e for s in m["slides"] for e in s["elements"] if e["id"] == el_id), None)
    if not el:
        sys.exit(f"element not found: {el_id}")
    crop = WORK / (el.get("crop") or "")
    if not crop.exists():
        sys.exit(f"crop missing on disk: {crop} (Re-crop first)")
    img = Image.open(crop).convert("RGBA")
    out_dir = WORK / "export"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{el_id}.{fmt}"
    if fmt == "jpg":
        hexc = (m.get("deck", {}).get("background") or "#000000").lstrip("#")
        rgb = tuple(int(hexc[i:i + 2], 16) for i in (0, 2, 4)) if len(hexc) >= 6 else (0, 0, 0)
        canvas = Image.new("RGB", img.size, rgb)
        canvas.paste(img, (0, 0), img)
        canvas.save(out, "JPEG", quality=92, optimize=True)
    else:
        img.save(out, "PNG")
    print(out.name)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in ("png", "jpg"):
        sys.exit("usage: export_element.py <element-id> <png|jpg>")
    main(sys.argv[1], sys.argv[2])
