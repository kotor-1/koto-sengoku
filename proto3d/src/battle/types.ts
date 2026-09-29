/**
 * 合戦（部隊単位の指揮）の型。合戦のルール（sim.ts・ai.ts）・合戦の画面（view・UI）・章の進行（campaign）が共通に使う約束。
 * ここは型と定数だけ（three も DOM も使わない）。
 *
 * 座標：戦場の平面（メートル）。x は東、z は南（画面では上が北）。味方は南から、敵は北に陣取る。
 * 時間：秒（ゲーム内の時間。指揮中の一時停止では進まない）。
 */

/** 陣営：味方（主人公の側）・敵 */
export type Side = 'ally' | 'enemy';

/** 部隊の種類 */
export type UnitKind =
    | 'honjin' // 本陣（大将の部隊。周りの味方の士気を支える。敗走すると全軍の士気が大きく落ちる）
    | 'yari' // 槍足軽（正面に強い。騎馬を正面で受け止める）
    | 'yumi' // 弓足軽（離れて射る。近くで斬り合うと弱い）
    | 'kiba'; // 騎馬（速い。側面・背後を突くと強い。槍の正面には弱い）

/** 部隊に出す命令 */
export type Order =
    | { type: 'hold' } // 防衛・待機：その場で向きを保って守る（守りに少し強い）
    | { type: 'move'; x: number; z: number; face?: number } // 指定地点へ移動（着いたら待機。face があれば着いた後にその向き（ラジアン）へ向き直る。省けば進んできた向きのまま）
    | { type: 'attack'; targetId: string } // 指定した敵部隊へ攻撃（追いかけて交戦）
    | { type: 'retreat' }; // 撤退：自軍の退き口へ下がり、着いたら戦場を離れる（兵を残す）

/** 部隊の状態 */
export type UnitStatus =
    | 'ready' // 戦える
    | 'routed' // 敗走中（士気が尽きた。命令を聞かず退き口へ逃げる）
    | 'withdrawn' // 撤退して戦場を離れた（兵は残っている）
    | 'destroyed'; // 兵がいなくなった

/** 所属（家）。協力陣営の選択で、同じ家が味方にも敵にもなる */
export type ClanId =
    | 'kotosaka' | 'washio' | 'tashiro' | 'omori' // 架空の第一章「国境の砦」
    | 'tokugawa' | 'oda' | 'asai' | 'asakura' | 'ronin' // 歴史分岐「元亀元年・家康」（ronin は架空の浪人衆）
    | 'rival'; // 合戦場の演習の架空の相手「敵勢」（浪人衆とは別の家）

/**
 * 武将固有の特殊能力（ゲーム用の創作。史実の人物の能力ではない）。数値は battle/abilities.ts のデータに置く。
 * - ieyasu_rally：立て直しの号令（家康本陣）
 * - tadakatsu_rearguard：退路の守護（本多忠勝隊）
 * - nagamasa_support：盟友への援護（浅井長政隊。対象の部隊を 1 つ選ぶ）
 * - sakai_flank：両翼の采配（酒井忠次隊。仮の能力）
 * - ishikawa_reserve：後詰めの差配（石川数正隊。仮の能力）
 * - sakakibara_vanguard：先駆けの号（榊原康政隊。仮の能力）
 */
export type AbilityId = 'ieyasu_rally' | 'tadakatsu_rearguard' | 'nagamasa_support' | 'sakai_flank' | 'ishikawa_reserve' | 'sakakibara_vanguard';

/** 部隊の初期設定（章の進行が、協力陣営の選択などから作る） */
export interface UnitDef {
    id: string;
    side: Side;
    clan: ClanId;
    kind: UnitKind;
    /** 表示名（例：「源蔵隊」） */
    name: string;
    /** 率いる人物の id（章の人物の状態に結びつける。いなければ省く） */
    leaderId?: string;
    /** 率いる武将の id（battle/generals.ts の武将。leaderId と同じ値を入れる。武将のいない部隊は省く） */
    generalId?: string;
    /** 兵の数 */
    strength: number;
    /** 士気 0〜100 */
    morale: number;
    x: number;
    z: number;
    /** 向き（ラジアン。0 が北＝ -z、時計回りに増える：π/2 が東） */
    facing: number;
    /** 開始から何秒後に戦場へ現れるか（別働隊・援軍。省けば最初からいる） */
    arriveAt?: number;
    /** 最初の命令（省けば hold） */
    order?: Order;
    /** 敵の考え方の役割（ai.ts が使う。味方の部隊では使わない） */
    aiRole?: 'hold_line' | 'reserve' | 'flank' | 'guard_hq' | 'hold_zone' | 'assault';
    /** hold_zone（守る区域）・assault（攻め進む先）の地点と半径（m）。省けば最初の位置・半径 60 m */
    aiTarget?: { x: number; z: number; r?: number };
    /** この部隊を率いる武将の特殊能力（武将がいる部隊だけ。1 合戦 1 回）。省けば generalId の武将の能力（battle/generals.ts の abilityId） */
    ability?: AbilityId;
}

/** 地形の区域（四角形または円） */
export type TerrainKind =
    | 'hill' // 丘：上にいる部隊は、下から来る相手に対して守りが強い。遠くまで見通せる
    | 'woods' // 林：動きが遅い。中の部隊は遠くから見えない（敵の考えは気づかない）。弓の効きが弱まる
    | 'marsh' // 湿地・浅い川：動きがとても遅い。中で戦うと不利
    | 'road' // 道：動きが少し速い
    | 'river' // 深い川：通れない（浅瀬 ford の重なる所だけ渡れる）
    | 'ford' // 浅瀬：渡れるが、とても遅く、中で戦うと不利
    | 'cliff'; // 崖・岩：通れない
export interface TerrainArea {
    kind: TerrainKind;
    /** 四角形（x0〜x1, z0〜z1）か円（cx, cz, r）のどちらか */
    rect?: { x0: number; x1: number; z0: number; z1: number };
    circle?: { cx: number; cz: number; r: number };
    /** 丘の高さ（m。表示と守りの強さの計算に使う） */
    height?: number;
}

/** 区域（四角形または円のどちらか。目標・特殊ルール・敵の考えの区域に使う） */
export interface Zone {
    rect?: { x0: number; x1: number; z0: number; z1: number };
    circle?: { cx: number; cz: number; r: number };
}

/**
 * 地形ごとの決まり（戦場ごとに BattleSetup.fieldRules.terrainRules で上書きする。省いた項目は sim.ts の TERRAIN_DEFAULTS）。
 * 倍率はどれも 1 で「変えない」。
 */
export interface TerrainRule {
    /** 動きの速さの倍率（重なるときは sim.ts の TERRAIN_PRIORITY の順で 1 つだけ効く） */
    speed?: number;
    /** 部隊の種類ごとに、さらに掛ける速さの倍率（例：林の中の騎馬 ×0.5） */
    kindSpeed?: Partial<Record<UnitKind, number>>;
    /** 中にいる部隊の与える損害（斬り合い）の倍率 */
    dealMul?: number;
    /** 中にいる部隊の受ける損害（斬り合い）の倍率 */
    takeMul?: number;
    /** 中にいる部隊が受ける矢の損害の倍率（林 ×0.6 など） */
    arrowTakeMul?: number;
    /** 中にいる部隊は、相手の戦える部隊がこの距離（m）に来るまで見えない（省けば隠れない） */
    hideSight?: number;
}

/** 高低差の効果（戦場ごとに上書きする。既定は sim.ts の HIGH_GROUND_DEFAULTS） */
export interface HighGroundRule {
    /** 下から正面に来る相手の与える損害の倍率（高さの差が minDiff 以上） */
    defenseVsLower?: number;
    /** 高いとみなす高さの差（m） */
    minDiff?: number;
    /** 射手が相手より minDiff 以上高いとき、弓の届く距離に足す（m） */
    rangeBonus?: number;
    /** 高さ minDiff 以上の所にいる部隊は、隠れている相手をこの距離（m）だけ遠くから見つける */
    sightBonus?: number;
}

/**
 * 特殊ルール（判別できる union。種類を足すときは、ここに型を 1 つ足し、sim.ts の該当する所で type を見て効かせる）。
 * - narrow_frontage：区域の中では、同じ相手へ斬りかかれるのは maxEngaged 部隊まで。あふれた部隊は後ろで待つ（狭い正面）。
 * - woods_ambush：相手から見えていなかった部隊が斬りかかったとき、最初の sec 秒の損害 ×firstStrikeMul（林の奇襲）。
 *   「見えていなかった」は、隠れていた部隊が見つかってから windowSec 秒（省けば 30 秒）以内に斬りかかったこと。
 */
export type SpecialRule =
    | { type: 'narrow_frontage'; zone: Zone; maxEngaged: number }
    | { type: 'woods_ambush'; firstStrikeMul: number; sec: number; windowSec?: number };

/** 戦場ごとの決まり（BattleSetup.fieldRules。省けば今までの決まりのまま） */
export interface FieldRules {
    terrainRules?: Partial<Record<TerrainKind, TerrainRule>>;
    highGround?: HighGroundRule;
    specialRules?: SpecialRule[];
    /** 通れる範囲（この四角の外は通れない。省けば戦場の全体） */
    passable?: { x0: number; x1: number; z0: number; z1: number };
    /** true なら、通れない所が無くても格子の道探しで動く（道の速さを生かす）。省けば通れない所があるときだけ道探しを使う */
    pathfinding?: boolean;
    /**
     * true なら、新しい戦場の動きの決まりを使う（省けば Version 11 の動き）：
     * - 移動の行き先の近く（RULES.settleNear m 以内）で RULES.settleSec 秒進めなかった部隊は、着いたことにして待機にする
     *   （味方の間に行き先を並べたときに、押し合って「移動中」のまま止まらないように）。
     * - 行き先の隣で斬り合っている味方は「行き先を押さえている味方」に数えず、その横をよけて行き先へ近づく。
     * 合戦場のデータから作る合戦（fields/build.ts）は、keepV11Movement の戦場（国境の原）を除いて付ける。
     */
    settleMoves?: boolean;
}

/**
 * 目標（主目標・副目標。判定は battle/objectives.ts）。label は画面に出す短い名前。
 * - destroy_hq：敵本陣の撃破
 * - hold_point：区域に、敵がいない状態で味方が続けて sec 秒いる
 * - defend_time：sec 秒まで守る（zone があれば、その区域を敵に loseSec 秒（省けば 10 秒）続けて奪われない。なければ本陣を守る）
 * - rescue：味方の unitId を zone まで無事に連れ帰る（撤退の命令で戦場を離れても達成）
 * - breakthrough：味方 count 部隊が zone に入る（抜ける）
 * - retreat_success：本陣が撤退で戦場を離れ、味方の兵の minRatio 以上が撤退で戦場を離れる
 * - survive_until：援軍 reinforcementId が着いて、さらに holdSec 秒（省けば 0）耐える
 * - preserve_unit：部隊 unitId を崩さず、兵を最初の minRatio 以上残して終える（副目標向け。全軍撤退で終えたら果たせない）
 * - limit_losses：味方の兵の損害を maxRatio 以内で終える（副目標向け。全軍撤退で終えたら果たせない）
 * - break_unit：敵の部隊 unitId を崩す（敗走・全滅・撤退させる）
 */
export type ObjectiveDef = { id: string; label: string } & (
    | { type: 'destroy_hq' }
    | { type: 'hold_point'; zone: Zone; sec: number }
    | { type: 'defend_time'; sec: number; zone?: Zone; loseSec?: number }
    | { type: 'rescue'; unitId: string; zone: Zone }
    | { type: 'breakthrough'; zone: Zone; count: number }
    | { type: 'retreat_success'; minRatio: number }
    | { type: 'survive_until'; reinforcementId: string; holdSec?: number }
    | { type: 'preserve_unit'; unitId: string; minRatio: number }
    | { type: 'limit_losses'; maxRatio: number }
    | { type: 'break_unit'; unitId: string }
);
export type ObjectiveType = ObjectiveDef['type'];

/** 目標の結果（BattleOutcome.objectives の 1 行） */
export interface ObjectiveResult {
    id: string;
    type: ObjectiveType;
    label: string;
    achieved: boolean;
}

/** 戦場 */
export interface BattleMap {
    id: string;
    name: string;
    /** 広さ（x: -width/2〜width/2, z: -depth/2〜depth/2） */
    width: number;
    depth: number;
    terrain: TerrainArea[];
    /** 退き口（撤退・敗走した部隊が向かう所） */
    exits: Record<Side, { x: number; z: number }>;
}

/** 合戦の設定 */
export interface BattleSetup {
    map: BattleMap;
    units: UnitDef[];
    /** 時間切れ（日没）までの秒数 */
    timeLimitSec: number;
    /** 合戦の前に表示する目的・勝ち負けの条件の説明（章の進行が文章を作る） */
    briefing: string[];
    /**
     * 戦前の約束（歴史分岐シナリオ。引き受けたときだけ）。合戦の計算が達成を判定して BattleOutcome.pledge に入れる。
     * 達成：対象が安全地点に holdSec 秒以上いた、または撤退の命令で退き口から離れた、または終わりに戦えている —
     * そのうえで兵が最初の minStrengthRatio 以上。対象の敗走・全滅は未達成。
     */
    pledge?: {
        targetId: string;
        safeZone: { cx: number; cz: number; r: number };
        holdSec: number;
        minStrengthRatio: number;
    };
    /**
     * 追い討ち（歴史分岐シナリオの合戦だけ true。省けば架空の第一章と同じ）：敵の考えが、近くで退いている味方の部隊へ追い討ちをかけ、
     * 退く相手を攻める部隊は斬りながら後を追う。退路の守護の効果中は、範囲内で退く味方を追う敵が忠勝隊に阻まれる。
     */
    pursuit?: boolean;
    /** 戦場ごとの決まり（地形の上書き・高所・特殊ルール・通れる範囲）。省けば今までの決まりのまま（1 刻みも変えない） */
    fieldRules?: FieldRules;
    /**
     * 目標。primary があれば勝ち負けは主目標で決まる（battle/objectives.ts）。primary を省けば今までの決まりのまま。
     * secondary は勝ち負けに影響せず、終わりに判定して BattleOutcome.objectives に入れる。
     */
    objectives?: { primary?: ObjectiveDef; secondary?: ObjectiveDef[] };
    /** 援軍（survive_until の目標が使う）。部隊は units に arriveAt と出現地点を入れておく */
    reinforcements?: { id: string; side: Side; unitIds: string[] }[];
    /**
     * 主人公との関係状態（武将の relationKey → 値。歴史分岐なら信頼 trust の写し）。画面の武将の行に出すだけで、合戦の計算には使わない。
     * 省けば出さない（演習・架空の第一章）
     */
    relations?: Record<string, number>;
}

/** 合戦の結果の種類 */
export type BattleResultKind =
    | 'victory' // 勝利：敵本陣の敗走、または敵の本陣以外の全部隊が戦えなくなった（主目標のある合戦は、主目標の達成）
    | 'defeat' // 敗北：味方本陣の敗走（大将は落ち延びる。死亡とは同じにしない）、または味方の全部隊が戦えなくなった
    | 'retreat'; // 撤退：全軍撤退を命じた、または日没で両軍が引いた

/** 合戦が終わった理由 */
export type BattleEndReason =
    | 'enemy_hq_routed'
    | 'enemy_army_broken'
    | 'ally_hq_routed'
    | 'ally_army_broken'
    | 'ordered_retreat'
    | 'nightfall'
    | 'objective_done' // 主目標を果たした（勝利）
    | 'objective_failed'; // 主目標が果たせなくなった（敗北）

/** 合戦の結果（章の進行へ渡す。保存にもこの形で残す） */
export interface BattleOutcome {
    result: BattleResultKind;
    reason: BattleEndReason;
    /** 合戦にかかった時間（秒） */
    elapsedSec: number;
    /** 部隊ごとの結果 */
    units: {
        id: string;
        side: Side;
        clan: ClanId;
        leaderId?: string;
        startStrength: number;
        endStrength: number;
        status: UnitStatus;
    }[];
    /** 戦前の約束の達成（BattleSetup.pledge があったときだけ）。勝敗とは別に判定する */
    pledge?: { targetId: string; result: 'kept' | 'broken' };
    /** 特殊能力を使った記録（部隊 id → 使った時刻・秒） */
    abilitiesUsed?: Record<string, number>;
    /** 目標の達成（BattleSetup.objectives があったときだけ）。勝敗・約束とは別の欄 */
    objectives?: { primary?: ObjectiveResult; secondary: ObjectiveResult[] };
}

/** 合戦の画面を呼ぶ側（章の進行）への知らせ */
export interface BattleRunHooks {
    /**
     * 勝ち負けが決まった時に 1 回だけ呼ぶ（結果の画面を出す前）。章の進行はここで結果を反映して保存する。
     * 返した文（保存できた／できなかった）を結果の画面に出す。null なら何も出さない。
     */
    onDecided?(outcome: BattleOutcome): { ok: boolean; text: string } | null;
}
