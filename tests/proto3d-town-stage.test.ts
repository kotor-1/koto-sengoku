/**
 * 演出の 3D の出来事（proto3d/src/explore/stage.ts）と、探索の場面の口（explore/world.ts の stage）：
 * - 時刻 t の純粋な関数（同じ t で同じ形。呼ぶ順によらない）。動きを減らすとカメラも人も動かない。
 * - カメラの道がカメラ除けの箱に入らない。動きはゆっくり（急な回転・急な移動をしない。使者の場面の 1 回の切り替えだけは画の替わり）。
 * - 人・兵は当たり判定（家・塀・小物）の中を通らない。人数・負傷・旗は出来事のとおり。
 * - stage(null) で、出した物を片付け、カメラの差し替えを外し、主人公の位置・向き・見回しを始める前に戻す（何度呼んでもよい）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARRIVAL_CUT, columnSlots, shotsOver, stageFrame, type StageCastInfo } from '../proto3d/src/explore/stage';
import { blockersForTest } from '../proto3d/src/game/follow';
import { createHero } from '../proto3d/src/game/motion';
import { START, cameraBlockers, colliders, type Rect } from '../proto3d/src/layout';
import type { StageEvent } from '../proto3d/src/story/types';

const ALL = colliders();
const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/** 第一章の探索の配役（使者の行き先）と、第一章の支度の配役（使者は 1 人だけ） */
const CAST_EXPLORE: StageCastInfo[] = [
    { id: 'tadakatsu', kind: 'person', look: 'genzo', x: -1.5, z: -7.2, heading: 2.9 },
    { id: 'oda_envoy', kind: 'person', look: 'tashiro_envoy', x: 2.0, z: -7.1, heading: -2.9 },
    { id: 'asai_envoy', kind: 'person', look: 'omori_envoy', x: 5.3, z: -2.4, heading: -Math.PI / 2 },
    { id: 'notice', kind: 'notice', x: 5.5, z: -8.3, heading: -Math.PI / 2 },
];
const CAST_MUSTER: StageCastInfo[] = [
    { id: 'tadakatsu', kind: 'person', look: 'genzo', x: -2.0, z: -7.4, heading: 2.9 },
    { id: 'asai_envoy', kind: 'person', look: 'omori_envoy', x: 2.0, z: -7.1, heading: -2.9 },
    { id: 'gate', kind: 'gate', x: 0, z: -10.9, heading: 0 },
];

const EVENTS: StageEvent[] = [
    { id: 'envoys_arrive', envoys: [{ look: 'tashiro_envoy', name: '織田家の使者' }, { look: 'omori_envoy', name: '浅井家の使者' }] },
    { id: 'messenger_arrive', look: 'tashiro_envoy', name: '村の使い' },
    { id: 'wounded_rest', count: 12 },
    { id: 'wounded_rest', count: 3 },
    { id: 'reinforcement_arrive', count: 6, mark: '織', name: '織田' },
    { id: 'column_depart', count: 24, mark: '徳' },
    { id: 'column_depart', count: 5, mark: '徳' },
    { id: 'column_return', count: 24, wounded: 4, mark: '徳', victory: true },
    { id: 'column_return', count: 9, wounded: 6, mark: '徳', victory: false },
    { id: 'column_return', count: 1, wounded: 1, mark: '徳', victory: false },
];
const TS = [0, 0.3, 1, 2.5, 4, ARRIVAL_CUT - 0.01, ARRIVAL_CUT + 0.01, 6, 8, 10, 13, 20, 40];

describe('演出の 3D の出来事：時刻 t の純粋な関数', () => {
    it('同じ出来事・同じ t・同じ配役なら同じ形（呼ぶ順・前に呼んだ t によらない）', () => {
        for (const ev of EVENTS) {
            for (const cast of [[], CAST_EXPLORE, CAST_MUSTER]) {
                for (const reduced of [false, true]) {
                    const a = TS.map((t) => stageFrame(ev, t, reduced, cast));
                    const b = [...TS].reverse().map((t) => stageFrame(ev, t, reduced, cast)).reverse();
                    expect(b).toEqual(a);
                    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
                }
            }
        }
    });

    it('動きを減らす：カメラは動かず、人と兵も t によらず同じ所（位置を変えずに現れる）', () => {
        for (const ev of EVENTS) {
            const f0 = stageFrame(ev, 0, true, CAST_EXPLORE);
            for (const t of TS) {
                const f = stageFrame(ev, t, true, CAST_EXPLORE);
                expect(f.shot).toEqual(f0.shot);
                expect(f.figures.map((x) => [x.x, x.z, x.pose])).toEqual(f0.figures.map((x) => [x.x, x.z, x.pose]));
                expect(f.people.map((x) => [x.x, x.z, x.moving])).toEqual(f0.people.map((x) => [x.x, x.z, x.moving]));
                for (const p of f.people) expect(p.moving).toBe(0);
                for (const x of f.figures) expect(x.pose === 'walk' || x.pose === 'limp').toBe(false);
            }
        }
    });

    it('カメラはカメラ除けの箱（カメラの大きさの分を広げた箱）に入らない（どの出来事・どの t でも、減らしても）', () => {
        const boxes = blockersForTest(cameraBlockers());
        const v = new THREE.Vector3();
        for (const ev of EVENTS) {
            for (const reduced of [false, true]) {
                for (const { t, shot } of shotsOver(ev, reduced, 30, 0.1, CAST_EXPLORE)) {
                    v.set(shot.px, shot.py, shot.pz);
                    for (const b of boxes) if (b.containsPoint(v)) throw new Error(`${ev.id} t=${t}：カメラ (${shot.px.toFixed(2)}, ${shot.py.toFixed(2)}, ${shot.pz.toFixed(2)}) が箱の中`);
                    expect(shot.py).toBeGreaterThan(0.6);
                }
            }
        }
    });

    it('カメラの動きはゆっくり：向きは毎秒 12° まで、位置は毎秒 0.5 m まで（使者の場面の切り替え 1 回を除く）', () => {
        const dir = (s: { px: number; py: number; pz: number; tx: number; ty: number; tz: number }) => new THREE.Vector3(s.tx - s.px, s.ty - s.py, s.tz - s.pz).normalize();
        for (const ev of EVENTS) {
            const step = 0.05;
            const list = shotsOver(ev, false, 30, step, CAST_EXPLORE);
            let maxAng = 0;
            let maxMove = 0;
            for (let i = 1; i < list.length; i++) {
                const a = list[i - 1]!;
                const b = list[i]!;
                const cut = (ev.id === 'envoys_arrive' || ev.id === 'messenger_arrive') && a.t < ARRIVAL_CUT && b.t >= ARRIVAL_CUT;
                if (cut) continue;
                maxAng = Math.max(maxAng, (dir(a.shot).angleTo(dir(b.shot)) * 180) / Math.PI / step);
                maxMove = Math.max(maxMove, Math.hypot(b.shot.px - a.shot.px, b.shot.py - a.shot.py, b.shot.pz - a.shot.pz) / step);
            }
            expect(maxAng, `${ev.id} の向きの速さ（°/秒）`).toBeLessThan(12);
            expect(maxMove, `${ev.id} の位置の速さ（m/秒）`).toBeLessThan(0.5);
        }
    });

    it('人・兵は、家・塀・柱・小物の当たり判定の中を通らない', () => {
        for (const ev of EVENTS) {
            for (let t = 0; t <= 30; t += 0.2) {
                const f = stageFrame(ev, t, false, CAST_EXPLORE);
                for (const p of [...f.people, ...f.figures.filter((x) => x.pose !== 'sit')]) {
                    for (const r of ALL) if (inside(r, p.x, p.z)) throw new Error(`${ev.id} t=${t.toFixed(1)}：(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) が当たり判定 ${JSON.stringify(r)} の中`);
                }
            }
        }
    });
});

describe('出来事の中身（人数・負傷・旗・行き先）', () => {
    it('使者は同じ見た目の人物の所へ歩き、着くまではその人物を隠し、着いたら人物に替わる', () => {
        const ev = EVENTS[0]!;
        const early = stageFrame(ev, 1, false, CAST_EXPLORE);
        expect(early.people.map((p) => p.look)).toEqual(['tashiro_envoy', 'omori_envoy']);
        expect(early.hideCast.sort()).toEqual(['asai_envoy', 'oda_envoy']);
        // 前の画：街道口（木戸の外〜通り）を歩く
        for (const p of early.people) expect(p.z).toBeGreaterThan(8);
        const late = stageFrame(ev, 40, false, CAST_EXPLORE);
        expect(late.people).toEqual([]);
        expect(late.hideCast).toEqual([]);
        // 着く少し前は行き先のすぐ近く
        let arrivedAt = -1;
        for (let t = ARRIVAL_CUT; t < 30; t += 0.05) {
            if (!stageFrame(ev, t, false, CAST_EXPLORE).hideCast.includes('oda_envoy')) {
                arrivedAt = t;
                break;
            }
        }
        expect(arrivedAt).toBeGreaterThan(ARRIVAL_CUT);
        // 場面の長さ（第一章の導入では 8 秒）の中で着く
        expect(arrivedAt).toBeLessThan(7.9);
        const before = stageFrame(ev, arrivedAt - 0.1, false, CAST_EXPLORE).people.find((p) => p.look === 'tashiro_envoy')!;
        expect(Math.hypot(before.x - 2.0, before.z + 7.1)).toBeLessThan(0.4);
    });

    it('同じ見た目の人物がいない使者は、人物と重ならない空いた所へ行き、場面の終わりまで残る', () => {
        const f = stageFrame(EVENTS[0]!, 30, false, CAST_MUSTER);
        const oda = f.people.find((p) => p.look === 'tashiro_envoy')!;
        expect(oda).toBeTruthy();
        for (const c of CAST_MUSTER) expect(Math.hypot(oda.x - c.x, oda.z - c.z)).toBeGreaterThan(1.1);
        expect(f.hideCast).toEqual([]);
    });

    it('負傷兵は数のとおり（上限 12）で、筵に横になる・床几に座る。町の人々の負傷兵は隠す', () => {
        for (const n of [0, 1, 6, 9, 12, 30]) {
            const f = stageFrame({ id: 'wounded_rest', count: n }, 3, false);
            expect(f.figures.length).toBe(Math.min(12, n));
            expect(f.figures.filter((x) => x.pose === 'lie').length).toBe(Math.min(6, n));
            expect(f.hideAmbient).toContain('wounded');
        }
    });

    it('隊列は数のとおり。帰還の負傷は wounded 人（足を引きずる・担架）。勝てば旗を掲げ、勝てなければ巻いて傾ける', () => {
        for (const ev of EVENTS.filter((e) => e.id === 'column_depart' || e.id === 'column_return' || e.id === 'reinforcement_arrive')) {
            const f = stageFrame(ev, 6, false);
            expect(f.figures.length, ev.id).toBe(ev.count);
            if (ev.id === 'column_return') {
                const hurt = f.figures.filter((x) => x.pose === 'limp' || x.pose === 'carried').length;
                expect(hurt, JSON.stringify(ev)).toBe(Math.min(ev.wounded, ev.count));
                const b = f.banners[0];
                if (ev.count - ev.wounded > 0) {
                    expect(b, JSON.stringify(ev)).toBeTruthy();
                    expect(b!.open).toBe(ev.victory);
                    expect(b!.tilt === 0).toBe(ev.victory);
                }
            } else {
                expect(f.banners.length).toBe(1);
                expect(f.banners[0]!.mark).toBe(ev.mark);
            }
        }
        // 並び：負傷 2 人以上・元気な人 3 人以上なら担架 1 つ（運ぶ 2 人と横になった 1 人）
        const slots = columnSlots(9, 4, 2);
        expect(slots.filter((s) => s.role === 'carried').length).toBe(1);
        expect(slots.filter((s) => s.role === 'bearer').length).toBe(2);
        expect(slots.length).toBe(9);
    });

    it('出陣の隊列は城内で整って（始めは止まって）から、城門を出て南へ。帰還は木戸の外から北へ', () => {
        const d0 = stageFrame(EVENTS[5]!, 0, false);
        for (const x of d0.figures) {
            expect(x.pose).toBe('stand');
            expect(x.z).toBeLessThan(-12);
        }
        const d1 = stageFrame(EVENTS[5]!, 8, false);
        expect(Math.max(...d1.figures.map((x) => x.z))).toBeGreaterThan(-6);
        const r0 = stageFrame(EVENTS[7]!, 0, false);
        expect(Math.min(...r0.figures.map((x) => x.z))).toBeGreaterThan(16.4);
        const r1 = stageFrame(EVENTS[7]!, 8, false);
        expect(Math.min(...r1.figures.map((x) => x.z))).toBeLessThan(16.4);
    });
});

// ---------------- 探索の場面の口（explore/world.ts）：片付けで戻る ----------------

/** DOM の代わり（ExploreWorld が使う所だけ） */
function fakeElement(tag = 'div'): Record<string, unknown> {
    const children: unknown[] = [];
    const classes = new Set<string>();
    const el: Record<string, unknown> = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        dataset: {},
        style: {},
        children,
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
        },
        appendChild: (c: unknown) => children.push(c),
        append: (...c: unknown[]) => children.push(...c),
        remove: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
        width: 0,
        height: 0,
    };
    return el;
}

describe('探索の場面の口：stage(null) で片付けて戻る', () => {
    it('出来事の間は主人公を描かず、カメラを差し替える。stage(null) で人・兵を片付け、主人公の位置・向き・見回しを戻し、カメラを戻す', async () => {
        const g = globalThis as Record<string, unknown>;
        g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body') };
        g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
        const { ExploreWorld } = await import('../proto3d/src/explore/world');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(48, 2, 0.1, 2000);
        const hero = createHero(3.3, 1.2, 2.1);
        const orbit = { yaw: 1.1, pitch: 0.2, dist: 2.1 };
        const shots: unknown[] = [];
        const poses: unknown[] = [];
        const host = {
            scene,
            camera,
            overlay: fakeElement() as unknown as HTMLElement,
            hero,
            low: true,
            load: () => Promise.reject(new Error('素材なし（テスト）')),
            prepare: () => undefined,
            setHeroPose: (p: { x: number; z: number; heading: number }) => {
                poses.push(p);
                hero.x = p.x;
                hero.z = p.z;
                hero.heading = p.heading;
                // 本物と同じく、見回しも背後へ戻す
                orbit.yaw = p.heading - Math.PI;
                orbit.pitch = -0.08;
            },
            setControl: () => undefined,
            setRenderPaused: () => undefined,
            setExtraColliders: () => undefined,
            onFrame: () => undefined,
            viewSize: () => ({ w: 800, h: 400 }),
            orbit,
            setCameraShot: (s: unknown) => {
                shots.push(s);
                if (s) {
                    const sh = s as { px: number; py: number; pz: number; tx: number; ty: number; tz: number };
                    camera.position.set(sh.px, sh.py, sh.pz);
                    camera.lookAt(sh.tx, sh.ty, sh.tz);
                    camera.updateMatrixWorld();
                }
            },
            renderOnce: () => undefined,
            setLookHandler: () => undefined,
        };
        const world = new ExploreWorld(host as never);
        await world.preload();
        world.setCast([
            { id: 'oda_envoy', kind: 'person', look: 'tashiro_envoy', x: 2.0, z: -7.1, heading: 0, pose: 'stand', label: '織田家の使者', verb: '話す', reach: 2, key: false, solid: null },
        ]);
        const before = { x: hero.x, z: hero.z, heading: hero.heading };
        const orbitBefore = { ...orbit };
        const ev = EVENTS[0]!;
        world.stage(ev, 2, false);
        const p1 = world.stageProbe();
        expect(p1.active).toBe(true);
        expect(p1.people).toBe(2);
        expect(p1.hiddenCast).toEqual(['oda_envoy']);
        expect((shots[shots.length - 1] as { hideHero: boolean }).hideHero).toBe(true);
        // 同じ t をもう一度（飛ばし・見直し）：同じカメラ
        world.stage(ev, 7, false);
        world.stage(ev, 2, false);
        expect(shots[shots.length - 1]).toEqual(shots[0]);
        // 別の出来事へ（null を挟まない）：前の人を片付けて置き直す
        world.stage({ id: 'column_depart', count: 6, mark: '徳' }, 1, false);
        expect(world.stageProbe().people).toBe(0);
        expect(world.stageProbe().event).toBe('column_depart');
        // 片付け
        world.stage(null, 0, false);
        const p2 = world.stageProbe();
        expect(p2.active).toBe(false);
        expect(p2.hiddenCast).toEqual([]);
        expect(shots[shots.length - 1]).toBe(null);
        expect({ x: hero.x, z: hero.z, heading: hero.heading }).toEqual(before);
        expect(orbit).toEqual(orbitBefore);
        expect(poses[poses.length - 1]).toEqual(before);
        // 何度呼んでもよい（2 回目は何もしない）
        const n = shots.length;
        world.stage(null, 0, false);
        expect(shots.length).toBe(n);
        expect(poses.length).toBe(1);
        // 主人公は動かしていない（START とは別の位置のまま）
        expect(hero.x).not.toBe(START.x);
    });
});
