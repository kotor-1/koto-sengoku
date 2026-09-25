"""
黒松（tree_pine.glb）を作る。
    /root/blender-venv/bin/python proto3d/blender/trees/build_pine.py [--no-preview]
- 幹: 西（道の側）へ傾き S 字に曲がる。根張り（輪の形のゆがみ）と地面へ潜る根。亀甲状の樹皮（画像＋法線）
- 枝: 水平に張り、途中で垂れて先が上がる。折れ曲がりを入れる。先の小枝で葉の塊（雲のような段）を支える
- 葉: 松葉の束のカード（4 種）を扁平な楕円体の表面に沿って多数。塊ごとに丸く陰影が付く法線、奥と下は頂点色で暗く
幹の根元が原点、上が +Y（ゲーム）。当たり判定の半径などは trees.meta.json へ。
"""
from __future__ import annotations

import math
import sys

import numpy as np

sys.path.insert(0, __import__('os').path.dirname(__file__))
from treelib import (UP, Density, blocker, clearance, Geo, MODELS_DIR, PREVIEW_DIR, arc_length, card, catmull, ensure_textures, export_glb,  # noqa: E402
                     make_object, mat_bark, mat_cards, point_at, render_preview, reset, resample, rotate, smooth_normals,
                     smoothstep, tex, triangles, tube, unit, volume_ao, write_meta, TEX, TEX_VERSION)

SEED = 7
BARK_TILE = (0.8, 0.8)
LEAN = unit(np.array([-0.93, -0.36, 0.0]))      # 西（道の側）・少し南へ傾く
SIDE = np.array([-LEAN[1], LEAN[0], 0.0])

# 主な枝：幹の高さ z、傾きの向きからの方位（度）、長さ、出だしの仰角（度）
BRANCHES = [
    # 1 段目（塀の笠より上で、道の側へ長く張る）
    (4.7, 95, 3.1, 14),
    (5.0, -72, 2.8, 18),
    (5.2, 18, 3.8, 16),
    # 2 段目
    (6.2, 168, 2.3, 20),
    (6.4, 122, 2.7, 14),
    (6.6, -38, 2.8, 12),
    # 3 段目
    (7.6, -118, 2.3, 14),
    (7.8, 56, 2.1, 12),
    (8.0, 176, 1.7, 18),
    # 4 段目
    (8.6, -160, 1.6, 16),
    (8.8, 100, 1.4, 12),
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
    def LS(l, s, z):
        return LEAN * l + SIDE * s + UP * z

    ctrl = [LS(*c) for c in [(0, 0, -0.35), (0, 0, 0.0), (0.06, 0.08, 1.4), (0.36, 0.02, 3.0), (0.95, -0.16, 4.3), (1.55, 0.02, 5.6),
                              (1.9, 0.28, 6.9), (2.02, 0.22, 8.1), (1.92, 0.06, 9.2), (1.8, 0.0, 9.85)]]
    trunk = catmull(ctrl, 0.2)
    wig = np.cumsum(rng.normal(0, 0.012, (len(trunk), 3)), 0)
    wig[:, 2] = 0
    wig -= np.linspace(0, 1, len(trunk))[:, None] * wig[-1]
    trunk += wig * smoothstep(0.5, 2.0, trunk[:, 2])[:, None]
    s = arc_length(trunk)
    Ltr = s[-1]
    tz = trunk[:, 2]

    def trunk_r(z):
        f = np.clip(np.interp(z, tz, s) / Ltr, 0, 1)
        return 0.29 * (1 - f) ** 0.85 + 0.05 + 0.22 * np.exp(-np.maximum(z, 0) / 0.4)

    radii = trunk_r(tz)
    radii[-1] = 0.03
    lobes_phi = np.sort(rng.uniform(0, 2 * math.pi, 6))
    lobes_w = rng.uniform(0.45, 0.95, 6)
    ph = rng.uniform(0, 6.28, 3)

    def trunk_shape(i, th):
        z = tz[i]
        a = 0.95 * math.exp(-max(z, 0.0) / 0.32)
        lob = sum(w * np.maximum(0, np.cos(th - p)) ** 8 for p, w in zip(lobes_phi, lobes_w))
        gn = 0.07 * np.sin(2 * th + 0.7 * z + ph[0]) + 0.04 * np.sin(5 * th + 1.9 * z + ph[1]) + 0.03 * np.sin(3 * th - 1.3 * z + ph[2])
        return 1 + a * lob + gn

    tube(bark, trunk, radii, 20, BARK_TILE, rfunc=trunk_shape, tag=0)

    # 地面へ潜る根（根張りの向きに）
    T0 = unit(trunk[1] - trunk[0])
    from treelib import perp
    N0 = perp(T0)
    B0 = np.cross(T0, N0)
    for p, w in zip(lobes_phi, lobes_w):
        d = math.cos(p) * N0 + math.sin(p) * B0
        d = unit(d - UP * d[2])
        ln = 1.0 + 0.9 * w
        d2 = rotate(d, UP, rng.normal(0, 0.25))
        rp = catmull([UP * 0.45 + d * 0.1, UP * 0.2 + d * 0.55, d * 0.5 + d2 * ln * 0.5 + UP * 0.02, d2 * ln - UP * 0.1, d2 * (ln + 0.35) - UP * 0.4], 0.2)
        t = np.linspace(0, 1, len(rp))
        tube(bark, rp, 0.19 * w * (1 - t) ** 0.9 + 0.03, 8, BARK_TILE, tag=0)

    # ---- 枝と葉の塊 ----
    pads = []   # (中心, 半径 (a,b,c), 回転 R, 根元の点)

    def branch_path(p0, azv, L, e0, droop=-10.0, lift=22.0):
        n = max(6, int(L / 0.14))
        pts = [p0.copy()]
        p = p0.copy()
        kinks = set(rng.choice(np.arange(2, n - 1), size=min(2, n - 3), replace=False).tolist())
        for i in range(n):
            t = (i + 0.5) / n
            e = math.radians(e0 + (droop - e0) * smoothstep(0, 0.5, t) + lift * smoothstep(0.62, 1.0, t))
            if i in kinks:
                azv = rotate(azv, UP, math.radians(rng.uniform(-28, 28)))
            azv = rotate(azv, UP, math.radians(rng.normal(0, 4)))
            d = azv * math.cos(e) + UP * math.sin(e)
            p = p + d * L / n
            pts.append(p.copy())
        return resample(np.array(pts), 0.2)

    def hor(v):
        h = v - UP * v[2]
        return unit(h) if np.linalg.norm(h) > 1e-3 else LEAN.copy()

    def pad_frame(hdir, tilt=6.0):
        x = hor(hdir)
        y = np.cross(UP, x)
        R = np.stack([x, y, UP], 1)
        ax = unit(rng.normal(0, 1, 3))
        a = math.radians(rng.normal(0, tilt))
        Rr = np.stack([rotate(R[:, k], ax, a) for k in range(3)], 1)
        return Rr

    def add_pad(end, hdir, size):
        a, b, c = size
        R = pad_frame(hdir)
        center = end + hor(hdir) * a * 0.22 + UP * c * 0.45
        pads.append((center, np.array([a, b, c]), R, end.copy()))

    for (zb, az, L, e0) in BRANCHES:
        zb += rng.normal(0, 0.08)
        L *= rng.uniform(0.92, 1.08)
        i = int(np.argmin(np.abs(tz - zb)))
        p0 = trunk[i].copy()
        azv = rotate(LEAN, UP, math.radians(az + rng.normal(0, 6)))
        path = branch_path(p0, azv, L, e0)
        t = np.linspace(0, 1, len(path))
        r0 = 0.46 * float(trunk_r(zb))
        br = r0 * (1 - 0.82 * t ** 0.9)
        tube(bark, path, br, 7, BARK_TILE, tag=1)
        end, edir = point_at(path, 1.0)
        add_pad(end, edir, (1.0 + 0.14 * L, 0.88 + 0.11 * L, 0.36 + 0.035 * L))
        if L > 2.6:
            # 長い枝は途中の上にも塊（横に長い雲の形）
            q, qd = point_at(path, 0.58)
            add_pad(q + UP * 0.12, qd, (0.8, 0.62, 0.3))
        # 脇の小枝（先に小さな塊）
        fr = sorted(rng.choice([0.42, 0.55, 0.68, 0.8, 0.9], size=4 if L > 2.6 else 3, replace=False))
        sgn = 1 if rng.random() < 0.5 else -1
        for f in fr:
            q, qd = point_at(path, f)
            sgn = -sgn
            hv = unit(qd - UP * qd[2])
            sv = rotate(hv, UP, sgn * math.radians(rng.uniform(42, 78)))
            Ls = (0.45 + 0.55 * (1 - f)) * rng.uniform(0.8, 1.2) * min(L, 3.0) * 0.55 + 0.35
            sp = branch_path(q, sv, Ls, rng.uniform(4, 16), droop=-6.0, lift=18.0)
            ts = np.linspace(0, 1, len(sp))
            rb = float(np.interp(f, t, br)) * 0.62
            tube(bark, sp, rb * (1 - 0.75 * ts), 5, BARK_TILE, tag=1)
            se, sd = point_at(sp, 1.0)
            k = rng.uniform(0.85, 1.1)
            add_pad(se, sd, (0.74 * k + 0.1 * Ls, 0.66 * k + 0.08 * Ls, 0.31 * k))

    # 頂上の塊
    top = trunk[-1]
    tdir = unit(trunk[-1] - trunk[-4])
    pads.append((top + UP * 0.12, np.array([1.3, 1.1, 0.46]), pad_frame(LEAN, 4), top.copy()))
    for k in range(3):
        hv = rotate(LEAN, UP, k * 2.1 + rng.uniform(-0.3, 0.3))
        q = top - UP * rng.uniform(0.5, 0.9) - tdir * 0.0
        sp = branch_path(q, hv, rng.uniform(0.8, 1.2), 14, droop=-4, lift=10)
        tube(bark, sp, 0.05 * (1 - 0.7 * np.linspace(0, 1, len(sp))), 5, BARK_TILE, tag=1)
        se, sd = point_at(sp, 1.0)
        add_pad(se, sd, (0.9, 0.78, 0.34))

    # 塊の中の小枝（下から見たときの骨組み）
    for center, rad, R, root in pads:
        for k in range(rng.integers(2, 5)):
            ang = rng.uniform(0, 2 * math.pi)
            hv = R[:, 0] * math.cos(ang) + R[:, 1] * math.sin(ang)
            ln = rng.uniform(0.45, 0.85) * rad[0]
            e = math.radians(rng.uniform(4, 16))
            st = root + (center - root) * 0.25
            en = center - UP * rad[2] * 0.3 + hv * ln
            mid = (st + en) / 2 + UP * math.sin(e) * ln * 0.3 + rng.normal(0, 0.05, 3)
            tp = catmull([st, mid, en], 0.5)
            tube(bark, tp, np.linspace(0.024, 0.006, len(tp)), 3, BARK_TILE, tag=2)

    # ---- 松葉のカード ----
    card_info = []   # (カードの中心, 不透明な面積)
    owner = []       # カードの頂点がどの塊か
    # 置き場所（pine_big・門の北の pine_back）で塀・門の屋根にかかるカードは省く（塊の端が少し欠けるだけ）
    blocked = blocker([((10.8, -7.5), 0.0, 1.0), ((-4.8, -18.5), 2.2, 0.9)], margin=0.4)
    for pi, (center, rad, R, root) in enumerate(pads):
        a, b, c = rad
        p_ = 1.6075
        area = 4 * math.pi * (((a * b) ** p_ + (a * c) ** p_ + (b * c) ** p_) / 3) ** (1 / p_)
        n = int(area * 13.0)
        for k in range(n):
            u = rng.random()
            cphi = rng.uniform(0.3, 1.0) if u < 0.46 else (rng.uniform(-0.35, 0.35) if u < 0.82 else rng.uniform(-1.0, -0.3))
            th = rng.uniform(0, 2 * math.pi)
            sphi = math.sqrt(max(0.0, 1 - cphi * cphi))
            d = np.array([sphi * math.cos(th), sphi * math.sin(th), cphi])
            q = d * rad * rng.uniform(0.7, 1.0)
            p = center + R @ q
            ne = unit(R @ (d / rad))
            hout = unit(R @ np.array([d[0], d[1], 0.0]) + 1e-6)
            if blocked(p):
                continue
            if cphi > 0.5 and rng.random() < 0.3:
                m = unit(ne + rng.normal(0, 0.35, 3))
                sdir = unit(np.cross(m, rng.normal(0, 1, 3)))
                w = np.cross(sdir, m)
                L = rng.uniform(0.55, 0.78)
                card(leaves, p, sdir, w, L, L, cell_uv(3), bulge=0.1, flip=rng.random() < 0.5, tag=pi, center=True)
                cc = p
                opaque = L * L * 0.45
            else:
                m = unit(ne + rng.normal(0, 0.55, 3))
                if np.dot(m, ne) < 0.25:
                    m = unit(m + ne)
                g = unit(hout * 0.8 + UP * 0.55 + rng.normal(0, 0.22, 3))
                sdir = g - m * np.dot(g, m)
                sdir = unit(sdir) if np.linalg.norm(sdir) > 0.15 else unit(np.cross(m, rng.normal(0, 1, 3)))
                w = np.cross(sdir, m)
                L = rng.uniform(0.5, 0.74)
                W = L * rng.uniform(0.85, 1.0)
                base = p - sdir * L * 0.42
                card(leaves, base, sdir, w, L, W, cell_uv(int(rng.integers(0, 3))), bulge=0.14, flip=rng.random() < 0.5, tag=pi)
                cc = base + sdir * L * 0.5
                opaque = L * W * 0.38
            card_info.append((cc, opaque))

    # ---- 陰（体積の遮蔽）と法線 ----
    Vb, UVb, Fb, _, Tb = bark.arrays()
    Vl, UVl, Fl, Ml, Tl = leaves.arrays()
    lo = np.minimum(Vb.min(0), Vl.min(0))
    hi = np.maximum(Vb.max(0), Vl.max(0))
    dens = Density(lo, hi, 0.25)
    cc = np.array([c for c, _ in card_info])
    ar = np.array([a for _, a in card_info])
    dens.splat(cc, ar)
    dens.finish(g_factor=0.5, blur=1)

    # 葉の法線：カードの向きと、塊の中心から外への向きを混ぜる（塊が丸く陰影を持つ）
    pid = Tl.astype(int)
    C = np.array([p[0] for p in pads])[pid]
    RAD = np.array([p[1] for p in pads])[pid]
    RR = np.array([p[2] for p in pads])[pid]
    loc = np.einsum('nji,nj->ni', RR, Vl - C)
    grad = np.einsum('nij,nj->ni', RR, loc / RAD ** 2)
    # 下向きの面も空の光を受けるよう、法線を上へ寄せる（葉を透かす光の代わり）
    Nl = unit(0.25 * Ml + 0.55 * unit(grad) + 0.55 * UP)
    Nb = smooth_normals(Vb, Fb, bark.seams)

    ao_l = volume_ao(Vl, Nl, dens, k=24, max_d=3.5, t0=0.08, up_bias=0.5)
    ao_b = volume_ao(Vb, Nb, dens, k=24, max_d=3.5, t0=0.05, up_bias=0.3, ground_dist=1.2)
    tint = 1 + rng.normal(0, 0.035, (len(pads), 3))
    tint[:, 0] += rng.normal(0, 0.03, len(pads))
    col_l = tint[pid] * (0.5 + 0.5 * ao_l[:, None] ** 0.8)
    col_b = np.repeat((0.36 + 0.64 * ao_b)[:, None], 3, 1)

    m_bark = mat_bark('pine_bark', TEX / f'pine_bark_{TEX_VERSION}_albedo.png', TEX / f'pine_bark_{TEX_VERSION}_normal.png', rough=0.92, nstrength=1.0)
    m_leaf = mat_cards('pine_needles', tex('pine_needles'), rough=0.78, cutoff=0.42)
    ob_b = make_object('pine_trunk', Vb, UVb, Fb, m_bark, normals=Nb, color=col_b)
    ob_l = make_object('pine_needles', Vl, UVl, Fl, m_leaf, normals=Nl, color=col_l)

    tris = triangles([ob_b, ob_l])
    out = MODELS_DIR / 'tree_pine.glb'
    size = export_glb(out, [ob_b, ob_l])
    print(f'tree_pine: {tris} tris ({triangles([ob_b])} bark, {triangles([ob_l])} needles), {len(pads)} pads, {len(card_info)} cards, {size / 1e6:.2f} MB')

    # 場面の塀・門・町家にめり込まないか（配置どおりに置いて数える）
    for nm, pos, rot, sc in [('pine_big', (10.8, -7.5), 0.0, 1.0), ('pine_back', (-4.8, -18.5), 2.2, 0.9)]:
        print(f'  clearance {nm}: bark', clearance(Vb, pos, rot, sc) or 'ok', 'needles', clearance(Vl, pos, rot, sc) or 'ok')
    # ---- 当たり判定などの情報（ゲームの座標） ----
    zl = Vl[:, 2]
    write_meta('tree_pine', {
        'glb': 'models/tree_pine.glb',
        'trunk_collider_radius': 0.42,
        'trunk_radius_at_1m': round(float(trunk_r(1.0)), 3),
        'root_flare_radius': round(float(np.max(np.linalg.norm(Vb[Vb[:, 2] < 0.3][:, :2], axis=1))), 2),
        'height': round(float(max(Vl[:, 2].max(), Vb[:, 2].max())), 2),
        'canopy_y': [round(float(np.percentile(zl, 1)), 2), round(float(zl.max()), 2)],
        'canopy_extent_xz': {'x': [round(float(Vl[:, 0].min()), 2), round(float(Vl[:, 0].max()), 2)],
                             'z': [round(float(-Vl[:, 1].max()), 2), round(float(-Vl[:, 1].min()), 2)]},
        'lean_toward_game_xz': [round(float(LEAN[0]), 2), round(float(-LEAN[1]), 2)],
        'triangles': tris,
    })
    if preview:
        from treelib import emulate_threejs_ambient, preview_setup, render_game
        preview_setup()
        emulate_threejs_ambient()
        P = PREVIEW_DIR
        render_game(P / 'tree_pine-near.png', (-3.2, 1.7, 7.4), (-1.1, 4.8, 0.2), samples=24)
        render_game(P / 'tree_pine-sky.png', (-7.5, 1.7, 13.0), (-1.2, 5.6, 0.4), samples=24)
        render_game(P / 'tree_pine-under.png', (-2.5, 1.6, 3.2), (-1.4, 6.0, -0.5), samples=24)
    return ob_b, ob_l


if __name__ == '__main__':
    build(preview='--no-preview' not in sys.argv)
