# 開発用の仮の画像（TEST FIXTURES ONLY — not art）

このフォルダの画像は、生成イラスト素材（Version 22）の **配置と動作の確かめだけ** に使う、格子と「TEST」の文字の模様です。

- **見た目の素材ではありません。** 見た目の改善の確認・比較・報告には使いません。顔や風景は描いていません（生成画像の代わりにしない）。
- **公開版に入りません。** `proto3d/public/` の外にあり、`vite build` は `public/` だけを写します。`node proto3d/tools/check-dist.mjs` が dist に dev-art が無いことを確かめます。
- 開発サーバーで URL に `?artFixture=1` を付けたときだけ、`proto3d/src/art/registry.ts` が一覧をこのフォルダの `manifest.json` に差し替えます（本番のビルドでは使われません）。
- 作り方：`python3 -I proto3d/tools/make-dev-art.py`。本物と同じ ID・種類・原画の大きさの模様を作り、`proto3d/tools/art-build.py` の ingest → build をそのまま通します（透明の検査・余白の切り詰め・同じ原画からの顔の切り出し・地面の処理・WebP の上限）。手で直さないでください。
- `manifest.json` は `proto3d/src/art/manifest.gen.json` と同じ形です（file はこのフォルダからの相対）。

合計 484,538 バイト（18 件）。

| ID | 種類 | ファイル | 寸法 | 容量（バイト） | meta |
|---|---|---|---|---|---|
| `portrait.ieyasu` | portrait | `art/portraits/ieyasu.webp` | 745×1453 | 36,572 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.ieyasu` | face | `art/faces/ieyasu.webp` | 256×256 | 7,554 | {} |
| `portrait.tadakatsu` | portrait | `art/portraits/tadakatsu.webp` | 745×1453 | 39,242 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.tadakatsu` | face | `art/faces/tadakatsu.webp` | 256×256 | 7,970 | {} |
| `portrait.sakai` | portrait | `art/portraits/sakai.webp` | 745×1453 | 36,722 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.sakai` | face | `art/faces/sakai.webp` | 256×256 | 7,522 | {} |
| `portrait.ishikawa` | portrait | `art/portraits/ishikawa.webp` | 745×1453 | 38,090 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.ishikawa` | face | `art/faces/ishikawa.webp` | 256×256 | 7,780 | {} |
| `portrait.sakakibara` | portrait | `art/portraits/sakakibara.webp` | 745×1453 | 39,360 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.sakakibara` | face | `art/faces/sakakibara.webp` | 256×256 | 8,162 | {} |
| `portrait.nagamasa` | portrait | `art/portraits/nagamasa.webp` | 745×1453 | 38,296 | {"eyeY": 0.1543, "faceX": 0.507} |
| `face.nagamasa` | face | `art/faces/nagamasa.webp` | 256×256 | 7,952 | {} |
| `bg.council` | background | `art/story/council.webp` | 1536×1024 | 50,350 | {} |
| `bg.council.front` | overlay | `art/story/council_front.webp` | 1536×1024 | 7,802 | {} |
| `tex.plains.grass` | texture | `art/battle/plains_grass.webp` | 1024×1024 | 38,858 | {"tileMeters": 8} |
| `tex.plains.dirt` | texture | `art/battle/plains_dirt.webp` | 1024×1024 | 38,212 | {"tileMeters": 8} |
| `tex.plains.road` | texture | `art/battle/plains_road.webp` | 1024×1024 | 38,134 | {"tileMeters": 8} |
| `tex.plains.forest` | texture | `art/battle/plains_forest.webp` | 1024×1024 | 35,960 | {"tileMeters": 8} |

## 模様の見方

- 人物画：灰色の単純な形（頭・首・胴。下端まで続く）＋64px の格子＋赤い線 = 目の高さ（原画の上から 20%）＋黄色の点線 = 下から 20%（台詞の欄に隠れてよい所）＋「→」= 向き（画面の右）。
  透明な余白は本物と同じく切り詰めるので、加工版は 1024×1536 より小さい。`meta.eyeY`・`meta.faceX` は加工版の高さ・幅に対する割合。
- 顔：人物画の頭の範囲（faceRect）を、本物と同じ加工の道で同じ原画から切り出した物（名前と TEST の文字が入る）。
- 背景：黄色の線 = 上下 18%（画面の形で切れうる所）と左 3 分の 1（人物画）、水色の線 = 上 20%（見出しの文字）、黄色の枠 = 右の中央（選択肢）。
- 手前の幕：左右の端の棒だけ（中央は透明。内側の縁は 14px でなめらかに透明へ）。
- 地面：1 枚 = `meta.tileMeters` m 四方を 8×8 のます（1 ます = 1/8）に分け、左上から 1〜64 の番号（G = 草地・D = 土・R = 道・F = 林床）。左上のますの「↑」が画像の上。
  継ぎ目の値（1 前後なら目立たない）：草地 1.0 → 1.0。
