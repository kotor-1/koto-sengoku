/**
 * 戦場「城攻め前面」（siege_front）。外門を制圧して開き、その奥の最初の曲輪を確保する（段階目標。第3群の最初の案）。
 * 城全体・天守の中は作らない。石垣の破壊・梯子・攻城兵器も無い。
 *
 * - 400 m × 440 m。外の石垣（wall・高さ 6 m）が z -66〜-56 を東西に走り、真ん中に外門（x -10〜10。閉じている間は通れず、矢も通さない）。
 *   石垣の内側（北）が最初の曲輪（z -184〜-66）。その北の内の石垣（z -190〜-184）には門が無い（今回は奥へ進まない）。
 * - 櫓（射撃拠点）：外門の左右（x -70〜-50・50〜70）に、石垣から南へ張り出した高い台（四角の丘・高さ 8 m）。外側の三方は柵で囲う
 *   （外からは登れないが、矢は通る）。櫓の上の弓は石垣を越えて門の前を射る。下からも櫓の上の弓は射られる（線分が石垣の上を越える）。
 * - 側面の拠点：門の東の外の小高い丘 (140,-10)（高さ 6 m）。槍と弓が立ち、門の前の東半分へ打って出る・射る。
 * - 門の前には敵の出張りの槍（400）が立つ。
 * - 門の制圧の条件（画面にも出す）：門の前の輪（x -24〜24・z -56〜-30。門に押し付けられた部隊も中に入る）に敵の戦える部隊がいない状態で、味方の戦える部隊が 20 秒続けて占める。
 *   開くと門は通れるようになり、閉じない（道探しの格子を作り直し、進んでいた道も引き直す）。
 * - 曲輪の中：門の裏の槍（380）・曲輪の真ん中の槍（330）・本陣（北）。
 * - 主目標（段階目標）：1. 外門の制圧 → 2. 最初の曲輪（中心 (0,-122)、半径 25 m）を、敵のいない状態で味方が 45 秒確保する。
 *   副目標：損害を 3 割以内に抑える・側面の拠点の弓を崩す。
 *
 * 成り立たせたい作戦（設計 §4。釣り合いは後の担当）：
 * - 側面の拠点を先に落としてから門へ（遠回りだが、門の前で東から射られない）。
 * - 弓で櫓の上の弓を射すくめ、出張りを破って門の前を占める（櫓の弓が弱れば、門の前で受ける矢が減る）。
 * - 正面に急いで門へ（早いが、櫓と拠点の両方から射られて損害が大きい）。
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
        // 櫓（石垣から南へ張り出した高い台）と、その外側の三方の柵
        { kind: 'hill', rect: { x0: -70, x1: -50, z0: -72, z1: -48 }, height: 8 },
        { kind: 'hill', rect: { x0: 50, x1: 70, z0: -72, z1: -48 }, height: 8 },
        fence(-76, -44, -48, -42),
        fence(-76, -70, -56, -48),
        fence(-50, -44, -56, -48),
        fence(44, 76, -48, -42),
        fence(44, 50, -56, -48),
        fence(70, 76, -56, -48),
        // 内の石垣（門なし。今回は奥へ進まない）
        wall(-200, 200, -190, -184, 8),
        // 曲輪の中の蔵・長屋
        bldg(-130, -90, -150, -125),
        bldg(85, 130, -160, -135),
        bldg(-60, -30, -175, -160),
        // 側面の拠点（門の東の外の小高い丘）と、その西の柵
        { kind: 'hill', circle: { cx: 140, cz: -10, r: 40 }, height: 6 },
        fence(96, 102, -40, 10),
        // 城へ向かう道
        { kind: 'road', rect: { x0: -8, x1: 8, z0: -56, z1: 220 } },
        // 南西の林
        { kind: 'woods', rect: { x0: -200, x1: -120, z0: 60, z1: 160 } },
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
            { id: 'gate_guard', x: 0, z: -88, facing: S, note: '門の裏の槍' },
            { id: 'inner', x: 0, z: -125, facing: S, note: '曲輪の真ん中の槍' },
            { id: 'tower_w', x: -60, z: -62, facing: S, note: '西の櫓の弓' },
            { id: 'tower_e', x: 60, z: -62, facing: S, note: '東の櫓の弓' },
            { id: 'bast_yari', x: 125, z: -15, facing: S, note: '側面の拠点の槍' },
            { id: 'bast_yumi', x: 145, z: -25, facing: S, note: '側面の拠点の弓' },
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
        ],
    },
    generalInitiative: true,
    timeLimitSec: 660,
    briefing: [
        'ゲーム用の演習（架空の相手）。城の外の石垣と外門の前。城全体や天守の中は無い。石垣は通れず、矢も通さない。',
        '外門は閉じている間は通れず、矢も通さない。門の制圧：門の前の輪に敵の戦える部隊がいない状態で、味方の戦える部隊が 20 秒続けて占めると、門が開いて通れるようになる（開いた門は閉じない）。',
        '門の左右の櫓（高い台）の上の弓は、石垣を越えて門の前を射る（櫓の上の弓は下からも射られる。櫓の外側は柵で、登れない）。東の外の側面の拠点（小高い丘）にも槍と弓が立つ。',
        '門の前には敵の出張りの槍、門の裏と曲輪の真ん中にも槍、曲輪の北に本陣。門をくぐる所では、同じ相手へ斬りかかれるのは 1 部隊まで。',
        '勝利（段階目標）：1. 外門を制圧する → 2. 最初の曲輪（門の奥の輪）を、敵のいない状態で味方が 45 秒確保する。',
        '副目標：味方の兵の損害を 3 割以内に抑える・側面の拠点の弓を崩す。',
    ],
    tactics: [
        '側面の拠点を先に落としてから門へ：遠回りだが、門の前で東から射られない',
        '弓で櫓の上の弓を射すくめ、出張りを破って門の前の輪を占める（20 秒。輪に敵が入ると 0 から）',
        '正面に急いで門へ行くと早いが、櫓と拠点の両方から射られる。門が開いたら、門の裏の槍に 1 部隊ずつしか当たれないので予備を続ける',
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
                E('e_gate_guard', 'yari', '敵勢の門の裏の槍', 380, 80, 'gate_guard', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -88, r: 18 } }),
                E('e_inner', 'yari', '敵勢の曲輪の槍', 330, 78, 'inner', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -125, r: 25 } }),
                E('e_tower_w', 'yumi', '敵勢の西の櫓の弓', 200, 70, 'tower_w', { aiRole: 'hold_line' }),
                E('e_tower_e', 'yumi', '敵勢の東の櫓の弓', 200, 70, 'tower_e', { aiRole: 'hold_line' }),
                E('e_bast_yari', 'yari', '敵勢の側面の拠点の槍', 350, 78, 'bast_yari', { aiRole: 'hold_line' }),
                E('e_bast_yumi', 'yumi', '敵勢の側面の拠点の弓', 200, 70, 'bast_yumi', { aiRole: 'hold_line' }),
            ],
        },
    ],
};
