# 3D 比較版・城門前の一場面：制作データ（確認用）

## 対象コミット

- **見た目の内容：f280ee4**（リポジトリ kotor-1/koto-sengoku、ブランチ claude/brave-babbage-n70egj）
  - 確認用 URL の Version 7（版 ID 1790399155-950e）は、この内容の本番ビルド。
- **ファイルを集めた時点の最新：2a77edb**
  - f280ee4 からの差は 2 点だけで、モデル・画像・ゲームの処理は変わらない。
    - 公開用の変換ツール `glb-to-gltf.mjs`：同じ画像を 1 つのファイルにまとめる
    - `docs/proto3d.md`：公開した版の記録

## まず開くファイル

| 見たいもの | 開くファイル |
|---|---|
| 主人公の Blender ファイル | `blender_files/hero/hero_v3.blend`（Blender 4.5 LTS で保存。画像は .blend の中に取り込み済み） |
| ゲームが読み込むモデル | `models_glb/*.glb`（下の表） |
| 城門前の場面の組み立て | `scripts/proto3d/blender/scene/assemble.py`（GLB を配置どおりに読み込む）と `scripts/proto3d/blender/scene.json`（配置の約束） |
| 材質・照明・カメラの設定 | `game_source/proto3d/src/main.ts` と `game_source/proto3d/src/game/follow.ts` |

## 中身

### blender_files/

- `hero/hero_v3.blend`：主人公の現在の Blender ファイル（hero_v3.glb を書き出したときに保存したもの）
- `hero/hero_v3-info.json`：三角形の数・骨・動きの長さの記録
- **城門前の場面の Blender ファイル：なし**
  - 保存した .blend は無い。
  - 場面は、書き出した GLB を `assemble.py` が毎回読み込んで組み立てる。
- **城門・土塀・天守、町家 3 棟、木、地面の Blender ファイル：なし**
  - どれも下のスクリプトが毎回作り、GLB へ直接書き出す。

### textures/

スクリプトが作り、Blender の材質が読む画像。書き出した GLB には、これらを JPEG／PNG にしたものが埋め込まれている。

- `library/`：共通の材質（木・漆喰・瓦・石・土など）。`lib/mats.py` が作る。
  - 門の木材 `wood_timber_v3_*` は `gate/gkit.py` が作る。
- `library_ao/`：地面（`ground_terrain.png`）と塀の漆喰（`walls_plaster.png`）に焼き込んだ陰。
  - `ground_terrain.png` は赤に陰、緑に粗さが入っている。
- `hero/`：主人公の布・帯・髪・草履などの色（`tex_*`）と凹凸（`nrm_*`）。`hero/textures.py` が作る。
- `ground/`：地面専用の土（`road_*`）と草地（`turf_*`）。`scene/ground_tex.py` が作る。
- `trees/`：松・桜の幹と葉、草木。`trees/textures.py` が作る。
  - 桜の花は `sakura_blossom_v4` を使う。
- `machiya/`：町家の暖簾。`machiya/build_machiya.py` が作る。
- `keep/`：天守の石垣と瓦。`gate/` のスクリプトが作る。

### models_glb/：ゲームに読み込んでいるモデル

| ファイル | 中身 | 作るスクリプト |
|---|---|---|
| `hero_v3.glb` | 主人公（既定の「新」） | `hero/build_hero_v3.py` |
| `hero_v2.glb` | 前の主人公（画面の「旧」）。hero_v3 の骨組みと動きの元 | `assets-src/hero_v2/build_hero.py` |
| `gate_v2.glb`, `walls_v2.glb`, `keep.glb` | 城門、土塀、遠景の天守 | `gate/build.py` |
| `machiya_a.glb`, `machiya_b.glb`, `machiya_d.glb` | 町家 3 棟 | `machiya/build_machiya.py` |
| `tree_pine.glb`, `tree_sakura.glb`, `tree_pine_far.glb` | 松、桜、遠景の松 | `trees/build_all.py` など |
| `ground_v2.glb` | 地面・道・側溝・竹垣・草 | `scene/build_ground.py` |

- 開発時（`npm run proto3d:dev`）のゲームは、これらの GLB をそのまま読む。
- 確認用 URL では、`scripts/proto3d/tools/glb-to-gltf.mjs` で glTF（JSON）と画像ファイルに変換したものを読む。形と画像の中身は同じ。
- 変換したファイルそのものは入れていない。

### scripts/：作成・書き出しのスクリプト（リポジトリと同じフォルダ構成）

- 実行は `/root/blender-venv/bin/python <スクリプト>`（Blender 4.5 LTS を Python から使う形、pip の `bpy`）。
- `proto3d/blender/lib/`：共通の道具（`common.py`）と材質ライブラリ（`mats.py`）
- `proto3d/blender/hero/`：主人公（`build_hero_v3.py` が入口）
- `proto3d/blender/gate/`：城門・土塀・天守（`build.py`。門だけ作り直すときは `build.py gate walls --export=gate_v2 --no-preview`）
- `proto3d/blender/machiya/`：町家 3 棟
- `proto3d/blender/trees/`：木と草
- `proto3d/blender/scene/`：
  - 地面：`build_ground.py`、`ground_tex.py`
  - 場面の組み立てと確認用の描画：`assemble.py`
  - 足の高さの格子：`ground_height.py`（出力は `ground_height.json`）
- `proto3d/blender/matlib/`：材質の見本を描く確認用
- `proto3d/blender/tools/`：Blender とゲームを同じカメラで比べる確認用（`gameviews.mjs`、`blviews.py`、`views.json`）
- `*.meta.json`：素材ごとの当たり判定・カメラ除けの箱（ゲームが読む）
- `proto3d/tools/glb-to-gltf.mjs`：確認用 URL 向けの変換

### game_source/：ゲーム側の関連ソース

| ファイル | 分かること |
|---|---|
| `proto3d/src/main.ts` | 照明（下の一覧）、材質の扱い（`prepare()`：影の設定、画像の異方性フィルタ）、モデルの読み込み（`load()`、`loadJson()`）、主人公の足の高さ |
| `proto3d/src/game/follow.ts` | 肩越しのカメラ（`FOLLOW`：高さ 1.58 m・肩 0.45 m・距離 3.3 m・上下の範囲、壁を突き抜けない処理） |
| `proto3d/src/game/motion.ts` | 移動・歩く／走るの速さ |
| `proto3d/src/layout.ts` | 配置・当たり判定・地面の高さの読み取り |
| `proto3d/src/scenery.ts` | 空と山並み |
| `proto3d/index.html`, `public/style.css` | 画面の部品 |
| `proto3d/vite.config.mjs` | ビルドと版の表示 |
| `docs/proto3d.md` | 3D 比較版の記録 |

`main.ts` の照明（肩越しのとき）：

- 色の変換：ACES、露出 1.1
- 日差し：#ffe2bd、強さ 3.4、来る向き (-17, 12, 9)。影は PCF、2048 px
- 半球光：空 #d6dde2、地面 #8c7153、強さ 0.8
- 空の映り込み：0.45
- 霧：45〜480 m
- カメラの画角：50°

`proto3d/src/assets/`、`proto3d/src/tools/`（コードで作った前の素材）は、今の場面では使わないので入れていない。

## 入れていないもの

- node_modules、Git の履歴、認証情報、環境変数のファイル
- 作業用の中間ファイル：`.blend1`、試作の `test_*.blend`、確認用の描画、キャッシュ
