/**
 * 戦場「一本橋」（single_bridge）。深い川に架かる橋が 1 本だけ。橋の上は狭く、大軍をそのまま押し込むと一隊ずつ削られる。
 *
 * - 400 m × 360 m。東西に流れる深い川（z -40〜-10、幅 30 m。通れない）。
 * - 橋は中央に 1 本（x -9〜9、幅 18 m）。橋の上と両の口（z -48〜-2）は狭い正面：同じ相手へ斬りかかれるのは 1 部隊まで。
 *   橋の上では矢を避けられない（橋の矢の損害 ×1.4）。
 * - 西の端に浅瀬（x -185〜-150。遠回りで遅い）。向こう岸の浅瀬の口には見張りが 1 隊いるだけ。
 * - 向こう岸の橋の口（橋頭）には敵勢の橋の守り。持ち場を保つ（hold_line）ので、矢を浴び続けると射手へ打って出る（陽動で引き出せる）。
 *   その左右に弓が 2 隊、橋の上と南の岸の口を射る。後ろに二の備えと騎馬（後詰め）、北に本陣。
 * - 主目標：橋頭（向こう岸の橋の口。中心 (0,-70)、半径 30 m）を 60 秒確保する。副目標：損害を 3 割以内に抑える。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4）：
 * - 岸の弓で橋の守りを射て、打って出てきた守りを南の岸の口で迎え撃つ（橋の上では一隊ずつしか当たれないのは向こうも同じ）。
 * - 騎馬・榊原隊を西の浅瀬へ回し、見張りを破って橋頭の背後（西）から取る。
 * - 橋へ全部隊を押し込むと、橋の上で一隊ずつ当たり、両の弓に射られて崩れる。
 *
 * 武将との相性：忠勝の退路の守護は、橋の上で退く味方を守る（追っ手を引きつける）。榊原の先駆けの号は浅瀬への迂回を速める（ただし浅瀬の中は遅い）。
 *
 * 最初の案（第2群の 5 戦場の制作。動いて決着がつくこと・作戦で結果が変わることまで。釣り合いは後で整える）。
 */
import type { BattlefieldDef } from './types';
import type { Zone } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 橋と両の口（狭い正面の区域） */
const BRIDGE_ZONE: Zone = { rect: { x0: -12, x1: 12, z0: -48, z1: -2 } };
/** 橋頭（主目標の区域） */
const BRIDGEHEAD: Zone = { circle: { cx: 0, cz: -70, r: 30 } };

export const SINGLE_BRIDGE: BattlefieldDef = {
    id: 'single_bridge',
    name: '一本橋',
    kind: 'single_bridge',
    summary: '深い川に橋が 1 本。狭い橋へ押し込まず、陽動で守りを引き出すか、遠い浅瀬から橋頭の背後を取る',
    width: 400,
    depth: 360,
    terrain: [
        { kind: 'river', rect: { x0: -200, x1: 200, z0: -40, z1: -10 } },
        { kind: 'bridge', rect: { x0: -9, x1: 9, z0: -44, z1: -6 } },
        { kind: 'ford', rect: { x0: -185, x1: -150, z0: -40, z1: -10 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -180, z1: -44 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -6, z1: 180 } },
        { kind: 'woods', rect: { x0: 110, x1: 200, z0: -150, z1: -70 } },
        { kind: 'hill', circle: { cx: -90, cz: -120, r: 40 }, height: 6 },
    ],
    terrainRules: {
        // 橋の上は横へ避けられない：矢の損害 ×1.4（動きは道と同じ）
        bridge: { arrowTakeMul: 1.4 },
    },
    specialRules: [{ type: 'narrow_frontage', zone: BRIDGE_ZONE, maxEngaged: 1 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 150, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 45, facing: N, note: '橋の南の口の前' },
            { id: 'left', x: -60, z: 50, facing: N, note: '左（西の浅瀬へ近い）' },
            { id: 'right', x: 60, z: 50, facing: N, note: '右' },
            { id: 'archers', x: 28, z: 18, facing: N, note: '岸の弓（橋頭まで 90 m ほど）' },
            { id: 'reserve', x: 0, z: 100, facing: N, note: '後詰め' },
            { id: 'flank', x: -110, z: 70, facing: N, note: '左の外（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 40, z: -150, facing: S, note: '本陣' },
            { id: 'bridgehead', x: 0, z: -62, facing: S, note: '橋頭の守り' },
            { id: 'archers_w', x: -38, z: -78, facing: S, note: '橋の西の弓' },
            { id: 'archers_e', x: 38, z: -78, facing: S, note: '橋の東の弓' },
            { id: 'second', x: 0, z: -110, facing: S, note: '二の備え' },
            { id: 'cavalry', x: 70, z: -115, facing: S, note: '騎馬（後詰め）' },
            { id: 'west', x: -160, z: -62, facing: S, note: '西の浅瀬の見張り' },
        ],
    },
    exits: { ally: { x: 0, z: 180 }, enemy: { x: 0, z: -180 } },
    objectives: {
        primary: { id: 'bridge_head', type: 'hold_point', label: '向こう岸の橋頭を確保する', zone: BRIDGEHEAD, sec: 60 },
        secondary: [{ id: 'bridge_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 }],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。東西に流れる深い川に、橋が 1 本だけ架かる。川は渡れない。',
        '狭い正面：橋の上と両の口では、同じ相手へ斬りかかれるのは 1 部隊まで。大軍でも一隊ずつしか当たれない。橋の上では矢を避けられない（矢の損害 ×1.4）。',
        '向こう岸の橋の口（橋頭）に敵勢の守り、その左右に弓が 2 隊。後ろに二の備えと騎馬。守りは矢を浴び続けると射手へ打って出てくる。',
        '西の端に浅瀬がある。遠回りで、浅瀬の中は遅い。向こう岸の浅瀬の口には見張りが 1 隊。',
        '勝利：向こう岸の橋頭を 60 秒確保する（輪の中に敵がいない間、味方がいれば数える）。敵勢の部隊をすべて崩しても勝ち。',
        '副目標：味方の兵の損害を 3 割以内に抑えて終える。',
    ],
    tactics: [
        '岸の弓で橋頭の守りを射る。守りが橋を渡って打って出てきたら、南の岸の口で迎え撃つ（橋の上の相手には一隊ずつしか当たれないが、向こうも同じ）',
        '騎馬と榊原隊を西の浅瀬へ回し、見張りを破って橋頭の背後（西）から取る。正面の隊は南の岸で構えて、守りを引きつけておく',
        '橋へ全部隊を押し込まない（橋の上で一隊ずつ当たり、両の弓に射られる）。忠勝の退路の守護は、橋の上で押し返された隊を退かせるときに使う',
    ],
    presets: [
        {
            id: 'standard',
            name: '橋の七隊',
            summary: '味方 7／敵 7。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('left', 'kiba', 300),
                T.sakai('right'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('flank'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                // 橋頭の守り：持ち場を保つ（矢を浴び続けると射手へ打って出る＝陽動で引き出せる）
                E('e_guard', 'yari', '敵勢の橋の守り', 500, 80, 'bridgehead', { aiRole: 'hold_line' }),
                E('e_yumi_w', 'yumi', '敵勢の西の弓', 220, 70, 'archers_w', { aiRole: 'hold_line' }),
                E('e_yumi_e', 'yumi', '敵勢の東の弓', 220, 70, 'archers_e', { aiRole: 'hold_line' }),
                E('e_second', 'yari', '敵勢の二の備え', 400, 75, 'second', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -95, r: 40 } }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'cavalry', { aiRole: 'reserve' }),
                E('e_west', 'yari', '敵勢の浅瀬の見張り', 220, 70, 'west', { aiRole: 'hold_zone', aiTarget: { x: -167, z: -60, r: 35 } }),
            ],
        },
    ],
};
