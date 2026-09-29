/**
 * 合戦場の演習の入口（最初の形。後の作業者が広げる）：タイトル → 合戦場の演習 → 戦場の一覧 → 大平原 → 合戦の前の説明 → 出陣 → 合戦の画面、
 * を実際のブラウザで、実際のクリック（PC）・タップ（スマホ）で通す。
 *   BASE=http://localhost:8173 node e2e/fields-practice.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - PC（1280×720、マウス）とスマホ横（844×390、タッチ）。一覧・説明の画面を撮る（既定の出力先 e2e-out/practice/）。
 * - 画面の中身の確かめ：5 戦場の札・「ゲーム用の演習（架空の相手）」・札どうしが重ならない・横にはみ出さない・ボタンが画面の中。
 * - PC だけ：合戦を「合戦を始める」で始め、全軍撤退と早送り（window.__battle の開発用。状態を直接進める）で決着させ、
 *   合戦の結果の「続ける」→ 演習の結果（勝敗・主目標・副目標の行）→「一覧へ」を押し、記録が保存され一覧に出ることを確かめる。
 * 状態は window.__practice・window.__game・window.__battle から読むだけ（画面の操作はすべてクリック・タップ）。
 * PARTS=desktop,phone で一部だけ（既定は両方）。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/practice';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone').split(',');
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}
const POLL = { timeout: 300000, polling: 250 };

const b = await launchBrowser();

async function openPage(kind) {
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
    await page.goto(`${BASE}/?q=low`);
    await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
    log(`[${kind}] タイトルまで ${Date.now() - t0} ms`);
    return { page, ctx, phone, kind };
}

/** 押す（PC：クリック、スマホ：タップ）。出たばかりのボタンは決まらない（ui/guard.ts）ので、少し待ってから */
async function press(p, sel) {
    await p.page.waitForTimeout(450);
    await p.page.locator(sel).scrollIntoViewIfNeeded();
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
}

const pr = (page) => page.evaluate(() => ({ screen: window.__practice?.screen, fieldId: window.__practice?.fieldId, ui: window.__practice?.ui }));
const waitSheet = (page, name) => page.waitForFunction((n) => window.__practice?.ui?.kind === 'sheet' && window.__practice.ui.sheet === n, name, POLL);

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

async function run(kind) {
    log(`== ${kind} ==`);
    const p = await openPage(kind);
    const { page } = p;
    await page.screenshot({ path: `${OUT}/${kind}-0-title.png` });
    const entry = await page.evaluate(() => {
        const e = document.querySelector('[data-practice="entry"]');
        const ids = [...document.querySelectorAll('.g-title-layer .g-btn')].map((b) => b.dataset.id);
        return { text: e?.textContent ?? '', ids };
    });
    check(entry.text.includes('合戦場の演習') && entry.text.includes('架空の相手'), `[${kind}] タイトルに「合戦場の演習」の入口`);
    check(JSON.stringify(entry.ids) === JSON.stringify(['new:ieyasu1570', 'continue:ieyasu1570', 'new:fictional', 'continue:fictional', 'practice']), `[${kind}] タイトルのボタンの並び（シナリオの 4 つは今のまま）`, entry.ids.join(','));

    // タイトル → 演習の一覧
    await press(p, '[data-id="practice"]');
    await waitSheet(page, 'practice-list');
    await page.waitForTimeout(300);
    const s1 = await pr(page);
    check(s1.screen === 'list', `[${kind}] 一覧の画面（__practice.screen=list）`);
    const list = await page.evaluate(() => ({
        fields: [...document.querySelectorAll('.g-pr-field')].map((e) => e.dataset.field),
        text: document.querySelector('.g-pr-list')?.textContent ?? '',
        covered: document.body.classList.contains('g-modal'),
    }));
    check(JSON.stringify(list.fields) === JSON.stringify(['plains', 'river_ford', 'hills', 'forest', 'mountain_pass']), `[${kind}] 5 戦場が演習の順に並ぶ`, list.fields.join(','));
    check(list.text.includes('ゲーム用の演習（架空の相手）'), `[${kind}] 「ゲーム用の演習（架空の相手）」と出る`);
    check(list.text.includes('主目標') && list.text.includes('副目標') && list.text.includes('最後'), `[${kind}] 主目標・副目標・記録の欄`);
    await layoutCheck(p, '一覧', '.g-pr-field');
    await scrollShots(p, `${kind}-1-list`);

    // 一覧 → 大平原の説明
    await press(p, '[data-id="field:plains"]');
    await waitSheet(page, 'practice-briefing');
    await page.waitForTimeout(300);
    const s2 = await pr(page);
    check(s2.screen === 'briefing' && s2.fieldId === 'plains', `[${kind}] 説明の画面（大平原）`);
    const brief = await page.evaluate(() => ({
        text: document.querySelector('.g-pr-brief')?.textContent ?? '',
        units: [...document.querySelectorAll('.g-pr-units tr[data-unit]')].map((e) => e.dataset.unit),
        prov: document.querySelectorAll('.g-pr-units td.ab .g-tag').length,
        primary: document.querySelector('[data-objective="primary"]')?.textContent ?? '',
        secondary: [...document.querySelectorAll('.g-pr-brief [data-objective="secondary"]')].map((e) => e.textContent),
    }));
    check(brief.units.length === 7, `[${kind}] 味方の編成 7 部隊`, brief.units.join(','));
    check(brief.prov >= 2, `[${kind}] 仮の能力に「仮」の印`, `${brief.prov}`);
    check(brief.primary.includes('敵勢の本陣を崩す') && brief.secondary.length === 1, `[${kind}] 主目標と副目標を別の行に`);
    check(brief.text.includes('酒井忠次') && brief.text.includes('石川数正'), `[${kind}] 率いる武将の名前`);
    await layoutCheck(p, '説明', '.g-pr-sec');
    await scrollShots(p, `${kind}-2-briefing`);

    // 戻る → 一覧 → もう一度大平原 → 出陣
    await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="back"]');
    await waitSheet(page, 'practice-list');
    check((await pr(page)).screen === 'list', `[${kind}] 説明の「一覧へ戻る」で一覧へ`);
    await press(p, '[data-id="field:plains"]');
    await waitSheet(page, 'practice-briefing');
    const t0 = Date.now();
    await press(p, '.g-layer[data-sheet="practice-briefing"] [data-id="go"]');
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, POLL);
    const s3 = await page.evaluate(() => ({ screen: window.__practice.screen, map: window.__battle.state.map.id, units: window.__battle.state.units.length, rival: window.__battle.state.units.filter((u) => u.clan === 'rival').length, game: window.__game.screen }));
    log(`[${kind}] 出陣から合戦の画面まで ${Date.now() - t0} ms`);
    check(s3.screen === 'battle' && s3.map === 'plains' && s3.units === 14 && s3.rival === 7, `[${kind}] 合戦の画面（大平原・14 部隊・敵勢 7）`, JSON.stringify(s3));
    check(s3.game === 'practice', `[${kind}] 章の進行は演習中（__game.screen=practice）`);
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 60000, polling: 250 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${kind}-3-battle.png` });

    if (!p.phone) {
        // 合戦を始める（クリック）→ 全軍撤退と早送りで決着（開発用の直接操作）→ 結果の「続ける」（クリック）
        await press(p, '.b-primary');
        await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
        await page.evaluate(() => {
            window.__battle.allRetreat();
            window.__battle.fastForward(600);
        });
        await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
        await page.waitForTimeout(500);
        const decided = await page.evaluate(() => window.__battle.ui.decided);
        check(!!decided && decided.ok, `[${kind}] 合戦の結果の画面に「演習の記録を保存しました」`, JSON.stringify(decided));
        await page.screenshot({ path: `${OUT}/${kind}-4-battle-result.png` });
        await press(p, '.b-primary');
        await waitSheet(page, 'practice-result');
        await page.waitForTimeout(300);
        const res = await page.evaluate(() => ({
            screen: window.__practice.screen,
            outcome: document.querySelector('[data-outcome]')?.dataset.outcome,
            primary: document.querySelector('.g-pr-result [data-objective="primary"]')?.dataset.achieved,
            secondary: [...document.querySelectorAll('.g-pr-result [data-objective="secondary"]')].map((e) => e.dataset.achieved),
            saved: document.querySelector('.g-pr-result [data-saved]')?.dataset.saved,
            records: window.__practice.records,
            modeActive: document.body.className,
        }));
        check(res.screen === 'result' && res.outcome === 'retreat', `[${kind}] 演習の結果：撤退`, JSON.stringify({ screen: res.screen, outcome: res.outcome }));
        check(res.primary === 'false' && res.secondary.length === 1, `[${kind}] 主目標・副目標が別々の行`, JSON.stringify({ p: res.primary, s: res.secondary }));
        check(res.saved === 'true' && res.records?.status === 'ok' && res.records.data.records.plains?.plays === 1, `[${kind}] 記録が保存されている（plains 1 回）`);
        check(!res.modeActive.includes('mode-battle'), `[${kind}] 合戦の場面を出ている`);
        await page.screenshot({ path: `${OUT}/${kind}-5-result.png` });
        await press(p, '.g-layer[data-sheet="practice-result"] [data-id="list"]');
        await waitSheet(page, 'practice-list');
        const rec = await page.evaluate(() => document.querySelector('.g-pr-field[data-field="plains"] .rec')?.textContent ?? '');
        check(rec.includes('撤退'), `[${kind}] 一覧の大平原に最後の記録`, rec);
        const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku')));
        check(JSON.stringify(keys) === JSON.stringify(['koto-sengoku/3d-fields']), `[${kind}] 書いたキーは koto-sengoku/3d-fields だけ`, keys.join(','));
        await page.screenshot({ path: `${OUT}/${kind}-6-list-after.png` });
        // 一覧の「タイトルへ戻る」→ タイトル
        await press(p, '.g-layer[data-sheet="practice-list"] [data-id="back"]');
        await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
        const back = await page.evaluate(() => ({ screen: window.__practice.screen, game: window.__game.screen, state: window.__game.state }));
        check(back.screen === 'closed' && back.game === 'title' && back.state === null, `[${kind}] タイトルへ戻る（章の状態なし）`);
    }
    await p.ctx.close();
}

try {
    for (const k of PARTS) await run(k);
} catch (e) {
    failures.push(`例外: ${e instanceof Error ? e.stack : String(e)}`);
    log(e);
} finally {
    await b.close();
}
log(failures.length ? `NG ${failures.length} 件\n- ${failures.join('\n- ')}` : 'すべて ok');
process.exit(failures.length ? 1 : 0);
