/**
 * 歴史分岐「元亀元年・家康」の物語の見せ方（演出・情勢・物見）で使う、模式図の地図の場所の位置（純粋な定数と小さな計算）。
 * 設計：docs/story-rpg-design.md §0・§2・§4。型：story/types.ts（MapPlace・MapRoute・MapScene）。
 *
 * ＊＊ 模式図。国・城・道の位置と距離は正確ではない ＊＊
 * - 座標は地図の上の点（0〜100 の正方形。x は東、y は南）。実際の地理の測った位置ではない（向きの目安だけ）。
 * - 地名は、今ある文に出る物（近江・三河・国境）より細かくしない。城・町の名前は出さない（「徳川の城下」）。
 * - 第一章の合戦の場所「国境の原」は架空の局地戦（どの方針でも同じ戦場）。第二章の任務の場所（織田勢の退き口・浅井勢の孤立した丘・
 *   領内の村）も創作で、位置は模式。
 */
import type { Policy } from '../state';

/** 模式図の注記（地図に必ず出す） */
export const MAP_NOTE = '模式図。国・城・道の位置と距離は正確ではない';

/** 場所の id（地図の場所・線の id に使う。演出の台本・情勢の画面・物見で同じ物） */
export type GeoId = 'home' | 'oda' | 'asai' | 'asakura' | 'border' | 'field1' | 'site_oda' | 'site_asai' | 'site_home' | 'oda_camp';

/** 場所の位置（模式。向きの目安だけ） */
export const MAP_POS: Readonly<Record<GeoId, { x: number; y: number }>> = {
    // 徳川の城下（三河）：東
    home: { x: 88, y: 40 },
    // 織田家：城下の西寄りの北（西の近江へ向かう線が、織田家の名前の下を通らないように）
    oda: { x: 64, y: 8 },
    // 浅井家（近江。織田と浅井・朝倉が敵味方に分かれた所）：西
    asai: { x: 8, y: 42 },
    // 朝倉家：浅井の北（国の名前は出さない）
    asakura: { x: 8, y: 10 },
    // 国境（浪人の一団が村を荒らす）：城下の南
    border: { x: 88, y: 84 },
    // 第一章の合戦の場所「国境の原」（架空の局地戦）：国境のすぐ西（城下と近江の間の、国境寄り）
    field1: { x: 70, y: 84 },
    // 第二章の任務の場所（創作。位置は模式）
    site_oda: { x: 38, y: 64 },
    site_asai: { x: 26, y: 64 },
    site_home: { x: 68, y: 48 },
    // 第二章 A：近江の織田の本隊の陣（引き払う。ゲーム用の創作。位置は模式）。浅井・朝倉の東、織田家の南西
    oda_camp: { x: 26, y: 24 },
};

/**
 * 物見で記録した場所を、任務の場所のまわりに置く位置（任務の場所からのずれ。地図の点の単位）。
 * 印の並び（戦場の方角・要所 1・要所 2）の順。向きは記録の文と同じ（模式図は北が上：y が小さいほど北。戦場の中の南北・東西をそのまま写す）。
 * そのうえで、地図の狭い画面で名前が線・ほかの場所と重ならない所を選んだ（距離は模式）。
 */
export const SCOUT_SLOTS: Readonly<Record<GeoId, readonly { x: number; y: number }[]>> = {
    home: [],
    oda: [],
    asai: [],
    asakura: [],
    border: [],
    // 国境の原：退き口（南の端。南）・丘（北）・林と湿地（西の林を代表に西）
    field1: [
        { x: 6, y: 8 },
        { x: -8, y: -10 },
        { x: -14, y: -2 },
    ],
    // 織田勢の退き口：南の端（退き口。南）・切れ目（原の中ほど）・小丘（北寄り）
    site_oda: [
        { x: 8, y: 18 },
        { x: 18, y: 2 },
        { x: 8, y: -8 },
    ],
    // 浅井勢の孤立した丘：安全地点（南）・丘の上（北東）・林の縁（西）
    site_asai: [
        { x: 0, y: 30 },
        { x: 18, y: -8 },
        { x: -20, y: 14 },
    ],
    // 領内の村：村の通り（北から南へ。北）・屋敷前（屋敷の南の広場。南）・柵と米蔵（米蔵は西の端。いちばん西）
    site_home: [
        { x: 2, y: -16 },
        { x: -4, y: 10 },
        { x: -14, y: 2 },
    ],
    oda_camp: [],
};

type Pt = { x: number; y: number };

/**
 * 軍議で方針を見比べる線（map.ts の prospectRoutes）の曲げる点。鍵は「方針.相手」。
 * 同じ相手への線が重ならないように：A の敵対（浅井・朝倉）はまっすぐ、B の協力は浅井へ南へ曲げ、B の敵対は織田へ今の協力の線（rel.oda）より北へ曲げる。
 */
export const PROSPECT_VIA: Readonly<Record<string, readonly Pt[]>> = {
    'asai.asai': [{ x: 50, y: 50 }],
    'asai.oda': [{ x: 78, y: 16 }],
    // C の見込み（城下→国境 敵対）：今の関係の線 rel.border と同じ筋（城下の名前・添え書き「三河」の東を回る）
    'home.border': [{ x: 100, y: 42 }, { x: 100, y: 66 }],
};

/**
 * ほかの線の曲げる点（鍵は線の id。map.ts の scene が付ける）。狭い画面（844×390）で線が場所の名前・矢じりと重ならないように：
 * 使いの線は協力の線と同じ筋に重ならないように少し曲げる。
 */
export const ROUTE_VIA: Readonly<Record<string, readonly Pt[]>> = {
    'envoy.oda': [{ x: 80, y: 16 }],
    // 城下の名前（「◎徳川の城下」と添え書き「三河」）は印の下に出る。城下から南へ出る線がその上を通らないように回す（点検の指摘：
    // 負け側の地図で、国境への赤い線が「三河」の字の上を通っていた）。
    // 織田との協力：北から横に入る（織田家の名前は印の下に出るので、右下から入ると名前の端を通る）
    'rel.oda': [{ x: 80, y: 8 }],
    // C の関係（城下→国境 敵対）：城下の名前の東（右の端）を回って南の国境へ
    'rel.border': [{ x: 100, y: 42 }, { x: 100, y: 66 }],
    // 第一章の出陣と帰還：城下の名前の西を通って国境の原へ
    'march.field1': [{ x: 72, y: 42 }],
    'return.field1': [{ x: 72, y: 42 }],
    // C の危機（国境→領内の村）：村の名前は印の下に出るので、東から村へ入る（スマホ横の広げた地図で、脅かす向きの矢印が「◎領内の村」の上を通らない）
    'threat.home': [{ x: 78, y: 56 }],
    // B の危機：織田方は北から回って丘へ（織田家の名前の上を通らない）
    'threat.asai': [{ x: 45, y: 12 }],
    // A・B の出陣と帰還：任務の場所の真上から（場所の名前・物見の場所の名前・脅かす向きの矢じりに掛からない）
    'march.site_oda': [{ x: 38, y: 48 }],
    'return.site_oda': [{ x: 38, y: 48 }],
    'march.site_asai': [{ x: 26, y: 48 }],
    'return.site_asai': [{ x: 26, y: 48 }],
};

/** 第二章の任務の場所の id（方針ごと） */
export const CH2_SITE: Readonly<Record<Policy, GeoId>> = { oda: 'site_oda', asai: 'site_asai', home: 'site_home' };

/**
 * 地図の上の 2 点の向き（ラジアン。0 が北、時計回り。ScoutPoint の heading と同じ測り方）。
 * 地図は x が東・y が南なので、北は −y。
 */
export function mapHeading(from: GeoId, to: GeoId): number {
    const a = MAP_POS[from];
    const b = MAP_POS[to];
    return Math.atan2(b.x - a.x, -(b.y - a.y));
}

/** 向きを −π〜π に丸める */
export function wrapAngle(a: number): number {
    return Math.atan2(Math.sin(a), Math.cos(a));
}
