/**
 * 合戦場の一覧（データ駆動の戦場）。戦場を足すときは fields/<id>.ts に BattlefieldDef を書き、FIELDS と PRACTICE_ORDER に足す。
 *
 * - FIELDS：すべての戦場（国境の原を含む）。
 * - PRACTICE_ORDER：合戦場の演習に出す順（今回の 5 戦場）。
 * - getField(id)：戦場を引く（無ければ undefined）。
 */
import type { BattlefieldDef } from './types';
import { BORDER_FIELD_DEF } from './border_field';
import { PLAINS } from './plains';
import { RIVER_FORD } from './river_ford';
import { HILLS } from './hills';
import { FOREST } from './forest';
import { MOUNTAIN_PASS } from './mountain_pass';

export const FIELDS: readonly BattlefieldDef[] = [PLAINS, RIVER_FORD, HILLS, FOREST, MOUNTAIN_PASS, BORDER_FIELD_DEF];

/** 演習に出す順（戦場 id） */
export const PRACTICE_ORDER: readonly string[] = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass'];

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
