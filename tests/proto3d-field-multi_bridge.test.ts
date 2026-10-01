/**
 * 戦場「複数橋」（multi_bridge）の釣り合い（docs/fields-group2-design.md §4）。
 * 地形に合わない作戦（放置＝均等に置いたまま・均等に増やす・全部隊で東へ寄せる・橋を渡って攻める・早く本陣の周りへ固める）は負け、
 * 地形に合った作戦（敵の主力の向かう東の橋の口へ忠勝隊と弓を寄せ、予備の石川隊で中の口を埋め、西が片付いたら酒井隊を中へ回す）は勝つ。
 * 副目標（3 本の橋のうち 2 本以上を最後まで守る。目標の種類 defend_zones で、橋ごとに南の口を見る）は作戦によって 3 本／1 本に分かれる。
 * （橋ごとの defend_time の副目標 3 つだったのを、エンジンの直しで 1 つの defend_zones にした。橋ごとの守り抜いた・失ったは目標の見張りの
 * zoneLost で読む。直す前と同じ台本で、このファイルの確かめ（勝敗・損害・橋ごとの結果・失った時刻・16 通りの数）はどれも変わらなかった）
 * 能力の値打ちが地形で変わる比べ：酒井の両翼の采配（橋の口の狭い正面では包囲にならず効かない・南の岸の開けた所では効く）と、
 * 石川の後詰めの差配（中の口で踏みとどまったまま 150 m 先の東の口の忠勝隊を支える・同じ口の味方に使うと東は支えられない）。
 *
 * 確認の種類（テストの名前にも書く）：
 * - 「早送り」：決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める。台本は人が画面でできる程度の
 *   命令の数・間隔（数十秒おき、10 回前後）。移動の後の向き（face）は画面から指定できないので使わない。
 * - 「局面」：複数橋の地図に部隊を置いて始める（目標なし）。状態の途中の書き換えはしない。
 *
 * 確かめた時の数字（2026-10-01、このコミットのコード）：
 * - 何もしない（均等に置いたまま）：129.4 秒に東の口を失い、220.2 秒に家康本陣が崩れて負け（損害 33％）。
 * - 地形に合った作戦（FIT）：勝利（300 秒）。損害 38％。3 本の橋の口をすべて守る。榊原隊は 129.5 秒に敗走（兵 128 を残す）、
 *   忠勝隊は兵 143 で最後まで東の口に立つ。±15 秒ずらした 16 通り（乱数の種 7）：16 勝、2 本以上を守る 16 通り（西 16・中 15・東 16）、損害の平均 37％・最大 45％。
 * - 本陣の近くで受ける（橋を捨てて早く下がる。酒井隊だけ西を片付けてから）：勝利だが、橋は西の 1 本だけ（中は 67.7 秒、東は 129.4 秒に失う）。
 *   16 通りすべて勝ち・2 本以上を守る 0 通り。損害 34％（本陣の近くの戦いは損害がやや少ないが、橋を守る副目標は果たせない）。
 * - 酒井の両翼の采配（局面。正面の酒井隊と横の槍隊で 1 隊の敵を挟む）：
 *   東の橋の口（狭い正面の区域）では横の槍隊が斬りかかれず包囲にならない。能力の有無で 20 秒の敵の兵・士気は同じ（546・75）。
 *   南の岸の開けた所（同じ形を北から 95 m 南）では包囲になり、4 秒の敵の兵 563 → 528・士気 65 → 32、5.8 秒に敗走（使わない時は 20 秒でも崩れない。兵 428・士気 17）。
 *   台本でも、FIT の中の口で 160 秒に使うと、勝敗・副目標は同じで、敵の二番手（西）の兵の残りも 173 → 175 とほぼ変わらない。
 * - 石川の後詰めの差配（FIT の 130 秒、中の口の石川隊から 150 m 先の東の口の忠勝隊へ）：
 *   使わない時は忠勝隊が 263.9 秒に敗走（兵 154）、使うと兵 143 で最後まで東の口に立つ。16 通りで東の口を守り抜くのは 15 → 16（種 7）。
 *   同じ時刻に同じ中の口の酒井隊へ使っても、忠勝隊は 263.9 秒に敗走する（東の口の守りの支えにならない）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { ABILITY_DATA, useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order, UnitDef } from '../proto3d/src/battle/types';

const MB = getField('multi_bridge')!;
const N = 0;
const S = Math.PI;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、{ abilityTarget } は対象の要る能力 */
type Step = [number, string, Order | 'ability' | { abilityTarget: string }];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });

interface Run {
    s: BattleState;
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 守り抜いた橋（勝って終えて、失っていない橋の口。西・中・東の順に mb_west・mb_center・mb_east） */
    bridges: string[];
}

function play(steps: Step[]): Run {
    const s = createBattle(buildBattleSetup(MB, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            const ok = ord === 'ability' ? useAbility(st, id).ok : typeof ord === 'object' && 'abilityTarget' in ord ? useAbility(st, id, ord.abilityTarget).ok : issueOrder(st, id, ord);
            if (!ok) refused.push(`${t}:${id}`);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    const run = s.objectives!.secondary.find((r) => r.def.id === 'mb_bridges')!;
    const bridges = o.result === 'victory' ? BRIDGE_KEYS.filter((_, i) => !run.zoneLost[i]) : [];
    return { s, o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, bridges };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
/** その部隊の最初の敗走の時刻（無ければ null） */
const routAt = (r: Run, id: string) => r.s.events.find((e) => e.kind === 'rout' && e.unitId === id)?.t ?? null;
/** 橋（「東の橋」など）の口を失った時刻 */
const lostAt = (r: Run, label: string) => r.s.events.find((e) => e.text.includes('副目標「3 本の橋のうち') && e.text.includes(`${label}の口を失った`))?.t ?? null;
/** 橋の口の区域の呼び方（西・中・東の順） */
const BRIDGE_KEYS = ['mb_west', 'mb_center', 'mb_east'];

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数で作る。0 秒の命令はずらさない） */
function jittered(base: Step[], seed0 = 7): Run[] {
    let seed = seed0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) out.push(play(base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step)));
    return out;
}

const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_kiba'];

// ---------------------------------------------------------------- 台本

/**
 * 地形に合った作戦の骨組み（石川の差配なし）：20 秒、敵の主力が北東に集まるのを見て、中の忠勝隊を東の口（榊原隊の西隣）へ、弓を東の口の後ろへ、
 * 予備の石川隊を空いた中の口へ。70 秒、弓は東の口に並ぶ主力（二）を射る。100 秒、西の陽動が崩れたら（95 秒ごろ）酒井隊を中の口へ回し、
 * 騎馬を中の後ろへ。150 秒、二番手が中の橋を渡るころ家康の号令。155 秒、酒井隊は石川隊の後ろに並ぶ二番手（西）へ当たる。命令 9 回
 */
const CORE: Step[] = [
    [20, 'a_tadakatsu', mv(140, 42)],
    [20, 'a_yumi', mv(120, 62)],
    [20, 'a_ishikawa', mv(0, 40)],
    [70, 'a_yumi', atk('e_main2')],
    [100, 'a_sakai', mv(-15, 45)],
    [100, 'a_kiba', mv(20, 70)],
    [150, 'a_ieyasu', 'ability'],
    [155, 'a_sakai', atk('e_second2')],
];
/** 地形に合った作戦：骨組み＋130 秒に中の口の石川隊が、東の口で主力（二）と斬り合う忠勝隊を後詰めの差配で支える。命令 10 回 */
const FIT: Step[] = [...CORE, [130, 'a_ishikawa', { abilityTarget: 'a_tadakatsu' }]];

/** 本陣の近くで受ける：20 秒に忠勝隊・石川隊・騎馬・弓を本陣の前へ下げ、100 秒に西を片付けた酒井隊も下げる（東の榊原隊はそのまま） */
const NEAR_HQ: Step[] = [
    [20, 'a_tadakatsu', mv(30, 105)],
    [20, 'a_ishikawa', mv(0, 100)],
    [20, 'a_kiba', mv(-50, 125)],
    [20, 'a_yumi', mv(0, 155)],
    [100, 'a_sakai', mv(-30, 105)],
];

describe('複数橋のデータ', () => {
    it('検査を通る。味方 7／敵 10（敵はすべて敵勢）。深い川に橋 3 本（間は 150 m）、どの橋も橋の上と南の口が狭い正面（1 部隊まで）', () => {
        expect(validateField(MB)).toEqual([]);
        const us = presetUnits(MB, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_yumi', 'a_kiba']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(10);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        const bridges = MB.terrain.filter((a) => a.kind === 'bridge').map((a) => (a.rect!.x0 + a.rect!.x1) / 2);
        expect(bridges).toEqual([-150, 0, 150]);
        const narrow = (MB.specialRules ?? []).filter((r) => r.type === 'narrow_frontage');
        expect(narrow.map((r) => r.maxEngaged)).toEqual([1, 1, 1]);
        // 南の口で受ける隊の持ち場（z 40）は狭い正面の区域の中
        for (const r of narrow) expect(inZone(r.zone, (r.zone.rect!.x0 + r.zone.rect!.x1) / 2, 40)).toBe(true);
        expect(createBattle(buildBattleSetup(MB, 'standard')).field.nav).not.toBeNull();
    });

    it('目標：主目標は本陣の区域を 300 秒しのぐ（敵本陣の撃破ではない）。副目標は 3 本の橋のうち 2 本以上を最後まで守る（1 つの目標。橋ごとに南の口を見る）', () => {
        expect(MB.objectives.primary).toMatchObject({ type: 'defend_time', sec: 300, loseSec: 12 });
        expect(MB.objectives.secondary.map((d) => d.id)).toEqual(['mb_bridges']);
        const d = MB.objectives.secondary[0]!;
        expect(d).toMatchObject({ type: 'defend_zones', sec: 300, minHeld: 2, loseSec: 10, names: ['西の橋の口', '中の橋の口', '東の橋の口'] });
        // 口で受ける隊の持ち場が区域の中
        if (d.type === 'defend_zones') d.zones.forEach((z, i) => expect(inZone(z, [-150, 0, 150][i]!, 40)).toBe(true));
        const r = play([]);
        expect(r.o.objectives!.secondary.map((x) => [x.id, x.type])).toEqual([['mb_bridges', 'defend_zones']]);
        expect(r.o.objectives!.primary!.id).toBe('mb_defend');
    });

    it('敵の考え：主力（槍 2・騎馬）と二番手は本陣へ攻め込む。主力の弓は東の橋の北の口から外れた岸で射る（主力の槍の道を塞がない）', () => {
        const us = presetUnits(MB, 'standard').filter((u) => u.side === 'enemy');
        const hqAim = (id: string) => us.find((u) => u.id === id)!.aiTarget;
        for (const id of ['e_main1', 'e_main2', 'e_main_kiba', 'e_second1', 'e_second2']) {
            expect(us.find((u) => u.id === id)!.aiRole).toBe('assault');
            expect(hqAim(id)).toMatchObject({ x: 0, z: 135 });
        }
        expect(us.find((u) => u.id === 'e_second1')!.arriveAt).toBe(90);
        const yumi = hqAim('e_main_yumi')!;
        const east = MB.terrain.find((a) => a.kind === 'bridge' && a.rect!.x0 > 100)!.rect!;
        expect(yumi.x - (yumi.r ?? 0)).toBeGreaterThan(east.x1 + 10);
        expect(yumi.z).toBeLessThan(-25); // 北の岸
    });

    it('石川の後詰めの差配の届く距離（半径 180 m）は、中の橋の口から東西どちらの橋の口にも届く（橋の間 150 m）', () => {
        expect(ABILITY_DATA.ishikawa_reserve.radius).toBeGreaterThanOrEqual(150);
        expect(ABILITY_DATA.ishikawa_reserve.radius).toBeLessThan(300); // 西の口から東の口へは届かない
    });
});

describe('複数橋：地形に合わない作戦（早送り）', () => {
    it('何もしない（3 本の橋に 1 隊ずつ均等に置いたまま）→ 東の口が主力に押し切られ、本陣が崩れて負ける。橋は 1 本も残らない', () => {
        const r = play([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.reason).toBe('ally_hq_routed');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.bridges).toEqual([]);
        expect(lostAt(r, '東の橋')).toBeLessThan(150);
        expect(r.o.elapsedSec).toBeLessThan(240);
    });

    it('均等に増やす（予備の石川隊を中、騎馬を西、弓を東の後ろへ。どの橋も 2 隊ずつ）→ 主力の来る東が押し切られて負ける', () => {
        const r = play([
            [20, 'a_ishikawa', mv(0, 60)],
            [20, 'a_kiba', mv(-150, 60)],
            [20, 'a_yumi', mv(150, 70)],
        ]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('defeat');
        expect(r.bridges).toEqual([]);
    });

    it('全部隊で東の口へ寄せる（中・西を空ける）→ 狭い口に入り切らず、口の外で主力に囲まれて崩れ、軍が崩壊して負ける', () => {
        const r = play([...['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_kiba'].map((id, i) => [20, id, mv(130 + i * 5, 45 + i * 5)] as Step), [20, 'a_yumi', mv(120, 62)]]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.reason).toBe('ally_army_broken');
        expect(r.o.elapsedSec).toBeLessThan(160);
        expect(r.bridges).toEqual([]);
    });

    it('正面突破（全部隊で中の橋を渡って敵本陣へ攻めかかる）→ 本陣が空き、渡った隊も橋の向こうで崩れて負ける。命令の時刻を ±15 秒ずらした 16 通りもすべて負け', () => {
        const cross: Step[] = [...FIGHTERS.map((id) => [30, id, atk('e_hq')] as Step), [30, 'a_yumi', mv(0, 20)]];
        const r = play(cross);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.elapsedSec).toBeLessThan(200);
        expect(jittered(cross).filter((x) => x.o.result === 'victory')).toHaveLength(0);
    }, 60_000);

    // 確かめた時：15 秒に全部隊で主力（一）へ当たると 130.5 秒に軍が崩壊（16 通りでは 3 勝 13 敗。主力が東の口で崩れる並びの時だけ勝つ）
    it('正面突破（主力が見えた 15 秒に全部隊で主力（一）へ当たる。東の橋を渡って押す）→ 負ける', () => {
        const r = play([...FIGHTERS.map((id) => [15, id, atk('e_main1')] as Step), [15, 'a_yumi', atk('e_main1')]]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });

    it('早く本陣の周りへ固める（20 秒に全部隊を本陣の前へ下げる）→ 3 本とも渡られ、本陣の前で挟まれて負ける', () => {
        const r = play([
            [20, 'a_tadakatsu', mv(30, 105)],
            [20, 'a_sakai', mv(-30, 105)],
            [20, 'a_sakakibara', mv(50, 125)],
            [20, 'a_ishikawa', mv(0, 100)],
            [20, 'a_kiba', mv(-50, 125)],
            [20, 'a_yumi', mv(0, 155)],
        ]);
        expect(r.o.result).toBe('defeat');
        expect(r.bridges).toEqual([]);
    });

    // 確かめた時：最初の命令を 100 秒まで待つと、勝つが東の口を失い（忠勝隊も敗走）、損害 51％（FIT は 38％）。80 秒なら損害 40％で東の口を失う
    it('寄せるのが遅い（地形に合った作戦の最初の命令を、西が片付く 100 秒まで待つ）→ しのげても東の口を失い、損害が 1 割以上多い', () => {
        const fit = play(FIT);
        const r = play(FIT.map(([t, id, o]) => [t === 20 ? 100 : t, id, o] as Step));
        expect(r.bridges).not.toContain('mb_east');
        expect(statusOf(r, 'a_tadakatsu')).toBe('routed');
        expect(r.loss).toBeGreaterThan(fit.loss + 0.1);
    });
});

describe('複数橋：地形に合った作戦（早送り）', () => {
    it('敵の主力の向かう東の口へ忠勝隊と弓を寄せ、予備の石川隊で中を埋め、西が片付いたら酒井隊を中へ回す → 300 秒しのいで勝つ（3 本とも守る）', () => {
        const r = play(FIT);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.elapsedSec).toBe(300);
        expect(r.bridges).toEqual(['mb_west', 'mb_center', 'mb_east']);
        expect(r.loss).toBeLessThan(0.42);
        // 東の口：榊原隊は主力（一）を受けて崩れるが、忠勝隊が最後まで立つ。主力の槍は 2 隊とも崩れる
        expect(routAt(r, 'a_sakakibara')).not.toBeNull();
        expect(statusOf(r, 'a_tadakatsu')).toBe('ready');
        expect(statusOf(r, 'e_main1')).toBe('routed');
        expect(statusOf(r, 'e_main2')).toBe('routed');
        // 中の口：二番手は 2 隊とも崩れる
        expect(statusOf(r, 'e_second1')).toBe('routed');
        expect(statusOf(r, 'e_second2')).toBe('routed');
    });

    it('命令の時刻を ±15 秒ずらした 16 通りのうち 14 通り以上で勝ち、2 本以上の橋を守る（確かめた時：16 勝・2 本以上 16 通り）', () => {
        const rs = jittered(FIT);
        expect(rs.filter((x) => x.o.result === 'victory').length).toBeGreaterThanOrEqual(14);
        expect(rs.filter((x) => x.o.result === 'victory' && x.bridges.length >= 2).length).toBeGreaterThanOrEqual(14);
    }, 60_000);
});

describe('複数橋：副目標（橋ごとの守り）が作戦で分かれる（早送り）', () => {
    it('橋の口で受ける（FIT）→ 3 本とも守る。本陣の近くで受ける → 主目標は果たすが、橋は西の 1 本だけ（2 本以上の目安に届かない）', () => {
        const fit = play(FIT);
        const near = play(NEAR_HQ);
        expect(fit.o.result).toBe('victory');
        expect(near.o.result).toBe('victory');
        expect(fit.bridges).toEqual(['mb_west', 'mb_center', 'mb_east']);
        expect(near.bridges).toEqual(['mb_west']);
        // 主目標と副目標は別々に記録される
        expect(near.o.objectives!.primary!.achieved).toBe(true);
        expect(near.o.objectives!.secondary.map((x) => [x.id, x.achieved])).toEqual([['mb_bridges', false]]);
        expect(fit.o.objectives!.secondary.map((x) => [x.id, x.achieved])).toEqual([['mb_bridges', true]]);
        expect(lostAt(near, '中の橋')).toBeLessThan(90);
        // 2 本目（東）を失った時に副目標は果たせなくなる
        expect(near.s.events.find((e) => e.text === '副目標「3 本の橋のうち 2 本以上を最後まで守る」は果たせなくなった')?.t).toBe(lostAt(near, '東の橋'));
    });

    it('16 通りずらしても分かれ方は同じ（本陣の近くで受けると 2 本以上を守る並びは 0、FIT は 14 通り以上）', () => {
        const near = jittered(NEAR_HQ);
        expect(near.filter((x) => x.bridges.length >= 2)).toHaveLength(0);
    }, 60_000);
});

describe('複数橋：能力の値打ちが地形で変わる', () => {
    /** 局面：複数橋の地図に、南を向く敵の槍 1 隊と、その正面の酒井隊・横（東）の槍隊を置く（目標なし。家康本陣は西の隅） */
    const pinScene = (ex: number, ez: number): UnitDef[] => [
        { id: 'a_ieyasu', side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', generalId: 'ieyasu', leaderId: 'ieyasu', strength: 300, morale: 90, x: -150, z: 160, facing: N },
        { id: 'a_sakai', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '酒井忠次隊', generalId: 'sakai', leaderId: 'sakai', strength: 400, morale: 80, x: ex, z: ez + 22, facing: N, order: atk('e_x') },
        { id: 'a_two', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川槍隊', strength: 400, morale: 80, x: ex + 22, z: ez, facing: -Math.PI / 2, order: atk('e_x') },
        { id: 'e_hq', side: 'enemy', clan: 'rival', kind: 'honjin', name: '敵勢の本陣', strength: 350, morale: 85, x: 0, z: -160, facing: S, aiRole: 'guard_hq' },
        { id: 'e_x', side: 'enemy', clan: 'rival', kind: 'yari', name: '敵勢の主力', strength: 600, morale: 85, x: ex, z: ez, facing: S, aiRole: 'hold_line' },
        // 主力が崩れても合戦が終わらないように、遠くに敵の槍を 1 つ置く
        { id: 'e_far', side: 'enemy', clan: 'rival', kind: 'yari', name: '敵勢の西の隊', strength: 300, morale: 70, x: -160, z: -90, facing: S, aiRole: 'hold_line' },
    ];
    function scene(ex: number, ez: number, use: boolean) {
        const s = createBattle(buildBattleSetup(MB, pinScene(ex, ez), { objectives: 'none' }));
        if (use) expect(useAbility(s, 'a_sakai').ok).toBe(true);
        const at: Record<number, { str: number; mor: number }> = {};
        let encircled: number | null = null;
        let rout: number | null = null;
        let twoEngaged = false;
        while (s.t < 20.05 && !s.result) {
            stepBattle(s, 0.1);
            const e = unitById(s, 'e_x')!;
            if (encircled === null && s.encircled.includes('e_x')) encircled = s.t;
            if (rout === null && e.status !== 'ready') rout = s.t;
            if (unitById(s, 'a_two')!.engagedWith === 'e_x') twoEngaged = true;
            for (const t of [4, 20]) if (at[t] === undefined && s.t >= t - 1e-9) at[t] = { str: Math.round(e.strength), mor: Math.round(e.morale) };
        }
        return { at, encircled, rout, twoEngaged };
    }

    it('酒井の両翼の采配（局面）：東の橋の口（狭い正面）では横の隊が斬りかかれず包囲にならない → 能力の有無で 20 秒の敵の兵・士気は同じ', () => {
        const zone = MB.specialRules!.find((r) => r.type === 'narrow_frontage' && inZone(r.zone, 150, 15))!;
        expect(zone).toBeDefined();
        const off = scene(150, 15, false);
        const on = scene(150, 15, true);
        expect(off.twoEngaged).toBe(false);
        expect(on.twoEngaged).toBe(false);
        expect(on.encircled).toBeNull();
        expect(on.at[20]).toEqual(off.at[20]);
        expect(on.rout).toBeNull();
    });

    it('酒井の両翼の采配（局面）：同じ形を南の岸の開けた所（95 m 南）に置くと包囲になり、4 秒の損害・士気の落ち方が大きく、10 秒のうちに崩れる（使わない時は 20 秒でも崩れない）', () => {
        expect((MB.specialRules ?? []).some((r) => r.type === 'narrow_frontage' && (inZone(r.zone, 150, 110) || inZone(r.zone, 172, 110)))).toBe(false);
        const off = scene(150, 110, false);
        const on = scene(150, 110, true);
        expect(off.twoEngaged).toBe(true);
        expect(on.encircled).not.toBeNull();
        expect(600 - on.at[4]!.str).toBeGreaterThan((600 - off.at[4]!.str) * 1.6);
        expect(on.at[4]!.mor).toBeLessThan(off.at[4]!.mor - 20);
        expect(on.rout!).toBeLessThan(10);
        expect(off.rout).toBeNull();
    });

    it('酒井の両翼の采配（早送り）：地形に合った作戦の中の口で 160 秒に使っても、勝敗・守った橋・敵の二番手の崩れ方はほとんど変わらない（狭い口では挟めない）', () => {
        const off = play(FIT);
        const on = play([...FIT, [160, 'a_sakai', 'ability']]);
        expect(on.refused).toEqual([]);
        expect(on.o.abilitiesUsed!.a_sakai).toBe(160);
        expect(on.o.result).toBe(off.o.result);
        expect(on.bridges).toEqual(off.bridges);
        expect(on.s.encircled).toEqual([]);
        expect(Math.abs(on.left.e_second2! - off.left.e_second2!)).toBeLessThanOrEqual(5);
        expect(Math.abs(on.loss - off.loss)).toBeLessThan(0.01);
    });

    it('石川の後詰めの差配（早送り）：中の口で踏みとどまる石川隊から 150 m 先の東の口の忠勝隊を支える → 忠勝隊が最後まで立つ（使わない時は 263.9 秒に敗走）', () => {
        const off = play(CORE);
        const on = play(FIT);
        expect(off.o.result).toBe('victory');
        expect(on.o.result).toBe('victory');
        expect(routAt(off, 'a_tadakatsu')).toBeGreaterThan(240);
        expect(routAt(on, 'a_tadakatsu')).toBeNull();
        expect(statusOf(on, 'a_tadakatsu')).toBe('ready');
        // 石川隊（中の口 (0,40)）と忠勝隊（東の口 (140,42)）は別の橋の口。間は 140 m で、差配の届く 180 m の中
        const d = Math.hypot(140 - 0, 42 - 40);
        expect(d).toBeGreaterThan(120);
        expect(d).toBeLessThanOrEqual(ABILITY_DATA.ishikawa_reserve.radius);
    });

    it('石川の後詰めの差配（早送り）：同じ 130 秒に、同じ中の口の酒井隊へ使っても東の口は支えられない（忠勝隊は使わない時と同じ 263.9 秒に敗走）', () => {
        const off = play(CORE);
        const near = play([...CORE, [130, 'a_ishikawa', { abilityTarget: 'a_sakai' }]]);
        expect(near.refused).toEqual([]);
        expect(routAt(near, 'a_tadakatsu')).toBe(routAt(off, 'a_tadakatsu'));
    });

    it('石川の後詰めの差配：16 通りずらしても、東の口へ使う方が東の口を守り抜く並びが多い（確かめた時：使わない 15・使う 16）', () => {
        const eastHeld = (rs: Run[]) => rs.filter((x) => x.bridges.includes('mb_east')).length;
        const off = eastHeld(jittered(CORE));
        const on = eastHeld(jittered(FIT));
        expect(on).toBeGreaterThanOrEqual(off);
        expect(on).toBe(16);
    }, 90_000);
});
