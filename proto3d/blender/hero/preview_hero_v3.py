"""
hero_v3 の確認用の描画（Cycles）。build_hero_v3.py の後に実行：
    /root/blender-venv/bin/python proto3d/blender/hero/preview_hero_v3.py [game back backc front side face motion]
光と色はゲームに合わせる：日差し #ffe2bd 強さ 3.4（Cycles の太陽の強さは three.js の DirectionalLight と同じ単位）、
半球の光（空 #d6dde2 / 地面 #8c7153、0.8）と空の映り込みの分を空の明るさに。描いた線形の値に、three.js と同じ
ACES Filmic（露出 1.1）をかけて sRGB の PNG にする（numpy）。主人公はゲームと同じく北（-z）を向く。
描いた画像：e2e-out/blender/hero_v3-*.png
"""
from __future__ import annotations

import math
import subprocess
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy
import mathutils
import numpy as np

from common import BUILD_DIR, PREVIEW_DIR, g2b, sun_direction_blender

WORK = BUILD_DIR / 'hero'
TMP = WORK / 'preview'
TMP.mkdir(parents=True, exist_ok=True)


def srgb_to_lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def aces_threejs(rgb, exposure=1.1):
    """three.js の ACESFilmicToneMapping（r150 以降）と同じ式"""
    x = rgb * (exposure / 0.6)
    mi = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
    mo = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
    v = x @ mi.T
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    v = (a / b) @ mo.T
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * v ** (1 / 2.4) - 0.055)


def setup():
    bpy.ops.wm.open_mainfile(filepath=str(WORK / 'hero_v3.blend'))
    sc = bpy.context.scene
    arm = bpy.data.objects['Hero_v3']
    arm.rotation_mode = 'XYZ'
    arm.rotation_euler = (0, 0, math.pi)       # 北を向く（ゲームで門へ歩く向き）
    # 頂点の色を材質に掛ける（書き出しでは three.js が掛けるので、確認の描画のときだけ）
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        if bsdf is None:
            continue
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        inp = bsdf.inputs['Base Color']
        if inp.is_linked:
            nt.links.new(inp.links[0].from_socket, mix.inputs['A'])
        else:
            mix.inputs['A'].default_value = inp.default_value
        nt.links.new(vc.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], inp)
    # 地面（道の土の色）
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    bs = gm.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*srgb_to_lin((150, 126, 98)), 1)
    bs.inputs['Roughness'].default_value = 0.95
    g.data.materials.append(gm)
    # 日差し
    light = bpy.data.lights.new('sun', 'SUN')
    light.energy = 3.4
    light.angle = math.radians(1.0)
    light.color = tuple(srgb_to_lin((255, 226, 189)))
    o = bpy.data.objects.new('sun', light)
    sc.collection.objects.link(o)
    o.rotation_euler = sun_direction_blender().to_track_quat('Z', 'Y').to_euler()
    # 空：上は空の色、下は地面の色（半球の光 0.8/π ＋ 空の映り込みの分）
    world = bpy.data.worlds.new('sky')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(geo.outputs['Incoming'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mr.inputs['From Min'].default_value = 1.0      # Incoming は面から外へ（上の空を見ると -Z）
    mr.inputs['From Max'].default_value = -1.0
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    sky = srgb_to_lin((214, 221, 226)) * 0.8 / math.pi + srgb_to_lin((170, 190, 215)) * 0.45 * 0.3
    grd = srgb_to_lin((140, 113, 83)) * 0.8 / math.pi
    ramp.color_ramp.elements[0].color = (*grd, 1)
    ramp.color_ramp.elements[1].color = (*sky, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '16'
    return arm


def cam(name, pos, tgt, res, fov, samples=24, crop=None):
    """ゲームの座標でカメラと見る点。crop=(x0, y0, x1, y1)（0..1）で切り出した拡大も書く"""
    sc = bpy.context.scene
    c = bpy.data.objects.get('pcam')
    if c is None:
        c = bpy.data.objects.new('pcam', bpy.data.cameras.new('pcam'))
        sc.collection.objects.link(c)
    c.location = g2b(*pos)
    look = mathutils.Vector(g2b(*tgt)) - c.location
    c.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    c.data.sensor_fit = 'VERTICAL'
    c.data.angle = math.radians(fov)
    c.data.clip_start = 0.05
    sc.camera = c
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    exr = TMP / f'{name}.exr'
    sc.render.filepath = str(exr)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(exr))
    px = np.array(img.pixels[:], dtype=np.float32).reshape(res[1], res[0], 4)[::-1, :, :3]
    bpy.data.images.remove(img)
    rgb = aces_threejs(px)
    np.save(TMP / f'{name}.npy', (rgb * 255 + 0.5).astype(np.uint8))
    out = PREVIEW_DIR / f'hero_v3-{name}.png'
    code = ("import sys, numpy as np\nfrom PIL import Image\na=np.load(sys.argv[1])\nim=Image.fromarray(a)\nim.save(sys.argv[2])\n"
            "if len(sys.argv)>3:\n  x0,y0,x1,y1=[float(v) for v in sys.argv[3].split(',')]\n  w,h=im.size\n"
            "  c=im.crop((int(x0*w),int(y0*h),int(x1*w),int(y1*h)))\n  c=c.resize((c.size[0]*2,c.size[1]*2),Image.LANCZOS)\n  c.save(sys.argv[4])\n")
    args = ['python3', '-c', code, str(TMP / f'{name}.npy'), str(out)]
    if crop:
        args += [','.join(str(v) for v in crop), str(PREVIEW_DIR / f'hero_v3-{name}-crop.png')]
    subprocess.run(args, check=True)
    return out


def pose(arm, action, frame):
    arm.animation_data.action = bpy.data.actions[action]
    bpy.context.scene.frame_set(frame)


# ゲームの追いかけるカメラ（follow.ts：頭の高さ 1.58、右へ 0.45、距離 3.3、見下ろし 0.1 rad、縦の画角 50°）
GAME_POS = (0.45, 1.58 + 3.3 * math.sin(0.1), 3.3 * math.cos(0.1))
GAME_TGT = (0.45, 1.58 - 10 * math.sin(0.1), -10 * math.cos(0.1))


def main(which):
    arm = setup()
    # 主人公は北（-z）を向いている。背中側は +z
    if 'game' in which:
        pose(arm, 'Idle', 0)
        cam('gamecam', GAME_POS, GAME_TGT, (1280, 720), 50, 32, crop=(0.22, 0.12, 0.62, 1.0))
    if 'back' in which:
        pose(arm, 'Idle', 0)
        cam('back', (0.55, 1.62, 1.45), (0.03, 1.12, 0.0), (768, 1024), 48, 32)
    if 'backc' in which:
        pose(arm, 'Idle', 0)
        cam('backhead', (0.25, 1.78, 0.62), (0.0, 1.60, 0.0), (640, 640), 34, 32)
    if 'front' in which:
        pose(arm, 'Idle', 0)
        cam('front34', (-0.75, 1.55, -1.7), (0.0, 1.05, 0.0), (768, 1024), 44, 32)
    if 'face' in which:
        pose(arm, 'Idle', 0)
        cam('face', (-0.22, 1.66, -0.52), (0.0, 1.61, 0.0), (640, 640), 30, 32)
    if 'side' in which:
        pose(arm, 'Idle', 0)
        cam('side', (2.3, 1.2, 0.1), (0.0, 0.92, 0.0), (640, 960), 44, 24)
    for w_ in which:
        if w_.startswith('custom:'):
            # custom:名前:px,py,pz:tx,ty,tz:画角[:動き:コマ]
            parts = w_.split(':')
            pose(arm, parts[5] if len(parts) > 5 else 'Idle', int(parts[6]) if len(parts) > 6 else 0)
            cam(parts[1], tuple(float(v) for v in parts[2].split(',')), tuple(float(v) for v in parts[3].split(',')), (640, 640), float(parts[4]), 20)
    if 'motion' in which:
        files = []
        for act, frames in (('Walk', (0, 5, 10, 16)), ('Run', (0, 4, 8, 12))):
            for f in frames:
                pose(arm, act, f)
                for view, pos, tgt in (('back', (0.3, 1.5, 3.0), (0, 0.95, 0)), ('side', (3.0, 1.1, 0.0), (0, 0.85, 0))):
                    nm = f'motion-{act}-{f:02d}-{view}'
                    cam(nm, pos, tgt, (300, 400), 38, 10)
                    files.append(str(PREVIEW_DIR / f'hero_v3-{nm}.png'))
        code = (
            "import sys, os\nfrom PIL import Image, ImageDraw\n"
            "fs=sys.argv[1:-1]\nims=[Image.open(f).convert('RGB') for f in fs]\n"
            "w,h=ims[0].size\ncols=8\nrows=(len(ims)+cols-1)//cols\nsheet=Image.new('RGB',(w*cols,h*rows),(0,0,0))\n"
            "for i,(f,im) in enumerate(zip(fs,ims)):\n  sheet.paste(im,((i%cols)*w,(i//cols)*h))\n  d=ImageDraw.Draw(sheet); d.text(((i%cols)*w+6,(i//cols)*h+6),f.split('motion-')[-1][:-4],fill=(255,255,255))\n"
            "sheet.save(sys.argv[-1])\nfor f in fs: os.remove(f)\n")
        subprocess.run(['python3', '-c', code] + files + [str(PREVIEW_DIR / 'hero_v3-motion.png')], check=True)


if __name__ == '__main__':
    args = sys.argv[1:] or ['game', 'back', 'backc', 'front', 'face', 'side', 'motion']
    main(args)
