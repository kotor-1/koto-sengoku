/**
 * 城門前の一場面の配置（メートル）。動かすときの当たり判定と、カメラが突き抜けない範囲に使う。
 *   y が上、道は南北（z）。南（+z）から北（-z）へ向かうと城門。x は東。
 * 数値のもとは Blender の制作と共通の約束（proto3d/blender/scene.json）。素材ごとの細かな当たり判定・カメラ除けの箱は、
 * 素材と一緒に書き出した proto3d/blender/**\/*.meta.json から読む（無ければ scene.json の大まかな形だけ）。
 */
import scene from '../blender/scene.json';

/** 城門：中心、通れる幅の半分、鏡柱の中心の x、塀の端 */
export const GATE = { x: scene.gate.center[0], z: scene.gate.center[1], halfOpening: scene.gate.opening_half, pillarX: scene.gate.pillar_x, wallEnd: 18 } as const;
/** 土塀：根元の厚み、漆喰の上端の高さ */
export const WALL = { thick: scene.wall_section.thickness_base, height: scene.wall_section.plaster_top_y } as const;
/** 控柱（門の北側） */
export const GATE_POSTS = { z: GATE.z + scene.gate.control_pillars.z_offset, size: scene.gate.control_pillars.size, top: scene.gate.control_pillars.top_y } as const;
/** 町家 A（道の西、表が東）：x0〜x1（x1 が道に面した表）、z0〜z1 */
export const HOUSE = scene.houses[0].footprint;
/** 木（幹の位置） */
export const TREES = scene.trees.map((t) => ({ name: t.name, x: t.pos[0], z: t.pos[1] }));
const tree = (name: string) => TREES.find((t) => t.name === name)!;
/** 東の土塀の内側の大きな黒松 */
export const PINE = tree('pine_big');
/** 門の手前、西の空き地の桜 */
export const TREE2 = tree('sakura');
/** 開始の位置・主人公の向き（heading）・肩越しのカメラの初めの向き（yaw・pitch） */
export const START = { x: scene.hero_start[0], z: scene.hero_start[1], heading: scene.hero_start_heading, yaw: scene.hero_start_yaw, pitch: scene.hero_start_pitch } as const;
/** 動ける範囲 */
export const BOUNDS = { x0: -22, x1: 20, z0: -30, z1: 18 } as const;

export interface Rect {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}

/** 上から見た四角形に高さを付けた箱（カメラが突き抜けないための、大まかな形） */
export interface Box extends Rect {
    y0: number;
    y1: number;
}

/** 素材と一緒に書き出した当たり判定・カメラ除けの箱（ゲームの座標） */
interface AssetMeta {
    colliders?: Rect[];
    camera_blockers?: Box[];
}
const METAS = Object.values(import.meta.glob(['../blender/**/*.meta.json', '!../blender/build/**'], { eager: true, import: 'default' }) as Record<string, unknown>);
const isRect = (r: unknown): r is Rect => !!r && ['x0', 'x1', 'z0', 'z1'].every((k) => typeof (r as Record<string, unknown>)[k] === 'number');
const isBox = (b: unknown): b is Box => isRect(b) && typeof (b as Box).y0 === 'number' && typeof (b as Box).y1 === 'number';
const metaColliders = METAS.flatMap((m) => ((m as AssetMeta).colliders ?? []).filter(isRect));
const metaBlockers = METAS.flatMap((m) => ((m as AssetMeta).camera_blockers ?? []).filter(isBox));
const rectOf = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });

/** 塀の一続き（上から見た四角形。厚みは根元の厚み） */
function wallRects(pad = 0): Rect[] {
    const t = WALL.thick / 2 + pad;
    return scene.walls.map((w) => {
        const [ax, az] = w.from;
        const [bx, bz] = w.to;
        return Math.abs(az - bz) < 1e-6 ? rectOf(ax, bx, az - t, az + t) : rectOf(ax - t, ax + t, az, bz);
    });
}

/** 町家の敷地（表の側は土台の石・格子の分だけ少し外へ） */
function houseRects(): Rect[] {
    return scene.houses.map((h) => {
        const f = h.footprint;
        const front = h.front === '+x' ? { x0: f.x0 - 0.1, x1: f.x1 + 0.25 } : { x0: f.x0 - 0.25, x1: f.x1 + 0.1 };
        return { ...front, z0: f.z0 - 0.1, z1: f.z1 + 0.1 };
    });
}

/** 開いた門扉（北へ開く）：鏡柱の内側の蝶番から、扉の幅だけ北寄りに開いた板 */
function doorRects(): Rect[] {
    const d = scene.gate.doors;
    const a = (d.open_inward_deg * Math.PI) / 180;
    const hinge = GATE.pillarX - scene.gate.pillar_size_xz[0] / 2;
    return [-1, 1].map((s) => {
        const ex = s * (hinge - Math.cos(a) * d.leaf_width);
        const ez = GATE.z - Math.sin(a) * d.leaf_width;
        return rectOf(s * hinge + s * 0.08, ex, GATE.z, ez);
    });
}

/** 通れない所（上から見た四角形） */
export function colliders(): Rect[] {
    const g = GATE;
    const [px, pz] = scene.gate.pillar_size_xz;
    const r: Rect[] = [...wallRects()];
    for (const s of [-1, 1]) {
        // 鏡柱（礎石の分だけ少し大きく）と控柱
        r.push(rectOf(s * g.pillarX - px / 2 - 0.05, s * g.pillarX + px / 2 + 0.05, g.z - pz / 2 - 0.05, g.z + pz / 2 + 0.05));
        r.push(rectOf(s * g.pillarX - GATE_POSTS.size / 2, s * g.pillarX + GATE_POSTS.size / 2, GATE_POSTS.z - GATE_POSTS.size / 2, GATE_POSTS.z + GATE_POSTS.size / 2));
    }
    r.push(...doorRects());
    r.push(...houseRects());
    // 木の幹
    for (const t of TREES) r.push(rectOf(t.x - 0.35, t.x + 0.35, t.z - 0.35, t.z + 0.35));
    // 素材ごとの細かな当たり判定（縁台・樽・垣など）
    r.push(...metaColliders);
    return r;
}

/**
 * カメラが入り込まない所。素材と一緒に書き出した箱に、scene.json から作る大まかな箱（塀・門・木の幹、町家の壁）を足す。
 * 形そのものではなく大まかな箱（毎フレーム調べても軽いように）。
 */
export function cameraBlockers(): Box[] {
    const b: Box[] = [];
    const box = (r: Rect, y0: number, y1: number) => b.push({ ...r, y0, y1 });
    const w = scene.wall_section;
    // 土塀：壁の本体と、上に張り出す瓦の笠
    for (const r of wallRects(0.02)) box(r, 0, w.plaster_top_y);
    for (const r of wallRects(w.cap_overhang - WALL.thick / 2)) box(r, w.plaster_top_y - 0.05, w.cap_top_y);
    // 城門：鏡柱・控柱・扉・冠木・屋根
    const g = GATE;
    const gt = scene.gate;
    for (const s of [-1, 1]) {
        box(rectOf(s * g.pillarX - gt.pillar_size_xz[0] / 2, s * g.pillarX + gt.pillar_size_xz[0] / 2, g.z - gt.pillar_size_xz[1] / 2, g.z + gt.pillar_size_xz[1] / 2), 0, gt.pillar_top_y);
        box(rectOf(s * g.pillarX - GATE_POSTS.size / 2, s * g.pillarX + GATE_POSTS.size / 2, GATE_POSTS.z - GATE_POSTS.size / 2, GATE_POSTS.z + GATE_POSTS.size / 2), 0, GATE_POSTS.top);
    }
    for (const d of doorRects()) box(d, 0, gt.doors.leaf_height);
    box(rectOf(-gt.kabuki_x_half, gt.kabuki_x_half, g.z - 0.3, g.z + 0.3), gt.kabuki_y[0], gt.kabuki_y[1]);
    box(rectOf(-gt.roof.x_half, gt.roof.x_half, g.z - gt.roof.z_half, g.z + gt.roof.z_half), gt.roof.eave_y - 0.3, gt.roof.ridge_y);
    // 町家の壁（屋根・庇は素材の箱で）
    for (const r of houseRects()) box(r, 0, 3.3);
    // 木の幹
    for (const t of TREES) box(rectOf(t.x - 0.4, t.x + 0.4, t.z - 0.4, t.z + 0.4), 0, 3);
    b.push(...metaBlockers);
    return b;
}

// ---------------------------------------------------------------------------
// 旧の素材（コードで作った町家・地面・城門。proto3d/src/assets/）の書き出しでだけ使う値。今のゲームの配置では使わない
// ---------------------------------------------------------------------------

/** 旧：町家の高さ（軒桁・棟・庇） */
export const HOUSE_H = { eave: 4.8, ridge: 6.55, hisashiLow: 3.25, hisashiHigh: 3.95 } as const;
/** 旧：町家の置き方。side 1 は道の西（表が東）、-1 は道の東（裏返した向き）。dz は南へずらす距離 */
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
/** 旧：表示の置き方（side -1 は縦の軸で 180° 回す） */
export function housePose(p: HousePlace): { x: number; z: number; rotY: number } {
    const cz = (HOUSE.z0 + HOUSE.z1) / 2;
    return p.side === 1 ? { x: 0, z: p.dz, rotY: 0 } : { x: 0, z: 2 * cz + p.dz, rotY: Math.PI };
}
/** 旧：元の町家の上での四角形を、置いた町家の上へ移す */
export function houseRect(p: HousePlace, r: Rect): Rect {
    const z0 = r.z0 + p.dz;
    const z1 = r.z1 + p.dz;
    return p.side === 1 ? { x0: r.x0, x1: r.x1, z0, z1 } : { x0: -r.x1, x1: -r.x0, z0, z1 };
}
/** 旧：土の道 */
export const ROAD = { halfWidth: 3.95, z0: -40, z1: 30 } as const;
