/* Studio menus + draw tools: File / Preprocess / Options / Tools menu bar,
   box & polygon element creation, deck options modal, region OCR helper.
   Active only when window.STUDIO (menu bar stays hidden in built files). */
(function () {
  "use strict";
  const S = window.SKULL;

  /* ---------------- server task helpers ---------------- */
  async function runTask(task, arg, opts = {}) {
    setStatus(task + "…");
    if (S.persist) await S.persist.saveStudio();
    const res = await fetch("/api/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, arg }),
    });
    if (!res.ok) { setStatus("busy - try again"); return false; }
    return new Promise((resolve) => {
      const poll = async () => {
        const st = await (await fetch("/api/status")).json();
        if (st.running) return setTimeout(poll, 900);
        setStatus(st.ok ? task + " done" : task + " FAILED (see Studio home log)");
        if (st.ok && opts.reload) location.reload();
        resolve(st.ok);
      };
      poll();
    });
  }
  function setStatus(msg) {
    const el = document.getElementById("ed-save-status");
    if (el) el.textContent = msg;
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  S.studio = {
    runTask,
    recrop: () => runTask("crops", null, { reload: true }),
    needsRecrop(what) {
      setStatus(`${what} changed - Re-crop & reload to apply`);
    },
    async preview() {
      const ok = await runTask("preview");
      if (ok) window.open("/dist/presentation.html", "_blank");
    },
    async ocrElement(el) {
      const v = S.manager.currentView;
      setStatus("OCR…");
      const res = await fetch("/api/ocr", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: v.spec.index, bbox: el.bbox }),
      });
      const data = await res.json();
      if (!res.ok) { setStatus(data.error || "OCR failed"); return null; }
      el.text = data.text || "";
      S.persist.markDirty(el.id);
      setStatus(data.text ? "OCR ok" : "OCR: no text found");
      return el.text;
    },
  };

  /* ---------------- draw tools (box / polygon) ---------------- */
  class DrawTools {
    constructor(editor) {
      this.editor = editor;
      this.tool = null;        // null | 'box' | 'poly'
      this.boxStart = null;
      this.boxNow = null;
      this.polyPts = [];       // design-space points
      this.counter = 0;

      const canvas = S.app.canvas;
      canvas.addEventListener("pointerdown", (e) => this.onDown(e));
      canvas.addEventListener("pointermove", (e) => this.onMove(e));
      canvas.addEventListener("pointerup", (e) => this.onUp(e));
      canvas.addEventListener("dblclick", () => this.tool === "poly" && this.closePoly());
      // right-click while drawing a polygon = undo last point
      canvas.addEventListener("contextmenu", (e) => {
        if (this.tool === "poly" && this.polyPts.length) {
          e.preventDefault();
          this.polyPts.pop();
        }
      });
      window.addEventListener("keydown", (e) => {
        if (!this.tool || this.editor.isTyping(e)) return;
        if (e.key === "Escape") this.setTool(null);
        if (e.key === "Enter" && this.tool === "poly") this.closePoly();
        if (e.key === "Backspace" && this.tool === "poly" && this.polyPts.length) {
          e.preventDefault();
          this.polyPts.pop();
        }
      });
    }

    setTool(tool) {
      this.tool = this.tool === tool ? null : tool;
      this.boxStart = null; this.boxNow = null; this.polyPts = []; this.cursorPt = null;
      if (!this.tool) this.regionTarget = null;
      if (this.tool && this.editor.rigEditor?.active) this.editor.rigEditor.close();
      for (const b of document.querySelectorAll("#skull-editor .tool")) {
        if (b.dataset.tool) b.classList.toggle("on", b.dataset.tool === this.tool);
      }
      S.app.canvas.style.cursor = this.tool ? "crosshair" : "default";
      if (!this.regionTarget) {
        setStatus(this.tool === "box" ? "drag a box (Esc to cancel)"
          : this.tool === "poly" ? "click vertices, Enter/double-click to close" : "");
      }
    }

    /* FineReader-style boolean areas: next drawn shape adds to / subtracts
       from the selected element's mask instead of creating a new element */
    armRegion(ev, op, shape) {
      this.regionTarget = { ev, op };
      this.tool = null;
      this.setTool(shape);          // setTool cleared regionTarget, re-set it:
      this.regionTarget = { ev, op };
      setStatus(`${op === "add" ? "ADD to" : "SUBTRACT from"} ${ev.spec.id}: draw a ${shape === "box" ? "box" : "polygon"} (Esc cancels)`);
    }

    local(e) { return S.root.toLocal({ x: e.clientX, y: e.clientY }); }

    onDown(e) {
      if (!this.tool || !this.editor.isOpen || e.button === 2) return;
      const p = this.local(e);
      if (this.tool === "box") { this.boxStart = p; this.boxNow = p; }
      else {
        // clicking the first node closes the polygon (FineReader-style)
        if (this.polyPts.length >= 3) {
          const f = this.polyPts[0];
          if (Math.hypot(p.x - f.x, p.y - f.y) < 12 / S.root.scale.x) {
            this.closePoly();
            e.stopPropagation();
            return;
          }
        }
        this.polyPts.push(p);
      }
      e.stopPropagation();
    }
    onMove(e) {
      if (!this.tool) return;
      this.cursorPt = this.local(e); // preview segment in gizmos
      if (this.tool === "box" && this.boxStart) this.boxNow = this.cursorPt;
    }
    onUp() {
      if (this.tool !== "box" || !this.boxStart) return;
      const deck = S.manager.deck;
      const a = this.boxStart, b = this.boxNow;
      this.boxStart = this.boxNow = null;
      const bbox = [
        Math.min(a.x, b.x) / deck.designWidth, Math.min(a.y, b.y) / deck.designHeight,
        Math.max(a.x, b.x) / deck.designWidth, Math.max(a.y, b.y) / deck.designHeight,
      ].map((v) => +S.clamp(v, 0, 1).toFixed(4));
      if (bbox[2] - bbox[0] < 0.01 || bbox[3] - bbox[1] < 0.01) return;
      if (this.regionTarget) {
        // rect as a 4-point polygon: regions are uniform
        this.applyRegion([[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]]);
      } else {
        this.createElement(bbox, null);
      }
    }
    closePoly() {
      if (this.polyPts.length < 3) { this.polyPts = []; return; }
      const deck = S.manager.deck;
      const poly = this.polyPts.map((p) => [
        +S.clamp(p.x / deck.designWidth, 0, 1).toFixed(4),
        +S.clamp(p.y / deck.designHeight, 0, 1).toFixed(4)]);
      this.polyPts = [];
      if (this.regionTarget) {
        this.applyRegion(poly);
        return;
      }
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      this.createElement(bbox, poly);
    }

    applyRegion(pts) {
      const { ev, op } = this.regionTarget;
      const spec = ev.spec;
      (spec.regions = spec.regions || []).push({ op, pts });
      if (op === "add") {
        // grow the bbox to cover added area (subtract never shrinks it)
        const xs = pts.map((p) => p[0]).concat([spec.bbox[0], spec.bbox[2]]);
        const ys = pts.map((p) => p[1]).concat([spec.bbox[1], spec.bbox[3]]);
        spec.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
          .map((v) => +S.clamp(v, 0, 1).toFixed(4));
        ev.relayout();
      }
      this.setTool(null);
      S.persist.markDirty(spec.id);
      this.editor.select(ev);
      S.studio.needsRecrop(`mask ${op} area`);
    }

    async createElement(bbox, polygon) {
      const v = S.manager.currentView;
      let id;
      do { id = `${v.spec.id}_d${++this.counter}`; }
      while (v.spec.elements.some((e) => e.id === id));
      const el = {
        id, type: "image", role: "figure", text: "",
        bbox, polygon, regions: null, crop: `crops/${id}.webp`, cropBbox: null,
        z: Math.max(0, ...v.spec.elements.map((e) => e.z || 0)) + 1,
        cleanup: "auto", fillColor: null, patch: null,
        entrance: { type: "fadeIn", delay: 0.5, duration: 0.9 },
        idle: [], parallax: 0.2, lines: null, rig: null,
      };
      v.spec.elements.push(el);
      S.persist.markDirty(id);
      // materialize immediately as an editable placeholder element
      const ev = new S.ElementView(el, S.manager.deck);
      await ev.build();
      v.elementLayer.addChild(ev.parallaxNode);
      v.elements.push(ev);
      this.editor.setElementInteractivity(true);
      this.editor.rebuildList();
      this.editor.select(ev);
      this.setTool(null);
      setStatus(`${id} created (green placeholder) - Re-crop & reload to show its pixels`);
    }

    drawGizmos(g) {
      if (this.tool === "box" && this.boxStart && this.boxNow) {
        const a = this.boxStart, b = this.boxNow;
        g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
          .stroke({ width: 2, color: 0x6ee76e, alpha: 0.9 });
      }
      if (this.tool === "poly" && this.polyPts.length) {
        g.moveTo(this.polyPts[0].x, this.polyPts[0].y);
        for (const p of this.polyPts.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: 2, color: 0x6ee76e, alpha: 0.9 });
        // live preview: last point -> cursor, and cursor -> first (closing hint)
        if (this.cursorPt) {
          const last = this.polyPts[this.polyPts.length - 1];
          g.moveTo(last.x, last.y).lineTo(this.cursorPt.x, this.cursorPt.y)
            .stroke({ width: 1, color: 0x6ee76e, alpha: 0.45 });
          if (this.polyPts.length >= 2) {
            g.moveTo(this.cursorPt.x, this.cursorPt.y).lineTo(this.polyPts[0].x, this.polyPts[0].y)
              .stroke({ width: 1, color: 0x6ee76e, alpha: 0.2 });
          }
        }
        for (const p of this.polyPts.slice(1)) g.circle(p.x, p.y, 4).fill(0x6ee76e);
        // first node: ring target - click it to close
        const f = this.polyPts[0];
        const r = 12 / S.root.scale.x;
        const near = this.cursorPt && Math.hypot(this.cursorPt.x - f.x, this.cursorPt.y - f.y) < r;
        g.circle(f.x, f.y, near ? 8 : 6)
          .fill({ color: near ? 0xffffff : 0x6ee76e, alpha: 0.95 })
          .stroke({ width: 2, color: 0x6ee76e, alpha: 0.9 });
      }
    }
  }

  /* ---------------- menus ---------------- */
  function menu(title, items) {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = title;
    d.appendChild(s);
    const dd = document.createElement("div");
    dd.className = "dd";
    for (const it of items) {
      if (it === "-") { dd.appendChild(document.createElement("hr")); continue; }
      const b = document.createElement("button");
      b.innerHTML = it.label + (it.kbd ? `<span class="kbd">${it.kbd}</span>` : "");
      if (it.tool) { b.classList.add("tool"); b.dataset.tool = it.tool; }
      b.onclick = () => { d.removeAttribute("open"); it.run(); };
      dd.appendChild(b);
    }
    d.appendChild(dd);
    return d;
  }

  function buildMenus(editor) {
    const bar = document.getElementById("ed-menubar");
    bar.classList.add("studio");
    const tools = (editor.drawTools = new DrawTools(editor));

    bar.appendChild(menu("File", [
      { label: "Save", kbd: "Ctrl+S", run: () => S.persist.saveStudio() },
      { label: "Reload from disk", run: () => location.reload() },
      "-",
      { label: "Preview presentation", run: () => S.studio.preview() },
      { label: "Import PDF / PPTX…", run: importFile },
      "-",
      { label: "Export HTML…", run: openHtmlExport },
      { label: "Export baked HTML (video/GIF)…", run: openBakedExport },
      { label: "Export PPTX (PowerPoint)…", run: openPptxExport },
      { label: "Export manifest.json", run: () => download("manifest.json", JSON.stringify(S.manager.manifest, null, 2)) },
      { label: "Export overrides.json", run: () => S.persist.exportOverrides() },
    ]));
    bar.appendChild(menu("Preprocess", [
      { label: "Run OCR layout (MinerU) + re-draft", run: () => importMineru() },
      { label: "Auto-choreography (overwrites animations)", run: async () => { if (confirm("Replace all animation settings with automatic ones?")) await runTask("choreo", null, { reload: true }); } },
      "-",
      { label: "Re-crop & reload", run: () => S.studio.recrop() },
      { label: "Regenerate debug overlays", run: () => runTask("overlays") },
    ]));
    bar.appendChild(menu("Tools", [
      { label: "Draw box element", kbd: "drag", tool: "box", run: () => tools.setTool("box") },
      { label: "Draw polygon element", kbd: "click+Enter", tool: "poly", run: () => tools.setTool("poly") },
      "-",
      { label: "OCR selected element", run: () => editor.selected && S.studio.ocrElement(editor.selected.spec).then(() => S.inspector.show(editor.selected)) },
      { label: "Delete selected element", kbd: "Ctrl+Del", run: () => editor.selected && editor.deleteElement(editor.selected) },
    ]));
    bar.appendChild(menu("Options", [
      { label: "Deck options…", run: openOptions },
    ]));
    bar.appendChild(menu("Help", [
      { label: "Editor help & shortcuts", run: () => document.getElementById("ed-help").classList.add("open") },
      { label: "Studio home (import/build/log)", run: () => window.open("/", "_blank") },
    ]));

    // always-visible toolbar buttons (top bar)
    const tbBox = document.getElementById("ed-tool-box");
    const tbPoly = document.getElementById("ed-tool-poly");
    if (tbBox) tbBox.onclick = () => tools.setTool("box");
    if (tbPoly) tbPoly.onclick = () => tools.setTool("poly");
    const tbPreview = document.getElementById("ed-preview");
    if (tbPreview) tbPreview.onclick = async () => {
      tbPreview.disabled = true;
      tbPreview.textContent = "Building…";
      await S.studio.preview();
      tbPreview.disabled = false;
      tbPreview.innerHTML = "&#9658; Preview";
    };

    // close menus on outside click
    document.addEventListener("pointerdown", (e) => {
      for (const d of bar.querySelectorAll("details[open]")) {
        if (!d.contains(e.target)) d.removeAttribute("open");
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); S.persist.saveStudio(); }
      if (e.ctrlKey && e.key === "Delete" && editor.selected) editor.deleteElement(editor.selected);
    });
  }

  async function importMineru() {
    const st = await (await fetch("/api/state")).json();
    const pdf = st.pdfs.length === 1 ? st.pdfs[0] :
      st.pdfs[parseInt(prompt("PDF?\n" + st.pdfs.map((p, i) => `${i + 1}. ${p}`).join("\n"), "1"), 10) - 1];
    if (pdf && confirm(`Run MinerU OCR on ${pdf} and re-draft the manifest? Manual edits to elements will be lost.`)) {
      await runTask("mineru", pdf, { reload: true });
    }
  }

  /* ---------------- server-backed file/folder browser ---------------- */
  function browse({ title = "Choose", ext = "", saveAs = false, defaultName = "", startPath = "" } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("ed-browse");
      const listEl = document.getElementById("brz-list");
      const pathEl = document.getElementById("brz-path");
      const nameRow = document.getElementById("brz-name-row");
      const nameEl = document.getElementById("brz-name");
      document.getElementById("brz-title").textContent = title;
      nameRow.style.display = saveAs ? "" : "none";
      nameEl.value = defaultName;
      let cur = null, sep = "/", selected = null;
      modal.classList.add("open");

      async function load(p) {
        const r = await fetch(`/api/browse?path=${encodeURIComponent(p)}&ext=${encodeURIComponent(ext)}`);
        const d = await r.json();
        cur = d.path; sep = d.sep || "/"; selected = null;
        pathEl.textContent = d.label || d.path;
        document.getElementById("brz-up").onclick = () => d.parent && load(d.parent);
        listEl.innerHTML = "";
        for (const dir of d.dirs) {
          const it = document.createElement("div");
          it.className = "brz-item brz-dir";
          it.textContent = dir.replace(/[\\/]$/, "");
          it.ondblclick = () => load(cur === "::drives" ? dir : join(cur, dir, sep));
          it.onclick = () => { selected = null; highlight(it); };
          listEl.appendChild(it);
        }
        for (const f of d.files) {
          const it = document.createElement("div");
          it.className = "brz-item brz-file";
          it.textContent = f;
          it.onclick = () => { selected = join(cur, f, sep); if (saveAs) nameEl.value = f; highlight(it); };
          it.ondblclick = () => { selected = join(cur, f, sep); finish(); };
          listEl.appendChild(it);
        }
      }
      function highlight(it) {
        for (const c of listEl.children) c.classList.toggle("sel", c === it);
      }
      function join(a, b, s) { return a.replace(/[\\/]$/, "") + s + b; }
      function finish() {
        modal.classList.remove("open");
        let out = saveAs ? join(cur, nameEl.value.trim(), sep) : selected;
        resolve(out || null);
      }
      document.getElementById("brz-cancel").onclick = () => { modal.classList.remove("open"); resolve(null); };
      document.getElementById("brz-ok").onclick = finish;
      load(startPath || ".");
    });
  }
  S.browse = browse;

  // wire a "…" browse button next to a path <input>
  function wireBrowse(btnId, inputId, opts) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      const cur = document.getElementById(inputId).value;
      const dir = cur.includes("/") || cur.includes("\\") ? cur.replace(/[\\/][^\\/]*$/, "") : "";
      const name = (cur.split(/[\\/]/).pop()) || opts.defaultName;
      const picked = await browse({ ...opts, saveAs: true, defaultName: name, startPath: dir });
      if (picked) document.getElementById(inputId).value = picked;
    };
  }

  /* ---------------- PPTX export modal ---------------- */
  function openPptxExport() {
    const modal = document.getElementById("ed-pptx");
    modal.classList.add("open");
    const fmt = document.getElementById("px-format");
    const qRow = document.getElementById("px-q-row");
    const clips = document.getElementById("px-clips");
    const fpsRow = document.getElementById("px-fps-row");
    const sync = () => {
      qRow.style.display = fmt.value === "jpg" ? "" : "none";
      fpsRow.style.display = clips.value !== "none" ? "" : "none";
    };
    fmt.onchange = sync; clips.onchange = sync; sync();
    wireBrowse("px-browse", "px-out", { title: "Save PowerPoint", ext: "pptx", defaultName: "presentation.pptx" });
    document.getElementById("px-cancel").onclick = () => modal.classList.remove("open");
    document.getElementById("px-go").onclick = () => {
      modal.classList.remove("open");
      runTask("export-pptx-custom", {
        format: fmt.value,
        quality: parseInt(document.getElementById("px-quality").value, 10) || 85,
        fontSize: parseInt(document.getElementById("px-fontsize").value, 10) || 0,
        patches: document.getElementById("px-patches").checked,
        animate: document.getElementById("px-animate").checked,
        clips: clips.value,
        fps: parseInt(document.getElementById("px-fps").value, 10) || 18,
        out: document.getElementById("px-out").value.trim(),
      });
    };
  }

  /* ---------------- HTML export modal ---------------- */
  function openHtmlExport() {
    const modal = document.getElementById("ed-html");
    modal.classList.add("open");
    wireBrowse("hx-browse", "hx-out", { title: "Save HTML", ext: "html", defaultName: "presentation.html" });
    document.getElementById("hx-cancel").onclick = () => modal.classList.remove("open");
    document.getElementById("hx-go").onclick = () => {
      modal.classList.remove("open");
      runTask("build-custom", {
        embedEditor: document.getElementById("hx-embed").checked,
        out: document.getElementById("hx-out").value.trim(),
      });
    };
  }

  /* ---------------- baked HTML export modal ---------------- */
  function openBakedExport() {
    const modal = document.getElementById("ed-baked");
    modal.classList.add("open");
    wireBrowse("bk-browse", "bk-out", { title: "Save baked HTML", ext: "html", defaultName: "baked.html" });
    document.getElementById("bk-cancel").onclick = () => modal.classList.remove("open");
    document.getElementById("bk-go").onclick = () => {
      modal.classList.remove("open");
      runTask("export-baked", {
        format: document.getElementById("bk-format").value,
        fps: parseInt(document.getElementById("bk-fps").value, 10) || 18,
        assets: document.getElementById("bk-assets").value,
        out: document.getElementById("bk-out").value.trim(),
      });
    };
  }

  /* ---------------- import a PDF/PPTX from anywhere ---------------- */
  async function importFile() {
    const path = await browse({ title: "Import PDF or PPTX", ext: "pdf,pptx" });
    if (path && confirm(`Import ${path}? This REPLACES the current project.`)) {
      await runTask("import-file", path, { reload: true });
    }
  }

  /* ---------------- options modal ---------------- */
  function openOptions() {
    const deck = S.manager.deck;
    const bo = (deck.buildOptions = deck.buildOptions || {});
    const body = document.getElementById("ed-options-body");
    const t = deck.transition || (deck.transition = { type: "crossfade", duration: 0.9 });
    body.innerHTML = `
      <div class="row"><label>transition</label><select id="opt-trans">
        ${["crossfade", "slideLeft", "none"].map((o) => `<option ${o === t.type ? "selected" : ""}>${o}</option>`).join("")}
      </select></div>
      <div class="row"><label>duration</label><input type="number" id="opt-dur" step="0.1" min="0" value="${t.duration}"></div>
      <div class="row"><label>bg quality</label><input type="number" id="opt-bgq" min="40" max="100" value="${bo.bgQuality ?? 78}"></div>
      <div class="row"><label>bg scale</label><input type="number" id="opt-bgs" step="0.25" min="0.5" max="2" value="${bo.bgScale ?? 1.0}"></div>
      <div id="ed-hint">bg quality/scale apply on the next Re-crop; they trade file size vs sharpness.</div>`;
    const modal = document.getElementById("ed-options");
    modal.classList.add("open");
    document.getElementById("ed-opt-cancel").onclick = () => modal.classList.remove("open");
    document.getElementById("ed-opt-save").onclick = () => {
      t.type = document.getElementById("opt-trans").value;
      t.duration = parseFloat(document.getElementById("opt-dur").value) || 0.9;
      bo.bgQuality = parseInt(document.getElementById("opt-bgq").value, 10) || 78;
      bo.bgScale = parseFloat(document.getElementById("opt-bgs").value) || 1.0;
      modal.classList.remove("open");
      S.persist.markDirty("__deck__");
      setStatus("options saved");
    };
  }

  S.initStudioMenus = function (editor) {
    if (window.STUDIO) buildMenus(editor);
  };
})();
