/**
 * 合戦場のデータ（BattlefieldDef）から合戦の設定（BattleSetup）を作る・データを検査する。純粋な TypeScript。
 *
 *   const setup = buildBattleSetup(getField('river_ford')!, 'standard');       // 演習の編成で
 *   const setup = buildBattleSetup(BORDER_FIELD_DEF, units, { objectives: 'none', briefing, pursuit: true }); // 章が自分で編成を作る
 *   const problems = validateField(field);   // 空なら問題なし
 *
 * - 地図（BattleMap）は fieldMap(field) で作る（同じ戦場なら同じ物を返す）。
 * - fieldRules は、地形の上書き・高所・特殊ルール・通れる範囲と、新しい動きの決まり（settleMoves）を付ける。
 *   国境の原（keepV11Movement）は、ほかの決まりも無いので付けない（Version 11 の合戦のまま）。
 * - 目標は opts.objectives：'field'（既定。戦場の主目標・副目標）／'none'（付けない＝今までの勝ち負け）／自分で渡す。
 * - 武将の自由な動き（BattleSetup.generalInitiative）は、戦場の generalInitiative（演習の 5 戦場）を写す。opts で上書きできる。
 * - 援軍：編成の部隊が reinforcement を指せば、その出現地点・時刻（arriveAt）に置き、BattleSetup.reinforcements に入れる。
 */
import type { BattleMap, BattleSetup, FieldRules, ObjectiveDef, Side, TerrainKind, UnitDef } from '../types';
import { RULES, elevationAt } from '../sim';
import { areaCenter, createFieldEnv, inZone, zoneCenter } from '../fieldRules';
import { NAV_CELL, isPassable, reachable } from '../pathfind';
import { generalById } from '../generals';
import { ABILITY_DATA } from '../abilities';
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
    /** 武将の自由な動き（省けば戦場の generalInitiative。章が自分で作る合戦で false にすれば使わない） */
    generalInitiative?: boolean;
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
    if (field.pathfinding) r.pathfinding = true;
    if (!field.keepV11Movement) r.settleMoves = true;
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
    if (p.aiLeash !== undefined) u.aiLeash = p.aiLeash;
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
    if (opts.generalInitiative ?? field.generalInitiative) setup.generalInitiative = true;
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

/** 目標の区域（区域を持たない目標は空。defend_zones は区域ごと） */
function objectiveZones(o: ObjectiveDef) {
    if (o.type === 'defend_zones') return o.zones;
    return 'zone' in o && o.zone ? [o.zone] : [];
}

/** 味方が入って果たす目標の区域（地点の確保・区域の防衛・突破・救出の陣） */
function allyZoneObjective(o: ObjectiveDef): boolean {
    return o.type === 'hold_point' || o.type === 'breakthrough' || o.type === 'rescue' || (o.type === 'defend_time' && !!o.zone) || o.type === 'defend_zones';
}

/** 目標の指す部隊が、どちらの陣営でなければならないか（部隊を指さない目標は null） */
function objectiveUnitSide(o: ObjectiveDef): Side | null {
    if (o.type === 'rescue' || o.type === 'preserve_unit') return 'ally';
    if (o.type === 'break_unit') return 'enemy';
    return null;
}

/** 正の有限の数か */
const positive = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v > 0);
/** 0 以上の有限の数か */
const nonNegative = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);

/** 地形の決まり・高所の決まり・日没の数値の検査（通れない地形の川・崖は速さを見ない） */
function validateRules(field: BattlefieldDef): string[] {
    const out: string[] = [];
    if (!(Number.isFinite(field.timeLimitSec) && field.timeLimitSec > 0)) out.push('日没までの秒数（timeLimitSec）は 0 より大きい数');
    for (const [k, r] of Object.entries(field.terrainRules ?? {}) as [TerrainKind, NonNullable<BattlefieldDef['terrainRules']>[TerrainKind]][]) {
        if (!r) continue;
        const blocked = k === 'river' || k === 'cliff';
        if (!blocked && !positive(r.speed)) out.push(`地形の決まり ${k} の speed は 0 より大きい数（部隊が動けなくなる）`);
        for (const [uk, v] of Object.entries(r.kindSpeed ?? {})) if (!blocked && !positive(v)) out.push(`地形の決まり ${k} の kindSpeed.${uk} は 0 より大きい数`);
        if (!positive(r.dealMul)) out.push(`地形の決まり ${k} の dealMul は 0 より大きい数`);
        if (!positive(r.takeMul)) out.push(`地形の決まり ${k} の takeMul は 0 より大きい数`);
        if (!positive(r.arrowTakeMul)) out.push(`地形の決まり ${k} の arrowTakeMul は 0 より大きい数`);
        if (!nonNegative(r.hideSight)) out.push(`地形の決まり ${k} の hideSight は 0 以上の数`);
    }
    const hg = field.highGround;
    if (hg) {
        if (!positive(hg.defenseVsLower)) out.push('高所の defenseVsLower は 0 より大きい数');
        if (!nonNegative(hg.minDiff)) out.push('高所の minDiff は 0 以上の数');
        if (!nonNegative(hg.rangeBonus)) out.push('高所の rangeBonus は 0 以上の数');
        if (!nonNegative(hg.sightBonus)) out.push('高所の sightBonus は 0 以上の数');
        if (!positive(hg.arrowDealVsLower)) out.push('高所の arrowDealVsLower は 0 より大きい数');
    }
    return out;
}

/**
 * 地形の形の検査：形（四角・円・カプセル）がちょうど 1 つ、大きさが正しい。橋は四角で、深い川の上を渡っている
 * （真ん中が川の中、長い向きの両端の先が川の外の通れる所で、両端の間を橋の上でまっすぐ通れる）。
 * 丘（尾根）の頂へ、味方の退き口から登る道がある（頂が崖・川の中にない）。
 */
function validateTerrain(
    field: BattlefieldDef,
    ok: (x: number, z: number) => boolean,
    fromExit: (side: Side, x: number, z: number) => boolean,
): string[] {
    const out: string[] = [];
    const rivers = field.terrain.filter((a) => a.kind === 'river');
    field.terrain.forEach((a, i) => {
        const tag = `地形 ${i}（${a.kind}）`;
        const shapes = [a.rect, a.circle, a.capsule].filter(Boolean).length;
        if (shapes !== 1) {
            out.push(`${tag} の形（rect・circle・capsule）はちょうど 1 つ`);
            return;
        }
        if (a.rect && !(a.rect.x1 > a.rect.x0 && a.rect.z1 > a.rect.z0)) out.push(`${tag} の四角が正しくない`);
        if (a.circle && !(a.circle.r > 0)) out.push(`${tag} の円の半径は 0 より大きい数`);
        if (a.capsule && !(a.capsule.r > 0)) out.push(`${tag} のカプセルの幅 r は 0 より大きい数`);
        if (a.kind === 'hill' && a.height !== undefined && !(a.height > 0)) out.push(`${tag} の高さは 0 より大きい数`);
        if (a.kind === 'bridge') {
            if (!a.rect) {
                out.push(`${tag} の橋は四角で書く`);
                return;
            }
            const r = a.rect;
            const cx = (r.x0 + r.x1) / 2;
            const cz = (r.z0 + r.z1) / 2;
            if (!rivers.some((v) => inZone(v, cx, cz))) out.push(`${tag} の橋の真ん中が深い川の上にない`);
            // 長い向きの両端の、少し先（格子 1 つ分）
            const alongZ = r.z1 - r.z0 >= r.x1 - r.x0;
            const step = NAV_CELL;
            const ends = alongZ
                ? [
                      { x: cx, z: r.z0 - step },
                      { x: cx, z: r.z1 + step },
                  ]
                : [
                      { x: r.x0 - step, z: cz },
                      { x: r.x1 + step, z: cz },
                  ];
            const endsOk = ends.every((p) => ok(p.x, p.z) && !rivers.some((v) => inZone(v, p.x, p.z)));
            if (!endsOk) out.push(`${tag} の橋の両端の先が通れる岸にない（川を渡り切っていない）`);
            // 橋の上の真ん中の筋が、端から端まで通れる（格子より細い橋・崖で塞いだ橋を見つける）
            const len = alongZ ? r.z1 - r.z0 : r.x1 - r.x0;
            const n = Math.max(2, Math.ceil(len / (step * 0.5)));
            for (let k = 0; k <= n; k++) {
                const t = k / n;
                const x = alongZ ? cx : r.x0 + (r.x1 - r.x0) * t;
                const z = alongZ ? r.z0 + (r.z1 - r.z0) * t : cz;
                if (!ok(x, z)) {
                    out.push(`${tag} の橋の上に通れない所がある（細すぎるか、崖で塞がれている）`);
                    break;
                }
            }
        }
        if (a.kind === 'hill') {
            const c = areaCenter(a);
            if (!ok(c.x, c.z)) out.push(`${tag} の丘の頂が通れる所にない`);
            else if (!fromExit('ally', c.x, c.z)) out.push(`${tag} の丘の頂へ味方の退き口から登る道がない`);
        }
    });
    return out;
}

/**
 * 戦場のデータを検査する（問題の文の並び。空なら問題なし）：
 * - 広さ・退き口・配置の枠・援軍の地点・目標の区域の中心・敵の考えの地点が、戦場の中の通れる所にある
 * - 味方・敵の配置の枠から、それぞれの退き口へ道がある。味方が入る目標の区域・援軍の出現地点・敵の考えの地点へも、その陣営の退き口から道がある
 *   （崖・川で囲われた島に置いていない）
 * - 地形の決まりの速さ・倍率は 0 より大きい（川・崖の速さは見ない）、高所の数値・日没の秒数が正しい
 * - 地形の形が 1 つで正しい。橋は深い川を渡っている（両端の先が通れる岸）。丘・尾根の頂へ味方の退き口から登る道がある
 * - 編成ごとに：部隊の id が重ならない・陣営ごとの部隊数が上限（RULES.maxUnitsPerSide）以下・本陣が陣営に 1 つ以上・
 *   枠／援軍が有る・目標の指す部隊が有る（救出・部隊を残すは味方、崩すは敵の部隊）・武将（generalId）と能力（ability）が有る
 * - 目標の id が重ならない・援軍の目標の援軍が有る
 */
export function validateField(field: BattlefieldDef): string[] {
    const out: string[] = [];
    const map = fieldMap(field);
    const env = createFieldEnv(map, { ...(fieldRulesOf(field) ?? {}), pathfinding: true });
    const nav = env.nav!;
    const inside = (x: number, z: number) => Math.abs(x) <= field.width / 2 && Math.abs(z) <= field.depth / 2;
    const ok = (x: number, z: number) => inside(x, z) && isPassable(nav, x, z);
    /** その陣営の退き口から (x, z) へ道がある（退き口が通れない所にあるときは、そちらの問題として別に出す） */
    const fromExit = (side: Side, x: number, z: number) => {
        const e = field.exits[side];
        return !ok(e.x, e.z) || reachable(nav, 'yari', e.x, e.z, x, z);
    };
    if (!(field.width > 0 && field.depth > 0)) out.push('広さが正しくない');
    out.push(...validateRules(field));
    out.push(...validateTerrain(field, ok, fromExit));
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
        else if (!fromExit(r.side, r.point.x, r.point.z)) out.push(`援軍 ${r.id} の出現地点へ ${r.side} の退き口から道がない`);
    }
    const objs = [field.objectives.primary, ...field.objectives.secondary];
    const oids = new Set<string>();
    for (const o of objs) {
        if (oids.has(o.id)) out.push(`目標 ${o.id} が重なっている`);
        oids.add(o.id);
        for (const z of objectiveZones(o)) {
            const c = zoneCenter(z);
            if (!ok(c.x, c.z)) out.push(`目標 ${o.id} の区域の中心が通れる所にない`);
            else if (!inZone(z, c.x, c.z)) out.push(`目標 ${o.id} の区域が正しくない`);
            else if (allyZoneObjective(o) && !fromExit('ally', c.x, c.z)) out.push(`目標 ${o.id} の区域へ味方の退き口から道がない`);
        }
        if (o.type === 'hold_point' && !(o.sec > 0)) out.push(`目標 ${o.id} の確保の秒数は 0 より大きい数`);
        if (o.type === 'defend_time' && !(o.sec > 0)) out.push(`目標 ${o.id} の守る秒数は 0 より大きい数`);
        if (o.type === 'defend_zones') {
            if (!(o.sec > 0)) out.push(`目標 ${o.id} の守る秒数は 0 より大きい数`);
            if (o.zones.length === 0) out.push(`目標 ${o.id} の守る区域がない`);
            if (!(Number.isInteger(o.minHeld) && o.minHeld >= 1 && o.minHeld <= o.zones.length)) out.push(`目標 ${o.id} の minHeld は 1 以上・区域の数以下の整数`);
            if (o.names && o.names.length !== o.zones.length) out.push(`目標 ${o.id} の names の数が区域の数と違う`);
            if (o.loseSec !== undefined && !(o.loseSec > 0)) out.push(`目標 ${o.id} の loseSec は 0 より大きい数`);
        }
        if ((o.type === 'retreat_success' || o.type === 'preserve_unit') && !(o.minRatio > 0 && o.minRatio <= 1)) out.push(`目標 ${o.id} の minRatio は 0 より大きく 1 以下`);
        if (o.type === 'limit_losses' && !(o.maxRatio >= 0 && o.maxRatio < 1)) out.push(`目標 ${o.id} の maxRatio は 0 以上 1 未満`);
        if (o.type === 'breakthrough' && !(o.count >= 1)) out.push(`目標 ${o.id} の突破の部隊数は 1 以上`);
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
        out.push(...validatePreset(field, pr, objs, ok, fromExit));
    }
    return out;
}

function validatePreset(
    field: BattlefieldDef,
    pr: FieldPreset,
    objs: ObjectiveDef[],
    ok: (x: number, z: number) => boolean,
    fromExit: (side: Side, x: number, z: number) => boolean,
): string[] {
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
        else if (u.aiTarget && !fromExit(u.side, u.aiTarget.x, u.aiTarget.z)) out.push(`${tag}：部隊 ${u.id} の敵の考えの地点へ ${u.side} の退き口から道がない`);
        if (u.aiLeash !== undefined && !(Number.isFinite(u.aiLeash) && u.aiLeash >= 0)) out.push(`${tag}：部隊 ${u.id} の aiLeash は 0 以上の数`);
        if (u.generalId !== undefined && !generalById(u.generalId)) out.push(`${tag}：部隊 ${u.id} の武将 ${u.generalId} がいない（generals.ts）`);
        if (u.ability !== undefined && !(u.ability in ABILITY_DATA)) out.push(`${tag}：部隊 ${u.id} の能力 ${u.ability} がない（abilities.ts）`);
        if (u.arriveAt !== undefined && !(Number.isFinite(u.arriveAt) && u.arriveAt >= 0)) out.push(`${tag}：部隊 ${u.id} の arriveAt は 0 以上の数`);
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
        if (!('unitId' in o)) continue;
        const target = pr.units.find((u) => u.id === o.unitId);
        const want = objectiveUnitSide(o);
        if (!target) out.push(`${tag}：目標 ${o.id} の部隊 ${o.unitId} がない`);
        else if (want && target.side !== want) out.push(`${tag}：目標 ${o.id}（${o.type}）の部隊 ${o.unitId} は ${want} の部隊でなければならない`);
    }
    // 部隊の置き場所が戦場の高さの計算を壊していないか（数であること）
    for (const u of pr.units) {
        const d = u.slot ? field.deployments[u.side].find((x) => x.id === u.slot) : field.reinforcements?.find((r) => r.id === u.reinforcement)?.point;
        if (d && !Number.isFinite(elevationAt(fieldMap(field), d.x, d.z))) out.push(`${tag}：部隊 ${u.id} の地点の高さが数でない`);
    }
    return out;
}
