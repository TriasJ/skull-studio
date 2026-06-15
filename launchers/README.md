# Launchers

Double-click wrappers that start Skull Studio (local server + browser). They all
call the cross-platform `launch.py` in the repo root, which runs the app **in
place — no `pip install` required** — and fetches the vendored browser libraries
on first run.

| Platform | File | How |
|----------|------|-----|
| **Windows** | `Skull Studio.cmd` | double-click |
| **macOS** | `Skull Studio.command` | double-click (first time: right-click → Open, or `chmod +x`) |
| **Linux** | `skull-studio.sh` | run it, or double-click if your file manager allows launching scripts |
| **Linux (menu entry)** | `skull-studio.desktop` | edit the two paths inside, copy to `~/.local/share/applications/`, `chmod +x` |

`install.py` marks the `.command`/`.sh`/`launch.py` executable for you on macOS/Linux.

The truly system-agnostic option is just:

```bash
python launch.py            # any OS; add --editor / --port N / --no-browser
```

A standalone single-file **`.exe`** (or macOS/Linux binary) can be built optionally
with [PyInstaller](https://pyinstaller.org/):

```bash
pip install pyinstaller
pyinstaller --onefile --name "Skull Studio" launch.py
```

(left out of the repo by default — it's a large binary and not needed when Python
is available.)
