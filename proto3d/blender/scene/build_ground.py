"""
城門前の一場面の地面（ground_v2.glb）を作る。

    /root/blender-venv/bin/python proto3d/blender/scene/build_ground.py [--quick] [--no-bake]

中身（すべてゲームの絶対座標のまま書き出す。原点に置けばよい）:
- ground_terrain: 細かい範囲（x -20〜20、z -26〜20）の地面。踏み固めた暖かい土の道（中央のわずかな盛り上がり、深さ 2〜3 cm の 2 本の轍、
  真ん中の踏み跡）、町の土、塀ぎわ・空き地・城内の草地（自作の turf）。高さの格子は道・側溝・塀・町家の線に合わせた不等間隔。
  色（3〜8 m の大きな明暗・0.5〜1.5 m の細かな明暗・轍・踏み跡・湿り・塀と町家の根元の締まった土）は頂点色 COLOR_0。
  周りの建物と木を置いたまま焼いた AO は occlusionTexture（TEXCOORD_1、2048 px）。
  同じメッシュに、あとから重ねる物も入れる（同じ AO の画像を使うので、日陰で浮かない）:
    ・道に埋まった平たい石（10〜12 角、上は平ら、土から 0.5〜1.2 cm 出る。まわりの土が縁にかぶさる）。7 割は 4〜9 個のまとまり。
    ・塀と町家の根元の小石、軒・笠の雨落ちの砂利の帯（幅約 0.24 m）。
- ground_far: その外の 200 m までの簡単な地面。細かい範囲の下に 1 m もぐらせてある。
- ground_stone: 側溝の割り石の縁石（長さ・高さ・傾きがそろわない、面取りと角の欠け）、端の石、入口の前の渡り石、大きな石。
- ground_ditch_bed: 側溝の暗く湿った底と、縁石の目地を埋める土。
- ground_fence_bamboo / ground_fence_post: 空き地の低い四つ目垣（竹、黒い棕櫚縄の結び目）と杉丸太の柱。
- ground_grass / ground_fern / ground_azalea: plants.glb の草むら・羊歯・つつじ。草は 3〜8 株のまとまりで、目地にも少し。
当たり判定は ground.meta.json（垣と大きな石）。
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
import time

import bpy
import bmesh
import mathutils
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'lib'))
sys.path.insert(0, str(HERE))
from common import BUILD_DIR, MODELS_DIR, export_glb, g2b, reset, scene_layout, triangles  # noqa: E402
import mats  # noqa: E402
import ground_tex as gtx  # noqa: E402
import assemble as asm  # noqa: E402

L = scene_layout()
OUT = MODELS_DIR / 'ground_v2.glb'
META = HERE / 'ground.meta.json'
TMP = BUILD_DIR / 'scene'

# 細かい範囲（ゲームの座標）
AREA = dict(x0=-20.0, x1=20.0, z0=-26.0, z1=20.0)
ROAD_HW = L['road']['half_width']
RUT_X = 0.78            # 轍の中心（道の中心から）
WALL_HALF = 0.59        # 塀の根元の石の張り出しを含む半分の厚み（walls_v2）
DRIP = 0.81             # 塀の笠の雨落ち（中心から）
EW_Z = -12.0
NS_X = 7.6
NS_Z = (-12.0, 3.0)
FENCE_Z = -7.35         # 空き地の南の垣（路地 z -7.2〜-5.6 は空ける）
FENCE_X = -4.45         # 空き地の道側の垣
TURF_WS = -10.75        # 塀ぎわの草の南の端
TURF_WN = -13.25        # 城内側の塀ぎわの草の北の端
TURF_NSW = 6.3          # 東の塀（南北）の西側の草の西の端
FOOTINGS = [(2.02, 2.86, -12.33, -11.40), (-2.86, -2.02, -12.33, -11.40)]   # 門の礎石（gate_v2）
EARTH_TINT = np.array([0.99, 0.86, 0.70])     # 暖かい土の色（線形の掛け算）
CURB_W = dict(house=0.17, road=0.18)          # 縁石の幅。溝は 0.27 m


def _houses():
    """町家の本体と軒下の三和土（ゲームの座標）。本体の表の壁の位置は machiya の制作と同じ"""
    H = {h['name']: h for h in L['houses']}
    a, b, d = H['machiya_a']['footprint'], H['machiya_b']['footprint'], H['machiya_d']['footprint']
    body = [(a['x0'], a['x0'] + 5.1, a['z0'], a['z1']), (b['x0'], b['x0'] + 5.3, b['z0'], b['z1']),
            (d['x1'] - 4.8, d['x1'], d['z0'], d['z1'])]
    apron = [(a['x0'] + 5.1, a['x0'] + 6.02, a['z0'] - 0.15, a['z1'] + 0.15), (b['x0'] + 5.3, b['x0'] + 6.58, b['z0'] - 0.15, b['z1'] + 0.15),
             (d['x1'] - 5.42, d['x1'] - 4.8, d['z0'] - 0.1, d['z1'] + 0.1)]
    return body, apron


HOUSE_BODY, HOUSE_APRON = _houses()
DITCH = {}
for _d in L['ditches']:
    side = -1 if _d['x'][0] < 0 else 1
    # 地面の穴（石組みの外の端まで）：家側 0.08 m、道側 0.16 m 広げる（縁石 0.17・0.18 m、溝 0.27 m）
    if side < 0:
        hole = (_d['x'][0] - 0.08, _d['x'][1] + 0.16)
        chan = (hole[0] + CURB_W['house'], hole[1] - CURB_W['road'])
    else:
        hole = (_d['x'][0] - 0.16, _d['x'][1] + 0.08)
        chan = (hole[0] + CURB_W['road'], hole[1] - CURB_W['house'])
    DITCH[_d['name']] = dict(side=side, x=tuple(_d['x']), hole=hole, chan=chan, z=(_d['z'][0], _d['z'][1]))
# 入口の前の渡り石（z の範囲）
BRIDGES = {'west': [(-3.55, -1.5), (3.49, 5.31)], 'east': [(6.1, 8.5)]}
# 雨落ちの砂利の帯（ゲームの (x, z) の 2 点。幅 0.2 m）：塀の笠の下（町側・城内側）と町家の妻・裏の軒の下
DRIP_LINES = [
    ((-17.9, EW_Z + DRIP), (-2.95, EW_Z + DRIP)), ((2.95, EW_Z + DRIP), (NS_X - DRIP - 0.1, EW_Z + DRIP)),
    ((NS_X - DRIP, EW_Z + DRIP - 0.1), (NS_X - DRIP, NS_Z[1] - 0.1)), ((NS_X + DRIP, EW_Z + DRIP - 0.1), (NS_X + DRIP, NS_Z[1] - 0.1)),
    ((-17.9, EW_Z - DRIP), (-2.95, EW_Z - DRIP)), ((2.95, EW_Z - DRIP), (17.9, EW_Z - DRIP)),
    ((-10.7, -6.02), (-5.25, -6.02)),                        # 町家 A の北の妻
    ((4.9, 3.43), (6.92, 3.43)), ((8.28, 3.43), (10.0, 3.43)),   # 町家 D の北（板塀の所は空ける）
    ((-11.3, 11.87), (-5.6, 11.87)), ((4.9, 11.2), (10.0, 11.2)),
]


# ---------------------------------------------------------------------------
# ノイズ（周期の配列を双一次補間。ゲームのメートル）
# ---------------------------------------------------------------------------

class Field:
    def __init__(self, seed, period=64.0, n=256, fmin=2.0, fmax=24.0, beta=1.0):
        self.a = mats.snoise((n, n), seed, fmin, fmax, beta)
        self.n = n
        self.p = period

    def __call__(self, x, z):
        x = np.asarray(x, np.float64)
        z = np.asarray(z, np.float64)
        return mats.bilinear(self.a, (x / self.p * self.n).astype(np.float32), (z / self.p * self.n).astype(np.float32)).astype(np.float64)


F_LOW = Field(11, fmin=2, fmax=10)          # 6〜30 m の起伏
F_MID = Field(12, fmin=8, fmax=40)          # 1.5〜8 m
F_RUT = Field(13, fmin=3, fmax=16)
F_RUT2 = Field(14, fmin=3, fmax=16)
F_COL = Field(15, fmin=4, fmax=24)
F_COL2 = Field(16, fmin=16, fmax=64)
F_TURF = Field(17, fmin=4, fmax=30)
F_LOT = Field(18, fmin=4, fmax=18)
F_WARP = Field(19, fmin=4, fmax=18)
F_UVU = Field(20, fmin=3, fmax=9)
F_UVV = Field(21, fmin=3, fmax=9)
F_MAC = Field(23, fmin=8, fmax=21)                  # 3〜8 m の明暗
F_MAC2 = Field(24, fmin=4, fmax=10)                 # 6〜16 m
F_FINE = Field(25, period=16.0, fmin=10, fmax=32)   # 0.5〜1.6 m
F_HUE = Field(26, fmin=4, fmax=14)
F_BAND = Field(27, fmin=6, fmax=24)


def sstep(e0, e1, x):
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def in_rect(x, z, r, pad=0.0):
    x0, x1, z0, z1 = r
    return (x >= x0 - pad) & (x <= x1 + pad) & (z >= z0 - pad) & (z <= z1 + pad)


def wall_rects(pad=0.0):
    h = WALL_HALF + pad
    return [(-18.0 - pad, -2.56, EW_Z - h, EW_Z + h), (2.56, 18.0 + pad, EW_Z - h, EW_Z + h),
            (NS_X - h, NS_X + h, NS_Z[0], NS_Z[1] + pad)]


def rect_dist(x, z, r):
    """四角形の外からの水平の距離（中は 0）"""
    x0, x1, z0, z1 = r
    dx = np.maximum(np.maximum(x0 - x, 0), x - x1)
    dz = np.maximum(np.maximum(z0 - z, 0), z - z1)
    return np.hypot(dx, dz)


def base_dist(x, z):
    """塀・門の礎石・町家の壁の根元からの水平の距離"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    d = np.full(x.shape, 99.0)
    for r in wall_rects() + FOOTINGS + HOUSE_BODY:
        d = np.minimum(d, rect_dist(x, z, r))
    return d


# ---------------------------------------------------------------------------
# 地面の区分
# ---------------------------------------------------------------------------

def is_turf(x, z):
    """草地か（ゲームの座標、配列可）。塀の根元の 0.2〜0.4 m は草を除いた締まった土"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    t = np.zeros(x.shape, bool)
    t |= (x <= FENCE_X) & (z >= EW_Z - WALL_HALF) & (z <= FENCE_Z)                      # 空き地
    t |= (x < -18.0) | (x > 18.0)
    t |= (x < -11.2) & (z > FENCE_Z)                                                     # 町家の裏
    t |= (x > 9.8) & (z > NS_Z[1])                                                       # 町家 D の裏
    t |= (x >= 4.18) & (x <= NS_X) & (z >= EW_Z) & (z <= TURF_WS)                       # 東の塀ぎわ
    t |= (x >= TURF_NSW) & (x <= NS_X) & (z >= EW_Z) & (z <= NS_Z[1])                  # 南北の塀の西
    t |= (x >= NS_X) & (z <= NS_Z[1]) & (z >= EW_Z)                                      # 城内（東の松の庭）
    t |= (z <= EW_Z) & (z >= TURF_WN) & (ax >= 2.9)                                     # 城内側の塀ぎわ
    t |= (z < TURF_WN) & (ax >= 12.0)
    t |= (z > 12.0) & (ax >= 11.0)
    band = base_dist(x, z) < 0.3 + 0.09 * F_BAND(x, z)
    return t & ~band


def height(x, z):
    """地面の高さ（ゲームの y）"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    y = 0.004 * F_LOW(x, z)
    # 道：中央のわずかな盛り上がり、轍（2〜3 cm）、小さな凹凸
    w_road = sstep(ROAD_HW + 0.2, ROAD_HW - 0.3, ax)
    crown = 0.014 * np.clip(1 - (x / ROAD_HW) ** 2, 0, 1)
    rut = np.zeros_like(x)
    for s, F in ((-1, F_RUT), (1, F_RUT2)):
        xc = s * RUT_X + 0.05 * F(0 * x + s * 9.0, z)
        d = (x - xc) / 0.13
        rut -= 0.024 * np.exp(-d * d) * np.clip(0.75 + 0.3 * F(x * 0 + s * 3.0 + 20, z * 1.7), 0.35, 1.2)
    gate = np.exp(-((z - EW_Z) / 1.4) ** 2)
    road = (crown + rut) * (1 - 0.6 * gate) + 0.004 * F_MID(x, z)
    y = y + w_road * road
    # 空き地の小さな起伏
    lot = sstep(-4.6, -5.4, x) * sstep(-11.4, -10.9, z) * sstep(-7.35, -7.9, z) * sstep(-18.2, -17.5, x)
    y = y + lot * 0.03 * (F_LOT(x, z) + 0.4)
    y = y + 0.008 * is_turf(x, z)
    # 建物の足元：塀・門の石は 0 から、町家の三和土は 0.03 なので、その辺りは平らに
    for r in wall_rects(0.35):
        m = in_rect(x, z, r)
        y = np.where(m, np.clip(y, 0.004, 0.02), y)
    gate_m = (ax < 2.9) & (np.abs(z - EW_Z) < 0.85)
    y = np.where(gate_m, 0.018, y)
    for r in HOUSE_BODY + HOUSE_APRON:
        m = in_rect(x, z, r, 0.06)
        y = np.where(m, np.clip(y, -0.012, 0.012), y)
    return y


# ---------------------------------------------------------------------------
# 格子
# ---------------------------------------------------------------------------

def axis_lines(segs, keys, merge=0.045):
    pts = {}
    for a, b, sp in segs:
        n = max(1, int(round((b - a) / sp)))
        for i in range(n + 1):
            pts.setdefault(round(a + (b - a) * i / n, 4), False)
    for k in keys:
        pts[round(k, 4)] = True
    out = []
    for v in sorted(pts):
        if out and v - out[-1][0] < merge:
            if pts[v] and not out[-1][1]:
                out[-1] = (v, True)
            continue
        out.append((v, pts[v]))
    return np.array([v for v, _ in out])


_GRID = None


def grid_lines():
    global _GRID
    if _GRID is not None:
        return _GRID
    xk = [AREA['x0'], AREA['x1'], -ROAD_HW, ROAD_HW, -2.56, 2.56, -2.9, 2.9, -1.8, 1.8, FENCE_X, TURF_NSW,
          NS_X - WALL_HALF, NS_X, NS_X + WALL_HALF, -18.0, 18.0, -12.0, 12.0, -11.2, 9.8, -11.0, 11.0,
          NS_X - WALL_HALF - 0.2, NS_X - WALL_HALF - 0.4, NS_X + WALL_HALF + 0.2, NS_X + WALL_HALF + 0.4, -2.02, 2.02]
    for d in DITCH.values():
        xk += list(d['hole'])
    for b, a in zip(HOUSE_BODY, HOUSE_APRON):
        xk += [b[0], b[1], a[0], a[1]]
    for s in (-1, 1):
        xk += [s * RUT_X + o for o in (-0.26, -0.13, 0.0, 0.13, 0.26)]
    zk = [AREA['z0'], AREA['z1'], EW_Z - WALL_HALF, EW_Z, EW_Z + WALL_HALF, TURF_WS, TURF_WN, FENCE_Z, -5.6, NS_Z[1], 12.0,
          EW_Z + WALL_HALF + 0.2, EW_Z + WALL_HALF + 0.4, EW_Z - WALL_HALF - 0.2, EW_Z - WALL_HALF - 0.4,
          -5.8, -6.0, 3.6, 3.4, 11.6, 11.8, 11.0, 11.2]
    for d in DITCH.values():
        zk += list(d['z'])
    for b in HOUSE_BODY:
        zk += [b[2], b[3]]
    xs = axis_lines([(-20, -12, 0.8), (-12, -5.5, 0.5), (-5.5, -3.4, 0.25), (-3.4, 3.4, 0.25), (3.4, 5.0, 0.25), (5.0, 8.4, 0.4),
                     (8.4, 20, 0.8)], xk)
    zs = axis_lines([(-26, -14.5, 0.7), (-14.5, 4.0, 0.32), (4.0, 12, 0.5), (12, 20, 0.8)], zk)
    _GRID = (xs, zs)
    return _GRID


def warp(X, Z):
    """草と土の境目の格子線を少し波打たせる（境目が定規の線にならないように）。返り値 (X', Z')"""
    X = X.copy()
    Z = Z.copy()
    A, w = 0.14, 0.42
    specs = [('z', TURF_WS, 4.18, NS_X), ('x', TURF_NSW, EW_Z, NS_Z[1]), ('z', TURF_WN, 2.9, 18.0), ('z', TURF_WN, -18.0, -2.9),
             ('x', -12.0, -26.0, TURF_WN), ('x', 12.0, -26.0, TURF_WN), ('x', -11.2, FENCE_Z, 12.0), ('x', 9.8, NS_Z[1], 20.0),
             ('x', -11.0, 12.0, 20.0), ('x', 11.0, 12.0, 20.0), ('z', 12.0, -20, -11.0), ('z', 12.0, 11.0, 20.0)]
    for ax, c, lo, hi in specs:
        if ax == 'z':
            m = (np.abs(Z - c) < w) & (X >= lo - 0.3) & (X <= hi + 0.3)
            f = F_WARP(X, 0 * X + c * 3.1) * A
            Z = np.where(m, Z + f * (1 - np.abs(Z - c) / w), Z)
        else:
            m = (np.abs(X - c) < w) & (Z >= lo - 0.3) & (Z <= hi + 0.3)
            f = F_WARP(0 * Z + c * 3.1 + 40, Z) * A
            X = np.where(m, X + f * (1 - np.abs(X - c) / w), X)
    return X, Z


def grid_interp(G, x, z):
    """格子の頂点の値 G (nx, nz) を、地面と同じ三角で補間（ゆがめる前の格子）"""
    xs, zs = grid_lines()
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
    j = np.clip(np.searchsorted(zs, z) - 1, 0, len(zs) - 2)
    fx = np.clip((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1)
    fz = np.clip((z - zs[j]) / (zs[j + 1] - zs[j]), 0, 1)
    h00, h10, h11, h01 = G[i, j], G[i + 1, j], G[i + 1, j + 1], G[i, j + 1]
    if G.ndim == 3:
        fx, fz = fx[..., None], fz[..., None]
    # 対角 (i,j)-(i+1,j+1)：fx>fz なら (00,10,11)、それ以外は (00,11,01)
    y1 = h00 + fx * (h10 - h00) + fz * (h11 - h10)
    y2 = h00 + fz * (h01 - h00) + fx * (h11 - h01)
    up = (fx > fz)
    return np.where(up, y1, y2)


_HGRID = None


def terrain_height_at(x, z):
    """作った地面の高さ（ゆがめる前の格子の三角で補間。石を地面に沿わせるため）"""
    global _HGRID
    if _HGRID is None:
        xs, zs = grid_lines()
        X0, Z0 = np.meshgrid(xs, zs, indexing='ij')
        _HGRID = height(X0, Z0)
    return grid_interp(_HGRID, x, z)


# ---------------------------------------------------------------------------
# 道具：メッシュを作る
# ---------------------------------------------------------------------------

def mesh_object(name, verts_b, faces, *, mat_slots=(), face_mats=None, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts_b], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    o = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(o)
    for m in mat_slots:
        me.materials.append(m)
    if face_mats is not None:
        me.polygons.foreach_set('material_index', np.asarray(face_mats, np.int32))
    return o


def set_point_colors(o, cols):
    me = o.data
    a = me.color_attributes.get(mats.COLOR_ATTR) or me.color_attributes.new(mats.COLOR_ATTR, 'FLOAT_COLOR', 'POINT')
    c = np.ones((len(me.vertices), 4), np.float32)
    c[:, :3] = cols
    a.data.foreach_set('color', c.ravel())
    mats._set_active_color(me, mats.COLOR_ATTR)


def get_point_colors(o):
    a = o.data.color_attributes[mats.COLOR_ATTR]
    c = np.empty(len(a.data) * 4, np.float32)
    a.data.foreach_get('color', c)
    return c.reshape(-1, 4)[:, :3].copy()


def set_loop_uv(o, name, uv_per_vertex):
    me = o.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    uv.data.foreach_set('uv', np.asarray(uv_per_vertex, np.float32)[lv].ravel())
    return uv


def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


def earth_uv(x, z, tile=4.0):
    """土の UV（地面と同じ：ゆっくりゆがめた世界座標）"""
    return np.stack([(x + 0.16 * F_UVU(x, z)) / tile, (-z + 0.16 * F_UVV(x, z)) / tile], -1)


def lightmap_uv(x, z):
    return np.stack([(x - AREA['x0']) / (AREA['x1'] - AREA['x0']), (-z + AREA['z1']) / (AREA['z1'] - AREA['z0'])], -1)


# ---------------------------------------------------------------------------
# 地面（細かい範囲）
# ---------------------------------------------------------------------------

class Terrain:
    """格子の情報（あとで焼いた AO を重ねる物に写すため）"""
    xs = zs = used = None
    cols0 = None
    aog = None


def build_terrain():
    xs, zs = grid_lines()
    nx, nz = len(xs), len(zs)
    X0, Z0 = np.meshgrid(xs, zs, indexing='ij')             # 区分・削除はゆがめる前の格子で決める
    Y = height(X0, Z0)
    # 外の地面（y -0.04〜-0.06）となめらかにつなぐ：端の 1.5 m で下げる
    db = np.minimum(np.minimum(X0 - AREA['x0'], AREA['x1'] - X0), np.minimum(Z0 - AREA['z0'], AREA['z1'] - Z0))
    sb = sstep(0.0, 1.5, db)
    Y = Y * sb - 0.04 * (1 - sb)
    X, Z = warp(X0, Z0)
    idx = np.arange(nx * nz).reshape(nx, nz)
    # 面（四角を 2 つの三角に。対角は (i,j)-(i+1,j+1)）
    i, j = np.meshgrid(np.arange(nx - 1), np.arange(nz - 1), indexing='ij')
    i, j = i.ravel(), j.ravel()
    cx = (xs[i] + xs[i + 1]) / 2
    cz = (zs[j] + zs[j + 1]) / 2
    drop = np.zeros(cx.shape, bool)
    for r in HOUSE_BODY:
        drop |= in_rect(cx, cz, (r[0] + 0.15, r[1] - 0.15, r[2] + 0.15, r[3] - 0.15))
    for r in wall_rects(-0.12):
        drop |= in_rect(cx, cz, r)
    for d in DITCH.values():
        drop |= in_rect(cx, cz, (d['hole'][0], d['hole'][1], d['z'][0], d['z'][1]))
    turf = is_turf(cx, cz)
    keep = ~drop
    i, j, turf = i[keep], j[keep], turf[keep]
    a, b, c, d_ = idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]
    # Blender では y が -z なので、上から見て反時計回りになる向きに並べる
    tris = np.concatenate([np.stack([a, d_, c], -1), np.stack([a, c, b], -1)])
    tmat = np.concatenate([turf, turf]).astype(np.int32)
    # 使われない頂点を詰める
    used = np.unique(tris)
    remap = -np.ones(nx * nz, np.int64)
    remap[used] = np.arange(len(used))
    tris = remap[tris]
    Xf, Zf, Yf, X0f, Z0f, SBf = (A.ravel()[used] for A in (X, Z, Y, X0, Z0, sb))
    verts_b = np.stack([Xf, -Zf, Yf], -1)
    m_earth = mats.get('earth_road', vcol=True)
    m_turf = gtx.material('turf', gtx.build_turf(), gtx.TURF_TILE)
    o = mesh_object('ground_terrain', verts_b, tris, mat_slots=[m_earth, m_turf], face_mats=tmat)
    smooth(o)
    me = o.data
    # UV 0：土 4 m・草 2 m の繰り返しを、ゆっくりゆがめて繰り返しの格子を目立たなくする
    wu = 0.16 * F_UVU(Xf, Zf) * SBf
    wv = 0.16 * F_UVV(Xf, Zf) * SBf
    uv = me.uv_layers.new(name='UVMap')
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    pm = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('material_index', pm)
    tile = np.where(np.repeat(pm, 3) == 1, gtx.TURF_TILE[0], 4.0)
    U = (Xf[lv] + wu[lv]) / tile
    V = (-Zf[lv] + wv[lv]) / tile
    uv.data.foreach_set('uv', np.stack([U, V], -1).astype(np.float32).ravel())
    # UV 1：真上からの投影（AO の焼き込み用、重なりなし）
    set_loop_uv(o, 'lightmap', lightmap_uv(Xf, Zf))
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    # 頂点色：大きな明暗・細かな明暗・轍・踏み跡・湿り・根元の締まった土・草の色味（線形の掛け算、1 を超えない）
    cols = terrain_colors(X0f, Z0f, Yf)
    set_point_colors(o, cols)
    Terrain.xs, Terrain.zs, Terrain.used, Terrain.cols0 = xs, zs, used, cols
    print(f'terrain: {len(xs)}x{len(zs)} lines, {len(tris)} tris')
    return o


def terrain_colors(x, z, y):
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    road = sstep(ROAD_HW + 0.2, ROAD_HW - 0.4, ax)
    # 大きな明暗（3〜8 m と 6〜16 m、±15% 前後）と細かな明暗（0.5〜1.5 m、±6%）
    mac = np.clip(0.075 * F_MAC(x, z) + 0.05 * F_MAC2(x, z), -0.18, 0.17)
    fine = np.clip(0.035 * F_FINE(x, z), -0.07, 0.07)
    v = 0.95 * (1 + mac) * (1 + fine)
    hue = F_HUE(x, z)
    col = v[:, None] * EARTH_TINT[None] * np.stack([1 + 0.025 * hue, np.ones_like(hue), 1 - 0.045 * hue], -1)
    # 轍：踏み固められて暗い（-15%）
    rut = np.zeros_like(x)
    for s in (-1, 1):
        rut = np.maximum(rut, np.exp(-((x - s * RUT_X) / 0.16) ** 2))
    gate = np.exp(-((z - EW_Z) / 1.4) ** 2)
    col *= (1 - 0.15 * rut * road * (1 - 0.5 * gate))[:, None]
    # 真ん中の踏み跡：明るく（+8%）、少し暖かく
    worn = np.exp(-((x - 0.15) / 0.6) ** 2) * road
    col *= ((1 + 0.08 * worn)[:, None] * np.stack([1 + 0.02 * worn, np.ones_like(worn), 1 - 0.03 * worn], -1))
    # 側溝の縁：湿って暗い
    for d in DITCH.values():
        dx = np.minimum(np.abs(x - d['hole'][0]), np.abs(x - d['hole'][1]))
        inz = (z > d['z'][0] - 0.3) & (z < d['z'][1] + 0.3)
        col *= (1 - 0.10 * np.exp(-(dx / 0.3) ** 2) * inz)[:, None]
    # 城内：少し灰色がかった土
    castle = sstep(EW_Z - 0.6, EW_Z - 2.0, z)
    col *= (1 - 0.04 * castle)[:, None]
    col[:, 2] *= 1 + 0.04 * castle
    # 草地：黄みと緑みのむら、松の下は枯れ葉色
    t = is_turf(x, z)
    n1 = F_COL(x, z)
    n2 = F_COL2(x, z)
    vt = 0.965 + 0.035 * n1 + 0.015 * n2 + 0.06 * np.clip(F_MAC(x, z), -1.5, 1.5)
    tn = F_TURF(x, z)
    tint = np.stack([1 + 0.07 * tn, 1 + 0.02 * tn, 1 - 0.06 * tn], -1) * vt[:, None]
    pine = np.array(next(tt['pos'] for tt in L['trees'] if tt['name'] == 'pine_big'))
    dp = np.hypot(x - pine[0], z - pine[1])
    litter = np.exp(-(dp / 3.0) ** 2)
    tint *= np.stack([1 + 0.10 * litter, 1 - 0.04 * litter, 1 - 0.14 * litter], -1)
    col = np.where(t[:, None], tint, col)
    # 塀・礎石・町家の根元：締まった土（-15%）
    band = sstep(0.48, 0.18, base_dist(x, z) - 0.06 * F_BAND(x, z))
    col *= (1 - 0.15 * band * ~t)[:, None]
    return np.clip(col, 0.25, 1.0)


# ---------------------------------------------------------------------------
# 外の地面（200 m まで）
# ---------------------------------------------------------------------------

def build_far():
    ring = [19, 24, 32, 45, 65, 95, 140, 200]
    xs = sorted(set([-v for v in ring] + ring + [-ROAD_HW, ROAD_HW, -11.0, 11.0]))
    zs = sorted(set([-25 - (v - 19) for v in ring] + [19 + (v - 19) for v in ring] + [-12.0, 0.0, 10.0]))
    xs, zs = np.array(xs, float), np.array(zs, float)
    nx, nz = len(xs), len(zs)
    X, Z = np.meshgrid(xs, zs, indexing='ij')
    inner = (np.abs(X) <= 19.5) & (Z >= -25.5) & (Z <= 19.5)
    Y = np.where(inner, -0.06, -0.04)
    idx = np.arange(nx * nz).reshape(nx, nz)
    faces, fm = [], []
    for i in range(nx - 1):
        for j in range(nz - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if -19 < cx < 19 and -25 < cz < 19:
                continue
            earth = not bool(is_turf(np.array([cx]), np.array([cz]))[0])
            faces.append((idx[i, j], idx[i, j + 1], idx[i + 1, j + 1], idx[i + 1, j]))
            fm.append(0 if earth else 1)
    verts_b = np.stack([X.ravel(), -Z.ravel(), Y.ravel()], -1)
    m_earth = mats.get('earth_road', vcol=True)
    m_turf = gtx.material('turf', gtx.build_turf(), gtx.TURF_TILE)
    o = mesh_object('ground_far', verts_b, faces, mat_slots=[m_earth, m_turf], face_mats=fm)
    me = o.data
    uv = me.uv_layers.new(name='UVMap')
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    pm = np.array([p.material_index for p in me.polygons for _ in p.loop_indices])
    tile = np.where(pm == 1, gtx.TURF_TILE[0], 4.0)
    P = verts_b[lv]
    uv.data.foreach_set('uv', np.stack([P[:, 0] / tile, P[:, 1] / tile], -1).astype(np.float32).ravel())
    set_point_colors(o, terrain_colors(X.ravel(), Z.ravel(), Y.ravel()))
    return o


# ---------------------------------------------------------------------------
# 割り石（側溝の縁石・端の石・渡り石）と大きな石
# ---------------------------------------------------------------------------

def split_stone(bm, col_layer, rng, x0, x1, z0, z1, top, bot, *, bevel, color, tilt=0.03, chip=0.0, yaw=0.015):
    """
    割り石 1 個（ゲームの座標の範囲、上端 top・下端 bot）。上の縁は面取り（bevel）、平面は角を落とした 8 角。
    上面は少しうねり、chip>0 なら角の 1 つが欠ける。傾き σ tilt。底の面は作らない。返り値 (上面の最も高い点の y, 頂点)
    """
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    hx, hz = (x1 - x0) / 2, (z1 - z0) / 2
    b = min(bevel, 0.4 * min(hx, hz))
    c = min(0.3 * min(hx, hz), b * 1.2)
    # 平面の輪郭（上から見て反時計回り：Blender の (X, Y) = (x, -z)）
    P = np.array([(hx - c, hz), (hx, hz - c), (hx, -hz + c), (hx - c, -hz), (-hx + c, -hz), (-hx, -hz + c), (-hx, hz - c), (-hx + c, hz)])
    # 輪郭は Blender の (X, Y) で：X = x、Y = -z。上の並びは z を正にとったので Y に直すと時計回り → 逆順にする
    P = P[::-1].copy()
    P += rng.normal(0, 0.006, P.shape)
    sgn = np.sign(P)
    inset = P - sgn * np.array([b, b]) * (np.abs(P) > b + 0.01)
    k = len(P)
    top_j = rng.uniform(-0.003, 0.003, k)
    ring_top = [(inset[i, 0], inset[i, 1], top + top_j[i]) for i in range(k)]
    ring_edge = [(P[i, 0], P[i, 1], top - b * rng.uniform(0.65, 0.95)) for i in range(k)]
    ring_bot = [(P[i, 0] * 1.02, P[i, 1] * 1.02, bot) for i in range(k)]
    centre = (rng.normal(0, 0.02 * hx), rng.normal(0, 0.02 * hz), top + rng.uniform(-0.002, 0.006))
    if chip > 0:
        # 欠けた角：輪郭の 2 点（角を落とした所）を下げ、上面の点を内へ寄せる
        q = int(rng.integers(0, 4)) * 2
        for i in (q, (q + 1) % k):
            x, y, zz = ring_top[i]
            ring_top[i] = (x * 0.8, y * 0.8, zz - chip * 0.7)
            x, y, zz = ring_edge[i]
            ring_edge[i] = (x, y, zz - chip)
    # 傾き（上面の中心まわり）
    R = mathutils.Euler((rng.normal(0, tilt), rng.normal(0, tilt), rng.normal(0, yaw))).to_matrix()
    piv = mathutils.Vector((0, 0, top))
    base = mathutils.Vector((cx, -cz, 0))

    def mk(p):
        v = bm.verts.new(base + piv + R @ (mathutils.Vector(p) - piv))
        v[col_layer] = color
        return v
    vc = mk(centre)
    vt = [mk(p) for p in ring_top]
    ve = [mk(p) for p in ring_edge]
    vb = [mk(p) for p in ring_bot]
    for i in range(k):
        i1 = (i + 1) % k
        bm.faces.new((vc, vt[i], vt[i1]))
        bm.faces.new((vt[i], ve[i], ve[i1], vt[i1]))
        bm.faces.new((ve[i], vb[i], vb[i1], ve[i1]))
    # 面取りの上下の縁は角を立てる（なめらかな陰にすると枕のように丸く見える）
    for ring_ in (vt, ve):
        for i in range(k):
            e = bm.edges.get((ring_[i], ring_[(i + 1) % k]))
            if e is not None:
                e.smooth = False
    return max(v.co.z for v in vt + [vc]), [vc, *vt, *ve, *vb]


def curb_color(rng, base=(0.62, 0.585, 0.53)):
    """縁石の色（前の版より約 3 割暗く、石ごとに ±15%）"""
    k = rng.uniform(0.85, 1.15)
    w = rng.normal(0, 0.025)
    return (base[0] * k * (1 + w), base[1] * k, base[2] * k * (1 - w), 1.0)


def stone_blocks(bm, col_layer):
    """側溝の縁石・端の石・渡り石。返り値 目地の位置（草を生やす候補）: [(x, z, 側)]"""
    rng = np.random.default_rng(31)
    joints = []
    for name, d in DITCH.items():
        s = d['side']
        (hx0, hx1), (z0, z1) = d['hole'], d['z']
        (cx0, cx1) = d['chan']
        # 道側と家側の縁石の列（x の範囲、上端の地面からの高さの範囲）
        if s < 0:
            rows = [((hx0, cx0), 'house'), ((cx1, hx1), 'road')]
        else:
            rows = [((hx0, cx0), 'road'), ((cx1, hx1), 'house')]
        for (xa, xb), kind in rows:
            z = z0 + 0.16
            zend = z1 - 0.16
            while z < zend - 0.05:
                ln = min(rng.uniform(0.35, 1.1), zend - z)
                if zend - (z + ln) < 0.3:
                    ln = zend - z
                gap = rng.uniform(0.01, 0.03)
                zc = z + ln / 2
                g = float(terrain_height_at(np.array([(xa + xb) / 2]), np.array([zc]))[0])
                if kind == 'road':
                    top = g + rng.uniform(0.004, 0.02)
                else:
                    top = max(g, 0.012) + rng.uniform(0.018, 0.045)
                under_bridge = any(za - 0.1 < zc < zb + 0.1 for za, zb in BRIDGES[name])
                if under_bridge:
                    top = min(top, 0.03)          # 渡り石の下（渡り石の上に出ないように）
                chip = rng.uniform(0.015, 0.03) if rng.random() < 0.3 else 0.0
                ymax, vs = split_stone(bm, col_layer, rng, xa + 0.006, xb - 0.006, z + gap / 2, z + ln - gap / 2,
                                       top, -0.34, bevel=rng.uniform(0.03, 0.045), color=curb_color(rng), chip=chip)
                lim = (g + 0.03) if kind == 'road' else 0.03 if under_bridge else 9.0
                if ymax > lim:
                    # 道側の上端は道から 3 cm まで（出すぎた石は沈める）
                    for v in vs:
                        v.co.z -= ymax - lim
                if z + ln < zend - 0.05:
                    joints.append(((xa + xb) / 2, z + ln, kind, s))
                z += ln
        # 両端の石（溝をふさぐ）
        for za, zb in ((z0, z0 + 0.16), (z1 - 0.16, z1)):
            g = float(terrain_height_at(np.array([(hx0 + hx1) / 2]), np.array([(za + zb) / 2]))[0])
            split_stone(bm, col_layer, rng, hx0 + 0.005, hx1 - 0.005, za + 0.005, zb - 0.005, g + 0.012, -0.34, bevel=0.03,
                        color=curb_color(rng), tilt=0.012)
        # 渡り石（入口の前の平たい板石）
        for (za, zb) in BRIDGES[name]:
            n = max(1, int(round((zb - za) / 0.7)))
            w = (zb - za) / n
            for k in range(n):
                split_stone(bm, col_layer, rng, hx0 - 0.05 + rng.uniform(-0.02, 0.02), hx1 + 0.05 + rng.uniform(-0.02, 0.02),
                            za + k * w + 0.012, za + (k + 1) * w - 0.012, 0.065 + rng.uniform(-0.008, 0.006), -0.05,
                            bevel=rng.uniform(0.025, 0.04), color=curb_color(rng, (0.66, 0.635, 0.59)), tilt=0.01,
                            chip=rng.uniform(0.01, 0.02) if rng.random() < 0.35 else 0.0)
    return joints


ROCKS = [  # ゲームの (x, z, 半径, 高さの比, 細かさ)
    (4.95, -10.85, 0.42, 0.55, 2), (5.75, -10.55, 0.28, 0.5, 2), (-3.05, -11.05, 0.26, 0.5, 2),
    (-12.6, -10.55, 0.5, 0.45, 1), (-9.9, -8.05, 0.34, 0.5, 1), (-15.2, -8.3, 0.4, 0.45, 1),
    (6.72, -4.2, 0.34, 0.5, 1), (6.75, 0.9, 0.3, 0.5, 1), (-6.4, -14.3, 0.46, 0.5, 1), (5.4, -14.6, 0.42, 0.5, 1),
]


def rocks(bm, col_layer):
    rng = np.random.default_rng(51)
    for x, z, r, hr, sub in ROCKS:
        ret = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        vs = ret['verts']
        ph = rng.uniform(0, 100, 6)
        rot = rng.uniform(0, math.tau)
        asp = rng.uniform(0.7, 0.95)
        base = float(terrain_height_at(np.array([x]), np.array([z]))[0])
        k = rng.uniform(0.85, 1.08)
        colr = (0.78 * k, 0.745 * k, 0.69 * k, 1.0)
        for v in vs:
            p = v.co.copy()
            n = (math.sin(3.1 * p.x + ph[0]) * math.sin(2.7 * p.y + ph[1]) + 0.6 * math.sin(5.3 * p.z + ph[2] + 2 * p.x)
                 + 0.35 * math.sin(9.1 * p.y + ph[3] + 3 * p.z))
            s = 1 + 0.12 * n
            q = mathutils.Vector((p.x * r * s, p.y * r * asp * s, p.z * r * hr * s))
            if q.z > 0:
                q.z *= 1 - 0.25 * (q.z / (r * hr + 1e-6)) ** 2   # 上を少し平たく
            q = mathutils.Matrix.Rotation(rot, 3, 'Z') @ q
            v.co = mathutils.Vector((x + q.x, -z + q.y, base + q.z - r * hr * 0.28))
            v[col_layer] = colr
        # 地面の下の面は消す
        for f in [f for f in {f for v in vs for f in v.link_faces} if all(v.co.z < base - 0.05 for v in f.verts)]:
            bm.faces.remove(f)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')


def build_stones():
    bm = bmesh.new()
    col_layer = bm.verts.layers.float_color.new(mats.COLOR_ATTR)
    joints = stone_blocks(bm, col_layer)
    rocks(bm, col_layer)
    me = bpy.data.meshes.new('ground_stone')
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('ground_stone', me)
    bpy.context.scene.collection.objects.link(o)
    mats._set_active_color(me, mats.COLOR_ATTR)
    mats.assign(o, 'stone_granite', vcol=True)
    smooth(o)
    bpy.context.view_layer.update()
    mats.uv_box(o)
    return o, joints


def build_ditch_beds():
    """溝の底（暗く湿った土）と、縁石の目地を埋める土（縁石の下に通す帯）。返り値 (物体, 目地の土の頂点の範囲)"""
    verts, faces, cols = [], [], []
    rng = np.random.default_rng(61)
    for d in DITCH.values():
        (hx0, hx1), (z0, z1) = d['hole'], d['z']
        cx0, cx1 = d['chan']
        n = max(2, int((z1 - z0) / 0.5))
        base = len(verts)
        for k in range(n + 1):
            z = z0 + (z1 - z0) * k / n
            y = -0.26 + rng.uniform(-0.012, 0.012)
            verts += [(cx0 - 0.02, -z, y), ((cx0 + cx1) / 2, -z, y - 0.015), (cx1 + 0.02, -z, y)]
            w = rng.uniform(0.92, 1.05)
            cols += [(0.40 * w, 0.38 * w, 0.355 * w)] * 3
        for k in range(n):
            a = base + k * 3
            faces += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
    fill0 = len(verts)
    for d in DITCH.values():
        (hx0, hx1), (z0, z1) = d['hole'], d['z']
        cx0, cx1 = d['chan']
        for xa, xb in ((hx0 - 0.03, cx0 - 0.012), (cx1 + 0.012, hx1 + 0.03)):
            n = max(2, int((z1 - z0) / 0.4))
            base = len(verts)
            for k in range(n + 1):
                z = z0 + (z1 - z0) * k / n
                ga, gb = terrain_height_at(np.array([xa, xb]), np.array([z, z]))
                house = (d['side'] < 0 and xa < cx0) or (d['side'] > 0 and xa > cx1)
                ya, yb = (max(ga, 0.012) + 0.006, max(gb, 0.012) + 0.006) if house else (ga - 0.004, gb - 0.004)
                verts += [(xa, -z, ya), (xb, -z, yb)]
                c = terrain_colors(np.array([xa, xb]), np.array([z, z]), None) * 0.72
                cols += [tuple(c[0]), tuple(c[1])]
            for k in range(n):
                a = base + k * 2
                faces.append((a, a + 2, a + 3, a + 1))
    o = mesh_object('ground_ditch_bed', verts, faces, mat_slots=[mats.get('earth_road', vcol=True)])
    # 面は上向きに（Y が -z なので並びを確かめる）
    for p in o.data.polygons:
        if p.normal.z < 0:
            p.flip()
    smooth(o)
    bpy.context.view_layer.update()
    mats.uv_box(o)
    set_point_colors(o, np.array(cols))
    return o, (fill0, len(verts))


# ---------------------------------------------------------------------------
# 重ねる物（地面のメッシュに入れる）：埋まった平たい石・小石・雨落ちの砂利
# ---------------------------------------------------------------------------

class Overlay:
    def __init__(self):
        self.v = []       # ゲームの座標 (x, y, z)
        self.f = []       # 三角（頂点の番号）
        self.fm = []      # 0 土（石のまわりにかぶさる土）、1 石、2 砂利
        self.col = []     # 自分の色（あとで地面の AO を掛ける）

    def add(self, x, y, z, col):
        self.v.append((x, y, z))
        self.col.append(col)
        return len(self.v) - 1

    def tri(self, a, b, c, m):
        # 上を向くように（ゲームの座標で上から見て、Blender の Y = -z）
        pa, pb, pc = (np.array(self.v[i]) for i in (a, b, c))
        e1, e2 = pb - pa, pc - pa
        nz = e1[0] * (-e2[2]) - (-e1[2]) * e2[0]
        self.f.append((a, b, c) if nz >= 0 else (a, c, b))
        self.fm.append(m)


def _ok_ground(x, z, r):
    """重ねる石を置けるか（建物・塀・溝・渡り石・門の礎石・草地・轍を避ける）"""
    ax = abs(x)
    if any(in_rect(x, z, rr, r + 0.08) for rr in HOUSE_BODY + HOUSE_APRON) or any(in_rect(x, z, rr, r + 0.1) for rr in wall_rects()):
        return False
    if any(in_rect(x, z, (d['hole'][0], d['hole'][1], d['z'][0], d['z'][1]), r + 0.06) for d in DITCH.values()):
        return False
    if 1.7 < ax < 3.05 and abs(z - EW_Z) < 1.0:
        return False
    if ax < 2.1 and abs(z - EW_Z) < 0.5:
        return False
    if bool(is_turf(np.array([x]), np.array([z]))[0]):
        return False
    if ax < ROAD_HW and abs(ax - RUT_X) < r + 0.14:
        return False
    if any(math.hypot(x - rx, z - rz) < rr + r + 0.06 for rx, rz, rr, *_ in ROCKS):
        return False
    if (abs(x - FENCE_X) < r + 0.12 and z < FENCE_Z + 0.1) or (abs(z - FENCE_Z) < r + 0.12 and x < FENCE_X + 0.1):
        return False
    return True


STONE_CLUSTERS = [  # ゲームの (x, z, 半径, 個数)：道の端、門の前、渡り石のそば
    (-2.75, -9.5, 0.95, 7), (2.8, -8.1, 1.0, 6), (-2.85, -4.0, 0.8, 5), (2.7, -1.2, 0.9, 6), (-2.6, 1.9, 0.7, 4),
    (2.95, 7.3, 0.8, 5), (-2.85, 5.6, 0.8, 5), (2.6, -14.6, 1.0, 6), (-2.5, -17.0, 1.1, 6),
    (-1.25, -10.3, 1.1, 8), (1.45, -10.7, 0.9, 6), (0.2, -13.5, 1.0, 6), (-2.9, 10.2, 0.9, 5), (3.0, 13.6, 0.9, 5),
]


def stone_layout():
    """埋まった平たい石の位置と半径（7 割は 4〜9 個のまとまり、残りはばらばら）"""
    rng = np.random.default_rng(41)
    pts = []

    def free(x, z, r):
        return _ok_ground(x, z, r) and all((x - px) ** 2 + (z - pz) ** 2 > (r + pr + 0.035) ** 2 for px, pz, pr in pts)
    for cx, cz, cr, n in STONE_CLUSTERS:
        k = tries = 0
        while k < n and tries < 400:
            tries += 1
            a, dd = rng.uniform(0, math.tau), cr * math.sqrt(rng.random())
            x, z = cx + dd * math.cos(a), cz + dd * math.sin(a)
            r = 0.10 + 0.20 * rng.random() ** 1.6
            if free(x, z, r):
                pts.append((x, z, r))
                k += 1
    nclu = len(pts)
    tries = 0
    while len(pts) < 110 and tries < 20000:
        tries += 1
        x, z = rng.uniform(-3.3, 3.3), rng.uniform(-24.0, 18.0)
        if rng.random() < 0.25:
            x, z = rng.uniform(4.3, 6.2), rng.uniform(-10.4, 2.6)
        r = 0.08 + 0.12 * rng.random() ** 1.5
        if abs(x - 0.15) < 0.5 and rng.random() < 0.7:       # 真ん中の踏み跡には少なく
            continue
        if free(x, z, r):
            pts.append((x, z, r))
    print(f'embedded stones: {len(pts)} ({nclu} in clusters)')
    return pts


def stone_outline(rng, r):
    """割れた平たい石の輪郭：5〜7 個の角（半径 0.8〜1.15 r）をまっすぐに近い辺でつなぐ。返り値 (角度, 半径の倍率) 10〜14 点"""
    m = int(rng.integers(5, 8))
    while True:
        a = np.sort(rng.uniform(0, math.tau, m))
        if np.min(np.diff(np.r_[a, a[0] + math.tau])) > 0.55:
            break
    rc = rng.uniform(0.8, 1.15, m)
    th, rad = [], []
    for i in range(m):
        a0, a1 = a[i], (a[(i + 1) % m] + (math.tau if i == m - 1 else 0))
        p0 = np.array([math.cos(a0), math.sin(a0)]) * rc[i]
        p1 = np.array([math.cos(a1), math.sin(a1)]) * rc[(i + 1) % m]
        for t in ((0.0, 0.5) if (a1 - a0) > 0.9 else (0.0,)):
            q = p0 + (p1 - p0) * t
            if t:
                q *= 1 + rng.uniform(-0.02, 0.07)
            th.append(math.atan2(q[1], q[0]) % math.tau)
            rad.append(float(np.hypot(*q)))
    o = np.argsort(th)
    return np.array(th)[o], np.array(rad)[o]


def add_flat_stone(ov, rng, x, z, r):
    """土から 0.5〜1.2 cm 出た平たい割れ石（角のある 10〜14 角）と、縁にかぶさる土"""
    th, radj = stone_outline(rng, r)
    seg = len(th)
    asp = rng.uniform(0.5, 1.0)
    rot = rng.uniform(0, math.tau)

    def ring(f, add=0.0):
        f = np.broadcast_to(np.asarray(f, np.float64), th.shape)
        lx = np.cos(th) * (r * radj * f + add)
        lz = np.sin(th) * (r * radj * f * asp + add)
        return x + lx * math.cos(rot) - lz * math.sin(rot), z + lx * math.sin(rot) + lz * math.cos(rot)
    k = rng.uniform(0.88, 1.12)
    w = rng.normal(0, 0.025)
    sc = np.array([1.0 * (1 + w), 0.88, 0.73 * (1 - w)]) * 0.72 * k        # 土の明るさの ±12%、土に近い暖かい灰色
    rx, rz = ring(1.0)
    g_rim = terrain_height_at(rx, rz)
    top = float(g_rim.max()) + rng.uniform(0.005, 0.012)
    tilt = rng.normal(0, 0.004, 2)

    def ty(px, pz):
        return top + tilt[0] * (px - x) / max(r, 0.05) + tilt[1] * (pz - z) / max(r, 0.05)
    c = ov.add(x, ty(x, z) + rng.uniform(0.0, 0.002), z, tuple(sc))
    mx, mz = ring(0.6)
    vm = [ov.add(mx[i], ty(mx[i], mz[i]) + rng.uniform(-0.0015, 0.0015), mz[i], tuple(sc * rng.uniform(0.96, 1.04))) for i in range(seg)]
    vr = [ov.add(rx[i], ty(rx[i], rz[i]) - 0.004, rz[i], tuple(sc * 0.96)) for i in range(seg)]
    for i in range(seg):
        i1 = (i + 1) % seg
        ov.tri(c, vm[i], vm[i1], 1)
        ov.tri(vm[i], vr[i], vr[i1], 1)
        ov.tri(vm[i], vr[i1], vm[i1], 1)
    # かぶさる土：内の端は石の縁より内（0.8〜0.95、ところどころ深く。石の面より 1.2 mm 上）、外の端は地面の少し下
    fin = np.clip(rng.uniform(0.84, 0.96, seg) - 0.1 * (rng.random(seg) < 0.2), 0.7, 0.96)
    sx, sz = ring(fin)
    ox, oz = ring(1.0, 0.035 + 0.3 * r)
    go = terrain_height_at(ox, oz)
    ci = terrain_colors(sx, sz, None)
    co = terrain_colors(ox, oz, None)
    drop = 0.004 * (fin - 0.6) / 0.4                      # 石の面の高さ（中の輪 0.6 から縁 1.0 へ 4 mm 下がる）
    si = [ov.add(sx[i], ty(sx[i], sz[i]) - drop[i] + 0.0012, sz[i], tuple(ci[i])) for i in range(seg)]
    so = [ov.add(ox[i], go[i] - 0.003, oz[i], tuple(co[i])) for i in range(seg)]
    for i in range(seg):
        i1 = (i + 1) % seg
        ov.tri(si[i], so[i], so[i1], 0)
        ov.tri(si[i], so[i1], si[i1], 0)


def add_pebble(ov, rng, x, z, r, col):
    seg = 6
    th = np.arange(seg) / seg * math.tau + rng.uniform(0, 1)
    rr = r * (1 + 0.15 * rng.standard_normal(seg))
    asp = rng.uniform(0.6, 1.0)
    g = float(terrain_height_at(np.array([x]), np.array([z]))[0])
    h = r * rng.uniform(0.35, 0.6)
    c = ov.add(x, g + h, z, col)
    mid = [ov.add(x + math.cos(t) * q * 0.62, g + h * 0.72, z + math.sin(t) * q * 0.62 * asp, col) for t, q in zip(th, rr)]
    rim = [ov.add(x + math.cos(t) * q, g - 0.004, z + math.sin(t) * q * asp, tuple(np.array(col) * 0.9)) for t, q in zip(th, rr)]
    for i in range(seg):
        i1 = (i + 1) % seg
        ov.tri(c, mid[i], mid[i1], 1)
        ov.tri(mid[i], rim[i], rim[i1], 1)
        ov.tri(mid[i], rim[i1], mid[i1], 1)


def add_drip_strip(ov, rng, p0, p1, width=0.24, step=0.25):
    """雨落ちの砂利の帯（幅約 0.24 m。縁は地面の下へもぐらせ、揃わない線にする。縁の外に小石）"""
    (xa, za), (xb, zb) = p0, p1
    ln = math.hypot(xb - xa, zb - za)
    ux, uz = (xb - xa) / ln, (zb - za) / ln
    nx, nz = -uz, ux
    n = max(1, int(round(ln / step)))
    t = np.linspace(0, ln, n + 1)
    px, pz = xa + ux * t, za + uz * t
    wl = width / 2 + 0.022 * F_BAND(px * 1.7 + 3, pz * 1.7) + rng.uniform(-0.01, 0.01, n + 1)
    wr = width / 2 + 0.022 * F_BAND(px * 1.7 - 5, pz * 1.7) + rng.uniform(-0.01, 0.01, n + 1)
    lx, lz = px + nx * (wl + 0.02), pz + nz * (wl + 0.02)
    rx, rz = px - nx * (wr + 0.02), pz - nz * (wr + 0.02)
    gl, gc, gr = terrain_height_at(lx, lz), terrain_height_at(px, pz), terrain_height_at(rx, rz)
    k = rng.uniform(0.92, 1.06, n + 1)
    col = np.array([1.0, 0.95, 0.88])
    L_ = [ov.add(lx[i], gl[i] - 0.004, lz[i], tuple(col * 0.9 * k[i])) for i in range(n + 1)]
    C_ = [ov.add(px[i], gc[i] + 0.009, pz[i], tuple(col * k[i])) for i in range(n + 1)]
    R_ = [ov.add(rx[i], gr[i] - 0.004, rz[i], tuple(col * 0.9 * k[i])) for i in range(n + 1)]
    for i in range(n):
        for A, B in ((L_, C_), (C_, R_)):
            ov.tri(A[i], B[i], B[i + 1], 2)
            ov.tri(A[i], B[i + 1], A[i + 1], 2)
    # 帯の縁からこぼれた小石（見える所の帯だけ）
    if ln < 16:
        for _ in range(int(ln / 0.9)):
            t_ = rng.uniform(0, ln)
            side = rng.choice((-1, 1))
            off = side * (width / 2 + rng.uniform(0.0, 0.1))
            x_, z_ = xa + ux * t_ + nx * off, za + uz * t_ + nz * off
            if base_dist(np.array([x_]), np.array([z_]))[0] > 0.03:
                kk = rng.uniform(0.75, 1.05)
                add_pebble(ov, rng, x_, z_, rng.uniform(0.015, 0.03), (0.76 * kk, 0.72 * kk, 0.66 * kk))


def pebble_spots(rng):
    """塀・町家の根元の締まった土の上の小石（3〜6 個のまとまり）"""
    spots = []
    centres = []
    for x in np.arange(-12.0, -3.0, 1.6):
        centres.append((x + rng.uniform(-0.4, 0.4), EW_Z + WALL_HALF + rng.uniform(0.06, 0.32)))
    for x in np.arange(3.1, 6.8, 1.3):
        centres.append((x + rng.uniform(-0.3, 0.3), EW_Z + WALL_HALF + rng.uniform(0.06, 0.32)))
    for z in np.arange(-10.8, 2.6, 2.2):
        centres.append((NS_X - WALL_HALF - rng.uniform(0.06, 0.32), z + rng.uniform(-0.4, 0.4)))
    for x in np.arange(-10.0, -5.3, 1.6):
        centres.append((x + rng.uniform(-0.3, 0.3), -5.6 - rng.uniform(0.05, 0.3)))
    for s in (-1, 1):
        centres.append((s * rng.uniform(2.95, 3.1), -11.2))
    for cx, cz in centres:
        for _ in range(int(rng.integers(3, 6))):
            x, z = cx + rng.normal(0, 0.12), cz + rng.normal(0, 0.08)
            if base_dist(np.array([x]), np.array([z]))[0] < 0.03:
                continue
            spots.append((x, z, rng.uniform(0.014, 0.036)))
    return spots


def build_overlay():
    """地面に重ねる物を 1 つのメッシュに（材質 0 土・1 石・2 砂利）。色は自分の色（地面の AO はあとで掛ける）"""
    rng = np.random.default_rng(43)
    ov = Overlay()
    pts = stone_layout()
    for x, z, r in pts:
        add_flat_stone(ov, rng, x, z, r)
    for p0, p1 in DRIP_LINES:
        add_drip_strip(ov, rng, p0, p1)
    peb = pebble_spots(rng)
    for x, z, r in peb:
        k = rng.uniform(0.72, 1.08)
        w = rng.normal(0, 0.04)
        add_pebble(ov, rng, x, z, r, (0.74 * k * (1 + w), 0.71 * k, 0.66 * k * (1 - w)))
    V = np.array(ov.v)
    verts_b = np.stack([V[:, 0], -V[:, 2], V[:, 1]], -1)
    m_earth = mats.get('earth_road', vcol=True)
    m_stone = mats.get('stone_granite', vcol=True)
    m_grav = mats.get('gravel', vcol=True)
    o = mesh_object('ground_overlay', verts_b, ov.f, mat_slots=[m_earth, m_stone, m_grav], face_mats=ov.fm)
    smooth(o)
    # UV 0：土は地面と同じ写し方（ゆがめた 4 m）、石と砂利は真上からの 1 m
    fm_v = np.zeros(len(V), np.int64)
    for f, m in zip(ov.f, ov.fm):
        fm_v[list(f)] = m
    uv0 = np.where((fm_v == 0)[:, None], earth_uv(V[:, 0], V[:, 2]), np.stack([V[:, 0], -V[:, 2]], -1))
    set_loop_uv(o, 'UVMap', uv0)
    set_loop_uv(o, 'lightmap', lightmap_uv(V[:, 0], V[:, 2]))
    o.data.uv_layers.active = o.data.uv_layers['UVMap']
    o.data.uv_layers['UVMap'].active_render = True
    cols = np.array(ov.col)
    set_point_colors(o, cols)
    print(f'overlay: {len(pts)} stones, {len(peb)} pebbles, {len(DRIP_LINES)} drip strips, {len(ov.f)} tris')
    return o, pts, cols, V


def with_occlusion(mat, img, owner):
    """材質を複製し、occlusionTexture（'lightmap' UV の img の R）をつなぐ（mats.bake_ao_to_texture と同じつなぎ方）"""
    name = f'{mat.name}@ao:{owner}'
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = mat.copy()
    m.name = name
    nt = m.node_tree
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'lightmap'
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    gn = nt.nodes.new('ShaderNodeGroup')
    gn.node_tree = mats._gltf_group()
    nt.links.new(uvn.outputs['UV'], tn.inputs['Vector'])
    nt.links.new(tn.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Red'], gn.inputs['Occlusion'])
    return m


def merge_overlay(terrain, overlay, cols, V, img=None):
    """重ねる物に地面の頂点の AO を掛け、材質を地面と同じ AO の画像につなぎ、地面のメッシュに入れる"""
    if Terrain.aog is not None:
        f = grid_interp(Terrain.aog, V[:, 0], V[:, 2])
        set_point_colors(overlay, np.clip(cols * f[:, None], 0, 1))
    if img is not None:
        slots = overlay.material_slots
        slots[0].material = terrain.material_slots[0].material          # 土は地面と同じ材質
        slots[1].material = with_occlusion(slots[1].material, img, terrain.name)
        slots[2].material = with_occlusion(slots[2].material, img, terrain.name)
    with bpy.context.temp_override(active_object=terrain, object=terrain, selected_objects=[terrain, overlay],
                                   selected_editable_objects=[terrain, overlay]):
        bpy.ops.object.join()
    me = terrain.data
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True
    mats._set_active_color(me, mats.COLOR_ATTR)


def capture_terrain_ao(terrain):
    """地面の頂点に焼いた AO の係数（焼いた色 ÷ 焼く前の色）を格子の配列に"""
    xs, zs = Terrain.xs, Terrain.zs
    after = get_point_colors(terrain)
    f = np.clip((after / np.maximum(Terrain.cols0, 1e-4)).mean(1), 0, 1)
    G = np.ones(len(xs) * len(zs))
    G[Terrain.used] = f
    Terrain.aog = G.reshape(len(xs), len(zs))


# ---------------------------------------------------------------------------
# 四つ目垣
# ---------------------------------------------------------------------------

def cyl(bm, p0, p1, r, seg=6, cap_top=True):
    """円柱（ゲームの座標の 2 点）。底は作らない"""
    a = mathutils.Vector(g2b(*p0))
    b = mathutils.Vector(g2b(*p1))
    ax = (b - a).normalized()
    t = ax.orthogonal().normalized()
    u = ax.cross(t)
    r0, r1 = [], []
    for k in range(seg):
        ang = k / seg * math.tau
        o = (t * math.cos(ang) + u * math.sin(ang)) * r
        r0.append(bm.verts.new(a + o))
        r1.append(bm.verts.new(b + o))
    for k in range(seg):
        k1 = (k + 1) % seg
        bm.faces.new((r0[k], r0[k1], r1[k1], r1[k]))
    if cap_top:
        bm.faces.new(r1 if ax.z >= 0 else r1[::-1])
    return r0, r1


FENCE_RUNS = [((FENCE_X, -11.3), (FENCE_X, FENCE_Z)), ((FENCE_X, FENCE_Z), (-15.6, FENCE_Z))]


def build_fence():
    rng = np.random.default_rng(71)
    bmb = bmesh.new()      # 竹
    bmp = bmesh.new()      # 丸太の柱
    ties = []
    rails_h = (0.24, 0.52, 0.80)
    for (xa, za), (xb, zb) in FENCE_RUNS:
        dx, dz = xb - xa, zb - za
        ln = math.hypot(dx, dz)
        ux, uz = dx / ln, dz / ln
        nx, nz = -uz, ux                      # 垣の面の法線（水平）
        npost = max(1, int(round(ln / 1.8)))
        for k in range(npost + 1):
            t = k / npost * ln
            px, pz = xa + ux * t, za + uz * t
            h0 = float(terrain_height_at(np.array([px]), np.array([pz]))[0])
            cyl(bmp, (px, h0 - 0.1, pz), (px, h0 + 1.0 + rng.uniform(-0.02, 0.02), pz), 0.048, seg=8)
        # 横の竹（胴縁）：柱の片側に、3.6 m ごとに継ぐ
        for hh in rails_h:
            t = 0.0
            while t < ln - 0.05:
                t1 = min(ln, t + rng.uniform(3.2, 3.8))
                off = 0.055
                p0 = (xa + ux * (t - 0.05) + nx * off, hh + rng.uniform(-0.01, 0.01), za + uz * (t - 0.05) + nz * off)
                p1 = (xa + ux * (t1 + 0.05) + nx * off, hh + rng.uniform(-0.01, 0.01), za + uz * (t1 + 0.05) + nz * off)
                cyl(bmb, p0, p1, 0.017, seg=6, cap_top=False)
                t = t1
        # 立子：胴縁の前後に交互
        n = int(ln / 0.27)
        for k in range(1, n):
            t = k * ln / n + rng.uniform(-0.02, 0.02)
            s = 1 if k % 2 else -1
            off = 0.055 + s * 0.032
            px, pz = xa + ux * t + nx * off, za + uz * t + nz * off
            h0 = float(terrain_height_at(np.array([px]), np.array([pz]))[0])
            top = h0 + rng.uniform(0.9, 0.95)
            cyl(bmb, (px, h0 - 0.05, pz), (px, top, pz), 0.014, seg=6)
            for hh in rails_h:
                ties.append((px - nx * s * 0.016, hh, pz - nz * s * 0.016, ux, uz, nx, nz))
    # 結び目（黒い棕櫚縄）：交差の所にたすきの形の細い板 2 枚（両面の材質）
    tie_start = len(bmb.verts)
    for (x, y, z, ux, uz, nx, nz) in ties:
        c = mathutils.Vector(g2b(x, y, z))
        n = mathutils.Vector(g2b(nx, 0, nz)).normalized()
        for sgn in (1, -1):
            d = mathutils.Vector(g2b(ux, sgn, uz)).normalized()
            w = d.cross(n).normalized()
            q = [bmb.verts.new(c + d * (a * 0.032) + w * (b * 0.007) + n * 0.004) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            f = bmb.faces.new(q)
            if f.normal.dot(n) < 0:
                f.normal_flip()
    objs = []
    for bm, name, mat in ((bmb, 'ground_fence_bamboo', 'bamboo'), (bmp, 'ground_fence_post', 'wood_weathered')):
        me = bpy.data.meshes.new(name)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        mats.assign(o, mat, vcol=True)
        smooth(o)
        bpy.context.view_layer.update()
        mats.uv_along(o, round=True, seed=3 if mat == 'bamboo' else 4)
        mats.tint_islands(o, seed=8, amount=0.09, warm=0.04)
        if mat == 'bamboo':
            a = me.color_attributes[mats.COLOR_ATTR]
            c = np.empty(len(a.data) * 4, np.float32)
            a.data.foreach_get('color', c)
            c = c.reshape(-1, 4)
            c[:tie_start, :3] *= (0.74, 0.69, 0.53)      # 日に焼けた古い竹の色
            c[tie_start:, :3] = (0.16, 0.14, 0.12)
            a.data.foreach_set('color', c.ravel())
        objs.append(o)
    return objs


# ---------------------------------------------------------------------------
# 草・羊歯・つつじ（plants.glb の部品を置いて、種類ごとに 1 つにまとめる）
# ---------------------------------------------------------------------------

def _plant_ok(x, z, avoid_road=True):
    if avoid_road and abs(x) < ROAD_HW + 0.1 and not (abs(z - EW_Z) < 0.9):
        return False
    if any(in_rect(x, z, r, 0.05) for r in HOUSE_BODY + HOUSE_APRON) or any(in_rect(x, z, r, 0.02) for r in wall_rects()):
        return False
    if any(in_rect(x, z, (d['hole'][0], d['hole'][1], d['z'][0], d['z'][1]), 0.02) for d in DITCH.values()):
        return False
    if any(in_rect(x, z, r, 0.02) for r in FOOTINGS):
        return False
    if -7.2 <= z <= -5.6 and x < -3.0 and not (z > -5.95):
        return False
    if abs(z - FENCE_Z) < 0.12 and x < FENCE_X + 0.1 or abs(x - FENCE_X) < 0.12 and z < FENCE_Z + 0.1:
        return False
    if any(math.hypot(x - rx, z - rz) < rr + 0.1 for rx, rz, rr, *_ in ROCKS):
        return False
    if any(math.hypot(x - t['pos'][0], z - t['pos'][1]) < 0.7 for t in L['trees']):
        return False
    return True


def plant_spots(joints):
    rng = np.random.default_rng(81)
    spots = [('shrub_azalea', -13.6, -10.85, 1.0), ('shrub_azalea', -10.3, -10.95, 0.85), ('shrub_azalea', 5.3, -11.0, 0.8),
             ('shrub_azalea', 6.62, -1.9, 0.85),
             ('shrub_fern', -5.2, -10.8, 0.9), ('shrub_fern', 6.62, -10.95, 0.85), ('shrub_fern', -8.8, -7.75, 0.8)]
    grass = ('grass_a', 'grass_b', 'grass_c')

    def cluster(cx, cz, n, rad=0.28, smin=0.55, smax=1.05, avoid_road=True):
        k = tries = 0
        while k < n and tries < n * 30:
            tries += 1
            a, d = rng.uniform(0, math.tau), rad * math.sqrt(rng.random())
            x, z = cx + d * math.cos(a), cz + d * math.sin(a) * 0.8
            if not _plant_ok(x, z, avoid_road):
                continue
            spots.append((grass[rng.integers(3)], x, z, rng.uniform(smin, smax)))
            k += 1

    def clusters(m, x0, x1, z0, z1, nmin=3, nmax=8, **kw):
        for _ in range(m):
            cluster(rng.uniform(x0, x1), rng.uniform(z0, z1), int(rng.integers(nmin, nmax + 1)), **kw)

    # 塀の根元（締まった土と雨落ちの際に、3〜6 株のまとまり）
    for x in (-15.8, -11.6, -8.3, -6.0, -3.4, 3.35, 4.6, 6.4):
        cluster(x + rng.uniform(-0.3, 0.3), EW_Z + WALL_HALF + rng.uniform(0.08, 0.3), int(rng.integers(3, 6)), avoid_road=False)
    for z in (-9.6, -5.8, -1.9, 1.8):
        cluster(NS_X - WALL_HALF - rng.uniform(0.08, 0.3), z + rng.uniform(-0.3, 0.3), int(rng.integers(3, 6)))
    for x in (-9.5, -5.2, 4.4):
        cluster(x, EW_Z - WALL_HALF - rng.uniform(0.08, 0.3), 3)
    for x in (-9.4, -7.1):
        cluster(x, -5.75, 3, rad=0.2)
    clusters(4, -17.5, -5.0, -11.0, -7.7, nmin=3, nmax=6, smin=0.7, smax=1.2)        # 空き地
    # 縁石の目地（約 2 割。見える所だけ）から小さな草
    for x, z, kind, s in joints:
        if -16.0 < z < 8.0 and rng.random() < 0.2:
            spots.append((grass[1 + rng.integers(2)], x + rng.uniform(-0.03, 0.03), z, rng.uniform(0.3, 0.5)))
    return spots


def build_plants(joints):
    root, objs = asm.load_glb('_plants_kit', MODELS_DIR / 'plants.glb')
    kit = {o.name.split('.')[0]: o for o in objs if o.type == 'MESH'}
    rng = np.random.default_rng(91)
    groups = {'ground_grass': [], 'ground_fern': [], 'ground_azalea': []}
    for kind, x, z, sc in plant_spots(joints):
        src = kit[kind]
        c = src.copy()
        c.data = src.data.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = None
        y = float(terrain_height_at(np.array([x]), np.array([z]))[0])
        c.matrix_world = (mathutils.Matrix.Translation(g2b(x, y - 0.01, z)) @ mathutils.Matrix.Rotation(rng.uniform(0, math.tau), 4, 'Z')
                          @ mathutils.Matrix.Scale(sc, 4))
        g = 'ground_grass' if kind.startswith('grass') else ('ground_fern' if kind == 'shrub_fern' else 'ground_azalea')
        groups[g].append(c)
    out = []
    for name, cs in groups.items():
        if not cs:
            continue
        with bpy.context.temp_override(active_object=cs[0], object=cs[0], selected_objects=cs, selected_editable_objects=cs):
            bpy.ops.object.join()
        o = cs[0]
        o.name = name
        o.data.name = name
        o.data.transform(o.matrix_world)
        o.matrix_world = mathutils.Matrix.Identity(4)
        o['cast'] = not name == 'ground_grass'
        o['receive'] = True
        out.append(o)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(root, do_unlink=True)
    return out


# ---------------------------------------------------------------------------
# 当たり判定
# ---------------------------------------------------------------------------

def write_meta(stats):
    col = []
    for (xa, za), (xb, zb) in FENCE_RUNS:
        col.append(dict(x0=round(min(xa, xb) - 0.12, 3), x1=round(max(xa, xb) + 0.12, 3), z0=round(min(za, zb) - 0.12, 3), z1=round(max(za, zb) + 0.12, 3)))
    for x, z, r, *_ in ROCKS:
        if r >= 0.33:
            col.append(dict(x0=round(x - r * 0.8, 3), x1=round(x + r * 0.8, 3), z0=round(z - r * 0.8, 3), z1=round(z + r * 0.8, 3)))
    d = {'name': 'ground_v2', 'coords': 'game (x east, y up, z south), meters',
         '_about': '地面の素材の当たり判定（空き地の四つ目垣と大きな石）。側溝は歩いて渡れる（当たり判定なし）。カメラ除けの箱は無し（低い物だけ）。',
         'colliders': col, **stats}
    META.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')


# ---------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true', help='AO を低い解像度・少ない回数で（確かめ用）')
    ap.add_argument('--no-bake', action='store_true')
    ap.add_argument('--out', default=str(OUT))
    a = ap.parse_args(argv)
    out_path = pathlib.Path(a.out)
    t0 = time.time()
    reset()
    terrain = build_terrain()
    far = build_far()
    stone, joints = build_stones()
    bed, fill_rng = build_ditch_beds()
    fence = build_fence()
    plants = build_plants(joints)
    overlay, pts, ov_cols, ov_V = build_overlay()
    ground = [terrain, far, stone, bed, *fence, *plants]
    print('built in', round(time.time() - t0, 1), 's; triangles', {o.name: triangles([o]) for o in ground + [overlay]})
    img = None
    if not a.no_bake:
        # 周りの建物・木を置いたまま焼く（遮るものとして）。重ねる物は地面の焼き込みには入れない（下の地面が黒くなるので）
        others = asm.assemble(ground=False, hero=False, back_trees=False)
        overlay.hide_render = True
        detail = [stone, bed, *fence]
        fill_cols = get_point_colors(bed)[fill_rng[0]:fill_rng[1]]
        mats.bake_ao_to_color(detail, ground_plane=False, samples=16 if a.quick else 48, distance=1.6, strength=0.55)
        c = get_point_colors(bed)
        c[fill_rng[0]:fill_rng[1]] = fill_cols           # 目地の土は縁石の下を通るので焼かない（色はそのまま）
        set_point_colors(bed, c)
        print('detail AO', round(time.time() - t0, 1))
        # 地面：短い距離の接地の陰を頂点色に（弱く）
        mats.bake_ao_to_color([terrain], ground_plane=False, samples=16 if a.quick else 48, distance=0.6, strength=0.3)
        capture_terrain_ao(terrain)
        print('terrain vcol AO', round(time.time() - t0, 1))
        # 地面：空の見え方（長い距離の AO）を occlusionTexture に。草の板は遮る物から外す
        for o in plants:
            o.hide_render = True
        img = mats.bake_ao_to_texture(terrain, 1024 if a.quick else 2048, 'lightmap', samples=12 if a.quick else 32, distance=6.0,
                                      strength=0.85, ground_plane=False, margin=4, blur_px=1)
        for o in plants:
            o.hide_render = False
        overlay.hide_render = False
        print('terrain tex AO', round(time.time() - t0, 1))
        for nm, (root, objs) in others.items():
            for o in objs:
                if o.name in bpy.data.objects:
                    bpy.data.objects.remove(o, do_unlink=True)
            if root.name in bpy.data.objects:
                bpy.data.objects.remove(root, do_unlink=True)
    merge_overlay(terrain, overlay, ov_cols, ov_V, img)
    # 書き出し：不透明の画像は JPEG に（草の板の PNG は透明を残す）
    gtx.jpeg_materials({s.material for o in ground for s in o.material_slots})
    size = export_glb(out_path, ground, jpeg=False)
    tri = triangles(ground)
    per = {o.name: triangles([o]) for o in ground}
    print('exported', out_path, size, 'bytes', tri, 'tris', per, round(time.time() - t0, 1), 's')
    s = mats.glb_summary(out_path)
    for m in s['materials']:
        print(' mat', m)
    for p in s['primitives']:
        print(' prim', p)
    print(' images', s['images'])
    if out_path == OUT:
        write_meta(dict(triangles=tri, glb_bytes=size, embedded_stones=len(pts)))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
