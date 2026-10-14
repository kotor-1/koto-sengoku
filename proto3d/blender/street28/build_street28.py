"""
Version 28 の通りの建物を作り、GLB（proto3d/public/models/<id>.glb）と当たり判定の meta（このフォルダの <id>.meta.json）を書き出す。
    /root/blender-venv/bin/python proto3d/blender/street28/build_street28.py [machiya_a28 machiya_b28 machiya_d28 kura28 nishi28]
        [--no-preview] [--fast] [--no-bake]
- 置き場所は street28.json の buildings（V28 の通りの配置の唯一の元。ゲームも同じ表を読む）。ゲームは原点に置くだけ。
- 町家 A・B・D は Version 27 の作り方（machiya/build_machiya.py・kit.py）を元に、新しいファイル名で作り直す（旧 GLB はそのまま残す）：
  軒裏（垂木・出桁・腕木・二重の鼻先）、店先（ばったり床几・ひな壇の品台・半暖簾）、側面（下見板・霧除け）、壁の裾の汚れ。
- kura28：Version 27 の町家 D の鏡写し（木戸の柵の線にまたがっていた）の代わり。妻入りの土蔵造りの店（架空）。
- nishi28：西の空き地（町家 B の南）の通りの縁：石置き板葺きの小屋掛けの店と、物見櫓の前の板塀。
- 当たり判定・カメラ除け：形を作るときに「固い物」の印（parts28.SolidGeo.solid）を付けた部品の頂点から箱を作る（手で別に書かない）。
- 材質は Version 27 と同じライブラリの画像（lib/mats.py の手続きの材質。同じ画像は公開の書き出しでまとまる）。
  暖簾は町家 A・B の暖簾の画像を使い回す（D の半暖簾は A の暖簾の下の無地の所だけを写す）。土蔵の入口は縄暖簾（藁の材質）。
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import time
import zlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'machiya'))
sys.path.insert(0, str(HERE.parent / 'scene'))
sys.path.insert(0, str(HERE))

from kit import (EX, EY, EZ, MODELS_DIR, PREVIEW_DIR, V, Wall, barrel, basket, beam, bench, board_fence, box, crate,  # noqa: E402
                 cylinder, gegyo, hisashi, itado, main_roof, noren, noren_material, obox, placement, post, quad_grid, raised_floor,
                 ridge, room, shelf, shitomido, stone, tawara, tile_field, torus, udegi_arm)
import kit  # noqa: E402
import build_machiya as bm  # noqa: E402
import parts28 as pp  # noqa: E402
import mats  # noqa: E402
import ground_tex as gtx  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402
from common import export_glb, reset, triangles  # noqa: E402

STREET = json.loads((HERE / 'street28.json').read_text())
BLD = {b['id']: b for b in STREET['buildings']}
PREVIEW = PREVIEW_DIR / 'street28'
PREVIEW.mkdir(parents=True, exist_ok=True)

# 追加の色の掛け算（同じ画像に頂点色を掛ける。新しい画像は作らない）
kit.COLOR_GAIN.update({
    'tile_ibushi#namako': (0.62, 0.63, 0.66),     # 海鼠壁の平瓦（屋根の瓦より少し暗い灰）
    'straw#rope': (0.72, 0.66, 0.55),             # 縄暖簾の縄（日に焼けた藁）
    'plaster_white#kura': (0.97, 0.96, 0.93),     # 土蔵の漆喰（わずかに温かい白）
})
KAYA = dict(h=0.12, d=0.07, board=(0.05, 0.04), proud=0.02, top=0.04)


def add_rotated(g, tmp, R, T=(0.0, 0.0, 0.0)):
    """別の器（tmp）で組んだ形を、回転 R・移動 T して g へ写す（UV・なめらか表示も）。固い物の印は g の今の印に入る"""
    T = V(T)
    for key, p in tmp.parts.items():
        if not p['f']:
            continue
        n0 = len(g.parts.get(key, {'v': []})['v'])
        g.add(key, [R @ v + T for v in p['v']], p['f'], False)
        g.parts[key]['sm'][-len(p['f']):] = p['sm']
        if 'uv' in p:
            g.parts[key].setdefault('uv', [])
            # UV は頂点ごと。前に UV の無い頂点があれば埋める
            uv = g.parts[key]['uv']
            while len(uv) < n0:
                uv.append((0.0, 0.0))
            uv.extend(p['uv'])


# ---------------------------------------------------------------------------
# 町家 A（つし二階）
# ---------------------------------------------------------------------------

def build_machiya_a28():
    h = BLD['machiya_a28']
    M = placement(h['footprint'], h['front'])
    g = pp.SolidGeo(seed=11)
    W, xf, xb, s = 8.2, 5.1, 0.0, 0.15
    p, of, ob, ov = 0.45, 0.75, 0.5, (0.38, 0.4)
    He = 4.6
    xr = (xb + xf) / 2
    zr = He + p * (xf + of - xr)
    RAF = (0.07, 0.09)
    with g.solid('roof', walk=False, camera=True):
        R = main_roof(g, xb=xb, xf=xf, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=3, seed=100, keta=(0.15, 0.18),
                      purlins_x=(0.85, xr, 4.25), gegyo_at=[(W + ov[1] + 0.0, 1)], oni_scale=1.1,
                      rafter_spacing=0.3, rafter=RAF, deck='wood_dark', kaya=KAYA)
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf)
    kz0 = kz1 - 0.18
    posts_f = [0.0, 2.05, 4.1, 6.15, W]
    e0, e1 = 4.1, 6.15
    LAT = 'wood_dark#bengara'
    a0, a1 = e0 + 0.075, e1 - 0.075

    with g.solid('body'):
        F = Wall(g, (xf, 0, 0), EY, EX, W, s)
        F.plinth(skip=[(e0, e1)], seed=1, mat='stone_granite#curb')
        F.sill(0.0, e0)
        F.sill(e1, W)
        for u in (e0, e1):
            stone(g, 'stone_granite#curb', F.at(u, 0.03, 0.0), (0.34, 0.34, 0.24), 40 + int(u * 10), flat_top=0.9, k=3.0, rough=0.07)
            F.post(u, 0.15, 3.12)
        F.post(2.05, 0.29, 3.12)
        F.hbeam(-0.08, W + 0.08, 2.15, 2.41, d=0.012, w=0.15)
        for (a, b) in ((0.0, 2.05), (2.05, e0), (e0, e1), (e1, W)):
            F.boards(a + 0.075, b - 0.075, 2.41, 3.1, seed=int(a * 10) + 7, mat='wood_dark', battens=False, cap=False, d=s / 2 - 0.025)
        F.boards(0.075, 1.975, 0.29, 0.93, seed=3)
        F.plaster(0.0, 2.05, 0.93, 2.15, holes=[(0.22, 1.83, 0.95, 2.0)])
        F.shoji(0.22, 1.83, 0.95, 2.0, d=-0.02, panels=2, koshi=0.36)
        bm.lattice_door(g, (xf - 0.03, a1 - 0.88, 0.06), EY, EX, 0.88, 2.08)
        room(g, 2.5, xf - 0.05, a0, a1, 2.34, walls='plaster_white#0.3', back='plaster_white#0.26')
        raised_floor(g, 2.5, 4.35, a1 - 0.85, a1, 0.45, edge='-y', seed=5)
        shelf(g, 2.5, a0 + 0.03, a1 - 0.9, (1.15, 1.65), seed=6)
        for (a, b) in ((2.125, e0 - 0.075), (e1 + 0.075, W - 0.075)):
            F.lattice(a, b, 0.29, 2.15, kind='oyako', mat=LAT, pitch=0.125, bar=(0.035, 0.045))
            F.shoji(a, b, 0.29, 2.15, d=-0.06, panels=2, koshi=0.42)
        # 2 階の表
        zs0, zs1 = 3.17, 3.30
        zw0, zw1 = 3.42, 4.28
        zh0, zh1 = 4.33, 4.44
        for u in (2.05, 4.1, 6.15):
            F.post(u, 3.0, kz0)
        F.hbeam(-0.08, W + 0.08, zs0, zs1, w=0.13)
        F.hbeam(-0.08, W + 0.08, zh0, zh1, w=0.12)
        bays = [(0.0, 2.05), (2.05, 4.1), (4.1, 6.15), (6.15, W)]
        wins = []
        for k in (0, 1, 3):
            c = (bays[k][0] + bays[k][1]) / 2
            wins.append((c - 0.86, c + 0.86, zw0, zw1))
        mk = (4.45, 5.8, 3.55, 4.2)
        F.plaster(0.0, W, zs1 - 0.02, kz0, holes=wins + [mk])
        for wn in wins:
            bm.koshi_window(F, *wn)
        F.mushiko(*mk)
        # 妻側（南 Y=0：町家 B との細いすき間、北 Y=W：塀ぎわの路地。北は腰を下見板にして霧除けの小庇）
        for (yw, ns, seed) in ((0.0, -1, 50), (W, 1, 60)):
            S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf, s)
            S.plinth(seed=seed, mat='stone_granite#curb')
            S.sill(0.0, xf)
            for X in (0.0, xf, 1.7, 3.4):
                S.post(X, 0.29, kz0)
            if ns > 0:
                pp.shitami(S, 0.075, xf - 0.075, 0.29, 1.8, seed=seed + 1, battens=0.85)
            else:
                S.boards(0.075, xf - 0.075, 0.29, 1.8, seed=seed + 1)
            S.hbeam(-0.1, xf + 0.1, 2.25, 2.37)
            S.hbeam(-0.1, xf + 0.1, 2.95, 3.12, w=0.13)
            S.hbeam(-0.35, xf + 0.35, kz0, kz1, w=0.15)
            S.post(xr, kz1, zb(xr) - 0.2, s=0.12)
            hw = (zb(xr) - 0.1 - 5.42) / p
            S.hbeam(xr - hw, xr + hw, 5.28, 5.37, w=0.1)
            holes = []
            if ns > 0:
                holes = [(1.95, 2.95, 2.45, 2.88)]
                for hb in holes:
                    S.frame(*hb)
                    S.lattice(*hb, kind='plain', mat='wood_dark', pitch=0.07, bar=(0.022, 0.03), rails=False)
                    S.shoji(*hb, d=-0.05, panels=1)
            S.plaster(0.0, xf, 1.8, lambda u: zb(u) - 0.08, holes=holes)
            if ns > 0:
                with g.solid('kirioke_n', walk=False):
                    pp.kirioke(S, 1.95, 2.95, 3.05, proj=0.4)
        # 裏
        Bw = Wall(g, (0, W, 0), -EY, -EX, W, s)
        Bw.plinth(seed=70, mat='stone_granite#curb')
        Bw.sill(0.0, W)
        for Y in (2.05, 4.1, 6.15):
            Bw.post(W - Y, 0.29, kz0)
        door = (W - 5.9, W - 5.0)
        Bw.boards(0.075, door[0], 0.29, 1.25, seed=71)
        Bw.boards(door[1], W - 0.075, 0.29, 1.25, seed=72)
        Bw.hbeam(-0.1, W + 0.1, 2.25, 2.37)
        Bw.hbeam(-0.1, W + 0.1, 2.95, 3.12, w=0.13)
        win = (W - 1.9, W - 1.2, 1.5, 2.05)
        Bw.plaster(0.0, W, 1.25, kz0, holes=[(door[0], door[1], 0.29, 2.0), win])
        Bw.frame(door[0], door[1], 0.29, 2.0)
        itado(g, Bw.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.71)
        Bw.frame(*win)
        Bw.lattice(*win, kind='plain', mat='wood_dark', pitch=0.07, bar=(0.022, 0.03), rails=False)
        Bw.shoji(*win, d=-0.05, panels=1)

    # 出格子（1 間目）
    with g.solid('degoshi'):
        box(g, 'wood_dark', xf + 0.04, xf + 0.34, 0.14, 1.91, 0.9, 0.95, ch=0.008)
        for yy in (0.32, 1.73):
            beam(g, 'wood_dark', (xf + 0.06, yy, 0.62), (xf + 0.3, yy, 0.88), 0.05, 0.06, ch=0.006)
        box(g, 'wood_dark', xf + 0.04, xf + 0.4, 0.1, 1.95, 2.0, 2.045, ch=0.008)
        Dm = Wall(g, (xf + 0.3, 0, 0), EY, EX, W, s)
        Dm.lattice(0.17, 1.88, 0.95, 2.0, kind='oyako', mat=LAT, d=0.0, pitch=0.13, bar=(0.035, 0.045))
        for yy, nn in ((0.17, -EY), (1.88, EY)):
            Ds = Wall(g, (xf, yy, 0), EX, nn, 0.35, s)
            Ds.lattice(0.06, 0.3, 0.95, 2.0, kind='plain', mat=LAT, d=0.0, pitch=0.06, rails=False, bar=(0.025, 0.03))
    # 入口の踏み石（歩ける）
    stone(g, 'stone_granite#curb', (xf + 0.01, (a0 + a1) / 2, -0.01), (0.36, a1 - a0 - 0.02, 0.15), 47, k=4.0, rough=0.05, flat_top=0.85, n=3)
    xn, zn = xf + s / 2 + 0.25, 2.19
    with g.solid('noren', camera=False):
        noren(g, 'noren_a', (xn, e0 + 0.05, zn), EY, EX, 1.95, 1.75, 3, seed=21, sway=0.03, pole_r=0.015, pole_mat='wood_dark',
              gap=0.025, fold=0.02, fold_top=0.01, nu=13, nv=18)
        for yy in (e0, e1):
            bm.noren_bracket(g, xf + s / 2, xn, yy, zn)
    with g.solid('hisashi', walk=False, camera=True):
        Hs = hisashi(g, xw=xf, face=xf + s / 2, xe=6.25, y0=-0.2, y1=W + 0.2, z0=3.05, p=0.3, seed=200,
                     support=dict(kind='udegi', x=5.92, ys=posts_f), spacing=0.30, rafter=RAF, deck='wood_dark', kaya=KAYA,
                     arm=(0.12, 0.15), arm_proj=0.15, arm_shaped=True)
    # 軒下の三和土と割石（歩ける）
    bm.apron(g, xf + 0.08, 6.02, -0.15, W + 0.15, seed=81, floor='earth_floor#tataki', curb=None)
    bm.split_curb(g, 6.02, -0.15, W + 0.15, seed=81)
    # 店先：4 間目にばったり床几（下ろして品物）、2 間目に樽と籠
    with g.solid('agemise', camera=False):
        pp.agemise(g, xf + s / 2 + 0.04, e1 + 0.2, W - 0.18, depth=0.55, top=0.44, seed=83)
    with g.solid('barrel', camera=False):
        barrel(g, (5.64, 2.45, 0.03), r=0.23, h=0.6, seed=84, lid=False)
    with g.solid('basket', camera=False):
        basket(g, (5.62, 3.05, 0.03), r=0.24, h=0.3, seed=86)
    kit.sag(g, -ov[0], W + ov[1], kz0, 0.035)
    g.eave_zones = [dict(xw=xf, xe=6.25, y0=-0.25, y1=W + 0.25, zb=Hs['zb'], t0=0.68, t1=0.92, soffit=0.22, fade=0.6),
                    dict(xw=xf, xe=xf + of, y0=-ov[0], y1=W + ov[1], zb=zb, t0=0.68, t1=0.92, soffit=0.22, fade=0.6)]
    return g, M, dict(noren_a=noren_material('noren_a', 'yama', 1.95, 1.75))


# ---------------------------------------------------------------------------
# 町家 B（本二階の大店）
# ---------------------------------------------------------------------------

def build_machiya_b28():
    h = BLD['machiya_b28']
    M = placement(h['footprint'], h['front'])
    g = pp.SolidGeo(seed=12)
    W, xf1, xf2, xb, s = 8.0, 5.3, 4.5, 0.0, 0.18
    p, of, ob, ov = 0.5, 1.3, 0.55, (0.42, 0.33)
    He = 5.95
    xr = (xb + xf2) / 2
    zr = He + p * (xf2 + of - xr)
    ys = [0.0, 2.0, 4.0, 6.0, W]
    with g.solid('roof', walk=False, camera=True):
        R = main_roof(g, xb=xb, xf=xf2, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=5, seed=300, keta=(0.18, 0.2),
                      purlins_x=(0.75, xr, 3.75), oni_scale=1.2, gegyo_at=[(-ov[0] - 0.0, -1)], tw=0.3, tl=0.31,
                      front_support=dict(x=5.5, ys=ys, arm=(0.12, 0.16), geta=(0.14, 0.16)))
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf2)
    kz0 = kz1 - 0.2
    fl = 3.62
    with g.solid('body'):
        F2 = Wall(g, (xf2, 0, 0), EY, EX, W, s)
        for u in (2.0, 4.0, 6.0):
            F2.post(u, fl, kz0)
        F2.hbeam(-0.09, W + 0.09, fl, fl + 0.14, w=0.16)
        F2.hbeam(-0.09, W + 0.09, 5.5, 5.63, w=0.14)
        wins = [(a + 0.28, a + 1.72, 4.05, 5.45) for a in (0.0, 2.0, 4.0, 6.0)]
        F2.plaster(0.0, W, fl + 0.14, kz0, holes=wins)
        for (a, b, c, d) in wins:
            F2.frame(a, b, c, d)
            F2.lattice(a, b, c, d, kind='plain', mat='wood_dark', pitch=0.064, bar=(0.022, 0.034), rails=False)
            F2.shoji(a, b, c, d, d=-0.05, panels=2)
        nbd = 6
        for i in range(nbd):
            xa = xf2 + 0.08 + (5.42 - xf2 - 0.08) * i / nbd
            xb2 = xa + (5.42 - xf2 - 0.08) / nbd
            box(g, 'wood_weathered', xa + 0.003, xb2 - 0.003, -0.06, W + 0.06, fl - 0.04, fl, seg_len=1.0)
        box(g, 'wood_dark', 5.4, 5.45, -0.07, W + 0.07, 3.35, fl + 0.01, seg_len=0.8)
        xrail = 5.36
        for k in range(9):
            post(g, 'wood_dark', xrail, W * k / 8, fl, 4.46, s=0.075, ch=0.008)
        beam(g, 'wood_dark', (xrail, -0.05, 4.43), (xrail, W + 0.05, 4.43), 0.08, 0.06, ch=0.012, seg_len=0.8)
        beam(g, 'wood_dark', (xrail, -0.03, fl + 0.07), (xrail, W + 0.03, fl + 0.07), 0.05, 0.05, ch=0.006, seg_len=0.8)
        beam(g, 'wood_dark', (xrail, -0.03, 4.28), (xrail, W + 0.03, 4.28), 0.04, 0.04, ch=0.006, seg_len=0.8)
        nb = int(W / 0.12)
        for i in range(nb):
            yy = W * (i + 0.5) / nb
            if abs((yy / (W / 8)) - round(yy / (W / 8))) * (W / 8) < 0.05:
                continue
            beam(g, 'wood_dark', (xrail, yy, fl + 0.095), (xrail, yy, 4.26), 0.024, 0.03, up=EX, ch=0.0)
        for yy, sg in ((-0.03, -1), (W + 0.03, 1)):
            for xx in (xf2 + 0.1, 4.93):
                post(g, 'wood_dark', xx, yy, fl, 4.46, s=0.07, ch=0.006)
            beam(g, 'wood_dark', (xf2, yy, 4.43), (xrail, yy, 4.43), 0.07, 0.06, ch=0.01)
            beam(g, 'wood_dark', (xf2, yy, fl + 0.07), (xrail, yy, fl + 0.07), 0.05, 0.05, ch=0.006)
            for i in range(1, 8):
                xx = xf2 + (xrail - xf2) * i / 8
                beam(g, 'wood_dark', (xx, yy, fl + 0.095), (xx, yy, 4.26), 0.024, 0.03, up=EY, ch=0.0)
        # 1 階の表
        F = Wall(g, (xf1, 0, 0), EY, EX, W, s)
        F.plinth(0.0, 2.0, seed=31)
        F.sill(0.0, 2.0)
        for u in (2.0, 4.0, 6.0):
            stone(g, 'stone_granite', F.at(u, 0.03, 0.0), (0.38, 0.38, 0.24), 90 + int(u * 10), flat_top=0.9, k=3.0, rough=0.07)
            F.post(u, 0.15, 3.36)
        F.hbeam(-0.1, W + 0.1, 2.3, 2.58, d=0.012, w=0.18)
        F.plaster(0.0, W, 2.58, 3.4)
        F.boards(0.09, 1.91, 0.29, 0.9, seed=32)
        F.lattice(0.09, 1.91, 0.9, 2.3, kind='plain', mat='wood_dark', pitch=0.085, bar=(0.028, 0.045))
        F.shoji(0.09, 1.91, 0.9, 2.3, d=-0.06, panels=2)
        beam(g, 'wood_dark', (xf1 - 0.06, 2.09, 0.5), (xf1 - 0.06, 5.91, 0.5), 0.13, 0.13, ch=0.012, seg_len=0.8)
        Sk = Wall(g, (xf1 - 0.09, 0, 0), EY, EX, W, s)
        Sk.boards(2.09, 5.91, 0.02, 0.43, seed=33, d=0.0, battens=False, cap=False)
        room(g, 3.1, xf1 - 0.1, 2.09, 5.91, 2.62, floor='wood_weathered')
        raised = 0.565
        nbd = 16
        for i in range(nbd):
            ya = 2.09 + (5.91 - 2.09) * i / nbd
            box(g, 'wood_weathered', 3.1, xf1 - 0.12, ya + 0.002, ya + (5.91 - 2.09) / nbd - 0.002, raised - 0.03, raised, seg_len=0.8)
        shelf(g, 3.1, 2.15, 3.95, (1.35, 1.9), seed=34)
        shelf(g, 3.1, 4.05, 5.85, (1.35, 1.9), seed=35)
        for (yy, rr, hh) in ((2.5, 0.2, 0.24), (3.05, 0.17, 0.2), (5.4, 0.22, 0.26)):
            basket(g, (4.7, yy, raised), r=rr, h=hh, seed=int(yy * 10))
        tawara(g, (4.2, 3.9, raised + 0.2), math.pi / 2, seed=36)
        tawara(g, (4.2, 4.55, raised + 0.2), math.pi / 2, seed=37)
        tawara(g, (4.2, 4.22, raised + 0.55), math.pi / 2, seed=38)
        crate(g, (4.9, 4.4, raised), 0.1, 0.45, 0.35, 0.25, seed=39)
        barrel(g, (3.6, 5.3, raised), r=0.2, h=0.45, seed=40)
        box(g, 'stone_granite', xf1 - 0.16, xf1 + 0.2, 6.09, 7.91, -0.05, 0.06, ch=0.012)
        room(g, 2.8, xf1 - 0.05, 6.09, 7.91, 2.62)
        raised_floor(g, 2.8, 4.5, 6.09, 6.8, 0.56, edge='+y', seed=41, step_stone=True)
        shelf(g, 2.8, 7.0, 7.85, (1.2, 1.75), seed=42)
        # 妻側（南 Y=0：入口から見える。腰を下見板、下の窓に霧除け。北 Y=W：町家 A とのすき間）
        for (yw, ns, seed) in ((0.0, -1, 50), (W, 1, 60)):
            S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf1, s)
            S.plinth(seed=seed)
            S.sill(0.0, xf1)
            for X in (0.0, xf2, 1.5, 3.0):
                S.post(X, 0.29, kz0)
            S.post(xf1, 0.29, 3.36)
            zk = 1.3 if ns < 0 else 1.1
            if ns < 0:
                pp.shitami(S, 0.09, xf1 - 0.09, 0.29, zk, seed=seed + 1, battens=0.75)
            else:
                S.boards(0.09, xf1 - 0.09, 0.29, zk, seed=seed + 1)
            S.hbeam(-0.1, xf1 + 0.1, 2.45, 2.58)
            S.hbeam(-0.1, 5.45, 3.45, fl, w=0.16)
            S.hbeam(-0.1, xf2 + 0.1, 4.88, 4.98)
            S.hbeam(-0.38, xf2 + 0.38, kz0, kz1, w=0.18)
            S.post(xr, kz1, zb(xr) - 0.22, s=0.14)
            hw = (zb(xr) - 0.1 - 7.15) / p
            S.hbeam(xr - hw, xr + hw, 7.0, 7.1, w=0.11)
            holes = []
            if ns < 0:
                holes = [(1.7, 2.7, 4.25, 5.1), (2.2, 3.0, 1.45, 2.1)]
                for hb in holes:
                    S.frame(*hb)
                    S.lattice(*hb, kind='grid' if hb[2] > 3 else 'plain', mat='wood_dark', pitch=0.09, bar=(0.022, 0.03), rails=False)
                    S.shoji(*hb, d=-0.05, panels=1)
            S.plaster(0.0, xf2, zk, lambda u: zb(u) - 0.08, holes=holes)
            S.plaster(xf2, xf1, zk, 3.45)
            if ns < 0:
                with g.solid('kirioke_s', walk=False):
                    pp.kirioke(S, 2.2, 3.0, 2.24, proj=0.38)
        # 裏
        Bw = Wall(g, (0, W, 0), -EY, -EX, W, s)
        Bw.plinth(seed=70)
        Bw.sill(0.0, W)
        for Y in (2.0, 4.0, 6.0):
            Bw.post(W - Y, 0.29, kz0)
        door = (W - 6.1, W - 5.2)
        Bw.boards(0.09, door[0], 0.29, 1.1, seed=71)
        Bw.boards(door[1], W - 0.09, 0.29, 1.1, seed=72)
        Bw.hbeam(-0.1, W + 0.1, 2.45, 2.58)
        Bw.hbeam(-0.1, W + 0.1, 3.45, fl, w=0.16)
        Bw.hbeam(-0.1, W + 0.1, 4.88, 4.98)
        wins = [(W - 1.8, W - 1.0, 1.4, 2.0), (W - 3.5, W - 2.5, 4.3, 5.1), (W - 6.0, W - 5.0, 4.3, 5.1)]
        Bw.plaster(0.0, W, 1.1, kz0, holes=[(door[0], door[1], 0.29, 2.05)] + wins)
        Bw.frame(door[0], door[1], 0.29, 2.05)
        itado(g, Bw.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.76)
        for w_ in wins:
            Bw.frame(*w_)
            Bw.lattice(*w_, kind='plain', mat='wood_dark', pitch=0.075, bar=(0.022, 0.03), rails=False)
            Bw.shoji(*w_, d=-0.05, panels=1)
    with g.solid('noren', camera=False):
        noren(g, 'noren_b', (xf1 + 0.15, 6.05, 2.27), EY, EX, 1.9, 1.72, 4, seed=22, sway=0.04)
        for yy in (6.05, 7.95):
            box(g, 'wood_dark', xf1 + 0.08, xf1 + 0.2, yy - 0.03, yy + 0.03, 2.25, 2.32)
    # 庇：独立柱に出桁、柱の間にも繰形の腕木。垂木 0.3 m ごと・濃い軒裏・二重の鼻先
    xd = 6.42
    with g.solid('hisashi', walk=False, camera=True):
        Hs = hisashi(g, xw=xf1, face=xf1 + s / 2 + 0.005, xe=6.75, y0=-0.15, y1=W + 0.15, z0=3.36, p=0.35, seed=400,
                     support=None, spacing=0.3, rafter=(0.065, 0.085), deck='wood_dark', kaya=KAYA)
        zt = Hs['zrb'](xd)
        gw, gh = 0.14, 0.16
        beam(g, 'wood_dark', (xd, -0.13, zt - gh / 2), (xd, W + 0.13, zt - gh / 2), gw, gh, ch=0.012, seg_len=0.8)
        for yy in (0.0, 2.0, 4.0, 6.0, W):
            udegi_arm(g, xf1 - 0.1, xd + gw / 2 + 0.16, yy, zt - gh - 0.14, 0.11, 0.14)
    for k, yy in enumerate((0.0, 4.0, W)):
        with g.solid(f'post{k}'):
            stone(g, 'stone_granite', (xd, yy, 0.03), (0.34, 0.34, 0.26), 400 * 7 + k, flat_top=0.9, k=3.0, rough=0.07)
            post(g, 'wood_dark', xd, yy, 0.15, zt - gh - 0.14, s=0.15)
    # A とのすき間の板塀
    with g.solid('fence_ab'):
        board_fence(g, (5.45, W + 0.08, 0.0), (5.45, W + 0.72, 0.0), 1.85, seed=91)
    bm.apron(g, xf1 + 0.1, 6.58, -0.15, W + 0.15, seed=92)
    # 店先：縁台・樽・籠・置き看板、3 間目の前にひな壇の品台
    with g.solid('bench', camera=False):
        bench(g, (5.86, 1.05, 0.03), math.pi / 2, seed=93)
    with g.solid('barrels', camera=False):
        barrel(g, (5.78, 2.55, 0.03), r=0.24, h=0.62, seed=94)
        barrel(g, (6.14, 2.3, 0.03), r=0.2, h=0.5, seed=95, lid=False)
        basket(g, (5.78, 2.55, 0.65), r=0.18, h=0.2, seed=96)
    with g.solid('basket', camera=False):
        basket(g, (5.75, 3.2, 0.03), r=0.22, h=0.28, seed=97)
    with g.solid('stand', camera=False):
        pp.stepped_stand(g, xf1 + s / 2 + 0.02, 4.25, 5.2, seed=99, steps=((0.5, 0.24), (0.3, 0.48), (0.1, 0.72)))
    with g.solid('kanban', camera=False):
        bm.standing_kanban(g, 6.18, 5.55, facing=EX, seed=98)
    kit.sag(g, -ov[0], W + ov[1], kz0, 0.03)
    g.eave_zones = [dict(xw=xf1, xe=6.75, y0=-0.2, y1=W + 0.2, zb=Hs['zb'], t0=0.7, t1=0.93, soffit=0.2, fade=0.55)]
    return g, M, dict(noren_b=noren_material('noren_b', 'hishi', 1.9, 1.72))


# ---------------------------------------------------------------------------
# 町家 D（一階半の小店。道の東、西向き。家の座標の Y=0 はゲームの北）
# ---------------------------------------------------------------------------

def build_machiya_d28():
    h = BLD['machiya_d28']
    M = placement(h['footprint'], h['front'])
    g = pp.SolidGeo(seed=13)
    W, xf, xb, s = 7.0, 4.8, 0.0, 0.15
    p, of, ob, ov = 0.4, 0.95, 0.45, (0.33, 0.35)
    He = 3.6
    xr = (xb + xf) / 2
    zr = He + p * (xf + of - xr)
    ys = [0.0, 1.15, 2.3, 3.5, 4.7, 5.85, W]
    xd = 5.5
    with g.solid('roof', walk=False, camera=True):
        R = main_roof(g, xb=xb, xf=xf, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=2, seed=500, keta=(0.15, 0.16),
                      purlins_x=(0.8, xr, 4.0), oni_scale=0.9, rafter_spacing=0.3, rafter=(0.06, 0.08), deck='wood_dark',
                      kaya=dict(h=0.11, d=0.065, board=(0.045, 0.035), proud=0.02, top=0.04))
        zrb_ = R['zrb']
        zt = zrb_(xd)
        gw, gh = 0.13, 0.14
        beam(g, 'wood_dark', (xd, -0.25, zt - gh / 2), (xd, W + 0.25, zt - gh / 2), gw, gh, ch=0.012, seg_len=0.8)
        for yy in ys:
            udegi_arm(g, xf - 0.1, xd + gw / 2 + 0.13, yy, zt - gh - 0.13, 0.1, 0.13)
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf)
    kz0 = kz1 - 0.16
    hz = 2.1
    with g.solid('body'):
        F = Wall(g, (xf, 0, 0), EY, EX, W, s)
        F.plinth(skip=[(2.3, 4.7)], seed=11)
        F.sill(0.0, 2.3)
        F.sill(4.7, W)
        for u in (2.3, 4.7):
            stone(g, 'stone_granite', F.at(u, 0.03, 0.0), (0.32, 0.32, 0.24), 140 + int(u * 10), flat_top=0.9, k=3.0, rough=0.07)
            F.post(u, 0.15, kz0)
        F.hbeam(-0.08, W + 0.08, 2.1, 2.32, d=0.012, w=0.15)
        F.hbeam(-0.08, W + 0.08, 3.2, 3.28, d=0.0, w=0.12)
        rw = (2.95, 4.05, 2.55, 3.05)
        F.plaster(0.0, W, 2.32, kz0, holes=[rw])
        F.frame(*rw)
        F.lattice(*rw, kind='plain', mat='wood_weathered', pitch=0.075, bar=(0.03, 0.035), rails=False)
        F.backing(rw[0], rw[1], rw[2], rw[3], d=-0.1, mat='plaster_earth')
        # 1 間目：下の蔀は外して、上の蔀は吊り上げ（下にばったり床几）
        th = math.radians(104)
        Bv = V((math.sin(th), 0, -math.cos(th)))
        hinge = F.at(0.08, hz, 0.1)
        nn = V((math.cos(th), 0, math.sin(th)))
        with g.solid('shitomi', walk=False):
            shitomido(g, hinge, EY, Bv, -nn, 2.14, 0.95)
            tip = hinge + Bv * 0.95
            for yy in (0.45, 1.85):
                a = V((tip.x - 0.05, yy, tip.z))
                beam(g, 'iron', a, V((a.x, yy, zrb(5.5) - 0.13)), 0.014, 0.014, up=EX, ch=0.0)
                torus(g, 'iron', a + EZ * 0.03, 0.025, 0.006, seg=8, segv=3, axis=EY)
        room(g, 2.8, xf - 0.05, 0.075, 2.225, 2.35)
        nbd = 10
        for i in range(nbd):
            ya = 0.075 + (2.225 - 0.075) * i / nbd
            box(g, 'wood_weathered', 2.8, xf - 0.08, ya + 0.002, ya + (2.15 / nbd) - 0.002, 0.58, 0.61, seg_len=0.8)
        shelf(g, 2.8, 0.15, 2.15, (1.35, 1.85), seed=12)
        for (xx, yy, rr) in ((4.2, 0.55, 0.2), (4.25, 1.15, 0.17), (3.6, 1.7, 0.22)):
            basket(g, (xx, yy, 0.61), r=rr, h=0.22, seed=int(yy * 100))
        tawara(g, (3.5, 0.9, 0.81), math.pi / 2, seed=13)
        # 2 間目：板戸（1 枚は閉じ、1 枚は開けて重ねる）
        box(g, 'stone_granite', xf - 0.16, xf + 0.18, 2.375, 4.625, -0.05, 0.06, ch=0.012)
        itado(g, F.at(2.375, 0.06, 0.02), EY, EX, 1.15, 2.03)
        itado(g, F.at(2.45, 0.06, -0.05), EY, EX, 1.1, 2.03)
        room(g, 2.6, xf - 0.1, 2.375, 4.625, 2.35)
        raised_floor(g, 2.6, 4.2, 3.9, 4.625, 0.45, edge='-y', seed=14)
        shelf(g, 2.6, 2.45, 3.8, (1.2, 1.7), seed=15)
        # 3 間目：蔀戸を閉めたまま
        shitomido(g, F.at(4.78, 0.29, 0.02), EY, EZ, EX, W - 0.075 - 4.78, 0.82)
        shitomido(g, F.at(4.78, 1.12, 0.02), EY, EZ, EX, W - 0.075 - 4.78, hz - 1.12)
        F.backing(4.78, W - 0.075, 0.29, hz, d=-0.08, mat='wood_weathered')
        # 妻側（Y=0 はゲームの北＝休み場の側、Y=W は南＝路地）。南は腰を下見板に、北は縦の板
        for (yw, ns, seed) in ((0.0, -1, 150), (W, 1, 160)):
            S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf, s)
            S.plinth(seed=seed)
            S.sill(0.0, xf)
            for X in (0.0, xf, 1.6, 3.2):
                S.post(X, 0.29, kz0)
            if ns > 0:
                pp.shitami(S, 0.075, xf - 0.075, 0.29, 1.5, seed=seed + 1, battens=0.8)
            else:
                S.boards(0.075, xf - 0.075, 0.29, 1.5, seed=seed + 1, bw=0.21)
            S.hbeam(-0.1, xf + 0.1, 2.15, 2.25)
            S.hbeam(-0.33, xf + 0.33, kz0, kz1, w=0.15)
            S.post(xr, kz1, zb(xr) - 0.2, s=0.12)
            holes = [(2.0, 2.8, 3.98, 4.38)] if ns < 0 else [(1.2, 2.0, 1.65, 2.1)]
            for hb in holes:
                S.frame(*hb)
                S.lattice(*hb, kind='grid', mat='wood_dark', pitch=0.09, bar=(0.022, 0.03), rails=False)
                S.backing(*hb, d=-0.08, mat='plaster_earth')
            S.plaster(0.0, xf, 1.5, lambda u: zb(u) - 0.08, holes=holes, mat='plaster_earth')
            if ns > 0:
                with g.solid('kirioke_s', walk=False):
                    pp.kirioke(S, 1.2, 2.0, 2.24, proj=0.36)
        # 裏
        Bw = Wall(g, (0, W, 0), -EY, -EX, W, s)
        Bw.plinth(seed=170)
        Bw.sill(0.0, W)
        for Y in (1.75, 3.5, 5.25):
            Bw.post(W - Y, 0.29, kz0)
        door = (W - 5.0, W - 4.2)
        Bw.boards(0.075, door[0], 0.29, 1.5, seed=171, bw=0.21)
        Bw.boards(door[1], W - 0.075, 0.29, 1.5, seed=172, bw=0.21)
        Bw.hbeam(-0.1, W + 0.1, 2.15, 2.25)
        win = (W - 2.6, W - 1.8, 1.7, 2.15)
        Bw.plaster(0.0, W, 1.5, kz0, holes=[(door[0], door[1], 0.29, 1.95), win], mat='plaster_earth')
        Bw.frame(door[0], door[1], 0.29, 1.95)
        itado(g, Bw.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.66)
        Bw.frame(*win)
        Bw.lattice(*win, kind='plain', mat='wood_dark', pitch=0.07, bar=(0.022, 0.03), rails=False)
        Bw.backing(*win, d=-0.08, mat='plaster_earth')
    # 城の塀の端とのすき間の板塀（ゲームの x 7.0〜8.2、z 2.95〜3.8）
    with g.solid('fence_n'):
        board_fence(g, (2.0, -0.78, 0.0), (2.0, -0.08, 0.0), 2.3, seed=191)
    bm.apron(g, xf + 0.08, 5.42, -0.1, W + 0.1, seed=192)
    # 1 間目のばったり床几（上げた蔀の下）
    with g.solid('agemise', camera=False):
        pp.agemise(g, xf + s / 2 + 0.02, 0.12, 2.2, depth=0.5, top=0.42, seed=193)
    # 2 間目の入口に半暖簾（町家 A の暖簾の画像の、紋の無い裾の所だけを写す）
    with g.solid('noren', camera=False):
        xn = xf + s / 2 + 0.16
        noren(g, 'noren_d', (xn, 2.42, 2.06), EY, EX, 2.16, 0.78, 3, seed=23, sway=0.02, pole_r=0.016, pole_mat='wood_dark',
              gap=0.02, fold=0.016, fold_top=0.008, nu=11, nv=9)
        uv = g.parts['noren_d']['uv']
        g.parts['noren_d']['uv'] = [(u_, v_ * 0.38) for (u_, v_) in uv]
        for yy in (2.42, 4.58):
            bm.noren_bracket(g, xf + s / 2, xn, yy, 2.06)
    with g.solid('barrel', camera=False):
        barrel(g, (5.15, 6.45, 0.03), r=0.21, h=0.55, seed=196)
    with g.solid('goods', camera=False):
        basket(g, (5.13, 5.85, 0.03), r=0.2, h=0.25, seed=197)
        crate(g, (5.12, 5.3, 0.03), 0.05, 0.4, 0.4, 0.3, seed=198)
        crate(g, (5.12, 5.3, 0.36), -0.08, 0.34, 0.34, 0.24, seed=199)
    bm.hang_kanban(g, 5.28, 4.7, 3.02, w=0.4, h=0.72, axis=EX, hook_z=zrb(5.5) - 0.13 - 0.12)
    kit.sag(g, -ov[0], W + ov[1], kz0, 0.045)
    g.eave_zones = [dict(xw=xf, xe=xf + of, y0=-ov[0], y1=W + ov[1], zb=zb, t0=0.7, t1=0.92, soffit=0.2, fade=0.55)]
    return g, M, dict(noren_d=noren_material('noren_a', 'yama', 1.95, 1.75))


# ---------------------------------------------------------------------------
# 土蔵造りの店（妻入り。架空）：Version 27 の町家 D の鏡写しの代わり
#   家の座標：X は間口（0 が北の端 z0 → Wf が南の端）、Y は奥行き（0 が通りに面した表 x0 → D が裏）。表の妻は −Y を向く
# ---------------------------------------------------------------------------

def kura_roof(g, Wf, D, He, p, of, ovg, seed):
    """
    土蔵の屋根：桟瓦の 2 面（棟は Y に沿う）、のし瓦の棟と鬼瓦、塗籠の軒（漆喰の段の軒裏）、塗籠の破風、懸魚。
    He は壁の上端（軒の付け根の下）、of は軒の出（X の両側）、ovg はけらばの出（Y の両側）。
    """
    xr = Wf / 2
    a = math.atan(p)
    ca, sa = math.cos(a), math.sin(a)
    t_eave = 0.42                     # 軒の付け根の厚み（漆喰の段の高さ）
    zr = He + t_eave + p * xr          # 瓦の下地の棟の高さ

    def zb(X):
        return zr - p * abs(X - xr)
    y0, y1 = -ovg, D + ovg
    for side in (1, -1):
        x_edge = Wf + of if side > 0 else -of
        Dd = V((side * ca, 0, -sa))
        N = V((side * sa, 0, ca))
        length = abs(x_edge - xr) / ca
        tile_field(g, V((xr, y0, zr)), EY, Dd, N, y1 - y0, length, tw=0.28, tl=0.29, seed=seed + (1 if side > 0 else 2), top_skip=0.1)
        # 塗籠の軒：壁の上から軒先へ、3 段の漆喰（下ほど壁へ寄る）。上面は瓦の下地に沿う
        x_wall = Wf if side > 0 else 0.0
        tiers = [(0.0, 0.16, He - 0.02), (0.16, 0.3, He + 0.12), (0.3, of, He + 0.24)]
        for (d0, d1, zbot) in tiers:
            xa, xb_ = x_wall + side * d0, x_wall + side * d1
            za, zb2 = zb(xa) - 0.07, zb(xb_) - 0.07
            ya, yb = y0 + 0.04, y1 - 0.04
            verts = [V((xa, ya, zbot)), V((xb_, ya, zbot)), V((xb_, ya, zb2)), V((xa, ya, za)),
                     V((xa, yb, zbot)), V((xb_, yb, zbot)), V((xb_, yb, zb2)), V((xa, yb, za))]
            faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            g.convex('plaster_white#kura', verts, faces)
    # 塗籠の破風（妻の両側、勾配に沿う厚い漆喰）と、けらばの軒裏
    for (yv, sg) in ((y0, -1), (y1, 1)):
        for side in (1, -1):
            x_edge = Wf + of if side > 0 else -of
            pa = V((xr, yv + sg * 0.02, zb(xr) - 0.2))
            pb = V((x_edge + side * 0.04, yv + sg * 0.02, zb(x_edge) - 0.2))
            beam(g, 'plaster_white#kura', pa, pb, 0.16, 0.34, up=EZ, ch=0.03, seg_len=0.7)
        yw = 0.0 if sg < 0 else D
        ya, yb = sorted((yw, yv))
        for side in (1, -1):
            xs = [xr + side * (Wf / 2 + of) * k / 3 for k in range(4)]
            for i in range(3):
                xa, xb_ = xs[i], xs[i + 1]
                za, zb2 = zb(xa) - 0.36, zb(xb_) - 0.36
                verts = [V((xa, ya, za)), V((xb_, ya, zb2)), V((xb_, yb, zb2)), V((xa, yb, za))]
                g.oriented('plaster_white#kura', verts, [(0, 1, 2, 3)], -EZ)
    ztop = ridge(g, (xr, y0 - 0.05, zr), (xr, y1 + 0.05, zr), zr, p, 4, seed + 9, oni_scale=1.0)
    gegyo(g, (xr, y0 - 0.06, zr - 0.38), -1, s=1.15)
    return dict(zb=zb, zr=zr, ztop=ztop, y0=y0, y1=y1)


def kura_matrix(fp):
    """家の座標 → Blender の世界：X → ゲームの +z（南）、Y → ゲームの +x（東）。表（Y=0）がゲームの x0"""
    return Matrix.Translation((fp['x0'], -fp['z0'], 0.0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')


def nawa_noren(g, x0, x1, y, z_top, length, *, seed=0, pitch=0.045):
    """縄暖簾：竿から藁の縄を並べて垂らす（下ほど少しばらける・長さのむら）"""
    rng = np.random.default_rng(seed)
    cylinder(g, 'wood_dark', (x0 - 0.1, y, z_top), (x1 + 0.1, y, z_top), 0.017, seg=8)
    n = max(4, int(round((x1 - x0) / pitch)))
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        ln = length * rng.uniform(0.9, 1.02)
        a = V((x, y, z_top - 0.02))
        b = V((x + rng.normal(0, 0.012), y + rng.normal(0, 0.01) - 0.01, z_top - ln))
        beam(g, 'straw#rope', a, b, 0.016, 0.016, up=EY, ch=0.0)
        if i % 2 == 0:
            torus(g, 'straw#rope', b + EZ * 0.04, 0.014, 0.006, seg=5, segv=3)


def build_kura28():
    h = BLD['kura28']
    fp = h['footprint']
    M = kura_matrix(fp)
    g = pp.SolidGeo(seed=14)
    Wf, D, s = fp['z1'] - fp['z0'], fp['x1'] - fp['x0'], 0.28
    He = 4.5
    p, of, ovg = 0.55, 0.45, 0.42
    PL = 'plaster_white#kura'
    with g.solid('roof', walk=False, camera=True):
        Rk = kura_roof(g, Wf, D, He, p, of, ovg, seed=600)
    zb = Rk['zb']
    hz1 = 2.62                          # 1 階の表の開口の上（楣）
    with g.solid('body'):
        # 表（Y=0、−Y を向く妻）
        F = Wall(g, (0, 0, 0), EX, -EY, Wf, s)
        F.plinth(seed=601, mat='stone_granite')
        # 1 階：両端の厚い漆喰の袖と、真ん中の柱。北の間は入口（縄暖簾）、南の間は格子と腰板
        pw = 0.34
        u_mid = 1.5
        ce = s / 2 - 0.03                  # 漆喰の面（壁の芯から）。角は隣の壁の面まで伸ばしてすき間を作らない
        for (ua, ub) in ((-s / 2, pw), (Wf - pw, Wf + s / 2)):
            box(g, PL, ua, ub, -s / 2 - 0.02, s / 2, 0.16, hz1 + 0.05, ch=0.02)
        F.sill(pw, Wf - pw, z=0.12, h=0.12)
        F.post(u_mid, 0.24, hz1)
        F.hbeam(pw - 0.04, Wf - pw + 0.04, hz1 - 0.24, hz1, d=0.02, w=0.2)
        F.boards(u_mid + 0.08, Wf - pw, 0.24, 0.62, seed=602)
        F.lattice(u_mid + 0.08, Wf - pw, 0.62, hz1 - 0.24, kind='plain', mat='wood_dark', pitch=0.075, bar=(0.03, 0.045))
        F.shoji(u_mid + 0.08, Wf - pw, 0.62, hz1 - 0.24, d=-0.08, panels=2)
        # 入口の奥（土間）
        x0i, x1i = pw, u_mid - 0.07
        quad_grid(g, 'earth_floor#tataki', (x0i, 0.0, 0.07), EX, EY, 0, x1i - x0i, 0, 2.4, EZ, step=0.4)
        for (xx, nn) in ((x0i, EX), (x1i, -EX)):
            quad_grid(g, 'plaster_white#0.5', (xx, 0.0, 0.0), EY, EZ, 0, 2.4, 0, hz1, nn, step=0.4)
        quad_grid(g, 'plaster_white#0.35', (x0i, 2.4, 0.0), EX, EZ, 0, x1i - x0i, 0, hz1, -EY, step=0.4)
        quad_grid(g, 'wood_weathered', (x0i, 0.0, hz1 - 0.02), EX, EY, 0, x1i - x0i, 0, 2.4, -EZ, step=0.5)
        for (yy, rr) in ((1.6, 0.2), (2.05, 0.17)):
            basket(g, (x0i + 0.3, yy, 0.07), r=rr, h=0.24, seed=int(yy * 10) + 603)
        barrel(g, (x1i - 0.28, 2.0, 0.07), r=0.2, h=0.5, seed=604)
        # 2 階：漆喰の壁に観音開きの土扉の窓（鉄格子）
        wu0, wu1, wz0, wz1 = Wf / 2 - 0.42, Wf / 2 + 0.42, 3.2, 3.85
        F.plaster(-ce, Wf + ce, hz1, lambda u: zb(u) - 0.08, holes=[(wu0, wu1, wz0, wz1)], mat=PL)
        # 腰の海鼠壁（表の袖）
        for (ua, ub) in ((-s / 2, pw), (Wf - pw, Wf + s / 2)):
            pp.namako(Wall(g, (0, -0.02, 0), EX, -EY, Wf, s), ua + 0.02, ub - 0.02, 0.22, 1.25, cell=0.17)
        # 窓の額縁（2 段の漆喰：内の段は深く、外の段は浅く）と鉄格子・奥の板戸
        yf = -s / 2 + 0.03
        for (b0, b1, dd) in ((0.0, 0.07, 0.12), (0.07, 0.17, 0.06)):
            ua0, ua1, ub0, ub1 = wu0 - b1, wu0 - b0, wu1 + b0, wu1 + b1
            za0, za1, zb0, zb1 = wz0 - b1, wz0 - b0, wz1 + b0, wz1 + b1
            box(g, PL, ua0, ub1, yf - dd, yf, za0, za1, ch=0.012)
            box(g, PL, ua0, ub1, yf - dd, yf, zb0, zb1, ch=0.012)
            box(g, PL, ua0, ua1, yf - dd, yf, za1, zb0, ch=0.012)
            box(g, PL, ub0, ub1, yf - dd, yf, za1, zb0, ch=0.012)
        for i in range(1, 5):
            u = wu0 + (wu1 - wu0) * i / 5
            beam(g, 'iron', (u, -0.06, wz0), (u, -0.06, wz1), 0.022, 0.022, up=EY, ch=0.0)
        quad_grid(g, 'wood_dark', (wu0, 0.06, wz0), EX, EZ, 0, wu1 - wu0, 0, wz1 - wz0, -EY, step=0.4)
        for (u_a, u_b, z_a, z_b) in ((wu0, wu1, wz0, wz0), (wu0, wu1, wz1, wz1)):
            quad_grid(g, PL, (wu0, -0.06, z_a), EX, EY, 0, wu1 - wu0, 0, 0.12, EZ if z_a == wz0 else -EZ, step=0.4)
        for uu, nn in ((wu0, EX), (wu1, -EX)):
            quad_grid(g, PL, (uu, -0.06, wz0), EY, EZ, 0, 0.12, 0, wz1 - wz0, nn, step=0.4)
        # 観音開きの土扉（厚い漆喰の扉。開いて外へ 100°、外の段のすぐ外に吊る）
        with g.solid('window_doors', walk=False):
            for (uh, sg) in ((wu0 - 0.17, -1), (wu1 + 0.17, 1)):
                ang = math.radians(100)
                A_ = V((-sg * math.cos(ang), -math.sin(ang), 0))
                n_ = V((-A_.y, A_.x, 0))
                hinge = V((uh, yf - 0.07, (wz0 + wz1) / 2))
                c = hinge + A_ * 0.23
                obox(g, PL, c, EZ, A_, n_, (wz1 - wz0) / 2 + 0.12, 0.23, 0.06, ch=0.02)
                obox(g, PL, c + n_ * 0.07 * sg, EZ, A_, n_, (wz1 - wz0) / 2 + 0.03, 0.16, 0.02, ch=0.01)
                for zz in (wz0 - 0.02, wz1 + 0.02):
                    beam(g, 'iron', V((uh, yf - 0.02, zz)), V((uh, yf - 0.09, zz)), 0.03, 0.03, up=EZ, ch=0.0)
        # 鉢巻（壁の上の厚い漆喰の帯）：妻の表
        with g.solid('hachimaki_f', walk=False):
            F.hbeam(-0.05, Wf + 0.05, He - 0.32, He - 0.12, d=0.06, w=s + 0.08, mat=PL)
        # 側面（北 X=0 は路地、南 X=Wf）：腰は海鼠壁、上は漆喰。北は 2 階に小さな窓と土戸
        for (xw, nx, seed) in ((0.0, -1, 610), (Wf, 1, 620)):
            S = Wall(g, (xw, 0, 0), EY, V((nx, 0, 0)), D, s)
            S.plinth(seed=seed, mat='stone_granite')
            pp.namako(S, s / 2 + 0.02, D + s / 2 + 0.008, 0.24, 1.3, cell=0.24, seed=seed)
            holes = [(3.2, 3.8, 3.1, 3.6)] if nx < 0 else []
            S.plaster(-ce, D + ce, 1.3, He + 0.02, holes=holes, mat=PL)
            for hb in holes:
                S.frame(*hb, mat=PL, w=0.08, d=0.1)
                S.backing(*hb, d=-0.06, mat='wood_dark')
                for i in range(1, 4):
                    u = hb[0] + (hb[1] - hb[0]) * i / 4
                    pnt = S.at(u, 0, s / 2 - 0.01)
                    beam(g, 'iron', (pnt.x, pnt.y, hb[2]), (pnt.x, pnt.y, hb[3]), 0.02, 0.02, up=S.n, ch=0.0)
            # 壁の上の鉢巻と、壁を留める鉄の折れ釘（軒の下。上の張り出しは別の箱）
            with g.solid(f'hachimaki{seed}', walk=False):
                S.hbeam(-0.05, D + 0.05, He - 0.32, He - 0.12, d=0.06, w=s + 0.08, mat=PL)
                for i in range(4):
                    pnt = S.at(0.7 + i * (D - 1.4) / 3, He - 0.5, s / 2 + 0.06)
                    beam(g, 'iron', pnt, pnt + S.n * 0.12, 0.02, 0.02, up=EZ, ch=0.0)
        # 裏（Y=D）：漆喰と海鼠壁、板戸の勝手口
        Bk = Wall(g, (Wf, D, 0), -EX, EY, Wf, s)
        Bk.plinth(seed=630, mat='stone_granite')
        door = (0.9, 1.75)
        pp.namako(Bk, -s / 2 - 0.008, door[0] - 0.05, 0.24, 1.3, cell=0.24, seed=631)
        pp.namako(Bk, door[1] + 0.05, Wf + s / 2 + 0.008, 0.24, 1.3, cell=0.24, seed=632)
        Bk.plaster(-ce, Wf + ce, 1.3, lambda u: zb(Wf - u) - 0.08, holes=[(door[0], door[1], 1.3, 1.95)], mat=PL)
        Bk.plaster(door[0] - 0.05, door[0], 0.24, 1.3, mat=PL)
        Bk.plaster(door[1], door[1] + 0.05, 0.24, 1.3, mat=PL)
        Bk.frame(door[0], door[1], 0.24, 1.95)
        itado(g, Bk.at(door[0], 0.24, 0.0), -EX, EY, door[1] - door[0], 1.71)
        with g.solid('hachimaki_b', walk=False):
            Bk.hbeam(-0.05, Wf + 0.05, He - 0.32, He - 0.12, d=0.06, w=s + 0.08, mat=PL)
    # 表の庇（瓦。腕木と出桁）：X 方向に作る kit.hisashi を、表（−Y）へ向けて写す
    with g.solid('hisashi', walk=False, camera=True):
        tmp = pp.SolidGeo(seed=607)
        hisashi(tmp, xw=0.0, face=s / 2, xe=s / 2 + 0.88, y0=-0.12, y1=Wf + 0.12, z0=hz1 + 0.33, p=0.32, seed=606,
                support=dict(kind='udegi', x=s / 2 + 0.66, ys=[pw / 2, u_mid, Wf - pw / 2]), spacing=0.3, rafter=(0.06, 0.08),
                deck='wood_dark', kaya=dict(h=0.1, d=0.06, board=(0.045, 0.035), proud=0.02, top=0.04),
                arm=(0.1, 0.13), arm_proj=0.13, arm_shaped=True)
        Rm = Matrix(((0, 1, 0), (-1, 0, 0), (0, 0, 1)))      # tmp の X → −Y、tmp の Y → X
        add_rotated(g, tmp, Rm)
    # 入口の縄暖簾
    with g.solid('noren', camera=False):
        nawa_noren(g, pw + 0.04, u_mid - 0.1, -s / 2 - 0.12, hz1 - 0.3, 1.05, seed=608)
    # 南の間の前のばったり床几（−Y へ倒す）。品物
    with g.solid('agemise', camera=False):
        tmp = pp.SolidGeo(seed=609)
        pp.agemise(tmp, 0.0, u_mid + 0.12, Wf - pw - 0.06, depth=0.52, top=0.42, seed=609)
        add_rotated(g, tmp, Matrix(((0, 1, 0), (-1, 0, 0), (0, 0, 1))), T=(0.0, -s / 2 - 0.04, 0.0))
    # 表の犬走り（三和土）と割石、雨落ちの砂利（表・北・南）
    quad_grid(g, 'earth_floor#tataki', (-0.1, -0.92, 0.055), EX, EY, 0, Wf + 0.2, 0, 0.92 - s / 2, EZ, step=0.4)
    tmp = pp.SolidGeo(seed=611)
    bm.split_curb(tmp, 0.0, -0.1, Wf + 0.1, seed=611)
    add_rotated(g, tmp, Matrix(((0, 1, 0), (-1, 0, 0), (0, 0, 1))), T=(0.0, -0.92 + 0.0, 0.03))
    pp.drip_line(g, -0.1, Wf + 0.1, -1.2, -0.96, seed=612, axis='x', edge='lo')
    pp.drip_line(g, -0.62, -0.36, -0.3, D + 0.3, seed=613, edge='lo')
    pp.drip_line(g, Wf + 0.22, Wf + 0.42, -0.3, D + 0.3, seed=614, edge='hi')
    return g, M, {}


# ---------------------------------------------------------------------------
# 西の空き地の縁：石置き板葺きの小屋掛けの店と、物見櫓の前の板塀
#   家の座標：X は奥行き（0 が西の裏、表 X=xf が通りの側）、Y は間口（0 が南の端 z1、増えると北）
# ---------------------------------------------------------------------------

def build_nishi28():
    h = BLD['nishi28']
    fp = h['footprint']
    M = placement(fp, h['front'])
    g = pp.SolidGeo(seed=15)
    xf = fp['x1'] - fp['x0']
    W = fp['z1'] - fp['z0']
    s = 0.1
    z_front, z_back = 2.02, 2.58
    with g.solid('body'):
        # 柱（石の上）と桁
        for (X, Y) in ((0.06, 0.06), (0.06, W - 0.06), (xf - 0.07, 0.06), (xf - 0.07, W - 0.06)):
            stone(g, 'stone_granite', (X, Y, 0.02), (0.26, 0.26, 0.18), int(X * 100 + Y * 10) + 700, flat_top=0.9, k=3.0, rough=0.08)
            zt = z_front if X > 1 else z_back
            post(g, 'wood_aged', X, Y, 0.1, zt, s=0.11, ch=0.01)
        beam(g, 'wood_aged', (xf - 0.07, -0.12, z_front - 0.06), (xf - 0.07, W + 0.12, z_front - 0.06), 0.11, 0.12, ch=0.012)
        beam(g, 'wood_aged', (0.06, -0.12, z_back - 0.06), (0.06, W + 0.12, z_back - 0.06), 0.11, 0.12, ch=0.012)
        # 裏と両側の壁：腰から下見板、上は板（屋根の勾配に沿う）
        pz = (z_back - z_front) / (xf - 0.13)
        Bk = Wall(g, (0.0, W, 0), -EY, -EX, W, s)
        pp.shitami(Bk, 0.03, W - 0.03, 0.12, z_back - 0.12, seed=701, battens=0.6)
        for (yw, ns, seed) in ((0.0, -1, 702), (W, 1, 703)):
            S = Wall(g, (0.0, yw, 0), EX, V((0, ns, 0)), xf, s)
            pp.shitami(S, 0.03, xf - 0.4, 0.12, 1.55, seed=seed, battens=0.55)
            S.plaster(0.03, xf - 0.4, 1.55, lambda u: z_back - 0.1 - pz * u, mat='wood_weathered', d=s / 2 + 0.01)
            beam(g, 'wood_aged', S.at(xf - 0.38, 0.8, s / 2), S.at(xf - 0.38, z_front - 0.1, s / 2), 0.06, 0.06, up=EZ, ch=0.006)
        # 土間・奥の棚と品物
        quad_grid(g, 'earth_floor#tataki', (0.05, 0.05, 0.06), EX, EY, 0, xf - 0.1, 0, W - 0.1, EZ, step=0.4)
        shelf(g, 0.08, 0.15, W - 0.15, (0.85, 1.4), depth=0.32, seed=704)
        barrel(g, (0.55, 0.35, 0.06), r=0.2, h=0.48, seed=705)
        basket(g, (0.62, W - 0.35, 0.06), r=0.22, h=0.28, seed=706)
        crate(g, (1.0, W - 0.4, 0.06), 0.15, 0.36, 0.4, 0.3, seed=707)
        # 表の下の框（腰の高さの板）
        beam(g, 'wood_aged', (xf - 0.07, 0.06, 0.32), (xf - 0.07, W - 0.06, 0.32), 0.08, 0.1, ch=0.008)
    with g.solid('roof', walk=False, camera=True):
        # 垂木（軒の下に見える）と石置きの板葺き（表へ下がる片流れ。表の軒の出 0.62、裏 0.3）
        x_lo, x_hi = xf + 0.62, -0.3
        z_lo = z_front - pz * 0.62
        z_hi = z_back + pz * 0.3
        for k in range(5):
            yy = -0.1 + (W + 0.2) * k / 4
            beam(g, 'wood_aged', (x_hi, yy, z_hi - 0.02), (x_lo, yy, z_lo - 0.02), 0.06, 0.07, up=V((pz, 0, 1)).normalized(), ch=0.006)
        pp.stone_roof(g, x_lo, x_hi, -0.22, W + 0.22, z_lo + 0.03, z_hi + 0.03, seed=708, rows=4)
        # 鼻隠しの板
        beam(g, 'wood_weathered', (x_lo, -0.24, z_lo - 0.01), (x_lo, W + 0.24, z_lo - 0.01), 0.025, 0.1, ch=0.004)
        pp.sudare_roll(g, xf + 0.05, 0.08, W - 0.08, z_front - 0.2)
    with g.solid('agemise', camera=False):
        pp.agemise(g, xf - 0.02, 0.16, W - 0.16, depth=0.5, top=0.46, seed=709)
    # 雨落ち（表の軒の線の下）
    pp.drip_line(g, xf + 0.5, xf + 0.74, -0.25, W + 0.25, seed=710, edge='hi')
    # 物見櫓の前の板塀（2 間。ゲームの x、z を家の座標へ）
    fn = h['fence']
    fx = fn['x'] - fp['x0']
    fy0, fy1 = fp['z1'] - fn['z0'], fp['z1'] - fn['z1']
    fm = (fy0 + fy1) / 2
    for k, (ya, yb) in enumerate(((fy0, fm), (fm, fy1))):
        with g.solid(f'fence{k}'):
            board_fence(g, (fx, ya, 0.0), (fx, yb, 0.0), fn['h'], seed=711 + k)
    return g, M, {}


BUILDERS = {
    'machiya_a28': build_machiya_a28,
    'machiya_b28': build_machiya_b28,
    'machiya_d28': build_machiya_d28,
    'kura28': build_kura28,
    'nishi28': build_nishi28,
}
# 町家 A・B・D は地面に穴（Version 27 の ground_v2 が家の足元を抜いている）があるので、下に土の塊を置く。新しい 2 棟は穴の無い地面の上
EARTH_UNDER = {'machiya_a28', 'machiya_b28', 'machiya_d28'}
AO = {'machiya_a28': dict(distance=0.35, strength=0.55)}


def part_tris(g):
    out = {}
    for k, p in g.parts.items():
        out[k] = sum(len(f) - 2 for f in p['f'])
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def build_one(bid, preview=True, samples=48, bake=True):
    fn = BUILDERS[bid]
    t0 = time.time()
    reset()
    g, M, custom = fn()
    custom.update(bm.common_custom())
    if bid in EARTH_UNDER:
        lo = np.array([tuple(v) for p in g.parts.values() for v in p['v'] if v.z < 0.35])
        box(g, 'earth_floor', lo[:, 0].min() - 0.1, lo[:, 0].max() + 0.1, lo[:, 1].min() - 0.1, lo[:, 1].max() + 0.1, -0.9, -0.01)
    solids = pp.solid_boxes(g, M)
    pt = part_tris(g)
    print(bid, 'local tris', g.tris(), 'top parts', list(pt.items())[:8], flush=True)
    objs = kit.to_objects(g, M, bid, custom)
    kit.finish_objects(objs, seed=zlib.crc32(bid.encode()) % 1000)   # 色むらの種（実行ごとに変わらない）
    tris = triangles(objs)
    print(bid, 'tris after densify', tris, flush=True)
    before = kit.snapshot_colors(objs)
    if bake:
        kit.bake(objs, samples=samples, **AO.get(bid, {}))
        kit.ao_lift(objs, before, ('wood_dark#bengara', 'wood_dark#koshi', 'wood_bengara', 'straw#rope'))
        kit.ao_lift(objs, before, ('paper_shoji',), keep=0.6)
        zones = getattr(g, 'eave_zones', None)
        if zones:
            kit.eave_shade(objs, M, zones, before)
    pp.base_grime(objs, M, seed=len(bid))
    # 雨落ちの砂利は、地面（ground_v2）と同じ JPEG（scene/ground_tex.py の to_jpeg、品質 80）を使う：同じ画像は公開の書き出しでまとまる
    gtx.jpeg_materials({s.material for ob in objs if ob.get('koto_lib') == 'gravel' for s in ob.material_slots})
    for ob in objs:
        ob['koto_house'] = bid
    size = export_glb(MODELS_DIR / f'{bid}.glb', objs)
    print(bid, 'glb', size, 'bytes', f'{time.time() - t0:.0f}s', flush=True)
    colliders = [s['walk_box'] for s in solids if s['walk']]
    blockers = [{k: b[k] for k in ('x0', 'x1', 'y0', 'y1', 'z0', 'z1')} for s in solids for b in s['camera_boxes']]
    h = BLD[bid]
    kit.write_meta(HERE / f'{bid}.meta.json', bid, colliders, blockers,
                   extra=dict(_about='当たり判定（colliders）・カメラ除け（camera_blockers）は、制作で固い物の印を付けた部品（solids）の頂点の箱。'
                                     '手で書いた値ではない（street28/build_street28.py が書き出す）。',
                              footprint=h['footprint'], front=h['front'], solids=solids, triangles=tris, glb_bytes=size))
    if preview:
        previews(bid, samples=16 if samples < 48 else 24)
    return tris, size


# 確認用の描画（ゲームの座標：カメラ, 見る点）
VIEWS = {
    'machiya_a28': [('street', (-1.0, 1.6, -3.0), (-5.5, 2.0, -5.5)), ('eave', (-2.6, 1.7, -2.0), (-5.0, 3.0, -4.0)),
                    ('north', (-2.2, 2.0, -11.0), (-7.0, 2.0, -9.4))],
    'machiya_b28': [('street', (-0.6, 1.7, 9.5), (-5.5, 2.4, 4.0)), ('shop', (-1.8, 1.7, 3.6), (-5.4, 1.2, 4.6)),
                    ('eave', (-2.6, 1.7, 3.0), (-5.0, 3.3, 3.5))],
    'machiya_d28': [('street', (0.6, 1.7, 2.0), (5.0, 1.6, 6.0)), ('shop', (2.3, 1.6, 5.0), (4.6, 1.0, 5.0)),
                    ('alley', (2.0, 1.7, 13.0), (7.5, 2.0, 11.0))],
    'kura28': [('street', (0.5, 1.7, 11.0), (4.5, 2.6, 14.3)), ('front', (1.2, 1.6, 14.3), (4.4, 2.3, 14.3)),
               ('alley', (1.8, 1.8, 11.6), (8.0, 2.2, 12.5)), ('south', (0.0, 2.4, 17.5), (6.0, 2.5, 15.5))],
    'nishi28': [('street', (-1.2, 1.7, 8.5), (-5.2, 1.4, 11.5)), ('front', (-2.2, 1.6, 10.4), (-5.5, 1.2, 10.4)),
                ('fence', (-1.5, 1.8, 12.0), (-5.0, 1.2, 15.0))],
}


def previews(bid, which=None, samples=24):
    kit.preview_ground()
    mats.game_lights()
    for (tag, cam, tgt) in VIEWS[bid]:
        if which and tag not in which:
            continue
        kit.render(PREVIEW / f'{bid}-{tag}.png', cam, tgt, samples=samples)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    keys = args or list(BUILDERS)
    for k in keys:
        build_one(k, preview='--no-preview' not in sys.argv, samples=16 if '--fast' in sys.argv else 48, bake='--no-bake' not in sys.argv)
