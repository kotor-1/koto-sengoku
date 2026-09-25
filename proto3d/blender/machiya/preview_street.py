"""
書き出した町家 3 棟の GLB を読み込み直し、ゲームの開始位置の肩越しの視点から確認用に描く（GLB の読み込み確認も兼ねる）。
    /root/blender-venv/bin/python proto3d/blender/machiya/preview_street.py [--samples N]
- 頂点色 COLOR_0（AO と色むら）を基本色に掛ける節点を足す（three.js と同じ見え方に近づける）
- 地面は確認用の道の土だけ（門・塀・木は他の制作の担当なので入れない）
"""
from __future__ import annotations

import sys

from kit import *  # noqa: F401,F403
from kit import MODELS_DIR, PREVIEW_DIR, render, preview_ground, scene_layout
import mats  # noqa: E402
import bpy  # noqa: E402
from common import reset  # noqa: E402

NAMES = ['machiya_a', 'machiya_b', 'machiya_d']


def import_houses():
    objs = []
    for n in NAMES:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(MODELS_DIR / f'{n}.glb'))
        objs += [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    done = set()
    for o in objs:
        me = o.data
        ca = me.color_attributes
        if not len(ca):
            continue
        name = ca[0].name
        for m in me.materials:
            if m is None or m.name in done:
                continue
            done.add(m.name)
            nt = m.node_tree
            bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
            sock = bsdf.inputs['Base Color']
            src = sock.links[0].from_socket if sock.links else None
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.layer_name = name
            mx = nt.nodes.new('ShaderNodeMix')
            mx.data_type = 'RGBA'
            mx.blend_type = 'MULTIPLY'
            mx.inputs['Factor'].default_value = 1.0
            a, b, out = mats._mix_sockets(mx)
            if src is not None:
                nt.links.new(src, a)
            else:
                a.default_value = sock.default_value
            nt.links.new(vc.outputs['Color'], b)
            nt.links.new(out, sock)
    return objs


if __name__ == '__main__':
    samples = int(sys.argv[sys.argv.index('--samples') + 1]) if '--samples' in sys.argv else 32
    reset()
    objs = import_houses()
    print('imported', len(objs), 'meshes', flush=True)
    preview_ground(120.0)
    mats.game_lights()
    hx, hz = scene_layout()['hero_start']
    render(PREVIEW_DIR / 'machiya_all-start.png', (hx, 1.9, hz + 3.3), (hx, 1.35, hz - 8.0), samples=samples)
    render(PREVIEW_DIR / 'machiya_all-south.png', (0.3, 1.9, -3.5), (0.0, 1.6, 8.0), samples=samples)
