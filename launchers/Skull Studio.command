#!/bin/bash
# Double-click launcher for Skull Studio (macOS). Make executable once:
#   chmod +x "launchers/Skull Studio.command"   (install.py does this for you)
cd "$(dirname "$0")/.." || exit 1
exec python3 launch.py "$@"
