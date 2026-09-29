/**
 * 戦場「大平原」（plains）の釣り合い：地形に合わない作戦は負ける（または損害が大きい）、地形に合った作戦は勝つ、
 * 副目標（予備隊＝石川数正隊を崩さずに終える）は作戦によって達成／未達成に分かれる。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。数字（兵の残り・時間）は plains.ts の釣り合いの目安。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const PLAINS = getField('plains')!;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest'];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
/** 本陣以外の味方の部隊 */
const FIGHTERS = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba'];

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
    const s = createBattle(buildBattleSetup(PLAINS, 'standard'));
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

const secondaryOf = (r: Run) => r.o.objectives!.secondary.find((x) => x.id === 'plains_reserve')!.achieved;

// ---------------------------------------------------------------- 台本

/**
 * 地形に合った作戦：正面の槍（忠勝・酒井・榊原）は持ち場で待ち構え、弓は押し出してくる先手を射る。
 * 騎馬は西の外を大きく回り、酒井隊と組み合った左備の横を突く。林から出てきた敵の騎馬には予備隊（石川隊）を当て、
 * 正面が崩れたら本陣へ。最後に予備隊も本陣へ入れて決める。命令は 9 回（0・45・80・120・150 秒）
 */
const FIT: Step[] = [
    [0, 'a_yumi', atk('e_sente')],
    [0, 'a_kiba', mv(-160, -20)],
    [45, 'a_kiba', atk('e_left')],
    [80, 'a_ishikawa', atk('e_kiba')],
    [120, 'a_kiba', atk('e_hq')],
    [120, 'a_tadakatsu', atk('e_hq')],
    [120, 'a_sakai', atk('e_hq')],
    [150, 'a_ishikawa', atk('e_hq')],
];

/** FIT と同じだが、予備隊（石川隊）を始めから右翼へ出し、押し出してくる右備に当てる（全力で当てる） */
const RESERVE_EARLY: Step[] = [
    [0, 'a_yumi', atk('e_sente')],
    [0, 'a_kiba', mv(-160, -20)],
    [0, 'a_ishikawa', mv(100, 60)],
    [45, 'a_kiba', atk('e_left')],
    [45, 'a_ishikawa', atk('e_right')],
    [120, 'a_kiba', atk('e_hq')],
    [120, 'a_tadakatsu', atk('e_hq')],
    [120, 'a_sakai', atk('e_hq')],
];

describe('大平原のデータ', () => {
    it('検査を通る。味方 7／敵 7（敵はすべて敵勢）。特殊ルール・地形の上書きなし（ほかの戦場と比べる基準の野戦）', () => {
        expect(validateField(PLAINS)).toEqual([]);
        const us = presetUnits(PLAINS, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(7);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(PLAINS.specialRules ?? []).toEqual([]);
        expect(PLAINS.terrainRules).toBeUndefined();
        expect(PLAINS.passable).toBeUndefined();
        expect(createBattle(buildBattleSetup(PLAINS, 'standard')).field.nav).toBeNull();
    });

    it('敵の考え：先手・左備・右備はこちらの横一列へ押し出す（assault）、弓は後ろに残る、騎馬は東から回り込む（flank）、後詰め・本陣', () => {
        const roles = Object.fromEntries(presetUnits(PLAINS, 'standard').filter((u) => u.side === 'enemy').map((u) => [u.id, u.aiRole]));
        expect(roles).toEqual({ e_hq: 'guard_hq', e_sente: 'assault', e_left: 'assault', e_right: 'assault', e_yumi: 'hold_line', e_kiba: 'flank', e_reserve: 'reserve' });
        const east = PLAINS.deployments.enemy.find((d) => d.id === 'east')!;
        const woods = PLAINS.terrain.find((t) => t.kind === 'woods')!;
        // 騎馬は林の東西の幅の中から南へ下る（林の中を抜けるので、その間は見えない）
        expect(Math.abs(east.x - woods.circle!.cx)).toBeLessThan(woods.circle!.r);
    });
});

describe('大平原：地形に合わない作戦（早送り）', () => {
    it('何もしない → 右翼が林から出た騎馬に横を突かれ、やがて本陣が崩れて負ける', () => {
        const r = play([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.units.find((u) => u.id === 'a_sakakibara')!.status).toBe('routed');
    });

    it('全部隊で先手へ攻めかかる → 同じ敵の正面に重なって効かず、負ける', () => {
        const r = play(FIGHTERS.map((id) => [0, id, atk('e_sente')] as Step));
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(secondaryOf(r)).toBe(false);
    });

    it('横一列で正面の敵へそれぞれ攻めかかる（騎馬は左備へ真っすぐ・予備隊も先手へ）→ 負ける', () => {
        const r = play([
            [0, 'a_tadakatsu', atk('e_sente')],
            [0, 'a_sakai', atk('e_left')],
            [0, 'a_sakakibara', atk('e_right')],
            [0, 'a_yumi', atk('e_sente')],
            [0, 'a_kiba', atk('e_left')],
            [0, 'a_ishikawa', atk('e_sente')],
        ]);
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('正面へ攻めかかり、30 秒ごとに崩れた相手から近い敵へ当て直す → 負けるか、勝っても損害が大きい', () => {
        const again = [30, 60, 90, 120, 150, 180, 210, 240].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step));
        const r = play([
            [0, 'a_tadakatsu', atk('e_sente')],
            [0, 'a_sakai', atk('e_left')],
            [0, 'a_sakakibara', atk('e_right')],
            [0, 'a_yumi', atk('e_sente')],
            [0, 'a_kiba', atk('e_left')],
            [0, 'a_ishikawa', atk('e_sente')],
            ...again,
        ]);
        expect(r.o.result !== 'victory' || r.loss >= 0.45).toBe(true);
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('持ち場で待ち構えた後、騎馬で回らずに全部隊で本陣へ押す → 途中の後詰め・騎馬・弓に崩されて負ける', () => {
        const r = play([[0, 'a_yumi', atk('e_sente')], ...FIGHTERS.filter((id) => id !== 'a_yumi').map((id) => [100, id, atk('e_hq')] as Step)]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });

    it('騎馬を回すが、予備隊を使わない（林から出た騎馬を放っておく）→ 負ける', () => {
        const r = play(FIT.filter(([, id]) => id !== 'a_ishikawa'));
        expect(r.o.result).toBe('defeat');
        expect(r.left.a_ishikawa).toBe(350);
    });

    it('騎馬を使わない（待ち構え・予備隊・本陣への押しだけ）→ 左右の備えを崩しきれず、本陣を崩せない', () => {
        const r = play(FIT.filter(([, id]) => id !== 'a_kiba'));
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });

    it('騎馬を始めから左備へ真っすぐ当てる → 組み合う前の槍と正面からぶつかって崩れ、本陣を崩せない', () => {
        const r = play([[0, 'a_kiba', atk('e_left')], ...FIT.filter(([t, id]) => id !== 'a_kiba' || t >= 120)]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.units.find((u) => u.id === 'a_kiba')!.status).toBe('routed');
    });
});

describe('大平原：地形に合った作戦（早送り）', () => {
    it('正面の槍で待ち構え、騎馬は西から回って左備の横へ、林の騎馬に予備隊、最後に予備隊も本陣へ → 勝つ（副目標も達成）', () => {
        const r = play(FIT);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('enemy_hq_routed');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.5);
        expect(r.o.elapsedSec).toBeLessThan(PLAINS.timeLimitSec);
    });

    it('同じ作戦で、命令の時刻を ±15 秒ずらした 16 通りのうち 14 通り以上で勝つ（決まった乱数で作る。確かめた時は 15 勝 1 敗）', () => {
        let seed = 7;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        let wins = 0;
        for (let k = 0; k < 16; k++) {
            const steps = FIT.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
            if (play(steps).o.result === 'victory') wins++;
        }
        expect(wins).toBeGreaterThanOrEqual(14);
    }, 60_000);

    it('固有能力を足しても勝つ（左備を突くとき酒井隊の両翼の采配、本陣へ入れるとき石川隊の後詰めの差配）', () => {
        const r = play([...FIT, [50, 'a_sakai', 'ability'], [150, 'a_ishikawa', 'ability']]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ishikawa', 'a_sakai']);
    });

    it('持ち場で待ち構え、正面が崩れてから 30 秒ごとに近い敵へ当てていく（受けて返す）→ 勝つ', () => {
        const r = play([[0, 'a_yumi', atk('e_sente')], ...[90, 120, 150, 180, 210, 240].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step))]);
        expect(r.o.result).toBe('victory');
        expect(r.loss).toBeLessThan(0.45);
    });
});

describe('大平原：副目標（予備隊を崩さずに終える）は作戦で分かれる（早送り）', () => {
    it('予備隊を温存して後から入れる → 達成／始めから右翼へ全力で当てる → 勝っても未達成（林から出た騎馬に横を突かれる）', () => {
        const keep = play(FIT);
        const early = play(RESERVE_EARLY);
        expect(keep.o.result).toBe('victory');
        expect(early.o.result).toBe('victory');
        expect(secondaryOf(keep)).toBe(true);
        expect(secondaryOf(early)).toBe(false);
        expect(keep.left.a_ishikawa).toBeGreaterThanOrEqual(175);
        expect(early.o.units.find((u) => u.id === 'a_ishikawa')!.status).toBe('routed');
        // 勝敗・主目標・副目標は別の欄
        expect(early.o.objectives!.primary!.achieved).toBe(true);
    });
});
