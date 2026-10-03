/**
 * 歴史分岐「元亀元年・家康」の合戦の副目標（campaign/ieyasu1570 の IEYASU_SIDE_OBJECTIVES・withIeyasuSideObjective）。
 * - 3 方針それぞれに副目標が 1 つ（objectives.secondary）。主目標は入れない（勝ち負けは Version 11 の決まりのまま）。
 * - 副目標を足しても、同じ命令なら同じ勝敗・同じ動き（Version 11 の基準 tests/fixtures/v11-baseline.json と、
 *   目標の出来事を除いて 1 刻みも同じ）。早送り（台本で最後まで一気に進める）。状態の直接変更はしない。
 * - 章の状態には、勝敗（battle）・副目標（sideObjectives）・約束（pledge）を別々の欄に残し、戦後・結末の画面に副目標の行を出す。
 */
import { describe, expect, it } from 'vitest';
import baselineJson from './fixtures/v11-baseline.json';
import { createBattle, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { IEYASU_INITIAL_TROOPS, ieyasu1570Setup, type IeyasuPolicy } from '../proto3d/src/battle/maps';
import { holdScript, ieyasuFrontalScript, ieyasuPlanScript, ieyasuRetreatScript, retreatAt, type Script } from '../proto3d/src/battle/scripts';
import {
    applyIeyasuOutcomeOnce,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    ieyasuOutcomeFromSetup,
    withIeyasuBattleId,
    withIeyasuSideObjective,
} from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_SIDE_OBJECTIVES, POLICIES, type IeyasuState } from '../proto3d/src/campaign/ieyasu1570/state';
import { ieyasuEndingView, ieyasuPhaseIntro, pledgeRecordText, sideObjectiveRecordText } from '../proto3d/src/campaign/ieyasu1570/story';
import { ieyasuStatusLines } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuToBattle, ieyasuToMuster } from './proto3d-ieyasu-helpers';

/** FNV-1a（32 bit）。tests/proto3d-battle-v11-identity.test.ts と同じ */
function fnv(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** V11 の一致のテストと同じ記録。ただし目標の出来事（kind 'objective'）は除く（基準の合戦には目標が無かった） */
function record(s: BattleState, script: Script) {
    const snaps: string[] = [];
    let next = 0;
    const snap = () => {
        const rows = s.units.map((u) => [u.id, u.x, u.z, u.strength, u.morale, u.facing, u.status, JSON.stringify(u.order), u.engagedWith, u.shootingAt].join(','));
        snaps.push(`${s.tick}:${fnv(rows.join('|'))}`);
    };
    const outcome = runToEnd(s, (st) => {
        if (st.t >= next - 1e-9) {
            snap();
            next += 30;
        }
        script(st);
    });
    snap();
    const ev = s.events.filter((e) => e.kind !== 'objective');
    const events = fnv(ev.map((e) => `${e.t}|${e.kind}|${e.text}|${e.unitId ?? ''}|${e.targetId ?? ''}`).join('\n'));
    const { objectives, ...rest } = outcome;
    return { outcome: JSON.parse(JSON.stringify(rest)), objectives, snaps, events, eventCount: ev.length };
}

const base = baselineJson as unknown as Record<string, { outcome: unknown; snaps: string[]; events: string; eventCount: number }>;

describe('副目標のデータ', () => {
    it('3 方針に 1 つずつ。id は重ならず、主目標は入れない', () => {
        const ids = POLICIES.map((p) => IEYASU_SIDE_OBJECTIVES[p].id);
        expect(new Set(ids).size).toBe(3);
        for (const p of POLICIES) {
            const setup = withIeyasuSideObjective(ieyasu1570Setup(p, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true }), p);
            expect(setup.objectives?.primary).toBeUndefined();
            expect(setup.objectives?.secondary).toEqual([IEYASU_SIDE_OBJECTIVES[p]]);
            // 副目標の指す部隊は、その方針の合戦に出る
            const d = IEYASU_SIDE_OBJECTIVES[p];
            if ('unitId' in d) expect(setup.units.some((u) => u.id === d.unitId)).toBe(true);
            // 説明：副目標の 1 行を約束の行の前に
            const i = setup.briefing.findIndex((l) => l.startsWith('副目標：'));
            const j = setup.briefing.findIndex((l) => l.startsWith('約束'));
            expect(i).toBeGreaterThan(0);
            expect(i).toBeLessThan(j);
            expect(setup.briefing[i]).toContain(d.label);
        }
    });
    it('章の合戦の設定（ieyasuBattleSetup）に副目標が入る', () => {
        const s = ieyasuToBattle('asai', 'accept');
        expect(ieyasuBattleSetup(s).objectives).toEqual({ secondary: [IEYASU_SIDE_OBJECTIVES.asai] });
    });
});

describe('副目標を足しても、同じ命令なら Version 11 と同じ勝敗・同じ動き（基準と比べる。早送り）', () => {
    const scripts: [string, (p: IeyasuPolicy) => Script][] = [
        ['hold', () => holdScript],
        ['frontal', (p) => ieyasuFrontalScript(p)],
        ['planKeep', (p) => ieyasuPlanScript(p, 'keep')],
        ['planBreak', (p) => ieyasuPlanScript(p, 'break')],
        ['retreatSave', (p) => ieyasuRetreatScript(p)],
        ['retreat90', () => retreatAt(90)],
    ];
    for (const p of POLICIES) {
        for (const pledge of [true, false]) {
            for (const [name, sc] of scripts) {
                const tag = `ieyasu:${p}:${pledge ? 'pledge' : 'nopledge'}:${name}`;
                it(tag, () => {
                    const b = base[tag];
                    expect(b).toBeDefined();
                    const setup = withIeyasuSideObjective(ieyasu1570Setup(p, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: pledge }), p);
                    const r = record(createBattle(setup), sc(p));
                    expect(r.outcome).toEqual(b.outcome);
                    expect(r.snaps).toEqual(b.snaps);
                    expect(r.eventCount).toBe(b.eventCount);
                    expect(r.events).toBe(b.events);
                    // 副目標は判定されて結果に入る（主目標は無い）
                    expect(r.objectives?.primary).toBeUndefined();
                    expect(r.objectives?.secondary.map((x) => x.id)).toEqual([IEYASU_SIDE_OBJECTIVES[p].id]);
                });
            }
        }
    }
    it('作戦によって、副目標は果たせる・果たせないに分かれる（方針ごと）', () => {
        for (const p of POLICIES) {
            const got = new Set<boolean>();
            for (const [, sc] of scripts) {
                const setup = withIeyasuSideObjective(ieyasu1570Setup(p, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true }), p);
                const o = runToEnd(createBattle(setup), sc(p));
                got.add(o.objectives!.secondary[0].achieved);
            }
            expect([...got].sort()).toEqual([false, true]);
        }
    }, 60_000);
});

describe('章の状態と画面：勝敗・副目標・約束は別々の欄', () => {
    function aftermath(policy: IeyasuPolicy, side: boolean): IeyasuState {
        const s = withIeyasuBattleId(ieyasuToBattle(policy, 'accept'), 'ieyasu1570-side');
        const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'retreat', { pledge: 'kept', sideObjective: side });
        return applyIeyasuOutcomeOnce(s, 'ieyasu1570-side', o).state;
    }
    it('実際の合戦の結果（sim）から、副目標の達成を記録する', () => {
        const s = withIeyasuBattleId(ieyasuToBattle('home', 'accept'), 'ieyasu1570-sim');
        const o = runToEnd(createBattle(ieyasuBattleSetup(s)), holdScript);
        const a = applyIeyasuOutcomeOnce(s, 'ieyasu1570-sim', o).state;
        expect(a.sideObjectives).toEqual([{ ...pick(IEYASU_SIDE_OBJECTIVES.home), achieved: o.objectives!.secondary[0].achieved }]);
        expect(a.battle!.result).toBe(o.result);
        // 合戦の結果の写しには目標を入れない（副目標は別の欄）
        expect(a.battle!.objectives).toBeUndefined();
    });
    it('戦前は「合戦の前」、戦後は果たしたか。約束の行とは別', () => {
        const m = ieyasuToMuster('oda');
        expect(sideObjectiveRecordText(m)).toBe(`${IEYASU_SIDE_OBJECTIVES.oda.label}：合戦の前`);
        const yes = aftermath('oda', true);
        const no = aftermath('asai', false);
        expect(sideObjectiveRecordText(yes)).toBe(`${IEYASU_SIDE_OBJECTIVES.oda.label}：果たした`);
        expect(sideObjectiveRecordText(no)).toBe(`${IEYASU_SIDE_OBJECTIVES.asai.label}：果たせなかった`);
        expect(pledgeRecordText(yes)).not.toContain('副目標');
        // 戦後の案内に 1 文
        expect(ieyasuPhaseIntro(yes).text).toContain(`副目標「${IEYASU_SIDE_OBJECTIVES.oda.label}」は果たした`);
        expect(ieyasuPhaseIntro(no).text).toContain('果たせなかった');
        // メニューの状態：約束の行の次に副目標の行
        const lines = ieyasuStatusLines(yes);
        const li = lines.findIndex((l) => l.label === '副目標');
        expect(lines[li - 1].label).toBe('約束');
        expect(lines[li].value).toContain('果たした');
    });
    it('結末の記録に副目標の行（約束の行とは別）', () => {
        const e = finishTalkIeyasu(aftermath('home', true), 'tadakatsu', 'end_chapter');
        const v = ieyasuEndingView(e);
        const rows = v.record.map((r) => r.label);
        expect(rows).toContain('副目標');
        expect(rows).toContain('約束');
        expect(v.record.find((r) => r.label === '副目標')!.value).toBe(`${IEYASU_SIDE_OBJECTIVES.home.label}：果たした`);
        expect(v.record.find((r) => r.label === '合戦の結果')!.value).toContain('撤退');
    });
    it('記録の無い戦後（古い版の保存から続けた）は「記録なし」と出し、案内には添えない', () => {
        const a = { ...aftermath('oda', true), sideObjectives: null };
        expect(sideObjectiveRecordText(a)).toContain('記録なし');
        expect(ieyasuPhaseIntro(a).text).not.toContain('副目標');
    });
});

function pick(d: { id: string; type: string; label: string }) {
    return { id: d.id, type: d.type, label: d.label };
}
