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

type Result = { status: number | null; json: { errors: string[]; warnings: string[]; refs: { html: number; gltf: number; js: number; content: number; voice?: number }; sha256: { listed: number; same: number } | null; wroteSha256: string | false | null }; stdout: string; stderr: string };

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

    it('既にある一覧は上書きしない（壊れた後に走らせ直しても、ビルドの直後の一覧が残り --sha256 で止まる）。--overwrite-sha256 のときだけ書き直す', () => {
        const root = fakeDist();
        const list = join(work, `keep-${n}.sha256`);
        expect(run(root, '--write-sha256', list).status).toBe(0);
        const first = readText(list);
        // 形式の正しいまま中身が変わる壊れ方（参照・先頭の印の確かめでは止まらない）
        writeFileSync(join(root, 'models/hero_v2-0.png'), new Uint8Array([...PNG, 1, 2, 3]));
        const again = run(root, '--write-sha256', list);
        expect(again.status).toBe(2);
        expect(again.stderr).toContain('既にあるので上書きしない');
        expect(readText(list)).toBe(first);
        const r = run(root, '--sha256', list);
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('sha256 の一覧と中身が違う: models/hero_v2-0.png');
        const over = run(root, '--write-sha256', list, '--overwrite-sha256');
        expect(over.status).toBe(0);
        expect(readText(list)).not.toBe(first);
        expect(run(root, '--overwrite-sha256').status).toBe(2);
    });
});

// ---- Version 28：台詞の音声ファイル（voice/<id>.mp3）の参照と中身。本番の e2e の簡易サーバーの音の種類 ----

/** 配信する本物の MP3（VOICEVOX で作った台詞。proto3d/public/voice/） */
const MP3 = fs.readFileSync(repoPath('proto3d/public/voice/ch1.oda_envoy.ask.mp3'));

/** 偽の dist に、一覧（バンドルに入った形）と音声ファイルを足す */
function voiceDist(files: Record<string, Uint8Array>, refs: string[] = Object.keys(files)): string {
    const root = fakeDist();
    const list = refs.map((f) => `{id:"x",file:"${f}",sec:2.184}`).join(',');
    writeFileSync(join(root, 'assets/voice-DDDD.js'), `const m={version:1,lines:[${list}]};export{m};\n`);
    for (const [rel, data] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), data);
    }
    return root;
}

describe('check-dist：台詞の音声ファイル（Version 28）', () => {
    it('一覧の音声ファイルが dist にあり MP3 として読めれば違反なし。台詞の id の oda_ は公開しない絵の名前と見なさない', () => {
        const r = run(voiceDist({ 'voice/ch1.oda_envoy.ask.mp3': MP3, 'voice/talk.hero.same_day.mp3': MP3 }));
        expect(r.json.errors).toEqual([]);
        expect(r.status).toBe(0);
        expect(r.json.refs.voice).toBe(2);
        expect(r.json.warnings.filter((w) => w.includes('voice/'))).toEqual([]);
    });
    it('一覧にあるのに dist に無い音声ファイルを止める', () => {
        const r = run(voiceDist({ 'voice/ch1.oda_envoy.ask.mp3': MP3 }, ['voice/ch1.oda_envoy.ask.mp3', 'voice/ch1.hero.gather.mp3']));
        expect(r.status).toBe(1);
        expect(r.json.errors).toEqual(['JS の中の台詞の音声ファイルの場所の先のファイルが無い: assets/voice-DDDD.js → voice/ch1.hero.gather.mp3（voice/ch1.hero.gather.mp3）']);
    });
    it('MP3 の名前で中身が違う・壊れた物（同期の印だけ合う・速さの値が使えない・ID3 の後にフレームが無い）を止める', () => {
        const bad = {
            'voice/a.mp3': JPEG,
            'voice/b.mp3': new Uint8Array([0xff, 0xf3, 0x00, 0x00, 0, 0, 0, 0]),
            'voice/c.mp3': new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0, 0x41, 0x42, 0x43, 0x44]),
            'voice/d.mp3': new Uint8Array(0),
        };
        const r = run(voiceDist(bad));
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('中身が拡張子と合わない: voice/a.mp3（.mp3 なのに中身は JPEG）');
        expect(r.json.errors).toContain('中身が拡張子と合わない: voice/b.mp3（.mp3 なのに MPEG の音として読めない（MPEG の速さの値が使えない値（0）））');
        expect(r.json.errors).toContain('中身が拡張子と合わない: voice/c.mp3（.mp3 なのに MPEG の音として読めない（MPEG のフレームの頭（同期の印）が無い（12 バイト目）））');
        expect(r.json.errors).toContain('中身が拡張子と合わない: voice/d.mp3（.mp3 なのに中身は 空（0 バイト））');
    });
    it('ID3 の札の後ろの正しいフレームは読める。JS から参照の無い音声ファイルは注意にする', () => {
        const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0, ...MP3]);
        const r = run(voiceDist({ 'voice/ch1.oda_envoy.ask.mp3': id3, 'voice/old.unused.mp3': MP3 }, ['voice/ch1.oda_envoy.ask.mp3']));
        expect(r.json.errors).toEqual([]);
        expect(r.json.warnings).toContain('JS から参照の無い台詞の音声ファイル: voice/old.unused.mp3');
    });
    it('音声ファイルの置き場の外の oda_ の名前のファイル（絵）は、今までどおり止める', () => {
        const r = run(voiceDist({ 'voice/ch1.oda_envoy.ask.mp3': MP3, 'art/portraits/oda_nobunaga.webp': WEBP }, ['voice/ch1.oda_envoy.ask.mp3']));
        expect(r.status).toBe(1);
        expect(r.json.errors).toContain('公開しない素材（予約・未使用・素材パックそのもの）の名前のファイル: art/portraits/oda_nobunaga.webp');
    });
});

describe('本番の e2e の簡易サーバー（e2e/lib.mjs の PROD_MIME）', () => {
    it('台詞の音声ファイルを音の種類で出す（.mp3 は audio/mpeg）。今までの種類は変えない', () => {
        const r = node('--input-type=module', ['-e', `import('${repoPath('e2e/lib.mjs')}').then((m) => console.log(JSON.stringify(m.PROD_MIME)))`]);
        expect(r.status).toBe(0);
        const mime = JSON.parse(r.stdout) as Record<string, string>;
        expect(mime['.mp3']).toBe('audio/mpeg');
        expect(mime['.ogg']).toBe('audio/ogg');
        expect(mime['.m4a']).toBe('audio/mp4');
        expect(mime['.wav']).toBe('audio/wav');
        expect(mime['.webp']).toBe('image/webp');
        expect(mime['.js']).toBe('text/javascript');
        expect(mime['.html']).toBe('text/html; charset=utf-8');
    });
});
