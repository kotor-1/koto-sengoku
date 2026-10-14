/**
 * 主人公の足運びの測り（Version 28 §4.1）。開発の画面を ?q=low&render=manual&nogame で開き（描かない・人物は主人公だけ）、
 * 自動の更新を止めて __p3.step(1/60, 入力) で 60 コマ/秒の決まった歩みで進め、毎コマの骨の位置から測る。
 *   BASE3D=http://localhost:8781 node e2e/motion-probe.mjs <出力フォルダ> [ラベル]
 * 測るもの（場面ごと）：
 * - 着いた足の速さ（m/秒）：足の裏の「かかと」と「母指球」の点のうち低い方が地面から 2cm 以内の足を「着いた足」とし、
 *   前のコマから同じ点が水平に動いた速さ。最大・95%・0.3m/秒を超えたコマの割合・滑った距離。
 * - 体の向きの 1 コマの最大の変化（度）：描いた主人公の根の向き（rotation.y）。
 * - 腰の高さ（Hips の骨の高さ − 腰の下の地面）：待機と歩きの範囲。
 * 実時間の滑らかさではない（1 コマずつ決まった時間で進めた計算の値）。
 */
import { writeFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';
import { summarize } from './motion-metrics.mjs';

const BASE3D = process.env.BASE3D || 'http://localhost:8781';
const out = outDir(process.argv[2]);
const label = process.argv[3] || 'probe';
const DT = 1 / 60;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
});
page.setDefaultTimeout(600000);
await page.goto(`${BASE3D}/?q=low&render=manual&nogame`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true && !!window.__p3, null, { timeout: 600000, polling: 250 });

// 足の裏の点（足の骨から見た位置。主人公の草履の形から：かかと z −0.075、母指球 z +0.115、足先 z +0.16、足の裏 y −0.097）
await page.evaluate(async () => {
    const p3 = window.__p3;
    p3.manual();
    const layout = await import('/src/layout.ts');
    const V = p3.camera.position.constructor;
    const heroRoot = () => {
        const h = p3.hero;
        return p3.scene.children.find((o) => o.getObjectByName?.('LeftFoot') && Math.abs(o.position.x - h.x) < 1e-3 && Math.abs(o.position.z - h.z) < 1e-3);
    };
    const HEEL = new V(0, -0.097, -0.075);
    const BALL = new V(0, -0.097, 0.115);
    const TIP = new V(0, -0.094, 0.16);
    const P = (window.__mp = {
        layout,
        rows: [],
        sample(tag) {
            const h = p3.hero;
            const root = heroRoot();
            const row = { tag, x: h.x, z: h.z, hd: h.heading, sp: h.speed };
            if (root) {
                root.updateMatrixWorld(true);
                row.yaw = root.rotation.y;
                const hips = root.getObjectByName('Hips').getWorldPosition(new V());
                row.hipY = hips.y - layout.groundY(hips.x, hips.z);
                for (const side of ['Left', 'Right']) {
                    const f = root.getObjectByName(side + 'Foot');
                    const heel = HEEL.clone().applyMatrix4(f.matrixWorld);
                    const ball = BALL.clone().applyMatrix4(f.matrixWorld);
                    const tip = TIP.clone().applyMatrix4(f.matrixWorld);
                    const hh = heel.y - layout.groundY(heel.x, heel.z);
                    const bh = ball.y - layout.groundY(ball.x, ball.z);
                    const th = tip.y - layout.groundY(tip.x, tip.z);
                    row[side[0]] = { heel: [heel.x, heel.z, hh], ball: [ball.x, ball.z, bh], tip: [tip.x, tip.z, th] };
                }
            }
            P.rows.push(row);
        },
    });
});

const setShift = (on) => page.evaluate((v) => window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: 'Shift', code: 'ShiftLeft', shiftKey: v })), on);
/** 入力 (ix, iy)（画面の右・下）を sec 秒、60 コマ/秒で */
const hold = (tag, sec, ix, iy) =>
    page.evaluate(
        ({ tag, n, ix, iy, dt }) => {
            for (let i = 0; i < n; i++) {
                window.__p3.step(dt, ix, iy);
                window.__mp.sample(tag);
            }
        },
        { tag, n: Math.round(sec / DT), ix, iy, dt: DT },
    );
/** 主人公を置き直す（速さ 0） */
const place = (x, z, heading) =>
    page.evaluate(
        ({ x, z, heading }) => {
            const h = window.__p3.hero;
            Object.assign(h, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
            // 新しい足運び（あれば）の足の固定を外す
            window.__p3.resetLegs?.();
            window.__p3.step(0, 0, 0);
            window.__p3.orbit.yaw = 0;
        },
        { x, z, heading },
    );
/** 地面の方向 (gx, gz) へ進む画面の入力（カメラの yaw 0：画面の上 = 北 −z） */
const ground = (gx, gz) => [gx, gz];
const N = ground(0, -1);
const S = ground(0, 1);
const E = ground(1, 0);

const scenarios = [];
async function scenario(name, fn) {
    await page.evaluate(() => (window.__mp.rows = []));
    await fn();
    const rows = await page.evaluate(() => window.__mp.rows);
    scenarios.push({ name, rows });
}

// 1. 歩き：待機 → 歩き出し → 歩き続ける → 止まる
await scenario('walk', async () => {
    await place(0.5, 8, Math.PI);
    await hold('idle', 1.5, 0, 0);
    await hold('start', 0.6, ...N);
    await hold('steady', 1.4, ...N);
    await hold('stop', 1.5, 0, 0);
});
// 2. 走り
await scenario('run', async () => {
    await place(0.5, 9, Math.PI);
    await hold('idle', 0.8, 0, 0);
    await setShift(true);
    await hold('start', 0.8, ...N);
    await hold('steady', 1.4, ...N);
    await hold('stop', 1.5, 0, 0);
    await setShift(false);
});
// 3. 歩きながら 90° 曲がる
await scenario('turn90', async () => {
    await place(-0.5, 8, Math.PI);
    await hold('idle', 0.5, 0, 0);
    await hold('pre', 1.5, ...N);
    await hold('turn', 1.0, ...E);
    await hold('stop', 1.2, 0, 0);
});
// 4. 歩きながら 180° 切り返す
await scenario('turn180', async () => {
    await place(0.5, 8, Math.PI);
    await hold('idle', 0.5, 0, 0);
    await hold('pre', 1.5, ...N);
    await hold('turn', 1.2, ...S);
    await hold('stop', 1.2, 0, 0);
});
// 5. 走りながら 180° 切り返す
await scenario('turn180run', async () => {
    await place(0.5, 9, Math.PI);
    await hold('idle', 0.5, 0, 0);
    await setShift(true);
    await hold('pre', 1.4, ...N);
    await hold('turn', 1.2, ...S);
    await setShift(false);
    await hold('stop', 1.2, 0, 0);
});
// 6. 立った所から後ろへ（180°）
await scenario('turn180idle', async () => {
    await place(0.5, 4, Math.PI);
    await hold('idle', 1.0, 0, 0);
    await hold('turn', 1.2, ...S);
    await hold('stop', 1.2, 0, 0);
});
// 7. 歩き → 走り → 歩き
await scenario('walkrunwalk', async () => {
    await place(0.5, 10, Math.PI);
    await hold('idle', 0.5, 0, 0);
    await hold('walk', 1.5, ...N);
    await setShift(true);
    await hold('torun', 1.5, ...N);
    await setShift(false);
    await hold('towalk', 1.5, ...N);
    await hold('stop', 1.2, 0, 0);
});
// 8. 家の表の壁に斜め（45°）に押し当てて、壁に沿って滑る
await scenario('wallslide', async () => {
    const H = await page.evaluate(() => window.__mp.layout.HOUSE);
    await place(H.x1 + 0.6, (H.z0 + H.z1) / 2 + 1.5, -Math.PI / 2);
    await hold('idle', 0.5, 0, 0);
    await hold('slide', 2.0, -Math.SQRT1_2, -Math.SQRT1_2);
    await hold('stop', 1.2, 0, 0);
});
// 9. 話しかけたときのように、止まったまま向きだけを一度に 120° 変える（会話・演出が hero.heading を書き換える場合）
await scenario('faceturn', async () => {
    await place(0.5, 6, Math.PI);
    await hold('idle', 0.8, 0, 0);
    await page.evaluate(() => {
        const h = window.__p3.hero;
        h.heading = Math.atan2(Math.sin(h.heading + 2.1), Math.cos(h.heading + 2.1));
        h.dirX = Math.sin(h.heading);
        h.dirZ = Math.cos(h.heading);
    });
    await hold('turn', 1.5, 0, 0);
});
// 10. 待機（呼吸・重心の移り）
await scenario('idle', async () => {
    await place(0.5, 6, Math.PI);
    await hold('idle', 4.0, 0, 0);
});

// ---- 集計（e2e/motion-metrics.mjs） ----
const summary = summarize(scenarios, DT);
const res = { label, at: new Date().toISOString(), dt: DT, summary, errors };
writeFileSync(`${out}/motion-${label}.json`, JSON.stringify({ ...res, scenarios }, null, 0));
writeFileSync(`${out}/motion-${label}-summary.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(summary, null, 1));
if (errors.length) console.log('errors:', errors);
await browser.close();
