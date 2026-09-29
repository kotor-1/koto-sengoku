"""
面（MPFB の頭と首の肌）から符号つき距離（SDF）の格子を作り、三線形の補間で引く。
髪（hair.py の髪の層・房・うなじの毛）と眉を、新しい頭の面に沿わせるために使う。
- 距離は Blender の BVH の最近点（面まで）。符号は最近点の面の向き（外が +）
- 面の近く（粗い値で ±band）だけ細かい格子で計算する。結果は build/hero/cache に保存
"""
from __future__ import annotations

import hashlib

import numpy as np

from skin import CACHE

F = np.float32


def _bvh_signed(bvh, P):
    out = np.empty(len(P), np.float32)
    fn = bvh.find_nearest
    for i, p in enumerate(P.tolist()):
        loc, nrm, _, dist = fn(p)
        if loc is None:
            out[i] = 1.0
            continue
        s = (p[0] - loc[0]) * nrm[0] + (p[1] - loc[1]) * nrm[1] + (p[2] - loc[2]) * nrm[2]
        out[i] = dist if s >= 0 else -dist
    return out


class GridSDF:
    def __init__(self, V, Q, lo, hi, h, band=0.012, tag='mpfb'):
        from mathutils.bvhtree import BVHTree
        self.lo = np.asarray(lo, float)
        self.h = h
        n = np.ceil((np.asarray(hi, float) - self.lo) / h).astype(int) + 1
        self.n = n
        key = hashlib.sha1(np.ascontiguousarray(V, np.float64).tobytes() + np.ascontiguousarray(Q, np.int64).tobytes()
                           + repr((list(lo), list(hi), h, band)).encode()).hexdigest()[:12]
        path = CACHE / f'{tag}-sdf-{key}.npz'
        if path.exists():
            self.g = np.load(path)['g']
            return
        bvh = BVHTree.FromPolygons([tuple(v) for v in np.asarray(V, float)], [tuple(int(i) for i in q) for q in Q])
        # 粗い格子（4 倍の間隔）
        fct = 4
        nc = (n - 1) // fct + 2
        ax = [self.lo[a] + np.arange(nc[a]) * h * fct for a in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing='ij')
        Pc = np.column_stack([X.ravel(), Y.ravel(), Z.ravel()])
        gc = _bvh_signed(bvh, Pc).reshape(nc)
        # 細かい格子：粗い値を最近傍で埋め、面の近くだけ計算しなおす
        ix = [np.minimum(np.round(np.arange(n[a]) / fct).astype(int), nc[a] - 1) for a in range(3)]
        g = gc[np.ix_(ix[0], ix[1], ix[2])].astype(np.float32)
        near = np.nonzero(np.abs(g) < band + h * fct)
        P = np.column_stack([self.lo[0] + near[0] * h, self.lo[1] + near[1] * h, self.lo[2] + near[2] * h])
        g[near] = _bvh_signed(bvh, P)
        self.g = g
        np.savez_compressed(path, g=g)

    def __call__(self, P):
        P = np.asarray(P, float)
        q = (P - self.lo) / self.h
        n = self.n
        qc = np.clip(q, 0, n - 1.001)
        i0 = np.floor(qc).astype(int)
        t = qc - i0
        g = self.g
        out = np.zeros(len(P))
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                    out += w * g[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz]
        # 箱の外：箱までの距離を足す（遠い所の目安）
        outside = np.linalg.norm(np.maximum(np.maximum(-q, q - (n - 1)), 0), axis=1) * self.h
        return (out + outside).astype(F)
