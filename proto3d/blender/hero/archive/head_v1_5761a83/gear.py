"""
大小（刀・脇差）と草履。座標はゲームの向き（x 左、y 上、z 前）。
刀は左の腰で帯に差す：柄は前（少し内・上）、鞘は後ろ・外・下へ。刃は上向きなので、鞘の中ほどが少し下がる反り。
"""
from __future__ import annotations

import math

import numpy as np

import anatomy as A
from sdf import F, project


def _frame(d, up=(0, 1, 0)):
    d = np.asarray(d, float)
    d /= np.linalg.norm(d)
    u = np.asarray(up, float) - d * (d @ np.asarray(up, float))
    u /= np.linalg.norm(u)
    s = np.cross(d, u)
    return d, u, s


def sweep(path, U, S, radii, seg=16, cap0=True, cap1=True, u_rep=1.0, v_scale=1.0):
    """path に沿って楕円の断面を並べた筒。radii は (n,2)（u 向き, s 向き）。UV は（周り, 長さ）"""
    n = len(path)
    V, Fc, UV = [], [], []
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    for i in range(n):
        for k in range(seg + 1):
            a = 2 * math.pi * k / seg
            V.append(path[i] + U[i] * math.cos(a) * radii[i][0] + S[i] * math.sin(a) * radii[i][1])
            UV.append((k / seg * u_rep, L[i] * v_scale))
    m = seg + 1
    for i in range(n - 1):
        for k in range(seg):
            a = i * m + k
            Fc.append((a, a + 1, a + m + 1, a + m))
    for cap, i, flip in ((cap0, 0, True), (cap1, n - 1, False)):
        if not cap:
            continue
        c = len(V)
        V.append(path[i])
        UV.append((0.5, L[i] * v_scale))
        for k in range(seg):
            a = i * m + k
            Fc.append((c, a + 1, a) if flip else (c, a, a + 1))
    return np.array(V), Fc, np.array(UV)


def _merge(parts):
    V, Fc, UV = [], [], []
    for v, f, uv in parts:
        b = len(V)
        V.extend(list(v))
        UV.extend(list(uv))
        Fc.extend([tuple(x + b for x in ff) for ff in f])
    return np.array(V), Fc, np.array(UV)


def disc(center, d, u, s, ru, rs, thick, seg=28, rim=0.0015):
    """鍔：楕円の板（縁を少し厚く）"""
    V, Fc, UV = [], [], []
    rings = [(0.0, -thick / 2), (1.0, -thick / 2 - rim * 0.3), (1.0, thick / 2 + rim * 0.3), (0.0, thick / 2)]
    prof = [(0.22, -thick / 2), (0.92, -thick / 2), (1.0, -thick / 2 - rim), (1.0, thick / 2 + rim), (0.92, thick / 2), (0.22, thick / 2)]
    m = seg
    for j, (rr, off) in enumerate(prof):
        for k in range(seg):
            a = 2 * math.pi * k / seg
            V.append(center + d * off + (u * math.cos(a) * ru + s * math.sin(a) * rs) * rr)
            UV.append((k / seg, j / 5))
    for j in range(len(prof) - 1):
        for k in range(seg):
            a = j * m + k
            b = j * m + (k + 1) % seg
            Fc.append((a, b, b + m, a + m))
    # 中の穴（柄が通る）は内の輪をつなぐ
    j = len(prof) - 1
    for k in range(seg):
        a = j * m + k
        b = j * m + (k + 1) % seg
        Fc.append((a, b, (k + 1) % seg, k))
    return np.array(V), Fc, np.array(UV)


def sword(mouth, direction, L_saya, L_tsuka, sori, r_saya=(0.0170, 0.0115), r_tip=(0.0145, 0.0098), r_tsuka=(0.0145, 0.0118), tsuba_r=(0.037, 0.034)):
    """鞘・鍔・柄・金具を部品ごとに返す：{'saya':…, 'metal':…, 'tsuka':…}"""
    mouth = np.asarray(mouth, float)
    d, u, s = _frame(direction)
    # 鞘：口から先へ（反りで中ほどが少し下がる）
    n = 26
    ts = np.linspace(0, 1, n)
    path = np.array([mouth + d * L_saya * t - u * sori * 4 * t * (1 - t) for t in ts])
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    Us = np.array([(u - t_ * (t_ @ u)) / np.linalg.norm(u - t_ * (t_ @ u)) for t_ in T])
    Ss = np.cross(T, Us)
    rad = np.array([np.array(r_saya) * (1 - t) + np.array(r_tip) * t for t in ts])
    rad[-1] *= 0.55
    rad[-2] *= 0.93
    k_cap = int(n * (1 - 0.045 / L_saya))
    saya = sweep(path[:k_cap + 1], Us[:k_cap + 1], Ss[:k_cap + 1], rad[:k_cap + 1] * 0.995, seg=14, cap0=False, cap1=False, v_scale=1 / 0.3)
    kojiri = sweep(path[k_cap:], Us[k_cap:], Ss[k_cap:], rad[k_cap:] * 1.04, seg=14, cap0=False, cap1=True, v_scale=1 / 0.3)
    # 鯉口（口の輪）
    kp = np.array([mouth - d * 0.001, mouth + d * 0.016])
    koi = sweep(kp, np.array([u, u]), np.array([s, s]), np.array([np.array(r_saya) * 1.07] * 2), seg=14, cap0=True, cap1=False)
    # 栗形（鞘の外側の小さな突起）
    kc = mouth + d * 0.10 + s * (r_saya[1] + 0.004) - u * 0.004
    kuri = sweep(np.array([kc - d * 0.012, kc + d * 0.012]), np.array([u, u]), np.array([s, s]), np.array([(0.006, 0.004)] * 2), seg=8)
    # 鍔と切羽
    tsuba_c = mouth - d * 0.009
    tsuba = disc(tsuba_c, d, u, s, tsuba_r[0], tsuba_r[1], 0.005)
    seppa = sweep(np.array([tsuba_c - d * 0.006, tsuba_c + d * 0.006]), np.array([u, u]), np.array([s, s]), np.array([(r_tsuka[0] * 1.15, r_tsuka[1] * 1.2)] * 2), seg=12, cap0=True, cap1=True)
    # 柄：鍔から前へ。少しくびれる。縁（ふち）と頭（かしら）の金具
    tp = np.array([tsuba_c - d * (0.009 + L_tsuka * t) + u * 0.004 * t * t for t in np.linspace(0, 1, 12)])
    trad = np.array([np.array(r_tsuka) * (1 - 0.08 * math.sin(t * math.pi)) * (1 + 0.05 * t) for t in np.linspace(0, 1, 12)])
    Ut = np.array([u] * 12)
    St = np.array([s] * 12)
    fuchi_n = 2
    tsuka = sweep(tp[1:-1], Ut[1:-1], St[1:-1], trad[1:-1] * 1.0, seg=16, cap0=False, cap1=False, u_rep=2.0, v_scale=1 / 0.25 * 9 / 4)
    fuchi = sweep(np.array([tp[0], tp[1] + (tp[1] - tp[0]) * 0.2]), Ut[:2], St[:2], trad[:2] * 1.07, seg=16, cap0=True, cap1=False)
    kashira = sweep(np.array([tp[-2] - (tp[-1] - tp[-2]) * 0.1, tp[-1], tp[-1] - d * 0.004]), Ut[:3], St[:3], np.vstack([trad[-2:] * 1.07, trad[-1:] * 0.92]), seg=16, cap0=False, cap1=True)
    return {
        'saya': _merge([saya, koi, kuri]),
        'metal': _merge([kojiri, seppa, fuchi, kashira]),
        'iron': tsuba,
        'tsuka': tsuka,
    }


def daisho():
    kat = sword((0.103, 1.050, 0.142), (0.52, -0.29, -0.80), 0.76, 0.25, 0.018)
    wak = sword((0.130, 1.018, 0.126), (0.42, -0.40, -0.81), 0.52, 0.18, 0.012,
                r_saya=(0.0158, 0.0108), r_tip=(0.0138, 0.0092), r_tsuka=(0.0135, 0.0108), tsuba_r=(0.031, 0.029))
    out = {}
    for k in ('saya', 'metal', 'iron', 'tsuka'):
        out[k] = _merge([kat[k], wak[k]])
    return out


# ---------------- 草履 ----------------
def zori(s):
    """草履（藁の底と鼻緒）：左右 s。底 {'sole'}、鼻緒 {'hanao'}"""
    x0 = s * 0.099
    m = -s   # 内側
    n = 40
    outline = []
    for k in range(n):
        a = 2 * math.pi * k / n
        # 前が広く、かかとが少し細い、丸い長方形
        cz, cx = math.cos(a), math.sin(a)
        L = 0.125
        w = 0.049 if cz > 0 else 0.044
        pz = 0.068 + L * np.sign(cz) * abs(cz) ** 0.55
        px = x0 + m * 0.004 + w * np.sign(cx) * abs(cx) ** 0.6
        outline.append((px, pz))
    outline = np.array(outline)
    y0, y1 = 0.001, A.SOLE_Y
    V, Fc, UV = [], [], []
    # 上面と下面（中心から扇形）
    cen = outline.mean(0)
    for yy, flip in ((y1, False), (y0, True)):
        b = len(V)
        V.append((cen[0], yy, cen[1]))
        UV.append((cen[0] / 0.12, cen[1] / 0.12))
        for p in outline:
            V.append((p[0], yy, p[1]))
            UV.append((p[0] / 0.12, p[1] / 0.12))
        # 中間の輪（面をなめらかに）
        b2 = len(V)
        for p in outline:
            q = cen + (p - cen) * 0.5
            V.append((q[0], yy, q[1]))
            UV.append((q[0] / 0.12, q[1] / 0.12))
        for k in range(n):
            k1 = (k + 1) % n
            f1 = (b, b2 + k1, b2 + k) if not flip else (b, b2 + k, b2 + k1)
            f2 = (b2 + k, b2 + k1, b + 1 + k1, b + 1 + k) if not flip else (b2 + k, b + 1 + k, b + 1 + k1, b2 + k1)
            Fc.append(f1)
            Fc.append(f2)
    # 側面（縁は少し丸く）
    top0 = 1
    bot0 = 1 + 2 * n + 1
    for k in range(n):
        k1 = (k + 1) % n
        Fc.append((bot0 + k, bot0 + k1, top0 + k1, top0 + k))
    sole = (np.array(V), Fc, np.array(UV))
    # 鼻緒：前の穴（親指と人差し指の間）から足の甲の上を通って、両脇の穴へ
    gx = x0 + m * 0.0125
    front = np.array([gx, y1, 0.160])
    post_top = np.array([gx, 0.040, 0.150])
    foot = lambda P: A.foot(P, s)
    parts = []
    for side in (-1, 1):
        end = np.array([x0 + side * 0.047 + m * 0.004, y1 + 0.002, 0.058])
        mid = np.array([x0 + side * 0.026, 0.066, 0.100])
        pts = [post_top]
        for t in np.linspace(0, 1, 9)[1:]:
            q = (1 - t) ** 2 * post_top + 2 * (1 - t) * t * mid + t * t * end
            pts.append(q)
        pts = np.array(pts)
        pr = project(lambda P: foot(P) - F(0.0058), pts.astype(F), iters=5, max_step=0.02).astype(float)
        pr[-1] = end
        pr[0] = post_top
        T = np.gradient(pr, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True)
        up = np.array([0, 1.0, 0])
        Uu = np.array([(up - t_ * (t_ @ up)) / (np.linalg.norm(up - t_ * (t_ @ up)) + 1e-9) for t_ in T])
        Ss = np.cross(T, Uu)
        rad = np.array([(0.0052, 0.0068)] * len(pr))
        parts.append(sweep(pr, Uu, Ss, rad, seg=8, cap0=False, cap1=True))
    post = np.array([front, (front + post_top) / 2, post_top])
    parts.append(sweep(post, np.array([(0, 0, 1.0)] * 3), np.array([(1.0, 0, 0)] * 3), np.array([(0.004, 0.004), (0.0045, 0.0045), (0.0058, 0.0058)]), seg=8, cap0=True, cap1=True))
    return {'sole': sole, 'hanao': _merge(parts)}


# ---------------- 紐の結び目 ----------------
def flat_strip(pts, normal_hint, width, thick=0.0035, seg=6):
    """平たい紐（断面は平たい楕円）"""
    pts = np.asarray(pts, float)
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    nh = np.asarray(normal_hint, float)
    N = np.array([(nh - t * (t @ nh)) / (np.linalg.norm(nh - t * (t @ nh)) + 1e-9) for t in T])
    Sd = np.cross(T, N)
    rad = np.array([(thick / 2, width / 2)] * len(pts))
    return sweep(pts, N, Sd, rad, seg=seg, cap0=True, cap1=True)


def front_knot(z_front, y=1.066):
    """前の十文字の結び（腰板の紐）と、左右に垂れる端"""
    c = np.array([0.0, y, z_front])
    parts = []
    parts.append(flat_strip([c + (-0.045, 0.002, -0.006), c + (-0.02, 0.004, 0.004), c + (0.02, 0.004, 0.004), c + (0.045, 0.002, -0.006)], (0, 0, 1), 0.024, 0.006))
    parts.append(flat_strip([c + (0.0, 0.035, 0.0), c + (0.0, 0.012, 0.009), c + (0.0, -0.012, 0.009), c + (0.0, -0.035, 0.0)], (0, 0, 1), 0.024, 0.006))
    for sgn in (-1, 1):
        parts.append(flat_strip([c + (sgn * 0.012, -0.01, 0.007), c + (sgn * 0.03, -0.05, 0.010), c + (sgn * 0.036, -0.085, 0.012)], (0, 0, 1), 0.021, 0.0035))
    return _merge(parts)


def back_knot(z_back, y=1.066):
    """背の真ん中の結び目（幅 0.10、高さ 0.08、厚み 0.05）と、垂れる 2 本の端（0.16m と 0.19m）。
    結び目は SDF（中の巻きと左右の輪）から面を作る。返り値は（結び目の頂点・面、端の頂点・面・UV）"""
    from sdf import capsule, ellipsoid, mesh_sdf, orient_outward, smin, smax, axis_angle
    c = np.array([0.0, y, z_back - 0.020])

    def fn(P):
        d = ellipsoid(P, c + (0, -0.004, -0.004), (0.022, 0.030, 0.018))                 # 中の巻き
        for sg in (-1, 1):
            R = axis_angle((0, 0, 1), sg * 0.35)
            loop = ellipsoid(P, c + (sg * 0.030, 0.010, 0.004), (0.024, 0.015, 0.014), R)  # 左右の輪
            hole = ellipsoid(P, c + (sg * 0.033, 0.011, -0.010), (0.011, 0.006, 0.020), R)
            loop = smax(loop, -hole, 0.004)
            d = smin(d, loop, 0.008)
        d = smin(d, capsule(P, c + (-0.045, -0.008, 0.012), c + (0.045, -0.008, 0.012), 0.009), 0.01)   # 帯へ入る紐
        # 巻きの溝
        q = P - c.astype(F)
        d = d + (0.0012 * np.sin(q[:, 1] * 260 + q[:, 0] * 90)).astype(F)
        return d
    V, Q = mesh_sdf(fn, c - 0.065, c + 0.065, 0.003)
    Q = orient_outward(fn, V, Q)
    parts = []
    for sg, L, ph in ((-1, 0.16, 0.0), (1, 0.19, 1.3)):
        top = c + (sg * 0.010, -0.026, -0.010)
        pts = []
        for t in np.linspace(0, 1, 8):
            pts.append(top + (sg * (0.012 * t + 0.006 * math.sin(t * 3 + ph)), -L * t, -0.006 * math.sin(t * math.pi) - 0.012 * t))
        parts.append(flat_strip(pts, (0, 0, -1), 0.019, 0.0035, seg=6))
    return (V, Q), _merge(parts)


