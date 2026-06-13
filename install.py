#!/usr/bin/env python3
"""Skull Studio installer (cross-platform).

    python install.py            # full setup
    python install.py --no-ocr  # skip the heavy MinerU OCR backend

Steps: check prerequisites, install this package (editable), fetch the pinned
PixiJS/GSAP runtime libs, and optionally install MinerU. Run from the repo root.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PKG = ROOT / "skull_studio"


def ok(msg): print(f"  [ok]   {msg}")
def warn(msg): print(f"  [warn] {msg}")
def err(msg): print(f"  [ERR]  {msg}")


def have(cmd):
    return shutil.which(cmd)


def run(cmd, **kw):
    print("  $ " + " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def check_prereqs():
    print("Checking prerequisites...")
    if sys.version_info < (3, 10):
        err(f"Python 3.10+ required (found {sys.version.split()[0]})."); sys.exit(1)
    ok(f"Python {sys.version.split()[0]}")

    node = have("node")
    if not node:
        err("Node.js 18+ not found - required to build HTML output.\n"
            "        Install from https://nodejs.org/ (or: winget install OpenJS.NodeJS / brew install node / apt install nodejs)")
        sys.exit(1)
    try:
        v = subprocess.check_output(["node", "--version"], text=True).strip()
        ok(f"Node {v}")
    except Exception:
        warn("Node found but version check failed")

    if have("ffmpeg"):
        ok("ffmpeg (video/GIF baking)")
    else:
        warn("ffmpeg not found - video/GIF baking will be unavailable.\n"
             "        winget install Gyan.FFmpeg | brew install ffmpeg | apt install ffmpeg")

    soffice = have("soffice") or have("libreoffice") or any(
        Path(p).exists() for p in (
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            "/Applications/LibreOffice.app/Contents/MacOS/soffice"))
    if soffice:
        ok("LibreOffice (PPTX import)")
    else:
        warn("LibreOffice not found - PPTX import will be unavailable (PDF still works).\n"
             "        winget install TheDocumentFoundation.LibreOffice | brew install --cask libreoffice | apt install libreoffice")


def install_package():
    print("\nInstalling Python package + dependencies...")
    if have("uv"):
        run(["uv", "pip", "install", "-e", "."], cwd=ROOT)
    else:
        run([sys.executable, "-m", "pip", "install", "-e", "."], cwd=ROOT)
    ok("package installed (editable)")


def fetch_libs():
    print("\nFetching pinned PixiJS + GSAP...")
    run(["node", str(PKG / "fetch_libs.mjs")])
    ok("runtime libs vendored -> runtime/vendor/")


def install_ocr():
    print("\nInstalling MinerU OCR backend (optional, ~GB download)...")
    if have("uv"):
        run(["uv", "tool", "install", "mineru[core]"])
        ok("MinerU installed (uv tool)")
    else:
        warn("uv not found - install MinerU manually: pip install \"mineru[core]\"  (or install uv first)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ocr", action="store_true", help="skip the MinerU OCR backend")
    a = ap.parse_args()

    print("=== Skull Studio setup ===\n")
    check_prereqs()
    install_package()
    fetch_libs()

    if not a.no_ocr:
        try:
            ans = input("\nInstall MinerU OCR backend now? (recovers text from image-only decks; ~GB) [y/N] ")
        except EOFError:
            ans = "n"
        if ans.strip().lower().startswith("y"):
            install_ocr()
        else:
            print("  skipped - run later with:  uv tool install \"mineru[core]\"")

    print("\n=== Done ===")
    print("Launch the editor:")
    print("    skull-studio            (or:  uv run skull-studio)")
    print("Then import sample/demo.pdf from the Studio home page to try it.")


if __name__ == "__main__":
    main()
