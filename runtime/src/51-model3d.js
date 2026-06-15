/* 3D-model elements (PowerPoint am3d:model3d) rendered with three.js and
   composited into the Pixi scene as ordinary textures.

   How it fits the one-writer scene graph: each model gets its OWN small
   three.js WebGLRenderer (offscreen canvas). That canvas is wrapped in a
   PIXI.Texture and used as the element's `view` Sprite -- so z-order, opacity,
   blend, mouse parallax, slide transitions and the GSAP entrance/idle tweens
   (which animate the wrapper nodes, never the pixels) all apply for free.

   three.js is ESM-only, so the build injects an import map + a bootstrap module
   that assigns window.THREE (+ THREE.GLTFLoader). Until that resolves -- or when
   three.js / the GLB is absent -- the element simply shows its rendered 2D
   preview crop (the universal fallback). Tier 1 needs none of this. */
(function () {
  "use strict";
  const S = window.SKULL;
  if (!S) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const MAX_PX = 1024;                 // cap the render-target's longest side

  // three.min.js loads as a classic global before the runtime, so THREE is ready
  // synchronously; null when the deck has no 3D build (element stays on preview).
  function threeReady() { return Promise.resolve(window.THREE || null); }

  function modelURL(src) {
    return (window.ASSETS || {})[src] ||
      (window.ASSET_BASE ? window.ASSET_BASE + src + "?v=" + (S.assetEpoch || 0) : src);
  }

  /* Shared bookkeeping: which live models need a per-frame update. */
  const Manager = {
    active: new Set(),
    ticking: false,
    last: 0,

    available() { return typeof window.THREE !== "undefined"; },

    attach(ev) {
      const m = new Model3DView(ev);
      m.load();                         // async; harmless if three.js never arrives
      return m;
    },

    _ensureTicker() {
      if (this.ticking || !S.app) return;
      this.ticking = true;
      S.app.ticker.add((tk) => {
        if (!this.active.size) return;
        const dt = tk.deltaMS / 1000;
        for (const m of this.active) m._frame(dt);
      });
    },
  };

  class Model3DView {
    constructor(ev) {
      this.ev = ev;
      this.spec = ev.spec;
      this.m3 = this.spec.model3d || {};
      this.ready = false;
      this.disposed = false;
      this.running = false;
      this.spin = 0;                    // entrance one-shot yaw offset (radians)
      this._dragMode = "orbit";         // toolbar sets "orbit" | "pan"
      // render target sized to the element box (DPR-aware, capped, aspect-kept)
      const w = Math.max(8, ev.box.w) * DPR, h = Math.max(8, ev.box.h) * DPR;
      const s = Math.min(1, MAX_PX / Math.max(w, h));
      this.rw = Math.round(w * s);
      this.rh = Math.round(h * s);
    }

    async load() {
      const THREE = await threeReady();
      if (!THREE || this.disposed) return;
      const url = this.spec.modelSrc;
      if (!url || !THREE.GLTFLoader) return;
      let gltf;
      try {
        gltf = await new THREE.GLTFLoader().loadAsync(modelURL(url));
      } catch (e) {
        console.warn("[skull] 3D model load failed, keeping preview:", url, e);
        return;
      }
      if (this.disposed) return;

      const canvas = document.createElement("canvas");
      canvas.width = this.rw; canvas.height = this.rh;
      this.renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
      });
      this.renderer.setClearColor(0x000000, 0);
      // correct sRGB output across three versions (r152+ vs the pinned r137)
      if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if ("outputEncoding" in this.renderer && THREE.sRGBEncoding) {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }

      this.scene = new THREE.Scene();
      this.root = gltf.scene;
      const t = this.m3.transform || {};
      if (t.rot) this.root.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
      if (t.scale) this.root.scale.set(t.scale[0], t.scale[1], t.scale[2]);
      this.scene.add(this.root);
      this._frameCamera(THREE);
      this._initOrbit(THREE);
      this._lights(THREE);

      this.clips = gltf.animations || [];
      this.clipNames = this.clips.map((c, i) => c.name || `clip ${i}`);
      if (this.clips.length) {
        this.mixer = new THREE.AnimationMixer(this.root);
        this.setClip(this.m3.clip ?? 0, this.m3.loop !== false);
      }

      // hand the live canvas to Pixi as this element's texture
      this.texture = PIXI.Texture.from(canvas);
      if (this.ev.view && !this.ev.view.destroyed) {
        this.ev.view.texture = this.texture;
      }
      this.ready = true;
      Manager._ensureTicker();
      this._frame(0);                   // paint at least once
      this.setControls(this.m3.orbit);  // interactive camera if enabled
      if (this.running || !this._pausedExplicitly) this.resume();
    }

    _frameCamera(THREE) {
      const box = new THREE.Box3().setFromObject(this.root);
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
      const fov = this.m3.camera?.fov || 45;
      const dist = (r / Math.sin((fov * Math.PI) / 180 / 2)) * 1.08;  // small margin
      this.camera = new THREE.PerspectiveCamera(fov, this.rw / this.rh, dist / 100, dist * 100);
      this.camera.position.set(c.x, c.y, c.z + dist);
      this.camera.lookAt(c);
      this.center = c;
    }

    /* orbit/pan/zoom state: spherical camera offset around a movable target */
    _initOrbit(THREE) {
      this.target = this.center.clone();
      const off = this.camera.position.clone().sub(this.target);
      this._r = off.length() || 1;
      this._theta = Math.atan2(off.x, off.z);
      this._phi = Math.acos(S.clamp(off.y / this._r, -1, 1));
      // remember the framed view so "Reset view" can restore it
      this._home = { r: this._r, theta: this._theta, phi: this._phi, target: this.target.clone() };
    }

    _applyCamera() {
      const THREE = window.THREE;
      const sp = Math.sin(this._phi);
      const off = new THREE.Vector3(
        this._r * sp * Math.sin(this._theta), this._r * Math.cos(this._phi), this._r * sp * Math.cos(this._theta));
      this.camera.position.copy(this.target).add(off);
      this.camera.lookAt(this.target);
      this._frame(0);                   // render immediately (also works when idle)
    }

    setDragMode(m) { this._dragMode = m === "pan" ? "pan" : "orbit"; }

    zoomBy(factor) {                    // toolbar +/- buttons (wheel still works)
      if (!this._home) return;
      this._r = S.clamp(this._r * factor, this._home.r * 0.25, this._home.r * 5);
      this._applyCamera();
    }

    resetView() {                       // inspector "Reset view" -> framed home
      const h = this._home;
      if (!h) return;
      this._r = h.r; this._theta = h.theta; this._phi = h.phi; this.target = h.target.clone();
      this._applyCamera();
    }

    /* drag to orbit, shift/right-drag to pan, wheel to zoom (Pixi federated
       events on the model's sprite; stops propagation so it doesn't also
       navigate the slide). Toggled per-model via spec.model3d.orbit. */
    setControls(on) {
      this.m3.orbit = !!on;
      const view = this.ev && this.ev.view;
      if (!view || view.destroyed) return;
      if (on && !this._ctl) {
        const THREE = window.THREE;
        view.eventMode = "static";
        view.cursor = "grab";
        let drag = false, pan = false, lx = 0, ly = 0;
        const down = (e) => {
          drag = true;
          pan = this._dragMode === "pan" || !!(e.shiftKey || e.button === 1 || e.button === 2);
          lx = e.global.x; ly = e.global.y; view.cursor = "grabbing";
          if (e.stopPropagation) e.stopPropagation();
        };
        const move = (e) => {
          if (!drag) return;
          const dx = e.global.x - lx, dy = e.global.y - ly;
          lx = e.global.x; ly = e.global.y;
          if (pan) {
            const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
            const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
            const s = this._r * 0.0016;
            this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
          } else {
            this._theta -= dx * 0.01;
            this._phi = S.clamp(this._phi - dy * 0.01, 0.05, Math.PI - 0.05);
          }
          this._applyCamera();
        };
        const uph = () => { drag = false; view.cursor = "grab"; };
        const wheel = (e) => {
          const d = e.deltaY || (e.nativeEvent && e.nativeEvent.deltaY) || 0;
          this._r = S.clamp(this._r * (d > 0 ? 1.1 : 0.9), this._home.r * 0.25, this._home.r * 5);
          this._applyCamera();
          if (e.stopPropagation) e.stopPropagation();
          if (e.preventDefault) e.preventDefault();
        };
        view.on("pointerdown", down);
        view.on("globalpointermove", move);
        view.on("pointerup", uph);
        view.on("pointerupoutside", uph);
        view.on("wheel", wheel);
        this._ctl = { down, move, uph, wheel };
      } else if (!on && this._ctl) {
        const c = this._ctl;
        view.off("pointerdown", c.down);
        view.off("globalpointermove", c.move);
        view.off("pointerup", c.uph);
        view.off("pointerupoutside", c.uph);
        view.off("wheel", c.wheel);
        view.cursor = "default";
        this._ctl = null;
      }
    }

    _lights(THREE) {
      // model-agnostic studio lighting (tuned for r137's legacy intensity scale,
      // where 1.0 ~= full; keep it gentle so bright materials don't blow out)
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404550, 0.95));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(1, 2, 3);
      this.scene.add(key);
      const fill = new THREE.DirectionalLight(0xbfd0ff, 0.35);
      fill.position.set(-2, -1, 1);
      this.scene.add(fill);
    }

    _frame(dt) {
      if (!this.ready || this.disposed) return;
      if (this.mixer) this.mixer.update(dt);
      const auto = this.m3.autoRotate || 0;              // editor emphasis (deg/s)
      if (auto && this.root) this.root.rotation.y += S.deg2rad(auto) * dt;
      if (this.spin && this.root) {                      // entrance spin -> 0
        this.root.rotation.y += this.spin * dt;
      }
      this.renderer.render(this.scene, this.camera);
      if (this.texture) this.texture.source.update();
    }

    setAutoRotate(dps) { this.m3.autoRotate = dps || 0; }

    setClip(idx, loop) {                                  // live clip switch (editor)
      if (!this.mixer || !this.clips || !this.clips.length) return;
      const THREE = window.THREE;
      this.mixer.stopAllAction();
      idx = S.clamp(idx | 0, 0, this.clips.length - 1);
      this.m3.clip = idx;
      this.m3.loop = loop !== false;
      const act = this.mixer.clipAction(this.clips[idx]);
      act.loop = this.m3.loop ? THREE.LoopRepeat : THREE.LoopOnce;
      act.clampWhenFinished = true;
      act.reset().play();
    }

    setFov(fov) {                                         // live camera FOV (editor)
      if (!this.camera) return;
      this.m3.camera = Object.assign(this.m3.camera || {}, { fov });
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    entranceSpin(turnsPerSec, seconds) {                  // brief yaw flourish
      if (!this.ready) { this._pendingSpin = [turnsPerSec, seconds]; return; }
      this.spin = (turnsPerSec || 2) * Math.PI * 2;
      gsap.to(this, { spin: 0, duration: seconds || 1, ease: "power2.out" });
    }

    resume() {
      this._pausedExplicitly = false;
      if (!this.ready) { this.running = true; return; }
      if (S.reducedMotion) { this._frame(0); return; }   // static pose only
      Manager.active.add(this);
      if (this._pendingSpin) { const p = this._pendingSpin; this._pendingSpin = null; this.entranceSpin(...p); }
    }

    pause() {
      this._pausedExplicitly = true;
      Manager.active.delete(this);
    }

    destroy() {
      this.disposed = true;
      try { this.setControls(false); } catch (e) { /* view may be gone */ }
      Manager.active.delete(this);
      if (this.mixer) this.mixer.stopAllAction();
      if (this.texture) this.texture.destroy(true);
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer.forceContextLoss?.();
        this.renderer = null;
      }
      this.scene = this.root = this.camera = null;
    }
  }

  S.Model3D = Manager;
})();
