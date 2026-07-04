#!/usr/bin/env python3
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path
from typing import Iterable, Sequence

ROOT = Path(__file__).resolve().parents[1]
MASTER_SIZE = 1024

Color = tuple[int, int, int, int]
Point = tuple[float, float]


def clamp(value: float, lo = 0.0, hi = 1.0) -> float:
    return max(lo, min(hi, value))


def new_canvas(size: int) -> list[bytearray]:
    return [bytearray(size * 4) for _ in range(size)]


def blend_px(row: bytearray, x: int, rgba: Color) -> None:
    sr, sg, sb, sa = rgba
    if sa <= 0:
        return
    i = x * 4
    if sa >= 255:
        row[i:i + 4] = bytes((sr, sg, sb, 255))
        return
    dr, dg, db, da = row[i], row[i + 1], row[i + 2], row[i + 3]
    a = sa / 255.0
    inv = 1.0 - a
    out_a = a + (da / 255.0) * inv
    if out_a <= 0:
        return
    row[i] = int((sr * a + dr * (da / 255.0) * inv) / out_a + 0.5)
    row[i + 1] = int((sg * a + dg * (da / 255.0) * inv) / out_a + 0.5)
    row[i + 2] = int((sb * a + db * (da / 255.0) * inv) / out_a + 0.5)
    row[i + 3] = int(out_a * 255 + 0.5)


def rounded_rect_sdf(x: float, y: float, x0: float, y0: float, x1: float, y1: float, r: float) -> float:
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    hx = (x1 - x0) / 2 - r
    hy = (y1 - y0) / 2 - r
    qx = abs(x - cx) - hx
    qy = abs(y - cy) - hy
    ox = max(qx, 0)
    oy = max(qy, 0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0) - r


def draw_rounded_rect(img: list[bytearray], x0: float, y0: float, x1: float, y1: float, r: float, color: Color) -> None:
    size = len(img)
    ix0, iy0 = max(0, int(x0 - r - 3)), max(0, int(y0 - r - 3))
    ix1, iy1 = min(size - 1, int(x1 + r + 3)), min(size - 1, int(y1 + r + 3))
    for y in range(iy0, iy1 + 1):
        row = img[y]
        for x in range(ix0, ix1 + 1):
            d = rounded_rect_sdf(x + 0.5, y + 0.5, x0, y0, x1, y1, r)
            a = clamp(0.5 - d / 2.0)
            if a > 0:
                blend_px(row, x, (color[0], color[1], color[2], int(color[3] * a)))


def draw_circle(img: list[bytearray], cx: float, cy: float, radius: float, color: Color) -> None:
    size = len(img)
    ix0, iy0 = max(0, int(cx - radius - 3)), max(0, int(cy - radius - 3))
    ix1, iy1 = min(size - 1, int(cx + radius + 3)), min(size - 1, int(cy + radius + 3))
    for y in range(iy0, iy1 + 1):
        row = img[y]
        for x in range(ix0, ix1 + 1):
            d = math.hypot((x + 0.5) - cx, (y + 0.5) - cy) - radius
            a = clamp(0.5 - d / 2.0)
            if a > 0:
                blend_px(row, x, (color[0], color[1], color[2], int(color[3] * a)))


def point_in_poly(x: float, y: float, poly: Sequence[Point]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def draw_polygon(img: list[bytearray], poly: Sequence[Point], color: Color) -> None:
    size = len(img)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    ix0, iy0 = max(0, int(min(xs) - 3)), max(0, int(min(ys) - 3))
    ix1, iy1 = min(size - 1, int(max(xs) + 3)), min(size - 1, int(max(ys) + 3))
    for y in range(iy0, iy1 + 1):
        row = img[y]
        for x in range(ix0, ix1 + 1):
            # Tiny supersample for smoother diagonal aircraft edges.
            samples = 0
            for ox, oy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
                if point_in_poly(x + ox, y + oy, poly):
                    samples += 1
            if samples:
                blend_px(row, x, (color[0], color[1], color[2], int(color[3] * samples / 4)))


def draw_bezier_route(img: list[bytearray], p0: Point, p1: Point, p2: Point, width: float, color: Color) -> None:
    last = None
    for step in range(110):
        t = step / 109
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        draw_circle(img, x, y, width / 2, color)
        last = (x, y)
    draw_circle(img, p0[0], p0[1], width * 1.10, (255, 255, 255, 230))
    draw_circle(img, p0[0], p0[1], width * 0.56, (255, 138, 0, 255))
    draw_circle(img, p2[0], p2[1], width * 1.05, (255, 255, 255, 220))
    draw_circle(img, p2[0], p2[1], width * 0.50, (255, 138, 0, 255))


def transform_plane(local: Sequence[Point], center: Point, scale: float, angle_degrees: float) -> list[Point]:
    theta = math.radians(angle_degrees)
    ux, uy = math.cos(theta), math.sin(theta)
    vx, vy = -math.sin(theta), math.cos(theta)
    return [(center[0] + (x * ux + y * vx) * scale, center[1] + (x * uy + y * vy) * scale) for x, y in local]


def create_master() -> list[bytearray]:
    n = MASTER_SIZE
    img = new_canvas(n)
    margin = n * 0.075
    r = n * 0.215

    # Rounded square background with alpha corners and layered aviation-blue gradient.
    for y in range(n):
        row = img[y]
        yn = y / (n - 1)
        for x in range(n):
            xn = x / (n - 1)
            d = rounded_rect_sdf(x + 0.5, y + 0.5, margin, margin, n - margin, n - margin, r)
            a = clamp(0.5 - d / 2.0)
            if a <= 0:
                continue
            diag = (xn + yn) / 2
            radial = clamp(1.15 - math.hypot(xn - 0.82, yn - 0.18) * 1.75)
            glow = clamp(1.0 - math.hypot(xn - 0.22, yn - 0.08) * 2.2)
            rr = int(7 + 13 * diag + 13 * radial + 5 * glow)
            gg = int(31 + 68 * diag + 48 * radial + 20 * glow)
            bb = int(73 + 102 * diag + 50 * radial + 20 * glow)
            row[x * 4:x * 4 + 4] = bytes((min(rr, 255), min(gg, 255), min(bb, 255), int(255 * a)))

    # Soft inner light and bottom depth.
    draw_circle(img, n * 0.83, n * 0.19, n * 0.28, (74, 177, 255, 42))
    draw_circle(img, n * 0.50, n * 1.02, n * 0.58, (0, 7, 28, 58))

    # Ticket card hint.
    draw_rounded_rect(img, n * 0.205, n * 0.645, n * 0.535, n * 0.835, n * 0.038, (255, 255, 255, 226))
    draw_rounded_rect(img, n * 0.228, n * 0.675, n * 0.340, n * 0.807, n * 0.022, (255, 138, 0, 235))
    draw_rounded_rect(img, n * 0.370, n * 0.694, n * 0.495, n * 0.718, n * 0.010, (20, 86, 154, 150))
    draw_rounded_rect(img, n * 0.370, n * 0.748, n * 0.472, n * 0.772, n * 0.010, (20, 86, 154, 122))

    # Route curve.
    draw_bezier_route(
        img,
        (n * 0.285, n * 0.670),
        (n * 0.455, n * 0.430),
        (n * 0.770, n * 0.308),
        n * 0.030,
        (255, 176, 54, 230),
    )

    # Plane silhouette with subtle shadow.
    plane_local = [
        (0.36, 0.00), (0.09, 0.045), (-0.025, 0.235), (-0.105, 0.235),
        (-0.064, 0.052), (-0.325, 0.070), (-0.390, 0.175), (-0.465, 0.175),
        (-0.430, 0.018), (-0.465, -0.175), (-0.390, -0.175), (-0.325, -0.070),
        (-0.064, -0.052), (-0.105, -0.235), (-0.025, -0.235), (0.09, -0.045),
    ]
    center = (n * 0.565, n * 0.462)
    shadow_poly = transform_plane(plane_local, (center[0] + n * 0.018, center[1] + n * 0.025), n * 0.68, -28)
    draw_polygon(img, shadow_poly, (0, 9, 30, 74))
    plane_poly = transform_plane(plane_local, center, n * 0.68, -28)
    draw_polygon(img, plane_poly, (255, 255, 255, 248))

    # Small blue cockpit accent.
    cockpit = transform_plane([(0.18, -0.012), (0.27, 0), (0.18, 0.012), (0.135, 0)], center, n * 0.68, -28)
    draw_polygon(img, cockpit, (32, 132, 213, 118))

    return img


def downsample(img: list[bytearray], out_size: int) -> list[bytearray]:
    in_size = len(img)
    scale = in_size // out_size
    out = new_canvas(out_size)
    for y in range(out_size):
        row = out[y]
        for x in range(out_size):
            acc = [0, 0, 0, 0]
            for yy in range(y * scale, (y + 1) * scale):
                src = img[yy]
                for xx in range(x * scale, (x + 1) * scale):
                    i = xx * 4
                    for c in range(4):
                        acc[c] += src[i + c]
            denom = scale * scale
            row[x * 4:x * 4 + 4] = bytes(int(v / denom + 0.5) for v in acc)
    return out


def png_bytes(img: list[bytearray]) -> bytes:
    h = len(img)
    w = len(img[0]) // 4
    raw = b''.join(b'\x00' + bytes(row) for row in img)
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def write_png(path: Path, img: list[bytearray]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes(img))


def write_ico(path: Path, images: dict[int, bytes]) -> None:
    sizes = sorted(images.keys(), reverse=True)
    header = struct.pack('<HHH', 0, 1, len(sizes))
    entries = bytearray()
    offset = 6 + 16 * len(sizes)
    payload = bytearray()
    for size in sizes:
        data = images[size]
        width_byte = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', width_byte, width_byte, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + entries + payload)


def main() -> None:
    master = create_master()
    pngs: dict[int, bytes] = {}
    for size in (16, 24, 32, 48, 64, 128, 256):
        resized = downsample(master, size)
        pngs[size] = png_bytes(resized)
        write_png(ROOT / 'build' / f'icon-{size}.png', resized)
    write_png(ROOT / 'public' / 'app-icon.png', downsample(master, 256))
    write_png(ROOT / 'build' / 'icon.png', downsample(master, 512))
    write_ico(ROOT / 'build' / 'icon.ico', pngs)
    print('Generated build/icon.ico and public/app-icon.png')


if __name__ == '__main__':
    main()
