"""確認用の光：ゲームの描画（日差し 3.4・#ffe2bd、空の弱い光、ACES）に近づけたもの"""
import math
import bpy
from common import sun_direction_blender


def game_lights(exposure=0.55):
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
