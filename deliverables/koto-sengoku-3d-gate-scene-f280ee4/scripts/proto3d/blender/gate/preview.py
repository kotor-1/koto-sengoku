"""
確認用の描画（ゲームに近い光：日差し 3.4・西南西、弱い空の光）。カメラと見る点はゲームの座標。
    単独でも: /root/blender-venv/bin/python proto3d/blender/gate/preview.py  （書き出した GLB は読まず、build.py から呼ぶ）
"""
from __future__ import annotations

import os

from gkit import PREVIEW_DIR, mats, preview_ground, render

VIEWS = {
    # 道から（門の 12 m 南、目の高さ。ゲームの肩越しのカメラに近い）
    'road': ((0.8, 1.9, 0.2), (0.0, 3.3, -12.0), 50.0),
    # 門の 5 m 手前
    'near': ((1.5, 1.7, -7.0), (0.0, 3.4, -12.0), 55.0),
    # 塀の根元の石積み（近く）
    'stones': ((-4.6, 1.25, -9.4), (-6.2, 0.55, -11.5), 50.0),
    # 屋根の下を見上げる
    'roofunder': ((1.0, 1.6, -9.3), (0.0, 6.2, -12.0), 60.0),
    # 門越しの天守
    'keep': ((0.9, 1.8, -3.5), (4.0, 9.0, -70.0), 45.0),
    # 門の裏（城内）から
    'inside': ((-3.5, 1.8, -20.5), (0.5, 3.0, -12.0), 55.0),
    # east_ns の南の端（主人公の出発点の近くから見える妻）と、east_ew との突き当たり
    'nsend': ((3.0, 1.8, 7.0), (7.6, 2.2, 2.0), 55.0),
    'junction': ((4.3, 1.8, -7.6), (7.6, 3.4, -12.0), 60.0),
    # east_ns と east_ew の笠の取り合い（谷）を上から（確認用。ゲームの目の高さからは見えない）
    'junctiontop': ((5.0, 6.2, -8.6), (7.6, 4.0, -11.8), 50.0),
    # 門の妻（破風・妻板・二軒の木口）を南東の道から
    'gable': ((5.2, 1.8, -5.0), (3.2, 5.8, -12.0), 45.0),
    # 天守を門の前から望遠で（形の確認用）
    'keepclose': ((0.5, 2.5, -13.0), (9.0, 21.0, -115.0), 16.0),
}


def run(groups, quick=False, only=None):
    mats.game_lights()
    preview_ground(0.0, 50.0, 320.0, n=32)
    samples = 12 if quick else 28
    names = only or os.environ.get('KOTO_VIEWS', '').split(',')
    names = [n for n in names if n] or list(VIEWS)
    for name in names:
        cam, tgt, fov = VIEWS[name]
        render(PREVIEW_DIR / f'gate_{name}.png', cam, tgt, samples=samples, fov=fov)
