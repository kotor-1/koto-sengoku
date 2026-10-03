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
    /**
     * 持ち場（区域）から追う距離の上限（m。敵の考え ai.ts。省けば役割ごとの既定）。
     * - hold_line：持ち場からこの距離より離れた相手は追わない（既定 120 m）。打って出る相手も、持ち場からこの距離（既定の 75 m より短ければ）の中だけ。
     *   矢を嫌って射手へ打って出たときだけは、今までどおり 120 m まで追う（弓の陽動で誘い出せる）。
     * - hold_zone・assault（着いて守る間）：区域の縁からこの距離より離れた相手は追わない（既定 60 m）。長くすると、区域に入った相手を遠くまで追う（誘い出せる）。
     */
    aiLeash?: number;
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
    | 'cliff' // 崖・岩：通れない
    | 'bridge' // 橋：深い川の上の通れる細い帯（動きは道と同じ）。狭い正面（narrow_frontage）と組み合わせて、同時に戦える部隊の数を絞る
    | 'paddy' // 水田：動きがとても遅い（部隊の種類ごとに違う）。中で斬り合うと不利。畦道・街道は道（road）として田の間に通す
    // 第3群で足した障害物（通れない。射線は building・wall だけが遮る。高さは TerrainArea.height、省けば fieldRules.ts の OBSTACLE_HEIGHT）
    | 'building' // 家屋・寺の堂・櫓の建物：通れない・射線を遮る
    | 'fence' // 柵・低い土塀：通れない・射線は通す（低い）
    | 'wall' // 石垣・高い塀：通れない・射線を遮る
    | 'dry'; // 乾いた足場：湿地・水田・浅瀬の上に重ねると、その所は普通の地面に戻す（速さ・損害の倍率を打ち消す）。土手道は dry の上に road を重ねる
export interface TerrainArea {
    kind: TerrainKind;
    /**
     * 形は四角形（x0〜x1, z0〜z1）・円（cx, cz, r）・カプセル（線分 (ax,az)〜(bx,bz) から r 以内。細長い丘＝尾根）のどれか 1 つ。
     * カプセルの丘の高さは、線分からの距離 d で height × (1 − (d/r)²)（円の丘と同じ丸い頂を、線分に沿って伸ばした形）
     */
    rect?: { x0: number; x1: number; z0: number; z1: number };
    circle?: { cx: number; cz: number; r: number };
    capsule?: { ax: number; az: number; bx: number; bz: number; r: number };
    /**
     * 丘の高さ（m。表示と守りの強さの計算に使う）。
     * building・wall では射線を遮る高さ（m）。地面からの高さではなく、高さ 0（丘の無い平地の地面）からの高さ。射線の線分の高さ
     * （両端の地面の高さ＋目の高さ 1.5 m をまっすぐ結んだ高さ）がこれより高い所を通れば遮らない。丘・台地の上に建てるときは、
     * その所の地面の高さを足す（例：高さ 8 m の台地の上の高さ 7 m の堂は 15）。地面の高さ＋1.5 m 以下だと、同じ高さに立つ部隊どうしの射線を
     * 遮らないので、validateField が知らせる
     */
    height?: number;
}

/**
 * 門（第3群。通行の変わる障害物）。閉じている間は通れず、射線も遮る（高さ height、省けば 6 m）。
 * 制圧：capture.zone の中に、holder（門を持つ側。省けば敵）の戦える部隊がいない状態で、反対の側の戦える部隊が capture.sec 秒続けていると開く。
 * 開いたら通れる（道探しの格子を作り直し、進んでいる道をすべて引き直す）。開いた門は閉じない（今回のデータでは閉じる門を作らない）。
 */
export interface GateDef {
    id: string;
    /** 画面に出す名前（例：「外門」） */
    name: string;
    /** 門の形（四角。壁の切れ目にはめる。格子 5 m に載る厚さ 6 m 以上） */
    rect: { x0: number; x1: number; z0: number; z1: number };
    /** 射線を遮る高さ（m。省けば 6） */
    height?: number;
    /** 門を持つ側（省けば 'enemy'）。反対の側が制圧する */
    holder?: Side;
    /**
     * 制圧の条件：区域 zone を、holder の部隊がいない状態で、反対の側が sec 秒続けて占める。区域は門の面まで届かせる
     * （閉じた門へ向かって押し付けられた部隊の中心は門の面のすぐ外に止まるので、区域が門から離れていると数えない）
     */
    capture: { zone: Zone; sec: number };
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
    /** 中にいる弓隊が射る矢の損害の倍率（例：泥に足を取られて射にくい湿地 ×0.7。省けば 1） */
    arrowDealMul?: number;
    /** true なら、中にいる騎馬は突撃にならない（ぬかるみで勢いがつかない。省けば突撃できる） */
    noCharge?: boolean;
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
    /** 射手が相手より minDiff 以上高いとき、矢の損害に掛ける倍率（谷の両側の高所から谷底を射る。既定 1＝変えない） */
    arrowDealVsLower?: number;
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
    /** 門（第3群。閉じている間は通れず射線を遮る。制圧で開く）。省けば門は無い */
    gates?: GateDef[];
    /**
     * true なら、第3群で足した動き・道探しの直しを使う（省けば今までの動き。合戦場のデータから作る合戦（fields/build.ts）は、
     * keepV11Movement・keepGroup2Movement の戦場を除いて付ける）：
     * - 道探し（pathfind.ts）：出発点・行き先の格子の中心が泥でも、その点が乾いた足場なら隣の乾いた格子から道を探す。道を短くする区間の時間の上限を
     *   STRAIGHT_SLACK（1.1 倍）にする（泥の中から土手道へ戻らずに泥を突っ切らない）。
     * - 移動の行き詰まり（sim.ts の stuckNearGoal）：中で戦うと不利な地形（泥・水田・浅瀬）にいる間と、まだ果たしていない目標の区域へ外から
     *   入る間は、行き先の近くで止まっても着いたことにしない。止まっている味方 2 部隊の間などで長く進めない移動・攻撃は、よける側を替え、
     *   道を引き直し、それでも進めなければ待機に戻して知らせる。
     * - 敗走の部隊の退き口へ道が無い（閉じた門の向こう）ときは、その場から戦場を逃れ去る。
     */
    refinedMoves?: boolean;
}

/**
 * 目標（主目標・副目標。判定は battle/objectives.ts）。label は画面に出す短い名前。
 * - destroy_hq：敵本陣の撃破
 * - hold_point：区域に、敵がいない状態で味方が続けて sec 秒いる
 * - defend_time：sec 秒まで守る（zone があれば、その区域を敵に loseSec 秒（省けば 10 秒）続けて奪われない。なければ本陣を守る）
 * - defend_zones：区域 zones のうち minHeld 個以上を sec 秒まで守り抜く（例：3 本の橋のうち 2 本以上）。各区域は、敵だけが loseSec 秒
 *   （省けば 10 秒）続けて占めると失う（取り返しても戻らない）。失っていない区域が minHeld 個より少なくなると果たせない。
 *   names は区域ごとの短い名前（画面の見通し・地図の名札。省けば「守る地点」）
 * - rescue：味方の unitId を zone まで無事に連れ帰る（撤退の命令で戦場を離れても達成）
 * - breakthrough：味方 count 部隊が zone に入る（抜ける）
 * - retreat_success：本陣が撤退で戦場を離れ、味方の兵の minRatio 以上が撤退で戦場を離れる
 * - survive_until：援軍 reinforcementId が着いて、さらに holdSec 秒（省けば 0）耐える
 * - preserve_unit：部隊 unitId を崩さず、兵を最初の minRatio 以上残して終える（副目標向け。全軍撤退で終えたら果たせない）
 * - limit_losses：味方の兵の損害を maxRatio 以内で終える（副目標向け。全軍撤退で終えたら果たせない）
 * - break_unit：敵の部隊 unitId を崩す（敗走・全滅・撤退させる）。limit_breakthrough の出口を抜けた部隊は崩したことにしない（果たせない）
 * 第3群で足した種類：
 * - hold_zones：区域 zones のすべて（mode 'all'）を同時に、敵のいない状態で味方が占め、それが sec 秒続く（例：山門と本堂前）。
 *   どれか 1 つでも外れると 0 に戻る。names は区域ごとの短い名前
 * - limit_breakthrough：敵の戦える部隊が出口 exits のどれかに入った数（部隊単位。兵の人数では数えない）を maxCount 以内に抑える。
 *   出口に入った敵の部隊は戦場を抜けて離れる（撤退済み）。maxCount を超えたら果たせない。untilSec まで（省けば日没まで）、
 *   または敵の攻め手（aiRole 'assault' の部隊。いなければ本陣以外の敵）がすべて抜けたか戦えなくなったら果たす。names は出口ごとの名前
 * - open_gate：門 gateId を制圧して開く（門の制圧の条件は GateDef.capture）
 * - sequence：段階目標。steps を順に果たす（今の段だけを数える。どれかの段が果たせなくなれば果たせない。最後の段で果たす）。
 *   結果には、どの段まで届いたか（ObjectiveResult.steps）も入れる
 * 第4群で足した種類（docs/fields-group4-design.md §3。どれも、味方の戦える部隊が出口・退き口の区域に入ると、その部隊は戦場を離れて
 * 「撤退済み」になり、目標に数える。撤退の命令で退き口から離れた部隊も、退き口がその区域の中なら数える）：
 * - escape：総大将（味方の本陣）と、本陣のほかの count 部隊が、出口 exits のどれかから離れる（包囲の外へ脱出）。総大将が出口から離れても
 *   本陣の喪失ではない（合戦は続く）。総大将が崩れる（敗走・全滅）か、離れられる部隊が count に足りなくなれば果たせない。names は出口ごとの名前
 * - rescue_escort：味方の部隊 unitId（孤立した味方）と、ほかの味方の部隊が合流区域 meetZone に一緒に meetSec 秒（省けば 5 秒）いて合流し、
 *   その後に unitId が安全区域 safeZone に戦える状態で入る。兵は最初の minRatio 以上。合流の前に安全区域へ入っても数えない（接触だけ・
 *   能力だけでは果たさない）。対象が崩れる・撤退する・兵が minRatio を切ると果たせない
 * - withdraw：総大将と、本陣のほかの count 部隊が、退き口 exit から離脱する（退却戦）。数え方は escape と同じで、出口が 1 つ。name は退き口の名前
 */
export type ObjectiveDef = { id: string; label: string } & (
    | { type: 'destroy_hq' }
    | { type: 'hold_point'; zone: Zone; sec: number }
    | { type: 'defend_time'; sec: number; zone?: Zone; loseSec?: number }
    | { type: 'defend_zones'; sec: number; zones: Zone[]; minHeld: number; loseSec?: number; names?: string[] }
    | { type: 'rescue'; unitId: string; zone: Zone }
    | { type: 'breakthrough'; zone: Zone; count: number }
    | { type: 'retreat_success'; minRatio: number }
    | { type: 'survive_until'; reinforcementId: string; holdSec?: number }
    | { type: 'preserve_unit'; unitId: string; minRatio: number }
    | { type: 'limit_losses'; maxRatio: number }
    | { type: 'break_unit'; unitId: string }
    | { type: 'hold_zones'; zones: Zone[]; sec: number; mode: 'all'; names?: string[] }
    | { type: 'limit_breakthrough'; exits: Zone[]; maxCount: number; untilSec?: number; names?: string[] }
    | { type: 'open_gate'; gateId: string }
    | { type: 'sequence'; steps: ObjectiveDef[] }
    | { type: 'escape'; exits: Zone[]; count: number; names?: string[] }
    | { type: 'rescue_escort'; unitId: string; meetZone: Zone; safeZone: Zone; minRatio: number; meetSec?: number }
    | { type: 'withdraw'; exit: Zone; count: number; name?: string }
);
export type ObjectiveType = ObjectiveDef['type'];

/** 目標の結果（BattleOutcome.objectives の 1 行） */
export interface ObjectiveResult {
    id: string;
    type: ObjectiveType;
    label: string;
    achieved: boolean;
    /** 段階目標（sequence）だけ：果たした段の数と段の数 */
    steps?: { done: number; total: number };
    /** 脱出・離脱（escape・withdraw）だけ：出口から離れた部隊の数（総大将を含む）と、要る数（総大将＋count） */
    count?: { done: number; total: number };
    /** 救出（rescue_escort）だけ：合流したか */
    met?: boolean;
}

/**
 * 終わり方の判定の順（第4群。docs/fields-group4-design.md §3）。BattleSetup.endRules の order に、先に見るものから並べる。
 * - objective_done：主目標を果たした → 勝利
 * - objective_failed：主目標が果たせなくなった（総大将が崩れた・救出の対象が崩れた、など） → 敗北
 * - hq_lost：味方の本陣が崩れた（敗走・全滅） → 敗北。本陣が脱出・離脱の目標の出口から離れたのは「脱出」で、喪失ではない。
 *   目標に数えない所から本陣が撤退したときは、合戦の放棄（撤退）
 * - army_broken：味方の部隊がすべて戦えない（戦場を離れた部隊の方が多ければ放棄＝撤退、崩れた部隊の方が多ければ敗北）
 * - nightfall：日没 → 撤退
 * - all_retreat：全軍撤退の命令 → 撤退（放棄）。allRetreat が 'count' なら、命令した部隊も出口・退き口の判定に入り、
 *   味方が戦場からいなくなるまで（目標を果たせば、その時に勝利）打ち切らない。'end' なら今までどおり命令から RULES.retreatGraceSec 秒で打ち切る
 */
export type EndRuleKind = 'objective_done' | 'objective_failed' | 'hq_lost' | 'army_broken' | 'nightfall' | 'all_retreat';
export interface EndRules {
    /** 判定の順（先に見るものから。6 つすべてを 1 回ずつ） */
    order: EndRuleKind[];
    /** 全軍撤退の扱い（上の all_retreat） */
    allRetreat: 'end' | 'count';
}

/**
 * 夜（第4群。docs/fields-group4-design.md §4）。BattleSetup.night があると、両軍とも「発見済み」の相手だけが見える（seenBy）。
 * - 未発見の相手は、こちらの戦える部隊のどれかから detectRange m 以内に来たら発見する（林など隠れる地形の中なら、その距離との短い方）。
 * - 篝火の区域 torchZones の中にいる部隊は、torchRange m（省けば detectRange の 2 倍）から見つかる（隠れる地形の中でも）。
 * - 物見 lookouts の部隊は、range m から見つける。
 * - 発見済みの相手は、こちらの戦える部隊のどれかから sight m 以内にいる間は見え続ける（離れると見失う）。
 * - 斬り合う・矢を射ると、その相手の陣営に発見される。
 * 発見していない相手は、攻撃の命令の相手にならず、敵の考え・武将の自由な動きも狙わない・追わない（見えている相手だけを見る今までの決まりのまま）。
 * 画面では、発見していない敵の名札・兵士・札・地図の印を出さず、色を少し暗くする。
 */
export interface NightRule {
    sight: number;
    detectRange: number;
    torchZones?: Zone[];
    torchRange?: number;
    /** 篝火の区域の短い名前（地図の名札。省けば「篝火」） */
    torchNames?: string[];
    lookouts?: { unitId: string; range: number }[];
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
    /**
     * 武将の基本方針による自由な動き（docs/troops-abilities-design.md §3。合戦場の演習の 5 戦場だけ true）。
     * 方針を持つ武将（generals.ts の initiative）の味方の部隊は、命令を受けていない待機中（最初の待機・命令が終わった後の待機）だけ、
     * 持ち場から 40 m 以内で方針ごとに動く（ai.ts の thinkGenerals）。移動・攻撃・撤退・防衛のどの命令もこれより優先する。
     * 省けば使わない（歴史分岐・架空の第一章は今までどおり）
     */
    generalInitiative?: boolean;
    /** 終わり方の判定の順（第4群の戦場だけ。省けば今までの決まり＝decide・decideByObjective のまま） */
    endRules?: EndRules;
    /** 夜（第4群の夜襲の戦場だけ。省けば昼＝今までの視界のまま） */
    night?: NightRule;
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
    /**
     * 退いて終わった合戦の区別（BattleSetup.endRules のある合戦だけ）：'objective'＝主目標（脱出・離脱）を果たした撤収（勝利）／
     * 'abandoned'＝主目標を果たす前に全軍撤退・本陣の撤退・諸隊の撤退で合戦を放棄した（撤退）。ほかの終わり方では入れない
     */
    withdrawal?: 'objective' | 'abandoned';
}

/** 合戦の画面を呼ぶ側（章の進行）への知らせ */
export interface BattleRunHooks {
    /**
     * 勝ち負けが決まった時に 1 回だけ呼ぶ（結果の画面を出す前）。章の進行はここで結果を反映して保存する。
     * 返した文（保存できた／できなかった）を結果の画面に出す。null なら何も出さない。
     */
    onDecided?(outcome: BattleOutcome): { ok: boolean; text: string } | null;
}
