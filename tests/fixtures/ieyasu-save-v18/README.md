# 旧版 Version 18 の保存の読み込み（確かめ専用の写し）

`save.ts` は、公開した Version 18（コミット `deb7b2d`）の `proto3d/src/campaign/ieyasu1570/save.ts` の写し。
`git show deb7b2d:proto3d/src/campaign/ieyasu1570/save.ts` をそのまま写し、`import` の道だけを今のコードの同じモジュールへ向けた（関数の中身は変えていない）。

使い道：物見の記録（版 3・版 4 の省ける欄 `scout`）を足した今の版で書いた保存を、旧版の読み込み（`parseIeyasuSaveData`・`parseIeyasu2SaveData`・
`IeyasuCampaignStore.load`）でも読めること（旧版へ戻しても進行不能にならないこと）を、`tests/proto3d-ieyasu-story-save.test.ts` で確かめる。
旧版は知らない欄を見ないので、`scout` は読み飛ばされる（旧版で保存し直すと記録は消える。兵・信頼・段階は同じ）。
