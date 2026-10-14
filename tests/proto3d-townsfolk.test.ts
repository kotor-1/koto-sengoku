/**
 * 町人・兵の動き（Version 28 §4.2）：人ごとの拍子（同じ周期・同じ位相の人がいない）・道の角の向き（1 コマ 12° まで）・歩き出しと止まりの
 * 加速と減速・足が地面の上で滑らない（ゲームが読む町人の GLB とゲームの足の仕組みで、60 コマ/秒で動かして測る）・店の人の仕事の移りと会釈・
 * 座った町の兵（縦に潰さない。合戦の兵の形はそのまま）・隊列の兵が一斉に上下しない・担ぐ俵が頭に重ならない。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SOLE } from '../proto3d/src/game/legs';
import { groundY } from '../proto3d/src/layout';
import { ActorLayer, BALE } from '../proto3d/src/explore/actors';
import { ambientPlan, walkerAt, type AmbientWalker } from '../proto3d/src/explore/ambient';
import { PersonFactory } from '../proto3d/src/explore/people';
import { MERCHANT_TURN_SEC, TOWNSFOLK, TOWNSFOLK_SPEED, bowWeight, idleClipTime, merchantAct, rhythmOf, seeded } from '../proto3d/src/explore/rhythm';
import { CORNER_R, WALK_ACCEL, WALK_DECEL, alongPath, columnGait, pathLength, roundPath, stageFrame, walkProfile, type Pt, type StageCastInfo } from '../proto3d/src/explore/stage';
import { SEAT_DROP, TOWN_FIG, TownTroops, makeSeatedGeometries } from '../proto3d/src/explore/troops';
import { makeTroopGeometries } from '../proto3d/src/shared/figures';
import type { AmbientSpec, StageEvent } from '../proto3d/src/story/types';
import { loadGlb } from './proto3d-hero-rig';

const DT = 1 / 60;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** 待機の動き（Idle）の長さ（秒。hero_v2b.glb） */
const IDLE_SEC = 3.2;
const SPEC: AmbientSpec = { groups: [{ kind: 'porter', count: 2, place: 'street' }, { kind: 'merchant', count: 2, place: 'street' }] };
const CAST: StageCastInfo[] = [
    { id: 'tadakatsu', kind: 'person', look: 'genzo', x: -1.5, z: -7.2, heading: 2.9 },
    { id: 'oda_envoy', kind: 'person', look: 'tashiro_envoy', x: 2.0, z: -7.1, heading: -2.9 },
    { id: 'asai_envoy', kind: 'person', look: 'omori_envoy', x: 5.3, z: -2.4, heading: -Math.PI / 2 },
];
const EVENTS: StageEvent[] = [
    { id: 'envoys_arrive', envoys: [{ look: 'tashiro_envoy', name: '織田家の使者' }, { look: 'omori_envoy', name: '浅井家の使者' }], showHero: true },
    { id: 'envoys_arrive', envoys: [{ look: 'tashiro_envoy', name: '織田家の使者' }, { look: 'omori_envoy', name: '浅井家の使者' }] },
    { id: 'messenger_arrive', look: 'tashiro_envoy', name: '村の使い' },
    { id: 'town_life', hero: true },
    { id: 'retainer_report', look: 'genzo', name: '本多忠勝', castId: 'tadakatsu' },
    { id: 'reinforcement_arrive', count: 6, mark: '織' },
    { id: 'column_depart', count: 22, mark: '徳' },
    { id: 'column_return', count: 18, wounded: 5, mark: '徳', victory: false },
] as StageEvent[];

describe('人ごとの拍子（全員を同じ周期で動かさない）', () => {
    const keys = Object.keys(TOWNSFOLK);

    it('町の人の歩く速さは 0.95〜1.3 m/秒で、人ごとに違う。歩幅は速さに合う（遅い人ほど狭い）', () => {
        const speeds = keys.map((k) => TOWNSFOLK[k]!.speed);
        for (const v of speeds) {
            expect(v).toBeGreaterThanOrEqual(TOWNSFOLK_SPEED[0]);
            expect(v).toBeLessThanOrEqual(TOWNSFOLK_SPEED[1]);
        }
        expect(new Set(speeds).size).toBe(speeds.length);
        for (const k of keys) {
            const r = TOWNSFOLK[k]!;
            expect(r.stride).toBeGreaterThan(0.8);
            expect(r.stride).toBeLessThanOrEqual(1);
        }
        const slow = keys.reduce((a, b) => (TOWNSFOLK[a]!.speed < TOWNSFOLK[b]!.speed ? a : b));
        const fast = keys.reduce((a, b) => (TOWNSFOLK[a]!.speed > TOWNSFOLK[b]!.speed ? a : b));
        expect(TOWNSFOLK[slow]!.stride).toBeLessThan(TOWNSFOLK[fast]!.stride);
        // 名前から決める人（会話の相手・使者）も範囲の中で、同じ名前なら同じ
        for (const k of ['tadakatsu', 'oda_envoy', 'asai_envoy', 'envoy0', 'envoy1', 'retainer', 'messenger']) {
            const r = rhythmOf(k);
            expect(r).toEqual(rhythmOf(k));
            expect(r.speed).toBeGreaterThanOrEqual(TOWNSFOLK_SPEED[0]);
            expect(r.speed).toBeLessThanOrEqual(TOWNSFOLK_SPEED[1]);
            expect(r.idleRate).toBeGreaterThan(0.8);
            expect(r.idleRate).toBeLessThan(1.2);
        }
    });

    it('どの 2 人も、待機の周期と位相・歩きの周期と位相が同時にそろわない（周期 3% 以内かつ位相 0.08 以内の組は無い）', () => {
        const circ = (a: number, b: number) => {
            const d = Math.abs(a - b) % 1;
            return Math.min(d, 1 - d);
        };
        const all = [...keys, 'envoy0', 'envoy1', 'messenger', 'retainer', 'tadakatsu', 'oda_envoy', 'asai_envoy'];
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const a = rhythmOf(all[i]!);
                const b = rhythmOf(all[j]!);
                const idleSame = Math.abs(a.idleRate - b.idleRate) / a.idleRate < 0.03 && circ(a.idlePhase, b.idlePhase) < 0.08;
                expect(idleSame, `${all[i]} と ${all[j]} の待機`).toBe(false);
                const ca = (a.stride * 1.302) / a.speed;
                const cb = (b.stride * 1.302) / b.speed;
                const walkSame = Math.abs(ca - cb) / ca < 0.03 && circ(a.walkPhase, b.walkPhase) < 0.08;
                expect(walkSame, `${all[i]} と ${all[j]} の歩き`).toBe(false);
            }
        }
    });

    it('町の人々の待機の動きの再生位置は、30 秒のうち 2 割より長く重ならない（Version 27 は荷運び 2 人が 4 ms 差でずっと同じ）', () => {
        for (let i = 0; i < keys.length; i++) {
            for (let j = i + 1; j < keys.length; j++) {
                let same = 0;
                let n = 0;
                for (let t = 0; t < 30; t += 0.05, n++) {
                    const a = idleClipTime(TOWNSFOLK[keys[i]!]!, t, IDLE_SEC) / IDLE_SEC;
                    const b = idleClipTime(TOWNSFOLK[keys[j]!]!, t, IDLE_SEC) / IDLE_SEC;
                    const d = Math.abs(a - b);
                    if (Math.min(d, 1 - d) < 0.05) same++;
                }
                expect(same / n, `${keys[i]} と ${keys[j]}`).toBeLessThan(0.2);
            }
        }
    });

    it('名前から決まる数は、名前の最後の 1 字の違いでも大きく変わる', () => {
        const a = [0, 1, 2, 3].map((i) => seeded('porter0', i));
        const b = [0, 1, 2, 3].map((i) => seeded('porter1', i));
        expect(Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))).toBeGreaterThan(0.1);
        for (const v of [...a, ...b]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

describe('道の角・歩き出しと止まり', () => {
    it('角を丸めた道：両端は元のまま、角の近くだけ内側へ寄る（角から CORNER_R 程度まで）。細かな線の 1 本で 4° より大きく曲がらない', () => {
        const path: Pt[] = [
            [-8.0, 8.85],
            [-4.9, 8.75],
            [-3.1, 7.6],
            [-3.1, 6.6],
            [-3.75, 6.3],
        ];
        const r = roundPath(path);
        expect(r[0]).toEqual(path[0]);
        expect(r[r.length - 1]).toEqual(path[path.length - 1]);
        expect(roundPath(path)).toBe(r);
        let prev: number | null = null;
        for (let i = 1; i < r.length; i++) {
            const h = Math.atan2(r[i]![0] - r[i - 1]![0], r[i]![1] - r[i - 1]![1]);
            if (prev !== null) expect(deg(Math.abs(wrap(h - prev)))).toBeLessThanOrEqual(4.01);
            prev = h;
        }
        // 丸めた道の点は、元の折れ線から CORNER_R の半分より離れない
        const dist = (x: number, z: number) => {
            let m = Infinity;
            for (let i = 1; i < path.length; i++) {
                const [a, b] = [path[i - 1]!, path[i]!];
                const vx = b[0] - a[0];
                const vz = b[1] - a[1];
                const k = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz)));
                m = Math.min(m, Math.hypot(x - a[0] - vx * k, z - a[1] - vz * k));
            }
            return m;
        };
        for (const p of r) expect(dist(p[0], p[1])).toBeLessThan(CORNER_R / 2);
        expect(pathLength(r)).toBeLessThan(pathLength(path));
    });

    it('歩き出しと止まり：速さは 0 から上がり、0 まで下がって止まる（全速のまま 1 コマで止まらない）。距離は L で終わる', () => {
        for (const [v, L] of [
            [1.15, 7],
            [1.8, 6.1],
            [1.6, 0.6],
        ] as const) {
            const T = walkProfile(0, v, L).T;
            let prevS = 0;
            let prevV = 0;
            let maxAcc = 0;
            for (let t = 0; t <= T + 0.2; t += DT) {
                const w = walkProfile(t, v, L);
                expect(w.s).toBeGreaterThanOrEqual(prevS - 1e-9);
                maxAcc = Math.max(maxAcc, Math.abs(w.v - prevV) / DT);
                // 距離の増え方と速さが合う
                if (t > DT) expect(Math.abs((w.s - prevS) / DT - (w.v + prevV) / 2)).toBeLessThan(0.05);
                prevS = w.s;
                prevV = w.v;
            }
            expect(walkProfile(T, v, L).s).toBeCloseTo(L, 9);
            expect(walkProfile(T - DT, v, L).v).toBeLessThan(0.02);
            // 加速・減速は v × 1.5 ÷ 加速の秒 まで（なめらかに上げ下げ）
            expect(maxAcc).toBeLessThan((v * 1.5) / Math.min(WALK_ACCEL, WALK_DECEL) + 0.2);
        }
    });

    it('町の人々（荷運び・店の人）の体の向きは、往復のどの時刻でも 1 コマ（60 コマ/秒）で 12° を超えて変わらない。端では止まってから向き直る', () => {
        const plan = ambientPlan(SPEC);
        for (const w of plan.walkers) {
            let prev = walkerAt(w, 0);
            let maxStep = 0;
            let maxDv = 0;
            for (let t = DT; t < 60; t += DT) {
                const q = walkerAt(w, t);
                maxStep = Math.max(maxStep, Math.abs(wrap(q.heading - prev.heading)));
                // 1 コマの速さの変わり（m/秒）：全速から 1 コマで止まらない
                const v0 = Math.hypot(q.x - prev.x, q.z - prev.z) / DT;
                const nx = walkerAt(w, t + DT);
                const v1 = Math.hypot(nx.x - q.x, nx.z - q.z) / DT;
                maxDv = Math.max(maxDv, Math.abs(v1 - v0));
                // 向き直る（端で向きが変わる）のは止まっている間
                if (Math.abs(wrap(q.heading - prev.heading)) > 0.02 && w.speed > 0) expect(Math.hypot(q.x - prev.x, q.z - prev.z) / DT, `${w.key} t=${t.toFixed(2)}`).toBeLessThan(w.speed * 1.01);
                prev = q;
            }
            expect(deg(maxStep), w.key).toBeLessThanOrEqual(12);
            expect(maxDv, w.key).toBeLessThan(0.12);
        }
    });

    it('演出の人・兵（使者・町の様子・家臣・援兵・出陣・帰還）の向きも 1 コマで 12° を超えて変わらない（画の切り替えのコマは除く）', () => {
        for (const ev of EVENTS) {
            let prev = stageFrame(ev, 0, false, CAST);
            let maxStep = 0;
            for (let t = DT; t < 16; t += DT) {
                const f = stageFrame(ev, t, false, CAST);
                for (const list of ['people', 'figures'] as const) {
                    const a = prev[list] as { key?: string; x: number; z: number; heading: number }[];
                    const b = f[list] as { key?: string; x: number; z: number; heading: number }[];
                    b.forEach((p, i) => {
                        const q = list === 'people' ? a.find((x) => x.key === p.key) : a[i];
                        if (!q) return;
                        // 画の切り替え（使者の前の画 → 後の画）で置き直した人は除く
                        if (Math.hypot(p.x - q.x, p.z - q.z) > 0.5) return;
                        maxStep = Math.max(maxStep, Math.abs(wrap(p.heading - q.heading)));
                    });
                }
                prev = f;
            }
            expect(deg(maxStep), `${ev.id}`).toBeLessThanOrEqual(12);
        }
    });

    it('店の人は、待機・通りを見る・品物を整える（店の方へ向き直って前かがみ）を移り、ずっとお辞儀し続けない。2 人の仕事の順・時刻は違う', () => {
        const kinds = (key: string) => {
            const seen = new Set<string>();
            let leanTime = 0;
            for (let t = 0; t < 120; t += 0.1) {
                const m = merchantAct(key, 0, 0, Math.PI / 2, t);
                if (m.act.lean > 0.5) {
                    seen.add('arrange');
                    leanTime += 0.1;
                    // 品物を整える間は店の方（通りの反対）へ向き直っている
                    expect(Math.abs(wrap(m.heading - Math.PI / 2))).toBeGreaterThan(2);
                } else if (m.act.lookWeight > 0.5) seen.add('look');
                else if (m.act.lean === 0 && m.act.lookWeight === 0) seen.add('idle');
            }
            return { seen, leanShare: leanTime / 120 };
        };
        for (const k of ['merchant0', 'merchant1', 'life_merchant']) {
            const r = kinds(k);
            expect([...r.seen].sort()).toEqual(['arrange', 'idle', 'look']);
            // 前かがみは時間の半分より短い（Version 27 は 7 秒周期でずっとお辞儀）
            expect(r.leanShare).toBeLessThan(0.5);
            expect(r.leanShare).toBeGreaterThan(0.05);
        }
        const diff = Array.from({ length: 300 }, (_, i) => i * 0.2).filter((t) => merchantAct('merchant0', 0, 0, 0, t).act.lean !== merchantAct('merchant1', 0, 0, 0, t).act.lean).length;
        expect(diff).toBeGreaterThan(30);
        // 向き直りは MERCHANT_TURN_SEC 秒かけて（1 コマ 12° まで）
        let prev = merchantAct('merchant0', 0, 0, 0, 0).heading;
        for (let t = DT; t < 60; t += DT) {
            const h = merchantAct('merchant0', 0, 0, 0, t).heading;
            expect(deg(Math.abs(wrap(h - prev)))).toBeLessThanOrEqual(12);
            prev = h;
        }
        expect(MERCHANT_TURN_SEC).toBeGreaterThan(0.8);
        // 会釈の形：上げて・止めて・戻す（1.4 秒で終わる）
        expect(bowWeight(0)).toBe(0);
        expect(bowWeight(0.6)).toBe(1);
        expect(bowWeight(1.41)).toBe(0);
    });
});

describe('隊列の兵（出陣・帰還・援兵）', () => {
    it('兵ごとに歩幅（±10%）と位相が違い、横に並ぶ兵が一斉に上下しない（上下の高さの差が 0.05 未満の組は 3 割未満。Version 27 はすべて）', () => {
        const g = Array.from({ length: 24 }, (_, i) => columnGait(i));
        for (const x of g) {
            expect(x.stride).toBeGreaterThanOrEqual(0.9);
            expect(x.stride).toBeLessThanOrEqual(1.1);
        }
        expect(new Set(g.map((x) => x.offset)).size).toBe(24);
        for (const ev of EVENTS.filter((e) => e.id === 'column_depart' || e.id === 'column_return' || e.id === 'reinforcement_arrive')) {
            let same = 0;
            let pairs = 0;
            for (let t = 2; t < 8; t += 0.1) {
                const walking = stageFrame(ev, t, false).figures.filter((x) => x.pose === 'walk');
                for (let i = 0; i < walking.length; i++) {
                    for (let j = i + 1; j < walking.length; j++) {
                        const a = walking[i]!;
                        const b = walking[j]!;
                        const along = Math.abs((a.x - b.x) * Math.sin(a.heading) + (a.z - b.z) * Math.cos(a.heading));
                        if (along > 0.3) continue;
                        pairs++;
                        if (Math.abs(Math.abs(Math.sin(a.phase * Math.PI * 2)) - Math.abs(Math.sin(b.phase * Math.PI * 2))) < 0.05) same++;
                    }
                }
            }
            expect(pairs, ev.id).toBeGreaterThan(50);
            expect(same / pairs, ev.id).toBeLessThan(0.3);
        }
    });
});

describe('座った町の兵（縦に潰さない）・合戦の兵の形はそのまま', () => {
    /** 合戦の兵の形（shared/figures.ts の makeTroopGeometries）の中身の数（Version 28 の前の a3328d2 で測った値） */
    const BATTLE_GEOMETRY_HASH = 'ab124b73';

    it('合戦の兵の形は Version 27 と同じバイト列（町の座った形は町だけの別の形）', () => {
        const g = makeTroopGeometries();
        let h = 0x811c9dc5;
        for (const k of Object.keys(g).sort()) {
            const geo = g[k as keyof typeof g];
            const arrays = [...Object.keys(geo.attributes).sort().map((a) => (geo.attributes[a] as THREE.BufferAttribute).array), ...(geo.index ? [geo.index.array] : [])];
            for (const arr of arrays) {
                const u8 = new Uint8Array(arr.buffer.slice(0));
                for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i]!, 16777619) >>> 0;
            }
        }
        expect(h.toString(16)).toBe(BATTLE_GEOMETRY_HASH);
    });

    it('町の兵の行列は縦・横・奥で同じ大きさ（座る兵も）。座る兵は座った形で描き、頭は上体と一緒に下がる', () => {
        const troops = new TownTroops('t', 40, true);
        const base = { y: 0, heading: 0.3, phase: 0.2, lean: 0, mark: '徳', spear: false };
        const figs = [
            { ...base, x: 0, z: 0, pose: 'stand' as const },
            { ...base, x: 2, z: 0, pose: 'sit' as const },
            { ...base, x: 4, z: 0, pose: 'sitGround' as const },
            { ...base, x: 6, z: 0, pose: 'lie' as const },
            { ...base, x: 8, z: 0, pose: 'walk' as const },
        ];
        troops.set(figs, [], [], 1, null);
        const meshes = troops.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);
        const byName = (n: string) => meshes.find((m) => m.name.endsWith(`:${n}`))!;
        expect(byName('body').count).toBe(3);
        expect(byName('seat').count).toBe(1);
        expect(byName('seat-ground').count).toBe(1);
        expect(byName('head').count).toBe(5);
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        for (const mesh of meshes) {
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, m);
                m.decompose(p, q, s);
                for (const v of [s.x, s.y, s.z]) expect(v, mesh.name).toBeCloseTo(TOWN_FIG, 6);
            }
        }
        // 頭の高さ：立つ兵 1.72、床几 1.72 − 0.16、地べた 1.72 − 0.66（形の 1 m 単位 × 0.82）
        // 頭の球は形の中の y 1.72（shared/figures.ts と同じ）
        const head = byName('head');
        const headY = (i: number) => {
            head.getMatrixAt(i, m);
            return p.set(0, 1.72, 0).applyMatrix4(m).y - groundY(figs[i]!.x, figs[i]!.z);
        };
        expect(headY(1)).toBeLessThan(headY(0) - 0.1);
        expect(headY(2)).toBeLessThan(headY(1) - 0.3);
        expect(headY(2)).toBeGreaterThan(0.6);
        // 座った形：床几の兵の太ももは座面（0.445 m）の上、地べたの兵は地面より下へ出ない
        const g = makeSeatedGeometries();
        g.sit.computeBoundingBox();
        g.sitGround.computeBoundingBox();
        expect(g.sit.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
        expect(g.sitGround.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
        // 太もも（前へ出る）：前（−z）へ 0.4 より出る
        expect(g.sit.boundingBox!.min.z).toBeLessThan(-0.4);
        // 上体の上の端（小旗）：立つ形 2.33 から下げた分
        expect(g.sit.boundingBox!.max.y).toBeCloseTo(2.33 - SEAT_DROP.sit, 2);
        expect(g.sitGround.boundingBox!.max.y).toBeCloseTo(2.33 - SEAT_DROP.sitGround, 2);
        // 座面の高さ（床几 0.445 m）に、太ももの下（形で 0.54）が合う
        expect(0.54 * TOWN_FIG).toBeCloseTo(0.445, 1);
    });
});

describe('ゲームの町人の GLB で動かす（足が滑らない・俵が頭に重ならない・会釈）', async () => {
    const gltf = await loadGlb('hero_v2b');
    const cam = new THREE.PerspectiveCamera(150, 1, 0.1, 500);
    cam.position.set(0, 30, 2);
    cam.lookAt(0, 0, 2);
    cam.updateMatrixWorld();
    const layer = () => {
        const f = new PersonFactory(() => {}, true);
        f.setBase(gltf);
        return new ActorLayer('t', f, null, () => ({ w: 800, h: 600 }), 40, true);
    };
    type Body = { root: THREE.Object3D; bones: Map<string, THREE.Bone> };
    const peopleOf = (l: ActorLayer) => (l as unknown as { people: Map<string, { body: Body; bowAt: number | null }> }).people;
    /** 足の裏の 3 点（踵・母指球・足先）：[x, z, 地面からの高さ] を左右の足の順に */
    const soles = (b: Body) => {
        b.root.updateMatrixWorld(true);
        const out: [number, number, number][] = [];
        for (const n of ['LeftFoot', 'RightFoot']) {
            const fb = b.bones.get(n)!;
            for (const p of [SOLE.heel, SOLE.ball, SOLE.tip]) {
                const w = p.clone().applyMatrix4(fb.matrixWorld);
                out.push([w.x, w.z, w.y - groundY(w.x, w.z)]);
            }
        }
        return out;
    };
    /** 着いた足の速さ（tests/proto3d-hero-rig.ts の plantedSpeeds と同じ決まり。地面から 2 cm 以内） */
    const planted = (frames: [number, number, number][][], skip: Set<number>) => {
        const out: number[] = [];
        for (let i = 1; i < frames.length; i++) {
            if (skip.has(i)) continue;
            for (const k of [0, 1]) {
                const A = frames[i - 1]!.slice(k * 3, k * 3 + 3);
                const B = frames[i]!.slice(k * 3, k * 3 + 3);
                const low = (f: [number, number, number][]) => f.reduce((m, c, j) => (c[2] < f[m]![2] ? j : m), 0);
                if (low(A) !== low(B)) continue;
                const pa = A[low(A)]!;
                const pb = B[low(B)]!;
                if (pa[2] > 0.02 || pb[2] > 0.02 || Math.abs(pb[2] - pa[2]) / DT > 0.15) continue;
                out.push(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / DT);
            }
        }
        return out;
    };

    it('荷運び・店の人（40 秒）、使者・町の様子・家臣の歩き：着いた足の速さは 0.3 m/秒以下（歩き出し・角・止まり・向き直りを含む）', () => {
        const runs: { name: string; frames: number; list: (t: number) => readonly { key: string; x: number; z: number }[] }[] = [];
        const plan = ambientPlan(SPEC);
        runs.push({ name: 'ambient', frames: 40 * 60, list: (t) => plan.walkers.map((w) => walkerAt(w, t)) });
        for (const ev of EVENTS.slice(0, 5)) runs.push({ name: ev.id, frames: 10 * 60, list: (t) => stageFrame(ev, t, false, CAST).people });
        for (const run of runs) {
            const l = layer();
            const tracks = new Map<string, { frames: [number, number, number][][]; pos: [number, number][] }>();
            for (let i = 0; i <= run.frames; i++) {
                const t = i * DT;
                const list = run.list(t);
                l.setPeople(list as never, t, cam);
                for (const [k, a] of peopleOf(l)) {
                    let tr = tracks.get(k);
                    if (!tr) tracks.set(k, (tr = { frames: [], pos: [] }));
                    tr.frames.push(soles(a.body));
                    tr.pos.push([a.body.root.position.x, a.body.root.position.z]);
                }
            }
            for (const [k, tr] of tracks) {
                const skip = new Set<number>();
                for (let i = 1; i < tr.pos.length; i++) if (Math.hypot(tr.pos[i]![0] - tr.pos[i - 1]![0], tr.pos[i]![1] - tr.pos[i - 1]![1]) > 0.5) skip.add(i);
                const sp = planted(tr.frames, skip);
                expect(sp.length, `${run.name}:${k}`).toBeGreaterThan(50);
                expect(Math.max(...sp), `${run.name}:${k} の着いた足の速さ`).toBeLessThanOrEqual(0.3);
            }
        }
    }, 120_000);

    it('担ぐ俵は頭に重ならない（歩きの 1 周期のどのコマでも、俵の筒と頭の骨の間があく）', () => {
        const plan = ambientPlan(SPEC);
        const w = plan.walkers.find((x) => x.key === 'porter0') as AmbientWalker;
        const l = layer();
        let t0 = 0;
        while (!(walkerAt(w, t0).moving > 0.99 && walkerAt(w, t0).carrying)) t0 += DT;
        let minGap = Infinity;
        for (let i = 0; i < 90; i++) {
            const t = t0 + i * DT;
            l.setPeople([walkerAt(w, t)], t, cam);
            const a = peopleOf(l).get('porter0')!;
            a.body.root.updateMatrixWorld(true);
            const bale = (a.body.bones.get('RightShoulder')!.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh)!;
            expect(bale.visible).toBe(true);
            const head = new THREE.Vector3().setFromMatrixPosition(a.body.bones.get('Head')!.matrixWorld);
            // 俵の筒の軸（前後）と頭の骨の距離 − 俵の半径
            const c = new THREE.Vector3().setFromMatrixPosition(bale.matrixWorld);
            const axis = new THREE.Vector3(0, 1, 0).transformDirection(bale.matrixWorld);
            const v = head.clone().sub(c);
            const along = Math.max(-BALE.len / 2, Math.min(BALE.len / 2, v.dot(axis)));
            const d = v.sub(axis.multiplyScalar(along)).length() - BALE.r;
            minGap = Math.min(minGap, d);
        }
        // 頭の骨（首の付け根の上）から頭の横の端まで約 0.1 m：その外に俵がある
        expect(minGap).toBeGreaterThan(0.1);
    });

    it('店の人は、主人公が 3 m の内へ入ったときに 1 回だけ会釈する（近くに居続けても繰り返さない。遠くでは会釈しない）', () => {
        const plan = ambientPlan(SPEC);
        const w = plan.walkers.find((x) => x.key === 'merchant0')!;
        // 仕事をしていない時刻を探す
        let t0 = 0;
        while (walkerAt(w, t0).act && (walkerAt(w, t0).act!.lean > 0 || walkerAt(w, t0).act!.lookWeight > 0)) t0 += 0.1;
        const l = layer();
        const m = walkerAt(w, t0);
        const bows: number[] = [];
        for (let i = 0; i < 240; i++) {
            const t = t0 + i * DT;
            // 主人公：はじめ 6 m 前、0.5 秒後から 2.2 m 前に立ち続ける
            const hero = i < 30 ? { x: m.x + 6, z: m.z } : { x: m.x + 2.2, z: m.z + 0.3 };
            l.setPeople([walkerAt(w, t)], t, cam, true, hero);
            const a = peopleOf(l).get('merchant0')!;
            if (a.bowAt !== null && !bows.includes(a.bowAt)) bows.push(a.bowAt);
        }
        expect(bows.length).toBe(1);
        expect(bows[0]!).toBeGreaterThanOrEqual(t0 + 0.5 - 1e-9);
        // 遠く（4 m）を通るだけなら会釈しない
        const l2 = layer();
        for (let i = 0; i < 120; i++) l2.setPeople([walkerAt(w, t0 + i * DT)], t0 + i * DT, cam, true, { x: m.x + 4, z: m.z + 2 - i * 0.03 });
        expect(peopleOf(l2).get('merchant0')!.bowAt).toBe(null);
    });
});

it('町の人の道（角を丸めても）・止まる所は元の道すじの点のまま（町の配置は変えない）', () => {
    const plan = ambientPlan(SPEC);
    for (const w of plan.walkers.filter((x) => x.speed > 0)) {
        const P = roundPath(w.path);
        const T = 2 * (walkProfile(0, w.speed, pathLength(P)).T + w.pause);
        const ends = [walkerAt(w, -w.offset + 0.1), walkerAt(w, -w.offset + T / 2 + 0.1)];
        expect([ends[0]!.x, ends[0]!.z]).toEqual([w.path[0]![0], w.path[0]![1]]);
        const last = w.path[w.path.length - 1]!;
        expect(ends[1]!.x).toBeCloseTo(last[0], 9);
        expect(ends[1]!.z).toBeCloseTo(last[1], 9);
        const [a, b] = [alongPath(P, 0), alongPath(w.path, 0)];
        expect([a.x, a.z]).toEqual([b.x, b.z]);
        expect(a.heading).toBeCloseTo(b.heading, 9);
    }
});
