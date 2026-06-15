/* Effects registry: manifest animation specs -> GSAP tweens / ticker loops.
   entrance[name](elView, spec, timeline)  - inserts tweens at spec.delay
   idle[name](elView, spec) -> {stop()}    - starts looping, returns handle    */
(function () {
  "use strict";
  const S = window.SKULL;
  const D = () => S.manager.deck;

  function baseSet(ev) {
    // deterministic restart: every entrance fully re-seeds its writes
    return { node: ev.animNode, x: ev.baseX, y: ev.baseY };
  }

  const entrance = {
    none(ev, spec, tl) {
      tl.set(ev.animNode, { alpha: 1, x: ev.baseX, y: ev.baseY }, 0);
    },

    fadeIn(ev, spec, tl) {
      const { node, x, y } = baseSet(ev);
      tl.fromTo(node, { alpha: 0, x, y },
        { alpha: 1, duration: spec.duration || 0.8, ease: S.ease(spec.ease) },
        spec.delay || 0);
    },

    fadeUp(ev, spec, tl) { dirFade(ev, spec, tl, 0, 1); },
    fadeDown(ev, spec, tl) { dirFade(ev, spec, tl, 0, -1); },
    fadeLeft(ev, spec, tl) { dirFade(ev, spec, tl, 1, 0); },
    fadeRight(ev, spec, tl) { dirFade(ev, spec, tl, -1, 0); },

    scaleIn(ev, spec, tl) {
      const { node, x, y } = baseSet(ev);
      tl.fromTo(node, { alpha: 0, x, y }, { alpha: 1, duration: (spec.duration || 1) * 0.6, ease: "power2.out" }, spec.delay || 0);
      tl.fromTo(node.scale, { x: spec.from ?? 0.82, y: spec.from ?? 0.82 },
        { x: 1, y: 1, duration: spec.duration || 1, ease: S.ease(spec.ease, "back.out(1.4)") },
        spec.delay || 0);
    },

    maskReveal(ev, spec, tl) {
      const { node, x, y } = baseSet(ev);
      const b = ev.box;
      const dir = spec.direction || "left";
      const g = new PIXI.Graphics();
      node.parent.addChild(g);
      const proxy = { p: 0 };
      const pad = 4;
      const draw = () => {
        const p = proxy.p;
        g.clear();
        let rx = b.x - pad, ry = b.y - pad, rw = (b.w + 2 * pad) * p, rh = b.h + 2 * pad;
        if (dir === "right") rx = b.x + b.w + pad - rw;
        if (dir === "up" || dir === "down") {
          rw = b.w + 2 * pad; rh = (b.h + 2 * pad) * p;
          if (dir === "up") ry = b.y + b.h + pad - rh;
        }
        if (dir === "center") {
          rw = (b.w + 2 * pad) * p; rh = (b.h + 2 * pad) * p;
          rx = b.cx - rw / 2; ry = b.cy - rh / 2;
        }
        g.rect(rx, ry, Math.max(rw, 0.01), Math.max(rh, 0.01)).fill(0xffffff);
      };
      tl.set(node, { alpha: 1, x, y }, 0);
      tl.set(proxy, { p: 0, onComplete: () => { node.mask = g; draw(); } }, 0);
      tl.to(proxy, {
        p: 1, duration: spec.duration || 1.2, ease: S.ease(spec.ease, "power2.inOut"),
        onUpdate: draw,
        onComplete: () => { node.mask = null; g.visible = false; }, // masks cost a stencil pass
        onStart: () => { g.visible = true; },
      }, spec.delay || 0);
    },

    blurIn(ev, spec, tl) {
      const { node, x, y } = baseSet(ev);
      const blur = new PIXI.BlurFilter({ strength: spec.fromBlur || 12 });
      tl.fromTo(node, { alpha: 0, x, y }, {
        alpha: 1, duration: spec.duration || 1, ease: S.ease(spec.ease),
        onStart: () => { node.filters = [blur]; },
      }, spec.delay || 0);
      tl.to(blur, {
        strength: 0, duration: spec.duration || 1, ease: S.ease(spec.ease),
        onComplete: () => { node.filters = null; },
      }, spec.delay || 0);
    },

    drawOn(ev, spec, tl) { // alpha wipe along an axis - good for rule lines/ornaments
      entrance.maskReveal(ev, { ...spec, direction: spec.direction || "left" }, tl);
    },

    staggerText(ev, spec, tl) {
      // graceful degradation: without lines[] sub-crops, wipe down instead
      entrance.maskReveal(ev, { ...spec, direction: "down", duration: spec.duration || 1 }, tl);
    },

    // ---- 3D-model entrances (fall back to the 2D move when no live model) ----
    scaleIn3D(ev, spec, tl) { entrance.scaleIn(ev, spec, tl); },

    rotateIn(ev, spec, tl) {
      entrance.fadeIn(ev, spec, tl);
      if (ev.model3d) {
        tl.add(() => ev.model3d.entranceSpin(spec.turns ?? 1, spec.duration || 1), spec.delay || 0);
      }
    },
  };

  function dirFade(ev, spec, tl, sx, sy) {
    const { node, x, y } = baseSet(ev);
    const dist = (spec.distance ?? 0.04) * D().designHeight;
    tl.fromTo(node, { alpha: 0, x: x + sx * dist, y: y + sy * dist },
      { alpha: 1, x, y, duration: spec.duration || 1, ease: S.ease(spec.ease, "power3.out") },
      spec.delay || 0);
  }

  /* ---------------- idle loops (write idleNode / mesh verts only) -------------- */

  function tweenHandle(tween) {
    return { stop() { tween.kill(); } };
  }

  /* ---- shared mesh-displacement driver (generalizes meshWave) -------------
     dispFn(x, y, texW, texH, tau, spec) -> [dx, dy] in texture pixels. Keep these
     formulas identical to render_clips.py's displace_field() so video export matches. */
  const MESH_IDLES = ["meshWave", "wave", "ripple", "swirl"];
  function meshDisplace(ev, spec, dispFn) {
    if (!(ev.view instanceof PIXI.MeshPlane) || ev.rig) return { stop() {} };
    const buf = ev.view.geometry.getAttribute("aPosition").buffer;
    const rest = Float32Array.from(buf.data);
    const W = ev.view.texture.width, H = ev.view.texture.height;
    const speed = spec.speed ?? 0.6;
    let t = 0;
    const cb = (ticker) => {
      t += ticker.deltaMS / 1000;
      const tau = t * speed;
      for (let i = 0; i < buf.data.length; i += 2) {
        const x = rest[i], y = rest[i + 1];
        const d = dispFn(x, y, W, H, tau, spec);
        buf.data[i] = x + d[0];
        buf.data[i + 1] = y + d[1];
      }
      buf.update();
    };
    S.app.ticker.add(cb);
    return { stop() { S.app.ticker.remove(cb); buf.data.set(rest); buf.update(); } };
  }
  function waveDisp(x, y, W, H, tau, s) {
    const amp = (s.amplitude ?? 0.02) * H, waves = s.waves ?? 2;
    if (s.axis === "x") return [amp * Math.sin(2 * Math.PI * ((y / H) * waves + tau)), 0];
    return [0, amp * Math.sin(2 * Math.PI * ((x / W) * waves + tau))];
  }
  const RF = [3, 5.5, 8], RS = [1.0, 1.4, 0.8], RPX = [0, 1.7, 3.1], RPY = [2.0, 0.5, 4.2], RA = [1.0, 0.6, 0.45];
  function rippleDisp(x, y, W, H, tau, s) {       // underwater: sum of 2-3 sine waves, both axes
    const amp = (s.amplitude ?? 0.012) * H, n = Math.max(1, Math.min(3, s.waves ?? 2));
    let dx = 0, dy = 0;
    for (let k = 0; k < n; k++) {
      dx += RA[k] * Math.sin(2 * Math.PI * ((y / H) * RF[k] + tau * RS[k] + RPX[k]));
      dy += RA[k] * Math.sin(2 * Math.PI * ((x / W) * RF[k] + tau * RS[k] + RPY[k]));
    }
    return [amp * dx, amp * dy];
  }
  function swirlDisp(x, y, W, H, tau, s) {
    const cx = W / 2, cy = H / 2, maxR = Math.hypot(W, H) / 2, R = s.radius ?? 0.7;
    const ux = x - cx, uy = y - cy, r = Math.hypot(ux, uy) / maxR;
    const ang = S.deg2rad(s.degrees ?? 12) * Math.max(0, 1 - r / R) * Math.sin(2 * Math.PI * tau);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return [cx + ux * ca - uy * sa - x, cy + ux * sa + uy * ca - y];
  }

  const idle = {
    float(ev, spec) {
      const amp = (spec.amplitude ?? 0.006) * D().designHeight;
      ev.idleNode.y = 0;
      return tweenHandle(gsap.fromTo(ev.idleNode, { y: -amp }, {
        y: amp, duration: (spec.period || 5) / 2, yoyo: true, repeat: -1, ease: "sine.inOut",
        onInterrupt: () => { ev.idleNode.y = 0; },
      }));
    },
    breath(ev, spec) {
      const a = spec.amount ?? spec.amplitude ?? 0.015;
      ev.idleNode.scale.set(1);
      return tweenHandle(gsap.to(ev.idleNode.scale, {
        x: 1 + a, y: 1 + a, duration: (spec.period || 4) / 2, yoyo: true, repeat: -1, ease: "sine.inOut",
        onInterrupt: () => { ev.idleNode.scale.set(1); },
      }));
    },
    pulse(ev, spec) {
      return tweenHandle(gsap.to(ev.idleNode, {
        alpha: 1 - (spec.amount ?? 0.18), duration: (spec.period || 3) / 2,
        yoyo: true, repeat: -1, ease: "sine.inOut",
        onInterrupt: () => { ev.idleNode.alpha = 1; },
      }));
    },
    sway(ev, spec) {
      const a = S.deg2rad(spec.degrees ?? 1.2);
      return tweenHandle(gsap.fromTo(ev.idleNode, { rotation: -a }, {
        rotation: a, duration: (spec.period || 6) / 2, yoyo: true, repeat: -1, ease: "sine.inOut",
        onInterrupt: () => { ev.idleNode.rotation = 0; },
      }));
    },
    shimmer(ev, spec) {
      const view = ev.view;
      const proxy = { t: 0 };
      const tween = gsap.to(proxy, {
        t: 1, duration: spec.period || 4, yoyo: true, repeat: -1, ease: "sine.inOut",
        onUpdate: () => {
          const c = Math.round(255 * (1 - (spec.amount ?? 0.15) * proxy.t));
          view.tint = (c << 16) | (c << 8) | c;
        },
      });
      return { stop() { tween.kill(); view.tint = 0xffffff; } };
    },
    kenBurns(ev, spec) {
      const node = ev.idleNode;
      node.scale.set(1);
      return tweenHandle(gsap.to(node.scale, {
        x: spec.scale || 1.05, y: spec.scale || 1.05,
        duration: (spec.duration || 14) / (spec.yoyo === false ? 1 : 2),
        yoyo: spec.yoyo !== false, repeat: -1, ease: "sine.inOut",
        onInterrupt: () => node.scale.set(1),
      }));
    },
    autoRotate(ev, spec) {                 // continuous 3D spin (deg/sec)
      if (!ev.model3d) return { stop() {} };
      const dps = spec.degrees ?? spec.amount ?? 30;
      ev.model3d.setAutoRotate(dps);
      return { stop() { ev.model3d.setAutoRotate(0); } };
    },

    // ---- 2D effect pack (mesh displacement; export-capable via render_clips) ----
    wave(ev, spec) { return meshDisplace(ev, spec, waveDisp); },
    ripple(ev, spec) { return meshDisplace(ev, spec, rippleDisp); },   // underwater
    swirl(ev, spec) { return meshDisplace(ev, spec, swirlDisp); },

    glow(ev, spec) {                       // pulsing additive bloom halo (core BlurFilter)
      const view = ev.view;
      if (!view) return { stop() {} };
      const halo = new PIXI.Sprite(view.texture);
      halo.width = view.width; halo.height = view.height;
      halo.position.set(view.position.x, view.position.y);
      halo.blendMode = "add";
      halo.filters = [new PIXI.BlurFilter({ strength: (spec.amount ?? 0.4) * 30 + 6 })];
      if (spec.color) halo.tint = parseInt(String(spec.color).replace("#", ""), 16) || 0xffffff;
      ev.idleNode.addChildAt(halo, 0);     // behind the element
      const tw = gsap.fromTo(halo, { alpha: 0.12 },
        { alpha: spec.amount ?? 0.6, duration: (spec.period || 2) / 2, yoyo: true, repeat: -1, ease: "sine.inOut" });
      return { stop() { tw.kill(); if (halo.parent) halo.parent.removeChild(halo); halo.destroy(); } };
    },

    meshWave(ev, spec) {
      if (!(ev.view instanceof PIXI.MeshPlane) || ev.rig) return { stop() {} };
      const attr = ev.view.geometry.getAttribute("aPosition");
      const buf = attr.buffer;
      const rest = Float32Array.from(buf.data);
      const ampPx = (spec.amplitude ?? 0.01) * ev.box.h * (ev.view.texture.height / ev.box.h);
      const speed = spec.speed ?? 0.8;
      const axis = spec.axis === "x" ? 0 : 1;
      let t = 0;
      const cb = (ticker) => {
        t += ticker.deltaMS / 1000;
        for (let i = 0; i < buf.data.length; i += 2) {
          const phase = rest[i] * 0.02 + rest[i + 1] * 0.01;
          buf.data[i + axis] = rest[i + axis] + Math.sin(t * speed * Math.PI * 2 * 0.2 + phase) * ampPx;
          buf.data[i + 1 - axis] = rest[i + 1 - axis];
        }
        buf.update();
      };
      S.app.ticker.add(cb);
      return {
        stop() {
          S.app.ticker.remove(cb);
          buf.data.set(rest);
          buf.update();
        },
      };
    },
  };

  S.Effects = { entrance, idle };
})();
