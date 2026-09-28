"""
主人公の頭（第 2 版の頭、2026-09）。座標はゲームの向き（x 左、y 上、z 前、メートル）。左右は s=+1 が左（+x）。
旧の頭（anatomy.head の第 1 版）は archive/head_v1_5761a83/ に残してある。

形の作り方：
- 大きな塊（頭蓋・額・顔の中央・下あご・あご先）を楕円体とカプセルのなめらかな和で作り、
- 骨の目印（眉の骨・頬骨・頬骨弓・下あごの角）を足し、
- 柔らかい起伏（こめかみ・頬の下・目の下・口の横）はガウスの山と谷で面を押し引きする（面がなめらかにつながる）。
- 目：眼球は別の部品（build_hero_v3.eyeball）。顔の面には目の開き（アーモンド形）の穴をあけ、眼球の外側に沿う薄い殻（まぶた）を足す。
  左右の眼球は同じ向き（正面、わずかに下）を見る。
- 口は閉じる（上下の唇が触れて、合わせ目は浅い線だけ）。
"""
from __future__ import annotations

import numpy as np

from sdf import F, axis_angle, capsule, ecapsule, ellipsoid, smax, smin, sphere

# ---- 目 ----
EYE_C = np.array([0.0310, 1.6315, 0.0685])   # 眼球の中心（左）
EYE_R = 0.0121
EYE_LOOK = np.array([0.0, -0.06, 1.0])        # 両目とも同じ向き（わずかに下）


def mirror(p, s):
    p = np.array(p, float)
    p[0] *= s
    return p


def _g(P, c, r):
    """ガウスの重み（楕円の広がり r）"""
    q = (P - np.asarray(c, F)) / np.asarray(r, F)
    return np.exp(-(q * q).sum(1)).astype(F)


# 上下のまぶたの縁（目の局所座標 x：内→外、y：上）。アーモンド形で外の角が少し上がる
AP_OUT = np.radians(70) * EYE_R   # 目じりまで（眼球の面の上の弧の長さ）
AP_IN = np.radians(61) * EYE_R    # 目頭まで
AP_UP = 0.0041            # 上まぶたの縁の一番高い所（中心より少し内寄り）
AP_LO = -0.0034           # 下まぶたの縁の一番低い所（少し外寄り）
AP_TILT = 0.0016          # 外の角の上がり


def lid_curves(x):
    """目の中心からの横の距離 x（内が負、外が正）での、上の縁・下の縁の高さ"""
    u = np.clip(np.where(x > 0, x / AP_OUT, x / AP_IN), -1, 1)
    base = AP_TILT * u
    up = base + AP_UP * (1 - u * u) ** 0.62 * (1 - 0.18 * u)
    lo = base + AP_LO * (1 - u * u) ** 0.75 * (1 + 0.12 * u)
    return up, lo


def eye_arc(P, s):
    """目の開き（負が開きの中）。眼球の中心から見た角度で決める錐（眼球の面の上の弧の長さで AP_* を測る）ので、
    目じり・目頭は眼球の丸みに沿って奥へ回り込む。眼球の面から reach より遠い所は開けない"""
    c = mirror(EYE_C, s)
    q = P - c.astype(F)
    r = np.maximum(np.linalg.norm(q, axis=1), 1e-6)
    x = np.arctan2(q[:, 0] * s, q[:, 2]) * F(EYE_R)
    y = np.arctan2(q[:, 1], np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)) * F(EYE_R)
    up, lo = lid_curves(x)
    dy = np.maximum(y - up, lo - y)
    dx = np.where(x > 0, x - AP_OUT, -x - AP_IN)
    return np.maximum(dy, dx * 0.6).astype(F), r, x, y


def eye_aperture(P, s, reach=.0042):
    """目の開きの 3D の形（負が中）：眼球の中心からの錐を、眼球の面から reach までに限る"""
    a2, r, _, _ = eye_arc(P, s)
    return np.maximum(a2 * (r / F(EYE_R)), r - F(EYE_R + reach)).astype(F)


def _skull(P):
    # 頭蓋：前後 0.197・幅 0.152（頭の幅/長さ 0.78 の丸めの頭）。横は少し平らに
    d = ellipsoid(P, (0, 1.657, -.006), (.0800, .0885, .0915))
    d = smax(d, np.abs(P[:, 0]) - F(.0765), .026)                                # 横を少し平らに
    d = smin(d, ellipsoid(P, (0, 1.678, .028), (.0660, .0600, .0655)), .03)        # 額（立ち気味）
    d = smax(d, P[:, 2] - F(.0955), .03)                                           # 額の前は平らめに
    return d


def _face(P):
    d = ellipsoid(P, (0, 1.608, .030), (.0560, .0560, .0600))                     # 顔の中央（上あご・頬の奥）
    d = smin(d, ellipsoid(P, (0, 1.578, .030), (.0500, .0600, .0620)), .022)       # 顔の下半分の肉（頬の下からあごの横まで広く。縦長で、口の高さに横の稜ができない）
    d = smin(d, ellipsoid(P, (0, 1.573, .050), (.0300, .0260, .0450)), .015)       # 歯列の丸み（唇の土台）
    # 下あご：あご先から左右のえら、えらから耳の前へ（枝）
    for s in (1, -1):
        d = smin(d, capsule(P, (s * .011, 1.5335, .0770), (s * .0460, 1.5480, .0010), .0110, .0110), .016)
        d = smin(d, capsule(P, (s * .0460, 1.5480, .0010), (s * .0530, 1.6020, -.0120), .0100, .0080), .012)
        d = smin(d, ellipsoid(P, (s * .0420, 1.5680, .0090), (.0110, .0280, .0200)), .018)   # 咬筋（えらの上の肉）
    d = smin(d, ellipsoid(P, (0, 1.5350, .0800), (.0185, .0135, .0145)), .016)     # あご先
    for s in (1, -1):
        d = smin(d, ellipsoid(P, (s * .0065, 1.5325, .0800), (.0100, .0095, .0110)), .010)   # あご先の角（少し四角く）
    d = smin(d, ellipsoid(P, (0, 1.5240, .0400), (.0360, .0110, .0400)), .020)     # あごの下（口の底）
    return d


def _bones(P):
    """骨の目印：眉の骨・頬骨・頬骨弓"""
    d = None
    for s in (1, -1):
        brow = capsule(P, (s * .007, 1.6530, .0885), (s * .030, 1.6565, .0840), .0072, .0080)
        brow = smin(brow, capsule(P, (s * .030, 1.6565, .0840), (s * .053, 1.6510, .0660), .0080, .0060), .007)
        cheek = capsule(P, (s * .045, 1.6170, .0590), (s * .061, 1.6200, .0330), .0082, .0094)
        cheek = smin(cheek, capsule(P, (s * .061, 1.6200, .0330), (s * .0650, 1.6140, -.0110), .0082, .0045), .014)
        b = smin(brow, cheek, .012)
        d = b if d is None else smin(d, b, .012)
    d = smin(d, ellipsoid(P, (0, 1.6540, .0875), (.013, .010, .008)), .012)      # 眉の間
    return d


def _nose(P):
    n = ecapsule(P, (0, 1.6390, .0880), (0, 1.6060, .1100), .0062, .0076, .74, (1, 0, 0))   # 鼻筋（横に細い）
    n = smin(n, ellipsoid(P, (0, 1.5990, .1072), (.0080, .0068, .0072)), .007)           # 鼻先
    for s in (1, -1):
        n = smin(n, capsule(P, (s * .0040, 1.6360, .0890), (s * .0095, 1.6030, .0965), .0046, .0052), .006)   # 鼻の横の面
        n = smin(n, ellipsoid(P, (s * .0105, 1.5930, .0945), (.0050, .0050, .0066)), .0075)   # 小鼻（平たい翼）
    n = smin(n, capsule(P, (0, 1.5935, .1030), (0, 1.5880, .0975), .0036, .0034), .004)  # 鼻柱
    return n


def _lips(P):
    # 上唇：真ん中が少し前（上唇の山）。下唇：少し厚く、少し後ろ
    up = None
    for s in (1, -1):
        a = capsule(P, (0, 1.5708, .0940), (s * .0115, 1.5712, .0905), .0034, .0032)
        a = smin(a, capsule(P, (s * .0115, 1.5712, .0905), (s * .0228, 1.5672, .0830), .0032, .0020), .004)
        up = a if up is None else smin(up, a, .003)
    lo = None
    for s in (1, -1):
        a = capsule(P, (0, 1.5620, .0915), (s * .0125, 1.5625, .0880), .0043, .0039)
        a = smin(a, capsule(P, (s * .0125, 1.5625, .0880), (s * .0220, 1.5662, .0830), .0039, .0020), .004)
        lo = a if lo is None else smin(lo, a, .003)
    return up, lo


def arch_z(x, y):
    """歯列の丸み（_face の楕円体）の前の面の z"""
    q = 1 - (np.asarray(x) / .0300) ** 2 - ((y - 1.573) / .0260) ** 2
    return .0500 + .0450 * np.sqrt(np.maximum(q, 0))


def _mouth_line(P):
    """口の合わせ目（閉じた口の浅い線）。歯列の面に沿う細いカプセルの鎖。口角で少し奥へ"""
    pts = []
    for x in np.linspace(-.0245, .0245, 15):
        u = x / .0245
        y = 1.5667 + 0.0008 * (1 - u * u) - 0.0004 * u ** 4
        z = arch_z(x, y) + .0009 * np.exp(-(x / .017) ** 2) - .0004 - .0012 * u ** 6
        pts.append((x, y, z))
    d = None
    for a, b in zip(pts[:-1], pts[1:]):
        c = capsule(P, a, b, .00065)
        d = c if d is None else np.minimum(d, c)
    return d


def _ear(P, s):
    R = axis_angle((0, 1, 0), s * 0.20) @ axis_angle((1, 0, 0), -0.24)
    c = np.array((s * .0745, 1.6160, -.0120))
    ear = ellipsoid(P, c, (.0075, .0290, .0175), R)                                 # 耳の板
    ear = smin(ear, ellipsoid(P, c + np.array([s * .0005, -.0215, .0040]), (.0058, .0095, .0078)), .005)   # 耳たぶ
    # 外の縁（耳輪）：なめらかな弧
    pts = []
    for a in np.linspace(-0.55, 3.35, 26):
        pts.append(c + np.array([s * (.0050 + .0022 * np.sin(a)), .0270 * np.cos(a) - .002, -.0160 * np.sin(a) + .0010]))
    rim = None
    for a, b in zip(pts[:-1], pts[1:]):
        k = capsule(P, a, b, .0030)
        rim = k if rim is None else np.minimum(rim, k)
    ear = smin(ear, rim, .006)
    ear = smin(ear, ellipsoid(P, c + np.array([s * .0020, -.0050, .0120]), (.0060, .0068, .0050)), .004)   # 耳珠
    ear = smax(ear, -ellipsoid(P, c + np.array([s * .0110, -.0040, .0020]), (.0065, .0105, .0080)), .003)  # 耳甲介（くぼみ）
    ear = smax(ear, -ellipsoid(P, c + np.array([s * .0095, .0125, -.0030]), (.0040, .0085, .0060)), .002)  # 上のくぼみ
    return ear


def caruncle(P, s):
    """目頭の赤い肉（涙丘）。目頭の奥のすき間を埋める"""
    c = mirror(EYE_C, s)
    a = np.radians(-52)
    p = c + np.array([s * np.sin(a) * (EYE_R + .0004), -.0004, np.cos(a) * (EYE_R + .0004)])
    return ellipsoid(P, p, (.0024, .0030, .0026))


def _lid(P, s):
    """まぶた：眼球の外側に沿う殻（厚み 上 2.9mm・下 1.9mm、縁で 0.7mm）。返り値は殻の距離と、目の開きからの弧の距離"""
    c = mirror(EYE_C, s)
    ap, r, _, _ = eye_arc(P, s)
    q = P[:, 1] - F(c[1])
    t = (.0019 + .0010 * np.clip(q / .006, 0, 1)).astype(F)                     # 上まぶたは厚く、下は薄く
    # 縁へ向かって眼球の面まで薄くなる（まぶたの縁は眼球に乗る。目じり・目頭の奥が暗い穴にならない）
    e = np.clip(ap / F(.0032), 0, 1)
    t = F(.0007) + (t - F(.0007)) * (e * (2 - e))
    return (r - F(EYE_R) - t).astype(F), ap


def _socket(P, s):
    """眼窩（顔の面を眼球の近くまで下げる）：主の楕円体と、目頭の側（鼻の付け根の横へ下がる面）"""
    c = mirror(EYE_C, s)
    k = ellipsoid(P, c + np.array([s * .0010, .0010, .0010]), (.0172, .0120, .0122))
    k = smin(k, ellipsoid(P, c + np.array([-s * .0040, .0004, .0095]), (.0085, .0105, .0112)), .005)
    k = smin(k, ellipsoid(P, c + np.array([-s * .0100, -.0003, .0115]), (.0062, .0092, .0092)), .005)
    return k


def lid_height(P, s):
    """目のまわりの面の、眼球の面からの高さ T（m）。a＝目の開きの縁からの弧の距離（mm、眼球の中心から見た角度×半径）。
    縁で 1mm → 上まぶたの丸み → 折れ目（上だけ、a≈2.7mm）→ 眉の下・頬へ急に高くなる"""
    a2, r, x, y = eye_arc(P, s)
    up, lo = lid_curves(x)
    upper = (y > (up + lo) * 0.5).astype(F)
    am = np.maximum(a2, 0) * F(1000)
    T = F(1.0) + F(0.7) * am + F(0.02) * am ** 3
    T = T - upper * F(0.55) * np.exp(-((am - F(2.7)) / F(0.7)) ** 2)            # 上まぶたの折れ目
    T = T + upper * F(0.35) * np.exp(-((am - F(1.2)) / F(0.9)) ** 2)            # 上まぶたの丸み
    return T * F(0.001), r


def _orbit_carve(P, s):
    """眼窩：眼窩の開き（楕円体）の中で、眼球の面から T(a) より外を削る領域（負が削る所）"""
    c = mirror(EYE_C, s)
    T, r = lid_height(P, s)
    oc = c + np.array([s * .0040, .0010, .0030])
    orad = np.array([.0290, .0260, .0300])
    k0 = np.linalg.norm((P - oc.astype(F)) / orad.astype(F), axis=1)
    rise = _sstep((k0 - F(0.30)) / F(0.70))
    T = T + F(.030) * rise * rise                     # 眼窩の縁へ向かってなめらかに元の顔の面へ
    orbit = ellipsoid(P, oc, orad)
    return smax(orbit, F(EYE_R) + T - r, .002)


def head_base(P):
    d = _skull(P)
    d = smin(d, _face(P), .03)
    d = smin(d, _bones(P), .016)
    # 柔らかい起伏（ガウスの押し引き。+ は面を外へ）
    bump = np.zeros(len(P), F)
    for s in (1, -1):
        bump -= .0018 * _g(P, (s * .066, 1.660, .040), (.014, .018, .020))    # こめかみのくぼみ
        bump += .0016 * _g(P, (s * .060, 1.598, .004), (.010, .013, .015))    # 頬骨弓の下（咬筋の上）を埋める
        bump -= .0019 * _g(P, (s * .049, 1.589, .048), (.012, .014, .016))    # 頬骨の下のくぼみ
        bump += .0012 * _g(P, (s * .038, 1.600, .068), (.012, .008, .012))    # 頬の前の肉（目の下の少し下）
        bump -= .0018 * _g(P, (s * .030, 1.616, .082), (.014, .006, .010))    # 目の下（頬は角膜より前へ出ない）
        bump -= .0008 * _g(P, (s * .028, 1.614, .078), (.010, .004, .010))    # 目の下のくぼみ（涙袋の下）
        bump += .0010 * _g(P, (s * .036, 1.6490, .0840), (.012, .0035, .006))  # 眉の下の肉（上まぶたに少しかぶる）
        bump -= .0012 * _g(P, (s * .026, 1.566, .080), (.004, .010, .008))    # 口角の横
        bump += .0012 * _g(P, (s * .015, 1.583, .090), (.007, .005, .007))    # 上唇の上の張り（鼻の下の両側）
    bump -= .0016 * _g(P, (0, 1.5490, .0870), (.013, .0045, .008))            # 下唇の下のくぼみ
    for s in (1, -1):
        bump -= .0010 * _g(P, (s * .0185, 1.5920, .0920), (.0025, .0060, .0050))   # 小鼻の脇の溝
    bump -= .0030 * _g(P, (0, 1.6415, .0950), (.008, .005, .007))             # 鼻の付け根（眉の間の下）
    d = d - bump
    for s in (1, -1):
        d = smax(d, -_orbit_carve(P, s), .0080)
    d = smin(d, _nose(P), .0085)
    # 唇：歯列の丸みの面に沿うふくらみ（面の押し出し。管を足さないので、口角で輪のように浮かない）
    lip = .0024 * _g(P, (0, 1.5714, .094), (.0170, .0036, .010))                 # 上唇
    lip += .0006 * _g(P, (0, 1.5738, .096), (.0045, .0012, .006))                # 上唇の山（真ん中の小さな盛り上がり）
    lip += .0029 * _g(P, (0, 1.5612, .092), (.0155, .0046, .010))                # 下唇（少し厚い）
    for s in (1, -1):
        lip -= .0010 * _g(P, (s * .0245, 1.5668, .083), (.0035, .0040, .006))   # 口角のくぼみ
    d = d - lip
    d = smax(d, -_mouth_line(P), .0010)
    d = d + .0009 * _g(P, (0, 1.5790, .0960), (.0026, .0075, .006))           # 人中（鼻の下の縦の溝）
    for s in (1, -1):
        d = smax(d, -ellipsoid(P, (s * .0060, 1.5866, .0960), (.0024, .0011, .0032)), .0012)   # 鼻の穴（下を向く）
    return d


def _sstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def head(P):
    d = head_base(P)
    # 目：まぶたと眼窩の面は head_base の _orbit_carve（眼球の面からの高さ T(a)）。ここでは目の開きをあけるだけ
    for s in (1, -1):
        ap3 = eye_aperture(P, s, reach=.0035)
        d = smax(d, -ap3, .0007)
        d = smin(d, caruncle(P, s), .0012)
    for s in (1, -1):
        d = smin(d, _ear(P, s), .0045)
    return d


def preview_color(P):
    """確かめの描画用の色（ゲームでは使わない）"""
    col = np.tile(np.array([0.74, 0.55, 0.42]), (len(P), 1))
    return col
