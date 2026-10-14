/**
 * Version 28 §6「動きの確かめの映像」：1 コマずつ進めて描いたコマ撮り（音なし。実時間ではない）。
 * 開発の画面（?render=manual。Q=low なら ?q=low も）を開き、はじめから → 短い始めを「スキップ」した後で、ページの時計
 * （performance.now・requestAnimationFrame）を差し替えて、1 コマ = 1/24 秒ずつ進めて描き（__p3.renderNow）、画面を撮る。
 * ゲームの毎コマの更新と演出の時計（cinePlayer）は、差し替えた時計で同じ 1/24 秒ずつ進む。入力は本物のキー（押したまま進める）。
 * すべてのコマに「コマ撮り（実時間ではない）」と場面の名前・時刻を焼き込む（ページの上に重ねた文字を一緒に撮る）。
 *   BASE3D=http://localhost:8781 [Q=low] [FPS=24] [EVFPS=12] [W=1280 H=720] [MAXF=<コマ数の上限>] node e2e/motion-video.mjs <出力先>
 *   EVFPS：急報の間だけ 1 コマで進める時間を 1/EVFPS 秒にする（描くのが遅すぎるとき。既定は FPS と同じ）。映像は FPS のままで、
 *   急報の 1 コマを FPS/EVFPS 回くり返して並べる（frames.txt）。焼き込む文字に「1 コマ = ゲームの 1/EVFPS 秒」と書く。
 * 出力：<出力先>/frames/f00000.jpg …・frames.json（コマごとの主人公・演出の時刻・字幕・描く／撮るのにかかった時間。24 コマごとに書き直す）・
 *   frames.txt（映像の順のコマのファイル。くり返しを含む）。映像にまとめるのは別（ffmpeg の image2pipe → VP8・webm）：
 *   xargs cat < <出力先>/frames.txt | /opt/pw-browsers/ffmpeg-1011/ffmpeg-linux -f image2pipe -framerate 24 -c:v mjpeg -i pipe:0 -an -c:v libvpx -pix_fmt yuv420p -b:v 6M -crf 8 -g 24 out.webm
 * 場面：町の入口で待機 → 北へ歩く → 180° 振り返って歩く → 止まる → 北へ走る（線 z 6 を越えて急報）→ 急報を最後まで → 操作へ戻る → 数歩 歩く。
 * 注意：このコンテナの描画はソフトウェア（1 コマに数秒）。映像は動きの形の確かめで、実機の滑らかさの証拠ではない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/motion-video');
const FR = `${OUT}/frames`;
mkdirSync(FR, { recursive: true });
const BASE = process.env.BASE3D || 'http://localhost:8781';
const LOW = process.env.Q === 'low';
const FPS = Number(process.env.FPS || 24);
const EVFPS = Number(process.env.EVFPS || FPS);
if (!(FPS % EVFPS === 0 && EVFPS > 0)) throw new Error(`EVFPS（${EVFPS}）は FPS（${FPS}）を割り切る数にする`);
const MAXF = Number(process.env.MAXF || 100000);
const VIEW = { width: Number(process.env.W || 960), height: Number(process.env.H || 540) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = { timeout: 600000, polling: 100 };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: VIEW });
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
page.on('console', (m) => {
    if (m.type() === 'error' && !/素材なし/.test(m.text())) errors.push(m.text().slice(0, 300));
});
await page.goto(`${BASE}/?render=manual${LOW ? '&q=low' : ''}`);
await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
await page.waitForFunction(() => window.__game.world.ready, null, POLL);
await sleep(600);
// はじめから（本物のクリック）→ 短い始めを「スキップ」（本物のクリック）。ここまでは実時間
await page.locator('button[data-id="new:ieyasu1570"]').click();
await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
await sleep(600);
await page.locator('.g-layer[data-kind="cine"] .g-cine-btn[data-id="skip"]').click();
await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
await sleep(800);

// 時計の差し替え：performance.now と requestAnimationFrame を、pump(ms) で進める時計にする（three の setAnimationLoop・演出の時計・押し始めの守り）
await page.evaluate(
    ({ low }) => {
        let v = performance.now();
        let q = [];
        let id = 1;
        performance.now = () => v;
        window.requestAnimationFrame = (cb) => {
            const i = id++;
            q.push([i, cb]);
            return i;
        };
        window.cancelAnimationFrame = (i) => {
            q = q.filter(([j]) => j !== i);
        };
        const label = document.createElement('div');
        label.id = 'mv-label';
        label.style.cssText =
            'position:fixed;left:10px;top:50%;transform:translateY(-50%);z-index:2147483647;pointer-events:none;padding:6px 10px;border-radius:6px;' +
            'background:rgba(0,0,0,0.55);color:#fff;font:600 17px/1.35 sans-serif;white-space:pre;text-shadow:0 1px 2px #000';
        document.body.appendChild(label);
        window.__mv = {
            low,
            pump(ms) {
                v += ms;
                const run = q;
                q = [];
                for (const [, cb] of run) {
                    try {
                        cb(v);
                    } catch (e) {
                        console.error(e);
                    }
                }
                return run.length;
            },
            label(t) {
                label.textContent = t;
            },
        };
    },
    { low: LOW },
);

const rows = [];
let n = 0;
/** 映像の中の時刻（秒。くり返しのコマを含む） */
let vt = 0;
const t0 = Date.now();
const save = (done) =>
    writeFileSync(
        `${OUT}/frames.json`,
        JSON.stringify({ done, fps: FPS, evfps: EVFPS, low: LOW, view: VIEW, frames: rows.length, videoFrames: rows.reduce((a, r) => a + r.dup, 0), wallSec: (Date.now() - t0) / 1000, errors, rows }, null, 0),
    );
/** 1 コマ：時計を 1/step 秒進める（ゲームの更新と演出の時計）→ 描く → 文字を書いて撮る。映像には FPS/step 回並べる */
async function frame(seg, step = FPS) {
    if (n >= MAXF) return false;
    const a = Date.now();
    const row = await page.evaluate(
        ({ ms, seg, n, vt, fps, step }) => {
            window.__mv.pump(ms);
            const g = window.__game;
            const h = window.__p3.hero;
            const c = g.cine;
            window.__mv.label(
                `コマ撮り（実時間ではない）\n${seg}  ${vt.toFixed(2)} 秒\n1 コマ = ゲームの 1/${step} 秒・映像 ${fps} コマ/秒・${window.__mv.low ? '画質 低（?q=low）' : '画質 ふつう'}`,
            );
            window.__p3.renderNow();
            return { n, t: vt, seg, step, x: h.x, z: h.z, heading: h.heading, speed: h.speed, cine: c ? { id: c.id, t: c.t, speaker: c.caption?.speaker ?? null } : null, ui: g.ui?.kind ?? null, townEvent: g.townEvent };
        },
        { ms: 1000 / step, seg, n, vt, fps: FPS, step },
    );
    const b = Date.now();
    row.renderMs = b - a;
    await page.screenshot({ path: `${FR}/f${String(n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 });
    row.shotMs = Date.now() - b;
    row.dup = FPS / step;
    row.wallMs = Date.now() - t0;
    rows.push(row);
    vt += 1 / step;
    n++;
    if (n % 24 === 0) {
        save(false);
        console.log(`${n} コマ（${seg}）  経過 ${((Date.now() - t0) / 1000).toFixed(0)} 秒  主人公 (${row.x.toFixed(2)}, ${row.z.toFixed(2)})${row.cine ? `  演出 ${row.cine.id} ${row.cine.t.toFixed(2)}` : ''}`);
    }
    return true;
}
/** sec 秒（または pred が真になるまで）、keys を押したまま 1 コマずつ */
async function hold(seg, keys, sec, pred = null) {
    for (const k of keys) await page.keyboard.down(k);
    const want = Math.round(sec * FPS);
    for (let i = 0; i < want; i++) {
        if (!(await frame(seg))) break;
        if (pred && (await page.evaluate(pred))) break;
    }
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

await hold('町の入口で待機', [], 0.5);
await hold('北へ歩く', ['KeyW'], 3.0);
await hold('180° 振り返って歩く', ['KeyS'], 1.5);
await hold('止まる', [], 1.2);
await hold('北へ走る（Shift）', ['ShiftLeft', 'KeyW'], 4.0, () => window.__game.ui?.kind === 'cine' || window.__game.townEvent !== 'ch1_report');
// 急報（演出の時計も同じ 1/EVFPS 秒ずつ。既定は 1/FPS 秒）。終わって操作へ戻るまで
for (let i = 0; i < 30 * EVFPS; i++) {
    const s = rows.at(-1);
    const seg = s?.cine?.speaker ? `急報：${s.cine.speaker}` : '急報';
    if (!(await frame(seg, EVFPS))) break;
    const done = await page.evaluate(() => window.__game.screen === 'explore' && !window.__game.ui && !window.__game.cine);
    if (done) break;
}
await hold('操作へ戻る', [], 0.8);
await hold('数歩 歩く（W）', ['KeyW'], 2.0);

save(true);
writeFileSync(`${OUT}/frames.txt`, rows.flatMap((r) => Array(r.dup).fill(`${FR}/f${String(r.n).padStart(5, '0')}.jpg`)).join('\n') + '\n');
const vf = rows.reduce((a, r) => a + r.dup, 0);
console.log(`コマ ${rows.length}（映像のコマ ${vf}・${(vf / FPS).toFixed(1)} 秒分）・かかった時間 ${((Date.now() - t0) / 1000).toFixed(0)} 秒・ページの誤り ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5));
await browser.close();
