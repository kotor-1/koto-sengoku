#!/usr/bin/env python3
"""
生成イラスト素材（Version 22〜）の受け取り・検査・加工（ゲーム用の WebP を作る）・確かめ。

    python3 -I proto3d/tools/art-build.py ingest   [--id ID ...] [--replace]
    python3 -I proto3d/tools/art-build.py build    [--id ID ...] [--prune]
    python3 -I proto3d/tools/art-build.py check    [--strict]
    python3 -I proto3d/tools/art-build.py docs
    python3 -I proto3d/tools/art-build.py set-face-rect face.ieyasu X Y W H
    python3 -I proto3d/tools/art-build.py set-anchor portrait.ieyasu eyeY 310
    python3 -I proto3d/tools/art-build.py approve portrait.ieyasu "会話 1280x720・844x390 で確認"
    python3 -I proto3d/tools/art-build.py selftest

- 正本の記録：proto3d/assets-src/art-v22/manifest.json（素材ごとの作り方・原画・加工版・利用条件）。
- ingest：incoming/ の PNG の透明の検査をし（人物画・手前の幕は本物の透明が要る。市松模様の描き込みは、透明の画像の中の物も
  受け取らない。単色マゼンタの背景だけは色を抜く。構図・下端の切れ目は注意として記録する）、通った物を受け取ったままの中身で
  <id>/original.png へ移し（incoming/ には README.md だけが残る）、寸法・容量・sha256・メタデータを記録する。
- build：作り方（recipe）どおりに、同じ入力からは同じ出力になるように加工し、proto3d/public/art/ に WebP を書き、
  proto3d/src/art/manifest.gen.json（ゲームが読む一覧）と正本の outputs、docs/art-assets.md を書き直す。
- check：加工版が一覧どおりか（ある・sha256・上限・合計）。--strict は利用条件の確認と見た目の確認も求める（公開の前）。
- selftest：合成した入力（本物の透明・描き込みの市松・単色マゼンタ・継ぎ目と明暗のむらのある地面）で、受け取る・断る・色を抜く・直すを確かめる。

使える道具は Pillow と numpy だけ（cv2・rembg は無い）。顔や風景を手続きで描いて素材の代わりにすることはしない。
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
KINDS = ('portrait', 'face', 'background', 'overlay', 'texture')
GEN_KEYS = ('file', 'w', 'h', 'kind', 'bytes', 'sha256', 'meta')
PNG_SIG = b'\x89PNG\r\n\x1a\n'


class ArtError(Exception):
    """加工・検査で止める理由（人が読む文）"""


class Ctx:
    """リポジトリの中の置き場所（selftest では一時フォルダに同じ形を作る）"""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.src = self.root / 'proto3d/assets-src/art-v22'
        self.master = self.src / 'manifest.json'
        self.incoming = self.src / 'incoming'
        self.public = self.root / 'proto3d/public'
        self.gen = self.root / 'proto3d/src/art/manifest.gen.json'
        self.docs = self.root / 'docs/art-assets.md'

    def rel(self, p: Path) -> str:
        return Path(p).resolve().relative_to(self.root.resolve()).as_posix()


# ---------------------------------------------------------------- 正本の読み書き

def load_master(ctx: Ctx) -> dict:
    return json.loads(ctx.master.read_text(encoding='utf-8'))


def dump_json(obj, indent=2) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=indent) + '\n'


def write_text_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return True


def save_master(ctx: Ctx, m: dict) -> None:
    write_text_if_changed(ctx.master, dump_json(m))


def asset_by_id(m: dict, aid: str) -> dict:
    for a in m['assets']:
        if a['id'] == aid:
            return a
    raise ArtError(f'正本に {aid} が無い')


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def original_path(ctx: Ctx, a: dict) -> Path | None:
    o = a.get('original')
    return ctx.root / o['path'] if o else None


# ---------------------------------------------------------------- メタデータ（PNG の塊）

def png_chunks(data: bytes) -> list[tuple[str, bytes]] | None:
    if data[:8] != PNG_SIG:
        return None
    out, pos = [], 8
    while pos + 8 <= len(data):
        n = int.from_bytes(data[pos:pos + 4], 'big')
        typ = data[pos + 4:pos + 8].decode('latin-1')
        out.append((typ, data[pos + 8:pos + 8 + n]))
        pos += 12 + n
        if typ == 'IEND':
            break
    return out


def inspect_metadata(data: bytes, fmt: str) -> dict:
    """メタデータは「何があるか」だけを記録する（中身は個人の情報を含みうるので正本に書かない。画面には出す）"""
    chunks = png_chunks(data)
    if chunks is None:
        return {'format': fmt, 'chunks': None, 'text': [], 'c2pa': None, 'exif': None, 'icc': None,
                'note': 'PNG ではないので塊の検査はしていない'}
    counts: dict[str, int] = {}
    text, details = [], []
    c2pa = False
    for typ, body in chunks:
        counts[typ] = counts.get(typ, 0) + 1
        if typ in ('tEXt', 'zTXt', 'iTXt'):
            key = body.split(b'\0', 1)[0].decode('latin-1', 'replace')
            text.append({'chunk': typ, 'key': key, 'bytes': len(body)})
            val = body.split(b'\0', 1)[1] if b'\0' in body else b''
            if typ == 'zTXt' and val:
                try:
                    val = zlib.decompress(val[1:])
                except zlib.error:
                    val = b'(zlib error)'
            details.append(f'{typ} {key}: {val[:160]!r}')
        if typ == 'caBX':
            c2pa = True
    icc = None
    for typ, body in chunks:
        if typ == 'iCCP':
            icc = {'name': body.split(b'\0', 1)[0].decode('latin-1', 'replace'), 'bytes': len(body)}
    notes = []
    if c2pa:
        notes.append('C2PA の来歴情報（caBX）がある。中身は検証していない。原画には残り、加工版（WebP）には入れない')
    if text:
        notes.append('文字の塊がある（鍵の名前だけ記録。値は ingest の画面に出す）')
    if icc:
        notes.append('色の profile（iCCP）がある。加工版には入れない（sRGB として扱う）')
    return {
        'format': fmt,
        'chunks': counts,
        'text': text,
        'c2pa': c2pa,
        'exif': 'eXIf' in counts,
        'icc': icc,
        'note': '。'.join(notes) if notes else 'メタデータの塊は無い',
        '_details': details,
    }


# ---------------------------------------------------------------- 透明・市松模様・マゼンタの検査

def region_mask(h: int, w: int, boxes) -> np.ndarray:
    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in boxes:
        m[int(round(y0 * h)):int(round(y1 * h)), int(round(x0 * w)):int(round(x1 * w))] = True
    return m


def otsu(vals: np.ndarray) -> float:
    hist = np.bincount(np.clip(vals, 0, 255).astype(np.int64), minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 128.0
    omega = np.cumsum(hist) / total
    mu = np.cumsum(hist * np.arange(256)) / total
    mu_t = mu[-1]
    with np.errstate(divide='ignore', invalid='ignore'):
        sb = (mu_t * omega - mu) ** 2 / (omega * (1 - omega))
    sb = np.nan_to_num(sb)
    return float(np.argmax(sb)) + 0.5


def detect_checkerboard(rgb: np.ndarray, mask: np.ndarray) -> dict:
    """透明の代わりに描き込まれた市松模様（明るい灰色と白の 8〜32px の四角の交互）を、外側の領域で探す"""
    f = rgb.astype(np.int16)
    lum = f.mean(axis=2)
    sat = f.max(axis=2) - f.min(axis=2)
    cand = mask & (sat <= 18) & (lum >= 150)
    share = float(cand.sum()) / max(1, int(mask.sum()))
    res = {'found': False, 'share': round(share, 3), 'square': None, 'score': 0.0}
    if share < 0.6:
        return res
    vals = lum[cand]
    thr = otsu(vals)
    lo, hi = vals[vals < thr], vals[vals >= thr]
    if len(lo) < 0.15 * len(vals) or len(hi) < 0.15 * len(vals) or hi.mean() - lo.mean() < 6:
        return res  # 一色の明るい背景（模様ではない）
    b = lum >= thr
    best = (0.0, None)
    for s in range(6, 41):
        mx = cand[:, :-s] & cand[:, s:]
        my = cand[:-s, :] & cand[s:, :]
        md = cand[:-s, :-s] & cand[s:, s:]
        if mx.sum() < 500 or my.sum() < 500 or md.sum() < 500:
            continue
        dx = float((b[:, :-s] != b[:, s:])[mx].mean())
        dy = float((b[:-s, :] != b[s:, :])[my].mean())
        same = float((b[:-s, :-s] == b[s:, s:])[md].mean())
        score = min(dx, dy, same)
        if score > best[0]:
            best = (score, s)
    res['score'] = round(best[0], 3)
    res['square'] = best[1]
    res['levels'] = [round(float(lo.mean()), 1), round(float(hi.mean()), 1)]
    res['found'] = bool(best[0] >= 0.7 and best[1] is not None and 7 <= best[1] <= 36)
    return res


CHECKER_MIN_PX = 1500  # 画像全体で探す市松模様の、最低の画素の数（1024×1536 で約 0.1%。alphaCheck.checkerMinPx で変えられる）


def checker_min_px(check: dict, h: int, w: int) -> int:
    v = check.get('checkerMinPx')
    if v:
        return int(v)
    return max(CHECKER_MIN_PX // 2, int(round(CHECKER_MIN_PX * (h * w) / (1024 * 1536))))


def find_checker_patches(rgba: np.ndarray, min_px: int) -> dict:
    """透明の画像の不透明の所（背景を切り抜き損ねた所・腕と胴の間など）に描き込まれた市松模様を、画像全体で探す。
    明るい灰色・白の不透明の画素で、四角の大きさ s（6〜40px）だけ横・縦にずらすと必ずもう一方の明るさになり、
    斜めに s・横縦に 2s ずらすと同じ明るさに戻る画素を数え、min_px 個以上なら市松模様とみる（割合ではなく画素の数で判断）。
    さらに、その画素が四角 1 つ分の範囲に半分以上詰まっている所だけを数える（ばらばらの偶然の一致は数えない）。
    明るい方の色は白に近い（明るさ 225 以上）。自然な模様・白い衣・一色の明るい所は、この規則正しさを満たさない"""
    a = rgba[..., 3]
    f = rgba[..., :3].astype(np.int16)
    L3 = f.sum(axis=2)  # 明るさ ×3（0〜765）
    sat = f.max(axis=2) - f.min(axis=2)
    cand = (a >= 250) & (sat <= 18) & (L3 >= 450)
    n = int(cand.sum())
    res = {'found': False, 'candidatePx': n, 'evidencePx': 0, 'square': None, 'box': None, 'minPx': int(min_px)}
    if n < min_px:
        return res
    ys, xs = np.nonzero(cand)
    oy, ox = int(ys.min()), int(xs.min())
    L = np.where(cand, L3, -1000)[oy:int(ys.max()) + 1, ox:int(xs.max()) + 1]
    H, W = L.shape
    best = (0, None, None)
    for sq in range(6, 41):
        if H <= 2 * sq or W <= 2 * sq:
            break
        h, w = H - 2 * sq, W - 2 * sq
        p = L[:h, :w]
        px, py = L[:h, sq:sq + w], L[sq:sq + h, :w]
        pd, p2x, p2y = L[sq:sq + h, sq:sq + w], L[:h, 2 * sq:2 * sq + w], L[2 * sq:2 * sq + h, :w]
        ok = (p >= 0) & (px >= 0) & (py >= 0) & (pd >= 0) & (p2x >= 0) & (p2y >= 0)
        dx, dy = px - p, py - p
        tol = np.maximum(12, np.abs(dx) // 4)
        ev = (ok & (np.abs(dx) >= 24) & ((dx > 0) == (dy > 0)) & (np.abs(dx - dy) <= tol) & (np.maximum(p, px) >= 675)
              & (np.abs(pd - p) <= tol) & (np.abs(p2x - p) <= tol) & (np.abs(p2y - p) <= tol))
        if int(ev.sum()) < min_px:
            continue
        ev = ev & (box_mean(ev.astype(np.float64), sq) >= 0.5)
        c = int(ev.sum())
        if c > best[0]:
            best = (c, sq, ev)
    res['evidencePx'] = best[0]
    res['square'] = best[1]
    if best[2] is not None and best[0] >= min_px:
        ey, ex = np.nonzero(best[2])
        sq = best[1]
        res['box'] = [ox + int(ex.min()), oy + int(ey.min()), ox + int(ex.max()) + 1 + 2 * sq, oy + int(ey.max()) + 1 + 2 * sq]
        res['found'] = True
    return res


def detect_magenta(rgb: np.ndarray, mask: np.ndarray, key: dict, min_overall: float | None = None) -> dict:
    """単色マゼンタの背景か。外側の確かめの範囲（mask）の minShare 以上がマゼンタ、または（人物が端まで広がる構図）
    画像全体の min_overall 以上がマゼンタで、外側の範囲の半分以上がマゼンタ。影やグラデーションのある背景は抜かない"""
    f = rgb.astype(np.int16)
    kr, kg, kb = key['color']
    tol = key['tolerance']
    near = (np.abs(f[..., 0] - kr) <= tol) & (np.abs(f[..., 1] - kg) <= tol) & (np.abs(f[..., 2] - kb) <= tol)
    share = float(near[mask].mean()) if mask.any() else 0.0
    overall = float(near.mean())
    res = {'found': False, 'share': round(share, 3), 'overallShare': round(overall, 3), 'key': None, 'std': None}
    wide = min_overall is not None and overall >= min_overall and share >= 0.5
    if share < key['minShare'] and not wide:
        return res
    px = rgb[mask & near].astype(np.float64)
    med = np.median(px, axis=0)
    std = px.std(axis=0)
    res['key'] = [int(round(v)) for v in med]
    res['std'] = [round(float(v), 2) for v in std]
    res['found'] = bool(std.max() <= 16)  # 影やグラデーションのある背景は抜かない
    return res


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:, :] |= out[:-1, :]
        m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        out = m
    return out


def box_mean(a: np.ndarray, r: int) -> np.ndarray:
    k = 2 * r + 1
    p = np.pad(a, r, mode='edge')
    c = np.zeros((p.shape[0] + 1, p.shape[1] + 1))
    c[1:, 1:] = p.cumsum(0).cumsum(1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def chroma_key(rgb: np.ndarray, key_rgb, cfg: dict) -> tuple[np.ndarray, dict]:
    """単色マゼンタの背景を抜く。
    1. マゼンタの量（min(R,B)−G）で、はっきり前景・はっきり背景・境目に分ける。
    2. 境目の帯だけ、近くの前景のマゼンタの量（局所の平均）との間で線形に混ざっているとみて透明さを決める（縁がなめらか）。
    3. 色を前景の色へ戻し（背景の色を差し引く）、縁の帯に残るマゼンタの色かぶりを取る。"""
    f = rgb.astype(np.float64)
    K = np.array(key_rgb, np.float64)

    def spill(c):
        return np.minimum(c[..., 0], c[..., 2]) - c[..., 1]

    mk = float(min(K[0], K[2]) - K[1])
    if mk < 64:
        raise ArtError(f'抜く色 {list(key_rgb)} がマゼンタらしくない')
    m = spill(f)
    t0, t1 = cfg['fgMax'] * mk, cfg['bgMin'] * mk
    a0 = 1.0 - np.clip((m - t0) / (t1 - t0), 0.0, 1.0)
    fg, bg = a0 >= 1.0, a0 <= 0.0
    trans = (~fg & ~bg) | (dilate(bg, 1) & fg) | (dilate(fg, 1) & bg)
    band = dilate(trans, 2)
    r = int(cfg.get('localPx', 6))
    num = box_mean(np.where(fg, m, 0.0), r)
    den = box_mean(fg.astype(np.float64), r)
    m_fg = np.minimum(np.where(den > 0.02, num / np.maximum(den, 1e-9), t0), t0)
    a_loc = np.clip((mk - m) / np.maximum(mk - m_fg, 1.0), 0.0, 1.0)
    a_loc = np.where(m >= t1, 0.0, a_loc)
    a_loc = np.where(a_loc > 0.98, 1.0, np.where(a_loc < 0.02, 0.0, a_loc))
    a = np.where(band, a_loc, a0)
    a8 = np.round(a * 255).astype(np.uint8)
    a = a8.astype(np.float64) / 255.0
    ae = np.maximum(a, 1e-3)[..., None]
    F = np.clip((f - (1.0 - a)[..., None] * K) / ae, 0, 255)
    edge = dilate(a8 < 255, int(cfg.get('despillBandPx', 3))) & (a8 > 0)
    s = np.maximum(0.0, np.minimum(F[..., 0], F[..., 2]) - F[..., 1])
    F[..., 0] -= s * edge
    F[..., 2] -= s * edge
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.round(np.clip(F, 0, 255)).astype(np.uint8)
    out[..., 3] = a8
    out[a8 == 0, :3] = 0
    rep = {
        'key': [int(v) for v in key_rgb],
        'fgMax': cfg['fgMax'], 'bgMin': cfg['bgMin'], 'despillBandPx': cfg.get('despillBandPx', 3), 'localPx': r,
        'transparentShare': round(float((a8 == 0).mean()), 4),
        'partialShare': round(float(((a8 > 0) & (a8 < 255)).mean()), 4),
    }
    return out, rep


def alpha_stats(a: np.ndarray, check: dict) -> dict:
    tmax = check.get('transparentMax', 8)
    h, w = a.shape
    reg = region_mask(h, w, check['regions'])
    clear = a <= tmax
    return {
        'transparentShare': round(float(clear.mean()), 4),
        'zeroShare': round(float((a == 0).mean()), 4),
        'opaqueShare': round(float((a == 255).mean()), 4),
        'regionTransparentShare': round(float(clear[reg].mean()), 4) if reg.any() else None,
    }


def to_array(img: Image.Image) -> tuple[np.ndarray, bool]:
    """(RGBA の配列, 透明の情報を持っていたか)"""
    has = img.mode in ('RGBA', 'LA', 'PA', 'RGBa', 'La') or 'transparency' in img.info
    return np.asarray(img.convert('RGBA')).copy(), has


def _refuse(rep: dict, reason: str, message: str):
    rep['decision'] = 'refuse'
    rep['reason'] = reason
    rep['message'] = message
    return 'refuse', rep, None


def _checker_message(cb: dict, inside: bool) -> str:
    where = f'（範囲 x {cb["box"][0]}〜{cb["box"][2]}・y {cb["box"][1]}〜{cb["box"][3]}）' if cb.get('box') else ''
    head = '透明の部分はあるが、不透明の所に' if inside else '透明ではなく、'
    return (f'{head}灰色と白の市松模様（四角 約 {cb["square"]}px）が描き込まれている{where}。透明の素材として使えない。'
            '本物の透明の PNG か、単色マゼンタ（#FF00FF）の背景で作り直しを依頼する')


def _judge_transparency(decision: str, rep: dict, st: dict, check: dict, rgba: np.ndarray, failed_reason: str):
    """透明の量の判断。全体の透明（transparentMax 以下）が minTransparentShare 未満なら断る（意味のある透明が無い）。
    外側の確かめの範囲（regions）の透明が regionMinShare 未満でも、全体がはっきり透明なら断らず、構図の注意として記録する。
    透明ではない所が 1 画素も無い（人物・柱が写っていない）物は断る"""
    if not (rgba[..., 3] > check.get('transparentMax', 8)).any():
        return _refuse(rep, 'empty', f'全部透明（不透明度 {check.get("transparentMax", 8)} を超える所が無い）。人物・柱が写っていない。作り直しを依頼する')
    if st['transparentShare'] < check['minTransparentShare']:
        what = 'マゼンタの背景を抜いても、' if failed_reason == 'magenta-key-failed' else '透明の部分はあるが少なすぎる。'
        return _refuse(rep, failed_reason,
                       f'{what}全体の透明（不透明度 {check.get("transparentMax", 8)} 以下）が {st["transparentShare"]:.0%}（必要 {check["minTransparentShare"]:.0%}）。'
                       '背景が透明になっていない。作り直しを依頼する')
    warnings = []
    reg_share = st['regionTransparentShare'] or 0
    refuse_below = check.get('regionRefuseShare', 0.5)
    if reg_share < refuse_below:
        # 外側の帯の半分以上が不透明：袖がかかる程度ではなく、背景が残っている（切り抜きの失敗）
        return _refuse(rep, 'background-left',
                       f'外側の確かめの範囲（alphaCheck.regions）の透明が {reg_share:.0%}（{refuse_below:.0%} 未満）。'
                       '背景が抜けきらずに残っている。本物の透明の PNG か、単色マゼンタの背景で作り直しを依頼する')
    if reg_share < check['regionMinShare']:
        warnings.append({
            'reason': 'composition',
            'message': (f'外側の確かめの範囲（alphaCheck.regions）の透明が {reg_share:.0%}（目安 {check["regionMinShare"]:.0%}）。'
                        f'全体は {st["transparentShare"]:.0%} が透明なので受け取るが、人物（柱・幕）が端まで広がる構図。画面で切れ方と重なりを確かめる'),
        })
    rep['decision'] = decision
    rep['warnings'] = warnings
    return decision, rep, rgba


def classify_alpha(img: Image.Image, recipe: dict) -> tuple[str, dict, np.ndarray | None]:
    """人物画・手前の幕の透明の検査。戻り値：('alpha'|'magenta-key'|'refuse', 記録, RGBA の配列)。
    記録の warnings（構図の注意など）は断る理由ではない（ingest が表示して原画の記録に残す）"""
    rgba, has = to_array(img)
    check = recipe['alphaCheck']
    h, w = rgba.shape[:2]
    reg = region_mask(h, w, check['regions'])
    st = alpha_stats(rgba[..., 3], check)
    rep = {'hasAlphaChannel': has, **st}
    min_px = checker_min_px(check, h, w)
    if has and st['transparentShare'] > 0.01:
        # 本物の透明がある：不透明の所に市松模様が描き込まれていないか（画像全体）→ 透明の量
        cbp = find_checker_patches(rgba, min_px)
        rep['checkerboardPatch'] = cbp
        if cbp['found']:
            return _refuse(rep, 'checkerboard', _checker_message(cbp, True))
        return _judge_transparency('alpha', rep, st, check, rgba, 'alpha-insufficient')
    rgb = rgba[..., :3]
    cb = detect_checkerboard(rgb, reg)
    rep['checkerboard'] = cb
    if cb['found']:
        return _refuse(rep, 'checkerboard', _checker_message(cb, False))
    mg = detect_magenta(rgb, reg, recipe['key'], check['minTransparentShare'])
    rep['magenta'] = mg
    if mg['found']:
        keyed, krep = chroma_key(rgb, mg['key'], recipe['key'])
        st2 = alpha_stats(keyed[..., 3], check)
        rep['keyed'] = {**krep, **st2}
        cbp = find_checker_patches(keyed, min_px)
        rep['checkerboardPatch'] = cbp
        if cbp['found']:
            return _refuse(rep, 'checkerboard', _checker_message(cbp, True))
        return _judge_transparency('magenta-key', rep, st2, check, keyed, 'magenta-key-failed')
    # 透明が無い：断る。外側の帯ではなく中に市松模様があれば、理由をはっきり書く
    cbp = find_checker_patches(rgba, min_px)
    rep['checkerboardPatch'] = cbp
    if cbp['found']:
        return _refuse(rep, 'checkerboard', _checker_message(cbp, False))
    return _refuse(rep, 'no-alpha', '透明が無く、背景も単色マゼンタではない（背景を自動で切り抜く道具はこの環境に無く、推測で切り抜かない）。'
                                    '本物の透明の PNG か、単色マゼンタの背景で作り直しを依頼する')


def check_opaque(img: Image.Image) -> tuple[bool, dict]:
    rgba, has = to_array(img)
    a = rgba[..., 3]
    see = float((a < 250).mean())
    return (not has) or see <= 0.0005, {'hasAlphaChannel': has, 'seeThroughShare': round(see, 5)}


# ---------------------------------------------------------------- 加工

def open_original(ctx: Ctx, a: dict) -> Image.Image:
    p = original_path(ctx, a)
    if not p or not p.exists():
        raise ArtError(f'{a["id"]} の原画が無い（{a.get("original", {}) and a["original"].get("path")}）')
    data = p.read_bytes()
    if sha256_bytes(data) != a['original']['sha256']:
        raise ArtError(f'{a["id"]} の原画の sha256 が記録と違う（{ctx.rel(p)}）')
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def source_rgba(ctx: Ctx, a: dict) -> np.ndarray:
    """人物画・手前の幕の原画を、記録した透明の作り方（そのまま／マゼンタを抜く）で RGBA にする。
    不透明度が transparentMax 以下のかすかな所（受け取りの検査で透明と数えた所）は、加工版では完全に透明にする
    （うっすら残った背景を画面に出さない。原画はそのまま保管する）"""
    img = open_original(ctx, a)
    src = a['original'].get('alphaSource')
    if src == 'magenta-key':
        rgb = np.asarray(img.convert('RGB'))
        out, _ = chroma_key(rgb, a['original']['key']['key'], a['recipe']['key'])
    elif src == 'alpha':
        out = np.asarray(img.convert('RGBA')).copy()
    else:
        raise ArtError(f'{a["id"]} の透明の作り方が記録に無い（ingest をやり直す）')
    tmax = a['recipe'].get('alphaCheck', {}).get('transparentMax', 8)
    out[out[..., 3] <= tmax, 3] = 0
    return out


def clear_hidden_rgb(rgba: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    out[out[..., 3] == 0, :3] = 0
    return out


def fit_size(w: int, h: int, max_w: int, max_h: int) -> tuple[int, int, float]:
    s = min(1.0, max_w / w, max_h / h)
    return max(1, int(round(w * s))), max(1, int(round(h * s))), s


BOTTOM_CUT_MIN_SHARE = 0.2  # 下端の行の不透明の割合がこれ未満なら「まっすぐな体の切れ目」ではない（trim.bottomCutMinShare で変えられる）


def portrait_trim_box(a: np.ndarray, t: dict) -> tuple[int, int, int, int]:
    """人物画の切り詰めの範囲（透明な余白を切る。下端の体の切れ目は切らない）"""
    ys, xs = np.nonzero(a > t['alphaThreshold'])
    if len(xs) == 0:
        raise ArtError('人物が見つからない（全部透明）')
    H, W = a.shape
    pad = t['padPx']
    x0, x1 = max(0, int(xs.min()) - pad), min(W, int(xs.max()) + 1 + pad)
    y0 = max(0, int(ys.min()) - pad)
    y1 = H if t.get('keepBottom', True) else min(H, int(ys.max()) + 1 + pad)
    return x0, y0, x1, y1


def bottom_cut_check(a: np.ndarray, t: dict) -> tuple[float, dict | None]:
    """下端の行（切り詰めた幅の中）の不透明（128 超）の割合と、まっすぐな切れ目でないときの注意。
    人物画は画面の下端に置くので、人物が下で消えていく・浮いていると、下に透明の帯が見える"""
    x0, _, x1, y1 = portrait_trim_box(a, t)
    share = round(float((a[y1 - 1, x0:x1] > 128).mean()), 3)
    need = float(t.get('bottomCutMinShare', BOTTOM_CUT_MIN_SHARE))
    if share >= need:
        return share, None
    return share, {
        'reason': 'bottom-cut',
        'message': (f'下端がまっすぐな体の切れ目になっていない（下端の行の不透明 {share:.0%}、目安 {need:.0%} 以上）。'
                    '人物が下で消えていく・浮いていると、画面の下に透明の帯が見える。画面で確かめ、だめなら作り直しを依頼する'),
    }


def process_portrait(rgba: np.ndarray, recipe: dict, anchors: dict | None) -> tuple[Image.Image, dict, dict]:
    a = rgba[..., 3]
    t = recipe['trim']
    x0, y0, x1, y1 = portrait_trim_box(a, t)
    crop = clear_hidden_rgb(rgba[y0:y1, x0:x1])
    w, h = x1 - x0, y1 - y0
    ow, oh, s = fit_size(w, h, recipe['maxW'], recipe['maxH'])
    img = Image.fromarray(crop, 'RGBA')
    if (ow, oh) != (w, h):
        img = Image.fromarray(clear_hidden_rgb(np.asarray(img.resize((ow, oh), Image.LANCZOS))), 'RGBA')
    meta = {}
    for k, v in (anchors or {}).items():
        if v is None:
            continue
        if k.endswith('Y'):
            meta[k] = round((float(v) - y0) / h, 4)
            lo, hi = y0, y1
        elif k.endswith('X'):
            meta[k] = round((float(v) - x0) / w, 4)
            lo, hi = x0, x1
        else:
            continue
        if not 0 < meta[k] < 1:
            raise ArtError(f'アンカー {k}={v} が切り詰めた範囲（{lo}〜{hi}）の外（原画の画素の座標で決める。set-anchor をやり直す）')
    share, warn = bottom_cut_check(a, t)
    rep = {
        'trimBox': [x0, y0, x1, y1],
        'scale': round(s, 4),
        'bottomRowOpaqueShare': share,
        'warnings': [warn] if warn else [],
    }
    return img, rep, meta


def square_rect(rect) -> tuple[int, int, int]:
    x, y, w, h = [float(v) for v in rect]
    side = int(round(max(w, h)))
    return int(round(x + w / 2 - side / 2)), int(round(y + h / 2 - side / 2)), side


def crop_face(rgba: np.ndarray, rect, recipe: dict) -> tuple[Image.Image, dict]:
    if not rect or len(rect) != 4 or min(rect[2], rect[3]) <= 0:
        raise ArtError(f'faceRect が正しくない：{rect}')
    x0, y0, side = square_rect(rect)
    H, W = rgba.shape[:2]
    canvas = np.zeros((side, side, 4), np.uint8)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(W, x0 + side), min(H, y0 + side)
    if sx1 <= sx0 or sy1 <= sy0:
        raise ArtError(f'faceRect {rect} が原画の外にある')
    canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgba[sy0:sy1, sx0:sx1]
    size = recipe['size']
    img = Image.fromarray(clear_hidden_rgb(canvas), 'RGBA')
    if side != size:
        img = Image.fromarray(clear_hidden_rgb(np.asarray(img.resize((size, size), Image.LANCZOS))), 'RGBA')
    rep = {
        'faceRect': [int(v) for v in rect],
        'squareRect': [x0, y0, side, side],
        'scale': round(size / side, 4),
        'upscaled': side < size,
        'outsideOriginal': not (x0 >= 0 and y0 >= 0 and x0 + side <= W and y0 + side <= H),
        'opaque': bool((np.asarray(img)[..., 3] == 255).all()),
    }
    return img, rep


def process_background(rgb: np.ndarray, recipe: dict) -> tuple[Image.Image, dict]:
    h, w = rgb.shape[:2]
    ow, oh, s = fit_size(w, h, recipe['maxW'], recipe['maxH'])
    img = Image.fromarray(rgb, 'RGB')
    if (ow, oh) != (w, h):
        img = img.resize((ow, oh), Image.LANCZOS)
    return img, {'scale': round(s, 4), 'aspect': round(w / h, 4)}


def process_overlay(rgba: np.ndarray, recipe: dict) -> tuple[Image.Image, dict]:
    h, w = rgba.shape[:2]
    ow, oh, s = fit_size(w, h, recipe['maxW'], recipe['maxH'])
    img = Image.fromarray(clear_hidden_rgb(rgba), 'RGBA')
    if (ow, oh) != (w, h):
        img = Image.fromarray(clear_hidden_rgb(np.asarray(img.resize((ow, oh), Image.LANCZOS))), 'RGBA')
    return img, {'scale': round(s, 4)}


# ---- 地面の素材：明暗のむらをならす・継ぎ目を消す

def srgb_to_lin(u8: np.ndarray) -> np.ndarray:
    x = u8.astype(np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb_f(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def to_u8(f01: np.ndarray) -> np.ndarray:
    return np.clip(np.round(f01 * 255.0), 0, 255).astype(np.uint8)


def blur_reflect(a: np.ndarray, sigma: float, wrap: bool = False) -> np.ndarray:
    """大きなぼかし（FFT でガウス）。縁は鏡映しで延ばす。wrap=True なら周期（上下左右がつながる）としてぼかす"""
    pad = 0 if wrap else int(min(3 * sigma, a.shape[0] - 1, a.shape[1] - 1))
    p = np.pad(a, pad, mode='reflect') if pad else a
    fy = np.fft.fftfreq(p.shape[0])[:, None]
    fx = np.fft.rfftfreq(p.shape[1])[None, :]
    g = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    out = np.fft.irfft2(np.fft.rfft2(p) * g, s=p.shape)
    return out[pad:pad + a.shape[0], pad:pad + a.shape[1]]


LUMA = np.array([0.2126, 0.7152, 0.0722])


def lighting_range(rgb_u8: np.ndarray, sigma: float) -> float:
    """焼き込まれた大きな明暗の幅（大きくぼかした明るさの 5〜95% の幅 ÷ 平均）"""
    y = srgb_to_lin(rgb_u8) @ LUMA
    b = blur_reflect(y, sigma)
    return round(float((np.percentile(b, 95) - np.percentile(b, 5)) / max(1e-6, b.mean())), 4)


def flatten_lighting(rgb_u8: np.ndarray, cfg: dict, wrap: bool) -> np.ndarray:
    lin = srgb_to_lin(rgb_u8)
    y = lin @ LUMA
    sigma = cfg['sigmaFrac'] * rgb_u8.shape[0]
    b = blur_reflect(y, sigma, wrap)
    gain = np.clip(y.mean() / np.maximum(b, 1e-6), cfg['gainMin'], cfg['gainMax'])
    out = lin * gain[..., None]
    out *= lin.mean(axis=(0, 1)) / np.maximum(out.mean(axis=(0, 1)), 1e-9)
    return to_u8(lin_to_srgb_f(out))


def box_down(a: np.ndarray, k: int) -> np.ndarray:
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    return a[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3))


def seam_metrics(rgb_u8: np.ndarray) -> dict:
    """繰り返したときの継ぎ目の目立ち方。継ぎ目の差 ÷ 中の隣どうしの差の中央値（1 前後なら目立たない）。細かい画素と 8px の平均の両方で測る"""
    L = (rgb_u8.astype(np.float64) / 255.0) @ LUMA
    eps = 1e-3
    out = {}
    for axis, name in ((1, 'x'), (0, 'y')):
        ratios, wraps = [], []
        for arr in (L, box_down(L, 8)):
            if axis == 1:
                interior = np.abs(np.diff(arr, axis=1)).mean(axis=0)
                wrap = float(np.abs(arr[:, 0] - arr[:, -1]).mean())
            else:
                interior = np.abs(np.diff(arr, axis=0)).mean(axis=1)
                wrap = float(np.abs(arr[0, :] - arr[-1, :]).mean())
            ratios.append((wrap + eps) / (float(np.median(interior)) + eps))
            wraps.append(wrap)
        out[name] = {'ratio': round(max(ratios), 3), 'wrapDiff': round(max(wraps), 4)}
    out['ratio'] = max(out['x']['ratio'], out['y']['ratio'])
    return out


def crossfade_axis(f: np.ndarray, axis: int, band: float) -> np.ndarray:
    """半分ずらした画像と、縁だけなめらかに混ぜる（分散を保つ混ぜ方。混ぜた所のコントラストが落ちない）"""
    n = f.shape[axis]
    shifted = np.roll(f, n // 2, axis=axis)
    t = (np.arange(n) + 0.5) / n
    d = np.abs(t - 0.5) * 2.0
    u = np.clip((1.0 - d) / band, 0.0, 1.0)
    w = u * u * (3.0 - 2.0 * u)
    shape = [1, 1, 1]
    shape[axis] = n
    w = w.reshape(shape)
    mu = f.mean(axis=(0, 1), keepdims=True)
    out = mu + (w * (f - mu) + (1.0 - w) * (shifted - mu)) / np.sqrt(w * w + (1.0 - w) * (1.0 - w))
    return np.clip(out, 0.0, 1.0)


def process_texture(rgb: np.ndarray, recipe: dict) -> tuple[Image.Image, dict, dict]:
    rep: dict = {'mapType': recipe.get('mapType', 'albedo')}
    h, w = rgb.shape[:2]
    if h != w:
        s = min(h, w)
        y0, x0 = (h - s) // 2, (w - s) // 2
        rgb = rgb[y0:y0 + s, x0:x0 + s]
        rep['cropToSquare'] = [x0, y0, s, s]
    side = rgb.shape[0]
    target = recipe['size']
    if side < target:
        target = 1 << (side.bit_length() - 1)
        rep['warning'] = f'原画が {side}px で {recipe["size"]}px より小さい。拡大せず {target}px にした'
    img = Image.fromarray(np.ascontiguousarray(rgb), 'RGB')
    if side != target:
        img = img.resize((target, target), Image.LANCZOS)
    cur = np.asarray(img).copy()
    sigma = recipe['flatten']['sigmaFrac'] * target
    rep['lightingRangeBefore'] = lighting_range(cur, sigma)
    rep['seamBefore'] = seam_metrics(cur)
    sc = recipe.get('seamless')
    if recipe.get('flatten'):
        # 初めから継ぎ目が目立たない物は、周期としてぼかす（ならすことで継ぎ目を作らない）。目立つ物は鏡映し（縁の明暗の傾きを正しく測る）
        wrap = bool(sc) and rep['seamBefore']['ratio'] <= sc['threshold']
        rep['flattenBlur'] = 'wrap' if wrap else 'reflect'
        cur = flatten_lighting(cur, recipe['flatten'], wrap)
        rep['lightingRangeAfter'] = lighting_range(cur, sigma)
    seam_mid = seam_metrics(cur)
    rep['seamAfterFlatten'] = seam_mid
    fixed = []
    if sc:
        f = cur.astype(np.float64) / 255.0
        for axis, name in ((1, 'x'), (0, 'y')):
            m = seam_mid[name]
            if m['ratio'] > sc['threshold'] and m['wrapDiff'] > sc['absMin']:
                f = crossfade_axis(f, axis, sc['band'])
                fixed.append(name)
        if fixed:
            cur = to_u8(f)
    rep['seamFixed'] = fixed
    rep['seamAfter'] = seam_metrics(cur)
    mean = cur.reshape(-1, 3).mean(axis=0)
    rep['meanRGB'] = [int(round(v)) for v in mean]
    rep['stdRGB'] = [round(float(v), 1) for v in cur.reshape(-1, 3).std(axis=0)]
    return Image.fromarray(cur, 'RGB'), rep, dict(recipe.get('meta') or {})


# ---- WebP に書く（上限に収まるまで品質を下げる。透明は劣化させない）

def encode_webp(img: Image.Image, cfg: dict, cap: int) -> tuple[bytes, int, list]:
    alpha = img.mode == 'RGBA'
    if not alpha:
        img = img.convert('RGB')
    q = int(cfg['quality'])
    tried = []
    data = b''
    while True:
        buf = io.BytesIO()
        kw = dict(format='WEBP', quality=q, method=int(cfg.get('method', 6)))
        if alpha:
            kw.update(alpha_quality=100, exact=False)
        img.save(buf, **kw)
        data = buf.getvalue()
        tried.append([q, len(data)])
        if len(data) <= cap:
            break
        q -= int(cfg.get('step', 5))
        if q < int(cfg['minQuality']):
            raise ArtError(f'上限 {cap} バイトに収まらない（品質と大きさ：{tried}）')
    dec = Image.open(io.BytesIO(data))
    dec.load()
    if dec.size != img.size:
        raise ArtError('WebP を読み直した大きさが違う')
    if alpha:
        a0 = np.asarray(img)[..., 3]
        a1 = np.asarray(dec.convert('RGBA'))[..., 3]
        if not np.array_equal(a0, a1):
            raise ArtError('WebP の透明が元と一致しない（透明は劣化させない決まり）')
    elif dec.mode not in ('RGB',):
        raise ArtError(f'不透明のはずの WebP が {dec.mode} になった')
    return data, q, tried


# ---------------------------------------------------------------- ingest

def _drop_incoming(ctx: Ctx, done: list, log) -> None:
    """受け取りを素材の記録に保存した後で、incoming/ の物を消す（読んだ時のままの物だけ。途中で書き換えられていたら残して知らせる）。
    記録の保存より先に消すと、途中で止まったとき原画が <id>/ に移ったのに記録は「まだ届いていない」のまま残る"""
    for src, data in done:
        if not src.exists():
            continue
        if src.read_bytes() == data:
            src.unlink()
        else:
            log(f'      注意：{ctx.rel(src)} が読んだ後に書き換えられたので、incoming/ に残した（もう一度 ingest する）')
    done.clear()


def _move_incoming(ctx: Ctx, src: Path, dst: Path, data: bytes, sha: str, log, done: list) -> None:
    """incoming/ の原画を <id>/original.* へ写す（中身は 1 バイトも変えない。原画を 2 か所に置かない）。
    先に写して sha256 を確かめる。incoming/ の物は done に積み、記録を保存した後に _drop_incoming が消す"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    part = dst.with_name(dst.name + '.part')
    part.write_bytes(data)
    if sha256_bytes(part.read_bytes()) != sha:
        part.unlink()
        raise ArtError(f'{ctx.rel(dst)} に写した中身が違う')
    part.replace(dst)
    done.append((src, data))


def _reject(a: dict, rej: dict, log) -> str:
    a['status'] = 'rejected'
    a['rejection'] = rej
    a['outputs'] = []  # 前の原画から作った加工版も使わない（build は rejected を作らない）
    a.pop('processing', None)
    a.pop('review', None)
    log(f'  {a["id"]:<20} 断る：{rej["message"]}')
    if a.get('original'):
        log(f'      前に受け取った原画（{a["original"]["sha256"][:12]}）からも作らない。作り直した物を incoming/ に置き、ingest --replace で受け取る')
    return 'rejected'


def ingest_one(ctx: Ctx, a: dict, replace: bool, log, done: list) -> str:
    """戻り値：'skip'|'missing'|'unchanged'|'received'|'replaced'|'rejected'|'conflict'。
    受け取った原画は incoming/ から <id>/original.* へ移す（incoming/ には README.md だけが残る）。断った物・差し替えを断った物は incoming/ に残す。
    incoming/ の物は done に積むだけで、消すのは cmd_ingest が記録を保存した後"""
    name = a.get('incoming')
    if not name:
        return 'skip'
    src = ctx.incoming / name
    if not src.exists():
        log(f'  {a["id"]:<20} まだ届いていない（{name}）' + ('（任意）' if not a.get('required', True) else ''))
        return 'missing'
    data = src.read_bytes()
    sha = sha256_bytes(data)
    if a.get('original') and a['original']['sha256'] == sha:
        if a['status'] == 'rejected':
            # 差し替えを断った後に、受け取り済みの原画と同じ物が置かれた：その原画に戻す
            a['status'] = 'received'
            a['rejection'] = None
            log(f'  {a["id"]:<20} 差し替えを断った後に、受け取り済みの原画と同じ物が置かれたので、その原画に戻した')
        kept = original_path(ctx, a)
        if kept.exists() and sha256_bytes(kept.read_bytes()) == sha:
            done.append((src, data))
            log(f'  {a["id"]:<20} 受け取り済みと同じ（{sha[:12]}）。incoming/ の同じ物は消した')
        else:
            _move_incoming(ctx, src, kept, data, sha, log, done)
            log(f'  {a["id"]:<20} 受け取り済みと同じ（{sha[:12]}）。保管の原画が無い・壊れていたので incoming/ の物を移して戻した')
        return 'unchanged'
    if a.get('original') and not replace:
        log(f'  {a["id"]:<20} 断る：受け取り済みの原画（{a["original"]["sha256"][:12]}）と違う。差し替えるなら --replace（incoming/ に残した）')
        return 'conflict'
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        return _reject(a, {'file': name, 'sha256': sha, 'reason': 'unreadable', 'message': f'画像として読めない：{e}'}, log)
    fmt = img.format or 'UNKNOWN'
    meta = inspect_metadata(data, fmt)
    details = meta.pop('_details', [])
    for d in details:
        log(f'      メタデータ {d}')
    w, h = img.size
    kind = a['kind']
    rec = {
        'path': None,
        'receivedAs': name,
        'w': w, 'h': h, 'bytes': len(data), 'sha256': sha,
        'format': fmt, 'mode': img.mode,
        'hasAlpha': None, 'alphaSource': None,
        'metadata': meta,
        'checks': {},
        'notes': [],
        'warnings': [],
    }
    exp = a.get('expected') or {}
    if exp.get('w') and (exp['w'], exp['h']) != (w, h):
        rec['notes'].append(f'依頼の大きさ {exp["w"]}×{exp["h"]} と違う（{w}×{h}）。拡大はしない')
    refuse = None
    if kind in ('portrait', 'overlay'):
        decision, rep, rgba = classify_alpha(img, a['recipe'])
        rec['checks']['alpha'] = rep
        if decision == 'refuse':
            refuse = (rep['reason'], rep['message'])
        else:
            rec['hasAlpha'] = decision == 'alpha'
            rec['alphaSource'] = decision
            rec['warnings'] += rep.get('warnings') or []
            if decision == 'magenta-key':
                rec['key'] = rep['keyed']
                rec['notes'].append(f'透明が無く、単色マゼンタ {rep["magenta"]["key"]} の背景だったので色を抜いた（縁はなめらか・色かぶりを取った）')
            if kind == 'portrait':
                try:
                    share, warn = bottom_cut_check(rgba[..., 3], a['recipe']['trim'])
                except ArtError as e:
                    refuse = ('empty', f'{e}。人物が写っていない。作り直しを依頼する')
                else:
                    rec['checks']['bottomRowOpaqueShare'] = share
                    if warn:
                        rec['warnings'].append(warn)
            if not refuse:
                work = ctx.src / a['id'] / '_work'
                work.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, 'RGBA').save(work / 'alpha.png')
                # 確かめ用：中間の灰色の上に置いた物（縁の色かぶり・欠けを見る）
                g = Image.new('RGBA', (w, h), (128, 128, 128, 255))
                g.alpha_composite(Image.fromarray(rgba, 'RGBA'))
                g.convert('RGB').save(work / 'on_grey.png')
    else:
        ok, rep = check_opaque(img)
        rec['checks']['opaque'] = rep
        rec['hasAlpha'] = False
        if not ok:
            refuse = ('not-opaque', f'透ける所がある（{rep["seeThroughShare"]:.2%}）。背景・地面の素材は不透明でなければ使えない')
        if kind == 'texture' and w != h:
            rec['notes'].append('正方形ではない。中央を正方形に切って使う')
    if refuse:
        return _reject(a, {'file': name, 'sha256': sha, 'w': w, 'h': h, 'reason': refuse[0], 'message': refuse[1], 'checks': rec['checks']}, log)
    ext = {'PNG': 'png', 'JPEG': 'jpg', 'WEBP': 'webp'}.get(fmt, 'bin')
    dst = ctx.src / a['id'] / f'original.{ext}'
    prev = a.get('original')
    if prev:
        # 差し替え：前の原画の拡張子が違えば消す（原画は 1 つだけ）。前の原画の画素の座標で決めた値は使えない
        for old in dst.parent.glob('original.*'):
            if old.name != dst.name and not old.name.endswith('.part'):
                old.unlink()
        if any(v is not None for v in (a.get('anchors') or {}).values()):
            a['anchors'] = {k: None for k in a['anchors']}
            rec['warnings'].append({'reason': 'anchors-cleared', 'message': '原画を差し替えたので、前の原画の座標のアンカー（eyeY など）を消した。新しい原画を見て set-anchor をやり直す'})
        rec['replaced'] = {'sha256': prev['sha256'], 'receivedAs': prev.get('receivedAs')}
    _move_incoming(ctx, src, dst, data, sha, log, done)
    rec['path'] = ctx.rel(dst)
    a['original'] = rec
    a['rejection'] = None
    a['status'] = 'received'
    a['outputs'] = []
    a.pop('processing', None)
    a.pop('buildError', None)
    a.pop('review', None)
    log(f'  {a["id"]:<20} {"差し替え" if prev else "受け取り"}：{w}×{h} {fmt} {img.mode} {len(data)} バイト sha256 {sha[:12]}'
        + (f'・{rec["alphaSource"]}' if rec['alphaSource'] else '') + ('・C2PA あり' if meta.get('c2pa') else '')
        + f'（incoming/ から {rec["path"]} へ移した）')
    for n in rec['notes']:
        log(f'      {n}')
    for wn in rec['warnings']:
        log(f'      注意（{wn["reason"]}）：{wn["message"]}')
    return 'replaced' if prev else 'received'


def cmd_ingest(ctx: Ctx, ids=None, replace=False, log=print) -> int:
    m = load_master(ctx)
    bad = 0
    log('受け取り（ingest）')
    done: list = []
    for a in m['assets']:
        if ids and a['id'] not in ids:
            continue
        r = ingest_one(ctx, a, replace, log, done)
        if r in ('rejected', 'conflict'):
            bad += 1
        if r in ('received', 'replaced', 'rejected'):
            # この原画から切り出す顔は作り直しが要る（差し替えなら顔の範囲も決め直す）
            for f in m['assets']:
                if f.get('derivedFrom') != a['id']:
                    continue
                f['outputs'] = []
                f.pop('processing', None)
                f.pop('buildError', None)
                f.pop('review', None)
                if f['status'] in ('built', 'approved'):
                    f['status'] = 'requested'
                if r == 'replaced' and f.get('faceRect'):
                    f['faceRect'] = None
                    log(f'      注意（faceRect-cleared）：{a["id"]} を差し替えたので、{f["id"]} の faceRect（前の原画の座標）を消した。set-face-rect をやり直すまで顔は作らない')
        if done:
            # 素材ごとに記録を保存してから incoming/ の物を消す（後の素材で止まっても、移した原画が記録に無いままにならない）
            save_master(ctx, m)
            _drop_incoming(ctx, done, log)
    save_master(ctx, m)
    write_gen(ctx, m)
    write_docs(ctx, m)
    return 1 if bad else 0


# ---------------------------------------------------------------- build

def build_one(ctx: Ctx, m: dict, a: dict) -> tuple[Image.Image, dict, dict, str]:
    kind = a['kind']
    r = a['recipe']
    if a['status'] == 'rejected':
        raise SkipBuild('作り直し待ち（rejected）。前に受け取った原画からも作らない')
    if kind == 'face':
        src = asset_by_id(m, a['derivedFrom'])
        if src['status'] == 'rejected':
            raise SkipBuild(f'元の人物画 {src["id"]} が作り直し待ち（rejected）')
        if not src.get('original'):
            raise SkipBuild(f'元の人物画 {src["id"]} をまだ受け取っていない')
        if not a.get('faceRect'):
            raise SkipBuild('faceRect が未設定（受け取った人物画を見てから set-face-rect で決める）')
        img, rep = crop_face(source_rgba(ctx, src), a['faceRect'], r)
        if rep['opaque']:
            rep.setdefault('notes', []).append('切り出した範囲が全部不透明なので、透明の層の無い WebP になる（顔はそれでよい）')
        return img, rep, {}, src['original']['sha256']
    if not a.get('original'):
        raise SkipBuild('原画をまだ受け取っていない')
    sha = a['original']['sha256']
    if kind == 'portrait':
        img, rep, meta = process_portrait(source_rgba(ctx, a), r, a.get('anchors'))
        return img, rep, meta, sha
    if kind == 'overlay':
        other = r.get('matchSizeOf')
        if other:
            o = asset_by_id(m, other).get('original')
            if o and (o['w'], o['h']) != (a['original']['w'], a['original']['h']):
                raise ArtError(f'{other} の原画（{o["w"]}×{o["h"]}）と大きさが違う（{a["original"]["w"]}×{a["original"]["h"]}）。重ならないので使えない')
        img, rep = process_overlay(source_rgba(ctx, a), r)
        return img, rep, {}, sha
    rgb = np.asarray(open_original(ctx, a).convert('RGB')).copy()
    if kind == 'background':
        img, rep = process_background(rgb, r)
        return img, rep, {}, sha
    if kind == 'texture':
        img, rep, meta = process_texture(rgb, r)
        return img, rep, meta, sha
    raise ArtError(f'知らない種類 {kind}')


class SkipBuild(Exception):
    pass


def unbuilt_status(a: dict) -> str:
    """加工版が無いときの状態（built・approved のままにしない）"""
    if a['status'] == 'rejected':
        return 'rejected'
    if a['kind'] != 'face' and a.get('original'):
        return 'received'
    return 'requested'


def drop_outputs(a: dict) -> None:
    a['outputs'] = []
    a.pop('processing', None)
    if a['status'] in ('built', 'approved'):
        a['status'] = unbuilt_status(a)
        a.pop('review', None)


def output_record(ctx: Ctx, a: dict, img: Image.Image, data: bytes, q: int, src_sha: str) -> dict:
    w, h = img.size
    rec = {
        'path': 'proto3d/public/' + a['recipe']['publicFile'],
        'w': w, 'h': h,
        'bytes': len(data),
        'sha256': sha256_bytes(data),
        'decodedBytes': w * h * 4,
        'quality': q,
        'sourceSha256': src_sha,
    }
    if a['kind'] == 'texture':
        rec['gpuBytesWithMips'] = int(round(w * h * 4 * 4 / 3))
    return rec


def write_bytes_if_changed(p: Path, data: bytes) -> bool:
    if p.exists() and p.read_bytes() == data:
        return False
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return True


def cmd_build(ctx: Ctx, ids=None, prune=False, log=print) -> int:
    m = load_master(ctx)
    bad = 0
    log('加工（build）')
    for a in m['assets']:
        if ids and a['id'] not in ids:
            continue
        try:
            img, rep, meta, src_sha = build_one(ctx, m, a)
            data, q, tried = encode_webp(img, a['recipe']['webp'], a['recipe']['capBytes'])
        except SkipBuild as e:
            if a.get('outputs'):
                log(f'  {a["id"]:<20} 作らない：{e}（前の加工版を外す）')
            else:
                log(f'  {a["id"]:<20} 作らない：{e}')
            drop_outputs(a)
            a.pop('buildError', None)
            continue
        except ArtError as e:
            log(f'  {a["id"]:<20} 失敗：{e}')
            drop_outputs(a)
            a['buildError'] = str(e)
            bad += 1
            continue
        a.pop('buildError', None)
        out = ctx.public / a['recipe']['publicFile']
        write_bytes_if_changed(out, data)
        rec = output_record(ctx, a, img, data, q, src_sha)
        prev = (a.get('outputs') or [None])[0]
        if meta:
            rec['meta'] = meta
        rep['qualityTried'] = tried
        a['processing'] = rep
        a['outputs'] = [rec]
        if a['status'] != 'approved' or not prev or prev.get('sha256') != rec['sha256']:
            a['status'] = 'built'
        log(f'  {a["id"]:<20} {rec["w"]}×{rec["h"]} 品質 {q} {rec["bytes"]} バイト（上限 {a["recipe"]["capBytes"]}）→ {rec["path"]}')
        for n in rep.get('notes') or []:
            log(f'      {n}')
        for wn in rep.get('warnings') or []:
            log(f'      注意（{wn["reason"]}）：{wn["message"]}')
        if a['kind'] == 'texture':
            log(f'      明暗のむら {rep["lightingRangeBefore"]} → {rep.get("lightingRangeAfter")}・'
                f'継ぎ目 {rep["seamBefore"]["ratio"]} → {rep["seamAfterFlatten"]["ratio"]} → {rep["seamAfter"]["ratio"]}'
                f'（直した向き：{",".join(rep["seamFixed"]) or "なし"}）')
            work = ctx.src / a['id'] / '_work'
            work.mkdir(parents=True, exist_ok=True)
            dec = Image.open(io.BytesIO(data)).convert('RGB')
            tile = Image.new('RGB', (dec.width * 2, dec.height * 2))
            for i in range(2):
                for j in range(2):
                    tile.paste(dec, (i * dec.width, j * dec.height))
            tile.save(work / 'tiled_2x2.png')
    save_master(ctx, m)
    gen = write_gen(ctx, m)
    listed = {e['file'] for e in gen['assets'].values()}
    art = ctx.public / 'art'
    if art.exists():
        for p in sorted(art.rglob('*')):
            if p.is_file() and p.relative_to(ctx.public).as_posix() not in listed:
                if prune:
                    p.unlink()
                    log(f'  一覧に無いので消した：{ctx.rel(p)}')
                else:
                    log(f'  一覧に無いファイル（--prune で消す）：{ctx.rel(p)}')
                    bad += 1
    write_docs(ctx, m)
    return 1 if bad else 0


def gen_manifest(m: dict, ctx: Ctx | None = None) -> dict:
    out = {'version': 1, 'assets': {}}
    for a in m['assets']:
        if a['status'] not in ('built', 'approved') or not a.get('outputs'):
            continue
        o = a['outputs'][0]
        if ctx and not (ctx.public / a['recipe']['publicFile']).exists():
            continue
        e = {'file': a['recipe']['publicFile'], 'w': o['w'], 'h': o['h'], 'kind': a['kind'], 'bytes': o['bytes'], 'sha256': o['sha256']}
        if o.get('meta'):
            e['meta'] = o['meta']
        out['assets'][a['id']] = e
    return out


def write_gen(ctx: Ctx, m: dict) -> dict:
    g = gen_manifest(m, ctx)
    write_text_if_changed(ctx.gen, dump_json(g, indent=4))
    return g


# ---------------------------------------------------------------- check

def cmd_check(ctx: Ctx, strict=False, log=print) -> int:
    m = load_master(ctx)
    errs: list[str] = []
    gen = json.loads(ctx.gen.read_text(encoding='utf-8'))
    want = gen_manifest(m, None)
    if gen != want:
        errs.append('manifest.gen.json が正本の加工版の記録と一致しない（build をやり直す）')
    rows = []
    total = 0
    for a in m['assets']:
        o = (a.get('outputs') or [None])[0]
        if o and a['status'] not in ('built', 'approved'):
            errs.append(f'{a["id"]}: 加工版の記録があるのに状態が {a["status"]}（build をやり直す）')
        if not o and a['status'] in ('built', 'approved'):
            errs.append(f'{a["id"]}: 状態が {a["status"]} なのに加工版の記録が無い（build をやり直す）')
        for k, v in ((o or {}).get('meta') or {}).items():
            if (k.endswith('X') or k.endswith('Y')) and not (isinstance(v, (int, float)) and 0 < v < 1):
                errs.append(f'{a["id"]}: meta.{k} = {v} が 0〜1 の割合ではない（set-anchor の値を確かめる）')
        if a.get('original'):
            p = ctx.root / a['original']['path']
            if not p.exists():
                errs.append(f'{a["id"]}: 原画が無い {a["original"]["path"]}')
            elif sha256_bytes(p.read_bytes()) != a['original']['sha256']:
                errs.append(f'{a["id"]}: 原画の sha256 が記録と違う')
        if not o:
            rows.append((a['id'], a['status'], '-', '-', '-', a['recipe']['capBytes'], '-', ''))
            continue
        p = ctx.root / o['path']
        mark = 'ok'
        if not p.exists():
            errs.append(f'{a["id"]}: 加工版が無い {o["path"]}')
            mark = 'NG'
        else:
            data = p.read_bytes()
            if len(data) != o['bytes'] or sha256_bytes(data) != o['sha256']:
                errs.append(f'{a["id"]}: 加工版の容量か sha256 が記録と違う')
                mark = 'NG'
            if len(data) > a['recipe']['capBytes']:
                errs.append(f'{a["id"]}: 上限 {a["recipe"]["capBytes"]} バイトを超えた（{len(data)}）')
                mark = 'NG'
            im = Image.open(io.BytesIO(data))
            if im.size != (o['w'], o['h']):
                errs.append(f'{a["id"]}: 加工版の寸法 {im.size} が記録と違う')
                mark = 'NG'
            total += len(data)
        if strict:
            if a['status'] != 'approved':
                errs.append(f'{a["id"]}: 画面での見た目の確認がまだ（status {a["status"]}）')
            if (a.get('terms') or {}).get('confirmedByUser') is not True or (m.get('terms') or {}).get('confirmedByUser') is not True:
                errs.append(f'{a["id"]}: 利用条件を利用者に確認できていない')
        rows.append((a['id'], a['status'], o['path'].replace('proto3d/public/', ''), f'{o["w"]}×{o["h"]}', o['bytes'], a['recipe']['capBytes'], o['sha256'][:10], mark))
    art = ctx.public / 'art'
    listed = {e['file'] for e in gen['assets'].values()}
    if art.exists():
        for p in sorted(art.rglob('*')):
            if p.is_file() and p.relative_to(ctx.public).as_posix() not in listed:
                errs.append(f'一覧に無いファイルが公開の置き場にある：{ctx.rel(p)}')
    log(f'{"ID":<20} {"状態":<10} {"加工版":<28} {"寸法":>10} {"容量":>8} {"上限":>8} {"sha256":<10}')
    for r in rows:
        log(f'{r[0]:<20} {r[1]:<10} {r[2]:<28} {r[3]:>10} {str(r[4]):>8} {r[5]:>8} {r[6]:<10} {r[7]}')
    log(f'加工版の合計：{total} バイト（{len(gen["assets"])} 件）')
    for e in errs:
        log(f'NG {e}')
    if not errs:
        log('check：問題なし' + ('（--strict）' if strict else ''))
    return 1 if errs else 0


# ---------------------------------------------------------------- 編集の口（受け取った画像を見てから決める値）

def cmd_set_face_rect(ctx: Ctx, aid: str, rect: list[int], log=print) -> int:
    m = load_master(ctx)
    a = asset_by_id(m, aid)
    if a['kind'] != 'face':
        raise ArtError(f'{aid} は顔ではない')
    src = asset_by_id(m, a['derivedFrom'])
    if not src.get('original'):
        raise ArtError(f'{src["id"]} の原画をまだ受け取っていない（受け取った原画を見てから、その画素の座標で決める）')
    W, H = src['original']['w'], src['original']['h']
    x, y, w, h = rect
    if w <= 0 or h <= 0 or x >= W or y >= H or x + w <= 0 or y + h <= 0:
        raise ArtError(f'faceRect {rect} が原画（{W}×{H}）の外')
    a['faceRect'] = [int(v) for v in rect]
    save_master(ctx, m)
    write_docs(ctx, m)
    log(f'{aid} の faceRect = {a["faceRect"]}（{a["derivedFrom"]} の原画の画素の座標）。build で作る')
    return 0


def cmd_set_anchor(ctx: Ctx, aid: str, key: str, value: str, log=print) -> int:
    m = load_master(ctx)
    a = asset_by_id(m, aid)
    if a['kind'] != 'portrait':
        raise ArtError(f'{aid} は人物画ではない')
    if not (key.endswith('X') or key.endswith('Y')):
        raise ArtError('アンカーの名前は …X（横）か …Y（縦）で終える（例 eyeY・faceX）')
    if value in ('null', 'none', ''):
        v = None
    else:
        try:
            v = float(value)
        except ValueError:
            raise ArtError(f'アンカーの値 {value!r} が数ではない') from None
        o = a.get('original')
        if not o:
            raise ArtError(f'{aid} の原画をまだ受け取っていない（受け取った原画を見てから、その画素の座標で決める）')
        size = o['w'] if key.endswith('X') else o['h']
        if not np.isfinite(v) or not 1 <= v < size:
            hint = '。割合ではなく原画の画素の座標で書く（例 eyeY 310）' if 0 < v < 1 else ''
            raise ArtError(f'{key} = {value} が原画の範囲（1〜{size - 1} の画素）の外{hint}')
    a.setdefault('anchors', {})[key] = v
    save_master(ctx, m)
    write_docs(ctx, m)
    log(f'{aid} の {key} = {a["anchors"][key]}（原画の画素の座標）。build で加工版の割合に直して meta に入れる')
    return 0


def cmd_approve(ctx: Ctx, aid: str, note: str, log=print) -> int:
    m = load_master(ctx)
    a = asset_by_id(m, aid)
    if a['status'] != 'built' or not a.get('outputs'):
        raise ArtError(f'{aid} は加工版を作った後（built）でないと確認済みにできない（今は {a["status"]}）')
    a['status'] = 'approved'
    a['review'] = {'outputSha256': a['outputs'][0]['sha256'], 'note': note}
    save_master(ctx, m)
    write_gen(ctx, m)
    write_docs(ctx, m)
    log(f'{aid} を確認済み（approved）にした。加工版が変わると build で built に戻る')
    return 0


# ---------------------------------------------------------------- docs/art-assets.md

STATUS_JA = {'requested': '依頼済み', 'received': '受け取り済み', 'rejected': '作り直し待ち', 'built': '加工済み（見た目の確認待ち）', 'approved': '確認済み'}
KIND_JA = {'portrait': '人物画', 'face': '顔（人物画から切り出し）', 'background': '物語の背景', 'overlay': '背景の手前の重ね', 'texture': '地面の色の素材'}


def fmt_bytes(n) -> str:
    if n is None:
        return '—'
    return f'{n:,}'


def md_cell(s) -> str:
    return str(s).replace('|', '\\|').replace('\n', ' ')


def terms_text(t: dict | None) -> str:
    v = (t or {}).get('confirmedByUser')
    return '確認済み' if v is True else ('不可' if v is False else '未確認')


def write_docs(ctx: Ctx, m: dict) -> bool:
    L: list[str] = []
    A = m['assets']
    received = [a for a in A if a.get('incoming') and a.get('original')]
    asked = [a for a in A if a.get('incoming')]
    built = [a for a in A if a.get('outputs')]
    total = sum(a['outputs'][0]['bytes'] for a in built)
    decoded = sum(a['outputs'][0]['decodedBytes'] for a in built)
    L += [
        '# 画像素材の記録（Version 22 から）',
        '',
        '素材 1 件ごとの「何に使う・誰／どの場面・どう作った・原画と加工版・寸法と容量・利用条件・状態」の一覧です。',
        '',
        f'- **このファイルは作られた物です。** 正本は `{ctx.rel(ctx.master)}` で、`python3 -I proto3d/tools/art-build.py docs` で作り直します（ingest・build・set-… でも作り直します）。手で直さないでください。',
        f'- 依頼の原文：`{m["request"]["original"]}`。利用者に送った依頼リスト（ファイル名・用途・寸法・透明・構図・プロンプト）：`{m["request"]["assetList"]}`。',
        '- **この作業環境では画像を生成できません。** 原画は利用者が ChatGPT で生成して渡します。受け取るまでは、差し替えの仕組みと配置の準備だけを進め、仮の画像のままでは見た目の改善の完了とは扱いません。',
        '- ゲームが読むのは `proto3d/src/art/manifest.gen.json`（file・w・h・kind・bytes・sha256・meta だけ）。正本（プロンプトの参照・原画の記録）はゲームに入れません。',
        '- 原画は `proto3d/assets-src/art-v22/<id>/original.png` に、受け取ったままの中身で保管し、公開版には入れません。公開版に入るのは `proto3d/public/art/` の加工版（WebP）だけです。',
        '- ingest は受け取った原画を `incoming/` から `<id>/original.png` へ **移します**（同じ原画を 2 か所に置かない。`incoming/` には README.md だけが残る）。断った物は `incoming/` に残ります。',
        '',
        '## 状況のまとめ',
        '',
        f'- 受け取り：{len(received)} / {len(asked)} 枚（任意の 1 枚を含む）',
        f'- 加工版：{len(built)} / {len(A)} 件、合計 {fmt_bytes(total)} バイト（展開後 {fmt_bytes(decoded)} バイト）',
        f'- 利用条件：{terms_text(m.get("terms"))}（{m["terms"]["questions"]}）',
        '',
        '## 一覧',
        '',
        '| ID | 状態 | 種類・用途 | 人物・場面 | 原画（受け取りの名前 → 保管） | 加工版（公開） | 寸法 | 容量（バイト） | 作り方・参照 | 利用条件 |',
        '|---|---|---|---|---|---|---|---|---|---|',
    ]
    for a in A:
        o = a.get('original')
        out = (a.get('outputs') or [None])[0]
        if a['kind'] == 'face':
            orig = f'{a["derivedFrom"]} の原画から切り出し'
        elif o:
            orig = f'`{a["incoming"]}` → `{o["path"]}`'
        elif a.get('rejection'):
            orig = f'`{a["incoming"]}`（受け取ったが使えない：{a["rejection"]["reason"]}）'
        else:
            orig = f'`{a["incoming"]}`（未着）' + ('・任意' if not a.get('required', True) else '')
        dims = f'原画 {o["w"]}×{o["h"]}' if o else (f'依頼 {a["expected"]["w"]}×{a["expected"]["h"]}' if a.get('expected') else '')
        if out:
            dims += f' → {out["w"]}×{out["h"]}'
        size = ' → '.join(x for x in [f'原画 {fmt_bytes(o["bytes"])}' if o else '', fmt_bytes(out['bytes']) if out else ''] if x)
        size += f'（上限 {fmt_bytes(a["recipe"]["capBytes"])}）'
        meth = a['method']
        how = meth['how'] + (f'。{meth["promptRef"]}' if meth.get('promptRef') else '')
        if meth.get('model'):
            how += f'。{meth["model"]}'
        if meth.get('generatedOn'):
            how += f'（{meth["generatedOn"]}）'
        refs = meth.get('referenceImages')
        how += '。参考画像：' + ('報告待ち' if refs is None else ('なし' if not refs else '、'.join(refs)))
        L.append('| ' + ' | '.join(md_cell(c) for c in [
            f'`{a["id"]}`', STATUS_JA.get(a['status'], a['status']), f'{KIND_JA[a["kind"]]}：{a["purpose"]}', a['subject'],
            orig, f'`{a["recipe"]["publicFile"]}`' + ('' if out else '（未作成）'), dims, size, how, terms_text(a.get('terms')),
        ]) + ' |')
    L += ['', '## 原画と加工版の対応', '', '| 加工版 | 元の原画 | 原画の sha256 | 加工版の sha256 | 展開後の大きさ |', '|---|---|---|---|---|']
    for a in A:
        out = (a.get('outputs') or [None])[0]
        src = asset_by_id(m, a['derivedFrom']) if a.get('derivedFrom') else a
        so = src.get('original')
        L.append('| ' + ' | '.join(md_cell(c) for c in [
            f'`{a["recipe"]["publicFile"]}`',
            f'`{so["path"]}`' if so else f'（{src["id"]} 未着）',
            so['sha256'][:16] + '…' if so else '—',
            out['sha256'][:16] + '…' if out else '—',
            fmt_bytes(out['decodedBytes']) + (f'（GPU・ミップマップ込み {fmt_bytes(out["gpuBytesWithMips"])}）' if out and out.get('gpuBytesWithMips') else '') if out else '—',
        ]) + ' |')
    L += ['', '## 素材ごとの記録', '']
    for a in A:
        L.append(f'### `{a["id"]}`（{KIND_JA[a["kind"]]}・{STATUS_JA.get(a["status"], a["status"])}）')
        L.append('')
        L.append(f'- 用途：{a["purpose"]}')
        L.append(f'- 人物・場面：{a["subject"]}')
        L.append(f'- 使う所：{"、".join(a.get("usedIn") or [])}')
        if a.get('expected', {}).get('notes'):
            L.append(f'- 依頼の要点：{a["expected"]["notes"]}')
        meth = a['method']
        L.append(f'- 作り方：{meth["how"]}' + (f'（同じチャット：{"、".join(meth["sameChatAs"])}）' if meth.get('sameChatAs') else ''))
        if meth.get('service'):
            L.append(f'  - 生成の機能・モデル：{meth.get("feature") or "報告待ち"}／{meth.get("model") or "報告待ち"}。生成した日：{meth.get("generatedOn") or "報告待ち"}')
            L.append(f'  - プロンプト：{meth.get("promptRef")}' + ('（実際に使った文は報告待ち）' if meth.get('promptAsUsed') is None else '（実際に使った文は正本の promptAsUsed）'))
            refs = meth.get('referenceImages')
            L.append(f'  - 参考画像：{"報告待ち" if refs is None else ("なし" if not refs else "、".join(refs))}')
        if meth.get('styleNotes'):
            L.append(f'  - {meth["styleNotes"]}')
        if a.get('derivedFrom'):
            L.append(f'- 元：`{a["derivedFrom"]}` の原画（同じ原画から切り出す）。faceRect：{a.get("faceRect") or "未設定（受け取った人物画を見てから決める）"}')
        o = a.get('original')
        if o:
            L.append(f'- 原画：`{o["path"]}`（受け取りの名前 `{o["receivedAs"]}`）{o["w"]}×{o["h"]}・{o["format"]} {o["mode"]}・{fmt_bytes(o["bytes"])} バイト・sha256 `{o["sha256"]}`')
            L.append(f'  - 透明：{"あり（本物の透明）" if o.get("alphaSource") == "alpha" else ("マゼンタの背景を抜いた" if o.get("alphaSource") == "magenta-key" else "なし（不透明）")}')
            L.append(f'  - メタデータ：{o["metadata"]["note"]}')
            for n in o.get('notes') or []:
                L.append(f'  - {n}')
            for wn in o.get('warnings') or []:
                L.append(f'  - **注意（{wn["reason"]}）**：{wn["message"]}')
            if o.get('replaced'):
                L.append(f'  - 差し替え：前の原画 sha256 `{o["replaced"]["sha256"][:16]}…`（受け取りの名前 `{o["replaced"].get("receivedAs")}`）')
        elif a.get('incoming'):
            L.append(f'- 原画：未着（`incoming/{a["incoming"]}`）')
        if a.get('rejection'):
            r = a['rejection']
            L.append(f'- **作り直し待ち**：{r["message"]}（受け取ったファイル `{r["file"]}`・sha256 `{r["sha256"][:16]}…`）')
        if a.get('anchors') and any(v is not None for v in a['anchors'].values()):
            L.append(f'- アンカー（原画の画素の座標）：{json.dumps(a["anchors"], ensure_ascii=False)}')
        L.append('- 加工の手順：')
        for s in a['recipe'].get('steps') or []:
            L.append(f'  1. {s}')
        out = (a.get('outputs') or [None])[0]
        if out:
            L.append(f'- 加工版：`{out["path"]}` {out["w"]}×{out["h"]}・{fmt_bytes(out["bytes"])} バイト（上限 {fmt_bytes(a["recipe"]["capBytes"])}）・品質 {out["quality"]}・sha256 `{out["sha256"]}`'
                     + (f'・meta {json.dumps(out["meta"], ensure_ascii=False)}' if out.get('meta') else ''))
            p = a.get('processing') or {}
            if a['kind'] == 'texture' and p:
                L.append(f'  - 明暗のむら：{p.get("lightingRangeBefore")} → {p.get("lightingRangeAfter")}。継ぎ目（1 前後なら目立たない）：{p["seamBefore"]["ratio"]} → {p["seamAfterFlatten"]["ratio"]} → {p["seamAfter"]["ratio"]}（直した向き：{"、".join(p.get("seamFixed") or []) or "なし"}）。平均の色 {p.get("meanRGB")}')
                L.append(f'  - 色の画像（アルベド）としてだけ使う。法線・粗さの画像ではない。1 枚 = {(out.get("meta") or {}).get("tileMeters", "?")}m 四方')
            elif p:
                L.append(f'  - 処理の記録：{json.dumps({k: v for k, v in p.items() if k not in ("qualityTried", "warnings", "notes")}, ensure_ascii=False)}')
            for n in p.get('notes') or []:
                L.append(f'  - {n}')
            for wn in p.get('warnings') or []:
                L.append(f'  - **注意（{wn["reason"]}）**：{wn["message"]}')
        if a.get('buildError'):
            L.append(f'- **加工の失敗**：{a["buildError"]}')
        L.append(f'- 利用条件：{terms_text(a.get("terms"))}。{(a.get("terms") or {}).get("notes") or ""}')
        L.append('')
    L += [
        '## 作業の手順',
        '',
        '1. 利用者が `proto3d/assets-src/art-v22/incoming/` に PNG を置く（受け取りの名前は上の一覧）。',
        '2. `python3 -I proto3d/tools/art-build.py ingest`：透明・不透明・メタデータ（C2PA など）を調べ、通った原画を `incoming/` から `<id>/original.png` へ受け取ったままの中身で移す（`incoming/` には README.md だけが残る。git では incoming/ の削除と original.png の追加を一緒にコミットする）。断った物は `incoming/` に残す（作り直した物で置き換える）。',
        '   - 人物画・手前の幕は本物の透明が要る。灰色と白の市松模様が描き込まれた物は断る（透明の画像でも、不透明の所に市松模様が約 1,500 画素以上あれば断る）。透明が無く、背景が単色マゼンタ（#FF00FF）なら色を抜き、そのことを記録する。それ以外は断る（作り直しを依頼）。',
        '   - 全体の透明（不透明度 8 以下）が足りない物は断る。全体ははっきり透明なのに外側の確かめの範囲（上端・左右）に人物がかかる物は、断らずに **構図の注意（composition）** として記録する。人物画の下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）物は **下端の注意（bottom-cut）** を記録する。注意は ingest・build の画面とこのファイルに出る。画面で確かめてから approve する。',
        '   - 差し替えは `ingest --replace --id <id>`。前の原画の画素の座標で決めた faceRect・アンカーは消える（set-… をやり直すまで顔は作らない）。差し替えを断った物は作り直し待ち（rejected）になり、前の原画からも作らない。',
        '   - 確かめ用の画像（色を抜いた結果・灰色の上に置いた物・地面を 2×2 に並べた物）は `<id>/_work/` に出る（リポジトリには入れない）。',
        '3. 受け取った人物画を見て、顔の範囲と目の高さを決める：`set-face-rect face.ieyasu X Y W H`、`set-anchor portrait.ieyasu eyeY 310`（どちらも原画の画素の座標。割合や原画の外の値は断る）。顔は切り出した範囲が全部不透明なら、透明の層の無い WebP になる（それでよい。build が記録する）。',
        '4. `python3 -I proto3d/tools/art-build.py build`：作り方どおりに加工し、`proto3d/public/art/` と `manifest.gen.json` とこのファイルを書き直す。作れない物（未着・作り直し待ち・faceRect が未設定・失敗）は加工版の記録を外し、状態を受け取り済み／依頼済みに戻す。',
        '5. `python3 -I proto3d/tools/art-build.py check`：加工版が一覧どおりか。公開の前は `check --strict`（見た目の確認 approved と、利用条件の確認が要る）。',
        '6. 公開する dist は `node proto3d/tools/check-dist.mjs dist-proto3d`（容量・ファイル数・.glb・dev-art が無いこと・/art の一覧）。',
        '',
        '## 開発用の仮の画像（TEST）',
        '',
        '`proto3d/dev-art/` は、配置と動作の確かめだけに使う **TEST の模様の画像**（格子と「TEST」の文字）です。素材ではなく、見た目の改善とは扱いません。',
        '開発サーバーで `?artFixture=1` を付けたときだけ使われ、公開版（`proto3d/public/` の外）には入りません。作り方：`python3 -I proto3d/tools/make-dev-art.py`（このパイプラインと同じ加工の道を通る）。',
        '',
    ]
    return write_text_if_changed(ctx.docs, '\n'.join(L))


def cmd_docs(ctx: Ctx, log=print) -> int:
    m = load_master(ctx)
    changed = write_docs(ctx, m)
    log(f'{ctx.rel(ctx.docs)} を{"書き直した" if changed else "確かめた（変わりなし）"}')
    return 0


# ---------------------------------------------------------------- selftest（合成した入力で確かめる）

def _figure_alpha(w: int, h: int, scale: int = 2) -> np.ndarray:
    """確かめ用の単純な形（頭の楕円＋胴。下端まで続く）の透明さ（0〜1）。縁は 2 倍で描いて縮めてなめらかに"""
    W, H = w * scale, h * scale
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    d.ellipse([0.36 * W, 0.06 * H, 0.66 * W, 0.31 * H], fill=255)
    d.rectangle([0.46 * W, 0.28 * H, 0.58 * W, 0.40 * H], fill=255)
    d.polygon([(0.2 * W, H), (0.22 * W, 0.45 * H), (0.3 * W, 0.40 * H), (0.74 * W, 0.40 * H), (0.82 * W, 0.45 * H), (0.84 * W, H)], fill=255)
    im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float64) / 255.0


def _noise(rng, h, w, sigma, periodic=False) -> np.ndarray:
    n = rng.standard_normal((h, w))
    if periodic:
        fy = np.fft.fftfreq(h)[:, None]
        fx = np.fft.rfftfreq(w)[None, :]
        g = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
        out = np.fft.irfft2(np.fft.rfft2(n) * g, s=(h, w))
    else:
        out = blur_reflect(n, sigma)
    return out / max(1e-9, out.std())


def _make_inputs(dirpath: Path, variant: str) -> dict:
    rng = np.random.default_rng(22)
    W, H = 1024, 1536
    fa = _figure_alpha(W, H)
    body = np.zeros((H, W, 3))
    body[...] = (95, 105, 120)
    body += _noise(rng, H, W, 2)[..., None] * 12
    body = np.clip(body, 0, 255)
    truth = {'alpha': fa}
    if variant == 'A':
        # 本物の透明の人物画
        rgba = np.zeros((H, W, 4), np.uint8)
        rgba[..., :3] = body.astype(np.uint8)
        rgba[..., 3] = np.round(fa * 255).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(dirpath / 'portrait_ieyasu.png')
        # 単色マゼンタの背景の人物画（縁はマゼンタと混ざる）
        green = np.clip(np.full((H, W, 3), (70, 95, 75), np.float64) + _noise(rng, H, W, 2)[..., None] * 10, 0, 255)
        mag = np.array([254.0, 2.0, 252.0]) + rng.normal(0, 1.5, (H, W, 3))
        comp = fa[..., None] * green + (1 - fa[..., None]) * mag
        Image.fromarray(np.clip(np.round(comp), 0, 255).astype(np.uint8), 'RGB').save(dirpath / 'portrait_tadakatsu.png')
        truth['tadakatsuGreen'] = green
        # 背景（不透明）と手前の幕（本物の透明。中央は透明）
        bg = np.clip(np.full((1024, 1536, 3), (120, 110, 95), np.float64) + _noise(rng, 1024, 1536, 3)[..., None] * 18, 0, 255).astype(np.uint8)
        Image.fromarray(bg, 'RGB').save(dirpath / 'bg_council.png')
        fr = np.zeros((1024, 1536, 4), np.uint8)
        fr[:, :180, :3] = (60, 45, 35)
        fr[:, -180:, :3] = (60, 45, 35)
        fr[:, :180, 3] = 255
        fr[:, -180:, 3] = 255
        Image.fromarray(fr, 'RGBA').save(dirpath / 'bg_council_front.png')
        # 継ぎ目と、焼き込まれた明暗のむらのある地面
        n = _noise(rng, 1024, 1024, 3) * 0.6 + _noise(rng, 1024, 1024, 24) * 0.4
        base = np.array([95.0, 120.0, 60.0])
        tex = base[None, None, :] * (1 + 0.18 * n[..., None])
        gx = np.linspace(0.6, 1.35, 1024)[None, :, None]
        gy = np.linspace(1.15, 0.9, 1024)[:, None, None]
        Image.fromarray(np.clip(np.round(tex * gx * gy), 0, 255).astype(np.uint8), 'RGB').save(dirpath / 'tex_plains_grass.png')
        # 初めから継ぎ目のない地面（直さないはず）
        n2 = _noise(rng, 1024, 1024, 3, periodic=True) * 0.7 + _noise(rng, 1024, 1024, 20, periodic=True) * 0.3
        tex2 = np.array([150.0, 130.0, 100.0])[None, None, :] * (1 + 0.12 * n2[..., None])
        Image.fromarray(np.clip(np.round(tex2), 0, 255).astype(np.uint8), 'RGB').save(dirpath / 'tex_plains_dirt.png')
        # 透ける地面（断るはず）
        t3 = np.zeros((1024, 1024, 4), np.uint8)
        t3[..., :3] = 140
        t3[..., 3] = 255
        t3[:300, :300, 3] = 0
        Image.fromarray(t3, 'RGBA').save(dirpath / 'tex_plains_road.png')
    elif variant == 'B':
        # 灰色と白の市松模様が描き込まれた「透明風」の人物画（RGB）
        yy, xx = np.mgrid[0:H, 0:W]
        chk = (((xx // 16) + (yy // 16)) % 2).astype(np.float64)
        bgc = np.where(chk[..., None] > 0, 255.0, 204.0) * np.ones(3)
        comp = fa[..., None] * body + (1 - fa[..., None]) * bgc
        Image.fromarray(np.clip(np.round(comp), 0, 255).astype(np.uint8), 'RGB').save(dirpath / 'portrait_ieyasu.png')
        # 透明の層はあるが全部不透明・背景は灰色の単色（断るはず）
        comp2 = fa[..., None] * body + (1 - fa[..., None]) * np.array([200.0, 200.0, 200.0])
        rgba = np.zeros((H, W, 4), np.uint8)
        rgba[..., :3] = np.clip(np.round(comp2), 0, 255).astype(np.uint8)
        rgba[..., 3] = 255
        Image.fromarray(rgba, 'RGBA').save(dirpath / 'portrait_tadakatsu.png')
        # 市松模様の手前の幕（RGBA だが全部不透明。断るはず）
        yy, xx = np.mgrid[0:1024, 0:1536]
        chk = (((xx // 24) + (yy // 24)) % 2)
        fr = np.zeros((1024, 1536, 4), np.uint8)
        fr[..., :3] = np.where(chk[..., None] > 0, 255, 230)
        fr[:, :180, :3] = (60, 45, 35)
        fr[..., 3] = 255
        Image.fromarray(fr, 'RGBA').save(dirpath / 'bg_council_front.png')
    files = sorted(p.name for p in dirpath.iterdir())
    return {'truth': truth, 'files': files}


def _fresh_master(real: dict) -> dict:
    m = copy.deepcopy(real)
    for a in m['assets']:
        a['status'] = 'requested'
        a['original'] = None
        a['outputs'] = []
        a.pop('processing', None)
        a.pop('rejection', None)
        a.pop('buildError', None)
        if 'faceRect' in a:
            a['faceRect'] = None
        if 'anchors' in a:
            a['anchors'] = {k: None for k in a['anchors']}
    return m


def _setup_root(base: Path, real_master: dict) -> Ctx:
    ctx = Ctx(base)
    ctx.incoming.mkdir(parents=True)
    (ctx.root / 'proto3d/public').mkdir(parents=True)
    ctx.gen.parent.mkdir(parents=True)
    ctx.docs.parent.mkdir(parents=True)
    (ctx.incoming / 'README.md').write_text('受け取り口（selftest）\n', encoding='utf-8')
    ctx.master.write_text(dump_json(_fresh_master(real_master)), encoding='utf-8')
    ctx.gen.write_text(dump_json({'version': 1, 'assets': {}}, indent=4), encoding='utf-8')
    return ctx


def _rgba_u8(alpha: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    out = np.zeros(alpha.shape + (4,), np.uint8)
    out[..., :3] = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    out[..., 3] = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    return out


def _checker(h: int, w: int, sq: int, hi: float = 255.0, lo: float = 204.0) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    return np.where(((((xx // sq) + (yy // sq)) % 2) > 0)[..., None], hi, lo) * np.ones(3)


def _selftest_c(root: Path, real: dict, ok, quiet: list) -> None:
    rng = np.random.default_rng(7)
    rec = asset_by_id(real, 'portrait.ieyasu')['recipe']
    W, H = 1024, 1536
    fa = _figure_alpha(W, H)
    body = np.clip(np.full((H, W, 3), (95, 105, 120), np.float64) + _noise(rng, H, W, 2)[..., None] * 12, 0, 255)

    def cls(arr):
        return classify_alpha(Image.fromarray(arr, 'RGBA' if arr.shape[2] == 4 else 'RGB'), rec)

    # M1：透明の画像の中の、不透明の市松模様（腕と胴の間・外側の帯のほかの背景）
    a, rgb = fa.copy(), body.copy()
    gap = (slice(700, 1000), slice(120, 215))
    a[gap], rgb[gap] = 1.0, _checker(H, W, 16)[gap]
    d, r, _ = cls(_rgba_u8(a, rgb))
    ok(d == 'refuse' and r['reason'] == 'checkerboard' and '範囲' in r['message'],
       f'透明の画像でも、腕と胴の間に描き込まれた市松模様は断る（{r.get("reason")}・{r.get("checkerboardPatch", {}).get("evidencePx")} 画素）')
    reg = region_mask(H, W, rec['alphaCheck']['regions'])
    a = np.where(reg, fa, 1.0)
    rgb = np.where(reg[..., None], body, fa[..., None] * body + (1 - fa[..., None]) * _checker(H, W, 16))
    d, r, _ = cls(_rgba_u8(a, rgb))
    ok(d == 'refuse' and r['reason'] == 'checkerboard' and r['transparentShare'] > 0.1,
       f'外側の帯だけ透明で、ほかの背景が市松模様の物は断る（本物の透明 {r["transparentShare"]:.0%}・{r.get("reason")}）')
    for (hi, lo), sq in (((255, 238), 8), ((255, 230), 24), ((255, 204), 32)):
        a, rgb = fa.copy(), body.copy()
        a[gap], rgb[gap] = 1.0, _checker(H, W, sq, hi, lo)[gap]
        d, r, _ = cls(_rgba_u8(a, rgb))
        ok(d == 'refuse' and r['reason'] == 'checkerboard', f'市松模様（{hi}/{lo}・{sq}px）を断る（{r.get("reason")}）')
    a, rgb = fa.copy(), body.copy()
    a[gap], rgb[gap] = 1.0, _checker(H, W, 16)[gap]
    buf = io.BytesIO()
    Image.fromarray(np.clip(np.round(rgb), 0, 255).astype(np.uint8)).save(buf, 'JPEG', quality=70)
    d, r, _ = cls(_rgba_u8(a, np.asarray(Image.open(buf)).astype(np.float64)))
    ok(d == 'refuse' and r['reason'] == 'checkerboard', f'JPEG で崩れた市松模様も断る（{r.get("reason")}）')
    # 誤検出しない：白っぽい衣（細かいむら・大きなむら）
    for amp, sig in ((8, 1.5), (20, 3)):
        rgb = body.copy()
        rgb[800:, 200:850] = np.clip(230 + _noise(rng, H - 800, 650, sig)[..., None] * amp, 0, 255)
        d, r, _ = cls(_rgba_u8(fa, rgb))
        ok(d == 'alpha', f'白っぽい衣（むら {amp}）を市松模様と取り違えない（{d}・{r.get("checkerboardPatch", {}).get("evidencePx")} 画素）')

    # M2：本物の透明は構図で断らない（注意として記録）。transparentMax 以下を透明に数える。意味のある透明が無い物は断る
    wide = fa.copy()
    wide[int(0.45 * H):, :] = 1.0
    wide[int(0.25 * H):int(0.45 * H), :int(0.12 * W)] = 1.0  # 袖が左の帯にかかる
    d, r, _ = cls(_rgba_u8(wide, body))
    ok(d == 'alpha' and [w_['reason'] for w_ in r['warnings']] == ['composition'] and r['regionTransparentShare'] < rec['alphaCheck']['regionMinShare'],
       f'人物が外側の帯にかかる本物の透明の人物画は受け取り、構図の注意を記録する（外側の透明 {r["regionTransparentShare"]:.0%}）')
    d, r, _ = cls(_rgba_u8(np.maximum(fa, 1 / 255), body))
    ok(d == 'alpha' and r['zeroShare'] == 0 and not r['warnings'], f'背景の不透明度が 1（transparentMax 以下）の物も透明として受け取る（{d}）')
    left = fa.copy()
    left[:, :int(0.12 * W)] = 1.0  # 左の帯が上から下まで不透明（背景が残った）
    left[:int(0.05 * H), :] = 1.0  # 上の帯も不透明
    d, r, _ = cls(_rgba_u8(left, body))
    ok(d == 'refuse' and r['reason'] == 'background-left', f'外側の帯に背景が残った物は断る（外側の透明 {r.get("regionTransparentShare", 0):.0%}・{r.get("reason")}）')
    a = np.ones((H, W))
    a[:70, :] = 0
    d, r, _ = cls(_rgba_u8(a, body))
    ok(d == 'refuse' and r['reason'] == 'alpha-insufficient' and '少なすぎる' in r['message'], f'意味のある透明が無い（上の 5% だけ透明）物は断る（{r.get("reason")}）')
    mag = np.array([254.0, 2.0, 252.0]) + rng.normal(0, 1.5, (H, W, 3))
    comp = wide[..., None] * body + (1 - wide[..., None]) * mag
    d, r, keyed = cls(np.clip(np.round(comp), 0, 255).astype(np.uint8))
    ok(d == 'magenta-key' and [w_['reason'] for w_ in r['warnings']] == ['composition'],
       f'人物が外側の帯にかかる単色マゼンタの背景も色を抜いて受け取り、構図の注意を記録する（{d}・{r.get("reason")}）')

    # 受け取り・加工の流れ（小さい人物画で）
    ctx = _setup_root(root, real)
    w2, h2 = 512, 768
    fa2 = _figure_alpha(w2, h2)
    body2 = np.clip(np.full((h2, w2, 3), (95, 105, 120), np.float64) + _noise(rng, h2, w2, 2)[..., None] * 12, 0, 255)
    v1 = _rgba_u8(fa2, body2)
    Image.fromarray(v1, 'RGBA').save(ctx.incoming / 'portrait_ieyasu.png')
    # 忠勝：袖が外側の帯にかかり、下は消えていく（浮いている）
    fl = fa2.copy()
    fl[int(0.30 * h2):int(0.55 * h2), :int(0.11 * w2)] = 1.0
    fl[int(0.85 * h2):, :] = 0.0
    Image.fromarray(_rgba_u8(fl, body2), 'RGBA').save(ctx.incoming / 'portrait_tadakatsu.png')
    v1_bytes = (ctx.incoming / 'portrait_ieyasu.png').read_bytes()
    rc = cmd_ingest(ctx, ids=['portrait.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    ok(rc == 0 and g['portrait.ieyasu']['status'] == 'received' and g['portrait.tadakatsu']['status'] == 'received', '小さい人物画を 2 枚受け取る')
    ok(sorted(q.name for q in ctx.incoming.iterdir()) == ['README.md'], 'incoming/ には README.md だけが残る（原画は <id>/original.png へ移した）')
    ok((ctx.root / g['portrait.ieyasu']['original']['path']).read_bytes() == v1_bytes, '移した原画は受け取ったままの中身')
    wt = sorted(w_['reason'] for w_ in g['portrait.tadakatsu']['original']['warnings'])
    ok(wt == ['bottom-cut', 'composition'], f'下端がまっすぐな切れ目でない・外側の帯にかかる人物画は、受け取って注意を記録する（{wt}）')
    ok(any('bottom-cut' in x for x in quiet) and any('composition' in x for x in quiet), 'ingest の画面に注意を出す')
    # 値の確かめ（割合・原画の外・原画が無い）
    for key, val in (('eyeY', '0.2'), ('eyeY', '5000'), ('faceX', '-3'), ('eyeY', 'abc')):
        try:
            cmd_set_anchor(ctx, 'portrait.ieyasu', key, val, log=quiet.append)
            ok(False, f'set-anchor {key} {val} は断る')
        except ArtError as e:
            ok(True, f'set-anchor {key} {val} は断る（{e}）')
    try:
        cmd_set_anchor(ctx, 'portrait.ieyasu', 'eyeY', '1', log=quiet.append)
        ok(True, 'set-anchor の原画の範囲の値は受け取る')
    except ArtError as e:
        ok(False, f'set-anchor の原画の範囲の値は受け取る（{e}）')
    # 顔の範囲を胴の中（全部不透明）にする → 透明の層の無い顔
    cmd_set_face_rect(ctx, 'face.ieyasu', [200, 450, 100, 100], log=quiet.append)
    rcb = cmd_build(ctx, ids=['portrait.ieyasu', 'face.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    pi = g['portrait.ieyasu']
    ok(rcb == 1 and pi['status'] == 'received' and pi['outputs'] == [] and 'アンカー' in (pi.get('buildError') or ''),
       f'アンカーが切り詰めた範囲の外なら build は止め、加工版の記録を外し、状態を受け取り済みに戻す（{pi["status"]}）')
    cmd_set_anchor(ctx, 'portrait.ieyasu', 'eyeY', '150', log=quiet.append)
    quiet.clear()
    rcb = cmd_build(ctx, ids=['portrait.ieyasu', 'face.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    ok(rcb == 0 and g['portrait.ieyasu']['status'] == 'built' and 0 < g['portrait.ieyasu']['outputs'][0]['meta']['eyeY'] < 1, 'アンカーを直せば build が通る')
    fo = g['face.ieyasu']
    fdec = Image.open(ctx.public / fo['recipe']['publicFile'])
    ok(fo['status'] == 'built' and fo['processing']['opaque'] and 'A' not in fdec.getbands() and any('全部不透明' in x for x in quiet),
       f'全部不透明の顔は透明の層の無い WebP で作り、そのことを記録する（{fdec.mode}）')
    pt = g['portrait.tadakatsu']['processing']
    ok([w_['reason'] for w_ in pt['warnings']] == ['bottom-cut'] and pt['bottomRowOpaqueShare'] < 0.2,
       f'build も下端の注意を記録する（下端の不透明 {pt["bottomRowOpaqueShare"]}）')
    ok(cmd_check(ctx, log=quiet.append) == 0, 'check が通る（状態と加工版がそろう）')
    # 状態と加工版のずれは check が見つける
    mm = load_master(ctx)
    asset_by_id(mm, 'face.tadakatsu')['status'] = 'built'
    save_master(ctx, mm)
    ok(cmd_check(ctx, log=quiet.append) == 1, '状態が built なのに加工版の記録が無いと check が止まる')
    asset_by_id(mm, 'face.tadakatsu')['status'] = 'requested'
    save_master(ctx, mm)
    cmd_approve(ctx, 'portrait.ieyasu', '確かめ', log=quiet.append)

    # L4：差し替え → 前の原画の座標の faceRect・アンカーを消す。顔は set-face-rect まで作らない
    v2 = v1.copy()
    v2[300, 250, 0] ^= 1
    Image.fromarray(v2, 'RGBA').save(ctx.incoming / 'portrait_ieyasu.png')
    quiet.clear()
    rc = cmd_ingest(ctx, ids=['portrait.ieyasu'], replace=True, log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    pi, fi = g['portrait.ieyasu'], g['face.ieyasu']
    ok(rc == 0 and pi['status'] == 'received' and all(v is None for v in pi['anchors'].values()) and 'review' not in pi,
       '差し替えた人物画は受け取り済みに戻り、前の原画の座標のアンカーと見た目の確認を消す')
    ok(fi['faceRect'] is None and fi['outputs'] == [] and fi['status'] == 'requested', '差し替えた人物画から切り出す顔の faceRect を消す')
    ok(any('anchors-cleared' in x for x in quiet) and any('faceRect-cleared' in x for x in quiet), '差し替えで消した値を画面に出す')
    ok(any(w_['reason'] == 'anchors-cleared' for w_ in pi['original']['warnings']) and pi['original']['replaced']['sha256'] == sha256_bytes(v1_bytes),
       '差し替えたこと・消したことを原画の記録に残す')
    quiet.clear()
    rcb = cmd_build(ctx, ids=['portrait.ieyasu', 'face.ieyasu'], prune=True, log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    gen = json.loads(ctx.gen.read_text(encoding='utf-8'))
    ok(rcb == 0 and g['portrait.ieyasu']['status'] == 'built' and 'face.ieyasu' not in gen['assets'] and g['face.ieyasu']['status'] == 'requested'
       and not (ctx.public / fo['recipe']['publicFile']).exists(),
       '差し替えの後の build：人物画は作り直し、顔は faceRect を決め直すまで作らない（前の顔のファイルは --prune で消す）')
    # L4：差し替えを断る → rejected。前の原画からも作らない（build は rejected を作らない）
    built_sha = g['portrait.ieyasu']['original']['sha256']
    Image.fromarray(np.full((h2, w2, 3), 200, np.uint8), 'RGB').save(ctx.incoming / 'portrait_ieyasu.png')
    rc = cmd_ingest(ctx, ids=['portrait.ieyasu'], replace=True, log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    pi = g['portrait.ieyasu']
    ok(rc == 1 and pi['status'] == 'rejected' and pi['outputs'] == [] and pi['original']['sha256'] == built_sha and (ctx.incoming / 'portrait_ieyasu.png').exists(),
       '差し替えを断ると作り直し待ち（rejected）・加工版の記録を外す・前の原画は残す・断った物は incoming/ に残す')
    rcb = cmd_build(ctx, prune=True, log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctx)['assets']}
    gen = json.loads(ctx.gen.read_text(encoding='utf-8'))
    ok(g['portrait.ieyasu']['status'] == 'rejected' and g['portrait.ieyasu']['outputs'] == [] and 'portrait.ieyasu' not in gen['assets']
       and not (ctx.public / g['portrait.ieyasu']['recipe']['publicFile']).exists(),
       'build は作り直し待ち（rejected）の物を、前の原画からも作らない')
    ok(cmd_check(ctx, log=quiet.append) == 0, '断った後も check が通る')
    # 受け取り済みの原画と同じ物を置けば、その原画に戻る
    (ctx.incoming / 'portrait_ieyasu.png').write_bytes((ctx.root / pi['original']['path']).read_bytes())
    rc = cmd_ingest(ctx, ids=['portrait.ieyasu'], log=quiet.append)
    pi = asset_by_id(load_master(ctx), 'portrait.ieyasu')
    ok(rc == 0 and pi['status'] == 'received' and pi['rejection'] is None and not (ctx.incoming / 'portrait_ieyasu.png').exists(),
       '差し替えを断った後に受け取り済みの原画と同じ物を置くと、その原画に戻る')
    docs = ctx.docs.read_text(encoding='utf-8')
    ok('注意（bottom-cut）' in docs and '注意（composition）' in docs, 'docs/art-assets.md に注意が載る')

    # 全部透明の人物画は断る（落ちない）。同じ ingest で先に受け取った物は記録に残る
    ctxe = _setup_root(root.with_name(root.name + '-empty'), real)
    Image.fromarray(v1, 'RGBA').save(ctxe.incoming / 'portrait_ieyasu.png')
    Image.fromarray(np.zeros((h2, w2, 4), np.uint8), 'RGBA').save(ctxe.incoming / 'portrait_tadakatsu.png')
    rc = cmd_ingest(ctxe, ids=['portrait.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctxe)['assets']}
    ok(rc == 1 and g['portrait.ieyasu']['status'] == 'received' and g['portrait.tadakatsu']['status'] == 'rejected'
       and g['portrait.tadakatsu']['rejection']['reason'] == 'empty'
       and sorted(q.name for q in ctxe.incoming.iterdir()) == ['README.md', 'portrait_tadakatsu.png'],
       f'全部透明の人物画は断り（{(g["portrait.tadakatsu"].get("rejection") or {}).get("reason")}）、先に受け取った人物画は記録に残る')
    # 途中で止まっても、移した原画が記録に無いままにならない（incoming/ の物は記録を保存した後に消す）
    ctxi = _setup_root(root.with_name(root.name + '-interrupt'), real)
    Image.fromarray(v1, 'RGBA').save(ctxi.incoming / 'portrait_ieyasu.png')
    Image.fromarray(v1, 'RGBA').save(ctxi.incoming / 'portrait_tadakatsu.png')
    real_classify, calls = globals()['classify_alpha'], []

    def stop_second(img, recipe):
        calls.append(1)
        if len(calls) == 2:
            raise KeyboardInterrupt
        return real_classify(img, recipe)
    globals()['classify_alpha'] = stop_second
    try:
        cmd_ingest(ctxi, ids=['portrait.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
        stopped = False
    except KeyboardInterrupt:
        stopped = True
    finally:
        globals()['classify_alpha'] = real_classify
    g = {a_['id']: a_ for a_ in load_master(ctxi)['assets']}
    ok(stopped and g['portrait.ieyasu']['status'] == 'received' and (ctxi.root / g['portrait.ieyasu']['original']['path']).exists()
       and g['portrait.tadakatsu']['status'] == 'requested'
       and sorted(q.name for q in ctxi.incoming.iterdir()) == ['README.md', 'portrait_tadakatsu.png'],
       '2 枚目の途中で止まっても、1 枚目は記録に残り、2 枚目は incoming/ に残る')
    rc = cmd_ingest(ctxi, ids=['portrait.ieyasu', 'portrait.tadakatsu'], log=quiet.append)
    g = {a_['id']: a_ for a_ in load_master(ctxi)['assets']}
    ok(rc == 0 and g['portrait.tadakatsu']['status'] == 'received' and sorted(q.name for q in ctxi.incoming.iterdir()) == ['README.md']
       and cmd_check(ctxi, log=quiet.append) == 0,
       '止まった後の ingest のやり直しで残りを受け取り、check が通る')


def cmd_selftest(ctx_real: Ctx, log=print) -> int:
    real = load_master(ctx_real)
    fails: list[str] = []
    quiet: list[str] = []

    def ok(cond, what):
        log(('  PASS ' if cond else '  FAIL ') + what)
        if not cond:
            fails.append(what)

    with tempfile.TemporaryDirectory(prefix='art-selftest-') as tmp:
        tmp = Path(tmp)
        # ---- A：受け取る・色を抜く・直す
        ctx = _setup_root(tmp / 'A', real)
        info = _make_inputs(ctx.incoming, 'A')
        before = {q.name: q.read_bytes() for q in ctx.incoming.iterdir()}
        rc = cmd_ingest(ctx, log=quiet.append)
        m = load_master(ctx)
        g = {a['id']: a for a in m['assets']}
        ok(rc == 1, 'ingest は断った物があると 1 を返す（透ける地面）')
        pi, pt = g['portrait.ieyasu'], g['portrait.tadakatsu']
        ok(pi['status'] == 'received' and pi['original']['alphaSource'] == 'alpha', '本物の透明の人物画を受け取る')
        inc = before['portrait_ieyasu.png']
        ok((ctx.root / pi['original']['path']).read_bytes() == inc, '原画は受け取ったままの中身で保管する')
        ok(sorted(q.name for q in ctx.incoming.iterdir()) == ['README.md', 'tex_plains_road.png'],
           f'受け取った原画は incoming/ から移す（2 か所に置かない。断った物だけ残る：{sorted(q.name for q in ctx.incoming.iterdir())}）')
        ok(all((ctx.root / a['original']['path']).read_bytes() == before[a['incoming']] for a in g.values() if a.get('original')),
           '移した原画は全部、受け取ったままの中身')
        ok(pi['original']['sha256'] == sha256_bytes(inc) and pi['original']['bytes'] == len(inc), '原画の sha256・容量を記録する')
        ok(pt['status'] == 'received' and pt['original']['alphaSource'] == 'magenta-key', '単色マゼンタの背景は色を抜いて受け取り、記録する')
        ok(any('マゼンタ' in n for n in pt['original']['notes']), 'マゼンタを抜いたことを原画の記録に書く')
        ok(g['bg.council']['status'] == 'received' and g['bg.council.front']['original']['alphaSource'] == 'alpha', '背景（不透明）と手前の幕（透明）を受け取る')
        ok(g['tex.plains.road']['status'] == 'rejected' and g['tex.plains.road']['rejection']['reason'] == 'not-opaque', '透ける地面の素材は断る')
        ok(g['tex.plains.forest']['status'] == 'requested' and g['tex.plains.forest']['original'] is None, '届いていない物は依頼済みのまま')
        ok(not (ctx.src / 'tex.plains.road').exists() or not any((ctx.src / 'tex.plains.road').glob('original.*')), '断った物は保管しない')
        # 色を抜いた透明が、合成に使った本当の透明に近い・縁に色かぶりが残らない
        keyed = source_rgba(ctx, pt)
        err = np.abs(keyed[..., 3].astype(np.float64) / 255.0 - info['truth']['alpha'])
        tedge = (info['truth']['alpha'] > 0.02) & (info['truth']['alpha'] < 0.98)
        ok(float(err.mean()) < 0.005 and float(err[tedge].mean()) < 0.08,
           f'色を抜いた透明が本当の透明に近い（全体の平均の差 {err.mean():.4f}・縁の平均の差 {err[tedge].mean():.3f}）')
        a8 = keyed[..., 3]
        edge = (a8 > 0) & (a8 < 255)
        ok(edge.sum() > 1000, f'縁がなめらか（半透明の画素 {int(edge.sum())}）')
        k = keyed.astype(np.int16)
        spill = np.minimum(k[..., 0], k[..., 2]) - k[..., 1]
        ok(int(spill[a8 > 0].max()) <= 24, f'縁にマゼンタの色かぶりが残らない（最大 {int(spill[a8 > 0].max())}）')
        # 同じ物をもう一度：変わらない（incoming/ の同じ物は消す）／違う物：--replace なしでは断る（incoming/ に残す）
        (ctx.incoming / 'portrait_ieyasu.png').write_bytes(inc)
        rc2 = cmd_ingest(ctx, ids=['portrait.ieyasu'], log=quiet.append)
        ok(rc2 == 0 and load_master(ctx)['assets'][0]['original']['sha256'] == pi['original']['sha256'], '同じ原画をもう一度 ingest しても変わらない')
        ok(not (ctx.incoming / 'portrait_ieyasu.png').exists(), '受け取り済みと同じ物は incoming/ から消す（保管の原画と同じ中身）')
        arr = np.asarray(Image.open(io.BytesIO(inc)).convert('RGBA')).copy()
        arr[700, 500, 0] ^= 1
        Image.fromarray(arr, 'RGBA').save(ctx.incoming / 'portrait_ieyasu.png')
        rc3 = cmd_ingest(ctx, ids=['portrait.ieyasu'], log=quiet.append)
        ok(rc3 == 1 and load_master(ctx)['assets'][0]['original']['sha256'] == pi['original']['sha256'], '違う原画は --replace なしでは差し替えない')
        ok((ctx.incoming / 'portrait_ieyasu.png').exists(), '差し替えない違う原画は incoming/ に残す')
        (ctx.incoming / 'portrait_ieyasu.png').unlink()

        # 顔の範囲と目の高さ（原画の座標）を決めて build
        cmd_set_face_rect(ctx, 'face.ieyasu', [370, 90, 310, 300], log=quiet.append)
        cmd_set_face_rect(ctx, 'face.tadakatsu', [370, 90, 300, 320], log=quiet.append)
        cmd_set_anchor(ctx, 'portrait.ieyasu', 'eyeY', '307', log=quiet.append)
        rcb = cmd_build(ctx, log=quiet.append)
        m = load_master(ctx)
        g = {a['id']: a for a in m['assets']}
        ok(rcb == 0, 'build が通る（' + ' / '.join(x for x in quiet if '失敗' in x) + '）')
        gen = json.loads(ctx.gen.read_text(encoding='utf-8'))
        ok(set(gen['assets']) == {'portrait.ieyasu', 'portrait.tadakatsu', 'face.ieyasu', 'face.tadakatsu', 'bg.council', 'bg.council.front', 'tex.plains.grass', 'tex.plains.dirt'},
           'manifest.gen.json には作った物だけが載る')
        ok(all(set(e) <= set(GEN_KEYS) for e in gen['assets'].values()), 'manifest.gen.json は file・w・h・kind・bytes・sha256・meta だけ')
        for aid, e in gen['assets'].items():
            p = ctx.public / e['file']
            data = p.read_bytes() if p.exists() else b''
            a = g[aid]
            ok(len(data) == e['bytes'] and sha256_bytes(data) == e['sha256'] and len(data) <= a['recipe']['capBytes'], f'{aid}：加工版がある・sha256 が合う・上限 {a["recipe"]["capBytes"]} 以下（{len(data)}）')
            dec = Image.open(io.BytesIO(data))
            ok(dec.format == 'WEBP' and dec.size == (e['w'], e['h']), f'{aid}：WebP で寸法が記録どおり {dec.size}')
            want_alpha = a['kind'] in ('portrait', 'face', 'overlay')
            ok(('A' in dec.getbands()) == want_alpha, f'{aid}：透明の有無が種類どおり（{dec.mode}）')
        po = g['portrait.ieyasu']['outputs'][0]
        ok(po['w'] < 1024 and po['h'] < 1536, f'人物画は透明な余白を切る（{po["w"]}×{po["h"]}）')
        dec = np.asarray(Image.open(ctx.public / gen['assets']['portrait.ieyasu']['file']).convert('RGBA'))
        ok(float((dec[-1, :, 3] > 128).mean()) > 0.3, '人物画の下端（体の切れ目）は切らない')
        box = g['portrait.ieyasu']['processing']['trimBox']
        ok(abs(po['meta']['eyeY'] - (307 - box[1]) / (box[3] - box[1])) < 1e-3, f'目の高さを加工版の割合に直して meta に入れる（{po["meta"]["eyeY"]}）')
        src_full = source_rgba(ctx, g['portrait.ieyasu'])
        ok(np.array_equal(dec[..., 3], src_full[box[1]:box[3], box[0]:box[2], 3]), '人物画の透明は劣化しない（加工版の透明 = 原画の透明）')
        ok(not ((dec[..., 3] > 0) & (dec[..., 3] <= 8)).any(), '不透明度 1〜8 のかすかな所は加工版で完全に透明にする（うっすら残った背景を出さない）')
        fo = g['face.ieyasu']['outputs'][0]
        ok((fo['w'], fo['h']) == (256, 256) and fo['sourceSha256'] == g['portrait.ieyasu']['original']['sha256'], '顔は同じ原画から切り出した 256×256')
        ok(g['face.tadakatsu']['processing']['squareRect'][2] == 320, '顔の範囲は長い辺に合わせて正方形にする')
        ok(g['bg.council.front']['outputs'][0]['w'] == g['bg.council']['outputs'][0]['w'], '手前の幕は背景と同じ大きさ')
        tg = g['tex.plains.grass']['processing']
        ok(tg['lightingRangeAfter'] < 0.5 * tg['lightingRangeBefore'], f'焼き込まれた明暗のむらをならす（{tg["lightingRangeBefore"]} → {tg["lightingRangeAfter"]}）')
        ok(tg['seamFixed'] and tg['seamAfter']['ratio'] < g['tex.plains.grass']['recipe']['seamless']['threshold'] < tg['seamBefore']['ratio'],
           f'継ぎ目を直す（{tg["seamBefore"]["ratio"]} → {tg["seamAfter"]["ratio"]}・{tg["seamFixed"]}）')
        orig = np.asarray(Image.open(ctx.root / g['tex.plains.grass']['original']['path']).convert('RGB')).reshape(-1, 3).mean(axis=0)
        ok(np.abs(np.array(tg['meanRGB']) - orig).max() < 6, f'平均の色を保つ（{tg["meanRGB"]} ≒ {[int(v) for v in orig]}）')
        def detail(path):
            L = np.asarray(Image.open(path).convert('L')).astype(np.float64)
            return float((L - blur_reflect(L, 4)).std())
        d0, d1 = detail(ctx.root / g['tex.plains.grass']['original']['path']), detail(ctx.public / gen['assets']['tex.plains.grass']['file'])
        ok(d1 > 0.75 * d0, f'直しても細かい模様のコントラストが消えない（{d0:.2f} → {d1:.2f}）')
        td = g['tex.plains.dirt']['processing']
        ok(td['seamFixed'] == [], f'初めから継ぎ目のない地面は継ぎ目を直さない（{td["seamBefore"]["ratio"]}）')
        ok(gen['assets']['tex.plains.grass']['meta'] == {'tileMeters': 8} and g['tex.plains.grass']['recipe']['mapType'] == 'albedo', '地面の素材は 1 枚 8m 四方の色の画像（法線・粗さとは称さない）')
        # check・同じ入力から同じ出力・壊れた加工版は check で見つかる
        ok(cmd_check(ctx, log=quiet.append) == 0, 'check が通る')
        ok(cmd_check(ctx, strict=True, log=quiet.append) == 1, 'check --strict は、見た目の確認と利用条件の確認が無いと通らない')
        ms = load_master(ctx)
        for a in ms['assets']:
            if a.get('outputs'):
                a['status'] = 'approved'
                a['terms']['confirmedByUser'] = True
        ms['terms']['confirmedByUser'] = True
        save_master(ctx, ms)
        ok(cmd_check(ctx, strict=True, log=quiet.append) == 0, 'check --strict は、見た目の確認と利用条件の確認がそろえば通る')
        ms['terms']['confirmedByUser'] = None
        for a in ms['assets']:
            if a.get('outputs'):
                a['status'] = 'built'
                a['terms']['confirmedByUser'] = None
        save_master(ctx, ms)
        try:
            cmd_approve(ctx, 'tex.plains.forest', 'x', log=quiet.append)
            ok(False, '加工版の無い物は確認済みにできない')
        except ArtError:
            ok(True, '加工版の無い物は確認済みにできない')
        cmd_approve(ctx, 'bg.council', '確かめ', log=quiet.append)
        ok(asset_by_id(load_master(ctx), 'bg.council')['status'] == 'approved', 'approve で確認済みになる')
        shas = {aid: e['sha256'] for aid, e in gen['assets'].items()}
        cmd_build(ctx, log=quiet.append)
        gen2 = json.loads(ctx.gen.read_text(encoding='utf-8'))
        ok(shas == {aid: e['sha256'] for aid, e in gen2['assets'].items()}, '同じ原画からは同じ加工版になる（2 回目の build の sha256 が同じ）')
        p = ctx.public / gen['assets']['face.ieyasu']['file']
        keep = p.read_bytes()
        p.write_bytes(keep[:-1] + bytes([keep[-1] ^ 0xFF]))
        ok(cmd_check(ctx, log=quiet.append) == 1, '加工版が記録と違うと check が止まる')
        p.write_bytes(keep)
        stray = ctx.public / 'art/battle/stray.webp'
        stray.write_bytes(keep)
        ok(cmd_check(ctx, log=quiet.append) == 1, '一覧に無いファイルが公開の置き場にあると check が止まる')
        stray.unlink()
        docs = ctx.docs.read_text(encoding='utf-8')
        ok(all(f'`{a["id"]}`' in docs for a in m['assets']) and '未確認' in docs, 'docs/art-assets.md に全部の素材と利用条件の状態が載る')
        # 上限に収まらないと止まる
        try:
            noisy = Image.fromarray(np.random.default_rng(1).integers(0, 255, (512, 512, 3), dtype=np.uint8), 'RGB')
            encode_webp(noisy, {'quality': 85, 'minQuality': 75, 'step': 5}, 10000)
            ok(False, '上限に収まらないと止まる')
        except ArtError:
            ok(True, '上限に収まらないと止まる')

        # ---- B：断る（市松模様・透明なしの単色の背景）
        quiet.clear()
        ctxb = _setup_root(tmp / 'B', real)
        _make_inputs(ctxb.incoming, 'B')
        rcb = cmd_ingest(ctxb, log=quiet.append)
        mb = {a['id']: a for a in load_master(ctxb)['assets']}
        ok(rcb == 1, 'ingest は断った物があると 1 を返す')
        r1 = mb['portrait.ieyasu'].get('rejection') or {}
        ok(mb['portrait.ieyasu']['status'] == 'rejected' and r1.get('reason') == 'checkerboard', f'描き込まれた市松模様は断る（{r1.get("reason")}・{(r1.get("checks") or {}).get("alpha", {}).get("checkerboard")}）')
        ok('市松模様' in r1.get('message', ''), '断る理由をはっきり書く（市松模様）')
        r2 = mb['portrait.tadakatsu'].get('rejection') or {}
        ok(mb['portrait.tadakatsu']['status'] == 'rejected' and r2.get('reason') == 'no-alpha', f'透明も単色マゼンタも無い人物画は断る（{r2.get("reason")}）')
        r3 = mb['bg.council.front'].get('rejection') or {}
        ok(r3.get('reason') == 'checkerboard', f'手前の幕の市松模様も断る（{r3.get("reason")}）')
        ok(not list(ctxb.src.glob('*/original.*')), '断った物は保管しない')
        ok(json.loads(ctxb.gen.read_text(encoding='utf-8')) == {'version': 1, 'assets': {}}, '何も作っていなければ manifest.gen.json は空のまま')
        # 誤検出しない：本物の透明の画像・マゼンタの画像は市松模様と言わない
        okimg = Image.open(ctx.root / g['portrait.tadakatsu']['original']['path'])
        dec_, rep_, _ = classify_alpha(okimg, asset_by_id(real, 'portrait.tadakatsu')['recipe'])
        ok(dec_ == 'magenta-key' and not rep_['checkerboard']['found'], 'マゼンタの背景を市松模様と取り違えない')
        light = np.full((1536, 1024, 3), 236, np.uint8)
        light += np.random.default_rng(3).integers(0, 4, light.shape, dtype=np.uint8)
        dec_, rep_, _ = classify_alpha(Image.fromarray(light, 'RGB'), asset_by_id(real, 'portrait.ieyasu')['recipe'])
        ok(dec_ == 'refuse' and rep_['reason'] == 'no-alpha', '明るい単色の背景を市松模様と取り違えない（透明が無いので断る理由は no-alpha）')

        # ---- C：透明の画像の中の市松模様・構図の注意・下端の切れ目・差し替え・状態のそろい（小さい画像で）
        quiet.clear()
        _selftest_c(tmp / 'C', real, ok, quiet)
    if fails:
        log(f'selftest：{len(fails)} 件の失敗')
        return 1
    log('selftest：全部通った')
    return 0


# ---------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='生成イラスト素材の受け取り・加工・確かめ（Version 22〜）')
    ap.add_argument('--repo', default=str(REPO), help=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('ingest', help='incoming/ の原画を検査して保管する')
    p.add_argument('--id', action='append')
    p.add_argument('--replace', action='store_true', help='受け取り済みの原画を差し替える')
    p = sub.add_parser('build', help='作り方どおりに加工版を作る')
    p.add_argument('--id', action='append')
    p.add_argument('--prune', action='store_true', help='一覧に無い proto3d/public/art のファイルを消す')
    p = sub.add_parser('check', help='加工版が一覧どおりか確かめる')
    p.add_argument('--strict', action='store_true', help='公開の前：見た目の確認と利用条件の確認も求める')
    sub.add_parser('docs', help='docs/art-assets.md を作り直す')
    p = sub.add_parser('set-face-rect', help='顔の範囲（人物画の原画の画素の座標）')
    p.add_argument('id')
    p.add_argument('rect', nargs=4, type=int, metavar=('X', 'Y', 'W', 'H'))
    p = sub.add_parser('approve', help='ゲームの画面で見た目と操作を確かめた印を付ける（check --strict の条件）')
    p.add_argument('id')
    p.add_argument('note', help='どの画面・倍率で何を確かめたか')
    p = sub.add_parser('set-anchor', help='人物画のアンカー（eyeY など。原画の画素の座標）')
    p.add_argument('id')
    p.add_argument('key')
    p.add_argument('value')
    sub.add_parser('selftest', help='合成した入力で確かめる')
    args = ap.parse_args(argv)
    ctx = Ctx(Path(args.repo))
    try:
        if args.cmd == 'ingest':
            return cmd_ingest(ctx, args.id, args.replace)
        if args.cmd == 'build':
            return cmd_build(ctx, args.id, args.prune)
        if args.cmd == 'check':
            return cmd_check(ctx, args.strict)
        if args.cmd == 'docs':
            return cmd_docs(ctx)
        if args.cmd == 'set-face-rect':
            return cmd_set_face_rect(ctx, args.id, args.rect)
        if args.cmd == 'approve':
            return cmd_approve(ctx, args.id, args.note)
        if args.cmd == 'set-anchor':
            return cmd_set_anchor(ctx, args.id, args.key, args.value)
        if args.cmd == 'selftest':
            return cmd_selftest(ctx)
    except ArtError as e:
        print(f'止めました：{e}', file=sys.stderr)
        return 2
    return 2


if __name__ == '__main__':
    sys.exit(main())
