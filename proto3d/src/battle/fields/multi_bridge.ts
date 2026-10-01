/**
 * 戦場「複数橋」（multi_bridge）。深い川に橋が 3 本。北から敵勢が渡ってくるのを、南の岸で一定時間しのぐ（守る側）。
 *
 * - 440 m × 360 m。東西に流れる深い川（z -25〜5、幅 30 m）。橋は西（x -150）・中（x 0）・東（x 150）の 3 本（幅 16 m）。
 *   どの橋も、橋の上と南の口（z -30〜50）は狭い正面：同じ相手へ斬りかかれるのは 1 部隊まで。南の口で受ければ、少ない兵でも一隊ずつ相手にできる。
 * - 敵勢の主力（槍 2・騎馬・弓）は北東に集まり、東の橋を渡って味方の本陣へ攻め込む（assault）。西と中には少ない隊が来る（陽動）。
 *   90 秒で二番手（槍 2）が北の中ほどに着き、本陣を目指す。
 * - 味方は 3 本の橋の南に 1 隊ずつ・弓・予備・本陣で始まる（均等に置いたまま）。
 * - 主目標：300 秒しのぐ（本陣の区域（中心 (0,135)、半径 40 m）を敵だけが 12 秒続けて占めると負け。橋を失っても、それだけでは負けない）。
 * - 副目標：東の橋の南の口を守り抜く（敵だけが 10 秒続けて占めると失う）・損害を 4 割以内に抑える。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4）：
 * - 敵の主力が東へ集まるのを見て、中の隊と予備を東の橋の南の口へ寄せる。西・中は 1 隊ずつで受ける（狭い正面で一隊ずつ）。
 * - 抜かれた橋があれば、予備（石川隊）と騎馬で穴を埋める。
 * - 全部の橋に均等に置いたままにすると、東の橋の隊が主力に押し切られ、本陣へ攻め込まれる。
 *
 * 武将との相性：酒井の両翼の采配は、橋を抜けてきた敵を 2 方向から挟むときに生きる。石川の後詰めの差配は、予備を抜かれた橋へ素早く回す。
 *
 * 最初の案（第2群の 5 戦場の制作。動いて決着がつくこと・作戦で結果が変わることまで。釣り合いは後で整える）。
 */
import type { BattlefieldDef } from './types';
import type { Zone } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const bridgeZone = (x: number): Zone => ({ rect: { x0: x - 14, x1: x + 14, z0: -30, z1: 50 } });
/** 味方の本陣へ攻め込む先 */
const HQ_AIM = { x: 0, z: 135, r: 30 };

export const MULTI_BRIDGE: BattlefieldDef = {
    id: 'multi_bridge',
    name: '複数橋',
    kind: 'multi_bridge',
    summary: '橋が 3 本。敵の主力が渡る橋を見て、主力をそこへ寄せてしのぐ',
    width: 440,
    depth: 360,
    terrain: [
        { kind: 'river', rect: { x0: -220, x1: 220, z0: -25, z1: 5 } },
        { kind: 'bridge', rect: { x0: -158, x1: -142, z0: -29, z1: 9 } },
        { kind: 'bridge', rect: { x0: -8, x1: 8, z0: -29, z1: 9 } },
        { kind: 'bridge', rect: { x0: 142, x1: 158, z0: -29, z1: 9 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: 9, z1: 180 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -180, z1: -29 } },
        { kind: 'woods', rect: { x0: -220, x1: -150, z0: 90, z1: 180 } },
        { kind: 'hill', circle: { cx: 0, cz: 140, r: 45 }, height: 5 },
    ],
    specialRules: [
        { type: 'narrow_frontage', zone: bridgeZone(-150), maxEngaged: 1 },
        { type: 'narrow_frontage', zone: bridgeZone(0), maxEngaged: 1 },
        { type: 'narrow_frontage', zone: bridgeZone(150), maxEngaged: 1 },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 140, facing: N, note: '本陣' },
            { id: 'west', x: -150, z: 40, facing: N, note: '西の橋の南' },
            { id: 'center', x: 0, z: 40, facing: N, note: '中の橋の南' },
            { id: 'east', x: 150, z: 40, facing: N, note: '東の橋の南' },
            { id: 'archers', x: 40, z: 60, facing: N, note: '弓' },
            { id: 'reserve', x: 0, z: 95, facing: N, note: '予備' },
            { id: 'cavalry', x: -70, z: 100, facing: N, note: '騎馬' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -160, facing: S, note: '本陣' },
            { id: 'main1', x: 160, z: -110, facing: S, note: '主力（東）' },
            { id: 'main2', x: 195, z: -95, facing: S, note: '主力（東）' },
            { id: 'main3', x: 185, z: -135, facing: S, note: '主力の騎馬（東）' },
            { id: 'main4', x: 120, z: -80, facing: S, note: '主力の弓（東）' },
            { id: 'west', x: -160, z: -90, facing: S, note: '西の陽動' },
            { id: 'center', x: 0, z: -90, facing: S, note: '中の陽動' },
            { id: 'center_yumi', x: -40, z: -80, facing: S, note: '中の弓' },
            { id: 'second1', x: 70, z: -150, facing: S, note: '二番手' },
            { id: 'second2', x: -70, z: -150, facing: S, note: '二番手' },
        ],
    },
    exits: { ally: { x: 0, z: 180 }, enemy: { x: 0, z: -180 } },
    objectives: {
        primary: { id: 'mb_defend', type: 'defend_time', label: '300 秒しのぐ（本陣の区域を守る）', sec: 300, zone: { circle: { cx: 0, cz: 135, r: 40 } }, loseSec: 12 },
        secondary: [
            { id: 'mb_east', type: 'defend_time', label: '東の橋の南の口を守り抜く', sec: 300, zone: { circle: { cx: 150, cz: 30, r: 25 } }, loseSec: 10 },
            { id: 'mb_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
        ],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 300,
    briefing: [
        'ゲーム用の演習（架空の相手）。東西に流れる深い川に、橋が 3 本（西・中・東）。川は渡れない。',
        '狭い正面：どの橋も、橋の上と南の口では、同じ相手へ斬りかかれるのは 1 部隊まで。南の口で受ければ一隊ずつ相手にできる。',
        '敵勢は北から渡ってくる。主力がどの橋へ向かうかは、北の岸の集まり方で分かる。90 秒で二番手が北に着く。',
        '勝利：300 秒しのぐ。本陣の区域を敵だけが 12 秒続けて占めると負け（橋を 1 本失っても、それだけでは負けない）。',
        '副目標：東の橋の南の口を守り抜く・味方の兵の損害を 4 割以内に抑える。',
    ],
    tactics: [
        '敵の主力が集まる橋を見て、中の隊と予備をその橋の南の口へ寄せる。ほかの橋は 1 隊ずつで受ける',
        '橋を抜けてきた敵は、二隊で挟む（酒井の両翼の采配）。抜かれた橋へは予備を回す（石川の後詰めの差配で足を速める）',
        '全部の橋に均等に置いたままにしない（主力の来る橋が押し切られ、本陣へ攻め込まれる）',
    ],
    presets: [
        {
            id: 'standard',
            name: '三つ橋の守り',
            summary: '味方 7／敵 10。家康・本多忠勝・榊原康政・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakai('west'),
                T.sakakibara('east'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('cavalry'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_main1', 'yari', '敵勢の主力（一）', 450, 80, 'main1', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 15 }),
                E('e_main2', 'yari', '敵勢の主力（二）', 420, 80, 'main2', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 25 }),
                E('e_main_kiba', 'kiba', '敵勢の主力の騎馬', 250, 80, 'main3', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 35 }),
                E('e_main_yumi', 'yumi', '敵勢の主力の弓', 200, 75, 'main4', { aiRole: 'assault', aiTarget: { x: 150, z: -40, r: 20 } }),
                E('e_west', 'yari', '敵勢の西の隊', 300, 70, 'west', { aiRole: 'assault', aiTarget: { x: -150, z: 45, r: 30 }, arriveAt: 20 }),
                E('e_center', 'yari', '敵勢の中の隊', 300, 70, 'center', { aiRole: 'assault', aiTarget: { x: 0, z: 45, r: 30 }, arriveAt: 30 }),
                E('e_center_yumi', 'yumi', '敵勢の中の弓', 200, 70, 'center_yumi', { aiRole: 'hold_line' }),
                E('e_second1', 'yari', '敵勢の二番手（東）', 300, 75, 'second1', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 90 }),
                E('e_second2', 'yari', '敵勢の二番手（西）', 300, 75, 'second2', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 90 }),
            ],
        },
    ],
};
