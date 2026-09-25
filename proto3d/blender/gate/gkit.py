"""
城門・土塀・天守の共通の部品（Blender の座標：X 東・Y 北・Z 上。ゲームの (x, y, z) は Blender の (x, -z, y)）。

- 形はすべて実際の形状：瓦は 1 枚ずつ（本瓦＝平瓦と丸瓦）、石は 1 個ずつ（面の膨らみ・面取り）、垂木は 1 本ずつ
- 材質ごとに 1 物体（キーは 'ライブラリ名' か 'ライブラリ名#区別'）
- 乱数はすべて固定の種（何度実行しても同じ形）
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
SCENE = scene_layout()


# ---------------------------------------------------------------------------
# 形を溜める器
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
    """キー（材質）ごとに頂点・面・なめらか表示・（あれば）頂点ごとの UV を溜める"""

    def __init__(self):
        self.parts: dict[str, dict] = {}

    def add(self, key, verts, faces, smooth=False, uv=None):
        p = self.parts.setdefault(key, {'v': [], 'f': [], 'sm': [], 'uv': []})
        o = len(p['v'])
        p['v'].extend(V(v) for v in verts)
        p['f'].extend(tuple(o + i for i in f) for f in faces)
        p['sm'].extend([smooth] * len(faces))
        if uv is not None:
            p['uv'].extend(uv)

    def convex(self, key, verts, faces, smooth=False, center=None, uv=None):
        """凸の部品：面の向きを中心から外向きに"""
        vs = [V(v) for v in verts]
        c = V(center) if center is not None else sum(vs, V()) / len(vs)
        out = []
        for f in faces:
            pts = [vs[i] for i in f]
            fc = sum(pts, V()) / len(pts)
            out.append(tuple(f) if newell(pts).dot(fc - c) >= 0 else tuple(reversed(f)))
        self.add(key, vs, out, smooth, uv)

    def oriented(self, key, verts, faces, want, smooth=False, uv=None):
        """面ごとに望む向き（ベクトル 1 つか面ごとのリスト）へそろえる"""
        vs = [V(v) for v in verts]
        out = []
        for k, f in enumerate(faces):
            w = want[k] if isinstance(want, list) else want
            pts = [vs[i] for i in f]
            out.append(tuple(f) if newell(pts).dot(w) >= 0 else tuple(reversed(f)))
        self.add(key, vs, out, smooth, uv)

    def tris(self, prefix=None):
        t = 0
        for k, p in self.parts.items():
            if prefix is None or k.startswith(prefix):
                t += sum(len(f) - 2 for f in p['f'])
        return t


# ---------------------------------------------------------------------------
# 基本の形
# ---------------------------------------------------------------------------

def obox(g, key, c, ax, ay, az, hx, hy, hz, ch=0.0, seg=1, caps=(True, True)):
    """向きのある箱（ax 方向に長い）。ch>0 で ax に平行な 4 辺を面取り。seg は ax 方向の分割"""
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
    g.convex(key, verts, faces, center=c)


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


def beam(g, key, p0, p1, w, h, up=EZ, ch=0.012, seg_len=0.0, caps=(True, True)):
    """p0→p1 の角材（幅 w・高さ h、up が高さの向き）"""
    L, ax, ay, az = frame_of(p0, p1, up)
    seg = max(1, int(math.ceil(L / seg_len))) if seg_len > 0 else 1
    obox(g, key, (V(p0) + V(p1)) / 2, ax, ay, az, L / 2, w / 2, h / 2, ch=ch, seg=seg, caps=caps)


def abox(g, key, x0, x1, y0, y1, z0, z1, ch=0.0, seg_len=0.0):
    """軸にそろった箱（一番長い辺の向きに面取り・分割）"""
    d = [x1 - x0, y1 - y0, z1 - z0]
    c = V(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    axes = [EX, EY, EZ]
    i = int(np.argmax(d))
    j, k = [a for a in range(3) if a != i]
    seg = max(1, int(math.ceil(d[i] / seg_len))) if seg_len > 0 else 1
    obox(g, key, c, axes[i], axes[j], axes[k], d[i] / 2, d[j] / 2, d[k] / 2, ch=ch, seg=seg)


def cylinder(g, key, p0, p1, r, seg=8, smooth=True, caps=(True, True), r1=None):
    """円柱（r1 を渡すと先細り）"""
    L, ax, ay, az = frame_of(p0, p1, EZ if abs(V(p1 - V(p0)).normalized().z) < 0.9 else EX)
    r1 = r if r1 is None else r1
    verts = []
    for k, (p, rr) in enumerate(((V(p0), r), (V(p1), r1))):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(p + (ay * math.cos(a) + az * math.sin(a)) * rr)
    faces = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
    want = []
    for i in range(seg):
        a = 2 * math.pi * (i + 0.5) / seg
        want.append(ay * math.cos(a) + az * math.sin(a))
    g.oriented(key, verts, faces, want, smooth=smooth)
    if caps[0]:
        g.oriented(key, verts[:seg], [tuple(range(seg))], -ax)
    if caps[1]:
        g.oriented(key, verts[seg:], [tuple(range(seg))], ax)


def extrude_outline(g, key, pts2, origin, U, W, D, depth, smooth=False, caps=(True, True)):
    """平面の輪郭（U, W の 2 次元点）を D 方向へ depth だけ押し出す"""
    origin, U, W, D = V(origin), V(U), V(W), V(D).normalized()
    n = len(pts2)
    area = sum(pts2[i][0] * pts2[(i + 1) % n][1] - pts2[(i + 1) % n][0] * pts2[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0
    front = [origin + U * u + W * w for (u, w) in pts2]
    back = [p + D * depth for p in front]
    verts = front + back
    faces, want = [], []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        du, dw = pts2[j][0] - pts2[i][0], pts2[j][1] - pts2[i][1]
        want.append((U * dw - W * du) * sgn)
    if caps[0]:
        faces.append(tuple(range(n)))
        want.append(-D)
    if caps[1]:
        faces.append(tuple(n + i for i in range(n)))
        want.append(D)
    g.oriented(key, verts, faces, want, smooth=smooth)


def sweep_rect(g, key, pts, ups, w, h, *, caps=(True, True), ch=0.0):
    """折れ線 pts に沿った角材（ups は各点での高さの向き）。断面の中心が pts"""
    n = len(pts)
    if ch > 1e-4:
        ring = [(w / 2 - ch, -h / 2), (w / 2, -h / 2 + ch), (w / 2, h / 2 - ch), (w / 2 - ch, h / 2),
                (-w / 2 + ch, h / 2), (-w / 2, h / 2 - ch), (-w / 2, -h / 2 + ch), (-w / 2 + ch, -h / 2)]
    else:
        ring = [(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]
    m = len(ring)
    verts = []
    frames = []
    for i in range(n):
        t = (V(pts[min(i + 1, n - 1)]) - V(pts[max(i - 1, 0)])).normalized()
        up = V(ups[i])
        up = (up - t * up.dot(t)).normalized()
        side = t.cross(up)
        frames.append((t, side, up))
        for (a, b) in ring:
            verts.append(V(pts[i]) + side * a + up * b)
    faces, want = [], []
    for i in range(n - 1):
        t, side, up = frames[i]
        for k in range(m):
            faces.append((i * m + k, i * m + (k + 1) % m, (i + 1) * m + (k + 1) % m, (i + 1) * m + k))
            a0, b0 = ring[k]
            a1, b1 = ring[(k + 1) % m]
            want.append(side * (a0 + a1) + up * (b0 + b1))
    if caps[0]:
        faces.append(tuple(range(m)))
        want.append(-frames[0][0])
    if caps[1]:
        faces.append(tuple((n - 1) * m + k for k in range(m)))
        want.append(frames[-1][0])
    g.oriented(key, verts, faces, want)


_CUBE = {}


def _cube_template(n=3):
    """立方体の表面の格子（-1〜1、頂点共有）"""
    if n in _CUBE:
        return _CUBE[n]
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
    _CUBE[n] = (np.array(verts), faces)
    return _CUBE[n]


def boulder(g, key, c, size, seed, k=3.4, rough=0.05, flat_top=None, flat_bot=True, n=3, yaw=0.0):
    """角の丸い不規則な石（超楕円体＋低い周波数のゆがみ）。flat_top で上面を平らに（礎石）"""
    rng = np.random.default_rng(seed)
    P, faces = _cube_template(n)
    q = P / (np.sum(np.abs(P) ** k, 1, keepdims=True) ** (1 / k))
    hs = np.array(size, np.float64) / 2
    disp = np.zeros(len(q))
    for _ in range(4):
        f = rng.normal(0, 1.6, 3)
        disp += np.sin(q @ f + rng.uniform(0, 6.28)) * rng.uniform(0.3, 1.0)
    pts = q * hs * (1 + rough * disp[:, None] / 2.0)
    if flat_bot:
        pts[:, 2] = np.maximum(pts[:, 2], -hs[2] * 0.92)
    if flat_top is not None:
        pts[:, 2] = np.minimum(pts[:, 2], hs[2] * flat_top)
    cs, sn = math.cos(yaw), math.sin(yaw)
    x, y = pts[:, 0] * cs - pts[:, 1] * sn, pts[:, 0] * sn + pts[:, 1] * cs
    pts = np.stack([x, y, pts[:, 2]], 1) + np.array(c)
    g.convex(key, [V(p) for p in pts], faces, smooth=True, center=c)


# ---------------------------------------------------------------------------
# 屋根の流れ（棟から軒への断面の曲線）
# ---------------------------------------------------------------------------

class Profile:
    """棟から軒への断面（x＝棟からの水平距離、z＝高さ）。弧長 s で位置・下向きの接線・上向きの法線を返す"""

    def __init__(self, xs, zs):
        self.x = np.asarray(xs, np.float64)
        self.z = np.asarray(zs, np.float64)
        d = np.hypot(np.diff(self.x), np.diff(self.z))
        self.s = np.concatenate([[0.0], np.cumsum(d)])
        self.length = float(self.s[-1])

    @classmethod
    def curve(cls, z_ridge, slope_top, slope_eave, x_end, n=24):
        """反り（棟近くは急・軒近くはゆるい）の 2 次曲線"""
        a2 = (slope_top - slope_eave) / (2 * x_end)
        xs = np.linspace(0, x_end, n)
        return cls(xs, z_ridge - slope_top * xs + a2 * xs ** 2)

    def at(self, s):
        """(x, z, tx, tz, nx, nz)。s は範囲の外でも接線で延ばす"""
        S = self.s
        if s <= 0:
            i = 0
        elif s >= S[-1]:
            i = len(S) - 2
        else:
            i = int(np.searchsorted(S, s) - 1)
        seg = S[i + 1] - S[i]
        tx = (self.x[i + 1] - self.x[i]) / seg
        tz = (self.z[i + 1] - self.z[i]) / seg
        f = s - S[i]
        return (self.x[i] + tx * f, self.z[i] + tz * f, tx, tz, -tz, tx)

    def z_at_x(self, x):
        return float(np.interp(x, self.x, self.z))

    def s_at_x(self, x):
        return float(np.interp(x, self.x, self.s))


class RoofFrame:
    """屋根の 1 面：O は棟の線の始まり（瓦の下地の高さは Profile が持つので O.z は使わない）、A は軒と平行、Dh は流れの水平の向き"""

    def __init__(self, O, A, Dh, prof: Profile):
        self.O = V((O[0], O[1], 0.0))
        self.A = V(A).normalized()
        self.Dh = V(Dh).normalized()
        self.p = prof

    def pt(self, a, s, h=0.0):
        x, z, tx, tz, nx, nz = self.p.at(s)
        return self.O + self.A * a + self.Dh * (x + nx * h) + EZ * (z + nz * h)

    def normal(self, s):
        x, z, tx, tz, nx, nz = self.p.at(s)
        return (self.Dh * nx + EZ * nz).normalized()

    def tangent(self, s):
        x, z, tx, tz, nx, nz = self.p.at(s)
        return (self.Dh * tx + EZ * tz).normalized()


def hongawara(g, key, F: RoofFrame, a0, a1, *, pitch=0.27, row=0.27, ov=0.06, sag=0.02, r=0.07, t=0.02,
              s_top=0.0, proj=0.04, eave_drop=0.05, verge=(True, True), seed=0, hseg=4, mseg=6,
              disc='full', skip_a=None, inner_lips=True, disc_key=None, clip=None):
    """
    本瓦葺きの屋根面（平瓦の列と、その継ぎ目を覆う丸瓦の列）。a0〜a1 は軒と平行な範囲、s_top〜軒（F.p.length）が流れの範囲。
    一番下の列は軒瓦（平瓦は垂れ付き、丸瓦は先に丸い瓦当）。verge は左右の端の袖（垂れの板）。
    瓦は 1 枚ずつ別の島（色むら・わずかなずれ）。disc: 'full'（厚みと中心の飾り）/'flat'（面だけ）
    disc_key: 瓦当（丸い面）だけ別の材質キーへ（空を映して光りすぎないよう暗く・ざらつかせるため）
    clip: clip(世界座標の点) が True の瓦は置かない（屋根どうしの取り合いで下に隠れる瓦を抜く）
    """
    rng = np.random.default_rng(seed)
    S = F.p.length
    width = a1 - a0
    ncol = max(1, int(round(width / pitch)))
    pitch = width / ncol
    hw = pitch * 0.9
    # 列（軒 = 0 から上へ）：(s0 上端, s1 下端, 軒か)
    rows = []
    k = 0
    while True:
        s1 = S - k * row + (proj if k == 0 else 0.0)
        top = S - (k + 1) * row
        s0 = max(s_top, top - ov)
        if s1 - s0 > 0.05:
            rows.append((s0, s1, k == 0))
        if top <= s_top + 0.02:
            break
        k += 1
    h0 = sag + 0.004

    def keep(a):
        return skip_a is None or not (skip_a[0] <= a <= skip_a[1])

    # 平瓦
    for c in range(ncol):
        ac = a0 + (c + 0.5) * pitch
        if not keep(ac):
            continue
        for (s0, s1, is_eave) in rows:
            da = rng.normal(0, 0.003)
            lift = abs(rng.normal(0, 0.002))
            ds = rng.normal(0, 0.004)
            if clip is not None and clip(F.pt(ac, (s0 + s1) / 2, 0.0)):
                continue
            prof = []
            for i in range(hseg + 1):
                f = i / hseg
                prof.append((ac + da + (f - 0.5) * hw, 0.003 + sag * (2 * f - 1) ** 2 + lift))
            verts = [F.pt(a, s0 + ds, h) for (a, h) in prof]
            verts += [F.pt(a, s1 + ds, h + t) for (a, h) in prof]
            m = hseg + 1
            verts += [F.pt(a, s1 + ds, h + t) for (a, h) in prof]
            hmin = 0.003 + lift
            verts += [F.pt(a, s1 + ds, (hmin - eave_drop) if is_eave else h) for (a, h) in prof]
            faces, want = [], []
            nrm, tan = F.normal((s0 + s1) / 2), F.tangent(s1)
            for i in range(hseg):
                faces.append((i, i + 1, m + i + 1, m + i))
                want.append(nrm)
            if is_eave or inner_lips:
                for i in range(hseg):
                    faces.append((2 * m + i, 2 * m + i + 1, 3 * m + i + 1, 3 * m + i))
                    want.append(tan)
            g.oriented(key, verts, faces, want, smooth=True)
    # 丸瓦（継ぎ目の上。端の列も）
    for c in range(ncol + 1):
        ac = a0 + c * pitch
        if not keep(ac):
            continue
        edge = c == 0 or c == ncol
        for (s0, s1, is_eave) in rows:
            da = rng.normal(0, 0.002)
            ds = rng.normal(0, 0.004)
            s1e = s1 + (0.025 if is_eave else 0.0) + ds
            if clip is not None and clip(F.pt(ac, (s0 + s1) / 2, 0.0)):
                continue
            ring0, ring1, ring2 = [], [], []
            for j in range(mseg + 1):
                th = math.pi * j / mseg
                cx, sy = math.cos(th), math.sin(th)
                ring0.append(F.pt(ac + da + r * cx, s0 + ds, h0 + r * 0.92 * sy))
                ring1.append(F.pt(ac + da + (r + 0.006) * cx, s1e, h0 + t * 0.6 + (r + 0.006) * 0.92 * sy))
                ring2.append(F.pt(ac + da + (r - 0.016) * cx, s1e, h0 + (r - 0.016) * 0.92 * sy))
            m = mseg + 1
            verts = ring0 + ring1 + list(ring1) + ring2
            faces, want = [], []
            for j in range(mseg):
                faces.append((j, j + 1, m + j + 1, m + j))
                th = math.pi * (j + 0.5) / mseg
                want.append(F.A * math.cos(th) + F.normal(s0) * math.sin(th))
            tan = F.tangent(s1)
            for j in range(mseg):
                faces.append((2 * m + j, 2 * m + j + 1, 3 * m + j + 1, 3 * m + j))
                want.append(tan)
            g.oriented(key, verts, faces, want, smooth=True)
            if is_eave and disc:
                # 瓦当（丸い面）
                dkey = disc_key or key
                nd = 10 if disc == 'full' else 8
                rd = r + 0.012
                cc = (ac + da, h0 + 0.004)
                front = [F.pt(cc[0] + rd * math.cos(2 * math.pi * i / nd), s1e + 0.004, cc[1] + rd * math.sin(2 * math.pi * i / nd)) for i in range(nd)]
                if disc == 'full':
                    back = [F.pt(cc[0] + rd * math.cos(2 * math.pi * i / nd), s1e - 0.03, cc[1] + rd * math.sin(2 * math.pi * i / nd)) for i in range(nd)]
                    vs = front + back
                    fs = [tuple(range(nd))] + [(i, (i + 1) % nd, nd + (i + 1) % nd, nd + i) for i in range(nd)]
                    ws = [tan] + [F.A * math.cos(2 * math.pi * (i + 0.5) / nd) + F.normal(s1) * math.sin(2 * math.pi * (i + 0.5) / nd) for i in range(nd)]
                    g.oriented(dkey, vs, fs, ws)
                    # 中心の小さな飾り（巴の代わりの丸い膨らみ）
                    nb = 6
                    rb = r * 0.42
                    fb = [F.pt(cc[0] + rb * math.cos(2 * math.pi * i / nb), s1e + 0.016, cc[1] + rb * math.sin(2 * math.pi * i / nb)) for i in range(nb)]
                    bb = [F.pt(cc[0] + rb * 1.15 * math.cos(2 * math.pi * i / nb), s1e + 0.003, cc[1] + rb * 1.15 * math.sin(2 * math.pi * i / nb)) for i in range(nb)]
                    vs = fb + bb
                    fs = [tuple(range(nb))] + [(i, (i + 1) % nb, nb + (i + 1) % nb, nb + i) for i in range(nb)]
                    ws = [tan] + [F.A * math.cos(2 * math.pi * (i + 0.5) / nb) + F.normal(s1) * math.sin(2 * math.pi * (i + 0.5) / nb) + tan * 0.5 for i in range(nb)]
                    g.oriented(dkey, vs, fs, ws, smooth=True)
                else:
                    g.oriented(dkey, front, [tuple(range(nd))], tan)
        # 袖（端の垂れ）
        if edge and verge[0 if c == 0 else 1]:
            sgn = -1.0 if c == 0 else 1.0
            aa = ac + sgn * (r + 0.004)
            ss = [s_top] + [s1 for (_, s1, _) in reversed(rows[1:])] + [S + proj + 0.02]
            ss = sorted(set(round(x, 4) for x in ss))
            top = [F.pt(aa, s, h0 + 0.01) for s in ss]
            bot = [F.pt(aa, s, h0 - 0.1) for s in ss]
            n2 = len(ss)
            top_in = [F.pt(aa - sgn * 0.022, s, h0 + 0.01) for s in ss]
            bot_in = [F.pt(aa - sgn * 0.022, s, h0 - 0.1) for s in ss]
            vs = top + bot + top_in + bot_in
            fs, ws = [], []
            for i in range(n2 - 1):
                fs.append((i, i + 1, n2 + i + 1, n2 + i))
                ws.append(F.A * sgn)
                fs.append((n2 + i, n2 + i + 1, 3 * n2 + i + 1, 3 * n2 + i))
                ws.append(-F.normal(ss[i]))
                fs.append((2 * n2 + i, 2 * n2 + i + 1, 3 * n2 + i + 1, 3 * n2 + i))
                ws.append(-F.A * sgn)
            fs.append((n2 - 1, 2 * n2 - 1, 4 * n2 - 1, 3 * n2 - 1))
            ws.append(F.tangent(S))
            g.oriented(key, vs, fs, ws)
    return rows


def ridge(g, key, P0, P1, zb, *, w0=0.36, layers=4, lh=0.045, cap_r=0.1, piece=0.33, noshi_piece=0.6,
          oni=(True, True), oni_scale=1.0, menado_key=None, menado_h=0.1, seed=0, cap_seg=7):
    """
    棟：面戸の漆喰、熨斗瓦の段（上ほど細く）、冠瓦（半円）、両端の鬼瓦。P0→P1 は水平の棟の線、zb は瓦の上面の高さ
    返り値は棟の上端の高さ
    """
    rng = np.random.default_rng(seed)
    P0, P1 = V((P0[0], P0[1], zb)), V((P1[0], P1[1], zb))
    L, ax, ay, az = frame_of(P0, P1, EZ)
    ay = EZ.cross(ax).normalized()
    if menado_key:
        c = (P0 + P1) / 2 + EZ * (-menado_h / 2 + 0.02)
        obox(g, menado_key, c, ax, ay, EZ, L / 2 - 0.04, w0 / 2 + 0.035, menado_h / 2, seg=max(1, int(L / 1.0)))
    z = zb + 0.02
    for k in range(layers):
        w = w0 - 0.026 * k
        n = max(1, int(round(L / noshi_piece)))
        pl = L / n
        for i in range(n):
            d = rng.normal(0, 0.004)
            c = P0 + ax * (pl * (i + 0.5)) + ay * d + EZ * (z - zb + lh / 2 + rng.normal(0, 0.0015))
            obox(g, key, c, ax, ay, EZ, pl / 2 - 0.003, w / 2, lh / 2 - 0.003)
        z += lh
    # 冠瓦
    n = max(1, int(round(L / piece)))
    pl = L / n
    for i in range(n):
        a0 = pl * i - 0.01
        a1 = a0 + pl + 0.02
        verts, faces, want = [], [], []
        for aa in (a0, a1):
            for s in range(cap_seg + 1):
                th = math.pi * s / cap_seg
                verts.append(P0 + ax * aa + ay * (math.cos(th) * cap_r) + EZ * (z - zb - 0.02 + math.sin(th) * cap_r * 0.85))
        m = cap_seg + 1
        for s in range(cap_seg):
            faces.append((s, s + 1, m + s + 1, m + s))
            th = math.pi * (s + 0.5) / cap_seg
            want.append(ay * math.cos(th) + EZ * math.sin(th))
        # 重なりの段（1 枚ごとの継ぎ目）
        if i < n - 1:
            b0, b1 = a1 - 0.035, a1
            base = len(verts)
            for aa in (b0, b1):
                for s in range(cap_seg + 1):
                    th = math.pi * s / cap_seg
                    rr = cap_r + 0.012
                    verts.append(P0 + ax * aa + ay * (math.cos(th) * rr) + EZ * (z - zb - 0.02 + math.sin(th) * (rr * 0.85)))
            for s in range(cap_seg):
                faces.append((base + s, base + s + 1, base + m + s + 1, base + m + s))
                th = math.pi * (s + 0.5) / cap_seg
                want.append(ay * math.cos(th) + EZ * math.sin(th))
            # 段の前の面（下り側）
            ring_hi = [base + s for s in range(m)]
            ring_lo = [s + m for s in range(m)]
            for s in range(cap_seg):
                faces.append((ring_lo[s], ring_lo[s + 1], ring_hi[s + 1], ring_hi[s]))
                want.append(-ax)
        g.oriented(key, [V(v) for v in verts], faces, want, smooth=True)
    ztop = z - 0.02 + cap_r * 0.85
    # 鬼瓦
    for end, on in ((0, oni[0]), (1, oni[1])):
        if not on:
            continue
        s = oni_scale
        H = (ztop - zb) + 0.24 * s
        hw = (w0 / 2 + 0.08) * s
        outline = [(-hw, -0.1 * s), (hw, -0.1 * s), (hw, H * 0.42), (hw + 0.06 * s, H * 0.5), (hw + 0.05 * s, H * 0.62),
                   (hw - 0.04 * s, H * 0.66), (hw * 0.66, H * 0.86), (hw * 0.32, H * 0.97), (0.0, H), (-hw * 0.32, H * 0.97),
                   (-hw * 0.66, H * 0.86), (-hw + 0.04 * s, H * 0.66), (-hw - 0.05 * s, H * 0.62), (-hw - 0.06 * s, H * 0.5), (-hw, H * 0.42)]
        sgn = -1 if end == 0 else 1
        base_p = (P0 if end == 0 else P1) + ax * (sgn * 0.02)
        O = base_p + EZ * 0.0
        extrude_outline(g, key, outline, O, ay, EZ, -ax * sgn, 0.12)
        # 表の丸い飾り（輪と中心）
        cc = O + EZ * (H * 0.5) + ax * (sgn * 0.02)
        cylinder(g, key, cc - ax * sgn * 0.02, cc + ax * sgn * 0.035, 0.09 * s, seg=12, caps=(False, True))
        cylinder(g, key, cc - ax * sgn * 0.02, cc + ax * sgn * 0.02, 0.15 * s, seg=14, caps=(False, True))
    return ztop


# ---------------------------------------------------------------------------
# 石積み（面ごとに段を組み、石を 1 個ずつ：縁の面取りと面の膨らみ）
# ---------------------------------------------------------------------------

def _inset(pts, d, limit=2.5):
    """多角形（反時計回り）を辺ごとに d だけ内側へ"""
    P = np.asarray(pts, np.float64)
    n = len(P)
    out = []
    for i in range(n):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % n]
        e0, e1 = p1 - p0, p2 - p1
        l0, l1 = np.linalg.norm(e0), np.linalg.norm(e1)
        if l0 < 1e-9 or l1 < 1e-9:
            out.append(p1)
            continue
        n0 = np.array([-e0[1], e0[0]]) / l0
        n1 = np.array([-e1[1], e1[0]]) / l1
        A = np.array([n0, n1])
        b = np.array([np.dot(p0 + n0 * d, n0), np.dot(p1 + n1 * d, n1)])
        det = np.linalg.det(A)
        q = p1 + (n0 + n1) / 2 * d if abs(det) < 1e-6 else np.linalg.solve(A, b)
        v = q - p1
        if np.linalg.norm(v) > limit * d:
            q = p1 + v / np.linalg.norm(v) * limit * d
        out.append(q)
    return out


def _area(pts):
    P = np.asarray(pts)
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _ccw(pts):
    return pts if _area(pts) > 0 else list(reversed(pts))


def _dedupe(pts, eps=0.02):
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def course_stones(rng, u0, u1, zlo, zhi, blo, bhi, *, wmin=0.45, wmax=1.05, slant=0.05, corner_p=0.28, split_p=0.18, kink_p=0.35):
    """
    1 段分の石の輪郭（(u, z) の多角形、反時計回り）。blo/bhi は下と上の境の高さの関数（波打つ）。
    ときどき角を欠いて小さな詰め石を入れ、大きな石を 2 つに割る。返り値 [(pts, small?)]
    """
    out = []
    h = zhi - zlo
    js = [(u0, u0)]
    u = u0
    while True:
        w = rng.uniform(wmin, wmax) * (0.75 + 0.5 * h / 0.5) / 1.0
        if u + w > u1 - wmin * 0.55:
            break
        u += w
        jb = u + rng.normal(0, slant)
        jt = u + rng.normal(0, slant)
        js.append((jb, jt))
    js.append((u1, u1))

    def edge_pts(ua, ub, f, n_extra):
        pts = []
        for k in range(1, n_extra + 1):
            uu = ua + (ub - ua) * (k / (n_extra + 1) + rng.uniform(-0.12, 0.12) / (n_extra + 1))
            pts.append((uu, f(uu)))
        return pts

    for i in range(len(js) - 1):
        (lb, lt), (rb, rt) = js[i], js[i + 1]
        wb = rb - lb
        nb = 1 if wb > 0.5 else 0
        poly = [(lb, blo(lb))] + edge_pts(lb, rb, blo, nb) + [(rb, blo(rb))]
        # 右の辺（ときどき折れ）
        if rng.random() < kink_p:
            zm = (blo(rb) + bhi(rt)) / 2 + rng.normal(0, 0.03)
            poly.append(((rb + rt) / 2 + rng.normal(0, 0.03), zm))
        poly.append((rt, bhi(rt)))
        top = edge_pts(rt, lt, bhi, nb)
        poly += top + [(lt, bhi(lt))]
        if rng.random() < kink_p:
            zm = (blo(lb) + bhi(lt)) / 2 + rng.normal(0, 0.03)
            poly.append(((lb + lt) / 2 + rng.normal(0, 0.03), zm))
        poly = _dedupe(poly)
        # 角を欠いて詰め石
        small = []
        for corner in ('tl', 'tr', 'br'):
            if rng.random() < corner_p / 3 and len(poly) >= 4:
                idx = {'tl': [k for k, p in enumerate(poly) if abs(p[0] - lt) < 1e-6 and abs(p[1] - bhi(lt)) < 1e-6],
                       'tr': [k for k, p in enumerate(poly) if abs(p[0] - rt) < 1e-6 and abs(p[1] - bhi(rt)) < 1e-6],
                       'br': [k for k, p in enumerate(poly) if abs(p[0] - rb) < 1e-6 and abs(p[1] - blo(rb)) < 1e-6]}[corner]
                if not idx:
                    continue
                k = idx[0]
                pc = np.array(poly[k])
                pp = np.array(poly[k - 1])
                pn = np.array(poly[(k + 1) % len(poly)])
                d = rng.uniform(0.09, 0.17)
                a = pc + (pp - pc) / max(np.linalg.norm(pp - pc), 1e-6) * min(d, 0.45 * np.linalg.norm(pp - pc))
                b = pc + (pn - pc) / max(np.linalg.norm(pn - pc), 1e-6) * min(d * rng.uniform(0.8, 1.3), 0.45 * np.linalg.norm(pn - pc))
                poly = poly[:k] + [tuple(a), tuple(b)] + poly[k + 1:]
                small.append([tuple(pc), tuple(b), tuple(a)])
        poly = _ccw(poly)
        # 大きな石を割る
        if (rb - lb) > 0.8 and rng.random() < split_p:
            f = rng.uniform(0.38, 0.62)
            cb, ct = lb + (rb - lb) * f + rng.normal(0, 0.04), lt + (rt - lt) * f + rng.normal(0, 0.04)
            # 左右 2 つの四角に近い石に作り直す（欠いた角の詰め石はそのまま）
            L = _ccw(_dedupe([(lb, blo(lb)), (cb, blo(cb)), (ct, bhi(ct)), (lt, bhi(lt))]))
            R = _ccw(_dedupe([(cb, blo(cb)), (rb, blo(rb)), (rt, bhi(rt)), (ct, bhi(ct))]))
            small = []
            out.append((L, False))
            out.append((R, False))
        elif h > 0.42 and (rb - lb) > 0.55 and rng.random() < split_p * 0.8:
            zm = lambda uu: blo(uu) + (bhi(uu) - blo(uu)) * rng.uniform(0.4, 0.6)
            zl, zr = zm(lb), zm(rb)
            B = _ccw(_dedupe([(lb, blo(lb)), (rb, blo(rb)), (rb + (rt - rb) * 0.5, zr), (lb + (lt - lb) * 0.5, zl)]))
            T = _ccw(_dedupe([(lb + (lt - lb) * 0.5, zl), (rb + (rt - rb) * 0.5, zr), (rt, bhi(rt)), (lt, bhi(lt))]))
            out.append((B, True))
            out.append((T, True))
            small = []
        else:
            out.append((poly, False))
        for s in small:
            out.append((_ccw(s), True))
    return out


class FaceMap:
    """石積みの面：(u, z) → 3 次元。C は面の始まりの足元（芯の面上）、U は面に沿う水平、N は外向きの水平、batter は高さ 1 m あたりの内側への傾き"""

    def __init__(self, C, U, N, batter):
        self.C, self.U, self.N, self.b = V(C), V(U).normalized(), V(N).normalized(), batter
        self.Nf = (self.N + EZ * batter).normalized()

    def pt(self, u, z, h=0.0):
        return self.C + self.U * u + self.N * (-self.b * z) + EZ * z + self.Nf * h


def _jag(poly, rng, amp=0.018, step=0.16):
    """輪郭の辺を細かく折る（割った石のふぞろいな縁）"""
    out = []
    n = len(poly)
    for i in range(n):
        a, b = np.asarray(poly[i]), np.asarray(poly[(i + 1) % n])
        out.append(tuple(a))
        L = float(np.linalg.norm(b - a))
        k = int(L / step)
        if k < 1:
            continue
        nrm = np.array([-(b - a)[1], (b - a)[0]]) / max(L, 1e-9)
        for j in range(1, k + 1):
            t = j / (k + 1) + rng.uniform(-0.15, 0.15) / (k + 1)
            out.append(tuple(a + (b - a) * t + nrm * rng.normal(0, amp)))
    return out


def stone_pillow(g, key, fm: FaceMap, poly, rng, *, gap=(0.016, 0.032), bulge=(0.035, 0.07), small=False, tile=(2.0, 2.0),
                 detail=True, bevel=(0.075, 0.24), face0=None, tilt=0.06, wav=(0.012, 0.006), jag=(0.01, 0.013), joint_h=-0.015,
                 jag_step=(0.14, 0.22)):
    """
    1 個の石：面取りした縁（平らな面で、欠けたような段）と、わずかに傾いてうねる割り肌の面（なめらか）。
    UV は面の (u, z) を平らに投影（石ごとにずらす）
    """
    gp = rng.uniform(*gap) if isinstance(gap, tuple) else gap
    poly = _jag(poly, rng, amp=jag[0] if small else jag[1], step=(jag_step[0] if small else jag_step[1]) if detail else 0.45)
    ring0 = _inset(_ccw(poly), gp / 2)
    if _area(ring0) < 0.004:
        return 0
    P = np.asarray(ring0)
    c = P.mean(0)
    rad = np.linalg.norm(P - c, axis=1)
    size = math.sqrt(max(_area(ring0), 1e-6))
    bl = rng.uniform(*bulge) * (0.75 if small else 1.0) * min(1.0, size / 0.4 + 0.35)
    bev = min(bevel[0], bevel[1] * size) * rng.uniform(0.8, 1.2)
    shrink = np.clip(1 - bev * rng.uniform(0.6, 1.4, len(P)) / np.maximum(rad, 1e-6), 0.25, 0.97)
    r1 = c + (P - c) * shrink[:, None]
    tl = rng.normal(0, tilt, 2)
    wob = rng.uniform(0, 6.28, 4)
    fu, fz = rng.uniform(4, 9, 2)

    def hfun(p, base):
        du, dz = p[0] - c[0], p[1] - c[1]
        return base + tl[0] * du + tl[1] * dz + wav[0] * math.sin(fu * p[0] + wob[0]) * math.cos(fz * p[1] + wob[1]) \
            + wav[1] * math.sin(2.3 * fu * p[1] + wob[2])
    n = len(P)
    verts, uv = [], []
    ou, oz = rng.uniform(0, tile[0]), rng.uniform(0, tile[1])

    def put(p, h):
        verts.append(fm.pt(p[0], p[1], h))
        uv.append(((p[0] + ou) / tile[0], (p[1] + oz) / tile[1]))
    if face0 is None:
        h1 = [max(0.004, hfun(p, bl * rng.uniform(0.62, 0.85))) for p in r1]
    else:
        # 平らな面（打込接ぎ）：面の基準の高さ face0 に、わずかな傾きとうねり
        h1 = [max(0.006, hfun(p, face0 + bl * rng.uniform(0.2, 0.45))) for p in r1]
    for p in P:
        put(p, joint_h)
    for p, h in zip(r1, h1):
        put(p, h)
    # 縁（丸みのある面取り）
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    g.oriented(key, verts, faces, fm.Nf, smooth=True, uv=uv)
    # 面（なめらか）：縁の内側の輪を複製して、面の法線が縁に引っぱられないように
    verts, uv = [], []
    for p, h in zip(r1, h1):
        put(p, h)
    if small or not detail:
        put(c, max(0.0, hfun(c, bl if face0 is None else face0 + bl)))
        faces = [(i, (i + 1) % n, n) for i in range(n)]
    else:
        r2 = c + (r1 - c) * 0.5
        b2, b3 = (bl * 0.96, bl) if face0 is None else (face0 + bl * 0.8, face0 + bl)
        for p in r2:
            put(p, max(0.0, hfun(p, b2)))
        put(c, max(0.0, hfun(c, b3)))
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
            faces.append((n + i, n + j, 2 * n))
    g.oriented(key, verts, faces, fm.Nf, smooth=True, uv=uv)
    return len(faces)


def wall_block(g, key, fmA: FaceMap, fmB: FaceMap, u_in, u_end, z0, z1, *, bulge=0.05, ch=0.035, gap=0.022,
               tile=(2.0, 2.0), rng=None):
    """
    壁の端の隅石（算木積み）：両面を貫く面取りした塊。fmA / fmB は両面の写像（同じ U を共有）。
    u_end が壁の端、u_in が内側の目地。面は FaceMap の外向き＋bulge
    """
    rng = rng or np.random.default_rng(0)
    e = 1.0 if u_end > u_in else -1.0
    z0 += gap / 2
    z1 -= gap / 2

    def ring(z, ins):
        h = bulge - ins * 0.6
        return [fmA.pt(u_in + e * (gap / 2 + ins), z, h), fmA.pt(u_end - e * (ch + ins), z, h), fmA.pt(u_end - e * ins, z, h - ch),
                fmB.pt(u_end - e * ins, z, h - ch), fmB.pt(u_end - e * (ch + ins), z, h), fmB.pt(u_in + e * (gap / 2 + ins), z, h)]
    rings = [ring(z0, ch * 0.8), ring(z0 + ch, 0.0), ring(z1 - ch, 0.0), ring(z1, ch * 0.8)]
    m = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for k in range(3):
        for i in range(m):
            j = (i + 1) % m
            faces.append((k * m + i, k * m + j, (k + 1) * m + j, (k + 1) * m + i))
    faces.append(tuple(range(m)))
    faces.append(tuple(3 * m + i for i in range(m)))
    c = sum(verts, V()) / len(verts)
    ou, oz = rng.uniform(0, 2), rng.uniform(0, 2)
    uv = []
    for p in verts:
        d = p - fmA.C
        uv.append(((d.dot(fmA.U) + d.dot(fmA.N) * 0.8 + ou) / tile[0], (p.z + oz) / tile[1]))
    g.convex(key, verts, faces, smooth=False, center=c, uv=uv)


# ---------------------------------------------------------------------------
# 物体へ
# ---------------------------------------------------------------------------

def to_objects(g: Geo, prefix: str, custom: dict | None = None) -> list:
    """キーごとに 1 物体（頂点は世界座標、物体の変換は単位）"""
    custom = custom or {}
    objs = []
    for key, p in g.parts.items():
        if not p['f']:
            continue
        me = bpy.data.meshes.new(f'{prefix}_{key}')
        me.from_pydata([tuple(v) for v in p['v']], [], p['f'])
        me.update(calc_edges=True)
        me.polygons.foreach_set('use_smooth', p['sm'])
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        lib = key.split('#')[0]
        if key in custom:
            me.materials.append(custom[key])
        elif lib in custom:
            me.materials.append(custom[lib])
        else:
            mats.assign(ob, lib)
        if p['uv'] and len(p['uv']) == len(p['v']):
            uvl = me.uv_layers.new(name='UVMap')
            buf = np.array(p['uv'], np.float32)
            lv = np.empty(len(me.loops), np.int64)
            me.loops.foreach_get('vertex_index', lv)
            uvl.data.foreach_set('uv', buf[lv].ravel())
            ob['koto_has_uv'] = True
        ob['koto_key'] = key
        ob['koto_lib'] = lib
        objs.append(ob)
    bpy.context.view_layer.update()
    return objs


def set_color(ob, rgb):
    """頂点色 'Col' を一様な色に（無ければ作る）"""
    me = ob.data
    a = mats._color_attr(me, mats.COLOR_ATTR)
    buf = np.empty(len(a.data) * 4, np.float32)
    a.data.foreach_get('color', buf)
    buf = buf.reshape(-1, 4)
    buf[:, 0], buf[:, 1], buf[:, 2] = rgb
    buf[:, 3] = 1.0
    a.data.foreach_set('color', buf.ravel())
    mats._set_active_color(me, mats.COLOR_ATTR)


def scale_color(ob, k):
    me = ob.data
    a = mats._color_attr(me, mats.COLOR_ATTR)
    buf = np.empty(len(a.data) * 4, np.float32)
    a.data.foreach_get('color', buf)
    buf = buf.reshape(-1, 4)
    buf[:, :3] *= np.asarray(k, np.float32)
    a.data.foreach_set('color', buf.ravel())
    mats._set_active_color(me, mats.COLOR_ATTR)


def finish(objs, *, tint=None, densify=None, gains=None, seed=0):
    """UV（明示の UV が無ければ材質の種類に合わせて）、細分（AO 用）、色むら、明るさの調整"""
    tint = tint or {}
    densify = densify or {}
    gains = gains or {}
    for i, ob in enumerate(objs):
        key, lib = ob['koto_key'], ob['koto_lib']
        if lib in mats.CATALOG and not ob.get('koto_has_uv'):
            mats.uv_auto(ob, seed=seed + i)
        d = densify.get(key, densify.get(lib))
        if d:
            mats.densify(ob, d)
        t = tint.get(key, tint.get(lib))
        if t:
            mats.tint_islands(ob, seed=seed + 31 * i, amount=t[0], warm=t[1])
        if ob.data.color_attributes.get(mats.COLOR_ATTR) is None:
            set_color(ob, (1.0, 1.0, 1.0))
        k = gains.get(key, gains.get(lib))
        if k is not None:
            scale_color(ob, k)


def game_rect(x0, x1, y0, y1):
    """Blender の XY の長方形 → ゲームの {x0,x1,z0,z1}"""
    return dict(x0=round(min(x0, x1), 3), x1=round(max(x0, x1), 3), z0=round(min(-y0, -y1), 3), z1=round(max(-y0, -y1), 3))


def game_box(x0, x1, y0, y1, z0, z1):
    r = game_rect(x0, x1, y0, y1)
    return dict(x0=r['x0'], x1=r['x1'], y0=round(z0, 3), y1=round(z1, 3), z0=r['z0'], z1=r['z1'])


def write_meta(path, name, colliders, blockers, extra=None):
    d = {'name': name, 'coords': 'game (x east, y up, z south), meters', 'colliders': colliders, 'camera_blockers': blockers}
    if extra:
        d.update(extra)
    pathlib.Path(path).write_text(json.dumps(d, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------------------
# 確認用
# ---------------------------------------------------------------------------

def preview_ground(cx=0.0, cy=0.0, size=120.0, n=24):
    """確認用の地面（土の道）。書き出しには入れない"""
    me = bpy.data.meshes.new('_preview_ground')
    s = size / 2
    verts = [(cx - s + 2 * s * i / n, cy - s + 2 * s * j / n, 0.0) for j in range(n + 1) for i in range(n + 1)]
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


def torus(g, key, c, axis, R, r, seg=12, segv=4):
    """輪（引き手の鐶など）"""
    c = V(c)
    ax = V(axis).normalized()
    t1 = (EX if abs(ax.x) < 0.9 else EY).cross(ax).normalized()
    t2 = ax.cross(t1)
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = t1 * math.cos(a) + t2 * math.sin(a)
        for j in range(segv):
            b = 2 * math.pi * j / segv
            verts.append(c + d * (R + r * math.cos(b)) + ax * (r * math.sin(b)))
    faces, want = [], []
    for i in range(seg):
        for j in range(segv):
            i2, j2 = (i + 1) % seg, (j + 1) % segv
            faces.append((i * segv + j, i2 * segv + j, i2 * segv + j2, i * segv + j2))
            a = 2 * math.pi * (i + 0.5) / seg
            b = 2 * math.pi * (j + 0.5) / segv
            d = t1 * math.cos(a) + t2 * math.sin(a)
            want.append(d * math.cos(b) + ax * math.sin(b))
    g.oriented(key, verts, faces, want, smooth=True)


def stud(g, key, p, n, r=0.018, h=0.012, seg=6):
    """鋲の頭（低い角錐）。p は面の上の点、n は面の外向き"""
    p, n = V(p), V(n).normalized()
    t1 = (EX if abs(n.x) < 0.9 else EY).cross(n).normalized()
    t2 = n.cross(t1)
    verts = [p + (t1 * math.cos(2 * math.pi * i / seg) + t2 * math.sin(2 * math.pi * i / seg)) * r - n * 0.002 for i in range(seg)]
    verts.append(p + n * h)
    faces = [(i, (i + 1) % seg, seg) for i in range(seg)]
    g.oriented(key, verts, faces, n, smooth=True)


# ---------------------------------------------------------------------------
# この組で足す材質（共有ライブラリ lib/mats.py は変えず、実行時に目録へ登録する）
# ---------------------------------------------------------------------------

def _gen_timber(n, seed, tile):
    """門の太い材（欅・栗の古材）：2〜4 cm の粗い年輪の縞、ゆるい波、浮造りの凹凸、細かい干割れ。色は頂点色で暖かく暗くする前提の中間の茶灰"""
    return mats._gen_wood(n, seed, tile, mats.rgb(136, 120, 103), mats.rgb(90, 78, 66), rings=20, warp=1.4,
                          gray=mats.rgb(124, 118, 110), weather=0.18, checks=40, relief=0.0012, rough=(0.68, 0.88), mott=0.08)


def _gen_ishigaki(n, seed, tile):
    """打込接ぎの石の面：ごま塩の粒の対比を 6 割おさえ、10〜30 cm の濃淡のむら。明るい温かい灰色"""
    d = mats._gen_granite(n, seed, tile, cells=280, macro=0.0, warm=0.3, split=0.0014, pits=0.0007)
    col = d['albedo']
    low = mats.blur(col, 5)
    col = low + 0.4 * (col - low)
    sh = (n, n)
    m1 = mats.snoise(sh, seed + 90, fmin=6, fmax=20, beta=1.0)      # 10〜30 cm（2 m の繰り返しで 6〜20 波）
    m2 = mats.snoise(sh, seed + 91, fmin=1.5, fmax=6, beta=1.2)
    warm = mats.snoise(sh, seed + 92, fmin=2, fmax=12, beta=1.0)
    col = col * (1 + 0.04 * m1 + 0.03 * m2)[..., None]
    col = col * (1 + 0.018 * warm[..., None] * np.array([1.0, 0.2, -0.8], np.float32))
    col = col / col.reshape(-1, 3).mean(0) * mats.rgb(150, 143, 131)
    d['albedo'] = np.clip(col, 0, 1)
    d['rough'] = np.clip(d['rough'] + 0.04, 0.6, 0.97)
    return d


EXTRA_MATS = {
    'wood_timber': dict(tile=(2.4, 0.6), size=1024, uv='along', nstr=1.0, seed=611, gen=_gen_timber,
                        doc='門の太い柱・梁（粗い年輪、2.4 m で繰り返し）。頂点色で暗い焦げ茶にする。'),
    'stone_ishigaki': dict(tile=(2.0, 2.0), size=1024, uv='box', nstr=1.0, seed=621, gen=_gen_ishigaki,
                           doc='打込接ぎの石垣の面（粒の対比をおさえた温かい灰色、10〜30 cm のむら）。'),
}


EXTRA_VERSION = 'g3'   # 画像の合成の手順を変えたら上げる（作り置きの画像を作り直す）


def register_materials():
    for k, v in EXTRA_MATS.items():
        if k not in mats.CATALOG:
            mats.CATALOG[k] = v
            mats.NAMES.append(k)
        stamp = mats.TEX_DIR / f'{k}_{mats.TEX_VERSION}.stamp'
        if not stamp.exists() or stamp.read_text() != EXTRA_VERSION:
            mats.build_textures(k, force=True)
            stamp.write_text(EXTRA_VERSION)


register_materials()


def variant_material(lib, tag, *, rough=None):
    """
    ライブラリ材質の変種（名前 '<lib>#<tag>@vc'、頂点色を掛ける版の複製）。rough を渡すと粗さを一定に（ORM 画像を外す）。
    名前が '@vc' で終わるので bake_ao_to_color が別の材質に替えない。koto_lib は残す（uv_auto が使う）
    """
    name = f'{lib}#{tag}@vc'
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = mats.get(lib, vcol=True).copy()
    m.name = name
    if rough is not None:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for l in list(bsdf.inputs['Roughness'].links):
            nt.links.remove(l)
        bsdf.inputs['Roughness'].default_value = rough
        orm = nt.nodes.get('orm')
        if orm is not None:
            for l in list(orm.outputs['Color'].links):
                nt.links.remove(l)
            nt.nodes.remove(orm)
    return m


# ---------------------------------------------------------------------------
# 形の追加：面取りした石の塊、木鼻の輪郭、垂木（木口は別のキー）
# ---------------------------------------------------------------------------

def chamfer_box(g, key, c, ax, ay, az, hx, hy, hz, b=0.02, step=0.3, jitter=0.0, rng=None, bottom=False):
    """
    12 本の辺すべてを b だけ面取りした箱（切石）。面は step ごとに分割（AO の細かさ）。jitter は面の内側の点を法線方向へ
    わずかに動かす（はつり肌のうねり）。bottom=False なら下の面を作らない（地面に埋める石）
    """
    rng = rng or np.random.default_rng(0)
    c = V(c)
    ax, ay, az = V(ax).normalized(), V(ay).normalized(), V(az).normalized()
    h = np.array([hx, hy, hz], np.float64)
    inner = h - b

    def coords(k):
        m = max(1, int(math.ceil(2 * inner[k] / step)))
        return [-h[k]] + list(np.linspace(-inner[k], inner[k], m + 1)) + [h[k]]
    cs = [coords(k) for k in range(3)]
    index = {}
    verts, faces, want = [], [], []

    def vid(p):
        kk = tuple(round(float(x), 6) for x in p)
        if kk not in index:
            q = np.array(p, np.float64)
            inn = np.clip(q, -inner, inner)
            d = q - inn
            l1 = np.abs(d).sum()
            if l1 > 1e-9:
                q = inn + d * (b / l1)
            nz = np.count_nonzero(np.abs(d) > 1e-9)
            if jitter and nz == 1 and np.all(np.abs(inn) < inner - 1e-6 + (np.abs(d) > 1e-9) * 1e9):
                q = q + d / np.linalg.norm(d) * rng.normal(0, jitter)
            index[kk] = len(verts)
            verts.append(c + ax * q[0] + ay * q[1] + az * q[2])
        return index[kk]
    for a in range(3):
        o = [i for i in range(3) if i != a]
        for sgn in (-1.0, 1.0):
            if a == 2 and sgn < 0 and not bottom:
                continue
            A, B = cs[o[0]], cs[o[1]]
            for i in range(len(A) - 1):
                for j in range(len(B) - 1):
                    q = []
                    for (ii, jj) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        p = [0.0, 0.0, 0.0]
                        p[a] = sgn * h[a]
                        p[o[0]] = A[ii]
                        p[o[1]] = B[jj]
                        q.append(vid(p))
                    if len(set(q)) < 3:
                        continue
                    faces.append(tuple(q))
    g.convex(key, verts, faces, center=c)


def kibana_profile(u0, u1, z0, z1, *, ends=(True, True), depth=0.2, notch=True):
    """
    梁の側面の輪郭（u 長手・z 高さ、反時計回り）。端は木鼻の彫り：上は角のまま、下が繰形（くびれ→ふくらみ→反り上がり）で細くなる。
    depth は彫りが長手へ入る長さ
    """
    H = z1 - z0
    d = depth

    def end_pts(ue, sgn):
        # ue は端の u、sgn は内側への向き（+1: 端は u0 側）。上端から下へ
        return [(ue, z0 + H * 0.64), (ue + sgn * d * 0.06, z0 + H * 0.55), (ue + sgn * d * 0.05, z0 + H * 0.47),
                (ue + sgn * d * 0.14, z0 + H * 0.40)] + ([(ue + sgn * d * 0.26, z0 + H * 0.40), (ue + sgn * d * 0.3, z0 + H * 0.33)] if notch else []) + \
               [(ue + sgn * d * 0.44, z0 + H * 0.26), (ue + sgn * d * 0.55, z0 + H * 0.12), (ue + sgn * d * 0.72, z0 + H * 0.03), (ue + sgn * d, z0)]
    # 上の角（反時計回り：u0 上 → u0 側の彫り → 下の辺 → u1 側の彫り → u1 上）
    out = [(u0, z1)]
    if ends[0]:
        out += end_pts(u0, 1.0)
    else:
        out.append((u0, z0))
    if ends[1]:
        out += list(reversed(end_pts(u1, -1.0)))
    else:
        out.append((u1, z0))
    out.append((u1, z1))
    return _ccw(_dedupe(out, 1e-4))


def rafter(g, key, key_end, p0, p1, up, w, h, *, seg_len=0.35, top=False):
    """
    垂木：p0（元）→ p1（先）の角材。上の面は野地・化粧裏板に隠れるので作らない（top=False）。
    先の木口は別のキー key_end（頂点色で明るく＝一本ずつ読めるように）
    """
    L, axv, ayv, azv = frame_of(p0, p1, up)
    seg = max(1, int(math.ceil(L / seg_len)))
    hw, hh = w / 2, h / 2
    ring = [(hw, -hh), (hw, hh), (-hw, hh), (-hw, -hh)]   # (y, z)
    sides = [(0, 1, V(axv * 0) + ayv), (1, 2, azv), (2, 3, -ayv), (3, 0, -azv)]
    verts = []
    for k in range(seg + 1):
        pc = V(p0) + axv * (L * k / seg)
        for (y, z) in ring:
            verts.append(pc + ayv * y + azv * z)
    faces, want = [], []
    for k in range(seg):
        for (i, j, n) in sides:
            if not top and n == azv:
                continue
            faces.append((k * 4 + i, k * 4 + j, (k + 1) * 4 + j, (k + 1) * 4 + i))
            want.append(n)
    faces.append((0, 1, 2, 3))
    want.append(-axv)
    g.oriented(key, verts, faces, want)
    e = [V(p1) + ayv * y + azv * z for (y, z) in ring]
    g.oriented(key_end, e, [(0, 1, 2, 3)], axv)
