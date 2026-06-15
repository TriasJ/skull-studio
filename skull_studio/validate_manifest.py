"""Gate between stages: schema shape, bbox sanity, asset existence, unique ids.

Usage: python -m skull_studio.validate_manifest [work/manifest.json]
Exits non-zero on any error; warnings are informational.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"

ENTRANCES = {"fadeIn", "fadeUp", "fadeDown", "fadeLeft", "fadeRight", "scaleIn",
             "maskReveal", "blurIn", "drawOn", "staggerText", "none",
             "rotateIn", "scaleIn3D"}                       # 3D-model entrances
IDLES = {"float", "pulse", "sway", "shimmer", "breath", "meshWave", "kenBurns",
         "none", "autoRotate",                              # autoRotate = 3D spin
         "wave", "ripple", "swirl", "glow"}                 # 2D effect pack
TYPES = {"text", "image", "shape", "model3d"}
CLEANUPS = {"none", "fill", "blur", "auto"}


def main(path: Path):
    errors, warns = [], []
    m = json.loads(path.read_text(encoding="utf-8"))

    for key in ("version", "meta", "deck", "slides"):
        if key not in m:
            errors.append(f"missing top-level key: {key}")
    if errors:
        fail(errors)

    seen_ids = set()
    for slide in m["slides"]:
        sid = slide.get("id", "?")
        bg = slide.get("background", {}).get("src")
        if not bg or not (WORK / bg).exists():
            warns.append(f"{sid}: background missing on disk: {bg}")
        for el in slide.get("elements", []):
            eid = el.get("id", "?")
            if eid in seen_ids:
                errors.append(f"duplicate element id: {eid}")
            seen_ids.add(eid)
            if el.get("type") not in TYPES:
                errors.append(f"{eid}: bad type {el.get('type')}")
            bbox = el.get("bbox", [])
            if len(bbox) != 4 or not all(0 <= v <= 1 for v in bbox):
                errors.append(f"{eid}: bbox out of range: {bbox}")
            elif bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                errors.append(f"{eid}: degenerate bbox: {bbox}")
            if el.get("cleanup", "none") not in CLEANUPS:
                errors.append(f"{eid}: bad cleanup {el['cleanup']}")
            ent = el.get("entrance") or {"type": "none"}
            if ent.get("type") not in ENTRANCES:
                errors.append(f"{eid}: unknown entrance {ent.get('type')}")
            for idle in el.get("idle") or []:
                if idle.get("type") not in IDLES:
                    errors.append(f"{eid}: unknown idle {idle.get('type')}")
            crop = el.get("crop")
            if crop and not (WORK / crop).exists():
                warns.append(f"{eid}: crop missing on disk: {crop}")
            patch = el.get("patch")
            if patch and not (WORK / patch).exists():
                errors.append(f"{eid}: patch missing on disk: {patch}")
            if el.get("cleanup") == "fill" and not el.get("fillColor"):
                errors.append(f"{eid}: cleanup=fill but no fillColor")
            if el.get("type") == "model3d":
                src = el.get("modelSrc")
                if not src:
                    warns.append(f"{eid}: model3d without modelSrc (preview-only)")
                elif not (WORK / src).exists():
                    warns.append(f"{eid}: model glb missing on disk: {src}")

    for w in warns:
        print("WARN ", w)
    if errors:
        fail(errors)
    print(f"OK: {len(m['slides'])} slides, {len(seen_ids)} elements, {len(warns)} warnings")


def fail(errors):
    for e in errors:
        print("ERROR", e)
    sys.exit(1)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / "manifest.json")
