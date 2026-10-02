/**
 * 第3群の確かめ（遊んで確かめた担当の指摘）の直しを、実際のブラウザで本物のクリック・タップ・キーで確かめて撮る。
 *   BASE3D=http://localhost:8307 BASE=http://localhost:8307 node e2e/review-group3.mjs [出力先]
 *   （開発サーバー：proto3d/blender/tools/vite.nohmr.mjs。既定の出力先 e2e-out/review-group3）
 *   PARTS=desktop,phone で一部だけ（既定はすべて）
 * - desktop（PC 1280×720、マウス・キー）：
 *   A. 城攻め前面：石川隊（槍）を札で選び、西の櫓の弓の体を押す → 断られて「道が無く」の理由が出る。石川隊の命令は変わらない。
 *      弓隊なら同じ押しで攻撃になる。
 *   B. 城攻め前面：忠勝隊を選び、閉じた門の向こうの門の裏の槍のすぐ脇（曲輪の中の地面）を押す → 門の裏の槍への攻撃にはならない
 *      （すぐ近くの押しは押した地点への移動、体そのものなら断って理由）。
 *   C. 大平原（状態を直接操作して場面を作る）：戦える敵の体のすぐ隣（2.6 m）に敗走中の敵を置き、忠勝隊を選んで戦える敵の体を押す
 *      → その敵への攻撃（前は敗走中の部隊が選ばれて地面への移動になった）。
 *   D. 大平原：忠勝隊を選んで「向き」（T）→ 案内の帯に「向き指定中」→ 東の地面を押す → その場で東へ向き直る（知らせ「東へ向き直る」、
 *      位置は変わらない。待ちは早送り）。
 *   E. 湿地：目標の欄は開いて始まる → 部隊を選ぶと畳む → 見出しを押して開き直す → 左上の列が下の札の列に重ならない・能力の欄の長い説明を省く。
 * - phone（スマホ横 844×390、タッチ）：
 *   F. 寺社周辺：畳んだ目標の見出しが「山門 …・本堂前 …・0／60 秒」の順（2 つ目の要所が「…」で切れない）。
 *   G. 大平原：「向き」のボタンを押して地面を押す → 向き直る。
 * 待つ時間だけは開発用の早送り（fastForward）。C の場面づくりだけ状態を直接書き換える（ログに「直接操作」と書く）。
 * コンテナはソフトウェア描画（実機・性能は未確認）。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8307';
const OUT = process.argv[2] || 'e2e-out/review-group3';
mkdirSync(OUT, { recursive: true });
const PARTS = (process.env.PARTS || 'desktop,phone').split(',');
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();

async function openPage(kind, id) {
    const phone = kind === 'phone';
    const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(240000);
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
    await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
    await page.waitForFunction(() => window.__battle && window.__battle.active && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
    const p = { ctx, page, phone, kind, id };
    await press(p, '.b-primary');
    await page.waitForTimeout(400);
    await press(p, '.b-pause');
    await page.waitForTimeout(500);
    return p;
}

const ui = (page) => page.evaluate(() => window.__battle.ui);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const unit = (page, id) => page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); return { x: u.x, z: u.z, facing: u.facing, order: u.order, status: u.status, seen: u.seenBy.ally }; }, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
const ff = (page, sec) => page.evaluate((s) => window.__battle.fastForward(s), sec);
const shot = (p, name) => p.page.screenshot({ path: `${OUT}/${p.kind}-${p.id}-${name}.png` });
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height }; }, sel);

async function press(p, sel) {
    if (p.phone) await p.page.tap(sel);
    else await p.page.click(sel);
    await p.page.waitForTimeout(400);
}
async function pointAt(p, x, y, wait = 700) {
    if (p.phone) await p.page.touchscreen.tap(x, y);
    else await p.page.mouse.click(x, y);
    await p.page.waitForTimeout(wait);
}
async function selectCard(p, id) {
    await press(p, `.b-card[data-id="${id}"]`);
    if ((await ui(p.page)).selectedId !== id) await press(p, `.b-card[data-id="${id}"]`);
}
/** 敵が見えるまで早送り（最大 sec 秒） */
async function untilSeen(page, id, sec) {
    for (let t = 0; t < sec; t += 5) {
        if ((await unit(page, id)).seen) return true;
        await ff(page, 5);
    }
    return (await unit(page, id)).seen;
}
/** 案内の帯の文（直前の知らせが消えるのを待たずに読む） */
async function flashAfter(page, fn) {
    await fn();
    return hintText(page);
}

async function desktop() {
    // ================================================================ A・B 城攻め前面
    {
        const p = await openPage('desktop', 'siege_front');
        const { page } = p;
        const seen = await untilSeen(page, 'e_tower_w', 120);
        check(seen, '[desktop] 城攻め前面：西の櫓の弓が見えている（早送りで待つ）');
        await page.evaluate(() => window.__battle.centerOn(-40, -40, 160));
        await page.waitForTimeout(600);
        // A. 槍で櫓の弓を押す → 断って理由
        await selectCard(p, 'a_ishikawa');
        const before = JSON.stringify((await unit(page, 'a_ishikawa')).order);
        let tw = await screenOf(page, 'e_tower_w');
        const t1 = await flashAfter(page, () => pointAt(p, tw.x, tw.y));
        const after = (await unit(page, 'a_ishikawa')).order;
        check(JSON.stringify(after) === before && t1.includes('道が無く'), '[desktop] 石川隊（槍）で西の櫓の弓の体を押す → 断られ、「道が無く、斬りかかれません」の理由が出る（命令は前のまま）', `帯「${t1}」・命令 ${JSON.stringify(after)}`);
        await shot(p, 'A-tower-refused');
        // 弓隊なら攻撃になる
        await selectCard(p, 'a_yumi');
        tw = await screenOf(page, 'e_tower_w');
        await pointAt(p, tw.x, tw.y);
        const yo = (await unit(page, 'a_yumi')).order;
        check(yo.type === 'attack' && yo.targetId === 'e_tower_w', '[desktop] 弓隊で同じ西の櫓の弓の体を押す → 攻撃になる', JSON.stringify(yo));

        // B. 閉じた門の向こうの門の裏の槍のすぐ脇の地面
        const gseen = await untilSeen(page, 'e_gate_guard', 30);
        const gg = await unit(page, 'e_gate_guard');
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z + 40, 150), [gg.x, gg.z]);
        await page.waitForTimeout(600);
        await selectCard(p, 'a_tadakatsu');
        // 「すぐ近く」（隊列の外の余白）に当たる点を探す：その点の部隊の当たり（10 px の近さ）には入らず、20 px の近さでは門の裏の槍に当たる
        // 寄った画面では隊列の広がりが 20 px より大きく「すぐ近く」が無いので、引いた画面で探す
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z + 40, 600), [gg.x, gg.z]);
        await page.waitForTimeout(800);
        const near = await page.evaluate(() => {
            const B = window.__battle;
            const c = B.screenOf('e_gate_guard');
            const r = document.querySelector('canvas').getBoundingClientRect();
            for (let d = 4; d < 120; d += 2)
                for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
                    const x = c.x + dx;
                    const y = c.y + dy;
                    if (B.view.pick(B.state, x - r.left, y - r.top, 10) === null && B.view.pick(B.state, x - r.left, y - r.top, 20) === 'e_gate_guard') return { x, y };
                }
            return null;
        });
        check(!!near, '[desktop] 門の裏の槍の「すぐ近く」に当たる点がある', JSON.stringify(near));
        if (near) {
            const t2 = await flashAfter(page, () => pointAt(p, near.x, near.y));
            const to = (await unit(page, 'a_tadakatsu')).order;
            check(to.type === 'move' && t2.includes('道が無いので、押した地点へ移動'), `[desktop] 忠勝隊で閉じた門の向こうの門の裏の槍（${gseen ? '見えている' : '見えていない'}）のすぐ近くを押す → 攻撃にならず、押した地点への移動（知らせ「道が無いので、押した地点へ移動」）`, `帯「${t2}」・命令 ${JSON.stringify(to)}`);
        }
        // 体そのものを押す → 断って理由
        await selectCard(p, 'a_sakai');
        const o0 = JSON.stringify((await unit(page, 'a_sakai')).order);
        const body = await screenOf(page, 'e_gate_guard');
        const t4 = await flashAfter(page, () => pointAt(p, body.x, body.y));
        check(JSON.stringify((await unit(page, 'a_sakai')).order) === o0 && t4.includes('道が無く'), '[desktop] 酒井隊で門の裏の槍の体そのものを押す → 断られ、理由が出る', `帯「${t4}」`);
        await shot(p, 'B-gate-guard');
        await p.ctx.close();
    }

    // ================================================================ C・D 大平原
    {
        const p = await openPage('desktop', 'plains');
        const { page } = p;
        // C. 直接操作：戦える敵 A の 2.6 m 隣に、敗走中の敵 B を置く
        const pick = await page.evaluate(() => {
            const s = window.__battle.state;
            const foes = s.units.filter((u) => u.side === 'enemy' && u.status === 'ready' && !u.isHq);
            const a = foes[0];
            const bb = foes[1];
            for (const u of s.units) if (u.side === 'enemy') u.seenBy.ally = true;
            bb.status = 'routed';
            bb.x = a.x;
            bb.z = a.z - 2.6;
            return { a: a.id, b: bb.id, x: a.x, z: a.z };
        });
        log(`  （直接操作）${pick.b} を敗走にして ${pick.a} の 2.6 m 隣へ置いた`);
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z + 30, 140), [pick.x, pick.z]);
        await page.waitForTimeout(1500);
        await selectCard(p, 'a_tadakatsu');
        const sa = await screenOf(page, pick.a);
        const sb = await screenOf(page, pick.b);
        log(`  画面：戦える ${pick.a} (${sa.x.toFixed(0)},${sa.y.toFixed(0)})・敗走 ${pick.b} (${sb.x.toFixed(0)},${sb.y.toFixed(0)})`);
        await pointAt(p, sa.x, sa.y);
        const co = (await unit(page, 'a_tadakatsu')).order;
        check(co.type === 'attack' && co.targetId === pick.a, '[desktop] 敗走中の敵が隣に重なっていても、戦える敵の体を押すとその敵への攻撃（直接操作で場面を作った）', JSON.stringify(co));
        await shot(p, 'C-pick-active');

        // D. 向き（T）
        await selectCard(p, 'a_tadakatsu');
        await page.keyboard.press('KeyT');
        await page.waitForTimeout(300);
        await page.waitForFunction(() => (document.querySelector('.b-hint')?.textContent ?? '').includes('向き指定中'), null, { timeout: 5000 }).catch(() => {});
        const h = await hintText(page);
        check((await ui(page)).pending === 'face' && h.includes('向き指定中'), '[desktop] 「向き」（T）→ 案内の帯に「向き指定中」', h);
        const u0 = await unit(page, 'a_tadakatsu');
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z, 160), [u0.x, u0.z]);
        await page.waitForTimeout(500);
        const east = await page.evaluate(([x, z]) => window.__battle.screenOfGround(x + 50, z), [u0.x, u0.z]);
        const t3 = await flashAfter(page, () => pointAt(p, east.x, east.y));
        const fo = (await unit(page, 'a_tadakatsu')).order;
        check(fo.type === 'move' && Math.abs(fo.face - Math.PI / 2) < 0.2 && Math.hypot(fo.x - u0.x, fo.z - u0.z) < 1 && t3.includes('東へ向き直る') && (await ui(page)).pending === 'none', '[desktop] 東の地面を押す → その場で東へ向き直る命令（知らせ「東へ向き直る」）', `帯「${t3}」・命令 ${JSON.stringify(fo)}`);
        await ff(page, 6);
        const u1 = await unit(page, 'a_tadakatsu');
        check(Math.abs(u1.facing - fo.face) < 0.05 && Math.hypot(u1.x - u0.x, u1.z - u0.z) < 2 && u1.order.type === 'hold', '[desktop] 6 秒後（早送り）：向きが変わり、位置はほぼそのまま、待機', `向き ${u1.facing.toFixed(2)}（前 ${u0.facing.toFixed(2)}）・動いた ${Math.hypot(u1.x - u0.x, u1.z - u0.z).toFixed(1)} m`);
        await shot(p, 'D-face');
        await p.ctx.close();
    }

    // ================================================================ E 湿地：PC の左上の列
    {
        const p = await openPage('desktop', 'marsh');
        const { page } = p;
        const closed0 = await page.evaluate(() => document.querySelector('.b-goals').classList.contains('closed'));
        check(!closed0, '[desktop] 湿地：目標の欄は開いて始まる');
        await shot(p, 'E0-start');
        await selectCard(p, 'a_ieyasu');
        await page.waitForTimeout(400);
        const closed1 = await page.evaluate(() => document.querySelector('.b-goals').classList.contains('closed'));
        check(closed1, '[desktop] 部隊を選ぶと目標の欄を畳む（能力の欄と 2 つで地図の左を覆わない）');
        await shot(p, 'E1-selected');
        await press(p, '.b-goals-head');
        await page.waitForTimeout(400);
        const tl = await rect(page, '.b-topleft');
        const cards = await rect(page, '.b-cards');
        const longShown = await page.evaluate(() => { const e = document.querySelector('.b-abil .b-ab-long'); return !!e && getComputedStyle(e).display !== 'none'; });
        const open2 = await page.evaluate(() => !document.querySelector('.b-goals').classList.contains('closed') && !document.querySelector('.b-abil').hidden);
        check(open2 && tl.b <= cards.t + 1 && !longShown, '[desktop] 目標の欄を開き直しても、左上の列は札の列に重ならず、能力の欄の長い説明を省く', `左上の下 ${tl.b.toFixed(0)}・札の上 ${cards.t.toFixed(0)}・両方開いている ${open2}`);
        await shot(p, 'E2-reopened');
        await p.ctx.close();
    }
}

async function phone() {
    // ================================================================ F 寺社周辺：畳んだ見出し
    {
        const p = await openPage('phone', 'temple');
        const { page } = p;
        const g = await page.evaluate(() => {
            const e = document.querySelector('.b-goals');
            const sum = e.querySelector('.b-goals-sum');
            return { closed: e.classList.contains('closed'), text: sum.textContent, cut: sum.scrollWidth > sum.clientWidth + 1 };
        });
        check(g.closed && /^山門 .・本堂前 .・\d+／60 秒$/.test(g.text), '[phone] 寺社周辺：畳んだ見出しは要所ごとの様子が先（「山門 …・本堂前 …・n／60 秒」）', `「${g.text}」${g.cut ? '（末尾が切れている）' : ''}`);
        await shot(p, 'F-header');
        await p.ctx.close();
    }
    // ================================================================ G 大平原：「向き」のボタン
    {
        const p = await openPage('phone', 'plains');
        const { page } = p;
        await selectCard(p, 'a_sakai');
        await press(p, '.b-cmd:has-text("向き")');
        check((await ui(page)).pending === 'face', '[phone] 「向き」のボタン → 向き指定中');
        const u0 = await unit(page, 'a_sakai');
        await page.evaluate(([x, z]) => window.__battle.centerOn(x, z, 160), [u0.x, u0.z]);
        await page.waitForTimeout(500);
        const west = await page.evaluate(([x, z]) => window.__battle.screenOfGround(x - 50, z), [u0.x, u0.z]);
        const t = await flashAfter(page, () => pointAt(p, west.x, west.y));
        const o = (await unit(page, 'a_sakai')).order;
        const wd = Math.abs(((o.face - (3 * Math.PI) / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        check(o.type === 'move' && wd < 0.2 && t.includes('西へ向き直る'), '[phone] 西の地面を押す → その場で西へ向き直る命令', `帯「${t}」・命令 ${JSON.stringify(o)}`);
        const btn = await page.locator('.b-cmd', { hasText: '向き' }).boundingBox();
        const cmds = await rect(page, '.b-cmds');
        check(!!btn && cmds.b <= 390, '[phone] 命令のボタンの列は画面に収まる（「向き」を足しても）', `ボタンの列 ${cmds.t.toFixed(0)}〜${cmds.b.toFixed(0)}`);
        await shot(p, 'G-face');
        await p.ctx.close();
    }
}

try {
    if (PARTS.includes('desktop')) await desktop();
    if (PARTS.includes('phone')) await phone();
} catch (e) {
    failures.push(`例外：${e.message}`);
    log(e);
} finally {
    await b.close();
}
log(failures.length ? `NG ${failures.length}：\n- ${failures.join('\n- ')}` : 'すべて ok');
process.exit(failures.length ? 1 : 0);
