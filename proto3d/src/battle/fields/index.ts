/**
 * 合戦場の一覧（データ駆動の戦場）。戦場を足すときは fields/<id>.ts に BattlefieldDef を書き、FIELDS と PRACTICE_ORDER に足す。
 *
 * - FIELDS：すべての戦場（国境の原を含む）。
 * - PRACTICE_ORDER：合戦場の演習に出す順（第1群の 5 戦場と、第2群の 5 戦場（一本橋・複数橋・尾根・谷間・水田）と、
 *   第3群の 5 戦場（湿地・村落・寺社周辺・城下町外縁・城攻め前面））。
 * - getField(id)：戦場を引く（無ければ undefined）。
 */
import type { BattlefieldDef } from './types';
import { BORDER_FIELD_DEF } from './border_field';
import { PLAINS } from './plains';
import { RIVER_FORD } from './river_ford';
import { HILLS } from './hills';
import { FOREST } from './forest';
import { MOUNTAIN_PASS } from './mountain_pass';
import { SINGLE_BRIDGE } from './single_bridge';
import { MULTI_BRIDGE } from './multi_bridge';
import { RIDGE } from './ridge';
import { VALLEY } from './valley';
import { PADDY } from './paddy';
import { MARSH } from './marsh';
import { VILLAGE } from './village';
import { TEMPLE } from './temple';
import { TOWN_EDGE } from './town_edge';
import { SIEGE_FRONT } from './siege_front';

export const FIELDS: readonly BattlefieldDef[] = [PLAINS, RIVER_FORD, HILLS, FOREST, MOUNTAIN_PASS, SINGLE_BRIDGE, MULTI_BRIDGE, RIDGE, VALLEY, PADDY, MARSH, VILLAGE, TEMPLE, TOWN_EDGE, SIEGE_FRONT, BORDER_FIELD_DEF];

/** 演習に出す順（戦場 id）。第1群の 5 戦場の後に第2群の 5 戦場、その後に第3群の 5 戦場 */
export const PRACTICE_ORDER: readonly string[] = [
    'plains',
    'river_ford',
    'hills',
    'forest',
    'mountain_pass',
    'single_bridge',
    'multi_bridge',
    'ridge',
    'valley',
    'paddy',
    'marsh',
    'village',
    'temple',
    'town_edge',
    'siege_front',
];

export function getField(id: string): BattlefieldDef | undefined {
    return FIELDS.find((f) => f.id === id);
}

/** 演習に出す戦場（PRACTICE_ORDER の順） */
export function practiceFields(): BattlefieldDef[] {
    return PRACTICE_ORDER.map((id) => getField(id)!).filter(Boolean);
}

export type { BattlefieldDef, FieldKind, FieldPreset, PresetUnit, DeploySlot, ReinforcementDef } from './types';
export { buildBattleSetup, validateField, fieldMap, fieldRulesOf, presetUnits } from './build';
export { FIELD_KINDS, fieldKindInfo } from './kinds';
