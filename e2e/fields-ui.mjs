/**
 * 合戦場の画面（データ駆動の戦場・6〜10 部隊）の表示と操作を、実際のブラウザで実際のクリック・キー・タップで確かめる。
 *   BASE=http://localhost:8172 node e2e/fields-ui.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - ?dev=field&id=<戦場id> で 5 戦場をそれぞれ開き、PC（1280×720）とスマホ横（844×390、タッチ）で 1 枚ずつ撮る（出力先/<id>-desktop.png・<id>-phone.png）。
 * - 画面の部品（左上の欄・目標の欄・右上・右・札・命令のボタン・案内）が重ならない・はみ出さないことを、四角の位置で確かめる。
 * - 大平原（plains。味方 7 部隊）：PC は 1〜7 キーで選ぶ・札の数・武将の行（名前・役割・固有能力の「仮」）・移動・攻撃・防衛・撤退を
 *   クリックとキーで出す。スマホは札を横になぞってずらす（なぞっても選ばない）・札をタップで選ぶ・地図のタップで移動・目標の欄を開く／畳む。
 * - 結果の画面：全軍撤退で終え、勝敗・主目標・副目標の行が別々に出る（約束は演習に無い）。
 * 待つ時間だけは開発用の早送り（window.__battle.fastForward）を使う。命令は画面のクリック・タップ・キーで出す。状態は window.__battle から読むだけ。
 * PARTS=shots,desktop,phone で一部だけ（既定はすべて）。
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
const PARTS = (process.env.PARTS || 'shots,desktop,phone').split(',');
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass'];

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

// ================================================================ 5 戦場を開いて撮る
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

await b.close();
log(failures.length ? `\n失敗 ${failures.length}：\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
