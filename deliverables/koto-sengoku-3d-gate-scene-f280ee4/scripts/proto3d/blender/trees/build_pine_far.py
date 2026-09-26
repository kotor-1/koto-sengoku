"""
遠景用の黒松（tree_pine_far.glb）。塀の向こう（城内）と町家の裏の木立に使う、三角形 6000 以下の軽い版。
    /root/blender-venv/bin/python proto3d/blender/trees/build_pine_far.py [--no-preview]
- 幹: 根は作らない（根元の張りは輪の形のゆがみだけ）。少し曲がりながら上へ伸び、上の 5 割に枝
- 葉: 手入れされていない松の、不揃いな雲の形の塊。カードは tree_pine より大きく（0.8〜1.05 m）数を減らし、1 つの網にまとめる
- 材質は tree_pine と同じ画像（pine_bark / pine_needles）。奥と下は頂点色（体積の遮蔽）で暗く
幹の根元が原点、上が +Y（ゲーム）。置き場所（FAR_PLACES）と幹の当たり判定は trees.meta.json へ。
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from treelib import (UP, Density, Geo, MODELS_DIR, PREVIEW_DIR, card, catmull, clearance, ensure_textures, export_glb,  # noqa: E402
                     make_object, mat_bark, mat_cards, point_at, reset, resample, rotate, smooth_normals, smoothstep, tex,
                     triangles, tube, unit, update_meta, volume_ao)

SEED = 23
BARK_TILE = (0.8, 0.8)
LEAN = unit(np.array([0.35, 0.2, 0.0]))
# 置き場所（ゲームの座標 x, z、向き rotation.y、大きさ）：西の土塀の向こう（城内）に 3 本、町家 A の裏に 1 本
FAR_PLACES = [
    (-9.2, -16.8, 0.4, 0.95),
    (-14.0, -17.0, 2.9, 1.02),
    (-5.8, -21.5, 4.4, 0.9),
    (-16.4, -3.0, 1.3, 0.97),
]
# 主な枝：幹の高さ z、方位（度）、長さ、出だしの仰角（度）
LIMBS = [
    (4.5, 20, 3.0, 10), (4.8, 145, 2.7, 14), (5.2, 262, 2.9, 10), (5.6, 330, 2.5, 16),
    (6.0, 95, 2.6, 16), (6.4, 205, 2.6, 12), (6.8, 300, 2.3, 18), (7.1, 50, 2.2, 14),
    (7.5, 165, 2.0, 18), (7.9, 240, 1.9, 16), (8.3, 5, 1.7, 20), (8.7, 120, 1.5, 20),
    (9.1, 290, 1.3, 22), (9.5, 200, 1.1, 24),
]


def cell_uv(c, pad=0.006):
    col, row = c % 2, c // 2
    u0 = col * 0.5
    v1 = 1.0 - row * 0.5
    return (u0 + pad, v1 - 0.5 + pad, u0 + 0.5 - pad, v1 - pad)


def build(preview=True):
    ensure_textures()
    reset()
    rng = np.random.default_rng(SEED)
    bark = Geo()
    leaves = Geo()

    # ---- 幹 ----
    ctrl = [(0, 0, -0.25), (0, 0, 0.0), (0.08, 0.04, 2.4), (0.34, -0.06, 4.8), (0.6, 0.12, 7.2), (0.55, 0.22, 9.3), (0.48, 0.2, 10.0)]
    trunk = catmull([np.array(c) + LEAN * 0.2 * c[2] / 10 for c in ctrl], 0.38)
    tz = trunk[:, 2]
    f = np.clip(tz / tz.max(), 0, 1)
    radii = 0.27 * (1 - f) ** 0.8 + 0.035 + 0.14 * np.exp(-np.maximum(tz, 0) / 0.35)
    lob_p = np.sort(rng.uniform(0, 2 * math.pi, 5))
    lob_w = rng.uniform(0.4, 0.9, 5)

    def trunk_shape(i, th):
        z = tz[i]
        a = 0.7 * math.exp(-max(z, 0.0) / 0.3)
        lob = sum(w * np.maximum(0, np.cos(th - p)) ** 6 for p, w in zip(lob_p, lob_w))
        return 1 + a * lob + 0.05 * np.sin(3 * th + 0.8 * z)

    tube(bark, trunk, radii, 10, BARK_TILE, rfunc=trunk_shape, tag=0)

    def trunk_r(z):
        return float(np.interp(z, tz, radii))

    # ---- 枝と葉の塊 ----
    pads = []   # (中心, 半径 (a, b, c), 回転 R)

    def branch_path(p0, azv, L, e0, droop=-8.0, lift=26.0):
        n = max(5, int(L / 0.3))
        pts = [p0.copy()]
        p = p0.copy()
        for i in range(n):
            t = (i + 0.5) / n
            e = math.radians(e0 + (droop - e0) * smoothstep(0, 0.5, t) + lift * smoothstep(0.6, 1.0, t))
            azv = rotate(azv, UP, math.radians(rng.normal(0, 9)))
            p = p + (azv * math.cos(e) + UP * math.sin(e)) * L / n
            pts.append(p.copy())
        return resample(np.array(pts), 0.34)

    def hor(v):
        h = v - UP * v[2]
        return unit(h) if np.linalg.norm(h) > 1e-3 else LEAN.copy()

    def add_pad(end, hdir, size, tilt=9.0):
        x = hor(hdir)
        R = np.stack([x, np.cross(UP, x), UP], 1)
        ax = unit(rng.normal(0, 1, 3))
        a = math.radians(rng.normal(0, tilt))
        R = np.stack([rotate(R[:, k], ax, a) for k in range(3)], 1)
        a_, b_, c_ = size
        pads.append((end + x * a_ * 0.18 + UP * c_ * 0.4, np.array(size), R))

    for zb, az, L, e0 in LIMBS:
        zb += rng.normal(0, 0.1)
        L *= rng.uniform(0.9, 1.1)
        i = int(np.argmin(np.abs(tz - zb)))
        azv = np.array([math.cos(math.radians(az + rng.normal(0, 8))), math.sin(math.radians(az + rng.normal(0, 8))), 0.0])
        path = branch_path(trunk[i].copy(), azv, L, e0)
        t = np.linspace(0, 1, len(path))
        br = 0.42 * trunk_r(zb) * (1 - 0.8 * t ** 0.9)
        tube(bark, path, br, 5, BARK_TILE, tag=1)
        end, edir = point_at(path, 1.0)
        k = rng.uniform(0.85, 1.15)
        add_pad(end, edir, (k * (0.85 + 0.17 * L), k * (0.75 + 0.14 * L), 0.42 + 0.05 * L))
        if L > 2.0:
            # 長い枝は途中にも塊、脇へ 1 本の小枝と小さな塊
            q, qd = point_at(path, 0.55)
            add_pad(q + UP * 0.1, qd, (0.8, 0.7, 0.36))
            q, qd = point_at(path, rng.uniform(0.35, 0.7))
            sv = rotate(hor(qd), UP, math.radians(rng.choice([-1, 1]) * rng.uniform(45, 80)))
            sp = branch_path(q, sv, rng.uniform(0.8, 1.3), 10, droop=-4.0, lift=16.0)
            tube(bark, sp, float(np.interp(0.5, t, br)) * 0.6 * (1 - 0.7 * np.linspace(0, 1, len(sp))), 3, BARK_TILE, tag=1)
            se, sd = point_at(sp, 1.0)
            add_pad(se, sd, (0.75, 0.65, 0.34))
    top = trunk[-1]
    pads.append((top + UP * 0.15, np.array([1.1, 0.95, 0.5]), np.eye(3)))

    # ---- 松葉のカード（大きめ・少なめ） ----
    card_info = []
    for pi, (center, rad, R) in enumerate(pads):
        a, b, c = rad
        p_ = 1.6075
        area = 4 * math.pi * (((a * b) ** p_ + (a * c) ** p_ + (b * c) ** p_) / 3) ** (1 / p_)
        n = int(area * 6.6)
        for k in range(n):
            u = rng.random()
            cphi = rng.uniform(0.3, 1.0) if u < 0.5 else (rng.uniform(-0.35, 0.35) if u < 0.85 else rng.uniform(-1.0, -0.3))
            th = rng.uniform(0, 2 * math.pi)
            sphi = math.sqrt(max(0.0, 1 - cphi * cphi))
            d = np.array([sphi * math.cos(th), sphi * math.sin(th), cphi])
            p = center + R @ (d * rad * rng.uniform(0.62, 0.98))
            ne = unit(R @ (d / rad))
            hout = unit(R @ np.array([d[0], d[1], 0.0]) + 1e-6)
            if cphi > 0.55 and rng.random() < 0.3:
                m = unit(ne + rng.normal(0, 0.35, 3))
                sdir = unit(np.cross(m, rng.normal(0, 1, 3)))
                L = rng.uniform(0.8, 1.0)
                card(leaves, p, sdir, np.cross(sdir, m), L, L, cell_uv(3), bulge=0, flip=rng.random() < 0.5, tag=pi, center=True)
                card_info.append((p, L * L * 0.45))
            else:
                m = unit(ne + rng.normal(0, 0.5, 3))
                if np.dot(m, ne) < 0.25:
                    m = unit(m + ne)
                g = unit(hout * 0.8 + UP * 0.55 + rng.normal(0, 0.22, 3))
                sdir = g - m * np.dot(g, m)
                sdir = unit(sdir) if np.linalg.norm(sdir) > 0.15 else unit(np.cross(m, rng.normal(0, 1, 3)))
                L = rng.uniform(0.8, 1.05)
                W = L * rng.uniform(0.85, 1.0)
                base = p - sdir * L * 0.42
                card(leaves, base, sdir, np.cross(sdir, m), L, W, cell_uv(int(rng.integers(0, 3))), bulge=0, flip=rng.random() < 0.5, tag=pi)
                card_info.append((base + sdir * L * 0.5, L * W * 0.38))

    # ---- 陰と法線 ----
    Vb, UVb, Fb, _, _ = bark.arrays()
    Vl, UVl, Fl, Ml, Tl = leaves.arrays()
    lo = np.minimum(Vb.min(0), Vl.min(0))
    hi = np.maximum(Vb.max(0), Vl.max(0))
    dens = Density(lo, hi, 0.3)
    dens.splat(np.array([c for c, _ in card_info]), np.array([a for _, a in card_info]))
    dens.finish(g_factor=0.5, blur=1)
    pid = Tl.astype(int)
    C = np.array([p[0] for p in pads])[pid]
    RAD = np.array([p[1] for p in pads])[pid]
    RR = np.array([p[2] for p in pads])[pid]
    loc = np.einsum('nji,nj->ni', RR, Vl - C)
    grad = np.einsum('nij,nj->ni', RR, loc / RAD ** 2)
    Nl = unit(0.25 * Ml + 0.55 * unit(grad) + 0.55 * UP)
    Nb = smooth_normals(Vb, Fb, bark.seams)
    ao_l = volume_ao(Vl, Nl, dens, k=24, max_d=3.5, t0=0.08, up_bias=0.5)
    ao_b = volume_ao(Vb, Nb, dens, k=24, max_d=3.5, t0=0.05, up_bias=0.3, ground_dist=1.2)
    tint = 1 + rng.normal(0, 0.035, (len(pads), 3))
    col_l = tint[pid] * (0.5 + 0.5 * ao_l[:, None] ** 0.8)
    col_b = np.repeat((0.36 + 0.64 * ao_b)[:, None], 3, 1)

    m_bark = mat_bark('pine_bark', tex('pine_bark', '_albedo'), tex('pine_bark', '_normal'), rough=0.92, nstrength=1.0)
    m_leaf = mat_cards('pine_needles', tex('pine_needles'), rough=0.78, cutoff=0.42)
    ob_b = make_object('pine_far_trunk', Vb, UVb, Fb, m_bark, normals=Nb, color=col_b)
    ob_l = make_object('pine_far_needles', Vl, UVl, Fl, m_leaf, normals=Nl, color=col_l)
    tris = triangles([ob_b, ob_l])
    size = export_glb(MODELS_DIR / 'tree_pine_far.glb', [ob_b, ob_l])
    print(f'tree_pine_far: {tris} tris ({triangles([ob_b])} bark, {triangles([ob_l])} needles), {len(pads)} pads, {len(card_info)} cards, {size / 1e6:.2f} MB')
    for x, z, rot, sc in FAR_PLACES:
        print(f'  clearance ({x}, {z}):', clearance(np.concatenate([Vb, Vl]), (x, z), rot, sc) or 'ok')

    # ---- 情報と当たり判定（ゲームの座標） ----
    # 置き場所はどれも歩ける所（城内の空き地・町家の裏）なので、幹の当たり判定とカメラ除けの箱を書く（layout.ts が読む）
    r1 = trunk_r(1.0)
    zl = Vl[:, 2]
    colliders, blockers = [], []
    for x, z, rot, sc in FAR_PLACES:
        h = round(0.3 * sc, 2)
        colliders.append({'x0': round(x - h, 2), 'x1': round(x + h, 2), 'z0': round(z - h, 2), 'z1': round(z + h, 2)})
        hb = round(0.36 * sc, 2)
        blockers.append({'x0': round(x - hb, 2), 'x1': round(x + hb, 2), 'y0': 0.0, 'y1': 3.0, 'z0': round(z - hb, 2), 'z1': round(z + hb, 2)})
    update_meta({
        'tree_pine_far': {
            'glb': 'models/tree_pine_far.glb',
            'trunk_radius_at_1m': round(r1, 3),
            'height': round(float(max(zl.max(), Vb[:, 2].max())), 2),
            'canopy_y': [round(float(np.percentile(zl, 1)), 2), round(float(zl.max()), 2)],
            'canopy_radius': round(float(np.max(np.linalg.norm(Vl[:, :2], axis=1))), 2),
            'triangles': tris,
            'placements': [{'x': x, 'z': z, 'rotation_y': rot, 'scale': sc} for x, z, rot, sc in FAR_PLACES],
            'note': '遠景用の軽い黒松。placements の位置に、幹の根元を原点として置く（rotation.y・scale）。'
                    '当たり判定（上の colliders・camera_blockers）はこの 4 か所の幹だけ。',
        },
        'colliders': colliders,
        'camera_blockers': blockers,
    })
    if preview:
        from treelib import emulate_threejs_ambient, preview_setup, render_game
        preview_setup()
        emulate_threejs_ambient()
        render_game(PREVIEW_DIR / 'tree_pine_far-sky.png', (-6.5, 1.7, 13.0), (0.2, 5.4, 0.0), samples=24)
    return ob_b, ob_l


if __name__ == '__main__':
    build(preview='--no-preview' not in sys.argv)
