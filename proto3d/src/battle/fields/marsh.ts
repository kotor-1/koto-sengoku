/**
 * 戦場「湿地」（marsh）。南北に広い湿地を、細い土手道と、点在する乾いた足場を伝って北へ抜ける（第3群の最初の案）。
 *
 * - 420 m × 440 m。z -150〜140 は一面の深い湿地（marsh）。動き ×0.35（騎馬はさらに ×0.6）、中で斬り合うと与える損害 ×0.8・受ける ×1.15、
 *   中の弓の矢 ×0.7（泥に足を取られて射にくい）、中の騎馬は突撃にならない（地形の決まり marsh の arrowDealMul・noCharge）。
 *   水田（paddy）とは別の地形で、色だけを替えたものではない。
 * - 土手道：真ん中を南北に通る幅 12 m の道（乾いた足場 dry の上に道 road を重ねる。動き ×1.2）。速いが、1 部隊ずつしか並べない。
 *   土手道の上で斬り合えるのは前の 1 部隊だけ（幅が部隊の間隔ほど）。脇の泥へ降りれば横から当たれるが、泥の中は遅く不利。
 * - 乾いた足場（dry）：西に、島のような足場が南から北へ 5 つ並ぶ（足場の上は普通の地面。足場の間は 20 m ほどの泥）。
 *   足場を伝えば、深い湿地を真っすぐ渡るより早く、土手道より遅く北へ抜けられる。土手道の両脇に、敵の弓が立つ小さな足場が 2 つ。東は足場の無い深い湿地。
 * - 敵勢：土手道の真ん中を押さえる槍（450）、その両脇の足場の弓 2 隊（土手道を射る）、西の足場の道の中ほどを守る槍（300）、
 *   出口の西を守る槍（400）、出口の東の騎馬（300。出口の東を守る）、北東の本陣。240 秒に、北から後詰めの槍（350）が土手道の北の口へ下ってくる。
 * - 主目標：味方の戦える部隊 4 つを北の出口（z -215〜-150）へ抜けさせる（突破。敵本陣の撃破ではない）。
 *   副目標：損害を 2 割 5 分以内に抑える・土手道の押さえを崩す。
 *
 * 成り立たせたい作戦（設計 docs/fields-group3-design.md §4。釣り合いは後の担当が調整する）：
 * - 土手道に集中する：弓で押さえを射てから、忠勝隊を先頭に土手道を押し上げる。速いが、両脇の弓に射られ、狭い正面で 1 部隊ずつしか当たれない。
 * - 足場を伝って西から回る：遅いが、土手道の弓から離れて損害が少ない。足場の槍を破る必要がある。
 * - 組み合わせ：土手道の押さえを 1〜2 隊で引きつけ、残りを足場伝いに回す。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 北の出口（突破の区域） */
const EXIT_ZONE = { rect: { x0: -160, x1: 160, z0: -215, z1: -150 } };

/** 西の足場（南から北へ。島の中心と半径） */
const ISLES = [
    { cx: -95, cz: 112, r: 18 },
    { cx: -140, cz: 62, r: 18 },
    { cx: -160, cz: 4, r: 20 },
    { cx: -165, cz: -52, r: 18 },
    { cx: -135, cz: -108, r: 18 },
];

export const MARSH: BattlefieldDef = {
    id: 'marsh',
    name: '湿地',
    kind: 'marsh',
    summary: '一面の深い湿地を、細い土手道か、西の乾いた足場を伝って北の出口へ抜ける。土手道は速いが両脇から射られる',
    width: 420,
    depth: 440,
    terrain: [
        // 深い湿地（z -150〜140）
        { kind: 'marsh', rect: { x0: -210, x1: 210, z0: -150, z1: 140 } },
        // 土手道（乾いた足場の上に道）
        { kind: 'dry', rect: { x0: -7, x1: 7, z0: -150, z1: 140 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -220, z1: 220 } },
        // 西の足場（島）
        ...ISLES.map((c) => ({ kind: 'dry' as const, circle: c })),
        // 土手道の両脇の小さな足場（敵の弓が立つ）
        { kind: 'dry', circle: { cx: -42, cz: -38, r: 13 } },
        { kind: 'dry', circle: { cx: 42, cz: 12, r: 13 } },
        // 北東の林（本陣の後ろ）
        { kind: 'woods', rect: { x0: 150, x1: 210, z0: -220, z1: -170 } },
    ],
    terrainRules: {
        // 泥の中：騎馬はさらに遅い（×0.35×0.6）。中の弓は射にくい（×0.7）。騎馬の突撃は効かない
        marsh: { kindSpeed: { kiba: 0.6 }, arrowDealMul: 0.7, noCharge: true },
    },
    // 道・足場を選んで進むように道探しを使う
    pathfinding: true,
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 158, facing: N, note: '土手道の南の口' },
            { id: 'left', x: -60, z: 162, facing: N, note: '左（西の足場へ近い）' },
            { id: 'right', x: 60, z: 162, facing: N, note: '右' },
            { id: 'archers', x: -25, z: 178, facing: N, note: '弓' },
            { id: 'reserve', x: 28, z: 180, facing: N, note: '予備' },
            { id: 'flank', x: -110, z: 180, facing: N, note: '左の外（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 150, z: -190, facing: S, note: '本陣（北東）' },
            { id: 'block', x: 0, z: -20, facing: S, note: '土手道の押さえ' },
            { id: 'yumi_w', x: -42, z: -38, facing: S, note: '土手道の西の足場の弓' },
            { id: 'yumi_e', x: 42, z: 12, facing: S, note: '土手道の東の足場の弓' },
            { id: 'isle', x: -160, z: 4, facing: S, note: '西の足場の中ほどの槍' },
            { id: 'exit_w', x: -60, z: -178, facing: S, note: '出口の西の槍' },
            { id: 'exit_kiba', x: 70, z: -185, facing: S, note: '出口の東の騎馬' },
        ],
    },
    reinforcements: [{ id: 'north', side: 'enemy', at: 240, point: { x: 0, z: -212, facing: S }, label: '後詰めの槍（北から土手道へ）' }],
    exits: { ally: { x: 0, z: 220 }, enemy: { x: 150, z: -220 } },
    objectives: {
        primary: { id: 'marsh_break', type: 'breakthrough', label: '味方 4 部隊が北の出口へ抜ける', zone: EXIT_ZONE, count: 4 },
        secondary: [
            { id: 'marsh_losses', type: 'limit_losses', label: '損害を 2 割 5 分以内に抑える', maxRatio: 0.25 },
            { id: 'marsh_block', type: 'break_unit', label: '土手道の押さえを崩す', unitId: 'e_block' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。南北に広い深い湿地を北へ抜ける。湿地の中は動きがとても遅く（×0.35。騎馬はさらに ×0.6）、中で斬り合うと不利。',
        '泥の中では弓が射にくく（矢 ×0.7）、騎馬の突撃も効かない。',
        '真ん中の土手道は速い（道 ×1.2）が幅が狭く、1 部隊ずつしか並べない。脇の泥へ降りれば横から当たれるが、泥の中は遅く不利。土手道の両脇の小さな足場から敵の弓が射る。',
        '西には乾いた足場（島）が南から北へ並ぶ。足場の上は普通の地面。足場を伝えば、土手道より遅いが、土手道の弓から離れて北へ回れる。中ほどの足場を敵の槍が守る。',
        '敵勢は土手道の押さえ（大きな槍隊）・両脇の弓・西の足場の槍・出口の西の槍・出口の東の騎馬・北東の本陣。4 分に、北から後詰めの槍が土手道の北の口へ下ってくる。',
        '勝利：味方の戦える部隊 4 つが北の出口（区域）へ抜ける。敵勢をすべて崩しても勝ち。',
        '副目標：味方の兵の損害を 2 割 5 分以内に抑える・土手道の押さえを崩す。',
    ],
    tactics: [
        '土手道に集中する：弓で押さえを射てから、忠勝隊を先頭に土手道を押し上げる。速いが両脇の弓に射られ、1 部隊ずつしか当たれない',
        '足場を伝って西から回る：島から島へ移動の命令を重ね、中ほどの足場の槍を破って北へ。遅いが土手道の弓から離れる',
        '組み合わせ：押さえを 1〜2 隊で土手道に引きつけ、残りを足場伝いに回して出口へ（後詰めが来る 4 分までに北の口を越える）',
    ],
    presets: [
        {
            id: 'standard',
            name: '湿地抜けの七隊',
            summary: '味方 7／敵 8（後詰め 1 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('right'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_block', 'yari', '敵勢の土手道の押さえ', 450, 80, 'block', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -20, r: 14 }, aiLeash: 40 }),
                E('e_yumi_w', 'yumi', '敵勢の西の足場の弓', 220, 70, 'yumi_w', { aiRole: 'hold_line' }),
                E('e_yumi_e', 'yumi', '敵勢の東の足場の弓', 220, 70, 'yumi_e', { aiRole: 'hold_line' }),
                E('e_isle', 'yari', '敵勢の足場の槍', 300, 75, 'isle', { aiRole: 'hold_zone', aiTarget: { x: -160, z: 4, r: 18 } }),
                E('e_exit', 'yari', '敵勢の出口の槍', 400, 80, 'exit_w', { aiRole: 'hold_zone', aiTarget: { x: -60, z: -178, r: 30 } }),
                E('e_kiba', 'kiba', '敵勢の出口の騎馬', 300, 80, 'exit_kiba', { aiRole: 'hold_zone', aiTarget: { x: 70, z: -185, r: 30 }, aiLeash: 80 }),
                { ...E('e_reinf', 'yari', '敵勢の後詰めの槍', 350, 80, '', { aiRole: 'assault', aiTarget: { x: 0, z: -150, r: 25 } }), slot: undefined, reinforcement: 'north' },
            ],
        },
    ],
};
