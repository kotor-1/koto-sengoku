/**
 * 歴史分岐「元亀元年・家康」の合戦（maps.ts の ieyasu1570Setup・scripts.ts の ieyasu 台本）。
 * - 方針ごとの布陣（味方・敵の構成、能力を持つ部隊、約束の対象、説明文）。
 * - 釣り合い：何もしないと勝てない／正面から押すだけでは負ける／考えた采配なら勝てる。
 * - 約束：勝って守る・勝って破る・退いて守る。引き受けなければ約束の記録はない。
 * - 敵方の長政（A）は敵の考えが能力を使い、プレイヤーは操作できない。
 * 台本で最後まで一気に進める（早送り）。状態の直接変更はしない。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, orderAllRetreat, runToEnd, unitById, type BattleState } from '../proto3d/src/battle/sim';
import {
    BORDER_FIELD,
    IEYASU_INITIAL_TROOPS,
    IEYASU_PLEDGE_TARGET,
    IEYASU_SAFE_ZONE,
    IEYASU_UNIT_IDS,
    ieyasu1570Setup,
    ieyasuTroopKeysInBattle,
    ieyasuUnits,
    type IeyasuPolicy,
} from '../proto3d/src/battle/maps';
import { abilityInfo, useAbility } from '../proto3d/src/battle/abilities';
import { ieyasuFrontalScript, ieyasuPlanScript, ieyasuRetreatScript, type Script } from '../proto3d/src/battle/scripts';
import type { BattleOutcome } from '../proto3d/src/battle/types';

const POLICIES: IeyasuPolicy[] = ['oda', 'asai', 'home'];
const troops = () => ({ ...IEYASU_INITIAL_TROOPS });

function play(policy: IeyasuPolicy, script: Script, pledgeAccepted = true): { r: BattleOutcome; s: BattleState } {
    const s = createBattle(ieyasu1570Setup(policy, { troops: troops(), pledgeAccepted }));
    const r = runToEnd(s, script);
    return { r, s };
}
function allyLoss(r: BattleOutcome): number {
    const us = r.units.filter((u) => u.side === 'ally');
    return 1 - us.reduce((a, u) => a + u.endStrength, 0) / us.reduce((a, u) => a + u.startStrength, 0);
}
/** period 秒ごとにしか命令を出さない（利用者の反応の遅れ） */
function slow(script: Script, period: number): Script {
    let last = -1;
    return (s) => {
        const k = Math.floor(s.t / period);
        if (k === last) return;
        last = k;
        script(s);
    };
}

describe('方針ごとの布陣（1570年の情勢を背景にした架空の局地戦）', () => {
    it('どの方針でも味方 4・敵 4、本陣は各 1、id は重ならず、戦場の中。家康本陣・本多忠勝隊はいつも味方で能力を持つ', () => {
        for (const p of POLICIES) {
            const us = ieyasuUnits(p, troops());
            expect(us.filter((u) => u.side === 'ally')).toHaveLength(4);
            expect(us.filter((u) => u.side === 'enemy')).toHaveLength(4);
            expect(us.filter((u) => u.side === 'ally' && u.kind === 'honjin')).toHaveLength(1);
            expect(us.filter((u) => u.side === 'enemy' && u.kind === 'honjin')).toHaveLength(1);
            expect(new Set(us.map((u) => u.id)).size).toBe(8);
            for (const u of us) {
                expect(Math.abs(u.x)).toBeLessThanOrEqual(BORDER_FIELD.width / 2);
                expect(Math.abs(u.z)).toBeLessThanOrEqual(BORDER_FIELD.depth / 2);
            }
            expect(us.find((u) => u.id === 't_honjin')).toMatchObject({ side: 'ally', clan: 'tokugawa', kind: 'honjin', leaderId: 'ieyasu', ability: 'ieyasu_rally', name: '家康本陣' });
            expect(us.find((u) => u.id === 't_tadakatsu')).toMatchObject({ side: 'ally', clan: 'tokugawa', leaderId: 'tadakatsu', ability: 'tadakatsu_rearguard', name: '本多忠勝隊' });
            // 能力は武将のいる部隊だけ
            for (const u of us) if (u.ability) expect(u.leaderId).toBeTruthy();
            // 信長本人は戦場に出ない
            expect(us.some((u) => u.leaderId === 'nobunaga')).toBe(false);
        }
    });

    it('A 織田との協力：織田援軍が前に突出した味方（約束の対象）。浅井長政隊は敵の本陣で、能力は敵方', () => {
        const us = ieyasuUnits('oda', troops());
        expect(us.find((u) => u.id === 'a_oda')).toMatchObject({ side: 'ally', clan: 'oda', name: '織田援軍' });
        expect(us.find((u) => u.id === 'a_oda')!.z).toBeLessThan(us.find((u) => u.id === 't_tadakatsu')!.z - 30); // 徳川の前線より前（北）に突出
        expect(us.find((u) => u.id === 'e_nagamasa')).toMatchObject({ side: 'enemy', clan: 'asai', kind: 'honjin', leaderId: 'nagamasa', ability: 'nagamasa_support' });
        expect(us.filter((u) => u.side === 'enemy').map((u) => u.clan).sort()).toEqual(['asai', 'asai', 'asai', 'asakura']);
        expect(IEYASU_PLEDGE_TARGET.oda).toBe('a_oda');
    });

    it('B 浅井との協力（史実から分かれた道）：浅井長政隊は同盟の味方で指揮でき、能力はプレイヤーが使う。敵は織田の一般の部隊', () => {
        const us = ieyasuUnits('asai', troops());
        expect(us.find((u) => u.id === 'a_nagamasa')).toMatchObject({ side: 'ally', clan: 'asai', leaderId: 'nagamasa', ability: 'nagamasa_support' });
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'oda' && !u.leaderId)).toBe(true);
        expect(us.map((u) => u.name)).toEqual(expect.arrayContaining(['織田方の本陣', '織田先手', '織田鉄砲隊', '織田騎馬']));
        expect(IEYASU_PLEDGE_TARGET.asai).toBe('a_nagamasa');
    });

    it('C 自領の防衛：岡崎の守備隊が砦に孤立（約束の対象）。敵は浪人衆 4 部隊で、織田・浅井とは戦わない。長政は出ない', () => {
        const us = ieyasuUnits('home', troops());
        expect(us.find((u) => u.id === 't_reserve')).toMatchObject({ side: 'ally', clan: 'tokugawa', name: '岡崎の守備隊' });
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'ronin')).toBe(true);
        expect(us.some((u) => u.clan === 'oda' || u.clan === 'asai' || u.clan === 'asakura')).toBe(false);
        expect(us.some((u) => u.leaderId === 'nagamasa')).toBe(false);
        expect(IEYASU_PLEDGE_TARGET.home).toBe('t_reserve');
    });

    it('徳川の兵は章の進行の値を使う（合戦に出る部隊だけ）。A・B では岡崎の守備隊は出ない', () => {
        const t = { honjin: 280, tadakatsu: 390, yumi: 310, reserve: 260 };
        for (const p of POLICIES) {
            const us = ieyasuUnits(p, t);
            const keys = ieyasuTroopKeysInBattle(p);
            for (const k of keys) expect(us.find((u) => u.id === IEYASU_UNIT_IDS[k])!.strength).toBe(t[k]);
            expect(us.some((u) => u.id === 't_reserve')).toBe(p === 'home');
        }
        expect(ieyasuTroopKeysInBattle('home')).toEqual(['honjin', 'tadakatsu', 'yumi', 'reserve']);
    });

    it('兵のいない徳川の部隊は出さない（本陣は最低 50）。約束の対象が出なければ約束も付けない（合戦は作れる）', () => {
        const t = { honjin: 0, tadakatsu: 400, yumi: 0, reserve: 0 };
        const setup = ieyasu1570Setup('home', { troops: t, pledgeAccepted: true });
        expect(setup.units.find((u) => u.id === 't_honjin')!.strength).toBe(50);
        expect(setup.units.some((u) => u.id === 't_yumi' || u.id === 't_reserve')).toBe(false);
        expect(setup.pledge).toBeUndefined();
        expect(() => createBattle(setup)).not.toThrow();
    });

    it('説明文：架空の局地戦で姉川の再現ではないこと、勝ち負けの条件、B は史実から分かれた道、約束の対象と条件', () => {
        for (const p of POLICIES) {
            for (const acc of [true, false]) {
                const b = ieyasu1570Setup(p, { troops: troops(), pledgeAccepted: acc }).briefing.join('\n');
                expect(b).toContain('1570年の情勢を背景にした架空の局地戦');
                expect(b).toContain('姉川の戦いの再現ではない');
                expect(b).toContain('勝利');
                expect(b).toContain('敗北');
                expect(b).toContain('撤退');
                expect(b).toContain('ゲーム用の創作');
                if (acc) {
                    expect(b).toContain('約束（引き受けた）');
                    expect(b).toContain('20 秒以上');
                    expect(b).toContain('40% 以上');
                    expect(b).toContain('敵と斬り合う前に');
                } else expect(b).toContain('約束違反にはならない');
                expect(b).toContain('追い討ち');
            }
        }
        // （プレイテストの指摘）回り込む敵の向きが布陣と合っている：C の浪人衆の騎馬・B の織田騎馬は西の林、A の朝倉勢は東
        const dir = (p: IeyasuPolicy, id: string) => (ieyasuUnits(p, troops()).find((u) => u.id === id)!.x < 0 ? '西' : '東');
        const home = ieyasu1570Setup('home', { troops: troops(), pledgeAccepted: true }).briefing.join('');
        expect(dir('home', 'e_ronin_kiba')).toBe('西');
        expect(home).toContain('西の林から浪人衆の騎馬が回り込んでくる');
        expect(home).not.toContain('東から浪人衆');
        expect(dir('asai', 'e_oda_kiba')).toBe('西');
        expect(ieyasu1570Setup('asai', { troops: troops(), pledgeAccepted: true }).briefing.join('')).toContain('西の林から織田騎馬');
        expect(dir('oda', 'e_asakura')).toBe('東');
        expect(ieyasu1570Setup('oda', { troops: troops(), pledgeAccepted: true }).briefing.join('')).toContain('東から回り込む朝倉勢');
        expect(ieyasu1570Setup('asai', { troops: troops(), pledgeAccepted: true }).briefing.join('')).toContain('史実から分かれた道');
        expect(ieyasu1570Setup('oda', { troops: troops(), pledgeAccepted: true }).briefing.join('')).not.toContain('史実から分かれた道');
    });

    it('約束を引き受けたときだけ pledge が付く（対象・南の味方の陣・20 秒・40%）', () => {
        for (const p of POLICIES) {
            const on = ieyasu1570Setup(p, { troops: troops(), pledgeAccepted: true });
            expect(on.pledge).toEqual({ targetId: IEYASU_PLEDGE_TARGET[p], safeZone: { ...IEYASU_SAFE_ZONE }, holdSec: 20, minStrengthRatio: 0.4 });
            expect(on.units.find((u) => u.id === on.pledge!.targetId)!.side).toBe('ally');
            expect(on.pledge!.safeZone.cz).toBeGreaterThan(0); // 南
            expect(ieyasu1570Setup(p, { troops: troops(), pledgeAccepted: false }).pledge).toBeUndefined();
        }
    });
});

describe.each(POLICIES)('合戦の釣り合い（方針 %s）', (policy) => {
    it('何もしない（全部隊待機）では勝てない。突出した約束の対象は崩れ、約束は守れない', () => {
        const { r } = play(policy, () => {});
        expect(r.result).not.toBe('victory');
        expect(r.pledge).toEqual({ targetId: IEYASU_PLEDGE_TARGET[policy], result: 'broken' });
    });

    it('全軍（本陣も）で正面から押すと負ける。本陣以外で押しても負ける', () => {
        expect(play(policy, ieyasuFrontalScript(policy, true)).r.result).toBe('defeat');
        const noHq = play(policy, ieyasuFrontalScript(policy, false)).r;
        expect(noHq.result).toBe('defeat');
        expect(allyLoss(noHq)).toBeGreaterThan(0.3);
    });

    it('考えた采配（対象を味方の陣へ下げる・能力を使う・誘い出して横から当たる）なら勝ち、約束も守れる', () => {
        const { r, s } = play(policy, ieyasuPlanScript(policy, 'keep'));
        expect(r.result).toBe('victory');
        expect(r.pledge).toEqual({ targetId: IEYASU_PLEDGE_TARGET[policy], result: 'kept' });
        expect(allyLoss(r)).toBeLessThan(allyLoss(play(policy, ieyasuFrontalScript(policy, false)).r));
        expect(Object.keys(r.abilitiesUsed ?? {})).toContain('t_honjin');
        const tgt = r.units.find((u) => u.id === IEYASU_PLEDGE_TARGET[policy])!;
        expect(['ready', 'withdrawn']).toContain(tgt.status);
        expect(tgt.endStrength / tgt.startStrength).toBeGreaterThanOrEqual(0.4);
        // A・C は対象を南の味方の陣で 20 秒持ちこたえさせる。B は長政隊を忠勝隊の後ろで援護に回し、戦える形で終える
        if (policy !== 'asai') expect(s.pledge!.secured).toBe(true);
        else expect(r.abilitiesUsed!.a_nagamasa).toBeGreaterThanOrEqual(0);
        expect(r.elapsedSec).toBeLessThan(480);
    });

    it('采配の命令が数秒遅れても勝てる', () => {
        for (const period of [2, 5]) {
            const { r } = play(policy, slow(ieyasuPlanScript(policy, 'keep'), period));
            expect(r.result).toBe('victory');
            expect(r.pledge?.result).toBe('kept');
        }
    });

    it('勝ったが約束は守れなかった：対象を前に置いたまま（捨て石）でも勝てるが、約束は broken', () => {
        const { r } = play(policy, ieyasuPlanScript(policy, 'break'));
        expect(r.result).toBe('victory');
        expect(r.pledge?.result).toBe('broken');
        expect(['routed', 'destroyed']).toContain(r.units.find((u) => u.id === IEYASU_PLEDGE_TARGET[policy])!.status);
    });

    it('撤退したが味方を救った：対象を退き口から離し、忠勝隊の後ろ盾で全軍撤退すると「撤退」・約束は kept', () => {
        const { r, s } = play(policy, ieyasuRetreatScript(policy));
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('ordered_retreat');
        expect(r.pledge).toEqual({ targetId: IEYASU_PLEDGE_TARGET[policy], result: 'kept' });
        expect(r.units.find((u) => u.id === IEYASU_PLEDGE_TARGET[policy])!.status).toBe('withdrawn');
        expect(s.events.some((e) => e.kind === 'pledge' && e.text.includes('退き口から無事に'))).toBe(true);
    });

    it('（プレイテストの指摘）合戦が始まってすぐ全軍撤退しても、約束は守ったことにならない（敵と斬り合う前に退いた）', () => {
        const { r, s } = play(policy, (x) => {
            if (x.allRetreatAt === null) orderAllRetreat(x);
        });
        expect(r.result).toBe('retreat');
        expect(r.pledge).toEqual({ targetId: IEYASU_PLEDGE_TARGET[policy], result: 'broken' });
        expect(s.pledge!.contested).toBe(false);
        // 引き受けなければ、同じ撤退でも約束の記録はない（違反ではない）
        expect(play(policy, (x) => void (x.allRetreatAt === null && orderAllRetreat(x)), false).r.pledge).toBeUndefined();
    });

    it('（プレイテストの指摘）退路の守護が効く：同じ「斬り合ってから退く」采配で、守護なしなら対象が追い討ちで崩れて約束は broken、守護ありなら kept', () => {
        const withRg = play(policy, ieyasuRetreatScript(policy));
        expect(withRg.r.pledge?.result).toBe('kept');
        expect(withRg.r.abilitiesUsed!.t_tadakatsu).toBeGreaterThan(0);
        expect(withRg.s.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ちを本多忠勝隊が阻む'))).toBe(true);
        // 守護なし（使えない状態にしてから同じ台本）
        const s = createBattle(ieyasu1570Setup(policy, { troops: troops(), pledgeAccepted: true }));
        s.abilities.t_tadakatsu.usedAt = -1; // （状態を直接変更）この合戦ではもう使った扱い
        const r = runToEnd(s, ieyasuRetreatScript(policy));
        expect(r.pledge?.result).toBe('broken');
        expect(['routed', 'destroyed']).toContain(r.units.find((u) => u.id === IEYASU_PLEDGE_TARGET[policy])!.status);
    });

    it('（プレイテストの指摘）全軍で正面から押して号令を 1 回使うだけでは、いつ使っても勝てない', () => {
        const at = (t0: number | 'hq'): Script => {
            const f = ieyasuFrontalScript(policy, true);
            let done = false;
            return (x) => {
                f(x);
                if (done) return;
                const hq = unitById(x, 't_honjin')!;
                if (t0 === 'hq' ? !!hq.engagedWith : x.t >= t0) done = useAbility(x, 't_honjin').ok;
            };
        };
        for (const t0 of ['hq', 0, 20, 40, 60, 80] as const) expect(play(policy, at(t0)).r.result, `号令 ${t0}`).toBe('defeat');
    });

    it('約束を引き受けなければ、同じ采配でも約束の記録はない（約束違反と同じにしない）', () => {
        const { r } = play(policy, ieyasuPlanScript(policy, 'keep'), false);
        expect(r.result).toBe('victory');
        expect(r.pledge).toBeUndefined();
    });

    it('同じ采配なら同じ結果になる', () => {
        const a = play(policy, ieyasuPlanScript(policy, 'keep'));
        const b = play(policy, ieyasuPlanScript(policy, 'keep'));
        expect(b.r).toEqual(a.r);
        expect(b.s.events).toEqual(a.s.events);
    });
});

describe('敵方の浅井長政（A 織田との協力）', () => {
    it('プレイヤーは長政の能力を操作できない（使用回数も減らない）。表示は「敵の考えが使う」', () => {
        const s = createBattle(ieyasu1570Setup('oda', { troops: troops(), pledgeAccepted: true }));
        const info = abilityInfo(s, 'e_nagamasa')!;
        expect(info.controllable).toBe(false);
        expect(info.usable).toBe(false);
        expect(info.reason).toContain('敵方');
        const res = useAbility(s, 'e_nagamasa', 'e_asai_sente');
        expect(res.ok).toBe(false);
        expect(s.abilities.e_nagamasa.usedAt).toBeNull();
        // 味方の部隊を対象にしても同じ
        expect(useAbility(s, 'e_nagamasa', 'a_oda').ok).toBe(false);
        expect(s.abilities.e_nagamasa.usedAt).toBeNull();
    });

    it('敵の考えが、交戦した浅井先手を「盟友への援護」で支える', () => {
        const { s } = play('oda', ieyasuFrontalScript('oda', true));
        const e = s.events.find((x) => x.kind === 'ability' && x.unitId === 'e_nagamasa');
        expect(e).toBeTruthy();
        expect(e!.targetId).toBe('e_asai_sente');
        expect(s.abilities.e_nagamasa.targetId).toBe('e_asai_sente');
        expect(s.result!.abilitiesUsed!.e_nagamasa).toBeGreaterThan(0);
    });

    it('B では長政隊は味方で、プレイヤーが援護を使える（敵の考えは使わない）', () => {
        const { r } = play('asai', () => {});
        expect(r.abilitiesUsed).toEqual({});
        const { r: r2 } = play('asai', ieyasuPlanScript('asai', 'keep'));
        expect(r2.abilitiesUsed!.a_nagamasa).toBeGreaterThanOrEqual(0);
    });
});
