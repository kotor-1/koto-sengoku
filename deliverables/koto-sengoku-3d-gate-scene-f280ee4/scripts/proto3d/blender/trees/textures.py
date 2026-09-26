"""
木と草の画像（樹皮・松葉・桜の花・草）を作る。Blender ではなく普通の python3（numpy・scipy・PIL）で実行する。
    python3 proto3d/blender/trees/textures.py [--force]
出力は proto3d/blender/build/trees/*.png。乱数の種は固定なので、何度作っても同じ画像になる。
画像の横（u）は幹の周り、縦（v）は幹に沿う向き。どれも上下左右に繰り返せる（葉の画像は除く）。
"""
from __future__ import annotations

import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

OUT = pathlib.Path(__file__).resolve().parents[1] / 'build' / 'trees'
VERSION = 'v3'
# 画像ごとに作り直した版（ここに無い画像は VERSION）
VERSIONS = {'sakura_blossom': 'v4'}


def ver(name: str) -> str:
    return VERSIONS.get(name, VERSION)


# ---------------------------------------------------------------------------
# 道具
# ---------------------------------------------------------------------------

def c255(*c):
    return np.array(c, np.float32) / 255.0


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a + (b - a) * t


def pnoise(shape, seed, fmin, fmax, beta=1.0, stretch=(1.0, 1.0)):
    """周期ノイズ（スペクトル合成）。周波数は 1 枚あたりの波の数。stretch=(su, sv) で su>1 なら横に、sv>1 なら縦に長く伸びる"""
    rng = np.random.default_rng(seed)
    h, w = shape
    FX, FY = np.meshgrid(np.fft.fftfreq(w) * w, np.fft.fftfreq(h) * h)
    f = np.sqrt((FX * stretch[0]) ** 2 + (FY * stretch[1]) ** 2)
    amp = np.where((f >= fmin) & (f <= fmax), 1.0 / np.maximum(f, 1e-6) ** beta, 0.0)
    n = np.fft.ifft2(amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (h, w)))).real
    n -= n.mean()
    return (n / (n.std() + 1e-9)).astype(np.float32)


def pvoronoi(h, w, npts, seed, su=1.0, sv=1.0, warp=None):
    """周期ボロノイ（F1・F2・いちばん近い点の番号）。sv<1 で縦に長い区画"""
    rng = np.random.default_rng(seed)
    pts = rng.random((npts, 2)).astype(np.float32)
    U, V = np.meshgrid((np.arange(w, dtype=np.float32) + 0.5) / w, (np.arange(h, dtype=np.float32) + 0.5) / h)
    if warp is not None:
        U = (U + warp[0]) % 1.0
        V = (V + warp[1]) % 1.0
    F1 = np.full((h, w), 9.0, np.float32)
    F2 = F1.copy()
    ID = np.zeros((h, w), np.int32)
    for i, (pu, pv) in enumerate(pts):
        du = (U - pu + 0.5) % 1.0 - 0.5
        dv = (V - pv + 0.5) % 1.0 - 0.5
        d = np.sqrt((du * su) ** 2 + (dv * sv) ** 2)
        closer = d < F1
        F2 = np.where(closer, F1, np.minimum(F2, d))
        ID = np.where(closer, i, ID)
        F1 = np.where(closer, d, F1)
    return F1, F2, ID


def normal_map(hm, tile_u, tile_v):
    """高さ（メートル）から OpenGL 向きの法線画像（画像の上が +v）"""
    h, w = hm.shape
    dhdu = (np.roll(hm, -1, 1) - np.roll(hm, 1, 1)) / (2 * tile_u / w)
    dhdr = (np.roll(hm, -1, 0) - np.roll(hm, 1, 0)) / (2 * tile_v / h)
    nx, ny, nz = -dhdu, dhdr, np.ones_like(hm)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5


def save_rgb(path, rgb):
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(path)


def save_rgba(path, rgba):
    Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path)


def finish_cards(big: Image.Image, size: int, fill=0.55, sigma=2.2):
    """超標本化で描いた葉の画像を縮めて仕上げる：
    アルファを前乗算して縮小 → 透明部分へ色をにじませる（縁が黒くならない）→ 密なところの隙間を少し埋める（遠目で痩せない）"""
    a = np.asarray(big, np.float32) / 255.0
    S = a.shape[0] // size
    rgb = a[..., :3] * a[..., 3:4]
    rgb = rgb.reshape(size, S, size, S, 3).mean((1, 3))
    al = a[..., 3].reshape(size, S, size, S).mean((1, 3))
    rgb = rgb / np.maximum(al[..., None], 1e-4)
    mask = al < 0.08
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    rgb = np.where(mask[..., None], rgb[idx[0], idx[1]], rgb)
    al = np.maximum(al, fill * ndimage.gaussian_filter(al, sigma))
    return np.concatenate([rgb, al[..., None]], -1)


def col8(c, k=1.0, a=255):
    return (int(np.clip(c[0] * k, 0, 255)), int(np.clip(c[1] * k, 0, 255)), int(np.clip(c[2] * k, 0, 255)), a)


# ---------------------------------------------------------------------------
# 黒松の樹皮：縦長の亀甲状の厚い板と、深い割れ目
# ---------------------------------------------------------------------------

PINE_BARK_TILE = (0.8, 0.8)


def pine_bark(n=1024, seed=11):
    h = w = n
    wu = pnoise((h, w), seed + 1, 2, 6, 1.8) * 0.007
    wv = pnoise((h, w), seed + 2, 2, 6, 1.8) * 0.007
    npl = 115
    F1, F2, ID = pvoronoi(h, w, npl, seed, su=1.0, sv=0.5, warp=(wu, wv))
    crack = F2 - F1
    cw = 0.012 + 0.003 * pnoise((h, w), seed + 3, 4, 30)
    plate = smooth(0.35 * cw, cw, crack)
    G1, G2, GID = pvoronoi(h, w, 420, seed + 5, su=1.0, sv=0.75, warp=(wu, wv))
    sub = smooth(0.0, 0.0045, G2 - G1)
    rng = np.random.default_rng(seed + 9)
    cell_h = rng.uniform(0.55, 1.0, npl)[ID]
    tone = rng.uniform(-1, 1, npl)[ID]
    sub_tone = rng.uniform(-1, 1, 420)[GID]
    red = (rng.random(npl) < 0.14)[ID].astype(np.float32)
    bevel = smooth(0.0, 0.05, crack)
    # 板の重なり（横の層）と細かな凹凸
    layers = pnoise((h, w), seed + 4, 14, 200, 0.8, stretch=(6.0, 1.0))
    flakes = smooth(0.4, 1.4, pnoise((h, w), seed + 7, 20, 160, 0.9, stretch=(3.0, 1.0)))
    fine = pnoise((h, w), seed + 6, 80, 480, 0.5)
    hgt = plate * (cell_h * (0.6 + 0.4 * bevel) + 0.10 * layers - 0.08 * flakes) * (0.82 + 0.18 * sub) + 0.03 * fine
    hm = hgt * 0.022
    # 色：灰褐色の板、ところどころ赤みのある板、黒い割れ目
    c_plate = lerp(c255(74, 67, 61), c255(100, 92, 84), 0.5 + 0.35 * tone + 0.15 * sub_tone)
    c_plate = lerp(c_plate, c255(108, 80, 66), red * 0.6)
    col = lerp(c_plate, c255(124, 118, 110), np.clip(bevel * cell_h * 0.5 + 0.18 * layers, 0, 1) * 0.55)
    col = lerp(col, c255(64, 50, 44), flakes * 0.35)
    col = lerp(col, c255(52, 40, 35), (1 - sub) * 0.5 * plate)
    edge = smooth(0.35 * cw, 2.2 * cw, crack) * (1 - smooth(2.2 * cw, 4 * cw, crack))
    col = lerp(col, c255(96, 64, 50), edge * 0.35)
    col = lerp(c255(34, 26, 22), col, plate)
    col *= (1 + 0.07 * fine[..., None] + 0.04 * layers[..., None])
    return col, normal_map(hm, *PINE_BARK_TILE)


# ---------------------------------------------------------------------------
# 桜の樹皮：暗い赤茶の滑らかな肌と、横に長い皮目、薄く剥がれた帯、少しの地衣類
# ---------------------------------------------------------------------------

SAKURA_BARK_TILE = (0.6, 0.6)


def sakura_bark(n=1024, seed=21):
    h = w = n
    low = pnoise((h, w), seed + 1, 2, 12, 1.4)
    bands = pnoise((h, w), seed + 2, 6, 160, 0.9, stretch=(9.0, 1.0))
    fine = pnoise((h, w), seed + 3, 40, 400, 0.7)
    vert = pnoise((h, w), seed + 7, 6, 90, 1.0, stretch=(1.0, 6.0))
    col = lerp(c255(56, 43, 40), c255(82, 67, 61), smooth(-2.0, 2.0, low))
    # 剥がれかけの外皮の帯（明るく灰色がかる）
    strip = smooth(0.6, 1.3, bands) * smooth(-0.8, 0.4, low)
    col = lerp(col, c255(100, 90, 84), strip * 0.65)
    hgt = 0.25 * strip + 0.05 * fine - 0.08 * smooth(1.6, 2.6, vert)
    col = lerp(col, c255(54, 42, 38), smooth(1.6, 2.6, vert) * 0.35)
    # 皮目：横長の楕円を帯に沿って並べる（2 倍で描いて縮める）
    S = 2
    L = Image.new('L', (w * S, h * S), 0)
    Dk = Image.new('L', (w * S, h * S), 0)
    dl, dd = ImageDraw.Draw(L), ImageDraw.Draw(Dk)
    rng = np.random.default_rng(seed + 5)
    rows = np.sort(rng.random(34))
    for _ in range(900):
        v = (rows[rng.integers(len(rows))] + rng.normal(0, 0.006)) % 1.0
        u = rng.random()
        lu = rng.uniform(0.010, 0.050) / SAKURA_BARK_TILE[0]
        lv = rng.uniform(0.0020, 0.0042) / SAKURA_BARK_TILE[1]
        for ou in (-1, 0, 1):
            for ov in (-1, 0, 1):
                cx, cy = (u + ou) * w * S, (1 - v + ov) * h * S
                if -lu * w * S < cx < w * S * (1 + lu) and -0.05 * h * S < cy < h * S * 1.05:
                    dl.ellipse([cx - lu * w * S / 2, cy - lv * h * S / 2, cx + lu * w * S / 2, cy + lv * h * S / 2], fill=255)
                    dd.line([cx - lu * w * S * 0.3, cy, cx + lu * w * S * 0.3, cy], fill=255, width=max(1, int(lv * h * S * 0.18)))
    len_m = np.asarray(L, np.float32).reshape(h, S, w, S).mean((1, 3)) / 255.0
    slit = np.asarray(Dk, np.float32).reshape(h, S, w, S).mean((1, 3)) / 255.0
    len_blur = ndimage.gaussian_filter(len_m, 1.2, mode='wrap')
    col = lerp(col, c255(126, 102, 86), len_blur * 0.8)
    col = lerp(col, c255(70, 52, 46), slit * 0.5)
    hgt += 0.55 * len_blur - 0.5 * slit
    # 地衣類の斑点（灰緑）
    lich_n = pnoise((h, w), seed + 8, 8, 60, 1.2)
    lich = smooth(1.7, 2.3, lich_n) * smooth(-0.2, 0.6, fine * 0.5 + 0.5)
    col = lerp(col, c255(118, 122, 104), lich * 0.7)
    hgt += 0.15 * lich
    col *= (1 + 0.05 * fine[..., None])
    hm = hgt * 0.004
    return col, normal_map(hm, *SAKURA_BARK_TILE)


# ---------------------------------------------------------------------------
# 松葉の束（4 種を 2×2 に並べる）
# ---------------------------------------------------------------------------

NEEDLE_BASE = c255(44, 66, 38) * 255
NEEDLE_MID = c255(66, 94, 48) * 255
NEEDLE_TIP = c255(122, 142, 68) * 255
TWIG = c255(96, 74, 54) * 255
CANDLE = c255(158, 150, 112) * 255


def _bezier(p0, p1, p2, t):
    t = np.asarray(t)[..., None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2


def _needle(d, p, direction, length, width, rng, shade, bend=0.1):
    """1 本の針：根元は濃く先は明るい（4 区間に分けて色を変える）"""
    dvec = np.array(direction, np.float64)
    dvec /= np.linalg.norm(dvec)
    perp = np.array([-dvec[1], dvec[0]])
    p0 = np.array(p, np.float64)
    p2 = p0 + dvec * length
    p1 = p0 + dvec * length * 0.5 + perp * length * bend * rng.uniform(-1, 1)
    pts = _bezier(p0, p1, p2, np.linspace(0, 1, 5))
    for i in range(4):
        t = (i + 0.5) / 4
        c = NEEDLE_BASE + (NEEDLE_MID - NEEDLE_BASE) * min(1, t * 2) if t < 0.5 else NEEDLE_MID + (NEEDLE_TIP - NEEDLE_MID) * (t - 0.5) * 2
        wdt = max(2, int(width * (1.0 - 0.45 * t)))
        d.line([tuple(pts[i]), tuple(pts[i + 1])], fill=col8(c, shade), width=wdt)


def _clip_len(p, direction, length, lo, hi):
    """束がマスの外へはみ出さない長さに縮める"""
    dvec = np.asarray(direction, np.float64) / np.linalg.norm(direction)
    q = np.asarray(p) + dvec * length
    k = 1.0
    for ax in range(2):
        if q[ax] < lo[ax]:
            k = min(k, (lo[ax] - p[ax]) / (q[ax] - p[ax] + 1e-9))
        if q[ax] > hi[ax]:
            k = min(k, (hi[ax] - p[ax]) / (q[ax] - p[ax] + 1e-9))
    return length * max(0.2, k)


def _shoot(d, rng, cell, ox, oy, base, tip, bow, n_side, n_brush, spread=1.0, candle=True, twig_w=0.020, needle_len=(0.16, 0.30)):
    """1 本の枝先：枝の上に左右へ出る針と、先の筆のような束"""
    lo = (ox + 0.015 * cell, oy + 0.015 * cell)
    hi = (ox + 0.985 * cell, oy + 0.985 * cell)
    b = np.array([ox + base[0] * cell, oy + base[1] * cell])
    t_ = np.array([ox + tip[0] * cell, oy + tip[1] * cell])
    mid = (b + t_) / 2 + np.array([bow * cell, 0])
    ts = np.linspace(0, 1, 12)
    path = _bezier(b, mid, t_, ts)
    for i in range(11):
        wdt = int(cell * twig_w * (1 - 0.5 * ts[i]))
        d.line([tuple(path[i]), tuple(path[i + 1])], fill=col8(TWIG, 0.85 + 0.2 * ts[i]), width=max(3, wdt))
    items = []
    for k in range(n_side):
        t = rng.uniform(0.2, 1.0) ** 0.45
        p = _bezier(b, mid, t_, t)
        tan = _bezier(b, mid, t_, min(1, t + 0.01)) - _bezier(b, mid, t_, max(0, t - 0.01))
        tan /= np.linalg.norm(tan)
        side = 1 if rng.random() < 0.5 else -1
        ang = side * math.radians(rng.uniform(10, 46) * (1 - 0.35 * t) * spread)
        dvec = np.array([tan[0] * math.cos(ang) - tan[1] * math.sin(ang), tan[0] * math.sin(ang) + tan[1] * math.cos(ang)])
        ln = cell * rng.uniform(*needle_len)
        items.append((rng.uniform(0.55, 1.0), p, dvec, ln))
    tan = t_ - _bezier(b, mid, t_, 0.93)
    tan /= np.linalg.norm(tan)
    for k in range(n_brush):
        ang = math.radians(rng.normal(0, 26) * spread)
        dvec = np.array([tan[0] * math.cos(ang) - tan[1] * math.sin(ang), tan[0] * math.sin(ang) + tan[1] * math.cos(ang)])
        p = _bezier(b, mid, t_, rng.uniform(0.86, 1.0))
        ln = cell * rng.uniform(needle_len[0] * 1.05, needle_len[1] * 1.05)
        items.append((rng.uniform(0.6, 1.1), p, dvec, ln))
    items.sort(key=lambda it: it[0])
    for shade, p, dvec, ln in items:
        ln = _clip_len(p, dvec, ln, lo, hi)
        _needle(d, p, dvec, ln, cell * 0.0048, rng, shade)
    if candle:
        # 春の新芽（みどり）：先に淡い色の短い芽
        for k in range(rng.integers(0, 3)):
            ang = math.radians(rng.normal(0, 14))
            dvec = np.array([tan[0] * math.cos(ang) - tan[1] * math.sin(ang), tan[0] * math.sin(ang) + tan[1] * math.cos(ang)])
            ln = _clip_len(t_, dvec, cell * rng.uniform(0.045, 0.08), lo, hi)
            q = t_ + dvec * ln
            d.line([tuple(t_), tuple(q)], fill=col8(CANDLE, rng.uniform(0.85, 1.05)), width=int(cell * 0.012))
            d.ellipse([q[0] - cell * 0.007, q[1] - cell * 0.007, q[0] + cell * 0.007, q[1] + cell * 0.007], fill=col8(CANDLE, 1.05))


def _rosette(d, rng, cell, ox, oy):
    """上から見た束（放射状）：葉の塊の上面に寝かせて使う"""
    c = np.array([ox + 0.5 * cell, oy + 0.5 * cell])
    lo = (ox + 0.015 * cell, oy + 0.015 * cell)
    hi = (ox + 0.985 * cell, oy + 0.985 * cell)
    items = []
    for k in range(15):
        # 放射状に何本かの枝先の束（中心にも）
        a0 = k / 15 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        r0 = (rng.uniform(0.0, 0.03) if k % 3 == 0 else rng.uniform(0.04, 0.14)) * cell
        p0 = c + r0 * np.array([math.cos(a0), math.sin(a0)])
        for j in range(34):
            ang = a0 + rng.normal(0, 0.45)
            ln = cell * rng.uniform(0.15, 0.36)
            items.append((rng.uniform(0.5, 1.05), p0 + rng.normal(0, 0.012 * cell, 2), np.array([math.cos(ang), math.sin(ang)]), ln))
    items.sort(key=lambda it: it[0])
    for shade, p, dvec, ln in items:
        ln = _clip_len(p, dvec, ln, lo, hi)
        _needle(d, p, dvec, ln, cell * 0.0048, rng, shade)
    for k in range(3):
        q = c + rng.normal(0, 0.05 * cell, 2)
        r = cell * rng.uniform(0.007, 0.011)
        d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=col8(CANDLE, rng.uniform(0.9, 1.05)))


def pine_needles(size=1024, seed=31):
    S = 4
    cell = size // 2 * S
    img = Image.new('RGBA', (size * S, size * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed)
    nl = (0.17, 0.30)
    # 0: 根元から扇に開く 3 本の枝先（左上）
    for tip, bow in [((0.26, 0.40), -0.04), ((0.74, 0.40), 0.04), ((0.50, 0.26), 0.02)]:
        _shoot(d, rng, cell, 0, 0, (0.5, 0.99), tip, bow, 120, 60, needle_len=nl)
    # 1: 片側へ流れる 4 本（右上）
    for base, tip, bow in [((0.40, 0.99), (0.20, 0.46), -0.03), ((0.42, 0.85), (0.46, 0.27), 0.02),
                           ((0.45, 0.72), (0.76, 0.34), 0.05), ((0.50, 0.90), (0.80, 0.62), 0.03)]:
        _shoot(d, rng, cell, cell, 0, base, tip, bow, 95, 50, needle_len=(0.15, 0.27))
    # 2: 2 本の長い枝先と短い 1 本（左下）
    for base, tip, bow in [((0.5, 0.99), (0.34, 0.26), -0.05), ((0.5, 0.9), (0.72, 0.30), 0.04), ((0.5, 0.8), (0.55, 0.52), 0.0)]:
        _shoot(d, rng, cell, 0, cell, base, tip, bow, 110, 55, needle_len=nl)
    # 3: 上から見た束（右下）
    _rosette(d, rng, cell, cell, cell)
    return finish_cards(img, size, fill=0.6, sigma=2.4)


# ---------------------------------------------------------------------------
# 桜の花の房（v4）：淡い色の小さな房（4 種を 2×2 に）
# 下の中央から上へ伸びる細い小枝の節ごとに 2〜5 輪。根元寄りは花の無い節を残して小枝を見せる。
# 縁はノイズで不揃いに欠けて透ける（固い輪郭の紙のような形にしない）。色は彩度 25% 以下の淡い桃色
# ---------------------------------------------------------------------------

PETAL = np.array([[0, 0], [0.28, 0.20], [0.58, 0.37], [0.84, 0.40], [0.99, 0.24], [0.93, 0.04], [0.88, 0.0], [0.93, -0.04],
                  [0.99, -0.24], [0.84, -0.40], [0.58, -0.37], [0.28, -0.20]], np.float64)
# 暖かい色の日差しで桃色が肌色に寄らないよう、花びらは少し青みに寄せる（描くと ≈ #e6c8cf・#b78c9a）
SK_HI = np.array([238, 206, 217], np.float64)    # 手前の花びら（彩度 13%）
SK_MID = np.array([186, 141, 156], np.float64)   # 奥の花（彩度 24%）
SK_IN = np.array([200, 147, 165], np.float64)    # 花びらの付け根の少し濃い所
SK_EYE = np.array([136, 78, 92], np.float64)     # 花の中心
SK_STAMEN = np.array([224, 212, 198], np.float64)
SK_ANTHER = np.array([190, 164, 112], np.float64)
SK_CALYX = np.array([112, 66, 64], np.float64)
SK_BUD = np.array([196, 136, 152], np.float64)
SK_PED = np.array([104, 80, 72], np.float64)     # 花柄
SK_TWIG = np.array([68, 57, 53], np.float64)     # 小枝（灰色がかった暗い茶）


def _flower(d, rng, cx, cy, r, rot, squash, col, shade):
    """5 弁の花（花びらの先に切れ込み）。squash<1 で斜めから見た形。col は花びらの色"""
    ca, sa = math.cos(rot), math.sin(rot)

    def tf(x, y):
        y *= squash
        return (cx + x * ca - y * sa, cy + x * sa + y * ca)

    petals = []
    for k in range(5):
        a = k * 2 * math.pi / 5 + rng.uniform(-0.15, 0.15)
        sc = r * rng.uniform(0.88, 1.08)
        petals.append(([(math.cos(a) * px * sc - math.sin(a) * py * sc, math.sin(a) * px * sc + math.cos(a) * py * sc) for px, py in PETAL],
                       shade * rng.uniform(0.95, 1.03)))
    for pk, s in petals:
        d.polygon([tf(x, y) for x, y in pk], fill=col8(col, s))
    for pk, s in petals:
        d.polygon([tf(x * 0.38, y * 0.38) for x, y in pk], fill=col8(col + (SK_IN - col) * 0.75, s))
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        ln = r * rng.uniform(0.22, 0.36)
        x, y = tf(math.cos(a) * ln, math.sin(a) * ln)
        d.line([tf(0, 0), (x, y)], fill=col8(SK_STAMEN, shade), width=max(1, int(r * 0.035)))
        e = r * 0.045
        d.ellipse([x - e, y - e, x + e, y + e], fill=col8(SK_ANTHER, shade))
    rc = r * 0.13
    x, y = tf(0, 0)
    d.ellipse([x - rc, y - rc * max(squash, 0.5), x + rc, y + rc * max(squash, 0.5)], fill=col8(SK_EYE, shade))


def _leaf(d, rng, p, direction, length, color, shade, wr=0.26):
    dv = np.asarray(direction, np.float64)
    dv /= np.linalg.norm(dv)
    pe = np.array([-dv[1], dv[0]])
    pts = []
    for t in np.linspace(0, 1, 9):
        wdt = wr * math.sin(math.pi * t ** 0.8) * length
        pts.append(p + dv * t * length + pe * wdt)
    for t in np.linspace(1, 0, 9)[1:-1]:
        wdt = wr * math.sin(math.pi * t ** 0.8) * length
        pts.append(p + dv * t * length - pe * wdt)
    d.polygon([tuple(q) for q in pts], fill=col8(color, shade))
    d.line([tuple(p), tuple(p + dv * length * 0.9)], fill=col8(color * 0.8, shade), width=max(1, int(length * 0.03)))


def _sk_clump(dt, d, rng, cell, ox, oy, n_side, nodes, per_node, bare, buds=2):
    """1 区画の房。n_side 本の脇の小枝、主な小枝に nodes 個の節、節ごとに per_node=(最少, 最多) 輪。
    bare は根元寄りの節に花を付けない割合（小枝が見える）。小枝は dt、花は d に描く（縁を欠くのは花だけ）"""
    def P(x, y):
        return np.array([ox + x * cell, oy + y * cell])

    base = P(0.5 + rng.uniform(-0.05, 0.05), 0.995)
    tip = P(0.5 + rng.uniform(-0.2, 0.2), rng.uniform(0.08, 0.14))
    mid = (base + tip) / 2 + np.array([rng.uniform(-0.1, 0.1) * cell, 0.0])
    twigs = [(base, mid, tip, 0.0105, nodes)]
    side = 1 if rng.random() < 0.5 else -1
    for k in range(n_side):
        side = -side
        t = rng.uniform(0.3, 0.58)
        p0 = _bezier(base, mid, tip, t)
        end = P(0.5 + side * rng.uniform(0.3, 0.38), rng.uniform(0.2, 0.46))
        m2 = (p0 + end) / 2 + rng.normal(0, 0.03 * cell, 2) + np.array([0.0, 0.04 * cell])
        twigs.append((p0, m2, end, 0.0075, max(3, nodes - 2)))
    for (a, b, c, w, _) in twigs:
        ts = np.linspace(0, 1, 16)
        path = _bezier(a, b, c, ts)
        for i in range(15):
            dt.line([tuple(path[i]), tuple(path[i + 1])], fill=col8(SK_TWIG, 0.9 + 0.2 * ts[i]), width=max(3, int(cell * w * (1 - 0.55 * ts[i]))))
    items = []
    for (a, b, c, w, n) in twigs:
        for k in range(n):
            t = 0.16 + 0.84 * (k + rng.uniform(0.15, 0.85)) / n
            if rng.random() < bare * (1 - t) ** 0.7:
                continue
            node = _bezier(a, b, c, t)
            for j in range(int(rng.integers(per_node[0], per_node[1] + 1))):
                ang = rng.uniform(0, 2 * math.pi)
                fc = node + cell * rng.uniform(0.022, 0.06) * np.array([math.cos(ang), math.sin(ang)])
                items.append((rng.uniform(0, 1), node, fc))
        # 枝先の蕾と、開きかけの花
        for k in range(buds):
            ang = rng.uniform(0, 2 * math.pi)
            q = c + cell * rng.uniform(0.012, 0.03) * np.array([math.cos(ang), math.sin(ang)])
            rb = cell * rng.uniform(0.011, 0.016)
            d.line([tuple(c), tuple(q)], fill=col8(SK_PED), width=max(2, int(cell * 0.004)))
            d.ellipse([q[0] - rb, q[1] - rb * 1.3, q[0] + rb, q[1] + rb * 1.3], fill=col8(SK_BUD, rng.uniform(0.9, 1.0)))
    items.sort(key=lambda it: it[0])
    for depth, node, fc in items:
        shade = 0.9 + 0.1 * depth
        col = SK_MID + (SK_HI - SK_MID) * (0.2 + 0.8 * depth) + rng.uniform(-6, 6)
        d.line([tuple(node), tuple(fc)], fill=col8(SK_PED, shade), width=max(2, int(cell * 0.004)))
        r = cell * rng.uniform(0.036, 0.05)
        sq = rng.uniform(0.45, 1.0)
        if sq < 0.62:
            # 横から見た花：がく（暗い赤茶）を花柄の側に
            dv = (fc - node) / (np.linalg.norm(fc - node) + 1e-9)
            q = fc - dv * r * 0.3
            e = r * 0.2
            d.ellipse([q[0] - e, q[1] - e, q[0] + e, q[1] + e], fill=col8(SK_CALYX, shade))
        _flower(d, rng, fc[0], fc[1], r, rng.uniform(0, 2 * math.pi), sq, col, shade)


def _ragged(rgba, seed, cells=2):
    """房の縁をノイズで不揃いに欠く：房の中心（花の密な所）から遠いほど、ノイズの谷で透明にする"""
    al = rgba[..., 3]
    n = pnoise(al.shape, seed, 10, 40, beta=0.8)
    n = n / (np.abs(n).max() + 1e-6)
    dense = ndimage.gaussian_filter(al, al.shape[0] / cells * 0.05)
    keep = smooth(-0.1, 0.1, n * 0.5 + (dense - 0.16) * 2.6)
    out = rgba.copy()
    out[..., 3] = al * keep
    return out


def mip_coverage(al, cutoff=0.42, levels=6):
    """アルファで切り抜いたときの見える面積（縮小の段ごと、元の大きさに対する割合）。three.js の自動の縮小（2×2 の平均）を真似る"""
    base = float((al > cutoff).mean())
    out = []
    a = al.astype(np.float64)
    for lv in range(levels):
        out.append(round(float((a > cutoff).mean()) / max(base, 1e-9), 2))
        a = a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2).mean((1, 3))
    return out


def sakura_blossom(size=1024, seed=43):
    S = 4
    cell = size // 2 * S
    tw = Image.new('RGBA', (size * S, size * S), (0, 0, 0, 0))
    fl = Image.new('RGBA', (size * S, size * S), (0, 0, 0, 0))
    dt, d = ImageDraw.Draw(tw), ImageDraw.Draw(fl)
    rng = np.random.default_rng(seed)
    # 0: 密な房（左上） 1: 小枝の見える細長い房（右上） 2: 二股の房（左下） 3: 花のまばらな枝先（右下）
    _sk_clump(dt, d, rng, cell, 0, 0, 1, 12, (3, 5), 0.2)
    _sk_clump(dt, d, rng, cell, cell, 0, 1, 10, (3, 4), 0.45)
    _sk_clump(dt, d, rng, cell, 0, cell, 2, 9, (3, 5), 0.25)
    _sk_clump(dt, d, rng, cell, cell, cell, 1, 8, (2, 4), 0.55, buds=4)
    # 花の層だけ縁を欠いてから、小枝の層に重ねる
    f = _ragged(finish_cards(fl, size, fill=0.0), seed + 1)
    t = finish_cards(tw, size, fill=0.0)
    a = f[..., 3:4] + t[..., 3:4] * (1 - f[..., 3:4])
    rgb = (f[..., :3] * f[..., 3:4] + t[..., :3] * t[..., 3:4] * (1 - f[..., 3:4])) / np.maximum(a, 1e-4)
    out = np.concatenate([rgb, a], -1)
    # 透明な所へ色をにじませ、遠目で痩せないように縁のアルファを少し足す（finish_cards と同じ）
    mask = a[..., 0] < 0.08
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    out[..., :3] = np.where(mask[..., None], out[..., :3][idx[0], idx[1]], out[..., :3])
    out[..., 3] = np.maximum(out[..., 3], 0.4 * ndimage.gaussian_filter(out[..., 3], 1.6))
    print('  sakura_blossom: coverage', round(float((out[..., 3] > 0.42).mean()), 3), 'by mip level', mip_coverage(out[..., 3]))
    return out


# ---------------------------------------------------------------------------
# 低い草木（草 3 種・つつじ・しだ）
# ---------------------------------------------------------------------------

GRASS_G = np.array([92, 124, 56], np.float64)
GRASS_D = np.array([148, 138, 84], np.float64)


def _blade(d, rng, base, direction, length, width, col, shade, bend):
    dv = np.asarray(direction, np.float64)
    dv /= np.linalg.norm(dv)
    pe = np.array([-dv[1], dv[0]])
    p0 = np.asarray(base, np.float64)
    tip = p0 + dv * length + pe * bend * length
    mid = p0 + dv * length * 0.55 + pe * bend * length * 0.2
    ts = np.linspace(0, 1, 8)
    path = _bezier(p0, mid, tip, ts)
    left = []
    right = []
    for i, t in enumerate(ts):
        tan = path[min(i + 1, 7)] - path[max(i - 1, 0)]
        tan /= np.linalg.norm(tan)
        n = np.array([-tan[1], tan[0]])
        w = width * (1 - t) ** 0.8 * 0.5
        left.append(path[i] + n * w)
        right.append(path[i] - n * w)
    poly = [tuple(q) for q in left + right[::-1]]
    d.polygon(poly, fill=col8(col, shade))


def _grass(d, rng, x0, y0, w, h, n, tall, dry, heads=False):
    for k in range(n):
        bx = x0 + w * (0.5 + rng.normal(0, 0.09))
        by = y0 + h * 0.995
        ang = rng.normal(0, 0.26)
        ln = h * rng.uniform(0.35, 0.95) * tall
        col = GRASS_G * rng.uniform(0.8, 1.15) if rng.random() > dry else GRASS_D * rng.uniform(0.85, 1.1)
        _blade(d, rng, (bx, by), (math.sin(ang), -math.cos(ang)), ln, w * rng.uniform(0.018, 0.034), col, rng.uniform(0.7, 1.05),
               rng.normal(0, 0.18) + math.copysign(0.12, ang))
    if heads:
        for k in range(6):
            bx = x0 + w * (0.5 + rng.normal(0, 0.06))
            ang = rng.normal(0, 0.22)
            ln = h * rng.uniform(0.75, 0.97)
            tip = np.array([bx + math.sin(ang) * ln, y0 + h * 0.995 - math.cos(ang) * ln])
            d.line([(bx, y0 + h * 0.995), tuple(tip)], fill=col8(np.array([120, 118, 70])), width=max(2, int(w * 0.008)))
            for j in range(14):
                t = rng.uniform(0.0, 0.22)
                q = tip - np.array([math.sin(ang), -math.cos(ang)]) * ln * t
                r = w * 0.012
                d.ellipse([q[0] - r * 2, q[1] - r, q[0] + r * 2, q[1] + r], fill=col8(np.array([168, 150, 104]), rng.uniform(0.8, 1.0)))


def _broadweed(d, rng, x0, y0, w, h):
    """地面近くの広い葉の草（おおばこ風）と細い草"""
    _grass(d, rng, x0, y0, w, h, 30, 0.55, 0.3)
    for k in range(10):
        ang = rng.uniform(-1.2, 1.2)
        base = np.array([x0 + w * 0.5 + rng.normal(0, w * 0.04), y0 + h * 0.99])
        _leaf(d, rng, base, (math.sin(ang), -math.cos(ang)), h * rng.uniform(0.13, 0.22), np.array([74, 106, 48]) * rng.uniform(0.85, 1.1), rng.uniform(0.75, 1.0))


def _azalea(d, rng, x0, y0, w, h, flowers=True):
    """刈り込んだつつじの葉の塊（正面から見た）：小さな楕円の葉が密に、少しの花"""
    c = np.array([x0 + w / 2, y0 + h / 2])
    items = []
    for k in range(700):
        r = math.sqrt(rng.random()) * 0.47
        a = rng.uniform(0, 2 * math.pi)
        p = c + np.array([math.cos(a) * r * w, math.sin(a) * r * h])
        items.append((rng.uniform(0.55, 1.0) * (1.0 - 0.3 * (1 - r / 0.47)), p, rng.uniform(0, 2 * math.pi)))
    items.sort(key=lambda it: it[0])
    for shade, p, a in items:
        col = np.array([58, 86, 42]) if rng.random() > 0.15 else np.array([96, 118, 54])
        _leaf(d, rng, p, (math.cos(a), math.sin(a)), w * rng.uniform(0.045, 0.07), col, shade)
    if flowers:
        for k in range(6):
            r = math.sqrt(rng.random()) * 0.4
            a = rng.uniform(0, 2 * math.pi)
            p = c + np.array([math.cos(a) * r * w, math.sin(a) * r * h])
            rr = w * rng.uniform(0.022, 0.032)
            for j in range(5):
                aa = j * 2 * math.pi / 5 + rng.uniform(0, 0.3)
                q = p + rr * 0.55 * np.array([math.cos(aa), math.sin(aa)])
                d.ellipse([q[0] - rr * 0.6, q[1] - rr * 0.6, q[0] + rr * 0.6, q[1] + rr * 0.6], fill=col8(np.array([222, 96, 150]), rng.uniform(0.85, 1.0)))
            d.ellipse([p[0] - rr * 0.18, p[1] - rr * 0.18, p[0] + rr * 0.18, p[1] + rr * 0.18], fill=col8(np.array([160, 50, 90])))


def _fern(d, rng, x0, y0, w, h):
    """しだの葉：中軸の左右に、先へ向かって短くなる細長い羽片を並べる"""
    base = np.array([x0 + w * 0.5, y0 + h * 0.99])
    tip = np.array([x0 + w * 0.54, y0 + h * 0.03])
    mid = np.array([x0 + w * 0.44, y0 + h * 0.5])
    ts = np.linspace(0, 1, 60)
    path = _bezier(base, mid, tip, ts)
    for i in range(59):
        d.line([tuple(path[i]), tuple(path[i + 1])], fill=col8(np.array([96, 100, 56])), width=max(2, int(w * 0.010 * (1 - ts[i] * 0.7))))
    for i in range(8, 58, 3):
        t = ts[i]
        tan = path[i + 1] - path[i - 1]
        tan /= np.linalg.norm(tan)
        n = np.array([-tan[1], tan[0]])
        ln = w * 0.40 * math.sin(math.pi * min(1.0, (t - 0.1) / 0.92)) ** 0.7 + w * 0.02
        for s in (-1, 1):
            dv = n * s * 0.8 + tan * 0.6
            dv /= np.linalg.norm(dv)
            col = np.array([70, 106, 46]) * rng.uniform(0.88, 1.1)
            _leaf(d, rng, path[i], dv, ln, col, rng.uniform(0.82, 1.0), wr=0.09)


# 草の画像の区画（u0, v0, u1, v1）：UV で使う（v は画像の下から）
PLANT_CELLS = {
    'grass_a': (0.0, 0.5, 1 / 3, 1.0),
    'grass_b': (1 / 3, 0.5, 2 / 3, 1.0),
    'grass_c': (2 / 3, 0.5, 1.0, 1.0),
    'azalea': (0.0, 0.0, 0.5, 0.5),
    'fern': (0.5, 0.0, 1.0, 0.5),
}


def plants(size=1024, seed=51):
    S = 4
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    rng = np.random.default_rng(seed)

    def cell(u0, v0, u1, v1, fn):
        """区画ごとに別の画像へ描いて貼る（はみ出しは切れる）"""
        x0, x1 = int(round(u0 * W)), int(round(u1 * W))
        y0, y1 = int(round((1 - v1) * W)), int(round((1 - v0) * W))
        sub = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
        fn(ImageDraw.Draw(sub), x1 - x0, y1 - y0)
        img.paste(sub, (x0, y0))

    cell(*PLANT_CELLS['grass_a'], lambda d, w, h: _grass(d, rng, 0, 0, w, h, 120, 0.9, 0.25))
    cell(*PLANT_CELLS['grass_b'], lambda d, w, h: _grass(d, rng, 0, 0, w, h, 80, 1.0, 0.4, heads=True))
    cell(*PLANT_CELLS['grass_c'], lambda d, w, h: _broadweed(d, rng, 0, 0, w, h))
    cell(*PLANT_CELLS['azalea'], lambda d, w, h: _azalea(d, rng, 0, 0, w, h, flowers=True))
    cell(*PLANT_CELLS['fern'], lambda d, w, h: _fern(d, rng, 0, 0, w, h))
    return finish_cards(img, size, fill=0.45, sigma=1.6)


# ---------------------------------------------------------------------------

def build(force=False):
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {
        'pine_bark': lambda: pine_bark(),
        'sakura_bark': lambda: sakura_bark(),
        'pine_needles': lambda: pine_needles(),
        'sakura_blossom': lambda: sakura_blossom(),
        'plants': lambda: plants(),
    }
    for name, fn in jobs.items():
        if name.endswith('bark'):
            pa, pn = OUT / f'{name}_{ver(name)}_albedo.png', OUT / f'{name}_{ver(name)}_normal.png'
            if force or not (pa.exists() and pn.exists()):
                col, nrm = fn()
                save_rgb(pa, col)
                save_rgb(pn, nrm)
                print('wrote', pa.name, pn.name)
        else:
            p = OUT / f'{name}_{ver(name)}.png'
            if force or not p.exists():
                save_rgba(p, fn())
                print('wrote', p.name)


if __name__ == '__main__':
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    if only:
        OUT.mkdir(parents=True, exist_ok=True)
        for nm in only:
            for f in OUT.glob(f'{nm}_{ver(nm)}*.png'):
                f.unlink()
    build(force='--force' in sys.argv)
