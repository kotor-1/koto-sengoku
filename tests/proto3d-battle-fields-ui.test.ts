/**
 * 合戦の画面の決まり（proto3d/src/battle/control.ts）のうち、データ駆動の戦場・6〜10 部隊に対応した分のテスト：
 * 選択の並び（今は 1 部隊）と、命令を並びへ出す関数・率いる武将の欄・目標の欄と結果の行・勝ち負けの条件・演習の言葉・
 * 地図の上の印（目標の区域・援軍・狭い正面・地形の名札）。
 * どれも状態を読むだけの関数（命令だけは sim.ts の issueOrder を通す）。合戦は「早送り」（runToEnd）で終える。
 */
import { describe, expect, it } from 'vitest';
import {
    CONDITIONS,
    commandableIds,
    conditionsFor,
    fieldRuleTexts,
    generalLineModel,
    leadOf,
    mapLabels,
    objectivePanelModel,
    objectiveResultModel,
    objectiveUnitMarks,
    objectiveZoneMarks,
    orderAck,
    orderUnits,
    orderUnitsText,
    pledgeResultModel,
    pruneSelection,
    refusalText,
    reinforcementMarks,
    resolveTap,
    scenarioTexts,
    selectOnly,
    selectedOf,
} from '../proto3d/src/battle/control';
import { createBattle, runToEnd, unitById } from '../proto3d/src/battle/sim';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup } from '../proto3d/src/battle/maps';
import { buildBattleSetup, getField, practiceFields } from '../proto3d/src/battle/fields';
import type { Order } from '../proto3d/src/battle/types';

const field = (id: string) => createBattle(buildBattleSetup(getField(id)!, 'standard'));

describe('選択の並び（今は 1 部隊）と命令の出し方', () => {
    it('selectOnly は 0 か 1 部隊。先頭が主に選んでいる部隊', () => {
        expect(selectOnly(null)).toEqual([]);
        expect(selectOnly('a_sakai')).toEqual(['a_sakai']);
        expect(leadOf([])).toBeNull();
        expect(leadOf(['a_sakai', 'a_yumi'])).toBe('a_sakai');
    });

    it('selectedOf は先頭の部隊で決め、resolveTap に渡せる（味方を選んで地面を押すと移動）', () => {
        const s = field('plains');
        const sel = selectedOf(s, ['a_sakai']);
        expect(sel).toEqual({ id: 'a_sakai', side: 'ally', commandable: true });
        expect(resolveTap(sel, 'none', { kind: 'ground', x: 10, z: 20 })).toEqual({ type: 'order', unitId: 'a_sakai', order: { type: 'move', x: 10, z: 20 } });
        expect(selectedOf(s, [])).toBeNull();
        expect(selectedOf(s, ['e_hq'])).toMatchObject({ side: 'enemy', commandable: false });
    });

    it('命令は並びの部隊すべてへ出す（1 部隊なら orderAck と同じ知らせ）。複数でも出せる形', () => {
        const s = field('plains');
        const o: Order = { type: 'move', x: -40, z: 30 };
        const r1 = orderUnits(s, ['a_sakai'], o);
        expect(r1).toEqual({ issued: ['a_sakai'], refused: [] });
        expect(orderUnitsText(s, o, r1)).toBe(orderAck(s, 'a_sakai', o));
        expect(unitById(s, 'a_sakai')!.order).toMatchObject({ type: 'move', x: -40, z: 30 });
        // 複数（後で複数の選択を足すときの形）：全部へ出し、知らせは「n 部隊：…」
        const hold: Order = { type: 'hold' };
        const r2 = orderUnits(s, ['a_sakai', 'a_yumi', 'a_kiba'], hold);
        expect(r2.issued).toEqual(['a_sakai', 'a_yumi', 'a_kiba']);
        expect(orderUnitsText(s, hold, r2)).toBe('3 部隊：防衛・待機');
        // 断られた部隊（敵）は refused に入り、1 部隊も出せなければ断る理由
        const r3 = orderUnits(s, ['e_hq'], hold);
        expect(r3).toEqual({ issued: [], refused: ['e_hq'] });
        expect(orderUnitsText(s, hold, r3)).toBe(refusalText(s, 'e_hq', hold));
        // 差し替えた issue で呼ばれる順
        const calls: string[] = [];
        orderUnits(s, ['a', 'b'], hold, (_s, id) => (calls.push(id), id === 'a'));
        expect(calls).toEqual(['a', 'b']);
    });

    it('commandableIds は命令を出せる味方だけ。pruneSelection は見えない敵を外し、味方は残す', () => {
        const s = field('forest');
        expect(commandableIds(s, ['a_sakai', 'e_hq'])).toEqual(['a_sakai']);
        const hidden = s.units.find((u) => u.side === 'enemy' && !u.seenBy.ally)!;
        expect(hidden).toBeDefined();
        const sel = ['a_sakai'];
        expect(pruneSelection(s, sel)).toBe(sel);
        expect(pruneSelection(s, [hidden.id])).toEqual([]);
        expect(pruneSelection(s, ['nowhere'])).toEqual([]);
    });
});

describe('率いる武将の欄', () => {
    it('武将のいる部隊：名前・役割・固有能力（新しい 3 人は仮の印）', () => {
        const s = field('plains');
        expect(generalLineModel(s, 'a_tadakatsu')).toMatchObject({ generalId: 'tadakatsu', name: '本多忠勝', roleLabel: '前線の主将', abilityName: '退路の守護', provisional: false });
        expect(generalLineModel(s, 'a_sakai')).toMatchObject({ generalId: 'sakai', name: '酒井忠次', roleLabel: '采配・軍議', provisional: true });
        expect(generalLineModel(s, 'a_ishikawa')).toMatchObject({ generalId: 'ishikawa', name: '石川数正', roleLabel: '後詰め', provisional: true });
        expect(generalLineModel(s, 'a_sakai')!.abilityName).not.toBe('');
        // 武将のいない部隊・敵勢の部隊
        expect(generalLineModel(s, 'a_yumi')).toBeNull();
        expect(generalLineModel(s, 'e_hq')).toBeNull();
    });
    it('歴史分岐の章（leaderId だけ）でも、家康・忠勝・長政の欄が出る。架空の第一章の人物は武将ではない', () => {
        const ie = createBattle(ieyasu1570Setup('asai', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true }));
        const hq = ie.units.find((u) => u.side === 'ally' && u.isHq)!;
        expect(generalLineModel(ie, hq.id)).toMatchObject({ generalId: 'ieyasu', roleLabel: '総大将' });
        const ch = createBattle(demoSetup('tashiro'));
        for (const u of ch.units) expect(generalLineModel(ch, u.id)).toBeNull();
    });
});

describe('目標の欄・勝ち負けの条件・結果の行', () => {
    it('目標のある戦場：主目標 1 行と副目標を分ける。約束の欄とは別（演習に約束は無い）', () => {
        for (const f of practiceFields()) {
            const s = createBattle(buildBattleSetup(f, 'standard'));
            const m = objectivePanelModel(s)!;
            expect(m.primary).toMatchObject({ id: f.objectives.primary.id, role: 'primary', state: 'active', tone: 'progress' });
            expect(m.secondary.map((r) => r.id)).toEqual(f.objectives.secondary.map((o) => o.id));
            expect(m.primary!.progressText.length).toBeGreaterThan(0);
            expect(s.pledge).toBeNull();
        }
    });
    it('目標の無い合戦（国境の原・歴史分岐の章）：目標の欄なし・条件は今までどおり', () => {
        const ch = createBattle(demoSetup('tashiro'));
        expect(objectivePanelModel(ch)).toBeNull();
        expect(conditionsFor(ch)).toBe(CONDITIONS);
        expect(fieldRuleTexts(ch)).toEqual([]);
        expect(mapLabels(ch).map((l) => l.id).filter((id) => id.startsWith('obj-') || id.startsWith('reinf-') || id.startsWith('narrow-'))).toEqual([]);
        const ie = createBattle(ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: false }));
        expect(objectivePanelModel(ie)).toBeNull();
        expect(conditionsFor(ie)).toBe(CONDITIONS);
    });
    it('主目標のある戦場の条件：確保・耐える戦場は「主目標を果たす」、本陣の撃破は今までの言葉', () => {
        expect(conditionsFor(field('river_ford'))[0].text).toContain('主目標「向こう岸の小高い地点を確保する」を果たす');
        expect(conditionsFor(field('river_ford'))[1].text).toContain('主目標を果たせなくなる');
        expect(conditionsFor(field('plains'))[0].text).toBe(CONDITIONS[0].text);
    });
    it('戦場の特殊ルールの短い説明（その戦場のデータにあるものだけ）', () => {
        expect(fieldRuleTexts(field('plains'))).toEqual([]);
        expect(fieldRuleTexts(field('mountain_pass')).join('|')).toMatch(/狭い正面：.*2 部隊まで.*\|崖は通れない/);
        expect(fieldRuleTexts(field('forest')).join('|')).toMatch(/林の奇襲：.*×1\.5（8 秒）.*林の中の騎馬：動き ×0\.5/);
        expect(fieldRuleTexts(field('river_ford')).join('|')).toMatch(/浅瀬：動き ×0\.4・与える損害 ×0\.8・受ける損害 ×1\.2.*深い川は渡れない/);
        // 浅瀬の矢の損害の倍率（1 でないときだけ）も同じ行に出す
        expect(fieldRuleTexts(field('river_ford'))).toContain('浅瀬：動き ×0.4・与える損害 ×0.8・受ける損害 ×1.2・矢の損害 ×2.5');
        expect(fieldRuleTexts(field('hills')).join('|')).toMatch(/高所：下から攻める相手の損害 ×0\.65・弓の射程 \+30 m・見通し \+40 m/);
    });
    it('結果：勝敗・主目標・副目標・約束は別々（演習は約束の欄なし。主目標の達成は勝敗と同じ）', () => {
        const s = field('plains');
        const o = runToEnd(s);
        const r = objectiveResultModel(o)!;
        expect(r.primary).toEqual({ label: '敵勢の本陣を崩す', achieved: o.result === 'victory' });
        expect(r.secondary).toHaveLength(1);
        expect(r.secondary[0].label).toContain('石川数正隊');
        expect(pledgeResultModel(s, o)).toBeNull();
        // 目標の無い合戦は結果の行なし
        const ch = createBattle(demoSetup('tashiro'));
        expect(objectiveResultModel(runToEnd(ch))).toBeNull();
    });
});

describe('演習の言葉（敵が架空の「敵勢」）', () => {
    it('演習は「ゲーム用の演習（架空の相手）」。歴史分岐・架空の第一章の言葉を使わない', () => {
        for (const f of practiceFields()) {
            const s = createBattle(buildBattleSetup(f, 'standard'));
            const t = scenarioTexts(s);
            expect(t.practice).toBe(true);
            expect(t.historical).toBe(false);
            expect(t.titleNote).toBe('ゲーム用の演習（架空の相手）');
            const all = [...Object.values(t.reasons), ...Object.values(t.notes)].join('');
            expect(all).not.toMatch(/若殿|鷲尾|姉川|1570/);
            expect(t.reasons.objective_done).toContain(f.objectives.primary.label);
        }
        expect(scenarioTexts(createBattle(demoSetup('tashiro'))).practice).toBe(false);
        expect(scenarioTexts(createBattle(ieyasu1570Setup('home', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: false }))).practice).toBe(false);
    });
});

describe('地図の上の印', () => {
    it('目標の区域：確保・守る・救出の地点（区域を持つ目標だけ）', () => {
        expect(objectiveZoneMarks(field('plains'))).toEqual([]);
        expect(objectiveZoneMarks(field('river_ford')).map((m) => [m.role, m.name])).toEqual([['primary', '確保する地点']]);
        expect(objectiveZoneMarks(field('hills')).map((m) => [m.role, m.name])).toEqual([['primary', '確保する地点']]);
        expect(objectiveZoneMarks(field('forest')).map((m) => [m.role, m.name])).toEqual([['secondary', '救出の地点']]);
        expect(objectiveZoneMarks(field('mountain_pass')).map((m) => [m.role, m.name])).toEqual([['secondary', '守る地点']]);
    });
    it('援軍の出る所（峠：南 (0,195)、180 秒）。目標の指す部隊の印（救出・守る・崩す）', () => {
        expect(reinforcementMarks(field('mountain_pass'))).toEqual([{ id: 'relief', side: 'ally', x: 0, z: 195, at: 180 }]);
        expect(reinforcementMarks(field('plains'))).toEqual([]);
        expect(objectiveUnitMarks(field('forest')).get('a_lost')).toBe('救出');
        expect(objectiveUnitMarks(field('plains')).get('a_ishikawa')).toBe('守る');
        expect(objectiveUnitMarks(field('hills')).get('e_yumi')).toBe('崩す');
    });
    it('名札：川・浅瀬・崖・目標・援軍・狭い正面。名札は戦場の中にあり、川の名札は浅瀬と重ならない', () => {
        for (const f of practiceFields()) {
            const s = createBattle(buildBattleSetup(f, 'standard'));
            for (const l of mapLabels(s)) {
                expect([f.id, l.id, Math.abs(l.x) <= f.width / 2 + 1 && Math.abs(l.z) <= f.depth / 2 + 1]).toEqual([f.id, l.id, true]);
            }
        }
        const rf = mapLabels(field('river_ford'));
        const river = rf.find((l) => l.text.startsWith('深い川'))!;
        expect(river).toBeDefined();
        expect(Math.abs(river.x)).toBeGreaterThan(18 + 30);
        expect(rf.filter((l) => l.text.startsWith('浅瀬'))).toHaveLength(2);
        expect(rf.some((l) => l.text === '主目標：確保する地点')).toBe(true);
        const mp = mapLabels(field('mountain_pass'));
        expect(mp.filter((l) => l.text.startsWith('崖'))).toHaveLength(2);
        expect(mp.some((l) => l.text.startsWith('援軍の出る所'))).toBe(true);
        expect(mp.some((l) => l.text === '狭い正面（2 部隊まで）')).toBe(true);
    });
});
