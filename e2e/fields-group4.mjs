/**
 * 第4群（16〜20）の統合の確認（docs/fields-group4-request.md §5・docs/fields-group4-design.md §6）。本物のクリック・タップで、待ちだけ早送り。
 *   BASE3D=http://localhost:8431 BASE=http://localhost:8431 node e2e/fields-group4.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/fields-group4。出力先は repo の中に置く：台本の一時の模块を開発サーバーから読む）
 *   PARTS=start,phone,plans,shorepass,panel で一部だけ（既定はすべて）。RUNS=desktop:rearguard:GUARD,... で plans の作戦を絞る。
 *
 * a. start（PC 1280×720・マウス）：タイトル →「合戦場の演習」→ 一覧に 20 戦場 → 戦場ごとに「出陣」→ 合戦の画面 → 全軍撤退 → 結果 → 演習の結果 → 一覧。
 *    第4群の 5 戦場では続けて：味方の部隊を地図の上の体を押してそれぞれ選ぶ・地面の押しで移動の命令・点滅する名札（止めていても明るさが変わる）・
 *    印 1 回で能力。phone（スマホ横 844×390・タッチ）：第4群の 5 戦場を、タイトルからタップで始め、同じ確かめをタップで。
 *    全軍撤退の結果は、退き方の記録（目標を果たした撤収／合戦の放棄）も読む。
 * b. plans：第4群の 5 戦場の作戦の台本（tests/proto3d-field-<戦場>.test.ts の EAST・DIRECT・GUARD・STEALTH・KISHI など）を、画面の操作だけで
 *    主目標まで通す（e2e/fields-group3-plans.mjs と同じやり方）。テストの書き換え・写しはしない：走らせるたびにテストの文から vitest の読み込みを除き、
 *    上の段の名前をすべて書き出した一時の模块を出力先の gen/ に作り、開発サーバーから読み込む。
 *    - A（早送り）：テストの play（テストの数字と同じ）。
 *    - B（早送り）：同じ台本を 1 秒ごとにだけ見て issueOrder・useAbility・orderAllRetreat で直接出す。
 *    - C（本物の入力・待ちは早送り）：タイトル → 一覧 → 説明 →「出陣」→「指揮」で止め、1 秒ごとに状態を読んで（読むだけ）台本の条件を見て、
 *      画面の操作（札・地図の地面・敵の体・命令のボタン・名札の印・移動先指定・全軍撤退のボタン）で命令を出し、早送りで 1 秒進める。
 *    - D（早送り）：C の間に味方へ実際に入った命令を書き留め、同じ時刻に直接入れ直す。C と同じなら、合戦は同じ命令なら同じ結果。
 *    - E（早送り。C と B が違うときだけ）：B の移動の行き先だけを C で押した点に替える。C と同じなら、違いは押した点の端数だけ。
 *    主目標まで通す作戦（MAIN）：包囲された陣 EAST・援軍救出 DIRECT・退却戦 GUARD・夜襲 STEALTH（PC とスマホ相当）・湖河岸 KISHI。
 * c. 特に見る点（どれも C の画面の操作の中で、刻みごとの見張り（読むだけ）で数える）：
 *    - 包囲された陣（EAST）：総大将が出口から離れた刻みに合戦が終わらず（本陣の喪失にならない）、後に勝つ。
 *    - 援軍救出：触れてすぐ離れる（TOUCH）・能力だけ（ABIL_ONLY）は、長政隊が安全地点の輪に入っても勝たない（TOUCH は 60 秒待ってから全軍撤退＝放棄の記録、
 *      ABIL_ONLY は終わりまで）。DIRECT は合流の後、安全地点の輪に入った刻みに勝つ。出陣前の説明に生存と兵 4 割以上の条件。
 *    - 退却戦：GUARD（忠勝の退路の守護を名札の印で）と GUARD_NO（同じ命令から守護を抜く）で、追い討ちの出来事と退く隊の損害。
 *      ALLRET_EARLY（開始直後の全軍撤退のボタン）は、目標の前に合戦を打ち切らない。勝っても損害が 1 割を超える（追い討ちで崩れる）。
 *      目標を果たした撤収（勝利）と合戦の放棄（援軍救出の TOUCH・a の全軍撤退）の記録と文の違い。
 *      TWO_REAR（殿 2 隊：忠勝隊＋酒井隊を丘に残して順に退く。いちばん良い作戦）は守護を使わずに勝ち、追い討ちの出来事が出ない。
 *    - 夜襲（STEALTH。PC とスマホ相当）：5 秒ごとに、見えていない敵の名札・兵士・画面の位置・表示の層の位置が出ない、一度も見つけていない敵の名前が
 *      合戦の画面の文（札・目標の欄・知らせ・陣営の様子）に出ない、目標の欄が見えていない敵を「区域に敵がいる」と数えない。見つけた敵は名札・兵士が出る。
 *      敵が見つけていない味方を攻撃の相手にした刻み 0。結果の表は、見つけていない敵を「見つけていない」（兵の数を出さない）。
 *    - 詰まり：村落の再現（POST の 150 秒まで）・湖河岸の岸の狭い道のすれ違い（shorepass）で、移動・攻撃の命令のまま 10 秒以上動かない味方なし
 *      （順番待ちは別に記録。sim.ts の waitReason）。説明の欄（panel）：能力の説明の欄の押し・なぞりが命令・選び・地図に漏れない。
 * d. 撮影は出力先に置く（PNG）。plans の全体の画面ごとに、地図の名札どうしの重なり・点滅する印が押しを奪う部品（目標の欄・札など）に覆われないかを見る。
 *
 * 確認の種類：
 * - 本物の入力：タイトルからの画面の移り・札・地図の押し（地面・敵の体・味方の体）・命令のボタン・名札の印・全軍撤退のボタンと確かめ・結果の画面のボタン。
 * - 早送り：待ち（window.__battle.fastForward で 1 秒ずつ。合戦の時間を進めるだけ）、全軍撤退の確かめの前後の時の進みを 0 にする（setTimeScale。
 *   確かめの後に合戦が等速で動き出すのを、画面の「指揮」で止めるまでの間だけ止める）、A・B・D・E の台本の通し。
 * - 読むだけ：window.__battle.state（台本の条件・結果・見張り）・ui・labelOf・labelFits・labelCovers・screenOf・screenOfGround・waitReason・troopStats・view.vis。
 *   カメラは centerOn（表示だけ。人が地図を動かすのと同じ）。
 * - 状態を直接操作：しない。
 * - 実機・性能：未確認（コンテナはソフトウェア描画）。
 */
import { launchBrowser } from './lib.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8431';
const OUT = process.argv[2] || 'e2e-out/fields-group4';
mkdirSync(OUT, { recursive: true });
const REPO = process.cwd();
const GEN = resolve(OUT, 'gen');
mkdirSync(GEN, { recursive: true });
const PARTS = (process.env.PARTS || 'start,phone,plans,shorepass,panel').split(',');
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy', 'marsh', 'village', 'temple', 'town_edge', 'siege_front'];
const GROUP4 = ['besieged_camp', 'relief', 'rearguard', 'night_raid', 'shore'];
const LIST_IDS = [...FIELD_IDS, ...GROUP4];
const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const RUNS_DEFAULT = [
    // 主目標まで通す作戦（MAIN）を先に、スマホ相当の 1 つ、そのあと特に見る点の作戦
    'desktop:besieged_camp:EAST',
    'desktop:relief:DIRECT',
    'desktop:rearguard:GUARD',
    'desktop:night_raid:STEALTH',
    'desktop:shore:KISHI',
    'phone:night_raid:STEALTH',
    'desktop:rearguard:GUARD_NO',
    'desktop:rearguard:ALLRET_EARLY',
    'desktop:rearguard:TWO_REAR',
    'desktop:relief:TOUCH',
    'desktop:relief:ABIL_ONLY',
    'desktop:village:POST',
];
const RUNS = (process.env.RUNS || RUNS_DEFAULT.join(',')).split(',').map((x) => {
    const [kind, field, plan] = x.split(':');
    return { kind, field, plan };
});
const MAIN = { besieged_camp: 'EAST', relief: 'DIRECT', rearguard: 'GUARD', night_raid: 'STEALTH', shore: 'KISHI' };
const NAMES = {
    besieged_camp: { EAST: '東を開いてから総大将を出す（撤退の命令＋退路の守護）', EAST_ALL: '東を開いてから全軍撤退', SOUTH: '南の厚い口を準備して破る' },
    relief: { DIRECT: '急いで直接救う（準備した正面攻撃）', LURE: '引き離してから救う', TOUCH: '合流の輪に触れてすぐ離れる（救出にならない確かめ）', ABIL_ONLY: '後詰めの差配を使うだけ（救出にならない確かめ）' },
    rearguard: { GUARD: '撤退の命令の列＋退路の守護（名札の印）', GUARD_NO: '撤退の命令の列（守護なし）', ALLRET: '全軍撤退のボタン（5 秒）', ALLRET_EARLY: '開始直後の全軍撤退のボタン', TWO_REAR: '殿 2 隊（忠勝隊＋酒井隊）で順に退く', REAR: '殿＋騎馬の横槍', STAY: '殿を前に残すだけ' },
    night_raid: { STEALTH: '隠れて近づく（林の 4 隊）', FEINT: '陽動して隠れて近づく', FRONT: '準備した正面攻撃' },
    shore: { KISHI: '岸を固め、高地に予備', TAKADAI: '高地に主力、岸は忠勝隊だけ', FRONTAL: '岸の外へ打って出る' },
    village: { POST: '西の辻に二隊＋柵の内側の弓（詰まりの再現の 150 秒まで）' },
};
/** 途中で止める作戦（秒）。村落は詰まりの再現の場面（58〜80 秒）を過ぎた 150 秒まで */
const UNTIL = { 'village:POST': 150 };
/**
 * テストの it の中に書かれた確かめの台本（援軍救出の「触れただけ」「能力だけ」。tests/proto3d-field-relief.test.ts の it と同じ命令）。
 * 一時の模块の後ろに足す（テストの道具をそのまま使う）。触れたかどうかは合戦ごとに覚える（WeakSet）
 */
const EXTRA = {
    relief: `
const TOUCH: Plan = () => {
    const touched = new WeakSet<BattleState>();
    const inMeet: Cond = (s) => {
        const u = unitById(s, 'a_ishikawa')!;
        const inside = isActive(u) && inZone(MEET, u.x, u.z);
        if (inside) touched.add(s);
        return inside;
    };
    const leftMeet: Cond = (s) => touched.has(s) && !inMeet(s);
    return [
        ...directPrep(J0),
        [w(gone('e_ring_s'), J0), 'a_ishikawa', tap(60, -108)],
        [inMeet, 'a_ishikawa', tap(60, -60)],
        ...route('a_nagamasa', [[50, -60], [40, 60], [20, 170]], leftMeet, J0),
    ];
};
const ABIL_ONLY: Plan = () => [
    ...directPrep(J0),
    [w(gone('e_ring_s'), J0), 'a_ishikawa', { abilityOn: 'a_nagamasa' }],
    ...route('a_nagamasa', [[50, -60], [40, 60], [20, 170]], gone('e_ring_s'), J0),
];
`,
};
const failures = [];
const COMMIT = (() => {
    try {
        const h = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const dirty = execSync('git status --porcelain -- proto3d tests e2e', { encoding: 'utf8' }).trim();
        return dirty ? `${h}+変更あり` : h;
    } catch {
        return '?';
    }
})();
const record = { base: BASE, commit: COMMIT, runs: [], start: {}, phone: {}, shorepass: null, panel: {} };
try {
    if (existsSync(`${OUT}/record.json`)) Object.assign(record, JSON.parse(readFileSync(`${OUT}/record.json`, 'utf8')), { base: BASE, commit: COMMIT });
} catch {
    /* 前の記録が読めなければ新しく */
}
const saveRecord = () => writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 600000, polling: 250 };
const r1 = (x) => Math.round(x * 10) / 10;

// ================================================================ テストの台本を読み込む一時の模块

const STUB = 'const __stub: any = new Proxy(function () {}, { get: () => __stub, apply: () => __stub }); const describe: any = __stub; const it: any = __stub; const expect: any = __stub;';
const genUrl = {};
function genModule(field) {
    if (genUrl[field]) return genUrl[field];
    let src = readFileSync(`${REPO}/tests/proto3d-field-${field}.test.ts`, 'utf8');
    const before = src;
    src = src.replace(/^import \{[^}]*\} from 'vitest';$/m, STUB);
    if (src === before) throw new Error(`${field}：vitest の読み込みの行が見つからない`);
    src = src.replaceAll("from '../proto3d/src/", "from '/src/").replace(/from '\.\/(proto3d-[^']+)'/g, `from '/@fs${REPO}/tests/$1.ts'`);
    src += EXTRA[field] ?? '';
    const names = [...new Set([...src.matchAll(/^(?:const|function) ([A-Za-z_$][\w$]*)\b/gm)].map((m) => m[1]))];
    src += `\n// e2e/fields-group4.mjs が足した書き出し（テストの台本を画面の操作で走らせる）\nexport { ${names.join(', ')} };\n`;
    const path = `${GEN}/${field}.ts`;
    writeFileSync(path, src);
    return (genUrl[field] = `/@fs${path}`);
}

// ================================================================ 頁

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
    return { ctx, page, phone, kind, D: phone ? 150 : 180 };
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
const waitSheet = (page, name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
const ui = (page) => page.evaluate(() => window.__battle.ui);
const simT = (page) => page.evaluate(() => window.__battle.state.t);
/** 早送り（刻みごとに見張り window.__g4mon.tick を呼ぶ。見張りが無ければ呼ばない） */
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s, window.__g4mon ? (st) => window.__g4mon.tick(st) : undefined), sec);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, side: u.side, order: u.order, status: u.status, present: u.present, seen: !!u.seenBy.ally };
    }, id);
const orderOf = async (page, id) => (await unit(page, id))?.order;
const abRec = (page, id) => page.evaluate((id) => JSON.stringify(window.__battle.state.abilities[id] ?? null), id);
const used = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__battle.state.abilities).map(([k, r]) => [k, r.usedAt])));
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const fits = (page) => page.evaluate(() => window.__battle.labelFits());
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const hitAt = (page, x, y) => page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [x, y]);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => `${u.id}:${u.x.toFixed(2)},${u.z.toFixed(2)}:${JSON.stringify(u.order)}`).join('|'));
const cam = (page) => page.evaluate(() => { const c = window.__battle.camera; return { tx: c.tx, tz: c.tz, dist: c.dist }; });
const sameCam = (a, c) => Math.abs(a.tx - c.tx) < 0.01 && Math.abs(a.tz - c.tz) < 0.01 && Math.abs(a.dist - c.dist) < 0.01;
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, sel);
const inBox = (q, x, y) => x >= q.l && x <= q.r && y >= q.t && y <= q.b;
const center = (p, x, z, d) => p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d ?? undefined), [x, z, d ?? null]);
const passable = (page, x, z) => page.evaluate(async ([x, z]) => (await import('/src/battle/sim.ts')).passableAt(window.__battle.state, x, z), [x, z]);
async function shot(p, name) {
    await p.page.waitForTimeout(400);
    await p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
    log(`   撮影 ${p.kind}-${name}`);
}

// ================================================================ 画面の移り（タイトル → 一覧 → 出陣 → 結果 → 一覧）

async function titleToList(p) {
    await press(p, '[data-id="practice"]');
    await waitSheet(p.page, 'practice-list');
    await p.page.waitForTimeout(300);
    const fields = await p.page.evaluate(() => [...document.querySelectorAll('.g-pr-field')].map((e) => e.dataset.field));
    check(JSON.stringify(fields) === JSON.stringify(LIST_IDS), `[${p.kind}] タイトル →「合戦場の演習」→ 一覧に 20 戦場（第1群〜第4群 5 つずつ）`, `${fields.length}：${fields.slice(15).join(',')}`);
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
        briefing: document.querySelector('.b-modal')?.innerText ?? '',
    }));
    check(s.map === id && s.practice === 'battle' && s.allies === brief.units && s.enemies > 0 && brief.primary.length > 0 && brief.secondary >= 1,
        `[${kind}] ${id}：説明（主目標・副目標が別の行）→「出陣」→ 合戦の画面`, `${Date.now() - t0} ms・味方 ${s.allies}・敵 ${s.enemies}・主目標「${brief.primary.slice(0, 36)}」`);
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-primary', 300);
    await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    const u = await ui(page);
    const nCards = await page.evaluate(() => document.querySelectorAll('.b-card').length);
    check(u.started && u.paused && nCards === s.allies, `[${kind}] ${id}：開始して「指揮」で止めた（札 ${nCards} 枚）`, `t=${await simT(page)}`);
    return { ...s, brief };
}
/** 全軍撤退のボタン → 確かめ →「撤退する」。確かめの後に合戦が等速で動き出すので、その間だけ時の進みを 0 にして「指揮」で止め直す */
async function allRetreatButton(p) {
    const { page } = p;
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-allret', 300);
    await page.waitForSelector('.b-modal .b-primary', { timeout: 30000 });
    const body = await page.evaluate(() => document.querySelector('.b-modal')?.innerText ?? '');
    await bpress(p, '.b-modal .b-primary', 300);
    if (!(await ui(page)).paused) await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    const r = await page.evaluate(() => ({ at: window.__battle.state.allRetreatAt, t: window.__battle.state.t, result: window.__battle.state.result?.result ?? null }));
    return { ...r, body };
}
async function finish(p, max = 900) {
    for (let i = 0; i < max / 30 && !(await p.page.evaluate(() => window.__battle.state.result)); i++) await ff(p.page, 30);
}

/** 合戦の結果の画面 →「続ける」→ 演習の結果 →「一覧へ」。結果の行と退き方の文を返す */
async function resultToList(p, id, name) {
    const { page, kind } = p;
    // 止めたままなら再開して結果の画面を待つ。結果の画面は止めていても終わりから実時間 1.6 秒で出る（battle/entry.ts）ので、
    // 見張りの読みに時間のかかった通し（スマホ相当の夜襲）では、先に結果の画面が「指揮」のボタンを覆う。そのときは押さない
    const u0 = await ui(page);
    if (u0.paused && !u0.resultShown) {
        try {
            if (p.phone) await page.tap('.b-pause', { timeout: 5000 });
            else await page.click('.b-pause', { timeout: 5000 });
        } catch (e) {
            if (!(await ui(page)).resultShown) throw e;
        }
    }
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
        const s = window.__battle.state;
        const al = s.units.filter((u) => u.side === 'ally');
        return {
            result: s.result?.result ?? null,
            reason: s.result?.reason ?? null,
            withdrawal: s.result?.withdrawal ?? null,
            t: s.t,
            loss: 1 - al.reduce((a, u) => a + u.strength, 0) / al.reduce((a, u) => a + u.startStrength, 0),
            reasonText: document.querySelector('.b-result .b-reason')?.textContent ?? '',
            rows: [...document.querySelectorAll('.b-robj-row')].map((r) => ({ role: r.dataset.role, achieved: r.dataset.achieved, text: r.textContent.trim() })),
            table: [...document.querySelectorAll('.b-rtable tr.enemy')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)),
            rtime: document.querySelector('.b-result .b-rtime')?.textContent ?? '',
        };
    });
    check(res.rows.length >= 2 && res.rows[0].role === 'primary' && res.rows.slice(1).every((r) => r.role === 'secondary'), `[${kind}] ${id}：合戦の結果の画面に勝敗と別の行で主目標・副目標`, res.rows.map((r) => `${r.role}:${r.achieved}`).join(' '));
    if (name) await shot(p, `${name}-result`);
    await press(p, '.b-primary');
    await waitSheet(page, 'practice-result');
    await page.waitForTimeout(300);
    const pr = await page.evaluate((id) => ({
        outcome: document.querySelector('.g-pr-result [data-outcome]')?.dataset.outcome,
        primary: document.querySelector('.g-pr-result [data-objective="primary"]')?.dataset.achieved,
        secondary: [...document.querySelectorAll('.g-pr-result [data-objective="secondary"]')].map((e) => e.dataset.achieved),
        saved: document.querySelector('.g-pr-result [data-saved]')?.dataset.saved,
        withdrawalText: document.querySelector('.g-pr-result [data-withdrawal]')?.textContent ?? '',
        rec: window.__practice.records?.status === 'ok' ? window.__practice.records.data.records[id]?.last : null,
    }), id);
    check(pr.outcome === res.result && pr.saved === 'true' && pr.rec?.result === res.result && pr.secondary.length === res.rows.length - 1 && (pr.rec?.withdrawal ?? null) === res.withdrawal,
        `[${kind}] ${id}：演習の結果（勝敗・主目標・副目標が別の行・退き方・保存）`, JSON.stringify({ outcome: pr.outcome, primary: pr.primary, saved: pr.saved, wd: pr.rec?.withdrawal ?? null }));
    if (name) await shot(p, `${name}-practice`);
    await press(p, '.g-layer[data-sheet="practice-result"] [data-id="list"]');
    await waitSheet(page, 'practice-list');
    return { ...res, primary: pr.primary, secondary: pr.secondary, withdrawalText: pr.withdrawalText, saved: pr.saved };
}
/** 退き方の記録と文：目標を果たした撤収（勝利）と合戦の放棄を分けて出す */
function checkWithdrawal(kind, id, res) {
    if (res.withdrawal === 'objective')
        check(res.result === 'victory' && res.reasonText.includes('目標を果たした撤収') && res.withdrawalText.includes('目標を果たした撤収') && !res.withdrawalText.includes('主目標を果たす前'),
            `[${kind}] ${id}：退き方「目標を果たした撤収」（勝利。合戦の放棄ではない）が結果の画面と演習の結果に出る`, `${res.reasonText}／${res.withdrawalText}`);
    else if (res.withdrawal === 'abandoned')
        check(res.result !== 'victory' && res.reasonText.includes('主目標を果たす前に兵を退いた') && res.withdrawalText.includes('合戦の放棄。撤退') && !res.withdrawalText.includes('目標を果たした撤収'),
            `[${kind}] ${id}：退き方「合戦の放棄」（主目標の前に退いた）が結果の画面と演習の結果に出る`, `${res.result}・${res.reasonText}／${res.withdrawalText}`);
    else log(`    （記録）${id}：退き方の区別なし（${res.result}・${res.reason}）「${res.reasonText}」`);
}

// ================================================================ 地図の押し

async function bodyPoint(p, id, dx = 0, dy = 0) {
    const s = await p.page.evaluate((id) => window.__battle.screenOf(id), id);
    if (!s) return null;
    const cs = await covers(p.page);
    let q = { x: s.x + dx, y: s.y + dy };
    for (let k = 3; k <= 18 && cs.some((c) => inBox(c, q.x, q.y)); k += 3) q = { x: s.x + dx, y: s.y + dy + k };
    return q;
}
async function clickUnit(p, id, dist, dx = 0, dy = 0) {
    const u = await unit(p.page, id);
    await center(p, u.x, u.z, dist);
    await p.page.waitForTimeout(250);
    const q = await bodyPoint(p, id, dx, dy);
    if (q) await pointAt(p, q.x, q.y, 300);
}
async function tapGround(p, x, z, dist) {
    await center(p, x, z, dist ?? (p.phone ? 220 : 260));
    await p.page.waitForTimeout(250);
    const g = await p.page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
    await pointAt(p, g.x, g.y, 300);
}
async function moveMode(p) {
    await bpress(p, '.b-cmd:has-text("移動")', 300);
}
/** 札で選ぶ（選べなければ地図の上の体を押す） */
async function selectUnit(p, id) {
    const { page } = p;
    if ((await ui(page)).selectedId === id) return 'kept';
    if ((await page.locator(`.b-card[data-id="${id}"]`).count()) > 0) {
        await page.evaluate((u) => document.querySelector(`.b-card[data-id="${u}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
        await bpress(p, `.b-card[data-id="${id}"]`, 200);
        if ((await ui(page)).selectedId === id) return '札';
    }
    await clickUnit(p, id, p.D);
    return (await ui(page)).selectedId === id ? '体' : null;
}
const ordStr = (o) => (!o ? '?' : o.type === 'attack' ? `攻撃 ${o.targetId}` : o.type === 'move' ? `移動 (${r1(o.x)},${r1(o.z)})` : o.type);

// ================================================================ 名札

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

// ================================================================ a. 第4群の戦場：選ぶ・動かす・能力

async function group4Checks(p, id, rec) {
    const { page, kind } = p;
    const D = p.D;
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
    // 地図の上で選んだ部隊へ、地面を押して移動（通れる所で、敵・味方から離れた所）
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
        let ok = await passable(page, c.x, c.z);
        for (let k = 0; ok && k < 4; k++) ok = await passable(page, c.x + 6 * Math.sin((k * Math.PI) / 2), c.z + 6 * Math.cos((k * Math.PI) / 2));
        if (ok) good.push(c);
        if (good.length >= 6) break;
    }
    let moved = null;
    for (const c of good) {
        await tapGround(p, c.x, c.z, D);
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
    check(ready.length >= 1 && ready.every((x) => GENERALS.includes(x)), `[${kind}] ${id}：使える武将の名札が点滅している（徳川の武将だけ）`, ready.join(','));
    rec.ready = ready;
    const user = ['a_sakai', 'a_tadakatsu', 'a_sakakibara', 'a_ieyasu'].find((x) => ready.includes(x));
    if (user) {
        const u = await unit(page, user);
        await center(p, u.x, u.z, D);
        const bl = [];
        for (const w of [0, 450, 300]) {
            if (w) await page.waitForTimeout(w);
            bl.push((await label(page, user))?.blink);
        }
        check(bl[0] !== undefined && new Set(bl).size > 1, `[${kind}] ${id}：止めたままでも${user}の名札の明るさが変わる（点滅）`, bl.join(' → '));
        const r = await pressBadge(p, user, D);
        check(r.ok && r.hit?.id === user && r.hit?.part === 'badge' && !r.leak && r.selKept, `[${kind}] ${id}：${user}の名札の印を 1 回押す → 能力を使う（選択・全部隊の位置と命令に漏れない）`, JSON.stringify({ hit: r.hit, leak: r.leak, sel: [r.sel0, r.sel1], why: r.why }));
        rec.ability = user;
        await shot(p, `${id}-ability`);
    } else log(`    （記録）${id}：始めに印で使える武将（石川のほか）がいない（${ready.join(',')}）`);
}

async function startPart() {
    const p = await openTitle('desktop');
    try {
        await titleToList(p);
        await p.page.screenshot({ path: `${OUT}/desktop-list.png` });
        for (const id of LIST_IDS) {
            const rec = (record.start[id] = {});
            const s = await listToBattle(p, id);
            if (GROUP4.includes(id)) {
                rec.briefing = s.brief.primary;
                await shot(p, `${id}-start`);
                await group4Checks(p, id, rec);
            }
            const ar = await allRetreatButton(p);
            check(ar.at !== null, `[desktop] ${id}：全軍撤退のボタン → 確かめ →「撤退する」で全軍撤退が始まる`, ar.body.replace(/\s+/g, ' ').slice(0, 80));
            await finish(p);
            const res = await resultToList(p, id, GROUP4.includes(id) ? `${id}-allret` : null);
            Object.assign(rec, { result: res.result, reason: res.reason, withdrawal: res.withdrawal, t: r1(res.t), reasonText: res.reasonText });
            if (GROUP4.includes(id)) checkWithdrawal('desktop', id, res);
            saveRecord();
        }
    } finally {
        await p.ctx.close();
    }
}

async function phonePart() {
    const p = await openTitle('phone');
    try {
        await titleToList(p);
        for (const id of GROUP4) {
            const rec = (record.phone[id] = {});
            await listToBattle(p, id);
            await shot(p, `${id}-start`);
            await group4Checks(p, id, rec);
            const ar = await allRetreatButton(p);
            check(ar.at !== null, `[phone] ${id}：全軍撤退のボタン → 確かめ →「撤退する」`);
            await finish(p);
            const res = await resultToList(p, id, `${id}-allret`);
            Object.assign(rec, { result: res.result, reason: res.reason, withdrawal: res.withdrawal, t: r1(res.t) });
            checkWithdrawal('phone', id, res);
            saveRecord();
        }
    } finally {
        await p.ctx.close();
    }
}

// ================================================================ 見張り（読むだけ。刻みごと）

/**
 * 刻みごとに呼ぶ見張りを頁に置く（window.__g4mon.tick を fastForward の台本に渡す。状態は読むだけ）。
 * - stuck：移動・攻撃の命令のまま、斬り合い・射撃・斬りかかられなしで 10 秒以上 1.5 m も動かない（行き先まで 8 m より遠い）。待っている理由は
 *   sim.ts の waitReason（順番待ち queue・道の無い行き先 noPath・開門待ち gate は分けて記録）。e2e/fields-group3.mjs の見張りと同じ数え方。
 *   longest は部隊ごとの止まっていた最長（順番待ちを除く）。
 * - lake：湖・水面（深い川）の上に出た部隊。blind：敵が見つけていない味方を攻撃の相手にした刻み（夜）。
 * - hq：総大将が戦場を離れた時刻と、その刻みの結果（脱出の目標で本陣の喪失にならないかを見る）。
 * - rescue：救出の合流の秒の最大・長政隊が安全地点の輪に入った時刻と、そのとき合流していたか・結果。
 */
async function installMonitor(page) {
    await page.evaluate(async () => {
        const sim = await import('/src/battle/sim.ts');
        const fr = await import('/src/battle/fieldRules.ts');
        const s0 = window.__battle.state;
        const pr = s0.objectives?.primary?.def;
        const M = { ticks: 0, still: {}, stuck: [], queue: [], blockedGoal: [], gateWait: [], longest: {}, lake: [], blind: 0, blindLog: [], hq: null, rescue: { most: 0, safeT: null, metAtSafe: null, resultAtSafe: null } };
        const water = s0.map.terrain.filter((a) => a.kind === 'river');
        const inA = (a, x, z) => (a.rect ? x > a.rect.x0 + 0.5 && x < a.rect.x1 - 0.5 && z > a.rect.z0 + 0.5 && z < a.rect.z1 - 0.5 : false);
        const d = (a, c) => Math.hypot(a.x - c.x, a.z - c.z);
        M.tick = (st) => {
            M.ticks++;
            const by = new Map(st.units.map((u) => [u.id, u]));
            for (const u of st.units) {
                if (!u.present || u.status !== 'ready') continue;
                // 湖・深い水面（river）の上（浅瀬 ford を除く）
                if (water.some((a) => inA(a, u.x, u.z)) && !sim.passableAt(st, u.x, u.z) && M.lake.length < 10) M.lake.push(`${u.id}@${u.x.toFixed(1)},${u.z.toFixed(1)} t=${st.t.toFixed(1)}`);
                // 夜：敵が見つけていない味方を攻撃の相手にしている
                if (st.setup.night && u.side === 'enemy' && u.order.type === 'attack') {
                    const tg = by.get(u.order.targetId);
                    if (tg && tg.present && !tg.seenBy.enemy) {
                        M.blind++;
                        if (M.blindLog.length < 5) M.blindLog.push(`${u.id}→${tg.id} t=${st.t.toFixed(1)}`);
                    }
                }
                if (u.side !== 'ally') continue;
                const o = u.order;
                const tgt = o.type === 'attack' ? by.get(o.targetId) : null;
                const goal = o.type === 'move' ? o : tgt && tgt.present && tgt.status === 'ready' ? tgt : null;
                const a = M.still[u.id];
                const hitBy = st.units.some((e) => e.side !== u.side && e.present && e.status === 'ready' && e.engagedWith === u.id);
                const close = () => {
                    if (a?.ev && a.ev.dur === null) a.ev.dur = +(st.t - a.t).toFixed(1);
                };
                if (!goal || u.engagedWith || u.shootingAt || hitBy) {
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
                if (d(u, goal) <= 8) continue;
                const why = window.__battle.waitReason(u.id);
                if (why !== 'queue' && why !== 'noPath' && why !== 'gate') M.longest[u.id] = Math.max(M.longest[u.id] ?? 0, +(st.t - a.t).toFixed(1));
                if (a.done || st.t - a.t < 10) continue;
                a.done = true;
                const ev = { id: u.id, t: +a.t.toFixed(1), x: +u.x.toFixed(1), z: +u.z.toFixed(1), order: oj, goalDist: +d(u, goal).toFixed(1), dur: null, why };
                a.ev = ev;
                if (why === 'queue') M.queue.push(ev);
                else if (why === 'noPath') M.blockedGoal.push(ev);
                else if (why === 'gate') M.gateWait.push(ev);
                else M.stuck.push(ev);
            }
            for (const [id, a] of Object.entries(M.still)) {
                const u = by.get(id);
                if (u && u.present && u.status === 'ready') continue;
                if (a.ev && a.ev.dur === null) a.ev.dur = +(st.t - a.t).toFixed(1);
                delete M.still[id];
            }
            // 総大将が戦場を離れた刻み（脱出・撤退）と、その刻みの結果
            const hq = st.units.find((u) => u.side === 'ally' && u.isHq);
            if (hq && !M.hq && hq.status === 'withdrawn') M.hq = { t: +st.t.toFixed(1), result: st.result ? `${st.result.result}/${st.result.reason}` : null, others: st.units.filter((u) => u.side === 'ally' && u.present && u.status === 'ready').length };
            // 救出：合流の秒・安全地点の輪に入った刻み
            if (pr?.type === 'rescue_escort') {
                const p = st.objectives.primary;
                M.rescue.most = Math.max(M.rescue.most, p.sec ?? 0);
                const n = by.get(pr.unitId);
                if (M.rescue.safeT === null && n && n.status === 'ready' && fr.inZone(pr.safeZone, n.x, n.z)) {
                    M.rescue.safeT = +st.t.toFixed(1);
                    M.rescue.metAtSafe = p.metT !== null;
                    M.rescue.resultAtSafe = st.result ? `${st.result.result}/${st.result.reason}` : null;
                }
                M.rescue.metT = p.metT;
            }
        };
        window.__g4mon = M;
    });
}
const monitor = (page) =>
    page.evaluate(() => {
        const M = window.__g4mon;
        return { ticks: M.ticks, stuck: M.stuck, queue: M.queue, blockedGoal: M.blockedGoal, gateWait: M.gateWait, longest: M.longest, lake: M.lake, blind: M.blind, blindLog: M.blindLog, hq: M.hq, rescue: M.rescue };
    });
function checkStuck(kind, tag, m) {
    check(m.stuck.length === 0, `[${kind}] ${tag}：移動・攻撃の命令のまま 10 秒以上動かない味方なし（${m.ticks} 刻み。順番待ち ${m.queue.length}・道の無い行き先 ${m.blockedGoal.length}・開門待ち ${m.gateWait.length} は別に記録）`, JSON.stringify(m.stuck.slice(0, 4)));
    const lg = Object.entries(m.longest).sort((a, c) => c[1] - a[1]).slice(0, 3);
    log(`    止まっていた最長（順番待ち・道の無い行き先・開門待ちを除く）：${lg.map(([id, s]) => `${id} ${s} 秒`).join('・') || 'なし'}`);
    if (m.queue.length) log(`    （記録）順番待ち：${m.queue.map((e) => `${e.id} ${e.t} 秒 (${e.x},${e.z}) ${e.dur ?? '―'} 秒`).join('／')}`);
    if (m.blockedGoal.length) log(`    （記録）道の無い行き先で待つ：${m.blockedGoal.map((e) => `${e.id} ${e.t} 秒 (${e.x},${e.z})`).join('／')}`);
    if (m.gateWait.length) log(`    （記録）開門待ち：${m.gateWait.map((e) => `${e.id} ${e.t} 秒`).join('／')}`);
}

// ================================================================ 夜：未発見の敵の情報が表示の層から漏れない（読むだけ）

const nightLayers = (page) =>
    page.evaluate(() => {
        const B = window.__battle;
        const s = B.state;
        const st = B.troopStats();
        const vis = B.view.vis;
        const rows = s.units
            .map((u, i) => ({ u, i }))
            .filter(({ u }) => u.side === 'enemy' && u.present)
            .map(({ u, i }) => {
                const l = document.querySelector(`.b-label[data-id="${u.id}"]`);
                return {
                    id: u.id,
                    name: u.name,
                    seen: u.seenBy.ally,
                    ever: u.intel.t >= 0,
                    labelShown: !!l && !l.hidden,
                    labelText: l?.textContent ?? '',
                    labelTransform: l?.style.transform ?? '',
                    labelOf: B.labelOf(u.id) !== null,
                    screen: B.screenOf(u.id) !== null,
                    drawn: st.perUnit[u.id] ?? 0,
                    vis: Number.isFinite(vis[i].px) || Number.isFinite(vis[i].pz) || Number.isFinite(vis[i].flagX),
                };
            });
        // 合戦の画面の文（地図の名札・札・目標の欄・知らせ・陣営の様子・案内）。名札は見えている敵の分を除く
        const root = document.querySelector('.b-root');
        const text = root ? root.textContent : '';
        const never = s.units.filter((u) => u.side === 'enemy' && u.intel.t < 0);
        const textLeak = never.filter((u) => text.includes(u.name)).map((u) => u.id);
        const goals = [document.querySelector('.b-goals-sum')?.textContent ?? '', ...[...document.querySelectorAll('.b-goal-p')].map((e) => e.textContent)].join(' / ');
        const zone = s.objectives?.primary?.def?.zone;
        const inZ = (u) => zone?.circle && Math.hypot(u.x - zone.circle.cx, u.z - zone.circle.cz) <= zone.circle.r;
        const enemyIn = s.units.filter((u) => u.side === 'enemy' && u.present && u.status === 'ready' && inZ(u));
        const seenIn = enemyIn.filter((u) => u.seenBy.ally).length;
        return { t: s.t, rows, textLeak, goals, enemyIn: enemyIn.length, seenIn, toasts: [...document.querySelectorAll('.b-toast')].map((e) => e.textContent) };
    });
const layerLeaks = (rows) => rows.filter((r) => !r.seen && (r.labelShown || r.labelText !== '' || r.labelTransform !== '' || r.labelOf || r.screen || r.drawn > 0 || r.vis));

/** 夜の見張り（node 側。5 秒ごと）。見つけた敵は 1 度ずつ寄って、名札・兵士が出るのを見る */
function nightWatcher(p, rec) {
    const N = (rec.night = { checks: 0, leaks: [], textLeaks: [], goalBad: [], shownAfterFound: [], notShown: [], firstSeen: {} });
    const verified = new Set();
    return async () => {
        const { page } = p;
        await page.waitForTimeout(250);
        const L = await nightLayers(page);
        N.checks++;
        const lk = layerLeaks(L.rows);
        if (lk.length && N.leaks.length < 10) N.leaks.push({ t: r1(L.t), ids: lk.map((r) => r.id) });
        if (L.textLeak.length && N.textLeaks.length < 10) N.textLeaks.push({ t: r1(L.t), ids: L.textLeak });
        if (L.enemyIn > 0 && L.seenIn === 0 && L.goals.includes('敵がいる') && N.goalBad.length < 10) N.goalBad.push({ t: r1(L.t), goals: L.goals.slice(0, 80) });
        for (const r of L.rows) if (r.seen && !N.firstSeen[r.id]) N.firstSeen[r.id] = r1(L.t);
        const fresh = L.rows.filter((r) => r.seen && !verified.has(r.id));
        for (const r of fresh.slice(0, 2)) {
            verified.add(r.id);
            const u = await unit(page, r.id);
            await center(p, u.x, u.z, p.D);
            await page.waitForTimeout(500);
            const L2 = await nightLayers(page);
            const q = L2.rows.find((x) => x.id === r.id);
            if (q?.seen) (q.labelShown && q.labelText.length > 0 && q.drawn > 0 && q.screen ? N.shownAfterFound : N.notShown).push(`${r.id}@${r1(L2.t)}${q.labelShown ? '' : '・名札なし'}${q.drawn > 0 ? '' : '・兵士なし'}`);
        }
    };
}

// ================================================================ 台本を頁に置く（条件は頁の状態を読むだけ）

async function loadPlan(page, field, plan) {
    const url = genModule(field);
    return page.evaluate(
        async ([field, plan, url, helpersUrl]) => {
            const m = await import(url);
            const h = await import(helpersUrl);
            const sim = await import('/src/battle/sim.ts');
            const ab = await import('/src/battle/abilities.ts');
            const fl = await import('/src/battle/fields/index.ts');
            if (!m[plan]) return { error: `${plan} が書き出されていない` };
            const J0 = m.J0 ?? { t: (x) => x, d: () => 0 };
            const make = () => (typeof m[plan] === 'function' ? m[plan](J0) : m[plan]);
            const nearestFn = m.nearestEnemy ?? h.nearestEnemy;
            const tapFn = m.tapOrder ?? h.tapOrder;
            const split = (steps) => ({ timed: steps.filter((x) => typeof x[0] === 'number').sort((a, c) => a[0] - c[0]), watch: steps.filter((x) => typeof x[0] === 'function') });
            /** 台本の命令を、画面で出す操作の種類へ（tap は押した時の状態でテストの tapOrder の意図を決める。夜襲はテストの resolve で決める） */
            const resolveCmd = (s, id, c) => {
                if (c === 'allRetreat') return { kind: 'allRetreat' };
                if (m.resolve) {
                    const o = m.resolve(s, id, c);
                    if (!o) return null;
                    if (o === 'ability') return { kind: 'ability' };
                    if (typeof o === 'object' && 'abilityOn' in o) return { kind: 'abilityOn', target: o.abilityOn };
                    if (typeof c === 'object' && ('tap' in c || 'idleTap' in c)) {
                        const [x, z] = c.tap ?? c.idleTap;
                        return { kind: 'tap', x, z, intent: o };
                    }
                    if (o.type === 'move') return { kind: 'tap', x: o.x, z: o.z, intent: o };
                    if (o.type === 'attack') return { kind: 'attack', target: o.targetId };
                    return { kind: o.type };
                }
                if (c === 'nearest') {
                    const n = nearestFn(s, id);
                    return n ? { kind: 'attack', target: n.targetId, nearest: true } : null;
                }
                if (c === 'ability') return { kind: 'ability' };
                if ('abilityOn' in c) return { kind: 'abilityOn', target: c.abilityOn };
                if ('ability' in c) return typeof c.ability === 'string' ? { kind: 'abilityOn', target: c.ability } : { kind: 'ability' };
                if ('tap' in c) return { kind: 'tap', x: c.tap[0], z: c.tap[1], intent: tapFn(s, c.tap) };
                if (c.type === 'attack') return { kind: 'attack', target: c.targetId };
                if (c.type === 'move') return { kind: 'tap', x: c.x, z: c.z, intent: c };
                return { kind: c.type };
            };
            const orderOfAct = (a) => (a.kind === 'tap' ? a.intent : a.kind === 'attack' ? { type: 'attack', targetId: a.target } : { type: a.kind });
            const keyOf = (a) => (a.kind === 'tap' ? (a.intent.type === 'attack' ? `atk:${a.intent.targetId}` : 'move') : a.kind === 'attack' ? `atk:${a.target}` : a.kind === 'abilityOn' ? `ab:${a.target}` : a.kind);
            const extra = (s) => {
                const pr = s.objectives?.primary;
                const ev = s.events;
                return {
                    count: pr?.count ? `${pr.count.done}／${pr.count.total}` : undefined,
                    metT: pr && 'metT' in pr ? (pr.metT === null ? null : +pr.metT.toFixed(1)) : undefined,
                    pursuit: ev.filter((e) => e.kind === 'ai' && e.text.includes('追い討ちをかける')).length,
                    guarded: ev.filter((e) => e.kind === 'ai' && (e.text.includes('が阻む') || e.text.includes('引きつけられた'))).length,
                };
            };
            const summ = (o, t, s, more = {}) => {
                const al = o.units.filter((u) => u.side === 'ally');
                const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
                // 退く隊の損害（退却戦のテストの colLoss と同じ：忠勝隊を除く）
                const col = al.filter((u) => u.id !== 'a_tadakatsu');
                const colLoss = 1 - col.reduce((a, u) => a + u.endStrength, 0) / col.reduce((a, u) => a + u.startStrength, 0);
                return {
                    result: o.result,
                    reason: o.reason,
                    withdrawal: o.withdrawal ?? null,
                    t: +t.toFixed(1),
                    loss: +(loss * 100).toFixed(1),
                    colLoss: +(colLoss * 100).toFixed(1),
                    primary: o.objectives?.primary?.achieved ?? null,
                    secondary: (o.objectives?.secondary ?? []).map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`),
                    standing: al.filter((u) => u.status === 'ready' || u.status === 'withdrawn').length,
                    ...(s ? extra(s) : {}),
                    ...more,
                };
            };
            const live = split(make());
            const fired = new Set();
            window.__g4p = {
                count: live.timed.length + live.watch.length,
                begin() {
                    this.cur = 0;
                },
                /** 今の刻みで次に押す命令（時刻の行・条件が初めて真になった行。テストの play と同じ順）。1 つ押すたびに呼び直す */
                next() {
                    const s = window.__battle.state;
                    if (live.timed.length && s.t >= live.timed[0][0] - 1e-9) {
                        const [t, id, c] = live.timed.shift();
                        return { label: `${t}`, id, a: resolveCmd(s, id, c) };
                    }
                    while (this.cur < live.watch.length) {
                        const i = this.cur++;
                        const [cond, id, c] = live.watch[i];
                        if (fired.has(i) || !cond(s)) continue;
                        fired.add(i);
                        return { label: `when${i}`, id, a: resolveCmd(s, id, c) };
                    }
                    return null;
                },
                /** A：テストの play */
                playTest() {
                    if (!m.play) return null;
                    const r = m.play(make());
                    return summ(r.o, r.t, r.s, { refused: r.refused });
                },
                /** B：同じ台本を every 秒ごとにだけ見て直接出す。E（pts を渡す）：移動の行き先だけを C で押した点に替える */
                playEvery(every, pts = null) {
                    const s = sim.createBattle(fl.buildBattleSetup(fl.getField(field), 'standard'));
                    const { timed, watch } = split(make());
                    const f = new Set();
                    const cmds = [];
                    const refused = [];
                    const run = (st, id, c, label) => {
                        const a = resolveCmd(st, id, c);
                        if (!a) return;
                        const pt = pts?.[`${label}|${id}`];
                        if (a.kind === 'tap' && a.intent.type === 'move' && pt?.type === 'move') a.intent = { ...a.intent, x: pt.x, z: pt.z };
                        let ok;
                        if (a.kind === 'allRetreat') ok = sim.orderAllRetreat(st);
                        else if (a.kind === 'ability') ok = ab.useAbility(st, id).ok;
                        else if (a.kind === 'abilityOn') ok = ab.useAbility(st, id, a.target).ok;
                        else ok = sim.issueOrder(st, id, orderOfAct(a));
                        cmds.push([+st.t.toFixed(1), id, keyOf(a), ok]);
                        if (!ok) refused.push(`${st.t.toFixed(1)}:${id}:${a.kind}`);
                    };
                    const o = sim.runToEnd(s, (st) => {
                        if (every > 0 && Math.abs(st.t / every - Math.round(st.t / every)) > 1e-6) return;
                        while (timed.length && st.t >= timed[0][0] - 1e-9) {
                            const [t, id, c] = timed.shift();
                            run(st, id, c, `${t}`);
                        }
                        watch.forEach(([cond, id, c], i) => {
                            if (f.has(i) || !cond(st)) return;
                            f.add(i);
                            run(st, id, c, `when${i}`);
                        });
                    });
                    return summ(o, s.t, s, { refused, cmds });
                },
                /** C の画面の操作で実際に入った命令を書き留める（読むだけ：味方の order への書き込みを見る） */
                hook() {
                    const s = window.__battle.state;
                    this.log ??= [];
                    for (const u of s.units) {
                        if (u.side !== 'ally' || u.__g4pHooked) continue;
                        let v = u.order;
                        const self = this;
                        Object.defineProperty(u, 'order', {
                            get: () => v,
                            set(n) {
                                v = n;
                                if (self.on !== null && self.on !== undefined) self.log.push({ t: +window.__battle.state.t.toFixed(1), cmd: self.on, id: u.id, o: JSON.parse(JSON.stringify(n)) });
                            },
                            configurable: true,
                            enumerable: true,
                        });
                        Object.defineProperty(u, '__g4pHooked', { value: true, enumerable: false });
                    }
                },
                setOn(i) {
                    this.on = i;
                },
                addSpecial(i, e) {
                    this.log.push({ t: +window.__battle.state.t.toFixed(1), cmd: i, ...e });
                },
                /** D：C で実際に入った命令を、同じ時刻に直接入れ直す（早送り） */
                replay() {
                    const s = sim.createBattle(fl.buildBattleSetup(fl.getField(field), 'standard'));
                    const groups = [];
                    for (const e of this.log ?? []) {
                        const g = groups.at(-1);
                        if (g && g.cmd === e.cmd) g.es.push(e);
                        else groups.push({ cmd: e.cmd, t: e.t, es: [e] });
                    }
                    const refused = [];
                    const o = sim.runToEnd(s, (st) => {
                        while (groups.length && groups[0].t <= st.t + 0.05) {
                            const { es } = groups.shift();
                            if (es.some((e) => e.allRet)) {
                                if (!sim.orderAllRetreat(st)) refused.push(`${es[0].t}:allRetreat`);
                                continue;
                            }
                            const abE = es.find((e) => e.ab);
                            if (!abE) {
                                for (const e of es) if (!sim.issueOrder(st, e.id, e.o)) refused.push(`${e.t}:${e.id}:${e.o.type}`);
                                continue;
                            }
                            if (!ab.useAbility(st, abE.id, abE.target ?? undefined).ok) refused.push(`${abE.t}:${abE.id}:ability`);
                            const last = new Map();
                            for (const e of es) if (!e.ab) last.set(e.id, e);
                            for (const e of last.values()) {
                                const u = sim.unitById(st, e.id);
                                if (u && JSON.stringify(u.order) === JSON.stringify(e.o)) continue;
                                if (!sim.issueOrder(st, e.id, e.o)) refused.push(`${e.t}:${e.id}:${e.o.type}`);
                            }
                        }
                    });
                    return summ(o, s.t, s, { refused, orders: (this.log ?? []).filter((e) => !e.ab && !e.allRet).length });
                },
                /** C の結果（今の合戦）。終わっていなければ途中の様子 */
                liveResult() {
                    const s = window.__battle.state;
                    return s.result ? summ(s.result, s.t, s) : null;
                },
            };
            return { count: window.__g4p.count };
        },
        [field, plan, url, `/@fs${REPO}/tests/proto3d-group3-helpers.ts`],
    );
}

// ================================================================ 画面の操作（台本の 1 行）

/** 地面の行き先（または移動）：普通に地面を押し、意図と違えば直す */
async function execTap(p, id, a, rec) {
    const { page } = p;
    const want = a.intent;
    const tol = (await passable(page, a.x, a.z)) ? 4 : 25;
    const matches = (o) => (want.type === 'attack' ? o?.type === 'attack' && o.targetId === want.targetId : o?.type === 'move' && Math.hypot(o.x - want.x, o.z - want.z) <= tol);
    const sel = await selectUnit(p, id);
    if (!sel) return { ok: false, why: '選べない' };
    await tapGround(p, a.x, a.z);
    let o = await orderOf(page, id);
    let selNow = (await ui(page)).selectedId;
    rec.natural = `${ordStr(o)}${selNow !== id ? `・選択 ${selNow}` : ''}`;
    if (matches(o) && selNow === id) return { ok: true, how: '地面' };
    rec.diverged = true;
    await selectUnit(p, id);
    if (want.type === 'attack') return execAttack(p, id, want.targetId, '地面→');
    await moveMode(p);
    await tapGround(p, want.x, want.z);
    o = await orderOf(page, id);
    selNow = (await ui(page)).selectedId;
    return { ok: matches(o) && selNow === id, how: '地面→移動先指定', got: ordStr(o) };
}
async function execAttack(p, id, target, pre = '') {
    const { page } = p;
    const tu = await unit(page, target);
    if (!tu?.seen || tu.status !== 'ready' || !tu.present) return { ok: false, refused: true, why: `${target}が見えていない・戦えない（テストでも断られる）` };
    if (!(await selectUnit(p, id))) return { ok: false, why: '選べない' };
    const okNow = async () => {
        const o = await orderOf(page, id);
        return o?.type === 'attack' && o.targetId === target;
    };
    await clickUnit(p, target, p.D);
    if (await okNow()) return { ok: true, how: `${pre}敵の体` };
    const got = ordStr(await orderOf(page, id));
    for (const [dx, dy] of [[0, 8], [10, 0], [-10, 0], [0, -8]]) {
        await selectUnit(p, id);
        await bpress(p, '.b-cmd:has-text("攻撃")', 150);
        await clickUnit(p, target, p.D, dx, dy);
        if (await okNow()) return { ok: true, how: `${pre}敵の体→「攻撃」→ 体の脇 (${dx},${dy})`, first: got };
    }
    return { ok: false, why: `攻撃にならない（${ordStr(await orderOf(page, id))}）` };
}
async function execAbility(p, id, target) {
    const { page } = p;
    const before = await abRec(page, id);
    const u = await unit(page, id);
    if (!u || u.status !== 'ready') return { ok: false, refused: true, why: `${id}は戦えない` };
    await center(p, u.x, u.z, p.D);
    await page.waitForTimeout(450);
    const lb = await label(page, id);
    let how;
    if (lb?.badge && lb.ab === 'ready') {
        await pointAt(p, lb.badge.x, lb.badge.y, 650);
        how = '名札の印';
    } else {
        if (!(await selectUnit(p, id))) return { ok: false, why: '選べない' };
        const dis = await page.evaluate(() => document.querySelector('.b-abil-btn')?.disabled ?? true);
        await bpress(p, '.b-abil-btn', 650);
        how = `札→「能力」（印 ${lb?.ab ?? 'なし'}${dis ? '・ボタンは使えない表示' : ''}）`;
    }
    if (target && (await ui(page)).pending === 'ability') {
        await clickUnit(p, target, p.D);
        how += ` → ${target}の体`;
    }
    await page.waitForTimeout(300);
    const after = await abRec(page, id);
    if (after !== before) return { ok: true, how };
    const hint = await page.evaluate(() => [...document.querySelectorAll('.b-toast, .b-hint')].map((e) => e.textContent).join('／').slice(0, 120));
    if ((await ui(page)).pending === 'ability') await page.keyboard.press('Escape');
    return { ok: false, refused: true, why: `使えない（${hint}）`, how };
}
async function execButton(p, id, kind) {
    if (!(await selectUnit(p, id))) return { ok: false, why: '選べない' };
    await bpress(p, `.b-cmd:has-text("${kind === 'hold' ? '防衛・待機' : '撤退'}")`, 300);
    if (kind === 'retreat' && (await p.page.locator('.b-modal .b-primary').count())) await bpress(p, '.b-modal .b-primary', 300);
    const o = await orderOf(p.page, id);
    return { ok: o?.type === kind, how: 'ボタン' };
}
async function exec(p, d, n) {
    const { id, a } = d;
    const rec = { t: r1(await simT(p.page)), id, label: d.label };
    if (!a) return null; // 押す相手・押す時でない（テストでも出さない）
    const keyOf = (a) => (a.kind === 'tap' ? (a.intent.type === 'attack' ? `atk:${a.intent.targetId}` : 'move') : a.kind === 'attack' ? `atk:${a.target}` : a.kind === 'abilityOn' ? `ab:${a.target}` : a.kind);
    rec.key = keyOf(a);
    if (a.kind !== 'allRetreat') {
        const me = await unit(p.page, id);
        if (!me || !me.present || me.status !== 'ready') {
            rec.want = a.kind === 'tap' ? ordStr(a.intent) : a.kind;
            return Object.assign(rec, { ok: false, refused: true, why: `${id}は${me?.status ?? '居ない'}（命令を受けない。テストでも断られる）` });
        }
    }
    await p.page.evaluate((i) => {
        window.__g4p.hook();
        window.__g4p.setOn(i);
    }, n);
    let r;
    if (a.kind === 'allRetreat') {
        rec.want = '全軍撤退';
        await p.page.evaluate((i) => window.__g4p.addSpecial(i, { allRet: true }), n);
        const ar = await allRetreatButton(p);
        r = { ok: ar.at !== null, how: '全軍撤退のボタン → 確かめ', body: ar.body.replace(/\s+/g, ' ').slice(0, 140), resultRightAfter: ar.result };
    } else if (a.kind === 'tap') {
        rec.want = ordStr(a.intent);
        r = await execTap(p, id, a, rec);
    } else if (a.kind === 'attack') {
        rec.want = `攻撃 ${a.target}${a.nearest ? '（一番近い敵）' : ''}`;
        r = await execAttack(p, id, a.target);
    } else if (a.kind === 'ability' || a.kind === 'abilityOn') {
        rec.want = `能力${a.target ? ` → ${a.target}` : ''}`;
        r = await execAbility(p, id, a.target);
        if (r.ok) await p.page.evaluate(([i, id, t]) => window.__g4p.addSpecial(i, { id, ab: true, target: t }), [n, id, a.target ?? null]);
    } else {
        rec.want = a.kind;
        r = await execButton(p, id, a.kind);
    }
    await p.page.evaluate(() => window.__g4p.setOn(null));
    return Object.assign(rec, r);
}

// ================================================================ 名札と目標の表示の重なり（全体の画面）

const measureLabels = (page) =>
    page.evaluate(() => {
        const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
        const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const ov = (a, c) => a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const maps = [...document.querySelectorAll('.b-label.terrain')].filter((e) => vis(e) && e.dataset.fit !== 'hide').map((e) => ({ text: e.textContent, ...R(e) }));
        const onScreen = maps.filter((m) => m.r > 0 && m.l < W && m.b > 0 && m.t < H);
        const mapOverlaps = [];
        for (let i = 0; i < onScreen.length; i++) for (let j = i + 1; j < onScreen.length; j++) if (ov(onScreen[i], onScreen[j])) mapOverlaps.push(`${onScreen[i].text}×${onScreen[j].text}`);
        const steal = [];
        for (const s of ['.b-obj', '.b-goals', '.b-ctrl', '.b-zoom', '.b-cards', '.b-cmds', '.b-hint-x', '.b-abil'])
            for (const e of document.querySelectorAll(s)) if (vis(e) && getComputedStyle(e).pointerEvents !== 'none') steal.push({ s, ...R(e) });
        const badgeHidden = [];
        for (const e of document.querySelectorAll('.b-label[data-ab="ready"]')) {
            const a = e.querySelector('.b-lab-ab');
            if (!vis(e) || !a) continue;
            const bb = R(a);
            for (const k of steal) if (ov(bb, k)) badgeHidden.push(`${e.dataset.id}×${k.s}`);
        }
        // 部隊の名札（見えているもの）と目標の欄の重なり（記録）
        const goalsBox = document.querySelector('.b-goals');
        const gb = goalsBox && vis(goalsBox) ? R(goalsBox) : null;
        const unitUnderGoals = gb ? [...document.querySelectorAll('.b-label:not(.terrain)')].filter((e) => vis(e) && ov(R(e), gb)).map((e) => e.dataset.id) : [];
        const g = document.querySelector('.b-goals');
        const sum = document.querySelector('.b-goals-sum');
        return { maps: onScreen.map((m) => m.text), mapOverlaps, badgeHidden, unitUnderGoals, goals: g ? { closed: g.classList.contains('closed'), sum: sum?.textContent ?? '' } : null };
    });

// ================================================================ 1 つの作戦

async function runPlan({ kind, field, plan }) {
    const name = `${field}-${plan}`;
    const title = `${NAMES[field]?.[plan] ?? plan}（${plan}）`;
    log(`\n== [${kind}] ${field}：${title}`);
    const p = await openTitle(kind);
    try {
        await runPlanIn(p, { kind, field, plan, name, title });
    } finally {
        await p.ctx.close().catch(() => {});
    }
}
async function runPlanIn(p, { kind, field, plan, name, title }) {
    const { page } = p;
    await titleToList(p);
    const lb = await listToBattle(p, field);
    const ld = await loadPlan(page, field, plan);
    if (ld.error) {
        check(false, `[${kind}] ${name}：台本を読み込む`, ld.error);
        return;
    }
    await installMonitor(page);
    const until = UNTIL[`${field}:${plan}`] ?? null;
    const A = until ? null : await page.evaluate(() => window.__g4p.playTest());
    const B = until ? null : await page.evaluate(() => window.__g4p.playEvery(1));
    const rec = { kind, field, plan, title, at: new Date().toISOString(), commit: COMMIT, lines: ld.count, A, B: B && { ...B, cmds: undefined }, cmds: [], C: null };
    record.runs = record.runs.filter((x) => !(x.kind === kind && x.field === field && x.plan === plan));
    record.runs.push(rec);
    const fmt = (r) =>
        r &&
        `${r.result}（${r.reason}${r.withdrawal ? `・${r.withdrawal}` : ''}）${r.t} 秒・損害 ${r.loss}％${field === 'rearguard' ? `（退く隊 ${r.colLoss}％・追い討ち ${r.pursuit}・阻む ${r.guarded}）` : ''}・主目標 ${r.primary ? '✓' : '✗'}${r.count ? `（${r.count}）` : ''}${r.metT !== undefined ? `・合流 ${r.metT}` : ''}・副目標 ${r.secondary.join(' ')}・残る ${r.standing}${r.refused?.length ? `・断られた ${r.refused.length}` : ''}`;
    if (A) log(`    A テストの台本（早送り）：${fmt(A)}`);
    if (B) log(`    B 同じ台本を 1 秒ごとに見る（早送り・直接）：${fmt(B)}`);

    // 援軍救出：出陣前の説明に生存と最低兵力の条件
    if (field === 'relief') {
        const t = lb.brief.text + lb.briefing;
        check(lb.brief.primary.includes('兵 4 割以上') && /崩れる・撤退する・兵が 4 割を切ると負け/.test(t), `[${kind}] relief：出陣前の説明に救出の対象の生存と兵 4 割以上の条件`, lb.brief.primary);
    }
    const watchNight = field === 'night_raid' ? nightWatcher(p, rec) : null;
    // C：画面の操作
    let st = { t: 0, result: null };
    let nextShot = 0;
    let nextNight = 0;
    const LIMIT = 1200;
    let stopNote = null;
    while (!st.result && st.t < LIMIT) {
        await page.evaluate(() => window.__g4p.begin());
        for (;;) {
            const d = await page.evaluate(() => window.__g4p.next());
            if (!d) break;
            const r = await exec(p, d, rec.cmds.length);
            if (!r) continue;
            rec.cmds.push(r);
            if (!r.ok) log(`    ${r.refused ? '（断られる）' : 'NG'} ${r.t} 秒 ${r.id} ← ${r.want}：${r.why ?? r.got ?? ''}`);
            else if (r.diverged) log(`    ずれ ${r.t} 秒 ${r.id} ← ${r.want}：地面を押すと ${r.natural} → ${r.how}`);
            else if (r.key === 'allRetreat') log(`    ${r.t} 秒 全軍撤退（${r.how}）。押した直後の結果 ${r.resultRightAfter ?? 'なし（続く）'}`);
            else if (r.key === 'ability' || r.key.startsWith('ab:')) log(`    ${r.t} 秒 ${r.id} 能力（${r.how}）`);
        }
        st = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
        if (st.result) break;
        if (watchNight && st.t >= nextNight) {
            await watchNight();
            nextNight += 5;
        }
        if (st.t >= nextShot) {
            await bpress(p, '.b-zall', 500);
            const m = await measureLabels(page);
            (rec.labels ??= []).push({ t: r1(st.t), ...m });
            check(m.mapOverlaps.length === 0 && m.badgeHidden.length === 0, `[${kind}] ${name}（${Math.round(st.t)} 秒・全体）：地図の名札どうしが重ならない・点滅する印が押しを奪う部品に覆われない`, `${m.mapOverlaps.join(' ')} ${m.badgeHidden.join(' ')}`.trim());
            if (m.unitUnderGoals.length) log(`    （記録）目標の欄の下の部隊の名札：${m.unitUnderGoals.join(',')}`);
            await shot(p, `${name}-${Math.round(st.t)}s`);
            nextShot += 120;
        }
        // 援軍救出の触れただけ：長政隊が安全地点の輪に入ってから 60 秒待っても勝たない → 全軍撤退（合戦の放棄）
        if (plan === 'TOUCH' && !stopNote) {
            const mo = await monitor(page);
            if (mo.rescue.safeT !== null && st.t >= mo.rescue.safeT + 60) {
                const ar = await allRetreatButton(p);
                stopNote = `長政隊が安全地点の輪に入って（${mo.rescue.safeT} 秒）60 秒たっても勝たない → ${r1(ar.t)} 秒に全軍撤退のボタン`;
                log(`    ${stopNote}`);
                rec.cmds.push({ t: r1(ar.t), id: '*', key: 'allRetreat', want: '全軍撤退（確かめの後の締め）', ok: ar.at !== null, how: '全軍撤退のボタン → 確かめ', extra: true });
                await page.evaluate((i) => window.__g4p.addSpecial(i, { allRet: true }), rec.cmds.length - 1);
            }
        }
        if (until && st.t >= until) {
            stopNote = `${until} 秒で止めた（詰まりの再現の場面の後）`;
            break;
        }
        await ff(page, 1);
        st = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
    }
    // 決着の刻みの後は fastForward が見張りを呼ばないので、最後の状態でもう 1 度見る（安全地点の輪に入った刻みの勝ち・総大将が離れた刻み）
    await page.evaluate(() => window.__g4mon.tick(window.__battle.state));
    const mon = await monitor(page);
    rec.monitor = mon;
    checkStuck(kind, name, mon);
    check(mon.lake.length === 0, `[${kind}] ${name}：湖・深い水面の上へ出た部隊なし`, mon.lake.join(' '));
    if (until) {
        rec.C = { stoppedAt: r1(st.t), note: stopNote };
        log(`    C 画面の操作：${stopNote}`);
        const bad = rec.cmds.filter((x) => !x.ok && !x.refused);
        check(bad.length === 0, `[${kind}] ${name}：台本の命令をすべて画面の操作で出せた（${rec.cmds.length} 回）`, bad.map((x) => `${x.t}:${x.id}:${x.want}:${x.why ?? x.got}`).slice(0, 4).join('／'));
        await shot(p, `${name}-end`);
        return;
    }
    if (stopNote) {
        // 全軍撤退の後は早送りで終わりまで
        await finish(p);
    }
    const C = await page.evaluate(() => window.__g4p.liveResult());
    rec.C = C;
    log(`    C 画面の操作（本物の入力・待ちは早送り）：${fmt(C)}${stopNote ? `（${stopNote}）` : ''}`);
    const D = await page.evaluate(() => window.__g4p.replay());
    rec.D = D;
    rec.orderLog = await page.evaluate(() => window.__g4p.log ?? []);
    const same = (x, y) => x && y && x.result === y.result && Math.abs(x.t - y.t) < 0.05 && Math.abs(x.loss - y.loss) < 0.05 && x.primary === y.primary && x.secondary.join() === y.secondary.join();
    rec.CeqB = !!same(C, B);
    rec.DeqC = !!same(D, C);
    log(`    D C で入った命令（直す前の命令を含む ${D.orders} 回）を直接入れ直す（早送り）：${fmt(D)}${rec.DeqC ? '（C と同じ）' : '（C と違う）'}`);
    check(rec.DeqC, `[${kind}] ${name}：画面の操作の結果（C）は、そのとき入った命令の入れ直し（D）と同じ`, rec.CeqB ? 'B とも同じ' : 'B との違いは入った命令の違い');
    if (!rec.CeqB && !stopNote) {
        const pts = {};
        rec.cmds.forEach((c, i) => {
            const last = rec.orderLog.filter((e) => e.cmd === i && !e.ab && !e.allRet).at(-1);
            if (last) pts[`${c.label}|${c.id}`] = last.o;
        });
        const E = await page.evaluate((pts) => window.__g4p.playEvery(1, pts), pts);
        rec.E = { ...E, cmds: undefined };
        rec.EeqC = !!same(E, C);
        log(`    E B の移動の行き先だけを C で押した点に替える（早送り）：${fmt(E)}${rec.EeqC ? '（C と同じ）' : '（C と違う）'}`);
        log(`    （記録）C と B の違いは${rec.EeqC ? '押した点の端数だけ（合戦の動きがこの差で分かれる）' : '押した点の端数だけでは説明がつかない（下の命令の並びの最初の違いを見る）'}`);
    }
    const cm = rec.cmds.filter((x) => !x.extra);
    const nat = cm.filter((x) => x.ok && !x.diverged).length;
    const div = cm.filter((x) => x.diverged);
    const refused = cm.filter((x) => !x.ok && x.refused);
    const bad = cm.filter((x) => !x.ok && !x.refused);
    rec.counts = { cmds: cm.length, natural: nat, diverged: div.length, refused: refused.length, failed: bad.length };
    log(`    命令 ${cm.length} 回：そのまま ${nat}・ずれて直した ${div.length}・断られた ${refused.length}・出せない ${bad.length}`);
    const bc = B.cmds;
    let firstDiff = null;
    for (let i = 0; i < Math.max(bc.length, cm.length); i++) {
        const x = bc[i];
        const y = cm[i];
        if (!x || !y || x[1] !== y.id || x[2] !== y.key || Math.abs(x[0] - y.t) > 0.05) {
            firstDiff = { i, B: x ? `${x[0]} 秒 ${x[1]} ${x[2]}` : 'なし', C: y ? `${y.t} 秒 ${y.id} ${y.key}` : 'なし' };
            break;
        }
    }
    rec.firstDiff = firstDiff;
    log(`    B と C の命令の並び：${firstDiff ? `${firstDiff.i + 1} 回目から違う（B ${firstDiff.B}／C ${firstDiff.C}）` : `すべて同じ（${bc.length} 回）`}`);
    check(bad.length === 0, `[${kind}] ${name}：台本の命令をすべて画面の操作で出せた（断られた ${refused.length} はテストでも断られる命令）`, bad.map((x) => `${x.t}:${x.id}:${x.want}:${x.why ?? x.got}`).slice(0, 4).join('／'));
    const res = await resultToList(p, field, name);
    rec.screen = { outcome: res.result, primary: res.primary, secondary: res.secondary, withdrawal: res.withdrawal, reasonText: res.reasonText, withdrawalText: res.withdrawalText, rows: res.rows.map((r) => `${r.role}:${r.achieved}:${r.text.slice(0, 40)}`) };
    check(res.result === C?.result && String(C?.primary) === res.primary, `[${kind}] ${name}：結果の画面の勝敗・主目標が状態と同じ`, `${res.result}・主目標 ${res.primary}`);
    checkWithdrawal(kind, field, res);
    if (MAIN[field] === plan) check(C?.result === 'victory' && C.primary === true, `[${kind}] ${field}：画面の操作で命令し、${title}で主目標まで届く`, fmt(C));
    else log(`    （記録）${title}：主目標 ${C?.primary ? '届く' : '届かない'}`);
    await fieldChecks(p, { kind, field, plan, name, rec, C, mon, res });
}

/** 戦場ごとの特に見る点（c） */
async function fieldChecks(p, { kind, field, plan, name, rec, C, mon, res }) {
    if (field === 'besieged_camp') {
        // 総大将が出口から離れた刻みに、合戦は終わらない（本陣の喪失にならない）。後に勝つ
        check(!!mon.hq && (mon.hq.result === null || mon.hq.result.startsWith('victory')) && C.result === 'victory', `[${kind}] ${name}：総大将が出口から離れた刻み（${mon.hq?.t} 秒・残る味方 ${mon.hq?.others}）に合戦は終わらず、本陣の喪失で負けない。${C.t} 秒に勝つ`, JSON.stringify(mon.hq));
    }
    if (field === 'relief') {
        const r = mon.rescue;
        log(`    救出の見張り：合流の秒の最大 ${r1(r.most)}・合流 ${r.metT ?? 'なし'}・安全地点の輪 ${r.safeT ?? 'なし'}（そのとき合流 ${r.metAtSafe}・結果 ${r.resultAtSafe ?? 'なし'}）`);
        rec.rescue = r;
        if (plan === 'TOUCH')
            check(r.most > 0 && r.most < 5 && r.metT === null && r.safeT !== null && r.resultAtSafe === null && C.result !== 'victory' && C.primary === false, `[${kind}] ${name}：合流の輪に触れてすぐ離れた（一緒に ${r1(r.most)} 秒）だけでは合流にならず、長政隊が安全地点の輪に入っても勝たない（最後は全軍撤退＝放棄）`, `${C.result}/${C.reason}・${C.withdrawal}`);
        if (plan === 'ABIL_ONLY') {
            const ev = await p.page.evaluate(() => window.__battle.state.events.some((e) => e.text.startsWith('石川数正隊：「後詰めの差配」— 浅井長政隊')));
            check(ev && r.metT === null && r.safeT !== null && r.resultAtSafe === null && C.result !== 'victory' && C.primary === false, `[${kind}] ${name}：後詰めの差配を長政隊に使っただけでは合流にならず、長政隊が安全地点の輪に入っても勝たない`, `差配 ${ev}・${C.result}/${C.reason}`);
        }
        if (plan === 'DIRECT')
            check(r.metT !== null && r.safeT !== null && r.metAtSafe && r.metT < r.safeT && Math.abs(C.t - r.safeT) < 0.15 && C.result === 'victory', `[${kind}] ${name}：合流（${r.metT} 秒）の後、長政隊が安全地点の輪に入った刻み（${r.safeT} 秒）に勝つ（合流の時には終わらない）`, `${C.t} 秒`);
    }
    if (field === 'rearguard') {
        rec.rear = { pursuit: C.pursuit, guarded: C.guarded, colLoss: C.colLoss, loss: C.loss };
        if (plan === 'GUARD') {
            const g = rec.cmds.find((x) => x.id === 'a_tadakatsu' && x.key === 'ability');
            check(!!g?.ok && g.how === '名札の印', `[${kind}] ${name}：忠勝の退路の守護を名札の印で使った（${g?.t} 秒）`, g?.how ?? '使っていない');
        }
        if (plan === 'GUARD_NO' || plan === 'ALLRET' || plan === 'ALLRET_EARLY') check(C.pursuit > 0, `[${kind}] ${name}：敵が実際に退く隊へ追い討ちをかける（出来事 ${C.pursuit} 回・退く隊の損害 ${C.colLoss}％）`);
        if (plan === 'ALLRET_EARLY') check(C.loss > 10, `[${kind}] ${name}：開始直後の全軍撤退は、勝っても損害が 1 割を超える（${C.loss}％・${C.result}）`);
        if (plan === 'TWO_REAR') {
            const ab = rec.cmds.filter((x) => x.key === 'ability');
            check(C.result === 'victory' && ab.length === 0 && C.pursuit === 0 && C.loss < 10, `[${kind}] ${name}：殿 2 隊で順に退くと、守護を使わずに勝ち（追い討ちの出来事 0）、損害が 1 割以内（${C.loss}％）`, `${C.result}・能力 ${ab.length}・追い討ち ${C.pursuit}`);
        }
        if (plan === 'ALLRET' || plan === 'ALLRET_EARLY') {
            const a = rec.cmds.find((x) => x.key === 'allRetreat');
            check(!!a?.ok && a.resultRightAfter === null && C.t > a.t + 1 && C.withdrawal !== null, `[${kind}] ${name}：全軍撤退のボタン（${a?.t} 秒）で合戦を打ち切らず、退き口の判定で終わる（${C.t} 秒・${C.result}・${C.withdrawal}）`, a?.body ?? '');
            check(/目標に数え/.test(a?.body ?? ''), `[${kind}] ${name}：全軍撤退の確かめに「退き口から離れた部隊は主目標に数え、合戦は続く」の説明`, a?.body ?? '');
        }
    }
    if (field === 'night_raid') {
        const N = rec.night;
        // 結果の表：見つけていない敵は兵の数を出さない
        const unknownRows = res.table.filter((r) => r[2] === '見つけていない');
        const badRows = unknownRows.filter((r) => r[1] !== '―');
        log(`    夜の見張り（5 秒ごと ${N.checks} 回）：初めて見つけた時刻 ${JSON.stringify(N.firstSeen)}`);
        check(N.leaks.length === 0, `[${kind}] ${name}：見えていない敵の名札・兵士・画面の位置・表示の層の位置が出ない（${N.checks} 回）`, JSON.stringify(N.leaks));
        check(N.textLeaks.length === 0, `[${kind}] ${name}：一度も見つけていない敵の名前が合戦の画面の文（札・目標の欄・知らせ・陣営の様子）に出ない`, JSON.stringify(N.textLeaks));
        check(N.goalBad.length === 0, `[${kind}] ${name}：目標の欄は、見えていない敵を「区域に敵がいる」と数えない`, JSON.stringify(N.goalBad));
        check(N.shownAfterFound.length >= 2 && N.notShown.length === 0, `[${kind}] ${name}：見つけた敵は、寄ると名札・兵士・画面の位置が出る（${N.shownAfterFound.join(' ')}）`, N.notShown.join(' '));
        check(mon.blind === 0, `[${kind}] ${name}：敵が見つけていない味方を攻撃の相手にした刻み 0（${mon.ticks} 刻み）`, mon.blindLog.join(' '));
        check(badRows.length === 0 && (unknownRows.length === 0 || res.rtime.includes('見つけていない')), `[${kind}] ${name}：結果の表は、見つけていない敵 ${unknownRows.length} 部隊の兵の数を出さない（「―」・敵の合計から除く）`, `${unknownRows.map((r) => r[0]).join('・')}／${res.rtime}`);
    }
}

/** 退却戦の比べ（守護の有無・全軍撤退）と、退き方の記録の違い（記録の全部の作戦がそろったら） */
function compareRuns() {
    const get = (k, f, pl) => record.runs.find((x) => x.kind === k && x.field === f && x.plan === pl)?.C;
    const g = get('desktop', 'rearguard', 'GUARD');
    const n = get('desktop', 'rearguard', 'GUARD_NO');
    if (g && n) {
        log(`\n== 退却戦：守護の有無（同じ撤退の命令の列。画面の操作）`);
        log(`    守護あり（名札の印）：${g.result}・損害 ${g.loss}％・退く隊 ${g.colLoss}％・追い討ち ${g.pursuit}・阻む／引きつけ ${g.guarded}・副目標 ${g.secondary.join(' ')}`);
        log(`    守護なし：${n.result}・損害 ${n.loss}％・退く隊 ${n.colLoss}％・追い討ち ${n.pursuit}・阻む／引きつけ ${n.guarded}・副目標 ${n.secondary.join(' ')}`);
        check(g.colLoss < n.colLoss && g.pursuit < n.pursuit && g.guarded > 0, '[desktop] 退却戦：同じ画面の操作で、忠勝の守護を使うと追い討ちが減り（阻む・引きつけ）、退く隊の損害が減る', `退く隊 ${g.colLoss}％ 対 ${n.colLoss}％・追い討ち ${g.pursuit} 対 ${n.pursuit}`);
    }
    const a = get('desktop', 'rearguard', 'ALLRET_EARLY') ?? get('desktop', 'rearguard', 'ALLRET');
    const t = get('desktop', 'relief', 'TOUCH');
    if (a && t) {
        log(`\n== 退き方の記録：退却戦の全軍撤退 ${a.result}・${a.withdrawal}／援軍救出の触れただけの後の全軍撤退 ${t.result}・${t.withdrawal}`);
        check(a.withdrawal !== t.withdrawal && t.withdrawal === 'abandoned', '[desktop] 目標を果たした撤収と合戦の放棄が、記録（withdrawal）で分かれる', `${a.withdrawal} 対 ${t.withdrawal}`);
    }
}

// ================================================================ 湖・河岸の岸の狭い道のすれ違い（画面の操作）

async function shorePassPart() {
    const p = await openTitle('desktop');
    const { page } = p;
    try {
        await titleToList(p);
        await listToBattle(p, 'shore');
        await installMonitor(page);
        // 岸の道の弓（115,60）を北の狭い道の中（120,-25）へ、狭まりの忠勝隊（120,-20）を南の岸の道（120,70）へ。狭い道（崖と湖の間・幅 40 m）の中ですれ違う
        const moves = [['a_yumi', 120, -25], ['a_tadakatsu', 120, 70]];
        const got = [];
        for (const [id, x, z] of moves) {
            await selectUnit(p, id);
            await moveMode(p);
            await tapGround(p, x, z, 240);
            const o = await orderOf(page, id);
            got.push(o.type === 'move' && Math.hypot(o.x - x, o.z - z) < 4);
        }
        check(got.every(Boolean), '[desktop] shore：札 →「移動」→ 地面で、弓隊を北の狭い道の中へ・忠勝隊を南の岸の道へ（すれ違う）', JSON.stringify(got));
        const path = [];
        let met = null;
        for (let k = 0; k < 90; k++) {
            await ff(page, 1);
            const s = await page.evaluate(() => {
                const st = window.__battle.state;
                const u = (id) => st.units.find((x) => x.id === id);
                const a = u('a_yumi');
                const c = u('a_tadakatsu');
                return { t: st.t, a: [a.x, a.z, a.order.type], c: [c.x, c.z, c.order.type], d: Math.hypot(a.x - c.x, a.z - c.z), wa: window.__battle.waitReason('a_yumi'), wc: window.__battle.waitReason('a_tadakatsu'), engaged: !!a.engagedWith || !!c.engagedWith };
            });
            if (k % 5 === 0) path.push(`${r1(s.t)}:弓(${r1(s.a[0])},${r1(s.a[1])})忠勝(${r1(s.c[0])},${r1(s.c[1])})`);
            if (!met || s.d < met.d) met = { t: r1(s.t), d: r1(s.d), a: s.a.slice(0, 2).map(r1), c: s.c.slice(0, 2).map(r1) };
            if (k === 8) {
                await center(p, 120, 20, 200);
                await shot(p, 'shorepass-crossing');
            }
            if (s.a[2] === 'hold' && s.c[2] === 'hold') break;
        }
        const end = await page.evaluate(() => {
            const st = window.__battle.state;
            const u = (id) => st.units.find((x) => x.id === id);
            return { t: st.t, a: [u('a_yumi').x, u('a_yumi').z], c: [u('a_tadakatsu').x, u('a_tadakatsu').z] };
        });
        const mon = await monitor(page);
        record.shorepass = { path, closest: met, end, longest: mon.longest, stuck: mon.stuck, queue: mon.queue };
        log(`    すれ違い：いちばん近づいた ${JSON.stringify(met)}・道筋 ${path.join(' ')}`);
        checkStuck('desktop', 'shore のすれ違い', mon);
        const ok = Math.hypot(end.a[0] - 120, end.a[1] + 25) < 10 && Math.hypot(end.c[0] - 120, end.c[1] - 70) < 10;
        check(ok && (mon.longest.a_yumi ?? 0) < 10 && (mon.longest.a_tadakatsu ?? 0) < 10, `[desktop] shore：岸の狭い道で向かい合う 2 隊がすれ違って行き先へ着く（${r1(end.t)} 秒。止まっていた最長 弓 ${mon.longest.a_yumi ?? 0}・忠勝 ${mon.longest.a_tadakatsu ?? 0} 秒）`, JSON.stringify(end));
        await center(p, 120, 20, 240);
        await shot(p, 'shorepass-end');
        const ar = await allRetreatButton(p);
        check(ar.at !== null, '[desktop] shore：全軍撤退のボタン');
        await finish(p);
        const res = await resultToList(p, 'shore', 'shorepass');
        checkWithdrawal('desktop', 'shore', res);
    } finally {
        await p.ctx.close();
    }
}

// ================================================================ 能力の説明の欄の押し・なぞり（第4群の戦場）

async function panelPart(kind) {
    const p = await openTitle(kind);
    const { page } = p;
    try {
        await titleToList(p);
        await listToBattle(p, 'rearguard');
        await selectUnit(p, 'a_tadakatsu');
        await page.waitForTimeout(300);
        const panel = await rect(page, '.b-abil');
        check(!!panel, `[${kind}] rearguard：忠勝隊を選ぶと能力の説明の欄が出る`, JSON.stringify(panel));
        if (!panel) return;
        const snap0 = await snapshot(page);
        const c0 = await cam(page);
        const u0 = await used(page);
        await pointAt(p, panel.x, panel.y, 600);
        let st = await ui(page);
        check(st.selectedId === 'a_tadakatsu' && st.pending === 'none' && (await snapshot(page)) === snap0 && JSON.stringify(await used(page)) === JSON.stringify(u0), `[${kind}] rearguard：説明の欄の真ん中を押す → 選び・全部隊の命令・能力が変わらない（下の地面への移動・攻撃にならない）`, `選び ${st.selectedId}`);
        await drag(p, panel.x, panel.b - 6, panel.x + 10, panel.t + 6);
        st = await ui(page);
        check(sameCam(c0, await cam(page)) && (await snapshot(page)) === snap0 && st.selectedId === 'a_tadakatsu', `[${kind}] rearguard：説明の欄の中をなぞる → 地図は動かず、命令・選びも変わらない`);
        await moveMode(p);
        check((await ui(page)).pending === 'move', `[${kind}] rearguard：「移動」で移動先指定に入る`);
        await pointAt(p, panel.x, panel.y, 600);
        st = await ui(page);
        check(st.pending === 'move' && (await snapshot(page)) === snap0, `[${kind}] rearguard：移動先指定の最中に説明の欄を押す → 移動にならず、移動先指定のまま`, `指定 ${st.pending}`);
        await drag(p, panel.x - 20, panel.y, panel.x + 20, panel.y - 10);
        st = await ui(page);
        check(st.pending === 'move' && (await snapshot(page)) === snap0 && sameCam(c0, await cam(page)), `[${kind}] rearguard：移動先指定の最中に説明の欄をなぞる → 移動にならず、地図も動かない`);
        await shot(p, 'panel-rearguard');
        record.panel[kind] = { panel, ok: true };
    } finally {
        await p.ctx.close();
    }
}

// ================================================================ 通し

try {
    if (PARTS.includes('start')) await startPart();
    saveRecord();
    if (PARTS.includes('phone')) await phonePart();
    saveRecord();
    if (PARTS.includes('plans'))
        for (const r of RUNS) {
            try {
                await runPlan(r);
            } catch (e) {
                log(`!! ${r.kind}:${r.field}:${r.plan} の途中で止まった：${e.stack ?? e}`);
                failures.push(`${r.kind}:${r.field}:${r.plan}：例外 ${e.message}`);
            }
            saveRecord();
        }
    if (PARTS.includes('plans')) compareRuns();
    if (PARTS.includes('shorepass')) await shorePassPart();
    saveRecord();
    if (PARTS.includes('panel')) for (const k of ['desktop', 'phone']) await panelPart(k);
} catch (e) {
    log(`!! 途中で止まった：${e.stack ?? e}`);
    failures.push(`例外：${e.message}`);
}
saveRecord();
await b.close();
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
