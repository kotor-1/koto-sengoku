"""
肌の部品（頭と首・前腕と手・足袋の足）と、重み付け・当たり判定に使う全身の代わり（プロキシ）を作る。
SDF の面は時間がかかるので build/hero/cache に保存し、anatomy.py / sdf.py が変わらなければ使い回す。
"""
from __future__ import annotations

import hashlib
import pathlib

import numpy as np

import anatomy as A
from sdf import F, mesh_sdf, orient_outward

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE.parents[0] / 'build' / 'hero' / 'cache'
CACHE.mkdir(parents=True, exist_ok=True)


def _src_hash(extra=''):
    h = hashlib.sha1()
    for f in ('anatomy.py', 'sdf.py', 'skin.py'):
        h.update((HERE / f).read_bytes())
    h.update(extra.encode())
    return h.hexdigest()[:12]


def cached_mesh(key, parts, lo, hi, h):
    path = CACHE / f'{key}-{_src_hash(repr((parts, lo, hi, h)))}.npz'
    if path.exists():
        z = np.load(path)
        return z['V'], z['Q']
    fn = lambda P: A.body(P, parts)
    V, Q = mesh_sdf(fn, lo, hi, h)
    Q = orient_outward(fn, V, Q)
    np.savez(path, V=V, Q=Q)
    return V, Q


def keep_faces(V, Q, keep_vert):
    """頂点の条件で面を残し、使わない頂点を落とす"""
    fk = keep_vert[Q].all(1)
    Q = Q[fk]
    used = np.unique(Q)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used))
    return V[used], remap[Q]


def head_piece():
    """頭と首と胸の上（襟の V から見える所まで）。下は斜めの面で切る（前は低く、後ろは高く）"""
    V, Q = cached_mesh('head', ['torso', 'neck', 'head'], (-.12, 1.30, -.135), (.12, 1.775, .135), .0013)
    y_cut = 1.335 + (0.07 - V[:, 2]) * 0.55     # 前 z=.07 で 1.335、後ろ z=-.07 で 1.41
    keep = (V[:, 1] > y_cut) & (np.abs(V[:, 0]) < .115)
    return keep_faces(V, Q, keep)


def arm_piece(s):
    """前腕と手（肘から先）。肘で上腕の向きに直角な面で切る"""
    lo, hi = A.BOXES['handL']
    V, Q = cached_mesh('arm', ['armL', 'handL'], (.22, .66, -.06), (.40, 1.16, .13), .00105)
    sh, el = A.J['LeftUpperArm'], A.J['LeftForeArm']
    ua = (el - sh) / np.linalg.norm(el - sh)
    keep = ((V - (el - ua * 0.01)) @ ua) > 0
    V, Q = keep_faces(V, Q, keep)
    if s < 0:
        V = V * np.array([-1, 1, 1])
        Q = Q[:, ::-1]
    return V, Q


def foot_piece(s):
    V, Q = cached_mesh('foot', ['legL', 'footL'], (.025, 0, -.075), (.175, .23, .245), .0014)
    keep = V[:, 1] < .165
    V, Q = keep_faces(V, Q, keep)
    if s < 0:
        V = V * np.array([-1, 1, 1])
        Q = Q[:, ::-1]
    return V, Q


def proxy_body():
    """全身（粗い）。重みの計算と布の当たり判定に使う。書き出さない"""
    return cached_mesh('proxy', None, (-.42, -.01, -.2), (.42, 1.8, .26), .007)
