import type { Vec2 } from './types';

/**
 * スティックの中心からの指のずれ (dx, dy) を、長さ 0〜1 の入力に変換する。
 * 無反応域より内側は 0、外側は 0〜1 に引き伸ばす。
 */
export function stickVector(dx: number, dy: number, radius: number, deadzone: number): Vec2 {
    const dist = Math.hypot(dx, dy);
    if (radius <= 0 || dist === 0) return { x: 0, y: 0 };
    const raw = Math.min(1, dist / radius);
    if (raw <= deadzone) return { x: 0, y: 0 };
    const mag = (raw - deadzone) / (1 - deadzone);
    return { x: (dx / dist) * mag, y: (dy / dist) * mag };
}

/** つまみの見た目の位置（半径の円内に収める） */
export function clampToRadius(dx: number, dy: number, radius: number): Vec2 {
    const dist = Math.hypot(dx, dy);
    if (dist <= radius || dist === 0) return { x: dx, y: dy };
    return { x: (dx / dist) * radius, y: (dy / dist) * radius };
}
