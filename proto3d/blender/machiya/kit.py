"""
町家（machiya_a / machiya_b / machiya_d）の共通の部品。
    各棟の制作: /root/blender-venv/bin/python proto3d/blender/machiya/build_machiya.py [a b d] [--no-preview]

- 形はすべて実際の形状（柱・土台・梁は面取りした角材、瓦は 1 枚ずつ、垂木・格子は 1 本ずつ）
- 棟ごとの「家の座標」（X＝奥行き：0 が裏・大きいほど表、Y＝間口、Z＝上）で組み、最後に置き場所の行列で世界座標へ
- 材質はライブラリ（lib/mats.py）＋暖簾だけ自作の画像（藍の麻に白抜きの紋。紋は自作の簡単な形）。
  ライブラリの生成関数を流用した追加の材質 wood_aged（小物）・tile_manju（瓦当）を実行時に CATALOG へ足す（mats.py は書き換えない）
- 材質の鍵 'lib#名前' は同じ画像に別の頂点色の掛け算（COLOR_GAIN、または '#0.4' のような明るさ）
- 材質ごとに 1 物体（描画の回数を減らす）。瓦・板・石は 1 枚ずつ色むら（頂点色）、最後に全体で AO を頂点色へ焼く
"""
from __future__ import annotations

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'lib'))
from common import *  # noqa: E402,F401,F403
from common import BUILD_DIR, MODELS_DIR, PREVIEW_DIR, g2b, render_preview, scene_layout  # noqa: E402
import mats  # noqa: E402
import bpy  # noqa: E402
import bmesh  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

V = Vector
EX, EY, EZ = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
TEX_OUT = BUILD_DIR / 'machiya'
TEX_OUT.mkdir(parents=True, exist_ok=True)


def _register_extra_materials():
    """町家だけで使う追加の材質。ライブラリの生成関数を流用して実行時に CATALOG へ足す（lib/mats.py は書き換えない）"""
    C = mats.CATALOG
    if 'wood_aged' not in C:
        C['wood_aged'] = dict(
            tile=(2.0, 0.5), size=512, uv='along', nstr=1.0, seed=158,
            gen=mats._wood_spec(mats.rgb(146, 116, 88), mats.rgb(104, 80, 60), rings=30, warp=1.7, gray=mats.rgb(128, 116, 100),
                                weather=0.3, checks=45, relief=0.0007, rough=(0.7, 0.88), wear=mats.rgb(92, 72, 55)),
            doc='使い込んだ木（縁台・樽の側板）。温かい中間の茶（明るいところで sRGB 約 #7a6048）、少し灰色の風化、干割れ。')
    if 'tile_manju' not in C:
        def gen(n, s, t):
            d = mats._gen_tile(n, s, t)
            d['albedo'] = np.clip(d['albedo'] * 0.84, 0, 1)      # sRGB で 0.84 ≒ 線形で 0.7
            d['rough'] = np.clip(0.75 + 0.5 * (d['rough'] - d['rough'].mean()), 0.65, 0.85)
            return d
        C['tile_manju'] = dict(tile=(1.0, 1.0), size=512, uv='box', nstr=1.0, seed=162, gen=gen,
                               doc='軒瓦の瓦当（丸い面）。いぶし瓦より暗く、艶なし（粗さ 0.75）。')
    mats.NAMES[:] = list(C)


_register_extra_materials()

# 材質の鍵（'lib#名前'）ごとの色の掛け算（頂点色 COLOR_0 に入る。three.js でも基本色に掛かる）。線形の RGB
COLOR_GAIN = {
    'wood_dark#bengara': (0.9, 0.68, 0.8),       # 格子：濃い木に赤みを足した落ち着いた弁柄（sRGB 平均 ≒ #4e3228、彩度 32%）
    'wood_dark#koshi': (0.9, 0.9, 0.9),          # 2 階の格子窓（AO を弱めるため別の物体。色は wood_dark と同じ）
    'earth_floor#tataki': (0.73, 0.83, 0.95),    # 三和土：温かい土色（sRGB 平均 ≒ #6e6052）
    'stone_granite#curb': (0.5, 0.46, 0.4),      # 割石・根石：明るい灰色をやめ、温かい灰
    'straw#olive': (0.57, 0.71, 0.93),           # 籠：灰色がかったオリーブの藁
    'bamboo#dark': (0.22, 0.19, 0.23),           # 樽のたが：煤けた濃い竹
}


# ---------------------------------------------------------------------------
# 形を溜める器（材質ごと）
# ---------------------------------------------------------------------------

def newell(pts):
    n = V((0, 0, 0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Geo:
    """材質の名前ごとに頂点と面を溜める（家の座標）。smooth は面ごとのなめらか表示"""

    def __init__(self, seed=0):
        self.parts: dict[str, dict] = {}
        self.rng = np.random.default_rng(seed)

    def add(self, mat, verts, faces, smooth=False):
        p = self.parts.setdefault(mat, {'v': [], 'f': [], 'sm': []})
        o = len(p['v'])
        p['v'].extend(V(v) for v in verts)
        p['f'].extend(tuple(o + i for i in f) for f in faces)
        p['sm'].extend([smooth] * len(faces))

    def convex(self, mat, verts, faces, smooth=False, center=None):
        """凸の部品：面の向きを重心から外向きにそろえる"""
        vs = [V(v) for v in verts]
        c = V(center) if center is not None else sum(vs, V()) / len(vs)
        out = []
        for f in faces:
            pts = [vs[i] for i in f]
            fc = sum(pts, V()) / len(pts)
            out.append(tuple(f) if newell(pts).dot(fc - c) >= 0 else tuple(reversed(f)))
        self.add(mat, vs, out, smooth)

    def oriented(self, mat, verts, faces, want, smooth=False):
        """面ごとに望む向き（want: ベクトル 1 つ、または面ごとのリスト）にそろえる"""
        vs = [V(v) for v in verts]
        out = []
        for k, f in enumerate(faces):
            w = want[k] if isinstance(want, list) else want
            pts = [vs[i] for i in f]
            out.append(tuple(f) if newell(pts).dot(w) >= 0 else tuple(reversed(f)))
        self.add(mat, vs, out, smooth)

    def tris(self):
        t = 0
        for p in self.parts.values():
            t += sum(len(f) - 2 for f in p['f'])
        return t


# ---------------------------------------------------------------------------
# 基本の形
# ---------------------------------------------------------------------------

def obox(g, mat, c, ax, ay, az, hx, hy, hz, ch=0.0, seg=1, caps=(True, True)):
    """向きのある箱（ax 方向に長い）。ch>0 なら ax に平行な 4 辺を面取り（八角の断面）。seg は ax 方向の分割"""
    c = V(c)
    ax, ay, az = V(ax).normalized(), V(ay).normalized(), V(az).normalized()
    ch = min(ch, 0.45 * min(hy, hz))
    if ch > 1e-4:
        ring = [(hy - ch, -hz), (hy, -hz + ch), (hy, hz - ch), (hy - ch, hz),
                (-hy + ch, hz), (-hy, hz - ch), (-hy, -hz + ch), (-hy + ch, -hz)]
    else:
        ring = [(hy, -hz), (hy, hz), (-hy, hz), (-hy, -hz)]
    n = len(ring)
    verts, faces = [], []
    for k in range(seg + 1):
        x = -hx + 2 * hx * k / seg
        for (y, z) in ring:
            verts.append(c + ax * x + ay * y + az * z)
    for k in range(seg):
        for i in range(n):
            a, b = k * n + i, k * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if caps[0]:
        faces.append(tuple(range(n)))
    if caps[1]:
        faces.append(tuple(seg * n + i for i in range(n)))
    g.convex(mat, verts, faces, center=c)


def frame_of(p0, p1, up=EZ):
    d = V(p1) - V(p0)
    L = d.length
    ax = d / L
    u = V(up)
    az = u - ax * u.dot(ax)
    if az.length < 1e-6:
        az = EX - ax * EX.dot(ax)
        if az.length < 1e-6:
            az = EY - ax * EY.dot(ax)
    az.normalize()
    ay = az.cross(ax)
    return L, ax, ay, az


def beam(g, mat, p0, p1, w, h, up=EZ, ch=0.012, seg_len=0.0, caps=(True, True)):
    """p0→p1 の角材。w は横（up と長手に直角）、h は up 方向の寸法"""
    L, ax, ay, az = frame_of(p0, p1, up)
    seg = max(1, int(math.ceil(L / seg_len))) if seg_len else 1
    obox(g, mat, (V(p0) + V(p1)) / 2, ax, ay, az, L / 2, w / 2, h / 2, ch=ch, seg=seg, caps=caps)


def post(g, mat, x, y, z0, z1, s=0.15, ch=0.012, seg_len=1.0):
    beam(g, mat, (x, y, z0), (x, y, z1), s, s, up=EX, ch=ch, seg_len=seg_len)


def box(g, mat, x0, x1, y0, y1, z0, z1, ch=0.0, seg_len=0.0):
    """軸にそろった箱（いちばん長い辺を長手に）"""
    c = V(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    h = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]
    axes = [EX, EY, EZ]
    k = int(np.argmax(h))
    o = [i for i in range(3) if i != k]
    seg = max(1, int(math.ceil(2 * h[k] / seg_len))) if seg_len else 1
    obox(g, mat, c, axes[k], axes[o[0]], axes[o[1]], h[k], h[o[0]], h[o[1]], ch=ch, seg=seg)


def quad_grid(g, mat, P, U, W, u0, u1, v0, v1, n_out, step=0.3, holes=(), extra_u=(), extra_v=()):
    """平面の格子（P + U*u + W*v）。holes=[(u0,u1,v0,v1)] は抜く。AO の細かさのため step ごとに分割"""
    P, U, W = V(P), V(U), V(W)
    us = {u0, u1, *extra_u}
    vs = {v0, v1, *extra_v}
    for (a, b, c, d) in holes:
        us.update([a, b])
        vs.update([c, d])
    us = sorted(x for x in us if u0 - 1e-6 <= x <= u1 + 1e-6)
    vs = sorted(x for x in vs if v0 - 1e-6 <= x <= v1 + 1e-6)
    us = _fill(us, step)
    vs = _fill(vs, step)
    idx = {}
    verts, faces = [], []

    def vid(i, j):
        if (i, j) not in idx:
            idx[(i, j)] = len(verts)
            verts.append(P + U * us[i] + W * vs[j])
        return idx[(i, j)]
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if any(a < cu < b and c < cv < d for (a, b, c, d) in holes):
                continue
            faces.append((vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)))
    if faces:
        g.oriented(mat, verts, faces, V(n_out))


def _fill(xs, step):
    out = [xs[0]]
    for b in xs[1:]:
        a = out[-1]
        if b - a < 1e-6:
            continue
        n = max(1, int(math.ceil((b - a) / step - 1e-6)))
        out.extend(a + (b - a) * k / n for k in range(1, n + 1))
    return out


def wall_top_grid(g, mat, P, U, n_out, u0, u1, z0, top, step=0.3, holes=()):
    """上端が top(u) の壁（妻壁の三角も）。縦の帯ごとに下から格子、最後の段は上端に合わせた台形"""
    P, U = V(P), V(U)
    us = {u0, u1}
    for (a, b, c, d) in holes:
        us.update([a, b])
    us = _fill(sorted(x for x in us if u0 - 1e-6 <= x <= u1 + 1e-6), step)
    verts, faces = [], []
    for i in range(len(us) - 1):
        ua, ub = us[i], us[i + 1]
        ta, tb = top(ua), top(ub)
        zs = {z0}
        for (a, b, c, d) in holes:
            if a < (ua + ub) / 2 < b:
                zs.update([c, d])
        zlim = min(ta, tb)
        zs = _fill(sorted(z for z in zs if z < zlim - 1e-4) + [zlim], step)
        cu = (ua + ub) / 2
        for j in range(len(zs) - 1):
            cz = (zs[j] + zs[j + 1]) / 2
            if any(a < cu < b and c < cz < d for (a, b, c, d) in holes):
                continue
            k = len(verts)
            verts += [P + U * ua + EZ * zs[j], P + U * ub + EZ * zs[j], P + U * ub + EZ * zs[j + 1], P + U * ua + EZ * zs[j + 1]]
            faces.append((k, k + 1, k + 2, k + 3))
        if abs(ta - tb) > 1e-4:
            k = len(verts)
            verts += [P + U * ua + EZ * zlim, P + U * ub + EZ * zlim, P + U * ub + EZ * tb, P + U * ua + EZ * ta]
            faces.append((k, k + 1, k + 2) if ta <= zlim + 1e-4 else (k, k + 1, k + 2, k + 3) if tb > zlim + 1e-4 else (k, k + 1, k + 3))
    if faces:
        g.oriented(mat, verts, faces, V(n_out))


_CUBE = None


def _cube_template(n=3):
    """立方体の表面の格子（-1〜1、頂点共有）"""
    global _CUBE
    if _CUBE is not None:
        return _CUBE
    key = {}
    verts, faces = [], []

    def vid(p):
        k = tuple(round(x, 5) for x in p)
        if k not in key:
            key[k] = len(verts)
            verts.append(np.array(p, np.float64))
        return key[k]
    for ax in range(3):
        for s in (-1.0, 1.0):
            o = [i for i in range(3) if i != ax]
            for i in range(n):
                for j in range(n):
                    q = []
                    for (a, b) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        p = [0.0, 0.0, 0.0]
                        p[ax] = s
                        p[o[0]] = -1 + 2 * a / n
                        p[o[1]] = -1 + 2 * b / n
                        q.append(vid(p))
                    faces.append(tuple(q))
    _CUBE = (np.array(verts), faces)
    return _CUBE


def stone(g, mat, c, size, seed, k=3.2, rough=0.06, flat_top=None, flat_bot=True, n=3, yaw=0.0):
    """角の丸い不規則な石（超楕円体＋低い周波数のゆがみ）。flat_top は上面を平らに（礎石）"""
    rng = np.random.default_rng(seed)
    P, faces = _cube_template(n)
    q = P / (np.sum(np.abs(P) ** k, 1, keepdims=True) ** (1 / k))
    hs = np.array(size, np.float64) / 2
    disp = np.zeros(len(q))
    for _ in range(4):
        f = rng.normal(0, 1.6, 3)
        disp += np.sin(q @ f + rng.uniform(0, 6.28)) * rng.uniform(0.3, 1.0)
    dirn = q / np.linalg.norm(q, axis=1, keepdims=True)
    pts = q * hs * (1 + rough * disp[:, None] / 2.0) + dirn * 0.0
    if flat_bot:
        pts[:, 2] = np.maximum(pts[:, 2], -hs[2] * 0.92)
    if flat_top is not None:
        pts[:, 2] = np.minimum(pts[:, 2], hs[2] * flat_top)
    cs, sn = math.cos(yaw), math.sin(yaw)
    x, y = pts[:, 0] * cs - pts[:, 1] * sn, pts[:, 0] * sn + pts[:, 1] * cs
    pts = np.stack([x, y, pts[:, 2]], 1) + np.array(c)
    g.convex(mat, [V(p) for p in pts], faces, smooth=False, center=c)


def lathe(g, mat, c, prof, seg=16, smooth=True, cap_top=False, cap_bot=False, staves=False, rng=None, wobble=0.0, a0=0.0):
    """回転体。prof=[(半径, 高さ)] を下から。staves=True は 1 枚ずつ別の島（樽の側板）"""
    c = V(c)
    ang = [a0 + 2 * math.pi * i / seg for i in range(seg + 1)]

    def P(a, r, z):
        return c + V((math.cos(a) * r, math.sin(a) * r, z))
    if staves:
        for i in range(seg):
            dr = (rng.normal(0, wobble) if rng is not None else 0.0)
            verts, faces = [], []
            for (r, z) in prof:
                verts += [P(ang[i], r + dr, z), P(ang[i + 1], r + dr, z)]
            for j in range(len(prof) - 1):
                a = 2 * j
                faces.append((a, a + 1, a + 3, a + 2))
            mid = (ang[i] + ang[i + 1]) / 2
            g.oriented(mat, verts, faces, V((math.cos(mid), math.sin(mid), 0)), smooth=smooth)
        return
    verts, faces, want = [], [], []
    nr = len(prof)
    for i in range(seg):
        for j, (r, z) in enumerate(prof):
            verts.append(P(ang[i], r, z))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(nr - 1):
            faces.append((i * nr + j, i2 * nr + j, i2 * nr + j + 1, i * nr + j + 1))
            mid = (ang[i] + ang[i + 1]) / 2
            r0, z0 = prof[j]
            r1, z1 = prof[j + 1]
            # 断面の外向き（(dz, -dr) を回す）
            nn = V((math.cos(mid) * (z1 - z0), math.sin(mid) * (z1 - z0), -(r1 - r0)))
            if nn.length < 1e-9:
                nn = V((0, 0, 1 if r1 < r0 else -1))
            want.append(nn)
    if cap_top:
        faces.append(tuple(i * nr + nr - 1 for i in range(seg)))
        want.append(EZ)
    if cap_bot:
        faces.append(tuple(i * nr for i in range(seg)))
        want.append(-EZ)
    g.oriented(mat, verts, faces, want, smooth=smooth)


def torus(g, mat, c, R, r, seg=16, segv=4, axis=EZ, smooth=True, squash=1.0):
    """輪（樽のたが・縄）"""
    c = V(c)
    a = V(axis).normalized()
    t1 = a.cross(EX if abs(a.x) < 0.9 else EY).normalized()
    t2 = a.cross(t1)
    verts, faces, want = [], [], []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        rad = t1 * math.cos(th) + t2 * math.sin(th)
        for j in range(segv):
            ph = 2 * math.pi * j / segv
            verts.append(c + rad * (R + r * math.cos(ph)) + a * (r * squash * math.sin(ph)))
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(segv):
            j2 = (j + 1) % segv
            f = (i * segv + j, i2 * segv + j, i2 * segv + j2, i * segv + j2)
            faces.append(f)
            th = 2 * math.pi * (i + 0.5) / seg
            ph = 2 * math.pi * (j + 0.5) / segv
            rad = t1 * math.cos(th) + t2 * math.sin(th)
            want.append(rad * math.cos(ph) + a * math.sin(ph))
    g.oriented(mat, verts, faces, want, smooth=smooth)


def cylinder(g, mat, p0, p1, r, seg=8, smooth=True, caps=(True, True)):
    L, ax, ay, az = frame_of(p0, p1, EZ if abs((V(p1) - V(p0)).normalized().z) < 0.9 else EX)
    verts, faces, want = [], [], []
    for k, p in enumerate((V(p0), V(p1))):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(p + ay * (r * math.cos(a)) + az * (r * math.sin(a)))
    for i in range(seg):
        i2 = (i + 1) % seg
        faces.append((i, i2, seg + i2, seg + i))
        a = 2 * math.pi * (i + 0.5) / seg
        want.append(ay * math.cos(a) + az * math.sin(a))
    if caps[0]:
        faces.append(tuple(range(seg)))
        want.append(-ax)
    if caps[1]:
        faces.append(tuple(seg + i for i in range(seg)))
        want.append(ax)
    g.oriented(mat, verts, faces, want, smooth=smooth)
    # 端の面はなめらかにしない
    p = g.parts[mat]
    ncap = int(caps[0]) + int(caps[1])
    for i in range(1, ncap + 1):
        p['sm'][-i] = False


def extrude_outline(g, mat, pts2, origin, U, W, depth, D):
    """2D の輪郭（U,W 平面、反時計回り）を D 方向へ depth だけ押し出す（鬼瓦・懸魚）"""
    O, U, W, D = V(origin), V(U), V(W), V(D)
    n = len(pts2)
    front = [O + U * a + W * b for (a, b) in pts2]
    back = [p + D * depth for p in front]
    verts = front + back
    fn = U.cross(W)
    faces = [tuple(range(n)), tuple(n + i for i in reversed(range(n)))]
    want = [fn if fn.dot(-D) >= 0 else -fn, None]
    want[1] = -want[0]
    # 側面：辺の外向き
    area = sum(pts2[i][0] * pts2[(i + 1) % n][1] - pts2[(i + 1) % n][0] * pts2[i][1] for i in range(n))
    s = 1 if area > 0 else -1
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        e = V((pts2[j][0] - pts2[i][0], pts2[j][1] - pts2[i][1]))
        out2 = V((e.y, -e.x)) * s
        want.append(U * out2.x + W * out2.y)
    g.oriented(mat, verts, faces, want)


# ---------------------------------------------------------------------------
# 屋根（瓦・棟・鬼瓦・垂木・破風）
# ---------------------------------------------------------------------------

# 桟瓦の断面（幅の割合, 高さ m）：左の浅い谷 → 右の山（次の瓦の谷に重なる）。両端 0 でつながる
SAN = [(0.0, 0.0), (0.2, -0.024), (0.45, -0.027), (0.66, 0.002), (0.83, 0.036), (1.0, 0.0)]


def _rot_about(v, c, axis, ang):
    return c + Matrix.Rotation(ang, 3, axis) @ (v - c)


def tile_field(g, O, A, D, N, width, length, *, tw=0.27, tl=0.26, t=0.036, ov=0.07, seed=0,
               eave_drop=0.04, eave_proj=0.05, manju=True, verge=(True, True), top_skip=0.0, mat='tile_ibushi',
               manju_mat='tile_manju', manju_d=0.105, bottom_step=True):
    """
    桟瓦の屋根面。O は棟側・幅の始まりの角（瓦の下地面）、A は軒と平行、D は流れの下向き、N は面の法線（上）。
    1 枚ずつ別の島（色むら・高さ ±4 mm と向きのずれ）。t は瓦の尻の持ち上がり（列の段差 約 2.8 cm の陰の筋になる）。
    一番下の列は軒瓦（4 cm の垂れ＋径 manju_d の暗い瓦当、働き幅 tw ごと）。verge は左右の端の袖瓦。
    """
    O, A, D, N = V(O), V(A).normalized(), V(D).normalized(), V(N).normalized()
    rng = np.random.default_rng(seed)
    ncol = max(1, int(round(width / tw)))
    tw = width / ncol
    nc = int(math.ceil((length - top_skip) / tl))
    s_top = A.cross(D).dot(N) >= 0
    manju_mat = manju_mat or mat
    for c in range(ncol):
        for r in range(nc):
            s1 = length - r * tl + (eave_proj if r == 0 else 0.0)
            s0 = max(top_skip - 0.02, length - (r + 1) * tl - ov)
            if s1 - s0 < 0.04:
                continue
            drop = eave_drop if r == 0 else 0.004
            verts = []
            for (pw, h) in SAN:
                verts.append(O + A * ((c + pw) * tw) + D * s0 + N * h)
            for (pw, h) in SAN:
                verts.append(O + A * ((c + pw) * tw) + D * s1 + N * (h + t))
            m = len(SAN)
            # 尻の面は上面と頂点を分ける（上面をなめらかにしても角が丸まらないように）
            for (pw, h) in SAN:
                verts.append(O + A * ((c + pw) * tw) + D * s1 + N * (h + t))
            hmin = min(h for (_, h) in SAN)
            for (pw, h) in SAN:
                # 軒瓦の垂れは下の縁がまっすぐ
                verts.append(O + A * ((c + pw) * tw) + D * s1 + N * ((hmin - drop) if r == 0 else (h - drop)))
            faces = []
            for k in range(m - 1):
                f = (k, k + 1, m + k + 1, m + k)
                faces.append(f if s_top else tuple(reversed(f)))
            want = [N] * len(faces)
            for k in range(m - 1):
                faces.append((2 * m + k, 2 * m + k + 1, 3 * m + k + 1, 3 * m + k))
                want.append(D)
            # 1 枚ずつのずれ：高さ ±4 mm、面内の回り ±0.7°、横の傾き（長手の軸まわり）±1°、流れ方向 ±4 mm
            cc = O + A * ((c + 0.5) * tw) + D * ((s0 + s1) / 2)
            ang = rng.uniform(-1, 1) * math.radians(0.7)
            roll = rng.uniform(-1, 1) * math.radians(1.0)
            lift = rng.uniform(-0.004, 0.004) if r > 0 else rng.uniform(-0.0015, 0.0025)
            sl = rng.uniform(-0.004, 0.004)
            verts = [_rot_about(_rot_about(v, cc, N, ang), cc, D, roll) + N * lift + D * sl for v in verts]
            g.oriented(mat, verts, faces, want, smooth=True)
            if r == 0 and manju:
                # 瓦当（丸い面）：山の位置。上端が山の上端と揃う高さ（瓦の上に出っ張らない）
                rad = manju_d / 2
                crest = max(h for (_, h) in SAN) + t
                cu = O + A * ((c + 0.83) * tw) + D * (s1 + sl) + N * (crest + 0.004 - rad + lift)
                cylinder(g, manju_mat, cu - D * 0.02, cu + D * 0.012, rad, seg=10, smooth=True, caps=(False, True))
    # 袖瓦（端の丸い縁と垂れ）
    prof = [(-0.035, -0.115), (-0.035, 0.035), (-0.012, 0.068), (0.04, 0.08), (0.10, 0.066), (0.165, 0.03)]
    for side, on in ((0, verge[0]), (1, verge[1])):
        if not on:
            continue
        for r in range(nc):
            s1 = length - r * tl + (eave_proj + 0.01 if r == 0 else 0.0)
            s0 = max(top_skip - 0.02, length - (r + 1) * tl - ov)
            if s1 - s0 < 0.04:
                continue
            pts = [(u if side == 0 else width - u, h) for (u, h) in prof]
            verts = [O + A * u + D * s0 + N * h for (u, h) in pts]
            verts += [O + A * u + D * s1 + N * (h + t) for (u, h) in pts]
            verts += [O + A * u + D * s1 + N * (h - 0.004 - (0.03 if r == 0 else 0.0)) for (u, h) in pts]
            m = len(pts)
            faces, want = [], []
            for k in range(m - 1):
                faces.append((k, k + 1, m + k + 1, m + k))
                # 外向き：断面の法線
                du, dh = pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]
                nn = A * (-dh) + N * du
                if side == 1:
                    nn = -nn
                want.append(nn)
            for k in range(m - 1):
                faces.append((m + k, m + k + 1, 2 * m + k + 1, 2 * m + k))
                want.append(D)
            g.oriented(mat, verts, faces, want)


def ridge(g, P0, P1, zb, p, layers, seed, *, w0=0.36, lh=0.042, cap_r=0.1, oni=True, oni_scale=1.0, menado=True,
          mat='tile_ibushi'):
    """
    棟：面戸の漆喰、のし瓦の段（上ほど細く）、冠瓦（半円）、両端の鬼瓦。
    P0→P1 は棟の線（X, Y は家の座標、Z は瓦の下地の棟の高さ zb）、p は勾配。
    """
    rng = np.random.default_rng(seed)
    P0, P1 = V(P0), V(P1)
    L, ax, ay, az = frame_of(P0, P1, EZ)
    xr = P0.x
    y0, y1 = min(P0.y, P1.y), max(P0.y, P1.y)
    # 面戸（白い漆喰の帯）
    if menado:
        box(g, 'plaster_white', xr - w0 / 2 - 0.03, xr + w0 / 2 + 0.03, y0 + 0.06, y1 - 0.06, zb - p * 0.24, zb + 0.02, seg_len=0.5)
    z = zb + 0.02
    for k in range(layers):
        w = w0 - 0.024 * k
        n = max(1, int(round((y1 - y0 - 0.1) / 0.3)))
        pl = (y1 - y0 - 0.1) / n
        for i in range(n):
            ya = y0 + 0.05 + i * pl - 0.004
            yb = ya + pl + 0.008
            dx = rng.normal(0, 0.003)
            dz = rng.normal(0, 0.0015)
            box(g, mat, xr - w / 2 + dx, xr + w / 2 + dx, ya, yb, z + dz, z + dz + lh - 0.004)
        z += lh
    # 冠瓦
    n = max(1, int(round((y1 - y0) / 0.32)))
    pl = (y1 - y0) / n
    rcap = cap_r
    for i in range(n):
        ya = y0 + i * pl - 0.01
        yb = ya + pl + 0.02
        verts, faces, want = [], [], []
        segs = 7
        for j, yy in enumerate((ya, yb)):
            for s in range(segs + 1):
                a = math.pi * s / segs
                verts.append(V((xr + math.cos(a) * rcap, yy, z - 0.02 + math.sin(a) * rcap * 0.8)))
        for s in range(segs):
            faces.append((s, s + 1, segs + 1 + s + 1, segs + 1 + s))
            a = math.pi * (s + 0.5) / segs
            want.append(V((math.cos(a), 0, math.sin(a))))
        g.oriented(mat, verts, faces, want, smooth=True)
        # 継ぎ目の小さな段（重なりの縁）
        verts2 = []
        for s in range(segs + 1):
            a = math.pi * s / segs
            verts2 += [V((xr + math.cos(a) * (rcap + 0.012), yb - 0.03, z - 0.02 + math.sin(a) * (rcap * 0.8 + 0.01))),
                       V((xr + math.cos(a) * (rcap + 0.012), yb + 0.005, z - 0.02 + math.sin(a) * (rcap * 0.8 + 0.01)))]
        f2, w2 = [], []
        for s in range(segs):
            f2.append((2 * s, 2 * s + 2, 2 * s + 3, 2 * s + 1))
            a = math.pi * (s + 0.5) / segs
            w2.append(V((math.cos(a), 0, math.sin(a))))
        if i < n - 1:
            g.oriented(mat, verts2, f2, w2, smooth=True)
    ztop = z - 0.02 + rcap * 0.8
    # 鬼瓦
    if oni:
        s = oni_scale
        H = (ztop - zb) + 0.2 * s
        hw = (w0 / 2 + 0.07) * s
        outline = [(-hw, -p * hw + 0.02), (0.0, 0.0), (hw, -p * hw + 0.02),
                   (hw, H * 0.45), (hw + 0.05 * s, H * 0.52), (hw + 0.03 * s, H * 0.62), (hw - 0.05 * s, H * 0.64),
                   (hw * 0.62, H * 0.86), (hw * 0.3, H * 0.97), (0.0, H), (-hw * 0.3, H * 0.97), (-hw * 0.62, H * 0.86),
                   (-hw + 0.05 * s, H * 0.64), (-hw - 0.03 * s, H * 0.62), (-hw - 0.05 * s, H * 0.52), (-hw, H * 0.45)]
        # 底の辺は屋根の面に沿って（中央は棟の下地）
        for yy, sgn in ((y0, -1), (y1, 1)):
            O = V((xr, yy + sgn * 0.02, zb))
            extrude_outline(g, mat, outline, O, EX, EZ, 0.11, V((0, -sgn, 0)))
            # 表の丸い飾り（巴の代わりの輪）
            cc = O + EZ * (H * 0.55)
            cylinder(g, mat, cc, cc + V((0, sgn * 0.03, 0)), 0.085 * s, seg=12)
            torus(g, mat, cc + V((0, sgn * 0.02, 0)), 0.13 * s, 0.014, seg=16, segv=4, axis=V((0, 1, 0)))
    return ztop


def rafters(g, mat, ys, x_in, x_out, zb_at, N, D, *, w=0.055, h=0.072, off=0.06):
    """垂木：Y の各位置で、X が x_in から x_out まで。zb_at(X) は瓦の下地の高さ。N,D は屋根の法線と流れ"""
    for y in ys:
        a = V((x_in, y, zb_at(x_in))) - N * (off + h / 2)
        b = V((x_out, y, zb_at(x_out))) - N * (off + h / 2)
        beam(g, mat, a, b, w, h, up=N, ch=0.0)


def roof_sandwich(g, x_wall, x_edge, y0, y1, zb_at, N, D, *, deck='wood_weathered', fascia='wood_dark',
                  rafter='wood_dark', spacing=0.45, board_w=0.22, seed=0, rw=0.055, rh=0.072, kaya=None):
    """
    軒の下：垂木・野地板（下から見える）・茅負（垂木の先の横板）・面戸板。
    kaya=dict(h=茅負の高さ, d=奥行き, board=(広小舞の高さ, 奥行き), proud=広小舞の出) で二重の鼻先（茅負＋広小舞）。
    """
    sgn = 1 if x_edge > x_wall else -1
    ov = abs(x_edge - x_wall)
    n = max(2, int(round((y1 - y0) / spacing)))
    ys = [y0 + 0.05 + (y1 - y0 - 0.1) * i / n for i in range(n + 1)]
    x_raf = x_edge - sgn * (0.01 if kaya is None else kaya['d'] * 0.5)
    rafters(g, rafter, ys, x_wall - sgn * 0.12, x_raf, zb_at, N, D, w=rw, h=rh)
    # 野地板（軒と平行の板）
    nb = max(1, int(math.ceil((ov + 0.1) / board_w)))
    bw = (ov + 0.1) / nb
    rng = np.random.default_rng(seed)
    for i in range(nb):
        xa = x_wall - sgn * 0.1 + sgn * bw * i
        xb = xa + sgn * bw
        xm = (xa + xb) / 2
        c = V((xm, (y0 + y1) / 2, zb_at(xm))) - N * (0.05 + rng.uniform(-0.002, 0.002))
        obox(g, deck, c, EY, D, N, (y1 - y0) / 2, bw / 2 - 0.004, 0.01, seg=max(1, int((y1 - y0) / 1.2)))
    segy = max(1, int((y1 - y0) / 1.2))
    if kaya is None:
        # 茅負（垂木の先）
        xe = x_edge - sgn * 0.005
        c = V((xe, (y0 + y1) / 2, zb_at(xe))) - N * 0.035
        obox(g, fascia, c, EY, D, N, (y1 - y0) / 2 + 0.02, 0.025, 0.045, ch=0.006, seg=segy)
    else:
        # 二重の鼻先：上に広小舞（薄い板、少し前へ出す）、その下に背の高い茅負（垂木の先に載る）。間に陰の筋
        bh, bd = kaya['board']
        kh, kd = kaya['h'], kaya['d']
        pr = kaya.get('proud', 0.02)
        top = kaya.get('top', 0.04)          # 広小舞の上端（瓦の下地からの下がり）
        Dh = V((D.x, 0, 0)).normalized()     # 水平の外向き
        xb_ = x_edge + sgn * pr - sgn * bd / 2
        c = V((xb_, (y0 + y1) / 2, zb_at(xb_) - top - bh / 2))
        obox(g, fascia, c, EY, Dh, EZ, (y1 - y0) / 2 + 0.03, bd / 2, bh / 2, ch=0.004, seg=segy)
        xk = x_edge - sgn * kd / 2
        c = V((xk, (y0 + y1) / 2, zb_at(xk) - top - bh - 0.004 - kh / 2))
        obox(g, fascia, c, EY, Dh, EZ, (y1 - y0) / 2 + 0.02, kd / 2, kh / 2, ch=0.008, seg=segy)
    # 面戸板（壁の上、垂木のあいだ）
    c = V((x_wall + sgn * 0.02, (y0 + y1) / 2, zb_at(x_wall + sgn * 0.02))) - N * (0.06 + rh / 2)
    obox(g, 'plaster_white', c, EY, D, N, (y1 - y0) / 2, 0.02, rh / 2 + 0.005, seg=max(1, int((y1 - y0) / 1.0)))


def gable_edge(g, yv, sgn, x_a, x_b, zb_at, *, h=0.24, t=0.04, mat='wood_dark', soffit='wood_weathered', y_wall=None,
               purlins=(), p_size=0.12, N_of=None):
    """
    妻の端：破風板（勾配に沿った幅の広い板）と、けらばの下の板・母屋の木口。
    yv は破風の外面の Y、sgn は外向き（+1/-1）、x_a→x_b は破風の範囲（棟から軒へ）。
    """
    pa = V((x_a, yv - sgn * t / 2, zb_at(x_a) - 0.02 - h / 2))
    pb = V((x_b, yv - sgn * t / 2, zb_at(x_b) - 0.02 - h / 2))
    beam(g, mat, pa, pb, t, h, up=EZ, ch=0.006, seg_len=0.8)
    if y_wall is not None:
        # けらばの軒裏（板）
        L = abs(x_b - x_a)
        n = max(1, int(math.ceil(L / 0.6)))
        for i in range(n):
            xa = x_a + (x_b - x_a) * i / n
            xb = x_a + (x_b - x_a) * (i + 1) / n
            ya, yb = sorted((y_wall, yv - sgn * t))
            za, zb2 = zb_at(xa) - 0.075, zb_at(xb) - 0.075
            verts = [V((xa, ya, za)), V((xb, ya, zb2)), V((xb, yb, zb2)), V((xa, yb, za))]
            g.oriented(soffit, verts, [(0, 1, 2, 3)], -EZ)
        for (xp, zp) in purlins:
            ya, yb = sorted((y_wall - sgn * 0.3, yv - sgn * (t + 0.01)))
            beam(g, 'wood_dark', (xp, ya, zp), (xp, yb, zp), p_size, p_size, up=EZ, ch=0.01)


def gegyo(g, c, sgn, s=1.0, mat='wood_dark'):
    """懸魚（妻の頂の下がる飾り板）。c は上端の中心"""
    pts = [(-0.10, 0.0), (0.10, 0.0), (0.16, -0.10), (0.12, -0.24), (0.0, -0.32), (-0.12, -0.24), (-0.16, -0.10)]
    pts = [(a * s, b * s) for (a, b) in pts]
    extrude_outline(g, mat, pts, V(c), EX, EZ, 0.035, V((0, -sgn, 0)))
    cc = V(c) + EZ * (-0.15 * s) + V((0, sgn * 0.005, 0))
    cylinder(g, mat, cc, cc + V((0, sgn * 0.025, 0)), 0.045 * s, seg=8)


# ---------------------------------------------------------------------------
# 壁（真壁：柱・貫・漆喰・腰板）
# ---------------------------------------------------------------------------

class Wall:
    """
    家の座標で 1 面の壁。P0 は壁の線の始まり（床の高さ 0）、U は壁に沿った向き、n は外向き。
    u の範囲 [0, L]。外面の位置（n 方向のずれ）: 柱の中心 0、柱の面 +s/2、漆喰 +s/2-0.03、腰板 +s/2+0.02。
    """

    def __init__(self, g, P0, U, n, L, s=0.15):
        self.g, self.P0, self.U, self.n, self.L, self.s = g, V(P0), V(U).normalized(), V(n).normalized(), L, s

    def at(self, u, z, d=0.0):
        return self.P0 + self.U * u + EZ * z + self.n * d

    def plinth(self, u0=None, u1=None, h=0.16, depth=0.24, seed=0, piece=0.9, skip=(), mat='stone_granite'):
        """根石（花崗岩の長い縁石）"""
        u0 = 0.0 if u0 is None else u0
        u1 = self.L if u1 is None else u1
        rng = np.random.default_rng(seed)
        u = u0 - 0.06
        k = 0
        while u < u1 + 0.05:
            ln = min(piece * rng.uniform(0.75, 1.25), u1 + 0.06 - u)
            if ln < 0.12:
                break
            um = u + ln / 2
            if not any(a < um < b for (a, b) in skip):
                c = self.at(um, h / 2 - 0.05, 0.035)
                yaw = math.atan2(self.U.y, self.U.x)
                stone(self.g, mat, c, (ln - 0.012, depth, h + 0.1), seed * 101 + k, k=5.0, rough=0.035,
                      flat_top=0.97, n=2, yaw=yaw)
            u += ln
            k += 1

    def sill(self, u0, u1, z=0.11, h=0.13, w=None):
        w = w or self.s
        beam(self.g, 'wood_dark', self.at(u0, z + h / 2), self.at(u1, z + h / 2), w, h, ch=0.012, seg_len=1.2)

    def post(self, u, z0, z1, s=None, mat='wood_dark'):
        s = s or self.s
        p = self.at(u, 0)
        beam(self.g, mat, (p.x, p.y, z0), (p.x, p.y, z1), s, s, up=self.n, ch=0.012, seg_len=1.0)

    def hbeam(self, u0, u1, z0, z1, d=0.0, w=None, mat='wood_dark'):
        """横材（貫・差鴨居・胴差）。z0〜z1 の高さ、d は外へのずれ"""
        w = w or self.s * 0.8
        zc = (z0 + z1) / 2
        beam(self.g, mat, self.at(u0, zc, d), self.at(u1, zc, d), w, z1 - z0, up=EZ, ch=0.01, seg_len=1.2)

    def plaster(self, u0, u1, z0, top, holes=(), mat='plaster_white', step=0.3, d=None):
        """漆喰の面（top は数か u の関数）"""
        d = self.s / 2 - 0.03 if d is None else d
        tf = top if callable(top) else (lambda u, t=top: t)
        wall_top_grid(self.g, mat, self.P0 + self.n * d, self.U, self.n, u0, u1, z0, tf, step=step, holes=holes)

    def boards(self, u0, u1, z0, z1, seed=0, bw=0.19, t=0.016, battens=True, mat='wood_weathered', cap=True, d=None):
        """腰板（縦の板を 1 枚ずつ）と押縁・上の水切り"""
        rng = np.random.default_rng(seed)
        d = self.s / 2 + 0.012 if d is None else d
        n = max(1, int(round((u1 - u0) / bw)))
        w = (u1 - u0) / n
        for i in range(n):
            ua = u0 + i * w
            jit = rng.uniform(-0.003, 0.003)
            c = self.at(ua + w / 2, (z0 + z1) / 2, d + jit)
            obox(self.g, mat, c, EZ, self.U, self.n, (z1 - z0) / 2, w / 2 - 0.002, t / 2, seg=max(1, int((z1 - z0) / 0.5)))
            if battens and i > 0 and i % 2 == 0:
                c = self.at(ua, (z0 + z1) / 2, d + t / 2 + 0.012)
                obox(self.g, 'wood_dark', c, EZ, self.U, self.n, (z1 - z0) / 2, 0.018, 0.012, ch=0.004,
                     seg=max(1, int((z1 - z0) / 0.5)))
        if cap:
            beam(self.g, 'wood_dark', self.at(u0 - 0.02, z1 + 0.02, d + 0.01), self.at(u1 + 0.02, z1 + 0.02, d + 0.01),
                 0.05, 0.04, ch=0.008, seg_len=0.8)

    def backing(self, u0, u1, z0, z1, d=-0.12, mat='plaster_white#0.4'):
        """開口の奥の面（窓の奥が抜けないように）"""
        quad_grid(self.g, mat, self.P0 + self.n * d, self.U, EZ, u0 - 0.05, u1 + 0.05, z0 - 0.05, z1 + 0.05, self.n, step=0.3)

    def frame(self, u0, u1, z0, z1, w=0.05, d=0.06, dz=None, mat='wood_dark'):
        """開口の枠（4 本）"""
        dz = self.s / 2 - 0.01 if dz is None else dz
        beam(self.g, mat, self.at(u0 - w, z0 - w / 2, dz), self.at(u1 + w, z0 - w / 2, dz), d, w, up=EZ, ch=0.006)
        beam(self.g, mat, self.at(u0 - w, z1 + w / 2, dz), self.at(u1 + w, z1 + w / 2, dz), d, w, up=EZ, ch=0.006)
        for u in (u0 - w / 2, u1 + w / 2):
            p = self.at(u, 0, dz)
            beam(self.g, mat, (p.x, p.y, z0), (p.x, p.y, z1), w, d, up=self.n, ch=0.006)

    def lattice(self, u0, u1, z0, z1, *, mat='wood_bengara', kind='oyako', pitch=0.12, d=None, rails=True, bar=(0.034, 0.05),
                ko=(0.016, 0.03), ko_stop=0.35, seed=0):
        """
        格子。oyako（親子格子：太い親の間に細い子を 2 本、子は下の少し上で止まる）/ plain（同じ太さ）/ grid（縦横）。
        """
        d = self.s / 2 + 0.02 if d is None else d
        n = max(1, int(round((u1 - u0) / pitch)))
        pw = (u1 - u0) / n
        for i in range(1, n):
            p = self.at(u0 + i * pw, 0, d)
            beam(self.g, mat, (p.x, p.y, z0), (p.x, p.y, z1), bar[0], bar[1], up=self.n, ch=0.0, seg_len=1.2)
            if kind == 'oyako':
                for k in (1, 2):
                    q = self.at(u0 + (i - 1) * pw + k * pw / 3, 0, d - 0.005)
                    beam(self.g, mat, (q.x, q.y, z0 + ko_stop), (q.x, q.y, z1), ko[0], ko[1], up=self.n, ch=0.0, seg_len=1.2)
        if kind == 'oyako':
            for k in (1, 2):
                q = self.at(u0 + (n - 1) * pw + k * pw / 3, 0, d - 0.005)
                beam(self.g, mat, (q.x, q.y, z0 + ko_stop), (q.x, q.y, z1), ko[0], ko[1], up=self.n, ch=0.0, seg_len=1.2)
        if kind == 'grid':
            m = max(1, int(round((z1 - z0) / pitch)))
            for j in range(1, m):
                z = z0 + (z1 - z0) * j / m
                beam(self.g, mat, self.at(u0, z, d - 0.008), self.at(u1, z, d - 0.008), bar[1] * 0.8, bar[0], up=EZ, ch=0.0)
        if rails:
            for z in (z0, z1):
                beam(self.g, mat, self.at(u0, z, d), self.at(u1, z, d), 0.06, 0.055, up=EZ, ch=0.008)
            for u in (u0, u1):
                p = self.at(u, 0, d)
                beam(self.g, mat, (p.x, p.y, z0), (p.x, p.y, z1), 0.05, 0.06, up=self.n, ch=0.008)

    def shoji(self, u0, u1, z0, z1, d=-0.1, panels=2, koshi=0.0, koshi_mat='wood_dark'):
        """障子（紙と桟）。格子の奥に。koshi>0 は下に腰板（板の腰付き障子）"""
        if koshi > 0:
            quad_grid(self.g, koshi_mat, self.P0 + self.n * d, self.U, EZ, u0, u1, z0, z0 + koshi, self.n, step=0.5)
            beam(self.g, 'wood_dark', self.at(u0, z0 + koshi, d + 0.012), self.at(u1, z0 + koshi, d + 0.012), 0.03, 0.03, up=EZ, ch=0.0)
            z0 = z0 + koshi
        quad_grid(self.g, 'paper_shoji', self.P0 + self.n * d, self.U, EZ, u0, u1, z0, z1, self.n, step=0.5)
        m = max(2, int(round((z1 - z0) / 0.3)))
        for j in range(1, m):
            z = z0 + (z1 - z0) * j / m
            beam(self.g, 'wood_fresh', self.at(u0, z, d + 0.01), self.at(u1, z, d + 0.01), 0.018, 0.015, up=EZ, ch=0.0)
        for k in range(panels + 1):
            u = u0 + (u1 - u0) * k / panels
            p = self.at(u, 0, d + 0.012)
            beam(self.g, 'wood_fresh', (p.x, p.y, z0), (p.x, p.y, z1), 0.035, 0.025, up=self.n, ch=0.0)

    def mushiko(self, u0, u1, z0, z1, pitch=0.105, bar=0.05, d=None):
        """虫籠窓：漆喰で塗り込めた縦の太い格子と、丸みのある額縁。d は漆喰の面の位置"""
        g = self.g
        d = self.s / 2 - 0.03 if d is None else d
        # 額縁（漆喰の縁取り、少し出す）
        fw = 0.07
        for (a, b, c, e) in ((u0 - fw, u1 + fw, z0 - fw, z0), (u0 - fw, u1 + fw, z1, z1 + fw)):
            beam(g, 'plaster_white', self.at(a, (c + e) / 2, d + 0.03), self.at(b, (c + e) / 2, d + 0.03), 0.06, e - c, up=EZ, ch=0.02)
        for u in (u0 - fw / 2, u1 + fw / 2):
            p = self.at(u, 0, d + 0.03)
            beam(g, 'plaster_white', (p.x, p.y, z0), (p.x, p.y, z1), fw, 0.06, up=self.n, ch=0.02)
        n = max(2, int(round((u1 - u0) / pitch)))
        pw = (u1 - u0) / n
        for i in range(1, n):
            p = self.at(u0 + i * pw, 0, d + 0.01)
            beam(g, 'plaster_white', (p.x, p.y, z0 - 0.01), (p.x, p.y, z1 + 0.01), bar, bar * 1.2, up=self.n, ch=bar * 0.35)
        self.backing(u0, u1, z0, z1, d=d - 0.14)



def sag(g, y0, y1, z_from, amount):
    """
    大屋根のわずかなたるみ（棟と軒が中ほどで amount だけ下がる）。完全な直線の「模型らしさ」を消すため。
    z_from（桁の下あたり）より上の頂点だけを、高さに応じてなめらかに動かす（壁・柱の上端は少しだけ）。
    """
    ym = (y0 + y1) / 2
    hl = (y1 - y0) / 2
    for p in g.parts.values():
        for v in p['v']:
            w = min(1.0, max(0.0, (v.z - (z_from - 0.3)) / 0.5))
            if w <= 0:
                continue
            w = w * w * (3 - 2 * w)
            t = min(1.0, abs(v.y - ym) / hl)
            v.z -= amount * (1 - t * t) * w

# ---------------------------------------------------------------------------
# 小物（縁台・樽・籠・俵・箱・看板）
# ---------------------------------------------------------------------------

def bench(g, c, yaw, L=1.8, W=0.42, H=0.42, seed=0, mat='wood_aged'):
    """縁台（床几）：2 枚の天板（角のすり減った丸み・わずかな反りと段違い）、4 本の脚（少し開く）、貫"""
    c = V(c)
    rng = np.random.default_rng(seed)
    R = Matrix.Rotation(yaw, 3, 'Z')

    def P(x, y, z):
        return c + R @ V((x, y, z))
    ux, uy = R @ EX, R @ EY
    for k, y in enumerate((-W / 4, W / 4)):
        cc = P(rng.uniform(-0.015, 0.015), y + rng.uniform(-0.004, 0.004), H - 0.021 + rng.uniform(-0.003, 0.002))
        ax = (R @ Matrix.Rotation(rng.uniform(-0.006, 0.006), 3, 'Z') @ EX)
        obox(g, mat, cc, ax, uy, EZ, L / 2, W / 4 - 0.006, 0.021, ch=0.009, seg=3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = P(sx * (L / 2 - 0.16), sy * (W / 2 - 0.07), H - 0.04)
            bot = P(sx * (L / 2 - 0.12), sy * (W / 2 - 0.03), 0.0)
            beam(g, mat, bot, top, 0.055, 0.055, up=ux, ch=0.01)
        # 脚の間の貫
        a = P(sx * (L / 2 - 0.145), -W / 2 + 0.05, 0.16)
        b = P(sx * (L / 2 - 0.145), W / 2 - 0.05, 0.16)
        beam(g, mat, a, b, 0.035, 0.05, up=EZ, ch=0.007)
    beam(g, mat, P(-L / 2 + 0.16, 0, H - 0.08), P(L / 2 - 0.16, 0, H - 0.08), 0.04, 0.06, up=EZ, ch=0.008)


def barrel(g, c, r=0.24, h=0.55, seed=0, lid=True, mat='wood_aged', hoop='bamboo#dark', staves=18):
    """樽：側板を 1 枚ずつ（使い込んだ木、わずかにふくらむ）、煤けた竹のたが 3 本、ふた"""
    rng = np.random.default_rng(seed)
    c = V(c)
    prof = [(r * 0.93, 0.0), (r * 0.99, h * 0.3), (r, h * 0.5), (r * 0.99, h * 0.7), (r * 0.95, h)]
    lathe(g, mat, c, prof, seg=staves, staves=True, rng=rng, wobble=0.002, smooth=True)
    # 内側の縁（厚み）と、ふた
    inner = [(r * 0.95, h), (r * 0.88, h), (r * 0.88, h - 0.03)]
    lathe(g, mat, c, inner, seg=staves, smooth=True)
    if lid:
        lathe(g, mat, c, [(r * 0.89, h - 0.02), (r * 0.89, h - 0.005), (0.0, h - 0.005)], seg=staves, smooth=False)
    else:
        lathe(g, mat, c, [(r * 0.88, h - 0.12), (0.0, h - 0.12)], seg=staves, smooth=False)
    for z in (h * 0.14, h * 0.5, h * 0.86):
        rr = np.interp(z, [p[1] for p in prof], [p[0] for p in prof])
        torus(g, hoop, c + EZ * z, rr + 0.01, 0.014, seg=staves, segv=4, squash=1.6)


def basket(g, c, r=0.22, h=0.26, seed=0, mat='straw#olive', rim='straw#olive'):
    """籠：編み目の凹凸（頂点を互い違いに出し入れ）と太い縁"""
    c = V(c)
    seg, rows = 20, 6
    verts, faces, want = [], [], []
    for j in range(rows + 1):
        z = h * j / rows
        rr = r * (0.72 + 0.28 * math.sqrt(j / rows))
        for i in range(seg):
            a = 2 * math.pi * i / seg
            bump = 0.006 * (1 if (i + j) % 2 == 0 else -1)
            verts.append(c + V((math.cos(a) * (rr + bump), math.sin(a) * (rr + bump), z)))
    for j in range(rows):
        for i in range(seg):
            i2 = (i + 1) % seg
            faces.append((j * seg + i, j * seg + i2, (j + 1) * seg + i2, (j + 1) * seg + i))
            a = 2 * math.pi * (i + 0.5) / seg
            want.append(V((math.cos(a), math.sin(a), -0.3)))
    faces.append(tuple(range(seg)))
    want.append(-EZ)
    # 内側（少し小さく）
    k0 = len(verts)
    for j in (rows, 1):
        z = h * j / rows
        rr = r * (0.72 + 0.28 * math.sqrt(j / rows)) - 0.012
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(c + V((math.cos(a) * rr, math.sin(a) * rr, z)))
    for i in range(seg):
        i2 = (i + 1) % seg
        faces.append((k0 + i, k0 + i2, k0 + seg + i2, k0 + seg + i))
        a = 2 * math.pi * (i + 0.5) / seg
        want.append(V((-math.cos(a), -math.sin(a), 0)))
    faces.append(tuple(k0 + seg + i for i in range(seg)))
    want.append(EZ)
    g.oriented(mat, verts, faces, want, smooth=True)
    torus(g, rim, c + EZ * h, r + 0.004, 0.016, seg=seg, segv=4)


def tawara(g, c, yaw, L=0.72, r=0.2, seed=0, mat='straw'):
    """俵：胴（端が丸い）、両端の桟俵、縄の輪 3 本"""
    c = V(c)
    ax = V((math.cos(yaw), math.sin(yaw), 0))
    prof = []
    for k in range(9):
        t = -1 + 2 * k / 8
        prof.append((r * (1 - 0.18 * t ** 4), L / 2 * t))
    # lathe は Z 軸まわりなので、軸を ax に向けた回転で作る
    tmp = Geo()
    lathe(tmp, mat, V((0, 0, 0)), prof, seg=12, smooth=True)
    for s in (-1, 1):
        cylinder(tmp, mat, V((0, 0, s * L / 2 * 0.98)), V((0, 0, s * (L / 2 + 0.015))), r * 0.8, seg=12)
    for z in (-L * 0.3, 0.0, L * 0.3):
        torus(tmp, mat, V((0, 0, z)), r * (1 - 0.18 * (2 * z / L) ** 4) + 0.004, 0.012, seg=12, segv=3)
    Rm = V((0, 0, 1)).rotation_difference(ax).to_matrix()
    for key, p in tmp.parts.items():
        g.add(key, [c + Rm @ v for v in p['v']], p['f'], False)
        g.parts[key]['sm'][-len(p['f']):] = p['sm']


def crate(g, c, yaw, sx, sy, sz, seed=0, mat='wood_fresh'):
    """木箱（板の継ぎ目が見えるよう、側面に 3 枚の板）"""
    c = V(c)
    R = Matrix.Rotation(yaw, 3, 'Z')
    ux, uy = R @ EX, R @ EY
    n = 3
    for k in range(n):
        z = sz * (k + 0.5) / n
        obox(g, mat, c + EZ * z, ux, uy, EZ, sx / 2, sy / 2, sz / (2 * n) - 0.003, ch=0.004)
    obox(g, mat, c + EZ * (sz + 0.01), ux, uy, EZ, sx / 2 + 0.01, sy / 2 + 0.01, 0.012, ch=0.004)


# ---------------------------------------------------------------------------
# 暖簾（自作の画像：藍の麻に白抜きの紋）
# ---------------------------------------------------------------------------

def _load_px(path):
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[..., :3]


def _seg_dist(X, Y, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = np.clip(((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(X - ax - t * dx, Y - ay - t * dy)


def crest_mask(kind, X, Y):
    """自作の紋の形（中心 0,0、メートル）。1 が白抜き"""
    r = np.hypot(X, Y)
    ring = np.abs(r - 0.27) - 0.028
    if kind == 'yama':
        # 丸に山形と一文字（屋号風の抽象形）
        d1 = np.minimum(_seg_dist(X, Y, (-0.16, -0.01), (0.0, 0.12)), _seg_dist(X, Y, (0.0, 0.12), (0.16, -0.01))) - 0.03
        d2 = _seg_dist(X, Y, (-0.13, -0.105), (0.13, -0.105)) - 0.026
        d = np.minimum(ring, np.minimum(d1, d2))
    else:
        # 丸に菱と点
        dm = np.abs(np.abs(X) / 0.14 + np.abs(Y) / 0.17 - 1) * 0.1 - 0.024
        dot = np.hypot(X, Y) - 0.035
        d = np.minimum(ring, np.minimum(dm, dot))
    return d


def noren_material(name, kind, w_m, h_m, px=1536):
    """暖簾の材質（画像を作って保存、節点を組む）。u は横幅、v は下→上"""
    tag = f'{name}_{int(round(w_m * 100))}x{int(round(h_m * 100))}'      # 大きさが変われば作り直す
    alb_p = TEX_OUT / f'{tag}_albedo.png'
    nrm_p = TEX_OUT / f'{tag}_normal.png'
    if not alb_p.exists() or not nrm_p.exists():
        paths = mats.build_textures('cloth_indigo')
        base = _load_px(paths['albedo'])     # 1024 px = 0.3 m
        nb = _load_px(paths['normal'])
        W = px
        H = int(round(px * h_m / w_m / 8)) * 8
        tile_px = base.shape[0]
        # 布目：0.3 m ごとの繰り返しを最近傍で拾う（縦横の比を保つ）
        yy, xx = np.mgrid[0:H, 0:W]
        um = xx / W * w_m
        vm = yy / H * h_m
        iu = ((um / 0.3) * tile_px).astype(np.int64) % tile_px
        iv = ((vm / 0.3) * tile_px).astype(np.int64) % tile_px
        cloth = base[iv, iu]
        lum = cloth.mean(-1, keepdims=True)
        # 紋（上から 42% の位置）
        cx, cy = w_m / 2, h_m * 0.58
        rng = np.random.default_rng(7)
        wob = mats.snoise((H, W), 17, 8, 90, 1.2) * 0.004
        d = crest_mask(kind, um - cx + wob, vm - cy + wob)
        m = np.clip(0.5 - d / 0.004, 0, 1)[..., None]
        white = np.array([0.80, 0.80, 0.76], np.float32)[None, None, :] * (0.78 + 0.22 * lum / max(1e-3, float(lum.mean())))
        # 裾と両端のすこしの色あせ
        fade = np.clip(1 - vm / 0.12, 0, 1)[..., None] * 0.10 + np.clip(1 - np.minimum(um, w_m - um) / 0.05, 0, 1)[..., None] * 0.06
        col = cloth * (1 + fade * 0.9)
        col = col * (1 - m) + np.clip(white, 0, 1) * m
        _ = rng
        mats._save_png(alb_p, col)
        # 法線：布の法線を同じ繰り返しで（1024 px）
        Hn, Wn = H // 2, W // 2
        yy, xx = np.mgrid[0:Hn, 0:Wn]
        iu = ((xx / Wn * w_m / 0.3) * tile_px).astype(np.int64) % tile_px
        iv = ((yy / Hn * h_m / 0.3) * tile_px).astype(np.int64) % tile_px
        mats._save_png(nrm_p, nb[iv, iu])
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = bpy.data.images.load(str(alb_p), check_existing=True)
    ta.image.colorspace_settings.name = 'sRGB'
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = mats.COLOR_ATTR
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1.0
    a, b, o = mats._mix_sockets(mx)
    nt.links.new(ta.outputs['Color'], a)
    nt.links.new(vc.outputs['Color'], b)
    nt.links.new(o, bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = bpy.data.images.load(str(nrm_p), check_existing=True)
    tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    m['koto_custom'] = 'noren'
    return m


def flat_material(name, rgb, rough=0.6, metal=0.0):
    """画像なしの単色（小さな金具など）"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = mats.COLOR_ATTR
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1.0
    a, b, o = mats._mix_sockets(mx)
    a.default_value = (*[(c / 255.0) ** 2.2 for c in rgb], 1.0)
    nt.links.new(vc.outputs['Color'], b)
    nt.links.new(o, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m['koto_custom'] = 'flat'
    return m


def noren(g, key, P, U, n_out, width, length, panels, *, seed=0, sway=0.03, pole_r=0.022, pole_mat='bamboo', gap=0.006,
          fold=0.022, fold_top=0.004, nu=9, nv=16):
    """
    暖簾：竿（竹）と、上の袋（竿を通す筒）、panels 枚の布。布は厚み 5 mm（表裏と縁）、縦のひだと裾のわずかなふくらみ。
    P は竿の中心の左端（家の座標）、U は幅の向き、n_out は外向き。UV は幅と長さ全体で 0〜1（紋が布の切れ目をまたぐ）。
    gap は布どうしのすき間、fold は裾のひだの振れ（上端は fold_top）。
    UV は後で set_uv_noren で入れるので、ここでは頂点に (u, v) を覚えさせる。
    """
    rng = np.random.default_rng(seed)
    P, U, n = V(P), V(U).normalized(), V(n_out).normalized()
    cylinder(g, pole_mat, P - U * 0.12, P + U * (width + 0.12), pole_r, seg=8)
    pw = width / panels
    th = 0.005
    uvs = g.parts.setdefault(key, {'v': [], 'f': [], 'sm': []}).setdefault('uv', [])
    for k in range(panels):
        u0 = k * pw + gap / 2
        u1 = (k + 1) * pw - gap / 2
        ph = rng.uniform(0, 6.28)
        freq = rng.uniform(2.2, 3.2)
        swing = rng.normal(0, 0.25)

        def pos(i, j, side):
            fu = i / (nu - 1)
            fv = j / (nv - 1)            # 0 が上、1 が裾
            u = u0 + (u1 - u0) * fu
            zdrop = pole_r + 0.01 + fv * (length - pole_r)
            # 上の袋は竿を包む
            amp = fold_top + fold * fv ** 1.2
            wv = amp * math.sin(2 * math.pi * freq * fu + ph) + 0.35 * amp * math.sin(2 * math.pi * 2.3 * freq * fu + 1.7 * ph)
            belly = sway * (fv ** 1.6) * (1 + 0.3 * swing)
            curl = 0.02 * max(0.0, fv - 0.9) / 0.1 * math.sin(math.pi * fu)
            p = P + U * u - EZ * zdrop + n * (wv + belly + curl + (side - 0.5) * th)
            # 裾の端はわずかに内へ寄る（重み）
            p += U * (0.012 * fv ** 2 * (0.5 - fu))
            return p
        verts, faces, want, uv = [], [], [], []
        for side in (1, 0):
            for j in range(nv):
                for i in range(nu):
                    verts.append(pos(i, j, side))
                    uv.append(((u0 + (u1 - u0) * i / (nu - 1)) / width, 1 - (j / (nv - 1)) * (length - 0.0) / length))
        base = nu * nv
        for side in (0, 1):
            o = side * base
            for j in range(nv - 1):
                for i in range(nu - 1):
                    faces.append((o + j * nu + i, o + j * nu + i + 1, o + (j + 1) * nu + i + 1, o + (j + 1) * nu + i))
                    want.append(n if side == 0 else -n)
        # 縁（左右と裾）
        for j in range(nv - 1):
            for i in (0, nu - 1):
                a, b = j * nu + i, (j + 1) * nu + i
                faces.append((a, b, base + b, base + a))
                want.append(-U if i == 0 else U)
        for i in range(nu - 1):
            a, b = (nv - 1) * nu + i, (nv - 1) * nu + i + 1
            faces.append((a, b, base + b, base + a))
            want.append(-EZ)
        g.oriented(key, verts, faces, want, smooth=True)
        uvs.extend(uv)
        # 竿を通す袋（布の上端の筒）
        tube_v, tube_f, tube_w = [], [], []
        segs = 8
        for i2, u in enumerate((u0, u1)):
            for s in range(segs):
                a = 2 * math.pi * s / segs
                tube_v.append(P + U * u + (n * math.cos(a) + EZ * math.sin(a)) * (pole_r + 0.012))
        for s in range(segs):
            s2 = (s + 1) % segs
            tube_f.append((s, s2, segs + s2, segs + s))
            a = 2 * math.pi * (s + 0.5) / segs
            tube_w.append(n * math.cos(a) + EZ * math.sin(a))
        g.oriented(key, tube_v, tube_f, tube_w, smooth=True)
        uvs.extend([((u0 + (u1 - u0) * i2) / width, 0.995) for i2 in (0, 1) for s in range(segs)])


# ---------------------------------------------------------------------------
# 物体にする・UV・色むら・AO・書き出し
# ---------------------------------------------------------------------------

DENSIFY = {'plaster_white': 0.42, 'plaster_white_streaks': 0.42, 'plaster_earth': 0.42, 'earth_floor': 0.5,
           'wood_weathered': 0.7}
# 材質ごとの基本の明るさ（頂点色に掛ける。three.js でも基本色に掛かる）
BASE = {'wood_dark': 0.9, 'wood_bengara': 0.9, 'plaster_white': 0.96, 'tile_manju': 0.85}
TINT = {'tile_ibushi': (0.07, 0.02), 'wood_weathered': (0.07, 0.03), 'wood_dark': (0.06, 0.03), 'wood_fresh': (0.07, 0.04),
        'wood_aged': (0.08, 0.04), 'tile_manju': (0.06, 0.02),
        'wood_bengara': (0.05, 0.02), 'stone_granite': (0.07, 0.03), 'straw': (0.08, 0.04), 'bamboo': (0.06, 0.03)}


def to_objects(g: Geo, M: Matrix, prefix: str, custom: dict | None = None) -> list:
    """材質ごとに 1 物体（世界座標の頂点、物体の変換は単位）"""
    custom = custom or {}
    objs = []
    for key, p in g.parts.items():
        if not p['f']:
            continue
        me = bpy.data.meshes.new(f'{prefix}_{key}')
        verts = [tuple(M @ v) for v in p['v']]
        me.from_pydata(verts, [], p['f'])
        me.update(calc_edges=True)
        me.polygons.foreach_set('use_smooth', p['sm'])
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        lib = key.split('#')[0]
        if key in custom:
            me.materials.append(custom[key])
        else:
            mats.assign(ob, lib)
        if 'uv' in p:
            # 頂点ごとの (u,v) を面の角へ
            uvl = me.uv_layers.new(name='UVMap')
            buf = np.array(p['uv'], np.float32)
            lv = np.empty(len(me.loops), np.int64)
            me.loops.foreach_get('vertex_index', lv)
            uvl.data.foreach_set('uv', buf[lv].ravel())
        ob['koto_key'] = key
        ob['koto_lib'] = lib
        if key in COLOR_GAIN:
            ob['koto_gain'] = [float(c) for c in COLOR_GAIN[key]]
        else:
            ob['koto_gain'] = float(key.split('#')[1]) if '#' in key else BASE.get(lib, 1.0)
        objs.append(ob)
    bpy.context.view_layer.update()
    return objs


def finish_objects(objs, seed=0):
    """UV（材質の種類に合わせて）、細分（AO 用）、色むら"""
    for i, ob in enumerate(objs):
        key = ob['koto_lib']
        if key in mats.CATALOG:
            mats.uv_auto(ob, seed=seed + i)
            if key in DENSIFY:
                mats.densify(ob, DENSIFY[key])
            if key in TINT:
                a, w = TINT[key]
                mats.tint_islands(ob, seed=seed + 31 * i, amount=a, warm=w)
    for ob in objs:
        if ob.data.color_attributes.get(mats.COLOR_ATTR) is None:
            mats._color_attr(ob.data)
            mats._set_active_color(ob.data, mats.COLOR_ATTR)
        gain = np.array(ob.get('koto_gain', 1.0), np.float32).reshape(-1)
        if np.any(np.abs(gain - 1.0) > 1e-4):
            a = ob.data.color_attributes[mats.COLOR_ATTR]
            buf = np.empty(len(a.data) * 4, np.float32)
            a.data.foreach_get('color', buf)
            buf = buf.reshape(-1, 4)
            buf[:, :3] *= gain[None, :] if len(gain) == 3 else gain[0]
            a.data.foreach_set('color', buf.ravel())


def snapshot_colors(objs):
    """焼き込み前の頂点色（色むら×基本の明るさ）を覚える（eave_shade で AO だけを取り出すため）"""
    out = {}
    for ob in objs:
        a = ob.data.color_attributes.get(mats.COLOR_ATTR)
        if a is None:
            continue
        buf = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', buf)
        out[ob.name] = buf.reshape(-1, 4).copy()
    return out


def ao_lift(objs, before, keys, keep=0.45):
    """
    細い部材が密に並ぶもの（格子）の AO を弱める：暗さ（1 - ao）を keep 倍に。
    頂点ごとの AO は隣の桟（4 cm 先）を拾って表の面まで暗くなるため。before は snapshot_colors の値
    """
    for ob in objs:
        if ob.get('koto_key') not in keys or ob.name not in before:
            continue
        a = ob.data.color_attributes.get(mats.COLOR_ATTR)
        pre = before[ob.name]
        cur = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', cur)
        cur = cur.reshape(-1, 4)
        ao = np.clip(cur[:, 1] / np.maximum(pre[:, 1], 1e-4), 0, 1)
        cur[:, :3] = pre[:, :3] * (1 - keep * (1 - ao))[:, None]
        a.data.foreach_set('color', cur.ravel())


def eave_shade(objs, M, zones, before, skip=('tile_ibushi', 'tile_manju')):
    """
    軒下の陰：焼いた AO を、壁ぎわ t0 → 軒先 t1 の値より明るくならないようにする（軒裏・垂木・腕木・軒下の壁の上部）。
    zones=[dict(xw, xe, y0, y1, zb=関数(X), t0, t1, soffit=軒裏の厚み, fade=軒裏から下へ薄れる距離)]（家の座標）。
    before は snapshot_colors の値。瓦は除く。
    """
    Mi = M.inverted()
    for ob in objs:
        if ob.get('koto_lib') in skip or ob.name not in before:
            continue
        me = ob.data
        a = me.color_attributes.get(mats.COLOR_ATTR)
        if a is None or a.domain != 'POINT':
            continue
        co = np.empty(len(me.vertices) * 3, np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        R = np.array(Mi.to_3x3())
        T = np.array(Mi.translation)
        loc = co @ R.T + T
        X, Y, Z = loc[:, 0], loc[:, 1], loc[:, 2]
        pre = before[ob.name]
        cur = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', cur)
        cur = cur.reshape(-1, 4)
        ao = np.clip(cur[:, 1] / np.maximum(pre[:, 1], 1e-4), 0, 1)
        target = np.ones(len(X))
        for zn in zones:
            zb = np.vectorize(zn['zb'])(X)
            frac = np.clip((X - zn['xw']) / (zn['xe'] - zn['xw']), 0, 1)
            t = zn['t0'] + (zn['t1'] - zn['t0']) * frac
            zs = zb - zn.get('soffit', 0.17)
            fade = zn.get('fade', 0.6)
            w = np.clip((Z - (zs - fade)) / fade, 0, 1)
            inside = (X > zn['xw'] - 0.3) & (X < zn['xe'] + 0.01) & (Y > zn['y0']) & (Y < zn['y1']) & (Z < zb + 0.005)
            tt = np.where(inside, 1 - (1 - t) * w, 1.0)
            target = np.minimum(target, tt)
        new_ao = np.minimum(ao, target)
        cur[:, :3] = pre[:, :3] * new_ao[:, None]
        a.data.foreach_set('color', cur.ravel())



def bake(objs, samples=48, strength=0.58, distance=1.6):
    mats.bake_ao_to_color(objs, ground_plane=True, samples=samples, distance=distance, strength=strength, ground_z=0.0)


def placement(fp, front):
    """家の座標 → 世界（Blender）の行列。front '+x' は X の大きい側が東、'-x' は西向き（180 度回す）"""
    x0, x1, z0, z1 = fp['x0'], fp['x1'], fp['z0'], fp['z1']
    if front == '+x':
        return Matrix.Translation((x0, -z1, 0.0))
    return Matrix.Translation((x1, -z0, 0.0)) @ Matrix.Rotation(math.pi, 4, 'Z')


def local_to_game_rect(M, xa, xb, ya, yb):
    """家の座標の長方形 → ゲームの {x0,x1,z0,z1}"""
    pts = [M @ V((x, y, 0)) for x in (xa, xb) for y in (ya, yb)]
    xs = [p.x for p in pts]
    zs = [-p.y for p in pts]
    return dict(x0=round(min(xs), 3), x1=round(max(xs), 3), z0=round(min(zs), 3), z1=round(max(zs), 3))


def local_to_game_box(M, xa, xb, ya, yb, za, zb):
    r = local_to_game_rect(M, xa, xb, ya, yb)
    r.update(y0=round(za, 3), y1=round(zb, 3))
    return {k: r[k] for k in ('x0', 'x1', 'y0', 'y1', 'z0', 'z1')}


def write_meta(path, name, colliders, blockers, extra=None):
    d = {'name': name, 'coords': 'game (x east, y up, z south), meters', 'colliders': colliders, 'camera_blockers': blockers}
    if extra:
        d.update(extra)
    pathlib.Path(path).write_text(json.dumps(d, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------------------
# 確認用の描画
# ---------------------------------------------------------------------------

def preview_ground(size=80.0):
    """確認用の地面（道の土）。書き出しには入れない"""
    me = bpy.data.meshes.new('_preview_ground')
    s = size / 2
    n = 16
    verts = [(-s + 2 * s * i / n, -s + 2 * s * j / n, 0.0) for j in range(n + 1) for i in range(n + 1)]
    faces = [(j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i) for j in range(n) for i in range(n)]
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new('_preview_ground', me)
    bpy.context.scene.collection.objects.link(ob)
    mats.assign(ob, 'earth_road')
    mats.uv_box(ob)
    return ob


def render(path, cam, tgt, samples=24, res=(960, 540), fov=50.0):
    s = bpy.context.scene
    s.cycles.use_denoising = True
    try:
        s.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    s.render.threads_mode = 'FIXED'
    s.render.threads = 3
    render_preview(path, cam, tgt, res=res, samples=samples, fov_deg=fov)
    print('preview', path, flush=True)


# ---------------------------------------------------------------------------
# 組み立て：大屋根（切妻・平入り）と庇
# ---------------------------------------------------------------------------

RAFTER_OFF = 0.06 + 0.072   # 瓦の下地から垂木の下端まで（面に直角。既定の垂木の高さ 0.072 のとき）


def main_roof(g, *, xb, xf, W, p, zr, of, ob, ov=(0.4, 0.4), layers=3, seed=0, tw=0.27, tl=0.28, oni_scale=1.0,
              keta=(0.15, 0.18), purlins_x=(), rafter_spacing=0.45, keta_ext=0.3, front_support=None, gegyo_at=(),
              rafter=(0.055, 0.072), deck='wood_weathered', kaya=None):
    """
    切妻の大屋根（棟は Y に平行＝平入り）。xb/xf は裏と表の壁の線、W は間口、zr は棟の瓦下地の高さ、p は勾配（寸/10）。
    of/ob は表・裏の軒の出、ov は (Y=0 側, Y=W 側) のけらばの出。
    front_support=dict(x=出桁の X, ys=[腕木の Y], arm=(幅, 高さ), geta=(幅, 高さ)) で表の軒を出桁で受ける。
    rafter=(幅, 高さ) の垂木、deck は軒裏の板、kaya は二重の鼻先（roof_sandwich）。
    返り値: dict(zb=関数, zrb=関数, ztop=棟の上端, xr=棟の X)
    """
    xr = (xb + xf) / 2
    a = math.atan(p)
    ca, sa = math.cos(a), math.sin(a)
    rw, rh = rafter
    rbf = (0.06 + rh) / ca

    def zb(X):
        return zr - p * abs(X - xr)

    def zrb(X):
        return zb(X) - rbf
    y0, y1 = -ov[0], W + ov[1]
    for side in (1, -1):
        x_edge = xf + of if side > 0 else xb - ob
        x_wall = xf if side > 0 else xb
        D = V((side * ca, 0, -sa))
        N = V((side * sa, 0, ca))
        length = abs(x_edge - xr) / ca
        tile_field(g, V((xr, y0, zr)), EY, D, N, y1 - y0, length, tw=tw, tl=tl, seed=seed + (1 if side > 0 else 2), top_skip=0.1)
        roof_sandwich(g, x_wall, x_edge, y0, y1, zb, N, D, spacing=rafter_spacing, seed=seed + 5 + side, rw=rw, rh=rh,
                      deck=deck, kaya=kaya)
        kw, kh = keta
        beam(g, 'wood_dark', (x_wall, -keta_ext, zrb(x_wall) - kh / 2), (x_wall, W + keta_ext, zrb(x_wall) - kh / 2), kw, kh,
             ch=0.012, seg_len=0.8)
        pur = [(x, zb(x) - 0.08 - 0.065) for x in purlins_x if (x - xr) * side > 0.05 or (side > 0 and abs(x - xr) <= 0.05)]
        for (yv, sg, yw) in ((y0 - 0.02, -1, 0.0), (y1 + 0.02, 1, W)):
            gable_edge(g, yv, sg, xr, x_edge + side * 0.03, zb, y_wall=yw, purlins=pur, p_size=0.13)
        if side > 0 and front_support:
            fs = front_support
            xd = fs['x']
            gw, gh = fs.get('geta', (0.13, 0.15))
            aw, ah = fs.get('arm', (0.1, 0.13))
            zt = zrb(xd)
            beam(g, 'wood_dark', (xd, -keta_ext + 0.05, zt - gh / 2), (xd, W + keta_ext - 0.05, zt - gh / 2), gw, gh, ch=0.012, seg_len=0.8)
            for yy in fs['ys']:
                beam(g, 'wood_dark', (xf - 0.1, yy, zt - gh - ah / 2), (xd + 0.14, yy, zt - gh - ah / 2), aw, ah, ch=0.012)
    ztop = ridge(g, (xr, y0 - 0.05, zr), (xr, y1 + 0.05, zr), zr, p, layers, seed + 9, oni_scale=oni_scale)
    for (yv, sg) in gegyo_at:
        gegyo(g, (xr, yv, zr - 0.3), sg)
    return dict(zb=zb, zrb=zrb, ztop=ztop, xr=xr, y0=y0, y1=y1)


def udegi_arm(g, x0, x_tip, y, z_bot, w, h, *, mat='wood_dark', nose=0.14):
    """
    腕木（横から見た輪郭を押し出す）。x0 は壁側の端、x_tip は先端、y は中心、z_bot は下端。
    先端は上を残して下を放物線で切り上げた形（木鼻の繰形）。
    """
    pts = [(x0, z_bot)]
    k = 6
    for i in range(k + 1):
        t = i / k
        x = x_tip - nose + nose * t
        pts.append((x, z_bot + (h * 0.62) * t * t))
    pts += [(x_tip, z_bot + h), (x0, z_bot + h)]
    extrude_outline(g, mat, pts, V((0, y - w / 2, 0)), EX, EZ, w, EY)


def hisashi(g, *, xw, face, xe, y0, y1, z0, p, seed=0, tw=0.27, tl=0.28, spacing=0.42, support=None,
            rafter=(0.055, 0.072), deck='wood_weathered', kaya=None, arm=(0.09, 0.12), arm_proj=0.12, arm_shaped=False):
    """
    庇（片流れ）。xw は取り付く壁の線、face は壁の表面の X、xe は軒先、z0 は壁の線での瓦下地の高さ。
    support=dict(kind='udegi', x=出桁の X, ys=[...]) または dict(kind='posts', x=柱の X, ys=[...], stone=True)
    rafter=(幅, 高さ)、deck は軒裏の板、kaya は二重の鼻先。腕木は arm=(幅, 高さ)、出桁から arm_proj だけ先へ出す。
    """
    a = math.atan(p)
    ca, sa = math.cos(a), math.sin(a)
    D = V((ca, 0, -sa))
    N = V((sa, 0, ca))
    rw, rh = rafter
    rbf = (0.06 + rh) / ca

    def zb(X):
        return z0 - p * (X - xw)

    def zrb(X):
        return zb(X) - rbf
    length = (xe - xw) / ca
    tile_field(g, V((xw, y0, z0)), EY, D, N, y1 - y0, length, tw=tw, tl=tl, seed=seed, top_skip=0.0)
    roof_sandwich(g, xw, xe, y0, y1, zb, N, D, spacing=spacing, seed=seed + 3, rw=rw, rh=rh, deck=deck, kaya=kaya)
    for yv, sg in ((y0 - 0.02, -1), (y1 + 0.02, 1)):
        gh_ = 0.16 if kaya is None else kaya.get('top', 0.04) + kaya['board'][0] + kaya['h'] + 0.02
        gable_edge(g, yv, sg, xw, xe + 0.03, zb, h=gh_, t=0.035)
    # 水切り（壁との取り合いの板）と垂木掛け
    beam(g, 'wood_dark', (face + 0.02, y0 - 0.02, zb(face) + 0.07), (face + 0.02, y1 + 0.02, zb(face) + 0.07), 0.04, 0.13,
         ch=0.006, seg_len=0.8)
    beam(g, 'wood_dark', (face + 0.04, y0, zrb(face) - 0.06), (face + 0.04, y1, zrb(face) - 0.06), 0.08, 0.12, ch=0.01, seg_len=0.8)
    if support:
        xd = support['x']
        if support['kind'] == 'udegi':
            gw, gh = 0.12, 0.14
            zt = zrb(xd)
            beam(g, 'wood_dark', (xd, y0 + 0.05, zt - gh / 2), (xd, y1 - 0.05, zt - gh / 2), gw, gh, ch=0.012, seg_len=0.8)
            aw, ah = arm
            for yy in support['ys']:
                if arm_shaped:
                    udegi_arm(g, xw - 0.1, xd + gw / 2 + arm_proj, yy, zt - gh - ah, aw, ah)
                else:
                    beam(g, 'wood_dark', (xw - 0.1, yy, zt - gh - ah / 2), (xd + arm_proj, yy, zt - gh - ah / 2), aw, ah, ch=0.01)
        else:
            gw, gh = 0.13, 0.16
            zt = zrb(xd)
            beam(g, 'wood_dark', (xd, y0 + 0.02, zt - gh / 2), (xd, y1 - 0.02, zt - gh / 2), gw, gh, ch=0.012, seg_len=0.8)
            for k, yy in enumerate(support['ys']):
                stone(g, 'stone_granite', (xd, yy, 0.03), (0.34, 0.34, 0.26), seed * 7 + k, flat_top=0.9, k=3.0, rough=0.07)
                post(g, 'wood_dark', xd, yy, 0.15, zt - gh, s=0.15)
                beam(g, 'wood_dark', (xw - 0.05, yy, zt - gh - 0.06), (xd + 0.1, yy, zt - gh - 0.06), 0.1, 0.12, ch=0.01)
    return dict(zb=zb, zrb=zrb)


def room(g, x0, x1, y0, y1, h, *, floor='earth_floor', walls='plaster_white#0.8', back='plaster_white#0.7', floor_z=0.02,
         ceiling=True):
    """開口の奥の部屋（土間・店の間）：床・左右と奥の壁・天井（板と根太）"""
    quad_grid(g, floor, (x0, y0, floor_z), EX, EY, 0, x1 - x0, 0, y1 - y0, EZ, step=0.35)
    quad_grid(g, walls, (x0, y0, 0), EX, EZ, 0, x1 - x0, 0, h, EY, step=0.35)
    quad_grid(g, walls, (x0, y1, 0), EX, EZ, 0, x1 - x0, 0, h, -EY, step=0.35)
    quad_grid(g, back, (x0, y0, 0), EY, EZ, 0, y1 - y0, 0, h, EX, step=0.35)
    if ceiling:
        quad_grid(g, 'wood_weathered', (x0, y0, h), EX, EY, 0, x1 - x0, 0, y1 - y0, -EZ, step=0.4)
        n = max(1, int((x1 - x0) / 0.6))
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            beam(g, 'wood_dark', (x, y0, h - 0.05), (x, y1, h - 0.05), 0.07, 0.09, ch=0.008)


def raised_floor(g, x0, x1, y0, y1, h, *, edge='+x', seed=0, step_stone=True):
    """板の間（上がり框つき）。edge は框のある辺"""
    rng = np.random.default_rng(seed)
    n = max(1, int(round((y1 - y0) / 0.16)))
    bw = (y1 - y0) / n
    for i in range(n):
        ya = y0 + i * bw
        box(g, 'wood_weathered', x0, x1, ya + 0.002, ya + bw - 0.002, h - 0.025 + rng.uniform(-0.002, 0.002), h, seg_len=0.8)
    if edge == '+x':
        beam(g, 'wood_dark', (x1 - 0.06, y0, h - 0.07), (x1 - 0.06, y1, h - 0.07), 0.12, 0.13, ch=0.01, seg_len=0.8)
        quad_grid(g, 'wood_dark', (x1 - 0.1, y0, 0.0), EY, EZ, 0, y1 - y0, 0, h - 0.13, EX, step=0.4)
        if step_stone:
            stone(g, 'stone_granite', (x1 + 0.22, (y0 + y1) / 2, 0.02), (0.36, 0.55, 0.22), seed + 5, flat_top=0.85, k=3.0)
    elif edge in ('+y', '-y'):
        yy = y1 - 0.06 if edge == '+y' else y0 + 0.06
        beam(g, 'wood_dark', (x0, yy, h - 0.07), (x1, yy, h - 0.07), 0.12, 0.13, ch=0.01, seg_len=0.8)
        yq = y1 - 0.1 if edge == '+y' else y0 + 0.1
        quad_grid(g, 'wood_dark', (x0, yq, 0.0), EX, EZ, 0, x1 - x0, 0, h - 0.13, EY if edge == '+y' else -EY, step=0.4)
        if step_stone:
            ys = y1 + 0.24 if edge == '+y' else y0 - 0.24
            stone(g, 'stone_granite', ((x0 + x1) / 2 + 0.3, ys, 0.02), (0.55, 0.36, 0.22), seed + 5, flat_top=0.85, k=3.0)


def shelf(g, x, y0, y1, zs, depth=0.35, seed=0, items=True):
    """奥の壁の棚（板と受け木）＋箱・壺"""
    rng = np.random.default_rng(seed)
    for z in zs:
        box(g, 'wood_weathered', x, x + depth, y0, y1, z - 0.025, z, ch=0.004)
        for yy in (y0 + 0.05, y1 - 0.05):
            beam(g, 'wood_dark', (x + 0.02, yy, z - 0.1), (x + depth - 0.03, yy, z - 0.06), 0.04, 0.05, ch=0.0)
        if items:
            y = y0 + 0.08
            while y < y1 - 0.3:
                k = rng.integers(0, 3)
                if k == 0:
                    w = rng.uniform(0.22, 0.34)
                    crate(g, (x + depth / 2, y + w / 2, z), rng.uniform(-0.1, 0.1), depth * 0.7, w, rng.uniform(0.14, 0.22), mat='wood_fresh')
                    y += w + 0.06
                elif k == 1:
                    r = rng.uniform(0.08, 0.12)
                    hh = rng.uniform(0.2, 0.3)
                    lathe(g, 'earth_floor', (x + depth / 2, y + r, z),
                          [(r * 0.6, 0), (r, hh * 0.35), (r * 0.95, hh * 0.7), (r * 0.5, hh * 0.92), (r * 0.55, hh), (0, hh)], seg=10)
                    y += 2 * r + 0.07
                else:
                    y += 0.15


def shitomido(g, O, A, B, n, w, h, *, pitch=0.16):
    """蔀戸の 1 枚：枠・板・表の格子の桟。O は角、A は幅の向き、B は高さの向き、n は表"""
    O, A, B, n = V(O), V(A).normalized(), V(B).normalized(), V(n).normalized()
    c = O + A * (w / 2) + B * (h / 2)
    obox(g, 'wood_weathered', c, A, B, n, w / 2, h / 2, 0.012, seg=max(1, int(w / 0.6)))
    fw = 0.05
    for (p0, p1) in ((O, O + A * w), (O + B * h, O + A * w + B * h)):
        beam(g, 'wood_dark', p0 + n * 0.015, p1 + n * 0.015, fw, 0.045, up=n, ch=0.006)
    for (p0, p1) in ((O, O + B * h), (O + A * w, O + A * w + B * h)):
        beam(g, 'wood_dark', p0 + n * 0.015, p1 + n * 0.015, fw, 0.045, up=n, ch=0.006)
    nu = max(1, int(round(w / pitch)))
    nv = max(1, int(round(h / pitch)))
    for i in range(1, nu):
        p = O + A * (w * i / nu)
        beam(g, 'wood_dark', p + n * 0.02, p + B * h + n * 0.02, 0.022, 0.025, up=n, ch=0.0)
    for j in range(1, nv):
        p = O + B * (h * j / nv)
        beam(g, 'wood_dark', p + n * 0.02, p + A * w + n * 0.02, 0.022, 0.025, up=n, ch=0.0)


def itado(g, O, A, n, w, h, *, seed=0):
    """板戸：縦の板と桟（横 3 本・枠）"""
    O, A, n = V(O), V(A).normalized(), V(n).normalized()
    k = max(2, int(round(w / 0.2)))
    bw = w / k
    for i in range(k):
        c = O + A * (bw * (i + 0.5)) + EZ * (h / 2)
        obox(g, 'wood_weathered', c, EZ, A, n, h / 2, bw / 2 - 0.003, 0.012, seg=3)
    for z in (0.12, h / 2, h - 0.12):
        beam(g, 'wood_dark', O + EZ * z + n * 0.02, O + A * w + EZ * z + n * 0.02, 0.06, 0.035, up=EZ, ch=0.005)
    for u in (0.025, w - 0.025):
        p = O + A * u + n * 0.02
        beam(g, 'wood_dark', p, p + EZ * h, 0.05, 0.035, up=n, ch=0.005)


def board_fence(g, P0, P1, h, *, seed=0, cap=True):
    """板塀：柱・貫・縦の板・笠木（小さな瓦の笠）"""
    P0, P1 = V(P0), V(P1)
    L, ax, ay, az = frame_of(P0, P1, EZ)
    for q in (P0, P1):
        stone(g, 'stone_granite', q + EZ * 0.02, (0.3, 0.3, 0.22), seed + int(q.x * 10), flat_top=0.9)
        post(g, 'wood_dark', q.x, q.y, 0.12, h + 0.05, s=0.13)
    for z in (0.35, h * 0.55, h - 0.1):
        beam(g, 'wood_dark', P0 + EZ * z, P1 + EZ * z, 0.05, 0.08, ch=0.006)
    n = max(1, int(round(L / 0.19)))
    for i in range(n):
        for side in (1, -1):
            c = P0 + ax * (L * (i + 0.5) / n) + ay * (side * 0.04) + EZ * ((0.1 + h) / 2)
            obox(g, 'wood_weathered', c, EZ, ax, ay, (h - 0.1) / 2, L / n / 2 - 0.003, 0.009, seg=3)
    if cap:
        beam(g, 'wood_dark', P0 + EZ * (h + 0.03) - ax * 0.1, P1 + EZ * (h + 0.03) + ax * 0.1, 0.18, 0.06, ch=0.008)
        for sgn in (1, -1):
            O = P0 - ax * 0.12 + EZ * (h + 0.12)
            D = (ay * sgn * 0.93 - EZ * 0.37).normalized()
            N = (ay * sgn * 0.37 + EZ * 0.93).normalized()
            tile_field(g, O, ax, D, N, L + 0.24, 0.24, tw=0.26, tl=0.26, seed=seed + (3 if sgn > 0 else 4),
                       verge=(False, False), top_skip=0.0, manju=True)
        beam(g, 'tile_ibushi', P0 - ax * 0.14 + EZ * (h + 0.16), P1 + ax * 0.14 + EZ * (h + 0.16), 0.1, 0.07, ch=0.02)
