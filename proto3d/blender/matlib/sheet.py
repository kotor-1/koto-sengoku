"""材質の見本（Cycles）。材質ごとに 壁板・地面・横の梁・縦の柱・丸い部材 を置き、1 枚ずつ描いて並べる。
使い方: python sheet.py [材質名 ...]  → e2e-out/blender/mats-sheet.png（名前を指定したときは mats-sheet-part.png）"""
import sys
import time
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
import numpy as np
import bpy
import bmesh
from common import *
import mats

only = [a for a in sys.argv[1:] if not a.startswith('--')]
names = only or mats.NAMES
RES = (560, 385)
SAMPLES = 20

reset()


def game_lights(exposure=0.55):
    """ゲームの光に近づけた確認用の光（日差し 3.4・#ffe2bd、空の弱い光、Filmic）"""
    import math
    s = bpy.context.scene
    w = bpy.data.worlds.new('game-sky')
    s.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.56, 0.63, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.6
    L = bpy.data.lights.new('game-sun', 'SUN')
    L.energy = 3.4
    L.color = (1.0, 0.886, 0.741)
    L.angle = math.radians(1.2)
    o = bpy.data.objects.new('game-sun', L)
    s.collection.objects.link(o)
    o.rotation_euler = sun_direction_blender().to_track_quat('Z', 'Y').to_euler()
    s.view_settings.view_transform = 'Filmic'
    s.view_settings.look = 'None'
    s.view_settings.exposure = exposure


game_lights()
grey = bpy.data.materials.new('sheet-ground')
grey.use_nodes = True
grey.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.18, 0.17, 0.16, 1)
ink = bpy.data.materials.new('sheet-ink')
ink.use_nodes = True
ink.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1)


def box(name, c, size, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = c
    mats.assign(o, mat)
    return o


def cyl(name, c, r, hgt, mat, rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r, depth=hgt)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = c
    if rot:
        o.rotation_euler = rot
    mats.assign(o, mat)
    bpy.context.view_layer.update()
    return o


SP = 7.0
cells = []
for i, nm in enumerate(names):
    cx, cy = (i % 5) * SP, (i // 5) * SP
    t0 = time.time()
    panel = box(f'{nm}-panel', (cx, cy + 0.1, 0.8), (2.2, 0.12, 1.6), nm)
    patch = box(f'{nm}-patch', (cx, cy - 0.75, 0.005), (2.6, 1.5, 0.01), nm)
    beam = box(f'{nm}-beam', (cx - 0.1, cy - 0.55, 0.26), (1.9, 0.15, 0.15), nm)
    beam.rotation_euler = (0, 0, 0.12)
    post = box(f'{nm}-post', (cx + 0.9, cy - 0.25, 0.7), (0.15, 0.15, 1.4), nm)
    rod = cyl(f'{nm}-rod', (cx - 0.95, cy - 0.3, 0.55), 0.09, 1.1, nm)
    bpy.context.view_layer.update()
    for o in (panel, patch):
        mats.uv_box(o, top_z=1.6)
    for o in (beam, post):
        mats.uv_along(o, seed=i)
    mats.uv_along(rod, round=True, seed=i)
    cu = bpy.data.curves.new(f'{nm}-label', 'FONT')
    cu.body = nm
    cu.size = 0.17
    t = bpy.data.objects.new(f'{nm}-label', cu)
    bpy.context.scene.collection.objects.link(t)
    t.location = (cx - 1.25, cy - 1.45, 0.012)
    t.data.materials.append(ink)
    cells.append((nm, cx, cy))

g = box('ground', ((len(names) % 5) * SP / 2, 10, -0.02), (80, 80, 0.02), grey)

tiles = []
for nm, cx, cy in cells:
    t = time.time()
    out = BUILD_DIR / f'sheet_{nm}.png'
    render_preview(out, b2g(cx - 1.2, cy - 3.9, 1.9), b2g(cx + 0.05, cy - 0.2, 0.55), res=RES, samples=SAMPLES, fov_deg=40)
    print(nm, f'{time.time() - t:.1f}s', flush=True)
    img = bpy.data.images.load(str(out))
    a = np.empty(RES[0] * RES[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    tiles.append(a.reshape(RES[1], RES[0], 4)[..., :3])
cols = 4 if len(tiles) > 3 else len(tiles)
rows = (len(tiles) + cols - 1) // cols
W, H = RES
sheet = np.full((rows * (H + 6), cols * (W + 6), 3), 0.1, np.float32)
for i, tl in enumerate(tiles):
    r, q = divmod(i, cols)
    y0 = (rows - 1 - r) * (H + 6)
    sheet[y0:y0 + H, q * (W + 6):q * (W + 6) + W] = tl
name = 'mats-sheet.png' if not only else 'mats-sheet-part.png'
mats._save_png(PREVIEW_DIR / name, sheet)
print('wrote', PREVIEW_DIR / name)
