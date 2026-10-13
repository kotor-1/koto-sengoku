// 本番ビルドの軍議の選択肢の確かめ（Version 27 の残り。2560×1440 など大きな画面。本番と同じ CSP・開発用のフックは無い）。
// usage: DIST=<本番の dist> [PORT=8770] [VIEW=2560x1440] [WALK_VIEW=1280x720] [TOUCH=0] node e2e/council-pick-prod.mjs <outdir>
//
// 確かめる事（どれも本物の入力。ゲームの状態を開発用の操作で変えない。保存は読むだけ）：
//   1. 軍議の方針の選択肢 A・B・C が画面の中にあり、真ん中を押せる。
//   2. 「自領の防衛」（policy_home）を押すと、その方針の確かめの会話（council.confirm.home：忠勝の
//      「どちらにも兵を出さず、国を守る。…」から 5 行）が 1 つだけ始まる。押した直後（120 ms 後）の 2 度目の押しでは、
//      会話が 2 つ始まったり行が進んだりしない（1/5 のまま）。
//   3. 本物の押しで読み進めると、5 行の後に「それで決める」「考え直す」が出る。
//   4. 「考え直す」で、方針の選び直し（council.again：「改めて、いずれの道を取られますか。」と A・B・C）に戻る。
//      画面上の段階は「軍議」のまま（まだ何も決まっていない）。
//   5. もう一度「自領の防衛」→ 読み進める →「それで決める」で軍議が 1 度だけ閉じ、段階が「出陣の支度」になる。
//      その後 3 秒、確かめの会話や軍議の層が開き直らない。本物の入力でメニュー（Esc）→「保存する」を押し、
//      書かれた保存（読むだけ）の方針が home。方針は「それで決める」の時には保存されない（保存は出陣の前・戦の後・手動）ので、
//      決まった中身は手動の保存で確かめる。
//   6. CSP の違反 0・ページの誤り 0。
// WALK_VIEW：忠勝の所まではこの窓の大きさで歩く（ソフトウェアの描画は 2560×1440 では 1 フレームに数秒かかる）。
//   話しかける前に VIEW へ窓の大きさを変える（ブラウザの窓の操作。ゲームの状態は変えない）。会話・軍議・選択はすべて VIEW で行う。
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, serveDist, skipCinematic } from './lib.mjs';

const DIST = process.env.DIST;
if (!DIST) throw new Error('DIST（本番の dist）を指定する');
const PORT = Number(process.env.PORT || 8770);
const [VW, VH] = (process.env.VIEW || '2560x1440').split('x').map(Number);
const WALK = (process.env.WALK_VIEW || '1280x720').split('x').map(Number);
const TOUCH = process.env.TOUCH === '1';
const OUT = process.argv[2];
if (!OUT) throw new Error('出力のディレクトリを指定する');
mkdirSync(OUT, { recursive: true });
const TAG = `${VW}x${VH}${TOUCH ? '-touch' : ''}`;
const SAVE_KEY = 'koto-sengoku/3d-ieyasu1570';
const HOME_LINES = ['どちらにも兵を出さず、国を守る。', 'ただ、織田は快く思いますまい。', '浪人どもは、まず騎馬が林から', '兵を損なわぬ道にございます。', '皆の考えは出揃いました。'];

const t0 = Date.now();
const log = (s) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (ok, name, detail) => {
    checks.push({ ok: !!ok, name, detail });
    log(`${ok ? 'OK ' : 'NG '} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`);
};
const steps = [];

const srv = await serveDist(DIST, PORT);
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: WALK[0], height: WALK[1] }, deviceScaleFactor: 1, isMobile: TOUCH, hasTouch: TOUCH });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const csp = [];
const errors = [];
page.on('console', (m) => {
    if (m.type() === 'error') (/Content Security Policy/i.test(m.text()) ? csp : errors).push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

const shot = async (name) => {
    const f = `${OUT}/pick-${TAG}-${name}.jpg`;
    await page.screenshot({ path: f, type: 'jpeg', quality: 82 });
    log(`shot ${f}`);
};
/** 一番上の会話の層の様子（読むだけ） */
const state = () =>
    page.evaluate((key) => {
        const layers = [...document.querySelectorAll('.g-layer[data-kind="script"]')];
        const L = layers[layers.length - 1];
        const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
        let save = null;
        try {
            save = JSON.parse(localStorage.getItem(key) ?? 'null');
        } catch {
            save = 'unreadable';
        }
        return {
            layers: layers.length,
            council: document.querySelectorAll('.g-layer.council').length,
            speaker: L?.querySelector('.g-dialog')?.dataset.speaker ?? null,
            text: L?.querySelector('.g-dialog .text')?.textContent.trim() ?? '',
            count: L?.querySelector('.g-dialog .count')?.textContent.trim() ?? '',
            choices: L ? [...L.querySelectorAll('.g-choice')].filter(vis).map((c) => c.dataset.id) : [],
            choiceBoxes: L
                ? [...L.querySelectorAll('.g-choice')].filter(vis).map((c) => {
                      const b = c.getBoundingClientRect();
                      const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
                      return { id: c.dataset.id, l: b.left, t: b.top, r: b.right, b: b.bottom, hit: !!hit && (hit === c || c.contains(hit)) };
                  })
                : [],
            vw: innerWidth,
            vh: innerHeight,
            phase: document.querySelector('.g-hud .g-phase')?.textContent.trim() ?? null,
            policy: save && typeof save === 'object' ? (save.state?.policy ?? save.policy ?? null) : save,
        };
    }, SAVE_KEY);
/** 本物の押し（マウスは要素の真ん中をクリック、タッチはタップ） */
const pressChoice = async (id) => {
    const loc = page.locator(`.g-layer[data-kind="script"] .g-choice[data-id="${id}"]`).last();
    await loc.waitFor({ state: 'visible' });
    await sleep(600); // 出たばかりの選択肢の見張り（350 ms）より後
    const b = await loc.boundingBox();
    if (TOUCH) await loc.tap();
    else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    steps.push(`real ${TOUCH ? 'tap' : 'click'}: ${id}`);
    return b;
};
/** 台詞の枠の上を本物の押しで 1 行送る */
const advance = async () => {
    const dlg = page.locator('.g-layer[data-kind="script"] .g-dialog').last();
    if (TOUCH) await dlg.tap();
    else {
        const b = await dlg.boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
};
/** 選択肢が出るまで本物の押しで読み進める（最大 n 行）。読んだ行の文を返す */
const readUntilChoices = async (want, n = 14) => {
    const seen = [];
    for (let k = 0; k < n; k++) {
        const s = await state();
        if (!seen.length || seen[seen.length - 1] !== s.text) seen.push(s.text);
        if (want.every((id) => s.choices.includes(id))) return { s, seen };
        await advance();
        await sleep(900);
    }
    return { s: await state(), seen };
};
const vin = (b, s) => b.l >= -0.5 && b.t >= -0.5 && b.r <= s.vw + 0.5 && b.b <= s.vh + 0.5;

let error = null;
try {
    await page.goto(`http://localhost:${PORT}/?q=low`);
    const build = await page.locator('#build').textContent().catch(() => '');
    log(`build: ${build?.trim()}`);
    const start = page.locator('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
    await start.waitFor({ state: 'visible' });
    await sleep(500);
    if (TOUCH) await start.tap();
    else await start.click();
    steps.push('real: 歴史分岐をはじめから');
    await skipCinematic(page, { tap: TOUCH, what: 'ch1', log });
    await page.locator('.g-hud').waitFor({ state: 'visible' });
    // 忠勝の所まで本物のキーで歩く（W＋Shift。「話す」が忠勝に向いて出たら止める。行き過ぎたら S・W で少しずつ戻す）
    const talkShown = () => page.evaluate(() => {
        const b = document.querySelector('.g-talk');
        return !!b && !b.hidden && b.dataset.target === 'tadakatsu';
    });
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyW');
    const tw = Date.now();
    while (!(await talkShown()) && Date.now() - tw < 900000) await sleep(300);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Shift');
    const ensureTalk = async (why) => {
        await sleep(3000);
        for (let k = 0; k < 16 && !(await talkShown()); k++) {
            const key = k < 8 ? 'KeyS' : 'KeyW';
            await page.keyboard.down(key);
            await sleep(250);
            await page.keyboard.up(key);
            await sleep(2500);
            steps.push(`real: ${key} を少し（${why}）`);
        }
        return talkShown();
    };
    check(await ensureTalk('歩いた後'), `real: W＋Shift で歩くと本多忠勝の「話す」が出る（${WALK.join('x')}）`, null);
    // 話しかける前に窓を VIEW の大きさへ（ブラウザの窓の操作）
    await page.setViewportSize({ width: VW, height: VH });
    steps.push(`window: ${WALK.join('x')} → ${VW}x${VH}（話しかける前）`);
    await sleep(2000);
    check(await ensureTalk('窓を変えた後'), `${TAG}: 窓を変えた後も忠勝の「話す」が出ている`, null);
    for (let k = 0; ; k++) {
        if (TOUCH) await page.locator('.g-talk').tap();
        else await page.keyboard.press('KeyE');
        const opened = await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'visible', timeout: 90000 }).then(() => true, () => false);
        if (opened) break;
        if (k >= 5) throw new Error('忠勝との会話が 6 回の押しで開かない');
    }
    steps.push(`real: ${TOUCH ? '話す（タップ）' : 'E'} で忠勝と話す`);
    // 城門の会話を読み進め、軍議を開く
    const gate = await readUntilChoices(['open_council'], 20);
    check(gate.s.choices.includes('open_council'), `${TAG}: 城門の会話を読み進めると「軍議を開く」が出る`, gate.s.choices);
    await pressChoice('open_council');
    await page.locator('.g-layer.council').waitFor({ state: 'visible' });
    const council = await readUntilChoices(['policy_oda', 'policy_asai', 'policy_home'], 20);
    const c0 = council.s;
    check(['policy_oda', 'policy_asai', 'policy_home'].every((id) => c0.choices.includes(id)), `${TAG}: 軍議を読み進めると方針の選択肢 A・B・C が出る`, c0.choices);
    check(c0.choiceBoxes.length === 3 && c0.choiceBoxes.every((b) => vin(b, c0) && b.hit), `${TAG}: 方針の選択肢 3 つが画面の中にあり、真ん中を押せる`, c0.choiceBoxes);
    check(c0.phase === '軍議' && c0.policy === null, `${TAG}: 方針を選ぶ前：段階は「軍議」、保存の方針は無い（${c0.phase}・${c0.policy}）`, c0);
    await shot('1-council-choices');

    // 2. 自領の防衛を押す（120 ms 後に同じ所をもう一度押す）
    const b = await pressChoice('policy_home');
    await sleep(120);
    if (TOUCH) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    steps.push(`real ${TOUCH ? 'tap' : 'click'}: 120 ms 後に同じ所をもう一度`);
    await sleep(1500);
    const p1 = await state();
    check(p1.text.startsWith(HOME_LINES[0]), `${TAG}: 自領の防衛を押すと、その方針の確かめの会話が始まる（${p1.speaker}：${p1.text.slice(0, 20)}…）`, p1);
    check(p1.count === '1/5', `${TAG}: 確かめの会話は 1 行目（${p1.count}）。押した直後の 2 度目の押しで行が進まない`, p1.count);
    check(p1.layers === 1 && p1.council === 1, `${TAG}: 会話の層・軍議の層はそれぞれ 1 つだけ（${p1.layers}・${p1.council}）`, p1);
    check(p1.phase === '軍議', `${TAG}: 確かめの会話の間、段階は「軍議」のまま（${p1.phase}）`, p1.phase);
    await shot('2-confirm-start');

    // 3. 読み進めると「それで決める」「考え直す」
    const r1 = await readUntilChoices(['confirm_policy', 'reconsider']);
    check(r1.s.choices.includes('confirm_policy') && r1.s.choices.includes('reconsider'), `${TAG}: 5 行の後に「それで決める」「考え直す」が出る（${r1.s.count}）`, r1.s.choices);
    check(HOME_LINES.every((h, i) => (r1.seen[i] ?? '').startsWith(h)), `${TAG}: 確かめの会話は自領の防衛の 5 行（順に）`, r1.seen.map((t) => t.slice(0, 16)));
    check(r1.s.choiceBoxes.every((x) => vin(x, r1.s) && x.hit), `${TAG}: 「それで決める」「考え直す」が画面の中にあり、真ん中を押せる`, r1.s.choiceBoxes);
    await shot('3-confirm-choices');

    // 4. 考え直す → 方針の選び直し
    await pressChoice('reconsider');
    await sleep(1500);
    const again = await state();
    check(again.text.startsWith('改めて、いずれの道を取られますか。'), `${TAG}: 「考え直す」で方針の選び直しに戻る（${again.text}）`, again);
    const againC = await readUntilChoices(['policy_oda', 'policy_asai', 'policy_home'], 4);
    check(['policy_oda', 'policy_asai', 'policy_home'].every((id) => againC.s.choices.includes(id)) && againC.s.choiceBoxes.every((x) => vin(x, againC.s) && x.hit), `${TAG}: 選び直しで A・B・C がまた出て、押せる`, againC.s.choiceBoxes);
    check(againC.s.phase === '軍議' && againC.s.policy === null && againC.s.layers === 1 && againC.s.council === 1, `${TAG}: 考え直した後も何も決まっていない（段階 ${againC.s.phase}・層 ${againC.s.layers}・軍議 ${againC.s.council}）`, againC.s);
    await shot('4-reconsidered');

    // 5. もう一度自領の防衛 → それで決める
    await pressChoice('policy_home');
    await sleep(1500);
    const p2 = await state();
    check(p2.text.startsWith(HOME_LINES[0]) && p2.count === '1/5' && p2.layers === 1, `${TAG}: もう一度自領の防衛を押すと、確かめの会話が 1 行目から 1 つだけ始まる（${p2.count}）`, p2);
    const r2 = await readUntilChoices(['confirm_policy', 'reconsider']);
    check(r2.s.choices.includes('confirm_policy'), `${TAG}: 読み進めると「それで決める」が出る`, r2.s.choices);
    await pressChoice('confirm_policy');
    await sleep(2500);
    const done = await state();
    check(done.council === 0 && done.phase === '出陣の支度', `${TAG}: 「それで決める」で軍議が閉じ、段階が「出陣の支度」になる（軍議 ${done.council}・${done.phase}）`, done);
    check(!done.text.startsWith(HOME_LINES[0]) && !done.choices.includes('confirm_policy'), `${TAG}: 決めた後に確かめの会話が開き直っていない`, done);
    await shot('5-decided');
    // その後 3 秒、方針の確かめ・選び直し・軍議が出直さない（1 度だけ決まる）
    const seenAfter = [];
    for (let k = 0; k < 6; k++) {
        await sleep(500);
        const s = await state();
        seenAfter.push({ layers: s.layers, council: s.council, phase: s.phase, text: s.text.slice(0, 16), choices: s.choices });
    }
    check(seenAfter.every((s) => s.council === 0 && s.phase === '出陣の支度' && !s.choices.includes('confirm_policy') && !s.choices.includes('policy_home') && !s.text.startsWith(HOME_LINES[0])), `${TAG}: 決めた後の 3 秒、軍議・方針の確かめ・選び直しは出ず、段階は「出陣の支度」のまま`, seenAfter);
    log(`after decide: ${JSON.stringify(seenAfter[seenAfter.length - 1])}`);
    // 決まった中身：本物の入力でメニュー（Esc）→「保存する」。会話が出ていれば本物の押しで読み終える
    for (let k = 0; k < 20 && (await state()).layers > 0; k++) {
        const s = await state();
        if (s.choices.length) break;
        await advance();
        await sleep(900);
    }
    await page.keyboard.press('Escape');
    const saveBtn = page.locator('.g-layer[data-kind="menu"] .g-btn[data-id="save"], .g-layer .g-panel .g-btn[data-id="save"]').last();
    await saveBtn.waitFor({ state: 'visible', timeout: 60000 });
    await sleep(600);
    const canSave = await saveBtn.isEnabled();
    check(canSave, `${TAG}: 決めた後、メニューの「保存する」が押せる`, canSave);
    if (canSave) {
        const sb = await saveBtn.boundingBox();
        if (TOUCH) await saveBtn.tap();
        else await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
        steps.push(`real ${TOUCH ? 'tap' : 'click'}: メニュー → 保存する`);
        await sleep(2500);
    }
    const saved = await state();
    const msg = await page.locator('.g-panel .g-msg').last().textContent().catch(() => '');
    check(saved.policy === 'home', `${TAG}: 手動で保存した保存の方針は home（${saved.policy}）。メッセージ：${(msg ?? '').slice(0, 40)}`, { policy: saved.policy, msg });
    await shot('6-saved');
    await page.keyboard.press('Escape');
    await sleep(800);
} catch (e) {
    error = String(e).split('\n')[0];
    log(`ERROR ${error}`);
    await shot('failed').catch(() => {});
}
check(csp.length === 0, `${TAG}: CSP の違反 0（${csp.length}）`, csp);
check(errors.length === 0, `${TAG}: ページの誤り 0（${errors.length}）`, errors);
const ng = checks.filter((c) => !c.ok).length;
writeFileSync(`${OUT}/pick-${TAG}.json`, JSON.stringify({ dist: DIST, view: TAG, walk: WALK, touch: TOUCH, steps, checks, ng, error, csp, errors }, null, 1));
log(`checks=${checks.length} ng=${ng}${error ? ` error=${error}` : ''}`);
await browser.close();
await srv.close?.();
process.exit(error || ng ? 1 : 0);
