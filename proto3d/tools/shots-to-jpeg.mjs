#!/usr/bin/env node
// 確かめの画面写真（e2e の PNG）を JPEG にして小さくする道具。囲いを付けて、写真の置き場の中だけを変える（Version 27〜）。
//
//   node proto3d/tools/shots-to-jpeg.mjs <置き場> [<置き場> ...] [--apply] [--quality 85] [--keep-png] [--allow-name <名前>]...
//
// Version 26 の公開の前に、作業用の片付けで「親の置き場の下の *.png をすべて JPEG にして PNG を消す」一括変換を走らせ、
// 同じ置き場の中にあった公開用の dist の PNG 13 個（favicon と 3D の質感）まで変えた（docs/build-image-safety.md）。
// この道具は、その形の事故が起きないように次を守る：
// - 変えるのは、引数で名指しした置き場の「すぐ下」の .png だけ（下の階層には降りない。親の置き場を渡す・ワイルドカードで集める使い方はできない）。
// - 置き場の名前（最後の部分）は shots・montage・prod-shots だけ（--allow-name で足せる）。
// - パスのどこかに dist・models・public・assets-src・dev-art・node_modules を含む物は断る（--allow-name でも外せない）。
//   シンボリックリンクの置き場は断り、実際の場所（realpath）も同じく調べる。
// - 置き場の中に index.html・sha256 の一覧（*.sha256）・3D の素材（*.glb・*.gltf）がある物は断る（dist や公開の控えの印）。
// - git で管理しているファイル（リポジトリの原画・素材・説明の画像）が 1 つでもあれば断る。
// - 中身が PNG でない .png は変えない。同じ名前の .jpg が既にあれば変えない。
// - 何もしないのが既定（どれを変えるかを並べるだけ）。--apply を付けたときだけ変える。変えた後、JPEG が開けることを確かめてから PNG を消す
//   （--keep-png なら残す）。
// e2e の写真は、はじめから JPEG で撮る（playwright の screenshot({ type: 'jpeg', quality })）のがいちばん安全。この道具は撮った後の PNG 用。
// JPEG にするのは Python の Pillow（python3 -I）。断る・並べるだけなら Pillow は要らない。
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

export const DEFAULT_NAMES = ['shots', 'montage', 'prod-shots'];
/** パスのどこかに含むと断る言葉（小文字で比べる。部分一致） */
export const FORBIDDEN_WORDS = ['dist', 'models', 'public', 'assets-src', 'dev-art', 'node_modules'];
/** 置き場の中にあると断るファイル（dist・公開の控え・3D の素材の印） */
const FORBIDDEN_FILE = (name) => name === 'index.html' || /\.(sha256|glb|gltf)$/i.test(name);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(p) {
    try {
        const b = readFileSync(p);
        return b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
    } catch {
        return false;
    }
}

function forbiddenWord(path) {
    for (const seg of path.split(sep)) {
        const s = seg.toLowerCase();
        const w = FORBIDDEN_WORDS.find((x) => s.includes(x));
        if (w) return { seg, word: w };
    }
    return null;
}

/** git で管理しているファイル（置き場のすぐ下の物）の名前。git が無い・リポジトリの外なら空 */
function trackedNames(dir) {
    const r = spawnSync('git', ['-C', dir, 'ls-files', '-z', '--', '.'], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return new Set();
    return new Set(r.stdout.split('\0').filter((p) => p && !p.includes('/')));
}

/**
 * 置き場ごとに、変える PNG の一覧か、断る理由を返す（ファイルには触らない）。
 * @returns {{ dir: string, refused: string | null, convert: string[], skipped: string[] }[]}
 */
export function planShots(dirs, { allowNames = [] } = {}) {
    const names = new Set([...DEFAULT_NAMES, ...allowNames]);
    return dirs.map((arg) => {
        const dir = resolve(arg);
        const out = { dir, refused: null, convert: [], skipped: [] };
        const refuse = (why) => ((out.refused = why), out);
        if (!existsSync(dir)) return refuse('置き場が無い');
        const st = lstatSync(dir);
        if (st.isSymbolicLink()) return refuse('シンボリックリンクの置き場は扱わない（実際の置き場を渡す）');
        if (!st.isDirectory()) return refuse('置き場（ディレクトリ）ではない');
        const real = realpathSync(dir);
        if (!names.has(basename(dir)) || !names.has(basename(real)))
            return refuse(`置き場の名前が ${[...names].join('・')} のどれでもない（親の置き場をまとめて変えない）`);
        for (const p of [dir, real]) {
            const hit = forbiddenWord(p);
            if (hit) return refuse(`パスの「${hit.seg}」に ${hit.word} を含む（公開物・素材・原画の置き場かもしれない）`);
        }
        const entries = readdirSync(real, { withFileTypes: true });
        const bad = entries.find((e) => FORBIDDEN_FILE(e.name));
        if (bad) return refuse(`置き場の中に ${bad.name} がある（dist・公開の控え・3D の素材の置き場かもしれない）`);
        const pngs = entries.filter((e) => e.isFile() && /\.png$/i.test(e.name)).map((e) => e.name).sort();
        const tracked = trackedNames(real);
        const inGit = pngs.filter((n) => tracked.has(n));
        if (inGit.length) return refuse(`git で管理しているファイルがある（${inGit.slice(0, 3).join('・')}${inGit.length > 3 ? ' ほか' : ''}）`);
        for (const n of pngs) {
            const p = join(real, n);
            const jpg = p.replace(/\.png$/i, '.jpg');
            if (!isPng(p)) out.skipped.push(`${n}（中身が PNG ではない）`);
            else if (existsSync(jpg)) out.skipped.push(`${n}（同じ名前の .jpg が既にある）`);
            else out.convert.push(p);
        }
        return out;
    });
}

const PY = `
import json, os, sys
from PIL import Image
quality, keep = int(sys.argv[1]), sys.argv[2] == '1'
done = []
for p in sys.argv[3:]:
    jpg = p[:-4] + '.jpg'
    tmp = jpg + '.part'
    with Image.open(p) as im:
        im.convert('RGB').save(tmp, format='JPEG', quality=quality)
    with Image.open(tmp) as chk:
        chk.verify()
    os.replace(tmp, jpg)
    if not keep:
        os.remove(p)
    done.append([p, jpg, os.path.getsize(jpg)])
print(json.dumps(done))
`;

/** 計画のとおりに変える（Pillow）。変えたファイルの [png, jpg, バイト] */
export function applyShots(files, { quality = 85, keepPng = false } = {}) {
    if (!files.length) return [];
    const r = spawnSync('python3', ['-I', '-c', PY, String(quality), keepPng ? '1' : '0', ...files], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`JPEG にできなかった（python3 と Pillow が要る）: ${(r.stderr || r.error?.message || '').trim().slice(-400)}`);
    return JSON.parse(r.stdout);
}

function main(argv) {
    const args = [...argv];
    const dirs = [];
    const allowNames = [];
    let apply = false;
    let quality = 85;
    let keepPng = false;
    while (args.length) {
        const a = args.shift();
        if (a === '--apply') apply = true;
        else if (a === '--keep-png') keepPng = true;
        else if (a === '--quality') {
            quality = Number(args.shift());
            if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('--quality は 1〜100 の整数');
        } else if (a === '--allow-name') {
            const v = args.shift();
            if (!v || v.includes('/') || v.includes(sep)) throw new Error('--allow-name には置き場の名前（/ を含まない）を渡す');
            allowNames.push(v);
        } else if (a === '-h' || a === '--help') {
            console.log('node proto3d/tools/shots-to-jpeg.mjs <置き場>... [--apply] [--quality 85] [--keep-png] [--allow-name <名前>]...');
            return 0;
        } else if (a.startsWith('--')) throw new Error(`知らないオプション: ${a}`);
        else dirs.push(a);
    }
    if (!dirs.length) throw new Error('置き場を 1 つ以上名指しする（例 e2e-out/art-compare/shots）');
    const plans = planShots(dirs, { allowNames });
    const refused = plans.filter((p) => p.refused);
    for (const p of plans) {
        if (p.refused) {
            console.log(`断った: ${p.dir}（${p.refused}）`);
            continue;
        }
        console.log(`${apply ? '変える' : '変える予定（--apply なし：何もしない）'}: ${p.dir} の PNG ${p.convert.length} 個`);
        for (const f of p.convert) console.log(`  ${basename(f)}`);
        for (const s of p.skipped) console.log(`  変えない: ${s}`);
    }
    // 1 つでも断ったら、ほかの置き場も変えない（指定の誤りを先に直す）
    if (refused.length) {
        console.log(`shots-to-jpeg: ${refused.length} 個の置き場を断ったので、何も変えていない`);
        return 2;
    }
    if (!apply) {
        console.log('shots-to-jpeg: 並べただけ（変えるには --apply）');
        return 0;
    }
    const done = applyShots(plans.flatMap((p) => p.convert), { quality, keepPng });
    for (const [, jpg, bytes] of done) console.log(`  → ${jpg} ${bytes} バイト`);
    console.log(`shots-to-jpeg: ${done.length} 個を JPEG にした${keepPng ? '（PNG は残した）' : '（PNG は消した）'}`);
    return 0;
}

if (process.argv[1]?.endsWith('shots-to-jpeg.mjs')) {
    try {
        process.exit(main(process.argv.slice(2)));
    } catch (e) {
        console.error(`shots-to-jpeg: ${e.message}`);
        process.exit(2);
    }
}
