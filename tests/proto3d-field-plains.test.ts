/**
 * 戦場「大平原」（plains）の釣り合い：地形に合った作戦は ±15 秒の 16 通りで安定して勝つ。無計画な攻撃（全部隊で先手へ・横一列で
 * 一斉に・当て直しだけ）は、地形に合った作戦・準備した正面攻撃と比べて主目標に届かない・損害が大きい・副目標を落とす（比べが合格条件。
 * 無計画な攻撃の勝敗は記録として書く）。準備した正面攻撃（弓で崩してから・予備を後から・能力を使う）の結果も記録して比べる。
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

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力（対象の要る能力は { abilityTarget: 対象の部隊 id }）、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest' | { abilityTarget: string }];

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
            } else if (typeof ord === 'object' && 'abilityTarget' in ord) {
                if (!useAbility(st, id, ord.abilityTarget).ok) refused.push(`${t}:${id}`);
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

/**
 * 準備した正面攻撃（回り込まない）：弓は始めから先手を射る。30 秒、先手が弓に削られながら近づいたところで、正面の槍三隊がそれぞれ
 * 向かいの敵（先手・左備・右備）へ当たる。60 秒に騎馬を左備へ正面から当て（回り込まない）、同時に酒井隊の両翼の采配。林から出た騎馬には
 * 予備隊（石川隊）を当て、90 秒に家康の号令、120 秒に三隊で本陣へ、150 秒に予備隊も本陣へ。
 * 横一列の攻めかかり（LINE）と同じ相手へ当たるが、弓で崩してから・予備を後から・能力を使って当たる。命令は 12 回（0・30・60・80・90・120・150 秒）
 */
const PREPARED: Step[] = [
    [0, 'a_yumi', atk('e_sente')],
    [30, 'a_tadakatsu', atk('e_sente')],
    [30, 'a_sakai', atk('e_left')],
    [30, 'a_sakakibara', atk('e_right')],
    [60, 'a_kiba', atk('e_left')],
    [60, 'a_sakai', 'ability'],
    [80, 'a_ishikawa', atk('e_kiba')],
    [90, 'a_ieyasu', 'ability'],
    [120, 'a_tadakatsu', atk('e_hq')],
    [120, 'a_sakai', atk('e_hq')],
    [120, 'a_kiba', atk('e_hq')],
    [150, 'a_ishikawa', atk('e_hq')],
];

/** 無計画な攻撃：横一列で正面の敵へそれぞれ、始めから攻めかかる（騎馬は左備へ真っすぐ・予備隊も先手へ） */
const LINE: Step[] = [
    [0, 'a_tadakatsu', atk('e_sente')],
    [0, 'a_sakai', atk('e_left')],
    [0, 'a_sakakibara', atk('e_right')],
    [0, 'a_yumi', atk('e_sente')],
    [0, 'a_kiba', atk('e_left')],
    [0, 'a_ishikawa', atk('e_sente')],
];

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数で作る。0 秒の命令はずらさない）の勝ちの数 */
function wins16(base: Step[]): number {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let wins = 0;
    for (let k = 0; k < 16; k++) {
        const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
        if (play(steps).o.result === 'victory') wins++;
    }
    return wins;
}

/** 比べの基準（同じ台本は 1 回だけ進める） */
const memo = new Map<Step[], Run>();
const run = (steps: Step[]): Run => {
    if (!memo.has(steps)) memo.set(steps, play(steps));
    return memo.get(steps)!;
};

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

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（地形に合った作戦・準備した正面攻撃と比べて、主目標に届かない・
// 損害が大きい・副目標を落とす）。無計画な攻撃の勝敗は「記録」として残す（台本と数字は前のまま。変わったら理由と前後の数字を書いて直す）
describe('大平原：無計画な攻撃・地形に合わない作戦と、地形に合った作戦の比べ（早送り）', () => {
    it('何もしない → 地形に合った作戦（勝ち）と違い、主目標に届かない（記録：右翼が林から出た騎馬に横を突かれ、やがて本陣が崩れて負ける）', () => {
        const r = run([]);
        expect(run(FIT).o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.o.units.find((u) => u.id === 'a_sakakibara')!.status).toBe('routed');
    });

    it('全部隊で先手へ攻めかかる（無計画）→ 地形に合った作戦・準備した正面攻撃と違い、主目標に届かず、副目標（予備隊）も落とす（記録：同じ敵の正面に重なって効かず、負ける）', () => {
        const r = run(FIGHTERS.map((id) => [0, id, atk('e_sente')] as Step));
        for (const better of [run(FIT), run(PREPARED)]) {
            expect(better.o.objectives!.primary!.achieved).toBe(true);
            expect(secondaryOf(better)).toBe(true);
        }
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(secondaryOf(r)).toBe(false);
        // 記録（確かめた時：106.9 秒に負け・損害 38.1％。早く崩れるので損害の割合は勝った作戦より小さい。損害では比べない）
        expect(r.o.result).toBe('defeat');
    });

    it('横一列で正面の敵へそれぞれ攻めかかる（無計画）→ 同じ相手へ準備して当たる攻撃・地形に合った作戦より損害が大きく、主目標に届かず、予備隊も崩れる（記録：負け）', () => {
        const r = run(LINE);
        // 確かめた時：横一列 160.2 秒に負け・損害 55.9％ ／ 準備した正面攻撃 勝ち・45.1％ ／ 地形に合った作戦 勝ち・46.6％
        expect(r.loss).toBeGreaterThan(run(PREPARED).loss + 0.05);
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.05);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(secondaryOf(r)).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('正面へ攻めかかり、30 秒ごとに崩れた相手から近い敵へ当て直す（無計画）→ 準備した正面攻撃・地形に合った作戦より損害が大きく、主目標に届かない（記録：負けるか、勝っても損害が大きい）', () => {
        const again = [30, 60, 90, 120, 150, 180, 210, 240].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step));
        const r = run([...LINE, ...again]);
        // 確かめた時：162.0 秒に負け・損害 53.3％
        expect(r.loss).toBeGreaterThan(run(PREPARED).loss + 0.05);
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.05);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result !== 'victory' || r.loss >= 0.45).toBe(true);
        expect(r.loss).toBeGreaterThan(0.45);
    });

    it('持ち場で待ち構えた後、騎馬で回らずに全部隊で本陣へ押す → 地形に合った作戦より損害が大きく、主目標に届かない（記録：途中の後詰め・騎馬・弓に崩されて負ける）', () => {
        const r = run([[0, 'a_yumi', atk('e_sente')], ...FIGHTERS.filter((id) => id !== 'a_yumi').map((id) => [100, id, atk('e_hq')] as Step)]);
        // 確かめた時：152.2 秒に負け・損害 54.0％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.05);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
    });

    it('騎馬を回すが、予備隊を使わない（林から出た騎馬を放っておく）→ 地形に合った作戦と違い、主目標に届かない（記録：負ける）', () => {
        const r = run(FIT.filter(([, id]) => id !== 'a_ishikawa'));
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録（確かめた時：171.9 秒に負け・損害 49.6％）
        expect(r.o.result).toBe('defeat');
        expect(r.left.a_ishikawa).toBe(350);
    });

    it('騎馬を使わない（待ち構え・予備隊・本陣への押しだけ）→ 地形に合った作戦より損害が大きく、主目標に届かない（記録：左右の備えを崩しきれず日没）', () => {
        const r = run(FIT.filter(([, id]) => id !== 'a_kiba'));
        // 確かめた時：日没・損害 53.4％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.05);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
    });

    it('騎馬を始めから左備へ真っすぐ当てる → 地形に合った作戦（左備と組み合ってから回り込む）・準備した正面攻撃（組み合ってから 60 秒に当てる）と違い、主目標に届かない（記録：騎馬が崩れて負ける）', () => {
        const r = run([[0, 'a_kiba', atk('e_left')], ...FIT.filter(([t, id]) => id !== 'a_kiba' || t >= 120)]);
        for (const better of [run(FIT), run(PREPARED)]) expect(better.o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録（確かめた時：195.1 秒に負け。騎馬は組み合う前の槍と正面からぶつかって崩れる）
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

    // Version 13 候補で後詰めの差配は「味方の部隊を 1 つ選ぶ・石川隊は 30 秒動けない」能力に変わった。前は 150 秒（本陣へ入れる時）に
    // 対象なしで使っていた。今は本陣へ押す 1 秒前（119 秒）に忠勝隊を選んで本陣へ急がせ、石川隊は 150 秒に本陣へ入る
    it('固有能力を足しても勝つ（左備を突くとき酒井隊の両翼の采配、本陣へ押す前に石川隊の後詰めの差配で忠勝隊を急がせる）', () => {
        const r = play([...FIT, [50, 'a_sakai', 'ability'], [119, 'a_ishikawa', { abilityTarget: 'a_tadakatsu' }]]);
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

describe('大平原：準備した正面攻撃（早送り）', () => {
    it('弓で先手を削ってから槍三隊が向かいの敵へ、騎馬は組み合った左備へ正面から、予備隊は林の騎馬へ、号令・采配を使って本陣へ（記録：197.4 秒に勝ち・損害 45.1％・副目標も達成）', () => {
        const r = run(PREPARED);
        expect(r.refused).toEqual([]);
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ieyasu', 'a_sakai']);
        // 記録
        expect(r.o.result).toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.5);
    });

    it('同じ相手への無計画な攻めかかり（横一列）より、16 通りの勝ちが多く、損害が小さい。地形に合った作戦（回り込み）と同じくらい勝てる（記録：準備 15 勝・横一列 0 勝・地形に合った作戦 15 勝）', () => {
        const prep = wins16(PREPARED);
        const line = run(LINE);
        // 横一列は 0 秒の命令だけなのでずらしても同じ（1 通りの結果が 16 通りの結果）
        expect(line.o.result).not.toBe('victory');
        expect(prep).toBeGreaterThanOrEqual(13);
        expect(run(PREPARED).loss + 0.05).toBeLessThan(line.loss);
        // 地形に合った作戦（騎馬で西の外を回る）と比べても大きくは劣らない（大平原は回り込みが要る地形ではなく、予備・弓・能力の使い方が決め手）
        expect(Math.abs(prep - wins16(FIT))).toBeLessThanOrEqual(2);
    }, 60_000);

    it('準備を抜くと崩れる：能力（采配・号令）を使わないと、勝っても時間がかかり損害が大きい（記録：219.7 秒・損害 52.3％）', () => {
        const noAb = run(PREPARED.filter(([, , o]) => o !== 'ability'));
        expect(noAb.o.elapsedSec).toBeGreaterThan(run(PREPARED).o.elapsedSec + 10);
        expect(noAb.loss).toBeGreaterThan(run(PREPARED).loss + 0.05);
    });
});
