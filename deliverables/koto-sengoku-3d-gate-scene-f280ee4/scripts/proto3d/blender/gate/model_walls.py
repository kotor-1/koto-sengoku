"""
土塀（scene.json の walls と wall_section）：3 本の塀。Blender の座標で組む。

- 根元：少し傾いた打込接ぎの石積み。長方形に近い石（長さ 0.4〜1.0 m・高さ 0.3〜0.5 m）をおおよその段に並べ、ときどき楔の詰め石。
  面は平ら（膨らみ 3 cm 以下）、目地は幅 1〜2 cm・奥行き 2〜3 cm。端は両面を貫く隅石（長短を交互に＝算木積み）。城の側は簡単な石
- 上：温かい白の漆喰（広いむらは頂点色で 6〜8%。雨だれの模様は無し）。狭間は外側＝町の側。
  笠の下に濃い木の帯（見える高さ 0.18 m）、垂木の木口が軒裏に並ぶ、茅負、本瓦の笠と棟
- east_ns の北の端は east_ew に突き当たる（石と漆喰は中へ入り込む。笠は谷で取り合い、下に隠れる瓦は抜いて谷板で覆う）
"""
from __future__ import annotations

import math

import bpy
import bmesh
import numpy as np

import mats
from gkit import (EX, EY, EZ, SCENE, V, FaceMap, Geo, Profile, RoofFrame, abox, beam, course_stones, extrude_outline,
                  hongawara, obox, rafter, ridge, stone_pillow, wall_block)

WS = SCENE['wall_section']
T0 = WS['thickness_base'] / 2          # 根元の半分の厚み（石積みの芯の面）
T1 = WS['thickness_top'] / 2           # 漆喰の半分の厚み
ZS = WS['stone_base_height']           # 石積みの上端
ZP = WS['plaster_top_y']               # 漆喰の上端
ZC = WS['cap_top_y']                   # 笠の上端
OVH = WS['cap_overhang']               # 笠の軒（中心から）
BATTER = (T0 - (T1 + 0.02)) / ZS       # 石積みの傾き（高さ 1 m あたり）
PLASTER_TINT = (1.0, 0.958, 0.855)     # 漆喰の頂点色（温かい白へ）
Z_BOT = -0.12                          # 石は地面の下から
GATE_FACE = SCENE['gate']['pillar_x'] + SCENE['gate']['pillar_size_xz'][0] / 2 + 0.01

DECK_C = 4.05                          # 笠の野地の中心の高さ
DECK_P = 0.4                           # 笠の勾配
EAVE_X = OVH - 0.01
CAP_PROF = Profile([0.0, EAVE_X], [DECK_C, DECK_C - DECK_P * EAVE_X])
KP = math.hypot(1, DECK_P)
FASC_H = 0.05                          # 茅負（垂木の先の上、瓦の下）
RAF_W, RAF_H = 0.06, 0.07              # 笠の垂木
RAF_SP = 0.3
BAND_VIS = 0.18                        # 笠の下の木の帯（垂木の下に見える高さ）

ST = 'stone_ishigaki'                  # 石の面（打込接ぎ）
STONE_OUT = dict(gap=(0.010, 0.018), bulge=(0.008, 0.02), bevel=(0.03, 0.1), face0=0.016, tilt=0.02, wav=(0.004, 0.002),
                 jag=(0.004, 0.006), joint_h=-0.012, jag_step=(0.2, 0.32))
STONE_IN = dict(STONE_OUT, detail=False)


def raf_top(w):
    """笠の垂木の上端の高さ（中心からの距離 w）"""
    return deck(w) - 0.012 - FASC_H


def raf_bot(w):
    return raf_top(w) - RAF_H * KP


def deck(w):
    return DECK_C - DECK_P * abs(w)


def runs():
    """塀の一続き：始点・終点（Blender XY）、両端の種類、外側（町の側）の面の向き"""
    out = []
    for w in SCENE['walls']:
        (ax, az), (bx, bz) = w['from'], w['to']
        P0, P1 = V((ax, -az, 0)), V((bx, -bz, 0))
        if w['name'] in ('west_ew', 'east_ew'):
            P0.x = math.copysign(GATE_FACE, P0.x)
            e0, e1 = 'gate', 'free'
        else:
            # 北の端は east_ew の中心まで入れる
            P0.y = -SCENE['walls'][1]['from'][1]
            e0, e1 = 'join', 'free'
        U = (P1 - P0).normalized()
        Nl = EZ.cross(U).normalized()
        # 町の側：ew は南（-Y）、ns は西（-X）
        town = V((0, -1, 0)) if w['name'] != 'east_ns' else V((-1, 0, 0))
        out.append(dict(name=w['name'], P0=P0, P1=P1, L=(P1 - P0).length, U=U, Nl=Nl, e0=e0, e1=e1,
                        outer=1 if Nl.dot(town) > 0 else -1))
    return out


def _wave(rng, amp):
    f = rng.uniform(0.9, 2.6, 3)
    ph = rng.uniform(0, 6.28, 3)
    a = rng.uniform(0.4, 1.0, 3)
    a = a / a.sum() * amp
    return lambda u: float(np.sum(a * np.sin(f * u + ph)))


def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def build_walls(seed=21):
    g = Geo()
    R = runs()
    info = dict(runs=R, loopholes=[])
    ew = {r['name']: r for r in R}
    ns = ew['east_ns']
    ns_x = ns['P0'].x
    for ri, r in enumerate(R):
        rng = np.random.default_rng(seed + 100 * ri)
        P0, U, Nl, L = r['P0'], r['U'], r['Nl'], r['L']
        # ---- 段の高さ（両面と隅石で共有）：4 段、上ほど少し低い ----
        zs = [Z_BOT, 0.30 + rng.normal(0, 0.02), 0.66 + rng.normal(0, 0.02), 1.0 + rng.normal(0, 0.02), ZS]
        nk = len(zs) - 1
        # 隅石（端ごと、段ごとの長さ：長・短を交互）
        blocks = {}
        for end, kind in ((0, r['e0']), (1, r['e1'])):
            if kind in ('gate', 'free'):
                first = rng.random() < 0.5
                blocks[end] = [(0.9 if (k % 2 == 0) == first else 0.55) + rng.normal(0, 0.04) for k in range(nk)]
        fms = {}
        for side in (1, -1):
            N = Nl * side
            C = P0 + N * T0
            fms[side] = FaceMap(C, U, N, BATTER)
        for side in (1, -1):
            fm = fms[side]
            outer = side == r['outer']
            waves = [None] + [_wave(rng, 0.025) for _ in range(nk - 1)] + [None]
            u_lo_all = blocks[0][0] if 0 in blocks else 0.0
            if r['e0'] == 'join':
                u_lo_all = T0 + 0.1       # east_ew の南の面から

            def bfun(k, u):
                if waves[k] is None:
                    return zs[k]
                lo = blocks[0][min(k, nk - 1)] if 0 in blocks else u_lo_all
                hi = L - (blocks[1][min(k, nk - 1)] if 1 in blocks else 0.0)
                t = _smooth(0.0, 0.5, min(u - lo, hi - u) - 0.05)
                return zs[k] + waves[k](u) * t
            # 突き当たり（east_ew の南の面で ns の分を空ける）
            skip = None
            if r['name'] == 'east_ew' and side == r['outer']:
                a = abs(ns_x - P0.x)
                skip = (a - T0 - 0.08, a + T0 + 0.08)
            for k in range(nk):
                lo = (blocks[0][k] + 0.012) if 0 in blocks else u_lo_all
                hi = (L - blocks[1][k] - 0.012) if 1 in blocks else L
                spans = [(lo, hi)]
                if skip:
                    spans = [(lo, skip[0]), (skip[1], hi)]
                for (ua, ub) in spans:
                    if ub - ua < 0.25:
                        continue
                    if outer:
                        stones = course_stones(rng, ua, ub, zs[k], zs[k + 1], lambda u, k=k: bfun(k, u), lambda u, k=k: bfun(k + 1, u),
                                               wmin=0.38, wmax=0.88, slant=0.025, corner_p=0.15, split_p=0.08, kink_p=0.12)
                    else:
                        # 城の側：大きめの石で簡単に（三角形を節約。east_ns の東の面は町から見えないのでさらに大きく）
                        big = 1.5 if r['name'] == 'east_ns' else 1.0
                        stones = course_stones(rng, ua, ub, zs[k], zs[k + 1], lambda u, k=k: bfun(k, u), lambda u, k=k: bfun(k + 1, u),
                                               wmin=0.6 * big, wmax=1.2 * big, slant=0.025, corner_p=0.0, split_p=0.0, kink_p=0.0)
                    for (poly, small) in stones:
                        stone_pillow(g, ST, fm, poly, rng, small=small, **(STONE_OUT if outer else STONE_IN))
        # 隅石
        for end, ws in blocks.items():
            for k in range(nk):
                if end == 0:
                    u_in, u_end = ws[k], 0.0
                else:
                    u_in, u_end = L - ws[k], L
                wall_block(g, ST + '#block', fms[1], fms[-1], u_in, u_end, zs[k], zs[k + 1], bulge=0.03, ch=0.025, gap=0.016, rng=rng)
        # 石積みの芯（目地の奥に見える暗い面）。隅石のある端は隅石の中で止める（端の面が重ならないように）
        _core_box(g, ST + '#core', P0, U, Nl, 0.15 if 0 in blocks else 0.0, L - (0.15 if 1 in blocks else 0.0))

        # ---- 笠：木の帯・垂木（木口が並ぶ）・軒裏の板・茅負・瓦・棟 ----
        ov0 = {'gate': 0.0, 'free': 0.14, 'join': 0.0}[r['e0']]
        ov1 = {'gate': 0.0, 'free': 0.14, 'join': 0.0}[r['e1']]
        sa, sb = -ov0, L + ov1
        p_end0 = 0.0 if r['e0'] != 'free' else 0.03
        p_end1 = L - (0.03 if r['e1'] == 'free' else 0.0)
        # 突き当たり：ns は east_ew の中（と、その軒の下）では垂木・板・帯を作らない
        s_mem0 = (EAVE_X + 0.02) if r['e0'] == 'join' else sa
        s_band0 = T0 if r['e0'] == 'join' else p_end0
        is_ew_join = r['name'] == 'east_ew'
        a_ns = abs(ns_x - P0.x)

        def Lp(s, w, z):
            return P0 + U * s + Nl * w + EZ * z
        band_top = deck(T1) - 0.075        # 漆喰の妻の上端（軒裏の板の高さ）
        band_bot = raf_bot(T1) - BAND_VIS
        for side in (1, -1):
            # 木の帯（垂木の下に 0.18 m 見える。上は垂木のあいだを塞いで軒裏まで）
            obox(g, 'wood_dark#band', Lp((s_band0 + p_end1) / 2, side * (T1 + 0.015), (band_bot + band_top) / 2), U, Nl, EZ,
                 (p_end1 - s_band0) / 2 + (0.04 if r['e1'] == 'free' else 0.0), 0.025, (band_top - band_bot) / 2, ch=0.004,
                 seg=max(1, int(L / 1.2)))
            # 垂木（先の木口は別のキー）
            n = int((sb - sa - 0.2) / RAF_SP)
            for i in range(n + 1):
                s = sa + 0.12 + (sb - sa - 0.24) * i / max(n, 1)
                if s < s_mem0:
                    continue
                if is_ew_join and side == r['outer'] and abs(s - a_ns) < T1 + 0.08:
                    continue
                w0, w1 = side * (T1 - 0.05), side * (EAVE_X - 0.004)
                a = Lp(s, w0, (raf_top(abs(w0)) + raf_bot(abs(w0))) / 2)
                b = Lp(s, w1, (raf_top(abs(w1)) + raf_bot(abs(w1))) / 2)
                rafter(g, 'wood_dark#frame', 'wood_dark#end', a, b, (EZ + Nl * side * DECK_P).normalized(), RAF_W, RAF_H, seg_len=0.5)
            # 軒裏の板（垂木の上）
            F = RoofFrame(P0, U, Nl * side, CAP_PROF)
            x0, x1 = T1 + 0.02, EAVE_X - 0.07
            pa = Lp(0, side * x0, raf_top(x0) + 0.009 * KP)
            pb = Lp(0, side * x1, raf_top(x1) + 0.009 * KP)
            t = pb - pa
            c = (pa + pb) / 2 + U * ((s_mem0 + sb) / 2)
            obox(g, 'wood_dark#soffit', c, U, t, t.cross(U), (sb - s_mem0) / 2, t.length / 2, 0.009, seg=max(1, int((sb - s_mem0) / 1.2)))
            # 茅負（垂木の先の上、瓦の下）
            fz0, fz1 = raf_top(EAVE_X) - 0.008, deck(EAVE_X) - 0.008
            prof = [(side * (EAVE_X + 0.008), fz0), (side * (EAVE_X + 0.008), fz1), (side * (EAVE_X - 0.07), fz1 + 0.07 * DECK_P),
                    (side * (EAVE_X - 0.07), raf_top(EAVE_X - 0.07) - 0.008)]
            origin = P0 + U * s_mem0
            extrude_outline(g, 'wood_dark#frame', prof, origin, Nl, EZ, U, sb - s_mem0 + (0.01 if r['e1'] == 'free' else 0.0))
            # 瓦（突き当たりでは、もう一方の笠の下に隠れる瓦を抜く）
            Ft = RoofFrame(P0 + U * sa, U, Nl * side, CAP_PROF)
            clip = None
            if is_ew_join and side == r['outer']:
                def clip(p, _y=P0.y):
                    d = abs(p.y - _y)
                    return abs(p.x - ns_x) < d
            elif r['e0'] == 'join':
                def clip(p, _y=P0.y):
                    d = abs(_y - p.y)
                    return d < abs(p.x - ns_x) - 0.08
            hongawara(g, 'tile_ibushi', Ft, 0.0, sb - sa, pitch=0.28, row=0.42, ov=0.06, sag=0.018, r=0.06, t=0.018,
                      s_top=CAP_PROF.s_at_x(0.08), proj=0.03, eave_drop=0.05, verge=(r['e0'] != 'join', r['e1'] != 'join'),
                      seed=seed + 7 * ri + side, hseg=3 if side == r['outer'] else 2, mseg=3, disc='flat', inner_lips=False,
                      disc_key='tile_ibushi#disc', clip=clip)
        # 妻の破風（小）と、帯の回り込み
        for end, kind, s_end in ((0, r['e0'], sa), (1, r['e1'], sb)):
            if kind == 'join':
                continue
            sgn = -1 if end == 0 else 1
            sh = s_end - sgn * 0.03
            for side in (1, -1):
                F = RoofFrame(P0 + U * sh, U, Nl * side, CAP_PROF)
                beam(g, 'wood_dark#frame', F.pt(0.0, 0.0, -0.09), F.pt(0.0, CAP_PROF.length + 0.02, -0.09), 0.045, 0.18,
                     up=F.normal(0.2), ch=0.006)
            if kind == 'free':
                pe = p_end1 if end == 1 else p_end0
                obox(g, 'wood_dark#band', Lp(pe + sgn * 0.025, 0.0, (band_bot + band_top) / 2), Nl, U, EZ, T1 + 0.04, 0.025,
                     (band_top - band_bot) / 2, ch=0.004)
        ridge(g, 'tile_ibushi', (P0 + U * (sa - 0.03)).xy, (P0 + U * (sb + 0.03)).xy, DECK_C + 0.06, w0=0.3, layers=2, lh=0.045,
              cap_r=0.085, piece=0.4, noshi_piece=0.9, oni=(r['e0'] == 'free', r['e1'] == 'free'), oni_scale=0.75,
              menado_key='plaster_white#menado', menado_h=0.08, seed=seed + 3 * ri, cap_seg=5)
        # 谷板（突き当たりの谷の線を覆う、両側の瓦の面に沿って折れた板）
        if is_ew_join:
            side = r['outer']
            for sx in (-1, 1):
                pts = []
                for t in np.linspace(0.0, EAVE_X + 0.03, 6):
                    pts.append(V((ns_x + sx * t, P0.y + side * t, 0.0)))
                for i in range(len(pts) - 1):
                    a, b = pts[i], pts[i + 1]
                    _valley_panel(g, a, b, ns_x, P0.y, side)

        # ---- 狭間（外側の面、三角と四角を交互）----
        a_lo, a_hi = 1.4, L - 1.3
        if r['e0'] == 'join':
            a_lo = T0 + 1.2
        nlh = int((a_hi - a_lo) / 1.85)
        for i in range(nlh + 1):
            s = a_lo + (a_hi - a_lo) * i / max(nlh, 1)
            if r['name'] == 'east_ew' and abs(abs(ns_x - P0.x) - s) < 1.3:
                continue
            info['loopholes'].append((ri, s, 'tri' if i % 2 == 0 else 'sq'))
        info['plaster_range'] = info.get('plaster_range', {})
        info['plaster_range'][ri] = (p_end0, p_end1)
    return g, info


def _valley_panel(g, a, b, cx, cy, side, half=0.16, lift=0.045):
    """谷の線 a→b（XY）に沿う谷板 1 区画：両側の瓦の面（高さ DECK_C-DECK_P*距離）に沿う 2 枚の板"""
    def zf(p):
        # 見える面は 2 つの面の高い方（= 棟からの距離の近い方）
        return DECK_C - DECK_P * min(abs(p.x - cx), abs(p.y - cy)) + lift
    d = (b - a).normalized()
    perp = V((-d.y, d.x, 0.0))
    verts = []
    for p in (a, b):
        for o in (-half, 0.0, half):
            q = p + perp * o
            verts.append(V((q.x, q.y, zf(q))))
    faces = [(0, 3, 4, 1), (1, 4, 5, 2)]
    g.oriented('tile_ibushi#valley', verts, faces, EZ)


def _core_box(g, key, P0, U, Nl, s0, s1, nseg=None):
    """石積みの芯：傾いた箱（長い面は分割）"""
    L = s1 - s0
    n = nseg or max(1, int(L / 0.5))
    rows = []
    for z in (Z_BOT, ZS):
        t = T0 - BATTER * z - 0.004
        rows.append(t)
    verts = []
    for i in range(n + 1):
        s = s0 + L * i / n
        for (z, t) in zip((Z_BOT, ZS), rows):
            for w in (t, -t):
                verts.append(P0 + U * s + Nl * w + EZ * z)
    # 頂点の並び：i ごとに [下+, 下-, 上+, 上-]
    faces = []
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        faces.append((a + 0, b + 0, b + 2, a + 2))   # + の面
        faces.append((a + 1, a + 3, b + 3, b + 1))   # - の面
        faces.append((a + 2, b + 2, b + 3, a + 3))   # 上
        faces.append((a + 0, a + 1, b + 1, b + 0))   # 下
    faces.append((0, 2, 3, 1))
    e = 4 * n
    faces.append((e, e + 1, e + 3, e + 2))
    c = P0 + U * (s0 + L / 2) + EZ * ((Z_BOT + ZS) / 2)
    g.convex(key, verts, faces, center=c)


def make_plaster(info):
    """漆喰の本体（五角形の断面を押し出し、狭間をブール演算で抜く）。1 物体にまとめ、AO は光のテクスチャ（第 2 UV）に焼く"""
    R = info['runs']
    parts = []
    prof = [(-T1, ZS), (T1, ZS), (T1, deck(T1) - 0.075), (0.0, DECK_C - 0.075), (-T1, deck(T1) - 0.075)]
    for ri, r in enumerate(R):
        pa, pb = info['plaster_range'][ri]
        g = Geo()
        extrude_outline(g, 'p', prof, r['P0'] + r['U'] * pa, r['Nl'], EZ, r['U'], pb - pa)
        me = _mesh_from_geo(g, f'_plaster_{ri}')
        body = bpy.data.objects.new(f'_plaster_{ri}', me)
        bpy.context.scene.collection.objects.link(body)
        # 狭間の抜き型
        cg = Geo()
        for (rj, s, kind) in info['loopholes']:
            if rj != ri:
                continue
            side = r['outer']
            No = r['Nl'] * side
            if kind == 'tri':
                zc, a_out, a_in = 2.3, 0.24, 0.4
                shape = lambda a: [(-a / 2, -a * 0.29), (a / 2, -a * 0.29), (0.0, a * 0.58)]
            else:
                zc, a_out, a_in = 2.35, 0.2, 0.34
                shape = lambda a: [(-a / 2, -a / 2), (a / 2, -a / 2), (a / 2, a / 2), (-a / 2, a / 2)]
            outer = [r['P0'] + r['U'] * (s + u) + No * (T1 + 0.1) + EZ * (zc + z) for (u, z) in shape(a_out)]
            inner = [r['P0'] + r['U'] * (s + u) - No * (T1 + 0.1) + EZ * (zc + z) for (u, z) in shape(a_in)]
            n = len(outer)
            faces = [tuple(range(n)), tuple(n + i for i in range(n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
            cg.convex('c', outer + inner, faces)
        if cg.parts:
            cme = _mesh_from_geo(cg, f'_cut_{ri}')
            cut = bpy.data.objects.new(f'_cut_{ri}', cme)
            bpy.context.scene.collection.objects.link(cut)
            mod = body.modifiers.new('cut', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.solver = 'EXACT'
            mod.object = cut
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            nm = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
            body.modifiers.clear()
            old = body.data
            body.data = nm
            bpy.data.meshes.remove(old)
            bpy.data.objects.remove(cut, do_unlink=True)
            bpy.data.meshes.remove(cme)
        parts.append(body)
    # 1 物体へ
    bm = bmesh.new()
    for o in parts:
        bm.from_mesh(o.data)
    me = bpy.data.meshes.new('walls_plaster')
    bm.to_mesh(me)
    bm.free()
    for o in parts:
        m = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(m)
    ob = bpy.data.objects.new('walls_plaster', me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = False
    mats.assign(ob, 'plaster_white')
    bpy.context.view_layer.update()
    mats.uv_box(ob)
    mats.densify(ob, 0.7)
    # 頂点色：温かい白（黄み）と、世界の座標でゆっくり変わる 6〜8% のむら（繰り返さない）
    a = mats._color_attr(me, mats.COLOR_ATTR)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    rng = np.random.default_rng(77)
    nz = np.zeros(len(co), np.float32)
    for _ in range(7):
        k = 2 * math.pi / rng.uniform(1.4, 5.0)
        th = rng.uniform(0, 2 * math.pi)
        dvec = np.array([math.cos(th), math.sin(th), rng.normal(0, 0.5)]) * k
        nz += np.sin(co @ dvec + rng.uniform(0, 6.28)).astype(np.float32) * rng.uniform(0.5, 1.0)
    nz /= nz.std() + 1e-6
    val = np.clip(1.0 + 0.035 * nz, 0.9, 1.08)
    warm = np.array(PLASTER_TINT, np.float32)
    buf = np.ones((len(a.data), 4), np.float32)
    buf[:, :3] = val[:, None] * warm[None, :]
    a.data.foreach_set('color', buf.ravel())
    mats._set_active_color(me, mats.COLOR_ATTR)
    ob['koto_lightmap'] = True
    ob['koto_key'] = 'plaster'
    ob['koto_lib'] = 'plaster_white'
    return ob


def _mesh_from_geo(g, name):
    p = next(iter(g.parts.values()))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in p['v']], [], p['f'])
    me.update(calc_edges=True)
    return me


def walls_meta(info):
    from gkit import game_box, game_rect
    col, blk = [], []
    for r in info['runs']:
        a, b = r['P0'], r['P1']
        t = T0 + 0.09
        pts = [a + r['Nl'] * t, a - r['Nl'] * t, b + r['Nl'] * t, b - r['Nl'] * t]
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        col.append(game_rect(min(xs), max(xs), min(ys), max(ys)))
        blk.append(game_box(min(xs), max(xs), min(ys), max(ys), 0.0, ZP + 0.1))
        # 笠（軒の出と妻の出を含む）
        e0 = 0.0 if r['e0'] != 'free' else 0.2
        e1 = 0.0 if r['e1'] != 'free' else 0.2
        pa = r['P0'] - r['U'] * e0
        pb = r['P1'] + r['U'] * e1
        cp = [pa + r['Nl'] * (OVH + 0.06), pa - r['Nl'] * (OVH + 0.06), pb + r['Nl'] * (OVH + 0.06), pb - r['Nl'] * (OVH + 0.06)]
        blk.append(game_box(min(p.x for p in cp), max(p.x for p in cp), min(p.y for p in cp), max(p.y for p in cp),
                            raf_bot(T1) - BAND_VIS - 0.05, ZC + 0.12))
    return col, blk
