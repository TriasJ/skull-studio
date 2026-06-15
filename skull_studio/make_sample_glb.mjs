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

function buildGLB({ pos, nor, idx }, color) {
  const positions = new Float32Array(pos);
  const normals = new Float32Array(nor);
  const indices = new Uint16Array(idx);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }

  // pack buffer: positions | normals | indices (each 4-byte aligned)
  const pB = Buffer.from(positions.buffer);
  const nB = Buffer.from(normals.buffer);
  const iB = Buffer.from(indices.buffer);
  const parts = [], views = [];
  let off = 0;
  for (const [buf, target] of [[pB, 34962], [nB, 34962], [iB, 34963]]) {
    views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target });
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
    nodes: [{ mesh: 0 }],
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
const shapes = [
  ["sphere.glb", sphere(1), [0.30, 0.62, 0.90]],
  ["cone.glb", cone(1, 2), [0.93, 0.64, 0.20]],
  ["torus.glb", torus(1, 0.4), [0.79, 0.64, 0.15]],
];
for (const [name, geo, color] of shapes) {
  const glb = buildGLB(geo, color);
  writeFileSync(join(outDir, name), glb);
  console.log(`${name}  ${(glb.length / 1024).toFixed(1)} KB  (${geo.pos.length / 3} verts)`);
}
