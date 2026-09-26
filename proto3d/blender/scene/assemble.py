"""
城門前の一場面を組み立てる（書き出した GLB をすべて配置どおりに読み込む）。確認用の描画にも、地面の AO の焼き込みにも使う。

    /root/blender-venv/bin/python proto3d/blender/scene/assemble.py [--samples 32] [--views main,left] [--res 1280x720] [--ground GLB]

- 町家・門・塀・天守・地面は GLB の中でゲームの絶対座標になっているので、原点にそのまま置く（main.ts の SCENE_MODELS と同じ）。
- 木は scene.json の trees の位置（幹の根元が原点）。pine_back は向き 2.2・大きさ 0.9。外側の木立 BACK_TREES も main.ts と同じ。
  遠景の松 tree_pine_far は trees/trees.meta.json の placements に置く（main.ts にはまだ無い。far_pines=False で外せる）。
- 主人公 hero_v3 は hero_start に、hero_start_heading の向き（ゲームの rotation.y ＝ Blender の Z 回り。無ければ π ＝北）。
- 開始の画面のカメラは hero_start_yaw・hero_start_pitch（follow.ts の createOrbit(yaw, pitch) の値。無ければ 0 ＝北・0.1）。
描画はゲームの光の出し方に寄せる（setup_game_look / render_game）：
- 日差し #ffe2bd 3.4（線形の色）、向きは SUN_OFFSET。影は Cycles の光線（ゲームは PCF の影の図）。
- 環境光は three.js と同じく「遮られない」光として、材質ごとに 基本色 ×（半球光＋空の映り込みの拡散）× occlusionTexture を自己発光で足す。
  物どうしの照り返しは無し（three.js に無い）。頂点色 COLOR_0 は読み込みで基本色に掛かる。
- 空は three.js の makeSky と同じ式を numpy で描き（雲は省く）、霧（45〜480 m の線形）を掛け、ACES（露出 1.1）と sRGB で PNG に。
"""
from __future__ import annotations

import argparse
import math
import pathlib
import sys

import bpy
import mathutils
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'lib'))
from common import BUILD_DIR, MODELS_DIR, PREVIEW_DIR, g2b, reset, scene_layout  # noqa: E402

TMP = BUILD_DIR / 'scene'
TMP.mkdir(parents=True, exist_ok=True)

# main.ts と同じ
SCENE_MODELS = ['ground_v2', 'gate_v2', 'walls_v2', 'keep', 'machiya_a', 'machiya_b', 'machiya_d']
BACK_TREES = [(-27, -16, 0.3, 1.1), (26, -22, 1.7, 1.2), (-26, 12, 2.6, 1.0), (27, 9, 1.1, 0.95)]
SKY = dict(zenith='#4f7fb8', horizon='#c9d6db', glow='#ffdcae')
FOG = (45.0, 480.0)
FOLLOW = dict(height=1.55, shoulder=0.4, distance=2.3, pitch0=0.06)


def lin(hexs: str) -> tuple[float, float, float]:
    """#rrggbb（sRGB）→ 線形"""
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ---------------------------------------------------------------------------
# 読み込みと配置
# ---------------------------------------------------------------------------

def load_glb(name: str, path=None):
    """GLB を読み込み、親の空（名前 name）の下にまとめる。返り値 (親, 読み込んだ物体)"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path or MODELS_DIR / f'{name}.glb'))
    objs = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    return root, objs


def place_copy(name: str, objs, loc_game, rot=0.0, scale=1.0):
    """読み込んだ物体を複製して（メッシュは共有）別の位置に置く"""
    r = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(r)
    for o in objs:
        if o.parent is not None and o.parent in objs:
            continue
        c = o.copy()
        bpy.context.scene.collection.objects.link(c)
        c.parent = r
    r.location = g2b(*loc_game)
    r.rotation_euler = (0, 0, rot)
    r.scale = (scale,) * 3
    return r


def far_pine_places() -> list:
    """遠景の松の置き場所 [(x, z, 向き, 大きさ)]（trees.meta.json）"""
    import json
    p = pathlib.Path(__file__).resolve().parents[1] / 'trees' / 'trees.meta.json'
    if not p.exists():
        return []
    d = json.loads(p.read_text()).get('tree_pine_far', {})
    return [(q['x'], q['z'], q['rotation_y'], q['scale']) for q in d.get('placements', [])]


def assemble(*, ground=True, hero=True, trees=True, buildings=True, back_trees=True, far_pines=True, ground_path=None) -> dict:
    """場面を組み立てる（reset はしない）。返り値 {名前: (親, 物体の一覧)}"""
    L = scene_layout()
    out = {}
    for nm in SCENE_MODELS:
        if nm == 'ground_v2':
            if not ground:
                continue
            p = ground_path or MODELS_DIR / 'ground_v2.glb'
            if not pathlib.Path(p).exists():
                print('assemble: ground_v2.glb が無いので地面なし')
                continue
            out[nm] = load_glb(nm, p)
        elif buildings:
            out[nm] = load_glb(nm)
    if trees:
        tpos = {t['name']: t['pos'] for t in L['trees']}
        pine = load_glb('tree_pine')
        pine[0].location = g2b(tpos['pine_big'][0], 0, tpos['pine_big'][1])
        out['pine_big'] = pine
        r = place_copy('pine_back', pine[1], (tpos['pine_back'][0], 0, tpos['pine_back'][1]), 2.2, 0.9)
        out['pine_back'] = (r, list(r.children))
        if back_trees:
            for i, (x, z, rot, sc) in enumerate(BACK_TREES):
                r = place_copy(f'pine_far{i}', pine[1], (x, 0, z), rot, sc)
                out[r.name] = (r, list(r.children))
        sak = load_glb('tree_sakura')
        sak[0].location = g2b(tpos['sakura'][0], 0, tpos['sakura'][1])
        out['sakura'] = sak
        if far_pines and (MODELS_DIR / 'tree_pine_far.glb').exists():
            far = load_glb('tree_pine_far')
            for i, (x, z, rot, sc) in enumerate(far_pine_places()):
                r = place_copy(f'pine_farp{i}', far[1], (x, 0, z), rot, sc)
                out[r.name] = (r, list(r.children))
            far[0].location = (0, 0, -300)         # 読み込んだ元は使わない（地面の下の遠くへ）
            out['tree_pine_far'] = far
    if hero:
        h = load_glb('hero_v3')
        hx, hz = L['hero_start']
        h[0].location = g2b(hx, 0, hz)
        h[0].rotation_euler = (0, 0, L.get('hero_start_heading', math.pi))
        # 骨の形の見本（色の無いメッシュ）は描かない
        for o in h[1]:
            if o.type == 'MESH' and len(o.data.color_attributes) == 0 and o.parent is h[0]:
                o.hide_render = True
                o.hide_viewport = True
        bpy.context.scene.frame_set(1)
        out['hero_v3'] = h
    bpy.context.view_layer.update()
    return out


# ---------------------------------------------------------------------------
# ゲームに寄せた光と描画
# ---------------------------------------------------------------------------

def _ambient_ramp(nt):
    """面の向き（上下）→ 環境光の強さ（three.js の半球光 0.8 と、空の映り込みの拡散 0.45 の和。線形の値）"""
    sky, gnd = lin('#d6dde2'), lin('#8c7153')
    hor, zen = lin(SKY['horizon']), lin(SKY['zenith'])
    k = 0.8 / math.pi

    def at(t, env):
        hemi = [gnd[i] + (sky[i] - gnd[i]) * t for i in range(3)]
        return tuple(hemi[i] * k + env[i] * 0.45 for i in range(3))
    # 空の映り込み（照度に畳み込んだもの）：上向きは空の平均、横向きは空と地平の半々、下向きは地平の色
    up = [hor[i] + 0.8 * (zen[i] - hor[i]) for i in range(3)]
    side = [0.5 * hor[i] + 0.5 * (hor[i] + 0.35 * (zen[i] - hor[i])) for i in range(3)]
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*at(0.0, hor), 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (*at(1.0, up), 1)
    e = cr.elements.new(0.5)
    e.color = (*at(0.5, side), 1)
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    return ramp.outputs['Color']


def _mul(nt, a, b):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = 'MULTIPLY'
    m.inputs['Factor'].default_value = 1.0
    ins = [x for x in m.inputs if x.type == 'RGBA']
    for s, v in ((ins[0], a), (ins[1], b)):
        if isinstance(v, bpy.types.NodeSocket):
            nt.links.new(v, s)
        else:
            s.default_value = v
    return [x for x in m.outputs if x.type == 'RGBA'][0]


def emulate_ambient():
    """各材質に「基本色 × 環境光 × occlusionTexture」を自己発光（Principled の Emission）として足す。読み込みの後に 1 回"""
    for m in bpy.data.materials:
        if not m.use_nodes or m.get('_amb'):
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None:
            continue
        m['_amb'] = True
        bc = bsdf.inputs['Base Color']
        base = bc.links[0].from_socket if bc.links else tuple(bc.default_value)
        amb = _mul(nt, base, _ambient_ramp(nt))
        # glTF の occlusionTexture（'glTF Material Output' / 'glTF Settings' の Occlusion）
        occ = None
        for n in nt.nodes:
            if n.type == 'GROUP' and n.node_tree and n.node_tree.name.startswith(('glTF Material Output', 'glTF Settings')):
                s = n.inputs.get('Occlusion')
                if s is not None and s.links:
                    occ = s.links[0].from_socket
        if occ is not None:
            amb = _mul(nt, amb, occ)
        nt.links.new(amb, bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
        # three.js の片面の材質は裏を描かない（Cycles は裏も描くので、裏を透明に）
        if m.use_backface_culling:
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
            src = out.inputs['Surface'].links[0].from_socket
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            tr = nt.nodes.new('ShaderNodeBsdfTransparent')
            mix = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
            nt.links.new(src, mix.inputs[1])
            nt.links.new(tr.outputs['BSDF'], mix.inputs[2])
            nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])


def add_hills():
    """main.ts の makeHills に近い遠くの山並み（確認用。色は平ら）"""
    rng_ridge = lambda a, seed, octs=4: _ridge(a, seed, octs)  # noqa: E731
    for r0, depth, h0, h1, col, seed in ((175, 25, 6, 26, '#56684a', 1), (290, 40, 20, 75, '#6a7a86', 5)):
        N = 160
        verts, faces = [], []
        for i in range(N + 1):
            a = i / N * math.tau
            n = rng_ridge(a, seed)
            h = h0 + (h1 - h0) * n * n
            r = r0 + depth * rng_ridge(a, seed + 2, 2)
            x, z = math.sin(a), math.cos(a)
            for rr, yy in ((r - depth, -3), (r, h), (r + depth * 2, -3)):
                verts.append(g2b(x * rr, yy, z * rr))
        for i in range(N):
            a, b = i * 3, i * 3 + 3
            faces += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2)]
        me = bpy.data.meshes.new(f'hills{seed}')
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new(f'hills{seed}', me)
        bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(f'hills{seed}')
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(col), 1)
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
        me.materials.append(m)


def _ridge(a, seed, octaves=4):
    s, amp, f, norm = 0.0, 0.5, 3.0, 0.0
    for i in range(octaves):
        x = a * f + seed * 13.1 + i * 7.3
        s += amp * (0.5 + 0.5 * math.sin(x) * math.cos(x * 0.61 + seed))
        norm += amp
        amp *= 0.5
        f *= 2.1
    return s / norm


def setup_game_look(hills=True):
    """日差し・環境光・描画の設定（読み込みの後に呼ぶ）"""
    from common import sun_direction_blender
    s = bpy.context.scene
    if hills:
        add_hills()
    w = bpy.data.worlds.new('game-black')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    s.world = w
    w.mist_settings.start = FOG[0]
    w.mist_settings.depth = FOG[1] - FOG[0]
    w.mist_settings.falloff = 'LINEAR'
    for o in [o for o in s.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(o, do_unlink=True)
    L = bpy.data.lights.new('game-sun', 'SUN')
    L.energy = 3.4
    L.color = lin('#ffe2bd')
    L.angle = math.radians(1.0)
    o = bpy.data.objects.new('game-sun', L)
    s.collection.objects.link(o)
    o.rotation_euler = sun_direction_blender().to_track_quat('Z', 'Y').to_euler()
    emulate_ambient()
    c = s.cycles
    s.render.engine = 'CYCLES'
    c.device = 'CPU'
    c.max_bounces = 4
    c.diffuse_bounces = 0
    c.glossy_bounces = 0
    c.transmission_bounces = 0
    c.volume_bounces = 0
    c.transparent_max_bounces = 64
    c.use_denoising = True
    s.render.film_transparent = True
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.view_settings.exposure = 0.0
    s.view_layers[0].use_pass_mist = True


def game_camera(yaw=0.0, pitch=FOLLOW['pitch0'], hero=None):
    """肩越しのカメラ（follow.ts の placeFollow と同じ。壁との当たりは見ない）。返り値 (カメラ, 見る点) ゲームの座標"""
    L = scene_layout()
    hx, hz = hero or L['hero_start']
    right = (math.cos(yaw), 0.0, -math.sin(yaw))
    px, py, pz = hx + right[0] * FOLLOW['shoulder'], FOLLOW['height'], hz + right[2] * FOLLOW['shoulder']
    cp = math.cos(pitch)
    d = (-math.sin(yaw) * cp, -math.sin(pitch), -math.cos(yaw) * cp)
    D = FOLLOW['distance']
    cam = (px - d[0] * D, py - d[1] * D, pz - d[2] * D)
    tgt = (px + d[0] * 10, py + d[1] * 10, pz + d[2] * 10)
    return cam, tgt


def _aces(rgb, exposure=1.1):
    """three.js の ACESFilmicToneMapping（線形 → 表示用の線形）"""
    Mi = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
    Mo = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
    c = rgb * (exposure / 0.6)
    c = c @ Mi.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ Mo.T
    return np.clip(c, 0, 1)


def _srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)


def _sky(dirs_game, sun_game):
    """makeSky の式（雲なし）。dirs_game: (..., 3) 正規化済み"""
    hor, zen, glow = (np.array(lin(SKY[k])) for k in ('horizon', 'zenith', 'glow'))
    h = np.maximum(dirs_game[..., 1], 0)[..., None]
    col = hor + (zen - hor) * np.sqrt(h)
    s = np.maximum(dirs_game @ sun_game, 0)[..., None]
    col = col + glow * (s ** 6 * 0.18 + s ** 64 * 0.35)
    col = np.where(dirs_game[..., 1:2] < 0, hor, col)
    return col


def _load_exr(path):
    im = bpy.data.images.load(str(path), check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(h, w, 4)


def render_game(path, cam_game, target_game, *, res=(1280, 720), samples=32, fov_deg=50.0):
    """ゲームと同じ色の出し方で 1 枚描く（線形で EXR → 空・霧・ACES・sRGB を numpy で）"""
    s = bpy.context.scene
    stem = pathlib.Path(path).stem
    cam = bpy.data.objects.get('preview-cam')
    if cam is None:
        cam = bpy.data.objects.new('preview-cam', bpy.data.cameras.new('preview-cam'))
        s.collection.objects.link(cam)
    cam.location = g2b(*cam_game)
    look = mathutils.Vector(g2b(*target_game)) - cam.location
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(fov_deg)
    cam.data.clip_start = 0.1
    cam.data.clip_end = 2000
    s.camera = cam
    s.cycles.samples = samples
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    # 霧の量（Mist）を別の EXR に書き出す（合成の File Output）
    s.use_nodes = True
    nt = s.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new('CompositorNodeRLayers')
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'], comp.inputs['Image'])
    fo = nt.nodes.new('CompositorNodeOutputFile')
    fo.base_path = str(TMP)
    fo.format.file_format = 'OPEN_EXR'
    fo.format.color_depth = '32'
    fo.file_slots[0].path = f'_mist_{stem}_'
    nt.links.new(rl.outputs['Mist'], fo.inputs[0])
    s.render.image_settings.file_format = 'OPEN_EXR'
    s.render.image_settings.color_depth = '32'
    s.render.image_settings.color_mode = 'RGBA'
    tmp = TMP / f'_render_{stem}.exr'
    s.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    img = _load_exr(tmp).astype(np.float64)
    W, H = res
    mist_path = next(iter(sorted(TMP.glob(f'_mist_{stem}_*.exr'))), None)
    mist = _load_exr(mist_path)[..., 0].astype(np.float64) if mist_path else np.zeros((H, W))
    if mist_path:
        mist_path.unlink()
    # 画素ごとの視線の向き（Blender の画像は下の行から）
    t = math.tan(math.radians(fov_deg) / 2)
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t * W / H
    ys = ((np.arange(H) + 0.5) / H * 2 - 1) * t
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X, Y, -np.ones_like(X)], -1)
    R = np.array(cam.matrix_world.to_3x3())
    d = d @ R.T
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    dg = np.stack([d[..., 0], d[..., 2], -d[..., 1]], -1)
    L = scene_layout()
    sun = np.array(L['sun_offset_game'], np.float64)
    sun /= np.linalg.norm(sun)
    sky = _sky(dg, sun)
    a = np.clip(img[..., 3:4], 0, 1)
    rgb = img[..., :3] + sky * (1 - a)
    out = _srgb(_aces(rgb))
    fog = np.clip(mist, 0, 1)[..., None] * a
    out = out * (1 - fog) + _srgb(np.array(lin(SKY['horizon'])))[None, None] * fog
    o = bpy.data.images.new('_tm', W, H, alpha=False)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :3] = np.clip(out, 0, 1)
    o.pixels.foreach_set(rgba.ravel())
    o.filepath_raw = str(path)
    o.file_format = 'PNG'
    o.save()
    bpy.data.images.remove(o)
    tmp.unlink(missing_ok=True)
    print('Saved:', path)
    return str(path)


_YAW0 = scene_layout().get('hero_start_yaw', 0.0)
_PITCH0 = scene_layout().get('hero_start_pitch', FOLLOW['pitch0'])
VIEWS = {
    # 開始の画面：主人公の後ろ 3.3 m、北北西をわずかに見上げる（門は右、桜と塀は中央左、町家 A は左の端）
    'main': dict(yaw=_YAW0, pitch=_PITCH0),
    # 左（町家 A の表と空き地の方）
    'left': dict(yaw=_YAW0 + 0.8, pitch=FOLLOW['pitch0']),
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--views', default='main,left')
    ap.add_argument('--res', default='1280x720')
    ap.add_argument('--no-hero', action='store_true')
    ap.add_argument('--prefix', default='scene-preview')
    ap.add_argument('--ground', default=None, help='地面の GLB（既定は public/models/ground_v2.glb）')
    a = ap.parse_args(argv)
    res = tuple(int(v) for v in a.res.split('x'))
    reset()
    assemble(hero=not a.no_hero, ground_path=a.ground)
    setup_game_look()
    for v in a.views.split(','):
        cam, tgt = game_camera(**VIEWS[v])
        name = a.prefix if v == 'main' else f'{a.prefix}-{v}'
        render_game(PREVIEW_DIR / f'{name}.png', cam, tgt, res=res, samples=a.samples)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
