/**
 * 合戦場のデータ（BattlefieldDef）から合戦の設定（BattleSetup）を作る・データを検査する。純粋な TypeScript。
 *
 *   const setup = buildBattleSetup(getField('river_ford')!, 'standard');       // 演習の編成で
 *   const setup = buildBattleSetup(BORDER_FIELD_DEF, units, { objectives: 'none', briefing, pursuit: true }); // 章が自分で編成を作る
 *   const problems = validateField(field);   // 空なら問題なし
 *
 * - 地図（BattleMap）は fieldMap(field) で作る（同じ戦場なら同じ物を返す）。
 * - fieldRules は、戦場に地形の上書き・高所・特殊ルール・通れる範囲のどれかがあるときだけ付ける（無い戦場＝国境の原は付けない）。
 * - 目標は opts.objectives：'field'（既定。戦場の主目標・副目標）／'none'（付けない＝今までの勝ち負け）／自分で渡す。
 * - 援軍：編成の部隊が reinforcement を指せば、その出現地点・時刻（arriveAt）に置き、BattleSetup.reinforcements に入れる。
 */
import type { BattleMap, BattleSetup, FieldRules, ObjectiveDef, Side, UnitDef } from '../types';
import { RULES, elevationAt } from '../sim';
import { createFieldEnv, inZone, zoneCenter } from '../fieldRules';
import { isPassable, reachable } from '../pathfind';
import type { BattlefieldDef, FieldPreset, PresetUnit } from './types';

export interface BuildOptions {
    /** 'field'（既定）：戦場の目標／'none'：目標を付けない／{ primary?, secondary? }：渡した目標 */
    objectives?: 'field' | 'none' | { primary?: ObjectiveDef; secondary?: ObjectiveDef[] };
    /** 日没までの秒数（省けば戦場の timeLimitSec） */
    timeLimitSec?: number;
    /** 合戦の前の説明（省けば戦場の briefing） */
    briefing?: string[];
    pursuit?: boolean;
    pledge?: BattleSetup['pledge'];
}

const MAPS = new WeakMap<BattlefieldDef, BattleMap>();

/** 戦場の地図（合戦の計算・画面が使う形）。同じ戦場なら同じ物 */
export function fieldMap(field: BattlefieldDef): BattleMap {
    let m = MAPS.get(field);
    if (!m) {
        m = { id: field.id, name: field.name, width: field.width, depth: field.depth, terrain: field.terrain, exits: field.exits };
        MAPS.set(field, m);
    }
    return m;
}

/** 戦場ごとの決まり（何も無い戦場は undefined） */
export function fieldRulesOf(field: BattlefieldDef): FieldRules | undefined {
    const r: FieldRules = {};
    if (field.terrainRules) r.terrainRules = field.terrainRules;
    if (field.highGround) r.highGround = field.highGround;
    if (field.specialRules && field.specialRules.length) r.specialRules = field.specialRules;
    if (field.passable) r.passable = field.passable;
    return Object.keys(r).length ? r : undefined;
}

/** 編成の 1 部隊を、合戦の部隊の設定にする（置き場所は枠か援軍） */
function unitFromPreset(field: BattlefieldDef, p: PresetUnit): UnitDef {
    let pos: { x: number; z: number; facing: number };
    let arriveAt = p.arriveAt;
    if (p.reinforcement) {
        const r = field.reinforcements?.find((x) => x.id === p.reinforcement);
        if (!r) throw new Error(`戦場 ${field.id}：部隊 ${p.id} の援軍がありません: ${p.reinforcement}`);
        pos = r.point;
        arriveAt = r.at;
    } else {
        const slot = field.deployments[p.side].find((d) => d.id === p.slot);
        if (!slot) throw new Error(`戦場 ${field.id}：部隊 ${p.id} の配置の枠がありません: ${p.slot}`);
        pos = slot;
    }
    const u: UnitDef = {
        id: p.id,
        side: p.side,
        clan: p.clan,
        kind: p.kind,
        name: p.name,
        strength: p.strength,
        morale: p.morale,
        x: pos.x,
        z: pos.z,
        facing: pos.facing,
    };
    const leader = p.generalId ?? p.leaderId;
    if (leader) u.leaderId = leader;
    if (p.generalId) u.generalId = p.generalId;
    if (arriveAt !== undefined && arriveAt > 0) u.arriveAt = arriveAt;
    if (p.aiRole) u.aiRole = p.aiRole;
    if (p.aiTarget) u.aiTarget = { ...p.aiTarget };
    if (p.ability) u.ability = p.ability;
    if (p.order) u.order = { ...p.order };
    return u;
}

/** 演習の編成の部隊（見つからなければ投げる） */
export function presetUnits(field: BattlefieldDef, presetId: string): UnitDef[] {
    const pr = field.presets.find((p) => p.id === presetId);
    if (!pr) throw new Error(`戦場 ${field.id} に編成 ${presetId} がありません`);
    return pr.units.map((p) => unitFromPreset(field, p));
}

/** 合戦の設定を作る。編成は演習の編成の id か、部隊の並び（章が自分で作る） */
export function buildBattleSetup(field: BattlefieldDef, presetOrUnits: string | UnitDef[], opts: BuildOptions = {}): BattleSetup {
    const units = typeof presetOrUnits === 'string' ? presetUnits(field, presetOrUnits) : presetOrUnits;
    const setup: BattleSetup = {
        map: fieldMap(field),
        units,
        timeLimitSec: opts.timeLimitSec ?? field.timeLimitSec,
        briefing: opts.briefing ?? [...field.briefing],
    };
    if (opts.pursuit) setup.pursuit = true;
    if (opts.pledge) setup.pledge = opts.pledge;
    const rules = fieldRulesOf(field);
    if (rules) setup.fieldRules = rules;
    const o = opts.objectives ?? 'field';
    if (o === 'field') setup.objectives = { primary: field.objectives.primary, secondary: [...field.objectives.secondary] };
    else if (o !== 'none') setup.objectives = { ...(o.primary ? { primary: o.primary } : {}), secondary: [...(o.secondary ?? [])] };
    // 援軍（出現地点から現れる部隊の組）
    const reinf = (field.reinforcements ?? [])
        .map((r) => ({
            id: r.id,
            side: r.side,
            unitIds: units.filter((u) => u.arriveAt === r.at && u.x === r.point.x && u.z === r.point.z && u.side === r.side).map((u) => u.id),
        }))
        .filter((r) => r.unitIds.length > 0);
    if (reinf.length) setup.reinforcements = reinf;
    return setup;
}

/** 目標の区域（無ければ null） */
function objectiveZone(o: ObjectiveDef) {
    return 'zone' in o && o.zone ? o.zone : null;
}

/**
 * 戦場のデータを検査する（問題の文の並び。空なら問題なし）：
 * - 広さ・退き口・配置の枠・援軍の地点・目標の区域の中心・敵の考えの地点が、戦場の中の通れる所にある
 * - 味方・敵の配置の枠から、それぞれの退き口へ道がある
 * - 編成ごとに：部隊の id が重ならない・陣営ごとの部隊数が上限（RULES.maxUnitsPerSide）以下・本陣が陣営に 1 つ以上・
 *   枠／援軍が有る・目標の指す部隊が有る（敵本陣の撃破なら敵の本陣）
 * - 目標の id が重ならない・援軍の目標の援軍が有る
 */
export function validateField(field: BattlefieldDef): string[] {
    const out: string[] = [];
    const map = fieldMap(field);
    const env = createFieldEnv(map, { ...(fieldRulesOf(field) ?? {}), pathfinding: true });
    const nav = env.nav!;
    const inside = (x: number, z: number) => Math.abs(x) <= field.width / 2 && Math.abs(z) <= field.depth / 2;
    const ok = (x: number, z: number) => inside(x, z) && isPassable(nav, x, z);
    if (!(field.width > 0 && field.depth > 0)) out.push('広さが正しくない');
    for (const side of ['ally', 'enemy'] as Side[]) {
        const e = field.exits[side];
        if (!ok(e.x, e.z)) out.push(`${side} の退き口が通れる所にない`);
        const ids = new Set<string>();
        for (const d of field.deployments[side]) {
            if (ids.has(d.id)) out.push(`${side} の配置の枠 ${d.id} が重なっている`);
            ids.add(d.id);
            if (!ok(d.x, d.z)) out.push(`${side} の配置の枠 ${d.id} が通れる所にない`);
            else if (ok(e.x, e.z) && !reachable(nav, 'yari', d.x, d.z, e.x, e.z)) out.push(`${side} の配置の枠 ${d.id} から退き口へ道がない`);
        }
    }
    const rids = new Set<string>();
    for (const r of field.reinforcements ?? []) {
        if (rids.has(r.id)) out.push(`援軍 ${r.id} が重なっている`);
        rids.add(r.id);
        if (!ok(r.point.x, r.point.z)) out.push(`援軍 ${r.id} の出現地点が通れる所にない`);
    }
    const objs = [field.objectives.primary, ...field.objectives.secondary];
    const oids = new Set<string>();
    for (const o of objs) {
        if (oids.has(o.id)) out.push(`目標 ${o.id} が重なっている`);
        oids.add(o.id);
        const z = objectiveZone(o);
        if (z) {
            const c = zoneCenter(z);
            if (!ok(c.x, c.z)) out.push(`目標 ${o.id} の区域の中心が通れる所にない`);
            else if (!inZone(z, c.x, c.z)) out.push(`目標 ${o.id} の区域が正しくない`);
        }
        if (o.type === 'survive_until' && !rids.has(o.reinforcementId)) out.push(`目標 ${o.id} の援軍 ${o.reinforcementId} がない`);
    }
    for (const r of field.specialRules ?? []) {
        if (r.type === 'narrow_frontage') {
            const c = zoneCenter(r.zone);
            if (!ok(c.x, c.z)) out.push('狭い正面の区域の中心が通れる所にない');
            if (!(r.maxEngaged >= 1)) out.push('狭い正面の maxEngaged は 1 以上');
        } else if (r.type === 'woods_ambush') {
            if (!(r.firstStrikeMul > 0 && r.sec > 0)) out.push('林の奇襲の数値が正しくない');
        }
    }
    if (field.presets.length === 0) out.push('演習の編成がない');
    const pids = new Set<string>();
    for (const pr of field.presets) {
        if (pids.has(pr.id)) out.push(`編成 ${pr.id} が重なっている`);
        pids.add(pr.id);
        out.push(...validatePreset(field, pr, objs, ok));
    }
    return out;
}

function validatePreset(field: BattlefieldDef, pr: FieldPreset, objs: ObjectiveDef[], ok: (x: number, z: number) => boolean): string[] {
    const out: string[] = [];
    const tag = `編成 ${pr.id}`;
    const ids = new Set<string>();
    for (const u of pr.units) {
        if (ids.has(u.id)) out.push(`${tag}：部隊の id ${u.id} が重なっている`);
        ids.add(u.id);
        if (!u.slot && !u.reinforcement) out.push(`${tag}：部隊 ${u.id} に置き場所（枠か援軍）がない`);
        if (u.slot && !field.deployments[u.side].some((d) => d.id === u.slot)) out.push(`${tag}：部隊 ${u.id} の枠 ${u.slot} が ${u.side} の配置にない`);
        if (u.reinforcement && !field.reinforcements?.some((r) => r.id === u.reinforcement && r.side === u.side)) out.push(`${tag}：部隊 ${u.id} の援軍 ${u.reinforcement} がない`);
        if (u.aiTarget && !ok(u.aiTarget.x, u.aiTarget.z)) out.push(`${tag}：部隊 ${u.id} の敵の考えの地点が通れる所にない`);
        if (!(u.strength > 0) || !(u.morale > 0 && u.morale <= 100)) out.push(`${tag}：部隊 ${u.id} の兵・士気が正しくない`);
    }
    // 同じ枠に 2 部隊を置かない
    const slots = new Set<string>();
    for (const u of pr.units) {
        if (!u.slot) continue;
        const k = `${u.side}:${u.slot}`;
        if (slots.has(k)) out.push(`${tag}：枠 ${u.slot} に 2 部隊が置かれている`);
        slots.add(k);
    }
    for (const side of ['ally', 'enemy'] as Side[]) {
        const us = pr.units.filter((u) => u.side === side);
        if (us.length > RULES.maxUnitsPerSide[side]) out.push(`${tag}：${side} の部隊が ${us.length}（上限 ${RULES.maxUnitsPerSide[side]}）`);
        if (!us.some((u) => u.kind === 'honjin')) out.push(`${tag}：${side} に本陣がない`);
    }
    for (const o of objs) {
        if ('unitId' in o && !ids.has(o.unitId)) out.push(`${tag}：目標 ${o.id} の部隊 ${o.unitId} がない`);
    }
    // 部隊の置き場所が戦場の高さの計算を壊していないか（数であること）
    for (const u of pr.units) {
        const d = u.slot ? field.deployments[u.side].find((x) => x.id === u.slot) : field.reinforcements?.find((r) => r.id === u.reinforcement)?.point;
        if (d && !Number.isFinite(elevationAt(fieldMap(field), d.x, d.z))) out.push(`${tag}：部隊 ${u.id} の地点の高さが数でない`);
    }
    return out;
}
