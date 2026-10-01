/**
 * 戦場「城下町外縁」（town_edge）。北の野から城下町の 3 つの出口へ向かう敵勢の突破を、2 部隊以内に抑える（第3群の最初の案）。
 *
 * - 440 m × 400 m。城下町は z 40〜200（南）。北（z 40 より北）は野で、敵勢が来る。
 * - 町の中の 3 本の道と出口（どれも南の端）：
 *   - 大通り（x -12〜12）：幅が広く、真っすぐ大通りの出口（南の端の真ん中）へ。
 *   - 西の脇道（x -146〜-134）：細い。西の脇道の出口へ。
 *   - 東の門口（x 134〜146）：東の道の南の端の手前が、塀の切れ目（門口・幅 12 m）。東の門口の出口へ。
 *   町の真ん中を東西の横道（z 96〜108）が通り、3 本の道をつなぐ（守りを組み替える近道）。ほかは家屋（通れない・射線を遮る）。
 * - 敵勢の攻め手は、時間差で、決まった出口へ攻め進む（aiRole 'assault'。途中で 60 m 以内の相手に当たる）：
 *   10 秒：西の脇道へ槍・大通りへ槍、90 秒：東の門口へ騎馬・大通りへ槍、170 秒：西の脇道へ騎馬・東の門口へ槍、250 秒：大通りへ槍。
 *   大通りを攻める弓 1 隊。本陣は北。
 * - 突破：敵の戦える部隊が出口の区域に入ると、その部隊は町を抜けて戦場を離れ、1 と数える（部隊単位。兵の人数では数えない）。
 * - 主目標：7 分（420 秒）まで、突破を 2 部隊以内に抑える（3 部隊目が抜けたら負け）。攻め手がすべて抜けたか崩れたら、その時に果たす。
 *   副目標：損害を 3 割以内に抑える・東の門口へ来る騎馬を崩す。
 *
 * 成り立たせたい作戦（設計 §4。釣り合いは後の担当）：
 * - 敵の進路を見て守りを組み替える（横道を使って、次の波の道へ予備を回す）。
 * - 大通りに集中する（大通りは止められるが、脇道・門口から抜けられる）。
 * - 出口の前で受ける（町の奥で待つ。動く道のりは短いが、出口の前で負けるとすぐ抜けられる）。
 */
import type { BattlefieldDef, PresetUnit } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const house = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height: 6 });

/** 出口（南の端） */
const EXIT_MAIN = { rect: { x0: -24, x1: 24, z0: 176, z1: 200 } };
const EXIT_WEST = { rect: { x0: -152, x1: -128, z0: 176, z1: 200 } };
const EXIT_EAST = { rect: { x0: 128, x1: 152, z0: 176, z1: 200 } };

/** 出口へ攻め進む攻め手（援軍として時間差で現れる） */
const raider = (id: string, kind: 'yari' | 'kiba' | 'yumi', name: string, strength: number, reinf: string, aim: { x: number; z: number }): PresetUnit => ({
    ...E(id, kind, name, strength, 80, '', { aiRole: 'assault', aiTarget: { x: aim.x, z: aim.z, r: 10 } }),
    slot: undefined,
    reinforcement: reinf,
});
const AIM_MAIN = { x: 0, z: 190 };
const AIM_WEST = { x: -140, z: 190 };
const AIM_EAST = { x: 140, z: 190 };

export const TOWN_EDGE: BattlefieldDef = {
    id: 'town_edge',
    name: '城下町外縁',
    kind: 'town_edge',
    summary: '北の野から城下町の 3 つの出口へ向かう敵の突破を、2 部隊以内に抑える。大通り・西の脇道・東の門口。敵の進路を見て守りを組み替える',
    width: 440,
    depth: 400,
    terrain: [
        // 町の北の端の家並み（z 40〜96）。道（大通り・脇道・東の道）の間
        house(-220, -146, 40, 96),
        house(-134, -70, 40, 96),
        house(-70, -12, 40, 96),
        house(12, 70, 40, 96),
        house(70, 134, 40, 96),
        house(146, 220, 40, 96),
        // 南の家並み（z 108〜200）
        house(-220, -152, 108, 200),
        house(-128, -70, 108, 200),
        house(-70, -24, 108, 200),
        house(24, 70, 108, 200),
        house(70, 128, 108, 200),
        house(152, 220, 108, 200),
        // 南の家並みの細い通り（道の両脇の家の間。出口の区域の幅だけ空ける）は上の家の切れ目で作る。
        // 東の門口：東の道の南（z 150〜160）を塀で狭め、真ん中 x 134〜146 だけ通す
        { kind: 'wall', rect: { x0: 128, x1: 134, z0: 150, z1: 160 }, height: 5 },
        { kind: 'wall', rect: { x0: 146, x1: 152, z0: 150, z1: 160 }, height: 5 },
        // 西の脇道の南：両脇の家（x -152〜-146・-134〜-128）で細くする
        house(-152, -146, 108, 176),
        house(-134, -128, 108, 176),
        // 道
        { kind: 'road', rect: { x0: -12, x1: 12, z0: -200, z1: 200 } },
        { kind: 'road', rect: { x0: -146, x1: -134, z0: 40, z1: 200 } },
        { kind: 'road', rect: { x0: 134, x1: 146, z0: 40, z1: 200 } },
        { kind: 'road', rect: { x0: -220, x1: 220, z0: 96, z1: 108 } },
        // 北の野の林と、野の中の柵（敵の道を少し分ける）
        { kind: 'woods', rect: { x0: -220, x1: -150, z0: -200, z1: -120 } },
        { kind: 'woods', rect: { x0: 150, x1: 220, z0: -200, z1: -120 } },
        { kind: 'fence', rect: { x0: -100, x1: -40, z0: -20, z1: -14 } },
        { kind: 'fence', rect: { x0: 40, x1: 100, z0: -20, z1: -14 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 160, facing: N, note: '本陣（大通りの南）' },
            { id: 'center', x: 0, z: 70, facing: N, note: '大通り（町の北の家並みの間）' },
            { id: 'west', x: -60, z: 102, facing: N, note: '横道の西' },
            { id: 'east', x: 60, z: 102, facing: N, note: '横道の東' },
            { id: 'archers', x: -22, z: 102, facing: N, note: '弓（横道の真ん中の西）' },
            { id: 'reserve', x: 22, z: 102, facing: N, note: '予備（横道の真ん中の東）' },
            { id: 'cross', x: 0, z: 130, facing: N, note: '大通りの南（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -180, facing: S, note: '本陣（北）' },
            { id: 'yumi', x: 30, z: -150, facing: S, note: '弓（大通りを攻める）' },
        ],
    },
    reinforcements: [
        { id: 'w1', side: 'enemy', at: 10, point: { x: -140, z: -190, facing: S }, label: '西の攻め手（10 秒）' },
        { id: 'm1', side: 'enemy', at: 10, point: { x: 0, z: -195, facing: S }, label: '大通りの攻め手（10 秒）' },
        { id: 'e2', side: 'enemy', at: 90, point: { x: 140, z: -190, facing: S }, label: '東の攻め手（1 分 30 秒）' },
        { id: 'm2', side: 'enemy', at: 90, point: { x: 0, z: -195, facing: S }, label: '大通りの攻め手（1 分 30 秒）' },
        { id: 'w3', side: 'enemy', at: 170, point: { x: -140, z: -190, facing: S }, label: '西の攻め手（2 分 50 秒）' },
        { id: 'e3', side: 'enemy', at: 170, point: { x: 140, z: -190, facing: S }, label: '東の攻め手（2 分 50 秒）' },
        { id: 'm4', side: 'enemy', at: 250, point: { x: 0, z: -195, facing: S }, label: '大通りの攻め手（4 分 10 秒）' },
    ],
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
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
            { id: 'town_kiba', type: 'break_unit', label: '東の門口へ来る騎馬を崩す', unitId: 'e_e_kiba' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 450,
    briefing: [
        'ゲーム用の演習（架空の相手）。北の野から、城下町の南の 3 つの出口（大通り・西の脇道・東の門口）へ、敵勢が時間差で攻め込む。',
        '町の中は家屋が並び、通れるのは大通り（広い）・西の脇道（細い）・東の道（南の端の手前の門口が細い）と、町の真ん中の東西の横道だけ。家屋は矢も通さない。',
        '敵勢の攻め手：10 秒に西と大通り、1 分 30 秒に東（騎馬）と大通り、2 分 50 秒に西（騎馬）と東、4 分 10 秒に大通り。どれも決まった出口へ向かう。',
        '敵の戦える部隊が出口の区域に入ると、町を抜けたと数える（部隊ごとに 1。兵の人数では数えない）。抜けた部隊は戦場を離れる。',
        '勝利：7 分まで、突破を 2 部隊以内に抑える（攻め手がすべて抜けるか崩れれば、その時に勝ち）。3 部隊目が抜けたら負け。',
        '副目標：味方の兵の損害を 3 割以内に抑える・東の門口へ来る騎馬を崩す。',
    ],
    tactics: [
        '敵の進路を見て守りを組み替える：攻め手の出る所（援軍の印）と向きを見て、横道を使って予備を次の道へ回す',
        '大通りにだけ集めない：大通りは止められても、西の脇道・東の門口から 3 部隊抜ければ負け',
        '出口の前で受ける：町の奥（細い所）で待つと動く道のりは短いが、出口の前で負けるとすぐ抜けられる',
    ],
    presets: [
        {
            id: 'standard',
            name: '町口の守り',
            summary: '味方 7／敵 9（攻め手 7 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cross', 'kiba', 300),
                T.sakai('west'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('east', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_yumi', 'yumi', '敵勢の弓', 180, 70, 'yumi', { aiRole: 'assault', aiTarget: { x: 0, z: 0, r: 20 }, arriveAt: 60 }),
                raider('e_w_yari', 'yari', '敵勢の西の攻め手（槍）', 320, 'w1', AIM_WEST),
                raider('e_m_yari1', 'yari', '敵勢の大通りの攻め手（一）', 350, 'm1', AIM_MAIN),
                raider('e_e_kiba', 'kiba', '敵勢の東の攻め手（騎馬）', 300, 'e2', AIM_EAST),
                raider('e_m_yari2', 'yari', '敵勢の大通りの攻め手（二）', 320, 'm2', AIM_MAIN),
                raider('e_w_kiba', 'kiba', '敵勢の西の攻め手（騎馬）', 250, 'w3', AIM_WEST),
                raider('e_e_yari', 'yari', '敵勢の東の攻め手（槍）', 350, 'e3', AIM_EAST),
                raider('e_m_yari3', 'yari', '敵勢の大通りの攻め手（三）', 350, 'm4', AIM_MAIN),
            ],
        },
    ],
};
