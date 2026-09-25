"""
町家 3 棟（machiya_a / machiya_b / machiya_d）を作って GLB と当たり判定の JSON を書き出す。
    /root/blender-venv/bin/python proto3d/blender/machiya/build_machiya.py [a] [b] [d] [--no-preview] [--fast]
- 置き場所・間口・向きは scene.json の houses（ゲームの座標でそのままの位置に作る。ゲームは原点に置くだけ）
- 3 棟は同じ形の左右反転ではなく、軒の高さ・奥行き・勾配・店先を変える
  A: つし二階（低い二階）。軒 4.6。1 階は暗い弁柄の親子格子と出格子、表から 0.25 m 前の竿に長い暖簾。
     2 階は真壁（柱・窓台・内法の貫）に木の格子窓 3 つと虫籠窓 1 つ。庇は垂木 0.30 m ごと・二重の鼻先・繰形の腕木と出桁。
     軒下は三和土と不揃いな割石
  B: 本二階の大店。軒 5.95・勾配 5 寸・のし 5 段。2 階は縁（手すり）と格子窓。1 階は広い店の間と大暖簾、庇は独立柱で受ける
  D: 一階半の小店（道の東、西向き）。軒 3.6・勾配 4 寸。蔀戸（上げた 1 枚は吊り金具で軒下に）と板戸、土壁、吊り看板
"""
from __future__ import annotations

import math
import sys
import time

from kit import *  # noqa: F401,F403
from kit import (EX, EY, EZ, HERE, MODELS_DIR, PREVIEW_DIR, V, Geo, Wall, barrel, basket, beam, bench, board_fence, box,  # noqa: E402
                 cylinder, crate, flat_material, hisashi, itado, lathe, local_to_game_box, local_to_game_rect, main_roof,
                 noren, noren_material, obox, placement, post, quad_grid, raised_floor, room, scene_layout, shelf, shitomido,
                 stone, tawara, torus)
import kit  # noqa: E402
import mats  # noqa: E402
import bpy  # noqa: E402
from common import export_glb, reset, triangles  # noqa: E402

LAYOUT = scene_layout()
HOUSES = {h['name']: h for h in LAYOUT['houses']}


def apron(g, x0, x1, y0, y1, seed=0, floor='earth_floor', curb='granite'):
    """軒下の土間の縁（犬走り）：少し高い三和土と、道側の縁石（curb=None なら縁石なし）"""
    quad_grid(g, floor, (x0, y0, 0.03), EX, EY, 0, x1 - x0, 0, y1 - y0, EZ, step=0.4)
    if curb is None:
        return
    rng = np.random.default_rng(seed)
    y = y0
    k = 0
    while y < y1 - 0.1:
        ln = min(rng.uniform(0.7, 1.2), y1 - y)
        stone(g, 'stone_granite', (x1 - 0.07, y + ln / 2, -0.01), (0.18, ln - 0.008, 0.12), seed * 31 + k, k=7.0, rough=0.02, flat_top=0.75, n=2)
        y += ln
        k += 1


def hang_kanban(g, x, y, z_top, *, w=0.42, h=0.78, t=0.04, axis=EX, hook_z=None, mark='lacquer_mark'):
    """吊り看板：板・上の小さな笠・両面の丸い印・吊り金具"""
    A = V(axis).normalized()
    n = A.cross(EZ).normalized()
    c = V((x, y, z_top - h / 2))
    obox(g, 'wood_fresh', c, EZ, A, n, h / 2, w / 2, t / 2, ch=0.006, seg=2)
    beam(g, 'wood_dark', c + EZ * (h / 2 + 0.02) - A * (w / 2 + 0.04), c + EZ * (h / 2 + 0.02) + A * (w / 2 + 0.04), 0.07, 0.04, up=EZ, ch=0.008)
    for sg in (1, -1):
        cc = c + EZ * 0.06 + n * (sg * t / 2)
        cylinder(g, mark, cc, cc + n * (sg * 0.008), 0.11, seg=16)
        cylinder(g, 'wood_fresh', cc + n * (sg * 0.008), cc + n * (sg * 0.012), 0.06, seg=12)
    if hook_z is not None:
        for s in (-1, 1):
            p = c + EZ * (h / 2) + A * (s * w * 0.32)
            beam(g, 'iron', p, V((p.x, p.y, hook_z)), 0.012, 0.012, up=EX, ch=0.0)


def standing_kanban(g, x, y, *, facing=EX, h=1.45, w=0.44, seed=0):
    """置き看板：2 本の脚と板、上に小さな屋根、印（抽象的な菱）"""
    F = V(facing).normalized()
    A = EZ.cross(F).normalized()
    c = V((x, y, 0))
    for s in (-1, 1):
        p = c + A * (s * (w / 2 + 0.03))
        beam(g, 'wood_dark', p, p + EZ * h, 0.05, 0.05, up=F, ch=0.006)
        stone(g, 'stone_granite', p + EZ * 0.02, (0.16, 0.16, 0.1), seed + s, flat_top=0.8)
    cb = c + EZ * (h * 0.58)
    obox(g, 'wood_fresh', cb, EZ, A, F, h * 0.36, w / 2, 0.018, ch=0.004, seg=2)
    # 印：黒い菱と、その中の明るい点
    verts = [cb + F * 0.02 + EZ * 0.16, cb + F * 0.02 + A * 0.12, cb + F * 0.02 - EZ * 0.16, cb + F * 0.02 - A * 0.12]
    verts += [v - F * 0.006 for v in verts]
    g.convex('lacquer_mark', verts, [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    cylinder(g, 'wood_fresh', cb + F * 0.02, cb + F * 0.026, 0.035, seg=10)
    # 小さな切妻の笠
    top = c + EZ * (h + 0.05)
    for s in (-1, 1):
        cc = top + F * (s * 0.09) - EZ * 0.03
        obox(g, 'wood_dark', cc, A, (F * s * 0.9 - EZ * 0.42).normalized(), (F * s * 0.42 + EZ * 0.9).normalized(),
             w / 2 + 0.1, 0.11, 0.012, ch=0.0)


def lattice_door(g, O, A, n, w, h):
    """格子戸（引き戸）：枠・下の板・上の細い格子"""
    O, A, n = V(O), V(A).normalized(), V(n).normalized()
    for u in (0.025, w - 0.025):
        p = O + A * u
        beam(g, 'wood_dark', p, p + EZ * h, 0.05, 0.045, up=n, ch=0.006)
    for z in (0.03, 0.55, h - 0.03):
        beam(g, 'wood_dark', O + EZ * z, O + A * w + EZ * z, 0.045, 0.05, up=EZ, ch=0.006)
    c = O + A * (w / 2) + EZ * 0.29
    obox(g, 'wood_weathered', c, A, EZ, n, w / 2 - 0.04, 0.24, 0.01)
    k = int(round((w - 0.05) / 0.045))
    for i in range(1, k):
        p = O + A * (0.025 + (w - 0.05) * i / k)
        beam(g, 'wood_dark', p + EZ * 0.55, p + EZ * (h - 0.03), 0.016, 0.028, up=n, ch=0.0)
    quad_grid(g, 'paper_shoji', O - n * 0.02 + EZ * 0.55, A, EZ, 0.05, w - 0.05, 0, h - 0.6, n, step=0.5)


# ---------------------------------------------------------------------------
# 町家 A：つし二階
# ---------------------------------------------------------------------------

def split_curb(g, x_out, y0, y1, seed, mat='stone_granite#curb'):
    """軒下の縁の割石：長さ・幅・高さ・向きの違う石を不揃いに並べる（細い目地）。x_out は道側の外端"""
    rng = np.random.default_rng(seed)
    y = y0
    k = 0
    while y < y1 - 0.12:
        ln = min(rng.uniform(0.32, 0.68), y1 - y)
        if y1 - (y + ln) < 0.18:
            ln = y1 - y
        wd = rng.uniform(0.2, 0.3)
        ht = rng.uniform(0.15, 0.2)
        top = rng.uniform(0.045, 0.075)
        ft = rng.uniform(0.7, 0.88)
        xc = x_out - wd / 2 + rng.uniform(-0.025, 0.01)
        gp = rng.uniform(0.012, 0.03)
        stone(g, mat, (xc, y + ln / 2, top - ht / 2 * ft), (wd, ln - gp, ht), seed * 37 + k,
              k=rng.uniform(2.4, 3.2), rough=rng.uniform(0.08, 0.13), flat_top=ft, n=3, yaw=rng.normal(0, 0.06))
        y += ln
        k += 1


def noren_bracket(g, x_face, xn, y, zn):
    """暖簾の竿を受ける鉄の腕：柱の面の座金、平たい腕、斜めの支え、竿を抱く輪"""
    box(g, 'iron', x_face - 0.004, x_face + 0.006, y - 0.028, y + 0.028, zn - 0.2, zn + 0.07)
    beam(g, 'iron', (x_face, y, zn + 0.035), (xn + 0.028, y, zn + 0.035), 0.012, 0.03, up=EZ, ch=0.0)
    beam(g, 'iron', (x_face + 0.004, y, zn - 0.17), (xn - 0.08, y, zn + 0.024), 0.02, 0.01, up=EY, ch=0.0)
    torus(g, 'iron', (xn, y, zn), 0.021, 0.004, seg=10, segv=3, axis=EY)


def koshi_window(Wl, u0, u1, z0, z1, pitch=0.07):
    """2 階の木の格子窓：枠（柱の面より少し奥）、縦の格子 3×4 cm（柱の面から 6 cm 奥）、裏の横桟、奥に障子"""
    ps = Wl.s / 2
    Wl.frame(u0, u1, z0, z1, w=0.05, d=0.06, dz=ps - 0.035)
    db = ps - 0.06 - 0.02
    Wl.lattice(u0, u1, z0, z1, kind='plain', mat='wood_dark#koshi', pitch=pitch, d=db, rails=False, bar=(0.03, 0.04))
    zc = (z0 + z1) / 2
    beam(Wl.g, 'wood_dark#koshi', Wl.at(u0, zc, db - 0.034), Wl.at(u1, zc, db - 0.034), 0.028, 0.026, up=EZ, ch=0.0)
    Wl.shoji(u0, u1, z0, z1, d=ps - 0.2, panels=4)


def build_a():
    h = HOUSES['machiya_a']
    M = placement(h['footprint'], h['front'])
    g = Geo(seed=11)
    W, xf, xb, s = 8.2, 5.1, 0.0, 0.15
    p, of, ob, ov = 0.45, 0.75, 0.5, (0.38, 0.4)
    He = 4.6
    xr = (xb + xf) / 2
    zr = He + p * (xf + of - xr)
    RAF = (0.07, 0.09)                                                    # 垂木 7×9 cm
    KAYA = dict(h=0.12, d=0.07, board=(0.05, 0.04), proud=0.02, top=0.04)  # 茅負 12 cm ＋ 広小舞 5 cm
    R = main_roof(g, xb=xb, xf=xf, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=3, seed=100, keta=(0.15, 0.18),
                  purlins_x=(0.85, xr, 4.25), gegyo_at=[(W + ov[1] + 0.0, 1)], oni_scale=1.1,
                  rafter_spacing=0.3, rafter=RAF, deck='wood_dark', kaya=KAYA)
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf)
    kz0 = kz1 - 0.18
    posts_f = [0.0, 2.05, 4.1, 6.15, W]
    e0, e1 = 4.1, 6.15          # 入口の間（開始位置の視点から見える側）
    LAT = 'wood_dark#bengara'   # 暗く彩度を落とした弁柄（濃い木の画像に赤みの頂点色）

    # --- 表（X = xf、東向き） ---
    F = Wall(g, (xf, 0, 0), EY, EX, W, s)
    F.plinth(skip=[(e0, e1)], seed=1, mat='stone_granite#curb')
    F.sill(0.0, e0)
    F.sill(e1, W)
    for u in (e0, e1):
        stone(g, 'stone_granite#curb', F.at(u, 0.03, 0.0), (0.34, 0.34, 0.24), 40 + int(u * 10), flat_top=0.9, k=3.0, rough=0.07)
        F.post(u, 0.15, 3.12)
    F.post(2.05, 0.29, 3.12)
    F.hbeam(-0.08, W + 0.08, 2.15, 2.41, d=0.012, w=0.15)          # 差鴨居
    # 差鴨居の上から庇までは柱の間に濃い板（白い帯を作らない。軒下の陰に沈む）
    for (a, b) in ((0.0, 2.05), (2.05, e0), (e0, e1), (e1, W)):
        F.boards(a + 0.075, b - 0.075, 2.41, 3.1, seed=int(a * 10) + 7, mat='wood_dark', battens=False, cap=False, d=s / 2 - 0.025)
    # 1 間目：腰板と出格子
    F.boards(0.075, 1.975, 0.29, 0.93, seed=3)
    F.plaster(0.0, 2.05, 0.93, 2.15, holes=[(0.22, 1.83, 0.95, 2.0)])
    box(g, 'wood_dark', xf + 0.04, xf + 0.34, 0.14, 1.91, 0.9, 0.95, ch=0.008)
    for yy in (0.32, 1.73):
        beam(g, 'wood_dark', (xf + 0.06, yy, 0.62), (xf + 0.3, yy, 0.88), 0.05, 0.06, ch=0.006)
    box(g, 'wood_dark', xf + 0.04, xf + 0.4, 0.1, 1.95, 2.0, 2.045, ch=0.008)
    Dm = Wall(g, (xf + 0.3, 0, 0), EY, EX, W, s)
    Dm.lattice(0.17, 1.88, 0.95, 2.0, kind='oyako', mat=LAT, d=0.0, pitch=0.13, bar=(0.035, 0.045))
    for yy, nn in ((0.17, -EY), (1.88, EY)):
        Ds = Wall(g, (xf, yy, 0), EX, nn, 0.35, s)
        Ds.lattice(0.06, 0.3, 0.95, 2.0, kind='plain', mat=LAT, d=0.0, pitch=0.06, rails=False, bar=(0.025, 0.03))
    F.shoji(0.22, 1.83, 0.95, 2.0, d=-0.02, panels=2, koshi=0.36)
    # 3 間目：入口（半分開いた格子戸・土間。暖簾は表から 0.25 m 前の竿に）
    a0, a1 = e0 + 0.075, e1 - 0.075
    stone(g, 'stone_granite#curb', (xf + 0.01, (a0 + a1) / 2, -0.01), (0.36, a1 - a0 - 0.02, 0.15), 47, k=4.0, rough=0.05,
          flat_top=0.85, n=3)
    lattice_door(g, (xf - 0.03, a1 - 0.88, 0.06), EY, EX, 0.88, 2.08)
    room(g, 2.5, xf - 0.05, a0, a1, 2.34, walls='plaster_white#0.3', back='plaster_white#0.26')   # 土間の奥は暗く
    raised_floor(g, 2.5, 4.35, a1 - 0.85, a1, 0.45, edge='-y', seed=5)
    shelf(g, 2.5, a0 + 0.03, a1 - 0.9, (1.15, 1.65), seed=6)
    xn, zn = xf + s / 2 + 0.25, 2.19      # 暖簾の竿（径 3 cm）の中心
    noren(g, 'noren_a', (xn, e0 + 0.05, zn), EY, EX, 1.95, 1.75, 3, seed=21, sway=0.03, pole_r=0.015, pole_mat='wood_dark',
          gap=0.025, fold=0.02, fold_top=0.01, nu=13, nv=18)
    for yy in (e0, e1):
        noren_bracket(g, xf + s / 2, xn, yy, zn)
    # 2・4 間目：親子格子（暗い弁柄）、奥に障子
    for (a, b) in ((2.125, e0 - 0.075), (e1 + 0.075, W - 0.075)):
        F.lattice(a, b, 0.29, 2.15, kind='oyako', mat=LAT, pitch=0.125, bar=(0.035, 0.045))
        F.shoji(a, b, 0.29, 2.15, d=-0.06, panels=2, koshi=0.42)

    # --- 2 階の表（真壁：柱・窓台・内法の貫。1・2・4 間は木の格子窓、3 間だけ虫籠窓。漆喰は上下の細い帯） ---
    zs0, zs1 = 3.17, 3.30          # 窓台（胴差）
    zw0, zw1 = 3.42, 4.28          # 格子窓の開口
    zh0, zh1 = 4.33, 4.44          # 内法の貫
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
        koshi_window(F, *wn)
    F.mushiko(*mk)
    # 庇（腕木と出桁）：垂木 7×9 cm を 0.30 m ごと、軒裏は濃い板、二重の鼻先、腕木 12×15 cm は出桁の先へ 0.15 m、先端は繰形
    Hs = hisashi(g, xw=xf, face=xf + s / 2, xe=6.25, y0=-0.2, y1=W + 0.2, z0=3.05, p=0.3, seed=200,
                 support=dict(kind='udegi', x=5.92, ys=posts_f), spacing=0.30, rafter=RAF, deck='wood_dark', kaya=KAYA,
                 arm=(0.12, 0.15), arm_proj=0.15, arm_shaped=True)

    # --- 妻側（南 Y=0、北 Y=W） ---
    for (yw, ns, seed) in ((0.0, -1, 50), (W, 1, 60)):
        S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf, s)
        S.plinth(seed=seed, mat='stone_granite#curb')
        S.sill(0.0, xf)
        for X in (0.0, xf):
            S.post(X, 0.29, kz0)
        for X in (1.7, 3.4):
            S.post(X, 0.29, kz0)
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

    # --- 裏（X = 0、西向き） u = W - Y ---
    B = Wall(g, (0, W, 0), -EY, -EX, W, s)
    B.plinth(seed=70, mat='stone_granite#curb')
    B.sill(0.0, W)
    for Y in (2.05, 4.1, 6.15):
        B.post(W - Y, 0.29, kz0)
    door = (W - 5.9, W - 5.0)
    B.boards(0.075, door[0], 0.29, 1.25, seed=71)
    B.boards(door[1], W - 0.075, 0.29, 1.25, seed=72)
    B.hbeam(-0.1, W + 0.1, 2.25, 2.37)
    B.hbeam(-0.1, W + 0.1, 2.95, 3.12, w=0.13)
    win = (W - 1.9, W - 1.2, 1.5, 2.05)
    B.plaster(0.0, W, 1.25, kz0, holes=[(door[0], door[1], 0.29, 2.0), win])
    B.frame(door[0], door[1], 0.29, 2.0)
    itado(g, B.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.71)
    B.frame(*win)
    B.lattice(*win, kind='plain', mat='wood_dark', pitch=0.07, bar=(0.022, 0.03), rails=False)
    B.shoji(*win, d=-0.05, panels=1)

    # --- 軒下の三和土（温かい土色）と道側の割石、小物 ---
    apron(g, xf + 0.08, 6.02, -0.15, W + 0.15, seed=81, floor='earth_floor#tataki', curb=None)
    split_curb(g, 6.02, -0.15, W + 0.15, seed=81)
    bench(g, (5.56, 6.95, 0.03), math.pi / 2, L=1.55, seed=82)
    barrel(g, (5.64, 7.98, 0.03), r=0.22, h=0.58, seed=83)
    basket(g, (5.64, 7.98, 0.61), r=0.16, h=0.18, seed=85)
    barrel(g, (5.64, 2.45, 0.03), r=0.23, h=0.6, seed=84, lid=False)
    basket(g, (5.62, 3.05, 0.03), r=0.24, h=0.3, seed=86)

    kit.sag(g, -ov[0], W + ov[1], kz0, 0.035)

    # 軒下の陰（頂点色の AO を壁ぎわ 0.5 → 軒先 0.85 に抑える）：庇と大屋根の表の軒
    g.eave_zones = [dict(xw=xf, xe=6.25, y0=-0.25, y1=W + 0.25, zb=Hs['zb'], t0=0.5, t1=0.85, soffit=0.22, fade=0.6),
                    dict(xw=xf, xe=xf + of, y0=-ov[0], y1=W + ov[1], zb=zb, t0=0.5, t1=0.85, soffit=0.22, fade=0.6)]

    # --- 当たり判定・カメラ ---
    col = [(-0.12, xf + 0.12, -0.12, W + 0.12), (xf, xf + 0.4, 0.08, 1.97), (5.3, 5.82, 6.15, 7.75),
           (5.4, 5.88, 7.74, 8.22), (5.39, 5.88, 2.2, 3.3), (xf, xn + 0.06, e0 - 0.04, e1 + 0.04)]
    cam = [(-0.12, xf + 0.2, -0.12, W + 0.12, 0.0, kz1),
           (xb - ob - 0.08, xf + of + 0.1, -ov[0] - 0.1, W + ov[1] + 0.1, zb(xf + of) - 0.32, R['ztop'] + 0.35),
           (xf, 6.32, -0.25, W + 0.25, 2.3, 3.2),
           (xf, xf + 0.42, 0.08, 1.97, 0.85, 2.08),
           (xf, xn + 0.05, e0, e1, 0.38, 2.25)]
    return g, M, col, cam, dict(noren_a=noren_material('noren_a', 'yama', 1.95, 1.75))


# ---------------------------------------------------------------------------
# 町家 B：本二階の大店
# ---------------------------------------------------------------------------

def build_b():
    h = HOUSES['machiya_b']
    M = placement(h['footprint'], h['front'])
    g = Geo(seed=12)
    W, xf1, xf2, xb, s = 8.0, 5.3, 4.5, 0.0, 0.18
    p, of, ob, ov = 0.5, 1.3, 0.55, (0.42, 0.33)
    He = 5.95
    xr = (xb + xf2) / 2
    zr = He + p * (xf2 + of - xr)
    ys = [0.0, 2.0, 4.0, 6.0, W]
    R = main_roof(g, xb=xb, xf=xf2, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=5, seed=300, keta=(0.18, 0.2),
                  purlins_x=(0.75, xr, 3.75), oni_scale=1.2, gegyo_at=[(-ov[0] - 0.0, -1)],
                  front_support=dict(x=5.5, ys=ys, arm=(0.12, 0.16), geta=(0.14, 0.16)))
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf2)
    kz0 = kz1 - 0.2
    fl = 3.62          # 2 階の縁の床

    # --- 2 階の表（X = xf2）：格子窓 ---
    F2 = Wall(g, (xf2, 0, 0), EY, EX, W, s)
    for u in (2.0, 4.0, 6.0):
        F2.post(u, fl, kz0)
    F2.hbeam(-0.09, W + 0.09, fl, fl + 0.14, w=0.16)
    F2.hbeam(-0.09, W + 0.09, 5.5, 5.63, w=0.14)
    wins = [(a + 0.28, a + 1.72, 4.05, 5.45) for a in (0.0, 2.0, 4.0, 6.0)]
    F2.plaster(0.0, W, fl + 0.14, kz0, holes=wins)
    for (a, b, c, d) in wins:
        F2.frame(a, b, c, d)
        F2.lattice(a, b, c, d, kind='plain', mat='wood_dark', pitch=0.058, bar=(0.022, 0.034), rails=False)
        F2.shoji(a, b, c, d, d=-0.05, panels=2)
    # 縁（床・鼻の板・手すり）
    nbd = 6
    for i in range(nbd):
        xa = xf2 + 0.08 + (5.42 - xf2 - 0.08) * i / nbd
        xb2 = xa + (5.42 - xf2 - 0.08) / nbd
        box(g, 'wood_weathered', xa + 0.003, xb2 - 0.003, -0.06, W + 0.06, fl - 0.04, fl, seg_len=1.0)
    box(g, 'wood_dark', 5.4, 5.45, -0.07, W + 0.07, 3.35, fl + 0.01, seg_len=0.8)
    xrail = 5.36
    for k in range(9):
        yy = W * k / 8
        post(g, 'wood_dark', xrail, yy, fl, 4.46, s=0.075, ch=0.008)
    beam(g, 'wood_dark', (xrail, -0.05, 4.43), (xrail, W + 0.05, 4.43), 0.08, 0.06, ch=0.012, seg_len=0.8)
    beam(g, 'wood_dark', (xrail, -0.03, fl + 0.07), (xrail, W + 0.03, fl + 0.07), 0.05, 0.05, ch=0.006, seg_len=0.8)
    beam(g, 'wood_dark', (xrail, -0.03, 4.28), (xrail, W + 0.03, 4.28), 0.04, 0.04, ch=0.006, seg_len=0.8)
    nb = int(W / 0.11)
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

    # --- 1 階の表（X = xf1） ---
    F = Wall(g, (xf1, 0, 0), EY, EX, W, s)
    F.plinth(0.0, 2.0, seed=31)
    F.sill(0.0, 2.0)
    for u in (2.0, 4.0, 6.0):
        stone(g, 'stone_granite', F.at(u, 0.03, 0.0), (0.38, 0.38, 0.24), 90 + int(u * 10), flat_top=0.9, k=3.0, rough=0.07)
        F.post(u, 0.15, 3.36)
    F.hbeam(-0.1, W + 0.1, 2.3, 2.58, d=0.012, w=0.18)
    F.plaster(0.0, W, 2.58, 3.4)
    # 1 間目：腰板と格子
    F.boards(0.09, 1.91, 0.29, 0.9, seed=32)
    F.lattice(0.09, 1.91, 0.9, 2.3, kind='plain', mat='wood_dark', pitch=0.085, bar=(0.028, 0.045))
    F.shoji(0.09, 1.91, 0.9, 2.3, d=-0.06, panels=2)
    # 2・3 間目：店の間（上がり框・下の板・奥の棚と品物）
    beam(g, 'wood_dark', (xf1 - 0.06, 2.09, 0.5), (xf1 - 0.06, 5.91, 0.5), 0.13, 0.13, ch=0.012, seg_len=0.8)
    Sk = Wall(g, (xf1 - 0.09, 0, 0), EY, EX, W, s)
    Sk.boards(2.09, 5.91, 0.02, 0.43, seed=33, d=0.0, battens=False, cap=False)
    room(g, 3.1, xf1 - 0.1, 2.09, 5.91, 2.62, floor='wood_weathered')
    raised = 0.565
    nbd = 20
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
    # 4 間目：入口（大暖簾・土間）
    box(g, 'stone_granite', xf1 - 0.16, xf1 + 0.2, 6.09, 7.91, -0.05, 0.06, ch=0.012)
    room(g, 2.8, xf1 - 0.05, 6.09, 7.91, 2.62)
    raised_floor(g, 2.8, 4.5, 6.09, 6.8, 0.56, edge='+y', seed=41, step_stone=True)
    shelf(g, 2.8, 7.0, 7.85, (1.2, 1.75), seed=42)
    noren(g, 'noren_b', (xf1 + 0.15, 6.05, 2.27), EY, EX, 1.9, 1.72, 4, seed=22, sway=0.04)
    for yy in (6.05, 7.95):
        box(g, 'wood_dark', xf1 + 0.08, xf1 + 0.2, yy - 0.03, yy + 0.03, 2.25, 2.32)
    # 庇（独立柱で受ける）
    hisashi(g, xw=xf1, face=xf1 + s / 2 + 0.005, xe=6.75, y0=-0.15, y1=W + 0.15, z0=3.36, p=0.35, seed=400,
            support=dict(kind='posts', x=6.42, ys=[0.0, 4.0, W]))

    # --- 妻側 ---
    for (yw, ns, seed) in ((0.0, -1, 50), (W, 1, 60)):
        S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf1, s)
        S.plinth(seed=seed)
        S.sill(0.0, xf1)
        for X in (0.0, xf2):
            S.post(X, 0.29, kz0)
        for X in (1.5, 3.0):
            S.post(X, 0.29, kz0)
        S.post(xf1, 0.29, 3.36)
        S.boards(0.09, xf1 - 0.09, 0.29, 1.1, seed=seed + 1)
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
        S.plaster(0.0, xf2, 1.1, lambda u: zb(u) - 0.08, holes=holes)
        S.plaster(xf2, xf1, 1.1, 3.45)

    # --- 裏 ---
    B = Wall(g, (0, W, 0), -EY, -EX, W, s)
    B.plinth(seed=70)
    B.sill(0.0, W)
    for Y in (2.0, 4.0, 6.0):
        B.post(W - Y, 0.29, kz0)
    door = (W - 6.1, W - 5.2)
    B.boards(0.09, door[0], 0.29, 1.1, seed=71)
    B.boards(door[1], W - 0.09, 0.29, 1.1, seed=72)
    B.hbeam(-0.1, W + 0.1, 2.45, 2.58)
    B.hbeam(-0.1, W + 0.1, 3.45, fl, w=0.16)
    B.hbeam(-0.1, W + 0.1, 4.88, 4.98)
    wins = [(W - 1.8, W - 1.0, 1.4, 2.0), (W - 3.5, W - 2.5, 4.3, 5.1), (W - 6.0, W - 5.0, 4.3, 5.1)]
    B.plaster(0.0, W, 1.1, kz0, holes=[(door[0], door[1], 0.29, 2.05)] + wins)
    B.frame(door[0], door[1], 0.29, 2.05)
    itado(g, B.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.76)
    for w_ in wins:
        B.frame(*w_)
        B.lattice(*w_, kind='plain', mat='wood_dark', pitch=0.075, bar=(0.022, 0.03), rails=False)
        B.shoji(*w_, d=-0.05, panels=1)

    # --- 町家 A とのすき間の板塀、小物 ---
    board_fence(g, (5.45, W + 0.08, 0.0), (5.45, W + 0.72, 0.0), 1.85, seed=91)
    apron(g, xf1 + 0.1, 6.58, -0.15, W + 0.15, seed=92)
    bench(g, (5.86, 1.05, 0.03), math.pi / 2, seed=93)
    barrel(g, (5.78, 2.55, 0.03), r=0.24, h=0.62, seed=94)
    barrel(g, (6.14, 2.3, 0.03), r=0.2, h=0.5, seed=95, lid=False)
    basket(g, (5.78, 2.55, 0.65), r=0.18, h=0.2, seed=96)
    basket(g, (5.75, 3.2, 0.03), r=0.22, h=0.28, seed=97)
    standing_kanban(g, 6.18, 5.55, facing=EX, seed=98)

    kit.sag(g, -ov[0], W + ov[1], kz0, 0.03)

    col = [(-0.12, xf2 + 0.12, -0.12, W + 0.12), (xf2, xf1 + 0.12, -0.12, W + 0.12),
           (6.3, 6.55, -0.13, 0.13), (6.3, 6.55, 3.87, 4.13), (6.3, 6.55, W - 0.13, W + 0.13),
           (5.6, 6.1, 0.1, 2.0), (5.52, 6.36, 2.08, 2.8), (5.5, 6.0, 2.95, 3.45), (6.05, 6.3, 5.2, 5.9),
           (5.3, 5.6, W, W + 0.8), (-0.12, 5.6, W + 0.1, W + 0.8)]
    cam = [(-0.12, xf2 + 0.2, -0.12, W + 0.12, 0.0, kz1),
           (xf2, xf1 + 0.2, -0.12, W + 0.12, 0.0, 4.5),
           (xb - ob - 0.08, xf2 + of + 0.1, -ov[0] - 0.1, W + ov[1] + 0.1, zb(xf2 + of) - 0.35, R['ztop'] + 0.4),
           (xf1, 6.82, -0.2, W + 0.2, 2.6, 3.5),
           (6.3, 6.55, -0.13, 0.13, 0.0, 2.9), (6.3, 6.55, 3.87, 4.13, 0.0, 2.9), (6.3, 6.55, W - 0.13, W + 0.13, 0.0, 2.9)]
    return g, M, col, cam, dict(noren_b=noren_material('noren_b', 'hishi', 1.9, 1.72))


# ---------------------------------------------------------------------------
# 町家 D：一階半の小店（道の東、西向き）
# ---------------------------------------------------------------------------

def build_d():
    h = HOUSES['machiya_d']
    M = placement(h['footprint'], h['front'])
    g = Geo(seed=13)
    W, xf, xb, s = 7.0, 4.8, 0.0, 0.15
    p, of, ob, ov = 0.4, 0.95, 0.45, (0.33, 0.35)
    He = 3.6
    xr = (xb + xf) / 2
    zr = He + p * (xf + of - xr)
    ys = [0.0, 2.3, 4.7, W]
    R = main_roof(g, xb=xb, xf=xf, W=W, p=p, zr=zr, of=of, ob=ob, ov=ov, layers=2, seed=500, keta=(0.15, 0.16),
                  purlins_x=(0.8, xr, 4.0), oni_scale=0.9,
                  front_support=dict(x=5.5, ys=ys, arm=(0.09, 0.12), geta=(0.12, 0.13)))
    zb, zrb = R['zb'], R['zrb']
    kz1 = zrb(xf)
    kz0 = kz1 - 0.16

    # --- 表（X = xf） ---
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
    hz = 2.1
    # 1 間目：下の蔀は立てたまま、上の蔀は吊り上げ
    shitomido(g, F.at(0.08, 0.29, 0.02), EY, EZ, EX, 2.14, 0.82)
    th = math.radians(104)
    Bv = V((math.sin(th), 0, -math.cos(th)))
    hinge = F.at(0.08, hz, 0.1)
    nn = V((math.cos(th), 0, math.sin(th)))
    shitomido(g, hinge, EY, Bv, -nn, 2.14, 0.95)
    tip = hinge + Bv * 0.95
    for yy in (0.45, 1.85):
        a = V((tip.x - 0.05, yy, tip.z))
        beam(g, 'iron', a, V((a.x, yy, zrb(5.5) - 0.13)), 0.014, 0.014, up=EX, ch=0.0)
        torus(g, 'iron', a + EZ * 0.03, 0.025, 0.006, seg=8, segv=3, axis=EY)
    room(g, 2.8, xf - 0.05, 0.075, 2.225, 2.35)
    nbd = 12
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

    # --- 妻側（家の座標の Y=0 はゲームの北） ---
    for (yw, ns, seed) in ((0.0, -1, 150), (W, 1, 160)):
        S = Wall(g, (0, yw, 0), EX, V((0, ns, 0)), xf, s)
        S.plinth(seed=seed)
        S.sill(0.0, xf)
        for X in (0.0, xf):
            S.post(X, 0.29, kz0)
        for X in (1.6, 3.2):
            S.post(X, 0.29, kz0)
        S.boards(0.075, xf - 0.075, 0.29, 1.5, seed=seed + 1, bw=0.21)
        S.hbeam(-0.1, xf + 0.1, 2.15, 2.25)
        S.hbeam(-0.33, xf + 0.33, kz0, kz1, w=0.15)
        S.post(xr, kz1, zb(xr) - 0.2, s=0.12)
        if ns < 0:
            holes = [(2.0, 2.8, 3.98, 4.38)]
        else:
            holes = [(1.2, 2.0, 1.65, 2.1)]
        for hb in holes:
            S.frame(*hb)
            S.lattice(*hb, kind='grid', mat='wood_dark', pitch=0.09, bar=(0.022, 0.03), rails=False)
            S.backing(*hb, d=-0.08, mat='plaster_earth')
        S.plaster(0.0, xf, 1.5, lambda u: zb(u) - 0.08, holes=holes, mat='plaster_earth')

    # --- 裏 ---
    B = Wall(g, (0, W, 0), -EY, -EX, W, s)
    B.plinth(seed=170)
    B.sill(0.0, W)
    for Y in (1.75, 3.5, 5.25):
        B.post(W - Y, 0.29, kz0)
    door = (W - 5.0, W - 4.2)
    B.boards(0.075, door[0], 0.29, 1.5, seed=171, bw=0.21)
    B.boards(door[1], W - 0.075, 0.29, 1.5, seed=172, bw=0.21)
    B.hbeam(-0.1, W + 0.1, 2.15, 2.25)
    win = (W - 2.6, W - 1.8, 1.7, 2.15)
    B.plaster(0.0, W, 1.5, kz0, holes=[(door[0], door[1], 0.29, 1.95), win], mat='plaster_earth')
    B.frame(door[0], door[1], 0.29, 1.95)
    itado(g, B.at(door[0], 0.29, 0.0), -EY, -EX, door[1] - door[0], 1.66)
    B.frame(*win)
    B.lattice(*win, kind='plain', mat='wood_dark', pitch=0.07, bar=(0.022, 0.03), rails=False)
    B.backing(*win, d=-0.08, mat='plaster_earth')

    # --- 城の塀の端とのすき間の板塀（ゲームの x 7.6、z 3.0〜3.8）、小物 ---
    board_fence(g, (2.0, -0.78, 0.0), (2.0, -0.08, 0.0), 2.3, seed=191)
    apron(g, xf + 0.08, 5.42, -0.1, W + 0.1, seed=192)
    tawara(g, (5.13, 0.62, 0.2 + 0.03), math.pi / 2, seed=193)
    tawara(g, (5.13, 1.38, 0.2 + 0.03), math.pi / 2, seed=194)
    tawara(g, (5.1, 1.0, 0.56 + 0.03), math.pi / 2, seed=195)
    barrel(g, (5.15, 6.45, 0.03), r=0.21, h=0.55, seed=196)
    basket(g, (5.13, 5.85, 0.03), r=0.2, h=0.25, seed=197)
    crate(g, (5.12, 5.3, 0.03), 0.05, 0.4, 0.4, 0.3, seed=198)
    crate(g, (5.12, 5.3, 0.36), -0.08, 0.34, 0.34, 0.24, seed=199)
    hang_kanban(g, 5.28, 4.7, 3.02, w=0.4, h=0.72, axis=EX, hook_z=zrb(5.5) - 0.13 - 0.12)

    kit.sag(g, -ov[0], W + ov[1], kz0, 0.045)

    col = [(-0.12, xf + 0.12, -0.12, W + 0.12), (4.9, 5.36, 0.22, 1.8), (4.92, 5.38, 5.05, 6.68), (1.4, 2.6, -0.85, 0.0)]
    cam = [(-0.12, xf + 0.2, -0.12, W + 0.12, 0.0, kz1),
           (xb - ob - 0.08, xf + of + 0.1, -ov[0] - 0.1, W + ov[1] + 0.1, zb(xf + of) - 0.3, R['ztop'] + 0.3),
           (xf, 5.9, 0.0, 2.3, 2.05, 2.45)]
    return g, M, col, cam, {}


BUILDERS = {'a': ('machiya_a', build_a), 'b': ('machiya_b', build_b), 'd': ('machiya_d', build_d)}
AO = {'a': dict(distance=0.35, strength=0.55)}


def common_custom():
    return dict(iron=kit.flat_material('iron', (46, 42, 40), rough=0.55, metal=0.6),
                lacquer_mark=kit.flat_material('lacquer_mark', (30, 26, 24), rough=0.3))


def build_one(key, preview=True, samples=48):
    name, fn = BUILDERS[key]
    t0 = time.time()
    reset()
    g, M, col, cam, custom = fn()
    custom.update(common_custom())
    print(name, 'local tris', g.tris(), flush=True)
    objs = kit.to_objects(g, M, name, custom)
    kit.finish_objects(objs, seed=hash(name) % 1000)
    tris = triangles(objs)
    print(name, 'tris after densify', tris, flush=True)
    zones = getattr(g, 'eave_zones', None)
    before = kit.snapshot_colors(objs)
    # AO：A は近い範囲（0.35 m）だけ。深い軒の下が一面に黒く沈まないように（軒下の陰は eave_shade で決める）
    kit.bake(objs, samples=samples, **AO.get(key, {}))
    kit.ao_lift(objs, before, ('wood_dark#bengara', 'wood_dark#koshi', 'wood_bengara'))
    kit.ao_lift(objs, before, ('paper_shoji',), keep=0.6)       # 格子の奥の障子（桟のすき間から見える面）
    if zones:
        kit.eave_shade(objs, M, zones, before)
    for ob in objs:
        ob['koto_house'] = name
    size = export_glb(MODELS_DIR / f'{name}.glb', objs)
    print(name, 'glb', size, 'bytes', f'{time.time() - t0:.0f}s', flush=True)
    colliders = [local_to_game_rect(M, *r) for r in col]
    blockers = [local_to_game_box(M, *b) for b in cam]
    kit.write_meta(HERE / f'{name}.meta.json', name, colliders, blockers, extra=dict(triangles=tris, glb_bytes=size))
    if preview:
        previews(name)
    return objs, tris, size


VIEWS = {
    'machiya_a': [('street', (1.2, 1.9, 6.0), (-6.5, 2.2, -1.5)),
                  ('soffit', (-3.2, 1.55, -0.9), (-5.0, 2.95, -2.6)),
                  ('34', (2.5, 6.5, -11.0), (-7.0, 2.5, -1.0)),
                  ('back', (-15.5, 4.0, 5.5), (-7.0, 2.8, -1.5)),
                  ('eave', (-2.3, 1.75, 1.2), (-4.9, 3.0, -1.6)),
                  ('shop', (-2.0, 1.7, 2.4), (-5.3, 1.3, -0.5))],
    'machiya_b': [('street', (1.4, 1.9, 13.5), (-6.5, 3.0, 6.5)),
                  ('34', (3.0, 7.5, 17.5), (-7.5, 3.5, 7.0)),
                  ('back', (-17.0, 5.0, 16.0), (-7.5, 3.5, 7.0)),
                  ('eave', (-2.3, 1.75, 9.0), (-5.2, 3.6, 6.8)),
                  ('shop', (-1.6, 1.7, 6.5), (-5.4, 1.2, 4.4))],
    'machiya_d': [('street', (-1.0, 1.9, 0.5), (6.5, 2.0, 7.5)),
                  ('34', (-2.5, 5.5, 15.5), (6.8, 2.0, 7.0)),
                  ('back', (14.5, 4.0, 14.0), (7.0, 2.0, 7.0)),
                  ('eave', (1.8, 1.75, 5.5), (4.2, 2.8, 7.0)),
                  ('shop', (1.6, 1.7, 3.6), (4.6, 1.2, 4.6))],
}


def previews(name, which=None, samples=24):
    kit.preview_ground()
    mats.game_lights()
    for (tag, cam, tgt) in VIEWS[name]:
        if which and tag not in which:
            continue
        kit.render(PREVIEW_DIR / f'{name}-{tag}.png', cam, tgt, samples=samples)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    keys = args or ['a', 'b', 'd']
    for k in keys:
        build_one(k, preview='--no-preview' not in sys.argv, samples=16 if '--fast' in sys.argv else 48)
