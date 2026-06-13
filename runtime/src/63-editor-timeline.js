/* TimelineStrip: canvas keyframe editor for the rig.
   - ruler with a draggable playhead handle (triangle)
   - one labeled row per animated pin, larger diamonds
   - drag a diamond horizontally to re-time it; right-click deletes it
   - click empty ruler/rows to scrub                                            */
(function () {
  "use strict";
  const S = window.SKULL;
  const GUTTER = 64;   // left label column
  const RULER_H = 18;  // top ruler band
  const ROW_H = 20;
  const ROW_TOP = RULER_H + 8;

  class TimelineStrip {
    constructor() {
      this.canvas = document.getElementById("ed-timeline-canvas");
      this.ctx = this.canvas.getContext("2d");
      this.rigEd = null;
      this.selectedKey = null;   // {boneId, key}
      this.dragKey = null;       // {boneId, key} being re-timed
      this.scrubbing = false;
      this.hoverKey = null;

      this.canvas.addEventListener("pointerdown", (e) => this.onDown(e));
      this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
      this.canvas.addEventListener("pointerup", () => this.onUp());
      window.addEventListener("pointerup", () => this.onUp());
      this.canvas.addEventListener("contextmenu", (e) => this.onContext(e));
    }

    attach(rigEd) {
      this.rigEd = rigEd;
      this.selectedKey = null;
      const r = this.canvas.getBoundingClientRect();
      this.canvas.width = r.width * devicePixelRatio;
      this.canvas.height = r.height * devicePixelRatio;
      this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      this.draw();
    }

    get duration() { return this.rigEd?.ev?.spec.rig.anim.duration || 3; }
    get tracks() { return this.rigEd?.ev?.spec.rig.anim.tracks || {}; }
    get width() { return this.canvas.getBoundingClientRect().width; }

    tToX(t) { return GUTTER + (t / this.duration) * (this.width - GUTTER - 10); }
    xToT(x) { return S.clamp(((x - GUTTER) / (this.width - GUTTER - 10)) * this.duration, 0, this.duration); }
    rowY(i) { return ROW_TOP + i * ROW_H + ROW_H / 2; }

    pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    hitKey(x, y) {
      let row = 0;
      for (const [boneId, keys] of Object.entries(this.tracks)) {
        const cy = this.rowY(row);
        if (Math.abs(y - cy) < 8) {
          for (const k of keys) {
            if (Math.abs(x - this.tToX(k.t)) < 7) return { boneId, key: k };
          }
        }
        row++;
      }
      return null;
    }

    onDown(e) {
      if (!this.rigEd || !this.rigEd.active || e.button === 2) return;
      // capture the pointer so dragging continues even outside the strip
      try { this.canvas.setPointerCapture(e.pointerId); this._pid = e.pointerId; } catch (err) {}
      const { x, y } = this.pos(e);
      const hit = this.hitKey(x, y);
      // grabbing the playhead handle takes priority over scrubbing-to-click,
      // but a keyframe diamond under the cursor wins (so you can re-time it)
      if (!hit && Math.abs(x - this.tToX(this.rigEd.playhead)) < 9) {
        this.scrubbing = true;
        this.rigEd.setMode("anim");
        this.draw();
        return;
      }
      if (hit) {
        this.selectedKey = hit;
        this.dragKey = hit;
        this.rigEd.setMode("anim");
        this.rigEd.scrubTo(hit.key.t);
        this.draw();
        return;
      }
      // click empty area -> jump the playhead here, then keep dragging
      this.scrubbing = true;
      this.rigEd.setMode("anim");
      this.rigEd.scrubTo(+this.xToT(x).toFixed(2));
      this.draw();
    }

    onPointerMove(e) {
      if (!this.rigEd || !this.rigEd.active) return;
      const { x, y } = this.pos(e);
      if (this.dragKey) {
        // re-time the dragged keyframe (t=0 rest key stays pinned at 0)
        const nt = +this.xToT(x).toFixed(2);
        this.dragKey.key.t = nt;
        const keys = this.tracks[this.dragKey.boneId];
        keys.sort((a, b) => a.t - b.t);
        this.rigEd.ev.rig.buildTimeline();
        this.rigEd.scrubTo(nt);
        this.draw();
        return;
      }
      if (this.scrubbing) {
        this.rigEd.scrubTo(+this.xToT(x).toFixed(2));
        this.draw();
        return;
      }
      const h = this.hitKey(x, y);
      const id = h ? h.key : null;
      const nearPlayhead = Math.abs(x - this.tToX(this.rigEd.playhead)) < 9;
      this.canvas.style.cursor = (h || nearPlayhead) ? "ew-resize" : "crosshair";
      if (id !== this.hoverKey) { this.hoverKey = id; this.draw(); }
    }

    onUp() {
      if (this._pid != null) { try { this.canvas.releasePointerCapture(this._pid); } catch (err) {} this._pid = null; }
      if (this.dragKey) { this.rigEd.commit(); this.dragKey = null; }
      this.scrubbing = false;
    }

    onContext(e) {
      if (!this.rigEd || !this.rigEd.active) return;
      const { x, y } = this.pos(e);
      const hit = this.hitKey(x, y);
      if (hit) { e.preventDefault(); this.selectedKey = hit; this.deleteSelectedKey(); }
    }

    deleteSelectedKey() {
      if (!this.selectedKey || !this.rigEd) return;
      const { boneId, key } = this.selectedKey;
      const tracks = this.tracks;
      tracks[boneId] = (tracks[boneId] || []).filter((k) => k !== key);
      if (!tracks[boneId].length) delete tracks[boneId];
      this.selectedKey = null;
      this.rigEd.ev.rig.buildTimeline();
      this.rigEd.commit();
      this.draw();
    }

    draw() {
      if (!this.rigEd || !this.rigEd.active) return;
      const ctx = this.ctx;
      const W = this.width, H = this.canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, W, H);
      const dur = this.duration;

      // ruler
      ctx.fillStyle = "#777";
      ctx.font = "9px system-ui";
      ctx.textBaseline = "alphabetic";
      const step = dur > 6 ? 1 : dur > 3 ? 0.5 : 0.25;
      for (let t = 0; t <= dur + 1e-6; t += step) {
        const x = this.tToX(t);
        ctx.fillStyle = "#555";
        ctx.fillRect(x, RULER_H - 5, 1, 5);
        ctx.fillStyle = "#888";
        ctx.fillText(t.toFixed(step < 0.5 ? 2 : 1) + "s", x - 7, RULER_H - 7);
      }

      const trackEntries = Object.entries(this.tracks);
      // rows
      trackEntries.forEach(([boneId, keys], row) => {
        const cy = this.rowY(row);
        ctx.fillStyle = "#9a9485";
        ctx.font = "11px system-ui";
        ctx.fillText(boneId.length > 8 ? boneId.slice(0, 8) : boneId, 4, cy + 4);
        ctx.strokeStyle = "#2a2a30";
        ctx.beginPath(); ctx.moveTo(GUTTER, cy); ctx.lineTo(this.tToX(dur), cy); ctx.stroke();
        for (const k of keys) {
          const x = this.tToX(k.t);
          const sel = this.selectedKey && this.selectedKey.key === k;
          const hov = this.hoverKey === k;
          ctx.fillStyle = sel ? "#fff" : hov ? "#e8c95a" : "#c9a227";
          ctx.beginPath();
          ctx.moveTo(x, cy - 6); ctx.lineTo(x + 5, cy); ctx.lineTo(x, cy + 6); ctx.lineTo(x - 5, cy);
          ctx.closePath(); ctx.fill();
          if (sel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); }
        }
      });

      if (!trackEntries.length) {
        ctx.fillStyle = "#6a6555";
        ctx.font = "11px system-ui";
        ctx.fillText("No motion yet. Switch to Animate, move the playhead, then drag a pin — or pick a preset on the right.", GUTTER, this.rowY(0) + 4);
      }

      // playhead line + grab handle (bigger so it reads as draggable)
      const px = this.tToX(this.rigEd.playhead);
      ctx.strokeStyle = this.scrubbing ? "#ffe082" : "#c9a227";
      ctx.lineWidth = this.scrubbing ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(px, RULER_H - 4); ctx.lineTo(px, H - 2); ctx.stroke();
      // rounded grip at the top
      ctx.fillStyle = this.scrubbing ? "#ffe082" : "#c9a227";
      ctx.beginPath();
      ctx.moveTo(px - 7, 1); ctx.lineTo(px + 7, 1); ctx.lineTo(px + 7, RULER_H - 9);
      ctx.lineTo(px, RULER_H - 2); ctx.lineTo(px - 7, RULER_H - 9);
      ctx.closePath(); ctx.fill();
      // two grip lines on the handle
      ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 2, 4); ctx.lineTo(px - 2, RULER_H - 9);
      ctx.moveTo(px + 2, 4); ctx.lineTo(px + 2, RULER_H - 9);
      ctx.stroke();
    }
  }

  S.TimelineStrip = TimelineStrip;
})();
