/**
 * 台詞の音声ファイル（proto3d/public/voice/*.mp3）を、この環境の Chromium の decodeAudioData でほどいて測る（Version 28）。
 *
 *   node e2e/voice-decode.mjs [出力の JSON] [mp3 のパス ...]
 *
 * - mp3 のパスを書かなければ、一覧（proto3d/src/audio/voiceManifest.gen.json）の全部をほどき、一覧の秒（sec）・容量と比べる。
 * - ページは本番と同じ CSP（e2e/lib.mjs の PROD_CSP）の下の同じ出どころの fetch → decodeAudioData（data: URL・WASM は使わない）。
 *   開発サーバーは要らない（page.route で、架空の出どころ http://voice.local/ からファイルを出す）。
 * - 測る物：ほどいた長さ（ファイルの標本化の速さ 24 kHz と、この環境の AudioContext の 44.1 kHz の両方）・ピーク（dBFS）・
 *   RMS（dBFS）・前後の無音（-50 dBFS より小さい所）。耳で聞いた確かめではない（数だけ）。
 * - 終わりのコードは、一覧と比べて合わない物（ほどけない・長さが一覧の秒と 0.03 秒より違う・ピークが -1 dBFS を超える）があれば 1。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, PROD_CSP } from './lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] && process.argv[2].endsWith('.json') ? process.argv[2] : null;
const given = process.argv.slice(out ? 3 : 2);
const items = given.length
    ? given.map((p) => ({ id: basename(p), path: resolve(p), entry: null }))
    : JSON.parse(readFileSync(join(REPO, 'proto3d/src/audio/voiceManifest.gen.json'), 'utf8')).lines.map((e) => ({ id: e.id, path: join(REPO, 'proto3d/public', e.file), entry: e }));

const ORIGIN = 'http://voice.local';
const browser = await launchBrowser();
const page = await browser.newPage();
const files = new Map(items.map((it, i) => [`/f${i}.mp3`, it.path]));
await page.route(`${ORIGIN}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': PROD_CSP }, body: '<!doctype html><title>voice</title>' });
    const f = files.get(p);
    if (!f) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'content-security-policy': PROD_CSP }, body: readFileSync(f) });
});
await page.goto(`${ORIGIN}/`);
const results = [];
let bad = 0;
for (const [i, it] of items.entries()) {
    const r = await page.evaluate(async (url) => {
        const buf = await (await fetch(url)).arrayBuffer();
        const measure = async (rate) => {
            const ctx = new OfflineAudioContext(1, 1, rate);
            const ab = await ctx.decodeAudioData(buf.slice(0));
            const x = ab.getChannelData(0);
            let peak = 0;
            let sq = 0;
            for (let k = 0; k < x.length; k++) {
                const a = Math.abs(x[k]);
                if (a > peak) peak = a;
                sq += x[k] * x[k];
            }
            const th = 10 ** (-50 / 20);
            let first = 0;
            while (first < x.length && Math.abs(x[first]) < th) first++;
            let last = x.length - 1;
            while (last > 0 && Math.abs(x[last]) < th) last--;
            return {
                rate: ab.sampleRate,
                samples: ab.length,
                sec: ab.length / ab.sampleRate,
                peakDb: 20 * Math.log10(Math.max(peak, 1e-9)),
                rmsDb: 10 * Math.log10(Math.max(sq / x.length, 1e-18)),
                leadSec: first / ab.sampleRate,
                tailSec: (x.length - 1 - last) / ab.sampleRate,
            };
        };
        return { bytes: buf.byteLength, native: await measure(24000), ctx44: await measure(44100) };
    }, `${ORIGIN}/f${i}.mp3`);
    const row = { id: it.id, ...r };
    if (it.entry) {
        const problems = [];
        if (r.bytes !== it.entry.bytes) problems.push(`容量 ${r.bytes} ≠ 一覧 ${it.entry.bytes}`);
        if (Math.abs(r.native.sec - it.entry.sec) > 0.03) problems.push(`長さ ${r.native.sec.toFixed(3)} ≠ 一覧 ${it.entry.sec}`);
        if (r.native.peakDb > -1 || r.ctx44.peakDb > -1) problems.push(`ピーク ${Math.max(r.native.peakDb, r.ctx44.peakDb).toFixed(2)} dBFS > -1`);
        row.manifestSec = it.entry.sec;
        row.problems = problems;
        if (problems.length) bad++;
    }
    results.push(row);
    console.log(
        `${it.id}: ${r.native.sec.toFixed(3)} s（24 kHz ${r.native.samples}）/ ${r.ctx44.sec.toFixed(3)} s（44.1 kHz）` +
            ` ピーク ${r.native.peakDb.toFixed(2)} dBFS・RMS ${r.native.rmsDb.toFixed(1)} dBFS・前 ${r.native.leadSec.toFixed(3)} s・後 ${r.native.tailSec.toFixed(3)} s` +
            (row.problems ? (row.problems.length ? `  ×${row.problems.join('、')}` : '  ○一覧と合う') : ''),
    );
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify({ chromium: 'chromium-1194（e2e/lib.mjs）', note: '数で測った確かめ（耳では聞いていない）', results }, null, 2));
process.exit(bad ? 1 : 0);
