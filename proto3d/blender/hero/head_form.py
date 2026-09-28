"""
主人公の頭（第 2 版の頭、2026-09）。座標はゲームの向き（x 左、y 上、z 前、メートル）。左右は s=+1 が左（+x）。
旧の頭（anatomy.head の第 1 版）は archive/head_v1_5761a83/ に残してある。

形の作り方：
- 大きな塊（頭蓋・額・顔の中央・下あご・あご先）を楕円体とカプセルのなめらかな和で作り、
- 骨の目印（眉の骨・頬骨・頬骨弓・下あごの角）を足し、
- 柔らかい起伏（こめかみ・頬の下・目の下・口の横）はガウスの山と谷で面を押し引きする（面がなめらかにつながる）。
- 目：眼球は別の部品（build_hero_v3.eyeball）。顔の面から眼窩のくぼみ（外ほど奥へ傾いたなめらかな楕円体）を引き、
  眼球の外側に沿う薄い殻（まぶた）を足して、目の開き（アーモンド形）の穴をあける。眉の骨がくぼみの上にかぶる（深い目）。
  左右の眼球は同じ向き（正面、わずかに下）を見る。
- 口は閉じる（上下の唇が触れて、合わせ目は浅いガウスの溝だけ）。唇は歯列の面に沿う畝（lip_relief）。
- 2026-09 第 4 案（段階 4）：下の顔を細く（えらの幅・あご先）、あごの線を斜めに上げ、鼻を長く、眉の骨を下げ、
  眼窩を「削って T(a) の高さにする」方式から「くぼみ＋まぶたの殻」に替えた（目のまわりの輪のふくらみ・目じりの上の穴が出ない）
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
AP_OUT = np.radians(80) * EYE_R   # 目じりまで（眼球の面の上の弧の長さ）
AP_IN = np.radians(74) * EYE_R    # 目頭まで
AP_UP = 0.0035            # 上まぶたの縁の一番高い所（中心より少し内寄り）
AP_LO = -0.0032           # 下まぶたの縁の一番低い所（少し外寄り）
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
    d = ellipsoid(P, (0, 1.608, .030), (.0565, .0560, .0600))                     # 顔の中央（上あご・頬の奥）
    d = smin(d, ellipsoid(P, (0, 1.586, .028), (.0455, .0530, .0575)), .022)       # 顔の下半分の肉（頬の下からあごの横まで）
    d = smin(d, ellipsoid(P, (0, 1.573, .050), (.0300, .0260, .0450)), .015)       # 歯列の丸み（唇の土台）
    # 下あご：あご先から左右のえら、えらから耳の前へ（枝）
    for s in (1, -1):
        # 下あごの下の縁：あご先（低い）から えら（2026-09：高めに。あごの線が斜めに上がる）
        d = smin(d, capsule(P, (s * .009, 1.5420, .0755), (s * .0445, 1.5610, .0000), .0098, .0098), .013)
        d = smin(d, capsule(P, (s * .0445, 1.5600, .0000), (s * .0505, 1.6040, -.0120), .0092, .0078), .012)
        d = smin(d, ellipsoid(P, (s * .0400, 1.5760, .0080), (.0100, .0250, .0190)), .016)   # 咬筋（えらの上の肉）
    d = smin(d, ellipsoid(P, (0, 1.5435, .0770), (.0170, .0122, .0140)), .014)     # あご先（下唇より少し後ろ）
    for s in (1, -1):
        d = smin(d, ellipsoid(P, (s * .0052, 1.5405, .0760), (.0092, .0086, .0105)), .010)   # あご先の角（少し四角く）
    d = smin(d, ellipsoid(P, (0, 1.5345, .0440), (.0320, .0095, .0380)), .016)     # あごの下（口の底）
    return d


def _bones(P):
    """骨の目印：眉の骨・頬骨・頬骨弓"""
    d = None
    for s in (1, -1):
        brow = capsule(P, (s * .007, 1.6510, .0885), (s * .030, 1.6535, .0845), .0074, .0082)
        brow = smin(brow, capsule(P, (s * .030, 1.6535, .0845), (s * .053, 1.6480, .0665), .0082, .0060), .007)
        cheek = capsule(P, (s * .045, 1.6170, .0590), (s * .061, 1.6200, .0330), .0082, .0094)
        cheek = smin(cheek, capsule(P, (s * .061, 1.6200, .0330), (s * .0650, 1.6140, -.0110), .0082, .0045), .014)
        b = smin(brow, cheek, .012)
        d = b if d is None else smin(d, b, .012)
    d = smin(d, ellipsoid(P, (0, 1.6520, .0880), (.013, .010, .008)), .012)      # 眉の間
    return d


def _nose(P):
    n = ecapsule(P, (0, 1.6400, .0890), (0, 1.6040, .1135), .0064, .0078, .74, (1, 0, 0))   # 鼻筋（横に細い）
    n = smin(n, ellipsoid(P, (0, 1.5975, .1100), (.0082, .0072, .0076)), .007)           # 鼻先（少し下を向く）
    for s in (1, -1):
        n = smin(n, capsule(P, (s * .0040, 1.6360, .0890), (s * .0095, 1.6030, .0965), .0046, .0052), .006)   # 鼻の横の面
        n = smin(n, ellipsoid(P, (s * .0112, 1.5930, .0955), (.0054, .0052, .0068)), .0075)   # 小鼻（平たい翼）
    n = smin(n, capsule(P, (0, 1.5940, .1050), (0, 1.5885, .0985), .0036, .0034), .004)  # 鼻柱
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


def lip_relief(P):
    """唇のふくらみ（面を外へ押す量）。口の幅に沿って、上唇（赤い部分の高さ約 7mm）・下唇（約 9mm、少し厚い）の丸い畝。
    上唇の縁（赤と肌の境）は細い稜（white roll）で、真ん中に小さな谷（上唇の山の間）がある。口角へ向かって細る"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    u = np.clip(x / F(.0255), -1, 1)
    w = np.clip(1 - u * u, 0, 1) ** 0.55
    zm = np.exp(-((z - F(.092)) / F(.013)) ** 2)
    up_c = F(1.5711) + F(.0006) * (1 - u * u)
    up = F(.0047) * w * np.exp(-((y - up_c) / F(.0033)) ** 2)
    lo_c = F(1.5605) + F(.0012) * u * u
    lo = F(.0056) * w * np.exp(-((y - lo_c) / F(.0041)) ** 2)
    ax = np.abs(x)
    yb = F(1.5750) + F(.0004) * np.exp(-((ax - F(.0055)) / F(.0030)) ** 2) - F(.0006) * np.exp(-(x / F(.0022)) ** 2) - F(.0032) * u * u
    roll = F(.0007) * w * np.exp(-((y - yb) / F(.0008)) ** 2)
    return ((up + lo + roll) * zm).astype(F)


def arch_z(x, y):
    """歯列の丸み（_face の楕円体）の前の面の z"""
    q = 1 - (np.asarray(x) / .0300) ** 2 - ((y - 1.573) / .0260) ** 2
    return .0500 + .0450 * np.sqrt(np.maximum(q, 0))


def mouth_groove(P):
    """口の合わせ目（閉じた口の浅い溝、面を内へ引く量）。歯列の面に沿う線の近くのガウスの谷。口角で少し深く、少し奥へ"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    u = np.clip(x / F(.0250), -1.2, 1.2)
    yl = F(1.5667) + F(.0008) * (1 - u * u) - F(.0004) * u ** 4
    zl = arch_z(x, yl).astype(F)
    inside = np.clip(1.25 - np.abs(u), 0, 1)
    g = np.exp(-((y - yl) / F(.00075)) ** 2) * np.exp(-((z - zl) / F(.010)) ** 2) * inside
    return (F(.0016) * g).astype(F)


def _ear(P, s):
    R = axis_angle((0, 1, 0), s * 0.20) @ axis_angle((1, 0, 0), -0.24)
    c = np.array((s * .0745, 1.6210, -.0130))
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


def _bowl(P, s):
    """眼窩のくぼみ（顔の面から引く、なめらかな楕円体）。軸は前から外へ 20°（外の縁ほど奥）。
    奥の極は眼球の前の面より約 6mm 後ろ（眼球がくぼみから前へ出る）"""
    c = mirror(EYE_C, s)
    R = axis_angle((0, 1, 0), s * np.radians(20))
    ax = R @ np.array([0.0, 0.0, 1.0])
    rad = np.array([.0230, .0160, .0200])
    cc = c + ax * .0262 + np.array([s * .0010, -.0006, 0.0])
    return ellipsoid(P, cc, rad, R)


def lid_shell(P, s):
    """まぶた：眼球の外側に沿う薄い殻（縁で 0.9mm、縁から離れるほど少し厚く。上まぶたの方が厚い）。
    くぼみ（_bowl）の面から出ている所だけが見える"""
    a2, r, x, y = eye_arc(P, s)
    up, lo = lid_curves(x)
    wu = _sstep((y - (up + lo) * 0.5) / F(0.0030) + F(0.5))
    am = np.clip(a2, 0, F(.012)) * F(1000)
    T = F(0.9) + (F(0.10) + F(0.06) * wu) * am
    return (r - F(EYE_R) - T * F(0.001)).astype(F)


def head_base(P):
    d = _skull(P)
    d = smin(d, _face(P), .03)
    d = smin(d, _bones(P), .016)
    # 柔らかい起伏（ガウスの押し引き。+ は面を外へ）
    bump = np.zeros(len(P), F)
    for s in (1, -1):
        bump -= .0018 * _g(P, (s * .066, 1.660, .040), (.014, .018, .020))    # こめかみのくぼみ
        bump += .0016 * _g(P, (s * .060, 1.598, .004), (.010, .013, .015))    # 頬骨弓の下（咬筋の上）を埋める
        bump -= .0024 * _g(P, (s * .049, 1.589, .048), (.012, .014, .016))    # 頬骨の下のくぼみ
        bump -= .0016 * _g(P, (s * .047, 1.572, .044), (.009, .012, .014))    # 頬のこけ（口の横の奥）
        bump += .0012 * _g(P, (s * .038, 1.600, .068), (.012, .008, .012))    # 頬の前の肉（目の下の少し下）
        bump -= .0018 * _g(P, (s * .030, 1.616, .082), (.014, .006, .010))    # 目の下（頬は角膜より前へ出ない）
        bump -= .0008 * _g(P, (s * .028, 1.614, .078), (.010, .004, .010))    # 目の下のくぼみ（涙袋の下）
        bump -= .0012 * _g(P, (s * .026, 1.566, .080), (.004, .010, .008))    # 口角の横
        bump += .0012 * _g(P, (s * .015, 1.583, .090), (.007, .005, .007))    # 上唇の上の張り（鼻の下の両側）
    bump -= .0016 * _g(P, (0, 1.5490, .0870), (.013, .0045, .008))            # 下唇の下のくぼみ
    for s in (1, -1):
        bump -= .0010 * _g(P, (s * .0185, 1.5920, .0920), (.0025, .0060, .0050))   # 小鼻の脇の溝
    bump -= .0042 * _g(P, (0, 1.6420, .0955), (.009, .005, .007))             # 鼻の付け根（眉の間の下）
    d = d - bump
    for s in (1, -1):
        d = smax(d, -_bowl(P, s), .006)
        d = smin(d, lid_shell(P, s), .0025)
    d = smin(d, _nose(P), .0085)
    # 唇：歯列の丸みの面に沿うふくらみ（面の押し出し。管を足さないので、口角で輪のように浮かない）
    lip = lip_relief(P)
    for s in (1, -1):
        lip -= .0010 * _g(P, (s * .0245, 1.5668, .083), (.0035, .0040, .006))   # 口角のくぼみ
    d = d - lip
    d = d + mouth_groove(P)
    d = d + .0009 * _g(P, (0, 1.5790, .0960), (.0026, .0075, .006))           # 人中（鼻の下の縦の溝）
    for s in (1, -1):
        d = smax(d, -ellipsoid(P, (s * .0062, 1.5872, .0975), (.0022, .0009, .0034)), .0010)   # 鼻の穴（下を向く）
    return d


def _sstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def head(P):
    d = head_base(P)
    # 目：眼窩のくぼみ（_bowl）とまぶたの殻（lid_shell）は head_base。ここでは目の開きをあけるだけ
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
