/**
 * 兵士と旗の描画（three）。数・並び・揺れの決まりは troops.ts（純粋）、部隊の見た目の位置・向き（なめらかにしたもの）は view.ts が渡す。
 * - 種類×部品ごとに 1 つの InstancedMesh（体・槍（頭つき）・弓（頭つき）・馬・旗竿・本陣の旗の頭・のぼり（家と大きさごと））。
 *   部隊の数によらず描画の呼び出しの数は一定（のぼりだけは合戦に出る家の数 × 大きさで決まる。部隊の数では増えない）。
 * - 見える兵士だけを毎フレーム前から詰めて書き、count をその数にする（画面外・見えない部隊・LOD で間引いた兵士は描かない）。
 * - 画面外の抑制：部隊ごとに境界の球をカメラの視錐台と比べ、外なら兵士・旗の行列を書かない。
 * - LOD：カメラから部隊の中心までの距離で 100%／60%／35%（troops.ts の TROOP_DATA.lod）。
 * 合戦の状態（BattleState）は読むだけ。ここで数えた人数は表示だけのもので、計算には使わない。
 */
import * as THREE from 'three';
import type { ClanId, UnitKind } from './types';
import { POLE_H, makeTroopGeometries } from '../shared/figures';
import { elevationAt, type BattleState } from './sim';
import {
    lodCount,
    lodPick,
    lodRatio,
    stepTroopCount,
    troopExtent,
    troopHash,
    troopKeepOrder,
    troopMax,
    troopPose,
    troopSlots,
    troopTarget,
    type TroopBox,
    type TroopCounter,
    type TroopMotion,
    type TroopPose,
    type TroopSlot,
    type TroopTier,
} from './troops';

/** 兵士の大きさ（1 m 単位の形を何倍で置くか。実寸より大きめにして、遠くからも隊列が読めるように） */
export const TROOP_FIG = 1.45;
/** 旗の高さ（m。形と一緒に shared/figures.ts へ移した） */
export { POLE_H };

/** view.ts が毎フレーム渡す、部隊の見た目の位置と様子（なめらかにしたもの） */
export interface TroopUnitPose {
    px: number;
    pz: number;
    /** 斬り合いの見た目の寄せ */
    sx: number;
    sz: number;
    face: number;
    /** 敗走してからの時間（秒。-1 は敗走していない） */
    routT: number;
    shown: boolean;
    /** 旗の根元（地面）と、敗走で傾く角度・のぼりのはためき */
    flagX: number;
    flagY: number;
    flagZ: number;
    flagTilt: number;
    bannerYaw: number;
}

/** 部隊ごとの兵士の組み立て */
interface TroopUnit {
    id: string;
    kind: UnitKind;
    hq: boolean;
    slots: TroopSlot[];
    keep: number[];
    radius: number;
    max: number;
    counter: TroopCounter;
    /** 鎧の色（スロットごと。RGB） */
    colors: Float32Array;
    banner: THREE.InstancedMesh;
    /** 直前のフレームで描いた人数（0 は画面外・見えない） */
    drawn: number;
    culled: boolean;
    lod: number;
}

/** 開発用の数え上げ（window.__battle.troopStats） */
export interface TroopStats {
    visibleSoldiers: number;
    perUnit: Record<string, number>;
    instancesByMesh: Record<string, number>;
    /** 画面外で描かなかった部隊 */
    culledUnits: string[];
    /** 部隊ごとの LOD の割合（見えている部隊） */
    lodByUnit: Record<string, number>;
    tier: TroopTier;
}

export interface TroopLayerOptions {
    tier: TroopTier;
    /** 家の色（鎧） */
    clanColor: (clan: ClanId) => string;
    /** のぼりの材質（家ごと。view.ts が紋の画像で作る。テストでは簡単な材質） */
    bannerMaterial: (clan: ClanId) => THREE.Material;
}

export class TroopLayer {
    readonly group = new THREE.Group();
    private readonly units: TroopUnit[] = [];
    private readonly body: THREE.InstancedMesh;
    private readonly spear: THREE.InstancedMesh;
    private readonly bow: THREE.InstancedMesh;
    private readonly horse: THREE.InstancedMesh;
    private readonly pole: THREE.InstancedMesh;
    private readonly top: THREE.InstancedMesh;
    private readonly banners = new Map<string, THREE.InstancedMesh>();
    private readonly owned: { dispose(): void }[] = [];
    private readonly tier: TroopTier;
    private readonly frustum = new THREE.Frustum();
    private readonly projView = new THREE.Matrix4();
    private readonly sphere = new THREE.Sphere();
    private readonly m4 = new THREE.Matrix4();
    private readonly base = new THREE.Matrix4();
    private readonly local = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly v3 = new THREE.Vector3();
    private readonly s3 = new THREE.Vector3();
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly zAxis = new THREE.Vector3(0, 0, 1);
    private readonly pose: TroopPose = { lx: 0, lz: 0, lift: 0, yaw: 0 };
    private readonly motion: TroopMotion = { t: 0, moving: false, melee: false, scatter: 0, cavalry: false };
    private lastStats: TroopStats;

    /** boxes：部隊ごとの隊列の広さ（view.ts の部隊の輪・押す判定と同じ）。s.units と同じ順 */
    constructor(s: BattleState, boxes: TroopBox[], opts: TroopLayerOptions) {
        this.tier = opts.tier;
        const geo = makeTroopGeometries();
        this.owned.push(geo.body, geo.spear, geo.bow, geo.horse, geo.pole, geo.top, geo.banner, geo.big);
        const tinted = this.own(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
        const neutral = this.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
        const poleMat = this.own(new THREE.MeshLambertMaterial({ color: '#3b2c1c' }));
        const topMat = this.own(new THREE.MeshLambertMaterial({ color: '#d8b24a', emissive: '#4a3a10' }));
        let nBody = 0;
        let nSpear = 0;
        let nBow = 0;
        let nHorse = 0;
        let nHq = 0;
        const bannerN = new Map<string, number>();
        const c = new THREE.Color();
        const plan: { key: string; clan: ClanId; hq: boolean }[] = [];
        for (let i = 0; i < s.units.length; i++) {
            const u = s.units[i];
            const max = troopMax(u.startStrength, this.tier);
            const slots = troopSlots(u.kind, max, boxes[i]);
            const colors = new Float32Array(slots.length * 3);
            const base = new THREE.Color(opts.clanColor(u.clan));
            for (let k = 0; k < slots.length; k++) {
                c.copy(base).multiplyScalar(0.86 + troopHash(u.id, k + 31) * 0.24);
                colors[k * 3] = c.r;
                colors[k * 3 + 1] = c.g;
                colors[k * 3 + 2] = c.b;
            }
            nBody += max;
            if (u.kind === 'yumi') nBow += max;
            else nSpear += max;
            if (u.kind === 'kiba') nHorse += max;
            if (u.isHq) nHq++;
            const key = `${u.clan}:${u.isHq ? 'big' : 'std'}`;
            bannerN.set(key, (bannerN.get(key) ?? 0) + 1);
            plan.push({ key, clan: u.clan, hq: u.isHq });
            this.units.push({
                id: u.id,
                kind: u.kind,
                hq: u.isHq,
                slots,
                keep: troopKeepOrder(slots, u.id),
                radius: troopExtent(slots).radius,
                max,
                counter: { shown: troopTarget(max, u.strength, u.startStrength), wait: 0 },
                colors,
                banner: null as unknown as THREE.InstancedMesh,
                drawn: 0,
                culled: false,
                lod: 1,
            });
        }
        this.body = this.instanced('body', geo.body, tinted, nBody, true);
        this.spear = this.instanced('spear', geo.spear, neutral, nSpear);
        this.bow = this.instanced('bow', geo.bow, neutral, nBow);
        this.horse = this.instanced('horse', geo.horse, neutral, nHorse);
        this.pole = this.instanced('pole', geo.pole, poleMat, s.units.length);
        this.top = this.instanced('top', geo.top, topMat, nHq);
        for (const [key, n] of bannerN) {
            const [clan, size] = key.split(':') as [ClanId, string];
            this.banners.set(key, this.instanced(`banner:${key}`, size === 'big' ? geo.big : geo.banner, opts.bannerMaterial(clan), n));
        }
        plan.forEach((p, i) => (this.units[i].banner = this.banners.get(p.key)!));
        this.lastStats = { visibleSoldiers: 0, perUnit: {}, instancesByMesh: {}, culledUnits: [], lodByUnit: {}, tier: this.tier };
    }

    private own<T extends { dispose(): void }>(o: T): T {
        this.owned.push(o);
        return o;
    }

    private instanced(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, colored = false): THREE.InstancedMesh {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
        m.name = name;
        m.count = 0;
        m.visible = false;
        // 部隊ごとに自分で視錐台と比べるので、three の丸ごとの判定は使わない
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (colored) {
            m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
            m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        }
        this.group.add(m);
        return m;
    }

    /**
     * 毎フレーム：見えている部隊の兵士と旗を書く（読むだけ）。poses は s.units と同じ順、t・dt は表示の時計（一時停止中も進む）。
     * camera は行列（matrixWorldInverse・projectionMatrix）が今のものであること。
     */
    update(s: BattleState, poses: readonly TroopUnitPose[], camera: THREE.Camera, t: number, dt: number): void {
        this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projView);
        const camPos = camera.position;
        const counts = { body: 0, spear: 0, bow: 0, horse: 0, pole: 0, top: 0 };
        const bannerCount = new Map<THREE.InstancedMesh, number>();
        const perUnit: Record<string, number> = {};
        const lodByUnit: Record<string, number> = {};
        const culledUnits: string[] = [];
        const colorArr = this.body.instanceColor!.array as Float32Array;
        const m = this.motion;
        m.t = t;
        for (let i = 0; i < this.units.length; i++) {
            const tu = this.units[i];
            const p = poses[i];
            const u = s.units[i];
            tu.drawn = 0;
            tu.culled = false;
            const target = troopTarget(tu.max, u.strength, u.startStrength);
            if (!p.shown) {
                // 見えていない間は、今の人数にそのまま合わせる（出てきたときに急に抜けていかない）
                tu.counter.shown = target;
                tu.counter.wait = 0;
                perUnit[tu.id] = 0;
                continue;
            }
            stepTroopCount(tu.counter, target, dt);
            const routed = u.status === 'routed';
            const scatter = routed ? Math.min(1, Math.max(0, p.routT) / 2.5) : 0;
            // 境界の球（散り具合と旗の高さを含める）
            const cx = p.px + p.sx;
            const cz = p.pz + p.sz;
            const gy = elevationAt(s.map, cx, cz);
            this.sphere.center.set(cx, gy + POLE_H * 0.5, cz);
            this.sphere.radius = tu.radius * (1 + scatter * 1.6) + scatter * 10 + POLE_H * 0.8;
            if (!this.frustum.intersectsSphere(this.sphere)) {
                tu.culled = true;
                culledUnits.push(tu.id);
                perUnit[tu.id] = 0;
                continue;
            }
            // 旗（竿・のぼり・本陣の頭）
            this.q.setFromAxisAngle(this.zAxis, p.flagTilt);
            this.base.compose(this.v3.set(p.flagX, p.flagY, p.flagZ), this.q, this.s3.set(1, 1, 1));
            this.m4.copy(this.base).multiply(this.local.makeScale(1, tu.hq ? 1.3 : 1, 1));
            this.pole.setMatrixAt(counts.pole++, this.m4);
            this.local.makeRotationY(p.bannerYaw).setPosition(0, tu.hq ? POLE_H * 1.3 - 3.9 : POLE_H - 3.0, 0);
            this.m4.copy(this.base).multiply(this.local);
            const bn = bannerCount.get(tu.banner) ?? 0;
            tu.banner.setMatrixAt(bn, this.m4);
            bannerCount.set(tu.banner, bn + 1);
            if (tu.hq) {
                this.m4.copy(this.base).multiply(this.local.makeTranslation(0, POLE_H * 1.3 + 0.4, 0));
                this.top.setMatrixAt(counts.top++, this.m4);
            }
            // 兵士（LOD で均等に間引く）
            const dist = camPos.distanceTo(this.v3.set(cx, gy, cz));
            const ratio = lodRatio(dist, this.tier);
            lodByUnit[tu.id] = ratio;
            tu.lod = ratio;
            const shown = Math.min(tu.counter.shown, tu.slots.length);
            const pick = lodPick(shown, lodCount(shown, ratio));
            const fwdX = Math.sin(p.face);
            const fwdZ = -Math.cos(p.face);
            const rgtX = Math.cos(p.face);
            const rgtZ = Math.sin(p.face);
            m.moving = u.moving || routed;
            m.melee = !!u.engagedWith;
            m.scatter = scatter;
            m.cavalry = u.kind === 'kiba';
            const riderY = m.cavalry ? 0.8 * TROOP_FIG : 0;
            const gear = u.kind === 'yumi' ? this.bow : this.spear;
            for (const k of pick) {
                const idx = tu.keep[k];
                troopPose(tu.slots[idx], idx, tu.id, m, this.pose);
                const { lx, lz } = this.pose;
                const wx = cx + rgtX * lx - fwdX * lz;
                const wz = cz + rgtZ * lx - fwdZ * lz;
                const y = elevationAt(s.map, wx, wz) + this.pose.lift;
                this.q.setFromAxisAngle(this.yAxis, -p.face + this.pose.yaw);
                this.s3.setScalar(TROOP_FIG);
                this.m4.compose(this.v3.set(wx, y + riderY, wz), this.q, this.s3);
                const bi = counts.body++;
                this.body.setMatrixAt(bi, this.m4);
                colorArr[bi * 3] = tu.colors[idx * 3];
                colorArr[bi * 3 + 1] = tu.colors[idx * 3 + 1];
                colorArr[bi * 3 + 2] = tu.colors[idx * 3 + 2];
                if (gear === this.bow) this.bow.setMatrixAt(counts.bow++, this.m4);
                else this.spear.setMatrixAt(counts.spear++, this.m4);
                if (m.cavalry) {
                    this.m4.compose(this.v3.set(wx, y, wz), this.q, this.s3);
                    this.horse.setMatrixAt(counts.horse++, this.m4);
                }
            }
            tu.drawn = pick.length;
            perUnit[tu.id] = pick.length;
        }
        const instancesByMesh: Record<string, number> = {};
        const finish = (mesh: THREE.InstancedMesh, n: number, color = false) => {
            mesh.count = n;
            mesh.visible = n > 0;
            instancesByMesh[mesh.name] = n;
            if (n <= 0) return;
            // 書いた所だけ送る（スマホの転送を減らす）
            mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(0, n * 16);
            mesh.instanceMatrix.needsUpdate = true;
            if (color && mesh.instanceColor) {
                mesh.instanceColor.clearUpdateRanges();
                mesh.instanceColor.addUpdateRange(0, n * 3);
                mesh.instanceColor.needsUpdate = true;
            }
        };
        finish(this.body, counts.body, true);
        finish(this.spear, counts.spear);
        finish(this.bow, counts.bow);
        finish(this.horse, counts.horse);
        finish(this.pole, counts.pole);
        finish(this.top, counts.top);
        for (const b of this.banners.values()) finish(b, bannerCount.get(b) ?? 0);
        this.lastStats = { visibleSoldiers: counts.body, perUnit, instancesByMesh, culledUnits, lodByUnit, tier: this.tier };
    }

    /** 直前のフレームで描いたもの（開発用の数え上げ） */
    stats(): TroopStats {
        return this.lastStats;
    }

    /** 部隊 i の、今見せている人数（LOD の前。兵の減り方の確認用） */
    shownCount(i: number): number {
        return this.units[i]?.counter.shown ?? 0;
    }

    /** InstancedMesh の数（描画の呼び出しの上限。部隊の数では増えない） */
    meshCount(): number {
        return this.group.children.length;
    }

    dispose(): void {
        for (const o of this.owned) o.dispose();
        this.owned.length = 0;
        for (const c of this.group.children) (c as THREE.InstancedMesh).dispose();
        this.group.clear();
    }
}
