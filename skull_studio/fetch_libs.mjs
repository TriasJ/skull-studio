// One-time: download pinned UMD builds into runtime/vendor/. Builds never touch the network.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "runtime", "vendor");
mkdirSync(VENDOR, { recursive: true });

// three.js r137 is the last release with a UMD global build + a classic
// (non-module) GLTFLoader. We pin it on purpose: a classic <script> global
// works when the exported HTML is opened straight from disk (file://), whereas
// modern three is ESM-only and browsers block ES-module loading over file://.
// GLB loading + AnimationMixer are rock-solid at r137.
const THREE_VER = "0.137.0";
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}`;

const LIBS = [
  {
    name: "pixi.min.js",
    url: "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.js",
    probe: "PIXI",
    minBytes: 200_000,
  },
  {
    name: "gsap.min.js",
    url: "https://cdn.jsdelivr.net/npm/gsap@3.12.7/dist/gsap.min.js",
    probe: "gsap",
    minBytes: 30_000,
  },
  // --- three.js (optional; only inlined into decks that contain 3D) ----------
  // Classic UMD/global scripts: three.min.js defines window.THREE, the classic
  // GLTFLoader attaches THREE.GLTFLoader. Both run as plain <script> (no modules
  // / import maps), so 3D works even from file://.
  {
    name: "three.min.js",
    url: `${THREE_CDN}/build/three.min.js`,
    probe: "WebGLRenderer",
    minBytes: 400_000,
  },
  {
    name: "three.GLTFLoader.js",
    url: `${THREE_CDN}/examples/js/loaders/GLTFLoader.js`,
    probe: "GLTFLoader",
    minBytes: 50_000,
  },
];

for (const lib of LIBS) {
  const res = await fetch(lib.url);
  if (!res.ok) throw new Error(`${lib.url} -> HTTP ${res.status}`);
  let text = await res.text();
  if (text.length < lib.minBytes) throw new Error(`${lib.name}: suspiciously small (${text.length}B)`);
  if (!text.includes(lib.probe)) throw new Error(`${lib.name}: probe "${lib.probe}" not found`);
  if (lib.transform) text = lib.transform(text);
  writeFileSync(join(VENDOR, lib.name), text);
  console.log(`${lib.name}  ${(text.length / 1024).toFixed(0)} KB  <- ${lib.url}`);
}
