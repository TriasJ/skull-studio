"""PPTX export: turn the animated deck back into an editable PowerPoint.

Rules:
  - text elements (OCR text boxes) without a blend mode  -> editable text boxes
  - everything else (images, shapes, blend-mode elements) -> pictures at their
    bbox; blend modes are baked into the PNG composited over the background.
  - each slide's background image is placed as a full-slide picture underneath.

Options:
  --format png|jpg   image format for pictures (default png; jpg is much smaller
                     but loses transparency, so alpha crops stay PNG either way)
  --quality N        JPEG quality 1-100 (default 85)
  --patches          also export each element's footprint patch (the sampled
                     fill colour or blurred backdrop) as a shape *under* the
                     element - a ready-made "cover" layer for editing in PPTX
  out.pptx           output path (default dist/presentation.pptx)

Design units in the manifest are PDF points (1/72 in); 1 pt = 12700 EMU.
"""
import argparse
import io
import json
from pathlib import Path

from lxml import etree
from PIL import Image, ImageChops
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
DIST = ROOT / "dist"
EMU_PER_PT = 12700

PIL_BLEND = {
    "multiply": ImageChops.multiply, "screen": ImageChops.screen,
    "add": ImageChops.add, "lighten": ImageChops.lighter, "darken": ImageChops.darker,
    "difference": ImageChops.difference,
}


def load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def has_alpha(img: Image.Image) -> bool:
    return img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255


def img_bytes(img: Image.Image, fmt: str, quality: int) -> io.BytesIO:
    """Encode as JPEG when allowed (opaque + jpg mode), else PNG (keeps alpha)."""
    buf = io.BytesIO()
    if fmt == "jpg" and not has_alpha(img):
        img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    else:
        img.convert("RGBA").save(buf, "PNG")
    buf.seek(0)
    return buf


def emu_box(bbox, W, H):
    return (Emu(round(bbox[0] * W)), Emu(round(bbox[1] * H)),
            Emu(round((bbox[2] - bbox[0]) * W)), Emu(round((bbox[3] - bbox[1]) * H)))


def flatten_blend(el, bg_img, W_px, H_px):
    crop = load_rgba(WORK / el["crop"])
    bb = el.get("cropBbox") or el["bbox"]
    box = (int(bb[0] * W_px), int(bb[1] * H_px), int(bb[2] * W_px), int(bb[3] * H_px))
    base = bg_img.crop(box).convert("RGBA").resize(crop.size)
    fn = PIL_BLEND.get(el.get("blendMode"))
    if fn:
        blended = fn(base.convert("RGB"), crop.convert("RGB")).convert("RGBA")
        blended.putalpha(crop.getchannel("A"))
        out = Image.alpha_composite(base, blended)
    else:
        out = Image.alpha_composite(base, crop)
    return out


def apply_opacity(img, el):
    if (el.get("opacity") or 1) < 1:
        a = img.getchannel("A").point(lambda v: int(v * el["opacity"]))
        img.putalpha(a)
    return img


def add_slide_timing(slide, entrances, medias):
    """Build EXACTLY ONE <p:timing> per slide (the schema allows only one),
    combining Fade entrances and auto-playing media into a single mainSeq.
      entrances: [(spid, delay_ms, dur_ms)]   media: [(spid, delay_ms)]
    Every entrance maps to a Fade (PowerPoint exposes it cleanly); videos play
    from 0 on slide load (looping is left to the gif export / file settings)."""
    if not entrances and not medias:
        return
    # the schema allows only one <p:timing> per slide; add_movie() injects its
    # own, so remove any existing before adding our combined one
    for existing in slide._element.findall(f"{{{P_NS}}}timing"):
        slide._element.remove(existing)
    cid = [10]

    def nid():
        cid[0] += 1
        return cid[0]

    pars = ""
    for spid, delay, dur in entrances:
        pars += f'''<p:par>
  <p:cTn id="{nid()}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="withEffect">
    <p:stCondLst><p:cond delay="{delay}"/></p:stCondLst>
    <p:childTnLst>
      <p:set><p:cBhvr>
          <p:cTn id="{nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
          <p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>
          <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
        </p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
      <p:animEffect transition="in" filter="fade"><p:cBhvr>
          <p:cTn id="{nid()}" dur="{dur}"/>
          <p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>
    </p:childTnLst>
  </p:cTn>
</p:par>'''
    for spid, delay in medias:
        pars += f'''<p:par>
  <p:cTn id="{nid()}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="withEffect">
    <p:stCondLst><p:cond delay="{delay}"/></p:stCondLst>
    <p:childTnLst>
      <p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr>
          <p:cTn id="{nid()}" dur="indefinite"/>
          <p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:cmd>
    </p:childTnLst>
  </p:cTn>
</p:par>'''
    timing = (f'<p:timing xmlns:p="{P_NS}"><p:tnLst><p:par>'
              '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
              '<p:seq concurrent="1" nextAc="seek">'
              '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
              + pars +
              '</p:childTnLst></p:cTn>'
              '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
              '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
              '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')
    slide._element.append(etree.fromstring(timing.encode("utf-8")))


def add_media_autoplay(slide, shape_id, loop=True):
    """Inject <p:timing> so an embedded video auto-plays (and loops) on slide
    show - mirrors what PowerPoint writes for 'Start: Automatically' + 'Loop'."""
    end = ('<p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>'
           if loop else "")
    timing = (f'<p:timing xmlns:p="{P_NS}"><p:tnLst><p:par>'
              '<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
              '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
              '<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
              '<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
              '<p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="withEffect">'
              '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
              f'<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="indefinite"/>'
              f'<p:tgtEl><p:spTgt spid="{shape_id}"/></p:tgtEl></p:cBhvr></p:cmd>'
              '</p:childTnLst></p:cTn></p:par>'
              '</p:childTnLst></p:cTn></p:par>'
              '</p:childTnLst></p:cTn></p:par>'
              '</p:childTnLst></p:cTn>'
              '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
              '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
              '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')
    slide._element.append(etree.fromstring(timing.encode("utf-8")))


def main(args):
    manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    deck = manifest["deck"]
    clip_index = {}
    if args.clips != "none":
        idx = WORK / "clips" / "index.json"
        if idx.exists():
            clip_index = {k: v for k, v in json.loads(idx.read_text()).items()
                          if v.get("format") == args.clips}
    W_emu = round(deck["designWidth"] * EMU_PER_PT)
    H_emu = round(deck["designHeight"] * EMU_PER_PT)

    prs = Presentation()
    prs.slide_width = Emu(W_emu)
    prs.slide_height = Emu(H_emu)
    blank = prs.slide_layouts[6]
    fmt, q = args.format, args.quality

    n_text = n_pic = n_patch = n_anim = n_clip = 0
    for slide in manifest["slides"]:
        s = prs.slides.add_slide(blank)
        bg_path = WORK / slide["background"]["src"]
        bg_img = Image.open(bg_path).convert("RGBA") if bg_path.exists() else None
        if bg_img:
            bgshape = s.shapes.add_picture(img_bytes(bg_img, fmt, q), Emu(0), Emu(0), Emu(W_emu), Emu(H_emu))
            bgshape.name = "background"
        W_px, H_px = (bg_img.size if bg_img else (deck["designWidth"], deck["designHeight"]))
        anims = []
        medias = []

        for el in sorted(slide["elements"], key=lambda e: e.get("z", 0)):
            if el.get("hidden"):
                continue
            bb = el.get("cropBbox") or el["bbox"]

            # optional footprint patch layer, placed just under the element
            if args.patches and el.get("cleanup") in ("fill", "blur"):
                px, py, pw, ph = emu_box(bb, W_emu, H_emu)
                if el.get("cleanup") == "fill" and el.get("fillColor"):
                    shp = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, px, py, pw, ph)
                    shp.fill.solid()
                    shp.fill.fore_color.rgb = RGBColor.from_string(el["fillColor"].lstrip("#"))
                    shp.line.fill.background()
                    n_patch += 1
                elif el.get("cleanup") == "blur" and el.get("patch") and (WORK / el["patch"]).exists():
                    s.shapes.add_picture(img_bytes(load_rgba(WORK / el["patch"]), fmt, q), px, py, pw, ph)
                    n_patch += 1

            is_text = el["type"] == "text" and el.get("text")
            has_blend = el.get("blendMode") and el["blendMode"] != "normal"
            shape = None

            # baked motion clip embedded at its (padded) bbox, instead of a static picture
            clip = clip_index.get(el["id"])
            if clip and (WORK / clip["clip"]).exists():
                cx, cy, cw_, ch_ = emu_box(clip["bbox"], W_emu, H_emu)
                if clip["format"] == "gif":
                    shape = s.shapes.add_picture(str(WORK / clip["clip"]), cx, cy, cw_, ch_)
                else:
                    poster = WORK / clip.get("poster", "")
                    shape = s.shapes.add_movie(
                        str(WORK / clip["clip"]), cx, cy, cw_, ch_,
                        poster_frame_image=str(poster) if poster.exists() else None,
                        mime_type="video/mp4")
                shape.name = el.get("name") or el["id"]
                n_clip += 1
                ent = el.get("entrance") or {}
                delay_ms = round(ent.get("delay", 0) * 1000)
                if args.animate and ent.get("type") not in (None, "none"):
                    anims.append((shape.shape_id, delay_ms, round(ent.get("duration", 0.8) * 1000)))
                if clip["format"] == "mp4":
                    medias.append((shape.shape_id, delay_ms))
                continue

            if is_text and not has_blend:
                x, y, w, h = emu_box(el["bbox"], W_emu, H_emu)
                shape = s.shapes.add_textbox(x, y, w, h)
                tf = shape.text_frame
                tf.word_wrap = True
                tf.vertical_anchor = MSO_ANCHOR.MIDDLE
                p = tf.paragraphs[0]
                p.alignment = PP_ALIGN.CENTER
                run = p.add_run()
                run.text = el["text"]
                size = args.font_size or max(10, min(40, round(
                    (el["bbox"][3] - el["bbox"][1]) * deck["designHeight"] * 0.5)))
                run.font.size = Pt(size * args.font_scale)
                run.font.color.rgb = RGBColor(0xF5, 0xEF, 0xE0)
                n_text += 1
            else:
                crop_path = WORK / el["crop"]
                if not crop_path.exists():
                    continue
                img = flatten_blend(el, bg_img, W_px, H_px) if (has_blend and bg_img) else load_rgba(crop_path)
                img = apply_opacity(img, el)
                bx, by, bw, bh = emu_box(bb, W_emu, H_emu)
                shape = s.shapes.add_picture(img_bytes(img, fmt, q), bx, by, bw, bh)
                n_pic += 1

            if shape is not None:
                shape.name = el.get("name") or el["id"]  # editable name -> PPT Selection Pane

            # collect entrance animation (every entrance -> PPT Fade, when possible)
            ent = el.get("entrance") or {}
            if args.animate and shape is not None and ent.get("type") not in (None, "none"):
                anims.append((shape.shape_id, round(ent.get("delay", 0) * 1000),
                              round(ent.get("duration", 0.8) * 1000)))

        if anims or medias:
            add_slide_timing(s, anims, medias)
            n_anim += len(anims)

    DIST.mkdir(exist_ok=True)
    prs.save(str(args.out))
    print(f"Exported {len(manifest['slides'])} slides -> {args.out}")
    print(f"  {n_text} text boxes, {n_pic} pictures, {n_clip} clips, {n_patch} patch shapes, "
          f"{n_anim} animations ({fmt.upper()}{', q' + str(q) if fmt == 'jpg' else ''})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=str(DIST / "presentation.pptx"))
    ap.add_argument("--format", choices=("png", "jpg"), default="png")
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--patches", action="store_true")
    ap.add_argument("--font-size", type=int, default=0, help="fixed pt for text boxes (0 = auto)")
    ap.add_argument("--font-scale", type=float, default=1.0, help="multiplier on auto/fixed size")
    ap.add_argument("--animate", action="store_true", help="add Fade entrance animations")
    ap.add_argument("--clips", choices=("none", "mp4", "gif"), default="none",
                    help="embed baked looping clips (from work/clips) for animated elements")
    ap.add_argument("--fps", type=int, default=18, help="(passed through; clips are pre-rendered)")
    a = ap.parse_args()
    a.out = Path(a.out)
    if not a.out.is_absolute():
        a.out = ROOT / a.out
    main(a)
