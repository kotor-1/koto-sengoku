/**
 * 戦場「尾根」（ridge）。東西に細長い高地（尾根）を奪い合う。尾根の上は守りと見通しに利がある。
 *
 * - 400 m × 400 m。尾根はカプセルの丘（線分 (-120,-60)〜(120,-60)、幅 60 m、高さ 16 m。線分の上がいちばん高く、60 m 離れると平地）。
 * - 尾根の南の面（正面）は急坂：丘の中の動き ×0.6。正面の真ん中（x -16〜16）だけが登れる狭い急坂で、その左右は崖（通れない）。
 *   正面の急坂（x -24〜24、z -40〜6）は狭い正面：同じ相手へ斬りかかれるのは 1 部隊まで。
 * - 尾根の両端の西（x -170〜-160）と東（x 160〜170）に、北の平地から南の平地まで登り道（道。動き ×1.2）。登り道から尾根の上へ横から入れる。
 * - 高所：下から正面に来る相手の損害 ×0.6、尾根の上の弓の射程 +25 m、見通し +40 m。
 * - 敵勢は尾根の頂（中央）に槍 2 と弓、尾根の東西の肩に 1 隊ずつ、北の麓に騎馬（後詰め）と本陣。
 * - 主目標：尾根の頂（中心 (0,-60)、半径 30 m）を 90 秒確保する。副目標：敵勢の弓隊を崩す・損害を 4 割以内に抑える。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4）：
 * - 西（または東）の登り道から尾根に登り、肩の隊を破って尾根の上を横から頂へ進む（同じ高さで当たるので、高所の守りが効かない）。
 *   正面の隊は麓で構えて、頂の守りを引きつけておく。
 * - 正面の急坂を登って頂へ当たると、高所の守りで損害が減らされ、坂の上の弓に射られて負ける。
 *
 * 武将との相性：酒井の両翼の采配は、尾根の上（横）と下（正面）から頂の守りを挟むときに効く。榊原の先駆けの号は側面の登り道を急ぐ。
 *
 * 最初の案（第2群の 5 戦場の制作。動いて決着がつくこと・作戦で結果が変わることまで。釣り合いは後で整える）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 尾根の頂（主目標の区域・頂の守りの区域） */
const SUMMIT = { x: 0, z: -60 };

export const RIDGE: BattlefieldDef = {
    id: 'ridge',
    name: '尾根',
    kind: 'ridge',
    summary: '細長い尾根を奪い合う。正面の急坂を避け、側面の登り道から尾根の上を横に進んで頂を取る',
    width: 400,
    depth: 400,
    terrain: [
        { kind: 'hill', capsule: { ax: -120, az: -60, bx: 120, bz: -60, r: 60 }, height: 16 },
        // 南の面の崖（正面の真ん中の急坂だけ登れる）
        { kind: 'cliff', rect: { x0: -150, x1: -16, z0: -24, z1: -8 } },
        { kind: 'cliff', rect: { x0: 16, x1: 150, z0: -24, z1: -8 } },
        // 両端の登り道（北の平地から南の平地まで）
        { kind: 'road', rect: { x0: -170, x1: -160, z0: -200, z1: 200 } },
        { kind: 'road', rect: { x0: 160, x1: 170, z0: -200, z1: 200 } },
        { kind: 'woods', rect: { x0: -200, x1: -175, z0: 40, z1: 140 } },
    ],
    terrainRules: {
        // 尾根の面は急坂：丘の中の動き ×0.6（登り道（道）は道が先に当たるので速い）
        hill: { speed: 0.6 },
    },
    highGround: { defenseVsLower: 0.6, minDiff: 2, rangeBonus: 25, sightBonus: 40 },
    // 正面の急坂（崖の切れ目）は狭い：同じ相手へ斬りかかれるのは 1 部隊まで
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -24, x1: 24, z0: -40, z1: 6 } }, maxEngaged: 1 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 165, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 85, facing: N, note: '正面（頂の弓の届く所の外）' },
            { id: 'left', x: -80, z: 85, facing: N, note: '左' },
            { id: 'right', x: 80, z: 85, facing: N, note: '右' },
            { id: 'archers', x: 30, z: 110, facing: N, note: '弓' },
            { id: 'reserve', x: 0, z: 130, facing: N, note: '後詰め' },
            { id: 'flank', x: -140, z: 100, facing: N, note: '左の外（西の登り道の近く）' },
        ],
        enemy: [
            { id: 'hq', x: 30, z: -170, facing: S, note: '本陣（北の麓）' },
            { id: 'summit_w', x: -18, z: -52, facing: S, note: '頂の守り（西）' },
            { id: 'summit_e', x: 18, z: -52, facing: S, note: '頂の守り（東）' },
            { id: 'archers', x: 0, z: -72, facing: S, note: '頂の弓' },
            { id: 'shoulder_w', x: -100, z: -60, facing: S, note: '西の肩' },
            { id: 'shoulder_e', x: 100, z: -60, facing: S, note: '東の肩' },
            { id: 'cavalry', x: 80, z: -160, facing: S, note: '騎馬（北の麓の後詰め）' },
        ],
    },
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: { id: 'ridge_summit', type: 'hold_point', label: '尾根の頂を確保する', zone: { circle: { cx: SUMMIT.x, cz: SUMMIT.z, r: 30 } }, sec: 90 },
        secondary: [
            { id: 'ridge_archers', type: 'break_unit', label: '頂の弓隊を崩す', unitId: 'e_yumi' },
            { id: 'ridge_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
        ],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 540,
    briefing: [
        'ゲーム用の演習（架空の相手）。東西に細長い尾根（高さ 16 m）。尾根の上は、下から攻める相手の損害 ×0.6、弓の射程 +25 m、見通し +40 m。',
        '尾根の南の面は急坂（動き ×0.6）。正面の真ん中の狭い切れ目だけが登れて、その左右は崖。切れ目は狭い正面（同じ相手へ斬りかかれるのは 1 部隊まで）。尾根の両端に、北から南まで通る登り道がある。',
        '敵勢は頂に槍 2 隊と弓、尾根の東西の肩に 1 隊ずつ。北の麓に騎馬と本陣。',
        '勝利：尾根の頂を 90 秒確保する（輪の中に敵がいない間、味方がいれば数える）。敵勢の部隊をすべて崩しても勝ち。',
        '副目標：頂の弓隊を崩す・味方の兵の損害を 4 割以内に抑える。',
    ],
    tactics: [
        '西の登り道から尾根に登り、肩の隊を破ってから、尾根の上を横に進んで頂へ当たる（同じ高さなので高所の守りが効かない）',
        '正面の隊は急坂の下で構えて、頂の守りを引きつけておく。横から当たった隊と同時に正面からも当たると挟める（酒井の両翼の采配）',
        '正面の急坂を登って頂へ当たらない（高所の守りで損害が減らされ、坂の上の弓に射られる）',
    ],
    presets: [
        {
            id: 'standard',
            name: '尾根攻めの七隊',
            summary: '味方 7／敵 7。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('right'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_summit_w', 'yari', '敵勢の頂の守り（西）', 350, 80, 'summit_w', { aiRole: 'hold_zone', aiTarget: { x: SUMMIT.x, z: SUMMIT.z, r: 35 } }),
                E('e_summit_e', 'yari', '敵勢の頂の守り（東）', 350, 80, 'summit_e', { aiRole: 'hold_zone', aiTarget: { x: SUMMIT.x, z: SUMMIT.z, r: 35 } }),
                E('e_yumi', 'yumi', '敵勢の頂の弓', 230, 75, 'archers', { aiRole: 'hold_line' }),
                E('e_shoulder_w', 'yari', '敵勢の西の肩', 250, 70, 'shoulder_w', { aiRole: 'hold_zone', aiTarget: { x: -100, z: -60, r: 35 } }),
                E('e_shoulder_e', 'yari', '敵勢の東の肩', 250, 70, 'shoulder_e', { aiRole: 'hold_zone', aiTarget: { x: 100, z: -60, r: 35 } }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'cavalry', { aiRole: 'reserve' }),
            ],
        },
    ],
};
