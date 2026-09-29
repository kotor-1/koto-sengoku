"""
頭部の比較案（hero_v3_mpfb.glb）の頭と首の肌：MPFB2（MakeHuman）の CC0 の人体の基本形（base.obj）から作る。
- 年齢・性別・人種などの組み合わせ（macrodetails）と、顔の形の調整（targets の head / chin / mouth / nose / eyes / cheek ...）を重みで足す
- 承認済み参考画像の人物（若い侍）を方向性にしたオリジナルの顔。特定の実在の人物の再現ではない
- ゲームの座標（x 左、y 上、z 前、メートル）へ：1/10 に縮め、頭頂を 1.745 に置く。首の下（襟の中・胸の V）は
  体の SDF（anatomy の胴と首）の面へなめらかに寄せる（小袖・襟・骨組みは hero_v3 のまま使うため）
"""
from __future__ import annotations

import numpy as np

import anatomy as A
import mpfb_base as MB
from sdf import F

# ---- 形の設定 ----
import os as _os
import json as _json
MACRO = dict(gender=1.0, age=0.5, muscle=0.70, weight=0.25, race={'asian': 0.58, 'caucasian': 0.42, 'african': 0.0})
# 'a|b' は負なら a、正なら b。単独の名前はその重み
# 第 2 案（見直し 1 回目の指摘を受けて）：体重を下げ（顔の脂肪・あごの下のたるみを減らす）、あご先を少し前へ・あごの角を読めるように、
# 唇の厚みを戻し、眉の骨を下げて前へ、上まぶたを少し下げる（丸い目・上がった眉に見えないように）。あご幅は細くしない
MODS = {
    'head/head-oval': 0.40,
    'head/head-scale-horiz-decr|head/head-scale-horiz-incr': -0.22,
    'head/head-square': 0.40,                                   # あごの角（エラ）を少し
    'head/head-fat-decr|head/head-fat-incr': -0.40,             # 顔の脂肪を減らす（頬・あごの下）
    'neck/neck-double-decr|neck/neck-double-incr': -0.60,       # あごの下のたるみを減らす（横顔のあご → 首の線）
    'chin/chin-width-decr|chin/chin-width-incr': 0.15,          # あごは細くとがらせない（幅を少し足す）
    'chin/chin-bones-decr|chin/chin-bones-incr': 0.35,
    'chin/chin-height-decr|chin/chin-height-incr': 0.20,
    'chin/chin-prominent-decr|chin/chin-prominent-incr': 0.55,  # あご先を前へ（横顔であごが引っ込まない）
    'chin/chin-prognathism-decr|chin/chin-prognathism-incr': 0.15,
    'mouth/mouth-scale-depth-decr|mouth/mouth-scale-depth-incr': -0.05,   # 唇を前へ出さない（弱め）
    'mouth/mouth-upperlip-volume-decr|mouth/mouth-upperlip-volume-incr': 0.35,   # 唇の厚みを戻す（細い線に見えないように）
    'mouth/mouth-lowerlip-volume-decr|mouth/mouth-lowerlip-volume-incr': 0.25,
    'nose/nose-trans-backward|nose/nose-trans-forward': 0.10,
    'nose/nose-scale-vert-decr|nose/nose-scale-vert-incr': 0.12,
    'nose/nose-scale-depth-decr|nose/nose-scale-depth-incr': 0.25,
    'nose/nose-hump-decr|nose/nose-hump-incr': 0.10,
    'cheek/l-cheek-volume-decr|cheek/l-cheek-volume-incr': -0.30,
    'cheek/r-cheek-volume-decr|cheek/r-cheek-volume-incr': -0.30,
    'cheek/l-cheek-inner-decr|cheek/l-cheek-inner-incr': -0.30,
    'cheek/r-cheek-inner-decr|cheek/r-cheek-inner-incr': -0.30,
    'cheek/l-cheek-bones-decr|cheek/l-cheek-bones-incr': 0.25,
    'cheek/r-cheek-bones-decr|cheek/r-cheek-bones-incr': 0.25,
    'eyebrows/eyebrows-trans-down|eyebrows/eyebrows-trans-up': -0.45,        # 眉の骨を下げる（目に近く）
    'eyebrows/eyebrows-trans-backward|eyebrows/eyebrows-trans-forward': 0.45,
}
for _s in ('l', 'r'):      # 目の開き：MPFB の既定（約 6.7mm）から約 9mm へ。真ん中は上げすぎない（丸い目にしない）。上まぶたの折れ目を下げる
    MODS[f'eyes/{_s}-eye-height1-decr|eyes/{_s}-eye-height1-incr'] = 0.30
    MODS[f'eyes/{_s}-eye-height2-decr|eyes/{_s}-eye-height2-incr'] = 0.25
    MODS[f'eyes/{_s}-eye-height3-decr|eyes/{_s}-eye-height3-incr'] = 0.30
    MODS[f'eyes/{_s}-eye-eyefold-down|eyes/{_s}-eye-eyefold-up'] = -0.40
if _os.environ.get('MPFB_MODS'):          # 試しの調整（デバッグ用）：JSON で上書き
    MODS.update(_json.loads(_os.environ['MPFB_MODS']))
if _os.environ.get('MPFB_MACRO'):
    MACRO.update(_json.loads(_os.environ['MPFB_MACRO']))

SCALE = 0.1025                 # dm → m（× 1.025：旧の頭より少し大きく。首が長く頭が小さく見えないように。頭頂の高さは同じ）
CROWN_Y = 1.745                # 頭頂の高さ（旧の頭 1.748）
Z_OFF = -0.048                 # 前後の位置（首の中心を体の首の中心 z≈-0.02 に合わせる）


def _mods_all():
    out = []
    for k, v in MODS.items():
        out += MB.modifier_targets({k: v})
    return out


_CACHE = {}


def raw():
    """base.obj に形の調整を足した頂点（dm、MakeHuman の座標）と面・面の組"""
    if 'raw' not in _CACHE:
        V, Fc, G = MB.load_base()
        tg = MB.macro_targets(MACRO['gender'], MACRO['age'], MACRO['muscle'], MACRO['weight'], MACRO['race']) + _mods_all()
        V = MB.apply_targets(V, tg)
        _CACHE['raw'] = (V, Fc, G, tg)
    return _CACHE['raw']


def to_game(V):
    V0, Fc, G, _ = raw()
    crown = V0[np.unique(Fc[G == 'body'])][:, 1].max()
    return (np.asarray(V) - np.array([0.0, crown, 0.0])) * SCALE + np.array([0.0, CROWN_Y, Z_OFF])


def group_verts(name):
    V, Fc, G, _ = raw()
    return np.unique(Fc[G == name])


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def conform_weight(Vg):
    """体の SDF へ寄せる重み（1：完全に寄せる、0：MPFB のまま）。前（あごの下・喉）は低い所まで MPFB、うなじは高くまで寄せる"""
    z = Vg[:, 2]
    y0 = np.interp(z, [-0.08, -0.04, 0.0, 0.04, 0.08], [1.490, 1.485, 1.470, 1.455, 1.450])
    y1 = np.interp(z, [-0.08, -0.04, 0.0, 0.04, 0.08], [1.535, 1.530, 1.512, 1.495, 1.490])
    return 1 - smooth01((Vg[:, 1] - y0) / (y1 - y0))


def _grad(fn, P, e=3e-4):
    g = np.zeros_like(P)
    for k in range(3):
        d = np.zeros(3)
        d[k] = e
        g[:, k] = (fn((P + d).astype(F)) - fn((P - d).astype(F))) / (2 * e)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def conform(Vg, w, Q=None):
    """w の重みで体の SDF の面へ寄せる。Q があれば、寄せた所を面の上でならす（MPFB の鎖骨・胸の凹凸を面へ押しつけてできる
    しわ・折れを消す）"""
    fn = lambda P: A.body(P, ['torso', 'neck'])
    sel = np.nonzero(w > 1e-4)[0]

    def project(P):
        for _ in range(6):
            d = fn(P.astype(F)).astype(float)
            P = P - _grad(fn, P) * np.clip(d, -0.03, 0.03)[:, None]
        return P
    P = project(Vg[sel].copy())
    out = Vg.copy()
    out[sel] = Vg[sel] + (P - Vg[sel]) * w[sel, None]
    if Q is not None:
        E = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]])
        n = len(out)
        deg = np.zeros(n)
        np.add.at(deg, E[:, 0], 1)
        np.add.at(deg, E[:, 1], 1)
        ws = np.clip(w * 1.3, 0, 1) * 0.6
        for it in range(40):
            acc = np.zeros_like(out)
            np.add.at(acc, E[:, 0], out[E[:, 1]])
            np.add.at(acc, E[:, 1], out[E[:, 0]])
            avg = acc / np.maximum(deg, 1)[:, None]
            out = out + (avg - out) * ws[:, None]
            if it % 4 == 3:
                full = np.nonzero(w > 0.98)[0]
                out[full] = project(out[full])
        full = np.nonzero(w > 0.98)[0]
        out[full] = project(out[full])
    return out


def ear_verts(s=1):
    """耳の頂点（base.obj の番号）：耳を動かす形の調整（ears/?-ear-trans-up）で 9 割以上動く頂点"""
    idx, d = MB.load_target(f"ears/{'l' if s > 0 else 'r'}-ear-trans-up")
    m = np.linalg.norm(d, axis=1)
    return idx[m > 0.9 * m.max()]


def flatten_ears(V, Fc):
    """耳を頭の横の面へならした頂点（髪の層を測る「耳のない頭」用）：耳の頂点だけを、周りを固定して何度もならす（膜のように張る）"""
    V = V.copy()
    E = np.concatenate([Fc[:, [0, 1]], Fc[:, [1, 2]], Fc[:, [2, 3]], Fc[:, [3, 0]]])
    for s in (1, -1):
        ear = ear_verts(s)
        m = np.zeros(len(V), bool)
        m[ear] = True
        e = E[m[E[:, 0]] | m[E[:, 1]]]
        for _ in range(400):
            acc = np.zeros_like(V)
            cnt = np.zeros(len(V))
            np.add.at(acc, e[:, 0], V[e[:, 1]])
            np.add.at(acc, e[:, 1], V[e[:, 0]])
            np.add.at(cnt, e[:, 0], 1)
            np.add.at(cnt, e[:, 1], 1)
            V[ear] = acc[ear] / np.maximum(cnt[ear], 1)[:, None]
    return V


def catmull_clark(V, Q):
    """Blender の細分割（Catmull-Clark 1 段）"""
    import bpy
    me = bpy.data.meshes.new('_cc')
    me.from_pydata([tuple(v) for v in V], [], [tuple(int(i) for i in q) for q in Q])
    ob = bpy.data.objects.new('_cc', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('ss', 'SUBSURF')
    m.levels = 1
    m.render_levels = 1
    m.boundary_smooth = 'PRESERVE_CORNERS'
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    V2 = np.zeros(len(me2.vertices) * 3)
    me2.vertices.foreach_get('co', V2)
    Q2 = np.array([p.vertices[:] for p in me2.polygons])
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    bpy.data.meshes.remove(me2)
    return V2.reshape(-1, 3), Q2


def skin_piece(noear=False, subdiv=1):
    """頭・首・胸の上（襟の V から見える所まで）の肌。返り値：頂点（ゲームの座標）、四角の面。
    subdiv=1 なら 1 段細分割してから首の下を体の SDF へ寄せる（減らすのは書き出しの前）"""
    key = ('skin', noear, subdiv)
    if key in _CACHE:
        return _CACHE[key]
    V, Fc, G, _ = raw()
    Fb = Fc[G == 'body']
    if noear:
        V = flatten_ears(V, Fb)
    Vg = to_game(V)
    y_cut = 1.335 + (0.07 - Vg[:, 2]) * 0.55     # 旧の頭と同じ斜めの切り口（前は低く、後ろは高く）
    keep = (Vg[:, 1] > y_cut - 0.01) & (np.abs(Vg[:, 0]) < 0.125)
    Fb = Fb[keep[Fb].all(1)]
    used = np.unique(Fb)
    remap = -np.ones(len(V), int)
    remap[used] = np.arange(len(used))
    Vs, Qs = Vg[used], remap[Fb]
    if subdiv:
        Vs, Qs = catmull_clark(Vs, Qs)
    Vs = conform(Vs, conform_weight(Vs), Qs)
    _CACHE[key] = (Vs, Qs)
    return Vs, Qs


SDF_LO, SDF_HI, SDF_H = (-0.125, 1.43, -0.155), (0.125, 1.80, 0.145), 0.0015


def head_sdf(noear=False):
    """新しい頭と首の肌の SDF（格子。髪・眉を沿わせる）"""
    key = ('sdf', noear)
    if key not in _CACHE:
        import mpfb_sdf
        V, Q = skin_piece(noear)
        _CACHE[key] = mpfb_sdf.GridSDF(V, Q, SDF_LO, SDF_HI, SDF_H, band=0.030, tag='mpfb-noear' if noear else 'mpfb')   # 髪の外の面（肌から 2cm 余り）まで細かい格子（粗い格子の値は段々になり、頭頂がでこぼこに見えた）
    return _CACHE[key]


def eye_fit(s):
    """MPFB の眼球の補助の形（helper-l-eye / helper-r-eye）の中心と半径（ゲームの座標）"""
    V, Fc, G, _ = raw()
    P = to_game(V[group_verts('helper-l-eye' if s > 0 else 'helper-r-eye')])
    c = P.mean(0)
    return c, float(np.linalg.norm(P - c, axis=1).mean())


def landmarks():
    """色味・眉・髪の位置合わせに使う点（ゲームの座標）。MakeHuman の座標で決めた点を同じ変換で移す"""
    V, Fc, G, _ = raw()
    body = V[group_verts('body')]
    mid = body[np.abs(body[:, 0]) < 0.01]
    face = mid[(mid[:, 2] > 1.0) & (mid[:, 1] > 6.0) & (mid[:, 1] < 7.6)]
    tip = face[np.argmax(face[:, 2])]
    return {'nose_tip': to_game(tip[None])[0]}


def lid_rows(s):
    """まぶたの縁（まつ毛の補助の形 helper-*-eyelashes-1/2 の根元の列）。返り値：上の縁、下の縁（内 → 外の順、ゲームの座標）"""
    V, Fc, G, _ = raw()
    c, _ = eye_fit(s)
    side = 'l' if s > 0 else 'r'
    out = []
    for k in (2, 1):
        P = to_game(V[group_verts(f'helper-{side}-eyelashes-{k}')])
        d = np.linalg.norm(P - c, axis=1)
        bins = np.round(P[:, 0] / 0.0015).astype(int)
        row = []
        for b in np.unique(bins):
            m = np.nonzero(bins == b)[0]
            row.append(P[m[np.argmin(d[m])]])
        row = np.array(row)
        row = row[np.argsort(np.abs(row[:, 0]))]
        out.append(row)
    return out[0], out[1]


EYE_ADJ = dict(dx=0.0, dy=0.0010, dz=-0.0010)   # 上まぶたが黒目の上を約 2mm 覆い、下まぶたは黒目の下の縁に届く高さ。1mm 奥へ（まぶたの厚みが見える）
if _os.environ.get('MPFB_EYE'):
    EYE_ADJ.update(_json.loads(_os.environ['MPFB_EYE']))
EYE_R = 0.0135          # 眼球の半径（白目の球）。黒目の直径は約 11.6mm（eyeball の iris_scale で合わせる）


def eye_place(s):
    """眼球の中心：まぶたの開きの真ん中（横は開きの中心から 0.4mm 外、縦は開きの中心から 0.6mm 上）。
    前後は、上下のまぶたの縁が白目の面の 0.3mm 外に来る所。そこから EYE_ADJ だけずらす（第 2 案：1mm 上・1mm 奥）"""
    up, lo = lid_rows(s)
    x0, x1 = abs(lo[0, 0]), abs(lo[-1, 0])
    cx = 0.5 * (x0 + x1) + 0.0004
    upm = up[np.argmin(np.abs(np.abs(up[:, 0]) - cx))]
    lom = lo[np.argmin(np.abs(np.abs(lo[:, 0]) - cx))]
    cy = 0.5 * (upm[1] + lom[1]) + 0.0006
    h = 0.5 * (upm[1] - lom[1])
    zl = 0.5 * (upm[2] + lom[2])
    cz = zl - 0.0003 - np.sqrt(EYE_R ** 2 - h ** 2)
    e = EYE_ADJ
    return np.array([s * (cx + e['dx']), cy + e['dy'], cz + e['dz']]), EYE_R


def face_landmarks():
    """色味の位置：口の合わせ目（高さ・前後）、鼻先、耳の中心（左）。面の真ん中の縦の線と耳の頂点から求める"""
    if 'lm' in _CACHE:
        return _CACHE['lm']
    V, Q = skin_piece()
    mid = V[(np.abs(V[:, 0]) < 0.0012) & (V[:, 2] > 0.06) & (V[:, 1] > 1.52) & (V[:, 1] < 1.62)]
    tip = mid[np.argmax(mid[:, 2])]
    # 口：鼻の下 1.5〜4.5cm で、前の面（各高さで一番前）が一番へこむ所（唇の合わせ目）
    ys = np.arange(tip[1] - 0.045, tip[1] - 0.015, 0.0008)
    front = np.array([mid[np.abs(mid[:, 1] - y) < 0.0012][:, 2].max(initial=-1) for y in ys])
    lipu = np.argmax(np.where(ys > tip[1] - 0.032, front, -1))
    lipl = np.argmax(np.where(ys < ys[lipu] - 0.004, front, -1))
    seg = slice(lipl, lipu + 1)
    j = lipl + int(np.argmin(front[seg]))
    Vr, Fc, G, _ = raw()
    ear = to_game(Vr[ear_verts(1)]).mean(0)
    _CACHE['lm'] = {'nose_tip': tip, 'mouth': (float(ys[j]), float(front[j])), 'ear': ear}
    return _CACHE['lm']
