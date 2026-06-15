"""Bake animated elements (idle loops + mesh/bone rigs) to looping mp4/gif.

Browser-free: replays the same animation math as the runtime (40-anim.js idles,
50-deform.js skinning) in numpy/OpenCV, composites each frame over the element's
own background region (so the clip is opaque and drops seamlessly back at the
element bbox), and encodes with ffmpeg. Writes work/clips/<id>.<ext> plus a
poster PNG and an index (work/clips/index.json) consumed by the exporters.

Usage: python -m skull_studio.render_clips [--format mp4|gif] [--fps 18] [--max-dur 6]
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
CLIPS = WORK / "clips"
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


# ---------------------------------------------------------------- easing
def ease_sine_inout(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


# ---------------------------------------------------------------- 2D rigid transforms (c,s,tx,ty)
def m_make(x, y, deg):
    r = math.radians(deg or 0)
    return (math.cos(r), math.sin(r), x, y)


def m_mul(A, B):
    return (A[0] * B[0] - A[1] * B[1], A[1] * B[0] + A[0] * B[1],
            A[0] * B[2] - A[1] * B[3] + A[2], A[1] * B[2] + A[0] * B[3] + A[3])


def m_inv(A):
    c, s, tx, ty = A
    return (c, -s, -(c * tx + s * ty), -(-s * tx + c * ty))


def m_apply(A, x, y):
    return (A[0] * x - A[1] * y + A[2], A[1] * x + A[0] * y + A[3])


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# ---------------------------------------------------------------- rig skinning (port of 50-deform.js)
class Rig:
    def __init__(self, spec, texW, texH):
        self.spec = spec
        self.texW, self.texH = texW, texH
        self.bones = spec["bones"]
        self.vx = spec["mesh"]["verticesX"]
        self.vy = spec["mesh"]["verticesY"]
        self.dur = spec["anim"].get("duration", 3.0)
        self.tracks = spec["anim"].get("tracks", {})
        self._bake()

    def _bake(self):
        vx, vy, texW, texH = self.vx, self.vy, self.texW, self.texH
        # rest grid (pixel space), row-major like MeshPlane
        xs = np.linspace(0, texW, vx)
        ys = np.linspace(0, texH, vy)
        gx, gy = np.meshgrid(xs, ys)
        self.rest = np.stack([gx.ravel(), gy.ravel()], axis=1)  # (nV,2)
        nV = self.rest.shape[0]
        bones = self.bones
        falloff = self.spec.get("weights", {}).get("falloff", 2.0)
        maxInf = min(self.spec.get("weights", {}).get("maxInfluences", 2), max(len(bones), 1))
        self.idx = {b["id"]: i for i, b in enumerate(bones)}
        self.rest_world = [m_make(b["x"] * texW, b["y"] * texH, b.get("angle", 0)) for b in bones]
        self.rest_world_inv = [m_inv(M) for M in self.rest_world]
        self.maxInf = maxInf

        self.vW = np.zeros((nV, maxInf), np.float32)
        self.vB = np.zeros((nV, maxInf), np.int32)
        self.vLocal = np.zeros((nV, maxInf, 2), np.float32)
        if not bones:
            return
        for v in range(nV):
            vxp, vyp = self.rest[v]
            scores = np.empty(len(bones), np.float64)
            for bi, b in enumerate(bones):
                ax, ay = b["x"] * texW, b["y"] * texH
                if b.get("length", 0) > 0:
                    r = math.radians(b.get("angle", 0))
                    bx = ax + math.cos(r) * b["length"] * texW
                    by = ay + math.sin(r) * b["length"] * texW
                    d = dist_to_segment(vxp, vyp, ax, ay, bx, by)
                else:
                    d = math.hypot(vxp - ax, vyp - ay)
                scores[bi] = 1.0 / (d ** falloff + 1e-3)
            order = np.argsort(scores)[::-1][:maxInf]
            ssum = scores[order].sum()
            for k in range(maxInf):
                bi = int(order[k]) if k < len(order) else int(order[0])
                w = scores[bi] / ssum if k < len(order) else 0.0
                self.vW[v, k] = w
                self.vB[v, k] = bi
                lx, ly = m_apply(self.rest_world_inv[bi], vxp, vyp)
                self.vLocal[v, k] = (lx, ly)

    def pose_at(self, t):
        """interpolate each tracked bone's pose at time t (looped, eased)."""
        pose = {}
        for b in self.bones:
            pose[b["id"]] = (b["x"], b["y"], b.get("angle", 0))
        for bid, keys in self.tracks.items():
            if bid not in pose or not keys:
                continue
            ks = sorted(keys, key=lambda k: k["t"])
            if t <= ks[0]["t"]:
                k = ks[0]; pose[bid] = (k["x"], k["y"], k.get("angle", 0)); continue
            if t >= ks[-1]["t"]:
                k = ks[-1]; pose[bid] = (k["x"], k["y"], k.get("angle", 0)); continue
            for i in range(1, len(ks)):
                if t <= ks[i]["t"]:
                    a, b2 = ks[i - 1], ks[i]
                    span = max(b2["t"] - a["t"], 1e-6)
                    f = ease_sine_inout((t - a["t"]) / span)
                    pose[bid] = (a["x"] + (b2["x"] - a["x"]) * f,
                                 a["y"] + (b2["y"] - a["y"]) * f,
                                 a.get("angle", 0) + (b2.get("angle", 0) - a.get("angle", 0)) * f)
                    break
        return pose

    def world_current(self, pose):
        out = [None] * len(self.bones)
        tracked = set(self.tracks.keys())
        for i, b in enumerate(self.bones):
            px, py, pa = pose[b["id"]]
            if b["id"] in tracked or b.get("parent") is None:
                out[i] = m_make(px * self.texW, py * self.texH, pa)
            else:
                pi = self.idx.get(b["parent"])
                if pi is None or out[pi] is None:
                    out[i] = m_make(px * self.texW, py * self.texH, pa)
                else:
                    delta = m_mul(out[pi], self.rest_world_inv[pi])
                    out[i] = m_mul(delta, self.rest_world[i])
        return out

    def deformed_grid(self, t):
        if not self.bones:
            return self.rest.copy()
        W = self.world_current(self.pose_at(t))
        nV = self.rest.shape[0]
        out = np.empty_like(self.rest)
        for v in range(nV):
            px = py = 0.0
            for k in range(self.maxInf):
                w = self.vW[v, k]
                if w == 0:
                    continue
                m = W[self.vB[v, k]]
                lx, ly = self.vLocal[v, k]
                px += w * (m[0] * lx - m[1] * ly + m[2])
                py += w * (m[1] * lx + m[0] * ly + m[3])
            out[v] = (px, py)
        return out


def warp_rig(crop_rgba, rig, t):
    """cv2.remap the crop by the rig's deformed grid (backward warp w/ negated
    displacement - standard for moderate mesh deformations)."""
    h, w = crop_rgba.shape[:2]
    deformed = rig.deformed_grid(t).reshape(rig.vy, rig.vx, 2)
    rest = rig.rest.reshape(rig.vy, rig.vx, 2)
    disp = (deformed - rest).astype(np.float32)        # forward (rest->deformed)
    dx = cv2.resize(disp[:, :, 0], (w, h), interpolation=cv2.INTER_LINEAR)
    dy = cv2.resize(disp[:, :, 1], (w, h), interpolation=cv2.INTER_LINEAR)
    xx, yy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    map_x = xx - dx
    map_y = yy - dy
    return cv2.remap(crop_rgba, map_x, map_y, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


# ---------------------------------------------------------------- idle transforms (port of 40-anim.js)
def idle_param(el, name, *keys, default=0.0):
    for i in el.get("idle", []):
        if i["type"] == name:
            for k in keys:
                if k in i:
                    return i[k]
            return default
    return None


def loop_duration(el, default=4.0, cap=6.0):
    d = 0.0
    for i in el.get("idle", []):
        d = max(d, i.get("period", 4.0))
    if el.get("rig") and el["rig"].get("anim", {}).get("tracks"):
        d = max(d, el["rig"]["anim"].get("duration", 3.0))
    return min(d or default, cap)


def render_frame(el, crop_rgba, rig, t, dur, cropH_norm):
    """apply rig (if any) then composable idle transforms; returns RGBA crop."""
    img = crop_rgba
    if rig is not None:
        img = warp_rig(img, rig, t)
    h, w = img.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    phase = 2 * math.pi * (t / dur)

    breath = idle_param(el, "breath", "amount", "amplitude")
    sway = idle_param(el, "sway", "degrees")
    floaty = idle_param(el, "float", "amplitude")
    pulse = idle_param(el, "pulse", "amount")
    shimmer = idle_param(el, "shimmer", "amount")

    M = np.array([[1, 0, 0], [0, 1, 0]], np.float32)
    scale = 1.0 + (breath * math.sin(phase) if breath else 0.0)
    angle = (sway * math.sin(phase)) if sway else 0.0
    if scale != 1.0 or angle != 0.0:
        M = cv2.getRotationMatrix2D((cx, cy), angle, scale).astype(np.float32)
    ty = 0.0
    if floaty:
        ty = (floaty / max(cropH_norm, 1e-3)) * h * math.sin(phase)
    M[1, 2] += ty
    if not np.allclose(M, [[1, 0, 0], [0, 1, 0]]):
        img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    if shimmer:
        k = 1.0 - shimmer * abs(math.sin(phase))
        img = img.copy()
        img[:, :, :3] = np.clip(img[:, :, :3].astype(np.float32) * k, 0, 255).astype(np.uint8)
    if pulse:
        a = 1.0 - pulse * abs(math.sin(phase))
        img = img.copy()
        img[:, :, 3] = (img[:, :, 3].astype(np.float32) * a).astype(np.uint8)
    return img


# ---------------------------------------------------------------- compositing + encode
def composite(bg_patch_rgb, crop_rgba, ox, oy):
    """alpha-composite an RGBA crop onto an opaque RGB canvas at (ox,oy)."""
    H, W = bg_patch_rgb.shape[:2]
    h, w = crop_rgba.shape[:2]
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(W, ox + w), min(H, oy + h)
    if x1 <= x0 or y1 <= y0:
        return bg_patch_rgb
    sub = crop_rgba[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    dst = bg_patch_rgb[y0:y1, x0:x1].astype(np.float32)
    a = (sub[:, :, 3:4].astype(np.float32)) / 255.0
    out = sub[:, :, :3].astype(np.float32) * a + dst * (1 - a)
    bg_patch_rgb[y0:y1, x0:x1] = out.astype(np.uint8)
    return bg_patch_rgb


def encode(frames_dir, out_path, fps, fmt, max_dim):
    # downscale to max_dim (clips are embedded at element size - full 2x render
    # res is wasteful, and gigantic for GIFs); keep even dims for yuv420p
    scale = f"scale='min({max_dim},iw)':-2:flags=lanczos"
    if fmt == "mp4":
        subprocess.run([FFMPEG, "-y", "-framerate", str(fps), "-i",
                        str(frames_dir / "f_%04d.png"), "-vf", scale, "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:  # gif, two-pass palette
        pal = frames_dir / "palette.png"
        subprocess.run([FFMPEG, "-y", "-i", str(frames_dir / "f_%04d.png"),
                        "-vf", f"{scale},palettegen=stats_mode=diff", str(pal)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run([FFMPEG, "-y", "-framerate", str(fps), "-i", str(frames_dir / "f_%04d.png"),
                        "-i", str(pal), "-lavfi", f"{scale} [x]; [x][1:v] paletteuse=dither=bayer",
                        "-loop", "0", str(out_path)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def even(n):
    return n - (n % 2)


def main(args):
    manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    CLIPS.mkdir(exist_ok=True)
    index = {}
    n = 0
    for slide in manifest["slides"]:
        bg_path = WORK / slide["background"]["src"]
        if not bg_path.exists():
            continue
        bg = np.array(Image.open(bg_path).convert("RGB"))
        BH, BW = bg.shape[:2]
        for el in slide["elements"]:
            if args.element_id and el["id"] != args.element_id:
                continue
            has_idle = any(i["type"] in ("breath", "float", "sway", "pulse", "shimmer")
                           for i in el.get("idle", []))
            has_rig = bool(el.get("rig") and el["rig"].get("anim", {}).get("tracks"))
            if not (has_idle or has_rig) or el.get("hidden"):
                continue
            crop_path = WORK / el["crop"]
            if not crop_path.exists():
                continue
            crop = np.array(Image.open(crop_path).convert("RGBA"))
            ch, cw = crop.shape[:2]
            cb = el.get("cropBbox") or el["bbox"]
            cropH_norm = cb[3] - cb[1]
            # padded background region around the element bbox (px in the render)
            pad = 0.10
            px0 = max(0, int((cb[0] - pad * (cb[2] - cb[0])) * BW))
            py0 = max(0, int((cb[1] - pad * cropH_norm) * BH))
            px1 = min(BW, int((cb[2] + pad * (cb[2] - cb[0])) * BW))
            py1 = min(BH, int((cb[3] + pad * cropH_norm) * BH))
            # offset of the crop within the padded canvas
            ox = int(cb[0] * BW) - px0
            oy = int(cb[1] * BH) - py0
            canvas_w, canvas_h = even(px1 - px0), even(py1 - py0)
            base = bg[py0:py0 + canvas_h, px0:px0 + canvas_w].copy()

            rig = Rig(el["rig"], cw, ch) if has_rig else None
            dur = loop_duration(el)
            fps = args.fps if args.format == "mp4" else min(args.fps, 15)
            frames = max(2, round(dur * fps))

            with tempfile.TemporaryDirectory() as td:
                td = Path(td)
                for fi in range(frames):
                    t = (fi / frames) * dur
                    rc = render_frame(el, crop, rig, t, dur, cropH_norm)
                    frame = base.copy()
                    composite(frame, rc, ox, oy)
                    Image.fromarray(frame).save(td / f"f_{fi:04d}.png")
                ext = args.format
                out = CLIPS / f"{el['id']}.{ext}"
                encode(td, out, fps, ext, args.max_dim)
                Image.fromarray(base).save(CLIPS / f"{el['id']}_poster.png")
            index[el["id"]] = {
                "clip": f"clips/{el['id']}.{args.format}",
                "poster": f"clips/{el['id']}_poster.png",
                # placement bbox of the (padded) clip, normalized to the slide
                "bbox": [round(px0 / BW, 4), round(py0 / BH, 4),
                         round((px0 + canvas_w) / BW, 4), round((py0 + canvas_h) / BH, 4)],
                "format": args.format,
            }
            n += 1
            print(f"  {el['id']}: {frames} frames @ {fps}fps -> {out.name}")

    (CLIPS / "index.json").write_text(json.dumps(index, indent=2))
    print(f"Rendered {n} clips -> {CLIPS}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=("mp4", "gif"), default="mp4")
    ap.add_argument("--fps", type=int, default=18)
    ap.add_argument("--max-dur", type=float, default=6.0)
    ap.add_argument("--max-dim", type=int, default=800,
                    help="downscale clips to this max width/height (smaller files)")
    ap.add_argument("--element-id", default=None, help="bake only this element (others skipped)")
    main(ap.parse_args())
