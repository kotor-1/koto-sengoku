/**
 * Version 13 候補の通しの確認（依頼本文【4】【5】。docs/troops-abilities-request.md・docs/troops-abilities-design.md §5）。
 *   BASE3D=http://localhost:8184 node e2e/troops-abilities.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/troops-abilities）
 *   PARTS=input,abilities で一部だけ（既定はどちらも）。KINDS=desktop,phone で端末を絞る（既定はどちらも）。
 *
 * input（本物の入力・通常の速さ。PC 1280×720 とスマホ横 844×390（hasTouch・isMobile））：
 * - タイトル → 合戦場の演習 → 大平原 → 出陣（すべてクリック／タップ）。合戦を始めて「指揮」で止め、「全体」で全体表示。
 * - 見えている兵士（window.__battle.troopStats().visibleSoldiers）が 300 人以上。撮影 <kind>-a1-overview.png。
 * - 点滅の条件（止めたまま）：点滅する名札は徳川の 5 武将だけ（弓隊・騎馬隊・敵は点滅しない）。止めていても明るさが変わる。
 * - 選ぶ：味方 7 部隊を地図の上でそれぞれ押して選べる（兵士の表示が増えても押しやすさは Version 12 のまま）。
 * - 能力（名札の印の本物のクリック／タップ）：騎馬隊を札で選んでおき、家康の印 1 回 → 号令（選択・全部隊の位置と命令は変わらない＝漏れない）。
 *   発動の知らせ（能力名・武将・対象）。止めている間は残り秒数が減らない。忠勝の印を素早く 4 回（CDP で続けて送る）→ 1 回だけ・漏れない。
 *   榊原・酒井も印 1 回。石川は印 → 対象（騎馬隊の体）。使った名札は点滅しない（使用済み）。止めている間、合戦の時刻は進まない。
 * - 命令：移動（地面）・攻撃（「攻撃」→ 敵）・防衛・待機・撤退を、選んだ部隊へボタン・地図の押しで出す。
 * - 再開して交戦まで進め（早送り 40 秒）、寄りの撮影 <kind>-a3-engaged-close.png。
 *
 * abilities（能力の前後の戦況と、兵士の表示が判定を変えないこと）：
 * - ?dev=field&id=plains&render=manual（探索は描かない。合戦は毎フレーム描く。演習と同じ buildBattleSetup(大平原, 'standard')）。徳川の 5 武将ごとに合戦をやり直し（結果の「続ける」→ __fieldDev.run）、
 *   決まった時刻まで早送り（__battle.fastForward。命令の台本は状態を直接操作）→ 止めたまま、命令（地図・ボタンの本物の押し）と
 *   名札の印の本物のクリック／タップで能力を使う（石川は印 → 対象の体）→ 実時間の ×20（__battle.setTimeScale。毎フレーム兵士を描きながら、
 *   合戦は 0.1 秒刻みの台本の道で進む）で見る時刻まで進める。
 * - 同じ台本を、同じページの中で表示なしに進める（dev サーバーの sim・abilities・fields を import した頭だけの合戦＝兵士の表示なし）：
 *   使う（ブラウザと同じ時刻・同じ命令・同じ能力）と、使わない（能力だけ抜く）。
 *   ・ブラウザ（兵士の表示あり・PC は high の段、スマホは low の段。全体表示と寄り（画面外の部隊・LOD が変わる）を交互に）と
 *     頭だけの「使う」が、全部隊の位置・兵・士気・状態・命令と出来事の並びで 1 刻みも同じ ＝ 兵士の表示が判定を変えない。
 *   ・「使う」と「使わない」の戦況の違い（兵・士気・敗走・追い討ちの向き・動きの速さ）を記録する（tests/proto3d-battle-abilities-compare.test.ts と同じ台本）。
 * - 止めたままの名札：使った武将・敗走・撤退済みの武将は点滅しない。使っていない戦える武将だけが点滅する。
 *
 * 確認の種類：
 * - 本物の入力：タイトルから出陣・開始・一時停止・全体・選ぶ・命令・名札の印・対象・連打（CDP の入力）。
 * - 早送り：待つ時間（__battle.fastForward・setTimeScale）。台本の命令（能力の前の決まった命令）は __battle.order ではなく台本の関数で状態へ出す＝状態を直接操作。
 * - カメラ：名札を押す前と撮影に __battle.centerOn（表示だけ。合戦の状態は変えない）。
 * - 実機・性能：コンテナはソフトウェア描画なので、滑らかさ・実機の性能は確かめていない。
 *
 * 記録（2026-09-30。169 項目すべて ok。コンテナの SwiftShader。実機は未確認）：
 * - 兵士の数（タイトルから出陣した演習の大平原・味方 7／敵 7）：
 *   PC（high の段）開始時の全体表示 387 人・描画の呼び出し 18／45 秒後の全体表示 318 人・22／交戦の所への寄り 186 人（画面外 5 部隊）・19。
 *   スマホ相当（low の段）開始時 322 人・18（奥の敵 3 部隊は LOD 60%）／交戦中 265 人・22（兵が減り、騎馬隊は撤退）／寄り 164 人・19。
 * - 兵士の表示が判定を変えない：5 つの台本 × PC・スマホ相当の 10 回すべてで、ブラウザ（兵士を毎フレーム描く・全体表示と寄り・high と low の段）と
 *   同じページの表示なしの合戦が、止めた時刻（69.0〜170.9 秒）まで 14 部隊の位置・兵・士気・状態・命令と出来事の並び・途中の写しで 1 刻みも同じ。
 *   PC とスマホ相当の数字も同じ（下の数字は両方で同じ値）。大平原では、引ききった所でも LOD は PC 100%、スマホ相当 100%／60%。
 * - 能力の前後（使わない → 使う。名札の印の本物のクリック／タップで発動。tests/proto3d-battle-abilities-compare.test.ts の台本と同じ数字）：
 *   ・榊原「先駆けの号」（15.0 秒に敵の先手の横へ）：斬り込む時刻 31.0 → 24.3 秒・先手の敗走 45.0 → 33.7 秒・30 秒の先手の兵 468 → 369・10 秒で動いた距離 30 → 49 m。
 *   ・酒井「両翼の采配」（46.0 秒）：左備が 59.9 秒に「包囲」（使わない時は包囲なし）・左備の敗走 63.0 → 59.9 秒・60 秒の左備の士気 34 → 13。
 *   ・石川「後詰めの差配」（76.0 秒・対象 騎馬隊）：騎馬隊の士気 80 → 100（使った瞬間）・10 秒で動いた距離 58 → 105 m・敵の騎馬の敗走 150.9 → 104.9 秒・
 *     110 秒の敵の騎馬の兵 266 → 131。不適切な対象（敵）を押しても回数は減らない。
 *   ・忠勝「退路の守護」（65.0 秒・榊原隊に撤退を命じて）：榊原隊 敗走 87.4 秒（兵 207）→ 撤退 96.7 秒（兵 285）・忠勝隊へ向きを変えた追っ手 なし → 敵の右備・騎馬・
 *     忠勝隊の 66〜105 秒の損害 76 → 126・忠勝隊の敗走 111.2 → 93.9 秒（無敵ではない）。
 *   ・家康「立て直しの号令」（前線の士気が 45 を切った 70.9 秒）：前線の士気 忠勝 62→100・酒井 45→85・榊原 45→85・弓 75→100（使った瞬間）・
 *     90 秒の前線の士気の平均 43 → 84・150 秒までの前線の敗走 4 → 0・効果中の味方の士気の最低 37（20 未満に下がらない）・使わない時は家康本陣が崩れて負け。
 * - 点滅：開始時は徳川の 5 武将だけ。使った武将・敗走・撤退済み・全滅の武将は点滅せず、使っていない戦える武将だけが点滅（5 台本の終わりで確かめた）。
 *   対象がいない石川（180 m 以内に味方がいない）は、単体テスト（状態を直接操作。tests/proto3d-battle-ability-tap.test.ts）で確かめた。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8184';
const OUT = process.argv[2] || 'e2e-out/troops-abilities';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'input,abilities').split(',');
const KINDS = (process.env.KINDS || 'desktop,phone').split(',');
const failures = [];
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 900000, polling: 500 };
const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const record = {};

const b = await launchBrowser();

async function openPage(kind, url) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(900000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') {
            if (/Couldn't load texture blob:/.test(m.text())) return;
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}${url}`);
    return { ctx, page, phone, kind, t0 };
}

// ---------------------------------------------------------------- 押す・読む

/** シートのボタン（出たばかりのボタンは決まらない：ui/guard.ts）。少し待ってから */
async function sheetPress(p, sel) {
    await p.page.waitForTimeout(450);
    await p.page.locator(sel).first().scrollIntoViewIfNeeded();
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
}
/** 合戦の画面のボタン */
async function press(p, sel, wait = 400) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(wait);
}
async function pointAt(p, x, y, wait = 700) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
/** 素早い連打（CDP で返事を待たずに続けて送る。e2e/ability-ui.mjs と同じ） */
async function rapidTaps(p, x, y, n) {
    const cdp = await p.ctx.newCDPSession(p.page);
    const sent = [];
    for (let k = 0; k < n; k++) {
        const dx = k % 2 ? 2 : 0;
        if (p.phone) {
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + dx, y }] }));
            sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
        } else {
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + dx, y, button: 'left', buttons: 1, clickCount: 1 }));
            sent.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', buttons: 0, clickCount: 1 }));
        }
    }
    await Promise.all(sent);
    await cdp.detach();
}
/** 地図をなぞって動かす（本物の入力） */
async function dragMap(p, x0, y0, x1, y1) {
    if (!p.phone) {
        await p.page.mouse.move(x0, y0);
        await p.page.mouse.down();
        for (let k = 1; k <= 6; k++) await p.page.mouse.move(x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6);
        await p.page.mouse.up();
    } else {
        const cdp = await p.ctx.newCDPSession(p.page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
        for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 6, y: y0 + ((y1 - y0) * k) / 6 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    }
    await p.page.waitForTimeout(700);
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const stats = (page) => page.evaluate(() => window.__battle.troopStats());
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const labelText = (page, id) => page.evaluate((id) => document.querySelector(`.b-label[data-id="${id}"]`)?.textContent ?? '', id);
const readyLabels = (page) => page.evaluate(() => [...document.querySelectorAll('.b-label[data-ab="ready"]')].map((e) => e.dataset.id).sort());
const abOf = (page, id) =>
    page.evaluate((id) => {
        const r = window.__battle.state.abilities[id];
        return r && { usedAt: r.usedAt, until: r.until, targetId: r.targetId ?? null, t: window.__battle.state.t };
    }, id);
const unitOf = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, str: u.strength, mor: u.morale, status: u.status, present: u.present, order: u.order };
    }, id);
const snapshot = (page) =>
    page.evaluate(() => {
        const s = window.__battle.state;
        return { t: s.t, units: s.units.map((u) => ({ id: u.id, x: +u.x.toFixed(3), z: +u.z.toFixed(3), order: JSON.stringify(u.order) })) };
    });
const abilityUses = (page, id) => page.evaluate((id) => window.__battle.state.events.filter((e) => e.kind === 'ability' && e.unitId === id && /「/.test(e.text) && !/先駆けて/.test(e.text) && !/(外れた|戻った|終わった)/.test(e.text)).length, id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const groundXY = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const noteText = (page) => page.evaluate(() => { const n = document.querySelector('.b-abnote'); return n && !n.hidden ? n.textContent : ''; });
const shot = async (p, name) => {
    await p.page.screenshot({ path: `${OUT}/${p.kind}-${name}.png` });
    log(`   撮影 ${p.kind}-${name}.png`);
};
function sameExcept(a, c, except) {
    const bad = [];
    for (const u of a.units) {
        if (except.includes(u.id)) continue;
        const v = c.units.find((x) => x.id === u.id);
        if (!v || v.x !== u.x || v.z !== u.z || v.order !== u.order) bad.push(u.id);
    }
    return bad;
}
/** 画面の部品（左上の列・右上・拡大・札・命令のボタン・案内・一時停止の印）が互いに重ならず、画面からはみ出さない（e2e/ieyasu-battle-ui.mjs と同じ確かめ） */
async function overlapCheck(p, what) {
    const r = await p.page.evaluate(() => {
        const q = (s) => {
            const e = document.querySelector(s);
            if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
            const b = e.getBoundingClientRect();
            return b.width && b.height ? { s, l: b.left, t: b.top, r: b.right, b: b.bottom } : null;
        };
        const boxes = ['.b-topleft', '.b-ctrl', '.b-zoom', '.b-cards', '.b-cmds', '.b-hint', '.b-pausepill'].map(q).filter(Boolean);
        const hits = [];
        for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i];
                const c = boxes[j];
                if (a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1) hits.push(`${a.s}×${c.s}`);
            }
        const out = boxes.filter((x) => x.l < -1 || x.t < -1 || x.r > innerWidth + 1 || x.b > innerHeight + 1).map((x) => x.s);
        return [...hits, ...out];
    });
    check(r.length === 0, `[${p.kind}] ${what}：画面の部品が重ならない・はみ出さない`, r.join(' '));
}
/** 1 フレームの時間（rAF の間の中央値、ms。コンテナのソフトウェア描画） */
async function frameMs(page) {
    return page.evaluate(async () => {
        const ts = [];
        await new Promise((res) => {
            const f = (t) => {
                ts.push(t);
                if (ts.length < 20) requestAnimationFrame(f);
                else res();
            };
            requestAnimationFrame(f);
        });
        const d = [];
        for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
        d.sort((a, c) => a - c);
        return Math.round(d[Math.floor(d.length / 2)]);
    });
}
/** 名札の能力の印を押せる位置へカメラを向ける（表示だけ）→ 印の四角 */
async function badgeOf(p, id, dist) {
    await p.page.evaluate(([id, d]) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        window.__battle.centerOn(u.x, u.z, d);
    }, [id, dist]);
    await p.page.waitForTimeout(700);
    return (await label(p.page, id))?.badge ?? null;
}

// ================================================================ input：タイトルから出陣して、兵士の表示・選ぶ・命令・能力の UI

async function inputPart(kind) {
    log(`== input（${kind}）：タイトル → 合戦場の演習 → 大平原 → 出陣`);
    const p = await openPage(kind, '/?render=manual');
    const { page } = p;
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    log(`[${kind}] タイトルまで ${Date.now() - p.t0} ms`);
    await sheetPress(p, '[data-id="practice"]');
    await page.waitForFunction(() => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === 'practice-list', null, POLL);
    await sheetPress(p, '[data-id="field:plains"]');
    await page.waitForFunction(() => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === 'practice-briefing', null, POLL);
    const t1 = Date.now();
    await sheetPress(p, '.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    log(`[${kind}] 出陣から合戦の画面まで ${Date.now() - t1} ms`);
    const s0 = await page.evaluate(() => ({ map: window.__battle.state.map.id, screen: window.__practice.screen, allies: window.__battle.state.units.filter((u) => u.side === 'ally').length, enemies: window.__battle.state.units.filter((u) => u.side === 'enemy').length }));
    check(s0.map === 'plains' && s0.screen === 'battle' && s0.allies === 7 && s0.enemies === 7, `[${kind}] 演習の大平原の合戦（味方 7・敵 7）`, JSON.stringify(s0));
    await press(p, '.b-primary', 500);
    await press(p, '.b-pause', 500);
    check((await ui(page)).paused === true, `[${kind}] 開始して「指揮（一時停止）」で止めた`);
    await press(p, '.b-zall', 900);

    // ---- 兵士 300 人以上 ----
    const st = await stats(page);
    const fm = await frameMs(page);
    record[`input-${kind}`] = { tier: st.tier, visibleSoldiers: st.visibleSoldiers, drawCalls: st.drawCalls, culled: st.culledUnits.length, frameMs: fm, perUnit: st.perUnit };
    check(st.visibleSoldiers >= 300, `[${kind}] 全体表示で見えている兵士が 300 人以上`, `${st.visibleSoldiers} 人（段 ${st.tier}・描画の呼び出し ${st.drawCalls}・1 フレーム ${fm} ms）`);
    // 部隊ごとの人数：LOD 100% の部隊は 20〜40 人（low の段は 18〜34 人）。奥の部隊は LOD で 60%・35% に減る（スマホ相当の全体表示では敵の奥が 60%）
    const ids = Object.keys(st.perUnit);
    const nLo = st.tier === 'low' ? 18 : 20;
    const nHi = st.tier === 'low' ? 34 : 40;
    const badN = ids.filter((id) => { const n = st.perUnit[id]; const l = st.lodByUnit[id]; return l === 1 ? n < nLo || n > nHi : n > Math.ceil(nHi * l) || n < Math.floor(nLo * l) - 1; });
    check(ids.length === 14 && badN.length === 0, `[${kind}] 14 部隊の人数（LOD 100% は ${nLo}〜${nHi} 人・奥は LOD の割合）`, ids.map((id) => `${st.perUnit[id]}${st.lodByUnit[id] < 1 ? `(${Math.round(st.lodByUnit[id] * 100)}%)` : ''}`).join(','));
    await shot(p, 'a1-overview');

    // ---- 点滅の条件（止めたまま） ----
    if (p.phone) {
        // 全体表示では南の石川隊の名札が下の案内の帯に隠れるので、1 本指で地図を少し上へずらす（本物のなぞり）
        await dragMap(p, 430, 200, 430, 150);
    }
    const ready = await readyLabels(page);
    check(JSON.stringify(ready) === JSON.stringify([...GENERALS].sort()), `[${kind}] 点滅する名札は徳川の 5 武将だけ（弓隊・騎馬隊・敵は点滅しない）`, ready.join(','));
    const samples = [];
    for (let i = 0; i < 8; i++) {
        samples.push((await label(page, 'a_ieyasu')).blink);
        await page.waitForTimeout(300);
    }
    const lo = Math.min(...samples);
    const hi = Math.max(...samples);
    check(lo >= 0.55 - 1e-6 && hi <= 1 + 1e-6 && hi - lo > 0.1, `[${kind}] 止めている間も点滅する（明るさ ${lo.toFixed(2)}〜${hi.toFixed(2)}）`);
    await shot(p, 'a2-blink-paused');

    // ---- 選ぶ：味方 7 部隊を地図の上で押して選ぶ ----
    await press(p, '.b-zall', 900);
    const allyIds = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => u.id));
    let pickOk = 0;
    for (const id of allyIds) {
        const q = await screenOf(page, id);
        await pointAt(p, q.x, q.y, 350);
        const sel = (await ui(page)).selectedId;
        if (sel === id) pickOk++;
        else log(`    ${id} を押して ${sel} が選ばれた`);
    }
    check(pickOk === allyIds.length, `[${kind}] 兵士を描いた全体表示で、味方 7 部隊を地図の上でそれぞれ押して選べる`, `${pickOk}/${allyIds.length}`);
    check(JSON.stringify(await readyLabels(page)) === JSON.stringify([...GENERALS].sort()), `[${kind}] 部隊の体を押して選んでも能力は使わない（5 武将とも点滅のまま）`);
    if (p.phone) await dragMap(p, 430, 200, 430, 150);

    // ---- 能力：騎馬隊を選んでおき、名札の印を押す ----
    await press(p, '.b-card[data-id="a_kiba"]');
    check((await ui(page)).selectedId === 'a_kiba', `[${kind}] 騎馬隊を札で選ぶ`);
    const tPaused = (await snapshot(page)).t;
    let before = await snapshot(page);
    const moraleBefore = await page.evaluate(() => Object.fromEntries(window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => [u.id, Math.round(u.morale)])));
    const bIe = (await label(page, 'a_ieyasu')).badge;
    await pointAt(p, bIe.x, bIe.y, 300);
    // 発動の知らせ（2.5 秒）が出ている間に読んで撮る
    const n1 = await noteText(page);
    await shot(p, 'a4-rally-notice');
    let after = await snapshot(page);
    check((await abOf(page, 'a_ieyasu')).usedAt !== null, `[${kind}] 家康の印を 1 回押す → 立て直しの号令`);
    const u1 = await ui(page);
    check(u1.selectedId === 'a_kiba' && u1.pending === 'none' && sameExcept(before, after, []).length === 0, `[${kind}] 選択（騎馬隊）・全部隊の位置と命令は変わらない（地面の移動・部隊の選択に漏れない）`, `${u1.selectedId} ${u1.pending}`);
    check(n1.includes('立て直しの号令') && n1.includes('徳川家康') && n1.includes('対象'), `[${kind}] 発動の知らせ：能力名・武将・対象`, n1);
    const moraleAfter = await page.evaluate(() => Object.fromEntries(window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => [u.id, Math.round(u.morale)])));
    log(`    号令の前後の士気（止めたまま）：${allyIds.map((id) => `${id} ${moraleBefore[id]}→${moraleAfter[id]}`).join('・')}`);
    const rem1 = await labelText(page, 'a_ieyasu');
    await page.waitForTimeout(2500);
    const rem2 = await labelText(page, 'a_ieyasu');
    check((await label(page, 'a_ieyasu')).ab === 'active' && /残り 35 秒/.test(rem1) && rem1 === rem2, `[${kind}] 使った家康の名札は点滅をやめ、止めている間は「残り 35 秒」のまま`, `${rem1} / ${rem2}`);

    // 使った名札の所をもう一度押す（守りの 0.5 秒より後）→ 2 回目は使えない（名札の名前 → 家康本陣の選択になるだけ）
    await pointAt(p, bIe.x, bIe.y);
    check((await abilityUses(page, 'a_ieyasu')) === 1, `[${kind}] 使った後に家康の名札をもう一度押しても 2 回目は発動しない`, `選択 ${(await ui(page)).selectedId}`);
    await press(p, '.b-card[data-id="a_kiba"]');

    // 忠勝：連打
    before = await snapshot(page);
    const bTd = (await label(page, 'a_tadakatsu')).badge;
    await rapidTaps(p, bTd.x, bTd.y, 4);
    await page.waitForTimeout(900);
    after = await snapshot(page);
    check((await abOf(page, 'a_tadakatsu')).usedAt !== null && (await abilityUses(page, 'a_tadakatsu')) === 1, `[${kind}] 忠勝の印を素早く 4 回 → 退路の守護は 1 回だけ`);
    check(sameExcept(before, after, ['a_tadakatsu']).length === 0 && (await ui(page)).selectedId === 'a_kiba', `[${kind}] 連打でも、ほかの部隊の位置・命令と選択（騎馬隊）は変わらない`);

    // 榊原・酒井：印 1 回
    for (const id of ['a_sakakibara', 'a_sakai']) {
        before = await snapshot(page);
        const bb = (await label(page, id)).badge;
        await pointAt(p, bb.x, bb.y);
        after = await snapshot(page);
        check((await abOf(page, id)).usedAt !== null && sameExcept(before, after, []).length === 0 && (await ui(page)).selectedId === 'a_kiba', `[${kind}] ${id} の印を 1 回 → 発動（位置・命令・選択は変わらない）`);
    }
    await shot(p, 'a5-four-used');

    // 石川：印 → 対象（騎馬隊の体）
    const bIs = (await label(page, 'a_ishikawa')).badge;
    await pointAt(p, bIs.x, bIs.y);
    let u = await ui(page);
    check(u.pending === 'ability' && u.selectedId === 'a_ishikawa' && (await abOf(page, 'a_ishikawa')).usedAt === null, `[${kind}] 石川の印 → 対象選び（まだ使わない）`);
    const marks = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.b-label[data-id]')].map((e) => [e.dataset.id, e.dataset.ab ?? ''])));
    check(marks.a_kiba === 'target' && marks.e_sente === 'untargetable', `[${kind}] 選べる部隊（騎馬隊）と選べない部隊（敵）の印`, `${marks.a_kiba}/${marks.e_sente}`);
    check((await hintText(page)).length > 0, `[${kind}] 対象選びの案内`, await hintText(page));
    await overlapCheck(p, '石川の対象選び（能力の欄と案内）');
    await shot(p, 'a6-ishikawa-choose');
    before = await snapshot(page);
    const kb = await screenOf(page, 'a_kiba');
    await pointAt(p, kb.x, kb.y);
    after = await snapshot(page);
    const res = await abOf(page, 'a_ishikawa');
    check(res.usedAt !== null && res.targetId === 'a_kiba' && (await ui(page)).pending === 'none', `[${kind}] 騎馬隊を押す → 後詰めの差配（対象 騎馬隊）`);
    check(sameExcept(before, after, ['a_ishikawa']).length === 0, `[${kind}] 対象を押したタップは騎馬隊の移動・命令に漏れない`);
    const n2 = await noteText(page);
    check(n2.includes('後詰めの差配') && n2.includes('石川数正') && n2.includes('徳川騎馬隊'), `[${kind}] 発動の知らせ：能力名・武将・対象（騎馬隊）`, n2);
    check((await readyLabels(page)).length === 0, `[${kind}] 5 武将を使った後は、点滅する名札が無い（使用済み）`);
    await overlapCheck(p, '石川の差配の効果中（能力の欄）');
    check((await snapshot(page)).t === tPaused, `[${kind}] 止めている間は合戦の時刻が進まない（${tPaused.toFixed(1)} 秒のまま）`);

    // ---- 命令：移動・攻撃・防衛・撤退（兵士を描いた地図の上で） ----
    await press(p, '.b-zall', 900);
    // 移動：騎馬隊（選択中）で地面を押す
    await press(p, '.b-card[data-id="a_kiba"]');
    let g = await groundXY(page, -150, 40);
    await pointAt(p, g.x, g.y);
    let o = (await unitOf(page, 'a_kiba')).order;
    check(o.type === 'move' && Math.abs(o.x + 150) < 10 && Math.abs(o.z - 40) < 10, `[${kind}] 移動：騎馬隊を選んで地面を押す`, JSON.stringify(o));
    // 攻撃：弓隊を地図で選ぶ →「攻撃」→ 敵の先手を押す
    let q = await screenOf(page, 'a_yumi');
    await pointAt(p, q.x, q.y);
    check((await ui(page)).selectedId === 'a_yumi', `[${kind}] 弓隊を地図の上で押して選ぶ`);
    await press(p, '.b-cmd:has-text("攻撃")');
    check((await ui(page)).pending === 'attack', `[${kind}] 「攻撃」で敵を選ぶ待ち`);
    q = await screenOf(page, 'e_sente');
    await pointAt(p, q.x, q.y);
    o = (await unitOf(page, 'a_yumi')).order;
    check(o.type === 'attack' && o.targetId === 'e_sente', `[${kind}] 攻撃：敵の先手を押す`, JSON.stringify(o));
    // 防衛・待機：酒井隊
    q = await screenOf(page, 'a_sakai');
    await pointAt(p, q.x, q.y);
    await press(p, '.b-cmd:has-text("防衛・待機")');
    o = (await unitOf(page, 'a_sakai')).order;
    check((await ui(page)).selectedId === 'a_sakai' && o.type === 'hold', `[${kind}] 防衛・待機：酒井隊`, JSON.stringify(o));
    // 撤退：騎馬隊を札で選んで「撤退」
    await press(p, '.b-card[data-id="a_kiba"]');
    await press(p, '.b-cmd:has-text("撤退")');
    o = (await unitOf(page, 'a_kiba')).order;
    check(o.type === 'retreat', `[${kind}] 撤退：騎馬隊`, JSON.stringify(o));
    await shot(p, 'a7-orders');

    // ---- 再開 → 交戦（早送り）→ 寄りの撮影 ----
    await press(p, '.b-pause', 500);
    check((await ui(page)).paused === false, `[${kind}] 「指揮」で再開`);
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__battle.fastForward(40));
    await press(p, '.b-pause', 500);
    await press(p, '.b-zall', 1200);
    const st2 = await stats(page);
    record[`input-${kind}`].engaged = { visibleSoldiers: st2.visibleSoldiers, drawCalls: st2.drawCalls, frameMs: await frameMs(page) };
    // 交戦中は兵が減り、騎馬隊は撤退で戦場を離れる。PC は 300 人以上を確かめ、スマホ相当（low の段・奥の敵は LOD 60%）は記録だけ
    if (p.phone) log(`    交戦中の全体表示：見えている兵士 ${st2.visibleSoldiers} 人（描画の呼び出し ${st2.drawCalls}）`);
    else check(st2.visibleSoldiers >= 300, `[${kind}] 交戦中の全体表示でも見えている兵士が 300 人以上`, `${st2.visibleSoldiers} 人（描画の呼び出し ${st2.drawCalls}）`);
    await shot(p, 'a3-engaged');
    const front = await page.evaluate(() => {
        const e = window.__battle.state.units.filter((u) => u.engagedWith && u.present);
        const u = e[0] ?? window.__battle.state.units.find((x) => x.id === 'a_tadakatsu');
        return { x: u.x, z: u.z, n: e.length };
    });
    await page.evaluate(([x, z]) => window.__battle.centerOn(x, z - 5, 110), [front.x, front.z]);
    await page.waitForTimeout(1500);
    const st3 = await stats(page);
    log(`    寄り：交戦中の部隊 ${front.n}・見えている兵士 ${st3.visibleSoldiers}・画面外 ${st3.culledUnits.length} 部隊・描画の呼び出し ${st3.drawCalls}`);
    record[`input-${kind}`].close = { visibleSoldiers: st3.visibleSoldiers, culled: st3.culledUnits.length, drawCalls: st3.drawCalls };
    await shot(p, 'a3-engaged-close');
    // 寄りでも部隊を押して選べる
    const near = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally' && u.present && u.status === 'ready').map((u) => u.id));
    let nearOk = 0;
    let nearTried = 0;
    for (const id of near) {
        const qq = await screenOf(page, id);
        const vw = page.viewportSize();
        if (!qq.shown || qq.x < 60 || qq.y < 80 || qq.x > vw.width - 60 || qq.y > vw.height - 110) continue;
        nearTried++;
        await pointAt(p, qq.x, qq.y, 350);
        if ((await ui(page)).selectedId === id) nearOk++;
    }
    check(nearTried === 0 || nearOk === nearTried, `[${kind}] 寄りの交戦中も、画面の中の味方を押して選べる`, `${nearOk}/${nearTried}`);
    await p.ctx.close();
}

// ================================================================ abilities：能力の前後の戦況・表示なしとの一致

/** 同じページの中に、表示なしの合戦（頭だけ）を進める道具を置く（dev サーバーの模块を import） */
async function installHeadless(page) {
    await page.evaluate(async () => {
        const sim = await import('/src/battle/sim.ts');
        const ab = await import('/src/battle/abilities.ts');
        const fields = await import('/src/battle/fields/index.ts');
        const snapUnits = (s) => s.units.map((u) => ({ id: u.id, x: u.x, z: u.z, str: u.strength, mor: u.morale, st: u.status, present: u.present, order: JSON.stringify(u.order) }));
        /**
         * 台本：steps（[秒, 部隊, 命令]）を時刻が来たら 1 回ずつ出し、snaps の時刻に全部隊を写し、毎刻み watch(s, rec) を呼ぶ。
         * issue は命令の出し方（ブラウザでは __battle.order、頭だけでは sim.issueOrder）
         */
        const mkScript = (steps, snaps, rec, issue, watch) => {
            const q = steps.map((x) => ({ t: x[0], id: x[1], order: x[2], done: false }));
            return (s) => {
                for (const st of q)
                    if (!st.done && s.t >= st.t - 1e-9) {
                        st.done = true;
                        issue(s, st.id, st.order);
                    }
                for (const k of snaps) if (!rec.snaps[k] && s.t >= k - 1e-9) rec.snaps[k] = snapUnits(s);
                if (watch) watch(s, rec);
            };
        };
        /** 決まった見張り：包囲された敵・号令の効果中の味方の士気の最低 */
        const watch = (s, rec) => {
            for (const id of s.encircled ?? []) if (!(id in rec.encircledAt)) rec.encircledAt[id] = s.t;
            const r = s.abilities.a_ieyasu;
            if (r && r.usedAt !== null && s.t < r.until) {
                for (const u of s.units) if (u.side === 'ally' && sim.isActive(u)) rec.minAllyMoraleInRally = Math.min(rec.minAllyMoraleInRally, u.morale);
            }
        };
        const newRec = () => ({ snaps: {}, encircledAt: {}, minAllyMoraleInRally: 999 });
        /**
         * 頭だけで大平原（'standard'）を進める。actions：[{ t, kind: 'order'|'ability', id, order?, target? }]（時刻が来たら、台本より先に出す＝ブラウザで止めて押した順）。
         * end まで（または決着まで）
         */
        const run = ({ steps, snaps, actions, end }) => {
            const s = sim.createBattle(fields.buildBattleSetup(fields.getField('plains'), 'standard'));
            const rec = newRec();
            const sc = mkScript(steps, snaps, rec, (s, id, o) => sim.issueOrder(s, id, o), watch);
            const acts = actions.map((a) => ({ ...a, done: false }));
            const log = [];
            while (!s.result && s.t < end - 1e-9) {
                for (const a of acts)
                    if (!a.done && s.t >= a.t - 1e-9) {
                        a.done = true;
                        if (a.kind === 'order') log.push(sim.issueOrder(s, a.id, a.order));
                        else log.push(ab.useAbility(s, a.id, a.target ?? undefined).ok);
                    }
                sc(s);
                sim.stepBattle(s, 0.1);
            }
            return { t: s.t, units: snapUnits(s), events: s.events.map((e) => `${e.t.toFixed(1)}|${e.kind}|${e.unitId ?? ''}|${e.targetId ?? ''}|${e.text}`), rec, result: s.result ? { result: s.result.result, reason: s.result.reason } : null, actionsOk: log };
        };
        window.__h = { run, mkScript, watch, newRec, snapUnits, sim, ab };
    });
}

/** ブラウザの合戦に台本を置く（fastForward と setScript が同じ関数を使う。命令は __battle.order＝状態を直接操作） */
async function installScript(page, steps, snaps) {
    await page.evaluate(([steps, snaps]) => {
        window.__rec = window.__h.newRec();
        window.__sc = window.__h.mkScript(steps, snaps, window.__rec, (_s, id, o) => window.__battle.order(id, o), window.__h.watch);
    }, [steps, snaps]);
}
const ffTo = (page, t) => page.evaluate((t) => window.__battle.fastForward(Math.max(0, t - window.__battle.state.t), window.__sc), t);

/** 合戦を始めて、1 刻みも進めずに止める（本物のクリック／タップで開始・一時停止。その間だけ時の進みを 0 にする） */
async function startPaused(p) {
    await p.page.evaluate(() => {
        window.__battle.setScript(() => {});
        window.__battle.setTimeScale(0);
    });
    await press(p, '.b-primary', 400);
    await press(p, '.b-pause', 400);
    const u = await ui(p.page);
    const t = await p.page.evaluate(() => window.__battle.state.t);
    check(u.started && u.paused && t === 0, `[${p.kind}] 開始して止めた（合戦の時刻 0）`);
}
/** 実時間 ×20 で end まで（毎フレーム兵士を描く。合戦は 0.1 秒刻みの台本の道）。途中で兵士の表示の数を写す */
async function realtimeTo(p, end, cam) {
    const { page } = p;
    await page.evaluate(() => {
        window.__battle.setScript(window.__sc);
        window.__battle.setTimeScale(20);
    });
    if (cam === 'fit') await press(p, '.b-zall', 300);
    // いちばん引いた所（奥の部隊の LOD が 60%・35% に落ちる）
    else if (cam === 'far') await page.evaluate(() => window.__battle.centerOn(0, 0, window.__battle.camera.maxDist));
    else await page.evaluate(([id]) => { const u = window.__battle.state.units.find((x) => x.id === id); window.__battle.centerOn(u.x, u.z, 90); }, [cam]);
    await press(p, '.b-pause', 100);
    const seen = [];
    const t0 = Date.now();
    for (;;) {
        const r = await page.evaluate(() => {
            const s = window.__battle.state;
            const st = window.__battle.troopStats();
            return { t: s.t, result: !!s.result, vis: st.visibleSoldiers, culled: st.culledUnits.length, lods: [...new Set(Object.values(st.lodByUnit).map((x) => Math.round(x * 100)))].sort() };
        });
        seen.push(r);
        if (r.t >= end - 1e-9 || r.result || Date.now() - t0 > 600000) break;
        await page.waitForTimeout(150);
    }
    await press(p, '.b-pause', 300);
    await page.evaluate(() => window.__battle.setTimeScale(1));
    const t = await page.evaluate(() => window.__battle.state.t);
    const vis = seen.map((x) => x.vis);
    return { t, frames: seen.length, visMin: Math.min(...vis), visMax: Math.max(...vis), culledMax: Math.max(...seen.map((x) => x.culled)), lods: [...new Set(seen.flatMap((x) => x.lods))].sort() };
}
/** 今の合戦を終えて（全軍撤退・早送り → 結果の「続ける」を押す）、大平原をもう一度始める */
async function restart(p) {
    const { page } = p;
    await page.evaluate(() => {
        window.__battle.setScript(null);
        window.__battle.allRetreat();
    });
    for (let i = 0; i < 12 && !(await page.evaluate(() => window.__battle.state.result)); i++) await page.evaluate(() => window.__battle.fastForward(60));
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    await press(p, '.b-modal .b-primary', 600);
    await page.waitForFunction(() => !window.__battle.active, null, POLL);
    await page.evaluate(() => {
        void window.__fieldDev.run('plains', 'standard');
    });
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.state.t === 0 && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await page.waitForTimeout(500);
}
/** ブラウザの合戦の今の状態（頭だけの run と同じ形） */
const browserState = (page) =>
    page.evaluate(() => {
        const s = window.__battle.state;
        return { t: s.t, units: window.__h.snapUnits(s), events: s.events.map((e) => `${e.t.toFixed(1)}|${e.kind}|${e.unitId ?? ''}|${e.targetId ?? ''}|${e.text}`), rec: window.__rec, result: s.result ? { result: s.result.result, reason: s.result.reason } : null };
    });
const headless = (page, spec) => page.evaluate((spec) => window.__h.run(spec), spec);
/** ブラウザ（兵士の表示あり）と頭だけの合戦が 1 刻みも同じか */
function sameRun(kind, name, br, hd) {
    const bu = JSON.stringify(br.units);
    const hu = JSON.stringify(hd.units);
    let firstDiff = '';
    if (bu !== hu) {
        for (let i = 0; i < br.units.length; i++) if (JSON.stringify(br.units[i]) !== JSON.stringify(hd.units[i])) { firstDiff = `${JSON.stringify(br.units[i])} ≠ ${JSON.stringify(hd.units[i])}`; break; }
    }
    const be = br.events.join('\n');
    const he = hd.events.join('\n');
    const snapsSame = JSON.stringify(br.rec.snaps) === JSON.stringify(hd.rec.snaps);
    check(br.t === hd.t && bu === hu && be === he && snapsSame, `[${kind}] ${name}：兵士の表示ありのブラウザと表示なしの合戦が 1 刻みも同じ（${br.t.toFixed(1)} 秒・14 部隊の位置・兵・士気・状態・命令、出来事 ${br.events.length} 件、途中の写し）`, firstDiff || (be !== he ? '出来事が違う' : snapsSame ? '' : '途中の写しが違う'));
}
const ev = (run, kind, unitId) => {
    const e = run.events.find((x) => { const [, k, u] = x.split('|'); return k === kind && u === unitId; });
    return e ? Number(e.split('|')[0]) : null;
};
const engageT = (run, unitId) => {
    const e = run.events.find((x) => { const [, k, u, t] = x.split('|'); return k === 'engage' && (u === unitId || t === unitId); });
    return e ? Number(e.split('|')[0]) : null;
};
const uAt = (run, t, id) => run.rec.snaps[t]?.find((u) => u.id === id);
const uEnd = (run, id) => run.units.find((u) => u.id === id);
const r0 = (x) => (x === null || x === undefined ? '—' : Math.round(x));
const r1 = (x) => (x === null || x === undefined ? '—' : x.toFixed(1));

/** 止めたままの名札：使っていない戦える武将だけが点滅する（使った・敗走・撤退済みは点滅しない） */
async function blinkRule(p, name) {
    const r = await p.page.evaluate((gens) => {
        const s = window.__battle.state;
        const want = gens.filter((id) => {
            const u = s.units.find((x) => x.id === id);
            return u && u.present && u.status === 'ready' && s.abilities[id]?.usedAt === null;
        });
        const why = gens.map((id) => { const u = s.units.find((x) => x.id === id); return `${id}:${u.status}${u.present ? '' : '(不在)'}${s.abilities[id]?.usedAt !== null ? '・使用済み' : ''}`; });
        return { want: want.sort(), why };
    }, GENERALS);
    await p.page.waitForTimeout(400);
    const got = await readyLabels(p.page);
    check(JSON.stringify(got) === JSON.stringify(r.want), `[${p.kind}] ${name}：点滅は、使っていない戦える武将だけ`, `点滅 ${got.join(',') || 'なし'}／${r.why.join(' ')}`);
    return r.why;
}

async function useByLabel(p, id, dist) {
    const bb = await badgeOf(p, id, dist);
    check(!!bb, `[${p.kind}] ${id} の名札に能力の印がある`);
    if (!bb) return null;
    const before = await snapshot(p.page);
    await pointAt(p, bb.x, bb.y);
    const after = await snapshot(p.page);
    return { before, after };
}
/** 部隊を地図の上で押して選び、ボタンで命令する（攻撃は敵を押す）。出た命令を返す */
async function orderByInput(p, id, cmd, targetId) {
    const { page } = p;
    await page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); window.__battle.centerOn(u.x, u.z, 220); }, id);
    await page.waitForTimeout(600);
    const q = await screenOf(page, id);
    await pointAt(p, q.x, q.y, 400);
    check((await ui(page)).selectedId === id, `[${p.kind}] ${id} を地図の上で押して選ぶ`);
    if (cmd === 'attack') {
        await press(p, '.b-cmd:has-text("攻撃")');
        // 相手の所へカメラを向ける（表示だけ。攻撃の相手を選ぶ待ちはそのまま）
        await page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); window.__battle.centerOn(u.x, u.z, 220); }, targetId);
        await page.waitForTimeout(600);
        const e = await screenOf(page, targetId);
        check(e && e.shown, `[${p.kind}] ${targetId} が見えている`);
        await pointAt(p, e.x, e.y, 400);
    } else if (cmd === 'retreat') await press(p, '.b-cmd:has-text("撤退")');
    const o = (await unitOf(page, id)).order;
    check(o.type === cmd && (cmd !== 'attack' || o.targetId === targetId), `[${p.kind}] ${id}：${cmd === 'attack' ? `攻撃（${targetId}）` : '撤退'} の命令（本物の入力）`, JSON.stringify(o));
    return o;
}

async function abilitiesPart(kind) {
    log(`== abilities（${kind}）：徳川 5 武将の能力の前後と、兵士の表示の有無`);
    const p = await openPage(kind, '/?dev=field&id=plains&render=manual');
    const { page } = p;
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    log(`[${kind}] 合戦の画面まで ${Date.now() - p.t0} ms`);
    await installHeadless(page);
    const tier = (await stats(page)).tier;
    const out = (record[`abilities-${kind}`] = { tier, scenarios: {} });
    const sc = [];

    // ---------------- 1. 榊原「先駆けの号」：15 秒に敵の先手の横へ急襲（忠勝隊が正面で受ける） ----------------
    {
        const name = '榊原「先駆けの号」';
        const steps = [];
        const snaps = [25, 30];
        await installScript(page, steps, snaps);
        await startPaused(p);
        await ffTo(page, 15);
        const t = await page.evaluate(() => window.__battle.state.t);
        const s0 = await unitOf(page, 'a_sakakibara');
        const o = await orderByInput(p, 'a_sakakibara', 'attack', 'e_sente');
        const r = await useByLabel(p, 'a_sakakibara', 260);
        const a = await abOf(page, 'a_sakakibara');
        check(a.usedAt !== null && sameExcept(r.before, r.after, []).length === 0, `[${kind}] ${name}：榊原の印を 1 回押して発動（ほかの命令に漏れない）`);
        await shot(p, 'c1-sakakibara-use');
        const rt = await realtimeTo(p, 50, 'a_sakakibara');
        await shot(p, 'c1-sakakibara-after');
        const br = await browserState(page);
        const actions = [{ t, kind: 'order', id: 'a_sakakibara', order: o }, { t, kind: 'ability', id: 'a_sakakibara' }];
        const on = await headless(page, { steps, snaps, actions, end: br.t });
        const off = await headless(page, { steps, snaps, actions: actions.slice(0, 1), end: 80 });
        sameRun(kind, name, br, on);
        const dist = (run) => { const a25 = uAt(run, 25, 'a_sakakibara'); return a25 ? Math.hypot(a25.x - s0.x, a25.z - s0.z) : null; };
        const m = {
            usedAt: t,
            contact: [engageT(off, 'a_sakakibara'), engageT(br, 'a_sakakibara')],
            senteRout: [ev(off, 'rout', 'e_sente'), ev(br, 'rout', 'e_sente')],
            senteStr30: [uAt(off, 30, 'e_sente')?.str, uAt(br, 30, 'e_sente')?.str],
            moved25: [dist(off), dist(br)],
            from: { x: Math.round(s0.x), z: Math.round(s0.z) },
        };
        out.scenarios.sakakibara = { ...m, realtime: rt };
        log(`    ${name}（${r1(t)} 秒）：斬り込む時刻 ${r1(m.contact[0])} → ${r1(m.contact[1])} 秒・敵の先手の敗走 ${r1(m.senteRout[0])} → ${r1(m.senteRout[1])} 秒・30 秒の先手の兵 ${r0(m.senteStr30[0])} → ${r0(m.senteStr30[1])}・15〜25 秒に動いた距離 ${r0(m.moved25[0])} → ${r0(m.moved25[1])} m`);
        log(`      表示：${rt.frames} 回読んだ・兵士 ${rt.visMin}〜${rt.visMax} 人・画面外の部隊 最大 ${rt.culledMax}・LOD ${rt.lods.join('/')}%`);
        check(m.contact[1] !== null && m.contact[1] < m.contact[0] - 4, `[${kind}] ${name}：速く当たる（斬り込む時刻が 4 秒以上早い）`);
        check(m.senteRout[1] !== null && (m.senteRout[0] === null || m.senteRout[1] < m.senteRout[0] - 5), `[${kind}] ${name}：敵の先手が早く崩れる`);
        sc.push(await blinkRule(p, name));
    }

    // ---------------- 2. 酒井「両翼の采配」：地形に合った作戦の前半、46 秒に使う（酒井隊の正面と騎馬の横で左備を挟む） ----------------
    {
        const name = '酒井「両翼の采配」';
        await restart(p);
        const steps = [[0, 'a_yumi', { type: 'attack', targetId: 'e_sente' }], [0, 'a_kiba', { type: 'move', x: -160, z: -20 }], [45, 'a_kiba', { type: 'attack', targetId: 'e_left' }], [80, 'a_ishikawa', { type: 'attack', targetId: 'e_kiba' }]];
        const snaps = [60];
        await installScript(page, steps, snaps);
        await startPaused(p);
        await ffTo(page, 46);
        const t = await page.evaluate(() => window.__battle.state.t);
        const r = await useByLabel(p, 'a_sakai', 300);
        check((await abOf(page, 'a_sakai')).usedAt !== null && sameExcept(r.before, r.after, []).length === 0, `[${kind}] ${name}：酒井の印を 1 回押して発動（ほかの命令に漏れない）`);
        await shot(p, 'c2-sakai-use');
        const rt = await realtimeTo(p, 66, 'far');
        await shot(p, 'c2-sakai-after');
        const br = await browserState(page);
        const actions = [{ t, kind: 'ability', id: 'a_sakai' }];
        const on = await headless(page, { steps, snaps, actions, end: br.t });
        const off = await headless(page, { steps, snaps, actions: [], end: 90 });
        sameRun(kind, name, br, on);
        const m = {
            usedAt: t,
            encircledAt: br.rec.encircledAt.e_left ?? null,
            encircledOff: off.rec.encircledAt.e_left ?? null,
            leftRout: [ev(off, 'rout', 'e_left'), ev(br, 'rout', 'e_left')],
            leftMor60: [uAt(off, 60, 'e_left')?.mor, uAt(br, 60, 'e_left')?.mor],
            leftStr60: [uAt(off, 60, 'e_left')?.str, uAt(br, 60, 'e_left')?.str],
        };
        out.scenarios.sakai = { ...m, realtime: rt };
        log(`    ${name}（${r1(t)} 秒）：敵の左備が包囲された時刻 ${r1(m.encircledAt)} 秒（使わない時 ${m.encircledOff === null ? '包囲なし' : r1(m.encircledOff)}）・左備の敗走 ${r1(m.leftRout[0])} → ${r1(m.leftRout[1])} 秒・60 秒の左備の士気 ${r0(m.leftMor60[0])} → ${r0(m.leftMor60[1])}・兵 ${r0(m.leftStr60[0])} → ${r0(m.leftStr60[1])}`);
        log(`      表示：${rt.frames} 回読んだ・兵士 ${rt.visMin}〜${rt.visMax} 人・画面外の部隊 最大 ${rt.culledMax}・LOD ${rt.lods.join('/')}%`);
        check(m.encircledAt !== null && m.encircledOff === null, `[${kind}] ${name}：挟んだ左備が「包囲」になる（使わない時はならない）`);
        check(m.leftRout[1] !== null && m.leftRout[1] < m.leftRout[0] - 2 && m.leftMor60[1] < m.leftMor60[0] - 15, `[${kind}] ${name}：左備が早く崩れ、士気が大きく落ちる`);
        sc.push(await blinkRule(p, name));
    }

    // ---------------- 3. 石川「後詰めの差配」：76 秒、林から出た敵の騎馬へ予備の騎馬を当て、石川が騎馬を選んで急がせる ----------------
    {
        const name = '石川「後詰めの差配」';
        await restart(p);
        const steps = [];
        const snaps = [86, 110];
        await installScript(page, steps, snaps);
        await startPaused(p);
        await ffTo(page, 76);
        const t = await page.evaluate(() => window.__battle.state.t);
        const o = await orderByInput(p, 'a_kiba', 'attack', 'e_kiba');
        const k0 = await unitOf(page, 'a_kiba');
        const bb = await badgeOf(p, 'a_ishikawa', 300);
        await pointAt(p, bb.x, bb.y);
        let u = await ui(page);
        check(u.pending === 'ability' && (await abOf(page, 'a_ishikawa')).usedAt === null, `[${kind}] ${name}：石川の印 → 対象選び（まだ使わない）`);
        // 不適切な対象（敵の騎馬）→ 理由だけ・回数は減らない
        const e = await screenOf(page, 'e_kiba');
        if (e && e.shown) {
            await pointAt(p, e.x, e.y);
            check((await abOf(page, 'a_ishikawa')).usedAt === null && (await ui(page)).pending === 'ability', `[${kind}] ${name}：敵を押しても使わない（回数は減らず、対象選びが続く）`, await hintText(page));
        }
        await shot(p, 'c3-ishikawa-choose');
        const kq = await screenOf(page, 'a_kiba');
        await pointAt(p, kq.x, kq.y);
        const a = await abOf(page, 'a_ishikawa');
        const k1 = await unitOf(page, 'a_kiba');
        check(a.usedAt !== null && a.targetId === 'a_kiba', `[${kind}] ${name}：騎馬隊の体を押して発動（名札 → 対象の 2 段）`);
        check(k1.order.type === 'attack' && k1.order.targetId === 'e_kiba', `[${kind}] ${name}：対象を押したタップは騎馬隊の命令を変えない`, JSON.stringify(k1.order));
        await shot(p, 'c3-ishikawa-use');
        const rt = await realtimeTo(p, 111, 'fit');
        await shot(p, 'c3-ishikawa-after');
        const br = await browserState(page);
        const actions = [{ t, kind: 'order', id: 'a_kiba', order: o }, { t, kind: 'ability', id: 'a_ishikawa', target: 'a_kiba' }];
        const on = await headless(page, { steps, snaps, actions, end: br.t });
        const off = await headless(page, { steps, snaps, actions: actions.slice(0, 1), end: 170 });
        sameRun(kind, name, br, on);
        const dist = (run) => { const a86 = uAt(run, 86, 'a_kiba'); return a86 ? Math.hypot(a86.x - k0.x, a86.z - k0.z) : null; };
        const m = {
            usedAt: t,
            kibaMorale: [k0.mor, k1.mor],
            kibaMoved10: [dist(off), dist(br)],
            eKibaRout: [ev(off, 'rout', 'e_kiba'), ev(br, 'rout', 'e_kiba')],
            eKibaStr110: [uAt(off, 110, 'e_kiba')?.str, uAt(br, 110, 'e_kiba')?.str],
        };
        out.scenarios.ishikawa = { ...m, realtime: rt };
        log(`    ${name}（${r1(t)} 秒・対象 徳川騎馬隊）：騎馬隊の士気 ${r0(m.kibaMorale[0])} → ${r0(m.kibaMorale[1])}（使った瞬間）・10 秒で動いた距離 ${r0(m.kibaMoved10[0])} → ${r0(m.kibaMoved10[1])} m・敵の騎馬の敗走 ${r1(m.eKibaRout[0])} → ${r1(m.eKibaRout[1])} 秒・110 秒の敵の騎馬の兵 ${r0(m.eKibaStr110[0])} → ${r0(m.eKibaStr110[1])}`);
        log(`      表示：${rt.frames} 回読んだ・兵士 ${rt.visMin}〜${rt.visMax} 人・画面外の部隊 最大 ${rt.culledMax}・LOD ${rt.lods.join('/')}%`);
        check(m.kibaMorale[1] >= m.kibaMorale[0] + 15 || m.kibaMorale[1] >= 99.5, `[${kind}] ${name}：騎馬隊の士気が上がる`);
        check(m.kibaMoved10[1] > m.kibaMoved10[0] * 1.4, `[${kind}] ${name}：騎馬隊が速く動く（10 秒の距離 1.4 倍以上）`);
        check(m.eKibaRout[1] !== null && (m.eKibaRout[0] === null || m.eKibaRout[1] < m.eKibaRout[0] - 20), `[${kind}] ${name}：敵の騎馬が早く崩れる`);
        sc.push(await blinkRule(p, name));
    }

    // ---------------- 4. 忠勝「退路の守護」：65 秒、押された榊原隊に撤退を命じ、忠勝が守護 ----------------
    {
        const name = '忠勝「退路の守護」';
        await restart(p);
        const steps = [];
        const snaps = [66, 105];
        await installScript(page, steps, snaps);
        await startPaused(p);
        await ffTo(page, 65);
        const t = await page.evaluate(() => window.__battle.state.t);
        const o = await orderByInput(p, 'a_sakakibara', 'retreat');
        const r = await useByLabel(p, 'a_tadakatsu', 260);
        check((await abOf(page, 'a_tadakatsu')).usedAt !== null && sameExcept(r.before, r.after, ['a_tadakatsu']).length === 0, `[${kind}] ${name}：忠勝の印を 1 回押して発動（ほかの命令に漏れない）`);
        await shot(p, 'c4-tadakatsu-use');
        const rt = await realtimeTo(p, 106, 'a_tadakatsu');
        await shot(p, 'c4-tadakatsu-after');
        const br = await browserState(page);
        const actions = [{ t, kind: 'order', id: 'a_sakakibara', order: o }, { t, kind: 'ability', id: 'a_tadakatsu' }];
        const on = await headless(page, { steps, snaps, actions, end: br.t });
        const off = await headless(page, { steps, snaps, actions: actions.slice(0, 1), end: 130 });
        sameRun(kind, name, br, on);
        const lured = (run) => run.events.filter((x) => x.split('|')[1] === 'ai' && x.includes('本多忠勝隊に引きつけられた')).map((x) => x.split('|')[2]);
        const sakaEnd = (run, t) => { const e = run.events.find((x) => { const [, k, u] = x.split('|'); return (k === 'rout' || k === 'withdrawn') && u === 'a_sakakibara'; }); return e ? `${e.split('|')[1] === 'rout' ? '敗走' : '撤退'} ${e.split('|')[0]} 秒` : `（${t} 秒まで戦場）`; };
        const m = {
            usedAt: t,
            sakakibara: [sakaEnd(off, 130), sakaEnd(br, br.t.toFixed(0))],
            sakakibaraStr105: [uAt(off, 105, 'a_sakakibara')?.str ?? null, uAt(br, 105, 'a_sakakibara')?.str ?? null],
            sakakibaraStatus: [uEnd(off, 'a_sakakibara').st, uEnd(br, 'a_sakakibara').st],
            lured: [lured(off), lured(br)],
            tadakatsuLoss: [uAt(off, 66, 'a_tadakatsu').str - uAt(off, 105, 'a_tadakatsu').str, uAt(br, 66, 'a_tadakatsu').str - uAt(br, 105, 'a_tadakatsu').str],
            tadakatsuRout: [ev(off, 'rout', 'a_tadakatsu'), ev(br, 'rout', 'a_tadakatsu')],
        };
        out.scenarios.tadakatsu = { ...m, realtime: rt };
        log(`    ${name}（${r1(t)} 秒）：退く榊原隊 ${m.sakakibara[0]} → ${m.sakakibara[1]}（兵 ${r0(uEnd(off, 'a_sakakibara').str)} → ${r0(uEnd(br, 'a_sakakibara').str)}）・忠勝隊へ引きつけられた敵 ${m.lured[0].join(',') || 'なし'} → ${m.lured[1].join(',')}・忠勝隊の 66〜105 秒の損害 ${r0(m.tadakatsuLoss[0])} → ${r0(m.tadakatsuLoss[1])}・忠勝隊の敗走 ${r1(m.tadakatsuRout[0])} → ${r1(m.tadakatsuRout[1])} 秒`);
        log(`      表示：${rt.frames} 回読んだ・兵士 ${rt.visMin}〜${rt.visMax} 人・画面外の部隊 最大 ${rt.culledMax}・LOD ${rt.lods.join('/')}%`);
        check(m.sakakibaraStatus[0] === 'routed' && m.sakakibaraStatus[1] !== 'routed', `[${kind}] ${name}：使わない時は退く榊原隊が追われて敗走、使うと敗走しない`, m.sakakibaraStatus.join(' → '));
        check(m.lured[0].length === 0 && m.lured[1].length >= 2, `[${kind}] ${name}：追っ手（2 部隊以上）の向きが忠勝隊へ変わる`);
        check(m.tadakatsuLoss[1] > m.tadakatsuLoss[0] + 30, `[${kind}] ${name}：忠勝隊は無敵ではなく、大きく削られる`);
        sc.push(await blinkRule(p, name));
    }

    // ---------------- 5. 家康「立て直しの号令」：前線のどれかの士気が 45 を切ったら使う ----------------
    {
        const name = '家康「立て直しの号令」';
        await restart(p);
        const steps = [];
        const snaps = [90, 150];
        const FRONT = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_yumi'];
        await installScript(page, steps, snaps);
        await startPaused(p);
        await ffTo(page, 60);
        // 前線のどれかの士気が 45 を切るまで 0.1 秒ずつ早送り（ページの中で。刻みの道は同じ）
        await page.evaluate((F) => {
            const shaky = () => window.__battle.state.units.some((u) => F.includes(u.id) && u.present && u.status === 'ready' && u.morale < 45);
            for (let i = 0; i < 1200 && !shaky(); i++) window.__battle.fastForward(0.1, window.__sc);
        }, FRONT);
        const t = await page.evaluate(() => window.__battle.state.t);
        const frontMor = () => page.evaluate((F) => Object.fromEntries(window.__battle.state.units.filter((u) => F.includes(u.id)).map((u) => [u.id, Math.round(u.morale)])), FRONT);
        const m0 = await frontMor();
        const r = await useByLabel(p, 'a_ieyasu', 260);
        const m1 = await frontMor();
        check((await abOf(page, 'a_ieyasu')).usedAt !== null && sameExcept(r.before, r.after, []).length === 0, `[${kind}] ${name}：家康の印を 1 回押して発動（ほかの命令に漏れない）`);
        await shot(p, 'c5-ieyasu-use');
        const rt = await realtimeTo(p, 151, 'far');
        await shot(p, 'c5-ieyasu-after');
        const br = await browserState(page);
        const actions = [{ t, kind: 'ability', id: 'a_ieyasu' }];
        const on = await headless(page, { steps, snaps, actions, end: br.t });
        const off = await headless(page, { steps, snaps, actions: [], end: 600 });
        sameRun(kind, name, br, on);
        const avg = (run, tt) => FRONT.reduce((a, id) => a + uAt(run, tt, id).mor, 0) / FRONT.length;
        const routs = (run, tt) => run.events.filter((x) => { const [time, k, u] = x.split('|'); return k === 'rout' && FRONT.includes(u) && Number(time) <= tt; }).length;
        const m = {
            usedAt: t,
            frontMoraleAtUse: [m0, m1],
            frontAvg90: [avg(off, 90), avg(br, 90)],
            frontRouts150: [routs(off, 150), routs(br, 150)],
            minMoraleInRally: br.rec.minAllyMoraleInRally,
            offResult: off.result,
        };
        out.scenarios.ieyasu = { ...m, realtime: rt };
        log(`    ${name}（${r1(t)} 秒）：前線の士気（使った瞬間）${FRONT.map((id) => `${id} ${m0[id]}→${m1[id]}`).join('・')}・90 秒の前線の士気の平均 ${r0(m.frontAvg90[0])} → ${r0(m.frontAvg90[1])}・150 秒までの前線の敗走 ${m.frontRouts150[0]} → ${m.frontRouts150[1]}・効果中の味方の士気の最低 ${r0(m.minMoraleInRally)}・使わない時の決着 ${JSON.stringify(m.offResult)}`);
        log(`      表示：${rt.frames} 回読んだ・兵士 ${rt.visMin}〜${rt.visMax} 人・画面外の部隊 最大 ${rt.culledMax}・LOD ${rt.lods.join('/')}%`);
        check(FRONT.every((id) => m1[id] >= Math.min(100, m0[id] + 39) || m0[id] === 0), `[${kind}] ${name}：使った瞬間に前線の士気が大きく戻る（+40・上限 100）`);
        check(m.frontAvg90[1] > m.frontAvg90[0] + 30 && m.frontRouts150[0] >= 3 && m.frontRouts150[1] === 0, `[${kind}] ${name}：前線が崩れない（90 秒の士気の平均が 30 以上高い・150 秒までの敗走 ${m.frontRouts150[0]} → 0）`);
        check(m.minMoraleInRally >= 20 - 1e-6, `[${kind}] ${name}：効果中は味方の士気が 20 未満に下がらない`, r0(m.minMoraleInRally));
        sc.push(await blinkRule(p, name));
    }
    out.blink = sc;
    await p.ctx.close();
}

for (const kind of KINDS) {
    if (PARTS.includes('input')) await inputPart(kind);
    if (PARTS.includes('abilities')) await abilitiesPart(kind);
}
await b.close();
writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
log('記録（コンテナのソフトウェア描画。実機の性能ではない）：' + `${OUT}/record.json`);
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
