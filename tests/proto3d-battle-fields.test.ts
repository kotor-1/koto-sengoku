/**
 * 合戦場のデータ（proto3d/src/battle/fields/）：20 種の分類・全戦場の検査（validateField）・組み立て（buildBattleSetup）・
 * 国境の原のデータ化・演習の 20 戦場（第1群・第2群・第3群・第4群）の案が動いて決着がつくこと。
 * 検査はデータを読むだけ。合戦は「早送り」（runToEnd で一気に進める）。釣り合いの調整はここでは確かめない（戦場ごとに後で行う）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, RULES } from '../proto3d/src/battle/sim';
import { BORDER_FIELD, BORDER_FIELD_POS, IEYASU_INITIAL_TROOPS, IEYASU_POS, demoSetup, ieyasu1570Setup } from '../proto3d/src/battle/maps';
import { FIELDS, FIELD_KINDS, PRACTICE_ORDER, buildBattleSetup, fieldMap, getField, practiceFields, presetUnits, validateField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import { BORDER_FIELD_DEF } from '../proto3d/src/battle/fields/border_field';

const clone = (f: BattlefieldDef): BattlefieldDef => structuredClone(f);

describe('20 種の分類と一覧', () => {
    it('分類は 20 種で重ならない。20 種すべて（第1群 5・第2群 5・第3群 5・第4群 5。国境の原は plains）に戦場データがある', () => {
        expect(FIELD_KINDS).toHaveLength(20);
        expect(new Set(FIELD_KINDS.map((k) => k.kind)).size).toBe(20);
        const implemented = FIELD_KINDS.filter((k) => k.implemented).map((k) => k.kind).sort();
        expect(implemented).toEqual([
            'besieged_camp',
            'forest',
            'hills',
            'marsh',
            'mountain_pass',
            'multi_bridge',
            'night_raid',
            'paddy',
            'plains',
            'rearguard',
            'relief',
            'ridge',
            'river_ford',
            'shore',
            'siege_front',
            'single_bridge',
            'temple',
            'town_edge',
            'valley',
            'village',
        ]);
        for (const f of FIELDS) expect(implemented).toContain(f.kind);
        // 演習は第1群の 5 戦場の後に第2群の 5 戦場、その後に第3群の 5 戦場、その後に第4群の 5 戦場（前の群の順は変えない）
        expect(PRACTICE_ORDER).toEqual([
            'plains',
            'river_ford',
            'hills',
            'forest',
            'mountain_pass',
            'single_bridge',
            'multi_bridge',
            'ridge',
            'valley',
            'paddy',
            'marsh',
            'village',
            'temple',
            'town_edge',
            'siege_front',
            'besieged_camp',
            'relief',
            'rearguard',
            'night_raid',
            'shore',
        ]);
        expect(practiceFields().map((f) => f.id)).toEqual([...PRACTICE_ORDER]);
        expect(new Set(FIELDS.map((f) => f.id)).size).toBe(FIELDS.length);
        expect(getField('nowhere')).toBeUndefined();
    });

    it('全戦場が検査を通る（配置・退き口への道・目標の区域・援軍の地点・部隊数の上限・id の重なり）', () => {
        for (const f of FIELDS) expect([f.id, validateField(f)]).toEqual([f.id, []]);
    });

    it('各戦場のデータに、依頼の項目（地形・通行・速さ・視界・高低差・配置・援軍・撤退地点・主目標・副目標・特殊ルール）の置き場がある', () => {
        for (const f of practiceFields()) {
            expect(f.terrain.length).toBeGreaterThan(0);
            expect(f.deployments.ally.length).toBeGreaterThan(0);
            expect(f.deployments.enemy.length).toBeGreaterThan(0);
            expect(f.exits.ally).toBeDefined();
            expect(f.objectives.primary).toBeDefined();
            expect(f.objectives.secondary.length).toBeGreaterThanOrEqual(1);
            expect(f.presets.length).toBeGreaterThanOrEqual(1);
            expect(f.briefing.length).toBeGreaterThan(0);
            expect(f.tactics.length).toBeGreaterThan(0);
        }
        // 戦場ごとの性質（背景の違いだけでなく決まりが違う）
        expect(getField('river_ford')!.terrain.some((t) => t.kind === 'river')).toBe(true);
        expect(getField('river_ford')!.terrain.filter((t) => t.kind === 'ford')).toHaveLength(2);
        expect(getField('hills')!.highGround).toMatchObject({ defenseVsLower: 0.65, rangeBonus: 30 });
        expect(getField('forest')!.specialRules).toEqual([{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8 }]);
        expect(getField('forest')!.terrainRules?.woods?.kindSpeed?.kiba).toBe(0.5);
        expect(getField('mountain_pass')!.specialRules?.[0]).toMatchObject({ type: 'narrow_frontage', maxEngaged: 2 });
        expect(getField('mountain_pass')!.reinforcements?.[0]).toMatchObject({ id: 'relief', at: 180 });
        expect(getField('mountain_pass')!.objectives.primary).toMatchObject({ type: 'survive_until', reinforcementId: 'relief', holdSec: 60 });
    });

    it('演習の編成：部隊数は上限まで（味方 8・敵 10）。大平原は味方 7 部隊。武将の部隊は generalId と leaderId が同じで、表示名は「〜隊」「家康本陣」', () => {
        // 浅井長政隊（第4群の援軍救出の救出の対象）を足した 6 人
        const names: Record<string, string> = { ieyasu: '家康本陣', tadakatsu: '本多忠勝隊', sakai: '酒井忠次隊', ishikawa: '石川数正隊', sakakibara: '榊原康政隊', nagamasa: '浅井長政隊' };
        for (const f of practiceFields()) {
            for (const pr of f.presets) {
                const us = presetUnits(f, pr.id);
                expect(us.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
                expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
                for (const u of us) {
                    if (u.generalId) {
                        expect(u.leaderId).toBe(u.generalId);
                        expect(u.name).toBe(names[u.generalId]);
                    }
                    if (u.side === 'enemy') expect(u.clan).toBe('rival');
                }
                expect(us.some((u) => u.generalId === 'ieyasu' && u.kind === 'honjin')).toBe(true);
                expect(us.some((u) => u.generalId === 'tadakatsu' && u.kind === 'yari')).toBe(true);
            }
        }
        expect(presetUnits(getField('plains')!, 'standard').filter((u) => u.side === 'ally')).toHaveLength(7);
        expect(new Set(presetUnits(getField('plains')!, 'standard').map((u) => u.generalId).filter(Boolean))).toEqual(new Set(['ieyasu', 'tadakatsu', 'sakakibara', 'sakai', 'ishikawa']));
        expect(presetUnits(getField('mountain_pass')!, 'standard').filter((u) => u.side === 'enemy')).toHaveLength(10);
    });
});

describe('検査が問題を見つける（validateField）', () => {
    it('配置の枠が川の中・部隊数の上限を超える・id の重なり・目標の区域が崖の中・援軍の地点が崖の中・退き口へ道が無い', () => {
        const r = clone(getField('river_ford')!);
        r.deployments.ally.find((d) => d.id === 'left')!.z = -20;
        expect(validateField(r).some((p) => p.includes('left') && p.includes('通れる所にない'))).toBe(true);

        const p = clone(getField('plains')!);
        const pr = p.presets[0]!;
        pr.units.push({ ...pr.units[1]!, id: 'x1', slot: 'hq' }, { ...pr.units[1]!, id: 'x2', slot: 'hq' });
        const probs = validateField(p);
        expect(probs.some((t) => t.includes('ally の部隊が 9'))).toBe(true);
        expect(probs.some((t) => t.includes('枠 hq に 2 部隊'))).toBe(true);
        pr.units.push({ ...pr.units[1]! });
        expect(validateField(p).some((t) => t.includes('重なっている'))).toBe(true);

        const m = clone(getField('mountain_pass')!);
        m.objectives.secondary[0] = { id: 'g', type: 'defend_time', label: 'x', sec: 10, zone: { circle: { cx: 60, cz: 0, r: 10 } } };
        m.reinforcements![0]!.point = { x: 60, z: 0, facing: 0 };
        const mp = validateField(m);
        expect(mp.some((t) => t.includes('目標 g の区域の中心'))).toBe(true);
        expect(mp.some((t) => t.includes('援軍 relief の出現地点'))).toBe(true);

        const e = clone(getField('plains')!);
        e.terrain.push(
            { kind: 'cliff', rect: { x0: -100, x1: -40, z0: 40, z1: 50 } },
            { kind: 'cliff', rect: { x0: -100, x1: -40, z0: 80, z1: 90 } },
            { kind: 'cliff', rect: { x0: -100, x1: -90, z0: 40, z1: 90 } },
            { kind: 'cliff', rect: { x0: -50, x1: -40, z0: 40, z1: 90 } },
        );
        expect(validateField(e).some((t) => t.includes('left') && t.includes('退き口へ道がない'))).toBe(true);
    });

    it('目標の指す部隊が編成に無い・援軍の目標の援軍が無い', () => {
        const f = clone(getField('forest')!);
        f.presets[0]!.units = f.presets[0]!.units.filter((u) => u.id !== 'a_lost');
        expect(validateField(f).some((t) => t.includes('a_lost'))).toBe(true);
        const m = clone(getField('mountain_pass')!);
        m.objectives.primary = { id: 's', type: 'survive_until', label: 'x', reinforcementId: 'none' };
        expect(validateField(m).some((t) => t.includes('援軍 none'))).toBe(true);
    });

    it('崖で囲われた島の目標の区域・敵の考えの地点、陣営の違う目標の部隊、0 以下の速さ・倍率・日没、知らない武将を見つける（20 戦場へ広げるときの誤り）', () => {
        const f = clone(getField('plains')!);
        // 南東の角を崖で囲う（島）。確保の区域と、敵の assault の行き先をその中に置く
        f.terrain.push({ kind: 'cliff', rect: { x0: 120, x1: 200, z0: 80, z1: 90 } }, { kind: 'cliff', rect: { x0: 120, x1: 130, z0: 80, z1: 160 } });
        f.objectives.primary = { id: 'isle', type: 'hold_point', label: '島', zone: { circle: { cx: 165, cz: 125, r: 20 } }, sec: 30 };
        const units = f.presets[0]!.units;
        const sente = units.find((u) => u.aiRole === 'assault')!;
        sente.aiTarget = { x: 165, z: 125, r: 20 };
        // 救出の相手を敵の部隊に、崩す相手を味方の家康に
        const enemyId = units.find((u) => u.side === 'enemy')!.id;
        f.objectives.secondary = [
            { id: 'res', type: 'rescue', label: 'x', unitId: enemyId, zone: { circle: { cx: 0, cz: 120, r: 30 } } },
            { id: 'brk', type: 'break_unit', label: 'x', unitId: 'a_ieyasu' },
        ];
        f.terrainRules = { woods: { speed: 0 }, road: { speed: -1 } };
        f.highGround = { defenseVsLower: -3 };
        f.timeLimitSec = -5;
        units.find((u) => u.id === 'a_tadakatsu')!.generalId = 'nobody';
        const out = validateField(f);
        const has = (...words: string[]) => out.some((t) => words.every((w) => t.includes(w)));
        expect(has('目標 isle', '味方の退き口から道がない')).toBe(true);
        expect(has(sente.id, '敵の考えの地点', '退き口から道がない')).toBe(true);
        expect(has('目標 res', enemyId, 'ally の部隊')).toBe(true);
        expect(has('目標 brk', 'a_ieyasu', 'enemy の部隊')).toBe(true);
        expect(has('woods', 'speed')).toBe(true);
        expect(has('road', 'speed')).toBe(true);
        expect(has('defenseVsLower')).toBe(true);
        expect(has('timeLimitSec')).toBe(true);
        expect(has('a_tadakatsu', 'nobody')).toBe(true);
        // 合戦の始めにも、陣営の違う目標の部隊は断る
        expect(() => createBattle(buildBattleSetup(getField('plains')!, 'standard', { objectives: { secondary: [{ id: 'b', type: 'break_unit', label: 'x', unitId: 'a_ieyasu' }] } }))).toThrow();
        expect(() => createBattle(buildBattleSetup(getField('plains')!, 'standard', { objectives: { secondary: [{ id: 'k', type: 'preserve_unit', label: 'x', unitId: enemyId, minRatio: 0.5 }] } }))).toThrow();
    });
});

describe('組み立て（buildBattleSetup）', () => {
    it('国境の原：地図は BORDER_FIELD と同じ物。章の設定には fieldRules も objectives も付かない', () => {
        expect(fieldMap(BORDER_FIELD_DEF)).toBe(BORDER_FIELD);
        const d = demoSetup('tashiro');
        expect(d.map).toBe(BORDER_FIELD);
        expect(d.fieldRules).toBeUndefined();
        expect(d.objectives).toBeUndefined();
        expect(d.reinforcements).toBeUndefined();
        expect(d.pursuit).toBeUndefined();
        const i = ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true });
        expect(i.map).toBe(BORDER_FIELD);
        expect(i.pursuit).toBe(true);
        expect(i.fieldRules).toBeUndefined();
        expect(i.objectives).toBeUndefined();
        expect(i.pledge?.targetId).toBe('a_oda');
    });

    it('国境の原の布陣の位置は Version 11 と同じ値', () => {
        expect(BORDER_FIELD_POS.allyHq).toEqual({ x: 0, z: 110, facing: 0 });
        expect(BORDER_FIELD_POS.enemyReserve).toEqual({ x: 0, z: -138, facing: Math.PI });
        expect(IEYASU_POS.fort).toEqual({ x: -75, z: 5, facing: 0 });
        expect(IEYASU_POS.enemyLeft).toEqual({ x: -45, z: -70, facing: Math.PI });
        expect(BORDER_FIELD.terrain).toHaveLength(4);
        expect(BORDER_FIELD.exits).toEqual({ ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } });
    });

    it('演習の設定：戦場の目標・決まりが付く。目標は none・自分で渡すこともできる', () => {
        const f = getField('forest')!;
        const s = buildBattleSetup(f, 'standard');
        expect(s.objectives?.primary?.id).toBe('forest_hq');
        expect(s.objectives?.secondary?.map((o) => o.id)).toEqual(['forest_rescue']);
        expect(s.fieldRules?.specialRules).toEqual(f.specialRules);
        expect(s.timeLimitSec).toBe(f.timeLimitSec);
        expect(buildBattleSetup(f, 'standard', { objectives: 'none' }).objectives).toBeUndefined();
        const own = buildBattleSetup(f, 'standard', { objectives: { secondary: [{ id: 'x', type: 'limit_losses', label: 'x', maxRatio: 0.5 }] } });
        expect(own.objectives).toEqual({ secondary: [{ id: 'x', type: 'limit_losses', label: 'x', maxRatio: 0.5 }] });
        expect(() => buildBattleSetup(f, 'nothing')).toThrow();
    });
});

describe('演習の 20 戦場（第1群・第2群・第3群・第4群）の案が動いて、決着がつく（早送り。釣り合いは後で戦場ごとに調整する）', () => {
    for (const id of PRACTICE_ORDER) {
        it(`${id}：何もしない・全軍で近い敵へ攻めかかる、のどちらでも最後まで進み、主目標・副目標が結果に入る`, () => {
            const f = getField(id)!;
            for (const mode of ['hold', 'attack'] as const) {
                const s = createBattle(buildBattleSetup(f, 'standard'));
                const r = runToEnd(s, (st) => {
                    if (mode !== 'attack') return;
                    for (const u of st.units) {
                        if (u.side !== 'ally' || u.isHq || !isActive(u) || u.order.type === 'attack') continue;
                        const e = st.units
                            .filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally)
                            .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
                        if (e) issueOrder(st, u.id, { type: 'attack', targetId: e.id });
                    }
                });
                expect(r.elapsedSec).toBeLessThanOrEqual(f.timeLimitSec);
                expect(r.objectives?.primary?.id).toBe(f.objectives.primary.id);
                expect(r.objectives?.primary?.achieved).toBe(r.result === 'victory');
                expect(r.objectives?.secondary.map((o) => o.id)).toEqual(f.objectives.secondary.map((o) => o.id));
            }
            // 時間の上限：城攻め前面は、道の無い相手（櫓の上の弓）への攻撃が断られて日没（660 秒）まで進むようになり、1 本で 2.7 秒ほどかかる
            // （前は 408 秒に終わって 1.1 秒）。ほかの作業者のテストと重なって重い時に既定の 5 秒を超えないように。確かめの中身は同じ
        }, 30_000);
    }
});
