/**
 * 演出の 3D の出来事（StageEvent）を、時刻 t（秒。場面の始めから）の純粋な関数で置く（three も DOM も使わない）。
 * 同じ出来事・同じ t・同じ配役なら、いつも同じ形（一時停止・飛ばし・見直しで同じ）。描くのは explore/actors.ts。
 * 設計：docs/story-rpg-design.md §1・§2、記録：docs/story-rpg-town.md。
 *
 * - 人（使者・使い）は人物の素材の写し（歩き・立ち）。兵は合戦の兵の形（軽い）。旗は出来事の一文字。
 * - カメラは決めた位置と見る点を、ゆっくり（なめらかに）動かす。カメラ除けの箱には入らない（tests/proto3d-town-stage.test.ts）。
 *   場面の途中で 1 回だけ「切り替え」（カット）を入れる出来事がある（使者：街道口の画 → 城門の前の画）。切り替えは動きではなく画の替わり。
 * - reduced（動きを減らす）：カメラは動かさず（決めた位置の静止した画）、人と兵は歩かずにその画の位置に現れる（t によらない）。
 * - 主人公は出来事の間は描かない（動かさない）。会話の相手の人物と出来事の人が同じ人なら、着くまでその人物を隠し、着いたら人物に替わる。
 */
import type { AmbientGroup, StageEvent } from '../story/types';
import { GUARD_STOOLS, KIDO, MATS, HUT } from '../town/plan';

// ================================================================ 形

export type FigurePose = 'stand' | 'walk' | 'limp' | 'lie' | 'sit' | 'sitGround' | 'carried';

/** 兵 1 人（合戦の兵の形）。heading は人物と同じ（0 = 南（+z）を向く） */
export interface StageFigure {
    x: number;
    z: number;
    /** 地面からの持ち上げ（担架の上など） */
    y: number;
    heading: number;
    pose: FigurePose;
    /** 歩きの位相（歩いた距離 ÷ 1 歩の周期。揺れに使う） */
    phase: number;
    /** 横へ傾ける（肩を貸す・足を引きずる。ラジアン） */
    lean: number;
    /** 鎧の色の家（旗の一文字。徳・織・浅など） */
    mark: string;
    /** 槍を持つか */
    spear: boolean;
}

/** のぼり（旗竿と布）。根元の位置と向き・傾き */
export interface StageBanner {
    x: number;
    z: number;
    /** 根元の高さ（持つ手の高さ） */
    y: number;
    heading: number;
    mark: string;
    /** 後ろへの傾き（0 で真っすぐ。勝てば掲げる＝0） */
    tilt: number;
    /** 布を広げているか（掲げる）。false は巻いて短く */
    open: boolean;
}

/** 担架（板）。2 人で運ぶ */
export interface StageLitter {
    x: number;
    z: number;
    y: number;
    heading: number;
}

/** 人物の素材の写しの人（使者・使い） */
export interface StagePerson {
    key: string;
    look: string;
    name: string;
    x: number;
    z: number;
    heading: number;
    /** 歩いた距離（m。歩きの動きの位相） */
    walked: number;
    /** 歩いているか（0〜1。歩きと立ちの混ぜ方） */
    moving: number;
    /** 名札を出すか（画の中にいる間） */
    label: boolean;
}

/** カメラ（位置と見る点） */
export interface StageShot {
    px: number;
    py: number;
    pz: number;
    tx: number;
    ty: number;
    tz: number;
}

export interface StageFrame {
    people: StagePerson[];
    figures: StageFigure[];
    banners: StageBanner[];
    litters: StageLitter[];
    shot: StageShot;
    /** 出来事の間だけ隠す会話の相手（同じ人が歩いて来る） */
    hideCast: string[];
    /** 隠す町の人々（出来事が同じ所に同じ人々を出す） */
    hideAmbient: AmbientGroup['kind'][];
}

/** 置いている会話の相手（見た目の鍵と場所。使者の行き先を決める） */
export interface StageCastInfo {
    id: string;
    kind: string;
    look?: string;
    x: number;
    z: number;
    heading: number;
}

// ================================================================ 道すじ

export type Pt = readonly [number, number];

/** 折れ線の長さ */
export function pathLength(path: readonly Pt[]): number {
    let L = 0;
    for (let i = 1; i < path.length; i++) L += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
    return L;
}

/**
 * 折れ線の上の距離 s の点と、進む向き（heading：0 = +z）。s は 0〜長さに切る。
 * extend なら、始めより前・終わりより先は最初・最後の線を延ばした所（隊列の後ろの人が道の始めより後ろにいるとき）。
 */
export function alongPath(path: readonly Pt[], s: number, extend = false): { x: number; z: number; heading: number } {
    const n = path.length;
    if (n === 0) return { x: 0, z: 0, heading: 0 };
    if (n === 1) return { x: path[0]![0], z: path[0]![1], heading: 0 };
    const seg = (i: number) => {
        const a = path[i - 1]!;
        const b = path[i]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return { a, b, len, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    };
    const at = (g: ReturnType<typeof seg>, d: number) => {
        const k = g.len > 1e-9 ? d / g.len : 0;
        return { x: g.a[0] + (g.b[0] - g.a[0]) * k, z: g.a[1] + (g.b[1] - g.a[1]) * k, heading: g.heading };
    };
    if (s <= 0) {
        const g = seg(1);
        return at(g, extend ? s : 0);
    }
    let rest = s;
    for (let i = 1; i < n; i++) {
        const g = seg(i);
        if (rest <= g.len) return at(g, rest);
        rest -= g.len;
    }
    const g = seg(n - 1);
    return at(g, g.len + (extend ? rest : 0));
}

/** 道すじに沿って横へずらした点（進む向きの右が +）。角のあたりは向きの平均で */
function offsetAlong(path: readonly Pt[], s: number, side: number, extend = false): { x: number; z: number; heading: number } {
    const p = alongPath(path, s, extend);
    // 向きは少し前後の点から（角でぎくしゃくしない）
    const a = alongPath(path, s - 0.6, extend);
    const b = alongPath(path, s + 0.6, extend);
    const h = Math.hypot(b.x - a.x, b.z - a.z) > 1e-6 ? Math.atan2(b.x - a.x, b.z - a.z) : p.heading;
    // heading の右（進む向き (sin h, cos h) を時計回りに 90°：(−cos h, sin h)）
    return { x: p.x - Math.cos(h) * side, z: p.z + Math.sin(h) * side, heading: h };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** なめらかな 0→1（両端で速さ 0） */
export const ease = (v: number) => {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpShot(a: StageShot, b: StageShot, k: number): StageShot {
    return { px: lerp(a.px, b.px, k), py: lerp(a.py, b.py, k), pz: lerp(a.pz, b.pz, k), tx: lerp(a.tx, b.tx, k), ty: lerp(a.ty, b.ty, k), tz: lerp(a.tz, b.tz, k) };
}
const shot = (px: number, py: number, pz: number, tx: number, ty: number, tz: number): StageShot => ({ px, py, pz, tx, ty, tz });

/** 1 歩の周期で進む距離（m。人物の歩きの動き 0.84 秒 × 1.4 m/秒） */
export const STRIDE = 1.18;

/**
 * 歩いて行く距離（t 秒で、遅れ delay・速さ v・長さ L）。始めと終わりはなめらかに（0.5 秒ほどで速さが変わる）。
 * 返り：{ s：歩いた距離、moving：歩いているか（0〜1） }
 */
export function walkProgress(t: number, delay: number, v: number, L: number): { s: number; moving: number } {
    const acc = 0.5;
    const tt = t - delay;
    if (tt <= 0) return { s: 0, moving: 0 };
    // 加速の間は半分の速さで進んだと見なす（なめらかに）
    let s: number;
    if (tt < acc) s = (v * tt * tt) / (2 * acc);
    else s = v * (tt - acc / 2);
    if (s >= L) return { s: L, moving: 0 };
    const near = L - s;
    const moving = Math.min(clamp01(tt / acc), clamp01(near / (v * 0.4)));
    return { s, moving };
}

// ================================================================ 町の場所（出来事の道すじ）

/** 街道の外（木戸の南）から城門の北（城内）まで、道の真ん中の線 */
const ROAD_IN: readonly Pt[] = [
    [0, 42],
    [0, KIDO.z],
    [0, -12],
    [0, -22],
];
/** 城内（城門の北）から木戸の南の街道まで（出陣） */
const ROAD_OUT: readonly Pt[] = [...ROAD_IN].reverse();
/** 木戸から詰所へ（道を北へ、町家の写しとの間の路地を東へ、囲いを北へ） */
const TO_GUARDPOST: readonly Pt[] = [
    [0, 34],
    [0, KIDO.z],
    [0.2, 11.85],
    [10.6, 11.85],
    [12.2, 4.2],
    [14.6, -1.2],
];

/** 使者の行き先の候補（会話の相手に同じ見た目の人がいないとき。人物の置き場所と重ならない所を選ぶ） */
const ENVOY_FALLBACK: readonly Pt[] = [
    [2.0, -7.1],
    [5.3, -2.4],
    [3.4, -4.4],
    [-0.4, -4.2],
];

// ================================================================ 出来事ごと

const DEFAULT_MARK = '徳';
/** 兵の並び：横の人数・列の間 */
const ROW_GAP = 1.25;

/** 出来事の形（純粋。同じ引数なら同じ形） */
export function stageFrame(ev: StageEvent, t: number, reduced: boolean, cast: readonly StageCastInfo[] = []): StageFrame {
    const tt = Math.max(0, t);
    switch (ev.id) {
        case 'envoys_arrive':
            return arrivals(
                ev.envoys.map((e, i) => ({ key: `envoy${i}`, look: e.look, name: e.name })),
                tt,
                reduced,
                cast,
            );
        case 'messenger_arrive':
            return arrivals([{ key: 'messenger', look: ev.look, name: ev.name }], tt, reduced, cast);
        case 'wounded_rest':
            return woundedRest(ev.count, tt, reduced);
        case 'reinforcement_arrive':
            return reinforcement(ev.count, ev.mark || DEFAULT_MARK, tt, reduced);
        case 'column_depart':
            return columnDepart(ev.count, ev.mark || DEFAULT_MARK, tt, reduced);
        case 'column_return':
            return columnReturn(ev.count, ev.wounded, ev.mark || DEFAULT_MARK, ev.victory, tt, reduced);
    }
}

// ---------------- 使者・使いの到着

/** 使者の画の切り替え（秒）：前は街道口の画、後は城門の前の画 */
export const ARRIVAL_CUT = 3.8;
const ARRIVAL_SPEED = 1.6;
/** 後の画の歩き（着くまでを場面の中（8 秒ほど）に収める。少し急ぎ足） */
const ARRIVAL_SPEED_B = 1.8;
/** 街道口の画：通りの西の端から南（木戸）を見る */
const ARRIVAL_SHOT_A0 = shot(-2.4, 2.2, 6.0, 0.6, 1.7, 16.5);
const ARRIVAL_SHOT_A1 = shot(-2.4, 2.2, 6.0, 0.9, 1.6, 12.2);
/** 城門の前の画：町家 A の前から北東（城門の前の置き場所）を見る */
const ARRIVAL_SHOT_B0 = shot(-3.2, 2.3, 0.6, 2.2, 1.5, -4.4);
const ARRIVAL_SHOT_B1 = shot(-3.1, 2.3, 0.4, 2.6, 1.5, -4.9);

function arrivals(who: { key: string; look: string; name: string }[], t: number, reduced: boolean, cast: readonly StageCastInfo[]): StageFrame {
    const used: Pt[] = [];
    const people: StagePerson[] = [];
    const hideCast: string[] = [];
    who.forEach((w, i) => {
        // 行き先：同じ見た目の会話の相手（その人物の所へ歩き、着いたら人物に替わる）。いなければ空いた所
        const match = cast.find((c) => c.kind === 'person' && c.look === w.look && !used.some((u) => Math.hypot(u[0] - c.x, u[1] - c.z) < 0.5));
        let dest: Pt;
        let heading: number;
        let castId: string | null = null;
        if (match) {
            dest = [match.x, match.z];
            heading = match.heading;
            castId = match.id;
        } else {
            const free = ENVOY_FALLBACK.find((p) => !used.some((u) => Math.hypot(u[0] - p[0], u[1] - p[1]) < 1.2) && !cast.some((c) => Math.hypot(c.x - p[0], c.z - p[1]) < 1.2)) ?? ENVOY_FALLBACK[i % ENVOY_FALLBACK.length]!;
            dest = free;
            heading = Math.PI;
        }
        used.push(dest);
        // 前の画：木戸の外から通りへ（2 人目は少し後ろ・道の反対側）
        const lane = i % 2 === 0 ? 1.0 : -0.5;
        const back = i * 1.3;
        const pathA: Pt[] = [
            [lane, 19.6 + back],
            [lane + 0.2, 6.0 + back],
        ];
        // 後の画：通りの北（開始の位置の東）から行き先へ。南から近づく（置き場所の 1.6 m 南を経る）
        const startB: Pt = [1.7 + (i % 2) * 1.1, -1.0 + (i % 2) * 1.0];
        const pathB: Pt[] = [startB, [dest[0], dest[1] + 1.6], dest];
        const LB = pathLength(pathB);
        if (reduced) {
            // 動かさない：城門の前の画に、着いた姿で現れる。名札を出すため、同じ人の会話の相手の人物は隠して演出の人に替える
            //（演出の間は会話の相手の名札を出さないので、そのままでは誰が誰か分からない）
            people.push({ key: w.key, look: w.look, name: w.name, x: dest[0], z: dest[1], heading, walked: 0, moving: 0, label: true });
            if (castId) hideCast.push(castId);
            return;
        }
        if (t < ARRIVAL_CUT) {
            const w0 = walkProgress(t, 0, ARRIVAL_SPEED, pathLength(pathA));
            const p = alongPath(pathA, w0.s);
            people.push({ key: w.key, look: w.look, name: w.name, x: p.x, z: p.z, heading: p.heading, walked: w0.s, moving: w0.moving, label: true });
            if (castId) hideCast.push(castId);
            return;
        }
        const w1 = walkProgress(t - ARRIVAL_CUT, i * 0.3, ARRIVAL_SPEED_B, LB);
        const arrived = w1.s >= LB - 1e-6;
        if (arrived && castId) return; // 着いた：会話の相手の人物に替わる（その人物を見せる）
        const p = alongPath(pathB, w1.s);
        const h = arrived ? heading : p.heading;
        people.push({ key: w.key, look: w.look, name: w.name, x: p.x, z: p.z, heading: h, walked: 30 + w1.s, moving: w1.moving, label: true });
        if (castId) hideCast.push(castId);
    });
    let s: StageShot;
    if (reduced) s = ARRIVAL_SHOT_B0;
    else if (t < ARRIVAL_CUT) s = lerpShot(ARRIVAL_SHOT_A0, ARRIVAL_SHOT_A1, ease(t / ARRIVAL_CUT));
    else s = lerpShot(ARRIVAL_SHOT_B0, ARRIVAL_SHOT_B1, ease((t - ARRIVAL_CUT) / 8));
    return { people, figures: [], banners: [], litters: [], shot: s, hideCast, hideAmbient: ['porter', 'merchant'] };
}

// ---------------- 詰所の負傷兵

/** 負傷兵の置き方（筵に横になる・床几に座る・小屋の南に座る）。町の人々（ambient）と同じ並び */
export function woundedLayout(count: number): StageFigure[] {
    const out: StageFigure[] = [];
    const n = Math.max(0, Math.min(12, Math.floor(count)));
    for (let i = 0; i < n; i++) {
        if (i < MATS.length) {
            const [x, z] = MATS[i]!;
            // 筵の上に仰向け（頭は向きの反対＝北）。少しずつ向きを変える
            out.push({ x, z: z + 0.1, y: 0.04, heading: ((i * 7) % 5 - 2) * 0.04, pose: 'lie', phase: i * 0.37, lean: 0, mark: DEFAULT_MARK, spear: false });
        } else if (i < MATS.length + GUARD_STOOLS.length) {
            const [x, z, h] = GUARD_STOOLS[i - MATS.length]!;
            out.push({ x, z, y: 0, heading: h, pose: 'sit', phase: i * 0.37, lean: 0.05, mark: DEFAULT_MARK, spear: false });
        } else {
            const k = i - MATS.length - GUARD_STOOLS.length;
            out.push({ x: HUT.x - 0.7 + k * 0.85, z: HUT.z + 2.55, y: 0, heading: 0, pose: 'sitGround', phase: i * 0.37, lean: 0, mark: DEFAULT_MARK, spear: false });
        }
    }
    return out;
}

const WOUNDED_SHOT_0 = shot(9.4, 2.4, 1.6, 13.0, 0.5, -3.6);
const WOUNDED_SHOT_1 = shot(9.9, 2.3, 0.9, 13.2, 0.5, -3.9);

function woundedRest(count: number, t: number, reduced: boolean): StageFrame {
    const figures = woundedLayout(count);
    const s = reduced ? WOUNDED_SHOT_0 : lerpShot(WOUNDED_SHOT_0, WOUNDED_SHOT_1, ease(t / 12));
    // 町の援兵も隠す（援兵が着く場面は、この後。着く前から詰所の横に立っていると順番が食い違う）
    return { people: [], figures, banners: [], litters: [], shot: s, hideCast: [], hideAmbient: ['wounded', 'reinforcement'] };
}

// ---------------- 隊列（出陣・帰還・援兵）

interface ColumnSlot {
    /** 頭からの後ろへの距離（m） */
    back: number;
    /** 横のずれ（進む向きの右が +） */
    side: number;
    role: 'soldier' | 'banner' | 'wounded' | 'helper' | 'bearer' | 'carried';
    /** 肩を貸す相手の方への傾き（+ で右） */
    lean: number;
}

/** 横の並びの位置（w 人） */
function sides(w: number): number[] {
    if (w <= 1) return [0];
    if (w === 2) return [-0.55, 0.55];
    return [-0.95, 0, 0.95];
}

/**
 * 隊列の並び（頭が 0、後ろへ back が増える）。旗持ちは先頭の右。負傷兵は後ろの列（肩を貸す人と並ぶ）、担架は最後。
 * count：見た目の人数（旗持ち・担架を運ぶ人も含む）、wounded：そのうち負傷して見える人数。
 */
export function columnSlots(count: number, wounded: number, abreast: number): ColumnSlot[] {
    const n = Math.max(0, Math.floor(count));
    const wn = Math.max(0, Math.min(n, Math.floor(wounded)));
    const out: ColumnSlot[] = [];
    if (n === 0) return out;
    const S = sides(abreast);
    let healthy = n - wn;
    let hurt = wn;
    // 担架（負傷 2 人以上・運ぶ人 2 人以上のとき、1 つ）
    const litter = hurt >= 2 && healthy >= 3;
    if (litter) {
        healthy -= 2;
        hurt -= 1;
    }
    // 先頭の列：旗持ち（右）と兵
    const rows: ColumnSlot[][] = [];
    let row: ColumnSlot[] = [];
    const push = (s: ColumnSlot) => {
        row.push(s);
        if (row.length === S.length) {
            rows.push(row);
            row = [];
        }
    };
    if (healthy > 0) {
        healthy--;
        push({ back: 0, side: 0, role: 'banner', lean: 0 });
    }
    // 肩を貸す組（負傷 1 人に元気な 1 人）の数
    const pairs = Math.min(hurt, Math.max(0, healthy - 0));
    const plainHealthy = healthy - pairs;
    for (let i = 0; i < plainHealthy; i++) push({ back: 0, side: 0, role: 'soldier', lean: 0 });
    if (row.length) {
        rows.push(row);
        row = [];
    }
    // 負傷兵の列（2 人ずつ：元気な人が肩を貸す。相手のいない負傷兵は一人で足を引きずる）
    let h = hurt;
    let p = pairs;
    while (h > 0) {
        const r: ColumnSlot[] = [];
        if (p > 0) {
            r.push({ back: 0, side: 0, role: 'helper', lean: 0.12 });
            r.push({ back: 0, side: 0, role: 'wounded', lean: -0.2 });
            p--;
            h--;
        } else {
            r.push({ back: 0, side: 0, role: 'wounded', lean: 0.16 });
            h--;
            if (h > 0 && S.length >= 2) {
                r.push({ back: 0, side: 0, role: 'wounded', lean: -0.16 });
                h--;
            }
        }
        rows.push(r);
    }
    let back = 0;
    for (const r of rows) {
        const ss = r.length === S.length ? S : sides(r.length);
        r.forEach((s, i) => out.push({ ...s, back, side: s.role === 'banner' ? S[S.length - 1]! : ss[i]! }));
        back += r.some((s) => s.role === 'wounded' || s.role === 'helper') ? ROW_GAP * 1.15 : ROW_GAP;
    }
    if (litter) {
        back += 0.4;
        out.push({ back, side: 0, role: 'bearer', lean: 0 });
        out.push({ back: back + 0.9, side: 0, role: 'carried', lean: 0 });
        out.push({ back: back + 1.8, side: 0, role: 'bearer', lean: 0 });
    }
    return out;
}

/** 隊列を道すじの上に置く（頭の距離 head。stopAt：止まって並ぶ所（頭の距離の上限）） */
function placeColumn(path: readonly Pt[], slots: ColumnSlot[], head: number, mark: string, moving: number, speedScale: number, banner: { open: boolean; tilt: number } | null): Pick<StageFrame, 'figures' | 'banners' | 'litters'> {
    const figures: StageFigure[] = [];
    const banners: StageBanner[] = [];
    const litters: StageLitter[] = [];
    for (const s of slots) {
        const d = head - s.back;
        const p = offsetAlong(path, d, s.side, true);
        const walking = moving > 0.05;
        const phase = Math.max(0, d) / STRIDE / speedScale;
        if (s.role === 'carried') {
            figures.push({ x: p.x, z: p.z, y: 0.62, heading: p.heading, pose: 'carried', phase, lean: 0, mark, spear: false });
            litters.push({ x: p.x, z: p.z, y: 0.6, heading: p.heading });
            continue;
        }
        const pose: FigurePose = !walking ? 'stand' : s.role === 'wounded' ? 'limp' : 'walk';
        figures.push({ x: p.x, z: p.z, y: 0, heading: p.heading, pose, phase, lean: s.lean, mark, spear: s.role === 'soldier' || s.role === 'helper' });
        if (s.role === 'banner' && banner) banners.push({ x: p.x, z: p.z, y: 0.95, heading: p.heading, mark, tilt: banner.tilt, open: banner.open });
    }
    return { figures, banners, litters };
}

const REINF_SHOT_0 = shot(-2.6, 2.3, 7.4, 0.4, 1.8, 16.8);
const REINF_SHOT_1 = shot(-2.6, 2.3, 7.4, 0.7, 1.5, 13.2);
const REINF_SPEED = 1.5;

function reinforcement(count: number, mark: string, t: number, reduced: boolean): StageFrame {
    const slots = columnSlots(Math.min(count, 12), 0, 2);
    const path = TO_GUARDPOST;
    // 頭の距離：始めは木戸の 4 m 外
    const start = pathLength([path[0]!, [0, KIDO.z + 4]]);
    const L = pathLength(path);
    let head: number;
    let moving = 1;
    if (reduced) {
        // 動かさない：木戸の内側に並んで立つ
        head = pathLength([path[0]!, path[1]!]) + 3.2;
        moving = 0;
    } else {
        const w = walkProgress(t, 0.2, REINF_SPEED, L - start);
        head = start + w.s;
        moving = w.moving;
    }
    const col = placeColumn(path, slots, head, mark, moving, 1, { open: true, tilt: 0 });
    const s = reduced ? REINF_SHOT_1 : lerpShot(REINF_SHOT_0, REINF_SHOT_1, ease(t / 7));
    return { people: [], ...col, shot: s, hideCast: [], hideAmbient: ['reinforcement', 'porter', 'merchant'] };
}

/** 出陣の画：通りの東（開始の位置の東）から城門を見て、出てくる隊列の頭を追う */
const DEPART_SHOT_0 = shot(3.4, 2.4, 0.6, -0.2, 2.0, -12.0);
const DEPART_SHOT_1 = shot(3.4, 2.4, 0.6, 0.0, 1.5, -3.0);
const DEPART_SPEED = 1.5;
/** 隊列が整って歩き出すまで（秒） */
export const DEPART_FORM_SEC = 0.8;

function columnDepart(count: number, mark: string, t: number, reduced: boolean): StageFrame {
    const n = Math.max(0, Math.min(24, Math.floor(count)));
    const slots = columnSlots(n, 0, n > 12 ? 3 : 2);
    const path = ROAD_OUT;
    // 頭の距離：始めは城門のすぐ北（城内で整っている）
    const s0 = pathLength([path[0]!, [0, -14.6]]);
    let head = s0;
    let moving = 0;
    if (reduced) {
        // 動かさない：城門を出た所（通りの北）に並んで立つ
        head = pathLength([path[0]!, [0, -6.5]]);
    } else {
        const w = walkProgress(t, DEPART_FORM_SEC, DEPART_SPEED, 60);
        head = s0 + w.s;
        moving = w.moving;
    }
    const col = placeColumn(path, slots, head, mark, moving, 1, { open: true, tilt: 0 });
    const s = reduced ? lerpShot(DEPART_SHOT_0, DEPART_SHOT_1, 0.5) : lerpShot(DEPART_SHOT_0, DEPART_SHOT_1, ease((t - 0.5) / 9));
    return { people: [], ...col, shot: s, hideCast: [], hideAmbient: ['preparing', 'guard'] };
}

/** 帰還の画：通りの西から南（木戸）を見て、入ってくる隊列を迎える */
const RETURN_SHOT_0 = shot(-2.8, 2.4, 8.0, 0.4, 1.8, 18.5);
const RETURN_SHOT_1 = shot(-2.8, 2.4, 8.0, 0.3, 1.5, 13.0);
const RETURN_SPEED = 1.2;

function columnReturn(count: number, wounded: number, mark: string, victory: boolean, t: number, reduced: boolean): StageFrame {
    const n = Math.max(0, Math.min(24, Math.floor(count)));
    const slots = columnSlots(n, wounded, n > 12 ? 3 : 2);
    const path = ROAD_IN;
    const s0 = pathLength([path[0]!, [0, KIDO.z + 4.6]]);
    let head = s0;
    let moving = 1;
    if (reduced) {
        // 動かさない：木戸をくぐった所に止まって並ぶ
        head = pathLength([path[0]!, [0, KIDO.z - 4.5]]);
        moving = 0;
    } else {
        const w = walkProgress(t, 0.2, RETURN_SPEED, 60);
        head = s0 + w.s;
        moving = w.moving;
    }
    // 勝てば旗を掲げる（真っすぐ・広げる）。勝てなければ旗を巻いて傾けて運ぶ
    const col = placeColumn(path, slots, head, mark, moving, RETURN_SPEED / DEPART_SPEED, victory ? { open: true, tilt: 0 } : { open: false, tilt: 0.55 });
    const s = reduced ? lerpShot(RETURN_SHOT_0, RETURN_SHOT_1, 0.6) : lerpShot(RETURN_SHOT_0, RETURN_SHOT_1, ease(t / 9));
    return { people: [], ...col, shot: s, hideCast: [], hideAmbient: ['porter', 'merchant'] };
}

/** 確かめ用：出来事の id ごとの、カメラが通る所を t の列で返す（カメラ除けの確かめ・ゆっくりの確かめ） */
export function shotsOver(ev: StageEvent, reduced: boolean, until = 20, step = 0.1, cast: readonly StageCastInfo[] = []): { t: number; shot: StageShot }[] {
    const out: { t: number; shot: StageShot }[] = [];
    const n = Math.round(until / step);
    for (let i = 0; i <= n; i++) {
        const t = Math.round(i * step * 1000) / 1000;
        out.push({ t, shot: stageFrame(ev, t, reduced, cast).shot });
    }
    return out;
}
