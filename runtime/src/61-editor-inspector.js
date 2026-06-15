/* Inspector: per-element animation property panel with collapsible sections.
   Writes into the live spec, rebuilds the element's tweens, notifies persist. */
(function () {
  "use strict";
  const S = window.SKULL;

  const ENTRANCES = ["none", "fadeIn", "fadeUp", "fadeDown", "fadeLeft", "fadeRight",
    "scaleIn", "maskReveal", "blurIn", "drawOn", "staggerText"];
  const IDLES = ["float", "breath", "pulse", "sway", "shimmer", "glow", "wave", "ripple", "swirl", "meshWave"];
  const MESH_IDLES = ["meshWave", "wave", "ripple", "swirl"];
  const EASES = ["power1.out", "power2.out", "power3.out", "power2.inOut", "sine.inOut",
    "back.out(1.4)", "expo.out", "elastic.out(1,0.4)", "none"];
  const DIRECTIONS = ["left", "right", "up", "down", "center"];
  const BLEND_MODES = ["normal", "add", "screen", "multiply", "overlay", "darken",
    "lighten", "color-dodge", "color-burn", "hard-light", "soft-light",
    "difference", "exclusion"];
  const DEFAULT_OPEN = new Set(["entrance", "idle", "bg"]);
  const SEC_KEY = "skull:secState";

  class Inspector {
    constructor(editor) {
      this.editor = editor;
      this.el = document.getElementById("ed-inspector");
      try {
        this.secOpen = JSON.parse(localStorage.getItem(SEC_KEY) || "{}");
      } catch (e) { this.secOpen = {}; }
    }

    sec(key, title, rows, forceOpen) {
      const open = forceOpen || (this.secOpen[key] ?? DEFAULT_OPEN.has(key));
      return `<details class="ed-sec" data-sec="${key}"${open ? " open" : ""}>` +
        `<summary>${title}</summary><div class="ed-sec-body">${rows.join("")}</div></details>`;
    }

    bindSections() {
      for (const d of this.el.querySelectorAll("details.ed-sec")) {
        d.addEventListener("toggle", () => {
          this.secOpen[d.dataset.sec] = d.open;
          try { localStorage.setItem(SEC_KEY, JSON.stringify(this.secOpen)); } catch (e) {}
        });
      }
    }

    /* ---------------- background (slide-level) ---------------- */
    showBackground(view) {
      if (!view) return;
      const spec = view.spec;
      const idle = spec.background.idle || { type: "none" };
      const type = idle.type || "none";
      const rows = [row("type", select("bg-idle-type", ["none", "kenBurns", "pulse", "shimmer"], type))];
      if (type === "kenBurns") {
        rows.push(row("zoom to", num("bg-scale", idle.scale ?? 1.04, 0.005)));
        rows.push(row("duration", num("bg-dur", idle.duration ?? 14, 1)));
        rows.push(`<div class="row"><label>yoyo</label><input type="checkbox" id="bg-yoyo" ${idle.yoyo !== false ? "checked" : ""}></div>`);
      } else if (type !== "none") {
        rows.push(row("amount", num("bg-amt", idle.amount ?? 0.1, 0.02)));
        rows.push(row("period", num("bg-per", idle.period ?? 6, 0.5)));
      }
      this.el.innerHTML = `<h4>${spec.id} &middot; Background</h4>` +
        this.sec("bg", "Idle animation", rows) +
        `<div id="ed-hint">Slow zoom (kenBurns) keeps full-bleed slides alive. Deck-wide transition lives in Options.</div>`;
      this.bindSections();

      const commit = () => {
        view.restartBgIdle();
        this.editor.rebuildList();
        if (this.editor.__bgListItem) this.editor.__bgListItem.classList.add("sel");
        if (S.persist) S.persist.markSlideDirty(spec.id);
      };
      const bind = (id, fn) => {
        const node = document.getElementById(id);
        if (node) node.onchange = (e) => { fn(e); commit(); };
      };
      bind("bg-idle-type", (e) => {
        const t = e.target.value;
        spec.background.idle = t === "none" ? null
          : t === "kenBurns" ? { type: t, scale: 1.04, duration: 14, yoyo: true }
          : { type: t, amount: 0.1, period: 6 };
        this.showBackground(view);
      });
      bind("bg-scale", (e) => { spec.background.idle.scale = parseFloat(e.target.value); });
      bind("bg-dur", (e) => { spec.background.idle.duration = parseFloat(e.target.value); });
      bind("bg-yoyo", (e) => { spec.background.idle.yoyo = e.target.checked; });
      bind("bg-amt", (e) => { spec.background.idle.amount = parseFloat(e.target.value); });
      bind("bg-per", (e) => { spec.background.idle.period = parseFloat(e.target.value); });
    }

    /* ---------------- element ---------------- */
    show(ev) {
      if (!ev) {
        if (this.editor.bgSelected) return; // background panel is active
        this.el.innerHTML = `<h4>No selection</h4>
          <div id="ed-hint">Click an element on the canvas or in the list, or pick Background. Press E to close.</div>`;
        return;
      }
      const spec = ev.spec;
      const ent = spec.entrance || (spec.entrance = { type: "none" });
      const idles = spec.idle || (spec.idle = []);
      const h = [];
      h.push(`<h4>${spec.name || spec.id}${spec.hidden ? " &middot; hidden" : ""}</h4>`);
      h.push(`<div class="row"><label title="friendly name, kept in HTML and PPTX exports">name</label>
        <input type="text" id="ed-name" value="${(spec.name || "").replace(/"/g, "&quot;")}" placeholder="${spec.id}"></div>`);
      h.push(`<div class="row" style="gap:4px">
        <button id="ed-dup" title="clone this element with its animations">Duplicate</button>
        <button id="ed-zfwd" title="bring forward (raise z-order)">&#9650; Fwd</button>
        <button id="ed-zback" title="send back (lower z-order)">&#9660; Back</button></div>`);

      // --- entrance
      const entRows = [
        row("type", select("ent-type", ENTRANCES, ent.type)),
        row("delay", num("ent-delay", ent.delay ?? 0, 0.1)),
        row("duration", num("ent-dur", ent.duration ?? 1, 0.1)),
        row("ease", select("ent-ease", EASES, ent.ease || "power2.out")),
      ];
      if (["maskReveal", "drawOn"].includes(ent.type)) {
        entRows.push(row("direction", select("ent-dir", DIRECTIONS, ent.direction || "left")));
      }
      if (ent.type.startsWith("fade") && ent.type !== "fadeIn") {
        entRows.push(row("distance", num("ent-dist", ent.distance ?? 0.04, 0.01)));
      }
      h.push(this.sec("entrance", "Entrance", entRows));

      // --- 3D model (only for model3d elements)
      if (spec.type === "model3d") {
        const m3 = spec.model3d || (spec.model3d = {});
        const clips = (ev.model3d && ev.model3d.clipNames) || [];
        const m3Rows = [];
        if (clips.length) {
          m3Rows.push(row("clip", select("m3-clip", clips, clips[m3.clip ?? 0] ?? clips[0])));
          m3Rows.push(`<div class="row"><label>loop</label><input type="checkbox" id="m3-loop" ${m3.loop !== false ? "checked" : ""}></div>`);
        } else {
          m3Rows.push(`<div id="ed-hint">No baked animation in this model — use auto-rotate below.</div>`);
        }
        m3Rows.push(row("auto-rotate &deg;/s", num("m3-rot", m3.autoRotate ?? 0, 5)));
        m3Rows.push(row("camera FOV", num("m3-fov", (m3.camera && m3.camera.fov) ?? 45, 1)));
        m3Rows.push(`<div class="row"><label title="drag to orbit, scroll to zoom, shift-drag to pan (in the editor and the exported HTML viewer)">interactive</label><input type="checkbox" id="m3-orbit" ${m3.orbit ? "checked" : ""}></div>`);
        m3Rows.push(`<div class="row"><button id="m3-reset">Reset view</button></div>`);
        h.push(this.sec("model3d", "3D model", m3Rows));
      }

      // --- idle
      const idleRows = [];
      for (const name of IDLES) {
        const on = idles.some((i) => i.type === name);
        idleRows.push(`<div class="row"><label>${name}</label>
          <input type="checkbox" data-idle="${name}" ${on ? "checked" : ""}></div>`);
        if (on) {
          const idle = idles.find((i) => i.type === name);
          const amt = idle.amplitude ?? idle.amount ?? idle.degrees ?? 0.02;
          idleRows.push(row("&nbsp;&nbsp;amount", num(`idle-amt-${name}`, amt, 0.005)));
          if (MESH_IDLES.includes(name)) {
            idleRows.push(row("&nbsp;&nbsp;speed", num(`idle-speed-${name}`, idle.speed ?? 0.6, 0.1)));
          } else {
            idleRows.push(row("&nbsp;&nbsp;period", num(`idle-per-${name}`, idle.period ?? 4, 0.5)));
          }
          if (name === "ripple") idleRows.push(row("&nbsp;&nbsp;waves", num(`idle-waves-${name}`, idle.waves ?? 2, 1)));
          if (name === "glow") idleRows.push(`<div class="row"><label>&nbsp;&nbsp;color</label><input type="color" id="idle-color-${name}" value="${idle.color || "#ffffff"}"></div>`);
        }
      }
      h.push(this.sec("idle", "Idle", idleRows));

      // --- parallax
      h.push(this.sec("parallax", "Parallax", [
        `<div class="row"><label>depth</label>
          <input type="range" id="ed-parallax" min="0" max="1" step="0.05" value="${spec.parallax || 0}">
          <span id="ed-parallax-val" class="ed-badge">${spec.parallax || 0}</span></div>`,
      ]));

      // --- compositing
      h.push(this.sec("comp", "Compositing", [
        row("blend", select("ed-blend", BLEND_MODES, spec.blendMode || "normal")),
        `<div class="row"><label>opacity</label>
          <input type="range" id="ed-opacity" min="0.05" max="1" step="0.05" value="${spec.opacity ?? 1}">
          <span id="ed-opacity-val" class="ed-badge">${spec.opacity ?? 1}</span></div>`,
      ]));

      // --- studio sections
      if (window.STUDIO) {
        h.push(this.sec("element", "Element", [
          row("type", select("ed-el-type", ["image", "text", "shape", "model3d"], spec.type)),
          row("z-order", num("ed-z", spec.z ?? 0, 1)),
          `<div id="ed-bbox-ro" class="ed-badge">[${spec.bbox.map((v) => v.toFixed(3)).join(", ")}]${spec.polygon ? " poly:" + spec.polygon.length : ""}${(spec.regions || []).length ? " regions:" + spec.regions.length : ""}</div>`,
        ]));

        const patchRows = [row("type", select("ed-cleanup", ["none", "auto", "fill", "blur"], spec.cleanup || "none"))];
        if ((spec.cleanup || "none") === "fill") {
          patchRows.push(`<div class="row"><label>color</label><input type="color" id="ed-fillcolor" value="${spec.fillColor || "#000000"}"></div>`);
        }
        if ((spec.cleanup || "none") === "blur") {
          patchRows.push(`<div class="row"><label>blur px</label>
            <input type="range" id="ed-blurrad" min="8" max="90" step="2" value="${spec.blurRadius || 40}">
            <span id="ed-blurrad-val" class="ed-badge">${spec.blurRadius || 40}</span></div>`);
        }
        patchRows.push(`<div class="row"><label title="patch covers the original; the element itself never draws - blurs/erases logos or unwanted text">hide (censor)</label>
          <input type="checkbox" id="ed-hidden" ${spec.hidden ? "checked" : ""}></div>`);
        h.push(this.sec("patch", "Footprint patch", patchRows));

        h.push(this.sec("mask", "Mask areas", [
          `<div class="row">
            <button id="ed-area-add-box" title="drag a box to ADD to this element's mask">+ Box</button>
            <button id="ed-area-sub-box" title="drag a box to SUBTRACT from this element's mask">&minus; Box</button>
            <button id="ed-area-add-poly" title="click a polygon to ADD (Enter or first node closes)">+ Poly</button>
            <button id="ed-area-sub-poly" title="click a polygon to SUBTRACT (Enter or first node closes)">&minus; Poly</button>
            ${(spec.regions || []).length ? `<button id="ed-area-clear" title="remove all boolean areas">Clear</button>` : ""}</div>`,
        ]));
      }

      // --- rig
      const rigRows = [];
      if (spec.rig) {
        const rigOpen = this.editor.rigEditor && this.editor.rigEditor.active && this.editor.rigEditor.ev === ev;
        rigRows.push(`<div class="row"><button id="ed-rig-open" class="${rigOpen ? "on" : "primary"}">${rigOpen ? "&#9660; Close rig editor" : "&#9654; Open rig editor"}</button>
                <button id="ed-rig-remove">Remove</button></div>`);
        rigRows.push(`<div class="ed-sub">Quick motion (replaces pins)</div>`);
        rigRows.push(`<div class="ed-preset-grid">` + (S.RigPresets ? S.RigPresets.list.map((p) =>
          `<button class="ed-preset" data-preset="${p.id}" title="${p.hint}">${p.label}</button>`).join("") : "") + `</div>`);
        rigRows.push(`<div class="ed-sub">Mesh density</div>`);
        const g = spec.rig.mesh?.verticesX ?? 12;
        rigRows.push(`<div class="row" id="ed-density">
          <button data-grid="8" class="${g <= 8 ? "on" : ""}">Low</button>
          <button data-grid="12" class="${g > 8 && g <= 14 ? "on" : ""}">Med</button>
          <button data-grid="18" class="${g > 14 ? "on" : ""}">High</button></div>`);
        rigRows.push(row("falloff", num("rig-falloff", spec.rig.weights?.falloff ?? 2.0, 0.25)));
        rigRows.push(`<div class="ed-legend">
          <span><i class="pin gold"></i> animated</span>
          <span><i class="pin gray"></i> anchor (holds still)</span>
          <span><i class="pin sel"></i> selected</span></div>`);
      } else {
        rigRows.push(`<div class="row"><button id="ed-rig-enable" class="primary">Enable mesh deform</button></div>`);
        rigRows.push(`<div class="ed-sub">…or start from a motion preset</div>`);
        rigRows.push(`<div class="ed-preset-grid">` + (S.RigPresets ? S.RigPresets.list.map((p) =>
          `<button class="ed-preset" data-preset="${p.id}" title="${p.hint}">${p.label}</button>`).join("") : "") + `</div>`);
        rigRows.push(`<div id="ed-hint">Mesh deform warps the image with pins (like puppet-warp). Presets give you a ready-made motion you can refine.</div>`);
      }
      // auto-expand and badge the section when the element already has a rig,
      // so "Open rig editor" is never hidden inside a collapsed fold
      h.push(this.sec("rig", spec.rig ? "Mesh deform &#9679;" : "Mesh deform", rigRows, !!spec.rig));

      // --- always-visible actions
      if (window.STUDIO) {
        h.push(`<div class="row" style="margin-top:8px"><button id="ed-recrop" class="primary">Re-crop &amp; reload</button>
                <button id="ed-ocr">OCR text</button><button id="ed-del">Delete</button></div>`);
        const motion = (spec.idle && spec.idle.length) ||
          (spec.rig && spec.rig.anim && Object.keys(spec.rig.anim.tracks || {}).length);
        h.push(`<div class="row" style="margin-top:6px"><label style="flex:0 0 auto">export</label>
          <button id="ed-exp-png" title="save this element as a transparent PNG">PNG</button>
          <button id="ed-exp-jpg" title="save as JPG (flattened on the deck background)">JPG</button>` +
          (motion ? `<button id="ed-exp-gif" title="bake this element's animation to a looping GIF">GIF</button>
                     <button id="ed-exp-mp4" title="bake to a looping mp4">MP4</button>` : ``) + `</div>`);
        h.push(`<div id="ed-hint">Patch, mask and box changes apply on Re-crop. Drag the element to move its box; gold corner resizes.</div>`);
      }

      this.el.innerHTML = h.join("");
      this.bindSections();
      this.bind(ev);
    }

    bind(ev) {
      const spec = ev.spec;
      const ent = spec.entrance;
      const onchange = (id, fn) => {
        const node = document.getElementById(id);
        if (node) node.onchange = (e) => { fn(e); this.commit(ev); };
      };

      const nameInput = document.getElementById("ed-name");
      if (nameInput) nameInput.oninput = (e) => {
        spec.name = e.target.value.trim() || undefined;
        if (ev.__edListItem) {
          const lbl = ev.__edListItem.querySelector(".el-name");
          if (lbl) lbl.textContent = spec.name || spec.id;
        }
        this.commitSoon(ev);
      };
      const dupBtn = document.getElementById("ed-dup");
      if (dupBtn) dupBtn.onclick = () => this.editor.duplicateElement(ev);
      const zf = document.getElementById("ed-zfwd");
      if (zf) zf.onclick = () => this.editor.nudgeZ(ev, +1);
      const zb = document.getElementById("ed-zback");
      if (zb) zb.onclick = () => this.editor.nudgeZ(ev, -1);

      onchange("ent-type", (e) => { ent.type = e.target.value; this.show(ev); });
      onchange("ent-delay", (e) => { ent.delay = parseFloat(e.target.value); });
      onchange("ent-dur", (e) => { ent.duration = parseFloat(e.target.value); });
      onchange("ent-ease", (e) => { ent.ease = e.target.value; });
      onchange("ent-dir", (e) => { ent.direction = e.target.value; });
      onchange("ent-dist", (e) => { ent.distance = parseFloat(e.target.value); });

      // --- 3D model controls (apply live to the three.js view when loaded)
      const m3 = spec.model3d || {};
      onchange("m3-clip", (e) => {
        m3.clip = e.target.selectedIndex;
        if (ev.model3d) ev.model3d.setClip(m3.clip, m3.loop !== false);
      });
      const m3loop = document.getElementById("m3-loop");
      if (m3loop) m3loop.onchange = (e) => {
        m3.loop = e.target.checked;
        if (ev.model3d) ev.model3d.setClip(m3.clip ?? 0, m3.loop);
        this.commitSoon(ev);
      };
      onchange("m3-rot", (e) => {
        m3.autoRotate = parseFloat(e.target.value) || 0;
        if (ev.model3d) ev.model3d.setAutoRotate(m3.autoRotate);
      });
      onchange("m3-fov", (e) => {
        const fov = parseFloat(e.target.value) || 45;
        m3.camera = Object.assign(m3.camera || {}, { fov });
        if (ev.model3d) ev.model3d.setFov(fov);
      });
      const m3orbit = document.getElementById("m3-orbit");
      if (m3orbit) m3orbit.onchange = (e) => {
        m3.orbit = e.target.checked;
        if (ev.model3d) ev.model3d.setControls(m3.orbit);
        this.commitSoon(ev);
      };
      const m3reset = document.getElementById("m3-reset");
      if (m3reset) m3reset.onclick = () => { if (ev.model3d) ev.model3d.resetView(); };

      for (const cb of this.el.querySelectorAll("input[data-idle]")) {
        cb.onchange = () => {
          const name = cb.dataset.idle;
          spec.idle = spec.idle.filter((i) => i.type !== name);
          if (cb.checked) spec.idle.push({ type: name });
          // mesh effects (wave/ripple/swirl/meshWave) need a MeshPlane view; rebuild
          // when the mesh-ness may have changed (not for 3D models)
          if (MESH_IDLES.includes(name) && spec.type !== "model3d" && ev.view && ev.view.texture) {
            ev.makeView(ev.view.texture, !!spec.rig);
          }
          this.commit(ev);
          this.show(ev);
        };
      }
      for (const name of IDLES) {
        onchange(`idle-amt-${name}`, (e) => {
          const idle = spec.idle.find((i) => i.type === name);
          if (!idle) return;
          const v = parseFloat(e.target.value);
          if (name === "sway" || name === "swirl") idle.degrees = v;
          else if (name === "pulse" || name === "shimmer" || name === "breath" || name === "glow") idle.amount = v;
          else idle.amplitude = v;                       // float, wave, ripple, meshWave
        });
        onchange(`idle-per-${name}`, (e) => {
          const idle = spec.idle.find((i) => i.type === name);
          if (idle) idle.period = parseFloat(e.target.value);
        });
        onchange(`idle-speed-${name}`, (e) => {
          const idle = spec.idle.find((i) => i.type === name);
          if (idle) idle.speed = parseFloat(e.target.value);
        });
        onchange(`idle-waves-${name}`, (e) => {
          const idle = spec.idle.find((i) => i.type === name);
          if (idle) idle.waves = Math.max(1, Math.min(3, parseInt(e.target.value, 10) || 2));
        });
        onchange(`idle-color-${name}`, (e) => {
          const idle = spec.idle.find((i) => i.type === name);
          if (idle) idle.color = e.target.value;
        });
      }

      onchange("ed-blend", (e) => {
        spec.blendMode = e.target.value;
        ev.view.blendMode = e.target.value;
      });
      const opa = document.getElementById("ed-opacity");
      if (opa) opa.oninput = (e) => {
        spec.opacity = parseFloat(e.target.value);
        ev.view.alpha = spec.opacity;
        document.getElementById("ed-opacity-val").textContent = spec.opacity;
        this.commitSoon(ev);
      };

      const par = document.getElementById("ed-parallax");
      if (par) par.oninput = (e) => {
        spec.parallax = parseFloat(e.target.value);
        document.getElementById("ed-parallax-val").textContent = spec.parallax;
        S.parallax.setElements(this.editor.manager.currentView.elements);
        this.commitSoon(ev);
      };

      onchange("ed-el-type", (e) => { spec.type = e.target.value; });
      onchange("ed-z", (e) => {
        spec.z = parseInt(e.target.value, 10) || 0;
        ev.parallaxNode.zIndex = spec.z; // elementLayer is sortableChildren
      });
      onchange("ed-cleanup", (e) => {
        spec.cleanup = e.target.value;
        if (spec.cleanup !== "fill") spec.fillColor = null;
        if (spec.cleanup !== "blur") spec.patch = null;
        this.show(ev);
        S.studio && S.studio.needsRecrop("patch type");
      });
      onchange("ed-fillcolor", (e) => {
        spec.fillColor = e.target.value;
        S.studio && S.studio.needsRecrop("fill color");
      });
      const blurRad = document.getElementById("ed-blurrad");
      if (blurRad) blurRad.oninput = (e) => {
        spec.blurRadius = parseInt(e.target.value, 10);
        document.getElementById("ed-blurrad-val").textContent = spec.blurRadius;
        this.commitSoon(ev);
        S.studio && S.studio.needsRecrop("blur strength");
      };
      const hiddenCb = document.getElementById("ed-hidden");
      if (hiddenCb) hiddenCb.onchange = (e) => {
        spec.hidden = e.target.checked;
        if (spec.hidden && (spec.cleanup || "none") === "none") {
          spec.cleanup = "auto"; // censoring needs a patch to cover the original
          this.show(ev);
          S.studio && S.studio.needsRecrop("censor patch");
        }
        ev.view.visible = !spec.hidden;
        this.commit(ev);
      };
      for (const [id, op, shape] of [["ed-area-add-box", "add", "box"], ["ed-area-sub-box", "sub", "box"],
                                     ["ed-area-add-poly", "add", "poly"], ["ed-area-sub-poly", "sub", "poly"]]) {
        const b = document.getElementById(id);
        if (b) b.onclick = () => this.editor.drawTools.armRegion(ev, op, shape);
      }
      const areaClear = document.getElementById("ed-area-clear");
      if (areaClear) areaClear.onclick = () => {
        spec.regions = null;
        this.commit(ev);
        this.show(ev);
        S.studio && S.studio.needsRecrop("mask cleared");
      };

      const ocrBtn = document.getElementById("ed-ocr");
      if (ocrBtn) ocrBtn.onclick = async () => {
        ocrBtn.disabled = true;
        const text = await S.studio.ocrElement(spec);
        ocrBtn.disabled = false;
        if (text != null) this.show(ev);
      };
      const delBtn = document.getElementById("ed-del");
      if (delBtn) delBtn.onclick = () => this.editor.deleteElement(ev);

      for (const f of ["png", "jpg", "gif", "mp4"]) {
        const b = document.getElementById("ed-exp-" + f);
        if (b) b.onclick = async () => {
          b.disabled = true;
          try { await S.studio.exportElement(ev, f); } finally { b.disabled = false; }
        };
      }

      const recrop = document.getElementById("ed-recrop");
      if (recrop) recrop.onclick = async () => {
        recrop.disabled = true;
        recrop.textContent = "Re-cropping…";
        await S.persist.saveStudio();
        await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: "crops" }) });
        const poll = async () => {
          const st = await (await fetch("/api/status")).json();
          if (st.running) return setTimeout(poll, 800);
          location.reload();
        };
        poll();
      };

      const freshRig = () => ({
        mesh: { verticesX: 12, verticesY: 12 },
        bones: [{ id: "anchor", parent: null, x: 0.5, y: 0.5, angle: 0, length: 0 }],
        weights: { mode: "auto", falloff: 2.0, maxInfluences: 2 },
        anim: { duration: 3.0, loop: true, ease: "sine.inOut", tracks: {} },
      });
      const rigEnable = document.getElementById("ed-rig-enable");
      if (rigEnable) rigEnable.onclick = () => {
        spec.rig = freshRig();
        ev.attachRig(spec.rig);
        this.commit(ev);
        this.show(ev);
        this.editor.rigEditor.open(ev);
      };
      // motion presets - build/replace the rig, then open the editor in Animate
      for (const btn of this.el.querySelectorAll(".ed-preset")) {
        btn.onclick = () => {
          if (!spec.rig) spec.rig = freshRig();
          S.RigPresets.apply(spec.rig, btn.dataset.preset);
          ev.attachRig(spec.rig);
          this.commit(ev);
          this.show(ev);
          this.editor.rigEditor.open(ev);
          this.editor.rigEditor.setMode("anim");
          this.editor.rigEditor.togglePlay(); // immediate preview
        };
      }
      const density = document.getElementById("ed-density");
      if (density) for (const b of density.querySelectorAll("button")) {
        b.onclick = () => {
          const n = parseInt(b.dataset.grid, 10);
          spec.rig.mesh.verticesX = n; spec.rig.mesh.verticesY = n;
          ev.attachRig(spec.rig);
          this.commit(ev);
          this.show(ev);
          if (this.editor.rigEditor.active) this.editor.rigEditor.open(ev);
        };
      }
      const rigOpenBtn = document.getElementById("ed-rig-open");
      if (rigOpenBtn) rigOpenBtn.onclick = () => {
        const re = this.editor.rigEditor;
        if (re.active && re.ev === ev) re.close();
        else re.open(ev);
        this.show(ev); // refresh button label (Open <-> Close)
      };
      const rigRemove = document.getElementById("ed-rig-remove");
      if (rigRemove) rigRemove.onclick = () => {
        spec.rig = null;
        if (ev.rig) { ev.rig.destroy(); ev.rig = null; }
        ev.makeView(ev.view.texture, false);
        this.editor.rigEditor.close();
        this.commit(ev);
        this.show(ev);
      };
      onchange("rig-falloff", (e) => {
        spec.rig.weights.falloff = parseFloat(e.target.value);
        if (ev.rig) ev.rig.refresh();
      });
      onchange("rig-grid", (e) => {
        const n = S.clamp(Math.round(parseFloat(e.target.value)), 4, 24);
        spec.rig.mesh.verticesX = n;
        spec.rig.mesh.verticesY = n;
        ev.attachRig(spec.rig); // rebuild mesh with new density
      });
    }

    commit(ev) {
      const view = this.editor.manager.currentView;
      ev.stopIdles();
      view.buildTimeline();
      view.timeline.progress(1); // settle at end state while editing
      ev.startIdles();
      if (S.persist) S.persist.markDirty(ev.spec.id);
    }
    commitSoon(ev) {
      clearTimeout(this._t);
      this._t = setTimeout(() => { if (S.persist) S.persist.markDirty(ev.spec.id); }, 300);
    }
  }

  function row(label, control) {
    return `<div class="row"><label>${label}</label>${control}</div>`;
  }
  function select(id, options, value) {
    return `<select id="${id}">` + options.map((o) =>
      `<option ${o === value ? "selected" : ""}>${o}</option>`).join("") + "</select>";
  }
  function num(id, value, step) {
    return `<input type="number" id="${id}" value="${value}" step="${step}">`;
  }

  S.Inspector = Inspector;
})();
