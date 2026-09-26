"""
樹冠の透け具合を数える（普通の python3。scipy を使う）。
    python3 gapstat.py <アルファの PNG> <閉じる半径 px>
不透明（アルファ 0.5 以上）の所を、半径 r の円で閉じて穴を埋めたものを「樹冠の範囲」とし、その中の透明な割合（空が見える割合）を出す。
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

if __name__ == '__main__':
    a = np.asarray(Image.open(sys.argv[1]).convert('L'), np.float32) / 255.0
    r = int(sys.argv[2])
    m = a > 0.5
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disk = xx * xx + yy * yy <= r * r
    pad = np.pad(m, r + 2)
    region = ndimage.binary_closing(pad, disk)[r + 2:-r - 2, r + 2:-r - 2]
    region = ndimage.binary_fill_holes(region)
    gap = 1.0 - m[region].mean()
    print(f'sky visible through crown: {gap * 100:.1f}% (region {region.sum()} px, closing r={r}px)')
