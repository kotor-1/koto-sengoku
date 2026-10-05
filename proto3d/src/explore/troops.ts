/**
 * 町の兵（合戦の兵の形の写し。three）。負傷兵・出陣を待つ兵・援兵・門番・演出の隊列を、少ない描画の呼び出しで描く。
 * 形は shared/figures.ts（合戦と同じ箱と円すいの兵。町では 0.82 倍）、のぼりは旗の一文字の画像。
 * 置き方（位置・向き・姿勢）は呼ぶ側が毎回渡す（純粋な関数 explore/stage.ts・explore/ambient.ts の結果）。
 * 画面の外（影の届く分を足した範囲の外）・遠すぎる兵は描かない。
 */
import * as THREE from 'three';
import { CLAN_COLOR, clanOfMark, makeMarkBannerTexture, makeTroopGeometries, merge, part } from '../shared/figures';
import { groundY } from '../layout';
import type { StageBanner, StageFigure, StageLitter } from './stage';

/** 町の兵の大きさ（1 m 単位の形を何倍で置くか。合戦は 1.45） */
export const TOWN_FIG = 0.82;
/** のぼりの竿の長さ（m） */
const POLE = 3.6;
/** 描く距離の上限（m） */
const FAR = 46;

const mk = new THREE.Matrix4();
const mq = new THREE.Quaternion();
const mtmp = new THREE.Matrix4();
const euler = new THREE.Euler();
const color = new THREE.Color();
const sphere = new THREE.Sphere();

/** 鎧の色（旗の一文字の家の色。知らない字は鈍い色） */
function tintOf(mark: string): THREE.Color {
    const clan = clanOfMark(mark);
    return new THREE.Color(clan ? CLAN_COLOR[clan] : '#6b6259');
}

export class TownTroops {
    readonly group = new THREE.Group();
    private readonly body: THREE.InstancedMesh;
    private readonly head: THREE.InstancedMesh;
    private readonly spear: THREE.InstancedMesh;
    private readonly cap: number;
    private readonly banners: { pole: THREE.Mesh; cloth: THREE.Mesh; mark: string }[] = [];
    private readonly litters: THREE.Mesh[] = [];
    private readonly bannerMats = new Map<string, THREE.Material>();
    private readonly poleGeo = new THREE.CylinderGeometry(0.04, 0.05, POLE, 6);
    private readonly clothGeo = new THREE.PlaneGeometry(0.62, 1.5);
    private readonly litterGeo = new THREE.BoxGeometry(0.62, 0.06, 1.9);
    private readonly woodMat = new THREE.MeshStandardMaterial({ color: '#4d3a28', roughness: 0.9 });
    private readonly frustum = new THREE.Frustum();
    private readonly pv = new THREE.Matrix4();
    /** 直前に描いた兵の数（確かめ用） */
    drawn = 0;

    constructor(name: string, cap: number, private readonly low: boolean) {
        this.cap = cap;
        this.group.name = name;
        const geo = makeTroopGeometries();
        // 町では頭と槍を分ける（負傷兵は槍を持たない）。槍は合戦と同じ寸法
        const head = part(new THREE.SphereGeometry(0.19, 8, 6), '#d8b28a', 0, 1.72, 0);
        const spear = merge([
            part(new THREE.BoxGeometry(0.06, 4.4, 0.06), '#6e5436', 0.36, 2.0, -0.2, -0.22),
            part(new THREE.ConeGeometry(0.1, 0.45, 4), '#e2e2e2', 0.36, 2.0 + 2.2 * Math.cos(0.22) + 0.2, -0.2 - 2.2 * Math.sin(0.22) - 0.05, -0.22),
        ]);
        for (const g of ['spear', 'bow', 'horse', 'pole', 'top', 'banner', 'big'] as const) geo[g].dispose();
        const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
        const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
        this.body = this.instanced('body', geo.body, bodyMat);
        this.head = this.instanced('head', head, plainMat);
        this.spear = this.instanced('spear', spear, plainMat);
    }

    private instanced(name: string, g: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
        const m = new THREE.InstancedMesh(g, mat, this.cap);
        m.name = `${this.group.name}:${name}`;
        m.count = 0;
        m.castShadow = !this.low;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
    }

    /**
     * 兵・のぼり・担架を置き直す（毎フレーム呼んでよい）。time は揺れ（息）に使う秒。
     * camera を渡すと、画面の外（影の分を足す）・遠すぎる兵は描かない。
     */
    set(figures: readonly StageFigure[], banners: readonly StageBanner[], litters: readonly StageLitter[], time: number, camera: THREE.Camera | null): void {
        let cull = false;
        if (camera) {
            camera.updateMatrixWorld();
            this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            this.frustum.setFromProjectionMatrix(this.pv);
            cull = true;
        }
        const cam = camera?.position;
        const visible = (x: number, y: number, z: number, r: number) => {
            if (!cull) return true;
            if (cam && Math.hypot(x - cam.x, z - cam.z) > FAR) return false;
            sphere.center.set(x, y, z);
            sphere.radius = r;
            return this.frustum.intersectsSphere(sphere);
        };
        let n = 0;
        let ns = 0;
        for (const f of figures) {
            if (n >= this.cap) break;
            const gy = groundY(f.x, f.z);
            if (!visible(f.x, gy + 1, f.z, 3.2)) continue;
            this.figureMatrix(f, gy, time, mk);
            this.body.setMatrixAt(n, mk);
            this.head.setMatrixAt(n, mk);
            const tint = tintOf(f.mark).multiplyScalar(0.9 + ((Math.sin(f.x * 12.9898 + f.z * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.2);
            this.body.setColorAt(n, tint);
            this.head.setColorAt(n, color.setRGB(1, 1, 1));
            if (f.spear && ns < this.cap) {
                this.spear.setMatrixAt(ns, mk);
                ns++;
            }
            n++;
        }
        this.body.count = n;
        this.head.count = n;
        this.spear.count = ns;
        for (const m of [this.body, this.head, this.spear]) {
            // 0 人のときは描かない（描画の呼び出しを増やさない）
            m.visible = m.count > 0;
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
        }
        this.drawn = n;
        // のぼり
        let nb = 0;
        for (const b of banners) {
            const gy = groundY(b.x, b.z);
            if (!visible(b.x, gy + 2, b.z, 4.5)) continue;
            const v = this.bannerAt(nb++, b.mark);
            const h = b.heading;
            // 竿：根元を手の高さに。後ろ（進む向きの反対）へ tilt だけ傾ける
            const up = new THREE.Vector3(-Math.sin(h) * Math.sin(b.tilt), Math.cos(b.tilt), -Math.cos(h) * Math.sin(b.tilt));
            const base = new THREE.Vector3(b.x + Math.cos(h) * -0.3, gy + b.y, b.z - Math.sin(h) * -0.3);
            v.pole.position.copy(base).addScaledVector(up, POLE / 2 - 0.6);
            v.pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
            // 布：竿の上の方に、進む向きと平行に（横から見える）。巻いたときは細く短く
            v.cloth.position.copy(base).addScaledVector(up, POLE - 0.6 - (b.open ? 0.85 : 0.6));
            v.cloth.quaternion.copy(v.pole.quaternion).multiply(mq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h + Math.PI / 2));
            v.cloth.translateX(b.open ? -0.32 : -0.06);
            v.cloth.scale.set(b.open ? 1 : 0.18, b.open ? 1 : 0.62, 1);
            v.pole.visible = v.cloth.visible = true;
        }
        for (let i = nb; i < this.banners.length; i++) this.banners[i]!.pole.visible = this.banners[i]!.cloth.visible = false;
        // 担架
        let nl = 0;
        for (const l of litters) {
            const gy = groundY(l.x, l.z);
            if (!visible(l.x, gy + 0.6, l.z, 2.5)) continue;
            let m = this.litters[nl];
            if (!m) {
                m = new THREE.Mesh(this.litterGeo, this.woodMat);
                m.castShadow = !this.low;
                m.receiveShadow = true;
                this.group.add(m);
                this.litters.push(m);
            }
            m.position.set(l.x, gy + l.y, l.z);
            m.rotation.set(0, l.heading, 0);
            m.visible = true;
            nl++;
        }
        for (let i = nl; i < this.litters.length; i++) this.litters[i]!.visible = false;
        void time;
    }

    /** 兵 1 人の行列（姿勢ごと）。形は前が −z なので、向き heading に π を足す */
    private figureMatrix(f: StageFigure, gy: number, time: number, out: THREE.Matrix4): void {
        const s = TOWN_FIG;
        const ph = f.phase * Math.PI * 2;
        let y = gy + f.y;
        let rx = 0;
        let sy = 1;
        let rz = f.lean;
        switch (f.pose) {
            case 'walk':
                y += Math.abs(Math.sin(ph)) * 0.035;
                rx = -0.05;
                rz += Math.sin(ph) * 0.025;
                break;
            case 'limp':
                y += Math.abs(Math.sin(ph)) * 0.05;
                rx = -0.12;
                rz += Math.sin(ph) * 0.07;
                break;
            case 'stand':
                // 息（ゆっくり）
                y += Math.sin(time * 1.6 + f.phase * 6) * 0.004;
                break;
            case 'lie':
            case 'carried':
                // 仰向け（頭は向きの反対側）。体の厚みの半分だけ上げる
                rx = Math.PI / 2;
                y += 0.16;
                break;
            case 'sit':
                sy = 0.7;
                break;
            case 'sitGround':
                sy = 0.52;
                rx = 0.14;
                break;
        }
        // 行列 = 位置 · 向き（形は前が −z） · 傾き（前後 rx・横 rz） · 大きさ（座ると縦に縮める）
        out.makeRotationY(f.heading + Math.PI);
        out.multiply(mtmp.makeRotationFromEuler(euler.set(rx, 0, rz, 'XYZ')));
        out.multiply(mtmp.makeScale(s, s * sy, s));
        out.setPosition(f.x, y, f.z);
    }

    private bannerAt(i: number, mark: string): { pole: THREE.Mesh; cloth: THREE.Mesh; mark: string } {
        let b = this.banners[i];
        if (b && b.mark === mark) return b;
        let mat = this.bannerMats.get(mark);
        if (!mat) this.bannerMats.set(mark, (mat = new THREE.MeshStandardMaterial({ map: makeMarkBannerTexture(mark), side: THREE.DoubleSide, roughness: 0.9 })));
        if (!b) {
            const pole = new THREE.Mesh(this.poleGeo, this.woodMat);
            const cloth = new THREE.Mesh(this.clothGeo, mat);
            for (const o of [pole, cloth]) {
                o.castShadow = !this.low;
                o.receiveShadow = true;
                this.group.add(o);
            }
            b = { pole, cloth, mark };
            this.banners[i] = b;
        } else {
            b.cloth.material = mat;
            b.mark = mark;
        }
        return b;
    }

    clear(): void {
        this.set([], [], [], 0, null);
    }
}
