/**
 * 第3群 5 戦場（11〜15）と先に整えた操作の統合の通しの確認（docs/fields-group3-request.md【確認】・docs/fields-group3-design.md §5）。
 *   BASE3D=http://localhost:8304 BASE=http://localhost:8304 node e2e/fields-group3.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/fields-group3）
 *   PARTS=start,phone,gate,village,labels,conflict で一部だけ（既定はすべて）。FIELDS=village,siege_front で第3群の戦場を絞る（start・phone・labels）。
 *
 * a. start（PC 1280×720・マウス）：タイトル →「合戦場の演習」→ 一覧に 15 戦場 → 戦場ごとに「出陣」→ 合戦の画面。
 *    第3群の 5 戦場では続けて：味方の部隊を地図の上の体を押してそれぞれ選ぶ（漏れない）・選んだ部隊へ地面の押しで移動の命令・
 *    点滅する名札（止めていても明るさが変わる）・印 1 回で能力（漏れない）。終わりは全軍撤退 → 早送り → 結果 → 演習の結果 → 一覧（どれもクリック）。
 *    phone（スマホ横 844×390・タッチ）：第3群の 5 戦場を、タイトルからタップで始め、上と同じ確かめをタップで。
 * b. gate（PC。城攻め前面）：
 *    - 説明の画面・目標の進みの文・地図の名札に、門の制圧の条件（輪を敵なしで 20 秒）が出る。
 *    - 閉じている間：騎馬隊へ「移動」→ 曲輪の中の地面を押す → 道が門を通らない（道が無い＝まっすぐ）・60 秒たっても石垣・門の南のまま（門の前で止まる）。
 *    - 急いで門へ（tests/proto3d-field-siege_front.test.ts の RUSH と同じ命令）を、1 秒ごとに状態を見て画面の操作（札・攻撃・移動・印・地図の押し）で出す。
 *      出張りが崩れたら輪を占める。そのとき榊原隊へ曲輪の中への移動を先に出しておく（門の前で待つ）。輪を画面の命令で占めると門が開く
 *      （進みの文に制圧の秒が出る）→ 榊原隊は押し直さずに門をくぐって曲輪へ入る（道が引き直される）。決着まで続けて結果を記録する。
 * c. village（PC。村落）：西の辻に二隊（テストの POST。命令 10 回）を画面の操作で出し、決着まで早送り。家屋の陰へ弓を置く台本（SHADE）を 330 秒まで。
 *    刻みごとの見張り（読むだけ）：建物・柵・石垣・閉じた門の中へ入る部隊が無い・射る相手と斬り合う相手はどれも射線が通る（計画を立てた位置で）・
 *    射程の中に見えている敵がいても射線が通らない刻みを数える（家の陰の相手を射ない）・移動／攻撃の命令のまま 10 秒以上 1.5 m も動かない部隊
 *    （斬り合い・射撃・順番待ち・道の無い行き先を除く）が出ない。b の城攻め前面の通しにも同じ見張りを付ける。
 * d. labels（PC とスマホ相当。第3群の 5 戦場）：「全体」で引いた始めの画面と、交戦中（斬り合う部隊が 4 つ以上・最長 240 秒）の画面で、
 *    見えている地図の名札（地形・目標・門・援軍・退き口・狭い正面）どうしが重ならない・地図の名札と操作の要らない表示が押しを奪わない・
 *    点滅する印が押しを奪う部品（目標の欄・札など）に覆われない。地図の名札の上を押すと、その下の地面へ移動の命令が出る（名札は押しを通す）。
 * e. conflict（PC とスマホ相当。村落）：移動先指定の間に能力の印 → 能力（移動にならない）・移動先指定で味方の立つ所を押す → その点へ移動
 *    （選び直さない）・石川の対象選びの間に味方を押す → 差配（選び直し・移動に漏れない）。
 * f. 号令（e と同じ頁）：始め（家康本陣の士気 90）は点滅する。直接操作で味方の士気をみな 100 にする（敵はまだ来ていない）→ 点滅しない・札「号令 ―」・
 *    前に印のあった所を押しても使わない・「能力」（PC は F）で理由が出て使わない。早送りで第一波が近づく（直接操作なし）→ 敵が近い部隊を見て点滅が戻り、印で使える。
 * g. 撮影：出力先に置く（PNG）。record.json に数字。
 *
 * 確認の種類：
 * - 本物の入力：タイトルからの画面の移り・札・地図の押し（体・地面・敵・名札）・命令のボタン・名札の印・キー（M・F）・全軍撤退・結果の画面のボタン。
 * - 早送り：待ち時間（window.__battle.fastForward。合戦の時間を進めるだけ）。台本の通しは「1 秒ごとに状態を見て、画面の操作で押す」。
 * - 読むだけ：window.__battle.state・ui・labelOf・labelCovers・screenOf・screenOfGround・effectTargets、sim.ts の hasLineOfSight（見張り）。カメラは centerOn（表示だけ）。
 * - 状態を直接操作：f の「味方の士気をみな 100 にする」だけ（ログに「直接操作」と書く）。
 * - 実機・性能：未確認（コンテナはソフトウェア描画）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8304';
const OUT = process.argv[2] || 'e2e-out/fields-group3';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'start,phone,gate,village,labels,conflict').split(',');
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy', 'marsh', 'village', 'temple', 'town_edge', 'siege_front'];
const GROUP3 = (process.env.FIELDS || 'marsh,village,temple,town_edge,siege_front').split(',');
const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const failures = [];
const record = { fields: {}, gate: null, village: {}, labels: {}, conflict: {} };
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 600000, polling: 250 };
const r1 = (x) => Math.round(x * 10) / 10;

const b = await launchBrowser();

function watchPage(page) {
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
}
const ctxOpts = (phone) => (phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });

async function openTitle(kind) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(ctxOpts(phone));
    const page = await ctx.newPage();
    watchPage(page);
    const t0 = Date.now();
    await page.goto(`${BASE}/?q=low`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    log(`[${kind}] タイトルまで ${Date.now() - t0} ms`);
    return { ctx, page, phone, kind };
}
/** 開発用の入口（演習と同じ buildBattleSetup(戦場, 'standard')）。「出陣」→「指揮」で止めた所まで */
async function openField(kind, id) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(ctxOpts(phone));
    const page = await ctx.newPage();
    watchPage(page);
    await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    const p = { ctx, page, phone, kind };
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-primary', 300);
    await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    check((await ui(page)).paused && (await page.evaluate(() => window.__battle.state.map.id)) === id, `[${kind}] ${id}：開発用の入口で「出陣」→「指揮」で止めた`);
    return p;
}

/** シートのボタン（出たばかりのボタンは決まらない：ui/guard.ts）。少し待ってから */
async function press(p, sel) {
    await p.page.waitForTimeout(450);
    await p.page.locator(sel).first().scrollIntoViewIfNeeded();
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
}
/** 合戦の画面のボタン */
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
const waitSheet = (page, name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
const ui = (page) => page.evaluate(() => window.__battle.ui);
const simT = (page) => page.evaluate(() => window.__battle.state.t);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s, window.__g3mon?.tick), sec);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, side: u.side, order: u.order, status: u.status, present: u.present, seen: !!u.seenBy.ally, str: u.strength, str0: u.startStrength, mor: u.morale, eng: u.engagedWith, path: u.path && { none: !!u.path.none, pts: u.path.pts.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10]) } };
    }, id);
const orderOf = async (page, id) => (await unit(page, id))?.order;
const used = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__battle.state.abilities).map(([k, r]) => [k, r.usedAt])));
const ab = (page, id) => page.evaluate((id) => { const r = window.__battle.state.abilities[id]; return r && { usedAt: r.usedAt, targetId: r.targetId }; }, id);
const fits = (page) => page.evaluate(() => window.__battle.labelFits());
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const hitAt = (page, x, y) => page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [x, y]);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const cardAbl = (page, id) => page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"] .b-abl`)?.textContent ?? '', id);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => `${u.id}:${u.x.toFixed(2)},${u.z.toFixed(2)}:${JSON.stringify(u.order)}`).join('|'));
const snapUnits = (page) => page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, x: +u.x.toFixed(3), z: +u.z.toFixed(3), order: JSON.stringify(u.order) })));
function changedExcept(a, c, except) {
    const bad = [];
    for (const u of a) {
        if (except.includes(u.id)) continue;
        const v = c.find((x) => x.id === u.id);
        if (!v || v.x !== u.x || v.z !== u.z || v.order !== u.order) bad.push(u.id);
    }
    return bad;
}
/** 画面の点の下の地面（読むだけ） */
const groundUnder = (page, x, y) =>
    page.evaluate(([x, y]) => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return window.__battle.view.groundAt(x - r.left, y - r.top);
    }, [x, y]);
/** 通れる所か（sim.ts の passableAt。読むだけ） */
const passable = (page, x, z) => page.evaluate(async ([x, z]) => (await import('/src/battle/sim.ts')).passableAt(window.__battle.state, x, z), [x, z]);
const inBox = (q, x, y) => x >= q.l && x <= q.r && y >= q.t && y <= q.b;
const overlap = (a, c, m = 0.5) => a.l < c.r - m && a.r > c.l + m && a.t < c.b - m && a.b > c.t + m;
async function shot(p, name) {
    await p.page.waitForTimeout(500);
    await p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
    log(`   撮影 ${p.kind}-${name}`);
}
const center = (p, x, z, d) => p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d ?? undefined), [x, z, d ?? null]);

// ================================================================ 画面の移り（タイトル → 一覧 → 出陣 → 結果 → 一覧）

async function titleToList(p) {
    await press(p, '[data-id="practice"]');
    await waitSheet(p.page, 'practice-list');
    await p.page.waitForTimeout(300);
    const fields = await p.page.evaluate(() => [...document.querySelectorAll('.g-pr-field')].map((e) => e.dataset.field));
    check(JSON.stringify(fields) === JSON.stringify(FIELD_IDS), `[${p.kind}] タイトル →「合戦場の演習」→ 一覧に 15 戦場（第1群 5・第2群 5・第3群 5）`, fields.join(','));
}

/** 一覧 → 説明 → 出陣 → 合戦の画面 → 開始して「指揮」で止める（開始の瞬間だけ時の進みを 0。止めた後に ×1 へ戻す）。説明の文を返す */
async function listToBattle(p, id) {
    const { page, kind } = p;
    await press(p, `[data-id="field:${id}"]`);
    await waitSheet(page, 'practice-briefing');
    const brief = await page.evaluate(() => ({
        primary: document.querySelector('.g-pr-brief [data-objective="primary"]')?.textContent ?? '',
        secondary: document.querySelectorAll('.g-pr-brief [data-objective="secondary"]').length,
        units: document.querySelectorAll('.g-pr-units tr[data-unit]').length,
        text: document.querySelector('.g-layer[data-sheet="practice-briefing"]')?.innerText ?? '',
    }));
    const t0 = Date.now();
    await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    const s = await page.evaluate(() => ({
        map: window.__battle.state.map.id,
        allies: window.__battle.state.units.filter((u) => u.side === 'ally').length,
        enemies: window.__battle.state.units.filter((u) => u.side === 'enemy').length,
        practice: window.__practice.screen,
    }));
    check(s.map === id && s.practice === 'battle' && s.allies === brief.units && s.enemies > 0 && brief.primary.length > 0 && brief.secondary >= 1,
        `[${kind}] ${id}：説明（主目標・副目標が別の行）→「出陣」→ 合戦の画面`, `${Date.now() - t0} ms・味方 ${s.allies}・敵 ${s.enemies}・主目標「${brief.primary.slice(0, 30)}」`);
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-primary', 300);
    await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    const u = await ui(page);
    const nCards = await page.evaluate(() => document.querySelectorAll('.b-card').length);
    check(u.started && u.paused && nCards === s.allies, `[${kind}] ${id}：開始して「指揮」で止めた（札 ${nCards} 枚）`, `t=${await simT(page)}`);
    return { ...s, brief };
}

async function retreatAndFinish(p) {
    await bpress(p, '.b-allret', 300);
    await p.page.waitForSelector('.b-modal .b-primary', { timeout: 30000 });
    await bpress(p, '.b-modal .b-primary', 300);
    const r = await p.page.evaluate(() => window.__battle.state.allRetreatAt);
    check(r !== null, `[${p.kind}] 全軍撤退のボタン → 確かめ → 全軍撤退が始まる`);
    await finish(p);
}
async function finish(p, max = 900) {
    for (let i = 0; i < max / 30 && !(await p.page.evaluate(() => window.__battle.state.result)); i++) await ff(p.page, 30);
}

/** 合戦の結果の画面 →「続ける」→ 演習の結果 →「一覧へ」。結果の行を返す */
async function resultToList(p, id, name) {
    const { page, kind } = p;
    if ((await ui(page)).paused) await bpress(p, '.b-pause', 200);
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
        const s = window.__battle.state;
        const al = s.units.filter((u) => u.side === 'ally');
        return {
            result: s.result?.result ?? null,
            reason: s.result?.reason ?? null,
            t: s.t,
            loss: 1 - al.reduce((a, u) => a + u.strength, 0) / al.reduce((a, u) => a + u.startStrength, 0),
            left: al.filter((u) => u.status === 'ready' && u.present).length,
            rows: [...document.querySelectorAll('.b-robj-row')].map((r) => ({ role: r.dataset.role, achieved: r.dataset.achieved, text: r.textContent.trim() })),
        };
    });
    check(res.rows.length >= 2 && res.rows[0].role === 'primary' && res.rows.slice(1).every((r) => r.role === 'secondary'), `[${kind}] ${id}：合戦の結果の画面に勝敗と別の行で主目標・副目標`, res.rows.map((r) => `${r.role}:${r.achieved}`).join(' '));
    if (name) await shot(p, name);
    await press(p, '.b-primary');
    await waitSheet(page, 'practice-result');
    await page.waitForTimeout(300);
    const pr = await page.evaluate((id) => ({
        outcome: document.querySelector('.g-pr-result [data-outcome]')?.dataset.outcome,
        primary: document.querySelector('.g-pr-result [data-objective="primary"]')?.dataset.achieved,
        secondary: [...document.querySelectorAll('.g-pr-result [data-objective="secondary"]')].map((e) => e.dataset.achieved),
        saved: document.querySelector('.g-pr-result [data-saved]')?.dataset.saved,
        rec: window.__practice.records?.status === 'ok' ? window.__practice.records.data.records[id]?.last?.result : null,
    }), id);
    check(pr.outcome === res.result && pr.saved === 'true' && pr.rec === res.result && pr.secondary.length === res.rows.length - 1, `[${kind}] ${id}：演習の結果（勝敗・主目標・副目標が別の行・保存）`, JSON.stringify(pr));
    if (name) await shot(p, `${name}-practice`);
    await press(p, '.g-layer[data-sheet="practice-result"] [data-id="list"]');
    await waitSheet(page, 'practice-list');
    return { ...res, primary: pr.primary, secondary: pr.secondary };
}

// ================================================================ 地図の押し

async function bodyPoint(p, id) {
    const s = await p.page.evaluate((id) => window.__battle.screenOf(id), id);
    if (!s) return null;
    const cs = await covers(p.page);
    let q = { x: s.x, y: s.y };
    for (let dy = 0; dy <= 18 && cs.some((c) => inBox(c, q.x, q.y)); dy += 3) q = { x: s.x, y: s.y + dy };
    return { ...q, shown: s.shown };
}
async function clickUnit(p, id, dist) {
    const u = await unit(p.page, id);
    await center(p, u.x, u.z, dist);
    await p.page.waitForTimeout(250);
    const q = await bodyPoint(p, id);
    await pointAt(p, q.x, q.y, 300);
}
async function clickGround(p, x, z, dist) {
    await center(p, x, z, dist ?? 260);
    await p.page.waitForTimeout(250);
    const g = await p.page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
    await pointAt(p, g.x, g.y, 300);
}
/** 札で選ぶ（2 回目の札の押しは「その部隊へ寄る」なので、選べていれば押さない） */
async function card(p, id) {
    if ((await ui(p.page)).selectedId === id) return true;
    await bpress(p, `.b-card[data-id="${id}"]`, 200);
    return (await ui(p.page)).selectedId === id;
}
async function moveMode(p) {
    if (p.phone) await bpress(p, '.b-cmd:has-text("移動")', 300);
    else {
        await p.page.keyboard.press('KeyM');
        await p.page.waitForTimeout(300);
    }
}
const movedTo = (o, g, m = 6) => o?.type === 'move' && g && Math.hypot(o.x - g.x, o.z - g.z) < m;

// ================================================================ 名札

async function readyState(page) {
    return page.evaluate(() => {
        const cs = window.__battle.labelCovers();
        const out = [];
        for (const f of window.__battle.labelFits()) {
            if (f.ab !== 'ready' || !f.shown) continue;
            const lb = window.__battle.labelOf(f.id);
            const g = lb?.badge ?? null;
            const coveredBy = g ? cs.filter((o) => o.id !== f.id && o.l < g.r - 0.5 && o.r > g.l + 0.5 && o.t < g.b - 0.5 && o.b > g.t + 0.5).map((o) => o.id) : [];
            const hit = g ? window.__battle.labelHitAt(g.x, g.y) : null;
            out.push({ id: f.id, fit: f.fit, badge: g, coveredBy, hit });
        }
        return out;
    });
}
async function pressBadge(p, id, dist) {
    const { page } = p;
    const u = await unit(page, id);
    await center(p, u.x, u.z, dist);
    await page.waitForTimeout(500);
    const lb = await label(page, id);
    if (!lb?.badge) return { ok: false, why: `印が無い（${JSON.stringify(lb)}）` };
    const hit = await hitAt(page, lb.badge.x, lb.badge.y);
    const before = await snapshot(page);
    const sel0 = (await ui(page)).selectedId;
    await pointAt(p, lb.badge.x, lb.badge.y, 700);
    const after = await snapshot(page);
    const sel1 = (await ui(page)).selectedId;
    const usedAt = (await used(page))[id];
    return { ok: usedAt !== null, hit, leak: before !== after, selKept: sel0 === sel1, sel0, sel1, usedAt };
}

// ================================================================ a. 第3群の戦場：選ぶ・動かす・能力

async function group3Checks(p, id) {
    const { page, kind } = p;
    const rec = (record.fields[`${kind}-${id}`] = {});
    const D = p.phone ? 150 : 180;
    const allies = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally' && u.present && u.status === 'ready').map((u) => u.id));
    let okSel = 0;
    const bad = [];
    for (const aid of allies) {
        const before = await snapshot(page);
        await clickUnit(p, aid, D);
        const u = await ui(page);
        if (u.selectedId === aid && before === (await snapshot(page))) okSel++;
        else bad.push(`${aid}→${u.selectedId}`);
    }
    check(okSel === allies.length, `[${kind}] ${id}：味方 ${allies.length} 部隊を地図の上の体を押してそれぞれ選べる（命令・位置に漏れない）`, bad.join(' '));
    rec.selected = `${okSel}/${allies.length}`;
    // 地図の上で選んだ部隊（忠勝隊）へ、地面を押して移動（通れる所で、敵・味方から離れた所）
    const mover = allies.includes('a_tadakatsu') ? 'a_tadakatsu' : allies[0];
    await clickUnit(p, mover, D);
    check((await ui(page)).selectedId === mover, `[${kind}] ${id}：${mover}を地図の上で選ぶ`);
    const st = await page.evaluate(() => window.__battle.state.units.filter((u) => u.present && u.status !== 'destroyed').map((u) => ({ id: u.id, x: u.x, z: u.z, side: u.side })));
    const me = st.find((u) => u.id === mover);
    const cands = [];
    for (const r of [25, 35, 18]) for (const a of [0, 1, 7, 2, 6, 3, 5, 4]) cands.push({ x: me.x + r * Math.sin((a * Math.PI) / 4), z: me.z + r * Math.cos((a * Math.PI) / 4) });
    const good = [];
    for (const c of cands) {
        if (!st.every((u) => u.id === mover || Math.hypot(u.x - c.x, u.z - c.z) > (u.side === 'enemy' ? 60 : 16))) continue;
        // 押す点のまわり 6 m も通れる（建物の縁の近くを押して、近くの通れる所へ直される点を避ける）
        let ok = await passable(page, c.x, c.z);
        for (let k = 0; ok && k < 4; k++) ok = await passable(page, c.x + 6 * Math.sin((k * Math.PI) / 2), c.z + 6 * Math.cos((k * Math.PI) / 2));
        if (ok) good.push(c);
        if (good.length >= 6) break;
    }
    let moved = null;
    for (const c of good) {
        await clickGround(p, c.x, c.z, D);
        const o = await orderOf(page, mover);
        if (o.type === 'move' && Math.hypot(o.x - c.x, o.z - c.z) < 6) {
            moved = { ...c, o };
            break;
        }
        if ((await ui(page)).selectedId !== mover) await clickUnit(p, mover, D);
    }
    check(!!moved, `[${kind}] ${id}：地面を押して${mover}へ移動の命令`, moved ? `(${r1(moved.x)}, ${r1(moved.z)})` : `候補 ${good.length}`);
    rec.move = moved && [r1(moved.x), r1(moved.z)];
    // 能力の名札の点滅と、印の 1 回の押し（石川は対象選びになるので、ほかの武将）
    const f = await fits(page);
    const ready = f.filter((x) => x.ab === 'ready').map((x) => x.id);
    check(ready.length >= 3 && ready.every((x) => GENERALS.includes(x)), `[${kind}] ${id}：使える武将の名札が点滅している（徳川の武将だけ）`, ready.join(','));
    rec.ready = ready;
    const user = ['a_sakai', 'a_tadakatsu', 'a_sakakibara', 'a_ieyasu'].find((x) => ready.includes(x));
    if (user) {
        const u = await unit(page, user);
        await center(p, u.x, u.z, D);
        const b1 = (await label(page, user))?.blink;
        await page.waitForTimeout(450);
        const b2 = (await label(page, user))?.blink;
        check(b1 !== undefined && b1 !== b2, `[${kind}] ${id}：止めたままでも${user}の名札の明るさが変わる（点滅）`, `${b1} → ${b2}`);
        const r = await pressBadge(p, user, D);
        check(r.ok && r.hit?.id === user && r.hit?.part === 'badge' && !r.leak && r.selKept, `[${kind}] ${id}：${user}の名札の印を 1 回押す → 能力を使う（選択・全部隊の位置と命令に漏れない）`, JSON.stringify({ hit: r.hit, leak: r.leak, sel: [r.sel0, r.sel1], why: r.why }));
        rec.ability = user;
        await shot(p, `${id}-ability`);
    }
}

async function startPart() {
    const p = await openTitle('desktop');
    await titleToList(p);
    await p.page.screenshot({ path: `${OUT}/desktop-list.png` });
    for (const id of FIELD_IDS) {
        await listToBattle(p, id);
        if (GROUP3.includes(id)) {
            await shot(p, `${id}-start`);
            await group3Checks(p, id);
        }
        await retreatAndFinish(p);
        await resultToList(p, id);
    }
    await p.ctx.close();
}

async function phonePart() {
    const p = await openTitle('phone');
    await titleToList(p);
    for (const id of GROUP3) {
        await listToBattle(p, id);
        await shot(p, `${id}-start`);
        await group3Checks(p, id);
        await retreatAndFinish(p);
        await resultToList(p, id);
    }
    await p.ctx.close();
}

// ================================================================ 見張り（読むだけ）：障害物の中・射線・動かない部隊

/**
 * 刻みごとに呼ぶ見張りを頁に置く（window.__g3mon.tick を fastForward の台本に渡す。状態は読むだけ）。
 * - inside：戦える部隊の真ん中が、道探しの格子で通れない升にいる（sim.ts の passableAt）か、建物・柵・石垣・閉じた門の四角・円の 2.5 m 内側に
 *   入った（格子は 5 m 升で、家屋の縁が升の線からずれていると、通れる升の端が縁から最大 2.5 m 内側に入る。敗走中の部隊も四角・円で見る）
 * - losBad／meleeBad：射る相手・斬り合う相手への射線が通らない（前の刻みの位置＝その刻みの計画を立てた位置で見る）
 * - blockedInRange：弓の部隊が、射程の中に見えている敵がいるのに射線が通らなかった刻みの数（部隊ごと）
 * - stuck：移動・攻撃の命令のまま、斬り合い・射撃なしで 10 秒以上 1.5 m も動かない（行き先まで 8 m より遠い）。
 *   順番待ち（攻撃の相手が 45 m 以内で味方と斬り合っている）・道の無い行き先（閉じた門の向こう）は分けて数える
 */
async function installMonitor(page, tag) {
    await page.evaluate(async (tag) => {
        const sim = await import('/src/battle/sim.ts');
        const s0 = window.__battle.state;
        const KINDS = ['building', 'fence', 'wall'];
        const obst = s0.map.terrain.filter((a) => KINDS.includes(a.kind));
        const inA = (a, x, z, m) =>
            a.rect ? x > a.rect.x0 + m && x < a.rect.x1 - m && z > a.rect.z0 + m && z < a.rect.z1 - m : a.circle ? Math.hypot(x - a.circle.cx, z - a.circle.cz) < a.circle.r - m : false;
        const M = { tag, ticks: 0, insideN: 0, inside: [], losBad: [], meleeBad: [], shots: 0, melees: 0, blockedInRange: {}, shotAt: {}, shotLog: [], blockedLog: [], underAttack: {}, still: {}, stuck: [], queue: [], blockedGoal: [], prev: null, capsules: obst.filter((a) => a.capsule).length };
        const d = (a, c) => Math.hypot(a.x - c.x, a.z - c.z);
        M.tick = (st) => {
            M.ticks++;
            const prev = M.prev;
            const by = new Map(st.units.map((u) => [u.id, u]));
            for (const u of st.units) {
                if (!u.present || (u.status !== 'ready' && u.status !== 'routed')) continue;
                const hit =
                    obst.find((a) => inA(a, u.x, u.z, 2.5)) ??
                    (st.field.gates.some((g) => !g.open && inA({ rect: g.def.rect }, u.x, u.z, 2.5)) ? { kind: 'gate' } : null) ??
                    (u.status === 'ready' && !sim.passableAt(st, u.x, u.z) ? { kind: '通れない升' } : null);
                if (hit) {
                    M.insideN++;
                    if (M.inside.length < 20) M.inside.push(`${u.id}@${u.x.toFixed(1)},${u.z.toFixed(1)}(${hit.kind}) t=${st.t.toFixed(1)}`);
                }
                if (u.status !== 'ready' || !prev) continue;
                const p0 = prev.get(u.id);
                if (!p0) continue;
                if (u.shootingAt) {
                    M.shots++;
                    if (u.side === 'ally' && M.shotLog.length < 8000) {
                        const q = by.get(u.shootingAt);
                        if (q) M.shotLog.push([u.id, +st.t.toFixed(1), u.shootingAt, +q.x.toFixed(1), +q.z.toFixed(1)]);
                    }
                    const q = prev.get(u.shootingAt);
                    M.shotAt[u.id] = M.shotAt[u.id] ?? {};
                    M.shotAt[u.id][u.shootingAt] = (M.shotAt[u.id][u.shootingAt] ?? 0) + 1;
                    if (q && !sim.hasLineOfSight(st, p0, q) && M.losBad.length < 20) M.losBad.push(`${u.id}→${u.shootingAt} t=${st.t.toFixed(1)} (${p0.x.toFixed(0)},${p0.z.toFixed(0)})→(${q.x.toFixed(0)},${q.z.toFixed(0)})`);
                }
                if (u.engagedWith) {
                    M.melees++;
                    const q = prev.get(u.engagedWith);
                    if (q && !sim.hasLineOfSight(st, p0, q) && M.meleeBad.length < 20) M.meleeBad.push(`${u.id}×${u.engagedWith} t=${st.t.toFixed(1)}`);
                }
                if (u.kind === 'yumi' && st.field.los) {
                    // 射程の中の敵で射線が通らない（建物・石垣の陰）。見えているか（seen）も書く（陰の相手はふつう見えていない）
                    for (const e of st.units) {
                        if (e.side === u.side || !e.present || e.status !== 'ready') continue;
                        const q = prev.get(e.id);
                        if (!q || d(p0, q) > sim.bowRangeFor(st, p0, q)) continue;
                        if (!sim.hasLineOfSight(st, p0, q)) {
                            if (e.seenBy[u.side]) M.blockedInRange[u.id] = (M.blockedInRange[u.id] ?? 0) + 1;
                            if (u.side === 'ally' && M.blockedLog.length < 20000) M.blockedLog.push([u.id, +st.t.toFixed(1), e.id, +q.x.toFixed(1), +q.z.toFixed(1), e.seenBy[u.side] ? 1 : 0]);
                        }
                    }
                }
                // 動かない部隊
                const o = u.order;
                const tgt = o.type === 'attack' ? by.get(o.targetId) : null;
                const goal = o.type === 'move' ? o : tgt && tgt.present && tgt.status === 'ready' ? tgt : null;
                const a = M.still[u.id];
                // 止まっていた間の長さ（動き出した・斬り合った・命令が変わった時に書く）
                const close = () => {
                    if (a?.ev && a.ev.dur === null) a.ev.dur = +(st.t - a.t).toFixed(1);
                };
                // 斬りかかられている（相手の部隊が自分と斬り合っている。自分は命令の相手へ向かうので斬り返さない：側面・背後から突かれた）
                const hitBy = st.units.find((o) => o.side !== u.side && o.present && o.status === 'ready' && o.engagedWith === u.id);
                if (!goal || u.engagedWith || u.shootingAt || hitBy) {
                    if (hitBy && goal && !u.engagedWith && !u.moving) M.underAttack[u.id] = (M.underAttack[u.id] ?? 0) + 1;
                    close();
                    delete M.still[u.id];
                    continue;
                }
                const oj = JSON.stringify(o);
                if (!a || d(a, u) > 1.5 || a.order !== oj) {
                    close();
                    M.still[u.id] = { x: u.x, z: u.z, t: st.t, order: oj, done: false };
                    continue;
                }
                if (a.done || st.t - a.t < 10 || d(u, goal) <= 8) continue;
                a.done = true;
                const ev = { id: u.id, t: +a.t.toFixed(1), x: +u.x.toFixed(1), z: +u.z.toFixed(1), order: oj, goalDist: +d(u, goal).toFixed(1), dur: null };
                a.ev = ev;
                if (tgt && tgt.engagedWith && by.get(tgt.engagedWith)?.side === u.side && d(u, tgt) < 45) M.queue.push(ev);
                else if (u.path?.none) M.blockedGoal.push(ev);
                else M.stuck.push(ev);
            }
            // 崩れた・退いた部隊の見張りを閉じる
            for (const [id, a] of Object.entries(M.still)) {
                const u = by.get(id);
                if (u && u.present && u.status === 'ready') continue;
                if (a.ev && a.ev.dur === null) a.ev.dur = +(st.t - a.t).toFixed(1);
                delete M.still[id];
            }
            M.prev = new Map(st.units.map((u) => [u.id, { x: u.x, z: u.z }]));
        };
        window.__g3mon = M;
    }, tag);
}
const monitor = (page) =>
    page.evaluate(() => {
        const M = window.__g3mon;
        return { tag: M.tag, ticks: M.ticks, insideN: M.insideN, inside: M.inside, losBad: M.losBad, meleeBad: M.meleeBad, shots: M.shots, melees: M.melees, blockedInRange: M.blockedInRange, shotAt: M.shotAt, shotLog: M.shotLog, blockedLog: M.blockedLog, underAttack: M.underAttack, stuck: M.stuck, queue: M.queue, blockedGoal: M.blockedGoal, capsules: M.capsules };
    });
function checkMonitor(kind, tag, m) {
    check(m.insideN === 0, `[${kind}] ${tag}：建物・柵・石垣・閉じた門の中・通れない升へ入った部隊なし（${m.ticks} 刻み）`, m.inside.slice(0, 5).join(' '));
    if (m.capsules) log(`    （記録）カプセルの形の障害物 ${m.capsules} 個は四角・円の見張りでは見ない（通れない升の見張りだけ）`);
    check(m.losBad.length === 0 && m.shots > 0, `[${kind}] ${tag}：射る相手はどれも射線が通る（射撃 ${m.shots} 刻み）`, m.losBad.slice(0, 5).join(' '));
    check(m.meleeBad.length === 0, `[${kind}] ${tag}：斬り合う相手はどれも射線が通る（建物・石垣を挟んで斬り合わない。斬り合い ${m.melees} 刻み）`, m.meleeBad.slice(0, 5).join(' '));
    check(m.stuck.length === 0, `[${kind}] ${tag}：移動・攻撃の命令のまま 10 秒以上動かない部隊なし（順番待ち ${m.queue.length}・道の無い行き先 ${m.blockedGoal.length} は別に記録）`, JSON.stringify(m.stuck.slice(0, 5)));
    if (m.queue.length) log(`    （記録）順番待ち：${m.queue.map((e) => `${e.id} ${e.t} 秒 (${e.x},${e.z})`).join('／')}`);
    if (m.blockedGoal.length) log(`    （記録）道の無い行き先で待つ：${m.blockedGoal.map((e) => `${e.id} ${e.t} 秒 (${e.x},${e.z})`).join('／')}`);
    log(`    射線が通らず射なかった刻み（弓・見えている敵）：${JSON.stringify(m.blockedInRange)}`);
    if (Object.keys(m.underAttack).length) log(`    （記録）命令の相手へ向かう途中で側面・背後から斬りかかられ、斬り返さずに止まっていた刻み：${JSON.stringify(m.underAttack)}`);
}

// ================================================================ 画面の命令（台本の 1 行）

/** 「攻撃」→ 敵を押す */
async function cmdAttack(p, id, target) {
    const { page } = p;
    if (!(await card(p, id))) return { ok: false, why: `札で選べない（${(await ui(page)).selectedId}）` };
    const tu = await unit(page, target);
    if (!tu?.seen || tu.status !== 'ready' || !tu.present) return { ok: false, why: `${target}が見えていない・戦えない` };
    await bpress(p, '.b-cmd:has-text("攻撃")', 150);
    await clickUnit(p, target, 220);
    const o = await orderOf(page, id);
    return { ok: o.type === 'attack' && o.targetId === target, what: `「攻撃」→ ${target}`, o };
}
/** 「移動」→ 地面を押す（移動先指定。味方の立つ所でも選び直さない） */
async function cmdMove(p, id, x, z, tol = 6) {
    const { page } = p;
    if (!(await card(p, id))) return { ok: false, why: `札で選べない（${(await ui(page)).selectedId}）` };
    await bpress(p, '.b-cmd:has-text("移動")', 150);
    await clickGround(p, x, z, 240);
    const o = await orderOf(page, id);
    return { ok: o.type === 'move' && Math.hypot(o.x - x, o.z - z) < tol && (await ui(page)).selectedId === id, what: `「移動」→ 地面 (${x},${z})`, o };
}
/** 地面を押す（台本の tap：押す点の 20 m 以内に見えている敵がいれば、その敵を押す＝攻撃。テストの tapOrder と同じ） */
async function cmdTap(p, id, x, z, tol = 6) {
    const e = await p.page.evaluate(([x, z]) => {
        const q = window.__battle.state.units
            .filter((u) => u.side === 'enemy' && u.present && u.status === 'ready' && u.seenBy.ally && Math.hypot(u.x - x, u.z - z) <= 20)
            .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
        return q?.id ?? null;
    }, [x, z]);
    if (e) return cmdAttack(p, id, e);
    return cmdMove(p, id, x, z, tol);
}
/** 対象を選ぶ能力：名札の印 → 対象の体を押す */
async function cmdAbilityOn(p, user, target) {
    const { page } = p;
    const u = await unit(page, user);
    await center(p, u.x, u.z, 220);
    await page.waitForTimeout(400);
    const lb = await label(page, user);
    if (!lb?.badge || lb.ab !== 'ready') return { ok: false, why: `${user}の印が使えない（${lb?.ab}）` };
    await pointAt(p, lb.badge.x, lb.badge.y, 400);
    if ((await ui(page)).pending !== 'ability') return { ok: false, why: '対象選びにならない' };
    await clickUnit(p, target, 220);
    const r = await ab(page, user);
    return { ok: r.usedAt !== null && r.targetId === target, what: `${user}の印 → ${target}の体`, r };
}
async function doCmd(p, id, cmd, tag) {
    const r = cmd[0] === 'attack' ? await cmdAttack(p, id, cmd[1]) : cmd[0] === 'move' ? await cmdMove(p, id, cmd[1], cmd[2], cmd[3]) : cmd[0] === 'tap' ? await cmdTap(p, id, cmd[1], cmd[2], cmd[3]) : await cmdAbilityOn(p, id, cmd[1]);
    check(r.ok, `[${p.kind}] ${tag}：${r1(await simT(p.page))} 秒 ${id} ← ${r.what ?? cmd[0]}`, r.ok ? '' : JSON.stringify(r));
    return r;
}

// ================================================================ b. 門（城攻め前面）

/** 状態を読む（1 秒ごと） */
const siegeState = (page) =>
    page.evaluate(() => {
        const s = window.__battle.state;
        const ok = (id) => { const u = s.units.find((x) => x.id === id); return !!u && u.present && u.status === 'ready'; };
        const g = s.field.gates[0];
        const u = (id) => s.units.find((x) => x.id === id);
        return {
            t: s.t,
            result: s.result?.result ?? null,
            open: g.open,
            sec: g.sec,
            sortie: ok('e_sortie'),
            guard: ok('e_gate_guard'),
            inner: ok('e_inner'),
            tadEngGuard: u('a_tadakatsu')?.engagedWith === 'e_gate_guard',
            sum: document.querySelector('.b-goals-sum')?.textContent ?? '',
        };
    });

async function gatePart() {
    const p = await openTitle('desktop');
    const { page, kind } = p;
    await titleToList(p);
    const s = await listToBattle(p, 'siege_front');
    const rec = (record.gate = { brief: null, closed: null, plan: [], openT: null, through: null, result: null });
    // 門の制圧の条件：説明・進みの文・地図の名札
    const briefOk = /外門/.test(s.brief.text) && /門の前の輪/.test(s.brief.text) && /20 秒/.test(s.brief.text);
    check(briefOk, `[${kind}] 城攻め前面：説明の画面に門の制圧の条件（門の前の輪・20 秒）`, (s.brief.text.match(/[^\n]*門の制圧[^\n]*/) ?? [''])[0].slice(0, 90));
    const sum0 = (await siegeState(page)).sum;
    check(/外門/.test(sum0) && /0／20 秒/.test(sum0), `[${kind}] 城攻め前面：目標の進みの文に門の制圧の秒（0／20 秒）`, sum0);
    await bpress(p, '.b-zall', 1000);
    const mapLabels = await page.evaluate(() => [...document.querySelectorAll('.b-label.terrain')].filter((e) => !e.hidden && e.dataset.fit !== 'hide').map((e) => e.textContent));
    const gl = mapLabels.find((x) => /外門の制圧/.test(x) && /20 秒/.test(x));
    check(!!gl, `[${kind}] 城攻め前面：地図の名札に門の制圧の条件`, gl ?? mapLabels.join('／'));
    // 目標の欄を開くと、段階と条件
    const closed0 = await page.evaluate(() => document.querySelector('.b-goals')?.classList.contains('closed'));
    if (closed0) await bpress(p, '.b-goals-head', 300);
    const panel = await page.evaluate(() => document.querySelector('.b-goals')?.innerText ?? '');
    check(/外門/.test(panel) && /20 秒/.test(panel) && /曲輪/.test(panel), `[${kind}] 城攻め前面：目標の欄（開く）に段階（外門の制圧 → 曲輪の確保）と制圧の秒`, panel.replace(/\s+/g, ' ').slice(0, 140));
    await shot(p, 'siege-gate-goals');
    if (closed0) await bpress(p, '.b-goals-head', 300);

    // 閉じている間：騎馬隊へ曲輪の中への移動 → 道が門を通らない・門の南のまま
    const r0 = await cmdMove(p, 'a_kiba', -30, -110, 30);
    check(r0.o?.type === 'move' && r0.o.z < -66, `[${kind}] 城攻め前面：閉じている間に騎馬隊へ「移動」→ 曲輪の中 (-30,-110) を押す（命令は出る）`, JSON.stringify(r0.o));
    await ff(page, 1);
    const k1 = await unit(page, 'a_kiba');
    const gateR = { x0: -10, x1: 10, z0: -66, z1: -56 };
    const through = (pts) => pts.some(([x, z]) => z < -56 || (x > gateR.x0 - 2 && x < gateR.x1 + 2 && z < -50 && z > -70));
    check(!!k1.path && (k1.path.none || !through(k1.path.pts)), `[${kind}] 城攻め前面：閉じている間の道は門・石垣を通らない（道が無い＝まっすぐ向かって石垣の手前で止まる）`, JSON.stringify(k1.path));
    let minZ = Infinity;
    for (let i = 0; i < 60; i++) {
        await ff(page, 1);
        minZ = Math.min(minZ, (await unit(page, 'a_kiba')).z);
    }
    const k2 = await unit(page, 'a_kiba');
    check(minZ > -56, `[${kind}] 城攻め前面：60 秒たっても騎馬隊は石垣・門の南（門を通り抜けない）`, `最も北 z ${r1(minZ)}・今 (${r1(k2.x)},${r1(k2.z)})・門 ${JSON.stringify(await page.evaluate(() => window.__battle.state.field.gates.map((g) => ({ open: g.open, sec: g.sec }))))}`);
    rec.closed = { order: r0.o, path: k1.path, minZ: r1(minZ), at: [r1(k2.x), r1(k2.z)] };
    await center(p, k2.x, k2.z - 20, 200);
    await shot(p, 'siege-gate-closed');
    await page.keyboard.press('Escape');
    await page.close();
    await p.ctx.close();

    // 急いで門へ（RUSH）を、新しく始めた合戦で画面の操作で
    await rushPlan();
}

async function rushPlan() {
    const p = await openTitle('desktop');
    const { page, kind } = p;
    await titleToList(p);
    await listToBattle(p, 'siege_front');
    await installMonitor(page, 'siege_front・急いで門へ');
    const rec = record.gate;
    const tag = '城攻め前面・急いで門へ';
    for (const id of ['a_tadakatsu', 'a_ishikawa', 'a_sakai', 'a_kiba', 'a_sakakibara']) await doCmd(p, id, ['attack', 'e_sortie'], tag);
    await doCmd(p, 'a_yumi', ['tap', 0, 20], tag);
    const FRONT = { a_tadakatsu: [-18, -50], a_ishikawa: [17, -47], a_sakai: [-6, -37] };
    const POSTS = { a_tadakatsu: [-12, -118], a_sakai: [12, -118], a_kiba: [0, -134] };
    const fr = {};
    const phase = { front: false, interior: false, guard1: false, guard2: false, inner: false, posts: false };
    let st = await siegeState(page);
    let openSeen = null;
    let thr = null;
    const sums = new Set();
    while (!st.result && st.t < 660) {
        await ff(page, 1);
        st = await siegeState(page);
        if (st.result) break;
        if (st.sec > 0 && !st.open) sums.add(st.sum.split('・').slice(0, 2).join('・'));
        // 出張りが崩れたのを見て、輪の持ち場へ（詰まったら 8 秒ごとに押し直す。3 回まで）
        if (!st.sortie && !st.open) {
            if (!phase.front) {
                phase.front = true;
                await shot(p, 'siege-rush-sortie-broken');
            }
            for (const [id, [x, z]] of Object.entries(FRONT)) {
                const u = await unit(page, id);
                if (!u || u.status !== 'ready') continue;
                const f = (fr[id] = fr[id] ?? { n: 0, t: -99, best: Infinity });
                const dd = Math.hypot(u.x - x, u.z - z);
                if (dd < 6) continue;
                if (f.n === 0 || (f.n < 3 && st.t - f.t >= 8 && dd > f.best - 1)) {
                    await doCmd(p, id, ['move', x, z], tag);
                    f.n++;
                    f.t = st.t;
                }
                f.best = Math.min(f.best, dd);
            }
            // 榊原隊へ、門が開く前に曲輪の中への移動を出しておく（門の前で待ち、開いたら押し直さずに入るか）
            if (!phase.interior) {
                phase.interior = true;
                const r = await doCmd(p, 'a_sakakibara', ['move', -20, -95, 30], tag);
                rec.interiorOrder = { t: r1(st.t), o: r.o };
            }
        }
        if (st.open && openSeen === null) {
            openSeen = st.t;
            rec.openT = r1(st.t);
            const sk = await unit(page, 'a_sakakibara');
            rec.atOpen = { sakakibara: [r1(sk.x), r1(sk.z)], order: sk.order };
            await center(p, 0, -60, 220);
            await shot(p, 'siege-rush-gate-open');
            check(true, `[${kind}] ${tag}：輪を画面の命令で占めて門が開いた（${r1(st.t)} 秒）`);
        }
        // 開いた後：榊原隊が押し直さずに門をくぐるか（石垣の北 z < -70 まで）
        if (openSeen !== null && thr === null) {
            const sk = await unit(page, 'a_sakakibara');
            if (sk.status === 'ready' && sk.z < -70) thr = { t: r1(st.t), dt: r1(st.t - openSeen), at: [r1(sk.x), r1(sk.z)], path: sk.path };
            else if (st.t - openSeen > 90 || sk.status !== 'ready') thr = { failed: true, t: r1(st.t), at: [r1(sk.x), r1(sk.z)], status: sk.status, order: sk.order, path: sk.path };
        }
        if (st.open) {
            if (!phase.guard1 && st.guard) {
                phase.guard1 = true;
                await doCmd(p, 'a_tadakatsu', ['attack', 'e_gate_guard'], tag);
            }
            if (phase.guard1 && !phase.guard2 && st.guard && (st.tadEngGuard || st.t - openSeen > 25)) {
                phase.guard2 = true;
                for (const id of ['a_sakai', 'a_kiba', 'a_ishikawa']) if ((await unit(page, id))?.status === 'ready') await doCmd(p, id, ['attack', 'e_gate_guard'], tag);
                if ((await label(page, 'a_ishikawa'))?.ab === 'ready') await doCmd(p, 'a_ishikawa', ['abilityOn', 'a_tadakatsu'], tag);
            }
            if (!st.guard && st.inner && !phase.inner) {
                phase.inner = true;
                for (const id of ['a_tadakatsu', 'a_sakai', 'a_kiba', 'a_sakakibara']) if ((await unit(page, id))?.status === 'ready') await doCmd(p, id, ['attack', 'e_inner'], tag);
            }
            if (!st.guard && !st.inner && !phase.posts) {
                phase.posts = true;
                for (const [id, [x, z]] of Object.entries(POSTS)) if ((await unit(page, id))?.status === 'ready') await doCmd(p, id, ['move', x, z], tag);
                await center(p, 0, -110, 260);
                await shot(p, 'siege-rush-bailey');
            }
        }
    }
    rec.sums = [...sums].slice(0, 6);
    rec.through = thr;
    check(sums.size >= 2 && [...sums].some((x) => /([1-9]|1\d)／20 秒/.test(x)), `[${kind}] ${tag}：輪を占めている間、目標の進みの文に制圧の秒が出る`, [...sums].slice(0, 4).join('｜'));
    check(openSeen !== null, `[${kind}] ${tag}：門が開く`, openSeen !== null ? `${r1(openSeen)} 秒` : '開かない');
    check(!!thr && !thr.failed, `[${kind}] ${tag}：門が開く前に曲輪の中へ移動を命じていた榊原隊が、押し直さずに門をくぐって曲輪へ入る（道が引き直される）`, JSON.stringify(thr));
    if (!st.result) await finish(p, 700);
    const m = await monitor(page);
    checkMonitor(kind, tag, m);
    rec.monitor = { insideN: m.insideN, losBad: m.losBad.length, meleeBad: m.meleeBad.length, shots: m.shots, melees: m.melees, stuck: m.stuck, queue: m.queue.length, blockedGoal: m.blockedGoal.length, blockedInRange: m.blockedInRange };
    const res = await resultToList(p, 'siege_front', 'siege-rush-result');
    log(`    ${tag}：門 ${rec.openT} 秒 → ${res.result}（${res.reason}）${r1(res.t)} 秒・損害 ${r1(res.loss * 100)}％・戦える ${res.left}／7・主目標 ${res.primary}・副目標 ${res.secondary.join(',')}`);
    rec.result = { result: res.result, reason: res.reason, t: r1(res.t), loss: r1(res.loss * 100), left: res.left, primary: res.primary, secondary: res.secondary };
    check(res.result === 'victory' && res.primary === 'true', `[${kind}] ${tag}：画面の操作で主目標（外門の制圧 → 曲輪の確保）まで届く`, `${res.result}・${r1(res.t)} 秒`);
    await p.ctx.close();
}

// ================================================================ c. 建物・柵（村落）

const VILLAGE_DEPLOY = [
    ['a_tadakatsu', [0, 30]],
    ['a_sakai', [-48, 40]],
    ['a_kiba', [48, 40]],
    ['a_ishikawa', [18, 52]],
    ['a_yumi', [-18, 55]],
    ['a_sakakibara', [30, 80]], // 南の列の家屋の中（押すと近くの通れる所へ直る。テストと同じ点）
    ['a_ieyasu', [0, 125]],
];
const VILLAGE_PLANS = {
    // tests/proto3d-field-village.test.ts の POST（西の辻に二隊＋柵の内側の弓。命令 10 回）
    post: [...VILLAGE_DEPLOY.map(([id, q], i) => [4 + i * 2, id, q]), [25, 'a_ishikawa', [-72, -28]], [27, 'a_sakai', [-72, 20]], [150, 'a_yumi', [72, 6]]],
    // SHADE（弓を家屋の陰 (50,30) へ。東の通りは家並みに遮られて見えない）
    shade: [...VILLAGE_DEPLOY.map(([id, q], i) => [4 + i * 2, id, q]), [150, 'a_yumi', [50, 30]]],
};

async function villagePlay(name, until) {
    const p = await openTitle('desktop');
    const { page, kind } = p;
    await titleToList(p);
    await listToBattle(p, 'village');
    await installMonitor(page, `village・${name}`);
    const tag = `村落・${name}`;
    const steps = VILLAGE_PLANS[name];
    for (const [t, id, [x, z]] of steps) {
        if ((await simT(page)) < t) await ff(page, t - (await simT(page)));
        // 家屋の中の点は近くの通れる所へ直る（20 m まで）
        await doCmd(p, id, ['tap', x, z, (await passable(page, x, z)) ? 6 : 20], tag);
    }
    await bpress(p, '.b-zall', 600);
    await shot(p, `village-${name}-orders`);
    // 第三波が来る所（230 秒）を撮る
    if ((await simT(page)) < 235) await ff(page, 235 - (await simT(page)));
    await center(p, 40, 0, 260);
    await shot(p, `village-${name}-235s`);
    if (until) await ff(page, until - (await simT(page)));
    else await finish(p, 700);
    const m = await monitor(page);
    checkMonitor(kind, tag, m);
    const rec = (record.village[name] = { monitor: { insideN: m.insideN, losBad: m.losBad.length, meleeBad: m.meleeBad.length, shots: m.shots, melees: m.melees, stuck: m.stuck, queue: m.queue.length, blockedGoal: m.blockedGoal.length, blockedInRange: m.blockedInRange, yumiShotAt: m.shotAt.a_yumi ?? {} } });
    if (!until) {
        const res = await resultToList(p, 'village', `village-${name}-result`);
        rec.result = { result: res.result, reason: res.reason, t: r1(res.t), loss: r1(res.loss * 100), left: res.left, primary: res.primary, secondary: res.secondary };
        log(`    ${tag}：${res.result}（${res.reason}）${r1(res.t)} 秒・損害 ${r1(res.loss * 100)}％・主目標 ${res.primary}・副目標 ${res.secondary.join(',')}`);
    }
    await p.ctx.close();
    return m;
}

/** 弓隊（a_yumi）が 160 秒より後に、東の通り（x 60 より東。柵の北）にいる第三波を射た刻みの数と、射程の中に見えていて射線の通らなかった刻みの数 */
function eastStreet(m) {
    const inStreet = (x, z) => x > 60 && z < -6;
    const shots = m.shotLog.filter(([id, t, tgt, x, z]) => id === 'a_yumi' && t >= 160 && tgt.startsWith('e_e_') && inStreet(x, z)).length;
    const blocked = m.blockedLog.filter(([id, t, tgt, x, z]) => id === 'a_yumi' && t >= 160 && tgt.startsWith('e_e_') && inStreet(x, z)).length;
    const blockedSeen = m.blockedLog.filter(([id, t, tgt, x, z, seen]) => id === 'a_yumi' && t >= 160 && tgt.startsWith('e_e_') && inStreet(x, z) && seen).length;
    return { shots, blocked, blockedSeen };
}

async function villagePart() {
    const post = await villagePlay('post', 0);
    const r = record.village.post.result;
    check(r?.result === 'victory' && r.primary === 'true', '[desktop] 村落・西の辻に二隊：画面の操作で主目標（庄屋の屋敷前を 7 分守る）まで届く', JSON.stringify(r));
    // 柵の内側 (72,6) の弓は、柵越しに東の通りを下る第三波を射る（柵は射線を通す）
    const ep = eastStreet(post);
    check(ep.shots > 0, '[desktop] 村落・西の辻に二隊：柵の内側 (72,6) の弓は、柵越しに東の通りを下る第三波を射る（柵は射線を通す）', JSON.stringify(ep));
    // 家屋の陰 (50,30) の弓は、東の通りの第三波を射ない（家並みに遮られる）。広場へ出てきた相手は射る
    const shade = await villagePlay('shade', 330);
    const es = eastStreet(shade);
    check(es.shots === 0 && es.blocked > 0, '[desktop] 村落・家屋の陰 (50,30) の弓：東の通りの第三波は射程の中でも家並みに遮られて射ない（blocked：射程の中で射線の通らない刻み。blockedSeen はそのうち見えていた刻み）', JSON.stringify(es));
    record.village.eastStreet = { post: ep, shade: es };
}

// ================================================================ d. 名札と目標の表示の重なり

const measureLabels = (page) =>
    page.evaluate(() => {
        const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
        const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const ov = (a, c) => a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const maps = [...document.querySelectorAll('.b-label.terrain')].filter((e) => vis(e) && e.dataset.fit !== 'hide').map((e) => ({ text: e.textContent, ...R(e), pe: getComputedStyle(e).pointerEvents }));
        const onScreen = maps.filter((m) => m.r > 0 && m.l < W && m.b > 0 && m.t < H);
        const mapOverlaps = [];
        for (let i = 0; i < onScreen.length; i++) for (let j = i + 1; j < onScreen.length; j++) if (ov(onScreen[i], onScreen[j])) mapOverlaps.push(`${onScreen[i].text}×${onScreen[j].text}`);
        const hiddenMaps = [...document.querySelectorAll('.b-label.terrain')].filter((e) => !e.hidden && e.dataset.fit === 'hide').map((e) => e.textContent);
        const steal = [];
        const quiet = [];
        for (const s of ['.b-obj', '.b-goals', '.b-ctrl', '.b-zoom', '.b-cards', '.b-cmds', '.b-hint-x', '.b-toast', '.b-abil', '.b-abnote', '.b-pausepill', '.b-inspect', '.b-hint'])
            for (const e of document.querySelectorAll(s)) if (vis(e)) (getComputedStyle(e).pointerEvents === 'none' ? quiet : steal).push({ s, ...R(e) });
        const badgeHidden = [];
        for (const e of document.querySelectorAll('.b-label[data-ab="ready"]')) {
            const a = e.querySelector('.b-lab-ab');
            if (!vis(e) || !a) continue;
            const bb = R(a);
            for (const k of steal) if (ov(bb, k)) badgeHidden.push(`${e.dataset.id}×${k.s}`);
        }
        // 地図の名札と点滅する印の重なり（名札は押しを通すので記録だけ）
        const badgeUnderMap = [];
        for (const e of document.querySelectorAll('.b-label[data-ab="ready"]')) {
            const a = e.querySelector('.b-lab-ab');
            if (!vis(e) || !a) continue;
            const bb = R(a);
            for (const m of onScreen) if (ov(bb, m)) badgeUnderMap.push(`${e.dataset.id}×${m.text}`);
        }
        const quietPe = ['.b-toast', '.b-abil', '.b-abnote', '.b-pausepill', '.b-inspect', '.b-hint', '.b-labels'].every((s) => { const e = document.querySelector(s); return !e || getComputedStyle(e).pointerEvents === 'none'; });
        const g = document.querySelector('.b-goals');
        const sum = document.querySelector('.b-goals-sum');
        return {
            maps: onScreen.map((m) => m.text),
            mapOverlaps,
            hiddenMaps,
            mapPe: [...new Set(maps.map((m) => m.pe))],
            badgeHidden,
            badgeUnderMap,
            quietPe,
            goals: g ? { closed: g.classList.contains('closed'), h: g.querySelector('.b-goals-head')?.getBoundingClientRect().height ?? 0, sum: sum?.textContent ?? '', cut: !!sum && sum.scrollWidth > sum.clientWidth + 1 } : null,
            onScreenBoxes: onScreen,
        };
    });

async function labelsOne(kind, id) {
    const p = await openField(kind, id);
    const { page } = p;
    const rec = (record.labels[`${kind}-${id}`] = {});
    // near：交戦の所へ寄った画面（カメラの位置しだいで、画面の端の名札が左上の目標の欄などの下に入る。地図を動かせば押せるので記録だけ）
    const judge = async (when, near = false) => {
        const m = await measureLabels(page);
        if (near) {
            log(`    （記録）${id}（${when}）：地図の名札の重なり ${m.mapOverlaps.length}・押しを奪う部品の下の点滅する印 ${m.badgeHidden.join(' ') || 'なし'}`);
            rec[when] = { maps: m.maps, hidden: m.hiddenMaps, overlaps: m.mapOverlaps, badgeHidden: m.badgeHidden, badgeUnderMap: m.badgeUnderMap, goals: m.goals };
            return m;
        }
        check(m.mapOverlaps.length === 0, `[${kind}] ${id}（${when}）：見えている地図の名札どうしが重ならない（${m.maps.length} 枚・一時的に隠す ${m.hiddenMaps.length}）`, m.mapOverlaps.join(' '));
        check(m.mapPe.every((x) => x === 'none') && m.quietPe, `[${kind}] ${id}（${when}）：地図の名札・操作の要らない表示は押しを奪わない`, m.mapPe.join(','));
        check(m.badgeHidden.length === 0, `[${kind}] ${id}（${when}）：点滅する印が押しを奪う部品（目標の欄・札など）に覆われない`, m.badgeHidden.join(' '));
        if (m.goals && p.phone) check(m.goals.closed && m.goals.h <= 32, `[${kind}] ${id}（${when}）：目標は畳んで 1 行`, `${r1(m.goals.h)} px「${m.goals.sum}」${m.goals.cut ? '（後ろが「…」）' : ''}`);
        if (m.badgeUnderMap.length) log(`    （記録）点滅する印の上に地図の名札（押しは通す）：${m.badgeUnderMap.join(' ')}`);
        log(`    地図の名札：${m.maps.join('／')}${m.hiddenMaps.length ? `（隠す：${m.hiddenMaps.join('／')}）` : ''}`);
        rec[when] = { maps: m.maps, hidden: m.hiddenMaps, overlaps: m.mapOverlaps, badgeHidden: m.badgeHidden, badgeUnderMap: m.badgeUnderMap, goals: m.goals };
        return m;
    };
    await bpress(p, '.b-zall', 1200);
    const m0 = await judge('始め・全体');
    await shot(p, `labels-${id}-start`);
    // 地図の名札の上を押す → その下の地面へ移動の命令（名札は押しを通す）。部隊から 25 m 以上離れた地面の上の名札
    await card(p, 'a_yumi');
    let passed = null;
    for (const box of m0.onScreenBoxes) {
        const x = (box.l + box.r) / 2;
        const y = (box.t + box.b) / 2;
        const g = await groundUnder(page, x, y);
        if (!g) continue;
        const near = await page.evaluate(([x, z]) => window.__battle.state.units.some((u) => u.present && u.status !== 'destroyed' && Math.hypot(u.x - x, u.z - z) < 25), [g.x, g.z]);
        const lim = await page.evaluate(() => ({ w: window.__battle.state.map.width / 2 - 4, d: window.__battle.state.map.depth / 2 - 4 }));
        if (near || Math.abs(g.x) > lim.w || Math.abs(g.z) > lim.d || !(await passable(page, g.x, g.z))) continue;
        // 名札の上で、部隊の名札・画面の部品に当たらない点か
        const lh = await hitAt(page, x, y);
        if (lh) continue;
        if ((await ui(page)).selectedId !== 'a_yumi') await card(p, 'a_yumi');
        await pointAt(p, x, y, 500);
        const o = await orderOf(page, 'a_yumi');
        passed = { text: box.text, g: [r1(g.x), r1(g.z)], o, ok: movedTo(o, g) && (await ui(page)).selectedId === 'a_yumi' };
        break;
    }
    if (passed) check(passed.ok, `[${kind}] ${id}：地図の名札「${passed.text}」の上を押す → その下の地面へ弓隊が移動（名札は押しを通す）`, JSON.stringify(passed));
    else log(`    （記録）${id}：部隊から離れた所の地図の名札が無く、名札の上を押す確かめは省いた`);
    rec.passThrough = passed;
    // 交戦中：槍・騎馬の 4 隊を、見えている一番近い敵へ「攻撃」→ 敵を押す（画面の操作）。5 秒ずつ早送りし、10 秒ごとに当て直す。
    // 斬り合う部隊が 4 つ以上になるまで（最長 240 秒）
    const engaged = () => page.evaluate(() => { const s = window.__battle.state; return { t: s.t, engaged: s.units.filter((u) => u.present && u.status === 'ready' && u.engagedWith).length, result: s.result?.result ?? null }; });
    let e = await engaged();
    let orders = 0;
    for (let k = 0; k < 48 && e.engaged < 4 && !e.result; k++) {
        if (k % 2 === 0) {
            for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_kiba']) {
                const n = await page.evaluate((id) => {
                    const s = window.__battle.state;
                    const u = s.units.find((x) => x.id === id);
                    const ok = (x) => x && x.present && x.status === 'ready';
                    if (!ok(u)) return null;
                    if (u.order.type === 'attack' && ok(s.units.find((x) => x.id === u.order.targetId))) return null;
                    const f = s.units.filter((x) => x.side === 'enemy' && ok(x) && x.seenBy.ally && !x.isHq).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
                    return f?.id ?? null;
                }, id);
                if (!n) continue;
                const r = await cmdAttack(p, id, n);
                if (r.ok) orders++;
            }
        }
        await ff(page, 5);
        e = await engaged();
    }
    log(`    ${id}：交戦まで（画面の「攻撃」→ 敵を押す ${orders} 回・早送り）${r1(e.t)} 秒・斬り合う ${e.engaged}${e.result ? `・決着 ${e.result}` : ''}`);
    rec.combat = { t: r1(e.t), engaged: e.engaged, result: e.result };
    if (e.result) log(`    ${id}：交戦の前に決着（${e.result}・${r1(e.t)} 秒）`);
    await bpress(p, '.b-zall', 1200);
    await judge(`交戦中 ${r1(e.t)} 秒・斬り合う ${e.engaged}`);
    await shot(p, `labels-${id}-combat`);
    // 交戦の所へ寄った画面（斬り合う部隊の真ん中）
    const c = await page.evaluate(() => {
        const us = window.__battle.state.units.filter((u) => u.present && u.status === 'ready' && u.engagedWith);
        if (!us.length) return null;
        return { x: us.reduce((a, u) => a + u.x, 0) / us.length, z: us.reduce((a, u) => a + u.z, 0) / us.length };
    });
    if (c) {
        await center(p, c.x, c.z, p.phone ? 170 : 220);
        await page.waitForTimeout(800);
        await judge('交戦の所へ寄る', true);
        await shot(p, `labels-${id}-combat-near`);
    }
    await p.ctx.close();
}

async function labelsPart() {
    for (const kind of ['desktop', 'phone']) for (const id of GROUP3) await labelsOne(kind, id);
}

// ================================================================ e・f. 能力の発動と移動の命令の競合・号令の判定（村落）

async function conflictOne(kind) {
    const p = await openField(kind, 'village');
    const { page } = p;
    const rec = (record.conflict[kind] = {});
    const D = p.phone ? 160 : 200;
    // e1. 移動先指定の間に酒井の印 → 両翼の采配（移動にならない）
    await card(p, 'a_yumi');
    await moveMode(p);
    await page.waitForFunction(() => (document.querySelector('.b-hint')?.textContent ?? '').includes('移動先指定中'), null, { timeout: 5000 }).catch(() => {});
    const h = await hintText(page);
    check((await ui(page)).pending === 'move' && h.includes('移動先指定中'), `[${kind}] 村落：弓隊を選んで「移動」${p.phone ? '' : '（M）'}→ 案内の帯に「移動先指定中」`, h);
    const sk = await unit(page, 'a_sakai');
    await center(p, sk.x, sk.z, D);
    await page.waitForTimeout(500);
    const skb = (await label(page, 'a_sakai'))?.badge;
    const b0 = await snapUnits(page);
    if (skb) await pointAt(p, skb.x, skb.y, 700);
    const a0 = await snapUnits(page);
    const u0 = await ui(page);
    check(!!skb && (await ab(page, 'a_sakai')).usedAt !== null && changedExcept(b0, a0, []).length === 0 && u0.selectedId === 'a_yumi', `[${kind}] 村落：移動先指定の間に酒井の名札の印を押す → 両翼の采配（弓隊の移動・選び直しにならない）`, `pending ${u0.pending}・変わった ${changedExcept(b0, a0, []).join(',')}`);
    rec.badgeInMoveMode = { used: (await ab(page, 'a_sakai')).usedAt, pending: u0.pending };
    // e2. 移動先指定で、味方（騎馬隊）の立つ所を押す → 弓隊がその点へ（選び直さない）
    if ((await ui(page)).selectedId !== 'a_yumi') await card(p, 'a_yumi');
    if ((await ui(page)).pending !== 'move') await moveMode(p);
    const kb = await unit(page, 'a_kiba');
    await center(p, kb.x, kb.z, D);
    await page.waitForTimeout(400);
    const kq = await bodyPoint(p, 'a_kiba');
    const g = await groundUnder(page, kq.x, kq.y);
    await pointAt(p, kq.x, kq.y, 600);
    const u1 = await ui(page);
    const o1 = await orderOf(page, 'a_yumi');
    check(u1.selectedId === 'a_yumi' && movedTo(o1, g), `[${kind}] 村落：移動先指定で騎馬隊の立つ所を押す → 選び直さず、弓隊がその点へ移動`, `選択 ${u1.selectedId}・命令 ${JSON.stringify(o1)}・地面 ${g && `${r1(g.x)},${r1(g.z)}`}`);
    // e2'. 移動先指定で、家屋の中を押す → 近くの通れる所へ（選び直さない）。南の列の家屋 (22,90)
    await moveMode(p);
    await center(p, 22, 90, D);
    await page.waitForTimeout(400);
    const hp = await page.evaluate(() => window.__battle.screenOfGround(22, 90));
    await pointAt(p, hp.x, hp.y, 600);
    const o2 = await orderOf(page, 'a_yumi');
    const pOk = o2.type === 'move' ? await passable(page, o2.x, o2.z) : false;
    check(o2.type === 'move' && pOk && Math.hypot(o2.x - 22, o2.z - 90) < 25 && (await ui(page)).selectedId === 'a_yumi', `[${kind}] 村落：移動先指定で家屋の中を押す → 近くの通れる所への移動（選び直さない）`, JSON.stringify(o2));
    await shot(p, 'conflict-move-mode');
    // e3. 石川の対象選びの間に味方（忠勝隊）の体を押す → 差配（選び直し・移動に漏れない）
    const r3 = await (async () => {
        const iu = await unit(page, 'a_ishikawa');
        await center(p, iu.x, iu.z, D);
        await page.waitForTimeout(500);
        const lb = await label(page, 'a_ishikawa');
        if (!lb?.badge) return { ok: false, why: '石川の印が無い' };
        await pointAt(p, lb.badge.x, lb.badge.y, 500);
        const pend = (await ui(page)).pending;
        const tq = await bodyPoint(p, 'a_tadakatsu');
        const bb = await snapUnits(page);
        await pointAt(p, tq.x, tq.y, 700);
        const aa = await snapUnits(page);
        const r = await ab(page, 'a_ishikawa');
        const u = await ui(page);
        return { ok: pend === 'ability' && r.usedAt !== null && r.targetId === 'a_tadakatsu' && u.selectedId === 'a_ishikawa' && u.pending === 'none' && changedExcept(bb, aa, ['a_ishikawa']).length === 0, pend, r, sel: u.selectedId, leak: changedExcept(bb, aa, ['a_ishikawa']) };
    })();
    check(r3.ok, `[${kind}] 村落：石川の印 → 対象選び → 忠勝隊の体を押す → 差配（選び直し・移動に漏れない）`, JSON.stringify(r3));
    rec.ishikawa = r3;
    await shot(p, 'conflict-ishikawa');

    // f. 号令の判定
    check((await label(page, 'a_ieyasu'))?.ab === 'ready', `[${kind}] 村落：始め（家康本陣の士気 90）は家康の名札が点滅`);
    const iu = await unit(page, 'a_ieyasu');
    await center(p, iu.x, iu.z, D);
    await page.waitForTimeout(500);
    const oldBadge = (await label(page, 'a_ieyasu')).badge;
    log(`[${kind}] 直接操作：味方の士気をみな 100 にする（敵の波はまだ来ていない）`);
    await page.evaluate(() => { for (const u of window.__battle.state.units) if (u.side === 'ally') u.morale = 100; });
    await page.waitForTimeout(600);
    const eff = await page.evaluate(() => window.__battle.effectTargets('a_ieyasu'));
    check(eff && eff.inRange.length > 0 && eff.effective.length === 0, `[${kind}] 村落：号令の効く相手がいない（範囲の味方 ${eff?.inRange.length}・効く 0）`, JSON.stringify(eff));
    const l1 = await label(page, 'a_ieyasu');
    check(l1.ab !== 'ready' && (await cardAbl(page, 'a_ieyasu')).includes('―'), `[${kind}] 村落：家康の名札が点滅しない・札は「号令 ―」`, `ab ${l1.ab}・札 ${await cardAbl(page, 'a_ieyasu')}`);
    await card(p, 'a_kiba');
    await pointAt(p, oldBadge.x, oldBadge.y, 600);
    check((await ab(page, 'a_ieyasu')).usedAt === null, `[${kind}] 村落：前に印のあった所を押しても号令は使わない`);
    await card(p, 'a_ieyasu');
    if (p.phone) await bpress(p, '.b-abil-btn', 400);
    else {
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(400);
    }
    const why = await hintText(page);
    check((await ab(page, 'a_ieyasu')).usedAt === null && why.includes('効く相手がいない'), `[${kind}] 村落：「能力」${p.phone ? '' : '（F）'}→ 理由が出て使わない（回数は減らない）`, why);
    await shot(p, 'rally-blocked');
    // 第一波が近づくまで早送り（直接操作なし）→ 敵が近い部隊が出て点滅が戻る → 印で使う
    let back = null;
    for (let i = 0; i < 200 && !back; i++) {
        await ff(page, 1);
        if ((await page.evaluate(() => window.__battle.state.result))) break;
        const l = await label(page, 'a_ieyasu');
        if (l?.ab === 'ready') back = { t: await simT(page), eff: await page.evaluate(() => window.__battle.effectTargets('a_ieyasu')) };
    }
    const threat = back ? Object.entries(back.eff.why).filter(([, w]) => w.includes('threat')).map(([id]) => id) : [];
    check(!!back && threat.length > 0, `[${kind}] 村落：第一波が近づくと（${back ? r1(back.t) : '-'} 秒）、敵が近い部隊（${threat.join('・')}）を見て点滅が戻る（敗走の防ぎが効く）`, JSON.stringify(back?.eff));
    if (back) {
        const r = await pressBadge(p, 'a_ieyasu', D);
        check(r.ok && !r.leak, `[${kind}] 村落：家康の名札の印を 1 回押す → 号令を使う（漏れない）`, JSON.stringify({ hit: r.hit, leak: r.leak }));
        await shot(p, 'rally-threat-use');
    }
    rec.rally = { blocked: eff, back: back && { t: r1(back.t), why: back.eff.why } };
    await p.ctx.close();
}

async function conflictPart() {
    for (const kind of ['desktop', 'phone']) await conflictOne(kind);
}

// ================================================================ 通し

const steps = { start: startPart, phone: phonePart, gate: gatePart, village: villagePart, labels: labelsPart, conflict: conflictPart };
for (const k of PARTS) {
    log(`== ${k}`);
    try {
        await steps[k]();
    } catch (e) {
        log(`!! ${k} の途中で止まった：${e.stack ?? e}`);
        failures.push(`${k}：例外 ${e.message}`);
    }
    writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
}
await b.close();
writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
