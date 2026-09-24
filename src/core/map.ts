/**
 * マップ定義（Phaser 非依存）。
 * 1 文字 = 1 タイル（16px）。北が上。
 *
 *   北：城（城内・天守）と城門
 *   中：堀と橋、城門前の広場
 *   南：城下町（家並み・井戸・高札）
 *   東：川を渡る街道（道標・田んぼ・関所）
 */
import { TILE_SIZE } from './constants';
import type { Rect } from './types';

export type TileChar =
    | '.' | 'b' | ',' | '=' | '#' | '~' | 'B' | 'T' | 'R' | 'W'
    | 'F' | 'f' | 'o' | 'N' | 'M' | 'K' | 'G' | 'X';

export interface TileInfo {
    /** タイルセット画像内の番号（描画側で使う） */
    index: number;
    /** 通行できないなら true */
    solid: boolean;
    label: string;
}

export const TILES: Record<TileChar, TileInfo> = {
    '.': { index: 0, solid: false, label: '草地' },
    'b': { index: 1, solid: false, label: '花' },
    ',': { index: 2, solid: false, label: '土の道' },
    '=': { index: 3, solid: false, label: '石畳' },
    '#': { index: 4, solid: true, label: '城壁' },
    '~': { index: 5, solid: true, label: '水（堀・川）' },
    'B': { index: 6, solid: false, label: '橋' },
    'T': { index: 7, solid: true, label: '木' },
    'R': { index: 8, solid: true, label: '屋根' },
    'W': { index: 9, solid: true, label: '家の壁' },
    'F': { index: 10, solid: true, label: '柵' },
    'f': { index: 11, solid: true, label: '田' },
    'o': { index: 12, solid: true, label: '井戸' },
    'N': { index: 13, solid: true, label: '高札' },
    'M': { index: 14, solid: true, label: '道標' },
    'K': { index: 15, solid: true, label: '天守' },
    'G': { index: 16, solid: false, label: '城門' },
    'X': { index: 17, solid: true, label: '関所の柵' },
};

export const TILE_COUNT = Object.keys(TILES).length;

export const MAP_ROWS: readonly string[] = [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T...........################################...........T',
    'T...........#==============================#...........T',
    'T...........#=TT======KKKKKKKKKKKK======TT=#...........T',
    'T...........#=========KKKKKKKKKKKK=========#...........T',
    'T...........#=========KKKKKKKKKKKK=========#...........T',
    'T...........#=========KKKKKKKKKKKK=========#...........T',
    'T...........#=========KKKKKKKKKKKK=========#...........T',
    'T...........#==============================#...........T',
    'T...........#====bb==================bb====#...........T',
    'T...........#==============================#...........T',
    'T...........#=T==========================T=#...........T',
    'T...........#==============================#...........T',
    'T...........##############GGGG##############...........T',
    'T~~~~~~~~~~~~~~~~~~~~~~~~~BBBB~~~~~~~~~~~~~~~~~~.......T',
    'T~~~~~~~~~~~~~~~~~~~~~~~~~BBBB~~~~~~~~~~~~~~~~~~.......T',
    'T......................,,,,,,,,,,.............~~.......T',
    'T.TT...................,,,,,,,,,,.............~~ff,,fffT',
    'T......................,,,,,,,,,,.........T...~~ff,,fffT',
    'T......................,,,,,,,,,,.............~~ff,,fffT',
    'T...RRRRR..RRRRR..RRRRR...,,,,..RRRRR.RRR.....~~ff,,fffT',
    'T...RRRRR..RRRRR..RRRRR...,,,,..RRRRR.RRR..T..~~ff,,fffT',
    'T...WWWWW..WWWWW..WWWWW...,,,,..WWWWW.WWW.....~~ff,,fffT',
    'T.........................,,,,...........T....~~..,,...T',
    'T.......T......T......o...,,,,.......T........~~T.,T..TT',
    'T.........b..........b..N.,,,,....b...........~~..,,M..T',
    'T..,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,BB,,,,,,,X',
    'T..,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,BB,,,,,,,X',
    'T.........................,,,,................~~.......T',
    'T.........................,,,,................~~T..T..TT',
    'T...RRRRR..RRRRR..RRRRR...,,,,..RRRRR.RRRffff.~~ffffff.T',
    'T...RRRRR..RRRRR..RRRRR...,,,,..RRRRR.RRRffff.~~ffffff.T',
    'T...WWWWW..WWWWW..WWWWW...,,,,..WWWWW.WWWffff.~~ffffff.T',
    'T.T.......................,,,,.b.........ffff.~~ffffff.T',
    'T.....b.............T.T...,,,,......T....ffff.~~ffffff.T',
    'T.........................,,,,...........ffff.~~ffffff.T',
    'T...RRRRR..RRRRR..FFFFFFF.,,,,..RRRRR....ffff.~~ffffff.T',
    'T...RRRRR..RRRRR..FfffffF.,,,,..RRRRR....ffff.~~ffffff.T',
    'T...WWWWW..WWWWW..FfffffF.,,,,..WWWWW....ffff.~~ffffff.T',
    'T..................T...T..,,,,................~~ffffff.T',
    'T.......T.................,,,,........T.....T.~~ffffff.T',
    'T.........................,,,,............T...~~ffffff.T',
    'T.............................................~~.......T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
];

export const MAP_WIDTH = MAP_ROWS[0].length;
export const MAP_HEIGHT = MAP_ROWS.length;
export const MAP_PIXEL_WIDTH = MAP_WIDTH * TILE_SIZE;
export const MAP_PIXEL_HEIGHT = MAP_HEIGHT * TILE_SIZE;

export function tileAt(tx: number, ty: number): TileChar | null {
    if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return null;
    return MAP_ROWS[ty][tx] as TileChar;
}

/** マップ外は通れない扱い */
export function isSolidTile(tx: number, ty: number): boolean {
    const c = tileAt(tx, ty);
    return c === null || TILES[c].solid;
}

/** 矩形がどれか 1 つでも通れないタイルに重なるか */
export function rectHitsSolidTile(r: Rect): boolean {
    const eps = 0.0001;
    const x0 = Math.floor(r.x / TILE_SIZE);
    const y0 = Math.floor(r.y / TILE_SIZE);
    const x1 = Math.floor((r.x + r.w - eps) / TILE_SIZE);
    const y1 = Math.floor((r.y + r.h - eps) / TILE_SIZE);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (isSolidTile(tx, ty)) return true;
        }
    }
    return false;
}

/** 描画用：タイル番号の 2 次元配列 */
export function mapIndexGrid(): number[][] {
    return MAP_ROWS.map((row) => [...row].map((c) => TILES[c as TileChar].index));
}

export function tileCenter(tx: number, ty: number): { x: number; y: number } {
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

export function tileRect(tx: number, ty: number): Rect {
    return { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
}

// ---- 地域（到着時に地名を表示する） ----

export type AreaId = 'castle' | 'gate' | 'town' | 'road';

export const AREA_NAMES: Record<AreaId, string> = {
    castle: '城内',
    gate: '城門前',
    town: '城下町',
    road: '街道',
};

/** タイル座標から地域を判定（上から順に評価） */
export function areaAtTile(tx: number, ty: number): AreaId {
    if (tx >= 46) return 'road';
    if (ty <= 12) return 'castle';
    if (ty <= 19 && tx >= 20 && tx <= 35) return 'gate';
    return 'town';
}

export function areaAtPixel(x: number, y: number): AreaId {
    return areaAtTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}

// ---- 配置 ----

/** 主人公の初期位置（城内、天守の前） */
export const PLAYER_START = { tx: 27, ty: 9 } as const;
/** 家臣の立ち位置（城門の内側） */
export const RETAINER_POS = { tx: 30, ty: 11 } as const;

/** 調べられるタイル（高札・道標・井戸） */
export interface TileSpot {
    id: 'notice' | 'milestone' | 'well';
    tx: number;
    ty: number;
}

export const TILE_SPOTS: readonly TileSpot[] = [
    { id: 'notice', tx: 24, ty: 25 },
    { id: 'milestone', tx: 52, ty: 25 },
    { id: 'well', tx: 22, ty: 24 },
];

/** 天守・城門の大きな絵を重ねる位置（描画用） */
export const KEEP_RECT = { tx: 22, ty: 3, tw: 12, th: 5 } as const;
export const GATE_RECT = { tx: 26, ty: 13, tw: 4, th: 1 } as const;
