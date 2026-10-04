/**
 * 戦場「夜襲・奇襲」（night_raid）。夜のうちに、北の敵勢の陣（拠点）を制圧する（第4群）。
 *
 * - 440 m × 440 m。夜（night）：敵も味方も、発見した相手だけが見える。未発見の相手は 70 m まで近づくと見つかる。見つけた相手は 120 m より
 *   離れると見失う。斬り合う・矢を射ると、その相手に見つかる。画面では未発見の敵の名札・兵士・札・地図の印を出さない（色は少し暗くするだけ）。
 * - 夜の林（terrainRules.woods）：中の部隊は 40 m まで見つからない（昼の林の 60 m より暗い）。動きは ×0.6（昼の林 ×0.5 より少し速い。
 *   杣道を知る案内がいる、という作り）。
 * - 奇襲（specialRules の woods_ambush。夜は林の外でも働く）：まだ見つかっていない・見つかって 15 秒以内の部隊が斬りかかると、
 *   最初の 8 秒は与える損害 ×1.5（敵も同じ）。
 * - 敵勢の陣（拠点）は北の真ん中（0,-120）。柵で囲み、口は西（畦の道。幅 44 m）と南（街道。幅 20 m）。北は開いている。陣の中は篝火
 *   （中にいる部隊は 160 m から見つかる）。
 * - 経路は 2 つ：
 *   - 近いが警戒の厚い街道（x 0）：南の味方の陣から北へ 300 m。辻の篝火（0,20）に番兵と辻の弓、街道の東の丘に物見（110 m 先まで見つける）、
 *     その東に見回りの騎馬。番兵が押されると、陣の後詰めが街道へ駆け出す（敵の考えの reserve：押されている味方の相手へ向かう）。
 *   - 長いが見つかりにくい西の道：西の広い林（x -220〜-75）を北へ抜け、林の北東の端から畦の道（z -120）を東へ 35 m で陣の西の口。
 *     林の端（陣の真ん中から 80 m ほど）までは、物見にも陣の篝火の中の敵にも見つからない（物見から林の端・西の口までは 110 m より遠い）。
 * - 敵勢 8：陣の守り（槍。陣の区域を守る）・陣の弓・後詰め（槍。reserve）・本陣（陣の北東。guard_hq）・番兵・辻の弓・物見・見回りの騎馬。
 *   敵の考えも、発見した相手だけを狙い、追う。
 * - 主目標：陣（半径 40 m）を、敵のいない状態で味方が 45 秒続けて占める（hold_point。敵本陣の撃破ではない）。
 *   副目標：損害を 2 割 5 分以内に抑える・物見を崩す・徳川騎馬隊を兵 6 割以上で残す（隠れて近づくと騎馬を南の陣に残せる。正面は騎馬を斬り合いの
 *   横へ出すので途中で 6 割を切りやすい）。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没（夜明け） → 全軍撤退（合戦の放棄）。
 *
 * 作戦（釣り合いの数字は tests/proto3d-field-night_raid.test.ts）：隠れて近づく（林。遅いが見つからずに当たれ、物見は崩さない。騎馬を残せる）／
 * 陽動して隠れて近づく（弓と騎馬で辻の番兵を押して後詰めを動かし、その間に林の組が陣へ。損害がいちばん小さい）／
 * 準備した正面攻撃（街道。弓で番兵を誘い出し、槍 3 隊で同じ敵へ、騎馬は予備。物見を崩せる）／無計画に街道を押し上がる（早いが損害が大きい）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;
const EAST = Math.PI / 2;

/** 敵勢の陣（拠点。主目標の区域） */
const CAMP = { x: 0, z: -120 };
/** 物見の見張りの地点 */
const WATCH = { x: 40, z: -30 };
/** 番兵（街道の辻の篝火） */
const PICKET = { x: 0, z: 25 };

export const NIGHT_RAID: BattlefieldDef = {
    id: 'night_raid',
    name: '夜襲・奇襲',
    kind: 'night_raid',
    summary: '夜、発見した相手だけが見える。北の敵陣を制圧する。近いが篝火・番兵・物見の厚い街道か、長いが見つかりにくい西の林と畦の道か',
    width: 440,
    depth: 440,
    terrain: [
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -220, z1: 220 } },
        // 西の広い林（見つかりにくいが遅い）と、林の北の端から陣の西の口への畦の道（林の外は 35 m だけ）
        { kind: 'woods', rect: { x0: -220, x1: -75, z0: -175, z1: 150 } },
        { kind: 'road', rect: { x0: -75, x1: -40, z0: -126, z1: -114 } },
        // 陣の柵（西の口は畦の道、南の口は街道。北は開いている）
        { kind: 'fence', rect: { x0: -45, x1: -35, z0: -170, z1: -142 } },
        { kind: 'fence', rect: { x0: -45, x1: -35, z0: -98, z1: -80 } },
        { kind: 'fence', rect: { x0: 35, x1: 45, z0: -170, z1: -80 } },
        { kind: 'fence', rect: { x0: -35, x1: -10, z0: -90, z1: -80 } },
        { kind: 'fence', rect: { x0: 10, x1: 35, z0: -90, z1: -80 } },
        // 物見の丘（街道の東）
        { kind: 'hill', circle: { cx: WATCH.x, cz: WATCH.z, r: 25 }, height: 4 },
        // 東の水田（街道の東を回ると遅い）
        { kind: 'paddy', rect: { x0: 60, x1: 200, z0: 20, z1: 140 } },
        { kind: 'hill', circle: { cx: 120, cz: -150, r: 40 }, height: 6 },
    ],
    terrainRules: { woods: { speed: 0.6, hideSight: 40 } },
    specialRules: [{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8, windowSec: 15 }],
    pathfinding: true,
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣（南の陣）' },
            { id: 'center', x: 0, z: 160, facing: N, note: '街道の前' },
            { id: 'left', x: -60, z: 170, facing: N, note: '左（林の南の口）' },
            { id: 'left2', x: -110, z: 180, facing: N, note: '林の南' },
            { id: 'right', x: 60, z: 170, facing: N, note: '右' },
            { id: 'archers', x: -30, z: 180, facing: N, note: '弓' },
            { id: 'cavalry', x: 40, z: 195, facing: N, note: '騎馬' },
        ],
        enemy: [
            { id: 'hq', x: 60, z: -185, facing: S, note: '本陣（陣の北東）' },
            { id: 'camp', x: 0, z: -125, facing: S, note: '陣の守り' },
            { id: 'camp_yumi', x: -15, z: -150, facing: S, note: '陣の弓' },
            { id: 'reserve', x: -10, z: -190, facing: S, note: '後詰め' },
            { id: 'picket_yumi', x: 20, z: 0, facing: S, note: '辻の弓（番兵の後ろ）' },
            { id: 'watch', x: WATCH.x, z: WATCH.z, facing: S, note: '物見（街道の東の丘）' },
            { id: 'picket', x: PICKET.x, z: PICKET.z, facing: S, note: '番兵（街道の辻の篝火）' },
            { id: 'patrol', x: 80, z: -50, facing: -EAST, note: '見回りの騎馬（物見の東）' },
        ],
    },
    exits: { ally: { x: 0, z: 215 }, enemy: { x: 0, z: -215 } },
    objectives: {
        primary: { id: 'raid_camp', type: 'hold_point', label: '夜のうちに敵陣を制圧する（敵なしで 45 秒）', zone: { circle: { cx: CAMP.x, cz: CAMP.z, r: 40 } }, sec: 45 },
        secondary: [
            { id: 'raid_losses', type: 'limit_losses', label: '損害を 2 割 5 分以内に抑える', maxRatio: 0.25 },
            { id: 'raid_watch', type: 'break_unit', label: '街道の物見を崩す', unitId: 'e_watch' },
            { id: 'raid_kiba', type: 'preserve_unit', label: '徳川騎馬隊を兵 6 割以上で残す', unitId: 'a_kiba', minRatio: 0.6 },
        ],
    },
    night: {
        sight: 120,
        detectRange: 70,
        torchZones: [{ circle: { cx: 0, cz: 20, r: 40 } }, { circle: { cx: CAMP.x, cz: CAMP.z, r: 50 } }],
        torchRange: 160,
        torchNames: ['辻の篝火', '陣の篝火'],
        lookouts: [{ unitId: 'e_watch', range: 110 }],
        // 時間切れは夜明け（画面の上の「夜明けまで」・判定の順・結果の文）
        deadlineName: '夜明け',
        deadlineEndText: '夜が明け、両軍とも兵を引いた',
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'end' },
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。夜。敵も味方も、発見した相手だけが見える（画面では、まだ見つけていない敵は名札も兵も出ない）。',
        '見つける距離：未発見の相手は 70 m まで近づくと見つかる（夜の林の中は 40 m）。見つけた相手は 120 m より離れると見失う。斬り合う・矢を射ると、その相手に見つかる。',
        '篝火：街道の辻と敵陣の中は篝火で明るい。中にいる部隊は 160 m から見つかる（敵味方とも）。街道の東の丘の物見は 110 m 先まで見つける。',
        '奇襲：まだ見つかっていない（見つかって 15 秒以内の）部隊が斬りかかると、最初の 8 秒は与える損害 ×1.5（敵も同じ）。',
        '経路：近いが警戒の厚い街道（辻の番兵と弓・丘の物見・見回りの騎馬。番兵が押されると陣の後詰めが駆けつける）か、西の広い林を北へ抜けて畦の道から陣の西の口へ回る道（長く林の中は遅いが、林の端まで見つからない）。',
        '勝利：敵陣（北の真ん中の輪）を、敵のいない状態で味方が 45 秒続けて占める（見つかった後に戦って取ってもよい。敵の本陣は崩さなくてよい）。夜明けまでに取れなければ撤退。',
        '副目標：損害を 2 割 5 分以内に抑える・街道の物見を崩す・徳川騎馬隊を兵 6 割以上で残す（途中で 6 割を切ったら果たせない）。',
    ],
    tactics: [
        '隠れて近づく：林の中を北へ進み、林の北東の端でそろってから、畦の道を陣の西の口へ一気に（陣の弓へは騎馬で。陣の中は篝火で見つかる）',
        '陽動：林の組が北へ着くころ、弓と騎馬で辻の番兵を射て押す。陣の後詰めが街道へ動き出し、陣の守りが手薄なうちに林の組が当たる',
        '見つかってから戦って取る：弓で番兵を誘い出して騎馬で横から叩き、槍で同じ敵に当たりながら街道を押し上がる。騎馬は予備に残し、斬り合う敵の横へ出す',
        '弓は、敵を見つけてからでないと射られない。篝火の中の敵は遠くから見える',
    ],
    presets: [
        {
            id: 'standard',
            name: '夜襲',
            summary: '味方 7／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cavalry', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('left2'),
                T.yumi('archers', 300),
                T.kiba('right', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_camp', 'yari', '敵勢の陣の守り', 500, 85, 'camp', { aiRole: 'hold_zone', aiTarget: { x: CAMP.x, z: CAMP.z, r: 45 }, aiLeash: 60 }),
                E('e_camp_yumi', 'yumi', '敵勢の陣の弓', 250, 75, 'camp_yumi', { aiRole: 'hold_line' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 400, 80, 'reserve', { aiRole: 'reserve' }),
                E('e_watch', 'yari', '敵勢の物見', 250, 70, 'watch', { aiRole: 'hold_line', aiLeash: 90 }),
                E('e_picket', 'yari', '敵勢の番兵', 350, 75, 'picket', { aiRole: 'hold_line', aiLeash: 90 }),
                E('e_picket_yumi', 'yumi', '敵勢の辻の弓', 200, 70, 'picket_yumi', { aiRole: 'hold_line' }),
                E('e_patrol', 'kiba', '敵勢の見回りの騎馬', 250, 75, 'patrol', { aiRole: 'hold_zone', aiTarget: { x: 70, z: -40, r: 50 }, aiLeash: 120 }),
            ],
        },
    ],
};
