import { describe, expect, it } from 'vitest';
import {
    MAP_HEIGHT, MAP_ROWS, MAP_WIDTH, PLAYER_START, RETAINER_POS, TILES, TILE_SPOTS,
    areaAtTile, isSolidTile, tileAt, type TileChar,
} from '../src/core/map';

/** 通れるタイルだけをたどって到達できるタイルの集合 */
function reachableFrom(sx: number, sy: number): Set<string> {
    const seen = new Set<string>([`${sx},${sy}`]);
    const queue: [number, number][] = [[sx, sy]];
    while (queue.length) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            const k = `${nx},${ny}`;
            if (seen.has(k) || isSolidTile(nx, ny)) continue;
            seen.add(k);
            queue.push([nx, ny]);
        }
    }
    return seen;
}

describe('map', () => {
    it('すべての行が同じ幅で、未定義の文字がない', () => {
        expect(MAP_HEIGHT).toBeGreaterThan(10);
        for (const row of MAP_ROWS) {
            expect(row.length).toBe(MAP_WIDTH);
            for (const c of row) expect(TILES[c as TileChar], `unknown tile ${c}`).toBeDefined();
        }
    });

    it('外周はすべて通れない（マップの外へ出られない）', () => {
        for (let x = 0; x < MAP_WIDTH; x++) {
            expect(isSolidTile(x, 0)).toBe(true);
            expect(isSolidTile(x, MAP_HEIGHT - 1)).toBe(true);
        }
        for (let y = 0; y < MAP_HEIGHT; y++) {
            expect(isSolidTile(0, y)).toBe(true);
            expect(isSolidTile(MAP_WIDTH - 1, y)).toBe(true);
        }
        expect(isSolidTile(-1, 5)).toBe(true);
        expect(tileAt(MAP_WIDTH, 0)).toBeNull();
    });

    it('初期位置から城門・城下町・街道へ歩いて行ける', () => {
        expect(isSolidTile(PLAYER_START.tx, PLAYER_START.ty)).toBe(false);
        const reach = reachableFrom(PLAYER_START.tx, PLAYER_START.ty);
        const areas = new Set([...reach].map((k) => {
            const [x, y] = k.split(',').map(Number);
            return areaAtTile(x, y);
        }));
        expect(areas).toEqual(new Set(['castle', 'gate', 'town', 'road']));
    });

    it('家臣と調べられる物の隣に立てる場所がある', () => {
        const reach = reachableFrom(PLAYER_START.tx, PLAYER_START.ty);
        const spots = [{ tx: RETAINER_POS.tx, ty: RETAINER_POS.ty }, ...TILE_SPOTS];
        for (const s of spots) {
            const hasNeighbor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach.has(`${s.tx + dx},${s.ty + dy}`));
            expect(hasNeighbor, JSON.stringify(s)).toBe(true);
        }
    });
});
