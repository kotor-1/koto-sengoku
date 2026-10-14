"""
城門前の一場面の地面（Version 28：ground_v3.glb と、草むら・低木の ground_plants28.glb）を作る。

    /root/blender-venv/bin/python proto3d/blender/scene/build_ground.py [--quick] [--no-bake]
    python3 proto3d/blender/scene/ground_height.py        （作り直したら、足の高さの格子も作り直す）

Version 28 の変更（Version 27 の ground_v2.glb・ground.meta.json はリポジトリに残す。ゲームは読まない）:
- 配置は通りの配置の唯一の元 street28/street28.json（建物・木・側溝・道）と、建物の meta（形の中の本体の箱）、
  小物の置き方 street28/props28.placed.json（town/plan.ts から書き出した一覧。tests/proto3d-town-props.test.ts が一致を確かめる）。
  城門・土塀・開始の位置は scene.json。
- 接地の陰：Version 28 の建物 5 棟・小物（props28.glb を置き方どおりに置く）・木をすべて置いたまま、地面の AO を焼く。
  空の見え方（6 m）と接地の陰（0.7 m）の 2 回を掛けて 1 枚の ORM（R 遮蔽、TEXCOORD_1）に。小物・木の根元の周りが暗くなる。
- 東の側溝を z 11 から土蔵造りの店の北の角（z 12.35）まで延ばし、路地の口に渡り石。詰所の前の休み場（筵の下、z −1.35〜3.35）は暗渠にして
  溝を 2 つ（east・east_s）に分ける（筵が溝と縁石にまたがらない）。両方の側溝に浅い水面（ground_ditch_water）、
  水際の石は濡れて暗く苔の色（頂点色）。
- 木戸の外：道の続きと、田（水を張った田・植えた田、畦）・畑（畝）を広げる（ground_fields。歩ける範囲は広げない）。
  遠くの簡単な地面（ground_far）は田畑の所を抜く。木戸の外の道の両脇は草の縁。
- 砂利：木戸の下の踏み固めた砂利と、荷置き場の砂利のむら（重ねる物の砂利。縁は地面へもぐらせる）。
- 草むら・低木（plants.glb の部品）は ground_plants28.glb へ分ける（地面の三角形の目安 6 万を、地面だけで守る）。
  塀・柵・板塀の裾、家の脇、側溝の縁、木の根元に、まとまりと抜けを付けて置く。つつじは暗い塊にならないよう明るくし、羊歯・草と組にする。

中身（すべてゲームの絶対座標のまま書き出す。原点に置けばよい）:
- ground_terrain: 細かい範囲（x -20〜20、z -26〜20）の地面。踏み固めた暖かい土の道（中央のわずかな盛り上がり、深さ 2〜3 cm の 2 本の轍、
  真ん中の踏み跡）、町の土、塀ぎわ・空き地・城内の草地（自作の turf）。高さの格子は道・側溝・塀・町家の線に合わせた不等間隔。
  土の画像は地面だけの 'road'（ground_tex.gen_road：点々の小石なし、締まった土の段・砂ぼこり・擦れ跡）。
  道の面は 1〜6 m のゆるい起伏（±2〜3 cm。家の前・側溝・塀・門の敷居の近くでは 0）。
  色（大きな明暗・乾き／湿り（wetness）・塀と町家の根元の締まった土）は頂点色 COLOR_0。
  周りの建物・小物・木を置いたまま焼いた AO と、乾き・湿りの粗さ（0.64〜0.95）は 1 枚の ORM（R 遮蔽・G 粗さ、TEXCOORD_1、2048 px）。
  同じメッシュに、あとから重ねる物も入れる（同じ AO の画像を使うので、日陰で浮かない）:
    ・道の縁と門の敷居の前だけに埋まった平たい石。塀と町家の根元のわずかな小石、軒・笠の雨落ちの砂利の帯、木戸の下・荷置き場の砂利のむら。
- ground_far: その外の 200 m までの簡単な地面（田畑の所は抜く）。細かい範囲の下に 1 m もぐらせてある。
- ground_fields: 木戸の外の道・草の縁・用水路・田（水面・植えた苗の列）・畦・畑の畝。
- ground_stone: 側溝の割り石の縁石（長さ・高さ・傾きがそろわない、面取りと角の欠け。水際は濡れて暗い）、端の石、入口の前の渡り石、大きな石。
- ground_ditch_bed / ground_ditch_water: 側溝の暗く湿った底と、縁石の目地を埋める土。浅い水面。
当たり判定は ground_v3.meta.json（大きな石）。
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
STREET_DIR = HERE.parent / 'street28'
STREET = json.loads((STREET_DIR / 'street28.json').read_text())
BMETA = {b['id']: json.loads((STREET_DIR / f"{b['id']}.meta.json").read_text()) for b in STREET['buildings']}
PLACED = json.loads((STREET_DIR / 'props28.placed.json').read_text())
PTYPES = json.loads((STREET_DIR / 'props28.types.json').read_text())['types']
OUT = MODELS_DIR / 'ground_v3.glb'
OUT_PLANTS = MODELS_DIR / 'ground_plants28.glb'
META = HERE / 'ground_v3.meta.json'
TMP = BUILD_DIR / 'scene'
WORK = BUILD_DIR / 'ground_v3'          # この版の焼いた画像の置き場（共有の build の中の新しいフォルダ）
WORK.mkdir(parents=True, exist_ok=True)

# 細かい範囲（ゲームの座標）
AREA = dict(x0=-20.0, x1=20.0, z0=-26.0, z1=20.0)
ROAD_HW = STREET['edges']['road']['half_width']
RUT_X = 0.78            # 轍の中心（道の中心から）
WALL_HALF = 0.59        # 塀の根元の石の張り出しを含む半分の厚み（walls_v2）
DRIP = 0.81             # 塀の笠の雨落ち（中心から）
EW_Z = -12.0
NS_X = 7.6
NS_Z = (-12.0, 3.0)
# 西の町家（A・B）の置き場所は scene.json の houses。下の西側の決め打ちの z は、もとの配置（A の北の妻 z -5.6）からのずれ DZW だけずらす
DZW = next(h for h in STREET['buildings'] if h['id'] == 'machiya_a28')['footprint']['z0'] - (-5.6)
FENCE_Z = -7.35 + DZW   # 空き地の南の垣（路地 A の北の妻の手前 1.6 m は空ける）
FENCE_X = -4.45         # 空き地の道側の垣
ALLEY = (-7.2 + DZW, -5.6 + DZW)   # 町家 A の北の路地
TURF_WS = -10.75        # 塀ぎわの草の南の端
TURF_WN = -13.25        # 城内側の塀ぎわの草の北の端
TURF_NSW = 6.3          # 東の塀（南北）の西側の草の西の端
FOOTINGS = [(2.02, 2.86, -12.33, -11.40), (-2.86, -2.02, -12.33, -11.40)]   # 門の礎石（gate_v2）
FENCE_S = STREET['kido']['z']    # 町の南の柵の線（街道口の木戸）
EARTH_TINT = np.array([1.0, 0.92, 0.80])     # 暖かい土の色（線形の掛け算）
CURB_W = dict(house=0.17, road=0.18)          # 縁石の幅。溝は 0.27 m


# 家の下の地面を抜く建物（GLB の下に土の塊がある町家 A・B・D。土蔵造りの店・西の小屋は穴の無い地面の上）
HOLE_UNDER = ('machiya_a28', 'machiya_b28', 'machiya_d28')


def _solid(bid, sid):
    return next((s_['box'] for s_ in BMETA[bid]['solids'] if s_['id'] == sid), None)


def _houses():
    """
    建物の本体（形の中の本体の固い部品の箱）・表の三和土と軒下（本体の表から、表に側溝があれば足元の表の線、無ければ軒の線まで）・
    地面を抜く所（町家 A・B・D の本体）。ゲームの座標 (x0, x1, z0, z1)
    """
    body, apron, hole = [], [], []
    for b in STREET['buildings']:
        bx = _solid(b['id'], 'body')
        fp = b['footprint']
        r = (bx['x0'], bx['x1'], bx['z0'], bx['z1'])
        body.append(r)
        if b['id'] in HOLE_UNDER:
            hole.append(r)
        eave = _solid(b['id'], 'hisashi') or _solid(b['id'], 'roof')
        ditch = any(min(d['z']) < bx['z1'] and max(d['z']) > bx['z0'] and (d['x'][0] < 0) == (b['front'] == '+x') for d in STREET['edges']['ditches'])
        if b['front'] == '+x':
            x0, x1 = bx['x1'], (fp['x1'] + 0.02 if ditch else max(fp['x1'], eave['x1']))
        else:
            x0, x1 = (fp['x0'] - 0.02 if ditch else min(fp['x0'], eave['x0'])), bx['x0']
        apron.append((x0, x1, bx['z0'] - 0.1, bx['z1'] + 0.1))
    return body, apron, hole


HOUSE_BODY, HOUSE_APRON, HOUSE_HOLE = _houses()
DITCH = {}
for _d in STREET['edges']['ditches']:
    side = -1 if _d['x'][0] < 0 else 1
    # 地面の穴（石組みの外の端まで）：家側 0.08 m、道側 0.16 m 広げる（縁石 0.17・0.18 m、溝 0.27 m）
    if side < 0:
        hole = (_d['x'][0] - 0.08, _d['x'][1] + 0.16)
        chan = (hole[0] + CURB_W['house'], hole[1] - CURB_W['road'])
    else:
        hole = (_d['x'][0] - 0.16, _d['x'][1] + 0.08)
        chan = (hole[0] + CURB_W['road'], hole[1] - CURB_W['house'])
    DITCH[_d['name']] = dict(side=side, x=tuple(_d['x']), hole=hole, chan=chan, z=(_d['z'][0], _d['z'][1]))
# 入口の前の渡り石（z の範囲）。東の側溝は詰所の前の休み場（筵の下）で暗渠にして 2 つに分ける（east：町家 D・土蔵造りの店の前、east_s：城の土塀の前から休み場の南まで）
BRIDGES = {'west': [(-3.55 + DZW, -1.5 + DZW), (3.49 + DZW, 5.31 + DZW)], 'east': [(6.1, 8.5), (11.2, 12.05)], 'east_s': []}   # 東の 2 つ目は町家 D の南の路地の口
# 雨落ちの砂利の帯（ゲームの (x, z) の 2 点。幅 0.2 m）：塀の笠の下（町側・城内側）と町家の妻・裏の軒の下
DRIP_LINES = [
    ((-17.9, EW_Z + DRIP), (-2.95, EW_Z + DRIP)), ((2.95, EW_Z + DRIP), (NS_X - DRIP - 0.1, EW_Z + DRIP)),
    ((NS_X - DRIP, EW_Z + DRIP - 0.1), (NS_X - DRIP, NS_Z[1] - 0.1)), ((NS_X + DRIP, EW_Z + DRIP - 0.1), (NS_X + DRIP, NS_Z[1] - 0.1)),
    ((-17.9, EW_Z - DRIP), (-2.95, EW_Z - DRIP)), ((2.95, EW_Z - DRIP), (17.9, EW_Z - DRIP)),
    ((-10.7, -6.02 + DZW), (-5.25, -6.02 + DZW)),            # 町家 A の北の妻
    ((4.9, 3.43), (6.92, 3.43)), ((8.28, 3.43), (10.0, 3.43)),   # 町家 D の北（板塀の所は空ける）
    ((-11.3, 11.87 + DZW), (-5.6, 11.87 + DZW)), ((4.9, 11.2), (10.0, 11.2)),
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
F_BUMP = Field(31, n=512, fmin=22, fmax=56)         # 1.1〜3 m のゆるい起伏（道の面）
F_BUMP2 = Field(32, n=512, fmin=10, fmax=24)        # 2.7〜6 m
F_WET = Field(33, fmin=4, fmax=14)                  # 4.5〜16 m の乾き・湿りのむら
F_WET2 = Field(34, fmin=10, fmax=28)                # 2.3〜6 m


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
    # 木戸の外（柵の線より南）：道の両脇は草の縁（道の幅のゆらぎ）
    t |= (z > FENCE_S + 0.25) & (ax > ROAD_HW + 0.3)
    band = base_dist(x, z) < 0.3 + 0.09 * F_BAND(x, z)
    return t & ~band


def ditch_dist(x, z):
    """側溝の穴（石組み）からの水平の距離"""
    d = np.full(np.shape(x), 99.0)
    for dd in DITCH.values():
        d = np.minimum(d, rect_dist(x, z, (dd['hole'][0], dd['hole'][1], dd['z'][0], dd['z'][1])))
    return d


def bump_fade(x, z):
    """ゆるい起伏を効かせる割合（0..1）：家の前・側溝・塀・門の敷居・渡り石・草地では 0"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    f = sstep(0.35, 1.2, ditch_dist(x, z))
    f *= sstep(0.3, 1.1, base_dist(x, z))
    dh = np.full(x.shape, 99.0)
    for r in HOUSE_APRON:
        dh = np.minimum(dh, rect_dist(x, z, r))
    f *= sstep(0.3, 1.2, dh)
    f *= 1 - (1 - sstep(0.9, 2.2, np.abs(z - EW_Z))) * (np.abs(x) < 3.6)
    # 筵の下は平ら（筵は置いた所の真ん中の地面の高さに平らに置くので、起伏があると縁が埋まる・浮く）
    dm = np.full(x.shape, 99.0)
    for r in MAT_RECTS:
        dm = np.minimum(dm, rect_dist(x, z, r))
    f *= sstep(0.1, 0.8, dm)
    return f


def height(x, z):
    """地面の高さ（ゲームの y）"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    y = 0.004 * F_LOW(x, z)
    # 道：中央のわずかな盛り上がり、轍（幅広く浅い 1.5〜2.5 cm）、真ん中の踏み跡（広く 1 cm 低い）、1〜3 m のゆるい起伏
    w_road = sstep(ROAD_HW + 0.2, ROAD_HW - 0.3, ax)
    crown = 0.015 * np.clip(1 - (x / ROAD_HW) ** 2, 0, 1)
    rut = np.zeros_like(x)
    for s, F in ((-1, F_RUT), (1, F_RUT2)):
        xc = s * RUT_X + 0.08 * F(0 * x + s * 9.0, z)
        d = (x - xc) / 0.26
        rut -= 0.06 * np.exp(-d * d) * np.clip(0.75 + 0.35 * F(x * 0 + s * 3.0 + 20, z * 1.7), 0.3, 1.25)
    path = -0.008 * np.exp(-((x - 0.15 - 0.25 * F_RUT(x * 0 + 5.0, z * 0.6)) / 0.55) ** 2)
    gate = np.exp(-((z - EW_Z) / 1.4) ** 2)
    road = (crown + rut + path) * (1 - 0.6 * gate) + 0.004 * F_MID(x, z)
    y = y + w_road * road
    # ゆるい起伏（道と町の土。家の前・側溝・塀の根元・門の敷居の近くでは消す）
    bump = 0.012 * F_BUMP(x, z) + 0.009 * F_BUMP2(x, z)
    y = y + bump * bump_fade(x, z)
    # 空き地の小さな起伏
    lot = sstep(-4.6, -5.4, x) * sstep(-11.4, -10.9, z) * sstep(FENCE_Z, FENCE_Z - 0.55, z) * sstep(-18.2, -17.5, x)
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
        xk += [s * (ROAD_HW + 0.3)]          # 木戸の外の道と草の縁の境
    zk = [AREA['z0'], AREA['z1'], EW_Z - WALL_HALF, EW_Z, EW_Z + WALL_HALF, TURF_WS, TURF_WN, FENCE_Z, -5.6 + DZW, NS_Z[1], 12.0,
          FENCE_S, FENCE_S + 0.25,
          EW_Z + WALL_HALF + 0.2, EW_Z + WALL_HALF + 0.4, EW_Z - WALL_HALF - 0.2, EW_Z - WALL_HALF - 0.4,
          -5.8 + DZW, -6.0 + DZW, 3.6 + DZW, 3.4 + DZW, 11.6 + DZW, 11.8 + DZW, 11.0, 11.2]
    for d in DITCH.values():
        zk += list(d['z'])
    for b in HOUSE_BODY:
        zk += [b[2], b[3]]
    xs = axis_lines([(-20, -12, 0.8), (-12, -5.5, 0.5), (-5.5, -3.4, 0.25), (-3.4, 3.4, 0.25), (3.4, 5.0, 0.25), (5.0, 8.4, 0.4),
                     (8.4, 20, 0.8)], xk)
    zs = axis_lines([(-26, -14.5, 0.7), (-14.5, 4.0, 0.32), (4.0, 12, 0.45), (12, 20, 0.55)], zk)
    _GRID = (xs, zs)
    return _GRID


def warp(X, Z):
    """草と土の境目の格子線を少し波打たせる（境目が定規の線にならないように）。返り値 (X', Z')"""
    X = X.copy()
    Z = Z.copy()
    A, w = 0.14, 0.42
    specs = [('z', TURF_WS, 4.18, NS_X), ('x', TURF_NSW, EW_Z, NS_Z[1]), ('z', TURF_WN, 2.9, 18.0), ('z', TURF_WN, -18.0, -2.9),
             ('x', -12.0, -26.0, TURF_WN), ('x', 12.0, -26.0, TURF_WN), ('x', -11.2, FENCE_Z, 12.0), ('x', 9.8, NS_Z[1], 20.0),
             ('x', -11.0, 12.0, 20.0), ('x', 11.0, 12.0, 20.0), ('z', 12.0, -20, -11.0), ('z', 12.0, 11.0, 20.0),
             ('x', -(ROAD_HW + 0.3), FENCE_S + 0.25, 20.0), ('x', ROAD_HW + 0.3, FENCE_S + 0.25, 20.0)]
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
    for r in HOUSE_HOLE:
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
    m_earth = gtx.material('road', gtx.build_road(), gtx.ROAD_TILE)
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


def seg_dist(x, z, p0, p1):
    """線分 p0-p1 からの水平の距離"""
    (xa, za), (xb, zb) = p0, p1
    ux, uz = xb - xa, zb - za
    t = np.clip(((x - xa) * ux + (z - za) * uz) / (ux * ux + uz * uz), 0, 1)
    return np.hypot(x - (xa + t * ux), z - (za + t * uz))


def wetness(x, z):
    """
    土の湿り（0 乾き〜1 湿り）。人の歩く真ん中の筋は乾いて白っぽく、側溝の縁・雨落ち・塀の根元・低い所・
    門の下と城内側の塀の陰は湿って暗い。移り変わりは数 m の広さで（点やしみにしない）
    """
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    road = sstep(ROAD_HW + 0.2, ROAD_HW - 0.4, ax)
    w = 0.45 * sstep(-0.4, 1.3, 0.8 * F_WET(x, z) + 0.5 * F_WET2(x, z))   # 道の中のむらは控えめ（しみに見せない）
    lane = np.exp(-((x - 0.15 - 0.35 * F_RUT(x * 0 + 5.0, z * 0.6)) / 1.45) ** 2) * road
    w = w * (1 - 0.55 * lane)
    rut = np.zeros_like(x)
    for sg in (-1, 1):
        rut = np.maximum(rut, np.exp(-((x - sg * RUT_X) / 0.26) ** 2))
    ks = [0.45 * rut * road,
          0.82 * np.exp(-(ditch_dist(x, z) / 0.85) ** 2),
          0.38 * np.exp(-(base_dist(x, z) / 0.9) ** 2)]
    for p0, p1 in DRIP_LINES:
        ks.append(0.5 * np.exp(-(seg_dist(x, z, p0, p1) / 0.6) ** 2))
    low = -(0.004 * F_BUMP(x, z) + 0.009 * F_BUMP2(x, z)) * bump_fade(x, z)       # 大きい窪みだけ（小さな点にしない）
    ks.append(0.45 * sstep(-0.003, 0.018, low))
    ks.append(0.45 * np.exp(-((z - EW_Z) / 1.7) ** 2) * sstep(3.6, 2.6, ax))            # 門の下
    ks.append(0.4 * sstep(EW_Z - 0.3, EW_Z - 1.0, z) * sstep(EW_Z - 5.0, EW_Z - 2.6, z))  # 城内側の塀の陰
    ks.append(sstep(0.0, 0.9, np.clip(puddle(x, z) * 3.0, 0, 1)))   # 水たまりの周り
    for k in ks:
        w = 1 - (1 - w) * (1 - np.clip(k, 0, 1))
    return np.clip(w, 0, 1)


PUDDLES = [  # (x, z, 半径 x, 半径 z, 回転) 門の下の踏み窪みと側溝の縁の浅い水たまり
    (0.6, -10.2, 1.5, 0.8, 0.3), (-1.4, -9.0, 0.9, 0.5, -0.4), (1.9, -8.4, 0.7, 0.4, 0.8),
    (-3.2, -6.5, 0.8, 0.35, 0.1), (-3.3, -1.0, 0.6, 0.3, -0.2), (3.1, -3.2, 0.55, 0.3, 0.5),
    (2.5, -5.5, 1.6, 0.75, 0.25), (0.5, -7.0, 1.4, 0.6, -0.35),   # 開始の足元の手前の大きな水たまり（日差しを映す）
]


def puddle(x, z):
    """水たまりの度合い（0〜1）。輪郭はむらで崩す"""
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    p = np.zeros_like(x)
    edge = 0.25 * F_FINE(x, z) + 0.2 * F_WET2(x, z)
    for cx, cz, rx, rz, a in PUDDLES:
        dx, dz = x - cx, z - cz
        u = (dx * np.cos(a) + dz * np.sin(a)) / rx
        v = (-dx * np.sin(a) + dz * np.cos(a)) / rz
        p = np.maximum(p, sstep(1.05, 0.7, np.hypot(u, v) + edge))
    return p


def road_roughness(x, z):
    """土の粗さ（乾き 0.9〜0.95、湿り 0.62〜0.72。水たまりだけ 0.18〜0.3）"""
    w = wetness(x, z)
    r = np.clip(0.93 - 0.3 * w + 0.02 * F_FINE(x, z), 0.6, 0.97)
    p = puddle(x, z)
    return r * (1 - p) + 0.2 * p


def terrain_colors(x, z, y):
    x = np.asarray(x, np.float64)
    z = np.asarray(z, np.float64)
    ax = np.abs(x)
    road = sstep(ROAD_HW + 0.2, ROAD_HW - 0.4, ax)
    # 大きな明暗（3〜8 m と 6〜16 m、±10% 前後）と細かな明暗（0.5〜1.5 m、±5%）
    mac = np.clip(0.08 * F_MAC(x, z) + 0.06 * F_MAC2(x, z), -0.18, 0.16)
    fine = np.clip(0.06 * F_FINE(x, z), -0.1, 0.1)
    v = (1 + mac) * (1 + fine)
    hue = F_HUE(x, z)
    col = v[:, None] * EARTH_TINT[None] * np.stack([1 + 0.025 * hue, np.ones_like(hue), 1 - 0.045 * hue], -1)
    # 乾き・湿り：乾いた所は明るく少し白っぽい（砂ぼこり）、湿った所は暗く少し冷たい
    w = wetness(x, z)[:, None]
    dry = col * np.array([1.0, 1.0, 1.0]) + 0.06 * (1 - w) * np.array([1.0, 0.97, 0.92])
    damp = col * np.array([0.74, 0.72, 0.74])
    col = dry * (1 - w) + damp * w
    pd = puddle(x, z)[:, None]
    col = col * (1 - 0.35 * pd) + 0.35 * pd * col * np.array([0.8, 0.85, 1.0])
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
    pine = np.array(next((tt['x'], tt['z']) for tt in STREET['trees'] if tt['name'] == 'pine_big'))
    dp = np.hypot(x - pine[0], z - pine[1])
    litter = np.exp(-(dp / 3.0) ** 2)
    tint *= np.stack([1 + 0.10 * litter, 1 - 0.04 * litter, 1 - 0.14 * litter], -1)
    col = np.where(t[:, None], tint, col)
    # 塀・礎石・町家の根元：締まった土（-15%）
    band = sstep(0.48, 0.18, base_dist(x, z) - 0.06 * F_BAND(x, z))
    col *= (1 - 0.08 * band * ~t)[:, None]
    return np.clip(col, 0.25, 1.0)


# ---------------------------------------------------------------------------
# 外の地面（200 m まで）
# ---------------------------------------------------------------------------

def build_far():
    ring = [19, 24, 32, 45, 65, 95, 140, 200]
    xs = sorted(set([-v for v in ring] + ring + [-ROAD_HW, ROAD_HW, -11.0, 11.0]))
    zs = sorted(set([-25 - (v - 19) for v in ring] + [19 + (v - 19) for v in ring] + [-12.0, 0.0, 10.0, FIELDS['z0']]))
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
            if FIELDS['x0'] < cx < FIELDS['x1'] and FIELDS['z0'] < cz < FIELDS['z1']:
                continue                 # 木戸の外の田畑（ground_fields）
            earth = not bool(is_turf(np.array([cx]), np.array([cz]))[0])
            faces.append((idx[i, j], idx[i, j + 1], idx[i + 1, j + 1], idx[i + 1, j]))
            fm.append(0 if earth else 1)
    verts_b = np.stack([X.ravel(), -Z.ravel(), Y.ravel()], -1)
    m_earth = gtx.material('road', gtx.build_road(), gtx.ROAD_TILE)
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
# 木戸の外の田畑（Version 28）：道の続き・草の縁・用水路・田（水を張った田・植えた田）・畦・畑の畝
#   歩ける範囲（z 18 まで）は広げない。木戸から南を見たとき、地面の端（z 20）が切れて見えないように
# ---------------------------------------------------------------------------

FIELDS = dict(x0=-65.0, x1=65.0, z0=20.0, z1=95.0)
# 田畑の区画の線（ゲームの座標）。西は道の西の草の縁まで、東は用水路の東から
FIELD_XW = [-65.0, -51.0, -39.5, -28.5, -18.0]
FIELD_XE = [12.5, 23.5, 35.0, 48.5, 65.0]
FIELD_ZW = [20.0, 27.5, 35.5, 44.5, 55.0, 67.0, 80.0, 95.0]
FIELD_ZE = [20.0, 29.0, 37.5, 47.0, 57.5, 69.0, 82.0, 95.0]


def field_road(z):
    """木戸の外の道：真ん中の x（南へ行くと少し東へ曲がる）と半分の幅（3.4 → 2.7 m）"""
    z = np.asarray(z, np.float64)
    return 2.2 * sstep(30.0, 70.0, z), ROAD_HW - 0.7 * sstep(20.0, 40.0, z)


def water_material(name='water'):
    """水面（画像なし）：頂点色 × 暗い青緑、つやのある面（空が映る）。田・側溝・用水路"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = mats.COLOR_ATTR
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1.0
    a, b, o = mats._mix_sockets(mx)
    a.default_value = (0.12, 0.155, 0.15, 1.0)        # 線形の色（sRGB ≒ #61706d：浅い濁った水。暗すぎると空の映りが弱い町では黒く見える）
    nt.links.new(vc.outputs['Color'], b)
    nt.links.new(o, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.1
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


class FieldMesh:
    """田畑の網（ゲームの座標の頂点、材質 0 土・1 草・2 水、頂点色）"""

    def __init__(self):
        self.v, self.f, self.fm, self.col = [], [], [], []

    def quad(self, pts, m, cols):
        """pts = 4 点（ゲームの (x, y, z)）。上から見て向きをそろえる"""
        k = len(self.v)
        self.v.extend(pts)
        self.col.extend(cols if isinstance(cols, list) else [cols] * 4)
        a, b, c = (np.array(pts[i], np.float64) for i in range(3))
        e1, e2 = b - a, c - a
        nz = e1[0] * (-e2[2]) - (-e1[2]) * e2[0]       # Blender の Z（上）の向き：(x, −z) の外積
        self.f.append((k, k + 1, k + 2, k + 3) if nz >= 0 else (k + 3, k + 2, k + 1, k))
        self.fm.append(m)

    def strip(self, p0, p1, half, y, m, cols, n=1, ys=None):
        """p0→p1 の平らな帯（幅 2·half、高さ y、n 分割）"""
        (xa, za), (xb, zb) = p0, p1
        ln = math.hypot(xb - xa, zb - za)
        ux, uz = (xb - xa) / ln, (zb - za) / ln
        nx, nz = -uz, ux
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            ax, az = xa + (xb - xa) * t0, za + (zb - za) * t0
            bx, bz = xa + (xb - xa) * t1, za + (zb - za) * t1
            y0 = y if ys is None else ys[0]
            y1 = y if ys is None else ys[1]
            self.quad([(ax - nx * half, y0, az - nz * half), (bx - nx * half, y0, bz - nz * half),
                       (bx + nx * half, y1, bz + nz * half), (ax + nx * half, y1, az + nz * half)], m, cols)

    def bund(self, pts, rng, base=-0.06, top=0.1, wb=0.26, wt=0.12):
        """畦（折れ線 pts に沿う台形の土手：両側の斜面と上面。草の材質）"""
        for (xa, za), (xb, zb) in zip(pts[:-1], pts[1:]):
            ln = math.hypot(xb - xa, zb - za)
            if ln < 1e-3:
                continue
            ux, uz = (xb - xa) / ln, (zb - za) / ln
            nx, nz = -uz, ux
            k = rng.uniform(0.88, 1.06)
            c_top = (0.9 * k, 1.0 * k, 0.78 * k)
            c_side = (0.82 * k, 0.86 * k, 0.7 * k)
            hb, ht = wb, wt
            self.quad([(xa - nx * hb, base, za - nz * hb), (xb - nx * hb, base, zb - nz * hb),
                       (xb - nx * ht, top, zb - nz * ht), (xa - nx * ht, top, za - nz * ht)], 1, c_side)
            self.quad([(xa - nx * ht, top, za - nz * ht), (xb - nx * ht, top, zb - nz * ht),
                       (xb + nx * ht, top, zb + nz * ht), (xa + nx * ht, top, za + nz * ht)], 1, c_top)
            self.quad([(xa + nx * ht, top, za + nz * ht), (xb + nx * ht, top, zb + nz * ht),
                       (xb + nx * hb, base, zb + nz * hb), (xa + nx * hb, base, za + nz * hb)], 1, c_side)


def _plot(fmesh, rng, corners, kind, along_x):
    """田畑の 1 区画（四隅 (x, z)：北西・北東・南東・南西の順）。kind: water（水を張った田）・planted（植えた田）・field（畑の畝）・fallow（草）"""
    (x00, z00), (x10, z10), (x11, z11), (x01, z01) = corners
    inset = 0.22

    def P(u, v, y):
        x = (x00 * (1 - u) + x10 * u) * (1 - v) + (x01 * (1 - u) + x11 * u) * v
        z = (z00 * (1 - u) + z10 * u) * (1 - v) + (z01 * (1 - u) + z11 * u) * v
        return (x, y, z)
    W = math.hypot(x10 - x00, z10 - z00)
    H = math.hypot(x01 - x00, z01 - z00)
    du, dv = inset / max(W, 1e-3), inset / max(H, 1e-3)
    u0, u1, v0, v1 = du, 1 - du, dv, 1 - dv
    k = rng.uniform(0.9, 1.08)
    if kind in ('water', 'planted'):
        tint = (0.95 * k, 1.0 * k, 0.98 * k) if rng.random() < 0.5 else (1.0 * k, 0.98 * k, 0.9 * k)
        fmesh.quad([P(u0, v0, -0.05), P(u1, v0, -0.05), P(u1, v1, -0.05), P(u0, v1, -0.05)], 2, tint)
    if kind == 'planted':
        # 苗の列（水面の上の細い緑の帯。列の間に水が光る）
        n = max(4, int((H if along_x else W) / 0.62))
        for i in range(n):
            t = (i + 0.5) / n
            g = rng.uniform(0.88, 1.0)
            col = (0.72 * g, 1.0 * g, 0.48 * g)
            hw = 0.16 / max(H if along_x else W, 1e-3)
            if along_x:
                fmesh.quad([P(u0, t - hw, -0.025), P(u1, t - hw, -0.025), P(u1, t + hw, -0.025), P(u0, t + hw, -0.025)], 1, col)
            else:
                fmesh.quad([P(t - hw, v0, -0.025), P(t + hw, v0, -0.025), P(t + hw, v1, -0.025), P(t - hw, v1, -0.025)], 1, col)
    elif kind == 'field':
        # 畑：土の面と、畝（三角の断面の土の盛り上がり）と、畝の上の作物の緑の帯
        soil = (0.72 * k, 0.66 * k, 0.58 * k)
        fmesh.quad([P(u0, v0, -0.035), P(u1, v0, -0.035), P(u1, v1, -0.035), P(u0, v1, -0.035)], 0, soil)
        L_ = H if along_x else W
        n = max(4, int(L_ / 0.9))
        for i in range(n):
            t = (i + 0.5) / n
            hw = 0.28 / max(L_, 1e-3)
            cw = 0.09 / max(L_, 1e-3)
            g = rng.uniform(0.85, 1.05)
            crop = (0.66 * g, 0.86 * g, 0.44 * g)
            ridge = (0.66 * k, 0.6 * k, 0.53 * k)
            if along_x:
                fmesh.quad([P(u0, t - hw, -0.03), P(u1, t - hw, -0.03), P(u1, t - cw, 0.1), P(u0, t - cw, 0.1)], 0, ridge)
                fmesh.quad([P(u0, t + cw, 0.1), P(u1, t + cw, 0.1), P(u1, t + hw, -0.03), P(u0, t + hw, -0.03)], 0, ridge)
                fmesh.quad([P(u0, t - cw, 0.1), P(u1, t - cw, 0.1), P(u1, t + cw, 0.1), P(u0, t + cw, 0.1)], 1, crop)
            else:
                fmesh.quad([P(t - hw, v0, -0.03), P(t - cw, v0, 0.1), P(t - cw, v1, 0.1), P(t - hw, v1, -0.03)], 0, ridge)
                fmesh.quad([P(t + cw, v0, 0.1), P(t + hw, v0, -0.03), P(t + hw, v1, -0.03), P(t + cw, v1, 0.1)], 0, ridge)
                fmesh.quad([P(t - cw, v0, 0.1), P(t + cw, v0, 0.1), P(t + cw, v1, 0.1), P(t - cw, v1, 0.1)], 1, crop)
    elif kind == 'fallow':
        fmesh.quad([P(u0, v0, -0.03), P(u1, v0, -0.03), P(u1, v1, -0.03), P(u0, v1, -0.03)], 1, (0.95 * k, 0.96 * k, 0.8 * k))


def build_fields():
    rng = np.random.default_rng(97)
    fm = FieldMesh()
    zs = np.arange(FIELDS['z0'], FIELDS['z1'] + 1e-6, 2.5)
    xc, hw = field_road(zs)
    # 細かい範囲の地面の南の端（z 20、高さ −0.04）とのつなぎ目：端の下にもぐらせた帯（つなぎ目のすき間から空が見えないように）
    for x0_ in np.arange(AREA['x0'], AREA['x1'] - 1e-6, 5.0):
        fm.quad([(x0_, -0.046, AREA['z1'] - 0.7), (x0_ + 5.0, -0.046, AREA['z1'] - 0.7), (x0_ + 5.0, -0.046, AREA["z1"] + 0.02),
                 (x0_, -0.046, AREA["z1"] + 0.02)], 0, (0.86, 0.8, 0.72))
    # 道（土）・両脇の草の縁・東の用水路（土手は草、水面は低い）
    for i in range(len(zs) - 1):
        za, zb = zs[i], zs[i + 1]
        ca, cb, ha, hb = xc[i], xc[i + 1], hw[i], hw[i + 1]
        kr = rng.uniform(0.94, 1.04)
        road = (1.0 * kr, 0.97 * kr, 0.92 * kr)
        e0, c0 = (-0.04, -0.04) if i == 0 else (-0.035, -0.022)     # 最初の列は細かい範囲の端と同じ高さ
        fm.quad([(ca - ha, e0, za), (cb - hb, -0.035, zb), (cb, -0.022, zb), (ca, c0, za)], 0, road)
        fm.quad([(ca, c0, za), (cb, -0.022, zb), (cb + hb, -0.035, zb), (ca + ha, e0, za)], 0, road)
        verge = (0.92 * kr, 0.98 * kr, 0.8 * kr)
        fm.quad([(ca - ha - 1.2, e0, za), (cb - hb - 1.2, -0.03, zb), (cb - hb, -0.035, zb), (ca - ha, e0, za)], 1, verge)
        fm.quad([(ca + ha, e0, za), (cb + hb, -0.035, zb), (cb + hb + 1.2, -0.02, zb), (ca + ha + 1.2, e0, za)], 1, verge)
        # 用水路：土手（草）→ 水面 → 向こうの土手
        e0a, e0b = ca + ha + 1.2, cb + hb + 1.2
        fm.quad([(e0a, -0.02, za), (e0b, -0.02, zb), (e0b + 0.12, -0.15, zb), (e0a + 0.12, -0.15, za)], 1, (0.8, 0.86, 0.7))
        fm.quad([(e0a + 0.12, -0.13, za), (e0b + 0.12, -0.13, zb), (e0b + 0.55, -0.13, zb), (e0a + 0.55, -0.13, za)], 2, (1.0, 1.02, 0.96))
        fm.quad([(e0a + 0.55, -0.15, za), (e0b + 0.55, -0.15, zb), (e0b + 0.7, 0.04, zb), (e0a + 0.7, 0.04, za)], 1, (0.82, 0.88, 0.72))
    # 区画（西・東）
    def road_w(z):
        c, h = field_road(z)
        return float(c - h - 1.2)

    def road_e(z):
        c, h = field_road(z)
        return float(c + h + 1.2 + 0.7)
    for side, xs_fixed, zs_side in (('w', FIELD_XW, FIELD_ZW), ('e', FIELD_XE, FIELD_ZE)):
        ncol = len(xs_fixed)
        for j in range(len(zs_side) - 1):
            za, zb = zs_side[j], zs_side[j + 1]
            for i in range(ncol):
                if side == 'w':
                    xa0, xa1 = xs_fixed[i], (xs_fixed[i + 1] if i + 1 < ncol else road_w(za))
                    xb0, xb1 = xs_fixed[i], (xs_fixed[i + 1] if i + 1 < ncol else road_w(zb))
                else:
                    xa0, xa1 = (xs_fixed[i - 1] if i > 0 else road_e(za)), xs_fixed[i]
                    xb0, xb1 = (xs_fixed[i - 1] if i > 0 else road_e(zb)), xs_fixed[i]
                near = (side == 'w' and i == ncol - 1) or (side == 'e' and i == 0)
                if near and za < 36:
                    kind = 'field'
                else:
                    r = rng.random()
                    kind = 'water' if r < 0.5 else ('planted' if r < 0.85 else 'fallow')
                _plot(fm, rng, [(xa0, za), (xa1, za), (xb1, zb), (xb0, zb)], kind, along_x=(rng.random() < 0.5))
        # 畦：区画の線（南北の線は区画の z の範囲、東西の線は西の端から道の側まで）
        z0, z1 = zs_side[0], zs_side[-1]
        for x in xs_fixed:
            if abs(x) < 64.9:
                fm.bund([(x, z0), (x, z1)], rng)
        zz = np.arange(z0, z1 + 1e-6, 2.5)
        edge = [((road_w(z) if side == 'w' else road_e(z)), z) for z in zz]
        fm.bund(edge, rng)
        for z in zs_side:
            if side == 'w':
                fm.bund([(FIELDS['x0'], z), (road_w(z), z)], rng)
            else:
                fm.bund([(road_e(z), z), (FIELDS['x1'], z)], rng)
    V = np.array(fm.v)
    verts_b = np.stack([V[:, 0], -V[:, 2], V[:, 1]], -1)
    m_earth = gtx.material('road', gtx.build_road(), gtx.ROAD_TILE)
    m_turf = gtx.material('turf', gtx.build_turf(), gtx.TURF_TILE)
    o = mesh_object('ground_fields', verts_b, fm.f, mat_slots=[m_earth, m_turf, water_material()], face_mats=fm.fm)
    me = o.data
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    pm = np.array([pp.material_index for pp in me.polygons for _ in pp.loop_indices])
    tile = np.where(pm == 1, gtx.TURF_TILE[0], 4.0)
    P_ = verts_b[lv]
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', np.stack([P_[:, 0] / tile, P_[:, 1] / tile], -1).astype(np.float32).ravel())
    # 色：土・草は細い範囲と同じ大きな明暗を掛ける
    cols = np.array(fm.col, np.float64)
    mac = np.clip(0.06 * F_MAC(V[:, 0], V[:, 2]) + 0.05 * F_MAC2(V[:, 0], V[:, 2]), -0.15, 0.12)
    cols = np.clip(cols * (1 + mac)[:, None] * EARTH_TINT[None] ** 0.3, 0.2, 1.0)
    set_point_colors(o, cols)
    print(f'fields: {len(fm.f)} faces')
    return o


# ---------------------------------------------------------------------------
# 小物の足元・人の道（Version 28：street28/props28.placed.json）
# ---------------------------------------------------------------------------

def placed_rects(pad=0.0, types=None):
    """小物の歩きの当たり判定の箱（筵は形の箱）をゲームの座標へ写した四角形 (x0, x1, z0, z1)。types があればその種類だけ"""
    out = []
    for it in PLACED['placed']:
        if types is not None and it['type'] not in types:
            continue
        t = PTYPES[it['type']]
        c, s_ = math.cos(it['rotY']), math.sin(it['rotY'])
        boxes = t['walk'] if t['walk'] else [t['bounds']]
        for r in boxes:
            xs, zs_ = [], []
            for px in (r['x0'] * it['sx'], r['x1'] * it['sx']):
                for pz in (r['z0'], r['z1']):
                    xs.append(it['x'] + px * c + pz * s_)
                    zs_.append(it['z'] - px * s_ + pz * c)
            out.append((min(xs) - pad, max(xs) + pad, min(zs_) - pad, max(zs_) + pad))
    return out


PROP_RECTS = placed_rects()
MAT_RECTS = placed_rects(types=('mat',))      # 筵の形の箱（下の地面の起伏を消す：bump_fade）
KEEP_PTS = [tuple(q) for q in PLACED['keep_clear']['points']]
KEEP_PATHS = [[tuple(q) for q in path] for path in PLACED['keep_clear']['paths']]


def near_keep(x, z, r):
    """人の置き場所・町の人の道すじから r より近いか（低木・大きな石を置かない）"""
    if any(math.hypot(x - px, z - pz) < r for px, pz in KEEP_PTS):
        return True
    for path in KEEP_PATHS:
        for p0, p1 in zip(path[:-1], path[1:]):
            if float(seg_dist(np.array([x]), np.array([z]), p0, p1)[0]) < r:
                return True
    return False


# 砂利のむら（ゲームの (x, z, 半径 x, 半径 z, 回転)）：木戸の下の踏み固めた砂利、荷置き場、詰所の囲い
GRAVEL = [(0.0, 16.45, 2.5, 0.95, 0.0), (-8.7, 12.1, 1.5, 1.05, 0.35), (-10.9, 9.3, 1.3, 0.85, -0.25), (14.9, -6.3, 1.5, 0.95, 0.15)]


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
                col = curb_color(rng)
                if kind == 'house' and rng.random() < 0.35:
                    col = (col[0] * 0.86, col[1] * 0.95, col[2] * 0.76, 1.0)      # 家の側の縁石に苔
                ymax, vs = split_stone(bm, col_layer, rng, xa + 0.006, xb - 0.006, z + gap / 2, z + ln - gap / 2,
                                       top, -0.34, bevel=rng.uniform(0.03, 0.045), color=col, chip=chip)
                lim = (g + 0.03) if kind == 'road' else 0.03 if under_bridge else 9.0
                if ymax > lim:
                    # 道側の上端は道から 3 cm まで（出すぎた石は沈める）
                    for v in vs:
                        v.co.z -= ymax - lim
                if z + ln < zend - 0.05:
                    joints.append(((xa + xb) / 2, z + ln, kind, s))
                z += ln
        # 両端の石（溝をふさぐ）。外の端は地面の穴の縁の下へ 3 cm 差し込み、上端は穴の縁の地面より上に
        # （低い目線で溝の先を見たとき、石と穴の縁のすき間から下の何もない所が白い線に見えないように）
        for za, zb, edge in ((z0 - 0.03, z0 + 0.16, z0), (z1 - 0.16, z1 + 0.03, z1)):
            g = float(terrain_height_at(np.array([(hx0 + hx1) / 2]), np.array([(za + zb) / 2]))[0])
            ge = float(np.max(terrain_height_at(np.array([hx0, (hx0 + hx1) / 2, hx1]), np.array([edge, edge, edge]))))
            split_stone(bm, col_layer, rng, hx0 + 0.005, hx1 - 0.005, za + 0.005, zb - 0.005, max(g, ge) + 0.012, -0.34, bevel=0.03,
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
# 町家・路地に掛かる石は置かない（町家の置き場所を動かしたとき）
ROCKS = [r for r in ROCKS if not any(in_rect(r[0], r[1], h, r[2] + 0.2) for h in HOUSE_BODY + HOUSE_APRON)
         and not (ALLEY[0] - 0.3 < r[1] < ALLEY[1] + 0.3 and -11.0 < r[0] < -3.0)
         and not any(in_rect(r[0], r[1], h, r[2] + 0.3) for h in PROP_RECTS)
         and not any(math.hypot(r[0] - t['x'], r[1] - t['z']) < r[2] + 0.6 for t in STREET['trees'])
         and not (r[2] >= 0.33 and near_keep(r[0], r[1], r[2] + 0.9))]


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
    # 水際：側溝の中（地面より下）の石の面は濡れて暗く、少し緑（苔）。道の面より上は乾いたまま
    for v in bm.verts:
        z = v.co.z
        if z < -0.02:
            k = min(1.0, (-0.02 - z) / 0.12)
            c = v[col_layer]
            v[col_layer] = (c[0] * (1 - 0.48 * k), c[1] * (1 - 0.4 * k), c[2] * (1 - 0.52 * k), 1.0)
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
    # 浅い水面（溝の底 −0.26 の上 9 cm。縁石の間いっぱい）
    wv, wf, wc = [], [], []
    for d in DITCH.values():
        (z0, z1) = d['z']
        cx0, cx1 = d['chan']
        n = max(2, int((z1 - z0) / 0.6))
        base = len(wv)
        for k in range(n + 1):
            z = z0 + 0.12 + (z1 - z0 - 0.24) * k / n
            y = -0.17 + rng.uniform(-0.003, 0.003)
            wv += [(cx0 - 0.03, -z, y), (cx1 + 0.03, -z, y)]
            g = rng.uniform(0.9, 1.08)
            wc += [(0.95 * g, 1.0 * g, 0.92 * g)] * 2
        for k in range(n):
            a_ = base + k * 2
            wf.append((a_, a_ + 2, a_ + 3, a_ + 1))
    water = mesh_object('ground_ditch_water', wv, wf, mat_slots=[water_material()])
    for pg in water.data.polygons:
        if pg.normal.z < 0:
            pg.flip()
    set_point_colors(water, np.array(wc))
    water['cast'] = False
    o = mesh_object('ground_ditch_bed', verts, faces, mat_slots=[mats.get('earth_road', vcol=True)])
    # 面は上向きに（Y が -z なので並びを確かめる）
    for p in o.data.polygons:
        if p.normal.z < 0:
            p.flip()
    smooth(o)
    bpy.context.view_layer.update()
    mats.uv_box(o)
    set_point_colors(o, np.array(cols))
    return o, (fill0, len(verts)), water


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
    if any(in_rect(x, z, rr, r + 0.05) for rr in PROP_RECTS):
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


STONE_CLUSTERS = [  # ゲームの (x, z, 半径, 個数)：道の端と門の敷居の前だけ（道の真ん中には置かない。点々に見えるので少なく）
    (-2.85, -9.4, 0.8, 4), (2.9, -8.1, 0.8, 3), (-2.95, -4.0, 0.6, 2), (2.85, -1.2, 0.7, 3),
    (3.0, 7.3, 0.7, 3), (-2.95, 5.6, 0.7, 3), (2.7, -14.6, 0.8, 3), (-2.6, -17.0, 0.9, 3),
    (-1.5, -10.6, 0.8, 4), (1.6, -10.8, 0.7, 3), (-2.95, 10.2, 0.7, 2), (3.0, 13.6, 0.7, 2),
]
STONES_TOTAL = 44          # まとまり以外は道の縁（|x| 2.4 m より外）と東の塀ぎわの土だけ


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
    while len(pts) < STONES_TOTAL and tries < 20000:
        tries += 1
        x, z = rng.choice((-1, 1)) * rng.uniform(2.4, 3.3), rng.uniform(-24.0, 18.0)
        if rng.random() < 0.25:
            x, z = rng.uniform(4.3, 6.2), rng.uniform(-10.4, 2.6)
        r = 0.08 + 0.12 * rng.random() ** 1.5
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
    sc = np.array([1.0 * (1 + w), 0.9, 0.78 * (1 - w)]) * 0.86 * k        # 土の明るさの ±12%、土に近い暖かい灰色（暗い点に見えないように）
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
    fin = np.clip(rng.uniform(0.78, 0.93, seg) - 0.12 * (rng.random(seg) < 0.3), 0.62, 0.93)
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
        for _ in range(int(ln / 3.0)):
            t_ = rng.uniform(0, ln)
            side = rng.choice((-1, 1))
            off = side * (width / 2 + rng.uniform(0.0, 0.1))
            x_, z_ = xa + ux * t_ + nx * off, za + uz * t_ + nz * off
            if base_dist(np.array([x_]), np.array([z_]))[0] > 0.03:
                kk = rng.uniform(0.75, 1.05)
                add_pebble(ov, rng, x_, z_, rng.uniform(0.015, 0.03), (0.76 * kk, 0.72 * kk, 0.66 * kk))


def add_gravel_patch(ov, rng, cx, cz, rx, rz, rot):
    """砂利のむら：中は地面より 6 mm 上、縁は揃わない輪郭で地面の下へもぐる（土 ↔ 砂利の移り変わり）"""
    seg = 18
    th = np.arange(seg) / seg * math.tau
    wob = 1 + 0.16 * np.sin(3 * th + rng.uniform(0, 6)) + 0.08 * np.sin(7 * th + rng.uniform(0, 6))

    def ring(f):
        lx = np.cos(th) * rx * f * wob
        lz = np.sin(th) * rz * f * wob
        return cx + lx * math.cos(rot) - lz * math.sin(rot), cz + lx * math.sin(rot) + lz * math.cos(rot)
    col = np.array([1.0, 0.95, 0.88])
    c = ov.add(cx, float(terrain_height_at(np.array([cx]), np.array([cz]))[0]) + 0.007, cz, tuple(col * 0.97))
    rings = []
    for f, dy, k in ((0.45, 0.007, 0.98), (0.8, 0.005, 0.95), (1.0, -0.004, 0.86)):
        xs, zs = ring(f)
        g = terrain_height_at(xs, zs)
        rings.append([ov.add(xs[i], g[i] + dy, zs[i], tuple(col * k * rng.uniform(0.95, 1.04))) for i in range(seg)])
    for i in range(seg):
        i1 = (i + 1) % seg
        ov.tri(c, rings[0][i], rings[0][i1], 2)
        for a_, b_ in ((rings[0], rings[1]), (rings[1], rings[2])):
            ov.tri(a_[i], b_[i], b_[i1], 2)
            ov.tri(a_[i], b_[i1], a_[i1], 2)


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
        centres.append((x + rng.uniform(-0.3, 0.3), -5.6 + DZW - rng.uniform(0.05, 0.3)))
    for s in (-1, 1):
        centres.append((s * rng.uniform(2.95, 3.1), -11.2))
    for cx, cz in centres[::2]:
        for _ in range(int(rng.integers(1, 3))):
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
    for g in GRAVEL:
        add_gravel_patch(ov, rng, *g)
    peb = pebble_spots(rng)
    for x, z, r in peb:
        k = rng.uniform(0.72, 1.08)
        w = rng.normal(0, 0.04)
        add_pebble(ov, rng, x, z, r, (0.74 * k * (1 + w), 0.71 * k, 0.66 * k * (1 - w)))
    V = np.array(ov.v)
    verts_b = np.stack([V[:, 0], -V[:, 2], V[:, 1]], -1)
    m_earth = gtx.material('road', gtx.build_road(), gtx.ROAD_TILE)
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


def add_roughness_to_lightmap(terrain, img):
    """
    焼いた AO の画像（lightmap UV、R=G=B=AO）の G に土の粗さ（乾き・湿りの地図）を書き、
    地面の土の材質の粗さをそこから取る（glTF の ORM：R 遮蔽・G 粗さ・B 金属 0、どれも TEXCOORD_1）。
    繰り返しの画像では場所ごとの湿りを出せないので、繰り返さない 2048 px（約 2 cm）の地図にする。
    """
    n = img.size[0]
    px = np.empty(n * n * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(n, n, 4)
    u = (np.arange(n) + 0.5) / n
    U, V = np.meshgrid(u, u)                    # 行 = v（下から）、列 = u
    X = AREA['x0'] + U * (AREA['x1'] - AREA['x0'])
    Z = AREA['z1'] - V * (AREA['z1'] - AREA['z0'])
    r = np.empty_like(X)
    for i0 in range(0, n, 256):                 # 行ごとに分けて（メモリ）
        r[i0:i0 + 256] = road_roughness(X[i0:i0 + 256].ravel(), Z[i0:i0 + 256].ravel()).reshape(-1, n)
    px[..., 1] = r
    px[..., 2] = 0.0
    img.pixels.foreach_set(px.ravel())
    img.save()
    m = terrain.material_slots[0].material
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    sep = nt.nodes['ao_sep']
    for nd in [nd for nd in nt.nodes if nd.type == 'TEX_IMAGE' and nd.image is not None and nd.image.name.startswith('road_orm')]:
        nt.nodes.remove(nd)
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    print('roughness map: p1/p50/p99', np.percentile(r, [1, 50, 99]).round(3))


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


# 空き地が狭い（町家 A が塀に近い）ときは垣を作らない（路地をふさがない）
FENCE_RUNS = [((FENCE_X, -11.3), (FENCE_X, FENCE_Z)), ((FENCE_X, FENCE_Z), (-15.6, FENCE_Z))] if FENCE_Z > -10.0 else []


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

def _plant_ok(x, z, avoid_road=True, shrub=False):
    if avoid_road and abs(x) < ROAD_HW + 0.1 and not (abs(z - EW_Z) < 0.9):
        return False
    if any(in_rect(x, z, r, 0.05) for r in HOUSE_BODY + HOUSE_APRON) or any(in_rect(x, z, r, 0.02) for r in wall_rects()):
        return False
    if any(in_rect(x, z, (d['hole'][0], d['hole'][1], d['z'][0], d['z'][1]), 0.02) for d in DITCH.values()):
        return False
    if any(in_rect(x, z, r, 0.02) for r in FOOTINGS):
        return False
    if ALLEY[0] <= z <= ALLEY[1] and x < -3.0 and not (z > ALLEY[1] - 0.35):
        return False
    if abs(z - FENCE_Z) < 0.12 and x < FENCE_X + 0.1 or abs(x - FENCE_X) < 0.12 and z < FENCE_Z + 0.1:
        return False
    if any(math.hypot(x - rx, z - rz) < rr + 0.1 for rx, rz, rr, *_ in ROCKS):
        return False
    if any(math.hypot(x - t['x'], z - t['z']) < 0.45 for t in STREET['trees']):
        return False
    # 小物の足元（柵の帯は根元に草が生えてよいので、柵の間だけは許す）
    if any(in_rect(x, z, r, 0.08 if shrub else 0.03) for r in PROP_RECTS if (r[1] - r[0]) * (r[3] - r[2]) > 0.06 or shrub):
        return False
    if shrub and near_keep(x, z, 1.0):
        return False
    # 木戸の口（道の続き）・路地（町家 D と土蔵造りの店の間）は空ける
    if abs(x) < 2.8 and abs(z - FENCE_S) < 1.6:
        return False
    if 4.2 < x < 10.0 and 11.0 < z < 12.4 and not (abs(z - 11.05) < 0.12 or abs(z - 12.3) < 0.12):
        return False
    return True


def plant_spots(joints):
    """
    草むら・低木の置き場所（Version 28）。まとまりと抜けを付ける：
    塀の根元・柵と板塀の裾・家の脇（妻の壁の根元）・側溝の縁石の目地と端・木の根元・木戸の外の道の縁。
    つつじは羊歯・草と組にして置く（ひとつだけの暗い塊にしない）
    """
    rng = np.random.default_rng(81)
    spots = []
    grass = ('grass_a', 'grass_b', 'grass_c')

    def add(kind, x, z, sc, shrub=False, avoid_road=False):
        if _plant_ok(x, z, avoid_road=avoid_road, shrub=shrub):
            spots.append((kind, x, z, sc))
            return True
        return False

    def cluster(cx, cz, n, rad=0.28, smin=0.55, smax=1.05, avoid_road=True):
        k = tries = 0
        while k < n and tries < n * 30:
            tries += 1
            a, d = rng.uniform(0, math.tau), rad * math.sqrt(rng.random())
            x, z = cx + d * math.cos(a), cz + d * math.sin(a) * 0.8
            if add(grass[rng.integers(3)], x, z, rng.uniform(smin, smax), avoid_road=avoid_road):
                k += 1

    def shrub_group(cx, cz, sc=0.85, azalea=True):
        """低木の組：つつじ（小さめ）＋羊歯＋草（どれかが置けなければ、置ける物だけ）"""
        if azalea:
            add('shrub_azalea', cx, cz, sc * rng.uniform(0.75, 0.9), shrub=True)
        add('shrub_fern', cx + rng.uniform(0.35, 0.55) * rng.choice((-1, 1)), cz + rng.uniform(-0.25, 0.25), sc * rng.uniform(0.8, 1.0), shrub=True)
        cluster(cx + rng.uniform(-0.3, 0.3), cz + rng.uniform(-0.3, 0.3), int(rng.integers(3, 6)), rad=0.45, avoid_road=False)

    def along(p0, p1, step, off, fn):
        """p0→p1 の線に沿って、step ごとに（間を抜きながら）fn(x, z)"""
        (xa, za), (xb, zb) = p0, p1
        ln = math.hypot(xb - xa, zb - za)
        ux, uz = (xb - xa) / ln, (zb - za) / ln
        nx, nz = -uz, ux
        t = rng.uniform(0, step)
        while t < ln:
            if rng.random() > 0.3:               # 3 割は抜く（まとまりと抜け）
                o = off * rng.uniform(0.6, 1.3)
                fn(xa + ux * t + nx * o, za + uz * t + nz * o)
            t += step * rng.uniform(0.7, 1.3)

    # ---- 塀の根元（Version 27 と同じ所）
    for x in (-15.8, -11.6, -8.3, -6.0, -3.4, 3.35, 4.6, 6.4):
        cluster(x + rng.uniform(-0.3, 0.3), EW_Z + WALL_HALF + rng.uniform(0.08, 0.3), int(rng.integers(3, 5)), avoid_road=False)
    for z in (-9.6, -5.8, -1.9, 1.8):
        cluster(NS_X - WALL_HALF - rng.uniform(0.08, 0.3), z + rng.uniform(-0.3, 0.3), int(rng.integers(3, 6)))
    for x in (-9.5, -5.2, 4.4):
        cluster(x, EW_Z - WALL_HALF - rng.uniform(0.08, 0.3), 3)
    for x in (-9.4, -7.1):
        cluster(x, -5.75 + DZW, 3, rad=0.2)
    # 塀の根元の低木の組（城門の脇・城内側）。休み場・援兵・高札の前は空ける
    for (x, z) in ((-13.6, -10.85), (-10.3, -10.95), (-7.0, -10.95), (5.3, -11.0), (8.6, -10.95), (10.6, -10.95), (-12.0, -13.4), (6.0, -13.3)):
        shrub_group(x, z, azalea=rng.random() < 0.6)
    # ---- 柵の裾（町の南の境）・西の小屋の板塀の裾・木戸の柱の根元
    along((-20.5, FENCE_S - 0.2), (-8.6, FENCE_S - 0.2), 2.6, 0.0, lambda x, z: cluster(x, z, int(rng.integers(2, 4)), rad=0.3, avoid_road=False))
    along((-20.5, FENCE_S + 0.25), (-3.3, FENCE_S + 0.25), 2.2, 0.0, lambda x, z: cluster(x, z, int(rng.integers(2, 4)), rad=0.3, avoid_road=False))
    along((9.9, FENCE_S + 0.25), (19.5, FENCE_S + 0.25), 2.2, 0.0, lambda x, z: cluster(x, z, int(rng.integers(2, 4)), rad=0.3, avoid_road=False))
    along((10.0, FENCE_S - 0.2), (19.5, FENCE_S - 0.2), 2.8, 0.0, lambda x, z: cluster(x, z, int(rng.integers(2, 4)), rad=0.3, avoid_road=False))
    along((-4.32, 13.0), (-4.32, 16.2), 1.1, 0.0, lambda x, z: cluster(x, z, int(rng.integers(2, 4)), rad=0.18, avoid_road=False))
    along((-4.8, 13.0), (-4.8, 16.2), 1.6, 0.0, lambda x, z: cluster(x, z, 2, rad=0.2, avoid_road=False))
    for s_ in (-1, 1):
        cluster(s_ * 3.15, FENCE_S + 0.3, 3, rad=0.15, avoid_road=False)
    # ---- 家の脇（妻の壁の根元）：町家 A の北・B の南・D の北・土蔵の南、路地の両側
    a_, b_, d_, k_ = (_solid(i, 'body') for i in ('machiya_a28', 'machiya_b28', 'machiya_d28', 'kura28'))
    along((a_['x0'] + 0.3, a_['z0'] - 0.18), (a_['x1'] - 0.3, a_['z0'] - 0.18), 1.3, 0.0, lambda x, z: cluster(x, z, 3, rad=0.2, avoid_road=False))
    along((b_['x0'] + 0.3, b_['z1'] + 0.18), (b_['x1'] - 0.2, b_['z1'] + 0.18), 1.3, 0.0, lambda x, z: cluster(x, z, 3, rad=0.18, avoid_road=False))
    along((d_['x0'] + 0.4, d_['z0'] - 0.18), (d_['x1'] - 0.2, d_['z0'] - 0.18), 1.2, 0.0, lambda x, z: cluster(x, z, 3, rad=0.18, avoid_road=False))
    along((k_['x0'] + 0.5, k_['z1'] + 0.2), (k_['x1'] - 0.2, k_['z1'] + 0.2), 1.0, 0.0, lambda x, z: cluster(x, z, 3, rad=0.15, avoid_road=False))
    along((d_['x0'] + 0.6, d_['z1'] + 0.1), (d_['x1'] - 0.3, d_['z1'] + 0.1), 1.6, 0.0, lambda x, z: cluster(x, z, 2, rad=0.1, avoid_road=False))
    along((k_['x0'] + 0.6, k_['z0'] - 0.1), (k_['x1'] - 0.3, k_['z0'] - 0.1), 1.6, 0.0, lambda x, z: cluster(x, z, 2, rad=0.1, avoid_road=False))
    # 西の荷置き場の奥（町家 B の裏・小屋の裏）
    if FENCE_Z > -10.0:
        pass
    for (x, z) in ((-11.6, 8.6), (-7.2, 9.3), (-13.6, 11.6), (-12.8, 15.4), (-9.6, 15.6)):
        cluster(x, z, int(rng.integers(2, 4)), rad=0.35, avoid_road=False)
    # ---- 木の根元（羊歯と草）
    for t in STREET['trees']:
        if not (AREA['x0'] < t['x'] < AREA['x1'] and AREA['z0'] < t['z'] < AREA['z1']):
            continue
        for k in range(int(rng.integers(1, 3))):
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0.6, 1.3)
            x, z = t['x'] + d * math.cos(a), t['z'] + d * math.sin(a)
            if rng.random() < 0.45:
                add('shrub_fern', x, z, rng.uniform(0.7, 0.95), shrub=True)
            else:
                cluster(x, z, int(rng.integers(2, 4)), rad=0.3, avoid_road=False)
    # ---- 木戸の外の道の縁
    for s_ in (-1, 1):
        along((s_ * (ROAD_HW + 0.7), FENCE_S + 0.8), (s_ * (ROAD_HW + 0.7), 19.6), 1.3, 0.0,
              lambda x, z: cluster(x + rng.uniform(-0.4, 0.8) * (1 if x > 0 else -1), z, int(rng.integers(2, 5)), rad=0.4, smin=0.7, smax=1.25, avoid_road=False))
    # ---- 側溝の縁石の目地（見える所の 3 割）と、側溝の端
    for x, z, kind, s_ in joints:
        if rng.random() < 0.2:
            spots.append((grass[1 + rng.integers(2)], x + rng.uniform(-0.03, 0.03), z, rng.uniform(0.3, 0.5)))
    for d in DITCH.values():
        # 溝の両端の外（南の端は南へ、北の端は北へ 0.25 m。溝を暗渠で分けた所でも溝の外）
        for zz, out in ((d['z'][0], -0.25), (d['z'][1], 0.25)):
            cluster((d['hole'][0] + d['hole'][1]) / 2 + d['side'] * 0.35, zz + out, 3, rad=0.15, avoid_road=False)
    # 空き地（Version 27：町家 A の裏）
    for _ in range(3):
        cluster(rng.uniform(-17.5, -11.4), rng.uniform(-11.0, -4.0), int(rng.integers(3, 5)), smin=0.7, smax=1.2)
    print('plant spots', len(spots), {k: sum(1 for s_ in spots if s_[0] == k) for k in ('grass_a', 'grass_b', 'grass_c', 'shrub_azalea', 'shrub_fern')})
    return spots


def build_plants(joints):
    root, objs = asm.load_glb('_plants_kit', MODELS_DIR / 'plants.glb')
    kit = {o.name.split('.')[0]: o for o in objs if o.type == 'MESH'}
    rng = np.random.default_rng(91)
    groups = {'plants_grass': [], 'plants_fern': [], 'plants_azalea': []}
    for kind, x, z, sc in plant_spots(joints):
        src = kit[kind]
        c = src.copy()
        c.data = src.data.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = None
        y = float(terrain_height_at(np.array([x]), np.array([z]))[0])
        # つつじは少し平たく、横に不揃いに（丸い塊に見せない）
        S = mathutils.Matrix.Diagonal((sc * rng.uniform(0.9, 1.15), sc * rng.uniform(0.85, 1.1), sc * (0.78 if kind == 'shrub_azalea' else 1.0), 1.0))
        c.matrix_world = (mathutils.Matrix.Translation(g2b(x, y - 0.01, z)) @ mathutils.Matrix.Rotation(rng.uniform(0, math.tau), 4, 'Z') @ S)
        g = 'plants_grass' if kind.startswith('grass') else ('plants_fern' if kind == 'shrub_fern' else 'plants_azalea')
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
        o['cast'] = not name == 'plants_grass'
        o['receive'] = True
        if name == 'plants_azalea':
            # Version 27 のつつじは奥が暗すぎて黒い塊に見えた：頂点色（体積の遮蔽）の暗さを半分にし、葉の緑を少し明るく
            a = o.data.color_attributes.get(mats.COLOR_ATTR) or o.data.color_attributes[0]
            buf = np.empty(len(a.data) * 4, np.float32)
            a.data.foreach_get('color', buf)
            buf = buf.reshape(-1, 4)
            buf[:, :3] = np.clip((0.45 + 0.55 * buf[:, :3]) * np.array([1.06, 1.12, 0.96]), 0, 1)
            a.data.foreach_set('color', buf.ravel())
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
    d = {'name': 'ground_v3', 'coords': 'game (x east, y up, z south), meters',
         '_about': '地面の素材（Version 28）の当たり判定（大きな石）。側溝は歩いて渡れる（当たり判定なし）。カメラ除けの箱は無し（低い物だけ）。'
                   'built_from は制作が読んだ通りの配置（street28.json）の値（tests/proto3d-town.test.ts が今の表と同じかを確かめる：表を変えたら地面を作り直す）。',
         'colliders': col,
         'built_from': {
             'buildings': [{'id': b['id'], 'footprint': b['footprint']} for b in STREET['buildings']],
             'ditches': [{'name': d_['name'], 'x': d_['x'], 'z': d_['z']} for d_ in STREET['edges']['ditches']],
             'road_half_width': ROAD_HW,
             'trees': [{'name': t['name'], 'x': t['x'], 'z': t['z']} for t in STREET['trees']],
             'props_placed': len(PLACED['placed']),
             'kido_z': FENCE_S,
             'fields': FIELDS,
         },
         **stats}
    META.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')


# ---------------------------------------------------------------------------

def bake_terrain_ao(terrain, size, quick):
    """
    地面の ORM（R 遮蔽）：空の見え方（6 m）と、接地の陰（0.7 m：建物・小物・木の根元の周り）を 2 回焼いて掛ける。
    画像は build/ground_v3/ に置く（共有の build の新しいフォルダ）
    """
    path = WORK / 'ground_terrain_v3.png'
    img = mats.bake_ao_to_texture(terrain, size, 'lightmap', samples=12 if quick else 32, distance=6.0, strength=0.85,
                                  ground_plane=False, margin=4, blur_px=1, path=path)
    sky = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(sky)
    img = mats.bake_ao_to_texture(terrain, size, 'lightmap', samples=12 if quick else 40, distance=0.7, strength=0.6,
                                  ground_plane=False, margin=4, blur_px=1, path=path)
    near = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(near)
    px = near.reshape(-1, 4)
    px[:, :3] = px[:, :3] * sky.reshape(-1, 4)[:, :3]
    img.pixels.foreach_set(px.ravel())
    img.save()
    print('terrain AO: sky × contact, p1/p50', np.percentile(px[:, 0], [1, 50]).round(3))
    return img


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
    fields = build_fields()
    stone, joints = build_stones()
    bed, fill_rng, water = build_ditch_beds()
    fence = build_fence() if FENCE_RUNS else []
    plants = build_plants(joints)
    overlay, pts, ov_cols, ov_V = build_overlay()
    ground = [terrain, far, fields, stone, bed, water, *fence]
    print('built in', round(time.time() - t0, 1), 's; triangles', {o.name: triangles([o]) for o in ground + plants + [overlay]})
    img = None
    if not a.no_bake:
        # 周りの建物・小物・木を置いたまま焼く（遮るものとして）。重ねる物は地面の焼き込みには入れない（下の地面が黒くなるので）
        others = asm.assemble28()
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
        # 地面：空の見え方と接地の陰を occlusionTexture に。草の板・水面は遮る物から外す
        for o in plants + [water]:
            o.hide_render = True
        img = bake_terrain_ao(terrain, 1024 if a.quick else 2048, a.quick)
        add_roughness_to_lightmap(terrain, img)
        for o in plants + [water]:
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
    gtx.jpeg_materials({s_.material for o in ground for s_ in o.material_slots})
    size = export_glb(out_path, ground, jpeg=False)
    tri = triangles(ground)
    per = {o.name: triangles([o]) for o in ground}
    print('exported', out_path, size, 'bytes', tri, 'tris', per, round(time.time() - t0, 1), 's')
    psize = export_glb(OUT_PLANTS, plants, jpeg=False)
    ptri = triangles(plants)
    print('exported', OUT_PLANTS, psize, 'bytes', ptri, 'tris', {o.name: triangles([o]) for o in plants})
    s_ = mats.glb_summary(out_path)
    for m in s_['materials']:
        print(' mat', m)
    print(' images', s_['images'])
    if out_path == OUT:
        write_meta(dict(triangles=tri, glb_bytes=size, embedded_stones=len(pts), plants=dict(glb='models/ground_plants28.glb', triangles=ptri, glb_bytes=psize),
                        triangles_by_part=per))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
