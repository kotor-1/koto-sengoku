/**
 * 生成イラスト素材（Version 22〜）の一覧と置き場と読み込みの口を、ブラウザなしで確かめる。
 * - proto3d/src/art/manifest.gen.json（ゲームが読む一覧）の形が正しく、載っているファイルが proto3d/public/ にあり、
 *   容量・sha256・WebP の寸法と透明の有無が記録どおりで、種類ごとの上限を守る。一覧に無いファイルが proto3d/public/art に無い。
 * - 正本の記録（proto3d/assets-src/art-v22/manifest.json）が素材の ID とそろい、加工版の記録が manifest.gen.json と一致する。
 * - 開発用の TEST の模様（proto3d/dev-art/manifest.json）も同じ形で、全部の ID がそろい、ファイルがある。
 * - ゲームのコード（proto3d/src）は、正本の記録も dev-art も import しない（プロンプトの記録や TEST の模様を本番に入れない）。
 * - 読み込みの口（registry）：旧表示（?art=old）・一覧に無い・読めない は null で、例外を投げず、同じ ID を同時に重ねて読まない。
 * - 見せ方（Version 25）：既定・?art=v24（Version 24 と同じ素材：第 1 版の顔・地面。人物画・軍議の背景なし）・?art=old と、
 *   ?artOff=portrait,council,face（地面の grass・dirt・road・ground と並べて書ける）。URL だけで、保存には何も書かない。
 *   失敗は覚えたままにせず、前の失敗から 10 秒たった後の呼び出しで読み直す。時間切れ（30 秒）は通信の間だけ。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS, FACE_OF, FIELD_ART, PORTRAIT_OF, V24_FACE_OF } from '../proto3d/src/art/ids';
import { __setArtManifestForTest, artAvailable, artBlocked, artEntry, artMode, artOff, artUrl, faceArtIdOf, loadArtBitmap, preloadArt, type ArtEntry } from '../proto3d/src/art/registry';
import { fieldArtIds, fieldHasArt, groundArtOff } from '../proto3d/src/battle/groundArt';
import { artInUse } from '../proto3d/src/ui/artCanvas';

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
/** 透明の層の有無。顔は切り出した範囲が全部不透明なら透明の層の無い WebP になってよい（art-build.py はそのことを記録する） */
const HAS_ALPHA: Record<Kind, boolean | 'either'> = { portrait: true, face: 'either', background: false, overlay: true, texture: false };

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
        // 背景は画面の大きさ（1920×1080）までで、原画より大きくしない（拡大しない：正本の記録の原画の寸法と比べるのは下の正本のテスト）
        if ((kind === 'background' || kind === 'overlay') && (w > 1920 || h > 1080)) out.push(`${id}: 背景は 1920×1080 以下 ${w}×${h}`);
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
            if (HAS_ALPHA[kind] !== 'either' && info.alpha !== HAS_ALPHA[kind]) out.push(`${id}: 透明の有無が ${info.alpha}（${kind} は ${HAS_ALPHA[kind]} のはず）`);
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
            original: { path: string; sha256: string; w: number; h: number; inRepo?: boolean; receivedAs: string } | null;
            sourceOnly?: string | boolean;
            source?: string;
            pack?: { source: string; file: string; sha256: string; bytes: number; w: number; h: number; upstream?: { file: string; sha256: string; bytes: number } };
            processing?: { upscaled?: boolean };
            history?: { incoming: string | null }[];
            recipe: { publicFile: string; capBytes: number; mapType?: string; meta?: Record<string, number> };
            outputs: { path: string; w: number; h: number; bytes: number; sha256: string; decodedBytes: number; meta?: Record<string, number | string> }[];
            terms: { confirmedByUser: boolean | null; notes: string };
        }[];
    };
    const gen = readJson(GEN_PATH) as { assets: Record<string, ArtEntry> };

    it('素材の ID が ids.ts とそろい、種類・置き場・上限が決まりどおり', () => {
        // ids.ts に無いのは、原画の記録だけ（sourceOnly）の人物画だけ（加工版を作らず、ゲームからは引けない）：
        // Version 24 の顔の元（第 1 版の 6 人）と、会話・軍議で話さない榊原・長政の第 2 版（顔の元。立ち絵は公開しない。Version 25 の最後の見直し）
        expect(master.assets.filter((a) => !a.sourceOnly).map((a) => a.id).sort()).toEqual([...ALL_IDS].sort());
        const sourceOnly = master.assets.filter((a) => a.sourceOnly);
        expect(sourceOnly.map((a) => a.id).sort()).toEqual(
            [...['ieyasu', 'ishikawa', 'nagamasa', 'sakai', 'sakakibara', 'tadakatsu'].map((g) => `portrait.pack1.${g}`), 'portrait.nagamasa', 'portrait.sakakibara'].sort(),
        );
        for (const a of sourceOnly) {
            expect(ALL_IDS, a.id).not.toContain(a.id);
            expect(a.kind, a.id).toBe('portrait');
            expect(a.outputs, a.id).toEqual([]);
            expect(gen.assets[a.id], a.id).toBeUndefined();
            // その原画から切り出した顔（face.pack1.*・face.sakakibara・face.nagamasa）が ids.ts にある
            expect(master.assets.some((f) => f.derivedFrom === a.id && ALL_IDS.includes(f.id)), a.id).toBe(true);
        }
        for (const a of master.assets) {
            expect(a.kind, a.id).toBe(kindOfId(a.id));
            expect(a.recipe.publicFile.startsWith(DIR[a.kind]), a.id).toBe(true);
            expect(a.recipe.capBytes, a.id).toBe(CAP[a.kind]);
            expect(Object.keys(master.statusValues), a.id).toContain(a.status);
            expect(a.purpose.length > 0 && a.subject.length > 0 && a.method.how.length > 0, a.id).toBe(true);
            expect([null, true, false], a.id).toContain(a.terms.confirmedByUser);
            if (a.original && a.original.inRepo === false) {
                // 素材パック第 2 版の原画は公開リポジトリに入れない（手元の置き場は .gitignore）
                expect(a.original.path.startsWith('proto3d/assets-src/art-v25/originals/'), a.id).toBe(true);
                expect(a.pack, a.id).toBeTruthy();
            } else if (a.original) expect(a.original.path.startsWith('proto3d/assets-src/art-v22/'), a.id).toBe(true);
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
        // 依頼リスト（利用者に送った物）の 8 枚のうち 7 枚と、素材パック sengoku_art_pack_v1 で届いた武将 4 人の人物画。
        // 軍議の背景（bg_council.png）は届かないまま、Version 25 で素材パック第 2 版の council_day に切り替えた（記録の history に残す）
        const requested = ['bg_council_front.png', 'portrait_ieyasu.png', 'portrait_tadakatsu.png', 'tex_plains_dirt.png', 'tex_plains_forest.png', 'tex_plains_road.png', 'tex_plains_grass.png'];
        const bg = master.assets.find((a) => a.id === 'bg.council');
        expect(bg?.incoming).toBeNull();
        expect(bg?.history?.map((h) => h.incoming)).toEqual(['bg_council.png']);
        expect(readText(`${ROOT}docs/art-v22-asset-request.md`)).toContain('bg_council.png');
        const fromPack = ['portrait_ishikawa.png', 'portrait_nagamasa.png', 'portrait_sakai.png', 'portrait_sakakibara.png'];
        expect(names).toEqual([...requested, ...fromPack].sort());
        const req = readText(`${ROOT}docs/art-v22-asset-request.md`);
        for (const n of requested) expect(req, n).toContain(n);
        // パックの記録（保管した docs/portraits.json）に、同じ人物の人物画がある
        const pack = JSON.parse(readText(`${ROOT}proto3d/assets-src/art-v22/pack-v1/docs/portraits.json`)) as { game_id: string; portrait: string }[];
        for (const n of fromPack) {
            const g = n.replace(/^portrait_|\.png$/g, '');
            expect(pack.find((p) => p.game_id === g)?.portrait, n).toBe(`portraits/${n}`);
        }
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
                // 顔は原画から縮めるだけ（拡大しない）。Version 24 の顔（face.pack1.*）は、Version 22 で低解像度の原画から作った物
                // （一部は拡大：記録の processing.upscaled）を、比べる表示のために中身を変えずに残している
                if (!a.id.startsWith('face.pack1.')) expect(a.processing?.upscaled, a.id).toBe(false);
            } else {
                expect(a.original, a.id).toBeTruthy();
                // 拡大しない：加工版は原画の寸法以下
                expect(o.w <= (a.original?.w ?? 0) && o.h <= (a.original?.h ?? 0), `${a.id} ${o.w}×${o.h}`).toBe(true);
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
        const master = readJson(MASTER_PATH) as { assets: { id: string; sourceOnly?: unknown; recipe: { publicFile: string } }[] };
        for (const a of master.assets) if (!a.sourceOnly) expect(dev.assets[a.id].file, a.id).toBe(a.recipe.publicFile);
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

    it('人物画・顔・地面の対応は ids.ts の ID だけを指す（武将ごとに自分の顔。ほかの人の顔を代わりに使わない）', () => {
        for (const v of [...Object.values(PORTRAIT_OF), ...Object.values(FACE_OF)]) expect(ALL_IDS).toContain(v);
        // 画面に出る 6 人だけ（素材パックの信長・義景は画面に出ないので対応させない：予約）
        expect(Object.keys(FACE_OF).sort()).toEqual(['ieyasu', 'ishikawa', 'nagamasa', 'sakai', 'sakakibara', 'tadakatsu']);
        // 人物画は会話・軍議で話す 4 人だけ（榊原・長政は話さないので公開しない：必要な画像だけ）
        expect(Object.keys(PORTRAIT_OF).sort()).toEqual(['ieyasu', 'ishikawa', 'sakai', 'tadakatsu']);
        // Version 24 の顔（比べる表示だけ）：同じ 6 人・face.pack1.<武将>
        expect(Object.keys(V24_FACE_OF).sort()).toEqual(Object.keys(FACE_OF).sort());
        for (const [g, v] of Object.entries(V24_FACE_OF)) expect(v).toBe(`face.pack1.${g}`);
        // 武将 id と素材の ID の名前が一致する（酒井・本多・榊原を取り違えない）
        for (const [g, v] of Object.entries(FACE_OF)) expect(v).toBe(`face.${g}`);
        for (const [g, v] of Object.entries(PORTRAIT_OF)) expect(v).toBe(`portrait.${g}`);
        expect(new Set(Object.values(FACE_OF)).size).toBe(Object.keys(FACE_OF).length);
        for (const f of Object.values(FIELD_ART)) for (const v of Object.values(f)) expect(kindOfId(v)).toBe('texture');
    });
});

describe('素材パック第 2 版（sengoku_individual_art_v2。Version 25）と Version 24 の顔', () => {
    const master = readJson(MASTER_PATH) as {
        sources: Record<string, { packId?: string; originalsInRepo?: boolean; textFiles?: { path: string; sha256: string; bytes: number }[]; reserved?: string[]; unused?: string[]; zipParts?: { name: string; sha256: string }[] }>;
        assets: { id: string; kind: Kind; status: string; source?: string; pack?: { source: string; file: string; sha256: string; bytes: number; w: number; h: number; upstream?: { file: string; sha256: string; bytes: number } }; original: { path: string; sha256: string; inRepo?: boolean } | null; outputs: { sha256: string }[]; faceRect?: number[] | null; derivedFrom: string | null }[];
    };
    const gen = readJson(GEN_PATH) as { assets: Record<string, ArtEntry> };
    const PACK_DOCS = `${ROOT}proto3d/assets-src/art-v25/pack-v2/`;
    const packList = readJson(`${PACK_DOCS}asset_manifest.json`) as { pack_id: string; assets: { path: string; sha256: string; bytes: number; width: number; height: number }[] };
    const chars = readJson(`${PACK_DOCS}characters_and_scenes.json`) as { key: string; display_name: string; face_crop_xyxy?: number[] }[];
    /** 表示名で武将 id に対応させる（パックの key と武将 id を同じとみなさない） */
    const NAME_OF: Record<string, string> = { ieyasu: '徳川家康', tadakatsu: '本多忠勝', sakai: '酒井忠次', ishikawa: '石川数正', sakakibara: '榊原康政', nagamasa: '浅井長政' };

    it('人物画 6 枚と軍議の背景は、パックの一覧（写し）の sha256・寸法と一致するファイルから受け取り、元の生成結果も一覧にある', () => {
        const src = master.sources['pack-v2'];
        expect(src.packId).toBe(packList.pack_id);
        expect(src.originalsInRepo).toBe(false);
        expect(src.zipParts?.map((z) => z.name)).toEqual(['sengoku_art_v2_under30MB_1_of_3.zip', 'sengoku_art_v2_under30MB_2_of_3.zip', 'sengoku_art_v2_under30MB_3_of_3.zip']);
        const fromPack = master.assets.filter((a) => a.pack);
        expect(fromPack.map((a) => a.id).sort()).toEqual(['bg.council', ...Object.keys(NAME_OF).map((g) => `portrait.${g}`)].sort());
        for (const a of fromPack) {
            const pk = a.pack!;
            const e = packList.assets.find((x) => x.path === pk.file);
            expect(e, a.id).toBeTruthy();
            expect([e?.sha256, e?.bytes, e?.width, e?.height], a.id).toEqual([pk.sha256, pk.bytes, pk.w, pk.h]);
            const u = packList.assets.find((x) => x.path === pk.upstream?.file);
            expect(u?.sha256, a.id).toBe(pk.upstream?.sha256);
            expect(a.original?.sha256, a.id).toBe(pk.sha256);
            expect(a.original?.inRepo, a.id).toBe(false);
        }
    });

    it('武将とパックの人物の対応は表示名どおり。顔の範囲はパックの face_crop_xyxy と同じ', () => {
        for (const [g, name] of Object.entries(NAME_OF)) {
            const p = master.assets.find((a) => a.id === `portrait.${g}`)!;
            const c = chars.find((x) => x.display_name === name);
            expect(c, g).toBeTruthy();
            expect(p.pack?.file, g).toBe(`portraits/${c?.key}.png`);
            const f = master.assets.find((a) => a.id === `face.${g}`)!;
            const [x0, y0, x1, y1] = c?.face_crop_xyxy ?? [];
            expect(f.faceRect, g).toEqual([x0, y0, x1 - x0, y1 - y0]);
            expect(f.derivedFrom, g).toBe(`portrait.${g}`);
        }
        const bg = master.assets.find((a) => a.id === 'bg.council')!;
        expect(bg.pack?.file).toBe('backgrounds/council_day.png');
    });

    it('公開するのは人物画 4（話す人）・顔 6（新）・軍議の背景 1・地面 3・Version 24 の顔 6 だけ。榊原・長政の立ち絵・信長・義景・ほかの背景・林床・原画は公開しない', () => {
        const files = Object.values(gen.assets).map((e) => e.file).sort();
        const talkers = ['ieyasu', 'tadakatsu', 'sakai', 'ishikawa'];
        const want = [
            ...talkers.map((g) => `art/portraits/${g}_v2.webp`),
            ...Object.keys(NAME_OF).flatMap((g) => [`art/faces/${g}_v2.webp`, `art/faces/${g}.webp`]),
            'art/story/council_day.webp',
            'art/battle/plains_grass.webp',
            'art/battle/plains_dirt.webp',
            'art/battle/plains_road.webp',
        ].sort();
        expect(files).toEqual(want);
        const all = walk(PUBLIC).map((p) => p.slice(PUBLIC.length));
        expect(all.filter((p) => /nobunaga|yoshikage|oda_|asakura|castle_town|plains_vista|forest_floor|sengoku_individual/i.test(p))).toEqual([]);
        expect(all.filter((p) => p.startsWith('art/') && !p.endsWith('.webp'))).toEqual([]);
        // 話さない 2 人の立ち絵は、公開の置き場にも一覧にも無い（顔だけ）
        expect(all.filter((p) => /portraits\/(sakakibara|nagamasa)/.test(p))).toEqual([]);
        expect(gen.assets['portrait.sakakibara']).toBeUndefined();
        expect(gen.assets['portrait.nagamasa']).toBeUndefined();
        const src = master.sources['pack-v2'];
        expect((src.reserved ?? []).join()).toMatch(/織田信長.*朝倉義景/);
        expect((src.unused ?? []).join()).toMatch(/castle_town_day[\s\S]*plains_vista_day[\s\S]*forest_floor/);
    });

    it('リポジトリの assets-src/art-v25 には画像を置かない（原画は .gitignore の手元の置き場だけ）。写した文書は記録の sha256 と一致', () => {
        const ignore = readText(`${ROOT}.gitignore`);
        expect(ignore).toMatch(/^proto3d\/assets-src\/art-v25\/originals\/$/m);
        const files = walk(`${ROOT}proto3d/assets-src/art-v25`).map((p) => p.slice(ROOT.length));
        expect(files.filter((p) => /\.(png|jpe?g|webp)$/i.test(p) && !p.startsWith('proto3d/assets-src/art-v25/originals/'))).toEqual([]);
        const docs = files.filter((p) => p.startsWith('proto3d/assets-src/art-v25/pack-v2/')).map((p) => p.slice('proto3d/assets-src/art-v25/pack-v2/'.length)).sort();
        expect(docs).toEqual(['asset_manifest.json', 'characters_and_scenes.json', 'docs/PROVENANCE_AND_USAGE.md', 'docs/image_validation.json']);
        for (const d of docs) {
            const rec = master.sources['pack-v2'].textFiles?.find((t) => t.path === d);
            const b = fs.readFileSync(`${PACK_DOCS}${d}`);
            expect([b.length, sha256(b)], d).toEqual([rec?.bytes, rec?.sha256]);
        }
    });

    it('Version 24 の顔（face.pack1.*）は Version 24 と同じファイル・同じ中身で残す（比べる表示が Version 24 を再現できる）', () => {
        // Version 24（修正 70f9207）の manifest.gen.json の face.<武将> の sha256
        const V24: Record<string, string> = {
            ieyasu: 'ca0d186e84412692d0374a54f493d897c2f2d12b2c645f6d9a26a487b9dc0cce',
            tadakatsu: 'b4e754ae51888928a062975406aec932cc8820f97516c7dae1a9443da6c1034c',
            sakai: '9575e69559c1985b111597c61973b6f112b7f98e9c46942f968b0304cc7e96be',
            ishikawa: '4f9a154cb0d1db076887cfbb9eef24672ac8c3eb69773766f1cedbe987228d6e',
            sakakibara: 'acded0f8d4c907cce623a0efe882804fed749bd3aa718d88f67a2594407ec37e',
            nagamasa: '1e51b6b29b7cb3bfe113f644bd98cd39268f04a33563a94253edb514940f0eac',
        };
        for (const [g, sha] of Object.entries(V24)) {
            const id = V24_FACE_OF[g as keyof typeof V24_FACE_OF]!;
            expect(gen.assets[id]?.file, g).toBe(`art/faces/${g}.webp`);
            expect(gen.assets[id]?.sha256, g).toBe(sha);
            expect(sha256(fs.readFileSync(`${PUBLIC}art/faces/${g}.webp`)), g).toBe(sha);
            // 新しい顔は別のファイル（同じ URL で中身を替えない：古い控えが出ないように）・別の中身
            const now = gen.assets[FACE_OF[g as keyof typeof FACE_OF]!];
            expect(now.file, g).toBe(`art/faces/${g}_v2.webp`);
            expect(now.sha256, g).not.toBe(sha);
        }
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

    it('同じ ID は 1 回だけ読む（同じ約束を返す。先読みも重ねて読まない。失敗の直後は読み直さない）', async () => {
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

    describe('失敗の後の読み直しと時間切れ（時計を進める）', () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('失敗はずっと覚えない：10 秒のうちは読みに行かず null、10 秒たった後の呼び出しで読み直し、読めたらその後は読まない', async () => {
            fetchMock.mockImplementationOnce(async () => {
                throw new Error('network');
            });
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(9900);
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
            preloadArt(ART_IDS.portraitIeyasu);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(100);
            // 読み直しの間も同じ ID を同時に重ねて読まない
            const a = loadArtBitmap(ART_IDS.portraitIeyasu);
            const b = loadArtBitmap(ART_IDS.portraitIeyasu);
            expect(a).toBe(b);
            const x = await a;
            expect(x).not.toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(60000);
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBe(x);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(error).not.toHaveBeenCalled();
        });

        it('何度失敗しても警告は ID ごとに 1 回。読み直しは 10 秒に 1 回まで', async () => {
            fetchMock.mockImplementation(async () => ({ ok: false, status: 503, blob: async () => new Blob([]) }));
            for (let i = 0; i < 5; i++) {
                await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
                await vi.advanceTimersByTimeAsync(4000);
            }
            // 0 秒・12 秒（10 秒を過ぎた最初の呼び出し）に読み、ほかは待つ
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(error).not.toHaveBeenCalled();
        });

        it('時間切れは通信だけ（30 秒）：返事の無い通信は 30 秒で止めて null、その後は読み直せる', async () => {
            let signal: AbortSignal | undefined;
            fetchMock.mockImplementationOnce(
                (_url: string, init?: { signal?: AbortSignal }) =>
                    new Promise((_res, rej) => {
                        signal = init?.signal;
                        signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
                    }),
            );
            let done: ImageBitmap | null | 'pending' = 'pending';
            void loadArtBitmap(ART_IDS.portraitIeyasu).then((b) => (done = b));
            await vi.advanceTimersByTimeAsync(29000);
            expect(done).toBe('pending');
            expect(signal?.aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(1000);
            expect(signal?.aborted).toBe(true);
            expect(done).toBeNull();
            await vi.advanceTimersByTimeAsync(10000);
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.not.toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('画像の展開（createImageBitmap）が遅くても時間切れにしない（時計は通信の後で止める）', async () => {
            const bmp = { width: 700, height: 1400, close() {} };
            bitmapMock.mockImplementationOnce(() => new Promise((res) => setTimeout(() => res(bmp), 45000)));
            let signal: AbortSignal | undefined;
            fetchMock.mockImplementationOnce(async (_url: string, init?: { signal?: AbortSignal }) => {
                signal = init?.signal;
                return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1])]) };
            });
            const p = loadArtBitmap(ART_IDS.portraitIeyasu);
            await vi.advanceTimersByTimeAsync(45000);
            await expect(p).resolves.toBe(bmp);
            expect(signal?.aborted).toBe(false);
            expect(warn).not.toHaveBeenCalled();
        });

        it('旧表示では失敗の後も読みに行かない', async () => {
            fetchMock.mockImplementationOnce(async () => {
                throw new Error('network');
            });
            await loadArtBitmap(ART_IDS.portraitIeyasu);
            vi.stubGlobal('location', { search: '?art=old', hash: '' });
            await vi.advanceTimersByTimeAsync(20000);
            await expect(loadArtBitmap(ART_IDS.portraitIeyasu)).resolves.toBeNull();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    it('置き場はページからの相対（./art/…）。data: の URL は作らない', () => {
        expect(artUrl(entry)).toBe('./art/portraits/ieyasu.webp');
        expect(artUrl(entry).startsWith('data:')).toBe(false);
    });
});

describe('見せ方（Version 25）：既定・?art=v24・?art=old・?artOff=（本物の一覧で）', () => {
    const GENERALS = ['ieyasu', 'tadakatsu', 'sakai', 'ishikawa', 'sakakibara', 'nagamasa'] as const;
    const at = (search: string, hash = '') => vi.stubGlobal('location', { search, hash });
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        __setArtManifestForTest(null);
        fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1])]) }));
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 256, height: 256, close() {} })));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        __setArtManifestForTest(null);
    });

    it('既定：第 2 版の人物画 4（話す人）・顔 6・軍議の背景・地面を使い、Version 24 の顔（face.pack1.*）は使わない', () => {
        at('');
        expect(artMode()).toBe('new');
        for (const g of GENERALS) {
            // 人物画は話す 4 人だけ（榊原・長政は対応も無い：ほかの人の絵を代わりに出さない）
            if (g === 'sakakibara' || g === 'nagamasa') expect(PORTRAIT_OF[g], g).toBeUndefined();
            else expect(artAvailable(PORTRAIT_OF[g]!), g).toBe(true);
            expect(faceArtIdOf(g), g).toBe(FACE_OF[g]);
            expect(artAvailable(FACE_OF[g]!), g).toBe(true);
            expect(artAvailable(V24_FACE_OF[g]!), g).toBe(false);
        }
        expect(artAvailable(ART_IDS.bgCouncil)).toBe(true);
        // 届いていない手前の幕・不採用の林床は一覧に無い
        expect(artAvailable(ART_IDS.bgCouncilFront)).toBe(false);
        expect(artAvailable(ART_IDS.plainsForest)).toBe(false);
        expect(fieldHasArt('plains')).toBe(true);
        expect(Object.keys(fieldArtIds('plains')).sort()).toEqual(['dirt', 'grass', 'road']);
        // 顔の無い武将・知らない id は null（ほかの人の顔を代わりに使わない）
        for (const g of ['nobunaga', 'yoshikage', 'oda', 'archer', '', null, undefined]) expect(faceArtIdOf(g as string)).toBeNull();
        // 組み込みの名前（constructor・toString・__proto__ など）でも、関数を素材の ID と取り違えず null（例外も出さない）
        for (const g of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) expect(faceArtIdOf(g), g).toBeNull();
        expect(artInUse()).toBe(true);
    });

    it('?art=v24（#art=v24）：Version 24 と同じ素材だけ（第 1 版の顔・地面）。人物画・軍議の背景・第 2 版の顔は使わない（読みにも行かない）', async () => {
        for (const [q, h] of [
            ['?art=v24', ''],
            ['', '#art=v24'],
        ] as const) {
            at(q, h);
            expect(artMode()).toBe('v24');
            for (const g of GENERALS) {
                expect(artEntry(PORTRAIT_OF[g]!), g).toBeNull();
                expect(artEntry(FACE_OF[g]!), g).toBeNull();
                expect(faceArtIdOf(g), g).toBe(V24_FACE_OF[g]);
                expect(artEntry(V24_FACE_OF[g]!)?.file, g).toBe(`art/faces/${g}.webp`);
            }
            expect(artEntry(ART_IDS.bgCouncil)).toBeNull();
            expect(fieldHasArt('plains')).toBe(true);
            expect(Object.keys(fieldArtIds('plains')).sort()).toEqual(['dirt', 'grass', 'road']);
            expect(artInUse()).toBe(true);
            await expect(loadArtBitmap(ART_IDS.portraitTadakatsu)).resolves.toBeNull();
            await expect(loadArtBitmap(ART_IDS.bgCouncil)).resolves.toBeNull();
            await expect(loadArtBitmap(ART_IDS.faceSakai)).resolves.toBeNull();
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('?art=old：何も使わない（顔も地面も無い）', () => {
        at('?art=old');
        expect(artMode()).toBe('old');
        for (const g of GENERALS) {
            expect(faceArtIdOf(g)).toBeNull();
            expect(artEntry(V24_FACE_OF[g]!)).toBeNull();
        }
        expect(fieldHasArt('plains')).toBe(false);
        expect(artInUse()).toBe(false);
    });

    it('?artOff=portrait,council,face：種類ごとに外す。地面の語と並べて書ける（地面は groundArt が読む）。知らない語は無視', () => {
        at('?artOff=portrait');
        expect([...artOff()]).toEqual(['portrait']);
        expect(artEntry(ART_IDS.portraitIeyasu)).toBeNull();
        expect(artEntry(ART_IDS.faceIeyasu)).not.toBeNull();
        expect(artEntry(ART_IDS.bgCouncil)).not.toBeNull();
        at('?artOff=council,road');
        expect(artEntry(ART_IDS.bgCouncil)).toBeNull();
        expect(artEntry(ART_IDS.portraitIeyasu)).not.toBeNull();
        expect([...groundArtOff()]).toEqual(['road']);
        expect(Object.keys(fieldArtIds('plains')).sort()).toEqual(['dirt', 'grass']);
        at('?artOff=Face ground xyz');
        expect([...artOff()]).toEqual(['face']);
        for (const g of GENERALS) {
            expect(faceArtIdOf(g)).toBeNull();
            expect(artEntry(FACE_OF[g]!)).toBeNull();
        }
        expect(fieldHasArt('plains')).toBe(true);
        expect(fieldArtIds('plains')).toEqual({});
        // Version 24 の見せ方でも顔を外せる
        at('?art=v24&artOff=face');
        for (const g of GENERALS) expect(faceArtIdOf(g)).toBeNull();
        // 全部外す：人物画・背景・顔・地面のどれも使わない
        at('?artOff=portrait,council,face,ground');
        expect(Object.values(ART_IDS).filter((id) => artAvailable(id))).toEqual([]);
        expect(artInUse()).toBe(false);
        // 地面の語だけなら、人物画・背景・顔はそのまま
        at('?artOff=grass,dirt');
        expect(artOff().size).toBe(0);
        expect(artBlocked(ART_IDS.portraitIeyasu)).toBe(false);
    });

    it('URL を読むだけで、保存（localStorage）には何も書かない', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        });
        for (const q of ['?art=v24', '?art=old', '?artOff=portrait,council,face', '']) {
            at(q);
            artMode();
            artOff();
            for (const id of Object.values(ART_IDS)) artEntry(id);
            for (const g of GENERALS) faceArtIdOf(g);
        }
        expect(store.size).toBe(0);
    });
});
