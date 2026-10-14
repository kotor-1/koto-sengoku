#!/usr/bin/env python3
"""主人公・町人の動きの元（Idle / Walk / Run）。骨組みは第 2 版（build_hero.py）と同じ 20 本。
Version 28 で作り直した（build_hero.py の frame_pose をここへ移した。build_hero.py はここから読む）。

Version 27 までの動き（build_hero.py の旧 frame_pose）の測った欠点（docs/v28-town-motion-voice.md §4.1）と、ここでの直し：
- 歩きの腰の上下が逆（両足が着いた時に高く、片足で立つ時に低い）
  → 両足が着いた時（左の踵が着いた直後）に最も低く、片足で立った真ん中で最も高い。
- 待機の腰（0.945 m・脚がまっすぐ）と歩きの腰（0.863〜0.887 m）の差 6〜8 cm（歩き出し・止まりで腰が沈む・浮く）
  → 歩きの腰を高く（踵の着地・足先の蹴り出しで足首が上がる分だけ脚が届く）、待機の腰を少し下げて、差を 2 cm 以内に。
- 足はいつも地面と平ら → 踵から着き（つま先が上がる）、足裏が着き、踵が上がって母指球で蹴り出す（足の回転の中心を地面に止める）。
- 振り出した足が、着く直前まで前へ動いたまま地面に下りる（着地で 1〜3 m/秒 滑る）
  → 地面から見た足の動きを「離れた所 → 次に着く所」のなめらかな移動（両端で速さ 0）にし、体の前進を引いて元の動きにする。
- 走りの腰の上下も逆 → 片足で着いた真ん中で最も低く、両足が浮いた真ん中で最も高い（上下は 3 cm ほどに控える）。
- 歩きと走りで、足の着く・離れる位相の決まり（左の踵が着く = 位相 0、右 = 0.5）をそろえる。ゲームは位相を「進んだ距離 ÷ 1 周期の距離」で決め、
  着いた足は地面に止める（proto3d/src/game/legs.ts）。
足の位置は、地面に止めた点（踵・足裏・母指球）から逆に求め、脚は 2 本の骨の IK で解く（膝は前へ曲がる）。腰の高さは、両脚が届く高さの範囲で決める。
単位：メートル、Y が上、+Z が前。位相 0 = 左の踵が着いた瞬間。
"""
from __future__ import annotations

import math

import numpy as np
from scipy.spatial.transform import Rotation

PI = math.pi

# ---------------- 骨組み（第 2 版と同じ。休みの姿勢の骨の軸は世界の軸にそろう） ----------------
BONE_DEFS = [('Root', None, (0, 0, 0)), ('Hips', 'Root', (0, .945, 0)), ('Spine', 'Hips', (0, 1.105, 0)), ('Chest', 'Spine', (0, 1.315, 0)), ('Neck', 'Chest', (0, 1.469, 0)), ('Head', 'Neck', (0, 1.541, 0))]
for _side, _s in (('Left', 1), ('Right', -1)):
    BONE_DEFS += [
        (_side + 'Shoulder', 'Chest', (_s * .173, 1.37, 0)),
        (_side + 'UpperArm', _side + 'Shoulder', (_s * .205, 1.369, 0)),
        (_side + 'ForeArm', _side + 'UpperArm', (_s * .296, 1.108, .012)),
        (_side + 'Hand', _side + 'ForeArm', (_s * .325, .889, .032)),
        (_side + 'UpperLeg', 'Hips', (_s * .099, .945, 0)),
        (_side + 'LowerLeg', _side + 'UpperLeg', (_s * .099, .514, .012)),
        (_side + 'Foot', _side + 'LowerLeg', (_s * .099, .098, .026)),
    ]
BONE_NAMES = [b[0] for b in BONE_DEFS]
PARENT = {b[0]: b[1] for b in BONE_DEFS}
REST = {b[0]: np.array(b[2], float) for b in BONE_DEFS}

ANKLE_Y = REST['LeftFoot'][1]                      # 足首の高さ（足の裏が地面のとき）0.098
THIGH = REST['LeftLowerLeg'] - REST['LeftUpperLeg']  # 休みの姿勢の太もも（腰の関節 → 膝）
SHIN = REST['LeftFoot'] - REST['LeftLowerLeg']       # すね（膝 → 足首）
L1 = float(np.linalg.norm(THIGH))
L2 = float(np.linalg.norm(SHIN))
LEG = L1 + L2                                       # 0.8474
REACH = 0.9985 * LEG                                # 膝を伸ばしきらない（約 6° 曲げる）上限（IK の上限）
# 腰の高さを決めるときの脚の長さの上限：ゲームは着いた足を地面に止めるので、足の位置は動きの元から数 cm ずれる。
# その分と地面の凹凸（町の地面は 50 cm で 2〜3 cm 上下する）を、腰を下げずに届かせる余り（脚の長さの 1%：約 8 mm）を残す（proto3d/src/game/legs.ts）
FIT_REACH = 0.99 * LEG
HIP_X = .099
# 足の裏の点（足の骨＝足首から見た位置）。主人公の草履（かかと z −0.083・先 +0.182）と町人の足（−0.076・+0.134）の間を取る。
# 草履は曲がらない（指の骨が無い）ので、蹴り出しは足先（TIP）を地面に止めて回る（母指球で回ると足先が地面へ沈む）
HEEL = np.array([0., -.097, -.07])
BALL = np.array([0., -.097, .105])
TIP = np.array([0., -.094, .16])
SOLE = (HEEL, BALL, TIP)

# ---------------- 動きの決まり ----------------
# speed：1 周期で進む距離 ÷ 周期（ゲームの歩き 1.55 m/秒・走り 3.41 m/秒にそろえる。proto3d/src/game/gait.ts と同じ値）
# duty：片足が着いている割合。heel / toe：踵の着地のつま先の上がり・蹴り出しの踵の上がり（ラジアン）
# flat：足裏が着く区間（着いている間の割合）。lift：振り出しの足首の持ち上げ（m）
# bob：腰の上下の片振幅。yaw / sway / roll：骨盤の回り・横の移り・傾き。lean：上体の前傾
GAITS = {
    'Walk': dict(cycle=.84, speed=1.55, duty=.60, heel=.30, toe=.45, flat=(.12, .55), lift=.055, hips='reach', cap=.936, margin=.002, harmonics=2,
                 yaw=.07, sway=.012, roll=.030, lean=.03, foot_x=.090, toe_out=.05, arm=.22, elbow=(-.10, -.06)),
    'Run': dict(cycle=.64, speed=3.41, duty=.38, heel=.10, toe=.65, flat=(.10, .40), lift=.16, bob=.022,
                yaw=.10, sway=.006, roll=.025, lean=.11, foot_x=.085, toe_out=.03, arm=.43, elbow=(-1.05, 0.)),
}
IDLE_CYCLE = 6.4     # 待機の 1 周期（呼吸 2 回・重心の移り 1 往復）
CLIP_FPS = 60        # 書き出すコマの細かさ（足の着く・離れる瞬間をはっきり）


def smooth(q):
    q = min(1., max(0., q))
    return q * q * (3 - 2 * q)


def smoother(q):
    q = min(1., max(0., q))
    return q * q * q * (q * (q * 6 - 15) + 10)


def rx(a):
    return Rotation.from_euler('x', a)


def rx_apply(a, v):
    """Rx(a)·v（速く計算するため。Rotation.from_euler('x', a).apply(v) と同じ）"""
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c])


def ry(a):
    return Rotation.from_euler('y', a)


def rz(a):
    return Rotation.from_euler('z', a)


# ---------------- 足：地面に止めた点から足首と足の向きを求める ----------------
def stance_foot(g, s, heel_z):
    """着いている間（s = 0〜1）。heel_z：踵の点の（腰から見た）前後の位置。返り：(足首の位置, 足のピッチ)。
    ピッチ：正 = つま先が下がる（Rx の向き）。踵 → 足裏 → 母指球の順に、地面の点を止めたまま回る"""
    f0, f1 = g['flat']
    heel_pt = np.array([0., 0., heel_z])
    if s < f0:
        p = -g['heel'] * (1 - smooth(s / f0))
        return heel_pt - rx_apply(p, HEEL), p
    if s <= f1:
        return heel_pt - HEEL, 0.
    p = g['toe'] * smooth((s - f1) / (1 - f1)) ** 1.15
    tip_pt = heel_pt + (TIP - HEEL)
    return tip_pt - rx_apply(p, TIP), p


def leg_target(g, ph, zc):
    """片足の位相 ph（0 = その足の踵が着いた瞬間）での、足首の位置（腰の真下の地面を原点とする、体の前進を引いた元の動きの座標）とピッチ。
    zc：踵が着いた瞬間の踵の前後の位置"""
    T = g['cycle']
    v = g['speed']
    beta = g['duty']
    S = v * T
    ph %= 1.
    if ph < beta:
        s = ph / beta
        a, p = stance_foot(g, s, zc - v * T * ph)
        return a, p, True
    # 振り出し：地面から見て、離れた所 → 次に着く所へ（両端で速さ 0）。体の前進（v·T·ph）を引く
    q = (ph - beta) / (1 - beta)
    a_off, p_off = stance_foot(g, 1., zc - v * T * beta)
    a_on, p_on = stance_foot(g, 0., zc)
    g_off = a_off[2] + v * T * beta
    g_on = a_on[2] + S
    z = g_off + (g_on - g_off) * smoother(q) - v * T * ph
    y = a_off[1] + (a_on[1] - a_off[1]) * smooth(q) + g['lift'] * math.sin(PI * min(1., q ** .8)) ** 1.1
    # 足の向き：蹴り出しの角度 → 半ばまでに平ら → 着地の前に踵の着地の角度
    if q < .45:
        p = p_off * (1 - smooth(q / .45))
    else:
        p = p_on * smooth((q - .45) / .55)
    # 足の裏のいちばん低い点が地面をこすらない（離れる・着く瞬間の 0 から、半ばで 1.2 cm 以上）
    low = y + min(rx_apply(p, v)[1] for v in SOLE)
    want = .012 * math.sin(PI * q) ** .5
    if low < want:
        y += want - low
    return np.array([0., y, z]), p, False


# ---------------- 骨盤 ----------------
def bob(g, ph):
    """走りの腰の上下（最も低い所が 0）：片足で着いた真ん中で最も低く、両足が浮いた真ん中で最も高い（なめらかな波）"""
    low = g['duty'] / 2
    return g['bob'] * .5 * (1 - math.cos(4 * PI * (ph - low)))


def hips_y(g, ph, y0):
    """腰の高さ。歩きは脚が届く高さから作った形（HIPS_CURVE）、走りは y0 + 波"""
    curve = g.get('curve')
    if curve is not None:
        n = len(curve)
        x = (ph % 1.) * n
        i = int(math.floor(x))
        f = x - i
        return float(curve[i % n] * (1 - f) + curve[(i + 1) % n] * f)
    return y0 + bob(g, ph)


def pelvis(g, ph, y0):
    """全体の位相 ph（0 = 左の踵が着いた瞬間）の腰の位置・骨盤の回転"""
    beta = g['duty']
    y = hips_y(g, ph, y0)
    # 体重が乗る足（片足で立つ真ん中：左 β/2、右 0.5+β/2）へ骨盤が寄る
    mid = beta / 2
    x = g['sway'] * math.cos(2 * PI * (ph - mid))
    # 前へ出た足の側の腰が前へ（左の踵が着く位相 0 で左が前：Ry の負）
    yaw = -g['yaw'] * math.cos(2 * PI * ph)
    # 体重が乗る足の側の腰が少し上がる（振り出す側が下がる）
    roll = g['roll'] * math.cos(2 * PI * (ph - mid))
    return np.array([x, y, 0.]), ry(yaw) * rz(roll), yaw, roll


def hip_joint(pos, rot, s):
    return pos + rot.apply(np.array([s * HIP_X, 0., 0.]))


def hip_offset(yaw, roll, s):
    """Ry(yaw)·Rz(roll)·(s·HIP_X, 0, 0)（hip_joint の回転の部分を速く）"""
    x = s * HIP_X
    return np.array([x * math.cos(roll) * math.cos(yaw), x * math.sin(roll), -x * math.cos(roll) * math.sin(yaw)])


def reach_limit(ankle, hj_offset):
    """腰の位置の高さの上限（足首に脚が届き、余りが残る）。hj_offset：腰の位置 → 腰の関節（骨盤の回転後）"""
    dx = ankle[0] - hj_offset[0]
    dz = ankle[2] - hj_offset[2]
    h2 = dx * dx + dz * dz
    if h2 >= FIT_REACH * FIT_REACH:
        return -1.
    return ankle[1] - hj_offset[1] + math.sqrt(FIT_REACH * FIT_REACH - h2)


def feet_at(g, ph, zc):
    out = []
    for s, off in ((1, 0.), (-1, .5)):
        a, p, st = leg_target(g, ph + off, zc)
        a = a + np.array([s * g['foot_x'], 0, 0])
        out.append((a, p, st))
    return out


def pelvis_offsets(g, ph, flat=False):
    """腰の高さの基準を 0 としたときの、腰の位置と左右の腰の関節（pelvis() と同じ式。回転を使わずに速く）。flat：上下を入れない"""
    beta = g['duty']
    mid = beta / 2
    pos = np.array([g['sway'] * math.cos(2 * PI * (ph - mid)), 0. if flat else bob(g, ph), 0.])
    yaw = -g['yaw'] * math.cos(2 * PI * ph)
    roll = g['roll'] * math.cos(2 * PI * (ph - mid))
    return [pos + hip_offset(yaw, roll, s) for s in (1, -1)]


def max_y0(g, zc, n):
    y0 = 9.
    for ph in np.linspace(0, 1, n, endpoint=False):
        feet = feet_at(g, ph, zc)
        for (a, _, _), off in zip(feet, pelvis_offsets(g, ph)):
            y0 = min(y0, reach_limit(a, off))
    return y0


def fit_hips(g, n=240):
    """着地の位置（zc：踵が着く瞬間の踵の前後の位置）と腰の高さ（y0）を、両脚が届く範囲で最も高くなるように決める（粗く探してから細かく）"""
    zs = np.linspace(.05, .45, 21)
    ys = [max_y0(g, z, n) for z in zs]
    i = int(np.argmax(ys))
    best = (float(zs[i]), ys[i])
    for z in np.linspace(zs[max(0, i - 1)], zs[min(len(zs) - 1, i + 1)], 21):
        y = max_y0(g, float(z), n)
        if y > best[1]:
            best = (float(z), y)
    return best


def reach_curve(g, zc, n):
    """両脚が届く腰の高さの上限（位相ごと。骨盤の上下を入れない）"""
    out = np.empty(n)
    for i, ph in enumerate(np.linspace(0, 1, n, endpoint=False)):
        feet = feet_at(g, ph, zc)
        out[i] = min(reach_limit(a, off) for (a, _, _), off in zip(feet, pelvis_offsets(g, ph, flat=True)))
    return out


def shaped_hips(g, zc, n=240):
    """歩きの腰の高さの形：両脚が届く上限（左右で同じ形）から少し下げ、片足で立つ間は cap（膝を約 15° 曲げた高さ）で頭打ちにし、
    2 歩の周期の低い倍音だけ残してなめらかにする。どの位相でも上限を超えない（超える分だけ全体を下げる）"""
    f = reach_curve(g, zc, n)
    f = np.minimum(f, np.roll(f, n // 2))
    target = np.minimum(f - g['margin'], g['cap'])
    F = np.fft.rfft(target)
    keep = np.zeros_like(F)
    for k in range(len(F)):
        if k == 0 or (k % 2 == 0 and k <= 2 * g['harmonics']):
            keep[k] = F[k]
    sm = np.fft.irfft(keep, n)
    over = float(np.max(sm - (f - .5 * g['margin'])))
    if over > 0:
        sm -= over
    return sm


def fit_curve(g, n=240):
    """着地の位置 zc を、腰の高さの平均が最も高くなるように決める"""
    best = None
    for zc in np.linspace(.12, .40, 15):
        c = shaped_hips(g, float(zc), n)
        if best is None or c.mean() > best[1].mean():
            best = (float(zc), c)
    zs = best[0]
    for zc in np.linspace(zs - .02, zs + .02, 9):
        c = shaped_hips(g, float(zc), n)
        if c.mean() > best[1].mean():
            best = (float(zc), c)
    return best


FIT = {}
for _k, _g in GAITS.items():
    if _g.get('hips') == 'reach':
        _zc, _curve = fit_curve(_g)
        _g['curve'] = _curve
        FIT[_k] = (_zc, float(_curve.min()))
    else:
        FIT[_k] = fit_hips(_g)


# ---------------- 脚の IK ----------------
def frame(yv, pole):
    y = yv / np.linalg.norm(yv)
    z = pole - (pole @ y) * y
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], axis=1)


REST_THIGH_F = frame(THIGH, np.array([0., 0., 1.]))
REST_SHIN_F = frame(SHIN, np.array([0., 0., 1.]))


def solve_leg(hip, ankle, pole):
    """腰の関節 hip から足首 ankle へ。膝は pole（前）の向きへ曲がる。返り：(太ももの世界の回転, すねの世界の回転, 届かなかった長さ)"""
    d = ankle - hip
    dist = float(np.linalg.norm(d))
    short = max(0., dist - REACH)
    dist = min(dist, REACH)
    dn = d / (np.linalg.norm(d) + 1e-12)
    along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
    height = math.sqrt(max(0., L1 * L1 - along * along))
    perp = pole - (pole @ dn) * dn
    perp /= np.linalg.norm(perp)
    knee = hip + along * dn + height * perp
    foot = hip + dist * dn
    ru = Rotation.from_matrix(frame(knee - hip, pole) @ REST_THIGH_F.T)
    rl = Rotation.from_matrix(frame(foot - knee, pole) @ REST_SHIN_F.T)
    return ru, rl, short


# ---------------- 1 コマの姿勢 ----------------
def ident():
    return Rotation.identity()


def frame_pose(kind, t):
    """動き kind（'Idle' / 'Walk' / 'Run'）の時刻 t（秒）の姿勢。返り：(骨ごとの局所の回転（四元数 xyzw）, {'Hips': 腰の局所の位置})"""
    R = {b: ident() for b in BONE_NAMES}
    if kind == 'Idle':
        hips, lr, feet, upper = idle_pose(t)
    else:
        hips, lr, feet, upper = gait_pose(kind, t)
    pos, rot = hips
    R['Hips'] = rot
    world = {'Hips': rot}
    for (side, s), (a, pitch, fyaw) in zip((('Left', 1), ('Right', -1)), feet):
        hj = hip_joint(pos, rot, s)
        pole = ry(fyaw).apply(np.array([0., 0., 1.]))
        # 膝は足先の向きと骨盤の向きの間へ
        pole = pole + rot.apply(np.array([0., 0., 1.]))
        pole[1] = 0.
        ru, rl, _ = solve_leg(hj, a, pole)
        rf = ry(fyaw) * rx(pitch)
        R[side + 'UpperLeg'] = rot.inv() * ru
        R[side + 'LowerLeg'] = ru.inv() * rl
        R[side + 'Foot'] = rl.inv() * rf
    for name, r in upper.items():
        R[name] = r
    qs = {b: R[b].as_quat() for b in BONE_NAMES}
    return qs, {'Hips': pos.copy()}


def upper_body(yaw, roll, lean, arm_phase_l, g, breathe=0.):
    """上体と腕：骨盤の回りを背骨で打ち消し、胸は逆へ少し回す。頭はほぼ正面のまま"""
    U = {}
    U['Spine'] = ry(-.75 * yaw) * rz(-.8 * roll) * rx(lean)
    U['Chest'] = ry(-.75 * yaw) * rx(-breathe)
    # 胸の世界の向き：yaw·(1 − 0.75 − 0.75) = −0.5·yaw。首と頭で 0 へ戻す
    U['Neck'] = ry(.25 * yaw) * rx(-.4 * lean)
    U['Head'] = ry(.25 * yaw) * rz(.2 * roll) * rx(-.3 * lean)
    for side, s, off in (('Left', 1, 0.), ('Right', -1, .5)):
        a = 2 * PI * (arm_phase_l + off)
        U[side + 'UpperArm'] = Rotation.from_euler('xz', [g['arm'] * math.cos(a), s * (.025 if g is GAITS['Run'] else .012)])
        e0, e1 = g['elbow']
        U[side + 'ForeArm'] = rx(e0 + e1 * (1 + math.sin(a)))
        U[side + 'Hand'] = ry(-.1 * s) if g is GAITS['Run'] else ident()
    return U


def gait_pose(kind, t):
    g = GAITS[kind]
    zc, y0 = FIT[kind]
    ph = (t / g['cycle']) % 1.
    pos, rot, yaw, roll = pelvis(g, ph, y0)
    feet = []
    for (a, p, _), s in zip(feet_at(g, ph, zc), (1, -1)):
        feet.append((a, p, s * g['toe_out']))
    upper = upper_body(yaw, roll, g['lean'], ph, g)
    return (pos, rot), None, feet, upper


# 待機：腰の高さは歩きの平均より 2 cm 高いだけ（歩き出し・止まりで腰が沈む・浮くのを 2 cm 以内に。Version 27 は 6〜8 cm）。膝は少しゆるめる
IDLE_FEET = ((np.array([.102, ANKLE_Y, .030]), .10), (np.array([-.100, ANKLE_Y, -.008]), -.10))


def walk_mean_hips(n=240):
    g = GAITS['Walk']
    zc, y0 = FIT['Walk']
    return float(np.mean([pelvis(g, ph, y0)[0][1] for ph in np.linspace(0, 1, n, endpoint=False)]))


IDLE_HIPS = min(walk_mean_hips() + .02, .938)


def idle_pose(t):
    w = 2 * PI * t / IDLE_CYCLE
    b = 2 * PI * t / (IDLE_CYCLE / 2)
    sway = .011 * math.sin(w)
    roll = .018 * math.sin(w)
    y = IDLE_HIPS + .002 * math.sin(b) - .002 * abs(math.sin(w))
    pos = np.array([sway, y, .006 * math.sin(w + .7)])
    rot = rz(roll) * ry(.02 * math.sin(w + 1.1))
    feet = [(a.copy(), 0., fy) for a, fy in IDLE_FEET]
    g = dict(arm=0., elbow=(-.06, 0.))
    U = {}
    U['Spine'] = rz(-.9 * roll) * rx(.010 * math.sin(b)) * ry(-.02 * math.sin(w + 1.1))
    U['Chest'] = rx(-.012 * math.sin(b)) * rz(-.15 * roll)
    U['Neck'] = ry(.03 * math.sin(.5 * w + .4))
    U['Head'] = ry(.02 * math.sin(w + 2.)) * rx(.012 * math.sin(.5 * w + 1.3)) * rz(.1 * roll)
    for side, s in (('Left', 1), ('Right', -1)):
        U[side + 'UpperArm'] = Rotation.from_euler('xz', [.03 + .01 * math.sin(b + s), .012 * s * math.sin(b) + .02 * s * math.sin(w)])
        U[side + 'ForeArm'] = rx(-.06 - .015 * math.sin(b))
    return (pos, rot), None, feet, U


# ---------------- 書き出す動き ----------------
CLIP_SPECS = [('Idle', IDLE_CYCLE), ('Walk', GAITS['Walk']['cycle']), ('Run', GAITS['Run']['cycle'])]


def build_clips(fps=CLIP_FPS):
    """[{name, times, rots{骨: [四元数]}, trans[腰の位置]}]。最後のコマは最初のコマと同じ（ループ）。待機はゆっくりなので半分のコマで"""
    clips = []
    for name, dur in CLIP_SPECS:
        count = int(round(dur * (fps / 2 if name == 'Idle' else fps))) + 1
        times = np.linspace(0, dur, count, dtype=np.float32)
        rots = {b: [] for b in BONE_NAMES}
        trans = []
        for i, t in enumerate(times):
            q, tr = frame_pose(name, float(t) if i < count - 1 else 0.)
            for bn in rots:
                rots[bn].append(q[bn])
            trans.append(tr['Hips'])
        clips.append(dict(name=name, times=times, rots=rots, trans=np.array(trans, np.float32)))
    return clips


def info():
    """ゲーム側（proto3d/src/game/gait.ts）と合わせる値"""
    out = {}
    for k, g in GAITS.items():
        out[k] = dict(cycle=g['cycle'], speed=g['speed'], stride=round(g['speed'] * g['cycle'], 4), duty=g['duty'], touchdown_heel_z=round(FIT[k][0], 4), hips_y0=round(FIT[k][1], 4))
    out['Idle'] = dict(cycle=IDLE_CYCLE, hips=round(IDLE_HIPS, 4))
    return out


if __name__ == '__main__':
    import json
    print(json.dumps(info(), indent=1))
