# 画像素材の記録（Version 22 から）

素材 1 件ごとの「何に使う・誰／どの場面・どう作った・原画と加工版・寸法と容量・利用条件・状態」の一覧です。

- **このファイルは作られた物です。** 正本は `proto3d/assets-src/art-v22/manifest.json` で、`python3 -I proto3d/tools/art-build.py docs` で作り直します（ingest・build・set-… でも作り直します）。手で直さないでください。
- 依頼の原文：`docs/art-v22-request.md`。利用者に送った依頼リスト（ファイル名・用途・寸法・透明・構図・プロンプト）：`docs/art-v22-asset-request.md`。
- **この作業環境では画像を生成できません。** 原画は利用者が ChatGPT で生成して渡します。受け取るまでは、差し替えの仕組みと配置の準備だけを進め、仮の画像のままでは見た目の改善の完了とは扱いません。
- ゲームが読むのは `proto3d/src/art/manifest.gen.json`（file・w・h・kind・bytes・sha256・meta だけ）。正本（プロンプトの参照・原画の記録）はゲームに入れません。
- 原画は `proto3d/assets-src/art-v22/<id>/original.png` に、受け取ったままの中身で保管し、公開版には入れません。公開版に入るのは `proto3d/public/art/` の加工版（WebP）だけです。
- ingest は受け取った原画を `incoming/` から `<id>/original.png` へ **移します**（同じ原画を 2 か所に置かない。`incoming/` には README.md だけが残る）。断った物は `incoming/` に残ります。
- **Version 25 から：** 素材パック（下の「素材パックごとの出どころ」）の原画は **公開リポジトリに入れません。** `ingest-pack` が、展開したパックから記録の sha256・パックの一覧・元の生成結果との関係（画素まで）を確かめて、git に入れない手元の置き場 `proto3d/assets-src/art-v25/originals/` に写します。リポジトリに入るのは記録（sha256・寸法・切り出しの範囲・作り方）と加工版だけです。原画が手元に無い所（新しく clone した所）では、build はその素材を作り直さずに加工版をそのまま使い、check は原画の sha256 の確かめを飛ばしたと表示します。
- **sourceOnly**（原画の記録だけ）の素材は加工版を作りません（Version 24 までの低解像度の人物画：そこから切り出した顔だけを、Version 24 との比べ用に残す）。

## 状況のまとめ

- 受け取り（依頼リスト・パック第 1 版の incoming/）：9 / 11 枚（任意の 1 枚を含む）
- 受け取り（素材パックから ingest-pack）：7 / 7 枚（原画は手元の置き場だけ）
- 加工版：22 / 30 件、合計 1,776,882 バイト（展開後 47,598,940 バイト）
- 利用条件：確認済み（docs/art-v22-asset-request.md §8（加工・配布の可否、実在の人物を題材にすること、クレジットや AI 生成の表示、参考画像を渡したか、確認した規約の名前と日付））

## 一覧

| ID | 状態 | 種類・用途 | 人物・場面 | 原画（受け取りの名前 → 保管） | 加工版（公開） | 寸法 | 容量（バイト） | 作り方・参照 | 利用条件 |
|---|---|---|---|---|---|---|---|---|---|
| `portrait.ieyasu` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.ieyasu を切り出す | 徳川家康（この作品の主人公。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない） | `sengoku_individual_art_v2/portraits/tokugawa_ieyasu.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.ieyasu.png`（git に入れない） | `art/portraits/ieyasu_v2.webp` | 原画 1024×1536 → 968×1532 | 原画 1,859,132 → 182,574（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/tokugawa_ieyasu.png（元の生成結果 originals/portraits/tokugawa_ieyasu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.ieyasu` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 徳川家康（portrait.ieyasu と同じ原画から切り出す） | portrait.ieyasu の原画から切り出し | `art/faces/ieyasu_v2.webp` | 依頼 256×256 → 256×256 | 15,120（上限 30,720） | portrait.ieyasu の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [310, 110, 750, 550] を [x, y, 幅, 高さ] = [310, 110, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `portrait.tadakatsu` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.tadakatsu を切り出す | 本多忠勝（徳川家の家臣・前線の主将。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない） | `sengoku_individual_art_v2/portraits/honda_tadakatsu.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.tadakatsu.png`（git に入れない） | `art/portraits/tadakatsu_v2.webp` | 原画 1024×1536 → 926×1526 | 原画 1,869,089 → 193,960（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/honda_tadakatsu.png（元の生成結果 originals/portraits/honda_tadakatsu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.tadakatsu` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 本多忠勝（portrait.tadakatsu と同じ原画から切り出す） | portrait.tadakatsu の原画から切り出し | `art/faces/tadakatsu_v2.webp` | 依頼 256×256 → 256×256 | 16,898（上限 30,720） | portrait.tadakatsu の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [310, 130, 750, 570] を [x, y, 幅, 高さ] = [310, 130, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `portrait.sakai` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.sakai を切り出す | 酒井忠次（徳川家の重臣。軍議で話す。演習の部隊の武将。ゲーム用の創作デザイン） | `sengoku_individual_art_v2/portraits/sakai_tadatsugu.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.sakai.png`（git に入れない） | `art/portraits/sakai_v2.webp` | 原画 1024×1536 → 1003×1485 | 原画 2,004,967 → 212,364（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/sakai_tadatsugu.png（元の生成結果 originals/portraits/sakai_tadatsugu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.sakai` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 酒井忠次（portrait.sakai と同じ原画から切り出す） | portrait.sakai の原画から切り出し | `art/faces/sakai_v2.webp` | 依頼 256×256 → 256×256 | 17,244（上限 30,720） | portrait.sakai の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [315, 145, 755, 585] を [x, y, 幅, 高さ] = [315, 145, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `portrait.ishikawa` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.ishikawa を切り出す | 石川数正（徳川家の重臣。軍議・第二章の補充で話す。演習の部隊の武将。ゲーム用の創作デザイン） | `sengoku_individual_art_v2/portraits/ishikawa_kazumasa.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.ishikawa.png`（git に入れない） | `art/portraits/ishikawa_v2.webp` | 原画 1024×1536 → 978×1523 | 原画 1,945,964 → 188,908（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/ishikawa_kazumasa.png（元の生成結果 originals/portraits/ishikawa_kazumasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.ishikawa` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 石川数正（portrait.ishikawa と同じ原画から切り出す） | portrait.ishikawa の原画から切り出し | `art/faces/ishikawa_v2.webp` | 依頼 256×256 → 256×256 | 15,826（上限 30,720） | portrait.ishikawa の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [300, 100, 740, 540] を [x, y, 幅, 高さ] = [300, 100, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `portrait.sakakibara` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.sakakibara を切り出す | 榊原康政（演習の部隊の武将。歴史分岐の章の会話には出ない。ゲーム用の創作デザイン） | `sengoku_individual_art_v2/portraits/sakakibara_yasumasa.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.sakakibara.png`（git に入れない） | `art/portraits/sakakibara_v2.webp` | 原画 1024×1536 → 1022×1526 | 原画 2,003,700 → 218,478（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/sakakibara_yasumasa.png（元の生成結果 originals/portraits/sakakibara_yasumasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.sakakibara` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 榊原康政（portrait.sakakibara と同じ原画から切り出す） | portrait.sakakibara の原画から切り出し | `art/faces/sakakibara_v2.webp` | 依頼 256×256 → 256×256 | 18,404（上限 30,720） | portrait.sakakibara の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [325, 105, 765, 545] を [x, y, 幅, 高さ] = [325, 105, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `portrait.nagamasa` | 加工済み（見た目の確認待ち） | 人物画：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.nagamasa を切り出す | 浅井長政（合戦の部隊の武将：第一章 A は敵・B は味方、第二章 B、演習の援軍救出。会話には出ない。ゲーム用の創作デザイン） | `sengoku_individual_art_v2/portraits/azai_nagamasa.png` → 手元の `proto3d/assets-src/art-v25/originals/portrait.nagamasa.png`（git に入れない） | `art/portraits/nagamasa_v2.webp` | 原画 1024×1536 → 877×1522 | 原画 1,902,520 → 198,598（上限 266,240） | 利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/azai_nagamasa.png（元の生成結果 originals/portraits/azai_nagamasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `face.nagamasa` | 加工済み（見た目の確認待ち） | 顔（人物画から切り出し）：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す | 浅井長政（portrait.nagamasa と同じ原画から切り出す） | portrait.nagamasa の原画から切り出し | `art/faces/nagamasa_v2.webp` | 依頼 256×256 → 256×256 | 16,252（上限 30,720） | portrait.nagamasa の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [300, 110, 740, 550] を [x, y, 幅, 高さ] = [300, 110, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）。参考画像：なし | 確認済み |
| `bg.council` | 加工済み（見た目の確認待ち） | 物語の背景：軍議の画面の背景（昼の軍議所）。人物画と選択肢をこの上に重ねる。Version 25 から素材パック第 2 版の council_day を比べる候補として使う（原寸 1664×936 で、1920px の原画の要件には届かない。原寸以内で表示できる所だけで比べる） | 昼の軍議所（城内の木造屋根と無地の陣幕。人物・旗・家紋・文字なし。左側に人物を重ねる余白：パックの記録） | `sengoku_individual_art_v2/backgrounds/council_day.png` → 手元の `proto3d/assets-src/art-v25/originals/bg.council.png`（git に入れない） | `art/story/council_day.webp` | 原画 1664×936 → 1664×936 | 原画 2,574,990 → 220,696（上限 460,800） | 利用者が OpenAI の画像生成機能で 1 場面ずつ単独に生成した背景。素材パック sengoku_individual_art_v2 の backgrounds/council_day.png（元の生成結果 originals/backgrounds/council_day.png 1672×941 の (4, 2) から 1664×936 を切り詰めた物。拡大なし）を原画として受け取る。パックに記録なし（生成 ID だけがある）（2026-10-10（素材パックの作成日））。参考画像：報告待ち | 確認済み |
| `bg.council.front` | 依頼済み | 背景の手前の重ね：（任意）軍議の手前の柱と幕の端。背景の手前にわずかにずらして重ね、奥行きを出す | 軍議の陣幕の手前の左右の柱と幕の布の端（中央は透明） | `bg_council_front.png`（未着）・任意 | `art/story/council_front.webp`（未作成） | 依頼 1536×1024 | （上限 225,280） | ChatGPT で利用者が生成。docs/art-v22-asset-request.md §5.2 #4。参考画像：報告待ち | 未確認 |
| `tex.plains.grass` | 確認済み | 地面の色の素材：大平原の合戦の地面（草地）の色の素材（繰り返して貼る） | 初夏の日本の平野の短い草地（真上から。依頼では約 8m 四方。ゲームでは 1 枚 4 m 四方（暫定）で繰り返して貼る） | `tex_plains_grass.png` → `proto3d/assets-src/art-v22/tex.plains.grass/original.png` | `art/battle/plains_grass.webp` | 原画 512×512 → 512×512 | 原画 551,954 → 80,452（上限 327,680） | 利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（354×354px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_grass.png）。パック自身が切り出しを 1.45 倍に拡大しているので、細部は 354px 分しか無い。docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `tex.plains.dirt` | 確認済み | 地面の色の素材：大平原の合戦の地面（裸の土。草地の中のむら・境目）の色の素材 | 乾いて踏み固められた裸の土（真上から。依頼では約 8m 四方。ゲームでは 1 枚 6 m 四方で繰り返して貼る） | `tex_plains_dirt.png` → `proto3d/assets-src/art-v22/tex.plains.dirt/original.png` | `art/battle/plains_dirt.webp` | 原画 512×512 → 512×512 | 原画 516,492 → 65,852（上限 327,680） | 利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（354×354px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_dirt.png）。パック自身が切り出しを 1.45 倍に拡大しているので、細部は 354px 分しか無い。docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `tex.plains.road` | 確認済み | 地面の色の素材：大平原の合戦の道の表面の色の素材（地形データの道の範囲だけに貼る） | 人や馬に踏み固められた土の道の表面（真上から。道の縁・形は描かない） | `tex_plains_road.png` → `proto3d/assets-src/art-v22/tex.plains.road/original.png` | `art/battle/plains_road.webp` | 原画 512×512 → 512×512 | 原画 376,674 → 35,450（上限 327,680） | 利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（346×346px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_road.png）。パック自身が切り出しを 1.48 倍に拡大しているので、細部は 346px 分しか無い。docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `tex.plains.forest` | 作り直し待ち | 地面の色の素材：大平原の合戦の林の範囲の地面（林床）の色の素材。不採用（2026-10-09 の判断）：林は Version 21 の色のまま | 松林の地面（落ち葉・松葉・苔・低い下草。真上から。木の幹・根・影は描かない） | `tex_plains_forest.png`（受け取ったが使えない：not-adopted） | `art/battle/plains_forest.webp`（未作成） | 依頼 1024×1024 | （上限 327,680） | 利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（280×280px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_forest.png）。パック自身が切り出しを 1.83 倍に拡大しているので、細部は 280px 分しか無い。docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `portrait.pack1.ieyasu` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.ieyasu の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 徳川家康（この作品の主人公。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない） | `portrait_ieyasu.png` → `proto3d/assets-src/art-v22/portrait.ieyasu/original.png` | `art/portraits/ieyasu_pack1.webp`（未作成） | 原画 347×471 | 原画 343,783（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_ieyasu_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.ieyasu` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 徳川家康（portrait.pack1.ieyasu と同じ原画から切り出す） | portrait.pack1.ieyasu の原画から切り出し | `art/faces/ieyasu.webp` | 依頼 256×256 → 256×256 | 13,762（上限 30,720） | portrait.pack1.ieyasu の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |
| `portrait.pack1.tadakatsu` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.tadakatsu の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 本多忠勝（徳川家の家臣・前線の主将。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない） | `portrait_tadakatsu.png` → `proto3d/assets-src/art-v22/portrait.tadakatsu/original.png` | `art/portraits/tadakatsu_pack1.webp`（未作成） | 原画 348×471 | 原画 326,724（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_tadakatsu_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.tadakatsu` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 本多忠勝（portrait.pack1.tadakatsu と同じ原画から切り出す） | portrait.pack1.tadakatsu の原画から切り出し | `art/faces/tadakatsu.webp` | 依頼 256×256 → 256×256 | 12,714（上限 30,720） | portrait.pack1.tadakatsu の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |
| `portrait.pack1.sakai` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.sakai の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 酒井忠次（徳川家の重臣。軍議で話す。演習の部隊の武将。ゲーム用の創作デザイン） | `portrait_sakai.png` → `proto3d/assets-src/art-v22/portrait.sakai/original.png` | `art/portraits/sakai_pack1.webp`（未作成） | 原画 203×270 | 原画 106,801（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_sakai_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.sakai` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 酒井忠次（portrait.pack1.sakai と同じ原画から切り出す） | portrait.pack1.sakai の原画から切り出し | `art/faces/sakai.webp` | 依頼 256×256 → 256×256 | 11,368（上限 30,720） | portrait.pack1.sakai の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |
| `portrait.pack1.ishikawa` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.ishikawa の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 石川数正（徳川家の重臣。軍議・第二章の補充で話す。演習の部隊の武将。ゲーム用の創作デザイン） | `portrait_ishikawa.png` → `proto3d/assets-src/art-v22/portrait.ishikawa/original.png` | `art/portraits/ishikawa_pack1.webp`（未作成） | 原画 250×319 | 原画 159,441（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_ishikawa_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.ishikawa` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 石川数正（portrait.pack1.ishikawa と同じ原画から切り出す） | portrait.pack1.ishikawa の原画から切り出し | `art/faces/ishikawa.webp` | 依頼 256×256 → 256×256 | 14,370（上限 30,720） | portrait.pack1.ishikawa の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |
| `portrait.pack1.sakakibara` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.sakakibara の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 榊原康政（演習の部隊の武将。歴史分岐の章の会話には出ない。ゲーム用の創作デザイン） | `portrait_sakakibara.png` → `proto3d/assets-src/art-v22/portrait.sakakibara/original.png` | `art/portraits/sakakibara_pack1.webp`（未作成） | 原画 247×319 | 原画 156,773（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_sakakibara_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.sakakibara` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 榊原康政（portrait.pack1.sakakibara と同じ原画から切り出す） | portrait.pack1.sakakibara の原画から切り出し | `art/faces/sakakibara.webp` | 依頼 256×256 → 256×256 | 12,832（上限 30,720） | portrait.pack1.sakakibara の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |
| `portrait.pack1.nagamasa` | 受け取り済み（原画の記録だけ） | 人物画：Version 24 までの顔 face.pack1.nagamasa の元の原画（記録だけ）。立ち絵には使わない（低解像度） | 浅井長政（合戦の部隊の武将：第一章 A は敵・B は味方、第二章 B、演習の援軍救出。会話には出ない。ゲーム用の創作デザイン） | `portrait_nagamasa.png` → `proto3d/assets-src/art-v22/portrait.nagamasa/original.png` | `art/portraits/nagamasa_pack1.webp`（未作成） | 原画 248×261 | 原画 136,004（上限 266,240） | 利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_nagamasa_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）。docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（2026-10-08（素材パックの作成日））。参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md） | 確認済み |
| `face.pack1.nagamasa` | 確認済み | 顔（人物画から切り出し）：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う | 浅井長政（portrait.pack1.nagamasa と同じ原画から切り出す） | portrait.pack1.nagamasa の原画から切り出し | `art/faces/nagamasa.webp` | 依頼 256×256 → 256×256 | 14,760（上限 30,720） | portrait.pack1.nagamasa の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）。参考画像：なし | 確認済み |

## 合戦の地面（素材ごとの採用と、旧表示との比べ方。Version 23 から）

- 地面の素材は **種類ごとに** 使う・使わないを決める（Version 22 の「4 枚そろわないと使わない」はやめた。`proto3d/src/battle/groundArt.ts`）。一覧（manifest.gen.json）に無い・読めない・URL で外した種類は、その種類だけ Version 21 の見た目で描く：草地 #7a8f4c・林 #465f33（どちらも Version 21 と同じゆるいむら）・道は Version 21 の道の帯（幅 0.8 倍・ゆるい揺れ）・土のむらは無し。土のむらは草地の素材の上の斑なので、草地を使わないときは土のむらも使わない。縁は決まりの地形の形（型紙）で決めるので、地形の境界・通行・視界・合戦の判定は変わらない。1 種類も使えなければ Version 21 と同じ頂点の色の地面と道の帯のまま。
- 同じ模様が 1 枚ごとの格子に並んで見えないように、素材を読む位置をなめらかな雑音でゆるくゆがめる（素材 3 枚ほどの大きさで ±0.25 枚・1.25 枚ほどで ±0.1 枚）。ふつうの画質ではさらに、ずらした 2 か所を雑音で選んで境目だけ混ぜる（低い画質 `?q=low` は 1 回だけ読む）。草地の 1 枚 4 m は暫定（ふつうの寄りと拡大で確かめる）。
- 使っている種類：`tex.plains.grass`（1 枚 4m 四方・512px）、`tex.plains.dirt`（1 枚 6m 四方・512px）、`tex.plains.road`（1 枚 5m 四方・512px）。使っていない種類：`tex.plains.forest`（作り直し待ち：not-adopted）。
- 林床を使わない間は、林は Version 21 の色のまま、円の林に木も植えない（木を植えるのは林床の素材を使うときだけ）。違いは林の縁だけ：頂点の 4〜6 m の格子でぎざぎざだった縁が、決まりの円の縁になる。
- 旧表示との比べ方（URL。保存には何も書かない。`#` の後ろに書いてもよい）：
  - `?art=old`：新しい素材を 1 つも使わない（Version 21 と同じ。顔も出さない）。
  - `?artOff=grass`：草地を Version 21 の色に（土のむらも外す。道の素材は使う）。`?artOff=road`：道だけ Version 21 の道の帯。`?artOff=dirt`：土のむらだけ外す。`?artOff=grass,road` のようにコンマで続けて書ける（grass・dirt・road・forest）。
  - `?artOff=ground`：地面の 4 種類とも外す（地面は Version 21 と同じ。顔は出る）。

## 原画と加工版の対応

| 加工版 | 元の原画 | 原画の sha256 | 加工版の sha256 | 展開後の大きさ |
|---|---|---|---|---|
| `art/portraits/ieyasu_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.ieyasu.png`（手元だけ・git に入れない） | ca9840353b14fa1d… | 00bfc0b2bc2120f9… | 5,931,904 |
| `art/faces/ieyasu_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.ieyasu.png`（手元だけ・git に入れない） | ca9840353b14fa1d… | 47c84481d4ff03b6… | 262,144 |
| `art/portraits/tadakatsu_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.tadakatsu.png`（手元だけ・git に入れない） | ef76a6e6b9b45c08… | a6b14abc67fac5dd… | 5,652,304 |
| `art/faces/tadakatsu_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.tadakatsu.png`（手元だけ・git に入れない） | ef76a6e6b9b45c08… | 8c244c8aee0860de… | 262,144 |
| `art/portraits/sakai_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.sakai.png`（手元だけ・git に入れない） | 86d42a3d4f345dca… | 6c8848dadd64ebd8… | 5,957,820 |
| `art/faces/sakai_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.sakai.png`（手元だけ・git に入れない） | 86d42a3d4f345dca… | 272ad403eaa0e88f… | 262,144 |
| `art/portraits/ishikawa_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.ishikawa.png`（手元だけ・git に入れない） | eb973fe84ce8a81c… | e3d19cac5e8fa730… | 5,957,976 |
| `art/faces/ishikawa_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.ishikawa.png`（手元だけ・git に入れない） | eb973fe84ce8a81c… | e66d7776db766531… | 262,144 |
| `art/portraits/sakakibara_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.sakakibara.png`（手元だけ・git に入れない） | 20f53f6dfefd5069… | 56f7114b2ade10ce… | 6,238,288 |
| `art/faces/sakakibara_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.sakakibara.png`（手元だけ・git に入れない） | 20f53f6dfefd5069… | ea06061d940da137… | 262,144 |
| `art/portraits/nagamasa_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.nagamasa.png`（手元だけ・git に入れない） | 65bd5782e552272e… | a850618a5442eea9… | 5,339,176 |
| `art/faces/nagamasa_v2.webp` | `proto3d/assets-src/art-v25/originals/portrait.nagamasa.png`（手元だけ・git に入れない） | 65bd5782e552272e… | a1961d1ff3fd87f3… | 262,144 |
| `art/story/council_day.webp` | `proto3d/assets-src/art-v25/originals/bg.council.png`（手元だけ・git に入れない） | 5af484b435754e07… | d11090122bbf3dbb… | 6,230,016 |
| `art/story/council_front.webp` | （bg.council.front 未着） | — | — | — |
| `art/battle/plains_grass.webp` | `proto3d/assets-src/art-v22/tex.plains.grass/original.png` | d725dfcd6031fefc… | 34811d3dd3199edc… | 1,048,576（GPU・ミップマップ込み 1,398,101） |
| `art/battle/plains_dirt.webp` | `proto3d/assets-src/art-v22/tex.plains.dirt/original.png` | 756d5117bbde2baf… | 191b3ec77295d487… | 1,048,576（GPU・ミップマップ込み 1,398,101） |
| `art/battle/plains_road.webp` | `proto3d/assets-src/art-v22/tex.plains.road/original.png` | f500281ec2302d8a… | a056505d3e4b5708… | 1,048,576（GPU・ミップマップ込み 1,398,101） |
| `art/battle/plains_forest.webp` | （tex.plains.forest 未着） | — | — | — |
| `art/portraits/ieyasu_pack1.webp` | `proto3d/assets-src/art-v22/portrait.ieyasu/original.png` | 1edfb14632b66cb6… | — | — |
| `art/faces/ieyasu.webp` | `proto3d/assets-src/art-v22/portrait.ieyasu/original.png` | 1edfb14632b66cb6… | ca0d186e84412692… | 262,144 |
| `art/portraits/tadakatsu_pack1.webp` | `proto3d/assets-src/art-v22/portrait.tadakatsu/original.png` | 209692d2ba74200d… | — | — |
| `art/faces/tadakatsu.webp` | `proto3d/assets-src/art-v22/portrait.tadakatsu/original.png` | 209692d2ba74200d… | b4e754ae51888928… | 262,144 |
| `art/portraits/sakai_pack1.webp` | `proto3d/assets-src/art-v22/portrait.sakai/original.png` | df5ce7f04ea20449… | — | — |
| `art/faces/sakai.webp` | `proto3d/assets-src/art-v22/portrait.sakai/original.png` | df5ce7f04ea20449… | 9575e69559c1985b… | 262,144 |
| `art/portraits/ishikawa_pack1.webp` | `proto3d/assets-src/art-v22/portrait.ishikawa/original.png` | f1716d695d3769e0… | — | — |
| `art/faces/ishikawa.webp` | `proto3d/assets-src/art-v22/portrait.ishikawa/original.png` | f1716d695d3769e0… | 4f9a154cb0d1db07… | 262,144 |
| `art/portraits/sakakibara_pack1.webp` | `proto3d/assets-src/art-v22/portrait.sakakibara/original.png` | df74ac4eda553a98… | — | — |
| `art/faces/sakakibara.webp` | `proto3d/assets-src/art-v22/portrait.sakakibara/original.png` | df74ac4eda553a98… | acded0f8d4c907cc… | 262,144 |
| `art/portraits/nagamasa_pack1.webp` | `proto3d/assets-src/art-v22/portrait.nagamasa/original.png` | ee12b4f2fa6e1610… | — | — |
| `art/faces/nagamasa.webp` | `proto3d/assets-src/art-v22/portrait.nagamasa/original.png` | ee12b4f2fa6e1610… | 1e51b6b29b7cb3bf… | 262,144 |

## 素材パックごとの出どころ（Version 25 から）

### `request-v22`：Version 22 の依頼リスト（docs/art-v22-asset-request.md）。利用者が生成して incoming/ に置く（まだ届いていない物だけが残る：bg.council.front）

- 説明：Version 22 の依頼リスト（docs/art-v22-asset-request.md）。利用者が生成して incoming/ に置く（まだ届いていない物だけが残る：bg.council.front）
- 原画の置き場：proto3d/assets-src/art-v22/<id>/original.png
- 原画をリポジトリに入れるか：入れる

### `pack-v1`：sengoku_art_pack_v1

- 受け取った日：2026-10-08
- 説明：ZIP sengoku_characters_landscapes_v1.zip。ChatGPT の画像生成のデザインシートから切り出した低解像度の人物・風景・地面の素材
- 判断：人物画・背景は低解像度のため不採用（利用者の判断 2026-10-09。不採用のまま）。顔 6 枚は Version 22〜24 で使い、Version 25 からは Version 24 と比べる表示（?art=v24）だけ。地面（草地・土・道）は Version 23 から使い、変えない。林床は不採用
- 写した文書：proto3d/assets-src/art-v22/pack-v1/（パックの説明・一覧の写し。画像は入れない）
- 原画の置き場：proto3d/assets-src/art-v22/<Version 24 までの ID>/original.png
- 原画をリポジトリに入れるか：入れる
- 使う物：大平原の地面 tex.plains.grass・tex.plains.dirt・tex.plains.road（Version 23 から。変えない）、顔 face.pack1.*（6 人。Version 24 と比べる表示だけ）
- 使わない物（公開しない）：人物画（portrait.pack1.*。原画の記録だけ）・背景・林床・織田信長・朝倉義景

### `pack-v2`：sengoku_individual_art_v2

- 受け取った日：2026-10-10
- パックの作成日：2026-10-10
- 説明：利用者が OpenAI の画像生成機能で 1 人・1 場面ずつ単独に生成した個別の原画のパック（一覧ポスター・その切り抜きではない：パックの README）。人物 8 枚（1024×1536 RGBA。腰より下までの半身）・背景 3 枚（元 1672×941 → 端を切り詰めた 16:9 の 1664×936）・林床 1 枚（元 1254×1254 → 1024×1024）と、その縮小版（web/）・同じ人物画からの顔の切り出し（faces/）・記録。78 ファイル（画像 68 枚）。上限に合わせて 3 つの ZIP に分けて届いた（同じ名前の文書は 3 つとも同じ中身）
- 写した文書：proto3d/assets-src/art-v25/pack-v2/（characters_and_scenes.json・asset_manifest.json・docs/PROVENANCE_AND_USAGE.md・docs/image_validation.json の写し。画像は入れない）
- 原画の置き場：手元の proto3d/assets-src/art-v25/originals/<id>.png（.gitignore。ingest-pack が写す）。パックそのものは利用者の手元にある
- 検査：受け取った時：パックの検査スクリプト（パックの外の一時フォルダから隔離モードで実行）が PASS（画像 68 枚の寸法・sha256・人物画の PNG の形式）、checksums.sha256 の 77 件が一致、ZIP 3 つの sha256 が一致。ingest-pack：使う 7 枚の sha256・パックの一覧・元の生成結果との関係を画素まで確かめた。パックの faces/256・faces/128 は、portraits/ を face_crop_xyxy で切り出して Lanczos で縮めた物と画素まで一致した（こちらは同じ範囲を原画から作り直す）
- 原画をリポジトリに入れるか：**入れない**（記録の sha256 だけ。手元の置き場は .gitignore）
- ZIP `sengoku_art_v2_under30MB_1_of_3.zip`：18,699,025 バイト・sha256 `83913436d7f657d079d60027a3f5e7cd6c2dde90cc7fdb672c95c84ecf9d7231`（徳川家康・本多忠勝・酒井忠次・石川数正の人物の素材と共通の文書）
- ZIP `sengoku_art_v2_under30MB_2_of_3.zip`：18,784,355 バイト・sha256 `c8d0ace67e54069270d7b0f1f139abe68060eeca317013665de440e148697739`（榊原康政・織田信長・浅井長政・朝倉義景の人物の素材と共通の文書）
- ZIP `sengoku_art_v2_under30MB_3_of_3.zip`：25,171,727 バイト・sha256 `5b9fd32edc1131367048d4cccdaa5169fe11d4c3eb3e830e562feedb09842e61`（背景 3 枚・林床の素材と共通の文書）
- 文書 `README.md`：4,523 バイト・sha256 `13eb0df0a4665dca1855eef466bd725d8d99ab8729648f07ac051cbc465d3944`（パックの説明（写さない。要点はこの記録と docs/third-party-assets.md））
- 文書 `asset_manifest.json`：33,186 バイト・sha256 `143fb1e57390d8ccd75bf066bdb8e1ab204094aaa3cc20b81836b0d321646016`（画像 68 枚の寸法・容量・sha256。写しを proto3d/assets-src/art-v25/pack-v2/ に置く）
- 文書 `characters_and_scenes.json`：7,371 バイト・sha256 `92394669ab44e7c74c538f8297f5057fca05c11d38bf33c987f49afd8db37386`（人物・場面の名前・生成 ID・外見・顔の範囲。写しを置く）
- 文書 `checksums.sha256`：7,583 バイト・sha256 `d7369968242b792f96ba06f6967a048d240ab769fe33eec11cccb3d05e0a3b40`（ほかの 77 ファイルの sha256（受け取った時に全部一致））
- 文書 `docs/PROVENANCE_AND_USAGE.md`：2,463 バイト・sha256 `51f090053de4276abc7b52f4f5ed0d37181fe21e68ca1a6fdbb207c64c316dc8`（制作元と利用条件の記録。写しを置く）
- 文書 `docs/image_inventory.csv`：11,113 バイト・sha256 `5772e7f98d1ad7038aa68b4e0eee50c27bb856b8942bd3baa782270d9a7f2109`（asset_manifest.json と同じ一覧の CSV（写さない））
- 文書 `docs/image_validation.json`：3,795 バイト・sha256 `f540567de999a7a34c99863b3678a6312c6caf900618d6e810c9467fa962ec27`（人物画の透明の範囲・端の検査の記録。写しを置く）
- 文書 `preview.html`：4,110 バイト・sha256 `0401a81717479c42cfcffc9c0414a0a836c235608362aea6871b196e2ed61e3c`（画像を見るだけの確認ページ（使わない・写さない））
- 文書 `verify_pack.py`：1,317 バイト・sha256 `88a9e34b9e68499b5d4c8d6a7869d3252f599d2812af9c994164e8bf41b6bc4b`（パックの検査スクリプト（パックの外の一時フォルダから隔離モードで実行して PASS。写さない））
- 文書 `（最上位の取り込みの指示書 .txt）`：5,378 バイト・sha256 `b08feaa21ca3a671c778762c1955dd444649707fd8fc13fbeaec336dc7c95a2f`（実装担当への取り込みの指示（要点は docs/third-party-assets.md。写さない））
- 使う物：人物画 6 枚（徳川家康・本多忠勝・酒井忠次・石川数正・榊原康政・浅井長政）→ portrait.<武将>（原寸の WebP）、同じ 6 枚の原画から顔 → face.<武将>（256×256。範囲はパックの face_crop_xyxy）、背景 council_day（昼の軍議所）→ bg.council（原寸 1664×936 の WebP。比べる候補）
- 予約（保管だけ。公開しない）：織田信長・朝倉義景の人物画と顔（oda_nobunaga・asakura_yoshikage）：画面に出る登場人物・部隊が無いので公開しない。絵を使うためだけに NPC・部隊・会話を足さない。手元の置き場にも写さない（パックとして利用者の手元に保管）
- 使わない物（公開しない）：castle_town_day（昼の城下町）・plains_vista_day（大平原の遠景）：物語の背景の候補。今は使う画面を決めておらず公開しない（歩ける 3D の町・合戦の地図の代わりにはしない）、terrain/forest_floor（林床）：任意の比較候補。継ぎ目・縮尺が未確認で、地面は今の草・土・道のまま。公開しない、web/（パックの縮小・圧縮版。人物 768×1152・背景 1440×810）・faces/（パックの顔。同じ範囲で原画から作り直す）：使わない、originals/（元の生成結果）：受け取る物との関係の確かめだけに使う。公開しない、確認ページ・検査スクリプト：使わない
- 利用条件の記録（利用者の記録。法的な保証ではない）：利用者と OpenAI の間では、適用法で認められる範囲で利用者が出力を所有する（Terms of Use の Content / Ownership of content）。出力は独自とは限らず、他者へ似た出力が提供されうる（Similarity of content）。入力・出力の利用の責任、第三者の権利の尊重、人が生成したと偽らないことなどの条件がある。パックの作成者は独自の再配布禁止・素材の再販売禁止・クレジット必須などの条件を付けない。以前の生成の一覧画像に書かれていた利用条件は、このパックの条件ではない。著作権の発生・排他性・第三者の権利の非侵害は保証されない。ゲームの「一部の人物・背景画像はAI生成画像を加工して使用」の明示は、実際に使う範囲に合わせて保つ。この記録は法的な保証ではない（確認日 2026-10-10・パックの docs/PROVENANCE_AND_USAGE.md（利用者の記録）。確認したページ https://openai.com/policies/terms-of-use/（2026-01-01 発効の表示））


## 素材ごとの記録

### `portrait.ieyasu`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.ieyasu を切り出す
- 人物・場面：徳川家康（この作品の主人公。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.ieyasu の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/tokugawa_ieyasu.png（元の生成結果 originals/portraits/tokugawa_ieyasu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/tokugawa_ieyasu.png`（1024×1536・1,859,132 バイト・sha256 `ca9840353b14fa1d76c5fd2db71b932c9a583e409786d571b8ec8f2be8425094`・ZIP `sengoku_art_v2_under30MB_1_of_3.zip`）
  - パックの名前（key）：tokugawa_ieyasu。表示名：徳川家康。生成 ID：61a12f96-3a0f-4907-ac23-5e8ffcb36efd。外見の記録：藍色の小袖、口髭と短い顎髭。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[310, 110, 750, 550]
  - 元の生成結果：`originals/portraits/tokugawa_ieyasu.png`（2,449,510 バイト・sha256 `f9424b6a92a2254e05085de8de8d3f9e467d20e906a1ebadd0f95310bc6ba142`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.ieyasu.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/tokugawa_ieyasu.png`）1024×1536・PNG RGBA・1,859,132 バイト・sha256 `ca9840353b14fa1d76c5fd2db71b932c9a583e409786d571b8ec8f2be8425094`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 893949}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 664.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/ieyasu_v2.webp` 968×1532・182,574 バイト（上限 266,240）・品質 85・sha256 `00bfc0b2bc2120f921d86cdf0949717737f54905d6a700d96a90a379b49feb4a`・meta {"shoulderY": 0.4308}
  - 処理の記録：{"trimBox": [54, 4, 1022, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.654}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.ieyasu`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：徳川家康（portrait.ieyasu と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [310, 110, 750, 550]（パックの faces/256 と同じ範囲）
- 作り方：portrait.ieyasu の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [310, 110, 750, 550] を [x, y, 幅, 高さ] = [310, 110, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.ieyasu` の原画（同じ原画から切り出す）。faceRect：[310, 110, 440, 440]
- 加工の手順：
  1. portrait.ieyasu の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/ieyasu_v2.webp` 256×256・15,120 バイト（上限 30,720）・品質 85・sha256 `47c84481d4ff03b65e92dc55f5353cc5ca4a253ae95b1a252fadf267326dfff3`
  - 処理の記録：{"faceRect": [310, 110, 440, 440], "squareRect": [310, 110, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.ieyasu と同じ

### `portrait.tadakatsu`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.tadakatsu を切り出す
- 人物・場面：本多忠勝（徳川家の家臣・前線の主将。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.tadakatsu の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/honda_tadakatsu.png（元の生成結果 originals/portraits/honda_tadakatsu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/honda_tadakatsu.png`（1024×1536・1,869,089 バイト・sha256 `ef76a6e6b9b45c08606948924af364044b80561b8db8ac7d2fdd59149108b48a`・ZIP `sengoku_art_v2_under30MB_1_of_3.zip`）
  - パックの名前（key）：honda_tadakatsu。表示名：本多忠勝。生成 ID：c812c25e-4f72-4b38-be8e-06029dcc279b。外見の記録：松葉色の小袖、髭なし、幅のある肩。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[310, 130, 750, 570]
  - 元の生成結果：`originals/portraits/honda_tadakatsu.png`（2,470,511 バイト・sha256 `26e070616d47e4daaee1e786b4fa829f32a34f1f64cf6b1cca4dc6e11b38fd20`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.tadakatsu.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/honda_tadakatsu.png`）1024×1536・PNG RGBA・1,869,089 バイト・sha256 `ef76a6e6b9b45c08606948924af364044b80561b8db8ac7d2fdd59149108b48a`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 867587}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 699.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/tadakatsu_v2.webp` 926×1526・193,960 バイト（上限 266,240）・品質 85・sha256 `a6b14abc67fac5ddbddea38f02c65b80e9e783a66e37e332ca6cf74fdef1cbce`・meta {"shoulderY": 0.4515}
  - 処理の記録：{"trimBox": [55, 10, 981, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.759}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.tadakatsu`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：本多忠勝（portrait.tadakatsu と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [310, 130, 750, 570]（パックの faces/256 と同じ範囲）
- 作り方：portrait.tadakatsu の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [310, 130, 750, 570] を [x, y, 幅, 高さ] = [310, 130, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.tadakatsu` の原画（同じ原画から切り出す）。faceRect：[310, 130, 440, 440]
- 加工の手順：
  1. portrait.tadakatsu の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/tadakatsu_v2.webp` 256×256・16,898 バイト（上限 30,720）・品質 85・sha256 `8c244c8aee0860de4d8c6ba0204ab1becce3b87214159ac03085dcf9d266e4bc`
  - 処理の記録：{"faceRect": [310, 130, 440, 440], "squareRect": [310, 130, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.tadakatsu と同じ

### `portrait.sakai`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.sakai を切り出す
- 人物・場面：酒井忠次（徳川家の重臣。軍議で話す。演習の部隊の武将。ゲーム用の創作デザイン）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.sakai の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/sakai_tadatsugu.png（元の生成結果 originals/portraits/sakai_tadatsugu.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/sakai_tadatsugu.png`（1024×1536・2,004,967 バイト・sha256 `86d42a3d4f345dcac5c5c58a6307f27d8beb22dd1499da720f56c7286a279b0e`・ZIP `sengoku_art_v2_under30MB_1_of_3.zip`）
  - パックの名前（key）：sakai_tadatsugu。表示名：酒井忠次。生成 ID：533a2ee6-8b75-4afc-9a4e-9dbab65309dc。外見の記録：焦茶の小袖、白髪交じりの髪、短い髭。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[315, 145, 755, 585]
  - 元の生成結果：`originals/portraits/sakai_tadatsugu.png`（2,601,233 バイト・sha256 `6d69007737fa405ddba97a1f949976ff713c6e1832f65a218325b2efb46bb1af`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.sakai.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/sakai_tadatsugu.png`）1024×1536・PNG RGBA・2,004,967 バイト・sha256 `86d42a3d4f345dcac5c5c58a6307f27d8beb22dd1499da720f56c7286a279b0e`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 934669}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 676.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/sakai_v2.webp` 1003×1485・212,364 バイト（上限 266,240）・品質 85・sha256 `6c8848dadd64ebd86ceca0891c5113b8f19f93ee4aee7619de11123c065825d6`・meta {"shoulderY": 0.4209}
  - 処理の記録：{"trimBox": [3, 51, 1006, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.778}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.sakai`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：酒井忠次（portrait.sakai と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [315, 145, 755, 585]（パックの faces/256 と同じ範囲）
- 作り方：portrait.sakai の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [315, 145, 755, 585] を [x, y, 幅, 高さ] = [315, 145, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.sakai` の原画（同じ原画から切り出す）。faceRect：[315, 145, 440, 440]
- 加工の手順：
  1. portrait.sakai の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/sakai_v2.webp` 256×256・17,244 バイト（上限 30,720）・品質 85・sha256 `272ad403eaa0e88ff5033e8b25aa962f119543b8c6bde0b7fbec8bbb57e9e0ed`
  - 処理の記録：{"faceRect": [315, 145, 440, 440], "squareRect": [315, 145, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.sakai と同じ

### `portrait.ishikawa`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.ishikawa を切り出す
- 人物・場面：石川数正（徳川家の重臣。軍議・第二章の補充で話す。演習の部隊の武将。ゲーム用の創作デザイン）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.ishikawa の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/ishikawa_kazumasa.png（元の生成結果 originals/portraits/ishikawa_kazumasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/ishikawa_kazumasa.png`（1024×1536・1,945,964 バイト・sha256 `eb973fe84ce8a81c871efe3629267792693e817cb55c52dc168fb6cf250dd8a1`・ZIP `sengoku_art_v2_under30MB_1_of_3.zip`）
  - パックの名前（key）：ishikawa_kazumasa。表示名：石川数正。生成 ID：44a365a1-722d-4f07-82fd-a492543ee8cc。外見の記録：灰紫の小袖、細い口髭、手に白い書状。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[300, 100, 740, 540]
  - 元の生成結果：`originals/portraits/ishikawa_kazumasa.png`（2,472,623 バイト・sha256 `9e7ced55c6b779d5b34486b6cd59d75f4459b1dd24439de065fe357e53ee322d`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.ishikawa.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/ishikawa_kazumasa.png`）1024×1536・PNG RGBA・1,945,964 バイト・sha256 `eb973fe84ce8a81c871efe3629267792693e817cb55c52dc168fb6cf250dd8a1`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 944846}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 637.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/ishikawa_v2.webp` 978×1523・188,908 バイト（上限 266,240）・品質 85・sha256 `e3d19cac5e8fa730971edb89211782403f20c77e6ab1fd9346858cac1c726f1a`・meta {"shoulderY": 0.4097}
  - 処理の記録：{"trimBox": [46, 13, 1024, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.7}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.ishikawa`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：石川数正（portrait.ishikawa と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [300, 100, 740, 540]（パックの faces/256 と同じ範囲）
- 作り方：portrait.ishikawa の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [300, 100, 740, 540] を [x, y, 幅, 高さ] = [300, 100, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.ishikawa` の原画（同じ原画から切り出す）。faceRect：[300, 100, 440, 440]
- 加工の手順：
  1. portrait.ishikawa の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/ishikawa_v2.webp` 256×256・15,826 バイト（上限 30,720）・品質 85・sha256 `e66d7776db76653105a4ab17853fc73abc06d3a3011d42ff8111b89b00e92d00`
  - 処理の記録：{"faceRect": [300, 100, 440, 440], "squareRect": [300, 100, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.ishikawa と同じ

### `portrait.sakakibara`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.sakakibara を切り出す
- 人物・場面：榊原康政（演習の部隊の武将。歴史分岐の章の会話には出ない。ゲーム用の創作デザイン）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.sakakibara の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/sakakibara_yasumasa.png（元の生成結果 originals/portraits/sakakibara_yasumasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/sakakibara_yasumasa.png`（1024×1536・2,003,700 バイト・sha256 `20f53f6dfefd5069998910afa29fe33e5b9a1f7e929b02e62689815e087d3bce`・ZIP `sengoku_art_v2_under30MB_2_of_3.zip`）
  - パックの名前（key）：sakakibara_yasumasa。表示名：榊原康政。生成 ID：f01c4cc2-7968-45dd-a479-5228ab5b3c47。外見の記録：青灰の小袖、髭なし、細めの輪郭。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[325, 105, 765, 545]
  - 元の生成結果：`originals/portraits/sakakibara_yasumasa.png`（2,608,833 バイト・sha256 `03ed919cd45a4ecc14be0f6c5d3aed3e62b52102d2f302da79d9aa8c00c2a6b6`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.sakakibara.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/sakakibara_yasumasa.png`）1024×1536・PNG RGBA・2,003,700 バイト・sha256 `20f53f6dfefd5069998910afa29fe33e5b9a1f7e929b02e62689815e087d3bce`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 903551}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
  - 右の袖の下の方（原画の y 1145〜1149、上から約 75%）の 5 画素だけが画像の右端に接している（不透明度 128 超。パックの image_validation.json の right_edge_opaque_pixels: 5 と同じ）。左下に置くと、その高さで袖の右の端がまっすぐに切れて見えうる（台詞の枠に隠れるかは画面で確かめる）
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 711.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/sakakibara_v2.webp` 1022×1526・218,478 バイト（上限 266,240）・品質 85・sha256 `56f7114b2ade10ced2a5b623f1c80f696a14927945aa1a9ae492fd7104c96a7b`・meta {"shoulderY": 0.4594}
  - 処理の記録：{"trimBox": [2, 10, 1024, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.633}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.sakakibara`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：榊原康政（portrait.sakakibara と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [325, 105, 765, 545]（パックの faces/256 と同じ範囲）
- 作り方：portrait.sakakibara の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [325, 105, 765, 545] を [x, y, 幅, 高さ] = [325, 105, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.sakakibara` の原画（同じ原画から切り出す）。faceRect：[325, 105, 440, 440]
- 加工の手順：
  1. portrait.sakakibara の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/sakakibara_v2.webp` 256×256・18,404 バイト（上限 30,720）・品質 85・sha256 `ea06061d940da137337e95ae7b967f0f2064b33f6773fc31735b4174e564e915`
  - 処理の記録：{"faceRect": [325, 105, 440, 440], "squareRect": [325, 105, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.sakakibara と同じ

### `portrait.nagamasa`（人物画・加工済み（見た目の確認待ち））

- 用途：会話・軍議の立ち絵（腰より下までの半身。Version 25 から）。同じ原画から顔 face.nagamasa を切り出す
- 人物・場面：浅井長政（合戦の部隊の武将：第一章 A は敵・B は味方、第二章 B、演習の援軍救出。会話には出ない。ゲーム用の創作デザイン）
- 使う所：会話・軍議の立ち絵（画面への組み込みは Version 25 の会話・軍議の作業）、顔 face.nagamasa の元
- 依頼の要点：腰より下までの半身・画面の右寄りの三四分向き。左右反転しない（着物の合わせを逆にしない）。拡大しない
- 作り方：利用者が OpenAI の画像生成機能で、この人物だけを 1 枚ずつ単独に生成した 1024×1536 の人物画（一覧ポスター・デザインシートの切り抜きではない）。素材パック sengoku_individual_art_v2 の portraits/azai_nagamasa.png（元の生成結果 originals/portraits/azai_nagamasa.png の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0 にした物。拡大・反転なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（人物 1 人ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 外見はゲーム用の創作デザイン（実際の容貌・衣装の復元ではなく、年代考証も済んでいない：パックの README）。通常の表情 1 枚・鎧兜なし・無地の和装・腰より下までの半身。人物名・枠・家紋は描かれていない
- 素材パック：sengoku_individual_art_v2 の `portraits/azai_nagamasa.png`（1024×1536・1,902,520 バイト・sha256 `65bd5782e552272e73ad871d499d9543bf0737ff65d86b46ff97eba922cb58e6`・ZIP `sengoku_art_v2_under30MB_2_of_3.zip`）
  - パックの名前（key）：azai_nagamasa。表示名：浅井長政。生成 ID：773217f4-6948-4622-ad4a-688588109c95。外見の記録：淡い青の小袖、髭なし、両手を帯へ。向き・表情：画面右寄りの三四分向き、通常表情。パックの顔の範囲 xyxy：[300, 110, 740, 550]
  - 元の生成結果：`originals/portraits/azai_nagamasa.png`（2,546,370 バイト・sha256 `10ca99e3ef8e7b359155f2de6bbb2a2a578d1700ce766ee0fbf9ced139a5d03a`）。関係：パックの説明どおり、元の生成結果の不透明度 3 以下を 0、250 以上を 255、完全に透明な所の色を 0（拡大・反転なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/portrait.nagamasa.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/portraits/azai_nagamasa.png`）1024×1536・PNG RGBA・1,902,520 バイト・sha256 `65bd5782e552272e73ad871d499d9543bf0737ff65d86b46ff97eba922cb58e6`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "alpha-cleanup", "pixelExact": true, "upstreamAlphaMax": 254, "changedAlphaPx": 849889}
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": null, "faceX": null, "shoulderY": 618.0}
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の portraits/ の PNG を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果（originals/portraits/）から説明どおりの透明の端の整理で作られた物だと画素まで確かめる
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない
  1. 上端と左右の上 6 割がほぼ透明でない構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でないときは下端の注意を記録する
  1. 不透明度 8 以下のかすかな所は完全に透明にする。透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す。頭・髷・肩は切らない）
  1. 拡大も縮小もしない（原寸のまま。PC の立ち絵の高さ 620 CSS px × 端末の画素の比 2 = 1240px より細かい原寸を残す）。左右反転しない
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない（不透明度は元と同じ値）。メタデータは入れない）
- 加工版：`proto3d/public/art/portraits/nagamasa_v2.webp` 877×1522・198,598 バイト（上限 266,240）・品質 85・sha256 `a850618a5442eea9392cb2e24be6d9a2f83afb5696b3861b6c8f49fca856a254`・meta {"shoulderY": 0.3968}
  - 処理の記録：{"trimBox": [107, 14, 984, 1536], "scale": 1.0, "bottomRowOpaqueShare": 0.784}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `face.nagamasa`（顔（人物画から切り出し）・加工済み（見た目の確認待ち））

- 用途：顔（会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 から、立ち絵と同じ原画（素材パック第 2 版）から切り出す
- 人物・場面：浅井長政（portrait.nagamasa と同じ原画から切り出す）
- 使う所：会話・軍議の台詞の枠、合戦の部隊の札・能力の欄・能力の知らせ・演習の編成の表
- 依頼の要点：顔を別に生成し直さない。範囲はパックの face_crop_xyxy [300, 110, 740, 550]（パックの faces/256 と同じ範囲）
- 作り方：portrait.nagamasa の原画から切り出す（顔だけを別に生成しない）。範囲は素材パックの characters_and_scenes.json の face_crop_xyxy [300, 110, 740, 550] を [x, y, 幅, 高さ] = [300, 110, 440, 440] にした物（直していない：顔が真ん中から外れていないことを画像で確かめた）
- 元：`portrait.nagamasa` の原画（同じ原画から切り出す）。faceRect：[300, 110, 440, 440]
- 加工の手順：
  1. portrait.nagamasa の原画（素材パック第 2 版の人物画。不透明度 8 以下は透明にする）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]。パックの face_crop_xyxy と同じ範囲）を切り出す
  1. 正方形にそろえる（パックの範囲は 440×440 の正方形）
  1. 256×256 に縮小（Lanczos。拡大はしない）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない）
- 加工版：`proto3d/public/art/faces/nagamasa_v2.webp` 256×256・16,252 バイト（上限 30,720）・品質 85・sha256 `a1961d1ff3fd87f39eaaecc229edeaec466f576d304bb21017ab9960ee96f641`
  - 処理の記録：{"faceRect": [300, 110, 440, 440], "squareRect": [300, 110, 440, 440], "scale": 0.5818, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.nagamasa と同じ

### `bg.council`（物語の背景・加工済み（見た目の確認待ち））

- 用途：軍議の画面の背景（昼の軍議所）。人物画と選択肢をこの上に重ねる。Version 25 から素材パック第 2 版の council_day を比べる候補として使う（原寸 1664×936 で、1920px の原画の要件には届かない。原寸以内で表示できる所だけで比べる）
- 人物・場面：昼の軍議所（城内の木造屋根と無地の陣幕。人物・旗・家紋・文字なし。左側に人物を重ねる余白：パックの記録）
- 使う所：軍議（.g-layer.council の背景）
- 依頼の要点：パックの backgrounds/ は、元の生成結果 1672×941 の端だけを切り詰めた 16:9。Version 22 の依頼（1536×1024 以上）より横長で、docs/art-v22-asset-request.md §9 の 1920px 以上の要件には届かない。拡大しない（1920px の原画として扱わない）
- 作り方：利用者が OpenAI の画像生成機能で 1 場面ずつ単独に生成した背景。素材パック sengoku_individual_art_v2 の backgrounds/council_day.png（元の生成結果 originals/backgrounds/council_day.png 1672×941 の (4, 2) から 1664×936 を切り詰めた物。拡大なし）を原画として受け取る
  - 生成の機能・モデル：画像生成（1 場面ずつの単独の生成）／報告待ち。生成した日：2026-10-10（素材パックの作成日）
  - プロンプト：パックに記録なし（生成 ID だけがある）（実際に使った文は報告待ち）
  - 参考画像：報告待ち
  - 城の建築・配置は創作で、建築考証は済んでいない（パックの記録）。史実の場所の絵として説明しない
- 素材パック：sengoku_individual_art_v2 の `backgrounds/council_day.png`（1664×936・2,574,990 バイト・sha256 `5af484b435754e07048ab636ca30ee05ebac292a349e05354d5eba6a52c92ec3`・ZIP `sengoku_art_v2_under30MB_3_of_3.zip`）
  - パックの名前（key）：council_day。表示名：昼の軍議所。生成 ID：1465b957-1dcc-45d0-bfbf-867f4eb4177f。外見の記録：城内の木造屋根と無地の陣幕。左側に人物を重ねる余白。
  - 元の生成結果：`originals/backgrounds/council_day.png`（2,758,707 バイト・sha256 `c97f2ab03afd99b51936829a5e2b75be0af1537d325ee1ece6b0901daa741881`）。関係：元の生成結果 1672×941 の (4, 2) から 1664×936 を切り詰めた（16:9。拡大・縮小なし）
- 原画：手元の `proto3d/assets-src/art-v25/originals/bg.council.png`（**git に入れない**。受け取りの名前 `sengoku_individual_art_v2/backgrounds/council_day.png`）1664×936・PNG RGB・2,574,990 バイト・sha256 `5af484b435754e07048ab636ca30ee05ebac292a349e05354d5eba6a52c92ec3`
  - 元の生成結果との関係を ingest-pack が画素まで確かめた：{"type": "crop", "pixelExact": true, "rect": [4, 2, 1664, 936], "upstreamSize": [1672, 941]}
  - 透明：なし（不透明）
  - メタデータ：メタデータの塊は無い
- 加工の手順：
  1. 素材パック sengoku_individual_art_v2 の backgrounds/council_day.png を ingest-pack で受け取る：記録の sha256・パックの一覧と一致し、元の生成結果の端を切り詰めただけの物だと画素まで確かめる
  1. 不透明であることを確かめる
  1. 拡大も縮小もしない（原寸 1664×936 のまま。1920px の原画として扱わない）
  1. WebP（品質 82 から、450KB に収まるまで 4 ずつ下げる。下限 55。メタデータは入れない）
- 加工版：`proto3d/public/art/story/council_day.webp` 1664×936・220,696 バイト（上限 460,800）・品質 82・sha256 `d11090122bbf3dbbd36d6c599d0f1678ac6637d9a996ce4c861a747c263e0a9e`
  - 処理の記録：{"scale": 1.0, "aspect": 1.7778}
- 利用条件：確認済み。利用者が渡した素材パック sengoku_individual_art_v2 の docs/PROVENANCE_AND_USAGE.md（確認日 2026-10-10）。記録の sources.pack-v2.terms を見る。法的な保証ではない

### `bg.council.front`（背景の手前の重ね・依頼済み）

- 用途：（任意）軍議の手前の柱と幕の端。背景の手前にわずかにずらして重ね、奥行きを出す
- 人物・場面：軍議の陣幕の手前の左右の柱と幕の布の端（中央は透明）
- 使う所：軍議（.g-council-bg-front）
- 依頼の要点：bg.council の原画（Version 25 から素材パック第 2 版の 1664×936）と同じ画角・大きさ。中央の約 7 割は完全に透明
- 作り方：ChatGPT で利用者が生成（同じチャット：bg.council）
  - 生成の機能・モデル：報告待ち／報告待ち。生成した日：報告待ち
  - プロンプト：docs/art-v22-asset-request.md §5.2 #4（実際に使った文は報告待ち）
  - 参考画像：報告待ち
- 原画：未着（`incoming/bg_council_front.png`）
- 加工の手順：
  1. 透過の確かめ：本物の透明（全体の 40% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）。中央がほぼ透明でない構図は、断らずに構図の注意として記録する
  1. 透明でなく、柱と幕以外が単色のマゼンタなら色を抜く（記録する）
  1. bg.council の原画と同じ大きさであることを確かめる（ずれると重ならない）。余白は切らない
  1. 拡大しない。幅 1664・高さ 936 に収まるように縮小だけ
  1. WebP（品質 85 から、220KB に収まるまで 5 ずつ下げる。下限 55。透明は劣化させない）
- 利用条件：未確認。利用者に確認を依頼中（docs/art-v22-asset-request.md §8）

### `tex.plains.grass`（地面の色の素材・確認済み）

- 用途：大平原の合戦の地面（草地）の色の素材（繰り返して貼る）
- 人物・場面：初夏の日本の平野の短い草地（真上から。依頼では約 8m 四方。ゲームでは 1 枚 4 m 四方（暫定）で繰り返して貼る）
- 使う所：合戦・大平原の地面（草地）
- 依頼の要点：真上から・均一な光・影や遠近なし。青・赤茶の点や塊なし（軍勢の色と紛れる）
- 作り方：利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（354×354px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_grass.png）。パック自身が切り出しを 1.45 倍に拡大しているので、細部は 354px 分しか無い（同じチャット：tex.plains.dirt、tex.plains.road、tex.plains.forest）
  - 生成の機能・モデル：画像生成（デザインシートの出力。地面 1 枚ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
- 原画：`proto3d/assets-src/art-v22/tex.plains.grass/original.png`（受け取りの名前 `tex_plains_grass.png`）512×512・PNG RGB・551,954 バイト・sha256 `d725dfcd6031fefcde9969fd0222836b676645beefae73ac7f032f83fa599dbd`
  - 透明：なし（不透明）
  - メタデータ：メタデータの塊は無い
  - 依頼の大きさ 1024×1024 と違う（512×512）。拡大はしない
- 加工の手順：
  1. 不透明であることを確かめる
  1. 正方形でなければ中央を正方形に切る。512×512 に縮小（拡大しない。小さいときは 2 の累乗の大きさに縮小）。素材パックの 512px の地面はそのまま 512px（パックが切り出しを補間拡大した物なので、さらに拡大しない）
  1. 焼き込まれた大きな明暗のむらをならす：明るさ（線形の光の量）を大きくぼかした物で割り、元の平均の色に戻す
  1. 色の寄せ（草地だけ）：色ごとの倍率（線形の光の量で）を全部の画素に掛け、平均の色を Version 21 の草地の色 #7a8f4c（122,143,76）へ 0.75 の割合だけ寄せる（倍率 =（目標 ÷ 平均）^ 0.75。模様の明暗・色のむらの比は変えない）。理由は colorMatch.why
  1. 継ぎ目の大きさを測り、大きければ半分ずらした画像と、縁だけなめらかに混ぜて継ぎ目を消す（混ぜてもコントラストが落ちないように分散を保つ）。前後の値を記録する
  1. WebP（品質 85 から、320KB に収まるまで 5 ずつ下げる。下限 60）
  1. 色の画像（アルベド）としてだけ使う。法線や粗さの画像とは称さない
- 加工版：`proto3d/public/art/battle/plains_grass.webp` 512×512・80,452 バイト（上限 327,680）・品質 85・sha256 `34811d3dd3199edcd58716eafd1ab1bf8af3d35380b63605699634ee0948dcc9`・meta {"tileMeters": 4}
  - 明暗のむら：0.0909 → 0.0622。継ぎ目（1 前後なら目立たない）：0.326 → 0.325 → 0.325（直した向き：なし）。平均の色 [120, 135, 71]
  - 色の寄せ：平均の色 [126, 122, 69] → [120, 135, 71]（目標 [122, 143, 76] へ 0.75 の割合。色ごとの倍率 [0.9099, 1.2346, 1.0626]・切れた画素 0.0）
  - 色の画像（アルベド）としてだけ使う。法線・粗さの画像ではない。1 枚 = 4m 四方
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `tex.plains.dirt`（地面の色の素材・確認済み）

- 用途：大平原の合戦の地面（裸の土。草地の中のむら・境目）の色の素材
- 人物・場面：乾いて踏み固められた裸の土（真上から。依頼では約 8m 四方。ゲームでは 1 枚 6 m 四方で繰り返して貼る）
- 使う所：合戦・大平原の地面（土のむら・境目）
- 依頼の要点：赤みを強くしない（敵勢の赤茶色と紛れる）
- 作り方：利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（354×354px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_dirt.png）。パック自身が切り出しを 1.45 倍に拡大しているので、細部は 354px 分しか無い（同じチャット：tex.plains.grass、tex.plains.road、tex.plains.forest）
  - 生成の機能・モデル：画像生成（デザインシートの出力。地面 1 枚ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
- 原画：`proto3d/assets-src/art-v22/tex.plains.dirt/original.png`（受け取りの名前 `tex_plains_dirt.png`）512×512・PNG RGB・516,492 バイト・sha256 `756d5117bbde2bafebe162ed9fee89a86f5fda472c72542ef86fe4e3e86e781a`
  - 透明：なし（不透明）
  - メタデータ：メタデータの塊は無い
  - 依頼の大きさ 1024×1024 と違う（512×512）。拡大はしない
- 加工の手順：
  1. 不透明であることを確かめる
  1. 正方形でなければ中央を正方形に切る。512×512 に縮小（拡大しない。小さいときは 2 の累乗の大きさに縮小）。素材パックの 512px の地面はそのまま 512px（パックが切り出しを補間拡大した物なので、さらに拡大しない）
  1. 焼き込まれた大きな明暗のむらをならす：明るさ（線形の光の量）を大きくぼかした物で割り、元の平均の色に戻す
  1. 継ぎ目の大きさを測り、大きければ半分ずらした画像と、縁だけなめらかに混ぜて継ぎ目を消す（混ぜてもコントラストが落ちないように分散を保つ）。前後の値を記録する
  1. WebP（品質 85 から、320KB に収まるまで 5 ずつ下げる。下限 60）
  1. 色の画像（アルベド）としてだけ使う。法線や粗さの画像とは称さない
- 加工版：`proto3d/public/art/battle/plains_dirt.webp` 512×512・65,852 バイト（上限 327,680）・品質 85・sha256 `191b3ec77295d4873b620e0d372a984dc1592703c52847c0c7234516835d2e72`・meta {"tileMeters": 6}
  - 明暗のむら：0.1055 → 0.0393。継ぎ目（1 前後なら目立たない）：0.402 → 0.407 → 0.407（直した向き：なし）。平均の色 [149, 122, 90]
  - 色の画像（アルベド）としてだけ使う。法線・粗さの画像ではない。1 枚 = 6m 四方
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `tex.plains.road`（地面の色の素材・確認済み）

- 用途：大平原の合戦の道の表面の色の素材（地形データの道の範囲だけに貼る）
- 人物・場面：人や馬に踏み固められた土の道の表面（真上から。道の縁・形は描かない）
- 使う所：合戦・大平原の道
- 依頼の要点：向きのない均一な模様。轍・足跡・水たまりなし
- 作り方：利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（346×346px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_road.png）。パック自身が切り出しを 1.48 倍に拡大しているので、細部は 346px 分しか無い（同じチャット：tex.plains.grass、tex.plains.dirt、tex.plains.forest）
  - 生成の機能・モデル：画像生成（デザインシートの出力。地面 1 枚ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
- 原画：`proto3d/assets-src/art-v22/tex.plains.road/original.png`（受け取りの名前 `tex_plains_road.png`）512×512・PNG RGB・376,674 バイト・sha256 `f500281ec2302d8aa603d1ac1964532aadc2547685edb43225ecdbb511c0ba0d`
  - 透明：なし（不透明）
  - メタデータ：メタデータの塊は無い
  - 依頼の大きさ 1024×1024 と違う（512×512）。拡大はしない
- 加工の手順：
  1. 不透明であることを確かめる
  1. 正方形でなければ中央を正方形に切る。512×512 に縮小（拡大しない。小さいときは 2 の累乗の大きさに縮小）。素材パックの 512px の地面はそのまま 512px（パックが切り出しを補間拡大した物なので、さらに拡大しない）
  1. 焼き込まれた大きな明暗のむらをならす：明るさ（線形の光の量）を大きくぼかした物で割り、元の平均の色に戻す
  1. 継ぎ目の大きさを測り、大きければ半分ずらした画像と、縁だけなめらかに混ぜて継ぎ目を消す（混ぜてもコントラストが落ちないように分散を保つ）。前後の値を記録する
  1. WebP（品質 85 から、320KB に収まるまで 5 ずつ下げる。下限 60）
  1. 色の画像（アルベド）としてだけ使う。法線や粗さの画像とは称さない
- 加工版：`proto3d/public/art/battle/plains_road.webp` 512×512・35,450 バイト（上限 327,680）・品質 85・sha256 `a056505d3e4b57088c2b051da0d9bbeef3e1f51c20024965edacbb8556c7c3bf`・meta {"tileMeters": 5}
  - 明暗のむら：0.0634 → 0.0408。継ぎ目（1 前後なら目立たない）：0.352 → 0.353 → 0.353（直した向き：なし）。平均の色 [157, 133, 109]
  - 色の画像（アルベド）としてだけ使う。法線・粗さの画像ではない。1 枚 = 5m 四方
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `tex.plains.forest`（地面の色の素材・作り直し待ち）

- 用途：大平原の合戦の林の範囲の地面（林床）の色の素材。不採用（2026-10-09 の判断）：林は Version 21 の色のまま
- 人物・場面：松林の地面（落ち葉・松葉・苔・低い下草。真上から。木の幹・根・影は描かない）
- 使う所：合戦・大平原の林の範囲の地面
- 依頼の要点：暗めの緑がかった茶色。青・赤茶の点や塊なし
- 作り方：利用者が ChatGPT の画像生成で作ったデザインシートから、素材パック sengoku_art_pack_v1 が地面の範囲を切り出し（280×280px）、大きな明暗を弱め、向かい合う端を合わせて 512×512 に補間拡大した色の画像（パックの textures/tex_plains_forest.png）。パック自身が切り出しを 1.83 倍に拡大しているので、細部は 280px 分しか無い（同じチャット：tex.plains.grass、tex.plains.dirt、tex.plains.road）
  - 生成の機能・モデル：画像生成（デザインシートの出力。地面 1 枚ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.3 を元にした依頼（1024×1024 で個別に生成という条件には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
- 原画：未着（`incoming/tex_plains_forest.png`）
- **作り直し待ち**：素材パックの林床（パックが 280px の切り出しを 1.83 倍に補間した 512px）は、焼き込まれた木漏れ日が明暗のむらをならした後も残り（大きな明暗の幅 0.42 → 0.22）、合戦の画面で縞（耕した畝）に見えた（Version 22 の画面での確かめ）。2026-10-09 の利用者の判断で不採用。原画は保管しない（ingest しない）。林は Version 21 の色のまま、円の林に木も植えない。新しい林床の原画の条件：真上から見た材質の画像で、強い木漏れ日や縞状の影が無い物（docs/art-v23-request.md）（受け取ったファイル `tex_plains_forest.png`・sha256 `2ef71c16a22dec46…`）
- 加工の手順：
  1. 不透明であることを確かめる
  1. 正方形でなければ中央を正方形に切る。1024×1024 に縮小（拡大しない。小さいときは 2 の累乗の大きさに縮小）
  1. 焼き込まれた大きな明暗のむらをならす：明るさ（線形の光の量）を大きくぼかした物で割り、元の平均の色に戻す
  1. 継ぎ目の大きさを測り、大きければ半分ずらした画像と、縁だけなめらかに混ぜて継ぎ目を消す（混ぜてもコントラストが落ちないように分散を保つ）。前後の値を記録する
  1. WebP（品質 85 から、320KB に収まるまで 5 ずつ下げる。下限 60）
  1. 色の画像（アルベド）としてだけ使う。法線や粗さの画像とは称さない
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `portrait.pack1.ieyasu`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.ieyasu の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：徳川家康（この作品の主人公。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない）
- 使う所：Version 24 の顔 face.pack1.ieyasu の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_ieyasu_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.ieyasu の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.ieyasu/original.png`（受け取りの名前 `portrait_ieyasu.png`）347×471・PNG RGBA・343,783 バイト・sha256 `1edfb14632b66cb6d81132dd7dc3d8d3d0efbf240e42f59656cad66319317fe4`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
  - **注意（composition）**：外側の確かめの範囲（alphaCheck.regions）の透明が 85%（目安 90%）。全体は 28% が透明なので受け取るが、人物（柱・幕）が端まで広がる構図。画面で切れ方と重なりを確かめる
- アンカー（原画の画素の座標）：{"eyeY": 134.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.ieyasu`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：徳川家康（portrait.pack1.ieyasu と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.ieyasu の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.ieyasu` の原画（同じ原画から切り出す）。faceRect：[48, 45, 282, 282]
- 加工の手順：
  1. portrait.pack1.ieyasu の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/ieyasu.webp` 256×256・13,762 バイト（上限 30,720）・品質 85・sha256 `ca0d186e84412692d0374a54f493d897c2f2d12b2c645f6d9a26a487b9dc0cce`
  - 処理の記録：{"faceRect": [48, 45, 282, 282], "squareRect": [48, 45, 282, 282], "scale": 0.9078, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.ieyasu と同じ

### `portrait.pack1.tadakatsu`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.tadakatsu の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：本多忠勝（徳川家の家臣・前線の主将。ゲーム用の創作デザインで、実在の容貌・衣装の復元ではない）
- 使う所：Version 24 の顔 face.pack1.tadakatsu の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_tadakatsu_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.tadakatsu の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.tadakatsu/original.png`（受け取りの名前 `portrait_tadakatsu.png`）348×471・PNG RGBA・326,724 バイト・sha256 `209692d2ba74200dc60dfbf7b6fd7f42b1e871bbce12f5812ba617dfce120941`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
  - **注意（composition）**：外側の確かめの範囲（alphaCheck.regions）の透明が 89%（目安 90%）。全体は 29% が透明なので受け取るが、人物（柱・幕）が端まで広がる構図。画面で切れ方と重なりを確かめる
- アンカー（原画の画素の座標）：{"eyeY": 133.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.tadakatsu`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：本多忠勝（portrait.pack1.tadakatsu と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.tadakatsu の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.tadakatsu` の原画（同じ原画から切り出す）。faceRect：[40, 37, 296, 296]
- 加工の手順：
  1. portrait.pack1.tadakatsu の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/tadakatsu.webp` 256×256・12,714 バイト（上限 30,720）・品質 85・sha256 `b4e754ae51888928a062975406aec932cc8820f97516c7dae1a9443da6c1034c`
  - 処理の記録：{"faceRect": [40, 37, 296, 296], "squareRect": [40, 37, 296, 296], "scale": 0.8649, "upscaled": false, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.tadakatsu と同じ

### `portrait.pack1.sakai`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.sakai の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：酒井忠次（徳川家の重臣。軍議で話す。演習の部隊の武将。ゲーム用の創作デザイン）
- 使う所：Version 24 の顔 face.pack1.sakai の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_sakai_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.sakai の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.sakai/original.png`（受け取りの名前 `portrait_sakai.png`）203×270・PNG RGBA・106,801 バイト・sha256 `df5ce7f04ea20449d380664bcd0352550a1caeee475a2268d64caadb40412d48`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": 113.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.sakai`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：酒井忠次（portrait.pack1.sakai と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.sakai の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.sakai` の原画（同じ原画から切り出す）。faceRect：[15, 30, 187, 187]
- 加工の手順：
  1. portrait.pack1.sakai の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/sakai.webp` 256×256・11,368 バイト（上限 30,720）・品質 85・sha256 `9575e69559c1985b111597c61973b6f112b7f98e9c46942f968b0304cc7e96be`
  - 処理の記録：{"faceRect": [15, 30, 187, 187], "squareRect": [15, 30, 187, 187], "scale": 1.369, "upscaled": true, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.sakai と同じ

### `portrait.pack1.ishikawa`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.ishikawa の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：石川数正（徳川家の重臣。軍議・第二章の補充で話す。演習の部隊の武将。ゲーム用の創作デザイン）
- 使う所：Version 24 の顔 face.pack1.ishikawa の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_ishikawa_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.ishikawa の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.ishikawa/original.png`（受け取りの名前 `portrait_ishikawa.png`）250×319・PNG RGBA・159,441 バイト・sha256 `f1716d695d3769e06c9d7864d335588173e51c69f76a33768e24563cdc6c9718`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": 132.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.ishikawa`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：石川数正（portrait.pack1.ishikawa と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.ishikawa の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.ishikawa` の原画（同じ原画から切り出す）。faceRect：[37, 42, 204, 204]
- 加工の手順：
  1. portrait.pack1.ishikawa の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/ishikawa.webp` 256×256・14,370 バイト（上限 30,720）・品質 85・sha256 `4f9a154cb0d1db076887cfbb9eef24672ac8c3eb69773766f1cedbe987228d6e`
  - 処理の記録：{"faceRect": [37, 42, 204, 204], "squareRect": [37, 42, 204, 204], "scale": 1.2549, "upscaled": true, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.ishikawa と同じ

### `portrait.pack1.sakakibara`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.sakakibara の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：榊原康政（演習の部隊の武将。歴史分岐の章の会話には出ない。ゲーム用の創作デザイン）
- 使う所：Version 24 の顔 face.pack1.sakakibara の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_sakakibara_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.sakakibara の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.sakakibara/original.png`（受け取りの名前 `portrait_sakakibara.png`）247×319・PNG RGBA・156,773 バイト・sha256 `df74ac4eda553a98906a157a49b8a9b8da7a3cbff4535022f70fac1454de4391`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": 133.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.sakakibara`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：榊原康政（portrait.pack1.sakakibara と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.sakakibara の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.sakakibara` の原画（同じ原画から切り出す）。faceRect：[28, 37, 211, 211]
- 加工の手順：
  1. portrait.pack1.sakakibara の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/sakakibara.webp` 256×256・12,832 バイト（上限 30,720）・品質 85・sha256 `acded0f8d4c907cce623a0efe882804fed749bd3aa718d88f67a2594407ec37e`
  - 処理の記録：{"faceRect": [28, 37, 211, 211], "squareRect": [28, 37, 211, 211], "scale": 1.2133, "upscaled": true, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.sakakibara と同じ

### `portrait.pack1.nagamasa`（人物画・受け取り済み）

- 用途：Version 24 までの顔 face.pack1.nagamasa の元の原画（記録だけ）。立ち絵には使わない（低解像度）
- 人物・場面：浅井長政（合戦の部隊の武将：第一章 A は敵・B は味方、第二章 B、演習の援軍救出。会話には出ない。ゲーム用の創作デザイン）
- 使う所：Version 24 の顔 face.pack1.nagamasa の元（Version 24 と比べる表示 ?art=v24 だけ）
- 依頼の要点：素材パックの補間前の原解像度。胸から上の半身。左右反転しない
- 作り方：利用者が ChatGPT の画像生成で作った複数人のデザインシートから、その人の範囲を切り出し・背景を透過した素材パック sengoku_art_pack_v1 の人物画。原画には補間前の原解像度の版（portraits/portrait_nagamasa_native.png）を使う（2 倍に補間した版は細部が増えていないので使わない）
  - 生成の機能・モデル：画像生成（デザインシートの出力。人物 1 人ずつの個別生成ではない）／報告待ち。生成した日：2026-10-08（素材パックの作成日）
  - プロンプト：docs/art-v22-asset-request.md §5.1 を元にした依頼（1024×1536 で個別に生成という条件・髭なし・家紋なしには完全には沿っていない：パックの README）（実際に使った文は報告待ち）
  - 参考画像：利用者が承認した生成のコンセプト画像と、それに続く生成のデザインシート（パックの docs/利用条件と来歴.md）
  - 衣装・年齢・装飾はゲーム用の創作デザイン。衣装の紋様は史実の家紋として確かめていない（家紋として説明しない）
- **原画の記録だけ（sourceOnly）**：Version 24 までの低解像度の人物画（素材パック第 1 版のデザインシートからの切り出し）。立ち絵には使わない（利用者の判断 2026-10-09）。Version 24 の顔 face.pack1.nagamasa の元としてだけ記録・保管する（加工版は作らない）
- 原画：`proto3d/assets-src/art-v22/portrait.nagamasa/original.png`（受け取りの名前 `portrait_nagamasa.png`）248×261・PNG RGBA・136,004 バイト・sha256 `ee12b4f2fa6e1610fd14cd0537cd3e463c374d1ada4a8073d03da6823883bf0d`
  - 透明：あり（本物の透明）
  - メタデータ：メタデータの塊は無い
- アンカー（原画の画素の座標）：{"eyeY": 125.0, "faceX": null}
- 加工の手順：
  1. 透過の確かめ：本物の透明（RGBA で、全体の 15% 以上がほぼ完全に透明）だけを受け取る。市松模様が描き込まれた物は受け取らない（透明の画像の中の、不透明の灰色と白の市松模様も断る）
  1. 透明でなく、背景が単色のマゼンタ（#FF00FF）なら、色を抜いて透明にする（縁はなめらかに、縁のマゼンタの色かぶりを取る）。抜いたことを記録する
  1. 上端と左右の上 6 割がほぼ透明でない（人物が端まで広がる）構図は、断らずに構図の注意として記録する。下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）ときは下端の注意を記録する
  1. 透明な余白を切る（下端の体の切れ目は切らない。余白 8px を残す）
  1. 拡大しない。1024×1536 に収まるように縮小だけ
  1. WebP（品質 85 から、260KB に収まるまで 5 ずつ下げる。下限 60。透明は劣化させない）
- 利用条件：確認済み。素材パックの docs/利用条件と来歴.md（2026-10-08）。全体の terms を見る

### `face.pack1.nagamasa`（顔（人物画から切り出し）・確認済み）

- 用途：Version 24 までの顔（会話・軍議の台詞の枠・合戦の部隊の札・能力の欄・能力の知らせ・演習の編成）。Version 25 からは、Version 24 と比べる表示（?art=v24。ids.ts の V24_FACE_OF）だけで使う
- 人物・場面：浅井長政（portrait.pack1.nagamasa と同じ原画から切り出す）
- 使う所：Version 24 と比べる表示（?art=v24）の顔
- 依頼の要点：顔を別に生成し直さない。faceRect は受け取った人物画を見てから決める
- 作り方：portrait.pack1.nagamasa の原画から切り出す（顔だけを別に生成しない。切り出しの範囲は素材パックの docs/portraits.json の face_rect_native_xywh）
- 元：`portrait.pack1.nagamasa` の原画（同じ原画から切り出す）。faceRect：[26, 20, 221, 221]
- 加工の手順：
  1. portrait.pack1.nagamasa の原画（色を抜いた場合はその透明）から faceRect（原画の画素の座標 [x, y, 幅, 高さ]）を切り出す
  1. 正方形にそろえる（短い辺を中心から広げる。原画の外は透明）
  1. 256×256 に縮小（faceRect が 256 より小さいときだけ拡大になり、記録する）
  1. WebP（品質 85 から、30KB に収まるまで 5 ずつ下げる。下限 50。透明は劣化させない。切り出した範囲が全部不透明なら透明の層の無い WebP になり、そのことを記録する）
- 加工版：`proto3d/public/art/faces/nagamasa.webp` 256×256・14,760 バイト（上限 30,720）・品質 85・sha256 `1e51b6b29b7cb3bfe113f644bd98cd39268f04a33563a94253edb514940f0eac`
  - 処理の記録：{"faceRect": [26, 20, 221, 221], "squareRect": [26, 20, 221, 221], "scale": 1.1584, "upscaled": true, "outsideOriginal": false, "opaque": false}
- 利用条件：確認済み。portrait.pack1.nagamasa と同じ

## 作業の手順

1. 利用者が `proto3d/assets-src/art-v22/incoming/` に PNG を置く（受け取りの名前は上の一覧）。
2. `python3 -I proto3d/tools/art-build.py ingest`：透明・不透明・メタデータ（C2PA など）を調べ、通った原画を `incoming/` から `<id>/original.png` へ受け取ったままの中身で移す（`incoming/` には README.md だけが残る。git では incoming/ の削除と original.png の追加を一緒にコミットする）。断った物は `incoming/` に残す（作り直した物で置き換える）。
   - 人物画・手前の幕は本物の透明が要る。灰色と白の市松模様が描き込まれた物は断る（透明の画像でも、不透明の所に市松模様が約 1,500 画素以上あれば断る）。透明が無く、背景が単色マゼンタ（#FF00FF）なら色を抜き、そのことを記録する。それ以外は断る（作り直しを依頼）。
   - 全体の透明（不透明度 8 以下）が足りない物は断る。全体ははっきり透明なのに外側の確かめの範囲（上端・左右）に人物がかかる物は、断らずに **構図の注意（composition）** として記録する。人物画の下端がまっすぐな体の切れ目でない（下端の行の不透明が 2 割未満）物は **下端の注意（bottom-cut）** を記録する。注意は ingest・build の画面とこのファイルに出る。画面で確かめてから approve する。
   - 差し替えは `ingest --replace --id <id>`。前の原画の画素の座標で決めた faceRect・アンカーは消える（set-… をやり直すまで顔は作らない）。差し替えを断った物は作り直し待ち（rejected）になり、前の原画からも作らない。
   - 確かめ用の画像（色を抜いた結果・灰色の上に置いた物・地面を 2×2 に並べた物）は `<id>/_work/` に出る（リポジトリには入れない）。
2b. 素材パック（Version 25 から。記録の sources・各素材の pack）：展開したパックを置いた場所を渡して `python3 -I proto3d/tools/art-build.py ingest-pack <パックのフォルダ>`。記録の sha256・パックの一覧（asset_manifest.json。データとして読むだけで、パックの中のスクリプトは実行しない）・元の生成結果との関係（透明の端の整理・端の切り詰め）を画素まで確かめ、ingest と同じ透明・不透明の検査に通った物を `proto3d/assets-src/art-v25/originals/<id>.png`（git に入れない）へ写す。原画は公開リポジトリに入れない。
3. 受け取った人物画を見て、顔の範囲と目の高さを決める：`set-face-rect face.ieyasu X Y W H`、`set-anchor portrait.ieyasu eyeY 310`（どちらも原画の画素の座標。割合や原画の外の値は断る）。顔は切り出した範囲が全部不透明なら、透明の層の無い WebP になる（それでよい。build が記録する）。
4. `python3 -I proto3d/tools/art-build.py build`：作り方どおりに加工し、`proto3d/public/art/` と `manifest.gen.json` とこのファイルを書き直す。作れない物（未着・作り直し待ち・faceRect が未設定・失敗）は加工版の記録を外し、状態を受け取り済み／依頼済みに戻す。
5. `python3 -I proto3d/tools/art-build.py check`：加工版が一覧どおりか。公開の前は `check --strict`（見た目の確認 approved と、利用条件の確認が要る）。
6. 公開する dist は `node proto3d/tools/check-dist.mjs dist-proto3d`（容量・ファイル数・.glb・dev-art が無いこと・/art の一覧）。

## 開発用の仮の画像（TEST）

`proto3d/dev-art/` は、配置と動作の確かめだけに使う **TEST の模様の画像**（格子と「TEST」の文字）です。素材ではなく、見た目の改善とは扱いません。
開発サーバーで `?artFixture=1` を付けたときだけ使われ、公開版（`proto3d/public/` の外）には入りません。作り方：`python3 -I proto3d/tools/make-dev-art.py`（このパイプラインと同じ加工の道を通る）。
