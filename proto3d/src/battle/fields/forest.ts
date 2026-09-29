/**
 * 戦場「森林」（forest）。林の中では動きが遅く、遠くから見えない。奇襲や別働隊が使いやすい。
 *
 * - 400 m × 320 m。西の林（x -200〜-35）と東の林（x 35〜200）が z -110〜80 に広がり、間に開けた中央の道（x -35〜35）が通る。
 *   西の林には細い林道（x -130〜-120。林ではないので速いが、見通される）と、奥の空き地（x -180〜-140, z -95〜-55。見通される）。
 * - 林の中の部隊は、相手が 60 m に来るまで見えない。林の中の騎馬は動き ×0.5（さらに林の遅さ ×0.5）。
 * - 林の奇襲：相手から見えていなかった部隊が斬りかかると、最初の 8 秒の損害 ×1.5。
 * - 敵勢は中央の道を固める：出口に弓 2 隊、道の中ほどに先手（hold_line）、道の両脇の林に伏兵（hold_zone。道に入った相手を横から突く）。
 *   本陣（林の北の外）の守りは騎馬 1 隊だけ（guard_hq）。
 * - 西の林の奥の空き地で、味方の物見隊が迷っている。敵勢の追っ手が北から林道沿いに南へ下りながら探す（assault。行き先は西の林の南寄り）。
 * - 主目標：敵勢の本陣を崩す。副目標：迷った物見隊を味方の陣（南。中心 (0,130)、半径 40 m）まで連れ帰る。
 *   区域の真ん中には家康本陣が立つ（押すと本陣が選び直される）ので、説明と進みの文で「輪の中の空いた地面を押す」と示す。
 *   区域を本陣から離すと、物見隊の下がる道が変わって本隊の釣り合い（追っ手と別働隊の出会い方）まで崩れるので、動かしていない。
 *
 * 釣り合い（tests/proto3d-field-forest.test.ts。早送りの台本で確かめた）：
 * - 何もしない → 物見隊が追っ手に崩され、日没（主目標を果たせない）。
 * - 全部隊で中央の道を攻め上る・道の出口の敵へ順に当たる → 両脇の伏兵に横を突かれ、弓に射られて負ける。
 * - 三隊で西の林の中（中央の道から離れた所）を北へ抜け、見られないまま本陣へ斬りかかる → 勝つ（途中で追っ手も林の中で不意を突ける）。
 *   同じ三隊でも、林道（見通される）を通る・中央の道の脇の林を通る・一隊だけで回ると、本陣を崩せない。
 * - 物見隊は林の中を通って早めに下げれば連れ帰れる。林道を通ると、林道沿いに下りてくる追っ手に見つかって崩される。
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
        // 西の林（奥に空き地を残す）
        { kind: 'woods', rect: { x0: -200, x1: -130, z0: -110, z1: -95 } },
        { kind: 'woods', rect: { x0: -200, x1: -180, z0: -95, z1: -55 } },
        { kind: 'woods', rect: { x0: -140, x1: -130, z0: -95, z1: -55 } },
        { kind: 'woods', rect: { x0: -200, x1: -130, z0: -55, z1: 80 } },
        { kind: 'woods', rect: { x0: -120, x1: -35, z0: -110, z1: 80 } },
        // 東の林
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
            { id: 'reserve', x: -35, z: 125, facing: N, note: '後詰め' },
            { id: 'archers', x: 30, z: 115, facing: N, note: '弓' },
            { id: 'lost', x: -160, z: -75, facing: N, note: '西の林の奥の空き地（迷った物見）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -135, facing: S, note: '本陣（林の北の外）' },
            { id: 'cavalry', x: 40, z: -140, facing: S, note: '本陣の守りの騎馬' },
            { id: 'lane_l', x: -18, z: -100, facing: S, note: '中央の道の出口の弓（左）' },
            { id: 'lane_r', x: 18, z: -100, facing: S, note: '中央の道の出口の弓（右）' },
            { id: 'lane', x: 0, z: -55, facing: S, note: '中央の道の先手' },
            { id: 'west_woods', x: -45, z: -40, facing: S, note: '西の林の伏兵（中央の道の脇）' },
            { id: 'east_woods', x: 45, z: -15, facing: S, note: '東の林の伏兵（中央の道の脇）' },
            { id: 'hunters', x: -110, z: -155, facing: S, note: '追っ手（林道沿いに西の林へ入る）' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'forest_hq', type: 'destroy_hq', label: '敵勢の本陣を崩す' },
        secondary: [{ id: 'forest_rescue', type: 'rescue', label: '迷った物見隊を味方の陣まで連れ帰る', unitId: 'a_lost', zone: { circle: { cx: 0, cz: 130, r: 40 } } }],
    },
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。西と東に広い林、その間に開けた中央の道。西の林には細い林道と、奥に空き地がある（林道・空き地は見通される）。',
        '林の中の部隊は、相手が 60 m に来るまで見えない。林の中は動きが遅く、騎馬はさらに遅い（×0.5）。',
        '林の奇襲：相手に見えていなかった部隊が斬りかかると、最初の 8 秒の損害 ×1.5。',
        '中央の道は、出口を敵の弓 2 隊が、道の中ほどを先手が固める。道の両脇の林に何かが潜んでいるらしい。本陣は林の北の外。',
        '西の林の奥の空き地で味方の物見隊が迷っている。敵勢の追っ手が北から林道沿いに探しに下りてくる。',
        '勝利：敵勢の本陣を崩す（本陣以外をすべて崩しても勝ち）。副目標：物見隊を南の味方の陣（家康本陣の周りの輪）まで連れ帰る。',
        '輪の真ん中には家康本陣が、東寄りに弓隊・西寄りに後詰めが立つ。物見隊を選んだら、輪の中の空いた地面を押す（味方の部隊そのものを押すと、その部隊が選び直される）。',
    ],
    tactics: [
        '中央の道を攻め上らない。道の両脇の林の伏兵に横を突かれ、出口の弓に射られる',
        '三隊で西の林の中（中央の道から離れた所）を北へ抜け、見られないまま本陣へ斬りかかる。林道を通ると見通されて、不意を突けない',
        '物見隊は始めに林の中を通って下げる（林道は追っ手の通り道）。行き先は、本陣・弓・後詰めから離れた輪の中の空いた所（本陣の南西など）を押す。西の林を抜ける別働隊が、追っ手を林の中で不意に突ける',
    ],
    presets: [
        {
            id: 'standard',
            name: '林の六隊',
            summary: '味方 6＋迷った物見隊／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正・徳川弓と、迷った物見隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('lane'),
                T.sakai('west_edge'),
                T.sakakibara('east_edge', 'kiba', 250),
                T.ishikawa('reserve'),
                T.yumi('archers', 300),
                { id: 'a_lost', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川の物見隊', strength: 150, morale: 60, slot: 'lost' },
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'cavalry', { aiRole: 'guard_hq' }),
                E('e_yumi_l', 'yumi', '敵勢の弓隊（左）', 250, 75, 'lane_l', { aiRole: 'hold_line' }),
                E('e_yumi_r', 'yumi', '敵勢の弓隊（右）', 250, 75, 'lane_r', { aiRole: 'hold_line' }),
                E('e_sente', 'yari', '敵勢の先手', 450, 80, 'lane', { aiRole: 'hold_line' }),
                // 道の両脇の伏兵：持ち場は林の中（見えない）、守る区域は中央の道。区域（＋10 m）に入った相手へ横から当たる
                E('e_ambush_w', 'yari', '敵勢の伏兵（西）', 300, 75, 'west_woods', { aiRole: 'hold_zone', aiTarget: { x: -22, z: -40, r: 35 } }),
                E('e_ambush_e', 'yari', '敵勢の伏兵（東）', 350, 80, 'east_woods', { aiRole: 'hold_zone', aiTarget: { x: 22, z: -15, r: 35 } }),
                // 追っ手：林道沿いに西の林の南寄りへ下り、途中で 60 m に見えた相手（空き地の物見隊など）へ当たる
                E('e_hunters', 'yari', '敵勢の追っ手', 300, 75, 'hunters', { aiRole: 'assault', aiTarget: { x: -130, z: 20, r: 30 } }),
            ],
        },
    ],
};
