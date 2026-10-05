/**
 * 第二章の合戦の画面（開発用の入口）：?dev=battle&scenario=ieyasu2&policy=…&plan=…&tier=… で合戦を始め、画面の言葉と台本の早送りを確かめる。
 *   BASE=http://localhost:8173 node e2e/ieyasu-ch2-battle-dev.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs）
 * - 合戦の前の説明の見出し：合戦「<物語の地図の名前>」（第一章の直後の、分岐した世界での出来事（創作））。1 行目に「特定の史実の合戦の再現ではない」。
 * - 画面の上の札「第二章（創作）」・地図の「援軍の出る所（開始 …）」の名札。
 * - 「始める」を押し、待ち時間は開発用の早送り（window.__battle.fastForward）に、第二章の作戦の台本（window.__ch2Scripts.ch2TacticScript）を渡す
 *   （台本は issueOrder で命令を出す＝早送り。画面のクリックではない）。
 * - 結果の画面：第二章の添え書き。「約束：引き受けていない」の行が出ない。
 * - 開発用の入口は、キャンペーンの状態を通さずに合戦の設定を作る（報告では「直接状態変更」と書く）。
 * 本物の入力（クリック）は「始める」「結果を閉じる」だけ。性能・実機の見た目はここでは確かめない（ソフトウェア描画）。
 */
import { launchBrowser, BASE } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'e2e-out/ieyasu-ch2/battle-dev';
mkdirSync(OUT, { recursive: true });
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}
const NAMES = { oda: '織田勢の退き口', asai: '浅井勢の孤立した丘', home: '領内の村' };
/** RUNS=oda:commit:typical:rear_hold,… で一部だけ */
const RUNS = (process.env.RUNS || 'oda:commit:typical:rear_hold,asai:hold:typical:west,home:commit:weak:trap_hq')
    .split(',')
    .map((r) => {
        const [policy, plan, tier, tactic] = r.split(':');
        return { policy, plan, tier, tactic };
    });

const b = await launchBrowser();
for (const r of RUNS) {
    const tag = `${r.policy}:${r.plan}:${r.tier}`;
    log(`[${tag}] 台本 ${r.tactic}`);
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error') failures.push(`console error: ${m.text()}`);
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?dev=battle&scenario=ieyasu2&policy=${r.policy}&plan=${r.plan}&tier=${r.tier}&q=low`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && window.__battle.ui.modal === 'briefing', null, { timeout: 300000, polling: 500 });
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 30000, polling: 250 });
    log(`    合戦の画面まで ${Date.now() - t0} ms`);
    const brief = await page.evaluate(() => ({
        h2: document.querySelector('.b-modal h2')?.textContent ?? '',
        first: document.querySelector('.b-brief-lines p')?.textContent ?? '',
        all: document.querySelector('.b-brief-lines')?.textContent ?? '',
        tag: document.querySelector('.b-tag')?.textContent ?? '',
        field: document.querySelector('.b-root')?.getAttribute('data-field') ?? '',
    }));
    check(brief.h2 === `合戦「${NAMES[r.policy]}」（第一章の直後の、分岐した世界での出来事（創作））`, `${tag} 説明の見出し`, brief.h2);
    check(brief.first.includes('特定の史実の合戦の再現ではない'), `${tag} 説明の 1 行目`, brief.first.slice(0, 60));
    check(!brief.all.includes('約束：') && !brief.all.includes('1570年の情勢を背景にした架空の局地戦'), `${tag} 説明に第一章の約束・題の言葉が出ない`);
    check(brief.tag === '第二章（創作）', `${tag} 上の札`, brief.tag);
    check(brief.field.startsWith('ieyasu2_'), `${tag} 戦場の id（data-field）`, brief.field);
    await page.screenshot({ path: `${OUT}/${r.policy}-${r.plan}-${r.tier}-briefing.png` });
    // 本物の入力：「始める」を押す
    await page.click('.b-primary');
    await page.waitForFunction(() => window.__battle.ui.modal === null || window.__battle.ui.modal === undefined || window.__battle.ui.started, null, { timeout: 30000, polling: 250 });
    await page.waitForTimeout(600);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.b-maplabel, .b-label')].map((l) => l.textContent));
    check(labels.some((t) => t.startsWith('援軍の出る所（開始')), `${tag} 地図の「援軍の出る所」の名札`, labels.filter((t) => t.startsWith('援軍')).join('｜'));
    // 早送り（台本を渡す）
    const res = await page.evaluate(
        ({ policy, tactic }) => {
            const sc = window.__ch2Scripts.ch2TacticScript(policy, tactic, window.__battle.state.setup);
            let out = null;
            for (let i = 0; i < 80 && !window.__battle.state.result; i++) out = window.__battle.fastForward(10, sc);
            const o = window.__battle.state.result;
            return { t: window.__battle.state.t, result: o?.result, reason: o?.reason, refused: sc.log.refused, cmds: sc.log.cmds.length, out };
        },
        { policy: r.policy, tactic: r.tactic },
    );
    log(`    早送りの結果 ${res.result}/${res.reason} ${res.t.toFixed(1)} 秒・命令 ${res.cmds}・断られた ${res.refused.length}`);
    check(!!res.result, `${tag} 合戦が終わった`);
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 60000, polling: 250 });
    const txt = await page.evaluate(() => document.querySelector('.b-result')?.textContent ?? '');
    check(!txt.includes('約束：引き受けていない') && !txt.includes('約束違反ではない'), `${tag} 結果の画面に約束の行が出ない`);
    const note = { victory: '第二章の任務を果たした', defeat: '家康は生きている', retreat: '勝敗は決まらなかった' }[res.result];
    check(txt.includes(note), `${tag} 結果の画面の添え書き（第二章）`, txt.slice(0, 80));
    check(!txt.includes('若殿') && !txt.includes('鷲尾') && !txt.includes('この局地戦には勝った'), `${tag} 結果の画面に第一章・架空の章の添え書きが出ない`);
    await page.screenshot({ path: `${OUT}/${r.policy}-${r.plan}-${r.tier}-result.png` });
    await ctx.close();
}
await b.close();
log(failures.length ? `NG ${failures.length}: ${failures.join(' / ')}` : 'OK');
process.exit(failures.length ? 1 : 0);
