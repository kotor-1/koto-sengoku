/**
 * 演出の時計と、時刻 t の純粋な関数（どの場面か・字幕・地図の現れ方と強調・出した情報の札）。three も DOM も使わない。
 * 設計：docs/story-rpg-design.md §1・§3。再生する画面は ui/cinePlayer.ts（ここの関数だけで形を決める）。
 *
 * - 演出の中身は「時刻 t の純粋な関数」：一時停止・飛ばし・見直しは t を止める・動かす・0 に戻すだけ。同じ t なら同じ形。
 * - 時計は実時間（呼ぶ側が performance.now の差を渡す）。1 コマの上限は FRAME_CAP_SEC 秒（止まっていた後に大きく飛ばない）。
 */
import type { CineCaption, CineMapBeat, CineSpec, CineStageBeat, MapScene, StageEvent } from './types';

/** 1 コマで進める上限（秒） */
export const FRAME_CAP_SEC = 1;
/** 場所が現れるのにかける時間（秒。動きを減らすときは 0 で、すぐ現れる） */
export const PLACE_APPEAR_SEC = 0.6;
/** 線（進路・関係）が伸びるのにかける時間（秒） */
export const ROUTE_DRAW_SEC = 1.2;
/** 「前の場面へ」：場面の頭からこの秒数より後なら、その場面の頭へ。前なら 1 つ前の場面の頭へ */
export const PREV_RESTART_SEC = 1.5;
/** 字幕を出す時間の最短（秒）と、1 秒に読む文字の数（設計 §3：文字数 ÷ 8 秒と 2.5 秒の大きい方以上） */
export const CAPTION_MIN_SEC = 2.5;
export const CAPTION_CHARS_PER_SEC = 8;
/** 字幕 1 つの文字の数の上限（スマホ横 844×390・16px で 2 行に収まる目安） */
export const CAPTION_MAX_CHARS = 60;

export type CineBeat = CineMapBeat | CineStageBeat;
/** 伝える情報の札（CineSpec.info の鍵）。並びは出す順の目安 */
export type InfoKey = keyof CineSpec['info'];
export const INFO_KEYS: readonly InfoKey[] = ['when', 'where', 'ally', 'prev', 'crisis', 'decide'];

/** 場面を始まりの時刻の順に並べた写し（台本はそのまま。始まりが同じなら台本の順） */
export function orderedBeats(spec: CineSpec): CineBeat[] {
    return spec.beats
        .map((b, i) => ({ b, i }))
        .sort((p, q) => p.b.start - q.b.start || p.i - q.i)
        .map((x) => x.b);
}

/** 時刻 t の場面の番号（orderedBeats の番号。始まりが t 以下で一番遅い場面。t が最初の場面より前なら 0） */
export function beatIndexAt(beats: readonly CineBeat[], t: number): number {
    let idx = 0;
    for (let i = 0; i < beats.length; i++) if (beats[i]!.start <= t + 1e-9) idx = i;
    return idx;
}

/** 時刻 t の字幕（出ている物のうち、一番後に出た物。無ければ null） */
export function captionAt(spec: CineSpec, t: number): CineCaption | null {
    let best: CineCaption | null = null;
    for (const c of spec.captions) {
        if (c.start <= t + 1e-9 && t < c.end - 1e-9 && (!best || c.start >= best.start)) best = c;
    }
    return best;
}

/** 時刻 t までに出した情報の札（INFO_KEYS の順） */
export function infoAt(spec: CineSpec, t: number): InfoKey[] {
    return INFO_KEYS.filter((k) => {
        const at = spec.info[k];
        return at !== undefined && at <= t + 1e-9;
    });
}

// ---------------------------------------------------------------- 地図の場面

export type MapElemShow = 'hidden' | 'appearing' | 'shown';
export interface MapElemState {
    state: MapElemShow;
    /** 0〜1（現れている途中の割合。shown は 1・hidden は 0） */
    progress: number;
    /** 強調しているか */
    hl: boolean;
}
export interface MapFrame {
    /** 今の強調（場所・線の id） */
    highlight: string[];
    places: Record<string, MapElemState>;
    routes: Record<string, MapElemState>;
}

/** 地図の場面の、場面の始めから local 秒の強調（highlights の切り替え。無ければ scene.highlight） */
export function highlightAt(beat: CineMapBeat, local: number): string[] {
    let cur: string[] = beat.scene.highlight ?? [];
    let at = -Infinity;
    for (const h of beat.highlights ?? []) {
        if (h.at <= local + 1e-9 && h.at >= at) {
            at = h.at;
            cur = h.ids;
        }
    }
    return [...cur];
}

function elemState(appearAt: number | undefined, local: number, dur: number, reduced: boolean, hl: boolean): MapElemState {
    const a = appearAt ?? 0;
    if (local + 1e-9 < a) return { state: 'hidden', progress: 0, hl };
    // 始めからある物（appear を省いた・0 以下）と、動きを減らすときは、すぐ現れる（位置は変えない）
    if (reduced || a <= 0 || dur <= 0 || local >= a + dur) return { state: 'shown', progress: 1, hl };
    return { state: 'appearing', progress: Math.max(0, Math.min(1, (local - a) / dur)), hl };
}

/** 地図の場面の、場面の始めから local 秒の形（どの場所・線が出ているか・現れている途中の割合・強調） */
export function mapFrameAt(beat: CineMapBeat, local: number, reduced: boolean): MapFrame {
    return mapSceneFrame(beat.scene, beat.appear ?? {}, highlightAt(beat, local), local, reduced);
}

/** 地図の 1 場面の形（情勢の画面でも使う：appear を空にすれば全部出ている） */
export function mapSceneFrame(scene: MapScene, appear: Record<string, number>, highlight: string[], local: number, reduced: boolean): MapFrame {
    const hl = new Set(highlight);
    const places: Record<string, MapElemState> = {};
    const routes: Record<string, MapElemState> = {};
    for (const p of scene.places) places[p.id] = elemState(appear[p.id], local, PLACE_APPEAR_SEC, reduced, hl.has(p.id));
    for (const r of scene.routes) routes[r.id] = elemState(appear[r.id], local, ROUTE_DRAW_SEC, reduced, hl.has(r.id));
    return { highlight: [...highlight], places, routes };
}

// ---------------------------------------------------------------- 1 コマの形

export interface CineFrame {
    t: number;
    /** 場面の番号（orderedBeats の番号）と数 */
    beatIndex: number;
    beatCount: number;
    beat: CineBeat;
    /** 場面の始めからの秒 */
    local: number;
    caption: CineCaption | null;
    info: InfoKey[];
    /** 地図の場面なら地図の形（3D の場面なら null） */
    map: MapFrame | null;
    /** 3D の場面なら出来事と、場面の始めからの秒（地図の場面なら null） */
    stage: { event: StageEvent; local: number } | null;
    /** 見出し（いつ・どこ）：今の地図の場面の見出し。3D の場面では、その前の地図の場面の見出し（無ければ台本の名前） */
    heading: string;
    /** 終わりまで来た */
    ended: boolean;
}

/** 時刻 t の形（純粋：同じ台本・同じ t・同じ reduced なら同じ結果） */
export function frameAt(spec: CineSpec, t: number, reduced: boolean, beats: readonly CineBeat[] = orderedBeats(spec)): CineFrame {
    const tt = Math.max(0, Math.min(spec.duration, Number.isFinite(t) ? t : 0));
    const i = beatIndexAt(beats, tt);
    const beat = beats[i]!;
    const local = Math.max(0, tt - beat.start);
    let heading = spec.title;
    for (let k = i; k >= 0; k--) {
        const b = beats[k]!;
        if (b.kind === 'map' && b.scene.heading) {
            heading = b.scene.heading;
            break;
        }
    }
    return {
        t: tt,
        beatIndex: i,
        beatCount: beats.length,
        beat,
        local,
        caption: captionAt(spec, tt),
        info: infoAt(spec, tt),
        map: beat.kind === 'map' ? mapFrameAt(beat, local, reduced) : null,
        stage: beat.kind === 'stage' ? { event: beat.event, local } : null,
        heading,
        ended: tt >= spec.duration - 1e-9,
    };
}

// ---------------------------------------------------------------- 時計

/**
 * 演出の時計（実時間の差を tick に渡す）。一時停止・次の場面・前の場面・スキップは t を動かすだけ。
 * 中身（frameAt）は t だけで決まるので、同じ t へ動かせば同じ形になる。
 */
export class CineClock {
    t = 0;
    paused = false;
    ended = false;
    readonly beats: CineBeat[];
    constructor(readonly spec: CineSpec) {
        this.beats = orderedBeats(spec);
        if (this.beats.length === 0) throw new Error('演出の台本に場面がありません');
        if (!(spec.duration > 0)) this.ended = true;
    }
    get duration(): number {
        return this.spec.duration;
    }
    get beatIndex(): number {
        return beatIndexAt(this.beats, this.t);
    }
    /**
     * 実時間で dtSec 秒進める（止まっている・終わっていれば進めない。1 コマの上限 FRAME_CAP_SEC）。
     * 場面の境目をまたぐコマは次の場面の頭で止める（遅いコマの時間を次の場面へ持ち越さない：場面の頭と、その字幕を飛ばさない）。
     */
    tick(dtSec: number): void {
        if (this.paused || this.ended) return;
        if (!Number.isFinite(dtSec) || dtSec <= 0) return;
        const to = this.t + Math.min(dtSec, FRAME_CAP_SEC);
        const nb = this.beats[this.beatIndex + 1];
        this.seek(nb && to > nb.start ? nb.start : to);
    }
    setPaused(on: boolean): void {
        this.paused = on;
    }
    /** t へ動かす（0〜長さに収める。長さに着いたら終わり） */
    seek(t: number): void {
        this.t = Math.max(0, Math.min(this.duration, Number.isFinite(t) ? t : 0));
        this.ended = this.t >= this.duration - 1e-9;
    }
    /** 次の場面の頭へ（最後の場面なら終わりへ） */
    next(): void {
        const nb = this.beats[this.beatIndex + 1];
        this.seek(nb ? nb.start : this.duration);
    }
    /** 前の場面へ（今の場面の頭から PREV_RESTART_SEC 秒より後なら今の場面の頭へ） */
    prev(): void {
        const i = this.beatIndex;
        const b = this.beats[i]!;
        if (i === 0 || this.t - b.start > PREV_RESTART_SEC) this.seek(b.start);
        else this.seek(this.beats[i - 1]!.start);
    }
    /** 終わりへ飛ぶ */
    skip(): void {
        this.seek(this.duration);
    }
    frame(reduced: boolean): CineFrame {
        return frameAt(this.spec, this.t, reduced, this.beats);
    }
}

// ---------------------------------------------------------------- 台本の点検（物語の側のテストで使える）

/**
 * 台本の長さの目安（秒。moment ごと）。
 * - 章の冒頭（ch1_open・ch2_open）：ロード完了から操作の開始まで 15〜20 秒の目安（docs/v20-feedback-request.md【1】）に収める。
 *   第二章は前章の結果・約束・援兵・使いの言葉が入るので長めまで許す。
 * - 情勢の図解（ch1_intro・ch2_intro）：30〜45 秒（任意で見る物）。出陣・帰還：8〜15 秒。
 */
export const CINE_LENGTH_RANGE: Readonly<Record<CineSpec['moment'], readonly [number, number]>> = {
    ch1_open: [12, 18],
    ch2_open: [12, 24],
    ch1_intro: [30, 45],
    ch2_intro: [30, 45],
    departure: [8, 15],
    return: [8, 15],
};

/** 字幕 1 つに要る時間（秒）：文字数 ÷ CAPTION_CHARS_PER_SEC と CAPTION_MIN_SEC の大きい方 */
export function captionNeedSec(c: CineCaption): number {
    return Math.max(CAPTION_MIN_SEC, [...c.text].length / CAPTION_CHARS_PER_SEC);
}

/**
 * 台本の決まりを点検する（問題の文の並び。空なら良い）：長さ・場面の並びと隙間・字幕の時間と長さ・情報の札の時刻。
 * 長さの目安は moment で見る（CINE_LENGTH_RANGE）：章の冒頭（3D の場面だけ）第一章 12〜18 秒・第二章 12〜24 秒、情勢の図解 30〜45 秒、出陣と帰還 8〜15 秒。
 */
export function specProblems(spec: CineSpec): string[] {
    const out: string[] = [];
    if (!(spec.duration > 0)) out.push('長さが 0 以下');
    const [lo, hi] = CINE_LENGTH_RANGE[spec.moment];
    if (spec.duration < lo - 1e-9 || spec.duration > hi + 1e-9) out.push(`長さ ${spec.duration} 秒が目安（${lo}〜${hi} 秒）の外`);
    const beats = orderedBeats(spec);
    if (beats.length === 0) out.push('場面が無い');
    let at = 0;
    for (const b of beats) {
        if (b.end <= b.start) out.push(`場面（${b.start}〜${b.end}）の終わりが始まりより前`);
        if (b.start > at + 1e-6) out.push(`場面の隙間（${at}〜${b.start} 秒）`);
        at = Math.max(at, b.end);
        if (b.kind === 'map') {
            const ids = new Set([...b.scene.places.map((p) => p.id), ...b.scene.routes.map((r) => r.id)]);
            for (const r of b.scene.routes) {
                if (!b.scene.places.some((p) => p.id === r.from) || !b.scene.places.some((p) => p.id === r.to)) out.push(`線 ${r.id} の端の場所が地図に無い`);
            }
            for (const id of [...Object.keys(b.appear ?? {}), ...(b.scene.highlight ?? []), ...(b.highlights ?? []).flatMap((h) => h.ids)]) {
                if (!ids.has(id)) out.push(`地図に無い id ${id}（現れ方・強調）`);
            }
            if (!b.scene.note) out.push('地図の場面に模式図の注記が無い');
        }
    }
    if (at < spec.duration - 1e-6) out.push(`最後の場面が ${at} 秒で終わり、長さ ${spec.duration} 秒に届かない`);
    for (const c of spec.captions) {
        if (c.start < -1e-9 || c.end > spec.duration + 1e-9) out.push(`字幕「${c.text}」が長さの外`);
        const need = captionNeedSec(c);
        if (c.end - c.start < need - 1e-6) out.push(`字幕「${c.text}」の時間 ${(c.end - c.start).toFixed(1)} 秒が ${need.toFixed(1)} 秒より短い`);
        if ([...c.text].length > CAPTION_MAX_CHARS) out.push(`字幕「${c.text}」が ${CAPTION_MAX_CHARS} 字より長い`);
    }
    for (const k of INFO_KEYS) {
        const v = spec.info[k];
        if (v !== undefined && (v < 0 || v > spec.duration)) out.push(`情報の札 ${k} の時刻 ${v} が長さの外`);
    }
    return out;
}
