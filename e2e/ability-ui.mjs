/**
 * 特殊能力の発動 UI（docs/troops-abilities-design.md §4・依頼本文【5】）を、実際のブラウザで本物のクリック・タップで確かめて撮る。
 *   BASE3D=http://localhost:8183 node e2e/ability-ui.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/ability-ui）
 *   PARTS=desktop,phone で一部だけ（既定はどちらも）
 * - 大平原（?dev=field&id=plains。徳川の七隊）を PC（1280×720、マウス・キー）とスマホ横（844×390、タッチ）で開く。
 * - 開始して、指揮（一時停止）のボタンで止める。止めたまま：
 *   - 点滅する名札が徳川の 5 武将（家康・忠勝・榊原・酒井・石川）だけ。弓隊・騎馬隊・敵は点滅しない。止めていても明るさが変わる（表示の時計）。
 *   - 騎馬隊を札で選んでおき、家康の名札を 1 回押す → 立て直しの号令。騎馬隊の選択・全部隊の位置と命令は変わらない（タップが地面の移動・部隊の選択に漏れない）。
 *     発動の知らせ（能力名・武将・対象）が出る。家康の名札の点滅が止まり、残り秒数が出る。
 *   - 忠勝の名札を素早く 4 回押す（連打。CDP で返事を待たずに続けて送る）→ 退路の守護は 1 回だけ。ほかの部隊の命令・選択は変わらない。
 *   - スマホは始めに 1 本指で地図を少し上へずらす（全体表示では南の石川隊の名札が下の案内の帯に隠れるため）。
 *   - 押すのは名札の能力の印（◆号令など）。酒井は、何も選んでいない時に、印の見た目の少し外（PC は上へ +6 px、スマホは +10 px。当たりは 36／48 px 四方）を押して使う。
 *     榊原は印の真ん中。騎馬隊を選んでいる時は、印の見た目の少し外は地面の移動になり、能力は使わない（Version 13 候補の確認で直した：
 *     命令を出せる味方を選んでいる時は、当たりを広げない）。
 *   - 点滅している武将でも、部隊の体を押せば今までどおり選択（能力は使わない）。
 *   - 石川（対象の要る能力）：名札 → 対象選び（持ち主・選べる・選べないの印、案内の文）→ 地面でやめる → 名札 → 名札をもう一度でやめる →
 *     名札 → Esc（スマホは「やめる」）でやめる → 名札 → 敵を押す（理由だけ・回数は減らない・対象選びは続く）→ 騎馬隊を押して使う。
 *   - 5 武将を使った後は、点滅する名札が無い。止めている間、合戦の時刻は進まない。
 * - 再開して（開発用の早回し ×10）榊原の先駆けの号が切れると「効果が切れた」の知らせが出て、名札の印が消える。
 * 状態は window.__battle から読むだけ（開始・止める・選ぶ・名札・対象・地面・やめるは、すべて本物のクリック・タップ・キー）。
 * 待つ時間だけは開発用の早回し（setTimeScale）を使う。コンテナはソフトウェア描画なので、動きの滑らかさ・実機の性能は確かめていない。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8183';
const OUT = process.argv[2] || 'e2e-out/ability-ui';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone').split(',');
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
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
        if (m.type() === 'error') {
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?dev=field&id=plains`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
    log(`[${kind}] 合戦の画面まで ${Date.now() - t0} ms`);
    return { ctx, page, phone, kind };
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const ab = (page, id) =>
    page.evaluate((id) => {
        const r = window.__battle.state.abilities[id];
        return r && { usedAt: r.usedAt, until: r.until, targetId: r.targetId, ended: r.ended, t: window.__battle.state.t };
    }, id);
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const labelText = (page, id) => page.evaluate((id) => document.querySelector(`.b-label[data-id="${id}"]`)?.textContent ?? '', id);
const readyLabels = (page) => page.evaluate(() => [...document.querySelectorAll('.b-label[data-ab="ready"]')].map((e) => e.dataset.id).sort());
const snapshot = (page) =>
    page.evaluate(() => {
        const s = window.__battle.state;
        return { t: s.t, units: s.units.map((u) => ({ id: u.id, x: +u.x.toFixed(3), z: +u.z.toFixed(3), order: JSON.stringify(u.order) })) };
    });
const abilityEvents = (page, id) => page.evaluate((id) => window.__battle.state.events.filter((e) => e.kind === 'ability' && e.unitId === id && /「/.test(e.text) && !/先駆けて/.test(e.text)).length, id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const groundXY = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const noteText = (page) => page.evaluate(() => { const n = document.querySelector('.b-abnote'); return n && !n.hidden ? n.textContent : ''; });
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });

async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(500);
}
async function pointAt(p, x, y, wait = 700) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
/**
 * 素早い連打：n 回の押す・離すを、1 回ずつの返事を待たずに続けて送る（CDP の Input.dispatchTouchEvent／dispatchMouseEvent。
 * Playwright の tap・click は 1 回ごとに描画の終わりを待つので、重いコンテナでは 1 回が 0.3 秒以上かかり、指の連打にならない）
 */
async function rapidTaps(p, x, y, n) {
    const cdp = await p.ctx.newCDPSession(p.page);
    const sent = [];
    for (let k = 0; k < n; k++) {
        const dx = k % 2 ? 2 : 0;
        if (p.phone) {
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + dx, y }] }));
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
        } else {
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + dx, y, button: 'left', buttons: 1, clickCount: 1 }));
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', buttons: 0, clickCount: 1 }));
        }
    }
    await Promise.all(sent);
    await cdp.detach();
}
/** 地図を指・マウスでなぞって動かす（本物の入力。CDP で押す・動かす・離す） */
async function dragMap(p, x0, y0, x1, y1) {
    if (!p.phone) {
        await p.page.mouse.move(x0, y0);
        await p.page.mouse.down();
        for (let k = 1; k <= 6; k++) await p.page.mouse.move(x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6);
        await p.page.mouse.up();
    } else {
        const cdp = await p.ctx.newCDPSession(p.page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 6, y: y0 + ((y1 - y0) * k) / 6 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    }
    await p.page.waitForTimeout(700);
}
/** 変わってはいけない部隊（except 以外）の位置・命令が同じか */
function sameExcept(a, c, except) {
    const bad = [];
    for (const u of a.units) {
        if (except.includes(u.id)) continue;
        const v = c.units.find((x) => x.id === u.id);
        if (!v || v.x !== u.x || v.z !== u.z || v.order !== u.order) bad.push(u.id);
    }
    return bad;
}

async function run(kind) {
    const p = await openPage(kind);
    const { page } = p;
    await shot(p, '00-briefing');
    await press(p, '.b-primary');
    await page.waitForTimeout(500);
    await press(p, '.b-pause');
    check((await ui(page)).paused === true, `[${kind}] 開始して「指揮（一時停止）」で止めた`);
    await page.waitForTimeout(900);
    if (p.phone) {
        // スマホ：全体表示では南の石川隊の名札が下の案内の帯に隠れるので、1 本指で地図を少し上へずらす（本物のなぞり）
        await dragMap(p, 430, 200, 430, 150);
        const cam = await page.evaluate(() => window.__battle.camera);
        log(`[${kind}] 地図をなぞって上へずらした（カメラ ${cam.tx.toFixed(0)}, ${cam.tz.toFixed(0)}・距離 ${cam.dist.toFixed(0)}）`);
    }
    const t0 = (await snapshot(page)).t;

    // ---- 点滅の条件・一時停止中の点滅 ----
    const ready = await readyLabels(page);
    check(JSON.stringify(ready) === JSON.stringify([...GENERALS].sort()), `[${kind}] 点滅する名札は徳川の 5 武将だけ`, ready.join(','));
    const others = await page.evaluate(() => [...document.querySelectorAll('.b-label[data-id]')].filter((e) => e.dataset.ab === 'ready' && !['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'].includes(e.dataset.id)).length);
    check(others === 0, `[${kind}] 弓隊・騎馬隊・敵の名札は点滅しない`);
    const samples = [];
    for (let i = 0; i < 10; i++) {
        samples.push((await label(page, 'a_ieyasu')).blink);
        await page.waitForTimeout(350);
    }
    const lo = Math.min(...samples);
    const hi = Math.max(...samples);
    check(lo >= 0.55 - 1e-6 && hi <= 1 + 1e-6 && hi - lo > 0.1, `[${kind}] 止めている間も点滅する（明るさ ${lo.toFixed(2)}〜${hi.toFixed(2)}、0.55〜1.0 の中）`, samples.map((x) => x.toFixed(2)).join(' '));
    check((await label(page, 'a_yumi')).blink === 1 && (await label(page, 'a_yumi')).ab === '', `[${kind}] 弓隊の名札は明るさが変わらない（印なし）`);
    await shot(p, '01-ready-paused');

    // ---- 点滅している武将でも、部隊の体（名札の印の外）を押せば選択（能力は使わない。確かめを出す） ----
    const sb = await screenOf(page, 'a_sakai');
    await pointAt(p, sb.x, sb.y);
    check((await ui(page)).selectedId === 'a_sakai' && (await ab(page, 'a_sakai')).usedAt === null, `[${kind}] 酒井隊の体を押す → 選択（能力は使わない）`);
    // 確かめの 3 秒の後に、選んでいる酒井隊をもう一度押す → Version 12 どおり選択が外れる（使わない）
    await page.waitForTimeout(3300);
    await pointAt(p, sb.x, sb.y);
    check((await ui(page)).selectedId === null && (await ab(page, 'a_sakai')).usedAt === null, `[${kind}] 3 秒の後に酒井隊をもう一度 → 選択が外れる（能力は使わない）`, `選択 ${(await ui(page)).selectedId}`);

    // ---- 酒井：何も選んでいない時に、見た目の名札の少し外（広げた当たり） ----
    {
        const before0 = await snapshot(page);
        const lSk = (await label(page, 'a_sakai')).badge;
        // 印の見た目の外で、ほかの名札に重ならない所（名札の重なりをほどくので、上には別の名札があることがある）：右・上・下の順に探す
        const off = p.phone ? 10 : 6;
        const cands = [
            { x: lSk.r + off, y: lSk.y, what: `右 ${off} px` },
            { x: lSk.x, y: lSk.t - off, what: `上 ${off} px` },
            { x: lSk.x, y: lSk.b + off, what: `下 ${off} px` },
        ];
        const covers = await page.evaluate(() => window.__battle.labelCovers());
        const pt = cands.find((c) => !covers.some((k) => c.x >= k.l && c.x <= k.r && c.y >= k.t && c.y <= k.b)) ?? cands[0];
        await pointAt(p, pt.x, pt.y);
        const after0 = await snapshot(page);
        check((await ab(page, 'a_sakai')).usedAt !== null, `[${kind}] 何も選んでいない時、酒井の名札の印の${pt.what}（見た目の外・ほかの名札の外・当たりの中）を押す → 両翼の采配`);
        check(sameExcept(before0, after0, []).length === 0 && (await ui(page)).selectedId === null, `[${kind}] 酒井：位置・命令・選択が変わらない`);
    }

    // ---- 騎馬隊を選んでおく（漏れれば地面の移動になる状態） ----
    await press(p, '.b-card[data-id="a_kiba"]');
    check((await ui(page)).selectedId === 'a_kiba', `[${kind}] 騎馬隊を札で選ぶ`);

    // ---- 家康：名札を 1 回 ----
    let before = await snapshot(page);
    const lIe = (await label(page, 'a_ieyasu')).badge;
    await pointAt(p, lIe.x, lIe.y);
    let after = await snapshot(page);
    const rally = await ab(page, 'a_ieyasu');
    check(rally.usedAt !== null, `[${kind}] 家康の名札を 1 回押す → 立て直しの号令`);
    const u1 = await ui(page);
    check(u1.selectedId === 'a_kiba' && u1.pending === 'none', `[${kind}] 選択（騎馬隊）はそのまま・命令の途中にならない`, `${u1.selectedId} ${u1.pending}`);
    const bad1 = sameExcept(before, after, []);
    check(bad1.length === 0, `[${kind}] 全部隊の位置と命令が変わらない（地面の移動に漏れない）`, bad1.join(','));
    const n1 = await noteText(page);
    check(n1.includes('立て直しの号令') && n1.includes('徳川家康') && n1.includes('対象') && n1.includes('110 m'), `[${kind}] 発動の知らせ：能力名・武将・対象`, n1);
    const lIe2 = await label(page, 'a_ieyasu');
    check(lIe2.ab === 'active' && (await labelText(page, 'a_ieyasu')).includes('残り 35 秒'), `[${kind}] 家康の名札の点滅が止まり、残り 35 秒`, await labelText(page, 'a_ieyasu'));
    await shot(p, '02-rally');

    // ---- 忠勝：連打 ----
    before = await snapshot(page);
    const lTd = (await label(page, 'a_tadakatsu')).badge;
    await rapidTaps(p, lTd.x, lTd.y, 4);
    await page.waitForTimeout(800);
    after = await snapshot(page);
    check((await ab(page, 'a_tadakatsu')).usedAt !== null && (await abilityEvents(page, 'a_tadakatsu')) === 1, `[${kind}] 忠勝の名札を 4 回素早く押す → 退路の守護は 1 回だけ`);
    const bad2 = sameExcept(before, after, ['a_tadakatsu']);
    check(bad2.length === 0, `[${kind}] 連打でも、ほかの部隊の位置と命令は変わらない`, bad2.join(','));
    const td = after.units.find((u) => u.id === 'a_tadakatsu');
    const td0 = before.units.find((u) => u.id === 'a_tadakatsu');
    check(td.x === td0.x && td.z === td0.z, `[${kind}] 忠勝隊の位置も変わらない（命令は守護の「防衛・待機」）`, td.order);
    check((await ui(page)).selectedId === 'a_kiba', `[${kind}] 連打でも選択は騎馬隊のまま`);

    // ---- 榊原：騎馬隊を選んでいる時、印の見た目の少し外 → 地面の移動（能力は使わない）。その後、印の真ん中 → 先駆けの号 ----
    const lSb = (await label(page, 'a_sakakibara')).badge;
    {
        const dy = (lSb.b - lSb.t) / 2 + (p.phone ? 10 : 6);
        await pointAt(p, lSb.x, lSb.y - dy);
        const kibaOrder = (await snapshot(page)).units.find((u) => u.id === 'a_kiba').order;
        check((await ab(page, 'a_sakakibara')).usedAt === null && JSON.parse(kibaOrder).type === 'move', `[${kind}] 騎馬隊を選んでいる時、榊原の印の ${dy.toFixed(0)} px 上を押す → 騎馬隊の移動（能力は使わない）`, kibaOrder);
        // 騎馬隊を元の待機に戻す（「防衛・待機」のボタン。止めているので位置は変わっていない）
        await press(p, '.b-cmd:has-text("防衛・待機")');
    }
    before = await snapshot(page);
    await pointAt(p, lSb.x, lSb.y);
    after = await snapshot(page);
    check((await ab(page, 'a_sakakibara')).usedAt !== null, `[${kind}] 榊原の名札を 1 回押す → 先駆けの号`);
    check(sameExcept(before, after, []).length === 0 && (await ui(page)).selectedId === 'a_kiba', `[${kind}] 榊原：位置・命令・選択が変わらない`);
    await shot(p, '03-four-used');

    // ---- 石川：2 段階（対象選び） ----
    const lIs = (await label(page, 'a_ishikawa')).badge;
    await pointAt(p, lIs.x, lIs.y);
    let u = await ui(page);
    check(u.pending === 'ability' && u.selectedId === 'a_ishikawa' && (await ab(page, 'a_ishikawa')).usedAt === null, `[${kind}] 石川の名札 → 対象選び（まだ使わない）`, `${u.pending} ${u.selectedId}`);
    const marks = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.b-label[data-id]')].map((e) => [e.dataset.id, e.dataset.ab ?? ''])));
    check(marks.a_ishikawa === 'choosing' && marks.a_kiba === 'target' && marks.e_sente === 'untargetable', `[${kind}] 名札の印：持ち主・選べる（騎馬隊）・選べない（敵）`, `${marks.a_ishikawa}/${marks.a_kiba}/${marks.e_sente}`);
    const h1 = await hintText(page);
    check(h1.includes('対象の味方を押してください'), `[${kind}] 案内：対象の味方を押す`, h1);
    await shot(p, '04-ishikawa-choose');
    // 地面でやめる
    before = await snapshot(page);
    const g = await groundXY(page, -150, 10);
    await pointAt(p, g.x, g.y);
    after = await snapshot(page);
    u = await ui(page);
    check(u.pending === 'none' && (await ab(page, 'a_ishikawa')).usedAt === null && sameExcept(before, after, []).length === 0, `[${kind}] 地面を押す → 対象選びをやめる（回数は減らない・移動にならない）`, await hintText(page));
    // 名札をもう一度でやめる（守りの 0.5 秒より後）。対象選びに入ると、持ち主・対象が画面の部品に隠れていれば地図が動くので、印の所は毎回読み直す
    const isBadge = async () => (await label(page, 'a_ishikawa')).badge;
    let bIs = await isBadge();
    await pointAt(p, bIs.x, bIs.y, 900);
    check((await ui(page)).pending === 'ability', `[${kind}] 名札 → 対象選び`);
    bIs = await isBadge();
    await pointAt(p, bIs.x, bIs.y, 900);
    check((await ui(page)).pending === 'none' && (await ab(page, 'a_ishikawa')).usedAt === null, `[${kind}] 同じ名札をもう一度 → やめる（回数は減らない）`);
    // Esc（スマホは「やめる」）でやめる
    bIs = await isBadge();
    await pointAt(p, bIs.x, bIs.y, 900);
    if (p.phone) await press(p, '.b-hint-x');
    else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    }
    check((await ui(page)).pending === 'none' && (await ab(page, 'a_ishikawa')).usedAt === null, `[${kind}] ${p.phone ? '「やめる」' : 'Esc'} → やめる（回数は減らない）`);
    // 敵を押す → 理由だけ
    bIs = await isBadge();
    await pointAt(p, bIs.x, bIs.y, 900);
    before = await snapshot(page);
    const es = await screenOf(page, 'e_sente');
    await pointAt(p, es.x, es.y);
    after = await snapshot(page);
    u = await ui(page);
    check(
        (await hintText(page)).includes('敵の部隊は対象にできない') && u.pending === 'ability' && (await ab(page, 'a_ishikawa')).usedAt === null && sameExcept(before, after, []).length === 0,
        `[${kind}] 敵を押す → 理由（回数は減らず、対象選びが続く・攻撃にならない）`,
        await hintText(page),
    );
    await shot(p, '05-ishikawa-invalid');
    // 騎馬隊を押して使う
    before = await snapshot(page);
    const kb = await screenOf(page, 'a_kiba');
    await pointAt(p, kb.x, kb.y);
    after = await snapshot(page);
    const res = await ab(page, 'a_ishikawa');
    u = await ui(page);
    check(res.usedAt !== null && res.targetId === 'a_kiba' && u.pending === 'none', `[${kind}] 騎馬隊を押す → 後詰めの差配（対象 騎馬隊）`, `${res.targetId} ${u.pending}`);
    const n2 = await noteText(page);
    check(n2.includes('後詰めの差配') && n2.includes('石川数正') && n2.includes('徳川騎馬隊'), `[${kind}] 発動の知らせ：能力名・武将・対象（騎馬隊）`, n2);
    check(sameExcept(before, after, ['a_ishikawa']).length === 0, `[${kind}] 対象を押したタップは騎馬隊の移動・命令に漏れない`);
    await page.waitForTimeout(300);
    await shot(p, '06-ishikawa-used');
    // 5 武将を使った後
    check((await readyLabels(page)).length === 0, `[${kind}] 使った後は、点滅する名札が無い`);
    check((await snapshot(page)).t === t0, `[${kind}] 止めている間は合戦の時刻が進まない（${t0.toFixed(1)} 秒のまま）`);
    const panelOk = await page.evaluate(() => {
        const t = document.querySelector('.b-abil')?.textContent ?? '';
        return ['対象', '範囲', '効果', '代償', '残り'].every((k) => t.includes(k)) ? '' : t.slice(0, 120);
    });
    check(panelOk === '', `[${kind}] 能力の欄：対象・範囲・効果・代償・残り`, panelOk);

    // ---- 再開して、効果が切れる ----
    await press(p, '.b-pause');
    await page.evaluate(() => window.__battle.setTimeScale(10));
    const endSeen = await page
        .waitForFunction(
            () => {
                const n = document.querySelector('.b-abnote');
                return n && !n.hidden && n.dataset.kind === 'end' && n.textContent.includes('先駆けの号') ? n.textContent : false;
            },
            null,
            { timeout: 120000, polling: 100 },
        )
        .then((h) => h.jsonValue())
        .catch(() => '');
    check(String(endSeen).includes('効果が切れた'), `[${kind}] 先駆けの号が切れる → 「効果が切れた」の知らせ`, String(endSeen));
    await page.evaluate(() => window.__battle.setTimeScale(1));
    await press(p, '.b-pause');
    await page.waitForTimeout(600);
    check((await label(page, 'a_sakakibara')).ab === '', `[${kind}] 切れた後は榊原の名札に印が無い`);
    await shot(p, '07-ended');
    await p.ctx.close();
}

for (const k of ['desktop', 'phone']) if (PARTS.includes(k)) await run(k);
await b.close();
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
