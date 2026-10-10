#!/usr/bin/env node
// 公開する dist（3D 比較版のビルド出力）の容量・ファイル数・種類を確かめる（Version 22〜）。違反があれば 1 で終わる。
//
//   node proto3d/tools/check-dist.mjs [dist-proto3d] [--baseline <前回公開した dist>] [--budget <バイト>] [--json]
//
// - 全体の合計とファイル数、/art（生成イラスト素材の加工版）のファイルと容量を表にする。
// - 上限（下の LIMITS）を守るか：1 回の公開で送るファイル（--baseline があれば、前回と中身が違う・新しいファイルだけ。無ければ全部）は
//   64MB・255 ファイル以下、版の全体は 256MB・511 ファイル以下、バイナリ 1 つ 15MB 以下、テキスト 1 つ 16MB 以下。
//   これらの上限は、公開に使う道具（Artifact）が今日（2026-10）示している値。道具の説明が変わったらここを直す。
//   MB は控えめに 1,000,000 バイトで数える（MiB なら少し余裕が増える）。
// - .glb は置けない（公開先が受け付けない）。dev-art（開発用の TEST の模様）は、ファイルも、JS の中の読む口の文字列も入れない。
// - 正本の記録（proto3d/assets-src/art-v22/manifest.json）の中身（プロンプトの参照など）が JS に入っていないこと。
// - Version 25：素材パック第 2 版の、公開しない物（織田信長・朝倉義景・城下町・大平原の遠景・林床・パックそのもの）の名前のファイルが無いこと。
// - --baseline を付けると、前回にあって今回に無いファイル（公開の道具は、明示して消さない限り残す）も一覧にする。
// - --budget は、遊ぶ人の読み込み量の自分の目安（例 63000000）。超えたら違反にする。
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const LIMITS = {
    publishBytes: 64_000_000,
    publishFiles: 255,
    versionBytes: 256_000_000,
    versionFiles: 511,
    binaryFileBytes: 15_000_000,
    textFileBytes: 16_000_000,
};

const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.svg', '.map', '.md', '.xml', '.csv', '.webmanifest']);
const WEB_EXT = new Set([...TEXT_EXT, '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.mp3', '.ogg', '.m4a', '.wav', '.opus', '.woff', '.woff2', '.mp4', '.webm']);
const ART_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);
// 正本の記録・依頼の文がバンドルに入った印（ゲームは manifest.gen.json だけを読む決まり）
const LEAK_MARKS = ['promptRef', 'ChatGPT で利用者が生成', '【画風】', 'assets-src/art-v22/manifest', 'assets-src/art-v25'];
// 素材パック第 2 版（Version 25）で公開しない物（予約の信長・義景、使っていない背景・林床、パックそのもの）の名前
const UNSHIPPED_ART = /nobunaga|yoshikage|oda_|asakura|castle_town|plains_vista|forest_floor|sengoku_individual/i;

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.isFile()) out.push(p);
    }
    return out;
}

function ext(p) {
    const i = p.lastIndexOf('.');
    return i < 0 ? '' : p.slice(i).toLowerCase();
}

function listFiles(root) {
    return walk(root)
        .map((p) => {
            const rel = relative(root, p).split(sep).join('/');
            const bytes = statSync(p).size;
            return { rel, abs: p, bytes, ext: ext(rel), text: TEXT_EXT.has(ext(rel)) };
        })
        .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function sha(p) {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
}

const mb = (n) => `${(n / 1_000_000).toFixed(2)}MB`;

export function checkDist(distDir, { baseline = null, budget = null } = {}) {
    const root = resolve(distDir);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`dist が無い: ${root}`);
    const files = listFiles(root);
    const errors = [];
    const warnings = [];
    const total = files.reduce((s, f) => s + f.bytes, 0);

    let publish = files;
    let stale = [];
    if (baseline) {
        const base = resolve(baseline);
        const prev = new Map(listFiles(base).map((f) => [f.rel, f]));
        publish = files.filter((f) => {
            const p = prev.get(f.rel);
            return !p || p.bytes !== f.bytes || sha(p.abs) !== sha(f.abs);
        });
        const now = new Set(files.map((f) => f.rel));
        stale = [...prev.values()].filter((f) => !now.has(f.rel));
        if (stale.length) warnings.push(`前回にあって今回に無いファイル ${stale.length} 件（公開のときに明示して消さないと版に残る）`);
    }
    const publishBytes = publish.reduce((s, f) => s + f.bytes, 0);

    if (publishBytes > LIMITS.publishBytes) errors.push(`1 回の公開の容量 ${publishBytes} > ${LIMITS.publishBytes}`);
    if (publish.length > LIMITS.publishFiles) errors.push(`1 回の公開のファイル数 ${publish.length} > ${LIMITS.publishFiles}`);
    if (total > LIMITS.versionBytes) errors.push(`版の全体の容量 ${total} > ${LIMITS.versionBytes}`);
    if (files.length > LIMITS.versionFiles) errors.push(`版の全体のファイル数 ${files.length} > ${LIMITS.versionFiles}`);
    if (budget !== null && total > budget) errors.push(`合計 ${total} が目安 ${budget} を超えた`);

    for (const f of files) {
        if (f.ext === '.glb') errors.push(`.glb は置けない: ${f.rel}`);
        if (f.rel.split('/').includes('dev-art')) errors.push(`開発用の TEST の模様（dev-art）が入っている: ${f.rel}`);
        if (f.rel.split('/').includes('assets-src')) errors.push(`原画の置き場（assets-src）が入っている: ${f.rel}`);
        if (f.text && f.bytes > LIMITS.textFileBytes) errors.push(`テキストが ${LIMITS.textFileBytes} バイトを超えた: ${f.rel} ${f.bytes}`);
        if (!f.text && f.bytes > LIMITS.binaryFileBytes) errors.push(`バイナリが ${LIMITS.binaryFileBytes} バイトを超えた: ${f.rel} ${f.bytes}`);
        if (!WEB_EXT.has(f.ext)) warnings.push(`よく使うウェブの種類ではない拡張子: ${f.rel}`);
        if (f.ext === '.js' || f.ext === '.html') {
            const s = readFileSync(f.abs, 'utf8');
            for (const m of LEAK_MARKS) if (s.includes(m)) errors.push(`正本の記録らしい文字列「${m}」が ${f.rel} に入っている`);
            // registry の dev-art を読む口は import.meta.env.DEV の中だけにあり、本番のビルドでは消える（Version 22 の最初のビルドで確かめた）
            if (s.includes('dev-art/')) errors.push(`${f.rel} に dev-art/ の文字列がある（開発時だけの口が本番に残っている）`);
        }
    }
    const art = files.filter((f) => f.rel.startsWith('art/'));
    for (const f of art) if (!ART_EXT.has(f.ext)) errors.push(`/art に画像でないファイル: ${f.rel}`);
    for (const f of files) if (UNSHIPPED_ART.test(f.rel)) errors.push(`公開しない素材（予約・未使用・素材パックそのもの）の名前のファイル: ${f.rel}`);
    const artBytes = art.reduce((s, f) => s + f.bytes, 0);
    const byTop = new Map();
    for (const f of files) {
        const top = f.rel.includes('/') ? f.rel.slice(0, f.rel.indexOf('/')) : '(root)';
        const g = byTop.get(top) ?? { files: 0, bytes: 0 };
        g.files++;
        g.bytes += f.bytes;
        byTop.set(top, g);
    }
    return {
        dist: root,
        total: { files: files.length, bytes: total },
        publish: { files: publish.length, bytes: publishBytes, baseline: baseline ? resolve(baseline) : null },
        stale: stale.map((f) => f.rel),
        groups: Object.fromEntries([...byTop.entries()].sort()),
        art: { files: art.map((f) => ({ path: f.rel, bytes: f.bytes })), bytes: artBytes },
        limits: LIMITS,
        errors,
        warnings,
    };
}

function main(argv) {
    const args = [...argv];
    const opt = { baseline: null, budget: null, json: false };
    let dist = null;
    while (args.length) {
        const a = args.shift();
        if (a === '--baseline') opt.baseline = args.shift();
        else if (a === '--budget') opt.budget = Number(args.shift());
        else if (a === '--json') opt.json = true;
        else if (a === '-h' || a === '--help') {
            console.log('node proto3d/tools/check-dist.mjs [dist-proto3d] [--baseline <前回の dist>] [--budget <バイト>] [--json]');
            return 0;
        } else dist = a;
    }
    const r = checkDist(dist ?? 'dist-proto3d', opt);
    if (opt.json) {
        console.log(JSON.stringify(r, null, 2));
        return r.errors.length ? 1 : 0;
    }
    console.log(`dist: ${r.dist}`);
    console.log(`全体: ${r.total.files} ファイル・${r.total.bytes} バイト（${mb(r.total.bytes)}）／版の上限 ${LIMITS.versionFiles} ファイル・${mb(LIMITS.versionBytes)}`);
    console.log(
        `1 回の公開で送る分: ${r.publish.files} ファイル・${r.publish.bytes} バイト（${mb(r.publish.bytes)}）／上限 ${LIMITS.publishFiles} ファイル・${mb(LIMITS.publishBytes)}` +
            (r.publish.baseline ? `（前回 ${r.publish.baseline} と違う物だけ）` : '（--baseline なし：全部を送るとして数えた）') +
            `・残り ${LIMITS.publishBytes - r.publish.bytes} バイト`,
    );
    console.log('置き場ごと:');
    for (const [k, g] of Object.entries(r.groups)) console.log(`  ${k.padEnd(10)} ${String(g.files).padStart(4)} ファイル ${String(g.bytes).padStart(11)} バイト`);
    console.log(`/art（生成イラスト素材の加工版）: ${r.art.files.length} ファイル・${r.art.bytes} バイト`);
    for (const f of r.art.files) console.log(`  ${f.path.padEnd(36)} ${String(f.bytes).padStart(9)}`);
    for (const s of r.stale) console.log(`  前回だけにある: ${s}`);
    for (const w of r.warnings) console.log(`注意: ${w}`);
    for (const e of r.errors) console.log(`違反: ${e}`);
    console.log(r.errors.length ? `check-dist: 違反 ${r.errors.length} 件` : 'check-dist: 問題なし');
    return r.errors.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-dist.mjs')) {
    try {
        process.exit(main(process.argv.slice(2)));
    } catch (e) {
        console.error(`check-dist: ${e.message}`);
        process.exit(2);
    }
}
