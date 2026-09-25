"""AO の焼き込み（頂点色・occlusionTexture）と GLB への書き出しを確かめる小さな場面"""
import sys
import json
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/matlib')
import bpy
import bmesh
from common import *
import mats

reset()


def box(name, c, size, mat, rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = c
    if rot:
        o.rotation_euler = rot
    mats.assign(o, mat)
    bpy.context.view_layer.update()
    return o


# 地面（大きな平面：occlusionTexture）
ground = box('ground', (0, 0, -0.05), (12, 12, 0.1), 'earth_road')
mats.uv_box(ground)
# 壁（漆喰＋腰の板）、柱、梁、庇、瓦の列
wall = box('wall', (0, 1.0, 1.6), (4.0, 0.2, 3.2), 'plaster_white_streaks')
mats.uv_box(wall, top_z=3.2)
mats.densify(wall, 0.25)
koshi = box('koshi', (0, 0.87, 0.5), (4.0, 0.06, 1.0), 'wood_weathered')
mats.uv_along(koshi, axis='Z', seed=3)   # 縦の板張りのつもりで木目を縦に
mats.densify(koshi, 0.25)
posts = []
for i, x in enumerate((-1.9, 1.9)):
    p = box(f'post{i}', (x, 0.75, 1.6), (0.2, 0.2, 3.2), 'wood_dark')
    mats.uv_along(p, seed=i)
    mats.densify(p, 0.25)
    posts.append(p)
beam = box('beam', (0, 0.75, 3.1), (4.4, 0.22, 0.26), 'wood_dark')
mats.uv_along(beam, seed=5)
mats.densify(beam, 0.25)
eave = box('eave', (0, 0.1, 3.3), (4.8, 1.6, 0.08), 'wood_weathered', rot=(0.25, 0, 0))
mats.uv_along(eave, axis='X', seed=7)
mats.densify(eave, 0.25)
# 瓦（丸瓦の列：半円柱をたくさん）
me = bpy.data.meshes.new('tiles')
bm = bmesh.new()
import math
for k in range(16):
    x = -2.25 + k * 0.3
    geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=0.08, radius2=0.08, depth=1.7)
    vs = geom['verts']
    bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=mathutils.Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=vs, vec=(x, 0.1, 3.36))
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0.1, 3.3), matrix=mathutils.Matrix.Rotation(0.25, 3, 'X'))
bm.to_mesh(me); bm.free()
tiles = bpy.data.objects.new('tiles', me)
bpy.context.scene.collection.objects.link(tiles)
mats.assign(tiles, 'tile_ibushi', vcol=True)
mats.uv_along(tiles, round=True, seed=2)
mats.densify(tiles, 0.25)
mats.tint_islands(tiles, seed=4, amount=0.07)
# 樽
barrel = bpy.data.objects.new('barrel', bpy.data.meshes.new('barrel'))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.3, radius2=0.3, depth=0.7)
bm.to_mesh(barrel.data); bm.free()
bpy.context.scene.collection.objects.link(barrel)
barrel.location = (1.0, -0.6, 0.35)
mats.assign(barrel, 'wood_fresh')
bpy.context.view_layer.update()
mats.uv_along(barrel, axis='Z', round=True)
mats.densify(barrel, 0.15)

dense = [wall, koshi, *posts, beam, eave, tiles, barrel]
import time
t = time.time()
mats.bake_ao_to_color(dense, ground_plane=False, samples=32, distance=1.5)
print('ao color', f'{time.time() - t:.1f}s')
t = time.time()
mats.bake_ao_to_texture(ground, 512, samples=32, distance=2.0)
print('ao tex', f'{time.time() - t:.1f}s')

out = BUILD_DIR / 'mats_test.glb'
size = export_glb(out, [ground, *dense])
print('glb', size)
print(json.dumps(mats.glb_summary(out), ensure_ascii=False, indent=1))

import sheet_lights
sheet_lights.game_lights()
if "--norender" not in sys.argv: render_preview(PREVIEW_DIR / 'mats-ao-test.png', b2g(-3.2, -5.5, 1.9), b2g(0.2, 0.6, 1.3), res=(960, 540), samples=24)
