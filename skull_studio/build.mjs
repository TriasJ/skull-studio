// Assemble dist/presentation.html: vendor libs + manifest + base64 assets + runtime.
// Usage: node scripts/build.mjs [--apply overrides.json] [--manifest work/manifest.json] [--out dist/presentation.html]
import { readFileSync, readdirSync, writeFileSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
// resolve a path arg against ROOT, but honour absolute paths (custom save-to)
const rel = (p) => (isAbsolute(p) ? p : join(ROOT, p));
const EDITOR_BUILD = args.includes("--editor");
// viewer-only by default: the editor (JS modules 60-65 + DOM + CSS) is
// stripped from presentation builds unless --embed-editor is passed
const INCLUDE_EDITOR = EDITOR_BUILD || args.includes("--embed-editor");
const MANIFEST_PATH = rel(opt("--manifest", "work/manifest.json"));
const OUT_PATH = rel(opt("--out", EDITOR_BUILD ? "dist/editor.html" : "dist/presentation.html"));
const APPLY = opt("--apply", null);
const WORK = dirname(MANIFEST_PATH);
// three.js delivery for decks containing 3D models: "inline" embeds the engine
// into the single HTML (portable, ~0.7 MB heavier); "vendor" writes it beside
// the HTML. GLBs are sidecar files by default (they can be huge); --embed-models
// base64s them into the page for a true single file.
const THREEJS_MODE = opt("--threejs", "inline") === "vendor" ? "vendor" : "inline";
const EMBED_MODELS = args.includes("--embed-models");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

// ---- apply editor overrides --------------------------------------------------
if (APPLY) {
  const ov = JSON.parse(readFileSync(join(ROOT, APPLY), "utf-8"));
  if (ov.docId !== manifest.meta.docId) {
    throw new Error(`overrides docId ${ov.docId} != manifest docId ${manifest.meta.docId}`);
  }
  const byId = new Map();
  for (const s of manifest.slides) for (const el of s.elements) byId.set(el.id, el);
  let applied = 0;
  for (const [id, patch] of Object.entries(ov.elements || {})) {
    const el = byId.get(id);
    if (!el) { console.warn(`override for unknown element ${id} - skipped`); continue; }
    for (const [k, v] of Object.entries(patch)) el[k] = v; // whole-key replacement
    applied++;
  }
  for (const [sid, patch] of Object.entries(ov.slides || {})) {
    const sl = manifest.slides.find((s) => s.id === sid);
    if (sl) for (const [k, v] of Object.entries(patch)) sl[k] = v;
  }
  console.log(`applied overrides to ${applied} element(s) from ${APPLY}`);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ---- collect referenced assets ----------------------------------------------
const assetPaths = new Set();
const modelSrcs = new Set();
for (const s of manifest.slides) {
  if (s.background?.src) assetPaths.add(s.background.src);
  for (const el of s.elements) {
    if (el.crop) assetPaths.add(el.crop);
    if (el.patch) assetPaths.add(el.patch);
    if (el.type === "model3d" && el.modelSrc) modelSrcs.add(el.modelSrc);
  }
}
const hasModels = modelSrcs.size > 0;

const MIME = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const sizes = { vendor: 0, three: 0, backgrounds: 0, crops: 0, patches: 0, models: 0, runtime: 0, manifest: 0 };
let assetsJs = "window.ASSETS = {\n";
for (const rel of [...assetPaths].sort()) {
  const file = join(WORK, rel);
  const buf = readFileSync(file);
  const ext = rel.split(".").pop().toLowerCase();
  const b64 = buf.toString("base64");
  assetsJs += `${JSON.stringify(rel)}: "data:${MIME[ext] || "application/octet-stream"};base64,${b64}",\n`;
  const cat = rel.startsWith("slides") ? "backgrounds" : rel.startsWith("patches") ? "patches" : "crops";
  sizes[cat] += buf.length;
}
if (hasModels && EMBED_MODELS) {              // base64 the GLBs into the page too
  for (const src of [...modelSrcs].sort()) {
    const buf = readFileSync(join(WORK, src));
    assetsJs += `${JSON.stringify(src)}: "data:model/gltf-binary;base64,${buf.toString("base64")}",\n`;
    sizes.models += buf.length;
  }
}
assetsJs += "};";

// ---- vendor + runtime ---------------------------------------------------------
const vendorDir = join(ROOT, "runtime", "vendor");
let vendorHtml = "";
for (const f of ["pixi.min.js", "gsap.min.js"]) {
  const src = readFileSync(join(vendorDir, f), "utf-8");
  sizes.vendor += src.length;
  vendorHtml += `<script>/* ${f} */\n${src.replace(/<\/script/gi, "<\\/script")}\n</script>\n`;
}

const srcDir = join(ROOT, "runtime", "src");
// 64 (persist) stays in viewer builds so localStorage edits still apply;
// 60-63 + 65 are pure editor UI
const EDITOR_ONLY = /^(60|61|62|63|65|66)-/;
const srcFiles = readdirSync(srcDir)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => INCLUDE_EDITOR || !EDITOR_ONLY.test(f))
  .sort();
let runtimeJs = "";
for (const f of srcFiles) {
  runtimeJs += `\n/* ===== ${f} ===== */\n` + readFileSync(join(srcDir, f), "utf-8");
}
runtimeJs = runtimeJs.replace(/<\/script/gi, "<\\/script");
sizes.runtime = runtimeJs.length;

const manifestJson = JSON.stringify(manifest).replace(/<\//g, "<\\/");
sizes.manifest = manifestJson.length;

// ---- three.js (only for decks with 3D models) --------------------------------
// Classic global scripts (three.min.js + classic GLTFLoader), so 3D works even
// from file://. "inline" embeds the source in <script> tags (one portable file);
// "vendor" writes them beside the HTML and references them with <script src>.
const OUT_DIR = dirname(OUT_PATH);
let threeHtml = "";
if (hasModels) {
  const vroot = join(ROOT, "runtime", "vendor");
  const files = ["three.min.js", "three.GLTFLoader.js"];   // order matters: core first
  sizes.three = files.reduce((n, f) => n + statSync(join(vroot, f)).size, 0);
  if (THREEJS_MODE === "inline") {
    for (const f of files) {
      const src = readFileSync(join(vroot, f), "utf-8").replace(/<\/script/gi, "<\\/script");
      threeHtml += `<script>/* ${f} */\n${src}\n</script>\n`;
    }
  } else {
    const vout = join(OUT_DIR, "vendor");
    mkdirSync(vout, { recursive: true });
    for (const f of files) {
      copyFileSync(join(vroot, f), join(vout, f));
      threeHtml += `<script src="vendor/${f}"></script>\n`;
    }
  }
}

// GLBs ride beside the HTML unless embedded; the runtime fetches "models/*.glb"
if (hasModels && !EMBED_MODELS) {
  mkdirSync(join(OUT_DIR, "models"), { recursive: true });
  for (const src of modelSrcs) copyFileSync(join(WORK, src), join(OUT_DIR, src));
}

// ---- assemble ------------------------------------------------------------------
let html = readFileSync(join(ROOT, "runtime", "template.html"), "utf-8");
if (!INCLUDE_EDITOR) {
  html = html.replace(/<!-- EDITOR:(\w+):START -->[\s\S]*?<!-- EDITOR:\1:END -->/g,
    "<!-- editor stripped (viewer-only build) -->");
}
const title = (manifest.meta?.title || "Presentation").replace(/[<>&]/g, "");
html = html
  .replace("{{TITLE}}", EDITOR_BUILD ? title + " [editor]" : title)
  .replace("{{VENDOR}}", (EDITOR_BUILD ? "<script>window.EDITOR_AUTOOPEN=true</script>\n" : "") + vendorHtml)
  .replace("{{THREE}}", () => threeHtml)
  .replace("{{MANIFEST}}", () => manifestJson)
  .replace("{{ASSETS}}", () => assetsJs)
  .replace("{{RUNTIME}}", () => runtimeJs);

writeFileSync(OUT_PATH, html);

const fmt = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
console.log("--- size report ---");
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(12)} ${fmt(v)}`);
console.log(`  TOTAL (html)  ${fmt(statSync(OUT_PATH).size)}  -> ${OUT_PATH}`);
console.log(`  slides: ${manifest.slides.length}, elements: ${[...assetPaths].length} assets, runtime files: ${srcFiles.length}`);
