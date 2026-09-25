/**
 * 比較用の小さな場面の配置（メートル）。素材の組み立て（書き出し）と、動かすときの当たり判定の両方で使う。
 *   y が上、道は南北（z）。南（+z）から北（-z）へ向かうと城門。
 *   城門（高麗門）と土塀、道の西に町家 1 軒、東に松、町家の裏に広葉樹。
 */
export const GATE = { x: 0, z: -12, halfOpening: 1.8, pillarX: 2.0, wallEnd: 13 } as const;
export const WALL = { thick: 0.7, height: 2.9 } as const;
/** 町家：x0〜x1（東の x1 が道に面した表）、z0〜z1 */
export const HOUSE = { x0: -10.2, x1: -4.2, z0: -5.6, z1: 2.6 } as const;
export const ROAD = { halfWidth: 2.6, z0: -40, z1: 30 } as const;
export const PINE = { x: 5.6, z: -8.6 } as const;
export const TREE2 = { x: -13.2, z: -8.2 } as const;
export const START = { x: 0.8, z: 0.5 } as const;
/** 動ける範囲 */
export const BOUNDS = { x0: -22, x1: 20, z0: -30, z1: 18 } as const;

export interface Rect {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

/** 通れない所（上から見た四角形） */
export function colliders(): Rect[] {
    const g = GATE;
    const t = WALL.thick / 2;
    const r: Rect[] = [];
    // 土塀（門の柱の外側から左右へ）
    r.push({ x0: -g.wallEnd, x1: -g.pillarX - 0.2, z0: g.z - t, z1: g.z + t });
    r.push({ x0: g.pillarX + 0.2, x1: g.wallEnd, z0: g.z - t, z1: g.z + t });
    // 門の柱（鏡柱）と控柱
    for (const s of [-1, 1]) {
        r.push({ x0: s * g.pillarX - 0.3, x1: s * g.pillarX + 0.3, z0: g.z - 0.35, z1: g.z + 0.35 });
        r.push({ x0: s * g.pillarX - 0.2, x1: s * g.pillarX + 0.2, z0: g.z - 2.0, z1: g.z - 1.6 });
    }
    // 開いた門扉（内側へ開く）
    for (const s of [-1, 1]) {
        r.push({ x0: Math.min(s * 1.8, s * 1.15), x1: Math.max(s * 1.8, s * 1.15), z0: g.z - 2.0, z1: g.z - 0.25 });
    }
    // 町家（庇の下の石まで）
    r.push({ x0: HOUSE.x0 - 0.1, x1: HOUSE.x1 + 0.25, z0: HOUSE.z0 - 0.1, z1: HOUSE.z1 + 0.1 });
    // 木の幹
    r.push({ x0: PINE.x - 0.35, x1: PINE.x + 0.35, z0: PINE.z - 0.35, z1: PINE.z + 0.35 });
    r.push({ x0: TREE2.x - 0.35, x1: TREE2.x + 0.35, z0: TREE2.z - 0.35, z1: TREE2.z + 0.35 });
    return r;
}
