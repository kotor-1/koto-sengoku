/**
 * 戦場「山道・峠」（mountain_pass）。崖に挟まれた狭い峠道。大軍を一度に展開できず、少数でも要所を守れる。
 *
 * - 240 m × 400 m。南北に峠道（幅 40 m。x -20〜20、z -130〜110）。両側は崖（通れない）。途中に関（z 25〜55 は幅 30 m）。
 *   北の出口（z -200〜-130）と南の出口（z 110〜200）は開けている。道（road）は開けた所だけ（峠道の中に速い筋を作ると、
 *   並んで進む部隊が道探しで真ん中へ寄り合って詰まるため）。
 * - 関は南から上る坂の上（丘 (0,60) r50 高さ 10）。下から正面に来る相手の損害 ×0.5、坂の上の弓の射程 +20 m。
 * - 狭い正面：峠道の中では、同じ相手へ斬りかかれるのは 2 部隊まで（あふれた部隊は後ろで待つ）。
 * - 敵勢 10 部隊が北から 3 回に分かれて（0・30・60 秒）峠道を抜け、南の本陣へ攻め込む（assault）。弓は 90 秒に来て関へ射に出る。
 *   味方は 4 部隊で始まり（南の開けた所に布陣）、180 秒で南の端に援軍 2 部隊が着く。
 * - 主目標：援軍が着いてから 60 秒（開始から 240 秒）耐える。副目標：関を失わない（敵だけが関に 10 秒いたら失う）。
 *
 * 釣り合い（tests/proto3d-field-mountain_pass.test.ts。早送りの台本で確かめた）：
 * - 何もしない（南の開けた所で待つ）・峠の南の口や北の出口の外で迎え撃つ・全部隊で北へ攻め出る → 峠道を抜けてきた敵に囲まれ、
 *   援軍を待たずに本陣が崩れて負ける。
 * - 忠勝隊・酒井隊を関に横に並べ、弓を関の後ろの坂に置く → 援軍が着いてから 60 秒耐えて勝つ。
 *   本陣も峠道の南の口まで上げて、疲れた頃（120 秒ごろ）に立て直しの号令をかけると関を失わない（副目標）。本陣を動かさないと、
 *   勝っても 200 秒ごろに関を失う。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 峠道（狭い正面の区域） */
const PASS = { rect: { x0: -20, x1: 20, z0: -130, z1: 110 } };
/** 敵勢の槍・騎馬が攻め込む先（味方の本陣の辺り） */
const HQ_AIM = { x: 0, z: 165, r: 30 };
/** 敵勢の弓が射に出る先（関） */
const GATE_AIM = { x: 0, z: 40, r: 25 };

export const MOUNTAIN_PASS: BattlefieldDef = {
    id: 'mountain_pass',
    name: '山道・峠',
    kind: 'mountain_pass',
    summary: '崖に挟まれた峠道。狭い所を少数で守り、援軍を待つ',
    width: 240,
    depth: 400,
    terrain: [
        { kind: 'cliff', rect: { x0: -120, x1: -20, z0: -130, z1: 110 } },
        { kind: 'cliff', rect: { x0: 20, x1: 120, z0: -130, z1: 110 } },
        { kind: 'cliff', rect: { x0: -20, x1: -15, z0: 25, z1: 55 } },
        { kind: 'cliff', rect: { x0: 15, x1: 20, z0: 25, z1: 55 } },
        { kind: 'road', rect: { x0: -5, x1: 5, z0: -200, z1: -130 } },
        { kind: 'road', rect: { x0: -5, x1: 5, z0: 110, z1: 200 } },
        { kind: 'hill', circle: { cx: 0, cz: 60, r: 50 }, height: 10 },
        { kind: 'woods', rect: { x0: -120, x1: -60, z0: 130, z1: 200 } },
    ],
    highGround: { defenseVsLower: 0.5, minDiff: 2, rangeBonus: 20, sightBonus: 0 },
    specialRules: [{ type: 'narrow_frontage', zone: PASS, maxEngaged: 2 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 178, facing: N, note: '本陣（峠の南の開けた所）' },
            { id: 'south_l', x: -40, z: 150, facing: N, note: '南の開けた所の左' },
            { id: 'south_r', x: 40, z: 150, facing: N, note: '南の開けた所の右' },
            { id: 'archers', x: 0, z: 158, facing: N, note: '弓' },
        ],
        enemy: [
            { id: 'hq', x: 0, z: -180, facing: S, note: '本陣' },
            { id: 'w1a', x: -30, z: -150, facing: S, note: '一番手' },
            { id: 'w1b', x: 10, z: -150, facing: S, note: '一番手' },
            { id: 'w1c', x: -10, z: -170, facing: S, note: '一番手の騎馬' },
            { id: 'w2a', x: -60, z: -170, facing: S, note: '二番手' },
            { id: 'w2b', x: 40, z: -175, facing: S, note: '二番手' },
            { id: 'w2c', x: -90, z: -150, facing: S, note: '二番手' },
            { id: 'w3a', x: 80, z: -185, facing: S, note: '三番手' },
            { id: 'w3b', x: -30, z: -190, facing: S, note: '三番手' },
            { id: 'yumi', x: 90, z: -150, facing: S, note: '弓' },
        ],
    },
    reinforcements: [{ id: 'relief', side: 'ally', at: 180, point: { x: 0, z: 195, facing: N }, label: '後詰めの援軍（榊原康政隊・石川数正隊）' }],
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: { id: 'pass_survive', type: 'survive_until', label: '援軍が着いてから 60 秒耐える', reinforcementId: 'relief', holdSec: 60 },
        secondary: [{ id: 'pass_gate', type: 'defend_time', label: '関を失わない', sec: 240, zone: { circle: { cx: 0, cz: 40, r: 22 } }, loseSec: 10 }],
    },
    timeLimitSec: 360,
    briefing: [
        'ゲーム用の演習（架空の相手）。崖に挟まれた幅 40 m の峠道。途中の関は幅 30 m。崖は通れない。',
        '狭い正面：峠道の中では、同じ相手へ斬りかかれるのは 2 部隊まで。あふれた部隊は後ろで待つ（攻める側は大軍でも一度に当たれない）。',
        '関は南から上る坂の上。下から攻め上がる相手の損害は半分になり、坂の上の弓は遠くまで届く。峠道の外（開けた所）では大軍に囲まれる。',
        '敵勢 10 部隊が北から 3 回に分かれて峠道を抜け、南の本陣へ攻め込む。180 秒で南の端に援軍（榊原康政隊・石川数正隊）が着く。',
        '勝利：援軍が着いてから 60 秒（開始から 240 秒）耐える。敵勢をすべて崩しても勝ち。副目標：関を失わない（敵だけが関に 10 秒いると失う）。',
    ],
    tactics: [
        '忠勝隊・酒井隊を関に横に並べて受け、弓は関の後ろの坂から射る（弓を先に出すと、峠道で槍の行く手を塞ぐ）',
        '本陣を峠道の南の口まで上げ、関の隊が疲れた頃に立て直しの号令をかける。関の外へ打って出ない',
        '援軍が着いたら関の後ろへ上げる（後詰めの差配で足を速められる）',
    ],
    presets: [
        {
            id: 'standard',
            name: '峠の守り',
            summary: '味方 4＋援軍 2／敵 10。家康・本多忠勝・酒井忠次・徳川弓隊。援軍に榊原康政・石川数正',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('south_l'),
                T.sakai('south_r'),
                T.yumi('archers'),
                { ...T.sakakibara('', 'yari', 400), slot: undefined, reinforcement: 'relief' },
                { ...T.ishikawa('', 350), slot: undefined, reinforcement: 'relief' },
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_w1a', 'yari', '敵勢の一番手（左）', 550, 80, 'w1a', { aiRole: 'assault', aiTarget: HQ_AIM }),
                E('e_w1b', 'yari', '敵勢の一番手（右）', 550, 80, 'w1b', { aiRole: 'assault', aiTarget: HQ_AIM }),
                E('e_w1c', 'kiba', '敵勢の騎馬', 350, 75, 'w1c', { aiRole: 'assault', aiTarget: HQ_AIM }),
                E('e_w2a', 'yari', '敵勢の二番手（左）', 500, 75, 'w2a', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 30 }),
                E('e_w2b', 'yari', '敵勢の二番手（中）', 500, 75, 'w2b', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 30 }),
                E('e_w2c', 'yari', '敵勢の二番手（右）', 500, 75, 'w2c', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 30 }),
                E('e_w3a', 'yari', '敵勢の三番手（左）', 500, 75, 'w3a', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 60 }),
                E('e_w3b', 'yari', '敵勢の三番手（右）', 500, 75, 'w3b', { aiRole: 'assault', aiTarget: HQ_AIM, arriveAt: 60 }),
                E('e_yumi', 'yumi', '敵勢の弓隊', 250, 75, 'yumi', { aiRole: 'assault', aiTarget: GATE_AIM, arriveAt: 90 }),
            ],
        },
    ],
};
