# 歴史分岐「元亀元年・家康」第一章の保存データ（版 3）

第二章（docs/chapter2-design.md）を足す前に、**その時点のコード（コミット 782fefe、保存の版 3）** の保存の関数が書いた文字列を、そのまま残したもの。
`*.json` の中身は、localStorage の `koto-sengoku/3d-ieyasu1570` に入る文字列そのもの（最後に改行なし）。

- 何で作ったか：**状態を直接作った（直接状態変更）**。第一章の flow の関数を普通の遊び方の順に呼び（`devIeyasuState` と同じ順：
  会話 → 軍議 → 約束の返事 → 城門で出陣）、合戦は遊ばずに `ieyasuOutcomeFromSetup`（確認用の偽の結果）で結果を作って `applyIeyasuOutcome` で反映し、
  戦後に忠勝と話して章を締めくくった状態を、`IeyasuSaveStore.save`（版 3）で MemoryStorage に書いた。書かれた文字列をそのままファイルにした（手で書いていない）。
- 保存の時刻は 2026-10-05T01:00:00.000Z に固定。
- 損害の大きい物（`*_defeat_broken_heavy`）は、部隊の残りの兵を小さく・状態を routed にした（本陣 140・忠勝隊 25・弓隊 20。
  A は織田援軍 70、B は浅井長政隊 60（長政が負傷）、C は守備隊 30）。家康と忠勝は負傷。

| ファイル | 方針 | 合戦 | 約束 | 時点 |
|---|---|---|---|---|
| oda_victory_kept | A 織田 | 勝利 | 守った（援兵あり） | 結末 |
| oda_defeat_broken_heavy | A 織田 | 敗北・損害大 | 守れなかった | 結末 |
| oda_retreat_declined | A 織田 | 撤退 | 引き受けなかった | 結末 |
| asai_victory_kept | B 浅井 | 勝利 | 守った（援兵あり） | 結末 |
| asai_defeat_broken_heavy | B 浅井 | 敗北・損害大（長政 負傷） | 守れなかった | 結末 |
| asai_retreat_declined | B 浅井 | 撤退 | 引き受けなかった | 結末 |
| home_victory_kept | C 自領 | 勝利 | 守った（守備隊が加わる） | 結末 |
| home_defeat_broken_heavy | C 自領 | 敗北・損害大（守備隊も） | 守れなかった | 結末 |
| home_retreat_declined | C 自領 | 撤退 | 引き受けなかった | 結末 |
| oda_victory_kept_aftermath | A 織田 | 勝利 | 守った | 戦後（自動保存） |

## 作り直し方（同じ文字列になる）

```sh
npx esbuild tests/fixtures/ieyasu-ch1-v3/generate.ts --bundle --platform=node --format=esm --outfile=/tmp/gen-ch1v3.mjs
node --input-type=module -e "const m = await import('/tmp/gen-ch1v3.mjs'); console.log(await m.writeIeyasuCh1V3Fixtures('tests/fixtures/ieyasu-ch1-v3'))"
```

テストでの読み方：`tests/proto3d-ieyasu-save-v3-fixtures.ts` の `IEYASU_V3_FIXTURES`。e2e は同じ JSON を fs で読む。
`tests/proto3d-ieyasu-ch2-fixtures.test.ts` は、今のコードの `generate.ts` がこのファイルと同じ文字列を作ることを確かめる
（第一章の状態は今までどおり版 3 で、同じ文字列で書くことの確かめ）。
