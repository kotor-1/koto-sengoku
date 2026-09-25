"""
主人公 第 3 版（hero_v3.glb）を作る。Blender 4.5（Python の bpy）で実行：
    /root/blender-venv/bin/python proto3d/blender/hero/build_hero_v3.py
- 骨組みと動き（Idle / Walk / Run）は hero_v2.glb を読み込んでそのまま使う（骨の名前・休みの姿勢・動きは変えない）
- 体・顔・手は SDF の組み合わせから面を作る（anatomy.py）。髪・小袖・袴・帯・刀・草履は自作の形（hair.py, cloth.py, hakama.py, gear.py）
- 布の画像は numpy で作る（textures.py）。外の素材は使わない。乱数の種は固定
- 重み：全身の代わり（プロキシ）に骨の熱の自動の重み → 近い点から写す。袖・袴・帯・刀は形に合わせて決める
- 接地の陰：Cycles の AO を頂点の色に焼く（three.js では頂点の色が色に掛かる）
出力：proto3d/public/models/hero_v3.glb、作業用 proto3d/blender/build/hero/hero_v3.blend
"""
from __future__ import annotations

import json
import math
import struct
import sys
import time

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy  # noqa: E402（bmesh より先に）
import bmesh
import mathutils
import numpy as np

from common import BUILD_DIR, MODELS_DIR, PREVIEW_DIR, reset
import anatomy as A
import cloth as CL
import gear as G
import hair as H
import hakama as HK
import skin as SK
import textures as TX
import util as U

T0 = time.time()
OUT = MODELS_DIR / 'hero_v3.glb'
WORK = BUILD_DIR / 'hero'
WORK.mkdir(parents=True, exist_ok=True)
FPS = 25     # 0.84 秒・0.64 秒・3.2 秒がちょうど整数のコマになる


def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)


# ================= 骨組み（第 2 版から） =================
def import_rig():
    reset()
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=str(MODELS_DIR / 'hero_v2.glb'))
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name = 'Hero_v3'
    arm.data.name = 'HeroRig'
    acts = {a.name: tuple(a.frame_range) for a in bpy.data.actions}
    log('rig', len(arm.data.bones), 'bones', acts)
    return arm


# ================= 形 =================
def uv_from_vertex(ob, uv_vert):
    lay = ob.data.uv_layers.new(name='UVMap')
    lay.data.foreach_set('uv', np.concatenate([uv_vert[list(p.vertices)] for p in ob.data.polygons]).astype(np.float32).ravel())


def uv_from_faces(ob, fn):
    Vg = U.verts_game(ob)
    uvs = []
    for p in ob.data.polygons:
        pts = Vg[list(p.vertices)]
        n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        n /= (np.linalg.norm(n) + 1e-12)
        uvs.append(fn(pts, pts.mean(0), n))
    lay = ob.data.uv_layers.new(name='UVMap')
    lay.data.foreach_set('uv', np.concatenate(uvs).astype(np.float32).ravel())


def weld(ob, dist=0.0004, z_band=None):
    """重なる頂点をつなぐ。z_band=(z0, z1)（Blender の高さ）ならその範囲の頂点だけ"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    vs = bm.verts if z_band is None else [v for v in bm.verts if z_band[0] <= v.co.z <= z_band[1]]
    bmesh.ops.remove_doubles(bm, verts=vs, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def eyeball(c, r):
    """眼球：正面が極の球。瞳・虹彩・白目の境は輪にそろえる（色は頂点の色）"""
    rings = [0, 7, 13, 19, 25, 29, 36, 50, 70, 95, 125, 155, 180]
    seg = 20
    V = [(0, 0, 1)]
    for a in rings[1:-1]:
        th = math.radians(a)
        for k in range(seg):
            ph = 2 * math.pi * k / seg
            V.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    V.append((0, 0, -1))
    V = np.array(V)
    ang = np.degrees(np.arccos(np.clip(V[:, 2], -1, 1)))
    V[:, 2] += 0.10 * np.clip(1 - ang / 29, 0, 1) ** 1.5       # 角膜のふくらみ
    col = np.where(ang[:, None] < 10, [0.012, 0.010, 0.009], np.where(ang[:, None] < 27.5, [0.10, 0.058, 0.035], [0.78, 0.75, 0.70]))
    nr = len(rings) - 2
    Fc = [(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)]
    for i in range(nr - 1):
        for k in range(seg):
            a = 1 + i * seg + k
            b = 1 + i * seg + (k + 1) % seg
            Fc.append((a, a + seg, b + seg, b))
    last = len(V) - 1
    for k in range(seg):
        a = 1 + (nr - 1) * seg + k
        b = 1 + (nr - 1) * seg + (k + 1) % seg
        Fc.append((a, last, b))
    # 目は少し内・下を見る（ぼんやり正面）
    return V * r + c, Fc, col


def brow_strip(s):
    """眉：眉の骨の上に沿った帯（透ける画像）"""
    head_sdf = lambda P: A.body(P, ['head'])
    xs = np.linspace(0.010, 0.053, 9)
    pts = np.array([(s * x, 1.6505 + 0.0045 * math.sin((x - 0.01) / 0.043 * math.pi) - 0.004 * ((x - 0.01) / 0.043) ** 2, 0.12) for x in xs])
    for _ in range(30):
        d = head_sdf(pts.astype(np.float32)).astype(float)
        pts[:, 2] -= np.clip(d - 0.0007, -0.01, 0.01)
    up = np.array([0, 1.0, 0])
    V, UV = [], []
    for i, p in enumerate(pts):
        w = 0.0115 - 0.004 * (i / (len(pts) - 1))
        n = np.array(A.body(p[None].astype(np.float32) + np.array([[1e-3, 0, 0]], np.float32), ['head']) - A.body(p[None].astype(np.float32) - np.array([[1e-3, 0, 0]], np.float32), ['head']))
        V.append(p - up * w * 0.45)
        V.append(p + up * w * 0.55)
        u = i / (len(pts) - 1)
        UV += [(u, 0.0), (u, 1.0)]
    V = np.array(V)
    Fc = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) if s > 0 else (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(pts) - 1)]
    # 眉の面から少し浮かせる
    return V, Fc, np.array(UV)


def lash_strip(s):
    """上まぶたの縁の濃い線（まつ毛の代わり）"""
    c = A.mirror(A.EYE_C, s)
    head_sdf = lambda P: A.body(P, ['head'])
    V = []
    xs = np.linspace(-0.0142, 0.0142, 11)
    for x in xs:
        # 上まぶたの弧（anatomy._eye_aperture と同じ）
        y = -0.0196 + math.sqrt(max(0.0, 0.0251 ** 2 - x * x))
        y += 0.0012 * (x / 0.0145)
        p = c + np.array([s * x, y + 0.0004, A.EYE_R + 0.004])
        V.append(p)
    V = np.array(V)
    for _ in range(20):
        d = head_sdf(V.astype(np.float32)).astype(float)
        V[:, 2] -= np.clip(d - 0.0004, -0.004, 0.004)
    out = []
    for p in V:
        out.append(p + np.array([0, -0.0007, 0.0006]))
        out.append(p + np.array([0, 0.0010, 0.0014]))
    out = np.array(out)
    Fc = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) if s > 0 else (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(V) - 1)]
    return out, Fc


def recalc_normals(ob):
    """閉じた小さな形の面の向きを外へそろえる"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def build_parts():
    P = {}
    P['head'] = U.make_mesh('Head', *SK.head_piece())
    for s, nm in ((1, 'L'), (-1, 'R')):
        P['arm' + nm] = U.make_mesh('Arm' + nm, *SK.arm_piece(s))
        P['foot' + nm] = U.make_mesh('Tabi' + nm, *SK.foot_piece(s))
    log('skin')
    for s, nm in ((1, 'L'), (-1, 'R')):
        V, Fc, col = eyeball(A.mirror(A.EYE_C, s), A.EYE_R)
        o = U.make_mesh('Eye' + nm, V, Fc)
        o['vcol'] = col
        P['eye' + nm] = o
        V, Fc, UV = brow_strip(s)
        o = U.make_mesh('Brow' + nm, V, Fc)
        uv_from_vertex(o, UV)
        P['brow' + nm] = o
        V, Fc = lash_strip(s)
        P['lash' + nm] = U.make_mesh('Lash' + nm, V, Fc)
    P['hair'] = U.make_mesh('Hair', *H.cap_mesh())
    V, Fc, UV = H.clumps()
    P['clumps'] = U.make_mesh('HairClumps', V, Fc)
    uv_from_vertex(P['clumps'], UV)
    P['bun'] = U.make_mesh('Topknot', *H.bun_mesh())
    P['motoyui'] = U.make_mesh('Motoyui', *H.motoyui())
    V, Fc, UV = H.bun_strands()
    P['bunstr'] = U.make_mesh('TopknotStrands', V, Fc)
    uv_from_vertex(P['bunstr'], UV)
    V, Fc, UV = H.nape_wisps()
    P['wisps'] = U.make_mesh('NapeWisps', V, Fc)
    uv_from_vertex(P['wisps'], UV)
    log('hair')
    V, Q, E, W, kind = CL.kosode_mesh()
    P['kosode'] = U.make_mesh('Kosode', V, Q)
    E, W = E[::2], W[::2]
    V, Fc, UV = CL.band(E, W, 0.052, 0.0035, rows=3, surf_sdf=CL.kosode_sdf, avoid_sdf=lambda X: A.body(X, ['neck']), avoid=0.006)
    P['eri'] = U.make_mesh('Eri', V, Fc)
    uv_from_vertex(P['eri'], UV)
    V, Fc, UV = CL.band(E - W * 0.011, W, 0.03, 0.0008, rows=2, surf_sdf=CL.kosode_sdf, avoid_sdf=lambda X: A.body(X, ['neck', 'torso']), avoid=0.003)
    P['juban'] = U.make_mesh('Juban', V, Fc)
    uv_from_vertex(P['juban'], UV)
    log('kosode')
    V, Fc = HK.hakama_mesh()
    P['hakama'] = U.make_mesh('Hakama', V, Fc)
    weld(P['hakama'], z_band=(HK.Y_CROTCH - 0.002, HK.Y_CROTCH + 0.002))   # 脚の前後の合わせ目はつながない（法線が内の壁と混ざらない）
    V, Fc, UV = HK.obi_mesh()
    P['obi'] = U.make_mesh('Obi', V, Fc)
    uv_from_vertex(P['obi'], UV)
    V, Fc, UV = HK.koshiita_mesh()
    P['koshiita'] = U.make_mesh('Koshiita', V, Fc)
    uv_from_vertex(P['koshiita'], UV)
    recalc_normals(P['koshiita'])
    P['himo1'] = U.make_mesh('Himo1', *HK.himo_mesh(1))
    P['himo2'] = U.make_mesh('Himo2', *HK.himo_mesh(-1))
    V, Fc, _ = G.front_knot(HK.band_front_z() + 0.004)
    P['knotF'] = U.make_mesh('KnotFront', V, Fc)
    (V, Fc), (V2, F2, _) = G.back_knot(HK.band_back_z())
    P['knotB'] = U.make_mesh('KnotBack', V, Fc)
    P['knotE'] = U.make_mesh('KnotEnds', V2, F2)
    log('hakama')
    ds = G.daisho()
    for k in ('saya', 'metal', 'iron', 'tsuka'):
        P['sw_' + k] = U.make_mesh('Sword_' + k, ds[k][0], ds[k][1])
    uv_from_vertex(P['sw_tsuka'], ds['tsuka'][2])
    for s, nm in ((1, 'L'), (-1, 'R')):
        z = G.zori(s)
        P['sole' + nm] = U.make_mesh('Zori' + nm, z['sole'][0], z['sole'][1])
        uv_from_vertex(P['sole' + nm], z['sole'][2])
        P['hanao' + nm] = U.make_mesh('Hanao' + nm, z['hanao'][0], z['hanao'][1])
    log('gear')
    return P


BUDGET = {'head': 5600, 'armL': 1850, 'armR': 1850, 'footL': 500, 'footR': 500, 'hair': 2100, 'bun': 1100, 'kosode': 5450, 'knotB': 360}


def decimate(P):
    for k, n in BUDGET.items():
        U.decimate_to(P[k], n, symmetric=k in ('head', 'hair', 'kosode'))
    log('decimated', {k: U.ntris(P[k]) for k in BUDGET})


# ================= 画像と材質 =================
def materials(P):
    tex = {}
    for nm in ('indigo', 'hair', 'linen', 'hakama', 'obi', 'straw', 'tsuka'):
        c, n = getattr(TX, nm)()
        tex[nm] = (U.image_from_array('tex_' + nm, c, WORK / f'tex_{nm}.png'), U.image_from_array('nrm_' + nm, n, WORK / f'nrm_{nm}.png', 'Non-Color'))
    brow = U.image_from_array('tex_brow', TX.brow_card(), WORK / 'tex_brow.png')
    wisp = U.image_from_array('tex_wisp', TX.wisp_card(), WORK / 'tex_wisp.png')

    def tmat(name, nm, rough, color=(1, 1, 1), double=False, nstr=1.0):
        return U.principled(name, color, rough, base_tex=tex[nm][0], normal_tex=tex[nm][1], uv_scale=1, double=double, normal_strength=nstr)

    M = {
        'skin': U.principled('Skin', (0.50, 0.335, 0.235), 0.5),
        'eye': U.principled('Eye', (1, 1, 1), 0.12),
        'brow': U.principled('Brow', (1, 1, 1), 0.7, base_tex=brow, uv_scale=1, alpha_clip=True, double=True),
        'lash': U.principled('Lash', (0.012, 0.010, 0.009), 0.6),
        'hair': tmat('Hair', 'hair', 0.5),
        'wisp': U.principled('Hair_wisps', (1, 1, 1), 0.55, base_tex=wisp, uv_scale=1, alpha_clip=True, double=True),
        'cord': U.principled('Motoyui_paper', (0.50, 0.46, 0.39), 0.6),
        'kosode': tmat('Kosode_indigo_hemp', 'indigo', 0.85),
        'juban': tmat('Juban_linen', 'linen', 0.85),
        'tabi': tmat('Tabi_cotton', 'linen', 0.9, nstr=0.6),
        'hakama': tmat('Hakama_check', 'hakama', 0.8),
        'obi': tmat('Kakuobi', 'obi', 0.6),
        'himo': U.principled('Himo', (0.030, 0.024, 0.020), 0.7),
        'saya': U.principled('Saya_lacquer', (0.016, 0.014, 0.013), 0.2),
        'metal': U.principled('Fittings_shakudo', (0.10, 0.085, 0.065), 0.42, 0.8),
        'iron': U.principled('Tsuba_iron', (0.05, 0.047, 0.044), 0.55, 0.6),
        'tsuka': tmat('Tsuka_wrap', 'tsuka', 0.65),
        'straw': tmat('Zori_straw', 'straw', 0.92),
        'hanao': U.principled('Hanao', (0.025, 0.026, 0.035), 0.75),
    }
    assign = {
        'head': 'skin', 'armL': 'skin', 'armR': 'skin', 'footL': 'tabi', 'footR': 'tabi',
        'eyeL': 'eye', 'eyeR': 'eye', 'browL': 'brow', 'browR': 'brow', 'lashL': 'lash', 'lashR': 'lash',
        'hair': 'hair', 'clumps': 'hair', 'bun': 'hair', 'bunstr': 'hair', 'wisps': 'wisp', 'motoyui': 'cord',
        'kosode': 'kosode', 'eri': 'kosode', 'juban': 'juban',
        'hakama': 'hakama', 'obi': 'obi', 'koshiita': 'hakama', 'himo1': 'himo', 'himo2': 'himo', 'knotF': 'himo', 'knotB': 'himo', 'knotE': 'himo',
        'sw_saya': 'saya', 'sw_metal': 'metal', 'sw_iron': 'iron', 'sw_tsuka': 'tsuka',
        'soleL': 'straw', 'soleR': 'straw', 'hanaoL': 'hanao', 'hanaoR': 'hanao',
    }
    for k, m in assign.items():
        U.assign_material(P[k], M[m])
    return M


def uvs(P):
    uv_from_faces(P['kosode'], CL.face_uv)
    uvh = H.flow_uv(U.verts_game(P['hair']))
    lay = P['hair'].data.uv_layers.new(name='UVMap')
    lay.data.foreach_set('uv', H.loop_uvs(uvh, [list(p.vertices) for p in P['hair'].data.polygons]).astype(np.float32).ravel())
    ub = H.bun_uv(U.verts_game(P['bun']))
    lay = P['bun'].data.uv_layers.new(name='UVMap')
    lay.data.foreach_set('uv', H.loop_uvs(ub, [list(p.vertices) for p in P['bun'].data.polygons], 2.0).astype(np.float32).ravel())
    uv_from_faces(P['hakama'], lambda pts, c, n: HK.hakama_uv(pts, [list(range(len(pts)))]))
    for k in ('footL', 'footR'):
        uv_from_faces(P[k], lambda pts, c, n: np.column_stack([pts[:, 0] + pts[:, 2] * np.sign(n[0] + 1e-9) * (abs(n[0]) > 0.6), pts[:, 1] + pts[:, 2] * (abs(n[0]) <= 0.6)]) / 0.08)


# ================= 頂点の色（肌の色味） =================
def skin_tint(P):
    """唇・頬・鼻・耳・指の節を少し赤く、まぶたの際を少し暗く。値は 0..1 の掛け算"""
    out = {}
    Vh = U.verts_game(P['head'])
    col = np.ones((len(Vh), 3))

    def near(c, r):
        return np.exp(-np.sum(((Vh - np.array(c)) / np.array(r)) ** 2, axis=1))
    lips = np.maximum(near((0, 1.5635, 0.088), (0.022, 0.0065, 0.012)), 0)
    col *= (1 - lips[:, None] * np.array([0.10, 0.34, 0.34]))
    for s in (1, -1):
        col *= (1 - near((s * 0.042, 1.595, 0.066), (0.02, 0.018, 0.02))[:, None] * np.array([0.0, 0.08, 0.08]))
        col *= (1 - near((s * 0.08, 1.61, -0.012), (0.012, 0.03, 0.02))[:, None] * np.array([0.0, 0.10, 0.10]))
        ec = A.mirror(A.EYE_C, s)
        col *= (1 - near(ec + np.array([0, 0.004, 0.01]), (0.018, 0.009, 0.01))[:, None] * np.array([0.10, 0.14, 0.10]))
    col *= (1 - near((0, 1.598, 0.108), (0.012, 0.01, 0.012))[:, None] * np.array([0.0, 0.07, 0.07]))
    # ひげの剃り跡（あご・口のまわり）をほんの少し
    jaw = near((0, 1.545, 0.06), (0.05, 0.03, 0.04)) * (1 - lips)
    col *= (1 - jaw[:, None] * np.array([0.05, 0.05, 0.03]))
    # 首の下（襟の中）は少し暗く
    col *= (0.86 + 0.14 * np.clip((Vh[:, 1] - 1.40) / 0.08, 0, 1))[:, None]
    out['head'] = col
    for k, s in (('armL', 1), ('armR', -1)):
        Va = U.verts_game(P[k])
        ca = np.ones((len(Va), 3))
        W_, dv, t, n = A.hand_frame(s)
        for pts, R, dirs in A.finger_chains(s):
            for j in range(1, 3):
                d = np.linalg.norm(Va - pts[j], axis=1)
                ca *= (1 - np.exp(-(d / 0.009) ** 2)[:, None] * np.array([0.0, 0.07, 0.07]))
            # 爪（指先の甲の側）を少し明るく・ピンクに
            tip = pts[3] - dirs[2] * 0.008 - n * 0.006
            d = np.linalg.norm(Va - tip, axis=1)
            ca = ca * (1 - np.exp(-(d / 0.006) ** 2)[:, None] * np.array([-0.08, -0.02, -0.02]))
        out[k] = np.clip(ca, 0, 1.2)
    return out


def bake_ao(P, samples=48, distance=0.12):
    """Cycles の AO を頂点の色へ（全部の部品を遮るものとして）"""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake')
    sc.world.light_settings.distance = distance
    res = {}
    for k, ob in P.items():
        if k.startswith('eye') or k.startswith('brow') or k.startswith('lash') or k == 'wisps':
            continue
        me = ob.data
        if 'AO' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['AO'])
        ca = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ca
        U.activate(ob)
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
        v = np.zeros(len(me.vertices) * 4, np.float32)
        ca.data.foreach_get('color', v)
        res[k] = v.reshape(-1, 4)[:, 0].copy()
        me.color_attributes.remove(ca)
    log('ao baked', len(res))
    return res


def write_colors(P, tint, ao):
    """最終の頂点の色 COLOR_0 = 色味 × AO（弱め）。three.js は線形の値として掛ける"""
    strength = {'hakama': 0.65, 'kosode': 0.8, 'head': 0.55, 'armL': 0.5, 'armR': 0.5, 'hair': 0.6, 'clumps': 0.5, 'obi': 0.55}
    for k, ob in P.items():
        me = ob.data
        n = len(me.vertices)
        col = np.ones((n, 3))
        if k in tint:
            col *= tint[k]
        if k in ao:
            s = strength.get(k, 0.7)
            a = np.clip(ao[k], 0, 1)
            a = 0.30 + 0.70 * a        # 真っ黒にはしない
            col *= (1 - s + s * a)[:, None]
        if 'vcol' in ob.keys():
            col = np.array(ob['vcol'], float).reshape(-1, 3)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        rgba = np.column_stack([np.clip(col, 0, 1), np.ones(n)]).astype(np.float32)
        ca.data.foreach_set('color', rgba.ravel())
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


# ================= 重み =================
BONE_SEG = {
    'Hips': ((0, .86, 0), (0, 1.105, 0)), 'Spine': ((0, 1.105, 0), (0, 1.315, 0)), 'Chest': ((0, 1.315, 0), (0, 1.469, 0)),
    'Neck': ((0, 1.469, 0), (0, 1.541, 0)), 'Head': ((0, 1.541, 0), (0, 1.75, 0)),
}
for _nm, _s in (('Left', 1), ('Right', -1)):
    BONE_SEG[_nm + 'Shoulder'] = ((_s * .05, 1.43, 0), (_s * .173, 1.37, 0))
    BONE_SEG[_nm + 'UpperArm'] = (tuple(A.J[_nm + 'UpperArm']), tuple(A.J[_nm + 'ForeArm']))
    BONE_SEG[_nm + 'ForeArm'] = (tuple(A.J[_nm + 'ForeArm']), tuple(A.J[_nm + 'Hand']))
    BONE_SEG[_nm + 'Hand'] = (tuple(A.J[_nm + 'Hand']), (_s * .338, .72, .05))
    BONE_SEG[_nm + 'UpperLeg'] = (tuple(A.J[_nm + 'UpperLeg']), tuple(A.J[_nm + 'LowerLeg']))
    BONE_SEG[_nm + 'LowerLeg'] = (tuple(A.J[_nm + 'LowerLeg']), tuple(A.J[_nm + 'Foot']))
    BONE_SEG[_nm + 'Foot'] = (tuple(A.J[_nm + 'Foot']), (_s * .099, .03, .17))
BONES = list(BONE_SEG)


def heat_proxy():
    """全身の代わりに、骨の熱の自動の重み。頂点の位置（ゲームの座標）と重み（頂点×骨）を返す"""
    V, Q = SK.proxy_body()
    ob = U.make_mesh('_proxy', V, Q)
    U.decimate_to(ob, 16000)
    arm_data = bpy.data.armatures.new('_heat')
    tmp = bpy.data.objects.new('_heat', arm_data)
    bpy.context.scene.collection.objects.link(tmp)
    U.activate(tmp)
    bpy.ops.object.mode_set(mode='EDIT')
    for nm, (h, t) in BONE_SEG.items():
        b = arm_data.edit_bones.new(nm)
        b.head = U.g2b_arr([h])[0]
        b.tail = U.g2b_arr([t])[0]
    bpy.ops.object.mode_set(mode='OBJECT')
    U.activate(ob)
    tmp.select_set(True)
    bpy.context.view_layer.objects.active = tmp
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    Vg = U.verts_game(ob)
    Wt = np.zeros((len(Vg), len(BONES)))
    for vg in ob.vertex_groups:
        if vg.name not in BONES:
            continue
        j = BONES.index(vg.name)
        for v in ob.data.vertices:
            for g in v.groups:
                if g.group == vg.index:
                    Wt[v.index, j] = g.weight
    s = Wt.sum(1)
    log('heat weights: verts without weight', int((s < 1e-6).sum()), 'of', len(Vg))
    Wt[s < 1e-6, BONES.index('Hips')] = 1.0
    Wt /= Wt.sum(1, keepdims=True)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.objects.remove(tmp, do_unlink=True)
    return Vg, Wt


def transfer(Vsrc, Wsrc, Vdst, k=4, exclude=()):
    kd = mathutils.kdtree.KDTree(len(Vsrc))
    for i, v in enumerate(Vsrc):
        kd.insert(v, i)
    kd.balance()
    W = np.zeros((len(Vdst), Wsrc.shape[1]))
    for i, v in enumerate(Vdst):
        found = kd.find_n(v, k)
        ws = np.array([1.0 / max(d, 1e-4) ** 2 for _, _, d in found])
        idx = [j for _, j, _ in found]
        W[i] = (Wsrc[idx] * ws[:, None]).sum(0) / ws.sum()
    for nm in exclude:
        W[:, BONES.index(nm)] = 0
    s = W.sum(1, keepdims=True)
    W = np.where(s > 1e-9, W / np.maximum(s, 1e-9), 0)
    return W


def one_hot(n, name):
    W = np.zeros((n, len(BONES)))
    W[:, BONES.index(name)] = 1
    return W


def sm01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def sleeve_weights(V, s):
    """袖：UpperArm。腕のまわりの肘から下（袖口の輪）は ForeArm。腕から離れた袋の奥と肩の近くは Chest を混ぜて遅れて揺れるように"""
    nm = 'Left' if s > 0 else 'Right'
    u, w, L, r0, r1 = CL.bag_coords(V.astype(np.float32), s)
    u = np.asarray(u, float)
    y = V[:, 1]
    el = A.mirror(A.J['LeftForeArm'], s)
    fore = sm01((0.14 - u) / 0.09) * sm01((el[1] + 0.02 - y) / 0.12) * 0.92
    W = np.zeros((len(V), len(BONES)))
    W[:, BONES.index(nm + 'ForeArm')] = fore
    W[:, BONES.index(nm + 'UpperArm')] = 1 - fore
    far = sm01((u - 0.06) / 0.22) * 0.55
    top = sm01((y - 1.30) / 0.12) * 0.55
    mixc = np.maximum(far, top)
    W *= (1 - mixc)[:, None]
    W[:, BONES.index('Chest')] += mixc
    return W


def hakama_weights(V):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    W = np.zeros((len(V), len(BONES)))
    iH, iLu, iLl, iRu, iRl = (BONES.index(n) for n in ('Hips', 'LeftUpperLeg', 'LeftLowerLeg', 'RightUpperLeg', 'RightLowerLeg'))
    upper = y >= HK.Y_CROTCH - 0.004
    # 上の筒：腰は Hips、股へ向かって左右の脚を混ぜる
    sig = sm01(x / 0.16 + 0.5)
    v = sm01((1.0 - y) / 0.36)
    W[upper, iH] = (1 - 0.8 * v)[upper]
    W[upper, iLu] = (0.8 * v * sig)[upper]
    W[upper, iRu] = (0.8 * v * (1 - sig))[upper]
    # 脚：どちらの脚の輪か（x の向き、真ん中は壁の向き）
    lo = ~upper
    side = np.where(x > 0.0, 1, -1)
    kn = sm01((0.60 - y) / 0.45)          # 下ほど膝から下を追う（ただし 3 割まで：走りで後ろの布が跳ねないように）
    hip = sm01((y - 0.50) / 0.12) * 0.25
    for s, iu, il in ((1, iLu, iLl), (-1, iRu, iRl)):
        m = lo & (side == s)
        W[m, il] = (0.3 * kn * (1 - hip))[m]
        W[m, iu] = ((1 - 0.3 * kn) * (1 - hip))[m]
        W[m, iH] = hip[m]
    return W


def smooth_weights(ob, W, iters=4, lam=0.5):
    """面のつながりで重みをならす"""
    n = len(W)
    nb = [[] for _ in range(n)]
    for e in ob.data.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(iters):
        Wn = W.copy()
        for i in range(n):
            if nb[i]:
                Wn[i] = W[i] * (1 - lam) + W[nb[i]].mean(0) * lam
        W = Wn
    return W


def limit4(W):
    W = W.copy()
    if W.shape[1] > 4:
        idx = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, idx, 0, axis=1)
    W[W < 0.01] = 0
    s = W.sum(1, keepdims=True)
    return W / np.maximum(s, 1e-9)


def apply_weights(ob, W, arm):
    ob.vertex_groups.clear()
    W = limit4(W)
    for j, nm in enumerate(BONES):
        col = W[:, j]
        nz = np.nonzero(col > 0)[0]
        if len(nz) == 0:
            continue
        vg = ob.vertex_groups.new(name=nm)
        for i in nz:
            vg.add([int(i)], float(col[i]), 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = arm
    # 布の厚みは骨の変形の後に（順番を入れ替える）
    names = [mm.name for mm in ob.modifiers]
    if 'solid' in names:
        U.activate(ob)
        bpy.ops.object.modifier_move_to_index(modifier='Armature', index=0)


def rig(P, arm):
    Vp, Wp = heat_proxy()
    log('heat proxy done')
    no_arm = ('LeftUpperArm', 'LeftForeArm', 'LeftHand', 'RightUpperArm', 'RightForeArm', 'RightHand')
    for k, ob in P.items():
        V = U.verts_game(ob)
        n = len(V)
        if k in ('head', 'armL', 'armR', 'footL', 'footR'):
            W = transfer(Vp, Wp, V)
            if k == 'head':
                W = smooth_weights(ob, W, 2)
        elif k in ('eyeL', 'eyeR', 'browL', 'browR', 'lashL', 'lashR', 'hair', 'clumps', 'bun', 'motoyui', 'bunstr', 'wisps'):
            W = one_hot(n, 'Head')
        elif k in ('soleL', 'hanaoL'):
            W = one_hot(n, 'LeftFoot')
        elif k in ('soleR', 'hanaoR'):
            W = one_hot(n, 'RightFoot')
        elif k in ('obi', 'koshiita', 'himo1', 'himo2', 'knotF', 'knotB', 'knotE') or k.startswith('sw_'):
            W = one_hot(n, 'Hips')
        elif k == 'hakama':
            W = smooth_weights(ob, hakama_weights(V), 3)
        elif k == 'kosode':
            Wt = transfer(Vp, Wp, V, k=6, exclude=no_arm + ('LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg'))
            Wt = np.where(Wt.sum(1, keepdims=True) > 0, Wt, one_hot(n, 'Hips'))
            dt = CL.torso_cloth(V.astype(np.float32)).astype(float)
            W = Wt
            for s in (1, -1):
                ds = CL.sleeve(V.astype(np.float32), s).astype(float)
                alpha = sm01((dt - ds) / 0.05 + 0.3) * (np.sign(V[:, 0]) == s)
                W = W * (1 - alpha[:, None]) + sleeve_weights(V, s) * alpha[:, None]
            W = smooth_weights(ob, W, 4)
        else:  # 襟・半襟
            W = transfer(Vp, Wp, V, k=6, exclude=no_arm)
            W = smooth_weights(ob, W, 2)
        apply_weights(ob, W, arm)
    log('weights applied')


# ================= 書き出しと確かめ =================
def export(arm, P):
    objs = [arm] + list(P.values())
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_image_format='JPEG', export_jpeg_quality=88,
        export_draco_mesh_compression_enable=False, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=False, export_optimize_animation_size=False,
        export_skins=True, export_all_influences=False, export_extras=True, export_cameras=False, export_lights=False,
        export_def_bones=False)
    log('exported', OUT, OUT.stat().st_size // 1024, 'KB')


def read_glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n]), b


def verify():
    j, raw = read_glb(OUT)
    j2, _ = read_glb(MODELS_DIR / 'hero_v2.glb')
    skins = j['skins']
    joints = [j['nodes'][i]['name'] for i in skins[0]['joints']]
    joints2 = [j2['nodes'][i]['name'] for i in j2['skins'][0]['joints']]

    def durations(jj):
        out = {}
        for a in jj['animations']:
            mx = 0
            for smp in a['samplers']:
                mx = max(mx, jj['accessors'][smp['input']]['max'][0])
            out[a['name']] = round(mx, 4)
        return out
    rest = {}
    for i in skins[0]['joints']:
        nd = j['nodes'][i]
        rest[nd['name']] = (nd.get('translation'), nd.get('rotation'))
    rest2 = {}
    for i in j2['skins'][0]['joints']:
        nd = j2['nodes'][i]
        rest2[nd['name']] = (nd.get('translation'), nd.get('rotation'))
    dmax = 0
    for k in rest2:
        t1 = np.array(rest[k][0] or [0, 0, 0])
        t2 = np.array(rest2[k][0] or [0, 0, 0])
        dmax = max(dmax, float(np.abs(t1 - t2).max()))
    rots = [k for k in rest if rest[k][1] is not None and np.abs(np.array(rest[k][1]) - [0, 0, 0, 1]).max() > 1e-5]
    tris = 0
    for m in j['meshes']:
        for p in m['primitives']:
            tris += j['accessors'][p['indices']]['count'] // 3
    imgs = [(im.get('name'), im.get('mimeType')) for im in j.get('images', [])]
    info = dict(joints=len(joints), same_joint_names=sorted(joints) == sorted(joints2), rest_translation_max_diff=dmax, rest_rotations_non_identity=rots,
                animations=durations(j), v2_animations=durations(j2), triangles=tris, bytes=OUT.stat().st_size,
                meshes=len(j['meshes']), materials=len(j['materials']), images=imgs)
    log('verify', json.dumps(info, ensure_ascii=False))
    return info


def feet_check(arm, P):
    """Idle の最初のコマで、草履の底の高さ（地面 0 に近いか）"""
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(0)
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for k in ('soleL', 'soleR'):
        ev = P[k].evaluated_get(dg)
        me = ev.to_mesh()
        zs = [(ev.matrix_world @ v.co).z for v in me.vertices]
        out[k] = round(min(zs), 4)
        ev.to_mesh_clear()
    log('feet (Idle frame 0, lowest z)', out)
    return out


def main():
    arm = import_rig()
    P = build_parts()
    decimate(P)
    uvs(P)
    M = materials(P)
    tint = skin_tint(P)
    ao = bake_ao(P)
    write_colors(P, tint, ao)
    for k, th in (('kosode', 0.0025), ('eri', 0.004), ('juban', 0.002), ('hakama', 0.004)):
        sm = P[k].modifiers.new('solid', 'SOLIDIFY')
        sm.thickness = th
        sm.offset = -1
        sm.use_even_offset = False
        sm.use_rim = True
    rig(P, arm)
    tris = sum(U.ntris(o) for o in P.values())
    log('triangles total', tris)
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(0)
    export(arm, P)
    info = verify()
    feet_check(arm, P)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'hero_v3.blend'))
    (WORK / 'hero_v3-info.json').write_text(json.dumps(info, indent=1, ensure_ascii=False))
    log('done')


if __name__ == '__main__':
    main()
