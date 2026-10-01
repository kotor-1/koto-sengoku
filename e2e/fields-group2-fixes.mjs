/**
 * 第2群の確認で見つかった問題の直しを、実際のブラウザで確かめる（e2e/fields-group2.mjs の続き）。
 *   BASE3D=http://localhost:8206 BASE=http://localhost:8206 node e2e/fields-group2-fixes.mjs [出力先]
 *   （開発サーバー：PORT=8206 npx vite --config proto3d/blender/tools/vite.nohmr.mjs。最初に 1 回ページを開いて温めておく）
 * PARTS=bridge,flee で一部だけ（既定はすべて）。KINDS=desktop,phone で端末を絞る（既定は両方）。
 *
 * - bridge（一本橋。PC 1280×720 とスマホ相当 844×390・タッチ）：
 *   - 状態を直接操作：確認で詰まった場面を置く（本多忠勝隊を橋の北の東の角 (9.8,-38)、酒井隊を北の岸 (15.9,-54.9)、榊原隊を西の角
 *     (-9.7,-39.4) に。敵は北の端へ退ける。命令はみな待機）。
 *   - 本物の入力：忠勝隊を札で選び、地面の橋頭 (0,-75) を押す（移動の命令になる）。
 *   - 早送り（25 秒）：忠勝隊が橋頭に着いて待機に変わる（直す前は角で 6 秒ほどで待機に戻り、38 m 残っていた）。酒井隊・榊原隊は押し出されない。
 * - flee（谷間。PC とスマホ相当）：
 *   - 状態を直接操作：敵勢の出口の騎馬を、谷底 (0,-100) で敗走中にする（見えている）。徳川騎馬隊を谷底 (0,-40) に置く。
 *   - 本物の入力：徳川騎馬隊を札で選び、敗走中の騎馬の体を押す → その地点への移動の命令になる（直す前は攻撃の命令になり
 *     「その部隊はもう戦えません」と断られて動かなかった）。続けて戦える敵（出口の塞ぎ）の体を押すと、今までどおり攻撃の命令になる。
 * 待ちは開発用の早送り（window.__battle.fastForward）。状態は window.__battle から読む。場面を置くところだけ直接書き換える（上に書いた所だけ）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8206';
const OUT = process.argv[2] || 'e2e-out/fields-group2-fixes';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'bridge,flee').split(',');
const KINDS = (process.env.KINDS || 'desktop,phone').split(',');
const failures = [];
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 600000, polling: 250 };

const b = await launchBrowser();

async function openField(kind, id) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text())) {
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    const p = { ctx, page, phone, kind };
    // 開始して「指揮」で止める（開始の瞬間だけ時の進みを 0）
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-primary', 300);
    await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    return p;
}
async function bpress(p, sel, wait = 150) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(wait);
}
async function pointAt(p, x, y, wait = 300) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
const ui = (page) => page.evaluate(() => window.__battle.ui);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, order: u.order, status: u.status };
    }, id);
const center = (p, x, z, d) => p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d ?? undefined), [x, z, d ?? null]);
async function card(p, id) {
    await bpress(p, `.b-card[data-id="${id}"]`, 250);
    return (await ui(p.page)).selectedId === id;
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.b-toast')].map((e) => e.textContent));
async function shot(p, name) {
    await p.page.waitForTimeout(400);
    await p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
    log(`   撮影 ${p.kind}-${name}`);
}

/** 状態を直接操作：味方の pos の部隊を置き、ほかの味方は南東の隅、敵は北の端へ。命令はみな待機、武将の自由な動きはなし */
async function place(page, pos, enemyZ) {
    await page.evaluate(
        ([pos, enemyZ]) => {
            const s = window.__battle.state;
            s.units.forEach((u, i) => {
                if (u.side === 'enemy') {
                    u.x = -180 + i * 25;
                    u.z = enemyZ;
                } else {
                    u.x = 150 + i * 20;
                    u.z = 150;
                }
                u.order = { type: 'hold' };
                u.initiative = null;
                u.path = null;
                u.engagedWith = null;
            });
            for (const [id, x, z] of pos) {
                const u = s.units.find((v) => v.id === id);
                u.x = x;
                u.z = z;
            }
        },
        [pos, enemyZ],
    );
}

// ================================================================ 一本橋：橋の北の角で詰まらない
async function bridgePart(kind) {
    log(`== [${kind}] 一本橋：橋の北の角で味方に挟まれた忠勝隊が、橋頭へ着く`);
    const p = await openField(kind, 'single_bridge');
    const { page } = p;
    await place(page, [
        ['a_tadakatsu', 9.8, -38],
        ['a_sakai', 15.9, -54.9],
        ['a_sakakibara', -9.7, -39.4],
    ], -175);
    check(await card(p, 'a_tadakatsu'), `[${kind}] 一本橋：札で本多忠勝隊を選ぶ`);
    await center(p, 0, -60, p.phone ? 200 : 240);
    await p.page.waitForTimeout(300);
    const g = await page.evaluate(() => window.__battle.screenOfGround(0, -75));
    await shot(p, 'bridge-before');
    await pointAt(p, g.x, g.y, 400);
    const o = await unit(page, 'a_tadakatsu');
    check(o.order.type === 'move' && Math.hypot(o.order.x - 0, o.order.z + 75) < 4, `[${kind}] 一本橋：地面の橋頭を押すと移動の命令`, JSON.stringify(o.order));
    // 早送り 1 秒ずつ（待機に変わったらやめる）
    let doneAt = null;
    for (let i = 0; i < 25; i++) {
        await page.evaluate(() => window.__battle.fastForward(1));
        const u = await unit(page, 'a_tadakatsu');
        if (u.order.type !== 'move') {
            doneAt = await page.evaluate(() => window.__battle.state.t);
            break;
        }
    }
    const t = await unit(page, 'a_tadakatsu');
    const d = Math.hypot(t.x - 0, t.z + 75);
    check(doneAt !== null && d < 3, `[${kind}] 一本橋：忠勝隊は角で止まらず橋頭に着いて待機に変わる（直す前は角で 6 秒ほどで待機に戻り 38 m 残った）`, `着いた時刻 ${doneAt?.toFixed(1)}・行き先まで ${d.toFixed(1)} m・(${t.x.toFixed(1)},${t.z.toFixed(1)})`);
    const sakai = await unit(page, 'a_sakai');
    const saka = await unit(page, 'a_sakakibara');
    check(Math.hypot(sakai.x - 15.9, sakai.z + 54.9) < 1 && Math.hypot(saka.x + 9.7, saka.z + 39.4) < 1, `[${kind}] 一本橋：待機している酒井隊・榊原隊は押し出されない`, `酒井 (${sakai.x.toFixed(1)},${sakai.z.toFixed(1)})・榊原 (${saka.x.toFixed(1)},${saka.z.toFixed(1)})`);
    await shot(p, 'bridge-after');
    await p.ctx.close();
}

// ================================================================ 谷間：敗走中の敵の体を押すと移動
async function fleePart(kind) {
    log(`== [${kind}] 谷間：敗走中の敵の体を押すと、その地点への移動になる`);
    const p = await openField(kind, 'valley');
    const { page } = p;
    await place(page, [['a_kiba', 0, -40]], -220);
    // 敵勢の出口の騎馬を谷底 (0,-100) で敗走中に、出口の塞ぎを (40,-110) に（戦える敵の確かめ用）。どちらも見えている
    await page.evaluate(() => {
        const s = window.__battle.state;
        const k = s.units.find((u) => u.id === 'e_kiba');
        Object.assign(k, { x: 0, z: -100, status: 'routed', order: { type: 'retreat' } });
        k.seenBy.ally = true;
        const blk = s.units.find((u) => u.id === 'e_block');
        Object.assign(blk, { x: 40, z: -110 });
        blk.seenBy.ally = true;
    });
    check(await card(p, 'a_kiba'), `[${kind}] 谷間：札で徳川騎馬隊を選ぶ`);
    await center(p, 10, -90, p.phone ? 180 : 220);
    await page.waitForTimeout(400);
    const k = await page.evaluate(() => window.__battle.screenOf('e_kiba'));
    const hit = await page.evaluate(([x, y]) => window.__battle.view.pick(window.__battle.state, x, y, 4), [k.x, k.y]);
    check(hit === 'e_kiba', `[${kind}] 谷間：押す所は敗走中の騎馬の体の上`, String(hit));
    const before = await toasts(page);
    await shot(p, 'flee-before');
    await pointAt(p, k.x, k.y, 500);
    const o = await unit(page, 'a_kiba');
    const after = await toasts(page);
    const refused = after.filter((x) => !before.includes(x) && x.includes('もう戦えません'));
    check(o.order.type === 'move' && Math.hypot(o.order.x - 0, o.order.z + 100) < 8 && refused.length === 0,
        `[${kind}] 谷間：敗走中の騎馬の体を押すと、その地点への移動の命令（攻撃にならず、断られない）`, `${JSON.stringify(o.order)}・${(await ui(page)).hint ?? ''}`);
    await page.evaluate(() => window.__battle.fastForward(2));
    const moved = await unit(page, 'a_kiba');
    check(moved.z < -40 - 3, `[${kind}] 谷間：徳川騎馬隊が動き出す`, `(${moved.x.toFixed(1)},${moved.z.toFixed(1)})`);
    // 戦える敵（出口の塞ぎ）の体は、今までどおり攻撃
    await center(p, 40, -110, p.phone ? 180 : 220);
    await page.waitForTimeout(400);
    const bq = await page.evaluate(() => window.__battle.screenOf('e_block'));
    await pointAt(p, bq.x, bq.y, 400);
    const o2 = await unit(page, 'a_kiba');
    check(o2.order.type === 'attack' && o2.order.targetId === 'e_block', `[${kind}] 谷間：戦える敵（出口の塞ぎ）の体を押すと、今までどおり攻撃の命令`, JSON.stringify(o2.order));
    await shot(p, 'flee-after');
    await p.ctx.close();
}

for (const kind of KINDS) {
    if (PARTS.includes('bridge')) await bridgePart(kind);
    if (PARTS.includes('flee')) await fleePart(kind);
}
await b.close();
log(failures.length ? `\nNG ${failures.length}\n${failures.join('\n')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
