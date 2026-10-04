/**
 * 合戦場の演習（proto3d/src/campaign/practice.ts）：記録の保存（往復・ほかのキーに触れない・壊れた保存の退避）、
 * 一覧・説明・結果の中身、画面の流れ（偽の画面・本物の合戦の計算）、タイトルの入口（campaign/game.ts）。
 */
import { describe, expect, it } from 'vitest';
import type { BattleOutcome, BattleSetup } from '../proto3d/src/battle/types';
import { RULES, createBattle, orderAllRetreat, runToEnd, stepBattle } from '../proto3d/src/battle/sim';
import { PRACTICE_ORDER, getField } from '../proto3d/src/battle/fields';
import {
    PRACTICE_BROKEN_KEY,
    PRACTICE_SAVE_KEY,
    PracticeMode,
    PracticeRecordStore,
    isBetterRecord,
    parsePracticeData,
    practiceBriefingInfo,
    practiceListInfo,
    practiceSetup,
    recordFromOutcome,
    type PracticeBriefingInfo,
    type PracticeListAction,
    type PracticeListInfo,
    type PracticeResultInfo,
    type PracticeResultRecord,
    type PracticeRunner,
    type PracticeView,
} from '../proto3d/src/campaign/practice';
import { ChapterGame, type GameView, type GameWorld, type TitleAction, type TitleInfo } from '../proto3d/src/campaign/game';
import { CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import { IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { fictionalScenario } from '../proto3d/src/campaign/fictional';
import { MemoryStorage } from './proto3d-campaign-helpers';

const AT = new Date('2026-09-29T08:00:00.000Z');

function rec(p: Partial<PracticeResultRecord> = {}): PracticeResultRecord {
    return {
        result: 'victory',
        reason: 'objective_done',
        primary: { id: 'plains_hq', achieved: true },
        secondary: [{ id: 'plains_reserve', label: '予備隊', achieved: false }],
        elapsedSec: 300,
        at: AT.toISOString(),
        ...p,
    };
}

/** 本物の合戦の計算で 1 回（全軍撤退を早めに命じる＝撤退で終わる。script を渡せば差し替え） */
function fightReal(setup: BattleSetup, script?: Parameters<typeof runToEnd>[1]): BattleOutcome {
    const b = createBattle(setup);
    return runToEnd(
        b,
        script ??
            ((s) => {
                if (s.t >= 3 && s.allRetreatAt === null) orderAllRetreat(s);
            }),
    );
}

async function flush(n = 30): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

// ---------------------------------------------------------------- 保存

describe('演習の記録の保存（koto-sengoku/3d-fields 版 1）', () => {
    it('書いて読み戻す：回数・最後・最高が入り、形を読み直せる', () => {
        const storage = new MemoryStorage();
        const store = new PracticeRecordStore(storage);
        expect(store.load()).toEqual({ status: 'none' });
        const r1 = store.record('plains', rec({ result: 'defeat', reason: 'ally_hq_routed', primary: { id: 'plains_hq', achieved: false } }));
        expect(r1.ok).toBe(true);
        const r2 = store.record('plains', rec());
        expect(r2.ok && r2.isBest).toBe(true);
        const r3 = store.record('plains', rec({ result: 'retreat', reason: 'ordered_retreat', primary: { id: 'plains_hq', achieved: false } }));
        expect(r3.ok && r3.isBest).toBe(false);
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        const pr = l.data.records.plains!;
        expect(pr.plays).toBe(3);
        expect(pr.last.result).toBe('retreat');
        expect(pr.best.result).toBe('victory');
        expect(pr.best.primary).toEqual({ id: 'plains_hq', achieved: true });
        expect(pr.best.secondary).toEqual([{ id: 'plains_reserve', label: '予備隊', achieved: false }]);
        // 保存の形（版 1）
        const raw = JSON.parse(storage.data.get(PRACTICE_SAVE_KEY)!);
        expect(raw.version).toBe(1);
        expect(Object.keys(raw.records)).toEqual(['plains']);
        expect(Object.keys(raw.records.plains).sort()).toEqual(['best', 'last', 'plays']);
        expect(Object.keys(raw.records.plains.last).sort()).toEqual(['at', 'elapsedSec', 'primary', 'reason', 'result', 'secondary']);
        // 別の戦場は別の記録
        store.record('forest', rec({ primary: { id: 'forest_hq', achieved: true }, secondary: [] }));
        const l2 = store.load();
        expect(l2.status === 'ok' && Object.keys(l2.data.records).sort()).toEqual(['forest', 'plains']);
    });

    it('ほかのキー（章の保存・2D 版）には触れない。読み書きは演習のキーだけ', () => {
        const storage = new MemoryStorage();
        storage.data.set(LEGACY_2D_SAVE_KEY, '{"2d":true}');
        storage.data.set(CAMPAIGN_SAVE_KEY, '{"chapter1":true}');
        storage.data.set(IEYASU_SAVE_KEY, '{"ieyasu":true}');
        storage.data.set('koto-sengoku/3d-chapter1/previous', 'x');
        const before = new Map(storage.data);
        const store = new PracticeRecordStore(storage);
        store.load();
        store.record('plains', rec());
        store.record('plains', rec());
        store.load();
        for (const [k, v] of before) expect(storage.data.get(k)).toBe(v);
        expect(new Set(storage.touched.map((t) => t.key))).toEqual(new Set([PRACTICE_SAVE_KEY]));
        expect(storage.touched.some((t) => t.op === 'remove')).toBe(false);
    });

    it('章・2D 版のキーでは作れない', () => {
        expect(() => new PracticeRecordStore(new MemoryStorage(), LEGACY_2D_SAVE_KEY)).toThrow();
        expect(() => new PracticeRecordStore(new MemoryStorage(), PRACTICE_SAVE_KEY, CAMPAIGN_SAVE_KEY)).toThrow();
    });

    it('壊れた保存：上書きせず控え（/broken）へ写してから新しく作る', () => {
        for (const bad of ['{not json', '{"version":2,"records":{}}', '{"version":1,"records":{"plains":{"plays":0}}}', '[]']) {
            const storage = new MemoryStorage();
            storage.data.set(PRACTICE_SAVE_KEY, bad);
            const store = new PracticeRecordStore(storage);
            expect(store.load().status).toBe('corrupt');
            // 読むだけでは何も書かない
            expect(storage.data.has(PRACTICE_BROKEN_KEY)).toBe(false);
            const r = store.record('hills', rec());
            expect(r.ok && r.movedBroken).toBe(true);
            expect(storage.data.get(PRACTICE_BROKEN_KEY)).toBe(bad);
            const l = store.load();
            expect(l.status === 'ok' && l.data.records.hills?.plays).toBe(1);
        }
    });

    it('控えへ写せないときは、元のデータを上書きしない', () => {
        class NoBroken extends MemoryStorage {
            override setItem(k: string, v: string): void {
                if (k === PRACTICE_BROKEN_KEY) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
                super.setItem(k, v);
            }
        }
        const storage = new NoBroken();
        storage.data.set(PRACTICE_SAVE_KEY, '{broken');
        const r = new PracticeRecordStore(storage).record('plains', rec());
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe('backup');
        expect(storage.data.get(PRACTICE_SAVE_KEY)).toBe('{broken');
    });

    it('読み戻しが違えば失敗として扱う・保存領域が無ければ unavailable', () => {
        class Lossy extends MemoryStorage {
            override getItem(k: string): string | null {
                const v = super.getItem(k);
                return v && this.data.size && this.touched.filter((t) => t.op === 'set').length > 0 ? v.replace('victory', 'defeat') : v;
            }
        }
        const r = new PracticeRecordStore(new Lossy()).record('plains', rec());
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe('verify');
        const none = new PracticeRecordStore(null);
        expect(none.available).toBe(false);
        expect(none.load().status).toBe('unavailable');
        expect(none.record('plains', rec()).ok).toBe(false);
    });

    it('知らない戦場の記録も消さずに残す', () => {
        const storage = new MemoryStorage();
        const store = new PracticeRecordStore(storage);
        store.record('future_field', rec({ primary: { id: 'x', achieved: true } }));
        store.record('plains', rec());
        const d = parsePracticeData(storage.data.get(PRACTICE_SAVE_KEY)!)!;
        expect(Object.keys(d.records).sort()).toEqual(['future_field', 'plains']);
    });

    it('脱出・離脱：count より多くの部隊が離れても、記録の数は total を超えず、保存して読み戻せる（状態を直接操作）', () => {
        for (const fid of ['besieged_camp', 'rearguard']) {
            const f = getField(fid)!;
            const b = createBattle(practiceSetup(f));
            const prim = f.objectives.primary;
            if (prim.type !== 'escape' && prim.type !== 'withdraw') throw new Error(fid);
            const ex = prim.type === 'escape' ? prim.exits[0]! : prim.exit;
            const c = ex.rect ? { x: (ex.rect.x0 + ex.rect.x1) / 2, z: (ex.rect.z0 + ex.rect.z1) / 2 } : { x: ex.circle!.cx, z: ex.circle!.cz };
            const step = (sec: number) => {
                for (let i = 0; i < Math.round(sec / RULES.tick) && !b.result; i++) stepBattle(b, RULES.tick);
            };
            // 総大将より先に、ほかの味方をすべて出口へ置く（count より多い）→ 後から総大将
            const others = b.units.filter((u) => u.side === 'ally' && !u.isHq);
            expect(others.length).toBeGreaterThan(prim.count);
            for (const u of others) {
                u.x = c.x;
                u.z = c.z;
            }
            step(1);
            const h = b.units.find((u) => u.side === 'ally' && u.isHq)!;
            h.x = c.x;
            h.z = c.z;
            step(1);
            const o = b.result!;
            expect(o.objectives!.primary).toMatchObject({ achieved: true, count: { done: prim.count + 1, total: prim.count + 1 } });
            const storage = new MemoryStorage();
            const store = new PracticeRecordStore(storage);
            const r = store.record(fid, recordFromOutcome(o, prim.id, AT));
            expect(r.ok).toBe(true);
            const l = store.load();
            expect(l.status).toBe('ok');
            expect(l.status === 'ok' && l.data.records[fid]!.best.primary.count).toEqual({ done: prim.count + 1, total: prim.count + 1 });
        }
    });

    it('前の版で出来た数の欄が範囲の外の記録（done > total）も読める：数は total に詰め、記録全体は捨てない。読めない形の数の欄は省く', () => {
        const over = rec({ primary: { id: 'besieged_escape', achieved: true, type: 'escape', count: { done: 6, total: 4 } } });
        const bad = rec({ primary: { id: 'rg_withdraw', achieved: false, type: 'withdraw', count: { done: -1, total: 'x' } as unknown as { done: number; total: number } } });
        const json = JSON.stringify({
            version: 1,
            records: { besieged_camp: { plays: 2, last: over, best: over }, rearguard: { plays: 1, last: bad, best: bad }, plains: { plays: 1, last: rec(), best: rec() } },
        });
        const storage = new MemoryStorage();
        storage.setItem(PRACTICE_SAVE_KEY, json);
        const store = new PracticeRecordStore(storage);
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        expect(l.data.records.besieged_camp!.best.primary).toEqual({ id: 'besieged_escape', achieved: true, type: 'escape', count: { done: 4, total: 4 } });
        expect(l.data.records.rearguard!.best.primary).toEqual({ id: 'rg_withdraw', achieved: false, type: 'withdraw' });
        expect(l.data.records.plains!.plays).toBe(1);
        // 次の保存でも控えへ退かさず、ほかの戦場の記録を残したまま足す
        const r = store.record('plains', rec());
        expect(r.ok).toBe(true);
        expect(storage.data.has(PRACTICE_BROKEN_KEY)).toBe(false);
        const l2 = store.load();
        expect(l2.status === 'ok' && Object.keys(l2.data.records).sort()).toEqual(['besieged_camp', 'plains', 'rearguard']);
    });

    it('最高の記録の比べ方：勝敗 → 主目標 → 副目標の数 → 勝利どうしは早い方', () => {
        const win = rec();
        expect(isBetterRecord(win, rec({ result: 'retreat', reason: 'nightfall' }))).toBe(true);
        expect(isBetterRecord(rec({ result: 'retreat', reason: 'nightfall' }), rec({ result: 'defeat', reason: 'ally_hq_routed' }))).toBe(true);
        expect(isBetterRecord(rec({ secondary: [{ id: 's', label: 's', achieved: true }] }), win)).toBe(true);
        expect(isBetterRecord(rec({ elapsedSec: 200 }), win)).toBe(true);
        expect(isBetterRecord(rec({ elapsedSec: 300 }), win)).toBe(false);
        expect(isBetterRecord(win, rec({ elapsedSec: 200 }))).toBe(false);
    });
});

// ---------------------------------------------------------------- 画面の中身

describe('演習の一覧・説明・結果の中身', () => {
    it('一覧は 5 戦場を演習の順に、主目標・副目標・記録つきで並べ、架空の相手と明示する', () => {
        const storage = new MemoryStorage();
        const store = new PracticeRecordStore(storage);
        store.record('river_ford', rec({ primary: { id: 'ford_hold', achieved: true }, secondary: [{ id: 'ford_losses', label: '損害', achieved: true }] }));
        const info = practiceListInfo(store.load());
        expect(info.fields.map((f) => f.id)).toEqual([...PRACTICE_ORDER]);
        expect(info.note).toContain('架空の相手');
        expect(info.problem).toBeNull();
        for (const f of info.fields) {
            const def = getField(f.id)!;
            expect(f.name).toBe(def.name);
            expect(f.primary).toBe(def.objectives.primary.label);
            expect(f.secondary).toEqual(def.objectives.secondary.map((o) => o.label));
        }
        const rf = info.fields.find((f) => f.id === 'river_ford')!;
        expect(rf.plays).toBe(1);
        expect(rf.last).toContain('勝利');
        expect(rf.best).toContain('副目標 1/1');
        expect(info.fields.find((f) => f.id === 'plains')!.last).toBeNull();
        // 壊れた保存は理由を出し、記録なしで並べる
        storage.data.set(PRACTICE_SAVE_KEY, '{bad');
        const bad = practiceListInfo(store.load());
        expect(bad.problem).toContain('読み込めません');
        expect(bad.fields.every((f) => f.last === null)).toBe(true);
    });

    it('説明：目標・決まり・編成（武将・能力・仮の印・援軍）', () => {
        for (const id of PRACTICE_ORDER) {
            const b = practiceBriefingInfo(getField(id)!);
            expect(b.note).toContain('架空の相手');
            expect(b.terrain.length).toBeGreaterThan(0);
            expect(b.allies.length).toBeGreaterThanOrEqual(4);
            expect(b.enemies).toMatch(/^敵勢（架空の相手）\d+ 部隊/);
            expect(b.allies.find((u) => u.id === 'a_ieyasu')?.general).toBe('徳川家康');
        }
        const plains = practiceBriefingInfo(getField('plains')!);
        expect(plains.allies).toHaveLength(7);
        expect(plains.rules).toEqual([]);
        const ieyasu = plains.allies.find((u) => u.id === 'a_ieyasu')!;
        expect(ieyasu.ability).toEqual({ name: '立て直しの号令', provisional: false });
        const sakai = plains.allies.find((u) => u.id === 'a_sakai')!;
        expect(sakai.general).toBe('酒井忠次');
        expect(sakai.ability?.provisional).toBe(true);
        expect(plains.allies.find((u) => u.id === 'a_yumi')!.ability).toBeNull();
        expect(practiceBriefingInfo(getField('river_ford')!).rules.join()).toContain('浅瀬');
        expect(practiceBriefingInfo(getField('forest')!).rules.join()).toContain('林の奇襲');
        expect(practiceBriefingInfo(getField('mountain_pass')!).rules.join()).toContain('狭い正面');
        const pass = practiceBriefingInfo(getField('mountain_pass')!);
        expect(pass.allies.filter((u) => u.arriveAt !== null).map((u) => u.id).sort()).toEqual(['a_ishikawa', 'a_sakakibara']);
    });

    it('記録の形：主目標の id と達成、副目標を 1 つずつ（本物の合戦の結果から）', () => {
        const field = getField('plains')!;
        const o = fightReal(practiceSetup(field));
        const r = recordFromOutcome(o, field.objectives.primary.id, AT);
        expect(r.result).toBe(o.result);
        expect(r.primary.id).toBe('plains_hq');
        expect(r.primary.achieved).toBe(o.result === 'victory');
        expect(r.secondary.map((s) => s.id)).toEqual(['plains_reserve']);
        expect(r.at).toBe(AT.toISOString());
    });
});

// ---------------------------------------------------------------- 画面の流れ

type PReq =
    | { kind: 'list'; info: PracticeListInfo; answer: (a: PracticeListAction) => void }
    | { kind: 'briefing'; info: PracticeBriefingInfo; answer: (a: 'go' | 'back') => void }
    | { kind: 'failed'; message: string; answer: (a: 'retry' | 'back') => void }
    | { kind: 'result'; info: PracticeResultInfo; answer: () => void };

class FakePracticeView implements PracticeView {
    reqs: PReq[] = [];
    practiceList(info: PracticeListInfo) {
        return new Promise<PracticeListAction>((answer) => this.reqs.push({ kind: 'list', info, answer }));
    }
    practiceBriefing(info: PracticeBriefingInfo) {
        return new Promise<'go' | 'back'>((answer) => this.reqs.push({ kind: 'briefing', info, answer }));
    }
    practiceLoadFailed(message: string) {
        return new Promise<'retry' | 'back'>((answer) => this.reqs.push({ kind: 'failed', message, answer }));
    }
    practiceResult(info: PracticeResultInfo) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'result', info, answer }));
    }
    loadingLog: boolean[] = [];
    practiceLoading(on: boolean) {
        this.loadingLog.push(on);
    }
    take<K extends PReq['kind']>(kind: K): Extract<PReq, { kind: K }> {
        const r = this.reqs.shift();
        if (!r || r.kind !== kind) throw new Error(`${kind} を待ったが ${r?.kind ?? 'なし'}`);
        return r as Extract<PReq, { kind: K }>;
    }
}

describe('演習の画面の流れ（一覧 → 説明 → 合戦 → 結果 → 一覧）', () => {
    it('大平原を選んで出陣 → 合戦の設定は戦場のデータから → 決着で 1 回だけ保存 → 結果 → 一覧 → 戻る', async () => {
        const storage = new MemoryStorage();
        const store = new PracticeRecordStore(storage);
        const view = new FakePracticeView();
        const setups: BattleSetup[] = [];
        let decidedNote: { ok: boolean; text: string } | null = null;
        const runner: PracticeRunner = async (setup, hooks) => {
            setups.push(setup);
            const o = fightReal(setup);
            decidedNote = hooks?.onDecided?.(o) ?? null;
            // 2 回呼ばれても 2 回は保存しない
            hooks?.onDecided?.(o);
            return o;
        };
        const mode = new PracticeMode({ view, store, battleRunner: async () => runner, now: () => AT });
        const done = mode.run();
        await flush();
        expect(mode.screen).toBe('list');
        // 戻る（説明から）
        view.take('list').answer('field:plains');
        await flush();
        expect(mode.screen).toBe('briefing');
        expect(mode.fieldId).toBe('plains');
        view.take('briefing').answer('back');
        await flush();
        expect(mode.screen).toBe('list');
        expect(setups).toHaveLength(0);
        // 出陣
        view.take('list').answer('field:plains');
        await flush();
        const br = view.take('briefing');
        expect(br.info.name).toBe('大平原');
        br.answer('go');
        await flush(200);
        expect(setups).toHaveLength(1);
        expect(setups[0]!.map.id).toBe('plains');
        expect(setups[0]!.objectives?.primary?.type).toBe('destroy_hq');
        expect(setups[0]!.units.some((u) => u.clan === 'rival')).toBe(true);
        expect(decidedNote!.ok).toBe(true);
        const res = view.take('result');
        expect(mode.screen).toBe('result');
        expect(res.info.saved.ok).toBe(true);
        expect(res.info.primary.label).toBe('敵勢の本陣を崩す');
        expect(res.info.secondary).toHaveLength(1);
        expect(res.info.resultLabel).toBe({ victory: '勝利', defeat: '敗北', retreat: '撤退' }[res.info.result]);
        expect(res.info.reasonText.length).toBeGreaterThan(0);
        const l = store.load();
        expect(l.status === 'ok' && l.data.records.plains?.plays).toBe(1);
        expect(storage.touched.filter((t) => t.op === 'set').every((t) => t.key === PRACTICE_SAVE_KEY)).toBe(true);
        res.answer();
        await flush();
        const list2 = view.take('list');
        expect(list2.info.fields.find((f) => f.id === 'plains')!.plays).toBe(1);
        list2.answer('back');
        await done;
        expect(mode.screen).toBe('closed');
    });

    it('合戦の画面を読み込めない：「もう一度」で出陣し直し、「戻る」で一覧へ（記録は書かない）', async () => {
        const storage = new MemoryStorage();
        const view = new FakePracticeView();
        let tries = 0;
        const runner: PracticeRunner = async (setup, hooks) => {
            const o = fightReal(setup);
            hooks?.onDecided?.(o);
            return o;
        };
        const mode = new PracticeMode({
            view,
            store: new PracticeRecordStore(storage),
            battleRunner: async () => {
                tries++;
                if (tries === 1) return null;
                if (tries === 2) throw new Error('通信の失敗');
                return runner;
            },
        });
        const done = mode.run();
        await flush();
        view.take('list').answer('field:river_ford');
        await flush();
        view.take('briefing').answer('go');
        await flush();
        const f1 = view.take('failed');
        expect(f1.message).toContain('読み込めません');
        f1.answer('retry');
        await flush();
        const f2 = view.take('failed');
        expect(f2.message).toBe('通信の失敗');
        expect(storage.data.has(PRACTICE_SAVE_KEY)).toBe(false);
        f2.answer('back');
        await flush();
        expect(mode.screen).toBe('list');
        view.take('list').answer('field:river_ford');
        await flush();
        view.take('briefing').answer('go');
        await flush(200);
        const res = view.take('result');
        expect(res.info.fieldId).toBe('river_ford');
        res.answer();
        await flush();
        view.take('list').answer('back');
        await done;
        expect(tries).toBe(3);
        // 読み込みの待ちの表示は、出したら必ず消す（読み込めなかったときも）
        expect(view.loadingLog).toEqual([true, false, true, false, true, false]);
    });
});

// ---------------------------------------------------------------- タイトルの入口

class TitleOnlyView implements GameView {
    titles: TitleInfo[] = [];
    answers: TitleAction[] = [];
    pending: ((a: TitleAction) => void) | null = null;
    title(info: TitleInfo) {
        this.titles.push(info);
        return new Promise<TitleAction>((r) => (this.pending = r));
    }
    script(): Promise<string | null> {
        throw new Error('会話は出ない');
    }
    confirm(): Promise<string> {
        throw new Error('確認は出ない');
    }
    menu(): Promise<never> {
        throw new Error('メニューは出ない');
    }
    ending(): Promise<void> {
        throw new Error('結末は出ない');
    }
    hud() {}
    prompt() {}
    intro() {}
    toast() {}
    abandon() {}
}
const world: GameWorld = { setCast() {}, heroPose: () => ({ x: 0, z: 0, heading: 0 }), setHeroPose() {}, setControl() {}, walls: () => [] };

describe('タイトルの「合戦場の演習」', () => {
    it('practice があるときだけ入口を出し、選ぶと演習 → 終わればタイトルへ（章の状態・保存に触れない）', async () => {
        const storage = new MemoryStorage();
        const store = new CampaignSaveStore(storage);
        const view = new TitleOnlyView();
        let practiced = 0;
        let screenDuring: string | null = null;
        let release: () => void = () => {};
        const game = new ChapterGame({
            view,
            world,
            store,
            scenarios: [ieyasuScenario(storage), fictionalScenario(store)],
            battleRunner: async () => null,
            practice: () =>
                new Promise<void>((r) => {
                    practiced++;
                    screenDuring = game.screen;
                    release = r;
                }),
        });
        void game.start();
        await flush();
        expect(view.titles[0]!.practice).toBe(true);
        expect(view.titles[0]!.scenarios.map((s) => s.id)).toEqual(['ieyasu1570', 'fictional']);
        const touchedBefore = storage.touched.length;
        view.pending!('practice');
        await flush();
        expect(practiced).toBe(1);
        expect(screenDuring).toBe('practice');
        expect(game.state).toBeNull();
        release();
        await flush();
        expect(view.titles).toHaveLength(2);
        expect(game.screen).toBe('title');
        expect(game.state).toBeNull();
        // タイトルに戻るとき、シナリオの保存は読むだけ（書かない）
        expect(storage.touched.slice(touchedBefore).every((t) => t.op === 'get')).toBe(true);
        // 入口の無いゲーム（practice を渡さない）は TitleInfo に practice を入れない
        const v2 = new TitleOnlyView();
        void new ChapterGame({ view: v2, world, store, scenarios: [ieyasuScenario(storage), fictionalScenario(store)], battleRunner: async () => null }).start();
        await flush();
        expect('practice' in v2.titles[0]!).toBe(false);
    });
});
