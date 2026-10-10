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

## 音（BGM・環境音・効果音・声）

第三者の素材は使っていない（Version 21。docs/audio.md）。

- BGM 3 種・環境音・効果音：すべてこのリポジトリのコード（`proto3d/src/audio/`）で合成したオリジナル。音源のファイル・既存の曲や録音・購入・外注・有料 API は無い。
- 声：端末の読み上げ（Web Speech API。OS・ブラウザの音声）を使う。声のデータはゲームに入れていない。
- 取得できなかったもの：VOICEVOX Nemo（配布元 voicevox.hiroshiba.jp・github.com がこの環境の通信制限で拒否（403））。使っていない。

## 生成イラスト素材パック sengoku_art_pack_v1（人物・風景画像 第1版。Version 22）

利用者から受け取った画像素材のパック（ZIP `sengoku_characters_landscapes_v1.zip`、中のフォルダ `sengoku_art_pack_v1`、作成日 2026-10-08）。
第三者の写真・有料素材・他社ゲームの画像は入っていない（パックの README・`docs/利用条件と来歴.md`）。素材 1 件ごとの記録は `docs/art-assets.md`（`art-build.py docs` が作る）。

| 項目 | 内容 |
|---|---|
| 出どころ | 利用者が ChatGPT の画像生成機能で出力した、複数の絵をまとめたデザインシート（パックの記載。生成の裏側の版は公開されておらず、パックにも記録が無い）。参照した画風は、利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート |
| パック側の加工（記録どおり） | 使う範囲の切り出し、手動の種を使った背景の分離（人物は透過）、透明な縁の整理、Lanczos の 2 倍補間（細部は増えていない。補間前の版は `_native`）、顔の切り出し、WebP への変換、地面の大きな明暗の低減と端の調整、軍議の背景の一部の紋様の除去。人物の元の範囲は幅 203〜348px、風景は幅 313〜522px |
| こちらの取り込み | 人物画は補間前の版（`portraits/portrait_<id>_native.png`）だけを原画として `proto3d/assets-src/art-v22/portrait.<id>/original.png` に保管（公開版には入れない）。顔は同じ原画から、パックの `docs/portraits.json` の `face_rect_native_xywh` の範囲で切り出し、`art-build.py build` で 256×256 の WebP にした。左右反転はしていない。パックの README・manifest・`docs/`（利用条件と来歴・切り出しの座標）の写しは `proto3d/assets-src/art-v22/pack-v1/`（画像は入れていない）。人物と ID の対応はパックの manifest どおり（酒井忠次＝sakai・本多忠勝＝tadakatsu・榊原康政＝sakakibara を取り違えていないことを画像の比べで確かめた） |
| 使っている物 | **Version 25 から：** 武将 6 人の顔は素材パック第 2 版（下の節）から作り直した物に替え、第 1 版の顔は `face.pack1.*` として、Version 24 と比べる表示だけで使う（ファイル・中身は Version 24 と同じ）。以下は Version 22〜24 の使い方。武将 6 人の顔：徳川家康・本多忠勝・酒井忠次・石川数正・榊原康政・浅井長政（`proto3d/public/art/faces/*.webp`、6 ファイル・合計 79,806 バイト）。会話・軍議の台詞の枠（家康・忠勝・酒井・石川）と、合戦の部隊の札・能力の欄・発動の知らせ・演習の編成の表（6 人）。Version 23 から、大平原の合戦の地面の色の素材 3 点：草地・土・道（`proto3d/public/art/battle/plains_{grass,dirt,road}.webp`、3 ファイル・合計 181,754 バイト。パックの 512px の画像をそのまま原画にした。パック自身が 354／354／346px の切り出しを 1.45〜1.48 倍に補間拡大した物で、こちらでは拡大していない。草地は色を Version 21 の緑へ 75% 寄せた：記録は docs/art-assets.md） |
| 使っていない物 | **人物画（立ち絵）と背景（軍議の背景を含む風景）**：利用者の判断（2026-10-09）で、パックの低い解像度の物は使わない。一覧のシートからの切り出し直し・補間の拡大もしない。第 1 版の人物画・背景は Version 25 以降も使わない（Version 25 で個別の新しい原画＝第 2 版が届き、立ち絵・顔・軍議の背景はそちらから作った：下の節。要件は docs/art-v22-asset-request.md §9）。人物画 6 人分の原画（補間前の版）は記録のために保管しているだけで、公開版には入れない。**林床**：焼き込まれた木漏れ日が縞に見えるので不採用（原画も保管しない）。織田信長・朝倉義景の人物画と顔：画面に出る登場人物がいないので受け取っていない（画像のために部隊や出来事は足さない）。パックの 2 倍補間版・128px の顔・`web/`・`previews/`・`source/`・`gallery.html`：使わない（公開しない） |
| 利用条件（記録どおり） | パックの `docs/利用条件と来歴.md`（確認日 2026-10-08）：OpenAI の利用規約（Content / Ownership of content）では、適用法令で認められる範囲で、利用者と OpenAI の間では出力の権利は利用者に帰属すると説明されている。出力が唯一であること・第三者の権利を侵害しないことは保証されない。CC0 の宣言はしていない。OpenAI の公認・監修とは表示しない。公的人物の容貌の復元とは称さず、ゲーム用の創作デザインとして扱う。共有・公開ポリシーは、公開前のレビューと AI 生成の明示を求めている。確認したページ：https://openai.com/policies/terms-of-use/ ・ https://openai.com/policies/sharing-publication-policy/ ・ https://openai.com/policies/service-terms/ 。この記載は法的な保証ではない（公開の前に、そのときの規約・方針・法令・公開先の決まりを確かめる） |
| AI 生成の明示 | タイトル画面の「シナリオを選ぶ」のすぐ下に「一部の人物・背景画像はAI生成画像を加工して使用」と出す（生成イラスト素材を使っている時だけ。`?art=old` では出さない）。Version 23 から使う合戦の地面の素材も AI 生成で、合戦の背景の画像としてこの明示に含める（文言は変えていない） |
| 紋様 | 衣装・旗の紋様は史実の家紋として確かめていない。家紋として説明しない（顔の切り出しの範囲には大きな紋は入らない） |
| 公開物 | 第 1 版から公開版に入るのは顔の WebP 6 枚（Version 25 からは `?art=v24` の比べる表示だけで使う）と、大平原の地面の WebP 3 枚（草地・土・道）だけ（`proto3d/tools/check-dist.mjs` で数える）。第 1 版の原画・一覧画像・`source/`・人物画・背景・林床は公開しない（Version 25 から公開する人物画・顔・軍議の背景は第 2 版の物：下の節） |

## 生成イラスト素材パック sengoku_individual_art_v2（個別原画 第2版。Version 25）

利用者から受け取った画像素材のパック（中のフォルダ `sengoku_individual_art_v2`、作成日 2026-10-10）。アップロードの上限に合わせて 3 つの ZIP に分けて届いた：
`sengoku_art_v2_under30MB_1_of_3.zip`（18,699,025 バイト・sha256 `83913436d7f657d079d60027a3f5e7cd6c2dde90cc7fdb672c95c84ecf9d7231`。家康・忠勝・酒井・石川の人物と共通の文書）、
`sengoku_art_v2_under30MB_2_of_3.zip`（18,784,355 バイト・sha256 `c8d0ace67e54069270d7b0f1f139abe68060eeca317013665de440e148697739`。榊原・信長・長政・義景の人物と共通の文書）、
`sengoku_art_v2_under30MB_3_of_3.zip`（25,171,727 バイト・sha256 `5b9fd32edc1131367048d4cccdaa5169fe11d4c3eb3e830e562feedb09842e61`。背景・林床と共通の文書）。
3 つを合わせて 78 ファイル（画像 68 枚）。素材 1 件ごとの記録（各ファイルの sha256・生成 ID・外見の記録・切り出しの範囲・作り方）は `docs/art-assets.md` と正本 `proto3d/assets-src/art-v22/manifest.json` の `sources.pack-v2`・各素材の `pack`。

| 項目 | 内容 |
|---|---|
| 出どころ | 利用者が OpenAI の画像生成機能で、人物 1 人・場面 1 つずつ単独に生成した画像（一覧ポスターやデザインシートの切り抜きではない：パックの README・`docs/PROVENANCE_AND_USAGE.md`）。外部の購入素材・俳優の写真・他作品のキャラクターの素材は入っていない（パックの記載）。外見・衣装・髪形・城の建築はゲーム用の創作で、実在の容貌の復元・史実の考証済みの資料ではない |
| パック側の加工（記録どおり・こちらで確かめた） | 人物画 `portraits/`：元の生成結果（1024×1536 RGBA。`originals/portraits/`）の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）。**こちらで画素まで一致を確かめた。** 背景 `backgrounds/`：元の生成結果 1672×941 の (4, 2) から 1664×936 を切り詰めた 16:9（画素まで一致）。顔 `faces/256`・`faces/128`：`portraits/` をパックの `face_crop_xyxy`（440×440）で切り出して縮めた物（画素まで一致）。`web/`：縮小・圧縮版（人物 768×1152・背景 1440×810） |
| 受け取りの検査 | パックの検査スクリプト（パックの外の一時フォルダから隔離モードで実行）PASS（画像 68 枚の寸法・sha256・人物画の PNG の形式）、`checksums.sha256` の 77 件一致、ZIP 3 つの sha256 一致。人物画 8 枚は本物の透明（市松模様の描き込みなし）、上端・左右の端に人物がかからない（榊原康政だけ右の袖の下の方 y 1145〜1149 の 5 画素が右端に接する。パックの image_validation.json と同じ）、腰より下で切れた半身。暗い背景の上では髪の先にかすかに明るい縁が見える所がある（明るい・中間の背景では見えない。色を前もって掛けた暗い縁は無い） |
| こちらの取り込み | `art-build.py ingest-pack` で、使う 7 枚（人物画 6 枚・昼の軍議所。人物画のうち榊原・長政の 2 枚は顔の元としてだけ使う）だけを、記録の sha256・パックの一覧・元の生成結果との関係を画素まで確かめてから、git に入れない手元の置き場 `proto3d/assets-src/art-v25/originals/` に写した。**原画（PNG）は公開リポジトリに入れていない**（新しく clone した所でも build・check は通る：加工版をそのまま使い、原画の確かめを飛ばしたと表示する）。人物と武将の対応は、パックの `characters_and_scenes.json` の表示名で決めた（徳川家康＝ieyasu・本多忠勝＝tadakatsu・酒井忠次＝sakai・石川数正＝ishikawa・榊原康政＝sakakibara・浅井長政＝nagamasa。パックの key を武将の id と同じとみなさない）。パックの記録の文書 4 つ（`characters_and_scenes.json`・`asset_manifest.json`・`docs/PROVENANCE_AND_USAGE.md`・`docs/image_validation.json`）の写しは `proto3d/assets-src/art-v25/pack-v2/`（画像は入れない） |
| 使っている物（公開物） | 人物画 4 枚（会話・軍議で話す家康・忠勝・酒井・石川だけ）：原寸のまま（透明な余白を 8px 残して切り詰めただけ。拡大・縮小・反転なし）の WebP 品質 85・不透明度は元と同じ値（`proto3d/public/art/portraits/<武将>_v2.webp`、926〜1003×1485〜1532、4 ファイル・合計 777,806 バイト）。パックの `web/` の縮小版（768×1152）は使わない：768×1024 の画面・端末の画素の比 2 では立ち絵を元の 1532px まで描くので、1152px では 576 CSS px が拡大しない上限になって足りない（その分、公開の容量は web/ 版より大きい）。顔 6 枚：同じ原画からパックと同じ範囲（`face_crop_xyxy`。顔が真ん中から外れていないので直していない）で切り出し、256×256 に縮めた WebP（`proto3d/public/art/faces/<武将>_v2.webp`、6 ファイル・合計 99,744 バイト）。昼の軍議所：原寸 1664×936 の WebP 品質 82（`proto3d/public/art/story/council_day.webp`、220,696 バイト）。メタデータは入れていない |
| 背景の制限 | 背景の原画は 1672×941（16:9 に切り詰めて 1664×936）で、**Version 22 の要件（幅 1920px 以上）には届かない。** 拡大して 1920px の原画として扱わない。原寸以内で表示できる所だけで比べる候補 |
| 予約・使っていない物（公開しない） | **榊原康政・浅井長政の立ち絵**：今の両章の会話・軍議でこの 2 人は話さない（台詞が無い）ので、立ち絵は公開しない（Version 25 の最後の見直し：必要な画像だけを公開する）。原画は 2 人の顔（合戦の札・能力の欄・編成の表に出る）の元としてだけ記録する（正本の `sourceOnly`）。**織田信長・朝倉義景**：画面に出る登場人物・部隊が無いので公開しない（予約。絵を使うためだけに NPC・部隊・会話を足さない。手元の置き場にも写していない）。**昼の城下町・大平原の遠景**：物語の背景の候補。使う画面を決めておらず公開しない（歩ける 3D の町・合戦の地図の代わりにはしない）。**林床**：任意の比較候補。開発サーバーだけで比べた結果（Version 25 の作業 F）、継ぎ目・焼き込まれた明暗の縞は無いが、色が赤茶（林が土の円に見える）・1 枚 8m では細部が約 5 倍に大きすぎる・林の木が部隊に重なる、なので **この版には入れない**（色と 1 枚の大きさを決めてから。docs/v25-portraits.md）。地面は今の草・土・道のまま。パックの `web/`・`faces/`（同じ範囲で原画から作り直したので使わない）・`originals/`（関係の確かめだけ）・確認ページ・検査スクリプト：使わない |
| 利用条件（利用者の記録どおり） | パックの `docs/PROVENANCE_AND_USAGE.md`（確認日 2026-10-10。https://openai.com/policies/terms-of-use/ 、2026-01-01 発効の表示）：利用者と OpenAI の間では、適用法で認められる範囲で利用者が出力を所有する（Content / Ownership of content）。出力は独自とは限らず、他者へ似た出力が提供されうる（Similarity of content）。入力・出力の利用の責任、第三者の権利の尊重、人が生成したと偽らないことなどの条件がある。パックの作成者は独自の再配布禁止・素材の再販売禁止・クレジット必須などの条件を付けない。以前の生成の一覧画像に書かれていた利用条件は、このパックの条件ではない。**この記載は法的な保証ではない**（著作権の発生・排他性・第三者の権利の非侵害は保証されない。公開の前に、そのときの規約・法令・公開先の決まりを確かめる） |
| AI 生成の明示 | タイトル画面の「一部の人物・背景画像はAI生成画像を加工して使用」を、使う範囲（人物画・顔・軍議の背景）に合わせて保つ（文言は変えていない） |
