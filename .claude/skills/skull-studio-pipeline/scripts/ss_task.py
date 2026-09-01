#!/usr/bin/env python3
"""Talk to a running Skull Studio server: run jobs, read state, read/write the manifest.

The studio binds 127.0.0.1:8765 and walks forward if that port is busy, so this
script probes 8765-8785 and uses the first one that answers /api/state.

Examples
--------
    python ss_task.py --state
    python ss_task.py --task import-rapid --arg deck.pdf
    python ss_task.py --task export-pptx-custom --arg '{"out":"dist/d.pptx","format":"jpg"}'
    python ss_task.py --list-tasks
    python ss_task.py --get-manifest work/manifest.json
    python ss_task.py --put-manifest edited.json

Exit code 0 on success, 1 on job failure or HTTP error, 2 when no studio is running.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request

PORT_RANGE = range(8765, 8786)
POLL_SECONDS = 0.4

# studio.py TASKS - names only; see references/http-api.md for the arg shapes.
KNOWN_TASKS = [
    "import", "import-nomineru", "import-rapid", "import-pptx", "import-pptx-rapid",
    "import-file", "mineru", "choreo", "crops", "overlays",
    "build", "build-embed", "build-custom", "preview",
    "export-pptx", "export-pptx-jpg", "export-pptx-layers", "export-pptx-custom",
    "export-baked", "render-clips", "export-element", "render-element-clip",
    "showcase", "showcase-pptx",
]


def find_base(explicit: int | None) -> str | None:
    """Return the base URL of a live studio, or None."""
    ports = [explicit] if explicit else list(PORT_RANGE)
    for port in ports:
        with socket.socket() as s:
            s.settimeout(0.08)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                continue
        base = f"http://127.0.0.1:{port}"
        try:
            get(base + "/api/state")
            return base
        except Exception:
            continue
    return None


def get(url: str) -> tuple[dict, dict]:
    """GET JSON. Returns (payload, response headers)."""
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")), dict(r.headers)


def post(url: str, payload: dict, headers: dict | None = None) -> tuple[int, dict]:
    """POST JSON. Returns (status, payload). HTTP errors are returned, not raised."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"content-type": "application/json",
                                          **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return e.code, {"error": raw[:300]}


def new_lines(printed: list[str], log: list[str]) -> list[str]:
    """Lines in `log` not yet printed. /api/status returns only the last 120 lines
    and the server trims its own buffer, so match by overlap rather than by index."""
    if not printed:
        return log
    for k in range(min(len(printed), len(log)), 0, -1):
        if printed[-k:] == log[:k]:
            return log[k:]
    return log


def run_task(base: str, task: str, arg) -> int:
    status, resp = post(base + "/api/run", {"task": task, "arg": arg})
    if status == 409:
        print(f"another job is already running: {resp.get('running')}", file=sys.stderr)
        return 1
    if status != 200 or not resp.get("started"):
        print(f"could not start '{task}': {resp.get('error', resp)}", file=sys.stderr)
        return 1

    printed: list[str] = []
    while True:
        time.sleep(POLL_SECONDS)
        try:
            st, _ = get(base + "/api/status")
        except Exception as e:
            print(f"lost the studio while polling: {e}", file=sys.stderr)
            return 1
        for line in new_lines(printed, st.get("log") or []):
            print(line)
            printed.append(line)
        if not st.get("running"):
            ok = st.get("ok")
            if ok is False:
                print(f"task '{task}' FAILED", file=sys.stderr)
                return 1
            return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Drive a running Skull Studio server.")
    ap.add_argument("--port", type=int, help="skip discovery and use this port")
    ap.add_argument("--task", help="task name to run (see --list-tasks)")
    ap.add_argument("--arg", help="task argument: a JSON object, or a bare path for imports")
    ap.add_argument("--state", action="store_true", help="print /api/state and exit")
    ap.add_argument("--status", action="store_true", help="print the current job log and exit")
    ap.add_argument("--list-tasks", action="store_true", help="print the known task names")
    ap.add_argument("--get-manifest", metavar="OUT", help="save work/manifest.json to OUT ('-' for stdout)")
    ap.add_argument("--put-manifest", metavar="IN", help="upload IN as work/manifest.json")
    a = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    if a.list_tasks:
        print("\n".join(KNOWN_TASKS))
        return 0

    base = find_base(a.port)
    if not base:
        print("No Skull Studio server found on ports 8765-8785.\n"
              "Start one with:  skull-studio --no-browser", file=sys.stderr)
        return 2

    if a.state:
        state, _ = get(base + "/api/state")
        print(json.dumps(state, indent=2))
        return 0

    if a.status:
        st, _ = get(base + "/api/status")
        print("\n".join(st.get("log") or []))
        print(f"running={st.get('running')} ok={st.get('ok')}")
        return 0

    if a.get_manifest:
        with urllib.request.urlopen(base + "/api/manifest", timeout=30) as r:
            raw = r.read().decode("utf-8")
            rev = r.headers.get("x-manifest-rev")
        if a.get_manifest == "-":
            print(raw)
        else:
            with open(a.get_manifest, "w", encoding="utf-8") as f:
                f.write(raw)
            print(f"saved {a.get_manifest}  (x-manifest-rev {rev})")
        return 0

    if a.put_manifest:
        with open(a.put_manifest, encoding="utf-8") as f:
            manifest = json.load(f)
        # optimistic lock: send back the rev we just read, or the server 409s
        _, headers = get(base + "/api/manifest")
        rev = headers.get("x-manifest-rev")
        status, resp = post(base + "/api/manifest", manifest,
                            {"x-manifest-rev": rev} if rev else None)
        if status == 409:
            print("409: the manifest changed on disk since we read it. "
                  "Re-read it, re-apply your edit, and retry.", file=sys.stderr)
            return 1
        if status != 200:
            print(f"upload failed: {resp.get('error', resp)}", file=sys.stderr)
            return 1
        print(f"saved (rev {resp.get('rev')})")
        return 0

    if not a.task:
        ap.error("nothing to do: pass --task, --state, --status, or a manifest option")

    arg = a.arg
    if arg and arg.lstrip().startswith("{"):
        try:
            arg = json.loads(arg)
        except json.JSONDecodeError as e:
            print(f"--arg is not valid JSON: {e}", file=sys.stderr)
            return 1
    if a.task not in KNOWN_TASKS:
        print(f"warning: '{a.task}' is not in this script's task list; sending it anyway",
              file=sys.stderr)
    return run_task(base, a.task, arg)


if __name__ == "__main__":
    sys.exit(main())
