"""
比較案の頭（MPFB の基本形）の髪。形の作り方は hair.py（髪の層・髷・元結・髷の房・うなじの毛）を使い、
頭の面だけを新しい頭（head_mpfb の SDF）に差し替える。第 2 案（見直し 1 回目の指摘を受けて）で変えた所：
- 生え際：額の生え際を上げ、こめかみの上に浅い剃り込み（M 字）。不ぞろいの出入りを入れ、横一直線にしない
- 髪の層：額の生え際から 3.4cm かけてゆっくり厚くなる（生え際に厚い縁ができない）。髪は額から結び目へなでつける。
  横（耳の上・こめかみの後ろ）を厚くして、頭に貼りついた帽子に見えないように。束の山と谷は浅く不規則に
- 顔の横の毛束：生え際の上から抜けて、こめかみの前を頬へ垂れる平たい毛束を右 2・左 1（長さをそろえない。先で分かれる）
- 額の生え際の透ける毛の板：見える髪の縁の上から 1〜3mm 下まで（上へ流れる毛。前髪にはしない）
- 髪の画像：ごく暗い茶。明るさのむらは毛の長さの向きに長く（斑点にしない）。粗さの画像で光沢の強さを束ごとに変える。
  髪の層の頂点の色で束ごとの明るさも変える（同じ間隔の光の筋に並ばない）
hair.py 自体は変えない（hero_v3 の作り方はそのまま）。差し替えは install() 〜 uninstall() の間だけ。
"""
from __future__ import annotations

import math

import numpy as np

import anatomy as A
import hair as H
import head_mpfb as HM
from sdf import F

_ORIG = {}

# 生え際（頭の周りの角度：前 0°、横 90°、後ろ 180° ごとの高さ）。新しい頭の耳は 61〜97°、耳の上の端は y 1.650
# 第 2 案：額の生え際を上げ、左右のこめかみの上に浅い剃り込み（M 字、20〜30°）。前髪の帯に見えないように、髪は額から後ろへなでつける
HL_T = np.array([0, 8, 14, 20, 25, 30, 36, 42, 47, 51, 55, 58, 61, 64, 68, 76, 86, 94, 100, 106, 114, 124, 138, 152, 166, 180])
HL_Y = np.array([1.712, 1.7125, 1.714, 1.716, 1.717, 1.715, 1.708, 1.696, 1.683, 1.669, 1.652, 1.636, 1.622, 1.640, 1.656, 1.659,
                 1.659, 1.656, 1.646, 1.630, 1.607, 1.584, 1.566, 1.556, 1.551, 1.549])


def hairline_y(P):
    """生え際の高さ：HL_T / HL_Y ＋ 不ぞろい（額からこめかみ。左右で違う、細かい出入りと大きめのうねり）"""
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - H.C[2]))
    y = np.interp(th, HL_T, HL_Y)
    sg = np.sign(P[:, 0]) + 0.5
    r = np.radians(th)
    jit = (0.0011 * np.sin(r * 19 + 1.3 * sg) + 0.0008 * np.sin(r * 37 + 0.4 + 2.1 * sg) + 0.0005 * np.sin(r * 71 + 2.0 * sg)
           + 0.0009 * np.sin(r * 7 + 0.9 * sg))
    y = y + jit * np.clip((64 - th) / 10, 0, 1)
    return y.astype(F)


def body(P, parts=None):
    """A.body の差し替え：頭（耳あり・耳なし）を含む組み合わせは新しい頭と首の肌の SDF（MPFB の首を含むので首の SDF は使わない）"""
    if parts and ('head' in parts or 'headnoear' in parts):
        d = HM.head_sdf(noear='headnoear' in parts)(P)
        rest = [p for p in parts if p not in ('head', 'headnoear', 'neck')]
        if rest:
            from sdf import smin
            d = smin(_ORIG['body'](P, rest), d, 0.02)
        return d.astype(F)
    return _ORIG['body'](P, parts)


def clump_profile(P):
    """束の山と谷（1 が山、0 が谷）：束の幅・深さ・ねじれを不規則に（同じ間隔の溝にしない）"""
    a = H.flow_angle(P)
    psi = H._psi(P)
    ph = (a * 19 + 2.3 * np.sin(2 * a + 0.8) + 1.7 * np.sin(5 * a + 2.0) + 1.3 * np.sin(9 * a + 0.3)
          + 1.6 * psi + 1.2 * np.sin(3 * psi + 2 * a))
    main = 0.5 + 0.5 * np.cos(ph)
    idx = np.floor(ph / (2 * math.pi) + 0.5)
    amp = 0.15 + 0.85 * (0.5 + 0.5 * np.sin(idx * 12.9898 + 4.1)) ** 2
    main = 1 - (1 - main) * amp
    ph2 = a * 31 + 3.1 * np.sin(3 * a + 1.1) + 2.4 * psi + 1.1 * np.sin(7 * a + 2.5)
    main2 = 0.5 + 0.5 * np.cos(ph2)
    wmix = 0.5 * (0.5 + 0.5 * np.sin(2 * a + 1.7 + 2.6 * psi))
    main = main * (1 - wmix) + main2 * wmix
    fine = 0.5 + 0.5 * np.cos(ph2 * 1.9 + 1.3 * np.sin(7 * a + psi * 3))
    return main.astype(F), fine.astype(F)


def mask(P):
    """髪のある所 1、無い所 0。額の生え際は 3.4cm かけてゆっくり厚くなる（生え際に厚い縁・巻いた縁ができない）"""
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - H.C[2]))
    soft = np.interp(th, [0, 40, 60, 70, 80, 86, 104, 112, 140, 180],
                     [0.034, 0.030, 0.016, 0.010, 0.009, 0.004, 0.004, 0.009, 0.014, 0.014]).astype(F)
    m = np.clip((P[:, 1] - H.hairline_y(P)) / soft, 0, 1)
    return (m * m * m * (10 - 15 * m + 6 * m * m)).astype(F)


def base_thickness(P):
    """山と谷を付ける前の厚み：頭頂 2cm・額の上（なでつけて後ろへ流れるふくらみ）1.5cm・横 1.2cm、生え際で 0。
    第 2 案：横（耳の上・こめかみの後ろ）を厚くして、頭に貼りついた帽子に見えないように。額の上のふくらみは生え際から 2cm ほど
    後ろで立ち上がる（生え際にすぐ厚い縁ができない）"""
    m = mask(P)
    psi = H._psi(P)
    top = np.clip(1 - psi / math.radians(100), 0, 1)
    th = np.degrees(np.arctan2(np.abs(P[:, 0]), P[:, 2] - H.C[2]))
    front = np.exp(-(th / 50) ** 2) * H._sm((P[:, 1] - 1.722) / 0.035)
    t = 0.0095 + 0.0100 * top + 0.0025 * np.exp(-(psi / math.radians(24)) ** 2) + 0.0025 * front
    side = np.exp(-((th - 82) / 26) ** 2) * np.clip((P[:, 1] - 1.655) / 0.020, 0, 1) * np.clip((1.745 - P[:, 1]) / 0.03, 0, 1)
    t = t + 0.0035 * side
    ear = np.exp(-((th - 80) / 16) ** 2) * np.clip((P[:, 1] - 1.655) / 0.010, 0, 1) * np.clip((1.700 - P[:, 1]) / 0.025, 0, 1)
    t = t + 0.0035 * ear
    return (t * m).astype(F)


def thickness(P):
    t = base_thickness(P)
    main, fine = H.clump_profile(P)
    psi = H._psi(P)
    fade = np.clip((psi - math.radians(18)) / math.radians(22), 0, 1)
    k = 1 - fade * (0.07 * (1 - main) ** 1.5 + 0.02 * (1 - fine))
    return (t * k).astype(F)


def install():
    if _ORIG:
        return
    _ORIG.update(body=A.body, HL_T=H._HL_T, HL_Y=H._HL_Y, clump=H.clump_profile, base=H.base_thickness, thick=H.thickness,
                 tie=H.TIE_POINT, locks=H.LOCKS, hly=H.hairline_y, mask=H.mask)
    A.body = body
    H.hairline_y = hairline_y
    H.mask = mask
    H._HL_T, H._HL_Y = HL_T, HL_Y
    H.clump_profile = clump_profile
    H.base_thickness = base_thickness
    H.thickness = thickness
    H.TIE_POINT = None
    H.LOCKS = LOCKS


def uninstall():
    if not _ORIG:
        return
    A.body = _ORIG['body']
    H.hairline_y = _ORIG['hly']
    H.mask = _ORIG['mask']
    H._HL_T, H._HL_Y = _ORIG['HL_T'], _ORIG['HL_Y']
    H.clump_profile, H.base_thickness, H.thickness = _ORIG['clump'], _ORIG['base'], _ORIG['thick']
    H.TIE_POINT = _ORIG['tie']
    H.LOCKS = _ORIG['locks']
    _ORIG.clear()


# ---- 顔のまわりの房（細い毛の束 ＋ 透ける毛の板）。制御点は左 s=+1 の形（x に s を掛ける） ----
# 第 2 案：額の生え際の上（なでつけた髪の中）から抜けて、こめかみの前を頬へ垂れる、長さのそろわないゆるい毛束を
# 右 2・左 1（左右で違う）。目にはかからない（目じりの外）。額を横切る前髪にはしない
# (制御点, 房の幅の目安（束の半幅の約 2.4 倍）, 先で分かれる数 - 1, s, 種, 先の肌からの距離)
LOCKS = [
    # 右：長い（生え際の少し後ろ → こめかみの後ろ寄り（耳の前）→ 頬骨の下まで。肌から離れて垂れる）
    ([(.026, 1.750, .058), (.046, 1.732, .072), (.060, 1.704, .070), (.068, 1.674, .060), (.071, 1.644, .050),
      (.072, 1.614, .045), (.071, 1.590, .043)], .0105, 2, -1, 12, .0075),
    # 右：短い（耳の前の上）
    ([(.042, 1.746, .046), (.058, 1.726, .056), (.069, 1.698, .052), (.074, 1.670, .042), (.076, 1.646, .034)],
     .0085, 1, -1, 14, .0060),
    # 左：中くらい
    ([(.032, 1.750, .056), (.050, 1.730, .068), (.063, 1.702, .066), (.070, 1.672, .056), (.072, 1.644, .048),
      (.072, 1.620, .044)], .0095, 2, 1, 13, .0070),
]


def lock_meshes():
    """房：細い毛の束（管、房の材質）と、房ごとの透ける板（毛の板の材質）。返り値：(V, F, UV), (V2, F2, UV2)"""
    V, Fc, UV = [], [], []
    V2, F2, UV2 = [], [], []

    def add(v, f, uv):
        base = len(V)
        V.extend(v)
        UV.extend(uv)
        Fc.extend([tuple(x + base for x in ff) for ff in f])
    for ctrl, w0, nsub, s, seed, tip_off in LOCKS:
        sp = H._lock_path(ctrl, s, seed, tip_off)
        n = len(sp)
        tt = np.linspace(0, 1, n)
        N = H._grad(H.cap_sdf, sp)
        T = np.gradient(sp, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True)
        N = N - T * (N * T).sum(1, keepdims=True)
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        B = np.cross(T, N)
        B /= np.linalg.norm(B, axis=1, keepdims=True) + 1e-12
        rng = np.random.default_rng(seed + 50)
        # 第 2 案：房の本体は平たい毛束（幅 4〜5mm・厚み 1.5mm、髪の画像の毛の筋が幅の中に何本も並ぶ）。下の半分で 2〜3 本に分かれ、
        # 先ほど細く、長さをそろえない（細い管を並べると紐・縫い目に見えた）
        root_r = w0 * 0.42
        mc = int(n * 0.62)
        uu = np.linspace(0, 1, mc)
        rr = root_r * (1 - 0.25 * uu)
        v, fc, uv = H.tube(sp[:mc], rr, ring=6, flat=0.35, up=N[:mc], uv_u0=seed * 0.21, uv_v=(0.10, 0.45), u_span=0.07)
        add(v, fc, uv)
        j0 = int(n * 0.45)
        for k in range(nsub + 1):
            f = (k / max(nsub, 1) - 0.5) + rng.uniform(-0.15, 0.15)
            ext = rng.uniform(0.85, 1.12)
            sub = sp[j0:].copy()
            m = len(sub)
            q = np.linspace(0, 1, m)
            sub = sub[0] + (sub - sub[0]) * ext
            sub = sub + B[j0:] * (f * root_r * 1.6 * q ** 1.2)[:, None] + N[j0:] * (0.0012 * rng.uniform(0.2, 1.0) * np.sin(np.pi * q * 0.8))[:, None]
            rs = root_r * rng.uniform(0.40, 0.55) * (1 - 0.85 * q ** 1.3)
            v, fc, uv = H.tube(sub, rs, ring=5, flat=0.45, up=N[j0:], uv_u0=seed * 0.21 + 0.02 * k, uv_v=(0.3, 0.7), u_span=0.03)
            add(v, fc, uv)
        # 透ける板（束の下、肌の側に少し沈める。先は束より少し長い）
        base = len(V2)
        j0 = max(1, int(0.50 * n))          # 板は分かれた先のまわりだけ（ほつれ毛）
        ext = np.vstack([sp[j0:], sp[-1] + (sp[-1] - sp[-2]) * np.arange(1, 3)[:, None]])
        Ne = np.vstack([N[j0:], np.repeat(N[-1:], 2, 0)])
        Be = np.vstack([B[j0:], np.repeat(B[-1:], 2, 0)])
        ne = len(ext)
        for j in range(ne):
            t = j / (ne - 1)
            w = 1.6 * w0 * (1 - 0.35 * t)
            p = ext[j] - Ne[j] * 0.0004
            V2.append(p - Be[j] * w / 2)
            V2.append(p + Be[j] * w / 2)
            UV2.append((0.0, 1 - t))
            UV2.append((1.0, 1 - t))
        for j in range(ne - 1):
            a = base + 2 * j
            F2.append((a, a + 1, a + 3, a + 2))
    return (np.array(V), Fc, np.array(UV)), (np.array(V2), np.array(F2), np.array(UV2))


def front_wisps(n=28, seed=21):
    """額・こめかみの生え際の透ける毛の板（生え際の硬い縁を消す）。第 2 案：生え際の不ぞろいの線（hairline_y）に沿い、
    髪の層の上（生え際の 5mm 上）から 1.5〜3.5mm 下までの短い板。毛は上（後ろ）へ流れる向きで、下の端はまばら。
    画像は hairline_card（下ほど薄い）。返り値は頂点・面・UV（V：上 1、下 0）"""
    rng = np.random.default_rng(seed)
    skin = lambda P: A.body(P, ['neck', 'head'])
    V, Fc, UV = [], [], []
    ths = np.linspace(-40, 40, n) + rng.uniform(-1.0, 1.0, n)     # 額だけ（こめかみの斜めの縁では短い刻みに見えた）
    for th in ths:
        t = math.radians(th)
        dirh = np.array([math.sin(t), 0.0, math.cos(t)])
        # 見える髪の縁（髪の層の厚みが 0.8mm を超える高さ。生え際の高さ hairline_y より数 mm 上）を肌の面の上で探す
        yy = np.arange(1.60, 1.76, 0.0005)
        cand = np.array([0.0, 0.0, H.C[2]])[None] + np.column_stack([np.zeros_like(yy), yy, np.zeros_like(yy)]) + dirh[None] * 0.12
        for _ in range(10):
            d = skin(cand.astype(F)).astype(float)
            g = np.array([cand[:, 0], np.zeros(len(cand)), cand[:, 2] - H.C[2]]).T
            g /= np.linalg.norm(g, axis=1, keepdims=True)
            cand -= g * np.clip(d, -0.02, 0.02)[:, None]
        tk = thickness(cand.astype(F)).astype(float)
        ok = np.nonzero(tk > 0.0008)[0]
        if len(ok) == 0:
            continue
        yl = float(yy[ok[0]])
        L = rng.uniform(0.0012, 0.0030)
        wdt = rng.uniform(0.007, 0.011)
        ys = yl + 0.004 - (0.004 + L) * np.linspace(0, 1, 4)
        pts = np.array([np.array([0.0, y, H.C[2]]) + dirh * 0.12 for y in ys])
        off = np.array([0.0, 0.0, 0.0005, 0.0004])
        for _ in range(14):
            d = skin(pts.astype(F)).astype(float) - off
            g = np.array([pts[:, 0], np.zeros(len(pts)), pts[:, 2] - H.C[2]]).T
            g /= np.linalg.norm(g, axis=1, keepdims=True)
            pts -= g * np.clip(d, -0.02, 0.02)[:, None]
        for j in range(2):             # 上の 2 点は髪の層の上
            pts[j] += dirh * (float(thickness(pts[j:j + 1].astype(F))[0]) + 0.0003)
        tang = np.array([math.cos(t), 0.0, -math.sin(t)])
        base = len(V)
        u0 = rng.uniform(0, 0.5)
        for j, p in enumerate(pts):
            q = j / (len(pts) - 1)
            w = wdt * (1 - 0.15 * q)
            V.append(p - tang * w / 2)
            V.append(p + tang * w / 2)
            UV.append((u0, 1 - q))
            UV.append((u0 + 0.5, 1 - q))
        for j in range(len(pts) - 1):
            a = base + 2 * j
            Fc.append((a, a + 1, a + 3, a + 2))
    return np.array(V), np.array(Fc), np.array(UV)


def hairline_card(w=128, h=64, seed=41):
    """生え際の透ける毛の板の画像（RGBA）。細い毛が上下に並び、上（行 0）は濃く、下へまばらに薄れる。
    毛の長さ・下の端の高さはそろえない（下の端が横一直線に並ばない）"""
    import textures as TX
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    a = np.zeros((h, w))
    for _ in range(170):
        x0 = rng.uniform(0, w)
        bottom = h * rng.uniform(0.35, 1.0) ** 0.7
        lean = rng.uniform(-3, 3)
        st = rng.uniform(0.4, 1.0)
        for py in range(int(bottom)):
            q = py / max(bottom, 1)
            px = x0 + lean * q
            ix = int(px) % w
            f = px - int(px)
            val = st * (1 - q ** 1.5)
            for dx, wt in ((0, 1 - f), (1, f)):
                xx = (ix + dx) % w
                a[py, xx] = max(a[py, xx], wt * val)
    fade = np.clip(1.25 - np.arange(h) / h, 0, 1)[:, None] ** 1.2
    img[..., 3] = np.clip(a * 1.6 * fade, 0, 1)
    img[..., :3] = TX.srgb((24, 17, 12))
    return img


# ---- 髪の画像 ----
def lock_card(w=96, h=256, seed=23):
    """房の透ける板の画像（RGBA）：真ん中に毛が集まり縁はまばら。毛は 1 画素の線を 110 本、長さ・濃さ・曲がりをそろえない。
    上（行 0）が根元、下が先（先ほど薄く細く）"""
    import textures as TX
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    a = np.zeros((h, w))
    shade = np.zeros((h, w))
    for _ in range(110):
        x0 = w * (0.5 + 0.30 * np.clip(rng.normal(0, 0.45), -1, 1))
        amp = rng.uniform(1, 5)
        ph = rng.uniform(0, 6.28)
        drift = rng.uniform(-10, 10)
        L = rng.uniform(0.55, 1.0)
        st = rng.uniform(0.5, 1.0)
        br = rng.uniform(0, 1)
        for py in range(int(h * L)):
            t = py / h
            px = x0 + amp * math.sin(t * 4 + ph) + drift * t * t
            ix = int(px)
            f = px - ix
            val = st * (1 - t / L) ** 0.6
            for dx, wt in ((0, 1 - f), (1, f)):
                if 0 <= ix + dx < w and wt * val > a[py, ix + dx]:
                    a[py, ix + dx] = wt * val
                    shade[py, ix + dx] = br
    k = np.array([0.2, 0.6, 0.2])
    a = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, a)
    img[..., 3] = np.clip(a * 2.4, 0, 1)
    dark = TX.srgb((20, 14, 10))
    light = TX.srgb((74, 52, 36))
    img[..., :3] = dark * (1 - shade[..., None] * 0.6) + light * shade[..., None] * 0.6
    return img



def _long_noise(w, h, scale_u, seed, stretch=24):
    """V（毛の長さの向き）に長く伸びた乱れ（U の向きに細かく、V の向きにゆっくり変わる）。斑点に見えない"""
    import textures as TX
    hs = max(8, h // stretch)
    n = TX.periodic_noise((hs, w), scale_u, seed, 3)
    yy = np.arange(h) / h * hs
    i0 = np.floor(yy).astype(int) % hs
    t = (yy - np.floor(yy))[:, None]
    t = t * t * (3 - 2 * t)
    return n[i0] * (1 - t) + n[(i0 + 1) % hs] * t


def hair_tex(size=1024, seed=17):
    """髪の色・法線・粗さ（U：頭の周り、V：結び目からの角度）。第 2 案：
    - 色はごく暗い茶（黒一色に見えないように、明るい毛は焦げ茶）
    - 毛の束の明るさは不規則。長さの向きのむらは V に長く伸びた乱れ（前の案の丸い斑点をやめる）
    - 粗さ（光沢の強さ）を束ごとに変える：光る束と鈍い束が混ざり、同じ間隔の光の筋に並ばない"""
    import textures as TX
    rng = np.random.default_rng(seed)
    w = h = size
    x = np.arange(w)
    cols = np.zeros(w)
    for _ in range(900):
        c = rng.uniform(0, w)
        wd = rng.uniform(0.8, 6.0) ** 1.3
        d = (x - c + w / 2) % w - w / 2
        cols += rng.normal(0, 1) * np.exp(-(d / wd) ** 2)
    cols = (cols - cols.mean()) / cols.std()
    shift = (3.0 * TX.periodic_noise((h, w), 400, seed + 3, 2) + 1.2 * TX.periodic_noise((h, w), 90, seed + 4, 2))
    xs = (x[None, :] + shift) % w
    i0 = np.floor(xs).astype(int)
    t = xs - i0
    val = cols[i0] * (1 - t) + cols[(i0 + 1) % w] * t
    lng = _long_noise(w, h, 120, seed + 5)
    val = 0.80 * val + 0.35 * lng
    hi = np.clip(val * 0.28 + 0.45, 0, 1)
    dark = TX.srgb((20, 14, 10))
    light = TX.srgb((74, 52, 36))
    col = dark[None, None, :] * (1 - hi[..., None] ** 1.6) + light[None, None, :] * hi[..., None] ** 1.6
    nrm = TX.normal_from_height(0.8 * val, 0.40)
    # 粗さ：束（幅 10〜40 画素）ごとに 0.52〜0.86。長さの向きにもゆっくり変わる
    rq = np.zeros(w)
    for _ in range(120):
        c = rng.uniform(0, w)
        wd = rng.uniform(10, 40)
        d = (x - c + w / 2) % w - w / 2
        rq += rng.normal(0, 1) * np.exp(-(d / wd) ** 2)
    rq = (rq - rq.mean()) / (rq.std() + 1e-9)
    r = rq[i0] * (1 - t) + rq[(i0 + 1) % w] * t
    r = 0.70 * r + 0.55 * _long_noise(w, h, 200, seed + 8, 16)
    rough = np.clip(0.69 + 0.12 * r, 0.50, 0.88)
    return col, nrm, rough


def hair_tint(Vh):
    """髪の層の頂点の色（掛け算）：束ごとの明るさの違い（0.80〜1.12）と、結び目からの長さの向きのゆっくりしたむら。
    同じ幅・同じ明るさの束が並んで規則的な縞に見えないように"""
    a = H.flow_angle(Vh.astype(F)).astype(float)
    psi = H._psi(Vh.astype(F)).astype(float)
    ph = a * 23 + 2.0 * np.sin(3 * a + 0.5) + 1.5 * psi
    idx = np.floor(ph / (2 * math.pi))
    br = 0.5 + 0.5 * np.sin(idx * 78.233 + 1.7)
    along = 0.5 + 0.5 * np.sin(psi * 7.0 + idx * 2.3)
    k = 0.80 + 0.22 * br + 0.10 * (along - 0.5)
    return np.repeat(k[:, None], 3, axis=1) * np.array([1.0, 0.98, 0.96])[None]


def preview_objects(mat):
    """preview_mpfb 用：髪の層・髷・房・元結・眉を置く（単色）"""
    import util as U
    install()
    try:
        hm = mat('hair', (0.03, 0.025, 0.022), 0.6)
        o = U.make_mesh('hair', *H.cap_mesh(0.0018))
        o.data.materials.append(hm)
        o = U.make_mesh('bun', *H.bun_mesh(0.0022))
        o.data.materials.append(hm)
        (Vl, Fl, _), (V2, F2, _) = lock_meshes()
        o = U.make_mesh('locks', Vl, Fl)
        o.data.materials.append(hm)
        Vt, Ft, _ = H.tuft()
        o = U.make_mesh('tuft', Vt, Ft)
        o.data.materials.append(hm)
        Vm, Fm = H.motoyui()
        o = U.make_mesh('motoyui', Vm, Fm)
        o.data.materials.append(mat('cord', (0.6, 0.57, 0.5), 0.6))
    finally:
        uninstall()
