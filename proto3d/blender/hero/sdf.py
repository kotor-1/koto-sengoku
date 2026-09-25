"""
符号付き距離関数（SDF）で有機的な形を作り、格子上で面（Surface Nets）に変える道具。numpy だけで動く。
座標はゲームの向き（x 左、y 上、z 前、メートル）。Blender へ渡すときに (x, -z, y) へ変える。
"""
from __future__ import annotations

import numpy as np

F = np.float32


def _v(p):
    return np.asarray(p, dtype=F)


# ---- 基本の形 ----
def sphere(P, c, r):
    return np.linalg.norm(P - _v(c), axis=1) - F(r)


def ellipsoid(P, c, r, R=None):
    """楕円体（近似の距離）。R は 3x3 の回転（列が局所軸）"""
    q = P - _v(c)
    if R is not None:
        q = q @ _v(R)
    r = _v(r)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def capsule(P, a, b, ra, rb=None):
    """端の太さが違うカプセル（丸い円錐）。太さは線形に変わる（簡易）"""
    if rb is None:
        rb = ra
    a = _v(a)
    b = _v(b)
    ba = b - a
    pa = P - a
    t = np.clip((pa @ ba) / F(ba @ ba), 0.0, 1.0)
    d = np.linalg.norm(pa - t[:, None] * ba, axis=1)
    return d - (F(ra) + (F(rb) - F(ra)) * t)


def ecapsule(P, a, b, ra, rb, squash, side):
    """断面が楕円のカプセル。side 方向に squash 倍（<1 で平たく）"""
    a = _v(a)
    b = _v(b)
    ba = b - a
    pa = P - a
    t = np.clip((pa @ ba) / F(ba @ ba), 0.0, 1.0)
    q = pa - t[:, None] * ba
    s = _v(side)
    s = s - ba * (s @ ba) / (ba @ ba)
    s = s / np.linalg.norm(s)
    qs = q @ s
    q = q + (qs / F(squash) - qs)[:, None] * s
    d = np.linalg.norm(q, axis=1) * F(min(1.0, squash))
    return d - (F(ra) + (F(rb) - F(ra)) * t)


def box(P, c, half, R=None, round_=0.0):
    q = P - _v(c)
    if R is not None:
        q = q @ _v(R)
    q = np.abs(q) - (_v(half) - F(round_))
    out = np.linalg.norm(np.maximum(q, 0), axis=1)
    inn = np.minimum(np.max(q, axis=1), 0)
    return out + inn - F(round_)


def plane(P, point, normal):
    n = _v(normal) / np.linalg.norm(normal)
    return (P - _v(point)) @ n


# ---- 組み合わせ ----
def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sub(a, b, k=0.0):
    """a から b を削る"""
    return smax(a, -b, k)


def union(ds, k):
    out = ds[0]
    for d in ds[1:]:
        out = smin(out, d, k)
    return out


def rot_between(a, b):
    """ベクトル a を b に向ける回転（3x3）"""
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(a @ b)
    if c < -0.999999:
        return -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def axis_angle(axis, ang):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    x, y, z = axis
    c, s = np.cos(ang), np.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


# ---- 格子で評価して面にする ----
def grid_eval(fn, lo, hi, h, chunk=2_000_000):
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.maximum(np.ceil((hi - lo) / h).astype(int) + 1, 2)
    xs = lo[0] + np.arange(n[0]) * h
    ys = lo[1] + np.arange(n[1]) * h
    zs = lo[2] + np.arange(n[2]) * h
    out = np.empty(n[0] * n[1] * n[2], dtype=F)
    # x を一番遅く回す（reshape で (nx, ny, nz)）
    yz = np.stack(np.meshgrid(ys, zs, indexing='ij'), -1).reshape(-1, 2).astype(F)
    per = yz.shape[0]
    rows = max(1, chunk // per)
    for i0 in range(0, n[0], rows):
        i1 = min(n[0], i0 + rows)
        xx = np.repeat(xs[i0:i1].astype(F), per)
        P = np.column_stack([xx, np.tile(yz[:, 0], i1 - i0), np.tile(yz[:, 1], i1 - i0)])
        out[i0 * per:i1 * per] = fn(P)
    return out.reshape(n[0], n[1], n[2]), lo


def surface_nets(f, lo, h):
    """符号の変わる格子から、頂点（セルごと 1 つ）と四角形の面を作る。面は外向き"""
    nx, ny, nz = f.shape
    inside = f < 0
    cells = (nx - 1, ny - 1, nz - 1)
    s = np.zeros(cells + (3,), dtype=np.float64)
    cnt = np.zeros(cells, dtype=np.int32)
    for ax in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[ax] = slice(0, -1)
        sl1[ax] = slice(1, None)
        f0 = f[tuple(sl0)]
        f1 = f[tuple(sl1)]
        cross = inside[tuple(sl0)] != inside[tuple(sl1)]
        ii = np.nonzero(cross)
        t = f0[ii] / (f0[ii] - f1[ii])
        pts = np.stack(ii, -1).astype(np.float64)
        pts[:, ax] += t
        others = [a for a in range(3) if a != ax]
        for da in (0, -1):
            for db in (0, -1):
                c = [ii[0].copy(), ii[1].copy(), ii[2].copy()]
                c[others[0]] = c[others[0]] + da
                c[others[1]] = c[others[1]] + db
                ok = np.ones(len(t), bool)
                for a in range(3):
                    ok &= (c[a] >= 0) & (c[a] < cells[a])
                idx = tuple(ci[ok] for ci in c)
                np.add.at(s, idx, pts[ok])
                np.add.at(cnt, idx, 1)
    active = cnt > 0
    vid = -np.ones(cells, dtype=np.int64)
    vid[active] = np.arange(int(active.sum()))
    verts = s[active] / cnt[active][:, None]
    verts = np.asarray(lo) + verts * h
    faces = []
    for ax in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[ax] = slice(0, -1)
        sl1[ax] = slice(1, None)
        a_in = inside[tuple(sl0)]
        cross = a_in != inside[tuple(sl1)]
        ii = np.nonzero(cross)
        o0, o1 = [a for a in range(3) if a != ax]
        ok = (ii[o0] >= 1) & (ii[o1] >= 1) & (ii[o0] < cells[o0]) & (ii[o1] < cells[o1]) & (ii[ax] < cells[ax])
        base = [x[ok] for x in ii]
        flip = a_in[tuple(base)]
        quad = []
        for da, db in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = [base[0].copy(), base[1].copy(), base[2].copy()]
            c[o0] += da
            c[o1] += db
            quad.append(vid[tuple(c)])
        q = np.stack(quad, -1)
        # 軸の並び（右手系）で向きをそろえる
        q[flip] = q[flip][:, ::-1]
        if ax == 1:
            q = q[:, ::-1]
        faces.append(q)
    faces = np.concatenate(faces)
    faces = faces[(faces >= 0).all(1)]
    return verts, faces


def grad(fn, P, eps=2e-4):
    g = np.zeros_like(P)
    for a in range(3):
        d = np.zeros(3, dtype=F)
        d[a] = eps
        g[:, a] = (fn(P + d) - fn(P - d)) / (2 * eps)
    return g


def project(fn, V, iters=3, max_step=None):
    """頂点を面の上へ寄せる（ニュートン法）"""
    V = V.astype(F)
    for _ in range(iters):
        d = fn(V)
        g = grad(fn, V)
        gg = np.maximum((g * g).sum(1), 1e-8)
        step = (d / gg)[:, None] * g
        if max_step is not None:
            L = np.linalg.norm(step, axis=1, keepdims=True)
            step = step * np.minimum(1.0, max_step / np.maximum(L, 1e-12))
        V = V - step
    return V


def grid_eval_narrow(fn, lo, hi, h, factor=4, band=None):
    """粗い格子で面の近くだけを探し、細かい格子はその近くだけ計算する（遠くは粗い値の符号で埋める）"""
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.maximum(np.ceil((hi - lo) / h).astype(int) + 1, 2)
    H = h * factor
    fc, _ = grid_eval(fn, lo, lo + (np.ceil((n - 1) / factor) + 1) * H, H)
    band = band if band is not None else 1.9 * H
    # 粗い値を細かい格子へ（最近傍）
    ix = [np.minimum(np.round(np.arange(n[a]) / factor).astype(int), fc.shape[a] - 1) for a in range(3)]
    fine = fc[np.ix_(ix[0], ix[1], ix[2])].copy()
    near = np.abs(fine) < band
    idx = np.nonzero(near)
    P = np.column_stack([lo[0] + idx[0] * h, lo[1] + idx[1] * h, lo[2] + idx[2] * h]).astype(F)
    vals = np.empty(len(P), F)
    for i0 in range(0, len(P), 2_000_000):
        vals[i0:i0 + 2_000_000] = fn(P[i0:i0 + 2_000_000])
    fine[idx] = vals
    return fine, lo


def mesh_sdf(fn, lo, hi, h, proj_iters=2, narrow=True):
    f, lo = grid_eval_narrow(fn, lo, hi, h) if narrow else grid_eval(fn, lo, hi, h)
    v, q = surface_nets(f, lo, h)
    if proj_iters:
        v = project(fn, v, proj_iters, max_step=h)
    return v.astype(np.float64), q


def orient_outward(fn, V, Q):
    """面の向きが外（SDF が増える方）でなければ反転"""
    a, b, c = V[Q[:, 0]], V[Q[:, 1]], V[Q[:, 2]]
    n = np.cross(b - a, c - a)
    cen = (a + b + c) / 3
    g = grad(fn, cen.astype(F))
    if (n * g).sum() < 0:
        return Q[:, ::-1]
    return Q
