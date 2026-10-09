/**
 * 生成イラスト素材（Version 22 から）の前後比較（開発サーバー）。同じ場面・同じ寄りで「前（?art=old）」と「後（素材あり）」を撮り、並べた絵と、
 * 画面の部品の四角・重なりの確かめの JSON を出す。合戦は、同じ初めの状態・同じ命令の台本で、見せ方を変えても状態の指紋が同じかを比べる。
 *
 *   BASE=http://localhost:8633 node e2e/art-compare.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     MODES=old,default,fixture   old … ?art=old（新しい素材を一つも読まない＝Version 21 の見た目。比べの「前」）
 *                                 default … 何も付けない（ゲームが読む素材の一覧 manifest.gen.json のとおり。Version 23 は武将 6 人の顔と、
 *                                           大平原の地面の草地・土・道の 3 枚。人物画・軍議の背景・林床は入っていない）
 *                                 fixture … ?artFixture=1（開発時だけ。proto3d/dev-art の TEST の模様。配置・縮尺・動きの確かめ用で、見た目の素材ではない）
 *                                 v22 … 別の開発サーバー V22_BASE（Version 22 の 3fe5a7d を動かした物）の何も付けない見せ方（比べの「前」の 2 枚目）
 *                                 abort … default の画面で、素材の画像（/art/ の下）を全部読めなくする（読み込みの失敗：文字と操作が残る・Version 21 の見た目）
 *                                 abortroad … default の画面で、道の素材（art/battle/plains_road.webp）だけ読めなくする（道だけ Version 21 の道の帯）
 *     V22_BASE=http://localhost:8715  v22 の開発サーバー
 *     MONTAGE_MODES=old,v22,default   並べた絵に入れる見せ方（左から）。abort・abortroad は別の並べた絵（fail-…：old・abort・abortroad）
 *     SIZES=1280x720,844x390      高さ 430 以下はスマホ（タッチ・isMobile）として撮る
 *     QUALITY=low,default         low … ?q=low、default … q を付けない
 *     SCENES=story,battle         story … 会話（城門の忠勝の行・家康の行・話の選択肢）と軍議（忠勝・酒井・石川の行・方針の選択肢）、
 *                                 battle … 大平原の演習（編成の表 practice-briefing・全体・忠勝を選ぶ・家康を選ぶ・石川の能力の対象選び（選んだら「能力」でやめる））
 *     IDENTITY=1                  合戦の同一性（最初の SIZES・QUALITY の battle の続きで、台本の命令で終わりまで進め、指紋を見せ方ごとに比べる。0 で省く）
 *     WALK=0                      1 なら忠勝の前まで本物の入力（W／左のスティック）で歩く。既定は開発用の teleport（毎回同じ位置・向き＝写真を比べられる）
 *     CAM_LOCK=1                  合戦の「全体」のカメラが最初の見せ方と違ったら、同じカメラに合わせる（開発用の centerOn。報告に書き、違い自体は NG にする）
 *     V21_DIR=<dir>               Version 21 のときの写真（同じ名前：<場面>-<幅>x<高さ>.png、既定の画質は -high）があれば、並べた絵の右に参考として足す
 *
 * 出力：<出力先>/shots/<場面>-<見せ方>-<幅>x<高さ>-<画質>.png、<出力先>/montage/<場面>-<幅>x<高さ>-<画質>.png（MONTAGE_MODES の順に左から。4 枚以上は 2 列。上に見せ方と、前との画素の違いの割合）、
 *       <出力先>/montage/fail-<場面>-….png（読み込みの失敗：old・abort・abortroad）、
 *       <出力先>/layout.json（撮った場面ごとの部品の四角・人物画・背景・顔・重なりの確かめ）、<出力先>/report.json（確かめの一覧・手順の本物の入力／開発用の操作・合戦の指紋）。
 * 顔（素材パック sengoku_art_pack_v1 の武将の顔。manifest.gen.json に顔がある時の default）：会話・軍議の台詞の枠の顔は今の話し手（家康・忠勝・酒井・石川）の顔で、
 *   名前・台詞・行の数・▼・選択肢に重ならない、枠・台詞の四角・字の大きさ・選択肢の四角は old と同じ（Version 23：スマホでも台詞を小さくしない。狭い画面の顔は
 *   枠の左上の角で、下端は台詞の 1 行目より上）。合戦の札・能力の欄・編成の表の顔はその部隊の武将の顔。能力の欄は顔の分だけ高くなってよい
 *   （PC 22 px・縦の狭い画面 18 px・高さ 370 以下 2 px まで。位置・幅は同じ）。編成の表は「率いる武将」に顔・名前・役割（武将のいない行の高さは old と同じ）。
 *   DOM の違いは素材の部品（g-face・has-face・b-face・with-face・data-face・g-art-note と、編成の表の g-pr-gen の箱）だけ。
 * 地面（Version 23。default）：大平原は草地・土・道の 3 枚（林床は不採用。円の林に木を植えない）。abort は Version 21 の地面、abortroad は道だけ Version 21 の道の帯。
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
const V22_BASE = process.env.V22_BASE || 'http://localhost:8715';
const MONTAGE_MODES = list(process.env.MONTAGE_MODES, 'old,v22,default,fixture');
const FAIL_MODES = ['old', 'abort', 'abortroad'];
const SIZES = list(process.env.SIZES, '1280x720,844x390');
const QUALITY = list(process.env.QUALITY, 'low,default');
const SCENES = list(process.env.SCENES, 'story,battle');
const IDENTITY = process.env.IDENTITY !== '0';
const WALK = process.env.WALK === '1';
const CAM_LOCK = process.env.CAM_LOCK !== '0';
const V21_DIR = process.env.V21_DIR || '';
const MODE_Q = { old: 'art=old', default: '', fixture: 'artFixture=1', v22: '', abort: '', abortroad: '' };
const MODE_LABEL = {
    old: 'BEFORE  ?art=old (V21 look)',
    v22: 'BEFORE  V22 3fe5a7d (published)',
    default: 'AFTER  default build',
    fixture: 'AFTER  ?artFixture=1  [TEST fixture - placement only, NOT art]',
    abort: 'AFTER  all /art/ images fail to load',
    abortroad: 'AFTER  plains_road.webp fails to load',
};
/** 見せ方ごとに読めなくする画像（Playwright の route で abort。道の名で選ぶ：/src/art/*.ts などの部品は読めるまま） */
const MODE_ABORT = { abort: /^\/art\//, abortroad: /^\/art\/battle\/plains_road\.webp$/ };
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
        count: '.g-dialog .count',
        more: '.g-dialog .more',
        face: '.g-dialog canvas.g-face',
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
    const fc = layer?.querySelector('.g-dialog canvas.g-face') ?? null;
    const face = fc ? { artId: fc.dataset.artId ?? null, visible: vis(fc), px: [fc.width, fc.height], pointerEvents: getComputedStyle(fc).pointerEvents, ariaHidden: fc.getAttribute('aria-hidden'), transform: getComputedStyle(fc).transform } : null;
    const dlg = layer?.querySelector('.g-dialog') ?? null;
    const tx = layer?.querySelector('.g-dialog .text') ?? null;
    const font = tx ? { size: getComputedStyle(tx).fontSize, spacing: getComputedStyle(tx).letterSpacing, line: getComputedStyle(tx).lineHeight } : null;
    return { vw: innerWidth, vh: innerHeight, speaker: dlg?.dataset.speaker ?? null, hasFace: !!dlg?.classList.contains('has-face'), probe: window.__game?.ui ?? null, body: document.body.className, rects, portrait, background, face, font };
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
    if (brief.length) out.briefRows = [...brief].map((tr) => ({ unit: tr.dataset.unit, ...R(tr.getBoundingClientRect()), gen: tr.querySelector('.g-pr-gname')?.textContent ?? null, role: tr.querySelector('.g-pr-grole')?.textContent ?? null, text: tr.children[3]?.textContent.replace(/\s+/g, ' ').trim() ?? null }));
    const tbl = document.querySelector('.g-pr-units');
    if (tbl) out.briefTable = { scroll: [tbl.scrollWidth, tbl.clientWidth], doc: [document.documentElement.scrollWidth, innerWidth], ...R(tbl.getBoundingClientRect()) };
    const ab = document.querySelector('.b-abil');
    if (ab && vis(ab)) out.abilScroll = [ab.scrollHeight, ab.clientHeight];
    out.vw = innerWidth;
    out.vh = innerHeight;
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
const baseOf = (mode) => (mode === 'v22' ? V22_BASE : BASE);
const urlOf = (mode, q, extra = '') => {
    const parts = [q === 'low' ? 'q=low' : '', extra, MODE_Q[mode]].filter(Boolean);
    return `${baseOf(mode)}/${parts.length ? '?' + parts.join('&') : ''}`;
};
/** 読み込みの失敗の見せ方：その画像を読めなくする（ほかは同じ default の画面） */
async function routeAbort(page, mode, rec) {
    const pat = MODE_ABORT[mode];
    if (!pat) return;
    rec.aborted = [];
    await page.route((u) => pat.test(u.pathname), (r) => {
        rec.aborted.push(new URL(r.request().url()).pathname);
        return r.abort();
    });
}
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
    await routeAbort(page, mode, rec);
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    step('real', `opened ${url.replace(baseOf(mode), mode === 'v22' ? '[V22]' : '')}${MODE_ABORT[mode] ? ` with ${MODE_ABORT[mode].source} aborted` : ''} (3D drawn only by __p3.renderNow before each shot: render=manual)`);
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
        if (mode !== 'old' && mode !== 'abort' && (mode === 'fixture' || genCount > 0)) {
            await page
                .waitForFunction(
                    ([p, bg]) => {
                        const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                        const okP = !p || !!L?.querySelector(`canvas.g-portrait[data-art-id="${p}"].on`) || !!L?.querySelector(`canvas.g-portrait[data-art-id="${p}"]`);
                        const okB = !bg || !!L?.querySelector('.g-council-bg canvas.g-council-bg-base');
                        // 台詞の枠の顔：今の話し手の顔がある話し手なら、その顔が出るまで（読み込みは非同期）
                        const sp = L?.querySelector('.g-dialog')?.dataset.speaker;
                        const want = { hero: 'face.ieyasu', tadakatsu: 'face.tadakatsu', sakai: 'face.sakai', ishikawa: 'face.ishikawa' }[sp];
                        const fc = L?.querySelector('.g-dialog canvas.g-face');
                        const okF = !want || (!!fc && !fc.hidden && fc.dataset.artId === want);
                        return okP && okB && okF;
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
        layout[`${scene}|${mode}|${tag}`] = { ...probe, overlap: storyOverlaps(probe, mode) };
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
    await advanceUntil(async () => (await speaker()) === 'sakai', 'council sakai line');
    await shot('conv-council-sakai-line', { councilBg: true });
    await advanceUntil(async () => (await speaker()) === 'ishikawa', 'council ishikawa line');
    await shot('conv-council-ishikawa-line', { councilBg: true });
    await advanceUntil(async (u) => u.choices?.length > 0, 'policy choices');
    await sleep(700); // 導入の帯が消えるまで
    await shot('conv-council-choice', { councilBg: true });
    step('none', 'stopped at the policy choices (no decision made)');
    rec.errors = rec.errors.filter((e) => !/\[art\]/.test(e) && !(MODE_ABORT[mode] && /Failed to load resource|ERR_FAILED/.test(e)));
    await ctx.close();
    return rec;
}

/** 人物画が選択肢・見出し・ボタンに重ならない、会話の枠の中では透明（文字の下に絵が出ない）、など */
function storyOverlaps(p, mode) {
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
    // 台詞の枠の顔：枠の中・名前／台詞／行の数／▼／選択肢に重ならない・押せない・読み上げない・反転しない
    const fr = p.face?.visible ? p.rects.face : null;
    if (fr) {
        const d = p.rects.dialog;
        // PC（高さ 431 以上・幅 968 以上）は枠の左の中。狭い・低い画面（Version 23）は枠の左上の角：左端は枠の中、上へはみ出してよいが、
        // 下端は台詞の 1 行目より上（台詞・名前に重ならない）・画面の中（Version 22 は枠の中なので、v22 は枠の中か角のどちらでもよい）
        const pcFace = p.vh > 430 && p.vw >= 968;
        const inBox = !!d && fr.l >= d.l - 0.5 && fr.r <= d.r + 0.5 && fr.t >= d.t - 0.5 && fr.b <= d.b + 0.5;
        const corner = !!d && !!p.rects.text && fr.l >= d.l - 0.5 && fr.r <= d.r + 0.5 && fr.b <= p.rects.text.t + 0.5 && fr.b >= d.t - 0.5 && fr.t >= -0.5;
        if (pcFace) res.push({ what: 'dialog face inside the dialog box (PC)', ok: inBox });
        else res.push({ what: mode === 'v22' ? 'dialog face inside the box or at its top-left corner (V22)' : 'dialog face at the top-left corner of the box: above the first text line, inside the screen', ok: corner || (mode === 'v22' && inBox) });
        for (const k of ['name', 'text', 'count', 'more', 'choices']) if (p.rects[k]) res.push({ what: `dialog face vs ${k}`, ok: !boxesOverlap(fr, p.rects[k]) });
        for (const c of p.rects.choice) res.push({ what: `dialog face vs choice ${c.id}`, ok: !boxesOverlap(fr, c) });
        res.push({ what: 'dialog face not clickable, aria-hidden, not mirrored', ok: p.face.pointerEvents === 'none' && p.face.ariaHidden === 'true' && (p.face.transform === 'none' || !/^matrix\(-/.test(p.face.transform)) });
    }
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
    await routeAbort(page, mode, rec);
    // 地面の素材の応答（読めた・読めなかった）
    rec.groundResp = [];
    page.on('response', (r) => {
        const p = new URL(r.url()).pathname;
        if (/\/art\/battle\/[a-z_]+\.webp$/.test(p)) rec.groundResp.push([p.replace(/^.*\//, ''), r.status()]);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    step('real', `opened ${url.replace(baseOf(mode), mode === 'v22' ? '[V22]' : '')}${MODE_ABORT[mode] ? ` with ${MODE_ABORT[mode].source} aborted` : ''}`);
    await press('[data-id="practice"]');
    await waitSheet('practice-list');
    await press('[data-id="field:plains"]');
    await waitSheet('practice-briefing');
    step('real', `合戦場の演習 → 大平原 (${touch ? 'tap' : 'click'})`);
    await sleep(mode === 'fixture' || genCount > 0 ? 1500 : 800);
    await shot('practice-briefing');
    const toBriefing = async () => {
        await press('.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
        await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
        await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
        await sleep(800);
        return page.evaluate(() => window.__battle.art());
    };
    rec.artAtReady = await toBriefing();
    rec.battleNo = 1;
    // 地面の素材を使う見せ方（default・abortroad）で、素材が開始のボタンに間に合わなかった（遅いソフトウェア描画。設計どおり、その合戦は今までの地面）：
    // 一度その合戦を終えて（全軍撤退・時間送り）演習の一覧へ戻り、もう一度入る（読んだ素材と型紙は覚えているので、次の合戦では間に合う）
    if ((mode === 'default' || mode === 'abortroad') && rec.artAtReady.ground !== 'textured') {
        step('real', `ground art missed the start button (${JSON.stringify(rec.artAtReady)}); finishing this battle and entering again`);
        await bpress('.b-primary');
        await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
        await sleep(1500);
        await bpress('.b-allret');
        await page.waitForSelector('.b-modal .b-primary', { timeout: 60000 });
        await bpress('.b-modal .b-primary');
        for (let i = 0; i < 12 && !(await page.evaluate(() => window.__battle.state.result)); i++) await page.evaluate(() => window.__battle.fastForward(60));
        await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
        await sleep(500);
        await press('.b-primary');
        await waitSheet('practice-result');
        await press('.g-layer[data-sheet="practice-result"] [data-id="list"]');
        await waitSheet('practice-list');
        await press('[data-id="field:plains"]');
        await waitSheet('practice-briefing');
        step('real+dev API', '全軍撤退 → 時間送り (__battle.fastForward) → 結果 → 一覧 → 大平原 (second battle)');
        rec.artAtReady = await toBriefing();
        rec.battleNo = 2;
    }
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
    // 石川の能力の対象選び（「能力」→ 対象を選ぶ見せ方。選ばずに、もう一度「能力」でやめる：合戦の状態は変えない）
    await bpress('.b-card[data-id="a_ishikawa"]');
    await page.waitForFunction(() => window.__battle.ui.selectedId === 'a_ishikawa', null, POLL);
    step('real', `select card a_ishikawa (${touch ? 'tap' : 'click'})`);
    await sleep(1200);
    await bpress('.b-abil-btn');
    const pend = await page.waitForFunction(() => window.__battle.ui.pending === 'ability', null, { timeout: 20000, polling: 200 }).then(() => true).catch(() => false);
    step('real', `能力 (${touch ? 'tap' : 'click'}) → ${pend ? 'choosing an ally target' : 'did NOT enter target selection'}`);
    rec.ishikawaTarget = pend;
    if (pend) {
        await sleep(1800);
        rec.targetCamera = await page.evaluate(() => (({ tx, tz, dist, yaw, pitch }) => ({ tx, tz, dist, yaw, pitch }))(window.__battle.camera));
        rec.targetLabels = await page.evaluate(() => [...document.querySelectorAll('.b-label[data-ab="target"]')].map((e) => e.dataset.id).sort());
        await shot('battle-ishikawa-target');
        await bpress('.b-abil-btn');
        await page.waitForFunction(() => window.__battle.ui.pending === 'none', null, POLL);
        step('real', `能力 again (${touch ? 'tap' : 'click'}) → target selection cancelled (ability not used)`);
    }
    rec.ishikawaUsed = await page.evaluate(() => window.__battle.state.abilities.a_ishikawa?.usedAt ?? null);
    if (withIdentity) rec.identity = await identityRun(page, step);
    rec.errors = rec.errors.filter((e) => !/\[art\]/.test(e) && !(MODE_ABORT[mode] && /Failed to load resource|ERR_FAILED/.test(e)));
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
            // 顔のある素材の一覧（default・読み込みの失敗の abort／abortroad）：DOM の違いは素材の部品だけ（名前・台詞・ボタン・札の文字は同じ）。
            // 演習の編成の表（Version 23）は「率いる武将」の欄の名前を、顔・名前・役割の箱（g-pr-gen）に入れる：名前の文字は同じで、役割の文字が増える
            for (const am of ['default', 'abort', 'abortroad']) {
                if (!R.old || !R[am] || genCount === 0) continue;
                for (const scene of Object.keys(R.old.dom ?? {})) {
                    const strip = (l) => l.trim().replace(/\.(has-face|with-face|with-gen)(?=[.\[ (]|$)/g, '').replace(/,?face=(full|narrow|off)/, '').replace(/\[\]/, '');
                    const a = new Set(R.old.dom[scene].map(strip));
                    const added = (R[am].dom?.[scene] ?? []).map(strip).filter((l) => !a.has(l));
                    const b = new Set((R[am].dom?.[scene] ?? []).map(strip));
                    const genNames = new Set(added.map((l) => /^b\.g-pr-gname "(.+)"$/.exec(l)?.[1]).filter(Boolean));
                    const removed = R.old.dom[scene].map(strip).filter((l) => !b.has(l)).filter((l) => !(/^td "(.+)"$/.test(l) && genNames.has(/^td "(.+)"$/.exec(l)[1])));
                    const unexpected = added.filter((l) => !/canvas\.(g-face|b-face)|g-art-note|^div\.g-pr-gen$|^div\.g-pr-gtext$|^b\.g-pr-gname |^span\.g-pr-grole |^td$/.test(l));
                    const faces = added.filter((l) => /canvas\.(g-face|b-face)/.test(l));
                    layout[`dom-diff|${scene}|${am}|${tag}`] = { added: added.slice(0, 40), removed: removed.slice(0, 40) };
                    check(unexpected.length === 0 && removed.length === 0, `${scene} ${tag}: ${am} adds only face canvases, has-face/with-face/data-face marks and the briefing general box (name + role text) to the DOM; nothing removed`, unexpected.length || removed.length ? { unexpected: unexpected.slice(0, 4), removed: removed.slice(0, 4) } : `+${added.length} lines (${faces.length} face canvases)`);
                    if (am === 'abort') check(faces.length === 0, `${scene} ${tag}: abort (all art images fail): no face canvas left in the DOM`, faces.slice(0, 3));
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
        // 地面の素材（Version 23）：default は草地・土・道の 3 枚（林床は不採用：円の林に木を植えない）。読み込みの失敗：全部読めない（abort）は Version 21 の地面、
        // 道だけ読めない（abortroad）は道だけ Version 21 の道の帯（草地・土は素材のまま）
        const groundOk = {
            default: (a) => a.ground === 'textured' && JSON.stringify(a.materials) === '["grass","dirt","road"]' && a.trees === 0 && a.roadStrip === false,
            abort: (a) => a.ground === 'vertex' && a.materials.length === 0 && a.trees === 0 && a.shadows === 0 && a.roadStrip === true,
            abortroad: (a) => a.ground === 'textured' && JSON.stringify(a.materials) === '["grass","dirt"]' && a.trees === 0 && a.roadStrip === true,
        };
        for (const [mode, ok] of Object.entries(groundOk)) {
            const r = B[mode];
            if (!r || genCount === 0) continue;
            check(ok(r.art) && ok(r.artAtReady), `battle ${mode} ${tag}: ground ${mode === 'default' ? 'grass + dirt + road textures (no forest floor, no trees, road strip hidden)' : mode === 'abort' ? 'V21 vertex ground and road strip (all images failed)' : 'grass + dirt textures, road = V21 road strip (road image failed)'} (battle #${r.battleNo})`, { atReady: r.artAtReady, art: r.art });
            const imgs = r.artRequests.filter((p) => /\.(webp|png|jpg)$/.test(p));
            const ground = imgs.filter((p) => p.startsWith('/art/battle/'));
            check(ground.every((p) => /^\/art\/battle\/plains_(grass|dirt|road)\.webp$/.test(p)) && imgs.every((p) => /^\/art\/(faces\/[a-z]+|battle\/plains_(grass|dirt|road))\.webp$/.test(p)), `battle ${mode} ${tag}: only face and plains grass/dirt/road images requested (no forest floor, portraits or backgrounds)`, imgs);
            if (mode === 'default') check(['plains_grass.webp', 'plains_dirt.webp', 'plains_road.webp'].every((f) => r.groundResp.some(([g, st]) => g === f && st === 200)), `battle default ${tag}: the 3 ground images loaded (200)`, r.groundResp);
            if (mode !== 'default') check((r.aborted ?? []).length > 0 && r.groundResp.every(([g]) => mode === 'abort' || g !== 'plains_road.webp'), `battle ${mode} ${tag}: the aborted images really failed (${(r.aborted ?? []).length} aborted)`, r.aborted);
        }
        // 画面の外へはみ出さない：能力の欄・札・右上の部品・編成の表（どの見せ方でも）
        for (const [mode, r] of Object.entries(B)) {
            for (const scene of ['practice-briefing', 'battle-wide', 'battle-selected', 'battle-selected-ieyasu', 'battle-ishikawa-target']) {
                const L = layout[`${scene}|${mode}|${tag}`];
                if (!L) continue;
                const inside = (b) => b.l >= -0.5 && b.t >= -0.5 && b.r <= L.vw + 0.5 && b.b <= L.vh + 0.5;
                const out = [];
                if (L.abil && !inside(L.abil)) out.push(['abil', L.abil]);
                for (const [k, b] of Object.entries(L.insets)) if (!inside(b)) out.push([k, b]);
                if (L.abilScroll && L.abilScroll[0] > L.abilScroll[1] + 1) out.push(['abil scrolls', L.abilScroll]);
                if (L.briefTable && (L.briefTable.scroll[0] > L.briefTable.scroll[1] + 1 || L.briefTable.doc[0] > L.briefTable.doc[1])) out.push(['briefing table overflows sideways', L.briefTable]);
                check(out.length === 0, `${scene} ${mode} ${tag}: nothing off screen (ability panel, HUD, briefing table)`, out);
            }
        }
        if (B.fixture) check(B.fixture.art.ground === 'textured' && B.fixture.art.trees > 0, `battle fixture ${tag}: textured ground + plains woods trees (TEST pattern)`, B.fixture.art);
        // 本物の顔（default・manifest に顔がある）：会話・軍議は今の話し手の顔、合戦はその部隊の武将の顔。人物画・軍議の背景は使わない（新しい原画の到着待ち）。地面は大平原の草地・土・道（上の確かめ）
        const S = runsOf('story', size, q);
        if (S.old && S.default && genCount > 0) {
            const WANT = { 'conv-tadakatsu-line': 'face.tadakatsu', 'conv-ieyasu-line': 'face.ieyasu', 'conv-talk-choice': 'face.tadakatsu', 'conv-council-line': 'face.tadakatsu', 'conv-council-sakai-line': 'face.sakai', 'conv-council-ishikawa-line': 'face.ishikawa', 'conv-council-choice': 'face.tadakatsu' };
            const pc = size.split('x').map(Number)[1] > 430;
            for (const [scene, want] of Object.entries(WANT)) {
                const o = layout[`${scene}|old|${tag}`];
                const d = layout[`${scene}|default|${tag}`];
                if (!o || !d) {
                    check(false, `${scene} ${tag}: shot in both modes`);
                    continue;
                }
                check(!o.face && !o.hasFace && !o.portrait && !o.background, `${scene} old ${tag}: no face / portrait / background (V21)`);
                check(d.face?.visible && d.face.artId === want && d.hasFace, `${scene} default ${tag}: dialog face is the speaker's own face (${want})`, d.face);
                check(!d.portrait?.visible && !d.background?.base, `${scene} default ${tag}: no portrait / council background (not adopted)`, [d.portrait, d.background]);
                const dh = d.rects.dialog && o.rects.dialog ? Math.round((d.rects.dialog.b - d.rects.dialog.t - (o.rects.dialog.b - o.rects.dialog.t)) * 10) / 10 : null;
                check(dh !== null && dh <= 0.5 && Math.abs(d.rects.dialog.r - o.rects.dialog.r) < 0.6 && Math.abs(d.rects.dialog.b - o.rects.dialog.b) < 0.6, `${scene} default ${tag}: dialog not taller than old, same right/bottom edge (height ${dh >= 0 ? '+' : ''}${dh})`, [o.rects.dialog, d.rects.dialog]);
                if (pc) check(JSON.stringify(o.rects.text) === JSON.stringify(d.rects.text) && JSON.stringify(o.rects.name) === JSON.stringify(d.rects.name), `${scene} default ${tag}: PC: name and text boxes identical to old (dialog widened to the left)`, [o.rects.text, d.rects.text]);
                // Version 23：スマホ・狭い画面でも台詞の四角（字の大きさ・幅・折り返し）は Version 21 と同じ（顔のために台詞を小さくしない）。枠も同じ
                else check(JSON.stringify(o.rects.text) === JSON.stringify(d.rects.text) && JSON.stringify(o.rects.dialog) === JSON.stringify(d.rects.dialog) && d.font?.size === o.font?.size && d.font?.spacing === o.font?.spacing, `${scene} default ${tag}: phone/narrow: text box, dialog box and text font (${d.font?.size}) identical to old`, { old: [o.rects.text, o.font], new: [d.rects.text, d.font] });
                check(JSON.stringify(o.rects.choice) === JSON.stringify(d.rects.choice) && JSON.stringify(o.rects.head) === JSON.stringify(d.rects.head), `${scene} default ${tag}: choices and council header boxes identical to old`);
                // 読み込みの失敗（abort：素材の画像が全部読めない）：顔は出ず、台詞の枠・名前・台詞・選択肢は Version 21 と同じ
                const f = layout[`${scene}|abort|${tag}`];
                if (f) check(!f.face && !f.hasFace && JSON.stringify(['dialog', 'name', 'text', 'head', 'choices'].map((k) => o.rects[k])) === JSON.stringify(['dialog', 'name', 'text', 'head', 'choices'].map((k) => f.rects[k])) && JSON.stringify(o.rects.choice) === JSON.stringify(f.rects.choice) && f.font?.size === o.font?.size, `${scene} abort ${tag}: all images failed: no face, dialog/name/text/choices identical to old`, { face: f.face, dialog: [o.rects.dialog, f.rects.dialog] });
                // Version 22（比べの「前」の 2 枚目）：台詞の字の大きさを記録する（Version 22 はスマホで 14〜15 px に縮めていた）
                const v = layout[`${scene}|v22|${tag}`];
                if (v) layout[`font|${scene}|${tag}`] = { old: o.font, v22: v.font, v23: d.font };
            }
        }
        if (B.old && B.default && genCount > 0) {
            const own = (f) => (f.where.startsWith('card:') ? `face.${f.where.slice(7)}` : f.where.startsWith('brief:') ? `face.${f.where.slice(8)}` : null);
            for (const scene of ['practice-briefing', 'battle-wide', 'battle-selected', 'battle-selected-ieyasu', 'battle-ishikawa-target']) {
                const o = layout[`${scene}|old|${tag}`];
                const d = layout[`${scene}|default|${tag}`];
                if (!o || !d) {
                    if (scene !== 'battle-ishikawa-target' || B.old.ishikawaTarget) check(false, `${scene} ${tag}: shot in both modes`);
                    continue;
                }
                check(o.faces.length === 0, `${scene} old ${tag}: no face canvases (V21)`);
                const wrong = d.faces.filter((f) => own(f) !== null && own(f) !== f.artId).map((f) => `${f.where}:${f.artId}`);
                check(wrong.length === 0, `${scene} default ${tag}: every card / briefing-row face is that unit's own general (${d.faces.map((f) => `${f.where}:${f.artId}`).join(' ')})`, wrong);
                const abil = { 'battle-selected': 'face.tadakatsu', 'battle-selected-ieyasu': 'face.ieyasu', 'battle-ishikawa-target': 'face.ishikawa' }[scene];
                if (abil) {
                    const af = d.faces.filter((f) => f.where === 'abil-row');
                    // Version 23：能力の欄の顔は大きく（PC 52〜60 px・縦の狭い画面 40 px・高さ 370 以下 30 px）
                    const minW = d.vh <= 370 ? 30 : d.vh <= 520 ? 40 : 48;
                    check(af.length === 1 && af[0].artId === abil && af[0].rect.r - af[0].rect.l >= minW - 0.2, `${scene} default ${tag}: ability panel shows ${abil} at ${af[0] ? Math.round(af[0].rect.r - af[0].rect.l) : '-'} px (>= ${minW})`, af);
                }
                if (scene === 'practice-briefing') {
                    const gens = ['brief:a_ieyasu', 'brief:a_ishikawa', 'brief:a_sakai', 'brief:a_sakakibara', 'brief:a_tadakatsu'];
                    check(JSON.stringify(d.faces.map((f) => f.where).sort()) === JSON.stringify(gens), `${scene} default ${tag}: briefing table faces for the 5 generals`, d.faces.map((f) => f.where));
                    // 顔・名前・役割（Version 23）。武将のいない行の高さは Version 21 と同じ（ほかの列の部隊名・能力名を折り返させない）
                    const rowOf = (L, u) => L.briefRows.find((x) => x.unit === u);
                    const genRows = d.briefRows.filter((x) => x.gen);
                    const plain = o.briefRows.filter((x) => !d.briefRows.find((y) => y.unit === x.unit)?.gen);
                    check(genRows.length === 5 && genRows.every((x) => x.role && x.gen === rowOf(o, x.unit)?.text), `${scene} default ${tag}: briefing general cells show name (same text as old) + role`, genRows.map((x) => [x.unit, x.gen, x.role]));
                    check(plain.length > 0 && plain.every((x) => Math.abs(x.b - x.t - (rowOf(d, x.unit).b - rowOf(d, x.unit).t)) < 0.6), `${scene} default ${tag}: rows without a general keep the old height (no squeezed columns)`, plain.map((x) => [x.unit, Math.round((x.b - x.t) * 10) / 10, Math.round((rowOf(d, x.unit).b - rowOf(d, x.unit).t) * 10) / 10]));
                }
                if (scene !== 'practice-briefing') {
                    check(JSON.stringify(o.cards.map((c) => [c.id, c.l, c.t, c.r, c.b])) === JSON.stringify(d.cards.map((c) => [c.id, c.l, c.t, c.r, c.b])) && JSON.stringify(o.insets) === JSON.stringify(d.insets), `${scene} default ${tag}: card and HUD boxes identical to old`);
                    // 能力の欄：位置・幅は同じ。高くなるのは顔の分だけ（PC 22 px・縦の狭い画面 18 px まで。高さ 370 以下は 2 px まで＝下の地図の名札を覆わない）
                    const maxGrow = d.vh <= 370 ? 2 : d.vh <= 520 ? 18 : 22;
                    const grow = o.abil && d.abil ? Math.round((d.abil.b - d.abil.t - (o.abil.b - o.abil.t)) * 10) / 10 : null;
                    check(!!o.abil === !!d.abil && (!o.abil || (Math.abs(o.abil.t - d.abil.t) < 0.6 && Math.abs(o.abil.l - d.abil.l) < 0.6 && Math.abs(o.abil.r - d.abil.r) < 0.6 && grow <= maxGrow + 0.2)), `${scene} default ${tag}: ability panel: same position and width as old, ${grow === null ? 'no panel' : `${grow >= 0 ? '+' : ''}${grow} px taller`} (<= ${maxGrow})`, [o.abil, d.abil]);
                }
            }
            if (B.old.ishikawaTarget || B.default.ishikawaTarget) {
                check(B.old.ishikawaTarget && B.default.ishikawaTarget && B.old.ishikawaUsed === null && B.default.ishikawaUsed === null && JSON.stringify(B.old.targetLabels) === JSON.stringify(B.default.targetLabels), `battle ${tag}: Ishikawa target selection opened in both modes, same target labels, cancelled without using the ability`, [B.old.targetLabels, B.default.targetLabels]);
                check(JSON.stringify(B.old.targetCamera) === JSON.stringify(B.default.targetCamera), `battle ${tag}: camera after auto-framing the Ishikawa targets identical to old`, [B.old.targetCamera, B.default.targetCamera]);
            }
            // 読む画像の種類は上の地面の確かめ（顔と大平原の草地・土・道だけ）
        }
        if (S.default && genCount > 0) {
            const imgs = S.default.artRequests.filter((p) => /\.(webp|png|jpg)$/.test(p));
            check(imgs.length > 0 && imgs.every((p) => /^\/art\/faces\/[a-z]+\.webp$/.test(p)), `story default ${tag}: loads only face WebPs (no portraits/backgrounds)`, imgs);
        }
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
            const panels = MONTAGE_MODES.filter((m) => MODES.includes(m)).map((m) => ({ mode: m, file: `${SHOTS}/${shotName(scene, m, tag)}.png`, label: MODE_LABEL[m] })).filter((p) => existsSync(p.file));
            if (V21_DIR) {
                const f = `${V21_DIR}/${scene}-${size}${q === 'default' ? '-high' : ''}.png`;
                if (existsSync(f)) panels.push({ mode: 'v21', file: f, label: 'REFERENCE  V21 be0b2e5 (earlier run; walk pose and time may differ)' });
            }
            if (panels.length >= 2) montages.push({ title: `${scene}  ${size}  q=${q}`, out: `${MONT}/${scene}-${tag}.png`, panels });
            // 読み込みの失敗の並べた絵（前・全部読めない・道だけ読めない）
            const fail = FAIL_MODES.filter((m) => MODES.includes(m)).map((m) => ({ mode: m, file: `${SHOTS}/${shotName(scene, m, tag)}.png`, label: MODE_LABEL[m] })).filter((p) => existsSync(p.file));
            if (fail.length >= 2 && fail.some((p) => p.mode !== 'old')) montages.push({ title: `${scene}  ${size}  q=${q}  (image load failure)`, out: `${MONT}/fail-${scene}-${tag}.png`, panels: fail });
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
