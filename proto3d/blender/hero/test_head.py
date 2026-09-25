"""頭と手の形の確認（試し）"""
import sys, time, math
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')
import numpy as np
from common import *
import anatomy as A
from sdf import mesh_sdf, orient_outward
import util as U

reset()
t0 = time.time()
def mk(name, parts, lo, hi, h):
    fn = lambda P: A.body(P, parts)
    V, Q = mesh_sdf(fn, lo, hi, h)
    Q = orient_outward(fn, V, Q)
    print(name, len(V), 'verts', round(time.time() - t0, 1), 's', flush=True)
    return U.make_mesh(name, V, Q)
headm = mk('head', ['neck', 'head'], (-.11, 1.44, -.13), (.11, 1.775, .13), .0013)
handm = mk('hand', ['armL', 'handL'], (.24, .67, -.05), (.40, .98, .13), .001)
skin = U.principled('skin', (0.60, 0.42, 0.33), 0.5)
U.assign_material(headm, skin); U.assign_material(handm, skin)
# 眼球
def eyeball(c, r):
    import bmesh
    rings = [0, 7, 13, 19, 25, 29, 36, 50, 70, 95, 125, 155, 180]
    seg = 24
    V = []; F = []; M = []
    for a in rings[1:-1]:
        th = math.radians(a)
        for k in range(seg):
            ph = 2 * math.pi * k / seg
            V.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    V = [(0, 0, 1)] + V + [(0, 0, -1)]
    V = np.array(V)
    # 角膜のふくらみ
    V[:, 2] += 0.12 * np.clip(np.cos(np.arccos(np.clip(V[:, 2], -1, 1)) / math.radians(29) * math.pi / 2), 0, 1) ** 2 * (V[:, 2] > math.cos(math.radians(29)))
    nr = len(rings) - 2
    for k in range(seg):
        F.append((0, 1 + k, 1 + (k + 1) % seg)); M.append(0)
    for i in range(nr - 1):
        for k in range(seg):
            a = 1 + i * seg + k; b = 1 + i * seg + (k + 1) % seg
            F.append((a, a + seg, b + seg, b)); M.append(0 if i < 1 else 1 if i < 4 else 2)
    last = len(V) - 1
    for k in range(seg):
        a = 1 + (nr - 1) * seg + k; b = 1 + (nr - 1) * seg + (k + 1) % seg
        F.append((a, last, b)); M.append(2)
    P = np.column_stack([V[:, 0] * r, V[:, 1] * r, V[:, 2] * r]) + c
    return P, F, M
mats = [U.principled('pupil', (0.01, 0.01, 0.01), 0.1), U.principled('iris', (0.09, 0.05, 0.03), 0.15), U.principled('sclera', (0.75, 0.72, 0.66), 0.2)]
for s in (1, -1):
    c = A.mirror(A.EYE_C, s)
    P, F, M = eyeball(c, A.EYE_R)
    o = U.make_mesh('eye', P, F)
    for m in mats: o.data.materials.append(m)
    o.data.polygons.foreach_set('material_index', np.array(M))
handm.location.x = 0.4
add_preview_lights()
for name, cam, tgt, res, fov in [
    ('face34', (0.30, 1.66, 0.55), (0, 1.625, 0.02), (640, 640), 26),
    ('face_front', (0.0, 1.64, 0.7), (0, 1.625, 0.02), (640, 640), 22),
    ('face_side', (0.62, 1.64, 0.05), (0, 1.625, 0.0), (640, 640), 26),
    ('hand_back', (0.4 + 0.75, 0.95, 0.15), (0.4 + 0.32, 0.83, 0.03), (640, 640), 24),
    ('hand_front', (0.4 + 0.45, 0.9, 0.7), (0.4 + 0.32, 0.83, 0.03), (640, 640), 24),
]:
    render_preview(PREVIEW_DIR / f'hero_v3-test-{name}.png', cam, tgt, res=res, samples=12, fov_deg=fov)
print('done', round(time.time() - t0, 1))
