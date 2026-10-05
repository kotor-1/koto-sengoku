/**
 * 第二章の保存（proto3d/src/campaign/ieyasu1570/save.ts の後半・IeyasuCampaignStore）：
 * - 第二章の状態だけ版 4（chapter: 2）。第一章の状態は今までどおり版 3（同じ文字列）で書く。
 * - 版 4 の行き来（城下・支度・出陣前・戦後・区切り）。出陣前の保存は支度（出陣の確認の前）から。時点 'chapter'（第二章の始め）。
 * - 移るときの保存（saveChapterStart）：第一章の結末を控えのキーに残してから第二章を書く。書き込みの失敗（容量・読み戻しの不一致）では、
 *   本来のキーが元のまま（元が無ければ無いまま）。
 * - 壊れた版 4（20 余りの変種）は corrupt で、そのまま残る（消さない）。読み込んだだけでは書かない。2D・架空の章・演習のキーに触れない。
 */
import { describe, expect, it } from 'vitest';
import {
    IEYASU_CHAPTER1_KEY,
    IEYASU_SAVE_ARCHIVE_KEY,
    IEYASU_SAVE_KEY,
    IEYASU2_SAVE_VERSION,
    IeyasuCampaignStore,
    IeyasuSaveStore,
    CHAPTER1_BACKUP_FAILED,
    parseIeyasu2SaveData,
    parseIeyasuSaveData,
    toIeyasu2SaveData,
} from '../proto3d/src/campaign/ieyasu1570/save';
import {
    addIeyasu2PlayTime,
    finishTalkIeyasu2,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    applyIeyasu2OutcomeOnce,
    setIeyasu2ExplorePose,
    startChapter2,
    withIeyasu2BattleId,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { isChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import { PRACTICE_SAVE_KEY } from '../proto3d/src/campaign/practice';
import { MemoryStorage, snapshot, toAftermath } from './proto3d-campaign-helpers';
import { ch2From, loadCh1, toCh2Aftermath, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';
import { ieyasuToAftermath } from './proto3d-ieyasu-helpers';
import { addIeyasuPlayTime } from '../proto3d/src/campaign/ieyasu1570/flow';

const now = new Date('2026-10-05T03:04:05Z');
const LEGACY_2D = '{"2d":"keep"}';
const PRACTICE = '{"version":1,"fields":{}}';

/** 2D・架空の章・演習の保存が入った記憶域（触れたキーの記録は空にしておく） */
function storageWithOthers(): { storage: MemoryStorage; fictional: string } {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_2D_SAVE_KEY, LEGACY_2D);
    storage.data.set(PRACTICE_SAVE_KEY, PRACTICE);
    const r = new CampaignSaveStore(storage).save(toAftermath('tashiro', 'victory'), 'aftermath', now);
    if (!r.ok) throw new Error('架空の章の保存を作れない');
    storage.touched = [];
    return { storage, fictional: storage.data.get(CAMPAIGN_SAVE_KEY)! };
}

const OTHER_KEYS = [LEGACY_2D_SAVE_KEY, CAMPAIGN_SAVE_KEY, PRACTICE_SAVE_KEY, `${PRACTICE_SAVE_KEY}/broken`, 'koto-sengoku/3d-chapter1/previous'];

function expectOthersUntouched(storage: MemoryStorage, fictional: string) {
    expect(storage.touched.filter((t) => OTHER_KEYS.includes(t.key))).toEqual([]);
    expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D);
    expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
    expect(storage.data.get(PRACTICE_SAVE_KEY)).toBe(PRACTICE);
}

describe('版 4 の行き来', () => {
    it('城下（手動保存）：版 4・chapter 2。読み戻すと同じ状態。説明は「第二章・城下・…」', () => {
        const { storage, fictional } = storageWithOthers();
        const store = new IeyasuCampaignStore(storage);
        const s = setIeyasu2ExplorePose(finishTalkIeyasu2(ch2From('oda_victory_kept'), 'notice'), { x: 1, z: -3, heading: 0.5 });
        const r = store.save(s, 'manual', now);
        expect(r.ok).toBe(true);
        const raw = JSON.parse(storage.data.get(IEYASU_SAVE_KEY)!) as Record<string, unknown>;
        expect(raw.version).toBe(IEYASU2_SAVE_VERSION);
        expect(raw.version).toBe(4);
        expect(raw.chapter).toBe(2);
        // 書く前に本来のキーを 1 回読む（第一章の保存が残っていれば先に控えへ写すため）→ 書く → 読み戻す
        expect(storage.touched.filter((t) => t.key === IEYASU_SAVE_KEY).map((t) => t.op)).toEqual(['get', 'set', 'get']);
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        expect(isChapter2(l.state)).toBe(true);
        expect(snapshot({ ...l.state, savedAt: null })).toEqual(snapshot({ ...s, savedAt: null }));
        expect(l.summary).toMatch(/^第二章・城下・織田との協力を続けた・手動保存・\d{4}\/\d\d\/\d\d \d\d:\d\d・遊んだ時間 \d+ 分$/);
        expectOthersUntouched(storage, fictional);
    });

    it('出陣前の自動保存を読むと、支度（出陣の確認の前）から。判断・補充は残り、もう一度出陣できる（補充は重ならない）', () => {
        const store = new IeyasuCampaignStore(new MemoryStorage());
        const b = toCh2Battle(toCh2Muster(ch2From('asai_defeat_broken_heavy')), 'wait');
        expect(store.save(b, 'departure', now).ok).toBe(true);
        const l = store.load();
        if (l.status !== 'ok' || !isChapter2(l.state)) throw new Error('読めない');
        const s = l.state as Ieyasu2State;
        expect(s.phase).toBe('muster');
        expect(s.battleId).toBeNull();
        expect(s.plan).toBe(b.plan);
        expect(s.recovery).toEqual(b.recovery);
        expect(s.troops).toEqual(b.troops);
        expect(l.summary).toContain('第二章・出陣前');
        const again = finishTalkIeyasu2(s, 'gate', 'depart');
        expect(again.troops).toEqual(b.troops);
        expect(() => finishTalkIeyasu2(s, 'ishikawa', 'recovery_wait')).toThrow();
    });

    it('戦後の保存：結果・記録・信頼が戻り、同じ合戦を二重に反映しない', () => {
        const store = new IeyasuCampaignStore(new MemoryStorage());
        const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(ch2From('home_victory_kept'), 'commit'), 'transfer'), 'ieyasu1570-x-1');
        const o = ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory', { abilitiesUsed: { t_honjin: 30 } });
        const a = applyIeyasu2OutcomeOnce(b, 'ieyasu1570-x-1', o).state;
        expect(store.save(a, 'aftermath', now).ok).toBe(true);
        const l = store.load();
        if (l.status !== 'ok') throw new Error('読めない');
        const back = l.state as Ieyasu2State;
        expect(back.result).toEqual(a.result);
        expect(back.trust).toEqual(a.trust);
        expect(back.troops).toEqual(a.troops);
        expect(back.battle!.objectives).toEqual(a.battle!.objectives);
        expect(back.battle!.abilitiesUsed).toEqual({ t_honjin: 30 });
        const again = applyIeyasu2OutcomeOnce(back, 'ieyasu1570-x-1', o);
        expect(again.applied).toBe(false);
        expect(snapshot(again.state)).toEqual(snapshot(back));
    });

    it('区切りの保存を読むと区切りから。説明は「第二章の区切り」で、第一章の「章の結末」とは別', () => {
        const store = new IeyasuCampaignStore(new MemoryStorage());
        const e = finishTalkIeyasu2(toCh2Aftermath(toCh2Battle(toCh2Muster(ch2From('oda_retreat_declined'))), 'defeat'), 'tadakatsu', 'end_chapter');
        expect(store.save(e, 'ending', now).ok).toBe(true);
        const l = store.load();
        expect(l.status === 'ok' && l.state.ending).toBe('ch2_oda_defeat');
        expect(l.status === 'ok' && l.summary).toContain('第二章の区切り');
        expect(l.status === 'ok' && l.summary).not.toContain('章の結末');
    });

    it('保存してよくない時点では書かない（「第二章の始め」は城下のはじめだけ・第一章の状態は「第二章の始め」で書かない）', () => {
        const storage = new MemoryStorage();
        const store = new IeyasuCampaignStore(storage);
        expect(store.save(toCh2Muster(ch2From('oda_victory_kept')), 'chapter', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(loadCh1(IEYASU_V3_FIXTURES.oda_victory_kept), 'chapter', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(toCh2Battle(toCh2Muster(ch2From('oda_victory_kept'))), 'manual', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(storage.data.has(IEYASU_SAVE_KEY)).toBe(false);
        // 架空の章の保存は「第二章の始め」を受け付けない
        expect(new CampaignSaveStore(storage).save(toAftermath('omori', 'victory'), 'chapter', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(ch2From('oda_victory_kept'), 'chapter', now).ok).toBe(true);
    });

    it('第一章の状態は今までどおり版 3 で、今までと同じ文字列で書く', () => {
        for (const name of ['oda_victory_kept', 'home_defeat_broken_heavy', 'oda_victory_kept_aftermath'] as const) {
            const a = new MemoryStorage();
            const b = new MemoryStorage();
            const s = loadCh1(IEYASU_V3_FIXTURES[name]);
            const point = s.phase === 'ending' ? 'ending' : 'aftermath';
            expect(new IeyasuCampaignStore(a).save(s, point, now).ok).toBe(true);
            expect(new IeyasuSaveStore(b).save(s, point, now).ok).toBe(true);
            expect(a.data.get(IEYASU_SAVE_KEY)).toBe(b.data.get(IEYASU_SAVE_KEY));
            expect(JSON.parse(a.data.get(IEYASU_SAVE_KEY)!).version).toBe(3);
        }
        // 第一章の保存を読み込むと第一章の状態（今まで通り）
        const st = new MemoryStorage();
        st.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.asai_victory_kept);
        const l = new IeyasuCampaignStore(st).load();
        expect(l.status === 'ok' && !isChapter2(l.state) && l.state.phase).toBe('ending');
        expect(l.status === 'ok' && l.summary).toContain('章の結末');
    });

    it('読み込んだだけでは書かない（版 1〜4 どれも get だけ）', () => {
        for (const raw of [IEYASU_V3_FIXTURES.oda_victory_kept, JSON.stringify(toIeyasu2SaveData(ch2From('oda_victory_kept'), 'chapter', now))]) {
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, raw);
            const store = new IeyasuCampaignStore(storage);
            store.load();
            store.loadData();
            expect(storage.touched.every((t) => t.op === 'get')).toBe(true);
            expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(raw);
        }
    });

    it('はじめからの控え：第二章の保存も控えへ写せる。2D・架空・演習のキーは使えない', () => {
        const storage = new MemoryStorage();
        const store = new IeyasuCampaignStore(storage);
        store.save(ch2From('home_retreat_declined'), 'chapter', now);
        expect(store.archivePrevious()).toBe(true);
        expect(storage.data.get(IEYASU_SAVE_ARCHIVE_KEY)).toBe(storage.data.get(IEYASU_SAVE_KEY));
        expect(() => new IeyasuCampaignStore(new MemoryStorage(), CAMPAIGN_SAVE_KEY)).toThrow();
        expect(() => new IeyasuCampaignStore(new MemoryStorage(), IEYASU_SAVE_KEY, IEYASU_SAVE_ARCHIVE_KEY, LEGACY_2D_SAVE_KEY)).toThrow();
        expect(() => new IeyasuCampaignStore(new MemoryStorage(), IEYASU_SAVE_KEY, IEYASU_SAVE_ARCHIVE_KEY, PRACTICE_SAVE_KEY)).toThrow();
        expect(() => new IeyasuCampaignStore(new MemoryStorage(), PRACTICE_SAVE_KEY)).toThrow();
    });
});

describe('第一章から第二章へ移るときの保存（saveChapterStart）', () => {
    const prev = () => loadCh1(IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);

    it('成功：第一章の結末を控えのキーへ版 3 で、第二章のはじめを本来のキーへ版 4・時点 chapter で。ほかのキーに触れない', () => {
        const { storage, fictional } = storageWithOthers();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        storage.touched = [];
        const store = new IeyasuCampaignStore(storage);
        const p = prev();
        const next = startChapter2(p);
        const r = store.saveChapterStart(p, next, now);
        expect(r.ok).toBe(true);
        expect(r.ok && r.point).toBe('chapter');
        const backup = storage.data.get(IEYASU_CHAPTER1_KEY)!;
        expect(JSON.parse(backup).version).toBe(3);
        expect(parseIeyasuSaveData(backup)!.phase).toBe('ending');
        const main = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!)!;
        expect(main.point).toBe('chapter');
        expect(main.phase).toBe('explore');
        expect(main.chapter1.troops).toEqual(p.troops);
        // 控えを読み戻せる
        const lb = store.loadChapter1Backup();
        expect(lb.status === 'ok' && !isChapter2(lb.state) && lb.state.ending).toBe(p.ending);
        expect(new Set(storage.touched.map((t) => t.key))).toEqual(new Set([IEYASU_CHAPTER1_KEY, IEYASU_SAVE_KEY]));
        expectOthersUntouched(storage, fictional);
        // もう一度押されても（同じ入力）、同じ第二章のはじめ（足し算を重ねない）
        const r2 = store.saveChapterStart(p, startChapter2(p), now);
        expect(r2.ok).toBe(true);
        const main2 = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!)!;
        expect(main2.troops).toEqual(main.troops);
        expect(main2.trust).toEqual(main.trust);
    });

    it('控えのキーへ書けない（容量）：本来のキーに触れずに失敗', () => {
        class Full extends MemoryStorage {
            override setItem(k: string, v: string): void {
                if (k === IEYASU_CHAPTER1_KEY) {
                    const e = new Error('full');
                    e.name = 'QuotaExceededError';
                    throw e;
                }
                super.setItem(k, v);
            }
        }
        const storage = new Full();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        storage.touched = [];
        const r = new IeyasuCampaignStore(storage).saveChapterStart(prev(), startChapter2(prev()), now);
        expect(r).toMatchObject({ ok: false, reason: 'quota' });
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        expect(storage.touched.filter((t) => t.key === IEYASU_SAVE_KEY)).toEqual([]);
    });

    it('本来のキーへ書けない（容量）：本来のキーは元のまま。第一章の控えは残る', () => {
        class Full extends MemoryStorage {
            override setItem(k: string, v: string): void {
                if (k === IEYASU_SAVE_KEY && v.includes('"version":4')) {
                    const e = new Error('full');
                    e.name = 'QuotaExceededError';
                    throw e;
                }
                super.setItem(k, v);
            }
        }
        const storage = new Full();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        const r = new IeyasuCampaignStore(storage).saveChapterStart(prev(), startChapter2(prev()), now);
        expect(r).toMatchObject({ ok: false, reason: 'quota' });
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        expect(parseIeyasuSaveData(storage.data.get(IEYASU_CHAPTER1_KEY)!)!.phase).toBe('ending');
        // 第一章の保存はそのまま読める（結末から、もう一度「第二章へ進む」を押せる）
        const l = new IeyasuCampaignStore(storage).load();
        expect(l.status === 'ok' && l.state.phase).toBe('ending');
    });

    it('本来のキーの読み戻しが食い違う：本来のキーを元の中身へ戻す（元が無ければ消す）', () => {
        class Liar extends MemoryStorage {
            override getItem(k: string): string | null {
                const v = super.getItem(k);
                return k === IEYASU_SAVE_KEY && v?.includes('"version":4') ? `${v} ` : v;
            }
        }
        for (const original of [IEYASU_V3_FIXTURES.oda_defeat_broken_heavy, null]) {
            const storage = new Liar();
            if (original) storage.data.set(IEYASU_SAVE_KEY, original);
            const r = new IeyasuCampaignStore(storage).saveChapterStart(prev(), startChapter2(prev()), now);
            expect(r).toMatchObject({ ok: false, reason: 'verify' });
            expect(storage.data.get(IEYASU_SAVE_KEY) ?? null).toBe(original);
            expect(storage.data.has(IEYASU_CHAPTER1_KEY)).toBe(true);
        }
    });

    it('第一章の結末でない／第二章でない組では書かない', () => {
        const storage = new MemoryStorage();
        const store = new IeyasuCampaignStore(storage);
        const s2 = startChapter2(prev());
        expect(store.saveChapterStart(s2, s2, now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.saveChapterStart(prev(), prev(), now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(storage.data.size).toBe(0);
        expect(new IeyasuCampaignStore(null).saveChapterStart(prev(), s2, now)).toMatchObject({ ok: false, reason: 'unavailable' });
    });
});

describe('遊んだ時間の端数・書く前の検査（書いたのに読めない保存を「保存しました」にしない）', () => {
    const fixture = IEYASU_V3_FIXTURES.oda_victory_kept;
    it('第一章の遊んだ時間に端数（探索の毎フレーム）：移るときの保存も、移った直後（1 秒未満）の手動保存も読める', () => {
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, fixture);
        const store = new IeyasuCampaignStore(storage);
        const prev = addIeyasuPlayTime(loadCh1(fixture), 0.5);
        expect(prev.playTimeSec % 1).not.toBe(0);
        const next = startChapter2(prev);
        // 写すときに秒へ切り捨てる（第一章の記録も今の遊んだ時間も）
        expect(next.chapter1.playTimeSec).toBe(Math.floor(prev.playTimeSec));
        expect(next.playTimeSec).toBe(Math.floor(prev.playTimeSec));
        const r = store.saveChapterStart(prev, next, now);
        expect(r.ok).toBe(true);
        const l = store.load();
        expect(l.status).toBe('ok');
        expect(l.status === 'ok' && isChapter2(l.state) && l.state.phase).toBe('explore');
        // 移った直後（0.3 秒）の手動保存
        const m = store.save(addIeyasu2PlayTime(next, 0.3), 'manual', now);
        expect(m.ok).toBe(true);
        const l2 = store.load();
        expect(l2.status === 'ok' && isChapter2(l2.state)).toBe(true);
    });
    it('状態の第一章の遊んだ時間に端数が残っていても、書くときに切り捨てて読める形で書く', () => {
        const storage = new MemoryStorage();
        const s = ch2From('oda_victory_kept');
        s.chapter1.playTimeSec = s.playTimeSec + 0.6;
        const r = new IeyasuCampaignStore(storage).save(s, 'manual', now);
        expect(r.ok).toBe(true);
        const d = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!);
        expect(d?.chapter1.playTimeSec).toBe(s.playTimeSec);
    });
    it('読み込みの検査に落ちる状態は書かずに失敗（verify）。本来のキー・控えは元のまま（移るときも同じ）', () => {
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, fixture);
        storage.touched = [];
        const store = new IeyasuCampaignStore(storage);
        const s = ch2From('oda_victory_kept');
        // 第一章の遊んだ時間が今より長い（読むと壊れた保存になる組）
        s.chapter1.playTimeSec = s.playTimeSec + 10;
        expect(store.save(s, 'manual', now)).toMatchObject({ ok: false, reason: 'verify' });
        const prev = loadCh1(fixture);
        expect(store.saveChapterStart(prev, s, now)).toMatchObject({ ok: false, reason: 'verify' });
        expect(storage.touched.filter((t) => t.op !== 'get')).toEqual([]);
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(fixture);
        expect(storage.data.has(IEYASU_CHAPTER1_KEY)).toBe(false);
    });
});

describe('第二章の保存の前に、本来のキーの第一章の保存を控えへ写す（移るときの控えが書けなかった場合）', () => {
    const fixture = IEYASU_V3_FIXTURES.oda_victory_kept;
    class FullBackup extends MemoryStorage {
        override setItem(k: string, v: string): void {
            if (k === IEYASU_CHAPTER1_KEY) {
                const e = new Error('full');
                e.name = 'QuotaExceededError';
                throw e;
            }
            super.setItem(k, v);
        }
    }
    it('控えへ写せない（容量）：第二章の保存は失敗（理由つき）。本来のキーの版 3 は上書きしない', () => {
        const storage = new FullBackup();
        storage.data.set(IEYASU_SAVE_KEY, fixture);
        const store = new IeyasuCampaignStore(storage);
        const s = ch2From('oda_victory_kept');
        const r = store.save(s, 'manual', now);
        expect(r).toMatchObject({ ok: false, reason: 'quota' });
        expect(!r.ok && r.message).toContain(CHAPTER1_BACKUP_FAILED);
        // 出陣前・戦後の自動保存も同じ
        const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(s)), 'ieyasu1570-q-1');
        expect(store.save(b, 'departure', now)).toMatchObject({ ok: false, reason: 'quota' });
        const a = applyIeyasu2OutcomeOnce(b, 'ieyasu1570-q-1', ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory')).state;
        expect(store.save(a, 'aftermath', now)).toMatchObject({ ok: false, reason: 'quota' });
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(fixture);
        expect(storage.touched.filter((t) => t.op === 'set' && t.key === IEYASU_SAVE_KEY)).toEqual([]);
        const l = store.load();
        expect(l.status === 'ok' && !isChapter2(l.state) && l.state.phase).toBe('ending');
    });
    it('控えが無い：先に本来のキーの第一章の保存（同じ文字列）を控えへ写してから、第二章を書く', () => {
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, fixture);
        storage.touched = [];
        const r = new IeyasuCampaignStore(storage).save(ch2From('oda_victory_kept'), 'manual', now);
        expect(r.ok).toBe(true);
        expect(storage.data.get(IEYASU_CHAPTER1_KEY)).toBe(fixture);
        expect(parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!)?.point).toBe('manual');
        const sets = storage.touched.filter((t) => t.op === 'set').map((t) => t.key);
        expect(sets).toEqual([IEYASU_CHAPTER1_KEY, IEYASU_SAVE_KEY]);
    });
    it('控えに別の第一章の保存がある：本来のキーの物で控えを書き直してから第二章を書く', () => {
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, fixture);
        storage.data.set(IEYASU_CHAPTER1_KEY, IEYASU_V3_FIXTURES.home_victory_kept);
        const r = new IeyasuCampaignStore(storage).save(ch2From('oda_victory_kept'), 'manual', now);
        expect(r.ok).toBe(true);
        expect(storage.data.get(IEYASU_CHAPTER1_KEY)).toBe(fixture);
    });
    it('控えに同じ物がある・本来のキーが第二章・壊れた保存・空：控えには触れない', () => {
        const s = ch2From('oda_victory_kept');
        for (const [main, backup] of [
            [fixture, fixture],
            [JSON.stringify(toIeyasu2SaveData(s, 'manual', now)), null],
            ['{"broken":true}', null],
            [null, null],
        ] as const) {
            const storage = new MemoryStorage();
            if (main !== null) storage.data.set(IEYASU_SAVE_KEY, main);
            if (backup !== null) storage.data.set(IEYASU_CHAPTER1_KEY, backup);
            storage.touched = [];
            expect(new IeyasuCampaignStore(storage).save(s, 'manual', now).ok).toBe(true);
            expect(storage.touched.filter((t) => t.op !== 'get' && t.key === IEYASU_CHAPTER1_KEY)).toEqual([]);
            expect(storage.data.get(IEYASU_CHAPTER1_KEY) ?? null).toBe(backup);
        }
    });
});

describe('壊れた版 4 は読み込まない（データはそのまま残す）', () => {
    const aft = (() => {
        const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(ch2From('asai_defeat_broken_heavy')), 'wait'), 'ieyasu1570-y-1');
        return applyIeyasu2OutcomeOnce(b, 'ieyasu1570-y-1', ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory')).state;
    })();
    const good = JSON.parse(JSON.stringify(toIeyasu2SaveData(aft, 'aftermath', now))) as Record<string, unknown>;
    const bad = (patch: (v: Record<string, any>) => void) => {
        const v = JSON.parse(JSON.stringify(good)) as Record<string, any>;
        patch(v);
        return JSON.stringify(v);
    };
    it('正しいデータは読める', () => {
        expect(parseIeyasu2SaveData(JSON.stringify(good))).not.toBeNull();
    });
    it.each([
        ['まだ無い版 5', (v: Record<string, any>) => (v.version = 5)],
        ['chapter が 2 でない', (v: Record<string, any>) => (v.chapter = 3)],
        ['chapter が無い', (v: Record<string, any>) => delete v.chapter],
        ['シナリオの id が違う', (v: Record<string, any>) => (v.scenario = 'fictional')],
        ['方針が第一章の記録と違う', (v: Record<string, any>) => (v.policy = 'oda')],
        ['第一章の記録が無い', (v: Record<string, any>) => delete v.chapter1],
        ['第一章の約束の結果が無い', (v: Record<string, any>) => (v.chapter1.pledge.result = null)],
        ['第一章の援兵が約束の結果と食い違う', (v: Record<string, any>) => (v.chapter1.support.reinforcement = true)],
        ['第一章の結末が合戦の結果と食い違う', (v: Record<string, any>) => (v.chapter1.ending = 'asai_victory')],
        ['第一章の遊んだ時間が今より長い', (v: Record<string, any>) => (v.chapter1.playTimeSec = v.playTimeSec + 10)],
        ['第一章の信頼が範囲外', (v: Record<string, any>) => (v.chapter1.trust.oda = 500)],
        ['戦後なのに記録が無い', (v: Record<string, any>) => (v.result = null)],
        ['記録の判断が判断と違う', (v: Record<string, any>) => (v.result.plan = v.plan === 'commit' ? 'hold' : 'commit')],
        ['記録の補充が補充と違う', (v: Record<string, any>) => (v.result.recovery = 'none')],
        ['補充「今の兵」なのに兵が動いた', (v: Record<string, any>) => (v.recovery = { choice: 'none', delta: { honjin: 5, tadakatsu: 0, yumi: 0, reserve: 0 } })],
        ['補充「守備隊から回す」の合計が 0 でない', (v: Record<string, any>) => (v.recovery = { choice: 'transfer', delta: { honjin: 50, tadakatsu: 0, yumi: 0, reserve: -10 } })],
        ['兵が負', (v: Record<string, any>) => (v.troops.yumi = -1)],
        ['信頼の鍵が足りない', (v: Record<string, any>) => delete v.trust.sakai],
        ['知らない会話の済み印', (v: Record<string, any>) => (v.talked['explore.oda_envoy'] = true)],
        ['主目標で勝ったのに敗北', (v: Record<string, any>) => (v.battle.result = 'defeat')],
        ['反映の済み印が合戦の id と違う', (v: Record<string, any>) => (v.appliedBattleId = 'other')],
        ['戦後なのに区切りがある', (v: Record<string, any>) => (v.ending = 'ch2_asai_victory')],
        ['第一章で負傷した人物が治っている', (v: Record<string, any>) => (v.characters.ieyasu = 'alive')],
        ['時点「第二章の始め」なのに戦後', (v: Record<string, any>) => (v.point = 'chapter')],
        ['失った兵が出陣した兵より多い', (v: Record<string, any>) => (v.result.lost.honjin = v.result.sortieTroops.honjin + 1)],
        ['出陣に本陣が無い', (v: Record<string, any>) => (v.result.sortie = v.result.sortie.filter((k: string) => k !== 'honjin'))],
        ['目標の結果の種類が知らない物', (v: Record<string, any>) => (v.result.primary.type = 'conquer')],
        ['探索の位置が範囲外', (v: Record<string, any>) => (v.explore = { x: 1e6, z: 0, heading: 0 })],
        ['合戦の部隊が空', (v: Record<string, any>) => (v.battle.units = [])],
        ['死亡という状態', (v: Record<string, any>) => (v.characters.tadakatsu = 'dead')],
    ])('%s', (_name, patch) => {
        const storage = new MemoryStorage();
        const text = bad(patch);
        storage.data.set(IEYASU_SAVE_KEY, text);
        const l = new IeyasuCampaignStore(storage).load();
        expect(l.status).toBe('corrupt');
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(text);
        expect(storage.touched.every((t) => t.op === 'get')).toBe(true);
        // 第一章の読み方でも読まない
        expect(parseIeyasuSaveData(text)).toBeNull();
    });
    it('記録・条件の閉じた形の検査（求め直さない）：食い違う組は読まない', () => {
        const rd = (v: Record<string, any>) => parseIeyasu2SaveData(JSON.stringify(v));
        const copy = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, any>;
        // 戦後（A 判断 2・待った・勝利）と、支度（C 判断 1・待った）と、戦後（B・敗北）
        const aHold = (() => {
            const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(ch2From('oda_victory_kept'), 'hold'), 'wait'), 'ieyasu1570-v-1');
            return applyIeyasu2OutcomeOnce(b, 'ieyasu1570-v-1', ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory')).state;
        })();
        const goodA = copy(toIeyasu2SaveData(aHold, 'aftermath', now));
        const muster = finishTalkIeyasu2(toCh2Muster(ch2From('home_defeat_broken_heavy')), 'ishikawa', 'recovery_wait');
        const goodM = copy(toIeyasu2SaveData(muster, 'manual', now));
        const bDef = (() => {
            const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(ch2From('asai_victory_kept'))), 'ieyasu1570-v-2');
            return applyIeyasu2OutcomeOnce(b, 'ieyasu1570-v-2', ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'defeat')).state;
        })();
        const goodB = copy(toIeyasu2SaveData(bDef, 'aftermath', now));
        for (const g of [goodA, goodM, goodB, good]) expect(rd(g)).not.toBeNull();
        const cases: [string, Record<string, any>, (v: Record<string, any>) => void][] = [
            // (1) terms：thin と basisTroops（basisTroops < thinTroops ⇔ thin）
            ['条件の基準の兵が多いのに thin', good, (v) => (v.terms.basisTroops = 2000)],
            ['条件の基準の兵が少ないのに thin でない（値も表のふだん）', goodA, (v) => (v.terms.basisTroops = 140)],
            // (2)(3)(8) 合戦の前：兵＝第一章の兵＋補充・信頼と人物＝第一章
            ['支度の兵が第一章の兵＋補充と違う', goodM, (v) => (v.troops.honjin += 1)],
            ['支度の兵が第一章の兵と違う（補充を足していない）', goodM, (v) => (v.troops = { ...v.chapter1.troops })],
            ['支度の信頼が第一章と違う', goodM, (v) => (v.trust.oda = v.chapter1.trust.oda + 5)],
            ['支度の人物が第一章と違う（負傷していない人物が負傷）', goodM, (v) => (v.characters.nagamasa = 'wounded')],
            // (4) 補充の delta：その選択肢で作れる値
            ['待って戻る兵が第一章の損害を超える', goodA, (v) => (v.recovery.delta.honjin = 500)],
            ['待って戻る兵が決まりの値と違う', goodM, (v) => {
                v.recovery.delta.yumi += 1;
                v.troops.yumi += 1;
            }],
            // (5) 戦後の記録の支援：方針の支援の id
            ['A の記録の支援が村の衆', goodA, (v) => (v.result.support = ['village'])],
            ['B の記録の支援が織田の鉄砲隊', goodB, (v) => (v.result.support = ['oda_teppo'])],
            // (6) 判断 2 なら出陣に守備隊が無い
            ['判断 2 なのに出陣に守備隊', goodA, (v) => {
                v.result.sortie.push('reserve');
                v.result.sortieTroops.reserve = 300;
                v.result.lost.reserve = 0;
            }],
            // (7) 勝利 ⇔ 主目標を果たした
            ['勝利なのに主目標を果たしていない', goodA, (v) => (v.result.primary.achieved = false)],
            ['敗北なのに主目標を果たした', goodB, (v) => (v.result.primary.achieved = true)],
            ['勝利なのに主目標の記録が無い', goodA, (v) => (v.result.primary = null)],
        ];
        for (const [name, base, patch] of cases) {
            const v = copy(base);
            patch(v);
            expect(rd(v), name).toBeNull();
            // 保存として読み込んでも corrupt（データはそのまま）
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, JSON.stringify(v));
            expect(new IeyasuCampaignStore(storage).load().status, name).toBe('corrupt');
            expect(storage.touched.every((t) => t.op === 'get'), name).toBe(true);
        }
    });
    it('区切りの id が合戦の結果と食い違えば読まない', () => {
        const e = finishTalkIeyasu2(aft, 'tadakatsu', 'end_chapter');
        const v = JSON.parse(JSON.stringify(toIeyasu2SaveData(e, 'ending', now))) as Record<string, unknown>;
        expect(parseIeyasu2SaveData(JSON.stringify(v))).not.toBeNull();
        v.ending = 'ch2_asai_defeat';
        expect(parseIeyasu2SaveData(JSON.stringify(v))).toBeNull();
    });
    it('城下の版 4 に判断・補充があれば読まない（段階との食い違い）', () => {
        const v = JSON.parse(JSON.stringify(toIeyasu2SaveData(ch2From('oda_victory_kept'), 'manual', now))) as Record<string, unknown>;
        expect(parseIeyasu2SaveData(JSON.stringify(v))).not.toBeNull();
        v.plan = 'commit';
        expect(parseIeyasu2SaveData(JSON.stringify(v))).toBeNull();
    });
    it('第一章の版 3 の読み方は、版 4 を読まない（第一章の保存の扱いは変わらない）', () => {
        expect(parseIeyasuSaveData(JSON.stringify(good))).toBeNull();
        // 第一章の戦後の保存は今までどおり読める
        const raw = JSON.stringify(new IeyasuSaveStore(new MemoryStorage()).save(ieyasuToAftermath('oda', 'victory', 'accept', { pledge: 'kept' }), 'aftermath', now).ok);
        expect(raw).toBe('true');
    });
});
