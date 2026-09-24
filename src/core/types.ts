export interface Vec2 {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

export const FACING_VECTORS: Record<Facing, Vec2> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

export function isFacing(v: unknown): v is Facing {
    return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}
