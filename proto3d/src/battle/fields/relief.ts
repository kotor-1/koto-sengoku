/**
 * 戦場「援軍救出」（relief）。北の丘で孤立した味方（浅井長政隊）と合流し、南の安全地点まで連れ帰る（第4群）。
 *
 * - 440 m × 480 m。味方の本隊は南（z 150 あたり）。孤立した長政隊は北東の小さな丘（60,-150）。
 * - 合流の輪（丘の上。半径 50 m）と安全地点の輪（南の陣の前。半径 40 m）は別。長政隊とほかの味方が合流の輪に一緒に 5 秒いると「合流」。
 *   その後、長政隊が安全地点の輪に戦える状態で入れば果たす。合流の前に長政隊だけが安全地点へ入っても数えない（接触だけ・能力だけでは果たさない）。
 * - 長政隊の兵は最初の 4 割以上で連れ帰る（出陣前の説明・目標の見出しに出す）。長政隊が崩れる・撤退する・兵が 4 割を切ると負け。
 * - 丘を囲む敵勢（それぞれ持ち場の役割が違う）：
 *   - 丘の南の囲み（槍・強い）：丘の南（60,-85）の区域を守る。南から真っすぐ丘へ上がる道を塞ぐ。崩せば南の退き道が開く。
 *   - 丘の西の囲み（槍）：西（-35,-150）の持ち場を保つ。矢を浴び続けると射手へ打って出て、持ち場から 200 m まで追う（弓で誘い出せる）。
 *   - 丘の東の囲み（騎馬）：南の囲みの東（120,-95）の区域を守る。南の囲みへ東から当たる隊を横から突く。
 *   - 丘の攻め手（槍・弱い）：始めに長政隊へ攻めかかるが、丘の上の長政隊が退ける。
 * - 中央（10,-5）に敵勢の押さえ（槍・強い。小さな区域だけを守る）、東の原（100,-30）に敵勢の弓。南の陣から丘へ真っすぐ向かうと押さえに当たる。
 *   西は広い林（-220〜-70。中は近づかないと見えない）、林の東の縁に沿って西の筋（x -58 あたり）が北へ通る。西の筋の小丘（-60,30）。東は湿地。
 * - 敵の本陣は北西の林の奥（-140,-225）。4 分（240 秒）で、北東（200,-220）から敵の援軍（槍）が丘へ攻めかかる（合流が遅れると長政隊が危ない）。
 * - 主目標：長政隊と合流し、安全地点まで退かせる（rescue_escort）。副目標：損害を 1 割以内・長政隊の兵を 7 割以上・丘の南の囲みを崩す。
 * - 編成：味方 7＋救出の対象 1 ＝ 8 部隊（同時に戦場にいる部隊の上限 8 に、救出の対象も数える）。敵 9（援軍を含む。上限 10）。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退（合戦の放棄）。
 * - 道探しの格子（pathfinding）を付ける：通れない所は無いが、味方同士の詰まりの決まり（RULES.allyBlockSec の短い迂回・すり抜け）は
 *   格子のある戦場でしか働かないため（sim.ts の allyOnlyBlock）。
 *
 * 成り立つ作戦（釣り合いと数字は tests/proto3d-field-relief.test.ts）：
 * - 急いで直接救う：東の原を上がり、騎馬で東の原の弓を崩し、4 部隊と弓で南の囲みを一度に破る。合流したら長政隊を東の原から下げる
 *   （速いが損害が大きい。南の囲みを崩す副目標を果たす）。
 * - 引き離してから救う：弓が西の筋を上がって西の囲みを射て誘い出し、西の筋で待つ忠勝隊・酒井隊の間へ引き込んで叩く。その間に林の北の縁に
 *   隠れた騎馬が丘の西から入って合流し、長政隊を西の筋から下げる（遅いが損害が小さく、長政隊の兵が残る）。
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
    summary: '北の丘で孤立した長政隊と合流し、南の安全地点まで連れ帰る。南の囲みを破って急いで救うか、西の囲みを弓で誘い出してから救うか',
    width: 440,
    depth: 480,
    pathfinding: true,
    terrain: [
        { kind: 'hill', circle: { cx: HILL.x, cz: HILL.z, r: 45 }, height: 6 },
        { kind: 'woods', rect: { x0: -220, x1: -70, z0: -200, z1: 120 } },
        { kind: 'hill', circle: { cx: -60, cz: 30, r: 30 }, height: 5 },
        { kind: 'marsh', rect: { x0: 110, x1: 220, z0: -20, z1: 80 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 200, facing: N, note: '本陣（南の陣）' },
            { id: 'center', x: 0, z: 140, facing: N, note: '中央' },
            { id: 'left', x: -60, z: 150, facing: N, note: '左（林の南）' },
            { id: 'right', x: 60, z: 150, facing: N, note: '右' },
            { id: 'archers', x: -25, z: 165, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 175, facing: N, note: '予備' },
            { id: 'cavalry', x: 100, z: 170, facing: N, note: '騎馬' },
            { id: 'isolated', x: HILL.x, z: HILL.z, facing: N, note: '孤立した長政隊（北の丘。北の攻め手へ向く）' },
        ],
        enemy: [
            { id: 'hq', x: -140, z: -225, facing: S, note: '本陣（北西の林の奥）' },
            { id: 'hq_kiba', x: -105, z: -215, facing: S, note: '本陣の騎馬' },
            { id: 'attack', x: 60, z: -205, facing: S, note: '丘の攻め手（北）' },
            { id: 'ring_w', x: -35, z: -150, facing: EAST, note: '丘の西の囲み（矢を嫌うと打って出て遠くまで追う）' },
            { id: 'ring_e', x: 120, z: -95, facing: WEST, note: '丘の東の囲み（騎馬）' },
            { id: 'ring_s', x: 60, z: -85, facing: S, note: '丘の南の囲み' },
            { id: 'block', x: 10, z: -5, facing: S, note: '中央の押さえ' },
            { id: 'block_yumi', x: 100, z: -30, facing: S, note: '東の原の弓' },
        ],
    },
    reinforcements: [{ id: 'late', side: 'enemy', at: 240, point: { x: 200, z: -220, facing: S }, label: '敵勢の援軍（丘へ）' }],
    exits: { ally: { x: 0, z: 235 }, enemy: { x: 0, z: -235 } },
    objectives: {
        primary: { id: 'relief_escort', type: 'rescue_escort', label: '長政隊と合流し、南の安全地点まで連れ帰る（兵 4 割以上）', unitId: 'a_nagamasa', meetZone: MEET, safeZone: SAFE, minRatio: 0.4, meetSec: 5 },
        secondary: [
            { id: 'relief_losses', type: 'limit_losses', label: '損害を 1 割以内に抑える', maxRatio: 0.1 },
            { id: 'relief_keep', type: 'preserve_unit', label: '長政隊の兵を 7 割以上残す', unitId: 'a_nagamasa', minRatio: 0.7 },
            { id: 'relief_break', type: 'break_unit', label: '丘の南の囲みを崩す（南の退き道を開く）', unitId: 'e_ring_s' },
        ],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'end' },
    generalInitiative: true,
    timeLimitSec: 660,
    briefing: [
        'ゲーム用の演習（架空の相手）。北東の小さな丘で、味方の浅井長政隊が敵勢に囲まれて孤立している。',
        '合流：長政隊とほかの味方が、丘の上の合流の輪に一緒に 5 秒いると合流する。その後、長政隊を南の安全地点の輪（陣の前）まで連れ帰る。合流の前に長政隊だけを下げても数えない（触れただけ・能力だけでは果たさない）。',
        '救出の条件：長政隊が崩れず、兵が最初の 4 割以上で安全地点へ入ること。崩れる・撤退する・兵が 4 割を切ると負け。',
        '丘の囲み：南の囲み（槍・強い）が南の道を塞ぎ、その東に騎馬が控える。西の囲み（槍）は持ち場を保つが、矢を浴び続けると射手へ打って出て遠くまで追う（誘い出せる）。',
        '道：中央に敵勢の押さえ（真っすぐ丘へ向かうと当たる）、東の原に敵勢の弓。西は広い林（中は近づかないと見えない）、林の東の縁に沿って西の筋が北へ通る。東は湿地。',
        '4 分で、北東から敵の援軍が丘へ攻めかかる。それまでに合流しておく。',
        '副目標：損害を 1 割以内に抑える・長政隊の兵を 7 割以上残す・丘の南の囲みを崩す。',
    ],
    tactics: [
        '急いで直接救う：東の原を上がり、騎馬で東の原の弓を崩してから、4 部隊と弓で南の囲みを一度に破る。合流したら長政隊を東の原から下げる（速いが損害が大きい）',
        '引き離してから救う：弓を西の筋から上げて西の囲みを射る。打って出た囲みを、西の筋で待つ忠勝隊と酒井隊の間へ引き込んで叩き、その間に林の北の縁に隠した騎馬で丘の西から合流する（遅いが、損害が小さく長政隊の兵が残る）',
        '石川隊の後詰めの差配で、合流した長政隊を速く退かせる（敵の援軍に追われる時ほど効く）。中央の押さえへ真っすぐ向かうと、無駄な戦いになる',
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
                E('e_hq', 'honjin', '敵勢の本陣', 400, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_hq_kiba', 'kiba', '敵勢の本陣の騎馬', 340, 80, 'hq_kiba', { aiRole: 'guard_hq' }),
                E('e_attack', 'yari', '敵勢の丘の攻め手', 280, 75, 'attack', { aiRole: 'assault', aiTarget: { x: HILL.x, z: HILL.z, r: 30 } }),
                // 西の囲み：持ち場を保つ（hold_line）。矢を浴び続けると射手へ打って出て、持ち場から 200 m まで追う（弓で誘い出せる）。
                // 持ち場は丘の上の長政隊から 90 m より離す（近くに相手の槍がいると持ち場を離れない＝誘い出せない。ai.ts の provokeCalm）
                E('e_ring_w', 'yari', '敵勢の丘の西の囲み', 480, 85, 'ring_w', { aiRole: 'hold_line', aiLeash: 200 }),
                E('e_ring_e', 'kiba', '敵勢の丘の東の囲み', 280, 80, 'ring_e', { aiRole: 'hold_zone', aiTarget: { x: 120, z: -95, r: 30 }, aiLeash: 60 }),
                E('e_ring_s', 'yari', '敵勢の丘の南の囲み', 600, 85, 'ring_s', { aiRole: 'hold_zone', aiTarget: { x: 60, z: -85, r: 30 }, aiLeash: 70 }),
                E('e_block', 'yari', '敵勢の中央の押さえ', 600, 85, 'block', { aiRole: 'hold_zone', aiTarget: { x: 10, z: -5, r: 18 }, aiLeash: 35 }),
                E('e_block_yumi', 'yumi', '敵勢の東の原の弓', 280, 80, 'block_yumi', { aiRole: 'hold_line' }),
                { ...E('e_late', 'yari', '敵勢の援軍（槍）', 450, 85, '', { aiRole: 'assault', aiTarget: { x: HILL.x, z: HILL.z, r: 30 } }), slot: undefined, reinforcement: 'late' },
            ],
        },
    ],
};
