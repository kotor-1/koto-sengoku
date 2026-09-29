/**
 * 合戦の画面の決まりごと（純粋な TypeScript。three・DOM なし）。表示（view.ts）・UI（battleUi.ts）・つなぎ（entry.ts）が共通に使い、
 * テスト（tests/proto3d-battle-control.test.ts）で確かめる。
 * - 部隊の見た目：兵の人形の数（兵 25 人ごとに 1 体、最大 30 体）・隊列の並び・兵が減ったときに消える順。
 * - 地図を押したときに何をするか（選ぶ・移動・攻撃・敵を調べる）。
 * - 画面に出す言葉（部隊の札・勝ち負けの条件・結果・知らせ）。
 * - 見下ろしカメラの範囲。
 */
import type { AbilityId, BattleEndReason, BattleMap, BattleOutcome, BattleResultKind, Order, Side, UnitKind } from './types';
import { STATUS_LABEL, engagementLabel, hqOf, isActive, orderLabel, pledgeProgress, timeLeft, unitById, type BattleEvent, type BattleState, type UnitState } from './sim';
import { ABILITY_DATA, ABILITY_FICTION_NOTE, abilityInfo, abilityMarks, isRooted, type AbilityInfo } from './abilities';

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
 * ability：対象を選ぶ特殊能力（盟友への援護）の「能力」の後で、援護する味方の部隊を押す（Esc・やめるで取り消し）。
 */
export type Pending = 'none' | 'move' | 'attack' | 'ability';

/**
 * 地図を押した所。unit の near は「部隊そのもの（隊列の広がり）ではなく、そのすぐ近く（押しやすくするための余白）を押した」。
 * x, z は押した地面の位置。
 */
export type TapTarget =
    | { kind: 'unit'; unitId: string; side: Side; x: number; z: number; near?: boolean }
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
    | { type: 'order'; unitId: string; order: Order }
    | { type: 'deselect' }
    | { type: 'none' }
    /** 特殊能力（盟友への援護）の対象に、押した部隊を選ぶ（使えるかは useAbility が確かめる。断られても回数は減らない） */
    | { type: 'abilityTarget'; unitId: string }
    /** 何も変えず、案内を出す */
    | { type: 'hint'; text: string };

/**
 * 地図を押したときに何をするか（docs/chapter1-spec.md §4 表示と操作）。
 * - 味方の部隊を押す：その部隊を選ぶ（「移動」「攻撃」の途中でも、選び直しになる）。選んでいる部隊をもう一度押すと選択を外す
 *   （タッチでは Esc が無いので、これで外して敵を調べられる）。
 * - 味方を選んでいて敵を押す：攻撃（「移動」の途中なら、その地点へ移動）。味方を選んでいなければ、敵を調べる。
 * - 味方を選んでいて地面を押す：移動（「攻撃」の途中なら、敵を押すよう案内）。
 * - 命令できない味方（敗走・撤退済みなど）や敵を選んでいて地面を押す：選択を外す。
 * - 命令できる味方を選んでいて、味方の部隊の「すぐ近く」（near：隊列の外の余白）を押す：地面を押したのと同じ（その地点へ移動）。
 *   スマホの引いた画面でも、選んだ部隊を少しだけ動かす・味方の隣へ付ける、ができるように。選び直すには部隊そのものか札を押す。
 */
export function resolveTap(sel: Selected | null, pending: Pending, tap: TapTarget): TapAction {
    const ally = sel && sel.side === 'ally' ? sel : null;
    // 援護の対象を選んでいる途中：部隊（そのもの・すぐ近く、敵でも）を押したら対象に選ぶ（不適切なら useAbility が理由を返す）。地面は案内だけ
    if (pending === 'ability' && ally) {
        if (tap.kind === 'unit') return { type: 'abilityTarget', unitId: tap.unitId };
        return { type: 'hint', text: '援護する味方の部隊を押してください（やめる・Esc で取り消し）' };
    }
    if (tap.kind === 'unit' && tap.side === 'ally' && tap.near && ally && ally.commandable) return resolveTap(sel, pending, { kind: 'ground', x: tap.x, z: tap.z });
    if (tap.kind === 'unit' && tap.side === 'ally') return sel && sel.id === tap.unitId && pending === 'none' ? { type: 'deselect' } : { type: 'select', unitId: tap.unitId };
    if (tap.kind === 'unit') {
        if (ally && ally.commandable) {
            if (pending === 'move') return { type: 'order', unitId: ally.id, order: { type: 'move', x: tap.x, z: tap.z } };
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
        const left = abilityInfo(s, u.id)?.remainingSec ?? 0;
        return `${u.name}は「${ABILITY_DATA.tadakatsu_rearguard.name}」で踏みとどまっている（残り ${Math.ceil(left)} 秒。防衛・待機だけ受ける）`;
    }
    if (order.type === 'attack') {
        const t = unitById(s, order.targetId);
        if (!t || !isActive(t)) return 'その部隊はもう戦えません';
        if (!t.seenBy[u.side]) return 'その部隊は見えていません';
        if (t.side === u.side) return '味方は攻撃できません';
    }
    return '命令を出せませんでした';
}

/** 命令を出したときの短い知らせ */
export function orderAck(s: BattleState, unitId: string, order: Order): string {
    const u = unitById(s, unitId);
    const name = u?.name ?? '';
    switch (order.type) {
        case 'move':
            return `${name}：移動`;
        case 'attack':
            return `${name}：${unitById(s, order.targetId)?.name ?? '敵'}へ攻撃`;
        case 'hold':
            return `${name}：防衛・待機`;
        case 'retreat':
            return `${name}：撤退（南の退き口へ）`;
    }
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
    const hqText = !hq ? '―' : hq.status === 'ready' ? (hq.present ? '健在' : '到着待ち') : STATUS_LABEL[hq.status];
    return { hq: hqText, able: rest.filter((u) => u.status === 'ready').length, total: rest.length };
}

/** 勝ち負けの条件（画面の上の説明。短く） */
export const CONDITIONS: { label: string; text: string; tone: 'good' | 'bad' | 'info' }[] = [
    { label: '勝利', text: '敵本陣を敗走させる／敵の本陣以外をすべて崩す', tone: 'good' },
    { label: '敗北', text: '味方本陣の敗走／本陣以外の味方が崩れて戦えない', tone: 'bad' },
    { label: '撤退', text: '全軍撤退／本陣以外をすべて退かせる／日没', tone: 'info' },
];

export const RESULT_LABEL: Record<BattleResultKind, string> = { victory: '勝利', defeat: '敗北', retreat: '撤退' };
export const REASON_TEXT: Record<BattleEndReason, string> = {
    enemy_hq_routed: '敵本陣が崩れ、鷲尾勢は総崩れとなった',
    enemy_army_broken: '敵の本陣以外の部隊がすべて戦えなくなった',
    ally_hq_routed: '味方本陣が崩れた。若殿は家臣に守られて落ち延びた（討死ではない）',
    ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった。若殿は兵をまとめて落ち延びた',
    ordered_retreat: '撤退を命じ、兵をまとめて戦場を離れた',
    nightfall: '日が暮れ、両軍とも兵を引いた',
};

export interface ResultRow {
    id: string;
    name: string;
    side: Side;
    start: number;
    end: number;
    lost: number;
    status: string;
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
        rows.push({ id: r.id, name: u?.name ?? r.id, side: r.side, start: st, end: en, lost: st - en, status: r.status === 'ready' ? '健在' : STATUS_LABEL[r.status] });
        lost[r.side] += st - en;
        start[r.side] += st;
    }
    return { rows, lost, start };
}

/** 知らせの色分け（味方に良い・悪い・ふつう）。出さない知らせは null */
export function eventTone(s: BattleState, e: BattleEvent): 'good' | 'bad' | 'warn' | 'info' | null {
    if (e.kind === 'start' || e.kind === 'end') return null;
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

// ---------------------------------------------------------------- シナリオごとの言葉（架空の第一章・歴史分岐）

/** 画面の言葉のうち、シナリオで変わるもの */
export interface ScenarioTexts {
    /** 歴史分岐「元亀元年・家康」の合戦か（味方の本陣が徳川家） */
    historical: boolean;
    /** 画面の上の札（例：仮シナリオ） */
    tag: string;
    /** 合戦の前の説明の題の添え書き */
    titleNote: string;
    reasons: Record<BattleEndReason, string>;
    notes: Record<BattleResultKind, string>;
}

/**
 * シナリオの言葉。架空の第一章は今までと同じ（REASON_TEXT・鷲尾勢・若殿）。
 * 歴史分岐（味方の本陣が徳川家）は「1570年の情勢を背景にした架空の局地戦」とし、家康は落ち延びる（討死ではない）。
 */
export function scenarioTexts(s: BattleState): ScenarioTexts {
    const historical = hqOf(s, 'ally')?.clan === 'tokugawa';
    if (!historical) {
        return {
            historical,
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
        tag: '架空の局地戦',
        titleNote: '1570年の情勢を背景にした架空の局地戦',
        reasons: {
            enemy_hq_routed: `${enemy}が崩れ、敵勢は兵を引いた`,
            enemy_army_broken: '敵の本陣以外の部隊がすべて戦えなくなった',
            ally_hq_routed: '家康本陣が崩れた。家康は家臣に守られて落ち延びた（討死ではない）',
            ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった。家康は兵をまとめて落ち延びた',
            ordered_retreat: '撤退を命じ、兵をまとめて戦場を離れた',
            nightfall: '日が暮れ、両軍とも兵を引いた',
        },
        notes: {
            victory: 'この局地戦には勝った。一度の勝利で相手の家が滅ぶわけではない。',
            defeat: '敗れはしたが、家康は生きている。兵をまとめ直して次に備える。一度の敗北で家が滅ぶことはない。',
            retreat: '勝敗は決まらなかった。兵を失いすぎないうちに引いた。',
        },
    };
}

// ---------------------------------------------------------------- 特殊能力の表示（ゲーム用の創作）

function pct(mul: number): string {
    return `${Math.round(Math.abs(1 - mul) * 100)}%`;
}

/** 能力の短い説明（スマホでも収まる長さ。数値は ABILITY_DATA から） */
export function abilityShort(id: AbilityId): { target: string; effect: string; cost: string } {
    const d = ABILITY_DATA[id];
    switch (id) {
        case 'ieyasu_rally':
            return {
                target: `本陣の周り ${d.radius} m の味方`,
                effect: `士気 +${d.moraleBoost}・${d.durationSec} 秒 士気の低下 −${pct(d.areaMoraleLossMul)}・崩れにくい`,
                cost: `本陣の与える損害 ×${d.selfDealMul}・動き ×${d.selfSpeedMul}`,
            };
        case 'tadakatsu_rearguard':
            return {
                target: `その場で踏みとどまり、周り ${d.radius} m で退く味方`,
                effect: `${d.durationSec} 秒 退く味方の損害 −${pct(d.areaTakeMul)}・士気の低下 −${pct(d.areaMoraleLossMul)}`,
                cost: `動けない（撤退も不可）・受ける損害 ×${d.selfTakeMul}`,
            };
        case 'nagamasa_support':
            return {
                target: `${d.radius} m 以内の味方 1 部隊を選ぶ`,
                effect: `最大 ${d.durationSec} 秒 対象の損害 −${pct(d.areaTakeMul)}・士気の低下 −${pct(d.areaMoraleLossMul)}（${d.radius} m 離れると外れる）`,
                cost: `長政隊の与える損害 ×${d.selfDealMul}`,
            };
    }
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
    if (info.state === 'active' && info.target === 'ally_unit' && info.targetId) {
        const t = unitById(s, info.targetId);
        stateText += `・${t?.name ?? ''}${info.linked ? 'を援護中' : 'が離れて外れている'}`;
    }
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
        targetText: info.targetText,
        effectText: info.effectText,
        costText: info.costText,
        note: info.note,
        info,
    };
}

/** 部隊の札・名札に添える、能力の短い状態（能力がなければ空）。例：「号令 使える」「踏みとどまる 32 秒」「援護 済」 */
export function cardAbilityText(s: BattleState, unitId: string): string {
    const info = abilityInfo(s, unitId);
    if (!info) return '';
    const short = info.id === 'ieyasu_rally' ? '号令' : info.id === 'tadakatsu_rearguard' ? '守護' : '援護';
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
    return { targetId: p.targetId, title, status, tone };
}

/** 結果の画面の約束の欄（勝敗とは別）。架空の第一章は null。歴史分岐で引き受けていなければ「引き受けていない」 */
export function pledgeResultModel(s: BattleState, o: BattleOutcome): { result: 'kept' | 'broken' | 'declined'; title: string; text: string } | null {
    if (!scenarioTexts(s).historical) return null;
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
    const why = row && (row.status === 'routed' || row.status === 'destroyed') ? `${name}が${status}` : `${name}の兵が ${ratio}%（${Math.round((s.pledge?.minStrengthRatio ?? 0.4) * 100)}% 未満）`;
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
