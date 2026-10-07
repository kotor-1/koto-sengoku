#!/usr/bin/env python3
"""
開発用の仮の画像（TEST の模様）を proto3d/dev-art/ に作る。配置と動作の確かめだけに使い、見た目の素材ではない。

    python3 -I proto3d/tools/make-dev-art.py

- 本物と同じ ID・種類・原画の大きさ（人物画 1024×1536 RGBA・背景 1536×1024・手前の幕 1536×1024 RGBA・地面 1024×1024）の
  模様を一時フォルダの incoming/ に置き、art-build.py の ingest → build をそのまま通す（透明の検査・余白の切り詰め・
  同じ原画からの顔の切り出し・地面の処理・WebP の上限）。できた加工版と一覧（manifest.gen.json と同じ形）を dev-art/ に写す。
- 模様は単純な灰色の形・格子・「TEST」の文字・目印の線だけ。顔や風景は描かない（生成画像の代わりにしない）。
- proto3d/public/ の外に置くので公開版に入らない。開発サーバーで ?artFixture=1 を付けたときだけ registry が読む。
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = REPO / 'proto3d/dev-art'
SIZE_BUDGET = 600 * 1024

_spec = importlib.util.spec_from_file_location('art_build', HERE / 'art-build.py')
ab = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ab)


def font(size: int, bold: bool = True):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def text_c(d: ImageDraw.ImageDraw, xy, s: str, size: int, fill, stroke=None):
    d.text(xy, s, font=font(size), fill=fill, anchor='mm', stroke_width=(3 if stroke else 0), stroke_fill=stroke)


# ---------------------------------------------------------------- 人物画の TEST（単純な灰色の形・格子・目印。顔は描かない）

W_P, H_P = 1024, 1536
HEAD = (0.53, 0.19, 0.145, 0.13)  # 中心 x, y・半径 x, y（幅・高さに対する割合）。頭頂は上から 6%、目の高さは 20%
EYE_Y = 0.20


def portrait_fixture(aid: str, name: str, tint) -> Image.Image:
    W, H, S = W_P, H_P, 2
    m = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(m)
    cx, cy, rx, ry = HEAD
    d.ellipse([(cx - rx) * W * S, (cy - ry) * H * S, (cx + rx) * W * S, (cy + ry) * H * S], fill=255)
    d.rectangle([0.47 * W * S, 0.30 * H * S, 0.59 * W * S, 0.40 * H * S], fill=255)
    d.polygon([(0.17 * W * S, H * S), (0.19 * W * S, 0.47 * H * S), (0.27 * W * S, 0.40 * H * S),
               (0.79 * W * S, 0.40 * H * S), (0.86 * W * S, 0.47 * H * S), (0.88 * W * S, H * S)], fill=255)
    ey = int(EYE_Y * H)
    d.rectangle([(cx - rx) * W * S - 40 * S, (ey - 3) * S, (cx + rx) * W * S + 40 * S, (ey + 3) * S], fill=255)  # 目の高さの線は形の外へ少し出す
    mask = m.resize((W, H), Image.LANCZOS)

    rgb = Image.new('RGB', (W, H), tint)
    d = ImageDraw.Draw(rgb)
    dark = tuple(max(0, c - 34) for c in tint)
    for x in range(0, W, 64):
        d.line([(x, 0), (x, H)], fill=dark, width=2)
    for y in range(0, H, 64):
        d.line([(0, y), (W, y)], fill=dark, width=2)
    d.rectangle([(cx - rx) * W - 40, ey - 3, (cx + rx) * W + 40, ey + 3], fill=(220, 40, 40))
    text_c(d, ((cx - 0.06) * W, ey - 24), 'EYE 20%', 26, (255, 230, 230), (90, 20, 20))
    text_c(d, (cx * W, (cy - 0.07) * H), name, 30, (255, 255, 255), (40, 40, 40))
    text_c(d, (cx * W, (cy + 0.075) * H), 'TEST', 54, (255, 255, 255), (40, 40, 40))
    text_c(d, ((cx + 0.075) * W, (cy + 0.03) * H), '→', 56, (255, 255, 255), (40, 40, 40))  # 向き（画面の右）
    text_c(d, (0.53 * W, 0.62 * H), 'TEST', 210, (255, 255, 255), (40, 40, 40))
    text_c(d, (0.53 * W, 0.52 * H), aid, 40, (240, 240, 240), (40, 40, 40))
    text_c(d, (0.53 * W, 0.70 * H), 'fixture only - not art', 34, (240, 240, 240), (40, 40, 40))
    y80 = int(0.80 * H)
    for x in range(int(0.18 * W), int(0.88 * W), 40):
        d.line([(x, y80), (x + 22, y80)], fill=(235, 200, 60), width=5)
    text_c(d, (0.53 * W, y80 + 34), 'LOW 20% (dialog may cover)', 30, (235, 200, 60), (40, 40, 40))
    text_c(d, (0.53 * W, H - 40), 'BOTTOM CUT', 34, (255, 255, 255), (40, 40, 40))
    out = rgb.convert('RGBA')
    out.putalpha(mask)
    return out


def face_rect() -> list[int]:
    cx, cy = HEAD[0] * W_P, HEAD[1] * H_P
    side = 440
    return [int(round(cx - side / 2)), int(round(cy - side / 2)), side, side]


# ---------------------------------------------------------------- 背景の TEST（安全な範囲の線）

def background_fixture() -> Image.Image:
    W, H = 1536, 1024
    im = Image.new('RGB', (W, H), (88, 94, 104))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W // 3, H], fill=(98, 92, 112))
    d.rectangle([0, 0, W, int(0.20 * H)], fill=(58, 62, 72))
    for x in range(0, W, 64):
        d.line([(x, 0), (x, H)], fill=(112, 118, 130), width=1 if x % 256 else 3)
    for y in range(0, H, 64):
        d.line([(0, y), (W, y)], fill=(112, 118, 130), width=1 if y % 256 else 3)
    yel = (232, 200, 64)
    for f, label in ((0.18, 'SAFE 18% (may be cut above)'), (0.82, 'SAFE 82% (may be cut below)')):
        y = int(f * H)
        d.line([(0, y), (W, y)], fill=yel, width=4)
        text_c(d, (W * 0.5, y + (-22 if f < 0.5 else 22)), label, 26, yel, (30, 30, 30))
    y20 = int(0.20 * H)
    d.line([(0, y20), (W, y20)], fill=(120, 200, 255), width=3)
    text_c(d, (W * 0.5, y20 * 0.45), 'TOP 20%: header text zone (keep mid/dark)', 30, (200, 230, 255), (30, 30, 30))
    d.line([(W // 3, 0), (W // 3, H)], fill=yel, width=4)
    text_c(d, (W / 6, H * 0.5), 'LEFT 1/3', 44, yel, (30, 30, 30))
    text_c(d, (W / 6, H * 0.5 + 48), 'portrait zone', 30, yel, (30, 30, 30))
    bx = [int(0.62 * W), int(0.30 * H), int(0.97 * W), int(0.75 * H)]
    d.rectangle(bx, outline=yel, width=4)
    text_c(d, ((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2), 'RIGHT CENTRE: choices', 30, yel, (30, 30, 30))
    text_c(d, (W * 0.48, H * 0.5), 'TEST', 220, (255, 255, 255), (30, 30, 30))
    text_c(d, (W * 0.48, H * 0.66), 'bg.council 1536x1024 - fixture only, not art', 30, (235, 235, 235), (30, 30, 30))
    for (x, y, s) in ((70, 30, '(0,0)'), (W - 110, 30, f'({W},0)'), (90, H - 30, f'(0,{H})'), (W - 130, H - 30, f'({W},{H})')):
        text_c(d, (x, y), s, 24, (235, 235, 235), (30, 30, 30))
    return im


def overlay_fixture() -> Image.Image:
    W, H = 1536, 1024
    rgb = Image.new('RGB', (W, H), (70, 52, 40))
    d = ImageDraw.Draw(rgb)
    bar = int(0.10 * W)
    for y in (int(0.30 * H), int(0.40 * H)):
        d.rectangle([0, y, W, y + 26], fill=(20, 18, 16))
    for x0, lab in ((0, 'FRONT L'), (W - bar, 'FRONT R')):
        for i, s in enumerate((lab, 'TEST')):
            text_c(d, (x0 + bar / 2, H * 0.6 + i * 48), s, 30, (255, 255, 255), (20, 20, 20))
    a = np.zeros((H, W), np.uint8)
    ramp = np.clip((bar - np.arange(W)) / 14.0, 0, 1)  # 内側の縁は 14px でなめらかに透明へ
    a[:] = np.round(np.maximum(ramp, ramp[::-1]) * 255).astype(np.uint8)[None, :]
    out = rgb.convert('RGBA')
    out.putalpha(Image.fromarray(a, 'L'))
    return out


# ---------------------------------------------------------------- 地面の TEST（番号のます。1 枚 = tileMeters 四方を 8×8）

def texture_fixture(prefix: str, tint) -> Image.Image:
    N, C = 1024, 128
    im = Image.new('RGB', (N, N), tint)
    d = ImageDraw.Draw(im)
    line = tuple(max(0, c - 40) for c in tint)
    for k in range(8):
        # ますの境目の線は、上下左右につなげても続くように端をまたいで描く（k=0 は 1023 と 0）
        for x in (k * C - 1, k * C):
            x %= N
            d.line([(x, 0), (x, N)], fill=line, width=1)
            d.line([(0, x), (N, x)], fill=line, width=1)
    light = tuple(min(255, c + 70) for c in tint)
    for r in range(8):
        for c in range(8):
            n = r * 8 + c + 1
            cx, cy = c * C + C / 2, r * C + C / 2
            text_c(d, (cx, cy - 10), f'{prefix}{n}', 34, light)
            text_c(d, (cx, cy + 26), 'TEST', 18, light)
    text_c(d, (22, 26), '↑', 36, light)  # 画像の上（左上のます）
    return im


TEX = {
    'tex.plains.grass': ('G', (104, 122, 84)),
    'tex.plains.dirt': ('D', (138, 122, 98)),
    'tex.plains.road': ('R', (150, 146, 136)),
    'tex.plains.forest': ('F', (84, 88, 66)),
}


# ---------------------------------------------------------------- 本物と同じ加工の道を通す

def main() -> int:
    real = ab.load_master(ab.Ctx(REPO))
    with tempfile.TemporaryDirectory(prefix='dev-art-') as tmp:
        ctx = ab._setup_root(Path(tmp), real)
        m = ab.load_master(ctx)
        src = {
            'portrait.ieyasu': portrait_fixture('portrait.ieyasu', 'IEYASU', (122, 126, 134)),
            'portrait.tadakatsu': portrait_fixture('portrait.tadakatsu', 'TADAKATSU', (112, 128, 116)),
            'bg.council': background_fixture(),
            'bg.council.front': overlay_fixture(),
        }
        for aid, (p, tint) in TEX.items():
            src[aid] = texture_fixture(p, tint)
        for a in m['assets']:
            if a['id'] in src:
                src[a['id']].save(ctx.incoming / a['incoming'])
            if a['kind'] == 'face':
                a['faceRect'] = face_rect()
            if a['kind'] == 'portrait':
                a['anchors'] = {'eyeY': round(EYE_Y * H_P, 1), 'faceX': round(HEAD[0] * W_P, 1)}
        ab.save_master(ctx, m)
        log: list[str] = []
        rc = ab.cmd_ingest(ctx, log=log.append) or ab.cmd_build(ctx, log=log.append)
        print('\n'.join(log))
        if rc:
            print('make-dev-art：ingest/build が通らなかった', file=sys.stderr)
            return 1
        gen = json.loads(ctx.gen.read_text(encoding='utf-8'))
        if set(gen['assets']) != {a['id'] for a in m['assets']}:
            print(f'make-dev-art：全部の ID がそろわない {sorted(gen["assets"])}', file=sys.stderr)
            return 1
        if (OUT / 'art').exists():
            shutil.rmtree(OUT / 'art')
        for e in gen['assets'].values():
            dst = OUT / e['file']
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ctx.public / e['file'], dst)
        ab.write_text_if_changed(OUT / 'manifest.json', ab.dump_json(gen, indent=4))
        mm = {a['id']: a for a in ab.load_master(ctx)['assets']}
    total = sum(e['bytes'] for e in gen['assets'].values())
    rows = []
    for aid, e in gen['assets'].items():
        rows.append(f'| `{aid}` | {e["kind"]} | `{e["file"]}` | {e["w"]}×{e["h"]} | {e["bytes"]:,} | {json.dumps(e.get("meta") or {}, ensure_ascii=False)} |')
    tg = mm['tex.plains.grass']['processing']
    readme = '\n'.join([
        '# 開発用の仮の画像（TEST FIXTURES ONLY — not art）',
        '',
        'このフォルダの画像は、生成イラスト素材（Version 22）の **配置と動作の確かめだけ** に使う、格子と「TEST」の文字の模様です。',
        '',
        '- **見た目の素材ではありません。** 見た目の改善の確認・比較・報告には使いません。顔や風景は描いていません（生成画像の代わりにしない）。',
        '- **公開版に入りません。** `proto3d/public/` の外にあり、`vite build` は `public/` だけを写します。`node proto3d/tools/check-dist.mjs` が dist に dev-art が無いことを確かめます。',
        '- 開発サーバーで URL に `?artFixture=1` を付けたときだけ、`proto3d/src/art/registry.ts` が一覧をこのフォルダの `manifest.json` に差し替えます（本番のビルドでは使われません）。',
        '- 作り方：`python3 -I proto3d/tools/make-dev-art.py`。本物と同じ ID・種類・原画の大きさの模様を作り、`proto3d/tools/art-build.py` の ingest → build をそのまま通します（透明の検査・余白の切り詰め・同じ原画からの顔の切り出し・地面の処理・WebP の上限）。手で直さないでください。',
        '- `manifest.json` は `proto3d/src/art/manifest.gen.json` と同じ形です（file はこのフォルダからの相対）。',
        '',
        f'合計 {total:,} バイト（{len(gen["assets"])} 件）。',
        '',
        '| ID | 種類 | ファイル | 寸法 | 容量（バイト） | meta |',
        '|---|---|---|---|---|---|',
        *rows,
        '',
        '## 模様の見方',
        '',
        '- 人物画：灰色の単純な形（頭・首・胴。下端まで続く）＋64px の格子＋赤い線 = 目の高さ（原画の上から 20%）＋黄色の点線 = 下から 20%（台詞の欄に隠れてよい所）＋「→」= 向き（画面の右）。',
        '  透明な余白は本物と同じく切り詰めるので、加工版は 1024×1536 より小さい。`meta.eyeY`・`meta.faceX` は加工版の高さ・幅に対する割合。',
        '- 顔：人物画の頭の範囲（faceRect）を、本物と同じ加工の道で同じ原画から切り出した物（名前と TEST の文字が入る）。',
        '- 背景：黄色の線 = 上下 18%（画面の形で切れうる所）と左 3 分の 1（人物画）、水色の線 = 上 20%（見出しの文字）、黄色の枠 = 右の中央（選択肢）。',
        '- 手前の幕：左右の端の棒だけ（中央は透明。内側の縁は 14px でなめらかに透明へ）。',
        '- 地面：1 枚 = `meta.tileMeters` m 四方を 8×8 のます（1 ます = 1/8）に分け、左上から 1〜64 の番号（G = 草地・D = 土・R = 道・F = 林床）。左上のますの「↑」が画像の上。',
        f'  継ぎ目の値（1 前後なら目立たない）：草地 {tg["seamBefore"]["ratio"]} → {tg["seamAfter"]["ratio"]}。',
        '',
    ])
    ab.write_text_if_changed(OUT / 'README.md', readme)
    du = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    print(f'proto3d/dev-art：{len(gen["assets"])} 件・画像 {total:,} バイト・フォルダ全体 {du:,} バイト（目安 {SIZE_BUDGET:,} 以下）')
    if du > SIZE_BUDGET:
        print('make-dev-art：dev-art が大きすぎる', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
