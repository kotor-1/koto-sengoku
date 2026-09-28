"""
髪（第 2 版の頭に合わせて 2026-09 に作り直し。旧は archive/head_v1_5761a83/hair.py）：
頭の形に沿った厚みのある髪の塊（頭頂で 1.7cm ほど、横 1cm、生え際で 0 まで細る）。塊の表面には、結び目へ向かう束の山と谷
（角度ごとの厚みの増減）を付けて、流れのある束に見せる ＋ 額の生え際から顔の横へ垂れる房（平たい束、先ほど肌から離れる）
＋ 髷（まげ）と元結 ＋ うなじの短い毛。生え際は こめかみ → もみあげ（耳の前へ下がる）→ 耳の上 → うなじ とつながる。
髪はすべて後頭部の上（頭頂の約 5cm 後ろ）の結び目へ引き上げる。UV もその点を中心にした角度で作るので、
画像の縦の筋がそのまま「結び目へ向かう毛の流れ」になる（うなじの毛も上へ流れる）。
髷（2026-09 第 4 案）は茶筅髷：結び目から立つ短い筒を元結（白い紙の紐、幅 2.2cm）で巻き、その先の房が刷毛のように広がって後ろへ反る。
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
_HL_T = np.array([0, 12, 22, 32, 40, 47, 53, 58, 63, 68, 72, 76, 79, 82, 86, 92, 100, 108, 116, 126, 140, 155, 168, 180])
# 2026-09 第 5 案：額の生え際を 6mm 下げ、こめかみに浅い剃り込み（22〜32°）。耳の上（82〜108°）は 3cm 下げて耳の上の 3 分の 1 を髪で覆う
_HL_Y = np.array([1.701, 1.702, 1.704, 1.701, 1.690, 1.678, 1.664, 1.650, 1.635, 1.620, 1.608, 1.603, 1.612, 1.628, 1.631, 1.633, 1.632, 1.624, 1.600, 1.576, 1.558, 1.550, 1.547, 1.545])


def hairline_y(P):
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    y = np.interp(th, _HL_T, _HL_Y)
    # 生え際の小さな不ぞろい（額からこめかみ。左右で少し違う）
    sg = np.sign(P[:, 0]) + 0.5
    jit = 0.0012 * np.sin(np.radians(th) * 23 + 1.3 * sg) + 0.0007 * np.sin(np.radians(th) * 41 + 0.4 + sg)
    y = y + jit * np.clip((72 - th) / 12, 0, 1)
    return y.astype(F)


def mask(P):
    """髪のある所 1、無い所 0（生え際で 5mm ほどでなめらかに）"""
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    soft = np.interp(th, [0, 50, 70, 80, 86, 104, 112, 140, 180], [0.026, 0.020, 0.010, 0.009, 0.004, 0.004, 0.009, 0.014, 0.014]).astype(F)
    m = np.clip((P[:, 1] - hairline_y(P)) / soft, 0, 1)
    return (m * m * m * (10 - 15 * m + 6 * m * m)).astype(F)     # 生え際で薄く（縁が立たない）


def _psi(P):
    v = P - C.astype(F)
    v = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    return np.arccos(np.clip(v @ TIE_DIR.astype(F), -1, 1))


def flow_angle(P):
    """結び目の軸のまわりの角度（束の並ぶ向き）"""
    v = P - C.astype(F)
    return np.arctan2(v @ E2.astype(F), v @ E1.astype(F))


N_CLUMP = 30


def clump_profile(P):
    """束の山と谷（1 が山の頂、0 が谷）。結び目へ向かう線に沿って続き、少しずつねじれる。束の幅は少しずつ違う"""
    a = flow_angle(P)
    psi = _psi(P)
    ph = (a * N_CLUMP + 1.7 * np.sin(3 * a + 0.8) + 1.1 * np.sin(5 * a + 2.0) + 0.8 * np.sin(11 * a + 0.3)
          + 2.2 * psi + 0.9 * np.sin(4 * psi + 3 * a))
    main = 0.5 + 0.5 * np.cos(ph)
    # 束ごとの深さのむら（隣り合う束で山の高さが違う。浅い束も混ぜて、規則的な溝に見えない）
    idx = np.floor(ph / (2 * math.pi) + 0.5)
    amp = 0.30 + 0.70 * (0.5 + 0.5 * np.sin(idx * 12.9898 + 4.1)) ** 1.5
    main = 1 - (1 - main) * amp
    # 太い束（17 本の周期）を場所によって混ぜる：束の幅がそろわない
    ph2 = a * 17 + 2.1 * np.sin(2 * a + 1.1) + 1.6 * psi + 0.7 * np.sin(6 * a + 2.5)
    main2 = 0.5 + 0.5 * np.cos(ph2)
    wmix = 0.45 * (0.5 + 0.5 * np.sin(3 * a + 1.7 + 2.0 * psi))
    main = main * (1 - wmix) + main2 * wmix
    fine = 0.5 + 0.5 * np.cos(ph * 2.6 + 1.3 * np.sin(7 * a + psi * 3))
    return main.astype(F), fine.astype(F)


def base_thickness(P):
    """山と谷を付ける前の厚み：頭頂と前（額の上）は厚く、横は 7mm ほど、生え際で 0"""
    m = mask(P)
    psi = _psi(P)
    top = np.clip(1 - psi / math.radians(100), 0, 1)
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    front = np.exp(-(th / 48) ** 2) * np.clip((P[:, 1] - 1.675) / 0.03, 0, 1)
    # 2026-09 第 4 案：量を増やす（頭頂 1.7cm・横 1cm・額の上 1.4cm。旧は頭頂 1.5cm・横 7mm）。後ろへなでつけた髪のふくらみ
    t = 0.0080 + 0.0085 * top + 0.0030 * np.exp(-(psi / math.radians(24)) ** 2) + 0.0045 * front
    # 2026-09 第 5 案：耳の上は髪を厚くして耳の上の端を覆う（髪の層は耳を含まない頭の面から測るので、耳の上が髪の下に入る）
    ear = np.exp(-((th - 94) / 14) ** 2) * np.clip((P[:, 1] - 1.620) / 0.010, 0, 1) * np.clip((1.690 - P[:, 1]) / 0.025, 0, 1)
    t = t + 0.0068 * ear
    return (t * m).astype(F)


def thickness(P):
    """髪の層の厚み（束の山と谷つき）。結び目の近くは束が詰まるので谷を浅く"""
    t = base_thickness(P)
    main, fine = clump_profile(P)
    psi = _psi(P)
    fade = np.clip((psi - math.radians(14)) / math.radians(16), 0, 1)
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - C[2]))
    fade = fade * (1 - 0.6 * np.exp(-((th - 90) / 22) ** 2) * np.clip((1.67 - P[:, 1]) / 0.03, 0, 1))
    k = 1 - fade * (0.30 * (1 - main) ** 1.6 + 0.07 * (1 - fine))
    return (t * k).astype(F)


def cap_sdf(P):
    # 耳を含まない頭の面から（耳の上の端は髪の下に入る）
    return A.body(P, ['neck', 'headnoear']) - thickness(P)


def cap_mesh(h=0.0017):
    V, Q = mesh_sdf(cap_sdf, (-.108, 1.53, -.14), (.108, 1.79, .125), h)
    Q = orient_outward(cap_sdf, V, Q)
    Vf = V.astype(F)
    keep = thickness(Vf) > 0.0006
    # 生え際より下（顔・耳）の面を除く
    fk = keep[Q].all(1)
    Q = Q[fk]
    used = np.unique(Q)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used))
    V, Q = V[used], remap[Q]
    return smooth_border(V, Q), Q


def smooth_border(V, Q, iters=6):
    """切り取った縁（格子の段々）を、縁に沿ってならし、髪の面へ戻す"""
    E = np.sort(np.stack([Q, np.roll(Q, -1, axis=1)], -1).reshape(-1, 2), axis=1)
    Eu, cnt = np.unique(E, axis=0, return_counts=True)
    B = Eu[cnt == 1]
    nb = {}
    for a, b in B:
        nb.setdefault(a, []).append(b)
        nb.setdefault(b, []).append(a)
    idx = np.array([i for i in nb if len(nb[i]) == 2])
    if len(idx) == 0:
        return V
    n1 = np.array([nb[i][0] for i in idx])
    n2 = np.array([nb[i][1] for i in idx])
    V = V.copy()
    for _ in range(iters):
        V[idx] = 0.5 * V[idx] + 0.25 * (V[n1] + V[n2])
    V[idx] = project(cap_sdf, V[idx].astype(F), iters=3, max_step=0.002).astype(np.float64)
    return V


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
H_LOW, H_WAIST, H_UP = 0.024, 0.013, 0.046             # （旧の下の玉）・元結の中心・（旧の玉の中心）の高さ（結び目から軸に沿って）
ROOT_TOP = 0.030                                       # 根元の筒の上の端（ここから房が広がる）


def _bun_local(P):
    q = (P - tie_point().astype(F)) @ BUN_R.astype(F)
    return q[:, 0], q[:, 1], q[:, 2]


def bun_sdf(P):
    """髷の根元（2026-09 第 4 案、茶筅髷）：結び目から立ち上がる短い筒（元結で巻く）。その先は房（tuft()）に分かれる。
    旧（玉の形）は archive/head_v1_5761a83/hair.py と git の履歴"""
    T = tie_point()
    ax = BUN_AXIS
    root = capsule(P, T - ax * 0.014, T + ax * ROOT_TOP, 0.0150, 0.0118)
    return root


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


def motoyui(seg=24, rows=13):
    """元結：髷の根元に巻いた白い紙の紐（幅 2.2cm に 5 本の畝）"""
    T = tie_point()
    ax, b1, b2 = BUN_AXIS, BUN_B1, BUN_B2
    V, Fc = [], []
    for j in range(rows):
        q = j / (rows - 1)
        hh = 0.003 + 0.022 * q
        r_root = 0.0150 + (0.0118 - 0.0150) * (hh + 0.014) / (ROOT_TOP + 0.014)
        rr = r_root + 0.0009 + 0.0007 * abs(math.sin(math.pi * 5 * q)) - 0.0008 * (q in (0.0, 1.0))
        for i in range(seg):
            a = 2 * math.pi * i / seg
            V.append(T + ax * hh + (math.cos(a) * b1 + math.sin(a) * b2) * rr)
    for j in range(rows - 1):
        for i in range(seg):
            a0 = j * seg + i
            a1 = j * seg + (i + 1) % seg
            Fc.append((a0, a1, a1 + seg, a0 + seg))
    return np.array(V), np.array(Fc)


def tube(path, radii, ring=6, flat=1.0, up=None, uv_u0=0.0, uv_v=(0.0, 1.0), twist=0.0, u_span=0.06):
    """道の点の列に沿う管（先を閉じる）。断面は楕円（flat 倍に平たい。平たい向きは up に直交）。返り値：頂点・面・UV"""
    path = np.asarray(path, float)
    n = len(path)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    up = np.array([0.0, 1.0, 0.0]) if up is None else np.asarray(up, float)
    V, Fc, UV = [], [], []
    ups = up if up.ndim == 2 else np.tile(up, (n, 1))
    for j in range(n):
        u = ups[j] - T[j] * (ups[j] @ T[j])
        if np.linalg.norm(u) < 1e-6:
            u = np.array([1.0, 0, 0]) - T[j] * T[j][0]
        u /= np.linalg.norm(u)
        b = np.cross(T[j], u)
        tw = twist * j / max(n - 1, 1)
        u, b = u * math.cos(tw) + b * math.sin(tw), b * math.cos(tw) - u * math.sin(tw)
        for k in range(ring):
            a = 2 * math.pi * k / ring
            V.append(path[j] + (b * math.cos(a) + u * math.sin(a) * flat) * radii[j])
            UV.append((uv_u0 + u_span * k / ring, uv_v[0] + (uv_v[1] - uv_v[0]) * j / (n - 1)))
    for j in range(n - 1):
        for k in range(ring):
            a0 = j * ring + k
            a1 = j * ring + (k + 1) % ring
            Fc.append((a0, a1, a1 + ring, a0 + ring))
    tip = len(V)
    V.append(path[-1] + T[-1] * radii[-1])
    UV.append((uv_u0 + u_span * 0.5, uv_v[1]))
    last = (n - 1) * ring
    for k in range(ring):
        Fc.append((last + k, last + (k + 1) % ring, tip))
    return V, Fc, UV


def tuft(n=8, seed=5):
    """髷の房（2026-09 第 5 案）：根元の筒の上から後ろへ倒れ、先ほど下へ垂れる太めの束 8 本（旧：細い 15 本の刷毛）。
    束は平たく、先で 2〜3 本に分かれて細る（先が柔らかく見える）。前から見て頭のてっぺんより上へ突き出さない"""
    rng = np.random.default_rng(seed)
    T = tie_point()
    ax, b1, b2 = BUN_AXIS, BUN_B1, BUN_B2
    back = np.array([0.0, 0.10, -1.0])
    back /= np.linalg.norm(back)
    down = np.array([0.0, -1.0, 0.0])
    V, Fc, UV = [], [], []

    def add(v, f, uv):
        base = len(V)
        V.extend(v)
        UV.extend(uv)
        Fc.extend([tuple(x + base for x in ff) for ff in f])
    for k in range(n):
        ang = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n
        e = math.cos(ang) * b1 + math.sin(ang) * b2
        r0 = 0.0060 * math.sqrt(rng.uniform(0.3, 1.0))
        start = T + ax * (ROOT_TOP - 0.006) + e * r0
        spread = math.radians(rng.uniform(8, 20))
        d0 = ax * 0.55 + back * 0.45
        d0 = d0 / np.linalg.norm(d0) * math.cos(spread) + e * math.sin(spread)
        L = rng.uniform(0.070, 0.090)
        m = 12
        pts = []
        p = start.copy()
        d = d0 / np.linalg.norm(d0)
        for j in range(m):
            t = j / (m - 1)
            pts.append(p.copy())
            d = d + back * 0.10 + down * (0.07 + 0.20 * t) + e * 0.02
            d /= np.linalg.norm(d)
            p = p + d * L / (m - 1)
        pts = np.array(pts)
        t = np.linspace(0, 1, m)
        R0 = 0.0062 * rng.uniform(0.85, 1.15)
        rad = R0 * (1 - 0.55 * t ** 1.2)
        # 太い束（先の 3 割は細い束に任せる）
        mc = int(m * 0.75)
        v, f, uv = tube(pts[:mc], rad[:mc] * (1 - 0.5 * np.linspace(0, 1, mc) ** 3), ring=6, flat=0.6, up=e,
                        uv_u0=k * 0.13, uv_v=(0.0, 0.4), twist=rng.uniform(-0.8, 0.8))
        add(v, f, uv)
        # 先の細い束（2〜3 本）：太い束の半ばから出て、少し広がって細る
        side = np.cross(pts[-1] - pts[0], e)
        side /= np.linalg.norm(side) + 1e-12
        for q in range(2):
            j0 = int(m * 0.35)
            sub = pts[j0:].copy()
            uu = np.linspace(0, 1, len(sub))
            sgn = (q - 0.5) * 2 + rng.uniform(-0.3, 0.3)
            Ls = rng.uniform(0.85, 1.12)
            sub = sub[0] + (sub - sub[0]) * Ls
            sub = sub + (side * sgn * 0.0035 + e * rng.uniform(-0.002, 0.002))[None, :] * (uu ** 1.5)[:, None]
            sub = sub + down * 0.004 * (uu ** 2)[:, None] * rng.uniform(0.3, 1.0)
            rs = R0 * 0.42 * (1 - 0.9 * uu ** 1.2)
            v, f, uv = tube(sub, rs, ring=4, flat=0.7, up=e, uv_u0=k * 0.13 + 0.04 * q, uv_v=(0.15, 0.5))
            add(v, f, uv)
    return np.array(V), Fc, np.array(UV)


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


# ---- 顔のまわりの房の道（Catmull-Rom の曲線） ----
def _catmull(pts, n):
    pts = np.asarray(pts, float)
    P = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


# ---- 顔のまわりの房（2026-09 第 5 案）：分け目の近く（髪の塊の中）から出て、額の端・こめかみの前へ垂れる幅の広い平たい束。
# 1 房 = 並んだ細い束 5〜7 本（断面は平たい。真ん中が少し厚い）＋ その下の透ける毛の板。先は束が少しずつ分かれて長さがそろわない。
# 前髪の房（F）は額の端を斜めに横切って眉の外の端の高さまで、横の房（L）はこめかみの前を頬骨の横まで。目にはかからない（目じりより外）。
# 旧（第 4 案：細い管の房 3 本）は git の履歴
LOCKS = [
    # (制御点（左 s=+1 の形。x に s を掛ける）, 根元の半幅, 細い束の数, s, 種, 肌からの距離（先）)
    ([(.006, 1.748, .050), (.018, 1.733, .080), (.032, 1.710, .092), (.046, 1.684, .090), (.057, 1.662, .083),
      (.064, 1.644, .074)], .0105, 3, 1, 1, .0045),
    ([(.030, 1.742, .058), (.047, 1.720, .078), (.060, 1.694, .078), (.068, 1.664, .066), (.072, 1.634, .052),
      (.074, 1.606, .044), (.074, 1.588, .040)], .0080, 3, 1, 2, .0070),
    ([(.004, 1.748, .052), (.016, 1.734, .082), (.029, 1.713, .094), (.043, 1.688, .093), (.055, 1.664, .086),
      (.063, 1.642, .076), (.068, 1.624, .066)], .0110, 3, -1, 3, .0050),
    ([(.034, 1.740, .056), (.052, 1.714, .070), (.064, 1.686, .064), (.070, 1.656, .050), (.073, 1.628, .040)], .0070, 2, -1, 4, .0060),
]


def _grad(fn, p, e=2e-4):
    g = np.zeros_like(p)
    for k in range(3):
        d = np.zeros(3)
        d[k] = e
        g[:, k] = (fn((p + d).astype(F)) - fn((p - d).astype(F))) / (2 * e)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def _lock_path(ctrl, s, seed, tip_off=0.006, n_per=4):
    rng = np.random.default_rng(seed)
    c = np.array(ctrl, float)
    c[:, 0] *= s
    c[2:] += rng.normal(0, 0.0008, (len(c) - 2, 3)) * np.array([1, 0.4, 1])
    sp = _catmull(c, n_per)
    n = len(sp)
    tt = np.linspace(0, 1, n)
    # 髪の面・肌からの距離：根元は髪の塊の中（-2.5mm）→ 生え際を越えて 2.5mm → 先で tip_off
    want = -0.0025 + 0.0050 * _sm(tt / 0.30) + (tip_off - 0.0025) * _sm((tt - 0.3) / 0.7)
    for _ in range(24):
        d = cap_sdf(sp.astype(F)).astype(float)
        g = _grad(cap_sdf, sp)
        push = np.clip(want - d, -0.003, 0.004) * np.where(tt < 0.12, 0.3, 1.0)
        sp += g * push[:, None]
    return sp


def _sm(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def lock_meshes():
    """房：並んだ細い束（管、房の材質）、房ごとの透ける板（毛の板の材質）。返り値：(V, F, UV), (V2, F2, UV2)"""
    V, Fc, UV = [], [], []
    V2, F2, UV2 = [], [], []

    def add(v, f, uv):
        base = len(V)
        V.extend(v)
        UV.extend(uv)
        Fc.extend([tuple(x + base for x in ff) for ff in f])
    for ctrl, w0, nsub, s, seed, tip_off in LOCKS:
        sp = _lock_path(ctrl, s, seed, tip_off)
        n = len(sp)
        tt = np.linspace(0, 1, n)
        N = _grad(cap_sdf, sp)
        T = np.gradient(sp, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True)
        N = N - T * (N * T).sum(1, keepdims=True)
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        B = np.cross(T, N)
        B /= np.linalg.norm(B, axis=1, keepdims=True) + 1e-12
        rng = np.random.default_rng(seed + 50)
        half = w0 * (1 - 0.45 * tt ** 1.2)                 # 房の半幅（根元 → 先で半分）
        # 房の本体：平たい幅の広い束（断面は薄い楕円）。画像の毛の筋が幅の中に何本も並ぶ（u_span を広く）。先の 2 割で細る
        mm = n
        u = np.linspace(0, 1, mm)
        r = half * (1 - 0.70 * np.clip((u - 0.55) / 0.45, 0, 1) ** 1.3)
        v, fc, uv = tube(sp, r, ring=8, flat=0.15, up=N, uv_u0=seed * 0.2, uv_v=(0.0, 0.55), twist=0.0, u_span=0.22)
        add(v, fc, uv)
        # 先で分かれる細い束：本体の半ばから出て、本体の縁の外へ少し広がり、本体より少し長い（先が柔らかくそろわない）
        for k in range(nsub):
            f = (k + 0.5) / nsub - 0.5
            j0 = int(n * rng.uniform(0.35, 0.55))
            sub = sp[j0:].copy()
            ms = len(sub)
            uu = np.linspace(0, 1, ms)
            ext = rng.uniform(1.0, 1.15)
            sub = sub[0] + (sub - sub[0]) * ext
            fan = (f * 2) * half[j0:] * 0.95 + (f * 2) * rng.uniform(0.001, 0.004) * uu ** 2 + rng.normal(0, 0.0008) * uu ** 2
            p = sub + B[j0:] * fan[:, None] + N[j0:] * (0.0006 + 0.0004 * (k % 2))
            rr = (w0 / nsub * 1.2) * (1 - 0.88 * uu ** 1.2)
            v, fc, uv = tube(p, rr, ring=4, flat=0.5, up=N[j0:], uv_u0=seed * 0.2 + 0.05 * k, uv_v=(0.25, 0.55))
            add(v, fc, uv)
        # 透ける板（束の下、肌の側に少し沈める。幅は房の幅の 1.3 倍、先は束より少し長い）
        base = len(V2)
        ext = np.vstack([sp, sp[-1] + (sp[-1] - sp[-2]) * np.arange(1, 4)[:, None]])
        Ne = np.vstack([N, np.repeat(N[-1:], 3, 0)])
        Be = np.vstack([B, np.repeat(B[-1:], 3, 0)])
        ne = len(ext)
        for j in range(ne):
            t = j / (ne - 1)
            w = 2.6 * w0 * (1 - 0.45 * t)
            p = ext[j] - Ne[j] * 0.0007
            V2.append(p - Be[j] * w / 2)
            V2.append(p + Be[j] * w / 2)
            UV2.append((0.0, 1 - t))
            UV2.append((1.0, 1 - t))
        for j in range(ne - 1):
            a = base + 2 * j
            F2.append((a, a + 1, a + 3, a + 2))
    return (np.array(V), Fc, np.array(UV)), (np.array(V2), np.array(F2), np.array(UV2))
