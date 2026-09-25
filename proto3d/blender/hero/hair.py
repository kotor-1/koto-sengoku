"""
髪：頭の形に沿った薄い髪の層（生え際で厚み 0 まで細る）＋ なでつけた束（盛り上がった帯）＋ 髷（まげ）と元結 ＋ うなじの短い毛。
髪はすべて後頭部の上（頭頂の約 5cm 後ろ）の結び目へ引き上げる。UV もその点を中心にした角度で作るので、
画像の縦の筋がそのまま「結び目へ向かう毛の流れ」になる（うなじの毛も上へ流れる）。
髷は 2 つのねじれた玉（下の大きい玉と上の小さい玉）、その間を元結（4 巻き、幅 2cm）で締める。
うなじの生え際は頭の丸みに沿った浅い W 字（真ん中が 1.5cm 低い）で、短い透ける毛の板を並べて硬い縁を消す。
耳の上は 1cm あけて、髪はまっすぐ後ろへなでつける。座標はゲームの向き。
"""
from __future__ import annotations

import math

import numpy as np

import anatomy as A
from sdf import F, capsule, ellipsoid, mesh_sdf, orient_outward, project, smin, smax, sphere, axis_angle

C = np.array([0.0, 1.630, -0.012])                  # 頭の中心（流れの計算の基準）
TIE_DIR = np.array([0.0, math.cos(math.radians(36)), -math.sin(math.radians(36))])
E1 = np.array([1.0, 0.0, 0.0])
E2 = np.cross(TIE_DIR, E1)

# 生え際：頭の周りの角度（前 0°、横 90°、後ろ 180°）ごとの高さ
_HL_T = np.array([0, 18, 30, 42, 52, 60, 67, 73, 78, 82, 87, 100, 110, 118, 124, 132, 145, 155, 165, 173, 180])
_HL_Y = np.array([1.706, 1.708, 1.703, 1.693, 1.678, 1.656, 1.632, 1.620, 1.622, 1.646, 1.655, 1.657, 1.648, 1.615, 1.590, 1.570, 1.560, 1.557, 1.561, 1.550, 1.545])


def hairline_y(P):
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    return np.interp(th, _HL_T, _HL_Y).astype(F)


def mask(P):
    """髪のある所 1、無い所 0（生え際で 5mm ほどでなめらかに）"""
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    soft = np.interp(th, [0, 60, 100, 140, 180], [0.006, 0.007, 0.010, 0.014, 0.014]).astype(F)
    m = np.clip((P[:, 1] - hairline_y(P)) / soft, 0, 1)
    return (m * m * (3 - 2 * m)).astype(F)


def _psi(P):
    v = P - C.astype(F)
    v = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    return np.arccos(np.clip(v @ TIE_DIR.astype(F), -1, 1))


def thickness(P):
    """髪の層の厚み：頭頂から結び目のまわりは厚く、横とうなじは 6mm 以下、生え際で 0"""
    m = mask(P)
    psi = _psi(P)
    top = np.clip(1 - psi / math.radians(95), 0, 1)
    t = 0.0034 + 0.0034 * top + 0.0040 * np.exp(-(psi / math.radians(26)) ** 2)
    return (t * m).astype(F)


def cap_sdf(P):
    return A.body(P, ['neck', 'head']) - thickness(P)


def cap_mesh(h=0.0021):
    V, Q = mesh_sdf(cap_sdf, (-.1, 1.53, -.13), (.1, 1.775, .12), h)
    Q = orient_outward(cap_sdf, V, Q)
    Vf = V.astype(F)
    keep = thickness(Vf) > 0.0006
    # 生え際より下（顔・耳）の面を除く
    fk = keep[Q].all(1)
    Q = Q[fk]
    used = np.unique(Q)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used))
    return V[used], remap[Q]


def flow_uv(V, u_repeat=3.0):
    """結び目を中心にした角度の UV（U：周りの角度、V：結び目からの角度）"""
    v = V - C
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    psi = np.arccos(np.clip(v @ TIE_DIR, -1, 1))
    alpha = np.arctan2(v @ E2, v @ E1)
    U = (alpha / (2 * math.pi) + 0.5) * u_repeat
    Vv = psi / math.radians(120)
    return np.column_stack([U, Vv])


def loop_uvs(uv_vert, faces, u_repeat=3.0):
    """面ごとの UV（周りの角度のつなぎ目をまたぐ面は U をずらす）"""
    out = []
    for f in faces:
        uv = uv_vert[list(f)].copy()
        u = uv[:, 0]
        if u.max() - u.min() > u_repeat * 0.5:
            u[u < u_repeat * 0.5] += u_repeat
        out.append(uv)
    return np.concatenate(out)


def surface_points(alpha, psi, offset=0.0):
    """流れの座標（角度の配列）から髪の面の上の点（まとめて）"""
    alpha = np.asarray(alpha, float)
    psi = np.asarray(psi, float)
    d = (np.cos(psi)[:, None] * TIE_DIR + np.sin(psi)[:, None] * (np.cos(alpha)[:, None] * E1 + np.sin(alpha)[:, None] * E2))
    p = C + d * 0.105
    q = project(lambda P: cap_sdf(P) - F(offset), p.astype(F), iters=8, max_step=0.015)
    err = np.abs(cap_sdf(q) - F(offset))
    return q.astype(float), err


def surface_point(alpha, psi, offset=0.0):
    q, _ = surface_points([alpha], [psi], offset)
    return q[0]


def clumps(n=64, seed=7, segs=8):
    """髪の束（なでつけた筋の盛り上がり）。結び目へ向かう帯を、髪の面の上に少し浮かせて置く"""
    rng = np.random.default_rng(seed)
    alphas = np.sort(rng.uniform(-math.pi, math.pi, n)) + rng.uniform(-0.02, 0.02, n)
    psis = np.radians(np.linspace(20, 125, 120))
    # 生え際の角度：髪の厚みが消える所（面の上の点で判定）
    A_, P_ = np.meshgrid(alphas, psis, indexing='ij')
    pts, _ = surface_points(A_.ravel(), P_.ravel(), 0.0)
    th = thickness(pts.astype(F)).reshape(n, len(psis))
    specs = []
    for i in range(n):
        ok = np.nonzero(th[i] > 0.0025)[0]
        if len(ok) == 0:
            continue
        aa = abs(math.degrees(alphas[i]))
        if min(aa, 180 - aa) < 42:        # 横（耳の上）には置かない
            continue
        tip = pts.reshape(n, len(psis), 3)[i, ok[-1]]
        if tip[1] < 1.675 and tip[2] > -0.07:
            continue
        p_end = psis[ok[-1]] - math.radians(rng.uniform(3, 10))
        p_start = math.radians(rng.uniform(12, 20))
        specs.append((alphas[i], p_start, p_end, rng.uniform(0.006, 0.011), rng.uniform(0.0007, 0.0015), rng.uniform(-0.05, 0.05)))
    T = np.linspace(0, 1, segs + 1)
    al_all, ps_all = [], []
    for al, p0, p1, w, lf, dr in specs:
        ps = p0 + (p1 - p0) * T
        a = al + dr * np.sin(T * math.pi)
        al_all.append(a)
        ps_all.append(ps)
    al_all = np.concatenate(al_all)
    ps_all = np.concatenate(ps_all)
    c, e1 = surface_points(al_all, ps_all, 0.0002)
    c2, e2 = surface_points(al_all, ps_all + 0.01, 0.0002)
    V, Fc, UV = [], [], []
    k = 0
    for ci, (al, p0, p1, width, lift, dr) in enumerate(specs):
        base = len(V)
        good = True
        for j in range(segs + 1):
            t = T[j]
            cc = c[k + j]
            if e1[k + j] > 0.002:
                good = False
            tang = c2[k + j] - cc
            tang /= np.linalg.norm(tang) + 1e-12
            nrm = cc - C
            nrm /= np.linalg.norm(nrm)
            side = np.cross(nrm, tang)
            side /= np.linalg.norm(side) + 1e-12
            w = width * (0.35 + 0.65 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.6) * (1 - 0.5 * (1 - t) ** 6)
            lf = lift * math.sin(t * math.pi) ** 0.5
            a = al_all[k + j]
            for jj, q in enumerate((-1.0, 0.0, 1.0)):
                V.append(cc + side * q * w * 0.5 + nrm * (lf + 0.0003 if jj == 1 else 0.00015))
                UV.append((((a / (2 * math.pi) + 0.5) * 3.0) + q * w * 4.0, ps_all[k + j] / math.radians(120)))
        k += segs + 1
        if not good:
            del V[base:]
            del UV[base:]
            continue
        for j in range(segs):
            r0 = base + j * 3
            r1 = r0 + 3
            Fc.append((r0, r1, r1 + 1, r0 + 1))
            Fc.append((r0 + 1, r1 + 1, r1 + 2, r0 + 2))
    return np.array(V), np.array(Fc), np.array(UV)


# ---- 髷（まげ） ----
TIE_POINT = None


def tie_point():
    global TIE_POINT
    if TIE_POINT is None:
        TIE_POINT = surface_point(0.0, 0.0, 0.0)
    return TIE_POINT


BUN_AXIS = np.array([0.0, math.cos(math.radians(33)), -math.sin(math.radians(33))])   # 後ろへ 33° 傾く
BUN_B1 = np.array([1.0, 0.0, 0.0])
BUN_B2 = np.cross(BUN_AXIS, BUN_B1)
BUN_R = np.column_stack([BUN_B1, BUN_AXIS, BUN_B2])      # 局所の軸（列）：横・軸・前後
H_LOW, H_WAIST, H_UP = 0.024, 0.055, 0.077             # 下の玉・くびれ（元結）・上の玉の中心の高さ（結び目から軸に沿って）


def _bun_local(P):
    q = (P - tie_point().astype(F)) @ BUN_R.astype(F)
    return q[:, 0], q[:, 1], q[:, 2]


def bun_sdf(P):
    T = tie_point()
    ax = BUN_AXIS
    x1, h, x2 = _bun_local(P)
    ang = np.arctan2(x2, x1)
    # 根元（引き上げた髪の束）
    root = capsule(P, T - ax * 0.014, T + ax * 0.012, 0.024, 0.021)
    # 下の玉：幅 0.094、ねじれた 2 つの房（溝が斜めに回る）
    low = ellipsoid(P, T + ax * H_LOW, (0.048, 0.023, 0.045), BUN_R)
    low = low + (0.0042 * np.sin(2 * ang + h * 70)).astype(F)
    # くびれ（元結の下）
    waist = capsule(P, T + ax * (H_WAIST - 0.011), T + ax * (H_WAIST + 0.011), 0.0195)
    # 上の玉：少し小さく、ねじれは逆向き
    up = ellipsoid(P, T + ax * H_UP + BUN_B2 * -0.003, (0.034, 0.020, 0.032), BUN_R)
    up = up + (0.0034 * np.sin(2 * ang - h * 70 + 1.0)).astype(F)
    d = smin(root, low, 0.012)
    d = smin(d, waist, 0.008)
    d = smin(d, up, 0.008)
    return d


def bun_mesh(h=0.0016):
    T = tie_point()
    lo = T + np.array([-.06, -.03, -.08])
    hi = T + np.array([.06, .10, .05])
    V, Q = mesh_sdf(bun_sdf, lo, hi, h)
    Q = orient_outward(bun_sdf, V, Q)
    return V, Q


def bun_uv(V, repeat=2.0):
    """髷：軸の周りの角度（U）と高さ（V）。ねじれた筋にするため U を高さで回す"""
    x1, h, x2 = _bun_local(np.asarray(V, F))
    ang = np.arctan2(x2, x1)
    U = (ang / (2 * math.pi) + 0.5) * repeat + h * 11.0
    return np.column_stack([U, h * 12.0])


def motoyui(seg=24, rows=9):
    """元結：髷のくびれに 4 回巻いた白い紙の紐（幅 2cm の帯に 4 本の畝）"""
    T = tie_point()
    ax, b1, b2 = BUN_AXIS, BUN_B1, BUN_B2
    V, Fc = [], []
    for j in range(rows):
        q = j / (rows - 1)
        hh = H_WAIST - 0.010 + 0.020 * q
        rr = 0.0212 + 0.0011 * abs(math.sin(math.pi * 4 * q)) - 0.0012 * (q in (0.0, 1.0))
        for i in range(seg):
            a = 2 * math.pi * i / seg
            V.append(T + ax * hh + (math.cos(a) * b1 + math.sin(a) * b2) * rr)
    for j in range(rows - 1):
        for i in range(seg):
            a0 = j * seg + i
            a1 = j * seg + (i + 1) % seg
            Fc.append((a0, a1, a1 + seg, a0 + seg))
    return np.array(V), np.array(Fc)


def bun_strands(seed=3):
    """髷の玉に巻きついた、ほつれた細い束（4 本）。平たい帯、先が細る"""
    rng = np.random.default_rng(seed)
    T = tie_point()
    ax, b1, b2 = BUN_AXIS, BUN_B1, BUN_B2
    V, Fc, UV = [], [], []
    for k in range(4):
        a0 = rng.uniform(0, 2 * math.pi)
        hc = H_LOW + rng.uniform(-0.004, 0.012) if k < 3 else H_UP
        rad = (0.047, 0.044) if k < 3 else (0.034, 0.032)
        span = rng.uniform(1.2, 1.9)
        n = 9
        base = len(V)
        for j in range(n):
            t = j / (n - 1)
            a = a0 + span * t
            e = np.array([math.cos(a), math.sin(a)])
            hh = hc + (t - 0.5) * 0.018
            ring = math.sqrt(max(0.05, 1 - ((hh - (H_LOW if k < 3 else H_UP)) / 0.026) ** 2))
            p = T + ax * hh + (e[0] * b1 * rad[0] + e[1] * b2 * rad[1]) * ring * 1.05
            nrm = (e[0] * b1 + e[1] * b2)
            tang = (-math.sin(a) * b1 + math.cos(a) * b2)
            side = np.cross(nrm, tang)
            w = 0.0045 * (1 - 0.8 * t)
            for q in (-1, 1):
                V.append(p + side * q * w + nrm * 0.0012)
                UV.append((q * 0.02 + k * 0.3, t * 0.4))
        for j in range(n - 1):
            a = base + 2 * j
            Fc.append((a, a + 2, a + 3, a + 1))
    return np.array(V), np.array(Fc), np.array(UV)


def nape_wisps(n=22, seed=13):
    """うなじの生え際に並べる短い毛の板（長さ 1.3〜2cm、幅 0.8〜1.2cm）。根元は髪の層の上、先は首の上に垂れる。
    透ける画像（毛の先が細い）を貼る。返り値は頂点・面・UV（V：根元 1、先 0）"""
    rng = np.random.default_rng(seed)
    skin = lambda P: A.body(P, ['neck', 'head'])
    V, Fc, UV = [], [], []
    ths = np.linspace(132, 228, n) + rng.uniform(-2.0, 2.0, n)
    for th in ths:
        t = math.radians(th)
        dirh = np.array([math.sin(t), 0.0, math.cos(t)])
        yl = float(np.interp(abs(((th + 180) % 360) - 180), _HL_T, _HL_Y))
        L = rng.uniform(0.009, 0.015)
        wdt = rng.uniform(0.009, 0.013)
        pts = []
        for q in np.linspace(0, 1, 4):
            y = yl + 0.008 - (0.008 + L * 0.75) * q
            p0 = np.array([0.0, y, C[2]]) + dirh * 0.12
            pts.append(p0)
        pts = np.array(pts)
        off = np.array([0.0012, 0.0010, 0.0008, 0.0007])
        for _ in range(12):
            d = skin(pts.astype(F)).astype(float) - off
            g = np.array([pts[:, 0], np.zeros(len(pts)), pts[:, 2] - C[2]]).T
            g /= np.linalg.norm(g, axis=1, keepdims=True)
            pts -= g * np.clip(d, -0.02, 0.02)[:, None]
        # 根元は髪の層の上に
        pts[0] += dirh * float(thickness(pts[:1].astype(F))[0])
        tang = np.array([math.cos(t), 0.0, -math.sin(t)])
        sw = rng.uniform(-0.25, 0.25)
        base = len(V)
        for j, p in enumerate(pts):
            q = j / (len(pts) - 1)
            w = wdt * (1 - 0.35 * q)
            c = p + tang * sw * 0.004 * q
            V.append(c - tang * w / 2)
            V.append(c + tang * w / 2)
            UV.append((0.0, 1 - q))
            UV.append((1.0, 1 - q))
        for j in range(len(pts) - 1):
            a = base + 2 * j
            Fc.append((a, a + 1, a + 3, a + 2))
    return np.array(V), np.array(Fc), np.array(UV)
