/**
 * 更新間隔（フレームレート）が違っても、同じゲーム内時間なら移動距離がほぼ同じであることの確認。
 * 会話の到達（家臣に話しかけられるか）は session.test.ts で別に確かめる。
 */
import { describe, expect, it } from 'vitest';
import { MAX_STEP_SEC, WALK_SPEED } from '../src/core/constants';
import type { InputFrame } from '../src/core/input';
import { GameSession } from '../src/core/session';
import { createNewGameState } from '../src/core/state';

const move = (x: number, y: number): InputFrame => ({ moveX: x, moveY: y, action: false });

/** 広い場所（城下の十字路の南の通り）に立たせたセッション */
function openGround(tx = 27.5, ty = 30): GameSession {
    const st = createNewGameState();
    st.player.x = tx * 16 + 8;
    st.player.y = ty * 16 + 8;
    return new GameSession(st);
}

/** fps で gameSeconds 秒ぶん進めて、移動距離を返す */
function walk(fps: number, gameSeconds: number, input: InputFrame, s = openGround()): { dist: number; s: GameSession } {
    const x0 = s.state.player.x;
    const y0 = s.state.player.y;
    const frames = Math.round(gameSeconds * fps);
    for (let i = 0; i < frames; i++) s.step(input, 1 / fps);
    return { dist: Math.hypot(s.state.player.x - x0, s.state.player.y - y0), s };
}

describe('フレームレートに依存しない移動', () => {
    it('30fps と 60fps と 120fps で、1 秒の移動距離がほぼ同じ（真下）', () => {
        const d30 = walk(30, 1, move(0, 1)).dist;
        const d60 = walk(60, 1, move(0, 1)).dist;
        const d120 = walk(120, 1, move(0, 1)).dist;
        expect(d60).toBeCloseTo(WALK_SPEED, 0);
        expect(Math.abs(d30 - d60)).toBeLessThan(0.5);
        expect(Math.abs(d120 - d60)).toBeLessThan(0.5);
    });

    it('斜め移動でも 30fps と 60fps の差は小さい', () => {
        const d = (fps: number) => walk(fps, 0.8, move(Math.SQRT1_2, Math.SQRT1_2), openGround(26.5, 28.5)).dist;
        expect(Math.abs(d(30) - d(60))).toBeLessThan(0.5);
    });

    it('壁に当たって止まる位置は更新間隔によらない', () => {
        const stop = (fps: number) => {
            const { s } = walk(fps, 3, move(0, -1), new GameSession());
            return s.state.player.y;
        };
        expect(Math.abs(stop(30) - stop(60))).toBeLessThan(0.1);
    });

    it('10fps までは実時間どおり、それより遅いと 1 フレーム 0.1 秒までに抑える（ワープ防止）', () => {
        const d10 = walk(10, 1, move(0, 1)).dist;
        expect(Math.abs(d10 - WALK_SPEED)).toBeLessThan(0.5);
        // 5fps（1 フレーム 0.2 秒）はゲーム内時間が半分しか進まない＝意図した動き
        const d5 = walk(5, 1, move(0, 1)).dist;
        expect(d5).toBeCloseTo(WALK_SPEED * MAX_STEP_SEC * 5, 0);
    });

    it('タブ復帰などで 5 秒ぶんの時間が一度に来ても、1 ステップ分しか動かない', () => {
        const s = openGround();
        const y0 = s.state.player.y;
        s.step(move(0, 1), 5);
        expect(s.state.player.y - y0).toBeLessThanOrEqual(WALK_SPEED * MAX_STEP_SEC + 0.01);
    });

    it('プレイ時間も同じだけ進む（30fps / 60fps）', () => {
        const t = (fps: number) => walk(fps, 2, move(0, 0)).s.state.playTimeSec;
        expect(t(30)).toBeCloseTo(2, 5);
        expect(t(60)).toBeCloseTo(2, 5);
    });
});

