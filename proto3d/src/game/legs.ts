/**
 * 主人公の足（Version 28 §4.1）。動きの元（Idle / Walk / Run を混ぜた形）の上に、次を足す。描画に依存しない（three の骨だけ。テストで GLB をそのまま動かせる）。
 * - 着いた足を地面に止める：動きの元が「足が着いている」とする間（足の裏のいちばん低い点が地面すれすれ）、足は動きの元が地面に対してする動き
 *  （踵 → 足裏 → 足先の転がり）だけをし、体が向きを変えても・壁に沿って滑っても・止まっても、地面の上を滑らない。
 * - 振り出した足は、動きの元の位置へなめらかに追いつく（止めていた所から次に着く所へ）。
 * - 脚の 2 本の骨の IK：足首を地面の高さ（ground_height.json）に合わせ、膝は動きの元の向きへ曲げる。届かないときは腰を下げる（急に下げ、ゆっくり戻す）。
 * - 足の踏み替え：止まっている間（待機）に、足が立つ位置から離れた・体の向きに対してねじれたときは、片足ずつ短く踏み替える
 *  （止まった後の 1 歩、その場で向きを変えるときの小さな足踏み）。ねじれ・伸びすぎが大きいときは、歩きの途中でも踏み替える。
 * - 脚の向きの限り（LEG_LIMIT）：股関節から足首の狙いへの線が、体から見て横・後ろ・前へ極端に傾く狙い（大きな 1 コマで着いた足を遠くに
 *   残した）は、限りの所へ寄せる（着いた足はそこに止め直す）。ふだんの歩き・走り・切り返しの形は限りの内なので変わらない。
 * 角度はラジアン、長さは m。足の骨の休みの姿勢は世界の軸にそろう（第 2 版の骨組み）。
 * 町の人・演出の人（explore/actors.ts。同じ骨組みを人ごとの大きさ Look.scale で縮めて置く）にも使う：scale にその大きさを渡す
 *（脚の長さ・足の裏の点・腰を下げる量をその大きさに合わせる。主人公は 1）。
 */
import * as THREE from 'three';

/** 足の裏の点（足の骨＝足首から見た位置。assets-src/hero_v2/hero_motion.py の HEEL・BALL・TIP と同じ） */
export const SOLE = {
    heel: new THREE.Vector3(0, -0.097, -0.07),
    ball: new THREE.Vector3(0, -0.097, 0.105),
    tip: new THREE.Vector3(0, -0.094, 0.16),
} as const;
const SOLE_PTS = [SOLE.heel, SOLE.ball, SOLE.tip];

/** 足が着く・離れるとみなす足の裏のいちばん低い点の高さ（動きの元の形で。根の高さから。着く方を低くして行き来しない） */
const ENTER = 0.004;
const EXIT = 0.007;
/** 着いた足は、動きの元が大きく持ち上げない限り、これより短い間では離さない（混ぜた形で足が地面すれすれを行き来するときに、着く・離れるを繰り返さない） */
const MIN_PLANT = 0.1;
/** 振り出した足が、地面から持ち上がってから横へ動き出す高さ（この間でなめらかに 0 → 1。すれすれで横へ滑らない） */
const LIFT_GATE = [0.012, 0.035] as const;
/** 振り出した足が動きの元へ追いつく速さ（時定数・秒） */
const CATCH_UP = 0.05;
/** 着く・離れる瞬間の高さの段差を消す時定数（秒） */
const SETTLE = 0.06;
/** 待機中の踏み替え：立つ位置からの離れ（m）・ねじれ（ラジアン） */
const STEP_DIST = 0.1;
const STEP_TWIST = 0.45;
/** 歩きの途中でも踏み替える：ねじれ（約 70°）・腰の関節から足首までの水平の距離（脚の長さの割合） */
const FORCE_TWIST = 1.2;
const FORCE_REACH = 0.72;
/** 振り出した足が下りてきた（足の裏がこの高さより下）のに、動きの元の位置から LAND_ERR より離れていたら、その場に下ろさず踏み替えで運ぶ（m） */
const LAND_LOW = 0.022;
const LAND_ERR = 0.07;
/** 歩き・走りの途中で、伸びすぎ・ねじれすぎの足を早く離して持ち上げる時間（秒） */
const EARLY_LIFT = 0.16;
/** 踏み替えの足の持ち上げ（m） */
const STEP_LIFT = 0.05;
/** 腰を下げる上限（m） */
const MAX_DROP = 0.05;
/** 腰を下げる・戻す速さの上限（m/秒） */
const DROP_RATE = 0.25;
/** 着いた足に届かせるのに腰をこれより下げる必要があれば、腰を下げ続けずにその足を踏み替える（m） */
const OVERREACH = 0.025;
/**
 * 脚の向きの限り（ラジアン）：股関節 → 足首の狙いの線の、体の向きから見た横・後ろ・前への傾き（真下から）。ふだんの形（ゲームの仕組みで
 * 60 コマ/秒：歩き・走り・90°／180° の切り返し・壁に沿う・その場の向き替え）の最大は横 28°・後ろ 53°・前 40°（走りながらの 180° の切り返し）。
 * これを超える狙いは、この限りの所へ寄せる（太ももが横へ 45° 開いて袴の板が腰の高さに突き出た：町の急報の振り向き、演出の 1 秒のコマ）
 */
export const LEG_LIMIT = { side: (32 * Math.PI) / 180, back: (56 * Math.PI) / 180, front: (50 * Math.PI) / 180 } as const;

export interface LegBones {
    hips: THREE.Bone;
    upper: [THREE.Bone, THREE.Bone];
    lower: [THREE.Bone, THREE.Bone];
    foot: [THREE.Bone, THREE.Bone];
}

/** 人物の根の下から骨を探す（形の節にも同じ名前（Head など）があるので、骨だけを見る） */
export function findBones(root: THREE.Object3D): Map<string, THREE.Bone> {
    const m = new Map<string, THREE.Bone>();
    root.traverse((o) => {
        if ((o as THREE.Bone).isBone && !m.has(o.name)) m.set(o.name, o as THREE.Bone);
    });
    return m;
}

export function legBones(bones: Map<string, THREE.Bone>): LegBones | null {
    const g = (n: string) => bones.get(n);
    const need = ['Hips', 'LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot'];
    if (need.some((n) => !g(n))) return null;
    return {
        hips: g('Hips')!,
        upper: [g('LeftUpperLeg')!, g('RightUpperLeg')!],
        lower: [g('LeftLowerLeg')!, g('RightLowerLeg')!],
        foot: [g('LeftFoot')!, g('RightFoot')!],
    };
}

/** 1 コマの入力 */
export interface LegFrame {
    dt: number;
    /** 歩き・走りの動きの重み（0 待機〜1） */
    move: number;
    /** 地面の高さ */
    ground: (x: number, z: number) => number;
}

interface Step {
    t: number;
    dur: number;
    from: THREE.Vector3;
    fromYaw: number;
    /** 踏み出した時の足の世界の向き */
    fromRot: THREE.Quaternion;
    /** 下ろす所（半ばを過ぎたら決めて動かさない。下ろしながら横へ滑らない） */
    dest: THREE.Vector3 | null;
    destYaw: number;
}

interface Foot {
    /** 地面に着いているか（着いている間は踵の点を地面に止める） */
    planted: boolean;
    /** 着いている間：地面に止めた点（足の裏の点のうち低いもの。pivot）の位置（x・z） */
    heel: THREE.Vector3;
    /** 止めた点（SOLE_PTS の番号：0 踵・1 母指球・2 足先） */
    pivot: number;
    /** 前のコマの足の世界の向き */
    rot: THREE.Quaternion;
    /** 足先の向き（世界の y 軸まわり。着いている間は止める） */
    yaw: number;
    /** 振り出している間の足首の水平の位置 */
    pos: THREE.Vector3;
    /** 着く・離れる瞬間の高さの段差（だんだん 0 へ） */
    dy: number;
    /** 振り出してからの時間（秒） */
    swingT: number;
    /** 歩き・走りの途中で早く離した足の、持ち上げの残り時間（秒） */
    early: number;
    /** 離れたばかりで、まだ持ち上がりきっていない（地面の点を止めたまま回す） */
    lifting: boolean;
    /** 着いてからの時間（秒） */
    plantT: number;
    /** 前のコマの動きの元の足首（世界） */
    lastWorld: THREE.Vector3;
    step: Step | null;
    /** このコマの足首の狙い（世界） */
    target: THREE.Vector3;
}

interface Anim {
    world: THREE.Vector3;
    quat: THREE.Quaternion;
    yaw: number;
    /** 足の裏のいちばん低い点の高さ（根から） */
    low: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smoother = (q: number) => {
    const t = Math.max(0, Math.min(1, q));
    return t * t * t * (t * (t * 6 - 15) + 10);
};
const smoothstep = (x: number, a: number, b: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * 足首の狙い t（世界。書き換える）を、股関節 hip から見た傾きの限り（LEG_LIMIT）の内へ水平に寄せる。fx・fz は体の前の向き。
 * 返りは寄せた量（x・z。限りの内なら 0, 0）
 */
export function limitLeg(hip: THREE.Vector3, t: THREE.Vector3, fx: number, fz: number): [number, number] {
    const ex = t.x - hip.x;
    const ez = t.z - hip.z;
    const down = Math.max(0.05, hip.y - t.y);
    // 前（fx, fz）と右（fz, −fx）に分ける
    const f = ex * fx + ez * fz;
    const s = ex * fz - ez * fx;
    const sMax = down * Math.tan(LEG_LIMIT.side);
    const f1 = Math.max(-down * Math.tan(LEG_LIMIT.back), Math.min(down * Math.tan(LEG_LIMIT.front), f));
    const s1 = Math.max(-sMax, Math.min(sMax, s));
    if (f1 === f && s1 === s) return [0, 0];
    const nx = hip.x + f1 * fx + s1 * fz;
    const nz = hip.z + f1 * fz - s1 * fx;
    const dx = nx - t.x;
    const dz = nz - t.z;
    t.x = nx;
    t.z = nz;
    return [dx, dz];
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpV3b = new THREE.Vector3();

/** 世界の向き q の前（+z）の水平の向き */
function yawOf(q: THREE.Quaternion): number {
    const f = tmpV3.set(0, 0, 1).applyQuaternion(q);
    return Math.atan2(f.x, f.z);
}

export class HeroLegs {
    private readonly feet: [Foot, Foot];
    private drop = 0;
    private ready = false;
    /** 脚の長さ（腰の関節 → 膝 → 足首。休みの姿勢から） */
    private readonly l1: number;
    private readonly l2: number;
    /** 確かめ用の数 */
    readonly stats = { steps: 0, forced: 0, early: 0, drop: 0, limited: 0 };

    /** 足の裏の点（この人の大きさに合わせた世界の長さ） */
    private readonly sole: THREE.Vector3[];

    constructor(
        private readonly root: THREE.Object3D,
        private readonly b: LegBones,
        private readonly scale = 1,
    ) {
        const mk = (): Foot => ({ planted: true, heel: new THREE.Vector3(), pivot: 0, rot: new THREE.Quaternion(), yaw: 0, pos: new THREE.Vector3(), dy: 0, swingT: 0, early: 0, lifting: false, plantT: 1, lastWorld: new THREE.Vector3(), step: null, target: new THREE.Vector3() });
        this.feet = [mk(), mk()];
        this.l1 = b.lower[0].position.length() * scale;
        this.l2 = b.foot[0].position.length() * scale;
        this.sole = SOLE_PTS.map((p) => p.clone().multiplyScalar(scale));
    }

    /** 足の固定を外す（置き直し・場面の切り替えの後。次のコマで動きの元の位置から始める） */
    reset(): void {
        this.ready = false;
        this.drop = 0;
        for (const f of this.feet) f.step = null;
    }

    /** 確かめ用：足の状態 */
    footInfo(i: 0 | 1): { planted: boolean; stepping: boolean; target: THREE.Vector3; yaw: number } {
        const f = this.feet[i];
        return { planted: f.planted, stepping: !!f.step, target: f.target.clone(), yaw: f.yaw };
    }

    /** 足の世界の向き：動きの元の向き（踵・つま先の上がり）を、足先の向き yaw へ y 軸で回したもの */
    private footRot(a: Anim, yaw: number): THREE.Quaternion {
        return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, wrap(yaw - a.yaw)).multiply(a.quat);
    }

    /** 足の向き rot で、足の裏の点のうちいちばん低い点の番号と、足首から見た位置 */
    private lowest(rot: THREE.Quaternion): [number, THREE.Vector3] {
        let best = 0;
        let off = tmpV.copy(this.sole[0]!).applyQuaternion(rot);
        for (let k = 1; k < this.sole.length; k++) {
            const o = tmpV2.copy(this.sole[k]!).applyQuaternion(rot);
            if (o.y < off.y) {
                best = k;
                off = tmpV.copy(o);
            }
        }
        return [best, off];
    }

    /**
     * 着いている足の足首：足の裏の点のうち低いもの（踵・母指球・足先。回りの中心）を、止めた地面の点に置く（足の転がり。地面の点は動かない）。
     * 回りの中心が移るときは、前の中心を止めたまま新しい中心の位置を求めて止め直す（その瞬間は 2 点とも地面にあるので、段差は出ない）
     */
    private planted(f: Foot, rot: THREE.Quaternion, ground: (x: number, z: number) => number, out: THREE.Vector3): void {
        const [k, off] = this.lowest(rot);
        if (k !== f.pivot) {
            // 前の中心を今の向きで止めたまま、新しい中心の位置を求める（新しい点は今ちょうど地面に着いた所）
            const old = tmpV2.copy(this.sole[f.pivot]!).applyQuaternion(rot);
            f.heel.x += off.x - old.x;
            f.heel.z += off.z - old.z;
            f.pivot = k;
        }
        out.set(f.heel.x - off.x, ground(f.heel.x, f.heel.z) - off.y, f.heel.z - off.z);
    }

    /** 足首から見た、足の裏のいちばん低い点の高さ（足の向き rot で） */
    private lowOffset(rot: THREE.Quaternion): number {
        let m = Infinity;
        for (const p of this.sole) m = Math.min(m, tmpV.copy(p).applyQuaternion(rot).y);
        return m;
    }

    /** 今の足首と足の向きから、地面に止める点（足の裏の点のうち低いもの）の位置を決める（足を地面に止める瞬間） */
    private anchor(f: Foot, ankle: THREE.Vector3, rot: THREE.Quaternion): void {
        const [k, off] = this.lowest(rot);
        f.pivot = k;
        f.heel.set(ankle.x + off.x, 0, ankle.z + off.z);
    }

    /** 動きの元で骨を置いた後（mixer.update の後）に呼ぶ。脚の骨と腰の位置を書き換える */
    update(fr: LegFrame): void {
        const { root, b } = this;
        root.updateMatrixWorld(true);
        const rootY = root.position.y;
        const anim: Anim[] = [];
        for (let i = 0; i < 2; i++) {
            const fb = b.foot[i]!;
            const world = new THREE.Vector3().setFromMatrixPosition(fb.matrixWorld);
            const quat = fb.getWorldQuaternion(new THREE.Quaternion());
            let low = Infinity;
            for (const p of SOLE_PTS) low = Math.min(low, tmpV.copy(p).applyMatrix4(fb.matrixWorld).y - rootY);
            anim.push({ world, quat, yaw: yawOf(quat), low });
        }
        const dt = Math.max(0, fr.dt);
        const k = 1 - Math.exp(-dt / CATCH_UP);
        const settle = Math.exp(-dt / SETTLE);
        if (!this.ready) {
            for (let i = 0; i < 2; i++) {
                const f = this.feet[i]!;
                const a = anim[i]!;
                f.yaw = a.yaw;
                f.pos.copy(a.world);
                f.lastWorld.copy(a.world);
                f.step = null;
                f.dy = 0;
                f.swingT = 0;
                f.early = 0;
                f.lifting = false;
                f.planted = a.low < EXIT;
                f.rot.copy(a.quat);
                if (f.planted) this.anchor(f, a.world, a.quat);
                f.target.copy(a.world).setY(fr.ground(a.world.x, a.world.z) + (a.world.y - rootY));
            }
            this.ready = true;
        }
        const hipW = [0, 1].map((i) => new THREE.Vector3().setFromMatrixPosition(b.upper[i]!.matrixWorld));
        const legLen = this.l1 + this.l2;
        // 踏み替え：伸びすぎ・ねじれすぎ（いつでも）、立つ位置からの離れ（待機の間）。一度に片足ずつ（もう片方が半分を過ぎたら次）
        const busy = (j: number) => {
            const st = this.feet[j]!.step;
            return !!st && st.t < st.dur * 0.55;
        };
        let pick = -1;
        let worst = 0;
        for (let i = 0; i < 2; i++) {
            const f = this.feet[i]!;
            const a = anim[i]!;
            if (f.step || !f.planted || a.low > ENTER || busy(1 - i)) continue;
            const cur = f.target;
            const err = Math.hypot(a.world.x - cur.x, a.world.z - cur.z);
            const twist = Math.abs(wrap(a.yaw - f.yaw));
            const reach = Math.hypot(hipW[i]!.x - cur.x, hipW[i]!.z - cur.z) / legLen;
            const h = hipW[i]!;
            const h2 = (h.x - cur.x) ** 2 + (h.z - cur.z) ** 2;
            const r = legLen * 0.999;
            const over = h.y - cur.y - (h2 < r * r ? Math.sqrt(r * r - h2) : 0);
            // 歩き・走りの間は、腰を下げきっても届かないときだけ（蹴り出しの直前は脚が伸びきるので、少しの不足は腰を下げて補う）
            const forced = twist > FORCE_TWIST || reach > FORCE_REACH || over > (fr.move < 0.5 ? OVERREACH : MAX_DROP);
            const idle = fr.move < 0.5 && (err > STEP_DIST || twist > STEP_TWIST);
            if (!forced && !idle) continue;
            const score = err + twist * 0.3 + (forced ? 10 : 0);
            if (score > worst) {
                worst = score;
                pick = i;
            }
        }
        if (pick >= 0) {
            const f = this.feet[pick]!;
            const a = anim[pick]!;
            const err = Math.hypot(a.world.x - f.target.x, a.world.z - f.target.z);
            f.planted = false;
            f.pos.copy(f.target);
            f.swingT = 0;
            if (worst >= 10) this.stats.forced++;
            if (fr.move < 0.5) {
                // 待機：短い踏み替え（持ち上げて、動きの元の立つ位置へ）
                f.step = { t: 0, dur: Math.max(0.2, Math.min(0.34, 0.2 + 0.35 * err)), from: f.target.clone(), fromYaw: f.yaw, fromRot: f.rot.clone(), dest: null, destYaw: 0 };
                this.stats.steps++;
            } else {
                // 歩き・走りの途中：少し早く離して振り出しにする（持ち上げながら動きの元の振り出しへ追いつく）
                f.early = EARLY_LIFT;
                this.stats.early++;
            }
        }
        const targets: THREE.Vector3[] = [];
        const rots: THREE.Quaternion[] = [];
        for (let i = 0; i < 2; i++) {
            const f = this.feet[i]!;
            const a = anim[i]!;
            const prevY = f.target.y;
            let y: number;
            let rot: THREE.Quaternion;
            if (f.step) {
                // 踏み替え：止めていた所から動きの元の立つ位置へ、少し持ち上げて
                const st = f.step;
                const first = st.t === 0;
                st.t += dt;
                const sP = Math.min(1, st.t / st.dur);
                // 横へ・向きは、少し持ち上げてから動かす（地面すれすれで横へ滑らない・地面の上で回らない）
                const u = smoother((sP - 0.12) / 0.76);
                if (!st.dest && st.t >= st.dur * 0.6) {
                    st.dest = a.world.clone();
                    st.destYaw = a.yaw;
                }
                f.pos.lerpVectors(st.from, st.dest ?? a.world, u);
                f.yaw = st.fromYaw + wrap((st.dest ? st.destYaw : a.yaw) - st.fromYaw) * u;
                // 足の向き：踏み出した時の向きから、下ろす所で平らに（動きの元の振り出しの足の向きは使わない）
                rot = st.fromRot.clone().slerp(tmpQ.setFromAxisAngle(Y_AXIS, f.yaw), u);
                // 高さ：足の裏のいちばん低い点を、地面から持ち上げの高さに
                y = fr.ground(f.pos.x, f.pos.z) - this.lowOffset(rot) + STEP_LIFT * Math.sin(Math.PI * sP);
                if (first) f.dy += prevY - y;
                f.target.set(f.pos.x, y, f.pos.z);
                if (f.step.t >= f.step.dur) {
                    f.step = null;
                    f.planted = true;
                    f.plantT = 0;
                    this.anchor(f, f.target, rot);
                }
            } else if (f.planted && (a.low > EXIT * 3 || (a.low > EXIT && f.plantT > MIN_PLANT))) {
                // 離れる：今の所から振り出しへ（高さの段差は消していく）
                f.planted = false;
                f.swingT = 0;
                f.lifting = true;
                // このコマはまだ地面の点を止めたまま回す（次のコマから持ち上がるにつれて振り出しへ）
                rot = this.footRot(a, f.yaw);
                this.planted(f, rot, fr.ground, f.target);
                f.pos.copy(f.target);
            } else if (f.planted) {
                f.plantT += dt;
                rot = this.footRot(a, f.yaw);
                this.planted(f, rot, fr.ground, f.target);
            } else if (f.swingT > 0.08 && a.low < LAND_LOW && Math.hypot(a.world.x - f.pos.x, a.world.z - f.pos.z) > LAND_ERR) {
                // 動きの元は足を下ろしたいが、まだ遠い（止まる・向きを変える途中で追いつけなかった）：その場に下ろさず、踏み替えで運ぶ
                const err = Math.hypot(a.world.x - f.pos.x, a.world.z - f.pos.z);
                f.step = { t: 0, dur: Math.max(0.16, Math.min(0.3, 0.14 + 0.35 * err)), from: f.target.clone(), fromYaw: f.yaw, fromRot: f.rot.clone(), dest: null, destYaw: 0 };
                this.stats.steps++;
                rot = this.footRot(a, f.yaw);
            } else {
                // 振り出し：持ち上がってから、動きの元の動き（体と一緒の前進を含む）に乗り、動きの元の位置・向きへ追いつく。
                // 早く離した足（early）は、すぐ持ち上げて追いつかせる
                const first = f.early === EARLY_LIFT;
                f.swingT += dt;
                // 早く離した足：持ち上げ（u = 0 → 1）につれて横へ動き出す（地面すれすれで横へ滑らない）
                const u = f.early > 0 ? 1 - f.early / EARLY_LIFT : 1;
                const early = f.early > 0 ? Math.sin(Math.PI * u) : 0;
                f.early = Math.max(0, f.early - dt);
                const g = Math.max(f.early > 0 || early > 0 ? smoothstep(u, 0.15, 0.55) : 0, smoothstep(a.low, LIFT_GATE[0], LIFT_GATE[1]));
                f.pos.x += g * (a.world.x - f.lastWorld.x + (a.world.x - f.pos.x) * k);
                f.pos.z += g * (a.world.z - f.lastWorld.z + (a.world.z - f.pos.z) * k);
                f.yaw += g * k * wrap(a.yaw - f.yaw);
                rot = this.footRot(a, f.yaw);
                if (g >= 1) f.lifting = false;
                const gy = fr.ground(f.pos.x, f.pos.z);
                y = gy + (a.world.y - rootY) + STEP_LIFT * 0.6 * early;
                // 横へ動いている足は地面から浮かせる（混ぜた形で足が地面の下へ入るときも、地面をこすらない）。速く動くほど高く（2 cm まで）
                const moved = dt > 0 ? Math.hypot(f.pos.x - f.target.x, f.pos.z - f.target.z) / dt : 0;
                const clear = y + this.lowOffset(rot) - gy;
                const want = Math.max(0.02 * g, Math.min(0.02, moved * 0.03));
                if (clear < want) y += want - clear;
                if (f.lifting && g < 1) {
                    // 離れたばかり（まだ持ち上がっていない）：足先・踵の地面の点は止めたまま足が回り、持ち上がるにつれて振り出しの位置へ
                    //（足首を止めて回すと足先が地面の上を滑る）
                    this.planted(f, rot, fr.ground, tmpV3b);
                    f.pos.x = tmpV3b.x + (f.pos.x - tmpV3b.x) * g;
                    f.pos.z = tmpV3b.z + (f.pos.z - tmpV3b.z) * g;
                    y = tmpV3b.y + (y - tmpV3b.y) * g;
                }
                // 早く離した最初のコマ：高さの段差は消していく
                if (first) f.dy += prevY - y;
                f.target.set(f.pos.x, y, f.pos.z);
                if (a.low < ENTER && f.early === 0 && f.swingT > 0.05) {
                    // 着く：今の所で地面に止める（高さの段差は消していく）
                    f.planted = true;
                    f.plantT = 0;
                    f.lifting = false;
                    this.anchor(f, f.target, rot);
                    const before = f.target.y;
                    this.planted(f, rot, fr.ground, f.target);
                    f.dy += before - f.target.y;
                }
            }
            f.dy *= settle;
            if (Math.abs(f.dy) < 1e-5) f.dy = 0;
            f.lastWorld.copy(a.world);
            targets.push(f.target.clone().setY(f.target.y + f.dy));
            rots.push(rot);
            f.rot.copy(rot);
        }
        // 腰を下げる：どちらかの足首に脚が届かないとき（急に下げ、ゆっくり戻す）
        const reachMax = legLen * 0.999;
        let need = 0;
        for (let i = 0; i < 2; i++) {
            const h = hipW[i]!;
            const t = targets[i]!;
            const dx = h.x - t.x;
            const dz = h.z - t.z;
            const h2 = dx * dx + dz * dz;
            const vert = h2 < reachMax * reachMax ? Math.sqrt(reachMax * reachMax - h2) : 0;
            need = Math.max(need, h.y - t.y - vert);
        }
        need = Math.max(0, Math.min(MAX_DROP, need));
        if (dt === 0) this.drop = need;
        else {
            // 下げるのは速く（ただし 1 秒に 0.25 m まで：1 コマで大きく沈まない）、戻すのはゆっくり
            const d = (need - this.drop) * (1 - Math.exp(-dt / (need > this.drop ? 0.04 : 0.15)));
            this.drop += Math.max(-DROP_RATE * dt, Math.min(DROP_RATE * dt, d));
        }
        this.stats.drop = this.drop;
        if (this.drop > 1e-5) {
            b.hips.position.y -= this.drop / this.scale;
            b.hips.updateMatrixWorld(true);
        }
        // 脚の向きの限り：極端な狙いは限りの所へ寄せる。着いた足・振り出した足の今の位置も同じだけ寄せる（次のコマも同じ所から続ける）
        const yaw = root.rotation.y;
        for (let i = 0; i < 2; i++) {
            const hip = tmpV.setFromMatrixPosition(b.upper[i]!.matrixWorld);
            const [dx, dz] = limitLeg(hip, targets[i]!, Math.sin(yaw), Math.cos(yaw));
            if (dx === 0 && dz === 0) continue;
            this.stats.limited++;
            const f = this.feet[i]!;
            f.target.x += dx;
            f.target.z += dz;
            f.pos.x += dx;
            f.pos.z += dz;
            if (f.planted) {
                f.heel.x += dx;
                f.heel.z += dz;
            }
        }
        for (let i = 0; i < 2; i++) this.solve(i, targets[i]!, rots[i]!);
    }

    /** 2 本の骨の IK：腰の関節から足首 target へ。膝は動きの元の膝の向き（無ければ体の前）へ曲げる。足は世界の向き footRot に */
    private solve(i: number, target: THREE.Vector3, footRot: THREE.Quaternion): void {
        const { b } = this;
        const up = b.upper[i]!;
        const lo = b.lower[i]!;
        const ft = b.foot[i]!;
        up.updateMatrixWorld(true);
        const hip = new THREE.Vector3().setFromMatrixPosition(up.matrixWorld);
        const knee = new THREE.Vector3().setFromMatrixPosition(lo.matrixWorld);
        const l1 = this.l1;
        const l2 = this.l2;
        const d = tmpV.copy(target).sub(hip);
        let dist = d.length();
        if (dist < 1e-6) return;
        const dn = d.clone().divideScalar(dist);
        dist = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(dist, (l1 + l2) * 0.9999));
        // 膝の向き：動きの元の膝（股関節 → 足首の線から外れた向き）と、体の前・足先の前を足したもの
        const pole = knee.clone().sub(hip);
        pole.addScaledVector(dn, -pole.dot(dn));
        const fwd = tmpV2.set(0, 0, 1).applyQuaternion(footRot);
        fwd.y = 0;
        const body = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
        const hint = fwd.normalize().add(body).normalize().multiplyScalar(0.02);
        pole.add(hint);
        pole.addScaledVector(dn, -pole.dot(dn));
        if (pole.lengthSq() < 1e-10) pole.copy(body).addScaledVector(dn, -body.dot(dn));
        pole.normalize();
        const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
        const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
        const kneeNew = hip.clone().addScaledVector(dn, along).addScaledVector(pole, height);
        // 太もも：今の膝の向き → 新しい膝の向き（世界で回してから、親から見た回転へ）
        this.rotateBone(up, knee.clone().sub(hip).normalize(), kneeNew.clone().sub(hip).normalize());
        up.updateMatrixWorld(true);
        // すね：今の足首の向き → 狙いの足首の向き
        const kneeNow = new THREE.Vector3().setFromMatrixPosition(lo.matrixWorld);
        const ankleNow = new THREE.Vector3().setFromMatrixPosition(ft.matrixWorld);
        this.rotateBone(lo, ankleNow.sub(kneeNow).normalize(), target.clone().sub(kneeNow).normalize());
        lo.updateMatrixWorld(true);
        // 足：世界の向きを footRot に
        const parentQ = lo.getWorldQuaternion(tmpQ);
        ft.quaternion.copy(parentQ.invert().multiply(footRot));
        ft.updateMatrixWorld(true);
    }

    /** 骨を世界で from → to の向きへ回す（その骨の局所の回転を書き換える） */
    private rotateBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
        if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
        const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        const newWorld = delta.multiply(world);
        bone.quaternion.copy(parentWorld.invert().multiply(newWorld));
    }
}
