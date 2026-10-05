/**
 * 第二章の「確定した任務の条件」（Ieyasu2State.terms。設計 docs/chapter2-design.md §5.3・§6、依頼 docs/chapter2-request-2.md【1】）：
 * - 軍議で判断を決めた時に、第一章の終わりの兵（chapter1.troops）を基準に ch2DecideTerms で 1 回だけ求める。決める前は null。
 * - その後の補充（3 つのどれでも）・保存と読み込み直し・出陣の前後・戦後・区切りで、条件と主目標（setup.objectives.primary）・始めの陣が変わらない。
 * - 前の不具合の再現：補充で兵が戻ると、今の兵から求め直す前の作り方では「兵が少ないとき」の調整が外れて主目標が厳しくなった（C 3 分 → 6 分など）。
 *   同じ状態で、確定した条件を使う今の作り方では変わらないことを確かめる。
 * - 二重に適用しない：移る処理を 2 回呼ぶ・補充の連打・出陣前の保存から出陣し直す・戦後の反映を 2 回、で兵・支援・条件が増えない。
 * どれも状態を関数で進めるテスト（画面の操作ではない）。保存は記憶域の偽物（MemoryStorage）に書いて読み戻す。
 */
import { describe, expect, it } from 'vitest';
import { FlowError } from '../proto3d/src/campaign/flow';
import { CH2_TERMS_TABLE, CH2_RULES, ch2BattleSetup, ch2DecideTerms, ch2SortieTroops, type Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import {
    applyIeyasu2OutcomeOnce,
    availableCh2Plans,
    ch2RecoveryOptions,
    devIeyasuCh1Ending,
    finishTalkIeyasu2,
    ieyasu2BattleInfo,
    ieyasu2BattleInput,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    startChapter2,
    talkIeyasu2,
    withIeyasu2BattleId,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State, RecoveryChoice } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { IeyasuCampaignStore, IEYASU_SAVE_KEY, parseIeyasu2SaveData, toIeyasu2SaveData } from '../proto3d/src/campaign/ieyasu1570/save';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import type { BattleSetup } from '../proto3d/src/battle/types';
import { POLICIES, TOKUGAWA_UNIT_IDS } from '../proto3d/src/campaign/ieyasu1570/state';
import { MemoryStorage, snapshot } from './proto3d-campaign-helpers';
import { CH1_ENDINGS, ch2From, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const now = new Date('2026-10-05T03:04:05Z');
/** CH2_LOG=1 で数字を出す */
const log = (...a: unknown[]) => (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CH2_LOG && console.log(...a);
const RECS: RecoveryChoice[] = ['wait', 'transfer', 'none'];

/** 主目標と始めの陣（家康本陣の置き場所）：確定した条件で決まるもの */
function fixedPart(setup: BattleSetup) {
    const hq = setup.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin)!;
    return { primary: snapshot(setup.objectives!.primary!), hq: { x: hq.x, z: hq.z } };
}

/** 保存して読み戻す（その時点の保存。読み戻した状態） */
function saveLoad(s: Ieyasu2State, point: 'manual' | 'departure' | 'aftermath' | 'ending'): Ieyasu2State {
    const store = new IeyasuCampaignStore(new MemoryStorage());
    const r = store.save(s, point, now);
    if (!r.ok) throw new Error(`保存できない：${point}`);
    const l = store.load();
    if (l.status !== 'ok') throw new Error(`読めない：${point}`);
    return l.state as Ieyasu2State;
}

/** 第二章のはじめの状態（実物の保存 9 つ ＋ 直接作った 27 通り×損害の大小） */
function starts(): { name: string; s: Ieyasu2State }[] {
    const out = CH1_ENDINGS.map((n) => ({ name: n as string, s: ch2From(n) }));
    for (const p of POLICIES)
        for (const r of ['victory', 'retreat', 'defeat'] as const)
            for (const pl of ['kept', 'broken', 'declined'] as const)
                for (const heavy of [false, true]) out.push({ name: `${p}_${r}_${pl}${heavy ? '_heavy' : ''}`, s: startChapter2(devIeyasuCh1Ending(p, r, pl, { heavy })) });
    return out;
}

describe('任務の条件は軍議で判断を決めた時に確定する', () => {
    it('決める前は null。選んだだけ・考え直すでは null のまま。決めると第一章の終わりの兵で ch2DecideTerms と同じ値', () => {
        for (const { name, s } of starts()) {
            expect(s.terms, name).toBeNull();
            const council = finishTalkIeyasu2(s, 'tadakatsu', 'open_council');
            expect(council.terms).toBeNull();
            for (const plan of availableCh2Plans(council)) {
                const picked = finishTalkIeyasu2(council, 'council', plan === 'commit' ? 'plan_commit' : 'plan_hold');
                expect(picked.terms, name).toBeNull();
                const back = finishTalkIeyasu2(picked, 'council', 'reconsider');
                expect(back.terms).toBeNull();
                expect(back.plan).toBeNull();
                const m = finishTalkIeyasu2(picked, 'council', 'confirm_plan');
                expect(m.phase).toBe('muster');
                expect(m.terms, name).toEqual(ch2DecideTerms(s.policy, plan, s.chapter1.troops));
                expect(m.terms!.basisTroops).toBe(ch2SortieTroops(plan, s.chapter1.troops));
                expect(m.terms!.thin).toBe(m.terms!.basisTroops < CH2_RULES.thinTroops);
                // 軍議の選択肢の説明の主目標＝決めた後の合戦の設定の主目標
                const preview = ieyasu2BattleInfo(council, plan).setup.objectives!.primary!;
                expect(snapshot(ieyasu2BattleInfo(m).setup.objectives!.primary!), name).toEqual(snapshot(preview));
            }
        }
    });

    it('主目標の値：B は連れ帰る兵の割合、C は守る時間、A は始めの陣（家康本陣を切れ目寄り）。表のどちらかで thin と合う', () => {
        const T = CH2_TERMS_TABLE;
        for (const { name, s } of starts()) {
            for (const plan of availableCh2Plans(s)) {
                const info = ieyasu2BattleInfo(toCh2Muster(s, plan));
                const t = info.terms;
                const P = info.setup.objectives!.primary!;
                if (s.policy === 'asai') {
                    expect(P.type === 'rescue_escort' && P.minRatio, name).toBe(t.thin ? T.escortMinRatio.thin : T.escortMinRatio.normal);
                    expect(t.holdSec).toBeNull();
                } else if (s.policy === 'home') {
                    expect(P.type === 'defend_time' && P.sec, name).toBe(t.thin ? T.holdSec.thin : T.holdSec.normal);
                    expect(t.escortMinRatio).toBeNull();
                } else {
                    expect(t.escortMinRatio).toBeNull();
                    expect(t.holdSec).toBeNull();
                }
                expect(info.thin).toBe(t.thin);
                expect(info.adjustments.some((l) => l.startsWith('第一章の損害で兵が少ないため'))).toBe(t.thin);
            }
        }
    });
});

describe('補充・保存・読み込み直し・出陣・戦後で、条件と主目標が変わらない', () => {
    it('どの第一章の結果 × 判断 × 補充 3 つでも：補充の前後・支度の保存・出陣の前後・出陣前の保存から出陣し直す・戦後・戦後の保存・区切り', () => {
        let n = 0;
        for (const { name, s } of starts()) {
            for (const plan of availableCh2Plans(s)) {
                const m = toCh2Muster(s, plan);
                const terms = snapshot(m.terms!);
                const fixed = fixedPart(ieyasu2BattleInfo(m).setup);
                const opts = ch2RecoveryOptions(m);
                // 支度の保存（補充の前）から読み戻しても同じ
                const m2 = saveLoad(m, 'manual');
                expect(m2.terms, name).toEqual(terms);
                expect(fixedPart(ieyasu2BattleInfo(m2).setup)).toEqual(fixed);
                for (const rec of RECS) {
                    if (!opts[rec].available) continue;
                    const tag = `${name} ${plan} ${rec}`;
                    const r = finishTalkIeyasu2(m, 'ishikawa', `recovery_${rec}`);
                    expect(r.terms, tag).toEqual(terms);
                    expect(fixedPart(ieyasu2BattleInfo(r).setup), tag).toEqual(fixed);
                    // 支度の保存（補充の後）
                    const r2 = saveLoad(r, 'manual');
                    expect(r2.terms, tag).toEqual(terms);
                    expect(r2.troops).toEqual(r.troops);
                    // 出陣の前後
                    const b = finishTalkIeyasu2(r, 'gate', 'depart');
                    expect(b.terms, tag).toEqual(terms);
                    expect(fixedPart(ieyasu2BattleSetup(b)), tag).toEqual(fixed);
                    // 出陣前の保存 → 支度から → 出陣し直す（補充は重ならない）
                    const d = saveLoad(b, 'departure');
                    expect(d.phase).toBe('muster');
                    expect(d.terms, tag).toEqual(terms);
                    expect(d.troops).toEqual(b.troops);
                    const b2 = finishTalkIeyasu2(d, 'gate', 'depart');
                    expect(b2.troops).toEqual(b.troops);
                    expect(fixedPart(ieyasu2BattleSetup(b2)), tag).toEqual(fixed);
                    // 戦後（兵は合戦で減るが、条件・主目標は変わらない）
                    const bid = withIeyasu2BattleId(b, 'ieyasu1570-t-1');
                    const res = n % 3 === 0 ? 'victory' : n % 3 === 1 ? 'retreat' : 'defeat';
                    const a = applyIeyasu2OutcomeOnce(bid, 'ieyasu1570-t-1', ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(bid), res, { units: { t_honjin: { end: 60 } } })).state;
                    expect(a.terms, tag).toEqual(terms);
                    expect(a.result!.thin).toBe(terms.thin);
                    expect(a.result!.primary!.label).toBe(fixed.primary.label);
                    expect(fixedPart(ieyasu2BattleInfo(a).setup), tag).toEqual(fixed);
                    const a2 = saveLoad(a, 'aftermath');
                    expect(a2.terms, tag).toEqual(terms);
                    expect(a2.result).toEqual(a.result);
                    expect(fixedPart(ieyasu2BattleInfo(a2).setup), tag).toEqual(fixed);
                    // 区切り
                    const e = saveLoad(finishTalkIeyasu2(a2, 'tadakatsu', 'end_chapter'), 'ending');
                    expect(e.terms, tag).toEqual(terms);
                    expect(fixedPart(ieyasu2BattleInfo(e).setup), tag).toEqual(fixed);
                    n++;
                }
            }
        }
        expect(n).toBeGreaterThan(100);
    }, 120_000);

    it('前の不具合の再現と直った確認：補充で出せる兵が 650 を越えても、兵が少ないときの条件（C 3 分・B 3 割・A 本陣の陣）は外れない', () => {
        const flipped: string[] = [];
        for (const { name, s } of starts()) {
            for (const plan of availableCh2Plans(s)) {
                const m = toCh2Muster(s, plan);
                if (!m.terms!.thin) continue;
                const fixed = fixedPart(ieyasu2BattleInfo(m).setup);
                for (const rec of ['wait', 'transfer'] as const) {
                    if (!ch2RecoveryOptions(m)[rec].available) continue;
                    const r = finishTalkIeyasu2(m, 'ishikawa', `recovery_${rec}`);
                    if (ch2SortieTroops(plan, r.troops) < CH2_RULES.thinTroops) continue;
                    // 前の作り方（任務の条件を渡さず、補充の後の今の兵から求める）では、兵が少ないときの調整が外れて主目標・陣が変わる
                    const { terms: _drop, ...old } = ieyasu2BattleInput(r);
                    const before = ch2BattleSetup(old);
                    expect(before.thin, `${name} ${plan} ${rec}`).toBe(false);
                    expect(fixedPart(before.setup), `${name} ${plan} ${rec}`).not.toEqual(fixed);
                    // 今の作り方：確定した条件のまま
                    const now2 = ieyasu2BattleInfo(r);
                    expect(now2.thin).toBe(true);
                    expect(fixedPart(now2.setup), `${name} ${plan} ${rec}`).toEqual(fixed);
                    flipped.push(`${name} ${plan} ${rec}`);
                }
            }
        }
        // 前の作り方で条件が外れていた組み合わせが、実際にある（C の判断 1 で待つ、など）
        log(`前の作り方で条件が外れていた組み合わせ ${flipped.length}：${flipped.join('／')}`);
        expect(flipped.length).toBeGreaterThan(0);
        expect(flipped.some((x) => x.startsWith('home_') && x.endsWith('commit wait'))).toBe(true);
    });

    it('C の損害の大きい保存（実物）で「待つ」を選んでも 3 分のまま（判断 1）。説明の文も 3 分', () => {
        const m = toCh2Muster(ch2From('home_defeat_broken_heavy'), 'commit');
        expect(m.terms!.thin).toBe(true);
        expect(m.terms!.holdSec).toBe(CH2_TERMS_TABLE.holdSec.thin);
        const b = finishTalkIeyasu2(finishTalkIeyasu2(m, 'ishikawa', 'recovery_wait'), 'gate', 'depart');
        const setup = ieyasu2BattleSetup(b);
        expect(setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: CH2_TERMS_TABLE.holdSec.thin });
        expect(setup.briefing.join('')).toContain('屋敷前を守ることに改めた');
        expect(saveLoad(b, 'departure').terms!.holdSec).toBe(CH2_TERMS_TABLE.holdSec.thin);
    });

    it('読み込みで求め直さない：保存の条件（判断を決めた時の物）をそのまま使う', () => {
        // 兵が少ない判断で決めた状態の保存に、兵が十分な値の条件（形は正しい）を書くと、読み込んだ状態はその条件を使う
        const m = toCh2Muster(ch2From('home_defeat_broken_heavy'), 'commit');
        const v = JSON.parse(JSON.stringify(toIeyasu2SaveData(m, 'manual', now))) as Record<string, any>;
        v.terms = { ...v.terms, basisTroops: 900, thin: false, holdSec: CH2_TERMS_TABLE.holdSec.normal };
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, JSON.stringify(v));
        const l = new IeyasuCampaignStore(storage).load();
        if (l.status !== 'ok') throw new Error('読めない');
        const s = l.state as Ieyasu2State;
        expect(s.terms!.thin).toBe(false);
        expect(ieyasu2BattleInfo(s).setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: CH2_TERMS_TABLE.holdSec.normal });
        // 読んだだけでは書き換えない
        expect(storage.touched.every((t) => t.op === 'get')).toBe(true);
    });

    it('保存の検査：判断の後は条件が必ずある・判断の前は null・方針や判断と合わない条件は壊れた保存', () => {
        const m = toCh2Muster(ch2From('asai_victory_kept'), 'hold');
        const good = JSON.parse(JSON.stringify(toIeyasu2SaveData(m, 'manual', now))) as Record<string, any>;
        expect(parseIeyasu2SaveData(JSON.stringify(good))).not.toBeNull();
        const bad = (f: (v: Record<string, any>) => void) => {
            const v = JSON.parse(JSON.stringify(good)) as Record<string, any>;
            f(v);
            return parseIeyasu2SaveData(JSON.stringify(v));
        };
        expect(bad((v) => delete v.terms)).toBeNull();
        expect(bad((v) => (v.terms = null))).toBeNull();
        expect(bad((v) => (v.terms.plan = 'commit'))).toBeNull();
        expect(bad((v) => (v.terms.policy = 'home'))).toBeNull();
        expect(bad((v) => (v.terms.escortMinRatio = 0.5))).toBeNull();
        expect(bad((v) => (v.terms.thin = !v.terms.thin))).toBeNull();
        expect(bad((v) => (v.terms.holdSec = 360))).toBeNull();
        expect(bad((v) => (v.terms.basisTroops = -1))).toBeNull();
        expect(bad((v) => (v.terms.basisTroops = 1.5))).toBeNull();
        expect(bad((v) => (v.terms.thin = 'no'))).toBeNull();
        // 城下（判断の前）は null で、条件があれば壊れた保存
        const ex = JSON.parse(JSON.stringify(toIeyasu2SaveData(ch2From('asai_victory_kept'), 'manual', now))) as Record<string, any>;
        expect(ex.terms).toBeNull();
        expect(parseIeyasu2SaveData(JSON.stringify(ex))).not.toBeNull();
        ex.terms = good.terms;
        expect(parseIeyasu2SaveData(JSON.stringify(ex))).toBeNull();
    });
});

describe('二重に適用しない（兵・支援・条件）', () => {
    it('移る処理を 2 回呼んでも同じ。補充は 1 回だけ（連打は FlowError・兵は増えない）。支援は兵に足さない。戦後の反映は 1 回だけ', () => {
        for (const name of CH1_ENDINGS) {
            const a = ch2From(name);
            const b = ch2From(name);
            expect(snapshot(a), name).toEqual(snapshot(b));
            for (const plan of availableCh2Plans(a) as Ch2Plan[]) {
                const m = toCh2Muster(a, plan);
                for (const rec of RECS) {
                    if (!ch2RecoveryOptions(m)[rec].available) continue;
                    const r = finishTalkIeyasu2(m, 'ishikawa', `recovery_${rec}`);
                    expect(() => finishTalkIeyasu2(r, 'ishikawa', `recovery_${rec}`)).toThrow(FlowError);
                    expect(() => finishTalkIeyasu2(r, 'ishikawa', 'recovery_wait')).toThrow(FlowError);
                    expect(finishTalkIeyasu2(r, 'ishikawa').troops).toEqual(r.troops);
                    expect(talkIeyasu2(r, 'ishikawa').choices).toBeUndefined();
                    // 支援：設定を何度作っても兵は増えない（支援は設定の部隊で、徳川の兵に足さない）
                    const i1 = ieyasu2BattleInfo(r);
                    const i2 = ieyasu2BattleInfo(r);
                    expect(snapshot(i1.setup.units)).toEqual(snapshot(i2.setup.units));
                    expect(r.troops).toEqual(finishTalkIeyasu2(m, 'ishikawa', `recovery_${rec}`).troops);
                    for (const k of TOKUGAWA_UNIT_IDS) {
                        const u = i1.setup.units.find((x) => x.id === IEYASU_UNIT_IDS[k]);
                        if (u) expect(u.strength).toBe(k === 'honjin' ? Math.max(CH2_RULES.honjinMin, r.troops[k]) : r.troops[k]);
                    }
                    // 戦後の反映：同じ合戦の id で 2 回目は反映しない
                    const bt = withIeyasu2BattleId(finishTalkIeyasu2(r, 'gate', 'depart'), 'ieyasu1570-d-1');
                    const o = ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(bt), 'victory');
                    const once = applyIeyasu2OutcomeOnce(bt, 'ieyasu1570-d-1', o).state;
                    const twice = applyIeyasu2OutcomeOnce(once, 'ieyasu1570-d-1', o);
                    expect(twice.applied).toBe(false);
                    expect(snapshot(twice.state)).toEqual(snapshot(once));
                }
            }
        }
    }, 60_000);
});
