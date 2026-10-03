/**
 * 戦場「援軍救出」（relief）。北の丘で孤立した味方（浅井長政隊）と合流し、南の安全地点まで連れ帰る（第4群。最初の案）。
 *
 * - 440 m × 480 m。味方の本隊は南（z 150 あたり）。孤立した長政隊は北東の小さな丘（60,-150）で、敵勢に囲まれている。
 * - 合流の輪（丘の上。半径 50 m）と安全地点の輪（南の陣の前。半径 40 m）は別。長政隊とほかの味方が合流の輪に一緒に 5 秒いると「合流」。
 *   その後、長政隊が安全地点の輪に戦える状態で入れば果たす。合流の前に長政隊だけが安全地点へ入っても数えない（接触だけ・能力だけでは果たさない）。
 * - 長政隊の兵は最初の 4 割以上で連れ帰る（出陣前の説明・目標の見出しに出す）。長政隊が崩れる・撤退する・兵が 4 割を切ると負け。
 * - 道：南の陣から北へ真っすぐの街道（x 0）。街道の真ん中に敵勢の押さえ（槍・弓）。西は広い林（中は近づかないと見えない）で、林を北へ抜けると
 *   丘の西へ出る（遠回り・見つかりにくい）。東は開けた原。
 * - 丘を囲む敵勢：攻め手（槍。長政隊へ攻めかかる）・西の囲み（槍。区域を守るが、近くの相手を遠くまで追う＝引き離せる）・東の囲み（騎馬）。
 *   北に本陣と本陣の騎馬。4 分で、北東から敵の援軍（槍）が丘へ来る。
 * - 主目標：長政隊と合流し、安全地点まで退かせる（rescue_escort）。副目標：損害を 3 割 5 分以内に抑える・長政隊の兵を 7 割以上残す。
 * - 編成：味方 7＋救出の対象 1 ＝ 8 部隊（同時に戦場にいる部隊の上限 8 に、救出の対象も数える）。敵 9（援軍を含む。上限 10）。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退（合戦の放棄）。
 *
 * 成り立たせたい作戦（設計 §5。釣り合いは後で）：急いで直接救う（街道を押し上がる）／敵の一部を引き離してから救う（西の林から囲みを誘う）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

/** 孤立した長政隊のいる丘 */
const HILL = { x: 60, z: -150 };
/** 合流の輪（丘の上）・安全地点の輪（南の陣の前） */
const MEET = { circle: { cx: HILL.x, cz: HILL.z, r: 50 } };
const SAFE = { circle: { cx: 0, cz: 175, r: 40 } };

export const RELIEF: BattlefieldDef = {
    id: 'relief',
    name: '援軍救出',
    kind: 'relief',
    summary: '北の丘で孤立した長政隊と合流し、南の安全地点まで連れ帰る。急いで街道を押し上がるか、西の林から囲みを引き離してから救うか',
    width: 440,
    depth: 480,
    terrain: [
        { kind: 'hill', circle: { cx: HILL.x, cz: HILL.z, r: 45 }, height: 6 },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -240, z1: 240 } },
        { kind: 'woods', rect: { x0: -220, x1: -70, z0: -200, z1: 120 } },
        { kind: 'hill', circle: { cx: -30, cz: -10, r: 40 }, height: 5 },
        { kind: 'marsh', rect: { x0: 110, x1: 220, z0: -20, z1: 80 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 200, facing: N, note: '本陣（南の陣）' },
            { id: 'center', x: 0, z: 140, facing: N, note: '街道の前' },
            { id: 'left', x: -60, z: 150, facing: N, note: '左（林の南）' },
            { id: 'right', x: 60, z: 150, facing: N, note: '右' },
            { id: 'archers', x: -25, z: 165, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 175, facing: N, note: '予備' },
            { id: 'cavalry', x: 100, z: 170, facing: N, note: '騎馬' },
            { id: 'isolated', x: HILL.x, z: HILL.z, facing: N, note: '孤立した長政隊（北の丘。北の攻め手へ向く）' },
        ],
        enemy: [
            { id: 'hq', x: -20, z: -215, facing: S, note: '本陣（北）' },
            { id: 'hq_kiba', x: -70, z: -200, facing: S, note: '本陣の騎馬' },
            { id: 'attack', x: 60, z: -205, facing: S, note: '丘の攻め手（北）' },
            { id: 'ring_w', x: 0, z: -140, facing: EAST, note: '丘の西の囲み' },
            { id: 'ring_e', x: 125, z: -150, facing: WEST, note: '丘の東の囲み（騎馬）' },
            { id: 'block', x: 0, z: -20, facing: S, note: '街道の押さえ' },
            { id: 'block_yumi', x: 25, z: -45, facing: S, note: '街道の弓' },
            { id: 'ring_s', x: 60, z: -90, facing: S, note: '丘の南の囲み' },
        ],
    },
    reinforcements: [{ id: 'late', side: 'enemy', at: 240, point: { x: 200, z: -220, facing: S }, label: '敵勢の援軍（丘へ）' }],
    exits: { ally: { x: 0, z: 235 }, enemy: { x: 0, z: -235 } },
    objectives: {
        primary: { id: 'relief_escort', type: 'rescue_escort', label: '長政隊と合流し、南の安全地点まで連れ帰る（兵 4 割以上）', unitId: 'a_nagamasa', meetZone: MEET, safeZone: SAFE, minRatio: 0.4, meetSec: 5 },
        secondary: [
            { id: 'relief_losses', type: 'limit_losses', label: '損害を 3 割 5 分以内に抑える', maxRatio: 0.35 },
            { id: 'relief_keep', type: 'preserve_unit', label: '長政隊の兵を 7 割以上残す', unitId: 'a_nagamasa', minRatio: 0.7 },
        ],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'end' },
    generalInitiative: true,
    timeLimitSec: 660,
    briefing: [
        'ゲーム用の演習（架空の相手）。北東の小さな丘で、味方の浅井長政隊が敵勢に囲まれて孤立している。',
        '合流：長政隊とほかの味方が、丘の上の合流の輪に一緒に 5 秒いると合流する。その後、長政隊を南の安全地点の輪（陣の前）まで連れ帰る。合流の前に長政隊だけを下げても数えない（触れただけ・能力だけでは果たさない）。',
        '救出の条件：長政隊が崩れず、兵が最初の 4 割以上で安全地点へ入ること。崩れる・撤退する・兵が 4 割を切ると負け。',
        '道：南の陣から北へ街道。真ん中に敵勢の押さえ（槍と弓）。西は広い林（中は近づかないと見えない。遠回りだが見つかりにくい）。丘の西の囲みは、近くに来た相手を遠くまで追う（引き離せる）。',
        '4 分で、北東から敵の援軍が丘へ来る。',
        '副目標：損害を 3 割 5 分以内に抑える・長政隊の兵を 7 割以上残す。',
    ],
    tactics: [
        '急いで直接救う：街道の押さえを忠勝隊と弓で止め、騎馬と榊原隊を東の原から丘へ回して合流し、長政隊を連れて下がる（速いが、囲みの中を突っ切る）',
        '引き離してから救う：西の林から酒井隊を出して丘の西の囲みを誘い、空いた西から合流する（遅いが、長政隊の兵が残る）',
        '敵の援軍（4 分）より前に合流しておく。合流したら、長政隊を先に南へ下げ、殿で追っ手を止める',
    ],
    presets: [
        {
            id: 'standard',
            name: '長政隊の救出',
            summary: '味方 7＋救出の対象 1（浅井長政隊）／敵 9（援軍 1 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cavalry', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers', 300),
                T.kiba('right', 250),
                { id: 'a_nagamasa', side: 'ally', clan: 'asai', kind: 'yari', name: '浅井長政隊', generalId: 'nagamasa', strength: 420, morale: 85, ability: 'nagamasa_support', slot: 'isolated' },
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_hq_kiba', 'kiba', '敵勢の本陣の騎馬', 260, 80, 'hq_kiba', { aiRole: 'guard_hq' }),
                E('e_attack', 'yari', '敵勢の丘の攻め手', 360, 80, 'attack', { aiRole: 'assault', aiTarget: { x: HILL.x, z: HILL.z, r: 30 } }),
                E('e_ring_w', 'yari', '敵勢の丘の西の囲み', 380, 80, 'ring_w', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -140, r: 40 }, aiLeash: 160 }),
                E('e_ring_e', 'kiba', '敵勢の丘の東の囲み', 260, 80, 'ring_e', { aiRole: 'hold_zone', aiTarget: { x: 125, z: -150, r: 40 }, aiLeash: 80 }),
                E('e_ring_s', 'yari', '敵勢の丘の南の囲み', 340, 80, 'ring_s', { aiRole: 'hold_zone', aiTarget: { x: 60, z: -90, r: 35 }, aiLeash: 70 }),
                E('e_block', 'yari', '敵勢の街道の押さえ', 450, 85, 'block', { aiRole: 'hold_line' }),
                E('e_block_yumi', 'yumi', '敵勢の街道の弓', 220, 75, 'block_yumi', { aiRole: 'hold_line' }),
                { ...E('e_late', 'yari', '敵勢の援軍（槍）', 380, 80, '', { aiRole: 'assault', aiTarget: { x: HILL.x, z: HILL.z, r: 30 } }), slot: undefined, reinforcement: 'late' },
            ],
        },
    ],
};
