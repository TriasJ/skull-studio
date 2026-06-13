/* Rig: pin/bone skinning on a PIXI.MeshPlane (puppet-warp style).

   Schema (element.rig), all coords normalized to the crop, angles in degrees:
   { mesh: {verticesX, verticesY},
     bones: [{id, parent|null, x, y, angle, length}],     // rest pose (absolute coords)
     weights: {mode:"auto", falloff: 2.0, maxInfluences: 2},
     anim: {duration, loop, ease, tracks: {boneId: [{t, x, y, angle}, ...]}} }

   Pins are length-0 bones. Tracks hold ABSOLUTE poses. A child bone without its
   own track follows its parent; with a track its absolute pose wins (v1 editor
   only creates flat pins anyway - parenting is schema-ready, not UI-exposed).

   CPU skinning: vertices live in texture pixel space; display scale happens at
   the view level, so we never have to care about on-screen size here.          */
(function () {
  "use strict";
  const S = window.SKULL;

  // 2D rigid transform {c, s, tx, ty}  (rotation + translation)
  const M = {
    make(x, y, deg) {
      const r = S.deg2rad(deg || 0);
      return { c: Math.cos(r), s: Math.sin(r), tx: x, ty: y };
    },
    mul(A, B) {
      return {
        c: A.c * B.c - A.s * B.s,
        s: A.s * B.c + A.c * B.s,
        tx: A.c * B.tx - A.s * B.ty + A.tx,
        ty: A.s * B.tx + A.c * B.ty + A.ty,
      };
    },
    inv(A) {
      return {
        c: A.c, s: -A.s,
        tx: -(A.c * A.tx + A.s * A.ty),
        ty: -(-A.s * A.tx + A.c * A.ty),
      };
    },
    apply(A, x, y) {
      return [A.c * x - A.s * y + A.tx, A.s * x + A.c * y + A.ty];
    },
  };

  class Rig {
    constructor(meshPlane, spec, designW, designH) {
      this.mesh = meshPlane;
      this.spec = spec;
      this.texW = meshPlane.texture.width;
      this.texH = meshPlane.texture.height;
      this.attr = meshPlane.geometry.getAttribute("aPosition");
      this.buf = this.attr.buffer;
      this.rest = Float32Array.from(this.buf.data);
      this.dirty = false;
      this.tl = null;
      this.pose = {}; // boneId -> {x, y, angle} in normalized crop coords
      this._tick = this._tick.bind(this);
      S.app.ticker.add(this._tick);
    }

    bonePx(b) { return [b.x * this.texW, b.y * this.texH]; }

    bake() {
      const spec = this.spec;
      const bones = spec.bones || [];
      const nB = bones.length;
      const nV = this.rest.length / 2;
      const falloff = spec.weights?.falloff ?? 2.0;
      const maxInf = Math.min(spec.weights?.maxInfluences ?? 2, Math.max(nB, 1));

      this.bones = bones;
      this.boneIndex = new Map(bones.map((b, i) => [b.id, i]));
      this.restWorld = bones.map((b) => {
        const [px, py] = this.bonePx(b);
        return M.make(px, py, b.angle);
      });
      this.restWorldInv = this.restWorld.map(M.inv);

      // reset pose to rest
      this.pose = {};
      for (const b of bones) this.pose[b.id] = { x: b.x, y: b.y, angle: b.angle || 0 };

      // weights: inverse-distance^falloff to bone segment, top-k normalized
      this.vWeights = new Float32Array(nV * maxInf);
      this.vBone = new Int16Array(nV * maxInf);
      this.vLocal = new Float32Array(nV * maxInf * 2);
      this.maxInf = maxInf;

      if (nB === 0) return;
      const scores = new Float32Array(nB);
      for (let v = 0; v < nV; v++) {
        const vx = this.rest[2 * v], vy = this.rest[2 * v + 1];
        for (let b = 0; b < nB; b++) {
          const bone = bones[b];
          const [ax, ay] = this.bonePx(bone);
          let d;
          if ((bone.length || 0) > 0) {
            const r = S.deg2rad(bone.angle || 0);
            const bx = ax + Math.cos(r) * bone.length * this.texW;
            const by = ay + Math.sin(r) * bone.length * this.texW;
            d = S.distToSegment(vx, vy, ax, ay, bx, by);
          } else {
            d = Math.hypot(vx - ax, vy - ay);
          }
          scores[b] = 1 / (Math.pow(d, falloff) + 1e-3);
        }
        // top-k selection
        const order = [...scores.keys()].sort((a, b2) => scores[b2] - scores[a]).slice(0, maxInf);
        let sum = 0;
        for (const b of order) sum += scores[b];
        for (let k = 0; k < maxInf; k++) {
          const b = order[k] ?? order[0];
          const w = order[k] != null ? scores[b] / sum : 0;
          const idx = v * maxInf + k;
          this.vWeights[idx] = w;
          this.vBone[idx] = b;
          const [lx, ly] = M.apply(this.restWorldInv[b], vx, vy);
          this.vLocal[2 * idx] = lx;
          this.vLocal[2 * idx + 1] = ly;
        }
      }
      this.dirty = true;
    }

    buildTimeline() {
      if (this.tl) this.tl.kill();
      const anim = this.spec.anim;
      this.tl = gsap.timeline({ paused: true, repeat: anim?.loop === false ? 0 : -1 });
      if (!anim || !anim.tracks) return this.tl;
      const ease = S.ease(anim.ease, "sine.inOut");
      const markDirty = () => { this.dirty = true; };
      for (const [boneId, keys] of Object.entries(anim.tracks)) {
        if (!this.pose[boneId] || !keys.length) continue;
        const sorted = [...keys].sort((a, b) => a.t - b.t);
        const p = this.pose[boneId];
        this.tl.set(p, { x: sorted[0].x, y: sorted[0].y, angle: sorted[0].angle || 0, onComplete: markDirty }, sorted[0].t);
        for (let i = 1; i < sorted.length; i++) {
          const k = sorted[i], prev = sorted[i - 1];
          this.tl.to(p, {
            x: k.x, y: k.y, angle: k.angle || 0,
            duration: Math.max(k.t - prev.t, 0.001), ease,
            onUpdate: markDirty,
          }, prev.t);
        }
      }
      // pad to declared duration so loops keep their full period
      if (anim.duration) this.tl.set({}, {}, anim.duration);
      return this.tl;
    }

    /* current world matrix per bone: tracked bones use absolute pose;
       untracked children follow their parent's motion */
    _worldCurrent() {
      const out = new Array(this.bones.length);
      const tracked = new Set(Object.keys(this.spec.anim?.tracks || {}));
      for (let i = 0; i < this.bones.length; i++) {
        const b = this.bones[i];
        const p = this.pose[b.id];
        if (tracked.has(b.id) || b.parent == null) {
          out[i] = M.make(p.x * this.texW, p.y * this.texH, p.angle);
        } else {
          const pi = this.boneIndex.get(b.parent);
          if (pi == null || out[pi] == null) {
            out[i] = M.make(p.x * this.texW, p.y * this.texH, p.angle);
          } else {
            const delta = M.mul(out[pi], this.restWorldInv[pi]);
            out[i] = M.mul(delta, this.restWorld[i]);
          }
        }
      }
      return out;
    }

    applyPose() {
      if (!this.bones || !this.bones.length) return;
      const W = this._worldCurrent();
      const data = this.buf.data;
      const nV = this.rest.length / 2;
      const k = this.maxInf;
      for (let v = 0; v < nV; v++) {
        let px = 0, py = 0;
        for (let j = 0; j < k; j++) {
          const idx = v * k + j;
          const w = this.vWeights[idx];
          if (w === 0) continue;
          const m = W[this.vBone[idx]];
          const lx = this.vLocal[2 * idx], ly = this.vLocal[2 * idx + 1];
          px += w * (m.c * lx - m.s * ly + m.tx);
          py += w * (m.s * lx + m.c * ly + m.ty);
        }
        data[2 * v] = px;
        data[2 * v + 1] = py;
      }
      this.buf.update();
    }

    _tick() {
      if (this.dirty) {
        this.dirty = false;
        this.applyPose();
      }
    }

    /* editor support */
    setPoseDirect(boneId, x, y, angle) {
      const p = this.pose[boneId];
      if (!p) return;
      p.x = x; p.y = y;
      if (angle != null) p.angle = angle;
      this.dirty = true;
    }
    resetPose() {
      // mutate in place - the GSAP timeline holds references to these objects
      for (const b of this.bones) {
        const p = this.pose[b.id] || (this.pose[b.id] = {});
        p.x = b.x; p.y = b.y; p.angle = b.angle || 0;
      }
      this.dirty = true;
    }
    refresh() { // after spec mutation (bones added/moved/falloff changed)
      this.bake();
      this.buildTimeline();
      this.dirty = true;
    }

    destroy() {
      S.app.ticker.remove(this._tick);
      if (this.tl) this.tl.kill();
      this.buf.data.set(this.rest);
      this.buf.update();
    }
  }

  S.Rig = Rig;
})();
