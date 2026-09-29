# 使用した第三者素材と利用条件

## MPFB2（MakeHuman の Blender 版）の人体の基本形

| 項目 | 内容 |
|---|---|
| 入手元 | https://github.com/makehumancommunity/mpfb2 （公式リポジトリ。git で取得） |
| 版 | MPFB 2.0.17（`src/mpfb/blender_manifest.toml`）、コミット 3edf9df0551765be43563d047888cf7877eb89b4（2026-09-26） |
| 使ったもの | 素材（データ）だけ：基本の人体メッシュ `src/mpfb/data/3dobjs/base.obj`、形の調整データ `src/mpfb/data/targets/**`（頭・顔・首など）。使ったファイルの写しは `proto3d/thirdparty/mpfb2/` |
| 素材の利用条件 | CC0 1.0 Universal（`LICENSE.ASSETS.md`）。改変・再配布・商用を含め、表示の義務なく自由に使える |
| プログラムの利用条件 | GPLv3（`LICENSE.CODE.md`）。MPFB のプログラムはゲームに入れていない（Blender での制作に使う場合も、ゲームへ組み込むのは書き出した形のデータだけ） |
| 取得できなかったもの | MakeHuman の追加素材（髪・眉・眼球・肌の画像など、files.makehumancommunity.org 等で配布）：この環境の通信制限で接続が拒否された（403）。髪・眉は自作 |
| 用途 | 主人公の頭部の比較案（`hero_v3_mpfb.glb`、ゲームでは `?hero=mpfb` のときだけ読む）。承認済み参考画像の人物を方向性にしたオリジナルの頭部で、特定の実在人物の再現ではない |

### 実際に使ったファイル（2026-09-29 更新：頭部の比較案 `hero_v3_mpfb.glb` の第 2 案。全 42 ファイル）

写しは `proto3d/thirdparty/mpfb2/` に元と同じ相対の道で置いた（中身は元のリポジトリのファイルと 1 バイトも変えていない。どれも CC0 1.0）。
加えて利用条件の文書 `LICENSE.md`・`LICENSE.ASSETS.md` の写し。

| ファイル（`src/mpfb/data/` から） | 使い方 |
|---|---|
| `3dobjs/base.obj` | 人体の基本形。体の面（`body`）のうち頭・首・胸の上だけを使う。目の補助の形（`helper-l-eye` / `helper-r-eye`）とまつ毛の補助の形（`helper-*-eyelashes-1/2`）は、眼球とまぶたの縁の位置合わせにだけ使う（書き出さない） |
| `targets/macrodetails/asian-male-young.target.gz`、`caucasian-male-young.target.gz` | 性別・年齢・人種の基本（男性、約 25 歳、アジア 0.58・ヨーロッパ 0.42） |
| `targets/macrodetails/universal-male-young-averagemuscle-averageweight`、`-averagemuscle-minweight`、`-maxmuscle-averageweight`、`-maxmuscle-minweight`（各 `.target.gz`） | 筋肉 0.70・体重 0.25 の組み合わせ（MakeHuman と同じ重みの規則。第 2 案で体重を下げて顔の脂肪を減らした） |
| `targets/head/head-oval`、`head-scale-horiz-decr`、`head-square`、`head-fat-decr`（各 `.target.gz`） | 顔の輪郭（やや面長、横幅を少し細く、あごの角を少し、顔の脂肪を減らす） |
| `targets/neck/neck-double-decr.target.gz` | あごの下のたるみを減らす（横顔であご → 首の線が読めるように） |
| `targets/chin/chin-width-incr`、`chin-bones-incr`、`chin-height-incr`、`chin-prominent-incr`、`chin-prognathism-incr`（各 `.target.gz`） | あご（細くとがらせない。あご先を前へ） |
| `targets/mouth/mouth-scale-depth-decr`、`mouth-upperlip-volume-incr`、`mouth-lowerlip-volume-incr`（各 `.target.gz`） | 唇を前へ出さない（弱め）・唇の厚みを戻す |
| `targets/nose/nose-trans-forward`、`nose-scale-vert-incr`、`nose-scale-depth-incr`、`nose-hump-incr`（各 `.target.gz`） | 鼻筋 |
| `targets/cheek/l-cheek-volume-decr`、`r-cheek-volume-decr`、`l-cheek-inner-decr`、`r-cheek-inner-decr`、`l-cheek-bones-incr`、`r-cheek-bones-incr`（各 `.target.gz`） | 頬（ふくらみを減らし、頬骨を少し） |
| `targets/eyebrows/eyebrows-trans-down`、`eyebrows-trans-forward`（各 `.target.gz`） | 眉の骨を下げて前へ（目に近く） |
| `targets/eyes/l-eye-height1-incr`、`-height2-incr`、`-height3-incr`、`-eyefold-down` と `r-` の同じもの（各 `.target.gz`） | 目の開き（約 6.7mm → 約 9mm。真ん中は上げすぎない）と上まぶたの折れ目を下げる |
| `targets/ears/l-ear-trans-up`、`r-ear-trans-up`（各 `.target.gz`） | 耳の頂点を見分けるためだけに使う（形は変えない。髪の層を測る「耳をならした頭」を作る） |

- 読み込みは自作（`proto3d/blender/hero/mpfb_base.py`：`base.obj` と `*.target.gz` を読んで重みを掛けて足すだけ）。MPFB のプログラム（GPLv3）は使っていない・写していない・ゲームに入れていない
- 重みの一覧は `proto3d/blender/hero/head_mpfb.py`（`MACRO`・`MODS`）。作り直すと `proto3d/blender/build/hero/hero_v3_mpfb-info.json` の `mpfb.files` に読んだファイルが記録される
- 眼球・まぶたの縁の線・眉・髪（生え際の毛の板・顔の横の毛束を含む）・肌の色味・画像はすべて自作（MakeHuman の追加素材は取得できなかったため使っていない）
