# 第3群（5 戦場）の最終の確認の記録

設計 `docs/fields-group3-design.md` §5 の「固定したビルドでの確認」の記録。再起動の後は、この表を見て「未」「影響あり」の項目から再開する。

- **固定のコミット：** `ad22471`（作業ツリーは空。この後のコミットはこの記録のファイルだけ）
- **確かめ方の種類：**
  - 本物の入力＝画面のクリック・タップ・キー（通常速度。待ちだけ早送りのものはそう書く）
  - 早送り＝台本の命令を早送りで最後まで回す
  - 直接操作＝ゲームの状態を直接書き換えてから確かめる
- **開発サーバー：** `PORT=8308 npx vite --config proto3d/blender/tools/vite.nohmr.mjs`。1 回ページを開いて温めてから、e2e を 1 本ずつ（`BASE3D` と `BASE` の両方に `http://localhost:8308`）。出力は `e2e-out/verify-g3/<名前>/`。
- **実機・性能：** ここでは確かめていない（コンテナはソフトウェア描画）。

## 型・単体テスト

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| npm run proto3d:typecheck | | | 未 | | ― |
| npm run typecheck | | | 未 | | ― |
| npx vitest run | | | 未 | | 早送り・直接操作 |

## e2e（開発サーバー 8308）

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| fields-group3 | | | 未 | | |
| fields-group3-plans | | | 未 | | |
| ops-group3 | | | 未 | | |
| fields-practice | | | 未 | | |
| fields-ui | | | 未 | | |
| fields-group2 | | | 未 | | |
| fields-group2-fixes | | | 未 | | |
| label-priority | | | 未 | | |
| ability-ui | | | 未 | | |
| ability-fixes | | | 未 | | |
| troops | | | 未 | | |
| troops-abilities | | | 未 | | |
| ieyasu-routes | | | 未 | | |
| ieyasu-battle-ui | | | 未 | | |
| chapter1-routes | | | 未 | | |
| chapter1-input | | | 未 | | |
| chapter1-idempotent | | | 未 | | |
| chapter1-battle | | | 未 | | |
| review-group3（一覧の外。最後の直しの e2e） | | | 未 | | |

## 本番ビルド

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| ビルド（`VITE_MODEL_EXT=.json npm run proto3d:build`・glb を消して gltf を json へ） | ad22471 | 2026-10-02 20:28 | 済。ビルドの表示は `ad22471`（「+変更あり」なし。dist の中に「変更あり」の字は無い） | ― | ― |
| dist の合計 | ad22471 | 2026-10-02 20:28 | 60,711,664 バイト（57.9 MiB）。64 MB 未満 | ― | ― |
| fields-prod（15 戦場） | | | 未 | | |
| ieyasu-prod | | | 未 | | |
| chapter1-prod | | | 未 | | |

## 失敗と原因

（無ければ「なし」）
