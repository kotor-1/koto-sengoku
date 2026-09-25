"""
木と草の制作の共通部分（Blender 4.5 を Python の部品として実行）。
- 管（幹・枝）: 中心線と半径の列から、四角形の輪を重ねた網を作る（UV は周り u・長さ v をメートルで）
- 葉のカード: 画像の区画を貼った、中央を少し膨らませた 2 枚の四角形（三角形 4 枚）
- 体積の遮蔽（AO）: 葉のカードの密度を格子に積み、各頂点から空の方向へ光線を進めて透過率を求める。
  頂点色 'Col'（glTF の COLOR_0。three.js で基本色に掛かる）に入れて、塊の奥・下側・枝の付け根・地面際を暗くする
- 材質: 樹皮（色・法線）と、アルファで切り抜くカード（両面）。どちらも頂点色を掛ける
- 確認用の描画: ゲームと同じ向きの日差しで Cycles
座標はすべて Blender（Z が上、+Y が北、+X が東）。
"""
from __future__ import annotations

import json
import math
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'lib'))
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from common import (BLENDER_DIR, BUILD_DIR, MODELS_DIR, PREVIEW_DIR, add_preview_lights, export_glb,  # noqa: E402,F401
                    g2b, render_preview, reset, scene_layout, triangles)

HERE = pathlib.Path(__file__).resolve().parent
TEX = BUILD_DIR / 'trees'
TEX_VERSION = 'v3'
TEX_VERSIONS = {'sakura_blossom': 'v4'}   # textures.py の VERSIONS と同じ（作り直した画像の版）
UP = np.array([0.0, 0.0, 1.0])
META = HERE / 'trees.meta.json'


def tex(name: str, suffix: str = '') -> pathlib.Path:
    return TEX / f'{name}_{TEX_VERSIONS.get(name, TEX_VERSION)}{suffix}.png'


def ensure_textures() -> None:
    """画像が無ければ textures.py（普通の python3）で作る"""
    need = [tex('pine_bark', '_albedo'), tex('pine_bark', '_normal'), tex('sakura_bark', '_albedo'), tex('sakura_bark', '_normal'),
            tex('pine_needles'), tex('sakura_blossom'), tex('plants')]
    if not all(p.exists() for p in need):
        subprocess.run(['python3', str(HERE / 'textures.py')], check=True)


def unit(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def catmull(ctrl, step):
    """制御点を通る曲線（Catmull-Rom）を、ほぼ step メートルおきの点の列に"""
    c = np.asarray(ctrl, np.float64)
    c = np.vstack([2 * c[0] - c[1], c, 2 * c[-1] - c[-2]])
    out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        n = max(1, int(math.ceil(np.linalg.norm(p2 - p1) / step)))
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(c[-2])
    return np.array(out)


def arc_length(pts):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


def resample(pts, step):
    """折れ線を等間隔に取り直す"""
    s = arc_length(pts)
    n = max(2, int(math.ceil(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, k]) for k in range(3)], -1)


def point_at(pts, frac):
    """折れ線の長さの割合 frac の点と接線"""
    s = arc_length(pts)
    x = frac * s[-1]
    i = int(np.clip(np.searchsorted(s, x) - 1, 0, len(pts) - 2))
    t = (x - s[i]) / max(s[i + 1] - s[i], 1e-9)
    return pts[i] + (pts[i + 1] - pts[i]) * t, unit(pts[i + 1] - pts[i])


def perp(v):
    a = np.array([0.0, 0.0, 1.0]) if abs(v[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    return unit(np.cross(a, v))


def rotate(v, axis, ang):
    """ベクトル v を軸 axis のまわりに ang ラジアン回す（ロドリゲス）"""
    axis = unit(axis)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


# ---------------------------------------------------------------------------
# 網の組み立て
# ---------------------------------------------------------------------------

class Geo:
    """頂点・UV・法線・四角形の面を貯めて、最後に 1 つの網にする"""

    def __init__(self):
        self.V, self.N, self.UV, self.F, self.T = [], [], [], [], []
        self.seams = []   # 継ぎ目で重なる頂点の組（法線を揃える）
        self.count = 0

    def add(self, V, UV, F, N=None, tag=0.0):
        V = np.asarray(V, np.float64)
        self.V.append(V)
        self.UV.append(np.asarray(UV, np.float64))
        self.N.append(np.zeros_like(V) if N is None else np.asarray(N, np.float64))
        self.F.append(np.asarray(F, np.int64) + self.count)
        self.T.append(np.full(len(V), tag, np.float64) if np.isscalar(tag) else np.asarray(tag, np.float64))
        base = self.count
        self.count += len(V)
        return base

    def arrays(self):
        return (np.concatenate(self.V), np.concatenate(self.UV), np.concatenate(self.F), np.concatenate(self.N), np.concatenate(self.T))


def tube(geo: Geo, pts, radii, sides, tile=(0.8, 0.8), v0=0.0, rfunc=None, tag=0.0, twist=0.0):
    """中心線 pts（N×3）と半径 radii（N）の管。輪ごとに sides+1 頂点（UV の継ぎ目用に 1 つ重ねる）。
    rfunc(i, theta) で輪の形をゆがめる（根張り・こぶ）。返り値は次に続ける v"""
    pts = np.asarray(pts, np.float64)
    radii = np.asarray(radii, np.float64)
    n = len(pts)
    T = np.gradient(pts, axis=0)
    T = unit(T)
    # 平行移動の枠（ねじれない）
    N0 = perp(T[0])
    frames = []
    Nc = N0
    for i in range(n):
        if i > 0:
            b = np.cross(T[i - 1], T[i])
            if np.linalg.norm(b) > 1e-8:
                ang = math.asin(min(1.0, np.linalg.norm(b)))
                if np.dot(T[i - 1], T[i]) < 0:
                    ang = math.pi - ang
                Nc = rotate(Nc, b, ang)
            Nc = unit(Nc - T[i] * np.dot(Nc, T[i]))
        frames.append((Nc, np.cross(T[i], Nc)))
    s = arc_length(pts)
    circ = 2 * math.pi * float(np.mean(radii))
    around = max(1, int(round(circ / tile[0])))
    kv = circ / (around * tile[0])   # 細い枝では模様を縦にも同じだけ縮める（縦長に伸びない）
    th = np.linspace(0, 2 * math.pi, sides + 1) + twist
    V, UV, NR = [], [], []
    for i in range(n):
        Nf, Bf = frames[i]
        r = radii[i] * (rfunc(i, th) if rfunc is not None else np.ones_like(th))
        dirs = np.cos(th)[:, None] * Nf + np.sin(th)[:, None] * Bf
        V.append(pts[i] + dirs * r[:, None])
        NR.append(dirs)
        UV.append(np.stack([(th - twist) / (2 * math.pi) * around, np.full_like(th, v0 + s[i] / (tile[1] * kv))], -1))
    V = np.concatenate(V)
    UV = np.concatenate(UV)
    F = []
    m = sides + 1
    for i in range(n - 1):
        for j in range(sides):
            a = i * m + j
            F.append((a, a + 1, a + 1 + m, a + m))
    base = geo.add(V, UV, F, np.concatenate(NR), tag)
    geo.seams.extend([(base + i * m, base + i * m + sides) for i in range(n)])
    return v0 + s[-1] / (tile[1] * kv)


def smooth_normals(V, F, seams):
    """面の法線（面積の重み）を頂点に集め、継ぎ目の組を揃える"""
    a, b, c, d = (V[F[:, k]] for k in range(4))
    fn = np.cross(c - a, d - b)
    acc = np.zeros_like(V)
    for k in range(4):
        np.add.at(acc, F[:, k], fn)
    if seams:
        s = np.asarray(seams)
        tot = acc[s[:, 0]] + acc[s[:, 1]]
        acc[s[:, 0]] = tot
        acc[s[:, 1]] = tot
    return unit(acc)


def card(geo: Geo, base, s, w, length, width, cell, bulge=0.12, flip=False, tag=0.0, center=False):
    """葉のカード：base から s の向きへ長さ length、幅 width（w の向き）。中央の列を表の向きへ膨らませる（bulge=0 なら平らな 1 枚＝三角形 2 枚）。
    cell=(u0, v0, u1, v1) は画像の区画（v は下から）。表は cross(w, s) の向き"""
    m = unit(np.cross(w, s))
    b = base - s * length * 0.5 if center else base
    u0, v0, u1, v1 = cell
    if flip:
        u0, u1 = u1, u0
    if bulge == 0:
        cols, us = [-0.5, 0.5], [u0, u1]
        F = [(0, 1, 3, 2)]
    else:
        cols, us = [-0.5, 0.0, 0.5], [u0, (u0 + u1) / 2, u1]
        F = [(0, 1, 4, 3), (1, 2, 5, 4)]
    V = []
    for r in (0.0, 1.0):
        for c in cols:
            V.append(b + s * length * r + w * width * c + m * (width * bulge if c == 0 else 0.0))
    UV = [(u, v0) for u in us] + [(u, v1) for u in us]
    return geo.add(np.array(V), np.array(UV), F, np.tile(m, (len(V), 1)), tag)


# ---------------------------------------------------------------------------
# 体積の遮蔽（葉の密度の格子）
# ---------------------------------------------------------------------------

class Density:
    def __init__(self, lo, hi, vox=0.25):
        self.lo = np.asarray(lo, np.float64) - vox * 2
        self.vox = vox
        self.shape = tuple(int(math.ceil(x)) + 4 for x in (np.asarray(hi) - np.asarray(lo)) / vox)
        self.g = np.zeros(self.shape, np.float64)

    def splat(self, P, area):
        idx = np.floor((np.asarray(P) - self.lo) / self.vox).astype(int)
        ok = np.all((idx >= 0) & (idx < np.array(self.shape)), axis=1)
        np.add.at(self.g, tuple(idx[ok].T), np.broadcast_to(area, (len(P),))[ok])

    def finish(self, g_factor=0.5, blur=1):
        """面積 → 消散係数（1/m）。3×3×3 でならす"""
        g = self.g / self.vox ** 3 * g_factor
        for ax in range(3):
            for _ in range(blur):
                g = (np.roll(g, 1, ax) + g + np.roll(g, -1, ax)) / 3
        self.sigma = g


def fib_hemisphere(k):
    i = np.arange(k) + 0.5
    r = np.sqrt(i / k)
    ph = i * math.pi * (3 - math.sqrt(5))
    return np.stack([r * np.cos(ph), r * np.sin(ph), np.sqrt(np.maximum(0, 1 - r * r))], -1)


def volume_ao(P, N, dens: Density, k=24, max_d=4.0, t0=0.1, up_bias=0.6, ground=True, ground_dist=1.6, chunk=20000):
    """各頂点から、法線（と上）のまわりの半球の方向へ進んで透過率の平均を返す（0 暗い〜1 明るい）"""
    D = fib_hemisphere(k)
    out = np.empty(len(P))
    step = dens.vox * 0.8
    ts = np.arange(t0, max_d, step)
    shp = np.array(dens.shape)
    for c0 in range(0, len(P), chunk):
        p = P[c0:c0 + chunk]
        n = unit(N[c0:c0 + chunk] + UP * up_bias)
        a = np.where(np.abs(n[:, 2:3]) < 0.9, UP, np.array([1.0, 0, 0]))
        t1 = unit(np.cross(a, n))
        t2 = np.cross(n, t1)
        dirs = D[None, :, 0:1] * t1[:, None] + D[None, :, 1:2] * t2[:, None] + D[None, :, 2:3] * n[:, None]
        tau = np.zeros(dirs.shape[:2])
        for t in ts:
            q = p[:, None, :] + dirs * t
            idx = np.floor((q - dens.lo) / dens.vox).astype(np.int32)
            ok = np.all((idx >= 0) & (idx < shp), axis=2)
            idx = np.clip(idx, 0, shp - 1)
            tau += dens.sigma[idx[..., 0], idx[..., 1], idx[..., 2]] * ok * step
            if ground and t < ground_dist:
                tau += np.where(q[..., 2] < 0.0, 50.0, 0.0)
        out[c0:c0 + chunk] = np.exp(-tau).mean(1)
    return out


# ---------------------------------------------------------------------------
# 材質
# ---------------------------------------------------------------------------

def _img(path, noncolor=False):
    im = bpy.data.images.load(str(path), check_existing=True)
    im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return im


def _base(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (500, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (200, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0
    return m, nt, bsdf


def _mix_vc(nt, color_socket, bsdf):
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    vc.location = (-400, 300)
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1.0
    mx.location = (-100, 200)
    ins = [s for s in mx.inputs if s.type == 'RGBA']
    outs = [s for s in mx.outputs if s.type == 'RGBA']
    nt.links.new(color_socket, ins[0])
    nt.links.new(vc.outputs['Color'], ins[1])
    nt.links.new(outs[0], bsdf.inputs['Base Color'])


def mat_bark(name, albedo, normal, rough=0.9, nstrength=1.0):
    m, nt, bsdf = _base(name)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = _img(albedo)
    ta.location = (-700, 200)
    _mix_vc(nt, ta.outputs['Color'], bsdf)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = _img(normal, True)
    tn.location = (-700, -250)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = nstrength
    nm.location = (-300, -250)
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough
    m.use_backface_culling = True   # 閉じた管なので片面（glTF の doubleSided=false）
    return m


def mat_cards(name, rgba, rough=0.8, cutoff=0.42, spec=0.35, glow=0.0, double_sided=True):
    """アルファで切り抜く両面のカード（glTF: alphaMode MASK, doubleSided）。
    glow>0 なら画像の色を弱く自ら光らせる（薄い花びらが光を通して明るく見えるのの代わり。glTF の emissiveTexture × emissiveFactor）"""
    m, nt, bsdf = _base(name)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = _img(rgba)
    ta.location = (-700, 200)
    _mix_vc(nt, ta.outputs['Color'], bsdf)
    if glow > 0:
        nt.links.new(ta.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = glow
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = cutoff
    gt.location = (-300, -150)
    nt.links.new(ta.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Specular IOR Level'].default_value = spec
    m.use_backface_culling = not double_sided
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    return m


def mat_flat(name, rgb, rough=0.95):
    m, nt, bsdf = _base(name)
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    return m


# ---------------------------------------------------------------------------
# 網の物体
# ---------------------------------------------------------------------------

def make_object(name, V, UV, F, material, normals=None, color=None, props=None, two_faced=False):
    """四角形だけの網を作る。normals を渡すと独自の法線、color（頂点ごとの RGB）は 'Col' に。
    two_faced=True なら裏向きの面を同じ法線で重ねて作る（片面の材質で使う。three.js の両面描画は裏で法線を反転するので、
    上向きの法線を持つ草のカードが裏から見ると暗くなるのを避ける）"""
    if two_faced:
        n = len(V)
        # 裏の面は法線の向きへ 3 mm ずらす（同じ位置に重ねると確認用の Cycles で素通りや自分の影が出る。ゲームでは見分けられない）
        off = (normals if normals is not None else np.zeros_like(V)) * 0.003
        V = np.concatenate([V, V + off])
        UV = np.concatenate([UV, UV])
        F = np.concatenate([F, F[:, ::-1] + n])
        normals = None if normals is None else np.concatenate([normals, normals])
        color = None if color is None else np.concatenate([color, color])
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    me.loops.add(len(F) * 4)
    me.loops.foreach_set('vertex_index', F.astype(np.int32).ravel())
    me.polygons.add(len(F))
    me.polygons.foreach_set('loop_start', np.arange(0, len(F) * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', UV[F.ravel()].astype(np.float32).ravel())
    me.polygons.foreach_set('use_smooth', np.ones(len(F), bool))
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in normals.astype(np.float32)])
    if color is not None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        rgba = np.ones((len(V), 4), np.float32)
        rgba[:, :3] = color
        ca.data.foreach_set('color', rgba.ravel())
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for k, v in (props or {}).items():
        ob[k] = v
    return ob


# ---------------------------------------------------------------------------
# 確認用の描画
# ---------------------------------------------------------------------------

def _lin(hexs):
    """#rrggbb（sRGB）→ 線形（three.js の Color と同じ）"""
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def preview_setup(ground_size=120.0, ground_srgb='#96805f'):
    """ゲームの光に合わせた確認用の場面：
    日差し #ffe2bd 3.4（向きは SUN_OFFSET）、空の色の環境光（空の色 ×0.45 ＋ 半球光 #d6dde2 0.8 相当）、
    画面の色は Standard で線形に描いてから、three.js と同じ ACES（露出 1.1）を掛ける（render_game）"""
    from common import sun_direction_blender
    s = bpy.context.scene
    world = bpy.data.worlds.new('game-sky')
    s.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    L = nt.links
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs[0])
    mx = nt.nodes.new('ShaderNodeMath')
    mx.operation = 'MAXIMUM'
    mx.inputs[1].default_value = 0.0
    L.new(sep.outputs['Z'], mx.inputs[0])
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 0.5
    L.new(mx.outputs[0], pw.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    L.new(pw.outputs[0], mix.inputs['Factor'])
    ins = [x for x in mix.inputs if x.type == 'RGBA']
    ins[0].default_value = (*_lin('#c9d6db'), 1)
    ins[1].default_value = (*_lin('#4f7fb8'), 1)
    sky_col = [x for x in mix.outputs if x.type == 'RGBA'][0]
    # 日の周りの明るみ
    d = sun_direction_blender()
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    L.new(tc.outputs['Generated'], dot.inputs[0])
    dot.inputs[1].default_value = tuple(d)
    m0 = nt.nodes.new('ShaderNodeMath')
    m0.operation = 'MAXIMUM'
    m0.inputs[1].default_value = 0.0
    L.new(dot.outputs['Value'], m0.inputs[0])
    p6 = nt.nodes.new('ShaderNodeMath')
    p6.operation = 'POWER'
    p6.inputs[1].default_value = 6.0
    L.new(m0.outputs[0], p6.inputs[0])
    k6 = nt.nodes.new('ShaderNodeMath')
    k6.operation = 'MULTIPLY'
    k6.inputs[1].default_value = 0.18
    L.new(p6.outputs[0], k6.inputs[0])
    glow = nt.nodes.new('ShaderNodeMix')
    glow.data_type = 'RGBA'
    glow.blend_type = 'ADD'
    L.new(k6.outputs[0], glow.inputs['Factor'])
    gi = [x for x in glow.inputs if x.type == 'RGBA']
    L.new(sky_col, gi[0])
    gi[1].default_value = (*_lin('#ffdcae'), 1)
    sky_full = [x for x in glow.outputs if x.type == 'RGBA'][0]
    # 光として：空 ×0.45 ＋ 半球光（上半分 0.8/π × #d6dde2）
    amb = nt.nodes.new('ShaderNodeMix')
    amb.data_type = 'RGBA'
    amb.blend_type = 'ADD'
    amb.inputs['Factor'].default_value = 1.0
    ai = [x for x in amb.inputs if x.type == 'RGBA']
    sc = nt.nodes.new('ShaderNodeMix')
    sc.data_type = 'RGBA'
    sc.blend_type = 'MULTIPLY'
    sc.inputs['Factor'].default_value = 1.0
    si = [x for x in sc.inputs if x.type == 'RGBA']
    L.new(sky_full, si[0])
    si[1].default_value = (0.45, 0.45, 0.45, 1)
    L.new([x for x in sc.outputs if x.type == 'RGBA'][0], ai[0])
    hk = 0.8 / math.pi
    ai[1].default_value = tuple(v * hk for v in _lin('#d6dde2')) + (1,)
    lp = nt.nodes.new('ShaderNodeLightPath')
    sw = nt.nodes.new('ShaderNodeMix')
    sw.data_type = 'RGBA'
    L.new(lp.outputs['Is Camera Ray'], sw.inputs['Factor'])
    wi = [x for x in sw.inputs if x.type == 'RGBA']
    L.new([x for x in amb.outputs if x.type == 'RGBA'][0], wi[0])
    L.new(sky_full, wi[1])
    bg = nt.nodes.new('ShaderNodeBackground')
    L.new([x for x in sw.outputs if x.type == 'RGBA'][0], bg.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    L.new(bg.outputs['Background'], out.inputs['Surface'])
    light = bpy.data.lights.new('game-sun', 'SUN')
    light.energy = 3.4
    light.angle = math.radians(0.8)
    light.color = _lin('#ffe2bd')
    o = bpy.data.objects.new('game-sun', light)
    s.collection.objects.link(o)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.view_settings.exposure = 0.0
    s.cycles.transparent_max_bounces = 96
    s.cycles.max_bounces = 6
    s.cycles.diffuse_bounces = 2
    s.cycles.glossy_bounces = 1
    s.cycles.transmission_bounces = 1
    s.cycles.use_denoising = True
    bpy.ops.mesh.primitive_plane_add(size=ground_size, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = 'preview-ground'
    g.data.materials.append(mat_flat('preview-earth', _lin(ground_srgb)))
    return g


def preview_cull(mat):
    """確認用の描画だけ：片面の材質の裏面を透明にする（Cycles は裏面も描くので、three.js の片面描画に合わせる）。書き出しの後に使う"""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    src = out.inputs['Surface'].links[0].from_socket
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
    nt.links.new(src, mix.inputs[1])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])


def _aces(rgb, exposure=1.1):
    """three.js の ACESFilmicToneMapping と同じ式（線形 → 表示用の線形）"""
    Mi = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
    Mo = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
    c = rgb * (exposure / 0.6)
    c = c @ Mi.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ Mo.T
    return np.clip(c, 0, 1)


def render_game(path, cam_game, target_game, *, res=(960, 540), samples=24, fov_deg=50.0):
    """ゲームと同じ色の出し方で描く：線形で EXR に描き、ACES（露出 1.1）と sRGB を掛けて PNG に"""
    import mathutils
    s = bpy.context.scene
    tmp = BUILD_DIR / 'trees' / f'_render_{pathlib.Path(path).stem}.exr'
    cam = bpy.data.objects.get('preview-cam')
    if cam is None:
        cam = bpy.data.objects.new('preview-cam', bpy.data.cameras.new('preview-cam'))
        s.collection.objects.link(cam)
    cam.location = g2b(*cam_game)
    look = mathutils.Vector(g2b(*target_game)) - cam.location
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(fov_deg)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 2000
    s.camera = cam
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'OPEN_EXR'
    s.render.image_settings.color_depth = '32'
    s.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(str(tmp), check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    rgb = _aces(px[..., :3].astype(np.float64))
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    out = bpy.data.images.new('_tm', w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = srgb
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    bpy.data.images.remove(im)
    print('Saved:', path)
    return str(path)


def proxy_box(name, x0, x1, y0, y1, z0, z1, rgb):
    """確認用の箱（Blender の座標で）"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    b = bpy.context.active_object
    b.name = name
    b.scale = (x1 - x0, y1 - y0, z1 - z0)
    b.data.materials.append(mat_flat(name + '-m', rgb, 0.9))
    return b


def scene_proxies():
    """ゲームの場面の大まかな箱（塀・門・町家）。木の見え方と影の落ち方を確かめるためだけ"""
    L = scene_layout()
    ws = L['wall_section']
    plaster = (0.62, 0.60, 0.55)
    for w in L['walls']:
        (ax, az), (bx, bz) = w['from'], w['to']
        t = ws['thickness_base'] / 2
        x0, x1 = sorted((ax, bx))
        z0, z1 = sorted((az, bz))
        if abs(az - bz) < 1e-6:
            z0, z1 = az - t, az + t
        else:
            x0, x1 = ax - t, ax + t
        proxy_box('wall-' + w['name'], x0, x1, -z1, -z0, 0, ws['cap_top_y'], plaster)
    gt = L['gate']
    gx, gz = gt['center']
    for sx in (-1, 1):
        proxy_box(f'gate-post{sx}', gx + sx * gt['pillar_x'] - 0.25, gx + sx * gt['pillar_x'] + 0.25, -(gz + 0.31), -(gz - 0.31), 0, gt['pillar_top_y'], (0.2, 0.15, 0.11))
    r = gt['roof']
    proxy_box('gate-roof', gx - r['x_half'], gx + r['x_half'], -(gz + r['z_half']), -(gz - r['z_half']), r['eave_y'], r['ridge_y'], (0.18, 0.18, 0.2))
    for h in L['houses']:
        f = h['footprint']
        eave = {'machiya_a': 4.6, 'machiya_b': 6.0, 'machiya_d': 3.6}[h['name']]
        proxy_box(h['name'], f['x0'], f['x1'], -f['z1'], -f['z0'], 0, eave + 1.2, (0.45, 0.36, 0.28))


def game_camera():
    """肩越しのカメラ（主人公が最初の位置で北を向いたとき）：位置と見る点（ゲームの座標）"""
    L = scene_layout()
    hx, hz = L['hero_start']
    px, py, pz = hx + 0.45, 1.58, hz
    p = 0.1
    d = (0.0, -math.sin(p), -math.cos(p))
    cam = (px - d[0] * 3.3, py - d[1] * 3.3, pz - d[2] * 3.3)
    tgt = (px + d[0] * 10, py + d[1] * 10, pz + d[2] * 10)
    return cam, tgt


META_ABOUT = ('木の素材の情報（ゲームの座標・メートル、幹の根元が原点）。scene.json の木（桜・松 2 本）の当たり判定は layout.ts が '
              '別に作っているので、各木の項目は参考値。上の colliders・camera_blockers は scene.json に無い遠景の松（tree_pine_far の '
              'placements）の幹だけ（layout.ts がそのまま読む。二重にならない）。')


def update_meta(items: dict):
    """trees.meta.json の項目を書き換える（渡さない項目は残す）"""
    meta = json.loads(META.read_text()) if META.exists() else {}
    meta['_about'] = META_ABOUT
    meta.update(items)
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')


def write_meta(key, data):
    """trees.meta.json の key の項目を書き換える（他の木の項目は残す）"""
    update_meta({key: data})


def bbox(V):
    return V.min(0), V.max(0)


def scene_boxes():
    """場面の大まかな箱（ゲームの座標）：塀（笠の出を含む）・門の屋根と柱・町家（軒の出を含む）。木がめり込まないかの確認用"""
    L = scene_layout()
    ws = L['wall_section']
    out = []
    t = ws['thickness_base'] / 2 + ws['cap_overhang']
    for w in L['walls']:
        (ax, az), (bx, bz) = w['from'], w['to']
        if abs(az - bz) < 1e-6:
            out.append(('wall-' + w['name'], min(ax, bx), max(ax, bx), 0, ws['cap_top_y'] + 0.15, az - t, az + t))
        else:
            out.append(('wall-' + w['name'], ax - t, ax + t, 0, ws['cap_top_y'] + 0.15, min(az, bz), max(az, bz)))
    g = L['gate']
    gx, gz = g['center']
    r = g['roof']
    out.append(('gate-roof', gx - r['x_half'], gx + r['x_half'], r['eave_y'] - 0.6, r['ridge_y'] + 0.3, gz - r['z_half'], gz + r['z_half']))
    for h in L['houses']:
        f = h['footprint']
        eave = {'machiya_a': 4.6, 'machiya_b': 6.0, 'machiya_d': 3.6}[h['name']]
        out.append((h['name'], f['x0'] - 1.0, f['x1'] + 1.0, 0, eave + 2.4, f['z0'] - 1.0, f['z1'] + 1.0))
    return out


def clearance(V_blender, pos_game, rot=0.0, scale=1.0):
    """木の頂点（Blender の座標、原点が根元）を、ゲームの位置 pos_game=(x, z)・回転 rot（ゲームの rotation.y）・大きさで置いたとき、
    場面の箱に入る頂点の数を返す {箱の名前: 数}"""
    c, s = math.cos(rot), math.sin(rot)
    X = (V_blender[:, 0] * c - V_blender[:, 1] * s) * scale
    Y = (V_blender[:, 0] * s + V_blender[:, 1] * c) * scale
    gx = X + pos_game[0]
    gz = -Y + pos_game[1]
    gy = V_blender[:, 2] * scale
    hits = {}
    for name, x0, x1, y0, y1, z0, z1 in scene_boxes():
        n = int(np.sum((gx > x0) & (gx < x1) & (gy > y0) & (gy < y1) & (gz > z0) & (gz < z1)))
        if n:
            hits[name] = n
    return hits


def blocker(placements, margin=0.25):
    """木の局所の点（Blender の座標）が、置いた場所で場面の箱（＋余白）に入るかを返す関数を作る。
    placements = [((x, z), rot, scale), ...]（ゲームの座標）。どれか 1 つの置き方で入れば True"""
    boxes = scene_boxes()

    def f(p):
        p = np.asarray(p, np.float64)
        for (px, pz), rot, sc in placements:
            c, s = math.cos(rot), math.sin(rot)
            gx = (p[0] * c - p[1] * s) * sc + px
            gz = -(p[0] * s + p[1] * c) * sc + pz
            gy = p[2] * sc
            for _, x0, x1, y0, y1, z0, z1 in boxes:
                if x0 - margin < gx < x1 + margin and y0 - margin < gy < y1 + margin and z0 - margin < gz < z1 + margin:
                    return True
        return False
    return f


def emulate_threejs_ambient():
    """確認用の描画だけ（書き出しの後に使う）：three.js の環境光を真似る。
    three.js の半球光と空の映り込み（拡散）は物に遮られない（頂点色の AO だけが暗くする）が、Cycles は本当に遮るので暗く出すぎる。
    そこで、空からの光を止め（カメラから見える空はそのまま）、各材質に「基本色 ×（半球光＋空の平均）」の自己発光を足す。
    日差しは Cycles の光線の影のまま（ゲームの影の図に近い）。物どうしの照り返しも止める（three.js に無い）"""
    s = bpy.context.scene
    s.cycles.diffuse_bounces = 0
    s.cycles.glossy_bounces = 0
    s.cycles.max_bounces = 1
    # 空：カメラの光線だけ空の色、それ以外は 0
    nt = s.world.node_tree
    sw = next(n for n in nt.nodes if n.type == 'MIX' and n.inputs['Factor'].links and n.inputs['Factor'].links[0].from_node.type == 'LIGHT_PATH')
    ins = [x for x in sw.inputs if x.type == 'RGBA']
    for l in list(ins[0].links):
        nt.links.remove(l)
    ins[0].default_value = (0, 0, 0, 1)
    sky, gnd = _lin('#d6dde2'), _lin('#8c7153')
    hor, up = _lin('#c9d6db'), (0.30, 0.42, 0.58)
    k = 0.8 / math.pi
    top = tuple(sky[i] * k + up[i] * 0.45 for i in range(3))
    bot = tuple(gnd[i] * k + hor[i] * 0.45 for i in range(3))
    for m in bpy.data.materials:
        if not m.use_nodes or m.get('_amb'):
            continue
        t = m.node_tree
        bsdf = next((n for n in t.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        out = next((n for n in t.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if bsdf is None or out is None:
            continue
        m['_amb'] = True
        geo = t.nodes.new('ShaderNodeNewGeometry')
        sep = t.nodes.new('ShaderNodeSeparateXYZ')
        t.links.new(geo.outputs['Normal'], sep.inputs[0])
        f = t.nodes.new('ShaderNodeMapRange')
        f.inputs['From Min'].default_value = -1.0
        t.links.new(sep.outputs['Z'], f.inputs['Value'])
        amb = t.nodes.new('ShaderNodeMix')
        amb.data_type = 'RGBA'
        t.links.new(f.outputs['Result'], amb.inputs['Factor'])
        ai = [x for x in amb.inputs if x.type == 'RGBA']
        ai[0].default_value = (*bot, 1)
        ai[1].default_value = (*top, 1)
        mul = t.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mi = [x for x in mul.inputs if x.type == 'RGBA']
        bc = bsdf.inputs['Base Color']
        if bc.links:
            t.links.new(bc.links[0].from_socket, mi[0])
        else:
            mi[0].default_value = bc.default_value
        t.links.new([x for x in amb.outputs if x.type == 'RGBA'][0], mi[1])
        em = t.nodes.new('ShaderNodeEmission')
        t.links.new([x for x in mul.outputs if x.type == 'RGBA'][0], em.inputs['Color'])
        al = bsdf.inputs['Alpha']
        if al.links:
            t.links.new(al.links[0].from_socket, em.inputs['Strength'])
        else:
            em.inputs['Strength'].default_value = 1.0
        add = t.nodes.new('ShaderNodeAddShader')
        src = out.inputs['Surface'].links[0].from_socket
        t.links.new(bsdf.outputs['BSDF'], add.inputs[0])
        t.links.new(em.outputs['Emission'], add.inputs[1])
        if src.node == bsdf:
            t.links.new(add.outputs['Shader'], out.inputs['Surface'])
        else:
            # 裏面を透明にする混ぜ（preview_cull）の手前に入れる
            mix = src.node
            t.links.new(add.outputs['Shader'], mix.inputs[1])


def sky_gap(path, cam_game, target_game, close_m=0.6, res=(960, 540), fov_deg=50.0):
    """確認用：木だけを透明な背景で描き（アルファ）、樹冠の中で空が見える割合を gapstat.py（普通の python3）で数える。
    close_m は樹冠の範囲を決めるとき閉じる隙間の大きさ（メートル、見る点の距離で画素に直す）"""
    import mathutils
    s = bpy.context.scene
    hidden = [o for o in s.objects if o.type == 'MESH' and o.name.startswith('preview-')]
    for o in hidden:
        o.hide_render = True
    s.render.film_transparent = True
    s.cycles.samples = 8
    s.cycles.use_denoising = False
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    render_preview(path, cam_game, target_game, res=res, samples=8, fov_deg=fov_deg)
    im = bpy.data.images.load(str(path), check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    a = px.reshape(h, w, 4)[::-1, :, 3]
    alpha_png = pathlib.Path(path)
    out = bpy.data.images.new('_a', w, h, alpha=False)
    g = np.ones((h, w, 4), np.float32)
    g[..., :3] = a[::-1, :, None]
    out.pixels.foreach_set(g.ravel())
    out.filepath_raw = str(alpha_png)
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    dist = float(np.linalg.norm(np.array(cam_game) - np.array(target_game)))
    r_px = max(2, int(round(close_m * h / (2 * dist * math.tan(math.radians(fov_deg) / 2)))))
    r = subprocess.run(['python3', str(HERE / 'gapstat.py'), str(alpha_png), str(r_px)], capture_output=True, text=True)
    print(pathlib.Path(path).name, r.stdout.strip() or r.stderr[-300:])
    for o in hidden:
        o.hide_render = False
    s.render.film_transparent = False
    s.cycles.use_denoising = True
    return r.stdout
