// One-time: download pinned UMD builds into runtime/vendor/. Builds never touch the network.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "runtime", "vendor");
mkdirSync(VENDOR, { recursive: true });

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
];

for (const lib of LIBS) {
  const res = await fetch(lib.url);
  if (!res.ok) throw new Error(`${lib.url} -> HTTP ${res.status}`);
  const text = await res.text();
  if (text.length < lib.minBytes) throw new Error(`${lib.name}: suspiciously small (${text.length}B)`);
  if (!text.includes(lib.probe)) throw new Error(`${lib.name}: probe "${lib.probe}" not found`);
  writeFileSync(join(VENDOR, lib.name), text);
  console.log(`${lib.name}  ${(text.length / 1024).toFixed(0)} KB  <- ${lib.url}`);
}
