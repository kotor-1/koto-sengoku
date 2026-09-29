/**
 * 歴史分岐シナリオ「元亀元年・家康」の保存（proto3d/src/campaign/ieyasu1570/save.ts）：
 * キーは 'koto-sengoku/3d-ieyasu1570'（版 2・シナリオの id 入り。版 1 も読む）。書いた後に読み戻して確かめる。
 * 版 1（信頼に家臣の酒井・石川・榊原が無い形）は、足りない信頼を初期値で補って読み、読み直して版 2 で保存しても既存の値は変わらない。
 * 出陣前の保存は支度から再開（約束の返事は残る）。戦後は勝敗・約束・支援・信頼が残り、同じ合戦を二重に反映しない。
 * 壊れたデータ・食い違いは読み込まない。架空の第一章の保存（'koto-sengoku/3d-chapter1'、版 1・2）と 2D 版の保存には触れない。
 */
import { describe, expect, it } from 'vitest';
import {
    applyIeyasuOutcomeOnce,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    ieyasuOutcomeFromSetup,
    setIeyasuExplorePose,
    withIeyasuBattleId,
} from '../proto3d/src/campaign/ieyasu1570/flow';
import {
    IEYASU_SAVE_ARCHIVE_KEY,
    IEYASU_SAVE_KEY,
    IEYASU_SAVE_VERSION,
    IeyasuSaveStore,
    ieyasuStateFromSave,
    parseIeyasuSaveData,
    toIeyasuSaveData,
} from '../proto3d/src/campaign/ieyasu1570/save';
import { INITIAL_TRUST, TRUST_IDS, type IeyasuState } from '../proto3d/src/campaign/ieyasu1570/state';
import { retainerTrustLine } from '../proto3d/src/campaign/ieyasu1570/story';
import { CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY, parseSaveData } from '../proto3d/src/campaign/save';
import { MemoryStorage, snapshot, toAftermath } from './proto3d-campaign-helpers';
import { V1_AFTERMATH_OMORI_DEFEAT } from './proto3d-save-v1-fixtures';
import { ieyasuToAftermath, ieyasuToBattle, ieyasuToMuster } from './proto3d-ieyasu-helpers';
import { IEYASU_V1_AFTERMATH_ASAI, IEYASU_V1_DEPARTURE_HOME, IEYASU_V1_ENDING_ASAI, IEYASU_V1_MUSTER_ODA } from './proto3d-ieyasu-save-v1-fixtures';

const now = new Date('2026-09-29T03:04:05Z');
const LEGACY_2D_DATA = JSON.stringify({ version: 2, savedAt: '2026-09-24T12:00:00.000Z', playTimeSec: 99, player: { x: 1, y: 2, facing: 'down' } });

/** 2D 版・架空の第一章（版 2 と版 1）の保存が入った記憶域 */
function storageWithOthers(fictionalV1 = false): { storage: MemoryStorage; fictional: string } {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_2D_SAVE_KEY, LEGACY_2D_DATA);
    if (fictionalV1) {
        storage.data.set(CAMPAIGN_SAVE_KEY, V1_AFTERMATH_OMORI_DEFEAT);
    } else {
        const fs = new CampaignSaveStore(storage);
        const r = fs.save(toAftermath('tashiro', 'victory'), 'aftermath', now);
        if (!r.ok) throw new Error('架空の第一章の保存を作れない');
    }
    storage.touched = [];
    return { storage, fictional: storage.data.get(CAMPAIGN_SAVE_KEY)! };
}

function json(state: IeyasuState, point: Parameters<typeof toIeyasuSaveData>[1]): Record<string, unknown> {
    return JSON.parse(JSON.stringify(toIeyasuSaveData(state, point, now))) as Record<string, unknown>;
}

describe('保存と読み込み', () => {
    it('データにシナリオの id と版が入り、保存先は歴史分岐のキーだけ', () => {
        const { storage, fictional } = storageWithOthers();
        const store = new IeyasuSaveStore(storage);
        const r = store.save(ieyasuToMuster('oda'), 'manual', now);
        expect(r.ok).toBe(true);
        const raw = JSON.parse(storage.data.get(IEYASU_SAVE_KEY)!) as Record<string, unknown>;
        expect(raw.scenario).toBe('ieyasu1570');
        expect(raw.version).toBe(IEYASU_SAVE_VERSION);
        expect(IEYASU_SAVE_VERSION).toBe(2);
        // 版 2 の信頼は 6 人（家臣の酒井・石川・榊原を含む）
        expect(Object.keys(raw.trust as object)).toEqual([...TRUST_IDS]);
        // 書いた後に読み戻して確かめた（set の後に get）
        const ops = storage.touched.filter((t) => t.key === IEYASU_SAVE_KEY).map((t) => t.op);
        expect(ops).toEqual(['set', 'get']);
        // ほかのキーには触れない
        expect(storage.touched.every((t) => t.key === IEYASU_SAVE_KEY)).toBe(true);
        expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
        expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D_DATA);
    });

    it('出陣前の自動保存を読み込むと、支度（出陣の確認の前）から。方針・約束の返事は残る', () => {
        const store = new IeyasuSaveStore(new MemoryStorage());
        const b = setIeyasuExplorePose(ieyasuToBattle('asai', 'accept'), { x: 0.3, z: -8, heading: 2 });
        expect(store.save(b, 'departure', now).ok).toBe(true);
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        expect(l.state.phase).toBe('muster');
        expect(l.state.policy).toBe('asai');
        expect(l.state.pledge).toEqual(b.pledge);
        expect(l.state.battleId).toBeNull();
        expect(l.summary).toContain('浅井との協力を選んだ');
        // もう一度出陣できる
        const again = finishTalkIeyasu(l.state, 'gate', 'depart');
        expect(ieyasuBattleSetup(again).pledge?.targetId).toBe('a_nagamasa');
    });

    it('戦後の保存：勝敗・約束・支援・信頼・兵・能力の記録が戻り、同じ合戦をもう一度反映しない', () => {
        for (const [p, r, pl] of [
            ['oda', 'victory', 'broken'],
            ['asai', 'retreat', 'kept'],
            ['home', 'defeat', 'declined'],
        ] as const) {
            const store = new IeyasuSaveStore(new MemoryStorage());
            let s = ieyasuToBattle(p, pl === 'declined' ? 'decline' : 'accept');
            s = withIeyasuBattleId(s, `ieyasu1570-t-${p}`);
            const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), r, { pledge: pl === 'declined' ? undefined : pl, abilitiesUsed: { t_honjin: 12 } });
            const a = applyIeyasuOutcomeOnce(s, `ieyasu1570-t-${p}`, o).state;
            expect(store.save(a, 'aftermath', now).ok).toBe(true);
            const l = store.load();
            expect(l.status).toBe('ok');
            if (l.status !== 'ok') continue;
            const back = l.state;
            expect(back.battle?.result).toBe(r);
            expect(back.pledge?.result).toBe(pl);
            expect(back.support).toEqual(a.support);
            expect(back.trust).toEqual(a.trust);
            expect(back.troops).toEqual(a.troops);
            expect(back.battle?.abilitiesUsed).toEqual({ t_honjin: 12 });
            expect(back.appliedBattleId).toBe(`ieyasu1570-t-${p}`);
            // 開き直した後に、同じ合戦の結果が届いても二重に反映しない
            const again = applyIeyasuOutcomeOnce(back, `ieyasu1570-t-${p}`, o);
            expect(again.applied).toBe(false);
            expect(snapshot(again.state)).toEqual(snapshot(back));
        }
    });

    it('結末の保存を読み込むと結末から', () => {
        const store = new IeyasuSaveStore(new MemoryStorage());
        const e = finishTalkIeyasu(ieyasuToAftermath('home', 'victory', 'accept', { pledge: 'kept' }), 'tadakatsu', 'end_chapter');
        expect(store.save(e, 'ending', now).ok).toBe(true);
        const l = store.load();
        expect(l.status === 'ok' && l.state.ending).toBe('home_victory');
    });

    it('保存してよくない時点では書かない（軍議の途中・約束の返事の前の出陣など）', () => {
        const storage = new MemoryStorage();
        const store = new IeyasuSaveStore(storage);
        const council = finishTalkIeyasu(ieyasuToMuster('oda'), 'notice');
        expect(store.save(council, 'departure', now)).toMatchObject({ ok: false, reason: 'not_now' });
        expect(storage.data.has(IEYASU_SAVE_KEY)).toBe(false);
    });

    it('書き込みの失敗・読み戻しの食い違いは、成功と言わない', () => {
        class Broken extends MemoryStorage {
            override setItem(): void {
                const e = new Error('full');
                e.name = 'QuotaExceededError';
                throw e;
            }
        }
        expect(new IeyasuSaveStore(new Broken()).save(ieyasuToMuster('oda'), 'manual', now)).toMatchObject({ ok: false, reason: 'quota' });
        class Liar extends MemoryStorage {
            override getItem(k: string): string | null {
                return k === IEYASU_SAVE_KEY ? '{}' : super.getItem(k);
            }
        }
        expect(new IeyasuSaveStore(new Liar()).save(ieyasuToMuster('oda'), 'manual', now)).toMatchObject({ ok: false, reason: 'verify' });
        expect(new IeyasuSaveStore(null).save(ieyasuToMuster('oda'), 'manual', now)).toMatchObject({ ok: false, reason: 'unavailable' });
    });
});

describe('壊れたデータ・食い違い', () => {
    const aft = ieyasuToAftermath('oda', 'victory', 'accept', { pledge: 'kept' });
    const good = json(aft, 'aftermath');
    const bad = (patch: (v: Record<string, unknown>) => void) => {
        const v = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
        patch(v);
        return JSON.stringify(v);
    };
    it('正しいデータは読める', () => {
        expect(parseIeyasuSaveData(JSON.stringify(good))).not.toBeNull();
    });
    it.each([
        ['シナリオの id が違う', (v: Record<string, unknown>) => (v.scenario = 'fictional')],
        ['版が違う（まだ無い版 3）', (v: Record<string, unknown>) => (v.version = 3)],
        ['版が 0', (v: Record<string, unknown>) => (v.version = 0)],
        ['版 2 なのに家臣の信頼が無い', (v: Record<string, unknown>) => delete (v.trust as Record<string, number>).sakai],
        ['家臣の信頼が範囲外', (v: Record<string, unknown>) => ((v.trust as Record<string, number>).ishikawa = -101)],
        ['方針が無い', (v: Record<string, unknown>) => (v.policy = null)],
        ['信頼が範囲外', (v: Record<string, unknown>) => ((v.trust as Record<string, number>).oda = 500)],
        ['兵が負', (v: Record<string, unknown>) => ((v.troops as Record<string, number>).yumi = -1)],
        ['約束の対象が方針と違う', (v: Record<string, unknown>) => ((v.pledge as Record<string, unknown>).targetId = 'a_nagamasa')],
        ['約束の結果が合戦の結果と違う', (v: Record<string, unknown>) => ((v.pledge as Record<string, unknown>).result = 'broken')],
        ['守ったのに援兵が無い', (v: Record<string, unknown>) => ((v.support as Record<string, unknown>).reinforcement = false)],
        ['反映の済み印が合戦の id と違う', (v: Record<string, unknown>) => (v.appliedBattleId = 'other')],
        ['合戦の結果が無い', (v: Record<string, unknown>) => (v.battle = null)],
        ['知らない家', (v: Record<string, unknown>) => (((v.battle as { units: Record<string, unknown>[] }).units[0]!).clan = 'washio')],
        ['死亡という状態', (v: Record<string, unknown>) => ((v.characters as Record<string, string>).ieyasu = 'dead')],
    ])('%s は読み込まない（データは消さない）', (_name, patch) => {
        const storage = new MemoryStorage();
        const text = bad(patch);
        storage.data.set(IEYASU_SAVE_KEY, text);
        const l = new IeyasuSaveStore(storage).load();
        expect(l.status).toBe('corrupt');
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(text);
    });
    it('引き受けなかった約束は declined でなければならない', () => {
        const d = json(ieyasuToMuster('oda'), 'manual');
        expect(parseIeyasuSaveData(JSON.stringify(d))).not.toBeNull();
        const s = ieyasuToAftermath('home', 'retreat', 'decline');
        const v = json(s, 'aftermath');
        (v.pledge as Record<string, unknown>).result = 'broken';
        expect(parseIeyasuSaveData(JSON.stringify(v))).toBeNull();
    });
});

describe('架空の第一章の保存を守る', () => {
    it('架空の第一章の保存（版 2・版 1）は、歴史分岐の保存を書いても読んでも、そのまま・そのまま読める', () => {
        for (const v1 of [false, true]) {
            const { storage, fictional } = storageWithOthers(v1);
            const store = new IeyasuSaveStore(storage);
            store.save(ieyasuToAftermath('asai', 'victory', 'accept', { pledge: 'kept' }), 'aftermath', now);
            store.load();
            store.archivePrevious();
            expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
            const f = new CampaignSaveStore(storage).load();
            expect(f.status).toBe('ok');
            if (f.status !== 'ok') continue;
            // 田代家・大森家のまま（織田・浅井へ書き換えない）
            expect(Object.keys(f.data.relations).sort()).toEqual(['omori', 'tashiro', 'washio']);
            expect(['tashiro', 'omori', 'alone']).toContain(f.data.alliance);
            expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D_DATA);
        }
    });
    it('互いの保存を読み違えない（架空の保存は歴史分岐として読まない、その逆も）', () => {
        const { fictional } = storageWithOthers();
        expect(parseIeyasuSaveData(fictional)).toBeNull();
        expect(parseIeyasuSaveData(V1_AFTERMATH_OMORI_DEFEAT)).toBeNull();
        const h = JSON.stringify(toIeyasuSaveData(ieyasuToMuster('oda'), 'manual', now));
        expect(parseSaveData(h)).toBeNull();
    });
    it('歴史分岐の保存は、架空の第一章・2D 版のキーを使えない', () => {
        expect(() => new IeyasuSaveStore(new MemoryStorage(), CAMPAIGN_SAVE_KEY)).toThrow();
        expect(() => new IeyasuSaveStore(new MemoryStorage(), IEYASU_SAVE_KEY, LEGACY_2D_SAVE_KEY)).toThrow();
    });
    it('はじめからの控えは歴史分岐の控えのキーへ', () => {
        const storage = new MemoryStorage();
        const store = new IeyasuSaveStore(storage);
        store.save(ieyasuToMuster('home'), 'manual', now);
        expect(store.archivePrevious()).toBe(true);
        expect(storage.data.get(IEYASU_SAVE_ARCHIVE_KEY)).toBe(storage.data.get(IEYASU_SAVE_KEY));
        expect(store.loadArchived().status).toBe('ok');
    });
});

describe('版 1 の保存（信頼に家臣の 3 人が無い形）を読む', () => {
    const V1 = [
        ['支度（A・メニューから保存）', IEYASU_V1_MUSTER_ODA],
        ['出陣前（C・約束を引き受けない）', IEYASU_V1_DEPARTURE_HOME],
        ['戦後（B・撤退・約束を守った）', IEYASU_V1_AFTERMATH_ASAI],
        ['結末（B・撤退）', IEYASU_V1_ENDING_ASAI],
    ] as const;
    const ADDED = { sakai: INITIAL_TRUST.sakai, ishikawa: INITIAL_TRUST.ishikawa, sakakibara: INITIAL_TRUST.sakakibara };

    it.each(V1)('%s：読めて、版 1 にあった値はそのまま・家臣の信頼は初期値で補う', (_name, text) => {
        const raw = JSON.parse(text) as Record<string, unknown>;
        expect(raw.version).toBe(1);
        const d = parseIeyasuSaveData(text);
        expect(d).not.toBeNull();
        if (!d) return;
        expect(d.version).toBe(2);
        expect(d.trust).toEqual({ ...(raw.trust as Record<string, number>), ...ADDED });
        for (const [k, v] of Object.entries(raw)) if (k !== 'version' && k !== 'trust') expect(d[k as keyof typeof d]).toEqual(v);
    });

    it.each(V1)('%s：版 1 を読んで版 2 で保存し直しても、既存の値が変わらない（読み直しても同じ）', (_name, text) => {
        const raw = JSON.parse(text) as Record<string, unknown>;
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, text);
        const store = new IeyasuSaveStore(storage);
        const l = store.load();
        expect(l.status).toBe('ok');
        if (l.status !== 'ok') return;
        // 読むだけでは書き換えない
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(text);
        // 出陣前の保存は支度から続ける（今までどおり）。保存し直せる時点で保存し直す
        const point = raw.point === 'departure' ? 'manual' : (raw.point as 'manual' | 'aftermath' | 'ending');
        const r = store.save(l.state, point, now);
        expect(r.ok).toBe(true);
        const v2 = JSON.parse(storage.data.get(IEYASU_SAVE_KEY)!) as Record<string, unknown>;
        expect(v2.version).toBe(2);
        expect(v2.trust).toEqual({ ...(raw.trust as Record<string, number>), ...ADDED });
        const same = ['scenario', 'playTimeSec', 'policy', 'troops', 'characters', 'talked', 'pledge', 'battle', 'support', 'ending', 'explore'];
        for (const k of same) expect(v2[k]).toEqual(raw[k]);
        if (raw.point === 'departure') {
            // 支度から保存し直した：合戦の id は外れ、段階は支度（版 1 を読んだときと同じ扱い）
            expect([v2.phase, v2.battleId, v2.appliedBattleId]).toEqual(['muster', null, null]);
        } else {
            for (const k of ['point', 'phase', 'battleId', 'appliedBattleId']) expect(v2[k]).toEqual(raw[k]);
        }
        // 版 2 を読み直すと、版 1 を読んだときと同じ状態（保存の時刻だけ違う）
        const again = store.load();
        expect(again.status).toBe('ok');
        if (again.status !== 'ok') return;
        expect({ ...again.state, savedAt: null }).toEqual({ ...l.state, savedAt: null });
    });

    it('版 1 の戦後を読んで続けても、同じ合戦を二重に反映しない・結末へ進める', () => {
        const d = parseIeyasuSaveData(IEYASU_V1_AFTERMATH_ASAI)!;
        const s = ieyasuStateFromSave(d);
        expect(s.appliedBattleId).toBe('ieyasu1570-v1fixture');
        expect(applyIeyasuOutcomeOnce(s, 'ieyasu1570-v1fixture', s.battle!).applied).toBe(false);
        const e = finishTalkIeyasu(s, 'tadakatsu', 'end_chapter');
        expect(e.ending).toBe('retreat');
        // 版 1 にあった信頼はそのまま（家臣の信頼は初期値。結末で動かさない）
        expect(e.trust).toEqual({ oda: 0, asai: 35, tadakatsu: 40, ...ADDED });
        // 結末の本文の家臣の 1 行は、動かなかった形で語る（勝敗・約束から勝手に作らない）
        expect(retainerTrustLine(e)).toBe('酒井忠次は、この日の采配を黙って見届けた。石川数正は、約束の件で多くを語らなかった。（信頼：酒井 ±0・石川 ±0）');
    });

    it('版 1 の信頼が範囲外・欠けていれば読まない（データは消さない）', () => {
        for (const patch of [(t: Record<string, number>) => (t.oda = 101), (t: Record<string, number>) => delete t.tadakatsu]) {
            const v = JSON.parse(IEYASU_V1_MUSTER_ODA) as { trust: Record<string, number> };
            patch(v.trust);
            const text = JSON.stringify(v);
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, text);
            expect(new IeyasuSaveStore(storage).load().status).toBe('corrupt');
            expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(text);
        }
    });

    it('版 1 の歴史分岐の保存を読んで保存し直しても、架空の第一章（版 1・版 2）と 2D 版の保存には触れない', () => {
        for (const v1 of [false, true]) {
            const { storage, fictional } = storageWithOthers(v1);
            storage.data.set(IEYASU_SAVE_KEY, IEYASU_V1_AFTERMATH_ASAI);
            const store = new IeyasuSaveStore(storage);
            const l = store.load();
            expect(l.status).toBe('ok');
            if (l.status === 'ok') expect(store.save(l.state, 'aftermath', now).ok).toBe(true);
            expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
            expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D_DATA);
            const f = new CampaignSaveStore(storage).load();
            expect(f.status === 'ok' && Object.keys(f.data.relations).sort()).toEqual(['omori', 'tashiro', 'washio']);
        }
    });
});
