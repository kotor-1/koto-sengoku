// 確かめの画面写真を JPEG にする道具（proto3d/tools/shots-to-jpeg.mjs）の囲い（Version 27）。
// Version 26 の公開の前に、親の置き場の下の *.png をまとめて JPEG にした片付けが、同じ置き場の中の公開用の dist の PNG まで変えた
// （docs/build-image-safety.md）。この道具が、名指しした写真の置き場のすぐ下だけを変え、dist・素材・原画の置き場を断ることを確かめる。
import { afterAll, describe, expect, it } from 'vitest';
import { PNG, fs, makeTemp, node, path, repoPath, sameBytes, sh, sha256 } from './proto3d-tool-helpers';

const TOOL = repoPath('proto3d/tools/shots-to-jpeg.mjs');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = fs;
const { join } = path;
const hasGit = sh('git', ['--version']).status === 0;
const hasPillow = sh('python3', ['-I', '-c', 'import PIL']).status === 0;

const work = makeTemp('shots-to-jpeg-test-');
afterAll(() => rmSync(work, { recursive: true, force: true }));
let n = 0;

/** work/<番号>/<rel> に PNG を 2 枚置いた置き場を作る */
function shotsDir(rel: string, extra: Record<string, string | Uint8Array> = {}): string {
    const dir = join(work, String(++n), rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.png'), PNG);
    writeFileSync(join(dir, 'b.png'), PNG);
    for (const [k, v] of Object.entries(extra)) {
        mkdirSync(join(dir, k, '..'), { recursive: true });
        writeFileSync(join(dir, k), v);
    }
    return dir;
}

/** 置き場の下のすべてのファイルの名前と sha256（変わっていないことを確かめる） */
function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string, pre: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) walk(join(d, e.name), `${pre}${e.name}/`);
            else if (e.isFile()) out[`${pre}${e.name}`] = sha256(readFileSync(join(d, e.name)));
        }
    };
    walk(dir, '');
    return out;
}

function run(...args: string[]) {
    const r = node(TOOL, args);
    return { status: r.status, out: r.stdout + r.stderr };
}

describe('shots-to-jpeg：断る決まり', () => {
    it('既定は並べるだけで、何も変えない', () => {
        const dir = shotsDir('e2e-out/council/shots');
        const before = snapshot(dir);
        const r = run(dir);
        expect(r.status).toBe(0);
        expect(r.out).toContain('PNG 2 個');
        expect(r.out).toContain('並べただけ');
        expect(snapshot(dir)).toEqual(before);
    });

    it('写真の置き場の名前（shots・montage・prod-shots）でない置き場は断る（親の置き場をまとめて変えない）', () => {
        const dir = shotsDir('v26/final', { 'prod-shots/x.png': PNG });
        const before = snapshot(dir);
        const r = run(dir, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain('置き場の名前が');
        expect(snapshot(dir)).toEqual(before);
    });

    it.each([
        ['dist-431f5e2/shots'],
        ['v26/final/dist-proto3d/montage'],
        ['models/shots'],
        ['proto3d/public/art/shots'],
        ['proto3d/assets-src/art-v25/shots'],
        ['proto3d/dev-art/montage'],
        ['node_modules/pkg/prod-shots'],
    ])('パスに公開物・素材・原画の置き場の言葉を含む物は断る: %s', (rel) => {
        const dir = shotsDir(rel);
        const before = snapshot(dir);
        const r = run(dir, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toMatch(/断った: .*パスの「[^」]+」に (dist|models|public|assets-src|dev-art|node_modules) を含む/);
        expect(snapshot(dir)).toEqual(before);
    });

    it.each([['index.html'], ['dist-431f5e2.sha256'], ['hero.glb'], ['scene.gltf']])('置き場の中に %s があれば断る', (name) => {
        const dir = shotsDir('prod-shots', { [name]: 'x' });
        const before = snapshot(dir);
        const r = run(dir, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain(`置き場の中に ${name} がある`);
        expect(snapshot(dir)).toEqual(before);
    });

    it('下の階層には降りない（shots/sub の PNG は並べない）', () => {
        const dir = shotsDir('shots', { 'sub/deep.png': PNG });
        const r = run(dir);
        expect(r.status).toBe(0);
        expect(r.out).toContain('PNG 2 個');
        expect(r.out).not.toContain('deep.png');
    });

    it('--allow-name で名前を足せるが、断る言葉は外せない', () => {
        const ok = shotsDir('captures');
        expect(run(ok).status).toBe(2);
        expect(run(ok, '--allow-name', 'captures').status).toBe(0);
        const models = shotsDir('models');
        const r = run(models, '--allow-name', 'models', '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain('に models を含む');
    });

    it('シンボリックリンクの置き場は断る（名前が shots でも、先が dist かもしれない）', () => {
        const dist = shotsDir('dist-x', { 'index.html': '<!doctype html>' });
        const link = join(work, String(++n), 'shots');
        mkdirSync(join(link, '..'), { recursive: true });
        symlinkSync(dist, link);
        const before = snapshot(dist);
        const r = run(link, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain('シンボリックリンク');
        expect(snapshot(dist)).toEqual(before);
    });

    it('1 つでも断ったら、ほかの置き場も変えない', () => {
        const good = shotsDir('shots');
        const bad = shotsDir('models/shots');
        const before = [snapshot(good), snapshot(bad)];
        const r = run(good, bad, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain('何も変えていない');
        expect([snapshot(good), snapshot(bad)]).toEqual(before);
    });

    it.runIf(hasGit)('git で管理しているファイルがあれば断る', () => {
        const repo = join(work, String(++n), 'repo');
        const dir = join(repo, 'docs', 'shots');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'a.png'), PNG);
        expect(sh('git', ['init', '-q', repo]).status).toBe(0);
        expect(sh('git', ['-C', repo, 'add', 'docs/shots/a.png']).status).toBe(0);
        const before = snapshot(dir);
        const r = run(dir, '--apply');
        expect(r.status).toBe(2);
        expect(r.out).toContain('git で管理しているファイルがある（a.png）');
        expect(snapshot(dir)).toEqual(before);
    });

    it('中身が PNG でない .png・同じ名前の .jpg がある物は変えない', () => {
        const dir = shotsDir('shots', { 'c.png': 'not a png', 'a.jpg': 'x' });
        const r = run(dir);
        expect(r.status).toBe(0);
        expect(r.out).toContain('PNG 1 個');
        expect(r.out).toContain('c.png（中身が PNG ではない）');
        expect(r.out).toContain('a.png（同じ名前の .jpg が既にある）');
    });
});

describe('shots-to-jpeg：--apply で変える', () => {
    it.runIf(hasPillow)('写真の置き場のすぐ下の PNG を JPEG にし、PNG を消す（--keep-png なら残す）', () => {
        const dir = shotsDir('montage', { 'sub/deep.png': PNG });
        const r = run(dir, '--apply', '--quality', '80');
        expect(r.status).toBe(0);
        expect(r.out).toContain('2 個を JPEG にした（PNG は消した）');
        for (const s of ['a', 'b']) {
            expect(existsSync(join(dir, `${s}.png`))).toBe(false);
            const jpg = readFileSync(join(dir, `${s}.jpg`));
            expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        }
        expect(sameBytes(readFileSync(join(dir, 'sub/deep.png')), PNG)).toBe(true);
        const keep = shotsDir('prod-shots');
        expect(run(keep, '--apply', '--keep-png').status).toBe(0);
        expect(sameBytes(readFileSync(join(keep, 'a.png')), PNG)).toBe(true);
        expect(existsSync(join(keep, 'a.jpg'))).toBe(true);
    });
});
