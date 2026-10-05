/**
 * 探索の場面の中の章のもの（three）：家臣・使者の人物、高札、城門の出陣の印、物見櫓の札、頭の上の名前。
 * 物語の見せ方の口も持つ：演出の 3D の出来事（stage）・町の人々（setAmbient）・物見の眺め（startLookout）・軍議所を映す（showCouncilHall）。
 * campaign/game.ts の GameWorld を満たす。置く場所と誰が居るかは explore/cast.ts（純粋）が決める。
 *
 * 見た目は暫定：人物は既存の主人公の素材（hero_v2.glb。GLB／公開用の JSON の読み込みは main.ts のまま）を複製し、
 * 着物・髪の色だけを変える（explore/people.ts）。新しい素材は作らない。
 * 負傷した人物は、床几（簡単な箱）に腰掛けた姿勢にする（骨の向きを直接決める）。
 * 出来事・町の人々の置き方は純粋な関数（explore/stage.ts・explore/ambient.ts）、描くのは explore/actors.ts。
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameWorld } from '../campaign/game';
import type { ExplorePose } from '../campaign/state';
import type { HeroState } from '../game/motion';
import { colliders, groundY, type Rect } from '../layout';
import type { AmbientSpec, ScoutPoint, StageEvent } from '../story/types';
import { HeldKeys } from '../ui/guard';
import { ActorLayer } from './actors';
import { AMBIENT_FIGURES_MAX, ambientPlan, walkerAt, type AmbientPlan } from './ambient';
import { castColliders, headingToward, type CastMember } from './cast';
import { LookoutSession, type LookoutProbe } from './lookout';
import { PersonFactory, hashOf } from './people';
import { stageFrame, type StageCastInfo, type StageShot } from './stage';
import { setTowerTopVisible } from '../town/view';
import './town.css';

/** カメラの差し替え（決めた位置から決めた点を見る。hideHero なら主人公を描かない） */
export type CameraShot = StageShot & { hideHero?: boolean };

/** main.ts（探索）が渡すもの */
export interface ExploreHost {
    scene: THREE.Scene;
    camera: THREE.Camera;
    /** 名前の札を置く入れ物（#app） */
    overlay: HTMLElement;
    hero: HeroState;
    /** 画質「低」（影を落とさない） */
    low: boolean;
    load(name: string): Promise<GLTF>;
    prepare(obj: THREE.Object3D): void;
    /** 主人公をその位置・向きに立たせ、カメラを背後へ */
    setHeroPose(p: ExplorePose): void;
    /** 探索の操作を許す／止める（止めるときは入力を離す） */
    setControl(enabled: boolean): void;
    /** 探索の描画を止める／戻す（画面を覆うものが開いている間） */
    setRenderPaused(paused: boolean): void;
    /** 歩きの当たり判定に足す四角形（人物・高札） */
    setExtraColliders(r: Rect[]): void;
    /** 毎フレーム（探索の間だけ。カメラを置いた後・描く前） */
    onFrame(fn: (dt: number) => void): void;
    viewSize(): { w: number; h: number };
    /** 肩越しのカメラの向き（演出の後に始める前の向きへ戻す） */
    orbit: { yaw: number; pitch: number; dist: number };
    /** カメラの差し替え（演出の出来事・物見・軍議所）。すぐにカメラを置く。null で主人公の背後のカメラへ戻す。影の範囲も見ている所へ */
    setCameraShot(shot: CameraShot | null): void;
    /** 今のカメラで 1 コマ描く（探索の描画を止める画面を重ねる前に。確認用の手動の描画のときは描かない） */
    renderOnce(): void;
    /** 見回しの面のドラッグを受け取る（物見の間。探索の操作を止めていても渡す）。null で戻す */
    setLookHandler(fn: ((dx: number, dy: number) => void) | null): void;
}

const NPC_MODEL = 'hero_v2';

interface NpcView {
    member: CastMember<string>;
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
    bones: Map<string, THREE.Bone>;
    heading: number;
    targetHeading: number;
    label: HTMLElement;
    labelY: number;
}

/** 軍議所を映すカメラ（陣幕の西の外、幕の上から床几と机を見下ろす） */
export const COUNCIL_SHOT: CameraShot = { px: 7.3, py: 3.7, pz: -22.3, tx: 13.4, ty: 0.5, tz: -22.9, hideHero: false };

const tmp = new THREE.Vector3();
const sphere = new THREE.Sphere();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class ExploreWorld implements GameWorld {
    private base: GLTF | null = null;
    private baseFailed = false;
    private loading: Promise<void> | null = null;
    private cast: CastMember<string>[] = [];
    private readonly views = new Map<string, NpcView>();
    private readonly group = new THREE.Group();
    private readonly labels: HTMLElement;
    private readonly stageLabels: HTMLElement;
    private readonly wallRects = colliders();
    private readonly people: PersonFactory;
    private readonly stageActors: ActorLayer;
    private readonly ambientActors: ActorLayer;
    private readonly frustum = new THREE.Frustum();
    private readonly pv = new THREE.Matrix4();
    private readonly keys = new HeldKeys();
    private time = 0;
    // ---- 演出の出来事
    private stageKey: string | null = null;
    private stageT = 0;
    private stageBefore: { pose: ExplorePose; orbit: { yaw: number; pitch: number; dist: number } } | null = null;
    private hiddenCast = new Set<string>();
    private hiddenAmbient = new Set<string>();
    // ---- 町の人々
    private ambient: AmbientSpec | null = null;
    private plan: AmbientPlan = ambientPlan(null);
    private ambientTime = 0;
    // ---- カメラの差し替え（強い順：出来事・物見・軍議所）
    private stageShot: CameraShot | null = null;
    private lookoutShot: CameraShot | null = null;
    private councilShot: CameraShot | null = null;
    private appliedShot: CameraShot | null = null;
    private lookout: LookoutSession | null = null;

    constructor(private readonly host: ExploreHost) {
        this.group.name = 'chapter-cast';
        host.scene.add(this.group);
        this.labels = document.createElement('div');
        this.labels.id = 'npc-labels';
        host.overlay.appendChild(this.labels);
        // 演出の人の名札（演出の 3D の場面の間だけ見える：body.g-cine-stage）
        this.stageLabels = document.createElement('div');
        this.stageLabels.id = 'stage-labels';
        host.overlay.appendChild(this.stageLabels);
        this.people = new PersonFactory((o) => host.prepare(o), host.low);
        this.stageActors = new ActorLayer('stage', this.people, this.stageLabels, () => host.viewSize(), 40, host.low);
        this.ambientActors = new ActorLayer('ambient', this.people, null, () => host.viewSize(), AMBIENT_FIGURES_MAX, host.low);
        host.scene.add(this.stageActors.group, this.ambientActors.group);
        // 物見の眺めで「出る前から押さえていたキー」を見分けるため、押しているキーを覚えておく
        window.addEventListener('keydown', (e) => this.keys.down(e.code, e.repeat), true);
        window.addEventListener('keyup', (e) => this.keys.up(e.code), true);
        window.addEventListener('blur', () => this.keys.clear());
    }

    /** 人物の素材を読む（読めなければ簡単な形で代わりに立てる：ゲームは進められる） */
    preload(): Promise<void> {
        this.loading ??= this.host
            .load(NPC_MODEL)
            .then((g) => {
                this.base = g;
                this.people.setBase(g);
            })
            .catch((e: unknown) => {
                console.error('人物の素材を読み込めませんでした（簡単な形で代わりに立てます）', e);
                this.baseFailed = true;
            })
            .then(() => {
                // 読み込みの前に置くよう頼まれていた人物を作り直す
                const c = this.cast;
                this.clear();
                this.build(c);
                this.stageActors.resetPeople();
                this.ambientActors.resetPeople();
            });
        return this.loading;
    }

    get ready(): boolean {
        return !!this.base || this.baseFailed;
    }

    // ---------------- GameWorld ----------------

    setCast(cast: CastMember<string>[]): void {
        // タイトル・合戦（相手が誰もいない）：物見の眺めの途中なら終わらせる
        if (cast.length === 0) this.lookout?.cancel();
        // 同じ相手・同じ姿勢・同じ場所なら作り直さない
        const same =
            cast.length === this.cast.length &&
            cast.every((c, i) => {
                const o = this.cast[i]!;
                return o.id === c.id && o.pose === c.pose && o.x === c.x && o.z === c.z && o.key === c.key && o.look === c.look;
            });
        if (same) return;
        this.clear();
        this.build(cast);
    }

    heroPose(): ExplorePose {
        const h = this.host.hero;
        return { x: h.x, z: h.z, heading: h.heading };
    }

    setHeroPose(p: ExplorePose): void {
        this.host.setHeroPose(p);
    }

    setControl(enabled: boolean): void {
        this.host.setControl(enabled);
    }

    faceTalk(id: string): void {
        const v = this.views.get(id);
        const h = this.host.hero;
        const m = v?.member ?? this.cast.find((c) => c.id === id);
        if (!m) return;
        if (v && m.kind === 'person' && m.pose === 'stand') v.targetHeading = headingToward(m.x, m.z, h.x, h.z);
        // 主人公も相手の方を向く（城門はそのまま）
        if (m.kind !== 'gate') {
            h.heading = headingToward(h.x, h.z, m.x, m.z);
            h.dirX = Math.sin(h.heading);
            h.dirZ = Math.cos(h.heading);
        }
    }

    walls(): Rect[] {
        return this.wallRects;
    }

    // ---------------- 物語の見せ方の口 ----------------

    /**
     * 演出の 3D の出来事を時刻 t の形に置く（同じ t なら同じ形）。出来事が変わったら前の物を片付けて置き直す。
     * null：出した人・兵を片付け、カメラの差し替えを外し、主人公の位置・向き・見回しを始める前の物に戻す（何度呼んでもよい）。
     */
    stage(ev: StageEvent | null, t: number, reduced: boolean): void {
        if (!ev) {
            this.endStage();
            return;
        }
        // 物見の途中には出来事は来ない（来たら物見を終わらせる）
        this.lookout?.cancel();
        const key = JSON.stringify(ev);
        if (key !== this.stageKey) {
            if (this.stageKey) this.stageActors.clear();
            this.stageKey = key;
            if (!this.stageBefore) this.stageBefore = { pose: this.heroPose(), orbit: { ...this.host.orbit } };
        }
        this.stageT = t;
        const f = stageFrame(ev, t, reduced, this.castInfo());
        this.setHiddenCast(f.hideCast);
        this.hiddenAmbient = new Set(f.hideAmbient);
        this.stageShot = { ...f.shot, hideHero: true };
        this.applyShot();
        const cam = this.host.camera;
        this.stageActors.setPeople(f.people, t, cam);
        this.stageActors.setFigures(f.figures, f.banners, f.litters, t, cam);
    }

    private endStage(): void {
        if (!this.stageKey && !this.stageBefore && !this.stageShot) return;
        this.stageActors.clear();
        this.stageKey = null;
        this.setHiddenCast([]);
        this.hiddenAmbient = new Set();
        this.stageShot = null;
        const before = this.stageBefore;
        this.stageBefore = null;
        if (before) {
            // 主人公を始める前の位置・向きへ（カメラの見回しも始める前の向きへ）
            this.host.setHeroPose(before.pose);
            Object.assign(this.host.orbit, before.orbit);
        }
        this.appliedShot = null;
        this.applyShot(true);
    }

    /** 町の人々（見た目だけ。null で消す）。同じ中身なら置き直さない */
    setAmbient(spec: AmbientSpec | null): void {
        if (JSON.stringify(spec) === JSON.stringify(this.ambient)) return;
        this.ambient = spec;
        this.plan = ambientPlan(spec);
        if (!spec) this.ambientActors.clear();
        else this.updateAmbient(this.host.camera);
    }

    /**
     * 物見の眺め（物見櫓の上から見回して印を調べる）。返りは調べた印の id の並び（やめれば []）。
     * 演出の出来事の途中・物見の途中には始めない。終わればカメラと見回しの操作を戻す（主人公は動かさない）。
     */
    startLookout(point: ScoutPoint, reduced: boolean): Promise<string[]> {
        if (this.stageKey || this.lookout?.active) return Promise.resolve([]);
        const { w, h } = this.host.viewSize();
        const session = new LookoutSession(
            {
                overlay: this.host.overlay,
                camera: this.host.camera,
                setCameraShot: (s) => {
                    this.lookoutShot = s;
                    this.applyShot();
                },
                setLookHandler: (fn) => this.host.setLookHandler(fn),
                project: (x, y, z) => {
                    tmp.set(x, y, z).project(this.host.camera);
                    if (tmp.z <= -1 || tmp.z >= 1 || Math.abs(tmp.x) > 1.02 || Math.abs(tmp.y) > 1.02) return null;
                    const vs = this.host.viewSize();
                    return { x: (tmp.x * 0.5 + 0.5) * (vs.w || w), y: (-tmp.y * 0.5 + 0.5) * (vs.h || h) };
                },
                now: () => performance.now(),
            },
            point,
            reduced,
            this.keys,
        );
        this.lookout = session;
        // 櫓の屋根の柱が目の前をふさがないように、眺めの間は屋根を描かない
        setTowerTopVisible(this.host.scene, false);
        return session.done.finally(() => {
            if (this.lookout === session) this.lookout = null;
            this.lookoutShot = null;
            setTowerTopVisible(this.host.scene, true);
            this.applyShot(true);
        });
    }

    /** 軍議所を映す（on）／戻す（off）。軍議の画面が重なると描画が止まるので、映したら 1 コマ描いておく */
    showCouncilHall(on: boolean): void {
        this.councilShot = on ? COUNCIL_SHOT : null;
        this.applyShot(true);
        if (on) this.host.renderOnce();
    }

    /** カメラの差し替えを決める（強い順：出来事・物見・軍議所。無ければ主人公の背後のカメラ） */
    private applyShot(force = false): void {
        const s = this.stageShot ?? this.lookoutShot ?? this.councilShot;
        if (!force && s === this.appliedShot && s === null) return;
        this.appliedShot = s;
        this.host.setCameraShot(s);
    }

    // ---------------- 作る・消す ----------------

    private clear(): void {
        for (const v of this.views.values()) {
            this.group.remove(v.root);
            v.mixer?.stopAllAction();
            v.label.remove();
        }
        this.views.clear();
        this.cast = [];
        this.host.setExtraColliders([]);
    }

    private build(cast: CastMember<string>[]): void {
        this.cast = cast.slice();
        this.host.setExtraColliders(castColliders(cast));
        for (const m of cast) {
            let v: NpcView | null = null;
            if (m.kind === 'person') v = this.makePerson(m);
            else if (m.kind === 'notice') v = this.makeStatic(m, makeNoticeBoard(), 2.3);
            // 物見櫓は町の配置の櫓（town/plan.ts）。ここは名前の札だけ
            else if (m.kind === 'lookout') v = this.makeStatic(m, new THREE.Group(), 2.4);
            else v = this.makeStatic(m, makeGateMark(m), 3.2);
            if (v) this.views.set(m.id, v);
        }
        // 出来事の途中に人物を置き直した：隠す人物はそのまま隠す
        this.setHiddenCast([...this.hiddenCast]);
    }

    private makeLabel(m: CastMember<string>): HTMLElement {
        const l = document.createElement('div');
        l.className = `npc-label${m.key ? ' key' : ''}${m.kind === 'gate' ? ' gate' : ''}${m.kind === 'lookout' ? ' lookout' : ''}`;
        l.textContent = m.label;
        l.dataset.id = m.id;
        this.labels.appendChild(l);
        return l;
    }

    private makeStatic(m: CastMember<string>, obj: THREE.Object3D, labelY: number): NpcView {
        obj.position.set(m.x, groundY(m.x, m.z), m.z);
        obj.rotation.y = m.heading;
        this.group.add(obj);
        return { member: m, root: obj, mixer: null, bones: new Map(), heading: m.heading, targetHeading: m.heading, label: this.makeLabel(m), labelY };
    }

    private makePerson(m: CastMember<string>): NpcView | null {
        if (!this.ready) {
            // 素材を読み終えたら作る（preload の最後で作り直す）。名前の札だけは先に出さない
            void this.preload();
            return null;
        }
        const p = this.people.make(m.look ?? 'genzo', { idlePhase: (hashOf(m.id) % 1000) / 1000 });
        const root = p.root;
        if (m.pose === 'sit') root.add(makeStool());
        root.position.set(m.x, groundY(m.x, m.z), m.z);
        root.rotation.y = m.heading;
        this.group.add(root);
        const v: NpcView = { member: m, root, mixer: p.mixer, bones: p.bones, heading: m.heading, targetHeading: m.heading, label: this.makeLabel(m), labelY: m.pose === 'sit' ? 1.65 : 2.05 };
        if (p.mixer) {
            p.mixer.update(0);
            if (m.pose === 'sit') sitPose(p.bones);
        }
        return v;
    }

    /** 出来事の間だけ隠す人物（同じ人が歩いて来る） */
    private setHiddenCast(ids: readonly string[]): void {
        this.hiddenCast = new Set(ids);
    }

    /** 出来事の行き先を決めるための、置いている相手の見た目と場所 */
    private castInfo(): StageCastInfo[] {
        return this.cast.map((c) => ({ id: c.id, kind: c.kind, ...(c.look ? { look: c.look } : {}), x: c.x, z: c.z, heading: c.heading }));
    }

    // ---------------- 毎フレーム ----------------

    frame(dt: number): void {
        this.time += dt;
        this.ambientTime += dt;
        this.lookout?.frame();
        const h = this.host.hero;
        const { w, h: vh } = this.host.viewSize();
        const cam = this.host.camera;
        cam.updateMatrixWorld();
        this.pv.multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.pv);
        for (const v of this.views.values()) {
            const m = v.member;
            const hidden = this.hiddenCast.has(m.id);
            // 画面の外（影の届く分を足す）の人物は描かない。出来事の間に隠す人物も
            let vis = !hidden;
            if (vis && v.mixer) {
                sphere.center.set(m.x, groundY(m.x, m.z) + 1, m.z);
                sphere.radius = 3.0;
                vis = this.frustum.intersectsSphere(sphere);
            }
            v.root.visible = vis;
            if (v.mixer) {
                // 話しかけられたら相手の方へ向き直る（ゆっくり）
                const d = wrap(v.targetHeading - v.heading);
                if (Math.abs(d) > 1e-3) {
                    v.heading = wrap(v.heading + d * (1 - Math.exp(-6 * dt)));
                    v.root.rotation.y = v.heading;
                }
                // 見えない人物は動きを進めない（描かないので）
                if (vis) {
                    v.mixer.update(dt);
                    if (m.pose === 'sit') sitPose(v.bones);
                }
            }
            if (m.kind === 'gate') {
                const ring = v.root.getObjectByName('gate-ring') as THREE.Mesh | undefined;
                if (ring) (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(this.time * 3);
            }
            // 名前の札：頭の上。遠い・画面の外・カメラの後ろでは出さない
            tmp.set(m.x, groundY(m.x, m.z) + v.labelY, m.z).project(cam);
            const dist = Math.hypot(m.x - h.x, m.z - h.z);
            const show = !hidden && tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && dist < 26;
            if (!show) {
                if (!v.label.hidden) v.label.hidden = true;
                continue;
            }
            v.label.hidden = false;
            const sx = (tmp.x * 0.5 + 0.5) * w;
            const sy = (-tmp.y * 0.5 + 0.5) * vh;
            v.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
            v.label.classList.toggle('far', dist > 12);
        }
        if (this.ambient) this.updateAmbient(cam);
        // 演出の人の名札：描く直前のカメラで置き直す（演出の時計は探索の描画と別の時に進む）
        if (this.stageKey) this.stageActors.placeLabels(cam);
    }

    /** 町の人々を今の時計の形に置く（出来事が同じ所に同じ人々を出している間は、その種類を隠す） */
    private updateAmbient(cam: THREE.Camera): void {
        const hide = this.hiddenAmbient;
        const people = this.plan.walkers.filter((w) => !hide.has(w.role)).map((w) => walkerAt(w, this.ambientTime));
        this.ambientActors.setPeople(people, this.ambientTime, cam);
        const figs = hide.size ? this.plan.figures.filter((f) => !hide.has(f.kind)) : this.plan.figures;
        const bans = hide.size ? this.plan.banners.filter((b) => !hide.has(b.kind)) : this.plan.banners;
        this.ambientActors.setFigures(figs, bans, [], this.ambientTime, cam);
    }

    /** 確認用：置いている人物（id・姿勢・場所） */
    probe(): { id: string; pose: string; x: number; z: number; model: boolean }[] {
        return [...this.views.values()].map((v) => ({ id: v.member.id, pose: v.member.pose, x: v.member.x, z: v.member.z, model: !!v.mixer }));
    }

    /** 確認用：演出の出来事（今の時刻・人・兵・隠している人物・カメラ） */
    stageProbe(): { active: boolean; event: string | null; t: number; people: number; figures: number; hiddenCast: string[]; hiddenAmbient: string[]; shot: CameraShot | null } {
        const ev = this.stageKey ? (JSON.parse(this.stageKey) as StageEvent) : null;
        return {
            active: !!this.stageKey,
            event: ev?.id ?? null,
            t: this.stageT,
            people: this.stageActors.peopleCount,
            figures: this.stageActors.troops.drawn,
            hiddenCast: [...this.hiddenCast],
            hiddenAmbient: [...this.hiddenAmbient],
            shot: this.appliedShot,
        };
    }

    /** 確認用：町の人々（人・兵の数と、直前に描いた数） */
    ambientProbe(): { spec: AmbientSpec | null; walkers: { key: string; role: string; x: number; z: number }[]; figures: number; peopleDrawn: number; figuresDrawn: number } {
        return {
            spec: this.ambient,
            walkers: this.plan.walkers.map((w) => {
                const p = walkerAt(w, this.ambientTime);
                return { key: w.key, role: w.role, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
            }),
            figures: this.plan.figures.length,
            peopleDrawn: this.ambientActors.peopleDrawn,
            figuresDrawn: this.ambientActors.troops.drawn,
        };
    }

    /** 確認用：物見の眺め（向き・印・押せるか。眺めていなければ null） */
    lookoutProbe(): LookoutProbe | null {
        return this.lookout?.probe() ?? null;
    }

    /** 確認用：物見の向きを直接決める（開発のみ。本物の入力の確かめには使わない） */
    lookoutDevFace(heading: number): boolean {
        if (!this.lookout) return false;
        this.lookout.devFace(heading);
        return true;
    }

    /** 確認用：カメラの差し替え（今のもの） */
    get cameraShot(): CameraShot | null {
        return this.appliedShot;
    }
}

const qx = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qz = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
/**
 * 腰掛けた姿勢（hero_v2 の骨：休みの形では骨はすべて回転なし、脚は下向き）。待機の動きの後に上書きする。
 * 太ももを前へ水平に、すねを下へ、腰を床几の高さへ。上体を少し前へ傾け、手を膝の上へ。
 */
const SIT = {
    hipsY: 0.52,
    upperLeg: qx(-Math.PI / 2 + 0.08),
    lowerLeg: qx(Math.PI / 2 - 0.02),
    spine: qx(0.16),
    neck: qx(0.18),
    upperArmL: qx(-0.45).multiply(qz(-0.22)),
    upperArmR: qx(-0.45).multiply(qz(0.22)),
    foreArm: qx(-0.75),
};
function sitPose(b: Map<string, THREE.Bone>): void {
    const hips = b.get('Hips');
    if (hips) hips.position.y = SIT.hipsY;
    b.get('LeftUpperLeg')?.quaternion.copy(SIT.upperLeg);
    b.get('RightUpperLeg')?.quaternion.copy(SIT.upperLeg);
    b.get('LeftLowerLeg')?.quaternion.copy(SIT.lowerLeg);
    b.get('RightLowerLeg')?.quaternion.copy(SIT.lowerLeg);
    b.get('LeftFoot')?.quaternion.identity();
    b.get('RightFoot')?.quaternion.identity();
    b.get('Spine')?.quaternion.copy(SIT.spine);
    b.get('Neck')?.quaternion.copy(SIT.neck);
    b.get('LeftUpperArm')?.quaternion.copy(SIT.upperArmL);
    b.get('RightUpperArm')?.quaternion.copy(SIT.upperArmR);
    b.get('LeftForeArm')?.quaternion.copy(SIT.foreArm);
    b.get('RightForeArm')?.quaternion.copy(SIT.foreArm);
}

const WOOD = new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.85 });
const PAPER = new THREE.MeshStandardMaterial({ color: '#d8cfb6', roughness: 0.95 });
const INK = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/** 床几（腰掛け。簡単な箱。暫定） */
function makeStool(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(box(0.46, 0.06, 0.36, WOOD, 0, 0.42, 0.02));
    for (const sx of [-1, 1]) g.add(box(0.05, 0.42, 0.3, WOOD, sx * 0.19, 0.21, 0.02));
    return g;
}

/** 高札（2 本の柱・板・小さな屋根。簡単な箱。暫定）。表（文字の面）は +z。向きは cast の heading で回す */
function makeNoticeBoard(): THREE.Object3D {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) g.add(box(0.1, 2.1, 0.1, WOOD, sx * 0.7, 1.05, 0));
    g.add(box(1.5, 0.75, 0.05, WOOD, 0, 1.45, 0.02));
    g.add(box(1.36, 0.62, 0.02, PAPER, 0, 1.45, 0.055));
    // 墨の行（札の文字の代わり）
    for (let i = 0; i < 5; i++) g.add(box(0.03, 0.46, 0.005, INK, -0.45 + i * 0.22, 1.45, 0.068));
    g.add(box(1.75, 0.05, 0.42, WOOD, 0, 1.92, 0.02));
    return g;
}

/** 城門の出陣の場所（地面の輪。人物の素材ではない印） */
function makeGateMark(m: CastMember<string>): THREE.Object3D {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(m.reach - 0.25, m.reach, 48),
        new THREE.MeshBasicMaterial({ color: '#e0b964', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.name = 'gate-ring';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.renderOrder = 2;
    g.add(ring);
    return g;
}
