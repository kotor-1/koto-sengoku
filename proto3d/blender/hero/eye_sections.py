"""
目のまわりの断面（デバッグ用）：横の断面（目の中心の高さ・上下）と縦の断面（目頭側・中心・目じり側）を 1mm 格子つきで。
    python3 proto3d/blender/hero/eye_sections.py <out.png>
"""
from __future__ import annotations

import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import numpy as np
from PIL import Image, ImageDraw

import anatomy as A
import head_form as HF

S = 8   # px/mm
fn = lambda P: A.body(P.astype(np.float32), ['head'])
C = HF.EYE_C


def panel(img, ox, oy, u_rng, v_rng, make, cols):
    w = int((u_rng[1] - u_rng[0]) * 1000 * S)
    h = int((v_rng[1] - v_rng[0]) * 1000 * S)
    dr = ImageDraw.Draw(img)
    for k in range(int(u_rng[0] * 1000), int(u_rng[1] * 1000) + 1):
        x = ox + (k / 1000 - u_rng[0]) * 1000 * S
        dr.line([(x, oy), (x, oy + h)], fill=(235, 235, 235) if k % 10 else (180, 180, 180))
    for k in range(int(v_rng[0] * 1000), int(v_rng[1] * 1000) + 1):
        y = oy + (v_rng[1] - k / 1000) * 1000 * S
        dr.line([(ox, y), (ox + w, y)], fill=(235, 235, 235) if k % 10 else (180, 180, 180))
    us = np.linspace(u_rng[0], u_rng[1], w)
    vs = np.linspace(v_rng[1], v_rng[0], h)
    U, Vv = np.meshgrid(us, vs)
    for m, col in zip(make, cols):
        P = m(U.ravel(), Vv.ravel())
        d = fn(P).reshape(h, w)
        s = d < 0
        e = np.zeros_like(s)
        e[:-1] |= s[:-1] != s[1:]
        e[:, :-1] |= s[:, :-1] != s[:, 1:]
        ys, xs = np.nonzero(e)
        px = img.load()
        for y, x in zip(ys, xs):
            px[int(ox + x), int(oy + y)] = col
    return w, h


def main():
    img = Image.new('RGB', (1800, 1000), 'white')
    # 横の断面（上から見る：u = x、v = z）
    lv = [(C[1] + .005, (200, 0, 0)), (C[1], (0, 150, 0)), (C[1] - .005, (0, 0, 220)), (C[1] + .010, (200, 120, 0))]
    mk = [(lambda y: (lambda u, v: np.column_stack([u, np.full(u.size, y), v])))(y) for y, _ in lv]
    w, h = panel(img, 10, 10, (-.002, .072), (.035, .115), mk, [c for _, c in lv])
    dr = ImageDraw.Draw(img)
    cx = 10 + (C[0] + .002) * 1000 * S
    cz = 10 + (.115 - C[2]) * 1000 * S
    r = HF.EYE_R * 1000 * S
    dr.ellipse([cx - r, cz - r, cx + r, cz + r], outline=(120, 120, 120))
    # 縦の断面（横から見る：u = z、v = y）
    xs = [(C[0] - .009, (200, 0, 0)), (C[0], (0, 150, 0)), (C[0] + .009, (0, 0, 220)), (C[0] + .015, (200, 120, 0))]
    mk = [(lambda x: (lambda u, v: np.column_stack([np.full(u.size, x), v, u])))(x) for x, _ in xs]
    ox = 10 + w + 20
    w2, h2 = panel(img, ox, 10, (.035, .115), (1.595, 1.675), mk, [c for _, c in xs])
    cz = ox + (C[2] - .035) * 1000 * S
    cy = 10 + (1.675 - C[1]) * 1000 * S
    dr.ellipse([cz - r, cy - r, cz + r, cy + r], outline=(120, 120, 120))
    img = img.crop((0, 0, ox + w2 + 10, max(h, h2) + 20))
    img.save(sys.argv[1])
    print('saved', sys.argv[1])


if __name__ == '__main__':
    main()
