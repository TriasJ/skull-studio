// One-time: download pinned UMD builds into runtime/vendor/. Builds never touch the network.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "runtime", "vendor");
mkdirSync(VENDOR, { recursive: true });

const THREE_VER = "0.169.0";  // three.js is ESM-only; loaded via import map (see build.mjs)
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
  // --- three.js trio (optional; only inlined into decks that contain 3D) -----
  // ESM modules. They use bare import specifiers ("three", and -- after the
  // patch below -- "three/addons/BufferGeometryUtils.js") so the build can wire
  // them up with an import map whether inlined (data: URLs) or vendored as files.
  {
    name: "three.module.min.js",
    url: `${THREE_CDN}/build/three.module.min.js`,
    probe: "WebGLRenderer",
    minBytes: 400_000,
  },
  {
    name: "three.BufferGeometryUtils.js",
    url: `${THREE_CDN}/examples/jsm/utils/BufferGeometryUtils.js`,
    probe: "toTrianglesDrawMode",
    minBytes: 10_000,
  },
  {
    name: "three.GLTFLoader.js",
    url: `${THREE_CDN}/examples/jsm/loaders/GLTFLoader.js`,
    probe: "class GLTFLoader",
    minBytes: 50_000,
    // rewrite the one relative import so the module resolves via the import map
    transform: (t) => t.replace("'../utils/BufferGeometryUtils.js'",
                                "'three/addons/BufferGeometryUtils.js'"),
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
