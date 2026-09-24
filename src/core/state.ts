/**
 * ゲームの状態（データだけ）。描画や DOM のことは知らない。
 */
import { emptyBattleRecord, type BattleRecord } from './battle/model';
import type { DialogueScript, TalkTarget } from './dialogue';
import { PLAYER_START, RETAINER_POS, areaAtPixel, tileCenter, type AreaId } from './map';
import type { Facing } from './types';

export interface Flags {
    /** 家臣に最初の指示をもらった */
    metRetainer: boolean;
    visitedTown: boolean;
    visitedRoad: boolean;
    /** 見回りを報告した */
    reported: boolean;
}

export interface ActorState {
    /** 足元の中心座標（px） */
    x: number;
    y: number;
    facing: Facing;
    moving: boolean;
    /** 歩きアニメ用の累計歩行時間（秒） */
    walkTime: number;
}

export interface DialogueState {
    target: TalkTarget;
    script: DialogueScript;
    index: number;
    /** 最後の行に選択肢があるとき、いま選んでいる番号 */
    choice: number;
    /** 上下の入力で選択肢を 1 つずつ動かすための押しっぱなし判定 */
    navLatch: boolean;
}

export interface GameState {
    player: ActorState;
    retainer: ActorState;
    flags: Flags;
    area: AreaId;
    playTimeSec: number;
    dialogue: DialogueState | null;
    /** 模擬戦の記録（結果・家臣の戦闘不能・回数） */
    battle: BattleRecord;
}

export function initialFlags(): Flags {
    return { metRetainer: false, visitedTown: false, visitedRoad: false, reported: false };
}

export function createActor(x: number, y: number, facing: Facing): ActorState {
    return { x, y, facing, moving: false, walkTime: 0 };
}

export function createRetainer(): ActorState {
    const p = tileCenter(RETAINER_POS.tx, RETAINER_POS.ty);
    return createActor(p.x, p.y, 'left');
}

export function createNewGameState(): GameState {
    const p = tileCenter(PLAYER_START.tx, PLAYER_START.ty);
    return {
        player: createActor(p.x, p.y, 'down'),
        retainer: createRetainer(),
        flags: initialFlags(),
        area: areaAtPixel(p.x, p.y),
        playTimeSec: 0,
        dialogue: null,
        battle: emptyBattleRecord(),
    };
}
