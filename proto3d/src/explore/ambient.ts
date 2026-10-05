/**
 * 町の人々（AmbientSpec）の置き方（純粋。three も DOM も使わない）。描くのは explore/actors.ts。
 * 設計：docs/story-rpg-design.md §5.1。会話の相手とは別（話しかけられない・名札なし・当たり判定なし）。
 *
 * - 荷を運ぶ人（porter）・店の人（merchant）：人物の素材の写し（合わせて 4 人まで）。荷運びは荷置き場と店先を行き来する。
 * - 門番（guard）・出陣を待つ兵（preparing）・負傷兵（wounded）・援兵（reinforcement）：合戦の兵の形（軽い）。旗は spec の mark。
 * - 置き場所は種類ごとに決まった所（B の決まりと同じ：guardpost は詰所、castle は城内、gate は城門、street は通り）。
 *   道の真ん中（x −1.5〜2.5、z −12〜3）・人物へ南から近づく道すじ・城門への道すじには入らない（tests/proto3d-town.test.ts）。
 * - 動きは探索の時計（time 秒）で決める（演出ではない。同じ time なら同じ形）。
 */
import type { AmbientGroup, AmbientSpec } from '../story/types';
import { alongPath, pathLength, woundedLayout, type Pt, type StageBanner, type StageFigure, type StagePerson } from './stage';

/** 人物の素材の写しの数の上限（重いので少なく） */
export const AMBIENT_PEOPLE_MAX = 4;
/** 兵の形の数の上限 */
export const AMBIENT_FIGURES_MAX = 40;

/** 行き来する人（往復の道すじ・速さ・両端で止まる秒・始めのずれ） */
export interface AmbientWalker {
    key: string;
    role: 'porter' | 'merchant';
    look: string;
    path: readonly Pt[];
    speed: number;
    pause: number;
    offset: number;
    /** 端で向く向き（始めの端・終わりの端） */
    faceStart: number;
    faceEnd: number;
    /** 荷を持つ向き（'out'：始め→終わりで持つ） */
    carry: boolean;
}

/** 兵の形の 1 人・のぼり（町の人々の種類つき：出来事が同じ所に同じ人々を出すときは、その種類を隠す） */
export type AmbientFigure = StageFigure & { kind: AmbientGroup['kind'] };
export type AmbientBanner = StageBanner & { kind: AmbientGroup['kind'] };

export interface AmbientPlan {
    walkers: AmbientWalker[];
    figures: AmbientFigure[];
    banners: AmbientBanner[];
}

const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

/** 荷運びの道すじ：荷置き場（道の西）→ 町家 B の店先 ／ 町家の写しの前 → 町家 D の店先 */
export const PORTER_PATHS: readonly (readonly Pt[])[] = [
    [
        [-8.0, 8.85],
        [-4.9, 8.75],
        [-3.1, 7.6],
        [-3.1, 6.6],
        [-3.75, 6.3],
    ],
    [
        [3.2, 12.3],
        [3.2, 7.2],
        [3.45, 6.7],
    ],
];
/** 店の人の立つ所：[x, z, 向き] */
export const MERCHANT_SPOTS: readonly [number, number, number][] = [
    [-3.6, 2.6, EAST],
    [3.75, 14.0, WEST],
];
/**
 * 門番の立つ所（城門の内側、開いた扉と控柱の北。南（町）を向く）。兵の形は人物の素材より粗いので、開始の画面の正面（門の手前）には立てない。
 * 出陣の隊列が門を通る間は脇へ退く（出来事の間は隠す）
 */
export const GUARD_SPOTS: readonly [number, number, number][] = [
    [-1.25, -14.9, 0],
    [1.25, -14.9, 0],
    [-3.0, -14.0, 0],
    [3.0, -14.0, 0],
];

/** 出陣を待つ兵（城内、城門の北（門番の後ろ）に 4 列。南（城門）を向く。旗持ちは前の列の西の端） */
export function preparingLayout(count: number, mark: string): { figures: StageFigure[]; banners: StageBanner[] } {
    const n = Math.max(0, Math.min(16, Math.floor(count)));
    const xs = [-1.8, -0.6, 0.6, 1.8];
    const figures: StageFigure[] = [];
    const banners: StageBanner[] = [];
    for (let i = 0; i < n; i++) {
        const x = xs[i % 4]!;
        const z = -16.0 - Math.floor(i / 4) * 1.25;
        figures.push({ x, z, y: 0, heading: 0, pose: 'stand', phase: i * 0.31, lean: 0, mark, spear: i !== 0 });
        if (i === 0) banners.push({ x, z, y: 0.95, heading: 0, mark, tilt: 0, open: true });
    }
    return { figures, banners };
}

/** 援兵（詰所の東、2 列で西を向く。旗持ちは前の列の北の端） */
export function reinforcementLayout(count: number, mark: string): { figures: StageFigure[]; banners: StageBanner[] } {
    const n = Math.max(0, Math.min(9, Math.floor(count)));
    const figures: StageFigure[] = [];
    const banners: StageBanner[] = [];
    for (let i = 0; i < n; i++) {
        const x = 15.4 + Math.floor(i / 3) * 1.15;
        const z = -3.7 + (i % 3) * 1.1;
        figures.push({ x, z, y: 0, heading: WEST, pose: 'stand', phase: i * 0.29, lean: 0, mark, spear: i !== 0 });
        if (i === 0) banners.push({ x, z, y: 0.95, heading: WEST, mark, tilt: 0, open: true });
    }
    return { figures, banners };
}

/** 町の人々の置き方（同じ spec なら同じ物） */
export function ambientPlan(spec: AmbientSpec | null): AmbientPlan {
    const walkers: AmbientWalker[] = [];
    const figures: AmbientFigure[] = [];
    const banners: AmbientBanner[] = [];
    if (!spec) return { walkers, figures, banners };
    const tag = <T extends object>(kind: AmbientGroup['kind'], xs: T[]) => xs.map((x) => ({ ...x, kind }));
    const count = (k: AmbientGroup['kind']) => spec.groups.filter((g) => g.kind === k).reduce((n, g) => n + Math.max(0, Math.floor(g.count)), 0);
    const markOf = (k: AmbientGroup['kind']) => spec.groups.find((g) => g.kind === k && g.mark)?.mark ?? '徳';
    // 荷運び（2 人まで）と店の人（2 人まで）。合わせて AMBIENT_PEOPLE_MAX 人まで
    const porters = Math.min(PORTER_PATHS.length, count('porter'));
    for (let i = 0; i < porters; i++) {
        const path = PORTER_PATHS[i]!;
        walkers.push({ key: `porter${i}`, role: 'porter', look: i === 0 ? 'townsman_a' : 'townsman_b', path, speed: 1.15, pause: 2.6, offset: i * 5.3, faceStart: WEST, faceEnd: i === 0 ? WEST : EAST, carry: true });
    }
    const merchants = Math.min(MERCHANT_SPOTS.length, count('merchant'), AMBIENT_PEOPLE_MAX - walkers.length);
    for (let i = 0; i < merchants; i++) {
        const [x, z, h] = MERCHANT_SPOTS[i]!;
        walkers.push({ key: `merchant${i}`, role: 'merchant', look: i === 0 ? 'merchant_a' : 'merchant_b', path: [[x, z]], speed: 0, pause: 0, offset: i * 1.7, faceStart: h, faceEnd: h, carry: false });
    }
    // 門番
    const guards = Math.min(GUARD_SPOTS.length, count('guard'));
    for (let i = 0; i < guards; i++) {
        const [x, z, h] = GUARD_SPOTS[i]!;
        figures.push({ x, z, y: 0, heading: h, pose: 'stand', phase: i * 0.5, lean: 0, mark: markOf('guard'), spear: true, kind: 'guard' });
    }
    // 出陣を待つ兵（城内）
    const prep = preparingLayout(count('preparing'), markOf('preparing'));
    figures.push(...tag('preparing', prep.figures));
    banners.push(...tag('preparing', prep.banners));
    // 負傷兵（詰所）
    figures.push(...tag('wounded', woundedLayout(count('wounded'))));
    // 援兵（詰所）
    const rein = reinforcementLayout(count('reinforcement'), markOf('reinforcement'));
    figures.push(...tag('reinforcement', rein.figures));
    banners.push(...tag('reinforcement', rein.banners));
    return { walkers, figures: figures.slice(0, AMBIENT_FIGURES_MAX), banners };
}

/** 端で向き直る時間（秒） */
const TURN_SEC = 0.6;
/** 向き a から b へ、k（0〜1）だけ回す（近い回り。なめらかに） */
function turnTo(a: number, b: number, k: number): number {
    const x = Math.max(0, Math.min(1, k));
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * x * x * (3 - 2 * x);
}

/** 行き来する人の、時刻 time（探索の時計の秒）の姿（純粋） */
export function walkerAt(w: AmbientWalker, time: number): StagePerson & { carrying: boolean; work: number } {
    if (w.speed <= 0 || w.path.length < 2) {
        const [x, z] = w.path[0]!;
        // 店先の作業：ゆっくりお辞儀・手を動かす（0〜1）
        const work = 0.5 + 0.5 * Math.sin((time + w.offset) * 0.9);
        return { key: w.key, look: w.look, name: '', x, z, heading: w.faceStart, walked: 0, moving: 0, label: false, carrying: false, work };
    }
    const L = pathLength(w.path);
    const leg = L / w.speed;
    const T = 2 * (leg + w.pause);
    const u = (((time + w.offset) % T) + T) % T;
    // 始めの端で止まる → 行く（荷を持つ）→ 終わりの端で止まる → 戻る（手ぶら）
    let s: number;
    let moving = 0;
    let heading: number;
    let carrying: boolean;
    let walked: number;
    const out0 = alongPath(w.path, 0).heading;
    const in1 = alongPath(w.path, L).heading;
    if (u < w.pause) {
        s = 0;
        // 着いた向きから端の向きへ、出る前に道の向きへ（ゆっくり向き直る）
        heading = turnTo(turnTo(out0 + Math.PI, w.faceStart, u / TURN_SEC), out0, (u - (w.pause - TURN_SEC)) / TURN_SEC);
        carrying = w.carry && u > w.pause * 0.5;
        walked = 0;
    } else if (u < w.pause + leg) {
        s = (u - w.pause) * w.speed;
        moving = Math.min(1, Math.min(s, L - s) / 0.35);
        heading = alongPath(w.path, s).heading;
        carrying = w.carry;
        walked = s;
    } else if (u < 2 * w.pause + leg) {
        s = L;
        const k = u - w.pause - leg;
        heading = turnTo(turnTo(in1, w.faceEnd, k / TURN_SEC), in1 + Math.PI, (k - (w.pause - TURN_SEC)) / TURN_SEC);
        carrying = w.carry && u < w.pause * 1.5 + leg;
        walked = L;
    } else {
        const back = (u - 2 * w.pause - leg) * w.speed;
        s = L - back;
        moving = Math.min(1, Math.min(back, L - back) / 0.35);
        heading = alongPath(w.path, s).heading + Math.PI;
        carrying = false;
        walked = L + back;
    }
    const p = alongPath(w.path, s);
    return { key: w.key, look: w.look, name: '', x: p.x, z: p.z, heading, walked, moving, label: false, carrying, work: 0 };
}
