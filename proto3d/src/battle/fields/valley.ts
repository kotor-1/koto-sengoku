/**
 * 戦場「谷間」（valley）。南北に長い谷を抜けて、北の谷の出口へ出る。谷底は左右の高地から射られやすい。
 *
 * - 360 m × 440 m。谷底は x -35〜35 の平地（道）。両側は南北に長い高地（カプセルの丘：西は線分 (-95,-120)〜(-95,110)、
 *   東は (95,-120)〜(95,110)。幅 60 m、高さ 14 m）。その外（x 150 より外）は崖。高地へは南の端（谷の口の左右）から緩く登れる。
 * - 高所：下から正面に来る相手の損害 ×0.7、高地の弓の射程 +25 m、低い相手へ射る矢 ×1.35（両側の高地から谷底を射る）。
 * - 敵勢は東西の高地に弓と槍、谷の出口に塞ぎの隊、北に本陣。90 秒で、谷の北から攻め手（槍 2）が谷底を南へ下ってくる（assault）。
 * - 主目標：味方 3 部隊が谷の出口（北の端の区域）へ抜ける。副目標：予備（石川数正隊）を崩さずに終える・損害を 4 割以内に抑える。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4）：
 * - 先に片側（西）の高地へ南の端から登り、高地の弓と槍を破ってから、高地の上と谷底を並んで北へ進む。
 * - 谷の口で構えて、谷を下ってくる攻め手を谷へ誘い込み、取った高地の弓と谷の口の槍で叩いてから抜ける。
 * - 谷底を急いで抜けるだけだと、両側の高地から射られ、出口の塞ぎに止められて崩れる。
 *
 * 武将との相性：石川の後詰めの差配は、予備を素早く出口へ送る。忠勝の退路の守護は、谷の口で殿をするときに生きる。
 *
 * 最初の案（第2群の 5 戦場の制作。動いて決着がつくこと・作戦で結果が変わることまで。釣り合いは後で整える）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 谷の出口（突破の区域） */
const EXIT_ZONE = { rect: { x0: -45, x1: 45, z0: -215, z1: -175 } };
/** 攻め手が下ってくる先（谷の口） */
const MOUTH_AIM = { x: 0, z: 150, r: 30 };

export const VALLEY: BattlefieldDef = {
    id: 'valley',
    name: '谷間',
    kind: 'valley',
    summary: '左右の高地に挟まれた谷を抜ける。先に高地を取るか、谷へ誘い込んで叩いてから抜ける',
    width: 360,
    depth: 440,
    terrain: [
        { kind: 'hill', capsule: { ax: -95, az: -120, bx: -95, bz: 110, r: 60 }, height: 14 },
        { kind: 'hill', capsule: { ax: 95, az: -120, bx: 95, bz: 110, r: 60 }, height: 14 },
        { kind: 'cliff', rect: { x0: -180, x1: -150, z0: -170, z1: 120 } },
        { kind: 'cliff', rect: { x0: 150, x1: 180, z0: -170, z1: 120 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -220, z1: 220 } },
        { kind: 'woods', rect: { x0: -180, x1: -110, z0: 160, z1: 220 } },
    ],
    highGround: { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 25, sightBonus: 0, arrowDealVsLower: 1.35 },
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 150, facing: N, note: '谷の口' },
            { id: 'left', x: -70, z: 165, facing: N, note: '左（西の高地の南の端へ近い）' },
            { id: 'right', x: 70, z: 165, facing: N, note: '右（東の高地の南の端へ近い）' },
            { id: 'archers', x: -30, z: 180, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 185, facing: N, note: '予備' },
            { id: 'flank', x: -120, z: 190, facing: N, note: '左の外（騎馬）' },
        ],
        enemy: [
            { id: 'hq', x: 60, z: -200, facing: S, note: '本陣' },
            { id: 'block', x: 0, z: -170, facing: S, note: '谷の出口の塞ぎ' },
            { id: 'w_archers', x: -90, z: 20, facing: S, note: '西の高地の弓' },
            { id: 'w_guard', x: -95, z: 70, facing: S, note: '西の高地の槍' },
            { id: 'e_archers', x: 90, z: -20, facing: S, note: '東の高地の弓' },
            { id: 'e_guard', x: 95, z: 40, facing: S, note: '東の高地の槍' },
            { id: 'raid1', x: -20, z: -200, facing: S, note: '攻め手（谷を下る）' },
            { id: 'raid2', x: 20, z: -205, facing: S, note: '攻め手（谷を下る）' },
        ],
    },
    exits: { ally: { x: 0, z: 220 }, enemy: { x: 0, z: -220 } },
    objectives: {
        primary: { id: 'valley_break', type: 'breakthrough', label: '味方 3 部隊が谷の出口へ抜ける', zone: EXIT_ZONE, count: 3 },
        secondary: [
            { id: 'valley_reserve', type: 'preserve_unit', label: '予備（石川数正隊）を崩さずに終える', unitId: 'a_ishikawa', minRatio: 0.5 },
            { id: 'valley_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
        ],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 540,
    briefing: [
        'ゲーム用の演習（架空の相手）。南北に長い谷。谷底の両側は高地（高さ 14 m）で、その外は崖。高地へは南の端から登れる。',
        '高所：高地の弓は遠くまで届き（射程 +25 m）、谷底の低い相手へ射る矢は ×1.35。下から高地へ攻め上がる相手の損害 ×0.7。',
        '敵勢は東西の高地に弓と槍、北の谷の出口に塞ぎの隊。90 秒で、谷の北から攻め手（槍 2 隊）が谷底を南へ下ってくる。',
        '勝利：味方 3 部隊が谷の出口（北の端の区域）へ抜ける。敵勢の部隊をすべて崩しても勝ち。',
        '副目標：予備（石川数正隊）を、兵を 5 割以上残して崩さずに終える・味方の兵の損害を 4 割以内に抑える。',
    ],
    tactics: [
        '先に西の高地へ南の端から登り、高地の槍と弓を破る。取った高地の上と谷底を並んで北へ進む',
        '谷の口で構えて、谷を下ってくる攻め手を誘い込み、高地の弓と谷の口の槍で叩く（忠勝の退路の守護で殿をすると崩れにくい）',
        '谷底を急いで抜けるだけにしない（両側の高地から射られ、出口の塞ぎに止められる）。予備（石川隊）は最後に出口へ送る（後詰めの差配で足を速める）',
    ],
    presets: [
        {
            id: 'standard',
            name: '谷抜けの七隊',
            summary: '味方 7／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('right'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_block', 'yari', '敵勢の出口の塞ぎ', 450, 80, 'block', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -175, r: 40 } }),
                E('e_w_yumi', 'yumi', '敵勢の西の高地の弓', 220, 70, 'w_archers', { aiRole: 'hold_line' }),
                E('e_w_guard', 'yari', '敵勢の西の高地の槍', 300, 70, 'w_guard', { aiRole: 'hold_zone', aiTarget: { x: -95, z: 60, r: 45 } }),
                E('e_e_yumi', 'yumi', '敵勢の東の高地の弓', 220, 70, 'e_archers', { aiRole: 'hold_line' }),
                E('e_e_guard', 'yari', '敵勢の東の高地の槍', 300, 70, 'e_guard', { aiRole: 'hold_zone', aiTarget: { x: 95, z: 30, r: 45 } }),
                E('e_raid1', 'yari', '敵勢の攻め手（一）', 380, 75, 'raid1', { aiRole: 'assault', aiTarget: MOUTH_AIM, arriveAt: 90 }),
                E('e_raid2', 'yari', '敵勢の攻め手（二）', 380, 75, 'raid2', { aiRole: 'assault', aiTarget: MOUTH_AIM, arriveAt: 90 }),
            ],
        },
    ],
};
