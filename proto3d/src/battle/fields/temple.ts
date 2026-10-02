/**
 * 戦場「寺社周辺」（temple）。高い境内の二つの要所（山門と本堂前）を、同時に 1 分確保する（docs/fields-group3-design.md §4）。
 * 宗教施設だから特別な力が働く仕組みは無い。高低差・入口・建物の陰を使う架空の戦場として扱う。
 *
 * - 400 m × 440 m。境内（x -150〜150・z -200〜-40）は一段高い台地（四角の丘・高さ 8 m）。台地の縁は崖（通れない）で、入口は 3 つ：
 *   - 正面の石段（x -12〜12。南の縁の真ん中。通れる幅は格子 4 升＝20 m）：真っすぐ山門へ上がる近道。狭い（同じ相手へ斬りかかれるのは
 *     1 部隊まで）。山門の奥の弓（高所で射程 135 m）が石段を見張る。
 *   - 東の脇道（台地の東の縁の z -160〜-126）：南東から道で回る。遠いが道は速い。口に槍、本堂の東に弓。口を抜けると本堂前は近い。
 *   - 林側の入口（台地の西の縁の z -116〜-86）：西の林を抜けて入る。林は遅いが、中の部隊は 60 m まで敵に気づかれない。
 *     西の口から山門の背後へ回れる（石段の上の槍を、正面と背後から挟める）。
 * - 山門（石段の上。守る輪 (0,-68)、半径 18 m）と本堂前（守る輪 (40,-150)、半径 20 m）は 90 m ほど離れている。
 *   山門の両脇の建物（間 44 m）・鐘楼・庫裏・本堂・塔（building）は通れず、矢も通さない（建物の陰に入ると射られない）。
 *   射線を遮る高さは高さ 0 からの値なので、台地の上の建物は台地の高さ（8 m）を足す（足さないと、台地の上どうしの矢を遮らない）。
 * - 高所：下から攻め上がる相手の損害 ×0.7、台地の弓の射程 +15 m。
 * - 敵勢：山門の槍（420）・本堂前の槍（350）・山門の奥の弓（260）・本堂の東の弓（200）・東の口の槍（250）・本陣の騎馬（200。どこかが
 *   押されると動く）・北西の奥の本陣（350）。240 秒に北西から山門へ、270 秒に北東から本堂前へ、押し返しの槍（250 ずつ）が下ってくる。
 *   同時に存在する敵は 9 部隊（上限 10）。
 * - 主目標：山門と本堂前を、どちらも敵のいない状態で味方が占め、同時に 60 秒確保する（どちらか外れると 0 から）。
 *   副目標：損害を 3 割以内に抑える・本多忠勝隊を兵 6 割以上残す・北西からの押し返しの槍を崩す。
 *
 * 成り立つ作戦（台本と数字は tests/proto3d-field-temple.test.ts）：
 * - 石段と脇道から同時に：弓で山門の奥の弓を射すくめ、忠勝隊が石段を登る。酒井隊・榊原隊・騎馬は東の脇道から本堂前へ。いちばん早いが、
 *   先頭の忠勝隊が削られる（忠勝隊を残す ✗）。
 * - 脇道と林から分けて入る：騎馬と石川隊が林を抜けて山門の背後へ、忠勝隊は背後を突いたのを見て石段を登る。少し遅いが、忠勝隊が残る。
 * - 準備した正面攻撃（全軍で石段から。弓・後詰めの差配・号令・先駆け）：遅い（日没に近い）が、押し返しの槍まで崩せる。
 * - 一方へ集めるだけ（東へ全軍）：本堂前は取るが、山門まで手が回らず同時の確保が数えられない。
 */
import type { BattlefieldDef } from './types';
import type { TerrainArea } from '../types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

const GATE_ZONE = { circle: { cx: 0, cz: -68, r: 18 } };
const HALL_ZONE = { circle: { cx: 40, cz: -150, r: 20 } };
/** 境内の建物。射線を遮る高さ（height）は地面からではなく高さ 0 からの値なので、台地の高さ PLATEAU に建物の高さを足す */
const PLATEAU = 8;
const bldg = (x0: number, x1: number, z0: number, z1: number, h = 7): TerrainArea => ({ kind: 'building', rect: { x0, x1, z0, z1 }, height: PLATEAU + h });

export const TEMPLE: BattlefieldDef = {
    id: 'temple',
    name: '寺社周辺',
    kind: 'temple',
    summary: '高い境内の山門と本堂前を同時に 1 分確保する。狭い正面の石段・遠回りの東の脇道・見つかりにくい林側の入口。一方だけに集めると、もう一方が手薄になる',
    width: 400,
    depth: 440,
    terrain: [
        // 境内の台地
        { kind: 'hill', rect: { x0: -150, x1: 150, z0: -200, z1: -40 }, height: PLATEAU },
        // 台地の縁の崖（南の縁は石段 x -12〜12 を残す。東は脇道の口 z -160〜-126、西は林側の入口 z -116〜-86 を残す）
        { kind: 'cliff', rect: { x0: -156, x1: -12, z0: -46, z1: -34 } },
        { kind: 'cliff', rect: { x0: 12, x1: 156, z0: -46, z1: -34 } },
        { kind: 'cliff', rect: { x0: 150, x1: 162, z0: -200, z1: -160 } },
        { kind: 'cliff', rect: { x0: 150, x1: 162, z0: -126, z1: -34 } },
        { kind: 'cliff', rect: { x0: -162, x1: -150, z0: -200, z1: -116 } },
        { kind: 'cliff', rect: { x0: -162, x1: -150, z0: -86, z1: -34 } },
        // 境内の北の端（裏山。通れない）
        { kind: 'cliff', rect: { x0: -200, x1: 200, z0: -220, z1: -204 } },
        // 山門の両脇の建物（間 44 m。石段を登り切った所から山門の輪へ入る）・鐘楼・庫裏・本堂・塔
        bldg(-46, -22, -64, -54, 7),
        bldg(22, 46, -64, -54, 7),
        bldg(-72, -56, -108, -92, 9),
        bldg(-120, -80, -175, -145, 7),
        bldg(10, 70, -196, -176, 10),
        bldg(90, 106, -100, -84, 12),
        // 石段（道）と、脇道（南東から台地の東へ回る道）
        { kind: 'road', rect: { x0: -8, x1: 8, z0: -48, z1: 220 } },
        { kind: 'road', rect: { x0: 168, x1: 180, z0: -158, z1: 220 } },
        { kind: 'road', rect: { x0: 150, x1: 180, z0: -158, z1: -128 } },
        // 西の林（林側の入口へ）
        { kind: 'woods', rect: { x0: -200, x1: -162, z0: -200, z1: 40 } },
        { kind: 'woods', rect: { x0: -162, x1: -100, z0: -30, z1: 40 } },
    ],
    highGround: { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 15 },
    // 石段：同じ相手へ斬りかかれるのは 1 部隊まで
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -14, x1: 14, z0: -50, z1: -24 } }, maxEngaged: 1 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 195, facing: N, note: '本陣' },
            { id: 'center', x: 0, z: 120, facing: N, note: '石段の下' },
            { id: 'left', x: -90, z: 130, facing: N, note: '左（林側）' },
            { id: 'right', x: 90, z: 130, facing: N, note: '右（脇道側）' },
            { id: 'archers', x: -30, z: 145, facing: N, note: '弓' },
            { id: 'reserve', x: 30, z: 150, facing: N, note: '予備' },
            { id: 'flank', x: 150, z: 165, facing: N, note: '右の外（騎馬・脇道の下）' },
        ],
        enemy: [
            { id: 'hq', x: -100, z: -188, facing: S, note: '本陣（境内の北西の奥）' },
            { id: 'gate', x: 0, z: -70, facing: S, note: '山門の槍' },
            { id: 'hall', x: 40, z: -150, facing: S, note: '本堂前の槍' },
            { id: 'yumi_gate', x: -10, z: -90, facing: S, note: '山門の奥の弓（石段を射る）' },
            { id: 'yumi_hall', x: 80, z: -125, facing: S, note: '本堂の東の弓' },
            { id: 'side', x: 125, z: -142, facing: S, note: '東の脇道の口の槍' },
            { id: 'kiba', x: -50, z: -182, facing: S, note: '本陣の騎馬' },
        ],
    },
    reinforcements: [
        { id: 'counter', side: 'enemy', at: 240, point: { x: -60, z: -195, facing: S }, label: '押し返しの槍（北西から山門へ）' },
        { id: 'counter2', side: 'enemy', at: 270, point: { x: 110, z: -195, facing: S }, label: '押し返しの槍（北東から本堂前へ）' },
    ],
    exits: { ally: { x: 0, z: 220 }, enemy: { x: -100, z: -195 } },
    objectives: {
        primary: { id: 'temple_hold', type: 'hold_zones', label: '山門と本堂前を同時に 60 秒確保する', zones: [GATE_ZONE, HALL_ZONE], sec: 60, mode: 'all', names: ['山門', '本堂前'] },
        secondary: [
            { id: 'temple_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
            { id: 'temple_tadakatsu', type: 'preserve_unit', label: '本多忠勝隊を兵 6 割以上残す', unitId: 'a_tadakatsu', minRatio: 0.6 },
            { id: 'temple_counter', type: 'break_unit', label: '北西からの押し返しの槍を崩す', unitId: 'e_counter' },
        ],
    },
    generalInitiative: true,
    timeLimitSec: 600,
    briefing: [
        'ゲーム用の演習（架空の相手）。高い境内（高さ 8 m の台地）の二つの要所、山門と本堂前を取る。境内の縁は崖で、入口は 3 つ。寺社だから特別な力が働くことはない（地形・入口・高低差だけ）。',
        '正面の石段：山門へ真っすぐ上がる近道。狭く、同じ相手へ斬りかかれるのは 1 部隊まで。下から攻め上がる相手の損害 ×0.7、境内の弓は射程 +15 m。山門の奥の弓が石段を見張る。',
        '東の脇道：南東から道で回り、境内の東の口へ（本堂前に近い）。口に槍、本堂の東に弓。林側の入口：西の林を抜けて境内の西の口へ。林は遅いが、60 m まで敵に気づかれない。西の口から山門の背後へ回れる。',
        '山門の両脇の建物・鐘楼・庫裏・本堂・塔は通れず、矢も通さない（建物の陰に入ると射られない）。',
        '敵勢：山門・本堂前・東の口に槍、山門の奥と本堂の東に弓、北西の奥に本陣と騎馬（どこかが押されると動く）。4 分に北西から山門へ、4 分半に北東から本堂前へ、押し返しの槍が下ってくる。',
        '勝利：山門と本堂前の両方を、敵のいない状態で味方が占め、同時に 60 秒確保する（どちらかが外れると 0 から数え直す）。',
        '副目標：損害を 3 割以内に抑える・本多忠勝隊を兵 6 割以上残す・北西からの押し返しの槍を崩す。',
    ],
    tactics: [
        '石段と脇道から同時に：弓で山門の奥の弓を射すくめてから忠勝隊が石段を登る（石川隊の後詰めの差配で支える）。酒井隊・榊原隊・騎馬は東の脇道から本堂前へ。早いが、先頭の忠勝隊は削られる',
        '脇道と林から分けて入る：騎馬と石川隊は林を抜けて西の口から山門の背後へ。忠勝隊は石段の下で待ち、背後を突いたのを見て登る（挟むと山門の槍は早く崩れる）。酒井隊・榊原隊は東の脇道から本堂前へ',
        '準備した正面攻撃：全軍で石段から。弓・後詰めの差配・家康の号令で山門を取り、境内の中から本堂前へ（榊原隊の先駆けで本堂の弓を崩す）。遅いが、押し返しの槍まで崩せる',
        '一方へ集めるだけにしない：本堂前だけ・山門だけを取っても数えられない。押し返しの槍（4 分・4 分半）に備えて、両方の輪の中に兵を残し、追い払ったら輪へ戻す',
    ],
    presets: [
        {
            id: 'standard',
            name: '境内の二所',
            summary: '味方 7／敵 9（押し返し 2 を含む）。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('center'),
                T.sakakibara('flank', 'kiba', 300),
                T.sakai('right'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                T.kiba('left'),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_gate', 'yari', '敵勢の山門の槍', 420, 82, 'gate', { aiRole: 'hold_zone', aiTarget: { x: 0, z: -68, r: 18 } }),
                E('e_hall', 'yari', '敵勢の本堂前の槍', 350, 80, 'hall', { aiRole: 'hold_zone', aiTarget: { x: 40, z: -150, r: 20 } }),
                E('e_yumi_gate', 'yumi', '敵勢の山門の弓', 260, 70, 'yumi_gate', { aiRole: 'hold_line' }),
                E('e_yumi_hall', 'yumi', '敵勢の本堂の弓', 200, 70, 'yumi_hall', { aiRole: 'hold_line' }),
                E('e_side', 'yari', '敵勢の脇道の口の槍', 250, 75, 'side', { aiRole: 'hold_zone', aiTarget: { x: 125, z: -142, r: 15 } }),
                E('e_kiba', 'kiba', '敵勢の本陣の騎馬', 200, 80, 'kiba', { aiRole: 'reserve' }),
                { ...E('e_counter', 'yari', '敵勢の押し返しの槍（山門）', 250, 80, '', { aiRole: 'assault', aiTarget: { x: 0, z: -68, r: 18 } }), slot: undefined, reinforcement: 'counter' },
                { ...E('e_counter2', 'yari', '敵勢の押し返しの槍（本堂）', 250, 80, '', { aiRole: 'assault', aiTarget: { x: 40, z: -150, r: 20 } }), slot: undefined, reinforcement: 'counter2' },
            ],
        },
    ],
};
