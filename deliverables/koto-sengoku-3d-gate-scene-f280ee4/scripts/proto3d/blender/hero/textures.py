"""
主人公の布・髪・藁などの画像を numpy で作る（外の素材は使わない。乱数の種は固定）。
どれも左右・上下でつながる（繰り返して貼れる）。返り値は 0..1 の配列（行 0 が画像の上）。
色の値は「画面の sRGB」の感覚で決めて、最後に画像として保存（Blender が sRGB として扱う）。
"""
from __future__ import annotations

import math

import numpy as np


def _rng(seed):
    return np.random.default_rng(seed)


def periodic_noise(shape, scale, seed, octaves=4, persistence=0.55):
    """繰り返してつながるなめらかな乱れ（周波数空間で作る）。scale は一番大きい波の周期（画素）"""
    h, w = shape
    rng = _rng(seed)
    out = np.zeros(shape)
    amp = 1.0
    for o in range(octaves):
        per = max(2.0, scale / (2 ** o))
        ky = np.fft.fftfreq(h)[:, None] * h
        kx = np.fft.fftfreq(w)[None, :] * w
        k = np.sqrt(kx ** 2 + ky ** 2)
        k0 = max(h, w) / per
        spec = np.exp(-((k - k0) / (0.6 * k0 + 1e-9)) ** 2)
        ph = rng.uniform(0, 2 * math.pi, shape)
        f = np.real(np.fft.ifft2(spec * np.exp(1j * ph)))
        f /= (f.std() + 1e-9)
        out += amp * f
        amp *= persistence
    return out / (out.std() + 1e-9)


def normal_from_height(hgt, strength):
    """高さから法線画像（OpenGL 向き：緑が上）"""
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
    dy = (np.roll(hgt, 1, 0) - np.roll(hgt, -1, 0)) * 0.5   # 行 0 が上なので上向きの差
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def srgb(c):
    return np.asarray(c, float) / 255.0


# ---------------- 髪 ----------------
def hair(size=1024, seed=11):
    rng = _rng(seed)
    w = h = size
    x = np.arange(w)
    # 毛の列ごとの明るさ（周期的）：細かい毛から太い束まで
    ks = np.arange(1, w // 2)
    amp = ks ** -0.15 * rng.uniform(0.2, 1.0, len(ks))
    ph = rng.uniform(0, 2 * math.pi, len(ks))
    cols = np.sum(amp[:, None] * np.cos(2 * math.pi * ks[:, None] * x[None, :] / w + ph[:, None]), 0)
    cols = (cols - cols.mean()) / cols.std()
    y = np.arange(h)[:, None]
    # 毛の流れのゆらぎ：行ごとに横へずらす（周期的な波）
    shift = 2.2 * np.sin(2 * math.pi * (y / h * 2 + x[None, :] / w * 3)) + 0.9 * np.sin(2 * math.pi * (y / h * 5 + x[None, :] / w * 7 + 0.3))
    xs = (x[None, :] + shift) % w
    i0 = np.floor(xs).astype(int)
    t = xs - i0
    val = cols[i0] * (1 - t) + cols[(i0 + 1) % w] * t
    val = val + 0.12 * periodic_noise((h, w), 180, seed + 1, 2)
    hi = np.clip(val * 0.5 + 0.5, 0, 1)
    dark = srgb((13, 11, 10))
    light = srgb((52, 43, 37))
    col = dark[None, None, :] * (1 - hi[..., None] ** 2.2) + light[None, None, :] * hi[..., None] ** 2.2
    nrm = normal_from_height(val, 0.9)
    return col, nrm


def brow_card(w=256, h=64, seed=5):
    """眉（上から見た毛の向きのある帯）の透ける画像（RGBA）"""
    rng = _rng(seed)
    img = np.zeros((h, w, 4))
    col = srgb((24, 19, 16))
    img[..., :3] = col
    yy, xx = np.mgrid[0:h, 0:w]
    a = np.zeros((h, w))
    for _ in range(420):
        x0 = rng.uniform(0, w)
        y0 = rng.uniform(h * 0.25, h * 0.85)
        L = rng.uniform(8, 20)
        ang = math.radians(rng.uniform(-35, -15)) if x0 > w * 0.25 else math.radians(rng.uniform(-80, -50))
        for tt in np.linspace(0, 1, 12):
            px = int(x0 + math.cos(ang) * L * tt)
            py = int(y0 + math.sin(ang) * L * tt)
            if 0 <= px < w and 0 <= py < h:
                a[py, px] = max(a[py, px], 0.9 - 0.3 * tt)
    # 帯の形（内側が太く、外へ細く）
    u = xx / w
    band = np.exp(-(((yy / h) - 0.55) / (0.30 - 0.12 * u)) ** 4)
    fade = np.clip(u / 0.08, 0, 1) * np.clip((1 - u) / 0.15, 0, 1)
    a = np.clip(a * 1.3, 0, 1) * band * fade
    k = np.array([0.25, 0.5, 0.25])
    for axis in (0, 1):
        a = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), axis, a)
    img[..., 3] = np.clip(a * 1.6, 0, 1)
    return img


def strand_card(w=64, h=256, seed=9):
    """前に落ちる数本の髪（透ける）"""
    rng = _rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = srgb((26, 21, 18))
    a = np.zeros((h, w))
    for _ in range(26):
        x0 = rng.uniform(w * 0.2, w * 0.8)
        amp = rng.uniform(2, 7)
        ph = rng.uniform(0, 6.28)
        L = rng.uniform(0.6, 1.0)
        for py in range(int(h * L)):
            px = int(x0 + amp * math.sin(py / h * 3 + ph) + (py / h) ** 2 * rng.uniform(-1, 1) * 0)
            if 0 <= px < w:
                a[py, px] = max(a[py, px], 0.95 * (1 - py / (h * L)) ** 0.4)
    k = np.array([0.2, 0.6, 0.2])
    a = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, a)
    img[..., 3] = np.clip(a * 1.4, 0, 1)
    return img


# ---------------- 布 ----------------
def _weave(size, period, seed, slub_amount=1.0, slub_len=(20, 90), twill=False):
    """平織り（または綾織り）の高さと、糸ごとの明るさのむら。糸 1 本 = period 画素"""
    rng = _rng(seed)
    n = size
    y, x = np.mgrid[0:n, 0:n]
    nt = n // period
    # 経糸（縦）・緯糸（横）の番号と、糸の中の位置
    wi = x // period
    hi = y // period
    fx = (x % period) / period
    fy = (y % period) / period
    prof_x = np.sin(fx * math.pi)            # 経糸の丸み
    prof_y = np.sin(fy * math.pi)
    if twill:
        over = ((wi + hi) % 4) < 2
    else:
        over = ((wi + hi) % 2) == 0
    height = np.where(over, prof_x * (0.6 + 0.4 * np.sin(fy * math.pi)), prof_y * (0.6 + 0.4 * np.sin(fx * math.pi)))
    # 糸ごとの太さ・色のむら（節）
    warp_tone = np.zeros((n, nt))
    weft_tone = np.zeros((nt, n))
    for j in range(nt):
        base = rng.normal(0, 0.35)
        line = np.full(n, base)
        for _ in range(int(rng.poisson(1.6 * slub_amount))):
            c = rng.integers(0, n)
            L = rng.integers(*slub_len)
            idx = (np.arange(c - L // 2, c + L // 2)) % n
            line[idx] += rng.uniform(0.6, 1.6) * np.sin(np.linspace(0, math.pi, len(idx)))
        warp_tone[:, j] = line
        base = rng.normal(0, 0.35)
        line = np.full(n, base)
        for _ in range(int(rng.poisson(1.6 * slub_amount))):
            c = rng.integers(0, n)
            L = rng.integers(*slub_len)
            idx = (np.arange(c - L // 2, c + L // 2)) % n
            line[idx] += rng.uniform(0.6, 1.6) * np.sin(np.linspace(0, math.pi, len(idx)))
        weft_tone[j, :] = line
    tone = np.where(over, warp_tone[y, wi], weft_tone[hi, x])
    return height, tone, over


def _blur(a, r=1):
    """周期的な小さなぼかし（箱を 2 回）"""
    for _ in range(2):
        acc = np.zeros_like(a)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                acc += np.roll(np.roll(a, dy, 0), dx, 1)
        a = acc / (2 * r + 1) ** 2
    return a


def indigo(size=1024, seed=21):
    """小袖：藍の麻（灰みの藍）。ゲームの日陰でもしわと布目が読めるよう、基の色は少し明るく彩度を抑える
    sRGB (62,66,86)（ゲームの ACES の暗部で青が強く出すぎないよう灰みに）。節の筋 ±12%（主に縦糸、明るい糸は +17% まで）と、大きな濃淡のむら ±3.5%。織りの凹凸は法線に"""
    height, tone, over = _weave(size, 4, seed, slub_amount=2.6, slub_len=(30, 220))
    low = periodic_noise((size, size), 400, seed + 3, 3)
    mid = periodic_noise((size, size), 60, seed + 4, 2)
    base = srgb((62, 66, 86))
    tone = np.where(over, tone, tone * 0.45)       # 節の筋は主に縦糸（格子に見えないように）
    v = 1.0 + 0.12 * np.clip(tone / 1.2, -1, 1.4) + 0.035 * low + 0.015 * mid + 0.04 * (height - 0.5)
    v = np.clip(v, 0.80, 1.22)
    col = base[None, None, :] * v[..., None]
    nrm = normal_from_height(height * 1.0 + 0.15 * tone, 1.2)
    return np.clip(col, 0, 1), nrm


def hakama(size=1024, seed=31):
    """袴：焦げ茶（彩度を抑えた灰みの茶。暖かい日差しと ACES で橙に寄らないように）の地に、控えめな格子（線は地より 8〜10% 明るいだけ、色は抜く、幅 3.5mm、少しぼかす）。
    UV の 1 = 0.36m、画像 1 枚に 4 × 4 の升（9cm）。低い差の節の筋"""
    height, tone, over = _weave(size, 4, seed, slub_amount=0.9, slub_len=(20, 90), twill=True)
    y, x = np.mgrid[0:size, 0:size]
    base = srgb((66, 55, 48))
    low = periodic_noise((size, size), 300, seed + 5, 3)
    v = 1.0 + 0.045 * np.clip(tone / 1.2, -1, 1) + 0.03 * low + 0.03 * (height - 0.5)
    col = base[None, None, :] * v[..., None]
    wob = 1.5 * np.sin(2 * math.pi * y / size * 3)
    cell = size / 4
    wline = 10.0                                    # 3.5mm
    lat = np.zeros((size, size))
    for k in range(4):
        d = np.abs(((x + wob - k * cell - cell / 2 + size / 2) % size) - size / 2)
        lat = np.maximum(lat, np.clip((wline / 2 + 1 - d) / 2, 0, 1))
        d = np.abs(((y - k * cell - cell / 2 + size / 2) % size) - size / 2)
        lat = np.maximum(lat, np.clip((wline / 2 + 1 - d) / 2, 0, 1) * 0.85)
    lat = _blur(lat, 2) * (0.8 + 0.2 * np.clip(tone + 0.5, 0, 1))
    grey = base.mean()
    line = base * 0.5 + grey * 0.5                   # 色を抜いた線
    col = col * (1 - lat[..., None]) + (line[None, None, :] * 1.09 * v[..., None]) * lat[..., None]
    nrm = normal_from_height(height * 0.9, 1.0)
    return np.clip(col, 0, 1), nrm


def obi(size=512, seed=41):
    """角帯：温かい中くらいの茶色の、畝のある厚い織り（縦が帯の幅方向）。縁の近くに少し濃い線"""
    y, x = np.mgrid[0:size, 0:size]
    rib = np.sin(2 * math.pi * y / 5.0) * 0.5 + 0.5
    grain = periodic_noise((size, size), 30, seed, 2)
    low = periodic_noise((size, size), 200, seed + 1, 2)
    base = srgb((106, 86, 68))
    col = base[None, None, :] * (0.90 + 0.07 * rib[..., None] + 0.03 * grain[..., None] + 0.04 * low[..., None])
    v = y / size
    stripe = (np.abs(v - 0.10) < 0.012) | (np.abs(v - 0.90) < 0.012)
    col[stripe] *= 0.78
    nrm = normal_from_height(rib * 0.8 + grain * 0.1, 1.0)
    return np.clip(col, 0, 1), nrm


def wisp_card(w=64, h=128, seed=19):
    """うなじの短い毛（透ける）。上（V=1）が根元で、下へ細く薄くなる。まばらに"""
    rng = _rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = srgb((24, 20, 17))
    a = np.zeros((h, w))
    for _ in range(16):
        x0 = rng.uniform(w * 0.08, w * 0.92)
        L = rng.uniform(0.35, 0.95)
        bend = rng.uniform(-5, 5)
        for py in range(int(h * L)):
            t = py / h
            px = int(round(x0 + bend * t * t))
            if 0 <= px < w:
                a[py, px] = max(a[py, px], 0.9 * (1 - t / L) ** 0.9)
    k = np.array([0.25, 0.5, 0.25])
    a = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, a)
    root = np.clip(1 - np.arange(h) / (h * 0.10), 0, 1)[:, None] * 0.7
    img[..., 3] = np.clip(np.maximum(a * 1.4, root), 0, 1)
    return img


def linen(size=512, seed=51, color=(212, 206, 190)):
    height, tone, over = _weave(size, 4, seed, slub_amount=0.7, slub_len=(10, 40))
    base = srgb(color)
    col = base[None, None, :] * (0.93 + 0.05 * tone[..., None] + 0.05 * height[..., None])
    nrm = normal_from_height(height, 0.8)
    return np.clip(col, 0, 1), nrm


def straw(size=512, seed=61):
    """草履の表：編んだ藁（横の段ごとに向きの変わる斜めの目）"""
    rng = _rng(seed)
    y, x = np.mgrid[0:size, 0:size]
    row = 16
    r = y // row
    fy = (y % row) / row
    dirn = np.where(r % 2 == 0, 1, -1)
    phase = (x + dirn * fy * row * 1.0) / 8.0
    strand = np.abs(np.sin(math.pi * phase))
    edge = np.sin(math.pi * fy)
    height = strand * 0.6 * edge + edge * 0.4
    tone = periodic_noise((size, size), 40, seed, 2)
    base = srgb((178, 148, 98))
    dark = srgb((112, 86, 52))
    t = np.clip(height * 0.8 + 0.1 * tone, 0, 1)
    col = dark[None, None, :] * (1 - t[..., None]) + base[None, None, :] * t[..., None]
    nrm = normal_from_height(height, 2.5)
    return np.clip(col, 0, 1), nrm


def tsuka(size=512, seed=71):
    """柄巻き：黒い組紐の菱巻きと、間からのぞく白い鮫皮。U が周り（2 菱）、V が長さ"""
    y, x = np.mgrid[0:size, 0:size]
    u = x / size * 2.0
    v = y / size * 4.0
    a = (u + v) % 1.0
    b = (u - v) % 1.0
    band_a = np.abs(a - 0.5) > 0.13
    band_b = np.abs(b - 0.5) > 0.13
    cord = band_a | band_b
    # 紐の重なり（上下）
    over = np.where(band_a & band_b, ((np.floor(u + v) + np.floor(u - v)) % 2) == 0, band_a)
    ridge = np.where(cord, 0.6 + 0.4 * np.cos(2 * math.pi * np.where(over, a, b) * 6), 0.0)
    same = periodic_noise((size, size), 6, seed, 1) * 0.5 + 0.5
    silk = srgb((22, 20, 24))
    samegawa = srgb((214, 206, 186))
    col = np.where(cord[..., None], silk[None, None, :] * (0.8 + 0.5 * ridge[..., None]), samegawa[None, None, :] * (0.85 + 0.15 * same[..., None]))
    height = np.where(cord, 0.6 + 0.4 * ridge, 0.1 + 0.15 * same)
    nrm = normal_from_height(height, 3.0)
    return np.clip(col, 0, 1), nrm
