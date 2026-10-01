/**
 * 敵の考え（純粋な TypeScript。乱数なし）。sim.ts の stepBattle が 0.5 秒ごとに呼ぶ。
 * 敵の部隊だけを動かす（味方の部隊は利用者の命令だけで動く。待機中に間合いの相手と斬り合うのは sim.ts の決まり）。
 * 敵は「敵から見えている味方」（seenBy.enemy）だけを相手に考える。林の中の味方は 60 m 以内に来るまで気づかない。
 *
 * 役割（UnitDef.aiRole。省けば本陣は guard_hq。ほかは、率いる武将（generalId）がいればその AI の基本方針（generals.ts の aiPolicy）から
 * 決め（defaultAiRole：攻めかかる＝相手の本陣へ assault・持ち場を保つ＝hold_line・慎重に守る＝guard_hq・味方を支える＝reserve）、
 * いなければ hold_line。Version 11 の部隊は generalId を持たないので今までどおり）：
 * - hold_line：持ち場（最初の位置）を守る。持ち場の 75 m 以内に来た見えている味方が、
 *   ほかの部隊へ向かう・横を通るなら打って出て迎え撃つ（自分へ向かって来る相手は、持ち場で待ち構える）。
 *   持ち場から 120 m より離れた相手は追わず、持ち場へ戻る。矢を 12 秒以上浴び、持ち場の 90 m 以内に相手の槍・騎馬・本陣がいなければ、射手へ打って出る（誘い出せる）。
 *   弓隊は持ち場を動かず、届く相手を射る。
 * - reserve：味方（敵方）の部隊が崩れた・士気が落ちた・本陣が攻められた・本陣へ近づく相手が見えた、のどれかで動き出し、
 *   本陣を攻めている相手 → 押されている味方の相手 → 本陣に近い相手 の順に向かう。
 * - flank：着いてから 30 秒待ち、自分の側（東なら東、西なら西）を真っすぐ南へ下って相手の横へ出てから、
 *   斬り合っている部隊・弓・本陣・こちらを向いていない部隊を選んで横から当たる。途中で近くに相手が見えたらすぐ当たる。
 * - guard_hq：本陣を守る。本陣そのものは持ち場を動かない。本陣以外なら、本陣の 80 m 以内に来た相手を迎え撃つ。
 * - hold_zone（データ駆動の戦場）：aiTarget の区域（省けば最初の位置・半径 60 m）を守る。区域（＋10 m）に入ってきた見えている相手に当たり、
 *   区域から 60 m より離れた相手は追わずに持ち場（区域の中の最初の位置。外にいれば区域の中心）へ戻る。弓隊は持ち場を動かず、届く相手を射る。
 * - 追う距離の上限（UnitDef.aiLeash。データで部隊ごとに変える。省けば上の既定）：hold_line は持ち場から（打って出る相手も、その距離が
 *   75 m より短ければその中だけ。矢を嫌って射手へ打って出たときは今までどおり 120 m まで追う）、hold_zone・assault（着いて守る間）は区域の縁から。
 *   例：橋の北の口で待ち構えさせる（hold_line・短く）、狭い口の塞ぎを誘い出せるようにする（hold_zone・長く）。
 * - assault（データ駆動の戦場）：aiTarget の地点へ攻め進む。途中で 60 m 以内に見えている相手がいれば当たる（弓隊は届く相手がいれば止まって射る）。
 *   着いたら、その区域を hold_zone と同じように守る。
 * 動く命令は sim.ts が道探し（通れない所がある戦場だけ）でたどるので、ここは行き先を決めるだけ。
 * 射線（第3群）：弓の相手は、射線が建物・石垣・閉じた門に遮られない相手だけ（待機の弓は sim.ts の相手選び、攻め進む弓はここで見る）。
 *
 * 特殊能力（abilities.ts。敵方に能力を持つ武将がいるときだけ。プレイヤーは敵の能力を操作できない）：
 * - 盟友への援護：範囲（60 m）の中で斬り合っている・矢を浴びて士気の落ちた味方（敵方）の部隊があれば、士気のいちばん低い部隊を支える。
 *   （A の方針の浅井長政隊は、丘の前で持ち場を守る浅井先手が交戦すると支える）
 * - 立て直しの号令：範囲の中の戦える味方（敵方）が 2 部隊以上で士気 50 未満、または本陣自身が 45 未満になったら使う。
 * - 退路の守護：範囲の中で味方（敵方）が敗走・撤退しているとき、自分が斬り合っていなければ使う。
 * - 仮の能力（新しい武将。敵方が持つとき）：
 *   両翼の采配＝範囲の中で斬り合っている味方（敵方。自分も）が 2 部隊以上／後詰めの差配＝範囲の中に味方（敵方）が 2 部隊以上いて、
 *   斬り合っている味方があれば、士気のいちばん低い部隊を対象にする／先駆けの号＝自分が斬り合っていて、士気が 40 以上（切れたときの士気 −15 で崩れないうち）。
 *
 * 武将の基本方針（thinkGenerals。BattleSetup.generalInitiative の合戦＝演習の戦場だけ。docs/troops-abilities-design.md §3）：
 * 味方の武将の部隊（generals.ts の initiative を持つ武将。家康本陣・長政隊は持たない）は、命令を受けていない待機中
 * （最初の待機・移動の命令で着いた後。攻撃の相手が崩れた後の待機は含めない）だけ、持ち場から INITIATIVE.leash m 以内で方針ごとに動き、することが無ければ持ち場へ戻る。
 * 移動・攻撃・撤退・防衛のどの命令も優先する（命令を受けたら自由な動きをやめる。防衛・待機を命じた部隊は持ち場から動かない）。
 * 斬り合いの最中・能力で動けない間・全軍撤退の後は動かさない。重要な作戦（敵の本陣へ攻め込む・退く）は決めない。
 * - coordinate（酒井）：隣（60 m 以内）の味方に斬りかかっている敵に、横・背後から当たれる位置にいれば当たる。
 * - support（石川）：士気の落ちた（40 未満）・援軍・同盟の味方が攻められていれば、その近く（持ち場の側 30 m 手前）へ寄って構える。
 *   自分から斬りかかりはしない（間合いに入った相手とは、待機の決まりで斬り合う）。
 * - rearguard（忠勝）：持ち場を保つ。近く（80 m）で撤退の命令で退く味方がいれば、その味方と追っ手の間へ入る（殿。敗走した部隊は見ない）。
 * - pursuit（榊原）：近く（80 m）の退く敵・弓隊を追う。
 *
 * 引きつけ（退路の守護の効果中だけ。どの合戦でも）：範囲の中で退く味方（撤退の命令・敗走中）を攻める・斬っている敵（弓・本陣を除く）は、
 * 守護の持ち主（忠勝隊）へ向かう。
 *
 * 追い討ち（BattleSetup.pursuit の合戦＝歴史分岐だけ。架空の第一章では何もしない）：
 * - 弓・本陣以外の部隊は、近く（騎馬 110 m・ほか 60 m）で撤退の命令で退いている見えている味方へ追い討ちをかける
 *   （hold_line は持ち場から 120 m、guard_hq は本陣から 110 m の中だけ。reserve は動き出してから）。
 * - その味方が「退路の守護」の範囲の中にいれば、追う代わりに守護の持ち主（忠勝隊）へ向かう（追っ手を阻む）。
 */
import type { Order, UnitDef } from './types';
import { ABILITY_DATA, abilityInfo, lureLive, rearguardCover } from './abilities';
import { generalById, type GeneralAiPolicy, type GeneralInitiative } from './generals';
import { lineOfSight } from './fieldRules';
import type { BattleState, UnitState } from './sim';

export type AiRole = NonNullable<UnitDef['aiRole']>;

/** 武将の AI の基本方針 → aiRole を省いた部隊の既定の役割 */
export const AI_POLICY_ROLE: Readonly<Record<GeneralAiPolicy, AiRole>> = {
    aggressive: 'assault',
    steady: 'hold_line',
    cautious: 'guard_hq',
    support: 'reserve',
};

/** aiRole を省いた部隊の役割（本陣は guard_hq。率いる武将がいれば、その AI の基本方針から。いなければ hold_line） */
export function defaultAiRole(u: Pick<UnitDef, 'kind' | 'generalId'>): AiRole {
    if (u.kind === 'honjin') return 'guard_hq';
    const g = u.generalId ? generalById(u.generalId) : undefined;
    return g ? AI_POLICY_ROLE[g.aiPolicy] : 'hold_line';
}

export const AI = {
    /** hold_line：持ち場からこの距離に来た相手を見る */
    holdEngage: 75,
    /** hold_line：持ち場からこれより離れた相手は追わない */
    holdLeash: 120,
    /** 矢を浴び続けて打って出るまでの秒数・射手までの距離の上限（持ち場から）。
     *  持ち場から provokeCalm 以内に、見えている相手の槍・騎馬・本陣がいるときは、持ち場を離れない */
    provokeSec: 12,
    provokeRange: 160,
    provokeCalm: 90,
    /** guard_hq：本陣からこの距離の相手を迎え撃つ・これより離れたら戻る */
    guardRadius: 80,
    guardLeash: 110,
    /** reserve：本陣へこの距離まで近づいた相手が見えたら動く */
    reserveAlarm: 60,
    /** reserve：味方（敵方）の士気がこれより下がったら動く */
    reserveMorale: 50,
    /** flank：着いてから動き出すまでの秒数 */
    flankDelay: 30,
    /** flank：回り込む途中、この距離に相手が見えたらすぐ当たる */
    flankStrike: 60,
    /** 追い討ち（BattleSetup.pursuit の合戦だけ）：退いている相手を追い始める距離（騎馬・ほか） */
    pursuitRangeKiba: 110,
    pursuitRange: 60,
    /** hold_zone・assault：aiTarget の半径の既定・区域の外のこの距離までに入った相手に当たる・これより離れた相手は追わない */
    zoneRadius: 60,
    zoneEngage: 10,
    zoneLeash: 60,
    /** assault：攻め進む途中、この距離に見えている相手がいれば当たる・攻撃中の相手がこれより離れたらあきらめる */
    assaultStrike: 60,
    assaultLeash: 120,
    /** assault の弓隊：この距離に見えている相手がいれば止まって射る */
    assaultShoot: 110,
} as const;

export interface AiMemo {
    role: AiRole;
    homeX: number;
    homeZ: number;
    homeFacing: number;
    /** reserve：動き出したか。flank：'wait' → 'approach' → 'strike'。assault：'approach'（攻め進む）→ 'active'（着いて守る） */
    phase: 'idle' | 'active' | 'wait' | 'approach' | 'strike';
    /** 矢を浴びている時間（秒） */
    arrowSec: number;
    waypoint: { x: number; z: number } | null;
    /** hold_zone・assault の区域（aiTarget。省けば最初の位置・半径 AI.zoneRadius） */
    zone: { x: number; z: number; r: number } | null;
    /** hold_line：矢を嫌って打って出た相手（その相手だけは AI.holdLeash まで追う。aiLeash の短い部隊でも誘い出せる） */
    provokedId?: string | null;
}

export interface AiState {
    memo: Record<string, AiMemo>;
}

/** 敵の考えが使う、合戦への窓口（sim.ts が渡す） */
export interface AiApi {
    issue(unitId: string, order: Order): boolean;
    /** 知らせ（見えている部隊の動きだけを知らせる） */
    log(text: string, unitId: string): void;
    /** 敵方の部隊の特殊能力を使う（使えたら true。断られたら使用回数は減らない）。sim.ts が渡す */
    useAbility?(unitId: string, targetId?: string): boolean;
}

/** 敵の考えが能力を使う目安 */
export const AI_ABILITY = {
    /** 援護：この士気より低い、または斬り合っている部隊を支える */
    supportMorale: 70,
    /** 号令：範囲の中でこの士気より低い部隊が 2 つ以上、または本陣自身がこれより低い */
    rallyMorale: 50,
    rallySelfMorale: 45,
    /** 両翼の采配：範囲の中で斬り合っている部隊（自分も）がこの数以上 */
    flankEngaged: 2,
    /** 後詰めの差配：範囲の中の味方（自分を除く）がこの数以上 */
    reserveFriends: 2,
    /** 先駆けの号：自分の士気がこれ以上 */
    vanguardMorale: 40,
} as const;


/** 武将の自由な動きの数値 */
export const INITIATIVE = {
    /** 持ち場からこの距離（m）より離れない */
    leash: 40,
    /** 攻撃は相手の手前（RULES.meleeRange × 0.8 = 20 m）で止まるので、相手が持ち場から leash + reach 以内なら当たりに行ける */
    reach: 20,
    /** 持ち場からこの距離（m）より離れていたら戻る */
    homeSlack: 4,
    /** coordinate：隣の味方とみなす距離 */
    coordinateRadius: 60,
    /** support：支える味方の士気の線・持ち場から見る距離 */
    supportMorale: 40,
    supportRange: 120,
    /** rearguard：退く味方を見る距離（持ち場から）・味方から追っ手の側へ入る距離 */
    rearguardRange: 80,
    rearguardGap: 22,
    /** pursuit：追う相手を見る距離（自分から） */
    pursuitRange: 80,
} as const;

/** 武将の自由な動きの状態（sim.ts の UnitState.initiative） */
export interface InitiativeMemo {
    policy: GeneralInitiative;
    /** 持ち場（最初の位置、またはプレイヤーの移動の命令で着いた所）と、そこでの向き */
    postX: number;
    postZ: number;
    postFacing: number;
    /** 命令を受けていない待機中（自由に動ける）。プレイヤーの命令を受けると false、その命令が終わって待機になると true */
    free: boolean;
    /** いまの命令は自由な動きが出したもの（プレイヤーの命令を受けると false） */
    acting: boolean;
    /** 最後に知らせた動き（同じ動きを繰り返し知らせないため） */
    noted: string | null;
}

/** 合戦の始めに、方針を持つ武将の味方の部隊（本陣を除く）の自由な動きの状態を作る（無ければ null） */
export function createInitiative(u: Pick<UnitState, 'side' | 'kind' | 'generalId' | 'x' | 'z' | 'facing' | 'order'>): InitiativeMemo | null {
    if (u.side !== 'ally' || u.kind === 'honjin' || !u.generalId) return null;
    const g = generalById(u.generalId);
    if (!g?.initiative) return null;
    return { policy: g.initiative, postX: u.x, postZ: u.z, postFacing: u.facing, free: u.order.type === 'hold', acting: false, noted: null };
}

export function createAiState(units: readonly UnitState[]): AiState {
    const memo: Record<string, AiMemo> = {};
    for (const u of units) {
        if (u.side !== 'enemy') continue;
        const role: AiRole = u.aiRole ?? defaultAiRole(u);
        const zoned = role === 'hold_zone' || role === 'assault';
        // 攻め進む先を省いた assault（攻めかかる方針の武将）は、相手の本陣の最初の位置へ攻め進む
        const foeHq = !u.aiTarget && role === 'assault' ? units.find((o) => o.side !== u.side && o.isHq) : undefined;
        const zone = zoned ? { x: u.aiTarget?.x ?? foeHq?.x ?? u.x, z: u.aiTarget?.z ?? foeHq?.z ?? u.z, r: u.aiTarget?.r ?? AI.zoneRadius } : null;
        // hold_zone の持ち場：最初の位置が区域の中ならそこ、外なら区域の中心
        const outside = role === 'hold_zone' && zone && Math.hypot(u.x - zone.x, u.z - zone.z) > zone.r;
        memo[u.id] = {
            role,
            homeX: outside ? zone!.x : u.x,
            homeZ: outside ? zone!.z : u.z,
            homeFacing: u.facing,
            phase: role === 'flank' ? 'wait' : role === 'assault' ? 'approach' : 'idle',
            arrowSec: 0,
            waypoint: null,
            zone,
        };
    }
    return { memo };
}

// ---- 小さな道具（sim.ts を実行時に import しないため、ここにも置く） ----
function d2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function active(u: UnitState | undefined): u is UnitState {
    return !!u && u.present && u.status === 'ready';
}
function byId(s: BattleState, id: string | null | undefined): UnitState | undefined {
    return id ? s.units.find((u) => u.id === id) : undefined;
}
/** 敵から見えている、戦える味方 */
function visibleAllies(s: BattleState): UnitState[] {
    return s.units.filter((u) => u.side === 'ally' && active(u) && u.seenBy.enemy);
}
function home(m: AiMemo): { x: number; z: number } {
    return { x: m.homeX, z: m.homeZ };
}
/** hold_line：持ち場からこの距離より離れた相手は追わない（aiLeash。省けば AI.holdLeash） */
function holdLeashOf(u: UnitState): number {
    return u.aiLeash ?? AI.holdLeash;
}
/** hold_zone・assault：区域の縁からこの距離より離れた相手は追わない（aiLeash。省けば AI.zoneLeash） */
function zoneLeashOf(u: UnitState): number {
    return u.aiLeash ?? AI.zoneLeash;
}
/** 相手 o が、u の方を向いている（u が o の正面 ±50° にいる） */
function facesMe(o: UnitState, u: UnitState): boolean {
    const h = Math.atan2(u.x - o.x, -(u.z - o.z));
    let d = (h - o.facing) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) <= (50 * Math.PI) / 180;
}
function attackTarget(s: BattleState, u: UnitState): UnitState | undefined {
    return u.order.type === 'attack' ? byId(s, u.order.targetId) : undefined;
}
function goHome(api: AiApi, u: UnitState, m: AiMemo): void {
    // 少し押されただけなら戻らない（持ち場の 10 m 以内）
    if (d2(u, home(m)) <= 10) {
        if (u.order.type !== 'hold') api.issue(u.id, { type: 'hold' });
        return;
    }
    if (u.order.type === 'move' && Math.abs(u.order.x - m.homeX) < 0.5 && Math.abs(u.order.z - m.homeZ) < 0.5) return;
    api.issue(u.id, { type: 'move', x: m.homeX, z: m.homeZ, face: m.homeFacing });
}
function attack(s: BattleState, api: AiApi, u: UnitState, t: UnitState, text?: string): void {
    if (attackTarget(s, u) === t) return;
    if (api.issue(u.id, { type: 'attack', targetId: t.id }) && text && u.seenBy.ally) api.log(text, u.id);
}

/** 敵の部隊に命令を出す（0.5 秒ごと） */
export function thinkEnemy(s: BattleState, api: AiApi): void {
    if (api.useAbility && s.abilityList.length > 0) enemyAbilities(s, api);
    const luring = lureLive(s);
    for (const u of s.units) {
        const m = s.ai.memo[u.id];
        if (!m || !active(u)) continue;
        // 矢を浴びている時間
        if (s.t - u.lastArrowT < 0.6) m.arrowSec += 0.5;
        else m.arrowSec = Math.max(0, m.arrowSec - 0.25);
        if (s.setup.pursuit && pursue(s, api, u, m)) continue;
        if (luring && lured(s, api, u)) continue;
        switch (m.role) {
            case 'hold_line':
                holdLine(s, api, u, m);
                break;
            case 'guard_hq':
                guardHq(s, api, u, m);
                break;
            case 'reserve':
                reserve(s, api, u, m);
                break;
            case 'flank':
                flank(s, api, u, m);
                break;
            case 'hold_zone':
                holdZone(s, api, u, m);
                break;
            case 'assault':
                assault(s, api, u, m);
                break;
        }
    }
}

/** 撤退の命令で退いている、敵から見えている味方 */
function retreatingAlly(o: UnitState): boolean {
    return o.side === 'ally' && active(o) && o.order.type === 'retreat' && o.seenBy.enemy;
}

/** 追い討ちで追ってよいか（役割ごとの持ち場の縛り） */
function mayChase(s: BattleState, u: UnitState, m: AiMemo, o: UnitState): boolean {
    switch (m.role) {
        case 'hold_line':
            return d2(o, home(m)) <= holdLeashOf(u);
        case 'guard_hq': {
            const hq = s.units.find((x) => x.side === u.side && x.isHq);
            return d2(o, hq && active(hq) ? hq : home(m)) <= AI.guardLeash;
        }
        case 'reserve':
            return m.phase === 'active';
        case 'flank':
        case 'assault':
            return true;
        case 'hold_zone':
            return d2(o, m.zone!) <= m.zone!.r + zoneLeashOf(u);
    }
}

/**
 * 追い討ち（BattleSetup.pursuit の合戦だけ）。この部隊の命令を決めたら true（役割の考えは飛ばす）。
 * 退路の守護に守られた味方は追わず、守護の持ち主へ向かう。
 */
function pursue(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): boolean {
    if (u.kind === 'yumi' || u.isHq) return false;
    const cur = attackTarget(s, u);
    if (cur && retreatingAlly(cur)) {
        const guard = rearguardCover(s, cur);
        if (guard && guard.seenBy.enemy) {
            attack(s, api, u, guard, `${u.name}の追い討ちを${guard.name}が阻む`);
            return true;
        }
        return mayChase(s, u, m, cur);
    }
    if (u.engagedWith) return false;
    const range = u.kind === 'kiba' ? AI.pursuitRangeKiba : AI.pursuitRange;
    const cands = s.units.filter((o) => retreatingAlly(o) && d2(o, u) <= range && mayChase(s, u, m, o)).sort((a, b) => d2(a, u) - d2(b, u));
    for (const o of cands) {
        const guard = rearguardCover(s, o);
        if (guard) {
            if (!guard.seenBy.enemy) continue;
            attack(s, api, u, guard, `${u.name}の追い討ちを${guard.name}が阻む`);
            return true;
        }
        attack(s, api, u, o, `${u.name}が退く${o.name}へ追い討ちをかける`);
        return true;
    }
    return false;
}

/**
 * 引きつけ（退路の守護の効果中だけ）：退く味方（撤退の命令・敗走中）を攻める・斬っている敵は、その味方を守る守護の持ち主へ向かう。
 * 向かわせたら true（役割の考えは飛ばす）。弓・本陣は引きつけない
 */
function lured(s: BattleState, api: AiApi, u: UnitState): boolean {
    if (u.kind === 'yumi' || u.isHq) return false;
    const prey = attackTarget(s, u) ?? byId(s, u.engagedWith);
    if (!prey || prey.side !== 'ally' || !prey.present || !(prey.status === 'routed' || (prey.status === 'ready' && prey.order.type === 'retreat'))) return false;
    const guard = rearguardCover(s, prey);
    if (!guard || guard === prey || !guard.seenBy.enemy) return false;
    attack(s, api, u, guard, `${u.name}が${guard.name}に引きつけられた`);
    return attackTarget(s, u) === guard;
}

function holdLine(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return; // 斬り合いの最中は、その場で戦う
    if (u.kind === 'yumi') {
        if (u.order.type !== 'move' || d2(u, home(m)) <= 10) goHome(api, u, m);
        return;
    }
    const cur = attackTarget(s, u);
    if (cur) {
        // 矢を嫌って打って出た射手は、aiLeash が短くても AI.holdLeash まで追う（弓の陽動で誘い出せる）
        const leash = cur.id === m.provokedId ? Math.max(AI.holdLeash, holdLeashOf(u)) : holdLeashOf(u);
        if (active(cur) && cur.seenBy.enemy && d2(cur, home(m)) <= leash) return;
        m.provokedId = null;
        goHome(api, u, m);
        return;
    }
    m.provokedId = null;
    // 矢を浴び続けたら、射手へ打って出る
    if (m.arrowSec >= AI.provokeSec) {
        const sh = byId(s, u.lastShooterId);
        const calm = visibleAllies(s).some((o) => o.kind !== 'yumi' && d2(o, home(m)) <= AI.provokeCalm);
        if (!calm && active(sh) && sh.seenBy.enemy && d2(sh, home(m)) <= AI.provokeRange) {
            m.arrowSec = 0;
            attack(s, api, u, sh, `${u.name}が矢を嫌って打って出た`);
            if (attackTarget(s, u) === sh) m.provokedId = sh.id;
            return;
        }
    }
    const engage = Math.min(AI.holdEngage, holdLeashOf(u));
    const threats = visibleAllies(s)
        .filter((o) => d2(o, home(m)) <= engage)
        .sort((a, b) => d2(a, home(m)) - d2(b, home(m)));
    for (const o of threats) {
        if (attackTarget(s, o) === u) continue; // こちらへ来る相手は、持ち場で待ち構える
        attack(s, api, u, o, `${u.name}が打って出た`);
        return;
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function guardHq(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    if (u.isHq) {
        if (u.order.type !== 'move') goHome(api, u, m);
        return;
    }
    const hq = s.units.find((o) => o.side === u.side && o.isHq);
    const center = hq && active(hq) ? hq : home(m);
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy && d2(cur, center) <= AI.guardLeash) return;
    const threats = visibleAllies(s)
        .filter((o) => d2(o, center) <= AI.guardRadius)
        .sort((a, b) => d2(a, center) - d2(b, center));
    if (threats.length) {
        attack(s, api, u, threats[0], `${u.name}が本陣を守りに出た`);
        return;
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function reserve(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    const hq = s.units.find((o) => o.side === u.side && o.isHq);
    const friends = s.units.filter((o) => o.side === u.side && o !== u);
    if (m.phase === 'idle') {
        const broken = friends.some((o) => !o.isHq && o.arrived && (o.status === 'routed' || o.status === 'destroyed'));
        const shaken = friends.some((o) => active(o) && o.engagedWith && o.morale < AI.reserveMorale);
        const hqPressed = !!hq && active(hq) && (hq.attackers.length > 0 || !!hq.engagedWith);
        const near = !!hq && visibleAllies(s).some((o) => d2(o, hq) <= AI.reserveAlarm);
        if (!(broken || shaken || hqPressed || near)) return;
        m.phase = 'active';
        if (u.seenBy.ally) api.log(`${u.name}が動いた`, u.id);
    }
    if (u.engagedWith) return;
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy) return;
    const allies = visibleAllies(s);
    // 1. 本陣を攻めている相手
    if (hq && active(hq)) {
        const onHq = allies.filter((o) => hq.attackers.includes(o.id)).sort((a, b) => d2(a, u) - d2(b, u));
        if (onHq.length) return attack(s, api, u, onHq[0]);
    }
    // 2. 押されている味方（敵方）の相手
    const pressed = friends
        .filter((o) => active(o) && o.engagedWith && o.morale < 60)
        .sort((a, b) => a.morale - b.morale);
    for (const f of pressed) {
        const foe = byId(s, f.engagedWith);
        if (active(foe) && foe.seenBy.enemy) return attack(s, api, u, foe);
    }
    // 3. 本陣に近い相手
    if (hq) {
        const near = allies.filter((o) => d2(o, hq) <= 160).sort((a, b) => d2(a, hq) - d2(b, hq));
        if (near.length) return attack(s, api, u, near[0]);
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function flank(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    const allies = visibleAllies(s);
    const close = allies.some((o) => d2(o, u) <= AI.flankStrike);
    if (m.phase === 'wait') {
        if (close) m.phase = 'strike';
        else if (s.t >= u.arriveAt + AI.flankDelay) {
            m.phase = 'approach';
            const zs = allies.map((o) => o.z);
            const lineZ = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : s.map.exits.ally.z - 100;
            m.waypoint = { x: m.homeX, z: lineZ };
            api.issue(u.id, { type: 'move', x: m.waypoint.x, z: m.waypoint.z });
            // 通れない所へは sim.ts が近くの通れる所へ寄せる：寄せた先を回り込みの点にする（通れない所の無い戦場では同じ点）
            if (u.order.type === 'move' && (u.order.x !== m.waypoint.x || u.order.z !== m.waypoint.z)) m.waypoint = { x: u.order.x, z: u.order.z };
            if (u.seenBy.ally) api.log(`${u.name}が回り込んでくる`, u.id);
            return;
        } else return;
    }
    if (m.phase === 'approach') {
        const wp = m.waypoint!;
        if (!close && d2(u, wp) > 20) {
            if (u.order.type !== 'move') api.issue(u.id, { type: 'move', x: wp.x, z: wp.z });
            return;
        }
        m.phase = 'strike';
    }
    // strike：横から当たる相手を選ぶ
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy) return;
    let best: UnitState | null = null;
    let bestScore = Infinity;
    for (const o of allies) {
        let score = d2(o, u);
        if (o.engagedWith) score -= 40;
        if (o.kind === 'yumi') score -= 25;
        if (o.kind === 'honjin') score -= 20;
        if (facesMe(o, u)) score += 30;
        if (u.kind === 'kiba' && o.kind === 'yari' && facesMe(o, u)) score += 40;
        if (score < bestScore) {
            bestScore = score;
            best = o;
        }
    }
    if (best) attack(s, api, u, best, `${u.name}が${best.name}へ横から迫る`);
    else if (u.order.type !== 'move') goHome(api, u, m);
}

/** 区域（中心と半径）を守る：区域に入ってきた見えている相手に当たる。離れすぎた相手は追わない */
function guardZone(s: BattleState, api: AiApi, u: UnitState, m: AiMemo, backHome: () => void): void {
    const Z = m.zone!;
    const cur = attackTarget(s, u);
    if (cur) {
        if (active(cur) && cur.seenBy.enemy && d2(cur, Z) <= Z.r + zoneLeashOf(u)) return;
        backHome();
        return;
    }
    const threats = visibleAllies(s)
        .filter((o) => d2(o, Z) <= Z.r + AI.zoneEngage)
        .sort((a, b) => d2(a, Z) - d2(b, Z) || d2(a, u) - d2(b, u));
    if (threats.length) {
        attack(s, api, u, threats[0]!, `${u.name}が守りの区域に入った${threats[0]!.name}へ当たる`);
        return;
    }
    if (u.order.type !== 'move') backHome();
}

function holdZone(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    if (u.kind === 'yumi') {
        if (u.order.type !== 'move' || d2(u, home(m)) <= 10) goHome(api, u, m);
        return;
    }
    guardZone(s, api, u, m, () => goHome(api, u, m));
}

function assault(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    const Z = m.zone!;
    const allies = visibleAllies(s);
    if (u.kind === 'yumi') {
        // 届く相手がいれば止まって射る（待機の弓はいちばん近い相手を射る）。いなければ地点へ進む。
        // 射線が建物・石垣・閉じた門に遮られる相手は「届く相手」に数えない（第3群。射線の格子の無い戦場では見ない）
        if (allies.some((o) => d2(o, u) <= AI.assaultShoot && (!s.field.los || lineOfSight(s.map, s.field, u, o)))) {
            if (u.order.type !== 'hold') api.issue(u.id, { type: 'hold' });
            return;
        }
        if (d2(u, Z) > Z.r * 0.5) {
            if (!(u.order.type === 'move' && Math.abs(u.order.x - Z.x) < 6 && Math.abs(u.order.z - Z.z) < 6)) api.issue(u.id, { type: 'move', x: Z.x, z: Z.z });
        } else if (u.order.type !== 'hold' && u.order.type !== 'move') api.issue(u.id, { type: 'hold' });
        return;
    }
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy && d2(cur, u) <= AI.assaultLeash) return;
    if (m.phase === 'approach') {
        const near = allies.filter((o) => d2(o, u) <= AI.assaultStrike).sort((a, b) => d2(a, u) - d2(b, u));
        if (near.length) {
            attack(s, api, u, near[0]!, `${u.name}が${near[0]!.name}へ襲いかかった`);
            return;
        }
        if (d2(u, Z) > Z.r * 0.5) {
            if (!(u.order.type === 'move' && Math.abs(u.order.x - Z.x) < 6 && Math.abs(u.order.z - Z.z) < 6)) api.issue(u.id, { type: 'move', x: Z.x, z: Z.z });
            return;
        }
        m.phase = 'active';
        m.homeX = u.x;
        m.homeZ = u.z;
    }
    guardZone(s, api, u, m, () => goHome(api, u, m));
}

/** 敵方の武将の能力を、目安に合えば使う（1 合戦 1 回。使えるかの確かめは abilities.ts が行う） */
function enemyAbilities(s: BattleState, api: AiApi): void {
    for (const r of s.abilityList) {
        if (r.side !== 'enemy' || r.usedAt !== null) continue;
        const u = byId(s, r.unitId);
        if (!active(u)) continue;
        const R = ABILITY_DATA[r.id].radius;
        const friends = s.units.filter((o) => o !== u && o.side === 'enemy' && active(o) && d2(o, u) <= R);
        if (r.id === 'nagamasa_support') {
            const need = friends
                .filter((o) => !!o.engagedWith || (o.attackers.length > 0 && o.morale < AI_ABILITY.supportMorale))
                .sort((a, b) => a.morale - b.morale || d2(a, u) - d2(b, u));
            if (need.length && api.useAbility!(u.id, need[0].id) && u.seenBy.ally) api.log(`${u.name}が${need[0].name}を支えに入った`, u.id);
        } else if (r.id === 'ieyasu_rally') {
            const low = [u, ...friends].filter((o) => o.morale < AI_ABILITY.rallyMorale).length;
            if (low >= 2 || u.morale < AI_ABILITY.rallySelfMorale) api.useAbility!(u.id);
        } else if (r.id === 'tadakatsu_rearguard') {
            if (u.engagedWith) continue;
            const fleeing = s.units.some((o) => o !== u && o.side === 'enemy' && o.present && (o.status === 'routed' || o.order.type === 'retreat') && d2(o, u) <= R);
            if (fleeing) api.useAbility!(u.id);
        } else if (r.id === 'sakai_flank') {
            const engaged = [u, ...friends].filter((o) => !!o.engagedWith).length;
            if (engaged >= AI_ABILITY.flankEngaged) api.useAbility!(u.id);
        } else if (r.id === 'ishikawa_reserve') {
            // 対象の要る能力：斬り合っている（攻められている）味方（敵方）のうち、士気のいちばん低い部隊を立て直す
            if (friends.length < AI_ABILITY.reserveFriends) continue;
            const valid = new Set(abilityInfo(s, u.id, 'enemy')?.validTargets ?? []);
            const need = friends.filter((o) => valid.has(o.id) && (!!o.engagedWith || inMelee(s, o))).sort((a, b) => a.morale - b.morale || d2(a, u) - d2(b, u));
            if (need.length) api.useAbility!(u.id, need[0]!.id);
        } else if (r.id === 'sakakibara_vanguard') {
            if (u.engagedWith && u.morale >= AI_ABILITY.vanguardMorale) api.useAbility!(u.id);
        }
    }
}

/** u に斬りかかっている相手がいる */
function inMelee(s: BattleState, u: UnitState): boolean {
    return s.units.some((o) => o.side !== u.side && active(o) && o.engagedWith === u.id);
}

// ---------------------------------------------------------------- 武将の基本方針（味方の武将の自由な動き）

/** 武将の自由な動きが使う、合戦への窓口（sim.ts が渡す） */
export interface GeneralApi {
    /** 自由な動きとして命令を出す（待機中の印を消さない）。出せたら true */
    order(unitId: string, order: Order): boolean;
    /** 能力の効果で動けない */
    rooted(unitId: string): boolean;
    /** 知らせ（新しく動き出したときだけ） */
    log(text: string, unitId: string, targetId?: string): void;
}

/** 退いている（撤退の命令・敗走中）、戦場にいる部隊 */
function fleeing(o: UnitState): boolean {
    return o.present && (o.status === 'routed' || (o.status === 'ready' && o.order.type === 'retreat'));
}
/** p を、持ち場 post から leash 以内へ寄せる */
function withinLeash(post: { x: number; z: number }, p: { x: number; z: number }): { x: number; z: number } {
    const d = d2(post, p);
    if (d <= INITIATIVE.leash) return { x: p.x, z: p.z };
    const k = INITIATIVE.leash / d;
    return { x: post.x + (p.x - post.x) * k, z: post.z + (p.z - post.z) * k };
}
/** u が相手 e の正面（±50°）の外にいる（横・背後から当たれる） */
function offFront(e: UnitState, u: UnitState): boolean {
    return !facesMe(e, u);
}
/** 相手 e が持ち場 post から当たりに行ける所にいる */
function inReach(post: { x: number; z: number }, e: UnitState): boolean {
    return d2(e, post) <= INITIATIVE.leash + INITIATIVE.reach;
}

/** 方針ごとの動き（出す命令・知らせの文・知らせの鍵（同じ鍵は繰り返し知らせない））。何もしないなら null */
function initiativeOrder(s: BattleState, u: UnitState, g: InitiativeMemo): { order: Order; text: string; key: string } | null {
    const post = { x: g.postX, z: g.postZ };
    const seenFoe = (e: UnitState) => e.side !== u.side && active(e) && e.seenBy[u.side];
    switch (g.policy) {
        case 'coordinate': {
            // 隣の味方と斬り合っている敵へ、横・背後から当たる
            const foes = s.units
                .filter(
                    (e) =>
                        seenFoe(e) &&
                        inReach(post, e) &&
                        offFront(e, u) &&
                        s.units.some((f) => f !== u && f.side === u.side && active(f) && d2(f, u) <= INITIATIVE.coordinateRadius && e.engagedWith === f.id),
                )
                .sort((a, b) => d2(a, u) - d2(b, u));
            const e = foes[0];
            return e ? { order: { type: 'attack', targetId: e.id }, text: `${u.name}が隣の味方と組み、${e.name}の横へ当たる（武将の判断）`, key: `a:${e.id}` } : null;
        }
        case 'support': {
            // 士気の落ちた・援軍・同盟の味方が攻められていれば、その相手に当たるか近くへ寄る
            const pressed = (f: UnitState) => !!f.engagedWith || f.attackers.length > 0;
            const needs = s.units
                .filter(
                    (f) =>
                        f !== u &&
                        f.side === u.side &&
                        active(f) &&
                        !f.isHq &&
                        d2(f, post) <= INITIATIVE.supportRange &&
                        pressed(f) &&
                        (f.morale < INITIATIVE.supportMorale || f.arriveAt > 0 || f.clan !== u.clan),
                )
                .sort((a, b) => a.morale - b.morale || d2(a, u) - d2(b, u));
            for (const f of needs) {
                // 寄って構えるだけ（自分から斬りかからない。間合いに入った相手とは待機の決まりで斬り合う）
                const d = d2(post, f);
                if (d < 35) continue;
                const p = withinLeash(post, { x: post.x + ((f.x - post.x) * (d - 30)) / d, z: post.z + ((f.z - post.z) * (d - 30)) / d });
                // 寄る先の近く（8 m）にもういれば、そのまま構える（相手が少し動くたびに出し直さない）
                if (d2(u, p) <= 8) return { order: u.order.type === 'move' ? u.order : { type: 'hold' }, text: '', key: `m:${f.id}` };
                return { order: { type: 'move', x: p.x, z: p.z }, text: `${u.name}が${f.name}を支えに寄る（武将の判断）`, key: `m:${f.id}` };
            }
            return null;
        }
        case 'rearguard': {
            // 近くで（撤退の命令で）退く味方と、その追っ手の間へ入る。敗走した部隊の立て直しは作戦の判断なので、ここではしない
            const runs = s.units.filter((f) => f !== u && f.side === u.side && active(f) && f.order.type === 'retreat' && d2(f, post) <= INITIATIVE.rearguardRange).sort((a, b) => d2(a, u) - d2(b, u));
            for (const f of runs) {
                const e = s.units.filter((o) => seenFoe(o) && d2(o, f) <= 100).sort((a, b) => d2(a, f) - d2(b, f))[0];
                if (!e) continue;
                const d = Math.max(1e-6, d2(f, e));
                const k = Math.min(INITIATIVE.rearguardGap, d / 2) / d;
                const p = withinLeash(post, { x: f.x + (e.x - f.x) * k, z: f.z + (e.z - f.z) * k });
                if (d2(u, p) <= 8) return { order: u.order.type === 'move' ? u.order : { type: 'hold' }, text: '', key: `r:${f.id}` };
                return { order: { type: 'move', x: p.x, z: p.z, face: Math.atan2(e.x - p.x, -(e.z - p.z)) }, text: `${u.name}が退く${f.name}の後ろへ入る（武将の判断）`, key: `r:${f.id}` };
            }
            return null;
        }
        case 'pursuit': {
            // 近くの退く敵・弓隊を追う（退く敵を先に）
            const prey = s.units
                .filter(
                    (e) =>
                        e.side !== u.side &&
                        e.present &&
                        e.seenBy[u.side] &&
                        d2(e, u) <= INITIATIVE.pursuitRange &&
                        inReach(post, e) &&
                        (e.status === 'routed' || (e.status === 'ready' && (e.order.type === 'retreat' || e.kind === 'yumi'))),
                )
                .sort((a, b) => Number(fleeing(b)) - Number(fleeing(a)) || d2(a, u) - d2(b, u));
            const e = prey[0];
            if (!e) return null;
            const what = fleeing(e) ? `退く${e.name}` : e.name;
            if (e.status === 'ready') return { order: { type: 'attack', targetId: e.id }, text: `${u.name}が${what}を追う（武将の判断）`, key: `a:${e.id}` };
            const p = withinLeash(post, e);
            return { order: { type: 'move', x: p.x, z: p.z }, text: `${u.name}が${what}を追う（武将の判断）`, key: `p:${e.id}` };
        }
    }
}

/** 同じ命令か（移動は行き先が 3 m 以内なら同じとみなす） */
function sameOrder(a: Order, b: Order): boolean {
    if (a.type !== b.type) return false;
    if (a.type === 'attack' && b.type === 'attack') return a.targetId === b.targetId;
    if (a.type === 'move' && b.type === 'move') return Math.abs(a.x - b.x) < 3 && Math.abs(a.z - b.z) < 3;
    return true;
}

/**
 * 味方の武将の部隊の自由な動き（0.5 秒ごと。BattleSetup.generalInitiative の合戦だけ sim.ts が呼ぶ）。
 * 命令を受けていない待機中の部隊だけを動かす。プレイヤーの命令を受けた部隊・斬り合いの最中・動けない間・全軍撤退の後は動かさない。
 */
export function thinkGenerals(s: BattleState, api: GeneralApi): void {
    if (s.result || s.allRetreatAt !== null) return;
    for (const u of s.units) {
        const g = u.initiative;
        if (!g || !g.free || !active(u) || u.order.type === 'retreat' || u.engagedWith || api.rooted(u.id)) continue;
        const post = { x: g.postX, z: g.postZ };
        // 自分から当たりに行っている相手：持ち場から離れすぎたらやめて戻る
        const cur = attackTarget(s, u);
        if (cur && active(cur) && cur.seenBy[u.side] && inReach(post, cur) && d2(u, post) <= INITIATIVE.leash + 8) continue;
        const want = initiativeOrder(s, u, g);
        if (want) {
            // 同じ動きを続けているときは出し直さない。新しく動き出したときだけ知らせる（移動の行き先の小さな出し直しは知らせない）
            if (!sameOrder(u.order, want.order) && api.order(u.id, want.order) && want.key !== g.noted && want.text) {
                g.noted = want.key;
                api.log(want.text, u.id, want.order.type === 'attack' ? want.order.targetId : undefined);
            }
            continue;
        }
        // することが無い：持ち場へ戻る
        g.noted = null;
        if (d2(u, post) > INITIATIVE.homeSlack) {
            const home: Order = { type: 'move', x: post.x, z: post.z, face: g.postFacing };
            if (!sameOrder(u.order, home)) api.order(u.id, home);
        } else if (u.order.type !== 'hold') api.order(u.id, { type: 'hold' });
    }
}
