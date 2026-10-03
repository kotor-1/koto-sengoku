/**
 * 戦場「包囲された陣」（besieged_camp）。四方を敵勢に囲まれた陣から、総大将と 3 部隊を包囲の外の出口へ脱出させる（第4群。最初の案）。
 *
 * - 440 m × 440 m。味方の陣は真ん中（低い丘の上。周りを柵で囲み、北・南・東に口）。
 * - 敵勢は四方に陣取る：北に本陣と押さえ（槍）・後詰めの騎馬、西に槍と騎馬（回り込む）、南の突破口に厚い守り（槍・弓）、
 *   東の回り道の口に薄い守り（槍 1）。
 * - 出口は 2 つ（どちらも戦場の縁）：
 *   - 南の突破口：陣から真南へ 190 m。南の崖（z 110〜130）の切れ目（x -25〜25。幅 50 m。狭い正面：同じ相手へ 2 部隊まで）の先。
 *     切れ目の南に厚い守り（槍 460・弓 220）。短いが、守りを破らないと抜けられない。
 *   - 東の回り道：陣から東へ出て、東の端の抜け道（崖の東の端 x 160〜220）を南へ下り、南東の角の出口へ。400 m ほど。守りは薄い（槍 260）が、
 *     遠いので、西・北の敵が追いつく。
 *   - 味方の退き口（撤退の命令の行き先）は南の突破口の出口の中（撤退で退いた部隊も脱出に数える）。
 * - 主目標：総大将（家康本陣）と、ほかの 3 部隊が出口から脱出する（escape。敵本陣の撃破ではない）。総大将が出口から離れても負けではない
 *   （合戦は、残りの部隊が出るか、果たせなくなるまで続く）。総大将が崩れる・出られる部隊が 3 に足りなくなると負け。
 *   副目標：損害を 4 割以内に抑える・徳川弓隊を崩さずに連れ出す。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退（退き口から離れた部隊も数える）。
 * - 追い討ち（pursuit）：敵は撤退の命令で退く部隊を追う。
 *
 * 成り立たせたい作戦（設計 §5。釣り合いは後で）：先に突破口を開いてから総大将を出す／厚い口を準備して破る（速い・損害大）／手薄な回り道（遅い・追われる）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;
const E_ = Math.PI / 2;
const W_ = -Math.PI / 2;

/** 南の突破口の出口（戦場の南の縁） */
const EXIT_SOUTH = { rect: { x0: -40, x1: 40, z0: 200, z1: 220 } };
/** 東の回り道の出口（南東の角） */
const EXIT_EAST = { rect: { x0: 165, x1: 220, z0: 200, z1: 220 } };
/** 南の突破口の守り（切れ目の南） */
const SOUTH_GUARD = { x: 0, z: 150, r: 35 };
/** 東の抜け道の守り */
const EAST_GUARD = { x: 190, z: 120, r: 30 };

export const BESIEGED_CAMP: BattlefieldDef = {
    id: 'besieged_camp',
    name: '包囲された陣',
    kind: 'besieged_camp',
    summary: '四方を囲まれた陣から、総大将と 3 部隊を包囲の外へ脱出させる。短いが守りの厚い南の突破口か、遠いが手薄な東の回り道か',
    width: 440,
    depth: 440,
    terrain: [
        // 陣（低い丘）と、陣を囲む柵（北・南・東に口）
        { kind: 'hill', circle: { cx: 0, cz: 0, r: 70 }, height: 4 },
        { kind: 'fence', rect: { x0: -55, x1: -15, z0: -60, z1: -50 } },
        { kind: 'fence', rect: { x0: 15, x1: 55, z0: -60, z1: -50 } },
        { kind: 'fence', rect: { x0: -60, x1: -50, z0: -60, z1: 60 } },
        { kind: 'fence', rect: { x0: 50, x1: 60, z0: -60, z1: -15 } },
        { kind: 'fence', rect: { x0: 50, x1: 60, z0: 15, z1: 60 } },
        { kind: 'fence', rect: { x0: -55, x1: -15, z0: 50, z1: 60 } },
        { kind: 'fence', rect: { x0: 15, x1: 55, z0: 50, z1: 60 } },
        // 南の崖（切れ目 x -25〜25 と、東の端の抜け道 x 160〜220 を残す）
        { kind: 'cliff', rect: { x0: -220, x1: -25, z0: 110, z1: 130 } },
        { kind: 'cliff', rect: { x0: 25, x1: 160, z0: 110, z1: 130 } },
        // 道：陣から南の突破口へ・東の回り道（東へ出て抜け道を南へ）
        { kind: 'road', rect: { x0: -6, x1: 6, z0: 60, z1: 220 } },
        { kind: 'road', rect: { x0: 60, x1: 195, z0: -6, z1: 6 } },
        { kind: 'road', rect: { x0: 185, x1: 195, z0: 0, z1: 220 } },
        // 西の林（西の敵勢の騎馬が隠れる）・北東の湿地（回り道を北から追う敵の足を止める）
        { kind: 'woods', rect: { x0: -220, x1: -140, z0: -120, z1: 60 } },
        { kind: 'marsh', rect: { x0: 90, x1: 170, z0: -120, z1: -40 } },
    ],
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -25, x1: 25, z0: 105, z1: 135 } }, maxEngaged: 2 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 0, facing: S, note: '本陣（陣の真ん中）' },
            { id: 'south', x: 0, z: 35, facing: S, note: '陣の南の口' },
            { id: 'north', x: 0, z: -35, facing: N, note: '陣の北の口' },
            { id: 'east', x: 35, z: 0, facing: E_, note: '陣の東の口' },
            { id: 'west', x: -35, z: 0, facing: W_, note: '陣の西（柵の内）' },
            { id: 'archers', x: -25, z: 30, facing: S, note: '弓（陣の南西）' },
            { id: 'reserve', x: 25, z: 30, facing: S, note: '騎馬（陣の南東）' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -190, facing: S, note: '本陣（北）' },
            { id: 'north', x: 0, z: -120, facing: S, note: '北の押さえ' },
            { id: 'north_kiba', x: 60, z: -170, facing: S, note: '北の後詰め（騎馬）' },
            { id: 'west', x: -120, z: -10, facing: E_, note: '西の槍' },
            { id: 'west_kiba', x: -175, z: -60, facing: E_, note: '西の騎馬（林の中）' },
            { id: 'south', x: 0, z: 150, facing: N, note: '南の突破口の守り（槍）' },
            { id: 'south_yumi', x: 0, z: 180, facing: N, note: '南の突破口の弓' },
            { id: 'east', x: 190, z: 120, facing: N, note: '東の抜け道の守り（薄い）' },
        ],
    },
    exits: { ally: { x: 0, z: 212 }, enemy: { x: 0, z: -215 } },
    objectives: {
        primary: { id: 'camp_escape', type: 'escape', label: '総大将と 3 部隊が包囲の外へ脱出する', exits: [EXIT_SOUTH, EXIT_EAST], count: 3, names: ['南の突破口の出口', '東の回り道の出口'] },
        secondary: [
            { id: 'camp_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
            { id: 'camp_yumi', type: 'preserve_unit', label: '徳川弓隊を崩さずに連れ出す（兵 5 割以上）', unitId: 'a_yumi', minRatio: 0.5 },
        ],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'count' },
    pursuit: true,
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。味方の陣（真ん中の低い丘。柵で囲み、北・南・東に口）は、四方を敵勢に囲まれている。',
        '出口は 2 つ。南の突破口（陣から真南へ 190 m。崖の切れ目は幅 50 m で、同じ相手へ斬りかかれるのは 2 部隊まで。切れ目の南に厚い守り：槍と弓）と、東の回り道（陣から東へ出て、東の端の抜け道を南へ下る 400 m。守りは槍 1 隊だけ）。',
        '出口の輪に入った部隊は、包囲の外へ脱出して戦場を離れる（撤退済み。兵は残る）。総大将が出口から離れても負けではない（合戦は続く）。',
        '勝利：総大将（家康本陣）と、ほかの 3 部隊が脱出する。総大将が崩れる・脱出できる部隊が 3 に足りなくなると負け。',
        '副目標：損害を 4 割以内に抑える・徳川弓隊を崩さずに連れ出す（兵 5 割以上）。',
        '追い討ち：敵は、撤退の命令で退く部隊を追って斬りかかる。全軍撤退を命じた部隊は南の突破口の出口へ向かい、出口から離れれば脱出に数える。',
    ],
    tactics: [
        '先に突破口を開く：弓と槍で南の守りを崩してから、総大将を出す（総大将を先に出すと、残りの部隊が囲まれる）',
        '厚い口を準備して破る：切れ目の前に槍を並べ、弓で守りの槍を射てから二隊で当たる（速いが損害が大きい）',
        '手薄な回り道：東へ出て抜け道を下る。遠いので、西・北の敵が追ってくる。殿を残して順に下る',
    ],
    presets: [
        {
            id: 'standard',
            name: '陣の脱出',
            summary: '味方 7／敵 8。家康・本多忠勝・榊原康政・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('south'),
                T.sakakibara('east', 'yari', 380),
                T.sakai('north'),
                T.ishikawa('west'),
                T.yumi('archers', 300),
                T.kiba('reserve', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_north', 'yari', '敵勢の北の押さえ', 480, 80, 'north', { aiRole: 'hold_line', aiLeash: 150 }),
                E('e_north_kiba', 'kiba', '敵勢の北の騎馬', 280, 80, 'north_kiba', { aiRole: 'reserve' }),
                E('e_west', 'yari', '敵勢の西の槍', 420, 80, 'west', { aiRole: 'hold_line', aiLeash: 150 }),
                E('e_west_kiba', 'kiba', '敵勢の西の騎馬', 280, 80, 'west_kiba', { aiRole: 'flank' }),
                E('e_south', 'yari', '敵勢の南の守り', 460, 80, 'south', { aiRole: 'hold_zone', aiTarget: SOUTH_GUARD, aiLeash: 60 }),
                E('e_south_yumi', 'yumi', '敵勢の南の弓', 220, 75, 'south_yumi', { aiRole: 'hold_line' }),
                E('e_east', 'yari', '敵勢の東の守り', 260, 70, 'east', { aiRole: 'hold_zone', aiTarget: EAST_GUARD, aiLeash: 50 }),
            ],
        },
    ],
};
