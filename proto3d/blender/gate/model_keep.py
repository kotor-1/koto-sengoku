"""
遠景の天守（scene.json の keep。南向き。100 m 以上離れて見るので形だけ、三角形は 1.5 万以下）。

- 反りのある石垣の天守台、白い漆喰の 3 重の本体（窓は暗い格子の帯）、各重の反りのある軒（先が持ち上がる隅）、
  白い軒裏、隅棟、正面の千鳥破風と唐破風、最上重は入母屋（妻が南）、棟の両端に鯱
- 手前（南 26 m）に本丸の石垣と白い土塀：天守台の足元と、遠くの地面の端を隠す
- 色は頂点色 'Col'（線形）に入れ、材質は基本色を頂点色から取る（つや消し・瓦・金）。石垣だけ自作の小さな画像
  （遠目の石の並び：段ごとに幅の違う石と暗い目地、8 m で繰り返し）に頂点色（AO）を掛ける
"""
from __future__ import annotations

import math

import bpy
import numpy as np

import mats
from gkit import EX, EY, EZ, SCENE, V, Geo, abox, extrude_outline, obox, set_color, to_objects

KX, KZ = SCENE['keep']['pos']
K = V((KX, -KZ, 0.0))

# 線形の色（sRGB から）
def _lin(c):
    c = np.asarray(c, np.float64) / 255.0
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


COL = {
    'plaster': _lin((212, 208, 198)),
    'soffit': _lin((186, 183, 176)),
    'stone': _lin((128, 123, 114)),
    'tile': _lin((78, 81, 88)),
    'ridge': _lin((62, 64, 70)),
    'window': _lin((48, 44, 40)),
    'wood': _lin((70, 58, 48)),
    'gold': _lin((196, 158, 72)),
}
MAT_OF = {'plaster': 'matte', 'soffit': 'matte', 'stone': 'matte', 'window': 'matte', 'wood': 'matte', 'tile': 'tile', 'ridge': 'tile',
          'gold': 'gold'}


def _material(name, rough, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    at = nt.nodes.new('ShaderNodeVertexColor')
    at.layer_name = mats.COLOR_ATTR
    nt.links.new(at.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def box_at(g, key, cx, cy, z0, hx, hy, z1):
    abox(g, key, cx - hx, cx + hx, cy - hy, cy + hy, z0, z1)


STONE_TILE = 8.0


def stone_quad(g, pts, want):
    """石垣の面（4 点）。UV は面に沿う水平の距離と高さ（メートル / STONE_TILE）"""
    a, b = pts[0], pts[1]
    d = (b - a)
    d.z = 0
    d = d.normalized()
    uv = []
    for p in pts:
        uv.append((((p - a).dot(d) + a.x * 0.37 + a.y * 0.61) / STONE_TILE, p.z / STONE_TILE))
    g.oriented('stone', pts, [(0, 1, 2, 3)], want, uv=uv)


def base(g, hx, hy, h, inset, z_bot=-3.0):
    """反りのある石垣（下は緩く、上ほど急：扇の勾配）。面ごとに分けて UV を付ける"""
    zs = [z_bot, h * 0.35, h * 0.7, h]
    ins = [0.0, inset * 0.55, inset * 0.87, inset]
    loops = []
    for z, d in zip(zs, ins):
        ax, ay = hx - d, hy - d
        loops.append([K + V((ax, -ay, z)), K + V((ax, ay, z)), K + V((-ax, ay, z)), K + V((-ax, -ay, z))])
    for k in range(3):
        for i in range(4):
            j = (i + 1) % 4
            quad = [loops[k][i], loops[k][j], loops[k + 1][j], loops[k + 1][i]]
            c = (quad[0] + quad[1]) / 2 - K
            stone_quad(g, quad, V((c.x, c.y, 0)).normalized())
    top = loops[3]
    g.oriented('stone', top, [(0, 1, 2, 3)], EZ, uv=[(p.x / STONE_TILE, p.y / STONE_TILE) for p in top])


def stone_texture(path, n=512, tile=STONE_TILE, seed=3):
    """遠くの石垣の画像（打込接の石の並び：段ごとに幅の違う石、暗い目地、石ごとの色の違い）。繰り返し可能"""
    rng = np.random.default_rng(seed)
    px = n / tile
    img = np.zeros((n, n, 3), np.float32)
    shade = np.zeros((n, n), np.float32)
    hs = []
    while sum(hs) < tile - 0.4:
        hs.append(rng.uniform(0.45, 0.8))
    hs = np.array(hs) * tile / sum(hs)
    ys = np.round(np.cumsum(np.concatenate([[0.0], hs])) * px).astype(int)
    base_c = np.array([150, 145, 136], np.float32) / 255.0
    for k in range(len(hs)):
        r0, r1 = ys[k], ys[k + 1]
        ws = []
        while sum(ws) < tile - 0.5:
            ws.append(rng.uniform(0.6, 1.7) * (hs[k] / 0.6) ** 0.5)
        ws = np.array(ws) * tile / sum(ws)
        off = rng.uniform(0, tile)
        edges = (off + np.cumsum(np.concatenate([[0.0], ws]))) * px
        for b in range(len(ws)):
            c = base_c * rng.uniform(0.62, 1.18) * np.array([1.0, 1.0 - rng.uniform(0, 0.04), 1.0 - rng.uniform(0, 0.08)])
            cols = np.arange(int(round(edges[b])), int(round(edges[b + 1]))) % n
            img[r0:r1][:, cols] = c
            # 石の面の丸み：上が明るく、下と目地の近くが暗い
            hh = max(1, r1 - r0)
            t = (np.arange(r0, r1) - r0) / hh
            shade[r0:r1][:, cols] = (0.08 * (t - 0.5))[:, None]
            jc = np.concatenate([cols[:3], cols[-2:]])
            shade[r0:r1][:, jc] = -0.45
        shade[r0:r0 + 3, :] = -0.5
    from mats import snoise
    noise = snoise((n, n), seed + 1, 8, 128, 1.0) * 0.05
    out = np.clip(img * (1 + shade[..., None]) * (1 + noise[..., None]), 0, 1)
    mats._save_png(path, out)      # 配列の行 0 が v=0
    return path


TILE_TILE = 4.0


def tile_quad(g, quad, want):
    """瓦の面（4 点）。UV は面の中の水平方向（軒と平行）と流れの方向（メートル / TILE_TILE）"""
    from gkit import newell
    n = newell(quad)
    if n.dot(V(want)) < 0:
        quad = list(reversed(quad))
        n = -n
    n = n.normalized()
    h = EZ.cross(n)
    h = h.normalized() if h.length > 1e-6 else EX
    sdir = n.cross(h)
    uv = [(p.dot(h) / TILE_TILE, p.dot(sdir) / TILE_TILE) for p in quad]
    g.add('tile', quad, [(0, 1, 2, 3)], smooth=False, uv=uv)


def tile_texture(path, n=256, tile=TILE_TILE, seed=5):
    """遠くの本瓦の画像：丸瓦の筋（明るい峰と暗い谷）と、段ごとの細い横の線。繰り返し可能"""
    rng = np.random.default_rng(seed)
    x = (np.arange(n) + 0.5) / n * tile
    ribs = int(round(tile / 0.32))
    ph = (x / tile * ribs) % 1.0
    prof = np.where(ph < 0.42, 1.0 + 0.22 * np.sin(ph / 0.42 * np.pi), 0.78 + 0.08 * np.sin((ph - 0.42) / 0.58 * np.pi))
    rows = int(round(tile / 0.3))
    y = (np.arange(n) + 0.5) / n * tile
    rp = (y / tile * rows) % 1.0
    rline = np.where(rp > 0.9, 0.8, 1.0)
    base = np.array([80, 83, 90], np.float32) / 255.0
    from mats import snoise
    noise = snoise((n, n), seed, 4, 64, 1.0) * 0.04
    tint = 1 + (rng.uniform(-1, 1, (rows, ribs)) * 0.05)
    ti = tint[(y / tile * rows).astype(int) % rows][:, (x / tile * ribs).astype(int) % ribs]
    img = base[None, None, :] * (prof[None, :] * rline[:, None] * ti * (1 + noise))[..., None]
    mats._save_png(path, np.clip(img, 0, 1))
    return path


def _tex_material(name, png_func, fname, rough):
    m = bpy.data.materials.get(name)
    if m:
        return m
    from common import BUILD_DIR
    d = BUILD_DIR / 'gate'
    d.mkdir(parents=True, exist_ok=True)
    p = png_func(d / fname)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(p), check_existing=True)
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = mats.COLOR_ATTR
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1.0
    a, b, o = mats._mix_sockets(mx)
    nt.links.new(tex.outputs['Color'], a)
    nt.links.new(vc.outputs['Color'], b)
    nt.links.new(o, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    return m


def _stone_material():
    return _tex_material('keep_stone', stone_texture, 'keep_stone.png', 0.9)


def skirt(g, ihx, ihy, iz, ohx, ohy, oz, *, lift=0.55, n=6, thick=0.32, soffit_z=None, wall=(0, 0), center=None):
    """
    重の軒（寄棟の裾）：外の軒先の輪（隅が持ち上がる）→ 内の輪（上の重の壁の根元）。
    軒先の厚み（瓦の先）と白い軒裏も。wall は下の重の壁の半幅（軒裏の終わり）
    """
    Kc = K if center is None else center

    def side_pts(hx, hy, z, curve):
        pts = []
        corners = [V((hx, -hy)), V((hx, hy)), V((-hx, hy)), V((-hx, -hy))]
        for c in range(4):
            a, b = corners[c], corners[(c + 1) % 4]
            for i in range(n):
                t = i / n
                p = a + (b - a) * t
                zz = z
                out = V((0, 0))
                if curve:
                    e = min(t, 1 - t) * 2          # 0 は隅
                    k = (1 - e) ** 3
                    zz += lift * k
                    # 隅は外へも張り出す
                    out = p.normalized() * 0.35 * k if p.length > 1e-6 else V((0, 0))
                pts.append(Kc + V((p.x + out.x, p.y + out.y, zz)))
        return pts
    outer = side_pts(ohx, ohy, oz, True)
    inner = side_pts(ihx, ihy, iz, False)
    lower = [p - V((0, 0, thick)) for p in outer]
    m = len(outer)
    for i in range(m):
        j = (i + 1) % m
        c = (outer[i] + outer[j]) / 2 - Kc
        tile_quad(g, [outer[i], outer[j], inner[j], inner[i]], V((c.x, c.y, 0)).normalized() * 0.5 + EZ)
    # 軒先の厚み（瓦の先の面）
    faces = [(i, (i + 1) % m, m + (i + 1) % m, m + i) for i in range(m)]
    want = []
    for i in range(m):
        c = (outer[i] + outer[(i + 1) % m]) / 2 - Kc
        want.append(V((c.x, c.y, 0)).normalized())
    g.oriented('ridge', outer + lower, faces, want, smooth=True)
    # 軒裏（白）：軒先の下の輪 → 下の重の壁の上端
    sz = soffit_z if soffit_z is not None else oz - thick - 0.6
    wall_loop = side_pts(wall[0], wall[1], sz, False)
    faces = [(i, (i + 1) % m, m + (i + 1) % m, m + i) for i in range(m)]
    g.oriented('soffit', lower + wall_loop, faces, -EZ, smooth=True)
    # 隅棟
    for c in range(4):
        o = outer[c * n]
        ii = inner[c * n]
        d = (ii - o)
        L = d.length
        obox(g, 'ridge', (o + ii) / 2 + EZ * 0.12, d / L, EZ.cross(d / L).normalized(), EZ.cross(d / L).normalized().cross(d / L), L / 2, 0.16, 0.12)


def windows(g, hx, hy, z0, z1, spacing=2.2, face=('s', 'e', 'w', 'n')):
    """窓（暗い格子の帯）：壁の面から少し出した暗い板と、白い縦の桟"""
    for f in face:
        if f in ('s', 'n'):
            L = 2 * hx
            sy = -1 if f == 's' else 1
            nwin = max(1, int(L / spacing))
            for i in range(nwin):
                x = -hx + L * (i + 0.5) / nwin
                abox(g, 'window', K.x + x - 0.55, K.x + x + 0.55, K.y + sy * hy - 0.06, K.y + sy * hy + 0.06, z0, z1)
                for dx in (-0.2, 0.2):
                    abox(g, 'plaster', K.x + x + dx - 0.04, K.x + x + dx + 0.04, K.y + sy * (hy + 0.07) - 0.02, K.y + sy * (hy + 0.07) + 0.02, z0, z1)
        else:
            L = 2 * hy
            sx = 1 if f == 'e' else -1
            nwin = max(1, int(L / spacing))
            for i in range(nwin):
                y = -hy + L * (i + 0.5) / nwin
                abox(g, 'window', K.x + sx * hx - 0.06, K.x + sx * hx + 0.06, K.y + y - 0.55, K.y + y + 0.55, z0, z1)


def gable(g, cx, cy_face, z_base, half_w, h, depth, *, face=-1, eave_t=0.28):
    """千鳥破風：正面（face=-1 で南）の三角の妻（白）と、両側の小さな屋根の面（後ろの屋根に差し込む）"""
    y = K.y + cy_face
    apex = V((K.x + cx, y, z_base + h))
    l = V((K.x + cx - half_w, y, z_base))
    r = V((K.x + cx + half_w, y, z_base))
    back = V((0, -face * depth, 0))
    # 妻（白い三角）を少し奥に
    tri = [l - V((0, face * 0.25, 0)), r - V((0, face * 0.25, 0)), apex - V((0, face * 0.25, 0)) - EZ * 0.3]
    g.oriented('plaster', tri, [(0, 1, 2)], V((0, face, 0)))
    # 屋根の 2 面（厚み付き）
    for side in (-1, 1):
        e = l if side < 0 else r
        e2 = e + V((side * 0.35, face * 0.1, -0.2))
        a2 = apex + V((0, face * 0.1, 0.05))
        quad = [e2, a2, a2 + back, e2 + back]
        tile_quad(g, quad, EZ + V((side, 0, 0)))
        low = [p - EZ * eave_t for p in quad]
        g.oriented('ridge', [e2, a2, a2 - EZ * eave_t, e2 - EZ * eave_t], [(0, 1, 2, 3)], V((0, face, 0)))
        g.oriented('soffit', low, [(0, 1, 2, 3)], -EZ)
        # 破風板（暗い）
        g.oriented('ridge', [e2 + V((0, face * 0.02, 0)), a2 + V((0, face * 0.02, 0)), a2 + V((0, face * 0.02, -0.45)), e2 + V((0, face * 0.02, -0.45))],
                   [(0, 1, 2, 3)], V((0, face, 0)))
    # 棟（短い）
    obox(g, 'ridge', apex + V((0, face * 0.1, 0.12)) + back / 2, V((0, 1, 0)), EX, EZ, depth / 2, 0.16, 0.12)
    # 懸魚（金）
    obox(g, 'gold', apex + V((0, face * 0.18, -0.55)), EZ, EX, EY, 0.22, 0.2, 0.03)


def karahafu(g, cx, cy_face, z_base, half_w, h, depth, face=-1):
    """唐破風：中が盛り上がり両端が反り上がる曲線の軒"""
    n = 12
    pts = []
    for i in range(n + 1):
        t = -1 + 2 * i / n
        z = h * (math.cos(t * math.pi / 2) ** 1.3) + 0.18 * h * max(0, abs(t) - 0.8) / 0.2
        pts.append((t * half_w, z))
    y = K.y + cy_face
    outline = [(x, z) for (x, z) in pts] + [(x, z - 0.35) for (x, z) in reversed(pts)]
    extrude_outline(g, 'ridge', outline, V((K.x + cx, y, z_base)), EX, EZ, V((0, -face, 0)), depth)
    # 上面（瓦）を少し上に：面の上に細い板
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        quad = [V((K.x + cx + x0, y, z_base + z0 + 0.02)), V((K.x + cx + x1, y, z_base + z1 + 0.02)),
                V((K.x + cx + x1, y - face * depth, z_base + z1 + 0.02)), V((K.x + cx + x0, y - face * depth, z_base + z0 + 0.02))]
        tile_quad(g, quad, EZ)
    # 下の白い妻
    under = [(-half_w, -0.9), (half_w, -0.9)] + [(x, z - 0.35) for (x, z) in reversed(pts)][1:-1]
    extrude_outline(g, 'plaster', under, V((K.x + cx, y + face * -0.3, z_base)), EX, EZ, V((0, -face, 0)), 0.2)


def shachi(g, p, facing):
    """鯱（金の小さな塊：胴と反った尾）"""
    obox(g, 'gold', p + EZ * 0.35, EZ, EX, EY, 0.35, 0.18, 0.25)
    obox(g, 'gold', p + EZ * 0.85 + V((0, facing * 0.18, 0)), EZ, EX, EY, 0.22, 0.12, 0.2)


def irimoya(g, cx, cy, hx, hy, ez, *, rise=1.5, top=3.6, ov=1.4, soffit_z=None, ridge_axis='y'):
    """入母屋の屋根（下は寄棟の裾、上は切妻。ridge_axis='y' なら妻は南北）。cx, cy は K からのずれ"""
    Kc = K + V((cx, cy, 0))
    ohx, ohy = hx + ov, hy + ov
    if ridge_axis == 'y':
        ihx, ihy = max(0.8, hx - 1.4), hy - 0.2
    else:
        ihx, ihy = hx - 0.2, max(0.8, hy - 1.4)
    skirt(g, ihx, ihy, ez + rise, ohx, ohy, ez, lift=0.55, soffit_z=soffit_z if soffit_z is not None else ez - 0.4, wall=(hx, hy), center=Kc)
    rz = ez + rise + top
    zi = ez + rise
    if ridge_axis == 'y':
        for sx in (-1, 1):
            quad = [Kc + V((sx * ihx, -ihy - 0.4, zi)), Kc + V((sx * ihx, ihy + 0.4, zi)), Kc + V((0, ihy + 0.4, rz)), Kc + V((0, -ihy - 0.4, rz))]
            tile_quad(g, quad, EZ + V((sx, 0, 0)))
            low = [p - EZ * 0.25 for p in quad[:2]]
            g.oriented('ridge', [quad[0], quad[1], low[1], low[0]], [(0, 1, 2, 3)], V((sx, 0, 0)))
        for sy in (-1, 1):
            tri = [Kc + V((-ihx + 0.1, sy * ihy, zi)), Kc + V((ihx - 0.1, sy * ihy, zi)), Kc + V((0, sy * ihy, rz - 0.25))]
            g.oriented('plaster', tri, [(0, 1, 2)], V((0, sy, 0)))
            for sx in (-1, 1):
                a = Kc + V((sx * (ihx + 0.1), sy * (ihy + 0.42), zi - 0.15))
                b = Kc + V((0, sy * (ihy + 0.42), rz + 0.05))
                d = b - a
                obox(g, 'ridge', (a + b) / 2, d.normalized(), V((0, 1, 0)), V((0, 1, 0)).cross(d.normalized()), d.length / 2, 0.06, 0.2)
            obox(g, 'gold', Kc + V((0, sy * (ihy + 0.45), rz - 0.9)), EZ, EX, EY, 0.3, 0.3, 0.03)
        obox(g, 'ridge', Kc + V((0, 0, rz + 0.18)), EY, EX, EZ, ihy + 0.55, 0.28, 0.2)
        return rz, (Kc + V((0, -(ihy + 0.35), rz + 0.3)), Kc + V((0, ihy + 0.35, rz + 0.3)))
    for sy in (-1, 1):
        quad = [Kc + V((-ihx - 0.4, sy * ihy, zi)), Kc + V((ihx + 0.4, sy * ihy, zi)), Kc + V((ihx + 0.4, 0, rz)), Kc + V((-ihx - 0.4, 0, rz))]
        tile_quad(g, quad, EZ + V((0, sy, 0)))
    for sx in (-1, 1):
        tri = [Kc + V((sx * ihx, -ihy + 0.1, zi)), Kc + V((sx * ihx, ihy - 0.1, zi)), Kc + V((sx * ihx, 0, rz - 0.25))]
        g.oriented('plaster', tri, [(0, 1, 2)], V((sx, 0, 0)))
    obox(g, 'ridge', Kc + V((0, 0, rz + 0.18)), EX, EY, EZ, ihx + 0.55, 0.28, 0.2)
    return rz, (Kc + V((-(ihx + 0.35), 0, rz + 0.3)), Kc + V((ihx + 0.35, 0, rz + 0.3)))


def honmaru_wall(g, x0, x1, y, h, batter, *, dobei_h=2.2, z_bot=-3.0, depth=8.0):
    """天守の手前の本丸の石垣（反り、石の並びは画像）と、上の白い土塀（瓦の笠）。天守台の足元と遠くの地面の端を隠す"""
    n = 4
    zs = [z_bot + (h - z_bot) * k / n for k in range(n + 1)]
    ins = [batter * ((z - z_bot) / (h - z_bot)) ** 1.8 for z in zs]
    for k in range(n):
        d0, d1 = ins[k], ins[k + 1]
        quad = [V((x0 + d0 * 0.6, y + d0, zs[k])), V((x1 - d0 * 0.6, y + d0, zs[k])), V((x1 - d1 * 0.6, y + d1, zs[k + 1])),
                V((x0 + d1 * 0.6, y + d1, zs[k + 1]))]
        stone_quad(g, quad, V((0, -1, 0)))
        for (xa, sx) in ((x0, -1), (x1, 1)):
            q = [V((xa - sx * d0 * 0.6, y + d0, zs[k])), V((xa, y + depth, zs[k])), V((xa, y + depth, zs[k + 1])),
                 V((xa - sx * d1 * 0.6, y + d1, zs[k + 1]))]
            stone_quad(g, q, V((sx, 0, 0)))
    yt = y + batter
    top = [V((x0 + batter * 0.6, yt, h)), V((x1 - batter * 0.6, yt, h)), V((x1 - batter * 0.6, y + depth, h)), V((x0 + batter * 0.6, y + depth, h))]
    g.oriented('stone', top, [(0, 1, 2, 3)], EZ, uv=[(p.x / STONE_TILE, p.y / STONE_TILE) for p in top])
    # 土塀
    wy = yt + 0.8
    abox(g, 'plaster', x0 + batter * 0.6 + 0.4, x1 - batter * 0.6 - 0.4, wy - 0.45, wy + 0.45, h, h + dobei_h)
    L = (x1 - x0) - batter * 1.2 - 0.8
    cx = (x0 + x1) / 2
    ridge_z = h + dobei_h + 0.75
    for sy in (-1, 1):
        quad = [V((cx - L / 2, wy + sy * 1.0, h + dobei_h + 0.1)), V((cx + L / 2, wy + sy * 1.0, h + dobei_h + 0.1)),
                V((cx + L / 2, wy, ridge_z)), V((cx - L / 2, wy, ridge_z))]
        tile_quad(g, quad, EZ + V((0, sy, 0)))
        g.oriented('ridge', [quad[0], quad[1], quad[1] - EZ * 0.2, quad[0] - EZ * 0.2], [(0, 1, 2, 3)], V((0, sy, 0)))
        g.oriented('soffit', [quad[0] - EZ * 0.2, quad[1] - EZ * 0.2, V((cx + L / 2, wy + sy * 0.45, h + dobei_h)), V((cx - L / 2, wy + sy * 0.45, h + dobei_h))],
                   [(0, 1, 2, 3)], -EZ)
    obox(g, 'ridge', V((cx, wy, ridge_z + 0.1)), EX, EY, EZ, L / 2, 0.2, 0.12)


def build_keep():
    g = Geo()
    S = 1.3
    zb = 13.0
    # 天守台（地面の下まで：遠くの地面が無くても浮かない）
    base(g, 16.0, 13.5, zb, 2.6)
    # 一重
    PITCH = 0.55                      # 重の屋根の勾配（下から見ても瓦の面が見えるように）
    hx1, hy1 = 10.0 * S, 8.0 * S
    h1 = 5.6 * S
    box_at(g, 'plaster', K.x, K.y, zb, hx1, hy1, zb + h1)
    abox(g, 'wood', K.x - hx1 - 0.05, K.x + hx1 + 0.05, K.y - hy1 - 0.05, K.y + hy1 + 0.05, zb, zb + 0.4)
    windows(g, hx1, hy1, zb + 2.8, zb + 4.1, spacing=2.5)
    # 一重の軒 → 二重の壁（壁の根元は屋根の中）
    hx2, hy2 = 7.6 * S, 5.9 * S
    e1 = zb + h1 + 0.3
    run1 = hx1 + 2.0 - hx2
    skirt(g, hx2, hy2, e1 + PITCH * run1, hx1 + 2.0, hy1 + 2.0, e1, lift=0.7, soffit_z=zb + h1, wall=(hx1, hy1))
    z2 = e1 + 0.8
    h2 = 4.4 * S
    box_at(g, 'plaster', K.x, K.y, z2, hx2, hy2, z2 + h2)
    windows(g, hx2, hy2, z2 + 3.1, z2 + 4.3, spacing=2.4)
    # 一重の正面：千鳥破風 2 つと唐破風（棟は奥で屋根に入る）
    for cx in (-5.6, 5.6):
        gable(g, cx, -(hy1 + 1.3), e1 + 0.35, 3.0, 2.6, (2.6 + 0.3) / PITCH + 0.5)
    karahafu(g, 0.0, -(hy1 + 1.8), e1 + 0.05, 2.2, 1.0, 2.4)
    # 二重の軒 → 三重
    hx3, hy3 = 5.4 * S, 4.2 * S
    e2 = z2 + h2 + 0.3
    run2 = hx2 + 1.8 - hx3
    skirt(g, hx3, hy3, e2 + PITCH * run2, hx2 + 1.8, hy2 + 1.8, e2, lift=0.65, soffit_z=z2 + h2, wall=(hx2, hy2))
    gable(g, 0.0, -(hy2 + 1.1), e2 + 0.4, 4.0, 3.2, (3.2 + 0.3) / PITCH + 0.5)
    for sx in (-1, 1):
        # 側面の千鳥破風（東西）
        g2 = Geo()
        gable(g2, 0.0, -(hx2 + 1.1), e2 + 0.4, 2.3, 2.0, (2.0 + 0.3) / PITCH + 0.5)
        rot = __import__('mathutils').Matrix.Rotation(sx * math.pi / 2, 3, 'Z')
        for key, p in g2.parts.items():
            vs = [K + rot @ (v - K) for v in p['v']]
            g.add(key, vs, [tuple(f) for f in p['f']], smooth=False, uv=p['uv'] if p['uv'] else None)
    z3 = e2 + 0.8
    h3 = 3.8 * S
    box_at(g, 'plaster', K.x, K.y, z3, hx3, hy3, z3 + h3)
    windows(g, hx3, hy3, z3 + 2.5, z3 + 3.6, spacing=2.1)
    # 最上重：入母屋（棟は南北、妻は南）と鯱
    rz, ends = irimoya(g, 0.0, 0.0, hx3, hy3, z3 + h3 + 0.3, rise=2.0, top=4.4, ov=1.7, soffit_z=z3 + h3)
    for p, sy in zip(ends, (-1, 1)):
        shachi(g, p, sy)
    # 手前の本丸の石垣と土塀（天守台の足元を隠す）
    honmaru_wall(g, K.x - 46.0, K.x + 34.0, K.y - 26.0, 6.0, 2.2)

    objs = []
    mmat = {'matte': _material('keep_matte', 0.88), 'tile': _material('keep_tile_edge', 0.5), 'gold': _material('keep_gold', 0.35, 0.85),
            'stone': _stone_material(), 'tile_tex': _tex_material('keep_tile', tile_texture, 'keep_tile.png', 0.55)}
    for key in list(g.parts):
        sub = Geo()
        sub.parts[key] = g.parts[key]
        mk = {'stone': 'stone', 'tile': 'tile_tex'}.get(key, MAT_OF[key])
        o = to_objects(sub, 'keep', custom={key: mmat[mk]})
        for ob in o:
            set_color(ob, (1.0, 1.0, 1.0) if key in ('stone', 'tile') else COL[key])
            ob['koto_keep'] = True
        objs += o
    return objs


def bake(objs, quick=False):
    """AO を頂点色へ（形が粗いので先に細分）"""
    for o in objs:
        # 石垣は大きな面なので粗く（三角形を 1.5 万以下に）
        mats.densify(o, 5.0 if o['koto_key'] == 'stone' else 2.4)
    mats.bake_ao_to_color(objs, ground_plane=True, samples=24 if quick else 40, distance=4.0, strength=0.55, ground_z=0.0)
