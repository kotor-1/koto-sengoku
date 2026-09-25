"""
Blender の中で使う小さな道具（numpy の頂点・面から物体を作る、減らす、材質など）。
頂点はゲームの座標（x, y 上, z 前）で受け取り、Blender の (x, -z, y) に直す。
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np


def g2b_arr(V):
    V = np.asarray(V, float)
    return np.column_stack([V[:, 0], -V[:, 2], V[:, 1]])


def b2g_arr(V):
    V = np.asarray(V, float)
    return np.column_stack([V[:, 0], V[:, 2], -V[:, 1]])


def make_mesh(name, V, faces, *, game=True, collection=None, smooth=True, uv=None):
    """faces は同じ角数の配列か、面ごとの list。uv は面の角ごと（loop ごと）の (n_loops, 2)"""
    Vb = g2b_arr(V) if game else np.asarray(V, float)
    me = bpy.data.meshes.new(name)
    if isinstance(faces, np.ndarray):
        flat = faces.reshape(-1)
        sizes = np.full(len(faces), faces.shape[1])
    else:
        flat = np.concatenate([np.asarray(f) for f in faces]) if len(faces) else np.zeros(0, int)
        sizes = np.array([len(f) for f in faces])
    me.vertices.add(len(Vb))
    me.vertices.foreach_set('co', Vb.astype(np.float32).ravel())
    me.loops.add(len(flat))
    me.loops.foreach_set('vertex_index', flat.astype(np.int32))
    me.polygons.add(len(sizes))
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    me.polygons.foreach_set('loop_start', starts)
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if uv is not None:
        lay = me.uv_layers.new(name='UVMap')
        lay.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def verts_game(ob):
    me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    return b2g_arr(co.reshape(-1, 3))


def set_verts_game(ob, V):
    ob.data.vertices.foreach_set('co', g2b_arr(V).astype(np.float32).ravel())
    ob.data.update()


def faces_of(ob):
    return [list(p.vertices) for p in ob.data.polygons]


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_modifiers(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def ntris(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    ev.to_mesh_clear()
    return n


def decimate_to(ob, target_tris, symmetric=False):
    cur = ntris(ob)
    if cur <= target_tris:
        return cur
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target_tris / cur
    m.use_collapse_triangulate = False
    if symmetric:
        m.use_symmetry = True
        m.symmetry_axis = 'X'
    apply_modifiers(ob)
    return ntris(ob)


def smooth_mesh(ob, factor=0.5, iters=2, preserve_volume=True):
    m = ob.modifiers.new('sm', 'CORRECTIVE_SMOOTH' if preserve_volume else 'SMOOTH')
    if preserve_volume:
        m.factor = factor
        m.iterations = iters
        m.smooth_type = 'SIMPLE'
        m.use_only_smooth = True
        m.rest_source = 'ORCO'
    else:
        m.factor = factor
        m.iterations = iters
    apply_modifiers(ob)


def join(objs, name=None):
    activate(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    if name:
        ob.name = name
        ob.data.name = name
    return ob


def principled(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, *, base_tex=None, normal_tex=None, normal_strength=1.0,
               rough_tex=None, alpha_clip=False, uv_scale=None, vcol=None, double=False, spec=0.5):
    """glTF に素直に書き出せる形の材質。base_tex 等は bpy の画像"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    uvnode = None
    if uv_scale is not None and (base_tex or normal_tex or rough_tex):
        uvnode = nt.nodes.new('ShaderNodeUVMap')
        uvnode.uv_map = 'UVMap'
    col_out = None
    if base_tex is not None:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = base_tex
        if uvnode:
            nt.links.new(uvnode.outputs['UV'], tn.inputs['Vector'])
        col_out = tn.outputs['Color']
        if alpha_clip:
            nt.links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
    if vcol is not None:
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = vcol
        if col_out is None and tuple(color) == (1.0, 1.0, 1.0):
            col_out = vc.outputs['Color']
        else:
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            if col_out is None:
                mix.inputs['A'].default_value = (*color, 1)
            else:
                nt.links.new(col_out, mix.inputs['A'])
            nt.links.new(vc.outputs['Color'], mix.inputs['B'])
            col_out = mix.outputs['Result']
    if col_out is not None:
        nt.links.new(col_out, bsdf.inputs['Base Color'])
    if normal_tex is not None:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = normal_tex
        normal_tex.colorspace_settings.name = 'Non-Color'
        if uvnode:
            nt.links.new(uvnode.outputs['UV'], tn.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if rough_tex is not None:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = rough_tex
        rough_tex.colorspace_settings.name = 'Non-Color'
        if uvnode:
            nt.links.new(uvnode.outputs['UV'], tn.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tn.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if alpha_clip:
        mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else mat.blend_method
        try:
            mat.surface_render_method = 'DITHERED'
        except Exception:
            pass
        mat.alpha_threshold = 0.5 if hasattr(mat, 'alpha_threshold') else None
    mat.use_backface_culling = not double
    return mat


def image_from_array(name, arr, path=None, colorspace='sRGB'):
    """arr: (h, w, 3|4) の 0..1。上下は画像の見た目どおり（行 0 が上）"""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], 2)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    if path:
        img.filepath_raw = str(path)
        img.file_format = 'PNG'
        img.save()
    img.pack()
    return img


def assign_material(ob, mat):
    if len(ob.data.materials) == 0:
        ob.data.materials.append(mat)
    else:
        ob.data.materials[0] = mat
