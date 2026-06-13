"""Generic choreography heuristics for ANY draft manifest - no vision required.

Gives every deck a tasteful default: titles fade up, body text cascades in
reading order, images mask-reveal from their side and breathe, tiny corner
marks stay static, backgrounds get a slow ken burns. A per-deck script (see
choreograph.py) or the in-HTML editor can refine afterwards.

Usage: python -m skull_studio.auto_choreo
"""
import json
import unicodedata
from pathlib import Path

WORK = Path(__file__).resolve().parent.parent / "work"


def norm_text(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def area(b):
    return max(b[2] - b[0], 0) * max(b[3] - b[1], 0)


def choreograph(m):
    for slide in m["slides"]:
        slide["background"]["idle"] = {"type": "kenBurns", "scale": 1.035,
                                       "duration": 14, "yoyo": True}
        els = slide["elements"]

        # classify
        notes, tiny, images, texts = [], [], [], []
        for el in els:
            b = el["bbox"]
            if area(b) < 0.004:
                tiny.append(el)
            elif "nota del productor" in norm_text(el.get("text")):
                notes.append(el)
            elif el["type"] == "image":
                images.append(el)
            else:
                texts.append(el)

        title = None
        cands = [e for e in texts if e.get("role") == "title"] or texts
        if cands:
            title = min(cands, key=lambda e: e["bbox"][1])  # topmost

        for el in tiny:
            el["entrance"] = {"type": "none"}
            el["cleanup"] = "none"
            el["parallax"] = 0

        if title:
            title["entrance"] = {"type": "fadeUp", "delay": 0.2, "duration": 1.1,
                                 "ease": "power3.out", "distance": 0.035}
            title["cleanup"] = "auto"
            title["parallax"] = 0.08

        for el in images:
            b = el["bbox"]
            if area(b) > 0.5:
                # background-scale figure: present from the start, alive via idle
                el["entrance"] = {"type": "none"}
                el["cleanup"] = "none"
            else:
                el["entrance"] = {"type": "maskReveal", "delay": 0.6, "duration": 1.3,
                                  "direction": "left" if (b[0] + b[2]) / 2 < 0.5 else "right"}
                el["cleanup"] = "auto"
            el["idle"] = [{"type": "breath", "amount": 0.007, "period": 7}]
            el["parallax"] = 0.25

        bodies = sorted([e for e in texts if e is not title],
                        key=lambda e: (round(e["bbox"][1], 2), e["bbox"][0]))
        for k, el in enumerate(bodies):
            el["entrance"] = {"type": "fadeUp", "delay": round(0.6 + k * 0.25, 2),
                              "duration": 0.9, "distance": 0.03}
            el["cleanup"] = "auto"
            el["parallax"] = 0.12

        last = 0.6 + len(bodies) * 0.25
        for k, el in enumerate(notes):
            el["entrance"] = {"type": "fadeIn", "delay": round(last + 0.4 + k * 0.3, 2),
                              "duration": 1.0}
            el["cleanup"] = "auto"
            el["parallax"] = 0
    return m


if __name__ == "__main__":
    path = WORK / "manifest.json"
    m = choreograph(json.loads(path.read_text(encoding="utf-8")))
    path.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    n = sum(len(s["elements"]) for s in m["slides"])
    print(f"auto-choreographed {len(m['slides'])} slides, {n} elements")
