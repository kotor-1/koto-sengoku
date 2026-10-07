/**
 * 生成イラスト素材（Version 22）を読む口。ゲームの画面はここだけを通して画像を読む。
 *
 * - 一覧は manifest.gen.json（proto3d/tools/art-build.py が作る。原画の一覧・プロンプトは入れない）。
 *   一覧に無い ID は「無い」として扱い、画面は今までの見た目のまま（Version 21 と同じ）。
 * - 旧表示との比較：URL に ?art=old（または #art=old）を付けると、新しい素材を一つも読まない（保存には何も書かない）。
 * - 読み方：fetch → Blob → createImageBitmap。モデルの画像と同じ道（connect-src 'self'）で、<img> の img-src に頼らない。
 *   data: の URL は使わない（CSP で止まる）。読めない・時間切れ・壊れた画像は null を返し、呼んだ側は今までの表示のまま進める。
 * - 開発時だけ：?artFixture=1 で proto3d/dev-art/manifest.json（確かめ用の仮の画像。本番のビルドに入らない）に差し替える。
 *   仮の画像は配置と動作の確かめ用で、見た目の素材ではない。
 */
import generated from './manifest.gen.json';
import type { ArtId } from './ids';

export type ArtKind = 'portrait' | 'face' | 'background' | 'overlay' | 'texture';

export interface ArtEntry {
    /** ページからの相対の置き場所（例 'art/portraits/ieyasu.webp'） */
    file: string;
    w: number;
    h: number;
    kind: ArtKind;
    bytes?: number;
    sha256?: string;
    /** 表示に要る小さな数値（例：地面の素材 1 枚が何 m 四方か tileMeters、人物画の目の高さ eyeY） */
    meta?: Record<string, number | string>;
}

interface Manifest {
    version: number;
    assets: Record<string, ArtEntry>;
}

const LOAD_TIMEOUT_MS = 15000;

function readParam(name: string): string | null {
    if (typeof location === 'undefined') return null;
    const q = new URLSearchParams(location.search).get(name);
    if (q !== null) return q;
    return new URLSearchParams(location.hash.slice(1)).get(name);
}

let manifest: Manifest = generated as Manifest;
let fixtureBase = '';

/** 開発時の仮の画像の一覧を読み終える約束（本番・テストではすぐ終わる） */
export const artReady: Promise<void> = (async () => {
    if (!import.meta.env?.DEV || readParam('artFixture') !== '1' || typeof fetch === 'undefined') return;
    try {
        const r = await fetch('./dev-art/manifest.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        manifest = (await r.json()) as Manifest;
        fixtureBase = 'dev-art/';
        console.warn('[art] 開発用の仮の画像（dev-art）で表示しています。見た目の素材ではありません');
    } catch (e) {
        console.warn('[art] dev-art の一覧を読めませんでした', e);
    }
})();

/** 'old' のときは新しい素材を一つも使わない（Version 21 と同じ表示） */
export function artMode(): 'new' | 'old' {
    return readParam('art') === 'old' ? 'old' : 'new';
}

/** 使える素材の記録（旧表示・一覧に無い ID は null） */
export function artEntry(id: ArtId): ArtEntry | null {
    if (artMode() === 'old') return null;
    return manifest.assets[id] ?? null;
}

export function artAvailable(id: ArtId): boolean {
    return artEntry(id) !== null;
}

export function artUrl(entry: ArtEntry): string {
    return `./${fixtureBase}${entry.file}`;
}

const cache = new Map<string, Promise<ImageBitmap | null>>();
const warned = new Set<string>();

function warnOnce(id: string, why: unknown): void {
    if (warned.has(id)) return;
    warned.add(id);
    // console.error にしない：素材が無くても進行は止めない（e2e はページの誤りを console.error で数える）
    console.warn(`[art] ${id} を読めませんでした。今までの表示で続けます`, why);
}

async function fetchBitmap(id: ArtId): Promise<ImageBitmap | null> {
    await artReady;
    const entry = artEntry(id);
    if (!entry) return null;
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), LOAD_TIMEOUT_MS);
    try {
        const r = await fetch(artUrl(entry), ctl ? { signal: ctl.signal } : undefined);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        return await createImageBitmap(blob);
    } catch (e) {
        warnOnce(id, e);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 素材を 1 回だけ読む（同じ ID は同じ約束を返す。重複して読まない）。旧表示・無い・失敗は null。
 * 返した ImageBitmap は共有なので、呼んだ側で close しない。
 */
export function loadArtBitmap(id: ArtId): Promise<ImageBitmap | null> {
    if (artMode() === 'old') return Promise.resolve(null);
    let p = cache.get(id);
    if (!p) {
        p = fetchBitmap(id);
        cache.set(id, p);
    }
    return p;
}

/** 先に読み始めておく（軍議の背景を、忠勝との会話の間に読むなど）。結果は待たない */
export function preloadArt(...ids: ArtId[]): void {
    for (const id of ids) void loadArtBitmap(id);
}

/** テスト用：一覧と読み込みの記録を差し替える */
export function __setArtManifestForTest(m: Manifest | null): void {
    manifest = m ?? (generated as Manifest);
    fixtureBase = '';
    cache.clear();
    warned.clear();
}
