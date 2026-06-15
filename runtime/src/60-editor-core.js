/* Editor core: E-key toggle, selection, gizmo drawing, top-bar wiring. */
(function () {
  "use strict";
  const S = window.SKULL;

  class Editor {
    constructor(manager) {
      this.manager = manager;
      this.isOpen = false;
      this.selected = null;        // ElementView
      this.rigMode = false;        // bottom timeline panel open
      this._undo = [];             // studio undo/redo: per-slide manifest snapshots
      this._redo = [];
      this.dom = {
        rootEl: document.getElementById("skull-editor"),
        list: document.getElementById("ed-el-list"),
        inspector: document.getElementById("ed-inspector"),
        slideLabel: document.getElementById("ed-slide-label"),
        bottom: document.getElementById("ed-bottom"),
        saveStatus: document.getElementById("ed-save-status"),
      };
      this.gizmoG = new PIXI.Graphics();
      S.gizmos.addChild(this.gizmoG);
      if (window.STUDIO) this.dom.rootEl.classList.add("studio");

      window.addEventListener("keydown", (ev) => {
        if (ev.key.toLowerCase() === "e" && !this.isTyping(ev)) this.toggle();
        if (ev.key === "Escape" && this.isOpen) this.toggle();
        if (!this.isOpen || this.isTyping(ev)) return;
        // undo / redo (studio): snapshot-based, current-slide scope
        if (window.STUDIO && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
          ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); return;
        }
        if (window.STUDIO && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
          ev.preventDefault(); this.redo(); return;
        }
        // copy / paste an element (with its animations) across slides
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "c" && this.selected) {
          this._clipboard = S.deepClone(this.selected.spec);
        } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "v" && this._clipboard) {
          ev.preventDefault();
          this.pasteElement();
        } else if (window.STUDIO && this.selected && ev.key.indexOf("Arrow") === 0) {
          // nudge the selected box (Shift = larger step); Alt = snap centre to the arrow's axis
          ev.preventDefault();
          if (ev.altKey) {
            this.snapCenter(ev.key === "ArrowLeft" || ev.key === "ArrowRight" ? "x" : "y");
          } else {
            const s = ev.shiftKey ? 0.02 : 0.005;
            const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[ev.key];
            if (d) this.nudgeSelected(d[0], d[1]);
          }
        }
      });
      const filter = document.getElementById("ed-el-filter");
      if (filter) filter.oninput = (e) => this.setFilter(e.target.value);
      document.getElementById("ed-prev").onclick = () => manager.prev();
      document.getElementById("ed-next").onclick = () => manager.next();
      document.getElementById("ed-replay").onclick = () => {
        const v = manager.currentView;
        if (v) { v.buildTimeline(); v.timeline.restart(); }
      };
      document.getElementById("ed-reset").onclick = () => {
        if (this.selected && S.persist) S.persist.resetElement(this.selected.spec.id);
      };
      document.getElementById("ed-export").onclick = () => S.persist && S.persist.exportOverrides();
      const helpBtn = document.getElementById("ed-help-btn");
      const helpModal = document.getElementById("ed-help");
      if (helpBtn) helpBtn.onclick = () => helpModal.classList.add("open");
      const helpClose = document.getElementById("ed-help-close");
      if (helpClose) helpClose.onclick = () => helpModal.classList.remove("open");

      // floating 3D-object controls (shown only while a 3D model is selected)
      const bar3d = document.getElementById("ed-3dbar");
      if (bar3d) {
        bar3d.querySelectorAll("[data-mode]").forEach((b) =>
          (b.onclick = () => this.set3DMode(b.dataset.mode)));
        bar3d.querySelectorAll("[data-zoom]").forEach((b) =>
          (b.onclick = () => { const m = this.selected && this.selected.model3d; if (m) m.zoomBy(b.dataset.zoom === "in" ? 0.85 : 1.18); }));
        const r3 = document.getElementById("ed-3d-reset");
        if (r3) r3.onclick = () => { const m = this.selected && this.selected.model3d; if (m) m.resetView(); };
      }

      S.app.ticker.add(() => { if (this.isOpen) this.drawGizmos(); });
      if (window.STUDIO) this.bindBoxEditing();

      // double-click a rigged element to jump straight into its rig editor
      S.app.canvas.addEventListener("dblclick", () => {
        if (!this.isOpen) return;
        if (this.drawTools && this.drawTools.tool) return; // polygon uses dblclick
        if (this.rigEditor && this.rigEditor.active) return;
        const ev = this.selected;
        if (ev && ev.spec.rig) this.rigEditor.open(ev);
      });
    }

    /* studio only: drag selected element to move its bbox, drag the corner
       handle to resize. The crop texture is stale until "Re-crop & reload". */
    bindBoxEditing() {
      const canvas = S.app.canvas;
      const HANDLE = 14;
      let drag = null; // {mode:'move'|'resize', startX, startY, bbox0}
      canvas.addEventListener("pointerdown", (e) => {
        if (!this.isOpen || !this.selected) return;
        if (this.rigEditor && this.rigEditor.active) return;
        if (this.drawTools && this.drawTools.tool) return;
        const ev = this.selected;
        const p = S.root.toLocal({ x: e.clientX, y: e.clientY });
        const b = S.bboxToDesign(ev.spec.bbox, this.manager.deck);
        const nearCorner = Math.abs(p.x - (b.x + b.w)) < HANDLE && Math.abs(p.y - (b.y + b.h)) < HANDLE;
        const inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
        if (nearCorner || inside) {
          drag = { mode: nearCorner ? "resize" : "move", startX: p.x, startY: p.y,
                   bbox0: [...ev.spec.bbox] };
        }
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag || !this.selected) return;
        const ev = this.selected;
        const deck = this.manager.deck;
        const p = S.root.toLocal({ x: e.clientX, y: e.clientY });
        const dx = (p.x - drag.startX) / deck.designWidth;
        const dy = (p.y - drag.startY) / deck.designHeight;
        const b0 = drag.bbox0;
        let nb;
        if (drag.mode === "move") {
          nb = [b0[0] + dx, b0[1] + dy, b0[2] + dx, b0[3] + dy];
        } else {
          nb = [b0[0], b0[1], Math.max(b0[0] + 0.01, b0[2] + dx), Math.max(b0[1] + 0.01, b0[3] + dy)];
        }
        ev.spec.bbox = nb.map((v) => +S.clamp(v, 0, 1).toFixed(4));
        ev.relayout();
        this.boxEdited = true;
      });
      const end = () => {
        if (!drag) return;
        drag = null;
        if (this.boxEdited && this.selected) {
          this.boxEdited = false;
          if (S.persist) S.persist.markDirty(this.selected.spec.id);
          if (S.inspector) S.inspector.show(this.selected); // refresh bbox readout
        }
      };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointerleave", end);
    }

    isTyping(ev) {
      const t = ev.target;
      return t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    }

    toggle() {
      this.isOpen = !this.isOpen;
      this.dom.rootEl.classList.toggle("open", this.isOpen);
      this.setElementInteractivity(this.isOpen);
      if (!this.isOpen) {
        this.select(null);
        this.gizmoG.clear();
        if (this.rigEditor) this.rigEditor.close();
      } else {
        this.onSlideChanged();
      }
      this.updateInset();
    }

    /* dock the workspace between the panels while the editor is open */
    updateInset() {
      if (!S.setInset) return;
      if (!this.isOpen) return S.setInset(null);
      const rigOpen = this.rigEditor && this.rigEditor.active;
      this.dom.rootEl.classList.toggle("rig-open", !!rigOpen);
      S.setInset({ left: 220, right: 290, top: 60, bottom: rigOpen ? 180 : 12 });
    }

    setElementInteractivity(on) {
      const v = this.manager.currentView;
      if (!v || !v.elements) return;
      for (const ev of v.elements) {
        ev.view.eventMode = on ? "static" : "auto";
        ev.view.cursor = on ? "pointer" : "default";
        if (on && !ev.__edBound) {
          ev.__edBound = true;
          ev.view.on("pointerdown", (e) => {
            if (this.rigEditor && this.rigEditor.active) return; // rig editor owns clicks
            if (this.drawTools && this.drawTools.tool) return;   // draw tool owns clicks
            this.select(ev);
            e.stopPropagation();
          });
        }
      }
    }

    onSlideChanged() {
      if (!this.isOpen) return;
      const v = this.manager.currentView;
      this.dom.slideLabel.textContent = v ? v.spec.id : "-";
      this.select(null);
      this.setElementInteractivity(true);
      this.rebuildList();
    }

    rebuildList() {
      const v = this.manager.currentView;
      this.dom.list.innerHTML = "";
      if (!v) return;
      // background pseudo-entry (idle animation, etc.)
      const bgDiv = document.createElement("div");
      bgDiv.className = "el-item";
      const bgIdle = v.spec.background.idle;
      bgDiv.innerHTML = `<div>&#9632; Background <span class="sub">slide</span></div>` +
        `<div class="sub">idle: ${(bgIdle && bgIdle.type) || "none"}</div>`;
      bgDiv.onclick = () => this.selectBackground();
      this.__bgListItem = bgDiv;
      this.dom.list.appendChild(bgDiv);
      // sort by z so the list mirrors stacking order (top of list = front)
      const ordered = [...v.elements].sort((a, b) => (b.spec.z || 0) - (a.spec.z || 0));
      for (const ev of ordered) {
        const div = document.createElement("div");
        div.className = "el-item el-row";
        const thumb = this.thumbUri(ev.spec);
        div.innerHTML =
          (thumb ? `<img class="el-thumb" loading="lazy" src="${thumb}">` : `<span class="el-thumb el-thumb-x"></span>`) +
          `<div class="el-meta"><div class="el-name">${ev.spec.name || ev.spec.id}</div>` +
          `<div class="sub">${ev.spec.id} &middot; ${ev.spec.type}/${ev.spec.role || ""}` +
          `${(ev.spec.text ? " &middot; " + ev.spec.text.slice(0, 28) : "")}</div></div>`;
        div.onclick = () => this.select(ev);
        ev.__edListItem = div;
        this.dom.list.appendChild(div);
      }
      this.applyFilter();
    }

    thumbUri(spec) {
      if (!spec.crop) return null;
      if (window.ASSET_BASE) return window.ASSET_BASE + spec.crop + "?v=" + (S.assetEpoch || 0);
      return (window.ASSETS || {})[spec.crop] || null;
    }

    applyFilter() {
      const q = (this.__filter || "").toLowerCase();
      const v = this.manager.currentView;
      if (!v) return;
      for (const ev of v.elements) {
        const it = ev.__edListItem;
        if (!it) continue;
        const hay = `${ev.spec.name || ""} ${ev.spec.id} ${ev.spec.type} ${ev.spec.role || ""} ${ev.spec.text || ""}`.toLowerCase();
        it.style.display = !q || hay.includes(q) ? "" : "none";
      }
    }

    /* clone the selected element with its animations/rig */
    duplicateElement(ev) {
      this.pushUndo();
      const v = this.manager.currentView;
      const spec = S.deepClone(ev.spec);
      let n = 1, id;
      do { id = `${v.spec.id}_dup${n++}`; } while (v.spec.elements.some((e) => e.id === id));
      spec.id = id;
      spec.name = (ev.spec.name || ev.spec.id) + " copy";
      const dx = 0.02, dy = 0.02;
      spec.bbox = spec.bbox.map((c, i) => S.clamp(c + (i % 2 ? dy : dx), 0, 1));
      if (spec.cropBbox) spec.cropBbox = spec.cropBbox.map((c, i) => S.clamp(c + (i % 2 ? dy : dx), 0, 1));
      spec.z = (Math.max(0, ...v.spec.elements.map((e) => e.z || 0)) + 1);
      // keep crop pointing at the original so it renders immediately
      v.spec.elements.push(spec);
      const nev = new S.ElementView(spec, this.manager.deck);
      nev.build().then(() => {
        v.elementLayer.addChild(nev.parallaxNode);
        v.elements.push(nev);
        this.setElementInteractivity(true);
        this.rebuildList();
        this.select(nev);
        if (S.persist) S.persist.markDirty(id);
        if (S.studio) S.studio.needsRecrop("duplicated element");
      });
    }

    /* add a parametric 3D primitive (studio): server generates a coloured GLB,
       we drop a model3d element on the current slide and render it live. On PPTX
       export it bakes to a picture (synthetic 3D doesn't display in PowerPoint). */
    async addPrimitive(shape, color) {
      const v = this.manager.currentView;
      if (!v) return;
      this.pushUndo();
      let res, data;
      try {
        res = await fetch("/api/add3d", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ shape, color }) });
        data = await res.json();
      } catch (e) { data = { error: String(e) }; }
      if (!res || !res.ok || !data.modelSrc) { alert("Add 3D failed: " + ((data && data.error) || "")); return; }

      let n = 1, id;
      do { id = `${v.spec.id}_3d${n++}`; } while (v.spec.elements.some((e) => e.id === id));
      const name = shape.charAt(0).toUpperCase() + shape.slice(1);
      const spec = {
        id, type: "model3d", role: "figure", name, text: "",
        bbox: [0.38, 0.30, 0.62, 0.74], cropBbox: null,
        crop: `crops/${id}.webp`,                 // filled in by _bakePrimitive
        z: Math.max(0, ...v.spec.elements.map((e) => e.z || 0)) + 1,
        cleanup: "none", fillColor: null, patch: null,
        entrance: { type: "scaleIn", delay: 0.15, duration: 0.8, ease: "back.out(1.4)" },
        idle: [], parallax: 0.05, lines: null, rig: null, blendMode: null, opacity: 1, hidden: false,
        modelSrc: data.modelSrc,
        model3d: { clip: null, loop: true, durationMs: null, autoRotate: 24, camera: { fov: 45 },
                   transform: { rot: [0.4, 0.6, 0], scale: [1, 1, 1] }, previewSrc: null, sourceXml: null },
      };
      v.spec.elements.push(spec);
      const nev = new S.ElementView(spec, this.manager.deck);
      await nev.build();
      v.elementLayer.addChild(nev.parallaxNode);
      v.elements.push(nev);
      nev.startIdles();                           // begin rendering + auto-rotate
      this.setElementInteractivity(true);
      this.rebuildList();
      this.select(nev);
      if (S.persist) S.persist.markDirty(id);
      this._bakePrimitive(nev);
    }

    /* capture the live three.js render as the element's crop, so PPTX export can
       bake the primitive to a picture (and it shows a real render pre-load) */
    async _bakePrimitive(ev) {
      for (let i = 0; i < 80 && !(ev.model3d && ev.model3d.ready); i++) await new Promise((r) => setTimeout(r, 100));
      const m = ev.model3d;
      if (!m || !m.ready || !m.renderer) return;
      m._frame(0);
      let dataURL;
      try { dataURL = m.renderer.domElement.toDataURL("image/webp", 0.92); }
      catch (e) { try { dataURL = m.renderer.domElement.toDataURL("image/png"); } catch (_) { return; } }
      try {
        const r = await fetch("/api/asset", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `crops/${ev.spec.id}.webp`, dataURL }) });
        if (r.ok && S.persist) { S.persist.markDirty(ev.spec.id); S.persist.saveStudio(); }
      } catch (e) { /* bake is best-effort */ }
    }

    /* keyboard nudge of the selected element's box (then re-crop to update pixels) */
    nudgeSelected(dx, dy) {
      const ev = this.selected;
      if (!ev) return;
      ev.spec.bbox = ev.spec.bbox.map((v, i) => +S.clamp(v + (i % 2 ? dy : dx), 0, 1).toFixed(4));
      ev.relayout();
      if (S.persist) S.persist.markDirty(ev.spec.id);
      if (S.studio) S.studio.needsRecrop("box moved");
      if (S.inspector) S.inspector.show(ev);
    }

    /* snap the selected element's centre to the slide centre on one axis */
    snapCenter(axis) {
      const ev = this.selected;
      if (!ev) return;
      const b = ev.spec.bbox.slice();
      if (axis === "x") { const w = b[2] - b[0]; b[0] = +(0.5 - w / 2).toFixed(4); b[2] = +(0.5 + w / 2).toFixed(4); }
      else { const h = b[3] - b[1]; b[1] = +(0.5 - h / 2).toFixed(4); b[3] = +(0.5 + h / 2).toFixed(4); }
      ev.spec.bbox = b;
      ev.relayout();
      if (S.persist) S.persist.markDirty(ev.spec.id);
      if (S.studio) S.studio.needsRecrop("centered");
      if (S.inspector) S.inspector.show(ev);
    }

    /* paste a copied element onto the CURRENT slide (keeps its crop/image) */
    pasteElement() {
      const v = this.manager.currentView;
      if (!v || !this._clipboard) return;
      this.pushUndo();
      const spec = S.deepClone(this._clipboard);
      let n = 1, id;
      do { id = `${v.spec.id}_paste${n++}`; } while (v.spec.elements.some((e) => e.id === id));
      spec.id = id;
      spec.name = (spec.name || this._clipboard.id) + " (paste)";
      spec.bbox = spec.bbox.map((c) => +S.clamp(c + 0.03, 0, 1).toFixed(4));
      if (spec.cropBbox) spec.cropBbox = spec.cropBbox.map((c) => +S.clamp(c + 0.03, 0, 1).toFixed(4));
      spec.z = Math.max(0, ...v.spec.elements.map((e) => e.z || 0)) + 1;
      // keep spec.crop pointing at the source's image so it renders without a re-crop
      v.spec.elements.push(spec);
      const nev = new S.ElementView(spec, this.manager.deck);
      nev.build().then(() => {
        v.elementLayer.addChild(nev.parallaxNode);
        v.elements.push(nev);
        this.setElementInteractivity(true);
        this.rebuildList();
        this.select(nev);
        if (S.persist) S.persist.markDirty(id);
      });
    }

    /* snapshot the current slide BEFORE a coarse edit (add/delete/paste/preset) */
    pushUndo() {
      if (!window.STUDIO) return;
      const v = this.manager.currentView;
      if (!v) return;
      this._undo.push({ i: this.manager.current,
        data: S.deepClone({ elements: v.spec.elements, background: v.spec.background }) });
      if (this._undo.length > 30) this._undo.shift();
      this._redo = [];
    }

    async _restore(from, to) {
      if (!from.length) return;
      const cur = this.manager.currentView;
      to.push({ i: this.manager.current,
        data: S.deepClone({ elements: cur.spec.elements, background: cur.spec.background }) });
      const snap = from.pop();
      if (snap.i !== this.manager.current) await this.manager.goto(snap.i, true);
      const v = this.manager.views[snap.i];
      v.spec.elements = S.deepClone(snap.data.elements);
      v.spec.background = S.deepClone(snap.data.background);
      await v.rebuildElements();
      if (v.restartBgIdle) v.restartBgIdle();
      this.selected = null;
      this.setElementInteractivity(true);
      this.rebuildList();
      if (S.inspector) S.inspector.show(null);
      if (S.persist) S.persist.markSlideDirty(v.spec.id);
    }
    undo() { this._restore(this._undo, this._redo); }
    redo() { this._restore(this._redo, this._undo); }

    /* swap z with the nearest neighbour above (+1) / below (-1) */
    nudgeZ(ev, dir) {
      const v = this.manager.currentView;
      const others = v.elements.filter((e) => e !== ev);
      const z = ev.spec.z || 0;
      const cands = others.filter((e) => dir > 0 ? (e.spec.z || 0) > z : (e.spec.z || 0) < z);
      if (!cands.length) return;
      const nb = cands.reduce((a, b) => (dir > 0
        ? ((a.spec.z || 0) < (b.spec.z || 0) ? a : b)
        : ((a.spec.z || 0) > (b.spec.z || 0) ? a : b)));
      const tmp = ev.spec.z; ev.spec.z = nb.spec.z; nb.spec.z = tmp;
      ev.parallaxNode.zIndex = ev.spec.z;
      nb.parallaxNode.zIndex = nb.spec.z;
      this.rebuildList();
      this.select(ev);
      if (S.persist) { S.persist.markDirty(ev.spec.id); S.persist.markDirty(nb.spec.id); }
    }

    setFilter(q) { this.__filter = q; this.applyFilter(); }

    select(ev) {
      this.selected = ev;
      this.bgSelected = false;
      const v = this.manager.currentView;
      if (v) for (const e of v.elements) {
        if (e.__edListItem) e.__edListItem.classList.toggle("sel", e === ev);
      }
      if (this.__bgListItem) this.__bgListItem.classList.remove("sel");
      if (S.inspector) S.inspector.show(ev);
      if (this.rigEditor) this.rigEditor.onSelect(ev);
      this.update3DBar(ev);
    }

    /* mode buttons on the floating 3D bar: Move (box editing) vs Orbit/Pan (camera) */
    set3DMode(mode) {
      const ev = this.selected;
      if (!ev || ev.spec.type !== "model3d") return;
      const m3 = ev.spec.model3d || (ev.spec.model3d = {});
      if (mode === "move") {
        m3.orbit = false;
        if (ev.model3d) ev.model3d.setControls(false);
      } else {
        m3.orbit = true;
        if (ev.model3d) { ev.model3d.setControls(true); ev.model3d.setDragMode(mode); }
      }
      this.update3DBar(ev);
      if (S.persist) S.persist.markDirty(ev.spec.id);
    }

    /* show the 3D bar only for a selected 3D model; highlight the active mode */
    update3DBar(ev) {
      const bar = document.getElementById("ed-3dbar");
      if (!bar) return;
      const is3d = !!(ev && ev.spec && ev.spec.type === "model3d");
      bar.classList.toggle("show", is3d);
      if (!is3d) return;
      const m3 = ev.spec.model3d || {};
      const mode = !m3.orbit ? "move" : ((ev.model3d && ev.model3d._dragMode) || "orbit");
      bar.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    }

    selectBackground() {
      this.selected = null;
      this.bgSelected = true;
      const v = this.manager.currentView;
      if (v) for (const e of v.elements) {
        if (e.__edListItem) e.__edListItem.classList.remove("sel");
      }
      if (this.__bgListItem) this.__bgListItem.classList.add("sel");
      if (this.rigEditor) this.rigEditor.close();
      if (S.inspector) S.inspector.showBackground(v);
      this.update3DBar(null);
    }

    drawGizmos() {
      const g = this.gizmoG;
      g.clear();
      const v = this.manager.currentView;
      if (!v) return;
      for (const ev of v.elements) {
        const b = ev.box;
        const sel = ev === this.selected;
        g.rect(b.x, b.y, b.w, b.h)
          .stroke({ width: sel ? 2.5 : 1, color: sel ? 0xc9a227 : 0x4a90d9, alpha: sel ? 1 : 0.55 });
        if (sel && window.STUDIO && !(this.rigEditor && this.rigEditor.active)) {
          const deck = this.manager.deck;
          const d = S.bboxToDesign(ev.spec.bbox, deck);
          g.rect(d.x, d.y, d.w, d.h).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
          g.rect(d.x + d.w - 7, d.y + d.h - 7, 14, 14).fill({ color: 0xc9a227, alpha: 0.95 });
          // the element's true mask shape: base polygon + boolean regions
          const W = deck.designWidth, H = deck.designHeight;
          const drawPts = (pts, color) => {
            g.moveTo(pts[0][0] * W, pts[0][1] * H);
            for (const p of pts.slice(1)) g.lineTo(p[0] * W, p[1] * H);
            g.closePath().stroke({ width: 1.5, color, alpha: 0.85 });
          };
          if (ev.spec.polygon) drawPts(ev.spec.polygon, 0x6ee76e);
          for (const r of ev.spec.regions || []) {
            drawPts(r.pts, r.op === "add" ? 0x6ee76e : 0xe7706e);
          }
        }
      }
      // pending elements (drawn but not yet cropped) - green outline
      const pending = v.spec.elements.filter((sp) => !v.elements.some((e) => e.spec === sp));
      for (const sp of pending) {
        const d = S.bboxToDesign(sp.bbox, this.manager.deck);
        g.rect(d.x, d.y, d.w, d.h).stroke({ width: 2, color: 0x6ee76e, alpha: 0.8 });
        if (sp.polygon) {
          const W = this.manager.deck.designWidth, H = this.manager.deck.designHeight;
          g.moveTo(sp.polygon[0][0] * W, sp.polygon[0][1] * H);
          for (const p of sp.polygon.slice(1)) g.lineTo(p[0] * W, p[1] * H);
          g.closePath().stroke({ width: 1.5, color: 0x6ee76e, alpha: 0.6 });
        }
      }
      if (this.rigEditor && this.rigEditor.active) this.rigEditor.drawGizmos(g);
      if (this.drawTools) this.drawTools.drawGizmos(g);
    }

    rebuildPending() { this.rebuildList(); }

    /* studio: remove an element from the deck (view + manifest) */
    deleteElement(ev) {
      if (!window.STUDIO) return;
      if (!confirm(`Delete ${ev.spec.id}?`)) return;
      this.pushUndo();
      const v = this.manager.currentView;
      const i = v.spec.elements.indexOf(ev.spec);
      if (i >= 0) v.spec.elements.splice(i, 1);
      const j = v.elements.indexOf(ev);
      if (j >= 0) { v.elements.splice(j, 1); ev.destroy(); }
      if (S.parallax) S.parallax.setElements(v.elements);
      this.select(null);
      this.rebuildList();
      if (S.persist) S.persist.markDirty(ev.spec.id);
    }
  }

  S.Editor = Editor;
})();
