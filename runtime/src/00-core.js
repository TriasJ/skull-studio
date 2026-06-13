/* SKULL core: namespace, constants, math helpers, ease whitelist. */
(function () {
  "use strict";
  const S = (window.SKULL = window.SKULL || {});

  S.EASES = new Set([
    "none", "power1.in", "power1.out", "power1.inOut",
    "power2.in", "power2.out", "power2.inOut",
    "power3.in", "power3.out", "power3.inOut",
    "power4.in", "power4.out", "power4.inOut",
    "sine.in", "sine.out", "sine.inOut",
    "expo.in", "expo.out", "expo.inOut",
    "back.out", "back.out(1.4)", "back.out(1.7)", "back.inOut",
    "elastic.out", "elastic.out(1,0.4)", "circ.out", "circ.inOut",
  ]);
  S.ease = (e, fallback) => (e && S.EASES.has(e) ? e : fallback || "power2.out");

  S.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.deg2rad = (d) => (d * Math.PI) / 180;

  // bbox helpers - all manifest bboxes are normalized [x0,y0,x1,y1], top-left, y-down
  S.bboxToDesign = function (bbox, deck) {
    const W = deck.designWidth, H = deck.designHeight;
    return {
      x: bbox[0] * W, y: bbox[1] * H,
      w: (bbox[2] - bbox[0]) * W, h: (bbox[3] - bbox[1]) * H,
      cx: ((bbox[0] + bbox[2]) / 2) * W, cy: ((bbox[1] + bbox[3]) / 2) * H,
    };
  };

  S.distToSegment = function (px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    if (L2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = S.clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  S.reducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  S.deepClone = (o) => JSON.parse(JSON.stringify(o));
})();
