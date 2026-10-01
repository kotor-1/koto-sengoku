/**
 * 戦場「寺社周辺」（temple）。高い境内の二つの要所（山門と本堂前）を、同時に 1 分確保する（第3群の最初の案）。
 * 宗教施設だから特別な力が働く仕組みは無い。高低差・入口・建物の陰を使う架空の戦場として扱う。
 *
 * - 400 m × 440 m。境内（x -150〜150・z -200〜-40）は一段高い台地（四角の丘・高さ 8 m）。台地の縁は崖（通れない）で、入口は 3 つ：
 *   - 正面の石段（x -12〜12。南の縁の真ん中）：真っすぐ山門へ上がる。狭い（同じ相手へ斬りかかれるのは 1 部隊まで）。上から射られる。
 *   - 東の脇道（台地の東の縁の z -150〜-134）：南東から道で回る。遠いが速い。
 *   - 林側の入口（台地の西の縁の z -110〜-94）：西の林を抜けて入る。林は遅いが、中の部隊は見つかりにくい。
 * - 山門（石段の上。守る輪 (0,-62)、半径 18 m）と本堂前（守る輪 (40,-150)、半径 20 m）は 100 m ほど離れている。
 *   両脇の門の建物・鐘楼・庫裏・本堂・塔（building）は通れず、矢も通さない（建物の陰に入ると射られない）。
 * - 高所：下から攻め上がる相手の損害 ×0.7、台地の弓の射程 +15 m。
 * - 敵勢：山門の槍（450）・本堂前の槍（400）・山門の西の弓（220）・本堂の東の弓（200）・東の脇道の口の槍（300）・本陣の騎馬（250）・
 *   西の本陣。240 秒に、北から押し返しの槍（400）が山門へ下ってくる。
 * - 主目標：山門と本堂前を、どちらも敵のいない状態で味方が占め、同時に 60 秒確保する（どちらか外れると 0 から）。
 *   副目標：損害を 3 割以内に抑える・本陣の騎馬を崩す。
 *
 * 成り立たせたい作戦（設計 §4。釣り合いは後の担当）：
 * - 正面の石段を準備して登る（弓で山門を射てから、忠勝隊を先頭に。予備で後から押す）。
 * - 脇道と林側から分けて入る（遠いが、石段の上の弓・狭い正面を避ける）。本堂前を先に取り、山門は後ろから。
 * - 一方へ集中するだけでは、もう一方の輪が手薄になり、同時の確保が数えられない（押し返しの槍に山門を奪われる）。
 */
import type { BattlefieldDef } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const GATE_ZONE = { circle: { cx: 0, cz: -62, r: 18 } };
const HALL_ZONE = { circle: { cx: 40, cz: -150, r: 20 } };
const bldg = (x0: number, x1: number, z0: number, z1: number, height = 7): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height });

export const TEMPLE: BattlefieldDef = {
    id: 'temple',
    name: '寺社周辺',
    kind: 'temple',
    summary: '高い境内の山門と本堂前を同時に確保する。正面の石段・東の脇道・林側の入口。一方だけに集めると、もう一方が手薄になる',
    width: 400,
    depth: 440,
    terrain: [
        // 境内の台地
        { kind: 'hill', rect: { x0: -150, x1: 150, z0: -200, z1: -40 }, height: 8 },
        // 台地の縁の崖（南の縁は石段 x -12〜12 を残す。東は脇道 z -150〜-134、西は林側の入口 z -110〜-94 を残す）
        { kind: 'cliff', rect: { x0: -156, x1: -12, z0: -46, z1: -34 } },
        { kind: 'cliff', rect: { x0: 12, x1: 156, z0: -46, z1: -34 } },
        { kind: 'cliff', rect: { x0: 150, x1: 162, z0: -200, z1: -150 } },
        { kind: 'cliff', rect: { x0: 150, x1: 162, z0: -134, z1: -34 } },
        { kind: 'cliff', rect: { x0: -162, x1: -150, z0: -200, z1: -110 } },
        { kind: 'cliff', rect: { x0: -162, x1: -150, z0: -94, z1: -34 } },
        // 境内の北の端（裏山。通れない）
        { kind: 'cliff', rect: { x0: -200, x1: 200, z0: -220, z1: -204 } },
        // 山門の両脇の門の建物・鐘楼・庫裏・本堂・塔
        bldg(-44, -16, -58, -48, 7),
        bldg(16, 44, -58, -48, 7),
        bldg(-72, -56, -108, -92, 9),
        bldg(-120, -80, -175, -145, 7),
        bldg(10, 70, -196, -176, 10),
        bldg(90, 106, -100, -84, 12),
        // 石段（道）と、脇道（南東から台地の東へ回る道）
        { kind: 'road', rect: { x0: -8, x1: 8, z0: -48, z1: 220 } },
        { kind: 'road', rect: { x0: 168, x1: 180, z0: -150, z1: 220 } },
        { kind: 'road', rect: { x0: 150, x1: 180, z0: -150, z1: -134 } },
        // 西の林（林側の入口へ）
        { kind: 'woods', rect: { x0: -200, x1: -162, z0: -200, z1: 40 } },
        { kind: 'woods', rect: { x0: -162, x1: -100, z0: -30, z1: 40 } },
    ],
    highGround: { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 15 },
    // 石段：同じ相手へ斬りかかれるのは 1 部隊まで
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -14, x1: 14, z0: -50, z1: -24 } }, maxEngaged: 1 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 120, facing: N, note: '石段の下' },
            { id: 'left', x: -90, z: 130, facing: N, note: '左（林側）' },
            { id: 'right', x: 90, z: 130, facing: N, note: '右（脇道側）' },
            { id: 'archers', x: -30, z: 145, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 150, facing: N, note: '予備' },
            { id: 'flank', x: 150, z: 165, facing: N, note: '右の外（騎馬・脇道の下）' },
        ],
        enemy: [
            { id: 'hq', x: -100, z: -125, facing: S, note: '本陣（境内の西）' },
            { id: 'gate', x: 0, z: -66, facing: S, note: '山門の槍' },
            { id: 'hall', x: 40, z: -150, facing: S, note: '本堂前の槍' },
            { id: 'yumi_gate', x: -35, z: -75, facing: S, note: '山門の西の弓（石段を射る）' },
            { id: 'yumi_hall', x: 80, z: -125, facing: S, note: '本堂の東の弓' },
            { id: 'side', x: 125, z: -142, facing: S, note: '東の脇道の口の槍' },
            { id: 'kiba', x: -60, z: -175, facing: S, note: '本陣の騎馬' },
        ],
    },
    reinforcements: [{ id: 'counter', side: 'enemy', at: 240, point: { x: 0, z: -195, facing: S }, label: '押し返しの槍（北から山門へ）' }],
    exits: { ally: { x: 0, z: 220 }, enemy: { x: -100, z: -195 } },
    objectives: {
        primary: { id: 'temple_hold', type: 'hold_zones', label: '山門と本堂前を同時に 60 秒確保する', zones: [GATE_ZONE, HALL_ZONE], sec: 60, mode: 'all', names: ['山門', '本堂前'] },
        secondary: [
            { id: 'temple_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'temple_kiba', type: 'break_unit', label: '本陣の騎馬を崩す', unitId: 'e_kiba' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。高い境内（高さ 8 m の台地）の二つの要所、山門と本堂前を取る。境内の縁は崖で、入口は 3 つ。',
        '正面の石段：山門へ真っすぐ上がる。狭く、同じ相手へ斬りかかれるのは 1 部隊まで。下から攻め上がる相手の損害 ×0.7、境内の弓は射程 +15 m。',
        '東の脇道：南東から道で回り、境内の東の口へ。遠いが速い。林側の入口：西の林を抜けて境内の西の口へ。林は遅いが見つかりにくい。',
        '門・堂・塔などの建物は通れず、矢も通さない。建物の陰に入ると射られない。',
        '敵勢は山門・本堂前・東の脇道の口に槍、山門の西と本堂の東に弓、西に本陣と騎馬。4 分に、北から押し返しの槍が山門へ下ってくる。',
        '勝利：山門と本堂前の両方を、敵のいない状態で味方が占め、同時に 60 秒確保する（どちらかが外れると 0 から数え直す）。',
        '副目標：味方の兵の損害を 3 割以内に抑える・本陣の騎馬を崩す。',
    ],
    tactics: [
        '正面の石段を準備して登る：弓で山門の槍と弓を射てから、忠勝隊を先頭に登り、予備で後から押す',
        '脇道と林側から分けて入る：騎馬・酒井隊は東の脇道から本堂前へ、別の隊は林を抜けて西の口から山門の後ろへ',
        '一方へ集めるだけにしない：山門だけを取っても本堂前が数えられない。押し返しの槍（4 分）に備えて、山門にも 1 隊残す',
    ],
    presets: [
        {
            id: 'standard',
            name: '境内の二所',
            summary: '味方 7／敵 8（押し返し 1 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('right'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('left'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_gate', 'yari', '敵勢の山門の槍', 450, 82, 'gate', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -62, r: 18 } }),
                E('e_hall', 'yari', '敵勢の本堂前の槍', 400, 80, 'hall', { aiRole: 'hold_zone', aiTarget: { x: 40, z: -150, r: 20 } }),
                E('e_yumi_gate', 'yumi', '敵勢の山門の弓', 220, 70, 'yumi_gate', { aiRole: 'hold_line' }),
                E('e_yumi_hall', 'yumi', '敵勢の本堂の弓', 200, 70, 'yumi_hall', { aiRole: 'hold_line' }),
                E('e_side', 'yari', '敵勢の脇道の口の槍', 300, 75, 'side', { aiRole: 'hold_zone', aiTarget: { x: 125, z: -142, r: 15 } }),
                E('e_kiba', 'kiba', '敵勢の本陣の騎馬', 250, 80, 'kiba', { aiRole: 'reserve' }),
                { ...E('e_counter', 'yari', '敵勢の押し返しの槍', 400, 80, '', { aiRole: 'assault', aiTarget: { x: 0, z: -62, r: 18 } }), slot: undefined, reinforcement: 'counter' },
            ],
        },
    ],
};
