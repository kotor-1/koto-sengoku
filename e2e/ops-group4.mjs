/**
 * 第4群の操作と配置の残件・味方同士の詰まり（docs/fields-group4-design.md §1・§2）を、実際のブラウザで本物のクリック・タップで確かめて撮る。
 *   BASE3D=http://localhost:8401 BASE=http://localhost:8401 node e2e/ops-group4.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/ops-group4）
 *   PARTS=desktop,phone で一部だけ（既定はすべて）。ONLY=A,B で A〜F の一部だけ
 * - desktop（PC 1280×720、マウス）・phone（スマホ横 844×390、タッチ）の両方：
 *   A. 能力の説明の欄（.b-abil）の押し・なぞり・ホイールは欄で使い切る：選んだ部隊の命令・選択・移動先指定・地図の位置が変わらない。
 *      操作の要らない知らせ（.b-toast）の上の押しは、今までどおり地図へ通す（移動先指定なら、その下の地面への移動になる）。
 *   B. 移動先指定の素早い 2 回（CDP で続けて送る）：能力が使える武将（名札が点滅）の体の上を移動先にして 2 回 → 選び直し・能力の発動・確かめが起きず、
 *      その点への移動になる。2 回目を少し離れた所にすると、その点への移動（選びは変わらない）。
 * - desktop だけ：
 *   C. 城攻め前面：閉じた門の先（曲輪の中）の地面を押す → 命令は「開門待ち」（札・知らせ）。門の外の地面を押すと開門待ちは消える（新しい命令で捨てる）。
 *      もう一度曲輪の中を押し、門の前の敵を戦場の外へ出して（直接操作）早送り → 門の前で待った部隊が輪を占めて門が開き、道を引き直して曲輪の中へ。
 *   D. 城下町外縁：地図の名札「味方の退き口」と「敵の突破口：…」3 つが別の所にあり、重ならない。合戦の前の説明に用途の区別がある。
 *   E. 上の知らせが選んでいる名札を覆う → 知らせを畳む（data-fold）。名札を離すと元に戻す。知らせは開発用の確認の口で出す（直接操作）。
 *   F. 村落の再現（西の辻に二隊）：札を押す → 地面を押すで命令（待ちは早送り）。石川隊が酒井隊の手前で 10 秒以上止まらず、西の辻へ着く。
 * 待つ時間だけは開発用の早送り（fastForward）。C の敵を外す・E の知らせを出すのは状態の直接操作（ログに書く）。
 * コンテナはソフトウェア描画（実機・性能は未確認）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8401';
const OUT = process.argv[2] || 'e2e-out/ops-group4';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone').split(',');
/** ONLY=A,B で A〜F の一部だけ（既定はすべて） */
const ONLY = (process.env.ONLY || 'A,B,C,D,E,F').split(',');
const on = (k) => ONLY.includes(k);
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();

async function openPage(kind, id, start = true) {
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
    const p = { ctx, page, phone, kind, id };
    if (start) await begin(p);
    return p;
}
async function begin(p) {
    await press(p, '.b-primary');
    await p.page.waitForTimeout(400);
    await press(p, '.b-pause');
    await p.page.waitForTimeout(500);
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const cam = (page) => page.evaluate(() => { const c = window.__battle.camera; return { tx: c.tx, tz: c.tz, dist: c.dist }; });
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const ground = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const unit = (page, id) => page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); return { x: u.x, z: u.z, order: u.order, status: u.status }; }, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const cardText = (page, id) => page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"] .b-ord`)?.textContent ?? '', id);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${p.id}-${name}.png` });
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, sel);
const abilityUses = (page) => page.evaluate(() => window.__battle.state.abilityList.filter((a) => a.usedAt !== null).map((a) => a.id));
const same = (a, b) => Math.abs(a.tx - b.tx) < 0.01 && Math.abs(a.tz - b.tz) < 0.01 && Math.abs(a.dist - b.dist) < 0.01;

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
async function selectCard(p, id) {
    await press(p, `.b-card[data-id="${id}"]`);
    if ((await ui(p.page)).selectedId !== id) await press(p, `.b-card[data-id="${id}"]`);
}
/** なぞる（PC はマウスを押したまま動かす、スマホは CDP の指の動き） */
async function drag(p, x0, y0, x1, y1) {
    if (p.phone) {
        const c = await p.ctx.newCDPSession(p.page);
        await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        for (let k = 1; k <= 8; k++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 8, y: y0 + ((y1 - y0) * k) / 8 }] });
        await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await c.detach();
    } else {
        await p.page.mouse.move(x0, y0);
        await p.page.mouse.down();
        for (let k = 1; k <= 8; k++) await p.page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8);
        await p.page.mouse.up();
    }
    await p.page.waitForTimeout(500);
}
/**
 * CDP で 2 回の押しを続けて送る（PC はマウス、スマホは指）。4 つの出来事を待たずに続けて送る（ソフトウェア描画のコンテナでは、1 つずつ
 * 待つと指の出来事が描画の 1 コマに揃えられて 1 回に 0.3 秒ほどかかり、素早い 2 回にならない）。戻り値は、ページの中で測った
 * 1 回目と 2 回目の離した時刻の差（ミリ秒）
 */
async function doubleTap(p, a, bpt) {
    await p.page.evaluate(() => {
        window.__g4ups = [];
        if (!window.__g4upHook) {
            window.__g4upHook = true;
            document.querySelector('.b-input').addEventListener('pointerup', () => window.__g4ups.push(performance.now()));
        }
    });
    const c = await p.ctx.newCDPSession(p.page);
    const ev = [];
    for (const pt of [a, bpt]) {
        if (p.phone) {
            ev.push(c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] }));
            ev.push(c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
        } else {
            ev.push(c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }));
            ev.push(c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }));
        }
    }
    await Promise.all(ev);
    await c.detach();
    await p.page.waitForTimeout(600);
    const ups = await p.page.evaluate(() => window.__g4ups);
    return ups.length >= 2 ? ups[1] - ups[0] : NaN;
}

// ================================================================ A 能力の説明の欄
async function partA(kind) {
    const p = await openPage(kind, 'plains');
    const { page } = p;
    await selectCard(p, 'a_tadakatsu');
    await page.waitForTimeout(300);
    const panel = await rect(page, '.b-abil');
    check(!!panel, `[${kind}] A：忠勝隊を選ぶと能力の説明の欄が出る`, JSON.stringify(panel));
    if (!panel) return p.ctx.close();
    const o0 = JSON.stringify((await unit(page, 'a_tadakatsu')).order);
    const c0 = await cam(page);
    // 押す
    await pointAt(p, panel.x, panel.y);
    let st = await ui(page);
    check(st.selectedId === 'a_tadakatsu' && st.pending === 'none' && JSON.stringify((await unit(page, 'a_tadakatsu')).order) === o0, `[${kind}] A：欄の真ん中を押す → 選びも命令も変わらない（下の地面への移動・攻撃にならない）`, `選び ${st.selectedId}・命令 ${JSON.stringify((await unit(page, 'a_tadakatsu')).order)}`);
    // なぞる（欄の中で縦に）
    await drag(p, panel.x, panel.b - 6, panel.x + 10, panel.t + 6);
    st = await ui(page);
    const c1 = await cam(page);
    check(same(c0, c1) && JSON.stringify((await unit(page, 'a_tadakatsu')).order) === o0 && st.selectedId === 'a_tadakatsu', `[${kind}] A：欄の中をなぞる → 地図は動かず、命令・選びも変わらない`, `地図 ${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
    if (!p.phone) {
        await page.mouse.move(panel.x, panel.y);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(400);
        check(same(c0, await cam(page)), `[${kind}] A：欄の上でホイール → 地図は寄り・引きしない`);
    }
    // 移動先指定の最中に欄を押す → 移動先指定のまま（欄の下の地面へ移動しない）
    await press(p, '.b-cmd:has-text("移動")');
    check((await ui(page)).pending === 'move', `[${kind}] A：「移動」で移動先指定に入る`);
    await pointAt(p, panel.x, panel.y);
    st = await ui(page);
    check(st.pending === 'move' && JSON.stringify((await unit(page, 'a_tadakatsu')).order) === o0, `[${kind}] A：移動先指定の最中に欄を押す → 移動にならず、移動先指定のまま`, `指定 ${st.pending}・命令 ${JSON.stringify((await unit(page, 'a_tadakatsu')).order)}`);
    await shot(p, 'A-panel');
    // 操作の要らない知らせ（.b-toast）は押しを地図へ通す：知らせの上を押すと、その下の地面への移動（直接操作：知らせを出す）
    await page.evaluate(() => window.__battle.toast('確かめ用の知らせ（押しは地図へ通る）', 'info'));
    await page.waitForTimeout(300);
    const t = await rect(page, '.b-toast');
    log(`  （直接操作）知らせを 1 つ出した ${JSON.stringify(t)}`);
    if (t) {
        const gpt = await page.evaluate(([x, y]) => { const B = window.__battle; const r = document.querySelector('canvas').getBoundingClientRect(); const g = B.view.groundAt(x - r.left, y - r.top); return g ? { x: g.x, z: g.z } : null; }, [t.x, t.y]);
        await pointAt(p, t.x, t.y);
        const o2 = (await unit(page, 'a_tadakatsu')).order;
        check(o2.type === 'move' && !!gpt && Math.hypot(o2.x - gpt.x, o2.z - gpt.z) < 8 && (await ui(page)).pending === 'none', `[${kind}] A：知らせの上を押す → 押しは地図へ通り、その下の地面への移動になる（説明の欄とは別の扱い）`, `命令 ${JSON.stringify(o2)}・地面 ${JSON.stringify(gpt)}`);
    }
    await p.ctx.close();
}

// ================================================================ B 移動先指定の素早い 2 回
async function partB(kind) {
    const p = await openPage(kind, 'plains');
    const { page } = p;
    // 能力が使える（名札が点滅する）武将の体の上を移動先にする。動かすのは騎馬隊（能力の無い部隊）
    const ready = await page.evaluate(() => window.__battle.labelFits().filter((l) => l.ab === 'ready').map((l) => l.id));
    const target = ready.includes('a_tadakatsu') ? 'a_tadakatsu' : ready[0];
    check(!!target, `[${kind}] B：名札が点滅している（能力が使える）武将がいる`, ready.join(','));
    const t0 = await unit(page, target);
    await page.evaluate(([x, z]) => window.__battle.centerOn(x, z + 20, 180), [t0.x, t0.z]);
    await page.waitForTimeout(600);
    await selectCard(p, 'a_kiba');
    await press(p, '.b-cmd:has-text("移動")');
    const body = await screenOf(page, target);
    const uses0 = await abilityUses(page);
    const gap1 = await doubleTap(p, body, body);
    log(`  2 回の押しの間（ページの中で測った離した時刻の差）${gap1.toFixed(0)} ms（MOVE_ECHO_SEC 0.6 秒の内）`);
    check(gap1 < 600, `[${kind}] B：2 回の押しは 0.6 秒の内に届いた（素早い 2 回）`, `${gap1.toFixed(0)} ms`);
    const st = await ui(page);
    const o = (await unit(page, 'a_kiba')).order;
    const h = await hintText(page);
    check(st.selectedId === 'a_kiba' && o.type === 'move' && Math.hypot(o.x - t0.x, o.z - t0.z) < 15, `[${kind}] B：${target} の体の上を素早く 2 回（CDP）→ 騎馬隊のその点への移動。選び直さない`, `選び ${st.selectedId}・命令 ${JSON.stringify(o)}`);
    check(JSON.stringify(await abilityUses(page)) === JSON.stringify(uses0) && !h.includes('もう一度押すと') && st.pending === 'none', `[${kind}] B：能力は使われず、確かめ（もう一度押すと…）も出ない`, `使った能力 ${JSON.stringify(await abilityUses(page))}・帯「${h}」`);
    await shot(p, 'B-double-same');
    // 2 回目を少し離れた所に
    await press(p, '.b-cmd:has-text("移動")');
    const b2 = { x: body.x + 70, y: body.y + 10 };
    const g2 = await page.evaluate(([x, y]) => { const B = window.__battle; const r = document.querySelector('canvas').getBoundingClientRect(); const g = B.view.groundAt(x - r.left, y - r.top); return g ? { x: g.x, z: g.z } : null; }, [b2.x, b2.y]);
    const gap2 = await doubleTap(p, body, b2);
    log(`  2 回の押しの間 ${gap2.toFixed(0)} ms`);
    const st2 = await ui(page);
    const o2 = (await unit(page, 'a_kiba')).order;
    check(st2.selectedId === 'a_kiba' && o2.type === 'move' && !!g2 && Math.hypot(o2.x - g2.x, o2.z - g2.z) < 6 && JSON.stringify(await abilityUses(page)) === JSON.stringify(uses0), `[${kind}] B：2 回目を 70 px 離れた所に → その点への移動（選び直し・能力の発動なし）`, `選び ${st2.selectedId}・命令 ${JSON.stringify(o2)}・2 回目の地面 ${JSON.stringify(g2)}`);
    // 間を空けた 2 回目は、ふつうの押し（その武将を選ぶ）
    await press(p, '.b-cmd:has-text("移動")');
    await pointAt(p, body.x, body.y, 1200);
    await pointAt(p, body.x, body.y, 600);
    const st3 = await ui(page);
    check(st3.selectedId === target, `[${kind}] B：1 秒あけた 2 回目はふつうの押し（${target} を選ぶ）`, `選び ${st3.selectedId}`);
    await p.ctx.close();
}

// ================================================================ C 城攻め前面：開門待ち
async function partC() {
    const p = await openPage('desktop', 'siege_front');
    const { page } = p;
    await page.evaluate(() => window.__battle.centerOn(0, -60, 260));
    await page.waitForTimeout(600);
    await selectCard(p, 'a_sakakibara');
    const inside = await ground(page, -20, -95);
    await pointAt(p, inside.x, inside.y);
    const h1 = await hintText(page);
    let o = (await unit(page, 'a_sakakibara')).order;
    let card = await cardText(page, 'a_sakakibara');
    check(o.type === 'move' && o.awaitGate === 'outer_gate' && h1.includes('開門待ち') && card.includes('開門待ち'), '[desktop] C：曲輪の中の地面を押す → 移動の命令に「開門待ち」（知らせ・札）', `帯「${h1}」・札「${card}」・命令 ${JSON.stringify(o)}`);
    await shot(p, 'C1-await');
    // 新しい命令で古い保留を捨てる
    const outside = await ground(page, 40, -20);
    await pointAt(p, outside.x, outside.y);
    o = (await unit(page, 'a_sakakibara')).order;
    card = await cardText(page, 'a_sakakibara');
    check(o.type === 'move' && !o.awaitGate && !card.includes('開門待ち'), '[desktop] C：門の外の地面を押し直す → 開門待ちは消える', `札「${card}」・命令 ${JSON.stringify(o)}`);
    await pointAt(p, inside.x, inside.y);
    check((await unit(page, 'a_sakakibara')).order.awaitGate === 'outer_gate', '[desktop] C：もう一度曲輪の中を押す → 開門待ち');
    // 直接操作：門の前の敵（出張り）・櫓の弓・拠点を戦場の外へ出す（門の前の輪を占められるように）
    await page.evaluate(() => {
        for (const u of window.__battle.state.units) if (u.side === 'enemy' && !u.isHq) { u.status = 'withdrawn'; u.present = false; }
    });
    log('  （直接操作）本陣のほかの敵（門の前・櫓・拠点・曲輪の中）を戦場の外へ出した');
    let opened = false;
    let overBefore = false;
    for (let k = 0; k < 40 && !opened; k++) {
        await ff(page, 5);
        const s = await page.evaluate(() => { const st = window.__battle.state; const u = st.units.find((x) => x.id === 'a_sakakibara'); return { open: st.field.gates[0].open, z: u.z, order: u.order }; });
        if (!s.open && s.z < -57) overBefore = true;
        opened = s.open;
        if (!opened && !(s.order.type === 'move' && s.order.awaitGate === 'outer_gate')) {
            check(false, `[desktop] C：門が閉じている間は開門待ちのまま（${(k + 1) * 5} 秒・早送り）`, JSON.stringify(s));
            break;
        }
        if (k === 9) check(true, '[desktop] C：門が閉じている間は開門待ちのまま、門の前の点で待つ（50 秒・早送り）', JSON.stringify(s));
    }
    check(opened && !overBefore, '[desktop] C：門の前で待った部隊が輪を占めて門が開く（早送り）。開く前に石垣の向こうへ出ない');
    await shot(p, 'C2-open');
    await ff(page, 40);
    const u = await unit(page, 'a_sakakibara');
    card = await cardText(page, 'a_sakakibara');
    check(Math.hypot(u.x + 20, u.z + 95) < 8 && !card.includes('開門待ち'), '[desktop] C：開いた後は道を引き直して曲輪の中の行き先へ着く', `(${u.x.toFixed(1)},${u.z.toFixed(1)})・札「${card}」・命令 ${JSON.stringify(u.order)}`);
    await shot(p, 'C3-inside');
    await p.ctx.close();
}

// ================================================================ D 城下町外縁：味方の退き口と敵の突破口
async function partD() {
    const p = await openPage('desktop', 'town_edge', false);
    const { page } = p;
    const brief = await page.evaluate(() => document.querySelector('.b-brief')?.textContent ?? '');
    check(brief.includes('味方の退き口は') && brief.includes('敵の突破口'), '[desktop] D：合戦の前の説明に、味方の退き口と敵の突破口の用途の区別がある');
    await begin(p);
    await page.waitForTimeout(800);
    const labels = await page.evaluate(() =>
        [...document.querySelectorAll('.b-label.terrain')].filter((e) => !e.hidden && e.dataset.fit !== 'hide').map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom }; }),
    );
    const ally = labels.filter((l) => l.text.startsWith('味方の退き口'));
    const foe = labels.filter((l) => l.text.startsWith('敵の突破口：'));
    check(ally.length === 1 && foe.length === 3, '[desktop] D：地図の名札「味方の退き口」1 つと「敵の突破口：…」3 つ', labels.map((l) => l.text).join('／'));
    const overlap = (a, c) => a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;
    const near = ally.length ? Math.min(...foe.map((f) => Math.hypot((f.l + f.r) / 2 - (ally[0].l + ally[0].r) / 2, (f.t + f.b) / 2 - (ally[0].t + ally[0].b) / 2))) : 0;
    check(ally.length === 1 && foe.every((f) => !overlap(f, ally[0])) && near > 60, '[desktop] D：味方の退き口の名札は、敵の突破口の名札と重ならず離れている', `いちばん近い突破口の名札まで ${near.toFixed(0)} px`);
    const exits = await page.evaluate(() => ({ ally: window.__battle.state.map.exits.ally }));
    check(Math.hypot(exits.ally.x + 213, exits.ally.z - 175) > 100, '[desktop] D：味方の退き口は西の脇道の出口（敵の突破口）から 100 m 以上離れている', JSON.stringify(exits.ally));
    await shot(p, 'D-labels');
    await p.ctx.close();
}

// ================================================================ E 上の知らせを畳む
async function partE(kind) {
    const p = await openPage(kind, 'plains');
    const { page } = p;
    await selectCard(p, 'a_tadakatsu');
    // 選んだ名札が上の真ん中（知らせの下）へ来るように地図を動かす
    const mid = await rect(page, '.b-topmid');
    const toastsY = (mid?.t ?? 10) + 40;
    for (let k = 0; k < 4; k++) {
        const l = await page.evaluate(() => window.__battle.labelOf('a_tadakatsu'));
        if (!l) break;
        const W = await page.evaluate(() => window.innerWidth);
        await page.evaluate(([dx, dy]) => { const B = window.__battle; B.view.panByScreen(dx[0], dx[1], dy[0], dy[1]); }, [[l.x, l.y], [W / 2, toastsY]]);
        await page.waitForTimeout(300);
    }
    for (let k = 0; k < 3; k++) await page.evaluate((k) => window.__battle.toast(`確かめ用の知らせ ${k + 1}（名札を覆う所に出る）`, 'info'), k);
    await page.waitForTimeout(800);
    const fold = await page.evaluate(() => window.__battle.noticeFold());
    const lab = await page.evaluate(() => window.__battle.labelOf('a_tadakatsu'));
    const vis = await page.evaluate(() => [...document.querySelectorAll('.b-toast, .b-abnote')].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e.parentElement).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    const covered = !!lab && vis.some((r) => r.l < lab.r && r.r > lab.l && r.t < lab.b && r.b > lab.t);
    log(`  （直接操作）知らせを 3 つ出した。名札 ${lab ? `(${lab.x.toFixed(0)},${lab.y.toFixed(0)})` : '―'}・見えている知らせ ${vis.length}`);
    check(fold > 0 && !covered, `[${kind}] E：知らせが選んでいる名札を覆う所に出る → 畳む（data-fold=${fold}）。見えている知らせは名札を覆わない`);
    await shot(p, 'E1-folded');
    // 選んだ名札を押せる（覆われていない）：名札の名前の所を押すと選んだまま（命令できる味方を選んでいる間は地図を押した扱い＝その点への移動）
    // 名札を下へ離す → 元に戻す
    await page.evaluate(() => { const B = window.__battle; const W = window.innerWidth; const H = window.innerHeight; B.view.panByScreen(W / 2, 60, W / 2, H / 2); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__battle.toast('確かめ用の知らせ 4', 'info'));
    await page.waitForTimeout(800);
    const fold2 = await page.evaluate(() => window.__battle.noticeFold());
    check(fold2 === 0, `[${kind}] E：名札が知らせから離れたら元に戻す（data-fold なし）`, `fold ${fold2}`);
    await shot(p, 'E2-unfolded');
    await p.ctx.close();
}

// ================================================================ F 村落の再現（西の辻に二隊）
async function partF() {
    const p = await openPage('desktop', 'village');
    const { page } = p;
    // 見張り：石川隊が移動の命令のまま、斬り合い・射撃なしで 1.5 m も動かない最長の時間（e2e/fields-group3.mjs の見張りと同じ数え方）
    await page.evaluate(() => {
        const M = { a: null, longest: 0, at: null };
        M.tick = (st) => {
            const u = st.units.find((x) => x.id === 'a_ishikawa');
            const o = u.order;
            if (o.type !== 'move' || u.engagedWith || u.shootingAt || Math.hypot(u.x - o.x, u.z - o.z) <= 8) { M.a = null; return; }
            if (!M.a || Math.hypot(u.x - M.a.x, u.z - M.a.z) > 1.5) { M.a = { x: u.x, z: u.z, t: st.t }; return; }
            if (st.t - M.a.t > M.longest) { M.longest = st.t - M.a.t; M.at = { t: M.a.t, x: M.a.x, z: M.a.z }; }
        };
        window.__g4still = M;
    });
    const steps = [
        [4, 'a_tadakatsu', 0, 30],
        [6, 'a_sakai', -48, 40],
        [8, 'a_kiba', 48, 40],
        [10, 'a_ishikawa', 18, 52],
        [12, 'a_yumi', -18, 55],
        [14, 'a_sakakibara', 30, 80],
        [16, 'a_ieyasu', 0, 125],
        [25, 'a_ishikawa', -72, -28],
        [27, 'a_sakai', -72, 20],
    ];
    const issued = [];
    for (const [t, id, x, z] of steps) {
        const now = await page.evaluate(() => window.__battle.state.t);
        if (t > now) await page.evaluate((s) => window.__battle.fastForward(s, (st) => window.__g4still.tick(st)), t - now);
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z, 220), [x, z]);
        await page.waitForTimeout(300);
        await selectCard(p, id);
        await press(p, '.b-cmd:has-text("移動")');
        const g = await ground(page, x, z);
        await pointAt(p, g.x, g.y, 400);
        const o = (await unit(page, id)).order;
        issued.push(o.type === 'move' && Math.hypot(o.x - x, o.z - z) < 4);
    }
    check(issued.every(Boolean), '[desktop] F：9 つの移動をどれも画面の操作（札 → 移動 → 地面）で出せた', JSON.stringify(issued));
    await page.evaluate(() => window.__battle.fastForward(100 - window.__battle.state.t, (st) => window.__g4still.tick(st)));
    const r = await page.evaluate(() => ({ longest: window.__g4still.longest, at: window.__g4still.at, events: window.__battle.state.events.filter((e) => e.unitId === 'a_ishikawa' && e.text.includes('道を塞がれて')).length }));
    const k = await unit(page, 'a_ishikawa');
    const sk = await unit(page, 'a_sakai');
    check(r.longest < 10 && r.events === 0, '[desktop] F：石川隊は酒井隊の手前で 10 秒以上止まらない（「道を塞がれて」の待機にならない）', `止まっていた最長 ${r.longest.toFixed(1)} 秒 ${JSON.stringify(r.at)}`);
    check(Math.hypot(k.x + 72, k.z + 28) < 8 && Math.hypot(sk.x + 72, sk.z - 20) < 5, '[desktop] F：100 秒（早送り）に石川隊は西の辻に、酒井隊は西の通りの口に', `石川 (${k.x.toFixed(1)},${k.z.toFixed(1)})・酒井 (${sk.x.toFixed(1)},${sk.z.toFixed(1)})`);
    await page.evaluate(() => window.__battle.centerOn(-72, 0, 200));
    await page.waitForTimeout(500);
    await shot(p, 'F-village');
    await p.ctx.close();
}

try {
    if (PARTS.includes('desktop')) {
        if (on('A')) await partA('desktop');
        if (on('B')) await partB('desktop');
        if (on('C')) await partC();
        if (on('D')) await partD();
        if (on('E')) await partE('desktop');
        if (on('F')) await partF();
    }
    if (PARTS.includes('phone')) {
        if (on('A')) await partA('phone');
        if (on('B')) await partB('phone');
        if (on('E')) await partE('phone');
    }
} catch (e) {
    failures.push(`例外：${e.message}`);
    log(e);
} finally {
    await b.close();
}
log(failures.length ? `NG ${failures.length}：\n- ${failures.join('\n- ')}` : 'すべて ok');
process.exit(failures.length ? 1 : 0);
