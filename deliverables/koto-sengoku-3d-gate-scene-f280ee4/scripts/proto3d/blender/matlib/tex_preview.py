"""材質の画像を作り置きし、画像そのもの（色と、斜めの光で陰を付けたもの）を 1 枚に並べる（確認用）"""
import sys
import time
sys.path.insert(0, '/home/user/koto-sengoku/proto3d/blender/lib')
import numpy as np
import bpy
from common import PREVIEW_DIR
import mats

force = '--force' in sys.argv
only = [a for a in sys.argv[1:] if not a.startswith('--')]
names = only or mats.NAMES


def load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[..., :3]


cells = []
for nm in names:
    t = time.time()
    p = mats.build_textures(nm, force=force)
    print(f'{nm}: {time.time() - t:.1f}s', flush=True)
    alb = load(p['albedo'])
    nor = load(p['normal']) * 2 - 1
    n = alb.shape[0]
    # 画像の 1/2 の範囲を 384 に縮めて見る
    crop = slice(0, n // 2)
    a = alb[crop, crop]
    nn = nor[crop, crop]
    k = max(1, a.shape[0] // 384)
    a = a[::k, ::k][:384, :384]
    nn = nn[::k, ::k][:384, :384]
    L = np.array([-0.55, 0.25, 0.8])
    L /= np.linalg.norm(L)
    lin = a ** 2.2
    sh = np.clip((nn * L).sum(-1), 0, 1)
    lit = np.clip(lin * (0.25 + 1.3 * sh)[..., None], 0, 1) ** (1 / 2.2)
    cells.append(np.concatenate([a, lit], 1))
cols = 3
rows = (len(cells) + cols - 1) // cols
H, W = 384, 768
sheet = np.full((rows * (H + 8), cols * (W + 8), 3), 0.15, np.float32)
for i, c in enumerate(cells):
    r, q = divmod(i, cols)
    # 上の行が先に来るよう（Blender の画像は下から）
    y0 = (rows - 1 - r) * (H + 8)
    sheet[y0:y0 + c.shape[0], q * (W + 8):q * (W + 8) + c.shape[1]] = c
mats._save_png(PREVIEW_DIR / 'mats-tex.png', sheet)
print('order:', names)
