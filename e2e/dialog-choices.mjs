/**
 * 会話・軍議の選択肢と台詞の枠の重なり、選択肢の並びの縦の動き（狭い画面）、その入力の守りの確かめ（開発サーバー。?q=low&render=manual）。
 *
 *   BASE=http://localhost:8721 ACT=verify node e2e/dialog-choices.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     SIZES=360x640,360x780,375x667,390x844,412x915,768x1024,844x390,667x375,568x320,640x360,1280x720,1920x1080
 *                     縦長（高さ ＞ 幅）と高さ 430 以下はタッチ（hasTouch・isMobile・端末の比 2）。それ以外はマウスとキー
 *     MODES=default,old   default … 何も付けない、old … ?art=old
 *     PARTS=ch1,ch2       ch1 … 城門の忠勝（軍議を開く）→ 軍議（方針 A/B/C）→ 確かめ（それで決める／考え直す）→ 改めて → 確かめ → 決める →
 *                               約束（3 つ）→ 城門の出陣 → 戦後の忠勝（開発用の setIeyasuPhase。直接状態変更）
 *                         ch2 … 第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/oda_defeat_broken_heavy）を localStorage に入れる（直接状態変更）→
 *                               第二章 → 忠勝 → 軍議（判断）→ 確かめ → 補充（石川）→ 城門の出陣 → 戦後の忠勝（開発用の setIeyasu2Phase。直接状態変更）
 *     ACT=measure|verify  measure … 選択肢の出る場面ごとに四角と隠れを測るだけ（選ぶのは隠れていない選択肢）。Version 23 の比べの元にも使う。
 *                         verify  … measure に加えて、本物の入力で：並びのなぞり（タッチ）・ホイール（マウス）で動かしても選ばれない・
 *                         横へずらした押しでも選ばれない・指を離すまで選ばれない・なぞって見えた最後の選択肢をたたいて選ぶ・↑↓ で選んだ物が並びの中で見える・
 *                         メニュー（タップ／クリック・Esc）と「詳しく見る」を開いて閉じると同じ選択肢に戻る
 *     PAR=3               同時に動かすブラウザの数
 *     ROTATE=390x844,360x640  verify で軍議の方針の場面の窓を横長に変えて戻す大きさ（setViewportSize。開発の操作）
 *
 * 出力：<出力先>/shots/<部>-<見せ方>-<大きさ>-<場面>.png、<出力先>/report.json（場面ごとの四角・隠れ・確かめの一覧）。
 * 入力の記録（report.json の steps）：タイトル・演出のスキップ・話す（E／「話す」のタップ）・行送り（Enter／枠のタップ）・選択肢・メニュー・
 *   詳しく見る・なぞり（CDP の Input.dispatchTouchEvent：指を置く・動かす・離す）・ホイールは本物の入力。
 *   開発用の操作（__game・__p3）：相手の前への teleport・戦後の段階を作る setIeyasuPhase／setIeyasu2Phase（直接状態変更）・
 *   保存の差し込み（ch2 の localStorage。直接状態変更）・3D の手動の描画（renderNow）・読むだけの数え上げ（ui・cast・prompt）。
 *   選択肢の隠れは、ページの中で elementFromPoint を 4px ごとに当てて測る（読むだけ）。measure で並びの中の物を見るときは scrollTop を
 *   ページの中で動かす（dev）。verify では本物のなぞり・ホイールで動かす。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boxesOverlap, launchBrowser, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://localhost:8721';
const OUT = resolve(process.argv[2] || 'e2e-out/dialog-choices');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = list(process.env.SIZES, '360x640,360x780,375x667,390x844,412x915,768x1024,844x390,667x375,568x320,640x360,1280x720,1920x1080');
const MODES = list(process.env.MODES, 'default,old');
const PARTS = list(process.env.PARTS, 'ch1,ch2');
const ACT = process.env.ACT || 'verify';
const PAR = Math.max(1, Number(process.env.PAR || 3));
/** verify：軍議の方針の場面で向きを変えて測り直す大きさ */
const ROTATE = list(process.env.ROTATE, '390x844,360x640');
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const POLL = { timeout: 600000, polling: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const checks = [];
const check = (ok, what, detail) => {
    checks.push({ ok: !!ok, what, detail });
    if (!ok) console.log(`  NG ${what}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`);
};
const KEY = 'koto-sengoku/3d-ieyasu1570';
const CH2_FIXTURE = readFileSync(new URL('../tests/fixtures/ieyasu-ch1-v3/oda_defeat_broken_heavy.json', import.meta.url), 'utf8');

const browser = await launchBrowser();
const report = { base: BASE, act: ACT, sizes: SIZES, modes: MODES, parts: PARTS, runs: [] };

/** 一番上の会話の層：台詞の枠・選択肢（並び・1 つずつ・説明・要点）・上の部品の四角と、選択肢の隠れ（elementFromPoint。読むだけ） */
function probeScene() {
    const R = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { l: +b.left.toFixed(2), t: +b.top.toFixed(2), r: +b.right.toFixed(2), b: +b.bottom.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
    };
    const vis = (e) => (e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? R(e) : null);
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    if (!L) return null;
    const d = L.querySelector('.g-dialog');
    const ch = L.querySelector('.g-choices');
    const text = d.querySelector('.text');
    const label = (t) => {
        if (!t) return 'none';
        for (const [k, s] of [['dialog', '.g-dialog'], ['map', '.g-council-map'], ['menu', '.g-menu-btn'], ['head', '.g-council-head'], ['hud', '.g-hud'], ['choices', '.g-choices']]) if (t.closest(s)) return k;
        return `${t.tagName.toLowerCase()}.${t.className || ''}`;
    };
    // 1 つの四角を 4px ごとに当てて、上に別の物が来ている・画面の外の点を数える（own：その物の中なら見えている）。
    // 角の丸み（border-radius）の外の点は数えない（後ろの物が当たるので）
    const cover = (r, own, el) => {
        let n = 0;
        let hidden = 0;
        const by = {};
        if (!r) return { n, hidden, by };
        const rad = el ? Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2) : 0;
        const inShape = (x, y) => {
            const cx = x < r.left + rad ? r.left + rad : x > r.right - rad ? r.right - rad : x;
            const cy = y < r.top + rad ? r.top + rad : y > r.bottom - rad ? r.bottom - rad : y;
            return Math.hypot(x - cx, y - cy) <= Math.max(0, rad - 1.5);
        };
        for (let y = r.top + 2; y < r.bottom - 1; y += 4)
            for (let x = r.left + 2; x < r.right - 1; x += 4) {
                if (!inShape(x, y)) continue;
                n++;
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
                    hidden++;
                    by.offscreen = (by.offscreen || 0) + 1;
                    continue;
                }
                const t = document.elementFromPoint(x, y);
                if (!t || !own(t)) {
                    hidden++;
                    const k = label(t);
                    by[k] = (by[k] || 0) + 1;
                }
            }
        return { n, hidden, by };
    };
    const choices = ch && !ch.hidden ? [...ch.querySelectorAll('.g-choice')] : [];
    const cs = ch ? getComputedStyle(ch) : null;
    const items = choices.map((b) => {
        const part = (s) => {
            const e = b.querySelector(s);
            return e && getComputedStyle(e).display !== 'none' ? R(e) : null;
        };
        return { id: b.dataset.id, sel: b.classList.contains('sel'), rect: R(b), d: part('.d'), s: part('.s'), cover: cover(b.getBoundingClientRect(), (t) => b.contains(t), b) };
    });
    const tr = text.getBoundingClientRect();
    return {
        vw: innerWidth,
        vh: innerHeight,
        scrollY: window.scrollY,
        vvTop: window.visualViewport ? window.visualViewport.pageTop : 0,
        speaker: d.dataset.speaker,
        name: d.querySelector('.name').textContent,
        text: text.textContent,
        textFont: getComputedStyle(text).fontSize,
        textLh: getComputedStyle(text).lineHeight,
        textScroll: { sh: text.scrollHeight, ch: text.clientHeight, oy: getComputedStyle(text).overflowY },
        dialog: R(d),
        textR: R(text),
        nameR: R(d.querySelector('.name')),
        textCover: cover(tr, (t) => d.contains(t)),
        face: (() => {
            const f = d.querySelector('canvas.g-face');
            return f ? { hidden: f.hidden, blocked: f.dataset.blocked === '1', compact: f.classList.contains('compact'), rect: R(f) } : null;
        })(),
        choices: ch && !ch.hidden ? R(ch) : null,
        choicesBox: ch && !ch.hidden ? { sh: ch.scrollHeight, ch: ch.clientHeight, st: ch.scrollTop, oy: cs.overflowY, ta: cs.touchAction, ob: cs.overscrollBehaviorY, cls: ch.className, style: ch.getAttribute('style') || '', mask: cs.webkitMaskImage || cs.maskImage || '', above: ch.scrollTop > 2, below: ch.scrollTop < ch.scrollHeight - ch.clientHeight - 2, cueAbove: ch.classList.contains('more-above'), cueBelow: ch.classList.contains('more-below'), padT: parseFloat(cs.paddingTop) || 0 } : null,
        items,
        head: R(L.querySelector('.g-council-head')),
        map: R(L.querySelector('.g-council-map')),
        mapCover: cover(L.querySelector('.g-council-map')?.getBoundingClientRect() ?? null, (t) => !!t.closest('.g-council-map'), L.querySelector('.g-council-map')),
        menu: vis(document.querySelector('.g-menu-btn')),
        menuCover: vis(document.querySelector('.g-menu-btn')) ? cover(document.querySelector('.g-menu-btn').getBoundingClientRect(), (t) => !!t.closest('.g-menu-btn'), document.querySelector('.g-menu-btn')) : null,
        hud: vis(document.querySelector('.g-hud')),
        layerHtml: L.outerHTML.replace(/<canvas[^>]*>/g, (m) => m.replace(/ style="[^"]*"/, '')),
    };
}

/** 並びの中の k 番目が見える所（端の薄れ 24px の外）まで、並びの scrollTop をページの中で動かす（measure 用の dev。並びが動かないなら何もしない） */
function devScrollTo(k) {
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    const ch = L?.querySelector('.g-choices');
    const b = ch?.querySelectorAll('.g-choice')[k];
    if (!ch || !b || ch.scrollHeight <= ch.clientHeight + 1) return false;
    const cr = ch.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    if (br.top < cr.top + 24) ch.scrollTop += br.top - cr.top - 24;
    else if (br.bottom > cr.bottom - 24) ch.scrollTop += br.bottom - cr.bottom + 24;
    return true;
}

function sizeOf(size) {
    const [w, h] = size.replace('-mouse', '').split('x').map(Number);
    // -mouse：縦長でもマウスとキー（PC のブラウザの窓を細くした時）
    return { w, h, touch: !size.endsWith('-mouse') && (h <= 430 || h > w) };
}

async function newPage(size, mode, extra = '') {
    const { w, h, touch } = sizeOf(size);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w >= 1900 ? 1 : 2, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    const state = { reloading: false };
    page.on('pageerror', (e) => {
        if (!state.reloading) errors.push(e.message);
    });
    page.on('console', (m) => {
        if (m.type() === 'error' && !state.reloading) errors.push(m.text());
    });
    const q = ['q=low', 'render=manual', mode === 'old' ? 'art=old' : '', extra].filter(Boolean).join('&');
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    await page.evaluate(() => document.fonts.ready);
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    return { ctx, page, touch, errors, w, h, state, cdp };
}

async function run(part, size, mode) {
    const rec = { part, size, mode, steps: [], scenes: [], shots: [] };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${part} ${mode} ${size} ${how}: ${what}`);
    };
    const { ctx, page, touch, errors, state, cdp } = await newPage(size, mode);
    const tag = `${part}-${mode}-${size}`;
    const press = async (loc) => {
        if (touch) await loc.tap();
        else await loc.click();
    };
    const shot = async (name) => {
        await page.evaluate(() => window.__p3?.renderNow?.());
        await sleep(200);
        const file = `${SHOTS}/${tag}-${name}.png`;
        await page.screenshot({ path: file, timeout: 600000 });
        rec.shots.push(file);
    };
    const ui = () => page.evaluate(() => window.__game.ui);
    /** 2 フレーム待つ（並びを動かした後の scroll の出来事が届いてから押す。重い時はフレームが遅れる） */
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
    // ---- 本物の指（CDP のタッチ）：置く → 少しずつ動かす → 離す
    const touchPath = async (pts, holdMs = 16) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
        for (const [x, y] of pts.slice(1)) {
            await sleep(holdMs);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await sleep(holdMs);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
    // 並びの中の押し方の記録（読むだけ：pointercancel の数）
    const watchPointers = () =>
        page.evaluate(() => {
            const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
            const ch = L.querySelector('.g-choices');
            window.__dcLog = { cancel: 0, down: 0, up: 0 };
            for (const t of ['pointercancel', 'pointerdown', 'pointerup']) ch.addEventListener(t, () => window.__dcLog[t.slice(7)]++, { capture: true, passive: true });
        });

    // ---- 遊びの入口
    if (part === 'ch2') {
        await page.evaluate(([k, v]) => {
            localStorage.clear();
            localStorage.setItem(k, v);
        }, [KEY, CH2_FIXTURE]);
        step('dev API', 'localStorage に第一章の結末の保存（oda_defeat_broken_heavy）を入れて読み込み直す（直接状態変更）');
        state.reloading = true;
        try {
            await page.reload();
            await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
        } finally {
            state.reloading = false;
        }
        await sleep(400);
        await press(page.locator('.g-btn[data-id="continue:ieyasu1570"]'));
        step('real', 'つづきから');
        await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
        await sleep(500);
        await press(page.locator('.g-btn[data-id="next_chapter"]'));
        step('real', '第二章へ進む');
    } else {
        await sleep(400);
        await press(page.locator('.g-btn[data-id="new:ieyasu1570"]'));
        step('real', 'はじめから（歴史分岐）');
    }

    /** 演出（スキップ）・結果確認（城下へ）を抜けて、会話か探索になるまで */
    const settle = async () => {
        for (let k = 0; k < 8; k++) {
            await page.waitForFunction(
                () => document.querySelector('.g-layer[data-kind="cine"]') || ['script', 'record', 'ending'].includes(window.__game.ui?.kind) || (window.__game.screen === 'explore' && !window.__game.ui),
                null,
                POLL,
            );
            if (await page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'))) {
                await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
                continue;
            }
            if ((await ui())?.kind === 'record') {
                await sleep(500);
                await press(page.locator('.g-btn[data-id="to_town"]'));
                step('real', '城下へ');
                continue;
            }
            return;
        }
    };
    await settle();

    /** 相手の前へ teleport（dev）→「話す」（E／タップ。本物の入力）→ 選択肢の出る行まで行送り（Enter／枠のタップ） */
    const talkTo = async (id) => {
        await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, { timeout: 60000, polling: 200 }).catch(async (e) => {
            throw new Error(`${id} と話す前に探索に戻らない：ui=${JSON.stringify(await ui())} screen=${await page.evaluate(() => window.__game.screen)}`);
        });
        await sleep(500);
        const cast = await page.evaluate(() => window.__game.cast);
        const c = cast.find((x) => x.id === id);
        if (!c) throw new Error(`${id} が城下に居ない（${cast.map((x) => x.id).join(',')}）`);
        if (id === 'gate') {
            // 城門は場所に入ると出陣の確かめの会話が始まる（「話す」は無い）
            await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x, c.z]);
            step('dev API', '__game.teleport で城門の場所へ（入ると会話が始まる）');
            await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
            return;
        }
        let ok = false;
        for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0], [0, 2.4], [0, -2.4]]) {
            await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x + dx, c.z + dz]);
            ok = await page.waitForFunction((t) => window.__game.prompt === t, id, { timeout: 4000, polling: 100 }).then(() => true, () => false);
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
    const toChoices = async () => {
        for (let k = 0; k < 60; k++) {
            await sleep(300);
            const u = await ui();
            if (u?.kind !== 'script') throw new Error(`会話が閉じた（${JSON.stringify(u)}）`);
            if (u.choices?.length) return u;
            const before = u.index;
            if (touch) await page.locator('.g-layer[data-kind="script"] .g-dialog').last().tap();
            else await page.keyboard.press('Enter');
            await page.waitForFunction((b) => window.__game.ui?.index !== b || window.__game.ui?.choices?.length, before, { timeout: 5000, polling: 50 }).catch(() => {});
        }
        throw new Error('選択肢が出ない');
    };

    /** 動く並びの、端の薄れにかからない所（薄れはその先に選択肢がある側だけ） */
    const zone = (q) => {
        const c = q.choices;
        const pad = q.choicesBox.padT;
        return { t: c.t + pad + (q.choicesBox.above ? 20 : 0), b: c.b - pad - (q.choicesBox.below ? 20 : 0) };
    };
    /** k 番目の選択肢が見える所（端の薄れの外）まで、本物の入力（タッチのなぞり・マウスのホイール）で並びを動かす。返り：動かした後の測り */
    const bring = async (k) => {
        let q = await page.evaluate(probeScene);
        // 指の小さな動きは、ブラウザがなぞりと見なす前の遊び（数 px）に吸われて動かないことがある：動かなかったら次は大きく
        let boost = 0;
        for (let n = 0; n < 14; n++) {
            const r = q.items[k].rect;
            const z = zone(q);
            if (r.t >= z.t - 0.5 && r.b <= z.b + 0.5) break;
            const c = q.choices;
            // 下に隠れていれば上へ動かす（指は上へ・ホイールは下へ）。少し余して一度に動かしすぎない
            const want = r.b > z.b ? r.b - z.b + 8 : -(z.t - r.t + 8);
            // 指の動きは少なくとも 24px（TAP_SLOP_PX 10px 以下の動きは「たたき」で、その下の選択肢を選んでしまう）
            const d = Math.sign(want) * Math.min(Math.max(Math.abs(want) + boost, 24), c.h * 0.6, 160);
            const st0 = q.choicesBox.st;
            if (touch) {
                const x = c.l + c.w / 2;
                const y0 = c.t + c.h / 2 + d / 2;
                await touchPath(line(x, y0, x, y0 - d, 10));
            } else {
                await page.mouse.move(c.l + c.w / 2, c.t + c.h / 2);
                await page.mouse.wheel(0, d);
            }
            await sleep(450);
            q = await page.evaluate(probeScene);
            boost = Math.abs(q.choicesBox.st - st0) < 2 ? boost + 16 : 0;
        }
        return q;
    };

    /** 場面を測る（選択肢の出た行）。返り：測った物 */
    const scene = async (name) => {
        const u = await toChoices();
        step('real', `${name}（${u.id}）の選択肢まで ${touch ? '枠のタップ' : 'Enter'} で進めた`);
        await sleep(450);
        await page.evaluate(() => window.__p3?.renderNow?.());
        const p = await page.evaluate(probeScene);
        const s = { name, script: u.id, choices: u.choices, selected: u.selected, first: p, reach: [] };
        delete s.first.layerHtml;
        s.html = p.layerHtml;
        await shot(name);
        // 並びが動くなら、1 つずつ見える所まで動かして測る（measure は dev の scrollTop。verify は本物のなぞり・ホイール）
        if (p.choicesBox && p.choicesBox.sh > p.choicesBox.ch + 1) {
            for (let k = 0; k < p.items.length; k++) {
                // dev で動かした後、端の薄れの印（scroll の出来事で付け替える）が追いつくまで待つ
                const q = ACT === 'verify' ? await bring(k) : (await page.evaluate(devScrollTo, k), await sleep(250), await page.evaluate(probeScene));
                const it = q.items[k];
                const z = zone(q);
                s.reach.push({ k, id: it.id, rect: it.rect, cover: it.cover, st: q.choicesBox.st, inZone: it.rect.t >= z.t - 0.5 && it.rect.b <= z.b + 0.5, zone: z });
            }
            if (ACT === 'verify') step('real', `${name}：選択肢を 1 つずつ、${touch ? 'なぞって' : 'ホイールで'}並びの見える所（端の薄れの外）へ動かした`);
            // 最初の位置に戻す（measure は dev。verify は本物の入力で一番上へ）
            if (ACT === 'verify') await bring(0);
            else
                await page.evaluate((st) => {
                    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                    L.querySelector('.g-choices').scrollTop = st;
                }, p.choicesBox.st);
        }
        rec.scenes.push(s);
        // ---- 確かめ（四角）
        const T = `${tag} ${name}`;
        const vis = (it, k) => {
            const r = s.reach.find((x) => x.k === k);
            return r ? r.cover : it.cover;
        };
        if (p.choices) check(p.choices.t >= -0.5 && p.choices.b <= p.vh + 0.5 && p.choices.l >= -0.5 && p.choices.r <= p.vw + 0.5, `${T} 選択肢の並びは画面の中`, p.choices);
        for (const r of s.reach) check(r.inZone, `${T} 動く並び：選択肢 ${r.id} を、端の薄れにかからない所まで動かせる`, { rect: r.rect, zone: r.zone });
        check(!(p.choices && boxesOverlap(p.dialog, p.choices)), `${T} 選択肢の並びと台詞の枠が重ならない`, { d: p.dialog, c: p.choices });
        // 動く並びでは、選択肢の見えている所（並びの中に切り取られた所）で比べる
        const clip = (r) => (p.choicesBox && p.choicesBox.sh > p.choicesBox.ch + 1 ? { l: r.l, r: r.r, t: Math.max(r.t, p.choices.t), b: Math.min(r.b, p.choices.b) } : r);
        for (const [k, it] of p.items.entries()) {
            const vr = clip(it.rect);
            check(vr.b <= vr.t || !boxesOverlap(p.dialog, vr), `${T} 選択肢 ${it.id} と台詞の枠が重ならない`, { d: p.dialog, c: vr });
            const cv = vis(it, k);
            check(cv.hidden === 0, `${T} 選択肢 ${it.id} は${s.reach.length ? '並びを動かせば' : ''}すべて見える（隠れ ${cv.hidden}/${cv.n}）`, cv.by);
        }
        check(p.textCover.hidden === 0, `${T} 台詞はすべて見える（隠れ ${p.textCover.hidden}/${p.textCover.n}）`, p.textCover.by);
        check(p.dialog.t >= -0.5 && p.dialog.b <= p.vh + 0.5 && p.dialog.l >= -0.5 && p.dialog.r <= p.vw + 0.5, `${T} 台詞の枠は画面の中`, p.dialog);
        if (p.textScroll.sh > p.textScroll.ch + 1) check(p.textScroll.oy === 'auto' || p.textScroll.oy === 'scroll', `${T} 台詞が枠に入りきらないなら台詞が動かせる`, p.textScroll);
        if (p.map) check(p.mapCover.hidden === 0, `${T} 詳しく見るは隠れない`, p.mapCover.by);
        if (p.menu) check(p.menuCover.hidden === 0, `${T} メニューは隠れない`, p.menuCover.by);
        check(p.scrollY === 0 && p.vvTop === 0, `${T} ページは動いていない`, { y: p.scrollY, vv: p.vvTop });
        if (p.choicesBox && p.choicesBox.sh > p.choicesBox.ch + 1) {
            check(p.choicesBox.oy === 'auto' && p.choicesBox.ta === 'pan-y' && p.choicesBox.ob === 'contain', `${T} 動く並び：overflow auto・pan-y・overscroll contain`, p.choicesBox);
            const sel = p.items.find((x) => x.sel);
            const selCov = sel?.cover;
            check(!!sel && selCov.hidden === 0, `${T} 動く並び：最初から選ばれている選択肢 ${sel?.id} が見える`, selCov);
        }
        const v21 = p.vh <= 430 ? 15 : 16;
        check(p.textFont === `${v21}px`, `${T} 台詞の字は Version 21・23 と同じ ${v21}px`, p.textFont);
        return s;
    };

    const choiceLoc = (id) => page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${id}"]`).last();
    /** 選ぶ（本物の入力）。verify で並びが動くときは、なぞって見せてから、指で真ん中をたたく（Playwright の自動の scroll は使わない） */
    const choose = async (id) => {
        await sleep(450);
        if (ACT === 'verify') {
            const p = await page.evaluate(probeScene);
            const k = p.items.findIndex((x) => x.id === id);
            if (p.choicesBox.sh > p.choicesBox.ch + 1) {
                await bring(k);
                step('real', `${id} が見えるまで並びを${touch ? 'なぞった' : 'ホイールで動かした'}`);
                // 動いた直後の押しは「並びを止める押し」として選ばない（ui/guard.ts SCROLL_SETTLE_MS）ので、少し待つ
                await frames();
                await sleep(300);
            }
            const q = await page.evaluate(probeScene);
            const r = q.items[k].rect;
            const x = r.l + r.w / 2;
            const y = r.t + Math.min(r.h / 2, 18);
            check(q.items[k].cover.hidden === 0, `${tag} ${id} を押す前に、すべて見えている`, q.items[k].cover);
            if (touch) await page.touchscreen.tap(x, y);
            else await page.mouse.click(x, y);
            step('real', `選ぶ ${id}（${touch ? '指でたたく' : 'クリック'}・${Math.round(x)},${Math.round(y)}）`);
            return;
        }
        const p = await page.evaluate(probeScene);
        const k = p.items.findIndex((x) => x.id === id);
        if (p.choicesBox && p.choicesBox.sh > p.choicesBox.ch + 1) {
            // 動く並び（修正版）：Playwright の自動の scroll の直後の押しは「並びを止める押し」になるので、dev で見える所へ動かし、待ってから座標で押す
            await page.evaluate(devScrollTo, k);
            await frames();
            await sleep(400);
            const q = await page.evaluate(probeScene);
            const r = q.items[k].rect;
            if (touch) await page.touchscreen.tap(r.l + r.w / 2, r.t + Math.min(r.h / 2, 18));
            else await page.mouse.click(r.l + r.w / 2, r.t + Math.min(r.h / 2, 18));
            step('real', `選ぶ ${id}（dev で並びを動かしてから ${touch ? 'タップ' : 'クリック'}）`);
            return;
        }
        await press(choiceLoc(id));
        step('real', `選ぶ ${id}（${touch ? 'タップ' : 'クリック'}）`);
    };

    /** verify：並びを動かす本物の入力では選ばれない（タッチのなぞり・横へずらす・押したまま／マウスのホイール）。メニュー・詳しく見る・キー */
    const inputChecks = async (name, { menu = false, map = false, keys = false, rotate = false } = {}) => {
        if (ACT !== 'verify') return;
        const T = `${tag} ${name}`;
        if (rotate && ROTATE.includes(size)) {
            // 向きを変える（縦 → 横 → 縦。窓の大きさを変えるのは開発の操作）：並べ方を測り直し、台詞の枠と重ならない・選んだ物が見える
            const { w, h } = sizeOf(size);
            for (const [vw, vh] of [[h, w], [w, h]]) {
                await page.setViewportSize({ width: vw, height: vh });
                await sleep(700);
                const q = await page.evaluate(probeScene);
                const vr = q.items.map((it) => ({ id: it.id, r: { l: it.rect.l, r: it.rect.r, t: Math.max(it.rect.t, q.choices.t), b: Math.min(it.rect.b, q.choices.b) } }));
                check(!vr.some((x) => x.r.b > x.r.t && boxesOverlap(q.dialog, x.r)), `${T} 向きを ${vw}×${vh} に変えても、選択肢の見えている所と台詞の枠が重ならない`, { d: q.dialog, c: q.choices });
                check(q.choices.t >= -0.5 && q.choices.b <= vh + 0.5, `${T} 向きを ${vw}×${vh} に変えても、並びは画面の中`, q.choices);
                const sel = q.items.find((x) => x.sel);
                check(!!sel && sel.cover.hidden === 0, `${T} 向きを ${vw}×${vh} に変えても、選ばれている ${sel?.id} が見える`, sel?.cover.by);
                await shot(`${name}-rot-${vw}x${vh}`);
            }
            step('dev', `窓の大きさを ${h}×${w} → ${w}×${h} に変えた（向きの変更。setViewportSize）`);
        }
        const u0 = await ui();
        const p0 = await page.evaluate(probeScene);
        const box = p0.choices;
        const scrollable = p0.choicesBox.sh > p0.choicesBox.ch + 1;
        await watchPointers();
        const same = async (what) => {
            const u = await ui();
            check(u?.kind === 'script' && u.id === u0.id && u.index === u0.index && JSON.stringify(u.choices) === JSON.stringify(u0.choices), `${T} ${what}：同じ会話・同じ行・同じ選択肢のまま（選ばれない・進まない）`, { before: u0.id, now: u?.id, kind: u?.kind });
            return u;
        };
        if (touch && scrollable) {
            // 1) 最初の見えている選択肢の上に指を置いて、上へなぞる（並びが動く・選ばれない）
            const first = p0.items.find((x) => x.rect.t >= box.t && x.rect.t < box.b - 20) ?? p0.items[0];
            const sx = first.rect.l + first.rect.w / 2;
            const sy = Math.min(box.b - 12, first.rect.t + first.rect.h / 2);
            await touchPath(line(sx, sy, sx, Math.max(box.t + 4, sy - 140)));
            await sleep(500);
            const p1 = await page.evaluate(probeScene);
            const lg = await page.evaluate(() => window.__dcLog);
            check(p1.choicesBox.st > p0.choicesBox.st + 1 || p0.choicesBox.st >= p0.choicesBox.sh - p0.choicesBox.ch - 1, `${T} 選択肢の上からのなぞりで並びが動いた（scrollTop ${p0.choicesBox.st} → ${p1.choicesBox.st}）`);
            await same('選択肢の上からのなぞり');
            check(p1.items.findIndex((x) => x.sel) === p0.items.findIndex((x) => x.sel), `${T} なぞっても選んだ印は動かない`);
            check(p1.scrollY === 0 && p1.vvTop === 0, `${T} なぞってもページは動かない`, { y: p1.scrollY, vv: p1.vvTop });
            step('real', `選択肢 ${first.id} の上から上へなぞった（scrollTop ${p0.choicesBox.st}→${p1.choicesBox.st}・pointercancel ${lg.cancel}）`);
            // 2) 端を越えてさらになぞる（並びの外＝ページ・3D が動かない）
            await touchPath(line(sx, box.t + box.h * 0.8, sx, box.t + 4));
            await touchPath(line(sx, box.t + box.h * 0.8, sx, box.t + 4));
            await sleep(500);
            const p2 = await page.evaluate(probeScene);
            check(p2.choicesBox.st >= p2.choicesBox.sh - p2.choicesBox.ch - 1, `${T} なぞり続けると並びの最後まで動く`, p2.choicesBox);
            check(p2.scrollY === 0 && p2.vvTop === 0, `${T} 端を越えてなぞってもページは動かない`, { y: p2.scrollY, vv: p2.vvTop });
            await same('端を越えたなぞり');
            await shot(`${name}-scrolled`);
            // 3) 下へなぞって戻す
            await touchPath(line(sx, box.t + 10, sx, box.b - 10));
            await touchPath(line(sx, box.t + 10, sx, box.b - 10));
            await sleep(500);
            const p3 = await page.evaluate(probeScene);
            check(p3.choicesBox.st <= 1, `${T} 下へなぞると並びの最初に戻る`, p3.choicesBox.st);
            await same('下へのなぞり');
        }
        if (touch && scrollable) {
            // 4) 選択肢の上で、指を横へずらして離す（並びは横に動かない。たたきではないので選ばない）
            const p = await page.evaluate(probeScene);
            const it = p.items.find((x) => x.cover.hidden === 0) ?? p.items[0];
            const y = it.rect.t + Math.min(it.rect.h / 2, 18);
            await touchPath(line(it.rect.l + 30, y, it.rect.l + 90, y, 8));
            await sleep(400);
            await same(`選択肢 ${it.id} の上で横へずらして離す`);
            // 5) 選択肢の上で、指を 0.6 秒置いたまま（離すまで決まらない）
            {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: it.rect.l + 40, y }] });
                await sleep(600);
                await same(`選択肢 ${it.id} に指を置いたまま（離す前）`);
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: it.rect.l + 40, y: y + 30 }] });
                await sleep(50);
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await sleep(400);
                await same(`選択肢 ${it.id} に置いた指を 30px 動かして離す`);
            }
            step('real', `選択肢 ${it.id} の上で横へずらす・置いたまま動かして離す（どれも選ばれない）`);
        } else if (scrollable) {
            await page.mouse.move(box.l + box.w / 2, box.t + box.h / 2);
            await page.mouse.wheel(0, 200);
            await sleep(400);
            const p1 = await page.evaluate(probeScene);
            check(p1.choicesBox.st > p0.choicesBox.st, `${T} ホイールで並びが動く`);
            check(p1.scrollY === 0, `${T} ホイールでページは動かない`);
            await same('ホイール');
            await page.mouse.wheel(0, -400);
            await sleep(300);
        }
        if (keys) {
            // ↑↓：選んだ物が並びの中で見える
            const order = ['ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowUp'];
            for (const k of order) {
                await page.keyboard.press(k);
                await sleep(250);
                const p = await page.evaluate(probeScene);
                const s = p.items.find((x) => x.sel);
                check(!!s && s.cover.hidden === 0, `${T} ${k} で選んだ ${s?.id} が見える（隠れ ${s?.cover.hidden}）`, s?.cover.by);
            }
            await same('↑↓');
            step('real', `↑↓ で選び直した（${order.join(' ')}）`);
        }
        if (menu) {
            const mb = page.locator('.g-menu-btn');
            const before = await page.evaluate(probeScene);
            if (touch) await mb.tap();
            else await mb.click();
            await page.waitForFunction(() => window.__game.ui?.kind === 'menu', null, { timeout: 10000, polling: 100 }).then(() => check(true, `${T} メニューのボタンで開く`), () => check(false, `${T} メニューのボタンで開く`));
            await shot(`${name}-menu`);
            await sleep(450);
            await press(page.locator('.g-layer[data-kind="menu"] .g-btn[data-id="close"]'));
            await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
            await sleep(450);
            await same('メニューを開いて閉じた');
            const after = await page.evaluate(probeScene);
            check(JSON.stringify(after.items.map((x) => [x.id, x.sel])) === JSON.stringify(before.items.map((x) => [x.id, x.sel])), `${T} メニューの後も同じ選び方`);
            // Esc でも
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => window.__game.ui?.kind === 'menu', null, { timeout: 10000, polling: 100 }).then(() => check(true, `${T} Esc でメニュー`), () => check(false, `${T} Esc でメニュー`));
            await sleep(450);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
            await sleep(450);
            await same('Esc でメニューを開いて閉じた');
            step('real', `メニュー（${touch ? 'タップ' : 'クリック'}→閉じる、Esc→Esc）`);
        }
        if (map) {
            const mb = page.locator('.g-layer[data-kind="script"] .g-council-map');
            if (touch) await mb.tap();
            else await mb.click();
            await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, { timeout: 10000, polling: 100 }).then(() => check(true, `${T} 詳しく見るで情勢が開く`), () => check(false, `${T} 詳しく見るで情勢が開く`));
            await sleep(500);
            await shot(`${name}-situation`);
            await press(page.locator('.g-btn[data-id="close"]').last());
            await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
            await sleep(450);
            await same('詳しく見るを開いて閉じた');
            step('real', `詳しく見る（${touch ? 'タップ' : 'クリック'}）→ 閉じる`);
        }
        if (scrollable) {
            // 選択肢を押したまま、上に画面を開いて（Esc・J・別の指でメニュー）から離す：離した時に決める押しが、開いた画面の下で決まらない
            // （Version 24 の見直しで見つかった誤り。離すのは押したボタンに届くので、会話が一番上でない間は決めない）
            const p = await page.evaluate(probeScene);
            const it = p.items.find((x) => x.cover.hidden === 0) ?? p.items[0];
            const x = it.rect.l + Math.min(40, it.rect.w / 2);
            const y = it.rect.t + Math.min(it.rect.h / 2, 18);
            const variants = [['Esc', 'menu']];
            if (map) variants.push(['J', 'situation']);
            if (touch) variants.push(['別の指でメニュー', 'menu']);
            for (const [how, kind] of variants) {
                await sleep(450);
                if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
                else {
                    await page.mouse.move(x, y);
                    await page.mouse.down();
                }
                await sleep(200);
                if (how === 'Esc') await page.keyboard.press('Escape');
                else if (how === 'J') await page.keyboard.press('KeyJ');
                else {
                    const mb = await page.evaluate(() => {
                        const b = document.querySelector('.g-menu-btn').getBoundingClientRect();
                        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
                    });
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }, { x: mb.x, y: mb.y, id: 1 }] });
                    await sleep(80);
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id: 0 }] });
                }
                const opened = await page.waitForFunction((k) => window.__game.ui?.kind === k, kind, { timeout: 10000, polling: 100 }).then(() => true, () => false);
                check(opened, `${T} 選択肢 ${it.id} を押したまま${how}で ${kind} が開く`);
                await sleep(300);
                if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                else await page.mouse.up();
                await sleep(600);
                const u = await ui();
                check(u?.kind === kind, `${T} 選択肢 ${it.id} を押したまま${how}で ${kind} を開いて離しても、${kind} が一番上のまま（選ばれない）`, u);
                const extra = await page.evaluate(() => document.querySelectorAll('.g-layer[data-kind="script"]').length);
                check(extra === 1, `${T} ${how}：開いた画面の下で次の会話が始まっていない（会話の層 ${extra}）`);
                // 選ばれてしまったら、この先の流れ（同じ会話に戻る）は待っても来ないので、ここで止める
                if (u?.kind !== kind) throw new Error(`${T} 選択肢を押したまま${how}で開いた画面の下で選ばれた（${JSON.stringify(u)?.slice(0, 200)}）`);
                if (kind === 'menu') await page.keyboard.press('Escape');
                else await press(page.locator('.g-btn[data-id="close"]').last());
                await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
                await sleep(450);
                await same(`選択肢 ${it.id} を押したまま${how}で ${kind} を開いて離し、閉じた`);
            }
            step('real', `選択肢 ${it.id} を${touch ? '指で' : 'マウスで'}押したまま ${variants.map((v) => v[0]).join('・')} で上に画面を開いて離した（どれも選ばれない）`);
        }
        const lg = await page.evaluate(() => window.__dcLog);
        rec.pointerLog = rec.pointerLog ?? [];
        rec.pointerLog.push({ name, ...lg });
    };

    if (part === 'ch1') {
        await talkTo('tadakatsu');
        await scene('gate');
        await inputChecks('gate', { menu: true });
        await choose('open_council');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council', null, POLL);
        await scene('council');
        await inputChecks('council', { map: true, keys: true, rotate: true });
        // verify は最後の選択肢 C（自領を守る）を、measure は隠れない A を選ぶ
        const pick1 = ACT === 'verify' ? 'policy_home' : 'policy_oda';
        await choose(pick1);
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id.startsWith('council.confirm.'), null, POLL);
        await scene('confirm');
        await inputChecks('confirm', { menu: true });
        await choose('reconsider');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council.again', null, POLL);
        await scene('again');
        // キーで B（浅井）を選ぶ：↓ → Enter
        await sleep(400);
        await page.keyboard.press('ArrowDown');
        await sleep(200);
        await page.keyboard.press('Enter');
        step('real', '↓ → Enter で B（policy_asai）');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council.confirm.asai', null, POLL);
        await scene('confirm2');
        await choose('confirm_policy');
        await settle();
        await talkTo('asai_envoy');
        await scene('pledge');
        await inputChecks('pledge', { keys: true });
        await choose('pledge_accept');
        await settle();
        await talkTo('gate');
        await scene('depart');
        await choose('stay');
        await settle();
        await page.evaluate(() => window.__game.setIeyasuPhase('aftermath', 'asai', 'victory', { pledge: 'accept', pledgeResult: 'kept' }));
        step('dev API', "__game.setIeyasuPhase('aftermath','asai','victory')（直接状態変更）");
        await settle();
        await talkTo('tadakatsu');
        await scene('aftermath');
        await choose('not_yet');
    } else {
        await talkTo('tadakatsu');
        await scene('ch2-gate');
        await choose('open_council');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id.startsWith('ch2.council'), null, POLL);
        const c = await scene('ch2-council');
        await inputChecks('ch2-council', { map: true, keys: true });
        await choose(ACT === 'verify' ? c.choices[c.choices.length - 1] : c.choices[0]);
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id.startsWith('ch2.council.confirm'), null, POLL);
        await scene('ch2-confirm');
        await choose('confirm_plan');
        await settle();
        await talkTo('ishikawa');
        const r = await scene('ch2-recovery');
        await inputChecks('ch2-recovery', { keys: true, menu: true });
        await choose(ACT === 'verify' ? r.choices[0] : r.choices[r.choices.length - 1]);
        await settle();
        if (ACT === 'verify') {
            await talkTo('gate');
            await scene('ch2-depart');
            await choose('stay');
            await settle();
        }
        await page.evaluate(() => window.__game.setIeyasu2Phase('aftermath', 'oda', { ch1Result: 'defeat', ch1Pledge: 'broken', heavy: true }));
        step('dev API', "__game.setIeyasu2Phase('aftermath','oda',{defeat,broken,heavy})（直接状態変更）");
        await settle();
        await talkTo('tadakatsu');
        await scene('ch2-aftermath');
        await choose('not_yet');
    }
    rec.errors = errors.filter((e) => !/\[art\]/.test(e));
    check(rec.errors.length === 0, `${tag} ページの誤りが無い`, rec.errors.slice(0, 3));
    await ctx.close();
    return rec;
}

const jobs = [];
for (const part of PARTS) for (const size of SIZES) for (const mode of MODES) jobs.push({ part, size, mode });
let next = 0;
async function worker() {
    while (next < jobs.length) {
        const { part, size, mode } = jobs[next++];
        log(`== ${part} ${mode} ${size}`);
        try {
            report.runs.push(await run(part, size, mode));
        } catch (e) {
            check(false, `${part} ${mode} ${size} 走りきる`, String(e?.stack ?? e).slice(0, 600));
        }
    }
}
await Promise.all(Array.from({ length: PAR }, worker));

report.checks = checks;
const ng = checks.filter((c) => !c.ok);
report.summary = { checks: checks.length, ng: ng.length };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
log(`checks ${checks.length}, NG ${ng.length}`);
await browser.close();
process.exit(ng.length ? 1 : 0);
