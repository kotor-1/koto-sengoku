/**
 * 物語の見せ方（演出・情勢・町の人々・物見）のテストで共用する、状態の組み合わせ（テストの本体ではない。直接状態変更：
 * 第一章・第二章の flow の関数を普通の遊び方の順に呼び、合戦は確認用の偽の結果（ieyasuOutcomeFromSetup・ieyasu2OutcomeFromSetup）で作る）。
 *
 * 第一章：3 方針 × 勝利・撤退・敗北 × 約束（守った・破った・斬り合う前に退いて破った・引き受けなかった）× 損害（無し・小・大）。
 * 損害が大きいときは、B は長政も負傷（浅井長政隊が敗走）。損害が無く約束を守ったときは援兵が 0（recovered = 0）。
 * 第二章：第一章の結末から startChapter2 → 判断（選べるものすべて）→ 補充 → 出陣 → 結果（勝利・撤退・敗北の 3 つの理由）。
 */
import { expect } from 'vitest';
import type { BattleEndReason, BattleResultKind, UnitStatus } from '../proto3d/src/battle/types';
import { finishTalkIeyasu, newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import {
    applyIeyasu2Outcome,
    availableCh2Plans,
    finishTalkIeyasu2,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    legalIeyasu2Choices,
    startChapter2,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { POLICIES, type IeyasuState, type Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import { answerPledge, ieyasuToAftermath, ieyasuToBattle, ieyasuToMuster } from './proto3d-ieyasu-helpers';

export const RESULTS: readonly BattleResultKind[] = ['victory', 'retreat', 'defeat'];
export type Ch1Pledge = 'kept' | 'broken' | 'unfought' | 'declined';
export const CH1_PLEDGES: readonly Ch1Pledge[] = ['kept', 'broken', 'unfought', 'declined'];
export type Loss = 'none' | 'light' | 'heavy';
export const LOSSES: readonly Loss[] = ['none', 'light', 'heavy'];

const TARGET: Readonly<Record<Policy, string>> = { oda: 'a_oda', asai: 'a_nagamasa', home: 't_reserve' };
const FULL: Record<string, number> = { t_honjin: 300, t_tadakatsu: 450, t_yumi: 350, t_reserve: 300 };

export interface Ch1Case {
    name: string;
    policy: Policy;
    result: BattleResultKind;
    pledge: Ch1Pledge;
    loss: Loss;
    state: IeyasuState;
}

/** 第一章の戦後の状態（偽の結果） */
export function ch1Aftermath(policy: Policy, result: BattleResultKind, pledge: Ch1Pledge, loss: Loss): IeyasuState {
    const units: Record<string, { end?: number; status?: UnitStatus }> = {};
    if (loss === 'none') for (const [id, n] of Object.entries(FULL)) if (id !== 't_reserve' || policy === 'home') units[id] = { end: n };
    if (loss === 'heavy') {
        units.t_tadakatsu = { end: 25, status: 'routed' };
        units.t_yumi = { end: 20, status: 'routed' };
        if (result === 'defeat') units.t_honjin = { end: 140, status: 'routed' };
        // 約束の対象（C の守備隊・B の長政隊）は、約束を守ったときは崩さない（合戦の計算と同じ判定にそろえる）
        if (policy === 'home' && pledge !== 'kept') units.t_reserve = { end: 30, status: 'routed' };
        if (policy === 'asai' && pledge !== 'kept') units.a_nagamasa = { end: 60, status: 'routed' };
    }
    // 破った：対象が崩れた（守りきれなかった）
    if (pledge === 'broken') units[TARGET[policy]] = { status: 'routed', end: policy === 'home' ? 30 : 60 };
    // 斬り合う前に退いて破った：対象は無事（撤退で離れた）のまま、約束は守れなかった
    if (pledge === 'unfought') units[TARGET[policy]] = { ...(units[TARGET[policy]] ?? {}), status: 'withdrawn', end: policy === 'home' ? 280 : 380 };
    if (pledge === 'declined') return ieyasuToAftermath(policy, result, 'decline', { units });
    return ieyasuToAftermath(policy, result, 'accept', { pledge: pledge === 'kept' ? 'kept' : 'broken', units });
}

/** 第一章の戦後・結末のすべての組み合わせ */
export function ch1Cases(): Ch1Case[] {
    const out: Ch1Case[] = [];
    for (const policy of POLICIES)
        for (const result of RESULTS)
            for (const pledge of CH1_PLEDGES)
                for (const loss of LOSSES) {
                    const state = ch1Aftermath(policy, result, pledge, loss);
                    out.push({ name: `${policy}.${result}.${pledge}.${loss}`, policy, result, pledge, loss, state });
                }
    return out;
}

/** 第一章の合戦の前の状態（探索・軍議・支度・出陣） */
export function ch1BeforeBattle(): { name: string; state: IeyasuState }[] {
    const out: { name: string; state: IeyasuState }[] = [{ name: 'explore', state: newIeyasuGame() }];
    const council = finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council');
    out.push({ name: 'council', state: council });
    for (const p of POLICIES) {
        out.push({ name: `council.pending.${p}`, state: finishTalkIeyasu(council, 'council', `policy_${p}`) });
        const m = ieyasuToMuster(p);
        out.push({ name: `muster.${p}`, state: m }, { name: `muster.${p}.accepted`, state: answerPledge(m, 'accept') }, { name: `muster.${p}.declined`, state: answerPledge(m, 'decline') });
        out.push({ name: `battle.${p}.accept`, state: ieyasuToBattle(p, 'accept') }, { name: `battle.${p}.decline`, state: ieyasuToBattle(p, 'decline') });
    }
    return out;
}

export function ch1Ending(s: IeyasuState): IeyasuState {
    return finishTalkIeyasu(s, 'tadakatsu', 'end_chapter');
}

export interface Ch2Case {
    name: string;
    ch1: Ch1Case;
    state: Ieyasu2State;
}

/** 第二章のはじめ（第一章の結末の組み合わせから） */
export function ch2Starts(cases: Ch1Case[] = ch1Cases()): Ch2Case[] {
    return cases.map((c) => ({ name: `ch2.${c.name}`, ch1: c, state: startChapter2(ch1Ending(c.state)) }));
}

/** 第二章：判断を決めて支度へ（補充はまだ） */
export function ch2Muster(s: Ieyasu2State, plan: Ch2Plan): Ieyasu2State {
    let x = finishTalkIeyasu2(s, 'tadakatsu', 'open_council');
    x = finishTalkIeyasu2(x, 'council', plan === 'commit' ? 'plan_commit' : 'plan_hold');
    return finishTalkIeyasu2(x, 'council', 'confirm_plan');
}

/** 第二章：補充（選べる物の最初。待てるなら待つ）→ 出陣 */
export function ch2Battle(s: Ieyasu2State, recovery?: 'wait' | 'transfer' | 'none'): Ieyasu2State {
    const legal = legalIeyasu2Choices(s);
    const pick = recovery && legal.includes(`recovery_${recovery}`) ? `recovery_${recovery}` : legal.includes('recovery_wait') ? 'recovery_wait' : 'recovery_none';
    return finishTalkIeyasu2(finishTalkIeyasu2(s, 'ishikawa', pick), 'gate', 'depart');
}

export const CH2_DEFEATS: readonly Extract<BattleEndReason, 'ally_hq_routed' | 'objective_failed' | 'ally_army_broken'>[] = ['ally_hq_routed', 'objective_failed', 'ally_army_broken'];

/** 第二章の戦後（結果・敗北の理由・損害の大小） */
export function ch2Aftermath(s: Ieyasu2State, result: BattleResultKind, opts: { reason?: (typeof CH2_DEFEATS)[number]; heavy?: boolean } = {}): Ieyasu2State {
    const setup = ieyasu2BattleSetup(s);
    const units: Record<string, { end?: number; status?: UnitStatus }> = {};
    if (opts.heavy) for (const u of setup.units) if (u.side === 'ally' && u.clan === 'tokugawa' && u.id.startsWith('t_')) units[u.id] = { end: Math.round(u.strength * 0.2), status: 'routed' };
    return applyIeyasu2Outcome(s, ieyasu2OutcomeFromSetup(setup, result, { units, ...(result === 'defeat' && opts.reason ? { reason: opts.reason } : {}) }));
}

/** 第二章の状態の組み合わせ（判断 × 段階 × 結果）。数が多いので、第一章の結末を間引ける */
export function ch2Cases(starts: Ch2Case[]): { name: string; state: Ieyasu2State }[] {
    const out: { name: string; state: Ieyasu2State }[] = [];
    for (const c of starts) {
        out.push({ name: `${c.name}.explore`, state: c.state });
        for (const plan of availableCh2Plans(c.state)) {
            const m = ch2Muster(c.state, plan);
            out.push({ name: `${c.name}.${plan}.muster`, state: m });
            const b = ch2Battle(m);
            out.push({ name: `${c.name}.${plan}.battle`, state: b });
            for (const r of RESULTS) {
                if (r === 'defeat') {
                    for (const reason of CH2_DEFEATS) out.push({ name: `${c.name}.${plan}.${r}.${reason}`, state: ch2Aftermath(b, r, { reason, heavy: reason === 'ally_hq_routed' }) });
                } else out.push({ name: `${c.name}.${plan}.${r}`, state: ch2Aftermath(b, r) });
            }
        }
    }
    return out;
}

/** 禁止の言葉（tests/proto3d-ieyasu-story.test.ts・proto3d-ieyasu-ch2-story.test.ts と同じ決まり） */
export function checkBannedWords(all: string): void {
    expect(all).not.toMatch(/姉川の戦いを再現|姉川を再現|史実どおり/);
    expect(all).not.toMatch(/史実でも浅井|史実では浅井に付/);
    expect(all).not.toMatch(/単騎/);
    expect(all).not.toMatch(/無傷|傷ひとつ/);
    expect(all).not.toMatch(/同盟を結んで|年来の同盟|義兄|妹|お市|縁戚|婚姻/);
    expect(all).not.toMatch(/討ち死に|戦死|自害|滅亡した|滅ぼした|家は滅んだ/);
    expect(all).not.toMatch(/宣戦布告する|両家を敵に/);
    expect(all).not.toMatch(/金ヶ崎|金ケ崎|小谷|姉川/);
    for (const m of all.matchAll(/再現/g)) expect(all.slice(m.index!, m.index! + 20)).toMatch(/^再現(ではない|したものではありません|ではありません)/);
    for (const m of all.matchAll(/信長/g)) expect(all.slice(m.index!, m.index! + 20)).toMatch(/^信長(本人)?[^。\n]{0,12}出ない/);
    expect(all).not.toMatch(/元亀二|元亀三|157[1-9]|\d+月\d+日/);
    // 城・町の名前、今ある文より細かい地名を足さない
    expect(all).not.toMatch(/浜松|岡崎城|岐阜|清洲|越前|尾張|美濃|一乗谷|京/);
}

