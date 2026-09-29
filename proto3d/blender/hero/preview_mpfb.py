"""
比較案の頭（MPFB の基本形から）の速い確かめ（デバッグ用。書き出しには使わない。ゲームでの確認の代わりにはしない）。
頭と首の肌・眼球（・髪・眉があれば）を置き、正面・45°・横顔を 柔らかな光 と 日差し で並べた 1 枚を描く。
    /root/blender-venv/bin/python proto3d/blender/hero/preview_mpfb.py <out.png> [res=300] [hair=0]
"""
from __future__ import annotations

import math
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy  # noqa: E402
import mathutils
import numpy as np
from PIL import Image

import util as U

args = dict(a.split('=', 1) for a in sys.argv[2:] if '=' in a)
OUT = sys.argv[1]
RES = int(args.get('res', 300))


def mat(name, col, rough=0.55, vcol=False, alpha_tex=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    if vcol:
        a = nt.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['A'].default_value = (*col, 1)
        nt.links.new(a.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    return m


def set_vcol(ob, col):
    me = ob.data
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.column_stack([np.clip(col, 0, 1), np.ones(len(col))]).astype(np.float32).ravel())


def build_scene():
    import head_mpfb as HM
    V, Q = HM.skin_piece(noear=args.get('noear', '0') == '1')
    ob = U.make_mesh('Head', V, Q)
    ob.data.materials.append(mat('skin', (0.58, 0.315, 0.185), 0.55))
    import mpfb_parts as MP
    for s in (1, -1):
        Ve, Fe, col = MP.eyeball_fitted(V, Q, s)
        if args.get('eyes', '1') == '0':
            Ve = Ve - np.array([0, 0, 0.5])
        o = U.make_mesh('Eye%d' % s, Ve, Fe)
        set_vcol(o, np.asarray(col) * 2.2)
        o.data.materials.append(mat('eye', (1, 1, 1), 0.3, vcol=True))
        if args.get('brows', '1') == '1':
            Vb, Fb, _ = MP.brow_strip(s)
            o = U.make_mesh('Brow%d' % s, Vb, Fb)
            o.data.materials.append(mat('brow', (0.05, 0.035, 0.028), 0.8))
            Vl, Fl = MP.lash_strip(V, Q, s)
            o = U.make_mesh('Lash%d' % s, Vl, Fl)
            o.data.materials.append(mat('lash', (0.02, 0.016, 0.013), 0.6))
    if args.get('hair', '0') == '1':
        import hair_mpfb as HR
        HR.preview_objects(mat)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_scene()
    sc = bpy.context.scene
    sc.render.resolution_x = RES
    sc.render.resolution_y = int(RES * float(args.get('aspect', 1.2)))
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(args.get('samples', 12))
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']
    ld = bpy.data.lights.new('sun', 'SUN')
    lo = bpy.data.objects.new('sun', ld)
    sc.collection.objects.link(lo)
    lo.rotation_euler = (math.radians(55), 0, math.radians(-40))
    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = float(args.get('lens', 85))
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = np.array([float(args.get('tx', 0.0)), float(args.get('ty', 1.63)), float(args.get('tz', 0.0))])
    rows = []
    for light in ('soft', 'sun'):
        if light == 'soft':
            bg.inputs['Color'].default_value = (0.8, 0.8, 0.82, 1)
            bg.inputs['Strength'].default_value = 1.0
            ld.energy = 0.6
        else:
            bg.inputs['Color'].default_value = (0.35, 0.40, 0.48, 1)
            bg.inputs['Strength'].default_value = 0.35
            ld.energy = 4.0
        imgs = []
        for az in (0, 45, 90):
            a = math.radians(az)
            dist = float(args.get('dist', 0.75))
            p = tgt + np.array([math.sin(a) * dist, 0.0, math.cos(a) * dist])
            cam.location = U.g2b_arr([p])[0]
            d = U.g2b_arr([tgt])[0] - np.array(cam.location)
            cam.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
            path = OUT.replace('.png', f'_{light}{az}.png')
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            imgs.append(Image.open(path).convert('RGB'))
        rows.append(imgs)
    w, h = rows[0][0].size
    sheet = Image.new('RGB', (w * 3, h * 2))
    for j, imgs in enumerate(rows):
        for i, im in enumerate(imgs):
            sheet.paste(im, (i * w, j * h))
    sheet.save(OUT)
    print('saved', OUT)


if __name__ == '__main__':
    main()
