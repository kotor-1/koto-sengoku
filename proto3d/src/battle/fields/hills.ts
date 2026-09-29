/**
 * 戦場「丘陵」（hills）。高所を取る意味がある。高低差の効果は highGround のデータで調整する。
 *
 * - 400 m × 320 m。中央に大きな丘（中心 (0,-10)、半径 75 m、高さ 14 m）、東に丘（中心 (140,40)、半径 55 m、高さ 10 m）。間は谷。
 * - 高所の有利（この戦場は強め）：下から正面に来る相手の損害 ×0.65、弓の射程 +30 m、隠れた相手を 40 m 遠くから見つける。
 * - 敵勢の先手と槍は、始まるとすぐ中央の丘へ攻め上がる（assault）。東の丘には敵の弓が陣取る。
 * - 主目標：中央の丘を 90 秒確保する。副目標：敵の弓隊（東の丘）を崩す。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

export const HILLS: BattlefieldDef = {
    id: 'hills',
    name: '丘陵',
    kind: 'hills',
    summary: '2 つの丘と谷。先に高所を取る。取られたら回り込む',
    width: 400,
    depth: 320,
    terrain: [
        { kind: 'hill', circle: { cx: 0, cz: -10, r: 75 }, height: 14 },
        { kind: 'hill', circle: { cx: 140, cz: 40, r: 55 }, height: 10 },
        { kind: 'woods', rect: { x0: -200, x1: -150, z0: -160, z1: 20 } },
    ],
    highGround: { defenseVsLower: 0.65, minDiff: 2, rangeBonus: 30, sightBonus: 40 },
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 130, facing: N, note: '本陣' },
            { id: 'center_l', x: -30, z: 85, facing: N, note: '正面の左' },
            { id: 'center_r', x: 30, z: 85, facing: N, note: '正面の右' },
            { id: 'flank', x: -115, z: 95, facing: N, note: '左の外（騎馬）' },
            { id: 'reserve', x: 0, z: 110, facing: N, note: '後詰め' },
            { id: 'archers', x: 70, z: 105, facing: N, note: '弓' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -135, facing: S, note: '本陣' },
            { id: 'vanguard', x: 0, z: -95, facing: S, note: '先手（丘へ攻め上がる）' },
            { id: 'left', x: -55, z: -105, facing: S, note: '槍（丘へ攻め上がる）' },
            { id: 'east_hill', x: 140, z: 30, facing: S, note: '東の丘の弓' },
            { id: 'west', x: -125, z: -110, facing: S, note: '西の騎馬（回り込む）' },
            { id: 'reserve', x: 60, z: -120, facing: S, note: '後詰め' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'hills_center', type: 'hold_point', label: '中央の丘を確保する', zone: { circle: { cx: 0, cz: -10, r: 35 } }, sec: 90 },
        secondary: [{ id: 'hills_archers', type: 'break_unit', label: '東の丘の敵の弓隊を崩す', unitId: 'e_yumi' }],
    },
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。中央に大きな丘、東に丘がある。間は谷。',
        '高所の有利（この戦場は強め）：丘の上の部隊は、下から正面に来る相手の損害を ×0.65 に抑える。弓は高所から 30 m 遠くまで届き、隠れた相手を 40 m 遠くから見つける。',
        '敵勢の先手と槍は、始まるとすぐ中央の丘へ攻め上がる。東の丘には敵の弓が陣取り、谷を射る。',
        '勝利：中央の丘の頂を 90 秒確保する（頂に敵がいない間、味方がいれば数える）。敵勢の部隊をすべて崩しても勝ち。副目標：東の丘の弓隊を崩す。',
    ],
    tactics: ['先に中央の丘へ上がって、攻め上がってくる敵を上から受ける', '丘を取られたら正面から押さず、横・後ろへ回り込む。東の丘の弓は谷を避けて回って崩す'],
    presets: [
        {
            id: 'standard',
            name: '丘取りの六隊',
            summary: '味方 6／敵 6。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center_l'),
                T.sakai('center_r'),
                T.sakakibara('flank', 'kiba', 280),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_sente', 'yari', '敵勢の先手', 500, 80, 'vanguard', { aiRole: 'assault', aiTarget: { x: 0, z: -15, r: 30 } }),
                E('e_yari', 'yari', '敵勢の槍', 400, 75, 'left', { aiRole: 'assault', aiTarget: { x: -25, z: -5, r: 30 } }),
                E('e_yumi', 'yumi', '敵勢の弓隊', 300, 75, 'east_hill', { aiRole: 'hold_zone', aiTarget: { x: 140, z: 35, r: 40 } }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 250, 75, 'west', { aiRole: 'flank' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 350, 75, 'reserve', { aiRole: 'reserve' }),
            ],
        },
    ],
};
