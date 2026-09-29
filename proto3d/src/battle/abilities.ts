/**
 * 武将固有の特殊能力（ゲーム用の創作。史実の人物が実際に持っていた能力ではない）。純粋な TypeScript（three・DOM なし）。
 * 設計：docs/ieyasu1570-design.md §4。効果量・範囲・時間・代償の数値は、このファイルの ABILITY_DATA 1 か所にまとめる。
 *
 * 共通の決まり：
 * - 各能力は 1 合戦 1 回。連打しても重ねて発動しない（2 回目からは断る）。
 * - 時間は合戦の時間（sim の時間 s.t）で数える。指揮中（一時停止）は stepBattle を呼ばないので減らない。
 * - 不適切な対象（敵・自分・範囲外・戦えない部隊）や、使えない時（まだ着いていない・敗走・撤退済み・全滅・合戦の後）は、
 *   断るだけで使用回数を減らさない。
 * - 全軍撤退の命令の後でも、戦場にいて戦える部隊なら使える（退路の守護で殿を務めるなど）。
 * - 武将（leaderId）のいない部隊は能力を持たない。敵方の武将の能力は敵の考え（ai.ts）だけが使う。
 *   プレイヤーの操作（useAbility）は味方の部隊の能力しか使えない。
 *
 * 画面から：
 *   abilityInfo(s, unitId)          … 能力名・対象・範囲・効果・代償・使えるか（理由）。能力のない部隊は null
 *   useAbility(s, unitId, targetId?) … プレイヤーが使う（一時停止中でもよい）。{ ok, reason }
 *   abilityMarks(s, unitId)          … いまその部隊に効いている能力の印（状態の表示用）
 * sim.ts（合戦の計算）から：abilityTakeMul・abilityDealMul・abilityMoraleLossMul・abilityRoutMorale・abilitySpeedMul・
 *   isRooted・updateAbilities（毎刻み）。能力がない合戦（架空の第一章）では、どれも 1（または元の値）を返すだけで計算は変わらない。
 *
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。小さな道具はここにも置く。
 */
import type { AbilityId, Side } from './types';
import type { BattleEvent, BattleState, UnitState } from './sim';

/** 対象の選び方：self_area＝その部隊を中心に範囲内へ効く（対象は選ばない）／ally_unit＝味方の部隊を 1 つ選ぶ */
export type AbilityTargetKind = 'self_area' | 'ally_unit';

/** 範囲内のどの部隊に効くか：all＝同じ陣営の戦える部隊（自分も）／retreating＝退いている味方（撤退の命令・敗走中。自分は除く）／target＝選んだ部隊 */
export type AbilityAreaFilter = 'all' | 'retreating' | 'target';

/** 能力のデータ（調整はここだけ） */
export interface AbilityData {
    id: AbilityId;
    /** 能力名 */
    name: string;
    /** 持つ部隊の呼び方（説明用） */
    holderName: string;
    target: AbilityTargetKind;
    /** 範囲（m）。self_area は効く半径、ally_unit は対象を選べる距離・支えが届く距離 */
    radius: number;
    /** 効果の時間（秒・合戦の時間） */
    durationSec: number;
    /** 使った瞬間、範囲内の同じ陣営の戦える部隊の士気 +（上限 100）。0 なら何もしない */
    moraleBoost: number;
    /** 範囲内（areaFilter）の部隊：受ける損害 ×、士気の低下 ×、敗走する士気の線（null なら変えない） */
    areaFilter: AbilityAreaFilter;
    areaTakeMul: number;
    areaMoraleLossMul: number;
    areaRoutMorale: number | null;
    /** 持つ部隊自身の代償：与える損害 ×、動きの速さ ×、受ける損害 × */
    selfDealMul: number;
    selfSpeedMul: number;
    selfTakeMul: number;
    /** 効果中は動けない（移動・攻撃・撤退の命令を受けない。全軍撤退も効果が終わってから） */
    rooted: boolean;
    /** 画面の説明（対象・効果・代償） */
    targetText: string;
    effectText: string;
    costText: string;
}

/** 画面に添える断り書き */
export const ABILITY_FICTION_NOTE = 'ゲーム用の創作の能力（史実の人物が実際に持っていた能力ではない）';

export const ABILITY_DATA: Record<AbilityId, AbilityData> = {
    ieyasu_rally: {
        id: 'ieyasu_rally',
        name: '立て直しの号令',
        holderName: '家康本陣',
        target: 'self_area',
        radius: 90,
        durationSec: 30,
        moraleBoost: 25,
        areaFilter: 'all',
        areaTakeMul: 1,
        areaMoraleLossMul: 0.6,
        areaRoutMorale: 8,
        selfDealMul: 0.5,
        selfSpeedMul: 0.5,
        selfTakeMul: 1,
        rooted: false,
        targetText: '家康本陣を中心に、半径 90 m の味方の部隊（使った後も本陣について動く）',
        effectText: '使った時に範囲内の味方の士気 +25（上限 100）。30 秒のあいだ、範囲内の味方の士気の低下 −40%、敗走しにくい（士気 15 → 8 まで持ちこたえる）',
        costText: '効果中、家康本陣の与える損害 ×0.5・動き ×0.5（守りを優先）。失った兵や戦えない部隊は戻らない',
    },
    tadakatsu_rearguard: {
        id: 'tadakatsu_rearguard',
        name: '退路の守護',
        holderName: '本多忠勝隊',
        target: 'self_area',
        radius: 70,
        durationSec: 40,
        moraleBoost: 0,
        areaFilter: 'retreating',
        areaTakeMul: 0.5,
        areaMoraleLossMul: 0.5,
        areaRoutMorale: null,
        selfDealMul: 1,
        selfSpeedMul: 0,
        selfTakeMul: 1.15,
        rooted: true,
        targetText: '忠勝隊の今の位置で踏みとどまる。半径 70 m で退いている味方（撤退の命令・敗走中）',
        effectText: '40 秒のあいだ、範囲内で退いている味方の受ける損害 −50%・士気の低下 −50%',
        costText: '効果中、忠勝隊は動けない（移動・攻撃・撤退の命令を受けない）。忠勝隊の受ける損害 ×1.15。無敵ではない（崩れれば効果も終わる）',
    },
    nagamasa_support: {
        id: 'nagamasa_support',
        name: '盟友への援護',
        holderName: '浅井長政隊',
        target: 'ally_unit',
        radius: 60,
        durationSec: 45,
        moraleBoost: 0,
        areaFilter: 'target',
        areaTakeMul: 0.7,
        areaMoraleLossMul: 0.6,
        areaRoutMorale: null,
        selfDealMul: 0.8,
        selfSpeedMul: 1,
        selfTakeMul: 1,
        rooted: false,
        targetText: '長政隊から 60 m 以内の、同じ陣営の味方の部隊を 1 つ選ぶ（長政隊自身は選べない）',
        effectText: '最大 45 秒。対象が長政隊から 60 m 以内にいる間だけ、対象の受ける損害 −30%・士気の低下 −40%。離れると外れ、戻れば再び効く（時間は減り続ける）',
        costText: '効果中、長政隊の与える損害 ×0.8',
    },
};

/** 合戦中の能力の状態（持つ部隊ごと。sim.ts の BattleState.abilities に入る） */
export interface AbilityRun {
    id: AbilityId;
    unitId: string;
    side: Side;
    /** 使った時刻（まだなら null） */
    usedAt: number | null;
    /** 効果が切れる時刻（使っていなければ 0） */
    until: number;
    /** 選んだ対象（ally_unit のとき） */
    targetId: string | null;
    /** 効果が終わった（時間切れ・持つ部隊が崩れた・対象が崩れた） */
    ended: boolean;
    /** 対象が範囲内にいて効いている（ally_unit。表示と「外れた・戻った」の知らせ用） */
    linked: boolean;
}

/** 合戦の始めに作る（能力を持ち、武将のいる部隊だけ） */
export function createAbilityRuns(units: readonly { id: string; side: Side; ability?: AbilityId; leaderId?: string }[]): Record<string, AbilityRun> {
    const out: Record<string, AbilityRun> = {};
    for (const u of units) {
        if (!u.ability || !u.leaderId || !ABILITY_DATA[u.ability]) continue;
        out[u.id] = { id: u.ability, unitId: u.id, side: u.side, usedAt: null, until: 0, targetId: null, ended: false, linked: false };
    }
    return out;
}

// ---- 小さな道具（sim.ts を実行時に import しないため） ----
function byId(s: BattleState, id: string | null | undefined): UnitState | undefined {
    return id ? s.units.find((u) => u.id === id) : undefined;
}
function active(u: UnitState | undefined): u is UnitState {
    return !!u && u.present && u.status === 'ready';
}
function d2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function r1(v: number): number {
    return Math.round(v * 10) / 10;
}
function retreating(u: UnitState): boolean {
    return u.present && (u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat'));
}
function pushEvent(s: BattleState, e: Omit<BattleEvent, 't'>): void {
    s.events.push({ t: r1(s.t), ...e });
}

/** 効果が続いている能力（使った・終わっていない・時間内・持つ部隊が戦える） */
function isLive(s: BattleState, r: AbilityRun): boolean {
    return r.usedAt !== null && !r.ended && s.t < r.until - 1e-9 && active(byId(s, r.unitId));
}
function liveRuns(s: BattleState): AbilityRun[] {
    const all = s.abilityList;
    if (all.length === 0) return all;
    return all.filter((r) => isLive(s, r));
}

// ---------------------------------------------------------------- 効果の問い合わせ（sim.ts が使う）

/** d が範囲の効果を受けるか（その能力の範囲・対象の決まりで） */
function inArea(r: AbilityRun, holder: UnitState, u: UnitState): boolean {
    const data = ABILITY_DATA[r.id];
    if (u.side !== r.side || !u.present) return false;
    switch (data.areaFilter) {
        case 'all':
            return u.status === 'ready' && d2(holder, u) <= data.radius;
        case 'retreating':
            return u !== holder && retreating(u) && d2(holder, u) <= data.radius;
        case 'target':
            return u.id === r.targetId && u.status === 'ready' && d2(holder, u) <= data.radius;
    }
}

/** d の受ける損害の倍率（能力がなければ 1） */
export function abilityTakeMul(s: BattleState, d: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const holder = byId(s, r.unitId);
        if (!holder) continue;
        const data = ABILITY_DATA[r.id];
        if (holder === d) m *= data.selfTakeMul;
        if (inArea(r, holder, d)) m *= data.areaTakeMul;
    }
    return m;
}

/** a の与える損害の倍率（能力がなければ 1） */
export function abilityDealMul(s: BattleState, a: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) if (r.unitId === a.id) m *= ABILITY_DATA[r.id].selfDealMul;
    return m;
}

/** u の士気の低下の倍率（範囲の効果が重なるときは、いちばん強い 1 つだけ効く。能力がなければ 1） */
export function abilityMoraleLossMul(s: BattleState, u: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) {
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) m = Math.min(m, ABILITY_DATA[r.id].areaMoraleLossMul);
    }
    return m;
}

/** u が敗走する士気の線（能力がなければ base） */
export function abilityRoutMorale(s: BattleState, u: UnitState, base: number): number {
    if (s.abilityList.length === 0) return base;
    let line = base;
    for (const r of liveRuns(s)) {
        const data = ABILITY_DATA[r.id];
        if (data.areaRoutMorale === null) continue;
        const holder = byId(s, r.unitId);
        if (holder && inArea(r, holder, u)) line = Math.min(line, data.areaRoutMorale);
    }
    return line;
}

/** u の動きの速さの倍率（能力がなければ 1） */
export function abilitySpeedMul(s: BattleState, u: UnitState): number {
    if (s.abilityList.length === 0) return 1;
    let m = 1;
    for (const r of liveRuns(s)) if (r.unitId === u.id) m *= ABILITY_DATA[r.id].selfSpeedMul;
    return m;
}

/** 効果中で動けない（退路の守護）。issueOrder が移動・攻撃・撤退の命令を断る */
export function isRooted(s: BattleState, unitId: string): boolean {
    const r = s.abilities[unitId];
    return !!r && ABILITY_DATA[r.id].rooted && isLive(s, r);
}

/**
 * 毎刻みの始めに sim.ts が呼ぶ：時間切れ・持つ部隊が戦えない・対象が戦えない、で効果を終える。援護の「外れた・戻った」を知らせる。
 * 全軍撤退の後に踏みとどまっていた部隊は、効果が終わったら撤退を始める。
 */
export function updateAbilities(s: BattleState): void {
    if (s.abilityList.length === 0) return;
    for (const r of s.abilityList) {
        if (r.usedAt === null || r.ended) continue;
        const holder = byId(s, r.unitId);
        const data = ABILITY_DATA[r.id];
        let why: string | null = null;
        if (!active(holder)) why = 'が崩れて';
        else if (s.t >= r.until - 1e-9) why = '';
        else if (data.target === 'ally_unit' && !active(byId(s, r.targetId))) why = '（対象が戦えなくなり）';
        if (why !== null) {
            r.ended = true;
            r.linked = false;
            const name = holder?.name ?? r.unitId;
            pushEvent(s, { kind: 'ability_end', text: why === 'が崩れて' ? `${name}が崩れて「${data.name}」が終わった` : `${name}の「${data.name}」が終わった${why}`, unitId: r.unitId });
            if (data.rooted && holder && active(holder) && holder.side === 'ally' && s.allRetreatAt !== null) {
                holder.order = { type: 'retreat' };
                holder.faceGoal = null;
            }
            continue;
        }
        if (data.target === 'ally_unit' && holder) {
            const tgt = byId(s, r.targetId)!;
            const linked = d2(holder, tgt) <= data.radius;
            if (linked !== r.linked) {
                r.linked = linked;
                pushEvent(s, {
                    kind: 'ability',
                    text: linked ? `${tgt.name}が${holder.name}の近くに戻り、援護がまた効く` : `${tgt.name}が${holder.name}から離れ、援護が外れた`,
                    unitId: r.unitId,
                    targetId: tgt.id,
                });
            }
        }
    }
}

// ---------------------------------------------------------------- 使う・調べる

export interface AbilityUseResult {
    ok: boolean;
    /** 使えなかった理由（使えたら null） */
    reason: string | null;
}

/** 使えない理由（使えるなら null）。対象を選ぶ能力は targetId も確かめる（checkTarget=false なら対象は見ない） */
function blockReason(s: BattleState, unitId: string, by: Side, targetId: string | undefined, checkTarget: boolean): string | null {
    const r = s.abilities[unitId];
    const u = byId(s, unitId);
    if (!r || !u) return 'この部隊には特殊能力がない';
    if (r.side !== by) return by === 'ally' ? '敵方の武将の能力は操作できない（敵の考えが使う）' : '相手方の能力は使えない';
    if (s.result) return '合戦は終わった';
    if (r.usedAt !== null) return isLive(s, r) ? 'いま効果中（この合戦では 1 回だけ）' : 'この合戦ではもう使った（1 合戦 1 回）';
    if (u.status === 'routed') return '敗走中の部隊は使えない';
    if (u.status === 'withdrawn') return '撤退済みの部隊は使えない';
    if (u.status === 'destroyed') return '全滅した部隊は使えない';
    if (!u.present) return 'まだ戦場に着いていない';
    const data = ABILITY_DATA[r.id];
    if (data.target !== 'ally_unit' || !checkTarget) return null;
    if (!targetId) return '援護する味方の部隊を選ぶ';
    const t = byId(s, targetId);
    if (!t) return '対象の部隊が見つからない';
    if (t === u) return `${u.name}自身は対象にできない`;
    if (t.side !== u.side) return '敵の部隊は対象にできない';
    if (!active(t)) return '戦えない部隊は対象にできない';
    const d = d2(u, t);
    if (d > data.radius) return `${t.name}は ${data.radius} m より離れている（今 ${Math.round(d)} m）`;
    return null;
}

/** 使う（中の処理。by はどちらの陣営として使うか） */
function activate(s: BattleState, unitId: string, targetId: string | undefined, by: Side): AbilityUseResult {
    const why = blockReason(s, unitId, by, targetId, true);
    if (why) return { ok: false, reason: why };
    const r = s.abilities[unitId]!;
    const u = byId(s, unitId)!;
    const data = ABILITY_DATA[r.id];
    r.usedAt = s.t;
    r.until = s.t + data.durationSec;
    r.targetId = data.target === 'ally_unit' ? targetId! : null;
    r.linked = data.target === 'ally_unit';
    if (data.moraleBoost > 0) {
        for (const o of s.units) {
            if (o.side !== u.side || !active(o) || d2(o, u) > data.radius) continue;
            o.morale = Math.min(100, o.morale + data.moraleBoost);
        }
    }
    if (data.rooted) {
        u.order = { type: 'hold' };
        u.faceGoal = null;
    }
    const tgt = byId(s, r.targetId);
    const text =
        r.id === 'ieyasu_rally'
            ? `${u.name}：「${data.name}」— 周りの味方が踏みとどまる（${data.durationSec} 秒）`
            : r.id === 'tadakatsu_rearguard'
              ? `${u.name}：「${data.name}」— その場で踏みとどまり、退く味方を守る（${data.durationSec} 秒）`
              : `${u.name}：「${data.name}」— ${tgt?.name ?? ''}を支える（${data.durationSec} 秒）`;
    pushEvent(s, { kind: 'ability', text, unitId, targetId: r.targetId ?? undefined });
    return { ok: true, reason: null };
}

/**
 * プレイヤーが能力を使う（一時停止中でもよい。効果の時間は合戦が進んだ分だけ減る）。
 * 味方の部隊の能力だけ。断るとき（敵方・合戦の後・もう使った・戦えない・対象が不適切・範囲外）は何も変えない。
 */
export function useAbility(s: BattleState, unitId: string, targetId?: string): AbilityUseResult {
    return activate(s, unitId, targetId, 'ally');
}

/** 敵の考え（ai.ts）が敵方の能力を使う窓口（sim.ts が AiApi に入れて渡す。画面からは使わない） */
export function enemyUseAbility(s: BattleState, unitId: string, targetId?: string): AbilityUseResult {
    return activate(s, unitId, targetId, 'enemy');
}

/** 画面に出す能力の説明と、使えるか */
export interface AbilityInfo {
    id: AbilityId;
    unitId: string;
    name: string;
    side: Side;
    /** プレイヤーが操作できる（味方の部隊の能力） */
    controllable: boolean;
    target: AbilityTargetKind;
    targetText: string;
    /** 範囲（m） */
    range: number;
    durationSec: number;
    effectText: string;
    costText: string;
    /** 断り書き（ゲーム用の創作） */
    note: string;
    /** いま使えるか（対象を選ぶ能力は、選べる対象が 1 つ以上あるとき）。使えなければ reason */
    usable: boolean;
    reason: string | null;
    /** unused：まだ使っていない／active：効果中／spent：使い終わった */
    state: 'unused' | 'active' | 'spent';
    /** 効果の残り秒（効果中だけ。それ以外は 0） */
    remainingSec: number;
    /** 援護の対象と、いま効いているか（ally_unit で使った後） */
    targetId: string | null;
    linked: boolean;
    /** いま選べる対象（ally_unit で使う前・使えるとき。近い順） */
    validTargets: string[];
}

/** 能力の説明（能力のない部隊は null）。viewer はプレイヤーの陣営（既定は味方） */
export function abilityInfo(s: BattleState, unitId: string, viewer: Side = 'ally'): AbilityInfo | null {
    const r = s.abilities[unitId];
    const u = byId(s, unitId);
    if (!r || !u) return null;
    const data = ABILITY_DATA[r.id];
    const live = isLive(s, r);
    let reason = blockReason(s, unitId, viewer, undefined, false);
    const validTargets: string[] = [];
    if (!reason && data.target === 'ally_unit') {
        const cands = s.units.filter((o) => o !== u && o.side === u.side && active(o) && d2(o, u) <= data.radius).sort((a, b) => d2(a, u) - d2(b, u));
        for (const o of cands) validTargets.push(o.id);
        if (validTargets.length === 0) reason = `${data.radius} m 以内に援護できる味方の部隊がいない`;
    }
    return {
        id: r.id,
        unitId,
        name: data.name,
        side: r.side,
        controllable: r.side === viewer,
        target: data.target,
        targetText: data.targetText,
        range: data.radius,
        durationSec: data.durationSec,
        effectText: data.effectText,
        costText: data.costText,
        note: ABILITY_FICTION_NOTE,
        usable: reason === null,
        reason,
        state: r.usedAt === null ? 'unused' : live ? 'active' : 'spent',
        remainingSec: live ? Math.max(0, r1(r.until - s.t)) : 0,
        targetId: r.targetId,
        linked: live && r.linked,
        validTargets,
    };
}

/** いまその部隊に効いている能力の印（例：「号令」「殿（踏みとどまる）」「殿の守り」「援護」）。状態の表示用 */
export function abilityMarks(s: BattleState, unitId: string): string[] {
    const u = byId(s, unitId);
    if (!u || s.abilityList.length === 0) return [];
    const out: string[] = [];
    for (const r of liveRuns(s)) {
        const holder = byId(s, r.unitId);
        if (!holder) continue;
        const inside = inArea(r, holder, u);
        if (r.id === 'ieyasu_rally') {
            if (holder === u) out.push('号令（守りを優先）');
            else if (inside) out.push('号令');
        } else if (r.id === 'tadakatsu_rearguard') {
            if (holder === u) out.push('踏みとどまる');
            else if (inside) out.push('退路の守り');
        } else {
            if (holder === u) out.push('援護中');
            else if (u.id === r.targetId) out.push(inside ? '援護' : '援護（離れて外れている）');
        }
    }
    return out;
}

/** 使った記録（部隊 id → 使った時刻）。BattleOutcome.abilitiesUsed に入れる */
export function abilitiesUsedRecord(s: BattleState): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of s.abilityList) if (r.usedAt !== null) out[r.unitId] = r1(r.usedAt);
    return out;
}
