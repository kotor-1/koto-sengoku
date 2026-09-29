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
    | 'tokugawa' | 'oda' | 'asai' | 'asakura' | 'ronin'; // 歴史分岐「元亀元年・家康」（ronin は架空の浪人衆）

/**
 * 武将固有の特殊能力（ゲーム用の創作。史実の人物の能力ではない）。数値は battle/abilities.ts のデータに置く。
 * - ieyasu_rally：立て直しの号令（家康本陣）
 * - tadakatsu_rearguard：退路の守護（本多忠勝隊）
 * - nagamasa_support：盟友への援護（浅井長政隊。対象の部隊を 1 つ選ぶ）
 */
export type AbilityId = 'ieyasu_rally' | 'tadakatsu_rearguard' | 'nagamasa_support';

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
    aiRole?: 'hold_line' | 'reserve' | 'flank' | 'guard_hq';
    /** この部隊を率いる武将の特殊能力（武将がいる部隊だけ。1 合戦 1 回） */
    ability?: AbilityId;
}

/** 地形の区域（四角形または円） */
export type TerrainKind =
    | 'hill' // 丘：上にいる部隊は、下から来る相手に対して守りが強い。遠くまで見通せる
    | 'woods' // 林：動きが遅い。中の部隊は遠くから見えない（敵の考えは気づかない）。弓の効きが弱まる
    | 'marsh' // 湿地・浅い川：動きがとても遅い。中で戦うと不利
    | 'road'; // 道：動きが少し速い
export interface TerrainArea {
    kind: TerrainKind;
    /** 四角形（x0〜x1, z0〜z1）か円（cx, cz, r）のどちらか */
    rect?: { x0: number; x1: number; z0: number; z1: number };
    circle?: { cx: number; cz: number; r: number };
    /** 丘の高さ（m。表示と守りの強さの計算に使う） */
    height?: number;
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
}

/** 合戦の結果の種類 */
export type BattleResultKind =
    | 'victory' // 勝利：敵本陣の敗走、または敵の本陣以外の全部隊が戦えなくなった
    | 'defeat' // 敗北：味方本陣の敗走（大将は落ち延びる。死亡とは同じにしない）、または味方の全部隊が戦えなくなった
    | 'retreat'; // 撤退：全軍撤退を命じた、または日没で両軍が引いた

/** 合戦が終わった理由 */
export type BattleEndReason =
    | 'enemy_hq_routed'
    | 'enemy_army_broken'
    | 'ally_hq_routed'
    | 'ally_army_broken'
    | 'ordered_retreat'
    | 'nightfall';

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
}

/** 合戦の画面を呼ぶ側（章の進行）への知らせ */
export interface BattleRunHooks {
    /**
     * 勝ち負けが決まった時に 1 回だけ呼ぶ（結果の画面を出す前）。章の進行はここで結果を反映して保存する。
     * 返した文（保存できた／できなかった）を結果の画面に出す。null なら何も出さない。
     */
    onDecided?(outcome: BattleOutcome): { ok: boolean; text: string } | null;
}
