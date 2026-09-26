"""
低い草木の部品（plants.glb）を作る。名前の付いた別々の網で、地面の組み立てで複製して並べる。
    /root/blender-venv/bin/python proto3d/blender/trees/build_plants.py [--no-preview]
- grass_a: 短い草の株 / grass_b: 穂の出た背の高い草 / grass_c: 広い葉の低い雑草
- 草・しだは片面の材質＋裏向きの面を重ねる（裏から見ても上向きの法線のまま明るい）
- shrub_azalea: 刈り込んだつつじの丸い株（葉のカードを丸い塊の表面に。少し花） / shrub_fern: しだの株（弓なりに垂れる葉）
どれも原点が株の根元（地面）、上が +Y（ゲーム）。材質は 1 つ（草の画像、アルファで切り抜き・両面）。
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from treelib import (UP, Density, Geo, MODELS_DIR, PREVIEW_DIR, card, ensure_textures, export_glb, make_object,  # noqa: E402
                     mat_cards, reset, tex, triangles, unit, volume_ao, write_meta)

SEED = 21
# 草の画像の区画（u0, v0, u1, v1。textures.py の PLANT_CELLS と同じ）
CELLS = {
    'grass_a': (0.0, 0.5, 1 / 3, 1.0),
    'grass_b': (1 / 3, 0.5, 2 / 3, 1.0),
    'grass_c': (2 / 3, 0.5, 1.0, 1.0),
    'azalea': (0.0, 0.0, 0.5, 0.5),
    'fern': (0.5, 0.0, 1.0, 0.5),
}


def inset(c, pad=0.004):
    return (c[0] + pad, c[1] + pad, c[2] - pad, c[3] - pad)


def grass(rng, cell, n, h_rng, spread, lean=(8, 32)):
    """草の株：株の中心から外へ少し傾いたカードを放射状に（互いに斜めに交わる）"""
    geo = Geo()
    aspect = (cell[2] - cell[0]) / (cell[3] - cell[1])
    for k in range(n):
        az = k / n * 2 * math.pi + rng.uniform(-0.35, 0.35)
        out = np.array([math.cos(az), math.sin(az), 0.0])
        h = rng.uniform(*h_rng)
        w = h * aspect * rng.uniform(0.9, 1.15)
        tilt = math.radians(rng.uniform(*lean))
        s = unit(UP * math.cos(tilt) + out * math.sin(tilt))
        yaw = az + math.pi / 2 + rng.uniform(-0.7, 0.7)
        wd = np.array([math.cos(yaw), math.sin(yaw), 0.0])
        wd = unit(wd - s * np.dot(wd, s))
        base = out * rng.uniform(0.0, spread) - UP * 0.03
        card(geo, base, s, wd, h, w, inset(cell), bulge=0.08, flip=rng.random() < 0.5)
    V, UV, F, M, _ = geo.arrays()
    hmax = V[:, 2].max()
    hf = np.clip(V[:, 2] / hmax, 0, 1)
    radial = unit(V * np.array([1, 1, 0]) + 1e-6)
    N = unit(0.3 * M + 0.8 * UP + 0.25 * radial)
    # 根元は暗く（株の中と地面際）、先は明るい
    col = np.repeat((0.45 + 0.55 * hf ** 0.7)[:, None], 3, 1)
    return V, UV, F, N, col


def azalea(rng):
    """刈り込んだつつじ：丸い塊の表面に葉のカード"""
    geo = Geo()
    c = np.array([0.0, 0.0, 0.34])
    rad = np.array([0.62, 0.55, 0.42])
    info = []
    for k in range(230):
        u = rng.random()
        cphi = rng.uniform(0.2, 1.0) if u < 0.55 else (rng.uniform(-0.4, 0.2) if u < 0.9 else rng.uniform(-0.8, -0.4))
        th = rng.uniform(0, 2 * math.pi)
        sphi = math.sqrt(1 - cphi * cphi)
        d = np.array([sphi * math.cos(th), sphi * math.sin(th), cphi])
        p = c + d * rad * rng.uniform(0.78, 1.0)
        ne = unit(d / rad)
        m = unit(ne + rng.normal(0, 0.45, 3))
        s = unit(np.cross(m, rng.normal(0, 1, 3)))
        w = np.cross(s, m)
        L = rng.uniform(0.3, 0.42)
        card(geo, p, s, w, L, L, inset(CELLS['azalea']), bulge=0.12, flip=rng.random() < 0.5, center=True)
        info.append((p, L * L * 0.55))
    V, UV, F, M, _ = geo.arrays()
    dens = Density(V.min(0) - 0.3, V.max(0) + 0.3, 0.12)
    dens.splat(np.array([p for p, _ in info]), np.array([a for _, a in info]))
    dens.finish(0.5, 1)
    grad = unit((V - c) / rad ** 2)
    N = unit(0.3 * M + 0.7 * grad + 0.1 * UP)
    ao = volume_ao(V, N, dens, k=24, max_d=1.2, t0=0.03, up_bias=0.4, ground_dist=0.6)
    col = np.repeat((0.35 + 0.65 * ao)[:, None], 3, 1)
    # 地面より下に出ないように（下の縁は地面に触れる）
    V[:, 2] = np.maximum(V[:, 2], -0.02)
    return V, UV, F, N, col


def fern(rng):
    """しだの株：中心から弓なりに外へ垂れる葉（1 枚の葉を 5 区間に曲げたリボン）"""
    geo = Geo()
    cell = inset(CELLS['fern'])
    n = 17
    for k in range(n):
        az = k / n * 2 * math.pi + rng.uniform(-0.25, 0.25)
        out = np.array([math.cos(az), math.sin(az), 0.0])
        side = np.array([-out[1], out[0], 0.0])
        L = rng.uniform(0.55, 0.9)
        e0 = math.radians(rng.uniform(55, 75))
        e1 = math.radians(rng.uniform(-25, -5))
        rows = 6
        pts = [out * rng.uniform(0.0, 0.06) + UP * 0.02]
        for i in range(rows - 1):
            t = (i + 0.5) / (rows - 1)
            e = e0 + (e1 - e0) * t ** 1.3
            pts.append(pts[-1] + (out * math.cos(e) + UP * math.sin(e)) * L / (rows - 1))
        W = L * 0.3
        V = []
        UV = []
        for i, p in enumerate(pts):
            v = cell[1] + (cell[3] - cell[1]) * i / (rows - 1)
            tw = side * math.cos(0.3) + UP * math.sin(0.3) * 0.2
            for j, cfac in enumerate((-0.5, 0.0, 0.5)):
                lift = UP * W * 0.1 if j == 1 else 0
                V.append(p + tw * W * cfac + lift)
                UV.append((cell[0] + (cell[2] - cell[0]) * (cfac + 0.5), v))
        F = []
        for i in range(rows - 1):
            a = i * 3
            F += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
        geo.add(np.array(V), np.array(UV), F, None)
    V, UV, F, _, _ = geo.arrays()
    radial = unit(V * np.array([1, 1, 0]) + 1e-6)
    N = unit(0.9 * UP + 0.45 * radial)
    r = np.linalg.norm(V[:, :2], axis=1)
    col = np.repeat((0.42 + 0.58 * np.clip(r / 0.55, 0, 1) ** 0.6)[:, None], 3, 1)
    return V, UV, F, N, col


def build(preview=True):
    ensure_textures()
    reset()
    rng = np.random.default_rng(SEED)
    # 草・しだ：片面＋裏向きの面（上向きの法線のまま）。つつじ：外向きのカードなので両面の材質で足りる
    mat1 = mat_cards('plants_1side', tex('plants'), rough=0.85, cutoff=0.42, spec=0.3, double_sided=False)
    mat2 = mat_cards('plants', tex('plants'), rough=0.85, cutoff=0.42, spec=0.3)
    parts = {
        'grass_a': grass(rng, CELLS['grass_a'], 16, (0.26, 0.4), 0.06),
        'grass_b': grass(rng, CELLS['grass_b'], 12, (0.5, 0.75), 0.05, lean=(5, 22)),
        'grass_c': grass(rng, CELLS['grass_c'], 14, (0.3, 0.46), 0.07, lean=(12, 40)),
        'shrub_azalea': azalea(rng),
        'shrub_fern': fern(rng),
    }
    obs = []
    info = {}
    for name, (V, UV, F, N, col) in parts.items():
        two = name != 'shrub_azalea'
        ob = make_object(name, V, UV, F, mat1 if two else mat2, normals=N, color=col, props={'cast': name.startswith('shrub'), 'receive': True}, two_faced=two)
        obs.append(ob)
        tri = triangles([ob])
        info[name] = {'triangles': tri, 'height': round(float(V[:, 2].max()), 2), 'radius': round(float(np.linalg.norm(V[:, :2], axis=1).max()), 2)}
    size = export_glb(MODELS_DIR / 'plants.glb', obs)
    print('plants:', info, f'{size / 1e6:.2f} MB')
    write_meta('plants', {'glb': 'models/plants.glb', 'meshes': info,
                          'note': '名前（grass_a など）で取り出して複製する。どれも原点が根元。草は影を落とさない（userData.cast=false）、低木は落とす。'})
    if preview:
        from treelib import emulate_threejs_ambient, preview_cull, preview_setup, render_game
        preview_setup()
        preview_cull(mat1)
        emulate_threejs_ambient()
        # 並べて描く（書き出しの後なので、動かしてよい）
        for i, ob in enumerate(obs):
            ob.location = ((i - 2) * 1.25, 0, 0)
        render_game(PREVIEW_DIR / 'plants-row.png', (0.0, 1.3, 3.4), (0.0, 0.25, 0.0), samples=32)
        render_game(PREVIEW_DIR / 'plants-far.png', (0.0, 1.9, 8.0), (0.0, 0.3, 0.0), samples=24)


if __name__ == '__main__':
    build(preview='--no-preview' not in sys.argv)
