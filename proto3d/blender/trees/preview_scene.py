"""
確認用：場面の組み立て（proto3d/blender/scene/assemble.py：町家・門・塀・天守・地面・主人公・木を main.ts と同じ配置で読み込む）に、
遠景の松 tree_pine_far を置き場所（build_pine_far.FAR_PLACES）どおりに足して、ゲームの肩越しのカメラから描く。
光と色の出し方も assemble.py のもの（three.js に寄せた環境光・ACES・空と霧）。
    /root/blender-venv/bin/python proto3d/blender/trees/preview_scene.py [samples]
出力: e2e-out/blender/trees-game-camera.png（開始の画面）、trees-game-camera-left.png（少し左）、trees-gate-shadow.png（門の前）
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from treelib import BLENDER_DIR, MODELS_DIR, PREVIEW_DIR, reset  # noqa: E402

sys.path.insert(0, str(BLENDER_DIR / 'scene'))
import assemble as A  # noqa: E402

from build_pine_far import FAR_PLACES  # noqa: E402


def main(samples=24):
    reset()
    A.assemble(hero=True)
    if (MODELS_DIR / 'tree_pine_far.glb').exists():
        root, objs = A.load_glb('tree_pine_far')
        for i, (x, z, rot, sc) in enumerate(FAR_PLACES):
            A.place_copy(f'tree_pine_far{i}', objs, (x, 0, z), rot, sc)
        root.location = (0, 0, -200)   # 読み込んだ元は使わない（地面の下へ）
    A.setup_game_look()
    for view, name in (('main', 'trees-game-camera'), ('left', 'trees-game-camera-left')):
        cam, tgt = A.game_camera(**A.VIEWS[view])
        A.render_game(PREVIEW_DIR / f'{name}.png', cam, tgt, res=(1280, 720), samples=samples)
    # 門の前の道に落ちる桜の木陰（少し高い所から）
    A.render_game(PREVIEW_DIR / 'trees-gate-shadow.png', (-1.0, 3.2, -1.0), (-2.5, 0.8, -12.0), res=(960, 540), samples=samples)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 24)
