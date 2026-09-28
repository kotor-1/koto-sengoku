"""
主人公（若殿）の体の形を SDF で定める。座標はゲームの向き（x 左、y 上、z 前、メートル）。
骨の位置は hero_v2（proto3d/assets-src/hero_v2/build_hero.py）と同じ。左右は s=+1 が左（+x）。
"""
from __future__ import annotations

import numpy as np

import head_form as HF
from sdf import (F, axis_angle, box, capsule, ecapsule, ellipsoid, plane, smax, smin, sphere, sub, union)

# ---- 骨の位置（ゲームの座標、休みの姿勢） ----
J = {
    'Hips': (0, .945, 0), 'Spine': (0, 1.105, 0), 'Chest': (0, 1.315, 0), 'Neck': (0, 1.469, 0), 'Head': (0, 1.541, 0),
}
for _side, _s in (('Left', 1), ('Right', -1)):
    J[_side + 'Shoulder'] = (_s * .173, 1.37, 0)
    J[_side + 'UpperArm'] = (_s * .205, 1.369, 0)
    J[_side + 'ForeArm'] = (_s * .296, 1.108, .012)
    J[_side + 'Hand'] = (_s * .325, .889, .032)
    J[_side + 'UpperLeg'] = (_s * .099, .945, 0)
    J[_side + 'LowerLeg'] = (_s * .099, .514, .012)
    J[_side + 'Foot'] = (_s * .099, .098, .026)
J = {k: np.array(v, float) for k, v in J.items()}

SOLE_Y = 0.017          # 足袋の底（草履の上面）の高さ
EYE_C = HF.EYE_C
EYE_R = HF.EYE_R


def mirror(p, s):
    p = np.array(p, float)
    p[0] *= s
    return p


def bbox_dist(P, lo, hi):
    """箱までの距離（箱の中は 0）。部位の SDF を箱の外で省くための下限"""
    q = np.maximum(np.asarray(lo, F) - P, P - np.asarray(hi, F))
    return np.linalg.norm(np.maximum(q, 0), axis=1)


def bounded(P, fn, lo, hi, margin=0.03):
    lo = np.asarray(lo, float) - margin
    hi = np.asarray(hi, float) + margin
    inside = np.all((P >= lo) & (P <= hi), axis=1)
    out = bbox_dist(P, lo, hi) + F(margin)
    if inside.any():
        out[inside] = fn(P[inside])
    return out


# ================= 胴 =================
def torso(P):
    ds = [
        ellipsoid(P, (0, .93, -.005), (.150, .11, .105)),              # 骨盤
        ellipsoid(P, (0, 1.08, .005), (.128, .13, .094)),              # 腹
        ellipsoid(P, (0, 1.27, -.004), (.138, .16, .099)),             # 胸郭
        ellipsoid(P, (0, 1.36, -.004), (.150, .075, .088)),            # 胸の上
    ]
    for s in (1, -1):
        ds += [
            ellipsoid(P, (s * .072, .895, -.045), (.074, .085, .068)),     # 尻
            ellipsoid(P, (s * .062, 1.318, .052), (.072, .052, .042)),     # 大胸筋
            ellipsoid(P, (s * .085, 1.26, -.042), (.075, .12, .058)),      # 背の広背筋
            ellipsoid(P, (s * .07, 1.435, -.03), (.075, .035, .042)),      # 僧帽筋
            capsule(P, (0, 1.475, -.035), (s * .165, 1.418, -.018), .028, .024),
            ellipsoid(P, (s * .192, 1.372, .0), (.048, .064, .052)),      # 三角筋
            capsule(P, (s * .018, 1.442, .052), (s * .158, 1.432, .014), .0095, .0085),  # 鎖骨
        ]
    d = union(ds[:4], .045)
    for x in ds[4:]:
        d = smin(d, x, .03)
    return d


def neck(P):
    # 下（襟の中・襟の縁の高さまで）は第 1 版と同じ太さ。あごの下（y 1.505 より上）は細め（頭の方が首より広く見えるように。
    # 2026-09 第 5 案：あごの下を約 1 割細く、胸鎖乳突筋・喉仏を弱く。襟の縁（横で y 1.496、後ろで 1.525）の高さの太さは変えない）
    d = ecapsule(P, (0, 1.40, -.016), (0, 1.585, -.024), .057, .052, .88, (0, 0, 1))
    # 幅（x）だけ細くする。前後（喉・うなじ）の厚みは第 4 案のまま（喉の前にくびれが出ない）
    rx = np.interp(P[:, 1], [1.48, 1.505, 1.52, 1.58], [.070, .0580, .0495, .0405]).astype(F)
    rz = F(.88) * np.interp(P[:, 1], [1.48, 1.515, 1.58], [.070, .0565, .0455]).astype(F)
    q = np.sqrt((P[:, 0] / rx) ** 2 + ((P[:, 2] + F(.021)) / rz) ** 2)
    d = smax(d, (q - F(1)) * np.minimum(rx, rz), .008)
    for s in (1, -1):
        # 胸鎖乳突筋：耳の後ろ（乳様突起）から胸骨の上へ（細く、なだらかに）
        d = smin(d, capsule(P, (s * .049, 1.590, -.034), (s * .013, 1.447, .045), .0092, .0074), .016)
    d = smin(d, ellipsoid(P, (0, 1.488, .033), (.0085, .011, .0075)), .012)   # 喉仏（弱く）
    d = smin(d, ellipsoid(P, (0, 1.512, .018), (.024, .016, .027)), .016)   # あごの下から喉へ（斜めの面）
    return d


# ================= 頭 =================
# 頭（顔・耳・まぶた）は head_form.py（第 2 版の頭）。旧の頭は archive/head_v1_5761a83/anatomy.py
def head(P):
    return HF.head(P)


# ================= 腕と手 =================
def arm(P, s):
    sh, el, wr = J['LeftUpperArm'], J['LeftForeArm'], J['LeftHand']
    sh, el, wr = mirror(sh, s), mirror(el, s), mirror(wr, s)
    d = capsule(P, sh + np.array([0, .01, 0]), el, .046, .036)
    d = smin(d, ellipsoid(P, sh + (el - sh) * .45 + np.array([0, 0, .018]), (.034, .07, .03)), .02)    # 上腕二頭筋
    d = smin(d, ellipsoid(P, sh + (el - sh) * .40 + np.array([s * .006, 0, -.02]), (.036, .08, .032)), .02)  # 三頭筋
    d = smin(d, sphere(P, el + np.array([0, 0, -.006]), .034), .02)
    fd = wr - el
    d = smin(d, ecapsule(P, el, wr - fd * .02, .037, .0255, .74, (1, 0, 0) if s > 0 else (-1, 0, 0)), .02)
    d = smin(d, ellipsoid(P, el + fd * .28 + np.array([s * .012, 0, .008]), (.03, .058, .03)), .025)   # 腕橈骨筋
    d = smin(d, ellipsoid(P, el + fd * .30 + np.array([-s * .008, 0, -.004]), (.028, .06, .028)), .025)
    return d


def hand_frame(s):
    el, wr = mirror(J['LeftForeArm'], s), mirror(J['LeftHand'], s)
    dv = (wr - el) / np.linalg.norm(wr - el)
    n = np.array([-s, 0.0, -0.08])          # 手のひらは体の方（左手なら -x）
    n = n - dv * (n @ dv)
    n /= np.linalg.norm(n)
    t = np.cross(n, dv) * s                 # 親指の側（前）
    t /= np.linalg.norm(t)
    return wr, dv, t, n


FINGERS = [
    # (b 位置, a 位置, 開き, 長さ3つ, 太さ4つ, 曲げ3つ[度])
    (.0255, .092, .10, (.043, .026, .021), (.0094, .0083, .0071, .0060), (16, 26, 14)),
    (.0068, .097, .02, (.048, .030, .022), (.0097, .0086, .0073, .0062), (20, 32, 16)),
    (-.0118, .093, -.06, (.045, .028, .021), (.0091, .0081, .0069, .0059), (24, 36, 18)),
    (-.0285, .084, -.15, (.036, .021, .019), (.0081, .0072, .0062, .0054), (29, 40, 20)),
]


def finger_chains(s):
    """指の関節の位置（手の局所から世界へ）と太さ。爪を置くのにも使う"""
    W, dv, t, n = hand_frame(s)
    chains = []
    for b, a, spread, L, R, ang in FINGERS:
        base = W + a * dv + b * t
        d0 = dv + spread * t
        d0 /= np.linalg.norm(d0)
        pts = [base]
        dirs = []
        cur = d0
        for k in range(3):
            ax = np.cross(cur, n)
            ax /= np.linalg.norm(ax)
            cur = axis_angle(ax, np.radians(ang[k])) @ cur
            dirs.append(cur)
            pts.append(pts[-1] + L[k] * cur)
        chains.append((pts, R, dirs))
    # 親指
    cmc = W + .021 * dv + .021 * t + .006 * n
    d1 = .86 * dv + .30 * t + .40 * n
    d2 = .90 * dv + .12 * t + .42 * n
    d3 = .88 * dv + .02 * t + .47 * n
    ds = [x / np.linalg.norm(x) for x in (d1, d2, d3)]
    pts = [cmc]
    for Lk, dk in zip((.045, .033, .027), ds):
        pts.append(pts[-1] + Lk * dk)
    chains.append((pts, (.0145, .0112, .0095, .0080), ds))
    return chains


def hand(P, s):
    W, dv, t, n = hand_frame(s)
    el = mirror(J['LeftForeArm'], s)
    # 手首と前腕の下の方
    d = ecapsule(P, W - .07 * (W - el) / np.linalg.norm(W - el), W + .012 * dv, .0265, .0255, .70, n)
    # 手のひら：角の丸い箱と、中手骨 4 本（拳の節）
    Rh = np.column_stack([t, dv, n])
    palm = box(P, W + .050 * dv + .001 * t + .002 * n, (.037, .040, .0105), Rh, round_=.0095)
    for b, a, *_ in FINGERS:
        seg = capsule(P, W + .03 * dv + b * .6 * t - .002 * n, W + a * dv + b * t - .001 * n, .0100, .0098)
        palm = smin(palm, seg, .008)
    palm = smin(palm, ellipsoid(P, W + .054 * dv + .002 * t + .006 * n, (.030, .036, .009), Rh), .01)
    palm = smin(palm, ellipsoid(P, W + .036 * dv + .020 * t + .008 * n, (.018, .030, .0145), Rh), .012)  # 母指球
    palm = smin(palm, ellipsoid(P, W + .052 * dv - .026 * t + .004 * n, (.011, .034, .0105), Rh), .01)  # 小指球
    d = smin(d, palm, .016)
    chains = finger_chains(s)
    fingers = None
    for i, (pts, R, dirs) in enumerate(chains):
        dorsal = -n
        f = None
        for k in range(3):
            seg = ecapsule(P, pts[k], pts[k + 1], R[k], R[k + 1], .86 if k < 2 else .80, n)
            f = seg if f is None else smin(f, seg, .003)
        # 関節の節（手の甲の側に少し）
        for k in (1, 2):
            f = smin(f, sphere(P, pts[k] + dorsal * .0006, R[k] * 0.99), .004)
        if i < 4:
            f = smin(f, sphere(P, pts[0] + dorsal * .0035, R[0] * 1.02), .004)   # 拳の節
            fingers = f if fingers is None else np.minimum(fingers, f)
        else:
            thumb = f
    d = smin(d, fingers, .006)
    d = smin(d, thumb, .012)
    return d


# ================= 脚と足（足袋の形） =================
def leg(P, s):
    hp, kn, an = mirror(J['LeftUpperLeg'], s), mirror(J['LeftLowerLeg'], s), mirror(J['LeftFoot'], s)
    d = capsule(P, hp + np.array([s * .004, -.02, 0]), kn, .083, .052)
    d = smin(d, sphere(P, kn, .05), .02)
    d = smin(d, capsule(P, kn, an + np.array([0, .03, -.004]), .050, .029), .02)
    d = smin(d, ellipsoid(P, kn + np.array([0, -.12, -.022]), (.048, .09, .047)), .03)   # ふくらはぎ
    return d


def foot(P, s):
    """足袋をはいた足。親指だけ分かれる。底は平ら"""
    x0 = s * .099
    an = mirror(J['LeftFoot'], s)
    m = -s  # 内側（親指の側）の向き
    d = capsule(P, (x0, .20, .018), (x0, .085, .022), .031, .030)
    d = smin(d, ellipsoid(P, (x0, .056, -.012), (.031, .040, .040)), .02)           # かかと
    d = smin(d, capsule(P, (x0, .082, .045), (x0 + m * .004, .050, .132), .033, .028), .025)   # 甲
    d = smin(d, ellipsoid(P, (x0 + m * .002, .036, .135), (.047, .022, .032)), .02)  # 足の付け根のふくらみ
    d = smin(d, ellipsoid(P, (x0 + m * .002, .036, .075), (.040, .022, .060)), .02)
    for k in (-1, 1):
        d = smin(d, sphere(P, (x0 + k * .027, .087, .022), .011), .01)   # くるぶし
    big = ellipsoid(P, (x0 + m * .029, .034, .190), (.0175, .0185, .030))
    rest = ellipsoid(P, (x0 - m * .012, .030, .176), (.031, .0165, .030), axis_angle((0, 1, 0), -m * .22))
    toes = np.minimum(big, rest)
    d = smin(d, toes, .012)
    # 親指とほかの指の間の割れ目
    gx = x0 + m * .0125
    slit = box(P, (gx, .035, .205), (.0016, .03, .045))
    d = smax(d, -slit, .004)
    d = smax(d, -(P[:, 1] - F(SOLE_Y)), .004)
    return d


# ================= 全身 =================
BOXES = {
    'torso': ((-.26, .75, -.16), (.26, 1.49, .14)),
    'neck': ((-.08, 1.38, -.09), (.08, 1.61, .08)),
    'head': ((-.105, 1.49, -.125), (.105, 1.76, .125)),
    'headnoear': ((-.105, 1.49, -.125), (.105, 1.76, .125)),
    'armL': ((.14, .86, -.07), (.37, 1.44, .08)),
    'armR': ((-.37, .86, -.07), (-.14, 1.44, .08)),
    'handL': ((.25, .68, -.04), (.39, .93, .12)),
    'handR': ((-.39, .68, -.04), (-.25, .93, .12)),
    'legL': ((.0, .07, -.10), (.2, .96, .09)),
    'legR': ((-.2, .07, -.10), (.0, .96, .09)),
    'footL': ((.04, .0, -.06), (.16, .22, .23)),
    'footR': ((-.16, .0, -.06), (-.04, .22, .23)),
}
PARTS = {
    'torso': torso, 'neck': neck, 'head': head, 'headnoear': lambda P: HF.head(P, ears=False),
    'armL': lambda P: arm(P, 1), 'armR': lambda P: arm(P, -1),
    'handL': lambda P: hand(P, 1), 'handR': lambda P: hand(P, -1),
    'legL': lambda P: leg(P, 1), 'legR': lambda P: leg(P, -1),
    'footL': lambda P: foot(P, 1), 'footR': lambda P: foot(P, -1),
}
BLEND = {'torso': .0, 'neck': .03, 'head': .02, 'headnoear': .02, 'armL': .03, 'armR': .03, 'handL': .02, 'handR': .02,
         'legL': .04, 'legR': .04, 'footL': .02, 'footR': .02}


def body(P, parts=None):
    """全身（または一部）の SDF。部位は箱で区切って計算を省く"""
    parts = parts or [k for k in PARTS if k != 'headnoear']
    d = None
    for name in parts:
        lo, hi = BOXES[name]
        dd = bounded(P, PARTS[name], lo, hi, margin=.05)
        if d is None:
            d = dd
        elif name in ('head', 'headnoear'):
            d = smin_var(d, dd, head_blend_k(P))
        else:
            d = smin(d, dd, BLEND[name])
    return d


def smin_var(a, b, k):
    """場所ごとに丸みの幅 k（配列）が違う smin"""
    k = np.maximum(k, F(1e-5))
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def head_blend_k(P):
    """頭と首のつなぎの丸み：うなじ・耳の下は広く（2cm）、あごの下（前）は狭く（あごの線が立つ）"""
    # 第 5 案：横（えらの下）も狭く。広いのはうなじ（z < -0.04）だけ
    t = np.clip((P[:, 2] + F(.045)) / F(.040), 0, 1)
    return (F(.020) - F(.013) * t * t * (3 - 2 * t)).astype(F)
