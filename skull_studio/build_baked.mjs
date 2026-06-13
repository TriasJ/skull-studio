// Baked HTML export: a no-WebGL DOM/CSS slideshow. Animated elements (those with
// a rendered clip in work/clips) become looping <video>/<img>; everything else is
// a static <img>. CSS handles entrance fades; JS handles slide navigation.
// Two asset modes: base64 (single portable file) or folder (assets beside the html).
//
// Usage: node scripts/build_baked.mjs --out dist/baked.html --format mp4|gif --assets base64|folder
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = join(ROOT, "work");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const rel = (p) => (isAbsolute(p) ? p : join(ROOT, p));

const OUT = rel(opt("--out", "dist/baked.html"));
const FORMAT = opt("--format", "mp4");
const ASSETS = opt("--assets", "base64"); // base64 | folder
const manifest = JSON.parse(readFileSync(rel(opt("--manifest", "work/manifest.json")), "utf-8"));
const clipIdxPath = join(WORK, "clips", "index.json");
const clips = existsSync(clipIdxPath)
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(clipIdxPath, "utf-8")))
      .filter(([, v]) => v.format === FORMAT))
  : {};

const MIME = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
               gif: "image/gif", mp4: "video/mp4" };
const outDir = dirname(OUT);
const assetDir = join(outDir, basename(OUT).replace(/\.html?$/, "") + "_assets");
if (ASSETS === "folder") { rmSync(assetDir, { recursive: true, force: true }); mkdirSync(assetDir, { recursive: true }); }

// resolve a work-relative asset to either a data URI (base64) or a copied file ref
const seen = new Map();
function asset(relPath) {
  if (seen.has(relPath)) return seen.get(relPath);
  const abs = join(WORK, relPath);
  const ext = relPath.split(".").pop().toLowerCase();
  let ref;
  if (!existsSync(abs)) { ref = ""; }
  else if (ASSETS === "base64") {
    ref = `data:${MIME[ext] || "application/octet-stream"};base64,${readFileSync(abs).toString("base64")}`;
  } else {
    const name = relPath.replace(/[\\/]/g, "_");
    copyFileSync(abs, join(assetDir, name));
    ref = basename(assetDir) + "/" + name;
  }
  seen.set(relPath, ref);
  return ref;
}

const deck = manifest.deck;
const pct = (v) => (v * 100).toFixed(3) + "%";

// entrance type -> CSS transform offset (matches the Pixi vocabulary loosely)
function entranceCss(ent, idx) {
  const t = (ent && ent.type) || "none";
  if (t === "none") return { anim: "", from: "" };
  const dur = (ent.duration || 0.8) + "s", delay = (ent.delay || 0) + "s";
  const dist = (ent.distance ?? 0.04) * 100;
  let tf = "none";
  if (t === "fadeUp") tf = `translateY(${dist}%)`;
  else if (t === "fadeDown") tf = `translateY(-${dist}%)`;
  else if (t === "fadeLeft") tf = `translateX(${dist}%)`;
  else if (t === "fadeRight") tf = `translateX(-${dist}%)`;
  else if (t === "scaleIn") tf = "scale(0.85)";
  const name = "ent" + idx;
  const kf = `@keyframes ${name}{from{opacity:0;transform:${tf}}to{opacity:1;transform:none}}`;
  return { kf, style: `opacity:0;animation:${name} ${dur} ${delay} both;` };
}

let keyframes = "";
let slidesHtml = "";
manifest.slides.forEach((slide, si) => {
  let els = "";
  const bg = asset(slide.background.src);
  els += `<img class="bg" src="${bg}">`;
  const ordered = [...slide.elements].filter((e) => !e.hidden).sort((a, b) => (a.z || 0) - (b.z || 0));
  ordered.forEach((el, ei) => {
    const clip = clips[el.id];
    const box = clip ? clip.bbox : (el.cropBbox || el.bbox);
    const style = `left:${pct(box[0])};top:${pct(box[1])};width:${pct(box[2] - box[0])};height:${pct(box[3] - box[1])};`;
    const ent = entranceCss(el.entrance, `${si}_${ei}`);
    if (ent.kf) keyframes += ent.kf;
    const blend = el.blendMode && el.blendMode !== "normal" ? `mix-blend-mode:${el.blendMode};` : "";
    const op = (el.opacity != null && el.opacity < 1) ? `opacity:${el.opacity};` : "";
    const css = style + blend + op + (ent.style || "");
    if (clip && clip.format === "mp4") {
      els += `<video class="el" style="${css}" src="${asset(clip.clip)}" autoplay loop muted playsinline></video>`;
    } else if (clip) {
      els += `<img class="el" style="${css}" src="${asset(clip.clip)}">`;
    } else {
      els += `<img class="el" style="${css}" src="${asset(el.crop)}">`;
    }
  });
  slidesHtml += `<section class="slide${si === 0 ? " active" : ""}" data-i="${si}">${els}</section>`;
});

const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${(manifest.meta?.title || "Presentation").replace(/[<>&]/g, "")}</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui}
  #stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
  #frame{position:relative;aspect-ratio:${deck.designWidth}/${deck.designHeight};max-width:100vw;max-height:100vh;width:min(100vw,calc(100vh*${deck.designWidth}/${deck.designHeight}))}
  .slide{position:absolute;inset:0;display:none}
  .slide.active{display:block}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .el{position:absolute;object-fit:fill}
  @media (prefers-reduced-motion: reduce){.el{animation:none!important;opacity:1!important;transform:none!important}}
  ${keyframes}
</style></head><body>
<div id="stage"><div id="frame">${slidesHtml}</div></div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')),cur=0;
  function show(n){
    n=Math.max(0,Math.min(slides.length-1,n));
    slides[cur].classList.remove('active');cur=n;
    var s=slides[cur];s.classList.add('active');
    // restart entrance animations + videos
    s.querySelectorAll('.el').forEach(function(e){
      if(e.style.animationName||e.style.animation){var a=e.style.animation;e.style.animation='none';e.offsetHeight;e.style.animation=a;}
      if(e.tagName==='VIDEO'){try{e.currentTime=0;e.play();}catch(x){}}
    });
  }
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(cur+1);
    else if(e.key==='ArrowLeft'||e.key==='PageUp')show(cur-1);
    else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);
  });
  document.getElementById('stage').addEventListener('click',function(e){show(cur+(e.clientX>innerWidth/2?1:-1));});
  show(0);
})();
</script></body></html>`;

writeFileSync(OUT, html);
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
const nClip = manifest.slides.reduce((a, s) => a + s.elements.filter((e) => clips[e.id]).length, 0);
console.log(`Baked HTML: ${manifest.slides.length} slides, ${nClip} ${FORMAT} clips, assets=${ASSETS}`);
console.log(`  ${mb} MB -> ${OUT}${ASSETS === "folder" ? "  (+ " + basename(assetDir) + "/)" : ""}`);
