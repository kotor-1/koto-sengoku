# 公開物の画像を守る決まり（Version 27〜）

3D 比較版（`proto3d/`）の公開用の dist の画像が、ビルドの後に別の形式へ変わる事故の記録と、同じ種類の事故を普通の手順の中で止める仕組み。
公開の手順そのものは [proto3d.md](proto3d.md) の「公開」の行。

## 1. Version 26 で起きたこと（記録）

| 項目 | 内容 |
|---|---|
| いつ | Version 26 の公開の作業の最後（2026-10-12）。本番のビルドは 14:37（UTC）で、そのときに dist の全 152 ファイルの sha256 の一覧（`dist-431f5e2.sha256`、14:37:51）を取ってあった |
| 何が変えたか | 確かめが済んだ後に、作業用の置き場（作業メモの `v26/final`）を片付けるために打った一時のコマンド（リポジトリのコードではない）。Python の Pillow で `Path('v26/final').rglob('*.png')` の各ファイルを `.jpg` で保存し、元の `.png` を消す。画面写真を小さくするつもりだった |
| 対象の範囲 | `rglob` は `v26/final` の下のすべての階層。そこには画面写真（`prod-shots/`・`montage/`）だけでなく、公開用に確かめ終えた本番の dist（`v26/final/dist-431f5e2/`）も入っていた。それで dist の PNG 13 個（`favicon.png` と、glTF の JSON が名前で指す 3D の質感 `models/*.png` 12 個）が `.jpg` になり、`.png` が消えた |
| ビルドは正しかったか | 正しかった。ビルドの直後の一覧と、下の表の 3 つの出どころが、13 個すべてで同じ中身 |
| 公開した物 | 誤った物は公開していない。公開の前に気づき、Version 25 の dist（`dist-ca69007`）から同じ 13 個を戻した（sha256 が同じことを確かめてから）。そのうえで 152 個すべてをビルドの直後の一覧と照らしてから公開した。Version 26 の公開で送ったのは中身の変わった 6 ファイル（JS・CSS の 5 個と `index.html`。`publish-changes-431f5e2.txt`）だけで、PNG は 1 つも送っていない。公開先の Version 26（版 ID 1791830283-5a2b）から 13 個を読み戻すと、sha256 はすべてビルドの直後の一覧と同じ（2026-10-13 に確かめた） |
| 見つかった弱さ | `proto3d/tools/check-dist.mjs` は壊れた dist に「問題なし」を出した。参照先のファイルがあるか、中身が拡張子と合うかを見ていなかった。Version 26 の check-dist（c81cd28）を、同じ壊れ方をさせた写しに走らせると、今も「問題なし」（2 の表） |
| 画像の手での戻し | Version 26 では公開の直前に手で戻した。**Version 27 からは、手で戻すことを公開の手順にしない**（ビルドの出力がそのまま正しく、check-dist が壊れ方を止める。3） |

13 個の中身（すべて PNG の先頭の印 `89 50 4E 47 0D 0A 1A 0A`）。「一覧」はビルドの直後の `dist-431f5e2.sha256`、「出どころ」はリポジトリの元（`favicon.png` はそのまま写す。質感は `proto3d/tools/glb-to-gltf.mjs` が GLB に入っている画像のバイトをそのまま書き出す）、「V25」は Version 25 の dist、「公開先」は公開先の Version 26 からの読み戻し。

| ファイル | sha256 | 一覧 | 出どころ（リポジトリ） | V25 | 公開先 |
|---|---|---|---|---|---|
| `favicon.png` | `1fa4c9d8f65746bbcc2df6ff66c5620f691250c6e4360e4a43b7393a9f8dabaa` | 同じ | `proto3d/public/favicon.png` と同じ | 同じ | 同じ |
| `models/ground_v2-16.png` | `07c84f10890c86e26146292fb0152657c5ee75a8864f257ced316c207edba158` | 同じ | `ground_v2.glb` の images[16] と同じ | 同じ | 同じ |
| `models/hero_v2-0.png` | `eb914413fe821411f5ee795bb645015e7760a32724b3334a50d5150cc7cd610a` | 同じ | `hero_v2.glb` の images[0] と同じ | 同じ | 同じ |
| `models/hero_v2-1.png` | `2157399173a0e6b35218eb47e7840ae9c93b4ad7769cb3e9588c69357e48e06c` | 同じ | `hero_v2.glb` の images[1] と同じ | 同じ | 同じ |
| `models/hero_v2-2.png` | `fb8c6fc208c0514a6551b7d620ebcf9ff2e671c8807fe0e022b4b036ba25ff8c` | 同じ | `hero_v2.glb` の images[2] と同じ | 同じ | 同じ |
| `models/hero_v2-3.png` | `3ee3c9cb4f3f31da9ccf254122f474d78ed699f5bbc269e03a8d9b5858b9f4d8` | 同じ | `hero_v2.glb` の images[3] と同じ | 同じ | 同じ |
| `models/hero_v2-4.png` | `09e55d67c0a2e3ce02d857616263daab308f27327989b571c244e68104a32104` | 同じ | `hero_v2.glb` の images[4] と同じ | 同じ | 同じ |
| `models/hero_v2-5.png` | `a0e5c9c1b51784dc34bda154c46eea23c97bdca65edeb5cbc971b5fa3e24632a` | 同じ | `hero_v2.glb` の images[5] と同じ | 同じ | 同じ |
| `models/hero_v3_mpfb-0.png` | `478f47dfa55fc1cc20ef8aeead93b9cb9c641aaf75289f6f0e368b395bf68888` | 同じ | `hero_v3_mpfb.glb` の images[0] と同じ | 同じ | 同じ |
| `models/hero_v3_mpfb-6.png` | `40f8a6713c8f9467a1287157892ae77dd9cca4a8a2b46df94d7793e1008c5905` | 同じ | `hero_v3_mpfb.glb` の images[6] と同じ | 同じ | 同じ |
| `models/hero_v3_mpfb-12.png` | `6f10535735bff72a16d3f4c1566c8e9c240be40b12da874789698545da8f285b` | 同じ | `hero_v3_mpfb.glb` の images[12] と同じ | 同じ | 同じ |
| `models/tree_pine-2.png` | `1465aa59efb8a3fd53ff0a6f5e109617ef63e4606b28e8c68979cf5644bd03e0` | 同じ | `tree_pine.glb` の images[2] と同じ（`tree_pine_far.json` も同じファイルを指す） | 同じ | 同じ |
| `models/tree_sakura-2.png` | `b680339723dd2033bcc0a798629bfb0cf94da05911148c46f560f3f11f0a61c6` | 同じ | `tree_sakura.glb` の images[2] と同じ | 同じ | 同じ |

Version 26 の dist の 152 ファイルは、今もビルドの直後の一覧と全部同じ（`sha256sum -c`）。dist の質感 109 ファイル（PNG 12・JPEG 97）は、どれもリポジトリの GLB に入っている画像とバイト単位で同じ。

## 2. 直したこと

### check-dist が止める（`proto3d/tools/check-dist.mjs`）

これまでの確かめ（容量・ファイル数・`.glb`・dev-art・公開しない素材・パックの sha256）はそのままに、次を足した。どれも違反なら 1 で終わる。

- **参照の先**：dist の `.html` の `src`・`href`（外の URL・`data:`・`#` だけの物・コメントの中は除く）、glTF（`.json` で `asset.version` のある物）の `images[].uri`・`buffers[].uri`（`data:` は除く）、JS の中の同じ置き場の読み込み（`"./名前.js"`・`"./名前.css"`）と生成イラスト素材の場所（`"art/…/名前.webp"` など）が、dist の中にあること。dist の外を指す物も止める。
- **中身の形式**：拡張子と中身が合うこと。PNG・JPEG・WebP・GIF・AVIF・ICO・WOFF・音・動画は先頭の印、JSON は読めること、JS・CSS・HTML・SVG などの文字のファイルは UTF-8 として読めて NUL が無いこと。glTF の画像に `mimeType` があれば拡張子と合うこと。
- **`--sha256 <一覧>`**：ビルドの直後の一覧（`sha256sum` の形）と、ファイルの組と中身がすべて同じこと（変わった・消えた・増えたを止める。形式の正しい別の画像に入れ替わっても止まる）。
- **`--write-sha256 <書く先>`**：違反が無いときだけ一覧を書く。dist の中には書かない。**既にある一覧は上書きしない**（924c56f。
  壊れた後にもう一度走らせて、壊れた中身を「正しい」と書き直さない。終わりの値 2）。ビルドを作り直したときだけ `--overwrite-sha256` を付ける。

確かめ（2026-10-13。dist は作業メモの置き場。写しは作業メモの中に作り、元の dist は変えていない。元の dist は確かめの後も一覧と全部同じ）：

| dist | 新しい check-dist | Version 26 の check-dist |
|---|---|---|
| Version 26 の dist（`dist-431f5e2`）＋ `--sha256 dist-431f5e2.sha256` ＋ `--baseline dist-ca69007` | 問題なし（参照：HTML 6・glTF 208・JS 31、中身 152 ファイル、一覧 152/152 同じ） | — |
| Version 25 の dist（`dist-ca69007`）＋ その一覧 | 問題なし（一覧 152/152 同じ） | — |
| 写し：`models/hero_v2-0.png` を 1 つだけ JPEG にして PNG を消す | 違反 1（glTF の images[0] の先が無い） | 問題なし |
| 写し：Version 26 の事故と同じく 13 個を JPEG にして PNG を消す | 違反 14（HTML の favicon 1・glTF 13 か所。`--sha256` を付けると違反 40） | 問題なし |
| 写し：`models/tree_pine-2.png` の名前のまま中身を JPEG にする | 違反 1（.png なのに中身は JPEG） | 問題なし |
| 公開で送る分だけを集めた置き場（dist の一部） | 違反（無い参照の先を並べる）。check-dist はいつも dist 全体に走らせる | — |

単体テスト `tests/proto3d-check-dist.test.ts`：小さな偽の dist（index.html・favicon・CSS・JS の塊・art の WebP・glTF と PNG/JPEG の質感）を作り、壊れていなければ違反なし、Version 26 と同じ壊れ方（PNG を JPEG にして PNG を消す）・名前のまま中身を変える・空のファイル・読めない JSON・文字でない JS・無い JS の塊と素材・dist の外を指す・mimeType と拡張子の食い違い・一覧との違い（変わった・消えた・増えた）で止まること、違反があれば一覧を書かないこと、dist の中に一覧を書かないことを確かめる。

### 画面写真を小さくする道具（`proto3d/tools/shots-to-jpeg.mjs`）

画面写真の PNG を JPEG にするときは、親の置き場への一括の処理（`rglob`・`find … -name '*.png'`）を使わず、この道具を使う。e2e の写真は、はじめから JPEG で撮る（playwright の `screenshot({ type: 'jpeg', quality })`）のがいちばん安全。

```
node proto3d/tools/shots-to-jpeg.mjs <置き場> [<置き場> ...]            # 並べるだけ（既定）
node proto3d/tools/shots-to-jpeg.mjs <置き場> --apply [--quality 85]     # 変える（PNG は消す。--keep-png で残す）
```

- 変えるのは、名指しした置き場の**すぐ下**の `.png` だけ（下の階層には降りない）。
- 置き場の名前は `shots`・`montage`・`prod-shots` だけ（`--allow-name` で足せる）。
- パスのどこかに `dist`・`models`・`texture`・`public`・`assets-src`・`dev-art`・`node_modules` を含む物は断る（`--allow-name` でも外せない。`texture` は 924c56f で足した：
  git で管理していない質感の置き場を `--allow-name` で名指ししても変えない）。シンボリックリンクの置き場は断る。
- 置き場の中に `index.html`・`*.sha256`・`*.glb`・`*.gltf` があれば断る。git で管理しているファイルがあれば断る。
- 1 つでも断ったら、ほかの置き場も変えない（そのときは「変える」と書かず、断った置き場だけを書く。924c56f）。中身が PNG でない `.png`、同じ名前の `.jpg` がある物は変えない。
- 同じ置き場を 2 度名指ししても 1 度だけ扱う（実際の場所で比べる。924c56f。以前は 2 度目に消えた PNG を読みに行って落ちた）。
- JPEG にするのは Python の Pillow（`python3 -I`）。

単体テスト `tests/proto3d-shots-to-jpeg.test.ts`：既定で何も変えないこと、写真の置き場でない名前（`v26/final` など）・断る言葉を含むパス 7 通り・置き場の中の `index.html`／`*.sha256`／`*.glb`／`*.gltf`・シンボリックリンク・git で管理しているファイルを断り、ファイルが 1 つも変わらないこと、下の階層に降りないこと、`--apply` で写真だけが JPEG になることを確かめる。実際の置き場でも、`v26/final`・`v26/final/dist-431f5e2/models`・`proto3d/public/art` は `--apply` を付けても断った（何も変えていない）。

## 3. 公開の手順の決まり（Version 27〜）

1. ビルドは一時の git worktree で（[proto3d.md](proto3d.md) の「公開」の行のとおり）。
2. ビルドの直後に `node proto3d/tools/check-dist.mjs dist-proto3d --baseline <前回公開した dist> --write-sha256 <作業の置き場>/dist-<コミット>.sha256`。違反があれば一覧は書かれない（作り直す）。
3. 確かめ（本番の e2e・画面写真）。dist は読むだけにする。写真は dist の外の `prod-shots/` などに置く。
4. 公開の直前に `node proto3d/tools/check-dist.mjs <dist> --baseline <前回公開した dist> --sha256 <作業の置き場>/dist-<コミット>.sha256`。「問題なし」なら、その dist をそのまま公開する。違反なら公開せず、ビルドからやり直す（前の版の画像を手で戻すことを手順にしない）。
5. 原画・素材・3D モデル（`proto3d/public/**`・`proto3d/assets-src/**`・`proto3d/dev-art/**`）と、本番の dist には、一括の変換・作り直し・形式の変更をしない。画面写真を JPEG にするときは `shots-to-jpeg.mjs` だけを使う。

## 4. Version 27 で画像を変えていないこと

- `git diff --stat 28c0b72..HEAD`・`git diff --stat 431f5e2..HEAD`（`*.png`・`*.jpg`・`*.jpeg`・`*.webp`・`*.glb`・`*.gltf`・`*.avif`・`*.gif`）は空（c81cd28 の時点と、この記録のコミットの直前の作業ツリーの両方。作業ツリーにも画像の変更・新しい画像は無い）。
- `proto3d/public/art/**` の 20 ファイルは、Version 26 の dist の `art/**` と全部同じ中身。

| ファイル | sha256 |
|---|---|
| `art/battle/plains_dirt.webp` | `191b3ec77295d4873b620e0d372a984dc1592703c52847c0c7234516835d2e72` |
| `art/battle/plains_grass.webp` | `34811d3dd3199edcd58716eafd1ab1bf8af3d35380b63605699634ee0948dcc9` |
| `art/battle/plains_road.webp` | `a056505d3e4b57088c2b051da0d9bbeef3e1f51c20024965edacbb8556c7c3bf` |
| `art/faces/ieyasu.webp` | `ca0d186e84412692d0374a54f493d897c2f2d12b2c645f6d9a26a487b9dc0cce` |
| `art/faces/ieyasu_v2.webp` | `47c84481d4ff03b65e92dc55f5353cc5ca4a253ae95b1a252fadf267326dfff3` |
| `art/faces/ishikawa.webp` | `4f9a154cb0d1db076887cfbb9eef24672ac8c3eb69773766f1cedbe987228d6e` |
| `art/faces/ishikawa_v2.webp` | `e66d7776db76653105a4ab17853fc73abc06d3a3011d42ff8111b89b00e92d00` |
| `art/faces/nagamasa.webp` | `1e51b6b29b7cb3bfe113f644bd98cd39268f04a33563a94253edb514940f0eac` |
| `art/faces/nagamasa_v2.webp` | `a1961d1ff3fd87f39eaaecc229edeaec466f576d304bb21017ab9960ee96f641` |
| `art/faces/sakai.webp` | `9575e69559c1985b111597c61973b6f112b7f98e9c46942f968b0304cc7e96be` |
| `art/faces/sakai_v2.webp` | `272ad403eaa0e88ff5033e8b25aa962f119543b8c6bde0b7fbec8bbb57e9e0ed` |
| `art/faces/sakakibara.webp` | `acded0f8d4c907cce623a0efe882804fed749bd3aa718d88f67a2594407ec37e` |
| `art/faces/sakakibara_v2.webp` | `ea06061d940da137337e95ae7b967f0f2064b33f6773fc31735b4174e564e915` |
| `art/faces/tadakatsu.webp` | `b4e754ae51888928a062975406aec932cc8820f97516c7dae1a9443da6c1034c` |
| `art/faces/tadakatsu_v2.webp` | `8c244c8aee0860de4d8c6ba0204ab1becce3b87214159ac03085dcf9d266e4bc` |
| `art/portraits/ieyasu_v2.webp` | `00bfc0b2bc2120f921d86cdf0949717737f54905d6a700d96a90a379b49feb4a` |
| `art/portraits/ishikawa_v2.webp` | `e3d19cac5e8fa730971edb89211782403f20c77e6ab1fd9346858cac1c726f1a` |
| `art/portraits/sakai_v2.webp` | `6c8848dadd64ebd86ceca0891c5113b8f19f93ee4aee7619de11123c065825d6` |
| `art/portraits/tadakatsu_v2.webp` | `a6b14abc67fac5ddbddea38f02c65b80e9e783a66e37e332ca6cf74fdef1cbce` |
| `art/story/council_day.webp` | `d11090122bbf3dbbd36d6c599d0f1678ac6637d9a996ce4c861a747c263e0a9e` |

- 3D の質感：Version 26 の dist の glTF 13 個が指す画像 208 か所（ファイルは 109 個）は、どれも、リポジトリの同じ名前の GLB（`proto3d/public/models/<名前>.glb`）の同じ番号の画像とバイト単位で同じ（PNG の 12 個の sha256 は 1 の表）。

## 5. Version 27 の本番ビルドで、3 の手順をそのまま使った記録（2026-10-13）

ビルドはコミット 924c56f（画面のコードは 44ac1b0 と同じ。その後は道具と記録だけ）。作業メモの置き場の一時の git worktree（vite のキャッシュも自分だけ）で、
[proto3d.md](proto3d.md) の「公開」の行のとおりに作った。前の版の画像を手で戻すことはしていない。

| 手順 | 結果 |
|---|---|
| 2. ビルドの直後：`check-dist.mjs dist-proto3d --baseline <Version 26 の dist-431f5e2> --write-sha256 <作業メモ>/dist-924c56f.sha256` | 問題なし（152 ファイル・62,518,481 バイト。参照：HTML 6・glTF 208・JS 31、中身と拡張子を照らしたファイル 152）。一覧（152 行）を書いた |
| dist を作業メモの `dist-924c56f/`（dist だけを置く置き場）へ写す | — |
| 4. 写した dist へ：`check-dist.mjs <dist-924c56f> --baseline <dist-431f5e2> --sha256 <dist-924c56f.sha256>` | 問題なし（一覧 152 件のうち 152 件が同じ中身）。`sha256sum -c` も全部同じ |
| 同じ一覧へもう一度 `--write-sha256`（壊れた後に書き直す誤りを真似る） | 断った（終わりの値 2「sha256 の一覧が既にあるので上書きしない」）。一覧の中身は変わっていない |
| Version 26 の dist（ビルドの直後の一覧）と比べる | 同じ中身 147 個・変わった 1 個（`index.html`）・新しい 4 個（`assets/` の entry・faceArt・index・practiceView の JS。名前の hash が変わった）・無くなった 4 個（前の名前の同じ 4 個）。**画像 130 個（`art/` 20・`models/` の質感 109（PNG 12・JPEG 97）・`favicon.png`）はすべてバイト単位で同じ**（sha256 と `cmp`）。glTF の JSON 13 個・`assets/` の three の JS と CSS・`style.css`・`battle.css` も同じ |

公開で送るのは 5 ファイル（1,121,511 バイト。`index.html` と JS 4 個）、公開先から消すのは前の名前の JS 4 個。一覧は作業メモの `publish-changes-924c56f.txt`・`.json`。
確かめ（本番の e2e・画面写真）は dist を読むだけで、写真は dist の外の `prod-shots/`・`montage/` に、はじめから JPEG で書いた（変換はしていない）。

## 6. 残っていること

- `--sha256` を付けずに `--baseline` だけで走らせると、テンプレートの URL で読む `models/*.json` が消えた・PNG が途中で切れた・JPEG が同じ名前のまま作り直された、は
  注意（前回にあって今回に無い・中身が違う）にとどまり違反にならない（確かめの見直しの指摘）。公開の手順（3 の 4）は `--sha256` を付けるので、3 つとも止まる
  （見直しで 3 つとも違反になることを確かめた）。今回は手順で守り、道具は変えていない。
- check-dist は npm の script にしていない（手順に書いたコマンドで走らせる）。
- 新しい手順（ビルドの直後に一覧を書く・公開の直前に照らす）での実際の公開は、Version 27 の公開が初めて（取りまとめ役が行う）。
