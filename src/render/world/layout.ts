/**
 * core のマップ（文字の地図）から、2.5D 表示に必要な配置情報を取り出す。
 * core は変更せず読むだけ。Phaser・DOM に依存しないのでテストできる。
 */
import { TILE_SIZE } from '../../core/constants';
import { GATE_RECT, KEEP_RECT, MAP_HEIGHT, MAP_WIDTH, tileAt, type TileChar } from '../../core/map';

export interface TileRect {
    tx: number;
    ty: number;
    tw: number;
    th: number;
}

/** 条件に合うタイルの「つながった塊」ごとの外接矩形（上下左右でつながる） */
export function findGroups(pred: (c: TileChar) => boolean): TileRect[] {
    const seen = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    const out: TileRect[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const idx = y * MAP_WIDTH + x;
            if (seen[idx] || !pred(tileAt(x, y)!)) continue;
            let minX = x, maxX = x, minY = y, maxY = y;
            const stack = [[x, y]];
            seen[idx] = 1;
            while (stack.length) {
                const [cx, cy] = stack.pop()!;
                minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    const c = tileAt(nx, ny);
                    if (c === null || !pred(c)) continue;
                    const ni = ny * MAP_WIDTH + nx;
                    if (seen[ni]) continue;
                    seen[ni] = 1;
                    stack.push([nx, ny]);
                }
            }
            out.push({ tx: minX, ty: minY, tw: maxX - minX + 1, th: maxY - minY + 1 });
        }
    }
    return out;
}

/** 条件に合うタイルを、横の連なりを縦にまとめた矩形の集まりに分ける（L 字の水面などを矩形で覆う） */
export function coverWithRects(pred: (c: TileChar) => boolean): TileRect[] {
    const open: TileRect[] = [];
    const done: TileRect[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        const runs: [number, number][] = [];
        let x = 0;
        while (x < MAP_WIDTH) {
            if (pred(tileAt(x, y)!)) {
                const s = x;
                while (x < MAP_WIDTH && pred(tileAt(x, y)!)) x++;
                runs.push([s, x - s]);
            } else x++;
        }
        const next: TileRect[] = [];
        for (const [s, len] of runs) {
            const i = open.findIndex((r) => r.tx === s && r.tw === len && r.ty + r.th === y);
            if (i >= 0) {
                const r = open.splice(i, 1)[0];
                r.th++;
                next.push(r);
            } else next.push({ tx: s, ty: y, tw: len, th: 1 });
        }
        done.push(...open);
        open.length = 0;
        open.push(...next);
    }
    done.push(...open);
    return done;
}

export const houseRects = (): TileRect[] => findGroups((c) => c === 'R' || c === 'W');
export const waterRects = (): TileRect[] => coverWithRects((c) => c === '~');
export const paddyRects = (): TileRect[] => findGroups((c) => c === 'f');

export interface BridgeInfo extends TileRect {
    /** 'ns' = 南北に渡る（堀）、'ew' = 東西に渡る（川） */
    dir: 'ns' | 'ew';
}

export function bridges(): BridgeInfo[] {
    return findGroups((c) => c === 'B').map((r) => {
        // 橋の左右（東西）が水なら南北に渡る橋
        const westWater = tileAt(r.tx - 1, r.ty) === '~';
        return { ...r, dir: westWater ? 'ns' : 'ew' };
    });
}

export interface WallTile {
    tx: number;
    ty: number;
    /** 横に続く壁か（上面の瓦の向き） */
    horizontal: boolean;
    /** 南側が壁でない＝前面（南面）が見える */
    front: boolean;
}

export function wallTiles(): WallTile[] {
    const out: WallTile[] = [];
    const isWall = (x: number, y: number) => tileAt(x, y) === '#';
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (!isWall(x, y)) continue;
            out.push({
                tx: x,
                ty: y,
                horizontal: isWall(x - 1, y) || isWall(x + 1, y),
                front: !isWall(x, y + 1),
            });
        }
    }
    return out;
}

export interface TilePos {
    tx: number;
    ty: number;
}

export function tilesOf(char: TileChar): TilePos[] {
    const out: TilePos[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) if (tileAt(x, y) === char) out.push({ tx: x, ty: y });
    }
    return out;
}

/** 木。外周の木は「林」として密に、町の木は単独として扱う。 */
export interface TreePlace extends TilePos {
    border: boolean;
}

export function trees(): TreePlace[] {
    return tilesOf('T').map((p) => ({
        ...p,
        border: p.tx === 0 || p.ty === 0 || p.tx === MAP_WIDTH - 1 || p.ty === MAP_HEIGHT - 1,
    }));
}

/**
 * 草むらを置く場所（揺れる草）。草地のうち、道や建物の近くを優先して最大 max 個。
 * 乱数は固定 seed なので毎回同じ配置。
 */
export function grassTuftSpots(max: number, seed = 7): { x: number; y: number; variant: number }[] {
    const cands: { x: number; y: number; score: number; variant: number }[] = [];
    let s = seed >>> 0;
    const rand = () => {
        s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
        return s / 4294967296;
    };
    for (let ty = 1; ty < MAP_HEIGHT - 1; ty++) {
        for (let tx = 1; tx < MAP_WIDTH - 1; tx++) {
            const c = tileAt(tx, ty);
            if (c !== '.') continue;
            let near = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const n = tileAt(tx + dx, ty + dy);
                    if (n === ',' || n === 'R' || n === 'W' || n === 'F' || n === '~' || n === 'T' || n === 'f') near++;
                }
            }
            // 1 タイルに 1〜2 本、ランダムな位置
            const per = near > 0 ? 2 : 1;
            for (let k = 0; k < per; k++) {
                cands.push({
                    x: tx * TILE_SIZE + 2 + rand() * (TILE_SIZE - 4),
                    y: ty * TILE_SIZE + 3 + rand() * (TILE_SIZE - 4),
                    score: near * 2 + rand() * 3,
                    variant: Math.floor(rand() * 3),
                });
            }
        }
    }
    cands.sort((a, b) => b.score - a.score);
    return cands.slice(0, max).map(({ x, y, variant }) => ({ x, y, variant }));
}

/** 城門・天守の位置（core の定義をそのまま使う） */
export const gateRect = (): TileRect => ({ tx: GATE_RECT.tx, ty: GATE_RECT.ty, tw: GATE_RECT.tw, th: GATE_RECT.th });
export const keepRect = (): TileRect => ({ tx: KEEP_RECT.tx, ty: KEEP_RECT.ty, tw: KEEP_RECT.tw, th: KEEP_RECT.th });
