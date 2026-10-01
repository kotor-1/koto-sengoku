/**
 * 合戦場の 20 種の分類（設計：docs/battlefields-design.md §3 の表）。データだけ。
 * implemented は、その分類の戦場データ（fields/<id>.ts）が一覧 FIELDS にあるか。残りは同じ形のデータで足す。
 */
import type { FieldKind } from './types';

export interface FieldKindInfo {
    kind: FieldKind;
    /** 名称 */
    name: string;
    /** 主に使うデータ（地形の種類・特殊ルール・目標） */
    uses: string;
    /** 戦場データがある */
    implemented: boolean;
}

export const FIELD_KINDS: readonly FieldKindInfo[] = [
    { kind: 'plains', name: '大平原', uses: '道・予備隊の枠', implemented: true },
    { kind: 'river_ford', name: '河川・浅瀬', uses: 'river・ford（浅瀬の乱れ）', implemented: true },
    { kind: 'single_bridge', name: '一本橋', uses: 'river・bridge（狭い通路）・narrow_frontage・浅瀬（遠回り）', implemented: true },
    { kind: 'multi_bridge', name: '複数橋', uses: 'river・bridge×3・defend_time', implemented: true },
    { kind: 'hills', name: '丘陵', uses: 'hill・highGround', implemented: true },
    { kind: 'ridge', name: '尾根', uses: 'hill（capsule＝細長い）・cliff（急な面）・road（側面の登り道）', implemented: true },
    { kind: 'forest', name: '森林', uses: 'woods・woods_ambush・視界', implemented: true },
    { kind: 'mountain_pass', name: '山道・峠', uses: 'cliff・narrow_frontage', implemented: true },
    { kind: 'valley', name: '谷間', uses: 'cliff・hill（両側の capsule）・highGround.arrowDealVsLower・breakthrough', implemented: true },
    { kind: 'paddy', name: '水田', uses: 'paddy（兵種ごとの速さ kindSpeed）・街道と畦道（road）・rescue', implemented: true },
    { kind: 'marsh', name: '湿地', uses: 'marsh', implemented: false },
    { kind: 'village', name: '村落', uses: '村（守りに有利。地形の種類を足す）', implemented: false },
    { kind: 'temple', name: '寺社', uses: '石段・村', implemented: false },
    { kind: 'town_edge', name: '城下町外縁', uses: '村・road', implemented: false },
    { kind: 'siege_front', name: '城攻め前面', uses: '堀（river）・門（hold_point）', implemented: false },
    { kind: 'besieged_camp', name: '包囲された陣', uses: 'defend_time', implemented: false },
    { kind: 'relief', name: '援軍救出', uses: 'rescue', implemented: false },
    { kind: 'rearguard', name: '退却戦', uses: 'retreat_success', implemented: false },
    { kind: 'night_raid', name: '夜襲・奇襲', uses: '視界を狭める（hideSight の上書き）・woods_ambush', implemented: false },
    { kind: 'shore', name: '湖・海・河岸', uses: 'river（片側）・ford', implemented: false },
];

export function fieldKindInfo(kind: FieldKind): FieldKindInfo {
    return FIELD_KINDS.find((k) => k.kind === kind)!;
}
