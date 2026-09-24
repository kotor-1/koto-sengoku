/**
 * 模擬戦（小規模な戦闘・指揮）のデータ定義。Phaser・DOM に依存しない。
 *
 * - 戦場は既存マップの「城の東の原っぱ」（城壁と外周の木に囲まれた 11×13 タイル）を訓練場として使う。
 * - 人数：主人公 1、味方家臣 2（源蔵・新八）、訓練相手 4。
 * - 模擬戦なので「戦闘不能」は死亡ではない。結果に関係なく城へ戻り、全員回復する。
 */
import { TILE_SIZE } from '../constants';
import type { Facing } from '../types';

export type Side = 'ally' | 'enemy';
export type UnitKind = 'hero' | 'retainer' | 'trainee';

/** 家臣への命令 */
export type Order =
    | { kind: 'follow' }
    /** その場（x, y）で待機。届く範囲の相手とだけ戦う */
    | { kind: 'hold'; x: number; y: number }
    /** 指定地点へ移動。着いたらそこで待機に変わる */
    | { kind: 'move'; x: number; y: number }
    /** 指定した相手を追って攻撃。相手が戦闘不能になったらその場で待機に変わる */
    | { kind: 'attack'; targetId: string };

export type OrderKind = Order['kind'];

export const ORDER_LABELS: Record<OrderKind, string> = {
    follow: '追従',
    hold: '待機',
    move: '移動',
    attack: '攻撃',
};

export interface UnitStats {
    maxHp: number;
    /** 歩く速さ（px/秒） */
    speed: number;
    damage: number;
    /** 攻撃が届く距離（中心どうし, px） */
    range: number;
    /** 攻撃の間隔（秒） */
    cooldown: number;
    /** 振りかぶってから当たるまで（秒）。0 なら即座に当たる */
    windup: number;
}

export const STATS: Record<UnitKind, UnitStats> = {
    hero: { maxHp: 150, speed: 76, damage: 12, range: 22, cooldown: 0.5, windup: 0 },
    retainer: { maxHp: 70, speed: 68, damage: 9, range: 19, cooldown: 1.0, windup: 0.3 },
    trainee: { maxHp: 110, speed: 56, damage: 6, range: 18, cooldown: 1.3, windup: 0.4 },
};

export interface Unit {
    id: string;
    name: string;
    side: Side;
    kind: UnitKind;
    x: number;
    y: number;
    facing: Facing;
    /** 主人公の狙う向き（最後に動いた方向の単位ベクトル） */
    aimX: number;
    aimY: number;
    hp: number;
    down: boolean;
    moving: boolean;
    /** 次に攻撃できるまで（秒） */
    cooldown: number;
    /** 振りかぶり中の残り時間（秒）と、その狙い */
    windup: number;
    windupTargetId: string | null;
    /** 表示用：攻撃の動きの残り時間（秒）・受けた攻撃の回数・最後に受けた量 */
    swing: number;
    hitCount: number;
    lastDamage: number;
    /** 家臣だけ：命令 */
    order: Order | null;
    /** 敵だけ：いま狙っている相手 */
    targetId: string | null;
}

export type BattleOutcome = 'victory' | 'defeat' | 'retreat';

export const OUTCOME_LABELS: Record<BattleOutcome, string> = {
    victory: '勝利',
    defeat: '敗北',
    retreat: '撤退',
};

export interface BattleState {
    units: Unit[];
    /** 戦闘の経過時間（秒）。指揮中は進まない */
    time: number;
    /** 指揮中（戦闘の時間が止まっている） */
    paused: boolean;
    outcome: BattleOutcome | null;
}

/** 戦いの結果の記録（保存データに入る。描画オブジェクトは入れない） */
export interface BattleResult {
    outcome: BattleOutcome;
    /** 家臣ごとの戦闘不能 */
    retainersDown: Record<RetainerId, boolean>;
    /** 倒した訓練相手の数 */
    defeated: number;
    /** 戦闘の経過時間（秒、整数） */
    seconds: number;
}

export type RetainerId = 'genzo' | 'shinpachi';
export const RETAINER_IDS: readonly RetainerId[] = ['genzo', 'shinpachi'];
export const RETAINER_NAMES: Record<RetainerId, string> = { genzo: '源蔵', shinpachi: '新八' };

// ---------------------------------------------------------------------------
// 訓練場
// ---------------------------------------------------------------------------

const T = TILE_SIZE;
const tc = (tx: number, ty: number) => ({ x: tx * T + T / 2, y: ty * T + T / 2 });

/** 訓練場の範囲（ワールド px）。この外へは出られない。 */
export const ARENA = { x0: 44 * T, y0: 1 * T, x1: 55 * T, y1: 14 * T } as const;

export const SPAWNS = {
    hero: tc(49, 11.5),
    genzo: tc(47, 12),
    shinpachi: tc(51, 12),
    trainees: [tc(46, 4.5), tc(48.3, 3.5), tc(50.7, 3.5), tc(53, 4.5)],
} as const;

/** 追従するときの主人公からのずれ（左後ろ・右後ろ） */
export const FOLLOW_OFFSETS: Record<RetainerId, { x: number; y: number }> = {
    genzo: { x: -20, y: 14 },
    shinpachi: { x: 20, y: 14 },
};

export const TRAINEE_NAMES = ['訓練相手・一', '訓練相手・二', '訓練相手・三', '訓練相手・四'];

function unit(id: string, name: string, side: Side, kind: UnitKind, p: { x: number; y: number }, facing: Facing): Unit {
    return {
        id,
        name,
        side,
        kind,
        x: p.x,
        y: p.y,
        facing,
        aimX: 0,
        aimY: facing === 'up' ? -1 : 1,
        hp: STATS[kind].maxHp,
        down: false,
        moving: false,
        cooldown: 0,
        windup: 0,
        windupTargetId: null,
        swing: 0,
        hitCount: 0,
        lastDamage: 0,
        order: kind === 'retainer' ? { kind: 'follow' } : null,
        targetId: null,
    };
}

/** 新しい模擬戦（全員が全快の状態で始まる） */
export function createBattle(): BattleState {
    const units: Unit[] = [
        unit('hero', '若殿', 'ally', 'hero', SPAWNS.hero, 'up'),
        unit('genzo', RETAINER_NAMES.genzo, 'ally', 'retainer', SPAWNS.genzo, 'up'),
        unit('shinpachi', RETAINER_NAMES.shinpachi, 'ally', 'retainer', SPAWNS.shinpachi, 'up'),
        ...SPAWNS.trainees.map((p, i) => unit(`trainee${i + 1}`, TRAINEE_NAMES[i], 'enemy', 'trainee', p, 'down')),
    ];
    return { units, time: 0, paused: false, outcome: null };
}

// ---------------------------------------------------------------------------
// 記録（探索側の状態に入り、保存される）
// ---------------------------------------------------------------------------

/** 模擬戦の記録。保存データに入るので、数と真偽値だけで作る。 */
export interface BattleRecord {
    /** 最後の模擬戦の結果（まだ一度もしていなければ null） */
    last: BattleResult | null;
    victories: number;
    defeats: number;
    retreats: number;
    /** 最後の結果を、まだ源蔵と話していない（城へ戻ると話す。保存・再開後も残る） */
    debriefPending: boolean;
}

export function emptyBattleRecord(): BattleRecord {
    return { last: null, victories: 0, defeats: 0, retreats: 0, debriefPending: false };
}

export function recordBattleResult(rec: BattleRecord, r: BattleResult): void {
    rec.last = { ...r, retainersDown: { ...r.retainersDown } };
    if (r.outcome === 'victory') rec.victories++;
    else if (r.outcome === 'defeat') rec.defeats++;
    else rec.retreats++;
    rec.debriefPending = true;
}

export function copyBattleRecord(rec: BattleRecord): BattleRecord {
    return { ...rec, last: rec.last ? { ...rec.last, retainersDown: { ...rec.last.retainersDown } } : null };
}
