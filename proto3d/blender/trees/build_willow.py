"""
通りの柳（tree_willow28.glb）。Version 28 の町の木の 1 つ（木戸の外・荷置き場の隅。置き場所は street28.json の trees）。
    /root/blender-venv/bin/python proto3d/blender/trees/build_willow.py [--no-preview]
- 幹: 低い所（2.3〜3.0 m）で太い枝 5 本に分かれる、少し傾いてこぶのある幹。枝は上へ伸びてから外へ弓なりに曲がる
- 葉: 枝垂れ柳の細い枝の束を、垂れ下がるカードで（枝の外の 7 割から 0.25 m ごとに 2〜3 枚、長さ 1.0〜2.4 m、地面から 1.1 m より下へは垂れない）。
  画像は plants.glb と同じ草の画像（textures.py の plants の grass_a の区画：細い葉の束。根元を枝の側にして、先を下へ）。新しい画像は作らない
- 材質は tree_pine と同じ樹皮の画像（pine_bark。頂点色で少し灰色に）と、plants の画像。奥と下は頂点色（体積の遮蔽）で暗く
幹の根元が原点、上が +Y（ゲーム）。幹の当たり判定はゲームの layout.ts（street28.json の trees の trunk）。
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from treelib import (UP, Density, Geo, MODELS_DIR, PREVIEW_DIR, card, catmull, ensure_textures, export_glb, make_object,  # noqa: E402
                     mat_bark, mat_cards, point_at, reset, resample, rotate, smooth_normals, smoothstep, tex, triangles, tube, unit,
                     update_meta, volume_ao)

SEED = 41
BARK_TILE = (0.8, 0.8)
LEAN = unit(np.array([0.3, -0.25, 0.0]))
# 葉の区画（textures.py の PLANT_CELLS の grass_a・grass_b。v は画像の下から）
CELL_A = (0.0 + 0.004, 0.5 + 0.004, 1 / 3 - 0.004, 1.0 - 0.004)
CELL_B = (1 / 3 + 0.004, 0.5 + 0.004, 2 / 3 - 0.004, 1.0 - 0.004)
# 主な枝：分かれる高さ、方位（度）、長さ、出だしの仰角（度）
LIMBS = [(2.3, 15, 3.2, 44), (2.45, 80, 3.0, 50), (2.6, 140, 3.3, 42), (2.75, 200, 3.1, 48), (2.9, 262, 3.0, 46), (3.05, 320, 3.2, 44),
         (3.25, 110, 2.2, 66), (3.3, 290, 2.1, 68)]
LOW = 1.15        # 垂れる葉の先の、地面からの高さの下限（m）


def build(preview=True):
    ensure_textures()
    reset()
    rng = np.random.default_rng(SEED)
    bark = Geo()
    leaves = Geo()

    # ---- 幹 ----
    ctrl = [(0, 0, -0.25), (0, 0, 0.0), (0.06, -0.04, 1.0), (0.2, -0.12, 2.0), (0.3, -0.2, 2.9), (0.32, -0.22, 3.4)]
    trunk = catmull([np.array(c) for c in ctrl], 0.3)
    tz = trunk[:, 2]
    f = np.clip(tz / tz.max(), 0, 1)
    radii = 0.25 * (1 - 0.55 * f) + 0.12 * np.exp(-np.maximum(tz, 0) / 0.3)
    lob_p = np.sort(rng.uniform(0, 2 * math.pi, 6))
    lob_w = rng.uniform(0.3, 0.8, 6)

    def trunk_shape(i, th):
        z = tz[i]
        a = 0.55 * math.exp(-max(z, 0.0) / 0.35) + 0.12
        lob = sum(w * np.maximum(0, np.cos(th - p)) ** 4 for p, w in zip(lob_p, lob_w))
        return 1 + a * lob + 0.06 * np.sin(5 * th + 1.7 * z)

    tube(bark, trunk, radii, 10, BARK_TILE, rfunc=trunk_shape, tag=0)

    def trunk_at(z):
        i = int(np.argmin(np.abs(tz - z)))
        return trunk[i].copy(), float(radii[i])

    # ---- 枝（上へ伸びてから外へ弓なりに）と、垂れる葉の付け根 ----
    hangs = []     # (付け根の点, 外向き, 重み)

    def limb(p0, az, L, e0, r0, depth=0):
        azv = np.array([math.cos(math.radians(az)), math.sin(math.radians(az)), 0.0])
        n = max(6, int(L / 0.22))
        pts = [p0.copy()]
        p = p0.copy()
        for i in range(n):
            t = (i + 0.5) / n
            e = math.radians(e0 + (-25 - e0) * smoothstep(0.25, 1.0, t))
            azv = rotate(azv, UP, math.radians(rng.normal(0, 6)))
            p = p + (azv * math.cos(e) + UP * math.sin(e)) * L / n
            pts.append(p.copy())
        path = resample(np.array(pts), 0.22)
        t = np.linspace(0, 1, len(path))
        tube(bark, path, r0 * (1 - 0.82 * t ** 0.8), 6 if depth == 0 else 4, BARK_TILE, tag=1)
        # 垂れる葉の付け根（枝の外の 7 割）
        for k in range(len(path)):
            if t[k] < 0.22:
                continue
            hangs.append((path[k], unit(np.array([azv[0], azv[1], 0.0])), 1.0 if depth == 0 else 0.8))
        if depth == 0:
            for _ in range(2 + int(rng.random() < 0.5)):
                q, qd = point_at(path, rng.uniform(0.35, 0.75))
                a2 = math.degrees(math.atan2(qd[1], qd[0])) + rng.choice([-1, 1]) * rng.uniform(35, 70)
                limb(q, a2, L * rng.uniform(0.45, 0.65), rng.uniform(25, 45), r0 * 0.45, depth=1)

    for zb, az, L, e0 in LIMBS:
        p0, r = trunk_at(zb + rng.normal(0, 0.05))
        limb(p0, az + rng.normal(0, 6), L * rng.uniform(0.92, 1.08), e0, r * 0.55)

    # ---- 垂れる葉のカード ----
    card_info = []
    for (p, out, w) in hangs:
        for j in range(2 + int(rng.random() < 0.7 * w) + int(rng.random() < 0.4 * w)):
            top = p + rng.normal(0, 0.06, 3) + UP * rng.uniform(-0.05, 0.08)
            room = top[2] - LOW
            if room < 0.4:
                continue
            ln = min(room, rng.uniform(1.5, 3.0) * w)
            # 少し外へ、少し揺れて垂れる
            s = unit(-UP + out * rng.uniform(0.05, 0.22) + rng.normal(0, 0.08, 3) * np.array([1, 1, 0]))
            yaw = rng.uniform(0, 2 * math.pi)
            wd = np.array([math.cos(yaw), math.sin(yaw), 0.0])
            wd = unit(wd - s * np.dot(wd, s))
            W = rng.uniform(0.26, 0.38)
            card(leaves, top, s, wd, ln, W, CELL_A if rng.random() < 0.75 else CELL_B, bulge=0.1, flip=rng.random() < 0.5, tag=0)
            card_info.append((top + s * ln * 0.5, ln * W * 0.35))
    # 樹冠の上（枝の背の上の短い弓なりのカード：上から見て穴が空かないように）
    for (p, out, w) in hangs[::3]:
        s = unit(out * 0.8 - UP * 0.35 + rng.normal(0, 0.15, 3))
        m = unit(np.cross(s, rng.normal(0, 1, 3)))
        wd = unit(np.cross(m, s))
        ln = rng.uniform(0.5, 0.8)
        card(leaves, p + UP * 0.05, s, wd, ln, ln * 0.6, CELL_A, bulge=0.12, flip=rng.random() < 0.5, tag=1)
        card_info.append((p + s * ln * 0.5, ln * ln * 0.25))

    # ---- 陰と法線 ----
    Vb, UVb, Fb, _, _ = bark.arrays()
    Vl, UVl, Fl, Ml, Tl = leaves.arrays()
    lo = np.minimum(Vb.min(0), Vl.min(0))
    hi = np.maximum(Vb.max(0), Vl.max(0))
    dens = Density(lo, hi, 0.3)
    dens.splat(np.array([c for c, _ in card_info]), np.array([a for _, a in card_info]))
    dens.finish(g_factor=0.55, blur=1)
    centre = np.array([0.35, -0.2, 2.6])
    radial = unit((Vl - centre) * np.array([1, 1, 0.4]))
    Nl = unit(0.3 * Ml + 0.6 * radial + 0.45 * UP)
    Nb = smooth_normals(Vb, Fb, bark.seams)
    ao_l = volume_ao(Vl, Nl, dens, k=24, max_d=3.0, t0=0.08, up_bias=0.4)
    ao_b = volume_ao(Vb, Nb, dens, k=24, max_d=3.0, t0=0.05, up_bias=0.3, ground_dist=1.2)
    # 葉：柳の明るい黄緑（草の画像の緑に掛ける）。先の方は少し明るい
    hf = np.clip((Vl[:, 2] - LOW) / 3.0, 0, 1)
    tint = np.array([0.98, 1.0, 0.72])
    col_l = tint[None, :] * (0.66 + 0.34 * ao_l[:, None] ** 0.8) * (0.94 + 0.06 * (1 - hf))[:, None]
    # 幹：松の樹皮の画像を灰色寄りに
    col_b = np.repeat((0.36 + 0.64 * ao_b)[:, None], 3, 1) * np.array([0.9, 0.88, 0.84])[None, :]

    m_bark = mat_bark('pine_bark', tex('pine_bark', '_albedo'), tex('pine_bark', '_normal'), rough=0.92, nstrength=1.0)
    m_leaf = mat_cards('plants', tex('plants'), rough=0.8, cutoff=0.42, spec=0.3)
    ob_b = make_object('willow_trunk', Vb, UVb, Fb, m_bark, normals=Nb, color=col_b)
    ob_l = make_object('willow_leaves', Vl, UVl, Fl, m_leaf, normals=Nl, color=col_l)
    tris = triangles([ob_b, ob_l])
    size = export_glb(MODELS_DIR / 'tree_willow28.glb', [ob_b, ob_l])
    rad = float(np.max(np.linalg.norm(Vl[:, :2], axis=1)))
    print(f'tree_willow28: {tris} tris ({triangles([ob_b])} bark, {triangles([ob_l])} leaves), {len(card_info)} cards, '
          f'canopy r {rad:.2f}, {size / 1e6:.2f} MB')
    r1 = float(np.interp(1.0, tz, radii))
    update_meta({'tree_willow28': {
        'glb': 'models/tree_willow28.glb',
        'trunk_radius_at_1m': round(r1, 3),
        'height': round(float(max(Vl[:, 2].max(), Vb[:, 2].max())), 2),
        'canopy_y': [round(float(Vl[:, 2].min()), 2), round(float(Vl[:, 2].max()), 2)],
        'canopy_radius': round(rad, 2),
        'triangles': tris,
        'note': 'Version 28 の通りの柳。置き場所・幹の当たり判定は street28.json の trees（layout.ts）。葉は plants と同じ画像（草の区画）。',
    }})
    if preview:
        from treelib import emulate_threejs_ambient, preview_setup, render_game
        preview_setup()
        emulate_threejs_ambient()
        render_game(PREVIEW_DIR / 'tree_willow28-side.png', (0.0, 2.0, 9.5), (0.2, 2.6, 0.0), samples=24)
        render_game(PREVIEW_DIR / 'tree_willow28-near.png', (3.2, 1.6, 4.0), (0.3, 2.4, 0.0), samples=24)
    return ob_b, ob_l


if __name__ == '__main__':
    build(preview='--no-preview' not in sys.argv)
