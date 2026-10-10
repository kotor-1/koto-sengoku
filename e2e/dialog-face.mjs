/**
 * 台詞の枠の顔（Version 22・23。ui/artCanvas.ts の DialogFace）の確かめ（開発サーバー。本物の顔の素材 manifest.gen.json。?artFixture は使わない）。
 *
 *   BASE=http://localhost:8681 node e2e/dialog-face.mjs [出力先]
 *   変えられるもの（環境変数。カンマ区切り）：
 *     SIZES=1280x720,1920x1080,844x390,844x390-notch,667x375,568x320,390x844,768x1024
 *                              高さ 430 以下・幅 480 以下はスマホ（タッチ・isMobile・端末の比 2）。-notch は左右 47px・下 21px の安全域
 *     MODES=default,old        default … 何も付けない（顔あり。Version 25 から人物画も出る：人物画の出ている行は、その人の顔を出さない）、
 *                              v24 … ?art=v24（Version 24 の見た目：第 1 版の顔だけ。人物画・軍議の背景は無し）、old … ?art=old（Version 21 の見た目）、
 *                              fail … 何も付けないが、素材の画像（art/ の下：顔・人物画・背景）の読み込みをすべて失敗させる（台詞の枠は Version 21 のまま・文字と操作が残る）、
 *                              failportrait … 何も付けないが、人物画（art/portraits/）だけ読めない（人物画は出ず、話し手の顔が台詞の枠に出る。Version 25）、
 *                              failface … 何も付けないが、顔（art/faces/）だけ読めない（人物画は出る。台詞の枠は Version 21 のまま。Version 25）
 *     PARTS=ch1,ch2,fictional  ch1 … 織田の使者 → 城門の忠勝 → 軍議（方針 → 確かめ → 考え直す → 選び直し）、
 *                              ch2 … 第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/oda_defeat_broken_heavy：家康・忠勝が負傷）→ 第二章 → 忠勝 → 軍議、
 *                              fictional … 架空の章（主人公 hero は宗真：顔を付けない）
 *     WALK=1280x720            この大きさだけ、最初に町の入口から忠勝の前まで本物の入力（W キー）で歩いて話し、「まだ」を選ぶ
 *                              （その後の使者・忠勝の前へは開発用の teleport。ほかの大きさは最初から teleport）
 *
 * 出力：<出力先>/shots/<部>-<見せ方>-<大きさ>-<場面>.png、<出力先>/report.json（行ごとの枠・名前・台詞・顔・選択肢の四角、確かめの一覧、DOM の写し）。
 * 入力の記録：タイトルのボタン・演出のスキップ・話す（E／「話す」のタップ）・会話を進める（Enter／枠のタップ）・選択肢（クリック／タップ）は本物の入力。
 *   開発用の操作（__game・__p3）：相手の前への teleport（WALK の大きさ以外）・保存の差し込み（ch2 の localStorage）・3D の手動の描画（render=manual の renderNow）・
 *   読むだけの数え上げ（ui・cast・prompt）。
 * 確かめ：顔は今の話し手（家康・忠勝・酒井・石川）だけ（v24 は第 1 版の顔）・その人の人物画が出ている行は顔を出さない（default）・
 *   使者／地の文／高札は空き・空きは台本の間ずっと同じ（名前・台詞の始まりが動かない）・
 *   顔が名前・台詞・行の数・▼・選択肢・軍議の見出し・詳しく見る・目的の札・メニューと重ならない・画面の中・押せない・読み上げない・
 *   canvas は端末の比 2 まで・old と架空の章は has-face も g-face も無い・タイトルの AI 生成の明示は default だけ。
 *   顔の置き方（ui.css。Version 23）：PC（高さ 431 以上・幅 968 以上）は枠の左の中で上下の真ん中（72px）。それより狭い・低い画面は
 *   枠の左上の角（左端は台詞の始まり、下端は台詞の 1 行目の上、上へはみ出す。名前は顔の右）：タブレットの縦 52px・スマホ横 44px・
 *   スマホの縦（幅 540 まで）と幅 640 までのスマホ横 36px。重なる行（選択肢の出ている行だけのはず）は、名前の行の高さに縮めて枠の中に
 *   収め（class "compact"：スマホ横 25px・それ以外 28px）、それでも重なれば出さない（data-blocked）。
 *   old と default の同じ行：台詞の字の大きさ・字の間・台詞の四角（位置・幅・高さ）・枠の高さが同じ（顔のために字を小さくしない）。
 *   枠が選択肢と重なる行は、old でも重なる行だけ（Version 21 からある重なり）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boxesOverlap, launchBrowser, skipCinematic } from './lib.mjs';

const BASE = process.env.BASE || 'http://localhost:8681';
const OUT = resolve(process.argv[2] || 'e2e-out/dialog-face');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const SIZES = list(process.env.SIZES, '1280x720,1920x1080,844x390,844x390-notch,667x375,568x320,390x844,768x1024');
const MODES = list(process.env.MODES, 'default,old');
const PARTS = list(process.env.PARTS, 'ch1,ch2,fictional');
const WALK = process.env.WALK || '1280x720';
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const POLL = { timeout: 600000, polling: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const checks = [];
const check = (ok, what, detail) => {
    checks.push({ ok: !!ok, what, detail });
    if (!ok) console.log(`  NG ${what}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};
const FACE_OF = { hero: 'face.ieyasu', tadakatsu: 'face.tadakatsu', sakai: 'face.sakai', ishikawa: 'face.ishikawa' };
/** Version 24 の見せ方（?art=v24）の顔（第 1 版） */
const FACE_OF_V24 = Object.fromEntries(Object.entries(FACE_OF).map(([k, v]) => [k, v.replace('face.', 'face.pack1.')]));
/** 話し手の人物画（default だけ。Version 25） */
const PORTRAIT_OF = Object.fromEntries(Object.entries(FACE_OF).map(([k, v]) => [k, v.replace('face.', 'portrait.')]));
const KEY = 'koto-sengoku/3d-ieyasu1570';
const CH2_FIXTURE = readFileSync(new URL('../tests/fixtures/ieyasu-ch1-v3/oda_defeat_broken_heavy.json', import.meta.url), 'utf8');

const browser = await launchBrowser();
const report = { base: BASE, sizes: SIZES, modes: MODES, parts: PARTS, runs: [] };

/** 一番上の会話の層の、台詞の枠と顔と選択肢の四角（読むだけ） */
function probeDialog() {
    const R = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return null;
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const vis = (e) => (e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? R(e) : null);
    // 重なりで出さなかった顔（data-blocked）が出ていたらの四角：同じ CSS の canvas を枠の先頭に一瞬置いて測り、すぐ外す（描かない）
    const wouldRect = (d) => {
        const t = document.createElement('canvas');
        t.className = 'g-face';
        d.insertBefore(t, d.firstChild);
        const r = R(t);
        t.remove();
        return r;
    };
    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
    if (!L) return null;
    const d = L.querySelector('.g-dialog');
    const f = d.querySelector('canvas.g-face');
    const cs = f ? getComputedStyle(f) : null;
    const ch = L.querySelector('.g-choices');
    return {
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        speaker: d.dataset.speaker,
        name: d.querySelector('.name').textContent,
        text: d.querySelector('.text').textContent,
        hasFace: d.classList.contains('has-face'),
        faceEls: d.querySelectorAll('.g-face').length,
        face: f
            ? { hidden: f.hidden, blocked: f.dataset.blocked === '1', compact: f.classList.contains('compact'), id: f.dataset.artId, rect: R(f), would: f.dataset.blocked === '1' || f.classList.contains('compact') ? wouldRect(d) : null, px: [f.width, f.height], first: d.firstElementChild === f, aria: f.getAttribute('aria-hidden'), pe: cs.pointerEvents, draggable: f.draggable, transform: cs.transform, radius: cs.borderRadius, shadow: cs.boxShadow }
            : null,
        dialog: R(d),
        nameR: R(d.querySelector('.name')),
        textR: R(d.querySelector('.text')),
        textFont: getComputedStyle(d.querySelector('.text')).fontSize,
        textLs: getComputedStyle(d.querySelector('.text')).letterSpacing,
        textLh: getComputedStyle(d.querySelector('.text')).lineHeight,
        count: R(d.querySelector('.count')),
        more: d.querySelector('.more').hidden ? null : R(d.querySelector('.more')),
        choices: ch && !ch.hidden ? R(ch) : null,
        // 選択肢の四角。並びが縦に動く（Version 24。狭い画面で入りきらない）時は、並びの見える所に切り取った四角（見えない所は重なりにならない）
        choiceRects:
            ch && !ch.hidden
                ? [...ch.querySelectorAll('.g-choice')].map((b) => {
                      const r = R(b);
                      if (!r || ch.scrollHeight <= ch.clientHeight + 1) return { id: b.dataset.id, ...r };
                      const c = ch.getBoundingClientRect();
                      const t = Math.max(r.t, c.top);
                      const bt = Math.min(r.b, c.bottom);
                      return { id: b.dataset.id, ...r, t, b: Math.max(t, bt), h: Math.max(0, bt - t), clipped: true };
                  })
                : [],
        head: R(L.querySelector('.g-council-head')),
        map: R(L.querySelector('.g-council-map')),
        hud: vis(document.querySelector('.g-hud')),
        menu: vis(document.querySelector('.g-menu-btn')),
        portrait: !!L.querySelector('canvas.g-portrait'),
        // 出ている人物画（Version 25。薄くなりかけ・隠した物は数えない）
        portraitShown: (() => {
            const pc = L.querySelector('canvas.g-portrait');
            return pc && !pc.hidden && pc.classList.contains('on') ? pc.dataset.artId : null;
        })(),
        artNote: !!document.querySelector('.g-art-note'),
        layerHtml: L.outerHTML.replace(/<canvas[^>]*>/g, (m) => m.replace(/ style="[^"]*"/, '')),
    };
}

async function newPage(size, mode, extra = '') {
    const [w, h] = size.replace('-notch', '').split('x').map(Number);
    const touch = h <= 430 || w <= 480;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w >= 1900 ? 1 : 2, hasTouch: touch, isMobile: touch });
    // 顔の画像の読み込みの失敗（fail）：ネットワークで切る（registry の fetch が失敗する）
    // 置き場の /art/ で始まる物だけ（開発サーバーの部品 /src/art/*.ts・manifest.gen.json は止めない）
    if (mode === 'fail') await ctx.route((u) => u.pathname.startsWith('/art/'), (r) => r.abort('failed'));
    // 片方だけ読めない（Version 25）：人物画だけ・顔だけ
    if (mode === 'failportrait') await ctx.route((u) => u.pathname.startsWith('/art/portraits/'), (r) => r.abort('failed'));
    if (mode === 'failface') await ctx.route((u) => u.pathname.startsWith('/art/faces/'), (r) => r.abort('failed'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    // 読み込み直しの間に、前のページの読み込み途中の物（人物の素材・模様）が切られて出る誤りは数えない（e2e/ieyasu-ch2.mjs と同じ）
    const state = { reloading: false };
    page.on('pageerror', (e) => {
        if (!state.reloading) errors.push(e.message);
    });
    page.on('console', (m) => {
        if (m.type() === 'error' && !state.reloading) errors.push(m.text());
    });
    const q = ['render=manual', mode === 'old' ? 'art=old' : mode === 'v24' ? 'art=v24' : '', extra].filter(Boolean).join('&');
    await page.goto(`${BASE}/?${q}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    if (size.endsWith('-notch')) await page.addStyleTag({ content: ':root{--safe-l:47px;--safe-r:47px;--safe-b:21px;}' });
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, touch, errors, w, h, state };
}

async function run(part, size, mode) {
    const rec = { part, size, mode, steps: [], lines: [], shots: [], titleNote: null };
    const step = (how, what) => {
        rec.steps.push({ how, what });
        log(`  ${part} ${mode} ${size} ${how}: ${what}`);
    };
    const { ctx, page, touch, errors, state } = await newPage(size, mode);
    const tag = `${part}-${mode}-${size}`;
    const press = async (loc) => {
        if (touch) await loc.tap();
        else await loc.click();
    };
    const shot = async (name) => {
        await page.evaluate(() => window.__p3?.renderNow?.());
        await sleep(250);
        const file = `${SHOTS}/${tag}-${name}.png`;
        await page.screenshot({ path: file, timeout: 600000 });
        rec.shots.push(file);
    };
    // ---- タイトル（AI 生成の明示）
    const note = await page.evaluate(() => {
        const n = document.querySelector('.g-art-note');
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return { text: n.textContent, top: b.top, bottom: b.bottom, vh: innerHeight };
    });
    rec.titleNote = note;
    if (mode === 'old') check(note === null, `${tag} タイトル：旧表示では AI 生成の明示を出さない`);
    else {
        check(note?.text === '一部の人物・背景画像はAI生成画像を加工して使用', `${tag} タイトル：AI 生成の明示`, note);
        check(note && note.top >= 0 && note.bottom <= note.vh, `${tag} タイトル：AI 生成の明示は動かさずに見える所（最初の画面）`, note);
    }
    if (part === 'ch1') await shot('title');

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
        if (size.endsWith('-notch')) await page.addStyleTag({ content: ':root{--safe-l:47px;--safe-r:47px;--safe-b:21px;}' });
        await sleep(400);
        await press(page.locator('.g-btn[data-id="continue:ieyasu1570"]'));
        step('real', 'つづきから');
        await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
        await sleep(500);
        await press(page.locator('.g-btn[data-id="next_chapter"]'));
        step('real', '第二章へ進む');
        for (let k = 0; k < 3; k++) {
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
        const id = part === 'fictional' ? 'new:fictional' : 'new:ieyasu1570';
        await sleep(400);
        await press(page.locator(`.g-btn[data-id="${id}"]`));
        step('real', `はじめから（${part}）`);
        // 歴史分岐は章の冒頭の演出がある（スキップ）。架空の章には演出が無い
        await page.waitForFunction(() => !!document.querySelector('.g-layer[data-kind="cine"]') || (window.__game.screen === 'explore' && !window.__game.ui), null, POLL);
        if (await page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'))) await skipCinematic(page, { tap: touch, log: (t) => step('real', t) });
    }
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(600);
    const cast = await page.evaluate(() => window.__game.cast);

    /** 相手の前へ（teleport か、本物の入力で歩く）→「話す」（E／タップ） */
    const talkTo = async (id, walk = false) => {
        const c = cast.find((x) => x.id === id);
        if (!c) throw new Error(`${id} が城下に居ない`);
        if (walk) {
            await page.keyboard.down('KeyW');
            await page.waitForFunction((t) => window.__game.prompt === t, id, POLL);
            await page.keyboard.up('KeyW');
            step('real', `${id} の前まで W キーで歩いた（本物の入力）`);
        } else {
            let ok = false;
            for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0]]) {
                await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x + dx, c.z + dz]);
                ok = await page.waitForFunction((t) => window.__game.prompt === t, id, { timeout: 4000, polling: 100 }).then(() => true, () => false);
                if (ok) break;
            }
            if (!ok) throw new Error(`${id} の「話す」が出ない`);
            step('dev API', `__game.teleport で ${id} の前へ`);
        }
        await sleep(450);
        if (touch) await page.locator('.g-talk').tap();
        else await page.keyboard.press('KeyE');
        step('real', `話す（${touch ? '「話す」をタップ' : 'E キー'}）`);
        await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
    };

    /** 今の台本を最後まで（または選択肢まで）進め、行ごとに測る。shotAt：撮る場面（話し手 → 名前） */
    const readScript = async (label, shotAt = {}) => {
        const id = (await page.evaluate(() => window.__game.ui?.id)) ?? '?';
        const seen = [];
        let gutter = null;
        let textLeft = null;
        for (let k = 0; k < 60; k++) {
            await sleep(380);
            const u = await page.evaluate(() => window.__game.ui);
            if (u?.kind !== 'script' || u.id !== id) break;
            // 顔・人物画の読み込み（非同期）を待つ（最大 3 秒。出ないのは記録に残る）。人物画が出た行は顔を出さない（Version 25）
            if (['default', 'v24', 'failportrait', 'failface'].includes(mode) && FACE_OF[await page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="script"] .g-dialog')].pop()?.dataset.speaker)] && part !== 'fictional') {
                await page.waitForFunction(() => {
                    const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
                    const f = L?.querySelector('.g-dialog canvas.g-face');
                    const pc = L?.querySelector('canvas.g-portrait');
                    return (f && (!f.hidden || f.dataset.blocked === '1')) || (pc && !pc.hidden && pc.classList.contains('on'));
                }, null, { timeout: 3000, polling: 100 }).catch(() => {});
                // 人物画の出入り（重ね変わり 140ms）・顔の出し直しが済むまで
                await sleep(260);
            }
            const p = await page.evaluate(probeDialog);
            // choices は probeDialog の並びの四角で上書きされるので、選択肢の id は choiceIds に残す（下の「同じ台本・行・台詞・選択肢」の比べ）
            const line = { script: id, index: u.index, count: u.count, choices: u.choices, ...p, choiceIds: u.choices };
            delete line.layerHtml;
            line.html = p.layerHtml;
            rec.lines.push(line);
            const L = `${tag} ${id}#${u.index + 1}(${p.speaker})`;
            // ---- 確かめ
            // 人物画（default）が出ている行は、その人の顔を出さない（同じ人を 2 つ並べない）
            // failportrait（人物画が読めない）は顔が出る。failface（顔が読めない）は人物画だけ出て、顔は出ない
            const withPortrait = mode === 'default' || mode === 'failface';
            const portraitUp = withPortrait && !!p.portraitShown && p.portraitShown === PORTRAIT_OF[p.speaker];
            const wantFace = part === 'fictional' || portraitUp ? null : mode === 'default' || mode === 'failportrait' ? (FACE_OF[p.speaker] ?? null) : mode === 'v24' ? (FACE_OF_V24[p.speaker] ?? null) : null;
            if (withPortrait) check(!p.portraitShown || p.portraitShown === PORTRAIT_OF[p.speaker], `${L} 人物画は今の話し手本人の物だけ`, p.portraitShown);
            if (!withPortrait) check(!p.portrait, `${L} ${mode}：人物画の要素が無い`);
            // 台詞の字は Version 21 のまま（高さ 430 以下 15px・それ以外 16px、字の間 0.03em）。顔のある枠でも小さくしない
            const v21Font = p.vh <= 430 ? 15 : 16;
            check(p.textFont === `${v21Font}px` && Math.abs(parseFloat(p.textLs) - v21Font * 0.03) < 0.01, `${L} 台詞の字は Version 21 と同じ（${v21Font}px・字の間 0.03em）`, { font: p.textFont, ls: p.textLs });
            if (mode === 'old' || mode === 'fail' || mode === 'failface' || part === 'fictional') {
                check(!p.hasFace && p.faceEls === 0, `${L} 顔の空きも要素も無い（Version 21 と同じ枠）`, { hasFace: p.hasFace, n: p.faceEls });
            } else {
                check(p.hasFace && p.faceEls === 1, `${L} 顔の空き（has-face）と canvas.g-face が 1 つ`, { hasFace: p.hasFace, n: p.faceEls });
                if (gutter === null) gutter = p.hasFace;
                check(gutter === p.hasFace, `${L} 空きは台本の間ずっと同じ`);
                const shown = p.face && !p.face.hidden ? p.face.id : null;
                const blocked = !!p.face?.blocked;
                check(shown === (blocked ? null : wantFace), `${L} 顔は今の話し手の物（無い人は空きだけ）`, { want: wantFace, shown, blocked });
                // ui.css：PC（高さ 431 以上・幅 968 以上）72px は枠の左の中。それ以外は枠の左上の角：タブレットの縦 52・スマホ横 44・
                // スマホの縦（幅 540 まで）と幅 640 までのスマホ横 36
                const pc = p.vh > 430 && p.vw >= 968;
                const compact = !!p.face?.compact && !p.face.hidden;
                const want = pc ? 72 : compact ? (p.vh <= 430 ? 25 : 28) : p.vh <= 430 ? (p.vw <= 640 ? 36 : 44) : p.vw <= 540 ? 36 : 52;
                if (blocked || compact) {
                    // 縮めた・出さなかった：選択肢の出ている行だけ。いつもの大きさで出していたら本当に何かに重なっていた（同じ CSS の canvas で測る）
                    const w = p.face.would;
                    const hits = w ? [['choices', p.choices], ['head', p.head], ['map', p.map], ['hud', p.hud], ['menu', p.menu]].filter(([, r]) => r && boxesOverlap(w, r)).map(([k]) => k) : [];
                    const off = w && (w.l < -0.5 || w.t < -0.5 || w.r > p.vw + 0.5 || w.b > p.vh + 0.5);
                    check(u.choices?.length > 0, `${L} 顔を縮める・出さないのは選択肢の出ている行だけ`, { hits, blocked, compact });
                    check(hits.length > 0 || off, `${L} 縮めた・出さなかった顔は、いつもの大きさなら重なっていた`, { w, hits });
                    if (blocked) rec.blocked = (rec.blocked ?? 0) + 1;
                    if (compact) rec.compact = (rec.compact ?? 0) + 1;
                }
                if (p.face && !p.face.hidden) {
                    const f = p.face.rect;
                    check(Math.abs(f.w - want) < 0.6 && Math.abs(f.h - want) < 0.6, `${L} 顔の大きさ ${want}px`, f);
                    const dpr = Math.min(2, Math.max(1, p.dpr));
                    check(p.face.px[0] === Math.round(want * dpr) && p.face.px[1] === Math.round(want * dpr), `${L} canvas の画素は端末の比 2 まで（${Math.round(want * dpr)}）`, p.face.px);
                    check(p.face.first && p.face.aria === 'true' && p.face.pe === 'none' && p.face.draggable === false && p.face.transform === 'none', `${L} 先頭・aria-hidden・押せない・ドラッグ不可・反転なし`, p.face);
                    if (pc) {
                        check(f.l >= p.dialog.l && f.r <= p.dialog.r && f.t >= p.dialog.t && f.b <= p.dialog.b, `${L} 顔は枠の中`, { f, d: p.dialog });
                        check(Math.abs((f.t + f.b) / 2 - (p.dialog.t + p.dialog.b) / 2) < 1, `${L} 顔は上下の真ん中`);
                    } else {
                        check(Math.abs(f.l - p.textR.l) < 0.6 && f.r <= p.dialog.r, `${L} 顔の左端は台詞の始まり（枠の左上の角）`, { f, t: p.textR });
                        if (compact) check(f.b <= p.textR.t + 0.5 && f.t >= p.dialog.t, `${L} 縮めた顔は枠の中・台詞の 1 行目の上`, { f, d: p.dialog, t: p.textR });
                        else check(f.b <= p.textR.t + 0.5 && f.b > p.dialog.t && f.t < p.dialog.t, `${L} 顔の下端は台詞の 1 行目の上・枠の上へはみ出す`, { f, d: p.dialog, t: p.textR });
                        check(p.nameR && p.nameR.l >= f.r - 0.5, `${L} 名前は顔の右`, { f, n: p.nameR });
                    }
                    check(f.l >= -0.5 && f.t >= -0.5 && f.r <= p.vw + 0.5 && f.b <= p.vh + 0.5, `${L} 顔は画面の中`, f);
                    for (const [k, r] of [['name', p.nameR], ['text', p.textR], ['count', p.count], ['more', p.more], ['choices', p.choices], ['head', p.head], ['map', p.map], ['hud', p.hud], ['menu', p.menu]]) {
                        if (r) check(!boxesOverlap(f, r), `${L} 顔が ${k} と重ならない`, { f, r });
                    }
                    for (const c of p.choiceRects) check(c.h <= 0 || !boxesOverlap(f, c), `${L} 顔が選択肢 ${c.id} と重ならない`, c.clipped ? { f, c } : undefined);
                }
                if (textLeft === null) textLeft = { t: p.textR?.l ?? null, n: p.nameR?.l ?? null };
                if (p.textR) check(Math.abs(p.textR.l - textLeft.t) < 0.5 && (!p.nameR || textLeft.n === null || Math.abs(p.nameR.l - textLeft.n) < 0.5), `${L} 名前・台詞の始まりが行ごとに動かない`, { textLeft, now: [p.textR.l, p.nameR?.l] });
            }
            check(p.dialog.l >= -0.5 && p.dialog.r <= p.vw + 0.5 && p.dialog.b <= p.vh + 0.5, `${L} 枠は画面の中`, p.dialog);
            // 枠と選択肢の重なりは、旧表示と比べて数える（スマホの縦の軍議は Version 21 から重なる）
            line.dlgOverChoices = !!(p.choices && boxesOverlap(p.dialog, p.choices));
            const sk = `${p.speaker}${u.choices?.length ? '+choices' : ''}`;
            if (shotAt[sk] && !seen.includes(sk)) {
                seen.push(sk);
                await shot(`${label}-${shotAt[sk]}`);
            }
            if (u.choices?.length) break;
            if (touch) await page.locator('.g-layer[data-kind="script"] .g-dialog').last().tap();
            else await page.keyboard.press('Enter');
        }
        step('real', `${label}（${id}）を ${touch ? '枠のタップ' : 'Enter'} で進めた`);
        return id;
    };
    const choose = async (id) => {
        await sleep(450);
        await press(page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${id}"]`).last());
        step('real', `選ぶ ${id}（${touch ? 'タップ' : 'クリック'}）`);
    };

    if (part === 'ch1') {
        if (size === WALK) {
            // 町の入口から真っすぐ北の忠勝まで、本物の入力（W キー）で歩く → 会話 →「まだ」（軍議は後で）
            await talkTo('tadakatsu', true);
            await readScript('walk-gate', { tadakatsu: 'walk-gate-tadakatsu' });
            await choose('not_yet');
            await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
            await sleep(400);
        }
        // 織田の使者（使者の行は顔なし・家康の行は家康の顔）
        await talkTo('oda_envoy');
        await readScript('envoy', { oda_envoy: 'envoy-line', hero: 'envoy-ieyasu-line' });
        await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
        await sleep(400);
        // 城門の忠勝
        await talkTo('tadakatsu');
        await readScript('gate', { narration: 'gate-narration', tadakatsu: 'gate-tadakatsu', hero: 'gate-ieyasu', 'tadakatsu+choices': 'gate-choice', 'hero+choices': 'gate-choice' });
        await choose('open_council');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council', null, POLL);
        await readScript('council', { narration: 'council-narration', tadakatsu: 'council-tadakatsu', hero: 'council-ieyasu', sakai: 'council-sakai', ishikawa: 'council-ishikawa', 'tadakatsu+choices': 'council-choices' });
        await choose('policy_oda');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council.confirm.oda', null, POLL);
        await readScript('confirm', { sakai: 'confirm-sakai', 'tadakatsu+choices': 'confirm-choices' });
        await choose('reconsider');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council.again', null, POLL);
        await readScript('again', { 'tadakatsu+choices': 'again-choices' });
        step('none', '考え直した後の方針の選択肢で止めた（決めない）');
    } else if (part === 'ch2') {
        await talkTo('tadakatsu');
        await readScript('ch2-tadakatsu', { tadakatsu: 'ch2-tadakatsu-line', 'tadakatsu+choices': 'ch2-tadakatsu-choice', 'hero+choices': 'ch2-tadakatsu-choice' });
        await choose('open_council');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id.startsWith('ch2.council'), null, POLL);
        await readScript('ch2-council', { narration: 'ch2-council-narration', sakai: 'ch2-council-sakai', ishikawa: 'ch2-council-ishikawa', tadakatsu: 'ch2-council-tadakatsu', 'tadakatsu+choices': 'ch2-council-choices', 'ishikawa+choices': 'ch2-council-choices', 'hero+choices': 'ch2-council-choices' });
        const st = await page.evaluate(() => ({ chapter: window.__game.state?.chapter, chars: window.__game.state?.characters }));
        rec.state = st;
        step('dev API', `状態（読むだけ）：${JSON.stringify(st)}`);
    } else {
        // 架空の章の最初の相手（源蔵。__game.cast は id・位置・姿だけ）
        const person = cast.find((c) => c.id === 'genzo') ?? cast.find((c) => c.model);
        await talkTo(person.id);
        await readScript('fictional', { hero: 'fictional-hero', narration: 'fictional-narration', [person.id]: 'fictional-person' });
    }
    rec.errors = errors.filter((e) => !/\[art\]/.test(e) && !(mode.startsWith('fail') && /Failed to load resource|ERR_FAILED/.test(e)));
    check(rec.errors.length === 0, `${tag} ページの誤りが無い`, rec.errors.slice(0, 3));
    await ctx.close();
    return rec;
}

for (const part of PARTS)
    for (const size of SIZES)
        for (const mode of MODES) {
            if (part === 'ch2' && !['1280x720', '844x390', '568x320', '390x844'].includes(size)) continue;
            if (part === 'fictional' && !['1280x720', '844x390'].includes(size)) continue;
            log(`== ${part} ${mode} ${size}`);
            try {
                report.runs.push(await run(part, size, mode));
            } catch (e) {
                check(false, `${part} ${mode} ${size} 走りきる`, String(e?.stack ?? e).slice(0, 400));
            }
        }

// ---- fail（顔の画像が読めない）と old の比べ：会話の層の DOM と台詞の枠の四角が同じ（Version 21 と同じ枠のまま、文字と操作が残る）
for (const part of PARTS)
    for (const size of SIZES) {
        const a = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'old');
        const f = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'fail');
        if (!a || !f) continue;
        const A = new Map(a.lines.map((l) => [`${l.script}#${l.index}`, l]));
        let n = 0;
        const diff = [];
        for (const l of f.lines) {
            const o = A.get(`${l.script}#${l.index}`);
            if (!o) continue;
            n++;
            if (l.html !== o.html || JSON.stringify(l.dialog) !== JSON.stringify(o.dialog) || JSON.stringify(l.choiceRects) !== JSON.stringify(o.choiceRects)) diff.push(`${l.script}#${l.index}`);
        }
        check(n > 0 && n === f.lines.length && n === a.lines.length, `${part} ${size} 顔が読めない：旧表示と同じ行を通った（${n} 行）`);
        check(diff.length === 0, `${part} ${size} 顔が読めない：会話の層の DOM・枠・選択肢の四角が旧表示と同じ`, diff.slice(0, 5));
        report[`fail.${part}.${size}`] = { lines: n, diff };
        log(`  ${part} ${size}: 顔が読めない版と旧表示を比べた ${n} 行、違い ${diff.length}`);
    }

// ---- failface（顔だけ読めない）と old の比べ：台詞の枠・台詞・選択肢の四角が同じ（人物画の canvas が増えるだけ。Version 25）
for (const part of PARTS)
    for (const size of SIZES) {
        const a = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'old');
        const f = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'failface');
        if (!a || !f) continue;
        const A = new Map(a.lines.map((l) => [`${l.script}#${l.index}`, l]));
        let n = 0;
        const diff = [];
        for (const l of f.lines) {
            const o = A.get(`${l.script}#${l.index}`);
            if (!o) continue;
            n++;
            if (JSON.stringify(l.dialog) !== JSON.stringify(o.dialog) || JSON.stringify(l.textR) !== JSON.stringify(o.textR) || JSON.stringify(l.choiceRects) !== JSON.stringify(o.choiceRects)) diff.push(`${l.script}#${l.index}`);
        }
        check(n > 0 && n === f.lines.length && n === a.lines.length, `${part} ${size} 顔だけ読めない：旧表示と同じ行を通った（${n} 行）`);
        check(diff.length === 0, `${part} ${size} 顔だけ読めない：台詞の枠・台詞・選択肢の四角が旧表示と同じ`, diff.slice(0, 5));
        report[`failface.${part}.${size}`] = { lines: n, diff };
        log(`  ${part} ${size}: 顔だけ読めない版と旧表示を比べた ${n} 行、違い ${diff.length}`);
    }

// ---- old と default（と failportrait・failface）の比べ（同じ部・大きさ・台本・行）：台詞の字・四角・枠の高さは同じ。枠と選択肢の重なりは old にもある物だけ
const key = (l) => `${l.script}#${l.index}`;
const same = (a, b) => !!a && !!b && ['l', 't', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.5);
for (const part of PARTS)
    for (const size of SIZES)
        for (const bm of ['default', 'failportrait', 'failface']) {
            const a = report.runs.find((r) => r.part === part && r.size === size && r.mode === 'old');
            const b = report.runs.find((r) => r.part === part && r.size === size && r.mode === bm);
            if (!a || !b) continue;
            const T = `${part} ${size}${bm === 'default' ? '' : ` ${bm}`}`;
            const A = new Map(a.lines.map((l) => [key(l), l]));
            let n = 0;
            const taller = [];
            const moved = [];
            const newOverlap = [];
            let oldOverlap = 0;
            for (const l of b.lines) {
                const o = A.get(key(l));
                if (!o) continue;
                n++;
                if (l.dialog.h > o.dialog.h + 0.5) taller.push({ line: key(l), speaker: l.speaker, old: o.dialog.h, now: l.dialog.h, text: l.text.slice(0, 30) });
                if (!same(l.textR, o.textR) || l.textFont !== o.textFont || l.textLs !== o.textLs || l.textLh !== o.textLh) moved.push({ line: key(l), old: [o.textR, o.textFont, o.textLs], now: [l.textR, l.textFont, l.textLs] });
                if (o.dlgOverChoices) oldOverlap++;
                if (l.dlgOverChoices && !o.dlgOverChoices) newOverlap.push(key(l));
                if (part === 'fictional') check(l.html === o.html, `fictional ${size} ${key(l)} 会話の層の DOM が旧表示と同じ`);
            }
            check(n > 0, `${T} 旧表示と同じ行を比べた（${n} 行）`);
            check(taller.length === 0, `${T} 枠が旧表示より高くなった行は無い`, taller.slice(0, 3));
            check(moved.length === 0, `${T} 台詞の四角・字の大きさ・字の間・行の高さは旧表示と同じ`, moved.slice(0, 2));
            check(newOverlap.length === 0, `${T} 枠が選択肢と新しく重なる行は無い（旧表示でも重なる行 ${oldOverlap}）`, newOverlap);
            // 同じ入力で同じ台本・同じ行・同じ台詞・同じ選択肢を通った（物語は変わらない）
            const seq = (r) => r.lines.map((l) => `${key(l)}|${l.name}|${l.text}|${(l.choiceIds ?? []).join(',')}`).join('\n');
            check(seq(a) === seq(b), `${T} 旧表示と同じ台本・行・台詞・選択肢を通った（${b.lines.length} 行）`);
            if (a.state || b.state) check(JSON.stringify(a.state) === JSON.stringify(b.state), `${T} 第二章の状態が旧表示と同じ`, { old: a.state, now: b.state });
            report[`compare.${bm === 'default' ? '' : `${bm}.`}${part}.${size}`] = { lines: n, taller, moved: moved.length, oldOverlap, newOverlap, compact: b.compact ?? 0, blocked: b.blocked ?? 0 };
            log(`  ${T}: 比べた ${n} 行、高くなった ${taller.length}、台詞が動いた ${moved.length}、選択肢との重なり old ${oldOverlap}・新しく ${newOverlap.length}、重なりで顔を縮めた行 ${b.compact ?? 0}・出さなかった行 ${b.blocked ?? 0}`);
        }

report.checks = checks;
const ng = checks.filter((c) => !c.ok);
report.summary = { checks: checks.length, ng: ng.length };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
log(`checks ${checks.length}, NG ${ng.length}`);
for (const c of ng.slice(0, 30)) log('NG', c.what, JSON.stringify(c.detail ?? '').slice(0, 300));
await browser.close();
process.exit(ng.length ? 1 : 0);
