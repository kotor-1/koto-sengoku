/**
 * 主人公の脚と袴が、大きな 1 コマで壊れない（Version 28 の直し。本番の実時間の録画（約 0.2 コマ/秒）の町の急報で、振り向くコマに
 * 袴の太ももの板が腰の高さで横へ突き出て、刀が通り抜けていた）。
 * 原因：演出の出来事の間、主人公の位置・向きは演出の時計（1 コマ 1 秒まで）で決まるのに、足・体の向き（game/heroAnim.ts・legs.ts）は
 * 探索の時計（1 コマ 0.1 秒まで）で動いていた。体は 1 コマ 43° までしか回れず、着いた足は遠くに残り、脚の IK が脚の長さの 1.2〜1.35 倍
 * 離れた足へ脚をまっすぐ伸ばして、太ももが横へ 45° 開いた。
 * 直し：(1) 演出が主人公を動かす間は、足・体の向きも演出の時計で動かす（HeroClock・explore/world.ts の stage が渡す）。
 * (2) 1 コマで 0.5 m 以上動いた・体の向きが 45° 以上変わった・1 コマが 0.25 秒以上なら、足をその場の動きの元の形に合わせ直す。
 * (3) 股関節 → 足首の狙いの線の傾きに限り（LEG_LIMIT：ふだんの最大より少し上）。どのコマでも極端な脚の形にしない。
 * ゲームが読む GLB（hero_v3b_mpfb.glb）と、ゲームの仕組み（stageFrame・HeroAnimator・HeroLegs・stepHero）をそのまま動かして測る。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeroAnimator, HeroClock, RESNAP_DT } from '../proto3d/src/game/heroAnim';
import { LEG_LIMIT, limitLeg } from '../proto3d/src/game/legs';
import { createHero, stepHero, type HeroState } from '../proto3d/src/game/motion';
import { groundY } from '../proto3d/src/layout';
import { REPORT_LINE_Z, stageFrame, type StageOrigin } from '../proto3d/src/explore/stage';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { ieyasuCastFor } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import type { StageEvent } from '../proto3d/src/story/types';
import { loadGlb, rigOf, simulate, wallSlideStart } from './proto3d-hero-rig';

const SPEC = ieyasuCinematic(newIeyasuGame(), 'ch1_report')!;
const EV = (SPEC.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'street_report' }>;
const E = EV.cue.end;
const gltf = await loadGlb('hero_v3b_mpfb');
const DEG = 180 / Math.PI;

/**
 * 脚の形の限り（テストの判定）：太もも（股関節 → 膝）の傾き。体から見て横 33° まで・後ろ 57° まで・前 75° まで
 *（ふだんの 60 コマ/秒の最大：横 28°・後ろ 52°・前 68°。走りの振り出しの膝の持ち上げが前の 68°）。
 * 足首は股関節から脚の長さより遠くない。腰（Hips）は真っ直ぐから 25° 以上傾かない
 */
const SANE = { side: 33, back: 57, front: 75, hipsTilt: 25 };

interface LegShape {
    side: number;
    back: number;
    front: number;
    /** 描いた足首の、股関節からの距離 ÷ 脚の長さ */
    ankle: number;
    hipsTilt: number;
}

function legProbe(rig: ReturnType<typeof rigOf>) {
    const bones = new Map<string, THREE.Bone>();
    rig.root.traverse((o) => {
        if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o as THREE.Bone);
    });
    const up = [bones.get('LeftUpperLeg')!, bones.get('RightUpperLeg')!];
    const lo = [bones.get('LeftLowerLeg')!, bones.get('RightLowerLeg')!];
    const ft = [bones.get('LeftFoot')!, bones.get('RightFoot')!];
    const hips = bones.get('Hips')!;
    const legLen = lo[0]!.position.length() + ft[0]!.position.length();
    return {
        legLen,
        shape(): LegShape {
            rig.root.updateMatrixWorld(true);
            const yaw = rig.root.rotation.y;
            const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
            const out: LegShape = { side: 0, back: 0, front: 0, ankle: 0, hipsTilt: 0 };
            for (let i = 0; i < 2; i++) {
                const h = up[i]!.getWorldPosition(new THREE.Vector3());
                const k = lo[i]!.getWorldPosition(new THREE.Vector3());
                const a = ft[i]!.getWorldPosition(new THREE.Vector3());
                const d = k.sub(h).normalize();
                out.side = Math.max(out.side, Math.abs(Math.atan2(d.dot(right), -d.y)) * DEG);
                out.front = Math.max(out.front, Math.atan2(d.dot(fwd), -d.y) * DEG);
                out.back = Math.max(out.back, -Math.atan2(d.dot(fwd), -d.y) * DEG);
                out.ankle = Math.max(out.ankle, a.distanceTo(h) / legLen);
            }
            const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
            out.hipsTilt = Math.acos(Math.min(1, upv.y)) * DEG;
            return out;
        },
    };
}

const worst = (a: LegShape, b: LegShape): LegShape => ({
    side: Math.max(a.side, b.side),
    back: Math.max(a.back, b.back),
    front: Math.max(a.front, b.front),
    ankle: Math.max(a.ankle, b.ankle),
    hipsTilt: Math.max(a.hipsTilt, b.hipsTilt),
});
const ZERO: LegShape = { side: 0, back: 0, front: 0, ankle: 0, hipsTilt: 0 };
const sane = (w: LegShape, msg: string) => {
    expect(w.side, `${msg} 太ももの横`).toBeLessThanOrEqual(SANE.side);
    expect(w.back, `${msg} 太ももの後ろ`).toBeLessThanOrEqual(SANE.back);
    expect(w.front, `${msg} 太ももの前`).toBeLessThanOrEqual(SANE.front);
    expect(w.ankle, `${msg} 足首は脚の長さの内`).toBeLessThanOrEqual(1.001);
    expect(w.hipsTilt, `${msg} 腰の傾き`).toBeLessThanOrEqual(SANE.hipsTilt);
};

/**
 * 町の急報を、本番の遅いコマと同じに動かす：探索の 1 コマ（0.1 秒）で北へ歩く・走って線を越え、急報の間は演出の時計を cine 秒ずつ進める。
 * 主人公の位置・向きは演出（stageFrame の hero。explore/world.ts の placeStageHero と同じ）、操作は止まっている（入力なし）。
 * 見た目の動きの時計は main.ts と同じ HeroClock（stageClock=false のときは直す前と同じ：探索の 0.1 秒のまま）。返りは急報の間の最も悪い形
 */
function streetEvent(x: number, run: boolean, cine: number, stageClock = true): { worst: LegShape; resnaps: number; frames: number } {
    const rig = rigOf(gltf);
    const anim = new HeroAnimator(rig);
    const probe = legProbe(rig);
    const clock = new HeroClock();
    const hero = createHero(x, REPORT_LINE_Z + 3, Math.PI);
    anim.snap(hero);
    // 探索：北へ（本番の遅いコマ：1 コマ 0.1 秒）
    for (let i = 0; i < 60 && hero.z >= REPORT_LINE_Z; i++) {
        stepHero(hero, 0, -1, 0, 0.1, run);
        anim.update(hero, clock.take(0.1), groundY);
    }
    const o: StageOrigin = { x: hero.x, z: hero.z, heading: hero.heading, dirX: hero.dirX, dirZ: hero.dirZ, speed: hero.speed, yaw: 0 };
    const cast = ieyasuCastFor(newIeyasuGame()).map((c) => ({ id: c.id, kind: c.kind, x: c.x, z: c.z, heading: c.heading, ...(c.look ? { look: c.look } : {}) }));
    let w = ZERO;
    let frames = 0;
    const r0 = anim.resnaps;
    let prevT = 0;
    for (let k = 0; ; k++) {
        const t = Math.min(E, k * cine);
        const f = stageFrame(EV, t, false, cast, o);
        const h = f.hero!;
        Object.assign(hero, { x: h.x, z: h.z, heading: h.heading, dirX: Math.sin(h.heading), dirZ: Math.cos(h.heading), speed: 0 });
        if (stageClock) clock.stageAdvance(k === 0 ? 0 : t - prevT);
        prevT = t;
        stepHero(hero, 0, 0, 0, 0.1, false);
        anim.update(hero, clock.take(0.1), groundY);
        w = worst(w, probe.shape());
        frames++;
        if (t >= E) break;
    }
    return { worst: w, resnaps: anim.resnaps - r0, frames };
}

describe('主人公の見た目の動きの時計（HeroClock）', () => {
    it('ふだんは探索の 1 コマの時間。演出が主人公を動かす間は、前に取った時から演出が進めた分（取ったら 0）。null で探索の時計へ戻る', () => {
        const c = new HeroClock();
        expect(c.staged).toBe(false);
        expect(c.take(0.1)).toBe(0.1);
        c.stageAdvance(0);
        expect(c.staged).toBe(true);
        expect(c.take(0.1)).toBe(0);
        c.stageAdvance(0.6);
        c.stageAdvance(0.4);
        expect(c.take(0.1)).toBeCloseTo(1.0, 9);
        // 演出が止まっている（一時停止）コマは 0（主人公も止まる）
        expect(c.take(0.1)).toBe(0);
        c.stageAdvance(-3);
        c.stageAdvance(Number.NaN);
        expect(c.take(0.1)).toBe(0);
        c.stageAdvance(null);
        expect(c.staged).toBe(false);
        expect(c.take(0.05)).toBe(0.05);
    });

    it('探索の場面（explore/world.ts）：主人公を立たせる出来事の間は、演出の時計の進みを主人公の時計へ渡し、片付けで探索の時計へ戻す', async () => {
        const g = globalThis as Record<string, unknown>;
        g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body') };
        g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
        const { ExploreWorld } = await import('../proto3d/src/explore/world');
        const hero = createHero(0.3, REPORT_LINE_Z - 0.05, Math.PI);
        hero.speed = 1.55;
        const calls: (number | null)[] = [];
        const host = {
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(48, 2, 0.1, 2000),
            overlay: fakeElement() as unknown as HTMLElement,
            hero,
            low: true,
            load: () => Promise.reject(new Error('素材なし（テスト）')),
            prepare: () => undefined,
            setHeroPose: () => undefined,
            setControl: () => undefined,
            setRenderPaused: () => undefined,
            setExtraColliders: () => undefined,
            onFrame: () => undefined,
            viewSize: () => ({ w: 800, h: 400 }),
            orbit: { yaw: 0, pitch: 0.1, dist: 2.1 },
            setCameraShot: () => undefined,
            renderOnce: () => undefined,
            setLookHandler: () => undefined,
            heroStageClock: (a: number | null) => calls.push(a),
        };
        const world = new ExploreWorld(host as never);
        await world.preload();
        world.setCast(ieyasuCastFor(newIeyasuGame()).filter((c) => c.id !== 'oda_envoy' && c.id !== 'asai_envoy') as never);
        world.stage(EV, 0, false);
        world.stage(EV, 1, false);
        world.stage(EV, 1, false);
        world.stage(EV, 1.75, false);
        // 巻き戻し（前の場面）：進みは 0（位置の飛びは足の合わせ直しが受ける）
        world.stage(EV, 0.5, false);
        world.stage(null, 0, false);
        expect(calls).toEqual([0, 1, 0, 0.75, 0, null]);
    });
});

describe('大きな 1 コマ（演出の 1 秒のコマ・遅い端末）でも、主人公の脚と腰は極端な形にならない', () => {
    it('町の急報（演出の時計 0.25〜1 秒/コマ、歩き・走りで線を越える、通りの左右）：どのコマでも太ももの横・後ろ・前の傾き、足首の距離、腰の傾きは限りの内', () => {
        for (const cine of [0.25, 0.5, 1.0])
            for (const run of [false, true])
                for (const x of [-2.0, 0.3, 2.4]) {
                    const r = streetEvent(x, run, cine);
                    sane(r.worst, `演出 ${cine} 秒/コマ ${run ? '走り' : '歩き'} x=${x}`);
                    // 0.25 秒以上のコマは、足をその場の動きの元の形に合わせ直す（町の人・演出の人と同じ。始めの 0 秒のコマと、場面の終わりで
                    // 切り詰めた最後の短いコマは数えない）
                    expect(r.resnaps, `演出 ${cine} 秒/コマ`).toBeGreaterThanOrEqual(r.frames - 2);
                }
    }, 60_000);

    it('演出の時計を渡さない（直す前のつながり：位置・向きは 1 秒/コマ、足は 0.1 秒）ときも、脚の向きの限りと合わせ直しで極端な形にならない', () => {
        for (const run of [false, true])
            for (const x of [-2.0, 0.3, 2.4]) {
                const r = streetEvent(x, run, 1.0, false);
                sane(r.worst, `時計なし ${run ? '走り' : '歩き'} x=${x}`);
            }
    }, 60_000);

    it('探索の 1 コマ（0.1 秒）で、置き直しに近い大きな動き（横へ 0.45〜0.95 m・向き 30〜180°）を受けても、極端な形にならない', () => {
        const rig = rigOf(gltf);
        const anim = new HeroAnimator(rig);
        const probe = legProbe(rig);
        const hero: HeroState = createHero(0.3, 2, Math.PI);
        anim.snap(hero);
        let w = ZERO;
        const step = (n: number, ix: number, iy: number, run: boolean) => {
            for (let i = 0; i < n; i++) {
                stepHero(hero, ix, iy, 0, 0.1, run);
                anim.update(hero, 0.1, groundY);
                w = worst(w, probe.shape());
            }
        };
        for (const [dx, turn] of [
            [0.45, 30],
            [0.6, 60],
            [0.95, 100],
            [0.5, 180],
            [-0.8, -120],
        ] as const) {
            step(6, 0, -1, true);
            const h = hero.heading + (turn * Math.PI) / 180;
            Object.assign(hero, { x: hero.x + dx, heading: Math.atan2(Math.sin(h), Math.cos(h)) });
            hero.dirX = Math.sin(hero.heading);
            hero.dirZ = Math.cos(hero.heading);
            anim.update(hero, 0.1, groundY);
            w = worst(w, probe.shape());
            step(4, 0, 0, false);
            Object.assign(hero, { x: 0.3, z: 2, heading: Math.PI, dirX: 0, dirZ: -1, speed: 0 });
            anim.snap(hero);
        }
        sane(w, '大きな動き');
    });

    it('脚の向きの限り（limitLeg）：限りの内の狙いは変えない。外の狙いは、股関節から見て限りの角度の所へ水平に寄せる（高さは変えない）', () => {
        const hip = new THREE.Vector3(0, 0.9, 0);
        const inside = new THREE.Vector3(0.2, 0.1, 0.3);
        expect(limitLeg(hip, inside.clone(), 0, 1)).toEqual([0, 0]);
        // 体は +z を向く。横（右 = −x）へ 0.9 m の狙い → 横 32° の所へ
        const t = new THREE.Vector3(-0.9, 0.1, 0);
        const [dx, dz] = limitLeg(hip, t, 0, 1);
        expect(dx).toBeGreaterThan(0.3);
        expect(dz).toBeCloseTo(0, 9);
        expect(t.y).toBe(0.1);
        expect(Math.atan2(Math.abs(t.x), hip.y - t.y)).toBeCloseTo(LEG_LIMIT.side, 6);
        // 後ろへ 1.5 m → 後ろ 56°、前へ 1.5 m → 前 50°
        const b = new THREE.Vector3(0, 0.1, -1.5);
        limitLeg(hip, b, 0, 1);
        expect(Math.atan2(-b.z, 0.8)).toBeCloseTo(LEG_LIMIT.back, 6);
        const f = new THREE.Vector3(0, 0.1, 1.5);
        limitLeg(hip, f, 0, 1);
        expect(Math.atan2(f.z, 0.8)).toBeCloseTo(LEG_LIMIT.front, 6);
    });

    it('ふだんの動き（60 コマ/秒：歩き・走り・90°／180° の切り返し・その場の向き替え・壁に沿う）では、脚の向きの限りも合わせ直しも働かない（形は前と同じ）', () => {
        const rig = rigOf(gltf);
        const sim = simulate(rig);
        const legs = sim.anim.legs!;
        const r0 = sim.anim.resnaps;
        sim.place(0.5, 8, Math.PI);
        sim.hold('idle', 0.6, 0, 0);
        sim.hold('walk', 1.5, 0, -1);
        sim.hold('stop', 1.2, 0, 0);
        sim.place(0.5, 9, Math.PI);
        sim.hold('run', 1.4, 0, -1, true);
        sim.hold('turn', 1.2, 0, 1, true);
        sim.hold('stop', 1.2, 0, 0);
        sim.place(-0.5, 8, Math.PI);
        sim.hold('pre', 1.5, 0, -1);
        sim.hold('turn90', 1.0, 1, 0);
        sim.hold('stop', 1.2, 0, 0);
        const w = wallSlideStart();
        sim.place(w.x, w.z, -Math.PI / 2);
        sim.hold('slide', 2.0, -Math.SQRT1_2, -Math.SQRT1_2);
        sim.hold('stop', 1.0, 0, 0);
        sim.place(0.5, 6, Math.PI);
        sim.hold('idle', 0.5, 0, 0);
        const h = sim.hero;
        h.heading = Math.atan2(Math.sin(h.heading + 2.1), Math.cos(h.heading + 2.1));
        h.dirX = Math.sin(h.heading);
        h.dirZ = Math.cos(h.heading);
        sim.hold('faceturn', 1.5, 0, 0);
        expect(legs.stats.limited).toBe(0);
        expect(sim.anim.resnaps - r0).toBe(0);
        expect(RESNAP_DT).toBeGreaterThan(1 / 60);
    });
});

/** DOM の代わり（ExploreWorld が使う所だけ） */
function fakeElement(tag = 'div'): Record<string, unknown> {
    const children: unknown[] = [];
    const classes = new Set<string>();
    return {
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
}
