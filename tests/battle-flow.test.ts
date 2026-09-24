import { describe, expect, it } from 'vitest';
import { STATS, createBattle, emptyBattleRecord, type BattleResult } from '../src/core/battle/model';
import { BattleSession } from '../src/core/battle/session';
import { SPAR_CHOICES, objectiveText } from '../src/core/dialogue';
import type { InputFrame } from '../src/core/input';
import { SAVE_VERSION, SaveStore, fromSaveData, parseSaveData, toSaveData, type StorageLike } from '../src/core/save';
import { BATTLE_RETURN_TILE, GameSession, type GameEvent } from '../src/core/session';
import { tileCenter } from '../src/core/map';

class MemoryStorage implements StorageLike {
    data = new Map<string, string>();
    getItem(k: string) { return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { this.data.set(k, v); }
    removeItem(k: string) { this.data.delete(k); }
}

const DT = 1 / 60;
const idle: InputFrame = { moveX: 0, moveY: 0, action: false };
const press: InputFrame = { moveX: 0, moveY: 0, action: true };
const now = new Date('2026-09-24T12:00:00Z');

/** 源蔵の隣に立たせて話しかける */
function talkToRetainer(s: GameSession): GameEvent[] {
    const p = tileCenter(BATTLE_RETURN_TILE.tx, BATTLE_RETURN_TILE.ty);
    s.state.player.x = p.x;
    s.state.player.y = p.y;
    s.state.player.facing = 'right';
    return s.step(press, DT);
}

/** 選択肢が出るまで会話を送る */
function advanceToChoices(s: GameSession): void {
    for (let i = 0; i < 20 && !s.currentChoices(); i++) s.step(press, DT);
    expect(s.currentChoices()).not.toBeNull();
}

const result = (o: Partial<BattleResult> = {}): BattleResult => ({
    outcome: 'victory',
    retainersDown: { genzo: false, shinpachi: true },
    defeated: 4,
    seconds: 37,
    ...o,
});

describe('家臣との会話から模擬戦へ', () => {
    it('会話の最後に「模擬戦をする／今はやめておく」が出て、最初は「今はやめておく」が選ばれている', () => {
        const s = new GameSession();
        const ev = talkToRetainer(s);
        expect(ev).toContainEqual({ type: 'dialogueStarted', target: 'retainer' });
        advanceToChoices(s);
        expect(s.currentChoices()!.map((c) => c.label)).toEqual(SPAR_CHOICES.map((c) => c.label));
        expect(s.state.dialogue!.choice).toBe(1);
    });

    it('決定を連打して会話を送っても、模擬戦は始まらない（今はやめておく）', () => {
        const s = new GameSession();
        talkToRetainer(s);
        const events: GameEvent[] = [];
        for (let i = 0; i < 30 && s.state.dialogue; i++) events.push(...s.step(press, DT));
        expect(s.state.dialogue).toBeNull();
        expect(events).toContainEqual({ type: 'choiceSelected', choice: 'decline' });
        expect(events).not.toContainEqual({ type: 'choiceSelected', choice: 'spar' });
    });

    it('上で「模擬戦をする」を選んで決定すると、模擬戦の開始を知らせる', () => {
        const s = new GameSession();
        talkToRetainer(s);
        advanceToChoices(s);
        s.step({ moveX: 0, moveY: -1, action: false }, DT); // 上
        // 押しっぱなしでは 1 つしか動かない
        s.step({ moveX: 0, moveY: -1, action: false }, DT);
        expect(s.state.dialogue!.choice).toBe(0);
        const ev = s.step(press, DT);
        expect(ev).toContainEqual({ type: 'choiceSelected', choice: 'spar' });
        expect(s.state.dialogue).toBeNull();
    });

    it('画面の選択肢ボタン（selectChoice）でも選べる。選択肢が出ていないときは何もしない', () => {
        const s = new GameSession();
        talkToRetainer(s);
        expect(s.selectChoice(0)).toEqual([]); // まだ最初の行
        advanceToChoices(s);
        expect(s.selectChoice(5)).toEqual([]);
        const ev = s.selectChoice(0);
        expect(ev).toContainEqual({ type: 'choiceSelected', choice: 'spar' });
    });

    it('高札などの会話には選択肢がない', () => {
        const s = new GameSession();
        s.state.flags.metRetainer = true;
        s.talkTo('notice');
        for (let i = 0; i < 5 && s.state.dialogue; i++) {
            expect(s.currentChoices()).toBeNull();
            s.step(press, DT);
        }
        expect(s.state.dialogue).toBeNull();
    });
});

describe('城へ戻る → 結果に応じた会話', () => {
    it('戻ると源蔵の隣に立ち、結果が記録され、目的が「結果を話そう」になる', () => {
        const s = new GameSession();
        s.state.player.x = 50 * 16; // どこにいても
        s.returnFromBattle(result());
        const p = tileCenter(BATTLE_RETURN_TILE.tx, BATTLE_RETURN_TILE.ty);
        expect(s.state.player).toMatchObject({ x: p.x, y: p.y, facing: 'right' });
        expect(s.state.area).toBe('castle');
        expect(s.state.battle).toMatchObject({ victories: 1, defeats: 0, retreats: 0, debriefPending: true });
        expect(s.state.battle.last).toEqual(result());
        expect(objectiveText(s.state.flags, s.state.battle)).toContain('模擬戦の結果');
        // 源蔵が正面にいるので、そのまま話しかけられる
        expect(s.nearbyInteractable()?.target).toBe('retainer');
    });

    it.each([
        ['victory', 'お見事'],
        ['defeat', '不覚'],
        ['retreat', '引き際'],
    ] as const)('%s のときは結果に合った会話になり、最後にもう一度挑むか聞かれる', (outcome, word) => {
        const s = new GameSession();
        s.returnFromBattle(result({ outcome, defeated: outcome === 'victory' ? 4 : 1 }));
        s.talkTo('retainer');
        const d = s.state.dialogue!;
        expect(d.script.id).toBe(`debrief-${outcome}`);
        expect(d.script.lines.map((l) => l.text).join('')).toContain(word);
        expect(d.script.lines.map((l) => l.text).join('')).toContain('手当て');
        // 話し始めた時点で報告済み
        expect(s.state.battle.debriefPending).toBe(false);
        advanceToChoices(s);
        expect(s.selectChoice(0)).toContainEqual({ type: 'choiceSelected', choice: 'spar' }); // 再挑戦
    });

    it('家臣の戦闘不能が会話に反映される', () => {
        const lines = (down: BattleResult['retainersDown']) => {
            const s = new GameSession();
            s.returnFromBattle(result({ retainersDown: down }));
            s.talkTo('retainer');
            return s.state.dialogue!.script.lines.map((l) => l.text).join('');
        };
        expect(lines({ genzo: false, shinpachi: false })).toContain('大きな怪我なく');
        expect(lines({ genzo: true, shinpachi: false })).toContain('それがしは途中で一本取られ');
        expect(lines({ genzo: false, shinpachi: true })).toContain('新八は途中で倒れ');
        expect(lines({ genzo: true, shinpachi: true })).toContain('それがしも新八も');
    });

    it('結果を話した後は、ふだんの会話＋模擬戦の誘いに戻る', () => {
        const s = new GameSession();
        s.returnFromBattle(result());
        s.talkTo('retainer');
        for (let i = 0; i < 20 && s.state.dialogue; i++) s.step(press, DT);
        s.talkTo('retainer');
        expect(s.state.dialogue!.script.id).toBe('retainer-first');
        const lines = s.state.dialogue!.script.lines;
        const last = lines[lines.length - 1].text;
        expect(last).toContain('いつでも');
    });
});

describe('結果の保存と再開', () => {
    it('保存 → 読み込みで、勝敗・家臣の戦闘不能・回数・報告待ちが残る', () => {
        const store = new SaveStore(new MemoryStorage());
        const s = new GameSession();
        s.returnFromBattle(result({ outcome: 'defeat', retainersDown: { genzo: true, shinpachi: false }, defeated: 2, seconds: 41 }));
        s.returnFromBattle(result({ outcome: 'retreat', retainersDown: { genzo: false, shinpachi: true }, defeated: 1, seconds: 12 }));
        expect(store.save(s.state, now).ok).toBe(true);
        const loaded = store.load();
        expect(loaded.status).toBe('ok');
        if (loaded.status !== 'ok') return;
        const st = fromSaveData(loaded.data);
        expect(st.battle).toEqual({
            last: { outcome: 'retreat', retainersDown: { genzo: false, shinpachi: true }, defeated: 1, seconds: 12 },
            victories: 0,
            defeats: 1,
            retreats: 1,
            debriefPending: true,
        });
        // 再開後、源蔵に話しかけると結果の会話になる
        const again = new GameSession(st);
        again.talkTo('retainer');
        expect(again.state.dialogue!.script.id).toBe('debrief-retreat');
    });

    it('保存データに描画用のものは入らない（数・真偽値・文字だけ）', () => {
        const s = new GameSession();
        s.returnFromBattle(result());
        const data = toSaveData(s.state, now);
        expect(data.version).toBe(SAVE_VERSION);
        expect(Object.keys(data).sort()).toEqual(['battle', 'flags', 'playTimeSec', 'player', 'savedAt', 'version']);
        const walk = (v: unknown): void => {
            if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) return;
            expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
            for (const x of Object.values(v as object)) walk(x);
        };
        walk(data);
        expect(parseSaveData(JSON.stringify(data))).toEqual(data);
    });

    it('前の形式（版 1、模擬戦の記録なし）の保存データも読める', () => {
        const v1 = {
            version: 1,
            savedAt: now.toISOString(),
            playTimeSec: 120,
            player: { x: 27 * 16 + 8, y: 9 * 16 + 8, facing: 'down' },
            flags: { metRetainer: true, visitedTown: true, visitedRoad: false, reported: false },
        };
        const data = parseSaveData(JSON.stringify(v1));
        expect(data).not.toBeNull();
        expect(data!.version).toBe(SAVE_VERSION);
        expect(data!.battle).toEqual(emptyBattleRecord());
        expect(fromSaveData(data!).flags.visitedTown).toBe(true);
    });

    it('模擬戦の記録がおかしい保存データは読み込まない', () => {
        const base = toSaveData(new GameSession().state, now);
        const bad = (battle: unknown) => parseSaveData(JSON.stringify({ ...base, battle }));
        expect(bad(undefined)).toBeNull();
        expect(bad({ ...base.battle, victories: -1 })).toBeNull();
        expect(bad({ ...base.battle, defeats: 1.5 })).toBeNull();
        expect(bad({ ...base.battle, debriefPending: true })).toBeNull(); // 結果がないのに報告待ち
        expect(bad({ ...base.battle, last: { ...result(), outcome: 'draw' } })).toBeNull();
        expect(bad({ ...base.battle, last: { ...result(), retainersDown: { genzo: 'yes', shinpachi: false } } })).toBeNull();
        expect(bad({ ...base.battle, last: { ...result(), defeated: 9 } })).toBeNull();
        expect(bad({ ...base.battle, last: result() })).not.toBeNull();
    });
});

describe('再挑戦', () => {
    it('どの結果の後でも、新しい模擬戦は全員全快・同じ配置から始まる', () => {
        for (const outcome of ['victory', 'defeat', 'retreat'] as const) {
            const b = new BattleSession();
            if (outcome === 'retreat') b.retreat();
            else {
                if (outcome === 'victory') for (const e of b.enemies()) { e.hp = 0; e.down = true; }
                else { b.hero.hp = 0; b.hero.down = true; }
                b.step(idle, DT);
            }
            expect(b.state.outcome).toBe(outcome);
            const again = new BattleSession();
            expect(JSON.stringify(again.state)).toBe(JSON.stringify(createBattle()));
            for (const u of again.state.units) expect(u.hp).toBe(STATS[u.kind].maxHp);
        }
    });
});
