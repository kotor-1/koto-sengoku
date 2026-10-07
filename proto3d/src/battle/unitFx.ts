/**
 * 合戦の足元の影と短い砂ぼこり（Version 22。地面の素材が使える戦場だけ。表示だけで、合戦の状態は読むだけ）。
 *
 * - 足元の影：見えている部隊ごとに 1 つのやわらかい楕円（兵士 1 人ずつではない）。大きさは部隊の輪と同じ隊列の広がり（formationExtent）。
 *   日差し（南西の高い所）の反対へ少しずらす。敗走すると薄れて消える。1 つの InstancedMesh（描画命令 1 回）。
 * - 砂ぼこり：速く動く騎馬・斬り合いの前・敗走の始まりに、短い煙を少し。全体で DUST_MAX まで（古いものから使い回す）。
 *   ×2 の速さでは出す数を半分に、止めている間は新しく出さない。1 つの InstancedMesh（描画命令 1 回）。
 * - 見えていない部隊（霧・林の中の敵・夜）には影も煙も出さない。その部隊の煙は見えなくなった時にすぐ消す（隠れた敵の居場所を漏らさない）。
 * - 押す判定（pick）・名札・画面の部品の大きさには関わらない（three の場面の飾りだけ）。
 * - 影・煙の形は、ゲームの側で作るぼかしの丸（放射状の濃淡。画像の素材ではない）。乱数は決まった並び（同じ操作なら同じ煙）。
 */
import * as THREE from 'three';
import type { BattleMap } from './types';
import { elevationAt, type BattleState } from './sim';
import { CAM } from './control';

/** 煙の数の上限（全体） */
export const DUST_MAX = 24;
/** 1 部隊の煙の数の上限 */
const DUST_PER_UNIT = 3;
/** 煙の長さ（秒。表示の時計） */
const DUST_LIFE = 1.2;
/** 1 秒あたりに出す数（×1 の速さ。×2 ではこの半分） */
const RATE = { cavalry: 2.4, clash: 2.0, rout: 2.2 };
/** 敗走の煙は、崩れてからこの秒数まで */
const ROUT_DUST_SEC = 5;
/** 影の濃さ（中心）と、日差しの反対（北東）へのずらし（m） */
const SHADOW_OPACITY = 0.34;
const SHADOW_SHIFT = { x: 0.9, z: -0.6 };

/** 描くのに要る部隊の表示の様子（view.ts の UnitVis の一部） */
export interface FxPose {
    px: number;
    pz: number;
    sx: number;
    sz: number;
    face: number;
    halfW: number;
    halfD: number;
    shown: boolean;
    routT: number;
}

/** 放射状のぼかしの丸（alphaMap 用。中が濃い）。画像の素材ではなく、ゲームの側で作る効果の形 */
export function radialAlphaTexture(size: number, power: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const dx = ((i + 0.5) / size) * 2 - 1;
            const dy = ((j + 0.5) / size) * 2 - 1;
            const r2 = dx * dx + dy * dy;
            const a = r2 >= 1 ? 0 : Math.pow(1 - r2, power);
            const v = Math.round(a * 255);
            const o = (j * size + i) * 4;
            data[o] = data[o + 1] = data[o + 2] = v;
            data[o + 3] = 255;
        }
    }
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
}

/** 決まった並びの乱数（0〜1） */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 部品ごとの濃さ（instanceColor の r）を、材質の不透明さに掛ける（色は材質の色のまま） */
function perInstanceAlpha(mat: THREE.MeshBasicMaterial, key: string): void {
    mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#if defined( USE_COLOR )\n\tdiffuseColor.a *= vColor.r;\n#endif');
    };
    mat.customProgramCacheKey = () => key;
}

interface Puff {
    unit: number;
    t0: number;
    x: number;
    z: number;
    vx: number;
    vz: number;
    s0: number;
    s1: number;
    peak: number;
    alive: boolean;
}

export class UnitFx {
    readonly group = new THREE.Group();
    private readonly shadows: THREE.InstancedMesh;
    private readonly dust: THREE.InstancedMesh;
    private readonly owned: { dispose(): void }[] = [];
    private readonly puffs: Puff[] = [];
    private readonly acc: Float32Array;
    private readonly rand = rng(0x5eed1570);
    private readonly m4 = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly v3 = new THREE.Vector3();
    private readonly s3 = new THREE.Vector3();
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
    private readonly col = new THREE.Color();
    /** 合戦の時計が最後に進んだのを見た表示の時刻（止めている間は新しい煙を出さない） */
    private lastSimT = -1;
    private lastAdvance = -1e9;
    private shadowCount = 0;
    private dustCount = 0;

    constructor(
        private readonly map: BattleMap,
        private readonly n: number,
    ) {
        this.acc = new Float32Array(Math.max(1, n));
        // 影：平らな板（2×2）にぼかしの丸。地面の少し上、深さは比べる（兵士・木の後ろには描かない）が書かない
        const sGeo = new THREE.PlaneGeometry(2, 2);
        sGeo.rotateX(-Math.PI / 2);
        const sTex = radialAlphaTexture(64, 1.6);
        const sMat = new THREE.MeshBasicMaterial({ color: '#0d1208', alphaMap: sTex, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
        perInstanceAlpha(sMat, 'battle-fx-shadow-1');
        this.shadows = new THREE.InstancedMesh(sGeo, sMat, Math.max(1, n));
        this.shadows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3).fill(1), 3);
        this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.shadows.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.shadows.frustumCulled = false;
        this.shadows.renderOrder = 1;
        for (let i = 0; i < n; i++) this.shadows.setMatrixAt(i, this.zero);
        // 煙：カメラの方へ傾けた板（カメラは回らないので、決まった傾きで正面を向く）
        const dGeo = new THREE.PlaneGeometry(1, 1);
        dGeo.rotateX(-THREE.MathUtils.degToRad(CAM.pitchDeg));
        const dTex = radialAlphaTexture(64, 2.2);
        const dMat = new THREE.MeshBasicMaterial({ color: '#bfa982', alphaMap: dTex, transparent: true, opacity: 1, depthWrite: false });
        perInstanceAlpha(dMat, 'battle-fx-dust-1');
        this.dust = new THREE.InstancedMesh(dGeo, dMat, DUST_MAX);
        this.dust.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DUST_MAX * 3), 3);
        this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.dust.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.dust.frustumCulled = false;
        this.dust.renderOrder = 3;
        for (let k = 0; k < DUST_MAX; k++) {
            this.dust.setMatrixAt(k, this.zero);
            this.puffs.push({ unit: -1, t0: -1e9, x: 0, z: 0, vx: 0, vz: 0, s0: 1, s1: 1, peak: 0, alive: false });
        }
        this.owned.push(sGeo, sTex, sMat, dGeo, dTex, dMat);
        this.group.add(this.shadows, this.dust);
    }

    /**
     * 毎フレーム（読むだけ）。poses は s.units と同じ順。t・dt は表示の時計（一時停止中も進む）。speed は合戦の速さ（×2 で煙を間引く）
     */
    update(s: BattleState, poses: readonly FxPose[], t: number, dt: number, speed: number): void {
        // 合戦の時計が進んでいるか（止めている間は新しい煙を出さない。進む刻みは 0.1 秒ごとなので少しの間をみる）
        if (s.t !== this.lastSimT) {
            if (this.lastSimT >= 0 && s.t > this.lastSimT) this.lastAdvance = t;
            this.lastSimT = s.t;
        }
        const running = t - this.lastAdvance < 0.3 && !s.result;
        const thin = speed >= 2 ? 0.5 : 1;

        // ---- 足元の影 ----
        let ns = 0;
        for (let i = 0; i < this.n; i++) {
            const v = poses[i];
            const u = s.units[i];
            let a = 0;
            if (v && u && v.shown && Number.isFinite(v.px)) a = u.status === 'routed' ? Math.max(0, 1 - Math.max(0, v.routT) / 1.6) : 1;
            if (a <= 0.01) {
                this.shadows.setMatrixAt(i, this.zero);
                continue;
            }
            const cx = v.px + v.sx + SHADOW_SHIFT.x;
            const cz = v.pz + v.sz + SHADOW_SHIFT.z;
            this.q.setFromAxisAngle(this.yAxis, -v.face);
            this.m4.compose(this.v3.set(cx, elevationAt(this.map, cx, cz) + 0.12, cz), this.q, this.s3.set(v.halfW + 2.5, 1, v.halfD + 2.5));
            this.shadows.setMatrixAt(i, this.m4);
            this.col.setRGB(a, a, a);
            this.shadows.setColorAt(i, this.col);
            ns++;
        }
        this.shadowCount = ns;
        // 描くものが無ければ描画の呼び出しもしない
        this.shadows.visible = ns > 0;
        this.shadows.instanceMatrix.needsUpdate = true;
        if (this.shadows.instanceColor) this.shadows.instanceColor.needsUpdate = true;

        // ---- 砂ぼこりを出す（見えている部隊だけ） ----
        if (running) {
            const done = new Set<string>();
            for (let i = 0; i < this.n; i++) {
                const v = poses[i];
                const u = s.units[i];
                if (!v || !u || !v.shown || !Number.isFinite(v.px)) {
                    this.acc[i] = 0;
                    continue;
                }
                const cx = v.px + v.sx;
                const cz = v.pz + v.sz;
                const fx = Math.sin(v.face);
                const fz = -Math.cos(v.face);
                let rate = 0;
                let ex = 0;
                let ez = 0;
                let spread = v.halfW;
                if (u.status === 'routed') {
                    if (v.routT < ROUT_DUST_SEC) {
                        rate = RATE.rout;
                        ex = cx;
                        ez = cz;
                        spread = Math.max(v.halfW, v.halfD) * 1.3;
                    }
                } else if (u.engagedWith) {
                    const j = s.units.findIndex((o) => o.id === u.engagedWith);
                    const e = j >= 0 ? poses[j] : null;
                    const key = u.id < u.engagedWith ? `${u.id}|${u.engagedWith}` : `${u.engagedWith}|${u.id}`;
                    // 斬り合いの前（2 部隊の真ん中）。相手も見えている組だけ・組ごとに 1 回
                    if (e && e.shown && Number.isFinite(e.px) && !done.has(key)) {
                        done.add(key);
                        rate = RATE.clash;
                        ex = (cx + e.px + e.sx) / 2;
                        ez = (cz + e.pz + e.sz) / 2;
                        spread = Math.min(v.halfW, e.halfW);
                    }
                } else if (u.moving && u.kind === 'kiba') {
                    // 速く動く騎馬：隊列の後ろ（足元）
                    rate = RATE.cavalry;
                    ex = cx - fx * (v.halfD + 1);
                    ez = cz - fz * (v.halfD + 1);
                }
                if (rate <= 0) {
                    this.acc[i] = 0;
                    continue;
                }
                this.acc[i] += rate * thin * dt;
                while (this.acc[i] >= 1) {
                    this.acc[i] -= 1;
                    const side = (this.rand() - 0.5) * 2 * spread;
                    // 横（向きに直角）に散らす
                    this.emit(i, ex + Math.cos(v.face) * side, ez + Math.sin(v.face) * side, t, u.status === 'routed' ? 1.25 : 1);
                }
            }
        }

        // ---- 砂ぼこりを動かす ----
        let nd = 0;
        for (let k = 0; k < this.puffs.length; k++) {
            const p = this.puffs[k];
            const v = p.unit >= 0 ? poses[p.unit] : null;
            const age = t - p.t0;
            // 見えなくなった部隊の煙はすぐ消す（隠れた敵の居場所を漏らさない）
            if (!p.alive || !v || !v.shown || age < 0 || age > DUST_LIFE) {
                p.alive = false;
                this.dust.setMatrixAt(k, this.zero);
                continue;
            }
            const f = age / DUST_LIFE;
            const size = p.s0 + (p.s1 - p.s0) * (1 - (1 - f) * (1 - f));
            const x = p.x + p.vx * age;
            const z = p.z + p.vz * age;
            const y = elevationAt(this.map, x, z) + size * 0.32 + age * 0.6;
            this.m4.compose(this.v3.set(x, y, z), this.q.identity(), this.s3.set(size, size, size));
            this.dust.setMatrixAt(k, this.m4);
            const a = p.peak * Math.min(1, f * 6) * (1 - f);
            this.col.setRGB(a, a, a);
            this.dust.setColorAt(k, this.col);
            nd++;
        }
        this.dustCount = nd;
        this.dust.visible = nd > 0;
        this.dust.instanceMatrix.needsUpdate = true;
        if (this.dust.instanceColor) this.dust.instanceColor.needsUpdate = true;
    }

    /** 煙を 1 つ出す（空きが無ければいちばん古いもの。1 部隊 DUST_PER_UNIT まで） */
    private emit(unit: number, x: number, z: number, t: number, big: number): void {
        let mine = 0;
        let oldestMine: Puff | null = null;
        let slot: Puff | null = null;
        for (const p of this.puffs) {
            if (p.alive && p.unit === unit) {
                mine++;
                if (!oldestMine || p.t0 < oldestMine.t0) oldestMine = p;
            }
            if (!p.alive && !slot) slot = p;
        }
        if (mine >= DUST_PER_UNIT) slot = oldestMine;
        if (!slot) {
            slot = this.puffs[0];
            for (const p of this.puffs) if (p.t0 < slot.t0) slot = p;
        }
        const r = this.rand;
        slot.unit = unit;
        slot.t0 = t;
        slot.x = x;
        slot.z = z;
        slot.vx = (r() - 0.5) * 1.6;
        slot.vz = (r() - 0.5) * 1.6;
        slot.s0 = (2.6 + r() * 1.4) * big;
        slot.s1 = (5.6 + r() * 2.6) * big;
        slot.peak = 0.48 + r() * 0.14;
        slot.alive = true;
    }

    /** 開発用の数え上げ（直前のフレーム）：描いた影・煙の数 */
    counts(): { shadows: number; dust: number } {
        return { shadows: this.shadowCount, dust: this.dustCount };
    }

    dispose(): void {
        for (const o of this.owned) o.dispose();
        this.owned.length = 0;
        this.shadows.dispose();
        this.dust.dispose();
        this.group.clear();
    }
}
