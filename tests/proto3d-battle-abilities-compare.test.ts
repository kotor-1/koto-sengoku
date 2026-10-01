/**
 * 徳川 5 武将の能力の「使った場合／使わない場合」を、同じ台本で比べる（Version 13 候補。docs/troops-abilities-design.md §2・§5）。
 * 基準の戦場は大平原（plains）。演習の編成（徳川の七隊）のまま進めるもの（家康・酒井・石川・忠勝）と、大平原の地図に局面を置くもの
 * （榊原の弓隊への急襲・酒井の正面だけの当たり）がある。どれも「早送り」（決まった時刻・条件で命令と能力を出す台本を最後まで進める）。
 * 状態の直接変更はしない。数字は確かめた時の値（台本と合戦の決まりが変わらなければ同じになる）をコメントに書き、テストは差の向きと大きさを確かめる。
 *
 * 確かめた時の数字（2026-09-30、このコミットのコード）：
 * - 家康「立て直しの号令」（前線が持ち場で受ける。前線のどれかの士気が 45 を切った 70.9 秒に使う）：
 *   使わない＝敗北（家康本陣が 188.6 秒に崩れる）。前線 4 隊（忠勝・酒井・榊原・弓）が 136.8 秒までにすべて敗走。90 秒の前線の士気の平均 43。
 *   使う＝日没で撤退（敗北しない）。90 秒の前線の士気の平均 85（忠勝 99・酒井 80・榊原 59・弓 100）。
 *   【号令の直し（docs/fields-group2-design.md §1。基準を作り直したのはこの台本だけ）】
 *   直す前（a027682）：前線の敗走 0。代わりに士気の床で崩れずに戦い続けた榊原隊が 104.4 秒に全滅（効果中に兵 0 まで斬り合う＝依頼の
 *   「死ぬまで退かない」）、弓隊が 184 秒に全滅。
 *   直した後（ABILITY_DATA.ieyasu_rally.routGuardMinStrength＝0.3）：榊原隊は効果中の 91.1 秒に兵が最初の 3 割（120）を切り、守りが外れて
 *   その場で敗走（「兵が減り、号令でも支えきれない」）→ 116.3 秒に戦場から逃れる（兵 91 が残る。全滅しない）。効果中に全滅する部隊は 0。
 *   弓隊は効果が切れた（105.9 秒）後、普通の決まりで敵の騎馬に斬られ、159.7 秒に全滅（本陣の近くで士気の低下 ×0.75・号令の +40 で
 *   士気 100 から始まったため、士気 15 に届く前に兵が尽きた。効果中の守りではなく普通の決まりの結果）。
 *   結果は変わらず日没で撤退（480 秒）。90 秒の士気の平均も同じ（榊原隊が 3 割を切るのは 90 秒の後）。
 * - 酒井「両翼の采配」（地形に合った作戦の前半：酒井隊が敵の左備を正面で受け、騎馬が横から当たる 46 秒に使う）：
 *   騎馬が背後から当たった 59.9 秒に左備が包囲され（正面＋背後）、その刻みに敗走（使わない時は 63.0 秒）。60 秒の左備の士気 34 → 13。
 *   左備の兵の残り 220 → 260（Version 13 候補の確認で「包囲を作ること自体が条件」に直した後の値。前は包囲がなくても側面 ×1.8 が効き、
 *   崩れた後の追い討ちにも掛かって 143 だった。今は崩れた相手は包囲にならないので追い討ちは強くならず、早く崩れた分だけ兵が残る）。
 *   局面：正面から 2 部隊で当たるだけなら、能力の有無で左備の兵・士気は 1 刻みも同じ（20 秒で兵 516・士気 58）。正面＋側面なら包囲になり、
 *   4 秒の左備の損害 37 → 72・士気 65 → 32、5.8 秒に敗走（使わない時は 20 秒でも崩れない。兵 428・士気 17）。
 * - 石川「後詰めの差配」（騎馬を予備に残し、敵の騎馬が林から出た 76 秒に騎馬を当てる。石川隊が騎馬を選んで急がせる）：
 *   敵の騎馬の敗走 150.9 秒 → 104.9 秒。110 秒の敵の騎馬の兵 266 → 131。徳川騎馬隊の士気 80 → 100（+30・上限 100）。
 * - 忠勝「退路の守護」（右翼の榊原隊が押された 65 秒に撤退を命じる。同じ時に忠勝隊が守護）：
 *   榊原隊：使わない＝87.4 秒に敗走（兵 207）／使う＝96.7 秒に戦場を離れる（撤退。兵 285）。
 *   敵の右備・騎馬が忠勝隊へ引きつけられ、忠勝隊は 65 秒の兵 335 → 105 秒 206 と大きく削られて 93.9 秒に敗走（使わない時は 111.2 秒）。無敵ではない。
 * - 榊原「先駆けの号」（局面：東へ回った榊原隊が、南を向く敵の弓隊へ急襲。90 m から使う）：
 *   弓隊に斬り込む時刻 22.6 秒 → 12.6 秒。30 秒の弓隊の兵 373 → 284。弓隊は 107.5 秒に敗走（使わない時は 120 秒でも崩れない）。
 *   代償：切れた 20 秒に榊原隊の士気 −15（19 秒 72 → 21 秒 56）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, isActive, stepBattle, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order, UnitDef } from '../proto3d/src/battle/types';

const PLAINS = getField('plains')!;
const N = 0;
const S = Math.PI;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、{ abilityTarget } は対象の要る能力 */
type Step = [number, string, Order | 'ability' | { abilityTarget: string }];
const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });

interface Run {
    s: BattleState;
    o: BattleOutcome;
    refused: string[];
    /** 時刻ごとの部隊の兵・士気・状態 */
    at: Record<number, Record<string, { str: number; mor: number; st: string }>>;
    /** 出来事の時刻（最初の 1 つ） */
    when: (kind: string, unitId: string) => number | null;
    /** 包囲された部隊と、最初に包囲された時刻 */
    encircledAt: Record<string, number>;
}

/**
 * 台本を最後まで進める（早送り）。trigger は毎刻み呼び、返した行をその時刻に足す（1 回だけ）。snaps の時刻に全部隊を写す。
 * units を渡せば、大平原の地図にその部隊を置いた局面（目標なし）で進める
 */
function play(steps: Step[], opts: { trigger?: (s: BattleState) => Step[] | null; snaps?: number[]; units?: UnitDef[]; maxSec?: number } = {}): Run {
    const setup = opts.units ? buildBattleSetup(PLAINS, opts.units, { objectives: 'none' }) : buildBattleSetup(PLAINS, 'standard');
    const s = createBattle(setup);
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const snaps = [...(opts.snaps ?? [])];
    const at: Run['at'] = {};
    let fired = false;
    const encircledAt: Record<string, number> = {};
    const maxSec = opts.maxSec ?? 3600;
    while (!s.result && s.t < maxSec) {
        if (opts.trigger && !fired) {
            const add = opts.trigger(s);
            if (add) {
                fired = true;
                q.unshift(...add.map(([, id, o]) => [s.t, id, o] as Step));
            }
        }
        while (q.length && s.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            const ok = ord === 'ability' ? useAbility(s, id).ok : typeof ord === 'object' && 'abilityTarget' in ord ? useAbility(s, id, ord.abilityTarget).ok : issueOrder(s, id, ord);
            if (!ok) refused.push(`${t}:${id}`);
        }
        while (snaps.length && s.t >= snaps[0]! - 1e-9) {
            const t = snaps.shift()!;
            at[t] = Object.fromEntries(s.units.map((u) => [u.id, { str: Math.round(u.strength), mor: Math.round(u.morale), st: u.status }]));
        }
        stepBattle(s, 0.1);
        for (const id of s.encircled) encircledAt[id] ??= Math.round(s.t * 10) / 10;
    }
    const when = (kind: string, unitId: string) => s.events.find((e) => e.kind === kind && e.unitId === unitId)?.t ?? null;
    return { s, o: s.result!, refused, at, when, encircledAt };
}

const FRONT = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_yumi'];

describe('家康「立て直しの号令」：崩れかけの前線の立て直し（大平原・演習の編成）', () => {
    // 前線は命令を出さず持ち場で受ける。前線のどれかの士気が 45 を切ったら号令（使う方だけ）
    const shaky = (s: BattleState) => s.units.some((u) => FRONT.includes(u.id) && isActive(u) && u.morale < 45);
    const off = play([], { snaps: [90, 150] });
    const on = play([], { snaps: [90, 150], trigger: (s) => (shaky(s) ? [[0, 'a_ieyasu', 'ability']] : null) });
    const avg = (r: Run, t: number) => FRONT.reduce((a, id) => a + r.at[t]![id]!.mor, 0) / FRONT.length;
    const routedBy = (r: Run, t: number) => r.s.events.filter((e) => e.kind === 'rout' && FRONT.includes(e.unitId ?? '') && e.t <= t).length;

    it('使わない：前線 4 隊が次々に敗走し、家康本陣が崩れて負ける', () => {
        expect(off.o.result).toBe('defeat');
        expect(off.o.reason).toBe('ally_hq_routed');
        expect(routedBy(off, 150)).toBe(4);
    });
    it('使う：号令の後、前線の士気が大きく戻り（90 秒の平均が 30 以上高い）、負けずに日没まで持ちこたえる。150 秒までに崩れる前線は 1 隊だけ（使わない時は 4 隊）', () => {
        const usedAt = on.o.abilitiesUsed!.a_ieyasu!;
        expect(usedAt).toBeGreaterThan(60);
        expect(usedAt).toBeLessThan(80);
        expect(avg(on, 90)).toBeGreaterThan(avg(off, 90) + 30);
        expect(routedBy(on, 150)).toBe(1);
        expect(on.o.result).not.toBe('defeat');
        expect(on.o.elapsedSec).toBeGreaterThan(off.o.elapsedSec);
    });
    it('号令の直し：効果中に士気で崩れる前線はいない。崩れたのは兵が最初の 3 割を切った部隊だけで、全滅するまで戦わずに退く（効果中の全滅 0）', () => {
        const usedAt = on.o.abilitiesUsed!.a_ieyasu!;
        const inEffect = (e: { t: number; unitId?: string }) => e.t >= usedAt && e.t <= usedAt + 35 && !!e.unitId?.startsWith('a_');
        const routs = on.s.events.filter((e) => e.kind === 'rout' && inEffect(e));
        // 直す前は 0（士気の床で崩れず、榊原隊が 104.4 秒に全滅していた）。直した後は榊原隊が 91.1 秒に敗走する
        expect(routs.map((e) => e.unitId)).toEqual(['a_sakakibara']);
        expect(routs[0]!.text).toContain('号令でも支えきれない');
        expect(on.s.events.filter((e) => e.kind === 'destroyed' && inEffect(e))).toEqual([]);
        // 榊原隊は兵を残して戦場から逃れる（直す前は全滅）
        const saka = on.o.units.find((u) => u.id === 'a_sakakibara')!;
        expect(saka.status).toBe('routed');
        expect(saka.endStrength).toBeGreaterThan(0);
        expect(on.when('fled', 'a_sakakibara')).not.toBeNull();
        expect(on.when('destroyed', 'a_sakakibara')).toBeNull();
    });
});

describe('酒井「両翼の采配」：挟み撃ち（大平原）', () => {
    // 地形に合った作戦の前半（本陣へ押す 120 秒の前まで）：酒井隊が正面で受ける左備へ、西を回った騎馬が横から当たる
    const FIT_EARLY: Step[] = [
        [0, 'a_yumi', atk('e_sente')],
        [0, 'a_kiba', mv(-160, -20)],
        [45, 'a_kiba', atk('e_left')],
        [80, 'a_ishikawa', atk('e_kiba')],
    ];
    const off = play(FIT_EARLY, { snaps: [60] });
    const on = play([...FIT_EARLY, [46, 'a_sakai', 'ability']], { snaps: [60] });

    // Version 13 候補の確認で、側面 ×1.8 を包囲の中だけにした（依頼「包囲を作ること自体が条件」）。前は「兵も多く失う（220 → 143）」も確かめていたが、
    // それは包囲のない側面の当たり・崩れた後の追い討ちに ×1.8 が掛かった分だった。今は包囲が起きたこと・早く崩れること・士気の落ち方を確かめる
    it('正面（酒井隊）と背後（騎馬）で挟んだ左備は包囲され、その場で崩れる（使わない時より早く、士気も大きく落ちる）。使わない時は包囲にならない', () => {
        expect(on.refused).toEqual([]);
        expect(on.encircledAt.e_left).toBeDefined();
        expect(off.encircledAt.e_left).toBeUndefined();
        const routOff = off.when('rout', 'e_left')!;
        const routOn = on.when('rout', 'e_left')!;
        expect(routOn).toBeLessThan(routOff - 2);
        expect(routOn).toBeLessThanOrEqual(on.encircledAt.e_left! + 0.5);
        expect(on.at[60]!.e_left!.mor).toBeLessThan(off.at[60]!.e_left!.mor - 15);
    });

    // 局面：大平原の地図に、南を向く敵の槍と、その正面で斬り合う酒井隊・もう 1 部隊（正面か側面）を置く
    const pinScene = (second: 'front' | 'flank'): UnitDef[] => [
        { id: 'a_ieyasu', side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', generalId: 'ieyasu', leaderId: 'ieyasu', strength: 300, morale: 90, x: 0, z: 140, facing: N },
        { id: 'a_sakai', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '酒井忠次隊', generalId: 'sakai', leaderId: 'sakai', strength: 400, morale: 80, x: -60, z: 22, facing: N, order: atk('e_left') },
        second === 'front'
            ? { id: 'a_two', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川槍隊', strength: 400, morale: 80, x: -48, z: 20, facing: N, order: atk('e_left') }
            : { id: 'a_two', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川槍隊', strength: 400, morale: 80, x: -38, z: 0, facing: -Math.PI / 2, order: atk('e_left') },
        { id: 'e_hq', side: 'enemy', clan: 'rival', kind: 'honjin', name: '敵勢の本陣', strength: 400, morale: 90, x: 0, z: -140, facing: S, aiRole: 'guard_hq' },
        { id: 'e_left', side: 'enemy', clan: 'rival', kind: 'yari', name: '敵勢の左備', strength: 600, morale: 85, x: -60, z: 0, facing: S, aiRole: 'hold_line' },
        // 左備が崩れても合戦が終わらないように、遠くに敵の槍を 1 つ置く
        { id: 'e_far', side: 'enemy', clan: 'rival', kind: 'yari', name: '敵勢の右備', strength: 500, morale: 80, x: 150, z: -140, facing: S, aiRole: 'hold_line' },
    ];
    const local = (second: 'front' | 'flank', use: boolean) => play(use ? [[0, 'a_sakai', 'ability']] : [], { units: pinScene(second), snaps: [4, 20], maxSec: 20.05 });

    it('正面だけ（2 部隊とも正面から）では強くならない：能力の有無で左備の兵・士気は 20 秒後も同じ', () => {
        const a = local('front', false);
        const b = local('front', true);
        expect(b.at[20]!.e_left).toEqual(a.at[20]!.e_left);
        expect(b.s.encircled).toEqual([]);
    });
    it('正面＋側面なら包囲になり、左備は 4 秒で損害 1.6 倍以上・士気が大きく落ちて 10 秒のうちに崩れる（使わない時は 20 秒でも崩れない）', () => {
        const a = local('flank', false);
        const b = local('flank', true);
        const lost = (r: Run) => 600 - r.at[4]!.e_left!.str;
        expect(lost(b)).toBeGreaterThan(lost(a) * 1.6);
        expect(b.at[4]!.e_left!.mor).toBeLessThan(a.at[4]!.e_left!.mor - 20);
        expect(b.when('rout', 'e_left')!).toBeLessThan(10);
        expect(a.when('rout', 'e_left')).toBeNull();
    });
});

describe('石川「後詰めの差配」：予備の再配置（大平原・演習の編成）', () => {
    // 騎馬は左の外の持ち場で予備に残す。敵の騎馬が林から出てきたら（76 秒）騎馬を当てる。使う方は同じ時に石川隊が騎馬を選んで急がせる
    const off = play([[76, 'a_kiba', atk('e_kiba')]], { snaps: [110] });
    const on = play([[76, 'a_kiba', atk('e_kiba')], [76, 'a_ishikawa', { abilityTarget: 'a_kiba' }]], { snaps: [110] });

    it('予備の騎馬が 1.8 倍の速さで回り込み、敵の騎馬を 40 秒以上早く崩す。騎馬の士気も上がる（予備なので低下もさらに小さい）', () => {
        expect(on.refused).toEqual([]);
        expect(on.s.abilities.a_ishikawa!.reserveBonus).toBe(true);
        const routOff = off.when('rout', 'e_kiba')!;
        const routOn = on.when('rout', 'e_kiba')!;
        expect(routOn).toBeLessThan(routOff - 40);
        expect(on.at[110]!.e_kiba!.str).toBeLessThan(off.at[110]!.e_kiba!.str - 100);
        expect(on.at[110]!.a_kiba!.mor).toBeGreaterThan(off.at[110]!.a_kiba!.mor + 10);
    });
    it('代償：石川隊は差配の 30 秒のあいだ持ち場から動かない（自分で当たる力は上がらない）', () => {
        const ishi = on.s.events.filter((e) => e.unitId === 'a_ishikawa' && e.kind === 'general' && e.t > 76 && e.t < 106);
        expect(ishi).toEqual([]);
        expect(on.s.events.some((e) => e.kind === 'ability_end' && e.unitId === 'a_ishikawa' && Math.abs(e.t - 106) < 0.2)).toBe(true);
    });
});

describe('忠勝「退路の守護」：撤退の援護（大平原・演習の編成）', () => {
    // 右翼の榊原隊が押された 65 秒に撤退を命じる。使う方は同じ時に忠勝隊が守護
    const off = play([[65, 'a_sakakibara', { type: 'retreat' }]], { snaps: [65, 105] });
    const on = play([[65, 'a_sakakibara', { type: 'retreat' }], [65, 'a_tadakatsu', 'ability']], { snaps: [65, 105] });
    const saka = (r: Run) => r.o.units.find((u) => u.id === 'a_sakakibara')!;

    it('使わない：退く榊原隊は追われて敗走する／使う：追っ手が忠勝隊へ引きつけられ、榊原隊は兵を多く残して撤退できる', () => {
        expect(off.when('rout', 'a_sakakibara')).not.toBeNull();
        expect(saka(off).status).toBe('routed');
        expect(on.when('rout', 'a_sakakibara')).toBeNull();
        expect(saka(on).status).toBe('withdrawn');
        expect(saka(on).endStrength).toBeGreaterThan(saka(off).endStrength + 50);
        const lured = on.s.events.filter((e) => e.kind === 'ai' && e.text.includes('本多忠勝隊に引きつけられた'));
        expect(lured.length).toBeGreaterThanOrEqual(2);
    });
    it('忠勝隊は無敵ではない：引きつけた追っ手に大きく削られ（40 秒で兵の 3 割以上）、使わない時より早く崩れる', () => {
        const t65 = on.at[65]!.a_tadakatsu!.str;
        const t105 = on.at[105]!.a_tadakatsu!.str;
        expect(t65 - t105).toBeGreaterThan(t65 * 0.3);
        expect(t65 - t105).toBeGreaterThan(off.at[65]!.a_tadakatsu!.str - off.at[105]!.a_tadakatsu!.str + 30);
        expect(on.when('rout', 'a_tadakatsu')!).toBeLessThan(off.when('rout', 'a_tadakatsu')!);
    });
});

describe('榊原「先駆けの号」：敵弓隊への急襲（大平原の地図の局面）', () => {
    // 大平原の地図に局面を置く：忠勝隊が正面で敵の先手と斬り合い、東へ回った榊原隊（槍）が、南を向く敵の弓隊へ急襲する（90 m から使う）
    const raidScene = (): UnitDef[] => [
        { id: 'a_ieyasu', side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', generalId: 'ieyasu', leaderId: 'ieyasu', strength: 300, morale: 90, x: 0, z: 120, facing: N },
        { id: 'a_tadakatsu', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '本多忠勝隊', generalId: 'tadakatsu', leaderId: 'tadakatsu', strength: 450, morale: 85, x: 0, z: 50, facing: N },
        { id: 'a_sakakibara', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '榊原康政隊', generalId: 'sakakibara', leaderId: 'sakakibara', strength: 400, morale: 80, x: 110, z: -45, facing: -Math.PI / 2 },
        { id: 'e_hq', side: 'enemy', clan: 'rival', kind: 'honjin', name: '敵勢の本陣', strength: 400, morale: 80, x: 0, z: -120, facing: S, aiRole: 'guard_hq' },
        { id: 'e_sente', side: 'enemy', clan: 'rival', kind: 'yari', name: '敵勢の先手', strength: 500, morale: 80, x: 0, z: 25, facing: S, aiRole: 'hold_line', order: atk('a_tadakatsu') },
        { id: 'e_yumi', side: 'enemy', clan: 'rival', kind: 'yumi', name: '敵勢の弓隊', strength: 400, morale: 80, x: 30, z: -75, facing: S, aiRole: 'hold_line' },
    ];
    const run = (use: boolean) => play([[0, 'a_sakakibara', atk('e_yumi')], ...(use ? ([[0, 'a_sakakibara', 'ability']] as Step[]) : [])], { units: raidScene(), snaps: [19, 21, 30, 120], maxSec: 120 });
    const off = run(false);
    const on = run(true);
    const contact = (r: Run) => r.when('engage', 'a_sakakibara') ?? r.s.events.find((e) => e.kind === 'engage' && e.targetId === 'a_sakakibara')?.t ?? null;

    it('速く当たり（斬り込む時刻が 8 秒以上早い）、最初の当たりが強く、弓隊を崩す（使わない時は 120 秒でも崩れない）', () => {
        expect(on.refused).toEqual([]);
        expect(contact(on)!).toBeLessThan(contact(off)! - 8);
        expect(on.at[30]!.e_yumi!.str).toBeLessThan(off.at[30]!.e_yumi!.str - 60);
        expect(on.when('rout', 'e_yumi')).not.toBeNull();
        expect(on.when('rout', 'e_yumi')!).toBeLessThan(120);
        expect(off.when('rout', 'e_yumi')).toBeNull();
        expect(on.s.events.some((e) => e.kind === 'ability' && e.text.includes('先駆けて斬り込んだ'))).toBe(true);
    });
    it('代償：効果が切れた 20 秒に榊原隊の士気 −15', () => {
        expect(on.at[21]!.a_sakakibara!.mor).toBeLessThan(on.at[19]!.a_sakakibara!.mor - 12);
        expect(on.s.events.some((e) => e.kind === 'ability_end' && e.unitId === 'a_sakakibara' && e.text.includes('士気 −15'))).toBe(true);
    });
});
