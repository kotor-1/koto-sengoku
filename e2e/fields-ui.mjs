/**
 * 合戦場の画面（データ駆動の戦場・6〜10 部隊）の表示と操作を、実際のブラウザで実際のクリック・キー・タップで確かめる。
 *   BASE=http://localhost:8172 node e2e/fields-ui.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - ?dev=field&id=<戦場id> で 20 戦場（第1群・第2群・第3群・第4群）をそれぞれ開き、PC（1280×720）とスマホ横（844×390、タッチ）で 1 枚ずつ撮る（出力先/<id>-desktop.png・<id>-phone.png）。
 *   IDS=besieged_camp,relief のように戦場を絞れる（既定は 20 戦場）。
 * - 画面の部品（左上の欄・目標の欄・右上・右・札・命令のボタン・案内）が重ならない・はみ出さないことを、四角の位置で確かめる。
 * - 大平原（plains。味方 7 部隊）：PC は 1〜7 キーで選ぶ・札の数・武将の行（名前・役割・固有能力の「仮」）・移動・攻撃・防衛・撤退を
 *   クリックとキーで出す。スマホは札を横になぞってずらす（なぞっても選ばない）・札をタップで選ぶ・地図のタップで移動・目標の欄を開く／畳む。
 * - 結果の画面：全軍撤退で終え、勝敗・主目標・副目標の行が別々に出る（約束は演習に無い）。
 * - スマホ（goals）：20 戦場で、部隊の札をタップ → 目標の見出しを開く（能力の欄は隠れ、左上の列が札の列に重ならない）→ 別の部隊を選ぶ
 *   （目標の欄を畳み、能力の欄が戻る。左上の列の下端が札の列より上）。
 * - PC（orders）：河川・浅瀬で、中央を弓で開ける作戦の命令をすべて札と地図のクリックで出し、丘の守りと斬り合う味方がいる丘の輪の端へ
 *   四隊を移して勝つ（目標の欄の進みの文が、数えていない理由を出す）。森林で、物見隊を選んで輪の真ん中（家康本陣）を押すと本陣が選び直され、
 *   輪の中の空いた地面を押すと物見隊が動く（説明・進みの文どおり）。
 * 待つ時間だけは開発用の早送り（window.__battle.fastForward）を使う。命令は画面のクリック・タップ・キーで出す。状態は window.__battle から読むだけ。
 * - 夜（night。第4群の夜襲・奇襲、PC とスマホ）：合戦を始めた後、発見していない敵は、名札（DOM の .b-label。名前・兵の数・位置の transform が空）・
 *   兵士（troopStats の perUnit が 0）・画面の位置（screenOf・labelOf が null）・表示の層の位置（view の vis が NaN）のどれからも分からない。
 *   篝火の中の見えている敵（番兵）は、名札・兵士が出る。味方の部隊を札と地面のクリック・タップで番兵の近くへ動かし、新しく見つけた敵の名札が出る。
 * PARTS=shots,desktop,phone,goals,orders,night で一部だけ（既定はすべて）。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/fields-ui';
mkdirSync(OUT, { recursive: true });
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}
const PARTS = (process.env.PARTS || 'shots,desktop,phone,goals,orders,night').split(',');
const ALL_FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy', 'marsh', 'village', 'temple', 'town_edge', 'siege_front', 'besieged_camp', 'relief', 'rearguard', 'night_raid', 'shore'];
const FIELD_IDS = process.env.IDS ? process.env.IDS.split(',') : ALL_FIELD_IDS;

const b = await launchBrowser();

async function openPage(kind, id) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    // ソフトウェア描画のコンテナは重い（読み込み・撮影に時間がかかる）
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') log('console error', m.text());
    });
    await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
    return { ctx, page, phone };
}

async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(120);
}
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const hidden = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !e || e.hidden || getComputedStyle(e).display === 'none'; }, sel);
const ui = (page) => page.evaluate(() => window.__battle.ui);

/** 重なりの確かめ：左上の欄・右上・右・札・命令のボタン・案内・一時停止の印が互いに重ならず、画面からはみ出さない */
async function overlapCheck(page, label) {
    const r = await page.evaluate(() => {
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
        const W = innerWidth;
        const H = innerHeight;
        const out = boxes.filter((x) => x.l < -1 || x.t < -1 || x.r > W + 1 || x.b > H + 1).map((x) => x.s);
        return { hits, out };
    });
    check(r.hits.length === 0 && r.out.length === 0, `${label}：画面の部品が重ならない・はみ出さない`, [...r.hits, ...r.out].join(' '));
}

async function start(p) {
    await press(p, '.b-primary');
    await p.page.waitForTimeout(200);
    // 止めて撮る（指揮中）
    await press(p, '.b-pause');
}

// ================================================================ 20 戦場を開いて撮る
if (PARTS.includes('shots')) {
    for (const kind of ['desktop', 'phone']) {
        for (const id of FIELD_IDS) {
            log(`== ${id}（${kind}）`);
            const p = await openPage(kind, id);
            const { page } = p;
            check((await page.evaluate(() => document.querySelector('.b-root')?.dataset.field)) === id, `${id}：戦場 id の印`);
            await page.screenshot({ path: `${OUT}/${id}-${kind}-brief.png` });
            await start(p);
            // 味方の本陣を選ぶ（武将の行を出す）
            const hqId = await page.evaluate(() => window.__battle.state.units.find((u) => u.side === 'ally' && u.isHq).id);
            await press(p, `.b-card[data-id="${hqId}"]`);
            await page.waitForTimeout(250);
            check((await ui(page)).selectedId === hqId, `${id}：札で本陣を選べる`);
            check(!(await hidden(page, '.b-goals')), `${id}：目標の欄が出る`, await text(page, '.b-goals'));
            check(!(await hidden(page, '.b-gen')), `${id}：武将の行が出る`, await text(page, '.b-gen'));
            const nAlly = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally').length);
            check((await page.evaluate(() => document.querySelectorAll('.b-card').length)) === nAlly, `${id}：札の数 = 味方の部隊の数（${nAlly}）`);
            await overlapCheck(page, `${id}（${kind}）`);
            await page.screenshot({ path: `${OUT}/${id}-${kind}.png` });
            await p.ctx.close();
        }
    }
}

// ================================================================ PC：大平原（7 部隊）の操作
if (PARTS.includes('desktop')) {
    log('== PC：大平原の操作');
    const p = await openPage('desktop', 'plains');
    const { page } = p;
    await start(p);
    const allies = await page.evaluate(() => window.__battle.state.units.filter((u) => u.side === 'ally').map((u) => u.id));
    check(allies.length === 7, '大平原：味方 7 部隊', String(allies.length));
    // 1〜7 キーで選ぶ
    for (let i = 0; i < allies.length; i++) {
        await page.keyboard.press(`Digit${i + 1}`);
        await page.waitForTimeout(60);
        const u = await ui(page);
        check(u.selectedId === allies[i] && u.selection.length === 1 && u.selection[0] === allies[i], `キー ${i + 1} で ${allies[i]} を選ぶ（選択の並びは 1 部隊）`);
    }
    await page.keyboard.press('Digit8');
    check((await ui(page)).selectedId === allies[6], 'キー 8（8 部隊目が無い）では選び直さない');
    // 札が全部見える（PC は並べる）
    const cardsFit = await page.evaluate(() => { const l = document.querySelector('.b-cards'); return l.scrollWidth <= l.clientWidth + 1; });
    check(cardsFit, 'PC：7 部隊の札が横にはみ出さずに並ぶ');
    // 酒井忠次隊：武将の行（名前・役割・固有能力・仮の印）
    const sakai = allies.indexOf('a_sakai');
    await page.keyboard.press(`Digit${sakai + 1}`);
    await page.waitForTimeout(150);
    const gen = await text(page, '.b-gen');
    check(gen.includes('酒井忠次') && gen.includes('采配') && gen.includes('両翼の采配') && gen.includes('仮'), '酒井隊を選ぶと、武将の名前・役割・固有能力（仮）が見える', gen);
    check((await page.evaluate(() => document.querySelector('.b-gen')?.dataset.general)) === 'sakai', '武将の行の印 data-general=sakai');
    // 移動：地面をクリック
    const g = await page.evaluate(() => window.__battle.screenOfGround(-60, 20));
    await page.mouse.click(g.x, g.y);
    await page.waitForTimeout(150);
    let o = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_sakai').order);
    check(o.type === 'move', 'クリックで移動の命令', JSON.stringify(o));
    // 攻撃：A → 敵をクリック（見えている敵）
    const enemy = await page.evaluate(() => window.__battle.state.units.find((u) => u.side === 'enemy' && u.present && u.seenBy.ally && !u.isHq)?.id);
    if (enemy) {
        await page.keyboard.press('KeyA');
        const e = await page.evaluate((id) => window.__battle.screenOf(id), enemy);
        await page.mouse.click(e.x, e.y);
        await page.waitForTimeout(150);
        o = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_sakai').order);
        check(o.type === 'attack' && o.targetId === enemy, `A → 敵のクリックで攻撃（${enemy}）`, JSON.stringify(o));
    } else check(false, '見えている敵がいない');
    // 防衛・撤退：キー
    await page.keyboard.press('KeyH');
    o = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_sakai').order);
    check(o.type === 'hold', 'H で防衛・待機');
    const yumi = allies.indexOf('a_yumi');
    await page.keyboard.press(`Digit${yumi + 1}`);
    await page.keyboard.press('KeyR');
    o = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_yumi').order);
    check(o.type === 'retreat', '弓隊を R で撤退');
    // 敵を地図で選んで調べる（味方の選択を外してから）
    await page.keyboard.press('Escape');
    if (enemy) {
        const e = await page.evaluate((id) => window.__battle.screenOf(id), enemy);
        await page.mouse.click(e.x, e.y);
        await page.waitForTimeout(150);
        check((await ui(page)).selectedId === enemy && !(await hidden(page, '.b-inspect')), '敵を地図でクリックして調べる');
    }
    await overlapCheck(page, '大平原（PC・操作の後）');
    await page.screenshot({ path: `${OUT}/plains-desktop-orders.png` });
    // 全軍撤退で終える → 結果に勝敗・主目標・副目標が別の行
    await page.evaluate(() => window.__battle.pause(false));
    await press(p, '.b-allret');
    await press(p, '.b-modal .b-primary');
    await page.evaluate(() => window.__battle.fastForward(60));
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 30000, polling: 200 });
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => [...document.querySelectorAll('.b-robj-row')].map((r) => `${r.dataset.role}:${r.dataset.achieved}:${r.textContent}`));
    check(res.length === 2 && res[0].startsWith('primary:false') && res[1].startsWith('secondary:'), '結果：主目標・副目標が別の行', res.join(' / '));
    check(await hidden(page, '.b-rpledge'), '結果：演習には約束の欄が無い');
    check((await text(page, '.b-result h2')) === '撤退', '結果：勝敗の見出し（撤退）');
    await page.screenshot({ path: `${OUT}/plains-desktop-result.png` });
    await p.ctx.close();
}

// ================================================================ スマホ：大平原（7 部隊）の操作
if (PARTS.includes('phone')) {
    log('== スマホ：大平原の操作');
    const p = await openPage('phone', 'plains');
    const { page } = p;
    await start(p);
    const info = await page.evaluate(() => { const l = document.querySelector('.b-cards'); return { sw: l.scrollWidth, cw: l.clientWidth, sl: l.scrollLeft }; });
    check(info.sw > info.cw, 'スマホ：7 部隊の札は列からはみ出す（なぞってずらす）', JSON.stringify(info));
    // 札の列を左へなぞる（タッチ）：列がずれて、選択は変わらない
    const before = (await ui(page)).selectedId;
    const box = await page.evaluate(() => { const r = document.querySelector('.b-cards').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const cdp = await p.ctx.newCDPSession(page);
    const y = box.y + box.h / 2;
    const x0 = box.x + box.w * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 30, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector('.b-cards').scrollLeft);
    check(after > 50, '札の列を横になぞるとずれる', String(after));
    check((await ui(page)).selectedId === before, 'なぞっただけでは札を選ばない');
    await page.screenshot({ path: `${OUT}/plains-phone-swiped.png` });
    // 最後の札（騎馬）をタップで選ぶ
    const last = await page.evaluate(() => [...document.querySelectorAll('.b-card')].at(-1).dataset.id);
    await page.tap(`.b-card[data-id="${last}"]`);
    await page.waitForTimeout(150);
    check((await ui(page)).selectedId === last, `札をタップで選ぶ（${last}）`);
    // 地図をタップで移動
    const g = await page.evaluate(() => window.__battle.screenOfGround(80, 40));
    await page.touchscreen.tap(g.x, g.y);
    await page.waitForTimeout(150);
    const o = await page.evaluate((id) => window.__battle.state.units.find((u) => u.id === id).order, last);
    check(o.type === 'move', '地図のタップで移動', JSON.stringify(o));
    // 防衛・撤退のボタン
    await page.tap('.b-cmd:has-text("防衛・待機")');
    check((await page.evaluate((id) => window.__battle.state.units.find((u) => u.id === id).order.type, last)) === 'hold', '防衛・待機のボタン');
    // 目標の欄：畳んである → 開く → 畳む
    check(await page.evaluate(() => document.querySelector('.b-goals').classList.contains('closed')), 'スマホ：目標の欄は畳んである（主目標の一行）', await text(page, '.b-goals-head'));
    await page.tap('.b-goals-head');
    await page.waitForTimeout(150);
    check(!(await hidden(page, '.b-goals-body')), 'スマホ：目標の欄を開ける');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.b-goal')].map((g) => `${g.dataset.role}:${g.dataset.state}`));
    check(rows.length === 2 && rows[0].startsWith('primary') && rows[1].startsWith('secondary'), '主目標と副目標が別の行', rows.join(' '));
    await overlapCheck(page, '大平原（スマホ・目標の欄を開いた）');
    await page.screenshot({ path: `${OUT}/plains-phone-goals-open.png` });
    await page.tap('.b-goals-head');
    await overlapCheck(page, '大平原（スマホ・操作の後）');
    await page.screenshot({ path: `${OUT}/plains-phone-orders.png` });
    await p.ctx.close();
}

// ================================================================ スマホ：目標の欄を開いたまま部隊を選んでも、左上の列が札の列に重ならない
if (PARTS.includes('goals')) {
    for (const id of FIELD_IDS) {
        log(`== スマホ：${id} の目標の欄と能力の欄`);
        const p = await openPage('phone', id);
        const { page } = p;
        await start(p);
        const ids = await page.evaluate(() => [...document.querySelectorAll('.b-card')].map((c) => c.dataset.id));
        const first = ids.includes('a_sakai') ? 'a_sakai' : 'a_tadakatsu';
        const second = first === 'a_sakai' ? 'a_tadakatsu' : 'a_ieyasu';
        // 札の列の外にあれば、見える所までずらしてからタップする
        const tapCard = async (uid) => {
            await page.evaluate((u) => document.querySelector(`.b-card[data-id="${u}"]`).scrollIntoView({ inline: 'nearest', block: 'nearest' }), uid);
            await page.waitForTimeout(100);
            await page.tap(`.b-card[data-id="${uid}"]`);
            await page.waitForTimeout(200);
        };
        // レビューの手順：部隊の札をタップ → 目標の見出しをタップして開く
        await tapCard(first);
        check((await ui(page)).selectedId === first && !(await hidden(page, '.b-abil')), `${id}：${first} を選ぶと能力の欄が出る`);
        await page.tap('.b-goals-head');
        await page.waitForTimeout(250);
        check(!(await hidden(page, '.b-goals-body')), `${id}：目標の欄を開ける`);
        check(await hidden(page, '.b-abil'), `${id}：目標の欄を開いている間は能力の欄を隠す`);
        await overlapCheck(page, `${id}（スマホ・部隊を選んで目標の欄を開いた）`);
        await page.screenshot({ path: `${OUT}/${id}-phone-goals-open.png` });
        // 別の部隊を選ぶ → 目標の欄は畳まれ、能力の欄が戻る
        await tapCard(second);
        check((await ui(page)).selectedId === second, `${id}：${second} を選び直す`);
        check(await page.evaluate(() => document.querySelector('.b-goals').classList.contains('closed')), `${id}：部隊を選び直すと目標の欄を畳む`);
        check(!(await hidden(page, '.b-abil')), `${id}：能力の欄が戻る`);
        const gap = await page.evaluate(() => document.querySelector('.b-cards').getBoundingClientRect().top - document.querySelector('.b-topleft').getBoundingClientRect().bottom);
        check(gap > 0, `${id}：左上の列の下端が札の列より上`, `${Math.round(gap)} px`);
        await overlapCheck(page, `${id}（スマホ・選び直した）`);
        await page.screenshot({ path: `${OUT}/${id}-phone-goals-reselect.png` });
        await p.ctx.close();
    }
}

// ================================================================ PC：丘の確保（河川・浅瀬）と救出（森林）を画面のクリックだけで
if (PARTS.includes('orders')) {
    const unitOrder = (page, id) => page.evaluate((u) => window.__battle.state.units.find((x) => x.id === u).order, id);
    const tNow = (page) => page.evaluate(() => window.__battle.state.t);
    const ffTo = (page, t) => page.evaluate((to) => window.__battle.fastForward(Math.max(0, to - window.__battle.state.t)), t);
    const goalText = (page, role) => page.evaluate((r) => document.querySelector(`.b-goal[data-role="${r}"] .b-goal-p`)?.textContent ?? '', role);
    const clickCard = async (page, id) => {
        await page.click(`.b-card[data-id="${id}"]`);
        await page.waitForTimeout(120);
    };
    const clickUnit = async (page, id) => {
        const u = await page.evaluate((x) => window.__battle.state.units.find((v) => v.id === x), id);
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z), [u.x, u.z]);
        await page.waitForTimeout(150);
        const q = await page.evaluate((x) => window.__battle.screenOf(x), id);
        await page.mouse.click(q.x, q.y);
        await page.waitForTimeout(150);
    };
    const clickGround = async (page, x, z) => {
        await page.evaluate(([gx, gz]) => window.__battle.centerOn(gx, gz), [x, z]);
        await page.waitForTimeout(150);
        const q = await page.evaluate(([gx, gz]) => window.__battle.screenOfGround(gx, gz), [x, z]);
        await page.mouse.click(q.x, q.y);
        await page.waitForTimeout(150);
    };

    log('== PC：河川・浅瀬の丘の確保（クリックだけで命令）');
    {
        const p = await openPage('desktop', 'river_ford');
        const { page } = p;
        await start(p);
        await clickCard(page, 'a_yumi');
        await clickUnit(page, 'e_yumi');
        await clickCard(page, 'a_tadakatsu');
        await clickGround(page, 5, 10);
        check((await unitOrder(page, 'a_yumi')).targetId === 'e_yumi' && (await unitOrder(page, 'a_tadakatsu')).type === 'move', '0 秒：弓は敵の弓を攻撃・忠勝隊は岸の弓の前へ移動');
        await ffTo(page, 120);
        await clickCard(page, 'a_tadakatsu');
        await clickUnit(page, 'e_kiba');
        await clickCard(page, 'a_yumi');
        await clickUnit(page, 'e_sente');
        await ffTo(page, 150);
        for (const id of ['a_sakakibara', 'a_sakai']) {
            await clickCard(page, id);
            await clickUnit(page, 'e_sente');
        }
        await clickCard(page, 'a_ishikawa');
        await clickGround(page, 0, 10);
        await ffTo(page, 220);
        // 丘の輪（中心 (-70,-85)・半径 30 m）の中の端へ四隊を移す（丘の守りのいない所）
        const pts = { a_tadakatsu: [-50, -75], a_sakakibara: [-48, -90], a_sakai: [-65, -65], a_ishikawa: [-55, -67] };
        const got = [];
        for (const [id, [x, z]] of Object.entries(pts)) {
            const alive = await page.evaluate((u) => window.__battle.state.units.find((v) => v.id === u).status === 'ready', id);
            if (!alive) {
                got.push(`${id}:戦えない`);
                continue;
            }
            await clickCard(page, id);
            await clickGround(page, x, z);
            const o = await unitOrder(page, id);
            got.push(`${id}:${o.type}`);
        }
        await clickCard(page, 'a_yumi');
        await clickUnit(page, 'e_hill_yumi');
        log('   220 秒の命令', got.join(' '));
        check(got.every((g) => g.endsWith(':move') || g.endsWith(':戦えない')), '220 秒：丘の輪の端をクリックすると移動の命令になる', got.join(' '));
        const txt = await goalText(page, 'primary');
        check(/区域に敵がいる|区域に味方がいない/.test(txt), '目標の欄：確保を数えていない理由が出る', txt);
        await page.screenshot({ path: `${OUT}/river_ford-desktop-hill-orders.png` });
        await ffTo(page, 480);
        const r = await page.evaluate(() => window.__battle.state.result);
        check(r?.result === 'victory' && r?.reason === 'objective_done', '丘の輪の端へ移した四隊で確保して勝つ', `${r?.result} ${r?.reason} ${r?.elapsedSec}`);
        await p.ctx.close();
    }

    log('== PC：森林の救出（輪の真ん中の本陣と、空いた地面）');
    {
        const p = await openPage('desktop', 'forest');
        const { page } = p;
        await start(p);
        await clickCard(page, 'a_lost');
        const txt = await goalText(page, 'secondary');
        check(txt.includes('空いた地面'), '目標の欄：救出の進みの文が「輪の中の空いた地面を押す」を示す', txt);
        // 輪の真ん中（家康本陣）をクリック：本陣が選び直され、物見隊は動かない（今の決まり。説明・進みの文で知らせる）
        await clickUnit(page, 'a_ieyasu');
        check((await ui(page)).selectedId === 'a_ieyasu' && (await unitOrder(page, 'a_lost')).type !== 'move', '輪の真ん中の本陣を押すと本陣が選び直される（物見隊は動かない）');
        // 物見隊を選び直し、輪の中の空いた地面（本陣の南西）を押す
        await clickCard(page, 'a_lost');
        await clickGround(page, -20, 155);
        const o = await unitOrder(page, 'a_lost');
        check(o.type === 'move' && Math.hypot(o.x + 20, o.z - 155) < 8, '輪の中の空いた地面を押すと物見隊がそこへ移動する', JSON.stringify(o));
        await ffTo(page, 200);
        const st = await page.evaluate(() => [...document.querySelectorAll('.b-goal[data-role="secondary"]')].map((g) => g.dataset.state).join(','));
        log('   200 秒の副目標（救出）', st);
        check(st === 'done', '物見隊を林の中を通して輪まで連れ帰る（副目標：救出）', st);
        await p.ctx.close();
    }
}

// ================================================================ 夜（第4群の夜襲・奇襲）：未発見の敵の情報が表示の層から漏れない
if (PARTS.includes('night')) {
    /** 敵ごとの、見えているか（合戦の状態）と表示の層の様子（名札の DOM・兵士・画面の位置・表示の層の位置） */
    const enemyLayers = (page) =>
        page.evaluate(() => {
            const B = window.__battle;
            const st = B.troopStats();
            const vis = B.view.vis;
            return B.state.units
                .map((u, i) => ({ u, i }))
                .filter(({ u }) => u.side === 'enemy' && u.present)
                .map(({ u, i }) => {
                    const l = document.querySelector(`.b-label[data-id="${u.id}"]`);
                    return {
                        id: u.id,
                        seen: u.seenBy.ally,
                        labelShown: !!l && !l.hidden,
                        labelText: l?.textContent ?? '',
                        labelTransform: l?.style.transform ?? '',
                        labelOf: B.labelOf(u.id),
                        screen: B.screenOf(u.id),
                        drawn: st.perUnit[u.id] ?? 0,
                        visX: vis[i].px,
                        visZ: vis[i].pz,
                        flagX: vis[i].flagX,
                    };
                });
        });
    /** 漏れ：見えていない敵の、名札・兵士・画面の位置・表示の層の位置のどれかが読める */
    const leaks = (rows) => rows.filter((r) => !r.seen && (r.labelShown || r.labelText !== '' || r.labelTransform !== '' || r.labelOf !== null || r.screen !== null || r.drawn > 0 || Number.isFinite(r.visX) || Number.isFinite(r.visZ) || Number.isFinite(r.flagX)));
    for (const kind of ['desktop', 'phone']) {
        log(`== 夜襲・奇襲：未発見の敵の情報が漏れない（${kind}）`);
        const p = await openPage(kind, 'night_raid');
        const { page } = p;
        await start(p);
        // 表示を 1 コマ以上進める（止めたまま描く）
        await page.waitForTimeout(600);
        let rows = await enemyLayers(page);
        const hiddenIds = rows.filter((r) => !r.seen).map((r) => r.id);
        check(hiddenIds.length >= 5, `[${kind}] 夜：始めは遠くの敵の多くが見えない`, hiddenIds.join(','));
        check(leaks(rows).length === 0, `[${kind}] 夜：見えていない敵の名札・兵士・画面の位置・表示の層の位置が出ない（window.__battle の表示の読み取りでも）`, JSON.stringify(leaks(rows)).slice(0, 400));
        const seenNow = rows.filter((r) => r.seen);
        check(seenNow.length >= 1 && seenNow.every((r) => r.labelShown && r.labelText.length > 0 && r.drawn > 0), `[${kind}] 夜：篝火の中の見えている敵（番兵）は名札・兵士が出る`, JSON.stringify(seenNow.map((r) => ({ id: r.id, l: r.labelShown, d: r.drawn }))));
        // 地図の印：敵の援軍の印は無い（夜襲の敵に援軍は無いが、篝火の名札は出る）
        const torch = await page.evaluate(() => [...document.querySelectorAll('.b-label.terrain')].map((e) => e.textContent).filter((t) => t.includes('篝火')));
        check(torch.length === 2, `[${kind}] 夜：篝火の区域の名札が 2 つ`, torch.join(' / '));
        await page.screenshot({ path: `${OUT}/night_raid-${kind}-night-start.png` });
        // 騎馬（徳川騎馬隊）を札と地面のクリック・タップで、見回りの騎馬 (130,-40) の手前 (70,-30) へ動かす（水田を避けて西の縁を下る）。着いた頃に見回りを見つける
        await page.evaluate((u) => document.querySelector(`.b-card[data-id="${u}"]`).scrollIntoView({ inline: 'nearest', block: 'nearest' }), 'a_kiba');
        await press(p, '.b-card[data-id="a_kiba"]');
        check((await ui(page)).selectedId === 'a_kiba', `[${kind}] 夜：札で徳川騎馬隊を選ぶ`);
        await page.evaluate(() => window.__battle.centerOn(70, -30));
        await page.waitForTimeout(200);
        const g = await page.evaluate(() => window.__battle.screenOfGround(70, -30));
        if (p.phone) await page.touchscreen.tap(g.x, g.y);
        else await page.mouse.click(g.x, g.y);
        await page.waitForTimeout(200);
        const o = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_kiba').order);
        check(o.type === 'move', `[${kind}] 夜：地面の${p.phone ? 'タップ' : 'クリック'}で移動の命令`, JSON.stringify(o));
        let found = false;
        for (let i = 0; i < 70 && !found; i++) {
            await page.evaluate(() => window.__battle.fastForward(1));
            found = await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'e_patrol').seenBy.ally);
        }
        await page.evaluate(() => window.__battle.centerOn(130, -10));
        await page.waitForTimeout(700);
        rows = await enemyLayers(page);
        const patrol = rows.find((r) => r.id === 'e_patrol');
        check(found && patrol.labelShown && patrol.labelText.includes('見回り') && patrol.screen !== null && patrol.drawn > 0, `[${kind}] 夜：近づいて見つけた敵（見回りの騎馬）は、名札・兵士・画面の位置が出る（早送り）`, JSON.stringify({ found, l: patrol.labelShown, t: patrol.labelText, d: patrol.drawn }));
        check(leaks(rows).length === 0, `[${kind}] 夜：まだ見つけていない敵は、見つけた後も漏れない`, JSON.stringify(leaks(rows)).slice(0, 400));
        await page.screenshot({ path: `${OUT}/night_raid-${kind}-night-found.png` });
        await p.ctx.close();
    }
}

await b.close();
log(failures.length ? `\n失敗 ${failures.length}：\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
