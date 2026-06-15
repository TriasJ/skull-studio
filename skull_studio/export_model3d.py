"""Inject 3D models (am3d:model3d) back into an exported .pptx -- the round-trip.

python-pptx can't author 3D models, so after the normal export we post-process
the package zip: add each GLB + its preview PNG as media parts, wire the slide
relationships, and splice an ``<mc:AlternateContent>`` into the slide -- the
``mc:Choice`` carries the 3D model, the ``mc:Fallback`` a plain picture of the
preview (what non-3D renderers, incl. LibreOffice, show). Unedited models reuse
their verbatim ``sourceXml`` (only the embed ids are repointed at the new parts);
others get a minimal model3d regenerated from the manifest's camera/transform.

Mirrors exactly the structure observed in PowerPoint-authored decks so the result
reopens without a "repair" prompt.
"""
import math
import re
import zipfile
from pathlib import Path

from lxml import etree

try:                                    # works both as a package and as a script
    from . import extract_model3d as ex
except ImportError:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import extract_model3d as ex
NS = ex.NS
MODEL3D_REL = ex.MODEL3D_REL
IMAGE_REL = ex.IMAGE_REL
DEG = ex.DEG_UNIT


def _q(prefix, tag):
    return f"{{{NS[prefix]}}}{tag}"


def _next_media_index(names, stem):
    n = 0
    for nm in names:
        m = re.match(rf"ppt/media/{stem}(\d+)\.", nm)
        if m:
            n = max(n, int(m.group(1)))
    return n + 1


def _next_rid(rels_root):
    n = 0
    for rel in rels_root.findall(_q("rel", "Relationship")):
        m = re.match(r"rId(\d+)", rel.get("Id") or "")
        if m:
            n = max(n, int(m.group(1)))
    return n + 1


def _next_shape_id(sptree):
    ids = [int(c.get("id")) for c in sptree.iter(_q("p", "cNvPr")) if (c.get("id") or "").isdigit()]
    return (max(ids) + 1) if ids else 100


def _add_rel(rels_root, rid, reltype, target):
    el = etree.SubElement(rels_root, _q("rel", "Relationship"))
    el.set("Id", rid)
    el.set("Type", reltype)
    el.set("Target", target)


def _emu_box(bbox, W, H):
    x, y = round(bbox[0] * W), round(bbox[1] * H)
    return x, y, round(bbox[2] * W) - x, round(bbox[3] * H) - y


def _model3d_xml(model, glb_rid, img_rid, cx, cy):
    """Return an <am3d:model3d> element with embeds repointed at the new parts.

    Prefers the verbatim source fragment; regenerates a *complete* one otherwise
    (PowerPoint rejects -- and on repair strips -- a model3d that is missing the
    objViewport or lighting, or that has a zero spPr extent, so we mirror the full
    structure PowerPoint itself writes)."""
    src = (model.get("model3d") or {}).get("sourceXml")
    if src:
        node = etree.fromstring(src.encode("utf-8"))
        node.set(_q("r", "embed"), glb_rid)
        for blip in node.iter(_q("am3d", "blip")):
            blip.set(_q("r", "embed"), img_rid)
        return node
    # regenerate from structured fields
    m3 = model.get("model3d") or {}
    fov = int(round((m3.get("camera", {}).get("fov") or 45) * DEG))
    rot = (m3.get("transform") or {}).get("rot") or [0, 0, 0]
    ax, ay, az = (int(round(r / math.pi * 180 * DEG)) for r in rot)
    vp = max(int(cx), int(cy))
    a = NS["a"]
    xml = f'''<am3d:model3d xmlns:am3d="{NS['am3d']}" xmlns:a="{a}" xmlns:r="{NS['r']}" r:embed="{glb_rid}">
  <am3d:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{int(cx)}" cy="{int(cy)}"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></am3d:spPr>
  <am3d:camera><am3d:pos x="0" y="0" z="50000000"/><am3d:up dx="0" dy="36000000" dz="0"/>
    <am3d:lookAt x="0" y="0" z="0"/><am3d:perspective fov="{fov}"/></am3d:camera>
  <am3d:trans><am3d:meterPerModelUnit n="1" d="1"/>
    <am3d:preTrans dx="0" dy="0" dz="0"/>
    <am3d:scale><am3d:sx n="1000000" d="1000000"/><am3d:sy n="1000000" d="1000000"/><am3d:sz n="1000000" d="1000000"/></am3d:scale>
    <am3d:rot ax="{ax}" ay="{ay}" az="{az}"/>
    <am3d:postTrans dx="0" dy="0" dz="0"/></am3d:trans>
  <am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="{img_rid}"/></am3d:raster>
  <am3d:objViewport viewportSz="{vp}"/>
  <am3d:ambientLight><am3d:clr><a:scrgbClr r="50000" g="50000" b="50000"/></am3d:clr>
    <am3d:illuminance n="1000000" d="1000000"/></am3d:ambientLight>
  <am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="100000" g="100000" b="100000"/></am3d:clr>
    <am3d:intensity n="9765625" d="1000000"/><am3d:pos x="21959998" y="70920001" z="16344003"/></am3d:ptLight>
</am3d:model3d>'''
    return etree.fromstring(xml.encode("utf-8"))


def _alt_content(model, glb_rid, img_rid, shape_id, W, H):
    """<mc:AlternateContent> = Choice(graphicFrame/model3d) + Fallback(pic)."""
    x, y, cx, cy = _emu_box(model["bbox"], W, H)
    name = model.get("name") or model.get("id") or "3D Model"
    descr = (model.get("text") or "").replace('"', "'")[:250]
    mc, p, a, r = NS["mc"], NS["p"], NS["a"], NS["r"]

    alt = etree.Element(_q("mc", "AlternateContent"), nsmap={"mc": mc})
    choice = etree.SubElement(alt, _q("mc", "Choice"), nsmap={"am3d": NS["am3d"]})
    choice.set("Requires", "am3d")
    gf = etree.SubElement(choice, _q("p", "graphicFrame"))
    nv = etree.SubElement(gf, _q("p", "nvGraphicFramePr"))
    cNvPr = etree.SubElement(nv, _q("p", "cNvPr"))
    cNvPr.set("id", str(shape_id)); cNvPr.set("name", name)
    if descr:
        cNvPr.set("descr", descr)
    etree.SubElement(etree.SubElement(nv, _q("p", "cNvGraphicFramePr")),
                     _q("a", "graphicFrameLocks")).set("noChangeAspect", "1")
    etree.SubElement(nv, _q("p", "nvPr"))
    xfrm = etree.SubElement(gf, _q("p", "xfrm"))
    etree.SubElement(xfrm, _q("a", "off"), x=str(x), y=str(y))
    etree.SubElement(xfrm, _q("a", "ext"), cx=str(cx), cy=str(cy))
    graphic = etree.SubElement(gf, _q("a", "graphic"))
    gdata = etree.SubElement(graphic, _q("a", "graphicData"))
    gdata.set("uri", NS["am3d"])
    gdata.append(_model3d_xml(model, glb_rid, img_rid, cx, cy))

    fb = etree.SubElement(alt, _q("mc", "Fallback"))
    pic = etree.SubElement(fb, _q("p", "pic"))
    nvp = etree.SubElement(pic, _q("p", "nvPicPr"))
    cp = etree.SubElement(nvp, _q("p", "cNvPr"))
    cp.set("id", str(shape_id)); cp.set("name", name)
    if descr:
        cp.set("descr", descr)
    etree.SubElement(nvp, _q("p", "cNvPicPr"))
    etree.SubElement(nvp, _q("p", "nvPr"))
    bf = etree.SubElement(pic, _q("p", "blipFill"))
    etree.SubElement(bf, _q("a", "blip")).set(_q("r", "embed"), img_rid)
    etree.SubElement(etree.SubElement(bf, _q("a", "stretch")), _q("a", "fillRect"))
    sppr = etree.SubElement(pic, _q("p", "spPr"))
    xf2 = etree.SubElement(sppr, _q("a", "xfrm"))
    etree.SubElement(xf2, _q("a", "off"), x=str(x), y=str(y))
    etree.SubElement(xf2, _q("a", "ext"), cx=str(cx), cy=str(cy))
    geom = etree.SubElement(sppr, _q("a", "prstGeom")); geom.set("prst", "rect")
    etree.SubElement(geom, _q("a", "avLst"))
    return alt


def _ensure_content_types(xml_bytes):
    """Guarantee Default entries for glb + png (mirrors PowerPoint's own)."""
    root = etree.fromstring(xml_bytes)
    have = {d.get("Extension") for d in root.findall(_q("ct", "Default"))}
    for ext, ct in (("glb", "model/unknown"), ("png", "image/png")):
        if ext not in have:
            d = etree.SubElement(root, _q("ct", "Default"))
            d.set("Extension", ext); d.set("ContentType", ct)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def inject(pptx_path, models_by_slide, W_emu, H_emu):
    """Splice 3D models into the saved package. models_by_slide:
    {slide_index: [ {bbox, id, name, text, glb(Path), preview(Path|None), model3d{...}} ]}."""
    pptx_path = Path(pptx_path)
    with zipfile.ZipFile(str(pptx_path)) as z:
        members = {n: z.read(n) for n in z.namelist()}

    names = set(members)
    glb_k = _next_media_index(names, "model3d")
    img_k = _next_media_index(names, "image")
    glb_overrides = []

    for sidx, models in models_by_slide.items():
        spart = f"ppt/slides/slide{sidx + 1}.xml"
        rpart = f"ppt/slides/_rels/slide{sidx + 1}.xml.rels"
        if spart not in members:
            continue
        slide_root = etree.fromstring(members[spart])
        sptree = slide_root.find(f".//{_q('p', 'spTree')}")
        rels_root = (etree.fromstring(members[rpart]) if rpart in members else
                     etree.fromstring(f'<Relationships xmlns="{NS["rel"]}"/>'.encode()))
        shape_id = _next_shape_id(sptree)

        for model in models:
            glb_name = f"ppt/media/model3d{glb_k}.glb"; glb_k += 1
            members[glb_name] = Path(model["glb"]).read_bytes()
            glb_overrides.append("/" + glb_name)
            img_name = f"ppt/media/image{img_k}.png"; img_k += 1
            members[img_name] = Path(model["preview"]).read_bytes()

            glb_rid = f"rId{_next_rid(rels_root)}"
            _add_rel(rels_root, glb_rid, MODEL3D_REL, f"../media/{Path(glb_name).name}")
            img_rid = f"rId{_next_rid(rels_root)}"
            _add_rel(rels_root, img_rid, IMAGE_REL, f"../media/{Path(img_name).name}")

            alt = _alt_content(model, glb_rid, img_rid, shape_id, W_emu, H_emu)
            shape_id += 1
            ext = sptree.find(_q("p", "extLst"))      # keep extLst last if present
            if ext is not None:
                ext.addprevious(alt)
            else:
                sptree.append(alt)

        members[spart] = etree.tostring(slide_root, xml_declaration=True,
                                        encoding="UTF-8", standalone=True)
        members[rpart] = etree.tostring(rels_root, xml_declaration=True,
                                        encoding="UTF-8", standalone=True)

    # content types: glb/png defaults + per-glb overrides (as PowerPoint writes)
    ct = etree.fromstring(_ensure_content_types(members["[Content_Types].xml"]))
    have_ov = {o.get("PartName") for o in ct.findall(_q("ct", "Override"))}
    for part in glb_overrides:
        if part not in have_ov:
            o = etree.SubElement(ct, _q("ct", "Override"))
            o.set("PartName", part); o.set("ContentType", "model/gltf.binary")
    members["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True,
                                                    encoding="UTF-8", standalone=True)

    with zipfile.ZipFile(str(pptx_path), "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in members.items():
            z.writestr(name, data)
    return sum(len(v) for v in models_by_slide.values())
