/**
 * Version 28 の町の光・中景・遠景（scenery.ts・town/surround.ts・main.ts の影の選び方・explore/contactShadow.ts）の確かめ。
 * - 光：西の町家（表が東）の表に日が当たり、陰になる東の店の表には照り返しの補いが当たる（どちらの側も真っ暗の逆光にしない）。
 *   日は南の側の高め（開始の画面で主人公の背と城門の正面が日なた）。
 * - 中景：歩ける範囲の外だけに置く（歩ける範囲は広げない。当たり判定は足さない）。範囲の端の竹垣はカメラ除けにもなる（カメラが垣の向こうへ出ない）。
 *   形は軽く（まとまりごとの三角形の数の上限）。遠い木は冠の絵の板（Version 28 T4）、遠くの林は田畑・村の外で山並みの手前。田畑の下に土の板。
 * - 遠景：山並みは 3 段で、奥ほど遠く・空の色に近い（空気の遠近）。手前の段の裾は地面の端（200 m）より内側（地面の切れ目を隠す）。
 * - 影：影を落とさない木（street28.json の shadow: false）は、通りから見えない所（城の土塀の線より北・東の土塀の向こう）の木だけ。
 * - 接地の影：人物の根に 1 枚だけ付き、影を落とさない（人物の影の設定をまとめて変えても）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CROWN_CLUSTERS, FIELD_UNDERLAY, RANGES, TOWN_LIGHT, makeHills, surroundGeometry } from '../proto3d/src/scenery';
import { surroundPlan } from '../proto3d/src/town/surround';
import { BACK_TREES, BOUNDS, EDGE_FENCE, GATE, TREES, cameraBlockers, colliders, type Rect } from '../proto3d/src/layout';
import { createOrbit, placeFollow } from '../proto3d/src/game/follow';
import { CONTACT_SHADOW, addContactShadow, isCharacter } from '../proto3d/src/explore/contactShadow';
import scene from '../proto3d/blender/scene.json';
import treesMeta from '../proto3d/blender/trees/trees.meta.json';

const sunDir = new THREE.Vector3(...TOWN_LIGHT.sunOffset).normalize();
const bounceDir = new THREE.Vector3(-TOWN_LIGHT.sunOffset[0], TOWN_LIGHT.bounce.height, -TOWN_LIGHT.sunOffset[2]).normalize();
const inBounds = (x: number, z: number, pad = 0) => x > BOUNDS.x0 - pad && x < BOUNDS.x1 + pad && z > BOUNDS.z0 - pad && z < BOUNDS.z1 + pad;
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: URL, enc: 'utf8'): string };
/** 地面の作り方（blender/scene/build_ground.py）の田畑の範囲 FIELDS（x0, x1, z0, z1） */
function groundFields(): [number, number, number, number] {
    const py = fs.readFileSync(new URL('../proto3d/blender/scene/build_ground.py', import.meta.url), 'utf8');
    const m = /^FIELDS = dict\(x0=(-?[\d.]+), x1=(-?[\d.]+), z0=(-?[\d.]+), z1=(-?[\d.]+)\)/m.exec(py);
    if (!m) throw new Error('build_ground.py に FIELDS が無い');
    return m.slice(1).map(Number) as [number, number, number, number];
}

describe('光（町を歩くときの日・照り返し）', () => {
    it('日は南の側の高め（高さ 35〜50°）：開始の画面（北を見る）で主人公の背と城門の正面（南向き）が日なた', () => {
        const elev = (Math.asin(sunDir.y) * 180) / Math.PI;
        expect(elev).toBeGreaterThan(35);
        expect(elev).toBeLessThan(50);
        // 城門・主人公の背は南（+z）を向く面
        expect(sunDir.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.5);
    });

    it('西の町家（A・B。表が東 +x）の表に日が当たる（Version 27 の (−5, 12, 16) では日の裏で、いつも逆光だった）', () => {
        const front = new THREE.Vector3(1, 0, 0);
        expect(sunDir.dot(front)).toBeGreaterThan(0.25);
        const old = new THREE.Vector3(-5, 12, 16).normalize();
        expect(old.dot(front)).toBeLessThan(0);
        for (const b of scene.houses.filter((h) => h.front === '+x')) expect(b.footprint.x1).toBeLessThan(0);
    });

    it('陰になる東の店（表が西 −x）には照り返しの補いが当たり、空と地面の照り返しは陰を真っ暗にしない強さ', () => {
        const front = new THREE.Vector3(-1, 0, 0);
        expect(sunDir.dot(front)).toBeLessThan(0);
        expect(bounceDir.dot(front)).toBeGreaterThan(0.3);
        // 補いは日より十分弱い（影を作らない光が日の影を消さない）
        expect(TOWN_LIGHT.bounce.intensity).toBeLessThan(TOWN_LIGHT.sun.intensity * 0.2);
        // 縦の面（壁）が受ける空と地面の光（半分ずつ）が、日に照らされた壁の 2 割以上
        const sky = new THREE.Color(TOWN_LIGHT.hemi.sky);
        const ground = new THREE.Color(TOWN_LIGHT.hemi.ground);
        const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const wallAmbient = ((lum(sky) + lum(ground)) / 2) * TOWN_LIGHT.hemi.intensity;
        const litWall = TOWN_LIGHT.sun.intensity * sunDir.dot(new THREE.Vector3(1, 0, 0)) + wallAmbient;
        expect(wallAmbient / litWall).toBeGreaterThan(0.2);
    });

    it('霧は通り（30 m まで）にかけず、遠い地面の端（200 m）までにほぼかける', () => {
        expect(TOWN_LIGHT.fog.near).toBeGreaterThanOrEqual(28);
        expect((200 - TOWN_LIGHT.fog.near) / (TOWN_LIGHT.fog.far - TOWN_LIGHT.fog.near)).toBeGreaterThan(0.7);
    });
});

describe('中景（範囲の外の竹垣・隣の町並み・木立・村）', () => {
    const plan = surroundPlan();
    const geo = surroundGeometry(plan);

    it('家・木・垣は歩ける範囲の外（家の四角・木の幹・垣の線が範囲に入らない）', () => {
        for (const h of plan.houses) {
            const overlap = h.x1 > BOUNDS.x0 && h.x0 < BOUNDS.x1 && h.z1 > BOUNDS.z0 && h.z0 < BOUNDS.z1;
            expect(overlap, JSON.stringify(h)).toBe(false);
        }
        for (const t of plan.trees) expect(inBounds(t.x, t.z, 0.3), JSON.stringify(t)).toBe(false);
        for (const f of plan.fences) {
            expect(inBounds(f.ax, f.az, 0.3)).toBe(false);
            expect(inBounds(f.bx, f.bz, 0.3)).toBe(false);
        }
    });

    it('形の頂点も歩ける範囲の外（地面より上の頂点。木の枝張り・屋根の軒も範囲の上に張り出さない。竹垣は範囲の端から 0.3 m より外）', () => {
        for (const [c, g] of geo) {
            const p = g.getAttribute('position');
            let inside = 0;
            for (let i = 0; i < p.count; i++) if (inBounds(p.getX(i), p.getZ(i), -0.0) && p.getY(i) > 0) inside++;
            expect(inside, c).toBe(0);
            const bb = g.boundingBox!;
            const overlapX = bb.max.x > BOUNDS.x0 - 0.3 && bb.min.x < BOUNDS.x1 + 0.3;
            const overlapZ = bb.max.z > BOUNDS.z0 && bb.min.z < BOUNDS.z1;
            expect(overlapX && overlapZ && bb.min.x > BOUNDS.x0 - 1 && bb.max.x < BOUNDS.x1 + 1, c).toBe(false);
        }
    });

    it('当たり判定は足さない（中景の家・木・竹垣の所に歩きの当たり判定は無い。範囲の端は今のまま範囲で止まる）。範囲の端の竹垣はカメラ除けの箱にある', () => {
        const hits = (r: Rect, x0: number, x1: number, z0: number, z1: number) => r.x1 > x0 && r.x0 < x1 && r.z1 > z0 && r.z0 < z1;
        for (const r of colliders()) {
            for (const h of plan.houses) expect(hits(r, h.x0, h.x1, h.z0, h.z1), JSON.stringify(r)).toBe(false);
            for (const t of plan.trees) expect(hits(r, t.x - 0.3, t.x + 0.3, t.z - 0.3, t.z + 0.3), JSON.stringify(r)).toBe(false);
            for (const x of [EDGE_FENCE.west, EDGE_FENCE.east]) expect(hits(r, x - 0.1, x + 0.1, EDGE_FENCE.z0, EDGE_FENCE.z1), JSON.stringify(r)).toBe(false);
        }
        const fenceBoxes = cameraBlockers().filter((b) => b.x1 <= BOUNDS.x0 || b.x0 >= BOUNDS.x1);
        expect(fenceBoxes.length).toBe(2);
        for (const b of fenceBoxes) {
            expect(b.z0).toBeLessThanOrEqual(EDGE_FENCE.z0);
            expect(b.z1).toBeGreaterThanOrEqual(EDGE_FENCE.z1);
            expect(b.y1).toBeGreaterThan(EDGE_FENCE.h + 2);
        }
    });

    it('範囲の端に立って外を向いても、カメラは竹垣の手前（垣の向こうの家並みの中に入らない）', () => {
        for (const z of [-8, -1, 5, 12]) {
            for (const pitch of [-0.2, 0.1, 0.5]) {
                const west = placeFollow(createOrbit(-Math.PI / 2, pitch), BOUNDS.x0, z, 0).position;
                expect(west.x, `west z=${z} pitch=${pitch}`).toBeGreaterThan(EDGE_FENCE.west);
                const east = placeFollow(createOrbit(Math.PI / 2, pitch), BOUNDS.x1, z, 0).position;
                expect(east.x, `east z=${z} pitch=${pitch}`).toBeLessThan(EDGE_FENCE.east);
            }
        }
    });

    it('木が家の中から生えない：範囲の外の木（back_trees・範囲の外の通りの木）は中景の家の四角から根張りの分より離れ、中景の木（生垣を除く）の幹は家の四角（1 m の余白）の外', () => {
        const away = (h: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => Math.hypot(Math.max(h.x0 - x, 0, x - h.x1), Math.max(h.z0 - z, 0, z - h.z1));
        const meta = treesMeta as unknown as Record<string, { root_flare_radius?: number; trunk_radius_at_1m?: number }>;
        // 根張りの半径（無ければ幹の半径 + 0.5 m）× 大きさ
        const reach = (model: string, scale: number) => Math.max(meta[model]?.root_flare_radius ?? 0, (meta[model]?.trunk_radius_at_1m ?? 0.35) + 0.5) * scale;
        const outer = [...BACK_TREES.map((b) => ({ name: `back(${b.x}, ${b.z})`, ...b })), ...TREES.filter((t) => !inBounds(t.x, t.z))];
        expect(outer.length).toBeGreaterThan(0);
        for (const t of outer) for (const h of plan.houses) expect(away(h, t.x, t.z), `${t.name} ${JSON.stringify(h)}`).toBeGreaterThan(reach(t.model, t.scale));
        for (const t of plan.trees.filter((q) => q.kind !== 'hedge')) {
            for (const h of plan.houses) expect(t.x > h.x0 - 1 && t.x < h.x1 + 1 && t.z > h.z0 - 1 && t.z < h.z1 + 1, `${JSON.stringify(t)} ${JSON.stringify(h)}`).toBe(false);
        }
    });

    it('軽い形：全部で 3 万三角形まで、まとまりごとに 6 千まで（影は落とさない・受けない）', () => {
        let total = 0;
        for (const [c, g] of geo) {
            const tris = g.getAttribute('position').count / 3;
            expect(tris, c).toBeLessThan(6000);
            total += tris;
        }
        expect(total).toBeLessThan(30000);
        expect(plan.houses.length).toBeGreaterThanOrEqual(20);
        expect(plan.trees.length).toBeGreaterThanOrEqual(60);
    });

    it('毎回同じ形（種つきの乱数）', () => {
        expect(JSON.stringify(surroundPlan())).toBe(JSON.stringify(plan));
    });

    it('遠い木（範囲の外の木立・田畑の縁・村・遠くの林）は冠の絵の板：1 本 3 枚・表と裏で 12 三角形（材質 1）。生垣・町並みの家の間の近い木は塊（材質 0）', () => {
        const isCard = (t: (typeof plan.trees)[number]) => t.kind !== 'hedge' && CROWN_CLUSTERS.has(t.cluster);
        expect(plan.trees.filter(isCard).length).toBeGreaterThan(150);
        for (const [c, g] of geo) {
            const crownTris = g.groups.filter((q) => q.materialIndex === 1).reduce((a, q) => a + q.count / 3, 0);
            expect(crownTris, c).toBe(plan.trees.filter((t) => t.cluster === c && isCard(t)).length * 12);
            // 材質の区切りで形の全部を覆う（1 つの形を 2 つの材質で描く。どの三角形も描かれる）
            expect(g.groups.reduce((a, q) => a + q.count, 0), c).toBe(g.getAttribute('position').count);
        }
        // 板にする木は、歩ける範囲から 24 m より遠い（近くで見ると板とわかる）
        const away = (x: number, z: number) => Math.hypot(Math.max(BOUNDS.x0 - x, 0, x - BOUNDS.x1), Math.max(BOUNDS.z0 - z, 0, z - BOUNDS.z1));
        for (const t of plan.trees.filter(isCard)) expect(away(t.x, t.z), JSON.stringify(t)).toBeGreaterThan(24);
        // 町並みの家の間の木（範囲の端の近く）は板にしない
        expect(plan.trees.filter((t) => !CROWN_CLUSTERS.has(t.cluster) && t.kind !== 'hedge').length).toBeGreaterThan(0);
    });

    it('遠くの林：田畑（build_ground.py の FIELDS）・村の外、山並みの近い段の裾（と地面の端 200 m）より内側', () => {
        const [fx0, fx1, fz0, fz1] = groundFields();
        const groves = plan.trees.filter((t) => t.cluster === 'groves');
        expect(groves.length).toBeGreaterThanOrEqual(60);
        for (const t of groves) {
            expect(t.x > fx0 - 5 && t.x < fx1 + 5 && t.z > fz0 - 5 && t.z < fz1 + 5, JSON.stringify(t)).toBe(false);
            for (const h of plan.houses.filter((q) => q.cluster === 'village')) expect(t.x > h.x0 - 4 && t.x < h.x1 + 4 && t.z > h.z0 - 4 && t.z < h.z1 + 4).toBe(false);
            // 板の端（幅の半分）まで含めて、山並みの近い段の手前の裾より 2 m 以上内側
            expect(Math.hypot(t.x, t.z) + t.r * 1.25, JSON.stringify(t)).toBeLessThan(RANGES[0]!.front - 2);
        }
    });

    it('田畑の下の土の板：FIELDS を 15 m 以上の余白で覆い（北は町の細かい地面の端 z 19 まで）、田の水・用水路の底（−0.15 m）より下', () => {
        const [fx0, fx1, fz0, fz1] = groundFields();
        const u = FIELD_UNDERLAY;
        expect(u.x0).toBeLessThanOrEqual(fx0 - 15);
        expect(u.x1).toBeGreaterThanOrEqual(fx1 + 15);
        expect(u.z1).toBeGreaterThanOrEqual(fz1 + 15);
        expect(u.z0).toBeGreaterThanOrEqual(19);
        expect(u.z0).toBeLessThan(fz0);
        expect(u.y).toBeLessThan(-0.15);
        // 地面の端（200 m）の内側
        expect(Math.max(-u.x0, u.x1, u.z1)).toBeLessThan(200);
    });
});

describe('遠景（山並み 3 段）', () => {
    it('3 段：奥ほど遠く・高く・空の色に近い。手前の段の裾は地面の端（200 m）より内側', () => {
        expect(RANGES.length).toBe(3);
        for (let i = 1; i < RANGES.length; i++) {
            expect(RANGES[i]!.r).toBeGreaterThan(RANGES[i - 1]!.r * 1.5);
            expect(RANGES[i]!.haze).toBeGreaterThan(RANGES[i - 1]!.haze);
            expect(RANGES[i]!.h1).toBeGreaterThan(RANGES[i - 1]!.h1);
        }
        expect(RANGES[0]!.front).toBeLessThan(200);
        expect(RANGES[0]!.front).toBeGreaterThan(150);
    });

    it('霧を使わず（色で空気の遠近）、どの向きでも稜線は見上げて 12° 以下（平らな壁にしない）', () => {
        const g = makeHills(new THREE.Vector3(...TOWN_LIGHT.sunOffset));
        expect(g.children.length).toBe(3);
        for (const m of g.children as THREE.Mesh[]) {
            expect((m.material as THREE.MeshBasicMaterial).fog).toBe(false);
            const p = m.geometry.getAttribute('position');
            let maxAng = 0;
            let minR = Infinity;
            for (let i = 0; i < p.count; i++) {
                const r = Math.hypot(p.getX(i), p.getZ(i));
                minR = Math.min(minR, r);
                maxAng = Math.max(maxAng, (Math.atan2(p.getY(i) - 1.6, r) * 180) / Math.PI);
            }
            expect(maxAng, m.name).toBeLessThan(12);
            expect(minR, m.name).toBeGreaterThan(150);
        }
    });
});

describe('影を落とす物の選び方', () => {
    it('影を落とさない木は、城の土塀の線より北か東の土塀の向こう（通りから影の落ちる所が見えない）', () => {
        const eastWall = scene.walls.find((w) => w.name === 'east_ns')!;
        const noShadow = TREES.filter((t) => !t.shadow);
        expect(noShadow.map((t) => t.name).sort()).toEqual(['pine_back', 'pine_big', 'sakura']);
        for (const t of noShadow) expect(t.z < GATE.z || (t.x > eastWall.from[0] + 1 && t.z < eastWall.to[1]), t.name).toBe(true);
        // 通りの木（Version 28 の柳・松）は影を落とす
        for (const t of TREES.filter((x) => x.model === 'tree_willow28' || x.model === 'tree_pine_far')) expect(t.shadow, t.name).toBe(true);
    });
});

describe('接地の影', () => {
    const person = () => {
        const root = new THREE.Group();
        const bone = new THREE.Bone();
        const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.6, 0.3), new THREE.MeshStandardMaterial());
        mesh.add(bone);
        mesh.bind(new THREE.Skeleton([bone]));
        root.add(mesh);
        return root;
    };

    it('人物（骨組みのある形）だけを人物とみなす', () => {
        expect(isCharacter(person())).toBe(true);
        expect(isCharacter(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))).toBe(false);
    });

    it('人物の根に 1 枚（2 回足しても 1 枚）。足の高さのすぐ上・半径どおり・影は落とさない（まとめて castShadow を付けても）', () => {
        const p = person();
        const a = addContactShadow(p);
        const b = addContactShadow(p);
        expect(b).toBe(a);
        expect(p.children.filter((c) => c.userData.contactShadow).length).toBe(1);
        expect(a.position.y).toBeCloseTo(CONTACT_SHADOW.lift);
        expect(a.scale.x).toBeCloseTo(CONTACT_SHADOW.radius * 2);
        p.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        expect(a.castShadow).toBe(false);
        expect(a.receiveShadow).toBe(false);
        const m = a.material as THREE.MeshBasicMaterial;
        expect(m.transparent && !m.depthWrite).toBe(true);
    });
});
