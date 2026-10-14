/**
 * 主人公の見た目の動き（Version 28 §4.1）：動きの元（Idle / Walk / Run）の混ぜ方・位相・体の向き・足（game/legs.ts）・顔の向き（game/gaze.ts）。
 * 移動そのもの（game/motion.ts）は変えない。描画に依存しない（three の骨と AnimationMixer だけ。テストで GLB をそのまま動かせる）。
 * - 位相は「実際に進んだ距離 ÷ 1 周期の距離」で進める（壁に沿って滑る・ぶつかって進めない間も、脚の運びが実際の進みと合う）。
 * - 待機・歩き・走りの混ぜ方も、実際に進んだ速さから決める（壁へ押し付けている間は待機の脚）。
 * - 止まっていた所から歩き出すときは、左足から踏み出す位相（0.7：右足が体の下・左足が離れた所）から始める。
 * - 体の向き（描く向き）は、移動の向き（hero.heading）を 1 コマ 11.5° まで（止まっているときは 7°）で追う。
 *   移動の側も同じ上限で回すので、ふだんは同じ値。会話・演出が向きを一度に変えたときだけ、ここで回して見せる（足は legs.ts が踏み替える）。
 * - 1 コマで 1 m 以上動いた（置き直し・場面の切り替え）ときは、向き・足をその場に合わせ直す（歩いて見せない）。
 */
import * as THREE from 'three';
import { GAIT, runBlendFor, strideFor } from './gait';
import { Gaze } from './gaze';
import { HeroLegs, findBones, legBones } from './legs';
import { SPEED, type HeroState } from './motion';

export interface HeroRig {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    idle: THREE.AnimationAction;
    walk: THREE.AnimationAction;
    run: THREE.AnimationAction;
}

/** 体の向きを追う速さの上限（ラジアン/秒）：動いているとき・止まっているとき */
const YAW_RATE_MOVING = 12;
const YAW_RATE_IDLE = 7.5;
/** 歩き出しの位相：体を支える足（先に振り出さない方）が、片足で立つ間のこの位相（脚が体の真下より少し前）になるように始める */
const START_STANCE = 0.24;
/** これより長く 1 コマで動いたら置き直しとみなす（m） */
const TELEPORT = 1;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smoothstep = (x: number, a: number, b: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

export class HeroAnimator {
    /** 動いている重み（0 待機 → 1 歩き・走り） */
    walkBlend = 0;
    runBlend = 0;
    /** 歩き・走りの位相（0〜1）。進んだ距離から決める */
    stride = 0;
    /** これまでに進めた周期の合計（足音） */
    strideTotal = 0;
    /** 描く体の向き */
    yaw = 0;
    /** 実際に進んだ速さ（m/秒） */
    speed = 0;
    readonly legs: HeroLegs | null;
    readonly gaze: Gaze | null;
    private last: { x: number; z: number } | null = null;

    constructor(readonly rig: HeroRig) {
        const bones = findBones(rig.root);
        const lb = legBones(bones);
        this.legs = lb ? new HeroLegs(rig.root, lb) : null;
        this.gaze = Gaze.from(bones);
    }

    /** 置き直した（場面の切り替え・確認用の移動）：向き・足を今の位置に合わせ、次のコマで歩いて見せない */
    snap(hero: HeroState): void {
        this.yaw = hero.heading;
        this.last = { x: hero.x, z: hero.z };
        this.speed = 0;
        this.legs?.reset();
        this.gaze?.snap();
    }

    /** 歩き出しの位相：進む向きで前にある足を支える足にする（左が支える = 位相 START_STANCE、右が支える = +0.5） */
    private startPhase(hero: HeroState): number {
        const lb = this.legs?.footInfo(0);
        const rb = this.legs?.footInfo(1);
        if (!lb || !rb) return START_STANCE + 0.5;
        const dx = hero.dirX;
        const dz = hero.dirZ;
        const fwd = (p: THREE.Vector3) => (p.x - hero.x) * dx + (p.z - hero.z) * dz;
        return fwd(lb.target) >= fwd(rb.target) ? START_STANCE : START_STANCE + 0.5;
    }

    /** 1 コマ進める（移動 stepHero の後）。ground は地面の高さ */
    update(hero: HeroState, dt: number, ground: (x: number, z: number) => number): void {
        const { rig } = this;
        let dist = 0;
        if (!this.last) this.snap(hero);
        else {
            dist = Math.hypot(hero.x - this.last.x, hero.z - this.last.z);
            if (dist > TELEPORT) {
                this.snap(hero);
                dist = 0;
            }
        }
        this.last = { x: hero.x, z: hero.z };
        const v = dt > 0 ? dist / dt : 0;
        this.speed = v;
        // 体の向き
        const cap = (v > 0.05 ? YAW_RATE_MOVING : YAW_RATE_IDLE) * dt;
        const dy = wrap(hero.heading - this.yaw);
        this.yaw = wrap(this.yaw + Math.max(-cap, Math.min(cap, dy)));
        // 止まっていた所から動き出すとき：進む向きに対して後ろにある足から踏み出し、前の足で体を支える位相から始める
        //（足音の数え合わせも同じだけ進める）
        if (this.walkBlend < 0.05 && v > 0.05) {
            const start = this.startPhase(hero);
            const jump = (((start - this.stride) % 1) + 1) % 1;
            this.stride = start;
            this.strideTotal += jump;
        }
        // 待機と動きを実際の速さで混ぜ、動きの中では歩きと走りを速さで混ぜる
        const want = smoothstep(v, 0.05, 0.5);
        this.walkBlend += (want - this.walkBlend) * (1 - Math.exp(-10 * dt));
        const runWant = runBlendFor(v, SPEED.walk, SPEED.run);
        this.runBlend += (runWant - this.runBlend) * (1 - Math.exp(-12 * dt));
        // 位相は実際に進んだ距離で進める（1 周期の距離は歩きと走りを混ぜた長さ）
        const cycle = strideFor(this.runBlend);
        const dPhase = dist / cycle;
        this.strideTotal += dPhase;
        this.stride = (this.stride + dPhase) % 1;
        rig.walk.time = this.stride * rig.walk.getClip().duration;
        rig.run.time = this.stride * rig.run.getClip().duration;
        rig.walk.setEffectiveWeight(this.walkBlend * (1 - this.runBlend));
        rig.run.setEffectiveWeight(this.walkBlend * this.runBlend);
        rig.idle.setEffectiveWeight(1 - this.walkBlend);
        rig.mixer.update(dt);
        rig.root.position.set(hero.x, ground(hero.x, hero.z), hero.z);
        rig.root.rotation.y = this.yaw;
        // 足（着いた足を地面に止める・IK・腰を下げる・踏み替え）
        this.legs?.update({ dt, move: this.walkBlend, ground });
        this.gaze?.update(dt);
    }
}

/** 確認用：歩き・走りの決まり（GLB の動きと同じ値） */
export const HERO_GAIT = GAIT;
