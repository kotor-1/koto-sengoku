"""
袴・角帯・紐・結び目・腰板。座標はゲームの向き（x 左、y 上、z 前）。
袴：帯の下から 1 枚の筒（前は襞 5 本、後ろは 2 本）。腰（幅 0.37m）から裾（幅 0.84m）へ大きく広がり、広がりの大半は 0.8m より下。
脇は腰から 0.80m まで開く。0.62m から下は左右の脚に分かれ、それぞれ外側の弧（筒の続き）と内側の壁（股の側）で 1 周する。
裾には脚ごとに 6 つほどの大きさのそろわないうねり（深さ 3〜5cm）を付け、裾の線も ±2cm 上下させる。布の厚み 4mm は書き出しの前に付ける。
帯：角帯を 3 重に巻いた厚い帯（1.00〜1.13m、小袖から 2.8cm 立つ）。袴の紐 2 本が帯の上を回り、背の真ん中で結び目になって端が垂れる。
"""
from __future__ import annotations

import math

import numpy as np

import cloth as CL
from sdf import F

ZC = -0.006
Y_TOP_F = 1.030      # 前の上端（帯の下に入る）
Y_TOP_B = 1.050      # 後ろの上端
Y_SLIT = 0.80        # 脇の開きの下端
Y_CROTCH = 0.62      # 股
Y_HEM = 0.072        # 裾（平均）
Y_BAND = (1.000, 1.130)   # 帯の下と上

# 襞の位置（度、前 0、左 +90）と向き
PLEATS = [(-54, -1), (-33, -1), (-12, -1), (20, 1), (42, 1), (170, 1, 0.5), (190, -1, 0.5)]   # 後ろは真ん中が少し高い箱ひだ（浅い）


def radial_profile(sdf, ys, thetas, center=(0.0, 0.0), rmax=0.45):
    """高さ ys・角度 thetas（同じ長さ、または ys が 1 つ）の向きに、軸 (center) から sdf の面までの距離（二分法）"""
    th = np.radians(np.atleast_1d(np.asarray(thetas, float)))
    ys = np.broadcast_to(np.atleast_1d(np.asarray(ys, float)), th.shape)
    d = np.column_stack([np.sin(th), np.zeros_like(th), np.cos(th)])
    lo = np.zeros(len(th))
    hi = np.full(len(th), rmax)
    c = np.column_stack([np.full(len(th), center[0]), ys, np.full(len(th), center[1])])
    for _ in range(26):
        mid = (lo + hi) / 2
        P = c + d * mid[:, None]
        inside = sdf(P.astype(F)) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return (lo + hi) / 2


def kosode_radius(ys, thetas):
    """小袖の胴（袖・しわを含まない）の、軸からの半径"""
    return radial_profile(CL.torso_body, ys, thetas, (0.0, ZC))


def theta_samples():
    """周りの角度（度）。襞の段のところは両側に点を置いて角を立てる"""
    base = list(np.linspace(-180, 180, 49)[:-1])
    extra = []
    for pl in PLEATS:
        extra += [pl[0] - 1.2, pl[0] + 1.2]
    th = np.array(sorted(set([round(x, 3) for x in base + extra])))
    # 近すぎる点を除く（段の点は残す）
    keep = [th[0]]
    for x in th[1:]:
        if x - keep[-1] > 0.9:
            keep.append(x)
    return np.array(keep)


def sm01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def pleat_offset(theta, y):
    """襞の段：各襞の線で外へ段が立ち、次の襞へ向かってなだらかに下がる（襞が重なって見える）。
    段の深さは腰 3cm から裾 5cm。帯の下に入る所では浅くする"""
    th = np.asarray(theta, float)
    y = np.asarray(y, float)
    off = np.zeros(np.broadcast(th, y).shape)
    h = 0.030 + 0.020 * np.clip((0.95 - y) / 0.85, 0, 1)
    h = h * (0.12 + 0.88 * sm01((1.005 - y) / 0.035))
    for pl in PLEATS:
        t0, sgn = pl[0], pl[1]
        k = pl[2] if len(pl) > 2 else 1.0
        if len(pl) > 2:
            k = k * sm01((y - 0.50) / 0.30)      # 後ろの襞は膝の上で消え、下は大きなうねりだけ
        d = (th - t0) * sgn                      # 襞の向きに測った角度
        d = (d + 180) % 360 - 180
        w = 21.0                                  # 襞の幅（度）
        ramp = np.where((d > 0) & (d < w), 1 - d / w, 0.0)
        edge = np.clip(1 - np.abs(d) / 1.2, 0, 1) * (d <= 0)
        off = off + k * h * np.maximum(ramp ** 1.5, edge)
    return off


# 裾のうねり：周り 12 個（脚ごとに 6 個）。中心・幅・深さはそろえない（乱数の種は固定）
_rng = np.random.default_rng(17)
_LOBE_C = (np.arange(12) * 30.0 + 15.0 + _rng.uniform(-5, 5, 12)) % 360   # 前後の合わせ目（0°・180°）から 10° 以上離す
_LOBE_W = _rng.uniform(8, 13, 12)
_LOBE_A = _rng.uniform(0.030, 0.050, 12) * np.where(np.arange(12) % 2 == 0, 1.0, -0.75)
_HEM_PH = _rng.uniform(0, 2 * math.pi, 3)


def lobes(theta, y):
    th = np.asarray(theta, float)
    fade = sm01((0.80 - np.asarray(y, float)) / 0.70) ** 1.2
    out = np.zeros(np.broadcast(th, fade).shape)
    for c, w, a in zip(_LOBE_C, _LOBE_W, _LOBE_A):
        d = (th - c + 180) % 360 - 180
        ww = w * (0.55 + 0.45 * fade)            # 上は細く、裾へ向かって広がる
        out = out + a * np.exp(-(d / ww) ** 2)
    return out * fade


def hem_y(theta):
    """裾の高さ（±2cm のうねり）"""
    t = np.radians(np.asarray(theta, float))
    g = 0.55 * np.sin(3 * t + _HEM_PH[0]) + 0.3 * np.sin(5 * t + _HEM_PH[1]) + 0.2 * np.sin(7 * t + _HEM_PH[2])
    return Y_HEM + 0.02 * g / 1.05


def section(y, thetas):
    """高さ y（数か配列）の袴の断面の半径（角度ごと）"""
    th = np.atleast_1d(np.asarray(thetas, float))
    y = np.broadcast_to(np.atleast_1d(np.asarray(y, float)), th.shape).astype(float)
    t = np.radians(th)
    # 帯の下（0.80〜1.00）はゆるく、0.80 から下で大きく広がる（初めに速く、裾へ向かって緩む）
    a_up = np.interp(y, [0.80, 0.90, 1.00], [0.232, 0.205, 0.178])
    b_up = np.interp(y, [0.80, 0.90, 1.00], [0.178, 0.160, 0.142])
    tt = np.clip((0.80 - y) / (0.80 - Y_HEM), 0, 1)
    e = 1 - (1 - tt) ** 1.7
    a = np.where(y < 0.80, 0.232 + (0.42 - 0.232) * e, a_up)
    b = np.where(y < 0.80, 0.178 + (0.30 - 0.178) * e, b_up)
    r = a * b / np.sqrt((b * np.sin(t)) ** 2 + (a * np.cos(t)) ** 2)
    hi = y > 0.86
    if hi.any():
        rk = kosode_radius(y[hi], th[hi])
        under = y[hi] >= Y_BAND[0] - 0.002
        r[hi] = np.where(under, rk + 0.007, np.maximum(r[hi], rk + 0.012))
    r = r + pleat_offset(th, y) + lobes(th, y)
    return r


def top_y(theta):
    """上端の高さ（前は低く、後ろは高く、脇で緩くつなぐ）"""
    c = np.cos(np.radians(theta))
    return Y_TOP_B + (Y_TOP_F - Y_TOP_B) * np.clip((c + 0.25) / 1.25, 0, 1) ** 0.8


def slit_gap(y):
    """脇の開きの幅（度）"""
    return np.where(y > Y_SLIT, 16.0 * np.clip((y - Y_SLIT) / 0.14, 0, 1) ** 0.7, 0.0)


def hakama_mesh():
    """頂点・面（外向き）。厚みは書き出しの前に solidify で付ける"""
    th_all = theta_samples()
    V, Fc = [], []

    def add_grid(rows):
        """rows: list of arrays (n,3)。行どうしを四角でつなぐ"""
        base = len(V)
        n = len(rows[0])
        for r in rows:
            V.extend(list(r))
        for j in range(len(rows) - 1):
            for i in range(n - 1):
                a = base + j * n + i
                Fc.append((a, a + 1, a + n + 1, a + n))
        return base

    # ---- 上の筒（股から上）：前の身頃と後ろの身頃に分ける ----
    ys_up = np.concatenate([np.linspace(Y_CROTCH, 0.96, 9), [0.99, 1.012, 1.04]])
    front_th = th_all[(th_all >= -90) & (th_all <= 90)]
    back_th = np.concatenate([th_all[th_all >= 90], th_all[th_all <= -90] + 360])
    for panel, ths in (('front', front_th), ('back', back_th)):
        rows = []
        for k, y in enumerate(ys_up):
            g = float(slit_gap(y))
            if panel == 'front':
                lo, hi = -90 + g / 2, 90 - g / 2
            else:
                lo, hi = 90 + g / 2, 270 - g / 2
            t = lo + (ths - ths[0]) / (ths[-1] - ths[0]) * (hi - lo)
            yy = np.full(len(t), y)
            if k == len(ys_up) - 1:
                yy = top_y(t)
            r = section(yy, t)
            pts = np.column_stack([r * np.sin(np.radians(t)), yy, ZC + r * np.cos(np.radians(t))])
            rows.append(pts)
        add_grid(rows)
    # ---- 脚（股から下）：裾の線は ±2cm うねる ----
    q_leg = np.linspace(0, 1, 16) ** 1.15
    for s in (1, -1):
        if s > 0:
            ths = np.unique(np.append(th_all[(th_all >= 0) & (th_all <= 180)], 180.0))   # 背の真ん中まで届かせる
        else:
            ths = np.concatenate([th_all[th_all >= 180], th_all[th_all <= 0] + 360])
            ths = ths[(ths >= 180) & (ths <= 360)]
        yh = hem_y(ths)
        rows, walls = [], []
        for q in q_leg:
            yy = yh + (Y_CROTCH - yh) * q
            th_r = ths
            dr = 0.0
            if s > 0:
                # 左の脚は前と後ろの合わせ目を少し越えて右の脚に外から重なる（股へ向かって 0 に）。合わせ目の溝が見えないように
                ext = 7.0 * (1 - q) ** 0.7
                th_r = ths[0] - ext + (ths - ths[0]) / (ths[-1] - ths[0]) * (ths[-1] - ths[0] + 2 * ext)
                dr = 0.003 * (1 - q) ** 0.7
            r = section(yy, th_r) + dr
            outer = np.column_stack([r * np.sin(np.radians(th_r)), yy, ZC + r * np.cos(np.radians(th_r))])
            # 内側の壁：外側の弧の終わりから始まりへ（股の側）、少し膨らむ。
            # 弧とは頂点を分ける（なめらかな法線が壁と混ざって合わせ目が筋に見えないように）
            p_end, p_start = outer[-1], outer[0]
            wall = []
            for qq in np.linspace(0, 1, 7)[1:-1]:
                p = p_end * (1 - qq) + p_start * qq
                bulge = 0.012 * math.sin(qq * math.pi) ** 2 * (0.3 + 0.7 * (1 - q))
                wall.append(p + np.array([s * (0.004 + bulge), 0, 0]))
            rows.append(outer)
            walls.append(np.vstack([p_end, np.array(wall), p_start]))
        add_grid(rows)
        add_grid(walls)
    return np.array(V), np.array(Fc)


def hakama_uv(V, faces):
    """面ごとの UV（1 = 0.36m）。外側は体の中心の周りの弧と高さ（上と脚でつながる）、股の内側の壁は前後と高さ"""
    out = []
    for f in faces:
        p = V[list(f)]
        c = p.mean(0)
        nx = np.cross(p[1] - p[0], p[2] - p[0])
        nx = abs(nx[0]) / (np.linalg.norm(nx) + 1e-12)
        if c[1] < Y_CROTCH - 0.005 and abs(c[0]) < 0.03 and nx > 0.8:
            u = p[:, 2] * np.sign(c[0] + 1e-9)
        else:
            ang = np.arctan2(p[:, 0], p[:, 2] - ZC)
            if ang.max() - ang.min() > math.pi:
                ang[ang < 0] += 2 * math.pi
            u = ang * 0.26
        out.append(np.column_stack([u, p[:, 1]]) / 0.36)
    return np.concatenate(out)


# ---------------- 帯・紐・腰板 ----------------
# 角帯の 3 重の巻き：(下の高さ, 上の高さ, 小袖の面から外の面までの厚み)
WRAPS = [(1.000, 1.074, 0.018), (1.034, 1.106, 0.023), (1.062, 1.130, 0.028)]


def band_outer(y, th):
    """その高さで一番外にある巻きの外の面（小袖の面からの距離）"""
    y = np.asarray(y, float)
    out = np.zeros(np.broadcast(y, np.asarray(th, float)).shape)
    for y0, y1, dro in WRAPS:
        out = np.where((y >= y0 - 0.002) & (y <= y1 + 0.002), np.maximum(out, dro), out)
    return out


def obi_mesh(n=48):
    """角帯：3 重に巻いた厚い帯。巻きごとに角の丸い断面の輪（内の面は小袖に隠れるので作らない）。
    返り値は頂点・面・UV（U は帯に沿って、V は帯の幅：下の縁 0 〜 上の縁 1）"""
    V, Fc, UV = [], [], []
    th = np.linspace(-180, 180, n + 1)
    for y0, y1, dro in WRAPS:
        dri = dro - 0.011
        prof = [(dri, y0), (dro - 0.003, y0), (dro, y0 + 0.004), (dro + 0.0012, (y0 + y1) / 2),
                (dro, y1 - 0.004), (dro - 0.003, y1), (dri, y1)]
        pv = [-0.08, -0.02, 0.03, 0.5, 0.97, 1.02, 1.08]
        rk = kosode_radius(np.full(len(th), (y0 + y1) / 2), th)
        pts0 = np.column_stack([rk * np.sin(np.radians(th)), np.zeros(len(th)), rk * np.cos(np.radians(th))])
        arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts0, axis=0), axis=1))])
        base = len(V)
        for (dr, yy), vv in zip(prof, pv):
            r = rk + dr
            for k in range(len(th)):
                V.append((r[k] * math.sin(math.radians(th[k])), yy, ZC + r[k] * math.cos(math.radians(th[k]))))
                UV.append((arc[k] / 0.3, vv))
        m = len(th)
        for j in range(len(prof) - 1):
            for i in range(n):
                a = base + j * m + i
                Fc.append((a, a + 1, a + m + 1, a + m))
    return np.array(V), np.array(Fc), np.array(UV)


def himo_mesh(sign, n=56, width=0.018, gap=9.0):
    """袴の紐：帯の上を斜めに回る平たい紐。前の真ん中で交差し、背の真ん中（結び目の下）で途切れる。
    sign=+1 は左回りに上がる紐、-1 はその逆"""
    th = np.linspace(-180 + gap, 180 - gap, n + 1)
    yc = 1.066 + sign * 0.028 * np.sin(np.radians(th) / 2)
    V, Fc = [], []
    rows = 3
    for j in range(rows + 1):
        q = j / rows
        y = yc + width * (q - 0.5)
        r = kosode_radius(y, th) + band_outer(y, th) + 0.0022 + 0.0012 * math.sin(q * math.pi)
        for k in range(len(th)):
            V.append((r[k] * math.sin(math.radians(th[k])), y[k], ZC + r[k] * math.cos(math.radians(th[k]))))
    m = len(th)
    for j in range(rows):
        for i in range(n):
            a = j * m + i
            Fc.append((a, a + 1, a + m + 1, a + m))
    return np.array(V), np.array(Fc)


def band_back_z(y=1.066):
    """背の真ん中の帯の外の面の z"""
    return ZC - float(kosode_radius(y, [180.0])[0]) - float(band_outer(y, 180.0))


def band_front_z(y=1.066):
    return ZC + float(kosode_radius(y, [0.0])[0]) + float(band_outer(y, 0.0))


def koshiita_mesh():
    """腰板：帯のすぐ下、背の真ん中の小さな台形の板（下 0.24、上 0.20、高さ 0.10、厚み 8mm）。上を 10° 後ろへ傾ける。
    返り値は頂点・面・UV"""
    nu, nv = 8, 3
    V, Fc, UV = [], [], []
    y0, y1 = 0.893, 0.993
    zc = ZC - float(section(0.94, [180.0])[0]) - 0.005
    tilt = math.tan(math.radians(10))
    for side, dz in ((0, 0.0), (1, -0.008)):
        for j in range(nv + 1):
            q = j / nv
            y = y0 + (y1 - y0) * q
            half = 0.120 - 0.020 * q
            for i in range(nu + 1):
                x = -half + 2 * half * i / nu
                z = zc - (y - y0) * tilt + 1.6 * x * x + dz
                V.append((x, y, z))
                UV.append((x / 0.36, y / 0.36))
    m = nu + 1
    off = (nv + 1) * m
    for j in range(nv):
        for i in range(nu):
            a = j * m + i
            Fc.append((a, a + 1, a + m + 1, a + m))      # 内（体の側）
            b = off + a
            Fc.append((b, b + m, b + m + 1, b + 1))      # 外（後ろ）
    outer = [(0, i) for i in range(nu + 1)] + [(j, nu) for j in range(1, nv + 1)] + [(nv, i) for i in range(nu - 1, -1, -1)] + [(j, 0) for j in range(nv - 1, 0, -1)]
    for k in range(len(outer)):
        j0, i0 = outer[k]
        j1, i1 = outer[(k + 1) % len(outer)]
        a, b = j0 * m + i0, j1 * m + i1
        Fc.append((b, a, a + off, b + off))
    return np.array(V), np.array(Fc), np.array(UV)
