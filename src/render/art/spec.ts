/**
 * 2.5D 表現の共通仕様（アート方向の「約束ごと」）。
 *
 * - 世界座標は core と同じ（1 タイル = 16 ワールド px）。ゲームロジック・当たり判定は変えない。
 * - 絵は「ワールド px × 解像度係数」の大きさで Canvas に描き、表示時に縮小する（高解像度の 2D 絵）。
 * - 物体の基準点は「地面に接する点（足元・土台の下端）」。奥行き（描画順）はこの点の Y 座標で決まる。
 * - 光は画面の左上やや手前（西南西の低めの太陽）から当たる。影は右（東）やや上へ伸びる。
 */

/** 物体・人物の Canvas 解像度（ワールド 1px あたりの Canvas px）。品質設定で下がることがある。 */
export const OBJECT_TEX_HIGH = 4;
export const OBJECT_TEX_LOW = 3;

/** 地面テクスチャの解像度（ワールド 1px あたり）。マップ全体を 1 枚に焼くので控えめ。 */
export const GROUND_TEX_HIGH = 2;
export const GROUND_TEX_LOW = 1.5;

/** 影の向き（単位ベクトル）。光と反対向き。 */
export const SHADOW_DIR = normalize(1, -0.28);

/** 表面の明るさを決める光の向き（面の法線との内積に使う。画面上方向が -y）。左上手前から。 */
export const LIGHT_DIR = normalize(-0.62, -0.5);

/**
 * 色見本。落ち着いた戦国の色調：くすんだ緑、土色、漆喰の白、墨色の瓦、藍、朱は差し色だけ。
 * 彩度を抑え、真っ黒・真っ白は使わない。
 */
export const PALETTE = {
    // 地面
    grass: '#6d8a4c',
    grassDark: '#4d6a37',
    grassLight: '#94ab68',
    grassDry: '#9c9a5e',
    dirt: '#b39a74',
    dirtDark: '#8c7458',
    dirtLight: '#cbb58f',
    stone: '#a8a397',
    stoneDark: '#817c72',
    stoneLight: '#c4c0b5',
    water: '#3d6a7e',
    waterDeep: '#2a4f60',
    waterLight: '#7fa8b4',
    mud: '#6e6a45',
    paddy: '#7d9651',
    // 建物
    plaster: '#e9e2d2',
    plasterShade: '#c9c0ac',
    wood: '#5d4432',
    woodLight: '#86664a',
    woodDark: '#3a2a1f',
    roof: '#474e5b',
    roofLight: '#6b7482',
    roofDark: '#2f343d',
    thatch: '#9d8656',
    thatchDark: '#6f5d3a',
    stoneWall: '#8d8a84',
    // 植物
    leaf: '#4d6b3a',
    leafDark: '#2f4a2b',
    leafLight: '#7d9b58',
    pine: '#3c5a3c',
    pineDark: '#253d29',
    bark: '#5a4636',
    // 人物
    skin: '#e6c3a0',
    skinShade: '#c79c7a',
    hair: '#23201d',
    indigo: '#34476b',
    indigoDark: '#243250',
    hakama: '#4a4540',
    armorRed: '#8a3a2e',
    armorDark: '#4f221c',
    gold: '#c9a54a',
    // 効果
    shadow: 'rgba(24, 26, 32, 1)',
    lantern: '#ffcf7a',
} as const;

// ---------------------------------------------------------------------------
// 各素材の大きさ（ワールド px）と基準点。基準点 = 地面に接する点（0〜1 の比率）。
// ---------------------------------------------------------------------------

export interface SpriteSpec {
    /** ワールド px */
    w: number;
    h: number;
    /** 基準点（0〜1）。ここを地面上の位置に合わせて置く。 */
    ox: number;
    oy: number;
}

/** 人物 1 コマ。足元が (0.5, 38/40)。身長は約 34 ワールド px（約 2 タイル強）。 */
export const CHARACTER: SpriteSpec = { w: 24, h: 40, ox: 0.5, oy: 38 / 40 };
/** 8 方向（0=下, 1=右下, 2=右, 3=右上, 4=上, 5=左上, 6=左, 7=左下） */
export const DIRECTIONS = 8;
/** 歩行 1 周期のコマ数（待機 1 コマは別） */
export const WALK_FRAMES = 8;

/** 民家：幅タイル数 × 奥行き 3 タイルの敷地。前面の壁の高さ 30、軒の出 4。基準点は敷地下端の中央。 */
export const HOUSE_FRONT_H = 30;
export const HOUSE_EAVE = 4;
export function houseSpec(widthTiles: number): SpriteSpec {
    const w = widthTiles * 16 + HOUSE_EAVE * 2;
    const h = 3 * 16 + HOUSE_FRONT_H + 6;
    return { w, h, ox: 0.5, oy: 1 };
}

/** 木：幹の根元が基準点。 */
export const TREE: SpriteSpec = { w: 44, h: 66, ox: 0.5, oy: 62 / 66 };

/** 城壁 1 タイル分。上面（瓦）16×16 と、南向きの前面（高さ 20）。 */
export const WALL_H = 20;
/** 前面つき：上面 16 + 前面 20 = 36。基準点は下端。 */
export const WALL_WITH_FRONT: SpriteSpec = { w: 16, h: 16 + WALL_H, ox: 0, oy: 1 };
/** 上面のみ（縦に続く壁の途中）。 */
export const WALL_TOP_ONLY: SpriteSpec = { w: 16, h: 16, ox: 0, oy: 1 };

/** 城門（櫓門）。門の通路（4 タイル）の中央下端が基準点。 */
export const GATE: SpriteSpec = { w: 108, h: 62, ox: 0.5, oy: 1 };

/** 天守。敷地（12×5 タイル）の下端中央が基準点。 */
export const KEEP: SpriteSpec = { w: 212, h: 128, ox: 0.5, oy: 1 };

/** 橋 */
export const BRIDGE_NS_DECK: SpriteSpec = { w: 72, h: 32, ox: 0.5, oy: 1 }; // 南北方向（堀）：4 タイル幅 + 欄干
export const BRIDGE_EW_DECK: SpriteSpec = { w: 32, h: 32, ox: 0.5, oy: 1 }; // 東西方向（川）：2 タイル長
export const BRIDGE_EW_RAIL: SpriteSpec = { w: 36, h: 10, ox: 0.5, oy: 1 }; // 東西橋の欄干（北・南の 2 本）

/** 小物 */
export const PROP_WELL: SpriteSpec = { w: 22, h: 26, ox: 0.5, oy: 22 / 26 };
export const PROP_NOTICE: SpriteSpec = { w: 26, h: 34, ox: 0.5, oy: 30 / 34 };
export const PROP_MILESTONE: SpriteSpec = { w: 12, h: 26, ox: 0.5, oy: 23 / 26 };
export const PROP_FENCE: SpriteSpec = { w: 16, h: 14, ox: 0, oy: 1 };
export const PROP_BARRICADE: SpriteSpec = { w: 20, h: 24, ox: 0.5, oy: 21 / 24 };
export const PROP_LANTERN: SpriteSpec = { w: 8, h: 18, ox: 0.5, oy: 1 };

/** 草むら（揺れる） */
export const TUFT: SpriteSpec = { w: 12, h: 10, ox: 0.5, oy: 1 };
export const TUFT_VARIANTS = 3;
/** 地面に置く花（揺れない） */
export const FLOWER: SpriteSpec = { w: 10, h: 8, ox: 0.5, oy: 0.5 };
export const FLOWER_VARIANTS = 2;

function normalize(x: number, y: number): { x: number; y: number } {
    const l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
}
