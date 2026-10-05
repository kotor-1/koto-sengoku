/**
 * 第一章の結果 → 第二章での効き方（docs/chapter2-design.md §5.1 の表）。
 * 3 方針 × 第一章の結果（勝ち・撤退・負け）× 約束（守った・破った・引き受けなかった）で、支援・士気・敵の倍率・会話が表のとおり。
 * 同じ方針でも第一章の結果が違うと、兵・支援・会話・合戦の説明が変わる（実物の保存で比べる）。
 * 合戦の数値（兵・士気の元の値）は合戦の担当が直すので、ここは決まり（CH2_RULES）との差だけを見る。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import { CH2_RULES, CH2_UNIT, ch2BattleSetup } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { devIeyasuCh1Ending, ieyasu2BattleInput, startChapter2, talkIeyasu2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { ieyasu2Chapter1RecordView } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { POLICIES, TOKUGAWA_UNIT_IDS, type PledgeResult } from '../proto3d/src/campaign/ieyasu1570/state';
import { ch2From, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];
const PLEDGES: PledgeResult[] = ['kept', 'broken', 'declined'];

function expectedSupport(s: Ieyasu2State): string[] {
    if (s.policy === 'oda') return s.trust.oda >= CH2_RULES.supportTrust.oda ? ['oda_teppo'] : [];
    if (s.policy === 'asai') return s.trust.asai >= CH2_RULES.supportTrust.asai ? ['asai_guide'] : [];
    return s.chapter1.battle.result === 'victory' ? ['village'] : [];
}

const unit = (info: ReturnType<typeof ch2BattleSetup>, id: string) => info.setup.units.find((u) => u.id === id);

describe('引き継ぎの表：3 方針 × 第一章の結果 × 約束', () => {
    for (const p of POLICIES)
        for (const r of RESULTS)
            for (const pl of PLEDGES) {
                it(`${p}・${r}・${pl}`, () => {
                    const s = toCh2Muster(startChapter2(devIeyasuCh1Ending(p, r, pl)), 'commit');
                    const input = ieyasu2BattleInput(s);
                    const info = ch2BattleSetup(input);
                    // 支援（状態から毎回求める。兵には足さない）
                    expect(info.support).toEqual(expectedSupport(s));
                    expect(TOKUGAWA_UNIT_IDS.map((k) => s.troops[k])).toEqual(TOKUGAWA_UNIT_IDS.map((k) => s.chapter1.troops[k]));
                    // 敵の勢い（第一章の勝敗だけ）
                    expect(info.enemyFactor).toBe(CH2_RULES.enemyFactor[r]);
                    // 相手の部隊の士気：信頼が冷えていれば −coldMorale（差で見る）
                    if (p !== 'home') {
                        const partner = p === 'oda' ? 'oda' : 'asai';
                        const id = p === 'oda' ? CH2_UNIT.odaRear : CH2_UNIT.asai;
                        const warm = ch2BattleSetup({ ...input, trust: { ...input.trust, [partner]: CH2_RULES.coldTrust } });
                        const d = unit(warm, id)!.morale - unit(info, id)!.morale;
                        expect(d).toBe(s.trust[partner] < CH2_RULES.coldTrust ? CH2_RULES.coldMorale : 0);
                    } else {
                        // C は両家の部隊を出さない
                        expect(info.setup.units.some((u) => u.side === 'ally' && (u.clan === 'oda' || u.clan === 'asai'))).toBe(false);
                    }
                    // 会話：忠勝の情勢は第一章の結果ごと、使者（A・B）は約束の結果ごと
                    expect(talkIeyasu2(startChapter2(devIeyasuCh1Ending(p, r, pl)), 'tadakatsu').id).toBe(`ch2.explore.tadakatsu.${p}.${r}${p === 'home' ? `.${pl}` : ''}`);
                    const env = talkIeyasu2(startChapter2(devIeyasuCh1Ending(p, r, pl)), 'envoy').id;
                    expect(env).toBe(p === 'home' ? `ch2.explore.envoy.home.${r === 'victory' ? 'victory' : 'other'}` : `ch2.explore.envoy.${p}.${pl}`);
                    // 合戦の説明・調整の文に、第一章の勝敗の勢いが出る
                    if (r !== 'retreat') expect(info.adjustments.join('')).toContain(`×${CH2_RULES.enemyFactor[r]}`);
                    expect(info.setup.briefing.join('\n')).toContain('第一章');
                });
            }

    it('A：約束を守った勝ちは織田の鉄砲隊が加わり、破った負けは加わらず織田勢の士気が下がる', () => {
        const good = toCh2Muster(startChapter2(devIeyasuCh1Ending('oda', 'victory', 'kept')), 'commit');
        const bad = toCh2Muster(startChapter2(devIeyasuCh1Ending('oda', 'defeat', 'broken')), 'commit');
        const gi = ch2BattleSetup(ieyasu2BattleInput(good));
        const bi = ch2BattleSetup(ieyasu2BattleInput(bad));
        expect(gi.support).toEqual(['oda_teppo']);
        expect(bi.support).toEqual([]);
        expect(bad.trust.oda).toBeLessThan(CH2_RULES.coldTrust);
        expect(unit(bi, CH2_UNIT.odaRear)!.morale).toBeLessThan(unit(gi, CH2_UNIT.odaRear)!.morale);
        // A では長政は味方に置かない（第二章の戦場にも出さない）
        for (const i of [gi, bi]) expect(i.setup.units.some((u) => u.leaderId === 'nagamasa')).toBe(false);
    });

    it('B：長政が負傷していれば孤立した隊は「浅井勢の後備え」（武将なし・能力なし）。織田の武将は出さない', () => {
        const wounded = toCh2Muster(ch2From('asai_defeat_broken_heavy'), 'commit');
        expect(wounded.characters.nagamasa).toBe('wounded');
        const wi = ch2BattleSetup(ieyasu2BattleInput(wounded));
        const a = unit(wi, CH2_UNIT.asai)!;
        expect(a.name).toBe('浅井勢の後備え');
        expect(a.leaderId).toBeUndefined();
        expect(a.ability).toBeUndefined();
        const alive = toCh2Muster(ch2From('asai_victory_kept'), 'commit');
        const ai = ch2BattleSetup(ieyasu2BattleInput(alive));
        expect(unit(ai, CH2_UNIT.asai)!.leaderId).toBe('nagamasa');
        for (const i of [wi, ai]) expect(i.setup.units.some((u) => u.side === 'enemy' && u.leaderId)).toBe(false);
    });

    it('負傷：家康 → 本陣の士気 −、忠勝 → 忠勝隊の士気 −（決まりの値の差）', () => {
        const s = toCh2Muster(ch2From('oda_defeat_broken_heavy'), 'commit');
        expect(s.characters.ieyasu).toBe('wounded');
        expect(s.characters.tadakatsu).toBe('wounded');
        const input = ieyasu2BattleInput(s);
        const info = ch2BattleSetup(input);
        const healthy = ch2BattleSetup({ ...input, characters: { ...input.characters, ieyasu: 'alive', tadakatsu: 'alive' } });
        expect(unit(healthy, IEYASU_UNIT_IDS.honjin)!.morale - unit(info, IEYASU_UNIT_IDS.honjin)!.morale).toBe(CH2_RULES.woundedMorale.ieyasu);
        // 忠勝隊は兵が少なく出ないことがある（出たときだけ比べる）
        const tk = unit(info, IEYASU_UNIT_IDS.tadakatsu);
        if (tk) expect(unit(healthy, IEYASU_UNIT_IDS.tadakatsu)!.morale - tk.morale).toBe(CH2_RULES.woundedMorale.tadakatsu);
    });
});

describe('同じ方針で第一章の結果が違うと、兵・支援・会話・説明が変わる（実物の保存）', () => {
    for (const p of POLICIES) {
        it(p, () => {
            const names = [`${p}_victory_kept`, `${p}_retreat_declined`, `${p}_defeat_broken_heavy`] as const;
            const states = names.map((n) => ch2From(n));
            const infos = states.map((s) => ch2BattleSetup(ieyasu2BattleInput(toCh2Muster(s, 'commit'))));
            // 兵
            const totals = states.map((s) => TOKUGAWA_UNIT_IDS.reduce((n, k) => n + s.troops[k], 0));
            expect(new Set(totals).size).toBe(3);
            expect(totals[0]).toBeGreaterThan(totals[2]!);
            // 支援（勝って約束を守った方が、負けて破った方より多い）
            expect(infos[0]!.support.length).toBeGreaterThanOrEqual(infos[2]!.support.length);
            expect(infos[0]!.support.length).toBeGreaterThan(0);
            expect(infos[2]!.support).toEqual([]);
            // 敵の勢い
            expect(infos.map((i) => i.enemyFactor)).toEqual([CH2_RULES.enemyFactor.victory, CH2_RULES.enemyFactor.retreat, CH2_RULES.enemyFactor.defeat]);
            // 損害が大きいと兵が少ないときの調整
            expect(infos[2]!.thin).toBe(true);
            expect(infos[0]!.thin).toBe(false);
            // 会話
            const ids = states.map((s) => talkIeyasu2(s, 'tadakatsu').id);
            expect(new Set(ids).size).toBe(3);
            const env = states.map((s) => talkIeyasu2(s, 'envoy').lines.map((l) => l.text).join(''));
            expect(env[0]).not.toBe(env[2]);
            // 説明
            expect(infos[0]!.setup.briefing.join('')).not.toBe(infos[2]!.setup.briefing.join(''));
            // 結果確認の「効くこと」
            const rec = states.map((s) => Object.fromEntries(ieyasu2Chapter1RecordView(s).record.map((r) => [r.label, r.value])));
            expect(rec[0]!['効くこと：支援']).not.toBe(rec[2]!['効くこと：支援']);
            // 兵が少ないときの調整は、軍議で判断を決めた時に第一章の終わりの兵で確定する（補充では変わらない）と述べる
            expect(rec[2]!['効くこと：兵が少ないとき']).toContain('この判断に決めると');
            expect(rec[2]!['効くこと：兵が少ないとき']).toContain('で確定する');
            expect(rec[2]!['効くこと：兵が少ないとき']).toContain('後の補充では変わらない');
            expect(rec[2]!['効くこと：負傷']).toContain('士気');
        });
    }
});
