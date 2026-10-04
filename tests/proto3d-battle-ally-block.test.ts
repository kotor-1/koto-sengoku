/**
 * 味方同士の詰まりと、閉じた門の先への移動（第4群の設計 §1・§2。docs/fields-group4-request.md【1】【2】。共通の機能で、戦場の id では分けない）：
 * - 味方同士の詰まり（sim.ts の trackSqueeze・allyOnlyBlock・tryAllyDetour。第3群の直し FieldRules.refinedMoves の戦場）：
 *   行き先へ進めない原因が「止まっている味方だけ」のとき、短い通れる迂回（今の道の RULES.allyDetourRatio 倍以内）を先に使い、
 *   味方だけに塞がれた状態が RULES.allyBlockSec（2 秒。1 か所の定義）続いたら、その味方の中をすり抜ける。
 *   前の決まり（待機の味方に 12 秒塞がれてから＝squeezeHoldSec、止まっている味方に 20 秒塞がれてから＝squeezeStallSec）は置き換えた。
 *   壁・閉じた門・深い川・崖・敵部隊・斬り合いの順番待ちでは使わない。防衛・待機を命じた味方は動かさない。狭い正面の同時に斬りかかれる数は保つ。
 * - 物理的に道が無い行き先（味方が退いても通れない）への移動は、すり抜けさせず、受けずに理由を出す（sim.ts の moveBlockReason・control.ts の refusalText）。
 * - 閉じた門の先への移動は「開門待ち」（Order の awaitGate）：門のこちら側の前で待ち、開いたら道を引き直して行き先へ。新しい命令で捨てる。
 *   敵への攻撃の可否（meleeUnreachable）・射線とは別。
 *
 * 確かめの種類はテストの名前に書く：「状態を直接操作」（部隊の位置・状態を書き換えてから進める）、「早送り」（stepBattle で進める）。
 *
 * 村落の再現（docs/fields-group3-verification.md の「失敗と原因」1。e2e/fields-group3.mjs の「10 秒以上動かない部隊なし」の NG）の前後：
 * - 直す前（f40f775。squeezeHoldSec 12 秒）：石川隊が 58.1 秒に (-56.3,29.7) で、西の通りの口で待機する酒井隊の 18 m 手前に止まり、
 *   12.1 秒後の 70.2 秒にすり抜けを始め、80 秒に (-68.2,0.6)。止まっていた最長 12.5 秒（e2e の見張りは 10 秒で NG）。
 * - 直した後（allyBlockSec 2 秒）：下の「村落の再現」のテストの記録（止まっていた最長・辻へ着いた時刻）。
 *
 * すれ違いの詰まり（第4群のエンジンの要望。反対向きに動く味方どうしにも allyBlockSec の調整を効かせた）の、戦場のテストへの影響（早送り。
 * 第3群・第4群の 12 のテストのファイルの runToEnd 1858 回を、直しの前後で結果・終わった時刻・損害の割合で比べた。既存の 10 戦場・V11 は
 * refinedMoves を付けないので 1 刻みも同じ）：変わったのは 148 回（夜襲の「準備した正面攻撃」の台本の 16 通りと、先駆けの比べの 64 回が大半）。
 * - 夜襲・奇襲の準備した正面攻撃：1 通り 329 秒・29.9％ → 322 秒・29.6％。16 通り 311 秒・24.2％・損害 3 割 14／16 → 308 秒・22.8％・15／16（16 勝のまま）。
 * - 寺社周辺の準備した正面攻撃の 16 通りの 1 通り：399.8 秒・25.1％ → 399.5 秒・25.0％。城下町外縁の 3 通り：損害 ±0.1％・時刻 ±0.5 秒。
 * - 村落の通りの口で受ける台本の 16 通りのうち 1 通り：420 秒で勝ち・35.6％ → 420 秒で勝ち・46.4％（同じ 1 通りを使う比べのテストでは 37.7％ → 53.6％）。
 * - 湖・河岸・包囲された陣・援軍救出・退却戦・湿地・城攻め前面のテストの台本は 1 刻みも同じ。勝ち数・比べのテストはどれも通る
 *   （夜襲の先駆けの損害の比べだけ、理由を書いて直した。tests/proto3d-field-night_raid.test.ts）。
 */
import { describe, expect, it } from 'vitest';
import { RULES, awaitingGate, createBattle, issueOrder, orderLabel, stepBattle, unitById, waitReason, type BattleState } from '../proto3d/src/battle/sim';
import { orderAck, refusalText } from '../proto3d/src/battle/control';
import { buildBattleSetup, FIELDS, getField } from '../proto3d/src/battle/fields';
import type { BattleSetup, FieldRules, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function field(terrain: TerrainArea[], units: UnitDef[], rules: FieldRules = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 300, depth: 300, terrain, exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } },
        units,
        timeLimitSec: 900,
        briefing: [],
        fieldRules: { pathfinding: true, settleMoves: true, refinedMoves: true, ...rules },
    };
}
function U(id: string, side: Side, kind: UnitKind, x: number, z: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing: side === 'ally' ? 0 : Math.PI, ...extra };
}
const HQS = (): UnitDef[] => [U('a_hq', 'ally', 'honjin', -140, 140), U('e_hq', 'enemy', 'honjin', 140, -140, { aiRole: 'guard_hq' })];
const wall = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'wall', rect: { x0, x1, z0, z1 }, height: 6 });

/** 刻みごとに見る：移動・攻撃の命令のまま、斬り合い・射撃なしで 1.5 m も動かない時間の最長（e2e/fields-group3.mjs の見張りと同じ数え方。行き先まで 8 m 以内は除く） */
function stillWatch(s: BattleState, id: string) {
    let anchor: { x: number; z: number; t: number } | null = null;
    let longest = 0;
    let at: { t: number; x: number; z: number } | null = null;
    return {
        step() {
            const u = unitById(s, id)!;
            const o = u.order;
            const goal = o.type === 'move' ? o : o.type === 'attack' ? unitById(s, o.targetId) : null;
            if (!goal || u.status !== 'ready' || u.engagedWith || u.shootingAt || Math.hypot(u.x - goal.x, u.z - goal.z) <= 8) {
                anchor = null;
                return;
            }
            if (!anchor || Math.hypot(u.x - anchor.x, u.z - anchor.z) > 1.5) {
                anchor = { x: u.x, z: u.z, t: s.t };
                return;
            }
            if (s.t - anchor.t > longest) {
                longest = s.t - anchor.t;
                at = { t: anchor.t, x: anchor.x, z: anchor.z };
            }
        },
        get longest() {
            return longest;
        },
        get at() {
            return at;
        },
    };
}

describe('1 か所の定義', () => {
    it('状態を直接見る：味方同士の詰まりの決まりは道探しの格子のある戦場で働く。refinedMoves の戦場（第3群・第4群の 10 戦場）はどれも格子を持つ（漏れが無い）。既存の 10 戦場は refinedMoves を持たない', () => {
        const refined = FIELDS.filter((f) => f.id !== 'border_field').map((f) => createBattle(buildBattleSetup(f, f.presets[0]!.id))).filter((s) => s.field.refined);
        expect(refined.map((s) => s.setup.map.id).sort()).toEqual(['besieged_camp', 'marsh', 'night_raid', 'rearguard', 'relief', 'shore', 'siege_front', 'temple', 'town_edge', 'village']);
        for (const s of refined) expect([s.setup.map.id, !!s.field.nav]).toEqual([s.setup.map.id, true]);
    });

    it('状態を直接見る：味方だけに塞がれてからすり抜けるまでは RULES.allyBlockSec（既定 2 秒）。前の 12 秒・20 秒の決まりは無い。迂回の長さの上限は allyDetourRatio', () => {
        expect(RULES.allyBlockSec).toBe(2);
        expect(RULES.allyDetourRatio).toBe(1.5);
        expect('squeezeHoldSec' in RULES).toBe(false);
        expect('squeezeStallSec' in RULES).toBe(false);
    });
});

describe('村落の再現：西の辻に二隊（早送り）', () => {
    // docs/fields-group3-verification.md の「失敗と原因」1 と同じ命令（e2e/fields-group3.mjs の村落・post の台本）
    const STEPS: [number, string, number, number][] = [
        [4, 'a_tadakatsu', 0, 30],
        [6, 'a_sakai', -48, 40],
        [8, 'a_kiba', 48, 40],
        [10, 'a_ishikawa', 18, 52],
        [12, 'a_yumi', -18, 55],
        [14, 'a_sakakibara', 30, 80],
        [16, 'a_ieyasu', 0, 125],
        [25, 'a_ishikawa', -72, -28],
        [27, 'a_sakai', -72, 20],
    ];
    function run(until: number) {
        const s = createBattle(buildBattleSetup(getField('village')!, 'standard'));
        const w = stillWatch(s, 'a_ishikawa');
        let i = 0;
        let arriveT: number | null = null;
        let squeezeT: number | null = null;
        let sakaiMoved = 0;
        let sakai0: { x: number; z: number } | null = null;
        while (s.t < until - 1e-9) {
            while (i < STEPS.length && s.t >= STEPS[i]![0] - 1e-9) {
                const [, id, x, z] = STEPS[i++]!;
                issueOrder(s, id, { type: 'move', x, z });
            }
            stepBattle(s, RULES.tick);
            w.step();
            const k = unitById(s, 'a_ishikawa')!;
            const sk = unitById(s, 'a_sakai')!;
            if (squeezeT === null && k.squeeze?.on) squeezeT = s.t;
            if (arriveT === null && Math.hypot(k.x + 72, k.z + 28) < 6) arriveT = s.t;
            // 酒井隊が西の通りの口で待機に着いてからの動き（すり抜けられた側は動かない）
            if (sk.order.type === 'hold' && Math.hypot(sk.x + 72, sk.z - 20) < 4) {
                if (!sakai0) sakai0 = { x: sk.x, z: sk.z };
                sakaiMoved = Math.max(sakaiMoved, Math.hypot(sk.x - sakai0.x, sk.z - sakai0.z));
            }
        }
        return { s, longest: w.longest, at: w.at, arriveT, squeezeT, sakaiMoved };
    }

    it('石川隊は酒井隊の手前で長く止まらず（止まっていた最長が allyBlockSec ＋ 2 秒未満。直す前 12.5 秒）、西の辻へ着く。酒井隊は動かない。「道を塞がれて」の待機にならない', () => {
        const r = run(100);
        const k = unitById(r.s, 'a_ishikawa')!;
        const sk = unitById(r.s, 'a_sakai')!;
        // 記録（直した後）：止まっていた最長・その始まり・すり抜けを始めた時刻・辻へ着いた時刻
        console.info(`村落の再現：止まっていた最長 ${r.longest.toFixed(1)} 秒（${r.at ? `${r.at.t.toFixed(1)} 秒から (${r.at.x.toFixed(1)},${r.at.z.toFixed(1)})` : '―'}）・すり抜け ${r.squeezeT?.toFixed(1)} 秒・辻 ${r.arriveT?.toFixed(1)} 秒`);
        expect(r.longest).toBeLessThan(RULES.allyBlockSec + 2);
        expect(r.longest).toBeLessThan(10);
        expect(r.arriveT).not.toBeNull();
        expect(r.arriveT!).toBeLessThan(80);
        expect(Math.hypot(k.x + 72, k.z + 28)).toBeLessThan(6);
        expect(r.s.events.some((e) => e.unitId === 'a_ishikawa' && e.text.includes('道を塞がれて'))).toBe(false);
        expect(Math.hypot(sk.x + 72, sk.z - 20)).toBeLessThan(4);
        expect(r.sakaiMoved).toBeLessThan(1);
        expect(sk.order.type).toBe('hold');
    });
});

/**
 * 幅 40 m の口（x -20〜20）のある東西の石垣（z -10〜0）。口を待機の槍 2 隊（x -9・9）が埋める。北 (5,45) の騎馬が南 (5,-120) へ向かう。
 * east：もう 1 つの口（x 30〜50）がある（その口を回る道は、口の真ん中を通る道の 1.5 倍以内。1.2 倍ほど）。
 */
function gapScene(east: boolean, extra: UnitDef[] = []): BattleState {
    const terrain = east ? [wall(-150, -20, -10, 0), wall(20, 30, -10, 0), wall(50, 150, -10, 0)] : [wall(-150, -20, -10, 0), wall(20, 150, -10, 0)];
    const s = createBattle(field(terrain, [...HQS(), U('a_f1', 'ally', 'yari', -9, -5), U('a_f2', 'ally', 'yari', 9, -5), U('a_m', 'ally', 'kiba', 5, 45), ...extra]));
    for (const u of s.units) u.initiative = null;
    return s;
}
function runGap(s: BattleState, sec: number, order: Parameters<typeof issueOrder>[2] = { type: 'move', x: 5, z: -120 }) {
    expect(issueOrder(s, 'a_m', order)).toBe(true);
    const m = unitById(s, 'a_m')!;
    const f = ['a_f1', 'a_f2'].map((id) => unitById(s, id)!);
    const f0 = f.map((u) => ({ x: u.x, z: u.z }));
    const w = stillWatch(s, 'a_m');
    let detour = false;
    let squeezed = false;
    let southT: number | null = null;
    let friendMoved = 0;
    while (s.t < sec - 1e-9) {
        stepBattle(s, RULES.tick);
        w.step();
        if (m.path?.detour) detour = true;
        if (m.squeeze?.on) squeezed = true;
        if (southT === null && m.z < -20) southT = s.t;
        f.forEach((u, i) => (friendMoved = Math.max(friendMoved, Math.hypot(u.x - f0[i]!.x, u.z - f0[i]!.z))));
    }
    return { m, detour, squeezed, southT, friendMoved, longest: w.longest, f };
}

describe('短い迂回を先に使い、無ければ 2 秒ですり抜ける（状態を直接操作・早送り）', () => {
    it('もう 1 つの口を回る短い迂回があれば、その道を使う（味方の中をすり抜けない）。待機の味方は動かない', () => {
        const r = runGap(gapScene(true), 70);
        expect(r.detour).toBe(true);
        expect(r.squeezed).toBe(false);
        expect(r.southT).not.toBeNull();
        expect(r.m.z).toBeLessThan(-110);
        expect(r.friendMoved).toBeLessThan(0.5);
        expect(r.f.every((u) => u.order.type === 'hold')).toBe(true);
    });

    it('迂回が無ければ、味方だけに塞がれて allyBlockSec 秒ほどで、待機の味方の中をすり抜けて口を抜ける（止まっていた最長は allyBlockSec ＋ 1 秒未満）。待機の味方は動かない', () => {
        const r = runGap(gapScene(false), 70);
        expect(r.squeezed).toBe(true);
        expect(r.longest).toBeLessThan(RULES.allyBlockSec + 1);
        expect(r.m.z).toBeLessThan(-110);
        expect(r.friendMoved).toBeLessThan(0.5);
        expect(r.f.every((u) => u.order.type === 'hold')).toBe(true);
    });

    it('攻撃の命令でも同じ（口の南の敵へ。敵は口から 60 m 以上離れた所）', () => {
        const s = gapScene(false, [U('e_t', 'enemy', 'yari', 5, -90, { aiRole: 'guard_hq' })]);
        for (const u of s.units) if (u.side === 'enemy') u.seenBy.ally = true;
        const r = runGap(s, 40, { type: 'attack', targetId: 'e_t' });
        expect(r.squeezed).toBe(true);
        expect(r.m.z).toBeLessThan(-20);
        expect(r.friendMoved).toBeLessThan(0.5);
    });

    it('近く（36 m）に戦える敵がいる（敵部隊にも塞がれている）ときは、すり抜けない', () => {
        // 石垣の南のすぐ先に敵の槍（射線は石垣で切れる。押し離しや斬り合いでは動かないよう、遠くの本陣を守る役）
        const s = gapScene(false, [U('e_block', 'enemy', 'yari', 30, -28, { aiRole: 'guard_hq' })]);
        const r = runGap(s, 40);
        expect(r.squeezed).toBe(false);
        expect(r.friendMoved).toBeLessThan(0.5);
    });
});

/**
 * すれ違いの詰まり（第4群の要望。湖・河岸の担当の報告）：反対向きに動く味方二隊は、互いに押し戻されて squeezeMove m 以上動くので、
 * 止まっている味方の決まり（stall）では数えられず、崖の南の端で約 20 秒もつれていた。行き先までの残りの道のりを縮められない時間で数え、
 * 行く手に反対向き（行き先どうしも反対の側）に動く味方だけがいれば、allyBlockSec ですり抜ける（sim.ts の headOnAlly）。
 * 刻みごとに見る：互いに 30 m 以内で、どちらかが行き先へ 1 m も近づけない時間の最長
 */
function crossWatch(s: BattleState, a: string, b: string) {
    const prog: Record<string, { best: number; t: number }> = {};
    let longest = 0;
    let squeezed = false;
    return {
        step() {
            const ua = unitById(s, a)!;
            const ub = unitById(s, b)!;
            squeezed ||= !!ua.squeeze?.on || !!ub.squeeze?.on;
            for (const u of [ua, ub]) {
                const o = u.order;
                if (o.type !== 'move') continue;
                const d = Math.hypot(u.x - o.x, u.z - o.z);
                const p = (prog[u.id] ??= { best: d, t: s.t });
                if (d <= p.best - 1) {
                    p.best = d;
                    p.t = s.t;
                } else if (Math.hypot(ua.x - ub.x, ua.z - ub.z) < 30) longest = Math.max(longest, s.t - p.t);
                else p.t = s.t;
            }
        },
        get longest() {
            return longest;
        },
        get squeezed() {
            return squeezed;
        },
    };
}

describe('すれ違いの詰まり：反対向きに動く味方どうし（状態を直接操作・早送り）', () => {
    it('湖・河岸の再現（敵を外す）：崖の南の端で、南へ下る忠勝隊と北へ上る騎馬がもつれず、どちらも行き先へ着く（直す前は 20.3 秒もつれて 72.1 秒に着いた）', () => {
        const s = createBattle(buildBattleSetup(getField('shore')!, 'standard'));
        for (const u of s.units)
            if (u.side === 'enemy') {
                u.present = false;
                u.arrived = false;
                (u as { arriveAt: number }).arriveAt = 1e9;
            }
        expect(issueOrder(s, 'a_kiba', { type: 'move', x: 120, z: -60 })).toBe(true);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'move', x: 60, z: 130 })).toBe(true);
        const w = crossWatch(s, 'a_tadakatsu', 'a_kiba');
        const yumi = unitById(s, 'a_yumi')!;
        const y0 = { x: yumi.x, z: yumi.z };
        let done = -1;
        for (let k = 0; k < 1200 && done < 0; k++) {
            stepBattle(s, RULES.tick);
            w.step();
            if (unitById(s, 'a_tadakatsu')!.order.type === 'hold' && unitById(s, 'a_kiba')!.order.type === 'hold') done = s.t;
        }
        // 記録：もつれ 20.3 秒 → 2.5 秒。両方が着いたのは 72.1 秒 → 54.3 秒
        expect(w.squeezed).toBe(true);
        expect(w.longest).toBeLessThan(RULES.allyBlockSec + 1.5);
        expect(done).toBeGreaterThan(0);
        expect(done).toBeLessThan(60);
        // 口のそばで待機している弓隊は動かさない（すり抜ける側が通るだけ）
        expect(Math.hypot(yumi.x - y0.x, yumi.z - y0.z)).toBeLessThan(0.5);
    });

    it('幅 30 m の通り（両側は石垣）で向かい合って進む二隊は、長くもつれずにすれ違う。同じ向きに続いて進む二隊はすり抜けない', () => {
        const terrain = [wall(-150, -15, -60, 60), wall(15, 150, -60, 60)];
        const s = createBattle(field(terrain, [...HQS(), U('a_n', 'ally', 'yari', 0, 70), U('a_s', 'ally', 'yari', 0, -70)]));
        for (const u of s.units) u.initiative = null;
        expect(issueOrder(s, 'a_n', { type: 'move', x: 0, z: -110 })).toBe(true);
        expect(issueOrder(s, 'a_s', { type: 'move', x: 0, z: 110 })).toBe(true);
        const w = crossWatch(s, 'a_n', 'a_s');
        for (let k = 0; k < 900; k++) {
            stepBattle(s, RULES.tick);
            w.step();
        }
        expect(w.longest).toBeLessThan(RULES.allyBlockSec + 1.5);
        expect(unitById(s, 'a_n')!.z).toBeLessThan(-100);
        expect(unitById(s, 'a_s')!.z).toBeGreaterThan(100);
        // 同じ向き（行き先も同じ側）に続いて進む二隊：すれ違いではないので、すり抜けは始めない
        const t = createBattle(field(terrain, [...HQS(), U('a_1', 'ally', 'yari', 0, 70), U('a_2', 'ally', 'yari', 0, 92)]));
        for (const u of t.units) u.initiative = null;
        expect(issueOrder(t, 'a_1', { type: 'move', x: 0, z: -110 })).toBe(true);
        expect(issueOrder(t, 'a_2', { type: 'move', x: 0, z: -90 })).toBe(true);
        let on = false;
        for (let k = 0; k < 900; k++) {
            stepBattle(t, RULES.tick);
            on ||= t.units.some((u) => !!u.squeeze?.on);
        }
        expect(on).toBe(false);
    });

    it('近く（36 m）に戦える敵がいるときは、すれ違いでもすり抜けない', () => {
        const terrain = [wall(-150, -15, -60, 60), wall(15, 150, -60, 60)];
        const s = createBattle(field(terrain, [...HQS(), U('a_n', 'ally', 'yari', 0, 70), U('a_s', 'ally', 'yari', 0, -70), U('e_x', 'enemy', 'yari', 0, 0, { aiRole: 'guard_hq', strength: 5000 })]));
        for (const u of s.units) u.initiative = null;
        // 敵は通りの真ん中で動かない（押し離しでも動かないよう兵を多く）。味方は敵の手前で止まる
        expect(issueOrder(s, 'a_n', { type: 'move', x: 0, z: -110 })).toBe(true);
        expect(issueOrder(s, 'a_s', { type: 'move', x: 0, z: 110 })).toBe(true);
        let on = false;
        for (let k = 0; k < 300; k++) {
            stepBattle(s, RULES.tick);
            on ||= s.units.some((u) => u.side === 'ally' && !!u.squeeze?.on);
        }
        expect(on).toBe(false);
    });
});

describe('壁・川・崖・閉じた門では使わない。物理的に道が無い行き先は受けずに理由を出す（状態を直接操作）', () => {
    it('四方を石垣に囲まれた所への移動は受けない（理由「通じる道が無い」）。命令は前のまま。囲まれていない所へは受ける', () => {
        const ring = [wall(40, 100, 40, 50), wall(40, 100, 90, 100), wall(40, 50, 50, 90), wall(90, 100, 50, 90)];
        const s = createBattle(field(ring, [...HQS(), U('a_m', 'ally', 'yari', 0, 0)]));
        const u = unitById(s, 'a_m')!;
        const before = JSON.stringify(u.order);
        expect(issueOrder(s, 'a_m', { type: 'move', x: 70, z: 70 })).toBe(false);
        expect(JSON.stringify(u.order)).toBe(before);
        expect(refusalText(s, 'a_m', { type: 'move', x: 70, z: 70 })).toContain('通じる道が無い');
        expect(issueOrder(s, 'a_m', { type: 'move', x: 20, z: 70 })).toBe(true);
        // 物理的に道が無い所へ押し付けて、すり抜けで越えることは無い（壁しか無い所では味方のすり抜けを始めない）
        for (let k = 0; k < 200; k++) stepBattle(s, RULES.tick);
        expect(u.squeeze?.on ?? false).toBe(false);
    });

    it('第3群の直しの無い戦場（既存の 10 戦場の決まり）では今までどおり受ける（1 刻みも変えない）', () => {
        const ring = [wall(40, 100, 40, 50), wall(40, 100, 90, 100), wall(40, 50, 50, 90), wall(90, 100, 50, 90)];
        const s = createBattle(field(ring, [...HQS(), U('a_m', 'ally', 'yari', 0, 0)], { refinedMoves: false }));
        expect(issueOrder(s, 'a_m', { type: 'move', x: 70, z: 70 })).toBe(true);
    });
});

describe('狭い正面の同時に斬りかかれる数と順番待ちは変えない（状態を直接操作・早送り）', () => {
    it('幅 20 m の通りの出口の敵へ 3 隊で攻撃：狭い正面（1 部隊）の中で敵と斬り合う味方はいつも 1 隊まで。順番を待つ隊はすり抜けない', () => {
        const terrain = [wall(-150, -10, -60, 60), wall(10, 150, -60, 60)];
        const s = createBattle(
            field(terrain, [...HQS(), U('e_t', 'enemy', 'yari', 0, -75, { aiRole: 'guard_hq', strength: 900 }), U('a_1', 'ally', 'yari', 0, -30), U('a_2', 'ally', 'yari', 0, -5), U('a_3', 'ally', 'kiba', 0, 20)], {
                specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -30, x1: 30, z0: -100, z1: 60 } }, maxEngaged: 1 }],
            }),
        );
        for (const u of s.units) {
            u.initiative = null;
            if (u.side === 'enemy') u.seenBy.ally = true;
        }
        for (const id of ['a_1', 'a_2', 'a_3']) expect(issueOrder(s, id, { type: 'attack', targetId: 'e_t' })).toBe(true);
        let maxEngaged = 0;
        let squeezedWhileQueued = 0;
        const e = unitById(s, 'e_t')!;
        for (let k = 0; k < 400; k++) {
            stepBattle(s, RULES.tick);
            const eng = s.units.filter((u) => u.side === 'ally' && u.engagedWith === e.id);
            maxEngaged = Math.max(maxEngaged, eng.length);
            // 相手がもう味方と斬り合っている間に、すり抜けを始めた隊（順番待ちを抜かした）
            for (const u of s.units) if (u.side === 'ally' && u.squeeze?.on && eng.length > 0 && !eng.includes(u)) squeezedWhileQueued++;
        }
        expect(maxEngaged).toBe(1);
        expect(squeezedWhileQueued).toBe(0);
    });
});

describe('待っている理由（sim.ts の waitReason。e2e の止まりの見張りが同じ定義で順番待ちを分ける。状態を直接操作・早送り）', () => {
    it('狭い正面で斬り合いの順番を待つ隊は queue。味方だけに塞がれた隊は ally（すり抜けの前）。道の無い所の無い戦場でも攻撃の相手が斬り合っていれば queue', () => {
        const terrain = [wall(-150, -10, -60, 60), wall(10, 150, -60, 60)];
        const s = createBattle(
            field(terrain, [...HQS(), U('e_t', 'enemy', 'yari', 0, -75, { aiRole: 'guard_hq', strength: 900 }), U('a_1', 'ally', 'yari', 0, -30), U('a_2', 'ally', 'yari', 0, -5), U('a_3', 'ally', 'kiba', 0, 20)], {
                specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -30, x1: 30, z0: -100, z1: 60 } }, maxEngaged: 1 }],
            }),
        );
        for (const u of s.units) {
            u.initiative = null;
            if (u.side === 'enemy') u.seenBy.ally = true;
        }
        for (const id of ['a_1', 'a_2', 'a_3']) expect(issueOrder(s, id, { type: 'attack', targetId: 'e_t' })).toBe(true);
        const seen = new Set<string>();
        for (let k = 0; k < 300; k++) {
            stepBattle(s, RULES.tick);
            const eng = s.units.some((u) => u.side === 'ally' && u.engagedWith === 'e_t');
            for (const u of s.units) if (u.side === 'ally' && !u.isHq && eng && !u.engagedWith && !u.moving) seen.add(String(waitReason(s, u)));
        }
        // 斬り合いが始まった後に止まっている隊は、どれも順番待ち
        expect([...seen]).toEqual(['queue']);
        // 味方だけに塞がれた（口に待機の二隊。迂回なし）：すり抜けの前は ally
        const g = gapScene(false);
        expect(issueOrder(g, 'a_m', { type: 'move', x: 5, z: -120 })).toBe(true);
        let ally = false;
        for (let k = 0; k < 200 && !unitById(g, 'a_m')!.squeeze?.on; k++) {
            stepBattle(g, RULES.tick);
            ally ||= waitReason(g, unitById(g, 'a_m')!) === 'ally';
        }
        expect(ally).toBe(true);
        // 道探しの格子の無い戦場
        const open = createBattle({ ...field([], [...HQS(), U('e_t', 'enemy', 'yari', 0, -40, { aiRole: 'guard_hq' }), U('a_1', 'ally', 'yari', 0, -20), U('a_2', 'ally', 'yari', 0, 40)]), fieldRules: {} });
        for (const u of open.units) if (u.side === 'enemy') u.seenBy.ally = true;
        expect(open.field.nav).toBeFalsy();
        expect(issueOrder(open, 'a_2', { type: 'attack', targetId: 'e_t' })).toBe(true);
        unitById(open, 'a_1')!.engagedWith = 'e_t';
        expect(waitReason(open, unitById(open, 'a_2')!)).toBe('queue');
    });

    it('攻撃の相手が味方と斬り合っていて、その相手が近く（spacing × 2 m 以内）にいるだけの隊は queue（foe にしない）。ほかの戦える敵が近ければ foe', () => {
        // e2e/fields-group4.mjs（包囲された陣の EAST を 1 秒ごとの命令で）：1 部隊ずつの狭い正面の手前で、榊原隊と斬り合う東の守りを待つ騎馬隊が、
        // 相手まで 34 m（36 m 以内）なので「近くの敵」に分けられ、止まりの見張りが詰まりと数えた。動き（allyOnlyBlock・headOnAlly）は
        // どちらも「味方だけの塞ぎではない」なので変わらない。状態を直接操作（斬り合いの印を書く）
        const terrain = [wall(-150, -10, -60, 60), wall(10, 150, -60, 60)];
        const s = createBattle(
            field(terrain, [...HQS(), U('e_t', 'enemy', 'yari', 0, -75, { aiRole: 'guard_hq', strength: 900 }), U('a_1', 'ally', 'yari', 0, -60), U('a_3', 'ally', 'kiba', 0, -45)], {
                specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -30, x1: 30, z0: -100, z1: -70 } }, maxEngaged: 1 }],
            }),
        );
        for (const u of s.units) {
            u.initiative = null;
            if (u.side === 'enemy') u.seenBy.ally = true;
        }
        expect(issueOrder(s, 'a_3', { type: 'attack', targetId: 'e_t' })).toBe(true);
        const a3 = unitById(s, 'a_3')!;
        const t = unitById(s, 'e_t')!;
        unitById(s, 'a_1')!.engagedWith = 'e_t';
        t.engagedWith = 'a_1';
        expect(Math.hypot(a3.x - t.x, a3.z - t.z)).toBeLessThan(RULES.spacing * 2);
        expect(waitReason(s, a3)).toBe('queue');
        // 相手が誰とも斬り合っていなければ、近くの敵（foe）のまま
        unitById(s, 'a_1')!.engagedWith = null;
        t.engagedWith = null;
        expect(waitReason(s, a3)).toBe('foe');
        // 相手は斬り合っているが、ほかの戦える敵が近くにいる：foe のまま
        unitById(s, 'a_1')!.engagedWith = 'e_t';
        t.engagedWith = 'a_1';
        const hq = unitById(s, 'e_hq')!;
        hq.x = 0;
        hq.z = -30;
        expect(waitReason(s, a3)).toBe('foe');
    });
});

describe('閉じた門の先への移動は「開門待ち」（城攻め前面。状態を直接操作・早送り）', () => {
    /** 城攻め前面で、敵をすべて戦場の外へ出す（門の前の輪を味方が占められるように。直接操作） */
    function siege(): BattleState {
        const s = createBattle(buildBattleSetup(getField('siege_front')!, 'standard'));
        for (const u of s.units) {
            u.initiative = null;
            if (u.side === 'enemy' && !u.isHq) {
                u.status = 'withdrawn';
                u.present = false;
            }
        }
        return s;
    }
    const pass = (s: BattleState, sec: number, each?: () => void) => {
        const end = s.t + sec;
        while (s.t < end - 1e-9 && !s.result) {
            stepBattle(s, RULES.tick);
            each?.();
        }
    };

    it('曲輪の中への移動は受け、命令に行き先と「開門待ち」（awaitGate）を持つ。札・知らせに「開門待ち」と出る', () => {
        const s = siege();
        expect(issueOrder(s, 'a_sakakibara', { type: 'move', x: -20, z: -95 })).toBe(true);
        const u = unitById(s, 'a_sakakibara')!;
        expect(u.order).toMatchObject({ type: 'move', x: -20, z: -95, awaitGate: 'outer_gate' });
        expect(awaitingGate(s, u)?.def.id).toBe('outer_gate');
        expect(orderLabel(s, u)).toContain('開門待ち：外門');
        expect(orderAck(s, u.id, { type: 'move', x: -20, z: -95 })).toContain('開門待ち');
        // 門の外の行き先は今までどおり（開門待ちを付けない）
        expect(issueOrder(s, 'a_ishikawa', { type: 'move', x: 40, z: 20 })).toBe(true);
        expect(unitById(s, 'a_ishikawa')!.order).toEqual({ type: 'move', x: 40, z: 20 });
    });

    it('門の前で待ち（着いたことにして待機にしない・すり抜けない・石垣を越えない）、門の前の輪を占めて門が開いたら、道を引き直して曲輪の中の行き先へ着く', () => {
        const s = siege();
        expect(issueOrder(s, 'a_sakakibara', { type: 'move', x: -20, z: -95 })).toBe(true);
        const u = unitById(s, 'a_sakakibara')!;
        const g = s.field.gates[0]!;
        let over = false;
        let squeezed = false;
        let settled = false;
        pass(s, 200, () => {
            if (!g.open && u.z < -57) over = true;
            if (!g.open && u.squeeze?.on) squeezed = true;
            if (!g.open && u.order.type !== 'move') settled = true;
        });
        expect(g.open).toBe(true);
        expect(over).toBe(false);
        expect(squeezed).toBe(false);
        expect(settled).toBe(false);
        // 門が開いた後：開門待ちを外し、行き先へ着いて待機
        expect(u.order.type).toBe('hold');
        expect(Math.hypot(u.x + 20, u.z + 95)).toBeLessThan(6);
    });

    it('門が閉じている間に新しい命令を出すと、古い開門待ちは捨てる（門の外への移動・防衛・待機）', () => {
        const s = siege();
        const u = unitById(s, 'a_tadakatsu')!;
        expect(issueOrder(s, 'a_tadakatsu', { type: 'move', x: 10, z: -110 })).toBe(true);
        expect(awaitingGate(s, u)).not.toBeNull();
        pass(s, 5);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'move', x: 60, z: 60 })).toBe(true);
        expect(u.order).toEqual({ type: 'move', x: 60, z: 60 });
        expect(awaitingGate(s, u)).toBeNull();
        expect(orderLabel(s, u)).toBe('移動');
        expect(issueOrder(s, 'a_tadakatsu', { type: 'move', x: 10, z: -110 })).toBe(true);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'hold' })).toBe(true);
        expect(u.order).toEqual({ type: 'hold' });
        pass(s, 10);
        expect(u.order.type).toBe('hold');
    });

    it('敵への攻撃の可否・射線とは別：門の向こうの敵への槍の攻撃は今までどおり断る（道が無い）。弓の攻撃・開門待ちの移動は受ける', () => {
        const s = createBattle(buildBattleSetup(getField('siege_front')!, 'standard'));
        for (const u of s.units) if (u.side === 'enemy') u.seenBy.ally = true;
        expect(issueOrder(s, 'a_ishikawa', { type: 'attack', targetId: 'e_gate_guard' })).toBe(false);
        expect(refusalText(s, 'a_ishikawa', { type: 'attack', targetId: 'e_gate_guard' })).toContain('道が無く');
        expect(issueOrder(s, 'a_yumi', { type: 'attack', targetId: 'e_tower_w' })).toBe(true);
        expect(issueOrder(s, 'a_ishikawa', { type: 'move', x: 0, z: -110 })).toBe(true);
        expect(unitById(s, 'a_ishikawa')!.order).toMatchObject({ awaitGate: 'outer_gate' });
    });

    it('門が直列に 2 つ（外門の先の内門の向こう）：移動を受けて手前の門の開門待ちにし、開いたら次の門の開門待ち、両方開いたら行き先へ（早送り）', () => {
        // 南の野（味方）｜石垣と門 g1（z -5〜5）｜中の曲輪｜石垣と門 g2（z -65〜-55）｜奥の曲輪。門は味方が前の輪を 3 秒占めると開く（敵はいない）
        const W = (z0: number, z1: number): TerrainArea[] => [wall(-150, -10, z0, z1), wall(10, 150, z0, z1)];
        const setup = field([...W(-5, 5), ...W(-65, -55)], [...HQS(), U('a_yari', 'ally', 'yari', 0, 60)], {
            gates: [
                { id: 'g1', name: '一の門', rect: { x0: -10, x1: 10, z0: -5, z1: 5 }, capture: { zone: { circle: { cx: 0, cz: 13, r: 10 } }, sec: 3 } },
                { id: 'g2', name: '二の門', rect: { x0: -10, x1: 10, z0: -65, z1: -55 }, capture: { zone: { circle: { cx: 0, cz: -47, r: 10 } }, sec: 3 } },
            ],
        });
        setup.units.find((u) => u.id === 'e_hq')!.x = 140;
        const s = createBattle(setup);
        expect(issueOrder(s, 'a_yari', { type: 'move', x: 0, z: -110 })).toBe(true);
        const u = unitById(s, 'a_yari')!;
        expect(u.order).toMatchObject({ type: 'move', x: 0, z: -110, awaitGate: 'g1' });
        const [g1, g2] = s.field.gates;
        let awaitG2 = false;
        let over = false;
        for (let i = 0; i < Math.round(120 / RULES.tick) && !s.result; i++) {
            stepBattle(s, RULES.tick);
            if (g1!.open && !g2!.open && u.order.type === 'move' && u.order.awaitGate === 'g2') awaitG2 = true;
            if (!g2!.open && u.z < -56) over = true;
            if (u.order.type === 'hold') break;
        }
        expect(g1!.open && g2!.open).toBe(true);
        expect(awaitG2).toBe(true);
        expect(over).toBe(false);
        expect(Math.hypot(u.x, u.z + 110)).toBeLessThan(6);
    });

    it('敵の部隊の命令には開門待ちを付けない（敵の考えの動きは今までどおり）', () => {
        const s = createBattle(buildBattleSetup(getField('siege_front')!, 'standard'));
        expect(issueOrder(s, 'e_sortie', { type: 'move', x: 0, z: -110 })).toBe(true);
        expect(unitById(s, 'e_sortie')!.order).toEqual({ type: 'move', x: 0, z: -110 });
    });
});
