/**
 * Version 28 の町の小物（Blender で形から作った props28.glb）の置き方と当たり判定の確かめ。
 * - 置き方（town/plan.ts の TOWN_PROPS の parts）をゲームの座標へ写した一覧は street28/props28.placed.json と同じ
 *   （地面の制作 scene/build_ground.py が、この一覧で小物を置いて接地の陰を焼く。2 か所の置き方がずれない）。
 *   一覧を書き直すとき：UPDATE_PLACED=1 npx vitest run tests/proto3d-town-props.test.ts
 * - 小物の当たり判定・カメラ除けは、種類ごとの固い部品の箱（制作が書き出した props28.types.json）を置き場所へ写したもの。
 */
import { describe, expect, it } from 'vitest';
import { colliders, groundY, type Rect } from '../proto3d/src/layout';
import { KIDO, PROP_DIMS, PROP_TYPES, TOWER, TOWN_PROPS, partToProp, propRect, propToWorld, townColliders, type PropType } from '../proto3d/src/town/plan';
import { ENTRY_POSE, LOOKOUT } from '../proto3d/src/town/spots';
import { SPOTS } from '../proto3d/src/explore/cast';
import { GUARD_SPOTS, MERCHANT_SPOTS, PORTER_PATHS, reinforcementLayout } from '../proto3d/src/explore/ambient';
import { GROUND_SITS, GUARD_STOOLS, MATS } from '../proto3d/src/town/plan';
import street from '../proto3d/blender/street28/street28.json';

import placedDoc from '../proto3d/blender/street28/props28.placed.json';

/** 一覧を書き直すとき（UPDATE_PLACED=1）だけ使う（型の確かめに node の型を入れないので、動的に読む） */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** 置き方の一覧（ゲームの座標。y は小物の地面からの高さ） */
function placedList() {
    const out: { prop: string; cluster: string; type: PropType; x: number; y: number; z: number; rotY: number; sx: number }[] = [];
    for (const p of TOWN_PROPS) {
        for (const q of p.parts) {
            const c = partToProp(q, 0, 0);
            const w = propToWorld(p, c.x, c.z);
            out.push({ prop: p.name, cluster: p.cluster, type: q.type, x: r4(w.x), y: r4(q.y), z: r4(w.z), rotY: r4(p.rotY + q.rotY), sx: r4(q.sx ?? 1) });
        }
    }
    return out;
}

/**
 * 低木・草むらを置かない所（地面の制作 build_ground.py が読む）：人物の置き場所・町の人の道すじ・休み場の負傷兵・援兵・物見・町の入口。
 * 草は人の足元にあってよいが、つつじ・しだ（高さ 0.5〜1 m）はこの点・線から離して置く
 */
function keepClear() {
    const pts: [number, number][] = [
        ...Object.values(SPOTS).flatMap((ph) => Object.values(ph).map((sp) => [sp![0], sp![1]] as [number, number])),
        ...MERCHANT_SPOTS.map(([x, z]) => [x, z] as [number, number]),
        ...GUARD_SPOTS.map(([x, z]) => [x, z] as [number, number]),
        ...GROUND_SITS.map(([x, z]) => [x, z] as [number, number]),
        ...GUARD_STOOLS.map(([x, z]) => [x, z] as [number, number]),
        ...MATS.map(([x, z]) => [x, z] as [number, number]),
        ...reinforcementLayout(6, '徳').figures.map((f) => [f.x, f.z] as [number, number]),
        [LOOKOUT.x, LOOKOUT.z],
        [ENTRY_POSE.x, ENTRY_POSE.z],
    ];
    return { points: pts.map(([x, z]) => [r4(x), r4(z)]), paths: PORTER_PATHS.map((path) => path.map(([x, z]) => [r4(x), r4(z)])) };
}

describe('Version 28 の町の小物（Blender で作った形）', () => {
    it('置き方の一覧は street28/props28.placed.json と同じ（地面の制作が同じ置き方で接地の陰を焼く）', async () => {
        const list = placedList();
        if (env.UPDATE_PLACED) {
            const doc = {
                _about:
                    '町の小物の置き方（ゲームの座標。town/plan.ts の TOWN_PROPS の parts を写した一覧。手で書かない）。地面の制作（scene/build_ground.py）がこの一覧で props28.glb の形を置いて接地の陰を焼く。' +
                    '書き直し：UPDATE_PLACED=1 npx vitest run tests/proto3d-town-props.test.ts',
                placed: list,
                keep_clear: keepClear(),
            };
            const fsName = 'node:fs';
            const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync(p: URL, text: string): void };
            fs.writeFileSync(new URL('../proto3d/blender/street28/props28.placed.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n');
            return;
        }
        expect(placedDoc.placed).toEqual(list);
        expect(placedDoc.keep_clear).toEqual(keepClear());
    });

    it('色だけの箱の小物はない：コードで作る形は軍議所の陣幕の囲いと机だけ。ほかは Blender の形の種類を置く', () => {
        for (const p of TOWN_PROPS) {
            if (p.name === 'council_tent') {
                expect(p.pieces.length).toBeGreaterThan(0);
                continue;
            }
            expect(p.pieces, p.name).toEqual([]);
            expect(p.parts.length, p.name).toBeGreaterThan(0);
            for (const q of p.parts) expect(PROP_TYPES[q.type], `${p.name}: ${q.type}`).toBeDefined();
        }
        const used = new Set(TOWN_PROPS.flatMap((p) => p.parts.map((q) => q.type)));
        for (const t of ['kido', 'fence_bay', 'fence_post', 'tower', 'tower_top', 'hut', 'cart', 'tawara', 'basket', 'tub', 'stool', 'spear_rack', 'mat'] as const) expect(used.has(t), t).toBe(true);
    });

    it('当たり判定・カメラ除けは種類ごとの固い部品の箱を写したもの（形の数 × 箱の数だけあり、手で書いた箱ではない）', () => {
        for (const p of TOWN_PROPS) {
            if (p.name === 'council_tent') continue;
            const nWalk = p.parts.reduce((n, q) => n + PROP_TYPES[q.type].walk.length, 0);
            const nCam = p.parts.reduce((n, q) => n + PROP_TYPES[q.type].camera.length, 0);
            expect(p.colliders.length, p.name).toBe(nWalk);
            expect(p.blockers.length, p.name).toBe(nCam);
        }
        // 固い物（樽・荷車・俵・柵・木戸の柱・物見櫓の脚・小屋）にはどれも歩きの当たり判定がある。平らな筵だけは無い
        for (const t of Object.keys(PROP_TYPES) as PropType[]) {
            if (t === 'mat' || t === 'tower_top') expect(PROP_TYPES[t].walk, t).toEqual([]);
            else expect(PROP_TYPES[t].walk.length, t).toBeGreaterThan(0);
        }
        // 筵は影を落とさない（平ら）。ほかは落とす
        expect(PROP_TYPES.mat.cast).toBe(false);
        expect(PROP_TYPES.cart.cast).toBe(true);
    });

    it('当たり判定は形の足元と合う：種類ごとの歩きの箱は形の全体の箱の中にあり、全体の箱の床の広さの 6 割以上を覆う（筵・屋根を除く）', () => {
        for (const t of Object.keys(PROP_TYPES) as PropType[]) {
            const info = PROP_TYPES[t];
            if (!info.walk.length) continue;
            const b = info.bounds;
            const u = info.walk.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), x1: Math.max(a.x1, r.x1), z0: Math.min(a.z0, r.z0), z1: Math.max(a.z1, r.z1) }));
            for (const r of info.walk) {
                expect(r.x0, t).toBeGreaterThanOrEqual(b.x0 - 1e-6);
                expect(r.x1, t).toBeLessThanOrEqual(b.x1 + 1e-6);
                expect(r.z0, t).toBeGreaterThanOrEqual(b.z0 - 1e-6);
                expect(r.z1, t).toBeLessThanOrEqual(b.z1 + 1e-6);
            }
            // 屋根・軒の張り出し（高い所）は歩きの箱に入れないので、木戸・小屋・櫓・高札は全体の箱より小さい
            if (['kido', 'hut', 'tower', 'kosatsu', 'spear_rack'].includes(t)) continue;
            expect((u.x1 - u.x0) * (u.z1 - u.z0), t).toBeGreaterThan(0.6 * (b.x1 - b.x0) * (b.z1 - b.z0));
        }
    });

    it('柵は 1 間ずつの形を長さに合わせて並べ（伸び縮みは ±15% まで。1 間より短い柵（木戸の東の 1.22 m）は 1 間を 0.6 倍まで縮める）、終わりに柱。当たり判定は柵の線の帯', () => {
        for (const p of TOWN_PROPS.filter((q) => q.parts.some((x) => x.type === 'fence_bay'))) {
            const bays = p.parts.filter((q) => q.type === 'fence_bay');
            const spec = street.props.find((s) => s.id === p.name)!;
            for (const q of bays) {
                expect(q.sx!).toBeGreaterThan(bays.length === 1 ? 0.6 : 0.85);
                expect(q.sx!).toBeLessThan(1.15);
            }
            expect(bays.length * PROP_DIMS.fence_bay * bays[0]!.sx!).toBeCloseTo(spec.len!, 6);
            expect(p.parts[p.parts.length - 1]!.type).toBe('fence_post');
            for (const r of p.colliders) {
                const w = propRect(p, r);
                expect(w.z1 - w.z0, p.name).toBeLessThan(0.35);
            }
        }
    });

    it('俵の山：下の俵は地面に、上の俵は下の 2 つの間の溝に載る（宙に浮かない・めり込まない）', () => {
        const r = PROP_DIMS.bale.r;
        for (const p of TOWN_PROPS.filter((q) => q.parts.some((x) => x.type === 'tawara'))) {
            const lows = p.parts.filter((q) => q.y === 0);
            const ups = p.parts.filter((q) => q.y > 0);
            expect(ups.length).toBe(Math.max(0, lows.length - 1));
            for (const u of ups) {
                const near = lows.map((l) => Math.hypot(l.z - u.z, r - (u.y + r))).sort((a, b) => a - b);
                // 上の俵の中心から、いちばん近い下の 2 つの中心まで、俵の直径（±1 cm）
                expect(near[0]!).toBeGreaterThan(2 * r - 0.01);
                expect(near[1]!).toBeLessThan(2 * r + 0.01);
            }
        }
    });

    it('木戸の横木・屋根は高さ 2.95〜3.9 m・柱の外 0.75 m まで（隊列の槍・のぼりの確かめ：tests/proto3d-town-stage.test.ts）。扉は道の口（x ±2.6）の外', () => {
        const k = PROP_TYPES.kido;
        for (const b of k.camera.filter((c) => c.y0 >= 2.5)) {
            expect(b.y0).toBeGreaterThanOrEqual(2.95);
            expect(b.y1).toBeLessThanOrEqual(3.9);
            expect(Math.max(-b.x0, b.x1)).toBeLessThanOrEqual(KIDO.postX + 0.75);
        }
        for (const r of k.walk) expect(Math.min(Math.abs(r.x0), Math.abs(r.x1))).toBeGreaterThanOrEqual(KIDO.open);
    });

    it('物見櫓：梯子の足は物見の位置（LOOKOUT）の南にあって、物見の位置は空いている。屋根の柱の箱は物見の目の高さの真ん中を塞がない', () => {
        const all = colliders();
        const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
        expect(all.some((r) => inside(r, LOOKOUT.x, LOOKOUT.z))).toBe(false);
        const tower = TOWN_PROPS.find((p) => p.name === 'lookout_tower')!;
        const ladder = tower.colliders.map((r) => propRect(tower, r)).find((r) => r.z1 - r.z0 < 0.6)!;
        expect(ladder.z0).toBeGreaterThan(LOOKOUT.z);
        for (const b of PROP_TYPES.tower_top.camera) {
            const covers = b.x0 < 0 && b.x1 > 0 && b.z0 < 0 && b.z1 > 0;
            if (covers) expect(b.y0).toBeGreaterThan(TOWER.eyeY);
        }
    });

    it('小物はどれも地面の上（置いた所の地面の高さ ±8 cm の範囲の格子の中）。歩ける範囲の近く', () => {
        for (const p of TOWN_PROPS) {
            for (const q of p.parts) {
                const c = partToProp(q, 0, 0);
                const w = propToWorld(p, c.x, c.z);
                expect(Math.abs(groundY(w.x, w.z)), `${p.name}:${q.type}`).toBeLessThan(0.08);
            }
        }
        expect(townColliders().length).toBeGreaterThan(40);
    });
});
