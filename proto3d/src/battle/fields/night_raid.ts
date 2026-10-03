/**
 * 戦場「夜襲・奇襲」（night_raid）。夜のうちに、北の敵勢の陣（拠点）を制圧する（第4群。最初の案）。
 *
 * - 440 m × 440 m。夜（night）：敵も味方も、発見した相手だけが見える。未発見の相手は 70 m まで近づくと見つかる（林の中は 60 m）。
 *   見つけた相手は 120 m より離れると見失う。斬り合う・矢を射ると、その相手に見つかる。
 *   画面では未発見の敵の名札・兵士・札・地図の印を出さない（色は少し暗くするだけ）。
 * - 敵勢の陣（拠点）は北の真ん中（0,-120）。陣の中は篝火（中にいる部隊は 160 m から見つかる）。
 * - 経路は 2 つ：
 *   - 近いが警戒の厚い街道（x 0）：南の味方の陣から北へ 300 m。途中の辻に篝火（0,20）と、物見（見張り。150 m 先まで見つける）と番兵。
 *   - 長いが見つかりにくい西の道：西の広い林（x -220〜-110）を北へ抜け、畦の道（z -120）を東へ陣の西の口へ。林の中は見つかりにくい（60 m）が遅い。
 *     東の原にも見回りの騎馬がいる。
 * - 敵勢：陣の守り（槍。陣の区域を守る）・陣の弓・本陣（陣の北東）・後詰めの槍（陣が攻められると出る）・物見（街道の真ん中）・
 *   番兵（街道の辻）・見回りの騎馬（東）。敵の考えも、発見した相手だけを狙い、追う。
 * - 主目標：陣（半径 40 m）を、敵のいない状態で味方が 45 秒続けて占める（hold_point。敵本陣の撃破ではない）。
 *   副目標：損害を 3 割以内に抑える・物見を崩す。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没（夜明け） → 全軍撤退（合戦の放棄）。
 *
 * 成り立たせたい作戦（設計 §5。釣り合いは後で）：隠れて近づく（林と畦の道）／見つかってから戦って取る（街道を押し上がる）。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;
const EAST = Math.PI / 2;

/** 敵勢の陣（拠点。主目標の区域） */
const CAMP = { x: 0, z: -120 };
/** 物見の見張りの地点 */
const WATCH = { x: 0, z: -40 };

export const NIGHT_RAID: BattlefieldDef = {
    id: 'night_raid',
    name: '夜襲・奇襲',
    kind: 'night_raid',
    summary: '夜、発見した相手だけが見える。北の敵陣を制圧する。近いが篝火と物見の厚い街道か、長いが見つかりにくい西の林と畦の道か',
    width: 440,
    depth: 440,
    terrain: [
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -220, z1: 220 } },
        // 西の広い林（見つかりにくいが遅い）と、林の北から陣の西の口への畦の道
        { kind: 'woods', rect: { x0: -220, x1: -110, z0: -170, z1: 170 } },
        { kind: 'road', rect: { x0: -110, x1: -40, z0: -126, z1: -114 } },
        // 陣の柵（西の口は畦の道、南の口は街道。北は開いている）
        { kind: 'fence', rect: { x0: -45, x1: -35, z0: -170, z1: -130 } },
        { kind: 'fence', rect: { x0: -45, x1: -35, z0: -110, z1: -80 } },
        { kind: 'fence', rect: { x0: 35, x1: 45, z0: -170, z1: -80 } },
        { kind: 'fence', rect: { x0: -35, x1: -10, z0: -90, z1: -80 } },
        { kind: 'fence', rect: { x0: 10, x1: 35, z0: -90, z1: -80 } },
        // 東の水田（見回りの騎馬の通り道の外は遅い）
        { kind: 'paddy', rect: { x0: 60, x1: 200, z0: 20, z1: 140 } },
        { kind: 'hill', circle: { cx: 120, cz: -150, r: 40 }, height: 6 },
    ],
    pathfinding: true,
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣（南の陣）' },
            { id: 'center', x: 0, z: 160, facing: N, note: '街道の前' },
            { id: 'left', x: -80, z: 165, facing: N, note: '左（林の南の口）' },
            { id: 'left2', x: -130, z: 180, facing: N, note: '林の南' },
            { id: 'right', x: 60, z: 170, facing: N, note: '右' },
            { id: 'archers', x: -30, z: 180, facing: N, note: '弓' },
            { id: 'cavalry', x: 40, z: 195, facing: N, note: '騎馬' },
        ],
        enemy: [
            { id: 'hq', x: 60, z: -185, facing: S, note: '本陣（陣の北東）' },
            { id: 'camp', x: 0, z: -125, facing: S, note: '陣の守り' },
            { id: 'camp_yumi', x: -15, z: -150, facing: S, note: '陣の弓' },
            { id: 'reserve', x: -10, z: -190, facing: S, note: '後詰め' },
            { id: 'watch', x: WATCH.x, z: WATCH.z, facing: S, note: '物見（街道の真ん中）' },
            { id: 'picket', x: 0, z: 25, facing: S, note: '番兵（街道の辻の篝火）' },
            { id: 'patrol', x: 130, z: -40, facing: -EAST, note: '見回りの騎馬（東）' },
        ],
    },
    exits: { ally: { x: 0, z: 215 }, enemy: { x: 0, z: -215 } },
    objectives: {
        primary: { id: 'raid_camp', type: 'hold_point', label: '夜のうちに敵陣を制圧する（敵なしで 45 秒）', zone: { circle: { cx: CAMP.x, cz: CAMP.z, r: 40 } }, sec: 45 },
        secondary: [
            { id: 'raid_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'raid_watch', type: 'break_unit', label: '街道の物見を崩す', unitId: 'e_watch' },
        ],
    },
    night: {
        sight: 120,
        detectRange: 70,
        torchZones: [{ circle: { cx: 0, cz: 20, r: 40 } }, { circle: { cx: CAMP.x, cz: CAMP.z, r: 50 } }],
        torchRange: 160,
        torchNames: ['辻の篝火', '陣の篝火'],
        lookouts: [{ unitId: 'e_watch', range: 150 }],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'end' },
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。夜。敵も味方も、発見した相手だけが見える（画面では、まだ見つけていない敵は名札も兵も出ない）。',
        '見つける距離：未発見の相手は 70 m まで近づくと見つかる（林の中は 60 m）。見つけた相手は 120 m より離れると見失う。斬り合う・矢を射ると、その相手に見つかる。',
        '篝火：街道の辻と敵陣の中は篝火で明るい。中にいる部隊は 160 m から見つかる（敵味方とも）。街道の真ん中の物見は 150 m 先まで見つける。',
        '経路：近いが警戒の厚い街道（番兵と物見）か、西の広い林を北へ抜けて畦の道から陣の西の口へ回る道（長いが見つかりにくい。林の中は遅い）。',
        '勝利：敵陣（北の真ん中の輪）を、敵のいない状態で味方が 45 秒続けて占める（見つかった後に戦って取ってもよい）。日没（夜明け）までに取れなければ撤退。',
        '副目標：損害を 3 割以内に抑える・街道の物見を崩す。',
    ],
    tactics: [
        '隠れて近づく：林の中を北へ進み、畦の道から陣の西の口へ一気に入る（陣の中は篝火で見つかるので、入ったら素早く守りを崩す）',
        '見つかってから戦って取る：街道の番兵と物見を崩してから押し上がる（早いが、陣の守りと後詰めが待ち構える）',
        '弓は、敵を見つけてからでないと射られない。物見に見つかる前に林へ入る',
    ],
    presets: [
        {
            id: 'standard',
            name: '夜襲',
            summary: '味方 7／敵 7。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('cavalry', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('left2'),
                T.yumi('archers', 300),
                T.kiba('right', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_camp', 'yari', '敵勢の陣の守り', 450, 85, 'camp', { aiRole: 'hold_zone', aiTarget: { x: CAMP.x, z: CAMP.z, r: 45 }, aiLeash: 60 }),
                E('e_camp_yumi', 'yumi', '敵勢の陣の弓', 220, 75, 'camp_yumi', { aiRole: 'hold_line' }),
                E('e_reserve', 'yari', '敵勢の後詰め', 380, 80, 'reserve', { aiRole: 'reserve' }),
                E('e_watch', 'yari', '敵勢の物見', 200, 70, 'watch', { aiRole: 'hold_line', aiLeash: 90 }),
                E('e_picket', 'yari', '敵勢の番兵', 300, 75, 'picket', { aiRole: 'hold_line', aiLeash: 90 }),
                E('e_patrol', 'kiba', '敵勢の見回りの騎馬', 250, 75, 'patrol', { aiRole: 'hold_zone', aiTarget: { x: 130, z: -40, r: 50 }, aiLeash: 120 }),
            ],
        },
    ],
};
