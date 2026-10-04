/**
 * 戦場「城攻め前面」（siege_front）。外門を制圧して開き、その奥の最初の曲輪を確保する（段階目標。第3群）。
 * 城全体・天守の中は作らない。石垣の破壊・梯子・攻城兵器も無い。
 *
 * - 400 m × 440 m。外の石垣（wall・高さ 6 m）が z -66〜-56 を東西に走り、真ん中に外門（x -10〜10。閉じている間は通れず、矢も通さない）。
 *   石垣の内側（北）が最初の曲輪（z -184〜-66）。その北の内の石垣（z -190〜-184）には門が無い（今回は奥へ進まない）。
 * - 櫓（射撃拠点）：外門の左右（x -70〜-50・50〜70）に、石垣から南へ張り出した高い台（四角の丘・高さ 8 m）。外側の三方は櫓台の石垣
 *   （高さ 6 m・厚さ 6 m）で、外からは登れず、斬り合いも届かない（射線と同じ判定で、櫓台を挟むと斬り合わない）。櫓の上の弓（各 150）は
 *   石垣を越えて門の前を射る。下からも射られる（線分が櫓台の上を越える）。櫓台のすぐ足元（30 m ほど）は櫓から射られない死角。
 *   櫓の北（曲輪の側）は開いていて、門が開いた後は曲輪の中から櫓へ上がれる。
 * - 側面の拠点：門の東の外の小高い丘（中心 (115,-20)・高さ 6 m）。南と西（門の側）は柵で、口は東だけ。
 *   拠点の槍（350）は拠点の中を守り（hold_zone）、拠点の弓（200）は丘の上から柵越しに門の前の輪の東半分まで射る（西の端は届かない）。
 * - 門の前には敵の出張りの槍（400）が立つ。崩れると閉じた門に押し付けられて残るが、戦えないので輪の制圧は止めない。
 * - 門の制圧の条件（画面にも出す）：門の前の輪（x -24〜24・z -56〜-30。門に押し付けられた部隊も中に入る）に敵の戦える部隊がいない状態で、
 *   味方の戦える部隊が 20 秒続けて占める。開くと門は通れるようになり、閉じない（道探しの格子を作り直し、進んでいた道も引き直す）。
 * - 曲輪の中：門の裏の槍（380。曲輪の手前 (0,-110) を守る）・曲輪の真ん中の槍（330）・本陣（北）。門をくぐる所（狭い正面）では、
 *   同じ相手へ斬りかかれるのは 1 部隊まで。門の裏の槍は門から少し奥で待つので、くぐった後は 2 部隊目も横へ回れる。
 * - 主目標（段階目標）：1. 外門の制圧 → 2. 最初の曲輪（中心 (0,-122)、半径 25 m）を、敵のいない状態で味方が 45 秒確保する。
 *   副目標：損害を 3 割以内に抑える・側面の拠点の弓を崩す・徳川騎馬隊の兵を 6 割残す。
 *
 * 作戦（tests/proto3d-field-siege_front.test.ts。早送りの台本と比べ）：
 * - 側面の拠点を先に落としてから門へ：東へ遠回りするので門が開くのも勝つのも一番遅いが、拠点の弓をいつも崩す。
 * - 弓で櫓の上の弓を射すくめてから、全軍で出張りを破って門の前の輪（拠点の弓の届かない西の側）を占める（準備した正面攻撃）：
 *   損害が一番安定して小さい。
 * - 正面に急いで門へ：門は一番早く開き勝つのも早い。急いで弓を前へ出す形（RUSH）は損害が少し大きくばらつき、騎馬を残せない。
 *   弓も能力も使わず 5 隊で一度に当たる形（ALL5）は、準備した正面攻撃より 120 秒ほど早く、損害は同じくらい（16 通りの平均 27.7％ 対 27.7％）。
 *   準備した方が得をするのは騎馬を残す副目標（16 通りで 10 対 6）だけで、「急ぐと損害大」は今の数字では成り立たない
 *   （櫓の弓の強さ・士気・門の制圧の秒数・高所の矢を試したが、準備した方が得になる組は見つからなかった。テストに記録。釣り合いの担当へ）。
 */
import type { BattlefieldDef } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const wall = (x0: number, x1: number, z0: number, z1: number, height = 6): TerrainArea => ({ kind: 'wall', rect: { x0, x1, z0, z1 }, height });
const fence = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'fence', rect: { x0, x1, z0, z1 } });
const bldg = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height: 7 });

/** 門の前の制圧の区域 */
const GATE_FRONT = { rect: { x0: -24, x1: 24, z0: -56, z1: -30 } };
/** 最初の曲輪の確保の区域 */
const BAILEY = { circle: { cx: 0, cz: -122, r: 25 } };

export const SIEGE_FRONT: BattlefieldDef = {
    id: 'siege_front',
    name: '城攻め前面',
    kind: 'siege_front',
    summary: '外門を制圧して開き、奥の最初の曲輪を確保する（段階目標）。門の左右の櫓と、東の外の側面の拠点から射られる',
    width: 400,
    depth: 440,
    terrain: [
        // 外の石垣（門 x -10〜10・櫓 x ±50〜70 を空ける）
        wall(-200, -70, -66, -56),
        wall(-50, -10, -66, -56),
        wall(10, 50, -66, -56),
        wall(70, 200, -66, -56),
        // 櫓（石垣から南へ張り出した高い台）と、その外側の三方の櫓台の石垣
        { kind: 'hill', rect: { x0: -70, x1: -50, z0: -72, z1: -48 }, height: 8 },
        { kind: 'hill', rect: { x0: 50, x1: 70, z0: -72, z1: -48 }, height: 8 },
        wall(-76, -44, -48, -42),
        wall(-76, -70, -56, -48),
        wall(-50, -44, -56, -48),
        wall(44, 76, -48, -42),
        wall(44, 50, -56, -48),
        wall(70, 76, -56, -48),
        // 内の石垣（門なし。今回は奥へ進まない）
        wall(-200, 200, -190, -184, 8),
        // 曲輪の中の蔵・長屋
        bldg(-130, -90, -150, -125),
        bldg(85, 130, -160, -135),
        bldg(-60, -30, -175, -160),
        // 側面の拠点（門の東の外の小高い丘）。南と西（門の側）は柵で、口は東だけ（門の前から直には上がれない）
        { kind: 'hill', circle: { cx: 115, cz: -20, r: 36 }, height: 6 },
        fence(80, 148, 10, 16),
        fence(80, 86, -56, 16),
        // 城へ向かう道
        { kind: 'road', rect: { x0: -8, x1: 8, z0: -56, z1: 220 } },
        // 南西の林
        { kind: 'woods', rect: { x0: -200, x1: -120, z0: 60, z1: 160 } },
        // 西の櫓の前の小さな林（中心 (-106,0)。西の櫓から 70〜90 m・東の櫓・拠点の弓からは届かない。林の中の部隊は 60 m まで見えないので、
        // 林の中から櫓を射る弓は射返されにくい。門の前の輪・門へ向かう道からは離れている）
        { kind: 'woods', rect: { x0: -125, x1: -88, z0: -15, z1: 15 } },
    ],
    gates: [{ id: 'outer_gate', name: '外門', rect: { x0: -10, x1: 10, z0: -66, z1: -56 }, height: 6, capture: { zone: GATE_FRONT, sec: 20 } }],
    highGround: { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 20 },
    // 門をくぐる所：同じ相手へ斬りかかれるのは 1 部隊まで
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -14, x1: 14, z0: -78, z1: -52 } }, maxEngaged: 1 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 110, facing: N, note: '道の上（門の正面）' },
            { id: 'left', x: -70, z: 120, facing: N, note: '左' },
            { id: 'right', x: 70, z: 120, facing: N, note: '右（側面の拠点へ近い）' },
            { id: 'archers', x: -30, z: 135, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 140, facing: N, note: '予備' },
            { id: 'flank', x: 150, z: 130, facing: N, note: '右の外（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -170, facing: S, note: '本陣（曲輪の北）' },
            { id: 'sortie', x: 0, z: -20, facing: S, note: '門の前の出張り' },
            { id: 'gate_guard', x: 0, z: -110, facing: S, note: '門の裏の槍（曲輪の手前）' },
            { id: 'inner', x: 0, z: -125, facing: S, note: '曲輪の真ん中の槍' },
            { id: 'tower_w', x: -60, z: -62, facing: S, note: '西の櫓の弓' },
            { id: 'tower_e', x: 60, z: -62, facing: S, note: '東の櫓の弓' },
            { id: 'bast_yari', x: 95, z: -10, facing: S, note: '側面の拠点の槍' },
            { id: 'bast_yumi', x: 125, z: -25, facing: S, note: '側面の拠点の弓' },
        ],
    },
    exits: { ally: { x: 0, z: 220 }, enemy: { x: 0, z: -178 } },
    objectives: {
        primary: {
            id: 'siege_seq',
            type: 'sequence',
            label: '外門を制圧し、最初の曲輪を確保する',
            steps: [
                { id: 'siege_gate', type: 'open_gate', label: '外門の制圧', gateId: 'outer_gate' },
                { id: 'siege_bailey', type: 'hold_point', label: '最初の曲輪の確保', zone: BAILEY, sec: 45 },
            ],
        },
        secondary: [
            { id: 'siege_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'siege_bastion', type: 'break_unit', label: '側面の拠点の弓を崩す', unitId: 'e_bast_yumi' },
            { id: 'siege_cavalry', type: 'preserve_unit', label: '徳川騎馬隊の兵を 6 割残す', unitId: 'a_kiba', minRatio: 0.6 },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 660,
    briefing: [
        'ゲーム用の演習（架空の相手）。城の外の石垣と外門の前。城全体や天守の中は無い。石垣は通れず、矢も通さない。',
        '外門は閉じている間は通れず、矢も通さない。門の制圧：門の前の輪に敵の戦える部隊がいない状態で、味方の戦える部隊が 20 秒続けて占めると、門が開いて通れるようになる（開いた門は閉じない）。',
        '門の左右の櫓（高い台）の上の弓は、石垣を越えて門の前を射る。櫓台は石垣で、外からは登れず斬り合いも届かない（弓なら射返せる。櫓台のすぐ足元は櫓から射られない）。門が開けば、曲輪の中から櫓へ上がれる。',
        '東の外の側面の拠点（小高い丘）には槍と弓。南と西は柵で、口は東だけ。拠点の弓は柵越しに門の前の輪の東半分まで届く（西の端は届かない）。',
        '門の前には敵の出張りの槍、曲輪の手前と真ん中にも槍、曲輪の北に本陣。門をくぐる所では、同じ相手へ斬りかかれるのは 1 部隊まで。',
        '勝利（段階目標）：1. 外門を制圧する → 2. 最初の曲輪（門の奥の輪）を、敵のいない状態で味方が 45 秒確保する。',
        '副目標：味方の兵の損害を 3 割以内に抑える・側面の拠点の弓を崩す・徳川騎馬隊の兵を 6 割残す。',
    ],
    tactics: [
        '側面の拠点を先に落としてから門へ：東の口へ遠回りするが、門の前で東から射られない（騎馬で拠点の弓を崩す）',
        '弓で櫓の上の弓を射すくめてから、全軍で出張りを破って門の前の輪を占める（20 秒。輪に敵が入ると 0 から）。輪の西の側なら拠点の弓が届かない',
        '正面に急いで門へ行くと門は早く開き勝つのも早いが、櫓と拠点の両方から射られ、騎馬を残しにくい。門をくぐる所は 1 部隊ずつ。門の前の口と通り道に部隊を止めておかない',
    ],
    presets: [
        {
            id: 'standard',
            name: '外門攻め',
            summary: '味方 7／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('right'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('left'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_sortie', 'yari', '敵勢の門の前の出張り', 400, 80, 'sortie', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -24, r: 22 } }),
                E('e_gate_guard', 'yari', '敵勢の門の裏の槍', 380, 80, 'gate_guard', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -110, r: 16 } }),
                E('e_inner', 'yari', '敵勢の曲輪の槍', 330, 78, 'inner', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -125, r: 25 } }),
                E('e_tower_w', 'yumi', '敵勢の西の櫓の弓', 200, 70, 'tower_w', { aiRole: 'hold_line' }),
                E('e_tower_e', 'yumi', '敵勢の東の櫓の弓', 200, 70, 'tower_e', { aiRole: 'hold_line' }),
                E('e_bast_yari', 'yari', '敵勢の側面の拠点の槍', 350, 78, 'bast_yari', { aiRole: 'hold_zone', aiTarget: { x: 112, z: -15, r: 28 }, aiLeash: 30 }),
                E('e_bast_yumi', 'yumi', '敵勢の側面の拠点の弓', 200, 70, 'bast_yumi', { aiRole: 'hold_line' }),
            ],
        },
    ],
};
