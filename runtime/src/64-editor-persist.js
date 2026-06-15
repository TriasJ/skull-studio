/* Persistence: localStorage autosave of per-element overrides + JSON export.
   Overrides hold the WHOLE current value of the keys we manage, so the build
   script can deep-merge by simple key replacement.                          */
(function () {
  "use strict";
  const S = window.SKULL;
  const KEYS = ["entrance", "idle", "parallax", "rig", "cleanup", "blendMode", "opacity",
                "hidden", "blurRadius", "fillColor", "regions", "polygon", "bbox", "name", "z",
                "model3d", "modelSrc"];

  class Persist {
    constructor(manifest) {
      this.manifest = manifest;
      this.storageKey = "skull:" + manifest.meta.docId;
      this.dirtyIds = new Set(this.loadStoredIds());
      this.dirtySlideIds = new Set();
      this.statusEl = document.getElementById("ed-save-status");
    }

    markSlideDirty(slideId) {
      this.dirtySlideIds.add(slideId);
      clearTimeout(this._t);
      this._t = setTimeout(() => this.save(), 1000);
      if (this.statusEl) this.statusEl.textContent = "…";
    }

    loadStoredIds() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return [];
        const ov = JSON.parse(raw);
        return Object.keys(ov.elements || {});
      } catch (e) { return []; }
    }

    /* boot-time: apply stored overrides over the embedded manifest */
    applyStored() {
      if (window.STUDIO) return 0; // disk manifest is authoritative in studio
      let ov;
      try {
        ov = JSON.parse(localStorage.getItem(this.storageKey) || "null");
      } catch (e) { ov = null; }
      if (!ov || ov.docId !== this.manifest.meta.docId) return 0;
      const byId = new Map();
      for (const s of this.manifest.slides) for (const el of s.elements) byId.set(el.id, el);
      let n = 0;
      for (const [id, patch] of Object.entries(ov.elements || {})) {
        const el = byId.get(id);
        if (!el) continue;
        for (const [k, v] of Object.entries(patch)) el[k] = v;
        n++;
      }
      for (const [sid, patch] of Object.entries(ov.slides || {})) {
        const sl = this.manifest.slides.find((s) => s.id === sid);
        if (!sl) continue;
        for (const [k, v] of Object.entries(patch)) sl[k] = v;
        this.dirtySlideIds.add(sid);
        n++;
      }
      if (n) console.info(`[skull] applied stored edits for ${n} item(s)`);
      return n;
    }

    markDirty(id) {
      this.dirtyIds.add(id);
      clearTimeout(this._t);
      this._t = setTimeout(() => this.save(), 1000);
      if (this.statusEl) this.statusEl.textContent = "…";
    }

    buildOverrides() {
      const ov = { skullOverridesVersion: 1, docId: this.manifest.meta.docId,
                   elements: {}, slides: {} };
      const byId = new Map();
      for (const s of this.manifest.slides) for (const el of s.elements) byId.set(el.id, el);
      for (const id of this.dirtyIds) {
        const el = byId.get(id);
        if (!el) continue;
        const patch = {};
        for (const k of KEYS) if (el[k] !== undefined) patch[k] = el[k];
        ov.elements[id] = patch;
      }
      for (const sid of this.dirtySlideIds) {
        const sl = this.manifest.slides.find((s) => s.id === sid);
        if (sl) ov.slides[sid] = { background: sl.background };
      }
      return ov;
    }

    save() {
      if (window.STUDIO) return this.saveStudio();
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.buildOverrides()));
        if (this.statusEl) {
          this.statusEl.textContent = "saved";
          setTimeout(() => { this.statusEl.textContent = ""; }, 1500);
        }
      } catch (e) {
        console.warn("[skull] localStorage save failed", e);
        if (this.statusEl) this.statusEl.textContent = "save failed";
      }
    }

    /* studio mode: the manifest on disk IS the document - save all of it.
       Optimistic lock: a tab holding an older manifest revision is refused
       so it can never clobber newer disk state (reload to continue). */
    async saveStudio() {
      try {
        const headers = { "content-type": "application/json" };
        if (S.manifestRev) headers["x-manifest-rev"] = S.manifestRev;
        const res = await fetch("/api/manifest", {
          method: "POST", headers, body: JSON.stringify(this.manifest),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.rev) S.manifestRev = data.rev;
        }
        if (this.statusEl) {
          this.statusEl.textContent = res.ok ? "saved to project"
            : res.status === 409 ? "STALE TAB - reload to keep editing" : "SAVE FAILED";
          if (res.ok) setTimeout(() => { this.statusEl.textContent = ""; }, 1500);
        }
      } catch (e) {
        if (this.statusEl) this.statusEl.textContent = "SAVE FAILED";
      }
    }

    resetElement(id) {
      this.dirtyIds.delete(id);
      if (!window.STUDIO) this.save();
      location.reload(); // simplest way back to saved state for that element
    }

    exportOverrides() {
      const json = JSON.stringify(this.buildOverrides(), null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "overrides.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  S.Persist = Persist;
})();
