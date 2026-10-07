/**
 * 生成イラスト素材（Version 22）の前後比較（開発サーバー）。同じ場面・同じ寄りで「前（?art=old）」と「後（素材あり）」を撮り、並べた絵と、
 * 画面の部品の四角・重なりの確かめの JSON を出す。合戦は、同じ初めの状態・同じ命令の台本で、見せ方を変えても状態の指紋が同じかを比べる。
 *
 *   BASE=http://localhost:8633 node e2e/art-compare.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     MODES=old,default,fixture   old … ?art=old（新しい素材を一つも読まない＝Version 21 の見た目。比べの「前」）
 *                                 default … 何も付けない（ゲームが読む素材の一覧 manifest.gen.json のとおり。今は空なので old と同じになるはず）
 *                                 fixture … ?artFixture=1（開発時だけ。proto3d/dev-art の TEST の模様。配置・縮尺・動きの確かめ用で、見た目の素材ではない）
 *     SIZES=1280x720,844x390      高さ 430 以下はスマホ（タッチ・isMobile）として撮る
 *     QUALITY=low,default         low … ?q=low、default … q を付けない
 *     SCENES=story,battle         story … 会話（城門の忠勝）と軍議、battle … 大平原の演習（編成の表 practice-briefing・全体・忠勝を選ぶ・家康を選ぶ）
 *     IDENTITY=1                  合戦の同一性（最初の SIZES・QUALITY の battle の続きで、台本の命令で終わりまで進め、指紋を見せ方ごとに比べる。0 で省く）
 *     WALK=0                      1 なら忠勝の前まで本物の入力（W／左のスティック）で歩く。既定は開発用の teleport（毎回同じ位置・向き＝写真を比べられる）
 *     CAM_LOCK=1                  合戦の「全体」のカメラが最初の見せ方と違ったら、同じカメラに合わせる（開発用の centerOn。報告に書き、違い自体は NG にする）
 *     V21_DIR=<dir>               Version 21 のときの写真（同じ名前：<場面>-<幅>x<高さ>.png、既定の画質は -high）があれば、並べた絵の右に参考として足す
 *
 * 出力：<出力先>/shots/<場面>-<見せ方>-<幅>x<高さ>-<画質>.png、<出力先>/montage/<場面>-<幅>x<高さ>-<画質>.png（MODES の順に左から。4 枚以上は 2 列。上に見せ方と、前との画素の違いの割合）、
 *       <出力先>/layout.json（撮った場面ごとの部品の四角・人物画・背景・顔・重なりの確かめ）、<出力先>/report.json（確かめの一覧・手順の本物の入力／開発用の操作・合戦の指紋）。
 * 入力の記録：タイトル・はじめから・演出のスキップ・話す・会話を進める・選ぶ・演習の入口・戦場・出陣・開始・指揮・札は本物のクリック／タップ／キー。
 *   開発用の操作（__game・__battle・__p3）：忠勝の前への teleport（WALK=0）・会話の場面の手動の描画（render=manual の renderNow）・合戦の時間合わせ（fastForward で 3 秒ちょうど）・
 *   カメラ合わせ（CAM_LOCK）・同一性の台本（setScript・order・setTimeScale・pause）・読むだけの数え上げ（art・camera・troopStats・state）。
 * 注意：fixture（TEST の模様）の写真は、配置・重なり・動きの確かめにだけ使う。見た目の改善の証拠にはしない。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boxesOverlap, launchBrowser, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://localhost:8633';
const OUT = resolve(process.argv[2] || 'e2e-out/art-compare');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const MODES = list(process.env.MODES, 'old,default,fixture');
const SIZES = list(process.env.SIZES, '1280x720,844x390');
const QUALITY = list(process.env.QUALITY, 'low,default');
const SCENES = list(process.env.SCENES, 'story,battle');
const IDENTITY = process.env.IDENTITY !== '0';
const WALK = process.env.WALK === '1';
const CAM_LOCK = process.env.CAM_LOCK !== '0';
const V21_DIR = process.env.V21_DIR || '';
const MODE_Q = { old: 'art=old', default: '', fixture: 'artFixture=1' };
const MODE_LABEL = {
    old: 'BEFORE  ?art=old (V21 look)',
    default: 'AFTER  default build',
    fixture: 'AFTER  ?artFixture=1  [TEST fixture - placement only, NOT art]',
};
for (const m of MODES) if (!(m in MODE_Q)) throw new Error(`MODES に知らない見せ方 ${m}`);
const SHOTS = `${OUT}/shots`;
const MONT = `${OUT}/montage`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(MONT, { recursive: true });

const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = { timeout: 600000, polling: 200 };
const checks = [];
const check = (ok, what, detail) => {
    checks.push({ ok: !!ok, what, detail });
    console.log(`${ok ? '  ok ' : '  NG '} ${what}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

// 素材の一覧（ゲームが読む物・開発用の TEST の物）の数。並べた絵の見出しと報告に書く
const readJson = (p) => {
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
};
const genManifest = readJson(resolve('proto3d/src/art/manifest.gen.json'));
const devManifest = readJson(resolve('proto3d/dev-art/manifest.json'));
const genCount = Object.keys(genManifest?.assets ?? {}).length;
const devCount = Object.keys(devManifest?.assets ?? {}).length;
MODE_LABEL.default = `AFTER  default build (manifest: ${genCount} assets)`;
let commit = '';
try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
} catch {}

const report = { base: BASE, commit, modes: MODES, sizes: SIZES, quality: QUALITY, scenes: SCENES, manifest: { generated: genCount, devFixture: devCount }, walk: WALK, runs: {}, identity: {}, montages: [] };
const layout = {};
const browser = await launchBrowser();

/** 撮った場面の部品の四角と、人物画・背景・顔の様子（読むだけ） */
function probeStory() {
    const vis = (e) => {
        if (!e) return false;
        for (let p = e; p; p = p.parentElement) {
            const c = getComputedStyle(p);
            if (p.hidden || c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.05) return false;
        }
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const R = (e) => {
        const r = e.getBoundingClientRect();
        return { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 };
    };
    const layers = [...document.querySelectorAll('.g-layer[data-kind="script"]')];
    const layer = layers[layers.length - 1] ?? null;
    const sel = {
        dialog: '.g-dialog',
        name: '.g-dialog .name',
        text: '.g-dialog .text',
        choices: '.g-choices',
        head: '.g-council-head',
        map: '.g-council-map',
    };
    const rects = {};
    for (const [k, s] of Object.entries(sel)) {
        const e = layer?.querySelector(s) ?? null;
        rects[k] = vis(e) ? R(e) : null;
    }
    rects.choice = layer ? [...layer.querySelectorAll('.g-choice')].filter(vis).map((e) => ({ id: e.dataset.id, ...R(e) })) : [];
    for (const [k, s] of Object.entries({ menu: '.g-menu-btn', hud: '.g-hud', sit: '.g-sit-btn', talk: '.g-talk', toast: '.g-toast', intro: '.g-intro', run: '#run-btn' })) {
        const e = document.querySelector(s);
        rects[k] = vis(e) ? R(e) : null;
    }
    const pc = layer?.querySelector('canvas.g-portrait') ?? null;
    let portrait = null;
    if (pc) {
        const cr = pc.getBoundingClientRect();
        const dlg = layer.querySelector('.g-dialog');
        let alphaInDialog = null;
        let opaqueAbove = 0;
        if (vis(pc)) {
            const g = pc.getContext('2d');
            const kx = pc.width / cr.width;
            const ky = pc.height / cr.height;
            const a = (x, y) => g.getImageData(Math.min(pc.width - 1, Math.floor((x - cr.left) * kx)), Math.min(pc.height - 1, Math.floor((y - cr.top) * ky)), 1, 1).data[3];
            const dr = dlg?.getBoundingClientRect();
            if (dr && vis(dlg)) {
                // 会話の枠の中（角の丸みの外は枠の外なので数えない）の人物画の透明度の最大
                const rad = parseFloat(getComputedStyle(dlg).borderTopLeftRadius) || 0;
                const inRound = (x, y) => {
                    const cx = Math.min(Math.max(x, dr.left + rad), dr.right - rad);
                    const cy = Math.min(Math.max(y, dr.top + rad), dr.bottom - rad);
                    return Math.hypot(x - cx, y - cy) <= Math.max(0, rad - 2);
                };
                const x0 = Math.max(dr.left, cr.left) + 2;
                const x1 = Math.min(dr.right, cr.right) - 2;
                const y0 = Math.max(dr.top, cr.top) + 2;
                const y1 = Math.min(dr.bottom, cr.bottom) - 2;
                let m = 0;
                let n = 0;
                for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) if (inRound(x, y)) (m = Math.max(m, a(x, y))), n++;
                alphaInDialog = n ? m : null;
            }
            const yTop = dr && vis(dlg) ? Math.min(dr.top, cr.bottom) : cr.bottom;
            for (let y = cr.top + 3; y < yTop - 3; y += 8) for (let x = cr.left + 3; x < cr.right - 3; x += 8) if (a(x, y) > 200) opaqueAbove++;
        }
        portrait = { artId: pc.dataset.artId, visible: vis(pc), rect: R(pc), px: [pc.width, pc.height], pointerEvents: getComputedStyle(pc).pointerEvents, transform: getComputedStyle(pc).transform, alphaInDialog, opaqueAbove };
    }
    const bg = layer?.querySelector('.g-council-bg') ?? null;
    const background = bg
        ? {
              first: layer.firstElementChild === bg,
              visible: vis(bg),
              base: bg.querySelector('canvas.g-council-bg-base') ? { artId: bg.querySelector('canvas.g-council-bg-base').dataset.artId, ...R(bg.querySelector('canvas.g-council-bg-base')) } : null,
              front: bg.querySelector('canvas.g-council-bg-front') ? { artId: bg.querySelector('canvas.g-council-bg-front').dataset.artId, ...R(bg.querySelector('canvas.g-council-bg-front')) } : null,
          }
        : null;
    return { vw: innerWidth, vh: innerHeight, speaker: layer?.querySelector('.g-dialog')?.dataset.speaker ?? null, probe: window.__game?.ui ?? null, body: document.body.className, rects, portrait, background };
}

/** 合戦の画面の部品の四角と、顔（canvas.b-face）とそのまわりの文字の重なり（読むだけ） */
function probeBattle() {
    const vis = (e) => {
        if (!e) return false;
        for (let p = e; p; p = p.parentElement) {
            const c = getComputedStyle(p);
            if (p.hidden || c.display === 'none' || c.visibility === 'hidden') return false;
        }
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const R = (r) => ({ l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10 });
    const ov = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const out = { insets: {}, cards: [], faces: [], abil: null, gen: null, abnote: null };
    for (const s of ['.b-obj-head', '.b-ctrl', '.b-bottom', '.b-zoom', '.b-topleft', '.b-goals', '.b-cards', '.b-cmds', '.b-topmid']) {
        const e = document.querySelector(s);
        if (vis(e)) out.insets[s] = R(e.getBoundingClientRect());
    }
    for (const c of document.querySelectorAll('.b-card')) if (vis(c)) out.cards.push({ id: c.dataset.id, ...R(c.getBoundingClientRect()), text: c.innerText.replace(/\s+/g, ' ').slice(0, 40) });
    for (const [k, s] of [['abil', '.b-abil'], ['gen', '.b-gen'], ['abnote', '.b-abnote']]) {
        const e = document.querySelector(s);
        if (vis(e)) out[k] = { ...R(e.getBoundingClientRect()), text: e.innerText.replace(/\s+/g, ' ').slice(0, 60) };
    }
    const brief = document.querySelectorAll('.g-pr-units tr[data-unit]');
    if (brief.length) out.briefRows = [...brief].map((tr) => ({ unit: tr.dataset.unit, ...R(tr.getBoundingClientRect()) }));
    for (const f of document.querySelectorAll('canvas.b-face')) {
        if (!vis(f)) continue;
        // 能力の欄の顔は武将の行（.b-gen）の左の余白に置かれるので、欄（.b-abil）全体を箱にする
        const box = f.closest('.b-card, .b-abil, .b-abnote, tr') ?? f.parentElement;
        const fr = R(f.getBoundingClientRect());
        const cr = R(box.getBoundingClientRect());
        const texts = [];
        const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            if (!n.textContent.trim() || !vis(n.parentElement)) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) texts.push({ text: n.textContent.trim().slice(0, 16), ...R(q) });
        }
        const where = box.classList.contains('b-card') ? `card:${box.dataset.id}` : box.classList.contains('b-abil') ? 'abil-row' : box.classList.contains('b-abnote') ? 'notice' : box.tagName === 'TR' ? `brief:${box.dataset.unit}` : box.className;
        out.faces.push({ artId: f.dataset.artId, where, rect: fr, container: cr, inside: fr.l >= cr.l - 1 && fr.r <= cr.r + 1 && fr.t >= cr.t - 1 && fr.b <= cr.b + 1, overText: texts.filter((t) => ov(fr, t)), textCount: texts.length });
    }
    return out;
}

/** 画面の部品の並び（タグ・クラス・data-*・隠し・文字）。見せ方の違いで DOM が変わっていないかを比べる（読むだけ） */
function domLines(rootSel) {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const lines = [];
    const walk = (e, d) => {
        const cls = [...e.classList].filter((c) => c !== 'fade').sort().join('.');
        const data = Object.entries(e.dataset).map(([k, v]) => `${k}=${v}`).join(',');
        const txt = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 60);
        lines.push(`${' '.repeat(d)}${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${data ? `[${data}]` : ''}${e.hidden ? '(hidden)' : ''}${txt ? ` "${txt}"` : ''}`);
        for (const c of e.children) walk(c, d + 1);
    };
    walk(root, 0);
    return lines;
}

function newContext(W, H) {
    const touch = H <= 430;
    return browser.newContext(touch ? { viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
}
function watchPage(page, rec) {
    rec.errors = [];
    rec.artRequests = [];
    page.on('pageerror', (e) => rec.errors.push(`pageerror ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/GPU stall|GL Driver/.test(m.text())) rec.errors.push(`console ${m.text().slice(0, 200)}`);
    });
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (/^\/(dev-art\/)?art\//.test(p) || p === '/dev-art/manifest.json') rec.artRequests.push(p);
    });
}
const urlOf = (mode, q, extra = '') => {
    const parts = [q === 'low' ? 'q=low' : '', extra, MODE_Q[mode]].filter(Boolean);
    return `${BASE}/${parts.length ? '?' + parts.join('&') : ''}`;
};
const shotName = (scene, mode, tag) => `${scene}-${mode}-${tag}`;

// ---------------------------------------------------------------- 会話（城門の忠勝）と軍議
async function runStory(mode, W, H, q) {
    const touch = H <= 430;
    const tag = `${W}x${H}-${q}`;
    const rec = { kind: 'story', mode, size: `${W}x${H}`, quality: q, steps: [], shots: {} };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${mode} ${tag} ${how}: ${what}`);
    };
    const ctx = await newContext(W, H);
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    watchPage(page, rec);
    const ui = () => page.evaluate(() => window.__game.ui);
    const url = urlOf(mode, q, 'render=manual');
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    step('real', `opened ${url.replace(BASE, '')} (3D drawn only by __p3.renderNow before each shot: render=manual)`);
    const newBtn = page.locator('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
    await sleep(500);
    if (touch) await newBtn.tap();
    else await newBtn.click();
    step('real', `はじめから (ieyasu1570) ${touch ? 'tap' : 'click'}`);
    await skipCinematic(page, { tap: touch, what: 'ch1 opening', log: (t) => step('real', t) });
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(600);
    const tk = (await page.evaluate(() => window.__game.cast)).find((c) => c.id === 'tadakatsu');
    if (WALK) {
        // 忠勝は町の入口から真っすぐ北（見回しは真後ろ＝ yaw 0）。W／左のスティックを上へ倒したまま「話す」が出るまで
        if (touch) {
            const cdp = await ctx.newCDPSession(page);
            const O = [150, H - 110];
            const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1 })) });
            await t('touchStart', [O]);
            await t('touchMove', [[O[0], O[1] - 60]]);
            await page.waitForFunction(() => window.__game.prompt === 'tadakatsu', null, POLL);
            await t('touchEnd', []);
        } else {
            await page.keyboard.down('KeyW');
            await page.waitForFunction(() => window.__game.prompt === 'tadakatsu', null, POLL);
            await page.keyboard.up('KeyW');
        }
        step('real', `walked north to Tadakatsu (${touch ? 'touch stick, CDP touch events' : 'W key'}) — final pose varies run to run`);
    } else {
        await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [tk.x, tk.z + 1.6]);
        await page.waitForFunction(() => window.__game.prompt === 'tadakatsu', null, POLL);
        step('dev API', `__game.teleport to (${tk.x}, ${tk.z + 1.6}) heading π (same pose every run, so the shots are comparable)`);
    }
    await sleep(500);
    rec.pose = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, yaw: window.__p3.orbit.yaw }));
    if (touch) await page.locator('.g-talk').tap();
    else await page.keyboard.press('KeyE');
    step('real', `talk (${touch ? 'tap 話す' : 'key E'})`);
    await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'explore.tadakatsu', null, POLL);
    await sleep(300);
    const advance = async () => {
        if (touch) await page.locator('.g-layer[data-kind="script"] .g-dialog').last().tap();
        else await page.keyboard.press('Enter');
        await sleep(260);
    };
    const speaker = () => page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="script"] .g-dialog')].pop()?.dataset.speaker ?? null);
    const advanceUntil = async (pred, what) => {
        for (let k = 0; k < 40; k++) {
            const u = await ui();
            if (u?.kind === 'script' && (await pred(u))) return u;
            await advance();
        }
        throw new Error(`could not advance to ${what}`);
    };
    const choose = async (id) => {
        await sleep(450); // 選択肢の押し始めの守り（350ms）
        const c = page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${id}"]`).last();
        if (touch) await c.tap();
        else await c.click();
        step('real', `choose ${id} (${touch ? 'tap' : 'click'})`);
    };
    const shot = async (scene, { portraitOf = null, councilBg = false } = {}) => {
        // 素材がある見せ方では、読み込み（非同期）と人物画の切り替え（140ms）が済むまで待つ（最大 4 秒。待っても出ないのは記録に残る）
        if (mode !== 'old' && (mode === 'fixture' || genCount > 0)) {
            await page
                .waitForFunction(
                    ([p, bg]) => {
                        const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                        const okP = !p || !!L?.querySelector(`canvas.g-portrait[data-art-id="${p}"].on`) || !!L?.querySelector(`canvas.g-portrait[data-art-id="${p}"]`);
                        const okB = !bg || !!L?.querySelector('.g-council-bg canvas.g-council-bg-base');
                        return okP && okB;
                    },
                    [portraitOf, councilBg],
                    { timeout: 4000, polling: 100 },
                )
                .catch(() => {});
            await sleep(300);
        }
        await page.evaluate(() => window.__p3.renderNow());
        await sleep(350);
        const probe = await page.evaluate(probeStory);
        const dom = await page.evaluate(domLines, '#g-root');
        const file = `${SHOTS}/${shotName(scene, mode, tag)}.png`;
        await page.screenshot({ path: file, timeout: 300000 });
        rec.shots[scene] = file;
        layout[`${scene}|${mode}|${tag}`] = { ...probe, overlap: storyOverlaps(probe) };
        rec.dom = rec.dom || {};
        rec.dom[scene] = dom;
        log(`  ${mode} ${tag} shot ${scene}: speaker=${probe.speaker} portrait=${probe.portrait ? `${probe.portrait.artId} ${probe.portrait.visible ? 'shown' : 'hidden'}` : 'none'} bg=${probe.background ? 'yes' : 'none'}`);
    };
    await advanceUntil(async () => (await speaker()) === 'tadakatsu', 'tadakatsu line');
    step('real', `advance (${touch ? 'tap dialog' : 'Enter'})`);
    await shot('conv-tadakatsu-line', { portraitOf: 'portrait.tadakatsu' });
    await advanceUntil(async () => (await speaker()) === 'hero', 'hero line');
    await shot('conv-ieyasu-line', { portraitOf: 'portrait.ieyasu' });
    await advanceUntil(async (u) => u.choices?.length > 0, 'talk choices');
    await shot('conv-talk-choice');
    await choose('open_council');
    await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council', null, POLL);
    await sleep(500);
    await advanceUntil(async () => (await speaker()) === 'tadakatsu', 'council tadakatsu line');
    await shot('conv-council-line', { portraitOf: 'portrait.tadakatsu', councilBg: true });
    await advanceUntil(async (u) => u.choices?.length > 0, 'policy choices');
    await sleep(700); // 導入の帯が消えるまで
    await shot('conv-council-choice', { councilBg: true });
    step('none', 'stopped at the policy choices (no decision made)');
    rec.errors = rec.errors.filter((e) => !/\[art\]/.test(e));
    await ctx.close();
    return rec;
}

/** 人物画が選択肢・見出し・ボタンに重ならない、会話の枠の中では透明（文字の下に絵が出ない）、など */
function storyOverlaps(p) {
    const res = [];
    const pr = p.portrait?.visible ? p.portrait.rect : null;
    if (pr) {
        for (const k of ['choices', 'head', 'map', 'menu', 'hud', 'sit', 'talk', 'toast', 'run']) if (p.rects[k]) res.push({ what: `portrait vs ${k}`, ok: !boxesOverlap(pr, p.rects[k]) });
        for (const c of p.rects.choice) res.push({ what: `portrait vs choice ${c.id}`, ok: !boxesOverlap(pr, c) });
        if (p.rects.dialog && boxesOverlap(pr, p.rects.dialog)) res.push({ what: 'portrait cut out inside the dialog box (max alpha 0)', ok: p.portrait.alphaInDialog === 0, alpha: p.portrait.alphaInDialog });
        res.push({ what: 'portrait drawn above the dialog (opaque pixels)', ok: p.portrait.opaqueAbove > 0, n: p.portrait.opaqueAbove });
        res.push({ what: 'portrait not clickable (pointer-events none)', ok: p.portrait.pointerEvents === 'none' });
        res.push({ what: 'portrait bottom at the screen bottom', ok: Math.abs(pr.b - p.vh) < 1 });
        res.push({ what: 'portrait inside the screen', ok: pr.l >= -0.5 && pr.r <= p.vw + 0.5 && pr.t >= -0.5 });
    }
    if (p.background) res.push({ what: 'council background is the first child of the layer (behind text and buttons)', ok: p.background.first });
    // 文字の部品が画面の中にある（素材で押し出されていない）
    for (const k of ['dialog', 'choices', 'head']) if (p.rects[k]) res.push({ what: `${k} inside the screen`, ok: p.rects[k].l >= -0.5 && p.rects[k].r <= p.vw + 0.5 && p.rects[k].t >= -0.5 && p.rects[k].b <= p.vh + 0.5 });
    return res;
}

// ---------------------------------------------------------------- 大平原の演習
const camRef = {};
async function runBattle(mode, W, H, q, withIdentity) {
    const touch = H <= 430;
    const tag = `${W}x${H}-${q}`;
    const rec = { kind: 'battle', mode, size: `${W}x${H}`, quality: q, steps: [], shots: {} };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${mode} ${tag} ${how}: ${what}`);
    };
    const ctx = await newContext(W, H);
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    watchPage(page, rec);
    const press = async (sel) => {
        await sleep(450); // ui/guard.ts：出たばかりのボタンは少しの間押しても効かない
        await page.locator(sel).first().scrollIntoViewIfNeeded();
        if (touch) await page.tap(sel);
        else await page.click(sel);
    };
    const bpress = async (sel) => {
        if (touch) await page.tap(sel);
        else await page.click(sel);
        await sleep(150);
    };
    const waitSheet = (name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
    const shot = async (scene) => {
        await sleep(300);
        const probe = await page.evaluate(probeBattle);
        const dom = await page.evaluate(domLines, scene === 'practice-briefing' ? '.g-layer[data-sheet="practice-briefing"]' : '.b-root');
        const file = `${SHOTS}/${shotName(scene, mode, tag)}.png`;
        await page.screenshot({ path: file, timeout: 300000 });
        rec.shots[scene] = file;
        const overlap = [];
        for (const f of probe.faces) {
            overlap.push({ what: `face ${f.artId} in ${f.where} does not cover text`, ok: f.overText.length === 0, over: f.overText });
            overlap.push({ what: `face ${f.artId} inside its ${f.where} box`, ok: f.inside });
        }
        layout[`${scene}|${mode}|${tag}`] = { ...probe, overlap };
        rec.dom = rec.dom || {};
        rec.dom[scene] = dom;
        log(`  ${mode} ${tag} shot ${scene}: faces=${probe.faces.map((f) => `${f.artId}@${f.where}`).join(' ') || 'none'}`);
    };
    const url = urlOf(mode, q);
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    step('real', `opened ${url.replace(BASE, '')}`);
    await press('[data-id="practice"]');
    await waitSheet('practice-list');
    await press('[data-id="field:plains"]');
    await waitSheet('practice-briefing');
    step('real', `合戦場の演習 → 大平原 (${touch ? 'tap' : 'click'})`);
    await sleep(mode === 'fixture' || genCount > 0 ? 1500 : 800);
    await shot('practice-briefing');
    await press('.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await sleep(800);
    await bpress('.b-primary');
    await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
    await bpress('.b-pause');
    await page.waitForFunction(() => window.__battle.ui.paused, null, POLL);
    step('real', `出陣 → 合戦を始める → 指揮 (pause) (${touch ? 'tap' : 'click'})`);
    const tPause = await page.evaluate(() => window.__battle.state.t);
    await page.evaluate((d) => window.__battle.fastForward(d), Math.max(0, 3 - tPause));
    step('dev API', `__battle.fastForward from t=${tPause.toFixed(2)} to t=3.0 (same tick every run)`);
    await page.waitForFunction(() => document.querySelectorAll('.b-toast').length === 0 && document.querySelector('.b-hint')?.hidden !== false, null, { timeout: 60000, polling: 250 });
    await sleep(1500);
    rec.tick = await page.evaluate(() => window.__battle.state.tick);
    rec.stateHash = await page.evaluate(() => {
        const s = window.__battle.state;
        const txt = JSON.stringify({ t: s.t, tick: s.tick, units: s.units.map((u) => [u.id, u.x, u.z, u.facing, u.strength, u.morale, u.status, u.order, u.seenBy, u.engagedWith ?? null]), ev: s.events.map((e) => [e.t, e.kind, e.text]) });
        let h = 0x811c9dc5;
        for (let i = 0; i < txt.length; i++) {
            h ^= txt.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    });
    rec.camera = await page.evaluate(() => (({ tx, tz, dist, yaw, pitch }) => ({ tx, tz, dist, yaw, pitch }))(window.__battle.camera));
    const key = tag;
    if (!camRef[key]) camRef[key] = { mode, cam: rec.camera };
    else {
        const ref = camRef[key].cam;
        const same = ['tx', 'tz', 'dist'].every((k) => Math.abs((ref[k] ?? 0) - (rec.camera[k] ?? 0)) < 1e-6);
        rec.cameraSameAsFirst = same;
        if (!same && CAM_LOCK) {
            await page.evaluate((c) => window.__battle.centerOn(c.tx, c.tz, c.dist), ref);
            await sleep(800);
            rec.cameraForced = ref;
            step('dev API', `camera differed from ${camRef[key].mode}; __battle.centerOn to the same camera`);
        }
    }
    rec.art = await page.evaluate(() => window.__battle.art());
    rec.troops = await page.evaluate(() => (({ visibleSoldiers, drawCalls }) => ({ visibleSoldiers, drawCalls }))(window.__battle.troopStats()));
    rec.info = await page.evaluate(() => window.__battle.info());
    await shot('battle-wide');
    for (const [scene, id] of [
        ['battle-selected', 'a_tadakatsu'],
        ['battle-selected-ieyasu', 'a_ieyasu'],
    ]) {
        await bpress(`.b-card[data-id="${id}"]`);
        await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
        step('real', `select card ${id} (${touch ? 'tap' : 'click'})`);
        await sleep(1500);
        await shot(scene);
    }
    if (withIdentity) rec.identity = await identityRun(page, step);
    rec.errors = rec.errors.filter((e) => !/\[art\]/.test(e));
    await ctx.close();
    return rec;
}

/**
 * 合戦の同一性：t=3.0 の同じ状態から、同じ命令の台本（刻みごと）で進め、刻みごとの状態の指紋を畳み込んだ値・区切りの指紋・終わりの結果を返す。
 * 表示（地面・影・砂ぼこり・顔）は毎コマ動いたまま（画面を描きながら進める）。
 */
async function identityRun(page, step) {
    await page.evaluate(() => {
        const B = window.__battle;
        B.select(null);
        const digest = (s) => JSON.stringify({ t: s.t, tick: s.tick, result: s.result ?? null, units: s.units.map((u) => [u.id, u.x, u.z, u.facing, u.strength, u.morale, u.status, u.order, u.seenBy, u.engagedWith ?? null]), ev: s.events.length });
        const fnv = (txt, h = 0x811c9dc5) => {
            for (let i = 0; i < txt.length; i++) {
                h ^= txt.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h >>> 0;
        };
        const evHash = (s) => fnv(JSON.stringify(s.events.map((e) => [e.t, e.kind, e.text])));
        window.__id = { roll: 0x811c9dc5, ticks: 0, marks: {}, digest, fnv, evHash };
        B.setScript((s) => {
            const I = window.__id;
            I.roll = fnv(digest(s), I.roll);
            I.ticks++;
            if (s.tick % 600 === 0) I.marks[s.tick] = ((fnv(digest(s)) ^ evHash(s)) >>> 0).toString(16).padStart(8, '0');
            const t = Math.round(s.t * 10) / 10;
            if (t === 5) B.order('a_kiba', { type: 'move', x: -150, z: -40 });
            if (t === 60) B.order('a_kiba', { type: 'attack', targetId: 'e_left' });
            if (t === 90) B.order('a_ishikawa', { type: 'attack', targetId: 'e_sente' });
            if (t === 150) for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara']) B.order(id, { type: 'attack', targetId: 'e_hq' });
            if (t === 200) B.order('a_ieyasu', { type: 'attack', targetId: 'e_hq' });
        });
        B.setTimeScale(12);
        B.pause(false);
    });
    step('dev API', '__battle.setScript (orders at t=5/60/90/150/200; every tick folded into a rolling state hash) + setTimeScale(12) + pause(false); the view keeps rendering every frame');
    const deadline = Date.now() + 20 * 60000;
    let st;
    for (;;) {
        st = await page.evaluate(() => ({ t: window.__battle.state.t, tick: window.__battle.state.tick, result: window.__battle.state.result?.result ?? null }));
        if (st.result || st.tick >= 6000 || Date.now() > deadline) break;
        await sleep(1000);
    }
    await page.evaluate(() => window.__battle.pause(true));
    const r = await page.evaluate(() => {
        const s = window.__battle.state;
        const I = window.__id;
        return { tick: s.tick, t: Math.round(s.t * 10) / 10, result: s.result ? { result: s.result.result, reason: s.result.reason ?? null, elapsedSec: s.result.elapsedSec } : null, resultHash: s.result ? I.fnv(JSON.stringify(s.result)).toString(16).padStart(8, '0') : null, final: ((I.fnv(I.digest(s)) ^ I.evHash(s)) >>> 0).toString(16).padStart(8, '0'), rolling: I.roll.toString(16).padStart(8, '0'), scriptedTicks: I.ticks, marks: I.marks, events: s.events.length };
    });
    r.art = await page.evaluate(() => window.__battle.art());
    log(`  identity: ${JSON.stringify(r)}`);
    return r;
}

// ---------------------------------------------------------------- 実行
const [W0, H0] = SIZES[0].split('x').map(Number);
for (const q of QUALITY) {
    for (const size of SIZES) {
        const [W, H] = size.split('x').map(Number);
        for (const mode of MODES) {
            if (SCENES.includes('story')) {
                try {
                    report.runs[`story|${mode}|${size}-${q}`] = await runStory(mode, W, H, q);
                } catch (e) {
                    check(false, `story ${mode} ${size} ${q} ran`, e.message);
                }
            }
            if (SCENES.includes('battle')) {
                const withId = IDENTITY && W === W0 && H === H0 && q === QUALITY[0];
                try {
                    report.runs[`battle|${mode}|${size}-${q}`] = await runBattle(mode, W, H, q, withId);
                } catch (e) {
                    check(false, `battle ${mode} ${size} ${q} ran`, e.message);
                }
            }
        }
    }
}
await browser.close();

// ---------------------------------------------------------------- 確かめ
console.log('== checks');
const runsOf = (kind, size, q) => Object.fromEntries(MODES.map((m) => [m, report.runs[`${kind}|${m}|${size}-${q}`]]).filter(([, r]) => r));
const diffLines = (a = [], b = []) => {
    const out = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && out.length < 6; i++) if (a[i] !== b[i]) out.push({ i, a: a[i] ?? null, b: b[i] ?? null });
    return out;
};
for (const q of QUALITY) {
    for (const size of SIZES) {
        const tag = `${size}-${q}`;
        for (const kind of ['story', 'battle']) {
            const R = runsOf(kind, size, q);
            if (!Object.keys(R).length) continue;
            for (const [mode, r] of Object.entries(R)) {
                check(r.errors.length === 0, `${kind} ${mode} ${tag}: no page errors`, r.errors.slice(0, 3));
                const imgs = r.artRequests.filter((p) => /\.(webp|png|jpg)$/.test(p));
                if (mode === 'old') check(imgs.length === 0, `${kind} old ${tag}: ?art=old loads no art image`, imgs);
                if (mode === 'default' && genCount === 0) check(imgs.length === 0, `${kind} default ${tag}: empty manifest loads no art image`, imgs);
                if (mode === 'default') check(!r.artRequests.some((p) => p.startsWith('/dev-art/')), `${kind} default ${tag}: no dev-art request`);
            }
            // 前（old）と「素材なし」の画面の部品の並びが同じ（素材の一覧が空の間）
            if (R.old && R.default && genCount === 0) {
                for (const scene of Object.keys(R.old.dom ?? {})) {
                    const d = diffLines(R.old.dom[scene], R.default.dom?.[scene]);
                    check(d.length === 0, `${scene} ${tag}: DOM of default == old (empty manifest)`, d.length ? d : `${R.old.dom[scene].length} elements`);
                }
            }
            if (R.old && R.fixture) {
                for (const scene of Object.keys(R.old.dom ?? {})) {
                    const a = new Set(R.old.dom[scene].map((l) => l.trim()));
                    const added = (R.fixture.dom?.[scene] ?? []).map((l) => l.trim()).filter((l) => !a.has(l));
                    const b = new Set((R.fixture.dom?.[scene] ?? []).map((l) => l.trim()));
                    const removed = R.old.dom[scene].map((l) => l.trim()).filter((l) => !b.has(l));
                    // 素材で増えてよい物：人物画・軍議の背景・顔（と、それを入れる箱の印）
                    const unexpected = added.filter((l) => !/g-portrait|g-council-bg|b-face|with-face|g-art|g-council-art/.test(l));
                    layout[`dom-diff|${kind}|${tag}`] = { scene, added: added.slice(0, 40), removed: removed.slice(0, 40) };
                    check(unexpected.length === 0, `${scene} ${tag}: fixture adds only art elements to the DOM`, unexpected.length ? unexpected.slice(0, 4) : `+${added.length} / -${removed.length} lines`);
                }
            }
        }
        // 会話・軍議の重なり
        for (const [k, v] of Object.entries(layout)) {
            if (!k.endsWith(`|${tag}`) || !v.overlap) continue;
            const bad = v.overlap.filter((o) => !o.ok);
            if (v.overlap.length) check(bad.length === 0, `${k}: layout/overlap (${v.overlap.length} checks)`, bad.length ? bad : undefined);
        }
        // 合戦：カメラ・余白の部品・札の高さ・時間合わせの指紋が見せ方で同じ
        const B = runsOf('battle', size, q);
        if (B.old) {
            for (const [mode, r] of Object.entries(B)) {
                if (mode === 'old') continue;
                check(r.stateHash === B.old.stateHash && r.tick === B.old.tick, `battle ${mode} ${tag}: state at tick ${r.tick} identical to old`, [B.old.stateHash, r.stateHash]);
                check(r.cameraSameAsFirst !== false, `battle ${mode} ${tag}: default (fit) camera identical to ${camRef[tag]?.mode}`, r.cameraForced ? 'forced with centerOn for the shots' : undefined);
                const L0 = layout[`battle-wide|old|${tag}`];
                const L1 = layout[`battle-wide|${mode}|${tag}`];
                if (L0 && L1) {
                    check(JSON.stringify(L0.insets) === JSON.stringify(L1.insets), `battle ${mode} ${tag}: HUD inset boxes identical to old`);
                    check(JSON.stringify(L0.cards.map((c) => [c.id, c.t, c.b, c.l, c.r])) === JSON.stringify(L1.cards.map((c) => [c.id, c.t, c.b, c.l, c.r])), `battle ${mode} ${tag}: card boxes identical to old`);
                }
                check(r.troops.visibleSoldiers >= B.old.troops.visibleSoldiers, `battle ${mode} ${tag}: visible soldiers not fewer than old`, [B.old.troops.visibleSoldiers, r.troops.visibleSoldiers]);
            }
            check(B.old.art.ground === 'vertex' && B.old.art.trees === 0 && B.old.art.shadows === 0, `battle old ${tag}: V21 ground (vertex, no trees, no shadows)`, B.old.art);
        }
        if (B.fixture) check(B.fixture.art.ground === 'textured' && B.fixture.art.trees > 0, `battle fixture ${tag}: textured ground + plains woods trees (TEST pattern)`, B.fixture.art);
        if (B.fixture && devCount) {
            for (const scene of ['battle-wide', 'battle-selected', 'battle-selected-ieyasu', 'practice-briefing']) {
                const L = layout[`${scene}|fixture|${tag}`];
                if (!L) continue;
                const ids = L.faces.map((f) => `${f.where}:${f.artId}`).sort();
                const want = scene === 'practice-briefing' ? ['brief:a_ieyasu:face.ieyasu', 'brief:a_tadakatsu:face.tadakatsu'] : ['card:a_ieyasu:face.ieyasu', 'card:a_tadakatsu:face.tadakatsu'];
                const extra = scene === 'battle-selected' ? ['abil-row:face.tadakatsu'] : scene === 'battle-selected-ieyasu' ? ['abil-row:face.ieyasu'] : [];
                check(JSON.stringify(ids) === JSON.stringify([...want, ...extra].sort()), `${scene} fixture ${tag}: faces only for Ieyasu and Tadakatsu, where expected`, ids);
            }
        }
    }
}
// 同一性
const idRuns = Object.fromEntries(MODES.map((m) => [m, report.runs[`battle|${m}|${SIZES[0]}-${QUALITY[0]}`]?.identity]).filter(([, r]) => r));
report.identity = idRuns;
if (Object.keys(idRuns).length >= 2) {
    console.log('== battle identity (same start state + same command script; view running)');
    for (const [m, r] of Object.entries(idRuns)) console.log(`   ${m.padEnd(8)} tick ${r.tick}  result ${JSON.stringify(r.result)} (#${r.resultHash})  final ${r.final}  rolling ${r.rolling}  marks ${JSON.stringify(r.marks)}  art ${JSON.stringify(r.art)}`);
    const ref = Object.values(idRuns)[0];
    for (const [m, r] of Object.entries(idRuns).slice(1)) {
        check(r.final === ref.final && r.rolling === ref.rolling && r.tick === ref.tick && r.resultHash === ref.resultHash && JSON.stringify(r.result) === JSON.stringify(ref.result) && JSON.stringify(r.marks) === JSON.stringify(ref.marks), `battle identity: ${m} == ${Object.keys(idRuns)[0]} (every tick)`, { [Object.keys(idRuns)[0]]: [ref.rolling, ref.final], [m]: [r.rolling, r.final] });
    }
}

// ---------------------------------------------------------------- 並べた絵（Pillow）
const PY = `
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
spec = json.load(open(sys.argv[1]))
def font(sz):
    try:
        return ImageFont.load_default(size=sz)
    except TypeError:
        return ImageFont.load_default()
F1, F2 = font(18), font(14)
res = []
for m in spec['montages']:
    panels = [p for p in m['panels']]
    ims = [Image.open(p['file']).convert('RGB') for p in panels]
    base = np.asarray(ims[0], dtype=np.int16)
    w, h = ims[0].size
    n = len(ims)
    cols = n if n <= 3 else 2
    rows = (n + cols - 1) // cols
    scale = min(1.0, spec['maxWidth'] / (w * cols + 8 * (cols - 1)))
    pw, ph = round(w * scale), round(h * scale)
    head = 52
    out = Image.new('RGB', (pw * cols + 8 * (cols - 1), (ph + head) * rows + 8 * (rows - 1)), (20, 20, 20))
    d = ImageDraw.Draw(out)
    diffs = []
    for i, (im, p) in enumerate(zip(ims, panels)):
        x = (i % cols) * (pw + 8)
        y0 = (i // cols) * (ph + head + 8)
        frac = None
        if i > 0 and im.size == ims[0].size:
            a = np.asarray(im, dtype=np.int16)
            frac = float((np.abs(a - base).max(axis=2) > 16).mean())
        diffs.append(frac)
        out.paste(im.resize((pw, ph), Image.LANCZOS) if scale < 1 else im, (x, y0 + head))
        d.text((x + 6, y0 + 4), p['label'], fill=(255, 220, 120) if i == 0 else (150, 220, 255), font=F1)
        sub = m['title'] + ('' if frac is None else '   diff vs BEFORE: %.2f%% px' % (frac * 100))
        d.text((x + 6, y0 + 28), sub, fill=(220, 220, 220), font=F2)
    out.save(m['out'], optimize=True)
    res.append({'out': m['out'], 'diffs': diffs})
print(json.dumps(res))
`;
const montages = [];
const scenesShot = new Set(Object.values(report.runs).flatMap((r) => Object.keys(r.shots ?? {})));
for (const q of QUALITY)
    for (const size of SIZES)
        for (const scene of scenesShot) {
            const tag = `${size}-${q}`;
            const panels = MODES.map((m) => ({ mode: m, file: `${SHOTS}/${shotName(scene, m, tag)}.png`, label: MODE_LABEL[m] })).filter((p) => existsSync(p.file));
            if (V21_DIR) {
                const f = `${V21_DIR}/${scene}-${size}${q === 'default' ? '-high' : ''}.png`;
                if (existsSync(f)) panels.push({ mode: 'v21', file: f, label: 'REFERENCE  V21 be0b2e5 (earlier run; walk pose and time may differ)' });
            }
            if (panels.length >= 2) montages.push({ title: `${scene}  ${size}  q=${q}`, out: `${MONT}/${scene}-${tag}.png`, panels });
        }
if (montages.length) {
    writeFileSync(`${MONT}/spec.json`, JSON.stringify({ maxWidth: 2700, montages }, null, 1));
    try {
        const res = JSON.parse(execFileSync('python3', ['-I', '-c', PY, `${MONT}/spec.json`], { maxBuffer: 1 << 24 }).toString());
        for (const r of res) {
            const m = montages.find((x) => x.out === r.out);
            report.montages.push({ out: r.out, panels: m.panels.map((p, i) => ({ mode: p.mode, file: p.file, diffVsBefore: r.diffs[i] })) });
        }
        log(`montages: ${res.length} in ${MONT}`);
    } catch (e) {
        check(false, 'montage (python3 -I + Pillow)', e.message.slice(0, 300));
    }
}
// 素材の一覧が空の間は、default は old と同じ見た目のはず（3D の町の人の動き・▼ の点滅などの小さな違いは残る）
if (genCount === 0) {
    for (const m of report.montages) {
        const i = m.panels.findIndex((p) => p.mode === 'default');
        if (i > 0 && m.panels[0].mode === 'old' && m.panels[i].diffVsBefore !== null) {
            const d = m.panels[i].diffVsBefore;
            check(d < 0.02, `${m.out.split('/').pop()}: default vs old pixel difference < 2% (empty manifest)`, `${(d * 100).toFixed(2)}%`);
        }
    }
}

report.checks = checks;
writeFileSync(`${OUT}/layout.json`, JSON.stringify(layout, null, 1));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const ng = checks.filter((c) => !c.ok);
console.log(`${checks.length - ng.length}/${checks.length} ok${ng.length ? `; NG: ${ng.map((c) => c.what).join(' / ')}` : ''}`);
console.log(`out: ${OUT} (shots/, montage/, layout.json, report.json)${MODES.includes('fixture') ? ' — fixture panels are synthetic TEST patterns: placement/behaviour only, not art' : ''}`);
process.exit(ng.length ? 1 : 0);
