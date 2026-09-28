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


def _src_hash(extra='', head=True):
    h = hashlib.sha1()
    for f in ('anatomy.py', 'head_form.py', 'sdf.py', 'skin.py') if head else ('anatomy.py', 'sdf.py', 'skin.py'):
        h.update((HERE / f).read_bytes())
    h.update(extra.encode())
    return h.hexdigest()[:12]


def cached_mesh(key, parts, lo, hi, h):
    path = CACHE / f'{key}-{_src_hash(repr((parts, lo, hi, h)), head=key not in ("arm", "foot"))}.npz'
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


def subdivide_project(V, Q, fn, region):
    """四角の面を 4 つに分け（辺の中点・面の中心）、新しい点を SDF の面へ寄せる。region(V) が真の点だけ寄せる。
    格子（1.3mm）より細かい形（口の合わせ目・まぶたの縁・鼻の穴）を面に写すため。"""
    from sdf import project
    nV = len(V)
    E = np.sort(np.stack([Q, np.roll(Q, -1, axis=1)], -1).reshape(-1, 2), axis=1)
    Eu, inv = np.unique(E, axis=0, return_inverse=True)
    inv = inv.reshape(len(Q), 4)
    Vm = (V[Eu[:, 0]] + V[Eu[:, 1]]) / 2
    Vc = V[Q].mean(1)
    Vall = np.concatenate([V, Vm, Vc])
    em = nV + inv                      # 面の角 k と k+1 の間の辺の中点
    fc = nV + len(Eu) + np.arange(len(Q))
    Qn = []
    for k in range(4):
        Qn.append(np.stack([Q[:, k], em[:, k], fc, em[:, (k - 1) % 4]], 1))
    Qn = np.concatenate(Qn)
    sel = np.nonzero(region(Vall))[0]
    Vall[sel] = project(fn, Vall[sel].astype(F), iters=3, max_step=.0008).astype(np.float64)
    return Vall, Qn


def head_piece():
    """頭と首と胸の上（襟の V から見える所まで）。下は斜めの面で切る（前は低く、後ろは高く）。
    顔と耳のあたり（首より上）は面を細かくして SDF の面へ寄せる（減らすのは後で）"""
    V, Q = cached_mesh('head', ['torso', 'neck', 'head'], (-.12, 1.30, -.135), (.12, 1.775, .135), .0013)
    y_cut = 1.335 + (0.07 - V[:, 2]) * 0.55     # 前 z=.07 で 1.335、後ろ z=-.07 で 1.41
    keep = (V[:, 1] > y_cut) & (np.abs(V[:, 0]) < .115)
    V, Q = keep_faces(V, Q, keep)
    path = CACHE / f'headsub-{_src_hash("sub1")}.npz'
    if path.exists():
        z = np.load(path)
        return z['V'], z['Q']
    fn = lambda P: A.body(P, ['torso', 'neck', 'head'])
    V, Q = subdivide_project(V, Q, fn, lambda X: X[:, 1] > 1.50)
    np.savez(path, V=V, Q=Q)
    return V, Q


def trim_under_collar(V, Q, keep_under=0.018):
    """襟の開きの外（小袖の下に隠れる肩・胸の肌）を落とす。襟の内の縁から keep_under までは残す
    （首と襟のあいだにすき間が見えないように）。小袖の面から肌が透けて見えるのも防ぐ"""
    import cloth as CL
    E, kind = CL.collar_curve()
    W = CL.collar_frame(E, kind)
    active = (kind == 1) | (E[:, 1] > CL.Y_CROSS)
    Ea, Wa = E[active], W[active]
    side = np.empty(len(V))
    dist = np.empty(len(V))
    for i0 in range(0, len(V), 4000):
        p = V[i0:i0 + 4000]
        d = ((p[:, None, :] - Ea[None, :, :]) ** 2).sum(2)
        j = np.argmin(d, 1)
        side[i0:i0 + 4000] = ((p - Ea[j]) * Wa[j]).sum(1)
        dist[i0:i0 + 4000] = np.sqrt(d[np.arange(len(p)), j])
    drop = (side > keep_under) & (dist < 0.12) & (V[:, 1] < 1.53)
    return keep_faces(V, Q, ~drop)


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
