/**
 * 歴史分岐「元亀元年・家康」の合戦の画面：特殊能力と戦前の約束の表示・操作を、実際のブラウザで実際のクリック・キー・タップで確かめる。
 *   BASE=http://localhost:8151 node e2e/ieyasu-battle-ui.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - ?dev=battle&scenario=ieyasu&policy=…&pledge=1 で合戦をすぐ始める。
 * - PC（1280×720、マウス・キー）：B（浅井と組む）。号令を指揮中に F で使う（止めている間は残りが減らない）・連打しても重ならない・
 *   援護の対象選び（範囲に味方がいない理由・敵を押す・遠い味方を押す → 回数を減らさない・Esc で取り消し・正しい対象）・
 *   忠勝隊の退路の守護（移動を断る理由）・約束の相手を味方の陣へ入れて「陣に入って x/20 秒」→「持ちこたえた ✓」→ 全軍撤退で「撤退・約束を守った」。
 * - スマホ横（844×390、タッチ）：A（織田と組む）。号令・退路の守護をタップで使う・敵の長政隊を調べて「能力」→ 敵方の理由・
 *   織田援軍を浅井先手へ突っ込ませて崩れる →「守れない」→ 結果で「約束を守れなかった」。同じページで B をもう一度（札で援護の対象を選ぶ）。
 * - 架空の第一章（?dev=battle&ally=tashiro）に「能力」のボタン・約束の行が出ないこと。
 * 待つ時間だけは開発用の早送り（window.__battle.fastForward。台本なし＝敵の考えだけが動く）を使う（ソフトウェア描画では実時間だと何分もかかるため）。
 * 命令・能力・対象選びは、すべて画面のクリック・タップ・キーで出す。状態は window.__battle から読むだけ。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/ieyasu/battle-ui';
mkdirSync(OUT, { recursive: true });
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();
/** PARTS=desktop,phone,fictional で一部だけ（既定はすべて） */
const PARTS = (process.env.PARTS || 'desktop,phone,fictional').split(',');

async function openPage(kind, query) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error') {
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?dev=battle&${query}&q=low`);
    await waitBriefing(page);
    log(`[${kind}] ${query} 合戦の画面まで ${Date.now() - t0} ms`);
    return { page, ctx, phone };
}

async function waitBriefing(page) {
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 30000, polling: 250 });
    await page.waitForTimeout(400);
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const ab = (page, id) =>
    page.evaluate((id) => {
        const r = window.__battle.state.abilities[id];
        return r && { usedAt: r.usedAt, until: r.until, targetId: r.targetId, ended: r.ended, linked: r.linked, t: window.__battle.state.t };
    }, id);
const unit = (page, id) =>
    page.evaluate((id) => {
        const u = window.__battle.state.units.find((x) => x.id === id);
        return u && { x: u.x, z: u.z, status: u.status, order: u.order, strength: u.strength, start: u.startStrength };
    }, id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const groundXY = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
const text = (page, sel) => page.evaluate((sel) => document.querySelector(sel)?.textContent ?? null, sel);
const hidden = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !e || e.hidden || getComputedStyle(e).display === 'none'; }, sel);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** 押す（PC：クリック、スマホ：タップ） */
async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(250);
}
async function pressAt(p, pt) {
    if (p.phone) await p.page.touchscreen.tap(pt.x, pt.y);
    else await p.page.mouse.click(pt.x, pt.y);
    await p.page.waitForTimeout(300);
}
const card = (n) => `.b-card:nth-child(${n})`;

/** 重なりの確かめ：左上の欄・約束の行・能力の欄・右上・右・下・案内の四角が互いに重ならない */
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
        return { hits, out, boxes };
    });
    check(r.hits.length === 0 && r.out.length === 0, `${label}：画面の部品が重ならない・はみ出さない`, [...r.hits, ...r.out].join(' '));
}

// ================================================================ PC：B（浅井と組む）・約束を引き受けた
if (PARTS.includes('desktop')) {
    const p = await openPage('desktop', 'scenario=ieyasu&policy=asai&pledge=1');
    const { page } = p;
    const brief = await text(page, '.b-modal');
    check(brief.includes('1570年の情勢を背景にした架空の局地戦'), '説明の題に「1570年の情勢を背景にした架空の局地戦」');
    check(brief.includes('史実から分かれた道'), '説明に B は「史実から分かれた道」');
    check(brief.includes('F で使う'), '説明の操作に「能力」ボタンか F');
    await shot(page, 'desktop-01-briefing');
    await press(p, '.b-primary');
    check((await ui(page)).started, '合戦を始めた（クリック）');
    check(!(await hidden(page, '.b-pledge')), '条件の欄に約束の行が出る', await text(page, '.b-pledge'));
    check((await text(page, '.b-pledge')).includes('約束：浅井長政隊の退路を守る'), '約束の行：対象の名前');
    check(await page.evaluate(() => document.querySelector('.b-label.pledge')?.textContent?.includes('浅井長政隊')), '約束の対象の名札に「約束」の印');
    check((await text(page, '.b-obj-head')).includes('架空の局地戦'), '見出しの札が「架空の局地戦」');

    // ---- 指揮中に家康本陣の号令を F で ----
    await page.keyboard.press('Space');
    check((await ui(page)).paused, 'Space で指揮（一時停止）');
    await press(p, card(1));
    check((await ui(page)).selectedId === 't_honjin', '札で家康本陣を選ぶ');
    const panel1 = await text(page, '.b-abil');
    check(panel1.includes('立て直しの号令') && panel1.includes('使える') && panel1.includes('対象') && panel1.includes('効果') && panel1.includes('代償') && panel1.includes('範囲 110 m') && panel1.includes('ゲーム用の創作'), '能力の欄：名前・使える・対象・範囲・効果・代償・創作の断り', panel1.slice(0, 80));
    await shot(page, 'desktop-02-select-ieyasu');
    await overlapCheck(page, 'PC 家康本陣を選んだ');
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(300);
    const r1 = await ab(page, 't_honjin');
    check(r1.usedAt !== null && Math.abs(r1.until - r1.t - 35) < 0.01, 'F で号令を使った（指揮中）');
    check((await text(page, '.b-abil')).includes('効果中 残り 35 秒'), '能力の欄：効果中 残り 35 秒');
    check(await page.evaluate(() => [...document.querySelectorAll('.b-toast')].some((t) => t.textContent.includes('立て直しの号令'))), '知らせに号令が出る（止めている間も）');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.b-toast')).pointerEvents === 'none'), '知らせは押せない（pointer-events: none）');
    check((await text(page, card(1))).includes('号令 35 秒'), '札に号令の残り秒');
    const labels = await page.evaluate(() => [...document.querySelectorAll('.b-label')].map((l) => l.textContent).join('|'));
    check(labels.includes('号令'), '名札に号令の印', labels.slice(0, 120));
    await page.waitForTimeout(1500);
    const r1b = await ab(page, 't_honjin');
    check(r1b.t === r1.t && (await text(page, '.b-abil')).includes('残り 35 秒'), '指揮中は効果の時間が減らない（1.5 秒待っても 35 秒）');
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(200);
    const r1c = await ab(page, 't_honjin');
    check(r1c.usedAt === r1.usedAt && r1c.until === r1.until, 'もう一度 F：重ねて発動しない');
    check((await hintText(page)).includes('いま効果中'), 'もう一度 F：理由「いま効果中」', await hintText(page));
    await shot(page, 'desktop-03-rally-paused');

    // ---- 浅井長政隊の援護：範囲に味方がいない ----
    await press(p, card(4));
    check((await ui(page)).selectedId === 'a_nagamasa', '札で浅井長政隊を選ぶ');
    const panel4 = await text(page, '.b-abil');
    check(panel4.includes('盟友への援護') && panel4.includes('使えない') && panel4.includes('60 m 以内に援護できる味方の部隊がいない'), '能力の欄：援護は使えない理由（60 m 以内に味方がいない）');
    await press(p, '.b-abil-btn');
    check((await ui(page)).pending === 'none' && (await hintText(page)).includes('使えない'), '「能力」を押しても対象選びにならず理由を出す', await hintText(page));
    check((await ab(page, 'a_nagamasa')).usedAt === null, '回数は減らない');
    await shot(page, 'desktop-04-support-no-target');

    // 忠勝隊を長政隊の近くへ（クリックで移動）
    await press(p, card(2));
    await pressAt(p, await groundXY(page, -35, 35));
    const tad = await unit(page, 't_tadakatsu');
    check(tad.order.type === 'move', '忠勝隊に移動の命令（地面をクリック）');
    await page.keyboard.press('Space');
    log('    （早送り 14 秒：忠勝隊が歩く間）');
    await ff(page, 14);
    await page.keyboard.press('Space');
    check((await ui(page)).paused, 'もう一度指揮（一時停止）');
    const rally = await ab(page, 't_honjin');
    check(rally.until - rally.t < 35 && rally.until - rally.t > 0, '再開して進むと号令の残りが減る', `残り ${(rally.until - rally.t).toFixed(1)} 秒`);

    // 援護の対象選び
    await press(p, card(4));
    await press(p, '.b-abil-btn');
    check((await ui(page)).pending === 'ability', '「能力」で援護の対象選びに入る');
    check((await hintText(page)).includes('援護する味方の部隊を押してください'), '案内：援護する味方を押す');
    await shot(page, 'desktop-05-support-choose');
    // 敵を押す（攻撃にはならず、対象にできない理由）
    const enemyId = await page.evaluate(() => window.__battle.state.units.find((u) => u.side === 'enemy' && u.present && u.seenBy.ally && u.status === 'ready')?.id);
    await pressAt(p, await screenOf(page, enemyId));
    check((await hintText(page)).includes('敵の部隊は対象にできない'), `敵（${enemyId}）を押す → 理由`, await hintText(page));
    const nag1 = await unit(page, 'a_nagamasa');
    check(nag1.order.type !== 'attack', '敵を押しても攻撃の命令にならない');
    check((await ab(page, 'a_nagamasa')).usedAt === null && (await ui(page)).pending === 'ability', '回数は減らず、対象選びが続く');
    // 遠い味方（家康本陣）を押す
    await pressAt(p, await screenOf(page, 't_honjin'));
    check((await hintText(page)).includes('離れている'), '遠い味方（家康本陣）を押す → 離れている理由', await hintText(page));
    check((await ab(page, 'a_nagamasa')).usedAt === null, '回数は減らない');
    await shot(page, 'desktop-06-support-invalid');
    // Esc で取り消し
    await page.keyboard.press('Escape');
    check((await ui(page)).pending === 'none' && (await ui(page)).selectedId === 'a_nagamasa', 'Esc で対象選びをやめる（選択は残る）');
    // 正しい対象
    await page.keyboard.press('KeyF');
    check((await ui(page)).pending === 'ability', 'F でも対象選びに入る');
    await pressAt(p, await screenOf(page, 't_tadakatsu'));
    const sup = await ab(page, 'a_nagamasa');
    check(sup.usedAt !== null && sup.targetId === 't_tadakatsu', '忠勝隊を押す → 援護（指揮中）');
    check((await ui(page)).pending === 'none', '対象選びが終わる');
    check((await text(page, '.b-abil')).includes('本多忠勝隊を援護中'), '能力の欄：本多忠勝隊を援護中');
    await page.waitForTimeout(600);
    await shot(page, 'desktop-07-support-linked');

    // ---- 忠勝隊の退路の守護（ボタンで）→ 移動を断る ----
    await press(p, card(2));
    await press(p, '.b-abil-btn');
    const rg = await ab(page, 't_tadakatsu');
    check(rg.usedAt !== null, '「能力」ボタンで退路の守護');
    check((await text(page, card(2))).includes('踏みとどまる'), '札の命令：踏みとどまる（退路の守護）');
    await pressAt(p, await groundXY(page, -10, 80));
    check((await hintText(page)).includes('踏みとどまっている'), '地面を押しても動かない（理由：踏みとどまっている・残り秒）', await hintText(page));
    check((await unit(page, 't_tadakatsu')).order.type === 'hold', '命令は防衛・待機のまま');
    const labels2 = await page.evaluate(() => [...document.querySelectorAll('.b-label')].map((l) => l.textContent).join('|'));
    check(labels2.includes('踏みとどまる') && labels2.includes('援護'), '名札に踏みとどまる・援護の印', labels2.slice(0, 160));
    await shot(page, 'desktop-08-rearguard-rooted');
    await overlapCheck(page, 'PC 能力 3 つを使った');

    // ---- 約束：長政隊を味方の陣へ ----
    await press(p, card(4));
    // 家康本陣（0,110）の真後ろは避け、陣の西寄りへ
    await pressAt(p, await groundXY(page, -20, 132));
    check((await unit(page, 'a_nagamasa')).order.type === 'move', '長政隊を味方の陣へ（地面をクリック）');
    await page.keyboard.press('Space');
    let midShot = false;
    for (let i = 0; i < 16; i++) {
        log('    （早送り 5 秒）');
        await ff(page, 5);
        await page.waitForTimeout(250);
        const pl = await text(page, '.b-pledge');
        const nu = await unit(page, 'a_nagamasa');
        log(`      長政隊 (${nu.x.toFixed(0)}, ${nu.z.toFixed(0)}) ${nu.status} ${nu.order.type}｜${pl}`);
        if (!midShot && /陣に入って \d+\/20 秒/.test(pl)) {
            midShot = true;
            check(true, '約束の行：陣に入って x/20 秒', pl);
            await shot(page, 'desktop-09-pledge-counting');
        }
        if (pl.includes('持ちこたえた') || (await page.evaluate(() => !!window.__battle.state.result))) break;
    }
    const plDone = await text(page, '.b-pledge');
    check(midShot, '陣に入っている間の数えが見えた');
    check(plDone.includes('陣で 20 秒 持ちこたえた ✓'), '約束の行：持ちこたえた ✓', plDone);
    await shot(page, 'desktop-10-pledge-secured');
    // 全軍撤退
    if (!(await page.evaluate(() => !!window.__battle.state.result))) {
        await press(p, '.b-allret');
        check((await ui(page)).modal === 'confirm', '全軍撤退の確かめ');
        await press(p, '.b-modal .b-primary');
        log('    （早送り：退くまで）');
        for (let i = 0; i < 12 && !(await page.evaluate(() => !!window.__battle.state.result)); i++) await ff(page, 5);
    }
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 60000, polling: 250 });
    const res = await text(page, '.b-result');
    const out = await page.evaluate(() => window.__battle.state.result);
    log('    結果', out.result, out.reason, JSON.stringify(out.pledge));
    check(out.pledge?.result === 'kept', '結果：約束を守った（記録）');
    check(res.includes('約束を守った') && res.includes('勝敗とは別'), '結果の画面：約束の欄が勝敗と別に出る', res.slice(0, 120));
    check(res.includes('立て直しの号令：開始') && res.includes('盟友への援護：開始'), '結果の画面：使った能力');
    check(!res.includes('若殿') && !res.includes('鷲尾'), '結果の画面に架空の第一章の言葉が出ない');
    await shot(page, 'desktop-11-result-pledge-kept');
    await ctx_close(p);
}

// ================================================================ スマホ横：A（織田と組む）・約束を引き受けた → 守れない
if (PARTS.includes('phone')) {
    const p = await openPage('phone', 'scenario=ieyasu&policy=oda&pledge=1');
    const { page } = p;
    await shot(page, 'phone-01-briefing');
    await press(p, '.b-primary');
    check((await ui(page)).started, '合戦を始めた（タップ）');
    await press(p, '.b-pause');
    check((await ui(page)).paused, '「指揮」をタップで一時停止');
    check(!(await hidden(page, '.b-pledge')), '条件の欄を畳んでいても約束の行が見える', await text(page, '.b-pledge'));
    // 号令をタップで
    await press(p, card(1));
    check(!(await hidden(page, '.b-abil')), '能力の欄が出る（スマホ）');
    await shot(page, 'phone-02-select-ieyasu');
    await overlapCheck(page, 'スマホ 家康本陣を選んだ');
    await press(p, '.b-abil-btn');
    check((await ab(page, 't_honjin')).usedAt !== null, '「能力」をタップで号令（指揮中）');
    // 同じタップの click（合成）で 2 度動かない：もう一度の理由が出ていない
    check(!(await hintText(page)).includes('いま効果中'), 'タップ 1 回で 2 度押しにならない', await hintText(page));
    // 敵の長政隊を調べて「能力」
    const hq = await screenOf(page, 't_honjin');
    await pressAt(p, hq); // 選んでいる部隊をもう一度押すと外れる
    if ((await ui(page)).selectedId) await pressAt(p, hq);
    check((await ui(page)).selectedId === null, '地図で家康本陣を押して選択を外す');
    const en = await screenOf(page, 'e_nagamasa');
    await pressAt(p, en);
    check((await ui(page)).selectedId === 'e_nagamasa', '敵の浅井長政隊を調べる（タップ）');
    const ep = await text(page, '.b-abil');
    check(ep.includes('盟友への援護') && ep.includes('敵方'), '能力の欄：敵方（敵の考えが使う）', ep.slice(0, 80));
    await press(p, '.b-abil-btn');
    check((await hintText(page)).includes('敵方の武将の能力'), '敵を選んで「能力」→ 操作できない理由', await hintText(page));
    await shot(page, 'phone-03-enemy-nagamasa');
    // 忠勝隊の退路の守護
    await press(p, card(2));
    await press(p, '.b-abil-btn');
    check((await ab(page, 't_tadakatsu')).usedAt !== null, '「能力」をタップで退路の守護');
    await pressAt(p, await groundXY(page, 30, 90));
    check((await hintText(page)).includes('踏みとどまっている'), '地面をタップしても動かない（理由）', await hintText(page));
    await shot(page, 'phone-04-rearguard');
    await overlapCheck(page, 'スマホ 退路の守護');
    // 織田援軍を浅井先手へ突っ込ませる
    await press(p, card(4));
    await pressAt(p, await screenOf(page, 'e_asai_sente'));
    check((await unit(page, 'a_oda')).order.type === 'attack', '織田援軍に浅井先手への攻撃（タップ）');
    await press(p, '.b-pause');
    let broke = false;
    for (let i = 0; i < 30; i++) {
        log('    （早送り 5 秒）');
        await ff(page, 5);
        await page.waitForTimeout(200);
        const u = await unit(page, 'a_oda');
        if (u.status === 'routed' || u.status === 'destroyed') {
            broke = true;
            break;
        }
        if (await page.evaluate(() => !!window.__battle.state.result)) break;
    }
    const pl = await text(page, '.b-pledge');
    check(broke, '織田援軍が崩れた');
    check(pl.includes('守れない') || pl.includes('守れなかった'), '約束の行：守れない', pl);
    await page.waitForTimeout(300);
    await shot(page, 'phone-05-pledge-broken');
    if (!(await page.evaluate(() => !!window.__battle.state.result))) {
        await press(p, '.b-allret');
        await press(p, '.b-modal .b-primary');
        for (let i = 0; i < 12 && !(await page.evaluate(() => !!window.__battle.state.result)); i++) await ff(page, 5);
    }
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 60000, polling: 250 });
    const out = await page.evaluate(() => window.__battle.state.result);
    log('    結果', out.result, out.reason, JSON.stringify(out.pledge));
    const res = await text(page, '.b-result');
    check(out.pledge?.result === 'broken' && res.includes('約束を守れなかった'), '結果の画面：約束を守れなかった（勝敗と別）', res.slice(0, 100));
    await shot(page, 'phone-06-result-pledge-broken');
    await overlapCheck(page, 'スマホ 結果');
    await press(p, '.b-modal .b-primary');
    await page.waitForFunction(() => window.__battleOutcome && !window.__battle.active, null, { timeout: 30000, polling: 250 });
    check(await page.evaluate(() => !document.getElementById('battle-ui')), '「続ける」で合戦の画面を片付けた');

    // ---- 同じページで B：札で援護の対象を選ぶ ----
    await page.evaluate(() => void window.__battleDev.runIeyasu('asai', false));
    await waitBriefing(page);
    await press(p, '.b-primary');
    await press(p, '.b-pause');
    check(await hidden(page, '.b-pledge'), '約束を引き受けていない合戦：約束の行は出ない');
    await press(p, card(2));
    await pressAt(p, await groundXY(page, -35, 35));
    await press(p, '.b-pause');
    log('    （早送り 14 秒）');
    await ff(page, 14);
    await press(p, '.b-pause');
    await press(p, card(4));
    await press(p, '.b-abil-btn');
    check((await ui(page)).pending === 'ability', 'スマホ：「能力」で援護の対象選び');
    await shot(page, 'phone-07-support-choose');
    await press(p, card(3)); // 徳川弓隊（遠い）
    check((await hintText(page)).includes('離れている') && (await ab(page, 'a_nagamasa')).usedAt === null, '遠い味方の札 → 理由・回数は減らない', await hintText(page));
    await press(p, '.b-hint-x');
    check((await ui(page)).pending === 'none', '「やめる」で対象選びをやめる');
    await press(p, '.b-abil-btn');
    await press(p, card(2)); // 本多忠勝隊
    const sup = await ab(page, 'a_nagamasa');
    check(sup.usedAt !== null && sup.targetId === 't_tadakatsu', '札で忠勝隊を選んで援護');
    await page.waitForTimeout(500);
    await shot(page, 'phone-08-support-linked');
    await overlapCheck(page, 'スマホ 援護');
    await press(p, '.b-allret');
    await press(p, '.b-modal .b-primary');
    for (let i = 0; i < 12 && !(await page.evaluate(() => !!window.__battle.state.result)); i++) await ff(page, 5);
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 60000, polling: 250 });
    const res2 = await text(page, '.b-result');
    check(res2.includes('約束：引き受けていない') && res2.includes('約束違反ではない'), '結果の画面：引き受けていない＝約束違反ではない');
    await shot(page, 'phone-09-result-declined');
    await ctx_close(p);
}

// ================================================================ 架空の第一章：今までどおり
if (PARTS.includes('fictional')) {
    const p = await openPage('desktop', 'ally=tashiro');
    const { page } = p;
    await press(p, '.b-primary');
    check(await page.evaluate(() => !document.querySelector('.b-abil-btn') && document.querySelectorAll('.b-cmd').length === 4), '架空：「能力」のボタンなし（命令のボタンは 4 つ）');
    check(await hidden(page, '.b-pledge'), '架空：約束の行なし');
    check((await text(page, '.b-obj-head')).includes('仮シナリオ'), '架空：札は「仮シナリオ」');
    await press(p, card(1));
    check(await hidden(page, '.b-abil'), '架空：部隊を選んでも能力の欄は出ない');
    await page.keyboard.press('KeyF');
    check((await ui(page)).pending === 'none' && !(await hintText(page)), '架空：F を押しても何も起きない');
    await shot(page, 'desktop-12-fictional');
    await ctx_close(p);
}

async function ctx_close(p) {
    await p.ctx.close();
}

await b.close();
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
