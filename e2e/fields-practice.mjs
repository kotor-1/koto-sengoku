/**
 * 合戦場の演習の通しの確認：タイトル → 合戦場の演習 → 戦場の一覧 → 戦場を選ぶ → 合戦の前の説明 → 出陣 → 合戦 → 結果 → 記録の保存 → 一覧、
 * を実際のブラウザで、実際のクリック・キー（PC）・タップ（スマホ）で通す。
 *   BASE=http://localhost:8174 node e2e/fields-practice.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 *   既定の出力先は e2e-out/fields-practice/。PARTS=desktop,phone,eight,oldsaves で一部だけ（既定はすべて）。
 *
 * desktop（PC 1280×720、マウスとキー）：
 *   - 一覧・説明の画面の中身と並び（横にはみ出さない・札が重ならない・ボタンが画面の中）。説明の「一覧へ戻る」。
 *   - 15 戦場（第1群・第2群・第3群）すべてを、タイトルから「合戦場の演習 → 戦場を選ぶ → 出陣」して合戦の画面が出る（戦場 id・部隊数・敵はすべて敵勢）。
 *   - 大平原（味方 7 部隊）：キー 1〜8・札のクリックで選ぶ、地面のクリックで移動、A → 敵のクリックで攻撃、H で防衛・待機、R で撤退。
 *     命令が届いたことを合戦の状態（window.__battle.state の部隊の order）で確かめる。
 *   - 地形が効いていること（戦場ごとに 1 枚撮る：出力先/terrain-<戦場id>.png）。命令は札のクリックと地面のクリックで出し、
 *     時間は早送り（window.__battle.fastForward）で進め、状態を読んで確かめる：
 *       大平原：東の林の中の敵の騎馬は見えない。河川・浅瀬：深い川は通らず浅瀬を通る道を作る・浅瀬の中は動きが遅い。
 *       丘陵：騎馬を頂へ上げる（主目標の区域）。森林：林の中は動きが遅い・林の中の伏兵は見えない・林の中の味方は敵から見えない。
 *       山道・峠：崖の中へ入らず、峠道を通って関へ上がる。
 *       一本橋・複数橋：深い川（橋の外）へ入らず、橋を通って渡る。尾根：西の登り道から尾根の西の端へ上がる（崖の中へ入らない）。
 *       谷間：西の高地へ南の端から登る（高さ 8 m 以上）。水田：水田の中は街道より動きが遅い。
 *       第3群：湿地：泥の中は土手道より動きがとても遅い。村落：家屋の中へ入らず、通りを通って屋敷前の広場へ着く。
 *       寺社周辺：騎馬が崖・建物の中へ入らず、東の脇道を回って境内の東の口の手前へ着く。城下町外縁：家屋の中へ入らず、大通りを北の口へ。
 *       城攻め前面：閉じた外門の奥（曲輪）へ移動を命じても、石垣・門を通り抜けない（門の前で止まる）。
 *   - 丘陵は、通常の速さ（×1。一時停止しない）のまま、札と地面のクリックで先に頂を取る作戦（命令 6 回）を出してから、早送りで決着まで進め、勝つ。
 *     合戦の結果の画面（勝敗・主目標・副目標が別の行）→ 続ける → 演習の結果（勝敗・主目標・副目標・保存が別の行）→ 一覧。
 *   - ほかの 14 戦場は、全軍撤退のボタン（確かめのボタンも）を押してから早送りで終える（撤退の記録）。
 *   - 最後に開き直し（再読み込み）て、15 戦場の記録（丘陵は決着の結果）が一覧と保存に残っていることを確かめる。書いたキーは koto-sengoku/3d-fields だけ。
 * phone（スマホ横 844×390、hasTouch・isMobile、タップ）：
 *   - 一覧・説明の画面の中身と並び。大平原に出陣。札の列を横になぞってずらす（なぞっても選ばない）→ 7 番目の札をタップで選ぶ、
 *     地図のタップで移動、「攻撃」→ 敵のタップで攻撃、「防衛・待機」、「撤退」。全軍撤退 → 早送り → 結果 → 演習の結果 → 一覧（どれもタップ）。
 * eight（開発用の入口 ?dev=field&id=plains&allies=8 で味方を 8 部隊にする）：
 *   - PC：キー 8・8 番目の札のクリックで選ぶ。スマホ：札の列を横になぞって 7・8 番目の札を出し、タップで選ぶ。
 * oldsaves（PC）：古い保存を全部入れた状態（歴史分岐 版 1・架空の第一章 版 1・2D 版）で開き、演習を 1 回遊んでも古い保存は 1 字も変わらない。
 *   歴史分岐・架空の第一章をそれぞれ「つづきから」で続けられ（中身が壊れない。田代・大森のまま）、読むだけでは書き換えない。
 *   架空の第一章をメニューから保存し直した版 2 と、歴史分岐の版 1・2D 版を並べても同じ。2D 版のキー koto-sengoku/save は最後まで同じ。
 *
 * 確認の種類：画面の操作はすべて本物のクリック・キー・タップ。「早送り」は window.__battle.fastForward（開発用。合戦の時間を進めるだけ）。
 * カメラの位置は、撮影と地面のクリックのために window.__battle.centerOn で合わせる（表示だけ。合戦の状態は変えない）。
 * 状態は window.__practice・window.__game・window.__battle から読むだけ（命令・選択を状態へ直接書き込まない）。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/fields-practice';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone,eight,oldsaves').split(',');
/** 演習の 15 戦場（第1群 5・第2群 5・第3群 5。演習の一覧の順） */
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy', 'marsh', 'village', 'temple', 'town_edge', 'siege_front'];
/** 通常の速さで動かしてから早送りで決着まで進める戦場 */
const DECIDE_FIELD = 'hills';
const failures = [];
const T0 = Date.now();
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launchBrowser();

async function openPage(kind, url = '/?q=low') {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    // ソフトウェア描画のコンテナは重い（読み込み・撮影に時間がかかる）
    page.setDefaultTimeout(240000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') {
            // 開き直しの途中で読みかけのテクスチャが切れるのは誤りではない
            if (/Couldn't load texture blob:/.test(m.text())) return;
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}${url}`);
    return { page, ctx, phone, kind, t0 };
}
async function openTitle(kind) {
    const p = await openPage(kind);
    await waitTitle(p.page);
    log(`[${kind}] タイトルまで ${Date.now() - p.t0} ms`);
    return p;
}
const waitTitle = (page) => page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);

/** 押す（PC：クリック、スマホ：タップ）。出たばかりのボタンは決まらない（ui/guard.ts）ので、少し待ってから */
async function press(p, sel) {
    await p.page.waitForTimeout(450);
    await p.page.locator(sel).first().scrollIntoViewIfNeeded();
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
}
/** 合戦の画面のボタン（出たばかりの決まりは無い）。押した後に 1 コマ待つ */
async function bpress(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(150);
}

const pr = (page) => page.evaluate(() => ({ screen: window.__practice?.screen, fieldId: window.__practice?.fieldId, ui: window.__practice?.ui }));
const waitSheet = (page, name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);
const bui = (page) => page.evaluate(() => window.__battle.ui);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { id: u.id, x: u.x, z: u.z, order: u.order, status: u.status, present: u.present, seen: { ...u.seenBy }, path: u.path ? u.path.pts.map((q) => ({ x: q.x, z: q.z })) : null };
    }, id);
const orderOf = async (page, id) => (await unit(page, id))?.order;
const simT = (page) => page.evaluate(() => window.__battle.state.t);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);

/** 地面の (x, z) をクリック・タップする（カメラをそこへ向けてから。カメラは表示だけ） */
async function clickGround(p, x, z, dist) {
    await p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, dist ?? null]);
    await p.page.waitForTimeout(250);
    const g = await p.page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
    if (p.phone) await p.page.touchscreen.tap(g.x, g.y);
    else await p.page.mouse.click(g.x, g.y);
    await p.page.waitForTimeout(150);
}
/** 部隊をクリック・タップする（カメラをその部隊へ向けてから） */
async function clickUnit(p, id) {
    const u = await unit(p.page, id);
    await p.page.evaluate(([x, z]) => window.__battle.centerOn(x, z), [u.x, u.z]);
    await p.page.waitForTimeout(250);
    const s = await p.page.evaluate((id) => window.__battle.screenOf(id), id);
    if (p.phone) await p.page.touchscreen.tap(s.x, s.y);
    else await p.page.mouse.click(s.x, s.y);
    await p.page.waitForTimeout(150);
}
/** 札の列を横になぞる（タッチ。dx < 0 で左へ＝右の札を出す） */
async function swipeCards(p, dx) {
    const box = await p.page.evaluate(() => { const r = document.querySelector('.b-cards').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const cdp = await p.ctx.newCDPSession(p.page);
    const y = box.y + box.h / 2;
    const x0 = dx < 0 ? box.x + box.w * 0.85 : box.x + box.w * 0.15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 10, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await p.page.waitForTimeout(250);
}
/** 札が列の見える所にあるか */
const cardVisible = (page, id) =>
    page.evaluate((id) => {
        const l = document.querySelector('.b-cards').getBoundingClientRect();
        const c = document.querySelector(`.b-card[data-id="${id}"]`)?.getBoundingClientRect();
        return !!c && c.left >= l.left - 1 && c.right <= l.right + 1;
    }, id);
/** 一時停止（指揮）を画面のボタンで合わせる */
async function setPaused(p, want) {
    if ((await bui(p.page)).paused !== want) await bpress(p, '.b-pause');
    check((await bui(p.page)).paused === want, `[${p.kind}] 「指揮」のボタンで${want ? '一時停止' : '再開'}`);
}
async function shot(p, name, x, z, dist) {
    // PC は選択を外してから撮る（左の能力の欄が地図を隠さないように）
    if (!p.phone) await p.page.keyboard.press('Escape');
    if (x !== undefined) await p.page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, dist ?? null]);
    await p.page.waitForTimeout(700);
    await p.page.screenshot({ path: `${OUT}/${name}.png` });
    log(`   撮影 ${name}`);
}

/** 画面の並びの確かめ：横のはみ出し・札どうしの重なり・ボタンが画面の中 */
async function layoutCheck(p, label, cardSel) {
    const r = await p.page.evaluate((cardSel) => {
        const vw = window.innerWidth;
        const layer = document.querySelector('.g-layer[data-kind="sheet"]');
        const sheet = layer?.querySelector('.g-sheet');
        const overflowX = sheet ? sheet.scrollWidth - sheet.clientWidth : -1;
        const cards = [...document.querySelectorAll(cardSel)].map((e) => e.getBoundingClientRect());
        let overlap = 0;
        for (let i = 0; i < cards.length; i++)
            for (let j = i + 1; j < cards.length; j++) {
                const a = cards[i];
                const c = cards[j];
                if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) overlap++;
            }
        const outside = [...document.querySelectorAll('.g-layer[data-kind="sheet"] *')].filter((e) => {
            const b = e.getBoundingClientRect();
            return b.width > 0 && (b.left < -1 || b.right > vw + 1);
        }).length;
        const btns = [...document.querySelectorAll('.g-layer[data-kind="sheet"] .g-sheet-btns .g-btn')].map((e) => e.getBoundingClientRect());
        const btnsVisible = btns.every((b) => b.top >= 0 && b.bottom <= window.innerHeight + 1 && b.left >= 0 && b.right <= vw + 1);
        return { overflowX, cards: cards.length, overlap, outside, btnsVisible, btns: btns.length };
    }, cardSel);
    check(r.overflowX === 0, `[${p.kind}] ${label}：横にはみ出さない`, `scrollWidth-clientWidth=${r.overflowX}`);
    check(r.overlap === 0, `[${p.kind}] ${label}：札どうしが重ならない`, `${r.cards} 枚・重なり ${r.overlap}`);
    check(r.outside === 0, `[${p.kind}] ${label}：画面の左右の外に出る要素がない`, `${r.outside}`);
    check(r.btnsVisible, `[${p.kind}] ${label}：下のボタンが画面の中に見えている`, `${r.btns} 個`);
    return r;
}

async function scrollShots(p, name) {
    await p.page.screenshot({ path: `${OUT}/${name}.png` });
    const more = await p.page.evaluate(() => {
        const s = document.querySelector('.g-layer[data-kind="sheet"] .g-sheet');
        return s ? s.scrollHeight - s.clientHeight : 0;
    });
    if (more > 4) {
        await p.page.evaluate(() => {
            const s = document.querySelector('.g-layer[data-kind="sheet"] .g-sheet');
            s.scrollTop = s.scrollHeight;
        });
        await p.page.waitForTimeout(200);
        await p.page.screenshot({ path: `${OUT}/${name}-end.png` });
        await p.page.evaluate(() => {
            document.querySelector('.g-layer[data-kind="sheet"] .g-sheet').scrollTop = 0;
        });
    }
}

// ================================================================ タイトル・一覧・説明

/** タイトルの入口を確かめて一覧を開く */
async function titleToList(p, detailed) {
    const { page, kind } = p;
    if (detailed) {
        await page.screenshot({ path: `${OUT}/${kind}-0-title.png` });
        const entry = await page.evaluate(() => {
            const e = document.querySelector('[data-practice="entry"]');
            const ids = [...document.querySelectorAll('.g-title-layer .g-btn')].map((b) => b.dataset.id);
            return { text: e?.textContent ?? '', ids };
        });
        check(entry.text.includes('合戦場の演習') && entry.text.includes('架空の相手'), `[${kind}] タイトルに「合戦場の演習」の入口`);
        check(JSON.stringify(entry.ids) === JSON.stringify(['new:ieyasu1570', 'continue:ieyasu1570', 'new:fictional', 'continue:fictional', 'practice']), `[${kind}] タイトルのボタンの並び（シナリオの 4 つは今のまま）`, entry.ids.join(','));
    }
    await press(p, '[data-id="practice"]');
    await waitSheet(page, 'practice-list');
    await page.waitForTimeout(300);
    check((await pr(page)).screen === 'list', `[${kind}] 一覧の画面（__practice.screen=list）`);
    if (!detailed) return;
    const list = await page.evaluate(() => ({
        fields: [...document.querySelectorAll('.g-pr-field')].map((e) => e.dataset.field),
        text: document.querySelector('.g-pr-list')?.textContent ?? '',
    }));
    check(JSON.stringify(list.fields) === JSON.stringify(FIELD_IDS_ORDER), `[${kind}] ${FIELD_IDS_ORDER.length} 戦場が演習の順に並ぶ`, list.fields.join(','));
    check(list.text.includes('ゲーム用の演習（架空の相手）'), `[${kind}] 「ゲーム用の演習（架空の相手）」と出る`);
    check(list.text.includes('主目標') && list.text.includes('副目標') && list.text.includes('最後'), `[${kind}] 主目標・副目標・記録の欄`);
    await layoutCheck(p, '一覧', '.g-pr-field');
    await scrollShots(p, `${kind}-1-list`);
}
const FIELD_IDS_ORDER = FIELD_IDS;

/** 一覧 → 説明（大平原は中身と並びを細かく確かめ、「一覧へ戻る」も押す）→ 出陣 → 合戦の画面 */
async function listToBattle(p, id, detailed) {
    const { page, kind } = p;
    await press(p, `[data-id="field:${id}"]`);
    await waitSheet(page, 'practice-briefing');
    await page.waitForTimeout(300);
    const s2 = await pr(page);
    check(s2.screen === 'briefing' && s2.fieldId === id, `[${kind}] 説明の画面（${id}）`);
    const brief = await page.evaluate(() => ({
        text: document.querySelector('.g-pr-brief')?.textContent ?? '',
        field: document.querySelector('.g-pr-brief')?.dataset.field,
        units: [...document.querySelectorAll('.g-pr-units tr[data-unit]')].map((e) => e.dataset.unit),
        prov: document.querySelectorAll('.g-pr-units td.ab .g-tag').length,
        primary: document.querySelector('[data-objective="primary"]')?.textContent ?? '',
        secondary: [...document.querySelectorAll('.g-pr-brief [data-objective="secondary"]')].map((e) => e.textContent),
    }));
    check(brief.field === id && brief.primary.length > 0 && brief.secondary.length >= 1, `[${kind}] ${id} の説明：主目標と副目標が別の行`, `${brief.primary} / ${brief.secondary.join('')}`);
    if (detailed) {
        check(brief.units.length === 7, `[${kind}] 味方の編成 7 部隊`, brief.units.join(','));
        check(brief.prov >= 2, `[${kind}] 仮の能力に「仮」の印`, `${brief.prov}`);
        check(brief.primary.includes('敵勢の本陣を崩す'), `[${kind}] 大平原の主目標`);
        check(brief.text.includes('酒井忠次') && brief.text.includes('石川数正'), `[${kind}] 率いる武将の名前`);
        await layoutCheck(p, '説明', '.g-pr-sec');
        await scrollShots(p, `${kind}-2-briefing`);
        // 戻る → 一覧 → もう一度
        await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="back"]');
        await waitSheet(page, 'practice-list');
        check((await pr(page)).screen === 'list', `[${kind}] 説明の「一覧へ戻る」で一覧へ`);
        await press(p, `[data-id="field:${id}"]`);
        await waitSheet(page, 'practice-briefing');
    }
    const t0 = Date.now();
    await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    const s3 = await page.evaluate(() => ({
        screen: window.__practice.screen,
        map: window.__battle.state.map.id,
        field: document.querySelector('.b-root')?.dataset.field,
        allies: window.__battle.state.units.filter((u) => u.side === 'ally').length,
        enemies: window.__battle.state.units.filter((u) => u.side === 'enemy').length,
        rival: window.__battle.state.units.filter((u) => u.side === 'enemy' && u.clan === 'rival').length,
        game: window.__game.screen,
    }));
    log(`[${kind}] 出陣から合戦の画面まで ${Date.now() - t0} ms`);
    check(s3.screen === 'battle' && s3.map === id && s3.field === id && s3.enemies > 0 && s3.rival === s3.enemies && s3.allies === brief.units.length, `[${kind}] ${id}：合戦の画面（戦場 id・味方は説明の編成と同じ数・敵はすべて敵勢）`, JSON.stringify(s3));
    check(s3.game === 'practice', `[${kind}] 章の進行は演習中（__game.screen=practice）`);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 120000, polling: 250 });
    await page.waitForTimeout(400);
    if (detailed) await page.screenshot({ path: `${OUT}/${kind}-3-battle.png` });
    // 合戦を始める
    await bpress(p, '.b-primary');
    await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
    const nCards = await page.evaluate(() => document.querySelectorAll('.b-card').length);
    check(nCards === s3.allies, `[${kind}] ${id}：札の数 = 味方の部隊の数（${s3.allies}）`, String(nCards));
    return s3;
}

// ================================================================ 決着・結果・記録

/** 全軍撤退のボタン（と確かめ）を押してから、早送りで終える */
async function retreatAndFinish(p) {
    await setPaused(p, false);
    await bpress(p, '.b-allret');
    await p.page.waitForSelector('.b-modal .b-primary', { timeout: 30000 });
    await bpress(p, '.b-modal .b-primary');
    const r = await p.page.evaluate(() => window.__battle.state.allRetreatAt);
    check(r !== null, `[${p.kind}] 全軍撤退のボタンで全軍撤退が始まる`, String(r));
    for (let i = 0; i < 12 && !(await p.page.evaluate(() => window.__battle.state.result)); i++) await ff(p.page, 60);
}

/** 合戦の結果の画面 → 続ける → 演習の結果 → 一覧 → タイトル。期待する勝敗 want（null なら合戦の結果に合わせる） */
async function resultToTitle(p, id, want) {
    const { page, kind } = p;
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
    await page.waitForTimeout(500);
    const o = await page.evaluate(() => {
        const s = window.__battle.state;
        return { result: s.result?.result ?? null, reason: s.result?.reason ?? null, t: s.t };
    });
    const bres = await page.evaluate(() => ({
        h2: document.querySelector('.b-result h2')?.textContent ?? '',
        rows: [...document.querySelectorAll('.b-robj-row')].map((r) => ({ role: r.dataset.role, achieved: r.dataset.achieved, text: r.textContent })),
        pledgeHidden: (() => { const e = document.querySelector('.b-rpledge'); return !e || e.hidden || getComputedStyle(e).display === 'none'; })(),
        decided: window.__battle.ui.decided,
    }));
    check(!!bres.decided && bres.decided.ok, `[${kind}] ${id}：合戦の結果の画面に「演習の記録を保存しました」`, JSON.stringify(bres.decided));
    check(bres.rows.length >= 2 && bres.rows[0].role === 'primary' && bres.rows.slice(1).every((r) => r.role === 'secondary'), `[${kind}] ${id}：合戦の結果の画面で、主目標・副目標が勝敗と別の行`, bres.rows.map((r) => `${r.role}:${r.achieved}`).join(' '));
    check(bres.pledgeHidden, `[${kind}] ${id}：演習には約束の欄が無い`);
    await page.screenshot({ path: `${OUT}/${kind}-${id}-4-battle-result.png` });
    await press(p, '.b-primary');
    await waitSheet(page, 'practice-result');
    await page.waitForTimeout(300);
    const res = await page.evaluate((id) => ({
        screen: window.__practice.screen,
        field: document.querySelector('.g-pr-result')?.dataset.field,
        outcome: document.querySelector('.g-pr-result [data-outcome]')?.dataset.outcome,
        primary: document.querySelector('.g-pr-result [data-objective="primary"]')?.dataset.achieved,
        secondary: [...document.querySelectorAll('.g-pr-result [data-objective="secondary"]')].map((e) => e.dataset.achieved),
        saved: document.querySelector('.g-pr-result [data-saved]')?.dataset.saved,
        rec: window.__practice.records?.status === 'ok' ? window.__practice.records.data.records[id] : null,
        last: window.__practice.lastOutcome && { result: window.__practice.lastOutcome.result, objectives: window.__practice.lastOutcome.objectives },
        body: document.body.className,
    }), id);
    const wantResult = want ?? o.result;
    check(res.screen === 'result' && res.field === id && res.outcome === wantResult, `[${kind}] ${id}：演習の結果の画面（勝敗 ${wantResult}）`, JSON.stringify({ screen: res.screen, outcome: res.outcome, reason: o.reason, t: Math.round(o.t) }));
    const lp = res.last?.objectives?.primary?.achieved;
    const ls = res.last?.objectives?.secondary?.map((x) => String(x.achieved)) ?? [];
    check(res.primary === String(lp) && JSON.stringify(res.secondary) === JSON.stringify(ls) && res.secondary.length >= 1 && res.secondary.length === bres.rows.length - 1,
        `[${kind}] ${id}：勝敗・主目標・副目標が別々の行（合戦の結果と同じ達成）`, JSON.stringify({ p: res.primary, s: res.secondary }));
    check(res.saved === 'true' && !!res.rec && res.rec.last.result === wantResult && res.rec.last.primary?.achieved === lp, `[${kind}] ${id}：記録が保存されている（読み直した保存の最後の結果）`, JSON.stringify(res.rec?.last && { result: res.rec.last.result, primary: res.rec.last.primary, secondary: res.rec.last.secondary }));
    check(!res.body.includes('mode-battle'), `[${kind}] ${id}：合戦の場面を出ている`);
    await page.screenshot({ path: `${OUT}/${kind}-${id}-5-result.png` });
    await press(p, '.g-layer[data-sheet="practice-result"] [data-id="list"]');
    await waitSheet(page, 'practice-list');
    const rec = await page.evaluate((id) => document.querySelector(`.g-pr-field[data-field="${id}"] .rec`)?.textContent ?? '', id);
    check(rec.length > 0, `[${kind}] 一覧の ${id} に最後の記録`, rec);
    await press(p, '.g-layer[data-sheet="practice-list"] [data-id="back"]');
    await waitTitle(page);
    const back = await page.evaluate(() => ({ screen: window.__practice.screen, game: window.__game.screen, state: window.__game.state }));
    check(back.screen === 'closed' && back.game === 'title' && back.state === null, `[${kind}] タイトルへ戻る（章の状態なし）`);
    return { ...o, primary: lp, secondary: res.last?.objectives?.secondary?.map((x) => x.achieved) };
}

// ================================================================ 大平原：PC の操作（キー・クリック）

async function plainsOrdersPc(p) {
    const { page } = p;
    await setPaused(p, true);
    const allies = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => u.id));
    const keys = await page.evaluate(() => [...document.querySelectorAll('.b-card')].map((c) => `${c.dataset.key}:${c.dataset.id}`));
    check(allies.length === 7, '[desktop] 大平原：味方 7 部隊', keys.join(' '));
    for (let i = 0; i < allies.length; i++) {
        await page.keyboard.press(`Digit${i + 1}`);
        await page.waitForTimeout(80);
        const u = await bui(page);
        check(u.selectedId === allies[i] && u.selection.length === 1, `[desktop] キー ${i + 1} で ${allies[i]} を選ぶ`);
    }
    await page.keyboard.press('Digit8');
    await page.waitForTimeout(80);
    check((await bui(page)).selectedId === allies[6], '[desktop] キー 8（8 部隊目が無い）では選び直さない');
    const fit = await page.evaluate(() => { const l = document.querySelector('.b-cards'); return l.scrollWidth <= l.clientWidth + 1; });
    check(fit, '[desktop] 7 部隊の札が横にはみ出さずに並ぶ');
    // 札のクリック：1 番目と 7 番目
    await bpress(p, `.b-card[data-id="${allies[0]}"]`);
    check((await bui(page)).selectedId === allies[0], `[desktop] 1 番目の札のクリックで選ぶ（${allies[0]}）`);
    await bpress(p, `.b-card[data-id="${allies[6]}"]`);
    check((await bui(page)).selectedId === allies[6] && (await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`).classList.contains('sel'), allies[6])), `[desktop] 7 番目の札のクリックで選ぶ（${allies[6]}・札に選んだ印）`);
    // 酒井隊：移動（地面のクリック）→ 攻撃（A → 敵のクリック）→ 防衛・待機（H）
    await page.keyboard.press(`Digit${allies.indexOf('a_sakai') + 1}`);
    await clickGround(p, -60, 20, 260);
    let o = await orderOf(page, 'a_sakai');
    check(o.type === 'move' && Math.abs(o.x + 60) < 6 && Math.abs(o.z - 20) < 6, '[desktop] 地面のクリックで移動（酒井隊 → (-60, 20)）', JSON.stringify(o));
    const enemy = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'e_left' && u.seenBy.ally)?.id ?? window.__battle.state.units.find((u) => u.side === 'enemy' && u.present && u.seenBy.ally && !u.isHq)?.id);
    await page.keyboard.press('KeyA');
    check((await bui(page)).pending === 'attack', '[desktop] A で攻撃の敵を選ぶ待ちになる');
    await clickUnit(p, enemy);
    o = await orderOf(page, 'a_sakai');
    check(o.type === 'attack' && o.targetId === enemy, `[desktop] 敵のクリックで攻撃（${enemy}）`, JSON.stringify(o));
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(80);
    check((await orderOf(page, 'a_sakai')).type === 'hold', '[desktop] H で防衛・待機');
    // 忠勝隊：「攻撃」のボタン → 敵のクリック
    await bpress(p, `.b-card[data-id="a_tadakatsu"]`);
    await bpress(p, '.b-cmd:has-text("攻撃")');
    await clickUnit(p, 'e_sente');
    o = await orderOf(page, 'a_tadakatsu');
    check(o.type === 'attack' && o.targetId === 'e_sente', '[desktop] 「攻撃」のボタン → 敵のクリックで攻撃（忠勝隊 → 敵勢の先手）', JSON.stringify(o));
    await bpress(p, '.b-cmd:has-text("防衛・待機")');
    check((await orderOf(page, 'a_tadakatsu')).type === 'hold', '[desktop] 「防衛・待機」のボタン');
    // 弓隊：R で撤退
    await bpress(p, `.b-card[data-id="a_yumi"]`);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(80);
    check((await orderOf(page, 'a_yumi')).type === 'retreat', '[desktop] 弓隊を R で撤退');
    // 騎馬（7 番目）：移動
    await bpress(p, `.b-card[data-id="a_kiba"]`);
    await clickGround(p, -160, -20, 300);
    o = await orderOf(page, 'a_kiba');
    check(o.type === 'move' && Math.abs(o.x + 160) < 8, '[desktop] 7 番目の部隊（騎馬）を地面のクリックで移動', JSON.stringify(o));
    await page.keyboard.press('Escape');
    await shot(p, 'desktop-plains-orders');
}

// ================================================================ 地形の効き（戦場ごとに 1 枚）

/** 区域の中か */
const inRect = (q, r, m = 0) => q.x > r.x0 + m && q.x < r.x1 - m && q.z > r.z0 + m && q.z < r.z1 - m;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const TERRAIN = {
    async plains(p) {
        const { page } = p;
        // 東の林（中心 (130,-20)・半径 38）を抜けてくる敵の騎馬は、林の中にいる間は見えない
        let hidden = false;
        let where = '';
        for (let i = 0; i < 40 && !hidden; i++) {
            await ff(page, 1);
            const k = await unit(page, 'e_kiba');
            where = `${k.x.toFixed(0)},${k.z.toFixed(0)} seen=${k.seen.ally}`;
            if (dist2(k, { x: 130, z: -20 }) < 38 && !k.seen.ally) hidden = true;
        }
        check(hidden, '[desktop] 大平原：東の林の中の敵の騎馬は見えない（早送り・状態を読む）', where);
        await ff(page, Math.max(0, 45 - (await simT(page))));
        await shot(p, 'terrain-plains', 40, 0, 330);
    },
    async river_ford(p) {
        const { page } = p;
        // 忠勝隊を中央の浅瀬の中ほど (0,-20) へ、榊原隊を向こう岸の (-110,-60) へ（札と地面のクリック。敵の部隊の近くを押すと攻撃になるので離す）
        await bpress(p, '.b-card[data-id="a_tadakatsu"]');
        await clickGround(p, 0, -20, 260);
        await bpress(p, '.b-card[data-id="a_sakakibara"]');
        await clickGround(p, -110, -60, 300);
        const ot = await orderOf(page, 'a_tadakatsu');
        const os = await orderOf(page, 'a_sakakibara');
        check(ot.type === 'move' && os.type === 'move', '[desktop] 河川・浅瀬：札と地面のクリックで向こう岸へ移動', JSON.stringify([ot, os]));
        const RIVER = { x0: -200, x1: 200, z0: -35, z1: -5 };
        const FORDS = [{ x0: -18, x1: 18, z0: -35, z1: -5 }, { x0: -160, x1: -130, z0: -35, z1: -5 }];
        const inRiverNotFord = (q) => inRect(q, RIVER, 1.5) && !FORDS.some((f) => inRect(q, { x0: f.x0 - 1.5, x1: f.x1 + 1.5, z0: f.z0, z1: f.z1 }));
        let sakPath = null;
        let bad = [];
        let landV = null;
        let fordV = null;
        let prev = await unit(page, 'a_tadakatsu');
        for (let i = 0; i < 40; i++) {
            await ff(page, 1);
            const t = await unit(page, 'a_tadakatsu');
            const s = await unit(page, 'a_sakakibara');
            if (!sakPath && s.path) sakPath = s.path;
            for (const q of [t, s]) if (inRiverNotFord(q)) bad.push(`${q.id}@${q.x.toFixed(0)},${q.z.toFixed(0)}`);
            const v = dist2(prev, t);
            const moving = t.order.type === 'move';
            if (moving && prev.z > 0 && t.z > 0 && landV === null && i >= 1) landV = v;
            if (moving && inRect(prev, FORDS[0]) && inRect(t, FORDS[0]) && fordV === null) fordV = v;
            prev = t;
            if (landV !== null && fordV !== null && i >= 25) break;
        }
        check(!!sakPath && sakPath.some((q) => q.x >= -162 && q.x <= -128 && q.z > -45 && q.z < 5), '[desktop] 河川・浅瀬：向こう岸 (-110,-60) への道は、まっすぐ深い川を渡らず、西の浅瀬を通る（道探し）', JSON.stringify(sakPath?.map((q) => [Math.round(q.x), Math.round(q.z)])));
        check(bad.length === 0, '[desktop] 河川・浅瀬：部隊は深い川（浅瀬の外）へ入らない（1 秒ごとに確かめた）', bad.slice(0, 5).join(' '));
        check(landV !== null && fordV !== null && fordV > 0.2 && fordV < landV * 0.6, '[desktop] 河川・浅瀬：浅瀬の中は動きが遅い（1 秒あたりの進み）', `岸 ${landV?.toFixed(2)} m・浅瀬 ${fordV?.toFixed(2)} m`);
        // 浅瀬の中の忠勝隊が見える時刻へ戻せないので、今の様子を撮る（川・浅瀬・道の線）
        await shot(p, 'terrain-river_ford', -40, -25, 300);
    },
    async hills(p) {
        const { page } = p;
        // 通常の速さのまま（×1・一時停止しない）、先に頂を取る作戦（tests/proto3d-field-hills.test.ts の TAKE と同じ：騎馬を頂の真南へ・
        // 槍を頂の左右へ・後詰めと弓を頂の後ろへ → 騎馬を南から頂へ）を札と地面のクリックで出す
        await setPaused(p, false);
        const plan = [
            ['a_sakakibara', 0, 25],
            ['a_tadakatsu', -18, -26],
            ['a_sakai', 18, -26],
            ['a_ishikawa', 0, -5],
            ['a_yumi', -25, -5],
        ];
        const tStart = await simT(page);
        const wall0 = Date.now();
        for (const [id, x, z] of plan) {
            await bpress(p, `.b-card[data-id="${id}"]`);
            await clickGround(p, x, z, 260);
            const o = await orderOf(page, id);
            check(o.type === 'move' && Math.abs(o.x - x) < 6 && Math.abs(o.z - z) < 6, `[desktop] 丘陵（通常の速さ）：${id} を (${x}, ${z}) へ`, JSON.stringify(o));
        }
        // 騎馬が頂の真南に着く（または合戦の 12 秒）まで、通常の速さのまま待ってから、南から頂へ上げる
        await page.waitForFunction(() => {
            const u = window.__battle.state.units.find((x) => x.id === 'a_sakakibara');
            return window.__battle.state.t >= 12 && (Math.hypot(u.x, u.z - 25) < 10 || window.__battle.state.t >= 20);
        }, null, POLL);
        await bpress(p, '.b-card[data-id="a_sakakibara"]');
        await clickGround(p, 0, -20, 260);
        const oc = await orderOf(page, 'a_sakakibara');
        check(oc.type === 'move' && Math.abs(oc.z + 20) < 6, `[desktop] 丘陵（通常の速さ）：騎馬を南から頂 (0, -20) へ（合戦の ${(await simT(page)).toFixed(1)} 秒）`, JSON.stringify(oc));
        await page.waitForTimeout(3000);
        const tEnd = await simT(page);
        check((await bui(page)).speed === 1 && tEnd > tStart, '[desktop] 丘陵：×1 の実時間で合戦が進んでいる', `合戦の時間 ${tStart.toFixed(1)} → ${tEnd.toFixed(1)} 秒（実時間 ${((Date.now() - wall0) / 1000).toFixed(1)} 秒）`);
        await setPaused(p, true);
        // 騎馬が頂（主目標の区域）に着くまで早送り
        let on = false;
        let k = null;
        for (let i = 0; i < 40 && !on; i++) {
            await ff(page, 1);
            k = await unit(page, 'a_sakakibara');
            on = dist2(k, { x: 0, z: -20 }) < 12;
        }
        const goal = await page.evaluate(() => document.querySelector('.b-goal[data-role="primary"] .b-goal-p')?.textContent ?? '');
        check(on, '[desktop] 丘陵：騎馬（榊原隊）が中央の丘の頂（主目標の区域）に着く（早送り）', `${k?.x.toFixed(0)},${k?.z.toFixed(0)}・主目標：${goal}`);
        await shot(p, 'terrain-hills', 0, 10, 300);
    },
    async forest(p) {
        const { page } = p;
        // 酒井隊を西の林の中 (-100,-60) へ（札と地面のクリック）
        await bpress(p, '.b-card[data-id="a_sakai"]');
        await clickGround(p, -100, -60, 300);
        check((await orderOf(page, 'a_sakai')).type === 'move', '[desktop] 森林：酒井隊を西の林の中へ移動');
        const WOODS_W = { x0: -120, x1: -35, z0: -110, z1: 80 };
        let prev = await unit(page, 'a_sakai');
        let openV = null;
        let woodsV = null;
        let unseen = null;
        for (let i = 0; i < 40; i++) {
            await ff(page, 1);
            const s = await unit(page, 'a_sakai');
            const v = dist2(prev, s);
            if (i >= 1 && !inRect(prev, WOODS_W) && !inRect(s, WOODS_W) && openV === null) openV = v;
            if (inRect(prev, WOODS_W, 3) && inRect(s, WOODS_W, 3) && woodsV === null) woodsV = v;
            if (inRect(s, WOODS_W, 5) && unseen === null) unseen = !s.seen.enemy;
            prev = s;
            if (openV !== null && woodsV !== null && unseen !== null) break;
        }
        check(openV !== null && woodsV !== null && woodsV < openV * 0.75, '[desktop] 森林：林の中は動きが遅い（1 秒あたりの進み）', `開けた所 ${openV?.toFixed(2)} m・林 ${woodsV?.toFixed(2)} m`);
        check(unseen === true, '[desktop] 森林：林の中の酒井隊は、敵から見えていない');
        const amb = await page.evaluate(() => window.__battle.state.units.filter((u) => u.id.startsWith('e_ambush')).map((u) => ({ id: u.id, seen: u.seenBy.ally })));
        check(amb.length === 2 && amb.every((a) => !a.seen), '[desktop] 森林：中央の道の両脇の林の伏兵は、こちらから見えない', JSON.stringify(amb));
        await shot(p, 'terrain-forest', -50, -10, 300);
    },
    async mountain_pass(p) {
        const { page } = p;
        // 忠勝隊・酒井隊を関 (∓10, 42) へ（札と地面のクリック）
        await bpress(p, '.b-card[data-id="a_tadakatsu"]');
        await clickGround(p, -10, 42, 260);
        await bpress(p, '.b-card[data-id="a_sakai"]');
        await clickGround(p, 10, 42, 260);
        const o1 = await orderOf(page, 'a_tadakatsu');
        const o2 = await orderOf(page, 'a_sakai');
        check(o1.type === 'move' && o2.type === 'move', '[desktop] 山道・峠：札と地面のクリックで関へ移動', JSON.stringify([o1, o2]));
        const CLIFFS = [
            { x0: -120, x1: -20, z0: -130, z1: 110 },
            { x0: 20, x1: 120, z0: -130, z1: 110 },
            { x0: -20, x1: -15, z0: 25, z1: 55 },
            { x0: 15, x1: 20, z0: 25, z1: 55 },
        ];
        let path = null;
        const bad = [];
        let engagedMax = 0;
        for (let i = 0; i < 80; i++) {
            await ff(page, 1);
            const us = await page.evaluate(() => window.__battle.state.units.filter((u) => u.present && u.status !== 'destroyed').map((u) => ({ id: u.id, x: u.x, z: u.z, path: u.path ? u.path.pts.map((q) => ({ x: q.x, z: q.z })) : null, side: u.side, target: u.order.type === 'attack' ? u.order.targetId : null })));
            const t = us.find((u) => u.id === 'a_tadakatsu');
            if (!path && t?.path) path = t.path;
            for (const u of us) if (CLIFFS.some((c) => inRect(u, c, 1.5))) bad.push(`${u.id}@${u.x.toFixed(0)},${u.z.toFixed(0)}`);
            if ((await simT(page)) >= 75) break;
            engagedMax = Math.max(engagedMax, ...us.filter((u) => u.side === 'ally').map((a) => us.filter((e) => e.side === 'enemy' && e.target === a.id).length));
        }
        check(!!path && path.every((q) => q.z > 110 || Math.abs(q.x) < 20), '[desktop] 山道・峠：関への道は崖の間の峠道を通る（道探し）', JSON.stringify(path?.map((q) => [Math.round(q.x), Math.round(q.z)])));
        check(bad.length === 0, '[desktop] 山道・峠：部隊は崖の中へ入らない（1 秒ごとに確かめた）', bad.slice(0, 5).join(' '));
        log(`   山道・峠：1 部隊を攻撃の相手にした敵の数の最大 ${engagedMax}（狭い正面の決まりは斬り合う数で、ここは参考）`);
        await shot(p, 'terrain-mountain_pass', 0, 40, 300);
    },
    // ---- 第2群（地形の仕組み：橋・尾根（カプセルの丘）・水田）。命令は札と地面のクリック、時間は早送り、状態は読むだけ
    async single_bridge(p) {
        // 忠勝隊を橋の真ん中 (0,-25) へ。深い川（橋の外）へは入らない。
        // 釣り合いの後は、橋の守りが橋の上へ出て来て、忠勝隊は橋の南の端（z -10.4。橋は z -44〜-6）で斬り合いになる。
        // そのため橋の上に出たかを見る帯は、川の南の岸の線（z -10）までにする（crossRiver は川の帯の両端から 2 m 内側を見る）
        const r = await crossRiver(p, 'a_tadakatsu', 0, -25, { x0: -200, x1: 200, z0: -40, z1: -8 }, [{ x0: -9, x1: 9 }, { x0: -185, x1: -150 }], 30);
        check(r.onBridge, '[desktop] 一本橋：忠勝隊が札と地面のクリックで橋の上へ出る（早送り）', r.where);
        await shot(p, 'terrain-single_bridge', 0, -30, 260);
    },
    async multi_bridge(p) {
        // 酒井隊を西の橋の向こう (-150,-45) へ（西の陽動の隊が着く前に渡る）。深い川（3 本の橋の外）へは入らない
        const r = await crossRiver(p, 'a_sakai', -150, -45, { x0: -220, x1: 220, z0: -25, z1: 5 }, [{ x0: -158, x1: -142 }, { x0: -8, x1: 8 }, { x0: 142, x1: 158 }], 40);
        check(r.crossed, '[desktop] 複数橋：酒井隊が西の橋を渡って向こう岸へ出る（早送り）', r.where);
        await shot(p, 'terrain-multi_bridge', -60, 0, 380);
    },
    async ridge(p) {
        const { page } = p;
        // 榊原隊（騎馬）を西の登り道から尾根の西の端 (-165,-60) へ
        await bpress(p, '.b-card[data-id="a_sakakibara"]');
        await clickGround(p, -165, -60, 300);
        check((await orderOf(page, 'a_sakakibara')).type === 'move', '[desktop] 尾根：札と地面のクリックで西の登り道へ移動');
        const CLIFFS = [{ x0: -150, x1: -16, z0: -24, z1: -8 }, { x0: 16, x1: 150, z0: -24, z1: -8 }];
        const bad = [];
        let u = null;
        for (let i = 0; i < 45; i++) {
            await ff(page, 1);
            u = await unit(page, 'a_sakakibara');
            if (CLIFFS.some((c) => inRect(u, c, 1.5))) bad.push(`${u.x.toFixed(0)},${u.z.toFixed(0)}`);
            if (dist2(u, { x: -165, z: -60 }) < 6) break;
        }
        const h = capsuleHeight(u, { ax: -120, az: -60, bx: 120, bz: -60, r: 60 }, 16);
        check(bad.length === 0, '[desktop] 尾根：崖の中へ入らない（1 秒ごとに確かめた）', bad.slice(0, 5).join(' '));
        check(dist2(u, { x: -165, z: -60 }) < 8 && h > 5, '[desktop] 尾根：西の登り道から尾根の西の端へ上がる（高さ 5 m より上）', `${u.x.toFixed(0)},${u.z.toFixed(0)}・高さ ${h.toFixed(1)} m`);
        await shot(p, 'terrain-ridge', -60, -40, 340);
    },
    async valley(p) {
        const { page } = p;
        // 酒井隊を西の高地 (-95,100) へ（南の端から登る）
        await bpress(p, '.b-card[data-id="a_sakai"]');
        await clickGround(p, -95, 100, 300);
        check((await orderOf(page, 'a_sakai')).type === 'move', '[desktop] 谷間：札と地面のクリックで西の高地へ移動');
        let u = null;
        for (let i = 0; i < 60; i++) {
            await ff(page, 1);
            u = await unit(page, 'a_sakai');
            if (dist2(u, { x: -95, z: 100 }) < 6) break;
        }
        const h = capsuleHeight(u, { ax: -95, az: -120, bx: -95, bz: 110, r: 60 }, 14);
        check(dist2(u, { x: -95, z: 100 }) < 8 && h > 8, '[desktop] 谷間：西の高地へ南の端から登る（高さ 8 m より上）', `${u.x.toFixed(0)},${u.z.toFixed(0)}・高さ ${h.toFixed(1)} m`);
        await shot(p, 'terrain-valley', 0, 60, 360);
    },
    async paddy(p) {
        const { page } = p;
        // 忠勝隊（街道の上）を東の水田の中 (60,70) へ。水田の中の 1 秒の進みは、街道の上より大きく遅い
        await bpress(p, '.b-card[data-id="a_tadakatsu"]');
        await clickGround(p, 60, 70, 300);
        check((await orderOf(page, 'a_tadakatsu')).type === 'move', '[desktop] 水田：札と地面のクリックで水田の中へ移動');
        const PADDY_SE = { x0: 6, x1: 210, z0: 6, z1: 120 };
        let prev = await unit(page, 'a_tadakatsu');
        let roadV = null;
        let paddyV = null;
        for (let i = 0; i < 60; i++) {
            await ff(page, 1);
            const u = await unit(page, 'a_tadakatsu');
            const v = dist2(prev, u);
            if (Math.abs(prev.x) < 5 && Math.abs(u.x) < 5 && v > 0.5 && roadV === null) roadV = v;
            if (inRect(prev, PADDY_SE, 2) && inRect(u, PADDY_SE, 2) && v > 0.05 && paddyV === null) paddyV = v;
            prev = u;
            if (roadV !== null && paddyV !== null) break;
        }
        check(roadV !== null && paddyV !== null && paddyV < roadV * 0.4, '[desktop] 水田：水田の中は街道より動きがとても遅い（1 秒あたりの進み）', `街道 ${roadV?.toFixed(2)} m・水田 ${paddyV?.toFixed(2)} m`);
        await shot(p, 'terrain-paddy', 0, 40, 380);
    },
    // ---- 第3群（障害物・射線・門・乾いた足場）。命令は札と地面のクリック、時間は早送り、状態は読むだけ
    async marsh(p) {
        const { page } = p;
        // 忠勝隊は土手道の上を北へ (0,60)、酒井隊は泥の中を北へ (-60,100)。1 秒の進みを比べる
        await bpress(p, '.b-card[data-id="a_tadakatsu"]');
        await clickGround(p, 0, 60, 300);
        await bpress(p, '.b-card[data-id="a_sakai"]');
        await clickGround(p, -60, 100, 300);
        check((await orderOf(page, 'a_tadakatsu')).type === 'move' && (await orderOf(page, 'a_sakai')).type === 'move', '[desktop] 湿地：札と地面のクリックで土手道と泥の中へ移動');
        let pt = await unit(page, 'a_tadakatsu');
        let ps = await unit(page, 'a_sakai');
        let roadV = null;
        let mudV = null;
        for (let i = 0; i < 40; i++) {
            await ff(page, 1);
            const t = await unit(page, 'a_tadakatsu');
            const sk = await unit(page, 'a_sakai');
            if (roadV === null && t.z < 130 && pt.z < 130 && dist2(pt, t) > 0.5) roadV = dist2(pt, t);
            if (mudV === null && sk.z < 130 && ps.z < 130 && dist2(ps, sk) > 0.05) mudV = dist2(ps, sk);
            pt = t;
            ps = sk;
            if (roadV !== null && mudV !== null) break;
        }
        check(roadV !== null && mudV !== null && mudV < roadV * 0.4, '[desktop] 湿地：泥の中は土手道よりとても遅い（1 秒あたりの進み）', `土手道 ${roadV?.toFixed(2)} m・泥 ${mudV?.toFixed(2)} m`);
        await shot(p, 'terrain-marsh', -40, 60, 360);
    },
    async village(p) {
        // 忠勝隊を真ん中の通りの南の口から、屋敷前の広場 (0,40) へ。家屋の中へは入らない
        const r = await walkAvoiding(p, 'a_tadakatsu', 0, 40, 40, ['building', 'fence']);
        check(r.bad.length === 0, '[desktop] 村落：家屋・柵の中へ入らない（1 秒ごとに確かめた）', r.bad.slice(0, 5).join(' '));
        check(r.arrived, '[desktop] 村落：通りを通って屋敷前の広場へ着く', r.where);
        await shot(p, 'terrain-village', 0, 40, 300);
    },
    async temple(p) {
        // 榊原隊（騎馬）を東の脇道の上 (174,-100) へ。崖・建物の中へは入らない
        const r = await walkAvoiding(p, 'a_sakakibara', 174, -100, 60, ['cliff', 'building']);
        check(r.bad.length === 0, '[desktop] 寺社周辺：崖・建物の中へ入らない（1 秒ごとに確かめた）', r.bad.slice(0, 5).join(' '));
        check(r.arrived, '[desktop] 寺社周辺：東の脇道を回って境内の東の口の手前へ着く', r.where);
        await shot(p, 'terrain-temple', 60, -60, 380);
    },
    async town_edge(p) {
        // 忠勝隊を大通りの北の口 (0,25) へ。家屋の中へは入らない
        const r = await walkAvoiding(p, 'a_tadakatsu', 0, 25, 40, ['building', 'wall', 'fence']);
        check(r.bad.length === 0, '[desktop] 城下町外縁：家屋・塀の中へ入らない（1 秒ごとに確かめた）', r.bad.slice(0, 5).join(' '));
        check(r.arrived, '[desktop] 城下町外縁：大通りを北の口へ着く', r.where);
        await shot(p, 'terrain-town_edge', 0, 60, 380);
    },
    async siege_front(p) {
        const { page } = p;
        // 徳川騎馬隊を閉じた外門の奥（曲輪の中 (-30,-110)）へ：門は閉じているので通れず、石垣の手前で止まる（石垣の南の面 z -56 より南のまま）。
        // 行き先へまっすぐの線は、門の前の出張りの区域を避ける
        const r = await walkAvoiding(p, 'a_kiba', -30, -110, 60, ['wall']);
        const gate = await page.evaluate(() => window.__battle.state.field.gates.map((g) => ({ open: g.open, sec: g.sec })));
        const u = await unit(page, 'a_kiba');
        check(r.bad.length === 0, '[desktop] 城攻め前面：石垣の中へ入らない（1 秒ごとに確かめた）', r.bad.slice(0, 5).join(' '));
        check(u.z > -56 && gate[0] && gate[0].open === false, '[desktop] 城攻め前面：外門が閉じている間は門を通り抜けない（門の前で止まる）', `${u.x.toFixed(0)},${u.z.toFixed(0)}・門 ${JSON.stringify(gate)}`);
        await shot(p, 'terrain-siege_front', 0, -50, 300);
    },
};

/**
 * 部隊 id を札で選び (x, z) の地面をクリックして、sec 秒まで 1 秒ずつ早送りし、kinds の地形（障害物・崖）の四角の中へ入らない（1.5 m のゆとり）ことと、
 * 行き先へ着いたか（8 m 以内）を見る
 */
async function walkAvoiding(p, id, x, z, sec, kinds) {
    const { page } = p;
    await bpress(p, `.b-card[data-id="${id}"]`);
    await clickGround(p, x, z, 300);
    check((await orderOf(page, id)).type === 'move', `[desktop] ${id} を札と地面のクリックで (${x}, ${z}) へ移動`);
    const rects = await page.evaluate((ks) => window.__battle.state.map.terrain.filter((a) => ks.includes(a.kind) && a.rect).map((a) => a.rect), kinds);
    const bad = [];
    let u = null;
    for (let i = 0; i < sec; i++) {
        await ff(page, 1);
        u = await unit(page, id);
        if (rects.some((r) => inRect(u, r, 1.5))) bad.push(`${u.x.toFixed(0)},${u.z.toFixed(0)}`);
        if (dist2(u, { x, z }) < 6) break;
    }
    return { bad, arrived: !!u && dist2(u, { x, z }) < 8, where: u ? `${u.x.toFixed(0)},${u.z.toFixed(0)}` : '（いない）' };
}

/** カプセルの丘の高さ（sim.ts の elevationAt と同じ式。尾根・谷の高地の確かめに使う） */
function capsuleHeight(q, c, H) {
    const dx = c.bx - c.ax;
    const dz = c.bz - c.az;
    const t = Math.max(0, Math.min(1, ((q.x - c.ax) * dx + (q.z - c.az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(q.x - (c.ax + dx * t), q.z - (c.az + dz * t)) / c.r;
    return d < 1 ? H * (1 - d * d) : 0;
}

/**
 * 橋を渡る確かめ：部隊 id を札で選び (x, z) の地面をクリックして、sec 秒まで 1 秒ずつ早送りし、深い川の帯（river）のうち
 * 渡れる所（spans：橋・浅瀬の x の範囲。道探しの格子 5 m のゆとりを付ける）の外へ入らないこと・帯の上（橋の上）に出たこと・向こう岸へ出たことを見る
 */
async function crossRiver(p, id, x, z, river, spans, sec) {
    const { page } = p;
    await bpress(p, `.b-card[data-id="${id}"]`);
    await clickGround(p, x, z, 300);
    check((await orderOf(page, id)).type === 'move', `[desktop] ${id} を札と地面のクリックで (${x}, ${z}) へ移動`);
    const bad = [];
    let onBridge = false;
    let crossed = false;
    let u = null;
    const z0 = river.z0 + 2;
    const z1 = river.z1 - 2;
    for (let i = 0; i < sec; i++) {
        await ff(page, 1);
        const us = await page.evaluate(() => window.__battle.state.units.filter((v) => v.present && v.side === 'ally').map((v) => ({ id: v.id, x: v.x, z: v.z })));
        for (const q of us) if (q.z > z0 && q.z < z1 && !spans.some((s) => q.x > s.x0 - 5 && q.x < s.x1 + 5)) bad.push(`${q.id}@${q.x.toFixed(0)},${q.z.toFixed(0)}`);
        u = us.find((q) => q.id === id);
        if (!u) break;
        if (u.z > z0 && u.z < z1) onBridge = true;
        if (onBridge && u.z < river.z0 - 5) crossed = true;
        if (dist2(u, { x, z }) < 4) break;
    }
    check(bad.length === 0, `[desktop] 深い川（橋・浅瀬の外）へ入らない（1 秒ごとに確かめた）`, bad.slice(0, 5).join(' '));
    return { onBridge, crossed, where: u ? `${u.x.toFixed(0)},${u.z.toFixed(0)}` : '（いない）' };
}

// ================================================================ PC：15 戦場の通し

async function desktop() {
    log(`== desktop：${FIELD_IDS.length} 戦場の通し`);
    const p = await openTitle('desktop');
    const { page } = p;
    const decided = {};
    for (const id of FIELD_IDS) {
        log(`-- ${id}`);
        await titleToList(p, id === 'plains');
        await listToBattle(p, id, id === 'plains');
        await setPaused(p, true);
        if (id === 'plains') await plainsOrdersPc(p);
        await TERRAIN[id](p);
        if (id === DECIDE_FIELD) {
            // 決着まで早送り（命令は通常の速さで出したまま）
            for (let i = 0; i < 12 && !(await page.evaluate(() => window.__battle.state.result)); i++) await ff(page, 60);
            decided[id] = await resultToTitle(p, id, null);
            check(decided[id].result === 'victory' && decided[id].primary === true, `[desktop] ${id}：地形に合った作戦（画面の命令だけ）で勝つ・主目標を果たす`, JSON.stringify(decided[id]));
            log(`   ${id} の決着：${JSON.stringify(decided[id])}`);
        } else {
            await retreatAndFinish(p);
            decided[id] = await resultToTitle(p, id, 'retreat');
        }
    }
    // 開き直す → 記録が残っている
    await page.reload();
    await waitTitle(page);
    await titleToList(p, false);
    const after = await page.evaluate(() => ({
        recs: window.__practice.records,
        rows: Object.fromEntries([...document.querySelectorAll('.g-pr-field')].map((e) => [e.dataset.field, e.querySelector('.rec')?.textContent ?? ''])),
        keys: Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku')),
    }));
    const r = after.recs?.status === 'ok' ? after.recs.data.records : {};
    check(after.recs?.status === 'ok' && after.recs.data.version === 1 && FIELD_IDS.every((id) => r[id]?.plays === 1 && r[id].last.result === decided[id].result && !!r[id].best), `[desktop] 開き直した後も ${FIELD_IDS.length} 戦場の記録が残る（版 1・遊んだ回数・最後・最高）`, JSON.stringify(Object.fromEntries(FIELD_IDS.map((id) => [id, r[id]?.last?.result]))));
    const d = decided[DECIDE_FIELD];
    const dr = r[DECIDE_FIELD]?.last;
    check(!!dr && dr.primary?.achieved === d.primary && JSON.stringify(dr.secondary.map((x) => x.achieved)) === JSON.stringify(d.secondary), `[desktop] ${DECIDE_FIELD} の記録：勝敗・主目標・副目標が別々に残る`, JSON.stringify({ result: dr?.result, primary: dr?.primary, secondary: dr?.secondary }));
    check(FIELD_IDS.every((id) => after.rows[id]?.length > 0), `[desktop] 開き直した後の一覧に ${FIELD_IDS.length} 戦場の記録の行`, JSON.stringify(after.rows));
    check(JSON.stringify(after.keys) === JSON.stringify(['koto-sengoku/3d-fields']), '[desktop] 書いたキーは koto-sengoku/3d-fields だけ', after.keys.join(','));
    await page.screenshot({ path: `${OUT}/desktop-9-list-after-reload.png` });
    await p.ctx.close();
}

// ================================================================ スマホ：大平原の操作（タップ）

async function phone() {
    log('== phone：大平原の操作');
    const p = await openTitle('phone');
    const { page } = p;
    await titleToList(p, true);
    await listToBattle(p, 'plains', true);
    await setPaused(p, true);
    const allies = await page.evaluate(() => [...document.querySelectorAll('.b-card')].map((c) => c.dataset.id));
    const info = await page.evaluate(() => { const l = document.querySelector('.b-cards'); return { sw: l.scrollWidth, cw: l.clientWidth }; });
    check(info.sw > info.cw, '[phone] 7 部隊の札は列からはみ出す（なぞってずらす）', JSON.stringify(info));
    const last = allies[6];
    check(!(await cardVisible(page, last)), `[phone] 始めは 7 番目の札（${last}）が列の外`);
    const before = (await bui(page)).selectedId;
    await swipeCards(p, -300);
    check((await bui(page)).selectedId === before, '[phone] なぞっただけでは札を選ばない');
    check(await cardVisible(page, last), '[phone] 横になぞると 7 番目の札が見える');
    await page.tap(`.b-card[data-id="${last}"]`);
    await page.waitForTimeout(150);
    check((await bui(page)).selectedId === last, `[phone] 7 番目の札をタップで選ぶ（${last}）`);
    await page.screenshot({ path: `${OUT}/phone-plains-card7.png` });
    // 7 番目の部隊（騎馬）を地図のタップで移動
    await clickGround(p, -160, -20, 300);
    let o = await orderOf(page, last);
    check(o.type === 'move', '[phone] 地図のタップで移動（7 番目の部隊）', JSON.stringify(o));
    // 1 番目へ戻す（右へなぞる）→ 忠勝隊をタップで選ぶ
    await swipeCards(p, 300);
    await page.tap('.b-card[data-id="a_tadakatsu"]');
    await page.waitForTimeout(150);
    check((await bui(page)).selectedId === 'a_tadakatsu', '[phone] 札をタップで選ぶ（忠勝隊）');
    await clickGround(p, 10, 40, 260);
    o = await orderOf(page, 'a_tadakatsu');
    check(o.type === 'move' && Math.abs(o.z - 40) < 8, '[phone] 地図のタップで移動（忠勝隊 → (10, 40)）', JSON.stringify(o));
    // 攻撃：「攻撃」をタップ → 敵をタップ
    await bpress(p, '.b-cmd:has-text("攻撃")');
    check((await bui(page)).pending === 'attack', '[phone] 「攻撃」のタップで敵を選ぶ待ち');
    await clickUnit(p, 'e_sente');
    o = await orderOf(page, 'a_tadakatsu');
    check(o.type === 'attack' && o.targetId === 'e_sente', '[phone] 敵のタップで攻撃（忠勝隊 → 敵勢の先手）', JSON.stringify(o));
    // 防衛・待機
    await bpress(p, '.b-cmd:has-text("防衛・待機")');
    check((await orderOf(page, 'a_tadakatsu')).type === 'hold', '[phone] 「防衛・待機」のタップ');
    // 撤退：弓隊を選んで「撤退」
    if (!(await cardVisible(page, 'a_yumi'))) await swipeCards(p, -150);
    await page.tap('.b-card[data-id="a_yumi"]');
    await page.waitForTimeout(150);
    check((await bui(page)).selectedId === 'a_yumi', '[phone] 札をタップで選ぶ（弓隊）');
    await bpress(p, '.b-cmd:has-text("撤退")');
    check((await orderOf(page, 'a_yumi')).type === 'retreat', '[phone] 「撤退」のタップで撤退');
    await shot(p, 'phone-plains-orders');
    // 通常の速さで少し進めてから、全軍撤退 → 早送り → 結果 → 演習の結果 → 一覧 → タイトル（どれもタップ）
    await setPaused(p, false);
    await page.waitForTimeout(3000);
    await retreatAndFinish(p);
    await resultToTitle(p, 'plains', 'retreat');
    await p.ctx.close();
}

// ================================================================ 8 部隊の札（開発用の入口で味方を 8 部隊にする）

async function eight() {
    for (const kind of ['desktop', 'phone']) {
        log(`== eight（${kind}）：味方 8 部隊の札`);
        const p = await openPage(kind, '/?dev=field&id=plains&allies=8&q=low');
        const { page } = p;
        await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
        await bpress(p, '.b-primary');
        await setPaused(p, true);
        const cards = await page.evaluate(() => [...document.querySelectorAll('.b-card')].map((c) => ({ id: c.dataset.id, key: c.dataset.key })));
        check(cards.length === 8 && cards[7].key === '8', `[${kind}] 味方 8 部隊・札 8 枚（8 番目のキーの印は 8）`, cards.map((c) => `${c.key}:${c.id}`).join(' '));
        const c7 = cards[6].id;
        const c8 = cards[7].id;
        if (kind === 'desktop') {
            await page.keyboard.press('Digit8');
            await page.waitForTimeout(80);
            check((await bui(page)).selectedId === c8, `[desktop] キー 8 で 8 番目の部隊を選ぶ（${c8}）`);
            await page.keyboard.press('Digit7');
            await page.waitForTimeout(80);
            check((await bui(page)).selectedId === c7, `[desktop] キー 7 で 7 番目の部隊を選ぶ（${c7}）`);
            await bpress(p, `.b-card[data-id="${c8}"]`);
            check((await bui(page)).selectedId === c8, `[desktop] 8 番目の札のクリックで選ぶ（${c8}）`);
            const fit = await page.evaluate(() => { const l = document.querySelector('.b-cards'); return l.scrollWidth <= l.clientWidth + 1; });
            check(fit, '[desktop] 8 部隊の札が横にはみ出さずに並ぶ');
            await clickGround(p, 40, 60, 260);
            check((await orderOf(page, c8)).type === 'move', '[desktop] 8 番目の部隊を地面のクリックで移動');
        } else {
            check(!(await cardVisible(page, c8)), `[phone] 始めは 8 番目の札が列の外`);
            await swipeCards(p, -400);
            check(await cardVisible(page, c8), '[phone] 横になぞると 8 番目の札が見える');
            await page.tap(`.b-card[data-id="${c8}"]`);
            await page.waitForTimeout(150);
            check((await bui(page)).selectedId === c8, `[phone] 8 番目の札をタップで選ぶ（${c8}）`);
            if (!(await cardVisible(page, c7))) await swipeCards(p, 100);
            await page.tap(`.b-card[data-id="${c7}"]`);
            await page.waitForTimeout(150);
            check((await bui(page)).selectedId === c7, `[phone] 7 番目の札をタップで選ぶ（${c7}）`);
            await clickGround(p, 40, 60, 260);
            check((await orderOf(page, c7)).type === 'move', '[phone] 7 番目の部隊を地図のタップで移動');
        }
        await page.screenshot({ path: `${OUT}/${kind}-eight-cards.png` });
        await p.ctx.close();
    }
}

// ================================================================ 古い保存を全部入れた状態

const KEY_IE = 'koto-sengoku/3d-ieyasu1570';
const KEY_FIC = 'koto-sengoku/3d-chapter1';
const KEY_2D = 'koto-sengoku/save';
const KEY_FIELDS = 'koto-sengoku/3d-fields';
// 歴史分岐の版 1（tests/proto3d-ieyasu-save-v1-fixtures.ts の戦後・B 浅井・撤退・約束を守った。e2e/ieyasu-routes.mjs の経路 H と同じ中身）
const V1_IEYASU = '{"version":1,"scenario":"ieyasu1570","savedAt":"2026-09-28T11:00:00.000Z","point":"aftermath","playTimeSec":1234,"phase":"aftermath","policy":"asai","trust":{"oda":0,"asai":35,"tadakatsu":40},"troops":{"honjin":290,"tadakatsu":350,"yumi":330,"reserve":300},"characters":{"ieyasu":"alive","tadakatsu":"alive","nobunaga":"alive","nagamasa":"alive"},"talked":{"explore.tadakatsu":true,"council.council":true,"muster.asai_envoy":true,"muster.gate":true},"pledge":{"accepted":true,"partner":"asai","targetId":"a_nagamasa","result":"kept"},"battle":{"result":"retreat","reason":"ordered_retreat","elapsedSec":300,"units":[{"id":"t_honjin","side":"ally","clan":"tokugawa","startStrength":300,"endStrength":240,"status":"withdrawn","leaderId":"ieyasu"},{"id":"t_tadakatsu","side":"ally","clan":"tokugawa","startStrength":450,"endStrength":300,"status":"withdrawn","leaderId":"tadakatsu"},{"id":"t_yumi","side":"ally","clan":"tokugawa","startStrength":350,"endStrength":280,"status":"withdrawn"},{"id":"a_nagamasa","side":"ally","clan":"asai","startStrength":400,"endStrength":320,"status":"withdrawn","leaderId":"nagamasa"},{"id":"e_oda_hq","side":"enemy","clan":"oda","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_oda_sente","side":"enemy","clan":"oda","startStrength":550,"endStrength":440,"status":"ready"},{"id":"e_oda_teppo","side":"enemy","clan":"oda","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_oda_kiba","side":"enemy","clan":"oda","startStrength":250,"endStrength":200,"status":"ready"}],"pledge":{"targetId":"a_nagamasa","result":"kept"},"abilitiesUsed":{"a_nagamasa":40}},"battleId":"ieyasu1570-v1fixture","appliedBattleId":"ieyasu1570-v1fixture","support":{"reinforcement":true,"from":"asai","recovered":150,"carryOver":["policy_asai","pledge_kept","reinforcement_asai"]},"ending":null,"explore":null}';
// 架空の第一章の版 1（tests/proto3d-save-v1-fixtures.ts の V1_AFTERMATH_OMORI_DEFEAT と同じ中身）
const V1_FICTIONAL = '{"version":1,"savedAt":"2026-09-28T10:00:00.000Z","point":"aftermath","playTimeSec":0,"phase":"aftermath","alliance":"omori","relations":{"tashiro":-20,"omori":0,"washio":-60},"troops":{"honjin":240,"genzo":400,"shinpachi":280,"reserve":300},"characters":{"hero":"wounded","genzo":"wounded","shinpachi":"alive","tashiro_envoy":"alive","omori_envoy":"alive","washio_gen":"alive"},"talked":{"explore.genzo":true,"explore.shinpachi":true,"council.council":true,"muster.gate":true},"battle":{"result":"defeat","reason":"ally_hq_routed","elapsedSec":300,"units":[{"id":"a_hq","side":"ally","clan":"kotosaka","startStrength":300,"endStrength":240,"status":"routed","leaderId":"hero"},{"id":"a_genzo","side":"ally","clan":"kotosaka","startStrength":500,"endStrength":400,"status":"ready","leaderId":"genzo"},{"id":"a_shinpachi","side":"ally","clan":"kotosaka","startStrength":350,"endStrength":280,"status":"ready","leaderId":"shinpachi"},{"id":"a_omori","side":"ally","clan":"omori","startStrength":400,"endStrength":320,"status":"ready","leaderId":"omori_envoy"},{"id":"e_hq","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready","leaderId":"washio_gen"},{"id":"e_sente","side":"enemy","clan":"washio","startStrength":550,"endStrength":440,"status":"ready"},{"id":"e_yumi","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_tashiro","side":"enemy","clan":"tashiro","startStrength":250,"endStrength":200,"status":"ready","leaderId":"tashiro_envoy"}]},"ending":null,"explore":null}';
// 2D 版の保存（src/core/save.ts の版 2 の形。3D 版は読まない・書かない）
const SAVE_2D = '{"version":2,"savedAt":"2026-09-20T08:00:00.000Z","playTimeSec":321,"player":{"x":400,"y":300,"facing":"down"},"flags":{},"battle":{"played":0,"won":0,"lost":0}}';

const raw = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
async function reloadTitle(page) {
    await page.reload();
    await waitTitle(page);
    await page.waitForFunction(() => document.getElementById('loading')?.hidden !== false, null, POLL);
}
/** タイトルから「つづきから」で続けて、章の状態を読む */
async function continueFrom(p, id) {
    await press(p, `.g-btn[data-id="continue:${id}"]`);
    await p.page.waitForFunction(() => window.__game.screen === 'explore' && !!window.__game.state, null, POLL);
    return p.page.evaluate(() => {
        const g = window.__game;
        const x = g.state;
        return { sc: g.scenario, phase: x.phase, alliance: x.alliance ?? null, relations: x.relations ?? null, trust: x.trust ?? null, pledge: x.pledge?.result ?? null, result: x.battle?.result ?? null, side: x.sideObjectives ?? null, troops: x.troops };
    });
}

async function oldsaves() {
    log('== oldsaves（PC）：古い保存を全部入れた状態');
    const p = await openTitle('desktop');
    const { page } = p;
    await page.evaluate(([a, b, c]) => {
        localStorage.clear();
        localStorage.setItem(a[0], a[1]);
        localStorage.setItem(b[0], b[1]);
        localStorage.setItem(c[0], c[1]);
    }, [[KEY_IE, V1_IEYASU], [KEY_FIC, V1_FICTIONAL], [KEY_2D, SAVE_2D]]);
    await reloadTitle(page);
    const subs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.g-title-layer .g-btn')].map((b) => [b.dataset.id, { text: b.textContent, disabled: b.disabled }])));
    check(!subs['continue:ieyasu1570'].disabled && subs['continue:ieyasu1570'].text.includes('戦の後') && !subs['continue:fictional'].disabled, '[oldsaves] タイトル：歴史分岐（版 1）・架空の第一章（版 1）の「つづきから」が押せる', JSON.stringify(subs));
    const same = async (label, fic) => {
        const r = { ie: await raw(page, KEY_IE), fic: await raw(page, KEY_FIC), d2: await raw(page, KEY_2D) };
        check(r.ie === V1_IEYASU && r.fic === fic && r.d2 === SAVE_2D, `[oldsaves] ${label}：古い保存（歴史分岐・架空の第一章・2D 版）は 1 字も変わらない`, JSON.stringify({ ie: r.ie === V1_IEYASU, fic: r.fic === fic, d2: r.d2 === SAVE_2D }));
    };
    // 演習を 1 回（大平原に出陣 → 全軍撤退 → 早送り → 結果 → 一覧 → タイトル）
    await titleToList(p, false);
    await listToBattle(p, 'plains', false);
    await retreatAndFinish(p);
    await resultToTitle(p, 'plains', 'retreat');
    await same('演習を 1 回遊んだ後', V1_FICTIONAL);
    check((await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null')?.records?.plains?.plays, KEY_FIELDS)) === 1, '[oldsaves] 演習の記録は koto-sengoku/3d-fields に別に入る');
    // 歴史分岐（版 1）を続ける
    const ie = await continueFrom(p, 'ieyasu1570');
    check(ie.sc === 'ieyasu1570' && ie.phase === 'aftermath' && ie.result === 'retreat' && ie.pledge === 'kept' && JSON.stringify(ie.trust) === JSON.stringify({ oda: 0, asai: 35, tadakatsu: 40, sakai: 40, ishikawa: 40, sakakibara: 40 }) && ie.side === null,
        '[oldsaves] 歴史分岐（版 1）を続ける：戦後・撤退・約束を守った・信頼は版 1 のまま（家臣 3 人は 40）・副目標は記録なし', JSON.stringify(ie));
    await page.screenshot({ path: `${OUT}/oldsaves-1-ieyasu-v1.png` });
    await same('歴史分岐を続けた後（読むだけでは書き換えない）', V1_FICTIONAL);
    // 架空の第一章（版 1）を続ける
    await reloadTitle(page);
    const f1 = await continueFrom(p, 'fictional');
    check(f1.sc === 'fictional' && f1.phase === 'aftermath' && f1.alliance === 'omori' && f1.relations?.tashiro === -20 && f1.result === 'defeat', '[oldsaves] 架空の第一章（版 1）を続ける：戦後・大森・田代のまま（織田・浅井へ書き換えない）', JSON.stringify(f1));
    await same('架空の第一章を続けた後', V1_FICTIONAL);
    // メニューから保存し直す → 架空の第一章は版 2 に。歴史分岐・2D 版はそのまま
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game.ui?.kind === 'menu', null, POLL);
    await press(p, '.g-layer[data-kind="menu"] .g-btn[data-id="save"]');
    await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
    await press(p, '.g-layer[data-kind="menu"] .g-btn[data-id="close"]');
    const v2 = JSON.parse((await raw(page, KEY_FIC)) || 'null');
    check(v2?.version === 2 && v2.alliance === 'omori' && v2.relations.tashiro === -20 && v2.battle.result === 'defeat', '[oldsaves] 架空の第一章をメニューで保存し直すと版 2（大森・田代のまま）');
    const V2_FICTIONAL = await raw(page, KEY_FIC);
    await same('架空の第一章を保存し直した後', V2_FICTIONAL);
    // 版 2 の架空の第一章・版 1 の歴史分岐・2D 版を並べて開き直す
    await reloadTitle(page);
    const f2 = await continueFrom(p, 'fictional');
    check(f2.sc === 'fictional' && f2.phase === 'aftermath' && f2.alliance === 'omori' && f2.relations?.tashiro === -20, '[oldsaves] 架空の第一章（版 2）を続ける（大森・田代のまま）', JSON.stringify(f2));
    await reloadTitle(page);
    const ie2 = await continueFrom(p, 'ieyasu1570');
    check(ie2.sc === 'ieyasu1570' && ie2.phase === 'aftermath' && ie2.result === 'retreat' && JSON.stringify(ie2.troops) === JSON.stringify(JSON.parse(V1_IEYASU).troops), '[oldsaves] 歴史分岐（版 1）をもう一度続けても同じ（兵・勝敗）', JSON.stringify({ troops: ie2.troops }));
    await same('最後', V2_FICTIONAL);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku')).sort());
    check(JSON.stringify(keys) === JSON.stringify([KEY_FIELDS, KEY_FIC, KEY_IE, KEY_2D].sort()), '[oldsaves] 保存のキーは 4 つだけ（2D 版のキーは koto-sengoku/save のまま）', keys.join(','));
    await p.ctx.close();
}

try {
    if (PARTS.includes('desktop')) await desktop();
    if (PARTS.includes('phone')) await phone();
    if (PARTS.includes('eight')) await eight();
    if (PARTS.includes('oldsaves')) await oldsaves();
} catch (e) {
    failures.push(`例外: ${e instanceof Error ? e.stack : String(e)}`);
    log(e);
} finally {
    await b.close();
}
log(failures.length ? `NG ${failures.length} 件\n- ${failures.join('\n- ')}` : 'すべて ok');
process.exit(failures.length ? 1 : 0);
