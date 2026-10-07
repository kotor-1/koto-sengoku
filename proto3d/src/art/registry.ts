/**
 * 生成イラスト素材（Version 22）を読む口。ゲームの画面はここだけを通して画像を読む。
 *
 * - 一覧は manifest.gen.json（proto3d/tools/art-build.py が作る。原画の一覧・プロンプトは入れない）。
 *   一覧に無い ID は「無い」として扱い、画面は今までの見た目のまま（Version 21 と同じ）。
 * - 旧表示との比較：URL に ?art=old（または #art=old）を付けると、新しい素材を一つも読まない（保存には何も書かない）。
 * - 読み方：fetch → Blob → createImageBitmap。モデルの画像と同じ道（connect-src 'self'）で、<img> の img-src に頼らない。
 *   data: の URL は使わない（CSP で止まる）。読めない・時間切れ・壊れた画像は null を返し、呼んだ側は今までの表示のまま進める。
 * - 時間切れは通信（fetch と中身の受け取り）だけに掛ける（30 秒。画像の展開や、読み始める前の待ちは数えない）。
 * - 失敗はずっと覚えない：失敗した ID は、前の失敗から 10 秒たった後に呼ばれたら読み直す（10 秒のうちは読みに行かず null）。
 *   同じ ID を同時に 2 回は読まない。警告（console.warn）は ID ごとに 1 回だけ。
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

/** 通信（fetch と中身の受け取り）の時間切れ。重い端末・同時に動く物があっても待てるように長め */
const FETCH_TIMEOUT_MS = 30000;
/** 失敗した ID を読み直すまでの最短の間（同じ物を何度も読みに行かない） */
const RETRY_AFTER_MS = 10000;

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

/** 読み込み中・読めた（または読まないと決まった）ID の約束。失敗した ID は消す（後で読み直せる） */
const cache = new Map<string, Promise<ImageBitmap | null>>();
/** 失敗した時刻（読み直しの最短の間を守る） */
const failedAt = new Map<string, number>();
const warned = new Set<string>();
/** __setArtManifestForTest で記録を消したときに増やす（消す前に始めた読み込みの結果を、新しい記録に書かない） */
let generation = 0;

function warnOnce(id: string, why: unknown): void {
    if (warned.has(id)) return;
    warned.add(id);
    // console.error にしない：素材が無くても進行は止めない（e2e はページの誤りを console.error で数える）
    console.warn(`[art] ${id} を読めませんでした。今までの表示で続けます`, why);
}

/** 失敗（通信の失敗・HTTP の誤り・時間切れ・壊れた画像）は例外で返す。旧表示・一覧に無い・道具が無いは null（失敗ではない） */
async function fetchBitmap(id: ArtId): Promise<ImageBitmap | null> {
    await artReady;
    const entry = artEntry(id);
    if (!entry) return null;
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // 時間切れは通信の間だけ（fetch の直前から中身を受け取り終えるまで）。展開（createImageBitmap）は数えない
    const timer = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
    let blob: Blob;
    try {
        const r = await fetch(artUrl(entry), ctl ? { signal: ctl.signal } : undefined);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        blob = await r.blob();
    } finally {
        clearTimeout(timer);
    }
    return await createImageBitmap(blob);
}

/**
 * 素材を読む（同じ ID は同じ約束を返す。同時に重ねて読まない）。旧表示・無い・失敗は null。
 * 失敗した ID は覚えておかず、前の失敗から RETRY_AFTER_MS たった後の呼び出しで読み直す（それまでは読みに行かず null）。
 * 返した ImageBitmap は共有なので、呼んだ側で close しない。
 */
export function loadArtBitmap(id: ArtId): Promise<ImageBitmap | null> {
    if (artMode() === 'old') return Promise.resolve(null);
    const p = cache.get(id);
    if (p) return p;
    const last = failedAt.get(id);
    if (last !== undefined) {
        const dt = Date.now() - last;
        // 時計が戻ったとき（dt < 0）は待たずに読み直す
        if (dt >= 0 && dt < RETRY_AFTER_MS) return Promise.resolve(null);
    }
    const gen = generation;
    const q: Promise<ImageBitmap | null> = fetchBitmap(id).then(
        (b) => {
            if (gen === generation) failedAt.delete(id);
            return b;
        },
        (e: unknown) => {
            if (gen !== generation) return null;
            warnOnce(id, e);
            failedAt.set(id, Date.now());
            if (cache.get(id) === q) cache.delete(id);
            return null;
        },
    );
    cache.set(id, q);
    return q;
}

/** 先に読み始めておく（軍議の背景を、忠勝との会話の間に読むなど）。結果は待たない */
export function preloadArt(...ids: ArtId[]): void {
    for (const id of ids) void loadArtBitmap(id);
}

/** テスト用：一覧と読み込みの記録を差し替える */
export function __setArtManifestForTest(m: Manifest | null): void {
    manifest = m ?? (generated as Manifest);
    fixtureBase = '';
    generation++;
    cache.clear();
    failedAt.clear();
    warned.clear();
}
