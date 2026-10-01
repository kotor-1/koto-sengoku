/**
 * 戦場「村落」（village）。家屋が通りを分ける村の真ん中の、庄屋の屋敷前を、北から波のように来る敵勢から守る（第3群の最初の案）。
 *
 * - 340 m × 400 m。村は z -110〜110 で、東西は戦場の端まで家屋が並ぶ（村の外を回る道は無い）。家屋（building）は通れず、射線も遮る。
 * - 南北の通りが 3 本：西の通り（x -80〜-64）・真ん中の通り（x -8〜8）・東の通り（x 64〜80）。北の端から村へ入る。
 *   東西の横道（z -30〜-16）が 3 本の通りをつなぐ。真ん中の通りは庄屋の屋敷（x -30〜30・z -12〜16）に突き当たり、
 *   屋敷の両脇の細い抜け道（x ±30〜40）から南の広場へ出る。
 * - 柵（fence）：東の通りの、横道より南（z -12〜-6）を柵で塞ぐ（通れないが、射線は通す）。東から来る敵は、横道を回って屋敷の東の抜け道から広場へ出る。
 *   広場の東から、柵越しに東の通りの北を射られる。
 * - 広場（x -64〜64・z 20〜64）の真ん中が庄屋の屋敷前（守る地点。中心 (0,42)、半径 22 m）。広場の南に 3 本の通りの南の続き。
 * - 敵勢：20 秒に真ん中の通りへ槍 2 隊・弓 1 隊、110 秒に西から槍と騎馬、200 秒に東から槍 2 隊・弓 1 隊。どれも屋敷前へ攻め進む（assault）。本陣は北。
 * - 主目標：庄屋の屋敷前を 7 分守る（敵だけが 15 秒続けて屋敷前を占めると負け）。副目標：損害を 3 割以内・徳川弓隊を崩さない・西から来る騎馬を崩す。
 *
 * 成り立たせたい作戦（設計 §4。釣り合いは後の担当）：
 * - 主力を一つの通りの出口に置き、予備で次の波の通りへ回る（波ごとに組み替える）。
 * - 通りごとに分けて置く（薄い。1 部隊で 2 部隊を受ける所ができる）。
 * - 柵の内側（広場の東）に弓を置き、東の通りを来る敵を柵越しに射る（柵は射線を通す。家屋は通さない）。
 */
import type { BattlefieldDef, PresetUnit } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 家屋（四角の building。同じ列の家は隙間なく並べる＝通れない帯。表示で 1 軒ずつ少し離して描く） */
const house = (x0: number, x1: number, z0: number, z1: number): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height: 6 });

/** 守る地点（庄屋の屋敷前） */
const KEY = { x: 0, z: 42, r: 22 };

/** 攻め手（屋敷前へ攻め進む） */
const raider = (id: string, kind: 'yari' | 'kiba' | 'yumi', name: string, strength: number, reinf: string): PresetUnit => ({
    ...E(id, kind, name, strength, 80, '', { aiRole: 'assault', aiTarget: kind === 'yumi' ? { x: 0, z: -23, r: 15 } : { ...KEY } }),
    slot: undefined,
    reinforcement: reinf,
});

export const VILLAGE: BattlefieldDef = {
    id: 'village',
    name: '村落',
    kind: 'village',
    summary: '家屋が通りを分ける村。北から波のように来る敵勢から、庄屋の屋敷前を守る。通りを見て主力と予備を組み替える',
    width: 340,
    depth: 400,
    terrain: [
        // 北の列（z -110〜-30）：通りの間に家屋
        house(-170, -125, -110, -70),
        house(-125, -80, -110, -70),
        house(-170, -125, -70, -30),
        house(-125, -80, -70, -30),
        house(-64, -36, -110, -70),
        house(-36, -8, -110, -70),
        house(-64, -36, -70, -30),
        house(-36, -8, -70, -30),
        house(8, 36, -110, -70),
        house(36, 64, -110, -70),
        house(8, 36, -70, -30),
        house(36, 64, -70, -30),
        house(80, 125, -110, -70),
        house(125, 170, -110, -70),
        house(80, 125, -70, -30),
        house(125, 170, -70, -30),
        // 真ん中の列（z -16〜20）：屋敷と、その両脇の家（抜け道 x ±30〜40 を残す）。東西の端は家
        house(-170, -80, -16, 20),
        house(-64, -40, -16, 20),
        { kind: 'building', rect: { x0: -30, x1: 30, z0: -12, z1: 16 }, height: 8 }, // 庄屋の屋敷
        house(40, 64, -16, 20),
        house(80, 170, -16, 20),
        // 南の列（z 64〜110）
        house(-170, -125, 64, 110),
        house(-125, -80, 64, 110),
        house(-64, -36, 64, 110),
        house(-36, -8, 64, 110),
        house(8, 36, 64, 110),
        house(36, 64, 64, 110),
        house(80, 125, 64, 110),
        house(125, 170, 64, 110),
        // 東の通りを横道の南で塞ぐ柵（射線は通す）
        { kind: 'fence', rect: { x0: 64, x1: 80, z0: -12, z1: -6 } },
        // 通り（道）
        { kind: 'road', rect: { x0: -80, x1: -64, z0: -200, z1: 200 } },
        { kind: 'road', rect: { x0: -8, x1: 8, z0: -200, z1: -16 } },
        { kind: 'road', rect: { x0: -8, x1: 8, z0: 64, z1: 200 } },
        { kind: 'road', rect: { x0: 64, x1: 80, z0: -200, z1: 200 } },
        // 北の村の外の林（敵の来る側）
        { kind: 'woods', rect: { x0: -170, x1: -100, z0: -200, z1: -150 } },
        { kind: 'woods', rect: { x0: 100, x1: 170, z0: -200, z1: -150 } },
    ],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 175, facing: N, note: '本陣（村の南）' },
            { id: 'center', x: 0, z: 135, facing: N, note: '真ん中の通りの南の口' },
            { id: 'left', x: -72, z: 135, facing: N, note: '西の通りの南の口' },
            { id: 'right', x: 72, z: 135, facing: N, note: '東の通りの南の口' },
            { id: 'archers', x: -32, z: 150, facing: N, note: '弓' },
            { id: 'reserve', x: 32, z: 150, facing: N, note: '予備' },
            { id: 'south', x: 110, z: 160, facing: N, note: '南東（騎馬）' },
        ],
        enemy: [{ id: 'hq', x: 0, z: -180, facing: S, note: '本陣（北）' }],
    },
    reinforcements: [
        { id: 'wave1', side: 'enemy', at: 20, point: { x: 0, z: -195, facing: S }, label: '第一波（真ん中の通りへ）' },
        { id: 'wave2', side: 'enemy', at: 110, point: { x: -72, z: -195, facing: S }, label: '第二波（西の通りへ）' },
        { id: 'wave3', side: 'enemy', at: 200, point: { x: 72, z: -195, facing: S }, label: '第三波（東の通りへ）' },
    ],
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: { id: 'village_hold', type: 'defend_time', label: '庄屋の屋敷前を 7 分守る', sec: 420, zone: { circle: { cx: KEY.x, cz: KEY.z, r: KEY.r } }, loseSec: 15 },
        secondary: [
            { id: 'village_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'village_archers', type: 'preserve_unit', label: '徳川弓隊を崩さずに終える', unitId: 'a_yumi', minRatio: 0.5 },
            { id: 'village_kiba', type: 'break_unit', label: '西から来る騎馬を崩す', unitId: 'e_w_kiba' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。家屋が並ぶ村。家屋は通れず、矢も通さない。南北の通りが 3 本（西・真ん中・東）と、北の東西の横道がある。',
        '真ん中の通りは庄屋の屋敷に突き当たり、屋敷の両脇の細い抜け道から南の広場へ出る。東の通りは横道の南を柵で塞いである（柵は通れないが、矢は通る）。',
        '敵勢は北から 3 つの波で来る：20 秒に真ん中の通り、1 分 50 秒に西の通り、3 分 20 秒に東から。どれも庄屋の屋敷前へ攻め進む。',
        '味方は村の南に陣取っている。第一波が屋敷前に着く前に、広場へ兵を入れる。',
        '勝利：庄屋の屋敷前（広場の真ん中の輪）を 7 分守る。敵だけが 15 秒続けて輪を占めると負け。',
        '副目標：味方の兵の損害を 3 割以内に抑える・徳川弓隊を崩さずに終える・西から来る騎馬を崩す。',
    ],
    tactics: [
        '主力を通りの出口（広場の口）に置き、予備（石川隊）を次の波の通りへ回す。波の来る通りを見て組み替える',
        '通りごとに 1 部隊ずつ分けて置くと薄い（2 部隊の波を 1 部隊で受ける）。抜け道は細いので、出口で待つ方が強い',
        '弓は広場の東、柵の内側に置くと、柵越しに東の通りを射られる（家屋の陰の相手は射られない）',
    ],
    presets: [
        {
            id: 'standard',
            name: '屋敷前の守り',
            summary: '味方 7／敵 9（3 つの波 8 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('south', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('right', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                raider('e_c_yari1', 'yari', '敵勢の第一波の槍（一）', 450, 'wave1'),
                raider('e_c_yari2', 'yari', '敵勢の第一波の槍（二）', 400, 'wave1'),
                raider('e_c_yumi', 'yumi', '敵勢の第一波の弓', 220, 'wave1'),
                raider('e_w_yari', 'yari', '敵勢の第二波の槍', 450, 'wave2'),
                raider('e_w_kiba', 'kiba', '敵勢の第二波の騎馬', 300, 'wave2'),
                raider('e_e_yari1', 'yari', '敵勢の第三波の槍（一）', 450, 'wave3'),
                raider('e_e_yari2', 'yari', '敵勢の第三波の槍（二）', 400, 'wave3'),
                raider('e_e_yumi', 'yumi', '敵勢の第三波の弓', 220, 'wave3'),
            ],
        },
    ],
};
