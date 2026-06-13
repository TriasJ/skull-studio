"""Generate an original, content-free sample deck so the repo runs out-of-the-box.

Creates sample/demo.pdf - four 16:9 slides of plain titles, bullets and shapes
(no third-party content) you can import in Skull Studio to try the full flow.

    python -m skull_studio.make_sample
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
W, H = 1280, 720  # points, 16:9
BG = (0.04, 0.04, 0.05)
GOLD = (0.79, 0.63, 0.15)
INK = (0.96, 0.94, 0.88)
DIM = (0.6, 0.6, 0.64)

SLIDES = [
    {"title": "Skull Studio", "sub": "PDF / PPTX  ->  interactive animated HTML",
     "bullets": ["Import a slide deck", "Auto-segment text & images",
                 "Animate, rig, and export"], "shape": "spiral"},
    {"title": "Layered, animated slides", "sub": "Every element is independent",
     "bullets": ["Entrances: fade, slide, scale, reveal", "Idle loops: breathe, float, sway",
                 "Mouse parallax depth"], "shape": "stack"},
    {"title": "Mesh & 2D-bone rigging", "sub": "Puppet-warp without a GPU pipeline",
     "bullets": ["Pin an image, keyframe a loop", "Bone chains follow their parent",
                 "Bake to looping video or GIF"], "shape": "grid"},
    {"title": "Export anywhere", "sub": "One project, many outputs",
     "bullets": ["Self-contained HTML", "Editable PowerPoint (.pptx)",
                 "No-WebGL baked HTML"], "shape": "arrows"},
]


def draw_shape(page, kind):
    cx, cy = 940, 380
    if kind == "spiral":
        import math
        pts = []
        for i in range(140):
            a = i * 0.32
            r = 6 + i * 1.5
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        for i in range(len(pts) - 1):
            page.draw_line(pts[i], pts[i + 1], color=GOLD, width=1.5)
    elif kind == "stack":
        for i in range(4):
            o = i * 26
            page.draw_rect(fitz.Rect(cx - 150 + o, cy - 110 + o, cx + 70 + o, cy + 40 + o),
                           color=GOLD, width=1.4)
    elif kind == "grid":
        for gx in range(7):
            page.draw_line((cx - 150 + gx * 50, cy - 150), (cx - 150 + gx * 50, cy + 150), color=GOLD, width=0.8)
        for gy in range(7):
            page.draw_line((cx - 150, cy - 150 + gy * 50), (cx + 150, cy - 150 + gy * 50), color=GOLD, width=0.8)
    elif kind == "arrows":
        for i in range(3):
            y = cy - 90 + i * 90
            page.draw_line((cx - 150, y), (cx + 110, y), color=GOLD, width=2)
            page.draw_line((cx + 110, y), (cx + 90, y - 12), color=GOLD, width=2)
            page.draw_line((cx + 110, y), (cx + 90, y + 12), color=GOLD, width=2)


def main():
    out = ROOT / "sample"
    out.mkdir(exist_ok=True)
    doc = fitz.open()
    for s in SLIDES:
        page = doc.new_page(width=W, height=H)
        page.draw_rect(fitz.Rect(0, 0, W, H), color=BG, fill=BG)
        page.draw_rect(fitz.Rect(28, 28, W - 28, H - 28), color=GOLD, width=1)
        page.insert_text((70, 130), s["title"], fontsize=46, color=GOLD, fontname="hebo")
        page.insert_text((72, 172), s["sub"], fontsize=20, color=DIM, fontname="helv")
        y = 250
        for b in s["bullets"]:
            page.draw_circle((84, y - 5), 4, color=GOLD, fill=GOLD)
            page.insert_text((104, y), b, fontsize=22, color=INK, fontname="heit")
            y += 56
        draw_shape(page, s["shape"])
        page.insert_text((W - 150, H - 40), "Skull Studio", fontsize=11, color=DIM, fontname="helv")
    dest = out / "demo.pdf"
    doc.save(str(dest))
    doc.close()
    print(f"Wrote {dest} ({len(SLIDES)} slides)")
    return dest


if __name__ == "__main__":
    main()
