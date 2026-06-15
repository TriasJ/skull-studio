// Generate tiny original sample 3D models (glTF 2.0 binary) with no dependencies.
// Used by the docs/sample deck and as fixtures for the PPTX 3D round-trip test.
//   node skull_studio/make_sample_glb.mjs [outDir]
// Writes sphere.glb, cone.glb, torus.glb. These are our own trivial primitives —
// nothing is copied from PowerPoint's bundled models.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- geometry builders (positions + per-vertex normals + triangle indices) ----
function sphere(r = 1, wseg = 32, hseg = 24) {
  const pos = [], nor = [], idx = [];
  for (let y = 0; y <= hseg; y++) {
    const v = y / hseg, phi = v * Math.PI;
    for (let x = 0; x <= wseg; x++) {
      const u = x / wseg, theta = u * Math.PI * 2;
      const nx = -Math.cos(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.sin(theta) * Math.sin(phi);
      pos.push(r * nx, r * ny, r * nz);
      nor.push(nx, ny, nz);
    }
  }
  const row = wseg + 1;
  for (let y = 0; y < hseg; y++)
    for (let x = 0; x < wseg; x++) {
      const a = y * row + x, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { pos, nor, idx };
}

function cone(r = 1, h = 2, seg = 40) {
  const pos = [], nor = [], idx = [];
  const half = h / 2, slope = r / Math.hypot(r, h);
  // side: apex duplicated per segment for clean normals
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2, cx = Math.cos(t), cz = Math.sin(t);
    const ny = slope, k = Math.sqrt(1 - slope * slope);
    pos.push(0, half, 0); nor.push(cx * k, ny, cz * k);            // apex
    pos.push(r * cx, -half, r * cz); nor.push(cx * k, ny, cz * k); // rim
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 3); }
  // base cap
  const base = pos.length / 3;
  pos.push(0, -half, 0); nor.push(0, -1, 0);
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pos.push(r * Math.cos(t), -half, r * Math.sin(t)); nor.push(0, -1, 0);
  }
  for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i + 1, base + 1 + i);
  return { pos, nor, idx };
}

function torus(R = 1, r = 0.4, tseg = 48, pseg = 24) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= tseg; i++) {
    const u = (i / tseg) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= pseg; j++) {
      const v = (j / pseg) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
      nor.push(cv * cu, sv, cv * su);
    }
  }
  const row = pseg + 1;
  for (let i = 0; i < tseg; i++)
    for (let j = 0; j < pseg; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { pos, nor, idx };
}

// ---- minimal GLB writer -------------------------------------------------------
function pad4(n) { return (4 - (n % 4)) % 4; }

// three.js-compatible quaternion from XYZ-order Euler angles
function quat(x, y, z) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
          cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

// Bake a looping 3-axis rotation as glTF rotation keyframes (node 0). Integer
// turns per axis -> the clip ends where it started, so it loops seamlessly.
function rotationClip({ dur = 5, turns = [1, 2, 1], samples = 48 }) {
  const TAU = Math.PI * 2;
  const times = new Float32Array(samples + 1);
  const quats = new Float32Array((samples + 1) * 4);
  let prev = null;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    times[i] = +(t * dur).toFixed(6);
    let q = quat(t * turns[0] * TAU, t * turns[1] * TAU, t * turns[2] * TAU);
    if (prev && (prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3]) < 0) {
      q = q.map((v) => -v);                 // keep slerp on the short arc (no flips)
    }
    quats.set(q, i * 4);
    prev = q;
  }
  return { times, quats, dur };
}

function buildGLB({ pos, nor, idx }, color, anim) {
  const positions = new Float32Array(pos);
  const normals = new Float32Array(nor);
  const indices = new Uint16Array(idx);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  // center + normalize to a unit bounding radius, so one camera/scale frames every
  // shape identically in PowerPoint (and rotation is about the model's centre)
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let radius = 1e-6;
  for (let i = 0; i < positions.length; i += 3)
    radius = Math.max(radius, Math.hypot(positions[i] - c[0], positions[i + 1] - c[1], positions[i + 2] - c[2]));
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - c[0]) / radius;
    positions[i + 1] = (positions[i + 1] - c[1]) / radius;
    positions[i + 2] = (positions[i + 2] - c[2]) / radius;
  }
  min.fill(Infinity); max.fill(-Infinity);
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }

  // pack buffer: positions | normals | indices [ | anim times | anim quats ]
  const clip = anim ? rotationClip(anim) : null;
  const blocks = [[Buffer.from(positions.buffer), 34962], [Buffer.from(normals.buffer), 34962],
                  [Buffer.from(indices.buffer), 34963]];
  if (clip) {
    blocks.push([Buffer.from(clip.times.buffer), 0], [Buffer.from(clip.quats.buffer), 0]);
  }
  const parts = [], views = [];
  let off = 0;
  for (const [buf, target] of blocks) {
    views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
    parts.push(buf);
    const p = pad4(buf.length);
    if (p) { parts.push(Buffer.alloc(p)); off += p; }
    off += buf.length;
  }
  const bin = Buffer.concat(parts);

  const gltf = {
    asset: { version: "2.0", generator: "skull-studio make_sample_glb" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    // node 0 is an untouched root group; the mesh lives in child node 1 and the
    // animation targets THAT. PowerPoint drives the root transform itself and
    // ignores animation on the root node, so animating a child is what makes the
    // clip play in PowerPoint (three.js plays either way).
    // names matter: three.js binds animation tracks to nodes BY NAME (PowerPoint
    // uses the node index, so names don't affect it) — unnamed nodes won't animate.
    nodes: [{ name: "root", children: [1] }, { name: "spin", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0.25, roughnessFactor: 0.45 },
      doubleSided: true,
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  if (clip) {
    gltf.accessors.push(
      { bufferView: 3, componentType: 5126, count: clip.times.length, type: "SCALAR",
        min: [0], max: [clip.dur] },                                   // sampler input needs min/max
      { bufferView: 4, componentType: 5126, count: clip.times.length, type: "VEC4" });
    gltf.animations = [{
      name: "tumble",
      samplers: [{ input: 3, output: 4, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
    }];
  }

  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  if (pad4(json.length)) json = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]); // space-pad
  const total = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jHead = Buffer.alloc(8);
  jHead.writeUInt32LE(json.length, 0); jHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const bHead = Buffer.alloc(8);
  bHead.writeUInt32LE(bin.length, 0); bHead.writeUInt32LE(0x004e4942, 4);  // "BIN\0"
  return Buffer.concat([header, jHead, json, bHead, bin]);
}

const outDir = process.argv[2] ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "sample", "models");
mkdirSync(outDir, { recursive: true });
// each shape tumbles on all three axes (different per-axis turn counts), looping
const shapes = [
  ["sphere.glb", sphere(1), [0.30, 0.62, 0.90], { dur: 5, turns: [1, 2, 1] }],
  ["cone.glb", cone(1, 2), [0.93, 0.64, 0.20], { dur: 6, turns: [2, 1, 1] }],
  ["torus.glb", torus(1, 0.4), [0.79, 0.64, 0.15], { dur: 7, turns: [1, 1, 2] }],
];
for (const [name, geo, color, anim] of shapes) {
  const glb = buildGLB(geo, color, anim);
  writeFileSync(join(outDir, name), glb);
  console.log(`${name}  ${(glb.length / 1024).toFixed(1)} KB  (${geo.pos.length / 3} verts, anim ${anim.dur}s)`);
}
