"""
桜（tree_sakura.glb）を作る。染井吉野の成木：低い幹が太い枝に分かれて横へ大きく広がる、傘のような樹冠。
    /root/blender-venv/bin/python proto3d/blender/trees/build_sakura.py [--no-preview]
- 幹と枝: 5 段（幹・大枝・枝・小枝・細い枝先）を樹冠の外形（非対称の楕円体）に向けて伸ばす。暗い樹皮に横長の皮目
- 細い枝先: 太さ 5〜12 mm から先細りする、1 回曲がった枝先（花の房の隙間から見える暗い線）
- 花: 淡い色の小さな房のカード（0.25〜0.45 m、4 種）。枝先の点から外へ向け、傾きは ±40° でばらつかせる。
  房の画像の小枝の根元を枝先に合わせる。縁は画像のノイズで不揃いに透ける。自ら光らせない
- 法線: 房の中心（枝先の少し内側）から外への向きと、樹冠の外形の向きを混ぜる（塊が柔らかく陰影を持つ）
- 置き場所に合わせて、北（塀の上・+Y）へ広く、南（町家 A の側・-Y）は狭い。東（道の側）は門の左の柱に掛からない程度
幹の根元が原点、上が +Y（ゲーム）。
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from treelib import (UP, Density, blocker, clearance, Geo, MODELS_DIR, PREVIEW_DIR, arc_length, card, catmull,  # noqa: E402
                     ensure_textures, export_glb, make_object, mat_bark, mat_cards, perp, point_at, render_preview, reset,
                     resample, rotate, smooth_normals, smoothstep, tex, triangles, tube, unit, volume_ao, write_meta)

SEED = 11
BARK_TILE = (0.6, 0.6)
# 樹冠の外形：中心と、向きごとの半径（+X, -X, +Y, -Y, +Z, -Z）
ENV_C = np.array([0.8, 0.4, 5.0])
ENV_R = np.array([4.3, 4.2, 4.1, 3.0, 2.9, 2.6])
PLACE = [((-7.4, -9.2), 0.0, 1.0)]   # scene.json の sakura（回さずに置く）
# 大枝：幹の高さ、方位（+X から左回り、度）、鉛直からの傾き（度）、長さ、根元の半径
LIMBS = [
    (1.70, 6, 64, 4.7, 0.17),       # 東（道の側）へ
    (1.90, 100, 12, 4.6, 0.15, 0.08),     # 北：塀の笠より上まで立ち上がる（子の枝が塀の上へ）
    (1.80, 196, 64, 4.8, 0.155),    # 西
    (1.60, 292, 56, 3.4, 0.13),     # 南東（町家 A の側は短く）
    (2.05, 44, 34, 4.6, 0.15),      # 北東へ立ち上がる
    (2.00, 238, 42, 4.0, 0.13),     # 南西へ立ち上がる
    (2.10, 150, 10, 3.8, 0.12, 0.1),      # 中央の立ち枝（樹冠の上を埋める）
]


ENV_P = 2.6   # 超楕円体の指数（2 より大きいと肩が張った傘の形）


def env_val(p):
    """外形の中で 1 未満（非対称の超楕円体）"""
    d = np.asarray(p, np.float64) - ENV_C
    rx = np.where(d[..., 0] >= 0, ENV_R[0], ENV_R[1])
    ry = np.where(d[..., 1] >= 0, ENV_R[2], ENV_R[3])
    rz = np.where(d[..., 2] >= 0, ENV_R[4], ENV_R[5])
    h = np.sqrt((d[..., 0] / rx) ** 2 + (d[..., 1] / ry) ** 2)
    return (h ** ENV_P + np.abs(d[..., 2] / rz) ** ENV_P) ** (1 / ENV_P)


def env_normal(p):
    """外形の外向き（数値微分）"""
    p = np.asarray(p, np.float64)
    e = 0.02
    g = np.stack([env_val(p + np.array(v) * e) - env_val(p - np.array(v) * e) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], -1)
    return unit(g)


def env_dist(p, d):
    """p から d の向きへ、外形の外に出るまでの距離（おおよそ）"""
    t = 0.0
    inside = env_val(p) <= 1.0
    while t < 8.0:
        v = env_val(p + d * t)
        if inside and v > 1.0:
            return t
        inside = inside or v <= 1.0
        t += 0.1
    return 8.0 if inside else 0.6


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
    fl = Geo()
    # 置き場所の塀・門の屋根・町家 A に枝がめり込まないように（そこで伸びるのを止める＝剪定された形）
    blocked = blocker(PLACE, margin=0.3)
    branches = []   # (点の列, 半径の列, 段)

    # ---- 幹 ----
    trunk = catmull([(0, 0, -0.35), (0, 0, 0), (0.06, 0.02, 0.8), (0.16, 0.06, 1.45), (0.24, 0.08, 2.1)], 0.15)
    tz = trunk[:, 2]
    rtr = 0.27 + 0.03 * (1 - smoothstep(0, 2.1, tz)) + 0.2 * np.exp(-np.maximum(tz, 0) / 0.35)
    lob_p = np.sort(rng.uniform(0, 2 * math.pi, 7))
    lob_w = rng.uniform(0.4, 0.9, 7)
    ph = rng.uniform(0, 6.28, 3)

    def trunk_shape(i, th):
        z = tz[i]
        a = 0.9 * math.exp(-max(z, 0.0) / 0.3)
        lob = sum(w * np.maximum(0, np.cos(th - p)) ** 6 for p, w in zip(lob_p, lob_w))
        # 幹の上は大枝の分かれ目で太くふくらむ
        top = 0.22 * smoothstep(1.5, 2.1, z) * (np.maximum(0, np.cos(th - 0.2)) ** 2 + np.maximum(0, np.cos(th - 2.0)) ** 2 + np.maximum(0, np.cos(th - 3.6)) ** 2)
        gn = 0.06 * np.sin(2 * th + 1.1 * z + ph[0]) + 0.04 * np.sin(4 * th - 2.3 * z + ph[1]) + 0.03 * np.sin(7 * th + 0.5 * z + ph[2])
        return 1 + a * lob + top + gn

    tube(bark, trunk, rtr, 20, BARK_TILE, rfunc=trunk_shape, tag=0)
    T0 = unit(trunk[1] - trunk[0])
    N0 = perp(T0)
    B0 = np.cross(T0, N0)
    for p, w in zip(lob_p, lob_w):
        d = unit(math.cos(p) * N0 + math.sin(p) * B0)
        d = unit(d - UP * d[2])
        ln = 0.8 + 0.7 * w
        rp = catmull([UP * 0.4 + d * 0.08, UP * 0.15 + d * 0.5, d * ln - UP * 0.08, d * (ln + 0.3) - UP * 0.35], 0.2)
        t = np.linspace(0, 1, len(rp))
        tube(bark, rp, 0.16 * w * (1 - t) ** 0.9 + 0.025, 8, BARK_TILE, tag=0)

    # ---- 枝を伸ばす ----
    def grow(p0, d0, length, step, outward=0.25, droop=0.0, lift=0.0, noise=0.12, stop=1.0):
        pts = [p0.copy()]
        p = p0.copy()
        d = unit(d0)
        n = max(2, int(math.ceil(length / step)))
        prev = env_val(p)
        for i in range(n):
            t = (i + 0.5) / n
            h = unit(p - ENV_C) * np.array([1, 1, 0])
            d = unit(d + (h * outward - UP * droop * t + UP * lift * t * t) * step + rng.normal(0, noise, 3) * step)
            p = p + d * length / n
            if blocked(p):
                break
            pts.append(p.copy())
            v = env_val(p)
            if v > stop and v > prev:
                break
            prev = v
        return np.array(pts)

    def children(path, radii, level, spacing, ang_rng, len_fn, r_ratio, t0=0.18, t1=0.97):
        """枝 path から子の枝を出す"""
        s = arc_length(path)
        L = s[-1]
        out = []
        pos = t0 * L + rng.uniform(0, spacing)
        roll = rng.uniform(0, 2 * math.pi)
        while pos < t1 * L:
            f = pos / L
            p, tan = point_at(path, f)
            roll += math.radians(137.5 + rng.normal(0, 20))
            ax = rotate(perp(tan), tan, roll)
            ang = math.radians(rng.uniform(*ang_rng))
            d = rotate(tan, ax, ang)
            if d[2] < -0.25:
                # 下向きは避ける（反対へ倒す）
                d = rotate(tan, ax, -ang)
            if d[2] < -0.25:
                d = unit(d + UP * 0.5)
            ln = len_fn(p, d, f)
            if ln > 0.12 and not blocked(p + d * 0.15):
                rr = float(np.interp(pos, s, radii)) * r_ratio
                out.append((p, d, ln, rr))
            pos += spacing * rng.uniform(0.75, 1.3)
        return out

    L1 = []
    for limb in LIMBS:
        zb, az, tilt, L, r0 = limb[:5]
        outw = limb[5] if len(limb) > 5 else 0.5
        i = int(np.argmin(np.abs(tz - zb)))
        p0 = trunk[i].copy()
        azv = np.array([math.cos(math.radians(az)), math.sin(math.radians(az)), 0.0])
        d0 = azv * math.sin(math.radians(tilt)) + UP * math.cos(math.radians(tilt))
        path = resample(grow(p0, d0, L, 0.25, outward=outw, droop=0.3 if outw > 0.3 else 0.0, lift=0.25, noise=0.18, stop=0.97), 0.24)
        t = np.linspace(0, 1, len(path))
        rad = r0 * (1 - 0.8 * t ** 0.8) + 0.012
        tube(bark, path, rad, 8, BARK_TILE, tag=1)
        L1.append((path, rad))
        branches.append((path, rad, 1))

    L2 = []
    for path, rad in L1:
        for p, d, ln, rr in children(path, rad, 2, 0.5, (32, 55), lambda p, d, f: min(3.0, env_dist(p, d) * rng.uniform(0.6, 0.95)), 0.62, t0=0.22):
            g = grow(p, d, ln, 0.22, outward=0.3, droop=0.1, lift=0.35, noise=0.2)
            if len(g) < 2:
                continue
            sp = resample(g, 0.25)
            t = np.linspace(0, 1, len(sp))
            r = rr * (1 - 0.75 * t) + 0.006
            tube(bark, sp, r, 5, BARK_TILE, tag=2)
            L2.append((sp, r))
            branches.append((sp, r, 2))

    L3 = []
    for path, rad in L2 + [(pp, rr) for pp, rr in L1]:
        for p, d, ln, rr in children(path, rad, 3, 0.32, (30, 52), lambda p, d, f: min(1.3, env_dist(p, d) * rng.uniform(0.5, 0.95)), 0.6, t0=0.3):
            g = grow(p, d, ln, 0.2, outward=0.2, droop=0.05, lift=0.5, noise=0.3)
            if len(g) < 2:
                continue
            sp = resample(g, 0.36)
            t = np.linspace(0, 1, len(sp))
            r = rr * (1 - 0.7 * t) + 0.004
            tube(bark, sp, r, 3, BARK_TILE, tag=3)
            L3.append((sp, r))
            branches.append((sp, r, 3))

    # ---- 細い枝先（先細りの 5〜12 mm、途中で 1 回曲がる。花の房の隙間から見える） ----
    L4 = []
    for path, rad in L3:
        for p, d, ln, rr in children(path, rad, 4, 0.2, (28, 58), lambda p, d, f: rng.uniform(0.28, 0.6), 0.6, t0=0.2, t1=1.0):
            o = unit(env_normal(p) * 0.6 + UP * 0.4)
            mid = p + d * ln * 0.5 + rng.normal(0, 0.015, 3)
            d2 = unit(d + o * 0.45 + rng.normal(0, 0.18, 3))
            end = mid + d2 * ln * 0.5
            if blocked(mid) or blocked(end):
                continue
            r0 = float(np.clip(rr, 0.005, 0.012))
            sp = np.array([p, mid, end])
            tube(bark, sp, np.array([r0, r0 * 0.6, 0.0022]), 3, BARK_TILE, tag=4)
            L4.append(sp)
            branches.append((sp, None, 4))

    # ---- 花の房のカード ----
    card_info = []   # (カードの中心, 不透明な面積)
    clump_c = []     # カードごとの房の中心（法線の向きの元）
    TILT = math.radians(40)

    def clump(p, tan, size_rng, pair=0.35):
        """枝先の点 p に房のカードを 1〜2 枚。画像の小枝の根元（下の中央）を p に置き、外へ向けて伸ばす"""
        o = unit(env_normal(p) * 0.7 + UP * 0.3 + tan * 0.25)
        s0 = unit(tan * 0.55 + o * 0.45 + UP * 0.15)
        m0 = o - s0 * np.dot(o, s0)
        m0 = unit(m0) if np.linalg.norm(m0) > 0.1 else perp(s0)
        c = p - o * 0.15
        n = 2 if rng.random() < pair else 1
        roll0 = rng.uniform(-TILT, TILT)
        for k in range(n):
            L = rng.uniform(*size_rng)
            # 表の向き：外向きから ±40°（2 枚目は 1 枚目から 60〜100° 回して房に厚みを）
            roll = roll0 if k == 0 else roll0 + math.copysign(math.radians(rng.uniform(60, 100)), rng.uniform(-1, 1))
            m = rotate(m0, s0, roll)
            s = rotate(s0, m, rng.uniform(-0.45, 0.45))
            m = rotate(m, unit(np.cross(s, m)), rng.uniform(-0.3, 0.3))
            s = unit(s - m * np.dot(s, m))
            if blocked(p + s * L) or blocked(p + s * L * 0.5):
                continue
            w = np.cross(s, m)
            u = rng.random()
            cell = 0 if u < 0.3 else (1 if u < 0.55 else (2 if u < 0.8 else 3))
            card(fl, p - s * L * 0.04, s, w, L, L, cell_uv(cell), bulge=0, flip=rng.random() < 0.5)
            card_info.append((p + s * L * 0.5, L * L * 0.14))
            clump_c.append(c)

    def along(path, step, prob_fn, size_rng, pair=0.35):
        s = arc_length(path)
        pos = rng.uniform(0, step)
        while pos < s[-1]:
            p, tan = point_at(path, pos / s[-1])
            if not blocked(p) and rng.random() < prob_fn(p, pos / s[-1]):
                clump(p, tan, size_rng, pair)
            pos += step * rng.uniform(0.7, 1.3)

    for sp in L4:
        along(sp, 0.1, lambda p, f: 0.65 + 0.35 * smoothstep(0.35, 0.8, env_val(p)), (0.25, 0.45))
        clump(sp[-1], unit(sp[-1] - sp[-2]), (0.28, 0.45), pair=0.5)
    for sp, _ in L3:
        along(sp, 0.15, lambda p, f: 0.2 + 0.8 * smoothstep(0.35, 0.85, env_val(p)) * (0.4 + 0.6 * f), (0.25, 0.42))
    for sp, _ in L2:
        along(sp, 0.3, lambda p, f: 0.6 * smoothstep(0.55, 0.9, env_val(p)) * f, (0.3, 0.45), pair=0.2)

    # ---- 陰と法線 ----
    Vb, UVb, Fb, _, Tb = bark.arrays()
    Vf, UVf, Ff, Mf, _ = fl.arrays()
    lo = np.minimum(Vb.min(0), Vf.min(0))
    hi = np.maximum(Vb.max(0), Vf.max(0))
    dens = Density(lo, hi, 0.3)
    dens.splat(np.array([c for c, _ in card_info]), np.array([a for _, a in card_info]))
    dens.finish(g_factor=0.5, blur=1)
    nfc = len(card_info)
    nvc = len(Vf) // nfc
    Cf = np.repeat(np.array(clump_c), nvc, 0)
    Nf = unit(0.2 * Mf + 0.35 * unit(Vf - Cf) + 0.6 * env_normal(Vf) + 0.25 * UP)
    Nb = smooth_normals(Vb, Fb, bark.seams)
    ao_f = volume_ao(Vf, Nf, dens, k=24, max_d=4.0, t0=0.08, up_bias=0.5)
    ao_b = volume_ao(Vb, Nb, dens, k=24, max_d=4.0, t0=0.04, up_bias=0.3, ground_dist=1.2)
    # 房ごとの明るさの揺らぎ（色みは変えない。わずかに白い房と桃色の房）
    lum = np.clip(rng.normal(1.0, 0.05, (nfc, 1)), 0.88, 1.1)
    hue = rng.normal(0, 0.02, (nfc, 1)) * np.array([[0.0, -1.0, -0.5]])
    tint = np.repeat(np.clip(lum * (1 + hue), 0, 1.1), nvc, 0)
    col_f = tint * (0.58 + 0.42 * ao_f[:, None] ** 0.8)
    col_b = np.repeat((0.34 + 0.66 * ao_b)[:, None], 3, 1)

    m_bark = mat_bark('sakura_bark', tex('sakura_bark', '_albedo'), tex('sakura_bark', '_normal'), rough=0.72, nstrength=0.9)
    m_fl = mat_cards('sakura_blossom', tex('sakura_blossom'), rough=0.75, cutoff=0.42, spec=0.3, glow=0.0)
    ob_b = make_object('sakura_trunk', Vb, UVb, Fb, m_bark, normals=Nb, color=col_b)
    ob_f = make_object('sakura_blossom', Vf, UVf, Ff, m_fl, normals=Nf, color=col_f)
    tris = triangles([ob_b, ob_f])
    size = export_glb(MODELS_DIR / 'tree_sakura.glb', [ob_b, ob_f])
    print(f'tree_sakura: {tris} tris ({triangles([ob_b])} bark, {triangles([ob_f])} blossom), {len(card_info)} cards, '
          f'branches L1 {len(L1)} L2 {len(L2)} L3 {len(L3)} L4 {len(L4)}, {size / 1e6:.2f} MB')

    print('  clearance sakura:', clearance(np.concatenate([Vb, Vf]), (-7.4, -9.2)) or 'ok')
    zf = Vf[:, 2]
    write_meta('tree_sakura', {
        'glb': 'models/tree_sakura.glb',
        'trunk_collider_radius': 0.4,
        'trunk_radius_at_1m': round(float(np.interp(1.0, tz, rtr)), 3),
        'root_flare_radius': round(float(np.max(np.linalg.norm(Vb[Vb[:, 2] < 0.3][:, :2], axis=1))), 2),
        'height': round(float(max(zf.max(), Vb[:, 2].max())), 2),
        'canopy_y': [round(float(np.percentile(zf, 1)), 2), round(float(zf.max()), 2)],
        'canopy_extent_xz': {'x': [round(float(Vf[:, 0].min()), 2), round(float(Vf[:, 0].max()), 2)],
                             'z': [round(float(-Vf[:, 1].max()), 2), round(float(-Vf[:, 1].min()), 2)]},
        'note': '北（塀の上）へ広く、東（道の側）は門の左の柱の手前まで、南（町家 A の側）は狭い。回転させずに置く前提の形。',
        'triangles': tris,
    })
    if preview:
        from treelib import BUILD_DIR as BUILD, emulate_threejs_ambient, preview_setup, render_game
        preview_setup()
        emulate_threejs_ambient()
        P = PREVIEW_DIR
        render_game(P / 'tree_sakura-near.png', (-1.5, 1.7, 8.0), (0.3, 4.2, -0.4), samples=24)
        render_game(P / 'tree_sakura-sky.png', (2.0, 1.7, 13.5), (0.5, 4.3, -0.4), samples=24)
        # 空が樹冠を透ける割合：開始の画面のカメラの位置（木の根元からの相対）と、南から
        from treelib import sky_gap
        T = BUILD / 'trees'
        sky_gap(T / 'gap-sakura-gamecam.png', (8.45, 1.9, 14.0), (0.8, 5.0, -0.4))
        sky_gap(T / 'gap-sakura-south.png', (0.8, 1.7, 13.5), (0.8, 4.8, -0.4))
    return ob_b, ob_f


if __name__ == '__main__':
    build(preview='--no-preview' not in sys.argv)
