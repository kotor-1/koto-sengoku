import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../src/core/input';
import { RETAINER_POS, tileCenter } from '../src/core/map';
import { GameSession, facingFromVector } from '../src/core/session';
import { createNewGameState } from '../src/core/state';
import { TILE_SIZE } from '../src/core/constants';

const press: InputFrame = { moveX: 0, moveY: 0, action: true };
const move = (x: number, y: number): InputFrame => ({ moveX: x, moveY: y, action: false });

function run(s: GameSession, f: InputFrame, seconds: number) {
    const events = [];
    for (let t = 0; t < seconds; t += 1 / 60) events.push(...s.step(f, 1 / 60));
    return events;
}

/** 家臣の左隣に立って右を向いた状態 */
function nextToRetainer(): GameSession {
    const st = createNewGameState();
    const c = tileCenter(RETAINER_POS.tx - 1, RETAINER_POS.ty);
    st.player.x = c.x;
    st.player.y = c.y;
    st.player.facing = 'right';
    return new GameSession(st);
}

describe('GameSession 移動', () => {
    it('入力の方向へ歩く', () => {
        const s = new GameSession();
        const y0 = s.state.player.y;
        run(s, move(0, 1), 0.5);
        expect(s.state.player.y).toBeGreaterThan(y0 + 20);
        expect(s.state.player.facing).toBe('down');
    });

    it('城壁（北）を通り抜けられない', () => {
        const s = new GameSession();
        run(s, move(0, -1), 5);
        // 城内の北端は y=2 タイル。壁 (y=1) に入り込まない
        expect(s.state.player.y).toBeGreaterThanOrEqual(2 * TILE_SIZE + 4 - 0.01);
    });

    it('家臣を通り抜けられない', () => {
        const s = nextToRetainer();
        run(s, move(1, 0), 2);
        const r = s.state.retainer;
        expect(s.state.player.x).toBeLessThanOrEqual(r.x - 10 + 0.01);
    });

    it('大きな dt でも壁をすり抜けない', () => {
        const s = new GameSession();
        for (let i = 0; i < 50; i++) s.step(move(0, -1), 10);
        expect(s.state.player.y).toBeGreaterThan(2 * TILE_SIZE);
    });

    it('ほぼ斜めの入力では向きがちらつかない', () => {
        expect(facingFromVector(1, 0.98, 'down')).toBe('down');
        expect(facingFromVector(1, 0.98, 'right')).toBe('right');
        expect(facingFromVector(1, 0.2, 'down')).toBe('right');
    });
});

describe('GameSession 会話', () => {
    it('家臣の方を向いて話すと会話が始まり、最後まで進むと終わる', () => {
        const s = nextToRetainer();
        const ev = s.step(press, 1 / 60);
        expect(ev).toContainEqual({ type: 'dialogueStarted', target: 'retainer' });
        expect(s.state.flags.metRetainer).toBe(true);
        expect(s.currentLine()?.speaker).toBe('源蔵');
        expect(s.state.retainer.facing).toBe('left');
        const total = s.state.dialogue!.script.lines.length;
        let ended = false;
        for (let i = 0; i < total; i++) {
            ended = s.step(press, 1 / 60).some((e) => e.type === 'dialogueEnded');
        }
        expect(ended).toBe(true);
        expect(s.state.dialogue).toBeNull();
    });

    it('会話中は移動しない', () => {
        const s = nextToRetainer();
        s.step(press, 1 / 60);
        const x = s.state.player.x;
        run(s, move(-1, 0), 0.5);
        expect(s.state.player.x).toBe(x);
    });

    it('背を向けていると話しかけられない', () => {
        const s = nextToRetainer();
        s.state.player.facing = 'left';
        s.step(press, 1 / 60);
        expect(s.state.dialogue).toBeNull();
    });

    it('見回り後に報告すると完了フラグが立つ', () => {
        const s = nextToRetainer();
        Object.assign(s.state.flags, { metRetainer: true, visitedTown: true, visitedRoad: true });
        s.step(press, 1 / 60);
        expect(s.state.dialogue?.script.id).toBe('retainer-report');
        expect(s.state.flags.reported).toBe(true);
    });
});

describe('GameSession 地域', () => {
    it('城門を出て城下町に入ると地域が変わり、訪問済みになる', () => {
        const s = new GameSession();
        // 天守前 (27,9) から真南へ：城門 → 橋 → 城下町
        const ev = run(s, move(0, 1), 5);
        const areas = ev.filter((e) => e.type === 'areaChanged').map((e) => (e as { area: string }).area);
        expect(areas).toEqual(['gate', 'town']);
        expect(s.state.flags.visitedTown).toBe(true);
        expect(s.state.flags.visitedRoad).toBe(false);
    });
});
