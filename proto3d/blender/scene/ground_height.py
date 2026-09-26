"""
地面（ground_v2.glb の ground_terrain）の高さを格子で書き出す。ゲームは主人公の足の高さをこの格子から読む（起伏で足が沈まない・浮かないように）。

    python3 proto3d/blender/scene/ground_height.py

出力: proto3d/blender/scene/ground_height.json
  { x0, z0, step, nx, nz, h: [nz 行 × nx 列の高さ（mm、整数）] }  ゲームの座標（x 東、z 南）。格子の外は 0。
地面を作り直したら（build_ground.py）これも作り直す。Blender は使わない（numpy だけ）。
"""
from __future__ import annotations

import json
import pathlib
import struct

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
GLB = HERE.parents[1] / 'public' / 'models' / 'ground_v2.glb'
OUT = HERE / 'ground_height.json'
X0, X1, Z0, Z1, STEP = -20.0, 20.0, -26.0, 20.0, 0.25

CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    b = path.read_bytes()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n + 8

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        k = NC[a['type']]
        arr = np.frombuffer(b, CT[a['componentType']], a['count'] * k, off + bv.get('byteOffset', 0) + a.get('byteOffset', 0))
        return arr.reshape(-1, k) if k > 1 else arr
    return j, acc


def terrain_triangles():
    j, acc = read_glb(GLB)
    tris = []
    for node in j['nodes']:
        if node.get('name') != 'ground_terrain' or 'mesh' not in node:
            continue
        assert 'matrix' not in node and not any(k in node for k in ('translation', 'rotation', 'scale')), '地面のノードは位置・回転なしの前提'
        for p in j['meshes'][node['mesh']]['primitives']:
            pos = acc(p['attributes']['POSITION']).astype(np.float64)
            idx = acc(p['indices']).astype(np.int64).reshape(-1, 3)
            tris.append(pos[idx])
    return np.concatenate(tris)


def main():
    T = terrain_triangles()
    nx = int(round((X1 - X0) / STEP)) + 1
    nz = int(round((Z1 - Z0) / STEP)) + 1
    H = np.full((nz, nx), np.nan)
    for a, b, c in T:
        xs, zs = (a[0], b[0], c[0]), (a[2], b[2], c[2])
        i0, i1 = int(np.ceil((min(xs) - X0) / STEP)), int(np.floor((max(xs) - X0) / STEP))
        k0, k1 = int(np.ceil((min(zs) - Z0) / STEP)), int(np.floor((max(zs) - Z0) / STEP))
        i0, k0, i1, k1 = max(i0, 0), max(k0, 0), min(i1, nx - 1), min(k1, nz - 1)
        if i0 > i1 or k0 > k1:
            continue
        gx, gz = np.meshgrid(X0 + np.arange(i0, i1 + 1) * STEP, Z0 + np.arange(k0, k1 + 1) * STEP)
        d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[2] - c[2]) * (gx - c[0]) + (c[0] - b[0]) * (gz - c[2])) / d
        w1 = ((c[2] - a[2]) * (gx - c[0]) + (a[0] - c[0]) * (gz - c[2])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        y = w0 * a[1] + w1 * b[1] + w2 * c[1]
        sub = H[k0:k1 + 1, i0:i1 + 1]
        take = inside & (np.isnan(sub) | (y > sub))
        sub[take] = y[take]
    miss = np.isnan(H).mean()
    H = np.nan_to_num(H, nan=0.0)
    mm = np.round(H * 1000).astype(int)
    OUT.write_text(json.dumps({'_about': __doc__.strip().splitlines()[0], 'x0': X0, 'z0': Z0, 'step': STEP, 'nx': nx, 'nz': nz,
                               'h': mm.ravel().tolist()}, separators=(',', ':')))
    print(f'{OUT}: {nx}x{nz}, 高さ {mm.min()}〜{mm.max()} mm, 地面の外 {miss:.1%}')


if __name__ == '__main__':
    main()
