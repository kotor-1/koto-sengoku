#!/usr/bin/env node
// 公開する dist（3D 比較版のビルド出力）の容量・ファイル数・種類を確かめる（Version 22〜）。違反があれば 1 で終わる。
//
//   node proto3d/tools/check-dist.mjs [dist-proto3d] [--baseline <前回公開した dist>] [--budget <バイト>] [--json]
//                                     [--sha256 <ビルドの直後の sha256 の一覧>] [--write-sha256 <書く先> [--overwrite-sha256]]
//
// - 全体の合計とファイル数、/art（生成イラスト素材の加工版）のファイルと容量を表にする。
// - 上限（下の LIMITS）を守るか：1 回の公開で送るファイル（--baseline があれば、前回と中身が違う・新しいファイルだけ。無ければ全部）は
//   64MB・255 ファイル以下、版の全体は 256MB・511 ファイル以下、バイナリ 1 つ 15MB 以下、テキスト 1 つ 16MB 以下。
//   これらの上限は、公開に使う道具（Artifact）が今日（2026-10）示している値。道具の説明が変わったらここを直す。
//   MB は控えめに 1,000,000 バイトで数える（MiB なら少し余裕が増える）。
// - .glb は置けない（公開先が受け付けない）。dev-art（開発用の TEST の模様）は、ファイルも、JS の中の読む口の文字列も入れない。
// - 正本の記録（proto3d/assets-src/art-v22/manifest.json）の中身（プロンプトの参照など）が JS に入っていないこと。
// - Version 25：素材パック第 2 版の、公開しない物（織田信長・朝倉義景・城下町・大平原の遠景・林床・パックそのもの）の名前のファイルが無いこと。
//   名前を変えた写しも止める：パックの一覧（proto3d/assets-src/art-v25/pack-v2/asset_manifest.json の写し）の sha256 と同じ中身のファイルが無いこと
//   （公開するのは作り直した WebP だけで、パックのファイルそのもの（原画・パックの web 版・顔の PNG）は入れない）。
// - --baseline を付けると、前回にあって今回に無いファイル（公開の道具は、明示して消さない限り残す）も一覧にする。
// - --budget は、遊ぶ人の読み込み量の自分の目安（例 63000000）。超えたら違反にする。
// - Version 27：ビルドの後に dist の画像が別の形式に変わる事故（Version 26 の公開の前に、作業用の片付けの一括変換が dist の PNG 13 個を
//   JPEG に変えて PNG を消した。docs/build-image-safety.md）を、手で戻す手順に頼らず、この確かめで止める。
//   - 参照：dist の .html の src・href（外の URL・data: などは除く）、glTF（.json で asset.version のある物）の images[].uri・buffers[].uri、
//     JS の中の同じ置き場の読み込み（"./名前.js"・"./名前.css"）と生成イラスト素材の場所（"art/…/名前.webp" など）が、dist の中にあること。
//   - 中身の形式：拡張子と中身が合うこと（PNG・JPEG・WebP・GIF・AVIF・ICO・WOFF・音・動画は先頭の印、JSON は読めること、
//     JS・CSS・HTML・SVG などの文字のファイルは UTF-8 として読めて NUL が無いこと）。glTF の画像の mimeType と拡張子も合うこと。
//   - --sha256 <一覧>：ビルドの直後に取った sha256 の一覧（`sha256sum` の形「<64 桁>  ./パス」）と、ファイルの組と中身がすべて同じこと。
//   - --write-sha256 <ファイル>：違反が無いときだけ、今の dist の sha256 の一覧を書く（dist の中には書かない）。ビルドの直後に書き、
//     公開の直前に --sha256 で照らす。既にある一覧は上書きしない（壊れた後にもう一度走らせて、壊れた中身を「正しい」と書き直さない）。
//     ビルドを作り直したときだけ --overwrite-sha256 を付ける。
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// 素材パック第 2 版の一覧の写し（リポジトリにある。パックの全ファイルの sha256）。無ければ（古い checkout）この確かめは飛ばして注意にする
const PACK_V2_LIST = resolve(dirname(fileURLToPath(import.meta.url)), '../assets-src/art-v25/pack-v2/asset_manifest.json');

function packV2Hashes() {
    if (!existsSync(PACK_V2_LIST)) return null;
    const list = JSON.parse(readFileSync(PACK_V2_LIST, 'utf8'));
    return new Map((list.assets ?? []).filter((a) => typeof a.sha256 === 'string').map((a) => [a.sha256.toLowerCase(), a.path]));
}

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

const mb = (n) => `${(n / 1_000_000).toFixed(2)}MB`;

// ---- Version 27：中身の形式・参照・sha256 の一覧 ----

const ascii = (b, from, to) => (b.length >= to ? b.toString('latin1', from, to) : '');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 先頭の印で見分ける種類（見分けられなければ null） */
export function sniff(b) {
    if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return 'PNG';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'WebP';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'WAV';
    if (ascii(b, 0, 4) === 'GIF8') return 'GIF';
    if (ascii(b, 4, 8) === 'ftyp') return /^avi[fs]$/.test(ascii(b, 8, 12)) ? 'AVIF' : 'MP4';
    if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ICO';
    if (ascii(b, 0, 4) === 'wOFF') return 'WOFF';
    if (ascii(b, 0, 4) === 'wOF2') return 'WOFF2';
    if (ascii(b, 0, 4) === 'OggS') return 'Ogg';
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'WebM';
    if (ascii(b, 0, 3) === 'ID3' || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'MP3';
    if (ascii(b, 0, 4) === 'glTF') return 'GLB';
    return null;
}
/** 拡張子ごとに、先頭の印で合うとみなす種類 */
const BINARY_KIND = {
    '.png': ['PNG'],
    '.jpg': ['JPEG'],
    '.jpeg': ['JPEG'],
    '.webp': ['WebP'],
    '.gif': ['GIF'],
    '.avif': ['AVIF'],
    '.ico': ['ICO', 'PNG'],
    '.woff': ['WOFF'],
    '.woff2': ['WOFF2'],
    '.ogg': ['Ogg'],
    '.opus': ['Ogg'],
    '.wav': ['WAV'],
    '.mp3': ['MP3'],
    '.m4a': ['MP4'],
    '.mp4': ['MP4'],
    '.webm': ['WebM'],
    '.glb': ['GLB'],
};
const JSON_EXT = new Set(['.json', '.map', '.webmanifest']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * 拡張子と中身が合うかを確かめる。合わなければ理由の文、合えば null。文字のファイルは text に読んだ文字を、JSON は json に読んだ値を入れて返す。
 * @returns {{ problem: string | null, checked: boolean, text?: string, json?: unknown }}
 */
export function contentCheck(ext, buf) {
    const kinds = BINARY_KIND[ext];
    if (kinds) {
        const got = sniff(buf);
        if (kinds.includes(got)) return { problem: null, checked: true };
        return { problem: `${ext} なのに中身は ${got ?? (buf.length ? '見分けられない形式' : '空（0 バイト）')}`, checked: true };
    }
    if (!TEXT_EXT.has(ext)) return { problem: null, checked: false };
    let text;
    try {
        text = utf8.decode(buf);
    } catch {
        const got = sniff(buf);
        return { problem: `${ext} なのに UTF-8 の文字として読めない${got ? `（中身は ${got}）` : ''}`, checked: true };
    }
    if (text.includes('\0')) return { problem: `${ext} なのに NUL の文字がある（文字のファイルではない）`, checked: true };
    const body = text.replace(/^\uFEFF/, '');
    if (JSON_EXT.has(ext)) {
        try {
            return { problem: null, checked: true, text, json: JSON.parse(body) };
        } catch (e) {
            return { problem: `${ext} なのに JSON として読めない（${e.message.slice(0, 80)}）`, checked: true };
        }
    }
    if (ext === '.html' && !/^\s*</.test(body)) return { problem: '.html なのに < で始まらない', checked: true };
    if (ext === '.svg' && !body.includes('<svg')) return { problem: '.svg なのに <svg が無い', checked: true };
    return { problem: null, checked: true, text };
}

/**
 * dist の中のファイル（from、dist の中の相対パス）から書いた参照を、dist の中の相対パスにする。外の URL・data:・# だけの物は null。
 * dist の外を指すときは '../' で始まる文字を返す。
 */
export function localTarget(from, ref) {
    const r = String(ref ?? '').trim();
    if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r)) return null;
    let p = r.split(/[?#]/)[0];
    if (!p || p.endsWith('/')) return null;
    try {
        p = decodeURIComponent(p);
    } catch {
        /* そのまま */
    }
    const base = p.startsWith('/') ? '' : posix.dirname(from);
    const joined = posix.normalize(posix.join(base === '.' ? '' : base, p.replace(/^\/+/, '')));
    return joined.replace(/^\.\//, '');
}

/** HTML の src・href の値（コメントの中は除く） */
export function htmlRefs(html) {
    const out = [];
    const s = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of s.match(/<[a-zA-Z][^>]*>/g) ?? []) {
        const re = /\s(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
        let m;
        while ((m = re.exec(tag))) out.push(m[2] ?? m[3] ?? m[4] ?? '');
    }
    return out;
}

/** glTF（asset.version のある JSON）の画像・データの参照。glTF でなければ null */
export function gltfRefs(json) {
    if (!json || typeof json !== 'object' || !json.asset || typeof json.asset.version !== 'string') return null;
    const out = [];
    for (const kind of ['images', 'buffers'])
        for (const [i, it] of (Array.isArray(json[kind]) ? json[kind] : []).entries())
            if (it && typeof it.uri === 'string' && !it.uri.startsWith('data:')) out.push({ kind, i, uri: it.uri, mimeType: it.mimeType });
    return out;
}

/** JS の中の、同じ置き場の読み込み（"./名前.js"・"./名前.css"、JS の置き場から）と生成イラスト素材（"art/…"、dist の根から）の文字 */
export function jsRefs(js) {
    const chunks = [...js.matchAll(/["'`]\.\/([A-Za-z0-9_.@-]+\.(?:m?js|css))["'`]/g)].map((m) => `./${m[1]}`);
    const art = [...js.matchAll(/["'`](?:\.\/)?(art\/[A-Za-z0-9_\-/]+\.(?:webp|png|jpe?g|avif|gif))["'`]/g)].map((m) => m[1]);
    return { chunks: [...new Set(chunks)], art: [...new Set(art)] };
}

const MIME_EXT = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/ktx2': ['.ktx2'] };

/** `sha256sum` の形の一覧（「<64 桁>  ./パス」または「<64 桁> *パス」）を読む */
export function readSha256List(path) {
    const map = new Map();
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
        if (!m) throw new Error(`sha256 の一覧の形が違う行: ${line.slice(0, 120)}`);
        map.set(m[2].replace(/^\.\//, ''), m[1].toLowerCase());
    }
    return map;
}

export function checkDist(distDir, { baseline = null, budget = null, sha256 = null } = {}) {
    const root = resolve(distDir);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`dist が無い: ${root}`);
    const files = listFiles(root);
    const errors = [];
    const warnings = [];
    const total = files.reduce((s, f) => s + f.bytes, 0);
    // 1 回の確かめの中では、同じファイルの sha256 を 1 度だけ計る（テストは同じ場所を書き換えて何度も呼ぶので、呼ぶたびに作り直す）
    const hashes = new Map();
    const sha = (p) => {
        let h = hashes.get(p);
        if (!h) hashes.set(p, (h = createHash('sha256').update(readFileSync(p)).digest('hex')));
        return h;
    };

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

    const present = new Set(files.map((f) => f.rel));
    const refs = { html: 0, gltf: 0, js: 0, content: 0 };
    /** 参照の先が dist の中にあるか。無ければ違反（何から・何を・どこを探したか） */
    const needRef = (from, ref, what, base = from) => {
        const t = localTarget(base, ref);
        if (t === null) return;
        if (t === '..' || t.startsWith('../')) errors.push(`${what}が dist の外を指す: ${from} → ${ref}`);
        else if (!present.has(t)) errors.push(`${what}の先のファイルが無い: ${from} → ${ref}（${t}）`);
    };
    for (const f of files) {
        if (f.ext === '.glb') errors.push(`.glb は置けない: ${f.rel}`);
        if (f.rel.split('/').includes('dev-art')) errors.push(`開発用の TEST の模様（dev-art）が入っている: ${f.rel}`);
        if (f.rel.split('/').includes('assets-src')) errors.push(`原画の置き場（assets-src）が入っている: ${f.rel}`);
        if (f.text && f.bytes > LIMITS.textFileBytes) errors.push(`テキストが ${LIMITS.textFileBytes} バイトを超えた: ${f.rel} ${f.bytes}`);
        if (!f.text && f.bytes > LIMITS.binaryFileBytes) errors.push(`バイナリが ${LIMITS.binaryFileBytes} バイトを超えた: ${f.rel} ${f.bytes}`);
        if (!WEB_EXT.has(f.ext)) warnings.push(`よく使うウェブの種類ではない拡張子: ${f.rel}`);
        // Version 27：拡張子と中身が合うこと（PNG を JPEG に変えて名前だけ残した・名前を変えた、などを止める）
        const c = contentCheck(f.ext, readFileSync(f.abs));
        if (c.checked) refs.content++;
        if (c.problem) errors.push(`中身が拡張子と合わない: ${f.rel}（${c.problem}）`);
        if ((f.ext === '.js' || f.ext === '.html') && c.text !== undefined) {
            const s = c.text;
            for (const m of LEAK_MARKS) if (s.includes(m)) errors.push(`正本の記録らしい文字列「${m}」が ${f.rel} に入っている`);
            // registry の dev-art を読む口は import.meta.env.DEV の中だけにあり、本番のビルドでは消える（Version 22 の最初のビルドで確かめた）
            if (s.includes('dev-art/')) errors.push(`${f.rel} に dev-art/ の文字列がある（開発時だけの口が本番に残っている）`);
        }
        // Version 27：参照の先が dist の中にあること
        if (f.ext === '.html' && c.text !== undefined)
            for (const r of htmlRefs(c.text)) {
                if (localTarget(f.rel, r) !== null) refs.html++;
                needRef(f.rel, r, 'HTML の参照');
            }
        if (f.ext === '.js' && c.text !== undefined) {
            const j = jsRefs(c.text);
            for (const r of j.chunks) {
                refs.js++;
                needRef(f.rel, r, 'JS の読み込み');
            }
            for (const r of j.art) {
                refs.js++;
                needRef(f.rel, r, 'JS の中の素材の場所', 'index.html');
            }
        }
        const g = c.json !== undefined ? gltfRefs(c.json) : null;
        if (g)
            for (const r of g) {
                refs.gltf++;
                needRef(f.rel, r.uri, `glTF の ${r.kind}[${r.i}] の uri `);
                const want = r.mimeType ? MIME_EXT[r.mimeType] : null;
                const t = localTarget(f.rel, r.uri);
                if (want && t && !want.includes(ext(t))) errors.push(`glTF の ${r.kind}[${r.i}] の mimeType ${r.mimeType} と拡張子が合わない: ${f.rel} → ${r.uri}`);
            }
    }
    // Version 27：ビルドの直後の sha256 の一覧と、ファイルの組と中身が同じこと
    let shaResult = null;
    if (sha256) {
        const list = readSha256List(resolve(sha256));
        let same = 0;
        for (const f of files) {
            const want = list.get(f.rel);
            if (!want) errors.push(`sha256 の一覧に無いファイル: ${f.rel}`);
            else if (want !== sha(f.abs)) errors.push(`sha256 の一覧と中身が違う: ${f.rel}`);
            else same++;
        }
        for (const rel of list.keys()) if (!present.has(rel)) errors.push(`sha256 の一覧にあるのに無いファイル: ${rel}`);
        shaResult = { list: resolve(sha256), listed: list.size, same };
    }
    const art = files.filter((f) => f.rel.startsWith('art/'));
    for (const f of art) if (!ART_EXT.has(f.ext)) errors.push(`/art に画像でないファイル: ${f.rel}`);
    for (const f of files) if (UNSHIPPED_ART.test(f.rel)) errors.push(`公開しない素材（予約・未使用・素材パックそのもの）の名前のファイル: ${f.rel}`);
    const pack = packV2Hashes();
    if (!pack) warnings.push(`素材パック第 2 版の一覧の写しが無いので、パックのファイルそのものが入っていないかの確かめ（sha256）を飛ばした: ${PACK_V2_LIST}`);
    else
        for (const f of files) {
            const hit = pack.get(sha(f.abs));
            if (hit) errors.push(`素材パック第 2 版のファイルそのもの（${hit}）と同じ中身のファイル: ${f.rel}`);
        }
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
        refs,
        sha256: shaResult,
        limits: LIMITS,
        errors,
        warnings,
        /** 今の dist の sha256 の一覧（`sha256sum` の形。--write-sha256 で書く中身） */
        sha256List: () => files.map((f) => `${sha(f.abs)}  ./${f.rel}\n`).join(''),
    };
}

/**
 * 違反が無いときだけ、dist の sha256 の一覧を out に書く（dist の中には書かない）。書いたら true。
 * 既にある一覧は上書きしない（overwrite のときだけ）：ビルドの直後の一覧を、後で壊れた dist の一覧で上書きして「同じ」にしない。
 */
export function writeSha256List(result, out, { overwrite = false } = {}) {
    const dest = resolve(out);
    if (dest === result.dist || dest.startsWith(result.dist + sep)) throw new Error(`sha256 の一覧を dist の中には書かない: ${dest}`);
    if (!overwrite && existsSync(dest))
        throw new Error(`sha256 の一覧が既にあるので上書きしない（ビルドの直後の一覧を残す。作り直したビルドなら --overwrite-sha256）: ${dest}`);
    if (result.errors.length) return false;
    writeFileSync(dest, result.sha256List());
    return true;
}

function main(argv) {
    const args = [...argv];
    const opt = { baseline: null, budget: null, json: false, sha256: null, writeSha256: null, overwriteSha256: false };
    let dist = null;
    const value = (a) => {
        const v = args.shift();
        if (v === undefined || v.startsWith('--')) throw new Error(`${a} の後に値が要る`);
        return v;
    };
    while (args.length) {
        const a = args.shift();
        if (a === '--baseline') opt.baseline = value(a);
        else if (a === '--budget') opt.budget = Number(value(a));
        else if (a === '--json') opt.json = true;
        else if (a === '--sha256') opt.sha256 = value(a);
        else if (a === '--write-sha256') opt.writeSha256 = value(a);
        else if (a === '--overwrite-sha256') opt.overwriteSha256 = true;
        else if (a === '-h' || a === '--help') {
            console.log(
                'node proto3d/tools/check-dist.mjs [dist-proto3d] [--baseline <前回の dist>] [--budget <バイト>] [--json] [--sha256 <一覧>] [--write-sha256 <書く先> [--overwrite-sha256]]',
            );
            return 0;
        } else if (a.startsWith('--')) throw new Error(`知らないオプション: ${a}`);
        else dist = a;
    }
    if (opt.overwriteSha256 && !opt.writeSha256) throw new Error('--overwrite-sha256 は --write-sha256 と一緒に使う');
    const r = checkDist(dist ?? 'dist-proto3d', opt);
    const wrote = opt.writeSha256 ? writeSha256List(r, opt.writeSha256, { overwrite: opt.overwriteSha256 }) : null;
    if (opt.json) {
        console.log(JSON.stringify({ ...r, wroteSha256: wrote === null ? null : wrote ? resolve(opt.writeSha256) : false }, null, 2));
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
    console.log(
        `参照の先（dist の中にあるか）: HTML ${r.refs.html} 件・glTF ${r.refs.gltf} 件・JS ${r.refs.js} 件／中身と拡張子を照らしたファイル ${r.refs.content} 件`,
    );
    if (r.sha256) console.log(`sha256 の一覧 ${r.sha256.list}: ${r.sha256.listed} 件のうち ${r.sha256.same} 件が同じ中身`);
    if (wrote === true) console.log(`sha256 の一覧を書いた: ${resolve(opt.writeSha256)}`);
    if (wrote === false) console.log(`違反があるので sha256 の一覧は書かなかった: ${resolve(opt.writeSha256)}`);
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
