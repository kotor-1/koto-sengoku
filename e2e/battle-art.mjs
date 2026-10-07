/**
 * 合戦の画面の生成イラスト素材（Version 22。地面の素材・円の林の木・足元の影・砂ぼこり・武将の顔）の確かめ（開発サーバー）。
 *   BASE=http://localhost:8632 node e2e/battle-art.mjs <出力先> [desktop,phone]
 *
 * 大平原の演習を、次の 3 つの見せ方で同じ手順・同じ命令の台本で進めて比べる：
 *   old     … ?art=old&artFixture=1（旧表示。素材を一つも使わない＝Version 21 の見た目）
 *   fixture … ?artFixture=1（開発用の TEST の模様の素材。proto3d/dev-art。配置・縮尺の確かめ用で、見た目の素材ではない）
 *   empty   … 何も付けない（今の素材の一覧は空なので、Version 21 と同じ見た目になるはず）
 * 確かめること：
 *   - 合戦の状態：同じ台本で、刻み 2400（240 秒）または終わりの時点の状態の指紋が 3 つとも同じ（表示は合戦を変えない）。
 *   - 地面：fixture だけ textured・円の林に木・影あり。old・empty は vertex・影 0・砂ぼこり 0・顔 0（DOM に b-face が無い）。
 *   - カメラの「全体」（fit）と、余白を決める部品（.b-obj-head・.b-ctrl・.b-bottom・.b-zoom）の四角が 3 つとも同じ。
 *   - 見えている兵士の数（troopStats().visibleSoldiers）が減らない（既定の寄りで 300 以上）。描画の呼び出し・三角形の数を記録。
 *   - 顔：家康・忠勝の札の見出し・能力の欄の武将の行・発動の知らせ・演習の編成の表だけに canvas.b-face（ほかの武将には無い）。札の高さは同じ。
 * 操作：演習の入口・戦場・出陣・開始・指揮・札・能力のボタンは本物のクリック／タップ。時間を 3 秒ちょうどに合わせる（fastForward）・
 *   台本の命令（setScript・order）・早回し（setTimeScale）・数え上げ（art・info・troopStats・camera）は開発用の window.__battle（報告では「開発用の操作」と書く）。
 * 画面写真（fixture の TEST の模様は縮尺・位置の確かめ用。見た目の評価には使わない）は出力先に保存する。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8632';
const OUT = process.argv[2] || 'e2e-out/battle-art';
const PARTS = (process.argv[3] || 'desktop,phone').split(',');
mkdirSync(OUT, { recursive: true });
const MODES = { old: '&art=old&artFixture=1', fixture: '&artFixture=1', empty: '' };
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const POLL = { timeout: 300000, polling: 250 };
const fails = [];
const check = (ok, what, detail = '') => {
    console.log(`${ok ? '  ok ' : '  NG '} ${what}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    if (!ok) fails.push(what);
};

const b = await launchBrowser();
const report = {};

async function run(kind, mode) {
    const phone = kind === 'phone';
    const W = phone ? 844 : 1280;
    const H = phone ? 390 : 720;
    const ctx = await b.newContext(phone ? { viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const press = async (sel) => {
        await page.waitForTimeout(450);
        await page.locator(sel).first().scrollIntoViewIfNeeded();
        if (phone) await page.tap(sel);
        else await page.click(sel);
    };
    const bpress = async (sel) => {
        if (phone) await page.tap(sel);
        else await page.click(sel);
        await page.waitForTimeout(150);
    };
    const waitSheet = (name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
    const tag = `${mode}-${W}x${H}`;
    const rep = { mode, kind };
    await page.goto(`${BASE}/?q=low${MODES[mode]}`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    await press('[data-id="practice"]');
    await waitSheet('practice-list');
    await press('[data-id="field:plains"]');
    await waitSheet('practice-briefing');
    // 演習の編成の表の顔（読み込みを少し待つ）
    await page.waitForTimeout(mode === 'fixture' ? 1500 : 800);
    rep.briefFaces = await page.evaluate(() => [...document.querySelectorAll('.g-pr-units .b-face')].map((c) => ({ id: c.dataset.artId, row: c.closest('tr')?.dataset.unit })));
    rep.briefRows = await page.evaluate(() => [...document.querySelectorAll('.g-pr-units tr[data-unit]')].map((tr) => Math.round(tr.getBoundingClientRect().height)));
    await page.screenshot({ path: `${OUT}/briefing-${tag}.png` });
    await press('.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await page.waitForTimeout(800);
    rep.artBefore = await page.evaluate(() => window.__battle.art());
    await bpress('.b-primary');
    await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
    await bpress('.b-pause');
    await page.waitForFunction(() => window.__battle.ui.paused, null, POLL);
    const tPause = await page.evaluate(() => window.__battle.state.t);
    await page.evaluate((d) => window.__battle.fastForward(d), Math.max(0, 3 - tPause));
    await page.waitForFunction(() => document.querySelectorAll('.b-toast').length === 0 && document.querySelector('.b-hint')?.hidden !== false, null, { timeout: 60000, polling: 250 });
    await page.waitForTimeout(1500);
    rep.camera = await page.evaluate(() => window.__battle.camera);
    rep.insetRects = await page.evaluate(() =>
        Object.fromEntries(
            ['.b-obj-head', '.b-ctrl', '.b-bottom', '.b-zoom'].map((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                return [s, [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 10) / 10)];
            }),
        ),
    );
    rep.cardH = await page.evaluate(() => [...document.querySelectorAll('.b-card')].map((c) => Math.round(c.getBoundingClientRect().height * 10) / 10));
    rep.art = await page.evaluate(() => window.__battle.art());
    rep.info = await page.evaluate(() => window.__battle.info());
    const ts = await page.evaluate(() => window.__battle.troopStats());
    rep.visibleSoldiers = ts.visibleSoldiers;
    rep.drawCalls = ts.drawCalls;
    rep.cardFaces = await page.evaluate(() => [...document.querySelectorAll('.b-card .b-face')].map((c) => ({ id: c.dataset.artId, card: c.closest('.b-card')?.dataset.id })));
    rep.faceCount = await page.evaluate(() => document.querySelectorAll('.b-face').length);
    await page.screenshot({ path: `${OUT}/wide-${tag}.png` });
    log(tag, 'wide', JSON.stringify(rep.art), JSON.stringify(rep.info), 'soldiers', rep.visibleSoldiers);

    // 寄った画面・地図を動かした画面（地面の縮尺・林と道の縁の確かめ。fixture は TEST の模様）
    if (mode !== 'empty') {
        // 地図を動かすのは表示だけ（開発用の centerOn）。終わったら「全体」のボタン（本物の押し）で戻す
        for (const [name, x, z, d] of [
            ['woods', 130, -20, 120],
            ['road-close', 0, 20, 45],
            ['pan-nw', -150, -120, 300],
        ]) {
            await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, d]);
            await page.waitForTimeout(900);
            await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
        }
    }
    await bpress('.b-zall');
    await page.waitForTimeout(600);
    // 武将の顔：忠勝・家康の札を本物の押しで選ぶ（選ぶのは画面の状態だけ。合戦の状態は変えない）
    for (const id of ['a_tadakatsu', 'a_ieyasu', 'a_sakai']) {
        await bpress(`.b-card[data-id="${id}"]`);
        await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
            const a = document.querySelector('.b-abil');
            const g = document.querySelector('.b-gen');
            const f = document.querySelector('.b-gen .b-face');
            const box = (e) => (e ? (({ left, top, right, bottom }) => [left, top, right, bottom].map((v) => Math.round(v)))(e.getBoundingClientRect()) : null);
            return { abil: box(a), gen: box(g), face: f ? { id: f.dataset.artId, box: box(f) } : null, withFace: !!a?.classList.contains('with-face') };
        });
        rep[`sel_${id}`] = r;
        if (id !== 'a_sakai') await page.screenshot({ path: `${OUT}/selected-${id}-${tag}.png` });
    }
    // 同じ canvas を使い回す（毎秒作り直す欄でも作り直さない）：2 秒の間に置かれている canvas が同じものか
    rep.abilFaceStable = await page.evaluate(async () => {
        window.__battle.select('a_tadakatsu');
        await new Promise((r) => setTimeout(r, 400));
        const a = document.querySelector('.b-gen .b-face');
        await new Promise((r) => setTimeout(r, 2200));
        const c = document.querySelector('.b-gen .b-face');
        return a === null ? null : a === c;
    });

    // ---- 発動の知らせの顔（本物の押し：家康の札 → 能力）。3 つの見せ方で同じ操作（同じ命令）なので、指紋の比べはそのまま ----
    await bpress('.b-card[data-id="a_ieyasu"]');
    await page.waitForFunction(() => window.__battle.ui.selectedId === 'a_ieyasu', null, POLL);
    const usable = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_ieyasu')?.status === 'ready');
    if (usable) {
        await bpress('.b-abil-btn');
        await page.waitForTimeout(400);
        rep.notice = await page.evaluate(() => {
            const n = document.querySelector('.b-abnote');
            const f = n?.querySelector('.b-face');
            const r = n?.getBoundingClientRect();
            return n && !n.hidden ? { text: n.innerText.replace(/\s+/g, ' '), face: f?.dataset.artId ?? null, h: Math.round(r.height), w: Math.round(r.width) } : null;
        });
        await page.screenshot({ path: `${OUT}/notice-${tag}.png` });
    }
    // ---- 同じ台本で進めて、状態の指紋を比べる（台本・早回しは開発用の操作） ----
    await page.evaluate(() => {
        window.__artHash = null;
        window.__artMax = { shadows: 0, dust: 0 };
        const hash = (s) => {
            const txt = JSON.stringify({ t: s.t, tick: s.tick, result: s.result ?? null, units: s.units.map((u) => [u.id, u.x, u.z, u.facing, u.strength, u.morale, u.status, u.order, u.seenBy, u.engagedWith ?? null]), ev: s.events.map((e) => [e.t, e.kind, e.text]) });
            let h = 0x811c9dc5;
            for (let i = 0; i < txt.length; i++) {
                h ^= txt.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h.toString(16).padStart(8, '0');
        };
        const B = window.__battle;
        B.select(null);
        B.setScript((s) => {
            const t = Math.round(s.t * 10) / 10;
            if (t === 5) B.order('a_kiba', { type: 'move', x: -150, z: -40 });
            if (t === 60) B.order('a_kiba', { type: 'attack', targetId: 'e_left' });
            if (t === 90) B.order('a_ishikawa', { type: 'attack', targetId: 'e_sente' });
            if (t === 150) for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara']) B.order(id, { type: 'attack', targetId: 'e_hq' });
            if (s.tick === 2400 && !window.__artHash) window.__artHash = { tick: s.tick, hash: hash(s) };
        });
        window.__artHashOf = hash;
        B.setTimeScale(12);
        B.pause(false);
    });
    // 斬り合いの砂ぼこりの写真（t 75 ごろ。騎馬が左備へ当たった後。騎馬の所へ寄る）
    let dustShot = false;
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            const a = window.__battle.art();
            window.__artMax.shadows = Math.max(window.__artMax.shadows, a.shadows);
            window.__artMax.dust = Math.max(window.__artMax.dust, a.dust);
            return { t: window.__battle.state.t, result: window.__battle.state.result, h: window.__artHash, dust: a.dust };
        });
        if (!dustShot && st.t >= 72 && mode !== 'empty') {
            // 動いている所の写真（×1 の速さに戻して 1.5 秒。止めると新しい煙は出ない）
            dustShot = true;
            await page.evaluate(() => {
                window.__battle.setTimeScale(1);
                const u = window.__battle.state.units.find((x) => x.id === 'a_kiba');
                window.__battle.centerOn(u.x, u.z, 150);
            });
            await page.waitForTimeout(1500);
            rep.dustAtShot = await page.evaluate(() => window.__battle.art());
            await page.screenshot({ path: `${OUT}/clash-${tag}.png` });
            await page.evaluate(() => window.__battle.setTimeScale(12));
        }
        if (st.h || st.result) break;
        await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.__battle.pause(true));
    rep.stateHash = await page.evaluate(() => {
        if (window.__artHash) return window.__artHash;
        // 刻み 2400 の前に勝ち負けが決まった：終わりの状態の指紋
        const s = window.__battle.state;
        return { tick: s.tick, result: s.result?.result ?? null, hash: window.__artHashOf(s) };
    });
    rep.max = await page.evaluate(() => window.__artMax);
    log(tag, 'hash', JSON.stringify(rep.stateHash), 'max', JSON.stringify(rep.max));

    rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
    report[tag] = rep;
    await ctx.close();
    return rep;
}

for (const kind of PARTS) {
    const r = {};
    for (const mode of Object.keys(MODES)) r[mode] = await run(kind, mode);
    const { old, fixture, empty } = r;
    console.log(`== ${kind}`);
    check(old.stateHash.hash === fixture.stateHash.hash && old.stateHash.hash === empty.stateHash.hash && old.stateHash.tick === fixture.stateHash.tick, '同じ台本で状態の指紋が 3 つとも同じ', [old.stateHash, fixture.stateHash, empty.stateHash]);
    check(fixture.art.ground === 'textured' && old.art.ground === 'vertex' && empty.art.ground === 'vertex', '地面：fixture だけ素材', [old.art, fixture.art, empty.art]);
    check(old.art.trees === 0 && empty.art.trees === 0 && fixture.art.trees > 0, '円の林の木：fixture だけ植える（旧表示・素材なしは Version 21 と同じ 0 本）', [old.art.trees, fixture.art.trees, empty.art.trees]);
    check(old.max.shadows === 0 && old.max.dust === 0 && empty.max.shadows === 0 && empty.max.dust === 0, '旧表示・素材なし：影・砂ぼこりなし');
    check(fixture.max.shadows >= 7 && fixture.max.dust > 0 && fixture.max.dust <= 24, '素材あり：影と砂ぼこり（上限 24）', { max: fixture.max, atShot: fixture.dustAtShot });
    check(JSON.stringify(old.camera) === JSON.stringify(fixture.camera) && JSON.stringify(old.camera) === JSON.stringify(empty.camera), 'カメラの「全体」が同じ', [old.camera, fixture.camera]);
    check(JSON.stringify(old.insetRects) === JSON.stringify(fixture.insetRects) && JSON.stringify(old.insetRects) === JSON.stringify(empty.insetRects), '余白を決める部品の四角が同じ', fixture.insetRects);
    check(JSON.stringify(old.cardH) === JSON.stringify(fixture.cardH), '札の高さが同じ', fixture.cardH);
    check(fixture.visibleSoldiers >= old.visibleSoldiers && fixture.visibleSoldiers >= 300, '見えている兵士の数が減らない（300 以上）', [old.visibleSoldiers, fixture.visibleSoldiers, empty.visibleSoldiers]);
    check(old.faceCount === 0 && empty.faceCount === 0 && old.briefFaces.length === 0 && empty.briefFaces.length === 0, '旧表示・素材なし：顔の canvas は 1 つも無い');
    const cf = fixture.cardFaces.map((f) => `${f.card}:${f.id}`).sort();
    check(JSON.stringify(cf) === JSON.stringify(['a_ieyasu:face.ieyasu', 'a_tadakatsu:face.tadakatsu']), '札の顔は家康・忠勝だけ', cf);
    const bf = fixture.briefFaces.map((f) => `${f.row}:${f.id}`).sort();
    check(JSON.stringify(bf) === JSON.stringify(['a_ieyasu:face.ieyasu', 'a_tadakatsu:face.tadakatsu']), '編成の表の顔は家康・忠勝だけ', bf);
    check(JSON.stringify(old.briefRows) === JSON.stringify(fixture.briefRows), '編成の表の行の高さが同じ', [old.briefRows, fixture.briefRows]);
    check(fixture.sel_a_tadakatsu.face?.id === 'face.tadakatsu' && fixture.sel_a_ieyasu.face?.id === 'face.ieyasu' && !fixture.sel_a_sakai.face && !fixture.sel_a_sakai.withFace, '能力の欄の武将の行：家康・忠勝だけ顔（酒井は無し）');
    check(fixture.abilFaceStable === true, '能力の欄の顔は同じ canvas を置き直す（毎秒作り直さない）');
    const hOld = old.sel_a_tadakatsu.abil[3] - old.sel_a_tadakatsu.abil[1];
    const hFx = fixture.sel_a_tadakatsu.abil[3] - fixture.sel_a_tadakatsu.abil[1];
    console.log(`     能力の欄の高さ（忠勝）：旧 ${hOld} px → 顔あり ${hFx} px`);
    if (old.notice && fixture.notice) {
        check(fixture.notice.face === 'face.ieyasu' && !old.notice.face, '発動の知らせ：家康の顔（旧表示は無し）', [old.notice, fixture.notice]);
        console.log(`     発動の知らせの高さ：旧 ${old.notice.h} px → 顔あり ${fixture.notice.h} px`);
    }
    for (const m of [old, fixture, empty]) check(m.errors.length === 0, `${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await b.close();
console.log(fails.length ? `NG ${fails.length}: ${fails.join(' / ')}` : 'ALL OK');
process.exit(fails.length ? 1 : 0);
