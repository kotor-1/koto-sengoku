/**
 * 主人公の足運びの画（Version 28 §4.1 の確かめ）。開発の画面を ?q=low&render=manual&nogame で開き、__p3.step(1/60, 入力) で
 * 決まった場面・位相まで進め、横（または斜め前）から 1 コマだけ描いて撮る（手動の描画。実時間ではない。1 枚ずつ止めた画）。
 *   BASE3D=http://localhost:8781 node e2e/motion-shots.mjs <出力フォルダ> [ラベル]
 * 撮る場面：待機・歩き（片足で立つ真ん中／両足が着いた所）・走り（両足が浮いた所）・止まった後・その場で 120° 向きを変える途中・180° の切り返しの途中。
 */
import { launchBrowser, outDir } from './lib.mjs';

const BASE3D = process.env.BASE3D || 'http://localhost:8781';
const out = outDir(process.argv[2]);
const label = process.argv[3] || 'shots';
const DT = 1 / 60;

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 560, height: 560 } });
page.setDefaultTimeout(600000);
await page.goto(`${BASE3D}/?q=low&render=manual&nogame`);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true && !!window.__p3, null, { timeout: 600000, polling: 250 });
await page.evaluate(() => {
    window.__p3.manual();
    for (const id of ['stick-zone', 'run-btn', 'hero-btn', 'build', 'fps']) {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
    }
});

const setShift = (on) => page.evaluate((v) => window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: 'Shift', code: 'ShiftLeft', shiftKey: v })), on);
const place = (x, z, heading) =>
    page.evaluate(
        ({ x, z, heading }) => {
            const h = window.__p3.hero;
            Object.assign(h, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
            window.__p3.resetLegs?.();
            window.__p3.step(0, 0, 0);
            window.__p3.orbit.yaw = 0;
        },
        { x, z, heading },
    );
const hold = (sec, ix, iy) =>
    page.evaluate(
        ({ n, ix, iy, dt }) => {
            for (let i = 0; i < n; i++) window.__p3.step(dt, ix, iy);
        },
        { n: Math.round(sec / DT), ix, iy, dt: DT },
    );
/** 位相 stride が want を越えるまで（最大 2 秒）進める */
const untilPhase = (want, ix, iy) =>
    page.evaluate(
        ({ want, ix, iy, dt }) => {
            for (let i = 0; i < 120; i++) {
                const a = window.__p3.anim.stride;
                window.__p3.step(dt, ix, iy);
                const b = window.__p3.anim.stride;
                const crossed = a <= b ? a < want && b >= want : a < want || b >= want;
                if (crossed) return b;
            }
            return null;
        },
        { want, ix, iy, dt: DT },
    );
/** 主人公の横（side：右から）・斜め前（front）から撮る */
async function shot(name, view = 'side') {
    await page.evaluate((view) => {
        const p3 = window.__p3;
        const h = p3.hero;
        const yaw = p3.anim.yaw ?? h.heading;
        // 体の右（side）・体の前の斜め右（front）
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const [ox, oz] = view === 'side' ? [-rx * 2.7, -rz * 2.7] : [(fx - rx) * 1.9, (fz - rz) * 1.9];
        p3.camera.position.set(h.x + ox, 0.95, h.z + oz);
        p3.camera.lookAt(h.x, 0.75, h.z);
        p3.camera.updateMatrixWorld();
        p3.renderNow();
    }, view);
    const file = `${out}/${label}-${name}.png`;
    await page.locator('#view canvas').screenshot({ path: file });
    console.log(file);
}

await place(0.5, 6, Math.PI);
await hold(1.2, 0, 0);
await shot('1-idle');
await hold(1.0, 0, -1);
await untilPhase(0.3, 0, -1);
await shot('2-walk-midstance');
await untilPhase(0.05, 0, -1);
await shot('3-walk-doublesupport');
await setShift(true);
await hold(1.2, 0, -1);
await untilPhase(0.45, 0, -1);
await shot('4-run-flight');
await setShift(false);
await hold(0.5, 0, -1);
await hold(0.9, 0, 0);
await shot('5-stopped');
await place(0.5, 6, Math.PI);
await hold(0.8, 0, 0);
await page.evaluate(() => {
    const h = window.__p3.hero;
    h.heading = Math.atan2(Math.sin(h.heading + 2.1), Math.cos(h.heading + 2.1));
    h.dirX = Math.sin(h.heading);
    h.dirZ = Math.cos(h.heading);
});
await hold(0.15, 0, 0);
await shot('6-faceturn-mid', 'front');
await place(0.5, 6, Math.PI);
await hold(0.3, 0, 0);
await hold(1.2, 0, -1);
await hold(0.12, 0, 1);
await shot('7-reverse-mid', 'front');
await browser.close();
