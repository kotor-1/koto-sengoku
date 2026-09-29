/**
 * 歴史分岐「元亀元年・家康」の通しの経路（e2e/ieyasu-routes.mjs と同じ采配）を、章の進行 → 本物の合戦の計算 → 戦後 → 保存 → 結末で確かめる。
 * - 采配は画面で出せる命令だけ（移動は向きなし・攻撃は見えている敵だけ・能力は画面と同じ useAbility）。
 *   遊ぶ人の反応の遅れとして、1・2・3 秒ごとにしか条件を見ない（e2e は 1 秒ごと）。
 * - 経路 1：A × 約束を引き受ける × 勝利・約束を守る（退路の守護・号令）。
 * - 経路 2：B × 約束を引き受ける × 撤退・約束を守る（盟友への援護・退路の守護）。
 * - 経路 3：C × 約束を引き受けない × 勝利（号令）。
 * - 経路 4：A × 勝利・約束を守れなかった（台本 ieyasuPlanScript('oda','break')）。
 * 合戦は台本で最後まで一気に進める（早送り）。状態の直接の書き換えはしない。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, orderAllRetreat, runToEnd, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { ieyasuPlanScript } from '../proto3d/src/battle/scripts';
import type { BattleOutcome } from '../proto3d/src/battle/types';
import { applyIeyasuOutcomeOnce, finishTalkIeyasu, ieyasuBattleSetup, withIeyasuBattleId } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IeyasuSaveStore } from '../proto3d/src/campaign/ieyasu1570/save';
import type { IeyasuState, Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import { ieyasuEndingView } from '../proto3d/src/campaign/ieyasu1570/story';
import { CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { answerPledge, ieyasuToMuster } from './proto3d-ieyasu-helpers';

type Rule = [key: string, when: (s: BattleState) => boolean, act: (s: BattleState) => boolean];
const U = (s: BattleState, id: string) => unitById(s, id)!;
const alive = (s: BattleState, id: string) => {
    const u = unitById(s, id);
    return !!u && isActive(u);
};
const seen = (s: BattleState, id: string) => alive(s, id) && U(s, id).seenBy.ally;
const broken = (s: BattleState, id: string) => !alive(s, id);
const near = (s: BattleState, a: string, b: string, r: number) => alive(s, a) && alive(s, b) && Math.hypot(U(s, a).x - U(s, b).x, U(s, a).z - U(s, b).z) <= r;
const at = (s: BattleState, id: string, x: number, z: number, r = 6) => alive(s, id) && Math.hypot(U(s, id).x - x, U(s, id).z - z) <= r;
/** 画面の移動（向きなし）。もう目標のすぐ近くなら命令は要らない（e2e と同じ） */
const move = (id: string, x: number, z: number) => (s: BattleState) => (Math.hypot(U(s, id).x - x, U(s, id).z - z) < 10 ? true : issueOrder(s, id, { type: 'move', x, z }));
/** 画面の攻撃（見えている敵だけ押せる） */
const attack = (id: string, t: string) => (s: BattleState) => seen(s, t) && issueOrder(s, id, { type: 'attack', targetId: t });
const free = (s: BattleState, id: string) => U(s, id).order.type !== 'attack' || !alive(s, (U(s, id).order as { targetId: string }).targetId);
const rooted = (s: BattleState, id: string) => {
    const r = s.abilities[id];
    return !!r && r.usedAt !== null && s.t < r.until;
};

/** 経路 1（A・約束を守って勝つ）：e2e の route1 と同じ */
function route1(): Rule[] {
    const sallied = (s: BattleState) => alive(s, 'e_asai_sente') && U(s, 'e_asai_sente').engagedWith === 't_yumi';
    const rules: Rule[] = [
        ['oda-back', () => true, move('a_oda', 25, 135)],
        ['tada-east', () => true, move('t_tadakatsu', 80, 45)],
        ['yumi-east', () => true, move('t_yumi', 45, 75)],
        ['tada-rearguard', (s) => at(s, 't_tadakatsu', 80, 45), (s) => useAbility(s, 't_tadakatsu').ok],
        ['yumi-asa', (s) => seen(s, 'e_asakura') && U(s, 'e_asakura').z > -40, attack('t_yumi', 'e_asakura')],
        ['tada-asa', (s) => seen(s, 'e_asakura') && U(s, 'e_asakura').z > -20 && !rooted(s, 't_tadakatsu'), attack('t_tadakatsu', 'e_asakura')],
        ['hq-asa', (s) => alive(s, 'e_asakura') && U(s, 'e_asakura').engagedWith === 't_tadakatsu', attack('t_honjin', 'e_asakura')],
        ['rally', (s) => alive(s, 'e_asakura') && U(s, 'e_asakura').engagedWith === 't_tadakatsu' && near(s, 't_honjin', 'e_asakura', 60), (s) => useAbility(s, 't_honjin').ok],
        ['hq-back', (s) => broken(s, 'e_asakura'), move('t_honjin', 0, 100)],
        ['tada-wait', (s) => broken(s, 'e_asakura'), move('t_tadakatsu', 75, 60)],
        ['oda-wait', (s) => broken(s, 'e_asakura') && alive(s, 'a_oda') && (s.pledge === null || s.pledge.secured), move('a_oda', -45, 75)],
        ['yumi-sente', (s) => broken(s, 'e_asakura') && seen(s, 'e_asai_sente'), attack('t_yumi', 'e_asai_sente')],
        ['tada-sente', sallied, attack('t_tadakatsu', 'e_asai_sente')],
        ['oda-sente', (s) => sallied(s) && alive(s, 'a_oda'), attack('a_oda', 'e_asai_sente')],
        ['hq-sente', sallied, attack('t_honjin', 'e_asai_sente')],
    ];
    for (const id of ['t_tadakatsu', 't_yumi', 't_honjin', 'a_oda'])
        for (const e of ['e_asai_yumi', 'e_nagamasa']) rules.push([`${id}>${e}`, (s) => broken(s, 'e_asai_sente') && alive(s, id) && seen(s, e) && free(s, id), attack(id, e)]);
    return rules;
}
/** 経路 2（B・撤退して長政隊を救う）：e2e の route2 と同じ */
function route2(): Rule[] {
    const chased = (s: BattleState) =>
        alive(s, 'a_nagamasa') && s.units.some((e) => e.side === 'enemy' && isActive(e) && Math.hypot(e.x - U(s, 'a_nagamasa').x, e.z - U(s, 'a_nagamasa').z) <= 70);
    return [
        ['tada-cover', () => true, move('t_tadakatsu', -45, 40)],
        ['support', (s) => near(s, 'a_nagamasa', 't_tadakatsu', 55), (s) => useAbility(s, 'a_nagamasa', 't_tadakatsu').ok],
        ['naga-out', (s) => (s.abilities.a_nagamasa?.usedAt ?? null) !== null && s.t > 20, (s) => issueOrder(s, 'a_nagamasa', { type: 'retreat' })],
        ['rearguard', (s) => chased(s) && near(s, 't_tadakatsu', 'a_nagamasa', 70) && U(s, 'a_nagamasa').order.type === 'retreat', (s) => useAbility(s, 't_tadakatsu').ok],
        ['all-out', (s) => broken(s, 'a_nagamasa'), (s) => orderAllRetreat(s)],
    ];
}
/** 経路 3（C・約束なしで勝つ）：e2e の route3 と同じ */
function route3(): Rule[] {
    const sallied = (s: BattleState) => alive(s, 'e_ronin_yari') && U(s, 'e_ronin_yari').engagedWith === 't_yumi';
    const kibaFighting = (s: BattleState) => alive(s, 'e_ronin_kiba') && ['t_tadakatsu', 't_yumi'].includes(U(s, 'e_ronin_kiba').engagedWith ?? '');
    const rules: Rule[] = [
        ['tada-west', () => true, move('t_tadakatsu', -45, 55)],
        ['yumi-back', () => true, move('t_yumi', -5, 85)],
        ['tada-kiba', (s) => seen(s, 'e_ronin_kiba'), attack('t_tadakatsu', 'e_ronin_kiba')],
        ['yumi-kiba', (s) => seen(s, 'e_ronin_kiba'), attack('t_yumi', 'e_ronin_kiba')],
        ['hq-kiba', kibaFighting, attack('t_honjin', 'e_ronin_kiba')],
        ['hq-back', (s) => broken(s, 'e_ronin_kiba'), move('t_honjin', 0, 100)],
        ['tada-wait', (s) => broken(s, 'e_ronin_kiba'), move('t_tadakatsu', -45, 75)],
        ['res-wait', (s) => broken(s, 'e_ronin_kiba') && alive(s, 't_reserve'), move('t_reserve', 50, 80)],
        ['yumi-yari', (s) => broken(s, 'e_ronin_kiba') && seen(s, 'e_ronin_yari'), attack('t_yumi', 'e_ronin_yari')],
        ['tada-yari', sallied, attack('t_tadakatsu', 'e_ronin_yari')],
        ['res-yari', (s) => sallied(s) && alive(s, 't_reserve'), attack('t_reserve', 'e_ronin_yari')],
        ['hq-yari', sallied, attack('t_honjin', 'e_ronin_yari')],
        ['rally', (s) => sallied(s) && near(s, 't_honjin', 't_yumi', 90), (s) => useAbility(s, 't_honjin').ok],
    ];
    // 槍を崩したら、忠勝隊・弓・守備隊で残りを攻める（本陣は陣に残す）
    for (const id of ['t_tadakatsu', 't_yumi', 't_reserve'])
        for (const e of ['e_ronin_yumi', 'e_ronin_hq']) rules.push([`${id}>${e}`, (s) => broken(s, 'e_ronin_yari') && alive(s, id) && seen(s, e) && free(s, id), attack(id, e)]);
    return rules;
}

/** 条件を period 秒ごとにだけ見て（反応の遅れ）、そろった采配を出しながら最後まで進める */
function drive(setupState: IeyasuState, rules: Rule[], period: number): { o: BattleOutcome; fired: string[] } {
    const s = createBattle(ieyasuBattleSetup(setupState));
    const done = new Set<string>();
    const fired: string[] = [];
    for (let i = 0; i < 100000 && !s.result; i++) {
        for (const [k, when, act] of rules) {
            if (done.has(k) || !when(s)) continue;
            if (act(s)) {
                done.add(k);
                fired.push(k);
            }
        }
        const end = s.t + period;
        while (s.t < end - 1e-9 && !s.result) stepBattle(s, 0.1);
    }
    return { o: s.result!, fired };
}

function toBattle(policy: Policy, answer: 'accept' | 'decline'): IeyasuState {
    const s = finishTalkIeyasu(answerPledge(ieyasuToMuster(policy), answer), 'gate', 'depart');
    return withIeyasuBattleId(s, `ieyasu1570-test-${policy}`);
}

const ROUTES = [
    { name: '経路 1：A × 約束を引き受ける → 勝利・約束を守った', policy: 'oda' as Policy, answer: 'accept' as const, plan: route1, result: 'victory', pledge: 'kept', abilities: ['t_honjin', 't_tadakatsu'], trust: { oda: 70, asai: -5, tadakatsu: 45, sakai: 45, ishikawa: 45, sakakibara: 40 }, reinforcement: true, ending: 'oda_victory' },
    { name: '経路 2：B × 約束を引き受ける → 撤退・約束を守った（退いたが味方を救った）', policy: 'asai' as Policy, answer: 'accept' as const, plan: route2, result: 'retreat', pledge: 'kept', abilities: ['a_nagamasa', 't_tadakatsu'], trust: { oda: 0, asai: 35, tadakatsu: 40, sakai: 40, ishikawa: 45, sakakibara: 40 }, reinforcement: true, ending: 'retreat' },
    { name: '経路 3：C × 約束を引き受けない → 勝利（中立）', policy: 'home' as Policy, answer: 'decline' as const, plan: route3, result: 'victory', pledge: 'declined', abilities: ['t_honjin'], trust: { oda: 20, asai: 10, tadakatsu: 45, sakai: 45, ishikawa: 40, sakakibara: 40 }, reinforcement: false, ending: 'home_victory' },
];

describe('通しの経路の采配（画面で出せる命令だけ・反応の遅れ 1〜3 秒）', () => {
    for (const r of ROUTES) {
        for (const period of [1, 2, 3]) {
            it(`${r.name}（${period} 秒ごと）`, () => {
                const s = toBattle(r.policy, r.answer);
                const { o, fired } = drive(s, r.plan(), period);
                expect(o.result).toBe(r.result);
                if (r.pledge === 'declined') expect(o.pledge).toBeUndefined();
                else expect(o.pledge?.result).toBe(r.pledge);
                // 画面から使った能力（味方の分）は記録に残る。敵方の能力（A の長政）は敵の考えが使う
                for (const id of r.abilities) expect(o.abilitiesUsed?.[id]).toBeTypeOf('number');
                expect(fired.length).toBeGreaterThan(3);
            });
        }
    }
});

describe('通しの経路：戦後・保存・開き直し・結末（本物の合戦の計算の結果）', () => {
    const cases = [
        ...ROUTES.map((r) => ({ ...r, run: (s: IeyasuState) => drive(s, r.plan(), 1).o })),
        {
            name: '経路 4：A × 約束を引き受ける → 勝利・約束を守れなかった（台本）',
            policy: 'oda' as Policy,
            answer: 'accept' as const,
            run: (s: IeyasuState) => runToEnd(createBattle(ieyasuBattleSetup(s)), ieyasuPlanScript('oda', 'break')),
            result: 'victory',
            pledge: 'broken',
            trust: { oda: 20, asai: -5, tadakatsu: 45, sakai: 45, ishikawa: 35, sakakibara: 40 },
            reinforcement: false,
            ending: 'oda_victory',
        },
    ];
    for (const c of cases) {
        it(c.name, () => {
            const storage = new MemoryStorage();
            storage.data.set(LEGACY_2D_SAVE_KEY, 'legacy-2d');
            storage.data.set(CAMPAIGN_SAVE_KEY, 'fictional-untouched');
            const store = new IeyasuSaveStore(storage);
            const before = toBattle(c.policy, c.answer);
            const o = c.run(before);
            expect(o.result).toBe(c.result);
            // 決着の時点：1 回だけ反映して保存（game.ts の onDecided と同じ順）
            const first = applyIeyasuOutcomeOnce(before, before.battleId!, o);
            expect(first.applied).toBe(true);
            const saved = store.save(first.state, 'aftermath');
            expect(saved.ok).toBe(true);
            const s = first.state;
            expect(s.phase).toBe('aftermath');
            expect(s.battle?.result).toBe(c.result);
            expect(s.pledge?.result).toBe(c.pledge);
            expect(s.trust).toEqual(c.trust);
            expect(s.support?.reinforcement).toBe(c.reinforcement);
            // 同じ合戦の結果がもう一度来ても（結果の画面の「続ける」・開き直し）、反映しない
            const again = applyIeyasuOutcomeOnce(s, before.battleId!, o);
            expect(again.applied).toBe(false);
            expect(again.state).toBe(s);
            // 開き直す：勝敗・約束の結果・信頼・兵・支援がそのまま
            const loaded = new IeyasuSaveStore(storage).load();
            expect(loaded.status).toBe('ok');
            if (loaded.status !== 'ok') return;
            const back = loaded.state;
            expect(back.phase).toBe('aftermath');
            expect(back.battle?.result).toBe(c.result);
            expect(back.battle?.pledge?.result ?? 'declined').toBe(c.pledge);
            expect(back.pledge).toEqual(s.pledge);
            expect(back.trust).toEqual(s.trust);
            expect(back.troops).toEqual(s.troops);
            expect(back.support).toEqual(s.support);
            expect(applyIeyasuOutcomeOnce(back, before.battleId!, o).applied).toBe(false);
            // 結末
            const end = finishTalkIeyasu(back, 'tadakatsu', 'end_chapter');
            expect(end.ending).toBe(c.ending);
            const view = ieyasuEndingView(end);
            expect(view.record.map((x) => x.label)).toEqual(expect.arrayContaining(['方針', '合戦の結果', '約束', '信頼', '徳川の兵', '支援']));
            // ほかの保存には触れない
            expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe('fictional-untouched');
            expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe('legacy-2d');
        });
    }
});
