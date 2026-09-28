"""
頭の形だけの速い確かめ（デバッグ用。書き出しには使わない）。SDF から頭と首の面を作り、眼球を入れて、
正面・45°・横顔を並べた 1 枚を描く（Workbench の単色）。hair=1 なら髪の層・髷も入れる（粗め）。
    /root/blender-venv/bin/python proto3d/blender/hero/preview_head.py <out.png> [h=0.0017] [hair=0] [engine=wb|cy]
"""
from __future__ import annotations

import math
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy  # noqa: E402
import numpy as np
from PIL import Image

import anatomy as A
import head_form as HF
import util as U
from sdf import mesh_sdf, orient_outward

args = dict(a.split('=', 1) for a in sys.argv[2:] if '=' in a)
OUT = sys.argv[1]
H = float(args.get('h', 0.0017))
HAIR = args.get('hair', '0') == '1'
ENGINE = args.get('engine', 'cy')
RES = int(args.get('res', 380))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, col, rough=0.55):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*col, 1)
    return m


def main():
    reset()
    fn = lambda P: A.body(P, ['neck', 'head'])
    box = [float(v) for v in args.get('box', '-.105,1.47,-.13,.105,1.77,.135').split(',')]
    V, Q = mesh_sdf(fn, box[:3], box[3:], H)
    Q = orient_outward(fn, V, Q)
    ob = U.make_mesh('Head', V, Q)
    skin = mat('skin', (0.50, 0.30, 0.20))
    ob.data.materials.append(skin)
    import build_hero_v3 as B
    eye = mat('eye', (0.55, 0.52, 0.48), 0.3)
    for s in (1, -1):
        Ve, Fe, col = B.eyeball(A.mirror(A.EYE_C, s), A.EYE_R)
        o = U.make_mesh('Eye%d' % s, Ve, Fe)
        o.data.materials.append(eye)
        # 瞳（簡易）：頂点の色の代わりに、瞳と虹彩の面だけ暗く
        me = o.data
        dark = mat('iris', (0.05, 0.03, 0.02), 0.3)
        me.materials.append(dark)
        cols = np.asarray(col)
        for p in me.polygons:
            if cols[list(p.vertices)].mean() < 0.2:
                p.material_index = 1
    if HAIR:
        import hair as HR
        hm = mat('hair', (0.02, 0.018, 0.016), 0.5)
        for nm, (Vh, Fh) in (('hair', HR.cap_mesh(0.0024)), ('bun', HR.bun_mesh(0.0024))):
            o = U.make_mesh(nm, Vh, Fh)
            o.data.materials.append(hm)
        (Vl, Fl, _), (V2, F2, _) = HR.lock_meshes()
        o = U.make_mesh('locks', Vl, Fl)
        o.data.materials.append(hm)
        Vt, Ft, _ = HR.tuft()
        o = U.make_mesh('tuft', Vt, Ft)
        o.data.materials.append(hm)
        Vm, Fm = HR.motoyui()
        o = U.make_mesh('motoyui', Vm, Fm)
        o.data.materials.append(mat('cord', (0.6, 0.57, 0.5), 0.6))
    for s in (1, -1):
        V, Fc, _ = B.brow_strip(s)
        o = U.make_mesh('brow%d' % s, V, Fc)
        o.data.materials.append(mat('brow', (0.03, 0.025, 0.02), 0.7))
    sc = bpy.context.scene
    sc.render.resolution_x = RES
    sc.render.resolution_y = int(RES * 1.15)
    if ENGINE == 'wb':
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'MATERIAL'
        sh.show_specular_highlight = True
        sh.show_cavity = False
        sc.display.render_aa = '8'
    else:
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = 16
        sc.cycles.use_denoising = True
        sc.world = bpy.data.worlds.new('w')
        sc.world.use_nodes = True
        sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.38, 0.42, 1)
        sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
        ld = bpy.data.lights.new('sun', 'SUN')
        ld.energy = 3.5
        lo = bpy.data.objects.new('sun', ld)
        sc.collection.objects.link(lo)
        lo.rotation_euler = (math.radians(50), 0, math.radians(35))
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 85
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = np.array([float(args.get('tx', 0.0)), float(args.get('ty', 1.618)), float(args.get('tz', 0.02))])
    imgs = []
    for az in [int(a) for a in args.get('az', '0,45,90').split(',')]:
        a = math.radians(az)
        dist = float(args.get("dist", 0.68))
        p = tgt + np.array([math.sin(a) * dist, float(args.get('up', -0.03)), math.cos(a) * dist])
        cam.location = U.g2b_arr([p])[0]
        d = U.g2b_arr([tgt])[0] - np.array(cam.location)
        import mathutils
        cam.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
        path = OUT.replace('.png', f'_{az}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        imgs.append(Image.open(path).convert('RGB'))
    w, h = imgs[0].size
    sheet = Image.new('RGB', (w * 3, h))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * w, 0))
    sheet.save(OUT)
    print('saved', OUT)


if __name__ == '__main__':
    main()
