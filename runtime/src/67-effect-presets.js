/* EffectPresets: one-click "looks" — a tuned entrance + idle combo applied to an
   element. Editor-only convenience (the resulting entrance/idle are plain specs
   that play everywhere). Mirrors the RigPresets pattern. */
(function () {
  "use strict";
  const S = window.SKULL;

  const PRESETS = [
    { id: "float", label: "Gentle float", hint: "fades up and bobs softly",
      entrance: { type: "fadeUp", delay: 0.2, duration: 0.9, ease: "power3.out" },
      idle: [{ type: "float", amplitude: 0.008, period: 5 }] },
    { id: "glow", label: "Neon glow", hint: "fades in with a pulsing bloom",
      entrance: { type: "fadeIn", delay: 0.2, duration: 0.8, ease: "power2.out" },
      idle: [{ type: "glow", amount: 0.6, period: 2, color: "#66ccff" }] },
    { id: "underwater", label: "Underwater", hint: "rippling caustic shimmer",
      entrance: { type: "fadeIn", delay: 0.2, duration: 1.0, ease: "power2.out" },
      idle: [{ type: "ripple", amplitude: 0.015, speed: 0.5, waves: 3 }] },
    { id: "drift", label: "Drift in", hint: "slides in and sways in a breeze",
      entrance: { type: "fadeLeft", delay: 0.2, duration: 0.9, ease: "power3.out", distance: 0.06 },
      idle: [{ type: "sway", degrees: 1.2, period: 6 }] },
    { id: "sparkle", label: "Sparkle", hint: "pops in with twinkling particles",
      entrance: { type: "scaleIn", delay: 0.15, duration: 0.8, ease: "back.out(1.4)" },
      idle: [{ type: "particles", preset: "sparkle", rate: 24 }] },
    { id: "heartbeat", label: "Heartbeat", hint: "scales in and pulses",
      entrance: { type: "scaleIn", delay: 0.15, duration: 0.7, ease: "back.out(1.4)" },
      idle: [{ type: "pulse", amount: 0.12, period: 1.2 }] },
  ];

  const MESH = ["wave", "ripple", "swirl", "meshWave"];

  S.EffectPresets = {
    list: PRESETS,
    /* set the element's entrance + idle from a preset. Returns true if the new
       idle needs a MeshPlane view (so the caller can rebuild). */
    apply(spec, presetId) {
      const p = PRESETS.find((x) => x.id === presetId);
      if (!p) return false;
      spec.entrance = JSON.parse(JSON.stringify(p.entrance));
      spec.idle = JSON.parse(JSON.stringify(p.idle));
      return spec.idle.some((i) => MESH.includes(i.type));
    },
  };
})();
