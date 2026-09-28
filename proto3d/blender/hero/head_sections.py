"""
頭の SDF の断面（デバッグ用）：真ん中の縦の断面（横顔の線）と、高さごとの横の断面を重ねた図。1cm の格子つき。
    python3 proto3d/blender/hero/head_sections.py <out.png>
"""
from __future__ import annotations

import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import numpy as np
from PIL import Image, ImageDraw

import anatomy as A

PX = 3.0 / 0.001      # 1mm = 3px
fn = lambda P: A.body(P.astype(np.float32), ['neck', 'head'])


def outline(sign, color, img, ox, oy):
    s = sign
    e = np.zeros_like(s)
    e[:-1] |= s[:-1] != s[1:]
    e[:, :-1] |= s[:, :-1] != s[:, 1:]
    ys, xs = np.nonzero(e)
    px = img.load()
    for y, x in zip(ys, xs):
        px[int(ox + x), int(oy + y)] = color


def panel_profile(img, ox, oy, w, h, x=0.0):
    zs = np.linspace(-.13, .14, w)
    ys = np.linspace(1.78, 1.46, h)
    Z, Y = np.meshgrid(zs, ys)
    P = np.column_stack([np.full(Z.size, x), Y.ravel(), Z.ravel()])
    d = fn(P).reshape(h, w)
    outline(d < 0, (220, 60, 40) if x == 0 else (60, 120, 220), img, ox, oy)
    return zs, ys


LEVELS = [(1.690, (120, 120, 120)), (1.656, (200, 40, 40)), (1.632, (40, 140, 40)), (1.612, (40, 40, 200)),
          (1.592, (200, 120, 0)), (1.567, (160, 0, 160)), (1.548, (0, 150, 150)), (1.528, (90, 60, 20))]


def panel_levels(img, ox, oy, w, h):
    xs = np.linspace(-.11, .11, w)
    zs = np.linspace(.14, -.13, h)
    X, Z = np.meshgrid(xs, zs)
    for y, col in LEVELS:
        P = np.column_stack([X.ravel(), np.full(X.size, y), Z.ravel()])
        d = fn(P).reshape(h, w)
        outline(d < 0, col, img, ox, oy)


def grid(dr, ox, oy, w, h, lo_u, lo_v, du, dv, flip_v=True):
    for k in range(-20, 40):
        u = ox + (k * 0.01 - lo_u) * PX
        if ox <= u < ox + w:
            dr.line([(u, oy), (u, oy + h)], fill=(225, 225, 225) if k % 5 else (190, 190, 190))
    for k in range(140, 185):
        v = oy + (lo_v - k * 0.01) * PX
        if oy <= v < oy + h:
            dr.line([(ox, v), (ox + w, v)], fill=(225, 225, 225) if k % 5 else (190, 190, 190))


def main():
    out = sys.argv[1]
    w1, h1 = int(.27 * PX), int(.32 * PX)
    w2, h2 = int(.22 * PX), int(.27 * PX)
    img = Image.new('RGB', (w1 + w2 + 30, max(h1, h2) + 20), (255, 255, 255))
    dr = ImageDraw.Draw(img)
    grid(dr, 10, 10, w1, h1, -.13, 1.78, 0, 0)
    # 横の断面の格子（x と z）
    for k in range(-11, 12):
        u = w1 + 20 + (k * 0.01 + .11) * PX
        dr.line([(u, 10), (u, 10 + h2)], fill=(225, 225, 225) if k else (170, 170, 170))
    for k in range(-13, 15):
        v = 10 + (.14 - k * 0.01) * PX
        dr.line([(w1 + 20, v), (w1 + 20 + w2, v)], fill=(225, 225, 225) if k else (170, 170, 170))
    panel_profile(img, 10, 10, w1, h1, 0.0)
    panel_profile(img, 10, 10, w1, h1, 0.031)     # 目の中心を通る縦の断面
    panel_levels(img, w1 + 20, 10, w2, h2)
    # 高さの目印
    for y, col in LEVELS:
        v = 10 + (1.78 - y) * PX
        dr.line([(10, v), (30, v)], fill=col, width=2)
    # 眼球
    for s in (1,):
        c = A.EYE_C
        u = 10 + (c[2] + .13) * PX
        v = 10 + (1.78 - c[1]) * PX
        r = A.EYE_R * PX
        dr.ellipse([u - r, v - r, u + r, v + r], outline=(0, 160, 0))
    img.save(out)
    print('saved', out)


if __name__ == '__main__':
    main()
