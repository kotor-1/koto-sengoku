/**
 * 戦場「一本橋」（single_bridge）の釣り合い：地形に合わない作戦（放置・全部隊で橋へ押し込む・全部隊で橋の守りへ・向かい直しても）は
 * 負ける・日没・損害が大きい。地形に合った作戦（弓の陽動で橋の守りを南の岸へ引き出して囲み、橋を渡って来る後詰めも岸で迎え撃ち、
 * 西の浅瀬を渡って来る別働隊は騎馬で水の中で討ってから橋頭へ）は勝つ。副目標（損害を 3 割以内に・陽動の弓隊を半分以上残す）は作戦で分かれる。
 * 武将の能力の価値が地形で変わる比べ（榊原の先駆けの号：浅瀬と橋の上。忠勝の退路の守護：橋の上から退く隊）。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。移動の後の向き（face）は画面から指定できないので使わない。
 * 数字（兵の残り・時間）は single_bridge.ts の釣り合いの目安（作った時の値をコメントに残す）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const SB = getField('single_bridge')!;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest'];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
/** 向こう岸の橋頭（主目標の輪の中心） */
const HEAD = mv(0, -72);
/** 本陣以外の槍・騎馬 */
const MELEE = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'];

function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const cur = unitById(s, u.order.targetId);
        if (cur && isActive(cur)) return null;
    }
    const e = s.units
        .filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally)
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}

interface Run {
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(SB, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            if (ord === 'nearest') {
                const n = nearestEnemy(st, id);
                if (n && !issueOrder(st, id, n)) refused.push(`${t}:${id}`);
            } else if (ord === 'ability') {
                if (!useAbility(st, id).ok) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, ord)) refused.push(`${t}:${id}`);
        }
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数。tests/proto3d-field-river_ford.test.ts と同じ作り方）の勝ち数 */
function jitterWins(base: Step[]): { wins: number; lossOk: number; archersOk: number } {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let wins = 0;
    let lossOk = 0;
    let archersOk = 0;
    for (let k = 0; k < 16; k++) {
        const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
        const r = play(steps);
        if (r.o.result === 'victory') wins++;
        if (secondaryOf(r, 'bridge_losses')) lossOk++;
        if (secondaryOf(r, 'bridge_archers')) archersOk++;
    }
    return { wins, lossOk, archersOk };
}

// ---------------------------------------------------------------- 台本

/**
 * 陽動の前半（0〜100 秒）：弓を前へ出して橋の守りを射る（守りは 12 秒ほど矢を浴びると、橋を渡って弓へ打って出る）。
 * 騎馬二隊（榊原隊・徳川騎馬隊）は西の浅瀬の南の口へ回り、浅瀬を渡って来る別働隊を待ち受けて討つ（60 秒に攻撃を命じ直す）。
 * 石川隊は橋の南へ寄せておく。守りが南の岸へ上がった 50 秒に、忠勝隊・酒井隊・石川隊の三隊で囲む。
 * 守りが崩れると二の備え・騎馬（後詰め）も橋を渡って来るので、100 秒に三隊を近い敵へ当て直す。
 */
const LURE: Step[] = [
    [0, 'a_yumi', atk('e_guard')],
    [0, 'a_sakakibara', mv(-167, 10)],
    [0, 'a_kiba', mv(-155, 25)],
    [0, 'a_ishikawa', mv(-10, 45)],
    [50, 'a_tadakatsu', atk('e_guard')],
    [50, 'a_sakai', atk('e_guard')],
    [50, 'a_ishikawa', atk('e_guard')],
    [60, 'a_sakakibara', atk('e_west')],
    [60, 'a_kiba', atk('e_west')],
    [100, 'a_tadakatsu', 'nearest'],
    [100, 'a_sakai', 'nearest'],
    [100, 'a_ishikawa', 'nearest'],
];
/** 後半（150 秒）：三隊で橋を渡って橋頭へ、弓は東の弓を射る */
const CROSS: Step[] = [
    [150, 'a_tadakatsu', mv(0, -70)],
    [150, 'a_sakai', mv(15, -80)],
    [150, 'a_ishikawa', mv(-15, -80)],
    [150, 'a_yumi', atk('e_yumi_e')],
];

/** 地形に合った作戦その 1（陽動と浅瀬の守り）：前半の後、騎馬二隊も浅瀬の南の口から橋を渡って橋頭の西へ。命令は 20 回（0・50・60・100・150 秒） */
const FIT: Step[] = [...LURE, ...CROSS, [150, 'a_sakakibara', mv(-30, -70)], [150, 'a_kiba', mv(-20, -60)]];

/**
 * 地形に合った作戦その 2（浅瀬から回る）：前半の後、別働隊を討った騎馬二隊は 95 秒に浅瀬を北へ渡り（向こう岸の浅瀬の口へ）、
 * 150 秒に橋頭の西から入る（橋を通らない）。命令は 20 回
 */
const DETOUR: Step[] = [...LURE, [95, 'a_sakakibara', mv(-160, -65)], [95, 'a_kiba', mv(-150, -60)], [150, 'a_sakakibara', mv(-30, -75)], [150, 'a_kiba', mv(-25, -65)], ...CROSS];

/** 陽動だけ（浅瀬を放っておく）：騎馬は動かさず、三隊（忠勝・酒井・榊原）で守りを囲んでから、全部隊で橋を渡る */
const LURE_ONLY: Step[] = [
    [0, 'a_yumi', atk('e_guard')],
    [50, 'a_tadakatsu', atk('e_guard')],
    [50, 'a_sakai', atk('e_guard')],
    [50, 'a_sakakibara', atk('e_guard')],
    [150, 'a_tadakatsu', mv(0, -70)],
    [150, 'a_sakai', mv(15, -80)],
    [150, 'a_ishikawa', mv(-15, -80)],
    [150, 'a_sakakibara', mv(-30, -70)],
    [150, 'a_kiba', mv(-20, -60)],
    [150, 'a_yumi', atk('e_yumi_e')],
];

/** 正面突破：槍・騎馬の五隊で橋頭へ真っすぐ（弓は橋の守りを射る） */
const PUSH: Step[] = [...MELEE.map((id) => [0, id, HEAD] as Step), [0, 'a_yumi', atk('e_guard')]];

describe('一本橋のデータ', () => {
    it('検査を通る。味方 7／敵 7（敵はすべて敵勢）。橋 1 本・浅瀬 1 か所・狭い正面（1 部隊）・橋の矢 ×1.6。主目標は橋頭確保（敵本陣の撃破ではない）', () => {
        expect(validateField(SB)).toEqual([]);
        const us = presetUnits(SB, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(7);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(SB.terrain.filter((t) => t.kind === 'bridge')).toHaveLength(1);
        expect(SB.terrain.filter((t) => t.kind === 'ford')).toHaveLength(1);
        expect(SB.terrainRules).toEqual({ bridge: { arrowTakeMul: 1.6 } });
        expect(SB.specialRules).toEqual([{ type: 'narrow_frontage', zone: { rect: { x0: -12, x1: 12, z0: -48, z1: -2 } }, maxEngaged: 1 }]);
        expect(SB.objectives.primary).toMatchObject({ id: 'bridge_head', type: 'hold_point', sec: 60 });
        expect(SB.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['bridge_losses', 'limit_losses'],
            ['bridge_archers', 'preserve_unit'],
        ]);
        // 主目標・副目標は結果に別々に入る
        const s = createBattle(buildBattleSetup(SB, 'standard'));
        expect(s.objectives!.primary!.def.id).toBe('bridge_head');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual(['bridge_losses', 'bridge_archers']);
    });

    it('敵の考え：橋の守り・弓は持ち場を保つ（hold_line）、二の備え・騎馬は後詰め（reserve）、西の別働隊は回り込む（flank）。弓は主目標の輪の中', () => {
        const us = presetUnits(SB, 'standard').filter((u) => u.side === 'enemy');
        expect(Object.fromEntries(us.map((u) => [u.id, u.aiRole]))).toEqual({
            e_hq: 'guard_hq',
            e_guard: 'hold_line',
            e_yumi_w: 'hold_line',
            e_yumi_e: 'hold_line',
            e_second: 'reserve',
            e_kiba: 'reserve',
            e_west: 'flank',
        });
        const p = SB.objectives.primary;
        if (p.type !== 'hold_point') throw new Error('hold_point のはず');
        for (const id of ['archers_w', 'archers_e']) {
            const d = SB.deployments.enemy.find((x) => x.id === id)!;
            expect(inZone(p.zone, d.x, d.z)).toBe(true);
        }
        // 橋の守りは狭い正面の区域の外（北の口の先）に構える：橋を渡って来る相手は区域の中（北の口）で一隊ずつ迎えられる
        const g = SB.deployments.enemy.find((x) => x.id === 'bridgehead')!;
        const rule = SB.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        const zone = rule.zone;
        expect(inZone(zone, g.x, g.z)).toBe(false);
        expect(inZone(zone, 0, -44)).toBe(true);
        // こちらの弓は最初、橋の守りに届かない（前へ出さないと陽動にならない）。槍の隊は敵の弓の届く所にいない
        const yumi = SB.deployments.ally.find((x) => x.id === 'archers')!;
        expect(Math.hypot(yumi.x - g.x, yumi.z - g.z)).toBeGreaterThan(RULES.bowRange);
        const ey = SB.deployments.enemy.filter((x) => x.id.startsWith('archers_'));
        for (const a of SB.deployments.ally.filter((x) => x.id !== 'hq')) {
            for (const e of ey) expect(Math.hypot(a.x - e.x, a.z - e.z)).toBeGreaterThan(RULES.bowRange);
        }
    });
});

describe('一本橋：地形に合わない作戦（早送り）', () => {
    it('何もしない → 橋頭を取れず日没', () => {
        const r = play([]);
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });

    it('全部隊で橋頭へ押し込む（弓は橋の守りを射る）→ 橋の上で一隊ずつ当たり、北の口で迎えられ、両の弓に射られて日没（損害 4 割を超える。作った時 47％）', () => {
        const r = play(PUSH);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
        // 敵の弓はどちらも無傷のまま（橋の上の隊は射られるだけ）
        expect(r.left.e_yumi_w).toBe(260);
        expect(r.left.e_yumi_e).toBe(260);
    });

    it('弓も一緒に全部隊で橋頭へ → 負ける（作った時 146 秒）', () => {
        const r = play([...MELEE, 'a_yumi'].map((id) => [0, id, HEAD] as Step));
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.elapsedSec).toBeLessThan(240);
    });

    it('全部隊で橋の守りへ攻めかかる（弓も）→ 負ける。30 秒ごとに近い敵へ当て直しても負ける', () => {
        const all: Step[] = [...MELEE, 'a_yumi'].map((id) => [0, id, atk('e_guard')] as Step);
        const r = play(all);
        expect(r.o.result).toBe('defeat');
        const again = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].flatMap((t) => MELEE.map((id) => [t, id, 'nearest'] as Step));
        const r2 = play([...all, ...again]);
        expect(r2.o.result).not.toBe('victory');
        expect(r2.o.objectives!.primary!.achieved).toBe(false);
        expect(r2.loss).toBeGreaterThan(0.4);
    });

    it('60 秒ごとに橋頭へ向かい直す（崩れた隊の命令は断られる）→ 日没（損害 4 割を超える。作った時 46％）', () => {
        const re = [60, 120, 180, 240, 300].flatMap((t) => MELEE.map((id) => [t, id, HEAD] as Step));
        const r = play([...PUSH, ...re]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('陽動でも、槍を出すのが早すぎる（30 秒。守りがまだ橋の上・南の口）→ 狭い正面で一隊ずつになり負ける', () => {
        const r = play(FIT.map(([t, id, o]) => [t === 50 ? 30 : t, id, o] as Step));
        expect(r.o.result).not.toBe('victory');
        expect(secondaryOf(r, 'bridge_losses')).toBe(false);
    });
});

describe('一本橋：地形に合った作戦（早送り）', () => {
    it('陽動と浅瀬の守り：守りを南の岸へ引き出して囲み、渡って来る後詰めも迎え撃ち、別働隊は浅瀬の中で討ってから橋頭へ → 勝つ（副目標も両方。作った時 272 秒・損害 27％）', () => {
        let guardSouth = false;
        let reservesSouth = 0;
        const r = play(FIT, (s) => {
            const g = unitById(s, 'e_guard')!;
            if (g.status === 'ready' && g.z > 0) guardSouth = true;
            reservesSouth = Math.max(reservesSouth, ['e_second', 'e_kiba'].filter((id) => unitById(s, id)!.z > -5).length);
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r, 'bridge_losses')).toBe(true);
        expect(secondaryOf(r, 'bridge_archers')).toBe(true);
        expect(r.loss).toBeLessThan(0.3);
        // 陽動：守りは橋を渡って南の岸へ出て来た。後詰めの二隊も橋を渡って来た
        expect(guardSouth).toBe(true);
        expect(reservesSouth).toBe(2);
        for (const id of ['e_guard', 'e_second', 'e_kiba', 'e_west']) expect(statusOf(r, id)).not.toBe('ready');
    });

    it('浅瀬から回る：同じ陽動の後、騎馬二隊は浅瀬を北へ渡って橋頭の西から入る → 勝つ（作った時 268 秒・損害 26％）', () => {
        let northOfFord = false;
        const r = play(DETOUR, (s) => {
            const k = unitById(s, 'a_sakakibara')!;
            if (k.x < -130 && k.z < -45) northOfFord = true;
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.loss).toBeLessThan(0.3);
        expect(northOfFord).toBe(true);
    });

    // 確かめた時（乱数の種 7）：陽動と浅瀬の守り 16 勝（損害 3 割以内 9・弓を残す 14）、浅瀬から回る 14 勝。
    // 参考に種 1〜6 の 96 通りでも数えた：陽動と浅瀬の守り 83 勝、浅瀬から回る 80 勝、陽動だけ 49 勝（守りへ槍を出す 50 秒の命令が 35〜60 秒を外れると崩れやすい）
    it('命令の時刻を ±15 秒ずらした 16 通り：陽動と浅瀬の守りは 14 通り以上、浅瀬から回るのは 12 通り以上で勝つ（確かめた時 16 勝・14 勝）', () => {
        const fit = jitterWins(FIT);
        const det = jitterWins(DETOUR);
        expect(fit.wins).toBeGreaterThanOrEqual(14);
        expect(det.wins).toBeGreaterThanOrEqual(12);
        // 正面突破はずらしても勝たない（台本は時刻 0 だけなので、ずらすのは同じ。確かめとして日没か負け）
        expect(play(PUSH).o.result).not.toBe('victory');
    }, 120_000);
});

describe('一本橋：浅瀬を放っておく・副目標は作戦で分かれる（早送り）', () => {
    it('陽動だけで浅瀬を放っておく → 勝っても損害 3 割を超える（別働隊に横を突かれる）。±15 秒の 16 通りでは勝ちが少ない（確かめた時 6 勝）', () => {
        const r = play(LURE_ONLY);
        expect(r.o.result).toBe('victory');
        expect(secondaryOf(r, 'bridge_losses')).toBe(false);
        expect(r.loss).toBeGreaterThan(0.3);
        const fit = play(FIT);
        expect(fit.loss).toBeLessThan(r.loss - 0.03);
        expect(jitterWins(LURE_ONLY).wins).toBeLessThanOrEqual(10);
    }, 60_000);

    it('槍を出すのが遅い（70 秒）→ 守りに弓隊が崩され、陽動の弓隊を残せない（副目標）。勝ち負け・主目標・副目標は別の欄', () => {
        const late = play(FIT.map(([t, id, o]) => [t === 50 ? 70 : t, id, o] as Step));
        const fit = play(FIT);
        expect(secondaryOf(fit, 'bridge_archers')).toBe(true);
        expect(secondaryOf(late, 'bridge_archers')).toBe(false);
        expect(statusOf(late, 'a_yumi')).not.toBe('ready');
        expect(late.o.objectives!.primary!.achieved).toBe(late.o.result === 'victory');
    });
});

/** 能力の比べで見る数字：t0 から 20 秒（先駆けの号の効果の長さ）の、相手と榊原隊の兵の減り・効果の切れた 1 秒後の士気・40 秒後に戦えるか・相手の崩れた時刻 */
function vanguardProbe(steps: Step[], target: string, t0: number) {
    const at: Record<string, { tgt: number; saka: number; morale: number; ready: boolean }> = {};
    let broken = -1;
    const r = play(steps, (s) => {
        const tg = unitById(s, target)!;
        const k = unitById(s, 'a_sakakibara')!;
        if (broken < 0 && tg.status !== 'ready') broken = s.t;
        for (const [key, dt] of [['a', 0], ['b', 20], ['c', 21], ['d', 40]] as const) {
            if (!at[key] && s.t >= t0 + dt - 1e-9) at[key] = { tgt: tg.strength, saka: k.strength, morale: k.morale, ready: k.status === 'ready' };
        }
    });
    return { r, tgtLost: at.a!.tgt - at.b!.tgt, sakaLost: at.a!.saka - at.b!.saka, moraleAfter: at.c!.morale, readyLater: at.d!.ready, broken };
}

describe('一本橋：武将の能力の価値が地形で変わる（早送り）', () => {
    // 榊原の先駆けの号（動き ×1.8・最初の 8 秒の当たり ×2.0・受ける損害 ×1.2・切れて士気 −15）
    // 浅瀬：騎馬二隊で西の浅瀬の南の口に待ち、55 秒に浅瀬を渡って来る別働隊へ当たる（別働隊は水の中：与える ×0.8・受ける ×1.2）
    const FORD: Step[] = [
        [0, 'a_sakakibara', mv(-167, 10)],
        [0, 'a_kiba', mv(-155, 25)],
        [55, 'a_sakakibara', atk('e_west')],
        [55, 'a_kiba', atk('e_west')],
    ];
    // 橋：榊原隊だけで橋を渡って橋の守りへ（狭い正面の北の口・橋の矢 ×1.6）
    const BRIDGE: Step[] = [[0, 'a_sakakibara', atk('e_guard')]];

    it('榊原の先駆けの号：浅瀬で水の中の別働隊へ使う → 別働隊が早く崩れ、榊原隊は崩れない。橋の上で使う → 守りをほとんど削れず、榊原隊が崩れる', () => {
        const fordNo = vanguardProbe(FORD, 'e_west', 55);
        const fordUse = vanguardProbe([...FORD, [55, 'a_sakakibara', 'ability']], 'e_west', 55);
        const bridgeNo = vanguardProbe(BRIDGE, 'e_guard', 0);
        const bridgeUse = vanguardProbe([...BRIDGE, [0, 'a_sakakibara', 'ability']], 'e_guard', 0);
        for (const p of [fordUse, bridgeUse]) expect(p.r.refused).toEqual([]);
        // 浅瀬（作った時）：20 秒で別働隊の兵 99 → 150 を削り、崩れたのは 74.6 → 69.2 秒。榊原隊の減りは 24、効果の切れた後の士気 58 で戦える
        expect(fordUse.tgtLost).toBeGreaterThan(fordNo.tgtLost + 30);
        expect(fordUse.broken).toBeGreaterThan(0);
        expect(fordUse.broken).toBeLessThan(fordNo.broken - 3);
        expect(fordUse.sakaLost).toBeLessThan(50);
        expect(fordUse.moraleAfter).toBeGreaterThan(40);
        expect(fordUse.readyLater).toBe(true);
        // 橋（作った時）：20 秒で守りの兵 8 → 33 しか削れず、榊原隊は 78 → 192 を失い、効果の切れた後の士気 6 で崩れる
        expect(bridgeUse.tgtLost).toBeLessThan(60);
        expect(bridgeUse.sakaLost).toBeGreaterThan(bridgeNo.sakaLost + 60);
        expect(bridgeUse.readyLater).toBe(false);
        // 同じ能力で、削った相手の兵 ÷ 失った自分の兵：浅瀬は 1 を大きく超え、橋の上は 1 を大きく下回る
        expect(fordUse.tgtLost / fordUse.sakaLost).toBeGreaterThan(3);
        expect(bridgeUse.tgtLost / bridgeUse.sakaLost).toBeLessThan(0.5);
    });

    // 忠勝の退路の守護（範囲 100 m で退く味方の受ける損害 −80%・追っ手を忠勝隊へ引きつける。忠勝隊は動けない）
    // 酒井隊・石川隊が橋を渡って橋の守りへ当たり（北の口で一隊ずつ）、50 秒に退かせる。忠勝隊は橋の南の口の手前 (0,20) で待つ
    const PROBE: Step[] = [
        [0, 'a_sakai', atk('e_guard')],
        [0, 'a_ishikawa', atk('e_guard')],
        [0, 'a_tadakatsu', mv(0, 20)],
        [50, 'a_sakai', { type: 'retreat' }],
        [50, 'a_ishikawa', { type: 'retreat' }],
    ];
    function retreatLoss(steps: Step[]) {
        let lost = 0;
        const prev: Record<string, number> = {};
        const r = play(steps, (s) => {
            if (s.t < 50 - 1e-9 || s.t > 100 + 1e-9) return;
            for (const id of ['a_sakai', 'a_ishikawa']) {
                const u = unitById(s, id)!;
                if (prev[id] !== undefined) lost += prev[id]! - u.strength;
                prev[id] = u.strength;
            }
        });
        return { r, lost };
    }

    it('忠勝の退路の守護：橋の上で押し返された隊を退かせるとき、南の口の手前で使う → 退く隊の損害が大きく減り、酒井隊は崩れずに戦場を離れる', () => {
        const no = retreatLoss(PROBE);
        const use = retreatLoss([...PROBE, [50, 'a_tadakatsu', 'ability']]);
        expect(use.r.refused).toEqual([]);
        // 作った時：50〜100 秒の退く二隊の損害 56 → 18。酒井隊は 敗走（兵 147）→ 撤退して離れる（兵 161）
        expect(use.lost).toBeLessThan(no.lost * 0.5);
        expect(statusOf(no.r, 'a_sakai')).toBe('routed');
        expect(statusOf(use.r, 'a_sakai')).toBe('withdrawn');
        expect(Object.keys(use.r.o.abilitiesUsed ?? {})).toEqual(['a_tadakatsu']);
    });
});
