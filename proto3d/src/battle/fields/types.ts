/**
 * 合戦場のデータの型（データ駆動の戦場。設計：docs/battlefields-design.md §3）。純粋な TypeScript（型と小さな定数だけ）。
 *
 * 1 戦場 1 ファイル（fields/<id>.ts）に BattlefieldDef を 1 つ書き、fields/index.ts の FIELDS に足す。
 * 合戦の設定（BattleSetup）は fields/build.ts の buildBattleSetup(field, 編成, opts) が作り、validateField が検査する。
 *
 * 座標は合戦と同じ（x は東、z は南。味方は南、敵は北に陣取る。向きは 0 が北、π が南）。
 */
import type {
    AbilityId,
    ClanId,
    HighGroundRule,
    ObjectiveDef,
    Order,
    Side,
    SpecialRule,
    TerrainArea,
    TerrainKind,
    TerrainRule,
    UnitDef,
    UnitKind,
} from '../types';

/** 合戦場の分類（完成版で 20 種。表は fields/kinds.ts） */
export type FieldKind =
    | 'plains' // 大平原
    | 'river_ford' // 河川・浅瀬
    | 'single_bridge' // 一本橋
    | 'multi_bridge' // 複数橋
    | 'hills' // 丘陵
    | 'ridge' // 尾根
    | 'forest' // 森林
    | 'mountain_pass' // 山道・峠
    | 'valley' // 谷間
    | 'paddy' // 水田
    | 'marsh' // 湿地
    | 'village' // 村落
    | 'temple' // 寺社
    | 'town_edge' // 城下町外縁
    | 'siege_front' // 城攻め前面
    | 'besieged_camp' // 包囲された陣
    | 'relief' // 援軍救出
    | 'rearguard' // 退却戦
    | 'night_raid' // 夜襲・奇襲
    | 'shore'; // 湖・海・河岸

/** 初期配置の枠（部隊を置く所） */
export interface DeploySlot {
    id: string;
    x: number;
    z: number;
    /** 向き（ラジアン。0 が北） */
    facing: number;
    /** 役割の目安（説明用。例：「正面」「右翼」「予備」） */
    note?: string;
}

/** 援軍の出現地点（部隊は編成の reinforcement でこの id を指す） */
export interface ReinforcementDef {
    id: string;
    side: Side;
    /** 開始から何秒で現れるか */
    at: number;
    /** 出現地点 */
    point: { x: number; z: number; facing: number };
    /** 説明用の呼び方（例：「後詰めの援軍」） */
    label: string;
}

/** 編成の 1 部隊（演習で使う。枠 slot か援軍 reinforcement のどちらかで置き場所を決める） */
export interface PresetUnit {
    id: string;
    side: Side;
    clan: ClanId;
    kind: UnitKind;
    /** 表示名（例：「本多忠勝隊」） */
    name: string;
    /** 率いる武将（battle/generals.ts の id）。leaderId にも同じ値を入れる */
    generalId?: string;
    /** 武将以外の人物（章の人物）。generalId があれば省く */
    leaderId?: string;
    strength: number;
    morale: number;
    /** 初期配置の枠の id（援軍なら省く） */
    slot?: string;
    /** 援軍（ReinforcementDef の id）。出現地点・時刻はそちらで決まる */
    reinforcement?: string;
    /** 開始から何秒で着くか（枠に置く部隊を遅らせるとき。援軍は ReinforcementDef.at） */
    arriveAt?: number;
    aiRole?: UnitDef['aiRole'];
    aiTarget?: UnitDef['aiTarget'];
    aiLeash?: UnitDef['aiLeash'];
    /** 固有能力（省けば武将の能力を使う。武将の能力の結び付けは generals.ts・abilities.ts の担当） */
    ability?: AbilityId;
    order?: Order;
}

/** 演習の編成 */
export interface FieldPreset {
    id: string;
    name: string;
    /** 編成の説明（例：「味方 7／敵 7。家康・忠勝・榊原・酒井・石川」） */
    summary: string;
    units: PresetUnit[];
}

/** 合戦場のデータ */
export interface BattlefieldDef {
    /** 戦場 ID（保存の鍵にも使う。変えない） */
    id: string;
    /** 名称 */
    name: string;
    kind: FieldKind;
    /** 一覧・説明に出す短い特徴 */
    summary: string;
    /** 広さ（x: -width/2〜width/2, z: -depth/2〜depth/2） */
    width: number;
    depth: number;
    /** 地形（丘・林・湿地・道・深い川・浅瀬・崖） */
    terrain: TerrainArea[];
    /** 通行可能範囲（省けば全体。深い川・崖の区域は別に通れない） */
    passable?: { x0: number; x1: number; z0: number; z1: number };
    /**
     * true なら、通れない所（川・崖）が無くても格子の道探しで動く（FieldRules.pathfinding）。水田のように遅い地形の間に速い道がある戦場で、
     * 部隊が道を選んで進むように付ける。川・崖のある戦場はいつも道探しをするので要らない
     */
    pathfinding?: boolean;
    /** 移動速度補正・損害・視界への影響（地形ごとの上書き。省いた地形は既定） */
    terrainRules?: Partial<Record<TerrainKind, TerrainRule>>;
    /** 高低差・有利地点の効果（省けば既定） */
    highGround?: HighGroundRule;
    /** 特殊ルール */
    specialRules?: SpecialRule[];
    /** 初期配置の枠（味方・敵） */
    deployments: { ally: DeploySlot[]; enemy: DeploySlot[] };
    /** 援軍の出現地点 */
    reinforcements?: ReinforcementDef[];
    /** 撤退地点（退き口） */
    exits: Record<Side, { x: number; z: number }>;
    /** 主目標・副目標 */
    objectives: { primary: ObjectiveDef; secondary: ObjectiveDef[] };
    /** 日没までの秒数 */
    timeLimitSec: number;
    /** 合戦の前の説明（地形・目標・特殊ルール。編成の説明は画面が足す） */
    briefing: string[];
    /** 地形に合った戦い方の目安（説明・釣り合いの調整用） */
    tactics: string[];
    /** 演習の編成（1 つ以上） */
    presets: FieldPreset[];
    /**
     * true なら、部隊の動きを Version 11 のまま（FieldRules.settleMoves を付けない）。国境の原（架空の第一章・歴史分岐の章）だけが使う。
     * 新しい戦場は省く（行き先の近くで詰まった移動を着いたことにする、など新しい動きの決まりになる）
     */
    keepV11Movement?: boolean;
    /**
     * true なら、武将の基本方針による自由な動きを入れる（BattleSetup.generalInitiative。docs/troops-abilities-design.md §3）。
     * 演習の 5 戦場だけが付ける。国境の原（架空の第一章・歴史分岐の章）は付けない
     */
    generalInitiative?: boolean;
}
