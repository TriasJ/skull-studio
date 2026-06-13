"""Draw numbered element bboxes on each slide render -> work/debug/overlay_NN.png

Used by the orchestrator (Claude vision) to review/fix the manifest.
Usage: python -m skull_studio.debug_overlay
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
COLORS = {"text": (80, 200, 255), "image": (255, 120, 80), "shape": (180, 255, 100)}


def main():
    manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    out = WORK / "debug"
    out.mkdir(exist_ok=True)
    try:
        font = ImageFont.truetype("arial.ttf", 36)
    except OSError:
        font = ImageFont.load_default()

    for slide in manifest["slides"]:
        n = slide["index"] + 1
        img = Image.open(WORK / "slides" / f"slide_{n:02d}.png").convert("RGB")
        # half-size overlays are plenty for review and easier on vision context
        img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
        W, H = img.size
        draw = ImageDraw.Draw(img)
        for el in slide["elements"]:
            x0, y0, x1, y1 = [el["bbox"][k] * (W if k % 2 == 0 else H) for k in range(4)]
            color = COLORS.get(el["type"], (255, 255, 0))
            draw.rectangle([x0, y0, x1, y1], outline=color, width=3)
            label = el["id"].split("_")[-1] + " " + el["type"][:3]
            tb = draw.textbbox((x0 + 4, y0 + 2), label, font=font)
            draw.rectangle(tb, fill=(0, 0, 0))
            draw.text((x0 + 4, y0 + 2), label, fill=color, font=font)
        img.save(out / f"overlay_{n:02d}.png")
        print(f"overlay_{n:02d}.png  ({len(slide['elements'])} elements)")


if __name__ == "__main__":
    main()
