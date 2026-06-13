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
