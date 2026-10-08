/**
 * 合戦の画面の生成イラスト素材（Version 22。地面の素材・円の林の木・足元の影・砂ぼこり・武将の顔）の確かめ（開発サーバー）。
 *   BASE=http://localhost:8632 node e2e/battle-art.mjs <出力先> [desktop,phone,phone-s,wide,ch2,ch2b,nagamasa,late]
 *   PLAINS_MODES=old,fixture,actual（大平原の演習の見せ方。既定は desktop が 3 つ、ほかは old と actual）・CH2_SIZES=1280x720,667x375（第二章の大きさ。既定は 4 つ）・
 *   NAGAMASA=ch1a,ch1b,relief（nagamasa の部のうち行うもの。既定は全部）
 *
 * 見せ方：
 *   old     … ?art=old&artFixture=1（旧表示。素材を一つも使わない＝Version 21 の見た目）
 *   fixture … ?artFixture=1（開発用の TEST の模様の素材。proto3d/dev-art。配置・縮尺の確かめ用で、見た目の素材ではない）
 *   actual  … 何も付けない（ゲームが読む素材の一覧 manifest.gen.json のとおり＝素材パック sengoku_art_pack_v1 の武将 6 人の顔だけ。
 *             地面の素材・人物画・背景はまだ作っていないので、地面は今までのまま）
 * 部：
 *   desktop（1280×720）・phone（844×390 タッチ）・phone-s（667×375 タッチ）・wide（1920×1080）：大平原の演習（徳川の七隊・武将 5 人）を、
 *     見せ方ごとに同じ手順・同じ命令の台本で進めて比べる。
 *   ch2：第二章の合戦（織田方 ?dev=battle&scenario=ieyasu2&policy=oda。忠勝に「信頼 40」の行）、ch2b：第二章の合戦（浅井方 policy=asai。
 *     浅井長政隊は味方・盟友への援護をプレイヤーが使う）を、1280×720・1920×1080・844×390・667×375 で old と actual の同じ操作で比べる。
 *   nagamasa：浅井長政の顔。第一章 A（?dev=battle&scenario=ieyasu&policy=oda。長政は敵の本陣：札は無い。見えている時に調べた敵の欄の顔はよい。
 *     見えなくなった時（開発用に seenBy を直接変える）は選択・欄・顔を出さない）、
 *     第一章 B（policy=asai。味方の札・能力。忠勝隊を寄せてから使う）、合戦場の演習「援軍救出」（?dev=field&id=relief。味方の長政隊の札・欄、騎馬の榊原康政隊、
 *     動いている間に石川の能力）。
 *   late：地面の素材の画像だけを 7 秒遅らせ、開始のボタンを出した後に届いた素材を合戦の途中で使わないこと（fixture）。
 * 確かめること：
 *   - 合戦の状態：同じ台本・同じ操作で、決めた刻みの状態の指紋が見せ方ごとに同じ（表示は合戦を変えない）。
 *   - 地面：fixture だけ textured・円の林に木・影あり。old・actual は vertex・影 0・砂ぼこり 0。
 *   - カメラの「全体」（fit）と、余白を決める部品（.b-obj-head・.b-ctrl・.b-bottom・.b-zoom）の四角・札の四角（幅・高さ）が見せ方ごとに同じ。
 *   - 見えている兵士の数（troopStats().visibleSoldiers）が減らない（既定の寄りで 300 以上）。
 *   - 顔：札の見出し・能力の欄の武将の行・発動の知らせ・演習の編成の表で、その部隊の武将（generalId・leaderId）の顔だけ（data-art-id が face.<武将の id>）。
 *     酒井忠次・本多忠勝・榊原康政を取り違えない。顔の無い部隊（弓隊・騎馬隊・織田援軍など）には無い。旧表示は 1 つも無い。
 *   - 札の名前：顔のせいで Version 21（old）より短く切れない（文字の幅と枠の幅を測る）。状態の印（「撤退済み」「到着待ち」）を入れた時も
 *     （DOM の印の文字を入れ替えて測るだけ。合戦の状態は変えない）。
 *   - 能力：家康（「能力」）・酒井（PC は F キー、スマホは「能力」）・榊原（名札の点滅する印を直接押す）・石川（「能力」→ 対象の味方を押す）・
 *     長政（「能力」→ 援護する味方を押す）が今までどおり 1 回の押し（と対象選び）で使え、発動の知らせにその武将の顔。知らせは画面全体を覆わない・止めない。
 * 操作：演習の入口・戦場・出陣・開始・指揮・札・能力のボタン・F キー・名札の印・対象の味方は本物のクリック／タップ／キー。
 *   開発用の window.__battle（報告では「開発用の操作」と書く）：時間を 3 秒ちょうどに合わせる（fastForward）・台本の命令（setScript・order）・早回し（setTimeScale）・
 *   止める・再開（pause）・地図を寄せる（centerOn。表示だけ）・押す点を求める（screenOf・labelOf・labelHitAt）・数え上げ（art・info・troopStats・camera・state）。
 *   ?dev=battle・?dev=field の入口（合戦をすぐ始める）も開発用。
 * 画面写真（fixture の TEST の模様は縮尺・位置の確かめ用。見た目の評価には使わない）は出力先に保存する。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8632';
const OUT = process.argv[2] || 'e2e-out/battle-art';
const PARTS = (process.argv[3] || 'desktop,phone,phone-s,wide,ch2,ch2b,nagamasa,late').split(',');
mkdirSync(OUT, { recursive: true });
const MODES = { old: '&art=old&artFixture=1', fixture: '&artFixture=1', actual: '' };
/** 大平原の演習の大きさ（幅・高さ・タッチ） */
const SIZES = { desktop: [1280, 720, false], phone: [844, 390, true], 'phone-s': [667, 375, true], wide: [1920, 1080, false] };
const PLAINS_MODES = (kind) => (process.env.PLAINS_MODES ? process.env.PLAINS_MODES.split(',') : kind === 'desktop' ? ['old', 'fixture', 'actual'] : ['old', 'actual']);
/** 第二章の合戦の大きさ（CH2_SIZES=1280x720,667x375 で一部だけ） */
const CH2_SIZES = (process.env.CH2_SIZES || '1280x720,1920x1080,844x390,667x375').split(',').map((t) => {
    const [w, h] = t.split('x').map(Number);
    return [w, h, h <= 520];
});
/** nagamasa の部のうち行うもの（NAGAMASA=ch1a,ch1b,relief。既定は全部） */
const NAGAMASA = (process.env.NAGAMASA || 'ch1a,ch1b,relief').split(',');
/** 素材の届いた武将（art/ids.ts の FACE_OF） */
const FACE_GENS = ['ieyasu', 'tadakatsu', 'sakai', 'ishikawa', 'sakakibara', 'nagamasa'];
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
// 待つ上限（重い時のコンテナでは、?dev=battle の合戦が開くまで 3 分以上かかることがある）
const POLL = { timeout: 900000, polling: 250 };
const fails = [];
const check = (ok, what, detail = '') => {
    console.log(`${ok ? '  ok ' : '  NG '} ${what}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    if (!ok) fails.push(what);
};

/** 能力の欄の四角（欄・武将の行・能力の見出し・顔）。page.evaluate に渡す */
function panelProbe() {
    const box = (e) => (e ? (({ left, top, right, bottom }) => [left, top, right, bottom].map((v) => Math.round(v * 10) / 10))(e.getBoundingClientRect()) : null);
    const a = document.querySelector('.b-abil');
    const g = document.querySelector('.b-gen');
    const h = document.querySelector('.b-ab-h');
    const f = document.querySelector('.b-gen .b-face');
    const tl = document.querySelector('.b-topleft');
    return {
        abil: a && !a.hidden ? box(a) : null,
        scroll: a ? [a.scrollHeight, a.clientHeight] : null,
        gen: box(g),
        general: g?.dataset.general ?? null,
        abH: box(h),
        abHText: h?.innerText.replace(/\s+/g, ' ') ?? null,
        genText: g?.innerText.replace(/\s+/g, ' ') ?? null,
        topleft: box(tl),
        face: f ? { id: f.dataset.artId, box: box(f) } : null,
        withFace: !!a?.classList.contains('with-face'),
    };
}
/** 札の様子（部隊・武将・顔・名前の文字の幅と枠の幅・札と見出しの四角）。page.evaluate に渡す */
function cardProbe() {
    const st = window.__battle.state;
    const box = (q) => [q.left, q.top, q.right, q.bottom].map((v) => Math.round(v * 10) / 10);
    return [...document.querySelectorAll('.b-card')].map((c) => {
        const u = st.units.find((x) => x.id === c.dataset.id);
        const n = c.querySelector('.b-name');
        const r = document.createRange();
        r.selectNodeContents(n);
        const f = c.querySelector('.b-face');
        const fr = f?.getBoundingClientRect();
        // 顔を出さない札（off）：細い顔にしても名前が切れるか（その場で細い顔にして測り、すぐ戻す。描かれない）
        let offNeeded = null;
        if (f && c.dataset.face === 'off') {
            f.classList.remove('b-face-off');
            f.classList.add('b-face-narrow');
            const r2 = document.createRange();
            r2.selectNodeContents(n);
            offNeeded = r2.getBoundingClientRect().width > n.getBoundingClientRect().width + 0.05;
            f.classList.remove('b-face-narrow');
            f.classList.add('b-face-off');
        }
        return {
            offNeeded,
            id: c.dataset.id,
            gen: u?.generalId ?? u?.leaderId ?? null,
            face: f?.dataset.artId ?? null,
            faceW: fr ? Math.round(fr.width * 10) / 10 : 0,
            fit: c.dataset.face ?? null,
            name: n.textContent,
            nameBox: Math.round(n.getBoundingClientRect().width * 100) / 100,
            nameText: Math.round(r.getBoundingClientRect().width * 100) / 100,
            badge: c.querySelector('.b-badge').textContent,
            card: box(c.getBoundingClientRect()),
            head: box(c.querySelector('.b-card-h').getBoundingClientRect()),
        };
    });
}
/** 札の状態の印を、DOM の文字だけ入れ替えて測る（合戦の状態は変えない。測った後に戻す） */
async function badgeProbe(page, text) {
    await page.evaluate((t) => {
        const els = [...document.querySelectorAll('.b-card .b-badge')];
        window.__keepBadges = els.map((e) => e.textContent);
        els.forEach((e) => (e.textContent = t));
    }, text);
    await page.waitForTimeout(500);
    const r = await page.evaluate(cardProbe);
    await page.evaluate(() => {
        const els = [...document.querySelectorAll('.b-card .b-badge')];
        els.forEach((e, i) => (e.textContent = window.__keepBadges[i]));
    });
    await page.waitForTimeout(500);
    return r;
}
/** 名前が切れている（文字の幅が枠より広い） */
const cut = (c) => c.nameText - c.nameBox > 0.05;
/** 顔のある見せ方の札が、旧表示より名前を短く切っていないか。返り：だめな札の一覧 */
function worseNames(oldCards, newCards) {
    const bad = [];
    for (const o of oldCards) {
        const n = newCards.find((x) => x.id === o.id);
        if (!n) {
            bad.push(`${o.id}: 札が無い`);
            continue;
        }
        if (!cut(o) ? cut(n) : n.nameBox < o.nameBox - 0.05) bad.push(`${o.name}（${o.badge || '印なし'}）：旧 ${o.nameBox}/${o.nameText} → ${n.nameBox}/${n.nameText}・顔 ${n.fit}`);
    }
    return bad;
}
/** 札の顔が、その部隊の武将の顔か（顔の無い武将・部隊には無い）。返り：だめな札の一覧 */
function wrongFaces(cards) {
    return cards.filter((c) => c.face !== (FACE_GENS.includes(c.gen) ? `face.${c.gen}` : null)).map((c) => `${c.id}(${c.gen}): ${c.face}`);
}
/** 発動の知らせ（文・顔・大きさ）。face は見えている顔だけ（畳んで CSS で隠した顔は数えない。置いてあるだけの顔は faceDom） */
const noticeProbe = (page) =>
    page.evaluate(() => {
        const n = document.querySelector('.b-abnote');
        const f = n?.querySelector('.b-face');
        const fw = f ? f.getBoundingClientRect().width : 0;
        const r = n?.getBoundingClientRect();
        return n && !n.hidden ? { text: n.innerText.replace(/\s+/g, ' '), face: f && fw > 0 ? (f.dataset.artId ?? null) : null, faceDom: f?.dataset.artId ?? null, faceW: Math.round(fw * 10) / 10, h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, vw: innerWidth, vh: innerHeight, fold: Number(document.querySelector('.b-topmid')?.dataset.fold ?? 0) } : null;
    });
/**
 * 発動の知らせの顔と大きさを旧表示と比べる。顔を出すなら、高さは旧表示と同じ（顔の分だけ横に広い）。顔を出さない（畳んだ・顔で折り返しが
 * 増える細い列）なら、幅・高さとも旧表示と同じ。返り：{ ok, face（顔を出したか） }
 */
function noticeVsOld(o, a, gen) {
    if (!o || !a || o.face) return { ok: false, face: false };
    const near = (x, y) => Math.abs(x - y) <= 0.6;
    if (a.face === `face.${gen}`) return { ok: a.fold === 0 && near(a.h, o.h) && a.w > o.w, face: true };
    return { ok: a.face === null && near(a.h, o.h) && near(a.w, o.w), face: false };
}
/** 上の真ん中（指揮中の印・発動の知らせ）だけを撮る（撮れなくても進める） */
async function noticeShot(page, path) {
    await page.locator('.b-topmid').screenshot({ path, timeout: 8000 }).catch(() => {});
}
/** 高さ（四角の下 − 上） */
const hOf = (b) => (b ? Math.round((b[3] - b[1]) * 10) / 10 : null);
/**
 * 能力の欄が旧表示と比べて変わっていないか。顔のある欄は武将の行の「固有能力「…」」（すぐ下の見出しと同じ名前）を省くので、
 * 旧表示で武将の行が折り返していた時（長い役割・信頼の行。例：浅井長政 同盟の大将 信頼 10）だけ、武将の行が 1 行になり、欄はその分だけ低くなる。
 * それ以外（左・右・幅・能力の見出しの幅・欄の上の端）は同じ。欄が高くなる・ほかの行が変わるのはだめ
 */
function panelSame(o, f) {
    if (!o?.abil || !f?.abil) return o?.abil === f?.abil;
    if (JSON.stringify(o.abil) === JSON.stringify(f.abil) && JSON.stringify(o.abH) === JSON.stringify(f.abH)) return true;
    const shrink = hOf(o.gen) - hOf(f.gen);
    const near = (a, b) => Math.abs(a - b) <= 0.2;
    return (
        shrink > 0 &&
        near(o.abil[0], f.abil[0]) && near(o.abil[1], f.abil[1]) && near(o.abil[2], f.abil[2]) &&
        near(hOf(o.abil) - hOf(f.abil), shrink) &&
        !!o.abH && !!f.abH && near(o.abH[0], f.abH[0]) && near(o.abH[2], f.abH[2]) && near(hOf(o.abH), hOf(f.abH)) && near(o.abH[1] - f.abH[1], shrink)
    );
}
/** 状態の指紋（ページの中で使う。台本の中から呼べるよう window に置く） */
function installHash() {
    window.__hashOf = (s) => {
        const txt = JSON.stringify({ t: s.t, tick: s.tick, result: s.result ?? null, units: s.units.map((u) => [u.id, u.x, u.z, u.facing, u.strength, u.morale, u.status, u.order, u.seenBy, u.engagedWith ?? null]), ab: s.abilityList.map((r) => [r.unitId, r.usedAt, r.until, r.targetId ?? null]), ev: s.events.map((e) => [e.t, e.kind, e.text]) });
        let h = 0x811c9dc5;
        for (let i = 0; i < txt.length; i++) {
            h ^= txt.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    };
}

const b = await launchBrowser();
const report = {};

function newCtx(W, H, touch) {
    return b.newContext(touch ? { viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
}
function watchErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return errors;
}
/** 本物の押し（PC はクリック・スマホはタップ） */
function pressers(page, touch) {
    return async (sel) => {
        if (touch) await page.tap(sel);
        else await page.click(sel);
        await page.waitForTimeout(150);
    };
}
async function pointAt(page, touch, x, y) {
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(500);
}
/** 開始して、指揮（一時停止）のボタンで止め、合戦の時刻を 3 秒ちょうどに合わせる（開発用の fastForward） */
async function startPaused(page, bpress) {
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await page.waitForTimeout(800);
    await bpress('.b-primary');
    await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
    await bpress('.b-pause');
    await page.waitForFunction(() => window.__battle.ui.paused, null, POLL);
    const tPause = await page.evaluate(() => window.__battle.state.t);
    await page.evaluate((d) => window.__battle.fastForward(d), Math.max(0, 3 - tPause));
}
const insetProbe = (page) =>
    page.evaluate(() =>
        Object.fromEntries(
            ['.b-obj-head', '.b-ctrl', '.b-bottom', '.b-zoom'].map((s) => {
                const q = document.querySelector(s)?.getBoundingClientRect();
                return [s, q ? [q.left, q.top, q.right, q.bottom].map((v) => Math.round(v * 10) / 10) : null];
            }),
        ),
    );

/**
 * 「能力」を押し、対象の要る能力なら選べる味方（名札 data-ab="target"）を押す。返り：{ used, target, how }
 * 押す所：対象の名札の真ん中（アプリの当たり labelHitAt が、その名札に当たる時）。当たらなければ部隊の体（screenOf）
 */
async function useWithTarget(page, touch, bpress, unitId, prefer = []) {
    await bpress('.b-abil-btn');
    await page.waitForTimeout(700);
    const st = await page.evaluate(() => window.__battle.ui.pending);
    if (st !== 'ability') return { used: false, why: `対象選びにならない（${st}）` };
    const targets = await page.evaluate(() => [...document.querySelectorAll('.b-label[data-ab="target"]')].map((e) => e.dataset.id));
    const order = [...prefer.filter((t) => targets.includes(t)), ...targets.filter((t) => !prefer.includes(t))];
    for (const t of order) {
        const l = await page.evaluate((t) => window.__battle.labelOf(t), t);
        let pt = null;
        let how = '';
        if (l) {
            const hit = await page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [l.x, l.y]);
            if (hit && hit.id === t) {
                pt = { x: l.x, y: l.y };
                how = '名札';
            }
        }
        if (!pt) {
            const s = await page.evaluate((t) => window.__battle.screenOf(t), t);
            if (s && s.shown) {
                pt = s;
                how = '部隊の体';
            }
        }
        if (!pt) continue;
        await pointAt(page, touch, pt.x, pt.y);
        const r = await page.evaluate((id) => window.__battle.state.abilities[id], unitId);
        if (r?.usedAt !== null && r?.usedAt !== undefined) return { used: true, target: r.targetId ?? null, how, targets };
    }
    return { used: false, why: '選べる味方を押しても使えない', targets };
}

// ---------------------------------------------------------------- 大平原の演習

async function plainsRun(kind, mode) {
    const [W, H, touch] = SIZES[kind];
    const ctx = await newCtx(W, H, touch);
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = watchErrors(page);
    const press = async (sel) => {
        await page.waitForTimeout(450);
        await page.locator(sel).first().scrollIntoViewIfNeeded();
        if (touch) await page.tap(sel);
        else await page.click(sel);
    };
    const bpress = pressers(page, touch);
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
    await page.waitForTimeout(mode === 'old' ? 800 : 1500);
    rep.briefFaces = await page.evaluate(() => [...document.querySelectorAll('.g-pr-units .b-face')].map((c) => ({ id: c.dataset.artId, row: c.closest('tr')?.dataset.unit })));
    rep.briefRows = await page.evaluate(() => [...document.querySelectorAll('.g-pr-units tr[data-unit]')].map((tr) => Math.round(tr.getBoundingClientRect().height)));
    rep.briefTable = await page.evaluate(() => {
        const t = document.querySelector('.g-pr-units')?.getBoundingClientRect();
        return t ? [Math.round(t.width), Math.round(t.height)] : null;
    });
    await page.screenshot({ path: `${OUT}/briefing-${tag}.png` });
    await press('.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    const tActive = Date.now();
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 300000, polling: 50 });
    rep.readyMs = Date.now() - tActive;
    // 開始のボタンを出した時の地面（素材はそれより前に使う。後から差し替えない）
    rep.artAtReady = await page.evaluate(() => window.__battle.art());
    await startPaused(page, bpress);
    await page.waitForFunction(() => document.querySelectorAll('.b-toast').length === 0 && document.querySelector('.b-hint')?.hidden !== false, null, { timeout: 60000, polling: 250 });
    await page.waitForTimeout(1500);
    rep.camera = await page.evaluate(() => window.__battle.camera);
    rep.insetRects = await insetProbe(page);
    rep.cards = await page.evaluate(cardProbe);
    rep.art = await page.evaluate(() => window.__battle.art());
    const ts = await page.evaluate(() => window.__battle.troopStats());
    rep.visibleSoldiers = ts.visibleSoldiers;
    rep.drawCalls = ts.drawCalls;
    rep.faceCount = await page.evaluate(() => document.querySelectorAll('.b-face').length);
    await page.screenshot({ path: `${OUT}/wide-${tag}.png` });
    await page.locator('.b-bottom').screenshot({ path: `${OUT}/cards-${tag}.png` });
    // 状態の印を入れた時の名前（DOM の文字だけ）
    rep.badgeCards = {};
    for (const t of ['到着待ち', '撤退済み']) rep.badgeCards[t] = await badgeProbe(page, t);
    await page.locator('.b-bottom').screenshot({ path: `${OUT}/cards-after-badges-${tag}.png` });
    log(tag, 'wide', JSON.stringify(rep.art), 'soldiers', rep.visibleSoldiers, 'cards', rep.cards.map((c) => `${c.id}:${c.face}:${c.fit}`).join(' '));

    // 寄った画面（地面の縮尺・林と道の縁の確かめ。fixture は TEST の模様）
    if (mode === 'fixture') {
        for (const [name, x, z, d] of [
            ['woods', 130, -20, 120],
            ['road-close', 0, 20, 45],
        ]) {
            await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, d]);
            await page.waitForTimeout(900);
            await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
        }
        await bpress('.b-zall');
        await page.waitForTimeout(600);
    }
    // 武将の顔：5 武将の札を本物の押しで選ぶ（選ぶのは画面の状態だけ。合戦の状態は変えない）
    for (const id of ['a_tadakatsu', 'a_ieyasu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_kiba']) {
        await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
        await bpress(`.b-card[data-id="${id}"]`);
        await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
        await page.waitForTimeout(1200);
        rep[`sel_${id}`] = await page.evaluate(panelProbe);
        if (id !== 'a_kiba') await page.screenshot({ path: `${OUT}/selected-${id}-${tag}.png` });
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

    // ---- 能力の発動（止めたまま。本物の押し）と、発動の知らせの顔。見せ方ごとに同じ操作（同じ命令）なので、指紋の比べはそのまま ----
    rep.abilities = {};
    const selectCard = async (id) => {
        await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
        await bpress(`.b-card[data-id="${id}"]`);
        await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
        await page.waitForTimeout(400);
    };
    const usedAt = (id) => page.evaluate((id) => window.__battle.state.abilities[id]?.usedAt ?? null, id);
    const afterUse = async (id, how, extra = {}) => {
        // 発動の知らせは 2.5 秒で消えるので、先に上の真ん中だけを撮る（重い時は画面全体の写真に数秒かかる）
        await page.waitForTimeout(150);
        const notice = await noticeProbe(page);
        await noticeShot(page, `${OUT}/notice-crop-${id}-${tag}.png`);
        const r = { how, used: (await usedAt(id)) !== null, notice, fold: notice ? notice.fold : await page.evaluate(() => window.__battle.noticeFold()), paused: (await page.evaluate(() => window.__battle.ui)).paused, modal: await page.evaluate(() => window.__battle.ui.modal), ...extra };
        rep.abilities[id] = r;
        await page.screenshot({ path: `${OUT}/notice-${id}-${tag}.png` });
        log(tag, id, JSON.stringify(r));
    };
    // 家康：札 → 「能力」
    await selectCard('a_ieyasu');
    await bpress('.b-abil-btn');
    await afterUse('a_ieyasu', '「能力」');
    await page.waitForTimeout(500);
    rep.activeIeyasu = await page.evaluate(panelProbe);
    // 酒井：札 → PC は F キー、スマホは「能力」
    await selectCard('a_sakai');
    if (touch) await bpress('.b-abil-btn');
    else {
        await page.keyboard.press('KeyF');
        await page.waitForTimeout(150);
    }
    await afterUse('a_sakai', touch ? '「能力」' : 'F キー');
    // 榊原：何も選ばずに、名札の点滅する印を直接押す（当たらなければ札 → 「能力」）
    await page.evaluate(() => window.__battle.select(null));
    await page.waitForTimeout(300);
    {
        const l = await page.evaluate(() => window.__battle.labelOf('a_sakakibara'));
        const hit = l?.badge ? await page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [l.badge.x, l.badge.y]) : null;
        if (hit && hit.id === 'a_sakakibara' && hit.part === 'badge') {
            await pointAt(page, touch, l.badge.x, l.badge.y);
            await afterUse('a_sakakibara', '名札の印');
        } else {
            await selectCard('a_sakakibara');
            await bpress('.b-abil-btn');
            await afterUse('a_sakakibara', '「能力」（名札の印が隠れていた）', { hit });
        }
    }
    // 石川：札 → 「能力」→ 対象の味方を押す（騎馬隊を先に試す）
    await selectCard('a_ishikawa');
    const ish = await useWithTarget(page, touch, bpress, 'a_ishikawa', ['a_kiba', 'a_yumi']);
    await afterUse('a_ishikawa', `「能力」→ 対象の${ish.how ?? '?'}`, { target: ish.target ?? null, why: ish.why ?? '' });
    rep.ishikawaTargets = ish.targets ?? [];

    // ---- 同じ台本で進めて、状態の指紋を比べる（台本・早回しは開発用の操作） ----
    await page.evaluate(installHash);
    await page.evaluate(() => {
        window.__artHash = null;
        window.__artMax = { shadows: 0, dust: 0 };
        const B = window.__battle;
        B.select(null);
        B.setScript((s) => {
            const t = Math.round(s.t * 10) / 10;
            if (t === 5) B.order('a_kiba', { type: 'move', x: -150, z: -40 });
            if (t === 60) B.order('a_kiba', { type: 'attack', targetId: 'e_left' });
            if (t === 90) B.order('a_ishikawa', { type: 'attack', targetId: 'e_sente' });
            if (t === 150) for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara']) B.order(id, { type: 'attack', targetId: 'e_hq' });
            if (s.tick === 2400 && !window.__artHash) window.__artHash = { tick: s.tick, hash: window.__hashOf(s) };
        });
        B.setTimeScale(12);
        B.pause(false);
    });
    let dustShot = false;
    const deadline = Date.now() + 900000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            const a = window.__battle.art();
            window.__artMax.shadows = Math.max(window.__artMax.shadows, a.shadows);
            window.__artMax.dust = Math.max(window.__artMax.dust, a.dust);
            return { t: window.__battle.state.t, result: window.__battle.state.result, h: window.__artHash };
        });
        if (!dustShot && st.t >= 72 && mode === 'fixture') {
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
        return { tick: s.tick, result: s.result?.result ?? null, hash: window.__hashOf(s) };
    });
    rep.max = await page.evaluate(() => window.__artMax);
    // 合戦の後の札（崩れた・撤退した部隊の印。状態は見せ方ごとに同じ）
    await page.waitForTimeout(800);
    rep.cardsEnd = await page.evaluate(cardProbe);
    await page.locator('.b-bottom').screenshot({ path: `${OUT}/cards-end-${tag}.png` });
    log(tag, 'hash', JSON.stringify(rep.stateHash), 'max', JSON.stringify(rep.max));
    rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
    report[`plains-${tag}`] = rep;
    await ctx.close();
    return rep;
}

async function plainsPart(kind) {
    const modes = PLAINS_MODES(kind);
    const r = {};
    for (const mode of modes) r[mode] = await plainsRun(kind, mode);
    const { old } = r;
    const [W, H] = SIZES[kind];
    const k = `plains ${W}x${H}`;
    console.log(`== ${k}（${modes.join('・')}）`);
    const others = modes.filter((m) => m !== 'old').map((m) => r[m]);
    check(others.every((m) => m.stateHash.hash === old.stateHash.hash && m.stateHash.tick === old.stateHash.tick), `${k}: 同じ台本・同じ操作で状態の指紋が同じ`, modes.map((m) => [m, r[m].stateHash]));
    for (const m of others) {
        const tg = `${k} ${m.mode}`;
        check(JSON.stringify(m.camera) === JSON.stringify(old.camera), `${tg}: カメラの「全体」が同じ`, [old.camera, m.camera]);
        check(JSON.stringify(m.insetRects) === JSON.stringify(old.insetRects), `${tg}: 余白を決める部品の四角が同じ`, m.insetRects);
        check(JSON.stringify(m.cards.map((c) => [c.id, c.card, c.head])) === JSON.stringify(old.cards.map((c) => [c.id, c.card, c.head])), `${tg}: 札・見出しの四角（幅・高さ）が同じ`, m.cards.map((c) => [c.id, c.card]));
        check(m.visibleSoldiers >= old.visibleSoldiers && m.visibleSoldiers >= 300, `${tg}: 見えている兵士の数が減らない（300 以上）`, [old.visibleSoldiers, m.visibleSoldiers]);
        const wf = wrongFaces(m.cards);
        check(wf.length === 0 && m.cards.filter((c) => c.face).length === 5, `${tg}: 札の顔はその部隊の武将の顔（5 武将。弓隊・騎馬隊には無い）`, wf.length ? wf : m.cards.map((c) => `${c.id}:${c.face}`));
        check(m.cards.filter((c) => c.face).every((c) => c.fit !== 'off' && c.faceW > 0), `${tg}: 開始の時、5 武将の札に顔が見えている（細い顔を含む）`, m.cards.filter((c) => c.face).map((c) => `${c.id}:${c.fit}:${c.faceW}`));
        for (const t of Object.keys(m.badgeCards)) check(m.badgeCards[t].every((c) => c.fit !== 'off' || c.offNeeded === true), `${tg}: 状態の印「${t}」で顔を出さない札は、細い顔でも名前が切れる札だけ`, m.badgeCards[t].filter((c) => c.face).map((c) => `${c.id}:${c.fit}:${c.offNeeded}`));
        const wn = worseNames(old.cards, m.cards);
        check(wn.length === 0, `${tg}: 札の名前が旧表示より短く切れない`, wn);
        for (const t of Object.keys(old.badgeCards)) {
            const wb = worseNames(old.badgeCards[t], m.badgeCards[t]);
            check(wb.length === 0, `${tg}: 状態の印「${t}」でも名前が旧表示より短く切れない（顔は ${[...new Set(m.badgeCards[t].filter((c) => c.face).map((c) => c.fit))].join('・')}）`, wb);
        }
        const we = worseNames(old.cardsEnd, m.cardsEnd);
        check(we.length === 0, `${tg}: 合戦の後（台本の後の印）でも名前が旧表示より短く切れない`, we.length ? we : old.cardsEnd.filter((c) => c.badge).map((c) => `${c.name}:${c.badge}`));
        const bf = m.briefFaces.map((f) => `${f.row}:${f.id}`).sort();
        check(JSON.stringify(bf) === JSON.stringify(['a_ieyasu:face.ieyasu', 'a_ishikawa:face.ishikawa', 'a_sakai:face.sakai', 'a_sakakibara:face.sakakibara', 'a_tadakatsu:face.tadakatsu']), `${tg}: 編成の表の顔は 5 武将の自分の顔`, bf);
        check(JSON.stringify(old.briefRows) === JSON.stringify(m.briefRows) && JSON.stringify(old.briefTable) === JSON.stringify(m.briefTable), `${tg}: 編成の表の行の高さ・表の大きさが同じ`, [old.briefRows, m.briefRows, old.briefTable, m.briefTable]);
        for (const id of ['a_tadakatsu', 'a_ieyasu', 'a_sakai', 'a_sakakibara', 'a_ishikawa']) {
            const o = old[`sel_${id}`];
            const f = m[`sel_${id}`];
            check(f.face?.id === `face.${f.general}` && f.general === id.slice(2) && f.withFace && !o.face, `${tg}: 能力の欄の武将の行（${id}）にその武将の顔（旧表示は無し）`, [f.general, f.face]);
            check(panelSame(o, f) && JSON.stringify(o.topleft) === JSON.stringify(f.topleft), `${tg}: 能力の欄（${id}）：顔があっても欄・能力の見出しの四角が同じ（高さ ${hOf(o.abil)} → ${hOf(f.abil)}）`, { old: [hOf(o.abil), o.abH, o.genText], new: [hOf(f.abil), f.abH, f.genText] });
            check(hOf(f.gen) <= hOf(o.gen), `${tg}: 武将の行（${id}）が折り返さない（${hOf(o.gen)} → ${hOf(f.gen)}）`);
        }
        check(!m.sel_a_kiba.face && !m.sel_a_kiba.withFace, `${tg}: 武将のいない騎馬隊の欄には顔が無い`);
        check(m.abilFaceStable === true, `${tg}: 能力の欄の顔は同じ canvas を置き直す（毎秒作り直さない）`);
        if (old.activeIeyasu && m.activeIeyasu) check(panelSame(old.activeIeyasu, m.activeIeyasu) && m.activeIeyasu.withFace, `${tg}: 能力の欄（家康・効果中）：顔があっても欄の四角が同じ`, [hOf(old.activeIeyasu.abil), hOf(m.activeIeyasu.abil)]);
        for (const id of ['a_ieyasu', 'a_sakai', 'a_sakakibara', 'a_ishikawa']) {
            const o = old.abilities[id];
            const a = m.abilities[id];
            check(!!o && !!a && o.used && a.used && o.how === a.how && (o.target ?? null) === (a.target ?? null), `${tg}: ${id} の能力を ${a?.how} で使えた（旧表示と同じ押し方・対象 ${a?.target ?? 'なし'}）`, [o, a].map((x) => x && { how: x.how, used: x.used, target: x.target, why: x.why }));
            const nv = noticeVsOld(o?.notice, a?.notice, id.slice(2));
            check(nv.ok, `${tg}: ${id} の発動の知らせ：${nv.face ? 'その武将の顔があり、高さは旧表示と同じ' : '顔を出さず（畳んだ・顔で折り返しが増える）、幅・高さとも旧表示と同じ'}（旧表示は顔無し）`, [o?.notice, a?.notice]);
            if (!SIZES[kind][2]) check(nv.face || a?.notice?.fold > 0, `${tg}: ${id} の発動の知らせ：PC の幅の列では（畳まなければ）顔を出す`, a?.notice);
            check(!!a?.notice && a.notice.w < a.notice.vw * 0.6 && a.notice.h < 90 && a.paused === o?.paused && !a.modal, `${tg}: ${id} の発動の知らせは小さい（画面全体を覆わない・止め方を変えない）`, a?.notice && [a.notice.w, a.notice.h]);
            if (o?.notice && a?.notice) check(a.fold === o.fold, `${tg}: ${id} の発動の知らせの畳み方（名札を覆う時に畳む）が旧表示と同じ（${o.fold} → ${a.fold}）`);
        }
        if (m.mode === 'actual') {
            check(m.art.ground === 'vertex' && m.art.trees === 0 && m.max.shadows === 0 && m.max.dust === 0, `${tg}: 実際の素材（顔だけ）：地面・木・影・砂ぼこりは今までどおり`, [m.art, m.max]);
            check(m.artAtReady.ground === 'vertex', `${tg}: 開始のボタンの時も今までの地面`);
        }
        if (m.mode === 'fixture') {
            check(m.art.ground === 'textured' && m.art.trees > 0 && m.artAtReady.ground === 'textured', `${tg}: fixture：素材の地面・円の林の木（開始のボタンを出す前に使う）`, [m.artAtReady, m.art]);
            check(m.max.shadows >= 7 && m.max.dust > 0 && m.max.dust <= 24, `${tg}: fixture：影と砂ぼこり（上限 24）`, { max: m.max, atShot: m.dustAtShot });
        }
        console.log(`     開始のボタンが出るまで：旧 ${old.readyMs} ms・${m.mode} ${m.readyMs} ms`);
    }
    check(old.art.ground === 'vertex' && old.art.trees === 0 && old.max.shadows === 0 && old.max.dust === 0, `${k}: 旧表示：今までの地面・影と砂ぼこりなし`, [old.art, old.max]);
    check(old.faceCount === 0 && old.briefFaces.length === 0 && Object.values(old.abilities).every((a) => !a.notice?.face), `${k}: 旧表示：顔の canvas は 1 つも無い`);
    check(old.cards.every((c) => !c.fit), `${k}: 旧表示：札に顔の大きさの印（data-face）が無い`);
    for (const m of Object.values(r)) check(m.errors.length === 0, `${k} ${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
}

// ---------------------------------------------------------------- 第二章の合戦（old と actual の同じ操作）

/** 歴史分岐の合戦を ?dev=battle で開き、開始して止める */
async function openDevBattle(url, W, H, touch, mode) {
    const ctx = await newCtx(W, H, touch);
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = watchErrors(page);
    const bpress = pressers(page, touch);
    await page.goto(`${BASE}/?q=low&${url}${MODES[mode]}`);
    await page.waitForFunction(() => window.__battle && window.__battle.active, null, POLL);
    await startPaused(page, bpress);
    await page.waitForTimeout(1500);
    return { ctx, page, errors, bpress };
}
/** 同じ速さで刻み tick まで進めた状態の指紋（台本なし） */
async function hashAt(page, tick) {
    await page.evaluate(installHash);
    await page.evaluate((tick) => {
        window.__battle.select(null);
        window.__hashAt = null;
        window.__battle.setScript((s) => {
            if (s.tick === tick && !window.__hashAt) window.__hashAt = { tick: s.tick, hash: window.__hashOf(s) };
        });
        window.__battle.setTimeScale(12);
        window.__battle.pause(false);
    }, tick);
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => ({ h: window.__hashAt, res: window.__battle.state.result }));
        if (st.h || st.res) break;
        await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.__battle.pause(true));
    return page.evaluate(() => {
        if (window.__hashAt) return window.__hashAt;
        const s = window.__battle.state;
        return { tick: s.tick, result: s.result?.result ?? null, hash: window.__hashOf(s) };
    });
}

/**
 * 第二章の合戦：old と actual で同じ操作。札の顔・能力の欄（使える時・効果中）・札・余白の部品・状態の指紋が同じか。
 * policy 'asai'（浅井方）は長政の盟友への援護を「能力」→ 援護する味方で使う
 */
async function ch2Part(policy) {
    for (const [W, H, touch] of CH2_SIZES) {
        const r = {};
        for (const mode of ['old', 'actual']) {
            const { ctx, page, errors, bpress } = await openDevBattle(`dev=battle&scenario=ieyasu2&policy=${policy}`, W, H, touch, mode);
            const tag = `ch2${policy === 'asai' ? 'b' : ''}-${mode}-${W}x${H}`;
            const rep = { mode, W, H };
            rep.insetRects = await insetProbe(page);
            rep.camera = await page.evaluate(() => window.__battle.camera);
            rep.cards = await page.evaluate(cardProbe);
            await page.locator('.b-bottom').screenshot({ path: `${OUT}/${tag}-cards.png` });
            const ids = rep.cards.filter((c) => FACE_GENS.includes(c.gen)).map((c) => c.id);
            rep.ids = ids;
            for (const id of ids) {
                await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
                await bpress(`.b-card[data-id="${id}"]`);
                await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
                await page.waitForTimeout(1200);
                rep[`ready_${id}`] = await page.evaluate(panelProbe);
                await page.screenshot({ path: `${OUT}/${tag}-${id}.png` });
            }
            // 能力を使う（本物の押し）。対象の要る能力（長政の盟友への援護）は援護する味方を押す。効果中の見出しで欄を測る
            for (const id of ids) {
                await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
                await bpress(`.b-card[data-id="${id}"]`);
                await page.waitForFunction((i) => window.__battle.ui.selectedId === i, id, POLL);
                await page.waitForTimeout(500);
                const can = await page.evaluate(() => {
                    const btn = document.querySelector('.b-abil-btn');
                    return !!btn && !btn.classList.contains('dim') && !btn.disabled;
                });
                rep[`can_${id}`] = can;
                if (!can) {
                    // 使えない理由（能力の欄の「使えない：…」の行）
                    rep[`why_${id}`] = await page.evaluate(() => document.querySelector('.b-abil .b-ab-why')?.innerText ?? '');
                    continue;
                }
                const gen = rep.cards.find((c) => c.id === id).gen;
                if (gen === 'nagamasa') {
                    const u = await useWithTarget(page, touch, bpress, id);
                    rep[`note_${id}`] = await noticeProbe(page);
                    rep[`use_${id}`] = { used: u.used, target: u.target ?? null, how: u.how ?? null, why: u.why ?? '' };
                } else {
                    await bpress('.b-abil-btn');
                    // 発動の知らせは 2.5 秒で消えるので先に読む
                    rep[`note_${id}`] = await noticeProbe(page);
                    rep[`use_${id}`] = { used: (await page.evaluate((id) => window.__battle.state.abilities[id]?.usedAt ?? null, id)) !== null };
                }
                await noticeShot(page, `${OUT}/${tag}-${id}-notice-crop.png`);
                await page.waitForTimeout(1100);
                rep[`active_${id}`] = await page.evaluate(panelProbe);
                await page.screenshot({ path: `${OUT}/${tag}-${id}-active.png` });
            }
            rep.stateHash = await hashAt(page, 1200);
            rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
            report[tag] = rep;
            r[mode] = rep;
            log(tag, JSON.stringify({ ids, can: ids.map((i) => rep[`can_${i}`]), use: ids.map((i) => rep[`use_${i}`]), hash: rep.stateHash }));
            await ctx.close();
        }
        const { old, actual } = r;
        const k = `ch2 ${policy} ${W}x${H}`;
        console.log(`== ${k}`);
        const want = policy === 'asai' ? ['ieyasu', 'tadakatsu', 'nagamasa'] : ['ieyasu', 'tadakatsu'];
        const gens = actual.cards.filter((c) => c.face).map((c) => c.gen);
        check(want.every((g) => gens.includes(g)) && JSON.stringify(old.ids) === JSON.stringify(actual.ids), `${k}: 顔のある部隊（${want.join('・')}）`, actual.cards.map((c) => `${c.id}:${c.gen}:${c.face}`));
        const wf = wrongFaces(actual.cards);
        check(wf.length === 0, `${k}: 札の顔はその部隊の武将の顔（ほかの部隊には無い）`, wf);
        check(old.cards.every((c) => !c.face), `${k}: 旧表示の札に顔は無い`);
        const wn = worseNames(old.cards, actual.cards);
        check(wn.length === 0, `${k}: 札の名前が旧表示より短く切れない`, wn);
        for (const id of old.ids) {
            const o = old[`ready_${id}`];
            const f = actual[`ready_${id}`];
            check(f.face?.id === `face.${f.general}` && f.withFace && !o.face, `${k}: ${id} 能力の欄の武将の行にその武将の顔（旧表示は無し）`, f.face);
            check(panelSame(o, f) && (JSON.stringify(o.scroll) === JSON.stringify(f.scroll) || hOf(f.gen) < hOf(o.gen)), `${k}: ${id} 使える時の能力の欄・見出しの四角が同じ（高さ ${hOf(o.abil)} → ${hOf(f.abil)}${hOf(f.gen) < hOf(o.gen) ? '。旧表示で折り返していた武将の行が 1 行になった分だけ低い' : ''}）`, { old: o.genText, actual: f.genText });
            check(hOf(f.gen) <= hOf(o.gen), `${k}: ${id} 武将の行が折り返さない（${hOf(o.gen)} → ${hOf(f.gen)}）`);
            if (f.face) {
                const fb = f.face.box;
                check(fb[1] >= f.abil[1] && fb[3] <= f.abH[1] + 0.5, `${k}: ${id} 顔は欄の上の縁と能力の見出しの間に収まる`, { face: fb, abil: f.abil, abH: f.abH });
            }
            check(old[`can_${id}`] === actual[`can_${id}`] && JSON.stringify(old[`use_${id}`]) === JSON.stringify(actual[`use_${id}`]), `${k}: ${id} 能力の使える・使えない・使い方が同じ`, [old[`use_${id}`], actual[`use_${id}`]]);
            if (actual[`use_${id}`]?.used) {
                const gen = actual.cards.find((c) => c.id === id).gen;
                const on = old[`note_${id}`];
                const an = actual[`note_${id}`];
                if (on && an) {
                    const nv = noticeVsOld(on, an, gen);
                    check(nv.ok, `${k}: ${id} 発動の知らせ：${nv.face ? 'その武将の顔があり、高さは旧表示と同じ' : '顔を出さず、幅・高さとも旧表示と同じ'}（旧表示は顔無し）`, [on, an]);
                } else check(!!an && (an.faceDom === null || an.faceDom === `face.${gen}`), `${k}: ${id} 発動の知らせの顔は出すならその武将の顔（旧表示の知らせは読み逃した）`, an);
                // 畳み方は両方の知らせを読めた時だけ比べる（重い時は旧表示の側で 2.5 秒の知らせを読み逃すことがある）
                if (old[`note_${id}`] && actual[`note_${id}`]) check(actual[`note_${id}`].fold === old[`note_${id}`].fold, `${k}: ${id} 発動の知らせの畳み方が旧表示と同じ`, [old[`note_${id}`].fold, actual[`note_${id}`].fold]);
                else console.log(`     ${k}: ${id} 旧表示の発動の知らせは読み逃した（重い時の時間切れ。畳み方は比べていない）`);
            }
            const oa = old[`active_${id}`];
            const fa = actual[`active_${id}`];
            if (oa && fa) check(panelSame(oa, fa), `${k}: ${id} 効果中の能力の欄・見出しの四角が同じ（「${fa.abHText}」）`, { old: hOf(oa.abil), actual: hOf(fa.abil) });
        }
        if (policy === 'asai') {
            const nid = old.ids.find((i) => actual.cards.find((c) => c.id === i).gen === 'nagamasa');
            // 開始の 3 秒では長政隊は丘の上で孤立していて、援護できる味方が範囲にいないことがある（その時は理由が旧表示と同じか）
            if (actual[`can_${nid}`]) check(!!actual[`use_${nid}`]?.used, `${k}: 長政の盟友への援護を「能力」→ 援護する味方で使えた`, actual[`use_${nid}`]);
            else check(actual[`why_${nid}`] === old[`why_${nid}`], `${k}: 長政の能力は開始の時は使えない（理由は旧表示と同じ：${actual[`why_${nid}`]}）`, [old[`why_${nid}`], actual[`why_${nid}`]]);
        }
        check(JSON.stringify(old.cards.map((c) => [c.id, c.card, c.head])) === JSON.stringify(actual.cards.map((c) => [c.id, c.card, c.head])), `${k}: 札・見出しの四角が同じ`);
        check(JSON.stringify(old.insetRects) === JSON.stringify(actual.insetRects) && JSON.stringify(old.camera) === JSON.stringify(actual.camera), `${k}: 余白を決める部品の四角・カメラの「全体」が同じ`);
        check(!!old.stateHash && old.stateHash.hash === actual.stateHash?.hash && old.stateHash.tick === actual.stateHash?.tick, `${k}: 同じ操作で状態の指紋が同じ`, [old.stateHash, actual.stateHash]);
        for (const m of [old, actual]) check(m.errors.length === 0, `${k} ${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
    }
}

// ---------------------------------------------------------------- 浅井長政（第一章 A・B、援軍救出）

async function nagamasaPart() {
    // ---- 第一章 A：長政は敵の本陣（札は無い）。見えている時に調べた欄に顔があってよい。見えなくなったら欄も顔も出さない ----
    if (NAGAMASA.includes('ch1a')) {
        const r = {};
        for (const mode of ['old', 'actual']) {
            const { ctx, page, errors } = await openDevBattle('dev=battle&scenario=ieyasu&policy=oda', 1280, 720, false, mode);
            const rep = { mode };
            // 見えている顔（display: none の中の物は数えない）・長政隊の札・選択・欄
            const probe = () =>
                page.evaluate(() => ({
                    seen: window.__battle.state.units.find((u) => u.id === 'e_nagamasa').seenBy.ally,
                    faces: [...document.querySelectorAll('.b-face')].filter((f) => f.getClientRects().length > 0).map((f) => f.dataset.artId),
                    card: !!document.querySelector('.b-card[data-id="e_nagamasa"]'),
                    sel: window.__battle.ui.selectedId,
                    abil: !document.querySelector('.b-abil')?.hidden,
                    gen: document.querySelector('.b-abil:not([hidden]) .b-gen')?.dataset.general ?? null,
                    label: (() => {
                        const l = document.querySelector('.b-label[data-id="e_nagamasa"]');
                        return !!l && !l.hidden && l.getClientRects().length > 0;
                    })(),
                }));
            rep.start = await probe();
            rep.cards = await page.evaluate(cardProbe);
            await page.screenshot({ path: `${OUT}/ch1a-${mode}-start.png` });
            // 見えている長政隊を本物のクリックで調べる（体の位置へ寄せるのは表示だけ。開発用の centerOn）
            await page.evaluate(() => {
                const u = window.__battle.state.units.find((x) => x.id === 'e_nagamasa');
                window.__battle.centerOn(u.x, u.z, 160);
            });
            await page.waitForTimeout(1200);
            const s = await page.evaluate(() => window.__battle.screenOf('e_nagamasa'));
            if (s && rep.start.seen) await pointAt(page, false, s.x, s.y);
            await page.waitForTimeout(1200);
            rep.inspect = await probe();
            rep.panel = await page.evaluate(panelProbe);
            await page.screenshot({ path: `${OUT}/ch1a-${mode}-inspect-nagamasa.png` });
            // 見えなくなった時（林に入った・離れた時と同じ印）：開発用に state の seenBy.ally を false にする（直接状態変更。止めたまま。後で戻す）
            await page.evaluate(() => {
                const u = window.__battle.state.units.find((x) => x.id === 'e_nagamasa');
                window.__seenKeep = u.seenBy.ally;
                u.seenBy.ally = false;
            });
            await page.waitForTimeout(1000);
            rep.hidden = await probe();
            // 見えない間に選ぼうとしても（開発用の select）、次のフレームで選択は外れ、欄も顔も出ない
            await page.evaluate(() => window.__battle.select('e_nagamasa'));
            await page.waitForTimeout(1000);
            rep.hiddenSelect = await probe();
            await page.screenshot({ path: `${OUT}/ch1a-${mode}-hidden.png` });
            await page.evaluate(() => {
                const u = window.__battle.state.units.find((x) => x.id === 'e_nagamasa');
                u.seenBy.ally = window.__seenKeep;
            });
            // 同じ速さで刻み 1200 まで（見せ方ごとに同じ指紋）
            rep.stateHash = await hashAt(page, 1200);
            rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
            report[`ch1a-${mode}`] = rep;
            r[mode] = rep;
            log('ch1a', mode, JSON.stringify({ start: rep.start, inspect: rep.inspect, hidden: rep.hidden, hiddenSelect: rep.hiddenSelect, hash: rep.stateHash }));
            await ctx.close();
        }
        const { old, actual } = r;
        console.log('== 第一章 A（長政は敵）');
        check(!actual.start.card && actual.cards.every((c) => c.id !== 'e_nagamasa') && !actual.start.faces.includes('face.nagamasa'), '第一章 A：長政隊の札は無く、調べる前は長政の顔はどこにも無い', actual.start);
        check(wrongFaces(actual.cards).length === 0 && actual.cards.filter((c) => c.face).length === 2, '第一章 A：味方の札の顔は家康・忠勝だけ（織田援軍・弓隊には無い）', actual.cards.map((c) => `${c.id}:${c.face}`));
        if (actual.start.seen) {
            check(actual.inspect.sel === 'e_nagamasa' && actual.inspect.gen === 'nagamasa' && old.inspect.gen === 'nagamasa', '第一章 A：見えている長政隊をクリックで調べると、敵の欄に長政の行（旧表示も同じ）', [old.inspect, actual.inspect]);
            check(actual.panel.face?.id === 'face.nagamasa' && !old.panel?.face, '第一章 A：見えている敵の欄の顔は長政（旧表示は無し）', [old.panel?.face, actual.panel.face]);
            check(panelSame(old.panel, actual.panel), `第一章 A：敵の欄の四角が旧表示と同じ（高さ ${hOf(old.panel?.abil)} → ${hOf(actual.panel.abil)}）`, [old.panel?.genText, actual.panel.genText]);
        } else console.log('     長政隊は開始の時に見えていなかった（見えている時の欄は確かめていない）');
        for (const [k, p] of [
            ['見えなくなった', 'hidden'],
            ['見えない間に選ぼうとした', 'hiddenSelect'],
        ])
            check(
                !actual[p].seen && actual[p].sel !== 'e_nagamasa' && !actual[p].abil && actual[p].gen === null && !actual[p].faces.includes('face.nagamasa') && actual[p].label === old[p].label && actual[p].sel === old[p].sel,
                `第一章 A：長政隊が${k}時は、選択・欄・長政の顔が出ない（名札は旧表示と同じ：${actual[p].label ? '出る' : '出ない'}）`,
                [old[p], actual[p]],
            );
        check(old.stateHash.hash === actual.stateHash.hash && old.stateHash.tick === actual.stateHash.tick, '第一章 A：同じ操作で状態の指紋が同じ', [old.stateHash, actual.stateHash]);
        for (const m of [old, actual]) check(m.errors.length === 0, `第一章 A ${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
    }
    // ---- 第一章 B：長政は味方（札・能力）。old と actual で同じ操作・同じ指紋 ----
    for (const [W, H, touch] of !NAGAMASA.includes('ch1b') ? [] : [
        [1280, 720, false],
        [844, 390, true],
    ]) {
        const r = {};
        for (const mode of ['old', 'actual']) {
            const { ctx, page, errors, bpress } = await openDevBattle('dev=battle&scenario=ieyasu&policy=asai', W, H, touch, mode);
            const tag = `ch1b-${mode}-${W}x${H}`;
            const rep = { mode };
            rep.cards = await page.evaluate(cardProbe);
            rep.insetRects = await insetProbe(page);
            rep.camera = await page.evaluate(() => window.__battle.camera);
            // 開始の時は長政隊の 60 m 以内に味方がいない（盟友への援護を使えない）。同じ台本で忠勝隊を長政隊の横へ寄せる
            // （開発用の order と fastForward。止めたまま 0.5 秒ずつ。見せ方ごとに同じ）
            rep.approach = await page.evaluate(() => {
                const B = window.__battle;
                const u = (id) => B.state.units.find((x) => x.id === id);
                const d = () => Math.hypot(u('t_tadakatsu').x - u('a_nagamasa').x, u('t_tadakatsu').z - u('a_nagamasa').z);
                B.order('t_tadakatsu', { type: 'move', x: u('a_nagamasa').x + 30, z: u('a_nagamasa').z + 20 });
                for (let k = 0; k < 600 && d() > 45 && !B.state.result; k++) B.fastForward(0.5);
                return { t: B.state.t, d: Math.round(d()) };
            });
            await page.waitForTimeout(800);
            await bpress('.b-card[data-id="a_nagamasa"]');
            await page.waitForFunction(() => window.__battle.ui.selectedId === 'a_nagamasa', null, POLL);
            await page.waitForTimeout(1200);
            rep.panel = await page.evaluate(panelProbe);
            await page.screenshot({ path: `${OUT}/${tag}-nagamasa.png` });
            const u = await useWithTarget(page, touch, bpress, 'a_nagamasa', ['a_tadakatsu']);
            rep.use = { used: u.used, target: u.target ?? null, how: u.how ?? null, why: u.why ?? '' };
            await page.waitForTimeout(150);
            rep.notice = await noticeProbe(page);
            await noticeShot(page, `${OUT}/${tag}-nagamasa-notice-crop.png`);
            await page.screenshot({ path: `${OUT}/${tag}-nagamasa-notice.png` });
            rep.stateHash = await hashAt(page, 1200);
            rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
            report[tag] = rep;
            r[mode] = rep;
            log(tag, JSON.stringify({ approach: rep.approach, use: rep.use, notice: rep.notice, hash: rep.stateHash }));
            await ctx.close();
        }
        const { old, actual } = r;
        const k = `第一章 B ${W}x${H}`;
        console.log(`== ${k}（長政は味方）`);
        check(wrongFaces(actual.cards).length === 0 && actual.cards.find((c) => c.id === 'a_nagamasa')?.face === 'face.nagamasa' && actual.cards.find((c) => c.id === 'a_nagamasa')?.fit !== 'off', `${k}: 浅井長政隊の札に長政の顔（家康・忠勝も自分の顔）`, actual.cards.map((c) => `${c.id}:${c.face}:${c.fit}`));
        check(worseNames(old.cards, actual.cards).length === 0, `${k}: 札の名前が旧表示より短く切れない`, worseNames(old.cards, actual.cards));
        check(actual.panel.face?.id === 'face.nagamasa' && actual.panel.withFace && !old.panel.face && panelSame(old.panel, actual.panel), `${k}: 能力の欄の武将の行に長政の顔（欄の四角は旧表示と同じ。高さ ${hOf(old.panel.abil)} → ${hOf(actual.panel.abil)}）`, [old.panel.genText, actual.panel.genText]);
        check(old.use.used && actual.use.used && JSON.stringify(old.use) === JSON.stringify(actual.use), `${k}: 盟友への援護を「能力」→ 援護する味方（${actual.use.how}）で使えた（旧表示と同じ）`, [old.use, actual.use]);
        {
            const nv = noticeVsOld(old.notice, actual.notice, 'nagamasa');
            if (old.notice) check(nv.ok && actual.notice.fold === old.notice.fold, `${k}: 発動の知らせ：${nv.face ? '長政の顔があり、高さは旧表示と同じ' : '顔を出さず、幅・高さとも旧表示と同じ'}（旧表示は顔無し。畳み方は同じ）`, [old.notice, actual.notice]);
            else check(!!actual.notice && (actual.notice.faceDom === null || actual.notice.faceDom === 'face.nagamasa'), `${k}: 発動の知らせの顔は出すなら長政の顔（旧表示の知らせは読み逃した）`, actual.notice);
            if (H > 520 && actual.notice && actual.notice.fold === 0) check(actual.notice.face === 'face.nagamasa', `${k}: PC の幅の列では発動の知らせに長政の顔`, actual.notice);
        }
        check(JSON.stringify(old.insetRects) === JSON.stringify(actual.insetRects) && JSON.stringify(old.camera) === JSON.stringify(actual.camera) && JSON.stringify(old.cards.map((c) => c.card)) === JSON.stringify(actual.cards.map((c) => c.card)), `${k}: 余白の部品・カメラ・札の四角が同じ`);
        check(old.stateHash.hash === actual.stateHash.hash && old.stateHash.tick === actual.stateHash.tick, `${k}: 同じ操作で状態の指紋が同じ`, [old.stateHash, actual.stateHash]);
        for (const m of [old, actual]) check(m.errors.length === 0, `${k} ${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
    }
    // ---- 合戦場の演習「援軍救出」：味方の長政隊（札・能力の欄）・騎馬の榊原康政隊（小さな札で細い顔）・動いている間に石川の能力（対象を選ぶ） ----
    for (const [W, H, touch] of !NAGAMASA.includes('relief') ? [] : [
        [1280, 720, false],
        [844, 390, true],
        [667, 375, true],
    ]) {
        const r = {};
        for (const mode of ['old', 'actual']) {
            const { ctx, page, errors, bpress } = await openDevBattle('dev=field&id=relief', W, H, touch, mode);
            const tag = `relief-${mode}-${W}x${H}`;
            const rep = { mode };
            rep.cards = await page.evaluate(cardProbe);
            rep.badgeCards = await badgeProbe(page, '撤退済み');
            await page.locator('.b-bottom').screenshot({ path: `${OUT}/${tag}-cards.png` });
            // 長政隊の札を選んで能力の欄（長政は丘の上で囲まれていて、開始の時は援護できる味方がいない：理由を読む）
            await page.evaluate(() => document.querySelector('.b-card[data-id="a_nagamasa"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
            await bpress('.b-card[data-id="a_nagamasa"]');
            await page.waitForFunction(() => window.__battle.ui.selectedId === 'a_nagamasa', null, POLL);
            await page.waitForTimeout(800);
            rep.panel = await page.evaluate(panelProbe);
            rep.nagamasaWhy = await page.evaluate(() => document.querySelector('.b-abil .b-ab-why')?.innerText ?? '');
            await page.screenshot({ path: `${OUT}/${tag}-nagamasa.png` });
            // 動いている間（×1）に、石川隊の札 → 「能力」→ 対象の味方を押す。止まらない・全画面の演出が無い
            await page.evaluate(() => window.__battle.pause(false));
            await page.waitForTimeout(400);
            await page.evaluate(() => document.querySelector('.b-card[data-id="a_ishikawa"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
            await bpress('.b-card[data-id="a_ishikawa"]');
            await page.waitForFunction(() => window.__battle.ui.selectedId === 'a_ishikawa', null, POLL);
            await page.waitForTimeout(400);
            const u = await useWithTarget(page, touch, bpress, 'a_ishikawa', ['a_kiba', 'a_yumi']);
            rep.notice = await noticeProbe(page);
            rep.ui = await page.evaluate(() => window.__battle.ui);
            rep.use = { used: u.used, how: u.how ?? null, why: u.why ?? '' };
            await noticeShot(page, `${OUT}/${tag}-ishikawa-notice-crop.png`);
            const t1 = await page.evaluate(() => window.__battle.state.t);
            await page.waitForTimeout(1500);
            rep.advanced = (await page.evaluate(() => window.__battle.state.t)) - t1;
            await page.screenshot({ path: `${OUT}/${tag}-ishikawa-notice.png` });
            await page.evaluate(() => window.__battle.pause(true));
            rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
            report[tag] = rep;
            r[mode] = rep;
            log(tag, JSON.stringify({ cards: rep.cards.map((c) => `${c.id}:${c.face}:${c.fit}`), why: rep.nagamasaWhy, use: rep.use, notice: rep.notice, ui: rep.ui, advanced: rep.advanced }));
            await ctx.close();
        }
        const { old, actual } = r;
        const k = `援軍救出 ${W}x${H}`;
        console.log(`== ${k}`);
        const wf = wrongFaces(actual.cards);
        check(wf.length === 0 && actual.cards.filter((c) => c.face).length === 6, `${k}: 札の顔はその部隊の武将の顔（家康・忠勝・榊原・酒井・石川・長政。弓隊・騎馬隊には無い）`, wf.length ? wf : actual.cards.map((c) => `${c.id}:${c.face}:${c.fit}`));
        // 8 部隊の小さな札（PC 1280×720 は 1 枚 125 px）では、細い顔でも名前が切れる札は顔を出さない（Version 21 より名前を切らない）。その札は本当に細い顔で切れるか
        check(actual.cards.filter((c) => c.face).every((c) => c.fit !== 'off' || c.offNeeded === true), `${k}: 札の顔は見えているか、細い顔でも名前が切れる札だけ出さない（${actual.cards.filter((c) => c.face).map((c) => `${c.name}:${c.fit}`).join('・')}）`, actual.cards.map((c) => `${c.id}:${c.fit}:${c.offNeeded}`));
        check(worseNames(old.cards, actual.cards).length === 0, `${k}: 札の名前が旧表示より短く切れない`, worseNames(old.cards, actual.cards));
        check(worseNames(old.badgeCards, actual.badgeCards).length === 0, `${k}: 状態の印「撤退済み」でも名前が旧表示より短く切れない`, worseNames(old.badgeCards, actual.badgeCards));
        check(JSON.stringify(old.cards.map((c) => [c.card, c.head])) === JSON.stringify(actual.cards.map((c) => [c.card, c.head])), `${k}: 札・見出しの四角が同じ`);
        check(actual.panel.face?.id === 'face.nagamasa' && !old.panel.face && panelSame(old.panel, actual.panel), `${k}: 能力の欄に長政の顔（欄の四角は旧表示と同じ。高さ ${hOf(old.panel.abil)} → ${hOf(actual.panel.abil)}）`, [old.panel.genText, actual.panel.genText]);
        check(actual.nagamasaWhy === old.nagamasaWhy, `${k}: 長政の能力の使える・使えない（理由）が旧表示と同じ：${actual.nagamasaWhy || '使える'}`, [old.nagamasaWhy, actual.nagamasaWhy]);
        check(old.use.used && actual.use.used, `${k}: 動いている間に、石川の能力を「能力」→ 対象の味方（${actual.use.how}）で使えた`, [old.use, actual.use]);
        {
            const nv = noticeVsOld(old.notice, actual.notice, 'ishikawa');
            if (old.notice) check(nv.ok && actual.notice.w < actual.notice.vw * 0.6, `${k}: 発動の知らせ：${nv.face ? '石川の顔があり、高さは旧表示と同じ' : '顔を出さず、幅・高さとも旧表示と同じ'}（小さい。旧表示は顔無し）`, [old.notice, actual.notice]);
            else check(!!actual.notice && (actual.notice.faceDom === null || actual.notice.faceDom === 'face.ishikawa') && actual.notice.w < actual.notice.vw * 0.6, `${k}: 発動の知らせの顔は出すなら石川の顔（旧表示の知らせは読み逃した）`, actual.notice);
            if (H > 520 && actual.notice && actual.notice.fold === 0) check(actual.notice.face === 'face.ishikawa', `${k}: PC の幅の列では発動の知らせに石川の顔`, actual.notice);
        }
        check(!actual.ui.paused && !actual.ui.modal && actual.advanced > 0 && !old.ui.paused, `${k}: 能力を使っても止まらない・全画面の演出が無い（1.5 秒の間に合戦の時刻が ${actual.advanced.toFixed(1)} 秒進む）`, actual.ui);
        for (const m of [old, actual]) check(m.errors.length === 0, `${k} ${m.mode}: ページの誤り無し`, m.errors.slice(0, 3));
    }
}

/**
 * 地面の素材が遅れて届く（画像だけ 7 秒遅らせる。PC・fixture）：開始のボタンは木の後 2.5 秒までしか待たない。出した後に届いた素材は使わず、
 * 合戦の途中で地面を差し替えない。同じページの次の合戦では、説明の間に使う（画像と型紙は覚えている）
 */
async function latePart() {
    const DELAY = 7000;
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = watchErrors(page);
    let delayOn = true;
    const groundReq = [];
    await page.route('**/dev-art/art/battle/plains_*.webp', async (route) => {
        groundReq.push({ url: route.request().url(), at: Date.now(), delayed: delayOn });
        if (delayOn) await new Promise((r) => setTimeout(r, DELAY));
        await route.continue();
    });
    const arrived = [];
    page.on('requestfinished', (q) => /plains_.*\.webp/.test(q.url()) && arrived.push(Date.now()));
    const press = async (sel) => {
        await page.waitForTimeout(450);
        await page.locator(sel).first().scrollIntoViewIfNeeded();
        await page.click(sel);
    };
    const bpress = pressers(page, false);
    const waitSheet = (name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
    const rep = {};
    await page.goto(`${BASE}/?q=low&artFixture=1`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    const toBattle = async (fromTitle) => {
        if (fromTitle) await press('[data-id="practice"]');
        await waitSheet('practice-list');
        await press('[data-id="field:plains"]');
        await waitSheet('practice-briefing');
        await press('.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
        await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
        const t0 = Date.now();
        await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 300000, polling: 50 });
        return { t0, readyAt: Date.now() };
    };
    // ---- 1 回目：素材は開始のボタンの後に届く
    const first = await toBattle(true);
    rep.first = { readyMs: first.readyAt - first.t0, artAtReady: await page.evaluate(() => window.__battle.art()) };
    const until = Date.now() + DELAY + 15000;
    while (arrived.length < 4 && Date.now() < until) await page.waitForTimeout(200);
    rep.first.arrivedAfterReadyMs = arrived.length ? Math.max(...arrived) - first.readyAt : null;
    await page.waitForTimeout(1500);
    rep.first.artAfterArrive = await page.evaluate(() => window.__battle.art());
    // 合戦を始めても差し替えない
    await bpress('.b-primary');
    await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
    await page.waitForTimeout(2500);
    rep.first.artInBattle = await page.evaluate(() => window.__battle.art());
    await page.screenshot({ path: `${OUT}/late-1-battle.png` });
    // 全軍撤退（本物の押し）→ 早送りで終える → 結果 → 演習の結果 → 一覧
    await bpress('.b-allret');
    await page.waitForSelector('.b-modal .b-primary', { timeout: 30000 });
    await bpress('.b-modal .b-primary');
    for (let i = 0; i < 12 && !(await page.evaluate(() => window.__battle.state.result)); i++) await page.evaluate(() => window.__battle.fastForward(60));
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    await press('.b-primary');
    await waitSheet('practice-result');
    await press('.g-layer[data-sheet="practice-result"] [data-id="list"]');
    await waitSheet('practice-list');
    // ---- 2 回目：遅らせない（もう読んである）。説明の間に素材の地面
    delayOn = false;
    const nReq = groundReq.length;
    const second = await toBattle(false);
    rep.second = { readyMs: second.readyAt - second.t0, artAtReady: await page.evaluate(() => window.__battle.art()), newRequests: groundReq.length - nReq };
    await page.screenshot({ path: `${OUT}/late-2-briefing.png` });
    rep.errors = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
    report.late = rep;
    log('late', JSON.stringify(rep));
    console.log('== late');
    check(rep.first.artAtReady.ground === 'vertex' && rep.first.readyMs < DELAY, '遅れた素材：開始のボタンは素材を待ちきらずに出る（今までの地面）', { readyMs: rep.first.readyMs });
    check(rep.first.arrivedAfterReadyMs !== null && rep.first.arrivedAfterReadyMs > 0, '遅れた素材：素材は開始のボタンの後に届いた', rep.first.arrivedAfterReadyMs);
    check(rep.first.artAfterArrive.ground === 'vertex' && rep.first.artAfterArrive.trees === 0 && rep.first.artInBattle.ground === 'vertex' && rep.first.artInBattle.shadows === 0, '遅れた素材：届いた後も・合戦の途中も地面を差し替えない（影・円の林の木も出さない）', [rep.first.artAfterArrive, rep.first.artInBattle]);
    check(rep.second.artAtReady.ground === 'textured' && rep.second.artAtReady.trees > 0, '次の合戦：説明の間に素材の地面（開始のボタンの前）', rep.second);
    check(rep.second.newRequests === 0, '次の合戦：地面の画像を読み直さない（覚えている）', rep.second.newRequests);
    check(rep.errors.length === 0, 'late: ページの誤り無し', rep.errors.slice(0, 3));
    await ctx.close();
}

for (const kind of PARTS.filter((k) => k in SIZES)) await plainsPart(kind);
if (PARTS.includes('ch2')) await ch2Part('oda');
if (PARTS.includes('ch2b')) await ch2Part('asai');
if (PARTS.includes('nagamasa')) await nagamasaPart();
if (PARTS.includes('late')) await latePart();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await b.close();
console.log(fails.length ? `NG ${fails.length}: ${fails.join(' / ')}` : 'ALL OK');
process.exit(fails.length ? 1 : 0);
