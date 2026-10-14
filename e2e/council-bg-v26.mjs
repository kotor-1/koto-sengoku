/**
 * 軍議の背景の見せ方（Version 26：表示の倍率で決める・1.25 倍を超える画面は範囲を限る）の確かめ（開発サーバー。本物の素材 manifest.gen.json）。
 *
 *   BASE=http://127.0.0.1:8743 node e2e/council-bg-v26.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     SIZES=1920x1080@1,1920x1080@2,2560x1440@1,1366x768@1,1280x720@1,1024x1366@2,844x390@2,844x390@3,667x375@2,568x320@2,390x844@2,390x844@3,412x915@3,360x640@2
 *                幅x高さ@端末の画素の比。高さ 430 以下・幅 480 以下はタッチ（hasTouch・isMobile）。それ以外はマウスとキー
 *     MODES=default,artoff   default … 何も付けない（Version 26）、artoff … ?artOff=council（背景だけ外す＝Version 24 と同じ軍議の画面。比べの元）
 *     PAR=3                  同時に動かすブラウザの数
 *     CONTRAST=1             文字を隠した写真（-notext.jpg）も撮る（文字の後ろの明るさを測る写真。四角は report.json の同じ行。測る道具はリポジトリに入れていない）
 *
 * 流れ（第一章）：タイトル → はじめから → 演出のスキップ → 織田の使者 → 城門の忠勝 → 「軍議を開く」→ 軍議（地の文・忠勝・家康・酒井・石川・方針の選択肢）。
 *   選択肢は決めない（並びを撮るだけ）。
 * 入力の記録（report.json の steps）：タイトルのボタン・演出のスキップ・話す（E／「話す」のタップ）・行送り（Enter／枠のタップ）・選択肢（クリック／タップ）は本物の入力。
 *   開発用の操作（__game・__p3）：相手の前への teleport・3D の手動の描画（render=manual の renderNow）・読むだけの数え上げ。
 *   背景の寸法は開発ビルドだけの .g-council-bg の data-probe（本番には無い）。
 * 確かめ：
 *   - default：どの画面でも背景を出す（端末の比で外さない）。表示の倍率 ＝ min(画面を埋める倍率, 1.25)。縦横同じ倍率（引き伸ばさない）。
 *     1.25 を超える画面は、画面より小さく真ん中に描く（周りは暗い地）。canvas の画素は元の画像の画素まで。canvas の四角は記録どおり。
 *   - default と artoff で、台詞の枠・名前・台詞・選択肢・軍議の見出し・立ち絵・台詞の枠の顔の四角が同じ（背景で立ち絵・顔・文字の大きさが変わらない）。
 *   - artoff：背景の要素が無い・画像を読まない。どちらもページの誤りが無い。
 *   Version 27（docs/v25-portraits.md の 13）：
 *   - 背景を画面より小さく描いている画面（2560×1440・1920×1200・1024×1366 など。描いた所が画面の幅・高さに足りない）では、立ち絵はその描いた所が元：
 *     描いた所の中（左・上・右）で下端は描いた所の下端、左端は描いた所の左端＋max(CSS の左の空き 24, 背景の左の縁をなじませる幅)、
 *     高さは描いた所の高さの 86% まで（元の画像の画素の上限・避ける物で小さくなるのは今までどおり）、縦横の比はそのまま（切らない）、
 *     頭の上に描いた所の高さの 10% 以上の空き、肩（shoulderY）は台詞の枠の上・なじませる所より上、腰の切り口（canvas の下の端）は透明までなじませる。
 *     artoff（背景なし）の立ち絵は Version 26 と同じ決まり（画面が元：下端は画面の下の端）なので、default と artoff で立ち絵だけが違う。
 *   - 背景が画面いっぱいの画面（1920×1080・1280×720・スマホ）は、立ち絵も今までどおり（default と artoff で同じ。BASELINE を渡せば Version 26 の記録とも同じ）。
 *   - 文字・選択肢・顔・見出し・ボタンの四角は、どの画面でも default と artoff で同じ（背景・立ち絵の決まりで動かない）。
 *   - RESIZE=1：2560×1440 は 1920×1080 へ、1024×1366 は 1366×1024 へ窓を変えて（開発用の操作 setViewportSize）戻し、立ち絵が今の画面の決まりで
 *     測り直され、戻した後は元の四角と同じ（古い大きさを残さない）。
 *   BASELINE=<Version 26 の report.json>：同じ大きさの同じ行の四角を比べる（背景を画面より小さく描く画面の軍議の立ち絵だけ違ってよい。ほかは同じ）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, passStreetReport, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8743';
const OUT = resolve(process.argv[2] || 'e2e-out/council-bg-v26');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = list(process.env.SIZES, '1920x1080@1,1920x1080@2,2560x1440@1,1920x1200@1,1366x768@1,1280x720@1,1024x1366@2,844x390@2,844x390@3,667x375@2,568x320@2,390x844@2,390x844@3,412x915@3,360x640@2');
const MODES = list(process.env.MODES, 'default,artoff');
const PAR = Math.max(1, Number(process.env.PAR || 3));
const CONTRAST = process.env.CONTRAST === '1';
const RESIZE = process.env.RESIZE === '1';
const BASELINE = process.env.BASELINE ? JSON.parse(readFileSync(resolve(process.env.BASELINE), 'utf8')) : null;
/** RESIZE=1 で窓を変えて戻す大きさ（元 → 変える先） */
const RESIZE_TO = { '2560x1440@1': [1920, 1080], '1024x1366@2': [1366, 1024] };
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const POLL = { timeout: 600000, polling: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const checks = [];
const check = (ok, what, detail) => {
    checks.push({ ok: !!ok, what, detail });
    if (!ok) console.log(`  NG ${what}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
};
const manifest = JSON.parse(readFileSync(new URL('../proto3d/src/art/manifest.gen.json', import.meta.url), 'utf8')).assets;
/** ui/artCanvas.ts の COUNCIL_ART と同じ値（ここで別に計算して比べる） */
const S_MAX = 1.25;
const MAX_CROP_Y = 0.18;

/** 立ち絵の決まり（ui/artCanvas.ts の PORTRAIT_RULES と同じ値） */
const PC_FRAC = 0.86;
const PHONE_FRAC = 0.8;
/** 頭の上の空きの下限（描いた背景の高さに対する割合。Version 27 の確かめの目安） */
const HEAD_ROOM = 0.1;

/**
 * 描いた背景の四角（canvas の四角 {l,t,r,b}）のうち画面に見えている所。画面いっぱい（0.5px まで）なら null（立ち絵は画面が元：Version 26 と同じ）
 */
function bgFrame(p) {
    const b = p.bg?.base?.rect;
    if (!b || !p.bg?.on || p.bg.hidden) return null;
    const f = { l: Math.max(0, b.l), t: Math.max(0, b.t), r: Math.min(p.vw, b.r), b: Math.min(p.vh, b.b) };
    if (f.l <= 0.5 && f.t <= 0.5 && f.r >= p.vw - 0.5 && f.b >= p.vh - 0.5) return null;
    return { ...f, w: f.r - f.l, h: f.b - f.t, fadeLeft: p.bg.probe?.feather?.[0] ?? 0, fadeBottom: p.bg.probe?.feather?.[1] ?? 0 };
}

/** 画面を埋める（cover・上下 18% まで切る）のに要る表示の倍率（councilArtLayout の need と同じ式） */
function needScale(vw, vh) {
    const e = manifest['bg.council'];
    const keep = 1 - 2 * MAX_CROP_Y;
    return Math.min(Math.max(vw / e.w, vh / e.h), vh / (e.h * keep));
}

/** 一番上の会話の層の四角と背景の記録（読むだけ） */
function probe() {
    const R = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const vbox = (e) => {
        if (!e || e.hidden) return null;
        const cs = getComputedStyle(e);
        if (cs.display === 'none') return null;
        return R(e);
    };
    // 立ち絵の canvas の、体の真ん中あたり（幅の 45%）の縦の列の不透明さ（下の端からの CSS の px → 0〜255）。腰の切り口のなじませ方を見る
    const alphaCol = (c) => {
        const ctx = c.getContext('2d');
        const cr = c.getBoundingClientRect();
        if (!ctx || !(cr.height > 0)) return null;
        const ky = c.height / cr.height;
        const x = Math.round(c.width * 0.45);
        const out = {};
        for (const up of [1, 10, 20, 30, 41, 60, 82, 90, 120, 200]) {
            const y = Math.max(0, Math.min(c.height - 1, Math.round(c.height - up * ky)));
            out[up] = ctx.getImageData(x, y, 1, 1).data[3];
        }
        return out;
    };
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    const d = L.querySelector('.g-dialog');
    const ch = L.querySelector('.g-choices');
    const head = L.querySelector('.g-council-head');
    const bg = L.querySelector('.g-council-bg');
    const base = bg?.querySelector('canvas.g-council-bg-base') ?? null;
    const pc = L.querySelector('canvas.g-portrait');
    const pShown = !!pc && !pc.hidden && pc.classList.contains('on');
    const f = d.querySelector('canvas.g-face');
    const fShown = !!f && !f.hidden && getComputedStyle(f).display !== 'none';
    return {
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        speaker: d.dataset.speaker,
        council: L.classList.contains('council'),
        dialog: R(d),
        name: R(d.querySelector('.name')),
        text: R(d.querySelector('.text')),
        textFont: getComputedStyle(d.querySelector('.text')).fontSize,
        choices: vbox(ch),
        choiceRects: ch && !ch.hidden ? [...ch.querySelectorAll('.g-choice')].map((b) => ({ id: b.dataset.id, ...R(b) })) : [],
        head: vbox(head),
        headH2: head ? R(head.querySelector('h2')) : null,
        headP: head ? R(head.querySelector('p')) : null,
        portrait: pShown ? { id: pc.dataset.artId, ...R(pc), style: [pc.style.left, pc.style.bottom], px: [pc.width, pc.height], alpha: alphaCol(pc) } : null,
        face: fShown ? { id: f.dataset.artId, compact: f.classList.contains('compact'), ...R(f) } : null,
        bg: bg
            ? {
                  hidden: bg.hidden,
                  on: bg.classList.contains('on'),
                  first: L.firstElementChild === bg,
                  bgColor: getComputedStyle(bg).backgroundColor,
                  probe: bg.dataset.probe ? JSON.parse(bg.dataset.probe) : null,
                  base: base ? { id: base.dataset.artId, px: [base.width, base.height], rect: R(base) } : null,
                  front: !!bg.querySelector('canvas.g-council-bg-front'),
              }
            : null,
        gArt: L.classList.contains('g-art'),
        bodyArt: document.body.classList.contains('g-council-art'),
    };
}

async function newPage(browser, size, mode) {
    const [wh, dprS] = size.split('@');
    const [w, h] = wh.split('x').map(Number);
    const dpr = Number(dprS || 1);
    const touch = h <= 430 || w <= 480;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    await ctx.addInitScript(() => performance.setResourceTimingBufferSize(100000));
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    const art = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/GPU stall|GL Driver/.test(m.text())) errors.push(m.text());
    });
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (/^\/art\//.test(p)) art.push(p);
    });
    const q = ['render=manual', mode === 'artoff' ? 'artOff=council' : ''].filter(Boolean).join('&');
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, touch, errors, art, w, h, dpr };
}

const report = { base: BASE, sizes: SIZES, modes: MODES, sMax: S_MAX, runs: [] };

async function run(browser, size, mode) {
    const rec = { size, mode, steps: [], lines: [], shots: [] };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${mode} ${size} ${how}: ${what}`);
    };
    const { ctx, page, touch, errors, art, w, h } = await newPage(browser, size, mode);
    const tag = `${mode}-${size.replace('@', 'at')}`;
    const press = async (loc) => {
        if (touch) await loc.tap();
        else await loc.click();
    };
    const shot = async (name) => {
        await page.evaluate(() => window.__p3?.renderNow?.());
        await sleep(250);
        const file = `${SHOTS}/${tag}-${name}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 80, timeout: 600000 });
        rec.shots.push(file);
        if (CONTRAST) {
            // 文字を隠した写真（文字の後ろの明るさを測る。四角は rec.lines の同じ行）
            await page.addStyleTag({ content: '.g-council-head h2,.g-council-head p,.g-dialog .name,.g-dialog .text,.g-choice,.g-choice *{color:transparent!important;text-shadow:none!important}' }).then((h) => h.evaluate((e) => e.setAttribute('data-hide', '1')));
            await sleep(120);
            const f2 = `${SHOTS}/${tag}-${name}-notext.jpg`;
            await page.screenshot({ path: f2, type: 'jpeg', quality: 95, timeout: 600000 });
            await page.evaluate(() => document.querySelectorAll('style[data-hide]').forEach((e) => e.remove()));
            rec.shots.push(f2);
        }
    };
    await sleep(450);
    await press(page.locator('.g-btn[data-id="new:ieyasu1570"]'));
    step('real', 'はじめから（歴史分岐）');
    await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(600);
    // Version 28 §4.3：使者は町の急報（通りを北へ線を越えた所で 1 回）の後に町へ来る。相手の前へ teleport する前に、本物の W で北へ歩いて越え、
    // 急報を飛ばす（Esc／タッチの端末は「スキップ」をタップ）
    await passStreetReport(page, { tap: touch, log: (t) => step('real', t) });
    const talkTo = async (id) => {
        const cast = await page.evaluate(() => window.__game.cast);
        const c = cast.find((x) => x.id === id);
        if (!c) throw new Error(`${id} が城下に居ない`);
        let ok = false;
        for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0]]) {
            await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x + dx, c.z + dz]);
            ok = await page.waitForFunction((t) => window.__game.prompt === t, id, { timeout: 15000, polling: 100 }).then(() => true, () => false);
            if (ok) break;
        }
        if (!ok) throw new Error(`${id} の「話す」が出ない`);
        step('dev API', `__game.teleport で ${id} の前へ`);
        await sleep(450);
        if (touch) await page.locator('.g-talk').tap();
        else await page.keyboard.press('KeyE');
        step('real', `話す（${touch ? '「話す」をタップ' : 'E キー'}）`);
        await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
    };
    const settle = async () => {
        // 立ち絵の読み込み・出入りの重ね変わり（140ms）・背景の出る 220ms を待つ
        await page
            .waitForFunction(
                () => {
                    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                    const sp = L?.querySelector('.g-dialog')?.dataset.speaker;
                    const want = { hero: 'ieyasu', tadakatsu: 'tadakatsu', sakai: 'sakai', ishikawa: 'ishikawa' }[sp];
                    if (!want || /artOff=[^&]*portrait|art=(v24|old)/.test(location.search)) return true;
                    return performance.getEntriesByType('resource').some((e) => e.name.includes(`/art/portraits/${want}_v2.webp`));
                },
                null,
                { timeout: 6000, polling: 100 },
            )
            .catch(() => {});
        await sleep(450);
    };
    const readScript = async (label, shotAt = {}) => {
        const id = (await page.evaluate(() => window.__game.ui?.id)) ?? '?';
        const seen = new Set();
        for (let k = 0; k < 80; k++) {
            await sleep(200);
            const u = await page.evaluate(() => window.__game.ui);
            if (u?.kind !== 'script' || u.id !== id) break;
            await settle();
            const p = await page.evaluate(probe);
            const sk = `${p.speaker}${u.choices?.length ? '+choices' : ''}`;
            const line = { script: id, index: u.index, key: sk, ...p };
            rec.lines.push(line);
            if (shotAt[sk] && !seen.has(sk)) {
                seen.add(sk);
                await shot(`${label}-${shotAt[sk]}`);
            }
            if (u.choices?.length) break;
            if (touch) await page.locator('.g-layer[data-kind="script"] .g-dialog').last().tap();
            else await page.keyboard.press('Enter');
        }
        step('real', `${label}（${id}）を ${touch ? '枠のタップ' : 'Enter'} で進めた`);
        return id;
    };
    const choose = async (cid) => {
        await sleep(450);
        await press(page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${cid}"]`).last());
        step('real', `選ぶ ${cid}（${touch ? 'タップ' : 'クリック'}）`);
    };
    await talkTo('oda_envoy');
    await readScript('envoy');
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(400);
    await talkTo('tadakatsu');
    await readScript('gate');
    await choose('open_council');
    await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council', null, POLL);
    await sleep(600);
    await readScript('council', { narration: 'narration', sakai: 'sakai', ishikawa: 'ishikawa', 'tadakatsu+choices': 'choices', 'hero+choices': 'choices', 'ishikawa+choices': 'choices', 'sakai+choices': 'choices' });
    if (RESIZE && RESIZE_TO[size]) {
        // 窓を変えて戻す（開発用の操作：setViewportSize。回転・窓の大きさの変更の代わり）。方針の選択肢の行のまま
        const [w2, h2] = RESIZE_TO[size];
        // 窓の resize はブラウザの描画の手順で届く（render=manual で動きの無い行では、次の描画が来るまで届かない）。2 フレーム描かせてから測る
        const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
        const before = await page.evaluate(probe);
        await page.setViewportSize({ width: w2, height: h2 });
        step('dev API', `setViewportSize ${w2}x${h2}`);
        await frames();
        await frames();
        await settle();
        const mid = await page.evaluate(probe);
        await shot(`resize-${w2}x${h2}`);
        await page.setViewportSize({ width: w, height: h });
        step('dev API', `setViewportSize ${w}x${h}（戻す）`);
        await frames();
        await frames();
        await settle();
        const after = await page.evaluate(probe);
        rec.resize = { to: [w2, h2], before, mid, after };
    }
    rec.art = [...new Set(art)];
    rec.errors = errors.filter((e) => !/\[art\]/.test(e));
    await ctx.close();
    return rec;
}

const near = (a, b, tol = 0.6) => (a === null && b === null) || (!!a && !!b && ['l', 't', 'r', 'b'].every((k) => Math.abs(a[k] - b[k]) <= tol));

/** 立ち絵の決まり（Version 27）：背景を画面より小さく描いている軍議は描いた所が元、それ以外は画面が元（Version 26 と同じ）。L は記録の名前 */
function checkPortrait(L, p) {
    const pr = p.portrait;
    if (!pr) return;
    const e = manifest[pr.id];
    if (!e) return check(false, `${L} 立ち絵 ${pr.id} が一覧にある`);
    const A = e.w / e.h;
    const sy = e.meta?.shoulderY ?? 0.46;
    check(Math.abs(pr.w - Math.floor(pr.h * A)) <= 1, `${L} 立ち絵の縦横の比はそのまま（${Math.round(pr.w)}×${Math.round(pr.h)}・比 ${A.toFixed(3)}。切らない・引き伸ばさない）`, pr);
    check(pr.h * p.dpr <= e.h + 0.5, `${L} 立ち絵は元の画像を拡大しない（${Math.round(pr.h)} × ${p.dpr} ≦ ${e.h}）`, pr);
    if (p.dialog && p.dialog.l < pr.r && p.dialog.r > pr.l && p.dialog.t < pr.b) check(p.dialog.t - pr.t >= sy * pr.h - 0.6, `${L} 肩まで台詞の枠の上に見える`, { top: pr.t, dialogTop: p.dialog.t, need: sy * pr.h });
    for (const [k, b] of [['choices', p.choices], ['head', p.headH2], ['headP', p.headP]]) if (b) check(!(pr.l < b.r - 0.5 && b.l < pr.r - 0.5 && pr.t < b.b - 0.5 && b.t < pr.b - 0.5), `${L} 立ち絵が ${k} と重ならない`, { pr, b });
    const f = p.council ? bgFrame(p) : null;
    if (!f) {
        check(Math.abs(pr.b - p.vh) < 0.6 && !pr.style[0] && !pr.style[1], `${L} 背景が画面いっぱい・無い：立ち絵は画面が元（下端は画面の下の端・左端は CSS。Version 26 と同じ決まり）`, pr);
        check(pr.h <= Math.floor(p.vh * (p.vh <= 430 ? PHONE_FRAC : PC_FRAC)) + 0.5, `${L} 立ち絵の高さは画面の ${(p.vh <= 430 ? PHONE_FRAC : PC_FRAC) * 100}% まで`, pr);
        return;
    }
    const wantLeft = f.l + Math.max(p.vh <= 430 ? 8 : 24, f.l > 0.5 ? f.fadeLeft : 0);
    check(Math.abs(pr.b - f.b) < 0.6, `${L} 範囲を限った背景：立ち絵の下端は描いた所の下端 ${f.b}`, { pr, f });
    check(Math.abs(pr.l - wantLeft) < 0.6, `${L} 立ち絵の左端は描いた所の左端＋max(24, なじませる幅 ${f.fadeLeft}) ＝ ${wantLeft}`, { pr, f });
    check(pr.l >= f.l - 0.5 && pr.r <= f.r + 0.5 && pr.t >= f.t - 0.5, `${L} 立ち絵は描いた背景の中（外の暗い地にはみ出さない）`, { pr, f });
    const ratio = pr.h / f.h;
    const full = Math.min(Math.floor(f.h * PC_FRAC), Math.floor(e.h / p.dpr));
    check(pr.h <= Math.floor(f.h * PC_FRAC) + 0.5, `${L} 立ち絵の高さは描いた背景の高さの ${PC_FRAC * 100}% まで（${Math.round(pr.h)}／${f.h}＝${ratio.toFixed(3)}）`, { pr, f });
    // 選択肢が、その大きさの立ち絵の右（＋間 8px）より左・上端より下まで来る行は、選択肢を避けて小さくなる（今までと同じ決まり）。それ以外は決まりの大きさちょうど
    const byChoices = !!p.choices && p.choices.l < pr.l + Math.floor(full * A) + 8 && p.choices.b + 8 > f.b - full;
    if (!byChoices) check(Math.abs(pr.h - full) <= 0.6, `${L} 避ける物が無ければ min(描いた背景の 86%, 原寸÷端末の比) ＝ ${full}`, { h: pr.h, full });
    else check(pr.h <= full + 0.5 && (pr.r <= p.choices.l - 8 + 0.6 || pr.t >= p.choices.b + 8 - 0.6), `${L} 選択肢を避けて小さくする（選択肢との間 8px）`, { pr, choices: p.choices });
    check(pr.t - f.t >= HEAD_ROOM * f.h - 0.5, `${L} 頭・髷の上に描いた背景の高さの ${HEAD_ROOM * 100}% 以上の空き（${Math.round(pr.t - f.t)}px）`, { pr, f });
    check(pr.t + sy * pr.h <= f.b - f.fadeBottom, `${L} 肩（${sy}）はなじませる所（下の ${f.fadeBottom}px）より上`, { pr, f });
    if (f.fadeBottom > 0 && pr.alpha) {
        // 下の端の 1px は透明に近く、なじませる幅より上（体の真ん中の列）は不透明
        const above = [10, 20, 30, 41, 60, 82, 90, 120, 200].find((k) => k >= f.fadeBottom + 8) ?? 200;
        check(pr.alpha[1] <= 16 && pr.alpha[above] >= 200, `${L} 腰の切り口は背景の下の縁と同じ ${f.fadeBottom}px で透明までなじませる（下の端の不透明さ ${pr.alpha[1]}・${above}px 上 ${pr.alpha[above]}）`, pr.alpha);
    }
}

function verify(rec) {
    const tag = `${rec.mode} ${rec.size}`;
    check(rec.errors.length === 0, `${tag}：ページの誤りが無い`, rec.errors.slice(0, 3));
    const council = rec.lines.filter((l) => l.script === 'council');
    check(council.length >= 5, `${tag}：軍議の行を読んだ（${council.length} 行）`);
    for (const p of rec.lines.filter((l) => l.script !== 'council')) checkPortrait(`${tag} ${p.script}#${p.index + 1}(${p.key})`, p);
    for (const p of council) checkPortrait(`${tag} council#${p.index + 1}(${p.key})`, p);
    if (rec.resize) {
        const { before, mid, after, to } = rec.resize;
        const L = `${tag} 窓を ${to.join('x')} へ変えて戻す`;
        checkPortrait(`${L}（変える前）`, before);
        checkPortrait(`${L}（${to.join('x')}）`, mid);
        checkPortrait(`${L}（戻した後）`, after);
        if (rec.mode === 'default') check(!!mid.portrait && !!before.portrait && !near(mid.portrait, before.portrait), `${L}：変えた先では今の画面の決まりで測り直す（古い大きさを残さない）`, { before: before.portrait, mid: mid.portrait });
        check(near(after.portrait, before.portrait) && near(after.dialog, before.dialog) && near(after.choices, before.choices) && near(after.head, before.head), `${L}：戻した後の立ち絵・台詞の枠・選択肢・見出しの四角は変える前と同じ`, { before: before.portrait, after: after.portrait });
    }
    for (const p of council) {
        const L = `${tag} council#${p.index + 1}(${p.key})`;
        check(p.textFont === `${p.vh <= 430 ? 15 : 16}px`, `${L} 台詞の字は ${p.vh <= 430 ? 15 : 16}px`, p.textFont);
        if (rec.mode === 'artoff') {
            check(!p.bg && !p.gArt && !p.bodyArt, `${L} ?artOff=council：背景の要素が無い（Version 24 の軍議の画面）`, p.bg);
            continue;
        }
        const need = needScale(p.vw, p.vh);
        const want = Math.min(need, S_MAX);
        const showing = !!p.bg && !p.bg.hidden && p.bg.on && p.gArt;
        check(showing, `${L} 背景を出す（画面を埋める倍率 ${need.toFixed(3)}・端末の比 ${p.dpr} でも外さない）`, p.bg);
        if (!showing) continue;
        const pr = p.bg.probe;
        check(!!pr, `${L} 開発用の記録（data-probe）がある`, p.bg);
        if (!pr) continue;
        const e = manifest['bg.council'];
        check(pr.file[0] === e.w && pr.file[1] === e.h, `${L} 元の画像は ${e.w}×${e.h}（一覧と同じ。1920 幅の原画ではない）`, pr.file);
        check(Math.abs(pr.need - need) < 0.002 && Math.abs(pr.scale - want) < 0.002, `${L} 表示の倍率 ${want.toFixed(3)}（埋める倍率 ${need.toFixed(3)}・上限 ${S_MAX}）`, pr);
        check(pr.limited === need > S_MAX + 1e-9, `${L} 範囲を限るのは埋める倍率が ${S_MAX} を超える画面だけ`, pr);
        const [sx, sy, sw, sh] = pr.src;
        const [dx, dy, dw, dh] = pr.css;
        check(Math.abs(dw / sw - dh / sh) < 0.003 && Math.abs(dw / sw - pr.scale) < 0.003, `${L} 縦横同じ倍率（引き伸ばさない）`, pr);
        check(sx >= -0.01 && sy >= -0.01 && sx + sw <= e.w + 0.01 && sy + sh <= e.h + 0.01, `${L} 切り出しは画像の中`, pr.src);
        check(dx >= -0.01 && dy >= -0.01 && dx + dw <= p.vw + 0.6 && dy + dh <= p.vh + 0.6, `${L} 描く所は画面の中`, pr.css);
        if (pr.limited) check(Math.abs(dx - (p.vw - dw) / 2) < 0.6 && Math.abs(dy - (p.vh - dh) / 2) < 0.6 && (dx > 0.5) === pr.feather[0] > 0 && (dy > 0.5) === pr.feather[1] > 0, `${L} 範囲を限った絵は真ん中で、帯のある向きの縁をなじませる`, pr);
        else check((dw >= p.vw - 0.6 && dh >= p.vh - 0.6) || (dx > 0 && dh >= p.vh - 0.6), `${L} 範囲を限らない画面は埋める（とても横長だけ左右に帯）`, pr);
        const b = p.bg.base;
        check(!!b && near(b.rect, { l: dx, t: dy, r: dx + dw, b: dy + dh }, 0.6), `${L} canvas の四角は記録どおり`, { rect: b?.rect, css: pr.css });
        check(!!b && b.px[0] <= Math.ceil(sw) + 1 && b.px[1] <= Math.ceil(sh) + 1, `${L} canvas の画素は元の画像の切り出しまで（${b?.px}・切り出し ${Math.round(sw)}×${Math.round(sh)}）`, b?.px);
        check(!!b && Math.abs(b.px[0] / b.px[1] - dw / dh) < 0.01, `${L} canvas の縦横の比は描く所と同じ`, b?.px);
        check(p.bg.first && p.bg.base?.id === 'bg.council', `${L} 背景は層のいちばん奥・昼の軍議所`, p.bg);
        check(/rgb\(14, 12, 10\)/.test(p.bg.bgColor), `${L} 周りの地は暗い色`, p.bg.bgColor);
    }
    if (rec.mode === 'artoff') check(!rec.art.some((x) => x.includes('/story/')), `${tag} ?artOff=council：背景の画像を読まない`, rec.art);
    else check(rec.art.includes('/art/story/council_day.webp'), `${tag} 背景の画像を読む`, rec.art);
}

function compare(def, off) {
    const tag = `${def.size}`;
    const A = def.lines.filter((l) => l.script === 'council');
    const B = off.lines.filter((l) => l.script === 'council');
    check(A.length === B.length, `${tag} default と artoff で同じ行を通る（${A.length}・${B.length}）`);
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
        const a = A[i];
        const b = B[i];
        const L = `${tag} council#${a.index + 1}(${a.key})`;
        check(a.key === b.key, `${L} 同じ話し手`, [a.key, b.key]);
        for (const k of ['dialog', 'name', 'text', 'choices', 'head', 'headH2', 'headP']) check(near(a[k], b[k]), `${L} ${k} の四角が背景の有無で変わらない`, { def: a[k], off: b[k] });
        check(a.choiceRects.length === b.choiceRects.length && a.choiceRects.every((r, j) => near(r, b.choiceRects[j])), `${L} 選択肢の四角が背景の有無で変わらない`);
        if (!bgFrame(a)) check(near(a.portrait, b.portrait) && (a.portrait?.id ?? null) === (b.portrait?.id ?? null), `${L} 背景が画面いっぱい：立ち絵の有無と四角が背景の有無で変わらない`, { def: a.portrait, off: b.portrait });
        else check((a.portrait?.id ?? null) === (b.portrait?.id ?? null) && (!b.portrait || Math.abs(b.portrait.b - b.vh) < 0.6), `${L} 範囲を限った背景：立ち絵は同じ人で、背景の無い artoff は画面が元（Version 26 と同じ）・default は描いた所が元`, { def: a.portrait, off: b.portrait });
        check(near(a.face, b.face) && (a.face?.id ?? null) === (b.face?.id ?? null), `${L} 台詞の枠の顔の有無と四角が背景の有無で変わらない`, { def: a.face, off: b.face });
    }
}

const browser = await launchBrowser();
const jobs = [];
for (const size of SIZES) for (const mode of MODES) jobs.push({ size, mode });
const results = [];
let next = 0;
async function worker() {
    while (next < jobs.length) {
        const j = jobs[next++];
        log(`start ${j.mode} ${j.size}`);
        try {
            const rec = await run(browser, j.size, j.mode);
            results.push(rec);
            verify(rec);
        } catch (e) {
            check(false, `${j.mode} ${j.size}：最後まで進めた`, String(e?.stack || e).slice(0, 400));
        }
        log(`done ${j.mode} ${j.size}`);
    }
}
await Promise.all(Array.from({ length: PAR }, worker));
await browser.close();
for (const size of SIZES) {
    const d = results.find((r) => r.size === size && r.mode === 'default');
    const o = results.find((r) => r.size === size && r.mode === 'artoff');
    if (d && o) compare(d, o);
}
/** BASELINE（Version 26 の report.json）と同じ行の四角を比べる。背景を画面より小さく描く軍議の立ち絵だけ違ってよい */
const beforeAfter = [];
if (BASELINE) {
    for (const r of results) {
        const b = BASELINE.runs.find((x) => x.size === r.size && x.mode === r.mode);
        if (!b) continue;
        const tag = `${r.mode} ${r.size} BASELINE`;
        check(b.lines.length === r.lines.length, `${tag}：Version 26 と同じ数の行を通る（${b.lines.length}・${r.lines.length}）`);
        for (let i = 0; i < Math.min(b.lines.length, r.lines.length); i++) {
            const x = b.lines[i];
            const y = r.lines[i];
            const L = `${tag} ${y.script}#${y.index + 1}(${y.key})`;
            check(x.script === y.script && x.key === y.key, `${L} 同じ行`, [x.key, y.key]);
            for (const k of ['dialog', 'name', 'text', 'choices', 'head', 'headH2', 'headP', 'face']) check(near(x[k], y[k]), `${L} ${k} の四角は Version 26 と同じ`, { v26: x[k], now: y[k] });
            check(x.choiceRects.length === y.choiceRects.length && x.choiceRects.every((c, j) => near(c, y.choiceRects[j])), `${L} 選択肢の四角は Version 26 と同じ`);
            check(x.textFont === y.textFont, `${L} 台詞の字の大きさは Version 26 と同じ（${y.textFont}）`, [x.textFont, y.textFont]);
            const f = y.council ? bgFrame(y) : null;
            if (!f) check(near(x.portrait, y.portrait) && (x.portrait?.id ?? null) === (y.portrait?.id ?? null), `${L} 立ち絵の四角は Version 26 と同じ（背景が画面いっぱい・無い・会話の画面）`, { v26: x.portrait, now: y.portrait });
            else if (y.portrait) beforeAfter.push({ size: r.size, mode: r.mode, line: `${y.script}#${y.index + 1}(${y.key})`, frame: [f.l, f.t, f.w, f.h], before: x.portrait && [x.portrait.l, x.portrait.t, x.portrait.w, x.portrait.h].map((v) => Math.round(v)), after: [y.portrait.l, y.portrait.t, y.portrait.w, y.portrait.h].map((v) => Math.round(v)), ratioBefore: x.portrait ? Math.round((x.portrait.h / f.h) * 1000) / 1000 : null, ratioAfter: Math.round((y.portrait.h / f.h) * 1000) / 1000 });
        }
    }
}
report.beforeAfter = beforeAfter;
report.runs = results;
const table = SIZES.map((size) => {
    const d = results.find((r) => r.size === size && r.mode === 'default');
    const p = d?.lines.find((l) => l.script === 'council' && l.bg?.probe)?.bg?.probe ?? null;
    return { size, shown: !!p, need: p?.need ?? null, scale: p?.scale ?? null, limited: p?.limited ?? null, src: p?.src ?? null, css: p?.css ?? null, device: p?.device ?? null, deviceScale: p?.deviceScale ?? null, canvas: p?.canvas ?? null, feather: p?.feather ?? null };
});
report.table = table;
report.checks = checks;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const ng = checks.filter((c) => !c.ok);
log(`checks ${checks.length - ng.length}/${checks.length} OK`);
for (const t of table) log(`  ${t.size}: shown=${t.shown} need=${t.need} scale=${t.scale} limited=${t.limited} css=${JSON.stringify(t.css)} device=${JSON.stringify(t.device)} canvas=${JSON.stringify(t.canvas)}`);
for (const r of results.filter((x) => x.mode === 'default')) {
    const sizes = new Map();
    for (const p of r.lines.filter((l) => l.portrait)) sizes.set(`${p.script}:${p.portrait.id}`, `${[p.portrait.l, p.portrait.t, p.portrait.w, p.portrait.h].map((v) => Math.round(v)).join(',')}${p.council && bgFrame(p) ? ` frame=${bgFrame(p).h}` : ''}`);
    log(`  portrait ${r.size}: ${[...sizes].map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
for (const x of beforeAfter) log(`  before/after ${x.size} ${x.mode} ${x.line}: frame=${x.frame} before=${x.before} (${x.ratioBefore}) after=${x.after} (${x.ratioAfter})`);
process.exit(ng.length ? 1 : 0);
