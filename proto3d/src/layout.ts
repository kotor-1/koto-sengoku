/**
 * 比較用の小さな場面の配置（メートル）。素材の組み立て（書き出し）と、動かすときの当たり判定の両方で使う。
 *   y が上、道は南北（z）。南（+z）から北（-z）へ向かうと城門。
 *   城門（高麗門）と土塀、道の両側に町家（西に 2 軒・東に 2 軒）、城門の手前の東に松、西の町家の裏に広葉樹。
 */
export const GATE = { x: 0, z: -12, halfOpening: 1.8, pillarX: 2.0, wallEnd: 13 } as const;
export const WALL = { thick: 0.7, height: 2.9 } as const;
/** 町家（元の 1 軒）：x0〜x1（東の x1 が道に面した表）、z0〜z1。ほかの町家はこれを動かし・裏返して置く */
export const HOUSE = { x0: -10.2, x1: -4.2, z0: -5.6, z1: 2.6 } as const;
/** 町家の高さ（カメラが壁・屋根を突き抜けないための範囲に使う）：軒桁・棟・庇 */
export const HOUSE_H = { eave: 4.8, ridge: 6.55, hisashiLow: 3.25, hisashiHigh: 3.95 } as const;
/**
 * 町家の置き方。side 1 は道の西（表が東、元の向き）、-1 は道の東（表が西。道の中心線を軸に裏返した向き）。dz は南へずらす距離。
 * 同じ形を使い回す（素材は 1 軒分）
 */
export interface HousePlace {
    side: 1 | -1;
    dz: number;
}
export const HOUSES: readonly HousePlace[] = [
    { side: 1, dz: 0 },
    { side: 1, dz: 9 },
    { side: -1, dz: 0 },
    { side: -1, dz: 9 },
];
/** 表示の置き方（three.js）：side -1 は縦の軸で 180° 回して、道をはさんだ向かいへ */
export function housePose(p: HousePlace): { x: number; z: number; rotY: number } {
    const cz = (HOUSE.z0 + HOUSE.z1) / 2;
    return p.side === 1 ? { x: 0, z: p.dz, rotY: 0 } : { x: 0, z: 2 * cz + p.dz, rotY: Math.PI };
}
/** 元の町家の上での四角形（x0〜x1・z0〜z1）を、置いた町家の上へ移す */
export function houseRect(p: HousePlace, r: Rect): Rect {
    const z0 = r.z0 + p.dz;
    const z1 = r.z1 + p.dz;
    return p.side === 1 ? { x0: r.x0, x1: r.x1, z0, z1 } : { x0: -r.x1, x1: -r.x0, z0, z1 };
}
/** 縁台（店先の腰掛け）：元の町家の表の、いちばん南の間 */
const BENCH: Rect = { x0: HOUSE.x1 + 0.8, x1: HOUSE.x1 + 1.4, z0: HOUSE.z0 + ((HOUSE.z1 - HOUSE.z0) * 7) / 8 - 0.8, z1: HOUSE.z0 + ((HOUSE.z1 - HOUSE.z0) * 7) / 8 + 0.8 };
/** 土の道：町家の表の近くまで（町の中は土） */
export const ROAD = { halfWidth: 3.95, z0: -40, z1: 30 } as const;
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
    // 町家（庇の下の石まで）と縁台
    for (const p of HOUSES) {
        r.push(houseRect(p, { x0: HOUSE.x0 - 0.1, x1: HOUSE.x1 + 0.25, z0: HOUSE.z0 - 0.1, z1: HOUSE.z1 + 0.1 }));
        r.push(houseRect(p, BENCH));
    }
    // 木の幹
    r.push({ x0: PINE.x - 0.35, x1: PINE.x + 0.35, z0: PINE.z - 0.35, z1: PINE.z + 0.35 });
    r.push({ x0: TREE2.x - 0.35, x1: TREE2.x + 0.35, z0: TREE2.z - 0.35, z1: TREE2.z + 0.35 });
    return r;
}

/** 上から見た四角形に高さを付けた箱（カメラが突き抜けないための、大まかな形） */
export interface Box extends Rect {
    y0: number;
    y1: number;
}

/**
 * カメラが入り込まない所。建物の壁・屋根・庇、城門の柱・梁・屋根・扉、土塀、木の幹。
 * 形そのものではなく大まかな箱（毎フレーム調べても軽いように）。
 */
export function cameraBlockers(): Box[] {
    const b: Box[] = [];
    const box = (r: Rect, y0: number, y1: number) => b.push({ ...r, y0, y1 });
    const H = HOUSE;
    for (const p of HOUSES) {
        // 壁（土台の石・格子・犬矢来まで）
        box(houseRect(p, { x0: H.x0 - 0.1, x1: H.x1 + 0.3, z0: H.z0 - 0.1, z1: H.z1 + 0.1 }), 0, HOUSE_H.eave + 0.2);
        // 大屋根（軒の出を含む）と、表の庇
        box(houseRect(p, { x0: H.x0 - 0.8, x1: H.x1 + 0.8, z0: H.z0 - 0.5, z1: H.z1 + 0.5 }), HOUSE_H.eave - 0.35, HOUSE_H.ridge + 0.3);
        box(houseRect(p, { x0: H.x1, x1: H.x1 + 1.12, z0: H.z0 - 0.2, z1: H.z1 + 0.2 }), HOUSE_H.hisashiLow, HOUSE_H.hisashiHigh);
        box(houseRect(p, BENCH), 0, 0.5);
    }
    const g = GATE;
    for (const s of [-1, 1]) {
        // 鏡柱・控柱・開いた扉
        box({ x0: s * g.pillarX - 0.25, x1: s * g.pillarX + 0.25, z0: g.z - 0.32, z1: g.z + 0.32 }, 0, 4.3);
        box({ x0: s * g.pillarX - 0.2, x1: s * g.pillarX + 0.2, z0: g.z - 2.0, z1: g.z - 1.6 }, 0, 3.5);
        box({ x0: Math.min(s * 1.85, s * 1.1), x1: Math.max(s * 1.85, s * 1.1), z0: g.z - 2.0, z1: g.z - 0.2 }, 0, 3.2);
        // 土塀：壁の本体と、上に張り出す瓦の笠
        const wx0 = Math.min(s * (g.pillarX + 0.2), s * g.wallEnd);
        const wx1 = Math.max(s * (g.pillarX + 0.2), s * g.wallEnd);
        box({ x0: wx0, x1: wx1, z0: g.z - WALL.thick / 2 - 0.05, z1: g.z + WALL.thick / 2 + 0.05 }, 0, WALL.height);
        box({ x0: wx0, x1: wx1, z0: g.z - 0.7, z1: g.z + 0.7 }, WALL.height - 0.05, WALL.height + 0.45);
    }
    // 冠木（門の上の横木）と門の屋根
    box({ x0: -2.8, x1: 2.8, z0: g.z - 0.3, z1: g.z + 0.3 }, 2.85, 3.9);
    box({ x0: -3.3, x1: 3.3, z0: g.z - 1.55, z1: g.z + 1.55 }, 3.85, 5.7);
    // 木の幹
    for (const t of [PINE, TREE2]) box({ x0: t.x - 0.4, x1: t.x + 0.4, z0: t.z - 0.4, z1: t.z + 0.4 }, 0, 3);
    return b;
}
