/**
 * 第4群（docs/fields-group4-design.md §3〜§5）：目標 3 種（escape・rescue_escort・withdraw）・終わり方の判定の順（endRules）・
 * 演習の追い討ち（pursuit）・夜（視界と発見）・水辺・部隊数の検査と、5 戦場（包囲された陣・援軍救出・退却戦・夜襲・奇襲・湖・河岸）の最初の案。
 *
 * 確かめの種類（報告で分ける）：
 * - 「早送り」：runToEnd・stepBattle で合戦を進め、命令は台本（issueOrder）で出す。
 * - 「状態を直接操作」：部隊の位置・状態・目標の状態を書き換えてから進める（その旨を it の名前に書く）。
 * 釣り合いの比べ（作戦ごとの勝ち負け・損害）は後の担当。ここでは仕組みが決まりどおりに動くこと、5 戦場が動いて決着がつくことを見る。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, isActive, orderAllRetreat, runToEnd, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { FIELDS, buildBattleSetup, getField, validateField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import { conditionsFor, fieldRuleTexts, mapLabels, objectiveUnitMarks, objectiveZoneMarks, reinforcementMarks } from '../proto3d/src/battle/control';
import { DEFAULT_END_ORDER, endRuleBriefingLine, endRuleItems, objectiveProgress, withdrawalNote } from '../proto3d/src/battle/objectives';
import { nightLabels } from '../proto3d/src/battle/night';
import { demoSetup, ieyasu1570Setup, IEYASU_INITIAL_TROOPS } from '../proto3d/src/battle/maps';
import { parsePracticeData, practiceBriefingInfo, practiceResultInfo, recordFromOutcome } from '../proto3d/src/campaign/practice';
import { useAbility } from '../proto3d/src/battle/abilities';

const G4 = ['besieged_camp', 'relief', 'rearguard', 'night_raid', 'shore'];
const clone = (f: BattlefieldDef): BattlefieldDef => structuredClone(f);
const field = (id: string) => getField(id)!;
const battle = (id: string, f?: BattlefieldDef) => createBattle(buildBattleSetup(f ?? field(id), 'standard'));
const U = (s: BattleState, id: string) => unitById(s, id)!;
/** 部隊を (x, z) へ置く（状態を直接操作） */
function place(s: BattleState, id: string, x: number, z: number): void {
    const u = U(s, id);
    u.x = x;
    u.z = z;
    u.path = null;
}
/** 敵をすべて遠く（北の端）へ退けて、動かさない（状態を直接操作：目標の数え方だけを見るため） */
function freezeEnemies(s: BattleState): void {
    for (const u of s.units) if (u.side === 'enemy') u.present = false;
}
function step(s: BattleState, sec: number): void {
    for (let i = 0; i < Math.round(sec / RULES.tick); i++) stepBattle(s, RULES.tick);
}

describe('第4群の 5 戦場のデータ', () => {
    it('20 戦場すべてが検査を通る。第4群の 5 戦場は終わり方の判定の順を持ち、主目標はどれも敵本陣の撃破ではない', () => {
        for (const f of FIELDS) expect([f.id, validateField(f)]).toEqual([f.id, []]);
        for (const id of G4) {
            const f = field(id);
            expect(f.endRules?.order).toEqual([...DEFAULT_END_ORDER]);
            expect(f.objectives.primary.type).not.toBe('destroy_hq');
            expect(f.generalInitiative).toBe(true);
            expect(f.presets.map((p) => p.id)).toContain('standard');
        }
        expect(field('besieged_camp').objectives.primary.type).toBe('escape');
        expect(field('relief').objectives.primary.type).toBe('rescue_escort');
        expect(field('rearguard').objectives.primary.type).toBe('withdraw');
        expect(field('night_raid').objectives.primary.type).toBe('hold_point');
        expect(field('shore').objectives.primary.type).toBe('defend_zones');
        expect(field('night_raid').night).toBeDefined();
        expect(field('rearguard').pursuit).toBe(true);
        expect(field('besieged_camp').pursuit).toBe(true);
        // 湖・河岸：一方の端の水面（river）・岸沿いの狭い道（崖と水面の間）・内陸の高地
        const sh = field('shore');
        expect(sh.terrain.some((a) => a.kind === 'river' && a.rect && a.rect.x1 >= sh.width / 2)).toBe(true);
        expect(sh.terrain.some((a) => a.kind === 'cliff')).toBe(true);
        expect(sh.terrain.some((a) => a.kind === 'hill')).toBe(true);
    });

    it('既存の 15 戦場・国境の原・歴史分岐・架空の章は、終わり方の判定の順・夜を持たない（今までの判定のまま）。追い討ちは歴史分岐だけ', () => {
        for (const f of FIELDS.filter((x) => !G4.includes(x.id))) {
            expect([f.id, f.endRules, f.night, f.pursuit]).toEqual([f.id, undefined, undefined, undefined]);
            const s = buildBattleSetup(f, f.presets[0]!.id);
            expect([f.id, s.endRules, s.night, s.pursuit]).toEqual([f.id, undefined, undefined, undefined]);
        }
        const d = demoSetup('tashiro');
        expect([d.endRules, d.night, d.pursuit]).toEqual([undefined, undefined, undefined]);
        const i = ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true });
        expect([i.endRules, i.night, i.pursuit]).toEqual([undefined, undefined, true]);
    });

    it('部隊数の検査：救出の対象・増援（援軍）も同時に戦場にいる部隊の数に入れる（援軍救出は味方 7＋救出の対象 1＝上限 8。1 つ足すと知らせる）', () => {
        const f = clone(field('relief'));
        const pr = f.presets[0]!;
        expect(pr.units.filter((u) => u.side === 'ally')).toHaveLength(8);
        expect(pr.units.filter((u) => u.side === 'enemy')).toHaveLength(9);
        expect(pr.units.some((u) => u.side === 'enemy' && u.reinforcement)).toBe(true);
        pr.units.push({ ...pr.units.find((u) => u.id === 'a_kiba')!, id: 'a_extra', slot: undefined, reinforcement: undefined, arriveAt: 200 });
        // 置き場所の無い部隊の知らせとは別に、部隊の数の知らせが出る
        expect(validateField(f).some((t) => t.includes('ally の部隊が 9'))).toBe(true);
        const g = clone(field('relief'));
        g.presets[0]!.units.push({ ...g.presets[0]!.units.find((u) => u.id === 'e_late')!, id: 'e_late2' });
        g.presets[0]!.units.push({ ...g.presets[0]!.units.find((u) => u.id === 'e_late')!, id: 'e_late3' });
        expect(validateField(g).some((t) => t.includes('enemy の部隊が 11'))).toBe(true);
    });

    it('第4群の検査が誤りを見つける：味方の退き口が出口の外・出口が縁に届かない・count が多すぎる・合流と安全地点が重なる・夜の距離・判定の順', () => {
        const b = clone(field('besieged_camp'));
        b.exits.ally = { x: 0, z: 180 };
        const pb = b.objectives.primary as Extract<BattlefieldDef['objectives']['primary'], { type: 'escape' }>;
        pb.count = 7;
        pb.exits.push({ circle: { cx: 0, cz: 150, r: 20 } });
        const ob = validateField(b);
        expect(ob.some((t) => t.includes('味方の退き口が出口の区域の中にない'))).toBe(true);
        expect(ob.some((t) => t.includes('count 7'))).toBe(true);
        expect(ob.some((t) => t.includes('出口 3 が戦場の縁に届いていない'))).toBe(true);
        const r = clone(field('relief'));
        const pr = r.objectives.primary as Extract<BattlefieldDef['objectives']['primary'], { type: 'rescue_escort' }>;
        pr.safeZone = { circle: { cx: 60, cz: -130, r: 40 } };
        expect(validateField(r).some((t) => t.includes('合流区域と安全区域が重なっている'))).toBe(true);
        const n = clone(field('night_raid'));
        n.night!.detectRange = 20;
        n.night!.lookouts = [{ unitId: 'e_nobody', range: 100 }];
        n.endRules = { order: ['objective_done', 'nightfall'], allRetreat: 'count' };
        const on = validateField(n);
        expect(on.some((t) => t.includes('detectRange'))).toBe(true);
        expect(on.some((t) => t.includes('e_nobody'))).toBe(true);
        expect(on.some((t) => t.includes('ちょうど 1 回ずつ'))).toBe(true);
        expect(on.some((t) => t.includes("allRetreat 'count'"))).toBe(true);
    });

    it('合戦の前の説明・画面の条件に、判定の順を出す（主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊 → 日没 → 全軍撤退）', () => {
        const s = battle('besieged_camp');
        const line = endRuleBriefingLine(s.setup)!;
        expect(s.setup.briefing[s.setup.briefing.length - 1]).toBe(line);
        expect(line).toContain('① 主目標「総大将と 3 部隊が包囲の外へ脱出する」を果たす → 勝利');
        expect(line).toContain('総大将が出口から離れるのは脱出で、本陣の喪失ではない');
        const items = endRuleItems(s.setup);
        expect(items).toHaveLength(6);
        expect(items[5]).toContain('退き口から離れた部隊も主目標に数え');
        expect(endRuleItems(battle('shore').setup)[5]).toContain('合戦の放棄');
        const cond = conditionsFor(s);
        expect(cond.map((c) => c.label)).toEqual(['勝利', '敗北', '撤退', '判定の順']);
        expect(cond[3]!.text).toBe('主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊が戦えない → 日没 → 全軍撤退');
        // 演習の説明の画面にも
        const info = practiceBriefingInfo(field('relief'));
        expect(info.endRules).toHaveLength(6);
        expect(info.endRules[1]).toContain('兵が 40％ を切る');
        expect(practiceBriefingInfo(field('plains')).endRules).toEqual([]);
        // 救出の条件（生存と最低兵力）は出陣前の説明と目標の見出しに出る
        expect(info.primary).toContain('兵 4 割以上');
        expect(info.terrain.join('')).toContain('4 割以上');
    });
});

describe('脱出（escape）：総大将が出口から離れても負けにならない', () => {
    it('状態を直接操作（敵を退けて数え方だけを見る）＋早送り：総大将だけが出口へ入ると、総大将は戦場を離れ（撤退済み）、合戦は続く（本陣の喪失・敗北にしない）。3 部隊が続いて出ると勝利（目標を果たした撤収）', () => {
        const s = battle('besieged_camp');
        freezeEnemies(s);
        place(s, 'a_ieyasu', 0, 205);
        step(s, 1);
        expect(U(s, 'a_ieyasu').status).toBe('withdrawn');
        expect(s.result).toBeNull();
        expect(s.objectives!.primary!.state).toBe('active');
        expect(objectiveProgress(s)[0]!.progressText).toContain('総大将 済み・ほか 0／3 部隊が脱出');
        // 撤退の命令で退き口（南の突破口の出口の中）から離れた部隊も数える
        for (const id of ['a_yumi', 'a_kiba']) place(s, id, 0, 190);
        issueOrder(s, 'a_yumi', { type: 'retreat' });
        issueOrder(s, 'a_kiba', { type: 'move', x: 0, z: 212 });
        step(s, 8);
        expect(s.result).toBeNull();
        place(s, 'a_sakai', 190, 210);
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.withdrawal).toBe('objective');
        expect(r.objectives?.primary).toMatchObject({ type: 'escape', achieved: true, count: { done: 4, total: 4 } });
        expect(withdrawalNote(r)).toContain('目標を果たした撤収');
        expect(s.events.some((e) => e.text.includes('家康本陣が南の突破口の出口から脱出した'))).toBe(true);
    });

    it('状態を直接操作：総大将が崩れれば負け（主目標の失敗が先に当てはまる）。脱出できる部隊が足りなくなっても負け', () => {
        const s = battle('besieged_camp');
        freezeEnemies(s);
        U(s, 'a_ieyasu').morale = 0;
        step(s, 0.2);
        expect(s.result?.result).toBe('defeat');
        expect(s.result?.reason).toBe('objective_failed');
        const t = battle('besieged_camp');
        freezeEnemies(t);
        for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_yumi']) U(t, id).morale = 0;
        step(t, 0.2);
        expect(t.result?.reason).toBe('objective_failed');
        expect(t.result?.objectives?.primary?.count).toEqual({ done: 0, total: 4 });
    });

    // 包囲された陣の調整（後の担当。tests/proto3d-field-besieged_camp.test.ts）で、東の道の北に騎馬・東の抜け道の狭まり・200 秒の後詰めの騎馬を足した。
    // 前の台本（0 秒に家康を道の (150,0) へ出し、東の守りが崩れたら全部隊で出口へ）は、前は約 141 秒に勝ち。調整の後は、道で待つ家康が
    // 後詰めの騎馬に捕まって 273.8 秒に負け（主目標の失敗）＝総大将を先に出した形。ここは「東を開いてから総大将を出す」台本に置き換えた
    // （数え方を見るのが目的。作戦の比べは戦場のテスト）
    it('早送り：東の回り道で脱出する台本（東を開いてから総大将を出す）は、主目標を果たして勝つ（総大将の脱出の後も合戦が続き、負けにならない）', () => {
        const s = battle('besieged_camp');
        const done = new Set<string>();
        const once = (key: string, cond: boolean, f: () => void) => {
            if (cond && !done.has(key)) {
                done.add(key);
                f();
            }
        };
        const near = (st: BattleState, id: string, x: number, z: number, r: number) => isActive(U(st, id)) && Math.hypot(U(st, id).x - x, U(st, id).z - z) <= r;
        const r = runToEnd(s, (st) => {
            once('open', true, () => {
                issueOrder(st, 'a_sakakibara', { type: 'move', x: 190, z: 60 });
                issueOrder(st, 'a_kiba', { type: 'move', x: 175, z: 40 });
            });
            once('atk', near(st, 'a_sakakibara', 190, 60, 12), () => {
                for (const id of ['a_sakakibara', 'a_kiba']) issueOrder(st, id, { type: 'attack', targetId: 'e_east' });
            });
            const opened = !isActive(U(st, 'e_east'));
            once('out1', opened, () => {
                for (const id of ['a_sakakibara', 'a_kiba']) issueOrder(st, id, { type: 'retreat' });
            });
            once('go', opened && !isActive(U(st, 'e_west_kiba')), () => {
                for (const id of ['a_ieyasu', 'a_yumi', 'a_ishikawa']) issueOrder(st, id, { type: 'retreat' });
                issueOrder(st, 'a_tadakatsu', { type: 'move', x: 110, z: 0 });
            });
            once('guard', near(st, 'a_tadakatsu', 110, 0, 12), () => expect(useAbility(st, 'a_tadakatsu').ok).toBe(true));
            once('last', near(st, 'a_ieyasu', 150, 0, 15), () => issueOrder(st, 'a_sakai', { type: 'retreat' }));
        });
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.withdrawal).toBe('objective');
        const hqOut = s.events.find((e) => e.text.startsWith('家康本陣が東の回り道の出口から脱出した'))!;
        expect(hqOut).toBeDefined();
        expect(hqOut.t).toBeLessThan(r.elapsedSec);
        expect(s.events.some((e) => e.kind === 'rout' && e.text.includes('家康本陣'))).toBe(false);
    }, 20_000);
});

describe('救出（rescue_escort）：接触だけ・能力だけでは救出にならない', () => {
    it('状態を直接操作：合流の前に長政隊を安全地点へ置いても果たさない。一瞬触れただけ（5 秒に満たない）でも合流にならない', () => {
        const s = battle('relief');
        freezeEnemies(s);
        place(s, 'a_nagamasa', 0, 175);
        step(s, 3);
        expect(s.objectives!.primary!.state).toBe('active');
        expect(s.objectives!.primary!.metT).toBeNull();
        expect(s.result).toBeNull();
        // 合流の輪で 3 秒だけ一緒にいて離れる
        place(s, 'a_nagamasa', 60, -150);
        place(s, 'a_kiba', 70, -150);
        step(s, 3);
        // 合流の輪（半径 50 m）のすぐ外（55 m）へ離す
        place(s, 'a_kiba', 60, -95);
        step(s, 3);
        expect(s.objectives!.primary!.metT).toBeNull();
        // 能力（盟友への援護。範囲 60 m の味方を支える）を使っただけでも合流にならない
        const used = useAbility(s, 'a_nagamasa', 'a_kiba');
        expect(used.ok).toBe(true);
        step(s, 6);
        expect(s.objectives!.primary!.metT).toBeNull();
        expect(s.objectives!.primary!.state).toBe('active');
        expect(objectiveProgress(s)[0]!.progressText).toContain('合流 0／5 秒');
    });

    it('状態を直接操作＋早送り：合流の輪に 5 秒一緒にいて合流 → 安全地点の輪へ入ると果たす（勝利）。結果に合流したことも残る', () => {
        const s = battle('relief');
        freezeEnemies(s);
        place(s, 'a_kiba', 65, -140);
        step(s, 5.5);
        expect(s.objectives!.primary!.metT).not.toBeNull();
        expect(s.result).toBeNull();
        place(s, 'a_nagamasa', 0, 175);
        step(s, 0.5);
        expect(s.result?.result).toBe('victory');
        expect(s.result?.objectives?.primary).toMatchObject({ type: 'rescue_escort', achieved: true, met: true });
        expect(s.result?.withdrawal).toBeUndefined();
    });

    it('状態を直接操作：救出の対象が崩れる・兵が 4 割を切る・撤退すると負け（主目標の失敗）', () => {
        const a = battle('relief');
        freezeEnemies(a);
        U(a, 'a_nagamasa').morale = 0;
        step(a, 0.2);
        expect(a.result?.reason).toBe('objective_failed');
        const b = battle('relief');
        freezeEnemies(b);
        U(b, 'a_nagamasa').strength = U(b, 'a_nagamasa').startStrength * 0.39;
        step(b, 0.2);
        expect(b.result?.reason).toBe('objective_failed');
        const c = battle('relief');
        freezeEnemies(c);
        place(c, 'a_nagamasa', 0, 233);
        issueOrder(c, 'a_nagamasa', { type: 'retreat' });
        step(c, 3);
        expect(c.result?.reason).toBe('objective_failed');
        expect(c.result?.objectives?.primary?.met).toBe(false);
    });

    it('早送り：急いで直接救う台本は、合流して長政隊を安全地点まで連れ帰り、勝つ', () => {
        const s = battle('relief');
        const r = runToEnd(s, (st) => {
            const mv = (id: string, x: number, z: number) => {
                const u = U(st, id);
                if (u.status === 'ready' && !(u.order.type === 'move' && Math.abs(u.order.x - x) < 1 && Math.abs(u.order.z - z) < 1)) issueOrder(st, id, { type: 'move', x, z });
            };
            const atk = (id: string, t: string) => {
                const u = U(st, id);
                const e = U(st, t);
                if (u.status !== 'ready' || !isActive(e) || !e.seenBy.ally) return false;
                if (u.order.type === 'attack' && u.order.targetId === t) return true;
                return issueOrder(st, id, { type: 'attack', targetId: t });
            };
            if (st.tick === 1) {
                mv('a_yumi', -10, 70);
                mv('a_sakakibara', 150, -90);
                mv('a_kiba', 150, -70);
                mv('a_sakai', 60, -40);
            }
            atk('a_tadakatsu', 'e_block');
            atk('a_ishikawa', 'e_block');
            const met = st.objectives!.primary!.metT !== null;
            if (st.t > 30 && !met) {
                if (!atk('a_sakakibara', 'e_attack')) mv('a_sakakibara', 70, -160);
                if (!atk('a_kiba', 'e_attack')) mv('a_kiba', 50, -140);
            }
            if (met) {
                mv('a_nagamasa', 0, 175);
                mv('a_sakakibara', 10, 160);
                mv('a_kiba', -10, 160);
            }
        });
        expect(r.result).toBe('victory');
        expect(r.objectives?.primary).toMatchObject({ achieved: true, met: true });
        const metAt = s.events.find((e) => e.text.includes('と合流した'))!.t;
        expect(metAt).toBeLessThan(r.elapsedSec);
    }, 20_000);
});

describe('離脱（withdraw）と全軍撤退：目標の前に打ち切らない・撤収と放棄を分ける', () => {
    it('早送り：退却戦で始めに全軍撤退を命じると、命令から 20 秒（今までの打ち切り）を過ぎても合戦は続き、退き口から離れた部隊を数えて主目標を果たす（勝利の撤収）', () => {
        const s = battle('rearguard');
        orderAllRetreat(s);
        step(s, RULES.retreatGraceSec + 1);
        expect(s.result).toBeNull();
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.withdrawal).toBe('objective');
        expect(r.objectives?.primary).toMatchObject({ type: 'withdraw', achieved: true, count: { done: 5, total: 5 } });
        expect(s.events.filter((e) => e.text.includes('南の退き口から離脱した')).length).toBeGreaterThanOrEqual(5);
    }, 20_000);

    it('状態を直接操作：退却戦で全軍撤退の途中に部隊が崩れて要る数に届かなくなれば、主目標の失敗（敗北）。退き口から離れた部隊はそれまで数えている', () => {
        const s = battle('rearguard');
        freezeEnemies(s);
        place(s, 'a_kiba', 0, 195);
        orderAllRetreat(s);
        step(s, 2);
        expect(s.objectives!.primary!.entered).toContain('a_kiba');
        expect(s.result).toBeNull();
        for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa']) U(s, id).morale = 0;
        step(s, 0.2);
        expect([s.result?.result, s.result?.reason]).toEqual(['defeat', 'objective_failed']);
        expect(s.result?.withdrawal).toBeUndefined();
    });

    it('状態を直接操作：主目標が脱出・離脱でない戦場で、本陣が退き口から退いたら合戦の放棄（撤退）として記録し、目標を果たした撤収と分ける', () => {
        // 本陣が退き口でない所から退いた（主目標に数えない）：放棄（撤退）
        const h = battle('relief');
        freezeEnemies(h);
        place(h, 'a_ieyasu', 0, 233);
        issueOrder(h, 'a_ieyasu', { type: 'retreat' });
        step(h, 3);
        expect(h.result?.result).toBe('retreat');
        expect(h.result?.reason).toBe('ordered_retreat');
        expect(h.result?.withdrawal).toBe('abandoned');
        expect(withdrawalNote(h.result!)).toContain('合戦の放棄');
    });

    it('早送り：退却戦（allRetreat count）でない戦場では、全軍撤退は今までどおり 20 秒で打ち切り、合戦の放棄として記録する', () => {
        const s = battle('shore');
        orderAllRetreat(s);
        const r = runToEnd(s);
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('ordered_retreat');
        expect(r.elapsedSec).toBeLessThanOrEqual(RULES.retreatGraceSec + 0.2);
        expect(r.withdrawal).toBe('abandoned');
    });
});

describe('判定の順（endRules）はデータのとおり', () => {
    it('状態を直接操作：同じ刻みに「主目標の達成」と「本陣の崩れ」が当てはまるとき、順が主目標の達成 → 本陣の崩れなら勝利、本陣の崩れ → 主目標の達成なら敗北', () => {
        const run = (order: NonNullable<BattlefieldDef['endRules']>['order']) => {
            const f = clone(field('besieged_camp'));
            f.endRules = { order, allRetreat: 'count' };
            const s = createBattle(buildBattleSetup(f, 'standard'));
            freezeEnemies(s);
            // 本陣とほか 3 部隊が出口から離れた（目標の達成）のと同じ刻みに、残りの…ではなく本陣の崩れを重ねるため、
            // 目標の状態を「果たした」に書き換え、本陣を敗走にする
            const P = s.objectives!.primary!;
            P.state = 'done';
            U(s, 'a_ieyasu').status = 'routed';
            step(s, 0.1);
            return s.result!;
        };
        expect(run(['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat']).result).toBe('victory');
        const r = run(['hq_lost', 'objective_done', 'objective_failed', 'army_broken', 'nightfall', 'all_retreat']);
        expect([r.result, r.reason]).toEqual(['defeat', 'ally_hq_routed']);
    });

    it('早送り：日没は撤退（主目標は未達成で、どこまで届いたかを記録）。敵がすべて崩れても、主目標を自分で果たすまでは勝ちにしない', () => {
        const s = battle('besieged_camp');
        const r = runToEnd(s);
        expect([r.result, r.reason]).toEqual(['retreat', 'nightfall']);
        expect(r.objectives?.primary).toMatchObject({ achieved: false, count: { done: 0, total: 4 } });
        const t = battle('night_raid');
        for (const u of t.units) if (u.side === 'enemy') u.morale = 0;
        step(t, 1);
        expect(t.result).toBeNull();
        expect(t.events.some((e) => e.text.includes('敵の部隊はすべて崩れた'))).toBe(true);
    });
});

describe('演習の追い討ち（pursuit をデータで）', () => {
    it('早送り：退却戦で撤退の命令で退く部隊に、敵が追い討ちをかける。退路の守護を使うと、追っ手が忠勝隊に阻まれる', () => {
        const s = battle('rearguard');
        expect(s.setup.pursuit).toBe(true);
        issueOrder(s, 'a_ishikawa', { type: 'retreat' });
        issueOrder(s, 'a_sakai', { type: 'retreat' });
        step(s, 60);
        expect(s.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ち'))).toBe(true);
        const t = battle('rearguard');
        for (const id of ['a_ishikawa', 'a_sakai', 'a_yumi']) issueOrder(t, id, { type: 'retreat' });
        // 退却戦の調整（tests/proto3d-field-rearguard.test.ts）で、追っ手は北 150 m の騎馬になった。前は 6 秒に守護を使って 50 秒のうちに
        // 「阻む」が出たが、今は 6 秒だと騎馬がまだ原の味方に着かず、先に殿の忠勝隊へ当たるので、追い討ちが始まってから守護を使う
        // （人が「追い討ち」の知らせを見てから押すのと同じ。今の版は 17 秒に追い討ち、18 秒に守護、すぐ「阻む」）
        for (let i = 0; i < 60 && !t.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ちをかける')); i++) step(t, 1);
        expect(t.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ちをかける'))).toBe(true);
        expect(useAbility(t, 'a_tadakatsu').ok).toBe(true);
        step(t, 50);
        expect(t.events.some((e) => e.kind === 'ai' && (e.text.includes('が阻む') || e.text.includes('引きつけられた')))).toBe(true);
        expect(fieldRuleTexts(t).some((x) => x.startsWith('追い討ち'))).toBe(true);
        // 既存の演習の戦場は追い討ちの決まりの文を出さない
        expect(fieldRuleTexts(battle('plains')).some((x) => x.startsWith('追い討ち'))).toBe(false);
    });
});

describe('夜（視界と発見）', () => {
    it('状態を直接操作：始めは、篝火の外の遠い敵は味方に見えず、敵からも味方は見えない。発見していない相手は攻撃の命令の相手にならない', () => {
        const s = battle('night_raid');
        const hidden = s.units.filter((u) => u.side === 'enemy' && !u.seenBy.ally).map((u) => u.id);
        expect(hidden).toEqual(expect.arrayContaining(['e_hq', 'e_camp', 'e_camp_yumi', 'e_reserve', 'e_watch', 'e_patrol']));
        expect(s.units.filter((u) => u.side === 'ally').every((u) => !u.seenBy.enemy)).toBe(true);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_camp' })).toBe(false);
        // 篝火の外の見回りの騎馬（80,-50）：90 m では見つけず、70 m まで近づくと見つける。見つけた後は攻撃できる
        // （夜襲の調整で見回りの騎馬を (130,-40) から物見の東 (80,-50) へ移した。置く所も同じ 90 m・65 m のまま騎馬の真南へ移した）
        expect(issueOrder(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_patrol' })).toBe(false);
        place(s, 'a_tadakatsu', 80, 40);
        step(s, 0.2);
        expect(U(s, 'e_patrol').seenBy.ally).toBe(false);
        place(s, 'a_tadakatsu', 80, 15);
        step(s, 0.2);
        expect(U(s, 'e_patrol').seenBy.ally).toBe(true);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_patrol' })).toBe(true);
        // 陣の中（篝火）の敵は、160 m から見つかる
        place(s, 'a_kiba', 0, 30);
        step(s, 0.2);
        expect(U(s, 'e_camp').seenBy.ally).toBe(true);
        expect(s.events.some((e) => e.kind === 'spotted' && e.text.includes('暗がりに'))).toBe(true);
    });

    it('状態を直接操作：見つけた相手は sight（120 m）の中なら見え続け、離れると見失う。篝火の中は 160 m から見つかる。物見は 110 m 先まで見つける', () => {
        const s = battle('night_raid');
        freezeEnemies(s);
        const camp = U(s, 'e_camp');
        camp.present = true;
        place(s, 'a_kiba', 60, -120);
        step(s, 0.2);
        expect(camp.seenBy.ally).toBe(true);
        place(s, 'a_kiba', 110, -120);
        step(s, 0.2);
        expect(camp.seenBy.ally).toBe(true);
        place(s, 'a_kiba', 160, -120);
        step(s, 0.2);
        expect(camp.seenBy.ally).toBe(false);
        // 篝火（陣の中）にいる味方は、160 m 先の敵から見つかる
        const t = battle('night_raid');
        place(t, 'a_kiba', 0, -110);
        for (const u of t.units) if (u.side === 'enemy' && u.id !== 'e_hq') u.present = false;
        place(t, 'e_hq', 0, -110 - 150);
        step(t, 0.1);
        expect(U(t, 'a_kiba').seenBy.enemy).toBe(true);
        // 物見：110 m 先まで味方を見つける（ほかの敵は 70 m まで）。夜襲の調整で物見を街道の東の丘 (40,-30)・110 m にした
        // （前は街道の真ん中 (0,-40)・150 m で、西の林の端から陣の西の口まで見えていた）。置く所は物見から 105 m（前は 140 m）
        const w = battle('night_raid');
        for (const u of w.units) if (u.side === 'enemy' && u.id !== 'e_watch') u.present = false;
        place(w, 'a_kiba', 145, -30);
        step(w, 0.1);
        expect(U(w, 'a_kiba').seenBy.enemy).toBe(true);
    });

    it('早送り：敵の考えも、発見していない味方は狙わない・追わない（物見の外で待つ味方には打って出ない。見つけた後は当たる）', () => {
        const s = battle('night_raid');
        // 番兵（hold_line・持ち場 (0,25) から 75 m の相手に打って出る）から 72 m（打って出る距離の中、夜に見つける 70 m の外）、篝火の外に味方を置く。
        // 物見（110 m 先まで見つける）は外す
        for (const u of s.units) if (u.side === 'ally' && u.id !== 'a_kiba') u.present = false;
        U(s, 'e_watch').present = false;
        place(s, 'a_kiba', 50, 77);
        step(s, 10);
        expect(U(s, 'a_kiba').seenBy.enemy).toBe(false);
        expect(U(s, 'e_picket').order.type).not.toBe('attack');
        place(s, 'a_kiba', 40, 70);
        step(s, 3);
        expect(U(s, 'a_kiba').seenBy.enemy).toBe(true);
        expect(U(s, 'e_picket').order).toMatchObject({ type: 'attack', targetId: 'a_kiba' });
    });

    it('画面向けの印：夜は敵の援軍の出る所を地図に出さない。篝火の名札・決まりの文がある。昼の戦場は今までどおり', () => {
        const s = battle('night_raid');
        expect(nightLabels(s.setup).map((l) => l.text)).toEqual(['辻の篝火（中は見つかりやすい）', '陣の篝火（中は見つかりやすい）']);
        expect(fieldRuleTexts(s).some((x) => x.startsWith('夜：'))).toBe(true);
        expect(fieldRuleTexts(s).some((x) => x.startsWith('篝火：'))).toBe(true);
        // 夜の敵の援軍の印は出さない（データで試す：援軍救出の敵の援軍を夜にする）
        const f = clone(field('relief'));
        f.night = { sight: 120, detectRange: 70 };
        const n = createBattle(buildBattleSetup(f, 'standard'));
        expect(reinforcementMarks(n).filter((m) => m.side === 'enemy')).toEqual([]);
        expect(reinforcementMarks(battle('relief')).filter((m) => m.side === 'enemy')).toHaveLength(1);
        expect(nightLabels(battle('plains').setup)).toEqual([]);
        expect(fieldRuleTexts(battle('forest')).some((x) => x.startsWith('夜'))).toBe(false);
    });

    it('早送り：夜襲は、何もしなければ日没（夜明け）で撤退、全軍で見つけた敵へ当たり続けると陣を取れる（決着がつく）', () => {
        const a = runToEnd(battle('night_raid'));
        expect([a.result, a.reason]).toEqual(['retreat', 'nightfall']);
        const s = battle('night_raid');
        const r = runToEnd(s, (st) => {
            for (const u of st.units) {
                if (u.side !== 'ally' || u.isHq || !isActive(u) || u.order.type === 'attack') continue;
                const e = st.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally).sort((p, q) => Math.hypot(p.x - u.x, p.z - u.z) - Math.hypot(q.x - u.x, q.z - u.z))[0];
                if (e) issueOrder(st, u.id, { type: 'attack', targetId: e.id });
                else if (u.order.type !== 'move') issueOrder(st, u.id, { type: 'move', x: 0, z: -120 });
            }
        });
        expect(r.result).toBe('victory');
        expect(r.objectives?.primary).toMatchObject({ type: 'hold_point', achieved: true });
    }, 20_000);
});

describe('湖・河岸', () => {
    // 湖・河岸の調整（地形・配置・敵の時刻。tests/proto3d-field-shore.test.ts）で、前の台本（狭まりと宿場に分けて受け、内陸は西へ向けて受ける。
    // 移動の後の向きを使う）は 420 秒の勝ち → 168.6 秒に岸の狭まりを失う負けになった（内陸の騎馬が 70 秒に現れ、崖の南の端を回って狭まりを
    // 後ろから突く。高地は崖のすぐ西へ移した）。何もしないと 52 秒に負け → 167.4 秒に負け（忠勝隊が狭まりの小高い所から始まる）。
    // 台本を、向きを使わない「岸を固め、高地に予備」（tests/proto3d-field-shore.test.ts の KISHI の 1 通り）に置き換えた。
    it('早送り：岸を固め、高地に予備を置く台本は 7 分守り抜く。何もしないと岸の狭まりを失って負けるが、最初の命令を出す間はある', () => {
        const a = runToEnd(battle('shore'));
        expect([a.result, a.reason]).toEqual(['defeat', 'objective_failed']);
        expect(a.elapsedSec).toBeGreaterThan(120);
        const s = battle('shore');
        const done = new Set<string>();
        const once = (key: string, cond: boolean, f: () => boolean) => {
            if (done.has(key) || !cond) return;
            done.add(key);
            expect([key, f()]).toEqual([key, true]);
        };
        const seen = (st: BattleState, id: string) => {
            const e = U(st, id);
            return e.arrived && isActive(e) && e.seenBy.ally;
        };
        const near = (st: BattleState, a: string, b: string, r: number) => Math.hypot(U(st, a).x - U(st, b).x, U(st, a).z - U(st, b).z) <= r;
        const r = runToEnd(s, (st) => {
            const mv = (id: string, x: number, z: number) => issueOrder(st, id, { type: 'move', x, z });
            const at = (id: string, targetId: string) => issueOrder(st, id, { type: 'attack', targetId });
            // 2 秒おきに 1 部隊ずつ：弓は高地の東の肩、騎馬は狭まりの後ろ、酒井隊は内陸の道の正面、榊原隊は高地の上、石川隊は二の備え
            once('yumi', st.t >= 2, () => mv('a_yumi', 62, -55));
            once('kiba', st.t >= 4, () => mv('a_kiba', 125, 0));
            once('sakai', st.t >= 6, () => mv('a_sakai', -30, 5));
            once('sakakibara', st.t >= 8, () => mv('a_sakakibara', 0, -35));
            once('ishikawa', st.t >= 10, () => mv('a_ishikawa', -5, 40));
            once('ieyasu', st.t >= 12, () => mv('a_ieyasu', 40, 155));
            // 見てから押す：弓は着いてから岸の弓へ、騎馬は忠勝隊が斬り合ったら岸の槍へ、内陸の槍・騎馬は近づいたのを見て当たる
            once('bow', st.t > 5 && U(st, 'a_yumi').order.type === 'hold' && seen(st, 'e_shore_yumi'), () => at('a_yumi', 'e_shore_yumi'));
            once('kiba2', !!U(st, 'a_tadakatsu').engagedWith && seen(st, 'e_shore_yari'), () => at('a_kiba', 'e_shore_yari'));
            once('sakai2', seen(st, 'e_inland_yari') && near(st, 'e_inland_yari', 'a_sakai', 70), () => at('a_sakai', 'e_inland_yari'));
            once('sakakibara2', U(st, 'e_inland_yari').engagedWith === 'a_sakai' && U(st, 'a_sakakibara').status === 'ready', () => at('a_sakakibara', 'e_inland_yari'));
            once('ishikawa2', seen(st, 'e_inland_kiba') && near(st, 'e_inland_kiba', 'a_ishikawa', 80) && U(st, 'a_ishikawa').status === 'ready', () => at('a_ishikawa', 'e_inland_kiba'));
        });
        expect([r.result, r.reason]).toEqual(['victory', 'objective_done']);
        expect(r.elapsedSec).toBe(420);
    }, 20_000);

    it('地図の名札：浅瀬・橋の無い水面は「湖」。決まりの文も湖と書く', () => {
        const s = battle('shore');
        expect(mapLabels(s).some((l) => l.text.startsWith('湖（深い水面'))).toBe(true);
        expect(fieldRuleTexts(s)).toContain('湖（深い水面）は渡れない（船は無い。水辺の陸戦）');
        // 浅瀬・橋のある川の戦場は今までの名札・文
        expect(mapLabels(battle('river_ford')).some((l) => l.text === '深い川（渡れない）')).toBe(true);
    });
});

describe('地図の印・記録', () => {
    it('目標の区域の印：脱出の出口 2 つ・離脱の退き口・合流の輪と安全地点（別々）。救出の対象の名札に「救出」', () => {
        expect(objectiveZoneMarks(battle('besieged_camp')).filter((m) => m.id.startsWith('camp_escape')).map((m) => m.name)).toEqual(['南の突破口の出口', '東の回り道の出口']);
        expect(objectiveZoneMarks(battle('rearguard')).filter((m) => m.id.startsWith('rear_withdraw')).map((m) => m.name)).toEqual(['南の退き口']);
        const rel = battle('relief');
        expect(objectiveZoneMarks(rel).filter((m) => m.id.startsWith('relief_escort')).map((m) => m.name)).toEqual(['合流の輪', '安全地点（連れ帰る先）']);
        expect(objectiveUnitMarks(rel).get('a_nagamasa')).toBe('救出');
    });

    it('演習の記録：主目標・副目標に目標の種類、脱出・離脱の数、救出の合流、退き方（撤収／放棄）が入り、保存の形で読み戻せる。前の形の記録もそのまま読める', () => {
        const s = battle('relief');
        freezeEnemies(s);
        place(s, 'a_ieyasu', 0, 233);
        issueOrder(s, 'a_ieyasu', { type: 'retreat' });
        const o = runToEnd(s);
        const rec = recordFromOutcome(o, 'relief_escort', new Date('2026-10-03T00:00:00Z'));
        expect(rec.primary).toEqual({ id: 'relief_escort', achieved: false, type: 'rescue_escort', met: false });
        expect(rec.secondary.map((x) => x.type)).toEqual(['limit_losses', 'preserve_unit']);
        expect(rec.withdrawal).toBe('abandoned');
        const back = parsePracticeData(JSON.stringify({ version: 1, records: { relief: { plays: 1, last: rec, best: rec } } }));
        expect(back?.records.relief?.last).toEqual(rec);
        // 前の形（type・count・met・withdrawal の無い記録）
        const old = { result: 'victory', reason: 'objective_done', primary: { id: 'x', achieved: true }, secondary: [{ id: 'y', label: 'y', achieved: false }], elapsedSec: 10, at: '2026-09-01T00:00:00.000Z' };
        expect(parsePracticeData(JSON.stringify({ version: 1, records: { plains: { plays: 1, last: old, best: old } } }))?.records.plains?.last).toEqual(old);
        // 形の違う欄は読めない扱い
        const bad = { ...old, withdrawal: 'maybe' };
        expect(parsePracticeData(JSON.stringify({ version: 1, records: { plains: { plays: 1, last: bad, best: bad } } }))).toBeNull();
        // 結果の画面：退き方の文と、どこまで届いたか
        const info = practiceResultInfo(field('relief'), o, { ok: true, data: back!, record: back!.records.relief!, isBest: true, movedBroken: false });
        expect(info.withdrawalText).toContain('合戦の放棄');
        expect(info.primary.label).toContain('（合流の前）');
        const e = battle('besieged_camp');
        const eo = runToEnd(e);
        const er = recordFromOutcome(eo, 'camp_escape', new Date(0));
        expect(er.primary).toMatchObject({ type: 'escape', count: { done: 0, total: 4 } });
    });
});

describe('5 戦場の最初の案が動いて決着がつく（早送り。釣り合いは後の担当）', () => {
    for (const id of G4) {
        it(`${id}：何もしない・全軍で見えている近い敵へ当たり続ける、のどちらでも最後まで進み、主目標の種類と結果が入る`, () => {
            for (const mode of ['hold', 'attack'] as const) {
                const s = battle(id);
                const r = runToEnd(s, (st) => {
                    if (mode !== 'attack') return;
                    for (const u of st.units) {
                        if (u.side !== 'ally' || u.isHq || !isActive(u) || u.order.type === 'attack') continue;
                        const e = st.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally).sort((p, q) => Math.hypot(p.x - u.x, p.z - u.z) - Math.hypot(q.x - u.x, q.z - u.z))[0];
                        if (e) issueOrder(st, u.id, { type: 'attack', targetId: e.id });
                    }
                });
                expect(r.elapsedSec).toBeLessThanOrEqual(field(id).timeLimitSec);
                expect(r.objectives?.primary?.type).toBe(field(id).objectives.primary.type);
                expect(r.objectives?.primary?.achieved).toBe(r.result === 'victory');
            }
        }, 30_000);
    }
});
