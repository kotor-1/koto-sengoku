/**
 * ゲームの進行ロジック。入力 1 フレーム分を受け取り、状態を更新する。
 * Phaser や DOM には依存しないので、テストから直接動かせる。
 */
import { ACTOR_HALF_H, ACTOR_HALF_W, INTERACT_REACH, MAX_STEP_SEC, WALK_SPEED } from './constants';
import { actorBox, moveWithCollision, rectGap, rectsOverlap } from './collision';
import { recordBattleResult, type BattleResult } from './battle/model';
import { scriptFor, type ChoiceId, type DialogueChoice, type DialogueLine, type TalkTarget } from './dialogue';
import type { InputFrame } from './input';
import { TILE_SPOTS, areaAtPixel, rectHitsSolidTile, tileCenter, tileRect, type AreaId } from './map';
import { createNewGameState, type ActorState, type GameState } from './state';
import { FACING_VECTORS, type Facing, type Rect, type Vec2 } from './types';

export type GameEvent =
    | { type: 'areaChanged'; area: AreaId }
    | { type: 'dialogueStarted'; target: TalkTarget }
    | { type: 'dialogueEnded'; target: TalkTarget }
    /** 会話の選択肢を選んだ（会話はそこで終わる） */
    | { type: 'choiceSelected'; choice: ChoiceId };

/** 模擬戦から戻ったときに立つ場所（城門の内側、源蔵の左隣） */
export const BATTLE_RETURN_TILE = { tx: 31, ty: 10 } as const;

export interface Interactable {
    target: TalkTarget;
    rect: Rect;
    center: Vec2;
    /** 画面に出す動詞（話す／調べる） */
    verb: '話す' | '調べる';
    name: string;
}

export class GameSession {
    readonly state: GameState;

    constructor(state: GameState = createNewGameState()) {
        this.state = state;
    }

    /** dt 秒ぶん進める。起きた出来事を返す。 */
    step(input: InputFrame, dtSec: number): GameEvent[] {
        const dt = Math.max(0, Math.min(dtSec, MAX_STEP_SEC));
        const events: GameEvent[] = [];
        const s = this.state;
        s.playTimeSec += dt;

        if (s.dialogue) {
            s.player.moving = false;
            const d = s.dialogue;
            // 上下で選び、決定で選ぶ（押しっぱなしで次々動かないよう、いったん離すまで 1 つだけ）
            const ny = input.moveY;
            const nav = Math.abs(ny) > 0.5;
            if (this.currentChoices()) {
                if (nav && !d.navLatch) this.moveChoice(ny > 0 ? 1 : -1);
                if (input.action) events.push(...this.selectChoice(d.choice));
            } else if (input.action) this.advanceDialogue(events);
            if (nav) d.navLatch = true;
            else if (Math.abs(ny) < 0.3) d.navLatch = false;
            return events;
        }

        this.movePlayer(input, dt);
        this.updateArea(events);

        if (input.action) {
            const target = this.nearbyInteractable();
            if (target) this.startDialogue(target, events);
        }
        return events;
    }

    currentLine(): DialogueLine | null {
        const d = this.state.dialogue;
        return d ? d.script.lines[d.index] ?? null : null;
    }

    /** いま選択肢を出しているなら、その一覧（最後の行のときだけ） */
    currentChoices(): readonly DialogueChoice[] | null {
        const d = this.state.dialogue;
        if (!d || !d.script.choices?.length || d.index < d.script.lines.length - 1) return null;
        return d.script.choices;
    }

    /** 選択肢の選択を上下に動かす（端で止まる） */
    moveChoice(delta: number): void {
        const d = this.state.dialogue;
        const cs = this.currentChoices();
        if (!d || !cs) return;
        d.choice = Math.max(0, Math.min(cs.length - 1, d.choice + delta));
    }

    /** 選択肢を選んで会話を終える。選択肢が出ていなければ何もしない。 */
    selectChoice(index: number): GameEvent[] {
        const d = this.state.dialogue;
        const cs = this.currentChoices();
        if (!d || !cs || index < 0 || index >= cs.length) return [];
        const events: GameEvent[] = [];
        this.endDialogue(events);
        events.push({ type: 'choiceSelected', choice: cs[index].id });
        return events;
    }

    /** 近さに関係なく、指定した相手との会話を始める（模擬戦から戻ったときなど） */
    talkTo(target: TalkTarget): GameEvent[] {
        const it = this.interactables().find((i) => i.target === target);
        if (!it || this.state.dialogue) return [];
        const events: GameEvent[] = [];
        this.startDialogue(it, events);
        return events;
    }

    /**
     * 模擬戦から城へ戻る：結果を記録し（報告待ちにする）、源蔵の隣へ立たせる。
     * 模擬戦なので、結果に関係なく全員回復している（探索側に体力はない）。
     */
    returnFromBattle(result: BattleResult): GameEvent[] {
        const s = this.state;
        recordBattleResult(s.battle, result);
        const p = tileCenter(BATTLE_RETURN_TILE.tx, BATTLE_RETURN_TILE.ty);
        s.player.x = p.x;
        s.player.y = p.y;
        s.player.facing = 'right';
        s.player.moving = false;
        s.dialogue = null;
        const events: GameEvent[] = [];
        this.updateArea(events);
        return events;
    }

    /** 主人公の正面近くにある、話しかけ／調べられるもの */
    nearbyInteractable(): Interactable | null {
        const p = this.state.player;
        const box = actorBox(p, ACTOR_HALF_W, ACTOR_HALF_H);
        const f = FACING_VECTORS[p.facing];
        let best: Interactable | null = null;
        let bestScore = -Infinity;
        for (const it of this.interactables()) {
            const gap = rectGap(box, it.rect);
            if (gap > INTERACT_REACH) continue;
            const dx = it.center.x - p.x;
            const dy = it.center.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            const dot = (dx * f.x + dy * f.y) / len;
            // 正面から大きく外れているものは対象外
            if (dot < 0.35) continue;
            const score = dot - gap * 0.01;
            if (score > bestScore) {
                bestScore = score;
                best = it;
            }
        }
        return best;
    }

    interactables(): Interactable[] {
        const r = this.state.retainer;
        const list: Interactable[] = [
            {
                target: 'retainer',
                rect: actorBox(r, ACTOR_HALF_W, ACTOR_HALF_H),
                center: { x: r.x, y: r.y },
                verb: '話す',
                name: '源蔵',
            },
        ];
        for (const spot of TILE_SPOTS) {
            list.push({
                target: spot.id,
                rect: tileRect(spot.tx, spot.ty),
                center: tileCenter(spot.tx, spot.ty),
                verb: '調べる',
                name: spot.id === 'notice' ? '高札' : spot.id === 'milestone' ? '道標' : '井戸',
            });
        }
        return list;
    }

    /** 壁・建物・家臣と重なっているか */
    isBlocked(r: Rect): boolean {
        if (rectHitsSolidTile(r)) return true;
        return rectsOverlap(r, actorBox(this.state.retainer, ACTOR_HALF_W, ACTOR_HALF_H));
    }

    private movePlayer(input: InputFrame, dt: number): void {
        const p = this.state.player;
        const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
        if (mag < 0.01) {
            p.moving = false;
            return;
        }
        p.facing = facingFromVector(input.moveX, input.moveY, p.facing);
        const speed = WALK_SPEED * mag;
        const res = moveWithCollision(
            p,
            (input.moveX / mag) * speed * dt,
            (input.moveY / mag) * speed * dt,
            ACTOR_HALF_W,
            ACTOR_HALF_H,
            (r) => this.isBlocked(r),
        );
        p.x = res.x;
        p.y = res.y;
        p.moving = res.moved > 0.01;
        if (p.moving) p.walkTime += dt;
    }

    private updateArea(events: GameEvent[]): void {
        const s = this.state;
        const area = areaAtPixel(s.player.x, s.player.y);
        if (area === s.area) return;
        s.area = area;
        if (area === 'town') s.flags.visitedTown = true;
        if (area === 'road') s.flags.visitedRoad = true;
        events.push({ type: 'areaChanged', area });
    }

    private startDialogue(it: Interactable, events: GameEvent[]): void {
        const s = this.state;
        const script = scriptFor(it.target, s.flags, s.battle);
        if (script.setFlags) Object.assign(s.flags, script.setFlags);
        if (script.clearsDebrief) s.battle.debriefPending = false;
        s.dialogue = { target: it.target, script, index: 0, choice: script.defaultChoice ?? 0, navLatch: true };
        s.player.moving = false;
        if (it.target === 'retainer') faceToward(s.retainer, s.player);
        events.push({ type: 'dialogueStarted', target: it.target });
    }

    private advanceDialogue(events: GameEvent[]): void {
        const s = this.state;
        const d = s.dialogue;
        if (!d) return;
        d.index++;
        if (d.index >= d.script.lines.length) this.endDialogue(events);
    }

    private endDialogue(events: GameEvent[]): void {
        const s = this.state;
        const d = s.dialogue;
        if (!d) return;
        s.dialogue = null;
        if (d.target === 'retainer') s.retainer.facing = 'left';
        events.push({ type: 'dialogueEnded', target: d.target });
    }
}

/** 入力の向きから顔の向きを決める。ほぼ斜めのときは今の向きを保つ（向きのちらつき防止）。 */
export function facingFromVector(x: number, y: number, current: Facing): Facing {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (Math.abs(ax - ay) < 0.15 * Math.max(ax, ay)) {
        if ((current === 'left' && x < 0) || (current === 'right' && x > 0)) return current;
        if ((current === 'up' && y < 0) || (current === 'down' && y > 0)) return current;
    }
    if (ax > ay) return x < 0 ? 'left' : 'right';
    return y < 0 ? 'up' : 'down';
}

function faceToward(actor: ActorState, target: Vec2): void {
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    actor.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}
