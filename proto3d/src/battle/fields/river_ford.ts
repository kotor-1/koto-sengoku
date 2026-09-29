/**
 * 戦場「河川・浅瀬」（river_ford）。渡河地点が限られる。浅瀬の中では動きが遅く、戦うと不利。
 *
 * - 400 m × 320 m。東西に流れる深い川（z -35〜-5、幅 30 m。通れない）。
 * - 浅瀬は 2 か所：中央（x -18〜18。敵の弓の正面、先手が出口を守る）と、西（x -160〜-130。遠回りで、見張りが少ない）。
 * - 向こう岸（北）の西寄りに小高い地点（中心 (-70,-85)、半径 45 m、高さ 8 m）。
 * - 浅瀬の乱れ：浅瀬の中では、動き ×0.4・与える損害 ×0.8・受ける損害 ×1.2（地形の決まり ford）。
 * - 主目標：向こう岸の小高い地点を 60 秒確保する（敵のいない地点に味方がいる間だけ数える）。副目標：損害を 3 割以内に。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

export const RIVER_FORD: BattlefieldDef = {
    id: 'river_ford',
    name: '河川・浅瀬',
    kind: 'river_ford',
    summary: '深い川を、限られた浅瀬で渡る。渡る前に弓で崩し、渡りきってから押す',
    width: 400,
    depth: 320,
    terrain: [
        { kind: 'river', rect: { x0: -200, x1: 200, z0: -35, z1: -5 } },
        { kind: 'ford', rect: { x0: -18, x1: 18, z0: -35, z1: -5 } },
        { kind: 'ford', rect: { x0: -160, x1: -130, z0: -35, z1: -5 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -160, z1: 160 } },
        { kind: 'hill', circle: { cx: -70, cz: -85, r: 45 }, height: 8 },
        { kind: 'woods', rect: { x0: 120, x1: 200, z0: 20, z1: 110 } },
    ],
    terrainRules: {
        ford: { speed: 0.4, dealMul: 0.8, takeMul: 1.2 },
    },
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 125, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 40, facing: N, note: '中央の浅瀬の前' },
            { id: 'left', x: -60, z: 45, facing: N, note: '左' },
            { id: 'right', x: 60, z: 45, facing: N, note: '右' },
            { id: 'archers', x: 25, z: 22, facing: N, note: '岸の弓' },
            { id: 'reserve', x: 0, z: 95, facing: N, note: '後詰め' },
            { id: 'west', x: -140, z: 60, facing: N, note: '西の浅瀬の手前' },
        ],
        enemy: [
            { id: 'hq', x: 40, z: -130, facing: S, note: '本陣' },
            { id: 'ford_exit', x: 0, z: -52, facing: S, note: '中央の浅瀬の出口' },
            { id: 'archers', x: 25, z: -70, facing: S, note: '浅瀬の正面の弓' },
            { id: 'hill', x: -70, z: -92, facing: S, note: '小高い地点' },
            { id: 'hill_archers', x: -40, z: -105, facing: S, note: '小高い地点の弓' },
            { id: 'west', x: -145, z: -62, facing: S, note: '西の浅瀬の見張り' },
            { id: 'reserve', x: 90, z: -100, facing: S, note: '騎馬（後詰め）' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'ford_hill', type: 'hold_point', label: '向こう岸の小高い地点を確保する', zone: { circle: { cx: -70, cz: -85, r: 30 } }, sec: 60 },
        secondary: [{ id: 'ford_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 }],
    },
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。東西に流れる深い川は渡れない。渡れるのは中央と西の 2 つの浅瀬だけ。',
        '浅瀬の中では動きが遅く（×0.4）、斬り合うと不利（与える損害 ×0.8・受ける損害 ×1.2）。中央の浅瀬は敵の弓の正面で、出口を先手が守る。',
        '西の浅瀬は遠回りだが、見張りが少ない。向こう岸の西寄りに小高い地点がある。',
        '勝利：向こう岸の小高い地点を 60 秒確保する（地点に敵がいない間、味方がいれば数える）。敵勢の部隊をすべて崩しても勝ち。',
        '副目標：味方の兵の損害を 3 割以内に抑えて終える。',
    ],
    tactics: [
        '弓を岸へ出して、浅瀬の出口の先手・向こう岸の弓を先に崩す',
        '中央で敵を引きつけ、別の隊を西の浅瀬から回して小高い地点を取る。浅瀬の中で斬り合わない',
    ],
    presets: [
        {
            id: 'standard',
            name: '渡河の六隊',
            summary: '味方 6／敵 7。家康・本多忠勝・榊原康政・酒井忠次・石川数正と、徳川弓隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('left'),
                T.sakai('right'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_sente', 'yari', '敵勢の先手', 500, 80, 'ford_exit', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -48, r: 40 } }),
                E('e_yumi', 'yumi', '敵勢の弓隊', 350, 75, 'archers', { aiRole: 'hold_line' }),
                E('e_hill', 'yari', '敵勢の丘の守り', 400, 75, 'hill', { aiRole: 'hold_zone', aiTarget: { x: -70, z: -85, r: 45 } }),
                E('e_hill_yumi', 'yumi', '敵勢の丘の弓', 250, 70, 'hill_archers', { aiRole: 'hold_line' }),
                E('e_west', 'yari', '敵勢の見張り', 250, 70, 'west', { aiRole: 'hold_zone', aiTarget: { x: -145, z: -55, r: 40 } }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'reserve', { aiRole: 'reserve' }),
            ],
        },
    ],
};
