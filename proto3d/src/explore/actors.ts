/**
 * 演出の出来事・町の人々を描く層（three）。置き方は純粋な関数（explore/stage.ts・explore/ambient.ts）の結果をそのまま使う。
 * - 人（人物の素材の写し）：歩きと立ちの形は「時刻・歩いた距離」から決める（posePerson）。荷運びは肩に俵、店の人はお辞儀の動き。
 * - 兵（合戦の兵の形）：TownTroops（少ない描画の呼び出し）。
 * - 画面の外（影の届く分を足した範囲の外）・遠すぎる人は描かない。
 */
import * as THREE from 'three';
import { groundY } from '../layout';
import { hashOf, posePerson, type PersonBody, type PersonFactory } from './people';
import type { StageBanner, StageFigure, StageLitter, StagePerson } from './stage';
import { TownTroops } from './troops';

/** 描く距離の上限（m） */
const PEOPLE_FAR = 42;

interface ActorPerson {
    key: string;
    look: string;
    body: PersonBody;
    bale: THREE.Mesh | null;
    label: HTMLElement | null;
    showLabel: boolean;
}

export type ActorPersonState = StagePerson & { carrying?: boolean; work?: number };

const tmpV = new THREE.Vector3();
const sphere = new THREE.Sphere();
const qBow = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);

export class ActorLayer {
    readonly group = new THREE.Group();
    readonly troops: TownTroops;
    private readonly people = new Map<string, ActorPerson>();
    private readonly frustum = new THREE.Frustum();
    private readonly pv = new THREE.Matrix4();
    private readonly baleGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.62, 10);
    private readonly baleMat = new THREE.MeshStandardMaterial({ color: '#9c8656', roughness: 0.95 });
    /** 確かめ用：直前に描いた人の数 */
    peopleDrawn = 0;

    constructor(
        name: string,
        private readonly factory: PersonFactory,
        private readonly labelsBox: HTMLElement | null,
        private readonly viewSize: () => { w: number; h: number },
        cap: number,
        private readonly low: boolean,
    ) {
        this.group.name = name;
        this.troops = new TownTroops(`${name}-troops`, cap, low);
        this.group.add(this.troops.group);
    }

    /** 人を置き直す（いない人は消し、新しい人は作る）。time は待機の動きの時刻 */
    setPeople(list: readonly ActorPersonState[], time: number, camera: THREE.Camera): void {
        const want = new Set(list.map((p) => p.key));
        for (const [k, a] of this.people) {
            if (!want.has(k)) this.remove(k, a);
        }
        this.updateFrustum(camera);
        let drawn = 0;
        for (const p of list) {
            let a = this.people.get(p.key);
            if (a && (a.look !== p.look || a.body.standIn !== !this.factory.hasModel)) {
                this.remove(p.key, a);
                a = undefined;
            }
            if (!a) a = this.add(p);
            const gy = groundY(p.x, p.z);
            const root = a.body.root;
            root.position.set(p.x, gy, p.z);
            root.rotation.y = p.heading;
            // 画面の外（影の分を足す）・遠い人は描かない
            sphere.center.set(p.x, gy + 1, p.z);
            sphere.radius = 3.0;
            const vis = this.frustum.intersectsSphere(sphere) && Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < PEOPLE_FAR;
            root.visible = vis;
            if (vis) {
                drawn++;
                posePerson(a.body, time + (hashOf(p.key) % 1000) / 250, p.walked, p.moving);
                if (p.work) {
                    // 店先の作業：上体を前へ（お辞儀）
                    const spine = a.body.bones.get('Spine');
                    if (spine) spine.quaternion.multiply(qBow.setFromAxisAngle(X, 0.32 * p.work));
                    const neck = a.body.bones.get('Neck');
                    if (neck) neck.quaternion.multiply(qBow.setFromAxisAngle(X, 0.18 * p.work));
                }
            }
            if (a.bale) a.bale.visible = vis && !!p.carrying;
            a.showLabel = vis && p.label;
        }
        this.peopleDrawn = drawn;
        this.placeLabels(camera);
    }

    /**
     * 名札を頭の上へ（描く直前に呼ぶ：演出の時計は探索の描画と別の時に進むので、描いた画と名札がずれないように、描く前にもう一度置く）
     */
    placeLabels(camera: THREE.Camera): void {
        const { w, h } = this.viewSize();
        for (const a of this.people.values()) {
            if (!a.label) continue;
            if (!a.showLabel) {
                a.label.hidden = true;
                continue;
            }
            const r = a.body.root.position;
            tmpV.set(r.x, r.y + 2.05, r.z).project(camera);
            const on = tmpV.z > -1 && tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05;
            a.label.hidden = !on;
            if (on) a.label.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
        }
    }

    /** 兵・のぼり・担架を置き直す */
    setFigures(figures: readonly StageFigure[], banners: readonly StageBanner[], litters: readonly StageLitter[], time: number, camera: THREE.Camera | null): void {
        this.troops.set(figures, banners, litters, time, camera);
    }

    /** 全部消す（人も兵も） */
    clear(): void {
        for (const [k, a] of this.people) this.remove(k, a);
        this.troops.clear();
        this.peopleDrawn = 0;
    }

    /** 人物の素材を読み終えた：代わりの形の人を作り直す（次の setPeople で） */
    resetPeople(): void {
        for (const [k, a] of this.people) this.remove(k, a);
    }

    get peopleCount(): number {
        return this.people.size;
    }

    private add(p: ActorPersonState): ActorPerson {
        const body = this.factory.make(p.look, { walk: true, idlePhase: (hashOf(p.key) % 1000) / 1000 });
        let bale: THREE.Mesh | null = null;
        if (p.carrying !== undefined) {
            // 肩に担ぐ俵（右肩の骨に付ける：休みの形では骨は回っていないので、骨の中の向きは人物の向きと同じ。人物の前後に長い）
            bale = new THREE.Mesh(this.baleGeo, this.baleMat);
            bale.rotation.x = Math.PI / 2;
            bale.castShadow = !this.low;
            bale.visible = false;
            const shoulder = body.bones.get('RightShoulder');
            if (shoulder) {
                bale.position.set(-0.04, 0.2, 0.02);
                shoulder.add(bale);
            } else {
                bale.position.set(-0.2, 1.62, 0.02);
                body.root.add(bale);
            }
        }
        let label: HTMLElement | null = null;
        if (this.labelsBox && p.name) {
            label = document.createElement('div');
            label.className = 'npc-label';
            label.textContent = p.name;
            label.dataset.id = p.key;
            label.hidden = true;
            this.labelsBox.appendChild(label);
        }
        this.group.add(body.root);
        const a: ActorPerson = { key: p.key, look: p.look, body, bale, label, showLabel: false };
        this.people.set(p.key, a);
        return a;
    }

    private remove(key: string, a: ActorPerson): void {
        this.group.remove(a.body.root);
        a.body.mixer?.stopAllAction();
        a.label?.remove();
        this.people.delete(key);
    }

    private updateFrustum(camera: THREE.Camera): void {
        camera.updateMatrixWorld();
        this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.pv);
    }
}
