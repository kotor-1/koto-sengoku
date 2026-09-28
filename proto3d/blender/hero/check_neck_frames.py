"""
首と襟のつながりの目で見る確かめ（デバッグ用）。build_hero_v3.py の後に実行：
    /root/blender-venv/bin/python proto3d/blender/hero/check_neck_frames.py <out.png>
Walk（0・5・10・16 コマ）と Run（0・4・8・12 コマ）で、首・あご・襟の近くを前 3/4 と後ろ 3/4 から小さく描いて 1 枚に並べる。
光はゲームに合わせた preview_hero_v3.setup()。主人公は北（-z）を向く。
"""
from __future__ import annotations

import subprocess
import sys

sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/hero')

import preview_hero_v3 as PV  # noqa: E402
from common import PREVIEW_DIR  # noqa: E402

VIEWS = {
    'front': ((-0.30, 1.62, -0.55), (0.0, 1.50, 0.0)),
    'back': ((0.32, 1.66, 0.52), (0.0, 1.50, 0.0)),
}


def main(out):
    arm = PV.setup()
    files = []
    for act, frames in (('Walk', (0, 5, 10, 16)), ('Run', (0, 4, 8, 12))):
        for f in frames:
            PV.pose(arm, act, f)
            # 動きで体が前後するので、カメラは首の骨の位置に合わせて動かす
            import mathutils
            nb = arm.pose.bones['Neck']
            hp = arm.matrix_world @ nb.head
            g = (hp.x, hp.z, -hp.y)
            for vn, (pos, tgt) in VIEWS.items():
                p = (pos[0] + g[0], pos[1] + g[1] - 1.469, pos[2] + g[2])
                t = (tgt[0] + g[0], tgt[1] + g[1] - 1.469, tgt[2] + g[2])
                nm = f'neck-{act}-{f:02d}-{vn}'
                PV.cam(nm, p, t, (300, 300), 30, 12)
                files.append(str(PREVIEW_DIR / f'hero_v3-{nm}.png'))
    code = (
        "import sys, os\nfrom PIL import Image, ImageDraw\n"
        "fs=sys.argv[1:-1]\nims=[Image.open(f).convert('RGB') for f in fs]\n"
        "w,h=ims[0].size\ncols=8\nrows=(len(ims)+cols-1)//cols\nsheet=Image.new('RGB',(w*cols,h*rows),(0,0,0))\n"
        "for i,(f,im) in enumerate(zip(fs,ims)):\n  sheet.paste(im,((i%cols)*w,(i//cols)*h))\n  d=ImageDraw.Draw(sheet); d.text(((i%cols)*w+6,(i//cols)*h+6),f.split('neck-')[-1][:-4],fill=(255,255,255))\n"
        "sheet.save(sys.argv[-1])\nfor f in fs: os.remove(f)\n")
    subprocess.run(['python3', '-c', code] + files + [out], check=True)
    print('saved', out)


if __name__ == '__main__':
    main(sys.argv[-1])
