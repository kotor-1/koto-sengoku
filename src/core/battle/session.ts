/**
 * 模擬戦の進行。入力 1 フレーム分と経過時間を受け取って状態を更新する（Phaser・DOM 非依存）。
 *
 * - 指揮中（paused）は戦闘の時間が完全に止まる：誰も動かず、クールダウンも振りかぶりも進まない。
 *   命令の変更だけは受け付け、再開すると全員が同じフレームから動き出す。
 * - 乱数は使わない（同じ入力なら同じ結果になり、テストで確かめられる）。
 */
import { ACTOR_HALF_H, ACTOR_HALF_W, MAX_STEP_SEC } from '../constants';
import { moveWithCollision } from '../collision';
import type { InputFrame } from '../input';
import { rectHitsSolidTile } from '../map';
import type { Facing, Rect } from '../types';
import {
    ARENA, FOLLOW_OFFSETS, RETAINER_IDS, STATS, createBattle,
    type BattleResult, type BattleState, type Order, type RetainerId, type Unit,
} from './model';

export type BattleEvent =
    | { type: 'attack'; unitId: string; targetId: string | null }
    | { type: 'hit'; attackerId: string; targetId: string; damage: number }
    | { type: 'down'; unitId: string }
    /** 命令が自動で切り替わった（移動し終えた → 待機、狙った相手が倒れた → 待機） */
    | { type: 'orderChanged'; unitId: string; order: Order }
    | { type: 'ended'; outcome: BattleState['outcome'] };

/** 追従中の家臣が相手に向かう距離（家臣から） */
const FOLLOW_ENGAGE = 44;
/** 追従中の家臣が主人公から離れてよい距離 */
const FOLLOW_LEASH = 84;
/** 待機中の家臣が、その場から踏み出して戦ってよい距離 */
const HOLD_REACH = 14;
/** 人どうしが重ならない距離 */
const PERSONAL_SPACE = 12;
/** 攻撃の見た目の長さ（秒） */
const SWING_TIME = 0.25;
/** 敵が狙いを見直す間隔（秒） */
const RETARGET_INTERVAL = 0.5;
/** 訓練場の内側の余白 */
const ARENA_MARGIN = 6;

export class BattleSession {
    readonly state: BattleState;
    private retargetTimer = 0;

    constructor(state: BattleState = createBattle()) {
        this.state = state;
    }

    // ---- 参照 ----

    unit(id: string): Unit | undefined {
        return this.state.units.find((u) => u.id === id);
    }

    get hero(): Unit {
        return this.unit('hero')!;
    }

    retainers(): Unit[] {
        return this.state.units.filter((u) => u.kind === 'retainer');
    }

    enemies(): Unit[] {
        return this.state.units.filter((u) => u.side === 'enemy');
    }

    activeEnemies(): Unit[] {
        return this.enemies().filter((u) => !u.down);
    }

    get isOver(): boolean {
        return this.state.outcome !== null;
    }

    // ---- 指揮 ----

    /** 指揮を始める：戦闘の時間を止める */
    pause(): void {
        if (!this.isOver) this.state.paused = true;
    }

    /** 指揮を終えて再開する */
    resume(): void {
        this.state.paused = false;
    }

    /**
     * 家臣に命令を出す。出せたら true。
     * - 戦闘不能の家臣、終わった戦いには出せない。
     * - 移動先は訓練場の中の通れる場所に限る（外なら内側へ寄せ、通れなければ出せない）。
     * - 攻撃は、戦える訓練相手にだけ出せる。
     */
    giveOrder(retainerId: RetainerId, order: Order): boolean {
        const u = this.unit(retainerId);
        if (!u || u.kind !== 'retainer' || u.down || this.isOver) return false;
        if (order.kind === 'move' || order.kind === 'hold') {
            const p = this.validPoint(order.x, order.y);
            if (!p) return false;
            u.order = { kind: order.kind, x: p.x, y: p.y };
            return true;
        }
        if (order.kind === 'attack') {
            const t = this.unit(order.targetId);
            if (!t || t.side !== 'enemy' || t.down) return false;
            u.order = { kind: 'attack', targetId: t.id };
            return true;
        }
        u.order = { kind: 'follow' };
        return true;
    }

    /** 画面で指した場所の近くにいる、戦える訓練相手（攻撃目標の選択用） */
    enemyNear(x: number, y: number, radius = 18): Unit | null {
        let best: Unit | null = null;
        let bestD = radius;
        for (const e of this.activeEnemies()) {
            // 足元だけでなく体（上へ 20px ほど）を指しても選べるようにする
            const d = Math.min(Math.hypot(e.x - x, e.y - y), Math.hypot(e.x - x, e.y - 14 - y));
            if (d <= bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /** 移動先として使える位置（訓練場の内側へ寄せる）。通れない場所なら null */
    validPoint(x: number, y: number): { x: number; y: number } | null {
        const p = {
            x: Math.max(ARENA.x0 + ARENA_MARGIN, Math.min(ARENA.x1 - ARENA_MARGIN, x)),
            y: Math.max(ARENA.y0 + ARENA_MARGIN, Math.min(ARENA.y1 - ARENA_MARGIN, y)),
        };
        return this.blocked(box(p.x, p.y)) ? null : p;
    }

    /** 撤退する（戦いを終える） */
    retreat(): BattleEvent[] {
        if (this.isOver) return [];
        this.state.outcome = 'retreat';
        this.state.paused = false;
        return [{ type: 'ended', outcome: 'retreat' }];
    }

    /** 終わった戦いの記録（終わっていなければ null） */
    result(): BattleResult | null {
        const o = this.state.outcome;
        if (!o) return null;
        const down = (id: RetainerId) => this.unit(id)?.down ?? false;
        return {
            outcome: o,
            retainersDown: { genzo: down('genzo'), shinpachi: down('shinpachi') },
            defeated: this.enemies().filter((e) => e.down).length,
            seconds: Math.floor(this.state.time),
        };
    }

    // ---- 1 フレーム ----

    step(input: InputFrame, dtSec: number): BattleEvent[] {
        const s = this.state;
        if (s.outcome || s.paused) return [];
        const dt = Math.max(0, Math.min(dtSec, MAX_STEP_SEC));
        if (dt === 0) return [];
        const events: BattleEvent[] = [];
        s.time += dt;

        for (const u of s.units) {
            u.cooldown = Math.max(0, u.cooldown - dt);
            u.swing = Math.max(0, u.swing - dt);
            u.moving = false;
        }

        this.stepHero(input, dt, events);
        for (const id of RETAINER_IDS) {
            const u = this.unit(id);
            if (u && !u.down) this.stepRetainer(u, id, dt, events);
        }
        this.retargetTimer -= dt;
        const retarget = this.retargetTimer <= 0;
        if (retarget) this.retargetTimer = RETARGET_INTERVAL;
        for (const e of this.enemies()) if (!e.down) this.stepEnemy(e, dt, retarget, events);

        // 振りかぶった攻撃が当たる
        for (const u of s.units) {
            if (u.down || u.windup <= 0) continue;
            u.windup -= dt;
            if (u.windup <= 0) {
                u.windup = 0;
                const t = u.windupTargetId ? this.unit(u.windupTargetId) : undefined;
                u.windupTargetId = null;
                if (t && !t.down && dist(u, t) <= STATS[u.kind].range * 1.35) this.damage(u, t, events);
            }
        }

        this.separate();
        this.checkOutcome(events);
        return events;
    }

    // ---- 主人公 ----

    private stepHero(input: InputFrame, dt: number, events: BattleEvent[]): void {
        const h = this.hero;
        if (h.down) return;
        const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
        if (mag > 0.01) {
            h.aimX = input.moveX / mag;
            h.aimY = input.moveY / mag;
            h.facing = facingOf(input.moveX, input.moveY);
            this.moveBy(h, (input.moveX / mag) * STATS.hero.speed * mag * dt, (input.moveY / mag) * STATS.hero.speed * mag * dt);
        }
        if (input.action && h.cooldown <= 0) this.heroAttack(h, events);
    }

    /**
     * 主人公の攻撃：向いている方向（約 160° の扇形）で届く相手のうち、いちばん近い 1 人に当たる。
     * 囲まれても一度に全員は倒せないので、家臣への指示が意味を持つ。
     */
    private heroAttack(h: Unit, events: BattleEvent[]): void {
        const st = STATS.hero;
        h.cooldown = st.cooldown;
        h.swing = SWING_TIME;
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const e of this.activeEnemies()) {
            const d = dist(h, e);
            if (d > st.range) continue;
            const dot = d < 1 ? 1 : ((e.x - h.x) * h.aimX + (e.y - h.y) * h.aimY) / d;
            if (dot < 0.15 && d > 10) continue;
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            h.facing = facingOf(best.x - h.x, best.y - h.y);
            this.damage(h, best, events);
        }
        events.push({ type: 'attack', unitId: h.id, targetId: best?.id ?? null });
    }

    // ---- 家臣 ----

    private stepRetainer(u: Unit, id: RetainerId, dt: number, events: BattleEvent[]): void {
        if (u.windup > 0) return; // 振りかぶり中は動かない
        const o = u.order ?? { kind: 'follow' };
        const h = this.hero;
        switch (o.kind) {
            case 'follow': {
                const enemy = this.nearestEnemy(u, (e) => dist(u, e) <= FOLLOW_ENGAGE && dist(h, e) <= FOLLOW_LEASH);
                if (enemy && !h.down) {
                    this.fight(u, enemy, dt, events);
                    return;
                }
                const off = FOLLOW_OFFSETS[id];
                const slot = this.validPoint(h.x + off.x, h.y + off.y) ?? { x: h.x, y: h.y };
                this.moveToward(u, slot.x, slot.y, dt, 4);
                return;
            }
            case 'hold': {
                const reach = STATS.retainer.range;
                const enemy = this.nearestEnemy(u, (e) => Math.hypot(e.x - o.x, e.y - o.y) <= reach + HOLD_REACH);
                if (enemy) {
                    if (dist(u, enemy) <= reach * 0.95) this.strike(u, enemy, events);
                    else if (Math.hypot(u.x - o.x, u.y - o.y) < HOLD_REACH) this.moveToward(u, enemy.x, enemy.y, dt, reach * 0.85);
                    else this.moveToward(u, o.x, o.y, dt, 2);
                    return;
                }
                this.moveToward(u, o.x, o.y, dt, 2);
                return;
            }
            case 'move': {
                // 移動中は寄り道しない（指示どおりの配置を優先する）
                if (this.moveToward(u, o.x, o.y, dt, 3)) {
                    u.order = { kind: 'hold', x: o.x, y: o.y };
                    events.push({ type: 'orderChanged', unitId: u.id, order: u.order });
                }
                return;
            }
            case 'attack': {
                const t = this.unit(o.targetId);
                if (!t || t.down) {
                    u.order = { kind: 'hold', x: u.x, y: u.y };
                    events.push({ type: 'orderChanged', unitId: u.id, order: u.order });
                    return;
                }
                this.fight(u, t, dt, events);
                return;
            }
        }
    }

    // ---- 訓練相手 ----

    private stepEnemy(e: Unit, dt: number, retarget: boolean, events: BattleEvent[]): void {
        let t = e.targetId ? this.unit(e.targetId) : undefined;
        if (!t || t.down || retarget) {
            const allies = this.state.units.filter((u) => u.side === 'ally' && !u.down);
            let best = t && !t.down ? t : undefined;
            let bestD = best ? dist(e, best) - 16 : Infinity; // 今の相手を少しだけ優先（ふらつき防止）
            for (const a of allies) {
                const d = dist(e, a);
                if (d < bestD) {
                    bestD = d;
                    best = a;
                }
            }
            t = best;
            e.targetId = t?.id ?? null;
        }
        if (!t || e.windup > 0) return;
        this.fight(e, t, dt, events);
    }

    // ---- 共通の動き ----

    /** 相手に近づき、届けば攻撃する */
    private fight(u: Unit, t: Unit, dt: number, events: BattleEvent[]): void {
        const range = STATS[u.kind].range;
        if (dist(u, t) > range * 0.95) this.moveToward(u, t.x, t.y, dt, range * 0.85);
        else this.strike(u, t, events);
    }

    /** 攻撃を始める（振りかぶり → 当たる）。クールダウン中なら向きだけ合わせる */
    private strike(u: Unit, t: Unit, events: BattleEvent[]): void {
        u.facing = facingOf(t.x - u.x, t.y - u.y);
        if (u.cooldown > 0 || u.windup > 0) return;
        const st = STATS[u.kind];
        u.cooldown = st.cooldown;
        u.swing = Math.max(SWING_TIME, st.windup + 0.1);
        events.push({ type: 'attack', unitId: u.id, targetId: t.id });
        if (st.windup <= 0) this.damage(u, t, events);
        else {
            u.windup = st.windup;
            u.windupTargetId = t.id;
        }
    }

    private damage(from: Unit, to: Unit, events: BattleEvent[]): void {
        if (to.down) return;
        const dmg = STATS[from.kind].damage;
        to.hp = Math.max(0, to.hp - dmg);
        to.hitCount++;
        to.lastDamage = dmg;
        events.push({ type: 'hit', attackerId: from.id, targetId: to.id, damage: dmg });
        if (to.hp <= 0) {
            to.down = true;
            to.moving = false;
            to.windup = 0;
            to.windupTargetId = null;
            events.push({ type: 'down', unitId: to.id });
        }
    }

    /** 目標へ歩く。stop 以内に着いていれば true */
    private moveToward(u: Unit, tx: number, ty: number, dt: number, stop: number): boolean {
        const dx = tx - u.x;
        const dy = ty - u.y;
        const d = Math.hypot(dx, dy);
        // 小数の誤差で「あと 0.0000001px」のまま着かないことがないよう、わずかに余裕を持たせる
        if (d <= stop + 0.05) return true;
        const stepLen = Math.min(STATS[u.kind].speed * dt, d - stop);
        u.facing = facingOf(dx, dy);
        this.moveBy(u, (dx / d) * stepLen, (dy / d) * stepLen);
        return false;
    }

    private moveBy(u: Unit, dx: number, dy: number): void {
        const res = moveWithCollision(u, dx, dy, ACTOR_HALF_W, ACTOR_HALF_H, (r) => this.blocked(r));
        u.x = res.x;
        u.y = res.y;
        u.moving = res.moved > 0.01;
    }

    private blocked(r: Rect): boolean {
        if (r.x < ARENA.x0 || r.y < ARENA.y0 || r.x + r.w > ARENA.x1 || r.y + r.h > ARENA.y1) return true;
        return rectHitsSolidTile(r);
    }

    private nearestEnemy(u: Unit, ok: (e: Unit) => boolean): Unit | null {
        let best: Unit | null = null;
        let bestD = Infinity;
        for (const e of this.activeEnemies()) {
            if (!ok(e)) continue;
            const d = dist(u, e);
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    /** 人どうしが重ならないように押し広げる（戦闘不能の人は通り抜けられる） */
    private separate(): void {
        const active = this.state.units.filter((u) => !u.down);
        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                if (d >= PERSONAL_SPACE) continue;
                if (d < 0.001) {
                    dx = 1;
                    dy = 0;
                    d = 1;
                }
                const push = (PERSONAL_SPACE - d) / 2;
                this.nudge(a, (-dx / d) * push, (-dy / d) * push);
                this.nudge(b, (dx / d) * push, (dy / d) * push);
            }
        }
    }

    private nudge(u: Unit, dx: number, dy: number): void {
        const res = moveWithCollision(u, dx, dy, ACTOR_HALF_W, ACTOR_HALF_H, (r) => this.blocked(r));
        u.x = res.x;
        u.y = res.y;
    }

    private checkOutcome(events: BattleEvent[]): void {
        const s = this.state;
        if (s.outcome) return;
        if (this.hero.down) s.outcome = 'defeat';
        else if (this.activeEnemies().length === 0) s.outcome = 'victory';
        if (s.outcome) events.push({ type: 'ended', outcome: s.outcome });
    }
}

function box(x: number, y: number): Rect {
    return { x: x - ACTOR_HALF_W, y: y - ACTOR_HALF_H, w: ACTOR_HALF_W * 2, h: ACTOR_HALF_H * 2 };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function facingOf(dx: number, dy: number): Facing {
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}
