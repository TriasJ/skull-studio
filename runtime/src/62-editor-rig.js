/* RigEditor: pin placement + keyframe authoring on the canvas.

   Two clear modes (segmented control in the bottom bar):
     Setup   - click image to add a pin, drag to place it, Delete removes it.
               Shift+click (with a pin selected) = child bone (chain).
               Alt+drag = rotate the pin.
     Animate - move the playhead, drag a pin to record a keyframe at that time.
               First keyframe of a pin auto-seeds rest keys at t=0 and t=dur so
               the motion returns home and loops cleanly.                       */
(function () {
  "use strict";
  const S = window.SKULL;
  const PIN_R = 9; // hit radius, design px

  const HINTS = {
    setup: "SETUP — click the image (or “+ Pin”) to add a pin; drag to place it. Gray pins anchor (hold still), gold pins drive motion. Select a pin and “− Pin”/Delete to remove. Shift+click a pin then click = chain. Alt+drag = rotate.",
    anim: "ANIMATE — move the playhead on the timeline, then drag a pin to record where it should be at that moment. “+ Pin”/“− Pin” add/remove pins; Play previews the loop.",
  };

  class RigEditor {
    constructor(editor) {
      this.editor = editor;
      this.active = false;
      this.ev = null;
      this.mode = "setup";       // "setup" | "anim"
      this.selectedPin = null;
      this.dragging = false;
      this.playhead = 0;

      this.dom = {
        bottom: document.getElementById("ed-bottom"),
        setupBtn: document.getElementById("ed-mode-setup"),
        animBtn: document.getElementById("ed-mode-anim"),
        addPin: document.getElementById("ed-rig-addpin"),
        rmPin: document.getElementById("ed-rig-rmpin"),
        pinRole: document.getElementById("ed-rig-pinrole"),
        playBtn: document.getElementById("ed-rig-play"),
        loopCb: document.getElementById("ed-rig-loop"),
        durInput: document.getElementById("ed-rig-dur"),
        keyPin: document.getElementById("ed-rig-keypin"),
        keyAll: document.getElementById("ed-rig-keyall"),
        delKey: document.getElementById("ed-rig-delkey"),
        timeLabel: document.getElementById("ed-rig-time"),
        rec: document.getElementById("ed-rig-rec"),
        hint: document.getElementById("ed-rig-hint"),
      };
      this.dom.setupBtn.onclick = () => this.setMode("setup");
      this.dom.animBtn.onclick = () => this.setMode("anim");
      this.dom.addPin.onclick = () => this.addPinButton();
      this.dom.rmPin.onclick = () => {
        if (this.selectedPin) this.removePin(this.selectedPin);
        else this.flashHint("select a pin first (click it), then − Pin");
      };
      this.dom.pinRole.onclick = () => this.togglePinRole();
      this.dom.playBtn.onclick = () => this.togglePlay();
      this.dom.loopCb.onchange = () => {
        if (!this.ev) return;
        this.ev.spec.rig.anim.loop = this.dom.loopCb.checked;
        this.ev.rig.buildTimeline();
        this.commit();
      };
      this.dom.durInput.onchange = () => {
        if (!this.ev) return;
        this.ev.spec.rig.anim.duration = Math.max(0.2, parseFloat(this.dom.durInput.value) || 3);
        this.ev.rig.buildTimeline();
        S.timelineStrip.draw();
        this.commit();
      };
      this.dom.keyPin.onclick = () => {
        if (this.selectedPin) { this.setMode("anim"); this.writeKeyframe(this.selectedPin); }
        else this.flashHint("select a pin first (click one), then + Key pin");
      };
      this.dom.keyAll.onclick = () => { this.setMode("anim"); this.keyAllAtPlayhead(); };
      this.dom.delKey.onclick = () => S.timelineStrip.deleteSelectedKey();

      const canvas = S.app.canvas;
      canvas.addEventListener("pointerdown", (e) => this.onDown(e));
      canvas.addEventListener("pointermove", (e) => this.onMove(e));
      canvas.addEventListener("pointerup", () => this.onUp());
      window.addEventListener("keydown", (e) => {
        if (!this.active || this.editor.isTyping(e)) return;
        if (e.key === "Delete" && this.mode === "setup" && this.selectedPin) this.removePin(this.selectedPin);
      });
    }

    open(ev) {
      if (!ev.spec.rig) return;
      this.ev = ev;
      this.active = true;
      this.selectedPin = null;
      this.playhead = 0;
      this.dom.bottom.classList.add("open");
      this.dom.durInput.value = ev.spec.rig.anim.duration;
      this.dom.loopCb.checked = ev.spec.rig.anim.loop !== false;
      ev.stopIdles();
      // hold the element still so gizmo pins line up with the mesh while editing
      if (S.parallax) S.parallax.freeze(ev);
      if (ev.rig) { ev.rig.tl.pause(0); ev.rig.resetPose(); }
      S.timelineStrip.attach(this);
      // start in Animate if the rig already has motion, else Setup
      const hasMotion = Object.keys(ev.spec.rig.anim.tracks || {}).length > 0;
      this.setMode(hasMotion ? "anim" : "setup");
      this.refreshPinControls();
      this.editor.updateInset();
      if (S.inspector && this.editor.selected === ev) S.inspector.show(ev); // refresh Open->Close label
    }

    close() {
      if (this.ev) {
        if (this.ev.rig) this.ev.rig.tl.pause();
        this.ev.startIdles();
      }
      if (S.parallax) S.parallax.unfreeze();
      this.active = false;
      this.ev = null;
      this.dragging = false;
      this.selectedPin = null;
      this.dom.bottom.classList.remove("open");
      this.editor.updateInset();
    }

    onSelect(ev) {
      if (this.active && ev !== this.ev) this.close();
    }

    setMode(mode) {
      this.mode = mode;
      this.dom.setupBtn.classList.toggle("on", mode === "setup");
      this.dom.animBtn.classList.toggle("on", mode === "anim");
      this.dom.hint.textContent = HINTS[mode];
      const rig = this.ev.rig;
      if (mode === "setup") { rig.tl.pause(0); rig.resetPose(); this.dom.rec.textContent = ""; }
      else this.scrubTo(this.playhead);
      S.timelineStrip.draw();
    }

    flashHint(msg) {
      this.dom.hint.textContent = msg;
      clearTimeout(this._hintT);
      this._hintT = setTimeout(() => { this.dom.hint.textContent = HINTS[this.mode]; }, 2500);
    }

    updateRec() {
      this.dom.rec.textContent = this.mode === "anim"
        ? `● REC @ ${this.playhead.toFixed(2)}s` : "";
    }

    togglePlay() {
      const tl = this.ev.rig.tl;
      if (tl.paused()) {
        if (this.mode !== "anim") this.setMode("anim");
        tl.play(); this.dom.playBtn.innerHTML = "&#10073;&#10073; Pause"; this._raf();
      } else {
        tl.pause(); this.dom.playBtn.innerHTML = "&#9658; Play";
      }
    }
    _raf() {
      if (!this.active || this.ev.rig.tl.paused()) return;
      this.playhead = this.ev.rig.tl.time() % (this.ev.spec.rig.anim.duration || 3);
      S.timelineStrip.draw();
      this.dom.timeLabel.textContent = this.playhead.toFixed(2) + "s";
      this.updateRec();
      requestAnimationFrame(() => this._raf());
    }

    scrubTo(t) {
      this.playhead = t;
      const rig = this.ev.rig;
      rig.tl.pause();
      this.dom.playBtn.innerHTML = "&#9658; Play";
      rig.tl.time(Math.min(t, Math.max(rig.tl.duration() - 0.0001, 0)));
      rig.dirty = true;
      this.dom.timeLabel.textContent = t.toFixed(2) + "s";
      this.updateRec();
    }

    toCrop(px, py) {
      const b = this.ev.box;
      return [S.clamp((px - b.x) / b.w, 0, 1), S.clamp((py - b.y) / b.h, 0, 1)];
    }
    toDesign(nx, ny) {
      const b = this.ev.box;
      return [b.x + nx * b.w, b.y + ny * b.h];
    }

    pinPositions() {
      const rig = this.ev.rig;
      return this.ev.spec.rig.bones.map((b) => {
        const p = this.mode === "anim" ? rig.pose[b.id] : b;
        const [x, y] = this.toDesign(p.x, p.y);
        return { bone: b, x, y };
      });
    }

    hitPin(px, py) {
      let best = null, bestD = PIN_R * 1.6;
      for (const p of this.pinPositions()) {
        const d = Math.hypot(px - p.x, py - p.y);
        if (d < bestD) { best = p.bone; bestD = d; }
      }
      return best;
    }

    onDown(e) {
      if (!this.active || !this.editor.isOpen) return;
      const local = S.root.toLocal({ x: e.clientX, y: e.clientY });
      const hit = this.hitPin(local.x, local.y);
      if (hit) {
        this.selectedPin = hit;
        this.dragging = true;
        this.dragRotate = e.altKey;
      } else if (this.mode === "setup") {
        const b = this.ev.box;
        if (local.x >= b.x && local.x <= b.x + b.w && local.y >= b.y && local.y <= b.y + b.h) {
          const parent = e.shiftKey && this.selectedPin ? this.selectedPin.id : null;
          this.addPin(...this.toCrop(local.x, local.y), parent);
        }
      } else {
        this.selectedPin = null;
      }
      this.refreshPinControls();
      S.timelineStrip.draw();
    }

    onMove(e) {
      if (!this.dragging || !this.selectedPin) return;
      const local = S.root.toLocal({ x: e.clientX, y: e.clientY });
      if (this.dragRotate) {
        const ref = this.mode === "anim" ? this.ev.rig.pose[this.selectedPin.id] : this.selectedPin;
        const [px, py] = this.toDesign(ref.x, ref.y);
        const deg = (Math.atan2(local.y - py, local.x - px) * 180) / Math.PI;
        if (this.mode === "setup") { this.selectedPin.angle = +deg.toFixed(1); this.ev.rig.refresh(); }
        else this.ev.rig.setPoseDirect(this.selectedPin.id, ref.x, ref.y, +deg.toFixed(1));
        return;
      }
      const [nx, ny] = this.toCrop(local.x, local.y);
      if (this.mode === "setup") {
        this.selectedPin.x = nx; this.selectedPin.y = ny;
        this.ev.rig.refresh();
      } else {
        this.ev.rig.setPoseDirect(this.selectedPin.id, nx, ny);
      }
    }

    onUp() {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.active || !this.ev) return; // editor closed mid-drag
      if (this.mode === "setup") this.commit();
      else this.writeKeyframe(this.selectedPin); // record on drop
    }

    /* explicit "+ Pin" button: drop a pin near the centre (spread so it never
       stacks exactly on an existing one), in Setup mode, ready to drag */
    addPinButton() {
      this.setMode("setup");
      const n = this.ev.spec.rig.bones.length;
      const nx = S.clamp(0.5 + ((n % 3) - 1) * 0.1, 0.05, 0.95);
      const ny = S.clamp(0.5 + ((Math.floor(n / 3) % 3) - 1) * 0.1, 0.05, 0.95);
      this.addPin(nx, ny, null);
      this.flashHint("pin added — drag it onto the image feature you want it to control");
      this.refreshPinControls();
      S.timelineStrip.draw();
    }

    addPin(nx, ny, parent) {
      const bones = this.ev.spec.rig.bones;
      let n = bones.length;
      let id; do { id = "pin" + n++; } while (bones.some((b) => b.id === id));
      const bone = { id, parent: parent || null, x: +nx.toFixed(4), y: +ny.toFixed(4), angle: 0, length: 0 };
      bones.push(bone);
      this.selectedPin = bone;
      this.ev.rig.refresh();
      this.commit();
    }

    removePin(bone) {
      const rig = this.ev.spec.rig;
      rig.bones = rig.bones.filter((b) => b !== bone);
      for (const b of rig.bones) if (b.parent === bone.id) b.parent = bone.parent || null;
      delete rig.anim.tracks[bone.id];
      this.selectedPin = null;
      this.ev.rig.spec = rig;
      this.ev.rig.refresh();
      this.commit();
      this.refreshPinControls();
      S.timelineStrip.draw();
    }

    writeKeyframe(bone) {
      if (!bone) return;
      const rig = this.ev.spec.rig;
      const tracks = rig.anim.tracks;
      const dur = rig.anim.duration || 3;
      const rest = { x: bone.x, y: bone.y, angle: bone.angle || 0 };
      const isNew = !tracks[bone.id];
      const keys = (tracks[bone.id] = tracks[bone.id] || []);
      // first time a pin is animated: seed rest at 0 and dur so it loops home
      if (isNew && this.playhead > 0.01 && this.playhead < dur - 0.01) {
        keys.push({ t: 0, ...rest });
        keys.push({ t: +dur.toFixed(2), ...rest });
        this.flashHint("added rest keys at 0s and end so the motion loops home");
      }
      const p = this.ev.rig.pose[bone.id];
      const t = +this.playhead.toFixed(2);
      const existing = keys.find((k) => Math.abs(k.t - t) < 0.05);
      const key = { t, x: +p.x.toFixed(4), y: +p.y.toFixed(4), angle: +(p.angle || 0).toFixed(1) };
      if (existing) Object.assign(existing, key);
      else keys.push(key);
      keys.sort((a, b) => a.t - b.t);
      this.ev.rig.buildTimeline();
      this.scrubTo(t);
      this.commit();
      S.timelineStrip.draw();
    }

    keyAllAtPlayhead() {
      for (const b of this.ev.spec.rig.bones) this.writeKeyframe(b);
    }

    /* a pin is "animated" if it has a keyframe track, else an "anchor" that
       holds still. Toggle = create / delete that track.                       */
    togglePinRole() {
      const pin = this.selectedPin;
      if (!pin) { this.flashHint("select a pin first (click it), then set its role"); return; }
      const rig = this.ev.spec.rig;
      const tracks = rig.anim.tracks;
      if (tracks[pin.id]) {
        delete tracks[pin.id];
        this.flashHint(`${pin.id} is now an ANCHOR — it holds the image still`);
      } else {
        const dur = rig.anim.duration || 3;
        const rest = { x: pin.x, y: pin.y, angle: pin.angle || 0 };
        tracks[pin.id] = [{ t: 0, ...rest }, { t: +dur.toFixed(2), ...rest }];
        this.setMode("anim");
        this.flashHint(`${pin.id} is now ANIMATED — move the playhead and drag it to add motion`);
      }
      this.ev.rig.buildTimeline();
      this.commit();
      this.refreshPinControls();
      S.timelineStrip.draw();
    }

    /* keep the Pin-role button in sync with the current selection */
    refreshPinControls() {
      const btn = this.dom.pinRole;
      if (!btn) return;
      if (!this.selectedPin) {
        btn.textContent = "Pin role";
        btn.classList.remove("on");
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
      const animated = !!this.ev.spec.rig.anim.tracks[this.selectedPin.id];
      btn.textContent = animated ? "Make anchor" : "Make animated";
      btn.classList.toggle("on", animated);
      btn.title = animated
        ? "this pin is animated (gold) — click to make it an anchor that holds still"
        : "this pin is an anchor (gray) — click to make it animated so you can keyframe it";
    }

    commit() {
      if (S.persist) S.persist.markDirty(this.ev.spec.id);
    }

    drawGizmos(g) {
      if (!this.ev) return;
      const view = this.ev.view;
      if (view instanceof PIXI.MeshPlane) {
        const rigSpec = this.ev.spec.rig;
        const vx = rigSpec.mesh.verticesX, vy = rigSpec.mesh.verticesY;
        const data = view.geometry.getAttribute("aPosition").buffer.data;
        const b = this.ev.box;
        const sx = b.w / view.texture.width, sy = b.h / view.texture.height;
        const X = (i) => b.x + data[2 * i] * sx;
        const Y = (i) => b.y + data[2 * i + 1] * sy;
        for (let r = 0; r < vy; r++) {
          for (let c = 0; c < vx; c++) {
            const i = r * vx + c;
            if (c + 1 < vx) g.moveTo(X(i), Y(i)).lineTo(X(i + 1), Y(i + 1));
            if (r + 1 < vy) g.moveTo(X(i), Y(i)).lineTo(X(i + vx), Y(i + vx));
          }
        }
        g.stroke({ width: 0.6, color: 0x4a90d9, alpha: 0.3 });
      }
      const pos = this.pinPositions();
      const byId = new Map(pos.map((p) => [p.bone.id, p]));
      for (const p of pos) {
        if (!p.bone.parent) continue;
        const pp = byId.get(p.bone.parent);
        if (pp) g.moveTo(pp.x, pp.y).lineTo(p.x, p.y).stroke({ width: 2.5, color: 0xc9a227, alpha: 0.7 });
      }
      for (const p of pos) {
        const sel = p.bone === this.selectedPin;
        const animated = !!this.ev.spec.rig.anim.tracks[p.bone.id];
        const ref = this.mode === "anim" ? this.ev.rig.pose[p.bone.id] : p.bone;
        const a = S.deg2rad(ref.angle || 0);
        g.moveTo(p.x, p.y).lineTo(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14)
          .stroke({ width: 1.5, color: 0xffffff, alpha: sel ? 0.9 : 0.3 });
        g.circle(p.x, p.y, sel ? 8 : 6)
          .fill({ color: animated ? 0xc9a227 : 0x999999, alpha: 0.95 })
          .stroke({ width: 2.5, color: sel ? 0xffffff : 0x000000, alpha: 0.85 });
      }
    }
  }

  S.RigEditor = RigEditor;
})();
