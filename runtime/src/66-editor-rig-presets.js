/* RigPresets: one-click rig templates that build pins + keyframes for common
   motions. Editor-only (stripped from viewer builds). All coords normalized to
   the crop (0..1); tracks hold absolute poses; GSAP eases between them.        */
(function () {
  "use strict";
  const S = window.SKULL;

  // sample a sine into n+1 keyframes on one axis around a bone's rest pose
  function sineTrack(bone, axis, amp, dur, phase, n) {
    n = n || 8;
    const keys = [];
    for (let k = 0; k <= n; k++) {
      const t = +(dur * k / n).toFixed(3);
      const key = { t, x: bone.x, y: bone.y, angle: bone.angle || 0 };
      key[axis] = +(bone[axis] + Math.sin(phase + (2 * Math.PI * k) / n) * amp).toFixed(4);
      keys.push(key);
    }
    return keys;
  }

  const anchor = (id, x, y) => ({ id, parent: null, x, y, angle: 0, length: 0 });

  const PRESETS = [
    {
      id: "breathe", label: "Breathe",
      hint: "chest rises and falls; base stays planted",
      build(dur) {
        dur = dur || 4;
        const chest = anchor("chest", 0.5, 0.42);
        return {
          duration: dur,
          bones: [anchor("base_l", 0.06, 0.97), anchor("base_r", 0.94, 0.97), chest],
          tracks: { chest: sineTrack(chest, "y", -0.025, dur, 0, 8) },
        };
      },
    },
    {
      id: "sway", label: "Sway",
      hint: "top sways side to side, like in a breeze",
      build(dur) {
        dur = dur || 5;
        const top = anchor("top", 0.5, 0.1);
        return {
          duration: dur,
          bones: [anchor("base_l", 0.06, 0.97), anchor("base_r", 0.94, 0.97), top],
          tracks: { top: sineTrack(top, "x", 0.05, dur, 0, 8) },
        };
      },
    },
    {
      id: "float", label: "Float",
      hint: "the whole image bobs gently up and down",
      build(dur) {
        dur = dur || 4;
        const c = anchor("center", 0.5, 0.5);
        return { duration: dur, bones: [c], tracks: { center: sineTrack(c, "y", -0.03, dur, 0, 8) } };
      },
    },
    {
      id: "pendulum", label: "Pendulum",
      hint: "hangs from the top and swings",
      build(dur) {
        dur = dur || 3;
        const body = anchor("body", 0.5, 0.9);
        return {
          duration: dur,
          bones: [anchor("pivot", 0.5, 0.06), body],
          tracks: { body: sineTrack(body, "x", 0.09, dur, 0, 8) },
        };
      },
    },
    {
      id: "wave", label: "Wave / flag",
      hint: "ripples from a fixed left edge - flags, fabric, water",
      build(dur) {
        dur = dur || 2.6;
        const cols = [{ id: "w1", x: 0.4 }, { id: "w2", x: 0.68 }, { id: "w3", x: 0.96 }];
        const bones = [anchor("edge_t", 0.04, 0.12), anchor("edge_b", 0.04, 0.88)];
        const tracks = {};
        cols.forEach((c, i) => {
          const b = anchor(c.id, c.x, 0.5);
          bones.push(b);
          tracks[c.id] = sineTrack(b, "y", 0.02 + i * 0.012, dur, i * 0.9, 8);
        });
        return { duration: dur, bones, tracks };
      },
    },
  ];

  S.RigPresets = {
    list: PRESETS,
    /* overwrite the rig's bones + animation with a preset; keep mesh + weights */
    apply(spec, presetId, dur) {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return false;
      const r = preset.build(dur);
      spec.bones = r.bones;
      spec.anim = { duration: r.duration, loop: true, ease: "sine.inOut", tracks: r.tracks };
      // a denser grid reproduces smooth bends
      spec.mesh = spec.mesh || {};
      if ((spec.mesh.verticesX || 0) < 10) { spec.mesh.verticesX = 12; spec.mesh.verticesY = 12; }
      return true;
    },
  };
})();
