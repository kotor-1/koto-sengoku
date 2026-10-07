# 受け取り口（Version 22 の画像素材）

ChatGPT で生成した画像を、ダウンロードした PNG のまま、ここに置いてください。
ファイル名と中身は docs/art-v22-asset-request.md の §4 のとおりです。

- portrait_ieyasu.png
- portrait_tadakatsu.png
- bg_council.png
- bg_council_front.png（任意）
- tex_plains_grass.png
- tex_plains_dirt.png
- tex_plains_road.png
- tex_plains_forest.png

`python3 -I proto3d/tools/art-build.py ingest` は、検査を通った画像を、中身を 1 バイトも変えずに
`proto3d/assets-src/art-v22/<id>/original.png` へ移します（同じ原画を 2 か所に置かないため）。
ふだん、このフォルダには この README.md だけが残ります。断られた画像はここに残るので、作り直した物で置き換えてください。

ここにある原画は公開版に入れません。加工した版だけを proto3d/public/art/ に置きます。
このリポジトリは公開設定なので、ここに置いた原画（と、移した先の original.png）は誰でも取得できます。
