# 武将・部隊数の拡張と合戦場システム：設計（実装の約束）

依頼本文（正）：`docs/battlefields-generals-request.md`。ここは実装の取り決め。食い違えば依頼本文が正。

## 0. 守ること

- Version 11 の合戦（架空の第一章の「国境の原」、歴史分岐「元亀元年・家康」の 3 方針）の結果を変えない。
  - 同じ命令なら同じ結果になる。
  - 今の釣り合いのテスト・経路の確認（`tests/proto3d-battle-*`・`e2e/ieyasu-routes.mjs`・`e2e/chapter1-routes.mjs`）は、そのまま通す。
- 保存：架空の第一章（`koto-sengoku/3d-chapter1` 版 1・2）、歴史分岐（`koto-sengoku/3d-ieyasu1570` 版 1）、2D 版（`koto-sengoku/save`）を壊さない。形を変えるときは版を上げ、古い版を読めるようにする。
- 今の部隊の選び方と命令の出し方（1 部隊ずつ選ぶ）を保つ。

## 1. 武将（`proto3d/src/battle/generals.ts`。データだけ）

```ts
interface GeneralDef {
  id: string;                 // 'ieyasu' | 'tadakatsu' | 'nagamasa' | 'sakai' | 'ishikawa' | 'sakakibara'
  name: string;               // 表示名
  clan: ClanId;               // 所属（既定。シナリオの設定で上書きできる）
  role: GeneralRole;          // 部隊での役割：'commander'（総大将）| 'vanguard'（前線の主将）| 'tactician'（采配・軍議）| 'reserve'（後詰め）| 'ally_lord'（同盟の大将）
  abilityId?: AbilityId;      // 固有能力（abilities.ts のデータを指す。差し替えできる）
  aiPolicy: AiPolicy;         // 敵方・同盟の考えの基本方針：'aggressive' | 'steady' | 'cautious' | 'support'
  relationKey: string;        // 主人公との関係状態のキー（シナリオの状態の trust / relations に入る）
  history: { verified: string[]; interpretation: string[]; sourceNote: string }; // 確かめた史実とゲーム用の解釈を分ける
}
```

- **部隊との結び付け：** `UnitDef.generalId?: string` を足す（`leaderId` は今までどおり残し、同じ値を入れる）。
  - 能力は `UnitDef.ability` があればそれを使い、無ければ武将の `abilityId` を使う。
  - 武将がいない部隊・武将が戦えない部隊（敗走・撤退済み・全滅）は、能力を使えない（今の決まり）。
- **今の 3 人を移す。**
  - 家康：総大将・立て直しの号令。
  - 本多忠勝：前線の主将・退路の守護。参謀としては扱わない。
  - 浅井長政：同盟の大将・盟友への援護。
- **追加する 3 人。** 能力は仮のデータで、`abilities.ts` の `ABILITY_DATA` に「仮」の印を付け、差し替えできるようにする。
  - 酒井忠次：`tactician`。仮の能力「両翼の采配」。
    - 効果：20 秒のあいだ、半径 80 m の味方が側面・背後を突いたときの損害 ×1.25。
    - 代償：効果中、酒井隊の動き ×0.7。
  - 石川数正：`reserve`。仮の能力「後詰めの差配」。
    - 効果：選んだ味方 1 部隊が、30 秒のあいだ動き ×1.4、斬り合いに入ったとき士気 +10（1 回だけ）。
    - 代償：効果中、石川隊の守り ×0.9。
  - 榊原康政：`vanguard`。仮の能力「先駆けの号」。
    - 効果：20 秒のあいだ、自分の部隊の与える損害 ×1.3。
    - 代償：終わったとき士気 −10。
- **酒井・石川の存在感：**
  - 歴史分岐の軍議で、方針ごとに酒井・石川の意見の台詞を足す（創作）。
  - 演習の戦場では、酒井・石川が部隊を率いて、能力を使える。
  - 歴史分岐の章の合戦は、部隊と数値を今のまま（Version 11 の釣り合いを守る）。
- **関係状態：** 歴史分岐の状態の `trust` に、`sakai`・`ishikawa`・`sakakibara` を足す。保存の版 2 で、版 1 は初期値で読む。
- **史実と解釈：** `docs/generals-history.md` に分けて書く。
  - 資料メモで確かめたのは忠勝（家康の旗本）だけ。
  - 酒井・石川・榊原の年代・所属・役割は、今回の資料では確かめていない。「一般に知られる事柄（未確認）」と「ゲーム用の解釈」に分ける。
  - 資料にない逸話・台詞は、史実として扱わない。

## 2. 部隊数

- **扱える数：** 味方 最大 8、敵 最大 10（`RULES.maxUnitsPerSide`）。
- **部隊の札：**
  - PC：1〜8 キーで選ぶ。
  - スマホ（844×390）：札を小さくし、横に流す（はみ出したら横になぞる）。
- **選択の状態：** 中では部隊 id の並び（`selection: string[]`）で持つ。
  - 今は 1 部隊だけを選ぶ。
  - 複数の選択・部隊のまとまり（グループ）を後から足せる形にしておく（命令を出す関数は、部隊 id の並びを受け取れる形にする）。

## 3. 合戦場のデータ（`proto3d/src/battle/fields/`。1 戦場 1 ファイル＋一覧 `index.ts`）

```ts
interface BattlefieldDef {
  id: string; name: string;
  kind: FieldKind;                 // 20 種の分類（下の表）
  summary: string;                 // 一覧・説明に出す短い特徴
  width: number; depth: number;
  terrain: TerrainArea[];          // 既存の区域に種類を足す：'river'（深い川＝通れない）| 'ford'（浅瀬）| 'cliff'（崖・岩＝通れない）| 'hill'（高さ）| 'woods' | 'marsh' | 'road' | 'field'（水田・畑。将来）| 'village'（将来）
  passable?: { x0; x1; z0; z1 };   // 通れる範囲（省けば全体）。'river'・'cliff' の区域は通れない
  terrainRules?: Partial<Record<TerrainKind, TerrainRule>>; // 移動の速さ・視界・与える／受ける損害・丘の有利を、戦場ごとに上書き（既定は sim.ts の TERRAIN_DEFAULTS）
  highGround?: { defenseVsLower: number; rangeBonus: number; sightBonus: number }; // 高低差の効果（データで調整）
  deployments: { ally: DeploySlot[]; enemy: DeploySlot[] }; // 初期配置の枠（x, z, 向き, 役割の目安）
  reinforcements?: { id: string; side: Side; at?: number; trigger?: string; point: {x; z}; unitSlot: string }[];
  exits: Record<Side, { x: number; z: number }>;
  objectives: { primary: ObjectiveDef; secondary: ObjectiveDef[] };
  specialRules?: SpecialRule[];    // 例：{ type: 'narrow_frontage', zone, maxEngaged: 2 }、{ type: 'ford_disorder', mul: 0.8 }、{ type: 'woods_ambush', firstStrikeMul: 1.5 }
  presets: FieldPreset[];          // 演習で使う編成（武将 id・種類・兵・配置の枠）。歴史分岐・架空の章は自分で編成を作る
}
```

- **組み立て：** `buildBattleSetup(field, presetOrUnits, opts)` が `BattleSetup` を作る。
  - 今の `BattleSetup.map`（`BattleMap`）は、`field` から作る。
  - 今の「国境の原」も、同じ形のデータ `border_field` に移す。結果は変えない。
- **通れない所：** 川・崖は通れない。
  - 移動は、格子（5 m）の上の最短の道（A*）で、浅瀬・峠の道を通る。
  - 道の重みは、地形の速さから決める。
- **浅瀬：** 動き ×0.4。中にいる部隊は、与える損害 ×0.8・受ける損害 ×1.2（データ）。
- **視界：** 地形ごとに、隠れる距離（林の中は 60 m に近づくまで見えない、など）と、見通しの良さ（丘の上は遠くまで見える）を持つ。敵の考えは、見えている相手だけに反応する（今の決まりを一般化）。

### 20 種の分類（`FieldKind`）

今回作るのは印の 5 つ。ほかは同じ形のデータで足す。

| kind | 名称 | 主に使うデータ |
|---|---|---|
| **plains** | 大平原 | 道・予備隊の枠 |
| **river_ford** | 河川・浅瀬 | river・ford・ford_disorder |
| single_bridge | 一本橋 | river・bridge（狭い通路）・narrow_frontage |
| multi_bridge | 複数橋 | river・bridge×n |
| **hills** | 丘陵 | hill・highGround |
| ridge | 尾根 | hill（細長い）・cliff |
| **forest** | 森林 | woods・woods_ambush・視界 |
| **mountain_pass** | 山道・峠 | cliff・narrow_frontage |
| valley | 谷間 | cliff・hill（両側） |
| paddy | 水田 | field（遅い）・畦道 |
| marsh | 湿地 | marsh |
| village | 村落 | village（守りに有利） |
| temple | 寺社 | 石段・village |
| town_edge | 城下町外縁 | village・road |
| siege_front | 城攻め前面 | 堀（river）・門（地点確保） |
| besieged_camp | 包囲された陣 | 防衛の時間 |
| relief | 援軍救出 | 救出 |
| rearguard | 退却戦 | 撤退の成功 |
| night_raid | 夜襲・奇襲 | 視界を狭める special rule |
| shore | 湖・海・河岸 | river（片側）・ford |

## 4. 目標（主目標と副目標。`proto3d/src/battle/objectives.ts`）

- **目標の種類（`ObjectiveDef.type`）：**
  - `destroy_hq`：敵本陣の撃破
  - `hold_point` { zone, sec }：地点の確保。敵がいない状態で、味方が続けて sec 秒いる
  - `defend_time` { sec, zone? }：一定時間の防衛。本陣（または地点）を sec 秒まで守る
  - `rescue` { unitId, zone }：味方の救出。対象を zone まで無事に連れ帰る
  - `breakthrough` { zone, count }：指定地点の突破。味方 count 部隊が zone を抜ける
  - `retreat_success` { minRatio }：撤退の成功。本陣と兵の minRatio 以上が退き口から離れる
  - `survive_until` { reinforcementId }：援軍の到着まで耐える
  - `preserve_unit` { unitId, minRatio }：副目標向け。部隊を崩さない
  - `limit_losses` { maxRatio }：副目標向け。損害の上限
- **勝ち負けの決まり：**
  - 主目標を達成すれば勝利。
  - 敗北は、味方本陣の敗走・全軍が戦えない・主目標が達成できなくなった（例：救出の対象が崩れた）。
  - 撤退は、全軍撤退・日没。
  - 国境の原の今の勝ち負けは、`destroy_hq`＋今の決まりで同じになる。
- **副目標：** 勝敗とは別に判定し、結果を記録する。
- **記録：** `BattleOutcome.objectives = { primary: { id, type, achieved }, secondary: { id, label, achieved }[] }` を足す。
  - 約束（`pledge`）とは別の欄に持つ。勝敗・副目標・約束を別々に保存する。
- **歴史分岐の章の副目標：** 1 つ足す（例：「徳川弓隊を崩さずに終える」）。今の勝ち負け・約束の判定は変えない。

## 5. 今回の 5 戦場（演習で遊べる質。編成は武将 6 人を使う）

| id | 名称 | 地形の要点 | 主目標 | 副目標 | 特殊ルール | 編成（味方／敵） |
|---|---|---|---|---|---|---|
| plains | 大平原 | 平らな原・道・小さな林 1 つ | 敵本陣の撃破 | 予備隊（石川隊）を最後まで崩さない | なし | 7／7（家康・忠勝・榊原・酒井・石川・徳川弓・徳川騎馬） |
| river_ford | 河川・浅瀬 | 東西に流れる川、浅瀬 2 か所（中央は敵の弓の正面、西は遠回り）、向こう岸に小高い地点 | 向こう岸の地点を確保（60 秒） | 損害を 3 割以内に | 浅瀬の乱れ（中では与える損害 ×0.8・受ける損害 ×1.2・動き ×0.4） | 6／7 |
| hills | 丘陵 | 大きな丘 2 つ（中央・東）と谷 | 中央の丘を確保（90 秒） | 敵の弓隊を崩す | 高所の有利を強め（下からの攻めに ×0.65・弓の射程 +30 m） | 6／6 |
| forest | 森林 | 広い林と、林の中の細い道・空き地 | 敵本陣の撃破 | 林で迷った味方の小隊を救出 | 林の奇襲（見られていない部隊の最初の当たり ×1.5）、林の中の騎馬は動き ×0.5 | 6／8 |
| mountain_pass | 山道・峠 | 崖に挟まれた幅 30〜40 m の峠道、途中に関 | 援軍が来るまで耐える（240 秒。援軍は 180 秒で着く） | 関（地点）を失わない | 狭い正面（同じ敵に正面から当たれるのは 2 部隊まで） | 4＋援軍 2／10 |

- **戦い方の違い：**
  - 大平原：正面で押さえ、側面を回り、予備で決める。
  - 河川：浅瀬の選び方、渡る前に弓で崩す、渡りきってから押す。
  - 丘陵：先に高所を取る、取られたら回り込む。
  - 森林：林の中を見られずに進み、奇襲・救出する。
  - 峠：狭い所で少数で守る。攻める側は大軍でも一度に当たれない。
- **釣り合いのテスト（戦場ごと）：**
  - 何もしない、または正面だけ → 負けるか、苦しい。
  - 地形に合った作戦 → 勝てる。
  - 副目標は、作戦によって達成・未達成に分かれる。

## 6. 演習（今回の 5 戦場を普通の操作で遊ぶ入口）

- **流れ：**
  1. タイトルに「合戦場の演習」を足す。
  2. 戦場の一覧（名前・特徴・主目標・副目標・最高の記録）から選ぶ。
  3. 合戦の前の説明（地形・目標・特殊ルール・編成と武将の能力）。
  4. 合戦（今の画面と操作）。
  5. 結果（勝敗・主目標・副目標を別々に）→ 記録の保存 → 一覧へ。
- **保存：**
  - キー：`koto-sengoku/3d-fields`（版 1）。
  - 中身：戦場ごとの最後と最高の結果、主目標・副目標の達成、日時。
  - 書いた後に読み戻して確かめる。ほかの保存には触れない。
- **表示：** 演習は「ゲーム用の演習（架空の相手）」と表示する。敵は架空の「敵勢」（家 `ronin` の表示名を「敵勢」に。浪人衆とは別の家 `rival` を足してもよい）。

## 7. 確認

- 単体テスト：
  - 武将のデータ・能力の差し替え。
  - 地形の通行・道探し・浅瀬・視界・高所。
  - 目標 9 種の判定。
  - 5 戦場の釣り合い。
  - 20 種の分類のデータの検査（配置が通れる所にある・退き口へ行ける・目標の区域が通れる所にある）。
  - Version 11 の結果が同じこと。
  - 保存の互換。
- 通しの確認（本物の入力）：
  - 5 戦場を、タイトルから普通の操作で始める。
  - 1 つの戦場（大平原、7 部隊）で、PC とスマホの両方で選ぶ・移動・攻撃・防衛・撤退。
  - 各戦場で、作戦によって結果が変わる。
  - Version 11 の経路（歴史分岐・架空）がそのまま通る。
  - 歴史分岐の合戦で、勝敗・副目標・約束が別々に保存され、開き直しても残る。
