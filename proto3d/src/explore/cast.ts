/**
 * 探索の場面（城門前の街路）に置く人物・高札・城門の出陣の場所。第一章の段階と状態に合わせて決める。
 * 純粋な TypeScript（three も DOM も使わない）。表示は explore/world.ts、話しかけの判定は campaign/game.ts が使う。
 *
 * - 誰が居るかは campaign/flow.ts の presentTalks に従う（捕らわれた人物は居ない。使者は選んだ陣営の者だけ）。
 * - 負傷した人物は、床几（腰掛け）に座らせる（pose 'sit'）。
 * - 置き場所は、道・門・町家の前の通り道を塞がない所（tests/proto3d-cast.test.ts で、開始の位置から歩いて
 *   話しかけられること・城門へ抜けられることを確かめる）。
 *
 * 仮シナリオ：人物・出来事は架空の仮の設定（campaign/story.ts の先頭の注記）。
 */
import { presentTalks } from '../campaign/flow';
import type { CampaignState, CharacterId, TalkId } from '../campaign/state';
import { CHARACTER_NAMES } from '../campaign/story';
import { BOUNDS, START, type Rect } from '../layout';
import { isFree } from '../game/motion';

export type CastKind = 'person' | 'notice' | 'gate';

export interface CastMember {
    id: TalkId;
    kind: CastKind;
    /** 見た目の元（人物のとき。explore/world.ts が色を変える） */
    look?: CharacterId;
    x: number;
    z: number;
    /** 向き（ラジアン。motion.ts と同じ：0 = +z（南）、π = 北） */
    heading: number;
    pose: 'stand' | 'sit';
    /** 頭の上に出す名前 */
    label: string;
    /** 話しかけるボタンの言葉（「話す」「読む」「出陣」） */
    verb: string;
    /** この距離（m）まで近づくと話しかけられる */
    reach: number;
    /** 物語を進める相手（目印を付ける） */
    key: boolean;
    /** 通れない所（人物・高札）。城門の出陣の場所は通れる（null） */
    solid: Rect | null;
}

/** 話しかけられる距離（人物・高札）。城門の出陣の場所の広さ */
export const TALK_REACH = 2.0;
export const GATE_REACH = 1.6;
/** 人物・腰掛けた人物・高札の当たり判定の半分の幅 */
const PERSON_HALF = 0.25;
const SITTER_HALF = 0.4;

/** 向き：(x, z) から (tx, tz) を向く */
export function headingToward(x: number, z: number, tx: number, tz: number): number {
    return Math.atan2(tx - x, tz - z);
}

const WEST = -Math.PI / 2;
const SOUTH = 0;

/** 置き場所（段階ごと）。[x, z, 向き]。向きを省けば開始の位置の方を向く */
type Spot = [number, number, number?];
const SPOTS: Record<'explore' | 'muster' | 'aftermath', Partial<Record<TalkId | 'genzo_sit' | 'shinpachi_sit' | 'envoy' | 'envoy_sit', Spot>>> = {
    explore: {
        // 源蔵：門の手前、道の西寄り（開始の画面の正面やや左に見える）
        genzo: [-1.5, -7.2],
        // 新八：道の東の空き地（東の土塀の手前）
        shinpachi: [5.3, -2.4, WEST],
        notice: [5.5, -8.3, WEST],
    },
    muster: {
        // 城門へ向かう道の両脇に源蔵と使者（間を通って門へ）
        genzo: [-2.0, -7.4],
        envoy: [2.0, -7.1],
        shinpachi: [5.3, -2.4, WEST],
        notice: [5.5, -8.3, WEST],
        // 城門の出陣の場所（門の開口の手前）
        gate: [0, -10.9, SOUTH],
    },
    aftermath: {
        genzo: [-2.0, -7.4],
        // 負傷した源蔵は、町家の前の床几に腰掛ける（道に面して東向き）
        genzo_sit: [-3.1, -5.4, Math.PI / 2],
        envoy: [2.0, -7.1],
        envoy_sit: [2.9, -6.6, WEST],
        shinpachi: [5.3, -2.4, WEST],
        shinpachi_sit: [5.6, -1.2, WEST],
        notice: [5.5, -8.3, WEST],
    },
};

const rectAround = (x: number, z: number, hx: number, hz = hx): Rect => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });

/** 物語を進める相手（目印を付ける）：探索は源蔵、支度は城門、戦後は源蔵 */
export function keyTalk(state: CampaignState): TalkId | null {
    switch (state.phase) {
        case 'explore':
        case 'aftermath':
            return 'genzo';
        case 'muster':
            return 'gate';
        default:
            return null;
    }
}

/** 今の段階・状態で、街路に置くもの（探索できない段階では空） */
export function castFor(state: CampaignState): CastMember[] {
    const phase = state.phase;
    if (phase !== 'explore' && phase !== 'muster' && phase !== 'aftermath') return [];
    const spots = SPOTS[phase];
    const key = keyTalk(state);
    const out: CastMember[] = [];
    for (const id of presentTalks(state)) {
        if (id === 'council') continue;
        if (id === 'gate') {
            const [x, z, h] = spots.gate!;
            out.push({ id, kind: 'gate', x, z, heading: h ?? SOUTH, pose: 'stand', label: '城門（出陣）', verb: '出陣', reach: GATE_REACH, key: key === id, solid: null });
            continue;
        }
        if (id === 'notice') {
            const [x, z, h] = spots.notice!;
            const heading = h ?? WEST;
            // 板は向きに直交して横に長い（西向きなら南北に長い）
            const alongZ = Math.abs(Math.sin(heading)) > 0.5;
            out.push({ id, kind: 'notice', x, z, heading, pose: 'stand', label: '高札', verb: '読む', reach: TALK_REACH, key: key === id, solid: alongZ ? rectAround(x, z, 0.2, 0.8) : rectAround(x, z, 0.8, 0.2) });
            continue;
        }
        const person = id as CharacterId;
        const wounded = state.characters[person] === 'wounded';
        const envoy = person === 'tashiro_envoy' || person === 'omori_envoy';
        const base = envoy ? 'envoy' : (person as 'genzo' | 'shinpachi');
        const sit = wounded && phase === 'aftermath';
        const spot = (sit ? spots[`${base}_sit` as const] : undefined) ?? spots[base];
        if (!spot) continue;
        const [x, z, h] = spot;
        out.push({
            id,
            kind: 'person',
            look: person,
            x,
            z,
            heading: h ?? headingToward(x, z, START.x, START.z),
            pose: sit ? 'sit' : 'stand',
            label: CHARACTER_NAMES[person],
            verb: '話す',
            reach: TALK_REACH,
            key: key === id,
            solid: rectAround(x, z, sit ? SITTER_HALF : PERSON_HALF),
        });
    }
    return out;
}

/** 置いたものの当たり判定（探索の歩きの判定に足す） */
export function castColliders(cast: readonly CastMember[]): Rect[] {
    return cast.flatMap((c) => (c.solid ? [c.solid] : []));
}

/** 主人公の位置から、話しかけられる一番近い相手（届く範囲に誰もいなければ null） */
export function nearestInteractable(cast: readonly CastMember[], x: number, z: number): CastMember | null {
    let best: CastMember | null = null;
    let bestScore = Infinity;
    for (const c of cast) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d > c.reach) continue;
        // 城門の場所は「入った」扱いなので、人物と重なったときは人物を先に（距離を届く範囲で割って比べる）
        const score = d / c.reach + (c.kind === 'gate' ? 0.5 : 0);
        if (score < bestScore) {
            best = c;
            bestScore = score;
        }
    }
    return best;
}

/** 城門の出陣の場所の中にいるか */
export function inGateZone(cast: readonly CastMember[], x: number, z: number): boolean {
    return cast.some((c) => c.kind === 'gate' && Math.hypot(c.x - x, c.z - z) <= c.reach);
}

/** 開始の位置（段階の最初・保存に位置が無いとき） */
export const DEFAULT_POSE = { x: START.x, z: START.z, heading: START.heading } as const;

/**
 * 保存の位置をそのまま使えるか確かめる（壁・人物の中・歩ける範囲の外なら開始の位置へ。2D 版の「位置が壁の中なら初期位置に戻す」と同じ）。
 * 城門の出陣の場所の中に戻すと、すぐ出陣の確認が出てしまうので、その場合も開始の位置へ。
 */
export function safePose(pose: { x: number; z: number; heading: number } | null, cast: readonly CastMember[], walls: Rect[]): { x: number; z: number; heading: number } {
    if (!pose) return { ...DEFAULT_POSE };
    const rects = [...walls, ...castColliders(cast)];
    if (!isFree(pose.x, pose.z, rects) || inGateZone(cast, pose.x, pose.z) || !inBounds(pose.x, pose.z)) return { ...DEFAULT_POSE };
    return { x: pose.x, z: pose.z, heading: pose.heading };
}

function inBounds(x: number, z: number): boolean {
    const m = 0.3;
    return x > BOUNDS.x0 + m && x < BOUNDS.x1 - m && z > BOUNDS.z0 + m && z < BOUNDS.z1 - m;
}
