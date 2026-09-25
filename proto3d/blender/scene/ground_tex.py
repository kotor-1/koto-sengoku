"""
地面だけで使う自作の画像（共有ライブラリ mats.py には足さない＝他の担当に影響させない）。
- turf: 塀ぎわ・空き地の草地（踏まれた短い草・苔・土が見える所）。1 回の繰り返し 2 m、1024 px。
画像は numpy で合成し（mats の周期ノイズを使う）、build/scene/tex/ に PNG で作り置きする。
GLB に入れるときは JPEG に直す（to_jpeg）。
"""
from __future__ import annotations

import math
import pathlib
import sys

import bpy
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'lib'))
import mats  # noqa: E402
from common import BUILD_DIR  # noqa: E402
from mats import _height_to_normal, _lines, _save_png, blur, mix, rgb, smoothstep, snoise, worley  # noqa: E402

TEX = BUILD_DIR / 'scene' / 'tex'
TEX.mkdir(parents=True, exist_ok=True)
TURF_TILE = (2.0, 2.0)


def gen_turf(n=1024, seed=701, tile=TURF_TILE):
    """草地：土（暗い茶）→ 苔（低いクッション）→ 短い草の葉（4 層、上ほど高い）。上から見た形"""
    sh = (n, n)
    rng = np.random.default_rng(seed)
    px_m = n / tile[0]
    low = snoise(sh, seed + 1, fmin=0.8, fmax=6, beta=1.4)
    mid = snoise(sh, seed + 2, fmin=6, fmax=60, beta=1.0)
    fine = snoise(sh, seed + 3, fmin=120, fmax=900, beta=0.3)
    # 土
    soil = mix(rgb(96, 80, 62), rgb(126, 106, 82), np.clip(0.5 + 0.3 * mid + 0.15 * fine, 0, 1))
    col = soil.copy()
    h = 0.0006 * mid + 0.0002 * fine
    # 小石・枯れた欠片
    F1, _, ID = worley(sh, int(tile[0] / 0.03), seed + 4, jitter=0.9)
    occ = rng.random(ID.max() + 1) < 0.07
    peb = occ[ID] & (F1 < 0.28)
    pc = np.asarray([rgb(118, 110, 98), rgb(104, 94, 80), rgb(128, 120, 106)], np.float32)[rng.integers(0, 3, ID.max() + 1)]
    col = np.where(peb[..., None], pc[ID] * (0.9 + 0.1 * fine[..., None]), col)
    h = h + peb * 0.0015
    # 苔：まだらのクッション
    moss_amt = smoothstep(-0.3, 0.7, 0.8 * low + 0.5 * mid)
    moss_tex = snoise(sh, seed + 5, fmin=60, fmax=400, beta=0.4)
    moss_c = mix(rgb(66, 82, 40), rgb(96, 110, 54), np.clip(0.5 + 0.35 * moss_tex + 0.2 * low, 0, 1))
    mcov = np.clip(moss_amt * (0.75 + 0.35 * moss_tex), 0, 1)
    col = mix(col, moss_c, mcov)
    h = h + mcov * (0.002 + 0.0008 * moss_tex)
    # 草の葉：密なところとまばらなところ（低い周波数）
    dens = np.clip(0.55 + 0.45 * snoise(sh, seed + 6, fmin=1, fmax=5, beta=1.2), 0.05, 1.0)
    greens = [rgb(76, 100, 44), rgb(94, 118, 52), rgb(108, 128, 58), rgb(124, 132, 68), rgb(144, 138, 84)]
    colfield = snoise(sh, seed + 7, fmin=2, fmax=12, beta=1.0)
    for layer in range(4):
        cnt = 5200
        cx = rng.random(cnt) * n
        cy = rng.random(cnt) * n
        # 株ごとにまとまった向き（葉は株元から放射状）
        ang = rng.random(cnt) * math.tau
        ln = (0.012 + 0.03 * rng.random(cnt) ** 1.5) * px_m
        keep = rng.random(cnt) < dens[(cy.astype(int)) % n, (cx.astype(int)) % n]
        cx, cy, ang, ln = cx[keep], cy[keep], ang[keep], ln[keep]
        segs = np.stack([cx, cy, cx + np.cos(ang) * ln, cy + np.sin(ang) * ln], -1)
        cov = _lines(sh, segs, width=0.7 + 0.25 * layer, seed=seed + 20 + layer)
        t = np.clip(0.5 + 0.35 * colfield + 0.25 * snoise(sh, seed + 30 + layer, fmin=20, fmax=120, beta=0.8)
                    + 0.12 * (layer - 1.5), 0, 0.999)
        k = t * (len(greens) - 1)
        i0 = np.floor(k).astype(int)
        f = (k - i0)[..., None]
        gpal = np.asarray(greens, np.float32)
        gc = gpal[i0] * (1 - f) + gpal[np.minimum(i0 + 1, len(greens) - 1)] * f
        hh = 0.003 + 0.0025 * layer
        top = (cov > 0.35) & (hh > h)
        shade = 0.8 + 0.2 * cov
        col = np.where(top[..., None], gc * shade[..., None], col)
        h = np.where(top, hh * (0.7 + 0.3 * cov), h)
    # 葉の根元の陰（高さの低い所を少し暗く）
    ao = np.clip((h - blur(h, 3)) / 0.003 + 0.8, 0.55, 1.0)
    col = col * ao[..., None]
    rough = np.clip(0.9 - 0.08 * mcov + 0.03 * fine, 0.7, 1.0)
    return dict(albedo=np.clip(col, 0, 1), height=h, rough=rough)


def build_turf(force=False) -> dict:
    paths = {k: TEX / f'turf_{k}.png' for k in ('albedo', 'normal', 'orm')}
    if not force and all(p.exists() for p in paths.values()):
        return paths
    d = gen_turf()
    _save_png(paths['albedo'], d['albedo'])
    _save_png(paths['normal'], _height_to_normal(d['height'], TURF_TILE, 1.0))
    r = d['rough']
    orm = np.stack([np.ones_like(r), r, np.zeros_like(r)], -1)
    _save_png(paths['orm'], mats._downsample2(orm))
    return paths


def to_jpeg(img: bpy.types.Image, quality=80) -> bpy.types.Image:
    """画像を JPEG のファイルに直して差し替える（GLB の書き出しを AUTO にしても JPEG で入る）"""
    if img.file_format == 'JPEG':
        return img
    if img.packed_file is not None or not (img.filepath_raw or img.filepath):
        return img          # GLB から読み込んだ画像（草の板の PNG など）はそのまま
    src = pathlib.Path(bpy.path.abspath(img.filepath_raw or img.filepath))
    if not src.is_file():
        return img
    out = TEX / 'jpg' / (src.stem + '.jpg')
    out.parent.mkdir(parents=True, exist_ok=True)
    cs = img.colorspace_settings.name
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        tmp = bpy.data.images.load(str(src), check_existing=False)
        tmp.colorspace_settings.name = cs
        _ = tmp.pixels[0]          # 画素を読み込ませる（読まないと保存できない）
        tmp.filepath_raw = str(out)
        tmp.file_format = 'JPEG'
        tmp.save(quality=quality)
        bpy.data.images.remove(tmp)
    j = bpy.data.images.load(str(out), check_existing=True)
    j.colorspace_settings.name = cs
    return j


def jpeg_materials(materials, quality=80):
    """
    材質の画像節点を JPEG 版に差し替える（lightmap の AO も含む）。
    ORM 画像の B（金属 0）も Metallic につなぐ：粗さだけを使うと書き出しが G だけの画像を作り直して PNG になるため
    （G と B をそのまま使えば元の JPEG がそのまま入る）。
    """
    for m in materials:
        if m is None or not m.use_nodes:
            continue
        nt = m.node_tree
        for nd in nt.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image is not None:
                nd.image = to_jpeg(nd.image, quality)
        for nd in nt.nodes:
            if nd.type == 'SEPARATE_COLOR' and nd.outputs['Green'].links and not nd.outputs['Blue'].links:
                bsdf = nd.outputs['Green'].links[0].to_node
                if bsdf.type == 'BSDF_PRINCIPLED' and not bsdf.inputs['Metallic'].links:
                    nt.links.new(nd.outputs['Blue'], bsdf.inputs['Metallic'])


def material(name, paths, tile, *, rough_default=0.9):
    """mats.get と同じ節点のつなぎ方の材質（頂点色 'Col' を掛けた版。koto_lib は付けない＝ライブラリの差し替えの対象外）"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m['koto_tile_m'] = list(tile)
    m['koto_uv'] = 'box'
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = mats._load_image(paths['albedo'], False)
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
    tn.image = mats._load_image(paths['normal'], True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    tr = nt.nodes.new('ShaderNodeTexImage')
    tr.image = mats._load_image(paths['orm'], True)
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tr.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


if __name__ == '__main__':
    from common import reset
    reset()
    p = build_turf(force='--force' in sys.argv)
    print(p)
