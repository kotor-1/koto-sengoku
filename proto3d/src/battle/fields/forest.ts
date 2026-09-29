/**
 * 戦場「森林」（forest）。林の中では動きが遅く、遠くから見えない。奇襲や別働隊が使いやすい。
 *
 * - 400 m × 320 m。西の林（x -200〜-35）と東の林（x 35〜200）が z -110〜80 に広がり、間に開けた中央の道（x -35〜35）が通る。
 *   西の林には細い林道（x -130〜-120。林ではないので速いが、見通される）。
 * - 林の中の部隊は、相手が 60 m に来るまで見えない。林の中の騎馬は動き ×0.5（さらに林の遅さ ×0.5）。
 * - 林の奇襲：相手から見えていなかった部隊が斬りかかると、最初の 8 秒の損害 ×1.5。
 * - 西の林の奥で、味方の物見（徳川の物見隊）が迷っている。敵勢の追っ手が林へ探しに入ってくる。
 * - 主目標：敵勢の本陣（林の北の外）を崩す。副目標：迷った物見隊を味方の陣（南）まで連れ帰る。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

export const FOREST: BattlefieldDef = {
    id: 'forest',
    name: '森林',
    kind: 'forest',
    summary: '広い林と中央の道。林の中を見られずに進み、奇襲と救出をする',
    width: 400,
    depth: 320,
    terrain: [
        { kind: 'woods', rect: { x0: -200, x1: -130, z0: -110, z1: 80 } },
        { kind: 'woods', rect: { x0: -120, x1: -35, z0: -110, z1: 80 } },
        { kind: 'woods', rect: { x0: 35, x1: 200, z0: -110, z1: 80 } },
        { kind: 'road', rect: { x0: -130, x1: -120, z0: -110, z1: 80 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -160, z1: 160 } },
    ],
    terrainRules: {
        woods: { speed: 0.5, kindSpeed: { kiba: 0.5 }, hideSight: 60 },
    },
    specialRules: [{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 130, facing: N, note: '本陣' },
            { id: 'lane', x: 0, z: 95, facing: N, note: '中央の道の手前' },
            { id: 'west_edge', x: -80, z: 100, facing: N, note: '西の林の手前' },
            { id: 'east_edge', x: 80, z: 100, facing: N, note: '東の林の手前' },
            { id: 'reserve', x: 30, z: 140, facing: N, note: '後詰め' },
            { id: 'lost', x: -165, z: -70, facing: N, note: '西の林の奥（迷った物見）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -135, facing: S, note: '本陣（林の北の外）' },
            { id: 'lane_l', x: -18, z: -95, facing: S, note: '中央の道の出口の弓（左）' },
            { id: 'lane_r', x: 18, z: -95, facing: S, note: '中央の道の出口の弓（右）' },
            { id: 'lane', x: 0, z: -60, facing: S, note: '中央の道の先手' },
            { id: 'hunters', x: -100, z: -135, facing: S, note: '追っ手（西の林へ入る）' },
            { id: 'east_woods', x: 110, z: -50, facing: S, note: '東の林の伏兵' },
            { id: 'cavalry', x: 70, z: -135, facing: S, note: '騎馬（後詰め）' },
            { id: 'reserve', x: -45, z: -140, facing: S, note: '後詰め' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'forest_hq', type: 'destroy_hq', label: '敵勢の本陣を崩す' },
        secondary: [{ id: 'forest_rescue', type: 'rescue', label: '迷った物見隊を味方の陣まで連れ帰る', unitId: 'a_lost', zone: { circle: { cx: 0, cz: 130, r: 40 } } }],
    },
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。西と東に広い林、その間に開けた中央の道。西の林には細い林道がある。',
        '林の中の部隊は、相手が 60 m に来るまで見えない。林の中は動きが遅く、騎馬はさらに遅い（×0.5）。',
        '林の奇襲：相手に見えていなかった部隊が斬りかかると、最初の 8 秒の損害 ×1.5。',
        '中央の道の出口は敵の弓と先手が固める。西の林の奥で味方の物見隊が迷っていて、敵勢の追っ手が探しに入ってくる。',
        '勝利：林の北の外にいる敵勢の本陣を崩す（本陣以外をすべて崩しても勝ち）。副目標：物見隊を南の味方の陣（家康本陣の周り）まで連れ帰る。',
    ],
    tactics: ['中央の道は囮にして、林の中を見られずに進み、横から不意を突く', '物見隊は林道を通って早めに下げ、追っ手は林の中で待ち伏せる'],
    presets: [
        {
            id: 'standard',
            name: '林の六隊',
            summary: '味方 6／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、迷った物見隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('lane'),
                T.sakai('west_edge'),
                T.sakakibara('east_edge', 'kiba', 250),
                T.ishikawa('reserve'),
                { id: 'a_lost', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川の物見隊', strength: 150, morale: 60, slot: 'lost' },
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_yumi_l', 'yumi', '敵勢の弓隊（左）', 250, 75, 'lane_l', { aiRole: 'hold_line' }),
                E('e_yumi_r', 'yumi', '敵勢の弓隊（右）', 250, 75, 'lane_r', { aiRole: 'hold_line' }),
                E('e_sente', 'yari', '敵勢の先手', 450, 80, 'lane', { aiRole: 'hold_line' }),
                E('e_hunters', 'yari', '敵勢の追っ手', 300, 75, 'hunters', { aiRole: 'assault', aiTarget: { x: -165, z: -70, r: 30 } }),
                E('e_ambush', 'yari', '敵勢の伏兵', 300, 75, 'east_woods', { aiRole: 'hold_zone', aiTarget: { x: 110, z: -50, r: 60 } }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'cavalry', { aiRole: 'reserve' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 350, 75, 'reserve', { aiRole: 'reserve' }),
            ],
        },
    ],
};
