#!/bin/bash
# Launcher for Skull Studio (Linux / any Unix shell). Run it or double-click in a
# file manager that allows launching scripts. install.py marks it executable.
cd "$(dirname "$0")/.." || exit 1
exec python3 launch.py "$@"
