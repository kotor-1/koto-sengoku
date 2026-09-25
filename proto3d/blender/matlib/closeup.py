"""ゲームの視点に近い距離（目の高さ 1.9m・2〜4m 先）で材質を見る"""
import sys
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
import numpy as np
import bpy
import bmesh
from common import *
import mats

names = [a for a in sys.argv[1:]] or ['earth_road', 'wood_weathered', 'plaster_white_streaks']
reset()
mats.game_lights()


def box(name, c, size, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = c
    mats.assign(o, mat)
    bpy.context.view_layer.update()
    return o


tiles = []
for i, nm in enumerate(names):
    ox = i * 30.0
    g = box(f'{nm}-g', (ox, 0, -0.05), (12, 12, 0.1), 'earth_road' if nm != 'earth_road' else nm)
    mats.uv_box(g)
    w = box(f'{nm}-w', (ox, 2.5, 1.5), (5, 0.2, 3.0), nm if nm != 'earth_road' else 'plaster_white')
    if mats.CATALOG[nm]['uv'] == 'along':
        mats.uv_along(w, axis='X')
    else:
        mats.uv_box(w, top_z=3.0)
    p = box(f'{nm}-p', (ox + 1.2, 2.2, 1.5), (0.24, 0.24, 3.0), 'wood_dark' if nm != 'wood_dark' else 'wood_weathered')
    mats.uv_along(p)
    out = BUILD_DIR / f'close_{nm}.png'
    render_preview(out, b2g(ox - 0.6, -2.4, 1.9), b2g(ox + 0.4, 1.6, 0.9), res=(640, 360), samples=24)
    img = bpy.data.images.load(str(out))
    a = np.empty(640 * 360 * 4, np.float32)
    img.pixels.foreach_get(a)
    tiles.append(a.reshape(360, 640, 4)[..., :3])
sheet = np.concatenate(tiles[::-1], 0)
mats._save_png(PREVIEW_DIR / 'mats-closeup.png', sheet)
