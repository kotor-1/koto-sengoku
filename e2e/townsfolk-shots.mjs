/**
 * 町の人々の動きの画（Version 28 §4.2 の確かめ）。開発の画面（?q=low&render=manual）で「はじめから（家康）」→ 冒頭をスキップ → 城下で、
 * 自動の更新を止めて（__p3.manual）、町の人々（荷運び 2・店の人 2・負傷兵 12）を置き、決めた時刻まで __p3.step(1/60) で進め、
 * 決めたカメラで 1 コマだけ描いて撮る（手動の描画。実時間ではない。1 枚ずつ止めた画）。
 *   BASE3D=http://localhost:8781 node e2e/townsfolk-shots.mjs <出力フォルダ> [ラベル]
 * 撮る場面：荷運びの歩き（俵を担ぐ）・荷を担ぐ前かがみ・店の人（品物を整える／通りを見る／主人公へ会釈）・休み場の負傷兵（地べた・床几）。
 * 時刻は、ページの中で町の人々の置き方（explore/ambient.ts の walkerAt）を調べて決める（前の版でも同じ口で動く）。
 * 直接状態変更：町の人々の指定（world.setAmbient）・探索の時計（ambientTime）・主人公の位置（会釈の場面で、通りを歩かせる代わりに少しずつ動かす）。
 */
import { writeFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const BASE3D = process.env.BASE3D || 'http://localhost:8781';
const out = outDir(process.argv[2]);
const label = process.argv[3] || 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const note = (t) => console.log(`   ${t}  [${((Date.now() - T0) / 1000).toFixed(0)}s]`);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 560, height: 560 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE3D}/?q=low&render=manual`);
await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, { timeout: 900000, polling: 250 });
note('タイトル');
await page.locator('.g-btn[data-id="new:ieyasu1570"]').click();
const sel = '.g-layer[data-kind="cine"]';
await page.locator(sel).waitFor({ state: 'attached' });
await sleep(1500);
await page.locator(`${sel} .g-cine-btn[data-id="skip"]`).click();
await page.locator(sel).waitFor({ state: 'detached' });
await page.waitForFunction(() => window.__game.screen === 'explore', null, { polling: 100 });
note('城下');
await sleep(500);
await page.evaluate(() => {
    window.__p3.manual();
    for (const s of ['#hud', '#help', '#stick-zone', '#run-btn', '#hero-btn', '#build', '#fps', '.g-hud', '.npc-label', '.npc-guide']) {
        for (const el of document.querySelectorAll(s)) el.style.visibility = 'hidden';
    }
    const w = window.__game.world;
    // 町の人々の層は、毎コマのカメラ（主人公を追うカメラ）の画の外の人を動かさない。撮るカメラは別に置くので、ここでは外を判定しない
    w.ambientActors.frustum.intersectsSphere = () => true;
    w.ambientActors.troops.frustum.intersectsSphere = () => true;
    w.setAmbient({
        groups: [
            { kind: 'porter', count: 2, place: 'street' },
            { kind: 'merchant', count: 2, place: 'street' },
            { kind: 'wounded', count: 12, place: 'guardpost' },
        ],
    });
});

/** 主人公を遠く（画に入らない所）へ */
const heroAway = () =>
    page.evaluate(() => {
        Object.assign(window.__p3.hero, { x: 0.5, z: -20, heading: 0, speed: 0 });
        window.__p3.resetLegs?.();
    });
/** 探索の時計を t の 1.5 秒前にして、1/60 秒ずつ t まで進める（足・首が続きの動きになる）。each は毎コマ前に呼ぶ（ページの中の関数の本体） */
const runTo = (t, each = null) =>
    page.evaluate(
        ({ t, each }) => {
            const w = window.__game.world;
            const f = each ? new Function('i', 'w', each) : null;
            w.ambientTime = t - 1.5;
            for (let i = 0; i < 90; i++) {
                f?.(i, w);
                window.__p3.step(1 / 60, 0, 0);
            }
            return w.ambientTime;
        },
        { t, each },
    );
/** 決めたカメラ（位置 p・見る点 q）で 1 コマ描いて撮る */
async function shot(name, p, q) {
    await page.evaluate(
        ({ p, q }) => {
            const c = window.__p3.camera;
            c.position.set(p[0], p[1], p[2]);
            c.lookAt(q[0], q[1], q[2]);
            c.updateMatrixWorld();
            window.__p3.renderNow();
        },
        { p, q },
    );
    const file = `${out}/${label}-${name}.png`;
    await page.locator('#view canvas').screenshot({ path: file });
    note(file);
}
/** 町の人の位置・向き（ページの中の walkerAt） */
const findT = (key, test, from = 0, to = 60) =>
    page.evaluate(
        async ({ key, test, from, to }) => {
            const { walkerAt } = await import('/src/explore/ambient.ts');
            const w = window.__game.world.plan.walkers.find((x) => x.key === key);
            const f = new Function('p', 'w', `return (${test});`);
            for (let t = from; t < to; t += 1 / 60) {
                const p = walkerAt(w, t);
                if (f(p, w)) return { t, p };
            }
            return null;
        },
        { key, test, from, to },
    );
const near = (p, d, h, side = 1) => {
    // 人の前の斜め（右 side）d m・高さ h から
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    return [p.x + (fx - side * fz * 0.9) * d, h, p.z + (fz + side * fx * 0.9) * d];
};

const log = {};
await heroAway();
// 荷運び：通りへ出る道の真ん中を、俵を担いで歩く
{
    const r = await findT('porter0', 'p.moving > 0.99 && p.carrying && p.walked > 2.5');
    log.porterWalk = r;
    await runTo(r.t);
    await shot('porter-walk', near(r.p, 2.6, 1.5, 1), [r.p.x, 1.1, r.p.z]);
    await shot('porter-walk-side', [r.p.x - Math.cos(r.p.heading) * 2.8, 1.2, r.p.z + Math.sin(r.p.heading) * 2.8], [r.p.x, 0.95, r.p.z]);
}
// 荷運び：始めの端で荷を担ぐ（止まって前かがみ）
{
    const r = await findT('porter1', '!p.moving && p.walked === 0 && p.carrying && (!p.act || p.act.lean > 1.2)', 1);
    log.porterStoop = r;
    await runTo(r.t);
    await shot('porter-stoop', near(r.p, 2.6, 1.5, -1), [r.p.x, 1.0, r.p.z]);
}
// 店の人：品物を整える（店の方へ向き直って前かがみ）。前の版は同じ時刻のお辞儀
{
    const r = await findT('merchant0', 'p.act ? p.act.lean > 0.98 : p.work > 0.98', 0, 80);
    log.merchantArrange = r;
    await runTo(r.t);
    const base = { ...r.p, heading: Math.PI / 2 };
    await shot('merchant-arrange', near(base, 2.8, 1.6, -1), [r.p.x, 1.05, r.p.z]);
}
// 店の人：通りを見る（首を巡らす）
{
    const r = await findT('merchant1', 'p.act ? p.act.lookWeight > 0.98 && Math.abs(p.act.look.z - w.path[0][1]) > 2 : p.work < 0.02', 0, 80);
    log.merchantLook = r;
    if (r) {
        await runTo(r.t);
        await shot('merchant-look', near(r.p, 2.8, 1.6, 1), [r.p.x, 1.2, r.p.z]);
    }
}
// 店の人：主人公が前を通ると会釈（主人公を通りの南から北へ、店の人の 2.2 m 前を少しずつ動かす）
{
    const r = await findT('merchant0', '!p.act || (p.act.lean === 0 && p.act.lookWeight === 0)', 0, 80);
    const m = r.p;
    // 店の人の前（東）2.2 m の線を、南 3.5 m から北へ 1.2 m/秒
    const bowAt = await page.evaluate(
        ({ t, m }) => {
            const w = window.__game.world;
            const h = window.__p3.hero;
            w.ambientTime = t;
            let peak = { i: -1, s: 0 };
            for (let i = 0; i < 150; i++) {
                const z = m.z + 3.5 - (1.2 * i) / 60;
                Object.assign(h, { x: m.x + 2.2, z, heading: Math.PI, dirX: 0, dirZ: -1, speed: 0 });
                window.__p3.step(1 / 60, 0, 0);
                const a = w.ambientActors.people.get('merchant0');
                const spine = a?.body.bones.get('Spine');
                if (a?.bowAt != null && i > peak.i && w.ambientTime - a.bowAt > 0.5 && w.ambientTime - a.bowAt < 0.6) {
                    peak = { i, s: spine ? spine.quaternion.x : 0 };
                    break;
                }
            }
            return peak;
        },
        { t: r.t, m },
    );
    log.merchantBow = { start: r.t, bowAt };
    await shot('merchant-bow', [m.x + 2.7, 1.7, m.z - 2.7], [m.x + 0.9, 1.0, m.z + 0.4]);
    await heroAway();
}
// 休み場の負傷兵：土塀ぎわに地べたに座る 3 人・詰所の囲いの床几に座る 3 人
{
    await runTo(30);
    await shot('wounded-ground', [4.9, 1.4, -4.3], [6.6, 0.45, -1.6]);
    await shot('wounded-stools', [13.3, 1.5, -3.9], [13.3, 0.6, -6.5]);
    // 横から（座った形が分かる向き）
    await shot('wounded-ground-side', [5.6, 0.9, -4.6], [6.6, 0.4, -2.2]);
    await shot('wounded-stools-side', [10.6, 1.0, -5.0], [12.9, 0.5, -6.5]);
}
writeFileSync(`${out}/${label}-shots.json`, JSON.stringify({ log, errors }, null, 1));
console.log(JSON.stringify({ errors }));
await browser.close();
