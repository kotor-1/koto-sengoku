"""
小袖（藍の麻）：胴と袖を 1 つの SDF にして面を作り、襟の V・首・袖口・裾（袴の中）を切り抜く。
- 胴：高さごとの「角の丸い長方形」の断面をつないだ、ゆったりした筒（背は平ら、肩甲骨や背骨の形は出さない）。
  体からのゆとりは胸 4cm、背 5〜7cm、腰の背 8〜9cm。帯（1.00〜1.13m）の所は締まり、帯の上は帯にかぶさってたるむ。
  首のまわりと肩の上だけは体に沿う（布が肩に乗る）。
- 袖：水平の断面が「腕を包む太い端」から後ろ外（-z から外へ 28〜36°）へ伸びる平たい袋。袋は真下へ垂れ、
  下の端は帯の下の高さ。袖口は手首の約 4cm 上で、腕のまわり（下の縁の前の 0.22m）だけ開く。残りは縫い閉じ。
  肩の山は首から袖口まで 1 本の折り目。肩の張り（盛り上がり）は作らない。
- しわ：背に幅の広い縦のしわ（肩甲骨から帯へ）、袖に脇から後ろ下の角へ向かう大きな斜めのしわ、袖の下の垂れ、帯の上のたるみ。
座標はゲームの向き（x 左、y 上、z 前）。
"""
from __future__ import annotations

import math

import numpy as np

import anatomy as A
from sdf import F, grad, mesh_sdf, orient_outward, project, smax, smin


def sm01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ================= 胴 =================
# 高さ・半幅・背の z・前の z（体：胸 1.30 で x±.155 z[-.103,.098]、帯 1.05 で x±.123 z[-.085,.095]、腰 0.95 で z[-.107,.098]）
LOFT = np.array([
    (0.760, 0.180, -0.140, 0.130),
    (0.950, 0.172, -0.135, 0.125),
    (1.000, 0.152, -0.122, 0.118),
    (1.103, 0.152, -0.122, 0.118),
    (1.118, 0.184, -0.156, 0.138),
    (1.150, 0.193, -0.171, 0.143),
    (1.200, 0.197, -0.174, 0.138),
    (1.260, 0.204, -0.171, 0.138),
    (1.310, 0.212, -0.166, 0.142),
    (1.360, 0.232, -0.152, 0.132),
    (1.410, 0.242, -0.120, 0.108),
    (1.470, 0.225, -0.090, 0.085),
])
# 肩の屋根（胴の筒の上の端）：首の付け根から肩先へ約 20° で下がり、肩先の外で袖へ折れる
ROOF_X = [0.00, 0.07, 0.12, 0.20, 0.235, 0.262, 0.29, 0.32]
ROOF_Y = [1.470, 1.462, 1.448, 1.433, 1.421, 1.400, 1.355, 1.270]
ZC = -0.006


def roof(ax):
    return np.interp(ax, ROOF_X, ROOF_Y).astype(F)


def loft_params(y):
    a = np.interp(y, LOFT[:, 0], LOFT[:, 1])
    zb = np.interp(y, LOFT[:, 0], LOFT[:, 2])
    zf = np.interp(y, LOFT[:, 0], LOFT[:, 3])
    return a, zb, zf


def loft(P):
    """高さごとの角の丸い長方形（背は平ら）"""
    y = P[:, 1]
    a, zb, zf = loft_params(y)
    b = (zf - zb) / 2
    zc = (zf + zb) / 2
    rc = 0.62 * np.minimum(a, b)
    qx = np.abs(P[:, 0]) - (a - rc)
    qz = np.abs(P[:, 2] - zc) - (b - rc)
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qz, 0) ** 2) + np.minimum(np.maximum(qx, qz), 0) - rc
    return out.astype(F)


def torso_body(P):
    """胴（しわなし）：筒を肩の屋根で閉じ、首の付け根と肩の上は体に沿う面（ゆとり 1.2cm）とつなぐ"""
    d = smax(loft(P), P[:, 1] - roof(np.abs(P[:, 0])), 0.05)
    tight = A.bounded(P, lambda Q: A.torso(Q) - F(0.012), (-.27, 1.33, -.12), (.27, 1.50, .10), margin=.03)
    return smin(d, tight, 0.03)


def torso_folds(P):
    """胴のしわ（外へ + の量）"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    f = np.zeros(len(P), F)
    # 背：肩甲骨から帯へ、幅の広い縦のしわ 4 本（間隔 10.5cm、深さ 8〜12mm）。帯へ向かって少し寄る
    back = sm01((-z - 0.06) / 0.05) * sm01((1.40 - y) / 0.14) * sm01((y - 1.13) / 0.05) * sm01((0.215 - ax) / 0.05)
    xi = x / (1 - 0.16 * np.clip((1.36 - y) / 0.2, 0, 1))
    amp = 0.0100 * (0.80 + 0.35 * np.sin(xi * 17 + 0.6))
    f += back * amp * np.sin(2 * math.pi * xi / 0.105 + 1.1)
    # 脇：縦のしわ
    side = sm01((ax - 0.12) / 0.05) * sm01((1.30 - y) / 0.08) * sm01((y - 1.15) / 0.03)
    f += side * 0.006 * np.sin(2 * math.pi * z / 0.09 + 0.4 + 0.8 * np.sign(x))
    # 帯の上のたるみ：寄せたひだ
    ang = np.arctan2(x, z - ZC)
    bl = np.exp(-((y - 1.135) / 0.02) ** 2)
    f += bl * (0.0055 * np.sin(ang * 15 + 0.3) + 0.0025 * np.sin(ang * 27 + 1.9))
    # 胸：襟の交わりから脇へ流れる浅いしわ
    front = sm01((z - 0.05) / 0.04) * sm01((1.32 - y) / 0.05) * sm01((y - 1.16) / 0.04)
    f += front * 0.004 * np.sin(2 * math.pi * (0.8 * y + 0.6 * ax) / 0.08)
    return f.astype(F)


def torso_cloth(P):
    return torso_body(P) - torso_folds(P)


# ================= 袖 =================
Y_CUFF = 0.930           # 袖口の高さ（手首 0.889 の約 4cm 上）
CUFF_OPEN = 0.22         # 袖口の開きの長さ（下の縁の前から）
SY = np.array([0.85, 0.95, 1.05, 1.15, 1.25, 1.33, 1.40, 1.47])
S_R0 = np.array([0.058, 0.058, 0.060, 0.063, 0.066, 0.068, 0.068, 0.066])    # 腕を包む端の半径
S_L = np.array([0.325, 0.322, 0.305, 0.262, 0.192, 0.112, 0.040, 0.0])       # 袋の奥行き（腕の軸から）
S_AL = np.array([32.0, 32.0, 31.0, 30.0, 28.0, 26.0, 25.0, 25.0])           # 袋の向き（-z から外へ、度）
S_R1 = np.array([0.0125, 0.0125, 0.0135, 0.015, 0.018, 0.022, 0.026, 0.030])  # 袋の厚みの半分
R_CORNER = 0.06


def arm_pts(s):
    sh = A.mirror(A.J['LeftUpperArm'], s)
    el = A.mirror(A.J['LeftForeArm'], s)
    wr = A.mirror(A.J['LeftHand'], s)
    return sh, el, wr


def arm_axis(y, s):
    """休みの姿勢の腕の軸の、高さ y での (x, z)"""
    sh, el, wr = arm_pts(s)
    top = sh + (sh - el) * 0.45
    bot = wr + (wr - el) * 0.6
    ys = [bot[1], wr[1], el[1], sh[1], top[1]]
    xs = [bot[0], wr[0], el[0], sh[0], top[0]]
    zs = [bot[2], wr[2], el[2], sh[2], top[2]]
    return np.interp(y, ys, xs), np.interp(y, ys, zs)


def bag_coords(P, s):
    """袖の袋の座標：u（腕の軸から袋の奥へ、水平）、w（袋の面に垂直、外前が +）と、その高さの袋の寸法"""
    y = P[:, 1]
    axx, azz = arm_axis(y, s)
    al = np.radians(np.interp(y, SY, S_AL))
    dhx, dhz = s * np.sin(al), -np.cos(al)
    nhx, nhz = s * np.cos(al), np.sin(al)
    rx = P[:, 0] - axx
    rz = P[:, 2] - azz
    u = rx * dhx + rz * dhz
    w = rx * nhx + rz * nhz
    return u, w, np.interp(y, SY, S_L), np.interp(y, SY, S_R0), np.interp(y, SY, S_R1)


def bag_bottom(u, L):
    """袋の下の縁の高さ：袖口から後ろへ少し上がり、真ん中が少し垂れる"""
    un = np.clip(u / np.maximum(L, 0.05), 0, 1)
    return Y_CUFF + 0.055 * un ** 1.5 - 0.014 * np.sin(math.pi * un)


def sleeve_fold_w(u, y, L, s):
    """袋の中心面のずれ：後ろの端は体の方へ少し回り込み、脇から後ろ下の角へ大きな斜めのしわ 2〜3 本"""
    un = np.clip(u / np.maximum(L, 0.05), 0, 1)
    w = -0.065 * un ** 2
    ph = 0.7 if s > 0 else 2.3
    c = u * 0.824 + (y - 1.0) * 0.566
    along = u * 0.566 - (y - 1.0) * 0.824
    amp = 0.0125 * (0.80 + 0.35 * np.sin(7.0 * along + ph))
    fade = sm01((u - 0.05) / 0.08) * sm01((1.34 - y) / 0.10)
    w = w + amp * np.sin(2 * math.pi * c / 0.15 + ph) * fade
    return w


def sleeve(P, s):
    u, w, L, r0, r1 = bag_coords(P, s)
    y = P[:, 1]
    wm = sleeve_fold_w(u, y, L, s)
    d_arm = np.sqrt(u * u + w * w) - r0
    hx = L / 2
    rr = 0.95 * r1          # 袋の縁は丸い（布の折り返し）
    qx = np.abs(u - hx) - (hx - rr)
    qy = np.abs(w - wm) - (r1 - rr)
    d_bag = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rr
    d = smin(d_arm.astype(F), d_bag.astype(F), 0.05)
    yb = bag_bottom(u, L)
    d = smax(d, (yb - y).astype(F), 0.012)
    d = smax(d, (y - (roof(np.abs(P[:, 0])) - 0.004)).astype(F), 0.02)
    # 後ろ下の角の丸み
    Lb = L + r1
    qx = u - (Lb - R_CORNER)
    qy = (bag_bottom(Lb, L) + R_CORNER) - y
    corner = np.where((qx > 0) & (qy > 0), np.sqrt(qx * qx + qy * qy) - R_CORNER, -1.0)
    return np.maximum(d, corner.astype(F)).astype(F)


def kosode_sdf(P):
    d = torso_cloth(P)
    for s in (1, -1):
        d = smin(d, sleeve(P, s), 0.03)
    return d


# ---------------- 襟の線 ----------------
def _catmull(P, n_out):
    """制御点を通るなめらかな曲線（弧長でそろえて n_out 点）"""
    P = np.asarray(P, float)
    Pp = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    pts = []
    for i in range(1, len(Pp) - 2):
        p0, p1, p2, p3 = Pp[i - 1], Pp[i], Pp[i + 1], Pp[i + 2]
        for t in np.linspace(0, 1, 24, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(P[-1])
    pts = np.array(pts)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    s = np.linspace(0, L[-1], n_out)
    return np.column_stack([np.interp(s, L, pts[:, k]) for k in range(3)])


def _to_surface_front(P, offset=0.004):
    """前から布の面へ押し当てる（z だけ動かす）"""
    P = P.copy()
    P[:, 2] = 0.25
    for _ in range(40):
        d = kosode_sdf(P.astype(F)).astype(float)
        P[:, 2] -= np.clip(d - offset, -0.01, 0.02)
    return P


def collar_curve(n=150):
    """襟の内側の縁 E（順番：右の腰（上前の端）→ 左の首 → 首の後ろ → 右の首 → 左の腰（下前の端））と、各点の種類
    （0：上前の線、1：首まわり、2：下前の線）"""
    # 胸の上の線（上前：着る人の左の首の下から右の腰へ）。交わりは x=0, y=Y_CROSS
    ys = np.array([0.95, 1.10, 1.25, 1.336, 1.40])
    front = np.column_stack([0.052 - 0.345 * (1.468 - ys), ys, np.zeros(len(ys))])
    front = _to_surface_front(front)
    neck = np.array([
        (0.047, 1.447, 0.052),
        (0.061, 1.478, 0.012),
        (0.064, 1.503, -0.034),
        (0.042, 1.519, -0.071),
        (0.0, 1.525, -0.084),
    ])
    half = np.vstack([front, neck])
    ctrl = np.vstack([half, (half[:-1] * np.array([-1, 1, 1]))[::-1]])
    E = _catmull(ctrl, n)
    # 前の部分はもう一度面へ
    fr = (E[:, 1] < 1.40)
    E[fr] = _to_surface_front(E[fr])
    kind = np.where(E[:, 1] < 1.43, np.where(np.arange(n) < n // 2, 0, 2), 1)
    return E, kind


def collar_frame(E, kind):
    """襟の幅の向き W：布の面の法線（前）と、首から外向きの法線（後ろ）をなめらかにつなぎ、接線との外積"""
    T = np.gradient(E, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    g = grad(kosode_sdf, E.astype(F), 1e-3).astype(float)
    g /= np.linalg.norm(g, axis=1, keepdims=True)
    rad = E - np.array([0, 0, -0.022])
    rad[:, 1] = 0
    rad /= np.linalg.norm(rad, axis=1, keepdims=True)
    t = sm01((E[:, 1] - 1.40) / 0.06)[:, None]
    N = g * (1 - t) + rad * t
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    W = np.cross(N, T)
    W /= np.linalg.norm(W, axis=1, keepdims=True)
    if W[0, 0] < 0:
        W = -W
    for i in range(1, len(W)):
        if W[i] @ W[i - 1] < 0:
            W[i] = -W[i]
    # 首の後ろは少し下向きに寄せる
    down = np.array([0, -1.0, 0])
    W = W * (1 - 0.3 * t) + down * 0.3 * t
    W /= np.linalg.norm(W, axis=1, keepdims=True)
    return W


Y_CROSS = 1.336


def neck_opening_mask(V, E, W, kind, margin=0.004):
    """襟の内側（開き）に入る頂点。最も近い襟の点から見て W と反対にあるもの。
    ただし襟の交わりより下の前の線（上前が下前に重なる所）は開きではない"""
    out = np.zeros(len(V), bool)
    active = (kind == 1) | (E[:, 1] > Y_CROSS)
    for i0 in range(0, len(V), 4000):
        p = V[i0:i0 + 4000]
        d = ((p[:, None, :] - E[None, :, :]) ** 2).sum(2)
        j = np.argmin(d, 1)
        side = ((p - E[j]) * W[j]).sum(1)
        near = np.sqrt(d[np.arange(len(p)), j]) < 0.09
        out[i0:i0 + 4000] = near & (side < margin) & active[j]
    return out


def _edge_verts(Q):
    """面の縁（1 回だけ出る辺）の頂点"""
    e = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]])
    e = np.sort(e, axis=1)
    uniq, cnt = np.unique(e, axis=0, return_counts=True)
    return np.unique(uniq[cnt == 1])


def taubin(V, Q, iters=4, lam=0.5, mu=-0.53):
    """面のつながりでならす（縁は動かさない、縮みを抑える λ/μ 法）"""
    n = len(V)
    e = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    deg = np.bincount(e.ravel(), minlength=n).astype(float)
    fixed = np.zeros(n, bool)
    fixed[_edge_verts(Q)] = True
    V = V.copy()
    for _ in range(iters):
        for f in (lam, mu):
            acc = np.zeros_like(V)
            np.add.at(acc, e[:, 0], V[e[:, 1]])
            np.add.at(acc, e[:, 1], V[e[:, 0]])
            lap = acc / np.maximum(deg, 1)[:, None] - V
            lap[fixed] = 0
            V = V + f * lap
    return V


def cuff_opening(V, s, margin=0.0):
    """袖口の開き（下の縁の、腕のまわりの前 0.22m）に入る頂点"""
    u, w, L, r0, r1 = bag_coords(V, s)
    side = np.sign(V[:, 0]) == s
    return side & (V[:, 1] < Y_CUFF + 0.007 + margin) & (u > -r0 - 0.03) & (u < CUFF_OPEN - r0) & (np.abs(w) < r0 + 0.02)


def kosode_mesh(h=0.0055):
    V, Q = mesh_sdf(kosode_sdf, (-.60, .74, -.40), (.60, 1.56, .22), h)
    Q = orient_outward(kosode_sdf, V, Q)
    E, kind = collar_curve()
    W = collar_frame(E, kind)
    rm = neck_opening_mask(V, E, W, kind)
    rm |= V[:, 1] < 0.765
    for s in (1, -1):
        rm |= cuff_opening(V, s)
    keep = ~rm
    Q = Q[keep[Q].all(1)]
    used = np.unique(Q)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used))
    V = V[used].copy()
    Q = remap[Q]
    V = taubin(V, Q)
    # 袖口の縁をそろえる（水平の輪）
    bnd = _edge_verts(Q)
    for s in (1, -1):
        m = cuff_opening(V[bnd], s, margin=0.02)
        V[bnd[m], 1] = Y_CUFF + 0.007
    return V, Q, E, W, kind


def band(E, W, width, offset, rows=4, lift_edge=0.0012, surf_sdf=None, avoid_sdf=None, avoid=0.0):
    """襟の帯：E（内の縁）から W の向きへ幅 width。外の段ほど布の面（surf_sdf の 0 + offset）に沿わせる。
    avoid_sdf（首など）には avoid 以上近づけない"""
    n = len(E)
    V = np.array([E + W * (width * j / rows) for j in range(rows + 1)])  # (rows+1, n, 3)
    for j in range(1, rows + 1):
        f = min(1.0, j / (rows * 0.5))
        pts = V[j].astype(F)
        tgt = project(lambda P: surf_sdf(P) - F(offset), pts, iters=5, max_step=0.01).astype(float)
        mv = np.linalg.norm(tgt - V[j], axis=1, keepdims=True)
        tgt = np.where(mv > 0.03, V[j], tgt)
        V[j] = V[j] + (tgt - V[j]) * f
    flat = V.reshape(-1, 3).astype(F)
    if avoid_sdf is not None:
        for _ in range(3):
            d = avoid_sdf(flat)
            g = grad(avoid_sdf, flat, 1e-3)
            g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
            flat = flat + g * np.clip(avoid - d, 0, 0.01)[:, None]
    V = flat.reshape(rows + 1, n, 3).astype(float)
    # 内の縁を少し盛る（折り返しの厚み）
    g = grad(surf_sdf, V[0].astype(F), 1e-3)
    g = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
    V[0] += g * lift_edge
    faces = []
    for j in range(rows):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
    # UV：U は幅、V は長さ（布目が襟に沿う）
    seg = np.linalg.norm(np.diff(E, axis=0), axis=1)
    L = np.concatenate([[0], np.cumsum(seg)])
    uv_v = np.array([[(width * j / rows) / 0.3, L[i] / 0.3] for j in range(rows + 1) for i in range(n)])
    return V.reshape(-1, 3), np.array(faces), uv_v


def face_uv(pts, cen, nrm):
    """小袖の面ごとの UV（1 = 0.3m）。袖は袋の面（u, 高さ）の平らな投影（布目が縦）、胴は円筒（上向きの面は真上から）"""
    c = cen[None].astype(F)
    ds = [sleeve(c, s)[0] for s in (1, -1)]
    dt = torso_cloth(c)[0]
    if min(ds) < dt - 0.004:
        s = 1 if ds[0] < ds[1] else -1
        u, w, L, r0, r1 = bag_coords(pts.astype(F), s)
        al = math.radians(float(np.interp(cen[1], SY, S_AL)))
        nh = np.array([s * math.cos(al), 0.0, math.sin(al)])
        if abs(nrm @ nh) > 0.55:
            return np.column_stack([u * s, pts[:, 1]]) / 0.3
        if abs(nrm[1]) > 0.6:
            return np.column_stack([u, w]) / 0.3
        return np.column_stack([w, pts[:, 1]]) / 0.3
    if abs(nrm[1]) > 0.55:
        return np.column_stack([pts[:, 0], pts[:, 2]]) / 0.3
    ang = np.arctan2(pts[:, 0], pts[:, 2])
    if ang.max() - ang.min() > math.pi:
        ang[ang < 0] += 2 * math.pi
    return np.column_stack([ang * 0.17, pts[:, 1]]) / 0.3
