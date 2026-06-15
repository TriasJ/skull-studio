#!/usr/bin/env python3
"""Skull Studio launcher — start the editor with one double-click.

Cross-platform and install-free: it runs the package straight from this folder
(no `pip install` needed), downloads the vendored browser libraries on first run
if they're missing, then starts the local server and opens your browser.

Flags pass straight through to the server, e.g.:
    python launch.py --editor          # open the editor instead of the home page
    python launch.py --port 8780       # pick a port
    python launch.py --no-browser      # don't auto-open a browser
"""
import os
import sys
from pathlib import Path
from shutil import which

ROOT = Path(__file__).resolve().parent


def run():
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))          # import skull_studio in place (no install)

    if sys.version_info < (3, 10):
        print(f"Python 3.10+ is required (found {sys.version.split()[0]}).")
        return

    node = which("node")
    vendor = ROOT / "runtime" / "vendor"
    if not (vendor / "pixi.min.js").exists():
        if node:
            print("First run: downloading vendored libraries (PixiJS, GSAP, three.js)...")
            import subprocess
            subprocess.run([node, str(ROOT / "skull_studio" / "fetch_libs.mjs")], check=False)
        else:
            print("Heads up: Node.js was not found and the runtime libraries aren't vendored yet.\n"
                  "Install Node (https://nodejs.org) and run again, or `node skull_studio/fetch_libs.mjs`.")
    elif not node:
        print("Note: Node.js not found - editing works, but building/exporting HTML needs Node.")

    try:
        import skull_studio.studio as studio
    except Exception as e:
        print(f"Could not load Skull Studio from {ROOT}: {e}")
        return
    studio.main()                          # serves + opens the browser; Ctrl+C to stop


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nSkull Studio stopped.")
    except Exception as e:                 # keep a double-clicked window open to show the error
        print("Error:", e)
        try:
            input("\nPress Enter to close...")
        except Exception:
            pass
