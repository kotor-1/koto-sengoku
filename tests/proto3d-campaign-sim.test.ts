/**
 * 章の進行と合戦のルールのつなぎ：battleSetupFor の設定で実際の合戦の計算（battle/sim.ts）を最後まで回し、
 * その結果を applyBattleOutcome → 戦後の保存 → 結末 まで通せること（台本は簡単な物。釣り合いは battle 側のテストで見る）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, orderAllRetreat, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { applyBattleOutcome, battleSetupFor, endingFor, finishTalk, presentTalks, talk } from '../proto3d/src/campaign/flow';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import { ALLIANCES } from '../proto3d/src/campaign/state';
import { endingView } from '../proto3d/src/campaign/story';
import { MemoryStorage, toBattle } from './proto3d-campaign-helpers';

type Plan = (s: BattleState) => void;
const plans: Record<string, Plan> = {
    /** 何もしない */
    hold: () => {},
    /** 10 秒で全軍撤退 */
    retreat: (s) => {
        if (s.t >= 10 && s.allRetreatAt === null) orderAllRetreat(s);
    },
    /** 本陣以外が見えている敵へ正面から攻めかかる */
    frontal: (s) => {
        for (const u of s.units) {
            if (u.side !== 'ally' || u.isHq || !isActive(u) || u.order.type === 'attack') continue;
            const t = s.units.find((e) => e.side === 'enemy' && isActive(e) && e.seenBy.ally);
            if (t) issueOrder(s, u.id, { type: 'attack', targetId: t.id });
        }
    },
};

describe('章の進行 × 実際の合戦の計算', () => {
    for (const al of ALLIANCES) {
        for (const [name, plan] of Object.entries(plans)) {
            it(`${al}・${name}：合戦の結果を戦後・保存・結末までつなげる`, () => {
                const b = toBattle(al);
                const setup = battleSetupFor(b);
                const outcome = runToEnd(createBattle(setup), plan, 900);
                if (name === 'retreat') expect(outcome.result).toBe('retreat');
                const a = applyBattleOutcome(b, outcome);
                expect(a.phase).toBe('aftermath');
                // 琴坂家の兵は合戦の最後の兵
                for (const u of outcome.units.filter((x) => x.clan === 'kotosaka' && x.side === 'ally')) {
                    const k = ({ a_hq: 'honjin', a_genzo: 'genzo', a_shinpachi: 'shinpachi', a_reserve: 'reserve' } as const)[u.id as 'a_hq'];
                    expect(a.troops[k]).toBe(u.endStrength);
                }
                // 戦後の保存 → 読み込み → 会話 → 結末
                const store = new CampaignSaveStore(new MemoryStorage());
                expect(store.save(a, 'aftermath').ok).toBe(true);
                const l = store.load();
                if (l.status !== 'ok') throw new Error(l.status);
                for (const id of presentTalks(l.state)) expect(talk(l.state, id).lines.length).toBeGreaterThan(0);
                const e = finishTalk(l.state, 'genzo', 'end_chapter');
                expect(e.ending).toBe(endingFor(a));
                expect(endingView(e).body.length).toBeGreaterThan(0);
            });
        }
    }
});
