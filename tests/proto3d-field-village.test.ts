/**
 * 戦場「村落」（village）の作戦と釣り合い（docs/fields-group3-request.md・docs/fields-group3-design.md §1・§4）。
 * 家屋が通りを分ける村で、庄屋の屋敷前（広場の真ん中の輪）を 7 分守る。敵勢は 20 秒（真ん中の通り）・110 秒（西の通り。騎馬は米蔵へ）・
 * 200 秒（東の通り）の 3 つの波で来る。家屋は通れず射線も遮る。柵（屋敷の西の抜け道・東の通り）は通れないが射線は通す。
 * 広場へ入れる口は、西の通りと屋敷の東の抜け道の 2 本。
 *
 * 確かめること：
 * - 地形（状態を直接見る）：家屋・柵が通れない所・射線を遮る所／通す所になっていて、敵の通り道が東の抜け道と西の通りに分かれる。
 * - 主目標に届く作戦（早送り）が 4 つあり、±15 秒の 16 通りで安定する。作戦どうしで損害・副目標・最後まで戦える部隊が違う。
 * - 準備した正面攻撃（通りの口で正面から受ける。弓・予備・能力を使う）と、無計画な攻撃（全部隊で一番近い敵へ当て直すだけ）を分けて比べる。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てるが、損害が大きい・守れる部隊が少ない、を比べとして書く）。
 * - 副目標が作戦で分かれる組（広場を固める：米蔵 ✗・損害 ✓／通りの口で受ける：米蔵 ✓・損害 ✗）。
 * - 武将の能力の価値が地形で変わる比べ（石川の後詰めの差配：横道との辻で受ける予備には効くが、家並みの間・広場の中では効かない）。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める）。画面の操作ではない。
 * 台本は人が画面でできる程度にしている：最初の配置は 2 秒おきに 1 部隊ずつ押す。命令は 1 つの台本で 12 回まで、続けて押す間は 1 秒以上
 * （テストで確かめる）。移動の後の向き（face）は画面から指定できないので使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、
 * 台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts の tapOrder）。
 * ±15 秒の 16 通りは、0 秒でない時刻の行だけをずらす（決まった乱数。第3群のほかのテストと同じ作り方）。「見てから押す」行はずらさない。
 *
 * 作った時の結果（早送り。16 通りの勝ち数・平均の損害・副目標を果たした数）：
 * - 広場を固める（PLAZA）：15／16 勝・損害 21.6％・米蔵 0／16・損害 3 割以内 16／16・弓隊 16／16。
 * - 広場を固め、弓を東の通りの柵の内側へ（FENCE）：16／16 勝・損害 20.0％・米蔵 0／16。
 * - 西の辻に二隊＋柵の内側の弓（POST）：16／16 勝・損害 21.7％・米蔵 16／16・損害 3 割以内 14／16・弓隊 16／16（いちばん良い作戦）。
 * - 波を見て予備を西の通りへ回す（RESERVE。95 秒に酒井隊を家並みの間の (-72,-5) へ）：16／16 勝・損害 28.1％・米蔵 16／16。
 * - 準備した正面攻撃（FRONTAL）：16／16 勝・損害 40.2％・米蔵 16／16・損害 3 割以内 1／16。最後まで戦える部隊 平均 4.7。
 *   同じ配置で能力を使わない（FRONTAL_NO_AB）：7／16 勝。
 * - 無計画（UNPLANNED）：0／16 勝（記録：平均 172 秒に負け・損害 39.1％・最後まで戦える部隊 平均 0.3・敵の損害 12.0％）。
 * - 通りごとに 1 部隊ずつ分ける（SPLIT。薄い）：0／16 勝（記録：平均 267 秒に負け）。待つだけ：110 秒に屋敷前を奪われて負け。
 * - 石川の差配：西の辻 (-72,-25) へ回す予備に使うと 0 → 11／16 勝。家並みの間 (-72,-5) では 16 → 16、広場の中では 15 → 15（損害 26.0 → 27.5％）。
 *
 * 本物の入力（このテストの外。使い捨ての Playwright で ?dev=field&id=village を開き、札を押す → 地面を押すで POST と同じ命令を出し、待ちは
 * 開発用の早送り）：PC・スマホ相当とも 420 秒で勝ち、副目標 3 つとも果たした。家康本陣の (0,125) は、押した所に止まっている忠勝隊の体があり
 * 選び直しになった（移動先指定を使わない押し方。台本は issueOrder で直接出すので動く）。この差は結果を変えなかった。
 * 数字はどれも細かい位置・時刻で動く（例：榊原隊の行き先を (30,80) から直った先の (28,63) に書き換えるだけで、家屋の陰の弓が崩れない数が 4 → 13）。
 * そのため、勝ち数・副目標の数は「比べ」と「下限」で確かめ、等しさで縛るのは記録として安定している所（0 勝・16 勝・850 など）だけにした。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { lineOfSight } from '../proto3d/src/battle/fieldRules';
import { findPath, isPassable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';
import { arrived, nearestEnemy, tapOrder } from './proto3d-group3-helpers';
import { unplanned } from './proto3d-fields-group3-plans';

const VF = getField('village')!;
/** 庄屋の屋敷前（守る地点）・米蔵の前 */
const KEY = { x: 0, z: 42 };
const STORE = { x: -135, z: -23 };

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 固有能力（対象の要る能力は対象の部隊 id。要らなければ null） */
interface Ab {
    ability: string | null;
}
type Cmd = Order | Tap | Ab | 'nearest';
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
type Step = [number, string, Cmd] | [(s: BattleState) => boolean, string, Cmd];

const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
const ab = (target: string | null = null): Ab => ({ ability: target });

/** 部隊が斬り合っている */
const engaged = (id: string) => (s: BattleState) => s.units.some((u) => u.id === id && !!u.engagedWith);
/** 条件が初めて真になってから sec 秒後（人が見てから少し置いて押す） */
function later(cond: (s: BattleState) => boolean, sec: number) {
    const first = new WeakMap<BattleState, number>();
    return (s: BattleState) => {
        if (!first.has(s) && cond(s)) first.set(s, s.t);
        const f = first.get(s);
        return f !== undefined && s.t >= f + sec - 1e-9;
    };
}

interface Run {
    o: BattleOutcome;
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    left: Record<string, number>;
    refused: string[];
    /** 命令を出した時刻（人が押した時刻） */
    cmdT: number[];
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(VF, 'standard'));
    const timed = steps.filter((x): x is [number, string, Cmd] => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = steps.filter((x): x is [(s: BattleState) => boolean, string, Cmd] => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmdT: number[] = [];
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        cmdT.push(st.t);
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if ('ability' in ord) {
            if (!useAbility(st, id, ord.ability ?? undefined).ok) refused.push(`${label}:${id}`);
        } else if (!issueOrder(st, id, 'tap' in ord ? tapOrder(st, ord.tap) : ord)) refused.push(`${label}:${id}`);
    };
    const o = runToEnd(s, (st) => {
        while (timed.length && st.t >= timed[0]![0] - 1e-9) {
            const [t, id, ord] = timed.shift()!;
            run(st, String(t), id, ord);
        }
        watch.forEach(([cond, id, ord], i) => {
            if (fired.has(i) || !cond(st)) return;
            fired.add(i);
            run(st, `when${i}@${st.t.toFixed(1)}`, id, ord);
        });
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmdT };
}

/** 時刻の行を ±15 秒ずらした 16 通り（決まった乱数。0 秒の行と「見てから押す」行はずらさない） */
function jitter(base: Step[]): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) out.push(play(base.map((x) => (typeof x[0] === 'number' && x[0] !== 0 ? ([x[0] + Math.round((rnd() - 0.5) * 30), x[1], x[2]] as Step) : x))));
    return out;
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const wins = (rs: Run[]) => rs.filter(won).length;
const count = (rs: Run[], id: string) => rs.filter((r) => sec(r, id)).length;
const mean = (rs: Run[], f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
/** 本陣以外で、最後まで戦える（崩れていない）部隊の数 */
const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
const standing = (r: Run) => FIGHTERS.filter((id) => r.o.units.find((u) => u.id === id)!.status === 'ready').length;
/** 敵の攻め手（本陣以外）の兵の損害の割合 */
const enemyLoss = (r: Run) => {
    const e = r.o.units.filter((u) => u.side === 'enemy' && u.id !== 'e_hq');
    return 1 - e.reduce((a, u) => a + u.endStrength, 0) / e.reduce((a, u) => a + u.startStrength, 0);
};
const brief = (r: Run) =>
    `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ')} refused=${r.refused.join(',')}`;

/** 同じ台本は 1 回だけ進める */
const memo = new Map<Step[], Run>();
const once = (p: Step[]) => {
    if (!memo.has(p)) memo.set(p, play(p));
    return memo.get(p)!;
};
const memo16 = new Map<Step[], Run[]>();
const sixteen = (p: Step[]) => {
    if (!memo16.has(p)) memo16.set(p, jitter(p));
    return memo16.get(p)!;
};

// ---------------------------------------------------------------- 台本

/** 最初の配置（4 秒から 2 秒おきに 1 部隊ずつ押す）。広場の屋敷前に主力、西に酒井隊、東に騎馬、後ろに石川隊・弓・榊原隊 */
const DEPLOY: [string, [number, number]][] = [
    ['a_tadakatsu', [0, 30]],
    ['a_sakai', [-48, 40]],
    ['a_kiba', [48, 40]],
    ['a_ishikawa', [18, 52]],
    ['a_yumi', [-18, 55]],
    ['a_sakakibara', [30, 80]], // 南の列の家屋の中（押すと issueOrder が近くの通れる所 (28,63) ほどへ直す。画面で押しても同じ。第3群の共通の台本と同じ点）
    ['a_ieyasu', [0, 125]],
];
const deploy = (o: Record<string, [number, number]> = {}): Step[] => DEPLOY.map(([id, p], i) => [4 + i * 2, id, tap(...(o[id] ?? p))] as Step);

/** 広場を固める：主力を屋敷前に集め、予備は後ろ（命令 7 回）。米蔵は守らない */
const PLAZA: Step[] = deploy();
/** 広場を固め、150 秒（第三波の前）に弓を東の通りの柵の内側 (72,6) へ。柵越しに第三波を射る（命令 8 回） */
const FENCE: Step[] = [...deploy(), [150, 'a_yumi', tap(72, 6)]];
/** 弓を家屋の陰 (50,30)（東の抜け道の口の脇。東の通りは家並みに遮られて見えない）へ（FENCE と比べる） */
const SHADE: Step[] = [...deploy(), [150, 'a_yumi', tap(50, 30)]];
/**
 * 西の辻に二隊：25 秒に石川隊を西の通りと横道の辻 (-72,-28) へ（西の通りを上って北を向く）、27 秒に酒井隊を西の通りの口 (-72,20) へ。
 * 150 秒に弓を東の通りの柵の内側へ。第二波の騎馬は辻の石川隊へ当たり、米蔵へ行かない（命令 10 回）
 */
const POST: Step[] = [...deploy(), [25, 'a_ishikawa', tap(-72, -28)], [27, 'a_sakai', tap(-72, 20)], [150, 'a_yumi', tap(72, 6)]];
/** 波を見て予備を回す：95 秒（第二波の前）に、広場の西の酒井隊を西の通りの家並みの間 (-72,-5) へ（命令 8 回） */
const RESERVE: Step[] = [...deploy(), [95, 'a_sakai', tap(-72, -5)]];
/**
 * 準備した正面攻撃（通りの口で正面から受ける）：忠勝隊を東の抜け道の口 (35,26)、その後ろに石川隊、脇に騎馬、弓は口へ届く (20,58)。
 * 酒井隊を西の通りの口 (-72,26)、その後ろに榊原隊。家康本陣は号令の届く (0,60)。忠勝隊が斬り合ったら家康の号令、酒井隊が斬り合ったら
 * 石川の差配を酒井隊へ、その 2 秒後に榊原の先駆け（命令 10 回）
 */
const FRONT_POS: Record<string, [number, number]> = {
    a_tadakatsu: [35, 26],
    a_ishikawa: [35, 42],
    a_kiba: [58, 42],
    a_yumi: [20, 58],
    a_sakai: [-72, 26],
    a_sakakibara: [-58, 45],
    a_ieyasu: [0, 60],
};
const FRONTAL: Step[] = [
    ...deploy(FRONT_POS),
    [engaged('a_tadakatsu'), 'a_ieyasu', ab()],
    [later(engaged('a_sakai'), 1), 'a_ishikawa', ab('a_sakai')],
    [later(engaged('a_sakai'), 3), 'a_sakakibara', ab()],
];
/** 準備した正面攻撃の配置だけ（能力を使わない） */
const FRONTAL_NO_AB: Step[] = deploy(FRONT_POS);
/** 通りごとに 1 部隊ずつ分ける（薄い）：忠勝隊は東の抜け道の口、酒井隊は西の辻、石川隊は屋敷前、弓は柵の内側 */
const SPLIT: Step[] = deploy({ a_tadakatsu: [35, 26], a_ishikawa: [0, 40], a_kiba: [55, 45], a_sakakibara: [-20, 60], a_sakai: [-72, -25], a_yumi: [72, 6] });
/** 無計画：全部隊で、見えている一番近い敵へ 10 秒ごとに当て直す（第3群の共通の台本） */
const UNPLANNED: Step[] = unplanned(480) as Step[];
/** 待つだけ（命令を出さない） */
const HOLD: Step[] = [];

/** 石川の差配の比べ：95 秒に酒井隊を (x,z) へ回し、97 秒に石川の差配を酒井隊へ（useAb が false なら差配なし） */
const shift = (x: number, z: number, useAb: boolean): Step[] => [...deploy(), [95, 'a_sakai', tap(x, z)], ...(useAb ? [[97, 'a_ishikawa', ab('a_sakai')] as Step] : [])];
const JUNCTION_AB = shift(-72, -25, true);
const JUNCTION_NO = shift(-72, -25, false);
const STREET_AB = shift(-72, -5, true);
const STREET_NO = RESERVE;
/** 広場の中で回す：第三波が見えたら酒井隊を広場の東 (40,45) へ（2 秒後に差配） */
const OPEN_AB: Step[] = [...deploy(), [arrived('e_e_yari1'), 'a_sakai', tap(40, 45)], [later(arrived('e_e_yari1'), 2), 'a_ishikawa', ab('a_sakai')]];
const OPEN_NO: Step[] = [...deploy(), [arrived('e_e_yari1'), 'a_sakai', tap(40, 45)]];

const ALL_PLANS: Record<string, Step[]> = { PLAZA, FENCE, SHADE, POST, RESERVE, FRONTAL, FRONTAL_NO_AB, SPLIT, JUNCTION_AB, STREET_AB, OPEN_AB, OPEN_NO };

// ---------------------------------------------------------------- テスト

describe('村落のデータ（状態を直接見る）', () => {
    it('検査を通る。主目標は屋敷前を守る（敵本陣の撃破ではない）。部隊数は上限内（味方 7・敵 9。増援を含めて同時に戦場にいる数）', () => {
        expect(validateField(VF)).toEqual([]);
        const p = VF.objectives.primary;
        expect(p.type).toBe('defend_time');
        if (p.type !== 'defend_time') return;
        expect([p.sec, p.loseSec, p.zone?.circle]).toEqual([420, 15, { cx: KEY.x, cz: KEY.z, r: 22 }]);
        expect(VF.objectives.secondary.map((x) => x.id)).toEqual(['village_losses', 'village_archers', 'village_store']);
        expect(VF.generalInitiative).toBe(true);
        const us = VF.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(9);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 第二波の騎馬だけが米蔵へ。ほかの槍は屋敷前、弓は横道の真ん中へ
        for (const u of us.filter((x) => x.side === 'enemy' && x.aiRole === 'assault')) {
            const aim = u.id === 'e_w_kiba' ? STORE : u.kind === 'yumi' ? { x: 0, z: -23 } : KEY;
            expect([u.id, u.aiTarget?.x, u.aiTarget?.z]).toEqual([u.id, aim.x, aim.z]);
        }
    });

    it('家屋・柵は通れない。柵は射線を通し、家屋は遮る。広場へ入れる口は西の通りと屋敷の東の抜け道の 2 本', () => {
        const s = createBattle(buildBattleSetup(VF, 'standard'));
        const nav = s.field.nav!;
        expect(isPassable(nav, 0, 2)).toBe(false); // 庄屋の屋敷
        expect(isPassable(nav, -35, -1)).toBe(false); // 屋敷の西の抜け道の柵
        expect(isPassable(nav, 72, -9)).toBe(false); // 東の通りの柵
        expect(isPassable(nav, 35, 0)).toBe(true); // 屋敷の東の抜け道
        expect(isPassable(nav, -72, 0)).toBe(true); // 西の通り
        // 柵の内側（東の通りの柵の南）から、柵越しに東の通りの北を射られる。家屋の陰（東の抜け道の口の脇）からは見えない
        expect(lineOfSight(s.map, s.field, { x: 72, z: 6 }, { x: 72, z: -90 })).toBe(true);
        expect(lineOfSight(s.map, s.field, { x: 50, z: 30 }, { x: 72, z: -90 })).toBe(false);
        // 屋敷の西の抜け道の柵越しに横道が見える（射線は通す）が、屋敷越しには見えない
        expect(lineOfSight(s.map, s.field, { x: -35, z: 12 }, { x: -35, z: -25 })).toBe(true);
        expect(lineOfSight(s.map, s.field, { x: 0, z: 30 }, { x: 0, z: -25 })).toBe(false);
        // 横道の真ん中から屋敷前への道は、東の抜け道を通る（西の抜け道は柵で塞がれている）
        const path = findPath(nav, 'yari', 0, -23, KEY.x, KEY.z)!;
        expect(path).toBeTruthy();
        expect(path.some((p) => p.x >= 28 && p.x <= 42 && p.z > -16 && p.z < 20)).toBe(true);
        expect(path.some((p) => p.x >= -42 && p.x <= -28 && p.z > -16 && p.z < 20)).toBe(false);
        // 西の通りから屋敷前へは、西の通りを下りて広場へ（屋敷の西の抜け道は通らない）
        const west = findPath(nav, 'yari', -72, -60, KEY.x, KEY.z)!;
        expect(west.some((p) => p.x >= -42 && p.x <= -28 && p.z > -16 && p.z < 20)).toBe(false);
    });
});

describe('村落の作戦（早送り）', () => {
    it('台本は人が画面でできる程度：命令は 12 回まで、続けて押す間は 1 秒以上、向き（face）は使わない、断られた命令は無い', () => {
        for (const [name, p] of Object.entries(ALL_PLANS)) {
            const r = once(p);
            expect([name, r.cmdT.length <= 12]).toEqual([name, true]);
            const ts = [...r.cmdT].sort((a, b) => a - b);
            const gaps = ts.slice(1).map((t, i) => t - ts[i]!);
            expect([name, Math.min(...gaps) >= 1 - 1e-6]).toEqual([name, true]);
            expect([name, r.refused]).toEqual([name, []]);
            for (const x of p) if (typeof x[2] === 'object' && 'type' in x[2] && x[2].type === 'move') expect(x[2].face).toBeUndefined();
        }
    }, 120_000);

    it('主目標に届く作戦が 4 つ（広場を固める・柵の内側の弓・西の辻に二隊・予備を回す）。どれも ±15 秒の 16 通りで 15 勝以上', () => {
        for (const p of [PLAZA, FENCE, POST, RESERVE]) expect(won(once(p)), brief(once(p))).toBe(true);
        // 16 通りの勝ち数（作った時：広場 15・柵の弓 16・西の辻 16・予備を回す 16）。
        // 第3群の動きの直し（建物の角の向こうの相手に「14 m より近づかない」を効かせない ほか）の後、西の辻は 15（k=9：西の通りの口で酒井隊と
        // 斬り合っていた西の槍が 250 秒に離れて広場へ向かい、忠勝隊を 325 秒ごろに崩して、342 秒に屋敷前を奪われる）。ほかは同じ
        expect(wins(sixteen(PLAZA))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(FENCE))).toBe(16);
        expect(wins(sixteen(POST))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(RESERVE))).toBe(16);
    }, 300_000);

    it('作戦どうしの違い：米蔵を守れるのは西に部隊を出す作戦だけ。柵の内側の弓は広場を固めるより損害が少ない。予備を後から回すと先に置くより損害が大きい', () => {
        // 米蔵（16 通りで果たした数）：広場 0・柵の弓 0 ／西の辻 16・予備を回す 16
        expect(count(sixteen(PLAZA), 'village_store')).toBe(0);
        expect(count(sixteen(FENCE), 'village_store')).toBe(0);
        expect(count(sixteen(POST), 'village_store')).toBeGreaterThanOrEqual(14);
        expect(count(sixteen(RESERVE), 'village_store')).toBeGreaterThanOrEqual(14);
        // 損害（16 通りの平均）：柵の弓 20.0％ < 広場 21.6％。予備を回す 28.1％ > 西の辻 21.7％（後から回した酒井隊が通りで削られる）
        expect(mean(sixteen(FENCE), (r) => r.loss)).toBeLessThan(mean(sixteen(PLAZA), (r) => r.loss));
        expect(mean(sixteen(RESERVE), (r) => r.loss)).toBeGreaterThan(mean(sixteen(POST), (r) => r.loss) + 0.04);
        // 損害を 3 割以内（16 通り）：広場 16・西の辻 14 ／予備を回す 12 前後
        expect(count(sixteen(PLAZA), 'village_losses')).toBe(16);
        expect(count(sixteen(RESERVE), 'village_losses')).toBeLessThan(count(sixteen(PLAZA), 'village_losses'));
    }, 300_000);

    it('弓の置き場所：東の通りの柵の内側からは第三波を柵越しに射られる。家屋の陰からは射られず、弓隊が崩れやすい', () => {
        // 第三波の槍が横道へ下りてきた（z > -32）時の兵の合計
        const at = (p: Step[]) => {
            let v = -1;
            play(p, (s) => {
                const ys = s.units.filter((u) => u.id === 'e_e_yari1' || u.id === 'e_e_yari2');
                if (v < 0 && ys.every((u) => u.arrived) && ys.some((u) => u.z > -32)) v = ys.reduce((a, u) => a + u.strength, 0);
            });
            return v;
        };
        const fence = at(FENCE);
        const shade = at(SHADE);
        // 作った時：柵の内側 817（850 から 33 減る）、家屋の陰 850（射られない）
        expect(shade).toBe(850);
        expect(fence).toBeLessThan(shade - 20);
        // 弓隊を崩さずに終える（16 通り）：柵の内側 16 ／家屋の陰 4（抜け道の口の脇で第三波に当たられる）
        expect(count(sixteen(FENCE), 'village_archers')).toBe(16);
        expect(count(sixteen(SHADE), 'village_archers')).toBeLessThan(count(sixteen(FENCE), 'village_archers'));
    }, 300_000);

    it('副目標が作戦で分かれる：広場を固めると損害は抑えるが米蔵を失う。通りの口で受ける（準備した正面攻撃）と米蔵は守るが損害が 3 割を超える', () => {
        const plaza = sixteen(PLAZA);
        const front = sixteen(FRONTAL);
        expect([count(plaza, 'village_losses'), count(plaza, 'village_store')]).toEqual([16, 0]);
        expect(count(front, 'village_store')).toBe(16);
        expect(count(front, 'village_losses')).toBeLessThanOrEqual(2);
        // 1 回の台本でも同じ分かれ方
        expect([sec(once(PLAZA), 'village_losses'), sec(once(PLAZA), 'village_store')]).toEqual([true, false]);
        expect([sec(once(FRONTAL), 'village_losses'), sec(once(FRONTAL), 'village_store')]).toEqual([false, true]);
    }, 300_000);

    it('準備した正面攻撃と無計画な攻撃の比べ：準備した方は主目標に届き、長く戦い、最後まで戦える部隊が多く、敵を多く削る（無計画の結果は記録）', () => {
        const front = sixteen(FRONTAL);
        const raw = sixteen(UNPLANNED);
        // 準備した正面攻撃は 16 通りで 16 勝（作った時）。無計画は 0 勝（記録：平均 172 秒に負け）
        expect(wins(front)).toBeGreaterThanOrEqual(14);
        expect(wins(raw)).toBe(0);
        expect(mean(front, (r) => r.t)).toBeGreaterThan(mean(raw, (r) => r.t) + 150);
        // 最後まで戦える部隊（平均）：準備 4.7 ／無計画 0.3。敵の攻め手の損害（平均）：準備 45.6％ ／無計画 12.0％
        expect(mean(front, standing)).toBeGreaterThan(mean(raw, standing) + 3);
        expect(mean(front, enemyLoss)).toBeGreaterThan(mean(raw, enemyLoss) + 0.25);
        // 味方の損害の割合はほぼ同じ（準備 40.2％・無計画 39.1％）。無計画は早く崩れて戦いが終わるので、損害の割合では差が出ない（記録）
        expect(Math.abs(mean(front, (r) => r.loss) - mean(raw, (r) => r.loss))).toBeLessThan(0.1);
        // 準備の中身：同じ配置で能力（号令・差配・先駆け）を使わないと 7／16 勝（作った時）
        expect(wins(sixteen(FRONTAL_NO_AB))).toBeLessThan(wins(front) - 4);
    }, 300_000);

    it('準備した正面攻撃と地形に合った作戦の比べ：勝てるが、損害が大きく、守れる部隊が少ない（忠勝隊・騎馬が口で削られる）', () => {
        const front = sixteen(FRONTAL);
        // 損害（平均）：通りの口で受ける 40.2％ ／西の辻に二隊 21.7％ ／広場を固める 21.6％
        expect(mean(front, (r) => r.loss)).toBeGreaterThan(mean(sixteen(POST), (r) => r.loss) + 0.12);
        expect(mean(front, (r) => r.loss)).toBeGreaterThan(mean(sixteen(PLAZA), (r) => r.loss) + 0.12);
        // 1 回の台本：口で受けた忠勝隊が残る兵は、広場を固めたときより少ない
        expect(once(FRONTAL).left.a_tadakatsu!).toBeLessThan(once(PLAZA).left.a_tadakatsu! - 150);
    }, 300_000);

    it('記録：通りごとに 1 部隊ずつ分ける（薄い）と、2 部隊の波を 1 部隊で受ける所が崩れて負ける。待つだけでは第一波に屋敷前を奪われる', () => {
        const split = sixteen(SPLIT);
        expect(wins(split)).toBe(0);
        // 分けても損害は広場を固めるより大きい
        expect(mean(split, (r) => r.loss)).toBeGreaterThan(mean(sixteen(PLAZA), (r) => r.loss));
        const hold = once(HOLD);
        expect(hold.o.objectives!.primary!.achieved).toBe(false);
        expect(hold.t).toBeLessThan(130);
    }, 300_000);

    it('能力の価値が地形で変わる（石川の後詰めの差配）：横道との辻で受ける予備には勝敗を分けるほど効き、家並みの間・広場の中ではほとんど効かない', () => {
        // 横道との辻 (-72,-25)：横道へ開いていて、第二波の騎馬と槍を 1 部隊で受ける。差配（士気 +30・士気の低下 −50％・足 ×1.8）で 0 → 11／16 勝
        const jAb = sixteen(JUNCTION_AB);
        const jNo = sixteen(JUNCTION_NO);
        expect(wins(jNo)).toBe(0);
        expect(wins(jAb)).toBeGreaterThanOrEqual(9);
        // 家並みの間 (-72,-5)：両脇が家屋で横を突かれない。差配なしでも 16 勝（差配ありも 16 勝）
        expect(wins(sixteen(STREET_NO))).toBe(16);
        expect(wins(sixteen(STREET_AB))).toBe(16);
        // 広場の中で回す（第三波へ）：差配あり 15・なし 15 勝。損害は 27.5％ と 26.0％（差配の分、石川隊が動けない）
        expect(Math.abs(wins(sixteen(OPEN_AB)) - wins(sixteen(OPEN_NO)))).toBeLessThanOrEqual(2);
        const gain = (a: Run[], b: Run[]) => wins(a) - wins(b);
        expect(gain(jAb, jNo)).toBeGreaterThan(gain(sixteen(STREET_AB), sixteen(STREET_NO)) + 8);
        expect(gain(jAb, jNo)).toBeGreaterThan(gain(sixteen(OPEN_AB), sixteen(OPEN_NO)) + 8);
        // 足の速さの分：広場の西 (-48,40) から辻まで、差配なし 20.3 秒・差配あり 12.2 秒（作った時。家並みの間の西の通りを上る）
        const reach = (p: Step[]) => {
            let t = -1;
            play(p, (s) => {
                const u = s.units.find((x) => x.id === 'a_sakai')!;
                if (t < 0 && s.t > 97 && Math.hypot(u.x + 72, u.z + 25) < 6) t = s.t;
            });
            return t - 95;
        };
        const slow = reach(JUNCTION_NO);
        const fast = reach(JUNCTION_AB);
        expect(slow).toBeGreaterThan(0);
        expect(fast).toBeGreaterThan(0);
        expect(fast).toBeLessThan(slow - 5);
    }, 300_000);
});
