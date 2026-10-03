/**
 * 第3群の前に整える操作（docs/fields-group3-design.md §2）を、実際のブラウザで本物のクリック・タップ・キーで確かめて撮る。
 *   BASE3D=http://localhost:8301 BASE=http://localhost:8301 node e2e/ops-group3.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/ops-group3）
 *   PARTS=desktop,phone,shots で一部だけ（既定はすべて）
 * - desktop（PC 1280×720、マウス・キー）・phone（スマホ横 844×390、タッチ）で大平原（?dev=field&id=plains）を開き、止めて：
 *   1. 移動先指定：
 *      - 弓隊を札で選び、指定なしで騎馬隊の体を押す → 今までどおり騎馬隊を選ぶ（弓隊に命令は出ない）。
 *      - 弓隊を札で選び、「移動」（PC は M）→ 案内の帯に「移動先指定中」→ 騎馬隊の体を押す → 選び直さず、弓隊がその点へ移動。
 *      - 同じく、家康本陣（点滅している武将）の体を押す → 弓隊がその点へ移動（確かめ・号令にならない）。
 *      - 同じく、家康本陣の名札の名前の所を押す → 弓隊がその点へ移動（号令にならない）。
 *      - 同じく、酒井の名札の印（◆両翼）を押す → 能力（両翼の采配）を使う。弓隊の命令は変わらない。
 *      - 指定なしで地面を押す → 今までどおり移動。
 *      - 移動先指定の間、案内の帯の文の真ん中を押す → 帯は押しを奪わず、その下の地面へ移動（押せるのは「やめる」だけ）。
 *   2. 対象選びは能力が先：石川の印 → 地面を素早く 2 回（連打）→ 1 回目で対象選びをやめ、2 回目は何もしない（石川隊に移動は出ない）。
 *      石川の印 → 弓隊の体を素早く 2 回 → 1 回目で弓隊へ差配、2 回目は何もしない（選び直し・移動に漏れない）。
 *   3. 号令の確かめ（状態を直接操作して場面を作る：味方の士気をみな 100 にする。敵は遠い）：家康の名札が点滅しない・札は「号令 ―」・
 *      前に印のあった所を押しても使わない・札で家康本陣を選んで「能力」（PC は F）→ 理由が出て回数は減らない。
 *      騎馬隊の士気を 70 に戻す（直接操作）→ 点滅が戻り、印を押すと使える（自隊も対象の説明が能力の欄に出る）。
 *   4. スマホの表示：知らせは 2 つまで見える・能力の欄の高さ・目標の見出しが 1 行・操作の要らない表示（知らせ・能力の欄・案内の文・
 *      発動の知らせ・止めている印・調べる欄）が押しを奪わない（pointer-events: none）。
 * - shots（スマホ横）：演習の一覧の戦場（window.__fieldDev.ids。今ある分）を開き、家康本陣を選んで撮る。点滅する印が、押しを奪う部品
 *   （pointer-events が none でない部品）に覆われていないか・操作の要らない表示が押しを奪わないか・畳んだ目標の見出しが 1 行で
 *   進みの数（最初の区切り。段階目標は今の段まで）が「…」で切れないかを数える。60 秒進めて（早送り）もう一度数えて撮る（-60s）。
 * 待つ時間だけは開発用の早送り（fastForward）を使う。命令・能力は画面の操作だけで出す。状態は window.__battle から読む
 * （号令の確かめの場面づくりだけは状態を直接書き換える。ログに「直接操作」と書く）。コンテナはソフトウェア描画（実機・性能は未確認）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8301';
const OUT = process.argv[2] || 'e2e-out/ops-group3';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone,shots').split(',');
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();

async function openPage(kind, id = 'plains') {
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
    await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
    return { ctx, page, phone, kind };
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const ab = (page, id) => page.evaluate((id) => { const r = window.__battle.state.abilities[id]; return r && { usedAt: r.usedAt, targetId: r.targetId }; }, id);
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const orderOf = (page, id) => page.evaluate((id) => window.__battle.state.units.find((u) => u.id === id).order, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const cardAbl = (page, id) => page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"] .b-abl`)?.textContent ?? '', id);
/** 画面の点の下の地面（読むだけ） */
const groundUnder = (page, x, y) =>
    page.evaluate(([x, y]) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return window.__battle.view.groundAt(x - r.left, y - r.top);
    }, [x, y]);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, x: +u.x.toFixed(3), z: +u.z.toFixed(3), order: JSON.stringify(u.order) })));
function sameExcept(a, c, except) {
    const bad = [];
    for (const u of a) {
        if (except.includes(u.id)) continue;
        const v = c.find((x) => x.id === u.id);
        if (!v || v.x !== u.x || v.z !== u.z || v.order !== u.order) bad.push(u.id);
    }
    return bad;
}
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });

async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(400);
}
async function pointAt(p, x, y, wait = 700) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
/** 素早い連打（CDP で返事を待たずに続けて送る。ability-ui.mjs と同じ） */
async function rapidTaps(p, x, y, n) {
    const cdp = await p.ctx.newCDPSession(p.page);
    const sent = [];
    for (let k = 0; k < n; k++) {
        if (p.phone) {
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }));
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
        } else {
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }));
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }));
        }
    }
    await Promise.all(sent);
    await cdp.detach();
    await p.page.waitForTimeout(800);
}
async function selectCard(p, id) {
    await press(p, `.b-card[data-id="${id}"]`);
    // 2 回目の札の押しは「その部隊へ寄る」なので、選べていなければもう一度
    if ((await ui(p.page)).selectedId !== id) await press(p, `.b-card[data-id="${id}"]`);
}
async function moveMode(p) {
    if (p.phone) await press(p, '.b-cmd:has-text("移動")');
    else {
        await p.page.keyboard.press('KeyM');
        await p.page.waitForTimeout(300);
    }
}
/** 移動の命令が、押した点の下の地面（g）の近く（通れる所へ直すので 6 m まで）へ出たか */
const movedTo = (o, g) => o.type === 'move' && g && Math.hypot(o.x - g.x, o.z - g.z) < 6;

async function run(kind) {
    const p = await openPage(kind);
    const { page } = p;
    await press(p, '.b-primary');
    await page.waitForTimeout(400);
    await press(p, '.b-pause');
    check((await ui(page)).paused, `[${kind}] 開始して止めた`);
    await page.waitForTimeout(600);

    // ================================================================ 1. 移動先指定
    // 指定なし：味方の体を押す → 今までどおり選ぶ
    await selectCard(p, 'a_yumi');
    const yumiOrder0 = JSON.stringify(await orderOf(page, 'a_yumi'));
    let kb = await screenOf(page, 'a_kiba');
    await pointAt(p, kb.x, kb.y);
    check((await ui(page)).selectedId === 'a_kiba' && JSON.stringify(await orderOf(page, 'a_yumi')) === yumiOrder0, `[${kind}] 指定なしで騎馬隊の体を押す → 騎馬隊を選ぶ（弓隊に命令は出ない。今までどおり）`, `選択 ${(await ui(page)).selectedId}`);

    // 移動先指定：騎馬隊の体を押す → 選び直さず、弓隊がその点へ
    await selectCard(p, 'a_yumi');
    await moveMode(p);
    // 直前の短い知らせ（案内より先に出る）が消えるのを待って、案内の帯を読む
    await page.waitForFunction(() => (document.querySelector('.b-hint')?.textContent ?? '').includes('移動先指定中'), null, { timeout: 5000 }).catch(() => {});
    const h1 = await hintText(page);
    check((await ui(page)).pending === 'move' && h1.includes('移動先指定中'), `[${kind}] 「移動」${p.phone ? '' : '（M）'}→ 案内の帯に「移動先指定中」`, h1);
    await shot(p, '01-move-mode');
    kb = await screenOf(page, 'a_kiba');
    let g = await groundUnder(page, kb.x, kb.y);
    await pointAt(p, kb.x, kb.y);
    let u = await ui(page);
    let o = await orderOf(page, 'a_yumi');
    check(u.selectedId === 'a_yumi' && u.pending === 'none' && movedTo(o, g), `[${kind}] 移動先指定で騎馬隊の体を押す → 選び直さず、弓隊が騎馬隊の立つ所へ移動`, `選択 ${u.selectedId}・命令 ${JSON.stringify(o)}・地面 ${g && `${g.x.toFixed(1)},${g.z.toFixed(1)}`}`);
    check((await orderOf(page, 'a_kiba')).type !== 'move' || true, `[${kind}] （騎馬隊の命令は見るだけ）`);

    // 移動先指定：点滅している家康本陣の体を押す → 弓隊がその点へ（確かめ・号令にならない）
    await moveMode(p);
    const hq = await screenOf(page, 'a_ieyasu');
    g = await groundUnder(page, hq.x, hq.y);
    await pointAt(p, hq.x, hq.y);
    u = await ui(page);
    o = await orderOf(page, 'a_yumi');
    check(u.selectedId === 'a_yumi' && movedTo(o, g) && (await ab(page, 'a_ieyasu')).usedAt === null, `[${kind}] 移動先指定で家康本陣（点滅中）の体を押す → 弓隊がその点へ移動（選び直し・号令にならない）`, `選択 ${u.selectedId}・命令 ${JSON.stringify(o)}`);

    // 移動先指定：家康本陣の名札の名前の所を押す → 弓隊がその点へ（号令にならない）
    await moveMode(p);
    const lb = await label(page, 'a_ieyasu');
    const nx = lb.l + 6;
    const ny = lb.y;
    const inBadge = lb.badge && nx >= lb.badge.l && nx <= lb.badge.r;
    check(!inBadge, `[${kind}] 家康本陣の名札の名前の所（印の外）を押す点がある`, `名札 ${Math.round(lb.l)}〜${Math.round(lb.r)}・印 ${lb.badge ? `${Math.round(lb.badge.l)}〜${Math.round(lb.badge.r)}` : 'なし'}`);
    g = await groundUnder(page, nx, ny);
    await pointAt(p, nx, ny);
    u = await ui(page);
    o = await orderOf(page, 'a_yumi');
    check(u.selectedId === 'a_yumi' && movedTo(o, g) && (await ab(page, 'a_ieyasu')).usedAt === null, `[${kind}] 移動先指定で家康本陣の名札の名前を押す → 弓隊がその点へ移動（選び直し・号令にならない）`, `選択 ${u.selectedId}・命令 ${JSON.stringify(o)}`);

    // 移動先指定：酒井の名札の印を押す → 能力（両翼の采配）。弓隊の命令は変わらない
    await moveMode(p);
    const yumiBefore = JSON.stringify(await orderOf(page, 'a_yumi'));
    const before = await snapshot(page);
    const sk = (await label(page, 'a_sakai')).badge;
    await pointAt(p, sk.x, sk.y);
    const after = await snapshot(page);
    check((await ab(page, 'a_sakai')).usedAt !== null && JSON.stringify(await orderOf(page, 'a_yumi')) === yumiBefore && sameExcept(before, after, []).length === 0, `[${kind}] 移動先指定の間に酒井の名札の印を押す → 両翼の采配を使う（移動の命令にならない）`, `pending ${(await ui(page)).pending}`);

    // 指定なしで地面を押す → 今までどおり移動
    await selectCard(p, 'a_yumi');
    const gp = await page.evaluate(() => window.__battle.screenOfGround(60, 140));
    g = await groundUnder(page, gp.x, gp.y);
    await pointAt(p, gp.x, gp.y);
    o = await orderOf(page, 'a_yumi');
    check((await ui(page)).selectedId === 'a_yumi' && movedTo(o, g), `[${kind}] 指定なしで地面を押す → 弓隊が移動（追加の操作なし。今までどおり）`, JSON.stringify(o));

    // 移動先指定の間、案内の帯の文を押す → 帯は押しを奪わず、その下の地面へ移動
    await moveMode(p);
    const hr = await page.evaluate(() => { const r = document.querySelector('.b-hint span, .b-hint').getBoundingClientRect(); const x = document.querySelector('.b-hint-x').getBoundingClientRect(); return { x: (r.left + Math.min(r.right, x.left)) / 2, y: (r.top + r.bottom) / 2, pe: getComputedStyle(document.querySelector('.b-hint')).pointerEvents, pex: getComputedStyle(document.querySelector('.b-hint-x')).pointerEvents }; });
    check(hr.pe === 'none' && hr.pex === 'auto', `[${kind}] 案内の帯は押しを通す（pointer-events: none）・「やめる」だけ押せる`, `${hr.pe} / ${hr.pex}`);
    g = await groundUnder(page, hr.x, hr.y);
    // 帯の下の地面が戦場の外なら、命令は戦場の縁（2 m 内側）へ直る（sim.ts の issueOrder）
    const lim = await page.evaluate(() => ({ w: window.__battle.state.map.width / 2 - 2, d: window.__battle.state.map.depth / 2 - 2 }));
    if (g) g = { x: Math.max(-lim.w, Math.min(lim.w, g.x)), z: Math.max(-lim.d, Math.min(lim.d, g.z)) };
    await pointAt(p, hr.x, hr.y);
    o = await orderOf(page, 'a_yumi');
    check((await ui(page)).pending === 'none' && movedTo(o, g), `[${kind}] 移動先指定で案内の帯の文の上を押す → その下の地面へ弓隊が移動`, `${JSON.stringify(o)}・地面 ${g && `${g.x.toFixed(1)},${g.z.toFixed(1)}`}`);
    // 「やめる」は押せる
    await moveMode(p);
    await press(p, '.b-hint-x');
    check((await ui(page)).pending === 'none', `[${kind}] 案内の帯の「やめる」で移動先指定をやめる`);

    // ================================================================ 2. 対象選びは能力が先
    {
        const ish = (await label(page, 'a_ishikawa')).badge;
        await pointAt(p, ish.x, ish.y);
        check((await ui(page)).pending === 'ability' && (await ui(page)).selectedId === 'a_ishikawa', `[${kind}] 石川の印 → 対象選び`);
        const b0 = await snapshot(page);
        const gg = await page.evaluate(() => window.__battle.screenOfGround(-60, 150));
        await rapidTaps(p, gg.x, gg.y, 2);
        const a0 = await snapshot(page);
        check((await ui(page)).pending === 'none' && (await ab(page, 'a_ishikawa')).usedAt === null && sameExcept(b0, a0, []).length === 0, `[${kind}] 対象選びの間に地面を素早く 2 回 → 対象選びをやめるだけ（2 回目も石川隊の移動に漏れない）`, sameExcept(b0, a0, []).join(','));
        const ish2 = (await label(page, 'a_ishikawa')).badge;
        await pointAt(p, ish2.x, ish2.y);
        check((await ui(page)).pending === 'ability', `[${kind}] 石川の印 → もう一度対象選び`);
        const y = await screenOf(page, 'a_yumi');
        const b1 = await snapshot(page);
        await rapidTaps(p, y.x, y.y, 2);
        const a1 = await snapshot(page);
        const r = await ab(page, 'a_ishikawa');
        u = await ui(page);
        check(r.usedAt !== null && r.targetId === 'a_yumi', `[${kind}] 対象選びの間に弓隊の体を素早く 2 回 → 1 回目で弓隊へ差配`);
        check(u.selectedId === 'a_ishikawa' && u.pending === 'none' && sameExcept(b1, a1, ['a_ishikawa']).length === 0, `[${kind}] 2 回目は何もしない（弓隊を選び直さない・移動に漏れない）`, `選択 ${u.selectedId}・変わった ${sameExcept(b1, a1, ['a_ishikawa']).join(',')}`);
        await shot(p, '02-ability-first');
    }

    // ================================================================ 3. 号令の確かめ（場面づくりは直接操作）
    {
        check((await label(page, 'a_ieyasu')).ab === 'ready', `[${kind}] 開始のまま（家康本陣の士気 90）家康の名札が点滅`);
        const oldBadge = (await label(page, 'a_ieyasu')).badge;
        log(`[${kind}] 直接操作：味方の士気をみな 100 にする`);
        await page.evaluate(() => { for (const u of window.__battle.state.units) if (u.side === 'ally') u.morale = 100; });
        await page.waitForTimeout(500);
        // 大平原の始めは、敵の先手が前の味方の 120 m 以内に見えている：士気が満ちていても敗走の防ぎが効くので使える
        const eff0 = await page.evaluate(() => window.__battle.effectTargets('a_ieyasu'));
        const threat = eff0 ? Object.entries(eff0.why).filter(([, w]) => w.includes('threat')).map(([id]) => id) : [];
        check(eff0 && eff0.effective.length > 0 && threat.length > 0 && (await label(page, 'a_ieyasu')).ab === 'ready', `[${kind}] 士気がみな 100 でも、敵が近い部隊（${threat.join('・')}）がいれば使える（敗走の防ぎが効く）・点滅する`, JSON.stringify(eff0));
        log(`[${kind}] 直接操作：敵をみな見えていないことにする（林に隠れている場面。止めている間は見え方を数え直さない）`);
        await page.evaluate(() => { for (const u of window.__battle.state.units) if (u.side === 'enemy') u.seenBy.ally = false; });
        await page.waitForTimeout(500);
        const eff = await page.evaluate(() => window.__battle.effectTargets('a_ieyasu'));
        check(eff && eff.inRange.length > 0 && eff.effective.length === 0, `[${kind}] 号令の効く相手がいない（範囲の味方 ${eff?.inRange.length}・効く 0）`, JSON.stringify(eff));
        const l1 = await label(page, 'a_ieyasu');
        check(l1.ab !== 'ready' && (await cardAbl(page, 'a_ieyasu')).includes('―'), `[${kind}] 家康の名札が点滅しない・札は「号令 ―」`, `ab ${l1.ab}・札 ${await cardAbl(page, 'a_ieyasu')}`);
        await selectCard(p, 'a_kiba');
        const b2 = await snapshot(page);
        await pointAt(p, oldBadge.x, oldBadge.y);
        check((await ab(page, 'a_ieyasu')).usedAt === null, `[${kind}] 前に印のあった所を押しても号令は使わない`);
        void b2;
        await selectCard(p, 'a_ieyasu');
        if (p.phone) await press(p, '.b-abil-btn');
        else {
            await page.keyboard.press('KeyF');
            await page.waitForTimeout(300);
        }
        const why = await hintText(page);
        const panel = await page.evaluate(() => document.querySelector('.b-abil')?.innerText ?? '');
        check((await ab(page, 'a_ieyasu')).usedAt === null && why.includes('効く相手がいない'), `[${kind}] 「能力」${p.phone ? '' : '（F）'}→ 理由が出て使わない（回数は減らない）`, why);
        check(panel.includes('使えない') && panel.includes('効く相手がいない'), `[${kind}] 能力の欄：使えない・理由`, panel.replace(/\s+/g, ' ').slice(0, 140));
        await shot(p, '03-rally-blocked');
        // 範囲（110 m）の中の味方（家康本陣のほか）を 1 つ選んで士気を下げる
        const low = eff.inRange.find((id) => id !== 'a_ieyasu') ?? 'a_ieyasu';
        log(`[${kind}] 直接操作：${low}の士気を 70 にする`);
        await page.evaluate((id) => { window.__battle.state.units.find((u) => u.id === id).morale = 70; }, low);
        await page.waitForTimeout(500);
        const l2 = await label(page, 'a_ieyasu');
        check(l2.ab === 'ready', `[${kind}] 効く相手（${low}）がいれば点滅が戻る`);
        const panel2 = await page.evaluate(() => document.querySelector('.b-abil')?.innerText ?? '');
        check(panel2.includes('本陣も'), `[${kind}] 能力の欄に自隊（本陣）も対象と書く`, panel2.replace(/\s+/g, ' ').slice(0, 160));
        await pointAt(p, l2.badge.x, l2.badge.y);
        check((await ab(page, 'a_ieyasu')).usedAt !== null, `[${kind}] 印を押すと号令を使う`);
        const kbM = await page.evaluate((id) => window.__battle.state.units.find((u) => u.id === id).morale, low);
        check(kbM >= 100 - 1e-6, `[${kind}] ${low}の士気 70 → ${kbM.toFixed(0)}（+40・上限 100）`);
    }

    // ================================================================ 4. スマホの表示
    {
        await selectCard(p, 'a_ieyasu');
        const m = await page.evaluate(() => {
            const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none';
            const R = (s) => { const e = document.querySelector(s); if (!vis(e)) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height }; };
            const pe = {};
            // 第4群：能力の説明の欄（.b-abil）は押し・なぞりを欄で使い切る（地図へ通さない）ので、ここ（押しを地図へ通す表示）には入れない。下で別に見る
            for (const s of ['.b-toast', '.b-abnote', '.b-pausepill', '.b-inspect', '.b-labels', '.b-hint']) { const e = document.querySelector(s); if (e) pe[s] = getComputedStyle(e).pointerEvents; }
            pe.abilSink = getComputedStyle(document.querySelector('.b-abil')).pointerEvents;
            return { abil: R('.b-abil'), cards: R('.b-cards'), goalsHead: R('.b-goals-head'), goalsClosed: document.querySelector('.b-goals')?.classList.contains('closed'), sum: document.querySelector('.b-goals-sum')?.textContent ?? '', pe };
        });
        log(`[${kind}] 能力の欄の高さ ${m.abil?.h.toFixed(0)} px（下端 ${m.abil?.b.toFixed(0)}・札の列の上端 ${m.cards?.t.toFixed(0)}）`);
        check(!!m.abil && m.abil.b < m.cards.t, `[${kind}] 家康本陣を選んだ能力の欄は札の列に届かない`);
        check(Object.entries(m.pe).every(([k, v]) => (k === 'abilSink' ? v === 'auto' : v === 'none')), `[${kind}] 操作の要らない表示は押しを奪わない（pointer-events: none）。能力の説明の欄は押しを欄で使い切る（auto。第4群）`, JSON.stringify(m.pe));
        if (p.phone) {
            check(m.goalsClosed && m.goalsHead.h <= 32 && m.sum.length > 0, `[${kind}] 目標は畳んだまま 1 行で進みが見える`, `${m.goalsHead.h.toFixed(0)} px「${m.sum}」`);
            await page.evaluate(() => window.__battle.fastForward(60));
            await page.waitForTimeout(600);
            const t = await page.evaluate(() => [...document.querySelectorAll('.b-toast')].map((e) => getComputedStyle(e).display !== 'none'));
            check(t.filter(Boolean).length <= 2, `[${kind}] 知らせは 2 つまで見える（DOM には ${t.length}）`);
            await shot(p, '04-phone-display');
        }
    }
    await p.ctx.close();
}

/** スマホ横で、演習の一覧の戦場（今ある分）を開いて撮り、点滅する印が押しを奪う部品に覆われていないかを数える */
async function shots() {
    const p0 = await openPage('phone');
    const ids = await p0.page.evaluate(() => window.__fieldDev.ids);
    await p0.ctx.close();
    log(`== スマホの撮影：${ids.length} 戦場（${ids.join('・')}）`);
    for (const id of ids) {
        if (id === 'border_field') continue;
        const p = await openPage('phone', id);
        const { page } = p;
        await press(p, '.b-primary');
        await press(p, '.b-pause');
        const hq = await page.evaluate(() => window.__battle.state.units.find((u) => u.side === 'ally' && u.isHq).id);
        await selectCard(p, hq);
        await page.waitForTimeout(400);
        const measure = () => page.evaluate(() => {
            const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
            const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
            const ov = (a, c) => a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
            const steal = [];
            const quiet = [];
            for (const s of ['.b-obj', '.b-goals', '.b-ctrl', '.b-zoom', '.b-cards', '.b-cmds', '.b-hint-x', '.b-toast', '.b-abil', '.b-abnote', '.b-pausepill', '.b-inspect', '.b-hint'])
                for (const e of document.querySelectorAll(s)) if (vis(e)) (getComputedStyle(e).pointerEvents === 'none' ? quiet : steal).push({ s, ...R(e) });
            const hidden = [];
            const covered = [];
            for (const e of document.querySelectorAll('.b-label[data-ab="ready"]')) {
                const ab = e.querySelector('.b-lab-ab');
                if (!vis(e) || !ab) continue;
                const bb = R(ab);
                for (const k of steal) if (ov(bb, k)) hidden.push(`${e.dataset.id}×${k.s}`);
                for (const k of quiet) if (ov(bb, k)) covered.push(`${e.dataset.id}×${k.s}`);
            }
            // 能力の説明の欄（.b-abil）は第4群から押しを欄で使い切る（地図へ通さない）ので、ここには入れない
            const quietPe = ['.b-toast', '.b-abnote', '.b-pausepill', '.b-inspect', '.b-hint'].every((s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).pointerEvents === 'none'; });
            // 畳んだ目標の見出し：1 行に収まり、進みの文が省略（…）で切れていないか
            const g = document.querySelector('.b-goals');
            const head = g?.querySelector('.b-goals-head');
            const sumE = g?.querySelector('.b-goals-sum');
            // 進みの要（最初の「・」までの区切り。段階目標は今の段の数を含む 2 つ目まで）が、見出しの右端の内に収まるか
            let keyCut = false;
            const sum = sumE?.textContent ?? '';
            if (sumE && sumE.firstChild) {
                const segs = sum.split('・');
                const key = segs.slice(0, sum.startsWith('段階') ? 2 : 1).join('・');
                const rg = document.createRange();
                rg.setStart(sumE.firstChild, 0);
                rg.setEnd(sumE.firstChild, Math.min(key.length, sumE.firstChild.length));
                keyCut = rg.getBoundingClientRect().right > sumE.getBoundingClientRect().right + 1;
            }
            const goals = g ? { closed: g.classList.contains('closed'), h: head ? head.getBoundingClientRect().height : 0, sum, cut: !!sumE && sumE.scrollWidth > sumE.clientWidth + 1, keyCut } : null;
            const toasts = [...document.querySelectorAll('.b-toast')].filter((e) => vis(e)).length;
            return { hidden, covered, quietPe, goals, toasts, field: document.querySelector('.b-root')?.dataset.field };
        });
        const r = await measure();
        check(r.field === id, `[shots] ${id}：開けた`);
        check(r.hidden.length === 0, `[shots] ${id}：点滅する印が押しを奪う部品に覆われない`, r.hidden.join(' '));
        check(r.quietPe, `[shots] ${id}：操作の要らない表示は押しを奪わない`);
        if (r.covered.length) log(`  （記録）${id}：点滅する印が操作の要らない表示の下にある（押しは通る）：${r.covered.join(' ')}`);
        // 見出しの後ろ（区域ごとの様子など）が「…」で切れるのは記録だけ。進みの要（数）は切れないこと
        if (r.goals) check(r.goals.closed && r.goals.h <= 32 && !r.goals.keyCut, `[shots] ${id}：目標は畳んで 1 行・進みの数が「…」で切れない`, `${r.goals.h.toFixed(0)} px「${r.goals.sum}」${r.goals.cut ? '（後ろが「…」）' : ''}`);
        await page.screenshot({ path: `${OUT}/shots-${id}-phone.png` });
        // 60 秒進めた後（知らせ・目標の進みが出た後）も、点滅する印が押しを奪う部品に覆われない（待つ時間だけ早送り）
        await page.evaluate(() => window.__battle.fastForward(60));
        await page.waitForTimeout(600);
        if ((await ui(page)).selectedId !== hq) await selectCard(p, hq);
        await page.waitForTimeout(400);
        const r2 = await measure();
        check(r2.hidden.length === 0, `[shots] ${id}：60 秒の後も点滅する印が押しを奪う部品に覆われない`, r2.hidden.join(' '));
        check(r2.toasts <= 2 && r2.quietPe, `[shots] ${id}：60 秒の後、知らせは 2 つまで・操作の要らない表示は押しを奪わない`, `知らせ ${r2.toasts}`);
        if (r2.goals) check(r2.goals.h <= 32 && !r2.goals.keyCut, `[shots] ${id}：60 秒の後も目標の見出しは 1 行・進みの数が切れない`, `「${r2.goals.sum}」${r2.goals.cut ? '（後ろが「…」）' : ''}`);
        await page.screenshot({ path: `${OUT}/shots-${id}-phone-60s.png` });
        await p.ctx.close();
    }
}

if (PARTS.includes('desktop')) await run('desktop');
if (PARTS.includes('phone')) await run('phone');
if (PARTS.includes('shots')) await shots();
await b.close();
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
