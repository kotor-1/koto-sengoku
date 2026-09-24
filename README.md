# 戦国探索記（試作第一号）

戦国時代を舞台にした、見下ろし型 2D 探索 RPG の最初の試作です。
城門・城下町・街道の小さなマップを歩き、家臣と話し、端末内に保存して続きから再開できます。

- 基本方針・設計の決まりごと → [docs/design-policy.md](docs/design-policy.md)
- 採用バージョンとテンプレートからの変更点 → このファイル末尾
- **実機確認の手順と記録表** → [docs/device-check.md](docs/device-check.md)
- テストと確認の一覧 → [docs/testing.md](docs/testing.md)
- 既知の問題 → [docs/known-issues.md](docs/known-issues.md)

## 必要なもの

- Node.js 22.12 以上（テスト用の Vitest 5 の要件。作成時は 22.22.2 / npm 10.9.7 で確認）
- macOS なら Homebrew などで Node.js を入れておく（`node -v` で確認）

## 起動手順（Mac）

```bash
npm install        # 初回のみ
npm run dev        # 開発サーバー → http://localhost:8080 をブラウザで開く
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（変更を保存すると自動で再読み込み） |
| `npm run dev:lan` | 同じ Wi-Fi のスマホから開ける開発サーバー |
| `npm run build` | 本番用ファイルを `dist/` に出力 |
| `npm run preview` / `preview:lan` | `dist/` を配信して本番と同じ状態で確認（ポート 8080） |
| `npm run typecheck` | 型検査（`tsc`） |
| `npm test` | 単体テスト（Vitest） |
| `npm run check` | 型検査 → テスト → ビルドをまとめて実行 |
| `npm run e2e:*` | ブラウザでの確認（一覧は [docs/testing.md](docs/testing.md)） |

## スマホで確認する方法

詳しい手順と記録表は [docs/device-check.md](docs/device-check.md)。要点：

1. Mac とスマホを同じ Wi-Fi につなぐ。
2. Mac で `npm ci && npm run build && npm run preview:lan` を実行し、表示される `Network: http://192.168.x.x:8080/` を控える。
3. スマホでその URL に `?fps` を付けて開き（例 `http://192.168.x.x:8080/?fps`）、横向きにする。
4. タイトル下部に出る「コミット・Phaser の版」を記録表に書く。

クラウドの検証コンテナで起動したサーバー（`localhost`・`192.0.2.x`）はスマホからは開けません。公開済みの確認 URL はありません。

## 操作

| | Mac（キーボード） | スマホ（タッチ） |
|---|---|---|
| 移動 | 矢印キー / WASD | 画面左半分のどこかに触れてなぞる（触れた所がスティックの中心） |
| 話す・調べる・次へ | Space / Enter / Z | 右下の丸ボタン（会話中は会話枠を触っても進む） |
| メニュー（保存など） | Esc | 右上「メニュー」 |
| 時間帯（昼・夕・夜）の切り替え | T | 右上の「昼／夕／夜」ボタン |

時間帯は見た目の確認用で、ゲームの進行や保存データには影響しません（端末に好みとして覚えるだけ）。

## 2.5D ビジュアル試作の確認用 URL

| URL の末尾 | 内容 |
|---|---|
| `?fps` | 左下に fps・画質とその理由・実際の描画画素数・表示中の物の数・素材の容量・操作できるまでの時間・コミット ID を表示 |
| `?q=low` / `?q=high` | 画質を強制（メニューの「画質」より優先。既定は端末のメモリ・コア数から自動判定） |
| `?rotsway` / `?maxtex=N` | 既知の描画問題の切り分け用（[docs/known-issues.md](docs/known-issues.md)） |
| `/tools/gallery.html` | 開発用の素材一覧（人物の 8 方向の歩行を再生）。`?only=hero` などで絞り込み |

例：スマホで `http://192.168.x.x:8080/?fps` を開くと、実機の fps を画面で確かめられます。

## 遊び方（今回の範囲）

1. 城内で目を覚ました若殿として、城門の内側にいる家臣「源蔵」に話しかける。
2. 城門を出て南の **城下町** と、東の橋を渡った **街道** を見回る（画面上部に進み具合が出ます）。
3. 源蔵のところへ戻って報告する。
4. 高札・井戸・道標も調べられます。東端の関所より先へは進めません。

メニューの「端末に保存する」で保存し、タイトルの「つづきから」で再開できます。

## フォルダ構成

（2.5D 表示の考え方は [docs/art-direction.md](docs/art-direction.md)）

```
src/
  core/        ゲームの状態とルール（Phaser・DOM に依存しない。テスト対象）
    map.ts         マップ（文字で描いた地図）・当たり判定・地域
    session.ts     1 フレームごとの更新（移動・会話・地域の変化）
    dialogue.ts    会話文と目的の文言
    save.ts        保存・読み込み・検査
    input.ts       入力のまとめ役（解除処理を含む）
    joystick.ts    スティックの計算
  render/      Phaser による描画（状態を読んで絵を合わせるだけ）
    WorldScene.ts  探索画面（奥行きの並べ替え・影・光・環境の動き・カメラ）
    viewport.ts    Canvas の解像度管理（高精細画面でも最大 2 倍、重ければ自動で下げる）
    art/           仮素材（Canvas で描く高解像度の 2D。spec.ts が大きさ・基準点・色の約束）
    world/         描画用の純粋ロジック（配置の抽出・8 方向の向き・カメラ・品質・時間帯）
  platform/    ブラウザとのやりとり（キーボード・タッチ・スクロール防止・画面回転）
  ui/          文字や枠などの DOM 表示（タイトル・会話・メニュー）
  app.ts       入力 → 状態 → 表示 をつなぐ
tests/         単体テスト（core と render/world）
tools/         開発用ページ（素材一覧）
public/style.css  画面レイアウト（セーフエリア対応・縦画面の案内）
```

## 採用バージョン（2026-09-24 時点）

| 項目 | バージョン | 備考 |
|---|---|---|
| 公式テンプレート | [phaserjs/template-vite-ts](https://github.com/phaserjs/template-vite-ts) v1.4.0（commit `d1d7d58`） | |
| Phaser | 4.0.0 | テンプレートの指定どおり（npm 最新は 4.2.1。上げる場合は動作確認のうえで） |
| Vite | 6.4.3 | テンプレートの指定 `^6.3.1` の範囲で、開発サーバーの既知脆弱性修正版へ更新 |
| TypeScript | 5.7.3 | テンプレートの指定 `~5.7.2` |
| terser | 5.39.0 | テンプレートどおり |
| Vitest | 5.0.1 | テスト用に追加（3.x に脆弱性警告があったため 5 系を採用） |

正確な解決バージョンは `package-lock.json` を参照してください。

### テンプレートから変えた点

- テンプレートのサンプルシーン・画像を取り除き、ゲーム本体に置き換えた。
- `log.js`（`npm run dev` / `build` のたびに外部サーバーへ匿名の利用情報を送る仕組み）は取り込まず、テンプレートの `*-nolog` と同じ動作を標準にした。
- テンプレート同梱の `package-lock.json` は `package.json` と食い違っていた（lock 側が Phaser 3.88.2）ため、`package.json` の指定に合わせて作り直した。
- テンプレートのライセンス表記は `LICENSE-phaser-template` として残している。
