// 公開する dist の確かめ（proto3d/tools/check-dist.mjs）の Version 27 の追加：参照の先・中身と拡張子・sha256 の一覧。
// Version 26 の公開の前に、作業用の片付けの一括変換が dist の PNG 13 個を JPEG に変えて PNG を消した（docs/build-image-safety.md）。
// そのときの check-dist は「問題なし」だった。ここでは小さな偽の dist を作り、同じ壊れ方をさせて、check-dist が違反で止まることを確かめる。
// 道具はコマンドとして動かす（公開の手順で使うのと同じ入口・終わりの番号）。
import { afterAll, describe, expect, it } from 'vitest';
import { JPEG, PNG, WEBP, fs, makeTemp, node, path, readText, repoPath } from './proto3d-tool-helpers';

const TOOL = repoPath('proto3d/tools/check-dist.mjs');
const { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } = fs;
const { dirname, join } = path;

const work = makeTemp('check-dist-test-');
afterAll(() => rmSync(work, { recursive: true, force: true }));
let n = 0;

/** 本番の dist と同じ形の、小さな偽の dist（index.html・favicon.png・CSS・JS の塊・art の WebP・glTF と質感の PNG/JPEG） */
function fakeDist(): string {
    const root = join(work, `dist-${++n}`);
    const put = (rel: string, data: string | Uint8Array) => {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), data);
    };
    put(
        'index.html',
        [
            '<!doctype html><html lang="ja"><head>',
            '<link rel="icon" type="image/png" href="./favicon.png" />',
            '<link rel="stylesheet" href="./style.css" />',
            '<script type="module" crossorigin src="./assets/index-AAAA.js"></script>',
            '<link rel="modulepreload" crossorigin href="./assets/three-BBBB.js">',
            '<!-- <script src="./old-and-gone.js"></script> -->',
            '</head><body><a href="https://example.com/x.png">外</a><a href="#top">上</a></body></html>',
        ].join('\n'),
    );
    put('favicon.png', PNG);
    put('style.css', 'body{margin:0}\n');
    put('assets/index-AAAA.js', 'import{a}from"./three-BBBB.js";const f=()=>import("./practice-CCCC.js");const art={x:"art/faces/ieyasu_v2.webp"};export{f,art,a};\n');
    put('assets/three-BBBB.js', 'export const a=1;\n');
    put('assets/practice-CCCC.js', 'import{a}from"./three-BBBB.js";export const p=a;\n');
    put('art/faces/ieyasu_v2.webp', WEBP);
    put(
        'models/hero_v2.json',
        JSON.stringify({
            asset: { version: '2.0' },
            images: [{ uri: 'hero_v2-0.png' }, { uri: 'hero_v2-1.jpg' }],
            buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }],
        }),
    );
    put('models/hero_v2-0.png', PNG);
    put('models/hero_v2-1.jpg', JPEG);
    return root;
}

type Result = { status: number | null; json: { errors: string[]; warnings: string[]; refs: { html: number; gltf: number; js: number; content: number }; sha256: { listed: number; same: number } | null; wroteSha256: string | false | null }; stdout: string; stderr: string };

function run(dist: string, ...args: string[]): Result {
    const r = node(TOOL, [dist, '--json', ...args]);
    let json: Result['json'];
    try {
        json = JSON.parse(r.stdout);
    } catch {
        json = { errors: [], warnings: [], refs: { html: 0, gltf: 0, js: 0, content: 0 }, sha256: null, wroteSha256: null };
    }
    return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

/** Version 26 の事故と同じ：PNG を JPEG にして .jpg で書き、.png を消す */
function pngToJpegLikeTheIncident(root: string, rel: string) {
    writeFileSync(join(root, rel.replace(/\.png$/, '.jpg')), JPEG);
    unlinkSync(join(root, rel));
}

describe('check-dist：参照の先・中身と拡張子（Version 27）', () => {
    it('壊れていない偽の dist は違反なし。参照と中身を数えている', () => {
        const r = run(fakeDist());
        expect(r.json.errors).toEqual([]);
        expect(r.status).toBe(0);
        // HTML は favicon・CSS・JS・modulepreload の 4 件（外の URL・# だけ・コメントの中は数えない）
        expect(r.json.refs.html).toBe(4);
        // glTF は画像 2 件（data: のデータは数えない）
        expect(r.json.refs.gltf).toBe(2);
        // JS は塊の読み込み 3 件と art の場所 1 件
        expect(r.json.refs.js).toBe(4);
        // 偽の dist の 10 ファイルすべて（HTML・PNG 2・CSS・JS 3・WebP・glTF・JPEG）
        expect(r.json.refs.content).toBe(10);
    });

    it('Version 26 の事故と同じ壊れ方（favicon と質感の PNG を JPEG にして PNG を消す）を違反で止める', () => {
        const root = fakeDist();
        pngToJpegLikeTheIncident(root, 'favicon.png');
        pngToJpegLikeTheIncident(root, 'models/hero_v2-0.png');
        const r = run(root);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('HTML の参照の先のファイルが無い: index.html → ./favicon.png（favicon.png）');
        expect(r.json.errors).toContain('glTF の images[0] の uri の先のファイルが無い: models/hero_v2.json → hero_v2-0.png（models/hero_v2-0.png）');
        expect(r.json.errors).toHaveLength(2);
    });

    it('PNG の名前のまま中身を JPEG にした物・WebP の名前のまま PNG にした物を止める', () => {
        const root = fakeDist();
        writeFileSync(join(root, 'models/hero_v2-0.png'), JPEG);
        writeFileSync(join(root, 'art/faces/ieyasu_v2.webp'), PNG);
        const r = run(root);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('中身が拡張子と合わない: models/hero_v2-0.png（.png なのに中身は JPEG）');
        expect(r.json.errors).toContain('中身が拡張子と合わない: art/faces/ieyasu_v2.webp（.webp なのに中身は PNG）');
    });

    it('空のファイル・読めない JSON・文字でない JS を止める', () => {
        const root = fakeDist();
        writeFileSync(join(root, 'models/hero_v2-1.jpg'), new Uint8Array(0));
        writeFileSync(join(root, 'assets/practice-CCCC.js'), PNG);
        mkdirSync(join(root, 'data'));
        writeFileSync(join(root, 'data/table.json'), '{"a":');
        const r = run(root);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('中身が拡張子と合わない: models/hero_v2-1.jpg（.jpg なのに中身は 空（0 バイト））');
        expect(r.json.errors).toContain('中身が拡張子と合わない: assets/practice-CCCC.js（.js なのに UTF-8 の文字として読めない（中身は PNG））');
        expect(r.json.errors.some((e) => e.startsWith('中身が拡張子と合わない: data/table.json（.json なのに JSON として読めない'))).toBe(true);
    });

    it('JS の塊・art の素材が無いとき、dist の外を指すときを止める', () => {
        const root = fakeDist();
        unlinkSync(join(root, 'assets/practice-CCCC.js'));
        unlinkSync(join(root, 'art/faces/ieyasu_v2.webp'));
        writeFileSync(join(root, 'models/extra.json'), JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../../outside.bin', byteLength: 1 }] }));
        const r = run(root);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('JS の読み込みの先のファイルが無い: assets/index-AAAA.js → ./practice-CCCC.js（assets/practice-CCCC.js）');
        expect(r.json.errors).toContain('JS の中の素材の場所の先のファイルが無い: assets/index-AAAA.js → art/faces/ieyasu_v2.webp（art/faces/ieyasu_v2.webp）');
        expect(r.json.errors).toContain('glTF の buffers[0] の uri が dist の外を指す: models/extra.json → ../../outside.bin');
    });

    it('glTF の画像の mimeType と拡張子が合わなければ止める', () => {
        const root = fakeDist();
        writeFileSync(join(root, 'models/hero_v2.json'), JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'hero_v2-0.png', mimeType: 'image/jpeg' }] }));
        const r = run(root);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('glTF の images[0] の mimeType image/jpeg と拡張子が合わない: models/hero_v2.json → hero_v2-0.png');
    });
});

describe('check-dist：ビルドの直後の sha256 の一覧（--write-sha256・--sha256）', () => {
    it('違反の無い dist の一覧を書き、同じ dist はその一覧と照らして違反なし', () => {
        const root = fakeDist();
        const list = join(work, `list-${n}.sha256`);
        const w = run(root, '--write-sha256', list);
        expect(w.status).toBe(0);
        expect(w.json.wroteSha256).toBe(list);
        const lines = readText(list).trim().split('\n');
        expect(lines).toHaveLength(10);
        expect(lines.every((l) => /^[0-9a-f]{64} {2}\.\/\S+$/.test(l))).toBe(true);
        const r = run(root, '--sha256', list);
        expect(r.status).toBe(0);
        expect(r.json.sha256).toMatchObject({ listed: 10, same: 10 });
    });

    it('一覧の後で中身が変わった・消えた・増えたファイルを止める（形式の正しい画像に変わっても止める）', () => {
        const root = fakeDist();
        const list = join(work, `list-${n}.sha256`);
        expect(run(root, '--write-sha256', list).status).toBe(0);
        writeFileSync(join(root, 'favicon.png'), new Uint8Array([...PNG, 0]));
        pngToJpegLikeTheIncident(root, 'models/hero_v2-0.png');
        const r = run(root, '--sha256', list);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('sha256 の一覧と中身が違う: favicon.png');
        expect(r.json.errors).toContain('sha256 の一覧にあるのに無いファイル: models/hero_v2-0.png');
        expect(r.json.errors).toContain('sha256 の一覧に無いファイル: models/hero_v2-0.jpg');
    });

    it('違反のある dist の一覧は書かない。dist の中には書かない', () => {
        const root = fakeDist();
        pngToJpegLikeTheIncident(root, 'favicon.png');
        const list = join(work, `bad-${n}.sha256`);
        const r = run(root, '--write-sha256', list);
        expect(r.status).toBe(1);
        expect(r.json.wroteSha256).toBe(false);
        expect(existsSync(list)).toBe(false);
        const clean = fakeDist();
        const inside = run(clean, '--write-sha256', join(clean, 'list.sha256'));
        expect(inside.status).toBe(2);
        expect(inside.stderr).toContain('dist の中には書かない');
        expect(existsSync(join(clean, 'list.sha256'))).toBe(false);
    });
});
