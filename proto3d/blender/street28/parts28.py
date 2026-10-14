"""
Version 28 の通りの建物の共通の部品（machiya/kit.py の上に足す。kit.py・build_machiya.py は書き換えない）。

- SolidGeo：形を溜める器（kit.Geo）に「固い物」の印を足す。`with g.solid('名前', walk=..., camera=...)` の中で足した部品の頂点から
  （印を入れ子にしたときは、いちばん内側の印だけに数える）、
  最後に（屋根のたるみ kit.sag などで頂点を動かした後に）箱を作る。walk の箱は歩きの当たり判定、camera の箱はカメラ除け。
  当たり判定・カメラ除けを手で別に書かない（見た目の形と同じ所から出す）。
- 店先の部品：ばったり床几（揚げ見世）、ひな壇の品台、下見板（簓子下見）、霧除けの小庇、海鼠壁、石置きの板葺き、雨落ちの砂利の帯、巻いた簾。
- 壁の裾の汚れ・湿り（焼いた後の頂点色に掛ける。垂直な面だけ。床・犬走りは暗くしない）。
"""
from __future__ import annotations

import math
from contextlib import contextmanager

import numpy as np

from kit import EX, EY, EZ, V, Geo, basket, beam, box, crate, cylinder, lathe, obox, post, quad_grid, stone, tawara  # noqa: F401
import mats  # noqa: E402


# ---------------------------------------------------------------------------
# 固い物の印
# ---------------------------------------------------------------------------

class SolidGeo(Geo):
    """kit.Geo に固い物の印を足したもの。solids = [dict(id, walk, camera, ranges=[(材質, 頂点の始め, 数)])]"""

    def __init__(self, seed=0):
        super().__init__(seed)
        self.solids: list[dict] = []
        self._open: list[dict] = []

    @contextmanager
    def solid(self, sid: str, *, walk: bool = True, camera: bool = True):
        s = dict(id=sid, walk=walk, camera=camera, ranges=[])
        self.solids.append(s)
        self._open.append(s)
        try:
            yield s
        finally:
            self._open.remove(s)

    def add(self, mat, verts, faces, smooth=False):
        start = len(self.parts.get(mat, {'v': []})['v'])
        super().add(mat, verts, faces, smooth)
        n = len(self.parts[mat]['v']) - start
        # いちばん内側の印にだけ入れる（本体の中で張り出す部品＝霧除け・上げた蔀戸などは、内側の印で別の箱にする）
        if self._open:
            self._open[-1]['ranges'].append((mat, start, n))


# 歩きの当たり判定に数える高さ（これより上の部分＝2 階の張り出し・軒・吊り金具は、歩く人を止めない。カメラ除けには数える）
WALK_Y = 1.9


def solid_boxes(g: SolidGeo, M) -> list[dict]:
    """
    固い物ごとの箱（ゲームの座標 {x0,x1,y0,y1,z0,z1}）。頂点は家の座標 → M で Blender の世界 → ゲーム（x, y, z）= (X, Z, −Y)。
    box はすべての頂点の箱、walk_box は高さ WALK_Y より下の頂点だけの箱（歩きの当たり判定）、
    camera_boxes は高さ WALK_Y の上と下に分けた箱（カメラ除け。上下どちらかだけの部品は 1 つ）。
    形を足し終え、たるみなどで頂点を動かした後に呼ぶ。
    """
    out = []
    for s in g.solids:
        pts = []
        for (mat, a, n) in s['ranges']:
            pts.extend(g.parts[mat]['v'][a:a + n])
        if not pts:
            continue
        w = np.array([tuple(M @ p) for p in pts], np.float64)
        gx, gy, gz = w[:, 0], w[:, 2], -w[:, 1]
        r3 = lambda v: round(float(v), 3)  # noqa: E731
        box_ = dict(x0=r3(gx.min()), x1=r3(gx.max()), y0=r3(max(0.0, gy.min())), y1=r3(gy.max()), z0=r3(gz.min()), z1=r3(gz.max()))
        low = gy < WALK_Y
        walk_box = None
        if s['walk'] and low.any():
            walk_box = dict(x0=r3(gx[low].min()), x1=r3(gx[low].max()), z0=r3(gz[low].min()), z1=r3(gz[low].max()))
        # カメラ除け：高さ WALK_Y の上と下で分けた 2 つの箱（上の張り出し＝桁の端・軒の腕木が、軒下の土間の低い所まで箱にしないように）
        cam = []
        if s['camera']:
            up = ~low
            if low.any() and up.any():
                cam.append(dict(x0=r3(gx[low].min()), x1=r3(gx[low].max()), y0=r3(max(0.0, gy.min())), y1=WALK_Y,
                                z0=r3(gz[low].min()), z1=r3(gz[low].max())))
                cam.append(dict(x0=r3(gx[up].min()), x1=r3(gx[up].max()), y0=WALK_Y, y1=r3(gy.max()), z0=r3(gz[up].min()), z1=r3(gz[up].max())))
            else:
                cam.append(box_)
        out.append(dict(id=s['id'], walk=s['walk'] and walk_box is not None, camera=s['camera'], box=box_, walk_box=walk_box,
                        camera_boxes=cam))
    return out


# ---------------------------------------------------------------------------
# 店先・壁・屋根の部品（家の座標：X 奥行き（大きいほど表）、Y 間口、Z 上）
# ---------------------------------------------------------------------------

def agemise(g, x_face, y0, y1, *, depth=0.55, top=0.44, seed=0, goods=True, mat='wood_aged', out=1):
    """
    ばったり床几（揚げ見世）：表の壁に蝶番で留めた板の台を、前へ倒して脚を立てたもの。
    x_face は壁の表の面の X、y0〜y1 は幅、out は表の向き（+1：+X が表）。台の上に品物（籠・箱・俵・壺）。
    """
    rng = np.random.default_rng(seed)
    xa, xb = (x_face, x_face + out * depth)
    x0, x1 = min(xa, xb), max(xa, xb)
    n = max(3, int(round((y1 - y0) / 0.22)))
    bw = (y1 - y0) / n
    # 天板（縦の板を並べ、端に框）
    for i in range(n):
        ya = y0 + i * bw
        box(g, mat, x0 + 0.03, x1 - 0.03, ya + 0.003, ya + bw - 0.003, top - 0.028 + rng.uniform(-0.002, 0.002), top)
    for xx in (x0 + 0.03, x1 - 0.03):
        beam(g, 'wood_dark', (xx, y0, top - 0.05), (xx, y1, top - 0.05), 0.06, 0.05, ch=0.006, seg_len=0.8)
    for yy in (y0 + 0.02, y1 - 0.02):
        beam(g, 'wood_dark', (x0, yy, top - 0.05), (x1, yy, top - 0.05), 0.04, 0.05, ch=0.005)
    # 折りたたみの脚（表側の 2 本と斜めの貫）。壁側は蝶番の金具
    xl = x_face + out * (depth - 0.08)
    for yy in (y0 + 0.12, y1 - 0.12):
        beam(g, mat, (xl, yy, 0.0), (xl, yy, top - 0.08), 0.05, 0.05, up=EX, ch=0.008)
        beam(g, mat, (xl, yy, 0.16), (x_face + out * 0.04, yy, top - 0.12), 0.03, 0.04, up=EZ, ch=0.004)
        box(g, 'iron', min(x_face, x_face + out * 0.05), max(x_face, x_face + out * 0.05), yy - 0.035, yy + 0.035, top - 0.07, top - 0.02)
    beam(g, mat, (xl, y0 + 0.12, 0.14), (xl, y1 - 0.12, 0.14), 0.035, 0.045, up=EZ, ch=0.004)
    if not goods:
        return
    xm = x_face + out * depth * 0.5
    y = y0 + 0.12
    k = 0
    while y < y1 - 0.25:
        kind = (k + seed) % 4
        if kind == 0:
            r = rng.uniform(0.13, 0.17)
            basket(g, (xm, y + r, top), r=r, h=rng.uniform(0.12, 0.18), seed=seed * 7 + k)
            y += 2 * r + 0.06
        elif kind == 1:
            w = rng.uniform(0.22, 0.3)
            crate(g, (xm, y + w / 2, top), rng.uniform(-0.12, 0.12), depth * 0.55, w, rng.uniform(0.1, 0.16), seed=seed * 7 + k)
            y += w + 0.05
        elif kind == 2:
            r = rng.uniform(0.08, 0.11)
            hh = rng.uniform(0.2, 0.28)
            lathe(g, 'earth_floor', (xm, y + r, top),
                  [(r * 0.6, 0), (r, hh * 0.35), (r * 0.95, hh * 0.7), (r * 0.5, hh * 0.92), (r * 0.55, hh), (0, hh)], seg=10)
            y += 2 * r + 0.06
        else:
            tawara(g, (xm, y + 0.2, top + 0.17), math.pi / 2 if out > 0 else math.pi / 2, L=0.5, r=0.15, seed=seed * 7 + k)
            y += 0.58
        k += 1


def stepped_stand(g, x_face, y0, y1, *, steps=((0.62, 0.22), (0.36, 0.5), (0.12, 0.78)), seed=0, mat='wood_aged'):
    """ひな壇の品台（表の壁の前に置く 3 段の台）。steps = [(壁からの距離, 段の高さ)]。段ごとに籠・壺・箱"""
    rng = np.random.default_rng(seed)
    for k, (d, h) in enumerate(steps):
        xa = x_face + d - 0.13
        xb = x_face + d + 0.13
        box(g, mat, xa, xb, y0, y1, h - 0.03, h, ch=0.004)
        for yy in (y0 + 0.04, y1 - 0.04):
            beam(g, 'wood_dark', (xa + 0.13, yy, 0.0), (xa + 0.13, yy, h - 0.03), 0.04, 0.04, up=EX, ch=0.005)
        y = y0 + 0.1
        j = 0
        while y < y1 - 0.2:
            kind = (j + k) % 3
            if kind == 1 and k < len(steps) - 1:
                kind = 2                  # 籠（三角形が多い）は上の段だけ
            if kind == 0:
                r = rng.uniform(0.07, 0.1)
                hh = rng.uniform(0.16, 0.24)
                lathe(g, 'earth_floor', ((xa + xb) / 2, y + r, h),
                      [(r * 0.55, 0), (r, hh * 0.4), (r * 0.9, hh * 0.75), (r * 0.45, hh * 0.95), (r * 0.5, hh), (0, hh)], seg=10)
                y += 2 * r + 0.05
            elif kind == 1:
                r = rng.uniform(0.09, 0.12)
                basket(g, ((xa + xb) / 2, y + r, h), r=r, h=rng.uniform(0.08, 0.13), seed=seed + 13 * k + j)
                y += 2 * r + 0.05
            else:
                w = rng.uniform(0.16, 0.22)
                crate(g, ((xa + xb) / 2, y + w / 2, h), rng.uniform(-0.1, 0.1), 0.18, w, rng.uniform(0.08, 0.12), seed=seed + 17 * k + j)
                y += w + 0.05
            j += 1
    # 横の板（段の側面をふさぐ。段ごとの板を重ねて階段の形に）
    for yy in (y0 - 0.0125, y1 + 0.0125):
        for (d, h) in steps:
            box(g, mat, x_face, x_face + d + 0.13, yy - 0.0125, yy + 0.0125, 0.0, h - 0.03)


def shitami(W, u0, u1, z0, z1, *, bh=0.2, lap=0.025, seed=0, mat='wood_weathered', battens=0.9):
    """
    下見板（簓子下見）：横の板を下から重ねて張る（下の板の上端に次の板がかぶる）。W は kit.Wall。
    板は下端が外へ少し出る（傾き）。battens ごとに縦の押縁（簓子）。
    """
    g = W.g
    rng = np.random.default_rng(seed)
    n = max(1, int(math.ceil((z1 - z0 - lap) / (bh - lap))))
    step = (z1 - z0 - lap) / n
    d0 = W.s / 2 + 0.012
    for i in range(n):
        za = z0 + i * step
        zb = za + step + lap
        # 下端は 2.2 cm 外、上端は 0.6 cm 外（重なりの段）
        lo_out, hi_out = 0.022, 0.006
        j = rng.uniform(-0.002, 0.002)
        a0 = W.at(u0, za, d0 + lo_out + j)
        a1 = W.at(u1, za, d0 + lo_out + j)
        b0 = W.at(u0, zb, d0 + hi_out + j)
        b1 = W.at(u1, zb, d0 + hi_out + j)
        c0 = W.at(u0, za, d0 + j)
        c1 = W.at(u1, za, d0 + j)
        verts = [a0, a1, b1, b0, c0, c1]
        faces = [(0, 1, 2, 3), (4, 5, 1, 0)]
        g.oriented(mat, verts, faces, [W.n, -EZ])
    if battens:
        k = max(1, int(round((u1 - u0) / battens)))
        for i in range(k + 1):
            u = u0 + (u1 - u0) * i / k
            u = min(max(u, u0 + 0.03), u1 - 0.03)
            p = W.at(u, 0, d0 + 0.04)
            beam(g, 'wood_dark', (p.x, p.y, z0), (p.x, p.y, z1), 0.04, 0.03, up=W.n, ch=0.004, seg_len=0.8)
    beam(g, 'wood_dark', W.at(u0 - 0.02, z1 + 0.02, d0 + 0.02), W.at(u1 + 0.02, z1 + 0.02, d0 + 0.02), 0.06, 0.04, ch=0.006, seg_len=0.8)


def kirioke(W, u0, u1, z, *, proj=0.42, p=0.35, seed=0):
    """霧除け（窓の上の小さな板庇）：腕木 2 本と、板の屋根（板の継ぎ目と鼻の板）"""
    g = W.g
    for u in (u0 + 0.06, u1 - 0.06):
        a = W.at(u, z - 0.08, W.s / 2)
        b = W.at(u, z - 0.08, W.s / 2 + proj - 0.04)
        beam(g, 'wood_dark', a, b, 0.05, 0.07, up=EZ, ch=0.006)
    n = max(2, int(round((u1 - u0 + 0.16) / 0.2)))
    for i in range(n):
        ua = u0 - 0.08 + (u1 - u0 + 0.16) * i / n
        ub = u0 - 0.08 + (u1 - u0 + 0.16) * (i + 1) / n
        c = W.at((ua + ub) / 2, z + 0.02 - p * proj / 2, W.s / 2 + proj / 2)
        D = (W.n - EZ * p).normalized()
        N = (EZ + W.n * p).normalized()
        obox(g, 'wood_weathered', c, W.U, D, N, (ub - ua) / 2 - 0.003, proj / 2 * math.sqrt(1 + p * p), 0.012)
    beam(g, 'wood_dark', W.at(u0 - 0.1, z + 0.0 - p * proj, W.s / 2 + proj), W.at(u1 + 0.1, z + 0.0 - p * proj, W.s / 2 + proj),
         0.025, 0.06, ch=0.004)


def namako(W, u0, u1, z0, z1, *, cell=0.26, seed=0):
    """
    海鼠壁：平瓦（正方形、45° に置く）を張り、目地を白い漆喰でかまぼこ形に盛る。W は kit.Wall（外面 d = s/2）。
    瓦は濃い灰（tile_ibushi）、目地は plaster_white。
    """
    g = W.g
    rng = np.random.default_rng(seed)
    d = W.s / 2 + 0.008
    # 下地（瓦の面）を細かい格子で（AO の細かさ）
    quad_grid(g, 'tile_ibushi#namako', W.P0 + W.n * d, W.U, EZ, u0, u1, z0, z1, W.n, step=cell / 2)
    # 斜めの目地（45° の 2 方向）：u − z = c と u + z = c の線（cell ごと）を、四角の中で切る
    for fam in (1, -1):
        cs = np.arange((u0 - z1) if fam > 0 else (u0 + z0), ((u1 - z0) if fam > 0 else (u1 + z1)) + cell, cell)
        for c in cs:
            if fam > 0:
                za, zb = max(z0, u0 - c), min(z1, u1 - c)
                ua, ub = c + za, c + zb
            else:
                za, zb = max(z0, c - u1), min(z1, c - u0)
                ua, ub = c - za, c - zb
            if zb - za < 0.03:
                continue
            beam(g, 'plaster_white', W.at(ua, za, d + 0.012), W.at(ub, zb, d + 0.012), 0.032, 0.026, up=W.n, ch=0.009)
    _ = rng
    # 上端と下端の漆喰の見切り
    for z in (z0, z1):
        beam(g, 'plaster_white', W.at(u0, z, d + 0.014), W.at(u1, z, d + 0.014), 0.04, 0.05, up=EZ, ch=0.012, seg_len=0.8)


def stone_roof(g, x_lo, x_hi, y0, y1, z_lo, z_hi, *, seed=0, bw=0.24, rows=4, stones=True):
    """
    石置きの板葺き（片流れ）：X の x_hi（高い側、z_hi）から x_lo（低い側、z_lo）へ流れる（x_lo と x_hi の大小は問わない）。
    板（長さ方向は流れ）を列ごとに少し重ねて段にし、押さえの横木と川石を載せる。返り：屋根の面の高さ zt(X)
    """
    rng = np.random.default_rng(seed)

    def zt(x):
        return z_lo + (z_hi - z_lo) * (x - x_lo) / (x_hi - x_lo)

    def P(t, y):
        x = x_hi + (x_lo - x_hi) * t
        return V((x, y, zt(x)))
    D = (P(1, 0) - P(0, 0)).normalized()
    N = D.cross(EY)
    if N.z < 0:
        N = -N
    n = max(2, int(round((y1 - y0) / bw)))
    w = (y1 - y0) / n
    for r in range(rows):
        ta, tb = r / rows, min(1.0, (r + 1) / rows + 0.06)
        for i in range(n):
            ya = y0 + i * w + rng.uniform(-0.01, 0.01)
            yb = ya + w - 0.006
            pa, pb = P(ta, (ya + yb) / 2), P(tb, (ya + yb) / 2)
            c = (pa + pb) / 2 + N * (0.012 + (0.012 if r % 2 else 0.0))
            obox(g, 'wood_weathered', c, D, EY, N, (pb - pa).length / 2, (yb - ya) / 2, 0.01 + rng.uniform(0, 0.003))
    # 押さえの横木と川石
    for r in range(rows):
        pm = P((r + 0.55) / rows, 0)
        beam(g, 'wood_aged', V((pm.x, y0 - 0.06, pm.z)) + N * 0.06, V((pm.x, y1 + 0.06, pm.z)) + N * 0.06, 0.06, 0.06, up=N, ch=0.01)
        if stones:
            y = y0 + rng.uniform(0.15, 0.35)
            k = 0
            while y < y1 - 0.15:
                sz = rng.uniform(0.13, 0.2)
                c = V((pm.x + rng.uniform(-0.05, 0.05), y, pm.z)) + N * (0.08 + sz * 0.22)
                stone(g, 'stone_granite', c, (sz, sz * rng.uniform(0.8, 1.1), sz * 0.55), seed * 31 + r * 11 + k, k=2.6, rough=0.12,
                      flat_bot=True, n=2)
                y += rng.uniform(0.55, 0.9)
                k += 1
    return zt


def sudare_roll(g, x, y0, y1, z):
    """巻き上げた簾（軒の下の竹の巻物と、吊りの縄）"""
    cylinder(g, 'bamboo#dark', (x, y0, z), (x, y1, z), 0.045, seg=10)
    for yy in (y0 + 0.15, y1 - 0.15):
        beam(g, 'straw', (x, yy, z + 0.05), (x, yy, z + 0.28), 0.012, 0.012, up=EX, ch=0.0)


def drip_line(g, x0, x1, y0, y1, *, z=0.035, seed=0, edge='both', axis='y'):
    """
    雨落ち（軒の線の下の砂利の帯）：少し高い砂利の面と、両側の小さな縁石。axis は帯の長手（'y' か 'x'）。
    地面の素材は作り直していないので、帯は地面の上に置く（上面 z）。
    """
    quad_grid(g, 'gravel', (x0, y0, z), EX, EY, 0, x1 - x0, 0, y1 - y0, EZ, step=0.5)
    rng = np.random.default_rng(seed)
    # 帯の側面（地面へ）
    for (a, b, nn) in (((x0, y0), (x1, y0), -EY), ((x1, y1), (x0, y1), EY), ((x0, y1), (x0, y0), -EX), ((x1, y0), (x1, y1), EX)):
        verts = [V((a[0], a[1], z)), V((b[0], b[1], z)), V((b[0], b[1], -0.04)), V((a[0], a[1], -0.04))]
        g.oriented('gravel', verts, [(0, 1, 2, 3)], nn)
    if not edge:
        return
    if axis == 'y':
        for xe in {'both': (x0, x1), 'lo': (x0,), 'hi': (x1,)}[edge]:
            y = y0
            k = 0
            while y < y1 - 0.12:
                ln = min(rng.uniform(0.5, 0.8), y1 - y)
                stone(g, 'stone_granite#curb', (xe, y + ln / 2, z - 0.02), (0.09, ln - 0.015, 0.09), seed * 13 + k + int(xe * 100),
                      k=3.0, rough=0.08, flat_top=0.8, n=2)
                y += ln
                k += 1
    else:
        for ye in {'both': (y0, y1), 'lo': (y0,), 'hi': (y1,)}[edge]:
            x = x0
            k = 0
            while x < x1 - 0.12:
                ln = min(rng.uniform(0.5, 0.8), x1 - x)
                stone(g, 'stone_granite#curb', (x + ln / 2, ye, z - 0.02), (ln - 0.015, 0.09, 0.09), seed * 17 + k + int(ye * 100),
                      k=3.0, rough=0.08, flat_top=0.8, n=2)
                x += ln
                k += 1


# ---------------------------------------------------------------------------
# 焼いた後：壁の裾の汚れ・湿り
# ---------------------------------------------------------------------------

def base_grime(objs, M, *, h=0.62, dark=0.62, tint=(0.94, 0.9, 0.82), skip=('tile_ibushi', 'tile_manju', 'paper_shoji'), seed=0):
    """
    壁の裾の汚れと湿り：地面から h までの垂直な面の頂点色を、地面に近いほど暗く・少し黄土色に（はね上がった泥）。
    場所ごとのむら（低い周波数）を掛ける。上を向いた面（床・犬走り・台の天板）は暗くしない。
    """
    Mi = M.inverted()
    R = np.array(Mi.to_3x3())
    T = np.array(Mi.translation)
    rng = np.random.default_rng(seed)
    f = rng.normal(0, 1.0, (4, 2))
    ph = rng.uniform(0, 6.28, 4)
    tint = np.array(tint, np.float32)
    for ob in objs:
        lib = ob.get('koto_lib', '')
        key = ob.get('koto_key', '')
        if lib in skip or key.startswith('noren') or lib in ('iron', 'lacquer_mark'):
            continue
        me = ob.data
        a = me.color_attributes.get(mats.COLOR_ATTR)
        if a is None or a.domain != 'POINT':
            continue
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) @ R.T + T
        nr = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('normal', nr)
        nz = np.abs(nr.reshape(-1, 3)[:, 2])
        z = co[:, 2]
        t = np.clip(z / h, 0, 1)
        wgt = (1 - t * t * (3 - 2 * t)) * np.clip(1.3 - nz * 1.3, 0, 1)
        nse = np.zeros(len(z))
        for i in range(4):
            nse += np.sin(co[:, 0] * f[i, 0] * 2.2 + co[:, 1] * f[i, 1] * 2.2 + ph[i])
        nse = 0.75 + 0.25 * nse / 2.0
        k = (1 - (1 - dark) * wgt * nse)[:, None]
        tt = 1 - wgt[:, None] * (1 - tint[None, :])
        cur = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', cur)
        cur = cur.reshape(-1, 4)
        cur[:, :3] *= (k * tt).astype(np.float32)
        a.data.foreach_set('color', cur.ravel())
