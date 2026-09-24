import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/core/session';
import { SaveStore, fromSaveData, parseSaveData, toSaveData, type StorageLike } from '../src/core/save';
import { createNewGameState } from '../src/core/state';

class MemoryStorage implements StorageLike {
    data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
    removeItem(k: string) { this.data.delete(k); }
}

const now = new Date('2026-09-24T12:00:00Z');

function playedState() {
    const s = new GameSession();
    for (let i = 0; i < 30; i++) s.step({ moveX: 0, moveY: 1, action: false }, 1 / 60);
    s.state.flags.metRetainer = true;
    return s.state;
}

describe('SaveStore', () => {
    it('保存して読み込むと同じ位置・フラグで再開できる', () => {
        const store = new SaveStore(new MemoryStorage());
        const st = playedState();
        const res = store.save(st, now);
        expect(res).toEqual({ ok: true, savedAt: now.toISOString() });
        const loaded = store.load();
        expect(loaded.status).toBe('ok');
        if (loaded.status !== 'ok') return;
        const restored = fromSaveData(loaded.data);
        expect(restored.player.x).toBeCloseTo(st.player.x);
        expect(restored.player.y).toBeCloseTo(st.player.y);
        expect(restored.flags).toEqual(st.flags);
        expect(restored.dialogue).toBeNull();
    });

    it('保存領域がない場合は失敗を返す', () => {
        const res = new SaveStore(null).save(createNewGameState(), now);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe('unavailable');
    });

    it('容量不足の例外は quota として失敗を返す', () => {
        const storage = new MemoryStorage();
        storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
        const res = new SaveStore(storage).save(createNewGameState(), now);
        expect(res).toMatchObject({ ok: false, reason: 'quota' });
    });

    it('書き込みが反映されない場合は成功扱いにしない', () => {
        const storage = new MemoryStorage();
        storage.setItem = () => {}; // 黙って捨てるストレージ
        const res = new SaveStore(storage).save(createNewGameState(), now);
        expect(res).toMatchObject({ ok: false, reason: 'verify' });
    });

    it('保存がなければ none、壊れていれば corrupt', () => {
        const storage = new MemoryStorage();
        const store = new SaveStore(storage, 'k');
        expect(store.load().status).toBe('none');
        storage.setItem('k', '{broken');
        expect(store.load().status).toBe('corrupt');
        storage.setItem('k', JSON.stringify({ version: 999 }));
        expect(store.load().status).toBe('corrupt');
    });

    it('読み込みで例外が出るストレージは unavailable', () => {
        const storage = new MemoryStorage();
        storage.getItem = () => { throw new Error('denied'); };
        expect(new SaveStore(storage).load().status).toBe('unavailable');
    });
});

describe('parseSaveData / fromSaveData', () => {
    it('不正な値を弾く', () => {
        const good = toSaveData(createNewGameState(), now);
        expect(parseSaveData(JSON.stringify(good))).not.toBeNull();
        expect(parseSaveData(JSON.stringify({ ...good, player: { ...good.player, x: 'a' } }))).toBeNull();
        expect(parseSaveData(JSON.stringify({ ...good, player: { ...good.player, facing: 'north' } }))).toBeNull();
        expect(parseSaveData(JSON.stringify({ ...good, flags: { ...good.flags, reported: 1 } }))).toBeNull();
        expect(parseSaveData(JSON.stringify({ ...good, player: { ...good.player, x: 1e9 } }))).toBeNull();
    });

    it('壁の中の座標は初期位置に戻す', () => {
        const data = toSaveData(createNewGameState(), now);
        data.player.x = 8; // 外周の木の中
        data.player.y = 8;
        const st = fromSaveData(data);
        expect(st.player.x).not.toBe(8);
        expect(st.area).toBe('castle');
    });
});
