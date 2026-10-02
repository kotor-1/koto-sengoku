/**
 * 戦場「村落」（village）。家屋が通りを分ける村の真ん中の、庄屋の屋敷前を、北から時間差で来る敵勢の波から守る（第3群）。
 *
 * - 340 m × 400 m。村は z -110〜110 で、東西は戦場の端まで家屋が並ぶ（村の外を回る道は無い）。家屋（building）は通れず、射線も遮る。
 * - 南北の通りが 3 本：西の通り（x -80〜-64）・真ん中の通り（x -8〜8）・東の通り（x 64〜80）。北の端から村へ入る。
 *   東西の横道（z -30〜-16）が 3 本の通りをつなぐ。真ん中の通りは庄屋の屋敷（x -30〜30・z -12〜16）に突き当たり、
 *   屋敷の両脇の細い抜け道（x ±30〜40）が南の広場へ通じる。
 * - 柵（fence。通れないが射線は通す）が 2 か所：東の通りの横道より南（z -12〜-6）と、屋敷の西の抜け道（z -4〜2）。
 *   開いた通り（広場へ入れる口）は、西の通りと屋敷の東の抜け道の 2 本。真ん中・東から来る敵は横道を回って東の抜け道へ、西から来る敵は西の通りを下る。
 *   東の通りの柵の内側（柵の南）に弓を置くと、柵越しに東の通りを下ってくる敵を射られる（家屋の陰からは射られない）。
 * - 広場（z 20〜64。東西は家並みの間いっぱい）の真ん中が庄屋の屋敷前（守る地点。中心 (0,42)、半径 22 m）。広場の南に 3 本の通りの南の続き。
 * - 米蔵の前（横道の西の端 (-135,-23)、半径 12 m）：第二波の騎馬は屋敷前ではなく米蔵を荒らしに行く（副目標）。西の通りの北の口（横道との辻）に
 *   味方がいれば、騎馬はそこへ当たる（攻め進む途中 60 m 以内に見えた相手へ当たる）。広場だけを固めると、騎馬は米蔵へ素通りする。
 * - 敵勢：20 秒に真ん中の通りへ槍 2 隊・弓 1 隊、110 秒に西の通りへ槍と騎馬（騎馬は米蔵へ）、200 秒に東の通りへ槍 2 隊・弓 1 隊。
 *   槍は屋敷前へ攻め進む（assault）。弓は横道の真ん中で止まり、射線の通る相手を射る。本陣は北。同時に戦場にいる敵は 9（上限 10）。
 * - 主目標：庄屋の屋敷前を 7 分守る（敵だけが 15 秒続けて屋敷前を占めると負け）。
 *   副目標：損害を 3 割以内・徳川弓隊を崩さない・米蔵を荒らさせない（敵だけが 15 秒続けて米蔵の前を占めると失う）。
 *
 * 成り立つ作戦と違い（数字は tests/proto3d-field-village.test.ts。どれも早送りの台本）：
 * - 広場を固める（主力を屋敷前に集め、予備は後ろ）：損害は少ないが、米蔵は荒らされる。弓を柵の内側へ移すと、第三波を柵越しに射て損害がさらに減る。
 * - 西の辻に二隊を置く（石川隊を辻、酒井隊を西の通りの口）＋柵の内側の弓：米蔵も守れる（主力から二隊を割くので、波の受け方を誤ると崩れる）。
 * - 波を見て予備を回す（第二波の前に酒井隊を西の通りの家並みの間へ）：米蔵も守れるが、後から回した分だけ損害が増える。
 *   横道との辻（横道へ開いた所）まで出て 1 部隊で受けると崩れやすく、石川の差配（士気・足）で支えると持ちこたえる。
 * - 通りの口で正面から受ける（準備した正面攻撃。号令・差配・先駆けを使う）：勝てるが損害が大きい。米蔵は守れる。
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

/** 米蔵の前（村の西の横道の端。第二波の騎馬が荒らしに来る） */
const STORE = { x: -135, z: -23, r: 12 };

/** 攻め手（槍・騎馬は屋敷前へ、弓は横道の真ん中へ攻め進む。aim で行き先を変える） */
const raider = (id: string, kind: 'yari' | 'kiba' | 'yumi', name: string, strength: number, reinf: string, aim?: { x: number; z: number; r: number }): PresetUnit => ({
    ...E(id, kind, name, strength, 80, '', { aiRole: 'assault', aiTarget: aim ?? (kind === 'yumi' ? { x: 0, z: -23, r: 15 } : { ...KEY }) }),
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
        // 屋敷の西の抜け道を塞ぐ柵（射線は通す）
        { kind: 'fence', rect: { x0: -40, x1: -30, z0: -4, z1: 2 } },
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
        { id: 'wave2', side: 'enemy', at: 110, point: { x: -72, z: -195, facing: S }, label: '第二波（西の通り・米蔵へ）' },
        { id: 'wave3', side: 'enemy', at: 200, point: { x: 72, z: -195, facing: S }, label: '第三波（東の通りへ）' },
    ],
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: { id: 'village_hold', type: 'defend_time', label: '庄屋の屋敷前を 7 分守る', sec: 420, zone: { circle: { cx: KEY.x, cz: KEY.z, r: KEY.r } }, loseSec: 15 },
        secondary: [
            { id: 'village_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'village_archers', type: 'preserve_unit', label: '徳川弓隊を崩さずに終える', unitId: 'a_yumi', minRatio: 0.5 },
            { id: 'village_store', type: 'defend_zones', label: '米蔵を荒らさせない', sec: 420, zones: [{ circle: { cx: STORE.x, cz: STORE.z, r: STORE.r } }], minHeld: 1, loseSec: 15, names: ['米蔵の前'] },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 480,
    briefing: [
        'ゲーム用の演習（架空の相手）。家屋が並ぶ村。家屋は通れず、矢も通さない。南北の通りが 3 本（西・真ん中・東）と、北の東西の横道がある。',
        '真ん中の通りは庄屋の屋敷に突き当たる。屋敷の両脇の細い抜け道のうち、西は柵で塞いである。東の通りも横道の南を柵で塞いである（柵は通れないが、矢は通る）。広場へ入れるのは、西の通りと屋敷の東の抜け道の 2 本。',
        '敵勢は北から 3 つの波で来る：20 秒に真ん中の通り、1 分 50 秒に西の通り、3 分 20 秒に東の通り。槍は庄屋の屋敷前へ攻め進む。第二波の騎馬は、横道の西の端の米蔵を荒らしに行く。',
        '味方は村の南に陣取っている。第一波が屋敷前に着く前に、広場へ兵を入れる。',
        '勝利：庄屋の屋敷前（広場の真ん中の輪）を 7 分守る。敵だけが 15 秒続けて輪を占めると負け。',
        '副目標：味方の兵の損害を 3 割以内に抑える・徳川弓隊を崩さずに終える・米蔵を荒らさせない（敵だけが 15 秒続けて米蔵の前を占めると失う）。',
    ],
    tactics: [
        '広場を固めると屋敷前は守りやすいが、米蔵は守れない。米蔵も守るなら、西の通りの北の口（横道との辻）に部隊を置く。騎馬はそこへ当たる',
        '波の来る通りを見て予備を回す。横道との辻（横道へ開いた所）で 1 部隊だけで受けると崩れやすい。家並みの間へ下がって受けるか、石川の差配で支える',
        '弓は東の通りの柵の内側に置くと、柵越しに第三波を射られる。家屋の陰からは射られない。通りの口で正面から受けると、受けた部隊が削られる',
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
                raider('e_w_kiba', 'kiba', '敵勢の第二波の騎馬', 300, 'wave2', STORE),
                raider('e_e_yari1', 'yari', '敵勢の第三波の槍（一）', 450, 'wave3'),
                raider('e_e_yari2', 'yari', '敵勢の第三波の槍（二）', 400, 'wave3'),
                raider('e_e_yumi', 'yumi', '敵勢の第三波の弓', 220, 'wave3'),
            ],
        },
    ],
};
