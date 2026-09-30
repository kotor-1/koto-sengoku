/**
 * 合戦の描画の重さを、Version 12 と今のコードで同じ手順で測る（記録用。合否は付けない）。
 *   BASE3D=http://localhost:8184 node e2e/troops-perf.mjs [ラベル] [出力 JSON]
 * - 大平原（?dev=field&id=plains&render=manual（探索は描かない）。演習の編成：味方 7／敵 7）を PC（1280×720）とスマホ横（844×390、タッチ）で開き、
 *   開始して止めた全体表示（開始時）・45 秒早送りの後の全体表示（交戦中）・交戦の所への寄り（カメラの距離 110 m）で、
 *   1 フレームの時間（requestAnimationFrame の間の中央値。30 フレーム）・描画の呼び出しの数・三角の数・兵士（人形）の数を測る。
 * - 兵士の数：今のコードは window.__battle.troopStats().visibleSoldiers（描いた兵士）。Version 12（troopStats が無い）は、
 *   画面に出ている部隊の人形の数 figureCount(兵)（1 体 25 人・最大 30 体。Version 12 の view.ts と同じ式）の合計。
 * - Version 12 は git の 569e367 を別の作業ツリーで開発サーバーに出して、同じポートで測る（交互に測る）。
 * 確認の種類：開始・一時停止・全体は本物のクリック／タップ。待つ時間は早送り、寄りはカメラ（centerOn。表示だけ）。
 * コンテナは SwiftShader のソフトウェア描画で、ほかの作業と CPU を取り合う。数字は前後の比べの目安で、実機の性能ではない（実機は未確認）。
 *
 * 記録（2026-09-30。Version 12＝569e367 と Version 13 候補＝このコミットを、同じポートで 今 → 12 → 今 → 12 の順に 2 回ずつ。1 フレームは 2 回の値）：
 *   場面               | Version 12：呼び出し・三角・人形・1 フレーム       | Version 13 候補：呼び出し・三角・兵士・1 フレーム
 *   PC 開始時           | 42・15.6 万・219 体・217／217 ms                  | 18・16.7 万・387 人・250／283 ms
 *   PC 交戦中（45 秒）   | 43・15.6 万・195 体・250／233 ms                  | 21・15.9 万・338 人・250／233 ms
 *   PC 寄り（110 m）     | 29・15.5 万・195 体（画面外も描く）・183／167 ms   | 17・13.9 万・184 人（画面外は描かない）・183／150 ms
 *   スマホ相当 開始時    | 42・15.6 万・219 体・200／200 ms                  | 18・15.8 万・322 人・233／200 ms
 *   スマホ相当 交戦中    | 43・15.6 万・193 体・200／200 ms                  | 21・15.3 万・286 人・217／200 ms
 *   スマホ相当 寄り      | 29・15.5 万・193 体・133／117 ms                  | 17・13.6 万・164 人・133／117 ms
 *   描く兵士は 1.5〜1.8 倍になったが、描画の呼び出しは半分以下、三角はほぼ同じ。1 フレームの時間は揺れ（±30 ms ほど）の中でほぼ同じ。
 */
import { launchBrowser } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8184';
const LABEL = process.argv[2] || 'now';
const OUT = process.argv[3] || '';
const b = await launchBrowser();

async function frameMs(page) {
    return page.evaluate(async () => {
        const ts = [];
        await new Promise((res) => {
            const f = (t) => {
                ts.push(t);
                if (ts.length < 31) requestAnimationFrame(f);
                else res();
            };
            requestAnimationFrame(f);
        });
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, c) => a - c);
        return Math.round(d[Math.floor(d.length / 2)]);
    });
}
async function measure(page) {
    await page.waitForTimeout(1200);
    const ms = await frameMs(page);
    const r = await page.evaluate(async () => {
        const B = window.__battle;
        const info = B.info();
        let soldiers;
        let how;
        if (typeof B.troopStats === 'function') {
            soldiers = B.troopStats().visibleSoldiers;
            how = 'troopStats';
        } else {
            const { figureCount } = await import('/src/battle/control.ts');
            soldiers = 0;
            B.state.units.forEach((u, i) => {
                if (B.view.unitPos(i).shown) soldiers += figureCount(u.strength);
            });
            how = 'figureCount';
        }
        return { calls: info.calls, triangles: info.triangles, soldiers, how };
    });
    return { frameMs: ms, ...r };
}
async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(300);
}

const res = { label: LABEL };
for (const kind of ['desktop', 'phone']) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(900000);
    await page.goto(`${BASE}/?dev=field&id=plains&render=manual`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 900000, polling: 500 });
    const p = { page, phone };
    await press(p, '.b-primary');
    await press(p, '.b-pause');
    await press(p, '.b-zall');
    const start = await measure(page);
    await page.evaluate(() => window.__battle.fastForward(45));
    await press(p, '.b-zall');
    const engaged = await measure(page);
    await page.evaluate(() => {
        const s = window.__battle.state;
        const u = s.units.find((x) => x.engagedWith && x.present) ?? s.units.find((x) => x.id === 'a_tadakatsu');
        window.__battle.centerOn(u.x, u.z - 5, 110);
    });
    const close = await measure(page);
    res[kind] = { start, engaged, close };
    console.log(LABEL, kind, JSON.stringify(res[kind]));
    await ctx.close();
}
await b.close();
if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1));
