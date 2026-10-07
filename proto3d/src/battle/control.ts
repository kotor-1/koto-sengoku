/**
 * 合戦の画面の決まりごと（純粋な TypeScript。three・DOM なし）。表示（view.ts）・UI（battleUi.ts）・つなぎ（entry.ts）が共通に使い、
 * テスト（tests/proto3d-battle-control.test.ts）で確かめる。
 * - 部隊の見た目：兵の人形の数（兵 25 人ごとに 1 体、最大 30 体）・隊列の並び・兵が減ったときに消える順。
 * - 地図を押したときに何をするか（選ぶ・移動・攻撃・敵を調べる）と、選んでいる部隊（id の並び）・命令の出し方。
 * - 画面に出す言葉（部隊の札・率いる武将・勝ち負けの条件・目標・結果・知らせ）。
 * - 地図の上の印（地形・目標の区域・援軍の出る所）の名札の位置。
 * - 見下ろしカメラの範囲。
 */
import type { AbilityId, BattleEndReason, BattleMap, BattleOutcome, BattleResultKind, GateDef, ObjectiveDef, Order, Side, UnitKind, Zone } from './types';
import { STATUS_LABEL, attackDir, awaitingGate, canCommand, engagementLabel, hqOf, isActive, issueOrder, meleeUnreachable, moveBlockReason, orderLabel, pledgeProgress, timeLeft, unitById, type BattleEvent, type BattleState, type UnitState } from './sim';
import { ABILITY_DATA, ABILITY_FICTION_NOTE, abilityInfo, abilityMarks, abilityShortText, isRooted, type AbilityInfo } from './abilities';
import { objectiveProgress, seenEnemyIn, type ObjectiveRole, type ObjectiveRun, type ObjectiveState } from './objectives';
import { zoneCenter } from './fieldRules';
import { GENERAL_ROLE_LABELS, RELATION_SELF, generalById } from './generals';
// 第4群：終わり方の判定の順・脱出／離脱の出口・夜と追い討ちの決まりの文
import { deadlineEndText, endRuleConditions, leaveExits } from './objectives';
import { nightRuleTexts } from './night';

// ---------------------------------------------------------------- 部隊の見た目

/** 兵の人形 1 体が表す兵の数 */
export const FIGURE_MEN = 25;
/** 1 部隊の人形の最大数 */
export const MAX_FIGURES = 30;

/** 兵力から人形の数（兵が 1 人でもいれば 1 体以上） */
export function figureCount(strength: number): number {
    if (!(strength >= 1)) return 0;
    return Math.min(MAX_FIGURES, Math.max(1, Math.ceil(strength / FIGURE_MEN)));
}

/** 隊列の中の 1 体の位置（部隊の中心から。x は右、z は後ろ、メートル）と列（0 が最前列） */
export interface Slot {
    x: number;
    z: number;
    row: number;
}

/** 種類ごとの隊列：横の間隔・縦の間隔・最大の横の数（本陣は四角く固まる） */
export const FORMATION: Record<UnitKind, { dx: number; dz: number; maxCols: number; ranks: number }> = {
    yari: { dx: 2.5, dz: 2.8, maxCols: 10, ranks: 3 },
    yumi: { dx: 2.7, dz: 3.0, maxCols: 10, ranks: 2 },
    kiba: { dx: 3.4, dz: 4.6, maxCols: 7, ranks: 2 },
    honjin: { dx: 2.6, dz: 2.6, maxCols: 6, ranks: 0 },
};

/**
 * 隊列の並び（n 体）。槍は 3 列、弓は 2 列の横長、騎馬は間の広い 2 列、本陣は四角く固まる（真ん中に旗）。
 * 横の数が最大を超えるときは列を増やす。最後の列は中央に寄せる。
 */
export function formationSlots(kind: UnitKind, n: number): Slot[] {
    if (n <= 0) return [];
    const f = FORMATION[kind];
    let cols: number;
    if (f.ranks === 0) cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    else cols = Math.min(f.maxCols, Math.max(1, Math.ceil(n / f.ranks)));
    const rows = Math.ceil(n / cols);
    const out: Slot[] = [];
    for (let r = 0; r < rows; r++) {
        const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
        for (let c = 0; c < inRow; c++) {
            out.push({ x: (c - (inRow - 1) / 2) * f.dx, z: (r - (rows - 1) / 2) * f.dz, row: r });
        }
    }
    return out;
}

/** 隊列の広がり（半分の幅・半分の奥行き、m）。選択の輪・交戦の寄せ・押す判定に使う */
export function formationExtent(kind: UnitKind, n: number): { halfW: number; halfD: number } {
    const s = formationSlots(kind, Math.max(1, n));
    let w = 0;
    let d = 0;
    for (const p of s) {
        w = Math.max(w, Math.abs(p.x));
        d = Math.max(d, Math.abs(p.z));
    }
    const f = FORMATION[kind];
    return { halfW: w + f.dx * 0.6, halfD: d + f.dz * 0.6 };
}

/** 文字列から決まった数（0〜1）。乱数の代わり（同じ部隊はいつも同じ見た目） */
export function hash01(key: string, i: number): number {
    let h = 2166136261 ^ i;
    for (let k = 0; k < key.length; k++) {
        h ^= key.charCodeAt(k);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/**
 * 兵が減ったときに残る人形の順（先頭ほど最後まで残る）。後ろの列から、ばらつきを付けて抜けていく（最前列はなるべく残る）。
 * 戻り値はスロットの番号の並び。見える数 k なら先頭の k 個を描く。
 */
export function keepOrder(slots: Slot[], seed: string): number[] {
    const rank = slots.map((s, i) => s.row * 1.0 + hash01(seed, i) * 1.6);
    return slots.map((_, i) => i).sort((a, b) => rank[a] - rank[b] || a - b);
}

/**
 * 斬り合っている 2 部隊の見た目の寄せ（中心どうしの距離 d、それぞれの半分の奥行き）。
 * 計算では中心が 14〜25 m 離れたまま斬り合うので、見た目だけ前の列どうしが触れ合う所まで寄せる（片側の寄せ幅、m）。
 */
export function clashShift(d: number, halfDepthA: number, halfDepthB: number): number {
    const gap = d - halfDepthA - halfDepthB - 1.2;
    if (gap <= 0) return 0;
    return Math.min(gap / 2, 9);
}

// ---------------------------------------------------------------- 押したときの決まり

/**
 * 命令の出し方の途中（「移動」「攻撃」のボタンの後で地図を押す）。
 * move：移動先指定（「移動」・M の後。docs/fields-group3-design.md §2-1）。押した所へ移動を命じる。味方の部隊の体・すぐ近く・名札の名前を
 * 押しても選び直さない（行き先に味方が立っていても、その点へ。通れなければ近くの通れる所＝sim.ts の issueOrder が直す）。
 * 能力の印（点滅している ◆）も能力として使わず、その点への移動にする（第4群の確かめの決定。labelTapCandidates。能力はやめてから）。
 * 下の札・1〜8 キーは今までどおり選び直す。
 * ability：対象を選ぶ特殊能力（盟友への援護・後詰めの差配）の対象選び。「能力」・F・点滅している名札の後で、対象の味方の部隊を押す
 * （Esc・やめる・地面・同じ名札をもう一度で取り消し。選んでいる部隊＝能力を使う部隊）。
 * face：向きの指定（「向き」・T の後。第3群の確かめで足した）。押した所（地面・部隊のどこでも）の方へ、その場で向き直らせる（移動の後は進んできた
 * 向きのまま待つので、出口の前へ下ろした部隊が攻め手に背を向けていた。背後から当たられると損害 ×2.2）。能力の印は今までどおり能力。
 */
export type Pending = 'none' | 'move' | 'attack' | 'ability' | 'face';

/**
 * 地図を押した所。unit の near は「部隊そのもの（隊列の広がり）ではなく、そのすぐ近く（押しやすくするための余白）を押した」。
 * x, z は押した地面の位置。
 */
export type TapTarget =
    /** fighting：その部隊が戦える（敗走中・全滅は false。省けば戦える） */
    | { kind: 'unit'; unitId: string; side: Side; x: number; z: number; near?: boolean; fighting?: boolean }
    | { kind: 'ground'; x: number; z: number };

/** 選んでいる部隊（命令できるか） */
export interface Selected {
    id: string;
    side: Side;
    commandable: boolean;
}

/** 押した結果 */
export type TapAction =
    | { type: 'select'; unitId: string }
    /** 敵を調べる（味方を選んでいないとき） */
    | { type: 'inspect'; unitId: string }
    /** note：命令に添える案内（敵のすぐ近くの地面を押して攻撃になったとき） */
    | { type: 'order'; unitId: string; order: Order; note?: string }
    | { type: 'deselect' }
    | { type: 'none' }
    /** 特殊能力（盟友への援護・後詰めの差配）の対象に、押した部隊を選ぶ（使えるかは useAbility が確かめる。断られても回数は減らない） */
    | { type: 'abilityTarget'; unitId: string }
    /** 対象選びをやめる（地面を押した。回数は減らない。押した所へ移動の命令は出さない） */
    | { type: 'abilityCancel'; text: string }
    /** 向きの指定（pending 'face'）：選んでいる部隊を、その場で (x, z) の方へ向き直らせる（faceOrder で命令にする） */
    | { type: 'face'; unitId: string; x: number; z: number }
    /** 何も変えず、案内を出す */
    | { type: 'hint'; text: string };

/** 敵のすぐ近くの地面を押して攻撃になったときの案内（敵の脇へ移動させたつもりの人へ） */
export const NEAR_ENEMY_NOTE = '敵のすぐ近くを押すと攻撃になる。脇へ動かすには「移動」の後で地面を押す';

/**
 * 地図を押したときに何をするか（docs/chapter1-spec.md §4 表示と操作）。
 * - 味方の部隊を押す：その部隊を選ぶ（「移動」「攻撃」の途中でも、選び直しになる）。選んでいる部隊をもう一度押すと選択を外す
 *   （タッチでは Esc が無いので、これで外して敵を調べられる）。
 * - 味方を選んでいて敵を押す：攻撃（「移動」の途中なら、その地点へ移動）。味方を選んでいなければ、敵を調べる。
 *   敵の「すぐ近く」（near）を押しても攻撃。そのときは、脇へ動かすには「移動」の後で地面を押す、と案内を添える（NEAR_ENEMY_NOTE）。
 * - 味方を選んでいて地面を押す：移動（「攻撃」の途中なら、敵を押すよう案内）。
 * - 命令できない味方（敗走・撤退済みなど）や敵を選んでいて地面を押す：選択を外す。
 * - 命令できる味方を選んでいて、味方の部隊の「すぐ近く」（near：隊列の外の余白）を押す：地面を押したのと同じ（その地点へ移動）。
 *   スマホの引いた画面でも、選んだ部隊を少しだけ動かす・味方の隣へ付ける、ができるように。選び直すには部隊そのものか札を押す。
 * - 移動先指定（pending 'move'）の間に味方の部隊そのものを押す：選び直さず、その点へ移動（行き先に味方が立っているとき用。自分の隊列の中も同じ）。
 *   指定なし（pending 'none'）で味方そのものを押せば、今までどおり選ぶ。
 * - 能力の対象選び（pending 'ability'）の間は、対象選びが先（移動の命令にはならない）。
 */
export function resolveTap(sel: Selected | null, pending: Pending, tap: TapTarget): TapAction {
    const ally = sel && sel.side === 'ally' ? sel : null;
    // 能力の対象を選んでいる途中：部隊（そのもの・すぐ近く、敵でも）を押したら対象に選ぶ（不適切なら useAbility が理由を返し、対象選びは続く）。
    // 地面を押したら対象選びをやめる（Version 13 候補。前は案内だけ。移動の命令にはしない）
    if (pending === 'ability' && ally) {
        if (tap.kind === 'unit') return { type: 'abilityTarget', unitId: tap.unitId };
        return { type: 'abilityCancel', text: '能力の対象選びをやめた（使用回数は減っていない）' };
    }
    // 向きの指定の間：地面・部隊（味方・敵とも）のどこを押しても、その方へ向き直る（選び直さない）
    if (pending === 'face' && ally && ally.commandable) return { type: 'face', unitId: ally.id, x: tap.x, z: tap.z };
    // 移動先指定の間：味方の体（そのもの・すぐ近く）を押しても選び直さず、その点へ移動
    if (pending === 'move' && tap.kind === 'unit' && tap.side === 'ally' && ally && ally.commandable) return { type: 'order', unitId: ally.id, order: { type: 'move', x: tap.x, z: tap.z } };
    if (tap.kind === 'unit' && tap.side === 'ally' && tap.near && ally && ally.commandable) return resolveTap(sel, pending, { kind: 'ground', x: tap.x, z: tap.z });
    // 戦えない（敗走中の）敵の体を押した：攻撃にはならない（「もう戦えません」と断られて動かない）。地面を押したのと同じ扱い
    // （谷間の確認：敗走中の攻め手が通りかかっていた地面を押すと移動にならず、誘い出しができなかった）
    if (tap.kind === 'unit' && tap.side !== 'ally' && tap.fighting === false && ally && ally.commandable) return resolveTap(sel, pending, { kind: 'ground', x: tap.x, z: tap.z });
    if (tap.kind === 'unit' && tap.side === 'ally') return sel && sel.id === tap.unitId && pending === 'none' ? { type: 'deselect' } : { type: 'select', unitId: tap.unitId };
    if (tap.kind === 'unit') {
        if (ally && ally.commandable) {
            if (pending === 'move') return { type: 'order', unitId: ally.id, order: { type: 'move', x: tap.x, z: tap.z } };
            if (tap.near) return { type: 'order', unitId: ally.id, order: { type: 'attack', targetId: tap.unitId }, note: NEAR_ENEMY_NOTE };
            return { type: 'order', unitId: ally.id, order: { type: 'attack', targetId: tap.unitId } };
        }
        return { type: 'inspect', unitId: tap.unitId };
    }
    if (ally && ally.commandable) {
        if (pending === 'attack') return { type: 'hint', text: '攻撃する敵の部隊を押してください' };
        return { type: 'order', unitId: ally.id, order: { type: 'move', x: tap.x, z: tap.z } };
    }
    return sel ? { type: 'deselect' } : { type: 'none' };
}

/** 命令を出せなかった理由（issueOrder が false のとき） */
export function refusalText(s: BattleState, unitId: string, order: Order): string {
    const u = unitById(s, unitId);
    if (!u) return '命令を出せませんでした';
    if (s.result) return '合戦は終わりました';
    if (u.status !== 'ready') return `${u.name}は${STATUS_LABEL[u.status]}のため、命令を聞けません`;
    if (s.allRetreatAt !== null) return '全軍撤退の最中です';
    if (order.type !== 'hold' && isRooted(s, u.id)) {
        // 動けない能力は 2 つ（退路の守護：踏みとどまる／後詰めの差配：差配に専念）。持つ能力の名前で出す
        const info = abilityInfo(s, u.id);
        const left = info?.remainingSec ?? 0;
        const verb = info?.id === 'ishikawa_reserve' ? '差配に専念している' : '踏みとどまっている';
        return `${u.name}は「${info?.name ?? ABILITY_DATA.tadakatsu_rearguard.name}」で${verb}（残り ${Math.ceil(left)} 秒。防衛・待機だけ受ける）`;
    }
    if (order.type === 'attack') {
        const t = unitById(s, order.targetId);
        if (!t || !isActive(t)) return 'その部隊はもう戦えません';
        if (!t.seenBy[u.side]) return 'その部隊は見えていません';
        if (t.side === u.side) return '味方は攻撃できません';
        if (meleeUnreachable(s, u, t)) return `${t.name}へは道が無く、斬りかかれません（石垣・櫓台・閉じた門の向こう）。弓なら届けば射られます`;
    }
    // 物理的に道が無い行き先（第4群。閉じた門の向こうは「開門待ち」で受けるので、ここへは来ない）
    if (order.type === 'move') {
        const why = moveBlockReason(s, u.id, order.x, order.z);
        if (why) return why;
    }
    return '命令を出せませんでした';
}

/**
 * 向きの指定の命令：今いる所への移動に、着いた後の向き（face）を付ける（sim.ts は着いたらその向きへ向き直って待機する）。
 * 押した点が部隊のすぐ上（2 m 以内）なら向きが決まらないので null
 */
export function faceOrder(s: BattleState, unitId: string, x: number, z: number): Order | null {
    const u = unitById(s, unitId);
    if (!u || Math.hypot(x - u.x, z - u.z) < 2) return null;
    return { type: 'move', x: u.x, z: u.z, face: Math.atan2(x - u.x, -(z - u.z)) };
}

/** 向き（ラジアン。北 0・東 π/2）の 8 方位の名前 */
export function compassName(face: number): string {
    const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    const k = Math.round(((face % (2 * Math.PI)) + 2 * Math.PI) / (Math.PI / 4)) % 8;
    return names[k]!;
}

/** 命令を出したときの短い知らせ */
export function orderAck(s: BattleState, unitId: string, order: Order): string {
    const u = unitById(s, unitId);
    const name = u?.name ?? '';
    switch (order.type) {
        case 'move':
            // 向きの指定（今いる所への移動に向きを付けたもの）
            if (order.face !== undefined && u && Math.hypot(order.x - u.x, order.z - u.z) < 2) return `${name}：${compassName(order.face)}へ向き直る`;
            // 閉じた門の向こうへの移動（第4群）：門の前で開くのを待ち、開いたら道を引き直して行き先へ
            {
                const g = u ? awaitingGate(s, u) : null;
                if (g) return `${name}：移動（開門待ち：${g.def.name}が閉じている。門の前で待ち、開いたら行き先へ）`;
            }
            return `${name}：移動`;
        case 'attack':
            return `${name}：${unitById(s, order.targetId)?.name ?? '敵'}へ攻撃`;
        case 'hold':
            return `${name}：防衛・待機`;
        case 'retreat':
            return `${name}：撤退（南の退き口へ）`;
    }
}

// ---------------------------------------------------------------- 選んでいる部隊（id の並び）

/**
 * 選んでいる部隊（部隊 id の並び）。今は 1 部隊だけを選ぶ（並びの長さは 0 か 1）。先頭が「主に選んでいる部隊」で、
 * 地図を押したときの決まり（resolveTap）・札の印・能力の欄は先頭の部隊で決める。
 * 複数の選択・部隊のまとまり（グループ）を足すときは、この並びに id を足し、命令は orderUnits で並びの部隊すべてへ出す。
 */
export type Selection = readonly string[];

/** 1 部隊だけを選ぶ（今の決まり。null なら選択を外す） */
export function selectOnly(id: string | null): string[] {
    return id ? [id] : [];
}

/** 主に選んでいる部隊（先頭。選んでいなければ null） */
export function leadOf(sel: Selection): string | null {
    return sel.length > 0 ? sel[0] : null;
}

/** 選んでいる部隊の様子（resolveTap に渡す。先頭の部隊で決める） */
export function selectedOf(s: BattleState, sel: Selection): Selected | null {
    const id = leadOf(sel);
    const u = id ? unitById(s, id) : undefined;
    if (!u) return null;
    return { id: u.id, side: u.side, commandable: u.side === 'ally' && canCommand(s, u) };
}

/**
 * 選択を今の状態に合わせる：見えなくなった敵・戦場を離れた敵・知らない id を外す（味方は崩れても選んだまま＝札で様子を見られる）。
 * 変わらなければ同じ並びを返す。
 */
export function pruneSelection(s: BattleState, sel: Selection): Selection {
    const keep = sel.filter((id) => {
        const u = unitById(s, id);
        if (!u) return false;
        return u.side === 'ally' || (u.present && u.seenBy.ally);
    });
    return keep.length === sel.length ? sel : keep;
}

/** 並びの中で、いま命令を出せる味方の部隊 */
export function commandableIds(s: BattleState, sel: Selection): string[] {
    return sel.filter((id) => {
        const u = unitById(s, id);
        return !!u && u.side === 'ally' && canCommand(s, u);
    });
}

/** 命令を出した結果（出せた部隊・断られた部隊） */
export interface OrderUnitsResult {
    issued: string[];
    refused: string[];
}

/**
 * 命令を並びの部隊すべてへ出す（今は 1 部隊）。issue は確認用に差し替えられる（既定は sim.ts の issueOrder）。
 * 同じ命令を部隊ごとに出す（複数の部隊を同じ地点へ動かすときの並べ方は、複数の選択を足すときに決める）。
 */
export function orderUnits(s: BattleState, ids: Selection, order: Order, issue: (s: BattleState, id: string, o: Order) => boolean = issueOrder): OrderUnitsResult {
    const r: OrderUnitsResult = { issued: [], refused: [] };
    for (const id of ids) {
        // 敵の部隊には命令を出さない（sim の issueOrder は敵の考えも使うので陣営を見ない）
        const ok = unitById(s, id)?.side !== 'enemy' && issue(s, id, order);
        (ok ? r.issued : r.refused).push(id);
    }
    return r;
}

/** 命令を出した・出せなかったときの短い知らせ（1 部隊なら orderAck・refusalText と同じ文） */
export function orderUnitsText(s: BattleState, order: Order, r: OrderUnitsResult): string {
    if (r.issued.length === 0) return r.refused.length ? refusalText(s, r.refused[0], order) : '命令を出せませんでした';
    if (r.issued.length === 1 && r.refused.length === 0) return orderAck(s, r.issued[0], order);
    const head = orderAck(s, r.issued[0], order).replace(/^[^：]*：/, '');
    return `${r.issued.length} 部隊：${head}${r.refused.length ? `（${r.refused.length} 部隊は命令を聞けない）` : ''}`;
}

// ---------------------------------------------------------------- 画面の言葉

export const KIND_SHORT: Record<UnitKind, string> = { honjin: '本陣', yari: '槍', yumi: '弓', kiba: '騎馬' };

/** 残り時間の表示（例：7:32） */
export function fmtClock(sec: number): string {
    const t = Math.max(0, Math.ceil(sec));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** 士気の色分け */
export function moraleTone(morale: number): 'good' | 'mid' | 'low' {
    return morale > 50 ? 'good' : morale > 30 ? 'mid' : 'low';
}

/** 部隊の札に出すもの */
export interface CardModel {
    id: string;
    name: string;
    kind: string;
    strength: number;
    startStrength: number;
    /** 0〜1 */
    strengthRatio: number;
    morale: number;
    moraleTone: 'good' | 'mid' | 'low';
    orderText: string;
    engageText: string;
    /** 敗走・撤退済み・全滅・到着待ち（戦えるなら空） */
    badge: string;
    commandable: boolean;
    present: boolean;
}

export function cardModel(s: BattleState, u: UnitState): CardModel {
    const strength = Math.round(u.strength);
    let badge = '';
    if (u.status !== 'ready') badge = STATUS_LABEL[u.status];
    else if (!u.arrived) badge = '到着待ち';
    const commandable = u.status === 'ready' && !s.result && !(u.side === 'ally' && s.allRetreatAt !== null);
    return {
        id: u.id,
        name: u.name,
        kind: KIND_SHORT[u.kind],
        strength,
        startStrength: u.startStrength,
        strengthRatio: u.startStrength > 0 ? Math.max(0, Math.min(1, u.strength / u.startStrength)) : 0,
        morale: Math.round(u.morale),
        moraleTone: moraleTone(u.morale),
        orderText: orderLabel(s, u),
        engageText: u.present && u.status === 'ready' ? engagementLabel(s, u) : 'なし',
        badge,
        commandable,
        present: u.present,
    };
}

/** 陣営の様子（本陣が健在か・本陣以外の部隊のうち戦えるもの） */
export function armySummary(s: BattleState, side: Side): { hq: string; able: number; total: number } {
    const hq = hqOf(s, side);
    const rest = s.units.filter((u) => u.side === side && !u.isHq);
    // 夜（第4群）の敵：味方が最後に見た様子で数える（見ていない間に崩れた・着いた敵を漏らさない。sim.ts の intel）
    if (s.setup.night && side === 'enemy') {
        const hqText = !hq ? '―' : hq.intel.status === 'ready' ? '健在' : STATUS_LABEL[hq.intel.status];
        return { hq: hqText, able: rest.filter((u) => u.intel.status === 'ready').length, total: rest.length };
    }
    const hqText = !hq ? '―' : hq.status === 'ready' ? (hq.present ? '健在' : '到着待ち') : STATUS_LABEL[hq.status];
    return { hq: hqText, able: rest.filter((u) => u.status === 'ready').length, total: rest.length };
}

/** 勝ち負けの条件（画面の上の説明。短く） */
export const CONDITIONS: { label: string; text: string; tone: 'good' | 'bad' | 'info' }[] = [
    { label: '勝利', text: '敵本陣を敗走させる／敵の本陣以外をすべて崩す', tone: 'good' },
    { label: '敗北', text: '味方本陣の敗走／本陣以外の味方が崩れて戦えない', tone: 'bad' },
    { label: '撤退', text: '全軍撤退／本陣以外をすべて退かせる／日没', tone: 'info' },
];

/**
 * その合戦の勝ち負けの条件。主目標の無い合戦（国境の原・歴史分岐の章）は CONDITIONS のまま。
 * 主目標のある合戦（合戦場の演習）は、主目標の達成で勝ち、果たせなくなれば負け（sim.ts の decideByObjective と同じ決まり）。
 */
export function conditionsFor(s: BattleState): typeof CONDITIONS {
    const p = s.objectives?.primary?.def;
    if (!p) return CONDITIONS;
    // 第4群：終わり方の判定の順をデータで持つ戦場は、その順を出す（objectives.ts の endRuleConditions）
    if (s.setup.endRules) return endRuleConditions(s);
    const win =
        p.type === 'destroy_hq'
            ? '敵本陣を敗走させる／敵の本陣以外をすべて崩す'
            : `主目標「${p.label}」を果たす／敵の部隊をすべて崩す`;
    const retreat = p.type === 'retreat_success' ? '全軍撤退・本陣の撤退で終われば、主目標の達成で勝ち負けが決まる／日没' : '全軍撤退／本陣以外をすべて退かせる／日没';
    return [
        { label: '勝利', text: win, tone: 'good' },
        { label: '敗北', text: `味方本陣の敗走／本陣以外の味方が崩れて戦えない${p.type === 'destroy_hq' ? '' : '／主目標を果たせなくなる'}`, tone: 'bad' },
        { label: '撤退', text: retreat, tone: 'info' },
    ];
}

export const RESULT_LABEL: Record<BattleResultKind, string> = { victory: '勝利', defeat: '敗北', retreat: '撤退' };
export const REASON_TEXT: Record<BattleEndReason, string> = {
    enemy_hq_routed: '敵本陣が崩れ、鷲尾勢は総崩れとなった',
    enemy_army_broken: '敵の本陣以外の部隊がすべて戦えなくなった',
    ally_hq_routed: '味方本陣が崩れた。若殿は家臣に守られて落ち延びた（討死ではない）',
    ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった。若殿は兵をまとめて落ち延びた',
    ordered_retreat: '撤退を命じ、兵をまとめて戦場を離れた',
    nightfall: '日が暮れ、両軍とも兵を引いた',
    objective_done: '主目標を果たした',
    objective_failed: '主目標を果たせなかった',
};

export interface ResultRow {
    id: string;
    name: string;
    side: Side;
    start: number;
    end: number;
    lost: number;
    status: string;
    /** 夜（第4群）：一度も見つけなかった敵の部隊（兵の数は出さない） */
    unknown?: true;
}
/** 結果の表（部隊ごとの最初と最後の兵・失った兵・状態）と陣営ごとの合計 */
export function resultRows(s: BattleState, o: BattleOutcome): { rows: ResultRow[]; lost: Record<Side, number>; start: Record<Side, number> } {
    const rows: ResultRow[] = [];
    const lost: Record<Side, number> = { ally: 0, enemy: 0 };
    const start: Record<Side, number> = { ally: 0, enemy: 0 };
    for (const r of o.units) {
        const u = unitById(s, r.id);
        const st = Math.round(r.startStrength);
        const en = Math.round(r.endStrength);
        // 夜（第4群）：一度も見つけなかった敵の部隊は、兵の数・状態を出さず（「見つけていない」）、敵の合計にも入れない
        if (s.setup.night && r.side === 'enemy' && u && u.intel.t < 0) {
            rows.push({ id: r.id, name: u.name, side: r.side, start: 0, end: 0, lost: 0, status: '見つけていない', unknown: true });
            continue;
        }
        rows.push({ id: r.id, name: u?.name ?? r.id, side: r.side, start: st, end: en, lost: st - en, status: r.status === 'ready' ? '健在' : STATUS_LABEL[r.status] });
        lost[r.side] += st - en;
        start[r.side] += st;
    }
    return { rows, lost, start };
}

/** 知らせの色分け（味方に良い・悪い・ふつう）。出さない知らせは null */
export function eventTone(s: BattleState, e: BattleEvent): 'good' | 'bad' | 'warn' | 'info' | null {
    if (e.kind === 'start' || e.kind === 'end') return null;
    // 夜（第4群）：味方から見えていない敵の出来事は出さない（sim.ts の markUnseen）
    if (e.unseen) return null;
    const side = e.unitId ? unitById(s, e.unitId)?.side : undefined;
    const mine = side === 'ally';
    switch (e.kind) {
        case 'rout':
        case 'destroyed':
        case 'fled':
            return mine ? 'bad' : 'good';
        case 'flank':
        case 'rear':
        case 'charge':
            return mine ? 'good' : 'bad';
        case 'spotted':
        case 'discovered':
        case 'ai':
            return 'warn';
        case 'ability':
            // 味方の能力は良い知らせ、敵の能力（敵の長政の援護など）は気をつける知らせ
            return mine ? 'good' : 'warn';
        case 'pledge': {
            const u = e.unitId ? unitById(s, e.unitId) : undefined;
            return u && (u.status === 'routed' || u.status === 'destroyed') ? 'bad' : 'good';
        }
        default:
            return 'info';
    }
}

/** 日没までの残り（画面の上） */
export function timeText(s: BattleState): string {
    return fmtClock(timeLeft(s));
}

// ---------------------------------------------------------------- 見下ろしカメラ

/** カメラ：北を上にした見下ろし（向きは回さない）。見下ろす角度・画角・寄れる近さ */
export const CAM = { pitchDeg: 56, fovDeg: 40, minDist: 45, maxDistFallback: 700 };

export interface CamState {
    /** 見ている地点（地面） */
    tx: number;
    tz: number;
    /** 見ている地点からカメラまでの距離（m） */
    dist: number;
}

/** カメラが戦場の外を見に行きすぎないように */
export function clampCam(c: CamState, map: BattleMap, maxDist: number): CamState {
    const hw = map.width / 2;
    const hd = map.depth / 2;
    return {
        tx: Math.max(-hw, Math.min(hw, c.tx)),
        tz: Math.max(-hd - 20, Math.min(hd + 40, c.tz)),
        dist: Math.max(CAM.minDist, Math.min(maxDist, c.dist)),
    };
}

// ---------------------------------------------------------------- シナリオごとの言葉（架空の第一章・歴史分岐・合戦場の演習）

/** 画面の言葉のうち、シナリオで変わるもの */
export interface ScenarioTexts {
    /** 歴史分岐「元亀元年・家康」の合戦か（味方の本陣が徳川家。合戦場の演習は除く） */
    historical: boolean;
    /** 合戦場の演習か（敵の本陣が架空の「敵勢」＝家 rival。ゲーム用の演習で、史実の合戦ではない） */
    practice: boolean;
    /** 画面の上の札（例：仮シナリオ） */
    tag: string;
    /** 合戦の前の説明の題の添え書き */
    titleNote: string;
    reasons: Record<BattleEndReason, string>;
    notes: Record<BattleResultKind, string>;
}

/** 主目標の文（主目標の無い合戦は「主目標」） */
function primaryLabel(s: BattleState): string {
    const l = s.objectives?.primary?.def.label;
    return l ? `主目標「${l}」` : '主目標';
}

/**
 * シナリオの言葉。架空の第一章は今までと同じ（REASON_TEXT・鷲尾勢・若殿）。
 * 歴史分岐（味方の本陣が徳川家）は「1570年の情勢を背景にした架空の局地戦」とし、家康は落ち延びる（討死ではない）。
 * 合戦場の演習（敵の本陣が架空の「敵勢」）は「ゲーム用の演習（架空の相手）」とし、史実の合戦のようには書かない。
 * 物語の注記（BattleSetup.story。歴史分岐の第二章）がある合戦は、題の添え書き・札・結果の添え書きをその注記にする。
 */
export function scenarioTexts(s: BattleState): ScenarioTexts {
    const base = baseScenarioTexts(s);
    // 物語の注記（歴史分岐の第二章の合戦だけ。BattleSetup.story を持たない合戦は今までの言葉のまま）
    const st = s.setup.story;
    if (!st) return base;
    return { ...base, titleNote: st.titleNote, tag: st.tag ?? base.tag, notes: { ...base.notes, ...(st.notes ?? {}) } };
}

function baseScenarioTexts(s: BattleState): ScenarioTexts {
    const practice = hqOf(s, 'enemy')?.clan === 'rival';
    const historical = !practice && hqOf(s, 'ally')?.clan === 'tokugawa';
    if (practice) {
        const enemy = hqOf(s, 'enemy')?.name ?? '敵の本陣';
        const lord = hqOf(s, 'ally')?.name ?? '味方の本陣';
        return {
            historical,
            practice,
            tag: '演習（架空の相手）',
            titleNote: 'ゲーム用の演習（架空の相手）',
            reasons: {
                enemy_hq_routed: `${enemy}が崩れ、敵勢は兵を引いた`,
                enemy_army_broken: '敵勢の部隊が崩れ、戦える部隊がなくなった',
                ally_hq_routed: `${lord}が崩れた（演習。大将は落ち延びる）`,
                ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった',
                ordered_retreat: '撤退を命じ、兵をまとめて戦場を離れた',
                nightfall: deadlineEndText(s.setup),
                objective_done: `${primaryLabel(s)}を果たした`,
                objective_failed: `${primaryLabel(s)}を果たせなくなった`,
            },
            notes: {
                victory: '演習の勝ち。地形に合った戦い方を確かめられた。',
                defeat: '演習の負け。地形と目標を見直して、もう一度試せる。',
                retreat: '勝敗は決まらなかった。兵を失いすぎないうちに引いた。',
            },
        };
    }
    if (!historical) {
        return {
            historical,
            practice,
            tag: '仮シナリオ',
            titleNote: '仮シナリオ',
            reasons: REASON_TEXT,
            notes: {
                victory: '鷲尾勢は国境から兵を引いた。',
                defeat: '敗れはしたが、若殿は生きている。兵をまとめ直して次に備える。',
                retreat: '勝敗は決まらなかった。兵を失いすぎないうちに引いた。',
            },
        };
    }
    const enemy = hqOf(s, 'enemy')?.name ?? '敵の本陣';
    return {
        historical,
        practice,
        tag: '架空の局地戦',
        titleNote: '1570年の情勢を背景にした架空の局地戦',
        reasons: {
            enemy_hq_routed: `${enemy}が崩れ、敵勢は兵を引いた`,
            enemy_army_broken: '敵の本陣以外の部隊がすべて戦えなくなった',
            ally_hq_routed: '家康本陣が崩れた。家康は家臣に守られて落ち延びた（討死ではない）',
            ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった。家康は兵をまとめて落ち延びた',
            ordered_retreat: '撤退を命じ、兵をまとめて戦場を離れた',
            nightfall: '日が暮れ、両軍とも兵を引いた',
            objective_done: '主目標を果たした',
            objective_failed: '主目標を果たせなかった',
        },
        notes: {
            victory: 'この局地戦には勝った。一度の勝利で相手の家が滅ぶわけではない。',
            defeat: '敗れはしたが、家康は生きている。兵をまとめ直して次に備える。一度の敗北で家が滅ぶことはない。',
            retreat: '勝敗は決まらなかった。兵を失いすぎないうちに引いた。',
        },
    };
}

// ---------------------------------------------------------------- 特殊能力の表示（ゲーム用の創作）

/**
 * 能力の短い説明（スマホでも収まる長さ。数値は ABILITY_DATA から）。6 能力とも abilities.ts の abilityShortText に任せる
 * （Version 13 候補で号令の効果が「上限 100・敗走しない」に変わったので、ここで別に書かない）
 */
export function abilityShort(id: AbilityId): { target: string; effect: string; cost: string } {
    return abilityShortText(id);
}

/** 能力の欄に出すもの（選んだ部隊。能力のない部隊は null） */
export interface AbilityPanelModel {
    unitId: string;
    name: string;
    /** 使える／効果中 残り 12 秒／使用済み／使えない・敵方 */
    stateText: string;
    tone: 'ready' | 'active' | 'spent' | 'blocked' | 'enemy';
    /** 「能力」のボタンを押せるか（味方の能力で、いま使える） */
    usable: boolean;
    /** 使えない理由（使えるなら空） */
    reason: string;
    /** 残り使用回数の表示（例：残り 1 回（1 合戦 1 回）） */
    uses: string;
    short: { target: string; effect: string; cost: string };
    /** 範囲の説明（例：半径 110 m（家康本陣の周り）） */
    rangeText: string;
    /** 効果の残り（効果中だけ。例：残り 28 秒。ほかは空） */
    remainText: string;
    /** 使い方の短い案内（使えるときだけ。名札を押す・対象を選ぶ） */
    howTo: string;
    /** 詳しい説明（PC の画面） */
    targetText: string;
    effectText: string;
    costText: string;
    note: string;
    info: AbilityInfo;
}

export function abilityPanelModel(s: BattleState, unitId: string): AbilityPanelModel | null {
    const info = abilityInfo(s, unitId);
    if (!info) return null;
    const enemy = !info.controllable;
    let stateText: string;
    let tone: AbilityPanelModel['tone'];
    if (info.state === 'active') {
        stateText = `効果中 残り ${Math.ceil(info.remainingSec)} 秒`;
        tone = 'active';
    } else if (info.state === 'spent') {
        stateText = '使用済み';
        tone = 'spent';
    } else if (enemy) {
        stateText = '敵方（敵の考えが使う）';
        tone = 'enemy';
    } else if (info.usable) {
        stateText = '使える';
        tone = 'ready';
    } else {
        stateText = '使えない';
        tone = 'blocked';
    }
    // 両翼の采配の効果中：包囲の条件を満たしているか（使ったのに何も起きないように見えないよう、条件の状態を出す）
    const flank = info.state === 'active' ? flankStatus(s, unitId) : null;
    if (flank) stateText += `・${flankStatusText(flank)}`;
    if (info.state === 'active' && info.target === 'ally_unit' && info.targetId) {
        const t = unitById(s, info.targetId);
        // 盟友への援護は離れると外れる。後詰めの差配は使った後は離れても効く（linked はいつも true）
        if (info.id === 'nagamasa_support') stateText += `・${t?.name ?? ''}${info.linked ? 'を援護中' : 'が離れて外れている'}`;
        else stateText += `・${t?.name ?? ''}へ差配中`;
    }
    const howTo = info.ready ? (info.needsTarget ? '地図の名札の点滅する印（◆）か「能力」を押し、輪の付いた味方を押す' : '地図の名札の点滅する印（◆）を押すだけで使える（「能力」・F でも）') : '';
    const uses = info.state === 'unused' ? '残り 1 回（1 合戦 1 回）' : '残り 0 回（1 合戦 1 回）';
    return {
        unitId,
        name: info.name,
        stateText,
        tone,
        usable: info.usable && info.controllable,
        reason: info.usable && !enemy ? '' : (info.reason ?? ''),
        uses,
        short: abilityShort(info.id),
        rangeText: info.rangeText,
        remainText: info.state === 'active' ? `残り ${Math.ceil(info.remainingSec)} 秒` : '',
        howTo,
        targetText: info.targetText,
        effectText: info.effectText,
        costText: info.costText,
        note: info.note,
        info,
    };
}

/** 両翼の采配の効果中の、包囲の条件の状態（酒井隊の範囲の味方で、側面・背後から斬っている部隊の数・包囲されている敵の数） */
export interface FlankStatus {
    /** 範囲の味方のうち、いま敵の側面・背後から斬っている部隊の数 */
    flankers: number;
    /** 包囲されている敵の数（s.encircled） */
    encircled: number;
}

/**
 * 両翼の采配の効果中なら、包囲の条件の状態（ほかの能力・効果中でなければ null）。合戦の状態を読むだけ。
 * 包囲＝範囲の味方 2 部隊以上が、同じ敵を別の向きから斬っている（abilities.ts の findEncircled）。
 */
export function flankStatus(s: BattleState, unitId: string): FlankStatus | null {
    const info = abilityInfo(s, unitId);
    if (!info || info.state !== 'active' || !ABILITY_DATA[info.id].encircle) return null;
    const holder = unitById(s, unitId);
    if (!holder) return null;
    const r = ABILITY_DATA[info.id].radius;
    let flankers = 0;
    for (const a of s.units) {
        if (a.side !== holder.side || !a.present || a.status !== 'ready' || !a.engagedWith) continue;
        if (Math.hypot(a.x - holder.x, a.z - holder.z) > r) continue;
        const d = unitById(s, a.engagedWith);
        if (d && attackDir(d, a.x, a.z) !== 'front') flankers++;
    }
    return { flankers, encircled: s.encircled.length };
}

/** 包囲の条件の短い文（名札・能力の欄）。例：「包囲 1」「包囲なし・側背 1」「包囲なし」 */
export function flankStatusText(f: FlankStatus): string {
    if (f.encircled > 0) return `包囲 ${f.encircled}`;
    return f.flankers > 0 ? `包囲なし・側背 ${f.flankers}` : '包囲なし';
}

/** 部隊の札・名札に添える、能力の短い状態（能力がなければ空）。例：「号令 使える」「踏みとどまる 32 秒」「援護 済」 */
export function cardAbilityText(s: BattleState, unitId: string): string {
    const info = abilityInfo(s, unitId);
    if (!info) return '';
    const short = info.cardLabel;
    if (info.state === 'active') return `${short} ${Math.ceil(info.remainingSec)} 秒`;
    if (info.state === 'spent') return `${short} 済`;
    return info.usable ? `${short} 可` : `${short} ―`;
}

/** 部隊に今効いている能力の印（名札用。abilityMarks をまとめる） */
export function unitMarksText(s: BattleState, unitId: string): string {
    const m = abilityMarks(s, unitId);
    return m.length ? m.join('・') : '';
}

export { ABILITY_FICTION_NOTE };

// ---------------------------------------------------------------- 特殊能力の発動 UI（名札の点滅・ワンクリック・対象選び。設計 §4）

/** 発動できる武将の名札の点滅：明るさ 0.55〜1.0 を周期 1.6 秒で往復（選択の黄とは別の淡い青緑。色は battle.css） */
export const ABILITY_BLINK = { min: 0.55, max: 1.0, periodSec: 1.6 };

/** 点滅の明るさ（t は表示の時計＝実時間の秒。一時停止中も進むので、止めていても点滅は続く） */
export function abilityBlink(t: number): number {
    const k = 0.5 + 0.5 * Math.cos((2 * Math.PI * t) / ABILITY_BLINK.periodSec);
    return ABILITY_BLINK.min + (ABILITY_BLINK.max - ABILITY_BLINK.min) * k;
}

/** 名札の当たり判定の最小の大きさ（px 四方。見た目の名札より小さければこの大きさまで広げる） */
export const LABEL_HIT_PX = { mouse: 36, touch: 48 };

/** 能力を使ったタップの後、同じ所を押しても何もしない時間（秒。連打の 2 回目が地面の移動・別の部隊の選択に漏れないように） */
export const TAP_GUARD_SEC = 0.5;

/**
 * 移動先指定の素早い 2 回（第4群の設計 §2）：移動先指定（pending 'move'）で行き先を押して移動の命令を出した後、この秒数のあいだの次の押しは、
 * 選び直し・能力の発動（点滅する名札・部隊の体の確かめ）にしない。1 回目の点の近く（当たりの半分の半径）なら何もしない（同じ点の移動の重ね）、
 * 離れていれば、移動先指定のまま、その点への移動にする。続けて押す間は延ばす。時間は実時間。
 * この秒数の内は、敵の部隊の体（そのすぐ近く）を押しても攻撃にせず、その点への移動になる（素早い 2 回の 2 回目を、前の押しの続きとみなす）。
 * 敵を攻撃させたいときは、少し（この秒数より長く）あけてから敵を押す（合戦の前の説明の「操作」に書く）
 */
export const MOVE_ECHO_SEC = 0.6;

/** 移動先指定で行き先を押した直後の印（画面の点・選んでいた部隊・この時刻まで・同じ点とみなす半径 px） */
export interface MoveEcho {
    x: number;
    y: number;
    unitId: string;
    until: number;
    r: number;
}

/**
 * 移動先指定の直後の押しの扱い：'same'＝1 回目の近く（何もしない）、'move'＝離れた所（その点への移動）、null＝ふつうの押し
 * （印が無い・時間切れ・選んでいる部隊が変わった）
 */
export function moveEchoDecision(e: MoveEcho | null, x: number, y: number, now: number, selectedId: string | null): 'same' | 'move' | null {
    if (!e || now >= e.until || selectedId !== e.unitId) return null;
    return Math.hypot(x - e.x, y - e.y) <= e.r ? 'same' : 'move';
}

/**
 * 点滅している武将の名札の名前・部隊の体を押したとき（印の外）：その部隊を選び、短い確かめ（名札に「もう一度で◆号令」）を出す。
 * windowSec のあいだに同じ武将（名札・体）をもう一度押すと使う（対象の要る能力は対象選びへ）。minGapSec より早い 2 回目（指の震え・連打）は何もしない。
 * 時間は実時間（一時停止中も進む）。印（◆号令）を押せば、今までどおり 1 回で使う。
 */
export const ABILITY_ARM = { windowSec: 3, minGapSec: 0.25 };

/** 確かめの状態（押した武将・押した実時間・押した所の画面の点） */
export interface AbilityArm {
    id: string;
    at: number;
    x?: number;
    y?: number;
    /** 押した所の下の地面（地図が動いたかを見る） */
    gx?: number;
    gz?: number;
}

/**
 * 点滅している武将の名札の名前・部隊の体を押した：'fire'＝確かめの中の 2 回目（使う）／'wait'＝早すぎる 2 回目（何もしない）／
 * 'arm'＝1 回目（選んで確かめを出す）
 */
export function armDecision(arm: AbilityArm | null, id: string, now: number): 'fire' | 'wait' | 'arm' {
    if (!arm || arm.id !== id || now - arm.at > ABILITY_ARM.windowSec) return 'arm';
    return now - arm.at < ABILITY_ARM.minGapSec ? 'wait' : 'fire';
}

/** 確かめがまだ効いているか（名札の「もう一度で◆」の表示） */
export function armLive(arm: AbilityArm | null, now: number): string | null {
    return arm && now - arm.at <= ABILITY_ARM.windowSec ? arm.id : null;
}

/**
 * 名札の能力の印：
 * - ready：発動できる（点滅）。wait：対象選びの間の、ほかの発動できる武将（点滅しない）
 * - choosing：対象を選んでいる能力の持ち主。target：選べる対象。untargetable：選べない（薄く）
 * - active：効果中（残り秒数）。''：印なし
 */
export type LabelAbilityMode = 'ready' | 'choosing' | 'target' | 'untargetable' | 'active' | '';

export interface LabelAbilityModel {
    mode: LabelAbilityMode;
    /** 名札に添える短い文（例：◆号令・残り 28 秒・対象を選ぶ）。印なし・選べる対象（縁だけ）は空 */
    text: string;
}

/**
 * 名札の能力の印（毎フレーム。pending・selectedId はつなぎの状態）。
 * 点滅（ready）は abilityInfo の ready（味方の武将・まだ使っていない・戦える・着いている・対象の要る能力は選べる対象がいる）だけ。
 * 敵方・使用済み・効果中・戦えない・まだ着いていない・対象がいない、では点滅しない。対象選びの間は、選べる・選べないを示す。
 */
export function labelAbilityModel(s: BattleState, unitId: string, pending: Pending, selectedId: string | null, armedId: string | null = null): LabelAbilityModel {
    const u = unitById(s, unitId);
    if (!u || s.result) return { mode: '', text: '' };
    const info = s.abilities[unitId] ? abilityInfo(s, unitId) : null;
    if (pending === 'ability' && selectedId) {
        if (unitId === selectedId) return { mode: 'choosing', text: '対象を選ぶ' };
        const user = abilityInfo(s, selectedId);
        // 選べる名札は縁だけ（文を足すと名札が長くなり、隣の名札と重なる）
        if (user && u.side === 'ally') return user.validTargets.includes(unitId) ? { mode: 'target', text: '' } : { mode: 'untargetable', text: '' };
        return { mode: 'untargetable', text: '' };
    }
    if (!info) return { mode: '', text: '' };
    // 名札の名前・部隊の体を押した後の確かめ（ABILITY_ARM.windowSec のあいだ）：もう一度押すと使う
    if (info.ready) return { mode: 'ready', text: armedId === unitId ? `もう一度で◆${info.cardLabel}` : `◆${info.cardLabel}` };
    // 効果中：残り秒数だけ（能力の名前は名札の効いている印［号令（守りを優先）］などに出ている）。両翼の采配は包囲の条件の状態も
    if (info.state === 'active' && info.controllable) {
        const f = flankStatus(s, unitId);
        return { mode: 'active', text: `残り ${Math.ceil(info.remainingSec)} 秒${f ? `・${flankStatusText(f)}` : ''}` };
    }
    return { mode: '', text: '' };
}

/** 名札の当たり判定に使う四角（CSS px。canvas の左上から。ワンクリック発動は名札の能力の印（◆号令）の四角、対象選びは名札全体） */
export interface LabelBox {
    id: string;
    l: number;
    t: number;
    r: number;
    b: number;
    /** 描く重なりの順（大きいほど上。LabelCover の z と同じ数え方。省けば 0） */
    z?: number;
}

/**
 * 画面に出ている部隊の名札の四角と、描く重なりの順（z：大きいほど上）。名札の見た目で隠れた所を押しても、隠れた名札には当てない
 * （上に見えている名札を押したつもりの指を、下の名札の印が奪わない）
 */
export interface LabelCover extends LabelBox {
    z: number;
}

function inBox(b: { l: number; t: number; r: number; b: number }, x: number, y: number): boolean {
    return x >= b.l && x <= b.r && y >= b.t && y <= b.b;
}

/** その点でいちばん上に見えている部隊の名札（どれにも入っていなければ null） */
export function labelTopAt(covers: readonly LabelCover[], x: number, y: number): string | null {
    let best: LabelCover | null = null;
    for (const c of covers) if (inBox(c, x, y) && (!best || c.z > best.z)) best = c;
    return best ? best.id : null;
}

/** 画面の点（部隊の体の中心（その部隊自身も）・ほかの名札の中心。名札の広げた当たりが、この点より向こうへ行かないように） */
export interface ScreenMark {
    id: string;
    x: number;
    y: number;
}

/**
 * 名札を押したか（押した名札の部隊 id。どれでもなければ null）。
 * - 見た目の名札の中：その名札。ただし、その点に上から重なって見えている別の名札（covers で z が大きいもの）があれば当てない
 *   （隠れた印を押したことにしない。Version 13 候補の確認で直した：重なった名札の下の忠勝の印が、上の榊原の名札を押した指を奪っていた）。
 * - 見た目の外で、名札の中心を真ん中に minPx 四方まで広げた中：ほかの部隊の中心・ほかの名札の中心より、この名札の中心に近いときだけ
 *   （隣の部隊を押したつもりの指を奪わない。広げた当たりは隣の部隊の中心より外へ行かない）。
 *   その点がどれかの名札（自分の名札の名前の所も）の上なら、広げた所としては当てない（見えている名札の方を押したとみなす）。
 * 複数に当たれば、名札の中心に近いもの。
 */
export function labelHit(boxes: readonly LabelBox[], others: readonly ScreenMark[], x: number, y: number, minPx: number, covers: readonly LabelCover[] = []): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const b of boxes) {
        const cx = (b.l + b.r) / 2;
        const cy = (b.t + b.b) / 2;
        const hw = Math.max(b.r - b.l, minPx) / 2;
        const hh = Math.max(b.b - b.t, minPx) / 2;
        if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) continue;
        const d = Math.hypot(x - cx, y - cy);
        const inside = inBox(b, x, y);
        if (inside) {
            // 上に重なって見えている別の名札：隠れた所は押せない
            const z = b.z ?? 0;
            if (covers.some((c) => c.id !== b.id && c.z > z && inBox(c, x, y))) continue;
        } else {
            // 広げた所：名札の上（自分の名札の名前の所も）なら、見えている名札を押したとみなす
            if (covers.some((c) => inBox(c, x, y))) continue;
            // ほかの部隊（の中心・名札の中心）の方が近ければ、その部隊を押したつもりとみなす
            if (others.some((o) => o.id !== b.id && Math.hypot(x - o.x, y - o.y) <= d)) continue;
        }
        const score = inside ? d * 0.5 : d;
        if (score < bestD) {
            bestD = score;
            best = b.id;
        }
    }
    return best;
}

/** 能力を使ったタップの守り（この時刻まで、この点の近くのタップは何もしない） */
export interface TapGuard {
    x: number;
    y: number;
    until: number;
    r: number;
}

export function inTapGuard(g: TapGuard | null, x: number, y: number, now: number): boolean {
    return !!g && now < g.until && Math.hypot(x - g.x, y - g.y) <= g.r;
}

/**
 * タップを守りに通す：守りの中なら何もしない（swallow）で、守りをその時刻から TAP_GUARD_SEC だけ延ばす
 * （連打が続く間は、何回押しても地面の移動・部隊の選択に漏らさない。0.5 秒あけて押し直せば、ふつうのタップ）。
 */
export function guardTap(g: TapGuard | null, x: number, y: number, now: number): { swallow: boolean; guard: TapGuard | null } {
    if (!g || !inTapGuard(g, x, y, now)) return { swallow: false, guard: g };
    return { swallow: true, guard: { ...g, until: now + TAP_GUARD_SEC } };
}

/**
 * 名札の当たり判定を付ける部隊：対象選びの間は、持ち主と地図に見えている味方（対象）。移動先指定（pending 'move'）の間は無し
 * （点滅している名札の印も能力として扱わず、押した点＝通れなければ近くの通れる所への移動にする。「味方の上を押しても選び直さずに移動」と
 * 同じ扱い。能力を使うときは移動先指定をやめてから）。そのほかは点滅している名札だけ
 */
export function labelTapCandidates(s: BattleState, pending: Pending, selectedId: string | null): string[] {
    if (s.result || pending === 'move') return [];
    if (pending === 'ability' && selectedId) return s.units.filter((u) => u.side === 'ally' && u.present && isActive(u)).map((u) => u.id);
    return s.abilityList.filter((r) => r.side === 'ally' && abilityInfo(s, r.unitId)?.ready).map((r) => r.unitId);
}

/** 名札を押した結果 */
export type LabelTapAction =
    /** 対象の要らない能力を、押しただけで使う */
    | { type: 'use'; unitId: string }
    /** 対象の要る能力：対象選びを始める（その部隊を選ぶ） */
    | { type: 'chooseTarget'; unitId: string }
    /** 対象選びの持ち主の名札をもう一度：やめる */
    | { type: 'cancel'; unitId: string }
    /** 対象選びの間に、ほかの味方の名札：その部隊を対象にする */
    | { type: 'target'; userId: string; targetId: string };

/**
 * 名札を押したときに何をするか（hitId は labelHit の結果）。名札に当たっていない・点滅していない名札は null（今までどおり地図を押した扱い）。
 * 対象選びの間は、ほかの武将の名札を押しても、その能力は使わない（対象として選ぶ）。
 */
export function resolveLabelTap(s: BattleState, hitId: string | null, pending: Pending, selectedId: string | null): LabelTapAction | null {
    if (!hitId || s.result) return null;
    if (pending === 'ability' && selectedId) {
        if (hitId === selectedId) return { type: 'cancel', unitId: hitId };
        return { type: 'target', userId: selectedId, targetId: hitId };
    }
    const info = abilityInfo(s, hitId);
    if (!info || !info.ready) return null;
    return info.needsTarget ? { type: 'chooseTarget', unitId: hitId } : { type: 'use', unitId: hitId };
}

/** 対象選びの案内（下の案内の欄）。援護は今までどおりの言い方 */
export function abilityTargetHint(s: BattleState, userId: string | null): string {
    const u = userId ? unitById(s, userId) : undefined;
    const info = u ? abilityInfo(s, u.id) : null;
    const name = u?.name ?? '';
    if (info?.id === 'nagamasa_support') return `${name}：援護する味方の部隊を押してください（札でも選べる）`;
    return `${name}：「${info?.name ?? '能力'}」の対象の味方を押してください（輪の付いた部隊・札でも選べる。地面・Esc でやめる）`;
}

/**
 * 発動の知らせ（能力名・武将・対象。2.5 秒ほど出す）。対象：選んだ部隊・自隊・範囲の説明。
 * generalId は率いる武将の id（知らせに武将の顔を添えるため。Version 22。武将のいない部隊は null）
 */
export function abilityNoticeModel(s: BattleState, unitId: string): { title: string; general: string; target: string; generalId: string | null } | null {
    const info = abilityInfo(s, unitId);
    const u = unitById(s, unitId);
    if (!info || !u) return null;
    const target = info.needsTarget ? (info.targetName ?? '') : info.target === 'self' ? u.name : info.rangeText;
    return { title: `「${info.name}」`, general: info.generalName, target, generalId: u.generalId ?? u.leaderId ?? null };
}

/** 効果が切れた知らせ（短く）。能力のデータの名前で */
export function abilityEndText(id: AbilityId): string {
    return `「${ABILITY_DATA[id].name}」の効果が切れた`;
}

// ---------------------------------------------------------------- 戦前の約束の表示

/** 条件の欄の約束の行（約束のない合戦は null） */
export interface PledgeLineModel {
    targetId: string;
    title: string;
    status: string;
    tone: 'ok' | 'progress' | 'warn' | 'bad';
}

export function pledgeLineModel(s: BattleState): PledgeLineModel | null {
    const p = pledgeProgress(s);
    if (!p) return null;
    const need = Math.round(p.minStrengthRatio * 100);
    const str = `兵 ${Math.round(p.strengthRatio * 100)}%`;
    const low = p.strengthRatio < p.minStrengthRatio - 1e-9;
    const title = `約束：${p.targetName}の退路を守る`;
    let status: string;
    let tone: PledgeLineModel['tone'];
    if (p.result) {
        status = p.result === 'kept' ? `守った（${str}）` : `守れなかった（${p.failed ? `${p.targetName}が崩れた` : `${str}・${need}% 未満`}）`;
        tone = p.result === 'kept' ? 'ok' : 'bad';
    } else if (p.failed) {
        status = `守れない（${p.targetName}が崩れた）`;
        tone = 'bad';
    } else if (p.withdrew) {
        status = `退き口から離れた ✓ / ${str}${low ? `（${need}% 未満）` : ''}`;
        tone = low ? 'bad' : 'ok';
    } else if (p.secured) {
        status = `陣で ${p.holdSec} 秒 持ちこたえた ✓ / ${str}${low ? `（${need}% 未満）` : ''}`;
        tone = low ? 'warn' : 'ok';
    } else if (p.inZone) {
        status = `陣に入って ${Math.floor(p.zoneSec)}/${p.holdSec} 秒 / ${str}`;
        tone = low ? 'warn' : 'progress';
    } else {
        status = `味方の陣の外（入って ${p.holdSec} 秒） / ${str}`;
        tone = low ? 'warn' : 'progress';
    }
    if (!p.result && !p.failed && low) status += `・${need}% 未満では守れない`;
    // 約束の場面（対象が斬り合う・味方が合わせて 15 秒斬り結ぶ）の前は、撤退で終えると守ったことにならない
    if (!p.result && !p.failed && !p.contested) {
        status += ` / まだ敵と斬り合っていない（${Math.floor(p.meleeSec)}/${p.contestMeleeSec} 秒）— 今退くと守れない`;
        if (tone === 'ok') tone = 'progress';
    }
    return { targetId: p.targetId, title, status, tone };
}

/**
 * 結果の画面の約束の欄（勝敗とは別）。架空の第一章は null。歴史分岐で引き受けていなければ「引き受けていない」
 * （約束の無い章＝BattleSetup.story.noPledgeRow の合戦は null）
 */
export function pledgeResultModel(s: BattleState, o: BattleOutcome): { result: 'kept' | 'broken' | 'declined'; title: string; text: string } | null {
    if (!scenarioTexts(s).historical) return null;
    // 戦前の約束の無い章（歴史分岐の第二章。BattleSetup.story.noPledgeRow）は、約束の欄を出さない
    if (!o.pledge && s.setup.story?.noPledgeRow) return null;
    if (!o.pledge) {
        return { result: 'declined', title: '約束：引き受けていない', text: '出陣前の約束は引き受けなかった。約束違反ではない（信頼は変わらない）。' };
    }
    const u = unitById(s, o.pledge.targetId);
    const name = u?.name ?? o.pledge.targetId;
    const row = o.units.find((r) => r.id === o.pledge!.targetId);
    const ratio = row && row.startStrength > 0 ? Math.round((row.endStrength / row.startStrength) * 100) : 0;
    const status = row ? (row.status === 'ready' ? '戦えている' : STATUS_LABEL[row.status]) : '';
    if (o.pledge.result === 'kept') {
        return { result: 'kept', title: `約束を守った：${name}の退路を守る`, text: `${name}は${status}（兵 ${ratio}% 残る）。勝敗とは別に、約束は果たした。` };
    }
    const need = s.pledge?.minStrengthRatio ?? 0.4;
    const fell = row && (row.status === 'routed' || row.status === 'destroyed');
    const why = fell
        ? `${name}が${status}`
        : row && row.startStrength > 0 && row.endStrength >= row.startStrength * need - 1e-9
          ? `${name}は${status}（兵 ${ratio}%）が、敵と斬り合う前に${o.result === 'defeat' ? '敗れた' : '退いた'}ため、退路を守ったことにならない`
          : `${name}の兵が ${ratio}%（${Math.round(need * 100)}% 未満）`;
    return { result: 'broken', title: `約束を守れなかった：${name}の退路を守る`, text: `${why}。勝敗とは別に、約束は果たせなかった。` };
}

/** 結果の画面の、使った特殊能力（使わなければ「使わなかった」。能力のない合戦は空） */
export function abilitiesUsedText(s: BattleState, o: BattleOutcome): string {
    if (!o.abilitiesUsed) return '';
    const mine = s.abilityList.filter((r) => r.side === 'ally');
    if (mine.length === 0) return '';
    const parts = mine.map((r) => {
        const at = o.abilitiesUsed![r.unitId];
        return `${ABILITY_DATA[r.id].name}：${at === undefined ? '使わなかった' : `開始 ${fmtClock(at)} に使った`}`;
    });
    return `特殊能力（ゲーム用の創作）— ${parts.join('／')}`;
}

// ---------------------------------------------------------------- 率いる武将（部隊を選んだときの欄）

/** 選んだ部隊を率いる武将の欄に出すもの（武将のいない部隊は null） */
export interface GeneralLineModel {
    generalId: string;
    /** 武将の表示名（例：酒井忠次） */
    name: string;
    /** 役割の呼び方（例：采配・軍議） */
    roleLabel: string;
    /** 固有能力の名前（能力のデータが無ければ空） */
    abilityName: string;
    /** 仮の能力（差し替え前提。画面に「仮」の印） */
    provisional: boolean;
    side: Side;
    /** 主人公との関係状態（武将の relationKey で BattleSetup.relations から引く。無い合戦・主人公本人は null） */
    relation: { label: string; value: number } | null;
}

export function generalLineModel(s: BattleState, unitId: string): GeneralLineModel | null {
    const u = unitById(s, unitId);
    const gid = u?.generalId ?? u?.leaderId;
    const g = gid ? generalById(gid) : undefined;
    if (!u || !g) return null;
    // 能力：合戦の中の能力（部隊の ability か武将の能力）。無ければ武将のデータの能力
    const id: AbilityId | undefined = abilityInfo(s, unitId)?.id ?? (ABILITY_DATA[g.abilityId] ? g.abilityId : undefined);
    const d = id ? ABILITY_DATA[id] : undefined;
    // 関係状態：武将の relationKey で、合戦の設定の relations（歴史分岐なら信頼）を引く
    const rv = g.relationKey !== RELATION_SELF ? s.setup.relations?.[g.relationKey] : undefined;
    const relation = typeof rv === 'number' && Number.isFinite(rv) ? { label: '信頼', value: rv } : null;
    return { generalId: g.id, name: g.name, roleLabel: GENERAL_ROLE_LABELS[g.role], abilityName: d?.name ?? '', provisional: !!d?.provisional, side: u.side, relation };
}

// ---------------------------------------------------------------- 目標の欄・結果（主目標・副目標。約束とは別の欄）

/** 目標の 1 行（objectives.ts の objectiveProgress から） */
export interface ObjectiveRowModel {
    id: string;
    role: ObjectiveRole;
    label: string;
    state: ObjectiveState;
    progressText: string;
    /** 色分け：まだ・果たした・果たせない */
    tone: 'progress' | 'ok' | 'bad';
}

/** 目標の欄（目標の無い合戦は null）。rules は戦場の特殊ルール・地形の決まりの短い説明 */
export interface ObjectivePanelModel {
    primary: ObjectiveRowModel | null;
    secondary: ObjectiveRowModel[];
    rules: string[];
}

export function objectivePanelModel(s: BattleState): ObjectivePanelModel | null {
    const list = objectiveProgress(s);
    if (list.length === 0) return null;
    const row = (p: (typeof list)[number]): ObjectiveRowModel => ({
        id: p.id,
        role: p.role,
        label: p.label,
        state: p.state,
        progressText: p.progressText,
        tone: p.state === 'done' ? 'ok' : p.state === 'failed' ? 'bad' : 'progress',
    });
    const primary = list.find((p) => p.role === 'primary');
    return { primary: primary ? row(primary) : null, secondary: list.filter((p) => p.role === 'secondary').map(row), rules: fieldRuleTexts(s) };
}

/**
 * 畳んだ目標の欄の見出しに出す、主目標の短い進み（スマホでも 1 行で読める）。括弧の中の説明は省く。
 * ただし数を含む短い括弧（6 字まで。例：「突破 1／許容 3（あと 2）」の「あと 2」）は進みそのものなので残す（第3群の操作の直し。
 * 既存の 10 戦場の進みの文の括弧はどれも 7 字以上か数を含まないので、見出しは今までと同じ）。
 * 段階目標（「段階 1／2：外門の制圧・外門 制圧 5／20 秒…」）は段の名前を省いて「段階 1／2・外門 制圧 5／20 秒…」にする
 * （スマホの狭い見出しで、名前のせいで今の段の数が「…」で切れていた。段の名前は開いた欄と地図の目標の名札に出ている）
 * 同時確保（「同時確保 12／60 秒・山門 ○・本堂前 敵」）は、要所ごとの ○・空・敵 を前に出して「山門 ○・本堂前 敵・12／60 秒」にする
 * （寺社周辺の確かめ：スマホの見出しが「同時確保 0／60 秒・山門 敵・本…」で切れ、2 つ目の要所の様子が欄を開かないと分からなかった）
 */
export function objectiveSummaryText(p: ObjectiveRowModel | null): string {
    if (!p) return '';
    if (p.state === 'done') return '主目標 ✓ 達成';
    if (p.state === 'failed') return '主目標 ✗';
    return p.progressText
        .replace(/（([^）]*)）/g, (all, inner: string) => (inner.length <= 6 && /\d/.test(inner) ? all : ''))
        .replace(/^(段階 \d+／\d+)：[^・]*・/, '$1・')
        .replace(/同時確保 (\d+／\d+ 秒)・(.*)$/, '$2・$1');
}

/** 戦場の決まりの短い説明（その戦場のデータにあるものだけ。無い合戦は空） */
export function fieldRuleTexts(s: BattleState): string[] {
    const fr = s.setup.fieldRules;
    if (!fr) return [];
    const out: string[] = [];
    // 狭い正面は、同じ数の区域が何か所もあれば 1 行にまとめる（複数橋の 3 本の橋など）
    const narrowCount = new Map<number, number>();
    for (const r of fr.specialRules ?? []) if (r.type === 'narrow_frontage') narrowCount.set(r.maxEngaged, (narrowCount.get(r.maxEngaged) ?? 0) + 1);
    for (const r of fr.specialRules ?? []) {
        if (r.type === 'narrow_frontage') {
            const n = narrowCount.get(r.maxEngaged) ?? 0;
            if (n === 0) continue;
            narrowCount.set(r.maxEngaged, 0);
            out.push(`狭い正面${n > 1 ? `（${n} か所）` : ''}：区域の中では、同じ相手に斬りかかれるのは ${r.maxEngaged} 部隊まで`);
        }
        // 林の奇襲：夜（第4群）は林の外でも見られていない部隊がいるので「奇襲」（夜は林の外でも働く）
        else if (r.type === 'woods_ambush') out.push(`${s.setup.night ? '奇襲（夜は林の外でも）' : '林の奇襲'}：見られていない部隊の最初の当たり ×${r.firstStrikeMul}（${r.sec} 秒）`);
    }
    const tr = fr.terrainRules ?? {};
    const ford = tr.ford;
    // 矢の損害の倍率は、1 でない（既定から上書きした）ときだけ添える
    if (ford) {
        const arrow = ford.arrowTakeMul !== undefined && ford.arrowTakeMul !== 1 ? `・矢の損害 ×${ford.arrowTakeMul}` : '';
        out.push(`浅瀬：動き ×${ford.speed ?? 0.4}・与える損害 ×${ford.dealMul ?? 0.8}・受ける損害 ×${ford.takeMul ?? 1.2}${arrow}`);
    }
    const woodsKiba = tr.woods?.kindSpeed?.kiba;
    if (woodsKiba !== undefined) out.push(`林の中の騎馬：動き ×${woodsKiba}`);
    const hg = fr.highGround;
    if (hg) {
        const parts: string[] = [];
        if (hg.defenseVsLower !== undefined) parts.push(`下から攻める相手の損害 ×${hg.defenseVsLower}`);
        if (hg.rangeBonus) parts.push(`弓の射程 +${hg.rangeBonus} m`);
        if (hg.sightBonus) parts.push(`見通し +${hg.sightBonus} m`);
        if (hg.arrowDealVsLower !== undefined && hg.arrowDealVsLower !== 1) parts.push(`低い相手へ射る矢 ×${hg.arrowDealVsLower}`);
        if (parts.length) out.push(`高所：${parts.join('・')}`);
    }
    // 水田（動きは部隊の種類で違う。値は合戦の決まり（既定＋戦場の上書き）から読む）
    if (s.map.terrain.some((a) => a.kind === 'paddy')) {
        const p = s.field.terrain.paddy;
        const sp = (k: 'yari' | 'kiba' | 'yumi') => Math.round(p.speed * (p.kindSpeed[k] ?? 1) * 100) / 100;
        out.push(`水田：動き 槍・本陣 ×${sp('yari')}・騎馬 ×${sp('kiba')}・弓 ×${sp('yumi')}、中で斬り合うと与える損害 ×${p.dealMul}・受ける損害 ×${p.takeMul}（街道・畦道は速い）`);
    }
    if (s.map.terrain.some((a) => a.kind === 'bridge')) out.push('橋：深い川の上を渡れる細い道（動きは道と同じ）');
    if (s.map.terrain.some((a) => a.kind === 'river')) {
        const ford = s.map.terrain.some((a) => a.kind === 'ford');
        const bridge = s.map.terrain.some((a) => a.kind === 'bridge');
        // 浅瀬も橋も無い水面（第4群の湖・河岸）は「渡れない水面」
        out.push(bridge ? `深い川は渡れない（${ford ? '浅瀬と橋' : '橋'}だけ渡れる）` : ford ? '深い川は渡れない（浅瀬だけ渡れる）' : '湖（深い水面）は渡れない（船は無い。水辺の陸戦）');
    }
    if (s.map.terrain.some((a) => a.kind === 'cliff')) out.push('崖は通れない');
    // 第3群：湿地の泥（弓・突撃）・乾いた足場・障害物・門
    const marsh = s.map.terrain.some((a) => a.kind === 'marsh') ? s.field.terrain.marsh : null;
    if (marsh && (marsh.arrowDealMul !== 1 || marsh.noCharge || marsh.kindSpeed.kiba !== undefined)) {
        const parts = [`動き ×${marsh.speed}${marsh.kindSpeed.kiba !== undefined ? `（騎馬 ×${Math.round(marsh.speed * marsh.kindSpeed.kiba * 100) / 100}）` : ''}`];
        if (marsh.arrowDealMul !== 1) parts.push(`中の弓の矢 ×${marsh.arrowDealMul}`);
        if (marsh.noCharge) parts.push('騎馬の突撃は効かない');
        out.push(`湿地の泥：${parts.join('・')}`);
    }
    if (s.map.terrain.some((a) => a.kind === 'dry')) out.push('乾いた足場：湿地の中でも普通の地面（土手道は速い道）');
    const obstacles = [
        s.map.terrain.some((a) => a.kind === 'building') ? '家屋・堂' : '',
        s.map.terrain.some((a) => a.kind === 'wall') ? '石垣' : '',
    ].filter(Boolean);
    if (obstacles.length) out.push(`${obstacles.join('・')}は通れず、矢も通さない（陰の相手は射られない。高い所からは越えて射られる）`);
    if (s.map.terrain.some((a) => a.kind === 'fence')) out.push('柵は通れないが、矢は通す');
    for (const g of s.field.gates) out.push(`${g.def.name}：閉じている間は通れず、矢も通さない。${gateLabelText(g.def).slice(g.def.name.length + 1)}（開いた門は閉じない）`);
    // 第4群：夜（視界と発見・篝火・物見）・追い討ち（データで演習にも）。どちらも無い戦場では何も足さない
    out.push(...nightRuleTexts(s.setup));
    return out;
}

/** 結果の画面の目標の行（勝敗・約束とは別の行。目標の無い合戦は null） */
export interface ObjectiveResultModel {
    primary: { label: string; achieved: boolean } | null;
    secondary: { label: string; achieved: boolean }[];
}

export function objectiveResultModel(o: BattleOutcome): ObjectiveResultModel | null {
    const ob = o.objectives;
    if (!ob) return null;
    return {
        primary: ob.primary ? { label: ob.primary.label, achieved: ob.primary.achieved } : null,
        secondary: ob.secondary.map((r) => ({ label: r.label, achieved: r.achieved })),
    };
}

// ---------------------------------------------------------------- 地図の上の印（目標の区域・援軍・特殊ルールの区域・名札）

/** 目標の区域の短い呼び方 */
const ZONE_NAME: Partial<Record<ObjectiveDef['type'], string>> = {
    hold_point: '確保する地点',
    defend_time: '守る地点',
    defend_zones: '守る地点',
    rescue: '救出の地点',
    breakthrough: '突破する地点',
    hold_zones: '確保する地点',
    limit_breakthrough: '敵に抜かせない出口',
    open_gate: '門の制圧',
    // 第4群
    escape: '脱出の出口',
    withdraw: '離脱の退き口',
    rescue_escort: '合流の輪',
};

/** 地図に描く目標の区域（区域を持つ目標だけ。主目標 → 副目標の順） */
export interface ObjectiveZoneMark {
    /** 目標の id（defend_zones は区域ごとに「目標の id#番号」） */
    id: string;
    role: ObjectiveRole;
    zone: Zone;
    /** 短い名前（例：確保する地点。defend_zones は区域の名前） */
    name: string;
    /** 区域の用途（地図の名札の頭に出す。第4群：突破を抑える目標の出口は「敵の突破口」。味方の退き口と分ける） */
    use?: string;
}

export function objectiveZoneMarks(s: BattleState): ObjectiveZoneMark[] {
    const tr = s.objectives;
    if (!tr) return [];
    const out: ObjectiveZoneMark[] = [];
    const add = (r: ObjectiveRun, prefix: string) => {
        const d = r.def;
        if (d.type === 'defend_zones' || d.type === 'hold_zones') {
            d.zones.forEach((zone, i) => out.push({ id: `${d.id}#${i}`, role: r.role, zone, name: prefix + (d.names?.[i] ?? ZONE_NAME[d.type]!) }));
            return;
        }
        if (d.type === 'limit_breakthrough') {
            d.exits.forEach((zone, i) => out.push({ id: `${d.id}#${i}`, role: r.role, zone, name: prefix + (d.names?.[i] ?? ZONE_NAME.limit_breakthrough!), use: '敵の突破口' }));
            return;
        }
        if (d.type === 'escape' || d.type === 'withdraw') {
            // 第4群：脱出の出口・離脱の退き口（入った味方の部隊は戦場を離れる）
            leaveExits(d).forEach((zone, i) => out.push({ id: `${d.id}#${i}`, role: r.role, zone, name: prefix + (d.type === 'escape' ? (d.names?.[i] ?? ZONE_NAME.escape!) : (d.name ?? ZONE_NAME.withdraw!)) }));
            return;
        }
        if (d.type === 'rescue_escort') {
            // 第4群：合流の輪と安全地点の輪（別々の区域）
            out.push({ id: `${d.id}#0`, role: r.role, zone: d.meetZone, name: `${prefix}合流の輪` }, { id: `${d.id}#1`, role: r.role, zone: d.safeZone, name: `${prefix}安全地点（連れ帰る先）` });
            return;
        }
        if (d.type === 'open_gate') {
            // 門の制圧の区域（門の前の輪）。名札は「門の制圧（外門）」
            const g = s.field.gates.find((x) => x.def.id === d.gateId);
            // 名札に制圧の条件も入れる（門の名札は出さない＝門の周りの名札を減らす）
            if (g) out.push({ id: d.id, role: r.role, zone: g.def.capture.zone, name: `${prefix}${g.def.name}の制圧（輪を敵なしで ${g.def.capture.sec} 秒）` });
            return;
        }
        if (d.type === 'sequence') {
            // 段階目標：段ごとの区域（名札に「段階 1」などを添える）
            r.steps.forEach((st, k) => add(st, `${prefix}段階 ${k + 1}・`));
            return;
        }
        const zone = 'zone' in d ? d.zone : undefined;
        const name = ZONE_NAME[d.type];
        if (zone && name) out.push({ id: d.id, role: r.role, zone, name: prefix + name });
    };
    for (const r of tr.list) add(r, '');
    return out;
}

/** 目標の見張りを id で探す（段階目標の段も） */
function findRun(list: readonly ObjectiveRun[] | undefined, id: string): ObjectiveRun | undefined {
    for (const r of list ?? []) {
        if (r.def.id === id) return r;
        const st = findRun(r.steps, id);
        if (st) return st;
    }
    return undefined;
}

/** 区域の印の id（目標の id、または区域ごとの目標の「目標の id#番号」）→ 目標の見張りと区域の番号 */
function zoneRun(s: BattleState, id: string): { run: ObjectiveRun | undefined; i: number } {
    const k = id.lastIndexOf('#');
    const run = findRun(s.objectives?.list, id);
    if (run || k < 0) return { run, i: -1 };
    return { run: findRun(s.objectives?.list, id.slice(0, k)), i: Number(id.slice(k + 1)) };
}

/**
 * 目標の今の状態（目標の見張りから。無ければ active）。defend_zones の区域の印は、その区域を失ったら failed。
 * 段階目標の段は、その段の状態（まだ来ていない段は active）
 */
export function objectiveStateOf(s: BattleState, id: string): ObjectiveState {
    const { run, i } = zoneRun(s, id);
    if (run && i >= 0 && run.def.type === 'defend_zones' && run.zoneLost[i]) return 'failed';
    return run?.state ?? 'active';
}

/** 区域の印が、いま数えている（確保を数える・敵に奪われかけている・門を制圧している）か。地図の輪を脈打たせる */
export function objectiveZoneCounting(s: BattleState, id: string): boolean {
    const { run, i } = zoneRun(s, id);
    if (!run || run.state !== 'active') return false;
    const d = run.def;
    // 段階目標の段は、今の段だけ
    if (run.parent && run.parent.steps[run.parent.stepIdx] !== run) return false;
    if (d.type === 'limit_breakthrough') return false;
    if (d.type === 'open_gate') {
        const g = s.field.gates.find((x) => x.def.id === d.gateId);
        // 味方の門を敵が制圧しかけている：見えている敵が輪にいる間だけ脈打たせる（未発見の敵の位置を漏らさない）
        return !!g && g.sec > 0 && (g.holder !== 'ally' || seenEnemyIn(s, g.def.capture.zone));
    }
    if (d.type === 'hold_zones') return run.sec > 0;
    // 守る区域を敵に奪われかけている（defend_time・defend_zones）：見えている敵が区域にいる間だけ（夜・林の中の未発見の敵は数えない。判定は変えない）
    if (d.type === 'defend_zones') return i >= 0 && (run.zoneSec[i] ?? 0) > 0 && seenEnemyIn(s, d.zones[i]!);
    if (d.type === 'defend_time') return run.sec > 0 && !!d.zone && seenEnemyIn(s, d.zone);
    return i >= 0 ? (run.zoneSec[i] ?? 0) > 0 : run.sec > 0;
}

/** 援軍の出る所（BattleSetup.reinforcements。部隊の最初の位置と、着く時刻の早いほう） */
export interface ReinforcementMark {
    id: string;
    side: Side;
    x: number;
    z: number;
    /** 着く時刻（秒） */
    at: number;
}

export function reinforcementMarks(s: BattleState): ReinforcementMark[] {
    const out: ReinforcementMark[] = [];
    for (const r of s.setup.reinforcements ?? []) {
        // 夜（第4群）：敵の援軍の出る所は地図に出さない（見つけるまで分からない）
        if (s.setup.night && r.side === 'enemy') continue;
        const defs = r.unitIds.map((id) => s.setup.units.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
        if (defs.length === 0) continue;
        out.push({ id: r.id, side: r.side, x: defs[0].x, z: defs[0].z, at: Math.min(...defs.map((u) => u.arriveAt ?? 0)) });
    }
    return out;
}

/** 目標が指す部隊の印（名札に添える。例：救出・守る・崩す）。部隊 id → 印 */
export function objectiveUnitMarks(s: BattleState): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of s.objectives?.list ?? []) {
        const d = r.def;
        if (d.type === 'rescue' || d.type === 'rescue_escort') m.set(d.unitId, '救出');
        // 救出の対象に「部隊を残す」の副目標も付いているとき（第4群の援軍救出）は「救出」のまま
        else if (d.type === 'preserve_unit' && m.get(d.unitId) !== '救出') m.set(d.unitId, '守る');
        else if (d.type === 'break_unit') m.set(d.unitId, '崩す');
    }
    return m;
}

/** 地図の上の名札（地形・退き口・約束の安全地点・目標の区域・援軍の出る所・狭い正面）。y は地面からの高さ */
export interface MapLabel {
    id: string;
    text: string;
    x: number;
    z: number;
    y: number;
}

const TERRAIN_LABEL: Record<string, string> = {
    hill: '丘',
    woods: '林（中は敵から見えない）',
    marsh: '湿地（動きが遅い）',
    river: '深い川（渡れない）',
    ford: '浅瀬（遅い・戦うと不利）',
    cliff: '崖（通れない）',
    bridge: '橋',
    paddy: '水田（とても遅い）',
    // 第3群：建物・柵・石垣は区画が多いので、同じ名札は 1 つの戦場に 1 つだけ（mapLabels）
    building: '家屋・堂（通れない・矢を通さない）',
    fence: '柵（通れない・矢は通す）',
    wall: '石垣（通れない・矢を通さない）',
    dry: '乾いた足場',
};

/** 尾根（カプセルの丘）の名札を置く線分の上の所（割合。先の方から空いた所を使う）と、部隊の最初の位置から空ける距離（m） */
const CAPSULE_LABEL_AT = [0.25, 0.75, 0.5, 0.1, 0.9, 0.4, 0.6];
const CAPSULE_LABEL_CLEAR = 45;

/** 四角の区域（川）の名札の置き場所：中心の行で、浅瀬と重ならない所 */
function rectLabelPoint(s: BattleState, rect: { x0: number; x1: number; z0: number; z1: number }, avoid: { x0: number; x1: number; z0: number; z1: number }[]): { x: number; z: number } {
    const z = (rect.z0 + rect.z1) / 2;
    for (const f of [0.5, 0.3, 0.7, 0.18, 0.82]) {
        const x = rect.x0 + (rect.x1 - rect.x0) * f;
        if (Math.abs(x) > s.map.width / 2 - 30) continue;
        if (!avoid.some((a) => x >= a.x0 - 40 && x <= a.x1 + 40)) return { x, z };
    }
    return { x: (rect.x0 + rect.x1) / 2, z };
}

export function mapLabels(s: BattleState): MapLabel[] {
    const out: MapLabel[] = [];
    // 川の名札は浅瀬・橋と重ならない所に置く（橋の無い戦場では浅瀬だけ。今までと同じ）
    const fords = s.map.terrain.filter((a) => (a.kind === 'ford' || a.kind === 'bridge') && a.rect).map((a) => a.rect!);
    s.map.terrain.forEach((a, i) => {
        const name = TERRAIN_LABEL[a.kind];
        if (!name) return;
        if (a.circle && a.kind === 'dry') {
            // 乾いた足場の島（第3群）：ほかの足場の名札から 120 m 以内には付けない（島が多い）
            if (out.some((l) => l.text === name && Math.hypot(l.x - a.circle!.cx, l.z - a.circle!.cz) < 120)) return;
            out.push({ id: `t${i}`, text: name, x: a.circle.cx, z: a.circle.cz + a.circle.r + 4, y: 1 });
        } else if (a.circle) out.push({ id: `t${i}`, text: name, x: a.circle.cx + a.circle.r * 0.55, z: a.circle.cz + a.circle.r * 0.75, y: 2 });
        else if (a.capsule) {
            // 尾根（カプセルの丘）：線分の 4 分の 1 の所から南へ幅の半分（真ん中の頂に置く目標の名札と重ならないように）。
            // そこが部隊の最初の位置（配置の枠・援軍の出る所）から CAPSULE_LABEL_CLEAR m 以内なら、線分の 3/4・1/2・1/10・9/10…の所の南へ
            // 順に移す（部隊の名札と重ならないように。谷間の高地の弓）。どこも近ければ 4 分の 1 の所のまま
            const c = a.capsule;
            const at = (f: number) => ({ x: c.ax + (c.bx - c.ax) * f, z: Math.min(c.az + (c.bz - c.az) * f + c.r * 0.5, s.map.depth / 2 - 20) });
            const clear = (p: { x: number; z: number }) =>
                !s.setup.units.some((u) => Math.hypot(u.x - p.x, u.z - p.z) < CAPSULE_LABEL_CLEAR) && !out.some((l) => Math.abs(l.x - p.x) < 40 && Math.abs(l.z - p.z) < 14);
            const p = CAPSULE_LABEL_AT.map(at).find(clear) ?? at(0.25);
            out.push({ id: `t${i}`, text: '尾根', x: p.x, z: p.z, y: 2 });
        } else if (a.rect) {
            const r = a.rect;
            if (a.kind === 'bridge') {
                // 橋は北の端の東（橋の上の狭い正面・川の名札と重ならないように）
                out.push({ id: `t${i}`, text: name, x: Math.min(r.x1 + 12, s.map.width / 2 - 20), z: r.z0 - 6, y: 1 });
                return;
            }
            if (a.kind === 'building' || a.kind === 'fence' || a.kind === 'wall') {
                // 障害物（第3群）：同じ名札は戦場に 1 つだけ。いちばん大きい区画（柵・石垣はいちばん長い区画）の真ん中の上
                // （門・目標の輪・狭い正面の名札の集まる所から離れやすい）
                if (out.some((l) => l.text === name)) return;
                const size = (q: { x0: number; x1: number; z0: number; z1: number }) => (a.kind === 'building' ? (q.x1 - q.x0) * (q.z1 - q.z0) : Math.max(q.x1 - q.x0, q.z1 - q.z0));
                const big = s.map.terrain.filter((b) => b.kind === a.kind && b.rect).sort((p, q) => size(q.rect!) - size(p.rect!))[0]!;
                const br = big.rect!;
                out.push({ id: `t${i}`, text: name, x: (br.x0 + br.x1) / 2, z: (br.z0 + br.z1) / 2, y: (big.height ?? 6) + 1 });
                return;
            }
            if (a.kind === 'dry') {
                // 土手道（細長い乾いた足場）には名札を付けない（道の名札と重なる）
                if (r.x1 - r.x0 < 20 || r.z1 - r.z0 < 20) return;
            }
            if (a.kind === 'paddy') {
                // 水田は区画が多いので、ほかの水田の名札から 150 m 以内には付けない
                const cx = (r.x0 + r.x1) / 2;
                const cz = (r.z0 + r.z1) / 2;
                if (out.some((l) => l.text === name && Math.hypot(l.x - cx, l.z - cz) < 150)) return;
                out.push({ id: `t${i}`, text: name, x: cx, z: cz, y: 1 });
                return;
            }
            if (a.kind === 'river') {
                const p = rectLabelPoint(s, r, fords);
                // 浅瀬も橋も無い水面（第4群の湖・河岸）は「湖」
                out.push({ id: `t${i}`, text: fords.length ? name : '湖（深い水面。渡れない）', x: p.x, z: p.z, y: 0.5 });
            } else if (a.kind === 'ford') out.push({ id: `t${i}`, text: name, x: (r.x0 + r.x1) / 2, z: r.z1 + 6, y: 0.5 });
            else if (a.kind === 'hill') {
                // 四角の丘（第3群の台地・櫓の台）：大きい台地は「台地（高い）」と真ん中より少し南に。小さい台（櫓）は、上に立つ部隊の名札と
                // 重なるので名札を付けない（合戦の前の説明に書く）
                if ((r.x1 - r.x0) * (r.z1 - r.z0) < 900) return;
                out.push({ id: `t${i}`, text: '台地（高い）', x: (r.x0 + r.x1) / 2, z: Math.min((r.z0 + r.z1) / 2 + 30, r.z1 - 20), y: (a.height ?? 10) + 1 });
            } else if (a.kind === 'cliff') {
                // 細い崖（関の狭まり）には名札を付けない
                if (r.x1 - r.x0 < 20 || r.z1 - r.z0 < 20) return;
                out.push({ id: `t${i}`, text: name, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y: 8 });
            }
            // 四角の区域（林・湿地）は真ん中より少し南（別働隊が着く所・通り道の名札と重ならないように）
            else out.push({ id: `t${i}`, text: name, x: (r.x0 + r.x1) / 2, z: Math.min((r.z0 + r.z1) / 2 + 30, s.map.depth / 2 - 30), y: 1 });
        }
    });
    const ex = s.map.exits;
    // 援軍の出る所が味方の退き口のすぐ近くなら、退き口の名札は東へ離す（援軍の部隊の名札と重ならないように）
    const reinfs = reinforcementMarks(s);
    const nearExit = reinfs.some((r) => Math.hypot(r.x - ex.ally.x, r.z - ex.ally.z) < 30);
    out.push({ id: 'exit-ally', text: '味方の退き口', x: Math.min(ex.ally.x + (nearExit ? 70 : 28), s.map.width / 2 - 25), z: ex.ally.z - 6, y: 0 });
    // 敵の退き口は敵本陣・予備隊（丘の上と後ろ）の名札と重ならないよう、東へ離して置く（狭い戦場では戦場の内側に収める）
    out.push({ id: 'exit-enemy', text: '敵の退き口', x: Math.min(ex.enemy.x + 75, s.map.width / 2 - 25), z: ex.enemy.z + 10, y: 0 });
    // 戦前の約束の安全地点（南の「味方の陣」）。輪（view.ts）の西の縁に名札
    const pz = s.pledge?.safeZone;
    if (pz) out.push({ id: 'safe-zone', text: '味方の陣（約束の安全地点）', x: pz.cx - pz.r - 30, z: pz.cz + 4, y: 0 });
    // 目標の区域（輪の南の縁に名札）
    for (const m of objectiveZoneMarks(s)) {
        const c = zoneCenter(m.zone);
        const south = m.zone.circle ? c.z + m.zone.circle.r : m.zone.rect ? m.zone.rect.z1 : c.z;
        const north = m.zone.circle ? c.z - m.zone.circle.r : m.zone.rect ? m.zone.rect.z0 : c.z;
        // 南の縁が戦場の外（南の端の陣など）なら、北の縁の内側に
        const z = south + 4 <= s.map.depth / 2 - 6 ? south + 4 : north + 12;
        // 用途のある区域（敵の突破口）は用途を頭に出す（味方の退き口と見分ける。第4群）
        const role = m.role === 'primary' ? '主目標' : '副目標';
        out.push({ id: `obj-${m.id}`, text: m.use ? `${m.use}：${m.name}（${role}）` : `${role}：${m.name}`, x: c.x, z, y: 0.5 });
    }
    // 援軍の出る所（部隊の名札と重ならないよう西へずらす）。
    // 同じ所（5 m 以内）から何度も出る援軍は 1 つの名札に時刻を並べる（城下町外縁の大通り：「開始 0:10・1:30」）。
    // 出る所が 2 つ以上なら、先に置いた名札（退き口・ほかの援軍）と重なるとき、西 → 東 → 真上 → 1 段南の順に空いた所へ置く。
    // 出る所が 1 つ以下の戦場（既存の 10 戦場）は今までと同じ所
    const reinfGroups: { id: string; x: number; z: number; ats: number[] }[] = [];
    for (const r of reinfs) {
        const g = reinfGroups.find((q) => Math.hypot(q.x - r.x, q.z - r.z) < 5);
        if (g) g.ats.push(r.at);
        else reinfGroups.push({ id: r.id, x: r.x, z: r.z, ats: [r.at] });
    }
    for (const g of reinfGroups) {
        const times = [...new Set(g.ats)].sort((a, b) => a - b).map(fmtClock).join('・');
        const text = `援軍の出る所（開始 ${times}）`;
        const clamp = (x: number) => Math.min(Math.max(x, -s.map.width / 2 + 30), s.map.width / 2 - 30);
        const west = Math.max(g.x - 70, -s.map.width / 2 + 30);
        let at = { x: west, z: g.z - 4 };
        if (reinfGroups.length > 1) {
            const clash = (x: number, z: number) =>
                out.some((l) => Math.abs(l.z - z) < REINF_LABEL_DZ && Math.abs(l.x - x) < (l.text.length + text.length) * LABEL_HALF_CHAR_M);
            const cand: { x: number; z: number }[] = [];
            for (let k = 0; k < 4; k++) for (const x of [west, clamp(g.x + 70), clamp(g.x)]) cand.push({ x, z: g.z - 4 + k * REINF_LABEL_DZ });
            at = cand.find((c) => !clash(c.x, c.z)) ?? at;
        }
        out.push({ id: `reinf-${g.id}`, text, x: at.x, z: at.z, y: 0 });
    }
    // 門（第3群）：門の南の前に、制圧の条件の短い説明。狭い正面の名札より先に置いて、そちらが避ける。
    // 門の制圧が目標（open_gate）の門は、目標の輪の名札に条件を書くので出さない
    const gateGoals = gateGoalIds(s);
    for (const g of s.field.gates) {
        if (gateGoals.has(g.def.id)) continue;
        const r = g.def.rect;
        out.push({ id: `gate-${g.def.id}`, text: gateLabelText(g.def), x: (r.x0 + r.x1) / 2, z: r.z1 + 6, y: (g.def.height ?? 6) * 0.5 });
    }
    // 狭い正面の区域（区域の北の端に名札）
    (s.setup.fieldRules?.specialRules ?? []).forEach((r, i) => {
        if (r.type !== 'narrow_frontage') return;
        const c = zoneCenter(r.zone);
        const north = r.zone.rect ? r.zone.rect.z0 : r.zone.circle ? c.z - r.zone.circle.r : c.z;
        const south = r.zone.rect ? r.zone.rect.z1 : r.zone.circle ? c.z + r.zone.circle.r : c.z;
        // 北の端の内側。ほかの名札（橋頭の目標など）と重なるなら、南の端の外 → 北の端の外の順に空いた所（どこも重なれば北の端の内側）
        const free = (z: number) => !out.some((l) => Math.abs(l.x - c.x) < 40 && Math.abs(l.z - z) < 14);
        const z = [north + 12, Math.min(south + 8, s.map.depth / 2 - 10), Math.max(north - 10, -s.map.depth / 2 + 10)].find(free) ?? north + 12;
        out.push({ id: `narrow-${i}`, text: `狭い正面（${r.maxEngaged} 部隊まで）`, x: c.x, z, y: 0.5 });
    });
    return out;
}

/**
 * 援軍の出る所の名札をほかの名札と重ねないための大きさ（m）：南北の隔たりと、1 字あたりの半分の幅
 * （全体を見る視点の北の端で 1 m ≒ 1.3 px・1 字 ≒ 12 px）
 */
const REINF_LABEL_DZ = 12;
const LABEL_HALF_CHAR_M = 4.5;

/** 制圧が目標（open_gate。段階目標の段も）になっている門の id。目標の輪と名札がその門の制圧の区域・条件を出す */
export function gateGoalIds(s: BattleState): Set<string> {
    const ids = new Set<string>();
    const walk = (d: ObjectiveDef): void => {
        if (d.type === 'open_gate') ids.add(d.gateId);
        else if (d.type === 'sequence') d.steps.forEach(walk);
    };
    for (const r of s.objectives?.list ?? []) walk(r.def);
    return ids;
}

/** 門の名札・説明の文（例：「外門：前の輪を敵なしで 20 秒占めると開く」） */
export function gateLabelText(g: GateDef): string {
    return `${g.name}：前の輪を敵なしで ${g.capture.sec} 秒占めると開く`;
}
