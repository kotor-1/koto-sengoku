# 第4群（16〜20。合わせて 20 戦場）の最終の確認の記録

依頼本文 `docs/fields-group4-request.md` §5・設計 `docs/fields-group4-design.md` §6 の「固定したビルドでの確認」の記録。再起動の後は、この表を見て、同じ固定のコミットで済んだ項目は飛ばし、「未」「影響あり」の項目から再開する。

- **固定のコミット：** `f508e95`（作業ツリーは空。この後のコミットはこの記録のファイルだけ）
- **確かめ方の種類：**
  - 本物の入力＝画面のクリック・タップ・キー（通常速度。待ちだけ早送りのものはそう書く）
  - 早送り＝台本の命令を早送りで最後まで回す
  - 直接操作＝ゲームの状態を直接書き換えてから確かめる
  - 実機＝実際の端末での確認（ここでは **していない**。コンテナはソフトウェア描画）
- **開発サーバー：** `PORT=8471 npx vite --config proto3d/blender/tools/vite.nohmr.mjs`。1 回ページを開いて温めてから、e2e を 1 本ずつ（`BASE3D` と `BASE` の両方に `http://localhost:8471`）。`setsid nohup` で切り離して流し、ログを待つ。出力は `e2e-out/verify-g4/<名前>/`。
- **実機・性能：** ここでは確かめていない。

## まとめ

（未。終わったら書く）

## 型・単体テスト

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| npm run proto3d:typecheck | f508e95 | | 未 | ― | ― |
| npm run typecheck | f508e95 | | 未 | ― | ― |
| npx vitest run | f508e95 | | 未 | | 早送り・直接操作 |

## e2e（開発サーバー 8471）

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| fields-group4（start・phone・plans・shorepass・panel） | f508e95 | | 未 | | |
| ops-group4 | f508e95 | | 未 | | |
| fields-group3 | f508e95 | | 未 | | |
| fields-group3-plans | f508e95 | | 未 | | |
| ops-group3 | f508e95 | | 未 | | |
| review-group3 | f508e95 | | 未 | | |
| fields-practice | f508e95 | | 未 | | |
| fields-ui | f508e95 | | 未 | | |
| fields-group2 | f508e95 | | 未 | | |
| fields-group2-fixes | f508e95 | | 未 | | |
| label-priority | f508e95 | | 未 | | |
| ability-ui | f508e95 | | 未 | | |
| ability-fixes | f508e95 | | 未 | | |
| troops | f508e95 | | 未 | | |
| troops-abilities | f508e95 | | 未 | | |
| ieyasu-routes | f508e95 | | 未 | | |
| ieyasu-battle-ui | f508e95 | | 未 | | |
| chapter1-routes | f508e95 | | 未 | | |
| chapter1-input | f508e95 | | 未 | | |
| chapter1-idempotent | f508e95 | | 未 | | |
| chapter1-battle | f508e95 | | 未 | | |

## 本番ビルド

| 項目 | コミット | 日時（UTC） | 結果 | 項目数 | 種類 |
|---|---|---|---|---|---|
| ビルド（`git worktree add --detach` の作業木で `VITE_MODEL_EXT=.json npm run proto3d:build`・glb を消して gltf を json へ。dist を本体の直下へ） | f508e95 | | 未 | ― | ― |
| dist の合計 | f508e95 | | 未 | ― | ― |
| fields-prod（20 戦場） | f508e95 | | 未 | | |
| ieyasu-prod | f508e95 | | 未 | | |
| chapter1-prod | f508e95 | | 未 | | |

## 失敗と原因

（未）

## 未解決

- 城攻め前面の準備した正面攻撃（PREP）の画面の操作で、14 回目の命令が 2 秒遅れる（`e2e/fields-group3-plans.mjs` の頭の記録）。調べた結果は下に書く。
