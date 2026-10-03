/**
 * 戦場「退却戦」（rearguard）。北から追ってくる敵勢を食い止めながら、総大将と 4 部隊を南の退き口から離脱させる（第4群。最初の案）。
 *
 * - 400 m × 440 m（南北に長い）。味方は原の真ん中（z -10〜40）で、すぐ北の敵勢（z -80 あたり）と向き合って始まる。退き口は南の端（z 190〜220）。
 * - 退き口までの道：原の南の崖（z 90〜130）の切れ目（x -20〜20。幅 40 m）を抜ける。切れ目とその前後は狭い正面（同じ相手へ 2 部隊まで）。
 *   切れ目の北の口に小さな丘（殿の置き場所。上にいると下から来る相手に強い）。
 * - 敵勢：攻め手（槍 2・弓 1）と東西の林の騎馬 2 が始めから南の切れ目へ攻め進み（途中で 60 m 以内の相手に当たる）、2 分で後詰めの槍が北から来る。
 *   追い討ち（pursuit）：敵は撤退の命令で退く部隊を追って斬りかかる（騎馬は 110 m、ほかは 60 m から）。
 *   本多忠勝の「退路の守護」の範囲の中で退く味方を追う敵は、忠勝隊に阻まれる（使わなくても、殿と撤退の順で離脱できる）。
 * - 主目標：総大将（家康本陣）と、ほかの 4 部隊が退き口から離脱する（withdraw）。目標どおり退けば、この戦場では勝利。
 *   退き口の輪に入った部隊は戦場を離れる（撤退の命令でも移動でもよい）。総大将が崩れる・離脱できる部隊が 4 に足りなくなると負け。
 *   副目標：損害を 4 割以内に抑える・殿の本多忠勝隊を崩さずに退く。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退。
 *   全軍撤退を命じても、退き口から離れた部隊を目標に数え、味方が戦場からいなくなるまで打ち切らない（目標を果たせば勝利の撤収、
 *   届かなければ合戦の放棄＝撤退。記録の withdrawal で分ける）。
 *
 * 成り立たせたい作戦（設計 §5。釣り合いは後で）：殿を置いて順に退く（忠勝の守護は役に立つが必須ではない）／全軍で一気に退く（追い討ちで崩れる）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 退き口（南の端） */
const EXIT = { rect: { x0: -60, x1: 60, z0: 190, z1: 220 } };
/** 攻め手の攻め進む先（切れ目の北の口） */
const NECK = { x: 0, z: 70, r: 30 };

export const REARGUARD: BattlefieldDef = {
    id: 'rearguard',
    name: '退却戦',
    kind: 'rearguard',
    summary: '追ってくる敵勢を殿で食い止めながら、総大将と 4 部隊を南の退き口から離脱させる。退く順番と殿の置き場所が分かれ目',
    width: 400,
    depth: 440,
    terrain: [
        // 原の南の崖（切れ目 x -20〜20）
        { kind: 'cliff', rect: { x0: -200, x1: -20, z0: 90, z1: 130 } },
        { kind: 'cliff', rect: { x0: 20, x1: 200, z0: 90, z1: 130 } },
        // 切れ目の北の口の丘（殿の置き場所）
        { kind: 'hill', circle: { cx: -45, cz: 65, r: 25 }, height: 5 },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -220, z1: 220 } },
        // 原の東西の林（追っ手の騎馬が回り込む）
        { kind: 'woods', rect: { x0: -200, x1: -120, z0: -160, z1: 60 } },
        { kind: 'woods', rect: { x0: 120, x1: 200, z0: -160, z1: 60 } },
        // 切れ目の南の湿地（退き口への道の脇。道を外れると遅い）
        { kind: 'marsh', rect: { x0: -200, x1: -40, z0: 140, z1: 185 } },
        { kind: 'marsh', rect: { x0: 40, x1: 200, z0: 140, z1: 185 } },
    ],
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -20, x1: 20, z0: 85, z1: 135 } }, maxEngaged: 2 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 40, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: -10, facing: N, note: '前（正面）' },
            { id: 'left', x: -60, z: 0, facing: N, note: '左' },
            { id: 'right', x: 60, z: 0, facing: N, note: '右' },
            { id: 'archers', x: -25, z: 25, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 30, facing: N, note: '予備' },
            { id: 'cavalry', x: 90, z: 30, facing: N, note: '騎馬' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -200, facing: S, note: '本陣（北）' },
            { id: 'van_l', x: -40, z: -80, facing: S, note: '攻め手（左）' },
            { id: 'van_r', x: 40, z: -80, facing: S, note: '攻め手（右）' },
            { id: 'kiba_l', x: -150, z: -10, facing: S, note: '騎馬（西の林）' },
            { id: 'kiba_r', x: 150, z: -10, facing: S, note: '騎馬（東の林）' },
            { id: 'yumi', x: 0, z: -100, facing: S, note: '弓' },
            { id: 'late', x: 0, z: -210, facing: S, note: '後詰め' },
        ],
    },
    exits: { ally: { x: 0, z: 210 }, enemy: { x: 0, z: -215 } },
    objectives: {
        primary: { id: 'rear_withdraw', type: 'withdraw', label: '総大将と 4 部隊を南の退き口から離脱させる', exit: EXIT, count: 4, name: '南の退き口' },
        secondary: [
            { id: 'rear_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
            { id: 'rear_tadakatsu', type: 'preserve_unit', label: '殿の本多忠勝隊を崩さずに退く（兵 3 割以上）', unitId: 'a_tadakatsu', minRatio: 0.3 },
        ],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'count' },
    pursuit: true,
    generalInitiative: true,
    timeLimitSec: 540,
    briefing: [
        'ゲーム用の演習（架空の相手）。北の原で敵勢と向き合ったまま、南の退き口へ退く。敵勢は始めから南へ攻め進み（東西の林には騎馬が隠れている）、2 分で後詰めが来る。',
        '退き口までの道：原の南の崖の切れ目（幅 40 m。同じ相手へ斬りかかれるのは 2 部隊まで）を抜けて南の端へ。切れ目の北の口の小さな丘は、殿の置き場所（上にいると下から来る相手に強い）。',
        '追い討ち：敵は、撤退の命令で退く部隊を追って斬りかかる（騎馬は遠くから）。忠勝隊の「退路の守護」の範囲の中で退く味方を追う敵は、忠勝隊に阻まれる（使わなくても、殿と退く順番で離脱できる）。',
        '退き口の輪に入った部隊は戦場を離れる（撤退の命令でも移動でもよい）。総大将が退き口から離れても負けではない（合戦は続く）。',
        '勝利：総大将（家康本陣）と、ほかの 4 部隊が退き口から離脱する（目標どおり退けば勝利）。総大将が崩れる・離脱できる部隊が 4 に足りなくなると負け。',
        '副目標：損害を 4 割以内に抑える・殿の本多忠勝隊を崩さずに退く（兵 3 割以上）。',
    ],
    tactics: [
        '殿を置いて順に退く：弓・本陣を先に下げ、忠勝隊を切れ目の北の丘に残して追っ手を受ける。最後に殿が切れ目を抜ける',
        '退路の守護は、殿が退く味方の後ろで受けるときに効く（使わなくても退ける）',
        '全軍で一気に退くと、騎馬に追いつかれて後ろから斬られる（追い討ちで崩れる）',
    ],
    presets: [
        {
            id: 'standard',
            name: '殿の退却',
            summary: '味方 7／敵 7（後詰め 1 を含む）。家康・本多忠勝・榊原康政・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cavalry', 'kiba', 280),
                T.sakai('left'),
                T.ishikawa('right'),
                T.yumi('archers', 300),
                T.kiba('reserve', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_van_l', 'yari', '敵勢の攻め手（左）', 420, 80, 'van_l', { aiRole: 'assault', aiTarget: NECK }),
                E('e_van_r', 'yari', '敵勢の攻め手（右）', 420, 80, 'van_r', { aiRole: 'assault', aiTarget: NECK }),
                E('e_kiba_l', 'kiba', '敵勢の騎馬（西）', 230, 75, 'kiba_l', { aiRole: 'assault', aiTarget: NECK }),
                E('e_kiba_r', 'kiba', '敵勢の騎馬（東）', 230, 75, 'kiba_r', { aiRole: 'assault', aiTarget: NECK }),
                E('e_yumi', 'yumi', '敵勢の弓', 260, 75, 'yumi', { aiRole: 'assault', aiTarget: NECK }),
                E('e_late', 'yari', '敵勢の後詰め', 450, 80, 'late', { aiRole: 'assault', aiTarget: NECK, arriveAt: 120 }),
            ],
        },
    ],
};
