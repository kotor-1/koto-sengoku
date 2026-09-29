/**
 * 第一章の保存（proto3d/src/campaign/save.ts）：書く・読む・出陣前は支度から再開・壊れたデータ・容量不足・2D 版の保存に触れないこと。
 */
import { describe, expect, it } from 'vitest';
import { battleSetupFor, finishTalk, newGame, setExplorePose, addPlayTime } from '../proto3d/src/campaign/flow';
import {
    CAMPAIGN_SAVE_ARCHIVE_KEY,
    CAMPAIGN_SAVE_KEY,
    CampaignSaveStore,
    LEGACY_2D_SAVE_KEY,
    canSaveAt,
    describeSave,
    parseSaveData,
    toSaveData,
} from '../proto3d/src/campaign/save';
import type { CampaignState } from '../proto3d/src/campaign/state';
import { MemoryStorage, toAftermath, toBattle, toMuster } from './proto3d-campaign-helpers';

const now = new Date('2026-09-29T03:04:05Z');
const LEGACY_2D_DATA = JSON.stringify({ version: 2, savedAt: '2026-09-24T12:00:00.000Z', playTimeSec: 99, player: { x: 1, y: 2, facing: 'down' } });

function storeWith2D(): { storage: MemoryStorage; store: CampaignSaveStore } {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_2D_SAVE_KEY, LEGACY_2D_DATA);
    return { storage, store: new CampaignSaveStore(storage) };
}

function validJson(state: CampaignState, point: Parameters<typeof toSaveData>[1]): Record<string, unknown> {
    return JSON.parse(JSON.stringify(toSaveData(state, point, now))) as Record<string, unknown>;
}

describe('保存と読み込み', () => {
    it('出陣前の自動保存（phase battle）を読み込むと、出陣の確認の前（muster）から再開する', () => {
        const { store } = storeWith2D();
        const b = setExplorePose(addPlayTime(toBattle('tashiro', { talkEnvoy: true }), 321.7), { x: 0.2, z: -9, heading: 3 });
        const res = store.save(b, 'departure', now);
        expect(res).toMatchObject({ ok: true, savedAt: now.toISOString(), point: 'departure' });
        if (res.ok) expect(res.state.savedAt).toBe(now.toISOString());
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        expect(l.data.phase).toBe('battle');
        expect(l.state.phase).toBe('muster');
        expect(l.state.alliance).toBe('tashiro');
        expect(l.state.battle).toBeNull();
        expect(l.state.relations).toEqual(b.relations);
        expect(l.state.troops).toEqual(b.troops);
        expect(l.state.talked).toEqual(b.talked);
        expect(l.state.explore).toEqual({ x: 0.2, z: -9, heading: 3 });
        expect(l.state.playTimeSec).toBe(321);
        // 再開した支度から、もう一度出陣できる
        const again = finishTalk(l.state, 'gate', 'depart');
        expect(battleSetupFor(again).units.find((u) => u.id === 'a_tashiro')).toBeDefined();
    });

    it('戦後の自動保存：合戦の結果・兵・人物・関係がそのまま戻る', () => {
        const { store } = storeWith2D();
        const a = toAftermath('omori', 'defeat', { units: { a_shinpachi: { status: 'destroyed', end: 0 } } });
        expect(store.save(a, 'aftermath', now).ok).toBe(true);
        const l = store.load();
        if (l.status !== 'ok') throw new Error(l.status);
        expect(l.state.phase).toBe('aftermath');
        expect(l.state.battle).toEqual(a.battle);
        expect(l.state.troops).toEqual(a.troops);
        expect(l.state.characters).toEqual(a.characters);
        expect(l.state.characters.shinpachi).toBe('captured');
        expect(l.state.relations).toEqual(a.relations);
        // 読み込んだ戦後から結末へ進める（結末は保存前と同じ）
        const e = finishTalk(l.state, 'genzo', 'end_chapter');
        expect(e.ending).toBe(finishTalk(a, 'genzo', 'end_chapter').ending);
    });

    it('手動保存は探索中（explore・muster・aftermath）だけ。合戦・軍議の途中は not_now', () => {
        const { store } = storeWith2D();
        expect(store.save(newGame(), 'manual', now).ok).toBe(true);
        expect(store.save(toMuster('alone'), 'manual', now).ok).toBe(true);
        expect(store.save(toAftermath('alone', 'victory'), 'manual', now).ok).toBe(true);
        expect(store.save(toBattle('alone'), 'manual', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(finishTalk(newGame(), 'genzo', 'open_council'), 'manual', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(toMuster('alone'), 'departure', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(store.save(toBattle('alone'), 'aftermath', now)).toMatchObject({ ok: false, reason: 'not_now' });
        // 失敗した保存は前の保存を残す
        const l = store.load();
        expect(l.status === 'ok' && l.data.phase).toBe('aftermath');
    });

    it('章の結末も保存でき、読み込むと結末のまま', () => {
        const { store } = storeWith2D();
        const e = finishTalk(toAftermath('alone', 'retreat'), 'genzo', 'end_chapter');
        expect(canSaveAt(e, 'ending')).toBe(true);
        expect(store.save(e, 'ending', now).ok).toBe(true);
        const l = store.load();
        expect(l.status === 'ok' && l.state.phase).toBe('ending');
        expect(l.status === 'ok' && l.state.ending).toBe('retreat');
    });

    it('つづきからの説明に段階・選択・保存の種類・日時が入る', () => {
        const d = toSaveData(toBattle('omori'), 'departure', now)!;
        const text = describeSave(d);
        expect(text).toContain('出陣前');
        expect(text).toContain('大森家と組んだ');
        expect(text).toContain('自動保存');
        expect(text).toMatch(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/);
    });
});

describe('失敗の扱い', () => {
    it('保存先が無い → unavailable', () => {
        const store = new CampaignSaveStore(null);
        expect(store.save(newGame(), 'manual', now)).toMatchObject({ ok: false, reason: 'unavailable' });
        expect(store.load().status).toBe('unavailable');
    });

    it('容量不足 → quota（成功扱いにしない。前の保存は残る）', () => {
        const { storage, store } = storeWith2D();
        expect(store.save(newGame(), 'manual', now).ok).toBe(true);
        const before = storage.data.get(CAMPAIGN_SAVE_KEY);
        storage.setItem = () => {
            throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
        };
        const res = store.save(toMuster('tashiro'), 'manual', now);
        expect(res).toMatchObject({ ok: false, reason: 'quota' });
        if (!res.ok) expect(res.message).toContain('いっぱい');
        expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(before);
    });

    it('書いたはずの内容が読み戻せない → verify', () => {
        const storage = new MemoryStorage();
        storage.setItem = () => {};
        expect(new CampaignSaveStore(storage).save(newGame(), 'manual', now)).toMatchObject({ ok: false, reason: 'verify' });
    });

    it('SecurityError → unavailable、それ以外の例外 → unknown', () => {
        const s1 = new MemoryStorage();
        s1.setItem = () => {
            throw Object.assign(new Error('denied'), { name: 'SecurityError' });
        };
        expect(new CampaignSaveStore(s1).save(newGame(), 'manual', now)).toMatchObject({ ok: false, reason: 'unavailable' });
        const s2 = new MemoryStorage();
        s2.setItem = () => {
            throw new Error('?');
        };
        expect(new CampaignSaveStore(s2).save(newGame(), 'manual', now)).toMatchObject({ ok: false, reason: 'unknown' });
    });

    it('読むときの例外 → unavailable。保存が無い → none', () => {
        const storage = new MemoryStorage();
        const store = new CampaignSaveStore(storage);
        expect(store.load().status).toBe('none');
        storage.getItem = () => {
            throw new Error('denied');
        };
        expect(store.load().status).toBe('unavailable');
    });

    it('壊れたデータ → corrupt（勝手に消さない）', () => {
        const { storage, store } = storeWith2D();
        storage.data.set(CAMPAIGN_SAVE_KEY, '{not json');
        const l = store.load();
        expect(l.status).toBe('corrupt');
        expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe('{not json');
        expect(storage.touched.some((t) => t.op === 'remove')).toBe(false);
    });
});

describe('形・値の範囲・段階との食い違いの検査', () => {
    const base = () => validJson(toAftermath('tashiro', 'victory'), 'aftermath');
    const bad = (patch: (d: Record<string, unknown>) => void, from: () => Record<string, unknown> = base) => {
        const d = from();
        patch(d);
        return parseSaveData(JSON.stringify(d));
    };

    it('正しいデータは読める。関係の端（-100・100）も読める', () => {
        expect(parseSaveData(JSON.stringify(base()))).not.toBeNull();
        expect(bad((d) => ((d.relations as Record<string, number>).washio = -100))).not.toBeNull();
        expect(bad((d) => ((d.relations as Record<string, number>).tashiro = 100))).not.toBeNull();
    });

    it('版・日時・保存の種類・遊んだ時間がおかしい', () => {
        expect(bad((d) => (d.version = 2))).toBeNull();
        expect(bad((d) => delete d.version)).toBeNull();
        expect(bad((d) => (d.savedAt = 'yesterday'))).toBeNull();
        expect(bad((d) => (d.point = 'battle'))).toBeNull();
        expect(bad((d) => (d.playTimeSec = -1))).toBeNull();
        expect(bad((d) => (d.playTimeSec = 'x'))).toBeNull();
        expect(parseSaveData('null')).toBeNull();
        expect(parseSaveData('[]')).toBeNull();
        expect(parseSaveData('')).toBeNull();
    });

    it('関係・兵・人物・済み印・位置の値がおかしい', () => {
        expect(bad((d) => ((d.relations as Record<string, number>).omori = 101))).toBeNull();
        expect(bad((d) => delete (d.relations as Record<string, number>).washio)).toBeNull();
        expect(bad((d) => ((d.troops as Record<string, number>).genzo = -1))).toBeNull();
        expect(bad((d) => ((d.troops as Record<string, number>).genzo = 10.5))).toBeNull();
        expect(bad((d) => ((d.troops as Record<string, number>).genzo = 1e9))).toBeNull();
        expect(bad((d) => ((d.characters as Record<string, string>).genzo = 'dead'))).toBeNull();
        expect(bad((d) => ((d.talked as Record<string, unknown>)['explore.nobody'] = true))).toBeNull();
        expect(bad((d) => ((d.talked as Record<string, unknown>)['explore.genzo'] = 'yes'))).toBeNull();
        expect(bad((d) => (d.explore = { x: 1, z: Number.MAX_VALUE, heading: 0 }))).toBeNull();
        expect(bad((d) => (d.explore = { x: 1, z: 2 }))).toBeNull();
        expect(bad((d) => (d.alliance = 'washio'))).toBeNull();
    });

    it('合戦の結果の形がおかしい', () => {
        const units = (d: Record<string, unknown>) => (d.battle as { units: Record<string, unknown>[] }).units;
        expect(bad((d) => ((d.battle as Record<string, unknown>).result = 'draw'))).toBeNull();
        expect(bad((d) => ((d.battle as Record<string, unknown>).reason = 'nightfall'))).toBeNull(); // 勝利なのに日没
        expect(bad((d) => (units(d)[0]!.endStrength = (units(d)[0]!.startStrength as number) + 1))).toBeNull();
        expect(bad((d) => (units(d)[0]!.status = 'dead'))).toBeNull();
        expect(bad((d) => (units(d)[1]!.id = units(d)[0]!.id))).toBeNull();
    });

    it('段階と中身の食い違い', () => {
        // 戦後なのに合戦の結果が無い
        expect(bad((d) => (d.battle = null))).toBeNull();
        // 戦後なのに協力陣営が無い
        expect(bad((d) => (d.alliance = null))).toBeNull();
        // 戦後なのに結末が決まっている
        expect(bad((d) => (d.ending = 'tashiro_victory'))).toBeNull();
        // 探索（出陣前）なのに合戦の結果・協力陣営がある
        const explore = () => validJson(newGame(), 'manual');
        expect(parseSaveData(JSON.stringify(explore()))).not.toBeNull();
        expect(bad((d) => (d.alliance = 'tashiro'), explore)).toBeNull();
        expect(bad((d) => (d.battle = base().battle), explore)).toBeNull();
        // 出陣前の自動保存なのに段階が探索
        expect(bad((d) => (d.phase = 'explore'), () => validJson(toBattle('alone'), 'departure'))).toBeNull();
        // 軍議の途中は保存に入らない
        expect(bad((d) => (d.phase = 'council'), explore)).toBeNull();
        // 結末なのに結末が無い
        const ending = () => validJson(finishTalk(toAftermath('alone', 'victory'), 'genzo', 'end_chapter'), 'ending');
        expect(parseSaveData(JSON.stringify(ending()))).not.toBeNull();
        expect(bad((d) => (d.ending = null), ending)).toBeNull();
        expect(bad((d) => (d.ending = 'bad_end'), ending)).toBeNull();
    });
});

describe('2D 版の保存（koto-sengoku/save）には触れない', () => {
    it('保存・読み込み・控えのどれでも、2D 版のキーは読みも書きも消しもしない', () => {
        const { storage, store } = storeWith2D();
        store.save(newGame(), 'manual', now);
        store.save(toBattle('tashiro'), 'departure', now);
        store.load();
        store.archivePrevious();
        store.loadArchived();
        store.save(toAftermath('tashiro', 'victory'), 'aftermath', now);
        storage.data.set(CAMPAIGN_SAVE_KEY, 'broken');
        store.load();
        expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D_DATA);
        expect(storage.touched.filter((t) => t.key === LEGACY_2D_SAVE_KEY)).toEqual([]);
        expect(new Set(storage.touched.map((t) => t.key))).toEqual(new Set([CAMPAIGN_SAVE_KEY, CAMPAIGN_SAVE_ARCHIVE_KEY]));
    });

    it('2D 版のキーを保存先にはできない', () => {
        expect(() => new CampaignSaveStore(new MemoryStorage(), LEGACY_2D_SAVE_KEY)).toThrow();
        expect(() => new CampaignSaveStore(new MemoryStorage(), CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY)).toThrow();
        expect(CAMPAIGN_SAVE_KEY).not.toBe(LEGACY_2D_SAVE_KEY);
    });

    it('2D 版の保存データは 3D 版の保存としては読まない', () => {
        expect(parseSaveData(LEGACY_2D_DATA)).toBeNull();
    });
});

describe('「はじめから」の前の控え', () => {
    it('今の保存を控えに写し、新しい章の保存で上書きしても控えは残る', () => {
        const { store } = storeWith2D();
        const old = toAftermath('omori', 'victory');
        store.save(old, 'aftermath', now);
        expect(store.archivePrevious()).toBe(true);
        store.save(toBattle('alone'), 'departure', now);
        const arch = store.loadArchived();
        expect(arch.status === 'ok' && arch.state.alliance).toBe('omori');
        const cur = store.load();
        expect(cur.status === 'ok' && cur.state.alliance).toBe('alone');
    });

    it('写す物が無ければ何もしない（true）。保存先が無ければ false', () => {
        expect(new CampaignSaveStore(new MemoryStorage()).archivePrevious()).toBe(true);
        expect(new CampaignSaveStore(null).archivePrevious()).toBe(false);
    });
});
