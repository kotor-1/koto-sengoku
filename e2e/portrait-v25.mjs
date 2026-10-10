/**
 * 会話・軍議の人物画（Version 25：素材パック sengoku_individual_art_v2 の半身の立ち絵。話す 4 人）の確かめ（開発サーバー。本物の素材 manifest.gen.json）。
 *
 *   BASE=http://127.0.0.1:8734 node e2e/portrait-v25.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     SIZES=1920x1080@1,1280x720@1,768x1024@2,844x390@2,667x375@2,568x320@2,390x844@2,360x640@2
 *                    幅x高さ@端末の画素の比。高さ 430 以下・幅 480 以下はタッチ（hasTouch・isMobile）。それ以外はマウスとキー
 *     MODES=default,v24,old   default … 何も付けない（人物画 4（話す人）・新しい顔・原寸以内なら軍議の背景）、
 *                             v24 … ?art=v24（Version 24 の見た目：第 1 版の顔だけ・人物画も背景も無し）、old … ?art=old（Version 21 の見た目）
 *     PARTS=ch1,ch2   ch1 … タイトル → はじめから → 織田の使者（使者の行・家康の行）→ 城門の忠勝（地の文・忠勝・家康・選択肢）→ 軍議（地の文・忠勝・
 *                           家康・酒井・石川・方針 A/B/C。PC は ↓ キーで B・C を選んだ所も撮る）→ A → 確かめ（それで決める／考え直す）→ 考え直す →
 *                           改めて → A → 確かめ → それで決める
 *                     ch2 … 第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/home_victory_kept：方針 C＝自領の防衛）を localStorage に入れる
 *                           （直接状態変更）→ 第二章 → 村の使い（village の行・家康の行）→ 石川 → 忠勝 → 軍議（酒井・石川・忠勝・判断の選択肢）→
 *                           兵を出す → 確かめ → 決める → 石川（補充の選択肢）→ 少し考える
 *     CH2_SIZES=1280x720@1,844x390@2,568x320@2,390x844@2   ch2 を走らせる大きさ
 *     PAR=3           同時に動かすブラウザの数
 *
 * 出力：<出力先>/shots/<部>-<見せ方>-<大きさ>-<場面>.jpg、<出力先>/report.json（行ごとの人物画・顔・背景・四角・確かめ）。
 * 入力の記録（report.json の steps）：タイトルのボタン・演出のスキップ・話す（E／「話す」のタップ）・行送り（Enter／枠のタップ）・選択肢（クリック／タップ）・
 *   ↑↓（PC の選択肢の選び替え）は本物の入力。開発用の操作（__game・__p3）：相手の前への teleport・保存の差し込み（ch2 の localStorage。直接状態変更）・
 *   3D の手動の描画（render=manual の renderNow）・読むだけの数え上げ（ui・cast・prompt・state）。
 * 確かめ（行ごと）：
 *   - default：人物画は今の話し手本人の物だけ（使者・村の使い・地の文・高札の行は出さない。前の人の絵を残さない）。出す・出さないと大きさは
 *     決まり（ui/artCanvas.ts の portraitLayout と同じ計算をここで行う）どおり：選択肢・軍議の見出し（後ろの暗さ込み）・詳しく見る・目的の札・
 *     メニュー・情勢と重ならない・元の画像の画素より大きくしない（高さ × 端末の比 ≦ 画像の高さ）・台詞の枠の上に肩まで見える・枠の中は透明・
 *     下端は画面の下の端・押せない・反転しない。人物画が出ている行は、その人の台詞の枠の顔を出さない（同じ人を 2 つ並べない）。
 *     軍議の背景は、原寸以内に描ける画面（cover の倍率 × 端末の比 ≦ 1）だけ出し、それ以外は読まない（Version 24 の軍議の画面）。
 *   - v24：人物画・軍議の背景の要素も読み込みも無い。顔は第 1 版（face.pack1.<武将>）。old：素材の要素も読み込みも無い。
 *   - どの見せ方も：台詞の字は Version 24 と同じ（高さ 430 以下 15px・それ以外 16px）。old と同じ台本・行・台詞・選択肢を通る。
 *     選択肢・台詞の四角は old と同じ（人物画・顔で動かない）。ページの誤りが無い。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boxesOverlap, launchBrowser, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8734';
const OUT = resolve(process.argv[2] || 'e2e-out/portrait-v25');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = list(process.env.SIZES, '1920x1080@1,1280x720@1,768x1024@2,844x390@2,667x375@2,568x320@2,390x844@2,360x640@2');
const MODES = list(process.env.MODES, 'default,v24,old');
const PARTS = list(process.env.PARTS, 'ch1,ch2');
const CH2_SIZES = list(process.env.CH2_SIZES, '1280x720@1,844x390@2,568x320@2,390x844@2');
const PAR = Math.max(1, Number(process.env.PAR || 3));
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
const KEY = 'koto-sengoku/3d-ieyasu1570';
const CH2_FIXTURE = readFileSync(new URL('../tests/fixtures/ieyasu-ch1-v3/home_victory_kept.json', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../proto3d/src/art/manifest.gen.json', import.meta.url), 'utf8')).assets;

// 話し手 → 武将（proto3d/src/campaign/ieyasu1570/scenario.ts の IEYASU_SPEAKER_GENERAL と同じ。使者・村の使い・地の文・高札は無し）
const SPEAKER_GENERAL = { hero: 'ieyasu', tadakatsu: 'tadakatsu', sakai: 'sakai', ishikawa: 'ishikawa', sakakibara: 'sakakibara', nagamasa: 'nagamasa' };
// 人物画は会話・軍議で話す 4 人だけ（榊原・長政は立ち絵を公開しない：art/ids.ts の PORTRAIT_OF。その行は顔だけ）
const PORTRAIT_GENERALS = new Set(['ieyasu', 'tadakatsu', 'sakai', 'ishikawa']);
const portraitOf = (sp) => (PORTRAIT_GENERALS.has(SPEAKER_GENERAL[sp]) ? `portrait.${SPEAKER_GENERAL[sp]}` : null);
const faceOf = (sp, mode) => (SPEAKER_GENERAL[sp] ? (mode === 'v24' ? `face.pack1.${SPEAKER_GENERAL[sp]}` : `face.${SPEAKER_GENERAL[sp]}`) : null);

// ---- ui/artCanvas.ts の決まりと同じ計算（ここで期待する大きさを出す）
const R = { minViewportH: 340, phoneFrac: 0.8, pcFrac: 0.86, minFreeW: 150, minH: 210, shoulderY: 0.46 };
function portraitLayout(p) {
    if (!(p.vw > 0 && p.vh >= R.minViewportH && p.aspect > 0)) return null;
    const gap = 8;
    let h = p.vh * (p.vh <= 430 ? R.phoneFrac : R.pcFrac);
    h = Math.min(h, Math.max(0, p.maxH));
    h = Math.min(h, (p.vw - p.left - gap) / p.aspect);
    const live = p.avoid.filter((o) => o.right > o.left && o.bottom > o.top && o.right > p.left && o.top < p.bottom);
    for (const o of live) h = Math.min(h, Math.max((o.left - gap - p.left) / p.aspect, p.bottom - (o.bottom + gap)));
    h = Math.floor(h);
    const w = Math.floor(h * p.aspect);
    if (h < R.minH) return null;
    const top = p.bottom - h;
    let free = p.vw - gap - p.left;
    for (const o of live) if (o.bottom > top) free = Math.min(free, o.left - gap - p.left);
    if (free < R.minFreeW) return null;
    const d = p.dialog;
    if (d && d.right > d.left && d.bottom > d.top && d.left < p.left + w && d.right > p.left && d.top < p.bottom && d.top - top < (p.shoulderY ?? R.shoulderY) * h) return null;
    return { w, h };
}
/** 軍議の背景（1664×936・cover・上下 18% まで切る）の、元の 1 画素あたりの端末の画素 */
function councilScale(vw, vh, dpr) {
    const e = manifest['bg.council'];
    const keep = 1 - 2 * 0.18;
    let s = Math.max(vw / e.w, vh / e.h);
    s = Math.min(s, vh / (e.h * keep));
    return s * dpr;
}

/** 一番上の会話の層：台詞の枠・人物画・顔・背景・避ける物（artCanvas の測り方と同じ）の四角（読むだけ） */
function probe() {
    const R = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    // artCanvas の visibleBox と同じ：hidden・display:none は無い。層の外の物は visibility:hidden も無い
    const vbox = (e, outside = false) => {
        if (!e || e.hidden) return null;
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || (outside && cs.visibility === 'hidden')) return null;
        return R(e);
    };
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    if (!L) return null;
    const d = L.querySelector('.g-dialog');
    const head = L.querySelector('.g-council-head');
    let headBox = vbox(head);
    if (headBox && L.classList.contains('g-art')) {
        const ps = getComputedStyle(head, '::before');
        const out = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) && n < 0 ? -n : 0;
        };
        if (ps && ps.content && ps.content !== 'none' && ps.content !== 'normal') headBox = { ...headBox, l: headBox.l - out(ps.left), t: headBox.t - out(ps.top), r: headBox.r + out(ps.right), b: headBox.b + out(ps.bottom) };
    }
    const ch = L.querySelector('.g-choices');
    const pc = L.querySelector('canvas.g-portrait');
    let portrait = null;
    if (pc) {
        const cs = getComputedStyle(pc);
        const shown = !pc.hidden && cs.display !== 'none' && pc.classList.contains('on');
        const cr = pc.getBoundingClientRect();
        let alphaInDialog = null;
        let opaqueAbove = 0;
        if (shown && cr.width > 0) {
            // 1 回だけ読み出して、その中を見る（1 画素ずつの読み出しは遅い）
            const img = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
            const kx = pc.width / cr.width;
            const ky = pc.height / cr.height;
            const a = (x, y) => img[(Math.min(pc.height - 1, Math.max(0, Math.floor((y - cr.top) * ky))) * pc.width + Math.min(pc.width - 1, Math.max(0, Math.floor((x - cr.left) * kx)))) * 4 + 3];
            const dr = d.getBoundingClientRect();
            const rad = parseFloat(getComputedStyle(d).borderTopLeftRadius) || 0;
            const inRound = (x, y) => {
                const cx = Math.min(Math.max(x, dr.left + rad), dr.right - rad);
                const cy = Math.min(Math.max(y, dr.top + rad), dr.bottom - rad);
                return Math.hypot(x - cx, y - cy) <= Math.max(0, rad - 2);
            };
            let m = 0;
            let n = 0;
            for (let y = Math.max(dr.top, cr.top) + 2; y < Math.min(dr.bottom, cr.bottom) - 2; y += 5) for (let x = Math.max(dr.left, cr.left) + 2; x < Math.min(dr.right, cr.right) - 2; x += 5) if (inRound(x, y)) (m = Math.max(m, a(x, y))), n++;
            alphaInDialog = n ? m : null;
            const yTop = Math.min(dr.top, cr.bottom);
            for (let y = cr.top + 3; y < yTop - 3; y += 10) for (let x = cr.left + 3; x < cr.right - 3; x += 10) if (a(x, y) > 200) opaqueAbove++;
        }
        portrait = { shown, id: pc.dataset.artId ?? null, rect: shown ? R(pc) : null, px: [pc.width, pc.height], left: cr.left, pe: cs.pointerEvents, transform: cs.transform, aria: pc.getAttribute('aria-hidden'), alphaInDialog, opaqueAbove };
    }
    const f = d.querySelector('canvas.g-face');
    const bg = L.querySelector('.g-council-bg');
    const choiceRects =
        ch && !ch.hidden
            ? [...ch.querySelectorAll('.g-choice')].map((b) => {
                  const r = R(b);
                  if (!r || ch.scrollHeight <= ch.clientHeight + 1) return { id: b.dataset.id, ...r };
                  const c = ch.getBoundingClientRect();
                  const t = Math.max(r.t, c.top);
                  const bt = Math.min(r.b, c.bottom);
                  return { id: b.dataset.id, ...r, t, b: Math.max(t, bt), h: Math.max(0, bt - t), clipped: true };
              })
            : [];
    const tx = d.querySelector('.text');
    return {
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        speaker: d.dataset.speaker,
        name: d.querySelector('.name').textContent,
        text: tx.textContent,
        council: L.classList.contains('council'),
        dialog: R(d),
        nameR: R(d.querySelector('.name')),
        textR: R(tx),
        textFont: getComputedStyle(tx).fontSize,
        count: R(d.querySelector('.count')),
        more: d.querySelector('.more').hidden ? null : R(d.querySelector('.more')),
        choices: vbox(ch),
        choiceRects,
        selected: ch && !ch.hidden ? (ch.querySelector('.g-choice.sel')?.dataset.id ?? null) : null,
        head: headBox,
        map: vbox(L.querySelector('.g-council-map')),
        hud: vbox(document.querySelector('.g-hud'), true),
        menu: vbox(document.querySelector('.g-menu-btn'), true),
        sit: vbox(document.querySelector('.g-sit-btn'), true),
        portrait,
        portraitEls: L.querySelectorAll('canvas.g-portrait').length,
        hasFace: d.classList.contains('has-face'),
        face: f ? { shown: !f.hidden && getComputedStyle(f).display !== 'none', id: f.dataset.artId ?? null, blocked: f.dataset.blocked === '1', compact: f.classList.contains('compact'), rect: R(f) } : null,
        bg: bg ? { hidden: bg.hidden, on: bg.classList.contains('on'), first: L.firstElementChild === bg, base: bg.querySelector('canvas.g-council-bg-base')?.dataset.artId ?? null, px: [bg.querySelector('canvas')?.width, bg.querySelector('canvas')?.height] } : null,
        gArt: L.classList.contains('g-art'),
        bodyArt: document.body.classList.contains('g-council-art'),
    };
}

async function newPage(size, mode) {
    const [wh, dprS] = size.split('@');
    const [w, h] = wh.split('x').map(Number);
    const dpr = Number(dprS || 1);
    const touch = h <= 430 || w <= 480;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
    // 読み込みの記録（performance の resource）は既定で 250 件までしか残らない（開発サーバーは部品が多い）：人物画の読み込みを見られるように広げる
    await ctx.addInitScript(() => performance.setResourceTimingBufferSize(100000));
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    const art = [];
    const state = { reloading: false };
    page.on('pageerror', (e) => {
        if (!state.reloading) errors.push(e.message);
    });
    page.on('console', (m) => {
        if (m.type() === 'error' && !state.reloading && !/GPU stall|GL Driver/.test(m.text())) errors.push(m.text());
    });
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (/^\/(dev-art\/)?art\//.test(p)) art.push(p);
    });
    const q = ['render=manual', mode === 'old' ? 'art=old' : mode === 'v24' ? 'art=v24' : ''].filter(Boolean).join('&');
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, touch, errors, art, state, w, h, dpr };
}

const browser = await launchBrowser();
const report = { base: BASE, sizes: SIZES, modes: MODES, parts: PARTS, manifest: Object.keys(manifest).length, runs: [] };

async function run(part, size, mode) {
    const rec = { part, size, mode, steps: [], lines: [], shots: [] };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${part} ${mode} ${size} ${how}: ${what}`);
    };
    const { ctx, page, touch, errors, art, state, dpr } = await newPage(size, mode);
    const tag = `${part}-${mode}-${size.replace('@', 'at')}`;
    const press = async (loc) => {
        if (touch) await loc.tap();
        else await loc.click();
    };
    const shot = async (name) => {
        await page.evaluate(() => window.__p3?.renderNow?.());
        await sleep(200);
        const file = `${SHOTS}/${tag}-${name}.jpg`;
        await page.screenshot({ path: file, type: 'jpeg', quality: 78, timeout: 600000 });
        rec.shots.push(file);
    };
    // ---- タイトル（AI 生成の明示：素材を使う見せ方だけ）
    const note = await page.evaluate(() => document.querySelector('.g-art-note')?.textContent ?? null);
    check(mode === 'old' ? note === null : note === '一部の人物・背景画像はAI生成画像を加工して使用', `${tag} タイトルの AI 生成の明示（${mode === 'old' ? '無し' : '有り'}）`, note);
    if (part === 'ch2') {
        await page.evaluate(([k, v]) => {
            localStorage.clear();
            localStorage.setItem(k, v);
        }, [KEY, CH2_FIXTURE]);
        step('dev API', 'localStorage に第一章の結末の保存（home_victory_kept）を入れて読み込み直す（直接状態変更。テスト用のブラウザの中だけ）');
        state.reloading = true;
        try {
            await page.reload();
            await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
        } finally {
            state.reloading = false;
        }
        await sleep(450);
        await press(page.locator('.g-btn[data-id="continue:ieyasu1570"]'));
        step('real', 'つづきから');
        await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
        await sleep(500);
        await press(page.locator('.g-btn[data-id="next_chapter"]'));
        step('real', '第二章へ進む');
        for (let k = 0; k < 4; k++) {
            await page.waitForFunction(() => window.__game.ui?.kind === 'record' || document.querySelector('.g-layer[data-kind="cine"]') || (window.__game.screen === 'explore' && !window.__game.ui), null, POLL);
            if (await page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'))) {
                await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
                continue;
            }
            if ((await page.evaluate(() => window.__game.ui?.kind)) === 'record') {
                await sleep(500);
                await press(page.locator('.g-btn[data-id="to_town"]'));
                step('real', '城下へ');
                continue;
            }
            break;
        }
    } else {
        await sleep(450);
        await press(page.locator('.g-btn[data-id="new:ieyasu1570"]'));
        step('real', 'はじめから（歴史分岐）');
        await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
    }
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(600);

    const talkTo = async (id) => {
        const cast = await page.evaluate(() => window.__game.cast);
        const c = cast.find((x) => x.id === id);
        if (!c) throw new Error(`${id} が城下に居ない（${cast.map((x) => x.id).join(',')}）`);
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

    /** この行の人物画が決まるまで待つ（読み込み・重ね変わり 140ms）。人物画の無い見せ方はすぐ */
    const settle = async () => {
        if (mode === 'default') {
            await page
                .waitForFunction(
                    (want) => {
                        const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                        const sp = L?.querySelector('.g-dialog')?.dataset.speaker;
                        const id = want[sp];
                        if (!id) return true;
                        // 読み込みが済んだ（同じ画像の読み込みの記録がある）
                        return performance.getEntriesByType('resource').some((e) => e.name.includes(`/art/portraits/${id.slice(9)}_v2.webp`));
                    },
                    Object.fromEntries(Object.keys(SPEAKER_GENERAL).map((s) => [s, portraitOf(s)])),
                    { timeout: 6000, polling: 100 },
                )
                .catch(() => {});
            await sleep(120);
        }
        // 出入りの重ね変わり（140ms）と、下げた絵を隠すまで（160ms）を待つ
        await sleep(260);
    };

    const readScript = async (label, shotAt = {}, stopAtChoices = true) => {
        const id = (await page.evaluate(() => window.__game.ui?.id)) ?? '?';
        const seen = new Set();
        for (let k = 0; k < 80; k++) {
            await sleep(200);
            const u = await page.evaluate(() => window.__game.ui);
            if (u?.kind !== 'script' || u.id !== id) break;
            await settle();
            const p = await page.evaluate(probe);
            const line = { script: id, index: u.index, count: u.count, choiceIds: u.choices ?? [], ...p };
            rec.lines.push(line);
            verifyLine(line, `${tag} ${id}#${u.index + 1}(${p.speaker})`);
            const sk = `${p.speaker}${u.choices?.length ? '+choices' : ''}`;
            if (shotAt[sk] && !seen.has(sk)) {
                seen.add(sk);
                await shot(`${label}-${shotAt[sk]}`);
            }
            if (u.choices?.length && stopAtChoices) break;
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
    const waitScript = (pred) => page.waitForFunction(new Function('u', `return (${pred})(window.__game.ui)`), null, POLL);

    /** 行の確かめ */
    function verifyLine(p, L) {
        const v21Font = p.vh <= 430 ? 15 : 16;
        check(p.textFont === `${v21Font}px`, `${L} 台詞の字は Version 24 と同じ ${v21Font}px`, p.textFont);
        const want = portraitOf(p.speaker);
        if (mode !== 'default') {
            check(p.portraitEls === 0, `${L} ${mode}：人物画の要素が無い`, p.portraitEls);
            check(!p.bg && !p.gArt && !p.bodyArt, `${L} ${mode}：軍議の背景が無い`, p.bg);
            const fw = mode === 'v24' ? faceOf(p.speaker, 'v24') : null;
            if (mode === 'old') check(!p.hasFace && !p.face, `${L} old：顔の空きも要素も無い`);
            else if (fw) check((p.face?.shown && p.face.id === fw) || p.face?.blocked, `${L} v24：顔は第 1 版の本人の顔 ${fw}（重なる行は出さない）`, p.face);
            else check(!p.face?.shown, `${L} v24：顔の無い話し手は顔を出さない`, p.face);
            return;
        }
        // ---- default
        const pr = p.portrait;
        const shown = pr?.shown ? pr.id : null;
        check(shown === null || shown === want, `${L} 出ている人物画は今の話し手本人の物（${want ?? '無し'}）`, shown);
        if (!want) check(shown === null, `${L} 絵の無い話し手・地の文・高札の行は人物画を出さない（前の人の絵を残さない）`, shown);
        // 決まりどおりの大きさ（同じ計算）
        if (want) {
            const e = manifest[want];
            const left = pr ? pr.left : p.vh <= 430 ? 8 : 24;
            const avoid = [p.choices, p.head, p.map, p.hud, p.menu, p.sit].filter(Boolean).map((b) => ({ left: b.l, top: b.t, right: b.r, bottom: b.b }));
            const dlg = p.dialog ? { left: p.dialog.l, top: p.dialog.t, right: p.dialog.r, bottom: p.dialog.b } : null;
            const exp = portraitLayout({ vw: p.vw, vh: p.vh, left, bottom: p.vh, aspect: e.w / e.h, avoid, maxH: e.h / p.dpr, dialog: dlg, shoulderY: e.meta?.shoulderY });
            recordLayout(L, p, exp);
            if (exp) check(shown === want && Math.abs(pr.rect.h - exp.h) < 0.6 && Math.abs(pr.rect.w - exp.w) < 0.6, `${L} 人物画は決まりどおりの大きさ ${exp.w}×${exp.h}`, { exp, got: pr?.rect, shown });
            else check(shown === null, `${L} 入りきらない画面では人物画を出さない（顔は台詞の枠に出る）`, pr?.rect);
        }
        if (shown) {
            const r = pr.rect;
            const e = manifest[shown];
            for (const [k, b] of [['choices', p.choices], ['head', p.head], ['map', p.map], ['hud', p.hud], ['menu', p.menu], ['sit', p.sit]]) if (b) check(!boxesOverlap(r, b), `${L} 人物画が ${k} と重ならない`, { r, b });
            for (const c of p.choiceRects) check(c.h <= 0 || !boxesOverlap(r, c), `${L} 人物画が選択肢 ${c.id} と重ならない`);
            if (p.face?.shown && p.face.rect) check(!boxesOverlap(r, p.face.rect) || p.face.id !== faceOf(p.speaker, mode), `${L} 人物画と同じ人の顔を並べない`, p.face);
            check(r.h * p.dpr <= e.h + 0.5, `${L} 元の画像を拡大しない（${Math.round(r.h)} × ${p.dpr} ≦ ${e.h}）`, r);
            check(pr.px[1] <= e.h && pr.px[0] <= e.w, `${L} canvas の画素は元の画像以下`, pr.px);
            check(Math.abs(r.b - p.vh) < 1 && r.l >= -0.5 && r.t >= -0.5 && r.r <= p.vw + 0.5, `${L} 下端は画面の下の端・画面の中`, r);
            const sy = e.meta?.shoulderY ?? R.shoulderY;
            if (p.dialog && p.dialog.l < r.r && p.dialog.r > r.l) check(p.dialog.t - r.t >= sy * r.h - 0.6, `${L} 台詞の枠の上に肩まで見える（頭・髷・肩を隠さない）`, { top: r.t, dialogTop: p.dialog.t, need: sy * r.h });
            if (pr.alphaInDialog !== null) check(pr.alphaInDialog === 0, `${L} 台詞の枠の中は人物画を描かない（透明）`, pr.alphaInDialog);
            check(pr.opaqueAbove > 0, `${L} 枠の上に人物画が描かれている`, pr.opaqueAbove);
            check(pr.pe === 'none' && pr.aria === 'true' && (pr.transform === 'none' || !/^matrix\(-/.test(pr.transform)), `${L} 押せない・読み上げない・反転しない`, pr);
            // 同じ人の顔は出さない
            check(!(p.face?.shown && p.face.id === faceOf(p.speaker, mode)), `${L} 人物画の出ている人の台詞の枠の顔は出さない`, p.face);
        } else {
            const fw = faceOf(p.speaker, mode);
            if (fw && p.face && !p.face.blocked) check(p.face.shown && p.face.id === fw, `${L} 人物画が出ない行は、本人の顔 ${fw} を台詞の枠に出す`, p.face);
        }
        if (p.face?.shown) check(p.face.id === faceOf(p.speaker, mode), `${L} 台詞の枠の顔は本人の物`, p.face);
        // 軍議の背景：原寸以内の画面だけ
        if (p.council) {
            const s = councilScale(p.vw, p.vh, p.dpr);
            const fits = s <= 1 + 1e-9;
            rec.councilScale = Math.round(s * 1000) / 1000;
            const showing = !!p.bg && !p.bg.hidden && p.gArt;
            check(showing === fits, `${L} 軍議の背景は原寸以内（倍率 ${s.toFixed(3)}）の画面だけ（${fits ? '出す' : '出さない：Version 24 の軍議の画面'}）`, p.bg);
            if (showing) check(p.bg.first && p.bg.base === 'bg.council', `${L} 背景は層のいちばん奥・昼の軍議所`, p.bg);
        }
    }
    function recordLayout(L, p, exp) {
        rec.layout = rec.layout || [];
        rec.layout.push({ line: L, speaker: p.speaker, exp, got: p.portrait?.rect ? [Math.round(p.portrait.rect.w), Math.round(p.portrait.rect.h)] : null });
    }

    if (part === 'ch1') {
        await talkTo('oda_envoy');
        await readScript('envoy', { oda_envoy: 'envoy-line', hero: 'envoy-ieyasu' });
        await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
        await sleep(400);
        await talkTo('tadakatsu');
        await readScript('gate', { narration: 'gate-narration', tadakatsu: 'gate-tadakatsu', hero: 'gate-ieyasu', 'tadakatsu+choices': 'gate-choice', 'hero+choices': 'gate-choice' });
        await choose('open_council');
        await waitScript((u) => u?.kind === 'script' && u.id === 'council');
        await sleep(600);
        await readScript('council', { narration: 'council-narration', tadakatsu: 'council-tadakatsu', hero: 'council-ieyasu', sakai: 'council-sakai', ishikawa: 'council-ishikawa', 'tadakatsu+choices': 'council-choices-A', 'hero+choices': 'council-choices-A', 'ishikawa+choices': 'council-choices-A', 'sakai+choices': 'council-choices-A' });
        // 方針 A/B/C：PC は ↓ キーで選び替えて撮る（決めない）。タッチはたたくと決まるので並びだけ
        if (!touch) {
            for (const k of ['B', 'C']) {
                await page.keyboard.press('ArrowDown');
                await sleep(300);
                const p = await page.evaluate(probe);
                step('real', `↓ キー（選ばれている選択肢：${p.selected}）`);
                verifyLine(p, `${tag} council choices ${k}(${p.speaker})`);
                await shot(`council-choices-${k}`);
            }
            await page.keyboard.press('ArrowDown');
            step('real', '↓ キー（A に戻る）');
            await sleep(300);
        }
        await choose('policy_oda');
        await waitScript((u) => u?.kind === 'script' && u.id === 'council.confirm.oda');
        await readScript('confirm', { sakai: 'confirm-sakai', ishikawa: 'confirm-ishikawa', tadakatsu: 'confirm-tadakatsu', 'tadakatsu+choices': 'confirm-choices', 'hero+choices': 'confirm-choices', 'sakai+choices': 'confirm-choices' });
        await choose('reconsider');
        await waitScript((u) => u?.kind === 'script' && u.id === 'council.again');
        await readScript('again', { 'tadakatsu+choices': 'again-choices', 'hero+choices': 'again-choices' });
        await choose('policy_oda');
        await waitScript((u) => u?.kind === 'script' && u.id === 'council.confirm.oda');
        await readScript('confirm2', {});
        await choose('confirm_policy');
        await page.waitForFunction(() => window.__game.ui?.kind !== 'script' || window.__game.ui?.id !== 'council.confirm.oda', null, POLL);
        await sleep(600);
        rec.after = await page.evaluate(() => ({ phase: window.__game.state?.phase, policy: window.__game.state?.policy, screen: window.__game.screen, ui: window.__game.ui?.kind ?? null }));
        step('dev API', `決めた後の状態（読むだけ）：${JSON.stringify(rec.after)}`);
    } else {
        const cast = (await page.evaluate(() => window.__game.cast)).map((c) => c.id);
        rec.cast = cast;
        const envoy = cast.find((c) => /envoy|village/.test(c));
        if (envoy) {
            await talkTo(envoy);
            await readScript('ch2-village', { village: 'ch2-village-line', hero: 'ch2-village-ieyasu' });
            await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
            await sleep(400);
        }
        if (cast.includes('ishikawa')) {
            await talkTo('ishikawa');
            await readScript('ch2-ishikawa', { ishikawa: 'ch2-ishikawa-line' });
            await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
            await sleep(400);
        }
        await talkTo('tadakatsu');
        await readScript('ch2-tadakatsu', { tadakatsu: 'ch2-tadakatsu-line', 'tadakatsu+choices': 'ch2-tadakatsu-choice', 'hero+choices': 'ch2-tadakatsu-choice' });
        await choose('open_council');
        await waitScript((u) => u?.kind === 'script' && u.id.startsWith('ch2.council'));
        await sleep(600);
        await readScript('ch2-council', { narration: 'ch2-council-narration', sakai: 'ch2-council-sakai', ishikawa: 'ch2-council-ishikawa', tadakatsu: 'ch2-council-tadakatsu', 'tadakatsu+choices': 'ch2-council-choices', 'ishikawa+choices': 'ch2-council-choices', 'hero+choices': 'ch2-council-choices', 'sakai+choices': 'ch2-council-choices' });
        await choose('plan_commit');
        await waitScript((u) => u?.kind === 'script' && u.id.startsWith('ch2.council.confirm'));
        await readScript('ch2-confirm', { 'tadakatsu+choices': 'ch2-confirm-choices', 'sakai+choices': 'ch2-confirm-choices', 'ishikawa+choices': 'ch2-confirm-choices', 'hero+choices': 'ch2-confirm-choices' });
        await choose('confirm_plan');
        await page.waitForFunction(() => (window.__game.screen === 'explore' && !window.__game.ui) || document.querySelector('.g-layer[data-kind="cine"]'), null, POLL);
        if (await page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'))) await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
        await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
        await sleep(600);
        // 補充（石川）：選択肢を撮って「少し考える」
        await talkTo('ishikawa');
        await readScript('ch2-supply', { ishikawa: 'ch2-supply-line', 'ishikawa+choices': 'ch2-supply-choices' });
        const u = await page.evaluate(() => window.__game.ui);
        if (u?.choices?.includes('recovery_later')) await choose('recovery_later');
        await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
        rec.after = await page.evaluate(() => ({ chapter: window.__game.state?.chapter, phase: window.__game.state?.phase, plan: window.__game.state?.plan ?? null }));
        step('dev API', `状態（読むだけ）：${JSON.stringify(rec.after)}`);
    }
    // 読み込んだ素材
    rec.art = [...new Set(art)];
    const imgs = rec.art.filter((p) => /\.(webp|png|jpe?g)$/.test(p));
    if (mode === 'old') check(imgs.length === 0, `${tag} old：素材の画像を 1 つも読まない`, imgs);
    if (mode === 'v24') check(imgs.every((p) => /^\/art\/faces\/(ieyasu|tadakatsu|sakai|ishikawa|sakakibara|nagamasa)\.webp$/.test(p)), `${tag} v24：読むのは第 1 版の顔だけ（人物画・背景・第 2 版の顔を読まない）`, imgs);
    if (mode === 'default') {
        check(imgs.every((p) => /^\/art\/(portraits\/[a-z]+_v2|faces\/[a-z]+_v2|story\/council_day)\.webp$/.test(p)), `${tag} default：読むのは第 2 版の人物画・顔・軍議の背景だけ（第 1 版の顔・dev-art は読まない）`, imgs);
        const s = rec.councilScale;
        if (s !== undefined) check(imgs.includes('/art/story/council_day.webp') === s <= 1 + 1e-9, `${tag} default：軍議の背景の画像は、原寸以内の画面でだけ読む（倍率 ${s}）`, imgs.filter((p) => p.includes('story')));
        check(!imgs.some((p) => /nobunaga|yoshikage/.test(p)), `${tag} 信長・義景の絵を読まない`);
    }
    rec.errors = errors.filter((e) => !/\[art\]/.test(e));
    check(rec.errors.length === 0, `${tag} ページの誤りが無い`, rec.errors.slice(0, 3));
    await ctx.close();
    return rec;
}

const jobs = [];
for (const part of PARTS) for (const size of part === 'ch2' ? SIZES.filter((s) => CH2_SIZES.includes(s)) : SIZES) for (const mode of MODES) jobs.push({ part, size, mode });
let next = 0;
await Promise.all(
    Array.from({ length: Math.min(PAR, jobs.length) }, async () => {
        while (next < jobs.length) {
            const j = jobs[next++];
            log(`== ${j.part} ${j.mode} ${j.size}`);
            try {
                report.runs.push(await run(j.part, j.size, j.mode));
            } catch (e) {
                check(false, `${j.part} ${j.mode} ${j.size} 走りきる`, String(e?.stack ?? e).slice(0, 600));
            }
        }
    }),
);
await browser.close();

// ---- 見せ方の比べ（同じ部・大きさ）：同じ台本・行・台詞・選択肢。選択肢・台詞の四角・字は old と同じ（人物画・顔で動かない）
const key = (l) => `${l.script}#${l.index}`;
const same = (a, b) => (!a && !b) || (!!a && !!b && ['l', 't', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.6));
for (const part of PARTS)
    for (const size of SIZES) {
        const old = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'old');
        if (!old) continue;
        const A = new Map(old.lines.map((l) => [key(l), l]));
        for (const mode of MODES.filter((m) => m !== 'old')) {
            const b = report.runs.find((r) => r.part === part && r.size === size && r.mode === mode);
            if (!b) continue;
            const seq = (r) => r.lines.map((l) => `${key(l)}|${l.name}|${l.text}|${l.choiceIds.join(',')}`).join('\n');
            check(seq(old) === seq(b), `${part} ${size} ${mode}：old と同じ台本・行・台詞・選択肢を通った（${b.lines.length} 行）`);
            const moved = [];
            for (const l of b.lines) {
                const o = A.get(key(l));
                if (!o) continue;
                if (!same(l.textR, o.textR) || l.textFont !== o.textFont) moved.push({ line: key(l), what: 'text', old: o.textR, now: l.textR });
                if (JSON.stringify(l.choiceRects.map((c) => [c.id, Math.round(c.l), Math.round(c.t), Math.round(c.r), Math.round(c.b)])) !== JSON.stringify(o.choiceRects.map((c) => [c.id, Math.round(c.l), Math.round(c.t), Math.round(c.r), Math.round(c.b)]))) moved.push({ line: key(l), what: 'choices' });
            }
            check(moved.length === 0, `${part} ${size} ${mode}：台詞・選択肢の四角と字は old と同じ（人物画・顔で動かない）`, moved.slice(0, 4));
            if (old.after || b.after) check(JSON.stringify(old.after) === JSON.stringify(b.after), `${part} ${size} ${mode}：決めた後の状態が old と同じ`, { old: old.after, now: b.after });
        }
    }

// ---- 人物画の出た行の数（大きさごと）
const summary = {};
for (const r of report.runs.filter((x) => x.mode === 'default')) {
    const k = `${r.part} ${r.size}`;
    const L = r.layout ?? [];
    summary[k] = { lines: L.length, shown: L.filter((x) => x.got).length, hidden: L.filter((x) => !x.got).length, sizes: [...new Set(L.filter((x) => x.got).map((x) => x.got.join('x')))], councilScale: r.councilScale ?? null };
}
report.summary = summary;
report.checks = checks;
const ng = checks.filter((c) => !c.ok);
report.result = { checks: checks.length, ng: ng.length };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
log(`checks ${checks.length}, NG ${ng.length}`);
for (const [k, v] of Object.entries(summary)) log(`  ${k}: 人物画の行 ${v.shown}/${v.lines}（出さない ${v.hidden}）大きさ ${v.sizes.join(' ')}${v.councilScale !== null ? ` 軍議の背景の倍率 ${v.councilScale}` : ''}`);
for (const c of ng.slice(0, 40)) log('NG', c.what, JSON.stringify(c.detail ?? '').slice(0, 300));
process.exit(ng.length ? 1 : 0);
