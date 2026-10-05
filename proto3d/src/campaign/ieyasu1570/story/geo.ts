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
export type GeoId = 'home' | 'oda' | 'omi' | 'asai' | 'asakura' | 'border' | 'field1' | 'site_oda' | 'site_asai' | 'site_home';

/** 場所の位置（模式。向きの目安だけ） */
export const MAP_POS: Readonly<Record<GeoId, { x: number; y: number }>> = {
    // 徳川の城下（三河）：東寄り
    home: { x: 76, y: 64 },
    // 織田家：城下の西
    oda: { x: 56, y: 48 },
    // 近江（織田と浅井・朝倉が敵味方に分かれた所）：さらに西
    omi: { x: 33, y: 44 },
    // 浅井家（近江）
    asai: { x: 24, y: 34 },
    // 朝倉家：浅井の北（国の名前は出さない）
    asakura: { x: 20, y: 13 },
    // 国境（浪人の一団が村を荒らす）：城下の南西
    border: { x: 62, y: 84 },
    // 第一章の合戦の場所「国境の原」（架空の局地戦）
    field1: { x: 49, y: 73 },
    // 第二章の任務の場所（創作。位置は模式）
    site_oda: { x: 42, y: 37 },
    site_asai: { x: 27, y: 23 },
    site_home: { x: 85, y: 80 },
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
