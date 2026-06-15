/* SlideView + SlideManager: scene graph per slide, navigation, lifecycle.

   One-writer rule node stack per element:
     parallaxNode (ParallaxController only)
       -> animNode (entrance timeline only; positioned at element center, pivot center)
         -> idleNode (idle tweens only)
           -> view Sprite|MeshPlane (vertex buffer: Rig skinner only)            */
(function () {
  "use strict";
  const S = window.SKULL;

  class ElementView {
    constructor(el, deck) {
      this.spec = el;
      this.deck = deck;
      this.box = S.bboxToDesign(el.cropBbox || el.bbox, deck);
      this.parallaxNode = new PIXI.Container();
      this.animNode = new PIXI.Container();
      this.idleNode = new PIXI.Container();
      this.parallaxNode.addChild(this.animNode);
      this.animNode.addChild(this.idleNode);
      this.animNode.position.set(this.box.cx, this.box.cy);
      this.baseX = this.box.cx;
      this.baseY = this.box.cy;
      this.view = null;          // Sprite or MeshPlane
      this.rig = null;           // SKULL.Rig instance
      this.idleHandles = [];
      this.parallaxNode.zIndex = el.z || 0;
    }

    async build() {
      let tex;
      try {
        tex = await S.assets.texture(this.spec.crop);
      } catch (e) {
        // crop not generated yet (freshly drawn element) - translucent placeholder
        console.warn("[skull] missing crop, using placeholder:", this.spec.crop);
        tex = PIXI.Texture.WHITE;
        this.placeholder = true;
      }
      this.makeView(tex, !!this.spec.rig);
      if (this.placeholder) { this.view.tint = 0x6ee76e; this.view.alpha = 0.25; }
      if (this.spec.rig && S.Rig) this.attachRig(this.spec.rig);
    }

    /* Sprite by default; MeshPlane when a rig or meshWave idle needs vertices;
       a plain Sprite (preview crop) for model3d, whose texture S.Model3D swaps
       to a live three.js render once the GLB loads. */
    makeView(tex, needMesh) {
      const MESH = ["meshWave", "wave", "ripple", "swirl"];
      const hasMeshIdle = (this.spec.idle || []).some((i) => MESH.includes(i.type));
      const is3d = this.spec.type === "model3d";
      if (this.view) { this.idleNode.removeChild(this.view); this.view.destroy(); }
      if (!is3d && (needMesh || hasMeshIdle)) {
        const m = this.spec.rig?.mesh || {};
        this.view = new PIXI.MeshPlane({
          texture: tex,
          verticesX: m.verticesX || 10,
          verticesY: m.verticesY || 10,
        });
      } else {
        this.view = new PIXI.Sprite(tex);
      }
      this.view.width = this.box.w;
      this.view.height = this.box.h;
      this.view.position.set(-this.box.w / 2, -this.box.h / 2);
      if (this.spec.blendMode && this.spec.blendMode !== "normal") {
        this.view.blendMode = this.spec.blendMode;
      }
      // static compositing opacity lives on the view - entrance/idle alphas
      // animate the wrapper nodes, so the one-writer rule holds
      if (this.spec.opacity != null && this.spec.opacity !== 1) {
        this.view.alpha = this.spec.opacity;
      }
      // censor mode: the footprint patch covers the original pixels and the
      // element itself never draws (used to blur away logos/unwanted text)
      this.view.visible = !this.spec.hidden;
      this.idleNode.addChild(this.view);
      this.view.__skullEl = this; // editor hit-testing backref
      // model3d: start loading the GLB; it swaps this.view.texture when ready
      if (is3d && S.Model3D && !this.model3d) this.model3d = S.Model3D.attach(this);
    }

    /* studio: bbox was edited - reposition using the new box (crop texture is
       stale until a server-side re-crop, which reloads the page) */
    relayout() {
      this.box = S.bboxToDesign(this.spec.bbox, this.deck);
      this.baseX = this.box.cx;
      this.baseY = this.box.cy;
      this.animNode.position.set(this.box.cx, this.box.cy);
      if (this.view) {
        this.view.width = this.box.w;
        this.view.height = this.box.h;
        this.view.position.set(-this.box.w / 2, -this.box.h / 2);
      }
    }

    /* swap to MeshPlane if needed and bind a Rig */
    attachRig(rigSpec) {
      if (!(this.view instanceof PIXI.MeshPlane)) this.makeView(this.view.texture, true);
      if (this.rig) this.rig.destroy();
      this.rig = new S.Rig(this.view, rigSpec, this.box.w, this.box.h);
      this.rig.bake();
      this.rig.buildTimeline();
    }

    startIdles() {
      this.stopIdles();
      if (this.model3d) this.model3d.resume();   // render even under reduced-motion
      if (S.reducedMotion) return;
      for (const idle of this.spec.idle || []) {
        const fx = S.Effects.idle[idle.type];
        if (fx) this.idleHandles.push(fx(this, idle));
      }
      if (this.rig && this.rig.tl) this.rig.tl.play(0);
    }

    stopIdles() {
      for (const h of this.idleHandles) h.stop();
      this.idleHandles = [];
      if (this.model3d) this.model3d.pause();    // off-slide: stop wasting the GPU
      if (this.rig && this.rig.tl) this.rig.tl.pause();
    }

    destroy() {
      this.stopIdles();
      if (this.model3d) this.model3d.destroy();
      if (this.rig) this.rig.destroy();
      this.parallaxNode.destroy({ children: true });
    }
  }

  class SlideView {
    constructor(slide, deck) {
      this.spec = slide;
      this.deck = deck;
      this.container = new PIXI.Container();
      this.container.visible = false;
      this.built = false;
      this.building = null;
      this.elements = [];
      this.timeline = null;
      this.bgSprite = null;
      this.bgIdleHandle = null;
    }

    build() {
      if (this.building) return this.building;
      this.building = this._build();
      return this.building;
    }

    async _build() {
      if (this.built) return;
      const deck = this.deck;
      const bgTex = await S.assets.texture(this.spec.background.src);
      this.bgSprite = new PIXI.Sprite(bgTex);
      this.bgSprite.width = deck.designWidth;
      this.bgSprite.height = deck.designHeight;
      // bg gets its own pivot-centered wrapper so kenBurns scales from center
      this.bgWrap = new PIXI.Container();
      this.bgWrap.position.set(deck.designWidth / 2, deck.designHeight / 2);
      this.bgSprite.position.set(-deck.designWidth / 2, -deck.designHeight / 2);
      this.bgWrap.addChild(this.bgSprite);

      this.patchLayer = new PIXI.Container();
      this.elementLayer = new PIXI.Container();
      this.elementLayer.sortableChildren = true;
      this.container.addChild(this.bgWrap, this.patchLayer, this.elementLayer);

      for (const el of this.spec.elements || []) {
        // cover the element's original footprint so it can move away cleanly
        if (el.cleanup === "fill" && el.fillColor) {
          const b = S.bboxToDesign(el.cropBbox || el.bbox, deck);
          const g = new PIXI.Graphics();
          g.rect(b.x, b.y, b.w, b.h).fill(parseInt(el.fillColor.slice(1), 16));
          this.patchLayer.addChild(g);
        } else if (el.cleanup === "blur" && el.patch) {
          const b = S.bboxToDesign(el.cropBbox || el.bbox, deck);
          const tex = await S.assets.texture(el.patch);
          const sp = new PIXI.Sprite(tex);
          sp.position.set(b.x, b.y);
          sp.width = b.w; sp.height = b.h;
          this.patchLayer.addChild(sp);
        }
        const ev = new ElementView(el, deck);
        await ev.build();
        this.elementLayer.addChild(ev.parallaxNode);
        this.elements.push(ev);
      }
      this.built = true;
    }

    buildTimeline() {
      if (this.timeline) this.timeline.kill();
      const tl = gsap.timeline({ paused: true });
      for (const ev of this.elements) {
        const ent = ev.spec.entrance || { type: "none" };
        const fx = S.Effects.entrance[ent.type] || S.Effects.entrance.none;
        fx(ev, ent, tl);
      }
      this.timeline = tl;
      return tl;
    }

    enter() {
      this.container.visible = true;
      this.buildTimeline();
      if (S.reducedMotion) this.timeline.progress(1);
      else this.timeline.restart();
      for (const ev of this.elements) ev.startIdles();
      const bgIdle = this.spec.background.idle;
      if (bgIdle && !S.reducedMotion && S.Effects.idle[bgIdle.type]) {
        this.bgIdleHandle = S.Effects.idle[bgIdle.type](
          { idleNode: this.bgWrap, view: this.bgSprite, box: { w: this.deck.designWidth, h: this.deck.designHeight } },
          bgIdle
        );
      }
      S.parallax && S.parallax.setElements(this.elements);
    }

    exit() {
      if (this.timeline) this.timeline.kill();
      for (const ev of this.elements) ev.stopIdles();
      if (this.bgIdleHandle) { this.bgIdleHandle.stop(); this.bgIdleHandle = null; }
      this.container.visible = false;
    }

    /* editor: background idle spec changed - restart it live */
    restartBgIdle() {
      if (this.bgIdleHandle) { this.bgIdleHandle.stop(); this.bgIdleHandle = null; }
      this.bgWrap.scale.set(1);
      this.bgWrap.rotation = 0;
      this.bgWrap.alpha = 1;
      const idle = this.spec.background.idle;
      if (idle && idle.type && idle.type !== "none" && !S.reducedMotion && S.Effects.idle[idle.type]) {
        this.bgIdleHandle = S.Effects.idle[idle.type](
          { idleNode: this.bgWrap, view: this.bgSprite,
            box: { w: this.deck.designWidth, h: this.deck.designHeight } },
          idle
        );
      }
    }

    unloadTextures() {
      if (!this.built) return;
      S.assets.unload(this.spec.background.src);
      for (const el of this.spec.elements || []) {
        if (el.crop) S.assets.unload(el.crop);
        if (el.patch) S.assets.unload(el.patch);
      }
    }
  }

  class SlideManager {
    constructor(manifest) {
      this.manifest = manifest;
      this.deck = manifest.deck;
      this.views = manifest.slides.map((s) => new SlideView(s, manifest.deck));
      for (const v of this.views) S.slideHost.addChild(v.container);
      this.current = -1;
      this.transitioning = false;
    }

    get slideCount() { return this.views.length; }
    get currentView() { return this.views[this.current]; }

    async goto(i, instant) {
      if (i < 0 || i >= this.views.length || i === this.current || this.transitioning) return;
      const prev = this.current >= 0 ? this.views[this.current] : null;
      const next = this.views[i];
      this.transitioning = true;
      await next.build();

      const t = this.deck.transition || { type: "crossfade", duration: 0.9 };
      const dur = instant || S.reducedMotion ? 0 : t.duration || 0.9;

      next.container.alpha = 0;
      next.enter();
      this.current = i;
      if (S.editor) S.editor.onSlideChanged();

      await new Promise((resolve) => {
        const done = () => {
          if (prev) { prev.exit(); prev.container.alpha = 1; }
          resolve();
        };
        if (dur === 0) { next.container.alpha = 1; done(); return; }
        if (t.type === "slideLeft" && prev) {
          next.container.alpha = 1;
          const W = this.deck.designWidth;
          const dirSign = i > this.views.indexOf(prev) ? 1 : -1;
          next.container.x = dirSign * W;
          gsap.to(prev.container, { x: -dirSign * W, duration: dur, ease: S.ease(t.ease, "power2.inOut") });
          gsap.to(next.container, {
            x: 0, duration: dur, ease: S.ease(t.ease, "power2.inOut"),
            onComplete: () => { if (prev) prev.container.x = 0; done(); },
          });
        } else {
          gsap.to(next.container, { alpha: 1, duration: dur, ease: S.ease(t.ease, "power2.inOut"), onComplete: done });
        }
      });

      this.transitioning = false;
      this.prefetch();
    }

    prefetch() {
      const i = this.current;
      if (this.views[i + 1]) this.views[i + 1].build();
      if (this.views[i - 1]) this.views[i - 1].build();
      this.views.forEach((v, k) => { if (Math.abs(k - i) > 1) v.unloadTextures(); });
    }

    next() { this.goto(this.current + 1); }
    prev() { this.goto(this.current - 1); }

    bindInput() {
      window.addEventListener("keydown", (ev) => {
        if (S.editor && S.editor.isOpen && !["Escape"].includes(ev.key)) {
          if (ev.key.toLowerCase() !== "e") return; // editor swallows nav keys
        }
        switch (ev.key) {
          case "ArrowRight": case " ": case "PageDown": this.next(); break;
          case "ArrowLeft": case "PageUp": this.prev(); break;
          case "Home": this.goto(0); break;
          case "End": this.goto(this.slideCount - 1); break;
        }
      });
      const nav = this.manifest.deck.navigation || {};
      if (nav.click !== false) {
        let downX = null, downY = null, downT = 0;
        this.downHandler = (ev) => { downX = ev.clientX; downY = ev.clientY; downT = Date.now(); };
        S.app.canvas.addEventListener("pointerdown", this.downHandler);
        S.app.canvas.addEventListener("pointerup", (ev) => {
          if (S.editor && S.editor.isOpen) return;
          if (downX === null) return;
          const dx = ev.clientX - downX, dy = ev.clientY - downY;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            dx < 0 ? this.next() : this.prev(); // swipe
          } else if (Math.hypot(dx, dy) < 8 && Date.now() - downT < 400) {
            ev.clientX > window.innerWidth / 2 ? this.next() : this.prev(); // tap
          }
          downX = null;
        });
      }
    }
  }

  S.ElementView = ElementView;
  S.SlideView = SlideView;
  S.SlideManager = SlideManager;
})();
