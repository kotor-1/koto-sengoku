"""
Version 28 の町の小物（木戸・柵・物見櫓・詰所の小屋・荷車・俵・籠・槍立て・筵・桶・床几・高札）を形から作り、
1 つの GLB（proto3d/public/models/props28.glb）と、種類ごとの当たり判定の表（このフォルダの props28.types.json）を書き出す。
    /root/blender-venv/bin/python proto3d/blender/street28/build_props28.py [--no-preview] [--fast] [--no-bake]

- Version 27 までの「色だけの箱・円柱の組み合わせ」（town/plan.ts の部品）をやめ、建物と同じ作り方（machiya/kit.py の部品・
  lib/mats.py の手続きの材質・頂点色の AO と壁の裾の汚れ）で作る。
- 種類ごとに 1 つの空（名前 prop_<種類>）の下に、材質ごとの網。網の座標は小物の中の座標（原点は置き場所の地面、向きは回さない形）。
  ゲーム（town/plan.ts・town/view.ts）は street28.json の props から、種類ごとの形を置き場所・向き・（柵だけ）長さへ写してまとめて描く。
- 当たり判定・カメラ除け：形を作るときに「固い物」の印（parts28.SolidGeo）を付けた部品の頂点から箱を作り、小物の中の座標で書く
  （歩きは高さ 1.9 m より下の頂点、カメラ除けは 1.9 m の上下で分けた箱。ゲームが置き場所へ回して足す。手で別に書かない）。
- 材質は Version 27 の GLB と同じライブラリの画像（新しい画像は作らない）。墨の行・水・座面の革は画像なしの単色。
- 座標：小物の中の Blender の (X, Y, Z) ＝ ゲームの (x, −z, y)。X は東（小物の +x）、Y は北（小物の −z）、Z は上。
"""
from __future__ import annotations

import json
import math
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'machiya'))
sys.path.insert(0, str(HERE))

from kit import (EX, EY, EZ, MODELS_DIR, PREVIEW_DIR, V, Wall, barrel, basket, beam, box, cylinder, itado, lathe, obox,  # noqa: E402
                 post, quad_grid, stone, tawara, torus)
import kit  # noqa: E402
import build_machiya as bm  # noqa: E402
import parts28 as pp  # noqa: E402
import mats  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402
from common import export_glb, reset, triangles  # noqa: E402

STREET = json.loads((HERE / 'street28.json').read_text())
OUT_GLB = MODELS_DIR / 'props28.glb'
OUT_TYPES = HERE / 'props28.types.json'
PREVIEW = PREVIEW_DIR / 'street28'
PREVIEW.mkdir(parents=True, exist_ok=True)

kit.COLOR_GAIN.update({
    'straw#mat': (0.54, 0.54, 0.66),      # 筵の藁（使い込んで灰色がかった藁色。藁の画像の黄みを抑える）
    'straw#cord': (0.5, 0.44, 0.34),      # 筵の経糸の縄（濃い）
    'straw#bale': (0.92, 0.86, 0.7),      # 俵の藁
    'straw#rope': (0.72, 0.66, 0.55),     # 縄
    'bamboo#dark': (0.22, 0.19, 0.23),    # 煤けた竹（樽のたが）
    'bamboo#old': (0.68, 0.64, 0.54),     # 日に焼けた古い竹（柵の矢来）
})

# 柵の 1 間（m）。ゲームは柵の長さをこの間で割り、間ごとに少し伸び縮みさせて並べる（town/plan.ts）
FENCE_BAY = 1.8
FENCE_H = 1.45
# 俵の寸法（町の俵の山・荷車の積み荷）
BALE_L, BALE_R = 0.78, 0.24


def gx(x, z):
    """ゲームの小物の中の (x, z) → Blender の (X, Y)"""
    return (x, -z)


# ---------------------------------------------------------------------------
# 木戸（街道口）：鏡柱 2 本と控柱、冠木、板葺きの切妻の小屋根、外（南）へ開いた板の扉 2 枚。原点は道の真ん中の柱の線
# ---------------------------------------------------------------------------

def build_kido(g):
    P = STREET['kido']['postX']
    for s in (-1, 1):
        x = s * P
        stone(g, 'stone_granite#curb', (x, 0.0, 0.03), (0.52, 0.52, 0.26), 811 + s, flat_top=0.8, k=3.0, rough=0.07)
        stone(g, 'stone_granite#curb', (x, 1.0, 0.02), (0.34, 0.34, 0.2), 821 + s, flat_top=0.8, k=3.0, rough=0.08)
        with g.solid(f'post{s:+d}'):
            post(g, 'wood_weathered', x, 0.0, 0.1, 3.0, s=0.27, ch=0.025, seg_len=0.8)
            # 控柱（町の側＝北）と貫 2 本
            post(g, 'wood_weathered', x, 1.0, 0.08, 2.35, s=0.17, ch=0.015)
            for z in (0.55, 2.05):
                beam(g, 'wood_aged', (x, 0.1, z), (x, 1.08, z), 0.07, 0.15, up=EZ, ch=0.008)
            # 扉の肘金（鉄）
            for z in (0.5, 2.3):
                box(g, 'iron', x + s * 0.13, x + s * 0.17, -0.2, -0.1, z - 0.04, z + 0.04)
        # 外（南＝ −Y）へ開いた扉：鏡柱の外の面から、道の端へ少し開いた向き
        a = 0.12
        A = V((s * math.sin(a), -math.cos(a), 0.0))
        n = V((A.y, -A.x, 0.0)) * s
        with g.solid(f'door{s:+d}'):
            O = V((x + s * 0.16, -0.16, 0.1))
            itado(g, O, A, n, 2.4, 2.55, seed=830 + s)
    with g.solid('kabuki', walk=False):
        # 冠木（2.99〜3.25 m）と、屋根を受ける束・母屋
        beam(g, 'wood_aged', (-P - 0.45, 0.0, 3.12), (P + 0.45, 0.0, 3.12), 0.3, 0.26, up=EZ, ch=0.02, seg_len=1.2)
        for xx in (-P, 0.0, P):
            beam(g, 'wood_aged', (xx, 0.0, 3.25), (xx, 0.0, 3.7), 0.12, 0.12, up=EY, ch=0.01)
        for yy in (-0.36, 0.36):
            zp = 3.8 - 0.55 * abs(yy) - 0.045           # 屋根の板の下面に母屋の上端が付く
            beam(g, 'wood_aged', (-P - 0.55, yy, zp), (P + 0.55, yy, zp), 0.08, 0.09, up=EZ, ch=0.008, seg_len=1.2)
        beam(g, 'wood_aged', (-P - 0.55, 0.0, 3.75), (P + 0.55, 0.0, 3.75), 0.1, 0.1, up=EZ, ch=0.01, seg_len=1.2)
    with g.solid('roof', walk=False):
        # 板葺きの切妻（棟 3.82 m、軒 3.48 m）：流れの向きの板を 1 枚ずつ、押縁、棟の箱、妻の破風板
        X0, X1 = -P - 0.62, P + 0.62
        zr, pitch, ye = 3.8, 0.55, 0.64
        rng = np.random.default_rng(840)
        for sgn in (1, -1):
            D = V((0, sgn * 1.0, -pitch)).normalized()
            N = V((0, sgn * pitch, 1.0)).normalized()
            ln = ye * math.sqrt(1 + pitch * pitch)
            nb = int(round((X1 - X0) / 0.19))
            bw = (X1 - X0) / nb
            for i in range(nb):
                xc = X0 + (i + 0.5) * bw
                c = V((xc, 0.0, zr)) + D * (ln / 2) + N * (0.014 + (0.006 if i % 2 else 0.0)) + V((0, 0, rng.uniform(-0.002, 0.002)))
                obox(g, 'wood_weathered', c, D, EX, N, ln / 2 + 0.02, bw / 2 - 0.004, 0.011)
            for t in (0.3, 0.8):
                p = V((0.0, 0.0, zr)) + D * (ln * t) + N * 0.04
                beam(g, 'wood_aged', (X0 - 0.02, p.y, p.z), (X1 + 0.02, p.y, p.z), 0.04, 0.03, up=N, ch=0.005, seg_len=1.4)
            # 鼻隠し
            pe = V((0.0, 0.0, zr)) + D * ln
            beam(g, 'wood_aged', (X0 - 0.03, pe.y, pe.z - 0.02), (X1 + 0.03, pe.y, pe.z - 0.02), 0.025, 0.09, up=EZ, ch=0.004,
                 seg_len=1.4)
        beam(g, 'wood_dark', (X0 - 0.06, 0.0, zr + 0.045), (X1 + 0.06, 0.0, zr + 0.045), 0.2, 0.06, up=EZ, ch=0.01, seg_len=1.4)
        for xe in (X0 - 0.03, X1 + 0.03):
            for sgn in (1, -1):
                beam(g, 'wood_aged', (xe, 0.0, zr + 0.03), (xe, sgn * (ye + 0.05), zr + 0.03 - pitch * (ye + 0.05)), 0.03, 0.14,
                     up=V((0, sgn * pitch, 1.0)).normalized(), ch=0.004)


# ---------------------------------------------------------------------------
# 柵（町の外の境）：丸太の柱、竹の胴縁 2 本、斜めに組んだ竹の矢来。1 間（FENCE_BAY）ごと。+X へ伸びる、町の側（北＝ +Y）に胴縁
# ---------------------------------------------------------------------------

def fence_post(g, x=0.0):
    cylinder(g, 'wood_weathered', (x, 0.0, -0.05), (x, 0.0, FENCE_H), 0.065, seg=8)
    # 柱の頭（少し丸めた切り口）
    lathe(g, 'wood_weathered', (x, 0.0, FENCE_H), [(0.065, 0.0), (0.05, 0.03), (0.0, 0.045)], seg=8)


def build_fence_bay(g):
    L, H = FENCE_BAY, FENCE_H
    rng = np.random.default_rng(850)
    with g.solid('bay'):
        fence_post(g, 0.0)
        for z in (0.42, 1.2):
            cylinder(g, 'bamboo#old', (-0.01, 0.095, z), (L + 0.01, 0.095, z), 0.028, seg=6, caps=(False, False))
        z0, z1 = 0.06, H - 0.06
        S = 0.45
        span = z1 - z0
        for fam, yy in ((1, 0.15), (-1, 0.2)):
            k = -8
            while True:
                c = k * S
                k += 1
                if fam > 0:
                    xa, xb = max(0.0, c), min(L, c + span)
                    if c >= L:
                        break
                    if xb - xa < 0.03:
                        continue
                    pa = (xa, yy, z0 + (xa - c))
                    pb = (xb, yy, z0 + (xb - c))
                else:
                    xa, xb = max(0.0, c - span), min(L, c)
                    if c - span >= L:
                        break
                    if xb - xa < 0.03:
                        continue
                    pa = (xa, yy, z0 + (c - xa))
                    pb = (xb, yy, z0 + (c - xb))
                cylinder(g, 'bamboo#old', pa, pb, 0.022 + rng.uniform(-0.002, 0.002), seg=6, caps=(False, False))


def build_fence_post(g):
    with g.solid('post'):
        fence_post(g, 0.0)


# ---------------------------------------------------------------------------
# 物見櫓：丸太の脚 4 本・貫・筋交い・床・腰板の手すり・北の梯子（tower）と、屋根の柱と方形の板屋根（tower_top：物見の眺めの間は描かない）
# ---------------------------------------------------------------------------

def tower_dims():
    T = STREET['tower']
    L, H = T['half'], T['floorY']
    return T, L, H, L + 0.22


def build_tower(g):
    T, L, H, R = tower_dims()
    foot = T['ladder']['footOut']
    with g.solid('legs'):
        for sx in (-1, 1):
            for sy in (-1, 1):
                stone(g, 'stone_granite#curb', (sx * L, sy * L, 0.02), (0.42, 0.42, 0.24), 860 + sx * 3 + sy, flat_top=0.8, k=3.0)
                cylinder(g, 'wood_weathered', (sx * L, sy * L, 0.08), (sx * L, sy * L, H - 0.02), 0.115, seg=8)
        o = 0.115 + 0.035
        for z in (0.55, 3.15, H - 0.3):
            for s in (-1, 1):
                beam(g, 'wood_aged', (-L - 0.2, s * (L + o), z), (L + 0.2, s * (L + o), z), 0.07, 0.15, up=EZ, ch=0.008)
                beam(g, 'wood_aged', (s * (L + o), -L - 0.2, z + 0.16), (s * (L + o), L + 0.2, z + 0.16), 0.07, 0.15, up=EZ, ch=0.008)
        # 筋交い（各面に 2 段の X）
        for (za, zb) in ((0.62, 3.08), (3.3, H - 0.38)):
            for s in (-1, 1):
                for d in (-1, 1):
                    beam(g, 'wood_aged', (-d * L, s * (L + o + 0.07), za), (d * L, s * (L + o + 0.07), zb), 0.06, 0.1,
                         up=V((0, s, 0)), ch=0.006)
                    beam(g, 'wood_aged', (s * (L + o + 0.07), -d * L, za + 0.12), (s * (L + o + 0.07), d * L, zb + 0.12), 0.06, 0.1,
                         up=V((s, 0, 0)), ch=0.006)
    with g.solid('floor', walk=False):
        F = L + 0.3
        for s in (-1, 1):
            beam(g, 'wood_aged', (-F, s * (L - 0.05), H - 0.08), (F, s * (L - 0.05), H - 0.08), 0.12, 0.14, up=EZ, ch=0.01)
        n = 11
        bw = 2 * F / n
        rng = np.random.default_rng(870)
        for i in range(n):
            y0 = -F + i * bw
            box(g, 'wood_aged', -F, F, y0 + 0.004, y0 + bw - 0.004, H - 0.01 + rng.uniform(-0.004, 0.004), H + 0.05)
    with g.solid('rail', walk=False):
        z0, z1 = H + 0.05, H + 0.95
        for sx in (-1, 1):
            for sy in (-1, 1):
                post(g, 'wood_aged', sx * R, sy * R, z0, z1, s=0.11, ch=0.01)
        # 腰板（北の面は梯子の口を空ける）
        gap = 0.45
        sides = [((-R, -R), (R, -R), V((0, -1, 0))), ((R, -R), (R, R), V((1, 0, 0))), ((R, R), (-R, R), V((0, 1, 0))),
                 ((-R, R), (-R, -R), V((-1, 0, 0)))]
        for k, (a, b, nn) in enumerate(sides):
            Wl = Wall(g, (a[0], a[1], 0), V((b[0] - a[0], b[1] - a[1], 0)), nn, 2 * R, 0.08)
            spans = [(0.06, 2 * R - 0.06)]
            if nn.y > 0:
                spans = [(0.06, R - gap), (R + gap, 2 * R - 0.06)]
            for (u0, u1) in spans:
                Wl.boards(u0, u1, z0 + 0.06, z1 - 0.12, seed=880 + k, battens=False, d=0.0)
                Wl.hbeam(u0 - 0.03, u1 + 0.03, z1 - 0.1, z1, d=0.0, w=0.09, mat='wood_aged')
    with g.solid('ladder'):
        yb, yt = L + foot + 0.1, L + 0.14
        zt = H + 0.3
        for s in (-1, 1):
            beam(g, 'wood_aged', (s * 0.3, yb, 0.0), (s * 0.3, yt, zt), 0.06, 0.08, up=EY, ch=0.008)
        nr = int(H / 0.34)
        for i in range(1, nr + 1):
            t = (i * 0.34) / zt
            if t >= 0.99:
                break
            y = yb + (yt - yb) * t
            beam(g, 'wood_aged', (-0.31, y, zt * t), (0.31, y, zt * t), 0.045, 0.045, up=EZ, ch=0.005)


def build_tower_top(g):
    T, L, H, R = tower_dims()
    z0 = H + 0.95
    zt = H + 2.35
    for sx in (-1, 1):
        for sy in (-1, 1):
            # 柱は 1 本ずつ別の箱（真ん中の物見の目の高さを箱に入れない）
            with g.solid(f'post{sx:+d}{sy:+d}', walk=False):
                post(g, 'wood_aged', sx * R, sy * R, z0, zt, s=0.11, ch=0.01)
    with g.solid('roof', walk=False):
        for s in (-1, 1):
            beam(g, 'wood_aged', (-R - 0.08, s * R, zt - 0.06), (R + 0.08, s * R, zt - 0.06), 0.1, 0.12, up=EZ, ch=0.01)
            beam(g, 'wood_aged', (s * R, -R - 0.08, zt + 0.06), (s * R, R + 0.08, zt + 0.06), 0.1, 0.12, up=EZ, ch=0.01)
        E = R + 0.55
        ze = zt + 0.02
        za = H + 3.3
        apex = V((0, 0, za))
        rng = np.random.default_rng(890)
        # 方形の板屋根：4 面、面ごとに流れの向きの板（三角の面に合わせて長さを変える）
        for k in range(4):
            ang = k * math.pi / 2
            ca, sa = math.cos(ang), math.sin(ang)
            out = V((ca, sa, 0))
            side = V((-sa, ca, 0))
            mid = out * E + V((0, 0, ze))
            D = (mid - apex).normalized()
            N = side.cross(D).normalized()
            if N.z < 0:
                N = -N
            full = (mid - apex).length
            nb = 16
            bw = 2 * E / nb
            for i in range(nb):
                u = -E + (i + 0.5) * bw
                tmax = 1 - abs(u) / E
                ln = full * tmax
                if ln < 0.06:
                    continue
                # 軒から上へ ln（面の上で、軒の線の u の所から頂へ向かう線に沿う）
                eave = mid + side * u
                top = eave + (apex - mid) * tmax
                c = (eave + top) / 2 + N * (0.014 + (0.005 if i % 2 else 0.0) + rng.uniform(-0.002, 0.002))
                Dk = (top - eave).normalized()
                obox(g, 'wood_weathered', c, Dk, side, N, ln / 2 + 0.01, bw / 2 - 0.004, 0.011)
            # 隅棟の押さえ
            corner = out * E + side * E + V((0, 0, ze))
            beam(g, 'wood_dark', corner + N * 0.0, apex + V((0, 0, 0.03)), 0.08, 0.05, up=V((0, 0, 1)), ch=0.01)
            beam(g, 'wood_aged', mid - side * (E + 0.02) - V((0, 0, 0.03)), mid + side * (E + 0.02) - V((0, 0, 0.03)), 0.025, 0.08,
                 up=EZ, ch=0.004)
        lathe(g, 'wood_dark', (0, 0, za - 0.02), [(0.09, 0.0), (0.08, 0.1), (0.05, 0.16), (0.0, 0.2)], seg=8)


# ---------------------------------------------------------------------------
# 詰所の小屋（東の囲いの中）：板壁・石置きの板葺きの片流れ（東へ下がる）、西の戸口。原点は小屋の真ん中の地面
# ---------------------------------------------------------------------------

def build_hut(g):
    W = D = 4.0
    hw, hd = W / 2, D / 2
    zw, ze = 2.62, 2.22          # 西（高い）・東（低い）の桁の高さ
    s = 0.12
    door = (gx(0, 0.75)[1], gx(0, -0.35)[1])     # 西の戸口（Blender の Y の範囲。ゲームの z −0.35〜0.75）

    def top_at(x):
        return zw + (ze - zw) * (x + hw) / W
    with g.solid('body'):
        for (X, Y) in ((-hw, -hd), (-hw, hd), (hw, -hd), (hw, hd), (0, -hd), (0, hd), (-hw, door[0] - 0.08), (-hw, door[1] + 0.08), (hw, 0)):
            stone(g, 'stone_granite#curb', (X, Y, 0.0), (0.3, 0.3, 0.2), 900 + int(X * 7 + Y * 13), flat_top=0.85, k=3.0)
            post(g, 'wood_dark', X, Y, 0.08, top_at(X), s=s, ch=0.012)
        # 土台・桁
        for (a, b) in (((-hw, -hd), (hw, -hd)), ((-hw, hd), (hw, hd)), ((-hw, -hd), (-hw, hd)), ((hw, -hd), (hw, hd))):
            beam(g, 'wood_dark', (a[0], a[1], 0.15), (b[0], b[1], 0.15), s, 0.12, up=EZ, ch=0.01, seg_len=1.4)
        beam(g, 'wood_dark', (-hw, -hd - 0.1, zw), (-hw, hd + 0.1, zw), s, 0.14, up=EZ, ch=0.012, seg_len=1.4)
        beam(g, 'wood_dark', (hw, -hd - 0.1, ze), (hw, hd + 0.1, ze), s, 0.14, up=EZ, ch=0.012, seg_len=1.4)
        # 板壁：北と南（妻の三角は板の面）、東、西（戸口を空ける）
        for (y, nn, sd) in ((-hd, V((0, -1, 0)), 901), (hd, V((0, 1, 0)), 902)):
            Wl = Wall(g, (-hw, y, 0), EX, nn, W, s)
            Wl.boards(0.06, W - 0.06, 0.22, ze - 0.05, seed=sd, mat='wood_weathered', bw=0.26)
            Wl.plaster(0.06, W - 0.06, ze - 0.08, lambda u: top_at(-hw + u) - 0.02, mat='wood_weathered', d=s / 2 + 0.006)
            Wl.hbeam(0.0, W, 1.05, 1.15, d=s / 2 + 0.03, w=0.06, mat='wood_dark')
        Wl = Wall(g, (hw, -hd, 0), EY, V((1, 0, 0)), D, s)
        Wl.boards(0.06, D - 0.06, 0.22, ze - 0.06, seed=903, mat='wood_weathered', bw=0.26)
        Wl.hbeam(0.0, D, 1.05, 1.15, d=s / 2 + 0.03, w=0.06, mat='wood_dark')
        Ww = Wall(g, (-hw, -hd, 0), EY, V((-1, 0, 0)), D, s)
        u_door = (door[0] + hd, door[1] + hd)
        Ww.boards(0.06, u_door[0] - 0.08, 0.22, zw - 0.06, seed=904, mat='wood_weathered', bw=0.26)
        Ww.boards(u_door[1] + 0.08, D - 0.06, 0.22, zw - 0.06, seed=905, mat='wood_weathered', bw=0.26)
        Ww.boards(u_door[0] - 0.02, u_door[1] + 0.02, 1.95, zw - 0.06, seed=906, mat='wood_weathered', battens=False)
        Ww.frame(u_door[0], u_door[1], 0.18, 1.9, w=0.07, d=0.13)
        # 戸口の奥（暗い土間と奥の板）・敷居
        quad_grid(g, 'earth_floor', (-hw + 0.06, -hd + 0.06, 0.05), EX, EY, 0, W - 0.12, 0, D - 0.12, EZ, step=0.6)
        # 内の裏の板（戸口から見える）
        Wi = Wall(g, (hw - 0.05, hd, 0), -EY, V((-1, 0, 0)), D, 0.02)
        Wi.backing(0.1, D - 0.1, 0.2, ze - 0.1, d=0.0, mat='wood_weathered#0.45')
        # 南の壁の小窓（竹の連子）
        Ws = Wall(g, (-hw, -hd, 0), EX, V((0, -1, 0)), W, s)
        Ws.frame(2.4, 3.2, 1.25, 1.7, w=0.05, d=0.1)
        for i in range(1, 6):
            p = Ws.at(2.4 + 0.8 * i / 6, 0, s / 2 + 0.03)
            cylinder(g, 'bamboo', (p.x, p.y, 1.25), (p.x, p.y, 1.7), 0.015, seg=6)
        Ws.backing(2.4, 3.2, 1.25, 1.7, d=-0.02, mat='wood_weathered#0.3')
    with g.solid('roof', walk=False):
        # 垂木と、石置きの板葺き（西 X=−hw−0.4 が高い、東 X=hw+0.45 が低い）
        x_hi, x_lo = -hw - 0.4, hw + 0.45
        z_hi, z_lo = top_at(x_hi) + 0.1, top_at(x_lo) + 0.1
        for k in range(7):
            yy = -hd - 0.2 + (D + 0.4) * k / 6
            beam(g, 'wood_aged', (x_hi, yy, z_hi - 0.03), (x_lo, yy, z_lo - 0.03), 0.06, 0.08,
                 up=V((-(z_lo - z_hi) / (x_lo - x_hi), 0, 1)).normalized(), ch=0.006)
        pp.stone_roof(g, x_lo, x_hi, -hd - 0.35, hd + 0.35, z_lo + 0.03, z_hi + 0.03, seed=907, rows=3, bw=0.3)
        beam(g, 'wood_weathered', (x_lo, -hd - 0.37, z_lo - 0.01), (x_lo, hd + 0.37, z_lo - 0.01), 0.025, 0.1, ch=0.004)
    with g.solid('sudare', camera=False, walk=False):
        pp.sudare_roll(g, -hw - 0.12, door[0] - 0.05, door[1] + 0.05, 2.05)


# ---------------------------------------------------------------------------
# 荷車（大八車）：板の荷台・側の框が前で梶棒になって地面に下りる・車輪 2 つ（輪・矢・轂）・車軸。積み荷は俵 2 つと籠。
# 小物の +z（Blender の −Y）が梶棒の先
# ---------------------------------------------------------------------------

def wheel(g, cx, cy, cz, R=0.55, seed=0):
    rng = np.random.default_rng(seed)
    nseg = 16
    for i in range(nseg):
        a0 = 2 * math.pi * i / nseg
        a1 = 2 * math.pi * (i + 1) / nseg
        p0 = V((cx, cy + math.cos(a0) * (R - 0.035), cz + math.sin(a0) * (R - 0.035)))
        p1 = V((cx, cy + math.cos(a1) * (R - 0.035), cz + math.sin(a1) * (R - 0.035)))
        beam(g, 'wood_aged', p0, p1, 0.065, 0.075, up=V((0, math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2))), ch=0.008)
    # 鉄の輪（細い帯）
    torus(g, 'iron', (cx, cy, cz), R - 0.002, 0.012, seg=nseg * 2, segv=3, axis=EX, smooth=True, squash=2.2)
    for i in range(10):
        a = 2 * math.pi * (i + 0.25 + rng.uniform(-0.02, 0.02)) / 10
        p0 = V((cx, cy + math.cos(a) * 0.1, cz + math.sin(a) * 0.1))
        p1 = V((cx, cy + math.cos(a) * (R - 0.06), cz + math.sin(a) * (R - 0.06)))
        beam(g, 'wood_aged', p0, p1, 0.035, 0.03, up=EX, ch=0.004)
    cylinder(g, 'wood_dark', (cx - 0.1, cy, cz), (cx + 0.1, cy, cz), 0.1, seg=10)


def build_cart(g):
    zbed = 0.62
    yb0, yb1 = gx(0, -1.05)[1], gx(0, 0.85)[1]      # 荷台の後ろ（北）・前（南）
    yw = gx(0, -0.1)[1]
    with g.solid('cart'):
        for s in (-1, 1):
            beam(g, 'wood_aged', (s * 0.5, yb0, zbed), (s * 0.5, yb1, zbed), 0.07, 0.1, up=EZ, ch=0.01)
        for y in (yb0 - 0.06, yw, yb1 + 0.06):
            beam(g, 'wood_aged', (-0.56, y, zbed - 0.07), (0.56, y, zbed - 0.07), 0.07, 0.07, up=EZ, ch=0.008)
        n = 8
        rng = np.random.default_rng(910)
        for i in range(n):
            x0 = -0.5 + i * 1.0 / n
            box(g, 'wood_aged', x0 + 0.004, x0 + 1.0 / n - 0.004, yb1, yb0, zbed + 0.05, zbed + 0.08 + rng.uniform(-0.003, 0.003))
        cylinder(g, 'wood_dark', (-0.72, yw, 0.55), (0.72, yw, 0.55), 0.045, seg=8)
        for s in (-1, 1):
            wheel(g, s * 0.64, yw, 0.55, seed=911 + s)
    with g.solid('shaft'):
        # 梶棒（荷台の框から前へ、地面へ下りる）と、先の横木
        ye = gx(0, 2.4)[1]
        for s in (-1, 1):
            beam(g, 'wood_aged', (s * 0.46, yb1 + 0.02, zbed), (s * 0.37, ye, 0.1), 0.06, 0.08, up=EZ, ch=0.01)
        beam(g, 'wood_aged', (-0.42, ye + 0.08, 0.12), (0.42, ye + 0.08, 0.12), 0.06, 0.06, up=EZ, ch=0.008)
    with g.solid('load', walk=False):
        for (zg, sd) in ((-0.55, 921), (0.05, 922)):
            tawara(g, (0.0, gx(0, zg)[1], zbed + 0.08 + BALE_R), 0.0, L=BALE_L, r=BALE_R, seed=sd, mat='straw#bale')
        basket(g, (0.2, gx(0, 0.58)[1], zbed + 0.08), r=0.2, h=0.3, seed=923)


# ---------------------------------------------------------------------------
# 俵・籠・桶・床几・槍立て・高札
# ---------------------------------------------------------------------------

def build_tawara(g):
    with g.solid('bale'):
        tawara(g, (0.0, 0.0, BALE_R), 0.0, L=BALE_L, r=BALE_R, seed=930, mat='straw#bale')


def build_basket(g):
    with g.solid('basket'):
        basket(g, (0.0, 0.0, 0.0), r=0.27, h=0.4, seed=931)
        # 中身（大根の束に見える白い円柱は作らず、上にかぶせた藁の縄の輪だけ）
        torus(g, 'straw#rope', (0.0, 0.0, 0.33), 0.17, 0.018, seg=12, segv=3)


def build_tub(g):
    with g.solid('tub'):
        barrel(g, (0.0, 0.0, 0.0), r=0.3, h=0.42, seed=932, lid=False, staves=18)
        lathe(g, 'water', (0.0, 0.0, 0.0), [(0.262, 0.36), (0.0, 0.36)], seg=18, smooth=False)


def build_stool(g):
    """床几：たたみ式の腰掛け（交差した脚 2 組・上と下の横木・革の座面）。座面の長い辺は X（座る人の向き（+z）に直交）"""
    W, Dd, H = 0.46, 0.36, 0.42
    with g.solid('stool'):
        for sx in (-1, 1):
            x = sx * (W / 2 - 0.04)
            for sg in (-1, 1):
                beam(g, 'wood_aged', (x, sg * Dd / 2, 0.0), (x, -sg * Dd / 2, H), 0.03, 0.032, up=EX, ch=0.004)
            box(g, 'iron', x - 0.022, x + 0.022, -0.012, 0.012, H / 2 - 0.012, H / 2 + 0.012)
        for sy in (-1, 1):
            beam(g, 'wood_aged', (-W / 2, sy * Dd / 2, H), (W / 2, sy * Dd / 2, H), 0.035, 0.035, up=EZ, ch=0.005)
            beam(g, 'wood_aged', (-W / 2 + 0.02, sy * Dd / 2, 0.02), (W / 2 - 0.02, sy * Dd / 2, 0.02), 0.03, 0.03, up=EZ, ch=0.004)
        # 座面（革。真ん中が少したるむ）
        nx, ny = 6, 6
        verts, faces = [], []
        for j in range(ny + 1):
            y = -Dd / 2 + Dd * j / ny
            for i in range(nx + 1):
                x = -W / 2 + 0.03 + (W - 0.06) * i / nx
                sag = 0.022 * (1 - (2 * y / Dd) ** 2)
                verts.append(V((x, y, H + 0.02 - sag)))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                faces.append((a, a + 1, a + nx + 2, a + nx + 1))
        g.oriented('seat', verts, faces, EZ, smooth=True)
        # 裏面
        g.oriented('seat', [v - V((0, 0, 0.006)) for v in verts], faces, -EZ, smooth=True)


def build_spear_rack(g):
    """槍立て：2 本の柱と上下の横木に、6 本の槍を立てかける。並びは +X、槍の先は小物の −z（Blender の +Y）へ傾く"""
    with g.solid('rack'):
        for s in (-1, 1):
            stone(g, 'stone_granite#curb', (s * 1.1, 0.0, 0.02), (0.26, 0.26, 0.18), 940 + s, flat_top=0.8, k=3.0)
            post(g, 'wood_aged', s * 1.1, 0.0, 0.08, 1.7, s=0.1, ch=0.01)
        beam(g, 'wood_aged', (-1.22, 0.0, 1.55), (1.22, 0.0, 1.55), 0.08, 0.09, up=EZ, ch=0.01)
        beam(g, 'wood_aged', (-1.22, gx(0, 0.08)[1], 0.45), (1.22, gx(0, 0.08)[1], 0.45), 0.08, 0.09, up=EZ, ch=0.01)
        # 石突を受ける地面の板
        box(g, 'wood_aged', -1.15, 1.15, gx(0, 0.32)[1], gx(0, 0.14)[1], 0.0, 0.05)
    with g.solid('spears', walk=False, camera=False):
        tilt = 0.1
        for i in range(6):
            sx = -0.9 + i * 0.36
            b = V((sx, gx(0, 0.22)[1], 0.05))
            d = V((0.0, math.sin(tilt), math.cos(tilt)))
            t = b + d * 3.15
            cylinder(g, 'lacquer_mark', b, t, 0.017, seg=6)
            # 石突（鉄）と、穂（鉄の細い菱形）
            cylinder(g, 'iron', b - d * 0.02, b + d * 0.1, 0.019, seg=6)
            h0 = t
            h1 = t + d * 0.26
            side = V((1, 0, 0))
            nrm = d.cross(side).normalized()
            mid = h0 + d * 0.06
            pts = [h0, mid + side * 0.022, mid + nrm * 0.008, mid - side * 0.022, mid - nrm * 0.008, h1]
            g.convex('iron', pts, [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1), (5, 2, 1), (5, 3, 2), (5, 4, 3), (5, 1, 4)])
            cylinder(g, 'iron', t - d * 0.06, t + d * 0.01, 0.02, seg=6)


def build_kosatsu(g):
    """高札：2 本の柱・横木・板・3 枚の札（墨の行）・小さな切妻の板屋根。表（文字の面）は小物の +z（Blender の −Y）"""
    with g.solid('kosatsu'):
        for s in (-1, 1):
            stone(g, 'stone_granite#curb', (s * 0.7, 0.0, 0.02), (0.24, 0.24, 0.18), 950 + s, flat_top=0.8, k=3.0)
            post(g, 'wood_weathered', s * 0.7, 0.0, 0.06, 2.12, s=0.11, ch=0.01)
        beam(g, 'wood_aged', (-0.8, 0.0, 1.0), (0.8, 0.0, 1.0), 0.07, 0.08, up=EZ, ch=0.008)
        box(g, 'wood_aged', -0.75, 0.75, -0.045, -0.005, 1.08, 1.85)
        for k, xc in enumerate((-0.47, 0.0, 0.47)):
            box(g, 'paper_shoji', xc - 0.2, xc + 0.2, -0.056, -0.046, 1.15, 1.78)
            for j in range(5):
                xl = xc + 0.15 - j * 0.075
                ln = 0.5 - 0.12 * ((j + k) % 3 == 2)
                box(g, 'lacquer_mark', xl - 0.006, xl + 0.006, -0.059, -0.055, 1.72 - ln, 1.72)
    with g.solid('roof', walk=False):
        zr, pitch, ye = 2.22, 0.5, 0.3
        for sgn in (1, -1):
            D = V((0, sgn * 1.0, -pitch)).normalized()
            N = V((0, sgn * pitch, 1.0)).normalized()
            ln = ye * math.sqrt(1 + pitch * pitch)
            nb = 9
            bw = 1.9 / nb
            for i in range(nb):
                c = V((-0.95 + (i + 0.5) * bw, 0.0, zr)) + D * (ln / 2) + N * 0.012
                obox(g, 'wood_weathered', c, D, EX, N, ln / 2 + 0.015, bw / 2 - 0.004, 0.01)
        beam(g, 'wood_dark', (-0.98, 0.0, zr + 0.03), (0.98, 0.0, zr + 0.03), 0.1, 0.05, up=EZ, ch=0.008)
        beam(g, 'wood_aged', (-0.95, 0.0, 2.1), (0.95, 0.0, 2.1), 0.08, 0.1, up=EZ, ch=0.008)


# ---------------------------------------------------------------------------
# 筵：藁の厚み（1.2 cm）・ゆるい波打ちと角の反り・経糸の縄・両端のほつれ。長い辺は小物の z（Blender の Y）
# ---------------------------------------------------------------------------

MAT_W, MAT_L, MAT_T = 0.95, 1.95, 0.012


def build_mat(g):
    rng = np.random.default_rng(960)
    hw, hl = MAT_W / 2, MAT_L / 2
    ph = rng.uniform(0, 6.28, 4)

    def zt(x, y):
        # 波打ち（±4 mm）と角の反り（縁へ行くほど 0〜1.2 cm 上がる）
        w = 0.004 * math.sin(2.1 * y + ph[0]) * math.cos(3.3 * x + ph[1]) + 0.003 * math.sin(5.7 * y + 1.3 * x + ph[2])
        cu = max(0.0, abs(x) / hw - 0.75) ** 2 * 0.09 + max(0.0, abs(y) / hl - 0.85) ** 2 * 0.3
        return MAT_T + w + cu * (0.6 + 0.4 * math.sin(ph[3] + x * 3 + y))
    nx, ny = 8, 12
    xs = [-hw + MAT_W * i / nx for i in range(nx + 1)]
    ys = [-hl + MAT_L * j / ny for j in range(ny + 1)]
    with g.solid('mat', walk=False, camera=False):
        top = [V((x, y, zt(x, y))) for y in ys for x in xs]
        faces = []
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                faces.append((a, a + 1, a + nx + 2, a + nx + 1))
        g.oriented('straw#mat', top, faces, EZ, smooth=True)
        # 縁（厚みの面。下は地面の少し下まで）
        ring = [(i, 0) for i in range(nx)] + [(nx, j) for j in range(ny)] + [(i, ny) for i in range(nx, 0, -1)] + [(0, j) for j in range(ny, 0, -1)]
        verts, fs, want = [], [], []
        for k, (i, j) in enumerate(ring):
            x, y = xs[i], ys[j]
            verts += [V((x, y, zt(x, y))), V((x, y, -0.015))]
        m = len(ring)
        for k in range(m):
            a, b = 2 * k, 2 * ((k + 1) % m)
            fs.append((a, b, b + 1, a + 1))
            xm = (verts[a].x + verts[b].x) / 2
            ym = (verts[a].y + verts[b].y) / 2
            want.append(V((xm, ym * (hw / hl), 0)))
        g.oriented('straw#mat', verts, fs, want, smooth=False)
        # 経糸の縄（長い辺に沿って 7 本。上面に少し盛り上がる）
        for c in range(7):
            x0 = -hw + 0.07 + (MAT_W - 0.14) * c / 6
            sec = []
            for j in range(ny + 1):
                y = ys[j]
                z = zt(x0, y)
                sec.append((V((x0 - 0.007, y, z - 0.001)), V((x0, y, z + 0.0035)), V((x0 + 0.007, y, z - 0.001))))
            vs, ff = [], []
            for j in range(ny + 1):
                vs += list(sec[j])
            for j in range(ny):
                a = 3 * j
                ff += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
            g.oriented('straw#cord', vs, ff, EZ, smooth=True)
        # 両端のほつれ（藁の端が不揃いに出る：細い平らな帯）
        for sgn in (-1, 1):
            for k in range(34):
                x = -hw + 0.02 + (MAT_W - 0.04) * (k + rng.uniform(0, 1)) / 34
                y0 = sgn * (hl - 0.01)
                ln = rng.uniform(0.015, 0.06)
                ang = rng.normal(0, 0.25)
                d = V((math.sin(ang), sgn * math.cos(ang), 0))
                side = V((d.y, -d.x, 0)) * rng.uniform(0.002, 0.0035)
                z0 = zt(x, y0) - 0.002
                p0 = V((x, y0, z0))
                p1 = p0 + d * ln + V((0, 0, -0.004 - rng.uniform(0, 0.004)))
                g.oriented('straw#mat', [p0 - side, p0 + side, p1 + side * 0.4, p1 - side * 0.4], [(0, 1, 2, 3)], EZ, smooth=False)
        # 長い辺の少しのほつれ
        for sgn in (-1, 1):
            for k in range(10):
                y = -hl + 0.08 + (MAT_L - 0.16) * (k + rng.uniform(0, 1)) / 10
                x0 = sgn * (hw - 0.005)
                ln = rng.uniform(0.01, 0.03)
                d = V((sgn, rng.normal(0, 0.3), 0)).normalized()
                side = V((d.y, -d.x, 0)) * 0.0025
                p0 = V((x0, y, zt(x0, y) - 0.002))
                p1 = p0 + d * ln + V((0, 0, -0.004))
                g.oriented('straw#mat', [p0 - side, p0 + side, p1 + side * 0.4, p1 - side * 0.4], [(0, 1, 2, 3)], EZ, smooth=False)


# ---------------------------------------------------------------------------

BUILDERS = {
    'kido': build_kido,
    'fence_bay': build_fence_bay,
    'fence_post': build_fence_post,
    'tower': build_tower,
    'tower_top': build_tower_top,
    'hut': build_hut,
    'cart': build_cart,
    'tawara': build_tawara,
    'basket': build_basket,
    'tub': build_tub,
    'stool': build_stool,
    'spear_rack': build_spear_rack,
    'kosatsu': build_kosatsu,
    'mat': build_mat,
}
# 影を落とさない種類（平らな筵）
NO_CAST = {'mat'}
# 焼くときの間隔（種類どうしが遮らないように、X へずらして焼き、書き出す前に原点へ戻す）
SPACING = 30.0


def custom_materials():
    c = bm.common_custom()
    c['water'] = kit.flat_material('water', (52, 62, 60), rough=0.08, metal=0.0)
    c['seat'] = kit.flat_material('seat_leather', (92, 62, 44), rough=0.62, metal=0.0)
    return c


def mat_uv(objs):
    """筵の藁は幅の向き（X）に並べる（藁の画像は繊維が u の向き。uv_auto の『長い向き』では長い辺に沿ってしまう）"""
    for ob in objs:
        if ob.get('koto_key') != 'straw#mat':
            continue
        me = ob.data
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        uvl = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
        lv = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get('vertex_index', lv)
        uv = np.stack([co[:, 0] / 0.5, co[:, 1] / 0.5 + 0.13], -1)[lv]
        uvl.data.foreach_set('uv', uv.astype(np.float32).ravel())


def build_all(preview=True, samples=48, bake=True):
    t0 = time.time()
    reset()
    custom = custom_materials()
    groups = {}
    types = {}
    for k, (tid, fn) in enumerate(BUILDERS.items()):
        g = pp.SolidGeo(seed=970 + k)
        fn(g)
        I = Matrix.Identity(4)
        solids = pp.solid_boxes(g, I)
        off = Matrix.Translation((k * SPACING, 0.0, 0.0))
        objs = kit.to_objects(g, off, tid, custom)
        kit.finish_objects(objs, seed=500 + 17 * k)
        if tid == 'mat':
            mat_uv(objs)
        groups[tid] = (objs, off, solids)
        top = sorted(((k, sum(len(f) - 2 for f in pt['f'])) for k, pt in g.parts.items()), key=lambda kv: -kv[1])[:6]
        print(tid, 'tris', triangles(objs), 'local', g.tris(), top, f'{time.time() - t0:.0f}s', flush=True)
    allobjs = [o for (objs, _, _) in groups.values() for o in objs]
    if bake:
        before = kit.snapshot_colors(allobjs)
        kit.bake(allobjs, samples=samples, strength=0.55, distance=0.9)
        kit.ao_lift(allobjs, before, ('bamboo#old', 'straw#cord'), keep=0.5)
        print('baked', f'{time.time() - t0:.0f}s', flush=True)
    for tid, (objs, off, _) in groups.items():
        pp.base_grime(objs, off, seed=len(tid), h=0.5 if tid not in ('tower', 'kido', 'hut') else 0.7)
    if preview:
        previews(groups, samples=16 if samples < 48 else 20)
    # 原点へ戻し、種類ごとの空の下にまとめる
    roots = []
    for tid, (objs, off, solids) in groups.items():
        root = bpy.data.objects.new(f'prop_{tid}', None)
        bpy.context.scene.collection.objects.link(root)
        inv = off.inverted()
        for o in objs:
            o.data.transform(inv)
            o.parent = root
            if tid in NO_CAST:
                o['cast'] = False
            o['receive'] = True
        roots.append(root)
        tris = triangles(objs)
        walk = [s['walk_box'] for s in solids if s['walk']]
        cam = [{k: b[k] for k in ('x0', 'x1', 'y0', 'y1', 'z0', 'z1')} for s in solids for b in s['camera_boxes']]
        vs = np.array([tuple(v.co) for o in objs for v in o.data.vertices])
        bounds = dict(x0=round(float(vs[:, 0].min()), 3), x1=round(float(vs[:, 0].max()), 3), y0=round(float(vs[:, 2].min()), 3),
                      y1=round(float(vs[:, 2].max()), 3), z0=round(float(-vs[:, 1].max()), 3), z1=round(float(-vs[:, 1].min()), 3))
        types[tid] = dict(walk=walk, camera=cam, solids=solids, bounds=bounds, triangles=tris, cast=tid not in NO_CAST)
    bpy.context.view_layer.update()
    allobjs = [o for (objs, _, _) in groups.values() for o in objs]
    size = export_glb(OUT_GLB, roots + allobjs)
    print('glb', OUT_GLB, size, 'bytes', f'{time.time() - t0:.0f}s', flush=True)
    extra = dict(fence_bay=FENCE_BAY, fence_h=FENCE_H, bale=dict(L=BALE_L, r=BALE_R), mat=dict(w=MAT_W, l=MAT_L, t=MAT_T))
    d = {
        'name': 'props28',
        'coords': 'prop local, game axes (x east, y up, z south), meters. 置き場所・向きはゲーム（town/plan.ts）が street28.json から決める',
        '_about': '町の小物の種類ごとの当たり判定（walk：歩き、高さ 1.9 m より下の頂点の箱）・カメラ除け（camera：1.9 m の上下で分けた箱）。'
                  '制作で固い物の印を付けた部品（solids）の頂点の箱で、手で書いた値ではない（street28/build_props28.py が書き出す）。'
                  'layout.ts の meta の一覧（*.meta.json）には入らない（小物の中の座標なので、town/plan.ts が置き場所へ写して足す）。',
        'glb': 'models/props28.glb', 'glb_bytes': size, 'dims': extra, 'types': types,
    }
    OUT_TYPES.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n')
    total = sum(t['triangles'] for t in types.values())
    print('types', {k: v['triangles'] for k, v in types.items()}, 'total', total, flush=True)


# 確認用の描画（種類ごとに、焼いた位置（X = 番号 × SPACING）で。ゲームの座標：カメラ, 見る点）
VIEWS = {
    'kido': ((3.5, 2.2, 6.5), (0.0, 1.8, 0.0)),
    'fence_bay': ((2.0, 1.3, 3.0), (0.9, 0.8, 0.0)),
    'tower': ((5.5, 3.5, 7.0), (0.0, 3.5, 0.0)),
    'tower_top': ((3.5, 8.0, 5.0), (0.0, 7.6, 0.0)),
    'hut': ((-6.0, 2.4, 4.0), (0.0, 1.3, 0.0)),
    'cart': ((2.4, 1.6, 2.6), (0.0, 0.6, 0.4)),
    'spear_rack': ((-2.2, 1.7, 2.6), (0.0, 1.4, 0.0)),
    'mat': ((1.0, 1.0, 1.6), (0.0, 0.0, 0.2)),
    'kosatsu': ((0.9, 1.5, 2.4), (0.0, 1.4, 0.0)),
    'stool': ((0.9, 0.9, 1.0), (0.0, 0.3, 0.0)),
    'tub': ((0.7, 0.9, 0.9), (0.0, 0.25, 0.0)),
    'tawara': ((0.9, 0.7, 1.0), (0.0, 0.2, 0.0)),
}


def previews(groups, samples=16):
    kit.preview_ground(size=SPACING * (len(BUILDERS) + 2) * 2.2)
    mats.game_lights()
    names = list(BUILDERS)
    for tid, (cam, tgt) in VIEWS.items():
        ox = names.index(tid) * SPACING
        kit.render(PREVIEW / f'props28-{tid}.png', (cam[0] + ox, cam[1], cam[2]), (tgt[0] + ox, tgt[1], tgt[2]), samples=samples,
                   res=(640, 400))


if __name__ == '__main__':
    build_all(preview='--no-preview' not in sys.argv, samples=16 if '--fast' in sys.argv else 48, bake='--no-bake' not in sys.argv)
