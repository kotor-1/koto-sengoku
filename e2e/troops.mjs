/**
 * 合戦の兵士の表示（大軍感。docs/troops-abilities-design.md §1）を、実際のブラウザで確かめて撮る。
 *   BASE3D=http://localhost:8181 node e2e/troops.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/troops）
 * - 大平原（?dev=field&id=plains&allies=8。味方 8／敵 7）を PC（1280×720）とスマホ横（844×390、タッチ）で開き、
 *   開始時・交戦中・兵が減った後を、全体と寄りで撮る（<kind>-start.png・<kind>-engaged.png・<kind>-engaged-close.png・<kind>-losses.png・<kind>-losses-close.png）。
 * - 見えている兵士（window.__battle.troopStats().visibleSoldiers）が全体表示で 300 人以上。
 * - 部隊の選択と命令：味方 8 部隊を、部隊の画面の位置の本物のクリック／タップで 1 つずつ選べる。選んだ部隊で地面を押すと移動の命令になる。
 * - 兵が減った後：止めた状態で、部隊ごとの描く人数が ceil(最初の人数 × 今の兵 ÷ 最初の兵) に落ち着く（全体表示は LOD 100%）。
 * - 画面外の部隊：味方の本陣へ寄ると、北の敵の部隊は描かない（culledUnits）。描画の呼び出しは全体表示より増えない。
 * - 1 フレームの時間（requestAnimationFrame の間の中央値）と描画の呼び出しの数を記録する。コンテナはソフトウェア描画なので実機の性能ではない。
 * 待つ時間だけは開発用の早送り（window.__battle.fastForward）と、寄りの撮影のカメラ（centerOn）を使う。選択・命令・開始・一時停止は本物のクリック・タップ。
 *
 * 記録（コンテナ・SwiftShader のソフトウェア描画。実機は未確認）：
 * - 変更前（Version 12。兵 25 人ごとに 1 体・最大 30 体、旗は部隊ごとの別の形）：
 *   PC 開始時 183 ms・描画の呼び出し 44／交戦中 217 ms・45。スマホ相当 開始時 150 ms・44／交戦中 167 ms・45。
 * - 変更後：このスクリプトの出力（frameMs・drawCalls）を見る。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8181';
const OUT = process.argv[2] || 'e2e-out/troops';
mkdirSync(OUT, { recursive: true });
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();

async function openPage(kind) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') log('console error', m.text());
    });
    await page.goto(`${BASE}/?dev=field&id=plains&allies=8`);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
    return { ctx, page, phone };
}

async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(150);
}
async function pointAt(p, x, y) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(200);
}
const stats = (page) => page.evaluate(() => window.__battle.troopStats());
const ui = (page) => page.evaluate(() => window.__battle.ui);

/** 1 フレームの時間（rAF の間の中央値、ms） */
async function frameMs(page) {
    return page.evaluate(async () => {
        const ts = [];
        await new Promise((res) => {
            const f = (t) => {
                ts.push(t);
                if (ts.length < 30) requestAnimationFrame(f);
                else res();
            };
            requestAnimationFrame(f);
        });
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, c) => a - c);
        return Math.round(d[Math.floor(d.length / 2)] * 10) / 10;
    });
}

/** 全体表示に戻す（画面の「全体」ボタン） */
async function fitAll(p) {
    await press(p, '.b-zall');
    await p.page.waitForTimeout(400);
}

const record = {};
for (const kind of ['desktop', 'phone']) {
    log(`== 大平原（${kind}）`);
    const p = await openPage(kind);
    const { page } = p;
    // 開始（本物のクリック／タップ）→ 止める
    await press(p, '.b-primary');
    await page.waitForTimeout(300);
    await press(p, '.b-pause');
    check((await ui(page)).paused === true, `${kind}：開始して一時停止`);
    await page.waitForTimeout(600);
    const s0 = await stats(page);
    record[kind] = { tier: s0.tier, start: { visible: s0.visibleSoldiers, drawCalls: s0.drawCalls, frameMs: await frameMs(page) } };
    check(s0.visibleSoldiers >= 300, `${kind}：開始時の全体表示で見えている兵士が 300 人以上`, `${s0.visibleSoldiers} 人（段 ${s0.tier}）`);
    const allyIds = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => u.id));
    check(allyIds.length === 8, `${kind}：味方 8 部隊`, String(allyIds.length));
    for (const id of allyIds) check(s0.perUnit[id] >= (kind === 'phone' ? 18 : 20) && s0.perUnit[id] <= 40, `${kind}：${id} の表示の人数`, String(s0.perUnit[id]));
    await page.screenshot({ path: `${OUT}/${kind}-start.png` });

    // 部隊の選択（部隊の画面の位置を本物のクリック／タップ）
    let pickOk = 0;
    for (const id of allyIds) {
        const q = await page.evaluate((i) => window.__battle.screenOf(i), id);
        await pointAt(p, q.x, q.y);
        const sel = (await ui(page)).selectedId;
        if (sel === id) pickOk++;
        else log(`    ${id} を押して ${sel} が選ばれた`);
    }
    check(pickOk === allyIds.length, `${kind}：味方 8 部隊を地図の上でそれぞれ押して選べる`, `${pickOk}/${allyIds.length}`);
    // 選んだ部隊（最後の部隊）で地面を押す → 移動の命令
    const last = allyIds[allyIds.length - 1];
    const g = await page.evaluate((i) => { const u = window.__battle.state.units.find((x) => x.id === i); return window.__battle.screenOfGround(u.x - 30, u.z - 25); }, last);
    await pointAt(p, g.x, g.y);
    const ord = await page.evaluate((i) => window.__battle.state.units.find((x) => x.id === i).order, last);
    check(ord.type === 'move', `${kind}：選んだ部隊で地面を押すと移動の命令`, JSON.stringify(ord));

    // 交戦中（待つ時間だけ早送り）
    await press(p, '.b-pause');
    await page.evaluate(() => window.__battle.fastForward(45));
    await press(p, '.b-pause');
    await page.waitForTimeout(1500);
    const s1 = await stats(page);
    const engaged = await page.evaluate(() => window.__battle.state.units.filter((u) => u.engagedWith).length);
    check(engaged >= 2, `${kind}：交戦している部隊がある`, String(engaged));
    record[kind].engaged = { visible: s1.visibleSoldiers, drawCalls: s1.drawCalls, frameMs: await frameMs(page) };
    check(s1.drawCalls <= s0.drawCalls + 6, `${kind}：交戦中も描画の呼び出しがほぼ同じ`, `${s0.drawCalls} → ${s1.drawCalls}`);
    await page.screenshot({ path: `${OUT}/${kind}-engaged.png` });
    await page.evaluate(() => { const u = window.__battle.state.units.find((x) => x.id === 'a_tadakatsu'); window.__battle.centerOn(u.x, u.z - 10, 120); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${kind}-engaged-close.png` });

    // 兵が減った後（さらに早送り → 止めて、人数が落ち着くまで待つ）
    await fitAll(p);
    await press(p, '.b-pause');
    await page.evaluate(() => window.__battle.fastForward(50));
    await press(p, '.b-pause');
    // 1 人ずつ抜けるのが落ち着くまで（実時間。止めていても表示の時計は進む）
    await page.waitForTimeout(9000);
    const s2 = await stats(page);
    const units = await page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, str: u.strength, start: u.startStrength, status: u.status, present: u.present })));
    let lossChecked = 0;
    let lossOk = 0;
    for (const u of units) {
        const n0 = s0.perUnit[u.id];
        const n2 = s2.perUnit[u.id];
        if (!n0 || s0.lodByUnit[u.id] !== 1 || s2.lodByUnit[u.id] !== 1 || !(n2 >= 0) || s2.culledUnits.includes(u.id)) continue;
        if (u.str >= u.start * 0.97) continue;
        const want = u.str >= 1 ? Math.min(n0, Math.max(1, Math.ceil((n0 * u.str) / u.start - 1e-9))) : 0;
        lossChecked++;
        if (n2 === want) lossOk++;
        else log(`    ${u.id}：兵 ${Math.round(u.str)}/${u.start} → 描く ${n2}（期待 ${want}）`);
    }
    check(lossChecked >= 3 && lossOk === lossChecked, `${kind}：兵が減った部隊は ceil(最初の人数 × 今 ÷ 最初) まで薄くなる`, `${lossOk}/${lossChecked} 部隊`);
    record[kind].losses = { visible: s2.visibleSoldiers, drawCalls: s2.drawCalls };
    await page.screenshot({ path: `${OUT}/${kind}-losses.png` });
    const damaged = units.filter((u) => u.present && u.side !== 'x' && u.status === 'ready').sort((a, c) => a.str / a.start - c.str / c.start)[0];
    await page.evaluate((i) => { const u = window.__battle.state.units.find((x) => x.id === i); window.__battle.centerOn(u.x, u.z - 5, 110); }, damaged.id);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${kind}-losses-close.png` });
    log(`    寄りの部隊：${damaged.id}（兵 ${Math.round(damaged.str)}/${damaged.start}）`);

    // 画面外の部隊は描かない
    await page.evaluate(() => { const u = window.__battle.state.units.find((x) => x.id === 'a_ieyasu'); window.__battle.centerOn(u.x, u.z + 10, 60); });
    await page.waitForTimeout(1000);
    const s3 = await stats(page);
    const culledEnemies = s3.culledUnits.filter((id) => id.startsWith('e_'));
    check(culledEnemies.length >= 2, `${kind}：本陣へ寄ると、画面外の敵の部隊は描かない`, culledEnemies.join(','));
    check(s3.drawCalls <= s0.drawCalls, `${kind}：寄っても描画の呼び出しは増えない`, `${s0.drawCalls} → ${s3.drawCalls}`);
    record[kind].close = { visible: s3.visibleSoldiers, drawCalls: s3.drawCalls, culled: s3.culledUnits.length, frameMs: await frameMs(page) };
    await p.ctx.close();
}
log('記録（コンテナのソフトウェア描画。実機の性能ではない）：');
log(JSON.stringify(record, null, 1));
await b.close();
if (failures.length) {
    log(`NG ${failures.length} 件`);
    for (const f of failures) log(`  - ${f}`);
    process.exit(1);
}
log('すべて ok');
