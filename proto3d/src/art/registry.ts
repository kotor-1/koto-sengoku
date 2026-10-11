/**
 * 生成イラスト素材（Version 22）を読む口。ゲームの画面はここだけを通して画像を読む。
 *
 * - 一覧は manifest.gen.json（proto3d/tools/art-build.py が作る。原画の一覧・プロンプトは入れない）。
 *   一覧に無い ID は「無い」として扱い、画面は今までの見た目のまま（Version 21 と同じ）。
 * - 旧表示との比較：URL に ?art=old（または #art=old）を付けると、新しい素材を一つも読まない（保存には何も書かない）。
 * - Version 24 との比較（Version 25 から）：?art=v24 は Version 24 と同じ素材だけを使う（顔は第 1 版の face.pack1.<武将>・人物画と軍議の背景は無し・
 *   地面は同じ）。?artOff=portrait,council,face で、人物画・軍議の背景・顔を種類ごとに外せる（地面の grass・dirt・road・ground と並べて書ける。
 *   地面の語は battle/groundArt.ts が読む）。どれも URL だけで、保存・localStorage には何も書かない。
 *   外した物・その見せ方で使わない物は「一覧に無い」と同じに扱う（artEntry が null・読みに行かない）。
 * - 読み方：fetch → Blob → createImageBitmap。モデルの画像と同じ道（connect-src 'self'）で、<img> の img-src に頼らない。
 *   data: の URL は使わない（CSP で止まる）。読めない・時間切れ・壊れた画像は null を返し、呼んだ側は今までの表示のまま進める。
 * - 時間切れは「通信が進まない時間」に掛ける（30 秒）：返事・中身の一切れが届くたびに数え直すので、遅い回線でも届き続けている読み込みは止めない。
 *   見張りの時計が遅れて鳴った（ページが 3D の組み立てなどで塞がっていた）ときは、すぐ止めず、届いている中身を受け取る 1 秒をおいて決め直す。
 *   画像の展開や、読み始める前の待ちは数えない。
 * - 失敗はずっと覚えない：失敗した ID は、前の失敗から 10 秒たった後に呼ばれたら読み直す（10 秒のうちは読みに行かず null）。
 *   同じ ID を同時に 2 回は読まない。警告（console.warn）は ID ごとに 1 回だけ。
 * - 開発時だけ：?artFixture=1 で proto3d/dev-art/manifest.json（確かめ用の仮の画像。本番のビルドに入らない）に差し替える。
 *   仮の画像は配置と動作の確かめ用で、見た目の素材ではない。
 */
import generated from './manifest.gen.json';
import { FACE_OF, V24_FACE_OF, type ArtId } from './ids';
import type { GeneralId } from '../battle/generals';

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

/**
 * 通信が止まったとみなす時間（返事も中身の一切れも、この間まったく届かなければ止める）。届き続けている間は、全体で何秒かかっても止めない
 * （Version 25 の最後の確かめ：全体の時間で切っていた頃は、中身が届き終わっていても、ページが塞がっていて受け取りが遅れた読み込みを止めていた）
 */
const STALL_TIMEOUT_MS = 30000;
/** 見張りの時計がこれより遅れて鳴ったら、ページが塞がっていたとみなし、この間だけ待って（届いた中身を受け取らせて）から決め直す */
const LATE_GRACE_MS = 1000;
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

/**
 * 素材の見せ方（URL の ?art= か #art=。保存には書かない）。
 * - 'new'（既定）：一覧の素材を使う（Version 25：素材パック第 2 版の人物画・顔・軍議の背景と、地面）。
 * - 'v24'（?art=v24）：Version 24 と同じ見た目（顔は第 1 版の face.pack1.<武将>。人物画・軍議の背景は使わない。地面は同じ）。
 * - 'old'（?art=old）：新しい素材を一つも使わない（Version 21 と同じ表示）。
 */
export type ArtMode = 'new' | 'v24' | 'old';
export function artMode(): ArtMode {
    const v = readParam('art');
    return v === 'old' ? 'old' : v === 'v24' ? 'v24' : 'new';
}

/** ?artOff= で外せる、地面以外の種類（地面の grass・dirt・road・forest・ground は battle/groundArt.ts の groundArtOff） */
export type ArtOffKind = 'portrait' | 'council' | 'face';
const ART_OFF_KINDS: readonly ArtOffKind[] = ['portrait', 'council', 'face'];

/** URL の ?artOff=（#artOff=）の語（コンマか空白で区切る。小文字にそろえる） */
function artOffWords(): Set<string> {
    const v = readParam('artOff');
    return new Set(v ? v.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean) : []);
}

/** URL の ?artOff=（#artOff=）で外した種類（知らない語・地面の語はここでは無視） */
export function artOff(): ReadonlySet<ArtOffKind> {
    const out = new Set<ArtOffKind>();
    for (const k of artOffWords()) if ((ART_OFF_KINDS as readonly string[]).includes(k)) out.add(k as ArtOffKind);
    return out;
}

/**
 * 地面の素材（tex.<戦場>.<種類>）が ?artOff= で外されているか（battle/groundArt.ts の groundArtOff と同じ読み方：
 * ground は全部、grass は土のむら dirt も外す）。一覧の「使える」（artAvailable・タイトルの AI 生成の明示）を、外した物で数えないため
 */
function groundOff(id: string, words: ReadonlySet<string>): boolean {
    const mat = id.slice(id.lastIndexOf('.') + 1);
    return words.has('ground') || words.has(mat) || (mat === 'dirt' && words.has('grass'));
}

/** 軍議の背景（奥の画・手前の幕）の ID か */
const isCouncilArt = (id: string) => id === 'bg.council' || id.startsWith('bg.council.');
/** Version 24 までの顔（素材パック第 1 版） */
const isPack1Face = (id: string) => id.startsWith('face.pack1.');

/**
 * 今の見せ方（?art=・?artOff=）で使わない素材か（一覧にあっても「無い」と同じに扱う）。kind は一覧の種類（無ければ ID から見る）。
 * - 旧表示：全部。
 * - Version 24 の見せ方：人物画・軍議の背景・第 2 版の顔（第 1 版の顔 face.pack1.* と地面は使う）。
 * - 既定：第 1 版の顔（Version 24 と比べるときだけ使う）。
 * - ?artOff=portrait は人物画、council は軍議の背景、face は顔（どの版も）。地面の語（grass・dirt・road・forest・ground）は地面の素材
 *   （どの地面をどう描くかは battle/groundArt.ts）。
 */
export function artBlocked(id: ArtId, kind?: ArtKind): boolean {
    const mode = artMode();
    if (mode === 'old') return true;
    const k = kind ?? manifest.assets[id]?.kind ?? (id.startsWith('portrait.') ? 'portrait' : id.startsWith('face.') ? 'face' : id.startsWith('tex.') ? 'texture' : undefined);
    const words = artOffWords();
    if (k === 'portrait' && (mode === 'v24' || words.has('portrait'))) return true;
    if (isCouncilArt(id) && (mode === 'v24' || words.has('council'))) return true;
    if (k === 'face' || id.startsWith('face.')) {
        if (words.has('face')) return true;
        if (mode === 'v24' ? !isPack1Face(id) : isPack1Face(id)) return true;
    }
    if (k === 'texture' && groundOff(id, words)) return true;
    return false;
}

/** 使える素材の記録（旧表示・今の見せ方で使わない・一覧に無い ID は null） */
export function artEntry(id: ArtId): ArtEntry | null {
    const e = manifest.assets[id] ?? null;
    if (!e || artBlocked(id, e.kind)) return null;
    return e;
}

/**
 * 武将の顔の素材の ID（合戦の札・能力の欄・編成の表と、会話・軍議の台詞の枠）。見せ方で選ぶ：
 * 既定は第 2 版（FACE_OF：人物画と同じ原画から切り出した顔）、?art=v24 は Version 24 の顔（V24_FACE_OF）。
 * 旧表示・?artOff=face・顔の無い武将は null（ほかの人の顔を代わりに使わない）。一覧にあるかはここでは見ない（読む側が見る）
 */
export function faceArtIdOf(general: GeneralId | string | null | undefined): ArtId | null {
    if (!general) return null;
    const mode = artMode();
    if (mode === 'old') return null;
    const table = mode === 'v24' ? V24_FACE_OF : FACE_OF;
    // 自分の持ち物の名前だけを引く（'constructor'・'toString' などの組み込みの名前で、関数を素材の ID と取り違えない）
    const id = Object.prototype.hasOwnProperty.call(table, general) ? (table[general as GeneralId] ?? null) : null;
    return id && !artBlocked(id, 'face') ? id : null;
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

/**
 * 通信の見張り：progress() から STALL_TIMEOUT_MS の間、次の progress() が無ければ onStall を呼ぶ（1 回だけ）。
 * 時計が LATE_GRACE_MS より遅れて鳴った（ページの処理が長く続いて、時計も届いた中身の受け取りも待たされていた）ときは、
 * LATE_GRACE_MS だけ待って決め直す（先に届いていた中身の受け取りが進めば、止めない）。時刻は Date.now（読み直しの間と同じ時計）
 */
function stallWatch(onStall: () => void): { progress(): void; stop(): void } {
    let last = Date.now();
    let due = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const arm = (ms: number) => {
        due = Date.now() + ms;
        timer = setTimeout(check, ms);
    };
    const check = () => {
        if (stopped) return;
        const now = Date.now();
        // 時計が戻ったとき（idle < 0）は、そこから数え直す
        if (now < last) last = now;
        const idle = now - last;
        if (idle < STALL_TIMEOUT_MS) return arm(STALL_TIMEOUT_MS - idle);
        if (now - due > LATE_GRACE_MS) return arm(LATE_GRACE_MS);
        stopped = true;
        onStall();
    };
    arm(STALL_TIMEOUT_MS);
    return {
        progress: () => {
            last = Date.now();
        },
        stop: () => {
            stopped = true;
            clearTimeout(timer);
        },
    };
}

/**
 * 通信（fetch と中身の受け取り）。止めるのは「進まない」とき（stallWatch）：返事が届いた時と、中身の一切れを受け取るたびに数え直す。
 * 中身を少しずつ受け取れない環境（body の無い返事）は、まとめて受け取る（返事が届いた時に数え直すだけ）
 */
async function fetchBlob(url: string): Promise<Blob> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const watch = stallWatch(() => ctl?.abort());
    try {
        const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
        watch.progress();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const reader = typeof r.body?.getReader === 'function' ? r.body.getReader() : null;
        if (!reader) return await r.blob();
        const parts: Uint8Array[] = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) parts.push(value);
            watch.progress();
        }
        return new Blob(parts as BlobPart[], { type: r.headers?.get('content-type') ?? '' });
    } finally {
        watch.stop();
    }
}

/** 失敗（通信の失敗・HTTP の誤り・時間切れ・壊れた画像）は例外で返す。旧表示・一覧に無い・道具が無いは null（失敗ではない） */
async function fetchBitmap(id: ArtId): Promise<ImageBitmap | null> {
    await artReady;
    const entry = artEntry(id);
    if (!entry) return null;
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    // 時間切れは通信の間だけ（fetchBlob）。展開（createImageBitmap）は数えない
    const blob = await fetchBlob(artUrl(entry));
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
