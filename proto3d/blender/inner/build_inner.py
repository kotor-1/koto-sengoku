"""
城内の遠景（門越しに見える奥の層）：東側を北へ延びる内塀、二重櫓、長い瓦屋根の御殿。
歩ける範囲（z > -30）の外だけに置くので当たり判定は無い。
    /root/blender-venv/bin/python proto3d/blender/inner/build_inner.py
書き出し: proto3d/public/models/inner.glb
"""
from __future__ import annotations

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'lib'))
from common import MODELS_DIR, export_glb, g2b, reset, triangles  # noqa: E402
import mats  # noqa: E402
import bpy  # noqa: E402
import bmesh  # noqa: E402

# 頂点色（three.js で基本色に掛かる）：漆喰は温かく少し落とし、瓦は濃いいぶし銀に
GAIN = {'plaster_white_streaks': (0.56, 0.56, 0.6), 'tile_ibushi': (0.5, 0.5, 0.54), 'wood_dark': (0.7, 0.66, 0.62), 'stone_wall': (0.85, 0.83, 0.8)}
PARTS: dict[str, list] = {}   # 材質名 → [(verts, faces)]


def add(mat, verts, faces):
    PARTS.setdefault(mat, []).append((verts, faces))


def box(mat, x0, x1, y0, y1, z0, z1):
    """ゲームの座標の箱（x 東, y 上, z 南）"""
    v = [g2b(x, y, z) for y in (y0, y1) for z in (z0, z1) for x in (x0, x1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    add(mat, v, f)


def hip_roof(cx, cz, hx, hz, y_eave, rise, ovh, *, ridge_frac=0.45, thick=0.35, soffit='wood_dark'):
    """寄棟の屋根：瓦の面、厚い軒先の鼻（瓦）、暗い軒裏"""
    ex, ez = hx + ovh, hz + ovh
    rx = max(ex - ez, ex * ridge_frac) if ex >= ez else 0.0
    rz = 0.0 if ex >= ez else max(ez - ex, ez * ridge_frac)
    yt = y_eave + rise
    top = [g2b(cx + sx * ex, y_eave, cz + sz * ez) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bot = [g2b(cx + sx * ex, y_eave - thick, cz + sz * ez) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    r0, r1 = g2b(cx - rx, yt, cz - rz), g2b(cx + rx, yt, cz + rz)
    # 瓦の面（4 面）＋軒先の鼻
    v = top + bot + [r0, r1]
    f = [(0, 1, 9, 8), (1, 2, 9), (2, 3, 8, 9), (3, 0, 8)] if ex >= ez else [(0, 1, 8), (1, 2, 9, 8), (2, 3, 9), (3, 0, 8, 9)]
    # g2b flips z → Blender Y; fix winding by checking later (recalc normals)
    f += [(0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    add('tile_ibushi', v, [tuple(q) for q in f])
    # 棟（太い瓦の稜）
    if ex >= ez:
        box('tile_ibushi', cx - rx - 0.1, cx + rx + 0.1, yt - 0.05, yt + 0.28, cz - 0.18, cz + 0.18)
    else:
        box('tile_ibushi', cx - 0.18, cx + 0.18, yt - 0.05, yt + 0.28, cz - rz - 0.1, cz + rz + 0.1)
    # 軒裏（暗い帯になる）
    add(soffit, bot, [(0, 3, 2, 1)])


def plaster_block(x0, x1, z0, z1, y0, y1, band=0.35):
    box('plaster_white_streaks', x0, x1, y0, y1 - band, z0, z1)
    box('wood_dark', x0 - 0.02, x1 + 0.02, y1 - band, y1, z0 - 0.02, z1 + 0.02)


def stone_base(x0, x1, z0, z1, h, batter=0.5):
    v = [g2b(x, 0, z) for z in (z0 - batter, z1 + batter) for x in (x0 - batter, x1 + batter)]
    v += [g2b(x, h, z) for z in (z0, z1) for x in (x0, x1)]
    add('stone_wall', v, [(0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6), (4, 5, 7, 6)])


def inner_wall(x, z0, z1, *, base=1.4, top=3.4):
    """東の内塀（北へ延びる）：石の根元、漆喰、瓦の笠"""
    stone_base(x - 0.45, x + 0.45, z0, z1, base, batter=0.12)
    plaster_block(x - 0.35, x + 0.35, z0, z1, base, top, band=0.2)
    hip_roof(x, (z0 + z1) / 2, 0.35, (z1 - z0) / 2, top, 0.55, 0.45, ridge_frac=1.0, thick=0.12)


def yagura(cx, cz):
    """二重櫓：石垣の台、漆喰の一重目と二重目、寄棟の屋根 2 段"""
    stone_base(cx - 5.0, cx + 5.0, cz - 4.0, cz + 4.0, 3.2, batter=1.0)
    plaster_block(cx - 4.4, cx + 4.4, cz - 3.4, cz + 3.4, 3.2, 7.2)
    for i in range(4):   # 窓（暗い格子の穴）
        xx = cx - 3.0 + i * 2.0
        box('wood_dark', xx - 0.45, xx + 0.45, 4.8, 5.8, cz + 3.4, cz + 3.46)
    hip_roof(cx, cz, 4.4, 3.4, 7.2, 1.3, 1.3)
    plaster_block(cx - 3.0, cx + 3.0, cz - 2.3, cz + 2.3, 7.6, 10.6)
    for i in range(3):
        xx = cx - 1.8 + i * 1.8
        box('wood_dark', xx - 0.35, xx + 0.35, 8.8, 9.6, cz + 2.3, cz + 2.36)
    hip_roof(cx, cz, 3.0, 2.3, 10.6, 2.0, 1.2)


def goten(cx, cz, hx, hz):
    """長い御殿：暗い木の壁と深い軒の大きな寄棟"""
    box('stone_granite', cx - hx - 0.2, cx + hx + 0.2, 0, 0.6, cz - hz - 0.2, cz + hz + 0.2)
    box('wood_dark', cx - hx, cx + hx, 0.6, 4.2, cz - hz, cz + hz)
    hip_roof(cx, cz, hx, hz, 4.2, 3.2, 1.6, ridge_frac=0.55)


def build():
    reset()
    inner_wall(-3.0, -76.0, -31.0)
    yagura(-16.0, -47.0)
    goten(-2.0, -64.0, 8.0, 4.0)
    goten(11.0, -36.0, 6.0, 3.5)
    objs = []
    for mat, parts in PARTS.items():
        bm = bmesh.new()
        for verts, faces in parts:
            vs = [bm.verts.new(p) for p in verts]
            for fc in faces:
                try:
                    bm.faces.new([vs[i] for i in fc])
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('inner_' + mat)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('inner_' + mat, me)
        bpy.context.scene.collection.objects.link(o)
        mats.assign(o, mat)
        mats.uv_box(o)
        g = GAIN.get(mat, (1, 1, 1))
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for d in ca.data:
            d.color = (*g, 1.0)
        me.color_attributes.active_color = ca
        objs.append(o)
    print('triangles', triangles(objs))
    size = export_glb(MODELS_DIR / 'inner.glb', objs)
    print('inner.glb', size)


build()
