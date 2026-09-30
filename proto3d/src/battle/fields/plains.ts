/**
 * 戦場「大平原」（plains）。基本となる野戦。正面で押さえ、側面を回り、予備で決める。
 *
 * - 400 m × 320 m の平らな原。中央を南北に道。東に小さな林（中心 (130,-20)、半径 38 m）。
 * - 敵勢の先手・左備・右備は、始まるとすぐこちらの横一列（正面・左翼・右翼の枠）を目がけて押し出してくる（assault）。
 *   弓隊はその後ろ（z -75）に残り、原の中ほど（z 40 くらい）まで矢が届く。本陣の後ろに後詰め。
 *   騎馬は東の外を南へ下り、途中で林を抜ける（林の中は見えない）。林から出て右翼の横を突く。
 * - 主目標：敵の本陣を崩す。副目標：予備隊（石川数正隊）を崩さずに終える（兵を 5 割以上残す）。
 * - 特殊ルールなし（既定の決まり。ほかの戦場と比べる基準）。
 *
 * 釣り合い（tests/proto3d-field-plains.test.ts。早送りの台本で確かめた）：
 * - 何もしない・全部隊で正面へ攻めかかる・待ってから本陣へ押すだけ → 負ける。
 * - 正面の槍は持ち場で待ち構え、騎馬は西の外を回って組み合った左備の横へ、林から出た騎馬へ予備隊、最後に本陣へ → 勝つ。
 * - 予備隊を始めから右翼へ出すと、勝てても林から出た騎馬に横を突かれて崩れる（副目標を落とす）。
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
            { id: 'center', x: 0, z: -55, facing: S, note: '先手（押し出してくる）' },
            { id: 'left', x: -75, z: -60, facing: S, note: '左備（敵から見て右）' },
            { id: 'right', x: 75, z: -60, facing: S, note: '右備' },
            { id: 'archers', x: 30, z: -75, facing: S, note: '弓（原の中ほどまで届く）' },
            { id: 'east', x: 150, z: -105, facing: S, note: '東の騎馬（林を抜けて回り込む）' },
            { id: 'reserve', x: 0, z: -145, facing: S, note: '後詰め' },
        ],
    },
    exits: { ally: { x: 0, z: 160 }, enemy: { x: 0, z: -160 } },
    objectives: {
        primary: { id: 'plains_hq', type: 'destroy_hq', label: '敵勢の本陣を崩す' },
        secondary: [{ id: 'plains_reserve', type: 'preserve_unit', label: '予備隊（石川数正隊）を崩さずに終える', unitId: 'a_ishikawa', minRatio: 0.5 }],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。平らな原で、北に陣取る敵勢と戦う。',
        '敵勢の先手・左備・右備は、始まるとすぐこちらの横一列へ押し出してくる。弓隊はその後ろに残り、原の中ほどまで矢が届く。本陣の後ろに後詰めがいる。',
        '敵勢の騎馬は東の林を抜けて回り込み、右翼の横を突いてくる（林の中にいる間は見えない）。',
        '勝利：敵勢の本陣を崩す（本陣以外をすべて崩しても勝ち）。副目標：予備隊（石川数正隊）を、兵を 5 割以上残して崩さずに終える。',
    ],
    tactics: [
        '正面の槍は持ち場で待ち構える（守りに強い）。原の中ほどへ攻めかかると、敵の弓の届く所で守りの利を捨てて斬り合うことになる',
        '騎馬は西の外を大きく回り、こちらの槍と組み合った敵の横・背後を突く（組み合う前に真っすぐ当てると、敵の槍と正面から組み合って崩れる）',
        '林から出てくる敵の騎馬には予備隊（石川隊）を当て、本陣を崩す最後の一押しにも予備隊を使う。予備隊を始めから前へ出すと、横を突かれて崩れやすい（副目標を落とす）',
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
                // 先手・左備・右備は、こちらの横一列（正面・左翼・右翼の枠）を目がけて押し出してくる
                E('e_sente', 'yari', '敵勢の先手', 525, 80, 'center', { aiRole: 'assault', aiTarget: { x: 0, z: 55, r: 30 } }),
                E('e_left', 'yari', '敵勢の左備', 500, 75, 'left', { aiRole: 'assault', aiTarget: { x: -75, z: 50, r: 30 } }),
                E('e_right', 'yari', '敵勢の右備', 500, 75, 'right', { aiRole: 'assault', aiTarget: { x: 75, z: 50, r: 30 } }),
                E('e_yumi', 'yumi', '敵勢の弓隊', 400, 75, 'archers', { aiRole: 'hold_line' }),
                E('e_kiba', 'kiba', '敵勢の騎馬', 300, 75, 'east', { aiRole: 'flank' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 350, 75, 'reserve', { aiRole: 'reserve' }),
            ],
        },
    ],
};
