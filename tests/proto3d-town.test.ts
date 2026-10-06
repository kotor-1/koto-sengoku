/**
 * 小さな城下町（proto3d/src/town/plan.ts・explore/ambient.ts・explore/lookout.ts）：
 * - 足した物の当たり判定が、人物の置き場所・開始の位置・道の真ん中・城門への道すじ・人物へ南から近づく道すじを塞がない。
 * - 開始の位置から、新しい場所（詰所・軍議所・物見櫓・街道口・南の通り）へ歩いて行ける（今の到達の網のテストと同じ作り）。
 * - 町家の写しの当たり判定・カメラ除けが写した位置にある。肩越しのカメラが新しい場所でも箱に入らない。
 * - 町の人々の置き方が純粋で、道の真ん中・道すじ・当たり判定に入らない。物見の向きの計算。
 * - 町の入口（ENTRY_POSE。Version 21 の歴史分岐の探索の始め）から：城門・人物へ通りを歩いて行ける。北を向いて真っすぐ歩くと城門の前の家臣に
 *   話しかけられる。歩く途中の肩越しのカメラから、詰所の前の休み場・援兵・門番・荷運び・店の人が見える（カメラ除けの箱に遮られない）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SPOTS } from '../proto3d/src/explore/cast';
import { AMBIENT_PEOPLE_MAX, GUARD_SPOTS, MERCHANT_SPOTS, PORTER_PATHS, REINFORCEMENT_AT, ambientPlan, preparingLayout, walkerAt } from '../proto3d/src/explore/ambient';
import { LOOKOUT_TOLERANCE, examinable, headingVector, lookoutShot, nearestMark, startHeading, wrapAngle } from '../proto3d/src/explore/lookout';
import { FOLLOW, blockersForTest, createOrbit, placeFollow } from '../proto3d/src/game/follow';
import { HERO_RADIUS, isFree } from '../proto3d/src/game/motion';
import { BOUNDS, START, cameraBlockers, colliders, type Rect } from '../proto3d/src/layout';
import { GROUND_SITS, KIDO, LOOKOUT_EYE, MACHIYA_COPIES, MATS, REST, TOWER, TOWN_PROPS, townBlockers, townColliders } from '../proto3d/src/town/plan';
import { COUNCIL_HALL, ENTRY_POSE, GUARDPOST, GUARD_REST, HIGHWAY_MOUTH, LOOKOUT } from '../proto3d/src/town/spots';
import machiyaD from '../proto3d/blender/machiya/machiya_d.meta.json';
import type { AmbientSpec } from '../proto3d/src/story/types';

const ALL = colliders();
const TOWN = townColliders();
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/** 道の真ん中（本番の e2e が座標で歩く） */
const LANE: Rect = { x0: -1.5, x1: 2.5, z0: -12, z1: 3 };
/** 人物の置き場所（全部の段階） */
const SPOT_LIST: [number, number][] = Object.values(SPOTS).flatMap((ph) => Object.values(ph).map((s) => [s![0], s![1]] as [number, number]));
/** 道すじ（架空の章の開始の位置 → 城門：(0,−5.4) を経る／開始の位置 → 人物の 2.4 m 南 → 人物） */
const ROUTES: [number, number][][] = [
    [[START.x, START.z], [0, -5.4], [0, -10.9]],
    ...SPOT_LIST.map(([x, z]) => [[START.x, START.z], [x, z + 2.4], [x, z + 0.6]] as [number, number][]),
];
/** 置き場所（向きつき）：向きのある所は、その向き（相手の正面）から近づく。無ければ南から */
const SPOT_FACING: [number, number, number | undefined][] = Object.values(SPOTS).flatMap((ph) => Object.values(ph).map((s) => [s![0], s![1], s![2]] as [number, number, number | undefined]));
const approach = ([x, z, h]: [number, number, number | undefined], d: number): [number, number] => (h === undefined ? [x, z + d] : [x + Math.sin(h) * d, z + Math.cos(h) * d]);
/**
 * 町の入口からの道すじ（Version 21）：通りの真ん中の線（x = ENTRY_POSE.x）を北へ、相手の正面 2.4 m の所の高さまで → 正面 2.4 m → 0.6 m。
 * 城門へは (0, −5.4) を経る（今の e2e の道）
 */
const ENTRY_ROUTES: [number, number][][] = [
    [[ENTRY_POSE.x, ENTRY_POSE.z], [ENTRY_POSE.x, 3], [0, -5.4], [0, -10.9]],
    ...SPOT_FACING.map((sp) => {
        const a = approach(sp, 2.4);
        return [[ENTRY_POSE.x, ENTRY_POSE.z], [ENTRY_POSE.x, a[1]], a, approach(sp, 0.6)] as [number, number][];
    }),
];
/** 点から折れ線までの距離 */
function distToRoute(route: [number, number][], x: number, z: number): number {
    let best = Infinity;
    for (let i = 1; i < route.length; i++) {
        const [a, b] = [route[i - 1]!, route[i]!];
        const vx = b[0] - a[0];
        const vz = b[1] - a[1];
        const k = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
        best = Math.min(best, Math.hypot(x - (a[0] + vx * k), z - (a[1] + vz * k)));
    }
    return best;
}

function segFree(a: [number, number], b: [number, number], rects: Rect[]): boolean {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
    for (let i = 0; i <= n; i++) {
        const k = i / n;
        if (!isFree(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, rects)) return false;
    }
    return true;
}

/** 開始の位置（省けば架空の章の START）から歩いて行ける所（0.2 m の格子。tests/proto3d-cast.test.ts と同じ作り） */
function reachable(rects: Rect[], from: { x: number; z: number } = START): (x: number, z: number) => boolean {
    const step = 0.2;
    const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / step) + 1;
    const nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / step) + 1;
    const idx = (i: number, k: number) => k * nx + i;
    const free = new Uint8Array(nx * nz);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) free[idx(i, k)] = isFree(BOUNDS.x0 + i * step, BOUNDS.z0 + k * step, rects) ? 1 : 0;
    const seen = new Uint8Array(nx * nz);
    const s0 = idx(Math.round((from.x - BOUNDS.x0) / step), Math.round((from.z - BOUNDS.z0) / step));
    const q = [s0];
    seen[s0] = 1;
    while (q.length) {
        const c = q.pop()!;
        const i = c % nx;
        const k = Math.floor(c / nx);
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di!;
            const kk = k + dk!;
            if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
            const n = idx(ii, kk);
            if (seen[n] || !free[n]) continue;
            seen[n] = 1;
            q.push(n);
        }
    }
    return (x, z) => {
        const i = Math.round((x - BOUNDS.x0) / step);
        const k = Math.round((z - BOUNDS.z0) / step);
        return i >= 0 && k >= 0 && i < nx && k < nz && seen[idx(i, k)] === 1;
    };
}

/** (x, z) から r の中に、歩いて行ける所があるか */
function reachNear(canReach: (x: number, z: number) => boolean, x: number, z: number, r: number): boolean {
    for (let d = 0; d <= r; d += 0.1) for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) if (canReach(x + Math.sin(a) * d, z + Math.cos(a) * d)) return true;
    return false;
}

describe('小さな城下町：足した物は今の場所・道すじを塞がない', () => {
    it('足した当たり判定は、開始の位置・人物の置き場所・道の真ん中に重ならない', () => {
        expect(isFree(START.x, START.z, TOWN)).toBe(true);
        for (const r of TOWN) {
            expect(overlaps(r, LANE), `道の真ん中に重なる：${JSON.stringify(r)}`).toBe(false);
            for (const [x, z] of SPOT_LIST) expect(overlaps(r, { x0: x - 0.6, x1: x + 0.6, z0: z - 0.6, z1: z + 0.6 }), `置き場所 (${x}, ${z}) に重なる`).toBe(false);
        }
    });

    it('城門への道すじ（(0,−5.4) を経る）と、人物へ南から近づく道すじは、足した物で塞がれない', () => {
        for (const r of ROUTES) for (let i = 1; i < r.length; i++) expect(segFree(r[i - 1]!, r[i]!, TOWN), `道すじ ${JSON.stringify(r)}`).toBe(true);
    });

    it('町家の写しの当たり判定・カメラ除けは、元の町家 D の箱を写した位置にある（数も同じ）', () => {
        expect(MACHIYA_COPIES.length).toBeGreaterThanOrEqual(1);
        expect(MACHIYA_COPIES.length).toBeLessThanOrEqual(2);
        const c = MACHIYA_COPIES[0]!.mirrorZ;
        for (const r of machiyaD.colliders) expect(TOWN).toContainEqual({ x0: r.x0, x1: r.x1, z0: 2 * c - r.z1, z1: 2 * c - r.z0 });
        const tb = townBlockers();
        for (const b of machiyaD.camera_blockers) expect(tb).toContainEqual({ x0: b.x0, x1: b.x1, z0: 2 * c - b.z1, z1: 2 * c - b.z0, y0: b.y0, y1: b.y1 });
        // 写しは元の町家 D と重ならず、間に東へ抜ける路地（主人公が通れる幅）がある
        const dMax = Math.max(...machiyaD.colliders.map((r) => r.z1));
        const copyMin = Math.min(...machiyaD.colliders.map((r) => 2 * c - r.z1));
        expect(copyMin - dMax).toBeGreaterThan(2 * HERO_RADIUS + 0.6);
    });

    it('当たり判定・カメラ除けは layout.ts の一覧に入る（歩き・カメラ・確かめが同じ物を見る）', () => {
        for (const r of TOWN) expect(ALL).toContainEqual(r);
        const cb = cameraBlockers();
        for (const b of townBlockers()) expect(cb).toContainEqual(b);
    });

    it('新しい場所（物見櫓・街道口・南の通り・詰所・軍議所）へ、開始の位置から歩いて行ける', () => {
        const canReach = reachable(ALL);
        // 物見櫓の相手（届く範囲 2.0 の中に立てる所がある）
        expect(reachNear(canReach, LOOKOUT.x, LOOKOUT.z, 1.9), '物見櫓').toBe(true);
        // 街道口（木戸の口）とその外
        expect(canReach(HIGHWAY_MOUTH.x, HIGHWAY_MOUTH.z), '街道口').toBe(true);
        expect(canReach(0, KIDO.z + 1.2), '木戸の外').toBe(true);
        // 南の通り（荷置き場の前・町家の写しの前・路地の東）
        for (const [x, z, name] of [[-2.8, 11.6, '荷置き場の前'], [3.4, 14.5, '町家の写しの前'], [11.5, 11.8, '路地の東']] as const) expect(canReach(x, z), name).toBe(true);
        // 詰所（筵のあたり・小屋の戸口の前）
        expect(canReach(GUARDPOST.x, GUARDPOST.z), '詰所').toBe(true);
        expect(canReach(14.0, -8.6), '詰所の小屋の前').toBe(true);
        // 軍議所（陣幕の口から中へ）
        expect(canReach(9.2, COUNCIL_HALL.z + 0.3), '軍議所の口の前').toBe(true);
        expect(canReach(11.0, COUNCIL_HALL.z + 0.3), '軍議所の中').toBe(true);
    }, 60_000);

    it('小物はどれも歩ける範囲の近く（町の外へ飛んでいない）。物見櫓の目は櫓の上', () => {
        for (const p of TOWN_PROPS) {
            if (p.x === 0 && p.z === 0) continue;
            expect(p.x).toBeGreaterThan(BOUNDS.x0 - 1);
            expect(p.x).toBeLessThan(BOUNDS.x1 + 1);
            expect(p.z).toBeGreaterThan(BOUNDS.z0 - 1);
            expect(p.z).toBeLessThan(BOUNDS.z1 + 1);
        }
        expect(LOOKOUT_EYE.y).toBeGreaterThan(TOWER.floorY + 1);
        expect(Math.hypot(LOOKOUT.x - TOWER.x, LOOKOUT.z - TOWER.z)).toBeLessThan(3.5);
    });

    it('新しい場所に立ってどちらを向いても、肩越しのカメラは足した物の箱に入らない', () => {
        const raw = cameraBlockers().map((b) => new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0), new THREE.Vector3(b.x1, b.y1, b.z1)));
        const boxes = blockersForTest(cameraBlockers());
        const areas: [number, number, number, number][] = [
            [-11, 5, 7.6, 18],
            [8, 19.5, -11, 12],
            [8, 17.5, -27.5, -18],
        ];
        let checked = 0;
        for (const [x0, x1, z0, z1] of areas) {
            for (let x = x0; x <= x1; x += 1.1) {
                for (let z = z0; z <= z1; z += 1.1) {
                    if (!isFree(x, z, ALL)) continue;
                    for (let k = 0; k < 8; k++) {
                        for (const pitch of [FOLLOW.pitchMin, 0.2, FOLLOW.pitchMax]) {
                            const o = createOrbit((k / 8) * Math.PI * 2, pitch);
                            let pose = placeFollow(o, x, z, 1, boxes);
                            for (let i = 0; i < 12; i++) pose = placeFollow(o, x, z, 1, boxes);
                            checked++;
                            for (const b of raw) if (b.containsPoint(pose.position)) throw new Error(`カメラが箱の中：(${x.toFixed(1)}, ${z.toFixed(1)}) 向き ${k} → ${pose.position.toArray().map((v) => v.toFixed(2))}`);
                        }
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(2000);
    }, 60_000);
});

describe('町の入口（ENTRY_POSE）から城門の前の家臣へ：通りを歩く導線（Version 21）', () => {
    it('町の入口は空いていて、城門・どの置き場所へも通りを歩いて行ける（相手の正面から近づく道すじが塞がれない）', () => {
        expect(isFree(ENTRY_POSE.x, ENTRY_POSE.z, ALL)).toBe(true);
        // 木戸の内（街道口の柱の線より北）・通りの南の端・北を向く
        expect(ENTRY_POSE.z).toBeLessThan(KIDO.z - 2);
        expect(ENTRY_POSE.z).toBeGreaterThan(KIDO.z - 5);
        expect(ENTRY_POSE.heading).toBeCloseTo(Math.PI, 9);
        for (const r of ENTRY_ROUTES) for (let i = 1; i < r.length; i++) expect(segFree(r[i - 1]!, r[i]!, ALL), `道すじ ${JSON.stringify(r)}`).toBe(true);
        // 架空の章の開始の位置と同じ所につながっている（町の全部へ行ける）
        const canReach = reachable(ALL, ENTRY_POSE);
        expect(canReach(START.x, START.z)).toBe(true);
        expect(canReach(GUARDPOST.x, GUARDPOST.z)).toBe(true);
        expect(canReach(9.2, COUNCIL_HALL.z + 0.3)).toBe(true);
    }, 60_000);

    it('北を向いたまま真っすぐ歩くと（W を押し続ける）、城門の前の家臣（源蔵の所）に話しかけられる所に、ほかの相手より先に着く', () => {
        const [gx, gz] = SPOTS.explore.genzo!;
        const others = [SPOTS.muster.envoy!, SPOTS.explore.shinpachi!, SPOTS.explore.notice!];
        // 家臣まで 2.0 m（話しかけられる距離）に入る z
        const dx = Math.abs(ENTRY_POSE.x - gx);
        expect(dx).toBeLessThan(1.9);
        const zTalk = gz + Math.sqrt(2.0 * 2.0 - dx * dx);
        expect(segFree([ENTRY_POSE.x, ENTRY_POSE.z], [ENTRY_POSE.x, zTalk - 0.05], [...ALL, { x0: gx - 0.25, x1: gx + 0.25, z0: gz - 0.25, z1: gz + 0.25 }])).toBe(true);
        // そこまでの間、ほかの相手の届く範囲（2.0 m）には入らない
        for (let z = ENTRY_POSE.z; z >= zTalk; z -= 0.05) for (const [ox, oz] of others) expect(Math.hypot(ENTRY_POSE.x - ox, z - oz), `z=${z.toFixed(2)} で (${ox}, ${oz}) に届く`).toBeGreaterThan(2.0);
        // 歩く距離は 20 m ほど（歩き 1.4 m/秒で 15 秒ほど）
        expect(ENTRY_POSE.z - zTalk).toBeGreaterThan(15);
        expect(ENTRY_POSE.z - zTalk).toBeLessThan(23);
    });

    it('詰所の前の休み場（筵・槍立て）は通りの東、土塀の手前にあり、道の真ん中・入口からの道すじにかからない', () => {
        expect(GUARD_REST.x).toBeGreaterThan(REST.x0);
        expect(GUARD_REST.x).toBeLessThan(REST.x1);
        for (const [x, z] of MATS) {
            expect(x - 0.475).toBeGreaterThanOrEqual(REST.x0);
            expect(x + 0.475).toBeLessThanOrEqual(REST.x1);
            expect(z - 0.975).toBeGreaterThanOrEqual(REST.z0 - 1e-9);
            expect(z + 0.975).toBeLessThanOrEqual(REST.z1 + 1e-9);
        }
        const rest = TOWN_PROPS.filter((p) => p.cluster === 'rest').flatMap((p) => p.colliders.map((r) => propRectLike(p, r)));
        for (const r of rest) expect(overlaps(r, LANE)).toBe(false);
    });

    it('通りを北へ歩く途中の肩越しのカメラから、詰所の前の休み場・援兵・門番・支度の兵・荷運び・店の人・城門の前の家臣が見える（画の中にあり、カメラ除けの箱に遮られない）', () => {
        const raw = cameraBlockers().map((b) => new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0), new THREE.Vector3(b.x1, b.y1, b.z1)));
        const boxes = blockersForTest(cameraBlockers());
        const ray = new THREE.Ray();
        const hitP = new THREE.Vector3();
        // 画の横の半分（スマホ横向き 844×390：縦の画角 48°×1.12 → 横は約 ±46°。端を避けて ±38°）
        const HALF = (38 * Math.PI) / 180;
        const seen = (cam: THREE.Vector3, yaw: number, t: THREE.Vector3): boolean => {
            const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
            const to = t.clone().sub(cam);
            const flat = new THREE.Vector3(to.x, 0, to.z);
            if (flat.length() < 1e-6 || flat.angleTo(dir) > HALF) return false;
            ray.set(cam, to.clone().normalize());
            const d = to.length();
            for (const b of raw) if (ray.intersectBox(b, hitP) && hitP.distanceTo(cam) < d - 0.4) return false;
            return true;
        };
        const targets: Record<string, THREE.Vector3[]> = {
            休み場: MATS.map(([x, z]) => new THREE.Vector3(x, 0.35, z)),
            土塀ぎわ: GROUND_SITS.map(([x, z]) => new THREE.Vector3(x, 0.7, z)),
            援兵: [0, 1, 2, 3, 4, 5].map((i) => new THREE.Vector3(REINFORCEMENT_AT.x + Math.floor(i / 3) * REINFORCEMENT_AT.dx, 1.3, REINFORCEMENT_AT.z + (i % 3) * REINFORCEMENT_AT.dz)),
            門番: GUARD_SPOTS.slice(0, 2).map(([x, z]) => new THREE.Vector3(x, 1.4, z)),
            支度の兵: preparingLayout(12, '徳').figures.map((f) => new THREE.Vector3(f.x, 1.4, f.z)),
            荷運び: PORTER_PATHS.flatMap((p) => p.map(([x, z]) => new THREE.Vector3(x, 1.3, z))),
            店の人: MERCHANT_SPOTS.slice(0, 1).map(([x, z]) => new THREE.Vector3(x, 1.3, z)),
            家臣: [new THREE.Vector3(SPOTS.explore.genzo![0], 1.6, SPOTS.explore.genzo![1])],
        };
        const count: Record<string, number> = {};
        for (let z = ENTRY_POSE.z; z >= -3; z -= 1) {
            const o = createOrbit(0, START.pitch);
            let pose = placeFollow(o, ENTRY_POSE.x, z, 1, boxes);
            for (let i = 0; i < 12; i++) pose = placeFollow(o, ENTRY_POSE.x, z, 1, boxes);
            for (const [name, list] of Object.entries(targets)) if (list.some((t) => seen(pose.position, 0, t))) count[name] = (count[name] ?? 0) + 1;
        }
        for (const name of Object.keys(targets)) expect(count[name] ?? 0, `${name}が見える所の数（入口から北へ 1 m ごと）`).toBeGreaterThanOrEqual(3);
    });
});

/** 小物の中の四角形 → ゲームの座標（plan.ts の propRect と同じ） */
function propRectLike(p: { x: number; z: number; rotY: number }, r: Rect): Rect {
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    const pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].map(([lx, lz]) => ({ x: p.x + lx! * c + lz! * s, z: p.z - lx! * s + lz! * c }));
    return { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), z0: Math.min(...pts.map((q) => q.z)), z1: Math.max(...pts.map((q) => q.z)) };
}

describe('町の人々の置き方', () => {
    const SPECS: AmbientSpec[] = [
        { groups: [{ kind: 'porter', count: 2, place: 'street' }, { kind: 'merchant', count: 2, place: 'street' }, { kind: 'guard', count: 2, place: 'gate' }] },
        { groups: [{ kind: 'preparing', count: 12, mark: '徳', place: 'castle' }, { kind: 'wounded', count: 12, place: 'guardpost' }, { kind: 'reinforcement', count: 6, mark: '織', place: 'guardpost' }, { kind: 'porter', count: 5, place: 'street' }, { kind: 'merchant', count: 3, place: 'street' }, { kind: 'guard', count: 4, place: 'gate' }] },
        { groups: [{ kind: 'wounded', count: 3, place: 'guardpost' }, { kind: 'reinforcement', count: 2, mark: '浅', place: 'guardpost' }] },
    ];

    it('同じ spec なら同じ物。人物の素材の写しは 4 人まで。null なら誰もいない', () => {
        for (const s of SPECS) {
            expect(ambientPlan(s)).toEqual(ambientPlan(JSON.parse(JSON.stringify(s))));
            expect(ambientPlan(s).walkers.length).toBeLessThanOrEqual(AMBIENT_PEOPLE_MAX);
        }
        expect(ambientPlan(null)).toEqual({ walkers: [], figures: [], banners: [] });
        // 数は spec のとおり（上限まで）：負傷兵 12・援兵 6・支度の兵 12・門番 4
        const p = ambientPlan(SPECS[1]!);
        const n = (k: string) => p.figures.filter((f) => f.kind === k).length;
        expect([n('wounded'), n('reinforcement'), n('preparing'), n('guard')]).toEqual([12, 6, 12, 4]);
        expect(p.banners.map((b) => `${b.kind}:${b.mark}`).sort()).toEqual(['preparing:徳', 'reinforcement:織']);
    });

    it('歩く人・兵は、当たり判定の中・道の真ん中・道すじに入らない（往復のどの時刻でも）', () => {
        for (const s of SPECS) {
            const p = ambientPlan(s);
            for (const f of p.figures) {
                // 床几に座る負傷兵は床几の当たり判定（小さな箱）の上にいる。それ以外の物の中にはいない
                const stool = (r: Rect) => f.pose === 'sit' && (r.x1 - r.x0) * (r.z1 - r.z0) < 0.4;
                for (const r of ALL) if (!stool(r)) expect(inside(r, f.x, f.z), `${f.kind} (${f.x}, ${f.z}) が当たり判定の中`).toBe(false);
                expect(inside(LANE, f.x, f.z), `${f.kind} が道の真ん中`).toBe(false);
                // 町の入口から城門・人物への道すじ（相手の正面から近づく）を、兵の形がふさがない（人を踏み越えて歩かない）
                for (const route of ENTRY_ROUTES) expect(distToRoute(route, f.x, f.z), `${f.kind} (${f.x}, ${f.z}) が道すじ ${JSON.stringify(route)} に近い`).toBeGreaterThan(0.6);
            }
            for (const w of p.walkers) {
                for (let t = 0; t < 60; t += 0.25) {
                    const q = walkerAt(w, t);
                    expect(walkerAt(w, t)).toEqual(q);
                    for (const r of ALL) expect(inside(r, q.x, q.z), `${w.key} t=${t} (${q.x.toFixed(2)}, ${q.z.toFixed(2)}) が当たり判定の中`).toBe(false);
                    expect(inside({ x0: LANE.x0 - 0.4, x1: LANE.x1 + 0.4, z0: LANE.z0, z1: LANE.z1 + 0.4 }, q.x, q.z), `${w.key} が道の真ん中`).toBe(false);
                    for (const route of [...ROUTES, ...ENTRY_ROUTES]) {
                        for (let i = 1; i < route.length; i++) {
                            const [a, b] = [route[i - 1]!, route[i]!];
                            // 線分までの距離
                            const vx = b[0] - a[0];
                            const vz = b[1] - a[1];
                            const k = Math.max(0, Math.min(1, ((q.x - a[0]) * vx + (q.z - a[1]) * vz) / (vx * vx + vz * vz)));
                            const d = Math.hypot(q.x - (a[0] + vx * k), q.z - (a[1] + vz * k));
                            expect(d, `${w.key} t=${t} が道すじ ${JSON.stringify(route)} に近い`).toBeGreaterThan(0.9);
                        }
                    }
                }
            }
        }
    }, 60_000);
});

describe('物見の向き', () => {
    const point = { id: 'lookout', marks: [{ id: 'a', heading: 0.2, label: 'A' }, { id: 'b', heading: -2.9, label: 'B' }, { id: 'c', heading: 3.05, label: 'C' }] };

    it('印の ±12° の中だけ「調べる」が押せる（向きは一周でつながる）', () => {
        expect(examinable(point.marks, 0.2)).toBe('a');
        expect(examinable(point.marks, 0.2 + LOOKOUT_TOLERANCE - 0.001)).toBe('a');
        expect(examinable(point.marks, 0.2 + LOOKOUT_TOLERANCE + 0.01)).toBe(null);
        // −π と π の境をまたぐ
        expect(examinable(point.marks, -3.12)).toBe('c');
        expect(nearestMark(point.marks, Math.PI)!.id).toBe('c');
        expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    });

    it('向き 0 は北（−z）、π/2 は東（+x）。櫓の上の目から、その向きを見る。始めは最初の印から 40° ずれた向き', () => {
        expect(headingVector(0).z).toBeCloseTo(-1, 9);
        expect(headingVector(Math.PI / 2).x).toBeCloseTo(1, 9);
        const s = lookoutShot(Math.PI / 2, 0);
        expect([s.px, s.py, s.pz]).toEqual([LOOKOUT_EYE.x, LOOKOUT_EYE.y, LOOKOUT_EYE.z]);
        expect(s.tx).toBeGreaterThan(s.px + 10);
        expect(Math.abs(wrapAngle(startHeading(point) - 0.2) - (40 * Math.PI) / 180)).toBeLessThan(1e-9);
    });

    it('櫓の上の目は、どのカメラ除けの箱にも入らない', () => {
        for (const b of cameraBlockers()) {
            const inBox = LOOKOUT_EYE.x > b.x0 && LOOKOUT_EYE.x < b.x1 && LOOKOUT_EYE.y > b.y0 && LOOKOUT_EYE.y < b.y1 && LOOKOUT_EYE.z > b.z0 && LOOKOUT_EYE.z < b.z1;
            expect(inBox, JSON.stringify(b)).toBe(false);
        }
    });
});
