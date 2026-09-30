/**
 * 合戦場の演習（5 戦場）の能力を使わない台本と、その結果の要約（tests/proto3d-fields-initiative-record.test.ts が使う）。
 * 台本は各戦場のテスト（tests/proto3d-field-<戦場>.test.ts）の能力を使わない台本の写しと、何もしない台本。
 * initiative：武将の基本方針（自由な動き。BattleSetup.generalInitiative）を使うか（false で Version 12 と同じ動き）。
 */
import { createBattle, isActive, issueOrder, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { Order } from '../proto3d/src/battle/types';

type Step = [number, string, Order | 'nearest'];
const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });

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

/** 結果の要約（勝敗・理由・終わった時刻・味方の損害 %・断られた命令・達成した副目標・部隊ごとの兵の残り） */
export interface Rec {
    result: string;
    reason: string;
    t: number;
    loss: number;
    refused: string[];
    secondary: string[];
    left: Record<string, number>;
}

export function playRecord(fieldId: string, steps: Step[], initiative: boolean): Rec {
    const f = getField(fieldId)!;
    const s = createBattle(buildBattleSetup(f, 'standard', initiative ? undefined : { generalInitiative: false }));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            if (ord === 'nearest') {
                const n = nearestEnemy(st, id);
                if (n && !issueOrder(st, id, n)) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, ord)) refused.push(`${t}:${id}`);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return {
        result: o.result,
        reason: o.reason,
        t: Math.round(o.elapsedSec * 10) / 10,
        loss: Math.round(loss * 1000) / 10,
        refused,
        secondary: (o.objectives?.secondary ?? []).filter((x) => x.achieved).map((x) => x.id),
        left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])),
    };
}

// ---------------------------------------------------------------- 台本（各戦場のテストの写し）

const PLAINS_FIT: Step[] = [
    [0, 'a_yumi', atk('e_sente')],
    [0, 'a_kiba', mv(-160, -20)],
    [45, 'a_kiba', atk('e_left')],
    [80, 'a_ishikawa', atk('e_kiba')],
    [120, 'a_kiba', atk('e_hq')],
    [120, 'a_tadakatsu', atk('e_hq')],
    [120, 'a_sakai', atk('e_hq')],
    [150, 'a_ishikawa', atk('e_hq')],
];
const PLAINS_RESERVE_EARLY: Step[] = [
    [0, 'a_yumi', atk('e_sente')],
    [0, 'a_kiba', mv(-160, -20)],
    [0, 'a_ishikawa', mv(100, 60)],
    [45, 'a_kiba', atk('e_left')],
    [45, 'a_ishikawa', atk('e_right')],
    [120, 'a_kiba', atk('e_hq')],
    [120, 'a_tadakatsu', atk('e_hq')],
    [120, 'a_sakai', atk('e_hq')],
];
const HILLS_TAKE: Step[] = [
    [0, 'a_sakakibara', mv(0, 25)],
    [2, 'a_tadakatsu', mv(-18, -26)],
    [4, 'a_sakai', mv(18, -26)],
    [6, 'a_ishikawa', mv(0, -5)],
    [8, 'a_yumi', mv(-25, -5)],
    [12, 'a_sakakibara', mv(0, -20)],
];
const HILLS_FLANK: Step[] = [
    [0, 'a_sakakibara', atk('e_yumi')],
    [2, 'a_sakai', atk('e_yumi')],
    [4, 'a_yumi', atk('e_sente')],
    [80, 'a_tadakatsu', mv(15, 20)],
    [82, 'a_sakai', mv(55, -15)],
    [84, 'a_ishikawa', mv(55, 5)],
    [86, 'a_sakakibara', mv(45, -60)],
    [120, 'a_tadakatsu', atk('e_yari')],
    [130, 'a_sakai', atk('e_yari')],
    [132, 'a_ishikawa', atk('e_yari')],
    [134, 'a_sakakibara', atk('e_reserve')],
];
function hillsFrontal(killArchers: boolean): Step[] {
    return [
        ...(killArchers ? ([[0, 'a_sakakibara', atk('e_yumi')], [2, 'a_sakai', atk('e_yumi')]] as Step[]) : []),
        [4, 'a_yumi', atk('e_sente')],
        [80, 'a_ishikawa', mv(20, 25)],
        [82, 'a_tadakatsu', mv(-15, 25)],
        [84, 'a_sakai', mv(10, 30)],
        [86, 'a_sakakibara', mv(-30, 30)],
        [120, 'a_tadakatsu', atk('e_sente')],
        [122, 'a_sakai', atk('e_yari')],
        [124, 'a_ishikawa', atk('e_yari')],
        [126, 'a_sakakibara', atk('e_reserve')],
    ];
}
const RF_HILL = mv(-70, -85);
const RF_SPEARS = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const RF_FIT_CENTER: Step[] = [
    [0, 'a_yumi', atk('e_yumi')],
    [0, 'a_tadakatsu', mv(5, 10)],
    [120, 'a_tadakatsu', atk('e_kiba')],
    [120, 'a_yumi', atk('e_sente')],
    [150, 'a_sakakibara', atk('e_sente')],
    [150, 'a_sakai', atk('e_sente')],
    [150, 'a_ishikawa', mv(0, 10)],
    ...RF_SPEARS.map((id) => [220, id, RF_HILL] as Step),
    [220, 'a_yumi', atk('e_hill_yumi')],
];
const RF_FIT_WEST: Step[] = [
    [0, 'a_yumi', atk('e_yumi')],
    [0, 'a_sakakibara', mv(-145, 15)],
    [0, 'a_ishikawa', mv(-145, 15)],
    [0, 'a_tadakatsu', mv(-120, 15)],
    [60, 'a_sakakibara', atk('e_west')],
    [60, 'a_tadakatsu', atk('e_west')],
    [60, 'a_ishikawa', atk('e_west')],
    [150, 'a_sakakibara', RF_HILL],
    [150, 'a_tadakatsu', RF_HILL],
    [150, 'a_ishikawa', RF_HILL],
];
const FOREST_FLANKERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa'];
const FOREST_FIT: Step[] = [
    [0, 'a_lost', mv(0, 130)],
    [0, 'a_sakai', mv(-115, 50)],
    [0, 'a_ishikawa', mv(-100, 55)],
    [0, 'a_tadakatsu', mv(-85, 60)],
    [50, 'a_sakai', mv(-115, -100)],
    [50, 'a_ishikawa', mv(-100, -100)],
    [50, 'a_tadakatsu', mv(-85, -100)],
    ...FOREST_FLANKERS.map((id) => [200, id, atk('e_hq')] as Step),
];
const PASS_GATE: Step[] = [
    [0, 'a_tadakatsu', mv(-10, 42)],
    [0, 'a_sakai', mv(10, 42)],
    [20, 'a_yumi', mv(0, 78)],
];
/** 山道：関の守りに、本陣を上げて援軍を関の後ろへ（能力は使わない） */
const PASS_GATE_RELIEF: Step[] = [...PASS_GATE, [20, 'a_ieyasu', mv(0, 110)], [180, 'a_sakakibara', mv(-10, 62)], [180, 'a_ishikawa', mv(10, 62)]];

/** 台本の一覧：[戦場, 名前, 台本] */
export const SCRIPTS: [string, string, Step[]][] = [
    ['plains', '何もしない', []],
    ['plains', '地形に合った作戦（FIT）', PLAINS_FIT],
    ['plains', '予備隊を始めから右翼へ（RESERVE_EARLY）', PLAINS_RESERVE_EARLY],
    ['hills', '何もしない', []],
    ['hills', '頂を取る（TAKE）', HILLS_TAKE],
    ['hills', '回り込み（FLANK）', HILLS_FLANK],
    ['hills', '回り込み・弓を崩さない（FLANK_NO_ARCHERS）', HILLS_FLANK.filter(([t]) => t >= 4)],
    ['hills', '正面から・弓を崩す（frontal(true)）', hillsFrontal(true)],
    ['hills', '正面から・弓を崩さない（frontal(false)）', hillsFrontal(false)],
    ['river_ford', '何もしない', []],
    ['river_ford', '中央を弓で開ける（FIT_CENTER）', RF_FIT_CENTER],
    ['river_ford', '西の浅瀬へ回る（FIT_WEST）', RF_FIT_WEST],
    ['forest', '何もしない', []],
    ['forest', '西の林を抜ける（FIT）', FOREST_FIT],
    ['mountain_pass', '何もしない', []],
    ['mountain_pass', '関の守り（GATE）', PASS_GATE],
    ['mountain_pass', '関の守り＋本陣と援軍を上げる（能力なし）', PASS_GATE_RELIEF],
];
