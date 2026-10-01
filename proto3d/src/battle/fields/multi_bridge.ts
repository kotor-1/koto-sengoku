/**
 * 戦場「複数橋」（multi_bridge）。深い川に橋が 3 本。北から敵勢が渡ってくるのを、南の岸で一定時間しのぐ（守る側）。
 *
 * - 440 m × 360 m。東西に流れる深い川（z -25〜5、幅 30 m）。橋は西（x -150）・中（x 0）・東（x 150）の 3 本（幅 16 m。橋と橋の間は 150 m）。
 *   どの橋も、橋の上と南の口（z -30〜50）は狭い正面：同じ相手へ斬りかかれるのは 1 部隊まで。南の口で受ければ、少ない兵でも一隊ずつ相手にできる。
 * - 敵勢の主力（槍 2・騎馬・弓）は北東に集まり、東の橋を渡って味方の本陣へ攻め込む（assault）。西と中には 1 隊ずつ（陽動）と、中の弓（北の岸）。
 *   主力の弓は東の橋の北の口の東（185,-45）の岸から南の口を射る（橋の北の口の上に立つと、後から渡る主力の槍の道を塞いでしまうため、口から外す）。
 *   90 秒で二番手（槍 2）が北の中ほどに着き、中の橋を渡って本陣を目指す。
 * - 味方は 3 本の橋の南に 1 隊ずつ・弓・予備・騎馬・本陣で始まる（均等に置いたまま）。退き口は本陣の南西（-60,180）。
 * - 主目標：300 秒しのぐ（本陣の区域（中心 (0,135)、半径 40 m）を敵だけが 12 秒続けて占めると負け。橋を失っても、それだけでは負けない）。
 * - 副目標：3 本の橋のうち 2 本以上を最後まで守る（目標の種類 defend_zones。橋の南の口（中心 (x,38)、半径 28 m）を橋ごとに見て、
 *   敵だけが 10 秒続けて占めるとその橋を失う。失っていない橋が 2 本より少なくなると果たせない。見通しに橋ごとの ○・✕ が出る）。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4。tests/proto3d-field-multi_bridge.test.ts の台本）：
 * - 20 秒ごろ、敵の主力が東へ集まるのを見て、中の忠勝隊と弓を東の橋の南の口へ寄せ、予備の石川隊で中の橋の口を埋める。
 *   東の口では忠勝隊・榊原隊が一隊ずつ受け、弓が後ろから射る。西は酒井隊 1 隊で陽動を受ける。
 * - 西が片付いたら（95 秒ごろ）酒井隊を中へ回し、90 秒に着く二番手を中の口で受ける（騎馬は中の後ろの予備）。家康の号令で中を支える。
 * - 中の口で踏みとどまる石川隊の後詰めの差配は、150 m 先の東の口の忠勝隊に届く（動けない代償は、口を守るだけなら痛くない）。
 * - 全部の橋に均等に置いたままにすると、東の橋の隊が主力に押し切られ、本陣へ攻め込まれて負ける。
 *   全部隊で東へ寄せる・橋を渡って攻める・本陣の周りに固める（早く下がる）のも負ける。
 *
 * 武将との相性（地形で能力の値打ちが変わる）：
 * - 酒井の両翼の采配は、橋の口（狭い正面）では 2 部隊目が斬りかかれず包囲にならないので効かない。橋を抜けてきた敵を南の岸の開けた所で挟むときに効く。
 * - 石川の後詰めの差配は、中の口からなら東西どちらの橋の口にも届く（半径 180 m）。抜かれかけた橋の隊を支えるのに使う。
 */
import type { BattlefieldDef } from './types';
import type { Zone } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const bridgeZone = (x: number): Zone => ({ rect: { x0: x - 14, x1: x + 14, z0: -30, z1: 50 } });
/** 橋の南の口（副目標の区域。口で受ける隊が中に入る） */
const MOUTH = (x: number): Zone => ({ circle: { cx: x, cz: 38, r: 28 } });
/** 味方の本陣へ攻め込む先 */
const HQ_AIM = { x: 0, z: 135, r: 30 };

export const MULTI_BRIDGE: BattlefieldDef = {
    id: 'multi_bridge',
    name: '複数橋',
    kind: 'multi_bridge',
    summary: '橋が 3 本。敵の主力が渡る橋を見て、主力をそこへ寄せ、予備で穴を埋めてしのぐ',
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
    // 味方の退き口は本陣の南西（真南だと、本陣の丘の名札と地図の上で重なる）
    exits: { ally: { x: -60, z: 180 }, enemy: { x: 0, z: -180 } },
    objectives: {
        primary: { id: 'mb_defend', type: 'defend_time', label: '300 秒しのぐ（本陣の区域を守る）', sec: 300, zone: { circle: { cx: 0, cz: 135, r: 40 } }, loseSec: 12 },
        // 3 本の橋のうち 2 本以上を最後まで守る（橋ごとに南の口を見る。1 つの副目標として記録する）
        secondary: [
            {
                id: 'mb_bridges',
                type: 'defend_zones',
                label: '3 本の橋のうち 2 本以上を最後まで守る',
                sec: 300,
                zones: [MOUTH(-150), MOUTH(0), MOUTH(150)],
                names: ['西の橋の口', '中の橋の口', '東の橋の口'],
                minHeld: 2,
                loseSec: 10,
            },
        ],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 300,
    briefing: [
        'ゲーム用の演習（架空の相手）。東西に流れる深い川に、橋が 3 本（西・中・東。間は 150 m）。川は渡れない。',
        '狭い正面：どの橋も、橋の上と南の口では、同じ相手へ斬りかかれるのは 1 部隊まで。南の口で受ければ一隊ずつ相手にできる（味方も 2 隊で挟めない）。',
        '敵勢は北から渡ってくる。主力がどの橋へ向かうかは、北の岸の集まり方で分かる。90 秒で二番手が北の中ほどに着く。',
        '勝利：300 秒しのぐ。本陣の区域を敵だけが 12 秒続けて占めると負け（橋を 1 本失っても、それだけでは負けない）。',
        '副目標：3 本の橋のうち 2 本以上を最後まで守る（橋の南の口を敵だけに 10 秒続けて占められると、その橋を失う）。',
    ],
    tactics: [
        '敵の主力が集まる橋を見て、中の隊と弓をその橋の南の口へ寄せ、空いた中の口は予備で埋める。ほかの橋は 1 隊ずつで受ける',
        '西が片付いたら、その隊を二番手の来る中の口へ回す。抜かれかけた橋の隊は、中の口の石川隊の後詰めの差配で支える（150 m 先の橋まで届く）',
        '酒井の両翼の采配は、狭い橋の口では挟めないので効かない。橋を抜けてきた敵を南の岸の開けた所で挟むときに使う',
        '全部の橋に均等に置いたままにしない（主力の来る橋が押し切られ、本陣へ攻め込まれる）。橋を渡って攻めかからない',
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
                E('e_main_yumi', 'yumi', '敵勢の主力の弓', 200, 75, 'main4', { aiRole: 'assault', aiTarget: { x: 185, z: -45, r: 15 } }),
                E('e_west', 'yari', '敵勢の西の隊', 300, 70, 'west', { aiRole: 'assault', aiTarget: { x: -150, z: 45, r: 30 }, arriveAt: 20 }),
                E('e_center', 'yari', '敵勢の中の隊', 300, 70, 'center', { aiRole: 'assault', aiTarget: { x: 0, z: 45, r: 30 }, arriveAt: 30 }),
                E('e_center_yumi', 'yumi', '敵勢の中の弓', 200, 70, 'center_yumi', { aiRole: 'hold_line' }),
                E('e_second1', 'yari', '敵勢の二番手（東）', 300, 75, 'second1', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 90 }),
                E('e_second2', 'yari', '敵勢の二番手（西）', 300, 75, 'second2', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 90 }),
            ],
        },
    ],
};
