/**
 * 生成イラスト素材（Version 22〜）の一覧と置き場と読み込みの口を、ブラウザなしで確かめる。
 * - proto3d/src/art/manifest.gen.json（ゲームが読む一覧）の形が正しく、載っているファイルが proto3d/public/ にあり、
 *   容量・sha256・WebP の寸法と透明の有無が記録どおりで、種類ごとの上限を守る。一覧に無いファイルが proto3d/public/art に無い。
 * - 正本の記録（proto3d/assets-src/art-v22/manifest.json）が素材の ID とそろい、加工版の記録が manifest.gen.json と一致する。
 * - 開発用の TEST の模様（proto3d/dev-art/manifest.json）も同じ形で、全部の ID がそろい、ファイルがある。
 * - ゲームのコード（proto3d/src）は、正本の記録も dev-art も import しない（プロンプトの記録や TEST の模様を本番に入れない）。
 * - 読み込みの口（registry）：旧表示（?art=old）・一覧に無い・読めない は null で、例外を投げず、同じ ID は 1 回だけ読む。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS, FACE_OF, FIELD_ART, PORTRAIT_OF } from '../proto3d/src/art/ids';
import { __setArtManifestForTest, artAvailable, artEntry, artMode, artUrl, loadArtBitmap, preloadArt, type ArtEntry } from '../proto3d/src/art/registry';

// テストは Node で動く。Node の型定義は入れていないので、使う関数だけ型を付ける
interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as {
    readFileSync(p: string): Uint8Array;
    existsSync(p: string): boolean;
    readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
};
const nodeCrypto = (await import(/* @vite-ignore */ 'node:' + 'crypto')) as unknown as {
    createHash(alg: string): { update(b: Uint8Array): { digest(enc: 'hex'): string } };
};

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname);
const PUBLIC = `${ROOT}proto3d/public/`;
const DEV_ART = `${ROOT}proto3d/dev-art/`;
const readText = (p: string) => new TextDecoder().decode(fs.readFileSync(p));
const readJson = (p: string) => JSON.parse(readText(p)) as unknown;
const sha256 = (b: Uint8Array) => nodeCrypto.createHash('sha256').update(b).digest('hex');

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir.replace(/\/$/, '')}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.isFile()) out.push(p);
    }
    return out;
}

type Kind = ArtEntry['kind'];
const ALL_IDS: string[] = Object.values(ART_IDS);
const ENTRY_KEYS = ['file', 'w', 'h', 'kind', 'bytes', 'sha256', 'meta'];
const KB = 1024;
/** 種類ごとの上限（art-build.py の作り方と同じ。docs/art-assets.md） */
const CAP: Record<Kind, number> = { portrait: 260 * KB, face: 30 * KB, background: 450 * KB, overlay: 220 * KB, texture: 320 * KB };
const DIR: Record<Kind, string> = { portrait: 'art/portraits/', face: 'art/faces/', background: 'art/story/', overlay: 'art/story/', texture: 'art/battle/' };
const HAS_ALPHA: Record<Kind, boolean> = { portrait: true, face: true, background: false, overlay: true, texture: false };

function kindOfId(id: string): Kind {
    if (id.startsWith('portrait.')) return 'portrait';
    if (id.startsWith('face.')) return 'face';
    if (id === 'bg.council.front') return 'overlay';
    if (id.startsWith('bg.')) return 'background';
    if (id.startsWith('tex.')) return 'texture';
    throw new Error(`知らない ID ${id}`);
}

function ascii(b: Uint8Array, at: number, n: number): string {
    return String.fromCharCode(...b.subarray(at, at + n));
}

/** WebP の見出しから寸法と透明の有無を読む（VP8X・VP8・VP8L） */
function webpInfo(b: Uint8Array): { w: number; h: number; alpha: boolean } | null {
    if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') {
        return { alpha: (b[20] & 0x10) !== 0, w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (chunk === 'VP8 ') {
        if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
        return { alpha: false, w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (chunk === 'VP8L') {
        if (b[20] !== 0x2f) return null;
        const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
        return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
    }
    return null;
}

/** manifest.gen.json と同じ形の一覧を確かめ、問題を文で返す（base はファイルの置き場） */
function problems(m: unknown, base: string): string[] {
    const out: string[] = [];
    const mm = m as { version?: unknown; assets?: unknown };
    if (mm.version !== 1) out.push(`version が 1 ではない: ${String(mm.version)}`);
    if (!mm.assets || typeof mm.assets !== 'object' || Array.isArray(mm.assets)) return [...out, 'assets がオブジェクトではない'];
    for (const [id, raw] of Object.entries(mm.assets as Record<string, unknown>)) {
        const e = raw as Record<string, unknown>;
        if (!ALL_IDS.includes(id)) {
            out.push(`${id}: ids.ts に無い ID`);
            continue;
        }
        const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k));
        if (extra.length) out.push(`${id}: 余計な項目 ${extra.join(',')}（ゲームの一覧は file・w・h・kind・bytes・sha256・meta だけ）`);
        const kind = kindOfId(id);
        if (e.kind !== kind) out.push(`${id}: kind が ${String(e.kind)}（${kind} のはず）`);
        const file = String(e.file);
        if (!/^art\/(portraits|faces|story|battle)\/[a-z0-9_]+\.webp$/.test(file) || !file.startsWith(DIR[kind])) out.push(`${id}: file の形が違う ${file}`);
        const w = e.w as number;
        const h = e.h as number;
        if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) out.push(`${id}: 寸法が正しくない ${w}×${h}`);
        if (kind === 'portrait' && (w > 1024 || h > 1536)) out.push(`${id}: 人物画は 1024×1536 以下 ${w}×${h}`);
        if (kind === 'face' && (w !== 256 || h !== 256)) out.push(`${id}: 顔は 256×256 ${w}×${h}`);
        if ((kind === 'background' || kind === 'overlay') && (w > 1536 || h > 1024)) out.push(`${id}: 背景は 1536×1024 以下 ${w}×${h}`);
        if (kind === 'texture' && (w !== h || w > 1024 || (w & (w - 1)) !== 0)) out.push(`${id}: 地面の素材は 1024 以下の 2 の累乗の正方形 ${w}×${h}`);
        const bytes = e.bytes as number;
        if (!Number.isInteger(bytes) || bytes <= 0) out.push(`${id}: bytes が正しくない`);
        else if (bytes > CAP[kind]) out.push(`${id}: ${bytes} バイトが上限 ${CAP[kind]} を超える`);
        if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) out.push(`${id}: sha256 の形が違う`);
        if (e.meta !== undefined) {
            const meta = e.meta as Record<string, unknown>;
            for (const [k, v] of Object.entries(meta)) if (typeof v !== 'number' && typeof v !== 'string') out.push(`${id}: meta.${k} が数か文字ではない`);
            for (const k of ['eyeY', 'faceX']) if (k in meta && !(typeof meta[k] === 'number' && (meta[k] as number) > 0 && (meta[k] as number) < 1)) out.push(`${id}: meta.${k} は 0〜1 の割合`);
        }
        if (kind === 'texture' && !(typeof (e.meta as Record<string, unknown> | undefined)?.tileMeters === 'number' && ((e.meta as Record<string, number>).tileMeters ?? 0) > 0)) {
            out.push(`${id}: 地面の素材には meta.tileMeters（1 枚が何 m 四方か）が要る`);
        }
        const p = base + file;
        if (!fs.existsSync(p)) {
            out.push(`${id}: ファイルが無い ${p}`);
            continue;
        }
        const b = fs.readFileSync(p);
        if (b.length !== bytes) out.push(`${id}: 容量 ${b.length} が記録 ${bytes} と違う`);
        if (sha256(b) !== e.sha256) out.push(`${id}: sha256 が記録と違う`);
        const info = webpInfo(b);
        if (!info) out.push(`${id}: WebP として読めない`);
        else {
            if (info.w !== w || info.h !== h) out.push(`${id}: WebP の寸法 ${info.w}×${info.h} が記録 ${w}×${h} と違う`);
            if (info.alpha !== HAS_ALPHA[kind]) out.push(`${id}: 透明の有無が ${info.alpha}（${kind} は ${HAS_ALPHA[kind]} のはず）`);
        }
    }
    return out;
}

const GEN_PATH = `${ROOT}proto3d/src/art/manifest.gen.json`;
const MASTER_PATH = `${ROOT}proto3d/assets-src/art-v22/manifest.json`;

describe('ゲームが読む一覧（manifest.gen.json）と公開の置き場', () => {
    const gen = readJson(GEN_PATH) as { version: number; assets: Record<string, ArtEntry> };

    it('形が正しく、載っているファイルが proto3d/public/ にあり、容量・sha256・寸法・透明・上限が記録どおり', () => {
        expect(problems(gen, PUBLIC)).toEqual([]);
    });

    it('一覧に無いファイルが proto3d/public/art に無い（加工版だけを公開する）', () => {
        const listed = new Set(Object.values(gen.assets).map((e) => PUBLIC + e.file));
        expect(walk(`${PUBLIC}art`).filter((p) => !listed.has(p))).toEqual([]);
    });

    it('公開の置き場に dev-art・原画の置き場・.glb 以外の禁止物を置かない', () => {
        const bad = walk(PUBLIC).filter((p) => /\/(dev-art|assets-src|incoming)\//.test(p.slice(PUBLIC.length - 1)) || /original\.(png|jpg)$/.test(p));
        expect(bad).toEqual([]);
    });
});

describe('正本の記録（proto3d/assets-src/art-v22/manifest.json）', () => {
    const master = readJson(MASTER_PATH) as {
        statusValues: Record<string, string>;
        assets: {
            id: string;
            kind: Kind;
            status: string;
            purpose: string;
            subject: string;
            incoming: string | null;
            derivedFrom: string | null;
            faceRect?: number[] | null;
            method: { how: string; promptRef: string | null; referenceImages: string[] | null };
            original: { path: string; sha256: string } | null;
            recipe: { publicFile: string; capBytes: number; mapType?: string; meta?: Record<string, number> };
            outputs: { path: string; w: number; h: number; bytes: number; sha256: string; decodedBytes: number; meta?: Record<string, number | string> }[];
            terms: { confirmedByUser: boolean | null; notes: string };
        }[];
    };
    const gen = readJson(GEN_PATH) as { assets: Record<string, ArtEntry> };

    it('素材の ID が ids.ts とそろい、種類・置き場・上限が決まりどおり', () => {
        expect(master.assets.map((a) => a.id).sort()).toEqual([...ALL_IDS].sort());
        for (const a of master.assets) {
            expect(a.kind, a.id).toBe(kindOfId(a.id));
            expect(a.recipe.publicFile.startsWith(DIR[a.kind]), a.id).toBe(true);
            expect(a.recipe.capBytes, a.id).toBe(CAP[a.kind]);
            expect(Object.keys(master.statusValues), a.id).toContain(a.status);
            expect(a.purpose.length > 0 && a.subject.length > 0 && a.method.how.length > 0, a.id).toBe(true);
            expect([null, true, false], a.id).toContain(a.terms.confirmedByUser);
            if (a.original) expect(a.original.path.startsWith('proto3d/assets-src/art-v22/'), a.id).toBe(true);
            if (a.kind === 'texture') {
                expect(a.recipe.mapType, a.id).toBe('albedo'); // 色の画像を法線・粗さとは称さない
                expect(a.recipe.meta?.tileMeters, a.id).toBeGreaterThan(0);
            }
        }
    });

    it('顔は人物画と同じ原画から切り出す（別に生成しない）。人物画・背景・地面は依頼リストのファイル名で受け取る', () => {
        for (const a of master.assets) {
            if (a.kind === 'face') {
                expect(a.derivedFrom, a.id).toBe(a.id.replace(/^face\./, 'portrait.'));
                expect(a.incoming, a.id).toBeNull();
                expect('faceRect' in a, a.id).toBe(true);
            } else {
                expect(a.derivedFrom, a.id).toBeNull();
            }
        }
        const names = master.assets.map((a) => a.incoming).filter((n): n is string => !!n).sort();
        expect(names).toEqual(
            ['bg_council.png', 'bg_council_front.png', 'portrait_ieyasu.png', 'portrait_tadakatsu.png', 'tex_plains_dirt.png', 'tex_plains_forest.png', 'tex_plains_road.png', 'tex_plains_grass.png'].sort(),
        );
        // 依頼リスト（利用者に送った物）にも同じ名前がある
        const req = readText(`${ROOT}docs/art-v22-asset-request.md`);
        for (const n of names) expect(req, n).toContain(n);
    });

    it('加工版の記録が manifest.gen.json と一致する（作った物だけが載り、載る物は全部記録がある）', () => {
        const built = master.assets.filter((a) => (a.status === 'built' || a.status === 'approved') && a.outputs.length > 0);
        expect(Object.keys(gen.assets).sort()).toEqual(built.map((a) => a.id).sort());
        for (const a of built) {
            const o = a.outputs[0];
            const e = gen.assets[a.id];
            expect({ file: e.file, w: e.w, h: e.h, bytes: e.bytes, sha256: e.sha256, kind: e.kind }, a.id).toEqual({
                file: a.recipe.publicFile,
                w: o.w,
                h: o.h,
                bytes: o.bytes,
                sha256: o.sha256,
                kind: a.kind,
            });
            expect(o.path, a.id).toBe(`proto3d/public/${a.recipe.publicFile}`);
            expect(o.decodedBytes, a.id).toBe(o.w * o.h * 4);
            if (a.kind === 'face') {
                const src = master.assets.find((s) => s.id === a.derivedFrom);
                expect(src?.original, a.id).toBeTruthy();
            } else {
                expect(a.original, a.id).toBeTruthy();
            }
        }
    });

    it('人が読む記録（docs/art-assets.md）に全部の素材が載る', () => {
        const doc = readText(`${ROOT}docs/art-assets.md`);
        for (const id of ALL_IDS) expect(doc, id).toContain(`\`${id}\``);
    });
});

describe('開発用の TEST の模様（proto3d/dev-art）', () => {
    const dev = readJson(`${DEV_ART}manifest.json`) as { version: number; assets: Record<string, ArtEntry> };

    it('manifest.gen.json と同じ形で、ファイルがあり、記録どおり', () => {
        expect(problems(dev, DEV_ART)).toEqual([]);
    });

    it('全部の ID がそろい（本物と同じ ID・種類）、file は本物と同じ置き場の名前', () => {
        expect(Object.keys(dev.assets).sort()).toEqual([...ALL_IDS].sort());
        const master = readJson(MASTER_PATH) as { assets: { id: string; recipe: { publicFile: string } }[] };
        for (const a of master.assets) expect(dev.assets[a.id].file, a.id).toBe(a.recipe.publicFile);
    });

    it('一覧に無いファイルを置かず、全体が小さい（約 600KB 以下）。TEST の物だと README に書いてある', () => {
        const listed = new Set(Object.values(dev.assets).map((e) => DEV_ART + e.file));
        expect(walk(`${DEV_ART}art`).filter((p) => !listed.has(p))).toEqual([]);
        const total = walk(DEV_ART).reduce((s, p) => s + fs.readFileSync(p).length, 0);
        expect(total).toBeLessThanOrEqual(600 * KB);
        expect(readText(`${DEV_ART}README.md`)).toMatch(/TEST FIXTURES ONLY/);
    });
});

describe('ゲームのコードは正本の記録も dev-art も読み込まない', () => {
    const files = walk(`${ROOT}proto3d/src`).filter((p) => /\.(ts|tsx|js|mjs|json|css|html)$/.test(p));
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

    it('import の先に assets-src・art-v22・dev-art が無い', () => {
        const bad: string[] = [];
        const re = /(?:import|export)\s[^'"`;]*?from\s*['"`]([^'"`]+)['"`]|import\s*\(\s*['"`]([^'"`]+)['"`]|import\s+['"`]([^'"`]+)['"`]|new\s+URL\(\s*['"`]([^'"`]+)['"`]/g;
        for (const p of files) {
            const s = stripComments(readText(p));
            for (const m of s.matchAll(re)) {
                const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
                if (/assets-src|art-v22|dev-art/.test(spec)) bad.push(`${p.slice(ROOT.length)}: ${spec}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('dev-art を読む口は registry.ts（開発時だけ）にしか無い。正本の記録の中身（プロンプトの参照）もコードに無い', () => {
        const bad: string[] = [];
        for (const p of files) {
            const s = stripComments(readText(p));
            if (!p.endsWith('/art/registry.ts') && /dev-art/.test(s)) bad.push(`${p.slice(ROOT.length)}: dev-art`);
            if (/promptRef|ChatGPT で利用者が生成|【画風】/.test(s)) bad.push(`${p.slice(ROOT.length)}: 正本の記録の中身`);
        }
        expect(bad).toEqual([]);
        // registry の dev-art の口は import.meta.env.DEV の中（本番のビルドで消える。check-dist.mjs が dist でも確かめる）
        const reg = readText(`${ROOT}proto3d/src/art/registry.ts`);
        expect(reg).toMatch(/import\.meta\.env\??\.DEV[\s\S]{0,120}artFixture/);
    });

    it('人物画・顔・地面の対応は ids.ts の ID だけを指す（ほかの武将にこの二人の顔を使わない）', () => {
        for (const v of [...Object.values(PORTRAIT_OF), ...Object.values(FACE_OF)]) expect(ALL_IDS).toContain(v);
        expect(Object.keys(FACE_OF).sort()).toEqual(['ieyasu', 'tadakatsu']);
        for (const f of Object.values(FIELD_ART)) for (const v of Object.values(f)) expect(kindOfId(v)).toBe('texture');
    });
});

describe('読み込みの口（registry）', () => {
    const entry: ArtEntry = { file: 'art/portraits/ieyasu.webp', w: 700, h: 1400, kind: 'portrait', bytes: 1000, sha256: 'a'.repeat(64) };
    const face: ArtEntry = { file: 'art/faces/ieyasu.webp', w: 256, h: 256, kind: 'face', bytes: 100, sha256: 'b'.repeat(64) };
    let fetchMock: ReturnType<typeof vi.fn>;
    let bitmapMock: ReturnType<typeof vi.fn>;
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        __setArtManifestForTest({ version: 1, assets: { [ART_IDS.portraitIeyasu]: entry, [ART_IDS.faceIeyasu]: face } });
        fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) }));
        bitmapMock = vi.fn(async () => ({ width: 700, height: 1400, close() {} }));
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('createImageBitmap', bitmapMock);
        vi.stubGlobal('location', { search: '', hash: '' });
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        __setArtManifestForTest(null);
    });

    it('旧表示（?art=old・#art=old）では一つも読まない（null）', async () => {
        for (const loc of [{ search: '?art=old', hash: '' }, { search: '', hash: '#art=old' }]) {
            vi.stubGlobal('location', loc);
            expect(artMode()).toBe('old');
            expect(artEntry(ART_IDS.portraitIeyasu)).toBeNull();
            expect(artAvailable(ART_IDS.portraitIeyasu)).toBe(false);
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('一覧に無い ID は null（読みに行かない）', async () => {
        expect(artEntry(ART_IDS.bgCouncil)).toBeNull();
        await expect(loadArtBitmap(ART_IDS.bgCouncil)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('読めない（通信の失敗・404・壊れた画像）は null で、例外を投げず、console.error を出さない', async () => {
        fetchMock.mockImplementationOnce(async () => {
            throw new Error('network');
        });
        await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
        __setArtManifestForTest({ version: 1, assets: { [ART_IDS.portraitIeyasu]: entry } });
        fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) }));
        await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
        __setArtManifestForTest({ version: 1, assets: { [ART_IDS.portraitIeyasu]: entry } });
        bitmapMock.mockImplementationOnce(async () => {
            throw new Error('decode');
        });
        await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
        expect(warn).toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('同じ ID は 1 回だけ読む（同じ約束を返す。先読みも重ねて読まない。失敗も読み直さない）', async () => {
        const a = loadArtBitmap(ART_IDS.portraitIeyasu);
        const b = loadArtBitmap(ART_IDS.portraitIeyasu);
        preloadArt(ART_IDS.portraitIeyasu, ART_IDS.portraitIeyasu);
        expect(a).toBe(b);
        const [x, y] = await Promise.all([a, b]);
        expect(x).not.toBeNull();
        expect(x).toBe(y);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('./art/portraits/ieyasu.webp');
        await loadArtBitmap(ART_IDS.faceIeyasu);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockImplementation(async () => {
            throw new Error('network');
        });
        __setArtManifestForTest({ version: 1, assets: { [ART_IDS.portraitIeyasu]: entry } });
        await loadArtBitmap(ART_IDS.portraitIeyasu);
        await loadArtBitmap(ART_IDS.portraitIeyasu);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('置き場はページからの相対（./art/…）。data: の URL は作らない', () => {
        expect(artUrl(entry)).toBe('./art/portraits/ieyasu.webp');
        expect(artUrl(entry).startsWith('data:')).toBe(false);
    });
});
