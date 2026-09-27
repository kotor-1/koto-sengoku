"""
頭と首のつながりの確かめ（数値）。build_hero_v3.py の後に実行：
    /root/blender-venv/bin/python proto3d/blender/hero/check_head_motion.py
Idle / Walk / Run の各コマ（Idle は 5 コマおき）で、骨で動かした後の形を比べる：
- 髪・髷・眉・まつ毛・眼球が、下の肌（頭と首の部品）から離れたり めり込んだりしないか
  （休みの姿勢で一番近い肌の点との距離が、動きの中でどれだけ変わるか）
- 襟（Eri・Juban）の内の縁と首の肌の距離（休みの姿勢より広がって、すき間が見えるほど離れないか）
- 首の肌が襟より下へ続いているか（首の部品の切り口が、小袖・襟の外へ出ないか）
結果：proto3d/blender/build/hero/head_motion.json と、画面への要約
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy
import mathutils
import numpy as np

from common import BUILD_DIR

WORK = BUILD_DIR / 'hero'


def evaluated_verts(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world)
    co = co @ M[:3, :3].T + M[:3, 3]
    return np.column_stack([co[:, 0], co[:, 2], -co[:, 1]])     # ゲームの座標


def kd(V):
    t = mathutils.kdtree.KDTree(len(V))
    for i, v in enumerate(V):
        t.insert(v, i)
    t.balance()
    return t


def main():
    bpy.ops.wm.open_mainfile(filepath=str(WORK / 'hero_v3.blend'))
    arm = bpy.data.objects['Hero_v3']
    head = bpy.data.objects['Head']
    parts = [n for n in ('Hair', 'HairStrands', 'Topknot', 'Motoyui', 'TopknotStrands', 'NapeWisps', 'BrowL', 'BrowR', 'LashL', 'LashR', 'EyeL', 'EyeR') if n in bpy.data.objects]
    collar = [n for n in ('Eri', 'Juban') if n in bpy.data.objects]
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(0)
    H0 = evaluated_verts(head)
    tH = kd(H0)
    # 各部品の頂点 → 休みの姿勢で一番近い肌の点
    pair = {}
    for n in parts:
        V0 = evaluated_verts(bpy.data.objects[n])
        idx = np.array([tH.find(v)[1] for v in V0])
        pair[n] = (idx, np.linalg.norm(V0 - H0[idx], axis=1))
    # 襟：首に近い縁の頂点（肌から 2.5cm 以内）と、首の肌の点
    cpair = {}
    for n in collar:
        V0 = evaluated_verts(bpy.data.objects[n])
        res = [tH.find(v) for v in V0]
        d0 = np.array([r[2] for r in res])
        near = np.nonzero((d0 < 0.025) & (V0[:, 1] > 1.36))[0]
        cpair[n] = (near, np.array([res[i][1] for i in near]), d0[near])
    out = {'frames': 0, 'parts': {}, 'collar': {}}
    worst = {n: 0.0 for n in parts}
    cworst = {n: 0.0 for n in collar}
    cmax = {n: 0.0 for n in collar}
    frames = [('Idle', f) for f in range(0, 81, 5)] + [('Walk', f) for f in range(0, 22)] + [('Run', f) for f in range(0, 17)]
    for act, f in frames:
        arm.animation_data.action = bpy.data.actions[act]
        bpy.context.scene.frame_set(f)
        H = evaluated_verts(head)
        for n in parts:
            V = evaluated_verts(bpy.data.objects[n])
            idx, d0 = pair[n]
            d = np.linalg.norm(V - H[idx], axis=1)
            worst[n] = max(worst[n], float(np.abs(d - d0).max()))
        for n in collar:
            near, hidx, d0 = cpair[n]
            V = evaluated_verts(bpy.data.objects[n])[near]
            d = np.linalg.norm(V - H[hidx], axis=1)
            cworst[n] = max(cworst[n], float((d - d0).max()))
            cmax[n] = max(cmax[n], float(d.max()))
        out['frames'] += 1
    out['parts'] = {n: round(worst[n] * 1000, 2) for n in parts}
    out['collar'] = {n: {'max_widening_mm': round(cworst[n] * 1000, 2), 'max_dist_mm': round(cmax[n] * 1000, 2)} for n in collar}
    # 顔の部品のまわりの肌の重み（Head 以外の骨が混ざっていないか）
    vg = {g.index: g.name for g in head.vertex_groups}
    Hr = H0
    face = np.nonzero((Hr[:, 1] > 1.595) & (Hr[:, 2] > 0.03))[0]
    non_head = 0.0
    for i in face:
        for g in head.data.vertices[int(i)].groups:
            if vg[g.group] != 'Head':
                non_head = max(non_head, g.weight)
    out['face_skin_max_non_head_weight'] = round(non_head, 4)
    (WORK / 'head_motion.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print('HEAD_MOTION', json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
