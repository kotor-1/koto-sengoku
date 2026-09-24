import type { Rect, Vec2 } from './types';

export type BlockedQuery = (r: Rect) => boolean;

export function actorBox(pos: Vec2, halfW: number, halfH: number): Rect {
    return { x: pos.x - halfW, y: pos.y - halfH, w: halfW * 2, h: halfH * 2 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 2 つの矩形の隙間（重なっていれば 0） */
export function rectGap(a: Rect, b: Rect): number {
    const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
    const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
    return Math.hypot(dx, dy);
}

export interface MoveResult {
    x: number;
    y: number;
    /** 実際に動いた距離 */
    moved: number;
}

/**
 * 当たり判定付きの移動。
 * - 横・縦を別々に動かすので、斜めに壁へ当たると壁沿いに滑る。
 * - 大きく動くときは小刻みに分けて、壁のすり抜けを防ぐ。
 * - 当たったときは二分探索で壁ぎりぎりまで寄せる。
 */
export function moveWithCollision(
    pos: Vec2,
    dx: number,
    dy: number,
    halfW: number,
    halfH: number,
    blocked: BlockedQuery,
): MoveResult {
    const maxStep = 4;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
    let x = pos.x;
    let y = pos.y;
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
        x = advanceAxis(x, y, sx, 'x', halfW, halfH, blocked);
        y = advanceAxis(x, y, sy, 'y', halfW, halfH, blocked);
    }
    return { x, y, moved: Math.hypot(x - pos.x, y - pos.y) };
}

function advanceAxis(
    x: number,
    y: number,
    delta: number,
    axis: 'x' | 'y',
    halfW: number,
    halfH: number,
    blocked: BlockedQuery,
): number {
    if (delta === 0) return axis === 'x' ? x : y;
    const at = (t: number): Rect =>
        axis === 'x'
            ? actorBox({ x: x + delta * t, y }, halfW, halfH)
            : actorBox({ x, y: y + delta * t }, halfW, halfH);
    const base = axis === 'x' ? x : y;
    if (!blocked(at(1))) return base + delta;
    // 当たる：動ける割合を二分探索
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (blocked(at(mid))) hi = mid;
        else lo = mid;
    }
    return base + delta * lo;
}
