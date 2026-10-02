/**
 * 戦場「谷間」（valley）の釣り合い（docs/fields-group2-design.md §4）。
 * 無計画な攻撃・地形に合わない作戦（放置・谷底を押し上がる・出口の塞ぎへ当たって近い敵へ当て直す・能力だけ使う・攻め手より先に中央を
 * 駆け抜ける）は、地形に合った作戦・準備した正面攻撃と比べて主目標に届かない・損害が大きい・崩せる敵が少ない（比べが合格条件。勝敗は記録
 * として書く）。準備した正面攻撃（谷の口で攻め手を討った後に、差配・弓で整えて谷底を押す）は主目標に届かないが、その結果と理由も記録する。
 * 地形に合った作戦は 2 つあり、どちらも 16 通りで安定して勝つ（選べる）：
 * - 高所を先に取る：西の高地へ南の端から登って高地の槍と弓を破り、高地の上を北へ進んで北の端から出口の西へ降りる。
 * - 中央を抜ける：谷の口で攻め手を討った後、騎馬で狭い口の塞ぎに当たって退き、塞ぎを谷底へ誘い出す。谷底の両脇で待つ隊が両側から
 *   挟んで崩し、空いた狭い口を抜ける。
 * どちらも忠勝隊と家康本陣は谷の口で谷を下ってくる攻め手を待って討つ（誘い込む）。谷底へ出て攻め手を迎えると、忠勝隊が両側から射られて崩れる。
 * 副目標（損害 2 割以内・出口の手前の塞ぎを崩す）は作戦で分かれる（高所を先に取る／中央を抜ける）。
 * 武将の能力の価値が地形で変わる比べ：石川の後詰めの差配（谷底を駆け抜ける部隊・高地の上の道を行く部隊）、
 * 忠勝の退路の守護（谷の口・谷底で、谷底から退く味方の殿）、酒井の両翼の采配（谷底へ誘い出した塞ぎ・狭い口の中の塞ぎを挟む）。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。移動の後の向き（face）は画面から指定できないので使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする（例：西の高地の弓 (-95,-5) の近くの (-95,10) を押すと、その弓への攻撃になる）。
 * 「見てから押す」行（when）は、人が画面で敵の動きを見てから押すのと同じく、その時刻から 1 秒ごとに様子を見て、整ったら押す
 * （例：塞ぎが騎馬に当たったのを見てから騎馬を退かせる。60 秒たっても整わなければ押さない）。
 * 数字（兵の残り・時間）は valley.ts の釣り合いの目安（作った時の値をコメントに残す）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, elevationAt, isActive, issueOrder, passableAt, runToEnd, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const VL = getField('valley')!;

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 能力を対象に使う（後詰めの差配。画面では能力の印を押してから対象の部隊を押す） */
interface AbilityOn {
    abilityOn: string;
}
type Command = Order | Tap | AbilityOn | 'ability' | 'nearest';
/** 見てから押す：when が整ったら then を出す（その時刻から 1 秒ごとに見る。60 秒たっても整わなければ出さない） */
interface When {
    when: (s: BattleState) => boolean;
    then: Command;
}
/**
 * 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」
 * （今の相手が戦えるなら出さない）
 */
type Step = [number, string, Command | When];
/** 見てから押すのを待つ長さ（秒） */
const WATCH_SEC = 60;

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
/** 本陣以外の槍・騎馬 */
const MELEE = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'];

function seenEnemies(s: BattleState) {
    return s.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally);
}
function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const cur = unitById(s, u.order.targetId);
        if (cur && isActive(cur)) return null;
    }
    const e = seenEnemies(s).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}
function tapOrder(s: BattleState, [x, z]: [number, number]): Order {
    const e = seenEnemies(s)
        .filter((u) => Math.hypot(u.x - x, u.z - z) <= 20)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return e ? atk(e.id) : { type: 'move', x, z };
}

interface Run {
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 見てから押す行のうち、整わずに押さなかったもの */
    skipped: string[];
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(VL, 'standard'));
    // [押す時刻, 部隊 id, 命令, 見始めた時刻]
    const q: [number, string, Command | When, number][] = steps.map(([t, id, c]) => [t, id, c, t]);
    q.sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const skipped: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, cmd, from] = q.shift()!;
            let ord: Command;
            if (typeof cmd === 'object' && 'when' in cmd) {
                if (!cmd.when(st)) {
                    if (t + 1 - from <= WATCH_SEC) {
                        q.push([t + 1, id, cmd, from]);
                        q.sort((a, b) => a[0] - b[0]);
                    } else skipped.push(`${from}:${id}`);
                    continue;
                }
                ord = cmd.then;
            } else ord = cmd;
            if (ord === 'nearest') {
                const n = nearestEnemy(st, id);
                if (n && !issueOrder(st, id, n)) refused.push(`${t}:${id}`);
            } else if (ord === 'ability') {
                if (!useAbility(st, id).ok) refused.push(`${t}:${id}`);
            } else if ('abilityOn' in ord) {
                if (!useAbility(st, id, ord.abilityOn).ok) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, 'tap' in ord ? tapOrder(st, ord.tap) : ord)) refused.push(`${t}:${id}`);
        }
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, skipped };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数。tests/proto3d-field-river_ford.test.ts と同じ作り方）の勝ち数と副目標の数 */
function jitterWins(base: Step[]): { wins: number; lossOk: number; blockOk: number; reserveOk: number } {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let wins = 0;
    let lossOk = 0;
    let blockOk = 0;
    let reserveOk = 0;
    for (let k = 0; k < 16; k++) {
        const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
        const r = play(steps);
        if (r.o.result === 'victory') wins++;
        if (secondaryOf(r, 'valley_losses')) lossOk++;
        if (secondaryOf(r, 'valley_block')) blockOk++;
        if (secondaryOf(r, 'valley_reserve')) reserveOk++;
    }
    return { wins, lossOk, blockOk, reserveOk };
}

// ---------------------------------------------------------------- 台本

/** 西の高地へ上がる四隊 */
const WEST_IDS = ['a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba'];
/** 出口の西寄りの行き先（狭い口の塞ぎの区域から離れた所。x -15〜-45） */
const EXIT_AT: Record<string, [number, number]> = { a_sakai: [-30, -190], a_ishikawa: [-15, -205], a_sakakibara: [-40, -205], a_kiba: [-45, -185] };
/** t 秒に四隊を出口へ。40 秒後にもう一度押す（途中で味方とつかえて止まった隊を出し直す。人が画面で見て押し直すのと同じ） */
const exitAt = (t: number): Step[] => WEST_IDS.flatMap((id) => [[t, id, tap(...EXIT_AT[id]!)] as Step, [t + 40, id, tap(...EXIT_AT[id]!)] as Step]);

/**
 * 高所を先に取る（0〜240 秒）：酒井隊・石川隊・榊原隊（騎馬）は西の高地の南の端へ上がり、30 秒に高地の槍へ当たる。徳川騎馬隊は後から続く。
 * 弓は南の端の坂の下から高地の槍を射る。100 秒に高地の弓（(-95,10) を押す＝弓への攻撃）へ進み、弓は高地の南へ上がる。
 * 240 秒に高地の上を北の端へ。忠勝隊と家康本陣は命令なし（谷の口で待ち、谷を下ってくる攻め手を迎える）
 */
const WEST: Step[] = [
    [0, 'a_sakai', tap(-95, 125)],
    [0, 'a_ishikawa', tap(-75, 135)],
    [0, 'a_sakakibara', tap(-115, 140)],
    [0, 'a_kiba', tap(-60, 155)],
    [0, 'a_yumi', tap(-70, 150)],
    [30, 'a_sakai', atk('e_w_guard')],
    [30, 'a_ishikawa', atk('e_w_guard')],
    [30, 'a_sakakibara', atk('e_w_guard')],
    [40, 'a_yumi', atk('e_w_guard')],
    [60, 'a_kiba', tap(-95, 100)],
    [100, 'a_sakai', tap(-95, 10)],
    [100, 'a_ishikawa', tap(-80, 10)],
    [100, 'a_sakakibara', tap(-110, 10)],
    [100, 'a_kiba', tap(-95, 40)],
    [100, 'a_yumi', tap(-95, 60)],
    [240, 'a_sakai', tap(-95, -150)],
    [240, 'a_ishikawa', tap(-80, -150)],
    [240, 'a_sakakibara', tap(-110, -150)],
    [240, 'a_kiba', tap(-95, -130)],
];
/** 地形に合った作戦（高所を先に取り、高地の上から出口の西へ降りる。谷の口で攻め手を待つ）：300 秒に出口へ。命令は 27 回 */
const FIT: Step[] = [...WEST, ...exitAt(300)];

/** 出口の手前の塞ぎ */
const block = (s: BattleState) => unitById(s, 'e_block')!;
/** 塞ぎが id の部隊に当たっている（斬り合っている・向かっている） */
const blockOn = (id: string) => (s: BattleState) => {
    const b = block(s);
    return b.engagedWith === id || (b.order.type === 'attack' && b.order.targetId === id);
};
/** 塞ぎが狭い口から谷底へ出てきた（z -95 より南。両脇で待つ隊の近く） */
const blockOut = (s: BattleState) => isActive(block(s)) && block(s).z > -95;
/** 塞ぎが崩れた */
const blockBroken = (s: BattleState) => !isActive(block(s));
/** 中央を抜けて出口の西寄りへ（狭い口の北で、出口の弓 (0,-195) の間合いの外） */
const CENTER_EXIT: Record<string, [number, number]> = { a_sakai: [-40, -175], a_tadakatsu: [-30, -182], a_sakakibara: [-50, -190], a_kiba: [-45, -200] };
/**
 * 中央を抜ける（t 秒から）：騎馬が狭い口の塞ぎ (0,-125) に当たり、塞ぎが当たってきたのを見てから谷の口 (0,165) へ退いて谷底へ誘い出す。
 * 酒井隊・忠勝隊（石川の後詰めの差配で急ぐ）は谷底の両脇 (∓32,-60)、榊原隊は西の脇 (-32,-20) で待ち、塞ぎが出てきたのを見てから
 * 両側から当たる（酒井の両翼の采配で挟む）。塞ぎが崩れたのを見てから、四隊で空いた狭い口を抜けて出口の西寄りへ
 */
const centerFrom = (t: number): Step[] => [
    [t, 'a_kiba', tap(0, -125)],
    [t, 'a_sakai', tap(-32, -60)],
    [t, 'a_tadakatsu', tap(32, -60)],
    [t, 'a_sakakibara', tap(-32, -20)],
    [t + 3, 'a_ishikawa', { abilityOn: 'a_tadakatsu' }],
    [t + 30, 'a_kiba', { when: blockOn('a_kiba'), then: tap(0, 165) }],
    [t + 55, 'a_sakai', { when: blockOut, then: atk('e_block') }],
    [t + 55, 'a_tadakatsu', { when: blockOut, then: atk('e_block') }],
    [t + 55, 'a_sakakibara', { when: blockOut, then: atk('e_block') }],
    [t + 60, 'a_sakai', { when: (s) => !!unitById(s, 'a_sakai')!.engagedWith, then: 'ability' }],
    ...Object.entries(CENTER_EXIT).map(([id, at]) => [t + 100, id, { when: blockBroken, then: tap(...at) }] as Step),
];
/** 谷の口で攻め手を待つ（酒井隊は谷の口の西、徳川騎馬隊は東の奥、弓は谷の口の後ろ。190 秒に榊原隊が攻め手の横へ） */
const MOUTH: Step[] = [
    [0, 'a_sakai', tap(-25, 150)],
    [0, 'a_kiba', tap(60, 185)],
    [0, 'a_yumi', tap(-20, 175)],
    [190, 'a_sakakibara', tap(-5, 125)],
];
/** 地形に合った作戦（中央を抜ける）：谷の口で攻め手と出口の騎馬を討ってから、250 秒に塞ぎを誘い出す。命令は 18 回 */
const CENTER: Step[] = [...MOUTH, ...centerFrom(250)];

/** 正面突破：槍・騎馬・弓の六隊で谷底を出口へ押し上がる */
const PUSH: Step[] = [...MELEE, 'a_yumi'].map((id, i) => [0, id, tap(-20 + (i % 3) * 20, -195)] as Step);

/**
 * 準備した正面攻撃（谷底を押し上がる）：前は「地形に合わない作戦」のテストの中にあった台本（LURE_PUSH）を、そのまま準備した正面攻撃として数える
 * （台本は 1 行も変えていない）。弓・酒井隊・石川隊・榊原隊・騎馬隊を谷の口の左右に置き、谷を下ってくる攻め手を 190 秒に討つ（予備を後から・
 * 兵種を合わせる）。240 秒に石川隊の後詰めの差配で忠勝隊を急がせて狭い口の塞ぎへ、250 秒に酒井隊も塞ぎへ、騎馬二隊は谷底の (∓10,-100) へ、
 * 弓は塞ぎを射る。310 秒に騎馬二隊も塞ぎへ、360・400 秒に近い敵へ当て直し、440 秒に出口へ。命令は 31 回。高地へは上がらず、塞ぎを誘い出さない
 */
const PREPARED: Step[] = [
    [0, 'a_yumi', tap(-85, 150)],
    [0, 'a_sakai', tap(-25, 150)],
    [0, 'a_ishikawa', tap(25, 160)],
    [0, 'a_sakakibara', tap(-40, 185)],
    [0, 'a_kiba', tap(40, 175)],
    [190, 'a_sakai', atk('e_raid1')],
    [190, 'a_kiba', atk('e_raid2')],
    [190, 'a_sakakibara', atk('e_raid1')],
    [240, 'a_ishikawa', { abilityOn: 'a_tadakatsu' }],
    [240, 'a_tadakatsu', atk('e_block')],
    [250, 'a_sakai', atk('e_block')],
    [250, 'a_sakakibara', tap(-10, -100)],
    [250, 'a_kiba', tap(10, -100)],
    [250, 'a_yumi', atk('e_block')],
    [310, 'a_sakakibara', atk('e_block')],
    [310, 'a_kiba', atk('e_block')],
    ...[360, 400].flatMap((t) => MELEE.map((id) => [t, id, 'nearest'] as Step)),
    ...MELEE.map((id, i) => [440, id, tap(-20 + (i % 3) * 20, -195)] as Step),
];

/** 命令の時刻を ±15 秒ずらした 16 通り（jitterWins と同じ作り方）の結果 */
function jitterRuns(base: Step[]): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) out.push(play(base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step)));
    return out;
}
const count = (rs: Run[], f: (r: Run) => boolean) => rs.filter(f).length;
/** 崩した（敗走・全滅させた）敵の部隊の数 */
const broken = (r: Run) => r.o.units.filter((u) => u.side === 'enemy' && u.status !== 'ready').length;

/** 比べの基準（同じ台本は 1 回だけ進める） */
const memo = new Map<Step[], Run>();
const run = (steps: Step[]): Run => {
    if (!memo.has(steps)) memo.set(steps, play(steps));
    return memo.get(steps)!;
};
const memo16 = new Map<Step[], ReturnType<typeof jitterWins>>();
const jitterOnce = (steps: Step[]) => {
    if (!memo16.has(steps)) memo16.set(steps, jitterWins(steps));
    return memo16.get(steps)!;
};

describe('谷間のデータ', () => {
    it('検査を通る。味方 7／敵 10（敵はすべて敵勢）。カプセルの丘 2 つ・崖 6 つ・谷底の道・狭い口の狭い正面（1 部隊）。主目標は突破（敵本陣の撃破ではない）', () => {
        expect(validateField(VL)).toEqual([]);
        const us = presetUnits(VL, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(10);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(VL.terrain.filter((t) => t.kind === 'hill')).toEqual([
            { kind: 'hill', capsule: { ax: -95, az: -120, bx: -95, bz: 110, r: 60 }, height: 14 },
            { kind: 'hill', capsule: { ax: 95, az: -120, bx: 95, bz: 110, r: 60 }, height: 14 },
        ]);
        expect(VL.terrain.filter((t) => t.kind === 'cliff')).toHaveLength(6);
        expect(VL.terrain.filter((t) => t.kind === 'road')).toHaveLength(1);
        expect(VL.highGround).toEqual({ defenseVsLower: 0.7, minDiff: 2, rangeBonus: 25, sightBonus: 0, arrowDealVsLower: 1.35 });
        expect(VL.specialRules).toEqual([{ type: 'narrow_frontage', zone: { rect: { x0: -16, x1: 16, z0: -170, z1: -130 } }, maxEngaged: 1 }]);
        expect(VL.objectives.primary).toMatchObject({ id: 'valley_break', type: 'breakthrough', count: 3 });
        expect(VL.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['valley_reserve', 'preserve_unit'],
            ['valley_losses', 'limit_losses'],
            ['valley_block', 'break_unit'],
        ]);
        expect(VL.objectives.secondary[2]).toMatchObject({ unitId: 'e_block' });
        // 主目標・副目標は結果に別々に入る
        const s = createBattle(buildBattleSetup(VL, 'standard'));
        expect(s.objectives!.primary!.def.id).toBe('valley_break');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual(['valley_reserve', 'valley_losses', 'valley_block']);
    });

    it('地形の形：谷底の途中からは高地へ登れない（両側の壁は崖）。高地へは南の端から登れ、北の端から出口の西へ降りられる。出口の手前は幅 32 m の狭い口', () => {
        const s = createBattle(buildBattleSetup(VL, 'standard'));
        // 谷底は通れて、両側の壁は崖
        for (const z of [-120, -60, 0, 60]) {
            expect(passableAt(s, 0, z)).toBe(true);
            expect(passableAt(s, -30, z)).toBe(true);
            expect(passableAt(s, -42, z)).toBe(false);
            expect(passableAt(s, 42, z)).toBe(false);
        }
        // 狭い口：x -16〜16 だけ通れる
        expect(passableAt(s, 0, -150)).toBe(true);
        for (const x of [-30, -20, 20, 30]) expect(passableAt(s, x, -150)).toBe(false);
        // 南の端（谷の口の左右）と、北の端から出口の西へ降りる所は通れる
        expect(passableAt(s, -60, 120)).toBe(true);
        expect(passableAt(s, -60, -175)).toBe(true);
        // 高さ：高地の上（線分の上）は 14 m、谷底は 0 m
        expect(elevationAt(s.map, -95, 0)).toBeCloseTo(14, 5);
        expect(elevationAt(s.map, 0, 0)).toBe(0);
    });

    it('敵の考え：高地の槍は南の端の登り口の区域、弓は持ち場（谷底の真ん中を射る）。狭い口の塞ぎは口から 30 m に来た相手に当たり、退く相手を谷の口まで追う。出口の騎馬は後詰め。攻め手は 75 秒に着いて谷の口へ', () => {
        const us = presetUnits(VL, 'standard').filter((u) => u.side === 'enemy');
        expect(Object.fromEntries(us.map((u) => [u.id, u.aiRole]))).toEqual({
            e_hq: 'guard_hq',
            e_block: 'hold_zone',
            e_w_yumi: 'hold_line',
            e_w_guard: 'hold_zone',
            e_e_yumi: 'hold_line',
            e_e_guard: 'hold_zone',
            e_x_yumi: 'hold_line',
            e_kiba: 'reserve',
            e_raid1: 'assault',
            e_raid2: 'assault',
        });
        const raid = us.find((u) => u.id === 'e_raid1')!;
        expect(raid.arriveAt).toBe(75);
        expect(raid.aiTarget).toEqual({ x: 0, z: 150, r: 30 });
        const reach = RULES.bowRange + VL.highGround!.rangeBonus!;
        const slot = (id: string) => VL.deployments.enemy.find((d) => d.id === id)!;
        for (const id of ['w_archers', 'e_archers']) {
            const a = slot(id);
            // 高地の弓は谷底の真ん中 (0,0)・(0,-100) に届き、谷の口 (0,150) と味方の最初の位置には届かない
            expect(Math.hypot(a.x, a.z)).toBeLessThan(reach);
            expect(Math.hypot(a.x, a.z + 100)).toBeLessThan(reach);
            expect(Math.hypot(a.x, a.z - 150)).toBeGreaterThan(reach);
            for (const d of VL.deployments.ally) expect(Math.hypot(d.x - a.x, d.z - a.z)).toBeGreaterThan(reach);
        }
        // 狭い口の塞ぎ：口から 30 m（区域 20 m ＋ 10 m）に来た相手に当たる。出口の西寄りの行き先には当たらない
        const g = us.find((u) => u.id === 'e_block')!.aiTarget!;
        expect(g).toEqual({ x: 0, z: -150, r: 20 });
        const p = VL.objectives.primary;
        if (p.type !== 'breakthrough') throw new Error('breakthrough のはず');
        for (const [x, z] of Object.values(EXIT_AT)) {
            expect(inZone(p.zone, x, z)).toBe(true);
            expect(Math.hypot(x - g.x, z - g.z)).toBeGreaterThan(g.r! + 10);
        }
        // 中央を抜ける行き先も出口の区域の中
        for (const [x, z] of Object.values(CENTER_EXIT)) expect(inZone(p.zone, x, z)).toBe(true);
        // 追う距離（区域の縁から 320 m）：塞ぎは、当たった相手が谷の口 (0,165) まで退いても（見えている間は）追う（誘い出せる）。ほかの部隊は既定のまま
        const leash = us.find((u) => u.id === 'e_block')!.aiLeash!;
        expect(leash).toBe(320);
        expect(g.r! + leash).toBeGreaterThan(Math.hypot(0 - g.x, 165 - g.z));
        expect(us.filter((u) => u.aiLeash !== undefined).map((u) => u.id)).toEqual(['e_block']);
    });
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（地形に合った作戦・準備した正面攻撃と比べて、主目標に届かない・
// 損害が大きい・16 通りの勝ちが少ない・崩せる敵が少ない）。無計画な攻撃の勝敗は「記録」として残す（台本と数字は前のまま。変わったら
// 理由と前後の数字を書いて直す）。前にここにあった「谷の口で攻め手を討ってから谷底を押し上がる」は、準備した正面攻撃（PREPARED）として下へ移した
describe('谷間：無計画な攻撃・地形に合わない作戦と、地形に合った作戦の比べ（早送り）', () => {
    it('何もしない → 地形に合った作戦（勝ち）と違い、主目標に届かない（記録：抜けられず日没。谷の口へ来た攻め手は、待っている忠勝隊が迎える）', () => {
        const r = run([]);
        expect(run(FIT).o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
    });

    it('正面突破：六隊で谷底を出口へ押し上がる（無計画）→ 地形に合った作戦より損害が大きく、主目標に届かず、準備した正面攻撃より崩せる敵が少ない（記録：両側から射られ、狭い口で止められ、谷を下ってくる攻め手とぶつかって負ける。作った時 179 秒・損害 52.3％）。家康本陣も一緒でも負け', () => {
        const r = run(PUSH);
        // 確かめた時：179.2 秒に負け・損害 52.3％・崩した敵 0 ／ 高所を先に取る 勝ち・16.3％ ／ 準備した正面攻撃 477.6 秒に負け・崩した敵 4
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.25);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(broken(r)).toBeLessThan(broken(run(PREPARED)));
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.4);
        const all = run([...PUSH, [0, 'a_ieyasu', tap(0, -195)]]);
        expect(all.o.objectives!.primary!.achieved).toBe(false);
        // 記録（確かめた時：185.9 秒に負け・損害 60.6％）
        expect(all.o.result).toBe('defeat');
    });

    it('全部隊で塞ぎへ当たり、30 秒ごとに近い敵へ当て直す（無計画）→ 地形に合った作戦より損害が大きく、主目標に届かない。能力も使う（先駆け・号令・両翼・後詰めの差配で忠勝隊を急がせる）→ 同じ（記録：負ける。作った時 214 秒・損害 51.1％ と 45.8％）', () => {
        const again = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].flatMap((t) => MELEE.map((id) => [t, id, 'nearest'] as Step));
        const r = run([...MELEE.map((id) => [0, id, atk('e_block')] as Step), [0, 'a_yumi', atk('e_block')], ...again]);
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.25);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.4);
        const ab = run([...PUSH, [5, 'a_ishikawa', { abilityOn: 'a_tadakatsu' }], [25, 'a_sakakibara', 'ability'], [60, 'a_ieyasu', 'ability'], [100, 'a_sakai', 'ability']]);
        expect(ab.refused).toEqual([]);
        expect(ab.loss).toBeGreaterThan(run(FIT).loss + 0.25);
        expect(ab.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(ab.o.result).not.toBe('victory');
        expect(ab.loss).toBeGreaterThan(0.4);
    });

    // 確かめた時（乱数の種 7）：16 通りで 2 勝（勝っても 178・192 秒・損害 35〜40％）、ほかは負けか日没（損害 46〜61％）
    it('攻め手より先に中央を駆け抜ける（すぐ騎馬で塞ぎを誘い出し、両脇の隊で挟んでから狭い口を抜ける）→ 攻め手を討ってから同じ手順で抜ける作戦より損害が大きく、16 通りの勝ちが少ない（記録：75 秒に出口へ現れた攻め手に止められ、谷底で射られて負ける。作った時 287 秒に負け・損害 47.7％。±15 秒の 16 通りでも勝ちは 3 以下）', () => {
        const EARLY = centerFrom(0);
        const r = run(EARLY);
        const w = jitterOnce(EARLY).wins;
        // 確かめた時：早すぎる 2 勝 ／ 攻め手を討ってから（CENTER）16 勝・24.6％
        expect(r.loss).toBeGreaterThan(run(CENTER).loss + 0.15);
        expect(w + 10).toBeLessThanOrEqual(jitterOnce(CENTER).wins);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.4);
        expect(w).toBeLessThanOrEqual(3);
    }, 90_000);
});

describe('谷間：地形に合った作戦（早送り）', () => {
    it('高所を先に取る：西の高地の槍・弓を破り、高地の上を北へ進んで出口の西へ降りる。谷の口では忠勝隊が攻め手を迎える → 勝つ（作った時 311 秒・損害 16.3％）', () => {
        let onHeight = false;
        const entries: Record<string, { x: number; z: number }> = {};
        const p = VL.objectives.primary;
        if (p.type !== 'breakthrough') throw new Error('breakthrough のはず');
        const r = play(FIT, (s) => {
            // 高地へ上がった隊が、高地の上（高さ 10 m 以上）で高地の弓と斬り合った
            for (const id of WEST_IDS) {
                const k = unitById(s, id)!;
                if (k.engagedWith === 'e_w_yumi' && elevationAt(s.map, k.x, k.z) > 10) onHeight = true;
            }
            for (const u of s.units) if (u.side === 'ally' && !entries[u.id] && inZone(p.zone, u.x, u.z)) entries[u.id] = { x: u.x, z: u.z };
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(r.loss).toBeLessThan(0.2);
        expect(onHeight).toBe(true);
        // 高地の槍・弓は崩れ、狭い口の塞ぎは無傷（出口の西から入ったので当たっていない）
        expect(statusOf(r, 'e_w_guard')).not.toBe('ready');
        expect(statusOf(r, 'e_w_yumi')).not.toBe('ready');
        expect(r.left.e_block).toBe(450);
        // 抜けた隊は、出口の西寄り（x -25 より西）から入った（3 隊目が入った刻みで合戦が終わるので、見えるのは先の 2 隊）
        const ids = Object.keys(entries);
        expect(ids.length).toBeGreaterThanOrEqual(2);
        for (const id of ids) {
            expect(WEST_IDS).toContain(id);
            expect(entries[id]!.x).toBeLessThan(-25);
        }
        // 谷の口で待った忠勝隊は崩れず、攻め手は二隊とも崩れる
        expect(statusOf(r, 'a_tadakatsu')).toBe('ready');
        expect(statusOf(r, 'e_raid1')).not.toBe('ready');
        expect(statusOf(r, 'e_raid2')).not.toBe('ready');
        // 正面突破（損害 5 割超・負け）と比べて、損害は 3 分の 1 ほど
        expect(r.loss).toBeLessThan(play(PUSH).loss - 0.25);
    });

    it('中央を抜ける：谷の口で攻め手を討った後、騎馬で塞ぎを谷底へ誘い出し、両脇で待つ隊が両側から挟んで崩してから、空いた狭い口を抜ける → 勝つ（作った時 389 秒・損害 24.6％）', () => {
        let blockFar = -Infinity;
        let brokeAt: { t: number; z: number } | null = null;
        const entries: string[] = [];
        const p = VL.objectives.primary;
        if (p.type !== 'breakthrough') throw new Error('breakthrough のはず');
        const r = play(CENTER, (s) => {
            const b = block(s);
            if (isActive(b)) blockFar = Math.max(blockFar, b.z);
            else if (!brokeAt) brokeAt = { t: s.t, z: b.z };
            for (const u of s.units) if (u.side === 'ally' && !entries.includes(u.id) && inZone(p.zone, u.x, u.z)) entries.push(u.id);
        });
        expect(r.refused).toEqual([]);
        expect(r.skipped).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        // 塞ぎは狭い口（z -170〜-130）を出て谷底まで誘い出され（作った時 z -79 まで）、谷底で崩れた（作った時 327.1 秒・z -79）
        expect(blockFar).toBeGreaterThan(-95);
        expect(brokeAt).not.toBeNull();
        expect(brokeAt!.z).toBeGreaterThan(-125);
        expect(statusOf(r, 'e_block')).not.toBe('ready');
        // 攻め手は二隊とも谷の口で崩れる。抜けたのは中央を抜ける四隊のうち（作った時 榊原隊・忠勝隊の後に 3 隊目が入って終わる）
        expect(statusOf(r, 'e_raid1')).not.toBe('ready');
        expect(statusOf(r, 'e_raid2')).not.toBe('ready');
        expect(entries.length).toBeGreaterThanOrEqual(2);
        for (const id of entries) expect(Object.keys(CENTER_EXIT)).toContain(id);
        // 高地の槍・弓には当たっていない
        expect(r.left.e_w_guard).toBe(400);
        expect(r.left.e_w_yumi).toBe(220);
        // 谷底で射られる分、高所を先に取る（16.3％）より損害は大きいが、正面突破（損害 5 割超・負け）よりずっと小さい
        expect(r.loss).toBeGreaterThan(play(FIT).loss);
        expect(r.loss).toBeLessThan(play(PUSH).loss - 0.2);
    });

    // 確かめた時（乱数の種 7）：高所を先に 15 勝（損害 2 割以内 12・塞ぎ 0・予備 15。前の釣り合いの時は 16 勝で、エンジンの道探しの直しの後に
    // 1 通り（#2）が日没になった。塞ぎの追う距離を足しても 16 通りとも 1 刻みも変わらない）、中央を抜ける 16 勝（損害 2 割以内 0・塞ぎ 16・予備 16）、
    // 正面突破 0 勝（16 通りとも負け）
    // 参考に種 1〜6・11 でも数えた：高所を先に 15〜16 勝（損害 2 割以内 9〜13・塞ぎ 0）、中央を抜ける 16 勝（損害 2 割以内 0・塞ぎ 16・損害の平均 25.7〜26.9％）、
    // 攻め手より先に駆け抜ける 1〜4 勝（損害の平均 46.7〜50.8％）
    it('命令の時刻を ±15 秒ずらした 16 通り：高所を先に取る・中央を抜ける作戦は 14 通り以上で勝ち、正面突破より勝ちが多い（確かめた時 15 勝・16 勝・0 勝）', () => {
        expect(jitterOnce(FIT).wins).toBeGreaterThanOrEqual(14);
        expect(jitterOnce(CENTER).wins).toBeGreaterThanOrEqual(14);
        expect(jitterOnce(FIT).wins).toBeGreaterThan(jitterOnce(PUSH).wins + 10);
        // 記録：正面突破はずらしても勝たない
        expect(jitterOnce(PUSH).wins).toBe(0);
    }, 60_000);

    it('敵を谷へ誘い込む：谷の口で待つ代わりに、忠勝隊が谷底へ出て攻め手を迎える → 両側の高地から射られて忠勝隊が崩れ、家康本陣も崩れて負ける（作った時 忠勝隊が 179.5 秒に崩れ、267 秒に負け）', () => {
        const MEET: Step[] = [...FIT, [100, 'a_tadakatsu', tap(0, 30)]];
        let tadaBroke = -1;
        const r = play(MEET, (s) => {
            if (tadaBroke < 0 && unitById(s, 'a_tadakatsu')!.status !== 'ready') tadaBroke = s.t;
        });
        expect(r.refused).toEqual([]);
        expect(tadaBroke).toBeGreaterThan(0);
        expect(r.o.result).toBe('defeat');
        // 谷の口で待つ作戦では、忠勝隊は最後まで崩れない（上の確かめ）。16 通りでも谷底で迎えると勝ちは半分以下（作った時 5 勝）
        expect(jitterWins(MEET).wins).toBeLessThanOrEqual(8);
    }, 60_000);
});

describe('谷間：副目標は作戦で分かれる（早送り）', () => {
    it('高所を先に取る → 損害 2 割以内 ✓・塞ぎ ✗（塞ぎに当たらない）。中央を抜ける → 塞ぎ ✓・損害 2 割以内 ✗（谷底で射られる）。予備（石川隊）はどちらも ✓。勝ち負け・主目標・副目標は別の欄', () => {
        const fit = play(FIT);
        const mid = play(CENTER);
        expect(fit.o.result).toBe('victory');
        expect(mid.o.result).toBe('victory');
        expect(fit.o.objectives!.primary!.achieved).toBe(true);
        expect(mid.o.objectives!.primary!.achieved).toBe(true);
        const sec = (r: Run) => [secondaryOf(r, 'valley_reserve'), secondaryOf(r, 'valley_losses'), secondaryOf(r, 'valley_block')];
        expect(sec(fit)).toEqual([true, true, false]);
        expect(sec(mid)).toEqual([true, false, true]);
        // 作った時：高所を先に 311 秒・損害 16.3％、中央を抜ける 389 秒・損害 24.6％
        expect(mid.loss).toBeGreaterThan(fit.loss);
    });

    it('±15 秒の 16 通り：高所を先に取る作戦は塞ぎを崩さず、損害 2 割以内が多い。中央を抜ける作戦は塞ぎを必ず崩し、損害 2 割以内は少ない（確かめた時 損害 12・塞ぎ 0 と 損害 0・塞ぎ 16。予備はどちらも 14 以上）', () => {
        const fit = jitterWins(FIT);
        const mid = jitterWins(CENTER);
        expect(fit.blockOk).toBe(0);
        expect(fit.lossOk).toBeGreaterThanOrEqual(10);
        expect(mid.blockOk).toBeGreaterThanOrEqual(14);
        expect(mid.lossOk).toBeLessThanOrEqual(3);
        expect(fit.reserveOk).toBeGreaterThanOrEqual(14);
        expect(mid.reserveOk).toBeGreaterThanOrEqual(14);
    }, 60_000);
});

describe('谷間：武将の能力の価値が地形で変わる（早送り）', () => {
    // 石川の後詰めの差配（対象の動き ×1.8・30 秒。石川隊は差配に専念して動けない）
    // 谷底：忠勝隊が谷の口 (0,150) から谷底を狭い口の手前 (0,-110) まで駆ける（両側の高地の弓の届く所を通る）。12 秒に差配で急がせる
    // 高地の上の道：高所を先に取る作戦で、高地の弓を破った後の 240 秒に、北の端へ向かう酒井隊を急がせる（もう射る弓がいない）
    it('石川の後詰めの差配：谷底を駆け抜ける部隊に使うと、射られる時間が短くなり損害が大きく減る。弓を破った後の高地の上の道で使っても、早く抜けられない', () => {
        const floorRun = (use: boolean) => {
            const st: Step[] = [
                [0, 'a_tadakatsu', tap(0, -110)],
                [0, 'a_ishikawa', tap(20, 150)],
            ];
            if (use) st.push([12, 'a_ishikawa', { abilityOn: 'a_tadakatsu' }]);
            let arrive = -1;
            let lost = 0;
            const r = play(st, (s) => {
                const u = unitById(s, 'a_tadakatsu')!;
                if (arrive < 0 && u.z < -100) {
                    arrive = s.t;
                    lost = 450 - u.strength;
                }
            });
            return { r, arrive, lost };
        };
        const no = floorRun(false);
        const use = floorRun(true);
        expect(use.r.refused).toEqual([]);
        // 谷底（作った時）：口の手前に着くのが 69.5 → 45.6 秒、それまでに射られた兵が 156 → 91
        expect(no.arrive).toBeGreaterThan(0);
        expect(use.arrive).toBeLessThan(no.arrive - 15);
        expect(no.lost).toBeGreaterThan(120);
        expect(use.lost).toBeLessThan(no.lost - 45);

        // 高地の上の道（作った時）：勝つ時刻は 311 → 316 秒（早くならない）、損害は 16.3％のまま。酒井隊は差配の 30 秒にほとんど兵を失わない（射る弓がもういない）
        const sakaiLost = (steps: Step[]) => {
            let a = -1;
            let b = -1;
            const r = play(steps, (s) => {
                const k = unitById(s, 'a_sakai')!;
                if (a < 0 && s.t >= 240 - 1e-9) a = k.strength;
                if (b < 0 && s.t >= 270 - 1e-9) b = k.strength;
            });
            return { r, lost: a - b };
        };
        const hNo = sakaiLost(FIT);
        const hUse = sakaiLost([...FIT, [240, 'a_ishikawa', { abilityOn: 'a_sakai' }]]);
        expect(hUse.r.refused).toEqual([]);
        expect(hUse.r.o.result).toBe('victory');
        expect(hUse.r.o.elapsedSec).toBeGreaterThanOrEqual(hNo.r.o.elapsedSec);
        expect(Math.abs(hUse.r.loss - hNo.r.loss)).toBeLessThan(0.01);
        expect(hNo.lost).toBeLessThan(10);
        expect(hUse.lost).toBeLessThan(10);
        // 同じ能力で、射られずに済んだ兵：谷底は 40 を超え、高地の上の道はほとんど無い（10 未満）
        expect(no.lost - use.lost).toBeGreaterThan(40);
        expect(Math.abs(hNo.lost - hUse.lost)).toBeLessThan(10);
    });

    // 忠勝の退路の守護（50 秒・半径 100 m で退く味方の受ける損害 −80％・追う敵を引きつける。忠勝隊は動けず、受ける損害 ×1.4）
    // 谷底から退く：酒井隊・石川隊・榊原隊・徳川騎馬隊・弓が谷底 (z -60 あたり) まで押し上がり、100 秒に撤退する
    // 谷の口：忠勝隊は谷の口 (0,150) で待ち、100 秒に使う。谷底：忠勝隊も谷底 (0,-20) まで出て、100 秒にそこで使う
    it('忠勝の退路の守護：谷の口（高地の弓の届かない所）で使うと、退く味方の損害が減り忠勝隊も無傷。谷底で使うと、動けないまま射られて忠勝隊が早く崩れる', () => {
        const G = ['a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
        const probe = (tada: Step[], use: boolean) => {
            const st: Step[] = [
                ...G.map((id, i) => [0, id, tap(-20 + (i % 3) * 20, -60 + Math.floor(i / 3) * 25)] as Step),
                ...G.map((id) => [100, id, { type: 'retreat' }] as Step),
                ...tada,
            ];
            if (use) st.push([100, 'a_tadakatsu', 'ability']);
            const sum = (s: BattleState) => G.reduce((a, id) => a + unitById(s, id)!.strength, 0);
            const at: { g0?: number; g1?: number; t0?: number; t1?: number } = {};
            let broke = -1;
            const r = play(st, (s) => {
                const t = unitById(s, 'a_tadakatsu')!;
                if (at.g0 === undefined && s.t >= 100 - 1e-9) {
                    at.g0 = sum(s);
                    at.t0 = t.strength;
                }
                if (at.g1 === undefined && s.t >= 150 - 1e-9) {
                    at.g1 = sum(s);
                    at.t1 = t.strength;
                }
                if (broke < 0 && t.status !== 'ready') broke = s.t;
            });
            return { r, runLost: at.g0! - at.g1!, tadaLost: at.t0! - at.t1!, broke };
        };
        const mouthNo = probe([], false);
        const mouthUse = probe([], true);
        const floorNo = probe([[0, 'a_tadakatsu', tap(0, -20)]], false);
        const floorUse = probe([[0, 'a_tadakatsu', tap(0, -20)]], true);
        for (const p of [mouthUse, floorUse]) expect(p.r.refused).toEqual([]);
        // 谷の口（作った時）：退く五隊の 50 秒の損害 136 → 104、忠勝隊は 0 → 0 で崩れない
        expect(mouthUse.runLost).toBeLessThan(mouthNo.runLost - 20);
        expect(mouthUse.tadaLost).toBe(0);
        expect(mouthUse.broke).toBe(-1);
        // 谷底（作った時）：忠勝隊が崩れるのが 163.8 → 129.0 秒と早まり、退く五隊の損害は減らない（43 → 52）
        expect(floorNo.broke).toBeGreaterThan(0);
        expect(floorUse.broke).toBeGreaterThan(0);
        expect(floorUse.broke).toBeLessThan(floorNo.broke - 20);
        expect(floorUse.runLost).toBeGreaterThanOrEqual(floorNo.runLost);
    });

    // 酒井の両翼の采配（25 秒・半径 100 m の味方が 2 つ以上の向きから挟むと包囲：側背の当たり ×1.8・その敵の損害 ×1.3・士気の低下 ×2）
    // 谷底：中央を抜ける作戦で、谷底へ誘い出した塞ぎに三隊が両側から当たり、酒井隊が斬り合い始めたら使う（使わない台本と比べる）
    // 狭い口：忠勝隊・酒井隊・榊原隊が初めから狭い口の塞ぎへ当たり、60 秒（三隊とも口に着いた後）に使う（使わない台本と比べる）
    it('酒井の両翼の采配：谷底へ誘い出した塞ぎを両側から挟んで使うと包囲になり、塞ぎが早く崩れる。狭い口の中の塞ぎに使っても、1 部隊しか当たれず包囲にならない', () => {
        // from 秒から 25 秒のあいだに塞ぎが失った兵（from を省けば酒井隊が能力を使った時から）・包囲されていた秒数・塞ぎが崩れた時刻
        const probe = (steps: Step[], from?: number) => {
            let enc = 0;
            let broke = -1;
            let usedAt = -1;
            let at0 = -1;
            let at25 = -1;
            const r = play(steps, (s) => {
                if (s.encircled.includes('e_block')) enc += RULES.tick;
                const b = block(s);
                if (broke < 0 && b.status !== 'ready') broke = s.t;
                if (usedAt < 0 && s.abilityList.some((x) => x.unitId === 'a_sakai' && x.usedAt !== null)) usedAt = s.t;
                const w = from ?? usedAt;
                if (w >= 0 && at0 < 0 && s.t >= w - 1e-9) at0 = b.strength;
                if (w >= 0 && at25 < 0 && s.t >= w + 25 - 1e-9) at25 = b.strength;
            });
            return { r, enc, broke, usedAt, lost25: at0 >= 0 && at25 >= 0 ? at0 - at25 : -1 };
        };
        const noSakai = (steps: Step[]) => steps.filter(([, id, c]) => !(id === 'a_sakai' && typeof c === 'object' && 'when' in c && c.then === 'ability'));
        const openUse = probe(CENTER);
        const openNo = probe(noSakai(CENTER), openUse.usedAt);
        expect(openUse.r.refused).toEqual([]);
        expect(openUse.usedAt).toBeGreaterThan(0);
        expect(openNo.usedAt).toBe(-1);
        // 谷底（作った時）：324 秒に使い、包囲 3.1 秒で塞ぎは 327.1 秒（3.1 秒後）に崩れる。使わないと包囲 0 秒で 334.8 秒（10.8 秒後）
        expect(openUse.enc).toBeGreaterThan(2);
        expect(openNo.enc).toBe(0);
        expect(openUse.broke - openUse.usedAt).toBeLessThan(5);
        expect(openNo.broke - openUse.usedAt).toBeGreaterThan(8);
        expect(openUse.r.o.result).toBe('victory');
        const NECK: Step[] = [
            [0, 'a_tadakatsu', atk('e_block')],
            [0, 'a_sakai', atk('e_block')],
            [0, 'a_sakakibara', atk('e_block')],
        ];
        const neckUse = probe([...NECK, [60, 'a_sakai', 'ability']]);
        const neckNo = probe(NECK, 60);
        expect(neckUse.r.refused).toEqual([]);
        // 狭い口（作った時）：60 秒に使っても包囲 0 秒。25 秒で塞ぎが失う兵は使っても使わなくても 38.5 で、塞ぎは崩れず勝てない
        expect(neckUse.usedAt).toBeGreaterThan(0);
        expect(neckUse.enc).toBe(0);
        expect(neckNo.enc).toBe(0);
        expect(Math.abs(neckUse.lost25 - neckNo.lost25)).toBeLessThan(1);
        expect(neckUse.broke).toBe(-1);
        expect(neckNo.broke).toBe(-1);
        expect(neckUse.r.o.result).not.toBe('victory');
        // 同じ能力で、塞ぎが崩れるまで：谷底は使えば 5 秒かからない。狭い口では使っても何も変わらない
    });
});

// 谷間では準備した正面攻撃（谷底を押し上がる）は主目標に届かない（16 通りで 0 勝）。理由：谷底は 300 m ほど両側の高地の弓（高所から
// 射程 +25 m・矢の損害 ×1.35）に射られ続け、狭い口（1 部隊しか当たれない）では塞ぎ（450）と出口の弓が待つ。攻め手を先に討ち、差配で急がせ、
// 弓で塞ぎを射ても、塞ぎを崩す前後に当たった隊が次々に敗走し、戦える 3 部隊が出口へ届かない（戦える部隊が足りなくなると主目標を果たせなく
// なって負ける）。台本を変えても同じだった（確かめた時：攻め手を討ってから四隊で塞ぎへ・差配・采配 → 日没・損害 53.4％・16 通りで 0 勝 12 敗、
// 弓で西の高地の弓を射ながら谷底の西寄りを登る → 日没・56.9％・0 勝 7 敗。どちらも採らず、前からの台本を残した）。
// 無計画な正面突破と比べて良いのは「負けが少ない（16 → 8）・塞ぎを崩せる（0 → 10 通り）・崩せる敵が多い」で、損害の割合は同じくらい
describe('谷間：準備した正面攻撃（早送り）', () => {
    it('谷の口で攻め手を討ってから谷底を押し上がる（石川の差配で忠勝隊を先に口へ・弓も塞ぎを射る・近い敵へ当て直す）（記録：477.6 秒に負け・損害 56.9％・崩した敵 4 隊。塞ぎは崩せない並び）', () => {
        const r = run(PREPARED);
        // 記録（前は「地形に合わない作戦」として書いていた数字。台本も同じ）：負け・損害 56.9％・塞ぎは残る・16 通りで 0 勝。
        // 「準備した正面攻撃は勝てない」は合格条件にしない（設計 §1。前はここで負け・塞ぎが残る・0 勝を expect していた）。
        // 合格条件は地形に合った作戦との比べ：損害が 2 割以上大きく、16 通りの勝ちが 10 以上少ない
        const fit = run(FIT);
        expect(r.loss).toBeGreaterThan(fit.loss + 0.2);
        expect(jitterOnce(PREPARED).wins + 10).toBeLessThanOrEqual(jitterOnce(FIT).wins);
        // 攻め手は二隊とも谷の口で崩す
        expect(statusOf(r, 'e_raid1')).not.toBe('ready');
        expect(statusOf(r, 'e_raid2')).not.toBe('ready');
    }, 60_000);

    it('16 通りで、無計画な正面突破（六隊で谷底へ）より負けが少なく、塞ぎを崩せる並びが多く、崩せる敵が多い（記録：準備 0 勝・負け 8・塞ぎ 10・崩した敵の平均 5.1 ／ 正面突破 0 勝・負け 16・塞ぎ 0・0 ／ 高所を先に取る 15 勝）', () => {
        const prep = jitterRuns(PREPARED);
        const push = jitterRuns(PUSH);
        const isDefeat = (r: Run) => r.o.result === 'defeat';
        const blockBroke = (r: Run) => secondaryOf(r, 'valley_block');
        expect(count(prep, isDefeat) + 6).toBeLessThanOrEqual(count(push, isDefeat));
        expect(count(prep, blockBroke)).toBeGreaterThanOrEqual(count(push, blockBroke) + 6);
        expect(prep.reduce((a, r) => a + broken(r), 0)).toBeGreaterThan(push.reduce((a, r) => a + broken(r), 0) + 40);
        // 主目標に届くのは地形に合った作戦（高所を先に取る・塞ぎを誘い出して中央を抜ける）
        expect(jitterOnce(FIT).wins).toBeGreaterThanOrEqual(14);
    }, 120_000);
});
