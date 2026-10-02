/**
 * 第3群 5 戦場の作戦を、画面の操作だけで命令して主目標まで届くかの確認（docs/fields-group3-request.md【確認】「新しい5戦場では、画面操作で命令し、
 * それぞれ少なくとも一つの作戦で主目標まで到達すること」・docs/fields-group3-design.md §5）。
 *   BASE3D=http://localhost:8305 BASE=http://localhost:8305 node e2e/fields-group3-plans.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/fields-group3-plans）
 *   RUNS=desktop:marsh:WEST,phone:temple:COMBO で一部だけ（既定は下の RUNS_DEFAULT）。
 *
 * 作戦の台本はテストのものをそのまま使う（tests/proto3d-field-<戦場>.test.ts の WEST・POST など）。テストの書き換え・写しはしない：
 * 走らせるたびにテストの文から vitest の読み込みを除き、台本の名前を書き出した一時の模块を出力先の gen/ に作り、開発サーバーから読み込む。
 *
 * 1 つの作戦で 3 つの結果を並べる：
 * - A（早送り）：テストの play（0.1 秒の刻みごとに「見てから押す」条件を見る。テストの数字と同じ）。
 * - B（早送り）：同じ台本を 1 秒ごとにだけ見て issueOrder・useAbility で直接出す（人が 1 秒ごとに見て押すのに近い。A との差は見る間隔だけ）。
 * - C（本物の入力・待ちは早送り）：タイトル →「合戦場の演習」→ 一覧 → 説明 →「出陣」→「指揮」で止め、1 秒ごとに状態を読んで（読むだけ）
 *   台本の条件を見て、画面の操作で命令を出し、早送りで 1 秒進める。B との差は画面の操作の差だけ。
 *   - 地面の行き先（tap）：札で部隊を選ぶ → 地図の地面をそのまま押す（移動先指定を使わない、いちばん普通の押し方）。
 *     押した結果がテストの意図（tapOrder：押す点の 20 m 以内に見えている敵がいればその敵への攻撃、ほかは移動）と違えば、ずれとして記録し、
 *     人が直すのと同じ操作で直す（移動なら「移動」で移動先指定にして押し直す・攻撃なら敵の体を押す）。
 *   - 攻撃：札で選ぶ → 敵の体を押す（ずれたら「攻撃」→ 敵の体の近くを押し直す）。
 *   - 能力：名札の印を押す（印が無ければ札で選んで「能力」）。対象の要る能力は、続けて対象の体を押す。
 *   - 防衛・待機・撤退：札で選んで命令のボタン。
 *   - 見えていない敵への攻撃・使えない能力は、テストでも断られる命令（A・B の refused）として数える（画面では押せない・使えない）。
 *   カメラは window.__battle.centerOn（表示だけ）で押す所へ寄せる（人が地図を動かすのと同じ）。
 * 結果は合戦の結果の画面と演習の結果の画面（勝敗・主目標・副目標の行・保存）からも読む。
 *
 * 確認の種類：
 * - 本物の入力：タイトルからの画面の移り・札・地図の押し（地面・敵の体・味方の体）・命令のボタン・名札の印・結果の画面のボタン。
 * - 早送り：待ち（window.__battle.fastForward で 1 秒ずつ。合戦の時間を進めるだけ）と、A・B の台本の通し。
 * - 読むだけ：window.__battle.state（台本の条件・結果）・ui・labelOf・screenOf・screenOfGround。
 * - 状態を直接操作：しない。
 * - 実機・性能：未確認（コンテナはソフトウェア描画）。
 */
import { launchBrowser } from './lib.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8305';
const OUT = process.argv[2] || 'e2e-out/fields-group3-plans';
mkdirSync(OUT, { recursive: true });
const REPO = process.cwd();
const GEN = resolve(OUT, 'gen');
mkdirSync(GEN, { recursive: true });
/** 戦場ごとに、主目標に届く作戦（main）ともう 1 つの作戦 */
const RUNS_DEFAULT = [
    // 主目標に届くことを合格条件にする作戦（MAIN）を先に、スマホ相当の 1 つ、そのあと比べの作戦（記録）
    'desktop:marsh:WEST',
    'desktop:village:POST',
    'desktop:temple:COMBO',
    'desktop:town_edge:WATCH',
    'desktop:siege_front:FRONT',
    'phone:temple:COMBO',
    'desktop:marsh:PREP',
    'desktop:village:FRONTAL',
    'desktop:temple:FRONT',
    'desktop:town_edge:FRONTAL',
    'desktop:siege_front:BASTION',
];
const RUNS = (process.env.RUNS || RUNS_DEFAULT.join(',')).split(',').map((x) => {
    const [kind, field, plan] = x.split(':');
    return { kind, field, plan };
});
/** 主目標まで届くことを合格条件にする作戦（戦場ごとに 1 つ。ほかの作戦は記録） */
const MAIN = { marsh: 'WEST', village: 'POST', temple: 'COMBO', town_edge: 'WATCH', siege_front: 'FRONT' };
const NAMES = {
    marsh: { WEST: '足場伝い', PREP: '準備した土手道（準備した正面攻撃）', COMBO: '組み合わせ', RUSH: '無計画：出口へ一斉', NEAREST: '無計画：当て直すだけ' },
    village: { POST: '西の辻に二隊＋柵の内側の弓', FRONTAL: '通りの口で受ける（準備した正面攻撃）', PLAZA: '広場を固める', FENCE: '広場を固め柵の内側の弓', RESERVE: '予備を回す', UNPLANNED: '無計画' },
    temple: { COMBO: '石段と脇道から同時に', SPLIT: '脇道と林から分けて入る', FRONT: '準備した正面攻撃（全軍で石段から）', CONC: '一方へ集める', RUSH: '無計画' },
    town_edge: { WATCH: '辻で挟み、波を見て弓を回す', EXITS: '出口の前で受ける', FRONTAL: '野へ打って出る（準備した正面攻撃）', STATIC: '動かさない', UNPLANNED: '無計画' },
    siege_front: { FRONT: '準備した正面攻撃（弓で櫓を射すくめる）', BASTION: '側面の拠点を先に', RUSH: '急いで門へ', UNPLANNED: '無計画' },
};
const failures = [];
/** 走らせたコミット（作業ツリーの proto3d・tests・e2e に変更があれば「+変更あり」） */
const COMMIT = (() => {
    try {
        const h = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const dirty = execSync('git status --porcelain -- proto3d tests e2e', { encoding: 'utf8' }).trim();
        return dirty ? `${h}+変更あり` : h;
    } catch {
        return '?';
    }
})();
// 前の記録があれば、今回走らせる作戦の分だけ置き換える（RUNS で一部ずつ走らせても 1 つの record.json にまとまる）
const record = { base: BASE, runs: [] };
try {
    if (existsSync(`${OUT}/record.json`)) record.runs = JSON.parse(readFileSync(`${OUT}/record.json`, 'utf8')).runs ?? [];
} catch {
    record.runs = [];
}
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
    const names = [...new Set([...Object.keys(NAMES[field]), 'play', 'J0'])].filter((n) => new RegExp(`^(?:const|function) ${n}\\b`, 'm').test(src));
    src += `\n// e2e/fields-group3-plans.mjs が足した書き出し（テストの台本を画面の操作で走らせる）\nexport { ${names.join(', ')} };\n`;
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
async function press(p, sel) {
    await p.page.waitForTimeout(450);
    await p.page.locator(sel).first().scrollIntoViewIfNeeded();
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
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
const waitSheet = (page, name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
const ui = (page) => page.evaluate(() => window.__battle.ui);
const simT = (page) => page.evaluate(() => window.__battle.state.t);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, side: u.side, order: u.order, status: u.status, present: u.present, seen: !!u.seenBy.ally };
    }, id);
const orderOf = async (page, id) => (await unit(page, id))?.order;
const abRec = (page, id) => page.evaluate((id) => JSON.stringify(window.__battle.state.abilities[id] ?? null), id);
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const inBox = (q, x, y) => x >= q.l && x <= q.r && y >= q.t && y <= q.b;
const center = (p, x, z, d) => p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d ?? undefined), [x, z, d ?? null]);
const passable = (page, x, z) => page.evaluate(async ([x, z]) => (await import('/src/battle/sim.ts')).passableAt(window.__battle.state, x, z), [x, z]);
async function shot(p, name) {
    await p.page.waitForTimeout(400);
    await p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
    log(`   撮影 ${p.kind}-${name}`);
}

async function titleToList(p) {
    await press(p, '[data-id="practice"]');
    await waitSheet(p.page, 'practice-list');
    await p.page.waitForTimeout(300);
}
/** 一覧 → 説明 → 出陣 → 合戦の画面 → 開始して「指揮」で止める（開始の瞬間だけ時の進みを 0。止めた後に ×1 へ戻す） */
async function listToBattle(p, id) {
    const { page, kind } = p;
    await press(p, `[data-id="field:${id}"]`);
    await waitSheet(page, 'practice-briefing');
    const primary = await page.evaluate(() => document.querySelector('.g-pr-brief [data-objective="primary"]')?.textContent ?? '');
    await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await page.evaluate(() => window.__battle.setTimeScale(0));
    await bpress(p, '.b-primary', 300);
    await bpress(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    const u = await ui(page);
    const map = await page.evaluate(() => window.__battle.state.map.id);
    check(u.started && u.paused && map === id, `[${kind}] ${id}：タイトル →「合戦場の演習」→ 説明 →「出陣」→ 開始して「指揮」で止めた`, `主目標「${primary.slice(0, 40)}」 t=${r1(await simT(page))}`);
}

/** 合戦の結果の画面 →「続ける」→ 演習の結果 →「一覧へ」。結果の行を返す */
async function resultToList(p, id, name) {
    const { page, kind } = p;
    if ((await ui(page)).paused) await bpress(p, '.b-pause', 200);
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.b-robj-row')].map((r) => ({ role: r.dataset.role, achieved: r.dataset.achieved, text: r.textContent.trim() })));
    check(rows.length >= 2 && rows[0].role === 'primary' && rows.slice(1).every((r) => r.role === 'secondary'), `[${kind}] ${id}：合戦の結果の画面に勝敗と別の行で主目標・副目標`, rows.map((r) => `${r.role}:${r.achieved}`).join(' '));
    await shot(p, `${name}-result`);
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
    check(pr.saved === 'true' && pr.rec === pr.outcome && pr.secondary.length === rows.length - 1, `[${kind}] ${id}：演習の結果（勝敗・主目標・副目標が別の行・保存）`, JSON.stringify(pr));
    await shot(p, `${name}-practice`);
    await press(p, '.g-layer[data-sheet="practice-result"] [data-id="list"]');
    await waitSheet(page, 'practice-list');
    return { rows, ...pr };
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
            if (!m[plan]) return { error: `${plan} が書き出されていない（${Object.keys(m).join(',')}）` };
            const J0 = m.J0 ?? { t: (x) => x, d: () => 0 };
            const make = () => (typeof m[plan] === 'function' ? m[plan](J0) : m[plan]);
            const split = (steps) => ({ timed: steps.filter((x) => typeof x[0] === 'number').sort((a, c) => a[0] - c[0]), watch: steps.filter((x) => typeof x[0] === 'function') });
            /** 台本の命令を、画面で出す操作の種類へ（tap は押した時の状態でテストの tapOrder の意図を決める） */
            const resolveCmd = (s, id, c) => {
                if (c === 'nearest') {
                    const n = h.nearestEnemy(s, id);
                    return n ? { kind: 'attack', target: n.targetId, nearest: true } : null;
                }
                if (c === 'ability') return { kind: 'ability' };
                if ('abilityOn' in c) return { kind: 'abilityOn', target: c.abilityOn };
                if ('ability' in c) return c.ability ? { kind: 'abilityOn', target: c.ability } : { kind: 'ability' };
                if ('tap' in c) return { kind: 'tap', x: c.tap[0], z: c.tap[1], intent: h.tapOrder(s, c.tap) };
                if (c.type === 'attack') return { kind: 'attack', target: c.targetId };
                if (c.type === 'move') return { kind: 'tap', x: c.x, z: c.z, intent: c };
                return { kind: c.type };
            };
            const orderOfAct = (a) => (a.kind === 'tap' ? a.intent : a.kind === 'attack' ? { type: 'attack', targetId: a.target } : { type: a.kind });
            const extra = (s) => {
                const g = s.field?.gates?.[0];
                const pr = s.objectives?.primary;
                return { gate: g ? (g.open ? +(g.openedT ?? 0).toFixed(1) : null) : undefined, entered: pr && /breakthrough/.test(pr.def.type) ? pr.entered.length : undefined };
            };
            const summ = (o, t, s, more = {}) => {
                const al = o.units.filter((u) => u.side === 'ally');
                const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
                return {
                    result: o.result,
                    reason: o.reason,
                    t: +t.toFixed(1),
                    loss: +(loss * 100).toFixed(1),
                    primary: o.objectives?.primary?.achieved ?? null,
                    steps: o.objectives?.primary?.steps ?? null,
                    secondary: (o.objectives?.secondary ?? []).map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`),
                    standing: al.filter((u) => u.status === 'ready').length,
                    ...(s ? extra(s) : {}),
                    ...more,
                };
            };
            const live = split(make());
            const fired = new Set();
            window.__g3p = {
                count: live.timed.length + live.watch.length,
                /**
                 * 今の刻みで次に押す命令（時刻の行・条件が初めて真になった行。テストの play と同じ順）。1 つ押すたびに呼び直す
                 * （前の命令が入った状態で次の条件を見る。テストの play は issueOrder の後に次の条件を見るので、まとめて見ると
                 * 「組がみな待機」の条件が始めに続けて真になってしまう）
                 */
                begin() {
                    this.cur = 0;
                },
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
                /** A：テストの play（0.1 秒ごとに見る） */
                playTest() {
                    if (!m.play) return null;
                    const r = m.play(make());
                    // 出口へ入った数は、テストが最後の状態を返すときだけ（湿地の play の entered は刻みの前に書くので、決着の刻みの分が入らない）
                    const pr = r.s?.objectives?.primary;
                    const ent = pr && /breakthrough/.test(pr.def.type) ? pr.entered.length : undefined;
                    return summ(r.o, r.t, null, { refused: r.refused, gate: r.gateT === undefined ? undefined : r.gateT === null ? null : +r.gateT.toFixed(1), entered: ent });
                },
                /** B：同じ台本を every 秒ごとにだけ見て、issueOrder・useAbility で直接出す */
                playEvery(every) {
                    const s = sim.createBattle(fl.buildBattleSetup(fl.getField(field), 'standard'));
                    const { timed, watch } = split(make());
                    const f = new Set();
                    const cmds = [];
                    const refused = [];
                    const run = (st, id, c) => {
                        const a = resolveCmd(st, id, c);
                        if (!a) return;
                        let ok;
                        if (a.kind === 'ability') ok = ab.useAbility(st, id).ok;
                        else if (a.kind === 'abilityOn') ok = ab.useAbility(st, id, a.target).ok;
                        else ok = sim.issueOrder(st, id, orderOfAct(a));
                        cmds.push([+st.t.toFixed(1), id, a.kind === 'tap' ? (a.intent.type === 'attack' ? `atk:${a.intent.targetId}` : `move`) : a.kind === 'attack' ? `atk:${a.target}` : a.kind === 'abilityOn' ? `ab:${a.target}` : a.kind, ok]);
                        if (!ok) refused.push(`${st.t.toFixed(1)}:${id}:${a.kind}`);
                    };
                    const o = sim.runToEnd(s, (st) => {
                        if (every > 0 && Math.abs(st.t / every - Math.round(st.t / every)) > 1e-6) return;
                        while (timed.length && st.t >= timed[0][0] - 1e-9) {
                            const [, id, c] = timed.shift();
                            run(st, id, c);
                        }
                        watch.forEach(([cond, id, c], i) => {
                            if (f.has(i) || !cond(st)) return;
                            f.add(i);
                            run(st, id, c);
                        });
                    });
                    return summ(o, s.t, s, { refused, cmds });
                },
                /**
                 * C の画面の操作で実際に入った命令を書き留める（読むだけ）：味方の部隊の order に書き込みを見る口を付け、
                 * 操作の間（on）に入った命令を、時刻・部隊・命令ごとに並べる。ずれて直す前の命令も入る
                 */
                hook() {
                    const s = window.__battle.state;
                    this.log ??= [];
                    for (const u of s.units) {
                        if (u.side !== 'ally' || u.__g3pHooked) continue;
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
                        Object.defineProperty(u, '__g3pHooked', { value: true, enumerable: false });
                    }
                },
                setOn(i) {
                    this.on = i;
                },
                addAbility(i, id, target) {
                    this.log.push({ t: +window.__battle.state.t.toFixed(1), cmd: i, id, ab: true, target: target ?? null });
                },
                /**
                 * D：C で実際に入った命令（ずれて直す前の命令も含む）を、同じ時刻に issueOrder・useAbility で直接入れ直す（早送り）。
                 * 同じ結果なら、C と B の違いは画面の操作で入った命令の違い（ずれて直す前の命令など）だけで説明がつく
                 */
                replay() {
                    const s = sim.createBattle(fl.buildBattleSetup(fl.getField(field), 'standard'));
                    // 操作 1 回ごとにまとめる（時刻の順）
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
                            const abE = es.find((e) => e.ab);
                            if (!abE) {
                                for (const e of es) if (!sim.issueOrder(st, e.id, e.o)) refused.push(`${e.t}:${e.id}:${e.o.type}`);
                                continue;
                            }
                            // 能力の操作：useAbility を入れ直し、その間に入った命令は、部隊ごとの最後の命令と違うときだけ入れる
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
                    return summ(o, s.t, s, { refused, orders: (this.log ?? []).filter((e) => !e.ab).length });
                },
                /** C の結果（今の合戦） */
                liveResult() {
                    const s = window.__battle.state;
                    return s.result ? summ(s.result, s.t, s) : null;
                },
            };
            return { count: window.__g3p.count };
        },
        [field, plan, url, `/@fs${REPO}/tests/proto3d-group3-helpers.ts`],
    );
}

// ================================================================ 画面の操作（台本の 1 行）

/** 札で選ぶ（選べなければ地図の上の体を押す） */
async function selectUnit(p, id) {
    const { page } = p;
    if ((await ui(page)).selectedId === id) return 'kept';
    if ((await page.locator(`.b-card[data-id="${id}"]`).count()) > 0) {
        await bpress(p, `.b-card[data-id="${id}"]`, 200);
        if ((await ui(page)).selectedId === id) return '札';
    }
    await clickUnit(p, id, p.D);
    return (await ui(page)).selectedId === id ? '体' : null;
}
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
async function tapGround(p, x, z) {
    await center(p, x, z, p.phone ? 220 : 260);
    await p.page.waitForTimeout(250);
    const g = await p.page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
    await pointAt(p, g.x, g.y, 300);
}
async function moveMode(p) {
    await bpress(p, '.b-cmd:has-text("移動")', 300);
}
const ordStr = (o) => (!o ? '?' : o.type === 'attack' ? `攻撃 ${o.targetId}` : o.type === 'move' ? `移動 (${r1(o.x)},${r1(o.z)})` : o.type);

/** 地面の行き先（または移動）：普通に地面を押し、意図と違えば直す */
async function execTap(p, id, a, rec) {
    const { page } = p;
    const want = a.intent;
    const tol = (await passable(page, a.x, a.z)) ? 4 : 25;
    const matches = (o) => (want.type === 'attack' ? o?.type === 'attack' && o.targetId === want.targetId : o?.type === 'move' && Math.hypot(o.x - a.x, o.z - a.z) <= tol);
    const sel = await selectUnit(p, id);
    if (!sel) return { ok: false, why: '選べない' };
    await tapGround(p, a.x, a.z);
    let o = await orderOf(page, id);
    let selNow = (await ui(page)).selectedId;
    rec.natural = `${ordStr(o)}${selNow !== id ? `・選択 ${selNow}` : ''}`;
    if (matches(o) && selNow === id) return { ok: true, how: '地面' };
    rec.diverged = true;
    await selectUnit(p, id);
    if (want.type === 'attack') {
        await clickUnit(p, want.targetId, p.D);
        o = await orderOf(page, id);
        if (!matches(o)) {
            await selectUnit(p, id);
            await bpress(p, '.b-cmd:has-text("攻撃")', 150);
            await clickUnit(p, want.targetId, p.D, 0, 8);
            o = await orderOf(page, id);
        }
        return { ok: matches(o), how: '地面→敵の体', got: ordStr(o) };
    }
    await moveMode(p);
    await tapGround(p, a.x, a.z);
    o = await orderOf(page, id);
    selNow = (await ui(page)).selectedId;
    return { ok: matches(o) && selNow === id, how: '地面→移動先指定', got: ordStr(o) };
}
async function execAttack(p, id, target) {
    const { page } = p;
    const tu = await unit(page, target);
    if (!tu?.seen || tu.status !== 'ready' || !tu.present) return { ok: false, refused: true, why: `${target}が見えていない・戦えない（テストでも断られる）` };
    if (!(await selectUnit(p, id))) return { ok: false, why: '選べない' };
    const okNow = async () => {
        const o = await orderOf(page, id);
        return o?.type === 'attack' && o.targetId === target;
    };
    await clickUnit(p, target, p.D);
    if (await okNow()) return { ok: true, how: '敵の体' };
    const got = ordStr(await orderOf(page, id));
    for (const [dx, dy] of [[0, 8], [10, 0], [-10, 0], [0, -8]]) {
        await selectUnit(p, id);
        await bpress(p, '.b-cmd:has-text("攻撃")', 150);
        await clickUnit(p, target, p.D, dx, dy);
        if (await okNow()) return { ok: true, how: `敵の体→「攻撃」→ 体の脇 (${dx},${dy})`, first: got };
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
    if (target) {
        if ((await ui(page)).pending === 'ability') {
            await clickUnit(p, target, p.D);
            how += ` → ${target}の体`;
        }
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
    if (!a) return null; // nearest で当て直す相手が無い（テストでも出さない）
    // 敗走・全滅した部隊には命令を出せない（sim.ts の canCommand。テストの issueOrder・useAbility でも断られる）
    const me = await unit(p.page, id);
    if (!me || !me.present || me.status !== 'ready') {
        rec.want = a.kind === 'tap' ? ordStr(a.intent) : a.kind;
        rec.key = a.kind === 'tap' ? (a.intent.type === 'attack' ? `atk:${a.intent.targetId}` : 'move') : a.kind === 'attack' ? `atk:${a.target}` : a.kind === 'abilityOn' ? `ab:${a.target}` : a.kind;
        return Object.assign(rec, { ok: false, refused: true, why: `${id}は${me?.status ?? '居ない'}（命令を受けない。テストでも断られる）` });
    }
    const idx = n;
    await p.page.evaluate((i) => {
        window.__g3p.hook();
        window.__g3p.setOn(i);
    }, idx);
    let r;
    if (a.kind === 'tap') {
        rec.want = ordStr(a.intent);
        r = await execTap(p, id, a, rec);
    } else if (a.kind === 'attack') {
        rec.want = `攻撃 ${a.target}${a.nearest ? '（一番近い敵）' : ''}`;
        r = await execAttack(p, id, a.target);
    } else if (a.kind === 'ability' || a.kind === 'abilityOn') {
        rec.want = `能力${a.target ? ` → ${a.target}` : ''}`;
        r = await execAbility(p, id, a.target);
        if (r.ok) await p.page.evaluate(([i, id, t]) => window.__g3p.addAbility(i, id, t), [idx, id, a.target ?? null]);
    } else {
        rec.want = a.kind;
        r = await execButton(p, id, a.kind);
    }
    await p.page.evaluate(() => window.__g3p.setOn(null));
    Object.assign(rec, r);
    rec.key = a.kind === 'tap' ? (a.intent.type === 'attack' ? `atk:${a.intent.targetId}` : 'move') : a.kind === 'attack' ? `atk:${a.target}` : a.kind === 'abilityOn' ? `ab:${a.target}` : a.kind;
    return rec;
}

// ================================================================ 1 つの作戦

async function runPlan({ kind, field, plan }) {
    const name = `${field}-${plan}`;
    const title = `${NAMES[field][plan] ?? plan}（${plan}）`;
    log(`\n== [${kind}] ${field}：${title}`);
    const p = await openTitle(kind);
    try {
        await runPlanIn(p, { kind, field, plan, name, title });
    } finally {
        // 途中で止まっても頁を閉じる（閉じないと合戦の描画が裏で動き続け、次の作戦が重くなる）
        await p.ctx.close().catch(() => {});
    }
}
async function runPlanIn(p, { kind, field, plan, name, title }) {
    const { page } = p;
    await titleToList(p);
    await listToBattle(p, field);
    const ld = await loadPlan(page, field, plan);
    if (ld.error) {
        check(false, `[${kind}] ${name}：台本を読み込む`, ld.error);
        return;
    }
    const A = await page.evaluate(() => window.__g3p.playTest());
    const B = await page.evaluate(() => window.__g3p.playEvery(1));
    const rec = { kind, field, plan, title, at: new Date().toISOString(), commit: COMMIT, lines: ld.count, A, B: { ...B, cmds: undefined }, cmds: [], C: null };
    record.runs = record.runs.filter((x) => !(x.kind === kind && x.field === field && x.plan === plan));
    record.runs.push(rec);
    const fmt = (r) => r && `${r.result}（${r.reason}）${r.t} 秒・損害 ${r.loss}％・主目標 ${r.primary ? '✓' : '✗'}${r.steps ? `（段 ${r.steps.done}／${r.steps.total}）` : ''}・副目標 ${r.secondary.join(' ')}・戦える ${r.standing}${r.gate !== undefined ? `・門 ${r.gate}` : ''}${r.entered !== undefined ? `・出口 ${r.entered}` : ''}${r.refused?.length ? `・断られた ${r.refused.length}` : ''}`;
    log(`    A テストの台本（早送り・0.1 秒ごと）：${fmt(A)}`);
    log(`    B 同じ台本を 1 秒ごとに見る（早送り・直接）：${fmt(B)}`);

    // C：画面の操作
    let st = { t: 0, result: null };
    let nextShot = 0;
    const LIMIT = 1200;
    while (!st.result && st.t < LIMIT) {
        await page.evaluate(() => window.__g3p.begin());
        for (;;) {
            const d = await page.evaluate(() => window.__g3p.next());
            if (!d) break;
            const r = await exec(p, d, rec.cmds.length);
            if (!r) continue;
            rec.cmds.push(r);
            if (!r.ok) log(`    ${r.refused ? '（断られる）' : 'NG'} ${r.t} 秒 ${r.id} ← ${r.want}：${r.why ?? r.got ?? ''}`);
            else if (r.diverged) log(`    ずれ ${r.t} 秒 ${r.id} ← ${r.want}：地面を押すと ${r.natural} → ${r.how}`);
        }
        st = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
        if (st.result) break;
        if (st.t >= nextShot) {
            await bpress(p, '.b-zall', 500);
            await shot(p, `${name}-${Math.round(st.t)}s`);
            nextShot += nextShot === 0 ? 120 : 120;
        }
        await ff(page, 1);
        st = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
    }
    const C = await page.evaluate(() => window.__g3p.liveResult());
    rec.C = C;
    log(`    C 画面の操作（本物の入力・待ちは早送り）：${fmt(C)}`);
    // D：C で入った命令の入れ直し（早送り）。C と同じなら、B との違いは入った命令の違いだけで説明がつく
    const D = await page.evaluate(() => window.__g3p.replay());
    rec.D = D;
    rec.orderLog = await page.evaluate(() => window.__g3p.log ?? []);
    const same = (x, y) => x && y && x.result === y.result && Math.abs(x.t - y.t) < 0.05 && Math.abs(x.loss - y.loss) < 0.05 && x.primary === y.primary && x.secondary.join() === y.secondary.join();
    rec.CeqB = !!same(C, B);
    rec.DeqC = !!same(D, C);
    log(`    D C で入った命令（直す前の命令を含む ${D.orders} 回）を直接入れ直す（早送り）：${fmt(D)}${rec.DeqC ? '（C と同じ）' : '（C と違う）'}`);
    check(rec.DeqC, `[${kind}] ${name}：画面の操作の結果（C）は、そのとき入った命令の入れ直し（D）と同じ（合戦は同じ命令なら同じ結果）`, rec.CeqB ? 'B とも同じ' : 'B との違いは入った命令の違い');
    const cm = rec.cmds;
    const nat = cm.filter((x) => x.ok && !x.diverged).length;
    const div = cm.filter((x) => x.diverged);
    const refused = cm.filter((x) => !x.ok && x.refused);
    const bad = cm.filter((x) => !x.ok && !x.refused);
    rec.counts = { cmds: cm.length, natural: nat, diverged: div.length, refused: refused.length, failed: bad.length };
    log(`    命令 ${cm.length} 回：そのまま ${nat}・ずれて直した ${div.length}・断られた ${refused.length}・出せない ${bad.length}`);
    // B と C の命令の並びの最初の違い（時刻・部隊・中身）
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
    rec.screen = { outcome: res.outcome, primary: res.primary, secondary: res.secondary, rows: res.rows.map((r) => `${r.role}:${r.achieved}:${r.text.slice(0, 40)}`) };
    check(res.outcome === C?.result && String(C?.primary) === res.primary, `[${kind}] ${name}：結果の画面の勝敗・主目標が状態と同じ`, `${res.outcome}・主目標 ${res.primary}`);
    if (MAIN[field] === plan) check(C?.result === 'victory' && C.primary === true, `[${kind}] ${field}：画面の操作で命令し、${title}で主目標まで届く`, fmt(C));
    else log(`    （記録）${title}：主目標 ${C?.primary ? '届く' : '届かない'}`);
}

for (const r of RUNS) {
    try {
        await runPlan(r);
    } catch (e) {
        log(`!! ${r.kind}:${r.field}:${r.plan} の途中で止まった：${e.stack ?? e}`);
        failures.push(`${r.kind}:${r.field}:${r.plan}：例外 ${e.message}`);
    }
    writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
}
await b.close();
writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
