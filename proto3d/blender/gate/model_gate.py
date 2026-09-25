"""
城門（高麗門）：scene.json の gate どおり。Blender の座標で組む（門の中心は X 0・Y 12、南（町）は -Y）。

鏡柱（深い干割れと摩耗した面取りのある太い角柱、はつり仕上げの根巻石、鉄の根巻）、冠木（両端は木鼻の彫り）、
柱の頭の舟肘木とその上の桁（二本目のつなぎ梁）、腕木（木鼻）・出桁・母屋・棟木・蟇股、
二軒の軒（地垂木＋木負、飛檐垂木＋茅負＋裏甲、垂木の木口は 1 本ずつ）、反りのある切妻の本瓦屋根、破風と妻板・懸魚、
内側へ開いた 2 枚の門扉（縦板・裏桟・鉄の帯と鋲・大きな肘壺金物）、控柱と小屋根、敷石。
"""
from __future__ import annotations

import math

import numpy as np

from gkit import (EX, EY, EZ, SCENE, V, Geo, Profile, RoofFrame, abox, beam, chamfer_box, cylinder, extrude_outline,
                  hongawara, kibana_profile, obox, rafter, ridge, stud, sweep_rect, torus)

GS = SCENE['gate']
GY = -GS['center'][1]            # 門の中心の Blender Y（12）
PX = GS['pillar_x']              # 鏡柱の中心の |X|
PW, PD = GS['pillar_size_xz']    # 鏡柱の幅（X）・奥行き（Y）
PTOP = GS['pillar_top_y']
KB0, KB1 = GS['kabuki_y']
KXH = GS['kabuki_x_half']
ROOF = GS['roof']
DOOR = GS['doors']
CP = GS['control_pillars']

FOOT_TOP = 0.45                  # 根巻石（切石）の上面
FOOT_X0 = 2.02                   # 根巻石の通り道の側の面（|X|）：通れる幅 -2.0〜2.0 と当たり判定を保つ
FOOT_X1 = 2.86
FOOT_Y0, FOOT_Y1 = -0.60, 0.33   # 根巻石の南北（門の中心から。北は扉の吊り元に当たらないよう短く）
CFOOT_TOP = 0.3                  # 控柱の礎石の上面
KB_D = 0.5                       # 冠木の奥行き
HINGE_Y = GY + PD / 2 + 0.06     # 扉の吊り元（鏡柱の北の面のすぐ裏）
HINGE_X = 2.02

# 冠木より上の組物の高さ（柱の頭 5.4 → 舟肘木 → 桁と腕木 → 出桁）
ARM0, ARM1 = PTOP, PTOP + 0.16   # 舟肘木（東西）
TIE0, TIE1 = ARM1, ARM1 + 0.30   # 桁（二本目のつなぎ梁、東西）
HARI0, HARI1 = TIE0, TIE0 + 0.24  # 腕木（南北）：桁と相欠きで交わる
HARI_X = (PX, 0.85)              # 腕木の |X|
XD = 1.15                        # 出桁（棟からの水平距離）
DASHI1 = HARI1 + 0.06            # 出桁の上端（腕木に 12 cm 落とし込む）
DASHI_H = 0.18
XM = 0.6                         # 母屋
XE2 = ROOF['x_half'] - 0.06      # 東西に通す材の端（破風の内側）

# 二軒の軒（地垂木・木負・飛檐垂木・茅負・裏甲）。高さは鉛直の寸法、勾配は水平 1 m あたり
RB_W, RB_H, SB = 0.09, 0.11, 0.8     # 地垂木
RF_W, RF_H, SF = 0.08, 0.10, 0.4     # 飛檐垂木
XB = 1.52                            # 地垂木の先
XT = ROOF['z_half'] - 0.03           # 飛檐垂木の先（茅負の前）
XF0 = 1.30                           # 飛檐垂木の尻
KIOI_H, KAYA_H, URA_H = 0.075, 0.12, 0.06
RAF_SP = 0.24
EAVE_DROP = 0.08                     # 軒瓦の垂れ（前の面の深さ）
RIDGE_DECK = 7.0                     # 棟での瓦の下地の高さ
DECK_T = 0.03


def base_bot(x):
    """地垂木の下端（棟からの水平距離 x）"""
    return DASHI1 + (XD - x) * SB


def base_top(x):
    return base_bot(x) + RB_H * math.hypot(1, SB)


def fly_bot(x):
    return base_top(XB) + KIOI_H + (XB - x) * SF


def fly_top(x):
    return fly_bot(x) + RF_H * math.hypot(1, SF)


KAYA_TOP = fly_top(XT) + KAYA_H
URA_TOP = KAYA_TOP + URA_H
Z_TIP = URA_TOP + EAVE_DROP - 0.004          # 瓦の下地の軒先の高さ（軒瓦の垂れの下端が裏甲の上に来る）
_S2 = 2 * (RIDGE_DECK - Z_TIP) / XT
PROF = Profile.curve(RIDGE_DECK, 0.7 * _S2, 0.3 * _S2, XT)
EAVE_BOTTOM = fly_bot(XT)                    # 軒の一番下（飛檐垂木の先の下端）


def deck_z(x):
    return PROF.z_at_x(x)


def _check_clearance():
    """瓦の下地が垂木より上にあることを確かめる（反りの曲線と直線の垂木）"""
    worst = 9.0
    for x in np.linspace(0.0, XT, 60):
        d = deck_z(x) - DECK_T - base_top(x)
        if x > XF0:
            d = min(d, deck_z(x) - DECK_T - fly_top(x))
        worst = min(worst, d)
    assert worst > 0.0, worst
    return worst


def pillar(g, key, cx, cy, w, d, z0, z1, rng, *, ch=0.014, nchk=(3, 0, 2, 4), dz=0.6, top_cap=True):
    """
    太い角柱。面（南・東・北・西の順）ごとに別の格子を作り、干割れのところだけ縦・横に細かく割る。面どうしは面取りの帯で
    n 角形としてつなぐ（T 字の継ぎ目を作らない）。干割れ：深さ 25〜40 mm、幅 8〜15 mm、長さ 1〜3 m、両端は浅く。
    nchk は面ごとの割れの数（見えない面は 0）。面取り ch は摩耗した角（12〜15 mm）
    """
    hx, hy = w / 2, d / 2
    panels = [((-hx + ch, -hy), (hx - ch, -hy), V((0, -1, 0))),
              ((hx, -hy + ch), (hx, hy - ch), V((1, 0, 0))),
              ((hx - ch, hy), (-hx + ch, hy), V((0, 1, 0))),
              ((-hx, hy - ch), (-hx, -hy + ch), V((-1, 0, 0)))]
    base_rows = list(np.linspace(z0, z1, max(2, int(math.ceil((z1 - z0) / dz)) + 1)))
    info = []
    for pi, (a, b, n) in enumerate(panels):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        cracks = []
        tries = 0
        while len(cracks) < nchk[pi] and tries < 60:
            tries += 1
            t = rng.uniform(0.12, 0.88) * L
            if any(abs(t - c[0]) < 0.09 for c in cracks):
                continue
            ln = rng.uniform(1.0, 3.0)
            za = rng.uniform(z0 + 0.2, max(z0 + 0.25, z1 - ln - 0.2))
            zb = min(za + ln, z1 - 0.15)
            cracks.append((t, rng.uniform(0.004, 0.0075), za, zb, rng.uniform(0.025, 0.04)))
        cracks.sort()
        rows = set(round(z, 4) for z in base_rows)
        for (t, hw, za, zb, dep) in cracks:
            for f in (0.0, 0.12, 0.5, 0.88, 1.0):
                rows.add(round(za + (zb - za) * f, 4))
        cols = [(0.0, None)]
        for ci, (t, hw, za, zb, dep) in enumerate(cracks):
            cols += [(t - hw, None), (t, ci), (t + hw, None)]
        cols.append((L, None))
        info.append(dict(a=a, b=b, n=n, L=L, cracks=cracks, rows=sorted(rows), cols=cols))
    np_ = len(panels)
    vidx = {}
    verts = []

    def vert(key2, x, y, z, off=V((0, 0, 0))):
        k = (key2, round(z, 4))
        if k not in vidx:
            vidx[k] = len(verts)
            verts.append(V((cx + x, cy + y, z)) + off)
        return vidx[k]
    faces, want = [], []
    for pi, P in enumerate(info):
        prev_rows = info[(pi - 1) % np_]['rows']
        next_rows = info[(pi + 1) % np_]['rows']
        a, b, n, L = P['a'], P['b'], P['n'], P['L']
        ncol = len(P['cols'])

        def col_rows(j):
            if j == 0:
                return sorted(set(P['rows']) | set(prev_rows))
            if j == ncol - 1:
                return sorted(set(P['rows']) | set(next_rows))
            return P['rows']

        def cv(j, z):
            u, ci = P['cols'][j]
            x = a[0] + (b[0] - a[0]) * u / L
            y = a[1] + (b[1] - a[1]) * u / L
            off = V((0, 0, 0))
            if ci is not None:
                t, hw, za, zb, dep = P['cracks'][ci]
                if za < z < zb:
                    off = -n * dep * math.sin(math.pi * (z - za) / (zb - za)) ** 0.5
            key2 = ('s', pi) if j == 0 else (('e', pi) if j == ncol - 1 else ('p', pi, j))
            return vert(key2, x, y, z, off)
        R = P['rows']
        for j in range(ncol - 1):
            RA, RB = col_rows(j), col_rows(j + 1)
            for k in range(len(R) - 1):
                r0, r1 = R[k], R[k + 1]
                poly = [cv(j, r0)] + [cv(j, z) for z in RA if r0 < z < r1] + [cv(j, r1), cv(j + 1, r1)] +                        [cv(j + 1, z) for z in reversed(RB) if r0 < z < r1] + [cv(j + 1, r0)]
                faces.append(tuple(poly))
                want.append(n)
    # 面取りの帯（面 i の終わり → 面 i+1 の始まり）
    for pi in range(np_):
        qi = (pi + 1) % np_
        rows = sorted(set(info[pi]['rows']) | set(info[qi]['rows']))
        bi, aq = info[pi]['b'], info[qi]['a']
        nrm = (info[pi]['n'] + info[qi]['n']).normalized()
        for k in range(len(rows) - 1):
            r0, r1 = rows[k], rows[k + 1]
            faces.append((vert(('e', pi), bi[0], bi[1], r0), vert(('s', qi), aq[0], aq[1], r0),
                          vert(('s', qi), aq[0], aq[1], r1), vert(('e', pi), bi[0], bi[1], r1)))
            want.append(nrm)
    if top_cap:
        ring = []
        for pi, P in enumerate(info):
            ncol = len(P['cols'])
            for j in range(ncol):
                key2 = ('s', pi) if j == 0 else (('e', pi) if j == ncol - 1 else ('p', pi, j))
                ring.append(vidx[(key2, round(z1, 4))])
        faces.append(tuple(ring))
        want.append(EZ)
    g.oriented(key, verts, faces, want)


def subdiv_outline(pts, max_len=0.4):
    """輪郭の長い辺に点を足す（大きな面にも頂点を置いて、頂点ごとの AO を細かく）"""
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        out.append(a)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        k = int(L / max_len)
        for j in range(1, k + 1):
            t = j / (k + 1)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def build_gate(seed=11):
    g = Geo()
    rng = np.random.default_rng(seed)
    W = 'wood_timber#frame'        # 骨組み（粗い年輪の古材を頂点色で暖かい焦げ茶に）
    WS = 'wood_timber#soffit'      # 化粧裏板（軒の裏の板）
    WE = 'wood_timber#end'         # 垂木の木口（少し明るく：1 本ずつ読めるように）
    WD = 'wood_timber#door'        # 扉の縦板（柱より 1 割暗く）
    FE = 'iron_black'
    ST = 'stone_granite'
    TL = 'tile_ibushi'
    TD = 'tile_ibushi#disc'        # 軒瓦の瓦当（暗く・ざらつかせる）
    clear = _check_clearance()

    # ---- 鏡柱：根巻石（はつり仕上げの切石）・柱・鉄の根巻 ----
    for s in (-1, 1):
        x = s * PX
        fx = s * (FOOT_X0 + FOOT_X1) / 2
        chamfer_box(g, ST, (fx, GY + (FOOT_Y0 + FOOT_Y1) / 2, (FOOT_TOP - 0.12) / 2), EX, EY, EZ,
                    (FOOT_X1 - FOOT_X0) / 2, (FOOT_Y1 - FOOT_Y0) / 2, (FOOT_TOP + 0.12) / 2, b=0.02, step=0.28, jitter=0.0025,
                    rng=np.random.default_rng(seed + 3 + s))
        # 通り道の側の面（西の柱は東の面、東の柱は西の面）に多く、壁に接する外の面は無し
        nchk = (3, 0, 2, 4) if s > 0 else (3, 4, 2, 0)
        pillar(g, W, x, GY, PW, PD, FOOT_TOP, PTOP, rng, ch=0.014, nchk=nchk)
        # 根巻（鉄の覆い 0.35 m）と上の縁・鋲
        nb = 0.35
        obox(g, FE, V((x, GY, FOOT_TOP + nb / 2)), EZ, EX, EY, nb / 2, PW / 2 + 0.012, PD / 2 + 0.012, ch=0.02)
        obox(g, FE, V((x, GY, FOOT_TOP + nb - 0.012)), EZ, EX, EY, 0.016, PW / 2 + 0.02, PD / 2 + 0.02, ch=0.024)
        for (n, u_ax, half) in ((V((0, -1, 0)), EX, PW / 2), (V((0, 1, 0)), EX, PW / 2), (V((-1, 0, 0)), EY, PD / 2), (V((1, 0, 0)), EY, PD / 2)):
            if n.x * s > 0.5:
                continue       # 壁に接する面
            base = V((x, GY, 0)) + n * ((PD / 2 if abs(n.y) > 0 else PW / 2) + 0.012)
            for zz in (FOOT_TOP + 0.08, FOOT_TOP + 0.25):
                for t in np.linspace(-half + 0.08, half - 0.08, 3):
                    stud(g, FE, base + u_ax * t + EZ * zz, n, r=0.02, h=0.014)

    # ---- 冠木（両端は木鼻）と扉の上の鴨居 ----
    prof = subdiv_outline(kibana_profile(-KXH, KXH, KB0, KB1, depth=0.42), 0.45)
    extrude_outline(g, W, prof, V((0, GY - KB_D / 2, 0)), EX, EZ, EY, KB_D)
    abox(g, W, -PX + PW / 2 - 0.02, PX - PW / 2 + 0.02, GY + PD / 2 - 0.02, GY + PD / 2 + 0.22, DOOR['leaf_height'] + 0.1, KB0, ch=0.015,
         seg_len=0.5)

    # ---- 柱の頭：舟肘木（東西、下の面が舟形に反り上がる）→ 桁（二本目のつなぎ梁、両端は木鼻）----
    for s in (-1, 1):
        x = s * PX
        hl = 0.75
        boat = [(-hl, ARM1), (-hl, ARM1 - 0.055), (-hl + 0.1, ARM1 - 0.075), (-hl + 0.24, ARM0 + 0.035), (-0.3, ARM0), (0.3, ARM0),
                (hl - 0.24, ARM0 + 0.035), (hl - 0.1, ARM1 - 0.075), (hl, ARM1 - 0.055), (hl, ARM1)]
        extrude_outline(g, W, [(x + u, z) for (u, z) in reversed(boat)], V((0, GY - 0.15, 0)), EX, EZ, EY, 0.3)
    tie_x = PX + 0.9
    prof = subdiv_outline(kibana_profile(-tie_x, tie_x, TIE0, TIE1, depth=0.36), 0.45)
    extrude_outline(g, W, prof, V((0, GY - 0.16, 0)), EX, EZ, EY, 0.32)

    # ---- 腕木（南北、両端は木鼻）→ 出桁・母屋・棟木（東西）と束・蟇股 ----
    ya, yb = GY - (XD + 0.3), GY + (XD + 0.3)
    for s in (-1, 1):
        for hx in HARI_X:
            x = s * hx
            w_h = 0.24 if hx == PX else 0.2
            prof = subdiv_outline(kibana_profile(ya, yb, HARI0, HARI1, depth=0.3), 0.45)
            extrude_outline(g, W, prof, V((x - w_h / 2, 0, 0)), EY, EZ, EX, w_h)
            # 母屋を受ける束
            mb = base_bot(XM) - 0.16
            for yy in (-XM, XM):
                obox(g, W, V((x, GY + yy, (HARI1 + mb) / 2)), EZ, EX, EY, (mb - HARI1) / 2, 0.07, 0.07, ch=0.01)
    rb = base_bot(0.0) - 0.26
    for yy, top, w, h in ((-XD, DASHI1, 0.18, DASHI_H), (XD, DASHI1, 0.18, DASHI_H), (-XM, base_bot(XM), 0.16, 0.16), (XM, base_bot(XM), 0.16, 0.16),
                          (0.0, base_bot(0.0), 0.2, 0.26)):
        obox(g, W, V((0, GY + yy, top - h / 2)), EX, EY, EZ, XE2, w / 2, h / 2, ch=0.014, seg=11)
    # 棟木を受ける束（柱の上）
    for s in (-1, 1):
        obox(g, W, V((s * PX, GY, (TIE1 + rb) / 2)), EZ, EX, EY, (rb - TIE1) / 2, 0.08, 0.08, ch=0.012)
    # 中央の蟇股（桁の上）と斗・束 → 棟木
    kh = 0.46
    frog = [(-0.44, 0.0), (-0.3, 0.0), (-0.22, 0.12), (-0.12, 0.28), (-0.06, 0.36), (0.06, 0.36), (0.12, 0.28), (0.22, 0.12), (0.3, 0.0),
            (0.44, 0.0), (0.35, 0.18), (0.22, 0.36), (0.12, 0.46), (-0.12, 0.46), (-0.22, 0.36), (-0.35, 0.18)]
    extrude_outline(g, W, [(u, z * kh / 0.46) for (u, z) in frog], V((0, GY - 0.07, TIE1 + 0.03)), EX, EZ, EY, 0.14)
    abox(g, W, -0.5, 0.5, GY - 0.12, GY + 0.12, TIE1, TIE1 + 0.035, ch=0.008)
    abox(g, W, -0.13, 0.13, GY - 0.13, GY + 0.13, TIE1 + 0.03 + kh, TIE1 + 0.03 + kh + 0.11, ch=0.012)
    z_to = TIE1 + 0.03 + kh + 0.11
    if rb > z_to + 0.02:
        obox(g, W, V((0, GY, (z_to + rb) / 2)), EZ, EX, EY, (rb - z_to) / 2, 0.08, 0.08, ch=0.012)

    # ---- 二軒の軒：地垂木・化粧裏板・木負、飛檐垂木・裏板・茅負・裏甲 ----
    nraf = int(round(2 * (XE2 - 0.1) / RAF_SP)) + 1
    xs_raf = np.linspace(-(XE2 - 0.1), XE2 - 0.1, nraf)
    kb = math.hypot(1, SB)
    kf = math.hypot(1, SF)
    for dirn in (-1, 1):
        def Y(xr):
            return GY + dirn * xr

        def up_of(slope):
            return V((0, dirn * slope, 1.0)).normalized()
        for xr in xs_raf:
            # 地垂木（中心線 = 下端 + 鉛直の厚みの半分）
            p0 = V((xr, Y(0.02), base_bot(0.02) + RB_H * kb / 2))
            p1 = V((xr, Y(XB), base_bot(XB) + RB_H * kb / 2))
            rafter(g, W, WE, p0, p1, up_of(SB), RB_W, RB_H, seg_len=0.4)
            p0 = V((xr, Y(XF0), fly_bot(XF0) + RF_H * kf / 2))
            p1 = V((xr, Y(XT), fly_bot(XT) + RF_H * kf / 2))
            rafter(g, W, WE, p0, p1, up_of(SF), RF_W, RF_H, seg_len=0.4)
        # 化粧裏板（地垂木の上、軒と平行の板）
        edges = np.linspace(0.0, XB + 0.005, 7)
        for i in range(len(edges) - 1):
            xa, xb2 = edges[i], edges[i + 1]
            pa = V((0, Y(xa), base_top(xa) + 0.011 * kb))
            pb = V((0, Y(xb2), base_top(xb2) + 0.011 * kb))
            t = (pb - pa)
            c = (pa + pb) / 2
            obox(g, WS, c, EX, t, t.cross(EX) * (-dirn), XE2, t.length / 2 - 0.003, 0.011, seg=11)
        # 飛檐垂木の上の裏板
        xa, xb2 = XB - 0.06, XT - 0.12
        pa = V((0, Y(xa), fly_top(xa) + 0.011 * kf))
        pb = V((0, Y(xb2), fly_top(xb2) + 0.011 * kf))
        t = pb - pa
        obox(g, WS, (pa + pb) / 2, EX, t, t.cross(EX) * (-dirn), XE2, t.length / 2, 0.011, seg=11)
        # 木負（地垂木の先の上、断面は平行四辺形）
        prof = [(Y(XB + 0.012), base_top(XB) - 0.012), (Y(XB + 0.012), fly_bot(XB) + 0.004),
                (Y(XB - 0.1), fly_bot(XB - 0.1) + 0.004), (Y(XB - 0.1), base_top(XB - 0.1) - 0.012)]
        extrude_outline(g, W, prof, V((-XE2, 0, 0)), EY, EZ, EX, 2 * XE2)
        # 茅負（飛檐垂木の先の上）と裏甲（その上の板、少し前へ出る）
        prof = [(Y(XT + 0.012), fly_top(XT) - 0.012), (Y(XT + 0.012), KAYA_TOP), (Y(XT - 0.13), KAYA_TOP + 0.13 * 0.25),
                (Y(XT - 0.13), fly_top(XT - 0.13) - 0.01)]
        extrude_outline(g, W, prof, V((-XE2, 0, 0)), EY, EZ, EX, 2 * XE2)
        prof = [(Y(XT + 0.035), KAYA_TOP), (Y(XT + 0.035), URA_TOP), (Y(XT - 0.17), URA_TOP + 0.17 * 0.3), (Y(XT - 0.17), KAYA_TOP + 0.17 * 0.25)]
        extrude_outline(g, W, prof, V((-XE2 - 0.01, 0, 0)), EY, EZ, EX, 2 * XE2 + 0.02)

    # ---- 破風と妻板・懸魚 ----
    for sx in (-1, 1):
        xh = sx * (XE2 + 0.045)
        for dirn in (-1, 1):
            F = RoofFrame((xh, GY), EX, V((0, dirn, 0)), PROF)
            pts, ups = [], []
            for xx in np.linspace(0.0, XT + 0.05, 8):
                s_ = PROF.s_at_x(xx)
                pts.append(F.pt(0.0, s_, -0.15))
                ups.append(F.normal(s_))
            sweep_rect(g, W, pts, ups, 0.08, 0.3, caps=(True, True), ch=0.01)
        # 妻板：瓦の下地と軒裏の線のあいだを塞ぐ（横から見て隙間が抜けないように）
        top = [(GY + d * xx, deck_z(xx) - DECK_T) for d in (-1,) for xx in np.linspace(XT, 0.0, 10)] + \
              [(GY + xx, deck_z(xx) - DECK_T) for xx in np.linspace(0.0, XT, 10)[1:]]
        bot = [(GY + XT, fly_top(XT)), (GY + XB, fly_top(XB)), (GY + XB, base_top(XB)), (GY, base_top(0.0)),
               (GY - XB, base_top(XB)), (GY - XB, fly_top(XB)), (GY - XT, fly_top(XT))]
        outline = top + bot
        extrude_outline(g, W, outline, V((sx * XE2, 0, 0)), EY, EZ, V((sx, 0, 0)), 0.03)
        # 懸魚（棟の下に下がる飾り）
        gegyo = [(-0.2, 0.0), (0.2, 0.0), (0.22, -0.13), (0.15, -0.28), (0.0, -0.44), (-0.15, -0.28), (-0.22, -0.13)]
        xg = sx * (XE2 + 0.09)
        extrude_outline(g, W, gegyo, V((xg, GY, RIDGE_DECK - 0.2)), EY, EZ, V((sx, 0, 0)), 0.05)
        for yy, zz in ((-0.1, -0.14), (0.1, -0.14), (0.0, -0.3)):
            stud(g, FE, V((xg + sx * 0.05, GY + yy, RIDGE_DECK - 0.2 + zz)), V((sx, 0, 0)), r=0.03, h=0.02)

    # ---- 瓦（本瓦葺き）と棟 ----
    s_top = PROF.s_at_x(0.13)
    for dirn in (-1, 1):
        F = RoofFrame((-ROOF['x_half'], GY), EX, V((0, dirn, 0)), PROF)
        hongawara(g, TL, F, 0.0, 2 * ROOF['x_half'], pitch=0.27, row=0.29, sag=0.022, r=0.072, t=0.022, s_top=s_top,
                  proj=0.05, eave_drop=EAVE_DROP, seed=seed + 50 + dirn, hseg=3, mseg=4, disc='full', disc_key=TD)
    ztop = ridge(g, TL, (-ROOF['x_half'] - 0.06, GY), (ROOF['x_half'] + 0.06, GY), RIDGE_DECK + 0.07, w0=0.38, layers=5, lh=0.044,
                 cap_r=0.11, oni=(True, True), oni_scale=1.25, menado_key='plaster_white', menado_h=0.1, seed=seed + 7)

    # ---- 控柱と小屋根 ----
    cy = GY - CP['z_offset']          # 控柱の Y（北）
    cs = CP['size']
    small_ridge_deck = 5.02
    sprof = Profile([0.0, 0.72], [small_ridge_deck, small_ridge_deck - 0.72 * 0.62])
    for s in (-1, 1):
        x = s * PX
        chamfer_box(g, ST, (x, cy, (CFOOT_TOP - 0.12) / 2), EX, EY, EZ, 0.33, 0.33, (CFOOT_TOP + 0.12) / 2, b=0.02, step=0.3,
                    jitter=0.002, rng=np.random.default_rng(seed + 20 + s))
        pillar(g, W, x, cy, cs, cs, CFOOT_TOP, CP['top_y'], rng, ch=0.012, nchk=(1, 1, 1, 1))
        obox(g, FE, V((x, cy, CFOOT_TOP + 0.14)), EZ, EX, EY, 0.14, cs / 2 + 0.01, cs / 2 + 0.01, ch=0.02)
        # 貫（鏡柱と控柱をつなぐ）
        for zz in (1.3, 2.75):
            beam(g, W, (x, GY + PD / 2 - 0.05, zz), (x, cy + 0.42, zz), 0.12, 0.22, ch=0.01, seg_len=0.6)
        # 頭の梁（控柱の上に載る）
        beam(g, W, (x, GY + PD / 2 - 0.05, CP['top_y'] + 0.11), (x, cy + 0.5, CP['top_y'] + 0.11), 0.2, 0.22, ch=0.012, seg_len=0.6)
        # 束と、小屋根を受ける横木（扉の上端より上）
        top_beam = 4.44
        for yy in (GY + 1.0, cy):
            obox(g, W, V((x, yy, (CP['top_y'] + 0.22 + top_beam) / 2)), EZ, EX, EY, (top_beam - CP['top_y'] - 0.22) / 2, 0.08, 0.08, ch=0.01)
            beam(g, W, (x - 0.72, yy, top_beam + 0.07), (x + 0.72, yy, top_beam + 0.07), 0.16, 0.14, ch=0.01)
        # 棟木と桁
        y0r, y1r = GY + 0.72, cy + 0.72
        beam(g, W, (x, y0r - 0.05, small_ridge_deck - 0.16), (x, y1r + 0.05, small_ridge_deck - 0.16), 0.14, 0.16, ch=0.01, seg_len=0.6)
        obox(g, W, V((x, (GY + 1.0 + cy) / 2, (top_beam + 0.14 + small_ridge_deck - 0.24) / 2)), EZ, EX, EY,
             (small_ridge_deck - 0.24 - top_beam - 0.14) / 2, 0.06, 0.06, ch=0.008)
        for sx in (-1, 1):
            F = RoofFrame((x, y0r), EY, V((sx, 0, 0)), sprof)
            # 垂木と野地
            for yy in np.linspace(0.12, (y1r - y0r) - 0.12, 8):
                p0 = F.pt(yy, 0.0, -0.075)
                p1 = F.pt(yy, sprof.length - 0.02, -0.075)
                rafter(g, W, WE, p0, p1, F.normal(0.3), 0.05, 0.06, seg_len=0.4)
            sm = sprof.length / 2
            obox(g, WS, F.pt((y1r - y0r) / 2, sm, -0.022), EY, F.tangent(sm), F.normal(sm), (y1r - y0r) / 2 + 0.04, sm, 0.02, seg=3)
            obox(g, W, F.pt((y1r - y0r) / 2, sprof.length - 0.02, -0.05), EY, F.tangent(sm), F.normal(sm), (y1r - y0r) / 2 + 0.06, 0.035, 0.045, ch=0.008)
            hongawara(g, TL, RoofFrame((x, y0r - 0.1), EY, V((sx, 0, 0)), sprof), 0.0, (y1r - y0r) + 0.2, pitch=0.25, row=0.3,
                      sag=0.018, r=0.06, t=0.018, s_top=0.1, proj=0.03, seed=seed + 60 + s * 3 + sx, hseg=2, mseg=4, disc='flat',
                      inner_lips=False, disc_key=TD)
        # 妻の破風（小）
        for yy in (y0r - 0.1, y1r + 0.1):
            for sx in (-1, 1):
                F = RoofFrame((x, yy), EY, V((sx, 0, 0)), sprof)
                beam(g, W, F.pt(0.0, 0.0, -0.08), F.pt(0.0, sprof.length + 0.03, -0.08), 0.045, 0.16, up=F.normal(0.3), ch=0.006)
        ridge(g, TL, (x, y0r - 0.14), (x, y1r + 0.14), small_ridge_deck + 0.06, w0=0.28, layers=2, lh=0.04, cap_r=0.085,
              oni=(False, True), oni_scale=0.7, menado_key='plaster_white', menado_h=0.08, seed=seed + 30 + s, piece=0.3)

    # ---- 門扉（内側＝北へ 78° 開く）----
    ang = math.radians(DOOR['open_inward_deg'])
    lw, lh = DOOR['leaf_width'], DOOR['leaf_height']
    th = 0.11
    zb = 0.06
    for s in (-1, 1):
        piv = V((s * HINGE_X, HINGE_Y, 0.0))
        dir0 = V((-s, 0, 0))
        n0 = V((0, 1, 0))           # 閉じたときの内側（北）
        R = __import__('mathutils').Matrix.Rotation(-s * ang, 3, 'Z')
        dvec = R @ dir0
        nin = R @ n0                 # 扉の裏（内側）の向き
        nout = -nin

        def P(xl, yl, z):
            return piv + dvec * xl + nin * yl + EZ * z
        # 縦板
        nb = 6
        bw = lw / nb
        for i in range(nb):
            w_i = bw - 0.008
            yo = rng.uniform(-0.004, 0.004)
            c = P(bw * (i + 0.5), th / 2 + yo, zb + lh / 2)
            obox(g, WD, c, EZ, dvec, nin, lh / 2 - rng.uniform(0, 0.01), w_i / 2, th / 2, ch=0.008, seg=7)
        # 裏桟（内側の横木）
        for zz in (0.4, 1.35, 2.3, 3.25, 4.05):
            c = P(lw / 2, th + 0.04, zb + zz)
            obox(g, W, c, dvec, EZ, nin, lw / 2 - 0.05, 0.08, 0.04, ch=0.008, seg=4)
        # 閂の受け金物（裏）
        for xl in (0.35, lw - 0.35):
            c = P(xl, th + 0.12, zb + 2.0)
            obox(g, FE, c, EZ, dvec, nin, 0.16, 0.05, 0.04, ch=0.008)
        # 表の鉄の帯と鋲
        for zz in (0.4, 1.35, 2.3, 3.25, 4.05):
            c = P(lw / 2 + 0.004, -0.006, zb + zz)
            obox(g, FE, c, dvec, EZ, nin, lw / 2 + 0.006, 0.04, 0.007, ch=0.004, seg=2)
            for xl in np.linspace(0.12, lw - 0.1, 12):
                stud(g, FE, P(xl, -0.013, zb + zz), nout, r=0.019, h=0.014)
        # 肘壺の金物（吊り元の大きな帯、先が広がる）
        hinge_plate = [(0.0, -0.075), (0.62, -0.06), (0.74, -0.1), (0.84, 0.0), (0.74, 0.1), (0.62, 0.06), (0.0, 0.075), (-0.06, 0.06), (-0.06, -0.06)]
        for zz in (0.75, lh - 0.55):
            extrude_outline(g, FE, hinge_plate, P(0.0, -0.004, zb + zz), dvec, EZ, nout, 0.012)
            for xl in (0.12, 0.3, 0.48, 0.7):
                stud(g, FE, P(xl, -0.017, zb + zz), nout, r=0.024, h=0.018)
            cylinder(g, FE, piv + EZ * (zb + zz - 0.15), piv + EZ * (zb + zz + 0.15), 0.055, seg=10)
            # 柱の側の受け金物
            base = V((s * (PX - PW / 2 - 0.006), GY + PD / 2 - 0.25, zb + zz))
            obox(g, FE, base, EY, EZ, V((-s, 0, 0)), 0.25, 0.08, 0.008, ch=0.004)
        # 引き手の鐶（表）
        c = P(lw - 0.3, -0.022, zb + 1.7)
        obox(g, FE, P(lw - 0.3, -0.008, zb + 1.83), EZ, dvec, nin, 0.07, 0.07, 0.008, ch=0.02)
        torus(g, FE, c + EZ * (-0.05), nout, 0.1, 0.014, seg=12, segv=4)

    # ---- 敷石（閉じた扉の下の線）----
    abox(g, ST, -HINGE_X + 0.02, HINGE_X - 0.02, HINGE_Y - 0.16, HINGE_Y + 0.14, -0.25, 0.045, ch=0.025, seg_len=0.6)
    print(f'gate: eave bottom {EAVE_BOTTOM:.3f}, tile tip {Z_TIP:.3f}, min deck clearance {clear:.3f}', flush=True)
    return g, dict(ridge_top=ztop, hinge=(HINGE_X, HINGE_Y), ang=ang, cy=cy)


def gate_meta(info):
    """当たり判定とカメラ除け（ゲームの座標）"""
    from gkit import game_box, game_rect
    col, blk = [], []
    cy = info['cy']
    for s in (-1, 1):
        x = s * PX
        # 鏡柱と根巻石（通り道の側は 2.02 まで：通れる幅 x -2.0〜2.0 を保つ）
        col.append(game_rect(s * FOOT_X0, s * (FOOT_X1 + 0.02), GY + FOOT_Y0 - 0.02, GY + max(FOOT_Y1, PD / 2) + 0.03))
        col.append(game_rect(x - 0.36, x + 0.36, cy - 0.36, cy + 0.36))          # 控柱と礎石
        col.append(game_rect(x - 0.1, x + 0.1, GY + PD / 2, cy + 0.5))           # 貫（下の貫は腰の高さ）
        blk.append(game_box(x - PW / 2 - 0.03, x + PW / 2 + 0.03, GY - PD / 2 - 0.03, GY + PD / 2 + 0.03, 0.0, PTOP))
        blk.append(game_box(s * FOOT_X0, s * FOOT_X1, GY + FOOT_Y0, GY + FOOT_Y1, 0.0, FOOT_TOP))
        blk.append(game_box(x - 0.25, x + 0.25, cy - 0.25, cy + 0.25, 0.0, CP['top_y'] + 0.3))
        # 控柱の小屋根
        blk.append(game_box(x - 0.8, x + 0.8, GY + 0.55, cy + 0.9, 4.3, 5.3))
        # 腕木（冠木の上、南北に張り出す）
        for hx in HARI_X:
            blk.append(game_box(s * hx - 0.14, s * hx + 0.14, GY - XD - 0.32, GY + XD + 0.32, KB1, HARI1 + 0.02))
        # 開いた扉（吊り元から先端まで、厚みを含む）
        hx, hy = info['hinge']
        a = info['ang']
        ex = s * (hx - math.cos(a) * DOOR['leaf_width'])
        ey = hy + math.sin(a) * DOOR['leaf_width']
        x0, x1 = sorted((s * hx + s * 0.16, ex - s * 0.04))
        col.append(game_rect(x0, x1, hy - 0.05, ey + 0.05))
        blk.append(game_box(x0, x1, hy - 0.05, ey + 0.05, 0.0, DOOR['leaf_height'] + 0.1))
    # 冠木・鴨居、舟肘木・桁
    blk.append(game_box(-KXH - 0.05, KXH + 0.05, GY - KB_D / 2 - 0.05, GY + PD / 2 + 0.25, DOOR['leaf_height'] + 0.08, KB1 + 0.05))
    blk.append(game_box(-PX - 0.95, PX + 0.95, GY - 0.2, GY + 0.2, ARM0 - 0.02, TIE1 + 0.02))
    # 屋根（二軒の軒の出を含む）。飛檐垂木の先の下端より下は空ける
    blk.append(game_box(-ROOF['x_half'] - 0.12, ROOF['x_half'] + 0.12, GY - XT - 0.1, GY + XT + 0.1,
                        EAVE_BOTTOM - 0.04, info['ridge_top'] + 0.35))
    # 軒の下の組物（腕木の下端から出桁の上端まで。屋根の箱と重ねて隙間を作らない）
    blk.append(game_box(-ROOF['x_half'], ROOF['x_half'], GY - XD - 0.35, GY + XD + 0.35, HARI0 - 0.02, DASHI1 + 0.02))
    return col, blk
