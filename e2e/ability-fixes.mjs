/**
 * Version 13 候補の確認で見つかった問題の直しを、本物のクリック／タップで確かめる（docs/troops-abilities-design.md §4・§5）。
 *   BASE3D=http://localhost:8186 node e2e/ability-fixes.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/ability-fixes）
 *   KINDS=desktop,phone で端末を絞る（既定はどちらも）。
 *
 * ?dev=field&id=<戦場>&render=manual（演習と同じ buildBattleSetup(戦場, 'standard')）。合戦を始めて「指揮」で止め、「全体」で全体表示。すべて止めたまま。
 * 1. 名札の重なり：点滅している名札の印は、どれも別の名札に隠れていない（重なりをほどく）。重なっている所が残っていれば
 *    （下の名札の印の四角の中で、上の名札が見えている所）、そこを押しても下の武将の能力は発動しない。
 *    確認で見つかった所（スマホ：大平原 (444,199)・丘陵 (404,223)）も同じく押す。
 * 2. 点滅している武将の名札の名前・部隊の体を押す：その部隊を選び、確かめ（名札に「もう一度で◆」・下の案内）を出す。もう一度押すと使う。
 *    素早い 2 回（CDP で続けて送る）は使わない。確かめの時間（3 秒）の後に選んでいる部隊を押すと、Version 12 どおり選択が外れる。
 * 3. 石川の対象選び：持ち主・選べる対象の名札が画面の部品（能力の欄・案内の帯）に隠れない（隠れていれば地図が動く）。持ち主の名札を押してやめられる。
 * 4. 酒井の両翼の采配：効果中の名札に包囲の条件の状態（「包囲なし」など）が出る。
 * 5. 札の命令の文：命令を受けていない待機は「待機・武将任せ」（札の文の説明に「武将の判断」）、防衛・待機を命じると「防衛・待機」。
 * 6. 引いた画面：名札を小さく（.b-labels.far）。「＋」で前線（両軍の真ん中）へ寄る。
 *
 * 確認の種類：本物の入力（クリック／タップ・CDP の連打）。カメラ・時刻は動かさない（「全体」「＋」のボタンだけ）。実機は未確認。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8186';
const OUT = process.argv[2] || 'e2e-out/ability-fixes';
mkdirSync(OUT, { recursive: true });
const KINDS = (process.env.KINDS || 'desktop,phone').split(',');
const failures = [];
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 900000, polling: 500 };
const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];

const b = await launchBrowser();

async function openPage(kind, field) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(900000);
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
    await page.goto(`${BASE}/?dev=field&id=${field}&render=manual`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    const p = { ctx, page, phone, kind };
    await press(p, '.b-primary', 500);
    await press(p, '.b-pause', 500);
    await press(p, '.b-zall', 900);
    return p;
}
async function press(p, sel, wait = 400) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(wait);
}
async function pointAt(p, x, y, wait = 700) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
/** 素早い連打（CDP で返事を待たずに続けて送る。e2e/ability-ui.mjs と同じ） */
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
}
const ui = (page) => page.evaluate(() => window.__battle.ui);
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const labelText = (page, id) => page.evaluate((id) => document.querySelector(`.b-label[data-id="${id}"]`)?.textContent ?? '', id);
const used = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__battle.state.abilities).map(([k, r]) => [k, r.usedAt])));
const usedIds = (u) => Object.keys(u).filter((k) => u[k] !== null).sort();
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const blockers = (page) => page.evaluate(() => window.__battle.blockers());
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const cardOrd = (page, id) => page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"] .b-ord`)?.textContent ?? '', id);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => `${u.id}:${u.x.toFixed(2)},${u.z.toFixed(2)}:${JSON.stringify(u.order)}`).join('|'));
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
const inBox = (b, x, y) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;
const overlap = (a, c) => a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;

/** 下の名札（点滅）の印の四角の中で、上の名札が見えている点（無ければ null）。上の名札自身の印の外を選ぶ */
async function hiddenBadgePoints(page) {
    const cs = await covers(page);
    const out = [];
    for (const lo of cs) {
        const lb = await label(page, lo.id);
        if (!lb?.badge || lb.ab !== 'ready') continue;
        for (const hi of cs) {
            if (hi.id === lo.id || hi.z <= lo.z) continue;
            const hb = (await label(page, hi.id))?.badge;
            // 重なりの四角の真ん中
            const l = Math.max(lb.badge.l, hi.l);
            const r = Math.min(lb.badge.r, hi.r);
            const t = Math.max(lb.badge.t, hi.t);
            const bt = Math.min(lb.badge.b, hi.b);
            if (l >= r || t >= bt) continue;
            const x = (l + r) / 2;
            const y = (t + bt) / 2;
            if (hb && inBox(hb, x, y)) continue;
            out.push({ under: lo.id, over: hi.id, x, y });
        }
    }
    return out;
}

async function run(kind) {
    // ---------------- 1. 名札の重なり（大平原・丘陵） ----------------
    for (const [field, known] of [
        ['plains', { x: 444, y: 199 }],
        ['hills', { x: 404, y: 223 }],
    ]) {
        const p = await openPage(kind, field);
        const { page } = p;
        await shot(p, `${field}-1-start`);
        // 名札の重なりをほどく：点滅している名札の印は、どれも別の名札の下に隠れていない
        const hiddenReady = await page.evaluate(() => {
            const cs = window.__battle.labelCovers();
            const out = [];
            for (const c of cs) {
                const lb = window.__battle.labelOf(c.id);
                if (!lb?.badge || lb.ab !== 'ready') continue;
                const g = lb.badge;
                if (cs.some((o) => o.id !== c.id && o.z > c.z && o.l < g.r && o.r > g.l && o.t < g.b && o.b > g.t)) out.push(c.id);
            }
            return out;
        });
        check(hiddenReady.length === 0, `[${kind}] ${field}：点滅している名札の印は、どれも別の名札に隠れていない（名札の重なりをほどく）`, hiddenReady.join(','));
        const pts = await hiddenBadgePoints(page);
        log(`    [${kind}] ${field}：隠れた印の上に重なって見えている名札 ${pts.length} か所 ${pts.map((q) => `${q.under}<${q.over}@${Math.round(q.x)},${Math.round(q.y)}`).join(' ')}`);
        for (const q of pts) {
            const before = await used(page);
            await pointAt(p, q.x, q.y, 700);
            const after = await used(page);
            check(after[q.under] === null, `[${kind}] ${field}：上に見えている${q.over}の名札を押しても、下に隠れた${q.under}の能力は発動しない`, `選択 ${(await ui(page)).selectedId}・使った ${usedIds(after).join(',') || 'なし'}`);
            check(usedIds(after).join() === usedIds(before).join(), `[${kind}] ${field}：その 1 回では、どの能力も発動しない（名前の所は確かめ）`);
            // 確かめを消す（空いた地面は選択を外すだけ。止めたまま）
            await press(p, '.b-zall', 3300);
        }
        if (p.phone) {
            // 確認で見つかった所（全体表示のスマホ）
            const top = await page.evaluate(([x, y]) => {
                const cs = window.__battle.labelCovers().filter((c) => x >= c.l && x <= c.r && y >= c.t && y <= c.b).sort((a, b) => b.z - a.z);
                return cs[0]?.id ?? null;
            }, [known.x, known.y]);
            const before = await used(page);
            await pointAt(p, known.x, known.y, 900);
            const after = await used(page);
            await shot(p, `${field}-2-known-point`);
            check(after.a_tadakatsu === null && usedIds(after).join() === usedIds(before).join(), `[${kind}] ${field}：確認で誤発動した所 (${known.x},${known.y}) を押しても、忠勝（ほか）の能力は発動しない`, `いちばん上の名札 ${top}・選択 ${(await ui(page)).selectedId}`);
        }
        await p.ctx.close();
    }

    const p = await openPage(kind, 'plains');
    const { page } = p;

    // ---------------- 6. 引いた画面の名札・「＋」で前線へ ----------------
    check(await page.evaluate(() => document.querySelector('.b-labels')?.classList.contains('far')), `[${kind}] 全体表示では名札が小さい（.b-labels.far）`);
    await shot(p, 'a-overview-far-labels');

    // ---------------- 5. 札の命令の文 ----------------
    const o1 = await cardOrd(page, 'a_ishikawa');
    const o1t = await page.evaluate(() => document.querySelector('.b-card[data-id="a_ishikawa"] .b-ord')?.title ?? '');
    check(o1 === '待機・武将任せ' && o1t.includes('武将の判断'), `[${kind}] 命令を受けていない石川隊の札は「待機・武将任せ」（説明に「武将の判断」）`, `${o1} / ${o1t}`);
    check((await cardOrd(page, 'a_yumi')) === '防衛・待機', `[${kind}] 方針を持たない弓隊の札は「防衛・待機」`);

    // ---------------- 2. 名札の名前・部隊の体で確かめ → もう一度で使う ----------------
    // 家康：名札の名前（いちばん上に見えている所）
    /** 名札の名前の所で、いちばん上に見えている点（印の外） */
    const namePoint = async (id) => {
        const cs = await covers(page);
        const lb = await label(page, id);
        const me = cs.find((k) => k.id === id);
        const others = cs.filter((c) => c.id !== id && c.z > me.z);
        for (let x = lb.l + 4; x < (lb.badge?.l ?? lb.r) - 2; x += 2) if (!others.some((o) => inBox(o, x, lb.y))) return { x, y: lb.y };
        return null;
    };
    // 何も選んでいない所から：名札の名前を押す → 確かめ（名札・案内を 1 回で読む）→ すぐ同じ所をもう一度 → 使う
    // （命令を出せる味方を選んでいる間は、名札の名前は地図を押した扱いなので、選んでいない所から始める。重いコンテナでは読み取りに時間がかかるので、
    //   確かめの 3 秒のうちに 2 回目を押せるよう、読むのは 1 回だけ）
    let before = await snapshot(page);
    const np = await namePoint('a_ieyasu');
    await pointAt(p, np.x, np.y, 0);
    const shown1 = await (
        await page.waitForFunction(
            () => {
                const l = document.querySelector('.b-label[data-id="a_ieyasu"]');
                if (!(l?.textContent ?? '').includes('もう一度')) return null;
                const h = document.querySelector('.b-hint');
                return { t1: l.textContent, h1: h && !h.hidden ? h.textContent : '', ab1: l.dataset.ab ?? '', sel: window.__battle.ui.selectedId, used: window.__battle.state.abilities.a_ieyasu.usedAt };
            },
            null,
            { timeout: 10000, polling: 50 },
        )
    ).jsonValue();
    // 名札は「もう一度で◆号令」で長くなって動くことがあるが、1 回目と同じ所の 2 回目は同じ武将とみなす
    await pointAt(p, np.x, np.y, 700);
    const usedIe = (await used(page)).a_ieyasu;
    const { t1, h1, ab1 } = shown1;
    let u = { selectedId: shown1.sel };
    check(u.selectedId === 'a_ieyasu' && shown1.used === null && t1.includes('もう一度で◆号令'), `[${kind}] 家康の名札の名前を押す → 家康本陣を選び、まだ使わない（確かめ）`, `選択 ${u.selectedId}`);
    check(t1.includes('もう一度で◆号令') && h1.includes('もう一度'), `[${kind}] 確かめの表示：名札「もう一度で◆号令」・案内`, `${t1} / ${h1}`);
    check(ab1 === 'ready', `[${kind}] 確かめの間も点滅は続く`);
    check(usedIe !== null, `[${kind}] もう一度押す → 立て直しの号令を使う`);
    check(before === (await snapshot(page)), `[${kind}] 名札の 2 回の押しは、どの部隊の位置・命令にも漏れない`);
    await shot(p, 'b-name-fire');

    // 榊原：部隊の体
    let q = await screenOf(page, 'a_sakakibara');
    before = await snapshot(page);
    await pointAt(p, q.x, q.y, 0);
    // 確かめの表示を 1 回で読み、すぐ同じ所をもう一度（確かめは 3 秒）
    const shown2 = await (
        await page.waitForFunction(
            () => {
                const l = document.querySelector('.b-label[data-id="a_sakakibara"]');
                if (!(l?.textContent ?? '').includes('もう一度')) return null;
                return { t2: l.textContent, sel: window.__battle.ui.selectedId, used: window.__battle.state.abilities.a_sakakibara.usedAt };
            },
            null,
            { timeout: 10000, polling: 50 },
        )
    ).jsonValue();
    await pointAt(p, q.x, q.y, 700);
    check(shown2.sel === 'a_sakakibara' && shown2.used === null && shown2.t2.includes('もう一度で◆'), `[${kind}] 榊原隊の体を押す → 選ぶ・確かめ（まだ使わない）`, shown2.t2);
    check((await used(page)).a_sakakibara !== null, `[${kind}] 榊原隊の体をもう一度 → 先駆けの号を使う`);
    check(before === (await snapshot(page)), `[${kind}] 体の 2 回の押しは、位置・命令に漏れない`);
    await shot(p, 'c-body-fire');

    // 酒井：素早い 2 回は使わない。3 秒後に押すと選択が外れる（Version 12 どおり）。部隊の体の、名札に覆われていない所を押す
    q = await screenOf(page, 'a_sakai');
    {
        const cs = await covers(page);
        for (let dy = 0; dy <= 12 && cs.some((c) => inBox(c, q.x, q.y)); dy += 3) q = { ...q, y: q.y + 3 };
    }
    await rapidTaps(p, q.x, q.y, 2);
    await page.waitForTimeout(700);
    u = await ui(page);
    check(u.selectedId === 'a_sakai' && (await used(page)).a_sakai === null, `[${kind}] 酒井隊の体を素早く 2 回 → 選ぶだけ（使わない）`, `選択 ${u.selectedId}`);
    await page.waitForTimeout(3300);
    await pointAt(p, q.x, q.y, 700);
    u = await ui(page);
    check(u.selectedId === null && (await used(page)).a_sakai === null, `[${kind}] 確かめの 3 秒の後に選んでいる酒井隊を押す → 選択が外れる（使わない）`, `選択 ${u.selectedId}`);

    // 確かめの中に札でほかの部隊を選び直したら、確かめは消える（同じ所をもう一度押しても使わない）。
    // 直す前は、札で選び直した後の同じ画面の点の地面の押し（移動のつもり）が、忠勝の退路の守護になっていた（e2e/fields-ui.mjs の orders で見つかった）
    q = await screenOf(page, 'a_tadakatsu');
    {
        const cs = await covers(page);
        for (let dy = 0; dy <= 12 && cs.some((c) => inBox(c, q.x, q.y)); dy += 3) q = { ...q, y: q.y + 3 };
    }
    await pointAt(p, q.x, q.y, 400);
    u = await ui(page);
    const armedT = await page.evaluate(() => document.querySelector('.b-label[data-id="a_tadakatsu"]')?.textContent ?? '');
    check(u.selectedId === 'a_tadakatsu' && armedT.includes('もう一度'), `[${kind}] 忠勝隊の体を押す → 選ぶ・確かめ`, `選択 ${u.selectedId}・${armedT}`);
    await press(p, '.b-card[data-id="a_yumi"]', 300);
    u = await ui(page);
    const armedT2 = await page.evaluate(() => document.querySelector('.b-label[data-id="a_tadakatsu"]')?.textContent ?? '');
    check(u.selectedId === 'a_yumi' && !armedT2.includes('もう一度'), `[${kind}] 確かめの中に札で弓隊を選び直す → 確かめが消える`, `選択 ${u.selectedId}・${armedT2}`);
    await pointAt(p, q.x, q.y, 700);
    check((await used(page)).a_tadakatsu === null, `[${kind}] 選び直した後に同じ所を押しても、忠勝の退路の守護は使わない`, `選択 ${(await ui(page)).selectedId}`);
    await page.waitForTimeout(3300);

    // ---------------- 4. 酒井の両翼の采配：包囲の条件の状態 ----------------
    const bs = (await label(page, 'a_sakai')).badge;
    await pointAt(p, bs.x, bs.y, 700);
    const t3 = await labelText(page, 'a_sakai');
    check((await used(page)).a_sakai !== null && /包囲なし/.test(t3), `[${kind}] 酒井の印で両翼の采配 → 名札に「包囲なし」（まだ斬り合っていない）`, t3);
    await press(p, '.b-card[data-id="a_sakai"]', 500);
    const st = await page.evaluate(() => document.querySelector('.b-abil .b-ab-st')?.textContent ?? '');
    check(/包囲なし/.test(st), `[${kind}] 能力の欄の状態にも包囲の条件`, st);

    // ---------------- 3. 石川の対象選び ----------------
    await press(p, '.b-zall', 900);
    const bi = (await label(page, 'a_ishikawa')).badge;
    await pointAt(p, bi.x, bi.y, 1200);
    u = await ui(page);
    check(u.pending === 'ability' && u.selectedId === 'a_ishikawa', `[${kind}] 石川の印 → 対象選び`);
    const bl = await blockers(page);
    const targets = await page.evaluate(() => {
        const s = window.__battle.state;
        return [...document.querySelectorAll('.b-label[data-ab="target"], .b-label[data-ab="choosing"]')].map((e) => e.dataset.id).filter((id) => s.units.find((x) => x.id === id));
    });
    const hiddenBy = [];
    for (const id of targets) {
        const lb = await label(page, id);
        if (lb && bl.some((k) => overlap(lb, k))) hiddenBy.push(id);
    }
    await shot(p, 'd-ishikawa-choose');
    check(targets.includes('a_ishikawa') && targets.length >= 2 && hiddenBy.length === 0, `[${kind}] 対象選び：持ち主と選べる対象の名札が画面の部品に隠れない`, `${targets.join(',')}${hiddenBy.length ? ` 隠れる：${hiddenBy.join(',')}` : ''}`);
    const li = await label(page, 'a_ishikawa');
    await page.waitForTimeout(300);
    await pointAt(p, li.x, li.y, 700);
    u = await ui(page);
    check(u.pending === 'none' && (await used(page)).a_ishikawa === null, `[${kind}] 石川の名札をもう一度押す → 対象選びをやめる（回数は減らない）`, `pending ${u.pending}`);

    // 防衛・待機を命じると札が「防衛・待機」
    await press(p, '.b-card[data-id="a_ishikawa"]', 500);
    await press(p, '.b-cmd:has-text("防衛・待機")', 500);
    const o2 = await cardOrd(page, 'a_ishikawa');
    check(o2 === '防衛・待機', `[${kind}] 石川隊に防衛・待機を命じる → 札は「防衛・待機」（武将の判断で動かない）`, o2);

    // ---------------- 6. 「＋」で前線へ ----------------
    await press(p, '.b-zall', 900);
    await press(p, '.b-zoom .b-z:first-child', 900);
    const cam = await page.evaluate(() => window.__battle.camera);
    const fr = await page.evaluate(() => {
        const s = window.__battle.state;
        const pts = s.units.filter((u) => u.present && u.status === 'ready').map((u) => window.__battle.screenOf(u.id));
        return { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length, w: innerWidth, h: innerHeight };
    });
    check(Math.abs(fr.x - fr.w / 2) < fr.w * 0.12 && Math.abs(fr.y - fr.h / 2) < fr.h * 0.2 && cam.zoomRatio < 0.8, `[${kind}] 全体から「＋」→ 両軍の真ん中（前線）へ寄る`, `真ん中 (${Math.round(fr.x)},${Math.round(fr.y)})・寄り ${cam.zoomRatio.toFixed(2)}`);
    check(!(await page.evaluate(() => document.querySelector('.b-labels')?.classList.contains('far'))), `[${kind}] 寄ると名札は元の大きさ`);
    await shot(p, 'e-zoom-front');
    await p.ctx.close();
}

for (const kind of KINDS) {
    log(`== ${kind}`);
    await run(kind);
}
await b.close();
log(failures.length ? `NG ${failures.length} 件：\n- ${failures.join('\n- ')}` : 'すべて ok');
process.exit(failures.length ? 1 : 0);
