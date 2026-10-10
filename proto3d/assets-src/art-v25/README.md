# 素材パック第 2 版（sengoku_individual_art_v2。Version 25 から）の置き場

このリポジトリは公開されているので、**素材パックの原画（PNG）はここに入れません。** 入れるのは記録と、ゲーム用の加工版（`proto3d/public/art/` の WebP）だけです。

- `pack-v2/`：パックの記録の文書の写し（`characters_and_scenes.json`・`asset_manifest.json`・`docs/PROVENANCE_AND_USAGE.md`・`docs/image_validation.json`）。画像は入れていません。どのファイルを写したか・写さなかったかと各ファイルの sha256 は、正本の記録 `proto3d/assets-src/art-v22/manifest.json` の `sources.pack-v2.textFiles` にあります。
- `originals/`：**git に入れない**手元の置き場（`.gitignore`）。`python3 -I proto3d/tools/art-build.py ingest-pack <展開したパックのフォルダ>` が、使う 7 枚（人物画 6 枚・昼の軍議所）を、記録の sha256・パックの一覧・元の生成結果との関係を画素まで確かめてから `<id>.png` として写します。
- 原画が手元に無い所（新しく clone した所）でも、`art-build.py build`・`check` は通ります（作り直さずに加工版をそのまま使い、原画の sha256 の確かめを飛ばしたと表示する）。加工版を作り直すときは、利用者の手元のパック（ZIP 3 つ。名前と sha256 は `sources.pack-v2.zipParts`）を展開して ingest-pack します。
- 人物と武将の対応は、パックの `characters_and_scenes.json` の表示名で決めています（パックの key を武将の id と同じとみなさない）。織田信長・朝倉義景の絵は予約（公開しない・手元にも写さない）。城下町・大平原の遠景・林床は使っていません。

素材ごとの記録（作り方・寸法・容量・sha256・利用条件）は `docs/art-assets.md`、出どころと利用条件のまとめは `docs/third-party-assets.md` を見てください。
