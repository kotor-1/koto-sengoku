/** 1 タイルの大きさ（px） */
export const TILE_SIZE = 16;

/** 主人公の歩く速さ（px/秒） */
export const WALK_SPEED = 76;

/** キャラクターの当たり判定（足元中心からの半径）。タイル 16px の通路を通れる大きさ。 */
export const ACTOR_HALF_W = 5;
export const ACTOR_HALF_H = 4;

/** 1 フレームで扱う経過時間の上限（秒）。タブ復帰時などのワープ防止。 */
export const MAX_STEP_SEC = 0.1;

/** 話しかけられる距離（当たり判定同士の隙間, px） */
export const INTERACT_REACH = 8;

/** スティックの無反応域（0〜1） */
export const STICK_DEADZONE = 0.18;
