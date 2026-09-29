/**
 * 第一章の合戦の画面（proto3d/src/battle/）を、実際のブラウザで実際のクリック・タップで確かめる。
 *   BASE=http://localhost:8111 node e2e/chapter1-battle.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - ?dev=battle で合戦をすぐ始め、同じページで 3 つの協力陣営（田代・大森・独力）の合戦を続けて行う（後片付けと入り直しも確かめる）。
 * - PC（1280×720、マウス・キー）とスマホ横向き（844×390、タッチ）の 2 通り。
 * - 選ぶ・移動・攻撃・防衛・待機・撤退・指揮（一時停止）・速さ・全軍撤退（確かめ）を実際の操作で行う。
 * - 待つ時間だけは開発用の早送り（window.__battle.fastForward）を使う（ソフトウェア描画のコンテナでは実時間では何分もかかるため）。
 *   命令そのものは、すべて画面のクリック・タップ・キーで出す。
 * - 田代：別働隊の回り込みで勝つ。大森：本陣だけで突っ込んで負ける。独力：全軍撤退。
 * 画面の撮影は 出力先/desktop-*.png・phone-*.png。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/chapter1/battle';
mkdirSync(OUT, { recursive: true });
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what) {
    log(`${ok ? '  ok ' : '  NG '} ${what}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();

async function openPage(kind) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(
        phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } },
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') log('console error', m.text());
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?dev=battle&ally=tashiro&q=low`);
    await waitBriefing(page);
    log(`[${kind}] 合戦の画面まで ${Date.now() - t0} ms`);
    return { page, ctx, phone };
}

async function waitBriefing(page) {
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 30000, polling: 250 });
    await page.waitForTimeout(400);
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const unit = (page, id) => page.evaluate((id) => {
    const u = window.__battle.state.units.find((x) => x.id === id);
    return u && { id: u.id, x: u.x, z: u.z, order: u.order, status: u.status, present: u.present, engagedWith: u.engagedWith, arrived: u.arrived, seen: u.seenBy.ally, strength: u.strength };
}, id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const groundXY = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const center = (page, x, z, d) => page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, d]);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
/** 条件がそろうまで早送り（最長 max 秒） */
async function ffUntil(page, cond, max = 400) {
    const step = cond === 'false' ? 5 : 0.5;
    for (let t = 0; t < max; t += step) {
        const r = await page.evaluate(([c, st]) => {
            const s = window.__battle.state;
            const U = (id) => s.units.find((u) => u.id === id);
            // eslint-disable-next-line no-new-func
            const ok = new Function('s', 'U', `return (${c});`)(s, U);
            if (ok || s.result) return { ok, t: s.t, result: s.result };
            window.__battle.fastForward(st);
            return null;
        }, [cond, step]);
        if (r) return r;
    }
    return { ok: false };
}
/** 押す（PC はマウス、スマホはタッチ） */
async function hit(page, phone, x, y) {
    if (phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(250);
}
async function hitEl(page, phone, locator) {
    if (phone) await locator.tap();
    else await locator.click();
    await page.waitForTimeout(250);
}
/** その画面の点が地図（UI に隠れていない所）か */
const onMap = (page, p) => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.classList.contains('b-input'), [p.x, p.y]);
async function hitUnit(page, phone, id) {
    await page.waitForTimeout(600); // 表示の位置が落ち着くまで
    let p = await screenOf(page, id);
    if (!(await onMap(page, p))) {
        // UI（札・ボタン）に隠れているときは、その部隊へカメラを寄せてから押す（遊ぶ人も地図を動かして押す）
        const u = await unit(page, id);
        await center(page, u.x, u.z);
        await page.waitForTimeout(600);
        p = await screenOf(page, id);
    }
    await hit(page, phone, p.x, p.y);
}
async function hitGround(page, phone, x, z) {
    let p = await groundXY(page, x, z);
    if (!(await onMap(page, p))) {
        await center(page, x, z);
        await page.waitForTimeout(400);
        p = await groundXY(page, x, z);
    }
    await hit(page, phone, p.x, p.y);
}
const cmd = (page, text) => page.locator('.b-cmd', { hasText: text });
const card = (page, name) => page.locator('.b-card', { hasText: name });
async function shot(page, name) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** CDP のタッチで 1 本指のドラッグ・2 本指のピンチ（Playwright の touchscreen は tap だけ） */
async function touchDrag(page, x0, y0, x1, y1) {
    const c = await page.context().newCDPSession(page);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let i = 1; i <= 6; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6, id: 1 }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await c.detach();
}
async function pinch(page, cx, cy, from, to) {
    const c = await page.context().newCDPSession(page);
    const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
    for (let i = 1; i <= 6; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 6) });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await c.detach();
}

/** 部隊が画面の UI に隠れない所に来るように */
async function frameOn(page, x, z, d = 260) {
    await center(page, x, z, d);
    await page.waitForTimeout(300);
}

/** 共通：開始・一時停止・選ぶ・移動・攻撃・防衛・撤退・札・キー・寄る／引く・速さ */
async function basics(page, phone, tag) {
    log(`[${tag}] 開始・基本の操作`);
    await shot(page, `${tag}-01-briefing`);
    await hitEl(page, phone, page.locator('.b-primary', { hasText: '合戦を始める' }));
    let u = await ui(page);
    check(u.started && !u.paused && u.modal === null, `${tag}: 「合戦を始める」で始まる`);
    // 指揮（一時停止）
    if (phone) await hitEl(page, phone, page.locator('.b-pause'));
    else await page.keyboard.press('Space');
    u = await ui(page);
    check(u.paused, `${tag}: ${phone ? '指揮ボタン' : 'Space'} で一時停止`);
    const t0 = (await page.evaluate(() => window.__battle.state.t));
    await page.waitForTimeout(800);
    check((await page.evaluate(() => window.__battle.state.t)) === t0, `${tag}: 一時停止中は時間が進まない`);
    await shot(page, `${tag}-02-paused`);

    // 地図の部隊を押して選ぶ
    await frameOn(page, 10, 40, phone ? 230 : 260);
    await hitUnit(page, phone, 'a_genzo');
    u = await ui(page);
    check(u.selectedId === 'a_genzo', `${tag}: 地図の源蔵隊を押して選ぶ`);
    // 地面を押して移動
    await hitGround(page, phone, -30, 45);
    let g = await unit(page, 'a_genzo');
    check(g.order.type === 'move' && Math.hypot(g.order.x + 30, g.order.z - 45) < 8, `${tag}: 地面を押して移動（${JSON.stringify(g.order)}）`);
    // 「攻撃」の後で敵を押す
    await hitEl(page, phone, cmd(page, '攻撃'));
    check((await ui(page)).pending === 'attack', `${tag}: 「攻撃」で敵を選ぶ待ち`);
    await hitGround(page, phone, 20, 20); // 地面では攻撃にならない（案内だけ）
    g = await unit(page, 'a_genzo');
    check(g.order.type === 'move' && (await ui(page)).pending === 'attack', `${tag}: 攻撃の待ちで地面を押しても命令は変わらない`);
    await hitUnit(page, phone, 'e_sente');
    g = await unit(page, 'a_genzo');
    check(g.order.type === 'attack' && g.order.targetId === 'e_sente', `${tag}: 敵（鷲尾先手）を押して攻撃`);
    await shot(page, `${tag}-03-attack-order`);
    // 防衛・待機、撤退（ボタン）
    await hitEl(page, phone, cmd(page, '防衛・待機'));
    check((await unit(page, 'a_genzo')).order.type === 'hold', `${tag}: 「防衛・待機」`);
    await hitEl(page, phone, cmd(page, '撤退'));
    check((await unit(page, 'a_genzo')).order.type === 'retreat', `${tag}: 「撤退」`);
    await shot(page, `${tag}-04-retreat-order`);
    await hitEl(page, phone, cmd(page, '防衛・待機'));
    // 「移動」の後で地面
    await hitEl(page, phone, cmd(page, '移動'));
    await hitGround(page, phone, 15, 20);
    g = await unit(page, 'a_genzo');
    check(g.order.type === 'move' && Math.hypot(g.order.x - 15, g.order.z - 20) < 8, `${tag}: 「移動」の後で地面を押す`);
    // 札で選ぶ
    await hitEl(page, phone, card(page, '新八隊'));
    check((await ui(page)).selectedId === 'a_shinpachi', `${tag}: 札で新八隊を選ぶ`);
    if (!phone) {
        await page.keyboard.press('2');
        check((await ui(page)).selectedId === 'a_genzo', `${tag}: 2 キーで源蔵隊`);
        await page.keyboard.press('KeyH');
        check((await unit(page, 'a_genzo')).order.type === 'hold', `${tag}: H キーで防衛・待機`);
        // 右クリックで移動
        const p = await groundXY(page, -20, 60);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await page.waitForTimeout(200);
        g = await unit(page, 'a_genzo');
        check(g.order.type === 'move' && Math.hypot(g.order.x + 20, g.order.z - 60) < 8, `${tag}: 右クリックで移動`);
        await page.keyboard.press('Escape');
        check((await ui(page)).selectedId === null, `${tag}: Esc で選択を外す`);
    }
    // スマホ：選んでいる味方（新八隊）をもう一度押すと選択が外れる（タッチには Esc が無いので、これで外して敵を調べる）
    if (phone) {
        await hitUnit(page, phone, 'a_shinpachi');
        check((await ui(page)).selectedId === null, `${tag}: 選んでいる部隊をもう一度押すと選択が外れる`);
    }
    // 敵を調べる（味方を選んでいないとき）
    await hitUnit(page, phone, 'e_sente');
    check((await ui(page)).selectedId === 'e_sente', `${tag}: 味方を選ばずに敵を押すと調べる`);
    check(await page.locator('.b-inspect').isVisible(), `${tag}: 敵の様子の札が出る`);
    await shot(page, `${tag}-05-inspect`);
    await hitGround(page, phone, 90, 110);
    check((await ui(page)).selectedId === null, `${tag}: 地面を押して選択を外す`);

    // 寄る・引く・地図を動かす（動かしても命令にならない）
    const cam0 = await page.evaluate(() => window.__battle.camera);
    if (phone) {
        await pinch(page, 420, 200, 60, 140);
        await page.waitForTimeout(200);
        const cam1 = await page.evaluate(() => window.__battle.camera);
        check(cam1.dist < cam0.dist * 0.8, `${tag}: 2 本指で寄る（${cam0.dist.toFixed(0)} → ${cam1.dist.toFixed(0)}）`);
        await touchDrag(page, 420, 200, 300, 160);
        await page.waitForTimeout(200);
        const cam2 = await page.evaluate(() => window.__battle.camera);
        check(Math.abs(cam2.tx - cam1.tx) + Math.abs(cam2.tz - cam1.tz) > 5, `${tag}: 1 本指のドラッグで地図が動く`);
    } else {
        await page.mouse.move(640, 330);
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(200);
        const cam1 = await page.evaluate(() => window.__battle.camera);
        check(cam1.dist < cam0.dist * 0.8, `${tag}: ホイールで寄る（${cam0.dist.toFixed(0)} → ${cam1.dist.toFixed(0)}）`);
        await page.mouse.move(640, 330);
        await page.mouse.down();
        await page.mouse.move(560, 300, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const cam2 = await page.evaluate(() => window.__battle.camera);
        check(Math.abs(cam2.tx - cam1.tx) + Math.abs(cam2.tz - cam1.tz) > 5, `${tag}: ドラッグで地図が動く`);
    }
    check((await ui(page)).selectedId === null, `${tag}: ドラッグ・ピンチでは選択も命令も起きない`);
    await hitEl(page, phone, page.locator('.b-zall'));
    const cam3 = await page.evaluate(() => window.__battle.camera);
    check(Math.abs(cam3.dist - cam0.maxDist / 1.2) < 30, `${tag}: 「全体」で戦場全体へ`);
    // 速さ
    await hitEl(page, phone, page.locator('.b-seg', { hasText: '×2' }));
    check((await ui(page)).speed === 2, `${tag}: 速さ ×2`);
    await hitEl(page, phone, page.locator('.b-seg', { hasText: '×1' }));
    // 再開
    await hitEl(page, phone, page.locator('.b-pause'));
    check(!(await ui(page)).paused, `${tag}: 再開`);
    // 画面を離れたら自動で一時停止
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check((await ui(page)).paused, `${tag}: 画面を離れたら（blur）自動で一時停止`);
}

/** 結果を確かめて「続ける」 */
async function finish(page, phone, tag, want) {
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 30000, polling: 250 });
    const r = await page.evaluate(() => window.__battle.state.result);
    check(r.result === want, `${tag}: 結果が「${want}」（${r.result} / ${r.reason} / ${r.elapsedSec.toFixed(1)} 秒）`);
    await shot(page, `${tag}-09-result`);
    const title = await page.locator('.b-result h2').textContent();
    log(`    結果の画面：${title} ${await page.locator('.b-reason').textContent()}`);
    await hitEl(page, phone, page.locator('.b-primary', { hasText: '続ける' }));
    // 探索の描画はソフトウェア描画ではとても遅いので、フレームごとではなく一定の間隔で確かめる
    await page.waitForFunction(() => window.__battleOutcome && !document.body.classList.contains('mode-battle'), null, { timeout: 60000, polling: 500 });
    const left = await page.evaluate(() => ({ dom: !!document.getElementById('battle-ui'), outcome: window.__battleOutcome.result, active: window.__battle.active }));
    check(!left.dom && left.outcome === want && !left.active, `${tag}: 「続ける」で探索へ戻り、結果を返す（画面の部品も消える）`);
    return r;
}

async function nextBattle(page, ally) {
    const mem0 = await page.evaluate(() => ({ ...window.__p3.renderer.info.memory }));
    await page.evaluate((a) => void window.__battleDev.run(a), ally);
    await waitBriefing(page);
    return mem0;
}

// ---------------------------------------------------------------- PC・スマホ

for (const kind of ['desktop', 'phone']) {
    const { page, ctx, phone } = await openPage(kind);
    const mem = { before: await page.evaluate(() => ({ ...window.__p3.renderer.info.memory })) };

    // ---- 田代：別働隊の回り込みで勝つ ----
    let tag = `${kind}-tashiro`;
    await basics(page, phone, tag);
    log(`[${tag}] 別働隊の回り込み（命令はすべて実際の操作）`);
    await page.evaluate(() => window.__battle.pause(true));
    // 源蔵隊を元の位置へ戻す・新八隊は待機
    await hitEl(page, phone, card(page, '源蔵隊'));
    await hitEl(page, phone, cmd(page, '防衛・待機'));
    let r = await ffUntil(page, "U('a_tashiro').arrived", 60);
    check(r.ok, `${tag}: 田代騎馬隊が林に着く（${r.t?.toFixed(1)} 秒）`);
    await shot(page, `${tag}-06-cavalry-arrived`);
    // 騎馬隊：林の中を北へ
    await hitEl(page, phone, card(page, '田代騎馬隊'));
    await frameOn(page, -110, -60, 260);
    await hitGround(page, phone, -100, -135);
    const cav = await unit(page, 'a_tashiro');
    check(cav.order.type === 'move' && Math.hypot(cav.order.x + 100, cav.order.z + 135) < 10, `${tag}: 騎馬隊に林の北への移動（${JSON.stringify(cav.order)}）`);
    r = await ffUntil(page, "U('a_tashiro').z < -60", 120);
    // 源蔵隊で先手を正面から押さえる
    await hitEl(page, phone, card(page, '源蔵隊'));
    await frameOn(page, 0, -20, 240);
    await hitEl(page, phone, cmd(page, '攻撃'));
    await hitUnit(page, phone, 'e_sente');
    check((await unit(page, 'a_genzo')).order.type === 'attack', `${tag}: 源蔵隊で先手を押さえる`);
    r = await ffUntil(page, "Math.hypot(U('a_tashiro').x + 100, U('a_tashiro').z + 135) < 8 && U('e_sente').engagedWith === 'a_genzo'", 150);
    check(r.ok, `${tag}: 騎馬隊が林の北の端に着き、先手が源蔵隊と組み合う（${r.t?.toFixed(1)} 秒）`);
    await frameOn(page, -40, -100, phone ? 200 : 230);
    await shot(page, `${tag}-07-before-charge`);
    // 騎馬隊で敵本陣の横を突く
    await hitEl(page, phone, card(page, '田代騎馬隊'));
    await hitUnit(page, phone, 'e_hq');
    check((await unit(page, 'a_tashiro')).order.type === 'attack', `${tag}: 騎馬隊で敵本陣を突く`);
    await page.evaluate(() => window.__battle.pause(false));
    await page.waitForTimeout(1200);
    r = await ffUntil(page, "U('e_hq').engagedWith || U('e_hq').status !== 'ready'", 60);
    await frameOn(page, -20, -110, phone ? 180 : 200);
    await shot(page, `${tag}-08-charge`);
    // 大森勢が新八隊に取り付いたら本陣で横を突く（取り付かなければそのまま）
    r = await ffUntil(page, "U('e_omori').engagedWith === 'a_shinpachi'", 200);
    if (r.ok && !r.result) {
        await page.evaluate(() => window.__battle.pause(true));
        await hitEl(page, phone, card(page, '若殿本陣'));
        await frameOn(page, 60, 60, 260);
        await hitUnit(page, phone, 'e_omori');
        check((await unit(page, 'a_hq')).order.type === 'attack', `${tag}: 本陣で大森勢の横を突く`);
        await page.evaluate(() => window.__battle.pause(false));
    }
    r = await ffUntil(page, 'false', 480);
    await finish(page, phone, tag, 'victory');

    // ---- 大森：本陣だけで突っ込んで負ける ----
    tag = `${kind}-omori`;
    mem.afterFirst = await nextBattle(page, 'omori');
    await shot(page, `${tag}-01-briefing`);
    await hitEl(page, phone, page.locator('.b-primary', { hasText: '合戦を始める' }));
    await hitEl(page, phone, page.locator('.b-pause'));
    check((await ui(page)).paused, `${tag}: 指揮ボタンで一時停止`);
    await frameOn(page, 0, 20, 300);
    await hitUnit(page, phone, 'a_hq');
    check((await ui(page)).selectedId === 'a_hq', `${tag}: 本陣を選ぶ`);
    await hitUnit(page, phone, 'e_sente');
    check((await unit(page, 'a_hq')).order.type === 'attack', `${tag}: 本陣だけで先手へ`);
    await shot(page, `${tag}-02-hq-alone`);
    await hitEl(page, phone, page.locator('.b-pause'));
    r = await ffUntil(page, "U('a_hq').engagedWith", 120);
    await page.waitForTimeout(800);
    await frameOn(page, 0, -40, 200);
    await shot(page, `${tag}-03-melee`);
    r = await ffUntil(page, 'false', 480);
    const lost = await finish(page, phone, tag, 'defeat');
    const hq = lost.units.find((u) => u.id === 'a_hq');
    check(lost.reason === 'ally_hq_routed' && hq.endStrength > 0, `${tag}: 本陣の敗走で敗北（本陣の兵 ${Math.round(hq.endStrength)} が残る＝討死ではない）`);

    // ---- 独力：全軍撤退 ----
    tag = `${kind}-alone`;
    mem.afterSecond = await nextBattle(page, 'alone');
    await shot(page, `${tag}-01-briefing`);
    await hitEl(page, phone, page.locator('.b-primary', { hasText: '合戦を始める' }));
    await ff(page, 20);
    await page.waitForTimeout(600);
    await hitEl(page, phone, page.locator('.b-allret'));
    check((await ui(page)).modal === 'confirm' && (await ui(page)).paused, `${tag}: 「全軍撤退」で確かめが出る（止まる）`);
    await shot(page, `${tag}-02-confirm`);
    await hitEl(page, phone, page.locator('.b-confirm .b-btn', { hasText: 'やめる' }));
    check((await ui(page)).modal === null && (await page.evaluate(() => window.__battle.state.allRetreatAt)) === null, `${tag}: 「やめる」で撤退しない`);
    await hitEl(page, phone, page.locator('.b-allret'));
    await hitEl(page, phone, page.locator('.b-confirm .b-btn', { hasText: '撤退する' }));
    check((await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null, `${tag}: 「撤退する」で全軍撤退`);
    await page.waitForTimeout(1500);
    await shot(page, `${tag}-03-retreating`);
    r = await ffUntil(page, 'false', 60);
    await finish(page, phone, tag, 'retreat');
    mem.after = await page.evaluate(() => ({ ...window.__p3.renderer.info.memory }));
    log(`[${kind}] 描画の資源（探索の前・1 回目の後・2 回目の後・3 回目の後）`, JSON.stringify(mem));
    check(mem.after.geometries <= mem.afterFirst.geometries + 2 && mem.after.textures <= mem.afterFirst.textures + 2, `${kind}: 合戦を 3 回しても描画の資源が増え続けない`);
    await ctx.close();
}

await b.close();
log(failures.length ? `\n失敗 ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて通りました');
process.exit(failures.length ? 1 : 0);
