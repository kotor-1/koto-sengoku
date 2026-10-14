/**
 * Version 28 §4.3 の最後の項（docs/v28-town-motion-voice.md §13）：第二章の冒頭の使いの急報と、出陣の号令・見送りを、開発サーバーの本物のページで、
 * 本物の入力（クリック・キー）で確かめる。描画の省略（?q=low&render=manual：3D を描かない）。開発用の口（window.__game・__p3）は様子を読むだけ。
 * 直接状態変更：第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/）を新しいブラウザの localStorage に入れる・支度の段階から始める（__game.setIeyasuPhase）・
 * 城門の手前へ置く（__game.teleport。そこから城門へは本物の W で歩く）。
 *
 * 部（PARTS。カンマ区切り。既定 ch2,depart）：
 *   ch2    本物のクリック「つづきから」→「第二章へ進む」→ 結果確認の「城下へ」→ 第二章の冒頭を通常速度で最後まで：使いは来るまで城下に居ない・
 *          使いと家臣の場面の間ずっと主人公が町の入口に立つ・使いは止まってから言う・家臣は置き場所から歩いて来て止まってから言う
 *          → 操作へ（カメラは切らずに肩越しへ）→ 使い・家臣は同じ人物のまま置き場所へ歩く（その間は「話す」を出さない）→ 本物の W で忠勝へ歩き、
 *          着いてから E で話す。冒頭の間に保存を書かない・状態は冒頭の前後で同じ。
 *   depart 支度の段階 → 城門の手前から本物の W で城門の輪へ → Enter で送り「出陣する」をクリック → 出陣の演出：主人公が画に入る・号令の間は動かない・
 *          隊列の道を空けて脇へ・会話の相手の人物は隠さない（城門の輪だけ）→ 合戦の画面。
 *   shots  手動の描画（?render=manual：1 コマずつ描く。実時間ではない）：第二章の冒頭（使いが走って来る・片膝で言う・聞く主人公・家臣が来て言う・操作へ戻った画）、
 *          出陣（号令・見送り）。
 *
 * 使い方：(cd <worktree> && PORT=8781 npx vite --config proto3d/blender/tools/vite.nohmr.mjs &)
 *   BASE3D=http://localhost:8781 node e2e/v28-ch2-depart.mjs <出力先>
 * 注意：このコンテナの描画はソフトウェア（実機の滑らかさは確かめられない）。ここで見るのは入力・状態・時刻・人物の位置・カメラの値。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { keysToward, launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/v28-ch2-depart');
const BASE = process.env.BASE3D || 'http://localhost:8781';
const PARTS = (process.env.PARTS || 'ch2,depart').split(',').map((s) => s.trim()).filter(Boolean);
const CH2 = process.env.CH2 || 'oda_victory_kept';
const KEY = 'koto-sengoku/3d-ieyasu1570';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const POLL = { timeout: 600000, polling: 100 };
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');
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

/** 毎コマ（rAF）のカメラ・主人公・演出の時計・会話の相手（ゲームの毎コマの後に読む） */
const REC = () => {
    const P = (window.__rec = { on: false, rows: [] });
    const tick = () => {
        if (P.on) {
            const c = window.__p3.camera.position;
            const h = window.__p3.hero;
            const ev = window.__game.world.eventProbe();
            const sp = window.__game.world.stageProbe();
            P.rows.push({
                t: performance.now(),
                x: c.x,
                y: c.y,
                z: c.z,
                hx: h.x,
                hz: h.z,
                hh: h.heading,
                screen: window.__game.screen,
                cine: window.__game.cine?.id ?? null,
                ct: window.__game.cine?.t ?? null,
                cap: window.__game.cine?.caption ?? null,
                ev: sp.event,
                hidden: sp.hiddenCast,
                linked: ev.linked,
                linkedAt: ev.linkedAt,
                epilogue: ev.epilogue,
                cast: window.__game.cast.map((m) => ({ id: m.id, at: m.at, now: m.now })),
                prompt: window.__game.prompt,
            });
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

async function open(query = '?q=low&render=manual', main = null, viewport = { width: 1280, height: 720 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/素材なし|Couldn't load texture blob:/.test(m.text())) errors.push(m.text().slice(0, 300));
    });
    await page.goto(`${BASE}/${query}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__game.world.ready, null, POLL);
    if (main !== null) {
        // 第一章の結末の保存を入れて読み込み直す（新しいブラウザの中だけ。直接状態変更）
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, main]);
        await page.reload();
        await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true && window.__game.world.ready, null, POLL);
    }
    await page.evaluate(REC);
    // 保存の書き込みを数える（setItem を包む。観察だけ）
    await page.evaluate(() => {
        window.__writes = {};
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
            window.__writes[k] = (window.__writes[k] ?? 0) + 1;
            return orig.call(this, k, v);
        };
    });
    return { ctx, page, errors };
}
const recOn = (page) => page.evaluate(() => ((window.__rec.rows = []), (window.__rec.on = true)));
const recOff = (page) => page.evaluate(() => ((window.__rec.on = false), window.__rec.rows));
const specOf = (page, moment) =>
    page.evaluate((m) => {
        const g = window.__game;
        const sc = g.game.scenarios.find((x) => x.id === g.scenario);
        return sc?.cinematic ? sc.cinematic(g.state, m) : null;
    }, moment);
const entryPose = (page) => page.evaluate(async () => ({ ...(await import('/src/town/spots.ts')).ENTRY_POSE }));
const maxCamStep = (rows) => {
    let m = 0;
    for (let i = 1; i < rows.length; i++) m = Math.max(m, Math.hypot(rows[i].x - rows[i - 1].x, rows[i].y - rows[i - 1].y, rows[i].z - rows[i - 1].z));
    return m;
};

/** 本物のキーで、(tx, tz) の相手（id）の「話す」が出るまで歩く。歩く間に、話せない相手（arriving）に「話す」が出ないかを数える */
async function walkTo(page, id, tx, tz, maxMs = 120000) {
    const t0 = Date.now();
    let early = 0;
    while (Date.now() - t0 < maxMs) {
        const s = await page.evaluate(() => ({ prompt: window.__game.prompt, hero: { x: window.__p3.hero.x, z: window.__p3.hero.z }, yaw: window.__p3.orbit.yaw, epilogue: window.__game.event.epilogue }));
        if (s.prompt && s.epilogue.includes(s.prompt)) early++;
        if (s.prompt === id) return { ok: true, early };
        const keys = keysToward(s.yaw, s.hero, tx, tz);
        if (!keys.length) keys.push('KeyW');
        for (const k of keys) await page.keyboard.down(k);
        await sleep(250);
        for (const k of [...keys].reverse()) await page.keyboard.up(k);
    }
    return { ok: false, early };
}

/** 第一章の結末 → 本物のクリックで第二章の冒頭まで */
async function toCh2Open(page) {
    await page.locator('.g-btn[data-id="continue:ieyasu1570"]').click();
    await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
    await sleep(500);
    await page.locator('.g-btn[data-id="next_chapter"]').click();
    await page.waitForFunction(() => window.__game.ui?.kind === 'record', null, POLL);
    await sleep(500);
}

// ---------------------------------------------------------------- ch2
if (PARTS.includes('ch2')) {
    note(`== ch2：第一章の結末の保存（${CH2}）→ 第二章の冒頭（通常速度・描画の省略）→ 操作 → 忠勝と話す`);
    const { ctx, page, errors } = await open('?q=low&render=manual', fixture(CH2));
    await toCh2Open(page);
    const E = await entryPose(page);
    const castBefore = await page.evaluate(() => window.__game.cast.map((m) => m.id));
    check('結果確認の画面の間（冒頭の前）：城下に使いは居ない（木戸から来る）・忠勝は居る', !castBefore.includes('envoy') && castBefore.includes('tadakatsu'), J(castBefore));
    const state0 = await page.evaluate(() => JSON.stringify(window.__game.state));
    await page.evaluate(() => (window.__writes = {}));
    await recOn(page);
    await page.locator('.g-btn[data-id="to_town"]').click();
    await page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
    const spec = await specOf(page, 'ch2_open');
    const mb = spec.beats.find((b) => b.kind === 'stage' && b.event.id === 'messenger_arrive');
    const rep = mb.event.report;
    const line1 = mb.start + rep.cue.messenger[0][0];
    const lineR = mb.start + rep.cue.retainer[0];
    note(`   台本 ${spec.id}・${spec.duration} 秒・使いの場面 ${mb.start}〜${mb.end}（使いの台詞 ${line1.toFixed(2)}・家臣の台詞 ${lineR.toFixed(2)}）`);
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    // 操作へ戻った後も少し記録（カメラのつなぎ目・後の歩き）
    await sleep(2500);
    const rows = await recOff(page);
    const inCine = rows.filter((r) => r.cine === spec.id && r.ct !== null);
    const msgRows = inCine.filter((r) => r.ev === 'messenger_arrive');
    const pre = inCine.filter((r) => r.ct < mb.start - 0.05);
    check('冒頭の前の場面：使い（envoy）は描かれない（会話の相手にも出来事の人にも居ない）', pre.length > 0 && pre.every((r) => !r.cast.some((m) => m.id === 'envoy') && !r.linked.includes('envoy')), `${pre.length} コマ`);
    check('使いの場面：使いと忠勝は会話の相手そのもの（linked）', msgRows.length > 10 && msgRows.every((r) => r.linked.includes('envoy') && r.linked.includes('tadakatsu')), `${msgRows.length} コマ`);
    check('使いの場面：主人公はずっと町の入口に立つ（隠さない・動かさない）', msgRows.every((r) => Math.abs(r.hx - E.x) < 1e-6 && Math.abs(r.hz - E.z) < 1e-6));
    const envAt = (r) => (r.linkedAt.envoy ? [r.linkedAt.envoy.x, r.linkedAt.envoy.z] : null);
    const atLine = msgRows.filter((r) => r.ct >= line1 - 0.15 && r.ct <= line1 + 0.4 && envAt(r));
    const still = atLine.length >= 2 && atLine.every((r) => Math.hypot(envAt(r)[0] - envAt(atLine[0])[0], envAt(r)[1] - envAt(atLine[0])[1]) < 1e-3);
    check(`使いは最初の台詞（${line1.toFixed(2)} 秒）の前に止まっている・主人公から 1.8〜2.6 m`, still && Math.hypot(envAt(atLine[0])[0] - E.x, envAt(atLine[0])[1] - E.z) > 1.8 && Math.hypot(envAt(atLine[0])[0] - E.x, envAt(atLine[0])[1] - E.z) < 2.6, J(atLine.slice(0, 3).map((r) => [r.ct?.toFixed(2), envAt(r)])));
    const firstEnv = msgRows.find((r) => envAt(r));
    check('使いは木戸の方（主人公の南 3 m より遠く）から来る', !!firstEnv && envAt(firstEnv)[1] - E.z > 3, J(firstEnv && envAt(firstEnv)));
    // 使いの最初の字幕（話し手は使い）は、使いが止まった後（最初の台詞の時刻）から。その前は前の場面の字幕のまま
    const capBefore = inCine.filter((r) => r.ct >= mb.start && r.ct < line1 - 0.1);
    const capAfter = inCine.find((r) => r.ct >= line1 + 0.2);
    check('使いの言葉の字幕は使いが止まってから出る（使いが走って来る間は前の字幕のまま）', capBefore.length > 0 && capBefore.every((r) => r.cap?.speaker !== mb.event.name) && capAfter?.cap?.speaker === mb.event.name, J({ before: capBefore[0]?.cap, after: capAfter?.cap }));
    const tadAt = (r) => (r.linkedAt.tadakatsu ? [r.linkedAt.tadakatsu.x, r.linkedAt.tadakatsu.z] : null);
    const kneelAt = msgRows.find((r) => r.ct >= line1 + 0.7)?.linkedAt.envoy?.kneel ?? 0;
    check('使いは言い始めてから片膝をついている（骨の形。0.7 秒後に 0.95 以上）', kneelAt > 0.95, String(kneelAt));
    const t0 = msgRows[0];
    const tadSpot = rep.retainer.spot;
    check('忠勝は使いの場面の始めに置き場所に居る（瞬間移動しない）', !!t0 && Math.hypot(tadAt(t0)[0] - tadSpot[0], tadAt(t0)[1] - tadSpot[1]) < 0.3, J({ at: tadAt(t0), spot: tadSpot }));
    const nearR = msgRows.filter((r) => r.ct >= lineR - 0.3 && r.ct <= lineR + 0.3);
    check(`忠勝は台詞（${lineR.toFixed(2)} 秒）の前に止まっている・主人公から 1.5〜2.6 m`, nearR.length >= 2 && nearR.every((r) => Math.hypot(tadAt(r)[0] - tadAt(nearR[0])[0], tadAt(r)[1] - tadAt(nearR[0])[1]) < 1e-3) && Math.hypot(tadAt(nearR[0])[0] - E.x, tadAt(nearR[0])[1] - E.z) < 2.6, J(nearR.slice(0, 2).map((r) => tadAt(r))));
    // 記録の間隔（rAF）はページの重さで変わるので、演出の時計の進みで割った速さで見る（走る使いは 3 m/秒）。0.5 m を超える飛びは無いこと
    let maxJump = 0;
    let maxSpeed = 0;
    for (let i = 1; i < msgRows.length; i++) {
        const dt = msgRows[i].ct - msgRows[i - 1].ct;
        for (const id of ['envoy', 'tadakatsu']) {
            const a = msgRows[i - 1].linkedAt[id];
            const b = msgRows[i].linkedAt[id];
            if (!a || !b) continue;
            const d = Math.hypot(b.x - a.x, b.z - a.z);
            maxJump = Math.max(maxJump, d);
            if (dt > 1e-3) maxSpeed = Math.max(maxSpeed, d / dt);
            else if (d > 1e-6) maxSpeed = Infinity;
        }
    }
    check('使いの場面：使い・忠勝は飛ばない（記録の間の動き 0.5 m 未満・演出の時計に対する速さ 3.3 m/秒以下）', maxJump < 0.5 && maxSpeed <= 3.3, `${maxJump.toFixed(3)} m・${maxSpeed.toFixed(2)} m/秒`);
    // 操作へ：カメラは最後の画（肩越し）から切らずに
    const k = rows.findIndex((r) => r.screen === 'explore' && r.cine === null);
    const around = rows.slice(Math.max(0, k - 5), k + 30);
    const step = maxCamStep(around);
    check('操作へ戻るとき、カメラは切らずに肩越しのカメラへ（つなぎ目の前後 1 コマの動き 0.1 m 未満）', k > 0 && step < 0.1, step.toFixed(4));
    const after = rows[rows.length - 1];
    check('操作へ戻った後：使い・忠勝は置き場所へ歩いている（話せない相手）', after.epilogue.includes('envoy') && after.epilogue.includes('tadakatsu'), J(after.epilogue));
    const w = await page.evaluate(() => window.__writes);
    const state1 = await page.evaluate(() => JSON.stringify(window.__game.state));
    check('冒頭の間・後に保存を書かない・状態は冒頭の前と同じ', Object.keys(w).length === 0 && state1 === state0, J(w));
    // 本物の W で忠勝のもとへ（着くまで「話す」は出ない）→ E
    const spot = rep.retainer.spot;
    const walk = await walkTo(page, 'tadakatsu', spot[0], spot[1] + 1.0);
    const epi = await page.evaluate(() => window.__game.event.epilogue);
    check('本物のキーで忠勝のもとへ歩く：歩いている間は「話す」が出ず、置き場所に着いてから出る', walk.ok && walk.early === 0 && !epi.includes('tadakatsu'), J({ walk, epi }));
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, { timeout: 60000, polling: 100 });
    const u = await page.evaluate(() => window.__game.ui);
    check('E で忠勝と話せる（会話が開く）', u?.kind === 'script', J({ kind: u?.kind, speaker: u?.speaker }));
    check('ページの誤りが無い', errors.length === 0, J(errors.slice(0, 3)));
    result.ch2 = { spec: spec.id, duration: spec.duration, messenger: [mb.start, mb.end], line1, lineR, camStep: step, maxJump, walk };
    await ctx.close();
}

// ---------------------------------------------------------------- depart
if (PARTS.includes('depart')) {
    note('== depart：支度の段階 → 本物の W で城門へ → 「出陣する」→ 出陣の演出（号令・見送り）→ 合戦');
    const { ctx, page, errors } = await open();
    await page.evaluate(() => window.__game.setIeyasuPhase('muster', 'oda', undefined, { pledge: 'accept' }));
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    const g = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === 'gate');
    await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [g.x + 0.2, g.z + 2.2]);
    await sleep(1200);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, { timeout: 300000, polling: 100 });
    await page.keyboard.up('KeyW');
    const atGate = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading }));
    for (let i = 0; i < 60; i++) {
        const u = await page.evaluate(() => window.__game.ui);
        if (u?.kind === 'script' && u.choices?.length) break;
        await page.keyboard.press('Enter');
        await sleep(250);
    }
    const persons = (await page.evaluate(() => window.__game.cast)).filter((m) => m.model !== undefined && !['gate', 'notice', 'lookout'].includes(m.id)).map((m) => m.id);
    await recOn(page);
    await page.locator('.g-choice[data-id="depart"]').click();
    await page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
    const spec = await specOf(page, 'departure');
    const ev = spec.beats[0].event;
    await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
    const rows = (await recOff(page)).filter((r) => r.ev === 'column_depart');
    note(`   台本 ${spec.id}・${spec.duration} 秒・号令の終わり ${ev.order} 秒・城門の輪で ${J(atGate)}・会話の相手 ${J(persons)}`);
    check('出陣の演出：号令の終わり（order）が台本にある', typeof ev.order === 'number' && ev.order > 0.8, J(ev));
    check('出陣の場面：会話の相手の人物は隠さない（隠すのは城門の輪だけ）・会話の相手そのもの（linked）', persons.length > 0 && rows.length > 10 && rows.every((r) => r.hidden.length === 1 && r.hidden[0] === 'gate') && rows.some((r) => persons.every((id) => r.linked.includes(id))), J(rows[0] && { persons, hidden: rows[0].hidden, linked: rows[0].linked }));
    // 号令の間（号令の終わりの 0.4 秒前まで）、主人公は演出を始めた所（城門の輪に入って止まった所）から動かない
    const early = rows.filter((r) => r.ct !== null && r.ct < ev.order - 0.4);
    const h0 = early[0];
    check('号令の間、主人公は城門の輪の所に立つ（動かない）', early.length > 2 && Math.hypot(h0.hx - atGate.x, h0.hz - atGate.z) < 0.3 && early.every((r) => Math.hypot(r.hx - h0.hx, r.hz - h0.hz) < 1e-3), J({ frames: early.length, first: [h0?.hx, h0?.hz], atGate }));
    const last = rows[rows.length - 1];
    check('号令の後、主人公は隊列の道（道の真ん中から 1.9 m）の外へ避けて立つ', Math.abs(last.hx) > 1.9, J({ x: last.hx, z: last.hz }));
    check('ページの誤りが無い', errors.length === 0, J(errors.slice(0, 3)));
    result.depart = { spec: spec.id, duration: spec.duration, order: ev.order, atGate, end: { x: last.hx, z: last.hz } };
    await ctx.close();
}

// ---------------------------------------------------------------- shots（手動の描画。実時間ではない）
if (PARTS.includes('shots')) {
    note('== shots：手動の描画（1 コマずつ。実時間ではない）');
    const { ctx, page, errors } = await open('?render=manual', fixture(CH2));
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
    await toCh2Open(page);
    await page.locator('.g-btn[data-id="to_town"]').click();
    await page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
    const spec = await specOf(page, 'ch2_open');
    const mb = spec.beats.find((b) => b.kind === 'stage' && b.event.id === 'messenger_arrive');
    const cue = mb.event.report.cue;
    await pauseAt(mb.start + 0.6, 'c1-messenger-run');
    await pauseAt(mb.start + cue.messenger[0][0] + 0.8, 'c2-messenger-kneel');
    await pauseAt(mb.start + cue.messenger[1][0] + 1.0, 'c3-hero-listens');
    await pauseAt(mb.start + cue.retainer[0] - 1.2, 'c4-retainer-arrives');
    await pauseAt(mb.start + cue.retainer[0] + 1.0, 'c5-retainer-speaks');
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    await sleep(1500);
    await shotAt('c6-control');
    await ctx.close();
    const d = await open('?render=manual');
    const p = d.page;
    const shotD = async (name) => {
        await p.evaluate(() => window.__p3.renderNow());
        await p.screenshot({ path: `${OUT}/${name}.png` });
        note(`   撮影 ${name}.png`);
    };
    await p.evaluate(() => window.__game.setIeyasuPhase('muster', 'oda', undefined, { pledge: 'accept' }));
    await p.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    const g = (await p.evaluate(() => window.__game.cast)).find((m) => m.id === 'gate');
    await p.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [g.x + 0.2, g.z + 2.2]);
    await sleep(800);
    await p.keyboard.down('KeyW');
    await p.waitForFunction(() => window.__game.ui?.kind === 'script', null, { timeout: 300000, polling: 100 });
    await p.keyboard.up('KeyW');
    for (let i = 0; i < 60; i++) {
        const u = await p.evaluate(() => window.__game.ui);
        if (u?.kind === 'script' && u.choices?.length) break;
        await p.keyboard.press('Enter');
        await sleep(250);
    }
    await p.locator('.g-choice[data-id="depart"]').click();
    await p.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
    for (const [t, name] of [
        [0.6, 'd1-order'],
        [3.6, 'd2-step-aside'],
        [7.0, 'd3-send-off'],
    ]) {
        await p.waitForFunction((x) => (window.__game.cine?.t ?? 0) >= x, t, { timeout: 600000, polling: 30 });
        await p.keyboard.press('Space');
        await sleep(200);
        await shotD(name);
        await p.keyboard.press('Space');
    }
    check('撮影のページの誤りが無い', errors.length === 0 && d.errors.length === 0, J([...errors, ...d.errors].slice(0, 3)));
    await d.ctx.close();
}

await browser.close();
note(`\n結果：OK ${passed}・NG ${failed}`);
writeFileSync(`${OUT}/v28-ch2-depart.json`, J({ passed, failed, result }, null, 2));
writeFileSync(`${OUT}/v28-ch2-depart.txt`, lines.join('\n'));
process.exit(failed ? 1 : 0);
