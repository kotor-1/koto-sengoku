/**
 * 武将固有の特殊能力（ゲーム用の創作。史実の人物が実際に持っていた能力ではない）。純粋な TypeScript（three・DOM なし）。
 * 設計：docs/ieyasu1570-design.md §4、強化（Version 13 候補）は docs/troops-abilities-design.md §2。
 * 効果量・範囲・時間・代償の数値は、このファイルの ABILITY_DATA 1 か所にまとめる。
 *
 * 共通の決まり：
 * - 各能力は 1 合戦 1 回。連打しても重ねて発動しない（2 回目からは断る）。
 * - 時間は合戦の時間（sim の時間 s.t）で数える。指揮中（一時停止）は stepBattle を呼ばないので減らない。
 * - 不適切な対象（敵・自分・範囲外・戦えない部隊）や、使えない時（まだ着いていない・敗走・撤退済み・全滅・合戦の後・対象がいない）は、
 *   断るだけで使用回数を減らさない。
 * - 全軍撤退の命令の後でも、戦場にいて戦える部隊なら使える（退路の守護で殿を務めるなど）。
 * - 武将（leaderId／generalId）のいない部隊は能力を持たない。敵方の武将の能力は敵の考え（ai.ts）だけが使う。
 *   プレイヤーの操作（useAbility）は味方の部隊の能力しか使えない。
 * - 部隊の能力の決め方（resolveAbilityId）：UnitDef.ability があればそれ、無ければ generalId の武将の abilityId（battle/generals.ts）。
 * - 酒井忠次・石川数正・榊原康政の能力は、数値の差し替え前提（provisional: true）。数値・効果はこのファイルの ABILITY_DATA だけを差し替えればよい。
 *   画面の説明（abilityInfo）は名前に「（仮）」を付け、断り書きにも仮と書く。
 *
 * 5 能力の強化（docs/troops-abilities-design.md §2。「使った瞬間に戦況が変わった」と分かる強さ）：
 * - 立て直しの号令（家康）：半径 110 m の味方の士気 +40（上限 100）。35 秒のあいだ士気が 20 未満に下がらない（敗走しない）・士気の低下 −60%。
 *   代償：家康本陣の与える損害 ×0.3・動き ×0.5。
 * - 両翼の采配（酒井）：25 秒のあいだ、半径 100 m の味方 2 部隊以上が同じ敵を別の向き
 *   （正面・左の側面・右の側面・背後のうち 2 つ以上）から斬っているとき、その敵は包囲されている：側面・背後から斬る味方の与える損害 ×1.8、
 *   その敵の受ける損害 ×1.3・士気の低下 ×2。包囲を作ること自体が条件（1 部隊だけの側面の当たり・正面だけの当たりは強くならない）。
 *   代償：酒井隊の動き ×0.7。
 * - 後詰めの差配（石川）：味方の部隊を 1 つ選ぶ（180 m 以内。自分は選べない）。30 秒のあいだ、対象の動き ×1.8・士気 +30・士気の低下 −50%・
 *   敗走の線 15 → 5。対象が予備・援軍・同盟（まだ斬り合っていない・後から着いた・別の家）なら、さらに士気の低下 −25%。
 *   代償：石川隊は差配に専念して動けない（与える損害は上がらない）。
 * - 退路の守護（忠勝）：50 秒のあいだ、半径 100 m で退く味方（撤退の命令・敗走中）の受ける損害 −80%・士気の低下 −80%。
 *   範囲の中で退く味方を追う敵は、忠勝隊へ向かう（引きつけ。敵の考え ai.ts）。代償：忠勝隊は動けず、受ける損害 ×1.4（無敵ではない）。
 * - 先駆けの号（榊原）：20 秒のあいだ、動き ×1.8。最初に当たった 8 秒は与える損害 ×2.0。弓隊・退く敵へ ×1.5、側面・背後 ×1.3。
 *   代償：受ける損害 ×1.2、時間で切れたとき士気 −15。
 * - 盟友への援護（長政）：今のまま。
 *
 * 画面から：
 *   abilityInfo(s, unitId)             … 能力名・対象・範囲・効果・代償・使えるか（理由）・点滅させるか（ready）・残り秒。能力のない部隊は null
 *   canTarget(s, userId, targetId)     … 対象の要る能力で、その部隊を対象に選べるか（targetReason で理由）
 *   useAbility(s, unitId, targetId?)   … プレイヤーが使う（一時停止中でもよい）。{ ok, reason }
 *   abilityMarks(s, unitId)            … いまその部隊に効いている能力の印（状態の表示用）
 *   abilityShortText(id)               … 短い説明（対象・効果・代償。数値は ABILITY_DATA から）
 * sim.ts（合戦の計算）から：abilityTakeMul・abilityDealMul・abilityFlankDealMul・abilityMoraleLossMul・abilityRoutMorale・abilitySpeedMul・
 *   abilityMoraleFloor・vanguardDealMul・noteMeleeContact・encircleLive・findEncircled・isRooted・updateAbilities（毎刻み）。
 *   能力がない合戦（架空の第一章）では、どれも 1（または元の値）を返すだけで計算は変わらない。
 *
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。小さな道具はここにも置く。
 */
import type { AbilityId, Side } from './types';
import type { BattleEvent, BattleState, UnitState } from './sim';
import { generalById } from './generals';

/** 対象の選び方：self_area＝その部隊を中心に範囲内へ効く（対象は選ばない）／ally_unit＝味方の部隊を 1 つ選ぶ／self＝自分の部隊だけ（対象は選ばない） */
export type AbilityTargetKind = 'self_area' | 'ally_unit' | 'self';

/**
 * 範囲内のどの部隊に効くか：all＝同じ陣営の戦える部隊（自分も）／retreating＝退いている味方（撤退の命令・敗走中。自分は除く）／
 * target＝選んだ部隊／self＝持つ部隊だけ
 */
export type AbilityAreaFilter = 'all' | 'retreating' | 'target' | 'self';

/** 攻め手が守り手のどの向きから当たっているか（包囲の判定。側面は左右を分ける） */
export type AttackDir = 'front' | 'left' | 'right' | 'rear';

/** 能力のデータ（調整はここだけ） */
export interface AbilityData {
    id: AbilityId;
    /** 能力名 */
    name: string;
    /** 持つ部隊の呼び方（説明用） */
    holderName: string;
    target: AbilityTargetKind;
    /** 範囲（m）。self_area は効く半径、ally_unit は対象を選べる距離（leash なら支えが届く距離も） */
    radius: number;
    /** 効果の時間（秒・合戦の時間） */
    durationSec: number;
    /** 使った瞬間、効果を受ける部隊（areaFilter）の士気 +（上限 100）。0 なら何もしない */
    moraleBoost: number;
    /** 範囲内（areaFilter）の部隊：受ける損害 ×、士気の低下 ×、敗走する士気の線（null なら変えない。−1 なら士気では敗走しない） */
    areaFilter: AbilityAreaFilter;
    areaTakeMul: number;
    areaMoraleLossMul: number;
    areaRoutMorale: number | null;
    /** 範囲内（areaFilter）の部隊の士気は、この値より下がらない（もとからこれより低い部隊は、今の値より下がらない）。0 なら何もしない */
    areaMoraleFloor: number;
    /**
     * 範囲の効果が効く兵の下限（最初の兵に対する割合。0 なら下限なし）。立て直しの号令の「死ぬまで退かない」を防ぐ：
     * - 兵がこの割合を切った部隊には、範囲の効果（士気の床・敗走しない・士気の低下を抑える・使った時の士気 +）が効かない（普通の決まり）。
     * - 効果に守られていた部隊が、効果中にこの割合を切ったら守りが外れる。号令が支えていた士気（使った時の +、士気の低下の軽減、
     *   士気の床）も外れ、士気は「号令が無かったときの見積もり」（sim.ts の UnitState.rallyShadow）まで下がる。そこから普通の決まりで、
     *   敗走の線以下ならその場で敗走する（号令が無ければもう崩れていた部隊。全滅するまで戦わない）。
     * - 士気が自前で高い部隊（見積もりでも敗走の線より上）は戦い続ける。号令が無い時と同じで、号令のせいで崩れることはない
     *   （家康本陣も同じ扱い。号令を使ったせいで本陣が崩れて負けることはない）。
     */
    routGuardMinStrength: number;
    /** 持つ部隊自身の代償：与える損害 ×、動きの速さ ×、受ける損害 × */
    selfDealMul: number;
    selfSpeedMul: number;
    selfTakeMul: number;
    /** 効果中は動けない（移動・攻撃・撤退の命令を受けない。全軍撤退も効果が終わってから） */
    rooted: boolean;
    /** 範囲内（areaFilter）の部隊の動きの速さ ×（重なるときは、いちばん強い 1 つだけ効く） */
    areaSpeedMul: number;
    /** 範囲内（areaFilter）の部隊が側面・背後を突いたときの与える損害 ×（斬り合い。重なるときは、いちばん強い 1 つだけ効く） */
    areaFlankDealMul: number;
    /** true なら areaMoraleLossMul は斬り合っている部隊（斬りかかっている・斬りかかられている）にだけ効く */
    areaMoraleLossMeleeOnly: boolean;
    /** ally_unit：対象が radius より離れると効果が外れる（戻れば再び効く）。false なら離れても効く */
    leash: boolean;
    /** ally_unit：対象が予備・援軍・同盟（まだ斬り合っていない・後から着いた・別の家）なら、士気の低下にさらに掛ける倍率（1 なら何もしない） */
    reserveMoraleLossMul: number;
    /** 包囲（酒井）：範囲の味方 2 部隊以上に別の向きから斬られている敵の、受ける損害 ×・士気の低下 ×（null なら包囲を見ない） */
    encircle: { takeMul: number; moraleLossMul: number } | null;
    /** 先駆け（榊原）：最初に当たった firstStrikeSec 秒の与える損害 ×firstStrikeMul、弓隊・退く敵へ ×softTargetMul、側面・背後 ×flankMul（null なら無し） */
    vanguard: { firstStrikeSec: number; firstStrikeMul: number; softTargetMul: number; flankMul: number } | null;
    /** 引きつけ（忠勝）：範囲の中で退く味方を追う敵は、持つ部隊へ向かう（敵の考え ai.ts） */
    lure: boolean;
    /** 効果が時間で切れたとき、持つ部隊の士気 −（崩れて終わったときは何もしない）。0 なら何もしない */
    endMoraleCost: number;
    /** 数値の差し替え前提の能力（画面の説明に「仮」と出す） */
    provisional: boolean;
    /** 部隊の札・名札に添える短い呼び名（例：号令・守護・援護） */
    cardLabel: string;
    /** 効果中の印（状態の表示用）：持つ部隊・範囲内の部隊（省けば今までの 3 能力の印） */
    markSelf?: string;
    markArea?: string;
    /** 使ったときの知らせ（「{name}：「能力名」— 」に続く文。省けば今までの 3 能力の文） */
    useText?: string;
    /** 画面の説明（対象・範囲・効果・代償） */
    targetText: string;
    rangeText: string;
    effectText: string;
    costText: string;
}

/** 今までの能力の既定（新しい項目は「効かない」値） */
const NO_EXTRA = {
    areaSpeedMul: 1,
    areaFlankDealMul: 1,
    areaMoraleLossMeleeOnly: false,
    areaMoraleFloor: 0,
    routGuardMinStrength: 0,
    leash: false,
    reserveMoraleLossMul: 1,
    encircle: null,
    vanguard: null,
    lure: false,
    endMoraleCost: 0,
    provisional: false,
} as const;

/** 画面に添える断り書き */
export const ABILITY_FICTION_NOTE = 'ゲーム用の創作の能力（史実の人物が実際に持っていた能力ではない）';
/** 数値の差し替え前提の能力に添える断り書き */
export const ABILITY_PROVISIONAL_NOTE = '仮の能力（数値・効果は差し替え予定）';

export const ABILITY_DATA: Record<AbilityId, AbilityData> = {
    ieyasu_rally: {
        id: 'ieyasu_rally',
        name: '立て直しの号令',
        holderName: '家康本陣',
        target: 'self_area',
        radius: 110,
        durationSec: 35,
        moraleBoost: 40,
        areaFilter: 'all',
        areaTakeMul: 1,
        areaMoraleLossMul: 0.4,
        // 範囲内は士気で敗走しない（士気は 20 未満に下がらない。もとから低い部隊も、効果中は崩れない）。
        // ただし兵が最初の routGuardMinStrength（3 割）を切った部隊は守りが外れる（号令で支えていた部隊は退く。下の routGuardMinStrength）
        areaRoutMorale: -1,
        selfDealMul: 0.3,
        selfSpeedMul: 0.5,
        selfTakeMul: 1,
        rooted: false,
        ...NO_EXTRA,
        areaMoraleFloor: 20,
        // 兵が最初の 3 割を切った部隊は号令の守りが外れる（効果中に切ったら、号令で支えていた士気も外れ、号令が無ければ崩れていた部隊は
        // その場で敗走する。全滅するまで戦わない。士気が自前で高い部隊・家康本陣は普通の決まりで戦い続ける）
        routGuardMinStrength: 0.3,
        cardLabel: '号令',
        targetText: '家康本陣を中心に、半径 110 m の味方の部隊（家康本陣も。使った後も本陣について動く）',
        rangeText: '半径 110 m（家康本陣の周り）',
        effectText:
            '使った時に範囲内の味方の士気 +40（上限 100）。35 秒のあいだ、範囲内の味方の士気は 20 未満に下がらず（士気では敗走しない）、士気の低下 −60%。ただし兵が 3 割を切った部隊（最初の兵に対して）には効かない。効果中に兵が 3 割を切った部隊は守りが外れ、号令で支えていた士気（+40・低下の軽減・士気の床）も外れる。号令が無ければ崩れていた部隊はその場で敗走する（全滅するまでは戦わない）。士気が自前で高い部隊（家康本陣も）は、号令が無い時と同じく戦い続ける',
        costText: '効果中、家康本陣の与える損害 ×0.3・動き ×0.5（守りを優先）。失った兵や戦えない部隊は戻らない',
    },
    tadakatsu_rearguard: {
        id: 'tadakatsu_rearguard',
        name: '退路の守護',
        holderName: '本多忠勝隊',
        target: 'self_area',
        radius: 100,
        durationSec: 50,
        moraleBoost: 0,
        areaFilter: 'retreating',
        areaTakeMul: 0.2,
        areaMoraleLossMul: 0.2,
        areaRoutMorale: null,
        selfDealMul: 1,
        selfSpeedMul: 0,
        selfTakeMul: 1.4,
        rooted: true,
        ...NO_EXTRA,
        lure: true,
        cardLabel: '守護',
        targetText: '忠勝隊の今の位置で踏みとどまる。半径 100 m で退いている味方（撤退の命令・敗走中）',
        rangeText: '半径 100 m（忠勝隊の周り）',
        effectText: '50 秒のあいだ、範囲内で退いている味方の受ける損害 −80%・士気の低下 −80%。範囲内で退く味方を追う敵は、忠勝隊へ引きつけられる',
        costText: '効果中、忠勝隊は動けない（移動・攻撃・撤退の命令を受けない）。忠勝隊の受ける損害 ×1.4。無敵ではない（崩れれば効果も終わる）',
    },
    nagamasa_support: {
        id: 'nagamasa_support',
        name: '盟友への援護',
        holderName: '浅井長政隊',
        target: 'ally_unit',
        radius: 60,
        durationSec: 45,
        moraleBoost: 0,
        areaFilter: 'target',
        areaTakeMul: 0.7,
        areaMoraleLossMul: 0.6,
        areaRoutMorale: null,
        selfDealMul: 0.8,
        selfSpeedMul: 1,
        selfTakeMul: 1,
        rooted: false,
        ...NO_EXTRA,
        leash: true,
        cardLabel: '援護',
        targetText: '長政隊から 60 m 以内の、同じ陣営の味方の部隊を 1 つ選ぶ（長政隊自身は選べない）',
        rangeText: '60 m 以内の味方 1 部隊（離れると外れる）',
        effectText: '最大 45 秒。対象が長政隊から 60 m 以内にいる間だけ、対象の受ける損害 −30%・士気の低下 −40%。離れると外れ、戻れば再び効く（時間は減り続ける）',
        costText: '効果中、長政隊の与える損害 ×0.8',
    },
    // ---- 新しい武将の能力（provisional: true。数値は差し替え前提） ----
    sakai_flank: {
        id: 'sakai_flank',
        name: '両翼の采配',
        holderName: '酒井忠次隊',
        target: 'self_area',
        radius: 100,
        durationSec: 25,
        moraleBoost: 0,
        areaFilter: 'all',
        areaTakeMul: 1,
        areaMoraleLossMul: 1,
        areaRoutMorale: null,
        selfDealMul: 1,
        selfSpeedMul: 0.7,
        selfTakeMul: 1,
        rooted: false,
        ...NO_EXTRA,
        areaFlankDealMul: 1.8,
        encircle: { takeMul: 1.3, moraleLossMul: 2 },
        provisional: true,
        cardLabel: '両翼',
        markSelf: '両翼の采配（足が鈍る）',
        markArea: '両翼の采配',
        useText: '周りの味方が側面・背後を突き、敵を挟む',
        targetText: '酒井隊を中心に、半径 100 m の味方の部隊（酒井隊自身も。使った後も酒井隊について動く）',
        rangeText: '半径 100 m（酒井隊の周り）',
        effectText:
            '25 秒のあいだ、範囲内の味方 2 部隊以上が同じ敵を別の向き（正面と側面・左右の側面・側面と背後など）から斬っていると、その敵は包囲され、側面・背後から斬る味方の与える損害 ×1.8、その敵の受ける損害 ×1.3・士気の低下 ×2。包囲を作ることが条件：1 部隊だけの側面の当たりや、正面だけの当たりは何部隊でも強くならない',
        costText: '効果中、酒井隊の動き ×0.7',
    },
    ishikawa_reserve: {
        id: 'ishikawa_reserve',
        name: '後詰めの差配',
        holderName: '石川数正隊',
        target: 'ally_unit',
        radius: 180,
        durationSec: 30,
        moraleBoost: 30,
        areaFilter: 'target',
        areaTakeMul: 1,
        areaMoraleLossMul: 0.5,
        areaRoutMorale: 5,
        selfDealMul: 1,
        selfSpeedMul: 0,
        selfTakeMul: 1,
        rooted: true,
        ...NO_EXTRA,
        areaSpeedMul: 1.8,
        reserveMoraleLossMul: 0.75,
        provisional: true,
        cardLabel: '後詰め',
        markSelf: '差配に専念（動けない）',
        markArea: '後詰めの差配',
        targetText: '石川隊から 180 m 以内の、味方の部隊を 1 つ選ぶ（石川隊自身は選べない。予備・援軍・同盟の部隊ほど効く）',
        rangeText: '180 m 以内の味方 1 部隊（使った後は離れても効く）',
        effectText:
            '30 秒のあいだ、対象の動き ×1.8（戦線の穴へ回す）・士気 +30（上限 100）・士気の低下 −50%・敗走しにくい（士気 15 → 5 まで持ちこたえる）。対象が予備・援軍・同盟（まだ斬り合っていない・後から着いた・別の家の部隊）なら、士気の低下はさらに −25%',
        costText: '効果中、石川隊は差配に専念して動けない（移動・攻撃・撤退の命令を受けない）。与える損害は上がらない',
    },
    sakakibara_vanguard: {
        id: 'sakakibara_vanguard',
        name: '先駆けの号',
        holderName: '榊原康政隊',
        target: 'self',
        radius: 0,
        durationSec: 20,
        moraleBoost: 0,
        areaFilter: 'self',
        areaTakeMul: 1,
        areaMoraleLossMul: 1,
        areaRoutMorale: null,
        selfDealMul: 1,
        selfSpeedMul: 1.8,
        selfTakeMul: 1.2,
        rooted: false,
        ...NO_EXTRA,
        vanguard: { firstStrikeSec: 8, firstStrikeMul: 2, softTargetMul: 1.5, flankMul: 1.3 },
        endMoraleCost: 15,
        provisional: true,
        cardLabel: '先駆け',
        markSelf: '先駆け',
        useText: '駆け出して先駆ける',
        targetText: '榊原隊だけ（対象は選ばない）',
        rangeText: '榊原隊だけ',
        effectText: '20 秒のあいだ、榊原隊の動き ×1.8。最初に斬り合った 8 秒は与える損害 ×2.0。効果中、弓隊・退く敵へ ×1.5、側面・背後を突いたとき ×1.3（斬り合い）',
        costText: '効果中、榊原隊の受ける損害 ×1.2。効果が時間で切れたとき、榊原隊の士気 −15（途中で崩れたときは何もしない）',
    },
};

/**
 * 部隊の能力の決め方：UnitDef.ability があればそれ、無ければ generalId の武将の abilityId（battle/generals.ts）。
 * 武将のいない部隊（leaderId も generalId も無い）は能力を持たない（undefined）。
 */
export function resolveAbilityId(u: { ability?: AbilityId; generalId?: string; leaderId?: string }): AbilityId | undefined {
    if (!u.leaderId && !u.generalId) return undefined;
    if (u.ability) return ABILITY_DATA[u.ability] ? u.ability : undefined;
    const g = u.generalId ? generalById(u.generalId) : undefined;
    return g && ABILITY_DATA[g.abilityId] ? g.abilityId : undefined;
}

/** 画面に出す能力の名前（仮の能力は「（仮）」を付ける） */
export function abilityDisplayName(id: AbilityId): string {
    const d = ABILITY_DATA[id];
    return d.provisional ? `${d.name}（仮）` : d.name;
}

function pct(mul: number): string {
    return `${Math.round(Math.abs(1 - mul) * 100)}%`;
}

/** 兵の割合を「3 割」のように（0.25 なら「25%」） */
function ratioText(r: number): string {
    const p = Math.round(r * 100);
    return p % 10 === 0 ? `${p / 10} 割` : `${p}%`;
}

/** 守りの下限の短い説明（例：「兵が 3 割を切った部隊は守りが外れ、号令で支えていた部隊は退く」）。下限が無ければ空 */
export function guardText(d: AbilityData): string {
    return d.routGuardMinStrength > 0 ? `兵が ${ratioText(d.routGuardMinStrength)}を切った部隊は守りが外れ、号令で支えていた部隊は退く` : '';
}

/** 能力の短い説明（スマホでも収まる長さ。数値は ABILITY_DATA から）。6 能力とも */
export function abilityShortText(id: AbilityId): { target: string; effect: string; cost: string } {
    const d = ABILITY_DATA[id];
    switch (id) {
        case 'ieyasu_rally':
            return {
                target: `本陣の周り ${d.radius} m の味方`,
                effect: `士気 +${d.moraleBoost}・${d.durationSec} 秒 士気 ${d.areaMoraleFloor} 未満に下がらない・士気の低下 −${pct(d.areaMoraleLossMul)}（${guardText(d)}）`,
                cost: `本陣の与える損害 ×${d.selfDealMul}・動き ×${d.selfSpeedMul}`,
            };
        case 'tadakatsu_rearguard':
            return {
                target: `その場で踏みとどまり、周り ${d.radius} m で退く味方`,
                effect: `${d.durationSec} 秒 退く味方の損害 −${pct(d.areaTakeMul)}・士気の低下 −${pct(d.areaMoraleLossMul)}・追っ手を引きつける`,
                cost: `動けない（撤退も不可）・受ける損害 ×${d.selfTakeMul}`,
            };
        case 'nagamasa_support':
            return {
                target: `${d.radius} m 以内の味方 1 部隊を選ぶ`,
                effect: `最大 ${d.durationSec} 秒 対象の損害 −${pct(d.areaTakeMul)}・士気の低下 −${pct(d.areaMoraleLossMul)}（${d.radius} m 離れると外れる）`,
                cost: `長政隊の与える損害 ×${d.selfDealMul}`,
            };
        case 'sakai_flank':
            return {
                target: `酒井隊の周り ${d.radius} m の味方`,
                effect: `${d.durationSec} 秒 2 部隊以上で別の向きから挟むと（包囲）側背の当たり ×${d.areaFlankDealMul}・その敵は損害 ×${d.encircle!.takeMul}・士気の低下 ×${d.encircle!.moraleLossMul}（仮）`,
                cost: `酒井隊の動き ×${d.selfSpeedMul}`,
            };
        case 'ishikawa_reserve':
            return {
                target: `${d.radius} m 以内の味方 1 部隊を選ぶ`,
                effect: `${d.durationSec} 秒 対象の動き ×${d.areaSpeedMul}・士気 +${d.moraleBoost}・士気の低下 −${pct(d.areaMoraleLossMul)}（予備・援軍・同盟はさらに −${pct(d.reserveMoraleLossMul)}）（仮）`,
                cost: '石川隊は動けない（差配に専念）',
            };
        case 'sakakibara_vanguard':
            return {
                target: '榊原隊だけ',
                effect: `${d.durationSec} 秒 動き ×${d.selfSpeedMul}・最初の ${d.vanguard!.firstStrikeSec} 秒 損害 ×${d.vanguard!.firstStrikeMul}・弓／退く敵へ ×${d.vanguard!.softTargetMul}・側背 ×${d.vanguard!.flankMul}（仮）`,
                cost: `受ける損害 ×${d.selfTakeMul}・切れたとき士気 −${d.endMoraleCost}`,
            };
    }
}

/** 今までの名前（control.ts が新しい武将の能力の短い説明に使う）。abilityShortText と同じ */
export const provisionalAbilityShort = abilityShortText;

/** 合戦中の能力の状態（持つ部隊ごと。sim.ts の BattleState.abilities に入る） */
export interface AbilityRun {
    id: AbilityId;
    unitId: string;
    side: Side;
    /** 使った時刻（まだなら null） */
    usedAt: number | null;
    /** 効果が切れる時刻（使っていなければ 0） */
    until: number;
    /** 選んだ対象（ally_unit のとき） */
    targetId: string | null;
    /** 効果が終わった（時間切れ・持つ部隊が崩れた・対象が崩れた） */
    ended: boolean;
    /** 対象が範囲内にいて効いている（ally_unit。表示と「外れた・戻った」の知らせ用） */
    linked: boolean;
    /** 後詰めの差配：対象が予備・援軍・同盟だった（使った時に決める） */
    reserveBonus: boolean;
    /** 先駆けの号：効果中に最初に斬り合った時刻（まだなら null） */
    strikeAt: number | null;
}

/** 合戦の始めに作る（能力を持ち、武将のいる部隊だけ。能力の決め方は resolveAbilityId） */
export function createAbilityRuns(units: readonly { id: string; side: Side; ability?: AbilityId; leaderId?: string; generalId?: string }[]): Record<string, AbilityRun> {
    const out: Record<string, AbilityRun> = {};
    for (const u of units) {
        const id = resolveAbilityId(u);
        if (!id) continue;
        out[u.id] = { id, unitId: u.id, side: u.side, usedAt: null, until: 0, targetId: null, ended: false, linked: false, reserveBonus: false, strikeAt: null };
    }
    return out;
}

// ---- 小さな道具（sim.ts を実行時に import しないため） ----
function byId(s: BattleState, id: string | null | undefined): UnitState | undefined {
    return id ? s.units.find((u) => u.id === id) : undefined;
}
function active(u: UnitState | undefined): u is UnitState {
    return !!u && u.present && u.status === 'ready';
}
function d2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function r1(v: number): number {
    return Math.round(v * 10) / 10;
}
function retreating(u: UnitState): boolean {
    return u.present && (u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat'));
}
function pushEvent(s: BattleState, e: Omit<BattleEvent, 't'>): void {
    s.events.push({ t: r1(s.t), ...e });
}

/** 効果が続いている能力（使った・終わっていない・時間内・持つ部隊が戦える） */
function isLive(s: BattleState, r: AbilityRun): boolean {
    return r.usedAt !== null && !r.ended && s.t < r.until - 1e-9 && active(byId(s, r.unitId));
}
function liveRuns(s: BattleState): AbilityRun[] {
    const all = s.abilityList;
    if (all.length === 0) return all;
    return all.filter((r) => isLive(s, r));
}

// ---------------------------------------------------------------- 効果の問い合わせ（sim.ts が使う）

/** d が範囲の効果を受けるか（その能力の範囲・対象の決まりで） */
function inArea(r: AbilityRun, holder: UnitState, u: UnitState): boolean {
    const data = ABILITY_DATA[r.id];
    if (u.side !== r.side || !u.present) return false;
    // 守りの下限（立て直しの号令）：兵が最初の決まった割合を切った部隊には、範囲の効果が効かない（普通の決まりで退く）
    if (data.routGuardMinStrength > 0 && belowGuard(u, data.routGuardMinStrength)) return false;
    switch (data.areaFilter) {
        case 'all':
            return u.status === 'ready' && d2(holder, u) <= data.radius;
        case 'retreating':
            return u !== holder && retreating(u) && d2(holder, u) <= data.radius;
        case 'target':
            return u.id === r.targetId && u.status === 'ready' && (!data.leash || d2(holder, u) <= data.radius);
        case 'self':
            return u === holder && u.status === 'ready';
    }
}

/** 兵が最初の ratio を切っている（守りの下限） */
function belowGuard(u: UnitState, ratio: number): boolean {
    return u.strength < u.startStrength * ratio;
}

/**
 * u がいま、守りの下限のある範囲の効果（立て直しの号令）に守られているか。sim.ts は損害を入れる前にこれを調べ、
 * 入れた後に兵が下限を切っていたら（abilityGuardBroken）守りを外し、士気を号令が無かったときの見積もりまで下げて普通の決まりで見る
 */
export function abilityGuarded(s: BattleState, u: UnitState): boolean {
    if (s.abilityList.length === 0) return false;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.routGuardMinStrength <= 0) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) return true;
    }
    return false;
}

/**
 * 守られていた部隊（損害を入れる前に abilityGuarded が true）が、損害で兵の下限を切ったか（守りが外れた）。
 * true なら sim.ts は士気を号令が無かったときの見積もり（UnitState.rallyShadow）まで下げ、普通の決まりで敗走を見る
 */
export function abilityGuardBroken(s: BattleState, u: UnitState): boolean {
    if (s.abilityList.length === 0) return false;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.routGuardMinStrength > 0 && belowGuard(u, data.routGuardMinStrength)) return true;
    }
    return false;
}

/** d の受ける損害の倍率（能力がなければ 1） */
export function abilityTakeMul(s: BattleState, d: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const holder = byId(s, r.unitId);
        if (!holder) continue;
        const data = ABILITY_DATA[r.id];
        if (holder === d) m *= data.selfTakeMul;
        if (inArea(r, holder, d)) m *= data.areaTakeMul;
    }
    return m;
}

/** a の与える損害の倍率（能力がなければ 1） */
export function abilityDealMul(s: BattleState, a: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) if (r.unitId === a.id) m *= ABILITY_DATA[r.id].selfDealMul;
    return m;
}

/**
 * a が d の側面・背後を突いたときの与える損害の倍率（斬り合い。両翼の采配。範囲の効果が重なるときは、いちばん強い 1 つだけ効く）。
 * 包囲を作ること自体が条件：d が包囲されている（s.encircled。範囲の味方 2 部隊以上が 2 つ以上の向きから斬っている）ときだけ効く。
 * 1 部隊だけの側面・背後の当たり（包囲なし）・正面の当たり・能力がなければ 1
 */
export function abilityFlankDealMul(s: BattleState, a: UnitState, d: UnitState, arc: 'front' | 'flank' | 'rear'): number {
    if (arc === 'front' || s.abilityList.length === 0 || !s.encircled.includes(d.id)) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.areaFlankDealMul === 1) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, a)) m = Math.max(m, data.areaFlankDealMul);
    }
    return m;
}

/**
 * 先駆けの号：a（持つ部隊）が d を斬るときの倍率（最初に斬り合った firstStrikeSec 秒・弓隊や退く敵・側面や背後）。
 * 効果中でなければ 1
 */
export function vanguardDealMul(s: BattleState, a: UnitState, d: UnitState, arc: 'front' | 'flank' | 'rear'): number {
    if (s.abilityList.length === 0) return 1;
    const r = s.abilities[a.id];
    if (!r) return 1;
    const v = ABILITY_DATA[r.id].vanguard;
    if (!v || !isLive(s, r)) return 1;
    let m = 1;
    if (r.strikeAt !== null && s.t <= r.strikeAt + v.firstStrikeSec + 1e-9) m *= v.firstStrikeMul;
    if (d.kind === 'yumi' || retreating(d)) m *= v.softTargetMul;
    if (arc !== 'front') m *= v.flankMul;
    return m;
}

/** 斬り合いの刻みごとに sim.ts が呼ぶ：先駆けの号の効果中、最初に斬り合った時刻を覚える */
export function noteMeleeContact(s: BattleState, a: UnitState): void {
    if (s.abilityList.length === 0) return;
    const r = s.abilities[a.id];
    if (!r || r.strikeAt !== null || !ABILITY_DATA[r.id].vanguard || !isLive(s, r)) return;
    r.strikeAt = s.t;
    pushEvent(s, { kind: 'ability', text: `${a.name}が先駆けて斬り込んだ（${ABILITY_DATA[r.id].vanguard!.firstStrikeSec} 秒のあいだ当たりが強い）`, unitId: a.id, ability: r.id });
}

/**
 * u の士気の低下の倍率（範囲の効果が重なるときは、いちばん強い 1 つだけ効く。能力がなければ 1）。
 * inMelee：u がいま斬り合っているか（斬り合いだけに効く効果の分け目。省けば斬り合い中とみなす）
 */
export function abilityMoraleLossMul(s: BattleState, u: UnitState, inMelee = true): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.areaMoraleLossMeleeOnly && !inMelee) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) m = Math.min(m, data.areaMoraleLossMul * (r.reserveBonus ? data.reserveMoraleLossMul : 1));
    }
    return m;
}

/**
 * 号令が無かったときの士気の見積もり（UnitState.rallyShadow）に掛ける、士気の低下の倍率：abilityMoraleLossMul から、守りの下限のある
 * 能力（立て直しの号令）を除いたもの（ほかの能力の軽減は効かせる）
 */
export function abilityShadowLossMul(s: BattleState, u: UnitState, inMelee = true): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.routGuardMinStrength > 0) continue;
        if (data.areaMoraleLossMeleeOnly && !inMelee) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) m = Math.min(m, data.areaMoraleLossMul * (r.reserveBonus ? data.reserveMoraleLossMul : 1));
    }
    return m;
}

/** u が敗走する士気の線（能力がなければ base） */
export function abilityRoutMorale(s: BattleState, u: UnitState, base: number): number {
    if (s.abilityList.length === 0) return base;
    let line = base;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.areaRoutMorale === null) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) line = Math.min(line, data.areaRoutMorale);
    }
    return line;
}

/** u の士気がこれより下がらない値（立て直しの号令。効いていなければ 0） */
export function abilityMoraleFloor(s: BattleState, u: UnitState): number {
    if (s.abilityList.length === 0) return 0;
    let f = 0;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.areaMoraleFloor <= 0) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) f = Math.max(f, data.areaMoraleFloor);
    }
    return f;
}

/** u の動きの速さの倍率（持つ部隊の代償 × 範囲の効果。範囲の効果が重なるときは、いちばん強い 1 つだけ効く。能力がなければ 1） */
export function abilitySpeedMul(s: BattleState, u: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    let area = 1;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (r.unitId === u.id) m *= data.selfSpeedMul;
        if (data.areaSpeedMul !== 1) {
            const holder = byId(s, r.unitId);
            if (holder && inArea(r, holder, u)) area = Math.max(area, data.areaSpeedMul);
        }
    }
    return area === 1 ? m : m * area;
}

/** 両翼の采配（包囲を見る能力）が効果中か。効果中でなければ sim.ts は包囲を調べない */
export function encircleLive(s: BattleState): boolean {
    if (s.abilityList.length === 0) return false;
    return s.abilityList.some((r) => ABILITY_DATA[r.id].encircle !== null && isLive(s, r));
}

/**
 * 包囲されている敵（部隊 id の並び）。hits はこの刻みの斬り合い（攻め手・守り手・当たる向き）。
 * 両翼の采配の範囲にいる攻め手が 2 部隊以上、2 つ以上の別の向き（正面・左・右・背後）から同じ守り手を斬っていれば包囲。
 * 正面だけ（何部隊でも）は包囲にならない。
 */
export function findEncircled(s: BattleState, hits: readonly { a: UnitState; d: UnitState; dir: AttackDir }[]): string[] {
    const runs = liveRuns(s).filter((r) => ABILITY_DATA[r.id].encircle !== null);
    if (runs.length === 0) return [];
    const dirs = new Map<UnitState, Set<AttackDir>>();
    for (const h of hits) {
        if (h.d.status !== 'ready' || h.a.status !== 'ready') continue;
        const ok = runs.some((r) => {
            const holder = byId(s, r.unitId);
            return !!holder && r.side === h.a.side && inArea(r, holder, h.a);
        });
        if (!ok) continue;
        let set = dirs.get(h.d);
        if (!set) dirs.set(h.d, (set = new Set()));
        set.add(h.dir);
    }
    const out: string[] = [];
    for (const [d, set] of dirs) if (set.size >= 2) out.push(d.id);
    return out;
}

/** 包囲の倍率（受ける損害・士気の低下）。包囲されていなければ 1 */
export function encircleMul(s: BattleState, d: UnitState): { take: number; morale: number } {
    if (s.encircled.length === 0 || !s.encircled.includes(d.id)) return NO_ENCIRCLE;
    for (const r of s.abilityList) {
        const e = ABILITY_DATA[r.id].encircle;
        if (e && isLive(s, r)) return { take: e.takeMul, morale: e.moraleLossMul };
    }
    return NO_ENCIRCLE;
}
const NO_ENCIRCLE = { take: 1, morale: 1 } as const;

/**
 * 退いている部隊 u を守っている、効果中の「退路の守護」の持ち主（なければ null）。
 * 敵の考えは、u を追う代わりに、この持ち主へ向かう（引きつけ。追い討ちのある合戦もない合戦も）。
 */
export function rearguardCover(s: BattleState, u: UnitState): UnitState | null {
    if (s.abilityList.length === 0) return null;
    for (const r of liveRuns(s)) {
        if (!ABILITY_DATA[r.id].lure) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) return holder;
    }
    return null;
}

/** 引きつけ（退路の守護）がどこかで効果中か（敵の考えが毎回すべての敵を調べないため） */
export function lureLive(s: BattleState): boolean {
    if (s.abilityList.length === 0) return false;
    return s.abilityList.some((r) => ABILITY_DATA[r.id].lure && isLive(s, r));
}

/** 効果中で動けない（退路の守護・後詰めの差配）。issueOrder が移動・攻撃・撤退の命令を断る */
export function isRooted(s: BattleState, unitId: string): boolean {
    const r = s.abilities[unitId];
    return !!r && ABILITY_DATA[r.id].rooted && isLive(s, r);
}

/** 動けない理由の短い呼び方（命令の欄。例：「踏みとどまる（退路の守護）」）。動けなければ null */
export function rootedLabel(s: BattleState, unitId: string): string | null {
    if (!isRooted(s, unitId)) return null;
    const r = s.abilities[unitId]!;
    return r.id === 'ishikawa_reserve' ? `差配に専念（${ABILITY_DATA[r.id].name}）` : `踏みとどまる（${ABILITY_DATA[r.id].name}）`;
}

/**
 * 毎刻みの始めに sim.ts が呼ぶ：時間切れ・持つ部隊が戦えない・対象が戦えない、で効果を終える。援護の「外れた・戻った」を知らせる。
 * 全軍撤退の後に踏みとどまっていた部隊は、効果が終わったら撤退を始める。
 */
export function updateAbilities(s: BattleState): void {
    if (s.abilityList.length === 0) return;
    for (const r of s.abilityList) {
        if (r.usedAt === null || r.ended) continue;
        const holder = byId(s, r.unitId);
        const data = ABILITY_DATA[r.id];
        let why: string | null = null;
        if (!active(holder)) why = 'が崩れて';
        else if (s.t >= r.until - 1e-9) why = '';
        else if (data.target === 'ally_unit' && !active(byId(s, r.targetId))) why = '（対象が戦えなくなり）';
        if (why !== null) {
            r.ended = true;
            r.linked = false;
            const name = holder?.name ?? r.unitId;
            // 時間で切れたときの代償（先駆けの号：士気 −）。崩れて終わったときは何もしない
            const cost = why === '' && data.endMoraleCost > 0 && holder && active(holder) ? data.endMoraleCost : 0;
            if (cost > 0) holder!.morale = Math.max(0, holder!.morale - cost);
            // 号令が無かったときの士気の見積もりも同じだけ下げる
            if (cost > 0 && holder!.rallyShadow !== null) holder!.rallyShadow = Math.max(0, holder!.rallyShadow - cost);
            pushEvent(s, {
                kind: 'ability_end',
                text: why === 'が崩れて' ? `${name}が崩れて「${data.name}」が終わった` : `${name}の「${data.name}」が終わった${why}` + (cost > 0 ? `（勢いが尽き、士気 −${cost}）` : ''),
                unitId: r.unitId,
                ability: r.id,
            });
            if (data.rooted && holder && active(holder) && holder.side === 'ally' && s.allRetreatAt !== null) {
                holder.order = { type: 'retreat' };
                holder.faceGoal = null;
            }
            continue;
        }
        if (data.target === 'ally_unit' && data.leash && holder) {
            const tgt = byId(s, r.targetId)!;
            const linked = d2(holder, tgt) <= data.radius;
            if (linked !== r.linked) {
                r.linked = linked;
                pushEvent(s, {
                    kind: 'ability',
                    text: linked ? `${tgt.name}が${holder.name}の近くに戻り、援護がまた効く` : `${tgt.name}が${holder.name}から離れ、援護が外れた`,
                    unitId: r.unitId,
                    targetId: tgt.id,
                    ability: r.id,
                });
            }
        }
    }
}

// ---------------------------------------------------------------- 使う・調べる

export interface AbilityUseResult {
    ok: boolean;
    /** 使えなかった理由（使えたら null） */
    reason: string | null;
}

/** 選べる対象か（対象の要る能力で、持つ部隊 u・能力のデータ data） */
function targetProblem(u: UnitState, data: AbilityData, t: UnitState | undefined): string | null {
    if (!t) return '対象の部隊が見つからない';
    if (t === u) return `${u.name}自身は対象にできない`;
    if (t.side !== u.side) return '敵の部隊は対象にできない';
    if (!active(t)) return '戦えない部隊は対象にできない';
    const d = d2(u, t);
    if (d > data.radius) return `${t.name}は ${data.radius} m より離れている（今 ${Math.round(d)} m）`;
    return null;
}

/** 使えない理由（使えるなら null）。対象を選ぶ能力は targetId も確かめる（checkTarget=false なら対象は見ない） */
function blockReason(s: BattleState, unitId: string, by: Side, targetId: string | undefined, checkTarget: boolean): string | null {
    const r = s.abilities[unitId];
    const u = byId(s, unitId);
    if (!r || !u) return 'この部隊には特殊能力がない';
    if (r.side !== by) return by === 'ally' ? '敵方の武将の能力は操作できない（敵の考えが使う）' : '相手方の能力は使えない';
    if (s.result) return '合戦は終わった';
    if (r.usedAt !== null) return isLive(s, r) ? 'いま効果中（この合戦では 1 回だけ）' : 'この合戦ではもう使った（1 合戦 1 回）';
    if (u.status === 'routed') return '敗走中の部隊は使えない';
    if (u.status === 'withdrawn') return '撤退済みの部隊は使えない';
    if (u.status === 'destroyed') return '全滅した部隊は使えない';
    if (!u.present) return 'まだ戦場に着いていない';
    const data = ABILITY_DATA[r.id];
    if (data.target !== 'ally_unit' || !checkTarget) return null;
    if (!targetId) return r.id === 'nagamasa_support' ? '援護する味方の部隊を選ぶ' : '対象の味方の部隊を選ぶ';
    return targetProblem(u, data, byId(s, targetId));
}

/**
 * 対象の要る能力（ally_unit）で、userId の部隊が targetId の部隊を対象に選べない理由（選べるなら null）。
 * 能力そのものが使えない（使用済み・戦えないなど）ときも、その理由を返す。対象の要らない能力は「対象は選ばない」
 */
export function targetReason(s: BattleState, userId: string, targetId: string, viewer: Side = 'ally'): string | null {
    const r = s.abilities[userId];
    if (r && ABILITY_DATA[r.id].target !== 'ally_unit') return 'この能力は対象を選ばない';
    return blockReason(s, userId, viewer, targetId, true);
}

/** 対象の要る能力で、その部隊を対象に選べるか（画面の対象選び：選べる部隊に輪を付ける・押したら発動するか） */
export function canTarget(s: BattleState, userId: string, targetId: string, viewer: Side = 'ally'): boolean {
    return targetReason(s, userId, targetId, viewer) === null;
}

/** 後詰めの差配の「予備・援軍・同盟」：まだ斬り合っていない・後から着いた・持つ部隊と別の家 */
function reserveLike(holder: UnitState, t: UnitState): boolean {
    return t.lastMeleeT < 0 || t.arriveAt > 0 || t.clan !== holder.clan;
}

/** 使う（中の処理。by はどちらの陣営として使うか） */
function activate(s: BattleState, unitId: string, targetId: string | undefined, by: Side): AbilityUseResult {
    const why = blockReason(s, unitId, by, targetId, true);
    if (why) return { ok: false, reason: why };
    const r = s.abilities[unitId]!;
    const u = byId(s, unitId)!;
    const data = ABILITY_DATA[r.id];
    r.usedAt = s.t;
    r.until = s.t + data.durationSec;
    r.targetId = data.target === 'ally_unit' ? targetId! : null;
    r.linked = data.target === 'ally_unit';
    const tgt = byId(s, r.targetId);
    r.reserveBonus = !!tgt && data.reserveMoraleLossMul !== 1 && reserveLike(u, tgt);
    if (data.moraleBoost > 0) {
        for (const o of s.units) {
            if (o.side !== u.side || !active(o) || !inArea(r, u, o)) continue;
            // 号令が無かったときの士気の見積もり：守りの下限のある能力（立て直しの号令）の + は数えない（使う前の士気から数え始める）。
            // ほかの能力の +（後詰めの差配）は見積もりにも足す
            if (data.routGuardMinStrength > 0) o.rallyShadow ??= o.morale;
            else if (o.rallyShadow !== null) o.rallyShadow = Math.min(100, o.rallyShadow + data.moraleBoost);
            o.morale = Math.min(100, o.morale + data.moraleBoost);
        }
    }
    if (data.rooted) {
        u.order = { type: 'hold' };
        u.faceGoal = null;
    }
    const text = data.useText
        ? `${u.name}：「${data.name}」— ${data.useText}（${data.durationSec} 秒）`
        : r.id === 'ieyasu_rally'
          ? `${u.name}：「${data.name}」— 周りの味方が踏みとどまる（${data.durationSec} 秒）`
          : r.id === 'tadakatsu_rearguard'
            ? `${u.name}：「${data.name}」— その場で踏みとどまり、退く味方を守り、追っ手を引きつける（${data.durationSec} 秒）`
            : r.id === 'ishikawa_reserve'
              ? `${u.name}：「${data.name}」— ${tgt?.name ?? ''}を戦線の穴へ回し、立て直す${r.reserveBonus ? '（予備・援軍・同盟の部隊で、よく効く）' : ''}（${data.durationSec} 秒）`
              : `${u.name}：「${data.name}」— ${tgt?.name ?? ''}を支える（${data.durationSec} 秒）`;
    pushEvent(s, { kind: 'ability', text, unitId, targetId: r.targetId ?? undefined, ability: r.id });
    return { ok: true, reason: null };
}

/**
 * プレイヤーが能力を使う（一時停止中でもよい。効果の時間は合戦が進んだ分だけ減る）。
 * 味方の部隊の能力だけ。断るとき（敵方・合戦の後・もう使った・戦えない・対象が不適切・範囲外）は何も変えない。
 */
export function useAbility(s: BattleState, unitId: string, targetId?: string): AbilityUseResult {
    return activate(s, unitId, targetId, 'ally');
}

/** 敵の考え（ai.ts）が敵方の能力を使う窓口（sim.ts が AiApi に入れて渡す。画面からは使わない） */
export function enemyUseAbility(s: BattleState, unitId: string, targetId?: string): AbilityUseResult {
    return activate(s, unitId, targetId, 'enemy');
}

/** 画面に出す能力の説明と、使えるか */
export interface AbilityInfo {
    id: AbilityId;
    unitId: string;
    /** 能力名（仮の能力は「（仮）」付き） */
    name: string;
    /** 仮の能力（数値・効果は差し替え予定） */
    provisional: boolean;
    /** 部隊の札・名札に添える短い呼び名（例：号令・両翼） */
    cardLabel: string;
    /** 持つ部隊を率いる武将の名前（例：徳川家康。武将のデータに無ければ部隊の名前） */
    generalName: string;
    side: Side;
    /** プレイヤーが操作できる（味方の部隊の能力） */
    controllable: boolean;
    target: AbilityTargetKind;
    /** 対象を選ぶ能力（ally_unit：名札 → 対象の 2 段で使う）。false なら押すだけで使える */
    needsTarget: boolean;
    targetText: string;
    /** 範囲（m）と、その説明 */
    range: number;
    rangeText: string;
    durationSec: number;
    effectText: string;
    costText: string;
    /** 短い説明（スマホ向け） */
    short: { target: string; effect: string; cost: string };
    /** 断り書き（ゲーム用の創作。仮の能力は、仮であることも書く） */
    note: string;
    /** いま使えるか（対象を選ぶ能力は、選べる対象が 1 つ以上あるとき）。使えなければ reason */
    usable: boolean;
    reason: string | null;
    /** 名札を点滅させるか（プレイヤーが操作でき、まだ使っておらず、いま使える＝対象の要る能力は選べる対象がいる） */
    ready: boolean;
    /** unused：まだ使っていない／active：効果中／spent：使い終わった */
    state: 'unused' | 'active' | 'spent';
    /** 効果の残り秒（効果中だけ。それ以外は 0） */
    remainingSec: number;
    /** 効果が切れる合戦の時刻（効果中だけ。それ以外は null） */
    endsAt: number | null;
    /** 選んだ対象と、いま効いているか（ally_unit で使った後） */
    targetId: string | null;
    targetName: string | null;
    linked: boolean;
    /** いま選べる対象（ally_unit で使う前・使えるとき。近い順） */
    validTargets: string[];
}

/** 能力の説明（能力のない部隊は null）。viewer はプレイヤーの陣営（既定は味方） */
export function abilityInfo(s: BattleState, unitId: string, viewer: Side = 'ally'): AbilityInfo | null {
    const r = s.abilities[unitId];
    const u = byId(s, unitId);
    if (!r || !u) return null;
    const data = ABILITY_DATA[r.id];
    const live = isLive(s, r);
    let reason = blockReason(s, unitId, viewer, undefined, false);
    const validTargets: string[] = [];
    if (!reason && data.target === 'ally_unit') {
        const cands = s.units.filter((o) => targetProblem(u, data, o) === null).sort((a, b) => d2(a, u) - d2(b, u));
        for (const o of cands) validTargets.push(o.id);
        if (validTargets.length === 0) {
            // いちばん近い味方（近づければ選べる）も添える
            const near = s.units.filter((o) => o !== u && o.side === u.side && active(o)).sort((a, b) => d2(a, u) - d2(b, u))[0];
            const what = r.id === 'nagamasa_support' ? '援護できる' : '対象にできる';
            reason = `${data.radius} m 以内に${what}味方の部隊がいない` + (near ? `（いちばん近い${near.name}は今 ${Math.round(d2(near, u))} m。近づければ選べる）` : '');
        }
    }
    const prov = data.provisional;
    const controllable = r.side === viewer;
    const state = r.usedAt === null ? 'unused' : live ? 'active' : 'spent';
    const g = generalById(u.generalId ?? u.leaderId ?? '');
    const tgt = byId(s, r.targetId);
    return {
        id: r.id,
        unitId,
        name: abilityDisplayName(r.id),
        provisional: prov,
        cardLabel: data.cardLabel,
        generalName: g?.name ?? u.name,
        side: r.side,
        controllable,
        target: data.target,
        needsTarget: data.target === 'ally_unit',
        targetText: data.targetText,
        range: data.radius,
        rangeText: data.rangeText,
        durationSec: data.durationSec,
        effectText: prov ? `${data.effectText}（仮の数値）` : data.effectText,
        costText: prov ? `${data.costText}（仮の数値）` : data.costText,
        short: abilityShortText(r.id),
        note: prov ? `${ABILITY_FICTION_NOTE}。${ABILITY_PROVISIONAL_NOTE}` : ABILITY_FICTION_NOTE,
        usable: reason === null,
        reason,
        ready: controllable && state === 'unused' && reason === null,
        state,
        remainingSec: live ? Math.max(0, r1(r.until - s.t)) : 0,
        endsAt: live ? r1(r.until) : null,
        targetId: r.targetId,
        targetName: tgt?.name ?? null,
        linked: live && r.linked,
        validTargets,
    };
}

/** 名札を点滅させるか（abilityInfo(s, unitId).ready と同じ。能力のない部隊は false） */
export function abilityReady(s: BattleState, unitId: string, viewer: Side = 'ally'): boolean {
    return abilityInfo(s, unitId, viewer)?.ready ?? false;
}

/** いまその部隊に効いている能力の印（例：「号令」「殿（踏みとどまる）」「殿の守り」「援護」「包囲されている」）。状態の表示用 */
export function abilityMarks(s: BattleState, unitId: string): string[] {
    const u = byId(s, unitId);
    if (!u || s.abilityList.length === 0) return [];
    const out: string[] = [];
    for (const r of liveRuns(s)) {
        const holder = byId(s, r.unitId);
        if (!holder) continue;
        const inside = inArea(r, holder, u);
        const data = ABILITY_DATA[r.id];
        if (data.markSelf !== undefined) {
            if (holder === u) out.push(data.markSelf);
            else if (inside && data.markArea) out.push(data.markArea);
        } else if (r.id === 'ieyasu_rally') {
            if (holder === u) out.push('号令（守りを優先）');
            else if (inside) out.push('号令');
        } else if (r.id === 'tadakatsu_rearguard') {
            if (holder === u) out.push('踏みとどまる');
            else if (inside) out.push('退路の守り');
        } else {
            if (holder === u) out.push('援護中');
            else if (u.id === r.targetId) out.push(inside ? '援護' : '援護（離れて外れている）');
        }
    }
    if (s.encircled.includes(unitId)) out.push('包囲されている');
    return out;
}

/** 使った記録（部隊 id → 使った時刻）。BattleOutcome.abilitiesUsed に入れる */
export function abilitiesUsedRecord(s: BattleState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of s.abilityList) if (r.usedAt !== null) out[r.unitId] = r1(r.usedAt);
    return out;
}
