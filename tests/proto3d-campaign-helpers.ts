/**
 * 第一章の進行のテストで共用する小道具（テストの本体ではない）。
 */
import type { BattleResultKind, UnitStatus } from '../proto3d/src/battle/types';
import { battleSetupFor, finishTalk, newGame, outcomeFromSetup, applyBattleOutcome, talk } from '../proto3d/src/campaign/flow';
import type { Alliance, CampaignState } from '../proto3d/src/campaign/state';
import type { StorageLike } from '../proto3d/src/campaign/save';

export const ALLIANCE_CHOICE = { tashiro: 'ally_tashiro', omori: 'ally_omori', alone: 'ally_alone' } as const;

/** 探索 → 軍議（協力陣営を決める）→ 出陣の支度 まで、普通の会話の順で進める */
export function toMuster(alliance: Alliance, opts: { talkEnvoy?: boolean } = {}): CampaignState {
    let s = newGame();
    s = finishTalk(s, 'shinpachi');
    s = finishTalk(s, 'genzo', 'open_council');
    // 軍議：選ぶ → 確認の台詞 → 決める
    s = finishTalk(s, 'council', ALLIANCE_CHOICE[alliance]);
    const confirm = talk(s, 'council');
    if (!confirm.choices?.some((c) => c.id === 'confirm_alliance')) throw new Error('確認の選択肢が出ない');
    s = finishTalk(s, 'council', 'confirm_alliance');
    if (opts.talkEnvoy && alliance !== 'alone') s = finishTalk(s, alliance === 'tashiro' ? 'tashiro_envoy' : 'omori_envoy');
    return s;
}

/** 城門で出陣する（phase は battle） */
export function toBattle(alliance: Alliance, opts: { talkEnvoy?: boolean } = {}): CampaignState {
    return finishTalk(toMuster(alliance, opts), 'gate', 'depart');
}

/** 合戦を指定の結果で終えて戦後へ */
export function toAftermath(
    alliance: Alliance,
    result: BattleResultKind,
    opts: { talkEnvoy?: boolean; units?: Record<string, { end?: number; status?: UnitStatus }> } = {},
): CampaignState {
    const s = toBattle(alliance, opts);
    const setup = battleSetupFor(s);
    return applyBattleOutcome(s, outcomeFromSetup(setup, result, { units: opts.units }));
}

/** 使ったキーを記録する記憶域 */
export class MemoryStorage implements StorageLike {
    data = new Map<string, string>();
    touched: { op: 'get' | 'set' | 'remove'; key: string }[] = [];
    getItem(k: string): string | null {
        this.touched.push({ op: 'get', key: k });
        return this.data.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
        this.touched.push({ op: 'set', key: k });
        this.data.set(k, v);
    }
    removeItem(k: string): void {
        this.touched.push({ op: 'remove', key: k });
        this.data.delete(k);
    }
}

/** 深い写し（状態を書き換えていないことの確認用） */
export function snapshot<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}
