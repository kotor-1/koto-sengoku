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
