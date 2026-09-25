"""
地面の確認用の近い視点（assemble.py で場面を組み立て、ゲームに寄せた光で描く）。
    /root/blender-venv/bin/python proto3d/blender/scene/preview_ground.py [--samples 16] [--res 960x540] [--views ditch_w,ditch_e,fence,feet,base,apron,main] [--ground GLB] [--prefix ground]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import assemble as asm  # noqa: E402
from common import PREVIEW_DIR, reset  # noqa: E402

VIEWS = {
    # 名前: (カメラ, 見る点) ゲームの座標。'main'・'left' は assemble.VIEWS（開始の画面）
    'ditch_w': ((-1.6, 1.6, 0.2), (-4.0, 0.0, -2.6)),
    'base': ((0.2, 1.7, -7.2), (-3.8, 0.1, -11.3)),
    'apron': ((0.8, 1.8, -6.5), (-0.6, 0.0, -11.0)),
    'drip_e': ((4.3, 1.4, -8.9), (5.2, 0.0, -11.2)),
    'alley': ((-3.2, 1.6, -4.0), (-6.5, 0.0, -6.2)),
    'ditch_e': ((2.2, 1.7, -6.2), (4.6, 0.0, -10.2)),
    'fence': ((-2.4, 1.7, -5.4), (-6.5, 0.3, -9.2)),
    'feet': ((0.3, 1.9, -2.0), (-0.9, 0.0, -6.8)),
    'gate': ((0.5, 1.8, -6.0), (0.0, 0.6, -12.5)),
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples', type=int, default=16)
    ap.add_argument('--res', default='960x540')
    ap.add_argument('--views', default=','.join(VIEWS))
    ap.add_argument('--no-hero', action='store_true')
    ap.add_argument('--ground', default=None, help='地面の GLB（既定は public/models/ground_v2.glb）')
    ap.add_argument('--prefix', default='ground')
    a = ap.parse_args(argv)
    res = tuple(int(v) for v in a.res.split('x'))
    reset()
    asm.assemble(hero=not a.no_hero, ground_path=a.ground)
    asm.setup_game_look()
    for v in a.views.split(','):
        cam, tgt = VIEWS.get(v, (None, None))
        if v in asm.VIEWS:
            cam, tgt = asm.game_camera(**asm.VIEWS[v])
        asm.render_game(PREVIEW_DIR / f'{a.prefix}-{v}.png', cam, tgt, res=res, samples=a.samples)


if __name__ == '__main__':
    main(sys.argv[1:])
