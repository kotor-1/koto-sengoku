"""
共有の材質ライブラリ（町家・城門などの制作スクリプトから使う）。

使い方（Blender 4.5 を Python の部品として実行）:
    import sys; sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
    from common import *
    import mats
    m = mats.get('plaster_white')            # bpy.types.Material（無ければ作る。画像は build/tex/ に作り置き）
    mats.assign(obj, 'wood_dark')            # 物体に材質を足す（返り値は材質の番号）
    mats.uv_box(obj)                         # 箱投影。世界座標のメートルで、面ごとの材質のタイル寸法に合わせる
    mats.uv_along(obj)                       # 木目を部材の長手方向に（島ごとに主軸を求める）
    mats.bake_ao_to_color([obj, ...])        # 環境光の遮蔽を頂点色 'Col' に焼く（細かい形向け）
    mats.bake_ao_to_texture(obj, 1024)       # 大きな平面向け：第 2 UV 'lightmap' に焼き、glTF の occlusionTexture にする

画像はすべて繰り返し可能（周期的なノイズを FFT・周期ボロノイで合成）で、1 回の繰り返しが何メートルかを材質ごとに持つ
（material['koto_tile_m'] = (u 方向 m, v 方向 m)）。木目・繊維は u 方向に走る。
"""
from __future__ import annotations

import builtins
import math
import os
import pathlib

import bpy  # bpy を先に（bmesh は bpy の読み込み後でないと使えない）
import bmesh
import mathutils
import numpy as np

from common import BUILD_DIR

TEX_DIR = BUILD_DIR / 'tex'
TEX_VERSION = 'v3'
COLOR_ATTR = 'Col'
GLTF_GROUP = 'glTF Material Output'


# ---------------------------------------------------------------------------
# 周期的なノイズ（すべて繰り返し可能）
# ---------------------------------------------------------------------------

def _uv(h, w):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    return np.meshgrid(u, v)


def snoise(shape, seed, fmin=1.0, fmax=64.0, beta=1.0, aniso=(1.0, 1.0), angle=0.0):
    """周期ノイズ（スペクトル合成）。周波数は 1 繰り返しあたりの波の数。aniso=(a,1) で a>1 なら u 方向に長く伸びる。平均 0・標準偏差 1"""
    h, w = shape
    rng = np.random.default_rng(seed)
    W = np.fft.rfft2(rng.standard_normal((h, w)).astype(np.float32))
    FU, FV = np.meshgrid(np.fft.rfftfreq(w) * w, np.fft.fftfreq(h) * h)
    if angle:
        c, s = math.cos(angle), math.sin(angle)
        FU, FV = c * FU + s * FV, -s * FU + c * FV
    r = np.hypot(FU * aniso[0], FV * aniso[1])
    amp = np.power(np.maximum(r, 1e-6), -beta)
    amp *= 1.0 - np.exp(-(r / max(fmin, 1e-6)) ** 4)
    amp *= np.exp(-(r / fmax) ** 2)
    amp[0, 0] = 0.0
    out = np.fft.irfft2(W * amp, s=(h, w)).astype(np.float32)
    out -= out.mean()
    return out / (out.std() + 1e-9)


def bilinear(img, x, y):
    """周期的な双一次補間（x, y は画素単位）"""
    h, w = img.shape[:2]
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    if img.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy)
            + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def worley(shape, cells, seed, jitter=0.9):
    """周期ボロノイ。cells=(u 方向の数, v 方向の数)。返り値 F1, F2（セル単位の距離）, セル番号"""
    h, w = shape
    cu, cv = (cells, cells) if np.isscalar(cells) else cells
    rng = np.random.default_rng(seed)
    jx = rng.random((cv, cu)).astype(np.float32)
    jy = rng.random((cv, cu)).astype(np.float32)
    X, Y = np.meshgrid((np.arange(w, dtype=np.float32) + 0.5) / w * cu,
                       (np.arange(h, dtype=np.float32) + 0.5) / h * cv)
    ci = np.floor(X).astype(np.int32)
    cj = np.floor(Y).astype(np.int32)
    F1 = np.full(shape, 1e9, np.float32)
    F2 = np.full(shape, 1e9, np.float32)
    ID = np.zeros(shape, np.int32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            a = ci + di
            b = cj + dj
            am = a % cu
            bm = b % cv
            px = a + 0.5 + (jx[bm, am] - 0.5) * jitter
            py = b + 0.5 + (jy[bm, am] - 0.5) * jitter
            d = np.hypot(X - px, Y - py)
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, bm * cu + am, ID)
            F1 = np.where(closer, d, F1)
    return F1, F2, ID


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rgb(r, g, b):
    return np.array([r, g, b], np.float32) / 255.0


def mix(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim >= 2:
        t = t[..., None]
    return a + (b - a) * t


def blur(img, r=1):
    """周期的な箱ぼかし"""
    out = img.copy()
    for ax in (0, 1):
        acc = out.copy()
        for k in range(1, r + 1):
            acc += np.roll(out, k, axis=ax) + np.roll(out, -k, axis=ax)
        out = acc / (2 * r + 1)
    return out


def _lines(shape, segs, width=1.0, seed=0):
    """細い線（ひび・藁の繊維）を周期的に描く。segs: [(u0,v0,u1,v1), ...] 画素単位。返り値 0..1 の濃さ"""
    h, w = shape
    acc = np.zeros(shape, np.float32)
    if not len(segs):
        return acc
    segs = np.asarray(segs, np.float32)
    L = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    ns = np.maximum(2, (L * 2).astype(np.int32))
    idx = np.repeat(np.arange(len(segs)), ns)
    t = np.concatenate([np.linspace(0, 1, k, dtype=np.float32) for k in ns])
    x = segs[idx, 0] + (segs[idx, 2] - segs[idx, 0]) * t
    y = segs[idx, 1] + (segs[idx, 3] - segs[idx, 1]) * t
    taper = np.sin(np.pi * np.clip(t, 0.02, 0.98)) ** 0.5
    rr = int(math.ceil(width)) + 1
    for dy in range(-rr, rr + 1):
        for dx in range(-rr, rr + 1):
            xi = np.floor(x).astype(np.int64) + dx
            yi = np.floor(y).astype(np.int64) + dy
            d = np.hypot(xi + 0.5 - x, yi + 0.5 - y)
            wgt = np.clip(1.0 - d / (width + 0.5), 0, 1) * taper
            np.maximum.at(acc, (yi % h, xi % w), wgt.astype(np.float32))
    return acc


# ---------------------------------------------------------------------------
# 材質ごとの画像の合成（配列は下の行が v=0。albedo は sRGB、height はメートル）
# ---------------------------------------------------------------------------

def _gen_wood(n, seed, tile, early, late, *, rings=34, warp=2.2, fiber=0.18, gray=None, weather=0.0,
              checks=0, relief=0.00012, rough=(0.62, 0.78), mott=0.06, wear=None):
    sh = (n, n)
    U, V = _uv(n, n)
    w1 = snoise(sh, seed + 1, fmin=0.8, fmax=7, beta=1.5, aniso=(1.6, 1.0))
    w2 = snoise(sh, seed + 2, fmin=4, fmax=40, beta=1.2, aniso=(2.5, 1.0))
    r = rings * V + warp * w1 + 0.18 * w2
    p = r - np.floor(r)
    lw = smoothstep(0.52, 0.93, p) * (1 - smoothstep(0.965, 1.0, p))
    # 幅の違う年輪（年ごとの太り方の差）
    ring_id = np.floor(r).astype(np.int32)
    rr = np.random.default_rng(seed + 3).random(4096).astype(np.float32)
    lw *= 0.65 + 0.55 * rr[ring_id % 4096]
    fb = snoise(sh, seed + 4, fmin=40, fmax=900, beta=0.6, aniso=(9.0, 1.0))
    fb2 = snoise(sh, seed + 5, fmin=8, fmax=160, beta=0.9, aniso=(7.0, 1.0))
    mo = snoise(sh, seed + 6, fmin=0.8, fmax=10, beta=1.2, aniso=(3.0, 1.0))
    t = np.clip(lw * 0.9 + 0.08 * fb + 0.06 * fb2, 0, 1)
    col = mix(early, late, t)
    col *= (1 + mott * mo + 0.025 * fb2)[..., None]
    h = relief * (lw + 0.12 * fb + 0.25 * fb2)
    crack = np.zeros(sh, np.float32)
    if gray is not None and weather > 0:
        gm = np.clip(0.55 + 0.35 * snoise(sh, seed + 7, fmin=1, fmax=14, beta=1.0, aniso=(3.0, 1.0)) - 0.35 * lw, 0, 1)
        col = mix(col, gray, gm * weather)
    if checks:
        rng = np.random.default_rng(seed + 8)
        su, sv = n / tile[0], n / tile[1]  # 1m あたりの画素数
        segs = []
        for _ in range(checks):
            u0 = rng.random() * n
            v0 = rng.random() * n
            L = (0.03 + 0.14 * rng.random() ** 2) * su
            dv = (rng.random() - 0.5) * 0.004 * sv
            segs.append((u0, v0, u0 + L, v0 + dv))
        crack = _lines(sh, segs, width=0.7)
        crack = np.maximum(crack, 0.6 * blur(crack, 1))
        col = mix(col, col * 0.45, crack * 0.85)
        h -= 0.0012 * crack
    if wear is not None:
        wm = np.clip(snoise(sh, seed + 9, fmin=2, fmax=60, beta=1.0, aniso=(4.0, 1.0)) * 0.9 - 0.6 + 0.5 * lw, 0, 1)
        col = mix(col, wear, wm * 0.45)
    rough_m = rough[0] + (rough[1] - rough[0]) * np.clip(0.5 + 0.3 * fb2 + 0.4 * (1 - lw) * 0.5, 0, 1)
    rough_m = np.maximum(rough_m, crack * 0.95)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough_m)


def _gen_plaster_white(n, seed, tile, streaks=False):
    sh = (n, n)
    U, V = _uv(n, n)
    base = rgb(213, 207, 195)
    # 鏝のむら：向きの違う伸びたノイズを、ゆっくり変わる重みで混ぜる
    ws = [snoise(sh, seed + 10 + k, fmin=0.5, fmax=3, beta=1.0) for k in range(3)]
    ws = np.stack(ws) * 2.2
    ws = np.exp(ws - ws.max(0))
    ws /= ws.sum(0)
    trowel = sum(ws[k] * snoise(sh, seed + 20 + k, fmin=3, fmax=28, beta=1.4, aniso=(2.5, 1.0), angle=a)
                 for k, a in enumerate((0.25, -0.6, 1.2)))
    fine = snoise(sh, seed + 30, fmin=150, fmax=1200, beta=0.3)
    low = snoise(sh, seed + 31, fmin=0.5, fmax=6, beta=1.0)
    mid = snoise(sh, seed + 32, fmin=6, fmax=60, beta=1.0)
    col = base * (1 + 0.018 * low + 0.012 * mid + 0.010 * trowel + 0.012 * fine)[..., None]
    col = col + np.array([0.004, 0.0, -0.006], np.float32) * low[..., None]
    rng = np.random.default_rng(seed + 33)
    pits = (rng.random(sh) < 0.0009).astype(np.float32)
    pits = blur(pits, 1) * 9
    col *= (1 - 0.06 * np.clip(pits, 0, 1))[..., None]
    h = 0.0007 * trowel + 0.00003 * fine - 0.00015 * np.clip(pits, 0, 1)
    rough = np.clip(0.86 - 0.05 * trowel + 0.02 * fine, 0.7, 0.95)
    if streaks:
        # 上端（v=1）のすぐ下だけ、雨だれのかすかな筋
        s = snoise(sh, seed + 40, fmin=20, fmax=500, beta=0.6, aniso=(1.0, 12.0))
        s2 = snoise(sh, seed + 41, fmin=1, fmax=25, beta=1.0, aniso=(1.0, 6.0))
        m = np.clip(s * 0.5 + 0.25 + 0.4 * s2, 0, 1)
        fall = smoothstep(0.72, 0.985, V) * (0.6 + 0.4 * smoothstep(0.9, 1.0, V))
        dirt = m * fall
        col = mix(col, col * np.array([0.88, 0.87, 0.85], np.float32), dirt * 0.55)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_plaster_earth(n, seed, tile):
    sh = (n, n)
    c1, c2 = rgb(168, 132, 96), rgb(140, 106, 76)
    mo = snoise(sh, seed + 1, fmin=0.8, fmax=25, beta=1.3)
    mid = snoise(sh, seed + 2, fmin=20, fmax=200, beta=0.9)
    fine = snoise(sh, seed + 3, fmin=150, fmax=1400, beta=0.2)
    col = mix(c1, c2, np.clip(0.5 + 0.28 * mo, 0, 1)) * (1 + 0.05 * mid + 0.03 * fine)[..., None]
    rng = np.random.default_rng(seed + 4)
    g = rng.random(sh)
    dark = (g < 0.02).astype(np.float32)
    light = (g > 0.975).astype(np.float32)
    col = mix(col, rgb(92, 72, 55), dark * 0.7)
    col = mix(col, rgb(206, 186, 152), light * 0.6)
    # 苆（すさ：刻んだ藁）
    px = n / tile[0]
    segs = []
    for _ in range(int(1600 * tile[0] * tile[1] / 4)):
        u0, v0 = rng.random() * n, rng.random() * n
        a = rng.random() * math.pi
        L = (0.008 + 0.022 * rng.random()) * px
        segs.append((u0, v0, u0 + math.cos(a) * L, v0 + math.sin(a) * L))
    straw = _lines(sh, segs, width=0.6)
    col = mix(col, rgb(200, 172, 116), straw * 0.65)
    h = 0.0010 * mo * 0.3 + 0.0006 * mid + 0.00012 * fine + 0.00025 * straw - 0.0003 * dark
    rough = np.clip(0.92 + 0.03 * fine, 0.8, 1.0)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_tile(n, seed, tile):
    sh = (n, n)
    dark, silver = rgb(66, 67, 70), rgb(106, 108, 112)
    m = snoise(sh, seed + 1, fmin=1.5, fmax=40, beta=1.2)
    m2 = snoise(sh, seed + 2, fmin=30, fmax=300, beta=0.8)
    fine = snoise(sh, seed + 3, fmin=200, fmax=1400, beta=0.2)
    col = mix(dark, silver, np.clip(0.5 + 0.07 * m + 0.06 * m2, 0, 1)) * (1 + 0.03 * fine)[..., None]
    rng = np.random.default_rng(seed + 4)
    spk = (rng.random(sh) < 0.004).astype(np.float32)
    col = mix(col, rgb(160, 160, 158), spk * 0.4)
    h = 0.00015 * m2 + 0.00004 * fine - 0.00008 * spk
    rough = np.clip(0.5 - 0.07 * m - 0.04 * m2, 0.3, 0.7)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _granite(sh, seed, cells, pal, probs):
    rng = np.random.default_rng(seed)
    F1, F2, ID = worley(sh, cells, seed, jitter=1.0)
    cu, cv = (cells, cells) if np.isscalar(cells) else cells
    ncell = cu * cv
    ph = rng.choice(len(pal), size=ncell, p=probs)
    tone = (1 + 0.10 * (rng.random(ncell) - 0.5)).astype(np.float32)
    col = np.asarray(pal, np.float32)[ph[ID]] * tone[ID][..., None]
    edge = 1 - smoothstep(0.0, 0.08, F2 - F1)
    return col, ph[ID], edge


def _gen_granite(n, seed, tile, *, cells=190, macro=0.06, warm=0.0, split=0.0, pits=0.0):
    sh = (n, n)
    pal = [rgb(150, 148, 146), rgb(186, 183, 176), rgb(172, 160, 150), rgb(84, 82, 82)]
    col, ph, edge = _granite(sh, seed, cells, pal, [0.36, 0.42, 0.12, 0.10])
    col2, ph2, edge2 = _granite(sh, seed + 50, int(cells * 2.3), pal, [0.38, 0.38, 0.12, 0.12])
    sel = np.clip(snoise(sh, seed + 52, fmin=30, fmax=300, beta=0.5) * 0.8, 0, 1)
    col = mix(col, col2, sel)
    col = blur(col, 1) * 0.6 + col * 0.4
    col *= (1 - 0.06 * edge)[..., None]
    low = snoise(sh, seed + 53, fmin=0.8, fmax=12, beta=1.2)
    mid = snoise(sh, seed + 54, fmin=10, fmax=80, beta=1.0)
    col *= (1 + macro * low + 0.03 * mid)[..., None]
    if warm:
        st = np.clip(snoise(sh, seed + 55, fmin=1, fmax=16, beta=1.1) * 0.7 - 0.2, 0, 1)
        col = mix(col, col * np.array([1.08, 0.98, 0.86], np.float32), st * warm)
        bl = np.clip(-snoise(sh, seed + 56, fmin=1, fmax=16, beta=1.1) * 0.6 - 0.3, 0, 1)
        col = mix(col, col * 1.10 + 0.02, bl * warm)
    fine = snoise(sh, seed + 57, fmin=200, fmax=1400, beta=0.3)
    bio = (ph == 3).astype(np.float32)
    h = 0.00012 * fine - 0.00012 * bio - 0.00008 * edge + 0.0008 * low * 0.3 + 0.0003 * mid
    rough = np.clip(0.78 - 0.08 * (ph == 0) + 0.04 * fine, 0.55, 0.95)
    if split:
        und = snoise(sh, seed + 58, fmin=2, fmax=24, beta=1.6)
        h += split * und
    if pits:
        pF1, _, _ = worley(sh, 40 if n <= 1024 else 80, seed + 59, jitter=1.0)
        dimple = np.clip(1 - (pF1 / 0.42) ** 2, 0, 1)
        h -= pits * dimple
        col *= (1 - 0.05 * dimple)[..., None]
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _pebbles(sh, seed, cells, occupancy, rmin, rmax, pal, shade=0.05, flat=1.0):
    """小石の層：セルの一部にだけ丸い石を置く（輪郭はなめらかにゆがめる）。返り値 色, 覆い(0..1), 高さ(0..1)"""
    rng = np.random.default_rng(seed)
    F1, F2, ID = worley(sh, cells, seed, jitter=0.8)
    cu, cv = (cells, cells) if np.isscalar(cells) else cells
    nc = cu * cv
    occ = rng.random(nc) < occupancy
    rad = (rmin + (rmax - rmin) * rng.random(nc)).astype(np.float32)
    pal = np.asarray(pal, np.float32)
    pc = pal[rng.integers(0, len(pal), nc)] * (0.9 + 0.2 * rng.random((nc, 1))).astype(np.float32)
    # 石 1 個に 2〜3 のふくらみが出る程度のゆがみ
    deform = snoise(sh, seed + 1, fmin=cu * 0.8, fmax=cu * 3.0, beta=1.0)
    d = F1 / rad[ID] * (1 + 0.16 * deform)
    inside = occ[ID] & (d < 1.0)
    dome = np.where(inside, np.clip(1 - d * d, 0, 1) ** (0.5 * flat), 0).astype(np.float32)
    cover = np.where(occ[ID], smoothstep(1.0, 0.88, d), 0).astype(np.float32)
    tex = snoise(sh, seed + 2, fmin=cu * 4, fmax=cu * 20, beta=0.5)
    col = pc[ID] * (1 - shade + shade * 2 * dome + 0.05 * tex)[..., None]
    return col, cover, dome


def _gen_earth(n, seed, tile, *, c_light, c_dark, pebble_scale=1.0, big=True, rough_base=0.9, relief=1.0, gravel=1.0, specks=1.0):
    sh = (n, n)
    tu = tile[0]
    low = snoise(sh, seed + 1, fmin=0.6, fmax=8, beta=1.3)
    mid = snoise(sh, seed + 2, fmin=8, fmax=120, beta=1.0)
    fine = snoise(sh, seed + 3, fmin=200, fmax=3000, beta=0.2)
    col = mix(c_dark, c_light, np.clip(0.55 + 0.25 * low + 0.12 * mid, 0, 1)) * (1 + 0.05 * fine)[..., None]
    rng = np.random.default_rng(seed + 4)
    g = rng.random(sh)
    col = mix(col, col * 0.7, (g < 0.03 * specks).astype(np.float32) * 0.7)
    col = mix(col, col * 1.15 + 0.02, (g > 1 - 0.015 * specks).astype(np.float32) * 0.5)
    h = 0.0015 * low * 0.4 + 0.0005 * mid + 0.00012 * fine
    stone_pal = [rgb(148, 142, 134), rgb(164, 154, 140), rgb(126, 120, 112), rgb(172, 162, 146), rgb(140, 120, 98), rgb(112, 106, 100)]
    covs = np.zeros(sh, np.float32)
    # 細かい粒（2〜5mm）→ 砂利（6〜14mm）→ 小石（2〜4cm）→ 平たい石（6〜12cm、まばら）
    layers = [(0.0045, 0.30 * gravel, 0.30, 0.45, 0.0007, 0.55),
              (0.014, 0.45 * gravel, 0.30, 0.46, 0.0025, 0.85),
              (0.045, 0.22 * gravel, 0.28, 0.42, 0.0060, 0.95)]
    if big:
        layers.append((0.20, 0.07 * gravel, 0.25, 0.36, 0.0050, 1.0))
    for k, (cs, occ, rmin, rmax, amp, op) in enumerate(layers):
        c_n = max(4, int(tu / cs * pebble_scale))
        pc, cov, dome = _pebbles(sh, seed + 10 + k, c_n, occ, rmin, rmax, stone_pal,
                                 flat=(2.5 if cs >= 0.2 else 1.0))
        # 埋まっている縁の小さな影
        ring = np.clip(blur(cov, max(1, int(2 * cs / 0.014))) - cov, 0, 1)
        col = mix(col, col * 0.8, np.clip(ring * 1.2, 0, 1) * min(1.0, cs / 0.01))
        col = mix(col, pc * mix(np.float32(1.0), col / (c_light + 1e-3), 0.25), cov * op)
        h += amp * dome * relief
        covs = np.maximum(covs, cov * op)
    rough = np.clip(rough_base + 0.03 * fine - 0.14 * covs, 0.55, 1.0)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_gravel(n, seed, tile):
    sh = (n, n)
    pal = [rgb(150, 147, 142), rgb(176, 170, 160), rgb(122, 120, 118), rgb(190, 182, 168), rgb(140, 128, 112), rgb(104, 104, 106)]
    gap = rgb(104, 92, 78)
    col = np.broadcast_to(gap, sh + (3,)).copy() * (1 + 0.08 * snoise(sh, seed + 5, fmin=40, fmax=600, beta=0.5))[..., None]
    h = np.zeros(sh, np.float32)
    for k, (cells, occ, rmin, rmax, amp) in enumerate([(90, 0.5, 0.35, 0.48, 0.003), (48, 0.85, 0.40, 0.52, 0.006),
                                                        (30, 0.75, 0.40, 0.50, 0.009)]):
        pc, cov, dome = _pebbles(sh, seed + 20 + k, int(cells * tile[0]), occ, rmin, rmax, pal, shade=0.06)
        hh = dome * amp
        top = hh > h
        col = np.where(top[..., None], mix(col, pc, cov), col)
        h = np.maximum(h, hh)
    ao = np.clip(h / 0.004, 0, 1) ** 0.5
    col *= (0.8 + 0.2 * ao)[..., None]
    fine = snoise(sh, seed + 30, fmin=200, fmax=1400, beta=0.2)
    col *= (1 + 0.04 * fine)[..., None]
    rough = np.clip(0.8 + 0.04 * fine - 0.08 * ao, 0.5, 1.0)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_iron(n, seed, tile):
    sh = (n, n)
    base, rust = rgb(58, 56, 54), rgb(88, 62, 46)
    low = snoise(sh, seed + 1, fmin=3, fmax=30, beta=1.0)
    mid = snoise(sh, seed + 2, fmin=10, fmax=200, beta=0.8)
    rm = np.clip(low * 0.25 + 0.2 * mid, 0, 1) * 0.45
    col = mix(base * (1 + 0.05 * mid)[..., None], rust, rm)
    F1, _, _ = worley(sh, int(22 * tile[0] / 0.5), seed + 3)
    dent = np.clip(1 - (F1 / 0.6) ** 2, 0, 1)
    fine = snoise(sh, seed + 4, fmin=100, fmax=800, beta=0.3)
    h = -0.0004 * dent + 0.00003 * fine + 0.0002 * rm
    rough = np.clip(0.5 + 0.35 * rm + 0.05 * mid, 0.3, 0.95)
    metal = np.clip(0.7 - 0.7 * rm, 0, 1)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough, metal=metal)


def _gen_bamboo(n, seed, tile):
    sh = (n, n)
    U, V = _uv(n, n)
    base, dry = rgb(180, 168, 112), rgb(158, 142, 94)
    fb = snoise(sh, seed + 1, fmin=30, fmax=900, beta=0.6, aniso=(12.0, 1.0))
    lo = snoise(sh, seed + 2, fmin=1, fmax=10, beta=1.0, aniso=(3.0, 1.0))
    col = mix(base, dry, np.clip(0.5 + 0.18 * lo, 0, 1)) * (1 + 0.05 * fb)[..., None]
    # 節（u=0 の輪）
    du = np.minimum(U, 1 - U) * tile[0]
    node = np.exp(-(du / 0.004) ** 2)
    line = np.exp(-(np.abs((U + 0.5) % 1.0 - 0.5) * tile[0] - 0.006) ** 2 / 0.0000015)
    col = mix(col, rgb(132, 118, 74), node * 0.55)
    col = mix(col, rgb(98, 86, 56), line * 0.6)
    rng = np.random.default_rng(seed + 3)
    sp = blur((rng.random(sh) < 0.0006).astype(np.float32), 2) * 10
    sp = np.clip(sp, 0, 1) * np.clip(snoise(sh, seed + 4, fmin=1, fmax=8) + 0.3, 0, 1)
    col = mix(col, rgb(110, 96, 70), sp * 0.5)
    h = 0.0012 * node + 0.00004 * fb
    rough = np.clip(0.42 + 0.06 * lo + 0.1 * node, 0.3, 0.7)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_straw(n, seed, tile):
    """藁：u 方向にそろった太さ 2.5〜5mm の茎。茎ごとに色が違い、茎の間は暗い"""
    sh = (n, n)
    U, V = _uv(n, n)
    rng = np.random.default_rng(seed)
    pal = np.asarray([rgb(206, 180, 118), rgb(190, 162, 100), rgb(172, 146, 90), rgb(154, 136, 94),
                      rgb(198, 176, 128), rgb(180, 150, 86)], np.float32)
    px_per_m = n / tile[1]
    col = np.zeros(sh + (3,), np.float32)
    h = np.full(sh, -1.0, np.float32)
    for layer in range(1):
        wob = snoise(sh, seed + 10 + layer, fmin=0.8, fmax=3, beta=1.5, aniso=(1.0, 6.0))
        vv = V * n + wob * (0.004 * px_per_m) + layer * 53.7
        widths = (0.0025 + 0.0025 * rng.random(2000)) * px_per_m
        edges = np.concatenate([[0], np.cumsum(widths)])
        k = int(np.searchsorted(edges, n))
        edges = edges[:k + 1] * (n / edges[k])
        vm = vv % n
        sid = np.clip(np.searchsorted(edges, vm, side='right') - 1, 0, k - 1)
        e0, e1 = edges[sid], edges[sid + 1]
        x = (vm - e0) / (e1 - e0) * 2 - 1
        prof = np.sqrt(np.clip(1 - x * x, 0, 1)).astype(np.float32)
        palv = pal[rng.integers(0, len(pal), k)] * (0.9 + 0.2 * rng.random((k, 1))).astype(np.float32)
        along = snoise(sh, seed + 20 + layer, fmin=3, fmax=160, beta=0.9, aniso=(14.0, 1.0))
        c = palv[sid] * (0.70 + 0.30 * prof + 0.10 * along)[..., None]
        # 上の層は所々だけ（交差する藁）
        if layer:
            cover = snoise(sh, seed + 30, fmin=1, fmax=10, beta=1.0, aniso=(2.0, 1.0)) > 0.6
        else:
            cover = np.ones(sh, bool)
        hh = prof * 0.002 + layer * 0.0012
        top = (hh > h) & cover
        col = np.where(top[..., None], c, col)
        h = np.where(top, hh, h)
    h = np.maximum(h, 0)
    col *= (0.7 + 0.3 * np.clip(h / 0.002, 0, 1))[..., None]
    rough = np.clip(0.72 + 0.12 * (1 - np.clip(h / 0.002, 0, 1)), 0.6, 0.95)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_cloth(n, seed, tile, *, warp_c, weft_c, threads=224, slub=0.35, fade=0.10):
    sh = (n, n)
    U, V = _uv(n, n)
    T = threads
    fu, fv = U * T, V * T
    i = np.floor(fu).astype(np.int32)
    j = np.floor(fv).astype(np.int32)
    xu, xv = fu - i, fv - j
    # 太さのむら（節糸）：縦糸は v 方向に、横糸は u 方向に変わる
    sw = snoise(sh, seed + 1, fmin=2, fmax=400, beta=0.7, aniso=(0.02, 1.0))
    sf = snoise(sh, seed + 2, fmin=2, fmax=400, beta=0.7, aniso=(1.0, 0.02))
    tw = np.clip(0.72 + slub * 0.35 * sw, 0.45, 1.05)
    tf = np.clip(0.72 + slub * 0.35 * sf, 0.45, 1.05)
    pw = np.sqrt(np.clip(1 - ((xu - 0.5) / (0.5 * tw)) ** 2, 0, 1))
    pf = np.sqrt(np.clip(1 - ((xv - 0.5) / (0.5 * tf)) ** 2, 0, 1))
    over = ((i + j) % 2 == 0)
    arch_w = np.cos(np.pi * (xv - 0.5)) * 0.5 + 0.5
    arch_f = np.cos(np.pi * (xu - 0.5)) * 0.5 + 0.5
    hw = pw * (0.6 + 0.4 * np.where(over, arch_w, 1 - arch_w))
    hf = pf * (0.6 + 0.4 * np.where(over, 1 - arch_f, arch_f))
    top_w = hw >= hf
    rng = np.random.default_rng(seed + 3)
    shade_w = (1 + 0.14 * (rng.random(T) - 0.5)).astype(np.float32)[i % T]
    shade_f = (1 + 0.14 * (rng.random(T) - 0.5)).astype(np.float32)[j % T]
    cw = warp_c * (shade_w * (1 + 0.10 * sw))[..., None]
    cf = weft_c * (shade_f * (1 + 0.10 * sf))[..., None]
    col = np.where(top_w[..., None], cw, cf)
    hmax = np.maximum(hw, hf)
    col *= (0.55 + 0.45 * hmax)[..., None]
    low = snoise(sh, seed + 4, fmin=0.8, fmax=10, beta=1.2)
    col = mix(col, col * 1.18 + 0.015, np.clip(low * 0.5 + 0.2, 0, 1) * fade * 4)
    h = hmax * 0.0003
    rough = np.clip(0.9 - 0.06 * hmax, 0.7, 1.0)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_lacquer(n, seed, tile):
    sh = (n, n)
    base = rgb(40, 34, 31)
    lo = snoise(sh, seed + 1, fmin=1, fmax=12, beta=1.2)
    br = snoise(sh, seed + 2, fmin=10, fmax=400, beta=0.8, aniso=(10.0, 1.0))
    col = base * (1 + 0.06 * lo + 0.03 * br)[..., None]
    col = mix(col, rgb(58, 40, 32), np.clip(lo - 1.6, 0, 1) * 0.25)
    h = 0.00002 * br + 0.00003 * snoise(sh, seed + 3, fmin=20, fmax=100, beta=1.0)
    rough = np.clip(0.26 + 0.05 * br + 0.04 * lo, 0.15, 0.45)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def _gen_paper(n, seed, tile):
    sh = (n, n)
    base = rgb(228, 222, 206)
    rng = np.random.default_rng(seed)
    lo = snoise(sh, seed + 1, fmin=1, fmax=30, beta=1.0)
    px = n / tile[0]
    segs = []
    for _ in range(2500):
        u0, v0 = rng.random() * n, rng.random() * n
        a = rng.random() * math.pi
        L = (0.005 + 0.03 * rng.random()) * px
        segs.append((u0, v0, u0 + math.cos(a) * L, v0 + math.sin(a) * L))
    fib = _lines(sh, segs, width=0.5)
    col = base * (1 + 0.02 * lo)[..., None]
    col = mix(col, rgb(240, 236, 224), fib * 0.5)
    h = 0.00005 * lo + 0.00004 * fib
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=np.full(sh, 0.9, np.float32))


# ---------------------------------------------------------------------------
# 材質の一覧（tile は 1 繰り返しの寸法 [u m, v m]。木目・繊維は u 方向）
# ---------------------------------------------------------------------------

def _wood_spec(early, late, **kw):
    return lambda n, s, t: _gen_wood(n, s, t, early, late, **kw)


CATALOG: dict[str, dict] = {
    'plaster_white': dict(tile=(3.0, 3.0), size=1024, uv='box', nstr=1.0, seed=101,
                          gen=lambda n, s, t: _gen_plaster_white(n, s, t, False),
                          doc='漆喰（白壁）。温かみのある白、ゆるい鏝むら。'),
    'plaster_white_streaks': dict(tile=(3.0, 3.0), size=1024, uv='box', nstr=1.0, seed=101,
                                  gen=lambda n, s, t: _gen_plaster_white(n, s, t, True),
                                  doc='漆喰＋上端だけのかすかな雨だれ。uv_box(obj, top_z=壁の上端の高さ) で使う。'),
    'plaster_earth': dict(tile=(2.0, 2.0), size=1024, uv='box', nstr=1.0, seed=111, gen=_gen_plaster_earth,
                          doc='土壁（茶色の荒壁・中塗り、苆入り）。'),
    'wood_weathered': dict(tile=(2.0, 0.5), size=1024, uv='along', nstr=1.0, seed=121,
                           gen=_wood_spec(rgb(114, 101, 88), rgb(82, 70, 59), rings=30, warp=1.7, gray=rgb(122, 117, 109),
                                          weather=0.55, checks=70, relief=0.0009, rough=(0.72, 0.9)),
                           doc='風雨にさらされた杉（灰色がかった茶、浮造りの木目、小さな干割れ）。板壁・外の柱・軒の垂木。'),
    'wood_dark': dict(tile=(2.0, 0.5), size=1024, uv='along', nstr=1.0, seed=131,
                      gen=_wood_spec(rgb(92, 68, 50), rgb(54, 38, 28), rings=34, warp=1.5, relief=0.00012,
                                     rough=(0.5, 0.7), checks=18),
                      doc='濃い色の柱・梁・門の扉（黒くしない。木目が見える）。'),
    'wood_bengara': dict(tile=(2.0, 0.5), size=1024, uv='along', nstr=1.0, seed=141,
                         gen=_wood_spec(rgb(124, 58, 40), rgb(86, 40, 28), rings=34, warp=1.5, relief=0.00015,
                                        rough=(0.62, 0.8), wear=rgb(84, 60, 46)),
                         doc='弁柄塗りの格子（赤茶）。'),
    'wood_fresh': dict(tile=(2.0, 0.5), size=1024, uv='along', nstr=1.0, seed=151,
                       gen=_wood_spec(rgb(212, 176, 130), rgb(180, 138, 94), rings=40, warp=1.5, relief=0.00008,
                                      rough=(0.55, 0.72), mott=0.05),
                       doc='新しい檜（縁台・樽・看板など明るい木）。'),
    'tile_ibushi': dict(tile=(1.0, 1.0), size=1024, uv='box', nstr=1.0, seed=161, gen=_gen_tile,
                        doc='いぶし瓦（銀灰色、少し艶）。1 枚ずつの色むらは頂点色 Col（tint_islands）で。'),
    'stone_granite': dict(tile=(1.0, 1.0), size=1024, uv='box', nstr=1.0, seed=171,
                          gen=lambda n, s, t: _gen_granite(n, s, t, cells=190, macro=0.05),
                          doc='御影石（灰色のごま塩模様、ざらつき）。礎石・板石・石段。'),
    'stone_wall': dict(tile=(2.0, 2.0), size=1024, uv='box', nstr=1.0, seed=181,
                       gen=lambda n, s, t: _gen_granite(n, s, t, cells=280, macro=0.06, warm=0.35, split=0.0022, pits=0.0012),
                       doc='石垣の大きな石の面（風化の色むら、はつり跡。苔なし）。石の形は形状で作る。'),
    'earth_road': dict(tile=(4.0, 4.0), size=2048, uv='box', nstr=1.0, seed=191,
                       gen=lambda n, s, t: _gen_earth(n, s, t, c_light=rgb(174, 152, 124), c_dark=rgb(146, 126, 102)),
                       doc='踏み固めた道の土（温かい土色に細かい砂利）。'),
    'earth_floor': dict(tile=(2.0, 2.0), size=1024, uv='box', nstr=1.0, seed=201,
                        gen=lambda n, s, t: _gen_earth(n, s, t, c_light=rgb(138, 114, 90), c_dark=rgb(114, 92, 72),
                                                       pebble_scale=1.3, big=False, rough_base=0.82, relief=0.5, gravel=0.35, specks=0.4),
                        doc='土間（なめらかで少し濃い三和土）。'),
    'gravel': dict(tile=(1.0, 1.0), size=1024, uv='box', nstr=1.0, seed=211, gen=_gen_gravel,
                   doc='砂利（灰〜ベージュの丸石）。'),
    'iron_black': dict(tile=(0.5, 0.5), size=512, uv='box', nstr=1.0, seed=221, gen=_gen_iron,
                       doc='黒い鉄の金具（門の鋲・帯金。少し錆）。'),
    'bamboo': dict(tile=(0.4, 0.15), size=1024, uv='along', nstr=1.0, seed=231, gen=_gen_bamboo,
                   doc='乾いた竹（黄緑がかった枯れ色、節は u=0 に 0.4m ごと）。uv_along(obj, round=True)。'),
    'straw': dict(tile=(0.5, 0.5), size=1024, uv='along', nstr=1.0, seed=241, gen=_gen_straw,
                  doc='藁（縄・俵・籠）。繊維は u 方向。'),
    'cloth_indigo': dict(tile=(0.3, 0.3), size=1024, uv='box', nstr=1.0, seed=251,
                         gen=lambda n, s, t: _gen_cloth(n, s, t, warp_c=rgb(46, 58, 94), weft_c=rgb(58, 70, 104)),
                         doc='藍染の麻（暖簾）。節のある平織り。'),
    'lacquer_black': dict(tile=(1.0, 1.0), size=512, uv='box', nstr=1.0, seed=261, gen=_gen_lacquer,
                          doc='黒漆（艶あり、真っ黒にはしない）。'),
    'paper_shoji': dict(tile=(0.5, 0.5), size=512, uv='box', nstr=1.0, seed=271, gen=_gen_paper,
                        doc='障子紙・和紙（温かい白、繊維）。'),
}

NAMES = list(CATALOG)


# ---------------------------------------------------------------------------
# 画像の作り置き
# ---------------------------------------------------------------------------

def _height_to_normal(h, tile, strength=1.0):
    H, W = h.shape
    du = tile[0] / W
    dv = tile[1] / H
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * du)
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * dv)
    nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5


def _save_png(path, arr):
    arr = np.asarray(arr, np.float32)
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, -1)
    h, w = arr.shape[:2]
    img = bpy.data.images.new('_koto_tmp_save', w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    tmp = str(path) + f'.{os.getpid()}.tmp.png'
    img.filepath_raw = tmp
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    os.replace(tmp, path)


def _downsample2(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def tex_paths(name: str) -> dict:
    base = TEX_DIR / f'{name}_{TEX_VERSION}'
    return {k: pathlib.Path(f'{base}_{k}.png') for k in ('albedo', 'normal', 'orm')}


def build_textures(name: str, force: bool = False) -> dict:
    """材質 name の画像（albedo / normal / orm）を作り置きする。あれば作らない。返り値はファイルの場所"""
    spec = CATALOG[name]
    paths = tex_paths(name)
    if not force and all(p.exists() for p in paths.values()):
        return paths
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    n = spec['size']
    d = spec['gen'](n, spec['seed'], spec['tile'])
    _save_png(paths['albedo'], d['albedo'])
    _save_png(paths['normal'], _height_to_normal(d['height'], spec['tile'], spec.get('nstr', 1.0)))
    rough = d['rough']
    metal = d.get('metal', np.zeros_like(rough))
    orm = np.stack([np.ones_like(rough), rough, metal], -1)
    if n > 512:
        orm = _downsample2(orm)
    _save_png(paths['orm'], orm)
    return paths


def build_all(force: bool = False) -> None:
    for nm in NAMES:
        build_textures(nm, force=force)


# ---------------------------------------------------------------------------
# 材質（Blender の節点）
# ---------------------------------------------------------------------------

def _load_image(path, noncolor):
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return img


def _mix_sockets(node):
    ins = [s for s in node.inputs if s.type == 'RGBA']
    out = [s for s in node.outputs if s.type == 'RGBA'][0]
    return ins[0], ins[1], out


def get(name: str, vcol: bool = False) -> bpy.types.Material:
    """
    材質を返す（同じ名前はひとつだけ作る）。vcol=True は頂点色 'Col' を掛けた版（名前は name + '@vc'）。
    three.js では頂点色 COLOR_0 があれば材質に関係なく掛かるので、vcol はおもに Blender の確認用の描画のため。
    vcol 版を使う物体には必ず 'Col' 属性を持たせる（無いと Blender の描画で黒くなる）。
    """
    if name not in CATALOG:
        raise KeyError(f'unknown material {name!r}; one of {NAMES}')
    mname = name + ('@vc' if vcol else '')
    m = bpy.data.materials.get(mname)
    if m is not None and m.get('koto_lib'):
        return m
    spec = CATALOG[name]
    paths = build_textures(name)
    m = bpy.data.materials.new(mname)
    m.use_nodes = True
    m['koto_lib'] = name
    m['koto_tile_m'] = list(spec['tile'])
    m['koto_uv'] = spec['uv']
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.name = 'albedo'
    ta.image = _load_image(paths['albedo'], False)
    ta.location = (-500, 300)
    if vcol:
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = COLOR_ATTR
        vc.location = (-500, 500)
        mx = nt.nodes.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1.0
        mx.location = (-150, 350)
        a, b, o = _mix_sockets(mx)
        nt.links.new(ta.outputs['Color'], a)
        nt.links.new(vc.outputs['Color'], b)
        nt.links.new(o, bsdf.inputs['Base Color'])
    else:
        nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.name = 'normal'
    tn.image = _load_image(paths['normal'], True)
    tn.location = (-500, -300)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.location = (-150, -300)
    nm.inputs['Strength'].default_value = 1.0
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    tr = nt.nodes.new('ShaderNodeTexImage')
    tr.name = 'orm'
    tr.image = _load_image(paths['orm'], True)
    tr.location = (-500, 0)
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    sp.location = (-150, 0)
    nt.links.new(tr.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
    if name == 'iron_black':
        nt.links.new(sp.outputs['Blue'], bsdf.inputs['Metallic'])
    else:
        bsdf.inputs['Metallic'].default_value = 0.0
    return m


def assign(obj, name_or_mat, vcol: bool = False) -> int:
    """材質を物体の材質欄に足す（既にあればその番号）。返り値は material_index に使う番号"""
    m = get(name_or_mat, vcol) if isinstance(name_or_mat, str) else name_or_mat
    for i, s in enumerate(obj.material_slots):
        if s.material == m:
            return i
    obj.data.materials.append(m)
    return len(obj.data.materials) - 1


def set_faces(obj, face_indices, name_or_mat, vcol: bool = False) -> int:
    """指定した面にだけ材質を割り当てる"""
    idx = assign(obj, name_or_mat, vcol)
    polys = obj.data.polygons
    for fi in face_indices:
        polys[fi].material_index = idx
    return idx


def tile_of(mat) -> tuple[float, float]:
    t = mat.get('koto_tile_m') if mat is not None else None
    return (float(t[0]), float(t[1])) if t is not None else (1.0, 1.0)


def densify(obj, max_edge=0.3, max_iter=6):
    """長い辺を分割して頂点を増やす（bake_ao_to_color の陰の細かさのため）。UV は分割に合わせて補間される"""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    sc = obj.matrix_world.to_scale()
    s = max(abs(sc.x), abs(sc.y), abs(sc.z))
    for _ in range(max_iter):
        long_e = [e for e in bm.edges if e.calc_length() * s > max_edge]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------------------
# UV（世界座標のメートル基準）
# ---------------------------------------------------------------------------

def _tile_for_face(obj, f, tile):
    if tile is not None:
        return (tile, tile) if np.isscalar(tile) else (float(tile[0]), float(tile[1]))
    slots = obj.material_slots
    mi = f.material_index
    return tile_of(slots[mi].material if mi < len(slots) else None)


def _uv_layer(bm, name='UVMap'):
    lay = bm.loops.layers.uv.get(name)
    return lay if lay is not None else bm.loops.layers.uv.new(name)


def _face_ok(obj, f, faces, materials):
    if faces is not None and f.index not in faces:
        return False
    if materials is not None:
        slots = obj.material_slots
        m = slots[f.material_index].material if f.material_index < len(slots) else None
        lib = m.get('koto_lib') if m is not None else None
        if lib not in materials and (m is None or m.name not in materials):
            return False
    return True


def uv_box(obj, tile=None, *, faces=None, materials=None, offset=(0.0, 0.0), top_z=None, uv_name='UVMap'):
    """
    箱投影（面の向きで XY / XZ / YZ を選ぶ）。座標は世界座標のメートルで、面の材質の koto_tile_m で割る。
    tile: 数か (u,v) で上書き。faces: 面番号の集合（それだけ）。materials: 材質名の集合（その面だけ）。
    top_z: 壁の上端の高さ（世界の Blender Z）。v の 1 がそこに合う（plaster_white_streaks の筋を上端にそろえる）。
    壁（縦の面）は u が水平、v が上向き。床（上向きの面）は u=X, v=Y。
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = _uv_layer(bm, uv_name)
    M = obj.matrix_world
    NM = M.inverted_safe().transposed().to_3x3()
    faces = set(faces) if faces is not None else None
    materials = set(materials) if materials is not None else None
    ox, oy = offset
    for f in bm.faces:
        if not _face_ok(obj, f, faces, materials):
            continue
        n = (NM @ f.normal).normalized()
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        tu, tv = _tile_for_face(obj, f, tile)
        for l in f.loops:
            p = M @ l.vert.co
            if az >= ax and az >= ay:
                u, v = p.x, (p.y if n.z >= 0 else -p.y)
            elif ax >= ay:
                u, v = (p.y if n.x > 0 else -p.y), p.z
            else:
                u, v = (-p.x if n.y > 0 else p.x), p.z
            if top_z is not None and not (az >= ax and az >= ay):
                v = p.z - top_z
            l[uvl].uv = ((u + ox) / tu, (v + oy) / tv)
    bm.to_mesh(me)
    bm.free()
    _uv_first(me, uv_name)


def _uv_first(me, uv_name):
    lay = me.uv_layers.get(uv_name)
    if lay is not None:
        lay.active_render = True
        me.uv_layers.active = lay


def _islands(bm):
    """面のつながり（辺を共有）で島に分ける。返り値 face.index -> 島番号"""
    parent = list(range(len(bm.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b:
            parent[a] = b
    roots = {}
    out = {}
    for f in bm.faces:
        r = find(f.verts[0].index)
        out[f.index] = roots.setdefault(r, len(roots))
    return out, len(roots)


def _axis_vec(axis):
    if axis is None:
        return None
    if isinstance(axis, str):
        return mathutils.Vector({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis.upper()])
    return mathutils.Vector(axis).normalized()


def uv_along(obj, axis=None, tile=None, *, round=False, seed=0, faces=None, materials=None, uv_name='UVMap'):
    """
    木目・繊維（テクスチャの u）を部材の長手方向に向ける。島（つながった部分）ごとに主軸を求める（axis=None）か、
    axis='X'/'Y'/'Z'（世界の Blender 軸）かベクトルで指定。島ごとに木目の位置をずらす（seed）。
    round=True は丸い部材（竹・丸太・樽の胴）：周方向を角度で開き、1 周が v の繰り返しの整数倍になるよう合わせる。
    木口（長手に直角な面）は面内の投影。
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    bm.faces.index_update()
    uvl = _uv_layer(bm, uv_name)
    M = obj.matrix_world
    NM = M.inverted_safe().transposed().to_3x3()
    isl, nisl = _islands(bm)
    faces = set(faces) if faces is not None else None
    materials = set(materials) if materials is not None else None
    wpos = np.array([tuple(M @ v.co) for v in bm.verts], np.float64).reshape(-1, 3)
    # 島ごとの頂点
    iv = [[] for _ in range(nisl)]
    for f in bm.faces:
        iv[isl[f.index]].extend(v.index for v in f.verts)
    info = []
    rng = np.random.default_rng(seed + 7919)
    fixed = _axis_vec(axis)
    for k in range(nisl):
        ids = np.unique(np.array(iv[k], np.int64)) if iv[k] else np.zeros(0, np.int64)
        P = wpos[ids] if len(ids) else np.zeros((1, 3))
        c = P.mean(0)
        if fixed is not None:
            a = np.array(fixed)
        else:
            C = np.cov((P - c).T) if len(P) > 2 else np.eye(3)
            w, vecs = np.linalg.eigh(C)
            a = vecs[:, np.argmax(w)]
            # 向きをそろえる（+X/+Y/+Z のどれかに正）
            if a[np.argmax(np.abs(a))] < 0:
                a = -a
        a = a / (np.linalg.norm(a) + 1e-12)
        rad = 0.0
        if round and len(P):
            d = P - c
            perp = d - np.outer(d @ a, a)
            rad = float(np.linalg.norm(perp, axis=1).mean())
        info.append((mathutils.Vector(c), mathutils.Vector(a), rad, rng.random(), rng.random()))
    for f in bm.faces:
        if not _face_ok(obj, f, faces, materials):
            continue
        c, a, rad, ru, rv = info[isl[f.index]]
        tu, tv = _tile_for_face(obj, f, tile)
        n = (NM @ f.normal).normalized()
        end = abs(n.dot(a)) > 0.8
        if end:
            t1 = a.cross(mathutils.Vector((0, 0, 1)))
            if t1.length < 0.3:
                t1 = a.cross(mathutils.Vector((1, 0, 0)))
            t1.normalize()
            t2 = n.cross(t1).normalized()
            for l in f.loops:
                p = M @ l.vert.co - c
                l[uvl].uv = (p.dot(t1) / tv + ru, p.dot(t2) / tv + rv)
            continue
        if round and rad > 1e-5:
            ref = a.cross(mathutils.Vector((0, 0, 1)))
            if ref.length < 0.3:
                ref = a.cross(mathutils.Vector((1, 0, 0)))
            ref.normalize()
            ref2 = a.cross(ref)
            reps = max(1, int(builtins.round(2 * math.pi * rad / tv)))
            angs = []
            for l in f.loops:
                p = M @ l.vert.co - c
                angs.append(math.atan2(p.dot(ref2), p.dot(ref)))
            a0 = angs[0]
            for i in range(len(angs)):
                while angs[i] - a0 > math.pi:
                    angs[i] -= 2 * math.pi
                while angs[i] - a0 < -math.pi:
                    angs[i] += 2 * math.pi
            for l, ang in zip(f.loops, angs):
                p = M @ l.vert.co - c
                l[uvl].uv = (p.dot(a) / tu + ru, ang / (2 * math.pi) * reps + rv)
            continue
        b = n.cross(a).normalized()
        for l in f.loops:
            p = M @ l.vert.co - c
            l[uvl].uv = (p.dot(a) / tu + ru, p.dot(b) / tv + rv)
    bm.to_mesh(me)
    bm.free()
    _uv_first(me, uv_name)


def uv_auto(obj, **kw):
    """面の材質の種類（koto_uv: 'box' / 'along'）に合わせて uv_box と uv_along を両方かける"""
    box, along = set(), set()
    for s in obj.material_slots:
        m = s.material
        if m is None or not m.get('koto_lib'):
            continue
        (along if m.get('koto_uv') == 'along' else box).add(m['koto_lib'])
    if box:
        uv_box(obj, materials=box, **{k: v for k, v in kw.items() if k in ('tile', 'offset', 'top_z')})
    if along:
        uv_along(obj, materials=along, **{k: v for k, v in kw.items() if k in ('axis', 'tile', 'round', 'seed')})


# ---------------------------------------------------------------------------
# 頂点色（1 枚ずつの色むら）と、環境光の遮蔽（AO）の焼き込み
# ---------------------------------------------------------------------------

def _color_attr(me, name=COLOR_ATTR, domain='POINT'):
    a = me.color_attributes.get(name)
    if a is None:
        a = me.color_attributes.new(name, 'FLOAT_COLOR', domain)
        buf = np.ones(len(a.data) * 4, np.float32)
        a.data.foreach_set('color', buf)
    return a


def _set_active_color(me, name):
    ca = me.color_attributes
    idx = [i for i, a in enumerate(ca) if a.name == name][0]
    ca.active_color_index = idx
    ca.render_color_index = idx


def tint_islands(obj, seed=0, amount=0.08, warm=0.03):
    """島（瓦 1 枚・石 1 個など）ごとに明るさと色味を少し変えて頂点色 'Col' に書く（既存の値に掛ける）"""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.index_update()
    isl, nisl = _islands(bm)
    vis = np.zeros(len(bm.verts), np.int64)
    for f in bm.faces:
        for v in f.verts:
            vis[v.index] = isl[f.index]
    bm.free()
    rng = np.random.default_rng(seed)
    b = np.clip(1 + amount * rng.standard_normal(nisl), 1 - 2.5 * amount, 1 + 2 * amount)
    wv = warm * rng.standard_normal(nisl)
    per = np.stack([b * (1 + wv), b, b * (1 - wv), np.ones(nisl)], -1).astype(np.float32)
    a = _color_attr(me)
    cur = np.empty(len(a.data) * 4, np.float32)
    a.data.foreach_get('color', cur)
    cur = cur.reshape(-1, 4)
    if a.domain == 'POINT':
        cur *= per[vis]
    else:
        lv = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get('vertex_index', lv)
        cur *= per[vis[lv]]
    a.data.foreach_set('color', cur.ravel())
    _set_active_color(me, COLOR_ATTR)


def _ensure_object_mode():
    o = bpy.context.view_layer.objects.active
    if o is not None and o.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')


def _apply_modifiers(o):
    if not o.modifiers:
        return
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def _make_single_user(o):
    if o.data.users > 1:
        o.data = o.data.copy()


def _ground(objs, z=None):
    """一時的な地面（遮蔽の相手）"""
    mn = np.array([1e9, 1e9, 1e9])
    mx = -mn
    for o in objs:
        for c in o.bound_box:
            p = np.array(o.matrix_world @ mathutils.Vector(c))
            mn = np.minimum(mn, p)
            mx = np.maximum(mx, p)
    size = float(max(mx[0] - mn[0], mx[1] - mn[1]) * 3 + 20)
    me = bpy.data.meshes.new('_ao_ground')
    s = size / 2
    cx, cy = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
    gz = mn[2] if z is None else z
    me.from_pydata([(cx - s, cy - s, gz), (cx + s, cy - s, gz), (cx + s, cy + s, gz), (cx - s, cy + s, gz)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('_ao_ground', me)
    bpy.context.scene.collection.objects.link(g)
    return g


def _bake_setup(samples, distance):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    if s.world is None:
        s.world = bpy.data.worlds.new('ao-world')
    s.world.light_settings.distance = distance
    return s


def _select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake_ao_to_color(objects, ground_plane=True, samples=48, *, distance=1.5, strength=0.6, gamma=1.0,
                     multiply_existing=True, apply_modifiers=True, switch_materials=True, ground_z=None):
    """
    環境光の遮蔽（AO）を Cycles で頂点色 'Col'（有効な色属性 → glTF の COLOR_0）に焼く。
    細かい形（瓦・格子・垂木・石・小物）向け。頂点が粗い大きな平面にはしみが出ないので bake_ao_to_texture を使う。
    値 = 1 - strength * (1 - ao**gamma)（strength=0.6 なら最も暗くて 0.4）。頂点色は three.js で基本色に掛かる＝日なたも暗くなるので強くしすぎない。
    multiply_existing: 既にある 'Col'（tint_islands の色むら）に掛ける。
    ground_plane: 物体の一番低いところ（または ground_z）に一時的な地面を置いて接地の陰を作る。
    場面にある他の物体（選んでいないもの）も遮蔽に入る。モディファイアは先に適用する。
    switch_materials: ライブラリの材質を '@vc' 版に替える（Blender の確認描画でも陰が見えるように）。
    """
    objs = [o for o in objects if o.type == 'MESH']
    if not objs:
        return
    _ensure_object_mode()
    s = _bake_setup(samples, distance)
    for o in objs:
        _make_single_user(o)
        if apply_modifiers:
            _apply_modifiers(o)
        me = o.data
        old = me.color_attributes.get('_ao_tmp')
        if old is not None:
            me.color_attributes.remove(old)
        prev = me.color_attributes.get(COLOR_ATTR)
        dom = prev.domain if prev is not None else 'POINT'
        me.color_attributes.new('_ao_tmp', 'FLOAT_COLOR', dom)
        _set_active_color(me, '_ao_tmp')
    g = _ground(objs, ground_z) if ground_plane else None
    _select_only(objs)
    s.render.bake.target = 'VERTEX_COLORS'
    bpy.context.view_layer.update()
    bpy.ops.object.bake(type='AO')
    for o in objs:
        me = o.data
        t = me.color_attributes['_ao_tmp']
        buf = np.empty(len(t.data) * 4, np.float32)
        t.data.foreach_get('color', buf)
        ao = np.clip(buf.reshape(-1, 4)[:, 0], 0, 1)
        val = 1 - strength * (1 - ao ** gamma)
        dom = t.domain
        me.color_attributes.remove(t)
        a = _color_attr(me, COLOR_ATTR, dom)
        cur = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', cur)
        cur = cur.reshape(-1, 4)
        if not multiply_existing:
            cur[:] = 1.0
        cur[:, :3] *= val[:, None]
        a.data.foreach_set('color', cur.ravel())
        _set_active_color(me, COLOR_ATTR)
        if switch_materials:
            for sl in o.material_slots:
                m = sl.material
                if m is not None and m.get('koto_lib') and not m.name.endswith('@vc'):
                    sl.material = get(m['koto_lib'], vcol=True)
    if g is not None:
        _remove_temp(g)
    bpy.context.view_layer.update()


def _remove_temp(g):
    me = g.data
    bpy.data.objects.remove(g, do_unlink=True)
    if me.users == 0:
        bpy.data.meshes.remove(me)


def _gltf_group():
    g = bpy.data.node_groups.get(GLTF_GROUP)
    if g is None:
        g = bpy.data.node_groups.new(GLTF_GROUP, 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        gi = g.nodes.new('NodeGroupInput')
        gi.location = (-200, 0)
    return g


def ensure_lightmap_uv(obj, uv_name='lightmap', margin_px=4, size=1024):
    """
    第 2 UV（重ならない展開）を bmesh で作る（編集モードの演算子は使わない：背景実行で Cycles が落ちることがあるため）。
    面を向き（箱投影の 6 方向）ごとにつながった「島」にまとめ、平らに投影して棚詰めで [0,1] に並べる。
    大きな平面・箱・なだらかな地面向け（同じ向きで重なり合う曲面には向かない）。最初の UV 'UVMap' は描画用のまま。
    """
    me = obj.data
    if len(me.uv_layers) == 0:
        uv_box(obj)
    if me.uv_layers.get(uv_name) is not None:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    lay = bm.loops.layers.uv.new(uv_name)
    M = obj.matrix_world
    NM = M.inverted_safe().transposed().to_3x3()
    key = []
    for f in bm.faces:
        n = NM @ f.normal
        k = max(range(3), key=lambda i: abs(n[i]))
        key.append(k * 2 + (1 if n[k] < 0 else 0))
    parent = list(range(len(bm.faces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for e in bm.edges:
        lf = e.link_faces
        for i in range(len(lf) - 1):
            fa, fb = lf[i].index, lf[i + 1].index
            if key[fa] == key[fb]:
                ra, rb = find(fa), find(fb)
                if ra != rb:
                    parent[ra] = rb
    charts = {}
    for f in bm.faces:
        charts.setdefault(find(f.index), []).append(f)

    def proj(p, k):
        ax = k // 2
        neg = k % 2
        if ax == 2:
            return (p.x, -p.y if neg else p.y)
        if ax == 0:
            return (-p.y if neg else p.y, p.z)
        return (p.x if neg else -p.x, p.z)
    items = []
    for faces in charts.values():
        k = key[faces[0].index]
        pts = {}
        for f in faces:
            for l in f.loops:
                pts[l] = proj(M @ l.vert.co, k)
        xs = [q[0] for q in pts.values()]
        ys = [q[1] for q in pts.values()]
        x0, y0 = min(xs), min(ys)
        items.append([max(xs) - x0, max(ys) - y0, x0, y0, pts])
    area = sum(max(w, 1e-4) * max(h, 1e-4) for w, h, *_ in items)
    gap = math.sqrt(area) * 1.2 * margin_px / size * 2
    items.sort(key=lambda it: -it[1])

    def shelf(width):
        x = y = rowh = used = 0.0
        pl = []
        for it in items:
            w, h = it[0] + gap, it[1] + gap
            if x + w > width and x > 0:
                y += rowh
                x = rowh = 0.0
            pl.append((x, y))
            x += w
            used = max(used, x)
            rowh = max(rowh, h)
        return max(used, y + rowh), used, y + rowh, pl
    wmin = max(it[0] for it in items) + gap
    _, tx, ty, place = min((shelf(max(wmin, math.sqrt(area) * f)) for f in (0.7, 0.85, 1.0, 1.15, 1.3, 1.5, 1.8, 2.2, 3.0)),
                           key=lambda r: r[0])
    for it, (px, py) in zip(items, place):
        w, h, x0, y0, pts = it
        for l, q in pts.items():
            # 縦横別々に [0,1] に広げる（AO は低い周波数なので伸びても困らない）
            l[lay].uv = ((q[0] - x0 + px + gap / 2) / tx, (q[1] - y0 + py + gap / 2) / ty)
    bm.to_mesh(me)
    bm.free()
    main = me.uv_layers[0]
    main.active_render = True
    me.uv_layers.active = main


def bake_ao_to_texture(obj, size=1024, uv_name='lightmap', *, samples=48, distance=2.0, strength=0.75, gamma=1.0,
                       ground_plane=True, margin=8, ground_z=None, path=None, blur_px=1):
    """
    AO を画像に焼き、glTF の occlusionTexture（R、TEXCOORD_1 = 第 2 UV 'lightmap'）としてつなぐ。
    大きな平面（地面・壁・屋根の広い面）向け。three.js では環境光（空・半球光・環境反射）にだけ効く。
    物体ごとに材質を複製する（名前 '<材質>@ao:<物体>'）。画像は build/tex/ao/<物体>.png に保存（GLB に入る）。
    """
    if obj.type != 'MESH':
        return None
    _ensure_object_mode()
    _make_single_user(obj)
    _apply_modifiers(obj)
    ensure_lightmap_uv(obj, uv_name, margin_px=max(2, margin // 2), size=size)
    s = _bake_setup(samples, distance)
    img_name = f'ao_{obj.name}'
    old = bpy.data.images.get(img_name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(img_name, size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    if not obj.material_slots:
        obj.data.materials.append(bpy.data.materials.new('ao-default'))
    nodes_for = []
    for sl in obj.material_slots:
        m = sl.material
        if m is None:
            m = bpy.data.materials.new('ao-default')
            m.use_nodes = True
        if '@ao:' not in m.name:
            m = m.copy()
            m.name = f'{sl.material.name if sl.material else "mat"}@ao:{obj.name}'
            sl.material = m
        m.use_nodes = True
        nt = m.node_tree
        for nd in [nd for nd in nt.nodes if nd.name.startswith('ao_')]:
            nt.nodes.remove(nd)
        uvn = nt.nodes.new('ShaderNodeUVMap')
        uvn.name = 'ao_uv'
        uvn.uv_map = uv_name
        uvn.location = (-900, -650)
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.name = 'ao_tex'
        tn.image = img
        tn.location = (-650, -650)
        nt.links.new(uvn.outputs['UV'], tn.inputs['Vector'])
        nt.nodes.active = tn
        nodes_for.append((m, tn))
    g = _ground([obj], ground_z) if ground_plane else None
    _select_only([obj])
    uvs = obj.data.uv_layers
    uvs.active = uvs[uv_name]          # Cycles は「選択中の UV」に焼く
    s.render.bake.target = 'IMAGE_TEXTURES'
    s.render.bake.margin = margin
    bpy.context.view_layer.update()
    bpy.ops.object.bake(type='AO')
    if g is not None:
        _remove_temp(g)
    uvs.active = uvs[0]
    uvs[0].active_render = True
    bpy.context.view_layer.update()
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    ao = np.clip(px[:, 0], 0, 1)
    if blur_px:
        ao = blur(ao.reshape(size, size), blur_px).ravel()
    val = 1 - strength * (1 - ao ** gamma)
    px[:, 0] = px[:, 1] = px[:, 2] = val
    px[:, 3] = 1
    img.pixels.foreach_set(px.ravel())
    out = pathlib.Path(path) if path else TEX_DIR / 'ao' / f'{obj.name}.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(out)
    img.file_format = 'PNG'
    img.save()
    grp = _gltf_group()
    for m, tn in nodes_for:
        nt = m.node_tree
        sp = nt.nodes.new('ShaderNodeSeparateColor')
        sp.name = 'ao_sep'
        sp.location = (-400, -650)
        gn = nt.nodes.new('ShaderNodeGroup')
        gn.name = 'ao_gltf'
        gn.node_tree = grp
        gn.location = (-150, -650)
        nt.links.new(tn.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Red'], gn.inputs['Occlusion'])
    return img


def game_lights(exposure=0.55, sky_strength=0.6):
    """
    確認用の光をゲームの描画に近づける（common.add_preview_lights は Nishita の空が明るすぎて白飛びする）。
    日差し 3.4・#ffe2bd・ゲームと同じ向き、空は弱い一様な青灰、Filmic（ACES に近い）。render_preview の前に呼ぶ。
    """
    from common import sun_direction_blender
    s = bpy.context.scene
    w = bpy.data.worlds.new('game-sky')
    s.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.56, 0.63, 0.72, 1)
    bg.inputs['Strength'].default_value = sky_strength
    for o in [o for o in s.objects if o.type == 'LIGHT' and o.name.startswith(('game-sun', 'preview-sun'))]:
        bpy.data.objects.remove(o, do_unlink=True)
    L = bpy.data.lights.new('game-sun', 'SUN')
    L.energy = 3.4
    L.color = (1.0, 0.886, 0.741)
    L.angle = math.radians(1.2)
    o = bpy.data.objects.new('game-sun', L)
    s.collection.objects.link(o)
    o.rotation_euler = sun_direction_blender().to_track_quat('Z', 'Y').to_euler()
    s.view_settings.view_transform = 'Filmic'
    s.view_settings.look = 'None'
    s.view_settings.exposure = exposure


# ---------------------------------------------------------------------------
# 調べる道具
# ---------------------------------------------------------------------------

def glb_summary(path) -> dict:
    """GLB の JSON を読んで、材質ごとの画像・頂点色・occlusionTexture の有無を返す（書き出しの確認用）"""
    import json
    import struct
    b = pathlib.Path(path).read_bytes()
    ln = struct.unpack('<I', b[12:16])[0]
    js = json.loads(b[20:20 + ln])
    mats_out = []
    for m in js.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        mats_out.append(dict(name=m.get('name'), base='baseColorTexture' in pbr, mr='metallicRoughnessTexture' in pbr,
                             normal='normalTexture' in m, occlusion=m.get('occlusionTexture')))
    prims = []
    for me in js.get('meshes', []):
        for p in me['primitives']:
            prims.append(dict(mesh=me.get('name'), attrs=sorted(p['attributes']), material=p.get('material')))
    return dict(materials=mats_out, primitives=prims, images=[(i.get('name'), i.get('mimeType')) for i in js.get('images', [])])


if __name__ == '__main__':
    import sys
    build_all(force='--force' in sys.argv)
    print('textures in', TEX_DIR)
