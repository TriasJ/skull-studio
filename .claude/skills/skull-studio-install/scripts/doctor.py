#!/usr/bin/env python3
"""Skull Studio install doctor: check every prerequisite and print how to fix it.

Usage:
    python doctor.py [--root PATH] [--json] [--quiet]

Exit code 0 when all REQUIRED checks pass, 1 otherwise. Optional components that
are missing are reported as WARN and never fail the run.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
from pathlib import Path

WIN = os.name == "nt"
MAC = sys.platform == "darwin"

OK, WARN, FAIL, INFO = "OK", "WARN", "FAIL", "INFO"
GLYPH = {OK: "[ok]  ", WARN: "[warn]", FAIL: "[FAIL]", INFO: "[info]"}

# Vendored browser libs fetched by skull_studio/fetch_libs.mjs.
VENDOR_FILES = ["pixi.min.js", "gsap.min.js", "three.min.js", "three.GLTFLoader.js"]

# LibreOffice is auto-discovered by extract_pptx.py even when it is off PATH.
SOFFICE_PROBES = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
]

MINERU_FIX = 'uv tool install "mineru[core]"'


def pick(win: str, mac: str, linux: str) -> str:
    return win if WIN else (mac if MAC else linux)


class Report:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, name: str, status: str, detail: str = "", fix: str = "",
            required: bool = False) -> None:
        self.rows.append({"check": name, "status": status, "detail": detail,
                          "fix": fix, "required": required})

    @property
    def failed(self) -> bool:
        return any(r["status"] == FAIL and r["required"] for r in self.rows)


def run(cmd: list[str]) -> tuple[int, str]:
    """Run a command, return (returncode, first line of output). Never raises."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    except (OSError, subprocess.SubprocessError):
        return 127, ""
    out = (p.stdout or p.stderr or "").strip().splitlines()
    return p.returncode, (out[0] if out else "")


def find_root(explicit: str | None) -> Path | None:
    """Locate the skull-studio repo root by its pyproject, from the skill or the cwd."""
    if explicit:
        p = Path(explicit).expanduser().resolve()
        return p if (p / "pyproject.toml").exists() else None
    starts = [Path(__file__).resolve(), Path.cwd().resolve() / "_"]
    for start in starts:
        for cand in start.parents:
            pp = cand / "pyproject.toml"
            if pp.exists() and "skull-studio" in pp.read_text(encoding="utf-8", errors="ignore"):
                return cand
    return None


# --------------------------------------------------------------------------- checks

def check_python(rep: Report) -> None:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) >= (3, 10):
        rep.add("Python >= 3.10", OK, f"{ver} at {sys.executable}", required=True)
    else:
        rep.add("Python >= 3.10", FAIL, f"found {ver}", required=True,
                fix=pick("winget install Python.Python.3.12",
                         "brew install python@3.12",
                         "sudo apt install python3.12"))


def check_node(rep: Report) -> None:
    if not shutil.which("node"):
        rep.add("Node >= 18", FAIL, "node not on PATH", required=True,
                fix=pick("winget install OpenJS.NodeJS   (then open a NEW shell)",
                         "brew install node", "sudo apt install nodejs"))
        return
    _, out = run(["node", "--version"])
    major = 0
    if out.startswith("v"):
        try:
            major = int(out[1:].split(".")[0])
        except ValueError:
            major = 0
    if major >= 18:
        rep.add("Node >= 18", OK, out, required=True)
    else:
        rep.add("Node >= 18", FAIL, f"found {out or 'unknown'}", required=True,
                fix=pick("winget upgrade OpenJS.NodeJS", "brew upgrade node",
                         "sudo apt install nodejs"))


def check_repo(rep: Report, root: Path | None) -> None:
    if root is None:
        rep.add("skull-studio repo", FAIL,
                "no skull-studio pyproject.toml found above this script or the cwd",
                required=True,
                fix="git clone https://github.com/TriasJ/skull-studio.git && cd skull-studio")
        return
    rep.add("skull-studio repo", OK, str(root), required=True)


def check_package(rep: Report, root: Path | None) -> None:
    code, _ = run([sys.executable, "-c", "import skull_studio"])
    if code == 0:
        rep.add("skull_studio importable", OK, "package resolves")
    else:
        hint = f"cd {root} && python install.py --no-ocr" if root else \
               "python install.py --no-ocr"
        rep.add("skull_studio importable", WARN,
                "not installed; `python -m skull_studio.*` still works from the repo root",
                fix=hint)


def check_console_script(rep: Report) -> None:
    found = shutil.which("skull-studio")
    if found:
        rep.add("`skull-studio` command", OK, found)
    else:
        rep.add("`skull-studio` command", WARN, "shim not on PATH",
                fix="open a NEW shell, or use: python launch.py")


def check_vendor(rep: Report, root: Path | None) -> None:
    if root is None:
        return
    vendor = root / "runtime" / "vendor"
    missing = [f for f in VENDOR_FILES if not (vendor / f).exists()]
    if not missing:
        rep.add("runtime/vendor browser libs", OK, "pixi + gsap + three present",
                required=True)
    else:
        rep.add("runtime/vendor browser libs", FAIL,
                "missing: " + ", ".join(missing), required=True,
                fix=f"cd {root} && node skull_studio/fetch_libs.mjs   (needs internet)")


def check_ffmpeg(rep: Report) -> None:
    if shutil.which("ffmpeg"):
        _, out = run(["ffmpeg", "-version"])
        rep.add("ffmpeg (video/GIF baking)", OK, out[:60])
    else:
        rep.add("ffmpeg (video/GIF baking)", WARN,
                "absent - no mp4/GIF clips, no baked HTML, no animated PPTX assets",
                fix=pick("winget install Gyan.FFmpeg", "brew install ffmpeg",
                         "sudo apt install ffmpeg"))


def check_libreoffice(rep: Report) -> None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if not found:
        found = next((p for p in SOFFICE_PROBES if Path(p).exists()), None)
    if found:
        rep.add("LibreOffice (PPTX import)", OK, found)
    else:
        rep.add("LibreOffice (PPTX import)", WARN,
                "absent - PPTX import will not work; PDF import is unaffected",
                fix=pick("winget install TheDocumentFoundation.LibreOffice",
                         "brew install --cask libreoffice",
                         "sudo apt install libreoffice"))


def check_uv(rep: Report) -> None:
    if shutil.which("uv"):
        _, out = run(["uv", "--version"])
        rep.add("uv (optional)", INFO, out)
    else:
        rep.add("uv (optional)", INFO, "absent - pip is used instead",
                fix="https://docs.astral.sh/uv/getting-started/installation/")


def check_mineru(rep: Report) -> None:
    if shutil.which("mineru"):
        _, out = run(["mineru", "--version"])
        rep.add("MinerU (full-layout OCR)", INFO, out or "installed")
    else:
        rep.add("MinerU (full-layout OCR)", INFO,
                "absent - import with --ocr rapid (bundled RapidOCR) or --ocr none",
                fix=MINERU_FIX)


def check_rapidocr(rep: Report) -> None:
    code, _ = run([sys.executable, "-c", "import rapidocr_onnxruntime"])
    if code == 0:
        rep.add("RapidOCR (bundled OCR)", OK, "importable")
    else:
        rep.add("RapidOCR (bundled OCR)", WARN,
                "not importable - --ocr rapid will fail",
                fix="python install.py --no-ocr   (installs the pip dependencies)")


def check_running_studio(rep: Report) -> None:
    live = []
    for port in range(8765, 8786):
        with socket.socket() as s:
            s.settimeout(0.05)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                live.append(port)
    if live:
        rep.add("Studio server", INFO,
                "listening on " + ", ".join(f"http://localhost:{p}" for p in live))
    else:
        rep.add("Studio server", INFO, "not running (start it with: skull-studio)")


def check_project_state(rep: Report, root: Path | None) -> None:
    if root is None:
        return
    mf = root / "work" / "manifest.json"
    if not mf.exists():
        rep.add("Current project", INFO, "no work/manifest.json - nothing imported yet")
        return
    try:
        m = json.loads(mf.read_text(encoding="utf-8"))
        slides = len(m.get("slides", []))
        els = sum(len(s.get("elements", [])) for s in m.get("slides", []))
        title = m.get("meta", {}).get("title", "?")
        rep.add("Current project", INFO,
                f'"{title}" - {slides} slides, {els} elements (importing REPLACES this)')
    except Exception as e:
        rep.add("Current project", WARN, f"work/manifest.json unreadable: {e}",
                fix="re-import the deck, or restore a backup")


# ----------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Check a Skull Studio installation.")
    ap.add_argument("--root", help="path to the skull-studio repo (auto-detected otherwise)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--quiet", action="store_true", help="only show problems")
    a = ap.parse_args()

    # deck titles routinely contain em-dashes; a cp1252 console would crash on them
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    root = find_root(a.root)
    rep = Report()

    check_python(rep)
    check_node(rep)
    check_repo(rep, root)
    check_vendor(rep, root)
    check_package(rep, root)
    check_console_script(rep)
    check_rapidocr(rep)
    check_ffmpeg(rep)
    check_libreoffice(rep)
    check_uv(rep)
    check_mineru(rep)
    check_running_studio(rep)
    check_project_state(rep, root)

    if a.json:
        print(json.dumps({"ok": not rep.failed, "root": str(root) if root else None,
                          "platform": platform.platform(), "checks": rep.rows}, indent=2))
        return 1 if rep.failed else 0

    print("Skull Studio doctor")
    print("=" * 68)
    for r in rep.rows:
        if a.quiet and r["status"] in (OK, INFO):
            continue
        line = f'{GLYPH[r["status"]]} {r["check"]}'
        if r["detail"]:
            line += f'  -  {r["detail"]}'
        print(line)
        if r["fix"] and r["status"] != OK:
            print(f'         fix: {r["fix"]}')
    print("=" * 68)
    if rep.failed:
        print("RESULT: not ready - fix the [FAIL] rows above, then re-run this script.")
        return 1
    warns = sum(1 for r in rep.rows if r["status"] == WARN)
    print(f"RESULT: ready to use ({warns} optional component(s) missing)."
          if warns else "RESULT: ready to use - everything present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
