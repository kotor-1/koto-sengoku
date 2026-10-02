/**
 * 戦場「城下町外縁」（town_edge）。北の野から城下町の 3 つの出口へ向かう敵勢の突破を、7 分まで 2 部隊以内に抑える（第3群）。
 *
 * - 440 m × 400 m。城下町は z 40〜200（南）。北（z 40 より北）は野で、敵勢が来る。町の東西の端は家並み（町の外を回る道は無い）。
 *   家屋・塀（building・wall）は通れず、射線も遮る。縁はどれも 5 m の格子の線にそろえる（格子と形がずれると、通れない升に体が入って止まる）。
 * - 町の道（北から入る口は 3 つ）：
 *   - 西の脇道（x -145〜-135。幅 10 m）：北の口から南へ下り、裏通りへ折れる。細いので、口では 1 部隊ずつしか当たれない。
 *   - 大通り（x -15〜15。幅 30 m）：北の口から南の端の大通りの出口まで真っすぐ。
 *   - 東の道（x 130〜150。幅 20 m）：南の手前（z 140〜150）が塀で狭まった門口（幅 10 m）。門口を抜けて裏通りへ折れる。
 *   - 横道（z 95〜110）：3 本の道を町の真ん中でつなぐ（守りを組み替える近道）。大通りとの辻が「辻の市」。
 *   - 裏通り（z 170〜180）：町の南の端の東西の通り。西の脇道・大通り・東の道の南の端をつなぎ、東西の端で町の外へ抜ける。
 * - 出口：西の脇道の出口（裏通りの西の端）・大通りの出口（大通りの南の端）・東の門口の出口（裏通りの東の端）。3 つは 200 m 以上離れる。
 *   味方の退き口は裏通りの西の端（出口の名札と味方の退き口の名札を重ねないため。大通りの南の端に置くと重なった）。
 * - 敵勢（同時に戦場にいるのは 10 部隊。上限 10）：
 *   - 本陣・押さえ（槍 450）・弓（180）が北の野の真ん中に陣取る（動かない。近づいた相手に当たる・射る）。
 *   - 攻め手 7 隊が時間差で援軍として現れ、決まった出口（または市）へ攻め進む（aiRole 'assault'。途中で 60 m 以内の相手に当たる）。
 *     西の林 (-180,-185) から：10 秒 槍 320（西の口へ）・3 分 10 秒 槍 380 と 3 分 50 秒 騎馬 300（西の口へ。ほぼ同時に着く二つ目の波）。
 *     東の林 (180,-185) から：10 秒 槍 350（大通りの出口へ）・1 分 40 秒 槍 360 と 2 分 20 秒 騎馬 300（東の口へ。ほぼ同時に着く）。
 *     敵勢の本陣の前 (30,-185) から：4 分 10 秒 槍 320（辻の市を荒らしに来る。市に着くと居座る）。
 *     林の中は 60 m まで近づかないと見えない。攻め手は林を出てから町の口まで 30〜40 秒、そこから出口まで 50〜60 秒。
 * - 突破：敵の戦える部隊が出口の区域に入ると、その部隊は町を抜けて戦場を離れ、1 と数える（部隊単位。兵の人数では数えない）。
 * - 主目標：7 分（420 秒）まで突破を 2 部隊以内に抑える（3 部隊目が抜けたら負け）。攻め手がすべて抜けたか崩れたら、その時に果たす。
 *   副目標：損害を 3 割以内・辻の市を荒らさせない（敵だけが 10 秒続けて市を占めると失う）・野の敵勢の弓を崩す。
 *
 * 成り立つ作戦と違い（数字は tests/proto3d-field-town_edge.test.ts。どれも早送りの台本）：
 * - 辻で挟み、波を見て弓を回す（進路を見て組み替える）：西と東の脇道が横道に出る辻で、横道の部隊と脇道の南の部隊が二方向から挟む。
 *   東の二つ目の波が見えたら弓を東の辻へ、西の波の前に西の辻へ回す。損害が少なく、突破もほとんど許さず、市も守る。
 * - 出口の前で受ける：裏通りの西の端・東の端と大通りの南で待つ（出口へ向かって折れてくる敵を、出口の手前で受ける）。命令は少ないが、
 *   東の二隊（槍と騎馬）を榊原隊・騎馬隊だけで受けて抜けられ、許容（2）を使い切る。市も荒らされる。
 * - 準備した正面攻撃（野へ打って出る）：弓で押さえを射すくめ、榊原の先駆けで野の弓を崩してから、町の辻へ戻る。野の弓は崩せるが、
 *   損害が大きく（4 割前後）、東へ戻るのが遅れて許容を使い切る。
 * - 大通りに集中する・待つ：脇道・門口から 3 部隊抜けて負ける。無計画（全部隊で一番近い敵へ）：野へ散って、脇道から抜けられて負ける。
 * - 酒井の両翼の采配：辻で二方向から挟むと効く（西の二つ目の波の損害が減り、早く崩せる）。脇道の口（幅 10 m）では正面の 1 対 1 だけで効かない。
 */
import type { BattlefieldDef, PresetUnit } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const house = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height: 6 });

/** 出口（大通りの南の端と、裏通りの西の端・東の端） */
const EXIT_MAIN = { rect: { x0: -15, x1: 15, z0: 185, z1: 200 } };
const EXIT_WEST = { rect: { x0: -220, x1: -205, z0: 170, z1: 180 } };
const EXIT_EAST = { rect: { x0: 205, x1: 220, z0: 170, z1: 180 } };

/** 出口（または市）へ攻め進む攻め手（援軍として時間差で現れる） */
const raider = (id: string, kind: 'yari' | 'kiba' | 'yumi', name: string, strength: number, reinf: string, aim: { x: number; z: number; r?: number }): PresetUnit => ({
    ...E(id, kind, name, strength, 80, '', { aiRole: 'assault', aiTarget: { x: aim.x, z: aim.z, r: aim.r ?? 10 } }),
    slot: undefined,
    reinforcement: reinf,
});
const AIM_MAIN = { x: 0, z: 193 };
const AIM_WEST = { x: -213, z: 175 };
const AIM_EAST = { x: 213, z: 175 };
/** 辻の市（大通りと横道の辻。市を荒らす攻め手の行き先で、副目標の区域） */
const MARKET = { x: 0, z: 102, r: 13 };
/** 攻め手の出る所（北の西の林・東の林。林の中は見えない。どの道へ向かうかは、林を出てからの向きで分かる） */
const SPAWN_W = { x: -180, z: -185, facing: S };
const SPAWN_E = { x: 180, z: -185, facing: S };
/** 敵勢の本陣の前（市を荒らす攻め手。大通りをまっすぐ下る） */
const SPAWN_C = { x: 30, z: -185, facing: S };

/** 攻め手の波（援軍として時間差で現れる。どれも決まった出口・市へ攻め進む） */
const WAVES: { id: string; at: number; spawn: { x: number; z: number; facing: number }; unit: string; kind: 'yari' | 'kiba'; name: string; strength: number; aim: { x: number; z: number; r?: number } }[] = [
    { id: 'w1', at: 10, spawn: SPAWN_W, unit: 'e_w_yari', kind: 'yari', name: '敵勢の攻め手 一（槍）', strength: 320, aim: AIM_WEST },
    { id: 'm1', at: 10, spawn: SPAWN_E, unit: 'e_m_yari', kind: 'yari', name: '敵勢の攻め手 二（槍）', strength: 350, aim: AIM_MAIN },
    { id: 'e2', at: 100, spawn: SPAWN_E, unit: 'e_e_yari', kind: 'yari', name: '敵勢の攻め手 三（槍）', strength: 360, aim: AIM_EAST },
    { id: 'e2k', at: 140, spawn: SPAWN_E, unit: 'e_e_kiba', kind: 'kiba', name: '敵勢の攻め手 四（騎馬）', strength: 300, aim: AIM_EAST },
    { id: 'w3', at: 190, spawn: SPAWN_W, unit: 'e_w_yari2', kind: 'yari', name: '敵勢の攻め手 五（槍）', strength: 380, aim: AIM_WEST },
    { id: 'w3k', at: 230, spawn: SPAWN_W, unit: 'e_w_kiba', kind: 'kiba', name: '敵勢の攻め手 六（騎馬）', strength: 300, aim: AIM_WEST },
    { id: 'm4', at: 250, spawn: SPAWN_C, unit: 'e_m_raid', kind: 'yari', name: '敵勢の攻め手 七（槍・市へ）', strength: 320, aim: MARKET },
];

export const TOWN_EDGE: BattlefieldDef = {
    id: 'town_edge',
    name: '城下町外縁',
    kind: 'town_edge',
    summary: '北の野から城下町の 3 つの出口へ向かう敵の突破を、7 分まで 2 部隊以内に抑える。西の脇道・大通り・東の門口と、真ん中の横道。敵の進路を見て守りを組み替える',
    width: 440,
    depth: 400,
    terrain: [
        // 家屋・塀の縁は 5 m の格子の線にそろえる（格子の升が「通れない」なのに体が入れる隙間を作らない。そこで止まった部隊は道を探せない）
        // 町の東西の端（家並みが続く。町の外を回る道は無い）。裏通りの東西の端だけが町の外へ抜ける（西の口・東の口）
        house(-220, -145, 40, 170),
        house(-220, -145, 180, 200),
        house(150, 220, 40, 170),
        house(150, 220, 180, 200),
        // 町の北の家並み（z 40〜95）。西の脇道（x -145〜-135）・大通り（x -15〜15）・東の道（x 130〜150）の間
        house(-135, -75, 40, 95),
        house(-75, -15, 40, 95),
        house(15, 75, 40, 95),
        house(75, 130, 40, 95),
        // 真ん中の家並み（z 110〜170）。横道（z 95〜110）と裏通り（z 170〜180）の間
        house(-135, -75, 110, 170),
        house(-75, -15, 110, 170),
        house(15, 75, 110, 170),
        house(75, 130, 110, 170),
        // 東の門口：東の道（z 140〜150）を塀で狭め、真ん中 x 135〜145 だけ通す（塀は家屋に重ねて 10 m の厚さ）
        { kind: 'wall', rect: { x0: 125, x1: 135, z0: 140, z1: 150 }, height: 5 },
        { kind: 'wall', rect: { x0: 145, x1: 155, z0: 140, z1: 150 }, height: 5 },
        // 南の端の家並み（z 180〜200）。真ん中だけ大通りが南の端へ抜ける
        house(-145, -15, 180, 200),
        house(15, 150, 180, 200),
        // 道
        { kind: 'road', rect: { x0: -15, x1: 15, z0: 40, z1: 200 } },
        { kind: 'road', rect: { x0: -145, x1: -135, z0: 40, z1: 180 } },
        { kind: 'road', rect: { x0: 130, x1: 150, z0: 40, z1: 180 } },
        { kind: 'road', rect: { x0: -145, x1: 150, z0: 95, z1: 110 } },
        { kind: 'road', rect: { x0: -220, x1: 220, z0: 170, z1: 180 } },
        // 北の野の林（攻め手の出る所。林の中の部隊は 60 m まで近づかないと見えない）と、野の中の柵（格子の線にそろえる）
        { kind: 'woods', rect: { x0: -220, x1: -120, z0: -200, z1: -60 } },
        { kind: 'woods', rect: { x0: 120, x1: 220, z0: -200, z1: -60 } },
        { kind: 'fence', rect: { x0: -100, x1: -40, z0: -20, z1: -10 } },
        { kind: 'fence', rect: { x0: 40, x1: 100, z0: -20, z1: -10 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 150, facing: N, note: '本陣（大通りの南）' },
            { id: 'center', x: 0, z: 70, facing: N, note: '大通り（町の北の家並みの間）' },
            { id: 'west', x: -60, z: 102, facing: N, note: '横道の西' },
            { id: 'east', x: 60, z: 102, facing: N, note: '横道の東' },
            { id: 'archers', x: -25, z: 102, facing: N, note: '弓（横道の真ん中の西）' },
            { id: 'reserve', x: 25, z: 102, facing: N, note: '予備（横道の真ん中の東）' },
            { id: 'cross', x: 0, z: 130, facing: N, note: '大通りの南（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -180, facing: S, note: '本陣（北）' },
            { id: 'yumi', x: 0, z: -120, facing: S, note: '弓（野の真ん中。近づいた相手を射る）' },
            { id: 'guard', x: 0, z: -135, facing: S, note: '押さえ（野の真ん中）' },
        ],
    },
    reinforcements: WAVES.map((w) => ({ id: w.id, side: 'enemy' as const, at: w.at, point: w.spawn, label: '敵勢の攻め手' })),
    exits: { ally: { x: -218, z: 175 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: {
            id: 'town_limit',
            type: 'limit_breakthrough',
            label: '7 分まで、町の出口への突破を 2 部隊以内に抑える',
            exits: [EXIT_MAIN, EXIT_WEST, EXIT_EAST],
            maxCount: 2,
            untilSec: 420,
            names: ['大通りの出口', '西の脇道の出口', '東の門口の出口'],
        },
        secondary: [
            { id: 'town_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'town_market', type: 'defend_zones', label: '辻の市を荒らさせない', sec: 420, zones: [{ circle: { cx: MARKET.x, cz: MARKET.z, r: MARKET.r } }], minHeld: 1, loseSec: 10, names: ['辻の市'] },
            { id: 'town_yumi', type: 'break_unit', label: '野の敵勢の弓を崩す', unitId: 'e_yumi' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 450,
    briefing: [
        'ゲーム用の演習（架空の相手）。北の野から、城下町の 3 つの出口（西の脇道の出口・大通りの出口・東の門口の出口）へ、敵勢の攻め手が時間差で攻め込む。',
        '町の中は家屋が並ぶ（通れず、矢も通さない）。北から入る口は、西の脇道（細い）・大通り（広い）・東の道（南の手前の門口が細い）の 3 つ。町の真ん中の横道が 3 本をつなぐ。大通りはそのまま南の端の出口へ、西の脇道と東の道は南の端の裏通りへ折れて、裏通りの西の端・東の端の出口へ抜ける。',
        '攻め手は北の西の林・東の林・敵勢の本陣の前から現れる（援軍の印と時刻）。林の中は近づかないと見えない。どの道へ向かうかは、林を出てからの向きで見る。',
        '敵の戦える部隊が出口の区域に入ると、町を抜けたと数える（部隊ごとに 1。兵の人数では数えない）。抜けた部隊は戦場を離れる。',
        '勝利：7 分まで、突破を 2 部隊以内に抑える（攻め手がすべて抜けるか崩れれば、その時に勝ち）。3 部隊目が抜けたら負け。',
        '副目標：味方の兵の損害を 3 割以内に抑える・辻の市（大通りと横道の辻）を荒らさせない・野の敵勢の弓を崩す。',
        '移動した部隊は、進んできた向きのまま待つ（待機の間は向き直らない）。背後から当たられると損害が大きく（×2.2）士気も大きく下がるので、受ける所では「向き」（T）で攻め手の来る方へ向けておく。',
    ],
    tactics: [
        '辻で挟む：脇道が横道へ出る辻で、横道の部隊と脇道の南の部隊が二方向から当たる（脇道の口では 1 部隊ずつしか当たれない）',
        '進路を見て組み替える：同じ道へ二隊続けて来る波がある。林を出た向きを見て、弓や予備を横道で次の道へ回す',
        '大通りにだけ集めない：大通りは止められても、西の脇道・東の門口から 3 部隊抜ければ負け',
        '出口の前で受けると動きは少ないが、同じ道へ続けて来る二隊を受けきれず、辻の市は荒らされる。南へ下ろした部隊は「向き」で北へ向け直す',
    ],
    presets: [
        {
            id: 'standard',
            name: '町口の守り',
            summary: '味方 7／敵 10（時間差で現れる攻め手 7 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cross', 'kiba', 300),
                T.sakai('west'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('east', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_yumi', 'yumi', '敵勢の弓', 180, 70, 'yumi', { aiRole: 'hold_line' }),
                E('e_guard', 'yari', '敵勢の押さえ', 450, 85, 'guard', { aiRole: 'hold_line' }),
                ...WAVES.map((w) => raider(w.unit, w.kind, w.name, w.strength, w.id, w.aim)),
            ],
        },
    ],
};
