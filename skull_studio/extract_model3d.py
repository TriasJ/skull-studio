"""Detect and extract PowerPoint 3D models (``am3d:model3d``) from a .pptx.

python-pptx walks only known shape tags and skips ``mc:AlternateContent``, so
inserted 3D models are invisible to the normal shape loop (and silently dropped).
This module reads the raw slide XML (``zipfile`` + ``lxml``), finds each 3D model,
resolves its GLB binary and its 2D preview PNG (the ``mc:Fallback`` picture), and
parses camera / transform / embedded-animation metadata.

What PowerPoint stores (verified against real decks):
  - the GLB is a standard glTF 2.0 binary in ``ppt/media/model3dN.glb``;
  - the model sits in ``mc:AlternateContent`` -> ``mc:Choice Requires="am3d"`` ->
    ``p:graphicFrame`` -> ``am3d:model3d`` with ``am3d:camera`` / ``am3d:trans``;
  - a twin ``mc:Fallback`` ``p:pic`` references a rendered preview PNG at the
    same position (our graceful-degradation image, and what LibreOffice renders);
  - embedded clip animations are referenced by ``a3danim:embedAnim @animId`` and
    are real glTF animation clips inside the GLB (no preset math to reconstruct).

``parse(pptx_path)`` returns ``{slide_index: [ModelInfo, ...]}``. Angles are
converted to radians, scale ratios to floats, FOV to degrees. The raw
``<am3d:model3d>`` fragment is kept verbatim for loss-free round-trip export.
"""
import math
import zipfile
from xml.sax.saxutils import escape

from lxml import etree

NS = {
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "am3d": "http://schemas.microsoft.com/office/drawing/2017/model3d",
    "a3d": "http://schemas.microsoft.com/office/drawing/2018/animation/model3d",
}
MODEL3D_REL = "http://schemas.microsoft.com/office/2017/06/relationships/model3d"
IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
DEG_UNIT = 60000.0      # OOXML angles are in 60000ths of a degree


def _q(prefix, tag):
    return f"{{{NS[prefix]}}}{tag}"


def _ratio(node, default=1.0):
    """``<x n=".." d=".."/>`` fraction -> float."""
    if node is None:
        return default
    n, d = node.get("n"), node.get("d")
    try:
        return float(n) / float(d) if n and d and float(d) else default
    except (TypeError, ValueError):
        return default


def _slide_size(z):
    """(cx, cy) of a slide in EMU, from presentation.xml."""
    root = etree.fromstring(z.read("ppt/presentation.xml"))
    sz = root.find(_q("p", "sldSz"))
    return int(sz.get("cx")), int(sz.get("cy"))


def _rels(z, slide_part):
    """rId -> absolute part path for a slide's .rels (handles ``../media/..``)."""
    name = slide_part.rsplit("/", 1)[-1]
    rels_part = f"ppt/slides/_rels/{name}.rels"
    out = {}
    if rels_part not in z.namelist():
        return out
    root = etree.fromstring(z.read(rels_part))
    for rel in root.findall(_q("rel", "Relationship")):
        target, mode = rel.get("Target"), rel.get("TargetMode")
        if mode == "External":
            out[rel.get("Id")] = (rel.get("Type"), target)
            continue
        # resolve relative to ppt/slides/
        path = _norm_join("ppt/slides/", target)
        out[rel.get("Id")] = (rel.get("Type"), path)
    return out


def _norm_join(base, target):
    parts = (base + target).split("/")
    stack = []
    for p in parts:
        if p == "..":
            if stack:
                stack.pop()
        elif p not in ("", "."):
            stack.append(p)
    return "/".join(stack)


def _xfrm_bbox(graphic_frame, SW, SH):
    """Normalized [x0,y0,x1,y1] (clamped) from a graphicFrame's p:xfrm."""
    xfrm = graphic_frame.find(_q("p", "xfrm"))
    if xfrm is None:
        return None
    off, ext = xfrm.find(_q("a", "off")), xfrm.find(_q("a", "ext"))
    if off is None or ext is None:
        return None
    x, y = int(off.get("x")), int(off.get("y"))
    cx, cy = int(ext.get("cx")), int(ext.get("cy"))
    x0 = max(0.0, min(1.0, x / SW))
    y0 = max(0.0, min(1.0, y / SH))
    x1 = max(0.0, min(1.0, (x + cx) / SW))
    y1 = max(0.0, min(1.0, (y + cy) / SH))
    return [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]


def _vec(node, keys=("x", "y", "z")):
    if node is None:
        return None
    try:
        return [float(node.get(k, node.get("d" + k, 0)) or 0) for k in keys]
    except (TypeError, ValueError):
        return None


def _parse_camera(model):
    cam = model.find(_q("am3d", "camera"))
    if cam is None:
        return None
    out = {}
    persp = cam.find(_q("am3d", "perspective"))
    if persp is not None and persp.get("fov"):
        out["fov"] = round(float(persp.get("fov")) / DEG_UNIT, 3)
    for key, tag, attrs in (("pos", "pos", ("x", "y", "z")),
                            ("up", "up", ("dx", "dy", "dz")),
                            ("lookAt", "lookAt", ("x", "y", "z"))):
        node = cam.find(_q("am3d", tag))
        if node is not None:
            try:
                out[key] = [float(node.get(a, 0) or 0) for a in attrs]
            except (TypeError, ValueError):
                pass
    return out or None


def _parse_transform(model):
    trans = model.find(_q("am3d", "trans"))
    if trans is None:
        return None
    out = {}
    rot = trans.find(_q("am3d", "rot"))
    if rot is not None:
        out["rot"] = [round(float(rot.get(a, 0) or 0) / DEG_UNIT * math.pi / 180.0, 5)
                      for a in ("ax", "ay", "az")]
    scale = trans.find(_q("am3d", "scale"))
    if scale is not None:
        out["scale"] = [round(_ratio(scale.find(_q("am3d", a))), 5)
                        for a in ("sx", "sy", "sz")]
    return out or None


def _parse_anim(model):
    """Embedded glTF clip reference -> {clip, durationMs, loop} or None."""
    emb = model.find(".//" + _q("a3d", "embedAnim"))
    if emb is None:
        return None
    pr = emb.find(_q("a3d", "animPr"))
    length = int(pr.get("length")) if pr is not None and pr.get("length") else None
    count = pr.get("count") if pr is not None else None
    try:
        clip = int(emb.get("animId", 0))
    except (TypeError, ValueError):
        clip = 0
    return {"clip": clip, "durationMs": length, "loop": count == "indefinite"}


def _name_descr(graphic_frame):
    cNvPr = graphic_frame.find(".//" + _q("p", "cNvPr"))
    if cNvPr is None:
        return None, None
    return cNvPr.get("name"), cNvPr.get("descr")


def parse(pptx_path):
    """Return {slide_index(0-based): {"models": [...], "timing": str|None}}.

    ``timing`` is the slide's raw ``<p:timing>`` when it drives 3D models (so the
    exporter can replay scene animations); each model carries its original ``spid``
    (graphicFrame id) for remapping that timing onto the re-exported shapes."""
    out = {}
    with zipfile.ZipFile(str(pptx_path)) as z:
        SW, SH = _slide_size(z)
        slide_parts = sorted(
            (n for n in z.namelist()
             if n.startswith("ppt/slides/slide") and n.endswith(".xml")),
            key=lambda n: int("".join(filter(str.isdigit, n.rsplit("/", 1)[-1]))))
        for idx, part in enumerate(slide_parts):
            rels = _rels(z, part)
            root = etree.fromstring(z.read(part))
            models = []
            for model in root.iter(_q("am3d", "model3d")):
                # walk up to the enclosing graphicFrame and AlternateContent
                gframe = model
                while gframe is not None and gframe.tag != _q("p", "graphicFrame"):
                    gframe = gframe.getparent()
                alt = gframe
                while alt is not None and alt.tag != _q("mc", "AlternateContent"):
                    alt = alt.getparent()

                bbox = _xfrm_bbox(gframe, SW, SH) if gframe is not None else None
                name, descr = _name_descr(gframe) if gframe is not None else (None, None)
                cnv = gframe.find(".//" + _q("p", "cNvPr")) if gframe is not None else None
                spid = cnv.get("id") if cnv is not None else None

                glb_rid = model.get(_q("r", "embed"))
                glb_part = rels.get(glb_rid, (None, None))[1] if glb_rid else None

                # preview PNG: prefer the am3d:raster blip, else mc:Fallback pic blip
                preview_rid = None
                raster = model.find(".//" + _q("am3d", "blip"))
                if raster is not None:
                    preview_rid = raster.get(_q("r", "embed"))
                if not preview_rid and alt is not None:
                    fb = alt.find(_q("mc", "Fallback"))
                    if fb is not None:
                        blip = fb.find(".//" + _q("a", "blip"))
                        if blip is not None:
                            preview_rid = blip.get(_q("r", "embed"))
                preview_part = rels.get(preview_rid, (None, None))[1] if preview_rid else None

                models.append({
                    "name": name,
                    "descr": descr,
                    "bbox": bbox,
                    "spid": spid,
                    "glb_part": glb_part,
                    "preview_part": preview_part,
                    "camera": _parse_camera(model),
                    "transform": _parse_transform(model),
                    "anim": _parse_anim(model),
                    "source_xml": etree.tostring(model, encoding="unicode"),
                })
            if models:
                # capture slide timing only when it actually targets these models
                timing_el = root.find(".//" + _q("p", "timing"))
                timing = etree.tostring(timing_el, encoding="unicode") if timing_el is not None else None
                spids = {m["spid"] for m in models if m["spid"]}
                if timing and not any(f'spid="{s}"' in timing for s in spids):
                    timing = None
                out[idx] = {"models": models, "timing": timing}
    return out


if __name__ == "__main__":  # manual probe: python -m skull_studio.extract_model3d deck.pptx
    import json
    import sys
    res = parse(sys.argv[1])
    summary = {str(k): {"timing": bool(v["timing"]),
                        "models": [{kk: vv for kk, vv in m.items() if kk != "source_xml"}
                                   for m in v["models"]]}
               for k, v in res.items()}
    print(json.dumps(summary, indent=2))
