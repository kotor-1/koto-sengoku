/**
 * 歴史分岐シナリオ「元亀元年・家康」の進め方（proto3d/src/campaign/ieyasu1570/flow.ts）：
 * 3 方針 × 勝利・撤退・敗北 × 約束（守った・守れなかった・引き受けなかった）のすべてが、戦後と結末へ着き、
 * 信頼・支援・兵・次章への印が決まりどおりになる。引き受けなかったのは約束違反と別。結果の反映は合戦の id ごとに 1 回だけ。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import {
    FlowError,
    REINFORCEMENT_TROOPS,
    TRUST_DELTA,
    applyIeyasuOutcome,
    applyIeyasuOutcomeOnce,
    canTalkIeyasu,
    devIeyasuState,
    distributeReinforcement,
    finishIeyasuChapter,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    ieyasuEndingFor,
    ieyasuOutcomeFromSetup,
    legalIeyasuChoices,
    newIeyasuGame,
    presentIeyasuTalks,
    talkIeyasu,
    withIeyasuBattleId,
} from '../proto3d/src/campaign/ieyasu1570/flow';
import {
    INITIAL_TOKUGAWA_TROOPS,
    INITIAL_TRUST,
    PLEDGE_SPECS,
    POLICIES,
    TOKUGAWA_UNIT_IDS,
    type IeyasuEndingId,
    type IeyasuState,
    type PledgeResult,
    type Policy,
} from '../proto3d/src/campaign/ieyasu1570/state';
import { answerPledge, ieyasuToAftermath, ieyasuToBattle, ieyasuToMuster } from './proto3d-ieyasu-helpers';
import { snapshot } from './proto3d-campaign-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];
const PLEDGES: PledgeResult[] = ['kept', 'broken', 'declined'];

/** 表どおりの信頼（テストの側で別に計算する） */
function expectedTrust(p: Policy, r: BattleResultKind, pl: PledgeResult): Record<'oda' | 'asai' | 'tadakatsu', number> {
    const t = { ...INITIAL_TRUST };
    const partner = { victory: 15, retreat: 0, defeat: -10 }[r];
    if (p === 'oda') {
        t.oda += partner;
        t.asai += -15;
    } else if (p === 'asai') {
        t.asai += partner;
        t.oda += -30;
    } else {
        t.oda += -10;
    }
    t.tadakatsu += { victory: 5, retreat: 0, defeat: 0 }[r];
    t[PLEDGE_SPECS[p].partner] += { kept: 25, broken: -25, declined: 0 }[pl];
    return t;
}

function expectedEnding(p: Policy, r: BattleResultKind, pl: PledgeResult): IeyasuEndingId {
    if (r === 'victory') return p === 'oda' ? 'oda_victory' : p === 'asai' ? 'asai_victory' : 'home_victory';
    if (r === 'retreat') return 'retreat';
    if (p === 'home') return 'defeat_mikawa';
    return pl === 'broken' ? 'defeat_mikawa' : 'defeat_sheltered';
}

function play(p: Policy, r: BattleResultKind, pl: PledgeResult): IeyasuState {
    return pl === 'declined' ? ieyasuToAftermath(p, r, 'decline') : ieyasuToAftermath(p, r, 'accept', { pledge: pl });
}

describe('3 方針 × 勝敗 × 約束：すべて戦後と結末へ着く', () => {
    for (const p of POLICIES)
        for (const r of RESULTS)
            for (const pl of PLEDGES) {
                it(`${p} × ${r} × ${pl}`, () => {
                    const after = play(p, r, pl);
                    expect(after.phase).toBe('aftermath');
                    expect(after.policy).toBe(p);
                    // 勝敗と約束は別々に記録する
                    expect(after.battle?.result).toBe(r);
                    expect(after.pledge?.result).toBe(pl);
                    expect(after.pledge?.accepted).toBe(pl !== 'declined');
                    expect(after.pledge?.targetId).toBe(PLEDGE_SPECS[p].targetId);
                    // 信頼
                    expect(after.trust).toEqual(expectedTrust(p, r, pl));
                    // 支援：守ったときだけ援兵
                    expect(after.support?.reinforcement).toBe(pl === 'kept');
                    expect(after.support?.from).toBe(pl === 'kept' ? PLEDGE_SPECS[p].partner : null);
                    expect(after.support?.carryOver).toContain(`policy_${p}`);
                    expect(after.support?.carryOver).toContain(`pledge_${pl}`);
                    expect(after.support?.carryOver.includes(`reinforcement_${PLEDGE_SPECS[p].partner}` as never)).toBe(pl === 'kept');
                    if (pl === 'kept') expect(after.support!.recovered).toBeGreaterThan(0);
                    else expect(after.support!.recovered).toBe(0);
                    // 兵は上限（章の始め）を超えない
                    for (const k of TOKUGAWA_UNIT_IDS) expect(after.troops[k]).toBeLessThanOrEqual(INITIAL_TOKUGAWA_TROOPS[k]);
                    // 家康は死なない（状態は無事か負傷だけ）。信長は戦場に出ない
                    expect(['alive', 'wounded']).toContain(after.characters.ieyasu);
                    expect(after.characters.nobunaga).toBe('alive');
                    // 戦後の会話がどれも作れる（居る相手すべて）
                    for (const id of presentIeyasuTalks(after)) expect(talkIeyasu(after, id).lines.length).toBeGreaterThan(0);
                    // 結末
                    const end = finishTalkIeyasu(after, 'tadakatsu', 'end_chapter');
                    expect(end.phase).toBe('ending');
                    expect(end.ending).toBe(expectedEnding(p, r, pl));
                    expect(ieyasuEndingFor(end)).toBe(end.ending);
                });
            }
});

describe('約束', () => {
    it('引き受けなかったのは約束違反と別（信頼は動かず、支援もない）', () => {
        for (const p of POLICIES) {
            const declined = play(p, 'victory', 'declined');
            const broken = play(p, 'victory', 'broken');
            const partner = PLEDGE_SPECS[p].partner;
            expect(declined.pledge?.result).toBe('declined');
            expect(broken.pledge?.result).toBe('broken');
            expect(declined.trust[partner] - broken.trust[partner]).toBe(TRUST_DELTA.pledge.declined - TRUST_DELTA.pledge.broken);
            expect(declined.support?.carryOver).toContain('pledge_declined');
            expect(declined.support?.carryOver).not.toContain('pledge_broken');
        }
    });
    it('勝ったが守れなかった／撤退したが守った、が成り立つ', () => {
        const a = play('oda', 'victory', 'broken');
        expect(a.battle?.result).toBe('victory');
        expect(a.pledge?.result).toBe('broken');
        const b = play('asai', 'retreat', 'kept');
        expect(b.battle?.result).toBe('retreat');
        expect(b.pledge?.result).toBe('kept');
        expect(b.support?.reinforcement).toBe(true);
    });
    it('答えるまで出陣できない（城門に出陣の選択肢が出ない・出陣は投げる）。「少し考える」は答えにならない', () => {
        for (const p of POLICIES) {
            let s = ieyasuToMuster(p);
            expect(s.pledge).toBeNull();
            const gate = talkIeyasu(s, 'gate');
            expect(gate.choices).toBeUndefined();
            expect(() => finishTalkIeyasu(s, 'gate', 'depart')).toThrow(FlowError);
            const giver = PLEDGE_SPECS[p].giver;
            const sc = talkIeyasu(s, giver);
            expect(sc.choices?.map((c) => c.id)).toEqual(['pledge_accept', 'pledge_decline', 'pledge_later']);
            expect(sc.choices?.[sc.defaultChoice ?? 0]?.id).toBe('pledge_later');
            // 対象と達成の条件が、出陣の前の会話に見える
            const text = [...sc.lines.map((l) => l.text), ...(sc.choices ?? []).map((c) => c.detail ?? '')].join('\n');
            expect(text).toContain(PLEDGE_SPECS[p].targetName);
            expect(text).toContain('20 秒');
            expect(text).toContain('40%');
            s = finishTalkIeyasu(s, giver, 'pledge_later');
            expect(s.pledge).toBeNull();
            s = answerPledge(s, 'accept');
            expect(s.pledge).toEqual({ accepted: true, partner: PLEDGE_SPECS[p].partner, targetId: PLEDGE_SPECS[p].targetId, result: null });
            expect(talkIeyasu(s, 'gate').choices?.map((c) => c.id)).toEqual(['depart', 'stay']);
            // 城門の確認にも約束が出る
            expect(talkIeyasu(s, 'gate').lines.map((l) => l.text).join('')).toContain(PLEDGE_SPECS[p].targetName);
            // 一度答えたら、もう約束の選択肢は出ない
            expect(talkIeyasu(s, giver).choices?.some((c) => c.id.startsWith('pledge_')) ?? false).toBe(false);
        }
    });
    it('約束の対象は、その方針の戦場に実際に出る味方の部隊。引き受けたときだけ合戦の設定に約束が付く', () => {
        for (const p of POLICIES) {
            const acc = ieyasuBattleSetup(ieyasuToBattle(p, 'accept'));
            const target = acc.units.find((u) => u.id === acc.pledge?.targetId);
            expect(target?.side).toBe('ally');
            expect(acc.pledge?.targetId).toBe(PLEDGE_SPECS[p].targetId);
            expect(ieyasuBattleSetup(ieyasuToBattle(p, 'decline')).pledge).toBeUndefined();
        }
    });
    it('合戦の計算が約束の結果を返さないとき（確認用の偽の結果）は、最後の状態から同じ決まりで判定する', () => {
        const s = ieyasuToBattle('home', 'accept');
        const setup = ieyasuBattleSetup(s);
        const t = setup.pledge!.targetId;
        const routed = applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(setup, 'victory', { units: { [t]: { status: 'routed' } } }));
        expect(routed.pledge?.result).toBe('broken');
        const thin = applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(setup, 'victory', { units: { [t]: { end: 50 } } }));
        expect(thin.pledge?.result).toBe('broken');
        const ok = applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(setup, 'retreat', { units: { [t]: { status: 'withdrawn', end: 200 } } }));
        expect(ok.pledge?.result).toBe('kept');
    });
    it('合戦の結果の約束の対象が食い違えば受け付けない', () => {
        const s = ieyasuToBattle('oda', 'accept');
        const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'victory', { pledge: 'kept' });
        o.pledge = { targetId: IEYASU_UNIT_IDS.yumi, result: 'kept' };
        expect(() => applyIeyasuOutcome(s, o)).toThrow(FlowError);
    });
});

describe('方針で戦場と戦後が変わる', () => {
    it('A：味方に織田援軍、敵は浅井・朝倉（長政隊が敵の本陣）', () => {
        const u = ieyasuBattleSetup(ieyasuToBattle('oda', 'accept')).units;
        expect(u.filter((x) => x.side === 'ally').map((x) => x.clan).sort()).toEqual(['oda', 'tokugawa', 'tokugawa', 'tokugawa']);
        expect(new Set(u.filter((x) => x.side === 'enemy').map((x) => x.clan))).toEqual(new Set(['asai', 'asakura']));
        expect(u.find((x) => x.side === 'enemy' && x.kind === 'honjin')?.leaderId).toBe('nagamasa');
    });
    it('B：味方に浅井長政隊（能力はプレイヤー側）、敵は織田方（信長本人は出ない）', () => {
        const u = ieyasuBattleSetup(ieyasuToBattle('asai', 'accept')).units;
        const ng = u.find((x) => x.leaderId === 'nagamasa');
        expect(ng?.side).toBe('ally');
        expect(ng?.ability).toBe('nagamasa_support');
        expect(new Set(u.filter((x) => x.side === 'enemy').map((x) => x.clan))).toEqual(new Set(['oda']));
        expect(u.some((x) => x.leaderId === 'nobunaga')).toBe(false);
    });
    it('C：織田・浅井とは戦わない（敵は浪人衆だけ）。岡崎の守備隊が出る', () => {
        const u = ieyasuBattleSetup(ieyasuToBattle('home', 'decline')).units;
        expect(u.some((x) => x.clan === 'oda' || x.clan === 'asai' || x.clan === 'asakura')).toBe(false);
        expect(new Set(u.filter((x) => x.side === 'enemy').map((x) => x.clan))).toEqual(new Set(['ronin']));
        expect(u.some((x) => x.id === IEYASU_UNIT_IDS.reserve && x.side === 'ally')).toBe(true);
    });
    it('A・B では岡崎の守備隊は出陣せず、兵はそのまま', () => {
        for (const p of ['oda', 'asai'] as const) {
            const a = play(p, 'defeat', 'broken');
            expect(a.troops.reserve).toBe(INITIAL_TOKUGAWA_TROOPS.reserve);
        }
    });
    it('C は両家への宣戦ではない：浅井の信頼は変わらず、織田は少し下がるだけ', () => {
        const c = play('home', 'victory', 'declined');
        expect(c.trust.asai).toBe(INITIAL_TRUST.asai);
        expect(c.trust.oda).toBe(INITIAL_TRUST.oda - 10);
    });
    it('支度・戦後に居る使者は方針しだい', () => {
        expect(presentIeyasuTalks(ieyasuToMuster('oda'))).toContain('oda_envoy');
        expect(presentIeyasuTalks(ieyasuToMuster('oda'))).not.toContain('asai_envoy');
        expect(presentIeyasuTalks(ieyasuToMuster('asai'))).toContain('asai_envoy');
        expect(presentIeyasuTalks(ieyasuToMuster('home')).filter((x) => x.endsWith('_envoy'))).toEqual([]);
        expect(canTalkIeyasu(ieyasuToMuster('home'), 'oda_envoy')).toBe(false);
        expect(presentIeyasuTalks(play('home', 'victory', 'declined'))).toContain('oda_envoy');
    });
});

describe('兵・人物・援兵', () => {
    it('援兵は徳川の部隊へ配り、各部隊の上限（章の始めの兵）を超えない', () => {
        const t = { honjin: 300, tadakatsu: 400, yumi: 340, reserve: 300 };
        expect(distributeReinforcement(t, REINFORCEMENT_TROOPS)).toBe(60);
        expect(t).toEqual({ ...INITIAL_TOKUGAWA_TROOPS });
        const u = { honjin: 100, tadakatsu: 100, yumi: 100, reserve: 300 };
        expect(distributeReinforcement(u, REINFORCEMENT_TROOPS)).toBe(150);
        expect(u.honjin + u.tadakatsu + u.yumi).toBe(450);
        expect(u.reserve).toBe(300);
    });
    it('生き残った兵を戻し、援兵を足す（出た部隊だけ）', () => {
        const s = ieyasuToAftermath('oda', 'victory', 'accept', { pledge: 'kept' });
        // 2 割減（偽の結果）＝ 240・360・280。援兵 150 を足りない部隊へ均等に
        expect(s.troops.honjin + s.troops.tadakatsu + s.troops.yumi).toBe(240 + 360 + 280 + 150);
        expect(s.support?.recovered).toBe(150);
    });
    it('敗走した味方の武将は負傷（死なない）。敵方の長政（A）は負傷させない。B の長政隊が崩れれば長政は負傷', () => {
        const d = play('oda', 'defeat', 'declined');
        expect(d.characters.ieyasu).toBe('wounded');
        const a = ieyasuToAftermath('oda', 'victory', 'decline');
        expect(a.characters.nagamasa).toBe('alive');
        const b = ieyasuToAftermath('asai', 'retreat', 'decline', { units: { a_nagamasa: { status: 'routed' } } });
        expect(b.characters.nagamasa).toBe('wounded');
        const t = ieyasuToAftermath('home', 'victory', 'decline', { units: { [IEYASU_UNIT_IDS.tadakatsu]: { status: 'destroyed', end: 0 } } });
        expect(t.characters.tadakatsu).toBe('wounded');
    });
    it('能力を使った記録は、合戦の結果と一緒に残る', () => {
        const s = ieyasuToBattle('asai', 'accept');
        const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'victory', { pledge: 'kept', abilitiesUsed: { [IEYASU_UNIT_IDS.honjin]: 42.5, a_nagamasa: 80 } });
        const a = applyIeyasuOutcome(s, o);
        expect(a.battle?.abilitiesUsed).toEqual({ [IEYASU_UNIT_IDS.honjin]: 42.5, a_nagamasa: 80 });
        expect(a.battle?.pledge).toEqual({ targetId: 'a_nagamasa', result: 'kept' });
    });
});

describe('1 回だけの反映・段階の守り', () => {
    it('同じ合戦の結果は 2 回目は反映しない。別の合戦の id は投げる', () => {
        let s = ieyasuToBattle('oda', 'accept');
        s = withIeyasuBattleId(s, 'ieyasu1570-abc-1');
        const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'victory', { pledge: 'kept' });
        const r1 = applyIeyasuOutcomeOnce(s, 'ieyasu1570-abc-1', o);
        expect(r1.applied).toBe(true);
        const before = snapshot(r1.state);
        const r2 = applyIeyasuOutcomeOnce(r1.state, 'ieyasu1570-abc-1', o);
        expect(r2.applied).toBe(false);
        expect(snapshot(r2.state)).toEqual(before);
        expect(() => applyIeyasuOutcomeOnce(r1.state, 'ieyasu1570-other', o)).toThrow(FlowError);
    });
    it('受け取った状態を書き換えない', () => {
        const s = ieyasuToBattle('home', 'accept');
        const snap = snapshot(s);
        applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'defeat', { pledge: 'broken' }));
        expect(snapshot(s)).toEqual(snap);
    });
    it('段階を飛ばせない', () => {
        const s = newIeyasuGame();
        expect(() => finishIeyasuChapter(s)).toThrow(FlowError);
        expect(() => ieyasuBattleSetup(ieyasuToMuster('oda'))).toThrow(FlowError);
        expect(legalIeyasuChoices(s)).toEqual(['open_council', 'not_yet']);
    });
    it('devIeyasuState は普通の遊び方と同じ順で状態を作る', () => {
        expect(devIeyasuState('explore').phase).toBe('explore');
        expect(devIeyasuState('muster', 'asai').pledge?.accepted).toBe(true);
        expect(devIeyasuState('muster', 'asai', 'victory', { answerPledge: false }).pledge).toBeNull();
        expect(devIeyasuState('aftermath', 'home', 'retreat', { pledge: 'decline' }).pledge?.result).toBe('declined');
        expect(devIeyasuState('ending', 'oda', 'defeat', { pledgeResult: 'broken' }).ending).toBe('defeat_mikawa');
    });
});
