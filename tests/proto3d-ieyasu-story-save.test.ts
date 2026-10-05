/**
 * 物見の記録の保存（版 3・版 4 の省ける欄 scout。proto3d/src/campaign/ieyasu1570/save.ts）。直接状態変更のテスト。
 * - 記録が無ければ今までと同じ文字列（第一章の版 3・第二章の版 4。旧版 Version 18 の保存の関数が書く文字列と 1 文字も同じ）。
 * - 記録があれば最後の欄として書き、読み戻すと同じ記録。出陣前の保存から読み直すと支度に戻り、記録は残る。
 * - 読むときは、その段階・任務で有り得る印の id だけ（違えば壊れた保存。データは消さない）。戦後・結末は持たない。
 * - 旧版 Version 18（deb7b2d の save.ts の写し：tests/fixtures/ieyasu-save-v18/save.ts）の読み込みで、記録付きの今の保存が読める（記録は読み飛ばす）。
 */
import { describe, expect, it } from 'vitest';
import {
    IEYASU_CHAPTER1_KEY,
    IEYASU_SAVE_KEY,
    IeyasuCampaignStore,
    parseIeyasu2SaveData,
    parseIeyasuSaveData,
    toIeyasu2SaveData,
    toIeyasuSaveData,
} from '../proto3d/src/campaign/ieyasu1570/save';
import * as V18 from './fixtures/ieyasu-save-v18/save';
import { finishTalkIeyasu, newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { startChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { isChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { POLICIES, type IeyasuState } from '../proto3d/src/campaign/ieyasu1570/state';
import { LOOKOUT_ID, SCOUT_MARK_IDS, ieyasuScout } from '../proto3d/src/campaign/ieyasu1570/story/scout';
import type { SavePoint } from '../proto3d/src/campaign/save';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { answerPledge, ieyasuToMuster } from './proto3d-ieyasu-helpers';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';
import { ch1Aftermath, ch1Ending, ch2Battle, ch2Muster } from './proto3d-ieyasu-story-states';

const now = new Date('2026-10-05T03:04:05Z');
const MISSION_IDS = { oda: SCOUT_MARK_IDS.rear, asai: SCOUT_MARK_IDS.relief, home: SCOUT_MARK_IDS.village } as const;

/** 第一章の物見できる段階の状態（探索・支度・出陣前）と、その保存の時点 */
function ch1Saveable(): { name: string; state: IeyasuState; point: SavePoint }[] {
    const out: { name: string; state: IeyasuState; point: SavePoint }[] = [{ name: 'explore', state: newIeyasuGame(), point: 'manual' }];
    for (const p of POLICIES) {
        const m = ieyasuToMuster(p);
        out.push({ name: `muster.${p}`, state: m, point: 'manual' }, { name: `muster.${p}.answered`, state: answerPledge(m, 'accept'), point: 'manual' });
        out.push({ name: `departure.${p}`, state: finishTalkIeyasu(answerPledge(m, 'decline'), 'gate', 'depart'), point: 'departure' });
    }
    return out;
}

/** 第二章の物見できる段階の状態（探索・支度・出陣前） */
function ch2Saveable(): { name: string; state: Ieyasu2State; point: SavePoint }[] {
    const out: { name: string; state: Ieyasu2State; point: SavePoint }[] = [];
    for (const p of POLICIES) {
        const start = startChapter2(ch1Ending(ch1Aftermath(p, 'victory', 'kept', 'light')));
        out.push({ name: `ch2.start.${p}`, state: start, point: 'chapter' }, { name: `ch2.explore.${p}`, state: start, point: 'manual' });
        const m = ch2Muster(start, 'commit');
        out.push({ name: `ch2.muster.${p}`, state: m, point: 'manual' }, { name: `ch2.departure.${p}`, state: ch2Battle(m), point: 'departure' });
    }
    return out;
}

const scoutAll = <S extends IeyasuState | Ieyasu2State>(s: S): S => {
    // 出陣前の状態は物見できない段階なので、支度の状態に記録を足して同じ欄を作る（保存の形の確かめ。直接状態変更）
    const ids = isChapter2(s) ? MISSION_IDS[s.policy] : SCOUT_MARK_IDS.border;
    if (s.phase === 'battle') return { ...s, scout: [...ids] };
    return ieyasuScout(s, LOOKOUT_ID, [...ids]);
};

describe('記録が無ければ今までと同じ文字列', () => {
    it('第一章（版 3）：旧版 Version 18 の保存の関数と 1 文字も同じ。欄 scout は無い', () => {
        for (const { name, state, point } of ch1Saveable()) {
            const a = JSON.stringify(toIeyasuSaveData(state, point, now));
            const b = JSON.stringify(V18.toIeyasuSaveData(state, point, now));
            expect(a, name).toBe(b);
            expect(a).not.toContain('scout');
        }
        // 結末・戦後の保存も同じ（fixture の文字列は tests/proto3d-ieyasu-ch2-fixtures.test.ts が見る）
        const end = ch1Ending(ch1Aftermath('oda', 'victory', 'kept', 'light'));
        expect(JSON.stringify(toIeyasuSaveData(end, 'ending', now))).toBe(JSON.stringify(V18.toIeyasuSaveData(end, 'ending', now)));
    });
    it('第二章（版 4）：旧版の保存の関数と同じ文字列', () => {
        for (const { name, state, point } of ch2Saveable()) {
            const a = JSON.stringify(toIeyasu2SaveData(state, point, now));
            expect(a, name).toBe(JSON.stringify(V18.toIeyasu2SaveData(state, point, now)));
            expect(a).not.toContain('scout');
        }
    });
});

describe('記録があれば最後の欄として書き、読み戻すと同じ記録', () => {
    it('第一章：探索・支度・出陣前。欄の並びは旧版と同じで、最後に scout。出陣前の保存は支度から（記録は残る）', () => {
        for (const { name, state, point } of ch1Saveable()) {
            const s = scoutAll(state);
            const d = toIeyasuSaveData(s, point, now)!;
            const old = V18.toIeyasuSaveData(state, point, now)!;
            expect(Object.keys(d), name).toEqual([...Object.keys(old), 'scout']);
            expect(d.scout).toEqual([...SCOUT_MARK_IDS.border]);
            const storage = new MemoryStorage();
            const store = new IeyasuCampaignStore(storage);
            const r = store.save(s, point, now);
            expect(r.ok, name).toBe(true);
            const l = store.load();
            expect(l.status).toBe('ok');
            if (l.status !== 'ok') continue;
            expect(l.state.scout).toEqual([...SCOUT_MARK_IDS.border]);
            expect(l.state.phase).toBe(point === 'departure' ? 'muster' : s.phase);
            // 記録のほかは記録なしの保存を読んだ物と同じ
            const plain = new IeyasuCampaignStore(new MemoryStorage());
            plain.save(state, point, now);
            const lp = plain.load();
            if (lp.status !== 'ok') throw new Error('読めない');
            expect({ ...l.state, scout: undefined, savedAt: null }).toEqual({ ...lp.state, scout: undefined, savedAt: null });
        }
    });
    it('第二章：始め・探索・支度・出陣前（任務の印）', () => {
        for (const { name, state, point } of ch2Saveable()) {
            if (point === 'chapter') continue;
            const s = scoutAll(state);
            const d = toIeyasu2SaveData(s, point, now)!;
            expect(Object.keys(d), name).toEqual([...Object.keys(V18.toIeyasu2SaveData(state, point, now)!), 'scout']);
            const store = new IeyasuCampaignStore(new MemoryStorage());
            expect(store.save(s, point, now).ok, name).toBe(true);
            const l = store.load();
            if (l.status !== 'ok') throw new Error(`${name}：読めない`);
            expect(l.state.scout).toEqual([...MISSION_IDS[s.policy]]);
        }
    });
    it('戦後・結末は記録を持たない（合戦の結果を反映すると消える）ので書かない。第一章の控え（/chapter1）は今までと同じ文字列', () => {
        const m = ieyasuScout(ieyasuToMuster('asai'), LOOKOUT_ID, [...SCOUT_MARK_IDS.border]);
        expect(m.scout?.length).toBe(3);
        const after = ch1Aftermath('asai', 'retreat', 'declined', 'light');
        expect(JSON.stringify(toIeyasuSaveData(after, 'aftermath', now))).not.toContain('scout');
        const end = ch1Ending(after);
        const storage = new MemoryStorage();
        const store = new IeyasuCampaignStore(storage);
        expect(store.saveChapterStart(end, startChapter2(end), now).ok).toBe(true);
        expect(storage.data.get(IEYASU_CHAPTER1_KEY)).toBe(JSON.stringify(V18.toIeyasuSaveData(end, 'ending', now)));
        expect(storage.data.get(IEYASU_SAVE_KEY)).not.toContain('scout');
    });
});

describe('壊れた記録は壊れた保存（消さない）', () => {
    const base1 = () => JSON.parse(JSON.stringify(toIeyasuSaveData(scoutAll(ieyasuToMuster('oda')), 'manual', now))) as Record<string, unknown>;
    const base2 = () => {
        const s = ch2Muster(startChapter2(ch1Ending(ch1Aftermath('home', 'victory', 'kept', 'light'))), 'commit');
        return JSON.parse(JSON.stringify(toIeyasu2SaveData(scoutAll(s), 'manual', now))) as Record<string, unknown>;
    };
    const VARIANTS: [string, (d: Record<string, unknown>) => void][] = [
        ['配列でない', (d) => (d.scout = 'border.hill')],
        ['数が入る', (d) => (d.scout = [1])],
        ['知らない印', (d) => (d.scout = ['nope'])],
        ['重なり', (d) => (d.scout = ['border.hill', 'border.hill'])],
        ['null', (d) => (d.scout = null)],
        ['多すぎる', (d) => (d.scout = [...SCOUT_MARK_IDS.border, ...SCOUT_MARK_IDS.border])],
    ];
    it('第一章（版 3）：変種はどれも corrupt で、データはそのまま残る。第二章の印・戦後の記録も受け付けない', () => {
        const variants: [string, Record<string, unknown>][] = VARIANTS.map(([n, f]) => {
            const d = base1();
            f(d);
            return [n, d];
        });
        const ch2ids = base1();
        ch2ids.scout = ['rear.neck'];
        variants.push(['第二章の印', ch2ids]);
        const after = JSON.parse(JSON.stringify(toIeyasuSaveData(ch1Aftermath('oda', 'victory', 'kept', 'light'), 'aftermath', now))) as Record<string, unknown>;
        after.scout = ['border.hill'];
        variants.push(['戦後に記録', after]);
        const v2 = JSON.parse(JSON.stringify(toIeyasuSaveData(ieyasuToMuster('oda'), 'manual', now))) as Record<string, unknown>;
        v2.version = 2;
        delete v2.sideObjectives;
        v2.scout = ['border.hill'];
        variants.push(['版 2 に記録', v2]);
        for (const [n, d] of variants) {
            const raw = JSON.stringify(d);
            expect(parseIeyasuSaveData(raw), n).toBeNull();
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, raw);
            const l = new IeyasuCampaignStore(storage).load();
            expect(l.status, n).toBe('corrupt');
            expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(raw);
            expect(storage.touched.filter((t) => t.op !== 'get')).toEqual([]);
        }
        // 空の並びは記録なしとして読む（書くときは欄を書かない）
        const empty = base1();
        empty.scout = [];
        expect(parseIeyasuSaveData(JSON.stringify(empty))?.scout).toBeUndefined();
    });
    it('第二章（版 4）：変種・第一章の印・ほかの任務の印・戦後の記録はどれも corrupt', () => {
        const variants: [string, Record<string, unknown>][] = VARIANTS.map(([n, f]) => {
            const d = base2();
            f(d);
            return [n, d];
        });
        for (const ids of [['border.hill'], ['rear.neck'], ['relief.west']]) {
            const d = base2();
            d.scout = ids;
            variants.push([`ほかの印 ${ids[0]}`, d]);
        }
        for (const [n, d] of variants) {
            const raw = JSON.stringify(d);
            expect(parseIeyasu2SaveData(raw), n).toBeNull();
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, raw);
            expect(new IeyasuCampaignStore(storage).load().status, n).toBe('corrupt');
            expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(raw);
        }
        expect(parseIeyasu2SaveData(JSON.stringify(base2()))?.scout).toEqual([...SCOUT_MARK_IDS.village]);
    });
});

describe('旧版 Version 18 の読み込みで、記録付きの今の保存が読める（旧版へ戻しても進行不能にならない）', () => {
    it('第一章（版 3）・第二章（版 4）：旧版は記録を読み飛ばし、記録なしの保存と同じ状態になる', () => {
        const cases: { name: string; state: IeyasuState | Ieyasu2State; point: SavePoint }[] = [...ch1Saveable(), ...ch2Saveable().filter((x) => x.point !== 'chapter')];
        for (const { name, state, point } of cases) {
            const s = scoutAll(state);
            const storage = new MemoryStorage();
            expect(new IeyasuCampaignStore(storage).save(s, point, now).ok, name).toBe(true);
            const raw = storage.data.get(IEYASU_SAVE_KEY)!;
            expect(raw).toContain('"scout"');
            // 旧版の読み込み
            const old = isChapter2(s) ? V18.parseIeyasu2SaveData(raw) : V18.parseIeyasuSaveData(raw);
            expect(old, name).not.toBeNull();
            const ol = new V18.IeyasuCampaignStore(storage).load();
            expect(ol.status, name).toBe('ok');
            if (ol.status !== 'ok') continue;
            expect('scout' in ol.state).toBe(false);
            // 記録なしの保存を旧版で読んだ物と同じ
            const plain = new MemoryStorage();
            new IeyasuCampaignStore(plain).save(state, point, now);
            const pl = new V18.IeyasuCampaignStore(plain).load();
            if (pl.status !== 'ok') throw new Error(`${name}：記録なしが読めない`);
            expect(ol.state).toEqual(pl.state);
        }
    });
    it('第一章の結末の fixture（版 3）は今の版でも旧版でも同じに読める', () => {
        for (const [n, raw] of Object.entries(IEYASU_V3_FIXTURES)) {
            const a = parseIeyasuSaveData(raw);
            const b = V18.parseIeyasuSaveData(raw);
            expect(a, n).toEqual(b);
            expect(a?.scout).toBeUndefined();
        }
    });
});
