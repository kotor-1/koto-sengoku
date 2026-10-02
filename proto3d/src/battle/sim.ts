/**
 * 合戦のルール（部隊単位の指揮）。純粋な TypeScript（three・DOM なし）。乱数なし・決まった刻み（RULES.tick 秒）で進める。
 * 同じ設定・同じ時刻に同じ命令を出せば、必ず同じ結果になる。
 *
 * 使い方（画面・章の進行から）：
 *   const s = createBattle(setup);
 *   issueOrder(s, 'a_genzo', { type: 'attack', targetId: 'e_sente' });   // 命令（一時停止中でもよい）
 *   const events = stepBattle(s, dt);                                    // 毎フレーム（一時停止中は呼ばない）
 *   const r = outcome(s);                                                // 終わったら BattleOutcome、まだなら null
 *
 * 計算の決まり（docs/chapter1-spec.md §4）：
 * - 近接（間合い 25 m）で互いに損害を与える。弓は 120 m から射る（近接では弱い）。
 * - 損害を大きくするもの：兵力、種類の相性、側面 ×1.6・背後 ×2.2（相手の向きと当たる向きで決める）、士気、騎馬の突撃。
 * - 損害を小さくするもの：丘の上の守り（下から正面に来る相手に ×0.7。側面・背後から回り込まれると効かない）、
 *   林の中の相手への弓 ×0.6、防衛・待機 ×0.85。
 * - 士気：損害の割合・側面や背後を突かれる・囲まれる・近くの味方の敗走・自軍の本陣の敗走で下がる。本陣の近く（80 m）では下がり方が和らぐ。
 *   交戦していない間は少し戻る。15 以下で敗走（命令を聞かず退き口へ）。兵 0 で全滅。退き口に着いた撤退部隊は「撤退済み」。
 * - 林の中の部隊は、相手の部隊が 60 m 以内に来るまで相手から見えない（seenBy）。
 * - 向き：待機中は向きを保つ（周りを見回して向き直ったりしない）。斬り合いの最中はゆっくり（4°/秒）しか向き直れない。
 *   そのため、正面で組み合っている相手の側面・背後へ別の部隊を当てると効く。
 * - 味方どうし：動く部隊は、止まっている味方の部隊（待機・斬り合い中など）を押しのけず、横へよけて通る。
 *   行き先が止まっている味方のすぐ隣なら、その隣で止まる（待機中の本陣が、後ろから来た予備隊に押し出されない）。
 *
 * 歴史分岐で加えたもの（能力も約束もない合戦＝架空の第一章では、計算も結果の形も変わらない）：
 * - 特殊能力（abilities.ts）：損害・士気の低下・敗走の線・動きの速さに倍率をかける。退路の守護の効果中は動く命令を断る。
 *   結果に abilitiesUsed（部隊 id → 使った時刻）を入れる。
 * - 戦前の約束（BattleSetup.pledge）：対象が安全地点に続けていた時間・退き口から離れたかを見張り、結果に pledge（kept／broken）を入れる。
 *   画面は pledgeProgress(s) で見通しを出せる。
 *
 * データ駆動の戦場で加えたもの（docs/battlefields-design.md §3・§4。BattleSetup.fieldRules・objectives を省いた合戦＝国境の原・
 * 歴史分岐の章では、計算も結果の形も変わらない）：
 * - 地形の決まり（fieldRules.ts）：地形ごとの速さ・与える／受ける損害・矢・隠れる距離・高所の有利を、戦場ごとに上書きできる。
 *   深い川（浅瀬を除く）・崖・通れる範囲の外には入れない。通れない所がある戦場だけ、格子（5 m）の A*（pathfind.ts）で道を作って
 *   その点を順にたどる（攻撃の相手が動くときは 1 秒ごと、または相手が 10 m 以上動いたら作り直す）。
 *   狭い所の動き（通れない所がある戦場だけ）：通り過ぎた点・味方が立って近づけない点は飛ばし、道から外れて次の点へまっすぐ
 *   行けなくなったら作り直す。横をよける幅の無い所に止まっている味方はすり抜け、並んで抜ける味方どうしは崖・川へ押し込まない。
 * - 特殊ルール：narrow_frontage（区域の中で同じ相手へ斬りかかれる部隊の数を絞る。あふれた部隊は後ろで待つ）・
 *   woods_ambush（見えていなかった部隊の最初の当たりの損害を上げる）。
 * - 目標（objectives.ts）：主目標があれば、主目標の達成で勝利・果たせなくなれば敗北。副目標は結果に記録するだけ。
 *
 * 第3群で加えたもの（docs/fields-group3-design.md §3。その地形・門を持たない戦場では計算に入らない＝既存の 10 戦場は 1 刻みも同じ）：
 * - 障害物（building・fence・wall）は通れない。射線（fieldRules.ts の lineOfSight）：弓は、射手から相手までの線分が建物・石垣・閉じた門に
 *   遮られる相手を射ない（待機の弓の相手選び・攻撃の命令の弓。遮られていれば、射線が通る所まで近づく）。柵は射線を通す。
 *   斬り合いも同じ判定で、建物・石垣・閉じた門を挟んだ相手とは間合いの中でも斬り合わない（攻撃の命令なら手前で止まらず回り込む）。柵越しは斬り合う。
 * - 門（fieldRules.gates）：閉じている間は通れない。制圧の区域を、門を持つ側がいない状態で反対の側が続けて占めると開く（trackGates）。
 *   開いたら道探しの格子・射線の格子を作り直し、進んでいる道をすべて引き直す。
 * - 地形の決まりの arrowDealMul（中の弓の射る矢）・noCharge（中の騎馬は突撃にならない）。
 */
import type {
    AbilityId,
    BattleEndReason,
    BattleMap,
    BattleOutcome,
    BattleResultKind,
    BattleSetup,
    ClanId,
    Order,
    Side,
    TerrainKind,
    UnitDef,
    UnitKind,
    UnitStatus,
} from './types';
import { createAiState, createInitiative, thinkEnemy, thinkGenerals, type AiState, type InitiativeMemo } from './ai';
import {
    TERRAIN_DEFAULTS,
    arrowDealMulIn,
    arrowTakeMulIn,
    createFieldEnv,
    dealMulIn,
    hideSightIn,
    inZone,
    lineOfSight,
    noChargeIn,
    rebuildNav,
    takeMulIn,
    terrainElevation,
    terrainSpeedIn,
    type FieldEnv,
    type GateRun,
} from './fieldRules';
import { findPath, isPassable, nearestPassable } from './pathfind';
import { activeObjectiveZones, createObjectiveTrack, finalObjectives, refreshObjective, trackObjectives, type ObjectiveTrack } from './objectives';
import {
    abilitiesUsedRecord,
    abilityDealMul,
    abilityFlankDealMul,
    abilityMoraleFloor,
    abilityGuarded,
    abilityGuardBroken,
    abilityShadowLossMul,
    abilityMoraleLossMul,
    abilityRoutMorale,
    abilitySpeedMul,
    abilityTakeMul,
    createAbilityRuns,
    encircleLive,
    encircleMul,
    enemyUseAbility,
    findEncircled,
    noteMeleeContact,
    resolveAbilityId,
    isRooted,
    rootedLabel,
    updateAbilities,
    vanguardDealMul,
    type AbilityRun,
    type AttackDir,
} from './abilities';

/** ルールの数値（画面の説明・テストからも読む） */
export const RULES = {
    /** 1 刻みの秒数 */
    tick: 0.1,
    /** 近接の間合い（部隊の中心どうしの距離、m） */
    meleeRange: 25,
    /** 一度組み合った相手とは、間合い + 6 m まで斬り合いを続ける（離れたり近づいたりで交戦が細切れにならないように） */
    meleeHold: 6,
    /** 弓の届く距離（m）。bowFullRange までは減衰なし、そこから 120 m で 0.6 倍まで下がる */
    bowRange: 120,
    bowFullRange: 80,
    /** 弓隊が攻撃の命令で近づくときに止まる距離 */
    bowStandoff: 105,
    /** 林の中の部隊が相手から見えるようになる距離 */
    woodsSight: 60,
    /** 本陣が士気を支える半径 */
    hqAura: 80,
    /** この士気以下で敗走 */
    routMorale: 15,
    /** 近接の損害（兵 1 人・1 秒あたり、力 1・士気 100 のとき） */
    meleeRate: 0.012,
    /** 弓の損害（弓兵 1 人・1 秒あたり） */
    rangedRate: 0.006,
    flankMul: 1.6,
    rearMul: 2.2,
    /** 正面とみなす角度（相手の向きから ±50°）、背後とみなす角度（±130° より外） */
    frontArcDeg: 50,
    rearArcDeg: 130,
    /** 丘の守り（下から正面に来る相手の損害 ×0.7。高さの差 2 m 以上） */
    hillMul: 0.7,
    hillDiff: 2,
    woodsArcheryMul: 0.6,
    holdMul: 0.85,
    /** 湿地の中で戦うと、与える損害 ×0.8・受ける損害 ×1.15 */
    marshDealMul: 0.8,
    marshTakeMul: 1.15,
    /** 騎馬の突撃（交戦の始めの 6 秒、損害 ×1.5。槍の正面へは効かない） */
    chargeMul: 1.5,
    chargeSec: 6,
    /** 敗走して逃げる相手への追い討ち */
    pursuitMul: 1.5,
    /** 損害による士気の低下（失った兵の割合 × この値）。矢による損害は rangedMoraleMul 倍 */
    moralePerLoss: 110,
    rangedMoraleMul: 0.6,
    /** 側面・背後を突かれた瞬間の士気の低下 */
    flankShock: 8,
    rearShock: 14,
    /** 側面・背後を突かれ続けている間の士気の低下（毎秒） */
    flankPressure: 0.8,
    rearPressure: 1.6,
    /** 2 部隊以上から斬りかかられている間の士気の低下（毎秒） */
    outnumberedPressure: 0.6,
    /** 近く（120 m）の味方の敗走・自軍の本陣の敗走 */
    nearbyRoutShock: 8,
    nearbyRoutRadius: 120,
    hqRoutShock: 30,
    /** 本陣の近くでは士気の低下 ×0.75 */
    hqAuraMul: 0.75,
    /** 交戦から 5 秒離れると士気が戻る（毎秒。本陣の近くはさらに +0.6） */
    recoverDelay: 5,
    recoverRate: 1.0,
    recoverHqBonus: 0.6,
    /** 斬り合いの最中の向き直り（度/秒） */
    meleeTurnDeg: 4,
    /** 本陣が斬り合いに巻き込まれている間の、本陣の士気の低下（毎秒。大将の身が危うい） */
    hqUnderAttack: 0.6,
    /** 全軍撤退の命令から、戦場を離れ切るまで待つ最長の秒数 */
    retreatGraceSec: 20,
    /**
     * 戦前の約束（歴史分岐だけ）：「約束の場面」になる条件。対象が敵と斬り合う、または味方の部隊が（どれかが）合わせてこの秒数以上
     * 敵と斬り結ぶ。場面になる前に撤退・敗北で終わったときは、約束を果たしたことにならない（勝利・日没なら要らない）
     */
    pledgeContestMeleeSec: 15,
    /** 追い討ち（BattleSetup.pursuit の合戦だけ）：退いている相手を攻める部隊は、斬りながら後を追う（離されない） */
    pursuitFollowStop: 12,
    /** 味方どうしが重ならない距離 */
    spacing: 18,
    /** 動く部隊が、止まっている味方の部隊をよけて通り始める先の距離（m） */
    avoidLook: 60,
    /** 正面の幅：同じ相手の正面へ 2 部隊目から斬りかかる部隊の損害の倍率 */
    frontCrowdMul: 0.4,
    /** 1 つの陣営が 1 つの合戦に出せる部隊の数の上限（味方 8・敵 10。戦場データの検査で確かめる） */
    maxUnitsPerSide: { ally: 8, enemy: 10 },
    /** 道探し：攻撃の相手へ向かう道を作り直す間隔（秒）・相手がこの距離（m）より動いたらすぐ作り直す */
    repathSec: 1,
    repathMove: 10,
    /** 道探し：通る点にこの距離（m）まで近づいたら次の点へ */
    waypointReach: 3,
    /**
     * 通れない所がある戦場だけ：移動の行き先の隣に味方がいるかを見るときのゆとり（m）。ちょうど spacing 離れた二つの行き先へ二隊を
     * 出したとき、浮動小数の誤差で後の隊が手前で止まらないように、隣とみなすのは spacing − これ より近い味方だけにする
     */
    goalHoldSlack: 0.5,
    /**
     * 新しい戦場の動き（FieldRules.settleMoves）だけ：移動の行き先からこの距離（m）以内で、settleSec 秒のあいだ行き先へ 1 m も
     * 近づけなかった部隊は、着いたことにして待機にする（味方どうしで押し合って止まらない・並べた行き先の後ろの列で詰まる）。
     * 近くの味方が動いている間は長めに待つ。遠くても、味方の間に挟まって行き詰まったときは同じく待機にする（sim.ts の stuckNearGoal）
     */
    settleNear: 45,
    settleSec: 6,
    /**
     * 橋の詰まり（橋のある戦場だけ）：橋の上・橋の口（橋の区域から squeezeNear m 以内）で、動こうとしているのに squeezeSec 秒の
     * あいだ squeezeMove m も進めず、近く（spacing + 2 m 以内）に味方がいる部隊は、味方の中をすり抜ける（橋の幅は部隊の間隔
     * ほどしかなく、止まっている味方をよけようとすると左右とも水に塞がれ、味方の押し離しで押し戻されて動けなくなるのを防ぐ）。
     * すり抜けは、すり抜け始めた所から squeezeClear m 進み、spacing m 以内に味方がいなくなるか、動くのをやめたら終わる。
     * 橋の無い戦場（Version 14 までの 5 戦場など）では何も変わらない
     */
    squeezeSec: 3,
    squeezeMove: 2,
    squeezeNear: 8,
    squeezeClear: 6,
} as const;

/** 種類ごとの性質 */
export const KIND_STATS: Record<UnitKind, { speed: number; power: number; defence: number; turnDeg: number; label: string }> = {
    honjin: { speed: 3, power: 1.1, defence: 0.9, turnDeg: 45, label: '本陣' },
    yari: { speed: 3, power: 1.0, defence: 1.0, turnDeg: 45, label: '槍' },
    yumi: { speed: 3, power: 0.5, defence: 1.2, turnDeg: 60, label: '弓' },
    kiba: { speed: 6, power: 2.0, defence: 1.0, turnDeg: 90, label: '騎馬' },
};

/**
 * 地形ごとの動きの速さの既定（重なるときは 湿地 > 浅瀬 > 林 > 道 の順で 1 つだけ効く。深い川・崖は通れない）。
 * 値は fieldRules.ts の TERRAIN_DEFAULTS。戦場ごとの上書きは BattleSetup.fieldRules.terrainRules
 */
export const TERRAIN_SPEED: Record<TerrainKind, number> = {
    marsh: TERRAIN_DEFAULTS.marsh.speed,
    woods: TERRAIN_DEFAULTS.woods.speed,
    road: TERRAIN_DEFAULTS.road.speed,
    hill: TERRAIN_DEFAULTS.hill.speed,
    river: TERRAIN_DEFAULTS.river.speed,
    ford: TERRAIN_DEFAULTS.ford.speed,
    cliff: TERRAIN_DEFAULTS.cliff.speed,
    bridge: TERRAIN_DEFAULTS.bridge.speed,
    paddy: TERRAIN_DEFAULTS.paddy.speed,
    building: TERRAIN_DEFAULTS.building.speed,
    fence: TERRAIN_DEFAULTS.fence.speed,
    wall: TERRAIN_DEFAULTS.wall.speed,
    dry: TERRAIN_DEFAULTS.dry.speed,
};

/** 画面の知らせ（出来事の記録）の種類 */
export type BattleEventKind =
    | 'start'
    | 'arrive' // 部隊が戦場に着いた
    | 'spotted' // 隠れていた敵が見えた（林から現れた）
    | 'discovered' // 隠れていた味方が敵に気づかれた
    | 'engage' // 交戦が始まった
    | 'flank' // 側面を突いた
    | 'rear' // 背後を突いた
    | 'charge' // 騎馬の突撃
    | 'rout' // 敗走した
    | 'destroyed' // 全滅した
    | 'withdrawn' // 撤退して戦場を離れた
    | 'fled' // 敗走して戦場から逃れ去った
    | 'lost' // 目標を見失った・目標が崩れた
    | 'ai' // 敵の動き（見えているときだけ）
    | 'general' // 味方の武将が基本方針で自分から動いた（命令を受けていない待機中。演習の戦場だけ）
    | 'retreat_all' // 全軍撤退の命令
    | 'nightfall'
    | 'ability' // 特殊能力を使った・援護が外れた／戻った（abilities.ts）
    | 'ability_end' // 特殊能力の効果が終わった
    | 'pledge' // 戦前の約束の対象が、安全地点で守りを固めた・退き口から離れた・崩れた
    | 'ambush' // 見えていなかった部隊が斬りかかった（林の奇襲。特殊ルールのある戦場だけ）
    | 'objective' // 目標を果たした・果たせなくなった（目標のある合戦だけ）
    | 'end';

export interface BattleEvent {
    /** 起きた時刻（秒） */
    t: number;
    kind: BattleEventKind;
    /** 画面に出す文（日本語） */
    text: string;
    /** 主な部隊（知らせを押したときにそこへカメラを寄せるなど） */
    unitId?: string;
    /** 相手の部隊 */
    targetId?: string;
    /** 特殊能力の知らせ（ability・ability_end）なら、その能力 */
    ability?: AbilityId;
}

/** 合戦中の部隊の状態（画面は読むだけ。書き換えは issueOrder・stepBattle だけ） */
export interface UnitState {
    readonly id: string;
    readonly side: Side;
    readonly clan: ClanId;
    readonly kind: UnitKind;
    readonly name: string;
    readonly leaderId?: string;
    /** 率いる武将の id（battle/generals.ts。武将のいない部隊は無い） */
    readonly generalId?: string;
    readonly aiRole?: UnitDef['aiRole'];
    /** hold_zone・assault の地点（UnitDef.aiTarget） */
    readonly aiTarget?: UnitDef['aiTarget'];
    /** 持ち場（区域）から追う距離の上限（UnitDef.aiLeash） */
    readonly aiLeash?: number;
    /** 率いる武将の特殊能力（abilities.ts。武将のいる部隊だけ） */
    readonly ability?: AbilityId;
    /** その陣営の本陣（その陣営の最初の honjin） */
    readonly isHq: boolean;
    readonly startStrength: number;
    /** 兵力（小数を含む。表示は Math.round） */
    strength: number;
    /** 士気 0〜100 */
    morale: number;
    /** 士気が戻る上限（最初の士気） */
    readonly maxMorale: number;
    x: number;
    z: number;
    /** 向き（ラジアン。0 が北＝ -z、時計回り） */
    facing: number;
    /** 今の命令 */
    order: Order;
    status: UnitStatus;
    /** 戦場に着く時刻（秒） */
    readonly arriveAt: number;
    /** 着いたことがある */
    arrived: boolean;
    /** いま戦場にいる（着いていて、まだ離れていない・全滅していない） */
    present: boolean;
    /** 斬り合っている相手（近接） */
    engagedWith: string | null;
    /** 射ている相手（弓） */
    shootingAt: string | null;
    /** この刻みに損害を与えてきた相手 */
    attackers: string[];
    /** それぞれの陣営から見えているか（林の中は近づかれるまで見えない） */
    seenBy: Record<Side, boolean>;
    /** この刻みに動いた */
    moving: boolean;
    /** 着いたら向き直る向き（move の face） */
    faceGoal: number | null;
    /** 最後に損害を受けた時刻 */
    lastHitT: number;
    /** 最後に矢を受けた時刻・射てきた部隊（敵の考えが使う） */
    lastArrowT: number;
    lastShooterId: string | null;
    /** 最後に斬り合っていた時刻 */
    lastMeleeT: number;
    /** 騎馬の突撃が効いている終わりの時刻 */
    chargeUntil: number;
    /** 相手ごとに、最後に側面・背後を突かれた時刻 */
    shockT: Record<string, number>;
    /** 直近 1 秒ほどの損害（表示用。毎刻み少しずつ減る） */
    recentLoss: number;
    /** いまよけて通っている味方の部隊と、よける側（-1 左・1 右）。よけ始めたら通り過ぎるまで同じ側を通る */
    avoid: { id: string; side: -1 | 1 } | null;
    /** この刻みにすり抜けている味方の部隊（通れない所がある戦場で、横をよける幅が無いとき。押し離さない） */
    passThrough: string | null;
    /**
     * 橋の詰まり（RULES.squeezeSec）：進みを数え始めた位置・時刻・最後に見た時刻。on なら味方の中をすり抜けている
     * （味方をよけず、味方と押し離さない）。動こうとしていない刻みには null
     */
    squeeze: { x: number; z: number; t: number; seen: number; on: boolean } | null;
    /**
     * 号令の守り（兵の下限つきの能力）に守られている間の、号令が無かったときの士気の見積もり（守られ始めた時の士気・使った時の +40 の前
     * から、号令の軽減・士気の床なしに下げる）。守りが外れた（兵が下限を切った）とき、士気をここまで下げてから普通の決まりで見る。
     * 守られていない間は null
     */
    rallyShadow: number | null;
    /** 道探しでたどっている道（通れない所がある戦場だけ。goal は作ったときの行き先、pts は通る点、idx は次に向かう点） */
    path: { goalX: number; goalZ: number; builtT: number; pts: { x: number; z: number }[]; idx: number } | null;
    /** 移動の進み（新しい動きの決まりの戦場だけ）：行き先・それまでに近づいた一番近い距離・その距離を 1 m 縮めた時刻・最後に見た時刻 */
    moveProg: { gx: number; gz: number; best: number; bestLeft: number; t: number; seen: number } | null;
    /** 戦場にいて相手から隠れていたことがあり、まだ見つかっていない（林の奇襲の判定） */
    wasHidden: boolean;
    /** 隠れていた所から相手に見つかった時刻 */
    revealT: number;
    /** 林の奇襲が効いている相手と終わりの時刻・倍率 */
    ambushOn: string | null;
    ambushUntil: number;
    ambushMul: number;
    /**
     * 武将の基本方針による自由な動き（BattleSetup.generalInitiative の合戦の、方針を持つ武将の味方の部隊だけ。ほかは null）。
     * 命令を受けていない待機中だけ、持ち場の近くで方針ごとに動く（ai.ts の thinkGenerals）。プレイヤーの命令が最優先
     */
    initiative: InitiativeMemo | null;
}

export interface BattleState {
    readonly setup: BattleSetup;
    readonly map: BattleMap;
    readonly timeLimitSec: number;
    /** 経過時間（秒）＝ tick × RULES.tick */
    t: number;
    tick: number;
    /** stepBattle に渡された時間のうち、まだ刻みにしていない分 */
    acc: number;
    units: UnitState[];
    /** 出来事の記録（古い順。画面は読んだ所までの番号を覚えておく） */
    events: BattleEvent[];
    /** 全軍撤退を命じた時刻 */
    allRetreatAt: number | null;
    result: BattleOutcome | null;
    /** 敵の考え（ai.ts） */
    ai: AiState;
    /** 部隊の組ごとに、最後に斬り合った時刻（交戦の知らせを繰り返さないため） */
    contactT: Record<string, number>;
    /** 特殊能力の状態（持つ部隊 id → 状態。abilities.ts）。能力のない合戦では空 */
    abilities: Record<string, AbilityRun>;
    /** abilities の並び（部隊の順） */
    abilityList: AbilityRun[];
    /** 戦前の約束の見張り（BattleSetup.pledge があるときだけ） */
    pledge: PledgeTrack | null;
    /** 戦場ごとの決まり（fieldRules.ts。fieldRules を省いた合戦は既定＝今までの決まり） */
    field: FieldEnv;
    /** 目標の見張り（BattleSetup.objectives があるときだけ。objectives.ts） */
    objectives: ObjectiveTrack | null;
    /** この刻みに包囲されている部隊（両翼の采配の効果中だけ。abilities.ts の findEncircled）。ふだんは空 */
    encircled: string[];
}

/** 戦前の約束の見張り（docs/ieyasu1570-design.md §5） */
export interface PledgeTrack {
    targetId: string;
    safeZone: { cx: number; cz: number; r: number };
    holdSec: number;
    minStrengthRatio: number;
    /** いま安全地点の中に続けている秒数（戦える状態で中にいる間だけ数える。出ると 0 に戻る） */
    zoneSec: number;
    /** 安全地点に holdSec 秒以上いた（一度満たせば消えない） */
    secured: boolean;
    /** 撤退の命令で退き口から戦場を離れた */
    withdrew: boolean;
    /** 対象が崩れたことを知らせた */
    failNoted: boolean;
    /** 対象が敵と斬り合った */
    pressed: boolean;
    /** 味方の部隊が敵と斬り結んだ秒数（どれか 1 部隊でも斬り合っている刻みを数える） */
    meleeSec: number;
    /** 約束の場面になった（pressed、または meleeSec が RULES.pledgeContestMeleeSec 以上）。一度なれば消えない */
    contested: boolean;
}

/** 約束の見通し（画面の表示用）。pending＝まだ決まらない（このまま終われば kept になる見込みかは onTrack） */
export interface PledgeProgress {
    targetId: string;
    targetName: string;
    /** 安全地点に続けている秒数・必要な秒数 */
    zoneSec: number;
    holdSec: number;
    inZone: boolean;
    secured: boolean;
    withdrew: boolean;
    /** 今の兵の割合（最初の兵に対して）と、必要な割合 */
    strengthRatio: number;
    minStrengthRatio: number;
    /** 対象が敗走・全滅した（もう守れない） */
    failed: boolean;
    /** 約束の場面になった（対象が敵と斬り合った、または味方が斬り結んだ秒数が足りた）。撤退・敗北で終わるときに要る */
    contested: boolean;
    pressed: boolean;
    meleeSec: number;
    contestMeleeSec: number;
    /** 今「全軍撤退」で終わったら「守った」になる（勝利・日没では contested は要らない） */
    onTrack: boolean;
    /** 約束の場面を除いた条件（崩れていない・兵が足りる・陣・退き口・戦えている）を満たす */
    onTrackIgnoringContest: boolean;
    /** 合戦が終わっていれば結果 */
    result: 'kept' | 'broken' | null;
}

// ---------------------------------------------------------------- 幾何

/** a から b への向き（0 が北、時計回り） */
export function headingTo(ax: number, az: number, bx: number, bz: number): number {
    return Math.atan2(bx - ax, -(bz - az));
}
/** 角度の差（-π〜π） */
export function angleDiff(a: number, b: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
function norm(a: number): number {
    const t = Math.PI * 2;
    return ((a % t) + t) % t;
}
export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function turnToward(from: number, to: number, maxRad: number): number {
    const d = angleDiff(from, to);
    if (Math.abs(d) <= maxRad) return norm(to);
    return norm(from + Math.sign(d) * maxRad);
}
const DEG = Math.PI / 180;

/** 攻め手（ax, az）が守り手 d のどの向きから当たっているか */
export function attackArc(d: { x: number; z: number; facing: number }, ax: number, az: number): 'front' | 'flank' | 'rear' {
    const a = Math.abs(angleDiff(d.facing, headingTo(d.x, d.z, ax, az))) / DEG;
    if (a <= RULES.frontArcDeg) return 'front';
    if (a <= RULES.rearArcDeg) return 'flank';
    return 'rear';
}

/** 攻め手（ax, az）が守り手 d のどの向きから当たっているか（側面は左右を分ける。包囲の判定に使う） */
export function attackDir(d: { x: number; z: number; facing: number }, ax: number, az: number): AttackDir {
    const diff = angleDiff(d.facing, headingTo(d.x, d.z, ax, az));
    const a = Math.abs(diff) / DEG;
    if (a <= RULES.frontArcDeg) return 'front';
    if (a > RULES.rearArcDeg) return 'rear';
    return diff > 0 ? 'right' : 'left';
}

/**
 * 武将の自由な動き：移動の命令で着いて待機になった。プレイヤーの命令で動いていたなら、着いた所を新しい持ち場にする
 * （自分から動いていたなら、持ち場は変えない）。どちらも「命令を受けていない待機中」になる。
 * プレイヤーの攻撃の相手が崩れて待機になったときは、自由な動きに戻さない（その場で待つ。次の命令を待つ）
 */
function settleInitiative(u: UnitState): void {
    const g = u.initiative!;
    if (!g.acting) {
        g.postX = u.x;
        g.postZ = u.z;
        g.postFacing = u.faceGoal ?? u.facing;
    }
    g.free = true;
}

// ---------------------------------------------------------------- 地形

function inArea(a: BattleMap['terrain'][number], x: number, z: number): boolean {
    return inZone(a, x, z);
}
/** その地点の地形（重なりあり） */
export function terrainAt(map: BattleMap, x: number, z: number): TerrainKind[] {
    const out: TerrainKind[] = [];
    for (const a of map.terrain) if (inArea(a, x, z) && !out.includes(a.kind)) out.push(a.kind);
    return out;
}
export function inTerrain(map: BattleMap, kind: TerrainKind, x: number, z: number): boolean {
    for (const a of map.terrain) if (a.kind === kind && inArea(a, x, z)) return true;
    return false;
}
/**
 * 地面の高さ（m）。丘は円で、中心が height、縁が 0 の丸い頂（1 − (d/r)²）。四角の丘は一様な高さ。
 * カプセルの丘（尾根）は、線分からの距離 d で同じ式（線分の上が height、幅 r の所で 0）。
 * 表示（view）も同じ式で地面を盛り上げると、見た目と守りの計算が合う。
 */
export function elevationAt(map: BattleMap, x: number, z: number): number {
    // 計算は fieldRules.ts の terrainElevation（射線の計算からも使うため、そちらに移した。式は同じ）
    return terrainElevation(map, x, z);
}
/** その地点の動きの速さの倍率（既定の決まり。戦場ごとの上書きと部隊の種類の補正は unitSpeedFactor） */
export function speedFactorAt(map: BattleMap, x: number, z: number): number {
    if (inTerrain(map, 'marsh', x, z)) return TERRAIN_SPEED.marsh;
    if (inTerrain(map, 'ford', x, z)) return TERRAIN_SPEED.ford;
    if (inTerrain(map, 'woods', x, z)) return TERRAIN_SPEED.woods;
    if (inTerrain(map, 'road', x, z)) return TERRAIN_SPEED.road;
    return 1;
}
/** 部隊の今の位置の動きの速さの倍率（戦場ごとの決まり・部隊の種類の補正を含む） */
export function unitSpeedFactor(s: BattleState, u: { kind: UnitKind; x: number; z: number }): number {
    return terrainSpeedIn(s.map, s.field, u.kind, u.x, u.z);
}
/** その地点を通れるか（通れない所が無い戦場ではいつも true） */
export function passableAt(s: BattleState, x: number, z: number): boolean {
    return !s.field.nav || isPassable(s.field.nav, x, z);
}

// ---------------------------------------------------------------- 状態の問い合わせ

export function unitById(s: BattleState, id: string): UnitState | undefined {
    return s.units.find((u) => u.id === id);
}
/** 戦場にいて戦える */
export function isActive(u: UnitState): boolean {
    return u.present && u.status === 'ready';
}
/** 命令を出せる（戦える。まだ着いていない部隊にも先に命令しておける） */
export function canCommand(s: BattleState, u: UnitState): boolean {
    if (s.result || u.status !== 'ready') return false;
    if (u.side === 'ally' && s.allRetreatAt !== null) return false;
    return true;
}
export function hqOf(s: BattleState, side: Side): UnitState | undefined {
    return s.units.find((u) => u.side === side && u.isHq);
}
export function other(side: Side): Side {
    return side === 'ally' ? 'enemy' : 'ally';
}
/** 残り時間（日没まで、秒） */
export function timeLeft(s: BattleState): number {
    return Math.max(0, s.timeLimitSec - s.t);
}
/** 退き口（撤退・敗走で向かう所）。退き口が戦場の端にあれば、その端のうち今の位置の真っすぐ先 */
export function exitPointFor(s: BattleState, u: { side: Side; x: number }): { x: number; z: number } {
    const e = s.map.exits[u.side];
    // 通れない所がある戦場では、退き口はいつも決まった 1 点（端の真っすぐ先が崖・川かもしれないので）
    if (s.field.nav) return nearestPassable(s.field.nav, e.x, e.z);
    const edge = Math.abs(e.z) >= s.map.depth / 2 - 1;
    if (edge) return { x: clamp(u.x, -s.map.width / 2 + 5, s.map.width / 2 - 5), z: e.z };
    return { x: e.x, z: e.z };
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------- 画面に出す言葉

export const STATUS_LABEL: Record<UnitStatus, string> = { ready: '戦える', routed: '敗走', withdrawn: '撤退済み', destroyed: '全滅' };

/**
 * 命令を受けていない待機の札の文（武将の基本方針で持ち場の近くを動くことがある。「防衛・待機」を命じれば止まる）。
 * スマホの小さな札でも切れにくい長さにする（詳しい説明は FREE_HOLD_NOTE。札の文の上に指・マウスを置くと出る）
 */
export const FREE_HOLD_LABEL = '待機・武将任せ';
export const FREE_HOLD_NOTE = '命令を受けていない待機：武将の判断で持ち場の近く（40 m ほど）を動くことがある。防衛・待機を命じると持ち場から動かない';

/** 今の命令（例：「攻撃：鷲尾先手」「移動」「防衛・待機」「待機・武将任せ」「撤退」） */
export function orderLabel(s: BattleState, u: UnitState): string {
    if (u.status === 'routed') return '敗走中';
    if (u.status === 'withdrawn') return '撤退済み';
    if (u.status === 'destroyed') return '―';
    if (!u.arrived) return `到着待ち（${Math.max(0, Math.ceil(u.arriveAt - s.t))} 秒）`;
    // 武将の基本方針で自分から動いている（命令を受けていない待機中）
    const own = u.initiative?.free && u.initiative.acting && u.order.type !== 'hold' ? '（武将の判断）' : '';
    switch (u.order.type) {
        case 'hold':
            // 命令を受けていない待機（武将の基本方針で持ち場の近くを自分から動くことがある）は、命じた「防衛・待機」（動かない）と分けて出す
            return rootedLabel(s, u.id) ?? (u.initiative?.free ? FREE_HOLD_LABEL : '防衛・待機');
        case 'move':
            return `移動${own}`;
        case 'attack':
            return `攻撃：${unitById(s, u.order.targetId)?.name ?? '？'}${own}`;
        case 'retreat':
            return '撤退';
    }
}
/** 交戦相手（例：「斬り合い：鷲尾先手」「射撃：鷲尾弓隊」「なし」） */
export function engagementLabel(s: BattleState, u: UnitState): string {
    if (u.engagedWith) return `斬り合い：${unitById(s, u.engagedWith)?.name ?? '？'}`;
    if (u.shootingAt) return `射撃：${unitById(s, u.shootingAt)?.name ?? '？'}`;
    return 'なし';
}

// ---------------------------------------------------------------- 作る・命令

/** 合戦を始める（設定は変えない。部隊の並びの順が計算の順になる） */
export function createBattle(setup: BattleSetup): BattleState {
    const ids = new Set<string>();
    const hqSeen: Record<Side, boolean> = { ally: false, enemy: false };
    const units: UnitState[] = setup.units.map((d) => {
        if (ids.has(d.id)) throw new Error(`部隊の id が重なっています: ${d.id}`);
        ids.add(d.id);
        for (const k of ['strength', 'morale', 'x', 'z', 'facing'] as const) {
            if (!Number.isFinite(d[k])) throw new Error(`部隊 ${d.id} の ${k} が数ではありません`);
        }
        const isHq = d.kind === 'honjin' && !hqSeen[d.side];
        if (isHq) hqSeen[d.side] = true;
        const arriveAt = d.arriveAt && d.arriveAt > 0 ? d.arriveAt : 0;
        const strength = Math.max(0, d.strength);
        const morale = clamp(d.morale, 0, 100);
        // 能力：部隊の ability、無ければ率いる武将（generalId）の能力（abilities.ts の resolveAbilityId）
        const ability = resolveAbilityId(d);
        return {
            id: d.id,
            side: d.side,
            clan: d.clan,
            kind: d.kind,
            name: d.name,
            leaderId: d.leaderId,
            ...(d.generalId ? { generalId: d.generalId } : {}),
            aiRole: d.aiRole,
            ...(d.aiTarget ? { aiTarget: { ...d.aiTarget } } : {}),
            ...(d.aiLeash !== undefined ? { aiLeash: d.aiLeash } : {}),
            ...(ability ? { ability } : {}),
            isHq,
            startStrength: strength,
            strength,
            morale,
            maxMorale: morale,
            x: clamp(d.x, -setup.map.width / 2, setup.map.width / 2),
            z: clamp(d.z, -setup.map.depth / 2, setup.map.depth / 2),
            facing: norm(d.facing),
            order: d.order ? { ...d.order } : { type: 'hold' },
            status: strength < 1 ? 'destroyed' : 'ready',
            arriveAt,
            arrived: arriveAt === 0,
            present: arriveAt === 0 && strength >= 1,
            engagedWith: null,
            shootingAt: null,
            attackers: [],
            seenBy: { ally: d.side === 'ally', enemy: d.side === 'enemy' },
            moving: false,
            faceGoal: null,
            lastHitT: -999,
            lastArrowT: -999,
            lastShooterId: null,
            lastMeleeT: -999,
            chargeUntil: -1,
            shockT: {},
            recentLoss: 0,
            avoid: null,
            passThrough: null,
            squeeze: null,
            rallyShadow: null,
            path: null,
            moveProg: null,
            wasHidden: false,
            revealT: -999,
            ambushOn: null,
            ambushUntil: -1,
            ambushMul: 1,
            initiative: null,
        } satisfies UnitState;
    });
    // 武将の基本方針による自由な動き（演習の戦場だけ。ai.ts の createInitiative）
    if (setup.generalInitiative) for (const u of units) u.initiative = createInitiative(u);
    const s: BattleState = {
        setup,
        map: setup.map,
        timeLimitSec: setup.timeLimitSec,
        t: 0,
        tick: 0,
        acc: 0,
        units,
        events: [],
        allRetreatAt: null,
        result: null,
        ai: createAiState(units),
        contactT: {},
        abilities: createAbilityRuns(setup.units),
        abilityList: [],
        pledge: null,
        field: createFieldEnv(setup.map, setup.fieldRules),
        objectives: createObjectiveTrack(setup),
        encircled: [],
    };
    s.abilityList = Object.values(s.abilities);
    const pl = setup.pledge;
    if (pl) {
        const tgt = units.find((u) => u.id === pl.targetId);
        if (!tgt || tgt.side !== 'ally') throw new Error(`約束の対象が味方の部隊にありません: ${pl.targetId}`);
        s.pledge = { targetId: pl.targetId, safeZone: { ...pl.safeZone }, holdSec: pl.holdSec, minStrengthRatio: pl.minStrengthRatio, zoneSec: 0, secured: false, withdrew: false, failNoted: false, pressed: false, meleeSec: 0, contested: false };
    }
    updateVisibility(s, null);
    s.events.push({ t: 0, kind: 'start', text: `${setup.map.name}の合戦が始まった` });
    return s;
}

/**
 * 命令を出す（味方にも敵にも使える。敵の考え ai.ts もこれで命令する）。出せたら true。
 * - 敗走・撤退済み・全滅の部隊、合戦が終わった後、全軍撤退の後の味方には出せない。
 * - 攻撃：相手は反対の陣営で、戦場にいて戦える、こちらの陣営から見えている部隊に限る。
 * - 移動：戦場の外の地点は内側へ寄せる。
 */
export function issueOrder(s: BattleState, unitId: string, order: Order): boolean {
    const u = unitById(s, unitId);
    if (!u || !applyOrder(s, u, order)) return false;
    // プレイヤー（または敵の考え）の命令：武将の自由な動きより優先する（防衛・待機を命じた部隊も、持ち場から動かない）
    if (u.initiative) {
        u.initiative.free = false;
        u.initiative.acting = false;
    }
    return true;
}

/** 命令を出す（中の処理。武将の自由な動き（ai.ts の thinkGenerals）もこれで動く＝待機中の印を消さない） */
function applyOrder(s: BattleState, u: UnitState, order: Order): boolean {
    if (!canCommand(s, u)) return false;
    // 退路の守護で踏みとどまっている間は、動く命令（移動・攻撃・撤退）を受けない
    if (order.type !== 'hold' && isRooted(s, u.id)) return false;
    switch (order.type) {
        case 'hold':
        case 'retreat':
            u.order = { type: order.type };
            break;
        case 'move': {
            if (!Number.isFinite(order.x) || !Number.isFinite(order.z)) return false;
            const o: Order = {
                type: 'move',
                x: clamp(order.x, -s.map.width / 2 + 2, s.map.width / 2 - 2),
                z: clamp(order.z, -s.map.depth / 2 + 2, s.map.depth / 2 - 2),
            };
            // 通れない所（川・崖）への移動は、いちばん近い通れる所へ
            if (s.field.nav) {
                const p = nearestPassable(s.field.nav, o.x, o.z);
                o.x = p.x;
                o.z = p.z;
            }
            if (order.face !== undefined && Number.isFinite(order.face)) o.face = norm(order.face);
            u.order = o;
            break;
        }
        case 'attack': {
            const t = unitById(s, order.targetId);
            if (!t || t.side === u.side || !isActive(t) || !t.seenBy[u.side]) return false;
            u.order = { type: 'attack', targetId: t.id };
            break;
        }
        default:
            return false;
    }
    u.faceGoal = null;
    u.path = null;
    return true;
}

/** 全軍撤退（味方のすべての部隊を退き口へ。まだ着いていない部隊は来ない）。出せたら true */
export function orderAllRetreat(s: BattleState): boolean {
    if (s.result || s.allRetreatAt !== null) return false;
    s.allRetreatAt = s.t;
    for (const u of s.units) {
        if (u.side !== 'ally' || u.status !== 'ready') continue;
        // 踏みとどまっている部隊は、効果が終わってから退く（abilities.ts の updateAbilities）
        if (u.initiative) u.initiative.free = false;
        if (isRooted(s, u.id)) continue;
        u.order = { type: 'retreat' };
        u.faceGoal = null;
        if (!u.arrived) u.status = 'withdrawn';
    }
    s.events.push({ t: s.t, kind: 'retreat_all', text: '全軍に撤退を命じた' });
    return true;
}

/** 結果（終わっていなければ null） */
export function outcome(s: BattleState): BattleOutcome | null {
    return s.result;
}

/**
 * 時間を進める（dt 秒。指揮中の一時停止では呼ばない）。決まった刻みで計算し、余りは次へ持ち越す。
 * 1 回に進めるのは最大 2 秒分（重いフレームで一度に進みすぎないように）。この呼び出しで起きた出来事を返す。
 */
export function stepBattle(s: BattleState, dt: number): BattleEvent[] {
    if (s.result || !(dt > 0)) return [];
    const from = s.events.length;
    s.acc = Math.min(s.acc + dt, 2);
    while (s.acc >= RULES.tick - 1e-9 && !s.result) {
        s.acc -= RULES.tick;
        tick(s);
    }
    if (s.acc < 0) s.acc = 0;
    return s.events.slice(from);
}

/** 結果が出るまで一気に進める（テスト・開発の早送り用）。each は刻みごと（命令を出す台本など） */
export function runToEnd(s: BattleState, each?: (s: BattleState) => void, maxSec = 3600): BattleOutcome {
    while (!s.result && s.t < maxSec) {
        each?.(s);
        stepBattle(s, RULES.tick);
    }
    if (!s.result) throw new Error('合戦が終わりませんでした');
    return s.result;
}

// ---------------------------------------------------------------- 1 刻み

interface Plan {
    melee: UnitState | null;
    ranged: UnitState | null;
    goal: { x: number; z: number; stopAt: number } | null;
}

function log(s: BattleState, kind: BattleEventKind, text: string, unitId?: string, targetId?: string): void {
    s.events.push({ t: round1(s.t), kind, text, unitId, targetId });
}
function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

function tick(s: BattleState): void {
    s.tick++;
    s.t = s.tick * RULES.tick;
    const dt = RULES.tick;
    const t = s.t;

    // 1. 着いた部隊
    for (const u of s.units) {
        if (u.arrived || u.status !== 'ready' || u.arriveAt > t + 1e-9) continue;
        u.arrived = true;
        u.present = true;
        const woods = inTerrain(s.map, 'woods', u.x, u.z);
        if (u.side === 'ally') {
            log(s, 'arrive', woods ? `${u.name}が林に着いた（まだ敵に気づかれていない）` : `${u.name}が戦場に着いた`, u.id);
        } else if (s.setup.reinforcements?.some((r) => r.side === 'enemy' && r.unitIds.includes(u.id))) {
            log(s, 'arrive', `敵の援軍（${u.name}）が現れた`, u.id);
        }
    }

    // 1b. 特殊能力の効果の終わり・援護の外れ（能力のない合戦では何もしない）
    updateAbilities(s);

    // 2. 見えているか
    updateVisibility(s, s.events);

    // 3. 敵の考え（0.5 秒ごと）
    if (s.tick % 5 === 1) {
        thinkEnemy(s, {
            issue: (id, o) => issueOrder(s, id, o),
            log: (text, unitId) => log(s, 'ai', text, unitId),
            useAbility: (id, targetId) => enemyUseAbility(s, id, targetId).ok,
        });
        // 3b. 武将の基本方針（BattleSetup.generalInitiative の合戦だけ。命令を受けていない待機中の味方の武将の部隊）
        if (s.setup.generalInitiative) {
            thinkGenerals(s, {
                order: (id, o) => {
                    const g = unitById(s, id);
                    if (!g?.initiative || !applyOrder(s, g, o)) return false;
                    g.initiative.acting = true;
                    return true;
                },
                rooted: (id) => isRooted(s, id),
                log: (text, unitId, targetId) => log(s, 'general', text, unitId, targetId),
            });
        }
    }

    // 4. 命令の確かめ（攻撃の相手が崩れた・見えなくなった）と、この刻みの動き・交戦相手
    const plans = new Map<UnitState, Plan>();
    for (const u of s.units) {
        if (!u.present) continue;
        plans.set(u, planFor(s, u));
    }
    // 4b. 狭い正面（特殊ルールのある戦場だけ）
    if (s.field.narrow.length > 0) narrowFrontage(s, plans);

    // 5. 損害
    const n = s.units.length;
    const loss = new Float64Array(n);
    const arrowLoss = new Float64Array(n); // loss のうち矢による分
    const pressure = new Float64Array(n); // 側面・背後の圧力（毎秒の士気の低下）
    const shock = new Float64Array(n);
    const meleeCount = new Int32Array(n);
    const index = new Map<UnitState, number>();
    s.units.forEach((u, i) => {
        index.set(u, i);
        u.attackers = [];
    });
    const crowd = frontCrowding(s, plans, index);
    // 包囲（両翼の采配の効果中だけ）：同じ相手を別の向きから斬っている味方の組を調べる
    if (s.encircled.length > 0) s.encircled = [];
    if (encircleLive(s)) {
        const hits: { a: UnitState; d: UnitState; dir: AttackDir }[] = [];
        for (const a of s.units) {
            const d = plans.get(a)?.melee;
            if (d && a.status === 'ready') hits.push({ a, d, dir: attackDir(d, a.x, a.z) });
        }
        s.encircled = findEncircled(s, hits);
    }
    for (const a of s.units) {
        const p = plans.get(a);
        if (!p) continue;
        a.engagedWith = p.melee ? p.melee.id : null;
        a.shootingAt = p.ranged ? p.ranged.id : null;
        if (a.status !== 'ready') continue;
        if (p.melee) {
            const d = p.melee;
            const di = index.get(d)!;
            const wasInMelee = t - a.lastMeleeT <= RULES.tick * 1.5;
            const key = a.id < d.id ? `${a.id}|${d.id}` : `${d.id}|${a.id}`;
            const lastContact = s.contactT[key];
            if (d.status === 'ready' && (lastContact === undefined || t - lastContact > 10)) log(s, 'engage', `${a.name}と${d.name}が交戦`, a.id, d.id);
            s.contactT[key] = t;
            const arc = attackArc(d, a.x, a.z);
            // 林の奇襲（特殊ルールのある戦場だけ）：隠れていて、見つかってから間もない（その後まだ斬り合っていない）部隊の最初の当たり
            const amb = s.field.ambush;
            if (amb && !wasInMelee && d.status === 'ready' && (!a.seenBy[d.side] || (a.revealT >= t - (amb.windowSec ?? 30) - 1e-9 && a.lastMeleeT < a.revealT))) {
                a.ambushOn = d.id;
                a.ambushUntil = t + amb.sec;
                a.ambushMul = amb.firstStrikeMul;
                shock[di] += RULES.flankShock;
                log(s, 'ambush', `${a.name}が${d.name}へ不意を突いて斬りかかった`, a.id, d.id);
            }
            // 騎馬の突撃：動いてきて交戦に入った（直前 8 秒は斬り合っていない）。突撃にならない地形（第3群の湿地など）の中では起きない
            if (a.kind === 'kiba' && !wasInMelee && a.moving && t - a.lastMeleeT > 8 && !(s.field.noChargeKinds.length > 0 && noChargeIn(s.map, s.field, a.x, a.z))) {
                const intoPikes = d.kind === 'yari' && arc === 'front';
                if (!intoPikes && d.status === 'ready') {
                    a.chargeUntil = t + RULES.chargeSec;
                    shock[di] += 6;
                    log(s, 'charge', `${a.name}が${d.name}へ突撃した`, a.id, d.id);
                }
            }
            a.lastMeleeT = t;
            if (s.abilityList.length > 0) noteMeleeContact(s, a);
            const dmg = meleeDamage(s, a, d, arc) * dt * (crowd.get(a) ?? 1);
            loss[di] += dmg;
            d.attackers.push(a.id);
            if (d.status === 'ready') {
                meleeCount[di]++;
                if (arc !== 'front') {
                    pressure[di] += arc === 'rear' ? RULES.rearPressure : RULES.flankPressure;
                    const last = d.shockT[a.id];
                    if (last === undefined || t - last > 20) {
                        shock[di] += arc === 'rear' ? RULES.rearShock : RULES.flankShock;
                        log(s, arc, `${a.name}が${d.name}の${arc === 'rear' ? '背後' : '側面'}を突いた`, a.id, d.id);
                    }
                    d.shockT[a.id] = t;
                }
            }
        } else if (p.ranged) {
            const d = p.ranged;
            const di = index.get(d)!;
            const dmg = rangedDamage(s, a, d) * dt;
            loss[di] += dmg;
            arrowLoss[di] += dmg;
            d.attackers.push(a.id);
            d.lastArrowT = t;
            d.lastShooterId = a.id;
        }
    }

    // 6. 動き・向き
    for (const u of s.units) {
        const p = plans.get(u);
        if (!p) continue;
        moveUnit(s, u, p, dt);
    }
    separate(s);

    // 7. 損害と士気
    const routedNow: UnitState[] = [];
    /** 号令の守りが兵の下限で外れて敗走する部隊（知らせの文を分ける） */
    const guardBroken = new Set<UnitState>();
    s.units.forEach((u, i) => {
        if (!u.present) return;
        const l = Math.min(loss[i], u.strength);
        // 立て直しの号令の守り（兵の下限つき）：損害を入れる前に守られていたか。守られている間は、号令が無かったときの士気の
        // 見積もり（rallyShadow）も数える（守られ始めた時の士気から）
        const shielded = u.status === 'ready' && s.abilityList.length > 0 && abilityGuarded(s, u);
        if (!shielded) u.rallyShadow = null;
        else if (u.rallyShadow === null) u.rallyShadow = u.morale;
        const guarded = l > 0 && shielded;
        u.recentLoss = u.recentLoss * 0.9 + l;
        if (l > 0) {
            u.strength -= l;
            u.lastHitT = t;
        }
        if (u.status !== 'ready') return;
        if (u.strength < 1) return;
        const aura = !u.isHq && nearOwnHq(s, u) ? RULES.hqAuraMul : 1;
        const felt = loss[i] > 0 ? l * (1 - (1 - RULES.rangedMoraleMul) * (arrowLoss[i] / loss[i])) : 0;
        let down = (felt / u.startStrength) * RULES.moralePerLoss + shock[i] + pressure[i] * dt;
        if (meleeCount[i] >= 2) down += RULES.outnumberedPressure * dt;
        if (u.isHq && meleeCount[i] >= 1) down += RULES.hqUnderAttack * dt;
        down *= aura;
        const baseDown = down;
        const inMelee = meleeCount[i] > 0 || !!u.engagedWith;
        down *= abilityMoraleLossMul(s, u, inMelee);
        const enc = s.encircled.length > 0 ? encircleMul(s, u).morale : 1;
        if (s.encircled.length > 0) down *= enc;
        let m = u.morale - down;
        const recovering = t - u.lastHitT >= RULES.recoverDelay && !u.engagedWith;
        const recover = (RULES.recoverRate + (aura < 1 ? RULES.recoverHqBonus : 0)) * dt;
        if (recovering) {
            m += recover;
            // 号令で最初の士気より上がった分は、戻りで削らない
            m = Math.min(m, Math.max(u.maxMorale, u.morale));
        }
        // 号令が無かったときの士気の見積もり：同じ損害・圧力で、号令の士気の低下の軽減・士気の床なしに下げる（ほかの能力の軽減は効かせる）
        if (shielded && u.rallyShadow !== null) {
            let sh = u.rallyShadow - baseDown * abilityShadowLossMul(s, u, inMelee) * enc;
            if (recovering) sh = Math.min(sh + recover, Math.max(u.maxMorale, u.rallyShadow));
            u.rallyShadow = clamp(sh, 0, 100);
        }
        // 立て直しの号令：士気が決まった値より下がらない（もとから低い部隊は今の値より下がらない）
        if (s.abilityList.length > 0) {
            const floor = abilityMoraleFloor(s, u);
            if (floor > 0) m = Math.max(m, Math.min(u.morale, floor));
        }
        u.morale = clamp(m, 0, 100);
        // 号令に守られていた部隊が、この損害で兵の下限（最初の 3 割）を切った：守りが外れる。号令が支えていた士気（+40・低下の軽減・
        // 士気の床）も外れ、号令が無かったときの士気の見積もりまで下がる。そこから普通の決まり：敗走の線以下ならその場で敗走する
        // （号令が無ければもう崩れていた部隊。全滅するまで戦わない）。士気が自前で高い部隊は戦い続ける（号令が無い時と同じ。
        // 号令のせいで崩れることはない。家康本陣も同じ扱いで、号令を使ったせいで本陣が崩れて負けることはない）
        const broken = guarded && abilityGuardBroken(s, u);
        if (broken) {
            if (u.rallyShadow !== null) u.morale = Math.min(u.morale, u.rallyShadow);
            u.rallyShadow = null;
        }
        if (u.morale <= abilityRoutMorale(s, u, RULES.routMorale)) {
            routedNow.push(u);
            if (broken) guardBroken.add(u);
        } else if (broken) log(s, 'ability', `${u.name}：兵が減り、号令の守りが外れた（士気 ${Math.round(u.morale)}・普通の決まりで戦う）`, u.id);
    });

    // 8. 全滅・敗走
    for (const u of s.units) {
        if (!u.present || u.status === 'destroyed' || u.strength >= 1) continue;
        u.strength = 0;
        u.status = 'destroyed';
        u.present = false;
        u.engagedWith = null;
        u.shootingAt = null;
        log(s, 'destroyed', `${u.name}が全滅した`, u.id);
    }
    for (const u of routedNow) {
        if (u.status !== 'ready') continue;
        u.status = 'routed';
        u.order = { type: 'retreat' };
        u.engagedWith = null;
        u.shootingAt = null;
        u.faceGoal = null;
        const why = guardBroken.has(u) ? '（兵が減り、号令でも支えきれない）' : '';
        log(s, 'rout', u.isHq ? `${u.name}が崩れた！${why}` : `${u.name}が敗走した${why}`, u.id);
        for (const o of s.units) {
            if (o === u || o.side !== u.side || !isActive(o)) continue;
            const mul = abilityMoraleLossMul(s, o, !!o.engagedWith);
            const floor = s.abilityList.length > 0 ? Math.min(o.morale, abilityMoraleFloor(s, o)) : 0;
            const hit = u.isHq ? RULES.hqRoutShock : dist(o, u) <= RULES.nearbyRoutRadius ? RULES.nearbyRoutShock : 0;
            if (hit > 0) o.morale = Math.max(floor, o.morale - hit * mul);
            // 号令が無かったときの士気の見積もりも、同じ揺れを号令の軽減なしで受ける
            if (hit > 0 && o.rallyShadow !== null) o.rallyShadow = Math.max(0, o.rallyShadow - hit * abilityShadowLossMul(s, o, !!o.engagedWith));
        }
    }

    // 9. 退き口に着いた
    for (const u of s.units) {
        if (!u.present) continue;
        const leaving = u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat');
        if (!leaving) continue;
        const e = exitPointFor(s, u);
        if (dist(u, e) > 6) continue;
        u.present = false;
        u.engagedWith = null;
        u.shootingAt = null;
        if (u.status === 'routed') log(s, 'fled', `${u.name}が戦場から逃れ去った`, u.id);
        else {
            u.status = 'withdrawn';
            log(s, 'withdrawn', `${u.name}が戦場を離れた`, u.id);
            if (s.pledge && s.pledge.targetId === u.id && !s.pledge.withdrew) {
                s.pledge.withdrew = true;
                log(s, 'pledge', `${u.name}が退き口から無事に戦場を離れた（約束：兵が最初の ${Math.round(s.pledge.minStrengthRatio * 100)}% 以上なら守れる）`, u.id);
            }
        }
    }

    // 9b. 戦前の約束：対象が安全地点に続けていた時間
    if (s.pledge) trackPledge(s, dt);

    // 9c. 門の制圧（門のある戦場だけ。目標の前に：門が開いた刻みに、門の制圧の目標も果たす）
    if (s.field.gates.length > 0) trackGates(s, dt);

    // 9d. 目標（目標のある合戦だけ）
    if (s.objectives) trackObjectives(s, dt, (text) => log(s, 'objective', text));

    // 10. 勝ち負け
    decide(s);
}

/**
 * 狭い正面（特殊ルール narrow_frontage）：区域の中（斬りかかる側か相手のどちらかが区域の中）では、同じ相手へ斬りかかれるのは
 * maxEngaged 部隊まで。先に数えるのは、前の刻みから斬り合っている部隊、相手が斬り合っている部隊、近い順・並びの順。
 * あふれた部隊はこの刻みは斬り合わず、その場で待つ（前が空くと入れ替わる）。
 */
function narrowFrontage(s: BattleState, plans: Map<UnitState, Plan>): void {
    for (const rule of s.field.narrow) {
        const byTarget = new Map<UnitState, UnitState[]>();
        for (const a of s.units) {
            const p = plans.get(a);
            const d = p?.melee;
            if (!d || a.status !== 'ready' || d.status !== 'ready') continue;
            if (!inZone(rule.zone, a.x, a.z) && !inZone(rule.zone, d.x, d.z)) continue;
            const list = byTarget.get(d);
            if (list) list.push(a);
            else byTarget.set(d, [a]);
        }
        for (const [d, list] of byTarget) {
            if (list.length <= rule.maxEngaged) continue;
            const theirs = plans.get(d)?.melee ?? null;
            const order = (a: UnitState) => s.units.indexOf(a);
            list.sort(
                (a, b) =>
                    Number(b.engagedWith === d.id) - Number(a.engagedWith === d.id) ||
                    Number(b === theirs) - Number(a === theirs) ||
                    dist(a, d) - dist(b, d) ||
                    order(a) - order(b),
            );
            for (let k = rule.maxEngaged; k < list.length; k++) {
                const p = plans.get(list[k]!)!;
                p.melee = null;
                p.goal = null;
            }
        }
    }
}

/**
 * 正面の幅：戦える相手の正面へ 2 部隊以上で斬りかかると、2 部隊目からは与える損害 ×frontCrowdMul
 * （相手の正面はもう塞がっていて、後ろから押すだけになる）。先に数えるのは、相手が斬り合っている部隊、次に近い順・並びの順。
 * 同じ相手でも、側面・背後から当たる部隊は減らない（数で押すより、回り込む方が効く）。
 */
function frontCrowding(s: BattleState, plans: Map<UnitState, Plan>, index: Map<UnitState, number>): Map<UnitState, number> {
    const out = new Map<UnitState, number>();
    const fronts = new Map<UnitState, UnitState[]>();
    for (const a of s.units) {
        const d = plans.get(a)?.melee;
        if (!d || a.status !== 'ready' || d.status !== 'ready') continue;
        if (attackArc(d, a.x, a.z) !== 'front') continue;
        const list = fronts.get(d);
        if (list) list.push(a);
        else fronts.set(d, [a]);
    }
    for (const [d, list] of fronts) {
        if (list.length < 2) continue;
        const theirs = plans.get(d)?.melee ?? null;
        list.sort((a, b) => Number(b === theirs) - Number(a === theirs) || dist(a, d) - dist(b, d) || index.get(a)! - index.get(b)!);
        for (let k = 1; k < list.length; k++) out.set(list[k]!, RULES.frontCrowdMul);
    }
    return out;
}

/** 見えているか（林の中の部隊は、相手の戦える部隊が 60 m 以内に来るまで見えない） */
function updateVisibility(s: BattleState, events: BattleEvent[] | null): void {
    const high = s.field.high;
    for (const u of s.units) {
        const opp = other(u.side);
        let seen: boolean;
        // 隠れる地形（既定は林 60 m）の中の部隊は、相手の戦える部隊がその距離に来るまで見えない。高所の相手は sightBonus だけ遠くから見つける
        const hide = u.present ? hideSightIn(s.map, s.field, u.x, u.z) : null;
        if (!u.present) seen = false;
        else if (hide === null) seen = true;
        else if (high.sightBonus > 0) seen = s.units.some((o) => o.side === opp && isActive(o) && dist(o, u) <= hide + (elevationAt(s.map, o.x, o.z) >= high.minDiff ? high.sightBonus : 0));
        else seen = s.units.some((o) => o.side === opp && isActive(o) && dist(o, u) <= hide);
        const was = u.seenBy[opp];
        u.seenBy[opp] = seen;
        u.seenBy[u.side] = u.present;
        // 林の奇襲の判定：隠れていた部隊が見つかった時刻
        if (u.present && !seen) u.wasHidden = true;
        else if (seen && u.wasHidden) {
            u.wasHidden = false;
            u.revealT = s.t;
        }
        if (!events || !seen || was) continue;
        // 林の縁を出入りして何度も知らせないように、同じ部隊は 15 秒あける
        const key = `seen:${u.id}`;
        const last = s.contactT[key];
        s.contactT[key] = s.t;
        if (last !== undefined && s.t - last < 15) continue;
        if (u.side === 'enemy') {
            const woods = inTerrain(s.map, 'woods', u.x, u.z) || wasInWoodsRecently(s, u);
            log(s, 'spotted', woods ? `${u.name}が林から現れた` : `${u.name}が現れた`, u.id);
        } else if (u.arrived && s.t > 0) {
            log(s, 'discovered', `敵が${u.name}に気づいた`, u.id);
        }
    }
}
function wasInWoodsRecently(s: BattleState, u: UnitState): boolean {
    // 1 刻み前の位置は持っていないので、林の縁から 8 m 以内なら林から出てきたとみなす
    for (const dx of [-8, 0, 8]) for (const dz of [-8, 0, 8]) if (inTerrain(s.map, 'woods', u.x + dx, u.z + dz)) return true;
    return false;
}

function nearOwnHq(s: BattleState, u: UnitState): boolean {
    const hq = hqOf(s, u.side);
    return !!hq && hq !== u && isActive(hq) && dist(hq, u) <= RULES.hqAura;
}

/** この刻みの計画（誰と斬り合うか・誰を射るか・どこへ動くか）。攻撃の相手が無効なら命令を直す */
function planFor(s: BattleState, u: UnitState): Plan {
    if (u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat')) {
        const e = exitPointFor(s, u);
        return { melee: null, ranged: null, goal: { x: e.x, z: e.z, stopAt: 0 } };
    }
    if (u.status !== 'ready') return { melee: null, ranged: null, goal: null };

    // 攻撃の相手を確かめる
    if (u.order.type === 'attack') {
        const tid = u.order.targetId;
        const tgt = unitById(s, tid);
        if (!tgt || !isActive(tgt)) {
            u.order = { type: 'hold' };
            if (u.side === 'ally' && tgt) log(s, 'lost', `${u.name}：${tgt.name}が崩れたので、その場で待機する`, u.id, tgt.id);
        } else if (!tgt.seenBy[u.side]) {
            u.order = { type: 'move', x: tgt.x, z: tgt.z };
            if (u.side === 'ally') log(s, 'lost', `${u.name}は${tgt.name}を見失った`, u.id, tgt.id);
        }
    }

    const opp = other(u.side);
    // 間合いの中の相手（戦える相手を先に、近い順。同じ距離なら並びの順）
    const near: UnitState[] = [];
    const nearRouted: UnitState[] = [];
    for (const o of s.units) {
        if (o.side !== opp || !o.present) continue;
        if (dist(o, u) > RULES.meleeRange) continue;
        // 第3群：建物・石垣・閉じた門を挟んだ相手とは斬り合わない（射線と同じ判定。柵は挟んでも斬り合える。障害物の無い戦場では判定しない）
        if (!hasLineOfSight(s, u, o)) continue;
        if (o.status === 'ready') near.push(o);
        else if (o.status === 'routed') nearRouted.push(o);
    }
    near.sort((a, b) => dist(a, u) - dist(b, u));
    nearRouted.sort((a, b) => dist(a, u) - dist(b, u));
    const prevU = u.engagedWith ? unitById(s, u.engagedWith) : undefined;
    const prev = prevU && prevU.side === opp && isActive(prevU) && dist(prevU, u) <= RULES.meleeRange + RULES.meleeHold && hasLineOfSight(s, u, prevU) ? prevU : null;
    const front = (o: UnitState, heading: number) => Math.abs(angleDiff(heading, headingTo(u.x, u.z, o.x, o.z))) <= 70 * DEG;
    const inFront = (heading: number) => (prev && front(prev, heading) ? prev : near.find((o) => front(o, heading)) ?? null);
    const holdMelee = () => prev ?? near[0] ?? nearRouted[0] ?? null;

    const order = u.order;
    if (order.type === 'move') {
        const heading = headingTo(u.x, u.z, order.x, order.z);
        const block = dist(u, order) > 1.5 ? inFront(heading) : holdMelee();
        if (block) return { melee: block, ranged: null, goal: null };
        return { melee: null, ranged: null, goal: { x: order.x, z: order.z, stopAt: 0 } };
    }
    if (order.type === 'attack') {
        const tgt = unitById(s, order.targetId)!;
        const d = dist(u, tgt);
        if (near.includes(tgt) || prev === tgt) {
            // 追い討ち（歴史分岐の合戦だけ）：退いている相手は、斬りながら後を追う
            if (s.setup.pursuit && isRetreatingUnit(tgt)) return { melee: tgt, ranged: null, goal: { x: tgt.x, z: tgt.z, stopAt: RULES.pursuitFollowStop } };
            return { melee: tgt, ranged: null, goal: null };
        }
        if (u.kind === 'yumi') {
            if (near.length || prev) return { melee: holdMelee(), ranged: null, goal: null };
            if (d <= RULES.bowStandoff + 0.5) {
                if (hasLineOfSight(s, u, tgt)) return { melee: null, ranged: tgt, goal: null };
                // 射線が建物・石垣・閉じた門に遮られている（第3群）：射線が通る、いちばん近い射ち場へ回る（無ければ相手へ近づく）
                const v = vantagePoint(s, u, tgt);
                return { melee: null, ranged: null, goal: v ? { x: v.x, z: v.z, stopAt: 0 } : { x: tgt.x, z: tgt.z, stopAt: RULES.meleeRange + 5 } };
            }
            return { melee: null, ranged: null, goal: { x: tgt.x, z: tgt.z, stopAt: RULES.bowStandoff } };
        }
        const block = inFront(headingTo(u.x, u.z, tgt.x, tgt.z));
        if (block) return { melee: block, ranged: null, goal: null };
        // 相手が建物・石垣・閉じた門の向こうなら、手前で止まらず道をたどって回り込む（第3群）
        return { melee: null, ranged: null, goal: { x: tgt.x, z: tgt.z, stopAt: hasLineOfSight(s, u, tgt) ? RULES.meleeRange * 0.8 : 0 } };
    }
    // 防衛・待機：間合いの中の相手と斬り合う。弓は見えている一番近い相手を射る
    const m = holdMelee();
    if (m) return { melee: m, ranged: null, goal: null };
    if (u.kind === 'yumi') return { melee: null, ranged: nearestShootable(s, u), goal: null };
    return { melee: null, ranged: null, goal: null };
}

/** 撤退の命令で退いている（戦える状態で退き口へ向かっている）部隊 */
export function isRetreatingUnit(u: UnitState): boolean {
    return u.present && u.status === 'ready' && u.order.type === 'retreat';
}

/** 弓の届く距離（高所の射程の上乗せがある戦場では、射手が minDiff 以上高いとき rangeBonus を足す） */
export function bowRangeFor(s: BattleState, a: { x: number; z: number }, d: { x: number; z: number }): number {
    const h = s.field.high;
    if (h.rangeBonus > 0 && elevationAt(s.map, a.x, a.z) - elevationAt(s.map, d.x, d.z) >= h.minDiff) return RULES.bowRange + h.rangeBonus;
    return RULES.bowRange;
}

/**
 * 射手 a から相手 d への射線が通るか（第3群。射線を遮る建物・石垣・門が無い戦場では、計算せずにいつも true）。
 * 敵の考え（ai.ts）は fieldRules.ts の lineOfSight を直に使う（同じ判定）
 */
export function hasLineOfSight(s: BattleState, a: { x: number; z: number }, d: { x: number; z: number }): boolean {
    return !s.field.los || lineOfSight(s.map, s.field, a, d);
}

/**
 * 射線が遮られた相手を射る射ち場（第3群）：相手から 50〜100 m の輪の上（15° おき）で、通れて、相手への射線が通り、射手の届く距離の点のうち、
 * 射手にいちばん近い点（同じ距離なら並びの順）。無ければ null
 */
function vantagePoint(s: BattleState, u: UnitState, tgt: UnitState): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const r of [90, 70, 50, 100]) {
        for (let k = 0; k < 24; k++) {
            const a = (k * Math.PI) / 12;
            const p = { x: tgt.x + Math.sin(a) * r, z: tgt.z - Math.cos(a) * r };
            if (Math.abs(p.x) > s.map.width / 2 - 2 || Math.abs(p.z) > s.map.depth / 2 - 2 || !passableAt(s, p.x, p.z)) continue;
            if (r > bowRangeFor(s, p, tgt) || !hasLineOfSight(s, p, tgt)) continue;
            const d = dist(u, p);
            if (d < bd - 1e-9) {
                bd = d;
                best = p;
            }
        }
    }
    return best;
}

function nearestShootable(s: BattleState, u: UnitState): UnitState | null {
    let best: UnitState | null = null;
    let bd = Infinity;
    for (const o of s.units) {
        if (o.side === u.side || !isActive(o) || !o.seenBy[u.side]) continue;
        const d = dist(o, u);
        // 射線が遮られている相手は射ない（射線の格子の無い戦場では見ない）
        if (d <= bowRangeFor(s, u, o) && d < bd && (!s.field.los || lineOfSight(s.map, s.field, u, o))) {
            bd = d;
            best = o;
        }
    }
    return best;
}

function moraleMul(u: UnitState): number {
    return 0.4 + 0.6 * (u.morale / 100);
}

/** 近接の損害（1 秒あたり） */
export function meleeDamage(s: BattleState, a: UnitState, d: UnitState, arc: 'front' | 'flank' | 'rear'): number {
    let m = RULES.meleeRate * KIND_STATS[a.kind].power * KIND_STATS[d.kind].defence * moraleMul(a);
    // 相性
    if (a.kind === 'yari' && d.kind === 'kiba' && attackArc(a, d.x, d.z) === 'front') m *= 1.5; // 槍は騎馬を正面で受け止める
    if (a.kind === 'kiba' && d.kind === 'yari' && arc === 'front') m *= 0.6; // 騎馬は槍の正面に弱い
    if (a.kind === 'kiba' && d.kind === 'yumi') m *= 1.5;
    if (a.kind === 'kiba' && d.kind === 'honjin') m *= 1.1;
    // 向き
    if (arc === 'flank') m *= RULES.flankMul;
    else if (arc === 'rear') m *= RULES.rearMul;
    // 丘の守り（下から正面に来る相手。既定は RULES.hillMul・hillDiff と同じ。戦場ごとに fieldRules.highGround で上書き）
    const high = s.field.high;
    if (arc === 'front' && elevationAt(s.map, d.x, d.z) - elevationAt(s.map, a.x, a.z) >= high.minDiff) m *= high.defenseVsLower;
    // 防衛・待機
    if (d.status === 'ready' && d.order.type === 'hold' && !d.moving) m *= RULES.holdMul;
    // 湿地・浅瀬など（中にいる部隊の与える・受ける損害。既定は湿地 ×0.8・×1.15、浅瀬 ×0.8・×1.2）
    m *= dealMulIn(s.map, s.field, a.x, a.z);
    m *= takeMulIn(s.map, s.field, d.x, d.z);
    // 林の奇襲（特殊ルールのある戦場だけ）
    if (a.ambushOn === d.id && s.t <= a.ambushUntil) m *= a.ambushMul;
    // 突撃・追い討ち
    if (a.kind === 'kiba' && s.t <= a.chargeUntil) m *= RULES.chargeMul;
    if (d.status === 'routed') m *= RULES.pursuitMul;
    // 特殊能力（号令・援護の代償、退路の守護・援護の守り。能力がなければ 1）
    m *= abilityDealMul(s, a) * abilityTakeMul(s, d);
    if (s.abilityList.length > 0) {
        // 両翼の采配（包囲した相手への側面・背後の当たりだけ）・包囲（挟まれた相手）・先駆けの号（最初の当たり・弓や退く相手・側背）
        if (arc !== 'front' && s.encircled.length > 0) m *= abilityFlankDealMul(s, a, d, arc);
        if (s.encircled.length > 0) m *= encircleMul(s, d).take;
        m *= vanguardDealMul(s, a, d, arc);
    }
    return a.strength * m;
}

/** 弓の損害（1 秒あたり） */
export function rangedDamage(s: BattleState, a: UnitState, d: UnitState): number {
    const r = dist(a, d);
    // 高所の射程の上乗せ（ある戦場だけ）は、減衰の始まりと終わりを同じだけ遠くへずらす
    const bonus = bowRangeFor(s, a, d) - RULES.bowRange;
    const fall =
        bonus > 0
            ? r <= RULES.bowFullRange + bonus
                ? 1
                : 1 - (0.4 * (r - RULES.bowFullRange - bonus)) / (RULES.bowRange - RULES.bowFullRange)
            : r <= RULES.bowFullRange
              ? 1
              : 1 - (0.4 * (r - RULES.bowFullRange)) / (RULES.bowRange - RULES.bowFullRange);
    let m = RULES.rangedRate * KIND_STATS[d.kind].defence * moraleMul(a) * Math.max(0.6, fall);
    // 林など（中の相手への矢。既定は林 ×0.6）
    m *= arrowTakeMulIn(s.map, s.field, d.x, d.z);
    // 射手のいる地形（第3群の湿地の泥の中など。倍率を持つ地形の無い戦場では計算しない）
    if (s.field.arrowDealKinds.length > 0) m *= arrowDealMulIn(s.map, s.field, a.x, a.z);
    // 高所から低所へ射る矢（谷の両側から谷底など。既定 1 の戦場では計算しない）
    const hg = s.field.high;
    if (hg.arrowDealVsLower !== 1 && elevationAt(s.map, a.x, a.z) - elevationAt(s.map, d.x, d.z) >= hg.minDiff) m *= hg.arrowDealVsLower;
    m *= abilityDealMul(s, a) * abilityTakeMul(s, d);
    return a.strength * m;
}

function moveUnit(s: BattleState, u: UnitState, p: Plan, dt: number): void {
    const st = KIND_STATS[u.kind];
    u.moving = false;
    u.passThrough = null;
    if (!p.goal) {
        u.path = null;
        u.squeeze = null;
    }
    if (p.goal) {
        const d = dist(u, p.goal);
        let room = d - p.goal.stopAt;
        // 行き先が止まっている味方のすぐ隣で、もうその味方に触れる所まで来た：ここで着いたことにする（押しのけない）
        if (room > 0.05 && u.status === 'ready' && u.order.type === 'move' && friendHoldsGoal(s, u, p.goal)) room = 0;
        // 新しい動きの決まりの戦場：行き先の近くで進めなくなった移動は、着いたことにする
        if (room > 0.05 && s.field.settleMoves && u.status === 'ready' && u.order.type === 'move' && stuckNearGoal(s, u, p.goal, d, pathLeft(u, p.goal, d))) room = 0;
        // 通れない所がある戦場では、道探しの道の次の点へ向かう（無い戦場では行き先へまっすぐ）
        const aim = s.field.nav && room > 0.05 ? pathAim(s, u, p.goal) : p.goal;
        const direct = headingTo(u.x, u.z, aim.x, aim.z);
        if (room > 0.05) {
            // 少しだけ後ろへ下がるときは、向きを変えずに後ずさりする（半分の速さ）
            const backStep = u.status === 'ready' && u.order.type === 'move' && room < 20 && Math.abs(angleDiff(u.facing, direct)) > 120 * DEG;
            // 橋の上・橋の口で味方に挟まれて進めない：味方の中をすり抜ける（戦える部隊だけ。撤退・敗走はもとから味方の間をすり抜ける）
            if (s.field.nav && hasBridge(s.map) && u.status === 'ready' && u.order.type !== 'retreat') trackSqueeze(s, u);
            else u.squeeze = null;
            // 止まっている味方の部隊が行く手にあれば、横へよけて通る（戦える部隊だけ。撤退・敗走は味方の間をすり抜ける）
            const want = backStep || u.status !== 'ready' || u.order.type === 'retreat' ? direct : steerAround(s, u, aim, u.order.type === 'attack', p.goal);
            let aligned = 0.5;
            if (!backStep) {
                const turnRate = (u.status === 'routed' ? 180 : st.turnDeg) * DEG * dt;
                u.facing = turnToward(u.facing, want, turnRate);
                aligned = Math.abs(angleDiff(u.facing, want)) <= 45 * DEG ? 1 : 0.25;
            }
            let speed = st.speed * unitSpeedFactor(s, u) * aligned * abilitySpeedMul(s, u);
            if (u.status === 'routed') speed *= 1.2;
            const step = Math.min(speed * dt, room);
            // 相手の部隊の中へは入らない（14 m より近づかない）
            let nx = u.x + Math.sin(want) * step;
            let nz = u.z - Math.cos(want) * step;
            for (const o of s.units) {
                if (o.side === u.side || !isActive(o) || u.status !== 'ready') continue;
                const nd = Math.hypot(nx - o.x, nz - o.z);
                if (nd < ENEMY_GAP && nd < dist(u, o)) {
                    nx = u.x;
                    nz = u.z;
                    break;
                }
            }
            // 通れない所（川・崖）へは入らない：入るなら、壁に沿って横へずれる（どちらもだめならその場）
            const nav = s.field.nav;
            if (nav && !isPassable(nav, nx, nz) && isPassable(nav, u.x, u.z)) {
                if (isPassable(nav, nx, u.z)) nz = u.z;
                else if (isPassable(nav, u.x, nz)) nx = u.x;
                else {
                    nx = u.x;
                    nz = u.z;
                }
            }
            nx = clamp(nx, -s.map.width / 2 + 1, s.map.width / 2 - 1);
            nz = clamp(nz, -s.map.depth / 2, s.map.depth / 2);
            u.moving = Math.hypot(nx - u.x, nz - u.z) > 1e-4;
            u.x = nx;
            u.z = nz;
        } else if (u.status === 'ready' && u.order.type === 'move') {
            // 着いた：待機に変える（向き直りの指定があれば、そちらへ向き直る）
            u.faceGoal = u.order.face ?? null;
            u.order = { type: 'hold' };
            u.moveProg = null;
            if (u.initiative) settleInitiative(u);
        }
        if (room <= 0.05) u.squeeze = null;
        if (u.moving) return;
    }
    // 動いていないときの向き
    if (p.melee) {
        u.facing = turnToward(u.facing, headingTo(u.x, u.z, p.melee.x, p.melee.z), RULES.meleeTurnDeg * DEG * dt);
    } else if (p.ranged) {
        u.facing = turnToward(u.facing, headingTo(u.x, u.z, p.ranged.x, p.ranged.z), st.turnDeg * DEG * dt);
    } else if (u.order.type === 'attack') {
        const tgt = unitById(s, u.order.targetId);
        if (tgt) u.facing = turnToward(u.facing, headingTo(u.x, u.z, tgt.x, tgt.z), st.turnDeg * DEG * dt);
    } else if (u.faceGoal !== null) {
        u.facing = turnToward(u.facing, u.faceGoal, st.turnDeg * DEG * dt);
        if (Math.abs(angleDiff(u.facing, u.faceGoal)) < 1e-6) u.faceGoal = null;
    }
}

/**
 * 橋の詰まり（RULES.squeezeSec）を数える。動こうとしている刻みに毎回呼ぶ（橋のある戦場の、戦える部隊だけ）。
 * - 進みを数え始めた位置から squeezeMove m 動いたら、今の位置・時刻から数え直す。
 * - squeezeSec 秒のあいだ進めず、spacing + 2 m 以内に味方がいて、橋の区域から squeezeNear m 以内にいれば、すり抜けを始める。
 * - すり抜けは、始めた所から squeezeClear m 進み、spacing m 以内に味方がいなくなったら終わる。
 * 続けて呼ばれなかった（止まった・斬り合った）ときは数え直す。広い所や、味方がいない所（敵に塞がれている）では始めない
 */
function trackSqueeze(s: BattleState, u: UnitState): void {
    const q = u.squeeze;
    if (!q || s.t - q.seen > RULES.tick * 1.5) {
        u.squeeze = { x: u.x, z: u.z, t: s.t, seen: s.t, on: false };
        return;
    }
    q.seen = s.t;
    const moved = Math.hypot(u.x - q.x, u.z - q.z);
    const friendNear = (r: number) => s.units.some((o) => o !== u && o.side === u.side && isActive(o) && o.order.type !== 'retreat' && dist(o, u) < r);
    if (q.on) {
        if (moved >= RULES.squeezeClear && !friendNear(RULES.spacing)) u.squeeze = { x: u.x, z: u.z, t: s.t, seen: s.t, on: false };
        return;
    }
    if (moved >= RULES.squeezeMove) {
        q.x = u.x;
        q.z = u.z;
        q.t = s.t;
        return;
    }
    if (s.t - q.t < RULES.squeezeSec - 1e-9 || !friendNear(RULES.spacing + 2) || !nearBridge(s.map, u)) return;
    q.on = true;
    q.x = u.x;
    q.z = u.z;
    q.t = s.t;
}

/** 橋のある戦場か（地図ごとに 1 回だけ数える） */
const bridgeMaps = new WeakMap<BattleMap, boolean>();
function hasBridge(map: BattleMap): boolean {
    let v = bridgeMaps.get(map);
    if (v === undefined) bridgeMaps.set(map, (v = map.terrain.some((a) => a.kind === 'bridge')));
    return v;
}

/** u が橋の上か、橋の区域から RULES.squeezeNear m 以内（その地点と、まわりの 8 方向の squeezeNear m・その半分の距離で見る） */
function nearBridge(map: BattleMap, u: { x: number; z: number }): boolean {
    const bridges = map.terrain.filter((a) => a.kind === 'bridge');
    const on = (x: number, z: number) => bridges.some((a) => inArea(a, x, z));
    if (on(u.x, u.z)) return true;
    for (const r of [RULES.squeezeNear / 2, RULES.squeezeNear]) {
        for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            if (on(u.x + Math.sin(a) * r, u.z - Math.cos(a) * r)) return true;
        }
    }
    return false;
}

/**
 * 道探しの道の、次に向かう点（通れない所がある戦場だけ）。行き先が変わった（止まった行き先は 0.5 m、動く相手は RULES.repathMove m）、
 * または攻撃の相手へ向かう道を作ってから RULES.repathSec 秒たったら、今の位置から作り直す。道が無ければ行き先へまっすぐ。
 */
function pathAim(s: BattleState, u: UnitState, goal: { x: number; z: number }): { x: number; z: number } {
    const nav = s.field.nav!;
    const chasing = u.status === 'ready' && u.order.type === 'attack';
    let P = u.path;
    const moved = P ? Math.hypot(P.goalX - goal.x, P.goalZ - goal.z) : Infinity;
    let stale = !P || (chasing ? moved >= RULES.repathMove || s.t - P.builtT >= RULES.repathSec - 1e-9 : moved > 0.5);
    // 味方に押されるなどして道から外れ、次の点へまっすぐ行けなくなった（崖の角の陰に入った）：作り直す（RULES.repathSec 秒に 1 回まで）
    if (!stale && s.t - P!.builtT >= RULES.repathSec - 1e-9 && !lineClear(nav, u, P!.pts[P!.idx]!)) stale = true;
    if (stale) {
        const pts = findPath(nav, u.kind, u.x, u.z, goal.x, goal.z);
        P = u.path = { goalX: goal.x, goalZ: goal.z, builtT: s.t, pts: pts ?? [{ x: goal.x, z: goal.z }], idx: 0 };
    }
    const path = P!;
    while (path.idx < path.pts.length - 1 && (dist(u, path.pts[path.idx]!) <= RULES.waypointReach || passedWaypoint(nav, u, path.pts[path.idx]!, path.pts[path.idx + 1]!))) path.idx++;
    if (path.idx < path.pts.length - 1) return path.pts[path.idx]!;
    // 最後の点：動く相手は今の位置へ（通れる所にいれば）
    return isPassable(nav, goal.x, goal.z) ? goal : path.pts[path.pts.length - 1]!;
}

/**
 * 通る点 a を、もう通り過ぎたか：a から次の点 b へ向かう向きで見て a より先にいて、今の位置から b までまっすぐ通れる。
 * 味方をよけて横へずれた部隊や、通る点に味方が立っていて近づけない部隊が、後ろの点へ戻ろうとして詰まらないようにする。
 */
function passedWaypoint(nav: NonNullable<FieldEnv['nav']>, u: UnitState, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    if ((u.x - a.x) * (b.x - a.x) + (u.z - a.z) * (b.z - a.z) <= 0) return false;
    return lineClear(nav, u, b);
}

/** a から b までまっすぐ通れるか（2 m おきに見る） */
function lineClear(nav: NonNullable<FieldEnv['nav']>, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / 2));
    for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        if (!isPassable(nav, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
}

/** 味方の部隊をよける相手（戦えて、撤退中でなく、この刻みに動いていない味方） */
function isFriendObstacle(u: UnitState, o: UnitState): boolean {
    return o !== u && o.side === u.side && isActive(o) && o.order.type !== 'retreat' && !o.moving;
}

/**
 * 移動の行き先のすぐ隣（18 m 以内）に止まっている味方がいて、もうその味方に触れる所まで来ている。
 * 新しい動きの決まりの戦場で、目標の区域の中の行き先へ区域の外から向かう部隊は、斬り合っている味方を数えない
 * （その横をよけて区域へ入る。区域の縁で斬り合う味方の手前に止まって、確保を数えないままにならないように）
 */
function friendHoldsGoal(s: BattleState, u: UnitState, goal: { x: number; z: number }): boolean {
    // 通れない所がある戦場だけ、境目にゆとりを持たせる（無い戦場は Version 11 と同じ判定）
    const near = s.field.nav ? RULES.spacing - RULES.goalHoldSlack : RULES.spacing;
    for (const o of s.units) {
        if (!isFriendObstacle(u, o)) continue;
        if (o.engagedWith && entersObjectiveZone(s, u, goal)) continue;
        if (dist(o, goal) < near && dist(u, o) <= RULES.spacing + 1) return true;
    }
    return false;
}

/** 新しい動きの決まりの戦場で、まだ果たしていない目標の区域の中の行き先へ、区域の外から向かっている */
function entersObjectiveZone(s: BattleState, u: UnitState, goal: { x: number; z: number }): boolean {
    if (!s.field.settleMoves || !s.objectives) return false;
    return activeObjectiveZones(s).some((z) => inZone(z, goal.x, goal.z) && !inZone(z, u.x, u.z));
}

/**
 * 行き先までの残りの道のり（m）。道探しの道があれば、今の位置から次の点・残りの点を順にたどった長さ（道が行き先から遠ざかる回り道
 * ＝橋や水田の街道へ回る間も、道のりは減っていく）。道が無ければ（まっすぐ進む）行き先までの距離 d のまま
 */
function pathLeft(u: UnitState, goal: { x: number; z: number }, d: number): number {
    const P = u.path;
    if (!P || Math.abs(P.goalX - goal.x) > 0.5 || Math.abs(P.goalZ - goal.z) > 0.5 || P.idx >= P.pts.length) return d;
    let len = dist(u, P.pts[P.idx]!);
    for (let i = P.idx + 1; i < P.pts.length; i++) len += Math.hypot(P.pts[i]!.x - P.pts[i - 1]!.x, P.pts[i]!.z - P.pts[i - 1]!.z);
    return Math.max(len, d);
}

/**
 * 移動の行き先の近く（RULES.settleNear m 以内）で、RULES.settleSec 秒（近くの味方が動いていれば 3 倍）のあいだ行き先へ 1 m も近づけていない。
 * 遠くても、2 倍の時間近づけず、近くの味方がみな止まっている（動く・斬り合う味方がいない＝行き詰まっている）。近く（36 m）に戦える敵が
 * いる間は数えない（新しい動きの決まりの戦場だけ。
 * 毎刻み呼んで進みを覚える。行き先が変わった・続けて呼ばれなかったときは数え直す）。
 * 「近づいた」は、行き先までの距離 d が縮んだか、道探しの道が回り道（残りの道のり left が d より長い）の間は残りの道のりが縮んだか
 * （第2群：橋・水田の街道へ回る間に、行き先から遠ざかっても止まらない。まっすぐの道では left と d は同じなので、今までと 1 刻みも同じ）
 */
function stuckNearGoal(s: BattleState, u: UnitState, goal: { x: number; z: number }, d: number, left: number = d): boolean {
    const m = u.moveProg;
    // 初め・行き先が変わった・途中で見ていない刻みがあった（斬り合い・命令の出し直し）：今から数え直す
    if (!m || Math.abs(m.gx - goal.x) > 0.5 || Math.abs(m.gz - goal.z) > 0.5 || s.t - m.seen > RULES.tick * 1.5) {
        // 残りの道のりは、道探しの道ができてから数える（最初の刻みは道がまだ無く、まっすぐの距離になっている）
        u.moveProg = { gx: goal.x, gz: goal.z, best: d, bestLeft: Infinity, t: s.t, seen: s.t };
        return false;
    }
    m.seen = s.t;
    // 行く手を敵に塞がれている（近くに戦える敵がいる）間は数えない（敵がどけば、また進む）
    const foeNear = s.units.some((o) => o.side !== u.side && isActive(o) && dist(o, u) < RULES.spacing * 2);
    // 近づいたかは、行き先までの距離か、残りの道のり（道探しの回り道の間）のどちらかが 1 m 縮んだかで見る
    const pathGain = left > d + 1 && left <= m.bestLeft - 1;
    if (pathGain) m.bestLeft = left;
    if (d <= m.best - 1 || pathGain || foeNear) {
        m.best = Math.min(m.best, d);
        m.t = s.t;
        return false;
    }
    const still = s.t - m.t;
    if (still < RULES.settleSec - 1e-9) return false;
    // 近く（36 m）の味方：動いている味方がいれば、どくのを待って長めに（押し合ったまま止まらない二隊も、いずれ片方が着く）。
    // 行き先から遠い部隊は、動いている・斬り合っている味方がいれば待ち続ける（狭い所を抜ける列の途中・前の味方が戦っている列の後ろ）
    const friends = s.units.filter((o) => o !== u && o.side === u.side && isActive(o) && dist(o, u) < RULES.spacing * 2);
    const moving = friends.some((o) => o.moving);
    const fighting = friends.some((o) => !!o.engagedWith);
    if (d <= RULES.settleNear) return still >= RULES.settleSec * (moving ? 3 : 1) - 1e-9;
    if (fighting || moving) return false;
    return still >= RULES.settleSec * 2 - 1e-9;
}

/**
 * 行き先へ向かう向き。まっすぐ進むと止まっている味方の部隊の中を通るときは、その部隊の横をよけて通る向きにする。
 * - 行く手（前方 avoidLook m 以内・行き先より手前）で、進む線から 20 m 以内にいる味方をよける。いちばん手前の 1 部隊だけ見る。
 * - 移動の行き先がその味方の隣なら、よけずに近づく（friendHoldsGoal で隣に止まる）。攻撃の相手の手前の味方は回り込む。
 * - よける側：味方が進む線の右にいれば左、左にいれば右、線の真上なら左。よけた先に別の味方がいて、反対側が空いていれば反対側。
 * - 向き：その味方を中心とする半径 20 m の円に接する向き（もう円の中なら、円に沿って回る向き）。
 * - 通れない所がある戦場：goal は道探しの次の点、final は移動の行き先（無い戦場では同じ点）。行き先の隣の味方をよけないのは final で見る。
 *   よける側の横（味方から RULES.spacing m）が通れない側は通らない。どちらの側も通れない（崖に挟まれた狭い所に味方が止まっている）
 *   ときは、よけずにその味方の中をすり抜ける（passThrough。この刻みは押し離さない）。よける向きの先が崖・川なら、行き先の向きへ寄せる。
 */
function steerAround(s: BattleState, u: UnitState, goal: { x: number; z: number }, attacking: boolean, final: { x: number; z: number } = goal): number {
    const direct = headingTo(u.x, u.z, goal.x, goal.z);
    // 橋の詰まりで味方の中をすり抜けている（trackSqueeze）：よけずに進む
    if (u.squeeze?.on) {
        u.avoid = null;
        return direct;
    }
    const fx = Math.sin(direct);
    const fz = -Math.cos(direct);
    // 右手の向き
    const rx = Math.cos(direct);
    const rz = Math.sin(direct);
    // 目標の区域へ外から入る部隊は、道探しの次の点より先（移動の行き先まで）にいる味方も見てよける
    const entering = !attacking && entersObjectiveZone(s, u, final);
    const goalDist = entering ? Math.max(dist(u, goal), dist(u, final)) : dist(u, goal);
    const R = RULES.spacing + 2;
    let block: UnitState | null = null;
    let blockAlong = Infinity;
    let blockPerp = 0;
    for (const o of s.units) {
        if (!isFriendObstacle(u, o)) continue;
        const ox = o.x - u.x;
        const oz = o.z - u.z;
        const along = ox * fx + oz * fz;
        if (along <= 0 || along > Math.min(goalDist, RULES.avoidLook)) continue;
        const perp = ox * rx + oz * rz;
        if (Math.abs(perp) >= R) continue;
        // 行き先の隣の味方はよけない（隣に止まる）。目標の区域へ外から入る部隊は、斬り合っている味方をよけて行き先へ近づく
        if (!attacking && dist(o, final) < R && !(o.engagedWith && entering)) continue;
        if (along < blockAlong) {
            block = o;
            blockAlong = along;
            blockPerp = perp;
        }
    }
    if (!block) {
        u.avoid = null;
        return direct;
    }
    const b = block;
    const D = dist(u, b);
    const toB = headingTo(u.x, u.z, b.x, b.z);
    const off = D > R ? Math.asin(R / D) : Math.PI / 2;
    // side -1：左をよける（味方を右に見て通る）、+1：右をよける
    const tangent = (side: number) => toB + side * off;
    // 通れない所がある戦場：進む向きで見て、その味方の横（spacing m。右手は (rx, rz)）が通れるか。無い戦場はいつも通れる
    const nav = s.field.nav;
    const room = (side: number) => !nav || isPassable(nav, b.x + side * rx * RULES.spacing, b.z + side * rz * RULES.spacing);
    if (nav && !room(-1) && !room(1)) {
        u.avoid = null;
        u.passThrough = b.id;
        return direct;
    }
    let side: -1 | 1;
    if (u.avoid && u.avoid.id === b.id && room(u.avoid.side)) side = u.avoid.side;
    else {
        const clear = (h: number) => {
            const k = Math.min(D, 30);
            const p = { x: u.x + Math.sin(h) * k, z: u.z - Math.cos(h) * k };
            return !s.units.some((o) => o !== b && isFriendObstacle(u, o) && dist(o, p) < R && (attacking || dist(o, final) >= R));
        };
        side = blockPerp > 1e-6 ? -1 : blockPerp < -1e-6 ? 1 : -1;
        if (!room(side)) side = side === 1 ? -1 : 1;
        else if (!clear(tangent(side)) && clear(tangent(-side)) && room(-side)) side = side === 1 ? -1 : 1;
        u.avoid = { id: b.id, side };
    }
    const h = tangent(side);
    if (!nav) return h;
    // 接する向きの少し先（5 m）が通れない（崖の角・川岸）なら、行き先へまっすぐの向きへ寄せて、先が通れる最初の向きにする
    const d = angleDiff(h, direct);
    for (let k = 0; k <= 4; k++) {
        const hk = h + (d * k) / 4;
        if (isPassable(nav, u.x + Math.sin(hk) * 5, u.z - Math.cos(hk) * 5)) return hk;
    }
    return direct;
}

/**
 * 部隊どうしが重ならないようにする。
 * - 同じ陣営の戦える部隊は 18 m まで押し離す（動いている部隊が主によける。待機・斬り合い中の部隊はほとんど動かさない）。
 *   動いている部隊と止まっている部隊が近づいたときは、動いている部隊だけを押し戻す（止まっている味方を押し出さない）。
 *   押し離した先が相手の部隊に近づく（14 m より近い）ときは押さない（味方に押されて敵の中へ入らないように）。
 * - 相手の陣営の戦える部隊どうしは、14 m より近ければ押し離す。
 * - 敗走・撤退中の部隊は味方の間をすり抜ける。狭い所で味方の中をすり抜けている部隊（passThrough）も、その味方とは押し離さない。
 * - 通れない所がある戦場で、動いている味方どうしを押し離すとどちらかが崖・川へ入るときは、押し離さない（狭い所を並んで抜ける）。
 */
function separate(s: BattleState): void {
    const us = s.units;
    const solid = (u: UnitState) => isActive(u) && u.order.type !== 'retreat';
    const weight = (u: UnitState) => (u.engagedWith ? 0.1 : u.moving ? 1 : 0.25);
    const tooCloseToFoe = (u: UnitState, x: number, z: number) =>
        us.some((o) => o.side !== u.side && isActive(o) && Math.hypot(o.x - x, o.z - z) < ENEMY_GAP && Math.hypot(o.x - x, o.z - z) < dist(o, u));
    // 通れない所がある戦場では、押されても川・崖へは入らない（もともと通れない所にいる部隊は出られるように押す）
    const nav = s.field.nav;
    const okAt = (u: UnitState, x: number, z: number) => !nav || isPassable(nav, x, z) || !isPassable(nav, u.x, u.z);
    const nudge = (u: UnitState, dx: number, dz: number) => {
        const nx = u.x + dx;
        const nz = u.z + dz;
        if (tooCloseToFoe(u, nx, nz)) return;
        if (nav && !okAt(u, nx, nz)) return;
        u.x = nx;
        u.z = nz;
    };
    for (let i = 0; i < us.length; i++) {
        const a = us[i];
        if (!solid(a)) continue;
        for (let j = i + 1; j < us.length; j++) {
            const b = us[j];
            if (!solid(b)) continue;
            const d = dist(a, b);
            const gap = b.side === a.side ? RULES.spacing : ENEMY_GAP;
            if (d >= gap) continue;
            if (a.passThrough === b.id || b.passThrough === a.id) continue;
            // 橋の詰まりで味方の中をすり抜けている部隊（trackSqueeze）は、味方と押し離さない
            if (b.side === a.side && (a.squeeze?.on || b.squeeze?.on)) continue;
            let ux: number;
            let uz: number;
            if (d < 1e-6) {
                ux = 1;
                uz = 0;
            } else {
                ux = (b.x - a.x) / d;
                uz = (b.z - a.z) / d;
            }
            const push = gap - d;
            if (b.side !== a.side) {
                if (nav) {
                    const ax = a.x - (ux * push) / 2;
                    const az = a.z - (uz * push) / 2;
                    const bx = b.x + (ux * push) / 2;
                    const bz = b.z + (uz * push) / 2;
                    if (okAt(a, ax, az)) {
                        a.x = ax;
                        a.z = az;
                    }
                    if (okAt(b, bx, bz)) {
                        b.x = bx;
                        b.z = bz;
                    }
                    continue;
                }
                a.x -= (ux * push) / 2;
                a.z -= (uz * push) / 2;
                b.x += (ux * push) / 2;
                b.z += (uz * push) / 2;
                continue;
            }
            let wa = weight(a);
            let wb = weight(b);
            if (a.moving && !b.moving) wb = 0;
            else if (b.moving && !a.moving) wa = 0;
            const sum = wa + wb;
            // 通れない所がある戦場：どちらも動いていて、押し離すとどちらかが崖・川へ入る（狭い所を並んで抜けている）ときは、押し離さずに
            // すれ違わせる（押し合って両方が止まらないように。抜けて広い所へ出れば、また押し離す）
            if (nav && a.moving && b.moving) {
                const ka = (push * wa) / sum;
                const kb = (push * wb) / sum;
                if (!okAt(a, a.x - ux * ka, a.z - uz * ka) || !okAt(b, b.x + ux * kb, b.z + uz * kb)) continue;
            }
            nudge(a, -ux * push * (wa / sum), -uz * push * (wa / sum));
            nudge(b, ux * push * (wb / sum), uz * push * (wb / sum));
        }
    }
    for (const u of us) {
        u.x = clamp(u.x, -s.map.width / 2 + 1, s.map.width / 2 - 1);
        u.z = clamp(u.z, -s.map.depth / 2, s.map.depth / 2);
    }
}
/** 相手の部隊にこれより近づかない（m） */
const ENEMY_GAP = 14;

/** 戦える（まだ着いていない部隊も数える） */
function able(u: UnitState): boolean {
    return u.status === 'ready';
}

function finish(s: BattleState, result: BattleResultKind, reason: BattleEndReason): void {
    s.result = {
        result,
        reason,
        elapsedSec: round1(s.t),
        units: s.units.map((u) => ({
            id: u.id,
            side: u.side,
            clan: u.clan,
            ...(u.leaderId ? { leaderId: u.leaderId } : {}),
            startStrength: Math.round(u.startStrength),
            endStrength: Math.round(u.strength),
            status: u.status,
        })),
    };
    if (s.abilityList.length > 0) s.result.abilitiesUsed = abilitiesUsedRecord(s);
    const objs = finalObjectives(s, result, reason);
    if (objs) s.result.objectives = objs;
    if (s.pledge) {
        const p = pledgeProgress(s)!;
        // 勝利・日没（戦場に踏みとどまった）では約束の場面は要らない。撤退・敗北で終わるときは、場面になっていなければ守ったことにならない
        const ok = p.onTrackIgnoringContest && (p.contested || result === 'victory' || reason === 'nightfall');
        s.result.pledge = { targetId: p.targetId, result: ok ? 'kept' : 'broken' };
    }
    // 大将の呼び方（架空の第一章は「若殿」、歴史分岐は「家康」）
    const lord = hqOf(s, 'ally')?.clan === 'tokugawa' ? '家康' : '若殿';
    const text: Record<BattleEndReason, string> = {
        enemy_hq_routed: '敵の本陣が崩れた。勝利',
        enemy_army_broken: '敵の諸隊が崩れた。勝利',
        ally_hq_routed: `味方の本陣が崩れた。敗北（${lord}は落ち延びる）`,
        ally_army_broken: `味方の諸隊が崩れた。敗北（${lord}は落ち延びる）`,
        ordered_retreat: '兵をまとめて退いた。撤退',
        nightfall: '日が暮れた。両軍が兵を引く（撤退）',
        objective_done: `主目標「${s.objectives?.primary?.def.label ?? ''}」を果たした。勝利`,
        objective_failed: `主目標「${s.objectives?.primary?.def.label ?? ''}」を果たせなかった。敗北（${lord}は落ち延びる）`,
    };
    log(s, reason === 'nightfall' ? 'nightfall' : 'end', text[reason]);
}

function decide(s: BattleState): void {
    if (s.result) return;
    if (s.objectives?.primary) return decideByObjective(s);
    const t = s.t;
    // 全軍撤退：味方が戦場を離れ切ったか、待つ時間が過ぎたら終わる（その間は勝ち負けを決めない）
    if (s.allRetreatAt !== null) {
        const still = s.units.filter((u) => u.side === 'ally' && isActive(u));
        if (still.length === 0 || t - s.allRetreatAt >= RULES.retreatGraceSec - 1e-9) {
            for (const u of still) {
                u.status = 'withdrawn';
                u.present = false;
            }
            finish(s, 'retreat', 'ordered_retreat');
        }
        return;
    }
    const allyHq = hqOf(s, 'ally');
    const enemyHq = hqOf(s, 'enemy');
    if (allyHq && (allyHq.status === 'routed' || allyHq.status === 'destroyed')) return finish(s, 'defeat', 'ally_hq_routed');
    if (allyHq && allyHq.status === 'withdrawn') return finish(s, 'retreat', 'ordered_retreat');
    if (enemyHq && enemyHq.status !== 'ready') return finish(s, 'victory', 'enemy_hq_routed');
    const enemyOthers = s.units.filter((u) => u.side === 'enemy' && !u.isHq);
    if (enemyOthers.length > 0 && !enemyOthers.some(able)) return finish(s, 'victory', 'enemy_army_broken');
    const allyOthers = s.units.filter((u) => u.side === 'ally' && !u.isHq);
    if (allyOthers.length > 0 && !allyOthers.some(able)) {
        // 本陣以外の味方がすべて戦場にいない：命令で退かせた部隊が、崩れた（敗走・全滅）部隊より少なくなければ「撤退」
        // （本陣も兵をまとめて退く）。崩れた部隊の方が多ければ「敗北」
        const withdrawn = allyOthers.filter((u) => u.status === 'withdrawn').length;
        if (withdrawn >= allyOthers.length - withdrawn) {
            for (const u of s.units) {
                if (u.side !== 'ally' || !isActive(u)) continue;
                u.status = 'withdrawn';
                u.present = false;
                u.engagedWith = null;
                u.shootingAt = null;
            }
            return finish(s, 'retreat', 'ordered_retreat');
        }
        return finish(s, 'defeat', 'ally_army_broken');
    }
    if (s.tick >= Math.round(s.timeLimitSec / RULES.tick)) return finish(s, 'retreat', 'nightfall');
}

/**
 * 主目標のある合戦の勝ち負け（docs/battlefields-design.md §4）：
 * - 味方本陣の敗走・全軍が戦えない（崩れた部隊の方が多い）は今までどおり敗北。全軍撤退・本陣の撤退・日没は撤退。
 * - 主目標の達成で勝利（敵本陣の撃破は理由 enemy_hq_routed、ほかは objective_done）。果たせなくなれば敗北（objective_failed）。
 * - 敵の部隊がすべて戦えなくなれば勝利（敵本陣の撃破が主目標なら、今までどおり本陣以外が崩れれば勝利）。
 * - 撤退の成功（retreat_success）が主目標なら、撤退で終わるとき、果たせていれば勝利・果たせていなければ敗北。
 */
function decideByObjective(s: BattleState): void {
    const P = s.objectives!.primary!;
    const endRetreat = (reason: BattleEndReason) => {
        if (P.def.type !== 'retreat_success') return finish(s, 'retreat', reason);
        return P.state === 'done' ? finish(s, 'victory', 'objective_done') : finish(s, 'defeat', 'objective_failed');
    };
    const withdrawAll = () => {
        for (const u of s.units) {
            if (u.side !== 'ally' || !isActive(u)) continue;
            u.status = 'withdrawn';
            u.present = false;
            u.engagedWith = null;
            u.shootingAt = null;
        }
    };
    // 撤退の成功は、兵を離し切ってから判定する（離れた兵を数え直す）
    const recheck = () => {
        if (P.def.type === 'retreat_success') refreshObjective(s, P, (text) => log(s, 'objective', text));
    };
    if (s.allRetreatAt !== null) {
        const still = s.units.filter((u) => u.side === 'ally' && isActive(u));
        if (still.length === 0 || s.t - s.allRetreatAt >= RULES.retreatGraceSec - 1e-9) {
            for (const u of still) {
                u.status = 'withdrawn';
                u.present = false;
            }
            recheck();
            endRetreat('ordered_retreat');
        }
        return;
    }
    const allyHq = hqOf(s, 'ally');
    const enemyHq = hqOf(s, 'enemy');
    if (allyHq && (allyHq.status === 'routed' || allyHq.status === 'destroyed')) return finish(s, 'defeat', 'ally_hq_routed');
    if (allyHq && allyHq.status === 'withdrawn') {
        if (P.def.type === 'retreat_success') {
            withdrawAll();
            recheck();
        }
        return endRetreat('ordered_retreat');
    }
    if (P.state === 'done') return finish(s, 'victory', P.def.type === 'destroy_hq' && enemyHq ? 'enemy_hq_routed' : 'objective_done');
    if (P.state === 'failed') return finish(s, 'defeat', 'objective_failed');
    if (P.def.type === 'destroy_hq') {
        const enemyOthers = s.units.filter((u) => u.side === 'enemy' && !u.isHq);
        if (enemyOthers.length > 0 && !enemyOthers.some(able)) return finish(s, 'victory', 'enemy_army_broken');
    } else {
        const enemies = s.units.filter((u) => u.side === 'enemy');
        if (enemies.length > 0 && !enemies.some(able)) return finish(s, 'victory', 'enemy_army_broken');
    }
    const allyOthers = s.units.filter((u) => u.side === 'ally' && !u.isHq);
    if (allyOthers.length > 0 && !allyOthers.some(able)) {
        const withdrawn = allyOthers.filter((u) => u.status === 'withdrawn').length;
        if (withdrawn >= allyOthers.length - withdrawn) {
            withdrawAll();
            recheck();
            return endRetreat('ordered_retreat');
        }
        return finish(s, 'defeat', 'ally_army_broken');
    }
    if (s.tick >= Math.round(s.timeLimitSec / RULES.tick)) return endRetreat('nightfall');
}

// ---------------------------------------------------------------- 門（第3群）

/**
 * 毎刻み（門のある戦場だけ）：閉じた門ごとに、制圧の区域を「門を持つ側の戦える部隊がいない状態で、反対の側の戦える部隊が占めている」
 * 秒数を数える（外れると 0 に戻る）。capture.sec に届いたら門を開き、道探しの格子・射線の格子を作り直して、進んでいる道をすべて引き直す
 * （閉じた門へ向かって押し付けられていた部隊も、開いた門を通る道を新しく作る）
 */
/** 門の制圧を始めた知らせを、同じ門で出す間隔（秒）。途切れた知らせは、この秒数以上数えてからのときだけ */
const GATE_NOTE_SEC = 20;
const GATE_BREAK_NOTE_SEC = 3;

function trackGates(s: BattleState, dt: number): void {
    let changed = false;
    for (const g of s.field.gates) {
        if (g.open) continue;
        const z = g.def.capture.zone;
        const taker = other(g.holder);
        const takerIn = s.units.some((u) => u.side === taker && isActive(u) && inZone(z, u.x, u.z));
        const holderIn = s.units.some((u) => u.side === g.holder && isActive(u) && inZone(z, u.x, u.z));
        const prev = g.sec;
        g.sec = takerIn && !holderIn ? g.sec + dt : 0;
        // 出来事の知らせ：占め始めた（同じ門で GATE_NOTE_SEC 秒に 1 回まで）・GATE_BREAK_NOTE_SEC 秒以上数えてから途切れた
        if (prev === 0 && g.sec > 0 && (g.noteT === null || s.t - g.noteT >= GATE_NOTE_SEC)) {
            g.noteT = s.t;
            log(s, 'objective', `${g.def.name}の前の輪を占めた。敵を入れずに ${g.def.capture.sec} 秒続けると開く`);
        } else if (prev >= GATE_BREAK_NOTE_SEC && g.sec === 0) {
            log(s, 'objective', `${g.def.name}の制圧が途切れた（${Math.floor(prev)}／${g.def.capture.sec} 秒。${holderIn ? `輪に${g.holder === 'enemy' ? '敵' : '味方'}が入った` : `輪から${g.holder === 'enemy' ? '味方' : '敵'}が出た`}）`);
        }
        if (g.sec >= g.def.capture.sec - 1e-9) {
            g.open = true;
            g.openedT = s.t;
            changed = true;
            log(s, 'objective', `${g.def.name}を制圧した。門が開き、通れるようになった`);
        }
    }
    if (!changed) return;
    rebuildNav(s.map, s.field);
    for (const u of s.units) {
        u.path = null;
        u.moveProg = null;
        u.avoid = null;
    }
}

/** 門の状態（画面の説明・目標の進み用）。門の無い戦場は空 */
export function gateStates(s: BattleState): readonly GateRun[] {
    return s.field.gates;
}

// ---------------------------------------------------------------- 戦前の約束

/** 毎刻み：対象が戦える状態で安全地点の中にいる時間を数える（出ると 0 に戻る。一瞬触れただけでは満たさない） */
function trackPledge(s: BattleState, dt: number): void {
    const p = s.pledge!;
    const u = unitById(s, p.targetId);
    if (!u) return;
    const inside = u.present && u.status === 'ready' && Math.hypot(u.x - p.safeZone.cx, u.z - p.safeZone.cz) <= p.safeZone.r;
    p.zoneSec = inside ? p.zoneSec + dt : 0;
    if (!p.failNoted && (u.status === 'routed' || u.status === 'destroyed')) {
        p.failNoted = true;
        log(s, 'pledge', `${u.name}が崩れた。約束（退路を守る）は果たせない`, u.id);
    }
    if (!p.contested) {
        if (!p.pressed && u.present && u.status === 'ready') {
            p.pressed = !!u.engagedWith || s.units.some((o) => o.side !== u.side && isActive(o) && o.engagedWith === u.id);
        }
        if (s.units.some((o) => o.side === 'ally' && isActive(o) && !!o.engagedWith)) p.meleeSec += dt;
        if (p.pressed || p.meleeSec >= RULES.pledgeContestMeleeSec - 1e-9) {
            p.contested = true;
            log(s, 'pledge', p.pressed ? `${u.name}が敵と斬り合った。ここからが約束の場面（退路を守り切れば果たせる）` : `味方が敵と斬り結んだ。ここからが約束の場面（${u.name}を守り切れば果たせる）`, u.id);
        }
    }
    if (!p.secured && p.zoneSec >= p.holdSec - 1e-9) {
        p.secured = true;
        log(s, 'pledge', `${u.name}が味方の陣で ${p.holdSec} 秒持ちこたえた（約束：兵が最初の ${Math.round(p.minStrengthRatio * 100)}% 以上なら守れる）`, u.id);
    }
}

/**
 * 約束の見通し（約束のない合戦は null）。判定（docs/ieyasu1570-design.md §5）：
 * - 守れた：対象が「安全地点に holdSec 秒以上いた、または撤退の命令で退き口から離れた」か「合戦の終わりに戦えている」で、
 *   兵が最初の minStrengthRatio 以上残っている。
 * - 守れなかった：対象の敗走・全滅、または兵が足りない。承諾しただけ・安全地点に一瞬触れただけでは満たさない。
 */
export function pledgeProgress(s: BattleState): PledgeProgress | null {
    const p = s.pledge;
    if (!p) return null;
    const u = unitById(s, p.targetId)!;
    const ratio = u.startStrength > 0 ? u.strength / u.startStrength : 0;
    const failed = u.status === 'routed' || u.status === 'destroyed';
    const enough = ratio >= p.minStrengthRatio - 1e-9;
    const reached = p.secured || p.withdrew;
    const standing = u.status === 'ready' || u.status === 'withdrawn';
    const onTrackIgnoringContest = !failed && enough && (reached || standing);
    const inZone = u.present && u.status === 'ready' && Math.hypot(u.x - p.safeZone.cx, u.z - p.safeZone.cz) <= p.safeZone.r;
    return {
        targetId: p.targetId,
        targetName: u.name,
        zoneSec: round1(p.zoneSec),
        holdSec: p.holdSec,
        inZone,
        secured: p.secured,
        withdrew: p.withdrew,
        strengthRatio: ratio,
        minStrengthRatio: p.minStrengthRatio,
        failed,
        contested: p.contested,
        pressed: p.pressed,
        meleeSec: round1(p.meleeSec),
        contestMeleeSec: RULES.pledgeContestMeleeSec,
        onTrack: onTrackIgnoringContest && p.contested,
        onTrackIgnoringContest,
        result: s.result ? (s.result.pledge?.result ?? null) : null,
    };
}
