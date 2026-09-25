"""
木と草の素材をまとめて作り直す（画像 → 黒松 → 遠景の黒松 → 桜 → 草木 → 場面での確認の描画）。
    /root/blender-venv/bin/python proto3d/blender/trees/build_all.py [--no-preview]
画像は普通の python3（numpy・scipy・PIL）で作る（Blender の Python には PIL が無いため）。
"""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

if __name__ == '__main__':
    preview = '--no-preview' not in sys.argv
    subprocess.run(['python3', os.path.join(HERE, 'textures.py')], check=True)
    for s in ('build_pine.py', 'build_pine_far.py', 'build_sakura.py', 'build_plants.py'):
        subprocess.run([PY, os.path.join(HERE, s)] + ([] if preview else ['--no-preview']), check=True)
    if preview:
        subprocess.run([PY, os.path.join(HERE, 'preview_scene.py')], check=True)
