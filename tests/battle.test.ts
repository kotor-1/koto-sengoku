import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../src/core/input';
import { ARENA, STATS, createBattle, type Unit } from '../src/core/battle/model';
import { BattleSession, type BattleEvent } from '../src/core/battle/session';

const DT = 1 / 60;
const idle: InputFrame = { moveX: 0, moveY: 0, action: false };

/** 主人公を簡単に自動操作：いちばん近い相手へ歩き、届けば攻撃 */
function autoHero(s: BattleSession): InputFrame {
    const h = s.hero;
    const es = s.activeEnemies();
    if (h.down || es.length === 0) return idle;
    const e = es.reduce((a, b) => (Math.hypot(a.x - h.x, a.y - h.y) < Math.hypot(b.x - h.x, b.y - h.y) ? a : b));
    const dx = e.x - h.x;
    const dy = e.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > STATS.hero.range * 0.8) return { moveX: dx / d, moveY: dy / d, action: false };
    // 向きを相手へ合わせつつ攻撃
    return { moveX: (dx / d) * 0.05, moveY: (dy / d) * 0.05, action: true };
}

function run(s: BattleSession, seconds: number, input: (s: BattleSession) => InputFrame = () => idle): BattleEvent[] {
    const events: BattleEvent[] = [];
    for (let t = 0; t < seconds && !s.isOver; t += DT) events.push(...s.step(input(s), DT));
    return events;
}

const pos = (u: Unit) => ({ x: u.x, y: u.y });
const near = (u: Unit, p: { x: number; y: number }, r: number) => Math.hypot(u.x - p.x, u.y - p.y) <= r;

describe('模擬戦の準備', () => {
    it('主人公 1・家臣 2・訓練相手 4、全員全快、家臣は追従から始まる', () => {
        const s = new BattleSession();
        expect(s.state.units.filter((u) => u.kind === 'hero')).toHaveLength(1);
        expect(s.retainers().map((u) => u.id)).toEqual(['genzo', 'shinpachi']);
        expect(s.enemies()).toHaveLength(4);
        for (const u of s.state.units) expect(u.hp).toBe(STATS[u.kind].maxHp);
        for (const r of s.retainers()) expect(r.order).toEqual({ kind: 'follow' });
    });

    it('全員が訓練場の中の通れる場所に立っている', () => {
        const s = new BattleSession();
        for (const u of s.state.units) {
            expect(u.x).toBeGreaterThan(ARENA.x0);
            expect(u.x).toBeLessThan(ARENA.x1);
            expect(s.validPoint(u.x, u.y)).not.toBeNull();
        }
    });
});

describe('主人公の攻撃', () => {
    it('クールダウン中は連打しても 1 回しか当たらない', () => {
        const s = new BattleSession();
        const h = s.hero;
        const e = s.enemies()[0];
        h.x = e.x;
        h.y = e.y + 14;
        h.aimX = 0;
        h.aimY = -1;
        const hp0 = e.hp;
        s.step({ moveX: 0, moveY: 0, action: true }, DT);
        s.step({ moveX: 0, moveY: 0, action: true }, DT);
        s.step({ moveX: 0, moveY: 0, action: true }, DT);
        expect(e.hp).toBe(hp0 - STATS.hero.damage);
        // クールダウンが明ければ 2 回目
        run(s, STATS.hero.cooldown, () => ({ moveX: 0, moveY: 0, action: false }));
        s.step({ moveX: 0, moveY: 0, action: true }, DT);
        expect(e.hp).toBe(hp0 - STATS.hero.damage * 2);
    });

    it('背中側の相手には当たらない', () => {
        const s = new BattleSession();
        const h = s.hero;
        const e = s.enemies()[0];
        h.x = e.x;
        h.y = e.y + 16;
        h.aimX = 0;
        h.aimY = 1; // 下を向いている（相手は上）
        const hp0 = e.hp;
        s.step({ moveX: 0, moveY: 0, action: true }, DT);
        expect(e.hp).toBe(hp0);
    });

    it('HP が 0 になると戦闘不能になり、敗北で終わる', () => {
        const s = new BattleSession();
        s.hero.hp = 1;
        const ev = run(s, 20); // 主人公は棒立ち
        expect(s.hero.down).toBe(true);
        expect(s.state.outcome).toBe('defeat');
        expect(ev).toContainEqual({ type: 'ended', outcome: 'defeat' });
    });
});

describe('指揮（時間の停止と再開）', () => {
    it('指揮中は誰も動かず、時間・クールダウン・振りかぶりも進まない', () => {
        const s = new BattleSession();
        run(s, 1.2, autoHero); // 戦いを少し進めておく
        s.pause();
        const before = JSON.stringify(s.state.units);
        const t0 = s.state.time;
        const ev = run(s, 3, () => ({ moveX: 1, moveY: 0, action: true }));
        expect(ev).toEqual([]);
        expect(s.state.time).toBe(t0);
        expect(JSON.stringify(s.state.units)).toBe(before);
    });

    it('指揮中でも命令は変えられ、再開すると全員が同じフレームから動く', () => {
        const s = new BattleSession();
        s.pause();
        expect(s.giveOrder('genzo', { kind: 'move', x: 46 * 16, y: 8 * 16 })).toBe(true);
        expect(s.giveOrder('shinpachi', { kind: 'attack', targetId: 'trainee4' })).toBe(true);
        expect(s.retainers()[0].order).toMatchObject({ kind: 'move' });
        const before = s.state.units.map(pos);
        s.step(idle, DT); // 止まったまま
        expect(s.state.units.map(pos)).toEqual(before);
        s.resume();
        s.step(idle, DT);
        const moved = s.state.units.filter((u, i) => u.x !== before[i].x || u.y !== before[i].y).map((u) => u.id);
        // 家臣 2 人と、主人公へ向かう訓練相手が同じフレームで動き出す
        expect(moved).toEqual(expect.arrayContaining(['genzo', 'shinpachi', 'trainee1', 'trainee2', 'trainee3', 'trainee4']));
    });

    it('戦闘不能の家臣・倒れた相手・訓練場の外には命令できない', () => {
        const s = new BattleSession();
        s.enemies()[0].down = true;
        expect(s.giveOrder('genzo', { kind: 'attack', targetId: 'trainee1' })).toBe(false);
        expect(s.giveOrder('genzo', { kind: 'attack', targetId: 'hero' })).toBe(false);
        // 城壁の中（通れない）
        expect(s.giveOrder('genzo', { kind: 'move', x: 43 * 16 + 8, y: 8 * 16 })).toBe(true); // 内側へ寄せられる
        expect(s.retainers()[0].order).toMatchObject({ kind: 'move' });
        expect((s.retainers()[0].order as { x: number }).x).toBeGreaterThanOrEqual(ARENA.x0);
        s.retainers()[1].down = true;
        expect(s.giveOrder('shinpachi', { kind: 'follow' })).toBe(false);
    });
});

describe('2 人の家臣に別々の命令を出すと、配置と行動が変わる', () => {
    it('源蔵＝左奥へ移動、新八＝右端の相手を攻撃 → 源蔵は指定地点に立ち、新八はその相手を攻撃する', () => {
        const s = new BattleSession();
        const target = s.unit('trainee4')!;
        target.hp = 40; // 行動の確認なので、倒れるまでを短くする
        const dest = { x: 45 * 16 + 8, y: 3 * 16 + 8 };
        s.pause();
        s.giveOrder('genzo', { kind: 'move', ...dest });
        s.giveOrder('shinpachi', { kind: 'attack', targetId: target.id });
        s.resume();
        const events = run(s, 6); // 主人公は動かない
        const genzo = s.unit('genzo')!;
        // 源蔵：指定地点に着いて、そこで待機に切り替わった
        expect(events).toContainEqual({ type: 'orderChanged', unitId: 'genzo', order: { kind: 'hold', x: dest.x, y: dest.y } });
        expect(near(genzo, dest, 14)).toBe(true);
        // 新八：指定した相手が倒れるまでは、その相手だけに攻撃を当てた（途中でほかの相手に気を取られない）
        const downAt = events.findIndex((e) => e.type === 'down' && e.unitId === target.id);
        expect(downAt).toBeGreaterThan(0);
        const shinHits = events
            .slice(0, downAt)
            .filter((e) => e.type === 'hit' && e.attackerId === 'shinpachi') as Extract<BattleEvent, { type: 'hit' }>[];
        expect(shinHits.length).toBeGreaterThan(0);
        expect(shinHits.every((h) => h.targetId === target.id)).toBe(true);
        // 倒した後は、その場で待機に切り替わる
        expect(events.slice(downAt)).toContainEqual(expect.objectContaining({ type: 'orderChanged', unitId: 'shinpachi', order: expect.objectContaining({ kind: 'hold' }) }));
    });

    it('同じ状況で命令が違えば、家臣の立ち位置がはっきり違う（追従のままとの比較）', () => {
        const follow = new BattleSession();
        run(follow, 3);
        const ordered = new BattleSession();
        ordered.giveOrder('genzo', { kind: 'move', x: 45 * 16 + 8, y: 3 * 16 + 8 });
        ordered.giveOrder('shinpachi', { kind: 'hold', x: 53 * 16 + 8, y: 12 * 16 + 8 });
        run(ordered, 3);
        const g1 = follow.unit('genzo')!;
        const g2 = ordered.unit('genzo')!;
        const s1 = follow.unit('shinpachi')!;
        const s2 = ordered.unit('shinpachi')!;
        expect(Math.hypot(g1.x - g2.x, g1.y - g2.y)).toBeGreaterThan(40);
        expect(Math.hypot(s1.x - s2.x, s1.y - s2.y)).toBeGreaterThan(20);
        // 待機を命じた新八は、その場から大きく離れない
        expect(near(s2, { x: 53 * 16 + 8, y: 12 * 16 + 8 }, 16)).toBe(true);
    });

    it('攻撃目標が倒れると、その場で待機に切り替わる', () => {
        const s = new BattleSession();
        const t = s.unit('trainee1')!;
        s.giveOrder('genzo', { kind: 'attack', targetId: t.id });
        t.hp = 1;
        const ev = run(s, 8);
        expect(t.down).toBe(true);
        expect(ev.some((e) => e.type === 'orderChanged' && e.unitId === 'genzo' && e.order.kind === 'hold')).toBe(true);
    });
});

describe('勝敗と撤退', () => {
    it('主人公が戦い、家臣が追従すれば勝てる（訓練相手 4 人がすべて戦闘不能 → 勝利）', () => {
        const s = new BattleSession();
        const ev = run(s, 60, autoHero);
        expect(s.state.outcome).toBe('victory');
        expect(s.activeEnemies()).toHaveLength(0);
        expect(ev).toContainEqual({ type: 'ended', outcome: 'victory' });
        const r = s.result()!;
        expect(r.outcome).toBe('victory');
        expect(r.defeated).toBe(4);
    });

    it('家臣を遠くに待機させ、主人公が戦わなければ負ける', () => {
        const s = new BattleSession();
        s.giveOrder('genzo', { kind: 'hold', x: 44 * 16 + 8, y: 13 * 16 + 4 });
        s.giveOrder('shinpachi', { kind: 'hold', x: 54 * 16 + 8, y: 13 * 16 + 4 });
        run(s, 60);
        expect(s.state.outcome).toBe('defeat');
        expect(s.result()!.outcome).toBe('defeat');
    });

    it('撤退を選ぶと撤退で終わり、その後は何も動かない', () => {
        const s = new BattleSession();
        run(s, 1, autoHero);
        const ev = s.retreat();
        expect(ev).toEqual([{ type: 'ended', outcome: 'retreat' }]);
        expect(s.state.outcome).toBe('retreat');
        const snap = JSON.stringify(s.state.units);
        expect(run(s, 2, autoHero)).toEqual([]);
        expect(JSON.stringify(s.state.units)).toBe(snap);
        expect(s.retreat()).toEqual([]); // 二度目は何もしない
    });

    it('結果には家臣ごとの戦闘不能が記録される', () => {
        const s = new BattleSession();
        s.unit('genzo')!.down = true;
        s.unit('genzo')!.hp = 0;
        s.retreat();
        expect(s.result()!.retainersDown).toEqual({ genzo: true, shinpachi: false });
    });

    it('新しい模擬戦は全員全快から始まる（再挑戦）', () => {
        const s = new BattleSession();
        s.hero.hp = 1;
        run(s, 20);
        expect(s.state.outcome).toBe('defeat');
        const again = new BattleSession(createBattle());
        expect(again.hero.hp).toBe(STATS.hero.maxHp);
        expect(again.state.outcome).toBeNull();
        expect(again.state.units.every((u) => !u.down)).toBe(true);
    });

    it('同じ入力なら同じ結果になる（乱数を使わない）', () => {
        const a = new BattleSession();
        const b = new BattleSession();
        run(a, 10, autoHero);
        run(b, 10, autoHero);
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    });
});
