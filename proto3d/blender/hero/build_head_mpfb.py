"""
主人公の頭部の比較案（hero_v3_mpfb.glb）を作る。Blender 4.5（Python の bpy）で実行：
    /root/blender-venv/bin/python proto3d/blender/hero/build_head_mpfb.py
- 体・衣服・骨組み・動き（Idle / Walk / Run）は hero_v3 と同じ作り方（build_hero_v3.py の関数をそのまま使う）
- 頭と首の肌だけを MPFB2（MakeHuman）の CC0 の人体の基本形から作る（head_mpfb.py、mpfb_base.py）。
  首の下（襟の中・胸の V）は体の SDF の面へなめらかに寄せ、襟・小袖は hero_v3 のまま
- 眼球・まぶたの縁の線・眉・肌の色味は自作（mpfb_parts.py）。髪は hair.py の作り方を新しい頭の面に合わせて使う（hair_mpfb.py）
- 使った第三者素材：proto3d/thirdparty/mpfb2/（写し）、docs/third-party-assets.md
出力：proto3d/public/models/hero_v3_mpfb.glb、作業用 proto3d/blender/build/hero/hero_v3_mpfb.blend
hero_v3.glb（81bc02f の頭）は変えない（もう一つの比較案として残す）。
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import bpy  # noqa: E402
import numpy as np

import build_hero_v3 as B
import cloth as CL
import gear as G
import hair as H
import hair_mpfb as HR
import hakama as HK
import head_mpfb as HM
import mpfb_base as MB
import mpfb_parts as MP
import skin as SK
import textures as TX
import util as U
from common import MODELS_DIR

B.OUT = MODELS_DIR / 'hero_v3_mpfb.glb'
WORK = B.WORK
log = B.log
TRI_LIMIT = 59800


def body_parts():
    """頭と髪以外（hero_v3 と同じ形）"""
    P = {}
    for s, nm in ((1, 'L'), (-1, 'R')):
        P['arm' + nm] = U.make_mesh('Arm' + nm, *SK.arm_piece(s))
        P['foot' + nm] = U.make_mesh('Tabi' + nm, *SK.foot_piece(s))
    V, Q, E, W, kind = CL.kosode_mesh()
    P['kosode'] = U.make_mesh('Kosode', V, Q)
    E, W = E[::2], W[::2]
    import anatomy as A
    V, Fc, UV = CL.band(E, W, 0.052, 0.0035, rows=3, surf_sdf=CL.kosode_sdf, avoid_sdf=lambda X: A.body(X, ['neck']), avoid=0.006)
    P['eri'] = U.make_mesh('Eri', V, Fc)
    B.uv_from_vertex(P['eri'], UV)
    V, Fc, UV = CL.band(E - W * 0.011, W, 0.03, 0.0008, rows=2, surf_sdf=CL.kosode_sdf, avoid_sdf=lambda X: A.body(X, ['neck', 'torso']), avoid=0.003)
    P['juban'] = U.make_mesh('Juban', V, Fc)
    B.uv_from_vertex(P['juban'], UV)
    log('kosode')
    V, Fc = HK.hakama_mesh()
    P['hakama'] = U.make_mesh('Hakama', V, Fc)
    B.weld(P['hakama'], z_band=(HK.Y_CROTCH - 0.002, HK.Y_CROTCH + 0.002))
    V, Fc, UV = HK.obi_mesh()
    P['obi'] = U.make_mesh('Obi', V, Fc)
    B.uv_from_vertex(P['obi'], UV)
    V, Fc, UV = HK.koshiita_mesh()
    P['koshiita'] = U.make_mesh('Koshiita', V, Fc)
    B.uv_from_vertex(P['koshiita'], UV)
    B.recalc_normals(P['koshiita'])
    P['himo1'] = U.make_mesh('Himo1', *HK.himo_mesh(1))
    P['himo2'] = U.make_mesh('Himo2', *HK.himo_mesh(-1))
    V, Fc, _ = G.front_knot(HK.band_front_z() + 0.004)
    P['knotF'] = U.make_mesh('KnotFront', V, Fc)
    (V, Fc), (V2, F2, _) = G.back_knot(HK.band_back_z())
    P['knotB'] = U.make_mesh('KnotBack', V, Fc)
    P['knotE'] = U.make_mesh('KnotEnds', V2, F2)
    ds = G.daisho()
    for k in ('saya', 'metal', 'iron', 'tsuka'):
        P['sw_' + k] = U.make_mesh('Sword_' + k, ds[k][0], ds[k][1])
    B.uv_from_vertex(P['sw_tsuka'], ds['tsuka'][2])
    for s, nm in ((1, 'L'), (-1, 'R')):
        z = G.zori(s)
        P['sole' + nm] = U.make_mesh('Zori' + nm, z['sole'][0], z['sole'][1])
        B.uv_from_vertex(P['sole' + nm], z['sole'][2])
        P['hanao' + nm] = U.make_mesh('Hanao' + nm, z['hanao'][0], z['hanao'][1])
    log('body parts')
    return P


def head_parts(P):
    """新しい頭（MPFB の基本形）・眼球・まぶたの縁・眉・髪"""
    Vs, Qs = HM.skin_piece()
    Vs, Qs = SK.trim_under_collar(Vs, Qs)
    P['head'] = U.make_mesh('Head', Vs, Qs)
    log('mpfb skin', len(Vs), 'verts', len(Qs), 'quads')
    Vfull, Qfull = HM.skin_piece()
    for s, nm in ((1, 'L'), (-1, 'R')):
        V, Fc, col = MP.eyeball_fitted(Vfull, Qfull, s)
        o = U.make_mesh('Eye' + nm, V, Fc)
        o['vcol'] = col
        P['eye' + nm] = o
        V, Fc, UV = MP.brow_strip(s)
        o = U.make_mesh('Brow' + nm, V, Fc)
        B.uv_from_vertex(o, UV)
        o['cast'] = False
        P['brow' + nm] = o
        V, Fc = MP.lash_strip(Vfull, Qfull, s)
        P['lash' + nm] = U.make_mesh('Lash' + nm, V, Fc)
    log('eyes, brows, lashes')
    HR.install()
    P['hair'] = U.make_mesh('Hair', *H.cap_mesh())
    (V, Fc, UV), _cards = HR.lock_meshes()        # 第 2 案：房は平たい毛束だけ（透ける板は細かい刻みに見えたので使わない）
    P['hairline'] = U.make_mesh('HairlineWisps', *HR.front_wisps()[:2])     # 額の生え際の短い透ける毛（上へ流れる。前髪にしない）
    B.uv_from_vertex(P['hairline'], HR.front_wisps()[2])
    P['hairline']['cast'] = False
    P['strands'] = U.make_mesh('HairStrands', V, Fc)
    B.uv_from_vertex(P['strands'], UV)
    P['bun'] = U.make_mesh('Topknot', *H.bun_mesh())
    P['motoyui'] = U.make_mesh('Motoyui', *H.motoyui())
    V, Fc, UV = H.tuft()
    P['bunstr'] = U.make_mesh('TopknotStrands', V, Fc)
    B.uv_from_vertex(P['bunstr'], UV)
    V, Fc, UV = H.nape_wisps()
    P['wisps'] = U.make_mesh('NapeWisps', V, Fc)
    B.uv_from_vertex(P['wisps'], UV)
    log('hair')
    return P


BUDGET = {'armL': 1850, 'armR': 1850, 'footL': 500, 'footR': 500, 'hair': 6200, 'bun': 450, 'kosode': 10500, 'knotB': 360}


def decimate(P):
    for k, n in BUDGET.items():
        U.decimate_to(P[k], n, symmetric=k in ('hair', 'kosode'))
    others = sum(U.ntris(o) for k, o in P.items() if k != 'head')
    # 固い布（襟・半襟・袴）は後で厚み（solidify）が付く：その分を見込む
    extra = int(1.45 * sum(U.ntris(P[k]) for k in ('eri', 'juban', 'hakama')))
    head_n = min(16000, TRI_LIMIT - others - extra)
    U.decimate_to(P['head'], head_n, symmetric=True)
    log('decimated head to', U.ntris(P['head']), 'others', others, 'solidify extra', extra)
    log('folds fixed', {k: U.fix_folds(P[k]) for k in ('head', 'hair')})


def materials(P):
    tex = {}
    for nm in ('indigo', 'linen', 'hakama', 'obi', 'straw', 'tsuka'):
        c, n = getattr(TX, nm)()
        tex[nm] = (U.image_from_array('tex_' + nm, c, WORK / f'tex_{nm}.png'), U.image_from_array('nrm_' + nm, n, WORK / f'nrm_{nm}.png', 'Non-Color'))
    hc, hn, hr = HR.hair_tex()
    tex['hair'] = (U.image_from_array('tex_hair_m', hc, WORK / 'tex_hair_m.png'), U.image_from_array('nrm_hair_m', hn, WORK / 'nrm_hair_m.png', 'Non-Color'))
    # glTF の粗さ・金属の画像：G が粗さ、B が金属（0）
    hair_rough = U.image_from_array('rgh_hair_m', np.stack([np.ones_like(hr), hr, np.zeros_like(hr)], axis=2), WORK / 'rgh_hair_m.png', 'Non-Color')
    brow = U.image_from_array('tex_brow_m', MP.brow_tex(), WORK / 'tex_brow_m.png')
    wisp = U.image_from_array('tex_wisp', TX.wisp_card(), WORK / 'tex_wisp.png')
    hlc = U.image_from_array('tex_hairline_m', HR.hairline_card(), WORK / 'tex_hairline_m.png')
    lk = np.clip(hc * np.array([1.30, 1.22, 1.12]) + np.array([0.008, 0.005, 0.003]), 0, 1)
    locktex = U.image_from_array('tex_hairlock_m', lk, WORK / 'tex_hairlock_m.png')

    def tmat(name, nm, rough, color=(1, 1, 1), double=False, nstr=1.0):
        return U.principled(name, color, rough, base_tex=tex[nm][0], normal_tex=tex[nm][1], uv_scale=1, double=double, normal_strength=nstr)

    M = {
        'skin': U.principled('Skin', (0.58, 0.315, 0.185), 0.58),
        'eye': U.principled('Eye', (1, 1, 1), 0.45),
        'brow': U.principled('Brow', (1, 1, 1), 0.75, base_tex=brow, uv_scale=1, alpha_blend=True, double=True),
        'lash': U.principled('Lash', (0.020, 0.016, 0.013), 0.6),
        'hair': U.principled('Hair', (1, 1, 1), 1.0, base_tex=tex['hair'][0], normal_tex=tex['hair'][1], rough_tex=hair_rough, uv_scale=1,
                             normal_strength=0.5),
        'hairlock': U.principled('Hair_lock_clumps', (1, 1, 1), 0.66, base_tex=locktex, normal_tex=tex['hair'][1], uv_scale=1),
        'wisp': U.principled('Hair_wisps', (1, 1, 1), 0.6, base_tex=wisp, uv_scale=1, alpha_clip=True, double=True),
        'hairline': U.principled('Hair_hairline', (1, 1, 1), 0.88, base_tex=hlc, uv_scale=1, alpha_blend=True, double=True),
        'cord': U.principled('Motoyui_paper', (0.50, 0.46, 0.39), 0.6),
        'kosode': tmat('Kosode_indigo_hemp', 'indigo', 0.85, double=True),
        'juban': tmat('Juban_linen', 'linen', 0.85),
        'tabi': tmat('Tabi_cotton', 'linen', 0.9, nstr=0.6),
        'hakama': tmat('Hakama_check', 'hakama', 0.8),
        'obi': tmat('Kakuobi', 'obi', 0.6),
        'himo': U.principled('Himo', (0.030, 0.024, 0.020), 0.7),
        'saya': U.principled('Saya_lacquer', (0.016, 0.014, 0.013), 0.2),
        'metal': U.principled('Fittings_shakudo', (0.10, 0.085, 0.065), 0.42, 0.8),
        'iron': U.principled('Tsuba_iron', (0.05, 0.047, 0.044), 0.55, 0.6),
        'tsuka': tmat('Tsuka_wrap', 'tsuka', 0.65),
        'straw': tmat('Zori_straw', 'straw', 0.92),
        'hanao': U.principled('Hanao', (0.025, 0.026, 0.035), 0.75),
    }
    assign = {
        'head': 'skin', 'armL': 'skin', 'armR': 'skin', 'footL': 'tabi', 'footR': 'tabi',
        'eyeL': 'eye', 'eyeR': 'eye', 'browL': 'brow', 'browR': 'brow', 'lashL': 'lash', 'lashR': 'lash',
        'hair': 'hair', 'strands': 'hairlock', 'bun': 'hair', 'bunstr': 'hairlock', 'wisps': 'wisp', 'hairline': 'hairline', 'motoyui': 'cord',
        'kosode': 'kosode', 'eri': 'kosode', 'juban': 'juban',
        'hakama': 'hakama', 'obi': 'obi', 'koshiita': 'hakama', 'himo1': 'himo', 'himo2': 'himo', 'knotF': 'himo', 'knotB': 'himo', 'knotE': 'himo',
        'sw_saya': 'saya', 'sw_metal': 'metal', 'sw_iron': 'iron', 'sw_tsuka': 'tsuka',
        'soleL': 'straw', 'soleR': 'straw', 'hanaoL': 'hanao', 'hanaoR': 'hanao',
    }
    for k, m in assign.items():
        U.assign_material(P[k], M[m])
    return M


def skin_tint(P):
    out = {'head': MP.skin_tint(U.verts_game(P['head']), H.hairline_y), 'hair': HR.hair_tint(U.verts_game(P['hair'])),
           'hairline': np.full((len(P['hairline'].data.vertices), 3), 0.6)}      # 生え際の毛の板は髪の層より明るく見えないように
    out.update(B_skin_tint_arms(P))
    return out


def B_skin_tint_arms(P):
    """腕の色味（hero_v3 と同じ。指の節・爪）"""
    import anatomy as A
    out = {}
    for k, s in (('armL', 1), ('armR', -1)):
        Va = U.verts_game(P[k])
        ca = np.ones((len(Va), 3))
        W_, dv, t, n = A.hand_frame(s)
        for pts, R, dirs in A.finger_chains(s):
            for j in range(1, 3):
                d = np.linalg.norm(Va - pts[j], axis=1)
                ca *= (1 - np.exp(-(d / 0.009) ** 2)[:, None] * np.array([0.0, 0.07, 0.07]))
            tip = pts[3] - dirs[2] * 0.008 - n * 0.006
            d = np.linalg.norm(Va - tip, axis=1)
            ca = ca * (1 - np.exp(-(d / 0.006) ** 2)[:, None] * np.array([-0.08, -0.02, -0.02]))
        out[k] = np.clip(ca, 0, 1.2)
    return out


def check_orientation(ob):
    """頭の面が外を向いているか（面の法線と、頭の中心からの向きの内積の平均）"""
    V = U.verts_game(ob)
    Fc = [list(p.vertices) for p in ob.data.polygons]
    c = np.array([0.0, 1.62, -0.01])
    dots = []
    for f in Fc[::7]:
        p = V[f]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        dots.append(np.sign(n @ (p.mean(0) - c)))
    return float(np.mean(dots))


def main():
    arm = B.import_rig()
    B.relax_arms(arm)
    P = body_parts()
    P = head_parts(P)
    log('head orientation (+1 = outward)', round(check_orientation(P['head']), 3))
    decimate(P)
    B.uvs(P)
    materials(P)
    tint = skin_tint(P)
    ao = B.bake_ao({k: o for k, o in P.items() if k != 'hairline'})     # 透ける板は AO を焼かない
    B.write_colors(P, tint, ao)
    HR.uninstall()
    for k, th in (('eri', 0.004), ('juban', 0.002), ('hakama', 0.004)):
        sm = P[k].modifiers.new('solid', 'SOLIDIFY')
        sm.thickness = th
        sm.offset = -1
        sm.use_even_offset = False
        sm.use_rim = True
    B.rig({k: o for k, o in P.items() if k != 'hairline'}, arm)
    B.apply_weights(P['hairline'], B.one_hot(len(P['hairline'].data.vertices), 'Head'), arm)   # 生え際の毛の板は頭の骨だけ
    tris = sum(U.ntris(o) for o in P.values())
    log('triangles total', tris)
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(0)
    B.export(arm, P)
    info = B.verify()
    info['feet'] = B.feet_check(arm, P)
    info['mpfb'] = {'macro': HM.MACRO, 'mods': HM.MODS, 'files': sorted(MB.USED)}
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'hero_v3_mpfb.blend'))
    (WORK / 'hero_v3_mpfb-info.json').write_text(json.dumps(info, indent=1, ensure_ascii=False, default=str))
    log('done')


if __name__ == '__main__':
    main()
