"""
Blender（bpy、Python から使う形）で 3D 比較版の素材を作るための共通の道具。

- 実行: /root/blender-venv/bin/python <スクリプト>.py （Blender 4.5 LTS。画面なし・CPU）
- 座標: ゲームは y が上・z が南（北は -z）。Blender は Z が上。glTF の書き出しで (X, Y, Z)_blender → (X, Z, -Y)_gltf になるので、
  ゲームの (x, y, z) は Blender の (x, -z, y)。北（城門の方）は Blender の +Y、東は +X。
- 書き出し: GLB。Draco・meshopt の圧縮は使わない（ゲームの読み込みに復号の部品を入れていない）。WebP も使わない。
"""
from __future__ import annotations

import json
import math
import os
import pathlib

import bpy
import mathutils

REPO = pathlib.Path(__file__).resolve().parents[3]
BLENDER_DIR = REPO / 'proto3d' / 'blender'
MODELS_DIR = REPO / 'proto3d' / 'public' / 'models'
BUILD_DIR = BLENDER_DIR / 'build'          # 作業用（テクスチャの焼き込みなど。git には入れない）
PREVIEW_DIR = REPO / 'e2e-out' / 'blender'  # 確認用の描画（git には入れない）
for d in (BUILD_DIR, PREVIEW_DIR):
    d.mkdir(parents=True, exist_ok=True)


def scene_layout() -> dict:
    """場面の配置（proto3d/blender/scene.json）"""
    return json.loads((BLENDER_DIR / 'scene.json').read_text())


def g2b(x: float, y: float, z: float) -> tuple[float, float, float]:
    """ゲームの座標 → Blender の座標"""
    return (x, -z, y)


def b2g(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Blender の座標 → ゲームの座標"""
    return (x, z, -y)


def reset() -> None:
    """空の場面から始める"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'


def triangles(objs=None) -> int:
    """評価後（モディファイア適用後）の三角形の数"""
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in objs or bpy.context.scene.objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ev.to_mesh_clear()
    return total


def export_glb(path: str | os.PathLike, objects=None, *, animations: bool = False, jpeg: bool = True, jpeg_quality: int = 88) -> int:
    """
    GLB に書き出す。objects を渡すとそれだけ（選択して書き出す）。
    jpeg=True なら不透明の画像は JPEG（透ける葉・草の画像は PNG のまま残すには jpeg=False にして画像を PNG で用意する）。
    返り値はファイルの大きさ（バイト）。
    """
    path = str(path)
    if objects is not None:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=objects is not None,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_image_format='JPEG' if jpeg else 'AUTO',
        export_jpeg_quality=jpeg_quality,
        export_draco_mesh_compression_enable=False,
        export_animations=animations,
        export_skins=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    return os.path.getsize(path)


def sun_direction_blender() -> mathutils.Vector:
    """ゲームの日差しの向き（光が来る方＝ SUN_OFFSET）を Blender の座標で"""
    sx, sy, sz = scene_layout()['sun_offset_game']
    return mathutils.Vector(g2b(sx, sy, sz)).normalized()


def add_preview_lights(strength: float = 4.0) -> None:
    """ゲームと同じ向きの日差しと、空の光（確認用の描画）"""
    s = bpy.context.scene
    world = bpy.data.worlds.new('preview-sky') if not s.world else s.world
    s.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA' if 'NISHITA' in [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items] else sky.sky_type
    d = sun_direction_blender()
    sky.sun_elevation = math.asin(max(0.05, d.z))
    sky.sun_rotation = math.atan2(d.x, d.y)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.35
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    light = bpy.data.lights.new('preview-sun', 'SUN')
    light.energy = strength
    light.angle = math.radians(1.5)
    light.color = (1.0, 0.9, 0.78)
    o = bpy.data.objects.new('preview-sun', light)
    s.collection.objects.link(o)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()


def render_preview(path: str | os.PathLike, cam_game: tuple[float, float, float], target_game: tuple[float, float, float], *,
                   res=(960, 540), samples: int = 24, fov_deg: float = 50.0) -> str:
    """確認用に Cycles で 1 枚描く（ゲームの座標でカメラと見る点を指定）。描いたら Read で見て確かめる"""
    s = bpy.context.scene
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
    s.cycles.use_denoising = True
    s.render.resolution_x, s.render.resolution_y = res
    s.render.image_settings.file_format = 'PNG'
    s.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return str(path)
