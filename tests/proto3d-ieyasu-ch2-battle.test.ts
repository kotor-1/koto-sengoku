/**
 * 歴史分岐「元亀元年・家康」第二章の合戦の設定（chapter2/battle.ts）と、合戦の側の小さな足し（docs/chapter2-design.md §8）。
 * - 合戦の画面の言葉：第二章の合戦は BattleSetup.story の注記（第一章の直後の分岐した世界・創作）を出し、「約束：引き受けていない」の行を出さない。
 *   第一章・演習・架空の章の言葉は 1 文字も変わらない。
 * - 時刻で現れる敵の組（A の伏兵・後詰め、B の援軍、C の波）は援軍の組（地図の「援軍の出る所」の名札・着いた知らせ）。補充で待っても付く。
 * - 地図は演習の戦場の地図の写し（id は ieyasu2_<戦場の id>・名前は物語の物。共有の地図・地形は書き換えない）。
 * - 物語側の設定の検査（validateChapter2Setup）：どの段階・判断でも空。わざと壊した設定は見つける。
 * - 目標 withdraw・escape の required（必ず離れる部隊）：崩れたら失敗・出口でない所から退いたら失敗・全部離れたら果たす・進み具合の文。
 *
 * 種類：状態を直接変える確かめ（位置・状態を書き換える）はテスト名にそう書く。それ以外は設定を作って読むだけか、命令を出さずに時間を進める早送り。
 * 釣り合い（作戦ごとの勝ち数・損害・時間）は tests/proto3d-ieyasu-ch2-battle-{oda,asai,home}.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { mapLabels, pledgeResultModel, reinforcementMarks, scenarioTexts } from '../proto3d/src/battle/control';
import { createObjectiveTrack, objectiveProgress } from '../proto3d/src/battle/objectives';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup } from '../proto3d/src/battle/maps';
import { buildBattleSetup, fieldMap, getField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, BattleSetup, ObjectiveDef, UnitDef } from '../proto3d/src/battle/types';
import { CH2_FIELDS, CH2_MAP_NAMES, CH2_PLANS, CH2_STORY_NOTE, CH2_UNIT, ch2BattleSetup, validateChapter2Setup } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { CH2_TIERS, ch2TierAvailable, ch2TierInput } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import type { Policy } from '../proto3d/src/campaign/ieyasu1570/state';

const POLICIES: Policy[] = ['oda', 'asai', 'home'];

function advance(s: BattleState, sec: number): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) stepBattle(s, 0.1);
}
const setupOf = (policy: Policy, plan: 'commit' | 'hold' = 'commit', tier: (typeof CH2_TIERS)[number] = 'typical') => ch2BattleSetup(ch2TierInput(policy, plan, tier)).setup;

describe('合戦の画面の言葉（BattleSetup.story）', () => {
    it('第二章の合戦：題の添え書き・札・結果の添え書きが第二章の物。歴史分岐の扱い（家康は落ち延びる）はそのまま', () => {
        for (const p of POLICIES) {
            const s = createBattle(setupOf(p));
            const sc = scenarioTexts(s);
            expect(sc.historical).toBe(true);
            expect(sc.practice).toBe(false);
            expect(sc.titleNote).toBe('第一章の直後の、分岐した世界での出来事（創作）');
            expect(sc.tag).toBe('第二章（創作）');
            expect(sc.notes.victory).toBe(CH2_STORY_NOTE.notes!.victory);
            expect(sc.notes.defeat).toContain('家康は生きている');
            expect(sc.reasons.ally_hq_routed).toContain('落ち延びた');
            // 合戦の前の説明の見出し（battle/entry.ts の showBriefing と同じ組み立て）
            expect(`合戦「${s.map.name}」（${sc.titleNote}）`).toBe(`合戦「${CH2_MAP_NAMES[p]}」（第一章の直後の、分岐した世界での出来事（創作））`);
            // 合戦の前の説明の 1 行目は「特定の史実の合戦の再現ではない」
            expect(s.setup.briefing[0]).toContain('特定の史実の合戦の再現ではない');
        }
    });
    it('第二章の結果の画面に「約束：引き受けていない」の行を出さない（約束の欄が null）', () => {
        for (const p of POLICIES) {
            const s = createBattle(setupOf(p));
            const o: BattleOutcome = { result: 'victory', reason: 'objective_done', elapsedSec: 100, units: [] };
            expect(pledgeResultModel(s, o)).toBeNull();
            expect(pledgeResultModel(s, { ...o, result: 'defeat', reason: 'objective_failed' })).toBeNull();
        }
    });
    it('第一章・演習・架空の章の言葉は今までと同じ（story を持たない）', () => {
        const ch1 = createBattle(ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: false }));
        expect(ch1.setup.story).toBeUndefined();
        const t1 = scenarioTexts(ch1);
        expect(t1.titleNote).toBe('1570年の情勢を背景にした架空の局地戦');
        expect(t1.tag).toBe('架空の局地戦');
        expect(t1.notes.victory).toBe('この局地戦には勝った。一度の勝利で相手の家が滅ぶわけではない。');
        const d = pledgeResultModel(ch1, { result: 'victory', reason: 'enemy_hq_routed', elapsedSec: 1, units: [] })!;
        expect(d.title).toBe('約束：引き受けていない');
        for (const id of ['rearguard', 'relief', 'village']) {
            const pr = createBattle(buildBattleSetup(getField(id)!, 'standard'));
            const tp = scenarioTexts(pr);
            expect(tp.titleNote).toBe('ゲーム用の演習（架空の相手）');
            expect(tp.tag).toBe('演習（架空の相手）');
            expect(pr.map.name).toBe(getField(id)!.name);
        }
        const f = scenarioTexts(createBattle(demoSetup('tashiro')));
        expect(f.titleNote).toBe('仮シナリオ');
        expect(f.tag).toBe('仮シナリオ');
    });
});

describe('地図の写し（演習の戦場の地図は書き換えない）', () => {
    it('id は ieyasu2_<戦場の id>・名前は物語の物。地形・退き口は演習の戦場と同じ物を使い、共有の地図そのものではない', () => {
        for (const p of POLICIES) {
            const field = CH2_FIELDS[p];
            const shared = fieldMap(field);
            const before = { id: shared.id, name: shared.name };
            const setup = setupOf(p);
            expect(setup.map.id).toBe(`ieyasu2_${field.id}`);
            expect(setup.map.name).toBe(CH2_MAP_NAMES[p]);
            expect(setup.map).not.toBe(shared);
            expect(setup.map.terrain).toBe(field.terrain);
            expect(setup.map.exits).toBe(field.exits);
            // 演習の戦場の地図・目標は変わらない
            expect({ id: shared.id, name: shared.name }).toEqual(before);
            expect(buildBattleSetup(field, 'standard').map.name).toBe(field.name);
            expect(setup.objectives!.primary).not.toBe(field.objectives.primary);
            // 武将の自由な動きは使わない（演習の戦場は true）・追い討ちあり
            expect(setup.generalInitiative).toBeUndefined();
            expect(field.generalInitiative).toBe(true);
            expect(setup.pursuit).toBe(true);
        }
    });
});

describe('時刻で現れる敵の組（援軍の出る所の名札・着いた知らせ）', () => {
    const groupsOf = (s: BattleSetup) => (s.reinforcements ?? []).map((g) => `${g.id}:${g.unitIds.join('+')}`);
    it('A の伏兵・後詰め、B の援軍、C の 3 つの波が組になる。補充で待って時刻が変わっても付く', () => {
        for (const tier of ['typical', 'weakwait'] as const) {
            expect(groupsOf(setupOf('oda', 'commit', tier))).toEqual(['ch2_oda_ambush:e_asakura_amb', 'ch2_oda_late:e_asai_late']);
            expect(groupsOf(setupOf('asai', 'commit', tier))).toEqual(['ch2_asai_late:e_oda_late']);
            expect(groupsOf(setupOf('home', 'commit', tier))).toEqual([
                'ch2_home_wave1:e_ronin_w1_yari+e_ronin_w1_yumi',
                'ch2_home_wave2:e_ronin_w2_yari+e_ronin_w2_kiba',
                'ch2_home_wave3:e_ronin_w3_yari+e_ronin_w3_yumi',
            ]);
        }
        // どの設定でも、時刻で現れる敵はどれも組に入っている
        for (const p of POLICIES)
            for (const plan of CH2_PLANS)
                for (const tier of CH2_TIERS) {
                    if (!ch2TierAvailable(p, plan, tier)) continue;
                    const s = setupOf(p, plan, tier);
                    const late = s.units.filter((u) => u.side === 'enemy' && u.arriveAt !== undefined).map((u) => u.id);
                    const grouped = (s.reinforcements ?? []).flatMap((g) => g.unitIds);
                    expect(late.sort(), `${p} ${plan} ${tier}`).toEqual([...grouped].sort());
                }
    });
    it('地図の名札「援軍の出る所（開始 …）」の時刻が、待ったときは 40 秒早い（C の波：0:20・1:50・3:20 → 0:01・1:10・2:40）', () => {
        const at = (tier: 'typical' | 'weakwait') =>
            reinforcementMarks(createBattle(setupOf('home', 'commit', tier)))
                .map((m) => m.at)
                .sort((a, b) => a - b);
        expect(at('typical')).toEqual([20, 110, 200]);
        expect(at('weakwait')).toEqual([1, 70, 160]);
        const labels = mapLabels(createBattle(setupOf('home', 'commit', 'typical'))).map((l) => l.text);
        expect(labels.filter((t) => t.startsWith('援軍の出る所')).sort()).toEqual(['援軍の出る所（開始 0:20）', '援軍の出る所（開始 1:50）', '援軍の出る所（開始 3:20）']);
        const a = mapLabels(createBattle(setupOf('oda', 'hold', 'weakwait'))).map((l) => l.text);
        expect(a).toContain('援軍の出る所（開始 0:30）');
        expect(a).toContain('援軍の出る所（開始 0:45）');
    });
    it('着いた時に「敵の援軍（…）が現れた」と知らせる（早送り：命令を出さずに時間だけ進める）', () => {
        const s = createBattle(setupOf('home', 'hold', 'typical'));
        advance(s, 21);
        const texts = s.events.filter((e) => e.kind === 'arrive').map((e) => e.text);
        expect(texts).toContain('敵の援軍（浪人衆の槍（一））が現れた');
        expect(texts).toContain('敵の援軍（浪人衆の弓（一））が現れた');
        const b = createBattle(setupOf('asai', 'hold', 'weakwait'));
        advance(b, 201);
        expect(b.result).toBeNull();
        expect(b.events.some((e) => e.kind === 'arrive' && e.text === '敵の援軍（織田方の援軍）が現れた' && e.t <= 200.1)).toBe(true);
    });
});

describe('物語側の設定の検査（validateChapter2Setup）', () => {
    it('3 方針 × 判断 2 × 第一章の段階 5 つ（選べる判断だけ）で空。補充の 3 通り（待つ・回す・今の兵）の兵でも空', () => {
        let n = 0;
        for (const p of POLICIES)
            for (const plan of CH2_PLANS)
                for (const tier of CH2_TIERS) {
                    if (!ch2TierAvailable(p, plan, tier)) continue;
                    const input = ch2TierInput(p, plan, tier);
                    const info = ch2BattleSetup(input);
                    expect(validateChapter2Setup(info.setup), `${p} ${plan} ${tier}`).toEqual([]);
                    // 守備隊から兵を回した形（守備隊 −150・ほかへ配る。合計は同じ）
                    if (input.troops.reserve >= 250) {
                        const moved = { ...input.troops, reserve: input.troops.reserve - 150, tadakatsu: input.troops.tadakatsu + 75, yumi: input.troops.yumi + 75 };
                        expect(validateChapter2Setup(ch2BattleSetup({ ...input, troops: moved }).setup), `${p} ${plan} ${tier} 回す`).toEqual([]);
                    }
                    n++;
                }
        // minimum の判断 2（守備隊を残すと本陣だけ）の 3 つは選べない
        expect(n).toBe(3 * 2 * 5 - 3);
        for (const p of POLICIES) expect(ch2TierAvailable(p, 'hold', 'minimum')).toBe(false);
    });
    it('わざと壊した設定を見つける（状態を直接変える：設定の写しを書き換える）', () => {
        const base = () => structuredClone(setupOf('oda', 'commit', 'typical')) as BattleSetup;
        const find = (f: (s: BattleSetup) => void, re: RegExp) => {
            const s = base();
            f(s);
            const out = validateChapter2Setup(s);
            expect(out.some((x) => re.test(x)), `${re} ${JSON.stringify(out)}`).toBe(true);
        };
        const u = (s: BattleSetup, id: string) => s.units.find((x) => x.id === id)!;
        // 崖の上（退却戦の崖 x 20〜200, z 90〜130）・戦場の外
        find((s) => Object.assign(u(s, 't_yumi'), { x: 100, z: 110 }), /t_yumi の置き場所 .*が通れる所にない/);
        find((s) => Object.assign(u(s, 't_yumi'), { x: 400, z: 0 }), /t_yumi の置き場所 .*が通れる所にない/);
        // 敵の行き先が崖の上
        find((s) => (u(s, 'e_asai_yumi').aiTarget = { x: -100, z: 110, r: 20 }), /e_asai_yumi の敵の考えの地点が通れる所にない/);
        // 家康本陣の前に別の本陣
        find((s) => s.units.unshift({ ...u(s, CH2_UNIT.odaRear), id: 'a_other_hq', kind: 'honjin', x: 0, z: 150 }), /味方の最初の本陣が家康本陣でない/);
        // 時刻で現れる敵が組に入っていない・時刻が合戦の外
        find((s) => (s.reinforcements = s.reinforcements!.filter((g) => g.id !== 'ch2_oda_late')), /e_asai_late が援軍の組に入っていない/);
        find((s) => (u(s, 'e_asakura_amb').arriveAt = 9999), /着く時刻 9999 が合戦の時間の外/);
        // 必ず離れる部隊が味方にいない・要る数が多すぎる
        find((s) => ((s.objectives!.primary as Extract<ObjectiveDef, { type: 'withdraw' }>).required = ['e_asai_yumi', CH2_UNIT.odaBaggage]), /必ず離れる部隊 e_asai_yumi が味方にいない/);
        find((s) => ((s.objectives!.primary as Extract<ObjectiveDef, { type: 'withdraw' }>).count = 9), /要る数 9/);
        // 部隊数の上限・id の重なり・共有の地図
        find((s) => s.units.push(...Array.from({ length: 4 }, (_, i) => ({ ...u(s, 't_yumi'), id: `a_more${i}`, x: -60 + i * 20, z: 160 }) as UnitDef)), /ally の部隊が 10（上限 8）/);
        find((s) => s.units.push({ ...u(s, 't_yumi') }), /部隊の id が重なっている：t_yumi/);
        find((s) => (s.map = fieldMap(CH2_FIELDS.oda)), /ieyasu2_ で始まらない/);
        // 救出の対象が味方にいない（B）
        const b = structuredClone(setupOf('asai')) as BattleSetup;
        b.units = b.units.filter((x) => x.id !== CH2_UNIT.asai);
        expect(validateChapter2Setup(b).some((x) => /目標 ch2_asai_escort の部隊 a_asai が味方にいない/.test(x))).toBe(true);
    });
});

// ---------------------------------------------------------------- 目標 withdraw・escape の required

describe('離脱の目標の「必ず離れる部隊」（required。第二章だけが使う）', () => {
    /** 退却戦の地形に、敵を遠くに置いた小さな編成（総大将・必ず離れる 2 隊・ほか 1 隊）。count 2・required 2 隊 */
    function small(required: string[] = ['a_r1', 'a_r2'], count = 2): BattleState {
        const field = getField('rearguard')!;
        const units: UnitDef[] = [
            { id: 't_honjin', side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', strength: 300, morale: 90, x: 0, z: 150, facing: 0 },
            { id: 'a_r1', side: 'ally', clan: 'oda', kind: 'yari', name: '織田勢の後備え', strength: 300, morale: 80, x: -25, z: 150, facing: 0 },
            { id: 'a_r2', side: 'ally', clan: 'oda', kind: 'yari', name: '織田勢の小荷駄', strength: 200, morale: 70, x: 25, z: 150, facing: 0 },
            { id: 'a_x', side: 'ally', clan: 'tokugawa', kind: 'yumi', name: '徳川弓隊', strength: 200, morale: 70, x: 0, z: 125, facing: 0 },
            { id: 'e_hq', side: 'enemy', clan: 'asai', kind: 'honjin', name: '追撃の本隊', strength: 300, morale: 80, x: 0, z: -200, facing: Math.PI, aiRole: 'guard_hq' },
        ];
        const primary: ObjectiveDef = { id: 'w', type: 'withdraw', label: '離脱', exit: { rect: { x0: -60, x1: 60, z0: 190, z1: 220 } }, count, required, name: '南の退き口' };
        return createBattle(buildBattleSetup(field, units, { objectives: { primary, secondary: [] }, generalInitiative: false, briefing: [] }));
    }
    const go = (s: BattleState, id: string) => issueOrder(s, id, { type: 'move', x: unitById(s, id)!.x, z: 205 });
    const state = (s: BattleState) => s.objectives!.primary!.state;
    it('総大将とほかの 2 隊が離れても、必ず離れる部隊が残っていれば果たさない。全部離れたら果たす（早送り：移動の命令）', () => {
        const s = small();
        go(s, 't_honjin');
        go(s, 'a_r1');
        go(s, 'a_x');
        advance(s, 40);
        expect(['t_honjin', 'a_r1', 'a_x'].every((id) => unitById(s, id)!.status === 'withdrawn')).toBe(true);
        expect(state(s)).toBe('active');
        expect(s.result).toBeNull();
        expect(objectiveProgress(s)[0]!.progressText).toBe('総大将 済み・ほか 2／2 部隊が離脱・織田勢の後備え 済み・織田勢の小荷駄 まだ（退き口の輪に入った部隊は戦場を離れる）');
        go(s, 'a_r2');
        advance(s, 40);
        expect(state(s)).toBe('done');
        expect(s.result?.result).toBe('victory');
        expect(s.result?.reason).toBe('objective_done');
    });
    it('必ず離れる部隊が崩れたら果たせない（状態を直接変える：敗走にする）', () => {
        const s = small();
        unitById(s, 'a_r2')!.status = 'routed';
        advance(s, 1);
        expect(state(s)).toBe('failed');
        expect(s.result?.result).toBe('defeat');
    });
    it('必ず離れる部隊が退き口でない所から退いたら果たせない（状態を直接変える：輪の外で撤退済みにする）', () => {
        const s = small();
        const u = unitById(s, 'a_r1')!;
        u.status = 'withdrawn';
        u.present = false;
        advance(s, 1);
        expect(state(s)).toBe('failed');
    });
    it('required を省いた離脱は今までどおり（ほかの部隊で数が足りれば果たす）', () => {
        const s = small([], 2);
        go(s, 't_honjin');
        go(s, 'a_r1');
        go(s, 'a_x');
        advance(s, 40);
        expect(state(s)).toBe('done');
        expect(objectiveProgress(s)[0]!.progressText).not.toContain('済み・織田');
    });
    it('合戦を作る時に検査する：必ず離れる部隊が本陣・敵・いない、または count より多いと投げる', () => {
        const mk = (required: string[], count = 2) => () => small(required, count);
        expect(mk(['t_honjin'])).toThrow(/必ず離れる部隊/);
        expect(mk(['e_hq'])).toThrow(/必ず離れる部隊/);
        expect(mk(['a_none'])).toThrow(/必ず離れる部隊/);
        expect(mk(['a_r1', 'a_r2', 'a_x'], 2)).toThrow(/count より多く/);
        expect(() => createObjectiveTrack(small().setup)).not.toThrow();
    });
});
