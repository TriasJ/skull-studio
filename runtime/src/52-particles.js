/* Rudimentary particle emitter — an `idle` effect for raster elements.

   Spawns lightweight sprites (a shared soft-dot texture) within the element box,
   advanced by the Pixi ticker. Lives under the element's idleNode so it inherits
   the element's transforms/parallax. HTML-only: it does NOT bake to PPTX/video
   (render_clips.py leaves such elements static — by design).

   Sizes/speeds are fractions of the element's box height (resolution-independent). */
(function () {
  "use strict";
  const S = window.SKULL;
  if (!S) return;

  let _tex = null;
  function dotTexture() {
    if (_tex) return _tex;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.65)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    _tex = PIXI.Texture.from(c);
    return _tex;
  }

  // region: where particles spawn ("top" edge, "bottom" edge, or "area")
  const PRESETS = {
    sparkle: { rate: 24, life: [0.6, 1.4], size: [0.02, 0.06], speed: [0.0, 0.05], dir: "any",  gravity: 0,     blend: "add",    color: 0xfff2b0, twinkle: true, region: "area" },
    snow:    { rate: 18, life: [3, 6],     size: [0.015, 0.04], speed: [0.03, 0.08], dir: "down", gravity: 0.02, blend: "normal", color: 0xffffff,                sway: 0.05, region: "top" },
    embers:  { rate: 20, life: [1, 2.5],   size: [0.015, 0.05], speed: [0.06, 0.14], dir: "up",   gravity: -0.03, blend: "add",   color: 0xff7a2a, twinkle: true, region: "bottom" },
    floatUp: { rate: 14, life: [2, 4],     size: [0.02, 0.06],  speed: [0.04, 0.09], dir: "up",   gravity: -0.01, blend: "add",   color: 0xbfe0ff,              region: "bottom" },
    bubbles: { rate: 12, life: [2.5, 5],   size: [0.02, 0.07],  speed: [0.03, 0.08], dir: "up",   gravity: -0.01, blend: "screen", color: 0xaad8ff, sway: 0.06, region: "bottom" },
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const parseColor = (c) => (typeof c === "number" ? c : (parseInt(String(c).replace("#", ""), 16) || 0xffffff));

  function make(ev, spec) {
    const p = PRESETS[spec.preset] || PRESETS.sparkle;
    const rate = spec.rate ?? p.rate;
    const sizeMul = spec.size ?? 1;
    const color = spec.color != null ? parseColor(spec.color) : p.color;
    const box = ev.box;
    const tex = dotTexture();
    const cont = new PIXI.Container();
    ev.idleNode.addChild(cont);
    const parts = [];
    let acc = 0;

    function spawn() {
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.blendMode = p.blend;
      sp.tint = color;
      sp.width = sp.height = rnd(p.size[0], p.size[1]) * box.h * sizeMul * 2;
      sp.x = rnd(-box.w / 2, box.w / 2);
      sp.y = p.region === "top" ? -box.h / 2 : p.region === "bottom" ? box.h / 2 : rnd(-box.h / 2, box.h / 2);
      const speed = rnd(p.speed[0], p.speed[1]) * box.h;
      let vx = rnd(-0.02, 0.02) * box.h, vy = 0;
      if (p.dir === "down") vy = speed;
      else if (p.dir === "up") vy = -speed;
      else { const a = Math.random() * Math.PI * 2; vx += Math.cos(a) * speed; vy = Math.sin(a) * speed; }
      const life = rnd(p.life[0], p.life[1]);
      cont.addChild(sp);
      parts.push({ sp, vx, vy, life, maxLife: life, phase: Math.random() * 6.28 });
    }

    const grav = (p.gravity || 0) * box.h;
    const sway = (p.sway || 0) * box.h;
    const cb = (ticker) => {
      const dt = ticker.deltaMS / 1000;
      acc += rate * dt;
      while (acc >= 1) { spawn(); acc -= 1; }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.life -= dt;
        if (q.life <= 0) { cont.removeChild(q.sp); q.sp.destroy(); parts.splice(i, 1); continue; }
        q.vy += grav * dt;
        q.phase += dt * 2;
        q.sp.x += q.vx * dt + (sway ? Math.cos(q.phase) * sway * dt : 0);
        q.sp.y += q.vy * dt;
        const k = q.life / q.maxLife;
        let a = k < 0.2 ? k / 0.2 : (k > 0.85 ? (1 - k) / 0.15 : 1);   // fade in / out
        if (p.twinkle) a *= 0.5 + 0.5 * Math.sin(q.phase * 3);
        q.sp.alpha = Math.max(0, Math.min(1, a));
      }
    };
    S.app.ticker.add(cb);
    return {
      stop() {
        S.app.ticker.remove(cb);
        cont.destroy({ children: true });
        parts.length = 0;
      },
    };
  }

  S.Particles = { make, presets: Object.keys(PRESETS) };
})();
