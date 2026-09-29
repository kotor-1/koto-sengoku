"""
比較案の頭（MPFB の基本形）に付ける自作の部品：眼球・まぶたの縁の線・眉・肌の色味。
形の位置は head_mpfb（MPFB の目・まつ毛の補助の形の位置）から決める。
"""
from __future__ import annotations

import math

import numpy as np

import head_mpfb as HM

EYE_LOOK = np.array([0.0, -0.05, 1.0])        # 両目とも同じ向き（正面、わずかに下）


def rot_between(a, b):
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(a @ b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def eyeball(c, r, iris_deg=25.4, seg=40):
    """眼球：視線の向きが極の球。瞳・虹彩・白目の境は輪にそろえる（色は頂点の色）。
    iris_deg：黒目の縁の角度（極から）。半径 13.5mm で 25.4° なら黒目の直径 11.6mm。
    色：白目は少し暗く温かい色（青白く光らない）、黒目は暗い茶色で外の縁が濃い輪、瞳は小さめ（黒い円盤に見えないように）"""
    k = iris_deg / 28.5
    rings = [0, 3 * k, 6.5 * k, 8 * k, 12 * k, 16 * k, 20 * k, 23.5 * k, 26 * k, 28.5 * k, 31 * k, 36 * k, 42, 50, 58, 66, 75,
             90, 115, 145, 180]
    V = [(0, 0, 1)]
    for a in rings[1:-1]:
        th = math.radians(a)
        for q in range(seg):
            ph = 2 * math.pi * q / seg
            V.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    V.append((0, 0, -1))
    V = np.array(V)
    ang = np.degrees(np.arccos(np.clip(V[:, 2], -1, 1))) / k       # 黒目の縁が 28.5 になる角度
    V[:, 2] += 0.075 * np.clip(1 - ang / 28.5, 0, 1) ** 1.5         # 角膜のふくらみ
    pupil = np.array([0.010, 0.008, 0.007])
    iris_in = np.array([0.150, 0.088, 0.045])      # 瞳のまわり（明るい茶）
    iris_mid = np.array([0.105, 0.060, 0.032])
    limbus = np.array([0.028, 0.019, 0.014])       # 黒目の外の濃い輪
    sclera = np.array([0.31, 0.26, 0.215])         # 白目（温かく、少し暗く）
    t = np.clip((ang - 6.5) / 17, 0, 1)[:, None]
    col = np.where(ang[:, None] < 6.5, pupil, iris_in * (1 - t) + iris_mid * t)
    lim = np.clip((ang - 23.5) / 3.0, 0, 1)[:, None]
    col = col * (1 - lim) + limbus * lim
    ang2 = np.degrees(np.arccos(np.clip(V[:, 2] / np.linalg.norm(V, axis=1), -1, 1)))
    sc = sclera * (1 - 0.35 * np.clip((ang2 - 33) / 30, 0, 1))[:, None]   # 目頭・目じりへ暗く
    sc = sc * np.array([1.0, 0.97, 0.95])[None] ** np.clip((ang2 - 40) / 20, 0, 1)[:, None]   # 端は少し赤み
    blend = np.clip((ang - 28.5) / 2.5, 0, 1)[:, None]
    col = col * (1 - blend) + sc * blend
    nr = len(rings) - 2
    Fc = [(0, 1 + q, 1 + (q + 1) % seg) for q in range(seg)]
    for i in range(nr - 1):
        for q in range(seg):
            a = 1 + i * seg + q
            b = 1 + i * seg + (q + 1) % seg
            Fc.append((a, a + seg, b + seg, b))
    last = len(V) - 1
    for q in range(seg):
        a = 1 + (nr - 1) * seg + q
        b = 1 + (nr - 1) * seg + (q + 1) % seg
        Fc.append((a, last, b))
    R = rot_between((0, 0, 1), EYE_LOOK)
    return (V @ R.T) * r + c, Fc, col


def eyeball_fitted(Vs, Qs, s):
    """顔に合わせた眼球：
    - まぶたの開きの外（前から見て肌の後ろ）にある眼球の点は、肌の面の 0.8mm 後ろへ下げる（目じりの外で白目が肌を突き抜けて
      見えないように。斜めから見て白目がまぶたの外にはみ出す原因）
    - まぶたの縁の陰：上まぶたの縁の下 0〜2.5mm を暗く（上まぶたの厚みと影。黒目の上が少し隠れて落ち着いた目に）、
      下まぶたの縁の上を少し暗く、目頭・目じりをさらに暗く"""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    c, r = HM.eye_place(s)
    V, Fc, col = eyeball(c, r)
    V = np.asarray(V, float).copy()
    col = np.asarray(col, float).copy()
    xs, Up, Lo = lid_margins(Vs, Qs, s)
    sel = np.nonzero(np.linalg.norm(Vs - c, axis=1) < 0.05)[0]
    fk = np.isin(Qs, sel).all(1)
    bvh = BVHTree.FromPolygons([tuple(v) for v in Vs], [tuple(int(i) for i in q) for q in Qs[fk]])
    ax = np.abs(V[:, 0])
    uy = np.interp(ax, xs, Up[:, 1])
    ly = np.interp(ax, xs, Lo[:, 1])
    inside = (ax >= xs[0]) & (ax <= xs[-1]) & (V[:, 1] < uy) & (V[:, 1] > ly)
    for i in np.nonzero((V[:, 2] > c[2] - 0.3 * r) & ~inside)[0]:
        loc, nrm, _, _ = bvh.find_nearest(Vector(V[i]))
        if loc is None:
            continue
        loc, nrm = np.array(loc), np.array(nrm)
        if (V[i] - loc) @ nrm > -0.0008:          # 肌の外（または肌の面のすぐ下）→ 肌の 0.8mm 内へ
            V[i] = loc - nrm * 0.0008
    # 開きの中でも、目じりの側の白目（黒目の外）が まぶた・目じりの面より前へ出ている所は、後ろ（-z）へ下げて面の内へ
    # （MPFB の目じりは深く引っ込んでいて、球のままだと斜め・横から白目が目じりの外へはみ出して見える）
    gz = (V - c) @ (EYE_LOOK / np.linalg.norm(EYE_LOOK)) / r
    lat = s * (V[:, 0] - c[0]) > 0.0062
    for i in np.nonzero(inside & lat & (gz < math.cos(math.radians(32))) & (V[:, 2] > c[2] - 0.3 * r))[0]:
        for _ in range(15):
            loc, nrm, _, _ = bvh.find_nearest(Vector(V[i]))
            if loc is None or (V[i] - np.array(loc)) @ np.array(nrm) < -0.0004:
                break
            V[i, 2] -= 0.0002
    du = np.clip(uy - V[:, 1], 0, None)
    dl = np.clip(V[:, 1] - ly, 0, None)
    shade = 1 - 0.50 * np.exp(-du / 0.0016) - 0.22 * np.exp(-dl / 0.0010)
    corner = np.minimum(np.abs(ax - xs[0]), np.abs(ax - xs[-1]))
    shade *= 1 - 0.30 * np.exp(-corner / 0.0025)
    front = V[:, 2] > c[2]
    col[front] *= np.clip(shade[front], 0.3, 1)[:, None]
    return V, Fc, col


# ================= まぶたの縁の線（まつ毛の代わり） =================
def lid_margins(V, Q, s, step=0.0002):
    """肌の面を前から光線で調べ、上下のまぶたの縁（肌が眼球の前に来る境）を列ごとに求める。
    返り値：xs（目頭 → 目じり）、上の縁の点 (n,3)、下の縁の点 (n,3)（ゲームの座標）"""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    c, r = HM.eye_place(s)
    sel = np.nonzero(np.linalg.norm(V - c, axis=1) < 0.05)[0]
    fk = np.isin(Q, sel).all(1)
    bvh = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(int(i) for i in q) for q in Q[fk]])
    up, lo = HM.lid_rows(s)
    x_in, x_out = abs(lo[0, 0]), abs(lo[-1, 0])
    xs = np.linspace(x_in + 0.0012, x_out - 0.0012, 17)

    def eye_z(x, y):
        q = r * r - (x - c[0]) ** 2 - (y - c[1]) ** 2
        return c[2] + np.sqrt(q) if q > 0 else -1.0

    def skin_z(x, y):
        hit = bvh.ray_cast(Vector((x, y, 0.3)), Vector((0, 0, -1)))
        return hit[0].z if hit[0] is not None else -1.0
    U, L = [], []
    for ax in xs:
        x = s * ax
        yc = c[1]
        res = []
        for sgn in (1, -1):
            y = yc
            while abs(y - yc) < 0.012:
                if skin_z(x, y) >= eye_z(x, y) - 1e-5:
                    break
                y += sgn * step
            res.append(np.array([x, y, skin_z(x, y)]))
        U.append(res[0])
        L.append(res[1])
    return xs, np.array(U), np.array(L)


def lash_strip(V, Q, s):
    """上まぶたの縁に沿う濃い細い帯（まつ毛の生え際と影）。根元は縁の少し内（眼球の側）、上の縁は 0.9〜1.3mm 上"""
    xs, Up, _ = lid_margins(V, Q, s)
    c, r = HM.eye_place(s)
    n = len(xs)
    out = []
    for i, p in enumerate(Up):
        u = i / (n - 1)
        w = 0.0012 * (0.30 + 0.70 * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.6) * (1 - 0.25 * u)
        d = p - c
        d /= np.linalg.norm(d)
        root = p - np.array([0, 0.00035, 0]) + d * 0.00025
        tip = p + np.array([0, w, 0]) + d * 0.0007
        out.append(root)
        out.append(tip)
    out = np.array(out)
    Fc = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) if s > 0 else (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(n - 1)]
    return out, Fc


# ================= 眉 =================
BROW_LIFT = 0.0148      # 眉の帯の中心の高さ（眼球の中心から）。旧 0.0172 は目から離れて眉が上がった（驚いた）顔に見えた


def brow_strip(s):
    """眉：眉の骨の上に沿った帯（透ける画像）。ほぼまっすぐで目に近く、眉頭は太く、眉尻へ細く少し下がる"""
    head_sdf = HM.head_sdf()
    c, _ = HM.eye_place(s)
    cx, cy = abs(c[0]), c[1]
    xs = np.linspace(cx - 0.0200, cx + 0.0215, 15)
    u = (xs - xs[0]) / (xs[-1] - xs[0])
    ys = cy + BROW_LIFT + 0.0010 * np.sin(np.pi * np.clip(u * 1.25, 0, 1)) - 0.0032 * u ** 2
    w = 0.0125 - 0.0050 * u ** 1.2
    rows = []
    ks = (-0.46, -0.21, 0.04, 0.29, 0.54)
    for k in ks:
        pts = np.array([(s * x, y + k * ww, 0.14) for x, y, ww in zip(xs, ys, w)])
        for _ in range(40):
            d = head_sdf(pts).astype(float)
            pts[:, 2] -= np.clip(d - 0.0008, -0.01, 0.01)
        rows.append(pts)
    nr = len(ks)
    Vb = np.array([rows[r_][i] for i in range(len(xs)) for r_ in range(nr)])
    UV = np.array([(u[i], r_ / (nr - 1)) for i in range(len(xs)) for r_ in range(nr)])
    Fc = []
    for i in range(len(xs) - 1):
        for r_ in range(nr - 1):
            a0, a1, b0, b1 = i * nr + r_, i * nr + r_ + 1, (i + 1) * nr + r_, (i + 1) * nr + r_ + 1
            Fc.append((a0, b0, b1, a1) if s > 0 else (a0, a1, b1, b0))
    return Vb, Fc, UV


def brow_tex(w=768, h=192, seed=31):
    """眉の画像（RGBA。U：眉頭 → 眉尻、V：行 0 が上）。自作。
    毛の線を主にして（塗りの芯は薄く）、縁は毛の先で途切れる。眉頭は太く上へ立つ毛でまばら、真ん中は外へ寝た毛で濃く、
    眉尻は細く薄れる。色は黒に近い焦げ茶（毛ごとに少し明るさが違う）"""
    import textures as TX
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    u = xx / w
    v = 1 - yy / h
    cyf = lambda uu: 0.50 + 0.03 * np.sin(np.pi * np.clip(uu * 1.2, 0, 1)) - 0.05 * uu ** 2
    thf = lambda uu: (0.66 + 0.06 * np.sin(np.pi * np.clip(uu / 0.5, 0, 1))) * (1 - 0.60 * np.clip((uu - 0.35) / 0.65, 0, 1) ** 1.1)
    cy, thick = cyf(u), thf(u)
    body = np.exp(-((v - cy) / (0.5 * thick)) ** 4)
    head = np.clip(u / 0.10, 0, 1) ** 0.7
    tail = np.clip((1 - u) / 0.12, 0, 1)
    shape = body * head * tail
    acc = np.zeros((h, w))
    shade = np.zeros((h, w))
    for _ in range(3400):
        uu = rng.uniform(0, 1)
        c = float(cyf(uu))
        th = float(thf(uu))
        vv = c + rng.uniform(-0.55, 0.50) * th
        ang = math.radians(float(np.interp(uu, [0, 0.10, 0.28, 0.6, 1.0], [75, 55, 18, 6, -10])) + rng.uniform(-12, 12))
        Lpx = rng.uniform(22, 44) * (0.60 + 0.40 * min(1.0, uu / 0.2))
        x0, y0 = uu * w, (1 - vv) * h
        x1, y1 = x0 + math.cos(ang) * Lpx, y0 - math.sin(ang) * Lpx
        st = rng.uniform(0.45, 1.0)
        TX._splat_line(acc, x0, y0, x1, y1, lambda t: st * (1 - 0.8 * t), width=1.0)
    k = np.array([0.25, 0.5, 0.25])
    acc = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, acc)
    a = np.clip(acc * 1.15, 0, 1) * np.clip(shape * 1.5, 0, 1)
    core = np.exp(-((v - cy) / (0.26 * thick)) ** 2) * head * tail
    a = np.clip(np.maximum(a, 0.32 * core * shape), 0, 1) * 0.90
    dark = TX.srgb((20, 15, 12))
    light = TX.srgb((62, 46, 34))
    mixv = np.clip(acc * 0.5, 0, 1)[..., None] * 0.35 + np.clip(1 - shape, 0, 1)[..., None] * 0.35
    img[..., :3] = dark * (1 - mixv) + light * mixv
    img[..., 3] = a
    return img


# ================= 肌の色味（頂点の色） =================
def skin_tint(Vh, hairline_y):
    """唇・頬・鼻・耳を少し赤く、目のまわり・まぶたの際を少し暗く、ひげの剃り跡を少し青く。値は 0..1 の掛け算"""
    col = np.ones((len(Vh), 3))

    def near(c, r):
        return np.exp(-np.sum(((Vh - np.array(c)) / np.array(r)) ** 2, axis=1))

    def mul(w, k):
        return (1 - w[:, None] * np.array(k))
    L = HM.face_landmarks()
    my, mz = L['mouth']
    lips = near((0, my, mz), (0.020, 0.0085, 0.012))
    col *= mul(lips, [0.03, 0.30, 0.26])                 # 唇（肌より赤く、少し暗く）
    col *= mul(near((0, my, mz), (0.020, 0.0012, 0.012)), [0.30, 0.38, 0.36])       # 口の合わせ目（弱く）
    for s in (1, -1):
        col *= mul(near((s * 0.043, my + 0.036, 0.075), (0.020, 0.016, 0.02)), [0.0, 0.11, 0.10])   # 頬の赤み
        ec = L['ear'] * np.array([s, 1, 1])
        col *= mul(near(ec, (0.011, 0.027, 0.020)), [0.06, 0.20, 0.18])                            # 耳（赤み）
        col *= mul(near((s * 0.0125, L['nose_tip'][1] - 0.004, L['nose_tip'][2] - 0.017), (0.006, 0.006, 0.008)), [0.0, 0.06, 0.06])   # 小鼻
        c, _ = HM.eye_place(s)
        col *= mul(near(c + np.array([0, 0.0005, 0.011]), (0.019, 0.011, 0.010)), [0.10, 0.10, 0.06])   # 目のまわり（少し暗く、少し寒色）
        col *= mul(near(c + np.array([0, 0.0085, 0.009]), (0.015, 0.0035, 0.007)), [0.10, 0.11, 0.09])  # 上まぶたの折れ目
        col *= mul(near(c + np.array([s * 0.003, -0.0055, 0.012]), (0.012, 0.0022, 0.007)), [0.05, 0.06, 0.04])   # 下まぶたの際
        col *= mul(near((s * 0.050, my - 0.010, 0.035), (0.014, 0.025, 0.03)), [0.03, 0.025, 0.0])    # あごの横（少し青み）
    col *= mul(near(L['nose_tip'], (0.010, 0.009, 0.012)), [0.0, 0.07, 0.07])                       # 鼻先
    col *= mul(near((0, 1.690, 0.088), (0.040, 0.020, 0.03)), [-0.02, -0.015, 0.0])                   # 額
    col *= mul(near((0, my - 0.040, 0.045), (0.040, 0.012, 0.040)), [0.12, 0.12, 0.10])              # あごの下（首への影）
    beard = np.maximum(near((0, my - 0.025, 0.085), (0.042, 0.022, 0.04)), near((0, my + 0.012, mz + 0.003), (0.018, 0.005, 0.01)) * 0.6) * (1 - lips)
    col *= mul(beard, [0.07, 0.055, 0.015])                # ひげの剃り跡（少し暗く、青み）
    x, y, z = Vh[:, 0], Vh[:, 1], Vh[:, 2]
    nz = (np.sin(x * 157 + y * 61 + 1.3) * np.sin(y * 113 - z * 89 + 0.4) + 0.6 * np.sin(z * 211 + x * 97 + 2.1) * np.sin(y * 173 + 0.7))
    col *= (1 + 0.03 * nz)[:, None]
    # 生え際：髪の根元が透けて見える帯。髪の下はさらに暗く
    yh = hairline_y(Vh.astype(np.float32)).astype(float)
    below = np.clip((yh - y) / 0.009, 0, None)
    band = np.where(y >= yh, 1.0, np.exp(-below ** 1.6))
    col *= (1 - 0.45 * band)[:, None] * np.array([1.0, 1.02, 1.04])[None] ** (-band[:, None])
    under = np.clip((y - yh - 0.004) / 0.008, 0, 1)
    col *= (1 - 0.45 * under)[:, None]
    col *= (0.86 + 0.14 * np.clip((Vh[:, 1] - 1.40) / 0.08, 0, 1))[:, None]      # 襟の中は少し暗く
    return col
