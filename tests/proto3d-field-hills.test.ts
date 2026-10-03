/**
 * 戦場「丘陵」（hills）の釣り合い：地形に合った作戦（騎馬で先に頂を取る／取られたら東の丘の弓を崩して東から横へ当たる）は 16 通りで
 * 安定して勝つ。無計画な攻撃（全部隊で頂へ真っすぐ・騎馬を使わずに槍で頂へ・弓を放って正面から攻め上がる）は、地形に合った作戦・
 * 準備した正面攻撃と比べて 16 通りの勝ちが少ない・損害が大きい・副目標を落とす（比べが合格条件。無計画な攻撃の勝敗は記録として書く）。
 * 準備した正面攻撃（東の丘の弓を崩し、弓で先手を射てから、南から四隊で当たり采配を使う）の結果も記録して比べる。
 * 副目標（東の丘の弓隊を崩す）は作戦によって達成／未達成に分かれる。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（始めの数秒に 1 部隊ずつ 2 秒おき、あとは数十秒おき）にしている。
 * 数字（兵の残り・時間）は hills.ts の釣り合いの目安。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, elevationAt, issueOrder, runToEnd } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const HILLS = getField('hills')!;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力（対象の要る能力は { abilityTarget: 対象の部隊 id }） */
type Step = [number, string, Order | 'ability' | { abilityTarget: string }];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
/** 移動（画面の命令と同じく、着いた後の向きは指定しない） */
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });

interface Run {
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 味方が敵の側面・背後を突いた回数 */
    flankHits: number;
}

function play(steps: Step[]): Run {
    const s = createBattle(buildBattleSetup(HILLS, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            if (ord === 'ability') {
                if (!useAbility(st, id).ok) refused.push(`${t}:${id}`);
            } else if (typeof ord === 'object' && 'abilityTarget' in ord) {
                if (!useAbility(st, id, ord.abilityTarget).ok) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, ord)) refused.push(`${t}:${id}`);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    const flankHits = s.events.filter((e) => (e.kind === 'flank' || e.kind === 'rear') && e.unitId?.startsWith('a_')).length;
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, flankHits };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const secondaryOf = (r: Run) => r.o.objectives!.secondary.find((x) => x.id === 'hills_archers')!.achieved;

/**
 * 台本の命令の時刻をずらした 16 通り（決まった乱数で作る）。始めの 10 秒までの命令は 0〜early 秒遅らせ、それより後は ±amp/2 秒ずらす
 */
function variants(base: Step[], early: number, amp: number): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) {
        out.push(play(base.map(([t, id, o]) => [t < 10 ? t + Math.round(rnd() * early) : t + Math.round((rnd() - 0.5) * amp), id, o] as Step)));
    }
    return out;
}
const wins = (rs: Run[]) => rs.filter((r) => r.o.result === 'victory').length;
const meanLoss = (rs: Run[]) => rs.reduce((a, r) => a + r.loss, 0) / rs.length;

// ---------------------------------------------------------------- 台本

/**
 * 地形に合った作戦その 1（先に頂を取る）：騎馬（榊原隊）を頂の真南 (0,25) へ回してから、北へ頂まで上げる。槍二隊を頂の左右に、石川隊と弓を頂のすぐ後ろに置く。
 * 騎馬は敵の先手より先に頂に着いて踏みとどまり、槍が着くまで敵を坂の途中で止める。あとは攻め上がる敵を上から受ける。
 * 命令は 6 回（始めの 8 秒に 2 秒おき、12 秒に騎馬を頂へ）。どれも画面で出せる命令（移動の後の向きは画面から指定できないので、
 * 部隊は進んできた向きのまま止まる。騎馬を左の前の持ち場から頂へ斜めに上げると北東を向いて着き、攻め上がる敵に横から当たられて負けやすい。
 * 真南から北へ上げれば、敵の来る北を向いて着く）
 */
const TAKE: Step[] = [
    [0, 'a_sakakibara', mv(0, 25)],
    [2, 'a_tadakatsu', mv(-18, -26)],
    [4, 'a_sakai', mv(18, -26)],
    [6, 'a_ishikawa', mv(0, -5)],
    [8, 'a_yumi', mv(-25, -5)],
    [12, 'a_sakakibara', mv(0, -20)],
];

/**
 * 地形に合った作戦その 2（取られたら回り込む）：頂は敵に取らせる。騎馬と酒井隊で東の丘の弓を崩し（50 秒ほどで崩れる）、弓は頂の先手を射続ける。
 * 80 秒ごろ、忠勝隊を頂の南、酒井隊・石川隊を頂の東の坂（谷の手前）、騎馬を頂の北東へ回す。120 秒に忠勝隊が南から槍隊へ当たり、
 * 10 秒後に酒井隊・石川隊が東から同じ槍隊の横へ、騎馬が後詰めへ当たる。命令は 11 回（0・2・4・80〜86・120・130〜134 秒）
 */
const FLANK: Step[] = [
    [0, 'a_sakakibara', atk('e_yumi')],
    [2, 'a_sakai', atk('e_yumi')],
    [4, 'a_yumi', atk('e_sente')],
    [80, 'a_tadakatsu', mv(15, 20)],
    [82, 'a_sakai', mv(55, -15)],
    [84, 'a_ishikawa', mv(55, 5)],
    [86, 'a_sakakibara', mv(45, -60)],
    [120, 'a_tadakatsu', atk('e_yari')],
    [130, 'a_sakai', atk('e_yari')],
    [132, 'a_ishikawa', atk('e_yari')],
    [134, 'a_sakakibara', atk('e_reserve')],
];
/** 回り込みの作戦から、東の丘の弓を崩す 2 つの命令を抜いたもの（弓を放って東の坂へ回る） */
const FLANK_NO_ARCHERS = FLANK.filter(([t]) => t >= 4);

/**
 * 頂を取られた後、正面（南）から攻め上がる：準備は回り込みの作戦と同じ時刻で、四隊を頂の南に並べて 120 秒に正面から当たる（弓は先手を射る）。
 * killArchers で、始めに騎馬と酒井隊で東の丘の弓を崩すかを選ぶ
 */
function frontal(killArchers: boolean): Step[] {
    return [
        ...(killArchers ? ([[0, 'a_sakakibara', atk('e_yumi')], [2, 'a_sakai', atk('e_yumi')]] as Step[]) : []),
        [4, 'a_yumi', atk('e_sente')],
        [80, 'a_ishikawa', mv(20, 25)],
        [82, 'a_tadakatsu', mv(-15, 25)],
        [84, 'a_sakai', mv(10, 30)],
        [86, 'a_sakakibara', mv(-30, 30)],
        [120, 'a_tadakatsu', atk('e_sente')],
        [122, 'a_sakai', atk('e_yari')],
        [124, 'a_ishikawa', atk('e_yari')],
        [126, 'a_sakakibara', atk('e_reserve')],
    ];
}

/**
 * 準備した正面攻撃：頂は敵に取らせ、始めに騎馬と酒井隊で東の丘の弓を崩し、弓は頂の先手を射続ける（頂を取られた後の正面の攻め上がり
 * frontal(true) と同じ）。120 秒から正面（南）の四隊で当たり、酒井隊が槍隊へ当たる 122 秒に両翼の采配を使う。回り込まない。
 * 命令は 11 回（0・2・4・80〜86・120〜126 秒）
 */
const PREPARED: Step[] = [...frontal(true), [122, 'a_sakai', 'ability']];

/** 比べの基準（同じ台本は 1 回だけ進める） */
const memo = new Map<Step[], Run>();
const run = (steps: Step[]): Run => {
    if (!memo.has(steps)) memo.set(steps, play(steps));
    return memo.get(steps)!;
};
/** 16 通りの比べの基準（同じ台本・同じずらし方は 1 回だけ） */
const memo16 = new Map<string, Run[]>();
const variantsOnce = (name: string, base: Step[], early: number, amp: number): Run[] => {
    if (!memo16.has(name)) memo16.set(name, variants(base, early, amp));
    return memo16.get(name)!;
};

describe('丘陵のデータ', () => {
    it('検査を通る。味方 6／敵 6（敵はすべて敵勢）。高所の有利は強め（×0.65・2 m・射程 +30 m・見通し +40 m）、特殊ルールなし、道探しなし', () => {
        expect(validateField(HILLS)).toEqual([]);
        const us = presetUnits(HILLS, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_yumi']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(6);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(us.find((u) => u.id === 'a_sakakibara')!.kind).toBe('kiba');
        expect(HILLS.highGround).toEqual({ defenseVsLower: 0.65, minDiff: 2, rangeBonus: 30, sightBonus: 40 });
        expect(HILLS.specialRules ?? []).toEqual([]);
        const s = createBattle(buildBattleSetup(HILLS, 'standard'));
        expect(s.field.nav).toBeNull();
        // 武将の部隊には能力が付く（酒井・石川・榊原は武将のデータから）
        expect(Object.fromEntries(s.units.filter((u) => u.side === 'ally' && u.ability).map((u) => [u.id, u.ability]))).toEqual({
            a_ieyasu: 'ieyasu_rally',
            a_tadakatsu: 'tadakatsu_rearguard',
            a_sakai: 'sakai_flank',
            a_sakakibara: 'sakakibara_vanguard',
            a_ishikawa: 'ishikawa_reserve',
        });
        // 主目標は中央の丘の頂（半径 35 m）を 90 秒、副目標は東の丘の弓隊
        expect(HILLS.objectives!.primary).toMatchObject({ type: 'hold_point', sec: 90 });
        expect(HILLS.objectives!.secondary![0]).toMatchObject({ type: 'break_unit', unitId: 'e_yumi' });
    });

    it('地形：中央の丘は頂の近くが急（頂と 20 m 下とで 5 m 以上違う）。東の丘との間は谷（低い）。東の丘の弓は、こちらの右翼の持ち場まで届く', () => {
        const s = createBattle(buildBattleSetup(HILLS, 'standard'));
        const crest = elevationAt(s.map, 0, -20);
        expect(crest).toBeCloseTo(20, 5);
        expect(crest - elevationAt(s.map, 0, -40)).toBeGreaterThan(5);
        expect(crest - elevationAt(s.map, 0, 0)).toBeGreaterThan(5);
        // 谷：中央の丘の裾と東の丘の裾の間は平ら
        expect(elevationAt(s.map, 80, 20)).toBe(0);
        expect(elevationAt(s.map, 140, 25)).toBeCloseTo(12, 5);
        // 東の丘の弓（高所の射程 +30 m）は、右翼の持ち場に届き、頂には届かない
        const yumi = HILLS.deployments.enemy.find((d) => d.id === 'east_hill')!;
        const right = HILLS.deployments.ally.find((d) => d.id === 'center_r')!;
        expect(Math.hypot(right.x - yumi.x, right.z - yumi.z)).toBeLessThan(150);
        expect(Math.hypot(0 - yumi.x, -20 - yumi.z)).toBeGreaterThan(120);
    });

    it('敵の考え：先手・槍・後詰めは頂へ攻め上がり（assault）、東の丘の弓は区域を守り、騎馬は後詰め、本陣は守り', () => {
        const us = presetUnits(HILLS, 'standard').filter((u) => u.side === 'enemy');
        expect(Object.fromEntries(us.map((u) => [u.id, u.aiRole]))).toEqual({
            e_hq: 'guard_hq',
            e_sente: 'assault',
            e_yari: 'assault',
            e_yumi: 'hold_zone',
            e_kiba: 'reserve',
            e_reserve: 'assault',
        });
        for (const u of us.filter((x) => x.aiRole === 'assault')) expect(Math.hypot(u.aiTarget!.x, u.aiTarget!.z + 20)).toBeLessThan(15);
    });
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（地形に合った作戦・準備した正面攻撃と比べて、16 通りの勝ちが少ない・
// 損害が大きい・副目標を落とす）。無計画な攻撃の勝敗は「記録」として残す（台本と数字は前のまま。変わったら理由と前後の数字を書いて直す）
describe('丘陵：無計画な攻撃・地形に合わない作戦と、地形に合った作戦の比べ（早送り）', () => {
    it('何もしない → 地形に合った作戦（勝ち）と違い、主目標に届かない（記録：日没。右翼の酒井隊は東の丘の弓に射すくめられて全滅する）', () => {
        const r = run([]);
        expect(run(TAKE).o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(statusOf(r, 'a_sakai')).toBe('destroyed');
        expect(secondaryOf(r)).toBe(false);
    }, 60_000);

    it('全部隊で始めから頂へ真っすぐ向かう（無計画）→ 先に頂を取る作戦・準備した正面攻撃より 16 通りの勝ちが少なく、損害が大きい（記録：敵と同時に頂で組み合い、高所の有利が無いまま崩されて負ける。16 通りすべて）', () => {
        const all: Step[] = ['a_sakakibara', 'a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_yumi'].map((id, i) => [2 * i, id, mv(0, -20)] as Step);
        const r = run(all);
        const rs = variants(all, 8, 0);
        // 確かめた時：無計画 0 勝・損害 32.7％（119.2 秒に負け） ／ 先に頂を取る 16 勝・17.8％ ／ 準備した正面攻撃 16 勝・20.5％
        expect(wins(rs) + 12).toBeLessThanOrEqual(wins(variantsOnce('take', TAKE, 8, 0)));
        expect(wins(rs) + 12).toBeLessThanOrEqual(wins(variantsOnce('prepared', PREPARED, 0, 30)));
        expect(r.loss).toBeGreaterThan(run(TAKE).loss + 0.1);
        expect(r.loss).toBeGreaterThan(run(PREPARED).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.o.elapsedSec).toBeLessThan(200);
        expect(rs.every((v) => v.o.result === 'defeat')).toBe(true);
    }, 60_000);

    it('騎馬を使わずに槍で頂の左右へ向かう（先に頂を取る作戦から騎馬の命令を抜く）→ 騎馬で取る同じ作戦より 16 通りの勝ちが少なく、損害が大きい（記録：敵の先手が先に頂に着き、頂を取れず日没）', () => {
        const spears = TAKE.filter(([, id]) => id !== 'a_sakakibara');
        const r = run(spears);
        const rs = variants(spears, 8, 0);
        // 確かめた時：騎馬なし 4 勝・損害 31.6％（日没） ／ 騎馬で取る 16 勝・17.8％
        expect(wins(rs) + 8).toBeLessThanOrEqual(wins(variantsOnce('take', TAKE, 8, 0)));
        expect(r.loss).toBeGreaterThan(run(TAKE).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.25);
        expect(wins(rs)).toBeLessThanOrEqual(6);
    }, 60_000);

    it('頂を取られた後、東の丘の弓を放って四隊で正面（南）から攻め上がる（準備なし）→ 弓を崩してから采配を使う準備した正面攻撃より 16 通りの勝ちが少なく、損害が大きく、副目標を落とす', () => {
        const rs = variantsOnce('front_no_prep', frontal(false), 0, 30);
        const prep = variantsOnce('prepared', PREPARED, 0, 30);
        // 確かめた時：準備なし 5 勝・平均の損害 39.0％・副目標 0 通り ／ 準備した正面攻撃 16 勝・23.9％・副目標 16 通り
        expect(wins(rs) + 8).toBeLessThanOrEqual(wins(prep));
        expect(meanLoss(rs)).toBeGreaterThan(meanLoss(prep) + 0.1);
        expect(prep.every((r) => secondaryOf(r))).toBe(true);
        // 記録（16 通りの多くで日没。勝っても損害 3 割を超える）
        expect(wins(rs)).toBeLessThanOrEqual(8);
        expect(rs.every((r) => r.loss > 0.3)).toBe(true);
        expect(rs.every((r) => !secondaryOf(r))).toBe(true);
    }, 60_000);
});

describe('丘陵：地形に合った作戦（早送り）', () => {
    it('騎馬を頂の真南から上げて先に頂を取り、槍二隊を左右に並べ、石川隊・弓をすぐ後ろに置く → 攻め上がる敵を上から受けて勝つ', () => {
        const r = play(TAKE);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(r.loss).toBeLessThan(0.25);
        expect(r.o.elapsedSec).toBeLessThan(260);
        // 攻め上がって来た三隊は崩れる。騎馬は踏みとどまって敵を止めた後、崩れて退く
        for (const id of ['e_sente', 'e_yari', 'e_reserve']) expect(statusOf(r, id)).toBe('routed');
        expect(statusOf(r, 'a_sakakibara')).toBe('routed');
        // 東の丘の弓には手を出していない（副目標は未達成）
        expect(secondaryOf(r)).toBe(false);
    });

    it('先に頂を取る作戦は、始めの命令を 0〜8 秒遅らせた 16 通りすべてで勝つ（損害 3 割未満。どれも画面で出せる命令）', () => {
        const rs = variants(TAKE, 8, 0);
        expect(wins(rs)).toBe(16);
        expect(rs.every((r) => r.loss < 0.3)).toBe(true);
    }, 30_000);

    it('同じ作戦で、騎馬を左の前の持ち場から頂へ斜めに上げる（北東を向いて着く）と、攻め上がる敵に横から当たられて 16 通りの半分ほどしか勝てない', () => {
        const diagonal: Step[] = [[0, 'a_sakakibara', mv(0, -20)], ...TAKE.filter(([, id]) => id !== 'a_sakakibara')];
        const rs = variants(diagonal, 8, 0);
        expect(wins(rs)).toBeLessThanOrEqual(10);
        expect(wins(rs)).toBeLessThan(wins(variants(TAKE, 8, 0)));
    }, 30_000);

    it('頂を取られたら、東の丘の弓を崩してから、忠勝隊が南から当たるのに合わせて東から横へ当たる → 勝つ（副目標も達成）', () => {
        const r = play(FLANK);
        // Version 13 候補の武将の自由な動き（演習の戦場だけ）：酒井隊は東の坂（82 秒の移動の命令）に着いて待機中に、忠勝隊と斬り合う
        // 敵の後詰めへ自分から横から当たり（125.6 秒）、後詰めは 131.9 秒に崩れる（前は 134 秒の榊原隊の攻撃で 135.4 秒に崩れた）。
        // そのため 134 秒の榊原隊の攻撃の命令だけは、相手がもう崩れていて断られる（勝ち・副目標・損害は前と同じく満たす）
        expect(r.refused).toEqual(['134:a_sakakibara']);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.2);
        expect(r.flankHits).toBeGreaterThanOrEqual(2);
        expect(statusOf(r, 'e_yumi')).toBe('routed');
    });

    it('回り込みの作戦は、命令の時刻を ±15 秒ずらした 16 通りすべてで勝ち、副目標も果たす。同じ準備で正面から当たるより損害が少ない', () => {
        const flank = variants(FLANK, 0, 30);
        const front = variants(frontal(true), 0, 30);
        expect(wins(flank)).toBe(16);
        expect(flank.every((r) => secondaryOf(r))).toBe(true);
        expect(flank.every((r) => r.loss < 0.27)).toBe(true);
        // 正面からでも弓を崩しておけば勝てるが、損害は回り込みより多い（確かめた時は平均 約 17％ と 約 25％）
        expect(meanLoss(flank) + 0.05).toBeLessThan(meanLoss(front));
    }, 60_000);

    it('固有能力を足しても勝つ（先に頂を取るとき榊原隊の先駆けの号、回り込むとき酒井隊の両翼の采配）', () => {
        const take = play([...TAKE, [30, 'a_sakakibara', 'ability']]);
        expect(take.refused).toEqual([]);
        expect(take.o.result).toBe('victory');
        const flank = play([...FLANK, [130, 'a_sakai', 'ability']]);
        // 回り込みの作戦と同じく、後詰めは榊原隊の 134 秒の命令より先に崩れる（酒井隊の自由な動き。上のテストの注を見る）
        expect(flank.refused).toEqual(['134:a_sakakibara']);
        expect(flank.o.result).toBe('victory');
        expect(Object.keys(flank.o.abilitiesUsed ?? {})).toEqual(['a_sakai']);
    });
});

describe('丘陵：副目標（東の丘の弓隊を崩す）は作戦で分かれる（早送り）', () => {
    it('回り込む前に騎馬と酒井隊で東の丘の弓を崩す → 達成／弓を放って東の坂へ回る → 勝っても未達成（酒井隊が矢で削られ、損害 3 割を超える）', () => {
        const kill = play(FLANK);
        const skip = play(FLANK_NO_ARCHERS);
        expect(kill.o.result).toBe('victory');
        expect(skip.o.result).toBe('victory');
        expect(secondaryOf(kill)).toBe(true);
        expect(secondaryOf(skip)).toBe(false);
        expect(skip.loss).toBeGreaterThan(0.3);
        expect(skip.left.a_sakai!).toBeLessThan(kill.left.a_sakai! / 2);
        // 勝敗・主目標・副目標は別の欄
        expect(skip.o.objectives!.primary!.achieved).toBe(true);
    });
});

describe('丘陵：準備した正面攻撃（早送り）', () => {
    it('東の丘の弓を崩し、弓で先手を射てから、四隊で南から当たり、酒井隊の両翼の采配を使う（記録：272.2 秒に勝ち・損害 20.5％・副目標も達成）', () => {
        const r = run(PREPARED);
        expect(r.refused).toEqual([]);
        expect(Object.keys(r.o.abilitiesUsed ?? {})).toEqual(['a_sakai']);
        // 記録
        expect(r.o.result).toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.25);
    });

    it('16 通りで、無計画な攻め上がり（全部隊で頂へ・弓を放って正面から）より勝ちが多く損害が小さい。回り込みの作戦よりは損害が多い（記録：準備 16 勝・平均 23.9％ ／ 回り込み 16 勝・16.4％ ／ 準備なしの正面 5 勝・39.0％）', () => {
        const prep = variantsOnce('prepared', PREPARED, 0, 30);
        const flank = variants(FLANK, 0, 30);
        expect(wins(prep)).toBeGreaterThanOrEqual(14);
        expect(prep.every((r) => secondaryOf(r))).toBe(true);
        const noPrep = variantsOnce('front_no_prep', frontal(false), 0, 30);
        expect(wins(prep)).toBeGreaterThan(wins(noPrep));
        expect(meanLoss(prep)).toBeLessThan(meanLoss(noPrep));
        // 東から横へ当たる回り込みの方が、損害が少ない（どちらも副目標を果たす）
        expect(meanLoss(flank)).toBeLessThan(meanLoss(prep));
    }, 60_000);
});
