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
    { kind: 'multi_bridge', name: '複数橋', uses: 'river・bridge×3・defend_time・defend_zones', implemented: true },
    { kind: 'hills', name: '丘陵', uses: 'hill・highGround', implemented: true },
    { kind: 'ridge', name: '尾根', uses: 'hill（capsule＝細長い）・cliff（急な面）・road（側面の登り道）', implemented: true },
    { kind: 'forest', name: '森林', uses: 'woods・woods_ambush・視界', implemented: true },
    { kind: 'mountain_pass', name: '山道・峠', uses: 'cliff・narrow_frontage', implemented: true },
    { kind: 'valley', name: '谷間', uses: 'cliff・hill（両側の capsule）・highGround.arrowDealVsLower・breakthrough', implemented: true },
    { kind: 'paddy', name: '水田', uses: 'paddy（兵種ごとの速さ kindSpeed）・街道と畦道（road）・rescue', implemented: true },
    { kind: 'marsh', name: '湿地', uses: 'marsh（arrowDealMul・noCharge）・dry（乾いた足場・土手道）・breakthrough', implemented: true },
    { kind: 'village', name: '村落', uses: 'building（通行・射線を遮る）・fence（射線は通す）・defend_time（区域）・時間差の援軍', implemented: true },
    { kind: 'temple', name: '寺社', uses: 'hill（四角の台地）・cliff・石段（narrow_frontage）・building・hold_zones', implemented: true },
    { kind: 'town_edge', name: '城下町外縁', uses: 'building・wall（門口）・road・limit_breakthrough', implemented: true },
    { kind: 'siege_front', name: '城攻め前面', uses: 'wall・gates（門の制圧）・hill（櫓）・fence・sequence（open_gate → hold_point）', implemented: true },
    { kind: 'besieged_camp', name: '包囲された陣', uses: 'escape（総大将と指定数の脱出・出口 2 つ）・fence（陣）・cliff（突破口）・narrow_frontage・pursuit・endRules', implemented: true },
    { kind: 'relief', name: '援軍救出', uses: 'rescue_escort（合流区域 → 安全区域・最低兵力）・woods（隠れた回り道）・時間差の援軍・endRules', implemented: true },
    { kind: 'rearguard', name: '退却戦', uses: 'withdraw（総大将と指定数の離脱）・pursuit（追い討ち）・cliff（切れ目）・narrow_frontage・endRules（全軍撤退も数える）', implemented: true },
    { kind: 'night_raid', name: '夜襲・奇襲', uses: 'night（視界と発見・篝火・物見）・woods（見つかりにくい道）・fence（陣）・hold_point・endRules', implemented: true },
    { kind: 'shore', name: '湖・海・河岸', uses: 'river（片側の湖）・cliff（岸の狭い道）・hill（内陸の高地）・defend_zones・narrow_frontage・endRules', implemented: true },
];

export function fieldKindInfo(kind: FieldKind): FieldKindInfo {
    return FIELD_KINDS.find((k) => k.kind === kind)!;
}
