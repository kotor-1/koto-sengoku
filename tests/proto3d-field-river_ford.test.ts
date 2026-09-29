/**
 * 戦場「河川・浅瀬」（river_ford）の釣り合い：地形に合わない作戦（放置・全部隊で中央の浅瀬へ・弓を使わずに渡る）は負ける・日没・損害が大きい、
 * 地形に合った作戦（弓で先に敵の弓を崩してから中央を渡る／西の浅瀬へ回る）は勝つ、副目標（損害を 3 割以内に）は作戦によって達成／未達成に分かれる。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。数字（兵の残り・時間）は river_ford.ts の釣り合いの目安。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const RF = getField('river_ford')!;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest'];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
/** 向こう岸の小高い地点（主目標の区域の中心） */
const HILL = mv(-70, -85);
/** 本陣以外の味方の部隊 */
const FIGHTERS = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi'];
/** 丘へ入る四隊（槍） */
const SPEARS = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];

function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = s.units.find((x) => x.id === id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const tid = u.order.targetId;
        const cur = s.units.find((x) => x.id === tid);
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

function play(steps: Step[]): Run {
    const s = createBattle(buildBattleSetup(RF, 'standard'));
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
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const secondaryOf = (r: Run) => r.o.objectives!.secondary.find((x) => x.id === 'ford_losses')!.achieved;

// ---------------------------------------------------------------- 台本

/**
 * 地形に合った作戦その 1（中央を弓で開ける）：弓は始めから敵の弓を狙って射る（90 秒ほどで崩れる）。忠勝隊は岸の弓の前へ出ておく。
 * 敵の弓が崩れると騎馬が浅瀬を渡って弓を狙いに来るので、忠勝隊で迎え撃つ（槍の正面・騎馬は浅瀬の中）。弓は次に先手を射て、
 * 榊原隊・酒井隊の二隊で先手へ当たり、石川隊は岸で控える。先手が崩れたら四隊で丘へ、弓は丘の弓を射る。命令は 12 回（0・120・150・220 秒）
 */
const FIT_CENTER: Step[] = [
    [0, 'a_yumi', atk('e_yumi')],
    [0, 'a_tadakatsu', mv(5, 10)],
    [120, 'a_tadakatsu', atk('e_kiba')],
    [120, 'a_yumi', atk('e_sente')],
    [150, 'a_sakakibara', atk('e_sente')],
    [150, 'a_sakai', atk('e_sente')],
    [150, 'a_ishikawa', mv(0, 10)],
    ...SPEARS.map((id) => [220, id, HILL] as Step),
    [220, 'a_yumi', atk('e_hill_yumi')],
];

/**
 * 地形に合った作戦その 2（西の浅瀬へ回る）：榊原隊・石川隊・忠勝隊の三隊で西の浅瀬の手前へ回り、見張りへ当たって破る。
 * 弓はその間ずっと敵の弓を射る（中央は酒井隊が構えるだけ）。見張りが崩れたら三隊で丘へ。命令は 10 回（0・60・150 秒）
 */
const FIT_WEST: Step[] = [
    [0, 'a_yumi', atk('e_yumi')],
    [0, 'a_sakakibara', mv(-145, 15)],
    [0, 'a_ishikawa', mv(-145, 15)],
    [0, 'a_tadakatsu', mv(-120, 15)],
    [60, 'a_sakakibara', atk('e_west')],
    [60, 'a_tadakatsu', atk('e_west')],
    [60, 'a_ishikawa', atk('e_west')],
    [150, 'a_sakakibara', HILL],
    [150, 'a_tadakatsu', HILL],
    [150, 'a_ishikawa', HILL],
];

describe('河川・浅瀬のデータ', () => {
    it('検査を通る。味方 6／敵 7（敵はすべて敵勢）。浅瀬の決まり（動き ×0.4・与える ×0.8・受ける ×1.2・矢 ×2.5）、特殊ルールなし、道探しあり', () => {
        expect(validateField(RF)).toEqual([]);
        const us = presetUnits(RF, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(7);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(RF.terrainRules).toEqual({ ford: { speed: 0.4, dealMul: 0.8, takeMul: 1.2, arrowTakeMul: 2.5 } });
        expect(RF.specialRules ?? []).toEqual([]);
        expect(RF.terrain.filter((t) => t.kind === 'ford')).toHaveLength(2);
        expect(createBattle(buildBattleSetup(RF, 'standard')).field.nav).not.toBeNull();
        // 武将の部隊には能力が付く（酒井・石川・榊原は武将のデータから）
        const s = createBattle(buildBattleSetup(RF, 'standard'));
        expect(Object.fromEntries(s.units.filter((u) => u.side === 'ally' && u.ability).map((u) => [u.id, u.ability]))).toEqual({
            a_ieyasu: 'ieyasu_rally',
            a_tadakatsu: 'tadakatsu_rearguard',
            a_sakakibara: 'sakakibara_vanguard',
            a_sakai: 'sakai_flank',
            a_ishikawa: 'ishikawa_reserve',
        });
    });

    it('敵の考え：先手は中央の浅瀬の出口のすぐ先で待ち、区域を追って出ない。弓は浅瀬の正面、騎馬は後詰め、見張り・丘の守りは区域を守る', () => {
        const us = presetUnits(RF, 'standard').filter((u) => u.side === 'enemy');
        const roles = Object.fromEntries(us.map((u) => [u.id, u.aiRole]));
        expect(roles).toEqual({ e_hq: 'guard_hq', e_sente: 'hold_zone', e_yumi: 'hold_line', e_hill: 'hold_zone', e_hill_yumi: 'hold_line', e_west: 'hold_zone', e_kiba: 'reserve' });
        const ford = RF.terrain.find((t) => t.kind === 'ford' && t.rect!.x0 === -18)!.rect!;
        const sente = us.find((u) => u.id === 'e_sente')!;
        const exit = RF.deployments.enemy.find((d) => d.id === 'ford_exit')!;
        // 先手へ斬りかかる間合い（25 m）の所は浅瀬の中：当たる側が浅瀬の中で戦う
        expect(ford.z0 - exit.z).toBeLessThan(25);
        // 守る区域（＋10 m）は浅瀬の出口の手前までで、浅瀬の中ほどへは出て来ない
        const zt = sente.aiTarget!;
        expect(zt.z + (zt.r ?? 60) + 10).toBeLessThan(ford.z0 + 5);
        // 敵の弓は中央の浅瀬を射られる所にいる
        const yumi = RF.deployments.enemy.find((d) => d.id === 'archers')!;
        expect(Math.hypot(yumi.x, yumi.z - (ford.z0 + ford.z1) / 2)).toBeLessThan(80);
    });
});

describe('河川・浅瀬：地形に合わない作戦（早送り）', () => {
    it('何もしない → 地点を取れず日没。待機の弓は近い先手を射て、敵の弓に射負けて崩れる', () => {
        const r = play([]);
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(statusOf(r, 'a_yumi')).toBe('routed');
        expect(r.left.e_yumi).toBe(200);
    });

    it('全部隊で向こう岸の地点へ真っすぐ向かう（中央の浅瀬を渡る）→ 浅瀬で矢と先手に崩されて負ける', () => {
        const r = play(FIGHTERS.map((id) => [0, id, HILL] as Step));
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.elapsedSec).toBeLessThan(200);
    });

    it('全部隊で先手へ攻めかかる → 先手は崩れても、浅瀬で大きく削られて丘まで届かず日没（損害 4 割を超える）', () => {
        const r = play(FIGHTERS.map((id) => [0, id, atk('e_sente')] as Step));
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('全部隊で先手へ攻めかかり、30 秒ごとに近い敵へ当て直す → 地点を取れず、損害が大きい', () => {
        const again = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step));
        const r = play([...FIGHTERS.map((id) => [0, id, atk('e_sente')] as Step), ...again]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('中央の作戦と同じ手順だが、弓に敵の弓を狙わせない（待機のまま）→ 渡る隊が矢を浴びて崩れ、日没', () => {
        const r = play(FIT_CENTER.filter(([, id]) => id !== 'a_yumi'));
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('中央の作戦を、敵の弓が崩れる前（2 分早く）に渡る → 負ける', () => {
        const early = FIT_CENTER.filter(([t, id]) => !(id === 'a_tadakatsu' && t === 120)).map(([t, id, o]) => [Math.max(0, t - 120), id, o] as Step);
        const r = play(early);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });
});

describe('河川・浅瀬：地形に合った作戦（早送り）', () => {
    it('弓で敵の弓を崩し、渡って来る騎馬を忠勝隊で迎え撃ち、二隊で先手を破って丘へ → 勝つ（副目標も達成）', () => {
        const r = play(FIT_CENTER);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.25);
        expect(r.o.elapsedSec).toBeLessThan(RF.timeLimitSec);
        // 騎馬は浅瀬を渡りかけたところで崩れる
        expect(statusOf(r, 'e_kiba')).not.toBe('ready');
        expect(r.left.a_yumi).toBeGreaterThan(300);
    });

    it('三隊で西の浅瀬へ回って見張りを破り、丘を取る（弓は敵の弓を射る）→ 勝つ（副目標も達成）', () => {
        const r = play(FIT_WEST);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.3);
        // 中央の先手とは斬り合わない（弓に射られて削れるだけ）
        expect(statusOf(r, 'e_sente')).toBe('ready');
        expect(statusOf(r, 'e_west')).toBe('routed');
    });

    it('どちらの作戦も、命令の時刻を ±15 秒ずらした 16 通りのうち 14 通り以上で勝つ（決まった乱数で作る。確かめた時は中央 15 勝・西 16 勝）', () => {
        for (const [base, min] of [
            [FIT_CENTER, 14],
            [FIT_WEST, 14],
        ] as const) {
            let seed = 7;
            const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
            let wins = 0;
            for (let k = 0; k < 16; k++) {
                const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
                if (play(steps).o.result === 'victory') wins++;
            }
            expect(wins).toBeGreaterThanOrEqual(min);
        }
    }, 60_000);

    it('固有能力を足しても勝つ（西へ回るとき榊原隊の先駆けの号、丘へ向かうとき石川隊の後詰めの差配）', () => {
        const r = play([...FIT_WEST, [60, 'a_sakakibara', 'ability'], [150, 'a_ishikawa', 'ability']]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ishikawa', 'a_sakakibara']);
    });
});

describe('河川・浅瀬：副目標（損害を 3 割以内に）は作戦で分かれる（早送り）', () => {
    it('中央：騎馬を忠勝隊で迎え撃つ → 達成／騎馬を放っておく → 弓隊が崩され、勝っても未達成', () => {
        const guard = play(FIT_CENTER);
        const loose = play(FIT_CENTER.filter(([t, id]) => !(id === 'a_tadakatsu' && t < 220)));
        expect(guard.o.result).toBe('victory');
        expect(loose.o.result).toBe('victory');
        expect(secondaryOf(guard)).toBe(true);
        expect(secondaryOf(loose)).toBe(false);
        expect(statusOf(loose, 'a_yumi')).toBe('routed');
        expect(loose.loss).toBeGreaterThan(0.35);
        // 勝敗・主目標・副目標は別の欄
        expect(loose.o.objectives!.primary!.achieved).toBe(true);
    });

    it('西：弓で敵の弓を射続ける → 達成／弓を放っておく → 勝っても未達成（損害 3 割を超える）', () => {
        const shoot = play(FIT_WEST);
        const idle = play(FIT_WEST.filter(([, id]) => id !== 'a_yumi'));
        expect(shoot.o.result).toBe('victory');
        expect(idle.o.result).toBe('victory');
        expect(secondaryOf(shoot)).toBe(true);
        expect(secondaryOf(idle)).toBe(false);
        expect(idle.loss).toBeGreaterThan(0.33);
    });
});
