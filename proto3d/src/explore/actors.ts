/**
 * 演出の出来事・町の人々を描く層（three）。置き方は純粋な関数（explore/stage.ts・explore/ambient.ts）の結果をそのまま使う。
 * - 人（人物の素材の写し）：歩きと立ちの形は「時刻・歩いた距離」と人ごとの拍子から決める（posePerson・explore/rhythm.ts）。
 *   その上に、上体の動き（店の人の仕事・荷を担ぐ前かがみ：PersonAct）・首と頭の向き（game/gaze.ts）・足（game/legs.ts：着いた足を
 *   地面に止める・脚の IK・止まった後と向き直りの踏み替え）を足す（Version 28 §4.2。主人公と同じ足の仕組み）。足と首は前のコマからの
 *   続きで動く（見た目だけ。位置・向きは時刻の純粋な関数のまま）。時刻が戻った・飛んだ・1 m 以上動いた・見えなかった人は、足を合わせ直す。
 * - 荷運びは右肩に俵（頭を隠さない大きさ・位置）を担ぎ、右手で支える。店の人は、近くを主人公が通ると軽く会釈する（お辞儀を続けない）。
 * - 兵（合戦の兵の形）：TownTroops（少ない描画の呼び出し）。
 * - 画面の外（影の届く分を足した範囲の外）・遠すぎる人は描かない。
 */
import * as THREE from 'three';
import { Gaze } from '../game/gaze';
import { HeroLegs, legBones } from '../game/legs';
import { groundY } from '../layout';
import { townPropModel } from '../town/view';
import { posePerson, type PersonBody, type PersonFactory } from './people';
import { BOW_SEC, bowWeight, rhythmOf, type PersonAct } from './rhythm';
import type { StageBanner, StageFigure, StageLitter, StagePerson } from './stage';
import { TownTroops } from './troops';

/** 描く距離の上限（m） */
const PEOPLE_FAR = 42;
/**
 * カメラがこれより近い（横の距離 m。カメラが頭より低い所にあるとき）人は描かない（カメラが人の中に入って、体の内側や大写しが見えないように。
 * 町の急報の後、肩越しのカメラへ戻る所に使者が片膝をついている・町の人がカメラの脇を通るとき）
 */
const NEAR_HIDE = 0.6;
/** 店の人が会釈する、主人公との距離（m）と、続けて会釈しない間（秒）・主人公の方を見る距離 */
const GREET_DIST = 3;
const GREET_AGAIN = 8;
const GREET_LOOK = 4.5;
/** 足を合わせ直す：前のコマとの時刻の差（秒）・動いた距離（m） */
const RESET_DT = 0.25;
const RESET_MOVE = 1;

/**
 * 担ぐ俵（Version 28 §4.2：頭を隠さない大きさ・位置）：半径・長さ（m）と、右肩の骨の中での置き場所（肩の上・少し外。骨の中の向きは
 * 休みの形で人物の向きと同じ：+x が左、+z が前）。Version 27 は半径 0.2 m・長さ 0.62 m を肩の 0.2 m 上に置き、頭に重なって見えた
 */
export const BALE = { r: 0.14, len: 0.5, at: [-0.12, 0.15, -0.06] as const };
/** 俵を支える右手の置き所（右肩の骨の中。俵の前の下の外寄り） */
const BALE_HAND = new THREE.Vector3(-0.19, 0.06, 0.15);

interface ActorPerson {
    key: string;
    look: string;
    body: PersonBody;
    bale: THREE.Object3D | null;
    label: HTMLElement | null;
    showLabel: boolean;
    /** 足（着いた足を止める・IK・踏み替え）・首と頭の向き（素材が無い代わりの形では null） */
    legs: HeroLegs | null;
    gaze: Gaze | null;
    /** 前のコマの時刻・位置・見えていたか（足を続けて動かすか、合わせ直すか） */
    lastT: number | null;
    lastX: number;
    lastZ: number;
    shown: boolean;
    /** 会釈を始めた時刻・前の会釈の時刻・主人公が近くにいたか（店の人） */
    bowAt: number | null;
    lastBow: number | null;
    heroNear: boolean;
}

export type ActorPersonState = StagePerson;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const sphere = new THREE.Sphere();
const tmpQ = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class ActorLayer {
    readonly group = new THREE.Group();
    readonly troops: TownTroops;
    private readonly people = new Map<string, ActorPerson>();
    private readonly frustum = new THREE.Frustum();
    private readonly pv = new THREE.Matrix4();
    /**
     * 肩に担ぐ俵の代わりの筒（大きさは BALE）。形は町の小物の俵（props28.glb の tawara：藁の材質・縄の締め）を縮めて使う（makeBale）。
     * この筒は町の小物を読み終える前だけの代わり
     */
    private readonly baleGeo = new THREE.CylinderGeometry(BALE.r, BALE.r, BALE.len, 10);
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

    /**
     * 人を置き直す（いない人は消し、新しい人は作る）。time は待機の動きの時刻（足・首は前に呼んだ time からの差で進める）。
     * placeLabels を false にすると名札は動かさない（演出の時計は探索の描画の後に進むので、ここで名札を動かすと、
     * 描いた画（前の形）より名札が先へ進んで見える。名札は描く直前の placeLabels で置く：explore/world.ts の frame）。
     * hero は主人公の位置（店の人の会釈・目を向ける。演出の間など、渡さなければしない）。
     */
    setPeople(list: readonly ActorPersonState[], time: number, camera: THREE.Camera, placeLabels = true, hero: { x: number; z: number } | null = null): void {
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
            // 画面の外（影の分を足す）・遠い人・カメラが中に入る人は描かない
            sphere.center.set(p.x, gy + 1, p.z);
            sphere.radius = 3.0;
            const dCam = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
            const inside = dCam < NEAR_HIDE && camera.position.y < gy + 2.1;
            const vis = this.frustum.intersectsSphere(sphere) && dCam < PEOPLE_FAR && !inside;
            root.visible = vis;
            if (vis) {
                drawn++;
                this.pose(a, p, time, hero);
            } else a.shown = false;
            if (a.bale) a.bale.visible = vis && !!p.carrying;
            a.showLabel = vis && p.label;
        }
        this.peopleDrawn = drawn;
        if (placeLabels) this.placeLabels(camera);
    }

    /**
     * 名札を頭の上へ（描く直前に呼ぶ：演出の時計は探索の描画と別の時に進むので、描いた画と名札がずれないように、描く前にもう一度置く）。
     * 名札どうしが重なるときは、カメラに近い人の名札をそのままにし、遠い人の名札を上へずらす（互い違い。2 人の使者が並んで来る画）。
     */
    placeLabels(camera: THREE.Camera): void {
        const { w, h } = this.viewSize();
        const shown: { el: HTMLElement; x: number; y: number; depth: number }[] = [];
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
            if (on) shown.push({ el: a.label, x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, depth: tmpV.z });
        }
        shown.sort((p, q) => p.depth - q.depth);
        const placed = stackLabels(shown.map((s) => ({ x: s.x, y: s.y, w: labelWidth(s.el), h: labelHeight(s.el) })));
        shown.forEach((s, i) => {
            s.el.style.transform = `translate(${s.x.toFixed(1)}px, ${placed[i]!.toFixed(1)}px) translate(-50%, -100%)`;
        });
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

    /**
     * 担ぐ俵の形（中心が原点、長さは z に沿う。半径・長さは BALE）。町の小物の俵（props28.glb の tawara。小物の中の座標で長さは x に沿い
     * 長さ 0.81 m・縄を含む半径 0.256 m、地面に置いた形で中心の高さ 0.248 m）を回して縮める。町の小物を読む前は色だけの筒
     */
    private makeBale(): THREE.Object3D {
        const src = townPropModel('tawara');
        if (!src) {
            const m = new THREE.Mesh(this.baleGeo, this.baleMat);
            m.rotation.x = Math.PI / 2;
            m.castShadow = !this.low;
            return m;
        }
        const k = BALE.r / 0.256;
        src.rotation.y = Math.PI / 2;
        src.scale.set(BALE.len / 0.81, k, k);
        src.position.y = -0.248 * k;
        src.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.castShadow = !this.low;
        });
        const g = new THREE.Group();
        g.name = 'bale';
        g.add(src);
        return g;
    }

    /** 人物の素材を読み終えた：代わりの形の人を作り直す（次の setPeople で） */
    resetPeople(): void {
        for (const [k, a] of this.people) this.remove(k, a);
    }

    get peopleCount(): number {
        return this.people.size;
    }

    private add(p: ActorPersonState): ActorPerson {
        const body = this.factory.make(p.look, { walk: true, rhythm: rhythmOf(p.key) });
        let bale: THREE.Object3D | null = null;
        if (p.carrying !== undefined) {
            // 肩に担ぐ俵（右肩の骨に付ける：休みの形では骨は回っていないので、骨の中の向きは人物の向きと同じ。人物の前後に長い）。
            // 肩の上の少し外に載せ、頭に重ならない（BALE）。形は町の小物の俵（makeBale）
            bale = this.makeBale();
            bale.visible = false;
            const shoulder = body.bones.get('RightShoulder');
            if (shoulder) {
                bale.position.set(...BALE.at);
                shoulder.add(bale);
            } else {
                bale.position.set(-0.29, 1.52, -0.06);
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
        const lb = body.standIn ? null : legBones(body.bones);
        const a: ActorPerson = {
            key: p.key,
            look: p.look,
            body,
            bale,
            label,
            showLabel: false,
            legs: lb ? new HeroLegs(body.root, lb, body.root.children[0]?.scale.x || 1) : null,
            gaze: body.standIn ? null : Gaze.from(body.bones),
            lastT: null,
            lastX: p.x,
            lastZ: p.z,
            shown: false,
            bowAt: null,
            lastBow: null,
            heroNear: false,
        };
        this.people.set(p.key, a);
        return a;
    }

    /**
     * 1 人の形：動きの元（待機・歩き。人ごとの拍子）→ 足（IK）→ 上体の動き（仕事・前かがみ・会釈・俵を支える右手）→ 首と頭の向き。
     * 足と首は前のコマからの続き。時刻が戻った・飛んだ・1 m 以上動いた・前のコマで見えていなかったときは、その場で合わせ直す
     */
    private pose(a: ActorPerson, p: ActorPersonState, time: number, hero: { x: number; z: number } | null): void {
        posePerson(a.body, time, p.walked, p.moving, rhythmOf(p.key), p.run ?? 0, p.cycle);
        let dt = a.lastT === null ? -1 : time - a.lastT;
        const fresh = !a.shown || !(dt >= 0 && dt < RESET_DT) || Math.hypot(p.x - a.lastX, p.z - a.lastZ) > RESET_MOVE;
        if (fresh) dt = 0;
        a.lastT = time;
        a.lastX = p.x;
        a.lastZ = p.z;
        a.shown = true;
        // 足：着いた足を地面に止める・IK・踏み替え（動きの元の脚の形から。上体の動きは脚に関わらない）
        if (a.legs) {
            if (fresh) a.legs.reset();
            a.legs.update({ dt, move: p.moving, ground: groundY });
        }
        const bow = Math.max(this.greet(a, p, time, hero), p.act?.bow ?? 0);
        const bones = a.body.bones;
        applyAct(bones, p.act, bow);
        if (p.carrying && a.bale) {
            a.body.root.updateMatrixWorld(true);
            holdBale(bones);
        }
        // 片膝（急報の使者）：足の IK の後に、骨の形で（腰を下げて前の脚の膝を立て、後ろの脚の膝を地面へ）
        if ((p.act?.kneel ?? 0) > 0) applyKneel(bones, p.act!.kneel!);
        // 首と頭：会釈の相手（近くを通る主人公）・通りを見る所（仕事）。無ければ正面
        if (a.gaze) {
            const near = hero && p.greet && Math.hypot(hero.x - p.x, hero.z - p.z) < GREET_LOOK && facing(p, hero) && !((p.act?.lean ?? 0) > 0.15);
            if (near) a.gaze.lookAt({ x: hero.x, y: groundY(hero.x, hero.z) + 1.5, z: hero.z }, 0.9);
            else if (p.act?.look && p.act.lookWeight > 0) a.gaze.lookAt({ x: p.act.look.x, y: groundY(p.act.look.x, p.act.look.z) + p.act.look.y, z: p.act.look.z }, p.act.lookWeight);
            else a.gaze.lookAt(null);
            if (fresh) a.gaze.snap();
            else a.gaze.update(dt);
        }
    }

    /** 店の人の会釈：主人公が 3 m の内へ入ったとき（こちらを向いている・品物を整えていない・前の会釈から 8 秒たった）に 1 回。返りは会釈の重み */
    private greet(a: ActorPerson, p: ActorPersonState, time: number, hero: { x: number; z: number } | null): number {
        if (!p.greet || !hero) {
            a.heroNear = false;
            a.bowAt = null;
            return 0;
        }
        const near = Math.hypot(hero.x - p.x, hero.z - p.z) < GREET_DIST;
        if (a.bowAt !== null && (time < a.bowAt || time - a.bowAt > BOW_SEC)) a.bowAt = null;
        const free = !((p.act?.lean ?? 0) > 0.15);
        if (near && !a.heroNear && free && facing(p, hero) && (a.lastBow === null || time < a.lastBow || time - a.lastBow > GREET_AGAIN)) {
            a.bowAt = time;
            a.lastBow = time;
        }
        a.heroNear = near;
        return a.bowAt === null ? 0 : bowWeight(time - a.bowAt);
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

/** 名札の幅（描かれていれば実際の幅。無ければ字数からの見積もり：12px の字・字の間・左右の余白） */
function labelWidth(el: HTMLElement): number {
    const w = el.offsetWidth;
    return typeof w === 'number' && w > 0 ? w : [...(el.textContent ?? '')].length * 12.8 + 20;
}
function labelHeight(el: HTMLElement): number {
    const v = el.offsetHeight;
    return typeof v === 'number' && v > 0 ? v : 22;
}

/**
 * 名札の下の端の y を決める（並びは近い順。前の札と重なる札は、重なった札の上へ 3px あけて上げる。純粋）。
 * 札の箱は x の真ん中・下の端 y・幅 w・高さ h。返りは札ごとの下の端の y。
 */
export function stackLabels(list: readonly { x: number; y: number; w: number; h: number }[]): number[] {
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    return list.map((l) => {
        let y = l.y;
        for (let guard = 0; guard < list.length + 1; guard++) {
            const x0 = l.x - l.w / 2;
            const x1 = l.x + l.w / 2;
            const hit = boxes.find((b) => x0 < b.x1 && x1 > b.x0 && y - l.h < b.y1 && y > b.y0);
            if (!hit) break;
            y = hit.y0 - 3;
        }
        boxes.push({ x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0: y - l.h, y1: y });
        return y;
    });
}

/** 主人公が、その人の前（左右 100° の内）にいるか（会釈・目を向けるのは前にいるときだけ） */
function facing(p: { x: number; z: number; heading: number }, hero: { x: number; z: number }): boolean {
    const dx = hero.x - p.x;
    const dz = hero.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return true;
    return (Math.sin(p.heading) * dx + Math.cos(p.heading) * dz) / d > Math.cos((100 * Math.PI) / 180);
}

/** 骨を局所の軸 axis まわりに a だけ回す（動きの元の回りの後に足す） */
function turnBone(bones: Map<string, THREE.Bone>, name: string, axis: THREE.Vector3, a: number): void {
    const b = bones.get(name);
    if (b && a) b.quaternion.multiply(tmpQ.setFromAxisAngle(axis, a));
}

/**
 * 上体の動き（rhythm.ts の PersonAct）と会釈（重み bow）を、動きの元で置いた骨に足す。
 * 前かがみ：背骨・胸・首を前へ（lean 1 で約 27°。会釈は約 30°）。手：両腕を前へ出して、左右で少しずらして動かす（品物を整える・荷に手をかける）。
 * 会釈の間は仕事の形を弱める（会釈を優先）
 */
function applyAct(bones: Map<string, THREE.Bone>, act: PersonAct | undefined, bow: number): void {
    const lean = (act?.lean ?? 0) * (1 - bow);
    const hands = (act?.hands ?? 0) * (1 - bow);
    if (lean <= 0 && hands <= 0 && bow <= 0) return;
    turnBone(bones, 'Spine', X, 0.26 * lean + 0.3 * bow);
    turnBone(bones, 'Chest', X, 0.12 * lean + 0.08 * bow);
    turnBone(bones, 'Neck', X, 0.1 * lean + 0.14 * bow);
    if (hands <= 0) return;
    const ph = act?.handPhase ?? 0;
    for (const [side, s] of [
        ['Left', 1],
        ['Right', -1],
    ] as const) {
        // 腕を前へ（局所の x 軸まわりの負が前）・内へ（左腕は z 軸まわりの負、右腕は正）、肘を曲げる
        const w = Math.sin(ph + (s > 0 ? 0 : 1.7));
        turnBone(bones, `${side}UpperArm`, X, -(0.7 + 0.12 * w) * hands);
        turnBone(bones, `${side}UpperArm`, Z, -s * 0.16 * hands);
        turnBone(bones, `${side}ForeArm`, X, -(0.55 + 0.18 * Math.sin(ph * 1.3 + s)) * hands);
    }
}

const kq = (x: number, z = 0) => new THREE.Quaternion().setFromAxisAngle(X, x).multiply(new THREE.Quaternion().setFromAxisAngle(Z, z));
/**
 * 片膝をつく形（hero_v2 の骨：休みの形では骨はすべて回転なし、脚は下向き。world.ts の腰掛けた形と同じ考え方）。
 * 腰を 0.5 m へ下げ、左の脚は太ももを前へ・すねを下へ（膝を立てる）、右の脚は太ももを下へ・すねを後ろへ（膝を地面へ。足先を立てる）。
 * 上体は少し前へ、頭を下げ（顔と目線は後で game/gaze.ts が話し相手へ向ける）、左手は左の膝へ、右の拳は体の脇へ下ろす。縮めない（骨の形だけ）
 */
export const KNEEL = {
    hipsY: 0.5,
    bones: {
        LeftUpperLeg: kq(-1.42),
        LeftLowerLeg: kq(1.48),
        LeftFoot: kq(0),
        RightUpperLeg: kq(0.12),
        RightLowerLeg: kq(1.52),
        RightFoot: kq(0.1),
        Spine: kq(0.22),
        Chest: kq(0.06),
        Neck: kq(0.3),
        LeftUpperArm: kq(-0.6, -0.2),
        LeftForeArm: kq(-0.7),
        RightUpperArm: kq(-0.12, 0.18),
        RightForeArm: kq(-0.35),
    } as Record<string, THREE.Quaternion>,
};
function applyKneel(bones: Map<string, THREE.Bone>, w: number): void {
    const k = Math.max(0, Math.min(1, w));
    const hips = bones.get('Hips');
    if (hips) hips.position.y += (KNEEL.hipsY - hips.position.y) * k;
    for (const [name, q] of Object.entries(KNEEL.bones)) bones.get(name)?.quaternion.slerp(q, k);
}

/** 俵を支える右手：右腕の 2 本の骨（上腕・前腕）を、手首が俵の前の下（BALE_HAND）へ届くように回す。肘は外・下・少し後ろへ */
function holdBale(bones: Map<string, THREE.Bone>): void {
    const sh = bones.get('RightShoulder');
    const up = bones.get('RightUpperArm');
    const fo = bones.get('RightForeArm');
    const ha = bones.get('RightHand');
    if (!sh || !up || !fo || !ha) return;
    sh.updateMatrixWorld(true);
    const target = tmpV.copy(BALE_HAND).applyMatrix4(sh.matrixWorld);
    const pole = tmpV2.set(-1, -0.7, -0.5).normalize().transformDirection(sh.matrixWorld);
    reach(up, fo, ha, target, pole);
}

/** 2 本の骨の IK（a の根 → b の根 → c の根）：c の根を target へ。曲がる関節は pole（世界の向き）の側へ */
function reach(a: THREE.Bone, b: THREE.Bone, c: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
    a.updateMatrixWorld(true);
    const pa = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
    const pb = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const pc = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const l1 = pa.distanceTo(pb);
    const l2 = pb.distanceTo(pc);
    const d = target.clone().sub(pa);
    const len = d.length();
    if (len < 1e-6 || l1 < 1e-6 || l2 < 1e-6) return;
    const dn = d.divideScalar(len);
    const dist = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(len, (l1 + l2) * 0.999));
    const pl = pole.clone().addScaledVector(dn, -pole.dot(dn));
    if (pl.lengthSq() < 1e-10) return;
    pl.normalize();
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const mid = pa.clone().addScaledVector(dn, along).addScaledVector(pl, h);
    rotateBoneWorld(a, pb.clone().sub(pa).normalize(), mid.sub(pa).normalize());
    a.updateMatrixWorld(true);
    const nb = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const nc = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    rotateBoneWorld(b, nc.sub(nb).normalize(), target.clone().sub(nb).normalize());
    b.updateMatrixWorld(true);
}

/** 骨を世界で from → to の向きへ回す（その骨の局所の回転を書き換える。game/legs.ts と同じ） */
function rotateBoneWorld(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const parentWorld = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    bone.quaternion.copy(parentWorld.invert().multiply(delta.multiply(world)));
}
