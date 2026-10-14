/**
 * 演出の 3D の出来事（StageEvent）を、時刻 t（秒。場面の始めから）の純粋な関数で置く（three も DOM も使わない）。
 * 同じ出来事・同じ t・同じ配役なら、いつも同じ形（一時停止・飛ばし・見直しで同じ）。描くのは explore/actors.ts。
 * 設計：docs/story-rpg-design.md §1・§2、記録：docs/story-rpg-town.md。
 *
 * - 人（使者・使い）は人物の素材の写し（歩き・立ち）。兵は合戦の兵の形（軽い）。旗は出来事の一文字。
 * - カメラは決めた位置と見る点を、ゆっくり（なめらかに）動かす。カメラ除けの箱には入らない（tests/proto3d-town-stage.test.ts）。
 *   場面の途中で 1 回だけ「切り替え」（カット）を入れる出来事がある（使者：街道口の画 → 城門の前の画）。切り替えは動きではなく画の替わり。
 * - reduced（動きを減らす）：カメラは動かさず（決めた位置の静止した画）、人と兵は歩かずにその画の位置に現れる（t によらない）。
 * - 主人公は出来事の間は描かない（動かさない）。ただし冒頭の出来事（town_life の hero・envoys_arrive の showHero・retainer_report）は、
 *   主人公を町の入口（town/spots.ts の ENTRY_POSE）に立たせて見せる（StageFrame.hero。向きも t の関数。片付けで始める前の位置・向きへ戻す）。
 * - 会話の相手の人物と出来事の人が同じ人なら、着くまでその人物を隠し、着いたら人物に替わる。
 * - Version 28 §4.3：第一章の冒頭は町の入口の主人公へ寄る 1 つのカメラの動き（town_life の establish）。終わりの画は操作の肩越しのカメラと同じ。
 *   町の急報（street_report）は操作の途中に、出来事を始めた時の主人公（StageOrigin）の所で起きる。出来事の人は会話の相手そのもの
 *  （StagePerson.cast。描く側は同じ人物として描き、入れ替えない）で、出来事の後も同じ関数（t が場面の長さより後）で話せる位置まで歩く。
 * - Version 28 §4.3 の最後の項：第二章の冒頭の使いの急報（messenger_arrive の report）も同じ作り（使いは止まってから言う・家臣は置き場所から
 *   歩いて来る・主人公は町の入口で振り向く・後の歩き）。号令ありの出陣（column_depart の order）は、主人公が号令して隊列の道を空け、
 *   会話の相手の人物（隠さない）と見送る。
 */
import { GAIT, runBlendFor, strideFor } from '../game/gait';
import { START, cameraBlockers, colliders, type Box, type Rect } from '../layout';
import type { AmbientGroup, StageEvent } from '../story/types';
import { GROUND_SITS, GUARD_STOOLS, KIDO, MATS } from '../town/plan';
import { ENTRY_POSE } from '../town/spots';
import { BOW_SEC, NO_ACT, bowWeight, merchantAct, rhythmOf, seeded, type PersonAct } from './rhythm';

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
    /**
     * 槍を後ろへ担ぐ角度（ラジアン。無ければ 0＝立てて持つ）。木戸（横木の下 2.98 m）をくぐる前に槍を寝かせ、くぐった後も担いだまま
     * 歩く（立てた槍の先は 3.75 m で、横木・屋根に刺さって見え、木戸の外から見ると横木から吊られて見えた）
     */
    spearTilt?: number;
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
    /** 肩に荷（俵）を担ぐか（町の人。省けば荷を持たない） */
    carrying?: boolean;
    /** 上体の動き（店の人の仕事・荷を持ち上げる。町の人。explore/rhythm.ts） */
    act?: PersonAct;
    /** 近くを主人公が通ると軽く会釈する（店の人。描く側 explore/actors.ts が主人公の位置で決める） */
    greet?: boolean;
    /**
     * 会話の相手の id（町の急報の使者・家臣）：この人は出来事の間も後も、その会話の相手の人物そのもの（描く側は同じ人物として描き、
     * 着いた所で入れ替えない。名前の鍵 key も同じ id）
     */
    cast?: string;
    /** 走りの重み（0 歩き〜1 走り。省けば 0） */
    run?: number;
    /** 歩き・走りの周期の数（1 周期の距離で割って足した物。省けば walked と歩きの 1 周期の距離から。走りから止まるとき位相が飛ばない） */
    cycle?: number;
}

/** 出来事の間の主人公（立たせる位置と向き。無ければ主人公を描かない） */
export interface StageHero {
    x: number;
    z: number;
    heading: number;
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
    /** 主人公を見せる（町の入口に立たせる）。null なら描かない */
    hero: StageHero | null;
    /** 出来事の後、主人公を始める前の位置・向きへ戻さず、そのまま（町の急報：主人公はその場で振り向いただけ） */
    heroStays?: boolean;
    /** 主人公の顔と目線を向ける所（世界。null は正面。省けば変えない） */
    heroGaze?: { x: number; y: number; z: number } | null;
    /** 出来事の後の歩き（StagePerson.cast の人）が、みな置き場所に着いて向き直った（町の急報。これより後は会話の相手の人物のまま） */
    settled?: boolean;
}

/**
 * 出来事を始めた時の主人公（位置・向き・進む向き・速さ）と、肩越しのカメラの見回しの向き（game/follow.ts の Orbit.yaw。0 = 北を見る）。
 * 操作の途中に始める出来事（町の急報）の人とカメラは、ここから決める（同じ origin・同じ t なら同じ形）
 */
export interface StageOrigin {
    x: number;
    z: number;
    heading: number;
    dirX: number;
    dirZ: number;
    speed: number;
    yaw: number;
}

/** 置いている会話の相手（見た目の鍵と場所。使者の行き先を決める） */
export interface StageCastInfo {
    id: string;
    kind: string;
    look?: string;
    x: number;
    z: number;
    heading: number;
    /** 座っている人（省けば立つ）。出陣の見送り（立って隊列の方を向く）は立つ人だけ */
    pose?: 'stand' | 'sit';
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

/** 道の角を丸める弧の半径（m）。角の手前・先の線が短いときは小さくする（roundPath） */
export const CORNER_R = 0.8;
/** 弧を細かな線に分けるときの、1 本の線で曲がる角度の上限（ラジアン。4°） */
const ARC_STEP = (4 * Math.PI) / 180;
const roundCache = new WeakMap<readonly Pt[], Pt[]>();

/**
 * 折れ線の角を円の弧で丸めた折れ線（Version 28 §4.2：道の角で向きが 1 コマで折れない）。弧は 4° ずつの細かな線にする。
 * 両端の点・角から離れた所の線は元のまま（道すじの点は動かさない。角の内側を少し近道するだけ）。
 * 弧の始まり・終わりは角から CORNER_R·tan(曲がる角 / 2) の所で、角の手前・先の線の長さの 45% まで（短い線が続く所は半径を小さく）。
 * 歩く人の向きは弧の上で少しずつ変わる（tests/proto3d-townsfolk.test.ts：60 コマ/秒で 1 コマ 12° まで）。
 * 同じ折れ線（同じ配列）には同じ結果を返す（作り直さない）。
 */
export function roundPath(path: readonly Pt[], r = CORNER_R): Pt[] {
    const cached = r === CORNER_R ? roundCache.get(path) : undefined;
    if (cached) return cached;
    const n = path.length;
    const out: Pt[] = n ? [path[0]!] : [];
    for (let i = 1; i < n - 1; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const c = path[i + 1]!;
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
        if (l1 < 1e-6 || l2 < 1e-6) continue;
        const u1 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1] as const;
        const u2 = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2] as const;
        const cross = u1[0] * u2[1] - u1[1] * u2[0];
        const phi = Math.atan2(Math.abs(cross), u1[0] * u2[0] + u1[1] * u2[1]);
        if (phi < 1e-3) {
            out.push(b);
            continue;
        }
        const tanH = Math.tan(phi / 2);
        const d = Math.min(r * tanH, 0.45 * l1, 0.45 * l2);
        const rho = d / tanH;
        const p1: Pt = [b[0] - u1[0] * d, b[1] - u1[1] * d];
        // 弧の中心：p1 から、曲がる側へ rho（x・z の面で反時計回りに曲がる（cross > 0）なら、進む向きを反時計回りに 90° 回した側）
        const sgn = cross > 0 ? 1 : -1;
        const cx = p1[0] - u1[1] * rho * sgn;
        const cz = p1[1] + u1[0] * rho * sgn;
        const a0 = Math.atan2(p1[0] - cx, p1[1] - cz);
        const k = Math.max(1, Math.ceil(phi / ARC_STEP));
        // 弧の上の点（中心から見た角は z 軸から x 軸へ測る。反時計回りに曲がるとき、この角は減る）
        for (let j = 0; j <= k; j++) {
            const ang = a0 - sgn * phi * (j / k);
            out.push([cx + Math.sin(ang) * rho, cz + Math.cos(ang) * rho]);
        }
    }
    if (n > 1) out.push(path[n - 1]!);
    if (r === CORNER_R) roundCache.set(path, out);
    return out;
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
const round3 = (v: number) => Math.round(v * 1000) / 1000;
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
/** 向き a から b へ k（0〜1）だけ回す（近い回り） */
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
/** 向きを丸める（JSON にしても同じ値。t の純粋な関数の確かめ） */
const roundH = (h: number) => Math.round(h * 1e6) / 1e6;

// ---------------- 槍・のぼりの先（explore/troops.ts の形と同じ寸法。木戸の横木との重なりの確かめに使う）

/** 町の兵の大きさ（explore/troops.ts の TOWN_FIG と同じ） */
const FIG = 0.82;
/** 槍を担ぐときの回しの中心（手。形の 1 m 単位・前が −z）と、そこから槍の先までの長さ・立てた槍の前への傾き */
export const SPEAR_HAND = { x: 0.36, y: 1.3, z: -0.04 } as const;
const SPEAR_REACH = 3.34;
const SPEAR_LEAN = 0.21;
/** 木戸をくぐるときに槍を担ぐ角度・のぼりを倒す角度（先が 2.7 m ほど：横木の下 2.98 m より下） */
export const GATE_SPEAR_TILT = 1.15;
export const GATE_BANNER_TILT = 0.95;
/** のぼりの竿の長さと、根元（手）から下へ出る分（explore/troops.ts と同じ） */
export const BANNER_POLE = 3.6;
const BANNER_BELOW = 0.6;

/** 兵の槍の先の位置（地面の起伏は含めない）。heading は 0 = +z を向く */
export function spearTip(f: Pick<StageFigure, 'x' | 'z' | 'y' | 'heading' | 'spearTilt'>): { x: number; y: number; z: number } {
    // 形の中（前が −z）で：手から先へ、前へ SPEAR_LEAN、担ぐと後ろへ spearTilt
    const a = SPEAR_LEAN - (f.spearTilt ?? 0);
    const fwd = SPEAR_HAND.z * -1 + SPEAR_REACH * Math.sin(a); // 前（−z）へ出る量
    const up = SPEAR_HAND.y + SPEAR_REACH * Math.cos(a);
    // 形の前（−z）は、置くと向き heading の方（(sin h, cos h)）。横（形の +x）は向きの右
    const side = SPEAR_HAND.x;
    return {
        x: f.x + (Math.sin(f.heading) * fwd - Math.cos(f.heading) * side) * FIG,
        y: f.y + up * FIG,
        z: f.z + (Math.cos(f.heading) * fwd + Math.sin(f.heading) * side) * FIG,
    };
}

/** のぼりの竿の先の位置（地面の起伏は含めない）。後ろ（進む向きの反対）へ tilt だけ傾く */
export function bannerTop(b: Pick<StageBanner, 'x' | 'z' | 'y' | 'heading' | 'tilt'>): { x: number; y: number; z: number } {
    const L = BANNER_POLE - BANNER_BELOW;
    const bx = b.x - Math.cos(b.heading) * 0.3;
    const bz = b.z + Math.sin(b.heading) * 0.3;
    return { x: bx - Math.sin(b.heading) * Math.sin(b.tilt) * L, y: b.y + Math.cos(b.tilt) * L, z: bz - Math.cos(b.heading) * Math.sin(b.tilt) * L };
}

/** 1 歩の周期で進む距離（m。人物の歩きの動き 0.84 秒 × 1.4 m/秒） */
export const STRIDE = 1.18;

/** 歩き出し・止まりで速さが変わる秒（Version 28 §4.2：全速のまま 1 コマで止まらない） */
export const WALK_ACCEL = 0.5;
export const WALK_DECEL = 0.6;

/** なめらかな 0→1（smoothstep）の 0〜x の積分（x は 0〜1） */
const easeInt = (x: number) => x * x * x - (x * x * x * x) / 2;

/**
 * 距離 L を、止まった所から歩き出して止まった所で止まる歩き（歩き出しから tt 秒）。速さは歩き出し WALK_ACCEL 秒・止まり WALK_DECEL 秒で
 * なめらかに変わり（速さが smoothstep、距離はその積分）、間は速さ v。短くて速さ v に届かない道は、同じ形のまま上の速さを下げる。
 * 返り：s 歩いた距離・v 今の速さ・T 歩き終わる秒
 */
export function walkProfile(tt: number, v: number, L: number): { s: number; v: number; T: number } {
    const A = WALK_ACCEL;
    const D = WALK_DECEL;
    if (L <= 0 || v <= 0) return { s: 0, v: 0, T: 0 };
    const V = Math.min(v, (2 * L) / (A + D));
    const T = L / V + (A + D) / 2;
    if (tt <= 0) return { s: 0, v: 0, T };
    if (tt >= T) return { s: L, v: 0, T };
    if (tt < A) return { s: V * A * easeInt(tt / A), v: V * ease(tt / A), T };
    const left = T - tt;
    if (left < D) return { s: L - V * D * easeInt(left / D), v: V * ease(left / D), T };
    return { s: V * (tt - A / 2), v: V, T };
}

/** 歩きの動きの重み（今の速さから。止まりかけは待機の形へ混ぜる。主人公の game/heroAnim.ts と同じ決まり） */
export function movingFor(v: number): number {
    const x = clamp01((v - 0.05) / 0.45);
    return round3(x * x * (3 - 2 * x));
}

/**
 * 歩いて行く距離（t 秒で、遅れ delay・速さ v・長さ L）。歩き出しと止まりはなめらかに速さが変わる（walkProfile）。
 * 返り：{ s：歩いた距離、moving：歩いているか（0〜1。今の速さから） }
 */
export function walkProgress(t: number, delay: number, v: number, L: number): { s: number; moving: number } {
    const w = walkProfile(t - delay, v, L);
    return { s: w.s, moving: movingFor(w.v) };
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
/** 木戸から援兵の並ぶ所へ（通りを北へ、詰所の前の休み場の北の空き地（ambient.ts の REINFORCEMENT_AT）へ東へ寄る） */
const TO_GUARDPOST: readonly Pt[] = [
    [0, 34],
    [0, KIDO.z],
    [0.3, 4.0],
    [1.2, -3.2],
    [3.0, -4.7],
    [4.55, -4.7],
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

/** 出来事の形（純粋。同じ引数なら同じ形）。origin は操作の途中に始める出来事（町の急報）の、始めた時の主人公（省けば決めた所） */
export function stageFrame(ev: StageEvent, t: number, reduced: boolean, cast: readonly StageCastInfo[] = [], origin: StageOrigin = REPORT_DEFAULT_ORIGIN): StageFrame {
    const tt = Math.max(0, t);
    switch (ev.id) {
        case 'street_report':
            return streetReport(ev, tt, reduced, origin);
        case 'envoys_arrive':
            return arrivals(
                ev.envoys.map((e, i) => ({ key: `envoy${i}`, look: e.look, name: e.name })),
                tt,
                reduced,
                cast,
                !!ev.showHero,
            );
        case 'messenger_arrive':
            if (ev.report) return messengerReport(ev as MessengerReportEvent, tt, reduced);
            return arrivals([{ key: 'messenger', look: ev.look, name: ev.name }], tt, reduced, cast, false);
        case 'town_life':
            return ev.establish ? establish(tt, reduced) : townLife(ev.hero, tt, reduced);
        case 'retainer_report':
            return retainerReport(ev.look, ev.name, ev.castId, tt, reduced);
        case 'wounded_rest':
            return woundedRest(ev.count, tt, reduced);
        case 'reinforcement_arrive':
            return reinforcement(ev.count, ev.mark || DEFAULT_MARK, tt, reduced);
        case 'column_depart':
            if (ev.order !== undefined) return departWithHero(ev.count, ev.mark || DEFAULT_MARK, ev.order, tt, reduced, cast, origin);
            return columnDepart(ev.count, ev.mark || DEFAULT_MARK, tt, reduced, cast);
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

/**
 * 冒頭（showHero）：主人公は町の入口（ENTRY_POSE）に北を向いて立つ。前の画は主人公の北（通り）から南の木戸を見る：主人公を正面に、
 * 使者が木戸から入って主人公の脇を通る（2 人の道は主人公の東 1.7 m・3.8 m。名札は横に 2.1 m 離れる）。主人公は先の使者を目で追う。
 * 後の画は前と同じ（城門の前の置き場所）。動きを減らすときは、主人公の背中越しに通りの先（城門の前に着いた使者）を見る静止の画。
 */
const HERO_ARRIVAL_SHOT_A0 = shot(-2.1, 2.0, 8.4, 0.2, 1.5, 17.0);
const HERO_ARRIVAL_SHOT_A1 = shot(-1.9, 2.0, 8.7, 0.3, 1.45, 16.4);
const HERO_ARRIVAL_SHOT_R = shot(0.2, 2.3, 15.6, 0.6, 1.3, -5.0);
/** 主人公を見せるときの使者の道（主人公の東 1.7 m・3.8 m を北へ。西は木戸の柱が近い） */
const HERO_LANES = [ENTRY_POSE.x + 1.7, ENTRY_POSE.x + 3.8] as const;

function arrivals(who: { key: string; look: string; name: string }[], t: number, reduced: boolean, cast: readonly StageCastInfo[], showHero: boolean): StageFrame {
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
        // 前の画：木戸の外から通りへ（2 人目は少し後ろ・道の反対側）。2 人の横の間は 2.5 m（木戸の柱は ±2.9 m）：
        // 街道口の画で頭の上の名札が横に並んで重ならない（重なりそうなときは名札の側でも上下にずらす：actors.ts）。
        // 主人公を見せるときは、主人公（x −0.2）の両脇を通る道（横の間 3.2 m）
        const lane = showHero ? HERO_LANES[i % 2]! : i % 2 === 0 ? 1.4 : -1.1;
        const back = i * 1.3;
        const pathA: Pt[] = [
            [lane, 19.6 + back],
            [lane + (showHero ? 0 : 0.2), 6.0 + back],
        ];
        // 後の画：通りの北（開始の位置の東）から行き先へ。南から近づく（置き場所の 1.6 m 南を経る）。角は丸める（向きが 1 コマで折れない）
        const startB: Pt = [1.7 + (i % 2) * 1.1, -1.0 + (i % 2) * 1.0];
        const pathB = roundPath([startB, [dest[0], dest[1] + 1.6], dest]);
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
        // 着いた後（人物に替わらないとき）は、止まってから 0.6 秒で置き場所の向きへ向き直る（1 コマで向きを飛ばさない）
        const h = arrived ? roundH(lerpAngle(p.heading, heading, ease((t - ARRIVAL_CUT - arrivalTime(i * 0.3, ARRIVAL_SPEED_B, LB)) / 0.6))) : p.heading;
        people.push({ key: w.key, look: w.look, name: w.name, x: p.x, z: p.z, heading: h, walked: 30 + w1.s, moving: w1.moving, label: true });
        if (castId) hideCast.push(castId);
    });
    let s: StageShot;
    if (reduced) s = showHero ? HERO_ARRIVAL_SHOT_R : ARRIVAL_SHOT_B0;
    else if (t < ARRIVAL_CUT) s = showHero ? lerpShot(HERO_ARRIVAL_SHOT_A0, HERO_ARRIVAL_SHOT_A1, ease(t / ARRIVAL_CUT)) : lerpShot(ARRIVAL_SHOT_A0, ARRIVAL_SHOT_A1, ease(t / ARRIVAL_CUT));
    else s = lerpShot(ARRIVAL_SHOT_B0, ARRIVAL_SHOT_B1, ease((t - ARRIVAL_CUT) / 8));
    let hero: StageHero | null = null;
    if (showHero) {
        // 主人公：初めは北（城門）を向き、0.4 秒から 1.8 秒かけて先の使者の方へ向き直り、通り過ぎるのを目で追う（使者の道は主人公の脇 1.6 m なので向きは飛ばない）。
        // 後の画（城門の前）には映らないが、向きは使者の行った北のまま
        let h: number = ENTRY_POSE.heading;
        const lead = people[0];
        if (!reduced && lead && t < ARRIVAL_CUT) h = lerpAngle(ENTRY_POSE.heading, Math.atan2(lead.x - ENTRY_POSE.x, lead.z - ENTRY_POSE.z), ease((t - 0.4) / 1.8));
        hero = { x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: roundH(h) };
    }
    return { people, figures: [], banners: [], litters: [], shot: s, hideCast, hideAmbient: ['porter', 'merchant'], hero };
}

// ---------------- 町の様子（章の冒頭の最初の画）

/**
 * 木戸の内（主人公の右うしろ・目の高さより少し上 2.1 m）から、北の城門へ向かう通りを見る（ゆっくり前へ寄る）。
 * 画の中：主人公の背中（左の手前）・荷置き場から店先へ俵を運ぶ人（左）・町家 D の店先へ運ぶ人（右）・店先でお辞儀する店の人・
 * 詰所の前の休み場（右の奥。負傷兵がいれば筵の上）・遠くの城門（門番）。町の人々の荷運び・店の人は隠し、この出来事が同じ人々を
 * 決まった道に出す（どの時刻に始めても同じ画）。
 */
export const TOWN_LIFE_SHOT_0 = shot(0.9, 2.05, 16.1, -1.1, 1.15, 2.0);
export const TOWN_LIFE_SHOT_1 = shot(0.75, 2.15, 15.7, -0.95, 1.3, 0.0);
/** カメラが寄り終わるまで（秒） */
const TOWN_LIFE_SEC = 10;
/** 町の様子の人：荷置き場 → 町家 B の店先（荷を担ぐ）・町家の写しの前 → 町家 D の店先（荷を担ぐ）・店先の店の人 */
const LIFE_PORTER_W: readonly Pt[] = [
    [-8.0, 8.85],
    [-4.9, 8.75],
    [-3.1, 7.6],
    [-3.1, 6.6],
];
const LIFE_PORTER_E: readonly Pt[] = [
    [3.2, 12.0],
    [3.2, 7.2],
    [3.45, 6.7],
];
const LIFE_MERCHANT = { x: -3.6, z: 2.6, heading: Math.PI / 2 } as const;

function townLife(withHero: boolean, t: number, reduced: boolean): StageFrame {
    const people: StagePerson[] = [];
    // 荷運び：人ごとの速さ（explore/rhythm.ts）で、角を丸めた道を歩き出して止まる
    const walker = (key: string, look: string, path: readonly Pt[], delay: number) => {
        const P = roundPath(path);
        const L = pathLength(P);
        const w = reduced ? { s: L, moving: 0 } : walkProgress(t, delay, rhythmOf(key).speed, L);
        const p = alongPath(P, w.s);
        people.push({ key, look, name: '', x: p.x, z: p.z, heading: p.heading, walked: w.s, moving: w.moving, label: false, carrying: true });
    };
    walker('life_porter_w', 'townsman_a', LIFE_PORTER_W, 0.3);
    walker('life_porter_e', 'townsman_b', LIFE_PORTER_E, 1.0);
    // 店の人：待機・通りを見る・品物を整える（減らすときは待機のまま）
    const m = reduced ? { heading: LIFE_MERCHANT.heading, act: undefined } : merchantAct('life_merchant', LIFE_MERCHANT.x, LIFE_MERCHANT.z, LIFE_MERCHANT.heading, t);
    people.push({ key: 'life_merchant', look: 'merchant_a', name: '', x: LIFE_MERCHANT.x, z: LIFE_MERCHANT.z, heading: m.heading, walked: 0, moving: 0, label: false, carrying: false, ...(m.act ? { act: m.act } : {}) });
    const s = reduced ? TOWN_LIFE_SHOT_0 : lerpShot(TOWN_LIFE_SHOT_0, TOWN_LIFE_SHOT_1, ease(t / TOWN_LIFE_SEC));
    const hero = withHero ? { x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading } : null;
    return { people, figures: [], banners: [], litters: [], shot: s, hideCast: [], hideAmbient: ['porter', 'merchant'], hero };
}

// ---------------- 第一章の冒頭の短い始め（Version 28 §4.3）

/** 冒頭のカメラの動きの長さ（秒。台本の最初の字幕の長さと同じ：cinematics.ts の ch1Open） */
export const ESTABLISH_SEC = 4.1;
/** 動きの始め：木戸の内の高い所（主人公の右うしろの上）から、北の城門へ向かう通りを見下ろす */
const ESTABLISH_SHOT_0 = shot(1.4, 4.4, 14.6, -0.6, 1.2, 4.0);
/** 肩越しのカメラの決まり（game/follow.ts の FOLLOW と同じ値：見る中心は頭の高さ・右へずらす量・距離。tests/proto3d-street-report.test.ts が照らし合わせる） */
export const FOLLOW_GEOM = { height: 1.5, shoulder: 0.38, distance: 2.1 } as const;

/** 壁の無い所での肩越しのカメラ（game/follow.ts の placeFollow と同じ置き方。見る点は見る中心から 10 m 先） */
export function followShotAt(x: number, z: number, yaw: number, pitch: number): StageShot {
    const px = x + Math.cos(yaw) * FOLLOW_GEOM.shoulder;
    const pz = z - Math.sin(yaw) * FOLLOW_GEOM.shoulder;
    const py = FOLLOW_GEOM.height;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = -Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const D = FOLLOW_GEOM.distance;
    return shot(px - dx * D, py - dy * D, pz - dz * D, px + dx * 10, py + dy * 10, pz + dz * 10);
}

/**
 * 町の入口の主人公の肩越しのカメラ（操作の始めのカメラ：game/follow.ts の placeFollow に、見回し yaw 0（北を見る）・pitch START.pitch・距離 2.1。
 * main.ts の setHeroPose が町の入口で決める見回しと同じ）。冒頭の動きはここで終わるので、切らずに操作へ渡せる
 */
export const ENTRY_FOLLOW_SHOT: StageShot = followShotAt(ENTRY_POSE.x, ENTRY_POSE.z, 0, START.pitch);

/**
 * 第一章の冒頭（establish）：高い所から町の入口の主人公の肩越しへ、1 つのなめらかな動きで寄る（始めと終わりで速さ 0）。
 * 町の人々（荷運び・店の人）は隠さず、出来事の人も出さない（操作へ移っても人が入れ替わらない）。動きを減らすときは終わりの画のまま
 */
function establish(t: number, reduced: boolean): StageFrame {
    const s = reduced ? ENTRY_FOLLOW_SHOT : lerpShot(ESTABLISH_SHOT_0, ENTRY_FOLLOW_SHOT, ease(t / ESTABLISH_SEC));
    return { people: [], figures: [], banners: [], litters: [], shot: s, hideCast: [], hideAmbient: [], hero: { x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading } };
}

// ---------------- 町の急報（Version 28 §4.3：操作の途中の短い出来事）

/**
 * 急報を始める所：通りを北へ、この線（z）より北へ入ったとき。城門へ行くどの道も、この線（通りの中）を越えるか、町家の裏の道から
 * 城門の前の広場で通りへ入る（その時に始める）。通りの幅は町家の表から表まで（x）、城門の内（z < −11.6）では始めない。
 * tests/proto3d-street-report.test.ts が当たり判定の地図で、町の入口から忠勝の所までのどの道もここを通ることを確かめる
 */
export const REPORT_LINE_Z = 6.0;
export const REPORT_STREET = { x0: -4.2, x1: 4.6, z0: -11.6 } as const;
export function inReportZone(x: number, z: number): boolean {
    return z < REPORT_LINE_Z && z > REPORT_STREET.z0 && x > REPORT_STREET.x0 && x < REPORT_STREET.x1;
}

/** 決めた所（確かめ・見直しで origin を省いたとき）：通りの真ん中を北へ歩いて線を越えたところ。見回しは北 */
export const REPORT_DEFAULT_ORIGIN: StageOrigin = { x: 0.3, z: REPORT_LINE_Z - 0.05, heading: Math.PI, dirX: 0, dirZ: -1, speed: GAIT.walk.speed, yaw: 0 };

/** 集まる所（主人公の止まる所を通りの中へ収めた点）の範囲。カメラはここからの相対で決める（人の止まる所は主人公からの相対） */
const REPORT_ANCHOR = { x0: -1.6, x1: 1.8, z0: -9.6, z1: REPORT_LINE_Z } as const;
/** 主人公の止まりの減速（game/motion.ts の DECEL と同じ 12 m/秒²：操作で手を離したときと同じ止まり方） */
const HERO_DECEL = 12;
/** 最初の台詞（織田の使者）の時刻（秒）。使者はその少し前に止まり、片膝をつきながら言う（cinematics.ts が字幕の時刻に使う） */
export const REPORT_LEAD = 1.55;
/** 織田の使者：走る速さ・走り始める所（集まる所から南へ）・止まるのにかける秒 */
const ODA_RUN = 3.6;
const ODA_FROM = 5.6;
const ODA_DECEL = 0.9;
/** 浅井の使者：急ぎ足の速さ・止まるのにかける秒・言い始める何秒前に止まるか */
const ASAI_WALK = 1.9;
const ASAI_DECEL = 0.8;
const ASAI_EARLY = 0.5;
/** 忠勝：止まってから言い始めるまで（秒）・歩く速さの範囲 */
const RET_EARLY = 0.45;
const RET_SPEED = [1.1, 1.85] as const;
/** 止まる所（主人公の止まった所からの相対 [x, z]。南が +z）。浅井の使者は通りの東の端（荷運びの道 x 3.2）に寄りすぎない */
const ODA_AT: Pt = [0.25, 2.0];
const ASAI_AT: Pt = [1.15, 1.55];
const ASAI_X_MAX = 2.35;
const RET_AT: Pt = [-0.5, -1.85];
/** 忠勝が北に止まれる所の南の限り（これより北は城門の柱・塀） */
const RET_Z_MIN = -10.9;
/** 出来事の後の歩き：速さと、歩き出し（場面の終わりからの秒） */
const AFTER = { oda: { speed: 1.3, start: 0.95 }, asai: { speed: 1.25, start: 0.3 }, ret: { speed: 1.35, start: 0.25 } } as const;
/** 着いてから置き場所の向きへ向き直る秒・歩き出しで道の向きへ向く秒 */
const FACE_SEC = 0.7;
const SET_OFF_SEC = 0.5;
/** 片膝をつく・立つ秒 */
const KNEEL_SEC = 0.55;
/** 頭の高さ（立つ・片膝） */
const HEAD_Y = 1.5;
const KNEEL_HEAD_Y = 1.05;
/** 人が主人公の脇を通るときに空ける間（m） */
const BERTH = 0.95;

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const headingTo = (a: { x: number; z: number } | Pt, b: { x: number; z: number } | Pt): number => {
    const ax = Array.isArray(a) ? a[0] : (a as { x: number }).x;
    const az = Array.isArray(a) ? a[1] : (a as { z: number }).z;
    const bx = Array.isArray(b) ? b[0] : (b as { x: number }).x;
    const bz = Array.isArray(b) ? b[1] : (b as { z: number }).z;
    return Math.atan2(bx - ax, bz - az);
};
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 人が立てる所か（家・塀・小物の当たり判定から、人の大きさ 0.3 m 離れている） */
const WALK_RECTS: readonly Rect[] = colliders();
function standable(x: number, z: number, pad = 0.3): boolean {
    return WALK_RECTS.every((r) => x < r.x0 - pad || x > r.x1 + pad || z < r.z0 - pad || z > r.z1 + pad);
}

/** 主人公の止まる所：始めた時の速さで、進む向きへ減速して止まる（当たり判定にかかるなら、その場） */
function heroStop(o: StageOrigin): { x: number; z: number; T: number; d: number } {
    const v = Math.max(0, o.speed);
    const d = (v * v) / (2 * HERO_DECEL);
    const len = Math.hypot(o.dirX, o.dirZ) || 1;
    const x = o.x + (o.dirX / len) * d;
    const z = o.z + (o.dirZ / len) * d;
    if (d < 1e-4 || !standable(x, z)) return { x: o.x, z: o.z, T: 0, d: 0 };
    return { x, z, T: v / HERO_DECEL, d };
}

/** 速さ V のまま来た人が、最後の D 秒でなめらかに止まる（距離 L。始めから速さ V。返り：s 進んだ距離・v 今の速さ・T 止まる秒） */
export function arriveProfile(t: number, V: number, L: number, D: number): { s: number; v: number; T: number } {
    if (L <= 0 || V <= 0) return { s: 0, v: 0, T: 0 };
    const T = L / V + D / 2;
    if (t <= 0) return { s: 0, v: V, T };
    if (t >= T) return { s: L, v: 0, T };
    const left = T - t;
    if (left > D) return { s: V * t, v: V, T };
    return { s: L - V * D * easeInt(left / D), v: V * ease(left / D), T };
}

/**
 * 歩くだけの人（急報の使者・家臣）の周期の数：歩いた距離 ÷ 動きの元の歩きの 1 周期の距離。人ごとの歩幅の倍率（rhythm.stride）で
 * 歩きの重みを下げて待機の形と混ぜない（足が低く上がり、持ち上がりきる前に横へ動き出して地面をこすった）。急ぎ足・ゆっくりは歩く拍子の速さで
 */
const walkCycles = (walked: number) => Math.round((walked / GAIT.walk.stride) * 1e5) / 1e5;

/** 走りの重み（実際の速さから。主人公と同じ決まり：game/gait.ts の runBlendFor） */
const runOf = (v: number) => runBlendFor(v, GAIT.walk.speed, GAIT.run.speed);
/** 止まりの間の周期の数の表（1/240 秒ごとの足し合わせ。V・L・D ごと） */
const cycleTables = new Map<string, number[]>();
const CYCLE_STEP = 1 / 240;
/** 速さ V のまま走って来て止まる人の、歩き・走りの周期の数（∫ 速さ ÷ その速さの 1 周期の距離。止まりかけで位相が飛ばない。t とともに増えるだけ） */
function arriveCycles(t: number, V: number, L: number, D: number): number {
    const T = L / V + D / 2;
    const t1 = clampN(t, 0, T - D);
    let c = (V * t1) / strideFor(runOf(V));
    if (t > T - D) {
        const key = `${V}|${L}|${D}`;
        let tab = cycleTables.get(key);
        if (!tab) {
            // 止まり始め（T − D）から止まる（T）までを決まった刻みで足した表（刻みの間は直線で）
            tab = [0];
            const a = T - D;
            const n = Math.ceil(D / CYCLE_STEP);
            for (let i = 0; i < n; i++) {
                const v = arriveProfile(a + (i + 0.5) * CYCLE_STEP, V, L, D).v;
                tab.push(tab[i]! + (v * CYCLE_STEP) / strideFor(runOf(v)));
            }
            cycleTables.set(key, tab);
            if (cycleTables.size > 32) cycleTables.delete(cycleTables.keys().next().value!);
        }
        const u = (Math.min(t, T) - (T - D)) / CYCLE_STEP;
        const i = Math.min(tab.length - 2, Math.floor(u));
        const k = Math.min(1, u - i);
        c += tab[i]! + (tab[i + 1]! - tab[i]!) * k;
    }
    return Math.round(c * 1e5) / 1e5;
}

/**
 * 道すじが点 p（主人公）の近くを通るなら、脇へよける点を足す（間 berth。家の側へ寄りすぎない方の脇）。両端はそのまま
 */
function detour(path: readonly Pt[], p: Pt, berth = BERTH): Pt[] {
    const out: Pt[] = [path[0]!];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const L2 = dx * dx + dz * dz;
        const k = L2 > 1e-9 ? clampN(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2, 0, 1) : 0;
        const cx = a[0] + dx * k;
        const cz = a[1] + dz * k;
        const d = Math.hypot(p[0] - cx, p[1] - cz);
        if (k > 0.05 && k < 0.95 && d < berth) {
            // 線に直角な向き（2 通り）のうち、立てる方（通りの真ん中 x 0.3 に近い方を先に）
            const L = Math.sqrt(L2);
            const nx = -dz / L;
            const nz = dx / L;
            const cands: Pt[] = [
                [p[0] + nx * berth, p[1] + nz * berth],
                [p[0] - nx * berth, p[1] - nz * berth],
            ];
            cands.sort((u, v) => Math.abs(u[0] - 0.3) - Math.abs(v[0] - 0.3));
            const via = cands.find((c) => standable(c[0], c[1])) ?? cands[0]!;
            out.push(via);
        }
        out.push(b);
    }
    return out;
}

/** カメラを、カメラ除けの箱（カメラの大きさ 0.25 m を足す）の外へ：見る点の方へ少しずつ寄せる */
const CAM_BOXES: readonly Box[] = cameraBlockers();
function insideBox(x: number, y: number, z: number, r = 0.25): boolean {
    return CAM_BOXES.some((b) => x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r && z > b.z0 - r && z < b.z1 + r);
}
function safeShot(s: StageShot): StageShot {
    let { px, py, pz } = s;
    for (let i = 0; i < 40 && insideBox(px, py, pz); i++) {
        const dx = s.tx - px;
        const dy = s.ty - py;
        const dz = s.tz - pz;
        const d = Math.hypot(dx, dy, dz) || 1;
        px += (dx / d) * 0.1;
        py += (dy / d) * 0.1;
        pz += (dz / d) * 0.1;
    }
    return { ...s, px: round3(px), py: round3(py), pz: round3(pz) };
}

/** 急報の配置（origin と台詞の時刻から。同じ引数なら同じ物） */
interface ReportPlan {
    hero: { x: number; z: number; T: number; d: number };
    A: Pt;
    odaStop: Pt;
    odaFrom: Pt;
    asaiStop: Pt;
    asaiFrom: Pt;
    retStop: Pt;
    /** 浅井の使者が止まる時刻・忠勝の歩き（道・速さ・歩き出し・着く時刻） */
    asaiT: number;
    retPath: Pt[];
    retV: number;
    retStart: number;
    retArrive: number;
    /** 出来事の後の道（止まった所 → 置き場所） */
    after: { oda: Pt[]; asai: Pt[]; ret: Pt[] };
    shots: { s1: [StageShot, StageShot]; s2: [StageShot, StageShot]; s3: [StageShot, StageShot]; cut1: number; cut2: number; still: StageShot };
}

const planCache = new Map<string, ReportPlan>();

function reportPlan(ev: Extract<StageEvent, { id: 'street_report' }>, o0: StageOrigin): ReportPlan {
    // 始める所の外（見直しを物見の所などから開いた）：決めた所（通りの真ん中）で起こす。主人公もそこに立たせる（見直しの後は元へ戻る）
    const o = inReportZone(o0.x, o0.z) ? o0 : { ...REPORT_DEFAULT_ORIGIN, yaw: o0.yaw };
    const key = JSON.stringify([ev, o]);
    const hit = planCache.get(key);
    if (hit) return hit;
    const say = ev.cue.say;
    const s2 = say[1]?.[0] ?? REPORT_LEAD + 2.5;
    const s3t = say[2]?.[0] ?? s2 + 3.5;
    const s4 = say[3]?.[0] ?? s3t + 5;
    const hero = heroStop(o);
    const A: Pt = [round3(clampN(hero.x, REPORT_ANCHOR.x0, REPORT_ANCHOR.x1)), round3(clampN(hero.z, REPORT_ANCHOR.z0, REPORT_ANCHOR.z1))];
    const H: Pt = [hero.x, hero.z];
    // 止まる所は、主人公が実際に止まった所からの相対（通りの中へ収める）。城門の前の広場で始めたとき（脇の道から来た）は、
    // 忠勝は北でなく東寄りに止まる（北は城門の柱と塀）
    const odaStop: Pt = [round3(clampN(H[0] + ODA_AT[0], -2.6, 2.6)), round3(H[1] + ODA_AT[1])];
    const odaFrom: Pt = [odaStop[0], round3(odaStop[1] + ODA_FROM - ODA_AT[1])];
    let asaiX = clampN(H[0] + ASAI_AT[0], -1.75, ASAI_X_MAX);
    if (Math.abs(asaiX - odaStop[0]) < 0.8) asaiX = odaStop[0] + 0.9 <= ASAI_X_MAX ? odaStop[0] + 0.9 : odaStop[0] - 0.9;
    const asaiStop: Pt = [round3(asaiX), round3(H[1] + ASAI_AT[1])];
    const asaiT = s2 - ASAI_EARLY;
    const asaiL = Math.max(1, ASAI_WALK * (asaiT - ASAI_DECEL / 2));
    const asaiFrom: Pt = [asaiStop[0], asaiStop[1] + asaiL];
    // 忠勝の止まる所：決めた所が城門の柱・扉・塀（当たり判定から人の大きさ 0.35 m）にかかる、または主人公から近すぎる・遠すぎるときは、
    // 次の候補へ（城門の前の広場の北東の隅で始めた見直しで、東の柱の中に止まっていた）
    const retFree = (p: Pt) => {
        const d = Math.hypot(p[0] - H[0], p[1] - H[1]);
        return standable(p[0], p[1], 0.35) && d >= 1.35 && d <= 3.3;
    };
    const zIn = Math.max(H[1] - 0.5, -10.95);
    const retCands: Pt[] = [
        H[1] + RET_AT[1] < RET_Z_MIN ? [clampN(H[0] + 1.4, -1.5, 2.6), H[1] - 0.5] : [clampN(H[0] + RET_AT[0], -2.4, 2.4), H[1] + RET_AT[1]],
        [clampN(H[0] - 1.4, -2.6, 1.5), H[1] - 0.5],
        [H[0] - 1.4, zIn],
        [H[0] + 1.4, zIn],
        [H[0] - 1.4, H[1] + 0.3],
        [H[0] + 1.4, H[1] + 0.3],
    ];
    const retPick = retCands.find(retFree) ?? retCands[0]!;
    let retStop: Pt = [round3(retPick[0]), round3(retPick[1])];
    const rs = ev.retainer.spot;
    let retPath = roundPath(detour([[rs[0], rs[1]], retStop], H));
    const retArrive = s3t - RET_EARLY;
    // 速く歩いても言い始める前に着けない遠さなら、手前（城門の側）で止まる（その所が当たり判定にかかるなら、かからない所まで手前へ）
    const retMaxL = RET_SPEED[1] * Math.max(0.5, retArrive - 0.15 - (WALK_ACCEL + WALK_DECEL) / 2);
    if (pathLength(retPath) > retMaxL) {
        let l = retMaxL;
        let p = alongPath(retPath, l);
        while (l > 0.1 && !standable(p.x, p.z, 0.35)) p = alongPath(retPath, (l -= 0.1));
        retStop = [round3(p.x), round3(p.z)];
        retPath = roundPath(detour([[rs[0], rs[1]], retStop], H));
    }
    const retL = pathLength(retPath);
    // 歩き出しと止まりの加減速（walkProfile）を入れて、言い始める前に止まる速さ（遅すぎず速すぎない）
    const retV = clampN(retL / Math.max(0.5, retArrive - 0.15 - (WALK_ACCEL + WALK_DECEL) / 2), RET_SPEED[0], RET_SPEED[1]);
    const retStart = Math.max(0.15, retArrive - walkProfile(0, retV, retL).T);
    const sp = (x: { spot: [number, number, number] }): Pt => [x.spot[0], x.spot[1]];
    const e0 = ev.envoys[0];
    const e1 = ev.envoys[1];
    // 出来事の後：織田の使者は主人公の脇を通って置き場所へ。浅井の使者は通りを東の空き地へ（町家 D の角をよける）。忠勝は城門の前へ
    const odaAfter = e0 ? roundPath(detour([odaStop, sp(e0)], H)) : [odaStop];
    const asaiVia: Pt[] = asaiStop[1] > 3.2 ? [[2.4, 2.4]] : [];
    const asaiAfter = e1 ? roundPath(detour([asaiStop, ...asaiVia, [4.7, -0.9], sp(e1)], H)) : [asaiStop];
    const retAfter = roundPath(detour([retStop, [rs[0], rs[1]]], H));
    // 出来事の間の人の位置（カメラが人に重ならないように。止まる所・忠勝の歩く道を時刻で）
    const retL0 = pathLength(retPath);
    const peopleAt = (t: number): Pt[] => {
        const oda = arriveProfile(t, ODA_RUN, odaFrom[1] - odaStop[1], ODA_DECEL).s;
        const asai = arriveProfile(t, ASAI_WALK, asaiFrom[1] - asaiStop[1], ASAI_DECEL).s;
        const ret = alongPath(retPath, walkProfile(t - retStart, retV, retL0).s);
        return [H, [odaStop[0], odaFrom[1] - oda], [asaiStop[0], asaiFrom[1] - asai], [ret.x, ret.z]];
    };
    /** t0〜t1 の間、人から keep m 離れるまで、カメラを見る点の方（だめなら後ろ）へずらす */
    const clearOfPeople = (sh: StageShot, t0: number, t1: number, keep = 0.75): StageShot => {
        const pts: Pt[] = [];
        for (let t = t0; t <= t1 + 1e-9; t += 0.1) pts.push(...peopleAt(t));
        const near = (x: number, z: number) => pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < keep);
        if (!near(sh.px, sh.pz)) return sh;
        const dx = sh.tx - sh.px;
        const dz = sh.tz - sh.pz;
        const d = Math.hypot(dx, dz) || 1;
        for (let k = 1; k <= 30; k++) {
            for (const sgn of [-1, 1]) {
                const x = sh.px + (dx / d) * 0.1 * k * sgn;
                const z = sh.pz + (dz / d) * 0.1 * k * sgn;
                if (!near(x, z) && !insideBox(x, sh.py, z)) return { ...sh, px: round3(x), pz: round3(z) };
            }
        }
        return sh;
    };
    // カメラ（集まる所からの相対。カメラ除けの箱の外へ）
    const rel = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) =>
        safeShot(shot(round3(clampN(A[0] + px, -2.9, 3.1)), py, round3(Math.max(-11, A[1] + pz)), round3(A[0] + tx), ty, round3(A[1] + tz)));
    // 1：主人公の肩越しに南（走って来る使者）を見る（振り向く主人公の背と、話す使者の顔）。
    // 2：南西から、忠勝と主人公を横から見る（歩いて来て止まる忠勝・聞く主人公。家康の返事もこの画のまま）。
    // 3：出来事の前の見回しの向きが 2 の画と違う側（南西でない）とき、家康の返事だけ、その見回しの側から主人公と忠勝を見る
    //   （操作の肩越しのカメラへ短く・主人公を突き抜けずに戻れる）。同じ側なら 2 の画のまま（画は 2 つ）
    const cut1 = s2 + 1.6;
    const cut2Want = s4 - 0.4;
    const end = ev.cue.end;
    // 1 は南を向く主人公の左の肩越し（カメラを東へ 0.9 m。主人公の背が使者に重ならず、主人公は画の右・膝をつく織田の使者は中ほど・浅井の使者は左）
    const s1a = clearOfPeople(rel(0.9, 2.0, -2.4, -0.2, 1.1, 3.0), 0, cut1);
    const s1: [StageShot, StageShot] = [s1a, clearOfPeople({ ...rel(0.75, 1.95, -2.15, -0.2, 1.05, 3.0), px: round3(s1a.px - 0.15), pz: round3(s1a.pz + 0.25) }, 0, cut1)];
    const S2_AT: Pt = [-2.1, 1.9];
    const s2a = clearOfPeople(rel(S2_AT[0], 1.75, S2_AT[1], 0.0, 1.4, -1.0), cut1, end);
    const s2s: [StageShot, StageShot] = [s2a, { ...s2a, px: round3(s2a.px + 0.1), pz: round3(s2a.pz - 0.2) }];
    const yaw = o.yaw;
    const back: Pt = [Math.sin(yaw), Math.cos(yaw)];
    const right: Pt = [Math.cos(yaw), -Math.sin(yaw)];
    const mid: Pt = [(H[0] + retStop[0]) / 2, (H[1] + retStop[1]) / 2];
    const s3At = (d: number): StageShot => {
        // 主人公から見回しの向きの後ろへ d m（左へ 0.6 m。箱・家にかかるなら短く）
        let dd = d;
        let x = H[0] - right[0] * 0.6 + back[0] * dd;
        let z = H[1] - right[1] * 0.6 + back[1] * dd;
        while (dd > 1.4 && (insideBox(x, 1.8, z) || !standable(x, z, 0.1))) {
            dd -= 0.1;
            x = H[0] - right[0] * 0.6 + back[0] * dd;
            z = H[1] - right[1] * 0.6 + back[1] * dd;
        }
        return clearOfPeople(safeShot(shot(round3(x), 1.8, round3(z), round3(mid[0]), 1.4, round3(mid[1]))), cut2Want, end);
    };
    const s2Len = Math.hypot(S2_AT[0], S2_AT[1]);
    const sameSide = (back[0] * S2_AT[0] + back[1] * S2_AT[1]) / s2Len > Math.cos((70 * Math.PI) / 180);
    const s3: [StageShot, StageShot] = sameSide ? s2s : [s3At(3.3), s3At(3.0)];
    const plan: ReportPlan = {
        hero,
        A,
        odaStop,
        odaFrom,
        asaiStop,
        asaiFrom,
        retStop,
        asaiT,
        retPath,
        retV,
        retStart,
        retArrive,
        after: { oda: odaAfter, asai: asaiAfter, ret: retAfter },
        shots: { s1, s2: s2s, s3, cut1, cut2: sameSide ? Infinity : cut2Want, still: s2s[0] },
    };
    planCache.set(key, plan);
    if (planCache.size > 64) planCache.delete(planCache.keys().next().value!);
    return plan;
}

/** 出来事の後の歩き（置き場所へ）：歩き出しで道の向きへ、着いたら置き場所の向きへ向き直る。返りは人の位置・向き・歩き */
function walkHome(path: Pt[], from: number, startT: number, speed: number, t: number, endHeading: number, spotHeading: number): { x: number; z: number; heading: number; walked: number; moving: number; done: number } {
    const L = pathLength(path);
    const w = walkProfile(t - startT, speed, L);
    const p = alongPath(path, w.s);
    const T = startT + w.T;
    let h = p.heading;
    if (t < startT + SET_OFF_SEC) h = lerpAngle(from, p.heading, ease((t - startT) / SET_OFF_SEC));
    if (t >= T) h = lerpAngle(p.heading, spotHeading, ease((t - T) / FACE_SEC));
    void endHeading;
    return { x: p.x, z: p.z, heading: wrapA(h), walked: w.s, moving: movingFor(w.v), done: T + FACE_SEC };
}

/**
 * 町の急報（Version 28 §4.3）。t は場面の始めからの秒（場面の長さ cue.end より後は、出来事の後の歩き：会話の相手の人物として描く）。
 * 主人公は始めた所で減速して止まり、足を踏み替えて話し手の方へ向く（体は要るときだけ回し、顔と目線は話し手へ）。
 * カメラは 2〜3 の画（使者の到着と急報・忠勝の報告と家康の返事。出来事の前の見回しが別の側なら返事だけその側から）。
 * 動きを減らすときは、人は止まる所に現れ、カメラは 2 の画のまま動かない。
 */
function streetReport(ev: Extract<StageEvent, { id: 'street_report' }>, t: number, reduced: boolean, o0: StageOrigin): StageFrame {
    const P = reportPlan(ev, o0);
    const o = inReportZone(o0.x, o0.z) ? o0 : { ...REPORT_DEFAULT_ORIGIN, yaw: o0.yaw };
    const E = ev.cue.end;
    const say = ev.cue.say;
    const s2 = say[1]?.[0] ?? E;
    const s4 = say[3]?.[0] ?? E;
    const H: Pt = [P.hero.x, P.hero.z];
    const people: StagePerson[] = [];
    const inEvent = t <= E + 1e-9;
    const headAt = (x: number, z: number, y = HEAD_Y) => ({ x: round3(x), y, z: round3(z) });
    const look = (w: number): PersonAct => ({ ...NO_ACT, look: { x: H[0], y: HEAD_Y - 0.05, z: H[1] }, lookWeight: w });
    let settledAt = E;
    // ---- 織田の使者：走って来て止まり、片膝をつく。出来事の後は立って置き場所へ
    const e0 = ev.envoys[0];
    if (e0) {
        const L = P.odaFrom[1] - P.odaStop[1];
        const Tstop = arriveProfile(0, ODA_RUN, L, ODA_DECEL).T;
        const spotH = e0.spot[2];
        if (reduced) {
            people.push({ key: e0.cast, cast: e0.cast, look: e0.look, name: e0.name, x: P.odaStop[0], z: P.odaStop[1], heading: roundH(headingTo(P.odaStop, H)), walked: 0, moving: 0, label: inEvent, act: { ...look(0.9), kneel: inEvent ? 1 : 0 } });
        } else if (inEvent || t < E + AFTER.oda.start) {
            const w = arriveProfile(t, ODA_RUN, L, ODA_DECEL);
            const z = P.odaFrom[1] - w.s;
            const kneel = ease((t - Tstop) / KNEEL_SEC) * (1 - ease((t - E) / KNEEL_SEC));
            const arrivedH = headingTo(P.odaStop, H);
            const heading = t < Tstop ? Math.PI : lerpAngle(Math.PI, arrivedH, ease((t - Tstop) / 0.5));
            people.push({
                key: e0.cast,
                cast: e0.cast,
                look: e0.look,
                name: e0.name,
                x: round3(P.odaStop[0]),
                z: round3(z),
                heading: roundH(heading),
                walked: round3(w.s),
                moving: movingFor(w.v),
                run: round3(runOf(w.v)),
                cycle: arriveCycles(t, ODA_RUN, L, ODA_DECEL),
                label: inEvent,
                act: { ...look(t > Tstop - 0.3 ? 0.9 : 0), kneel: round3(kneel) },
            });
        } else {
            const from = lerpAngle(Math.PI, headingTo(P.odaStop, H), 1);
            const w = walkHome(P.after.oda, from, E + AFTER.oda.start, AFTER.oda.speed, t, spotH, spotH);
            settledAt = Math.max(settledAt, w.done);
            people.push({ key: e0.cast, cast: e0.cast, look: e0.look, name: e0.name, x: round3(w.x), z: round3(w.z), heading: roundH(w.heading), walked: round3(w.walked), moving: w.moving, cycle: walkCycles(w.walked), label: false });
        }
        if (!reduced) settledAt = Math.max(settledAt, E + AFTER.oda.start + walkProfile(0, AFTER.oda.speed, pathLength(P.after.oda)).T + FACE_SEC);
    }
    // ---- 浅井の使者：少し遅れて急ぎ足で来て止まり、主人公の方へ向く。出来事の後は東の空き地へ
    const e1 = ev.envoys[1];
    if (e1) {
        const L = P.asaiFrom[1] - P.asaiStop[1];
        const spotH = e1.spot[2];
        const faceH = headingTo(P.asaiStop, H);
        if (reduced) {
            people.push({ key: e1.cast, cast: e1.cast, look: e1.look, name: e1.name, x: P.asaiStop[0], z: P.asaiStop[1], heading: roundH(faceH), walked: 0, moving: 0, label: inEvent, act: look(0.9) });
        } else if (inEvent || t < E + AFTER.asai.start) {
            const w = arriveProfile(t, ASAI_WALK, L, ASAI_DECEL);
            const heading = t < P.asaiT ? Math.PI : lerpAngle(Math.PI, faceH, ease((t - P.asaiT) / 0.6));
            people.push({
                key: e1.cast,
                cast: e1.cast,
                look: e1.look,
                name: e1.name,
                x: round3(P.asaiStop[0]),
                z: round3(P.asaiFrom[1] - w.s),
                heading: roundH(heading),
                walked: round3(w.s),
                moving: movingFor(w.v),
                cycle: walkCycles(w.s),
                label: inEvent,
                act: look(t > P.asaiT - 0.4 ? 0.85 : 0),
            });
        } else {
            const w = walkHome(P.after.asai, faceH, E + AFTER.asai.start, AFTER.asai.speed, t, spotH, spotH);
            settledAt = Math.max(settledAt, w.done);
            people.push({ key: e1.cast, cast: e1.cast, look: e1.look, name: e1.name, x: round3(w.x), z: round3(w.z), heading: roundH(w.heading), walked: round3(L + w.walked), moving: w.moving, cycle: walkCycles(L + w.walked), label: false });
        }
        if (!reduced) settledAt = Math.max(settledAt, E + AFTER.asai.start + walkProfile(0, AFTER.asai.speed, pathLength(P.after.asai)).T + FACE_SEC);
    }
    // ---- 忠勝：城門の前から歩いて来て、止まってから言う。家康の命に軽く礼をして、城門の前へ歩いて戻る
    const r = ev.retainer;
    const rSpotH = r.spot[2];
    const rFace = headingTo(P.retStop, H);
    if (reduced) {
        people.push({ key: r.cast, cast: r.cast, look: r.look, name: r.name, x: P.retStop[0], z: P.retStop[1], heading: roundH(rFace), walked: 0, moving: 0, label: inEvent, act: look(0.9) });
    } else if (inEvent || t < E + AFTER.ret.start) {
        const L = pathLength(P.retPath);
        const w = walkProfile(t - P.retStart, P.retV, L);
        const p = alongPath(P.retPath, w.s);
        let heading = p.heading;
        if (t < P.retStart) heading = rSpotH;
        else if (t < P.retStart + SET_OFF_SEC) heading = lerpAngle(rSpotH, p.heading, ease((t - P.retStart) / SET_OFF_SEC));
        if (t >= P.retArrive) heading = lerpAngle(p.heading, rFace, ease((t - P.retArrive) / 0.5));
        const bow = bowWeight(t - (s4 + 0.9));
        people.push({
            key: r.cast,
            cast: r.cast,
            look: r.look,
            name: r.name,
            x: round3(p.x),
            z: round3(p.z),
            heading: roundH(heading),
            walked: round3(w.s),
            moving: movingFor(w.v),
            cycle: walkCycles(w.s),
            label: inEvent,
            act: { ...look(t > P.retArrive - 0.8 ? 0.9 * (1 - bow) : 0), bow: round3(bow) },
        });
    } else {
        const w = walkHome(P.after.ret, rFace, E + AFTER.ret.start, AFTER.ret.speed, t, rSpotH, rSpotH);
        settledAt = Math.max(settledAt, w.done);
        people.push({ key: r.cast, cast: r.cast, look: r.look, name: r.name, x: round3(w.x), z: round3(w.z), heading: roundH(w.heading), walked: round3(pathLength(P.retPath) + w.walked), moving: w.moving, cycle: walkCycles(pathLength(P.retPath) + w.walked), label: false });
    }
    if (!reduced) settledAt = Math.max(settledAt, E + AFTER.ret.start + walkProfile(0, AFTER.ret.speed, pathLength(P.after.ret)).T + FACE_SEC);
    const settled = reduced ? t > E + 1e-9 : t >= settledAt;
    // 動きを減らすときは、出来事の後も止まる所のまま（t によらない。置き場所へは描く側が出来事の終わりに置き直す）
    if (settled && !reduced) {
        // 着いた：置き場所・置き場所の向き（会話の相手の人物と同じ所・同じ向き。これより後は人物のまま）
        people.length = 0;
        for (const x of [...ev.envoys, ev.retainer]) people.push({ key: x.cast, cast: x.cast, look: x.look, name: x.name, x: x.spot[0], z: x.spot[1], heading: roundH(x.spot[2]), walked: 0, moving: 0, label: false });
    }
    // ---- 主人公：減速して止まり、走って来る足音に振り向く（足を踏み替えて）。忠勝が来ると、そちらへ向き直る
    let hero: StageHero | null = null;
    let heroGaze: StageFrame['heroGaze'] = undefined;
    if (inEvent) {
        const k = P.hero.T > 0 ? clampN(t / P.hero.T, 0, 1) : 1;
        const along = P.hero.d * (1 - (1 - k) * (1 - k));
        const len = Math.hypot(o.dirX, o.dirZ) || 1;
        const hx = o.x + (o.dirX / len) * along;
        const hz = o.z + (o.dirZ / len) * along;
        const hOda = headingTo(H, P.odaStop);
        const hRet = headingTo(H, P.retStop);
        const turn = (from: number, to: number, start: number) => {
            const dur = 0.35 + 0.25 * (Math.abs(wrapA(to - from)) / Math.PI);
            return lerpAngle(from, to, ease((t - start) / dur));
        };
        let h = o.heading;
        if (reduced) h = t < P.retArrive - 1.0 ? hOda : hRet;
        else {
            h = turn(o.heading, hOda, 0.2);
            if (t >= P.retArrive - 1.0) h = turn(hOda, hRet, P.retArrive - 1.0);
        }
        hero = { x: round3(hx), z: round3(hz), heading: roundH(h) };
        // 顔と目線：走って来る使者 → 浅井の使者 → 忠勝
        const kneelHead = (p: StagePerson | undefined) => (p ? headAt(p.x, p.z, p.act?.kneel ? HEAD_Y - (HEAD_Y - KNEEL_HEAD_Y) * p.act.kneel : HEAD_Y) : null);
        const odaP = people.find((p) => p.cast === e0?.cast);
        const asaiP = people.find((p) => p.cast === e1?.cast);
        const retP = people.find((p) => p.cast === r.cast);
        if (t < s2 - 0.3) heroGaze = kneelHead(odaP);
        else if (t < P.retArrive - 0.9) heroGaze = kneelHead(asaiP);
        else heroGaze = kneelHead(retP);
    }
    // ---- カメラ
    const sh = P.shots;
    let s: StageShot;
    if (reduced) s = sh.still;
    else if (t < sh.cut1) s = lerpShot(sh.s1[0], sh.s1[1], ease(t / sh.cut1));
    else if (t < sh.cut2) s = lerpShot(sh.s2[0], sh.s2[1], ease((t - sh.cut1) / Math.max(0.1, Math.min(E, sh.cut2) - sh.cut1)));
    else s = lerpShot(sh.s3[0], sh.s3[1], ease((t - sh.cut2) / Math.max(0.1, E - sh.cut2)));
    return {
        people,
        figures: [],
        banners: [],
        litters: [],
        shot: s,
        hideCast: [],
        hideAmbient: [],
        hero,
        heroStays: true,
        ...(heroGaze !== undefined ? { heroGaze } : {}),
        settled,
    };
}

/** 確かめ用：急報の配置（集まる所・止まる所・主人公の止まる所・カメラの切り替えの時刻） */
export function reportLayout(ev: Extract<StageEvent, { id: 'street_report' }>, origin: StageOrigin = REPORT_DEFAULT_ORIGIN): {
    anchor: Pt;
    hero: Pt;
    stops: { oda: Pt; asai: Pt; retainer: Pt };
    cuts: [number, number];
    retArrive: number;
} {
    const P = reportPlan(ev, origin);
    return { anchor: P.A, hero: [P.hero.x, P.hero.z], stops: { oda: P.odaStop, asai: P.asaiStop, retainer: P.retStop }, cuts: [P.shots.cut1, P.shots.cut2], retArrive: P.retArrive };
}

// ---------------- 第二章の冒頭の使いの急報（Version 28 §4.3 の最後の項）

type MessengerArrive = Extract<StageEvent, { id: 'messenger_arrive' }>;
export type MessengerReportEvent = MessengerArrive & { report: NonNullable<MessengerArrive['report']> };

/** 主人公の立つ所（町の入口。前の場面（町の様子）と同じ所・同じ向きで始める） */
const MSG_HERO: Pt = [ENTRY_POSE.x, ENTRY_POSE.z];
/**
 * 使いの止まる所（主人公からの相対 [x, z]。南が +z）：主人公の南東 2.25 m。使いは木戸の開きの中（x 0.5）を北へ走って来る。
 * 操作の肩越しのカメラ（主人公の南 2.1 m・東 0.38 m）から 1.3 m 以上離れ、操作へ戻った最初の画には入らない
 */
const MSG_AT: Pt = [1.9, 1.2];
/** 使いの走る速さ（m/秒）・止まるのにかける秒・言い始める何秒前に止まるか */
const MSG_RUN = 3.0;
const MSG_DECEL = 0.8;
const MSG_EARLY = 0.15;
/** 使いの最初の台詞の時刻（場面の始めから。走って来て止まり、片膝をつきながら言う）。cinematics.ts が字幕の時刻に使う */
export const MESSENGER_LEAD = 1.5;
/** 家臣の止まる所（主人公からの相対。北の少し東：肩越しのカメラから見て、主人公の頭に隠れない）・歩き出す時刻・速さの範囲 */
const MRET_AT: Pt = [0.6, -1.9];
const MRET_START = 0.2;
const MRET_SPEED = [1.1, 1.9] as const;
/** 出来事の後：使いは立ち上がってから（場面の終わりから rise 秒後に立ち始める）、家臣は礼の後に、置き場所へ歩く（速さ） */
const MSG_AFTER = { rise: 0.2, msg: 1.45, ret: 1.5 } as const;
/** 主人公が家臣の方へ向き直るのは、家臣が着く何秒前か（使いが話している間は向き直らない） */
const MSG_TURN_TO_RET = 1.0;
/** 動きを減らすときの静止の画：通りの東から、主人公・片膝の使い・家臣の三人を横に見る */
const MSG_STILL = shot(2.6, 1.9, 12.6, -1.0, 1.2, 13.0);

/** 家臣の歩く道（城門の前の置き場所 → 主人公の北の止まる所。主人公の脇はよける） */
function msgRetainerPath(spot: readonly [number, number, number?]): Pt[] {
    const R: Pt = [MSG_HERO[0] + MRET_AT[0], MSG_HERO[1] + MRET_AT[1]];
    return roundPath(detour([[spot[0], spot[1]], R], MSG_HERO));
}

/**
 * 家臣の台詞を始められるいちばん早い時刻（場面の始めから。城門の前の置き場所から速く歩いても、着いて止まるのはこれより前にならない）。
 * cinematics.ts が、使いの台詞の後の間（家臣が歩いて来る間）を決めるのに使う
 */
export function messengerRetainerEarliest(spot: readonly [number, number, number?]): number {
    const L = pathLength(msgRetainerPath(spot));
    return Math.ceil((MRET_START + walkProfile(0, MRET_SPEED[1], L).T + RET_EARLY) * 100) / 100;
}

interface MessengerPlan {
    H: Pt;
    M: Pt;
    /** 使いの走り：走り出す所の z（M の南）・距離・止まる時刻・止まって主人公へ向く向き */
    fromZ: number;
    L: number;
    Tstop: number;
    faceM: number;
    R: Pt;
    retPath: Pt[];
    retL: number;
    retV: number;
    retStart: number;
    retArrive: number;
    rFace: number;
    /** 主人公が家臣へ向き直る時刻・家臣の礼の始め */
    turnR: number;
    bowAt: number;
    after: { msg: Pt[]; ret: Pt[] };
    afterStart: { msg: number; ret: number };
    settledAt: number;
    shots: { s1: [StageShot, StageShot]; s2: [StageShot, StageShot]; s3: [StageShot, StageShot]; cut1: number; cut2: number };
}

const msgPlanCache = new Map<string, MessengerPlan>();

function messengerPlan(ev: MessengerReportEvent): MessengerPlan {
    const key = JSON.stringify(ev.report);
    const hit = msgPlanCache.get(key);
    if (hit) return hit;
    const rp = ev.report;
    const cue = rp.cue;
    const E = cue.end;
    const H = MSG_HERO;
    const M: Pt = [round3(H[0] + MSG_AT[0]), round3(H[1] + MSG_AT[1])];
    const lead = cue.messenger[0]?.[0] ?? MESSENGER_LEAD;
    const Tstop = Math.max(0.5, lead - MSG_EARLY);
    const L = Math.max(0.5, MSG_RUN * (Tstop - MSG_DECEL / 2));
    const fromZ = round3(M[1] + L);
    const faceM = headingTo(M, H);
    // 家臣：言い始める RET_EARLY 秒前に止まる（遅すぎず速すぎない速さ。台本は messengerRetainerEarliest より前にしない）
    const retPath = msgRetainerPath(rp.retainer.spot);
    const R = retPath[retPath.length - 1]!;
    const retL = pathLength(retPath);
    const retArrive = cue.retainer[0] - RET_EARLY;
    const retV = clampN(retL / Math.max(0.5, retArrive - MRET_START - (WALK_ACCEL + WALK_DECEL) / 2), MRET_SPEED[0], MRET_SPEED[1]);
    const retStart = Math.max(MRET_START, retArrive - walkProfile(0, retV, retL).T);
    const rFace = headingTo(R, H);
    // 主人公は、使いが話し終えてから（声の終わり）、家臣が着く少し前に家臣へ向き直る
    const msgVoiceEnd = cue.messenger[cue.messenger.length - 1]?.[1] ?? lead;
    const turnR = Math.max(msgVoiceEnd + 0.3, cue.retainer[0] - RET_EARLY - MSG_TURN_TO_RET);
    // 家臣は言い終えたら（声の終わり）軽く礼をして、礼の後に城門の前へ歩いて戻る（場面の後）
    const bowAt = cue.retainer[1] + 0.05;
    const ms = rp.messenger.spot;
    const msgAfter = roundPath(detour([M, [ms[0], ms[1] + 1.6], [ms[0], ms[1]]], H));
    const retAfter = roundPath(detour([R, [rp.retainer.spot[0], rp.retainer.spot[1]]], H));
    const afterStart = { msg: E + MSG_AFTER.rise + KNEEL_SEC + 0.15, ret: Math.max(E + 0.25, bowAt + BOW_SEC) };
    const settledAt =
        Math.max(afterStart.msg + walkProfile(0, MSG_AFTER.msg, pathLength(msgAfter)).T, afterStart.ret + walkProfile(0, MSG_AFTER.ret, pathLength(retAfter)).T) + FACE_SEC;
    // カメラ：1 は通りの北東から、木戸から走って来る使いと振り向く主人公を横に見る（使いの最初の台詞まで）。
    // 2 は片膝の使いの肩越しに、聞く主人公の顔（使いの使命の台詞）。3 は主人公の後ろから、城門の方から来て止まる家臣（家臣の台詞）。
    // 3 は操作の肩越しのカメラ（町の入口・見回し北）へゆっくり寄って終わるので、操作へ切らずに渡せる
    const s1: [StageShot, StageShot] = [safeShot(shot(H[0] + 3.0, 2.1, H[1] - 2.6, H[0] + 0.8, 1.0, H[1] + 2.4)), safeShot(shot(H[0] + 2.85, 2.05, H[1] - 2.4, H[0] + 0.85, 1.0, H[1] + 2.2))];
    const dHM: Pt = [(M[0] - H[0]) / Math.hypot(M[0] - H[0], M[1] - H[1]), (M[1] - H[1]) / Math.hypot(M[0] - H[0], M[1] - H[1])];
    const side: Pt = [dHM[1], -dHM[0]];
    const c2: Pt = [M[0] + dHM[0] * 1.5 + side[0] * 0.6, M[1] + dHM[1] * 1.5 + side[1] * 0.6];
    const s2: [StageShot, StageShot] = [
        safeShot(shot(round3(c2[0]), 1.5, round3(c2[1]), H[0], 1.42, H[1])),
        safeShot(shot(round3(c2[0] - dHM[0] * 0.2), 1.48, round3(c2[1] - dHM[1] * 0.2), H[0] + 0.05, 1.45, H[1] - 0.3)),
    ];
    const F = ENTRY_FOLLOW_SHOT;
    const s3: [StageShot, StageShot] = [safeShot({ ...F, px: round3(F.px - 0.25), py: round3(F.py + 0.22), pz: round3(F.pz + 0.6) }), F];
    const cut1 = cue.messenger[1]?.[0] ?? lead + 2.5;
    const cut2 = Math.max(cut1 + 2.0, Math.min(retArrive - 2.2, msgVoiceEnd + 0.3));
    const plan: MessengerPlan = {
        H,
        M,
        fromZ,
        L,
        Tstop,
        faceM,
        R,
        retPath,
        retL,
        retV,
        retStart,
        retArrive,
        rFace,
        turnR,
        bowAt,
        after: { msg: msgAfter, ret: retAfter },
        afterStart,
        settledAt,
        shots: { s1, s2, s3, cut1, cut2 },
    };
    msgPlanCache.set(key, plan);
    if (msgPlanCache.size > 64) msgPlanCache.delete(msgPlanCache.keys().next().value!);
    return plan;
}

/**
 * 第二章の冒頭の使いの急報（Version 28 §4.3 の最後の項）。t は場面の始めからの秒（場面の長さ cue.end より後は、出来事の後の歩き：
 * 会話の相手の人物として、置き場所まで）。主人公は町の入口に立ち、木戸から走って来る使いへ足を踏み替えて振り向く。使いは減速して止まり、
 * 片膝をついて主人公を見上げて言う。その間に家臣が城門の前から歩いて来て、止まって主人公の方を向いてから言い、言い終えて軽く礼をする。
 * 主人公は使いが話し終えてから家臣へ向き直る（顔と目線は話し手へ）。カメラは 3 つの画（話す人と聞く人）。最後の画は操作の肩越しのカメラで終わる。
 * 動きを減らすときは、人は止まる所に現れ、カメラは通りの東からの静止の画。
 */
function messengerReport(ev: MessengerReportEvent, t: number, reduced: boolean): StageFrame {
    const P = messengerPlan(ev);
    const rp = ev.report;
    const E = rp.cue.end;
    const H = P.H;
    const inEvent = t <= E + 1e-9;
    const people: StagePerson[] = [];
    const look = (w: number): PersonAct => ({ ...NO_ACT, look: { x: H[0], y: HEAD_Y - 0.05, z: H[1] }, lookWeight: w });
    const ms = rp.messenger;
    const msgSpotH = ms.spot[2];
    // ---- 使い：走って来て、減速して止まり、主人公の方へ向いて片膝をつく。出来事の後は立ち上がって話せる位置へ
    if (reduced) {
        people.push({ key: ms.cast, cast: ms.cast, look: ev.look, name: ev.name, x: P.M[0], z: P.M[1], heading: roundH(P.faceM), walked: 0, moving: 0, label: inEvent, act: { ...look(0.9), kneel: inEvent ? 1 : 0 } });
    } else if (t < P.afterStart.msg) {
        const w = arriveProfile(t, MSG_RUN, P.L, MSG_DECEL);
        const kneel = ease((t - P.Tstop) / KNEEL_SEC) * (1 - ease((t - E - MSG_AFTER.rise) / KNEEL_SEC));
        const heading = t < P.Tstop ? Math.PI : lerpAngle(Math.PI, P.faceM, ease((t - P.Tstop) / 0.5));
        people.push({
            key: ms.cast,
            cast: ms.cast,
            look: ev.look,
            name: ev.name,
            x: P.M[0],
            z: round3(P.fromZ - w.s),
            heading: roundH(heading),
            walked: round3(w.s),
            moving: movingFor(w.v),
            run: round3(runOf(w.v)),
            cycle: arriveCycles(t, MSG_RUN, P.L, MSG_DECEL),
            label: inEvent,
            act: { ...look(t > P.Tstop - 0.3 ? 0.9 : 0), kneel: round3(kneel) },
        });
    } else {
        const w = walkHome(P.after.msg, P.faceM, P.afterStart.msg, MSG_AFTER.msg, t, msgSpotH, msgSpotH);
        people.push({ key: ms.cast, cast: ms.cast, look: ev.look, name: ev.name, x: round3(w.x), z: round3(w.z), heading: roundH(w.heading), walked: round3(P.L + w.walked), moving: w.moving, cycle: walkCycles(P.L + w.walked), label: false });
    }
    // ---- 家臣：城門の前の置き場所から歩いて来て、止まって主人公の方を向いてから言う。言い終えて軽く礼をし、城門の前へ歩いて戻る
    const r = rp.retainer;
    const rSpotH = r.spot[2];
    const bow = reduced ? 0 : bowWeight(t - P.bowAt);
    if (reduced) {
        people.push({ key: r.cast, cast: r.cast, look: r.look, name: r.name, x: P.R[0], z: P.R[1], heading: roundH(P.rFace), walked: 0, moving: 0, label: inEvent, act: look(0.9) });
    } else if (t < P.afterStart.ret) {
        const w = walkProfile(t - P.retStart, P.retV, P.retL);
        const p = alongPath(P.retPath, w.s);
        let heading = p.heading;
        if (t < P.retStart) heading = rSpotH;
        else if (t < P.retStart + SET_OFF_SEC) heading = lerpAngle(rSpotH, p.heading, ease((t - P.retStart) / SET_OFF_SEC));
        if (t >= P.retArrive) heading = lerpAngle(p.heading, P.rFace, ease((t - P.retArrive) / 0.5));
        people.push({
            key: r.cast,
            cast: r.cast,
            look: r.look,
            name: r.name,
            x: round3(p.x),
            z: round3(p.z),
            heading: roundH(heading),
            walked: round3(w.s),
            moving: movingFor(w.v),
            cycle: walkCycles(w.s),
            label: inEvent,
            act: { ...look(t > P.retArrive - 0.8 ? 0.9 * (1 - bow) : 0), bow: round3(bow) },
        });
    } else {
        const w = walkHome(P.after.ret, P.rFace, P.afterStart.ret, MSG_AFTER.ret, t, rSpotH, rSpotH);
        people.push({ key: r.cast, cast: r.cast, look: r.look, name: r.name, x: round3(w.x), z: round3(w.z), heading: roundH(w.heading), walked: round3(P.retL + w.walked), moving: w.moving, cycle: walkCycles(P.retL + w.walked), label: false });
    }
    const settled = reduced ? t > E + 1e-9 : t >= P.settledAt;
    if (settled && !reduced) {
        // 着いた：置き場所・置き場所の向き（会話の相手の人物と同じ所・同じ向き。これより後は人物のまま）
        people.length = 0;
        people.push({ key: ms.cast, cast: ms.cast, look: ev.look, name: ev.name, x: ms.spot[0], z: ms.spot[1], heading: roundH(msgSpotH), walked: 0, moving: 0, label: false });
        people.push({ key: r.cast, cast: r.cast, look: r.look, name: r.name, x: r.spot[0], z: r.spot[1], heading: roundH(rSpotH), walked: 0, moving: 0, label: false });
    }
    // ---- 主人公：町の入口で、走って来る足音に振り向き（足を踏み替えて）、使いが話し終えたら家臣へ向き直る。顔と目線は話し手へ
    let hero: StageHero | null = null;
    let heroGaze: StageFrame['heroGaze'] = undefined;
    if (inEvent) {
        const hM = headingTo(H, P.M);
        const hR = headingTo(H, P.R);
        const turn = (from: number, to: number, start: number) => {
            const dur = 0.35 + 0.25 * (Math.abs(wrapA(to - from)) / Math.PI);
            return lerpAngle(from, to, ease((t - start) / dur));
        };
        let h: number;
        if (reduced) h = t < P.turnR ? hM : hR;
        else {
            h = turn(ENTRY_POSE.heading, hM, 0.25);
            if (t >= P.turnR) h = turn(hM, hR, P.turnR);
        }
        hero = { x: H[0], z: H[1], heading: roundH(h) };
        const msgP = people.find((p) => p.cast === ms.cast);
        const retP = people.find((p) => p.cast === r.cast);
        const headOf = (p: StagePerson | undefined) => (p ? { x: round3(p.x), y: p.act?.kneel ? round3(HEAD_Y - (HEAD_Y - KNEEL_HEAD_Y) * p.act.kneel) : HEAD_Y, z: round3(p.z) } : null);
        heroGaze = t < P.turnR - 0.1 ? headOf(msgP) : headOf(retP);
    }
    // ---- カメラ
    const sh = P.shots;
    let s: StageShot;
    if (reduced) s = MSG_STILL;
    else if (t < sh.cut1) s = lerpShot(sh.s1[0], sh.s1[1], ease(t / sh.cut1));
    else if (t < sh.cut2) s = lerpShot(sh.s2[0], sh.s2[1], ease((t - sh.cut1) / Math.max(0.1, sh.cut2 - sh.cut1)));
    else s = lerpShot(sh.s3[0], sh.s3[1], ease((t - sh.cut2) / Math.max(0.1, E - sh.cut2)));
    return {
        people,
        figures: [],
        banners: [],
        litters: [],
        shot: s,
        hideCast: [],
        // 荷運び（町家 D の店先へ運ぶ人）は、1 の画のカメラのすぐ前を通るので、1 の画の間だけ隠す（2 の画への切り替えで戻す。
        // 最後の画は操作の肩越しのカメラへ切らずに渡すので、操作へ戻った時に荷運びが急に現れないように）。動きを減らすときの静止の画は通りの東から
        hideAmbient: inEvent && !reduced && t < sh.cut1 ? ['porter'] : [],
        hero,
        ...(heroGaze !== undefined ? { heroGaze } : {}),
        settled,
    };
}

/** 確かめ用：使いの急報の配置（主人公・使いの止まる所・家臣の止まる所・家臣の着く時刻・主人公が家臣へ向く時刻・画の切り替え・後の歩きが終わる時刻） */
export function messengerLayout(ev: MessengerReportEvent): { hero: Pt; messenger: Pt; retainer: Pt; retArrive: number; retSpeed: number; turnR: number; cuts: [number, number]; settledAt: number; stopAt: number } {
    const P = messengerPlan(ev);
    return { hero: P.H, messenger: P.M, retainer: P.R, retArrive: P.retArrive, retSpeed: P.retV, turnR: P.turnR, cuts: [P.shots.cut1, P.shots.cut2], settledAt: P.settledAt, stopAt: P.Tstop };
}

/**
 * 出来事の後に、会話の相手の人物が置き場所まで歩く出来事の、場面の長さ（その後も同じ関数で歩く。探索の場面が操作の間に動かす）。
 * 町の急報・第二章の冒頭の使いの急報。ほかの出来事は null
 */
export function afterWalkEnd(ev: StageEvent): number | null {
    if (ev.id === 'street_report') return ev.cue.end;
    if (ev.id === 'messenger_arrive' && ev.report) return ev.report.cue.end;
    return null;
}

/** 演出の中で町へ来る会話の相手（来るまで配役に置かない：第二章の冒頭の使い）。台本の 3D の出来事から */
export function arrivingCast(events: readonly StageEvent[]): string[] {
    const out: string[] = [];
    for (const ev of events) if (ev.id === 'messenger_arrive' && ev.report) out.push(ev.report.messenger.cast);
    return out;
}

// ---------------- 家臣の報告（主人公と家臣の短いやり取り）

/** 家臣が止まる所（主人公の 1.5 m 北の少し東）と、歩き出す所（通りの北。城門の方から来る） */
export const RETAINER_STOP: Pt = [ENTRY_POSE.x + 0.4, ENTRY_POSE.z - 1.5];
const RETAINER_FROM: Pt = [ENTRY_POSE.x + 0.75, ENTRY_POSE.z - 6.0];
const RETAINER_SPEED = 1.6;
/** 画の切り替え（秒）：前は主人公の右肩越しに北（来る家臣と城門）を見る、後は東から二人を横に見る */
export const RETAINER_CUT = 3.2;
const RETAINER_SHOT_A0 = shot(ENTRY_POSE.x + 0.75, 1.85, ENTRY_POSE.z + 2.0, ENTRY_POSE.x + 0.4, 1.45, ENTRY_POSE.z - 6.0);
const RETAINER_SHOT_A1 = shot(ENTRY_POSE.x + 0.7, 1.85, ENTRY_POSE.z + 1.75, ENTRY_POSE.x + 0.4, 1.45, ENTRY_POSE.z - 6.0);
const RETAINER_SHOT_B0 = shot(ENTRY_POSE.x + 3.7, 1.75, ENTRY_POSE.z - 0.5, ENTRY_POSE.x + 0.1, 1.35, ENTRY_POSE.z - 0.75);
const RETAINER_SHOT_B1 = shot(ENTRY_POSE.x + 3.45, 1.75, ENTRY_POSE.z - 0.7, ENTRY_POSE.x + 0.1, 1.35, ENTRY_POSE.z - 0.8);

function retainerReport(look: string, name: string, castId: string, t: number, reduced: boolean): StageFrame {
    const path: Pt[] = [RETAINER_FROM, RETAINER_STOP];
    const L = pathLength(path);
    const w = reduced ? { s: L, moving: 0 } : walkProgress(t, 0.2, RETAINER_SPEED, L);
    const p = alongPath(path, w.s);
    const arrived = w.s >= L - 1e-6;
    // 着いたら主人公の方を向く（0.6 秒で向き直る）。歩く間は進む向き
    const face = Math.atan2(ENTRY_POSE.x - RETAINER_STOP[0], ENTRY_POSE.z - RETAINER_STOP[1]);
    const tArrive = reduced ? 0 : arrivalTime(0.2, RETAINER_SPEED, L);
    const heading = arrived ? lerpAngle(p.heading, face, reduced ? 1 : ease((t - tArrive) / 0.6)) : p.heading;
    const people: StagePerson[] = [{ key: 'retainer', look, name, x: p.x, z: p.z, heading: roundH(heading), walked: w.s, moving: w.moving, label: true }];
    // 主人公：北を向いて待ち、近づく家臣の方へ少し向き直る（家臣の道は主人公の北東なので向きは飛ばない）
    const toward = Math.atan2(p.x - ENTRY_POSE.x, p.z - ENTRY_POSE.z);
    const heroHeading = reduced ? toward : lerpAngle(ENTRY_POSE.heading, toward, ease((t - 0.6) / 1.4));
    let s: StageShot;
    if (reduced) s = RETAINER_SHOT_B0;
    else if (t < RETAINER_CUT) s = lerpShot(RETAINER_SHOT_A0, RETAINER_SHOT_A1, ease(t / RETAINER_CUT));
    else s = lerpShot(RETAINER_SHOT_B0, RETAINER_SHOT_B1, ease((t - RETAINER_CUT) / 6));
    // 家臣の置き場所の人物は、場面の間だけ隠す（背景の城門の前に同じ人が二人いないように）。終われば元の置き場所の人物に替わる。
    // 町家 D の店先へ荷を運ぶ人は、横の画のカメラのすぐ前を通るので隠す
    return { people, figures: [], banners: [], litters: [], shot: s, hideCast: castId ? [castId] : [], hideAmbient: ['porter'], hero: { x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: roundH(heroHeading) } };
}

/** 歩き終わる時刻（walkProgress の逆。遅れ delay・速さ v・長さ L） */
function arrivalTime(delay: number, v: number, L: number): number {
    return delay + walkProfile(0, v, L).T;
}

// ---------------- 詰所の負傷兵

/** 負傷兵の置き方（通りから見える詰所の前の休み場：筵に横になる 6 人・土塀ぎわに座る 3 人。その先は詰所の囲いの床几）。町の人々（ambient）と同じ並び */
export function woundedLayout(count: number): StageFigure[] {
    const out: StageFigure[] = [];
    const n = Math.max(0, Math.min(12, Math.floor(count)));
    for (let i = 0; i < n; i++) {
        if (i < MATS.length) {
            const [x, z] = MATS[i]!;
            // 筵の上に仰向け（頭は向きの反対＝北）。少しずつ向きを変える
            out.push({ x, z: z + 0.1, y: 0.04, heading: ((i * 7) % 5 - 2) * 0.04, pose: 'lie', phase: i * 0.37, lean: 0, mark: DEFAULT_MARK, spear: false });
        } else if (i < MATS.length + GROUND_SITS.length) {
            const [x, z, h] = GROUND_SITS[i - MATS.length]!;
            out.push({ x, z, y: 0, heading: h, pose: 'sitGround', phase: i * 0.37, lean: 0, mark: DEFAULT_MARK, spear: false });
        } else {
            const [x, z, h] = GUARD_STOOLS[i - MATS.length - GROUND_SITS.length]!;
            out.push({ x, z, y: 0, heading: h, pose: 'sit', phase: i * 0.37, lean: 0.05, mark: DEFAULT_MARK, spear: false });
        }
    }
    return out;
}

/** 通り（町家 D の前の北）から、南東の休み場（筵・床几・土塀ぎわ）を見る（ゆっくり寄る） */
const WOUNDED_SHOT_0 = shot(0.1, 2.3, 7.0, 4.4, 0.5, 2.0);
const WOUNDED_SHOT_1 = shot(0.4, 2.25, 6.4, 4.6, 0.5, 1.6);

function woundedRest(count: number, t: number, reduced: boolean): StageFrame {
    const figures = woundedLayout(count);
    const s = reduced ? WOUNDED_SHOT_0 : lerpShot(WOUNDED_SHOT_0, WOUNDED_SHOT_1, ease(t / 12));
    // 町の援兵も隠す（援兵が着く場面は、この後。着く前から詰所の横に立っていると順番が食い違う）
    return { people: [], figures, banners: [], litters: [], shot: s, hideCast: [], hideAmbient: ['wounded', 'reinforcement'], hero: null };
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

/**
 * 兵ごとの歩幅の倍率と歩きの位相のずれ（隊列の何番目か。Version 28 §4.2：同じ列の兵が同じ位相で一斉に上下しない）。
 * 歩幅は ±10%（同じ速さで歩くので、歩く拍子も人ごとに違う）、位相は 0〜1 のどこからでも
 */
export function columnGait(i: number): { stride: number; offset: number } {
    return { stride: 0.9 + 0.2 * seeded('column', 2 * i), offset: seeded('column', 2 * i + 1) };
}

/**
 * 隊列を道すじの上に置く（頭の距離 head）。道の角は丸める（roundPath）。兵ごとに歩幅と位相を違える（columnGait）。
 * gateZ：北へ木戸をくぐる道（援兵・帰還）のとき、木戸の z。木戸の 2.6 m 手前から 1 m 手前までに槍を後ろへ担ぎ・のぼりを倒し、
 * くぐった後もそのまま（先が横木の下 2.98 m より下。木戸の外の目の高さのカメラからは、先は横木の下に収まって見える）。
 */
function placeColumn(path: readonly Pt[], slots: ColumnSlot[], head: number, mark: string, moving: number, speedScale: number, banner: { open: boolean; tilt: number } | null, gateZ: number | null = null): Pick<StageFrame, 'figures' | 'banners' | 'litters'> {
    const figures: StageFigure[] = [];
    const banners: StageBanner[] = [];
    const litters: StageLitter[] = [];
    const P = roundPath(path);
    slots.forEach((s, i) => {
        const d = head - s.back;
        const p = offsetAlong(P, d, s.side, true);
        const low = gateZ === null ? 0 : ease((gateZ + 2.6 - p.z) / 1.6);
        const walking = moving > 0.05;
        const g = columnGait(i);
        const phase = g.offset + Math.max(0, d) / (STRIDE * g.stride) / speedScale;
        if (s.role === 'carried') {
            figures.push({ x: p.x, z: p.z, y: 0.62, heading: p.heading, pose: 'carried', phase, lean: 0, mark, spear: false });
            litters.push({ x: p.x, z: p.z, y: 0.6, heading: p.heading });
            return;
        }
        const pose: FigurePose = !walking ? 'stand' : s.role === 'wounded' ? 'limp' : 'walk';
        const spear = s.role === 'soldier' || s.role === 'helper';
        figures.push({ x: p.x, z: p.z, y: 0, heading: p.heading, pose, phase, lean: s.lean, mark, spear, ...(spear && low > 0 ? { spearTilt: round3(GATE_SPEAR_TILT * low) } : {}) });
        if (s.role === 'banner' && banner) banners.push({ x: p.x, z: p.z, y: 0.95, heading: p.heading, mark, tilt: Math.max(banner.tilt, round3(GATE_BANNER_TILT * low)), open: banner.open });
    });
    return { figures, banners, litters };
}

/**
 * 木戸をくぐる兵の画（援兵・帰還）：木戸の外の街道（隊の後ろ・目の高さ 2.4 m）から北の木戸と町を見て、木戸をくぐる背中を追う。
 * 前は木戸の内から外を見る画で、遠くの兵の槍・のぼりの先（3.75〜3.95 m）が木戸の横木・屋根（2.98〜3.9 m）の後ろに隠れ、
 * 兵が横木から吊られて見えた。今は、兵は木戸の手前（カメラの側）では槍を立てて手前に描かれ、くぐる前に槍を担ぎ・のぼりを倒す
 * （placeColumn の gateZ）ので、くぐった後の先は横木の下に収まる（tests/proto3d-town-stage.test.ts）。
 */
const REINF_SHOT_0 = shot(2.4, 2.4, 28.5, -0.2, 1.4, 16.0);
const REINF_SHOT_1 = shot(2.4, 2.4, 28.0, 0.6, 1.3, 12.5);
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
        // 動かさない：木戸の外（街道）に、町の方を向いて並んで立つ（横木より手前）
        head = pathLength([path[0]!, [0, KIDO.z + 2.2]]);
        moving = 0;
    } else {
        const w = walkProgress(t, 0.2, REINF_SPEED, L - start);
        head = start + w.s;
        moving = w.moving;
    }
    const col = placeColumn(path, slots, head, mark, moving, 1, { open: true, tilt: 0 }, KIDO.z);
    const s = reduced ? REINF_SHOT_0 : lerpShot(REINF_SHOT_0, REINF_SHOT_1, ease(t / 7));
    return { people: [], ...col, shot: s, hideCast: [], hideAmbient: ['reinforcement', 'porter', 'merchant'], hero: null };
}

/**
 * 出陣の画：通りの東の端（高札の南・塀ぎわ）の高い所から北西を見下ろし、城門をくぐって通り（町）へ出て来る隊列を斜め横から追う。
 * 隊列が画面の右上（城門）から左下（通り）へ動くので、毎秒 1 コマに満たない画でも出て行くのが分かり、兵は進む向き（南）を向いて歩く。
 * 手前に立つ会話の相手（人物）・城門の輪・通りの人々は、隊列をふさがないよう場面の間だけ隠す。
 */
const DEPART_SHOT_0 = shot(6.0, 4.2, -1.0, -0.4, 0.6, -11.0);
const DEPART_SHOT_1 = shot(6.0, 4.2, -1.4, -0.8, 0.5, -4.5);
const DEPART_SPEED = 1.6;
/** 隊列が整って歩き出すまで（秒） */
export const DEPART_FORM_SEC = 0.5;

function columnDepart(count: number, mark: string, t: number, reduced: boolean, cast: readonly StageCastInfo[]): StageFrame {
    const n = Math.max(0, Math.min(24, Math.floor(count)));
    const slots = columnSlots(n, 0, n > 12 ? 3 : 2);
    const path = ROAD_OUT;
    // 頭の距離：始めは城門のすぐ北（城内で整っている）。歩き出せばすぐに城門をくぐる
    const s0 = pathLength([path[0]!, [0, -12.4]]);
    let head = s0;
    let moving = 0;
    if (reduced) {
        // 動かさない：城門を出た所（通り）に並んで立つ
        head = pathLength([path[0]!, [0, -3.6]]);
    } else {
        const w = walkProgress(t, DEPART_FORM_SEC, DEPART_SPEED, 60);
        head = s0 + w.s;
        moving = w.moving;
    }
    const col = placeColumn(path, slots, head, mark, moving, 1, { open: true, tilt: 0 });
    const s = reduced ? lerpShot(DEPART_SHOT_0, DEPART_SHOT_1, 0.6) : lerpShot(DEPART_SHOT_0, DEPART_SHOT_1, ease((t - 0.4) / 6.5));
    const hideCast = cast.filter((c) => c.kind === 'person' || c.kind === 'gate').map((c) => c.id);
    return { people: [], ...col, shot: s, hideCast, hideAmbient: ['preparing', 'guard', 'porter', 'merchant'], hero: null };
}

// ---------------- 出陣（Version 28 §4.3 の最後の項：主人公の号令と見送り。会話の相手を隠さない）

/** 城門の前の出陣の場所（cast の城門）と、主人公の号令の位置の決まり（始めた時の主人公がここから 4 m より遠いとき：情勢の画面からの見直し） */
const DEPART_GATE: Pt = [0, -10.9];
const DEPART_HERO_DEFAULT: StageOrigin = { x: 0.1, z: -9.4, heading: Math.PI, dirX: 0, dirZ: -1, speed: 0, yaw: 0 };
/** 主人公が隊列の道を空けて立つ所（東・西。始めた所に近い側。東は出陣の画のカメラの側で、隊列に隠れない） */
const DEPART_ASIDE: readonly [Pt, Pt] = [
    [2.4, -9.7],
    [-2.4, -9.6],
];
/** 号令の何秒前に脇へ歩き出すか・歩く速さ・隊列が号令の後に歩き出すまで（秒） */
const DEPART_STEP_EARLY = 0.3;
const DEPART_HERO_SPEED = 1.3;
const DEPART_AFTER_ORDER = 0.3;
/** 隊列の兵の横の広がり（道の真ん中から。兵の大きさを含む）と、主人公との間（m）。主人公はこの外へ出てから、隊列の先頭が横へ来る */
const COLUMN_HALF = 1.35;
const COLUMN_BERTH = 0.6;
/** 号令から出て行く隊列を追う画：城門の前の主人公に近い所から、高い所（今までの出陣の画の終わり）へゆっくり引く */
const DEPART_HERO_SHOT_0 = shot(5.4, 3.3, -3.2, 1.0, 1.3, -10.4);
const DEPART_HERO_SHOT_SEC = 9.5;

/** 歩いた距離が s になる時刻（walkProfile の逆。歩き出しから） */
function timeToWalk(s: number, v: number, L: number): number {
    const T = walkProfile(0, v, L).T;
    if (s <= 0) return 0;
    if (s >= L) return T;
    let a = 0;
    let b = T;
    for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        if (walkProfile(m, v, L).s < s) a = m;
        else b = m;
    }
    return (a + b) / 2;
}

interface DepartPlan {
    o: StageOrigin;
    aside: Pt;
    path: Pt[];
    L: number;
    stepAt: number;
    /** 隊列の頭の始めの距離（ROAD_OUT の上。城門のすぐ北、主人公が城門の中にいればその 1.2 m 北）・歩き出す時刻・号令の前に城門へ向く向き・脇で隊列へ向く向き */
    s0: number;
    start: number;
    faceGate: number;
    faceRoad: number;
}

const departCache = new Map<string, DepartPlan>();

function departPlan(order: number, o0: StageOrigin): DepartPlan {
    const o = Math.hypot(o0.x - DEPART_GATE[0], o0.z - DEPART_GATE[1]) <= 4 ? o0 : DEPART_HERO_DEFAULT;
    const key = JSON.stringify([order, o]);
    const hit = departCache.get(key);
    if (hit) return hit;
    const aside = o.x < -0.8 ? DEPART_ASIDE[1] : DEPART_ASIDE[0];
    const path: Pt[] = [[o.x, o.z], aside];
    const L = pathLength(path);
    const stepAt = Math.max(0.4, order - DEPART_STEP_EARLY);
    // 主人公が隊列の道（|x| < 広がり＋間）の外へ出る時刻（初めから外なら歩き出す時刻）
    const need = COLUMN_HALF + COLUMN_BERTH;
    let clearAt = stepAt;
    if (Math.abs(o.x) < need) {
        const dx = aside[0] - o.x;
        const k = Math.abs(dx) > 1e-6 ? (Math.sign(dx) * need - o.x) / dx : 1;
        clearAt = stepAt + timeToWalk(clampN(k, 0, 1) * L, DEPART_HERO_SPEED, L);
    }
    // 隊列は城門の内に整う（主人公が城門の中に立っていれば、その後ろ）。号令の後に歩き出し、主人公が道を空けてから、先頭が主人公の横（の 1 m 手前）へ来る
    const headZ = Math.min(-12.4, o.z - 1.2);
    const s0 = pathLength([ROAD_OUT[0]!, [0, headZ]]);
    const reach = Math.max(0, Math.min(o.z, aside[1]) - 1.0 - headZ);
    const start = Math.max(order + DEPART_AFTER_ORDER, clearAt - timeToWalk(reach, DEPART_SPEED, 60));
    const plan: DepartPlan = {
        o,
        aside,
        path,
        L,
        stepAt,
        s0,
        start: round3(start),
        faceGate: headingTo([o.x, o.z], [0, -12.0]),
        faceRoad: headingTo(aside, [0, aside[1] - 1.2]),
    };
    departCache.set(key, plan);
    if (departCache.size > 32) departCache.delete(departCache.keys().next().value!);
    return plan;
}

/**
 * 出陣（号令あり）：主人公は城門の前で城門（城内に整った隊列）の方を向いて号令し、号令の終わりに隊列の道を空けて脇へ歩いて立ち、
 * 出て行く隊列の方を向いて見送る（顔と目線は旗）。隊列は号令の後に歩き出し、主人公が道を空けてから横を通る。
 * 会話の相手の人物（立つ人）は隠さず、置き場所で隊列の方へ足を踏み替えて向き、旗が前を通ると軽く礼をする（会話の相手そのもの：入れ替えない）。
 * 城門の輪（出陣の印）・支度の兵・通りの人々は今までどおり場面の間だけ隠す。カメラは主人公に近い所から高い所へゆっくり引く（切らない）
 */
function departWithHero(count: number, mark: string, order: number, t: number, reduced: boolean, cast: readonly StageCastInfo[], origin: StageOrigin): StageFrame {
    const P = departPlan(order, origin);
    const n = Math.max(0, Math.min(24, Math.floor(count)));
    const slots = columnSlots(n, 0, n > 12 ? 3 : 2);
    let head = P.s0;
    let moving = 0;
    if (reduced) head = pathLength([ROAD_OUT[0]!, [0, -3.6]]);
    else {
        const w = walkProgress(t, P.start, DEPART_SPEED, 60);
        head = P.s0 + w.s;
        moving = w.moving;
    }
    const col = placeColumn(ROAD_OUT, slots, head, mark, moving, 1, { open: true, tilt: 0 });
    const flag = col.banners[0] ?? null;
    const flagAt = flag ? { x: round3(flag.x), y: 2.4, z: round3(flag.z) } : { x: 0, y: 1.6, z: -12.5 };
    // ---- 主人公：号令（城門の方を向く）→ 脇へ歩く → 隊列の方を向いて見送る
    let hx = P.o.x;
    let hz = P.o.z;
    let h: number;
    if (reduced) {
        hx = P.aside[0];
        hz = P.aside[1];
        h = P.faceRoad;
    } else {
        const w = walkProfile(t - P.stepAt, DEPART_HERO_SPEED, P.L);
        const p = alongPath(P.path, w.s);
        hx = p.x;
        hz = p.z;
        const tArrive = P.stepAt + w.T;
        h = lerpAngle(P.o.heading, P.faceGate, ease(t / 0.4));
        if (t >= P.stepAt) h = lerpAngle(P.faceGate, p.heading, ease((t - P.stepAt) / SET_OFF_SEC));
        if (t >= tArrive) h = lerpAngle(p.heading, P.faceRoad, ease((t - tArrive) / FACE_SEC));
    }
    const hero: StageHero = { x: round3(hx), z: round3(hz), heading: roundH(h) };
    const heroGaze = !reduced && t < P.start ? { x: 0, y: 1.7, z: -12.6 } : flagAt;
    // ---- 会話の相手（立つ人）：置き場所のまま、隊列の先頭が近づくと隊列の方へ向き、旗が前を通ると軽く礼をする
    const people: StagePerson[] = [];
    for (const c of cast) {
        if (c.kind !== 'person' || c.pose === 'sit' || !c.look) continue;
        const faceH = headingTo([c.x, c.z], [0, c.z - 0.8]);
        let heading = c.heading;
        let bow = 0;
        let lookW = 0;
        if (reduced) {
            heading = faceH;
            lookW = 0.8;
        } else {
            // 先頭が 8 m 手前に来たら向き直り始める。旗（先頭の列）が前を通る時刻に礼（道の脇の人だけ）
            const sTurn = clampN(c.z - 8 - ROAD_OUT[0]![1] - P.s0, 0, 60);
            const tTurn = P.start + timeToWalk(sTurn, DEPART_SPEED, 60);
            heading = lerpAngle(c.heading, faceH, ease((t - tTurn) / 0.8));
            lookW = 0.8 * ease((t - tTurn) / 0.8);
            if (Math.abs(c.x) < 4) {
                const sPass = clampN(c.z - ROAD_OUT[0]![1] - P.s0, 0, 60);
                bow = bowWeight(t - (P.start + timeToWalk(sPass, DEPART_SPEED, 60)));
            }
        }
        people.push({
            key: c.id,
            cast: c.id,
            look: c.look,
            name: '',
            x: c.x,
            z: c.z,
            heading: roundH(heading),
            walked: 0,
            moving: 0,
            label: false,
            act: { ...NO_ACT, look: flagAt, lookWeight: round3(lookW * (1 - bow)), bow: round3(bow) },
        });
    }
    const s = reduced ? lerpShot(DEPART_HERO_SHOT_0, DEPART_SHOT_1, 0.6) : lerpShot(DEPART_HERO_SHOT_0, DEPART_SHOT_1, ease((t - 0.2) / DEPART_HERO_SHOT_SEC));
    const hideCast = cast.filter((c) => c.kind === 'gate').map((c) => c.id);
    return { people, ...col, shot: s, hideCast, hideAmbient: ['preparing', 'guard', 'porter', 'merchant'], hero, heroGaze };
}

/** 確かめ用：出陣（号令あり）の配置（主人公の始め・脇の立つ所・脇へ歩き出す時刻・隊列の歩き出す時刻） */
export function departLayout(order: number, origin: StageOrigin): { from: Pt; aside: Pt; stepAt: number; start: number } {
    const P = departPlan(order, origin);
    return { from: [P.o.x, P.o.z], aside: P.aside, stepAt: P.stepAt, start: P.start };
}

/**
 * 帰還の画：援兵と同じく、木戸の外の街道（隊列の後ろの東・目の高さ 2.5 m）から北の木戸と町を見て、木戸をくぐって町へ帰る隊列の背中を追う。
 * 最後の列の負傷兵・担架が手前に来る。
 */
const RETURN_SHOT_0 = shot(4.0, 2.5, 36.0, -0.8, 1.3, 17.5);
const RETURN_SHOT_1 = shot(4.0, 2.5, 35.5, -0.3, 1.2, 14.0);
const RETURN_SPEED = 1.2;

function columnReturn(count: number, wounded: number, mark: string, victory: boolean, t: number, reduced: boolean): StageFrame {
    const n = Math.max(0, Math.min(24, Math.floor(count)));
    const slots = columnSlots(n, wounded, n > 12 ? 3 : 2);
    const path = ROAD_IN;
    const s0 = pathLength([path[0]!, [0, KIDO.z + 3.0]]);
    let head = s0;
    let moving = 1;
    if (reduced) {
        // 動かさない：木戸の手前（街道）に、町の方を向いて止まって並ぶ（横木より手前）
        head = pathLength([path[0]!, [0, KIDO.z + 1.6]]);
        moving = 0;
    } else {
        const w = walkProgress(t, 0.2, RETURN_SPEED, 60);
        head = s0 + w.s;
        moving = w.moving;
    }
    // 勝てば旗を掲げる（真っすぐ・広げる）。勝てなければ旗を巻いて傾けて運ぶ
    const col = placeColumn(path, slots, head, mark, moving, RETURN_SPEED / DEPART_SPEED, victory ? { open: true, tilt: 0 } : { open: false, tilt: 0.55 }, KIDO.z);
    const s = reduced ? RETURN_SHOT_0 : lerpShot(RETURN_SHOT_0, RETURN_SHOT_1, ease(t / 9));
    return { people: [], ...col, shot: s, hideCast: [], hideAmbient: ['porter', 'merchant'], hero: null };
}

/** 確かめ用：出来事の id ごとの、カメラが通る所を t の列で返す（カメラ除けの確かめ・ゆっくりの確かめ） */
export function shotsOver(ev: StageEvent, reduced: boolean, until = 20, step = 0.1, cast: readonly StageCastInfo[] = [], origin: StageOrigin = REPORT_DEFAULT_ORIGIN): { t: number; shot: StageShot }[] {
    const out: { t: number; shot: StageShot }[] = [];
    // 町の急報・第二章の冒頭の使いの急報は場面の長さまで（その後は操作。カメラは肩越しへ戻る）
    const after = afterWalkEnd(ev);
    const end = after !== null ? Math.min(until, after) : until;
    const n = Math.round(end / step);
    for (let i = 0; i <= n; i++) {
        const t = Math.round(i * step * 1000) / 1000;
        out.push({ t, shot: stageFrame(ev, t, reduced, cast, origin).shot });
    }
    return out;
}
