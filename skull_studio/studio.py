"""Skull Studio - standalone editor app (local server + browser UI).

FineReader-style workflow:
  import PDF (auto first pass) -> edit boxes & animations visually -> export HTML.

Run:  python -m skull_studio.studio  [--port 8765] [--no-browser]
Then the browser opens http://localhost:8765 (home) / .../editor (the editor).

Dev-mode editor differences vs the built single file:
  - manifest fetched from /api/manifest, saved back on every edit (no localStorage)
  - assets served from work/ (no base64) -> instant reload after re-crop
  - element boxes can be moved/resized; "Re-crop" regenerates crops on disk

No dependencies beyond the stdlib; pipeline stages run as subprocesses.
"""
import argparse
import json
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent          # the skull_studio package dir
ROOT = SCRIPTS.parent                               # repo root (holds runtime/, work/)
WORK = ROOT / "work"
RUNTIME = ROOT / "runtime"

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json",
        ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css",
        ".pdf": "application/pdf"}

# ---------------------------------------------------------------- job runner
class Jobs:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = None      # task name or None
        self.log = []
        self.ok = None

    def start(self, name, argv_list):
        with self.lock:
            if self.running:
                return False
            self.running, self.log, self.ok = name, [f"=== {name} ==="], None
        threading.Thread(target=self._run, args=(name, argv_list), daemon=True).start()
        return True

    def _run(self, name, argv_list):
        ok = True
        for argv in argv_list:
            self.log.append("$ " + " ".join(str(a) for a in argv))
            try:
                p = subprocess.Popen([str(a) for a in argv], cwd=ROOT, text=True,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     encoding="utf-8", errors="replace")
                for line in p.stdout:
                    self.log.append(line.rstrip()[:300])
                    if len(self.log) > 400:
                        del self.log[1:100]
                if p.wait() != 0:
                    self.log.append(f"FAILED (exit {p.returncode})")
                    ok = False
                    break
            except Exception as e:
                self.log.append(f"ERROR: {e}")
                ok = False
                break
        with self.lock:
            self.running, self.ok = None, ok
            self.log.append("=== done ===" if ok else "=== failed ===")


JOBS = Jobs()
PY = sys.executable

TASKS = {
    "import": lambda pdf: [[PY, SCRIPTS / "pipeline.py", ROOT / pdf, "--no-build"]],
    "import-nomineru": lambda pdf: [[PY, SCRIPTS / "pipeline.py", ROOT / pdf, "--no-build", "--skip-mineru"]],
    "import-pptx": lambda pptx: [
        [PY, SCRIPTS / "extract_pptx.py", "render", ROOT / pptx],
        [PY, SCRIPTS / "extract_pptx.py", "mineru", ROOT / pptx],
        [PY, SCRIPTS / "extract_pptx.py", "draft", ROOT / pptx],
        [PY, SCRIPTS / "auto_choreo.py"],
        [PY, SCRIPTS / "crop_and_patch.py"],
        [PY, SCRIPTS / "debug_overlay.py"]],
    "export-pptx": lambda _=None: [[PY, SCRIPTS / "export_pptx.py"]],
    "export-pptx-jpg": lambda _=None: [[PY, SCRIPTS / "export_pptx.py", "--format", "jpg"]],
    "export-pptx-layers": lambda _=None: [[PY, SCRIPTS / "export_pptx.py", "--patches"]],
    "export-pptx-custom": lambda opts=None: _export_pptx_cmds(opts),
    "import-file": lambda path: [[PY, SCRIPTS / "pipeline.py", _safe_out(path, ""), "--no-build"]],
    "build-custom": lambda opts=None: _build_html_cmds(opts),
    "export-baked": lambda opts=None: _build_baked_cmds(opts),
    "render-clips": lambda opts=None: [[PY, SCRIPTS / "render_clips.py", "--format",
                                        (opts or {}).get("format", "mp4"), "--fps",
                                        str(int((opts or {}).get("fps") or 18))]],
    "crops": lambda _=None: [[PY, SCRIPTS / "crop_and_patch.py"],
                             [PY, SCRIPTS / "debug_overlay.py"]],
    "choreo": lambda _=None: [[PY, SCRIPTS / "auto_choreo.py"]],
    "overlays": lambda _=None: [[PY, SCRIPTS / "debug_overlay.py"]],
    "mineru": lambda pdf: [[PY, SCRIPTS / "extract.py", "mineru", ROOT / pdf],
                           [PY, SCRIPTS / "extract.py", "draft", ROOT / pdf]],
    "build": lambda _=None: [[PY, SCRIPTS / "validate_manifest.py"],
                             ["node", SCRIPTS / "build.mjs"],
                             ["node", SCRIPTS / "build.mjs", "--editor"]],
    "build-embed": lambda _=None: [[PY, SCRIPTS / "validate_manifest.py"],
                                   ["node", SCRIPTS / "build.mjs", "--embed-editor",
                                    "--out", "dist/presentation_with_editor.html"]],
    # viewer-only build for the editor's Preview button (fastest path)
    "preview": lambda _=None: [[PY, SCRIPTS / "validate_manifest.py"],
                               ["node", SCRIPTS / "build.mjs"]],
}

def _browse(raw, exts):
    """List a server-side directory: subdirs + files filtered by extension.
    On Windows the '::drives' sentinel lists drive roots (to go above C:\\);
    on POSIX the filesystem root '/' is the top, so there is no drive list."""
    import os
    import string
    is_windows = os.name == "nt"
    if raw == "::drives" and is_windows:
        drives = [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
        return {"path": "::drives", "label": "This PC", "parent": None, "sep": os.sep,
                "dirs": drives, "files": []}
    try:
        base = Path(raw).resolve()
    except Exception:
        base = ROOT
    if not base.exists() or not base.is_dir():
        base = ROOT
    dirs, files = [], []
    try:
        for p in sorted(base.iterdir(), key=lambda x: x.name.lower()):
            try:
                if p.is_dir():
                    dirs.append(p.name)
                elif not exts or p.suffix.lower().lstrip(".") in exts:
                    files.append(p.name)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError):
        pass
    if base.parent != base:
        parent = str(base.parent)
    else:
        parent = "::drives" if is_windows else None   # POSIX root has no parent
    return {"path": str(base), "label": str(base), "parent": parent, "sep": os.sep,
            "dirs": dirs, "files": files}


def _safe_out(raw, default):
    """Resolve a user-supplied output path (relative to ROOT or absolute)."""
    if not raw:
        return ROOT / default
    p = Path(raw)
    return p if p.is_absolute() else (ROOT / p)


def _export_pptx_cmds(opts):
    """Build the PPTX export command chain (render clips first if requested)."""
    opts = opts or {}
    out = _safe_out(opts.get("out"), "dist/presentation.pptx")
    cmds = []
    clips = opts.get("clips")
    fps = int(opts.get("fps") or 18)
    if clips in ("mp4", "gif"):
        cmds.append([PY, SCRIPTS / "render_clips.py", "--format", clips, "--fps", str(fps)])
    cmd = [PY, SCRIPTS / "export_pptx.py", str(out)]
    if opts.get("format") == "jpg":
        cmd += ["--format", "jpg"]
        if opts.get("quality"):
            cmd += ["--quality", str(int(opts["quality"]))]
    if opts.get("fontSize"):
        cmd += ["--font-size", str(int(opts["fontSize"]))]
    if opts.get("fontScale") and abs(float(opts["fontScale"]) - 1.0) > 1e-6:
        cmd += ["--font-scale", str(float(opts["fontScale"]))]
    if opts.get("patches"):
        cmd += ["--patches"]
    if opts.get("animate"):
        cmd += ["--animate"]
    if clips in ("mp4", "gif"):
        cmd += ["--clips", clips, "--fps", str(fps)]
    cmds.append(cmd)
    return cmds


def _build_html_cmds(opts):
    opts = opts or {}
    out = _safe_out(opts.get("out"), "dist/presentation.html")
    cmd = ["node", SCRIPTS / "build.mjs", "--out", str(out)]
    if opts.get("embedEditor"):
        cmd += ["--embed-editor"]
    return [cmd]


def _build_baked_cmds(opts):
    opts = opts or {}
    out = _safe_out(opts.get("out"), "dist/baked.html")
    fmt = opts.get("format", "mp4")
    cmds = [[PY, SCRIPTS / "render_clips.py", "--format", fmt, "--fps", str(int(opts.get("fps") or 18))]]
    cmd = ["node", SCRIPTS / "build_baked.mjs", "--out", str(out), "--format", fmt,
           "--assets", opts.get("assets", "base64")]
    cmds.append(cmd)
    return cmds


_OCR_ENGINE = None
def region_ocr(page_index, bbox):
    """OCR a normalized-bbox region of a rendered slide. Local, no network."""
    global _OCR_ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return None, "RapidOCR not installed - run: uv add rapidocr-onnxruntime"
    import numpy as np
    from PIL import Image
    png = WORK / "slides" / f"slide_{page_index + 1:02d}.png"
    if not png.exists():
        return None, "slide render missing - run import first"
    img = Image.open(png).convert("RGB")
    W, H = img.size
    x0, y0, x1, y1 = (max(0, int(bbox[0] * W) - 4), max(0, int(bbox[1] * H) - 4),
                      min(W, int(bbox[2] * W) + 4), min(H, int(bbox[3] * H) + 4))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None, "region too small"
    if _OCR_ENGINE is None:
        _OCR_ENGINE = RapidOCR()
    result, _ = _OCR_ENGINE(np.asarray(img.crop((x0, y0, x1, y1))))
    text = " ".join(r[1] for r in (result or [])).strip()
    return text, None

# ---------------------------------------------------------------- pages
HOME = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Skull Studio</title><style>
body{background:#111;color:#ddd;font:14px/1.5 system-ui;max-width:780px;margin:40px auto;padding:0 20px}
h1{color:#c9a227;font-weight:600} a{color:#c9a227}
button{background:#26262c;color:#ddd;border:1px solid #444;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit;margin:3px}
button:hover{border-color:#c9a227;color:#c9a227}
#log{background:#0a0a0c;border:1px solid #333;border-radius:8px;padding:10px;height:280px;overflow-y:auto;font:12px/1.4 monospace;white-space:pre-wrap;margin-top:14px}
.pill{display:inline-block;background:#1d1d22;border:1px solid #333;border-radius:99px;padding:2px 12px;margin:2px;font-size:12px}
section{margin:22px 0}</style></head><body>
<h1>Skull Studio</h1>
<p>PDF &rarr; auto segmentation &amp; animation &rarr; visual editing &rarr; single-file HTML.</p>
<section><b>1 &middot; Import</b> (first pass: render, OCR layout, auto-choreography, crops)<br>
<span id="pdfs"></span><span id="pptxs"></span>
<div style="margin-top:8px">or a file anywhere:
<input id="imppath" placeholder="full path to a .pdf or .pptx (e.g. sample/demo.pdf)" style="width:46%;background:#101014;color:#ddd;border:1px solid #333;border-radius:5px;padding:5px">
<button onclick="run('import-file', document.getElementById('imppath').value)">Import file</button></div></section>
<section><b>2 &middot; Edit</b> &mdash; <a href="/editor" target="_blank">open the editor</a>
<span class="pill" id="state">checking&hellip;</span></section>
<section><b>3 &middot; Export</b>
<button onclick="run('build')" title="presentation.html (viewer-only, compact) + editor.html (full editor)">Build viewer + editor</button>
<button onclick="run('build-embed')" title="presentation_with_editor.html - one file that presents AND edits (press E)">Build with embedded editor</button>
<button onclick="run('export-pptx')" title="presentation.pptx - PNG pictures, lossless (larger)">Export PPTX (PNG)</button>
<button onclick="run('export-pptx-jpg')" title="presentation.pptx - JPEG pictures, much smaller file">Export PPTX (JPEG)</button>
<button onclick="run('export-pptx-layers')" title="presentation.pptx - also include each element's fill/blur footprint patch as a shape underneath">Export PPTX (+ patch layer)</button>
<span id="dist"></span></section>
<div id="log"></div>
<script>
async function refresh(){
  const s = await (await fetch('/api/state')).json();
  document.getElementById('pdfs').innerHTML = s.pdfs.map(p =>
    `<span class="pill">${p}</span> <button onclick="run('import','${p}')">Import</button>` +
    `<button onclick="run('import-nomineru','${p}')">Import (no OCR)</button><br>`).join('') || '(no PDFs in project folder)';
  document.getElementById('pptxs').innerHTML = (s.pptxs||[]).map(p =>
    `<span class="pill">${p}</span> <button onclick="run('import-pptx','${p}')">Import PPTX</button><br>`).join('');
  document.getElementById('state').textContent = s.manifest ? `${s.slides} slides, ${s.elements} elements` : 'no project yet - import a PDF';
  document.getElementById('dist').innerHTML = s.dist.map(d => `<span class="pill">${d}</span>`).join('');
  const st = await (await fetch('/api/status')).json();
  document.getElementById('log').textContent = st.log.join('\\n');
  const el = document.getElementById('log'); el.scrollTop = el.scrollHeight;
  if (st.running) setTimeout(refresh, 1200);
}
async function run(task, arg){
  await fetch('/api/run', {method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({task, arg})});
  setTimeout(refresh, 400);
}
refresh();
</script></body></html>"""


def editor_page():
    html = (RUNTIME / "template.html").read_text(encoding="utf-8")
    vendor = ('<script src="/runtime/vendor/pixi.min.js"></script>\n'
              '<script src="/runtime/vendor/gsap.min.js"></script>')
    src_tags = "\n".join(f'<script src="/runtime/src/{f.name}"></script>'
                         for f in sorted((RUNTIME / "src").glob("*.js")))
    html = (html
            .replace("{{TITLE}}", "Skull Studio - editor")
            .replace("{{VENDOR}}", vendor)
            .replace("{{MANIFEST}}", "null")
            .replace("<script>{{ASSETS}}</script>",
                     "<script>window.STUDIO=true;window.ASSET_BASE='/work/';"
                     "window.EDITOR_AUTOOPEN=true;</script>")
            .replace("<script>{{RUNTIME}}</script>", src_tags))
    return html


# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode() \
            if not isinstance(body, str) else body.encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _static(self, base, rel):
        p = (base / rel).resolve()
        if not str(p).startswith(str(base.resolve())) or not p.is_file():
            return self._send(404, {"error": "not found"})
        self._send(200, p.read_bytes(), MIME.get(p.suffix.lower(), "application/octet-stream"))

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self._send(200, HOME, "text/html; charset=utf-8")
        if path == "/editor":
            return self._send(200, editor_page(), "text/html; charset=utf-8")
        if path.startswith("/runtime/"):
            return self._static(RUNTIME, path[len("/runtime/"):])
        if path.startswith("/work/"):
            return self._static(WORK, path[len("/work/"):])
        if path.startswith("/dist/"):
            return self._static(ROOT / "dist", path[len("/dist/"):])
        if path == "/api/manifest":
            mf = WORK / "manifest.json"
            if not mf.exists():
                return self._send(404, {"error": "no manifest - import a PDF first"})
            return self._send(200, mf.read_bytes(),
                              headers={"x-manifest-rev": str(mf.stat().st_mtime_ns)})
        if path == "/api/status":
            return self._send(200, {"running": JOBS.running, "ok": JOBS.ok, "log": JOBS.log[-120:]})
        if path == "/api/state":
            mf = WORK / "manifest.json"
            state = {"pdfs": sorted(p.name for p in ROOT.glob("*.pdf")),
                     "pptxs": sorted(p.name for p in ROOT.glob("*.pptx")),
                     "manifest": mf.exists(), "slides": 0, "elements": 0,
                     "dist": sorted(p.name for p in (ROOT / "dist").glob("*.html"))
                            + sorted(p.name for p in (ROOT / "dist").glob("*.pptx"))}
            if mf.exists():
                try:
                    m = json.loads(mf.read_text(encoding="utf-8"))
                    state["slides"] = len(m["slides"])
                    state["elements"] = sum(len(s["elements"]) for s in m["slides"])
                except Exception:
                    pass
            return self._send(200, state)
        if path == "/api/browse":
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            raw = (qs.get("path") or [str(ROOT)])[0]
            exts = [e.lower() for e in (qs.get("ext") or [""])[0].split(",") if e]
            return self._send(200, _browse(raw, exts))
        self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        path = self.path.split("?")[0]
        if path == "/api/manifest":
            # optimistic lock: refuse saves from tabs holding an older manifest
            # (a stale tab would otherwise silently clobber newer disk state)
            mf = WORK / "manifest.json"
            client_rev = self.headers.get("x-manifest-rev")
            if client_rev and mf.exists() and client_rev != str(mf.stat().st_mtime_ns):
                return self._send(409, {"error": "manifest changed on disk - reload this tab"})
            try:
                m = json.loads(body.decode("utf-8"))
                assert "slides" in m and "deck" in m
            except Exception as e:
                return self._send(400, {"error": f"bad manifest: {e}"})
            tmp = WORK / "manifest.json.tmp"
            tmp.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(mf)
            return self._send(200, {"saved": True, "rev": str(mf.stat().st_mtime_ns)})
        if path == "/api/ocr":
            try:
                req = json.loads(body.decode("utf-8"))
                text, err = region_ocr(int(req["page"]), [float(v) for v in req["bbox"]])
                if err:
                    return self._send(400, {"error": err})
                return self._send(200, {"text": text})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        if path == "/api/run":
            try:
                req = json.loads(body.decode("utf-8"))
                task, arg = req.get("task"), req.get("arg")
                if task not in TASKS:
                    return self._send(400, {"error": "unknown task"})
                if task.startswith("import") and not (ROOT / (arg or "")).is_file():
                    return self._send(400, {"error": "pdf not found"})
                started = JOBS.start(task, TASKS[task](arg))
                return self._send(200 if started else 409,
                                  {"started": started, "running": JOBS.running})
            except Exception as e:
                return self._send(400, {"error": str(e)})
        self._send(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--editor", action="store_true", help="open the editor instead of the home page")
    a = ap.parse_args()

    # bind the requested port, or walk forward if it's already taken (a stray
    # studio from a previous run) so the launcher never fails confusingly
    server = port = None
    for p in range(a.port, a.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f"No free port near {a.port}. Close other Skull Studio windows and retry.")

    url = f"http://localhost:{port}"
    if port != a.port:
        print(f"(port {a.port} busy - using {port})")
    print("=" * 52)
    print(f"  Skull Studio is running at:  {url}")
    print(f"  Editor:                      {url}/editor")
    print("  Leave this window open. Press Ctrl+C to stop.")
    print("=" * 52)
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url + ("/editor" if a.editor else ""))).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSkull Studio stopped.")


if __name__ == "__main__":
    main()
