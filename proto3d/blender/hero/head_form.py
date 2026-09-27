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
EYE_C = np.array([0.0310, 1.6315, 0.0640])   # 眼球の中心（左）
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
    d = ellipsoid(P, (0, 1.655, -.014), (.0745, .089, .097))
    d = smax(d, np.abs(P[:, 0]) - F(.0712), .028)                                # 横を少し平らに
    d = smin(d, ellipsoid(P, (0, 1.673, .030), (.0625, .058, .064)), .03)          # 額
    d = smax(d, P[:, 2] - F(.0955), .03)                                           # 額の前は平らめに
    return d


def _face(P):
    d = ellipsoid(P, (0, 1.606, .030), (.0545, .058, .060))                       # 顔の中央（上あご・頬の奥）
    d = smin(d, ellipsoid(P, (0, 1.566, .037), (.044, .054, .060)), .026)          # 口のまわりの土台（歯列の丸み：鼻の下から唇・あごへ続く面）
    # 下あご：あご先から左右のえら、えらから耳の前へ（枝）
    for s in (1, -1):
        d = smin(d, capsule(P, (s * .010, 1.527, .074), (s * .0415, 1.5490, .006), .0110, .0106), .016)
        d = smin(d, capsule(P, (s * .0415, 1.5490, .006), (s * .055, 1.603, -.010), .0108, .0100), .014)
        d = smin(d, ellipsoid(P, (s * .036, 1.584, .026), (.016, .033, .028)), .024)   # 咬筋（頬の横の肉）
    d = smin(d, ellipsoid(P, (0, 1.529, .074), (.0175, .0135, .0140)), .012)       # あご先
    for s in (1, -1):
        d = smin(d, ellipsoid(P, (s * .0060, 1.5265, .0750), (.0105, .0095, .0110)), .010)   # あご先の角（少し四角く）
    return d


def _bones(P):
    """骨の目印：眉の骨・頬骨・頬骨弓"""
    d = None
    for s in (1, -1):
        brow = capsule(P, (s * .006, 1.6520, .0895), (s * .030, 1.6560, .0845), .0074, .0080)
        brow = smin(brow, capsule(P, (s * .030, 1.6560, .0845), (s * .052, 1.6500, .0660), .0080, .0058), .007)
        cheek = capsule(P, (s * .045, 1.6170, .0590), (s * .061, 1.6200, .0330), .0082, .0094)
        cheek = smin(cheek, capsule(P, (s * .061, 1.6200, .0330), (s * .0650, 1.6140, -.0110), .0082, .0045), .014)
        b = smin(brow, cheek, .012)
        d = b if d is None else smin(d, b, .012)
    d = smin(d, ellipsoid(P, (0, 1.6510, .0880), (.014, .011, .008)), .012)      # 眉の間
    return d


def _nose(P):
    n = ecapsule(P, (0, 1.6425, .0895), (0, 1.6060, .1100), .0064, .0074, .72, (1, 0, 0))   # 鼻筋（横に細い）
    n = smin(n, ellipsoid(P, (0, 1.5990, .1072), (.0080, .0068, .0072)), .007)           # 鼻先
    for s in (1, -1):
        n = smin(n, capsule(P, (s * .0040, 1.6360, .0890), (s * .0095, 1.6030, .0965), .0046, .0052), .006)   # 鼻の横の面
        n = smin(n, ellipsoid(P, (s * .0112, 1.5930, .0955), (.0054, .0052, .0068)), .0060)   # 小鼻（平たい翼）
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


def _mouth_line(P):
    """口の合わせ目（閉じた口の浅い線）。細いカプセルの鎖"""
    pts = []
    for x in np.linspace(-.0238, .0238, 13):
        u = x / .0238
        y = 1.5666 + 0.0009 * (1 - u * u) - 0.0005 * u ** 4
        z = .0955 - 0.0120 * u * u - 0.0010 * u ** 4
        pts.append((x, y, z))
    d = None
    for a, b in zip(pts[:-1], pts[1:]):
        c = capsule(P, a, b, .0007)
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
    k = ellipsoid(P, c + np.array([s * .0005, .0012, .0035]), (.0178, .0125, .0128))
    k = smin(k, ellipsoid(P, c + np.array([-s * .0040, .0004, .0095]), (.0085, .0105, .0112)), .005)
    k = smin(k, ellipsoid(P, c + np.array([-s * .0100, -.0003, .0115]), (.0062, .0092, .0092)), .005)
    return k


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
        bump += .0016 * _g(P, (s * .036, 1.604, .070), (.012, .009, .012))    # 頬の前の肉（目の下の少し下）
        bump -= .0008 * _g(P, (s * .028, 1.614, .078), (.010, .004, .010))    # 目の下のくぼみ（涙袋の下）
        bump += .0014 * _g(P, (s * .034, 1.6450, .0800), (.013, .0035, .006))  # 眉の下の肉（上まぶたにかぶる）
        bump -= .0012 * _g(P, (s * .026, 1.566, .080), (.004, .010, .008))    # 口角の横
        bump += .0012 * _g(P, (s * .015, 1.583, .090), (.007, .005, .007))    # 上唇の上の張り（鼻の下の両側）
    bump -= .0016 * _g(P, (0, 1.5490, .0870), (.013, .0045, .008))            # 下唇の下のくぼみ
    for s in (1, -1):
        bump -= .0010 * _g(P, (s * .0185, 1.5920, .0920), (.0025, .0060, .0050))   # 小鼻の脇の溝
    bump -= .0020 * _g(P, (0, 1.6400, .0930), (.009, .006, .008))             # 鼻の付け根（眉の間の下）
    d = d - bump
    for s in (1, -1):
        d = smax(d, -_socket(P, s), .007)
    d = smin(d, _nose(P), .0085)
    up, lo = _lips(P)
    d = smin(d, up, .0055)
    d = smin(d, lo, .0055)
    d = smax(d, -_mouth_line(P), .0012)
    d = d + .0009 * _g(P, (0, 1.5790, .0960), (.0026, .0075, .006))           # 人中（鼻の下の縦の溝）
    for s in (1, -1):
        d = smax(d, -ellipsoid(P, (s * .0060, 1.5858, .0975), (.0026, .0012, .0036)), .0012)   # 鼻の穴（下を向く）
    return d


def head(P):
    d = head_base(P)
    # 目：まぶた（眼球に沿う殻。縁は眼球に乗る）を足し、目の開きをあける
    for s in (1, -1):
        c = mirror(EYE_C, s)
        shell, ap = _lid(P, s)
        ap3 = eye_aperture(P, s)
        lid = smax(shell, -ap3, .0010)
        lid = smax(lid, -(P[:, 2] - F(c[2] - .003)), .003)                      # 眼球の後ろ半分には付けない
        d = smin(d, lid, .0050)
        d = smax(d, -ap3, .0010)
        d = smin(d, caruncle(P, s), .0015)
        # 上まぶたの折れ目（弱く）
        crease = capsule(P, c + np.array([-s * .0110, .0088, .0112]), c + np.array([s * .0125, .0092, .0078]), .0007)
        d = smax(d, -crease, .0016)
    for s in (1, -1):
        d = smin(d, _ear(P, s), .0045)
    return d


def preview_color(P):
    """確かめの描画用の色（ゲームでは使わない）"""
    col = np.tile(np.array([0.74, 0.55, 0.42]), (len(P), 1))
    return col
