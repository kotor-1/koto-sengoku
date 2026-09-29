"""
MPFB2（MakeHuman の Blender 版）の CC0 の素材（基本の人体メッシュ base.obj と形の調整データ *.target.gz）を読む、自作の小さな読み込み。
MPFB のプログラム（GPLv3）は使わない・ゲームにも入れない。使うのは素材のデータだけ。

- 素材の写し：proto3d/thirdparty/mpfb2/src/mpfb/data/（入手元 https://github.com/makehumancommunity/mpfb2 、MPFB 2.0.17、コミット 3edf9df、CC0 1.0）
- base.obj：y が上、+z が前、+x が体の左、単位は dm（デシメートル）。頂点は 19158（体 13380 ＋ 目・歯・まつ毛などの補助の形）
- *.target.gz：各行「頂点の番号 dx dy dz」（base.obj の頂点の番号、単位も同じ）。重みを掛けて足す
- 年齢・性別・人種・筋肉・体重の組み合わせ（macrodetails）は MakeHuman と同じ規則で重みを決める（下の macro_targets）
"""
from __future__ import annotations

import gzip
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]            # proto3d/
DATA = ROOT / 'thirdparty' / 'mpfb2' / 'src' / 'mpfb' / 'data'
UPSTREAM = pathlib.Path('/root/thirdparty/mpfb2/src/mpfb/data')  # 写しを作るときの元（リポジトリの外）
USED: set[str] = set()                                        # 読んだ素材（data/ からの相対の道）


def _path(rel):
    USED.add(rel)
    p = DATA / rel
    if not p.exists() and (UPSTREAM / rel).exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes((UPSTREAM / rel).read_bytes())          # 使った素材だけを写す（相対の道はそのまま）
    return p


def load_base():
    """base.obj → 頂点 (N,3)、面 (M,4) の頂点の番号、面の組の名前 (M,)"""
    V, Fc, G = [], [], []
    g = ''
    with open(_path('3dobjs/base.obj')) as f:
        for ln in f:
            if ln.startswith('v '):
                V.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith('f '):
                Fc.append([int(t.split('/')[0]) - 1 for t in ln.split()[1:]])
                G.append(g)
            elif ln.startswith('g '):
                g = ln.split()[1]
    return np.array(V), np.array(Fc), np.array(G)


def load_target(rel):
    """targets/<rel>.target.gz → (番号, 変位)"""
    idx, d = [], []
    with gzip.open(_path('targets/' + rel + '.target.gz'), 'rt') as f:
        for ln in f:
            if not ln.strip() or ln.startswith('#'):
                continue
            a = ln.split()
            idx.append(int(a[0]))
            d.append([float(a[1]), float(a[2]), float(a[3])])
    return np.array(idx, int), np.array(d, float).reshape(-1, 3)


def _interp(value, parts):
    """MakeHuman の macro.json の区切り（parts）で、低い側・高い側の重みを決める"""
    out = []
    for lowest, highest, low, high in parts:
        if lowest < value < highest:
            t = (value - lowest) / (highest - lowest)
            if low:
                out.append((low, 1 - t))
            if high:
                out.append((high, t))
    return out


MACRO_PARTS = {
    'gender': [(-0.01, 1.01, 'female', 'male')],
    'age': [(-0.01, 0.1874998, 'baby', 'child'), (0.1874999, 0.49998, 'child', 'young'), (0.49999, 1.01, 'young', 'old')],
    'muscle': [(-0.01, 0.49998, 'minmuscle', 'averagemuscle'), (0.49999, 1.01, 'averagemuscle', 'maxmuscle')],
    'weight': [(-0.01, 0.49998, 'minweight', 'averageweight'), (0.49999, 1.01, 'averageweight', 'maxweight')],
}


def macro_targets(gender, age, muscle, weight, race, cutoff=0.01):
    """（target の名前, 重み）の並び。race = {'asian': .., 'caucasian': .., 'african': ..}。
    MakeHuman の規則：人種-性別-年齢 の組と、universal-性別-年齢-筋肉-体重 の組"""
    c = {k: _interp(v, MACRO_PARTS[k]) for k, v in (('gender', gender), ('age', age), ('muscle', muscle), ('weight', weight))}
    out = []
    for r, rw in race.items():
        if rw <= 1e-4:
            continue
        for a, aw in c['age']:
            for g, gw in c['gender']:
                w = rw * gw * aw
                if w > cutoff:
                    out.append((f'macrodetails/{r}-{g}-{a}', w))
    for g, gw in c['gender']:
        for a, aw in c['age']:
            for m, mw in c['muscle']:
                for wt, ww in c['weight']:
                    w = gw * aw * mw * ww
                    if w > cutoff:
                        out.append((f'macrodetails/universal-{g}-{a}-{m}-{wt}', w))
    return out


def modifier_targets(mods):
    """{'nose/nose-hump': -0.3, 'chin/chin-width': 0.2, ...} → target の並び。
    値が正なら -incr / -up / -out / -forward ...、負なら反対の側。両側の名前は PAIRS から"""
    out = []
    for key, v in mods.items():
        if abs(v) < 1e-6:
            continue
        if '|' in key:                         # 'a|b'：負は a、正は b（名前がそのまま）
            neg, pos = key.split('|')
            out.append((pos if v > 0 else neg, abs(v)))
        else:                                  # 片側だけの target（例 'head/head-oval'）
            out.append((key, v))
    return out


def apply_targets(V, targets):
    V = V.copy()
    for rel, w in targets:
        idx, d = load_target(rel)
        V[idx] += w * d
    return V
