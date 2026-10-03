/**
 * 戦場「湖・河岸」（shore）。湖の岸沿いの補給路の二つの要所を、7 分まで守り抜く（第4群。最初の案）。
 *
 * - 480 m × 440 m。東は湖（深い水面。x 140 より東は通れない）。船・水の上の戦いは無い（水辺を使った陸戦）。
 * - 補給路は湖の岸沿いの道（x 100〜140）。北の半分（z -220〜40）は、道の西が崖（x 70〜100）で、岸の道は幅 40 m の狭い道になる（近道）。
 * - 内陸（西）は開けた原：北西から南へ下る内陸の迂回路と、真ん中の高地（-60,-40。高さ 10 m）、西の林。
 * - 二つの要所：岸の狭まり（120,-40。狭い道の中）と、南の宿場（50,130。岸の道と内陸の道が合わさる所）。
 * - 敵勢：北の岸の道から攻め手（槍・弓・騎馬）が岸の狭まりへ、北西の内陸から攻め手（槍 2・騎馬）が高地の脇を通って南の宿場へ（時間差）。
 *   近道を固めるだけだと、内陸からの横の攻めで宿場を取られる。
 * - 主目標：二つの要所を、7 分（420 秒）まで守り抜く（defend_zones。どちらも、敵だけが 15 秒続けて占めると失う。
 *   同時に占め続けなくてよい＝敵に取られなければよい）。副目標：損害を 3 割 5 分以内に抑える・内陸の騎馬を崩す。
 * - 終わり方の判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退（合戦の放棄）。
 *
 * 成り立たせたい作戦（設計 §5。釣り合いは後で）：岸の近道を固めつつ、内陸の高地に予備を置いて横からの攻めに備える。
 */
import type { BattlefieldDef } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 二つの要所 */
const NARROWS = { x: 120, z: -40, r: 25 };
const POST = { x: 50, z: 130, r: 32 };

export const SHORE: BattlefieldDef = {
    id: 'shore',
    name: '湖・河岸',
    kind: 'shore',
    summary: '湖の岸沿いの補給路の、二つの要所を守り抜く。岸の狭い近道を固めつつ、内陸の高地からの横の攻めに備える',
    width: 480,
    depth: 440,
    terrain: [
        // 湖（東。深い水面は通れない）
        { kind: 'river', rect: { x0: 140, x1: 240, z0: -220, z1: 220 } },
        // 岸の道（補給路）と、北の半分の崖（岸の道を狭める）
        { kind: 'road', rect: { x0: 100, x1: 140, z0: -220, z1: 220 } },
        { kind: 'cliff', rect: { x0: 70, x1: 100, z0: -220, z1: 40 } },
        // 内陸の迂回路（北西から南の宿場へ）
        { kind: 'road', rect: { x0: -160, x1: -150, z0: -220, z1: 100 } },
        { kind: 'road', rect: { x0: -160, x1: 100, z0: 100, z1: 110 } },
        // 内陸の高地・西の林
        { kind: 'hill', circle: { cx: -60, cz: -40, r: 70 }, height: 10 },
        { kind: 'woods', rect: { x0: -240, x1: -180, z0: -120, z1: 120 } },
        // 岸の南の浅瀬（岸の道の脇。遅い）
        { kind: 'marsh', rect: { x0: 60, x1: 100, z0: 160, z1: 220 } },
    ],
    highGround: { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 20, sightBonus: 0 },
    specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: 100, x1: 140, z0: -120, z1: 40 } }, maxEngaged: 2 }],
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 180, facing: N, note: '本陣（南）' },
            { id: 'narrows', x: 120, z: 10, facing: N, note: '岸の道（狭まりの南）' },
            { id: 'post', x: 40, z: 130, facing: N, note: '南の宿場' },
            { id: 'inland', x: -40, z: 70, facing: N, note: '内陸（高地の南）' },
            { id: 'archers', x: 115, z: 60, facing: N, note: '弓（岸の道）' },
            { id: 'reserve', x: -10, z: 130, facing: N, note: '予備' },
            { id: 'cavalry', x: -90, z: 150, facing: N, note: '騎馬（西）' },
        ],
        enemy: [
            { id: 'hq', x: -40, z: -200, facing: S, note: '本陣（北）' },
            { id: 'shore_yari', x: 120, z: -200, facing: S, note: '岸の攻め手（槍）' },
            { id: 'shore_yumi', x: 115, z: -215, facing: S, note: '岸の攻め手（弓）' },
            { id: 'shore_kiba', x: 125, z: -215, facing: S, note: '岸の攻め手（騎馬）' },
            { id: 'inland_yari', x: -155, z: -200, facing: S, note: '内陸の攻め手（槍）' },
            { id: 'inland_yari2', x: -150, z: -215, facing: S, note: '内陸の攻め手（槍）' },
            { id: 'inland_kiba', x: -200, z: -200, facing: S, note: '内陸の騎馬' },
            { id: 'reserve', x: -80, z: -210, facing: S, note: '本陣の守り' },
        ],
    },
    exits: { ally: { x: 0, z: 215 }, enemy: { x: -40, z: -215 } },
    objectives: {
        primary: {
            id: 'shore_hold',
            type: 'defend_zones',
            label: '二つの要所を 7 分まで守り抜く',
            sec: 420,
            zones: [{ circle: { cx: NARROWS.x, cz: NARROWS.z, r: NARROWS.r } }, { circle: { cx: POST.x, cz: POST.z, r: POST.r } }],
            minHeld: 2,
            loseSec: 15,
            names: ['岸の狭まり', '南の宿場'],
        },
        secondary: [
            { id: 'shore_losses', type: 'limit_losses', label: '損害を 3 割 5 分以内に抑える', maxRatio: 0.35 },
            { id: 'shore_kiba', type: 'break_unit', label: '内陸の騎馬を崩す', unitId: 'e_inland_kiba' },
        ],
    },
    endRules: { order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'end' },
    generalInitiative: true,
    timeLimitSec: 450,
    briefing: [
        'ゲーム用の演習（架空の相手）。東は湖（深い水面。渡れない。船は無い）。補給路は湖の岸沿いの道。',
        '岸の道の北の半分は、西が崖で幅 40 m の狭い道になる（近道。同じ相手へ斬りかかれるのは 2 部隊まで）。内陸（西）は開けた原で、北西から南へ下る迂回路・真ん中の高地（上にいると下から来る相手に強く、弓が遠くまで届く）・西の林がある。',
        '要所は二つ：岸の狭まり（狭い道の中）と、南の宿場（岸の道と内陸の道が合わさる所）。',
        '敵勢は北の岸の道から岸の狭まりへ、北西の内陸から高地の脇を通って南の宿場へ攻めてくる（時間差）。',
        '勝利：二つの要所を 7 分（420 秒）まで守り抜く。どちらも、敵だけが 15 秒続けて占めると失う（味方が占め続けなくてよい。敵に取られなければよい）。一つでも失えば負け。',
        '副目標：損害を 3 割 5 分以内に抑える・内陸の騎馬を崩す。',
    ],
    tactics: [
        '岸の近道を固める：狭まりの南で槍を 2 隊並べ、弓を後ろの岸の道から射る（狭い道では敵も 2 部隊ずつしか当たれない）',
        '内陸の高地に予備を置く：内陸の攻め手が高地の脇を通るところを、高地の上から横に当たる（宿場の前で受けるより強い）',
        '近道だけを固めると、内陸からの攻めで宿場を取られる',
    ],
    presets: [
        {
            id: 'standard',
            name: '補給路の守り',
            summary: '味方 7／敵 8。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川騎馬隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('narrows'),
                T.sakakibara('cavalry', 'kiba', 300),
                T.sakai('inland'),
                T.ishikawa('post'),
                T.yumi('archers', 300),
                T.kiba('reserve', 250),
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                E('e_shore_yari', 'yari', '敵勢の岸の攻め手（槍）', 420, 80, 'shore_yari', { aiRole: 'assault', aiTarget: NARROWS }),
                E('e_shore_yumi', 'yumi', '敵勢の岸の弓', 240, 75, 'shore_yumi', { aiRole: 'assault', aiTarget: { x: 120, z: -110, r: 20 } }),
                E('e_shore_kiba', 'kiba', '敵勢の岸の騎馬', 240, 75, 'shore_kiba', { aiRole: 'assault', aiTarget: NARROWS, arriveAt: 120 }),
                E('e_inland_yari', 'yari', '敵勢の内陸の攻め手（槍）', 380, 80, 'inland_yari', { aiRole: 'assault', aiTarget: POST, arriveAt: 40 }),
                E('e_inland_yari2', 'yari', '敵勢の内陸の攻め手（槍・二番手）', 350, 75, 'inland_yari2', { aiRole: 'assault', aiTarget: POST, arriveAt: 210 }),
                E('e_inland_kiba', 'kiba', '敵勢の内陸の騎馬', 260, 75, 'inland_kiba', { aiRole: 'assault', aiTarget: POST, arriveAt: 120 }),
                E('e_reserve', 'yari', '敵勢の本陣の守り', 380, 80, 'reserve', { aiRole: 'guard_hq' }),
            ],
        },
    ],
};
