/**
 * 城下町の場所の目印（町の側と物語の側が共有する。設計：docs/story-rpg-design.md §5）。純粋な定数。
 * 座標は探索の座標（x は東、z は南。北の城門は z −12）。町の側（town/）が場所を整えるときに値を直してよい（物語の側はここを読むだけ）。
 * 今ある人物の置き場所（explore/cast.ts の SPOTS）・開始の位置・城門・道の真ん中（x −1.5〜2.5、z −12〜3）は動かさない。
 * 町の小物・櫓・木戸の配置は town/plan.ts（ここの値に合わせてある）。
 */

/** 物見櫓の下（ここで「物見」）。街道口の西の櫓（真ん中 (−6.9, 14.9)）の北の梯子の前。道の西の端から歩いて 3 m ほど */
export const LOOKOUT = { x: -6.9, z: 11.9 } as const;
/** 街道口（南の木戸。出陣・帰還の隊列が通る）。木戸の柱の線 */
export const HIGHWAY_MOUTH = { x: 0, z: 16.4 } as const;
/** 兵の詰所と負傷兵の休み場（東の囲い。筵のあたり。南東から入る） */
export const GUARDPOST = { x: 13, z: -4 } as const;
/** 軍議所（城内の東。陣幕の囲いの真ん中の少し南） */
export const COUNCIL_HALL = { x: 13, z: -23 } as const;
