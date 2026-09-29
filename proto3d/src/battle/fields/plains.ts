/**
 * 戦場「大平原」（plains）。基本となる野戦。正面で押さえ、側面を回り、予備で決める。
 *
 * - 400 m × 320 m の平らな原。中央を南北に道。東に小さな林（中心 (130,-20)、半径 38 m）。
 * - 敵勢は北に横一列（先手・左備・右備・弓）。本陣の後ろに後詰め、東の林の向こうから騎馬が回り込む。
 * - 主目標：敵の本陣を崩す。副目標：予備隊（石川数正隊）を崩さずに終える（兵を 5 割以上残す）。
 * - 特殊ルールなし（既定の決まり）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

export const PLAINS: BattlefieldDef = {
    id: 'plains',
    name: '大平原',
    kind: 'plains',
    summary: '平らな原での野戦。正面で押さえ、側面を回り、予備隊で決める',
    width: 400,
    depth: 320,
    terrain: [
        { kind: 'road', rect: { x0: -7, x1: 7, z0: -160, z1: 160 } },
        { kind: 'woods', circle: { cx: 130, cz: -20, r: 38 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 120, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 60, facing: N, note: '正面' },
            { id: 'left', x: -65, z: 65, facing: N, note: '左翼' },
            { id: 'right', x: 65, z: 65, facing: N, note: '右翼' },
            { id: 'archers', x: 30, z: 92, facing: N, note: '弓' },
            { id: 'flank', x: -120, z: 95, facing: N, note: '左の外（騎馬）' },
            { id: 'reserve', x: 0, z: 145, facing: N, note: '予備' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -120, facing: S, note: '本陣' },
            { id: 'center', x: 0, z: -55, facing: S, note: '先手' },
            { id: 'left', x: -75, z: -60, facing: S, note: '左備（敵から見て右）' },
            { id: 'right', x: 75, z: -60, facing: S, note: '右備' },
            { id: 'archers', x: 30, z: -85, facing: S, note: '弓' },
            { id: 'east', x: 150, z: -105, facing: S, note: '東の騎馬（林の向こうから回り込む）' },
            { id: 'reserve', x: 0, z: -145, facing: S, note: '後詰め' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'plains_hq', type: 'destroy_hq', label: '敵勢の本陣を崩す' },
        secondary: [{ id: 'plains_reserve', type: 'preserve_unit', label: '予備隊（石川数正隊）を崩さずに終える', unitId: 'a_ishikawa', minRatio: 0.5 }],
    },
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。平らな原で、北に横一列で構える敵勢と戦う。',
        '敵勢は先手・左備・右備・弓で正面を固め、本陣の後ろに後詰めがいる。東の林の向こうから騎馬が回り込んでくる。',
        '勝利：敵勢の本陣を崩す（本陣以外をすべて崩しても勝ち）。副目標：予備隊（石川数正隊）を、兵を 5 割以上残して崩さずに終える。',
    ],
    tactics: [
        '正面は槍で押さえ（同じ敵の正面へ重ねても効きが薄い）、騎馬と翼の槍で横・背後へ回る',
        '予備隊（石川隊）は、崩れかけた所や回り込んでくる騎馬に当てる。早く出しすぎると副目標を落とす',
    ],
    presets: [
        {
            id: 'standard',
            name: '徳川の七隊',
            summary: '味方 7／敵 7。家康・本多忠勝・榊原康政・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('right'),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('flank'),
                E('e_hq', 'honjin', '敵勢の本陣', 400, 90, 'hq', { aiRole: 'guard_hq' }),
                E('e_sente', 'yari', '敵勢の先手', 550, 80, 'center', { aiRole: 'hold_line' }),
                E('e_left', 'yari', '敵勢の左備', 450, 75, 'left', { aiRole: 'hold_line' }),
                E('e_right', 'yari', '敵勢の右備', 450, 75, 'right', { aiRole: 'hold_line' }),
                E('e_yumi', 'yumi', '敵勢の弓隊', 350, 75, 'archers', { aiRole: 'hold_line' }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 300, 75, 'east', { aiRole: 'flank' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 400, 75, 'reserve', { aiRole: 'reserve' }),
            ],
        },
    ],
};
