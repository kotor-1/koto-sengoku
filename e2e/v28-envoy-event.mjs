/**
 * Version 28 §4.3・§4.4：第一章の「町を歩く → 使者の短い急報 → 操作へ戻る」を、開発サーバーの本物のページで、本物の入力（キー・マウス・クリック）で確かめる。
 * 描画の省略（?q=low&render=manual：3D を描かない）。開発用の口（window.__game・__p3・__audio）は様子を読むだけ（会話・移動は本物のキーで）。
 *
 * 部（PARTS。カンマ区切り。既定 watch,skip）：
 *   watch  はじめから（本物のクリック）→ 短い始めを最後まで見る（切らずに肩越しのカメラへ）→ マウスで見回す → W で北へ・途中から Shift で走る
 *          → 線を越えると急報が 1 回だけ始まる → 途中で本物の M・J（メニュー・情勢は開かない）・窓が外れた（blur：自動の一時停止・声が止まる・
 *          後から鳴らない）→「再開」→ 最後まで見る → 操作へ戻る（W で動く・見回しは急報の前と同じ・カメラはなめらかに戻る）→ 南へ戻って
 *          また北へ（もう起きない）→ 使者・忠勝が話せる位置に着くのを待つ → 本物のキーで歩いて織田の使者・浅井の使者・忠勝と話す
 *         （話しかけると主人公は 0.3〜0.5 秒で向き直る）→ 忠勝の「軍議を開く」→ 軍議が開く。状態・保存は急報の前後で同じ。
 *   skip   はじめから → 短い始めを「スキップ」→ 見回す → W で北へ → 急報の途中（浅井の使者の台詞）で本物の Esc → 声はすぐ止まり後から鳴らない・
 *          入力とカメラが戻る・使者は話せる位置・忠勝は城門の前（後の歩きをしない）→ 南へ戻ってまた北へ（もう起きない）。
 *   shots  画面の撮影（?render=manual：1 コマずつ描く。実時間ではない）：短い始めの始めと終わり、急報の 3 つの画、出来事の後の歩き。
 *
 * 使い方：(cd <worktree> && PORT=8781 npx vite --config proto3d/blender/tools/vite.nohmr.mjs &)
 *   BASE3D=http://localhost:8781 node e2e/v28-envoy-event.mjs <出力先>
 * 注意：このコンテナの描画はソフトウェア（実機の滑らかさは確かめられない）。ここで見るのは入力・状態・時刻・カメラの値。
 */
import { writeFileSync } from 'node:fs';
import { keysToward, launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/v28-envoy-event');
const BASE = process.env.BASE3D || 'http://localhost:8781';
const PARTS = (process.env.PARTS || 'watch,skip').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const POLL = { timeout: 600000, polling: 100 };
let passed = 0;
let failed = 0;
const lines = [];
const note = (t) => {
    lines.push(t);
    console.log(t);
};
const check = (name, ok, extra = '') => {
    if (ok) passed++;
    else failed++;
    note(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const result = {};

const browser = await launchBrowser();

/** 毎コマのカメラ・主人公・画面（ゲームの毎コマの後。rAF） */
const REC = () => {
    const P = (window.__rec = { on: false, rows: [] });
    const tick = () => {
        if (P.on) {
            const c = window.__p3.camera.position;
            const h = window.__p3.hero;
            P.rows.push({ t: performance.now(), x: c.x, y: c.y, z: c.z, hx: h.x, hz: h.z, hh: h.heading, yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch, screen: window.__game.screen, cine: window.__game.cine?.id ?? null, ct: window.__game.cine?.t ?? null });
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

async function open(query = '?q=low&render=manual', viewport = { width: 1280, height: 720 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/素材なし/.test(m.text())) errors.push(m.text().slice(0, 300));
    });
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
    await page.waitForFunction(() => window.__game.world.ready, null, POLL);
    await page.evaluate(REC);
    return { ctx, page, errors };
}

const S = (page) =>
    page.evaluate(() => {
        const g = window.__game;
        const h = window.__p3.hero;
        return {
            screen: g.screen,
            ui: g.ui?.kind ?? null,
            cine: g.cine ? { id: g.cine.id, t: g.cine.t, paused: g.cine.paused, caption: g.cine.caption, state: g.cine.state } : null,
            hero: { x: h.x, z: h.z, heading: h.heading, speed: h.speed },
            orbit: { yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch, dist: window.__p3.orbit.dist },
            townEvent: g.townEvent,
            event: g.event,
            cast: g.cast.map((c) => ({ id: c.id, x: c.x, z: c.z, heading: c.heading, at: c.at, now: c.now, driven: c.driven })),
            prompt: g.prompt?.id ?? g.prompt ?? null,
            cineLog: g.cineLog,
            voice: window.__audio ? { playing: window.__audio.sys.voiceFiles.playingId ?? null, pending: window.__audio.sys.voiceFiles.pendingId ?? null } : null,
        };
    });
const stateJson = (page) => page.evaluate(() => JSON.stringify(window.__game.state));
const storage = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
const recOn = (page) => page.evaluate(() => ((window.__rec.rows = []), (window.__rec.on = true)));
const recOff = (page) => page.evaluate(() => ((window.__rec.on = false), window.__rec.rows));
/** 1 コマのカメラの動きの最大（m） */
const maxStep = (rows) => {
    let m = 0;
    for (let i = 1; i < rows.length; i++) m = Math.max(m, Math.hypot(rows[i].x - rows[i - 1].x, rows[i].y - rows[i - 1].y, rows[i].z - rows[i - 1].z));
    return m;
};

/** 本物のマウスの引きずりで見回す（dx px 右へ） */
async function dragLook(page, dx, dy = 0) {
    await page.mouse.move(640, 380);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(640 + (dx * i) / 10, 380 + (dy * i) / 10);
    await page.mouse.up();
    await sleep(400);
}

/** キーを押したまま、pred（ページの中の関数の文字列）が真になるまで（または ms まで）。離して、最後の様子を返す */
async function holdUntil(page, keys, pred, ms, extra = null) {
    for (const k of keys) await page.keyboard.down(k);
    const t0 = Date.now();
    let ok = false;
    let shift = false;
    while (Date.now() - t0 < ms) {
        if (extra && !shift && Date.now() - t0 > extra.afterMs) {
            await page.keyboard.down(extra.key);
            shift = true;
        }
        ok = await page.evaluate(pred);
        if (ok) break;
        await sleep(60);
    }
    if (shift) await page.keyboard.up(extra.key);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    return ok;
}

/** 本物のキーで、(tx, tz) の相手（id）の「話す」が出るまで歩く */
async function walkTo(page, id, tx, tz, maxMs = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
        const s = await S(page);
        if (s.prompt === id) return true;
        const keys = keysToward(s.orbit.yaw, s.hero, tx, tz);
        if (!keys.length) keys.push('KeyW');
        for (const k of keys) await page.keyboard.down(k);
        await sleep(160);
        for (const k of keys) await page.keyboard.up(k);
    }
    return false;
}

/** 会話を本物の Enter で送り、選択肢が出たら pick を本物のクリックで選ぶ（pick が無ければ最後まで送って閉じる）。返り：会話が閉じたか・選んだか */
async function talkThrough(page, pick = null) {
    for (let i = 0; i < 40; i++) {
        const u = await page.evaluate(() => window.__game.ui);
        if (!u || u.kind !== 'script') return { closed: true, picked: false };
        if (u.choices?.length) {
            const id = pick && u.choices.includes(pick) ? pick : u.choices[u.choices.length - 1];
            await sleep(450);
            await page.click(`.g-choice[data-id="${id}"]`);
            await sleep(500);
            return { closed: false, picked: id === pick, choices: u.choices };
        }
        await sleep(420);
        await page.keyboard.press('Enter');
    }
    return { closed: false, picked: false };
}

// ---------------------------------------------------------------- watch

if (PARTS.includes('watch')) {
    note('== watch：はじめから → 短い始めを見る → 見回し・W と Shift で北へ → 急報を最後まで見る（途中で M・J・窓が外れる）→ 操作へ戻る → もう起きない → 話す → 軍議');
    const { ctx, page, errors } = await open();
    const store0 = await storage(page);
    await sleep(600);
    await recOn(page);
    await page.locator('button[data-id="new:ieyasu1570"]').click();
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
    const openId = await page.locator('.g-layer[data-kind="cine"]').getAttribute('data-cine');
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
    await sleep(1500);
    const rowsOpen = await recOff(page);
    const inCine = rowsOpen.filter((r) => r.cine === 'ch1_open');
    const after = rowsOpen.filter((r) => r.screen === 'explore' && !r.cine);
    const hand = rowsOpen.slice(Math.max(0, rowsOpen.indexOf(inCine.at(-1)) - 5), rowsOpen.indexOf(after[0]) + 30);
    result.open = { id: openId, cineFrames: inCine.length, lastT: inCine.at(-1)?.ct, handoverMaxStep: maxStep(hand), moveMaxStep: maxStep(inCine) };
    check('はじめから：自動で流れるのは短い始め（ch1_open）だけ', openId === 'ch1_open', openId);
    check('短い始めは 1 つのカメラの動き（1 コマ 0.25 m 以内）で、終わりから操作のカメラへ切らずにつながる（つなぎ目の 1 コマ 0.05 m 以内）', result.open.moveMaxStep < 0.25 && result.open.handoverMaxStep < 0.05, J(result.open));
    let s = await S(page);
    check('操作へ：使者はまだ町に居ない（話せない）・急報を待っている', s.screen === 'explore' && s.townEvent === 'ch1_report' && !s.cast.some((c) => c.id === 'oda_envoy' || c.id === 'asai_envoy') && s.cast.some((c) => c.id === 'tadakatsu'), J({ townEvent: s.townEvent, cast: s.cast.map((c) => c.id) }));
    // 見回す（本物の引きずり：右へ 40px）
    await dragLook(page, 40, 6);
    const orbitBefore = (await S(page)).orbit;
    check('マウスの引きずりで見回した', Math.abs(orbitBefore.yaw) > 0.1, J(orbitBefore));
    const state0 = await stateJson(page);
    // W で北へ、1 秒後から Shift で走る。急報が始まるまで
    const t0 = Date.now();
    const trig = await holdUntil(page, ['KeyW'], () => window.__game.ui?.kind === 'cine', 60000, { key: 'ShiftLeft', afterMs: 1000 });
    s = await S(page);
    result.trigger = { wallSec: (Date.now() - t0) / 1000, hero: s.hero, cine: s.cine };
    check('W・Shift で北へ進むと、線（z 6）を越えた所で急報（ch1_report）が始まる', trig && s.cine?.id === 'ch1_report' && s.hero.z < 6.0 && s.hero.z > 4.5, J(result.trigger));
    // 急報の間
    await recOn(page);
    const caps = [];
    const seen = { linked: new Set(), menu: null, sit: null, blur: null };
    let pressedM = false;
    let blurred = false;
    for (let i = 0; i < 1200; i++) {
        s = await S(page);
        if (!s.cine) break;
        const sp = s.cine.caption?.speaker ?? '';
        if (sp && caps.at(-1) !== sp) caps.push(sp);
        for (const id of s.event.linked) seen.linked.add(id);
        if (!pressedM && s.cine.t >= 3.0) {
            pressedM = true;
            await page.keyboard.press('KeyM');
            await sleep(300);
            await page.keyboard.press('KeyJ');
            await sleep(300);
            const u = await page.evaluate(() => ({ menu: !!document.querySelector('.g-layer[data-kind="menu"]'), sit: !!document.querySelector('.g-layer[data-kind="situation"]'), ui: window.__game.ui?.kind }));
            seen.menu = u;
        }
        if (!blurred && s.cine.t >= 5.0) {
            blurred = true;
            const v0 = (await S(page)).voice;
            // 窓が外れた（アプリの切り替え）：ページの中で blur を出す
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            await sleep(300);
            const a = await S(page);
            await sleep(1500);
            const b = await S(page);
            seen.blur = { before: v0, paused: a.cine?.paused, t0: a.cine?.t, t1: b.cine?.t, voiceAfter: a.voice, voiceLater: b.voice };
            // 「再開」（本物のクリック）
            await page.locator('.g-layer[data-kind="cine"] .g-cine-btn[data-id="pause"]').click();
            await sleep(300);
        }
        await sleep(100);
    }
    const rowsEv = await recOff(page);
    result.event = { caps, linked: [...seen.linked], menu: seen.menu, blur: seen.blur, frames: rowsEv.length };
    check('急報の話し手の順：織田家の使者 → 浅井家の使者 → 忠勝 → 家康', J(caps) === J(['織田家の使者', '浅井家の使者', '忠勝', '家康']), J(caps));
    check('急報の人は会話の相手そのもの（使者 2 人・忠勝を同じ id で描く）', ['oda_envoy', 'asai_envoy', 'tadakatsu'].every((id) => seen.linked.has(id)), J([...seen.linked]));
    check('急報の間の本物の M・J：メニュー・情勢は開かない（演出のまま）', seen.menu && !seen.menu.menu && !seen.menu.sit && seen.menu.ui === 'cine', J(seen.menu));
    check('窓が外れた（blur）：自動で一時停止し、声は止まり、止めている間は進まず後から鳴らない', seen.blur && seen.blur.paused === true && Math.abs(seen.blur.t1 - seen.blur.t0) < 1e-6 && !seen.blur.voiceAfter?.playing && !seen.blur.voiceLater?.playing && !seen.blur.voiceLater?.pending, J(seen.blur));
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await recOn(page);
    await sleep(1500);
    const rowsBack = await recOff(page);
    s = await S(page);
    result.back = { orbit: s.orbit, hero: s.hero, maxStep: maxStep(rowsBack), epilogue: s.event.epilogue, prompt: s.prompt };
    check('操作へ戻る：見回しの向き・高さは急報の前と同じ', Math.abs(s.orbit.yaw - orbitBefore.yaw) < 1e-6 && Math.abs(s.orbit.pitch - orbitBefore.pitch) < 1e-6, J({ before: orbitBefore, after: s.orbit }));
    check('カメラは肩越しへなめらかに戻る（1 コマ 0.6 m 以内）', result.back.maxStep < 0.6, result.back.maxStep.toFixed(3));
    check('使者は町に居る（配役に入る）。使者・忠勝は話せる位置へ歩いている（その間は「話す」を出さない）', s.cast.some((c) => c.id === 'oda_envoy') && s.cast.some((c) => c.id === 'asai_envoy') && s.event.epilogue.length > 0 && !s.event.epilogue.includes(s.prompt), J({ epilogue: s.event.epilogue, prompt: s.prompt }));
    check('見ても状態は変わらない・保存に書かない', (await stateJson(page)) === state0 && J(await storage(page)) === J(store0));
    // W で動く
    const p0 = (await S(page)).hero;
    await page.keyboard.down('KeyS');
    await sleep(900);
    await page.keyboard.up('KeyS');
    await sleep(200);
    const p1 = (await S(page)).hero;
    check('操作へ戻った：S（本物のキー）で主人公が動く', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, J({ p0, p1 }));
    // 南へ戻ってまた北へ：もう起きない
    const log0 = (await S(page)).cineLog.length;
    await holdUntil(page, ['KeyS'], () => window.__p3.hero.z > 8.0, 20000);
    let again = false;
    for (const k of ['KeyW']) await page.keyboard.down(k);
    for (let i = 0; i < 80; i++) {
        const q = await S(page);
        if (q.ui === 'cine') again = true;
        if (q.hero.z < 3.0) break;
        await sleep(60);
    }
    await page.keyboard.up('KeyW');
    s = await S(page);
    result.again = { z: s.hero.z, cineLog: s.cineLog };
    check('南へ戻って線をもう一度越えても、急報は起きない', !again && s.cineLog.length === log0 && s.hero.z < 4.5, J(result.again));
    // 使者・忠勝が話せる位置に着くまで
    await page.waitForFunction(() => window.__game.event.epilogue.length === 0, null, { timeout: 120000, polling: 200 });
    s = await S(page);
    const atSpots = ['oda_envoy', 'asai_envoy', 'tadakatsu'].map((id) => s.cast.find((c) => c.id === id)).every((c) => c && Math.hypot(c.at[0] - c.x, c.at[1] - c.z) < 1e-6 && !c.driven);
    check('使者・忠勝は話せる位置（置き場所）に着いた', atSpots, J(s.cast.filter((c) => c.at).map((c) => [c.id, c.at, [c.x, c.z]])));
    // 話す：織田の使者・浅井の使者・忠勝（本物のキーで歩き、E で話しかけ、Enter で送る）
    const talk = async (id, tx, tz, pick = null) => {
        const ok = await walkTo(page, id, tx, tz);
        if (!ok) return { ok };
        const h0 = (await S(page)).hero.heading;
        await recOn(page);
        await page.keyboard.press('KeyE');
        await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
        await sleep(700);
        const rows = await recOff(page);
        const hs = rows.map((r) => r.hh);
        let maxTurn = 0;
        for (let i = 1; i < hs.length; i++) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(hs[i] - hs[i - 1]), Math.cos(hs[i] - hs[i - 1]))));
        const turned = Math.abs(Math.atan2(Math.sin(hs.at(-1) - h0), Math.cos(hs.at(-1) - h0)));
        const ev = (await S(page)).event;
        const r = await talkThrough(page, pick);
        return { ok, frames: rows.length, maxTurnDeg: (maxTurn * 180) / Math.PI, turnedDeg: (turned * 180) / Math.PI, talkWith: ev.talkWith, ...r };
    };
    result.talk = {};
    result.talk.oda = await talk('oda_envoy', 2.0, -7.1);
    check('織田の使者と話せる（本物のキーで歩き E で話す）。相手は主人公の顔を見る', result.talk.oda.ok && result.talk.oda.closed && result.talk.oda.talkWith === 'oda_envoy', J(result.talk.oda));
    result.talk.asai = await talk('asai_envoy', 5.3, -2.4);
    check('浅井の使者と話せる', result.talk.asai.ok && result.talk.asai.closed && result.talk.asai.talkWith === 'asai_envoy', J(result.talk.asai));
    result.talk.tadakatsu = await talk('tadakatsu', -1.5, -7.2, 'open_council');
    check('忠勝と話し「軍議を開く」を選べる', result.talk.tadakatsu.ok && result.talk.tadakatsu.picked, J(result.talk.tadakatsu));
    const turns = ['oda', 'asai', 'tadakatsu'].map((k) => result.talk[k]).filter((x) => x?.turnedDeg > 20);
    check('話しかけると主人公は 1 コマで回らない（1 コマ 12° 以内）', turns.every((x) => x.maxTurnDeg <= 12.01), J(turns.map((x) => [x.turnedDeg.toFixed(0), x.maxTurnDeg.toFixed(1), x.frames])));
    await page.waitForFunction(() => window.__game.screen === 'council', null, { timeout: 60000, polling: 100 });
    check('軍議が開く（今までどおり）', (await S(page)).screen === 'council');
    check('ページの誤りが無い', errors.length === 0, J(errors.slice(0, 3)));
    await ctx.close();
}

// ---------------------------------------------------------------- skip

if (PARTS.includes('skip')) {
    note('== skip：はじめから → 短い始めを「スキップ」→ 見回し → W で北へ → 急報の途中で本物の Esc → 戻る');
    const { ctx, page, errors } = await open();
    const store0 = await storage(page);
    await sleep(600);
    await page.locator('button[data-id="new:ieyasu1570"]').click();
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
    await sleep(600);
    await page.locator('.g-layer[data-kind="cine"] .g-cine-btn[data-id="skip"]').click();
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
    await sleep(500);
    await dragLook(page, -30, -4);
    const orbitBefore = (await S(page)).orbit;
    const state0 = await stateJson(page);
    const trig = await holdUntil(page, ['KeyW'], () => window.__game.ui?.kind === 'cine', 60000);
    let s = await S(page);
    check('急報が始まる', trig && s.cine?.id === 'ch1_report', J(s.cine));
    // 浅井の使者の台詞の途中まで見る
    await page.waitForFunction(() => (window.__game.cine?.t ?? 0) >= 5.2, null, POLL);
    const mid = await S(page);
    await page.keyboard.press('Escape');
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
    const v = [];
    for (let i = 0; i < 20; i++) {
        v.push((await S(page)).voice);
        await sleep(100);
    }
    s = await S(page);
    result.skip = { mid: { t: mid.cine?.t, caption: mid.cine?.caption, voice: mid.voice }, voice: v.filter((x) => x?.playing || x?.pending), orbit: s.orbit, cast: s.cast.filter((c) => c.at).map((c) => [c.id, c.at, [c.x, c.z], c.driven]), epilogue: s.event.epilogue, townEvent: s.townEvent };
    check('Esc（本物のキー）で飛ばした：声はすぐ止まり、後から鳴らない（2 秒見る）', result.skip.voice.length === 0, J(result.skip.voice.slice(0, 3)));
    check('飛ばした：見回しの向き・高さは急報の前と同じ', Math.abs(s.orbit.yaw - orbitBefore.yaw) < 1e-6 && Math.abs(s.orbit.pitch - orbitBefore.pitch) < 1e-6, J({ before: orbitBefore, after: s.orbit }));
    check('飛ばした：使者は話せる位置、忠勝は城門の前（後の歩きをしない）', ['oda_envoy', 'asai_envoy', 'tadakatsu'].every((id) => {
        const c = s.cast.find((x) => x.id === id);
        return c && Math.hypot(c.at[0] - c.x, c.at[1] - c.z) < 1e-6;
    }) && s.event.epilogue.length === 0, J(result.skip.cast));
    check('飛ばしても状態は変わらない・保存に書かない・もう待たない', (await stateJson(page)) === state0 && J(await storage(page)) === J(store0) && s.townEvent === null);
    const p0 = s.hero;
    await page.keyboard.down('KeyS');
    await sleep(900);
    await page.keyboard.up('KeyS');
    await sleep(200);
    const p1 = (await S(page)).hero;
    check('飛ばした後：S（本物のキー）で主人公が動く（入力が戻る）', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, J({ p0, p1 }));
    // 南へ戻ってまた北へ：もう起きない
    const log0 = (await S(page)).cineLog.length;
    await holdUntil(page, ['KeyS'], () => window.__p3.hero.z > 8.0, 20000);
    const again = await holdUntil(page, ['KeyW'], () => window.__game.ui?.kind === 'cine' || window.__p3.hero.z < 3.0, 20000);
    s = await S(page);
    check('飛ばした後も、線をもう一度越えて起きない', s.cineLog.length === log0 && s.ui !== 'cine', J({ again, z: s.hero.z, cineLog: s.cineLog }));
    check('ページの誤りが無い', errors.length === 0, J(errors.slice(0, 3)));
    await ctx.close();
}

// ---------------------------------------------------------------- shots（手動の描画。実時間ではない）

if (PARTS.includes('shots')) {
    note('== shots：手動の描画（1 コマずつ。実時間ではない）');
    const { ctx, page, errors } = await open('?render=manual');
    const shotAt = async (name) => {
        await page.evaluate(() => window.__p3.renderNow());
        await page.screenshot({ path: `${OUT}/${name}.png` });
        note(`   撮影 ${name}.png`);
    };
    /** 演出の時刻 t まで進めて一時停止（本物の Space）して撮り、再開 */
    const pauseAt = async (t, name) => {
        await page.waitForFunction((x) => (window.__game.cine?.t ?? 0) >= x, t, { timeout: 600000, polling: 30 });
        await page.keyboard.press('Space');
        await sleep(200);
        await shotAt(name);
        await page.keyboard.press('Space');
    };
    await sleep(800);
    await page.locator('button[data-id="new:ieyasu1570"]').click();
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
    await sleep(500);
    await pauseAt(0.25, 's1-open-start');
    await pauseAt(3.9, 's2-open-end');
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
    await sleep(600);
    await shotAt('s3-control');
    await holdUntil(page, ['KeyW'], () => window.__game.ui?.kind === 'cine', 60000);
    await pauseAt(0.7, 's4-report-run');
    await pauseAt(2.6, 's5-report-oda');
    await pauseAt(5.0, 's6-report-asai');
    await pauseAt(8.4, 's7-report-tadakatsu');
    await pauseAt(13.6, 's8-report-hero');
    await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
    await sleep(2500);
    await shotAt('s9-after-walk');
    check('撮影のページの誤りが無い', errors.length === 0, J(errors.slice(0, 3)));
    await ctx.close();
}

await browser.close();
note(`\n結果：OK ${passed}・NG ${failed}`);
writeFileSync(`${OUT}/v28-envoy-event.json`, J({ passed, failed, result }, null, 2));
writeFileSync(`${OUT}/v28-envoy-event.txt`, lines.join('\n'));
process.exit(failed ? 1 : 0);
