#!/usr/bin/env python3
"""Cookbook edits for a Skull Studio work/manifest.json.

Every subcommand validates the result before writing, and supports --dry-run.
Run from anywhere; the repo root is auto-detected.

    python manifest_edit.py list
    python manifest_edit.py set-entrance s01_e02 --type fadeUp --delay 0.3
    python manifest_edit.py set-idle s01_e04 --type breath --amount 0.015 --period 4
    python manifest_edit.py add-particles s02_e01 --preset snow --shape dot
    python manifest_edit.py apply-preset s01_e03 --preset underwater
    python manifest_edit.py add-3d --slide s01 --shape cube --bbox 0.6,0.3,0.9,0.8
    python manifest_edit.py bg-idle --slide all --type kenBurns --scale 1.04

Selectors: an element id, `all`, a slide prefix like `s01:*`, plus the
--role / --type filters. See --help on each subcommand.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

# --------------------------------------------------------------- enums (validator)
# Mirrors skull_studio/validate_manifest.py:13-21. Keep in sync with that file.
ENTRANCES = {"fadeIn", "fadeUp", "fadeDown", "fadeLeft", "fadeRight", "scaleIn",
             "maskReveal", "blurIn", "drawOn", "staggerText", "none",
             "rotateIn", "scaleIn3D"}
IDLES = {"float", "pulse", "sway", "shimmer", "breath", "meshWave", "kenBurns",
         "none", "autoRotate", "wave", "ripple", "swirl", "glow", "particles"}
TYPES = {"text", "image", "shape", "model3d"}
CLEANUPS = {"none", "fill", "blur", "auto"}
ROLES = {"title", "body", "figure"}

# runtime/src/00-core.js:6-15 - an ease outside this set silently falls back.
EASES = {
    "none", "power1.in", "power1.out", "power1.inOut",
    "power2.in", "power2.out", "power2.inOut",
    "power3.in", "power3.out", "power3.inOut",
    "power4.in", "power4.out", "power4.inOut",
    "sine.in", "sine.out", "sine.inOut",
    "expo.in", "expo.out", "expo.inOut",
    "back.out", "back.out(1.4)", "back.out(1.7)", "back.inOut",
    "elastic.out", "elastic.out(1,0.4)", "circ.out", "circ.inOut",
}

PARTICLE_PRESETS = {"sparkle", "snow", "embers", "floatUp", "bubbles"}
PARTICLE_SHAPES = {"dot", "circle", "ring", "square", "triangle", "star", "custom"}
PRIMITIVES = {"plane", "cube", "sphere", "cylinder", "cone", "torus"}
BLEND_MODES = {"normal", "add", "screen", "multiply", "overlay", "darken", "lighten",
               "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
               "exclusion"}

# runtime/src/67-effect-presets.js - the editor's one-click looks, verbatim.
EFFECT_PRESETS = {
    "float": {"entrance": {"type": "fadeUp", "delay": 0.2, "duration": 0.9, "ease": "power3.out"},
              "idle": [{"type": "float", "amplitude": 0.008, "period": 5}]},
    "glow": {"entrance": {"type": "fadeIn", "delay": 0.2, "duration": 0.8, "ease": "power2.out"},
             "idle": [{"type": "glow", "amount": 0.6, "period": 2, "color": "#66ccff"}]},
    "underwater": {"entrance": {"type": "fadeIn", "delay": 0.2, "duration": 1.0, "ease": "power2.out"},
                   "idle": [{"type": "ripple", "amplitude": 0.015, "speed": 0.5, "waves": 3}]},
    "drift": {"entrance": {"type": "fadeLeft", "delay": 0.2, "duration": 0.9,
                           "ease": "power3.out", "distance": 0.06},
              "idle": [{"type": "sway", "degrees": 1.2, "period": 6}]},
    "sparkle": {"entrance": {"type": "scaleIn", "delay": 0.15, "duration": 0.8, "ease": "back.out(1.4)"},
                "idle": [{"type": "particles", "preset": "sparkle", "rate": 24}]},
    "heartbeat": {"entrance": {"type": "scaleIn", "delay": 0.15, "duration": 0.7, "ease": "back.out(1.4)"},
                  "idle": [{"type": "pulse", "amount": 0.12, "period": 1.2}]},
}

# --------------------------------------------------------------------------------
# The taste table behind `apply-preset --preset auto`. Rationale and the rules it
# follows: docs/CHOREOGRAPHY.md.
#
# Deliberately generous. Setting animation up is the expensive part; switching it
# off is one edit (`clear-idle`, or entrance type "none"), so the useful default is
# more motion than you might ship, not less. Target: stills from scientific and
# artistic NotebookLM decks, which arrive with no motion at all.
#
# Each entry is (entrance, idle-list, parallax). No mesh idles here - `wave`,
# `ripple`, `swirl` and `meshWave` move pixels relative to each other, which is
# expressive on an illustration and misleading on a chart, and a blanket default
# cannot tell those apart. Apply those per element once you can see the slide.
DEFAULT_BY_ROLE = {
    "title": ({"type": "fadeUp", "delay": 0.2, "duration": 1.0,
               "ease": "power3.out", "distance": 0.035},
              [{"type": "float", "amplitude": 0.004, "period": 7}],
              0.08),
    "body": ({"type": "fadeUp", "duration": 0.9, "ease": "power3.out",
              "distance": 0.03},
             [{"type": "float", "amplitude": 0.003, "period": 8}],
             0.12),
    "figure": ({"type": "maskReveal", "delay": 0.5, "duration": 1.3,
                "direction": "left"},
               [{"type": "breath", "amount": 0.012, "period": 6},
                {"type": "glow", "amount": 0.3, "period": 4, "color": "#8fd3ff"}],
               0.25),
}
# Elements smaller than this fraction of the slide are left static - page numbers
# and corner marks animating around is noise, not motion. (auto_choreo.py:38)
TINY_AREA = 0.004
# --------------------------------------------------------------------------------


class Bail(Exception):
    """A user-facing error; printed without a traceback."""


# ------------------------------------------------------------------------- helpers

def find_root(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not (p / "pyproject.toml").exists():
            raise Bail(f"{p} is not a skull-studio repo (no pyproject.toml)")
        return p
    for start in (Path(__file__).resolve(), Path.cwd().resolve() / "_"):
        for cand in start.parents:
            pp = cand / "pyproject.toml"
            if pp.exists() and "skull-studio" in pp.read_text(encoding="utf-8", errors="ignore"):
                return cand
    raise Bail("could not find the skull-studio repo; pass --root PATH")


def load(path: Path) -> dict:
    if not path.exists():
        raise Bail(f"no manifest at {path} - import a deck first")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise Bail(f"{path} is not valid JSON: {e}")


def save(path: Path, m: dict) -> None:
    """Write atomically, matching the studio's own formatting (studio.py:420-422)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def iter_elements(m: dict):
    for slide in m.get("slides", []):
        for el in slide.get("elements", []):
            yield slide, el


def area(b) -> float:
    return max(b[2] - b[0], 0) * max(b[3] - b[1], 0)


def select(m: dict, selector: str, role: str | None, etype: str | None) -> list[dict]:
    """Resolve a selector to a list of element dicts (live references)."""
    out = []
    for slide, el in iter_elements(m):
        if selector in ("all", "*"):
            hit = True
        elif selector.endswith(":*"):
            hit = slide.get("id") == selector[:-2]
        else:
            hit = el.get("id") == selector
        if hit and (role is None or el.get("role") == role) \
                and (etype is None or el.get("type") == etype):
            out.append(el)
    if not out:
        raise Bail(f"selector '{selector}' matched no elements "
                   f"(try: manifest_edit.py list)")
    return out


def parse_bbox(raw: str) -> list[float]:
    parts = [p for p in re.split(r"[,\s]+", raw.strip()) if p]
    if len(parts) != 4:
        raise Bail(f"--bbox needs 4 numbers, got {len(parts)}: {raw}")
    try:
        b = [float(p) for p in parts]
    except ValueError:
        raise Bail(f"--bbox values must be numbers: {raw}")
    if not all(0 <= v <= 1 for v in b):
        raise Bail(f"--bbox values must be normalized 0-1: {b}")
    if b[2] <= b[0] or b[3] <= b[1]:
        raise Bail(f"--bbox is degenerate (needs x1>x0 and y1>y0): {b}")
    return b


def parse_params(pairs: list[str] | None) -> dict:
    """`-p k=v` values, typed: numbers as numbers, true/false as bools."""
    out = {}
    for raw in pairs or []:
        if "=" not in raw:
            raise Bail(f"-p expects key=value, got '{raw}'")
        k, v = raw.split("=", 1)
        out[k.strip()] = coerce(v.strip())
    return out


def coerce(v: str):
    low = v.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "none"):
        return None
    try:
        return int(v) if re.fullmatch(r"-?\d+", v) else float(v)
    except ValueError:
        return v


def next_free_id(m: dict, slide_id: str, stem: str = "e") -> str:
    used = {el.get("id") for _, el in iter_elements(m)}
    n = 1
    while f"{slide_id}_{stem}{n:02d}" in used:
        n += 1
    return f"{slide_id}_{stem}{n:02d}"


def find_slide(m: dict, slide_id: str) -> dict:
    for s in m.get("slides", []):
        if s.get("id") == slide_id:
            return s
    have = ", ".join(s.get("id", "?") for s in m.get("slides", []))
    raise Bail(f"no slide '{slide_id}' (have: {have})")


def check_ease(ease: str | None) -> None:
    if ease and ease not in EASES:
        raise Bail(f"ease '{ease}' is not in the runtime whitelist - it would "
                   f"silently fall back to power2.out. Valid: {', '.join(sorted(EASES))}")


def run_validator(root: Path, manifest: Path) -> int:
    """Run the project's own validator; it is the authority, not this script."""
    cmd = [sys.executable, "-m", "skull_studio.validate_manifest", str(manifest)]
    p = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
    sys.stdout.write(p.stdout)
    sys.stderr.write(p.stderr)
    return p.returncode


def report(changed: list[str], args, root: Path, manifest: Path, m: dict) -> int:
    """Common tail: print what changed, then write + validate (unless --dry-run)."""
    if not changed:
        print("nothing to change (already in that state)")
        return 0
    for line in changed:
        print(("would set " if args.dry_run else "set ") + line)
    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0
    save(manifest, m)
    print(f"\nwrote {manifest}")
    code = run_validator(root, manifest)
    if code != 0:
        print("\nVALIDATION FAILED - the manifest on disk is now invalid.", file=sys.stderr)
        return code
    hint = next_step_hint(changed)
    if hint:
        print(hint)
    return 0


PIXEL_FIELDS = ("bbox", "cleanup", "fillColor", "blurRadius", "polygon", "regions")


def next_step_hint(changed: list[str]) -> str:
    blob = " ".join(changed)
    if any(f in blob for f in PIXEL_FIELDS):
        return ("\nNext: python -m skull_studio.crop_and_patch   (pixels changed)\n"
                "      node skull_studio/build.mjs")
    return "\nNext: node skull_studio/build.mjs"


# ------------------------------------------------------------------------ commands

def cmd_list(args, root, manifest, m) -> int:
    for slide in m.get("slides", []):
        if args.slide and slide.get("id") != args.slide:
            continue
        bg = slide.get("background") or {}
        bgidle = (bg.get("idle") or {}).get("type", "-")
        print(f"\n{slide.get('id')}  (index {slide.get('index')})  "
              f"background idle: {bgidle}")
        print(f"  {'id':<14} {'type':<8} {'role':<7} {'entrance':<12} "
              f"{'idle':<24} bbox")
        for el in slide.get("elements", []):
            ent = (el.get("entrance") or {}).get("type", "none")
            idles = ",".join(i.get("type", "?") for i in (el.get("idle") or [])) or "-"
            bbox = el.get("bbox") or []
            bs = "[" + ", ".join(f"{v:.3f}" for v in bbox) + "]" if bbox else "-"
            name = el.get("name") or ""
            print(f"  {el.get('id', '?'):<14} {el.get('type', '?'):<8} "
                  f"{el.get('role', '-'):<7} {ent:<12} {idles:<24} {bs}"
                  + (f"  {name}" if name and name != el.get("id") else ""))
    n = sum(len(s.get("elements", [])) for s in m.get("slides", []))
    print(f"\n{len(m.get('slides', []))} slides, {n} elements")
    return 0


def cmd_set_entrance(args, root, manifest, m) -> int:
    if args.type not in ENTRANCES:
        raise Bail(f"unknown entrance '{args.type}'. Valid: {', '.join(sorted(ENTRANCES))}")
    check_ease(args.ease)
    spec = {"type": args.type}
    for key, val in (("delay", args.delay), ("duration", args.duration),
                     ("ease", args.ease), ("distance", args.distance),
                     ("direction", args.direction), ("from", getattr(args, "from")),
                     ("fromBlur", args.from_blur)):
        if val is not None:
            spec[key] = val
    spec.update(parse_params(args.param))

    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        if el.get("entrance") == spec:
            continue
        el["entrance"] = copy.deepcopy(spec)
        changed.append(f"{el['id']}.entrance = {json.dumps(spec)}")
    return report(changed, args, root, manifest, m)


def build_idle_spec(args) -> dict:
    if args.type not in IDLES:
        raise Bail(f"unknown idle '{args.type}'. Valid: {', '.join(sorted(IDLES))}")
    spec = {"type": args.type}
    for key, val in (("amount", args.amount), ("amplitude", args.amplitude),
                     ("period", args.period), ("speed", args.speed),
                     ("degrees", args.degrees), ("waves", args.waves),
                     ("radius", args.radius), ("axis", args.axis),
                     ("color", args.color), ("scale", args.scale),
                     ("duration", args.duration)):
        if val is not None:
            spec[key] = val
    spec.update(parse_params(args.param))
    return spec


def cmd_set_idle(args, root, manifest, m) -> int:
    spec = build_idle_spec(args)
    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        cur = el.get("idle") or []
        if args.append:
            if spec in cur:
                continue
            new = cur + [copy.deepcopy(spec)]
        else:
            new = [copy.deepcopy(spec)]
        if cur == new:
            continue
        el["idle"] = new
        changed.append(f"{el['id']}.idle = {json.dumps(new)}")
    return report(changed, args, root, manifest, m)


def cmd_clear_idle(args, root, manifest, m) -> int:
    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        if not el.get("idle"):
            continue
        el["idle"] = []
        changed.append(f"{el['id']}.idle = []")
    return report(changed, args, root, manifest, m)


def cmd_add_particles(args, root, manifest, m) -> int:
    if args.preset not in PARTICLE_PRESETS:
        raise Bail(f"unknown particle preset '{args.preset}'. "
                   f"Valid: {', '.join(sorted(PARTICLE_PRESETS))}")
    if args.shape and args.shape not in PARTICLE_SHAPES:
        raise Bail(f"unknown particle shape '{args.shape}'. "
                   f"Valid: {', '.join(sorted(PARTICLE_SHAPES))}")
    if args.shape == "custom" and not args.texture:
        raise Bail("shape=custom needs --texture particles/<file>.png "
                   "(upload it via POST /api/asset or drop it in work/particles/)")
    spec = {"type": "particles", "preset": args.preset}
    for key, val in (("shape", args.shape), ("color", args.color),
                     ("rate", args.rate), ("size", args.size),
                     ("texture", args.texture)):
        if val is not None:
            spec[key] = val
    spec.update(parse_params(args.param))

    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        cur = [i for i in (el.get("idle") or []) if i.get("type") != "particles"] \
            if args.replace else list(el.get("idle") or [])
        if spec in cur:
            continue
        cur.append(copy.deepcopy(spec))
        el["idle"] = cur
        changed.append(f"{el['id']}.idle += {json.dumps(spec)}")
    return report(changed, args, root, manifest, m)


def cmd_apply_preset(args, root, manifest, m) -> int:
    changed = []
    targets = select(m, args.selector, args.role, args.etype)

    if args.preset == "auto":
        for el in targets:
            bbox = el.get("bbox") or [0, 0, 0, 0]
            if area(bbox) < TINY_AREA:
                ent, idle, par = {"type": "none"}, [], 0
            else:
                role = el.get("role") if el.get("role") in DEFAULT_BY_ROLE else "figure"
                ent, idle, par = DEFAULT_BY_ROLE[role]
            if el.get("entrance") == ent and (el.get("idle") or []) == idle \
                    and el.get("parallax") == par:
                continue
            el["entrance"] = copy.deepcopy(ent)
            el["idle"] = copy.deepcopy(idle)
            el["parallax"] = par
            changed.append(f"{el['id']} -> auto ({el.get('role', 'figure')}, "
                           f"parallax {par})")
        return report(changed, args, root, manifest, m)

    preset = EFFECT_PRESETS.get(args.preset)
    if not preset:
        raise Bail(f"unknown preset '{args.preset}'. "
                   f"Valid: auto, {', '.join(sorted(EFFECT_PRESETS))}")
    for el in targets:
        if el.get("entrance") == preset["entrance"] and \
                (el.get("idle") or []) == preset["idle"]:
            continue
        el["entrance"] = copy.deepcopy(preset["entrance"])
        el["idle"] = copy.deepcopy(preset["idle"])
        changed.append(f"{el['id']} -> preset '{args.preset}'")
    return report(changed, args, root, manifest, m)


def cmd_bg_idle(args, root, manifest, m) -> int:
    if args.type not in IDLES:
        raise Bail(f"unknown idle '{args.type}'. Valid: {', '.join(sorted(IDLES))}")
    spec = None if args.type == "none" else {"type": args.type}
    if spec is not None:
        for key, val in (("scale", args.scale), ("duration", args.duration),
                         ("amount", args.amount), ("period", args.period)):
            if val is not None:
                spec[key] = val
        if args.type == "kenBurns":
            spec.setdefault("scale", 1.04)
            spec.setdefault("duration", 14)
            spec["yoyo"] = not args.no_yoyo
        spec.update(parse_params(args.param))

    changed = []
    for slide in m.get("slides", []):
        if args.slide not in ("all", slide.get("id")):
            continue
        bg = slide.setdefault("background", {})
        if bg.get("idle") == spec:
            continue
        bg["idle"] = copy.deepcopy(spec)
        changed.append(f"{slide.get('id')}.background.idle = {json.dumps(spec)}")
    if not changed and not any(args.slide in ("all", s.get("id")) for s in m.get("slides", [])):
        raise Bail(f"no slide '{args.slide}'")
    return report(changed, args, root, manifest, m)


def cmd_add_element(args, root, manifest, m) -> int:
    if args.type not in TYPES:
        raise Bail(f"unknown type '{args.type}'. Valid: {', '.join(sorted(TYPES))}")
    slide = find_slide(m, args.slide)
    bbox = parse_bbox(args.bbox)
    eid = args.id or next_free_id(m, slide["id"])
    if any(el.get("id") == eid for _, el in iter_elements(m)):
        raise Bail(f"element id '{eid}' already exists (ids are unique deck-wide)")
    el = {
        "id": eid, "type": args.type, "role": args.role or "figure",
        "name": args.name or eid, "text": args.text or "",
        "bbox": bbox, "cropBbox": None, "crop": None, "polygon": None, "regions": None,
        "z": args.z if args.z is not None else 2,
        "cleanup": "none", "fillColor": None, "patch": None,
        "entrance": {"type": "fadeIn", "delay": 0.2, "duration": 0.8, "ease": "power2.out"},
        "idle": [], "parallax": 0.05, "lines": None, "rig": None,
        "blendMode": None, "opacity": 1, "hidden": False,
    }
    slide.setdefault("elements", []).append(el)
    changed = [f"{slide['id']} += element {eid} ({args.type}) at {bbox}"]
    code = report(changed, args, root, manifest, m)
    if code == 0 and not args.dry_run:
        print(f"      the crop for {eid} is generated by crop_and_patch from the slide render")
    return code


def cmd_add_3d(args, root, manifest, m) -> int:
    if args.shape not in PRIMITIVES:
        raise Bail(f"unknown shape '{args.shape}'. Valid: {', '.join(sorted(PRIMITIVES))}")
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", args.color):
        raise Bail(f"--color must be #rrggbb, got '{args.color}'")
    slide = find_slide(m, args.slide)
    bbox = parse_bbox(args.bbox)
    eid = args.id or next_free_id(m, slide["id"], stem="m")

    models = root / "work" / "models"
    n = 1
    while (models / f"prim_{n}.glb").exists():
        n += 1
    out = models / f"prim_{n}.glb"

    if args.dry_run:
        print(f"would generate {out} ({args.shape}, {args.color})")
    else:
        if not shutil.which("node"):
            raise Bail("node is required to generate the .glb (see the "
                       "skull-studio-install skill)")
        models.mkdir(parents=True, exist_ok=True)
        gen = subprocess.run(
            ["node", str(root / "skull_studio" / "make_sample_glb.mjs"), "one",
             args.shape, args.color, str(out)],
            cwd=root, capture_output=True, text=True)
        if gen.returncode != 0 or not out.exists():
            raise Bail("glb generation failed: " + (gen.stderr or gen.stdout)[:300])
        print(f"generated work/models/{out.name}")

    el = {
        "id": eid, "type": "model3d", "role": "figure", "name": args.name or args.shape,
        "text": "", "bbox": bbox, "cropBbox": None, "crop": None,
        "polygon": None, "regions": None, "z": args.z if args.z is not None else 2,
        "cleanup": "none", "fillColor": None, "patch": None,
        "entrance": {"type": "scaleIn", "delay": 0.2, "duration": 0.9,
                     "ease": "back.out(1.4)"},
        "idle": ([{"type": "autoRotate", "degrees": args.auto_rotate}]
                 if args.auto_rotate else []),
        "parallax": 0.05, "lines": None, "rig": None,
        "blendMode": None, "opacity": 1, "hidden": False,
        "modelSrc": f"models/{out.name}",
        "model3d": {"clip": None, "loop": True, "durationMs": None,
                    "autoRotate": args.auto_rotate or 0,
                    "camera": {"fov": 45},
                    "transform": {"rot": [0.35, 0.6, 0], "scale": [1, 1, 1]},
                    "previewSrc": None, "sourceXml": None},
    }
    slide.setdefault("elements", []).append(el)
    changed = [f"{slide['id']} += model3d {eid} ({args.shape}) at {bbox}"]
    code = report(changed, args, root, manifest, m)
    if code == 0 and not args.dry_run:
        print("      synthetic models bake to a picture on PPTX export unless you pass "
              "--models 3d")
    return code


def cmd_hide(args, root, manifest, m) -> int:
    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        want = not args.unhide
        if el.get("hidden") == want:
            continue
        el["hidden"] = want
        if want and el.get("cleanup") in (None, "none"):
            el["cleanup"] = "auto"
            changed.append(f"{el['id']}.cleanup = auto (needed to cover the footprint)")
        changed.append(f"{el['id']}.hidden = {want}")
    return report(changed, args, root, manifest, m)


def cmd_set_field(args, root, manifest, m) -> int:
    """Escape hatch for the fields without a dedicated subcommand."""
    value = coerce(args.value) if args.value != "-" else None
    if args.field == "bbox":
        value = parse_bbox(args.value)
    if args.field == "cleanup" and value not in CLEANUPS:
        raise Bail(f"cleanup must be one of {', '.join(sorted(CLEANUPS))}")
    if args.field == "blendMode" and value not in BLEND_MODES | {None}:
        raise Bail(f"blendMode must be one of {', '.join(sorted(BLEND_MODES))}")
    if args.field == "role" and value not in ROLES:
        raise Bail(f"role must be one of {', '.join(sorted(ROLES))}")
    changed = []
    for el in select(m, args.selector, args.role, args.etype):
        if el.get(args.field) == value:
            continue
        el[args.field] = value
        changed.append(f"{el['id']}.{args.field} = {json.dumps(value)}")
        if args.field == "cleanup" and value == "fill" and not el.get("fillColor"):
            raise Bail(f"{el['id']}: cleanup=fill requires fillColor - set that too "
                       f"(set-field {el['id']} fillColor '#101010')")
    return report(changed, args, root, manifest, m)


def cmd_validate(args, root, manifest, m) -> int:
    return run_validator(root, manifest)


# ---------------------------------------------------------------------------- main

def add_selector(p) -> None:
    p.add_argument("selector",
                   help="element id, 'all', or a slide prefix like 's01:*'")
    p.add_argument("--role", choices=sorted(ROLES), help="further filter by role")
    p.add_argument("--etype", choices=sorted(TYPES), dest="etype",
                   help="further filter by element type")


def add_io(p) -> None:
    """Flags every subcommand needs."""
    p.add_argument("--root", help="repo path (auto-detected otherwise)")
    p.add_argument("--manifest", help="manifest path (default: <root>/work/manifest.json)")


def add_common(p) -> None:
    """Flags only the writing subcommands need."""
    add_io(p)
    p.add_argument("--dry-run", action="store_true", help="print changes, write nothing")
    p.add_argument("-p", "--param", action="append", metavar="K=V",
                   help="extra spec key, repeatable (e.g. -p twinkle=0.5)")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Cookbook edits for work/manifest.json.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="show slides, elements, entrances, idles, boxes")
    p.add_argument("--slide", help="only this slide id")
    add_io(p)
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("set-entrance", help="set an element's entrance")
    add_selector(p)
    p.add_argument("--type", required=True, choices=sorted(ENTRANCES))
    p.add_argument("--delay", type=float)
    p.add_argument("--duration", type=float)
    p.add_argument("--ease")
    p.add_argument("--distance", type=float, help="fadeUp/Down/Left/Right travel (of designHeight)")
    p.add_argument("--direction", choices=["left", "right", "up", "down", "center"],
                   help="maskReveal / drawOn direction")
    p.add_argument("--from", type=float, dest="from", help="scaleIn start scale")
    p.add_argument("--from-blur", type=float, help="blurIn start blur in px")
    add_common(p)
    p.set_defaults(fn=cmd_set_entrance)

    p = sub.add_parser("set-idle", help="set (or append) an idle loop")
    add_selector(p)
    p.add_argument("--type", required=True, choices=sorted(IDLES))
    p.add_argument("--amount", type=float)
    p.add_argument("--amplitude", type=float)
    p.add_argument("--period", type=float)
    p.add_argument("--speed", type=float)
    p.add_argument("--degrees", type=float)
    p.add_argument("--waves", type=int)
    p.add_argument("--radius", type=float)
    p.add_argument("--axis", choices=["x", "y"])
    p.add_argument("--color")
    p.add_argument("--scale", type=float)
    p.add_argument("--duration", type=float)
    p.add_argument("--append", action="store_true",
                   help="add to the existing idles instead of replacing them")
    add_common(p)
    p.set_defaults(fn=cmd_set_idle)

    p = sub.add_parser("clear-idle", help="remove all idle loops")
    add_selector(p)
    add_common(p)
    p.set_defaults(fn=cmd_clear_idle)

    p = sub.add_parser("add-particles", help="attach a particle emitter")
    add_selector(p)
    p.add_argument("--preset", required=True, choices=sorted(PARTICLE_PRESETS))
    p.add_argument("--shape", choices=sorted(PARTICLE_SHAPES))
    p.add_argument("--color")
    p.add_argument("--rate", type=float, help="particles per second")
    p.add_argument("--size", type=float)
    p.add_argument("--texture", help="particles/<file>.png for shape=custom")
    p.add_argument("--replace", action="store_true",
                   help="drop any existing particle emitter first")
    add_common(p)
    p.set_defaults(fn=cmd_add_particles)

    p = sub.add_parser("apply-preset", help="one-click entrance+idle look")
    add_selector(p)
    p.add_argument("--preset", required=True,
                   choices=["auto"] + sorted(EFFECT_PRESETS),
                   help="'auto' = role-based defaults (see DEFAULT_BY_ROLE)")
    add_common(p)
    p.set_defaults(fn=cmd_apply_preset)

    p = sub.add_parser("bg-idle", help="set a slide background's idle (e.g. Ken Burns)")
    p.add_argument("--slide", default="all", help="slide id, or 'all'")
    p.add_argument("--type", required=True, choices=sorted(IDLES))
    p.add_argument("--scale", type=float)
    p.add_argument("--duration", type=float)
    p.add_argument("--amount", type=float)
    p.add_argument("--period", type=float)
    p.add_argument("--no-yoyo", action="store_true", help="kenBurns: do not reverse")
    add_common(p)
    p.set_defaults(fn=cmd_bg_idle)

    p = sub.add_parser("add-element", help="add a new element box to a slide")
    p.add_argument("--slide", required=True)
    p.add_argument("--bbox", required=True, help="x0,y0,x1,y1 normalized 0-1")
    p.add_argument("--type", default="image", choices=sorted(TYPES))
    p.add_argument("--role", choices=sorted(ROLES))
    p.add_argument("--name")
    p.add_argument("--text", help="for type=text")
    p.add_argument("--id", help="explicit element id (must be unique deck-wide)")
    p.add_argument("--z", type=int)
    add_common(p)
    p.set_defaults(fn=cmd_add_element)

    p = sub.add_parser("add-3d", help="generate a coloured primitive .glb and place it")
    p.add_argument("--slide", required=True)
    p.add_argument("--shape", required=True, choices=sorted(PRIMITIVES))
    p.add_argument("--bbox", required=True, help="x0,y0,x1,y1 normalized 0-1")
    p.add_argument("--color", default="#8899aa")
    p.add_argument("--auto-rotate", type=float, default=0, metavar="DEG_PER_SEC")
    p.add_argument("--name")
    p.add_argument("--id")
    p.add_argument("--z", type=int)
    add_common(p)
    p.set_defaults(fn=cmd_add_3d)

    p = sub.add_parser("hide", help="censor an element (cover it with its patch)")
    add_selector(p)
    p.add_argument("--unhide", action="store_true")
    add_common(p)
    p.set_defaults(fn=cmd_hide)

    p = sub.add_parser("set-field", help="set any other element field")
    add_selector(p)
    p.add_argument("field")
    p.add_argument("value", help="'-' for null")
    add_common(p)
    p.set_defaults(fn=cmd_set_field)

    p = sub.add_parser("validate", help="run the project's validator")
    add_io(p)
    p.set_defaults(fn=cmd_validate)

    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    try:
        root = find_root(args.root)
        manifest = Path(args.manifest).resolve() if args.manifest \
            else root / "work" / "manifest.json"
        m = load(manifest)
        return args.fn(args, root, manifest, m)
    except Bail as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
