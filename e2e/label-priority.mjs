/**
 * 部隊の名札の優先表示（docs/fields-group2-design.md §2・依頼本文【先に直すこと】2）を、実際のブラウザで本物のクリック・タップで確かめて撮る。
 *   BASE3D=http://localhost:8201 node e2e/label-priority.mjs [出力先]   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/label-priority）
 *   KINDS=desktop,phone・FIELDS=plains,mountain_pass で絞る（既定はどれも）。
 *
 * ?dev=field&id=<戦場>&render=manual（演習と同じ buildBattleSetup(戦場, 'standard')）を PC（1280×720・マウス・キー）とスマホ横（844×390・タッチ）で開く。
 * 「出陣」→「指揮」で止める → 交戦が始まるまで早送り（開発用の fastForward。待ち時間だけ）→「全体」で引いた画面。すべて止めたまま：
 * 1. 密集の様子：名札の見せ方（そのまま・小さく・隠す）の数を記録する。
 * 2. 点滅している名札は、どれもそのまま見え（小さく・隠すにならない）、能力の印がほかの名札に覆われず、印の真ん中の当たりがその武将の印。
 * 3. 何も選んでいない所から、点滅している武将の名札の名前の所を押す → 確かめ（「もう一度で◆」）→ もう一度で使う。漏れない。
 * 4. 札で弓隊・騎馬隊など武将のいない部隊を選ぶ（隠れ・小さくなっていればそれを）→ その名札はそのまま見え、ほかの名札に覆われない。
 * 5. 選んだまま、点滅している別の武将の印を押す → その能力を使う。選択・全部隊の位置と命令は変わらない（漏れない）。
 * 6. 石川の印 → 対象選び：選べる対象の名札は、どれもそのまま見える（隠れない）。石川の名札をもう一度でやめる（回数は減らない）。
 * 7. 隠した名札は押しても当たらない（labelOf が null・名札の当たりにならない）。ページの誤りなし。
 * 確認の種類：本物の入力（クリック／タップ・キー）。交戦までの待ちだけ早送り。実機・性能は未確認（コンテナはソフトウェア描画）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8201';
const OUT = process.argv[2] || 'e2e-out/label-priority';
mkdirSync(OUT, { recursive: true });
const KINDS = (process.env.KINDS || 'desktop,phone').split(',');
const FIELDS = (process.env.FIELDS || 'plains,mountain_pass').split(',');
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
const ui = (page) => page.evaluate(() => window.__battle.ui);
const label = (page, id) => page.evaluate((id) => window.__battle.labelOf(id), id);
const labelText = (page, id) => page.evaluate((id) => document.querySelector(`.b-label[data-id="${id}"]`)?.textContent ?? '', id);
const fits = (page) => page.evaluate(() => window.__battle.labelFits());
const used = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__battle.state.abilities).map(([k, r]) => [k, r.usedAt])));
const covers = (page) => page.evaluate(() => window.__battle.labelCovers());
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const hitAt = (page, x, y) => page.evaluate(([x, y]) => window.__battle.labelHitAt(x, y), [x, y]);
const snapshot = (page) => page.evaluate(() => window.__battle.state.units.map((u) => `${u.id}:${u.x.toFixed(2)},${u.z.toFixed(2)}:${JSON.stringify(u.order)}`).join('|'));
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${p.field}-${name}.png` });
const inBox = (b, x, y) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;
const overlap = (a, c) => a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;

async function openPage(kind, field) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(900000);
    page.on('pageerror', (e) => {
        log('pageerror', e.message);
        failures.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
        if (m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text())) {
            log('console error', m.text());
            failures.push(`console error: ${m.text()}`);
        }
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?dev=field&id=${field}&render=manual`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    log(`[${kind}] ${field}：合戦の画面まで ${Date.now() - t0} ms`);
    const p = { ctx, page, phone, kind, field };
    await press(p, '.b-primary', 500);
    await press(p, '.b-pause', 500);
    return p;
}

/** 点滅している名札それぞれ：見せ方・印が覆われていないか・印の真ん中の当たり */
async function readyState(page) {
    return page.evaluate(() => {
        const cs = window.__battle.labelCovers();
        const fs = window.__battle.labelFits();
        const out = [];
        for (const f of fs) {
            if (f.ab !== 'ready') continue;
            const lb = window.__battle.labelOf(f.id);
            const g = lb?.badge ?? null;
            const coveredBy = g ? cs.filter((o) => o.id !== f.id && o.l < g.r - 0.5 && o.r > g.l + 0.5 && o.t < g.b - 0.5 && o.b > g.t + 0.5).map((o) => o.id) : [];
            const hit = g ? window.__battle.labelHitAt(g.x, g.y) : null;
            out.push({ id: f.id, fit: f.fit, badge: g, coveredBy, hit });
        }
        return out;
    });
}

async function run(kind, field) {
    const p = await openPage(kind, field);
    const { page } = p;
    // 交戦が始まるまで早送り（待ち時間だけ。1 秒ずつ、斬り合う部隊が 4 つ以上になるまで。最長 150 秒）
    const ff = await page.evaluate(() => {
        const s = window.__battle.state;
        const eng = () => s.units.filter((u) => u.present && u.status === 'ready' && u.engagedWith).length;
        for (let i = 0; i < 150 && eng() < 4 && !s.result; i++) window.__battle.fastForward(1);
        return { t: s.t, engaged: eng() };
    });
    await press(p, '.b-zall', 1200);
    const f0 = await fits(page);
    const shown = f0.filter((f) => f.shown);
    const count = (k) => shown.filter((f) => f.fit === k).length;
    const stat = { t: Math.round(ff.t * 10) / 10, engaged: ff.engaged, shown: shown.length, full: count('full'), mini: count('mini'), hide: count('hide'), miniIds: shown.filter((f) => f.fit === 'mini').map((f) => f.id), hideIds: shown.filter((f) => f.fit === 'hide').map((f) => f.id) };
    record[`${kind}-${field}`] = { overview: stat };
    log(`    [${kind}] ${field}：${stat.t} 秒・斬り合う部隊 ${stat.engaged}・名札 ${stat.shown}（そのまま ${stat.full}・小さく ${stat.mini} ${stat.miniIds.join(',')}・隠す ${stat.hide} ${stat.hideIds.join(',')}）`);
    await shot(p, '1-overview');
    check(ff.engaged >= 2, `[${kind}] ${field}：交戦中（斬り合う部隊 ${ff.engaged}）`);

    // ---- 2. 点滅している名札 ----
    let rs = await readyState(page);
    check(rs.length >= 3, `[${kind}] ${field}：点滅している名札がある（${rs.map((r) => r.id).join(',')}）`);
    for (const r of rs) {
        check(r.fit === 'full' && !!r.badge && r.coveredBy.length === 0 && r.hit?.id === r.id && r.hit?.part === 'badge', `[${kind}] ${field}：点滅している${r.id}の名札はそのまま見え、印が覆われず、印の真ん中で当たる`, `${r.fit}・覆う ${r.coveredBy.join(',') || 'なし'}・当たり ${JSON.stringify(r.hit)}`);
    }
    // 隠した名札は押せない
    const hidden = stat.hideIds;
    if (hidden.length) {
        const hl = await page.evaluate((ids) => ids.map((id) => window.__battle.labelOf(id)), hidden);
        check(hl.every((x) => x === null), `[${kind}] ${field}：一時的に隠した名札（${hidden.join(',')}）は当たりにならない（labelOf が null）`);
    }

    const W = p.phone ? 844 : 1280;
    const H = p.phone ? 390 : 720;
    const byCenter = (list) => list.filter((r) => r.id !== 'a_ishikawa' && r.badge).sort((a, c) => Math.hypot(a.badge.x - W / 2, a.badge.y - H / 2) - Math.hypot(c.badge.x - W / 2, c.badge.y - H / 2));

    // ---- 3. 何も選んでいない所から、点滅している武将の名札の名前の所で確かめ → もう一度で使う（画面の中央に近い武将） ----
    let u = await ui(page);
    const g2 = byCenter(rs)[0];
    if (g2 && u.selectedId === null) {
        const c3 = await covers(page);
        const lb = await label(page, g2.id);
        const me = c3.find((k) => k.id === g2.id);
        let np = null;
        for (let x = lb.l + 4; x < (lb.badge?.l ?? lb.r) - 2 && !np; x += 2) if (!c3.some((o) => o.id !== g2.id && o.z > me.z && inBox(o, x, lb.y))) np = { x, y: lb.y };
        check(!!np, `[${kind}] ${field}：${g2.id}の名札の名前の所が見えている`);
        // 確かめ（もう一度押すと使う）は実時間 3 秒（control.ts の ABILITY_ARM。重い端末で確かめが延びて能力を誤って使わないよう、実時間のまま）。
        // 負荷の高い時は 1 回目の後の読み取りだけで 3 秒を過ぎることがある（2 回目が確かめの外になり、選んだ部隊の名前の所＝地面の移動になる）。
        // そのときは 2 回目を押さずに、確かめが切れるのを待って選択を外し（PC は Esc、スマホは部隊の体）、最初からやり直す（3 回まで）
        let s1 = null;
        let before = null;
        for (let attempt = 1; np && attempt <= 3; attempt++) {
            before = await snapshot(page);
            const t1 = await page.evaluate(() => performance.now());
            await pointAt(p, np.x, np.y, 0);
            const r1 = await (
                await page.waitForFunction(
                    ([id, t1]) => {
                        const l = document.querySelector(`.b-label[data-id="${id}"]`);
                        if (!(l?.textContent ?? '').includes('もう一度')) return null;
                        return { text: l.textContent, sel: window.__battle.ui.selectedId, used: window.__battle.state.abilities[id].usedAt, fit: window.__battle.labelFits().find((f) => f.id === id)?.fit, age: (performance.now() - t1) / 1000 };
                    },
                    [g2.id, t1],
                    { timeout: 10000, polling: 50 },
                )
            ).jsonValue();
            if (r1.age <= 2.2) {
                s1 = r1;
                break;
            }
            log(`    [${kind}] ${field}：1 回目から確かめを読めるまで ${r1.age.toFixed(1)} 秒（負荷）。2 回目を押さずにやり直す（${attempt} 回目）`);
            await page.waitForTimeout(Math.max(0, (3.4 - r1.age) * 1000));
            if (p.phone) {
                // 部隊の体の、名札に覆われていない所（名札の印を押すと能力を使ってしまう）
                let bq = await screenOf(page, g2.id);
                const cs = await covers(page);
                for (let dy = 0; dy <= 24 && cs.some((c) => inBox(c, bq.x, bq.y)); dy += 3) bq = { ...bq, y: bq.y + 3 };
                await pointAt(p, bq.x, bq.y, 700);
            } else {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            }
            const u3 = await ui(page);
            if (u3.selectedId !== null) {
                log(`    [${kind}] ${field}：選択が外れない（${u3.selectedId}）。やり直しをやめる`);
                break;
            }
        }
        check(!np || !!s1, `[${kind}] ${field}：${g2.id}の名札の名前を押して、確かめの 3 秒のうちに 2 回目を押せる（3 回まで）`);
        if (np && s1) {
            await pointAt(p, np.x, np.y, 800);
            check(s1.sel === g2.id && s1.used === null && s1.fit === 'full', `[${kind}] ${field}：${g2.id}の名札の名前を押す → 選んで確かめ（まだ使わない・名札はそのまま）`, s1.text);
            check((await used(page))[g2.id] !== null, `[${kind}] ${field}：もう一度押す → ${g2.id}の能力を使う`);
            check(before === (await snapshot(page)), `[${kind}] ${field}：名札の 2 回の押しは、位置・命令に漏れない`);
            await shot(p, '2-name-fire');
        }
    } else log(`    [${kind}] ${field}：名前の確かめに使える点滅している武将がいない（省く）`);

    // ---- 4. 札で武将のいない部隊を選ぶ（小さく・隠れている名札があれば、それを） ----
    const plain = f0.filter((f) => f.id.startsWith('a_') && !GENERALS.includes(f.id) && f.shown);
    const pick = plain.find((f) => f.fit !== 'full') ?? plain[0];
    check(!!pick, `[${kind}] ${field}：選ぶ部隊（武将のいない味方）がいる`, pick ? `${pick.id}（${pick.fit}）` : '');
    if (!pick) {
        await p.ctx.close();
        return;
    }
    const fitBefore = (await fits(page)).find((f) => f.id === pick.id)?.fit;
    await press(p, `.b-card[data-id="${pick.id}"]`, 700);
    u = await ui(page);
    const fsel = (await fits(page)).find((f) => f.id === pick.id);
    const lsel = await label(page, pick.id);
    const cs = await covers(page);
    const coverSel = lsel ? cs.filter((o) => o.id !== pick.id && overlap(o, lsel)).map((o) => o.id) : ['(見えない)'];
    check(u.selectedId === pick.id && fsel?.sel && fsel.fit === 'full' && !!lsel && coverSel.length === 0, `[${kind}] ${field}：札で${pick.id}を選ぶ → 名札はそのまま見え（選ぶ前は ${fitBefore}）、ほかの名札に覆われない`, `見せ方 ${fsel?.fit}・覆う ${coverSel.join(',') || 'なし'}`);
    rs = await readyState(page);
    check(rs.every((r) => r.fit === 'full' && r.coveredBy.length === 0 && r.hit?.id === r.id), `[${kind}] ${field}：選んだ後も、点滅している名札の印はどれも覆われず押せる`, rs.filter((r) => r.coveredBy.length || r.hit?.id !== r.id).map((r) => `${r.id}<${r.coveredBy.join('+')}`).join(' '));
    await shot(p, '3-selected');

    // ---- 5. 選んだまま、点滅している別の武将の印を押す（対象の要らない能力） ----
    const g1 = byCenter(rs)[0];
    if (g1) {
        const before = await snapshot(page);
        await pointAt(p, g1.badge.x, g1.badge.y, 900);
        u = await ui(page);
        const uu = await used(page);
        check(uu[g1.id] !== null, `[${kind}] ${field}：${pick.id}を選んだまま${g1.id}の印を押す → 能力を使う`);
        check(u.selectedId === pick.id && before === (await snapshot(page)), `[${kind}] ${field}：その押しは、選択・全部隊の位置と命令に漏れない`, `選択 ${u.selectedId}`);
        await shot(p, '4-badge-fire');
    } else log(`    [${kind}] ${field}：印を押す別の点滅している武将がいない（省く）`);

    // ---- 6. 石川の対象選び：選べる対象の名札は隠れない ----
    rs = await readyState(page);
    const ishi = rs.find((r) => r.id === 'a_ishikawa' && r.badge);
    if (ishi) {
        // 選んでいる部隊があれば、その名札の印を押す前に外す必要はない（印は 1 回で働く）
        await pointAt(p, ishi.badge.x, ishi.badge.y, 1200);
        u = await ui(page);
        const f6 = await fits(page);
        const tg = f6.filter((f) => f.ab === 'target' || f.ab === 'choosing');
        const bad = tg.filter((f) => f.shown && f.fit !== 'full');
        check(u.pending === 'ability' && u.selectedId === 'a_ishikawa' && tg.length >= 2 && bad.length === 0, `[${kind}] ${field}：石川の印 → 対象選び。持ち主・選べる対象の名札（${tg.map((f) => f.id).join(',')}）はどれもそのまま見える`, bad.map((f) => `${f.id}:${f.fit}`).join(' '));
        await shot(p, '5-ishikawa-choose');
        const li = await label(page, 'a_ishikawa');
        await page.waitForTimeout(300);
        await pointAt(p, li.x, li.y, 800);
        u = await ui(page);
        check(u.pending === 'none' && (await used(page)).a_ishikawa === null, `[${kind}] ${field}：石川の名札をもう一度 → 対象選びをやめる（回数は減らない）`, `pending ${u.pending}`);
    } else log(`    [${kind}] ${field}：石川の印が点滅していない（対象選びは省く）`);

    const f9 = await fits(page);
    const shown9 = f9.filter((f) => f.shown);
    record[`${kind}-${field}`].end = { full: shown9.filter((f) => f.fit === 'full').length, mini: shown9.filter((f) => f.fit === 'mini').length, hide: shown9.filter((f) => f.fit === 'hide').length };
    await p.ctx.close();
}

for (const kind of KINDS) for (const field of FIELDS) await run(kind, field);
await b.close();
writeFileSync(`${OUT}/record.json`, JSON.stringify(record, null, 1));
log(failures.length ? `\nNG ${failures.length} 件:\n- ${failures.join('\n- ')}` : '\nすべて ok');
process.exit(failures.length ? 1 : 0);
