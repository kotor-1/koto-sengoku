/**
 * 第2群 5 戦場と先に直した 2 点の統合の通しの確認（docs/fields-group2-request.md【確認】・docs/fields-group2-design.md §5）。
 *   BASE3D=http://localhost:8204 BASE=http://localhost:8204 node e2e/fields-group2.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/fields-group2）
 *   PARTS=start,phone,plan,rally で一部だけ（既定はすべて）。FIELDS=single_bridge,ridge で第2群の戦場を絞る（既定は 5 つ）。
 *
 * start（PC 1280×720・マウス）：
 *   - タイトル →「合戦場の演習」→ 一覧に 10 戦場（第1群 5・第2群 5）→ 戦場ごとに「出陣」→ 合戦の画面（戦場 id・部隊の数・札の数）。
 *     終わりは全軍撤退のボタン（確かめも）→ 早送り → 合戦の結果 →「続ける」→ 演習の結果 →「一覧へ」（どれもクリック）。
 *   - 第2群の各戦場では、続けて（g2 の確かめ）：
 *     a. 味方の部隊を、地図の上の体をクリックしてそれぞれ選ぶ（選択だけが変わり、命令・位置に漏れない）。
 *     b. 地図の上で選んだ部隊へ、地面のクリックで移動の命令。
 *     c. 能力の名札が点滅する（使える武将の名札の data-ab=ready・止めていても明るさが変わる）。印の真ん中の当たりがその武将の印で、
 *        印を 1 回押すと能力を使う（選択・全部隊の位置と命令に漏れない）。
 *     d. 交戦が始まるまで早送り →「全体」で引く：点滅している名札はどれもそのまま見え（小さく・隠すにならない）、印がほかの名札に覆われず、
 *        印の真ん中で当たる。小さく・隠された味方の名札があれば、札で選ぶとそのまま見え、覆われない。隠した名札は当たりにならない。
 * phone（スマホ横 844×390・hasTouch・isMobile・タップ）：第2群の 5 戦場を、タイトル → 演習 → 戦場 → 出陣（タップ）で始め、上の a〜d をタップで。
 * plan（PC。PLANS=paddy,single_bridge,ridge で絞る）：水田・一本橋・尾根で、地形に合った作戦（tests/proto3d-field-<戦場>.test.ts の FIT と
 *   同じ命令・同じ時刻）を札・地図の押し・ボタン（移動・攻撃・撤退）・名札の印（先駆けの号）だけで出し、命令の間の待ちは早送りで進めて決着まで → 勝つ。
 *   同じ戦場で正面突破（テストの PUSH。水田：槍・騎馬の四隊で交わりの備えへ・弓は街道を上がって備えを射る・110 秒に荷駄隊を撤退／
 *   一本橋：五隊で橋頭へ・弓は橋の守りを射る／尾根：五隊で頂へ・弓は頂の弓を射る）を同じく画面の操作で出す → 勝てない。
 *   結果の画面・演習の結果で勝敗・主目標・副目標が別の行。
 * rally（PC）：大平原（演習）で命令を出さずに進め、前線のどれかの士気が 45 を切ったら（早送り）：
 *   - 「全体」で引いた密集の場面で、点滅している名札が隠れず押せる（d と同じ確かめ）。札で小さく・隠された部隊を選ぶ → そのまま見える。
 *   - 選んだまま家康の名札の印を 1 回押して「立て直しの号令」（漏れない）。能力の欄（家康を札で選ぶ）の説明に「兵が 3 割を切った部隊」。
 *   - 効果の 35 秒を早送り（刻みごとに状態を読むだけの見張り）：効果中の味方の敗走は、どれも兵が最初の 3 割を切った部隊の
 *     「号令でも支えきれない」敗走で、全滅の前（兵が残っている）。効果中の全滅 0。号令に守られた部隊の士気は 20 未満に下がらない。
 *
 * 確認の種類：
 * - 本物の入力：タイトルからの画面の移り・札・地図の押し（体・地面・敵）・命令のボタン・名札の印・全軍撤退・結果の画面のボタン。
 * - 早送り：待ち時間（window.__battle.fastForward。合戦の時間を進めるだけ）。合戦を始める瞬間だけ時の進みを 0 にして（setTimeScale）、
 *   止める（「指揮」のボタン）までに時刻が進まないようにする。
 * - 読むだけ：window.__battle.state・ui・labelFits・labelOf・labelCovers・labelHitAt・screenOf・screenOfGround。カメラは centerOn（表示だけ）。
 *   命令・選択・能力を状態へ直接書き込まない。
 * - 実機・性能：未確認（コンテナはソフトウェア描画）。
 *
 * plan で行き先の地面にほかの味方が立っていた（押すとその部隊を選び直す）ときは、人がするように 5〜13 m 脇の空いた地面を押す。
 * 行き先が自分の隊列の中（12 m 以内・押すと自分の体）のときは、もうそこにいるので命令を出さない（どちらもログに書く）。
 * そのため尾根の命令の数・決着はテストの台本と少し違う（押した点の数 m の差で、後の動きが変わる）。
 *
 * 記録（2026-10-01。330 項目すべて ok。コンテナの SwiftShader。実機は未確認）：
 * - 本物の入力（早送りは待ちだけ）：
 *   ・タイトルから 10 戦場すべてを「出陣」して合戦の画面（PC）。第2群の 5 戦場は PC とスマホ相当の両方で、味方 7 部隊を地図の上の体を押して
 *     すべて選べ（漏れなし）、地面の押しで移動、点滅する名札の印 1 回で能力（漏れなし）。全軍撤退 → 結果 → 演習の結果（保存）→ 一覧。
 *   ・水田（命令 13 回）：地形に合った作戦 → 勝ち 179.5 秒・損害 10.4％（主目標 ✓・追っ手の騎馬 ✗・損害 2 割以内 ✓。テストの FIT と同じ数字）。
 *     正面突破（命令 7 回）→ 負け 158.6 秒・損害 42.9％（荷駄隊が追いつかれる。テストは 158.7 秒・43.1％。弓の行き先の押した点の差）。
 *   ・一本橋（命令 18 回）：陽動と浅瀬の守り → 勝ち 291.9 秒・損害 27.4％（副目標 2 つとも ✓）。正面突破 → 負け 234.7 秒・損害 48.3％（軍の崩壊）。
 *   ・尾根（命令 23 回。2 回は自分の隊列の中で出さない、1 回は脇を押す）：西の登り道から横・急坂から下から → 勝ち 356.3 秒・損害 19.2％
 *     （損害 25％以内 ✓・東の肩 ✗）。正面突破（五隊で頂へ）→ 日没 540 秒・損害 43.8％（主目標を果たせない）。
 *   ・号令の直し（大平原・命令なし）：前線の士気が 45 を切った 70.9 秒に、弓隊を札で選んだまま家康の印を押して号令。効果中（〜105.9 秒）の
 *     味方の敗走は榊原隊の 1 つだけで、91.1 秒・兵 119（最初の 30％を切った）の「号令でも支えきれない」敗走。全滅 0。守られた部隊の士気の最低 57。
 *     能力の欄の説明に「兵が 3 割を切った部隊は退く」。
 *   ・名札の優先表示（「全体」で引いた交戦中・密集の場面）：どの戦場・端末でも、点滅している名札はそのまま見え、印が覆われず、印の真ん中で当たる。
 *     札で選んだ部隊の名札はそのまま見え、覆われない。隠した名札は当たりにならない。数（そのまま・小さく・隠す）：
 *     PC 一本橋 13・0・1／複数橋 14・0・1／尾根 13・0・1／谷間 15・2・0／水田 12・1・0／大平原 14・0・0。
 *     スマホ相当 一本橋 7・3・4／複数橋 12・1・2／尾根 7・3・4／谷間 9・3・5／水田 9・2・2。
 *     （尾根・谷間・水田は命令なしでは 150 秒までに斬り合いが始まらないので、150 秒の引いた画面で見た）
 * - 状態を読むだけ：号令の効果中の見張り（敗走・全滅の時の兵の割合・守られた部隊の士気。abilities.ts の abilityGuarded を読むだけ）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8204';
const OUT = process.argv[2] || 'e2e-out/fields-group2';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'start,phone,plan,rally').split(',');
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy'];
const GROUP2 = (process.env.FIELDS || 'single_bridge,multi_bridge,ridge,valley,paddy').split(',');
const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const failures = [];
const record = { fields: {}, plan: {}, rally: null };
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 600000, polling: 250 };
const r1 = (x) => Math.round(x * 10) / 10;

const b = await launchBrowser();

async function openTitle(kind) {
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
    const t0 = Date.now();
    await page.goto(`${BASE}/?q=low`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    log(`[${kind}] タイトルまで ${Date.now() - t0} ms`);
    return { ctx, page, phone, kind };
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
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
const ffTo = (page, t) => page.evaluate((t) => window.__battle.fastForward(Math.max(0, t - window.__battle.state.t)), t);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, side: u.side, order: u.order, status: u.status, present: u.present, seen: !!u.seenBy.ally, str: u.strength, str0: u.startStrength, mor: u.morale };
    }, id);
const orderOf = async (page, id) => (await unit(page, id))?.order;
const used = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__battle.state.abilities).map(([k, r]) => [k, r.usedAt])));
const fits = (page) => page.evaluate(() => window.__battle.labelFits());
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const hitAt = (page, x, y) => page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [x, y]);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => `${u.id}:${u.x.toFixed(2)},${u.z.toFixed(2)}:${JSON.stringify(u.order)}`).join('|'));
const inBox = (q, x, y) => x >= q.l && x <= q.r && y >= q.t && y <= q.b;
const overlap = (a, c) => a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
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
    check(JSON.stringify(fields) === JSON.stringify(FIELD_IDS), `[${p.kind}] タイトル →「合戦場の演習」→ 一覧に 10 戦場（第1群 5・第2群 5）`, fields.join(','));
}

/** 一覧 → 説明 → 出陣 → 合戦の画面 → 開始して「指揮」で止める（開始の瞬間だけ時の進みを 0。止めた後に ×1 へ戻す） */
async function listToBattle(p, id) {
    const { page, kind } = p;
    await press(p, `[data-id="field:${id}"]`);
    await waitSheet(page, 'practice-briefing');
    const brief = await page.evaluate(() => ({
        primary: document.querySelector('.g-pr-brief [data-objective="primary"]')?.textContent ?? '',
        secondary: document.querySelectorAll('.g-pr-brief [data-objective="secondary"]').length,
        units: document.querySelectorAll('.g-pr-units tr[data-unit]').length,
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
    return s;
}

/** 全軍撤退のボタン（と確かめ）→ 早送りで決着 */
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
    // 止めたままだと結果の画面が出ないことがあるので、再開してから待つ
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
            h2: document.querySelector('.b-result h2')?.textContent ?? '',
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

/** 部隊の体の、名札に覆われていない所（無ければ真ん中） */
async function bodyPoint(p, id) {
    const s = await p.page.evaluate((id) => window.__battle.screenOf(id), id);
    if (!s) return null;
    const cs = await covers(p.page);
    let q = { x: s.x, y: s.y };
    for (let dy = 0; dy <= 18 && cs.some((c) => inBox(c, q.x, q.y)); dy += 3) q = { x: s.x, y: s.y + dy };
    return { ...q, shown: s.shown };
}
/** 部隊の体を押す（カメラをその部隊へ向けてから。カメラは表示だけ） */
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
/** 札で選ぶ */
async function card(p, id) {
    await bpress(p, `.b-card[data-id="${id}"]`, 200);
    return (await ui(p.page)).selectedId === id;
}

// ================================================================ 名札

/** 点滅している名札それぞれ：見せ方・印が覆われていないか・印の真ん中の当たり */
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
/** 能力の印を 1 回押す（カメラを持ち主へ向けてから）。押す前の当たりと、押した後の使用・漏れを返す */
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
/** 「全体」で引いた密集の場面の名札の確かめ（d）。押した能力の id を返す（無ければ null） */
async function denseLabels(p, id, tag) {
    const { page, kind } = p;
    await bpress(p, '.b-zall', 1200);
    const f0 = await fits(page);
    const shown = f0.filter((f) => f.shown);
    const stat = { t: r1(await simT(page)), shown: shown.length, full: 0, mini: [], hide: [] };
    for (const f of shown) {
        if (f.fit === 'full') stat.full++;
        else stat[f.fit].push(f.id);
    }
    log(`    [${kind}] ${id}${tag}：${stat.t} 秒・名札 ${stat.shown}（そのまま ${stat.full}・小さく ${stat.mini.length} ${stat.mini.join(',')}・隠す ${stat.hide.length} ${stat.hide.join(',')}）`);
    await shot(p, `${id}-dense`);
    const rs = await readyState(page);
    for (const r of rs)
        check(r.fit === 'full' && !!r.badge && r.coveredBy.length === 0 && r.hit?.id === r.id && r.hit?.part === 'badge', `[${kind}] ${id}${tag}：点滅している${r.id}の名札はそのまま見え、印が覆われず、印の真ん中で当たる`, `${r.fit}・覆う ${r.coveredBy.join(',') || 'なし'}`);
    if (stat.hide.length) {
        const hl = await page.evaluate((ids) => ids.map((x) => window.__battle.labelOf(x)), stat.hide);
        check(hl.every((x) => x === null), `[${kind}] ${id}${tag}：一時的に隠した名札（${stat.hide.join(',')}）は当たりにならない`);
    }
    // 小さく・隠された味方（無ければ武将のいない味方）を札で選ぶ → そのまま見え、覆われない
    const allies = f0.filter((f) => f.id.startsWith('a_') && f.shown);
    const pick = allies.find((f) => f.fit !== 'full') ?? allies.find((f) => !GENERALS.includes(f.id));
    if (pick) {
        await card(p, pick.id);
        await page.waitForTimeout(500);
        const fsel = (await fits(page)).find((f) => f.id === pick.id);
        const lsel = await label(page, pick.id);
        const cs = await covers(page);
        const coverSel = lsel ? cs.filter((o) => o.id !== pick.id && overlap(o, lsel)).map((o) => o.id) : ['(見えない)'];
        check(fsel?.sel && fsel.fit === 'full' && !!lsel && coverSel.length === 0, `[${kind}] ${id}${tag}：札で${pick.id}を選ぶ → 名札はそのまま見え（選ぶ前は ${pick.fit}）、ほかの名札に覆われない`, `覆う ${coverSel.join(',') || 'なし'}`);
        const rs2 = await readyState(page);
        check(rs2.every((r) => r.fit === 'full' && r.coveredBy.length === 0 && r.hit?.id === r.id), `[${kind}] ${id}${tag}：選んだ後も、点滅している名札の印はどれも覆われず押せる`, rs2.map((r) => `${r.id}:${r.fit}`).join(' '));
        await shot(p, `${id}-dense-selected`);
    }
    return { stat, pick: pick?.id ?? null, ready: rs.map((r) => r.id) };
}

// ================================================================ 第2群の戦場：選ぶ・動かす・能力・密集の名札

async function group2Checks(p, id) {
    const { page, kind } = p;
    const rec = (record.fields[`${kind}-${id}`] = {});
    // a. 地図の上の体を押して選ぶ（味方のうち、地図に出ている部隊すべて）
    const allies = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally' && u.present && u.status === 'ready').map((u) => u.id));
    let okSel = 0;
    const bad = [];
    for (const aid of allies) {
        const before = await snapshot(page);
        await clickUnit(p, aid, p.phone ? 150 : 180);
        const u = await ui(page);
        if (u.selectedId === aid && before === (await snapshot(page))) okSel++;
        else bad.push(`${aid}→${u.selectedId}`);
    }
    check(okSel === allies.length, `[${kind}] ${id}：味方 ${allies.length} 部隊を地図の上の体を押してそれぞれ選べる（命令・位置に漏れない）`, bad.join(' '));
    rec.selected = `${okSel}/${allies.length}`;
    // b. 地図の上で選んだ部隊（忠勝隊）へ、地面を押して移動（敵・味方から離れた所。南＝味方の側から順に）
    const mover = allies.includes('a_tadakatsu') ? 'a_tadakatsu' : allies[0];
    await clickUnit(p, mover, p.phone ? 150 : 180);
    check((await ui(page)).selectedId === mover, `[${kind}] ${id}：${mover}を地図の上で選ぶ`);
    const st = await page.evaluate(() => window.__battle.state.units.filter((u) => u.present && u.status !== 'destroyed').map((u) => ({ id: u.id, x: u.x, z: u.z, side: u.side })));
    const me = st.find((u) => u.id === mover);
    const cands = [];
    for (const r of [25, 35, 18]) for (const a of [0, 1, 7, 2, 6, 3, 5, 4]) cands.push({ x: me.x + r * Math.sin((a * Math.PI) / 4), z: me.z + r * Math.cos((a * Math.PI) / 4) });
    const good = cands.filter((c) => st.every((u) => u.id === mover || Math.hypot(u.x - c.x, u.z - c.z) > (u.side === 'enemy' ? 60 : 16)));
    let moved = null;
    for (const c of good.slice(0, 6)) {
        await clickGround(p, c.x, c.z, p.phone ? 150 : 180);
        const o = await orderOf(page, mover);
        if (o.type === 'move' && Math.hypot(o.x - c.x, o.z - c.z) < 6) {
            moved = { ...c, o };
            break;
        }
        // 選択が外れていたら選び直す（通れない所なら命令は断られ、選択は残る）
        if ((await ui(page)).selectedId !== mover) await clickUnit(p, mover, p.phone ? 150 : 180);
    }
    check(!!moved, `[${kind}] ${id}：地面を押して${mover}へ移動の命令`, moved ? `(${r1(moved.x)}, ${r1(moved.z)})` : `候補 ${good.length}`);
    rec.move = moved && [r1(moved.x), r1(moved.z)];
    // c. 能力の名札の点滅と、印の 1 回の押し（石川は対象選びになるので、ほかの武将。画面の中央に近い武将から）
    const f = await fits(page);
    const ready = f.filter((x) => x.ab === 'ready').map((x) => x.id);
    check(ready.length >= 3 && ready.every((x) => GENERALS.includes(x)), `[${kind}] ${id}：使える武将の名札が点滅している（徳川の武将だけ）`, ready.join(','));
    const user = ['a_sakai', 'a_tadakatsu', 'a_sakakibara', 'a_ieyasu'].find((x) => ready.includes(x));
    if (user) {
        const u = await unit(page, user);
        await center(p, u.x, u.z, p.phone ? 150 : 180);
        const b1 = (await label(page, user))?.blink;
        await page.waitForTimeout(450);
        const b2 = (await label(page, user))?.blink;
        check(b1 !== undefined && b1 !== b2, `[${kind}] ${id}：止めたままでも${user}の名札の明るさが変わる（点滅）`, `${b1} → ${b2}`);
        const r = await pressBadge(p, user, p.phone ? 150 : 180);
        check(r.ok && r.hit?.id === user && r.hit?.part === 'badge' && !r.leak && r.selKept, `[${kind}] ${id}：${user}の名札の印を 1 回押す → 能力を使う（選択・全部隊の位置と命令に漏れない）`, JSON.stringify({ hit: r.hit, leak: r.leak, sel: [r.sel0, r.sel1], why: r.why }));
        rec.ability = user;
        await shot(p, `${id}-ability`);
    }
    // d. 交戦が始まるまで早送り（斬り合う部隊が 4 つ以上・最長 150 秒）→ 密集の名札
    const e = await page.evaluate(() => {
        const s = window.__battle.state;
        const eng = () => s.units.filter((u) => u.present && u.status === 'ready' && u.engagedWith).length;
        for (let i = 0; i < 150 && eng() < 4 && !s.result; i++) window.__battle.fastForward(1);
        return { t: s.t, engaged: eng(), result: !!s.result };
    });
    if (e.result) log(`    [${kind}] ${id}：交戦の前に決着（密集の名札は省く）`);
    else rec.dense = await denseLabels(p, id, `（${r1(e.t)} 秒・斬り合う ${e.engaged}）`);
}

// ================================================================ start（PC）・phone

async function startPart() {
    const p = await openTitle('desktop');
    await titleToList(p);
    await p.page.screenshot({ path: `${OUT}/desktop-list.png` });
    for (const id of FIELD_IDS) {
        await listToBattle(p, id);
        if (GROUP2.includes(id)) {
            await shot(p, `${id}-start`);
            await group2Checks(p, id);
        }
        await retreatAndFinish(p);
        await resultToList(p, id);
    }
    await p.ctx.close();
}

async function phonePart() {
    const p = await openTitle('phone');
    await titleToList(p);
    for (const id of GROUP2) {
        await listToBattle(p, id);
        await shot(p, `${id}-start`);
        await group2Checks(p, id);
        await retreatAndFinish(p);
        await resultToList(p, id);
    }
    await p.ctx.close();
}

// ================================================================ plan（PC）：地形に合った作戦と正面突破を画面の操作だけで

/**
 * 台本の 1 行：[秒, 部隊, 命令]。命令は
 * - ['tap', x, z]：地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵を押す＝攻撃。テストの tapOrder と同じ）
 * - ['move', x, z]：「移動」→ 地面を押す（テストの mv）
 * - ['attack', 敵]：「攻撃」→ 敵を押す
 * - ['nearest']：見えている一番近い敵へ「攻撃」→ 敵を押す（今の相手が戦えるなら出さない）
 * - ['ability']：名札の印を 1 回押す
 * - ['retreat']：「撤退」のボタン
 * どれも tests/proto3d-field-<戦場>.test.ts の台本と同じ命令・同じ時刻。
 */
const PLANS = {
    // tests/proto3d-field-paddy.test.ts の FIT（命令 13 回）と PUSH（街道だけで押す）
    paddy: {
        fit: [
            [0, 'a_sakai', ['tap', -40, 80]],
            [0, 'a_sakakibara', ['tap', 140, 57]],
            [0, 'a_yumi', ['tap', -20, 130]],
            [0, 'a_tadakatsu', ['tap', 0, 110]],
            [30, 'a_sakakibara', ['tap', 58, 56]],
            [30, 'a_sakakibara', ['ability']],
            [30, 'a_yumi', ['attack', 'e_block']],
            [38, 'a_sakakibara', ['attack', 'e_yumi_e']],
            [45, 'a_sakai', ['tap', -38, 56]],
            [80, 'a_tadakatsu', ['attack', 'e_block']],
            [80, 'a_sakai', ['attack', 'e_block']],
            [80, 'a_sakakibara', ['attack', 'e_block']],
            [110, 'a_konida', ['retreat']],
        ],
        push: [
            ...['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara'].map((id) => [0, id, ['tap', 0, 55]]),
            [0, 'a_yumi', ['tap', 0, 125]],
            [30, 'a_yumi', ['attack', 'e_block']],
            [110, 'a_konida', ['retreat']],
        ],
    },
    // tests/proto3d-field-single_bridge.test.ts の FIT（陽動と浅瀬の守り・命令 20 回）と PUSH（槍・騎馬の五隊で橋頭へ、弓は橋の守りを射る）
    single_bridge: {
        fit: [
            [0, 'a_yumi', ['attack', 'e_guard']],
            [0, 'a_sakakibara', ['move', -167, 10]],
            [0, 'a_kiba', ['move', -155, 25]],
            [0, 'a_ishikawa', ['move', -10, 45]],
            [50, 'a_tadakatsu', ['attack', 'e_guard']],
            [50, 'a_sakai', ['attack', 'e_guard']],
            [50, 'a_ishikawa', ['attack', 'e_guard']],
            [60, 'a_sakakibara', ['attack', 'e_west']],
            [60, 'a_kiba', ['attack', 'e_west']],
            [100, 'a_tadakatsu', ['nearest']],
            [100, 'a_sakai', ['nearest']],
            [100, 'a_ishikawa', ['nearest']],
            [150, 'a_tadakatsu', ['move', 0, -70]],
            [150, 'a_sakai', ['attack', 'e_yumi_e']],
            [150, 'a_ishikawa', ['attack', 'e_yumi_w']],
            [150, 'a_yumi', ['attack', 'e_yumi_e']],
            [150, 'a_sakakibara', ['attack', 'e_yumi_w']],
            [150, 'a_kiba', ['move', -20, -60]],
        ],
        push: [...['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'].map((id) => [0, id, ['move', 0, -72]]), [0, 'a_yumi', ['attack', 'e_guard']]],
    },
    // tests/proto3d-field-ridge.test.ts の FIT（西の登り道から横・忠勝隊は急坂から下から挟む・命令 25 回）と PUSH（五隊で頂へ、弓は頂の弓を射る）
    ridge: {
        fit: [
            [0, 'a_sakakibara', ['tap', -165, -60]],
            [0, 'a_sakai', ['tap', -165, -40]],
            [0, 'a_ishikawa', ['tap', -160, -20]],
            [0, 'a_kiba', ['tap', -150, 0]],
            [60, 'a_sakakibara', ['attack', 'e_shoulder_w']],
            [60, 'a_sakai', ['attack', 'e_shoulder_w']],
            [60, 'a_ishikawa', ['attack', 'e_shoulder_w']],
            [60, 'a_kiba', ['tap', -165, -50]],
            [120, 'a_sakai', ['tap', -60, -60]],
            [120, 'a_ishikawa', ['tap', -60, -42]],
            [120, 'a_kiba', ['attack', 'e_kiba']],
            [120, 'a_sakakibara', ['attack', 'e_kiba']],
            [130, 'a_tadakatsu', ['attack', 'e_summit_w']],
            [160, 'a_sakai', ['attack', 'e_summit_w']],
            [160, 'a_ishikawa', ['attack', 'e_summit_w']],
            [160, 'a_sakakibara', ['attack', 'e_yumi']],
            [160, 'a_kiba', ['attack', 'e_summit_w']],
            [250, 'a_sakai', ['nearest']],
            [250, 'a_ishikawa', ['nearest']],
            [250, 'a_kiba', ['nearest']],
            [250, 'a_tadakatsu', ['nearest']],
            [290, 'a_sakai', ['tap', -10, -62]],
            [290, 'a_ishikawa', ['tap', 10, -62]],
            [290, 'a_tadakatsu', ['tap', 0, -50]],
            [290, 'a_kiba', ['tap', 0, -70]],
        ],
        push: [...['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'].map((id) => [0, id, ['tap', 0, -60]]), [0, 'a_yumi', ['attack', 'e_yumi']]],
    },
};
const PLAN_FIELDS = (process.env.PLANS || 'paddy,single_bridge,ridge').split(',');

/** 見えている一番近い敵（今の相手が戦えるなら null） */
const nearestSeen = (page, id) =>
    page.evaluate((id) => {
        const s = window.__battle.state;
        const u = s.units.find((x) => x.id === id);
        const ok = (x) => x && x.present && x.status === 'ready';
        if (!ok(u)) return { skip: '戦えない' };
        if (u.order.type === 'attack' && ok(s.units.find((x) => x.id === u.order.targetId))) return { skip: `今の相手 ${u.order.targetId}` };
        const e = s.units.filter((x) => x.side === 'enemy' && ok(x) && x.seenBy.ally).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
        return e ? { id: e.id } : { skip: '見えている敵がいない' };
    }, id);

/** 台本の 1 行を画面の操作で出す。出た命令を返す */
async function doStep(p, [, id, step]) {
    const { page } = p;
    let target = step[0] === 'attack' ? step[1] : null;
    if (step[0] === 'nearest') {
        const n = await nearestSeen(page, id);
        if (n.skip) return { ok: true, what: `出さない（${n.skip}）` };
        target = n.id;
    }
    const okCard = await card(p, id);
    if (!okCard) return { ok: false, why: `札で選べない（${(await ui(page)).selectedId}）` };
    if (step[0] === 'ability') {
        const r = await pressBadge(p, id, 200);
        return { ok: r.ok && !r.leak, what: '名札の印', r };
    }
    if (step[0] === 'retreat') {
        await bpress(p, '.b-cmd:has-text("撤退")', 250);
        const o = await orderOf(page, id);
        return { ok: o.type === 'retreat', what: '「撤退」', o };
    }
    if (step[0] === 'tap') {
        const [, x, z] = step;
        target = await page.evaluate(([x, z]) => {
            const e = window.__battle.state.units
                .filter((u) => u.side === 'enemy' && u.present && u.status === 'ready' && u.seenBy.ally && Math.hypot(u.x - x, u.z - z) <= 20)
                .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
            return e?.id ?? null;
        }, [x, z]);
    }
    if ((step[0] === 'tap' || step[0] === 'move') && !target) {
        const [, x, z] = step;
        // 「移動」→ 地面を押す（地面だけでも移動だが、敵・味方の部隊のすぐ近くを押して攻撃・選び直しにならないよう「移動」を先に）
        await bpress(p, '.b-cmd:has-text("移動")', 150);
        await clickGround(p, x, z, 240);
        let o = await orderOf(page, id);
        if (o.type === 'move' && Math.hypot(o.x - x, o.z - z) < 6) return { ok: true, what: `「移動」→ 地面 (${x},${z})`, o };
        // 行き先にほかの味方の部隊が立っている（押すとその部隊を選び直す）：人がするように、すぐ脇の空いた地面を押す（4〜12 m ずらす）
        const other = (await ui(page)).selectedId;
        const me = await unit(page, id);
        const away = Math.hypot(me.x - x, me.z - z);
        // 行き先が自分の隊列の中（押すと自分の体＝選んだまま）：もうそこにいるので、人は命令を出さない（台本の命令は今いる所への移動）
        if (other === id && away < 12) return { ok: true, what: `出さない（行き先 (${x},${z}) は自分の隊列の中。今 ${r1(away)} m）` };
        for (const r of [5, 9, 13])
            for (let a = 0; a < 8; a++) {
                const gx = x + r * Math.sin((a * Math.PI) / 4);
                const gz = z + r * Math.cos((a * Math.PI) / 4);
                if ((await ui(page)).selectedId !== id) await card(p, id);
                await bpress(p, '.b-cmd:has-text("移動")', 150);
                await clickGround(p, gx, gz, 240);
                o = await orderOf(page, id);
                if (o.type === 'move' && Math.hypot(o.x - gx, o.z - gz) < 6) return { ok: true, what: `「移動」→ 地面 (${x},${z}) は${other}が立っていて選び直しになるので、脇 (${r1(gx)},${r1(gz)}) を押す`, o };
            }
        return { ok: false, what: `「移動」→ 地面 (${x},${z})`, o, other };
    }
    const tu = await unit(page, target);
    if (!tu?.seen) return { ok: false, why: `${target}が見えていない（押せない）` };
    await bpress(p, '.b-cmd:has-text("攻撃")', 150);
    await clickUnit(p, target, 220);
    const o = await orderOf(page, id);
    return { ok: o.type === 'attack' && o.targetId === target, what: `「攻撃」→ ${target}を押す`, o };
}

async function playPlan(p, field, name, steps) {
    const { page } = p;
    await listToBattle(p, field);
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    let n = 0;
    let shotAt = false;
    for (const s of q) {
        if ((await page.evaluate(() => window.__battle.state.result))) break;
        if ((await simT(page)) < s[0]) await ffTo(page, s[0]);
        const r = await doStep(p, s);
        if (!String(r.what).startsWith('出さない')) n++;
        check(r.ok, `[desktop] ${field}・${name}：${r1(await simT(page))} 秒 ${s[1]} ← ${r.what ?? s[2][0]}`, r.ok ? '' : JSON.stringify(r));
        if (s[2][0] === 'ability' && !shotAt) {
            shotAt = true;
            await shot(p, `${field}-${name}-ability`);
        }
    }
    if (!p.phone) await page.keyboard.press('Escape');
    // 決着まで早送り（最後の命令の 40 秒後を 1 枚撮る）
    await ffTo(page, q[q.length - 1][0] + 40);
    await bpress(p, '.b-zall', 800);
    await shot(p, `${field}-${name}-mid`);
    await finish(p, 900);
    const res = await resultToList(p, field, `${field}-${name}-result`);
    log(`    ${field}・${name}：命令 ${n} 回 → ${res.result}（${res.reason}）${r1(res.t)} 秒・損害 ${r1(res.loss * 100)}％・主目標 ${res.primary}・副目標 ${res.secondary.join(',')}`);
    record.plan[`${field}-${name}`] = { orders: n, result: res.result, reason: res.reason, t: r1(res.t), loss: r1(res.loss * 100), primary: res.primary, secondary: res.secondary };
    return res;
}

async function planPart() {
    const p = await openTitle('desktop');
    await titleToList(p);
    for (const field of PLAN_FIELDS) {
        const fit = await playPlan(p, field, 'fit', PLANS[field].fit);
        check(fit.result === 'victory' && fit.primary === 'true', `[desktop] ${field}：地形に合った作戦を画面の操作だけで出し、早送りで決着 → 勝つ`, `${r1(fit.t)} 秒・損害 ${r1(fit.loss * 100)}％`);
        const push = await playPlan(p, field, 'push', PLANS[field].push);
        check(push.result !== 'victory' && push.primary !== 'true', `[desktop] ${field}：正面突破を画面の操作で出す → 勝てない（主目標を果たせない）`, `${push.result}・${r1(push.t)} 秒・損害 ${r1(push.loss * 100)}％`);
    }
    await p.ctx.close();
}

// ================================================================ rally（PC）：大平原で号令の直しと密集の名札

async function rallyPart() {
    const p = await openTitle('desktop');
    const { page } = p;
    await titleToList(p);
    await listToBattle(p, 'plains');
    const FRONT = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_yumi'];
    // 命令は出さずに、前線のどれかの士気が 45 を切るまで 0.1 秒ずつ早送り
    const t = await page.evaluate((F) => {
        const shaky = () => window.__battle.state.units.some((u) => F.includes(u.id) && u.present && u.status === 'ready' && u.morale < 45);
        for (let i = 0; i < 1500 && !shaky(); i++) window.__battle.fastForward(0.1);
        return window.__battle.state.t;
    }, FRONT);
    // 能力の欄の説明（家康を札で選ぶ）
    await card(p, 'a_ieyasu');
    await page.waitForTimeout(400);
    const panel = await page.evaluate(() => document.querySelector('.b-abil')?.textContent ?? '');
    check(panel.includes('兵が 3 割を切った部隊') && panel.includes('20 未満に下がら'), '[desktop] 大平原：家康を選ぶと能力の欄の号令の説明に「兵が 3 割を切った部隊は退く」（処理と一致）', panel.slice(panel.indexOf('効果'), panel.indexOf('効果') + 90));
    await page.keyboard.press('Escape');
    // 密集の名札（札で小さく・隠された部隊を選んだまま）
    const dense = await denseLabels(p, 'plains', `（${r1(t)} 秒・前線の士気が 45 を切った）`);
    const sel = (await ui(page)).selectedId;
    // 選んだまま家康の印を 1 回
    const m0 = await page.evaluate(() => Object.fromEntries(window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => [u.id, Math.round(u.morale)])));
    const r = await pressBadge(p, 'a_ieyasu', 260);
    check(r.ok && r.hit?.id === 'a_ieyasu' && r.hit?.part === 'badge' && !r.leak && r.selKept, `[desktop] 大平原：${sel ?? '何も'}を選んだまま家康の名札の印を 1 回押す → 立て直しの号令（漏れない）`, JSON.stringify({ hit: r.hit, leak: r.leak, sel: [r.sel0, r.sel1] }));
    await shot(p, 'plains-rally-use');
    // 効果の 35 秒を早送り。刻みごとに読むだけの見張り（敗走・全滅の時の兵の割合・号令に守られた部隊の士気の最低）
    const w = await page.evaluate(async () => {
        const ab = await import('/src/battle/abilities.ts');
        const s = window.__battle.state;
        const run = s.abilities.a_ieyasu;
        const rec = { usedAt: run.usedAt, until: run.until, minGuardedMorale: 999, prev: {}, routs: [], destroyed: [] };
        window.__battle.fastForward(run.until - s.t + 0.05, (st) => {
            for (const u of st.units) {
                if (u.side !== 'ally') continue;
                const p0 = rec.prev[u.id];
                if (p0 && p0.status === 'ready' && u.status !== 'ready' && st.t <= run.until + 0.1) {
                    if (u.status === 'routed') rec.routs.push({ id: u.id, t: st.t, str: u.strength, ratio: u.strength / u.startStrength, prevRatio: p0.ratio });
                    if (u.status === 'destroyed') rec.destroyed.push({ id: u.id, t: st.t });
                }
                if (u.status === 'ready' && u.present && st.t < run.until && ab.abilityGuarded(st, u)) rec.minGuardedMorale = Math.min(rec.minGuardedMorale, u.morale);
                rec.prev[u.id] = { status: u.status, ratio: u.strength / u.startStrength };
            }
        });
        const ev = s.events.filter((e) => e.t >= run.usedAt - 1e-6 && e.t <= run.until + 0.1 && e.unitId?.startsWith('a_') && (e.kind === 'rout' || e.kind === 'destroyed')).map((e) => ({ t: e.t, kind: e.kind, id: e.unitId, text: e.text }));
        delete rec.prev;
        return { ...rec, ev, t: s.t };
    });
    const m1 = await page.evaluate(() => Object.fromEntries(window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => [u.id, Math.round(u.morale)])));
    log(`    号令（${r1(w.usedAt)}〜${r1(w.until)} 秒）：効果中の味方の敗走 ${w.routs.map((x) => `${x.id} ${r1(x.t)} 秒・兵 ${Math.round(x.str)}（最初の ${Math.round(x.ratio * 100)}％）`).join('／') || 'なし'}・全滅 ${w.destroyed.length}・守られた部隊の士気の最低 ${r1(w.minGuardedMorale)}`);
    log(`      出来事：${w.ev.map((e) => `${r1(e.t)} ${e.kind} ${e.id} ${e.text}`).join('／')}`);
    check(w.routs.length >= 1, '[desktop] 大平原：号令の効果中に兵が減った部隊が退く（敗走する）', w.routs.map((x) => x.id).join(','));
    check(w.routs.every((x) => x.ratio < 0.3 && x.str > 0) && w.ev.filter((e) => e.kind === 'rout').every((e) => e.text.includes('号令でも支えきれない')),
        '[desktop] 大平原：効果中の敗走は、どれも兵が最初の 3 割を切った部隊の「号令でも支えきれない」敗走で、全滅の前（兵が残っている）');
    check(w.destroyed.length === 0 && w.ev.every((e) => e.kind !== 'destroyed'), '[desktop] 大平原：号令の効果中の味方の全滅 0');
    check(w.minGuardedMorale >= 20 - 1e-6, '[desktop] 大平原：号令に守られた部隊（兵 3 割以上）の士気は効果中 20 未満に下がらない', String(r1(w.minGuardedMorale)));
    record.rally = { usedAt: r1(w.usedAt), until: r1(w.until), routs: w.routs.map((x) => ({ id: x.id, t: r1(x.t), str: Math.round(x.str), pct: Math.round(x.ratio * 100) })), destroyed: w.destroyed.length, minGuardedMorale: r1(w.minGuardedMorale), moraleAtUse: [m0, m1], dense: dense.stat };
    await bpress(p, '.b-zall', 800);
    await shot(p, 'plains-rally-end');
    await retreatAndFinish(p);
    await resultToList(p, 'plains');
    await p.ctx.close();
}

if (PARTS.includes('start')) await startPart();
if (PARTS.includes('phone')) await phonePart();
if (PARTS.includes('plan')) await planPart();
if (PARTS.includes('rally')) await rallyPart();
await b.close();
writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
