/**
 * 探索の場面の中の章のもの（three）：家臣・使者の人物、高札、城門の出陣の印、物見櫓の札、頭の上の名前。
 * 物語の見せ方の口も持つ：演出の 3D の出来事（stage）・町の人々（setAmbient）・物見の眺め（startLookout）・軍議所を映す（showCouncilHall）。
 * campaign/game.ts の GameWorld を満たす。置く場所と誰が居るかは explore/cast.ts（純粋）が決める。
 *
 * 見た目は暫定：人物は既存の主人公の素材（hero_v2b.glb：hero_v2.glb と同じ形で、動きだけ Version 28 で作り直した写し。GLB／公開用の JSON の読み込みは main.ts のまま）を複製し、
 * 着物・髪の色だけを変える（explore/people.ts）。新しい素材は作らない。
 * 負傷した人物は、床几（簡単な箱）に腰掛けた姿勢にする（骨の向きを直接決める）。
 * 出来事・町の人々の置き方は純粋な関数（explore/stage.ts・explore/ambient.ts）、描くのは explore/actors.ts。
 * Version 28：立つ会話の相手も、出来事・町の人々と同じ描き方（explore/actors.ts の ActorLayer：足の IK・踏み替え・顔の向き）で描く。
 * 話しかけたときは、主人公も相手も 1 コマで回さず、0.3〜0.5 秒で向き直る（足を踏み替えて。相手は主人公の顔を見る）。
 * 町の急報（stage.ts の street_report）・第二章の冒頭の使いの急報（messenger_arrive の report）の使者・使い・家臣は会話の相手そのもの
 * （StagePerson.cast）：出来事の間も、出来事の後に話せる位置へ歩く間も、同じ人物（同じ見た目・同じ拍子・続く足）として描き、着いた所で
 * 入れ替えない。出陣（column_depart の order）の見送りの人も同じ（置き場所のまま隊列の方を向く。隠さない）。
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameWorld } from '../campaign/game';
import type { ExplorePose } from '../campaign/state';
import type { HeroState } from '../game/motion';
import { colliders, groundY, type Rect } from '../layout';
import type { AmbientSpec, ScoutPoint, StageEvent } from '../story/types';
import { HeldKeys } from '../ui/guard';
import { ActorLayer, stackLabels } from './actors';
import { AMBIENT_FIGURES_MAX, ambientColliders, ambientPlan, walkerAt, type AmbientPlan } from './ambient';
import { castColliders, headingToward, type CastMember } from './cast';
import { LookoutSession, type LookoutProbe } from './lookout';
import { PersonFactory } from './people';
import { NO_ACT, rhythmOf as rhythmOfId } from './rhythm';
import { afterWalkEnd, afterWalkers, stageFrame, type StageCastInfo, type StageHero, type StageOrigin, type StagePerson, type StageShot } from './stage';
import { setTowerTopVisible, townPropModel } from '../town/view';
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
    /**
     * 主人公をその位置・向きに立たせ、カメラを背後へ。keepCamera：見回しの向き・高さ・距離を変えない（演出の後に元の位置へ戻すとき。
     * Version 28：出来事の後に、出来事の前にプレイヤーが向けていたカメラへ戻す）
     */
    setHeroPose(p: ExplorePose, opts?: { keepCamera?: boolean }): void;
    /** 探索の操作を許す／止める（止めるときは入力を離す） */
    setControl(enabled: boolean): void;
    /** 探索の描画を止める／戻す（画面を覆うものが開いている間） */
    setRenderPaused(paused: boolean): void;
    /** 探索の描画を止めているか（省ける。無ければ止めていない扱い） */
    renderPaused?(): boolean;
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
    /**
     * 主人公の顔と目線（首・頭の骨）を見る点（世界）へ向ける。null で正面へ戻す（省ける。game/gaze.ts。限度・なめらかさはそちら）。
     * 会話の相手・演出の話し手を見るのに使う（Version 28 §4.4）
     */
    setHeroGaze?(p: { x: number; y: number; z: number } | null, weight?: number): void;
    /**
     * 主人公の見た目の動き（足・体の向き）の時計（省ける。main.ts の HeroClock：game/heroAnim.ts）。演出の出来事が主人公を立たせて動かしている間は、
     * 演出の時計の進み（秒。1 コマ 1 秒まで）を渡す。null で探索の時計（1 コマ 0.1 秒まで）へ戻す。位置・向きを演出の時計で決めるので、
     * 足・体の向きも同じ時計で動かす（探索の時計のままだと、遅いコマで着いた足を遠くに残して脚が横へ伸びた）
     */
    heroStageClock?(advance: number | null): void;
}

const NPC_MODEL = 'hero_v2b';

interface NpcView {
    member: CastMember<string>;
    /** 形（座った人物・高札・城門の印）。立つ人物は castActors が描くので空の入れ物 */
    root: THREE.Object3D;
    /** 座った人物の動き（立つ人物は castActors） */
    mixer: THREE.AnimationMixer | null;
    bones: Map<string, THREE.Bone>;
    /** 立つ人物（castActors が描く） */
    stander: boolean;
    heading: number;
    targetHeading: number;
    /** 向き直り（話しかけられた）：始めと終わりの向き・始めた時刻（this.time）・秒 */
    turn: { from: number; to: number; at: number; dur: number } | null;
    /** 今の位置（出来事の間・出来事の後の歩きの間は置き場所と違う。名札・案内の印はここ） */
    x: number;
    z: number;
    /** 出来事が動かしている（前のコマ）。外れたら置き場所へ戻す（飛ばしたとき） */
    driven: boolean;
    label: HTMLElement;
    labelY: number;
}

/** 町の急報の後の歩き（会話の相手の人物として、置き場所まで）：出来事・始めた時の主人公・始めた時刻（this.time）・場面の長さ */
interface Epilogue {
    ev: StageEvent;
    origin: StageOrigin;
    t0: number;
    end: number;
    /** 歩く人（会話の相手の id。今の段階の城下に居ない人は歩かない：見直し） */
    walkers: Set<string>;
    /** 確認用の話しかけで、歩きを終えて置き場所へ置いた人 */
    done: Set<string>;
}

/** 向き直りの秒（主人公 0.3〜0.5 秒。相手は少しゆっくり 0.4〜0.7 秒） */
const heroTurnSec = (d: number) => 0.3 + 0.2 * Math.min(1, Math.abs(d) / Math.PI);
const npcTurnSec = (d: number) => 0.4 + 0.3 * Math.min(1, Math.abs(d) / Math.PI);
const smooth = (v: number) => {
    const x = Math.max(0, Math.min(1, v));
    return x * x * (3 - 2 * x);
};

/**
 * 名札を出す距離（m）：目前の目的の相手（key）は遠くからでも（町の入口から城門の前まで約 20 m）、ほかの相手は近くだけ
 *（町の入口から北を見ると、城門の前の人物・高札の名札が一列に重なって読めなかった。Version 21）
 */
export const LABEL_FAR = { key: 40, other: 16 } as const;

/** 案内の印（目前の目的の相手）：画面の中なら名札の上の小さな ▼、画面の外・後ろなら画面の端に向きと名前。近づいて話せる所では出さない */
export interface GuideProbe {
    mode: 'over' | 'edge' | null;
    id: string | null;
    side: 'left' | 'right' | null;
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
    /** 立つ会話の相手（と、町の急報の間・後の同じ人物）。名前の鍵は会話の相手の id */
    private readonly castActors: ActorLayer;
    private readonly frustum = new THREE.Frustum();
    private readonly pv = new THREE.Matrix4();
    private readonly keys = new HeldKeys();
    private time = 0;
    /**
     * 立つ会話の相手（castActors）の動きの時計：ふだんは探索の時計と同じだけ進み、演出の出来事の間は演出の時計（stage の t）の差だけ進む
     * （遅いコマでは探索の時計は 1 コマ 0.1 秒までしか進まないが、演出の人は 1 コマで 1 秒分動く。足の合わせ直しの判定を演出の時計で）
     */
    private castTime = 0;
    // ---- 演出の出来事
    private stageKey: string | null = null;
    private stageT = 0;
    private stageBefore: { pose: ExplorePose; orbit: { yaw: number; pitch: number; dist: number } } | null = null;
    /** 出来事の最初の画をまだ描いていない（置いた時は探索の描画を止めていた＝演出の層が覆っていた。覆いが外れた次の stage で描く） */
    private stageFirstPending = false;
    private hiddenCast = new Set<string>();
    private hiddenAmbient = new Set<string>();
    /** 出来事を始めた時の主人公と見回し（町の急報の人とカメラの元）・最後の t の動きを減らすか・出来事の後に主人公をそのままにするか */
    private stageOrigin: StageOrigin | null = null;
    private stageReduced = false;
    private stageHeroStays = false;
    /** 出来事の人のうち、会話の相手そのもの（StagePerson.cast）の今の形 */
    private stageLinked = new Map<string, StagePerson>();
    /** 町の急報の後の歩き（無ければ null） */
    private epilogue: Epilogue | null = null;
    /** 話している相手（その人は主人公の顔を見る）・主人公の向き直り */
    private talkWith: string | null = null;
    private heroTurn: { from: number; to: number; at: number; dur: number } | null = null;
    // ---- 町の人々
    private ambient: AmbientSpec | null = null;
    private plan: AmbientPlan = ambientPlan(null);
    private ambientTime = 0;
    private ambientRects: Rect[] = [];
    // ---- カメラの差し替え（強い順：出来事・物見・軍議所）
    private stageShot: CameraShot | null = null;
    private lookoutShot: CameraShot | null = null;
    private councilShot: CameraShot | null = null;
    private appliedShot: CameraShot | null = null;
    private lookout: LookoutSession | null = null;
    // ---- 案内の印（目前の目的の相手）
    private readonly guide: HTMLElement;
    private readonly guideArrow: HTMLElement;
    private readonly guideName: HTMLElement;
    private guideState: GuideProbe = { mode: null, id: null, side: null };

    constructor(private readonly host: ExploreHost) {
        this.group.name = 'chapter-cast';
        host.scene.add(this.group);
        this.labels = document.createElement('div');
        this.labels.id = 'npc-labels';
        host.overlay.appendChild(this.labels);
        // 案内の印は名札の入れ物に入れる（会話・演出・メニュー・物見・合戦の間は名札と一緒に隠れる：ui.css・town.css）
        this.guide = document.createElement('div');
        this.guide.className = 'npc-guide';
        this.guide.hidden = true;
        this.guideArrow = document.createElement('span');
        this.guideArrow.className = 'npc-guide-arrow';
        this.guideName = document.createElement('span');
        this.guideName.className = 'npc-guide-name';
        this.guide.append(this.guideArrow, this.guideName);
        this.labels.appendChild(this.guide);
        // 演出の人の名札（演出の 3D の場面の間だけ見える：body.g-cine-stage）
        this.stageLabels = document.createElement('div');
        this.stageLabels.id = 'stage-labels';
        host.overlay.appendChild(this.stageLabels);
        this.people = new PersonFactory((o) => host.prepare(o), host.low);
        this.stageActors = new ActorLayer('stage', this.people, this.stageLabels, () => host.viewSize(), 40, host.low);
        this.ambientActors = new ActorLayer('ambient', this.people, null, () => host.viewSize(), AMBIENT_FIGURES_MAX, host.low);
        // 立つ会話の相手：名札は出来事の間だけ演出の名札の入れ物に（ふだんの名札は npc-labels。world が置く）
        this.castActors = new ActorLayer('cast-people', this.people, this.stageLabels, () => host.viewSize(), 1, host.low);
        host.scene.add(this.stageActors.group, this.ambientActors.group, this.castActors.group);
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
                this.castActors.resetPeople();
            });
        return this.loading;
    }

    get ready(): boolean {
        return !!this.base || this.baseFailed;
    }

    // ---------------- GameWorld ----------------

    setCast(cast: CastMember<string>[]): void {
        // タイトル・合戦（相手が誰もいない）：物見の眺めの途中なら終わらせる。町の急報の後の歩きの途中なら、それも終える
        //（残すと、次に読み込んだ回の町で前の回の使者が歩き、着くまで「話す」が出なかった）。話している相手・主人公の向き直りも外す
        if (cast.length === 0) {
            this.lookout?.cancel();
            this.epilogue = null;
            this.talkWith = null;
            this.heroTurn = null;
        }
        // 同じ相手・同じ姿勢・同じ場所なら作り直さない
        const same =
            cast.length === this.cast.length &&
            cast.every((c, i) => {
                const o = this.cast[i]!;
                return o.id === c.id && o.pose === c.pose && o.x === c.x && o.z === c.z && o.key === c.key && o.look === c.look;
            });
        if (same) return;
        // 同じ人物（同じ id・形・見た目・置き場所）は作り直さない（町の急報の後に使者が加わっても、ほかの人物の向き・足・名札は続く）
        const keep = new Map<string, NpcView>();
        for (const m of cast) {
            const v = this.views.get(m.id);
            if (v && v.member.kind === m.kind && v.member.pose === m.pose && v.member.look === m.look && v.member.x === m.x && v.member.z === m.z && v.member.label === m.label) keep.set(m.id, v);
        }
        for (const [id, v] of this.views) {
            if (keep.get(id) === v) continue;
            this.group.remove(v.root);
            v.mixer?.stopAllAction();
            v.label.remove();
        }
        this.views.clear();
        for (const [id, v] of keep) {
            const m = cast.find((c) => c.id === id)!;
            v.member = m;
            v.label.className = labelClass(m);
            this.views.set(id, v);
        }
        this.build(cast, keep);
    }

    heroPose(): ExplorePose {
        const h = this.host.hero;
        return { x: h.x, z: h.z, heading: h.heading };
    }

    setHeroPose(p: ExplorePose, opts?: { keepCamera?: boolean }): void {
        this.host.setHeroPose(p, opts);
    }

    setControl(enabled: boolean): void {
        this.host.setControl(enabled);
        // 操作へ戻ったら（会話の後）、顔は正面へ戻す。相手も主人公の顔を見るのをやめる。向き直りの途中なら、そこから操作に任せる
        if (enabled) {
            this.host.setHeroGaze?.(null);
            this.talkWith = null;
            this.heroTurn = null;
        }
    }

    faceTalk(id: string): void {
        const v = this.views.get(id);
        const h = this.host.hero;
        const m = v?.member ?? this.cast.find((c) => c.id === id);
        if (!m) return;
        // 出来事の後の歩きの途中の人（確認用の話しかけ）：その人は置き場所に置く
        if (this.epilogue) this.epilogue.done.add(id);
        const mx = v?.x ?? m.x;
        const mz = v?.z ?? m.z;
        if (v && m.kind === 'person' && m.pose === 'stand') {
            // 相手は主人公の方へ、足を踏み替えて向き直る（1 コマで回さない：castActors の足が踏み替える）。話す間は主人公の顔を見る
            const to = headingToward(mx, mz, h.x, h.z);
            const d = Math.atan2(Math.sin(to - v.heading), Math.cos(to - v.heading));
            v.targetHeading = to;
            v.turn = { from: v.heading, to, at: this.time, dur: npcTurnSec(d) };
            this.talkWith = id;
        }
        // 主人公も相手の方を向く（城門はそのまま）：0.3〜0.5 秒で（描く体は足を踏み替えて回る：game/heroAnim.ts・legs.ts）。顔は相手の顔へすぐ向け始める
        if (m.kind !== 'gate') {
            const to = headingToward(h.x, h.z, mx, mz);
            const d = Math.atan2(Math.sin(to - h.heading), Math.cos(to - h.heading));
            this.heroTurn = { from: h.heading, to, at: this.time, dur: heroTurnSec(d) };
            if (m.kind === 'person') this.host.setHeroGaze?.({ x: mx, y: groundY(mx, mz) + 1.5, z: mz });
        }
    }

    /** 出来事が動かしている会話の相手（町の急報の間と、その後に話せる位置へ歩いている間）。まだ話しかけられない */
    castArriving(): string[] {
        const out = new Set<string>(this.stageLinked.keys());
        for (const id of this.epilogueFrame()?.keys() ?? []) out.add(id);
        return [...out];
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
        const fresh = key !== this.stageKey;
        const prevT = this.stageT;
        if (fresh) {
            if (this.stageKey) this.stageActors.clear();
            this.stageKey = key;
            if (!this.stageBefore) this.stageBefore = { pose: this.heroPose(), orbit: { ...this.host.orbit } };
            // 出来事を始めた時の主人公（位置・向き・進む向き・速さ）と見回し：町の急報は、この所で起きる。前の出来事の後の歩きは終える
            const h = this.host.hero;
            this.stageOrigin = { x: h.x, z: h.z, heading: h.heading, dirX: h.dirX, dirZ: h.dirZ, speed: h.speed, yaw: this.host.orbit.yaw };
            this.epilogue = null;
            this.heroTurn = null;
        } else this.castTime += Math.max(0, t - this.stageT);
        this.stageT = t;
        this.stageReduced = reduced;
        const f = stageFrame(ev, t, reduced, this.castInfo(), this.stageOrigin ?? undefined);
        // 出来事が動かす会話の相手が、置き場所に座っている人物（立つ人物として描かない）なら、その間は座った人物を隠す（同じ人を二人描かない：見直し）
        const seated = f.people.filter((p) => p.cast && this.views.get(p.cast) && !this.views.get(p.cast)!.stander).map((p) => p.cast!);
        this.setHiddenCast(seated.length ? [...f.hideCast, ...seated] : f.hideCast);
        this.hiddenAmbient = new Set(f.hideAmbient);
        this.stageShot = { ...f.shot, hideHero: !f.hero };
        this.stageHeroStays = !!f.heroStays;
        if (f.hero) {
            this.placeStageHero(f.hero);
            // 主人公の足・体の向きも演出の時計で（前の stage から演出が進めた分。始めの 1 コマ・巻き戻しは 0）
            this.host.heroStageClock?.(fresh ? 0 : Math.max(0, t - prevT));
        } else this.host.heroStageClock?.(null);
        if (f.heroGaze !== undefined) this.host.setHeroGaze?.(f.heroGaze);
        this.applyShot();
        const cam = this.host.camera;
        // 会話の相手そのもの（StagePerson.cast）は castActors で描く（毎フレームの frame で。同じ人物のまま）。ほかの人は演出の人
        this.stageLinked = new Map(f.people.filter((p) => p.cast).map((p) => [p.cast!, p]));
        const plain = f.people.filter((p) => !p.cast);
        // 名札はここでは動かさない：演出の時計（ここ）は探索の描画の後に進むので、ここで動かすと、まだ前の形の画の上で名札だけが
        // 先へ進んで見える（毎秒 1 コマほどの画では人 1〜2 m 分ずれた）。名札は描く直前（frame）に、描く人の位置とカメラで置く
        this.stageActors.setPeople(plain, t, cam, false);
        this.stageActors.setFigures(f.figures, f.banners, f.litters, t, cam);
        // 出来事の最初の画はすぐ描く（地図の覆いが外れた所に、前の画や暗い画面を出さない。初めて描く重さは演出の時計に数えない）。
        // 名札も、その描いた画に合わせて置く。ただし探索の描画を止めている間（演出の層が字幕を先に見せている間）は描かず、
        // 覆いが外れた後の次の stage で描く（重い最初の画の前に、字幕の層を画面に出すため：ui/cinePlayer.ts の stageWait）
        if (fresh) this.stageFirstPending = true;
        if (this.stageFirstPending && !this.host.renderPaused?.()) {
            this.stageFirstPending = false;
            // 最初の画は frame（毎フレームの隠す・町の人々の置き直し）を通らずに描くので、隠す人物・町の人々をここで当ててから描く
            //（当てないと、最初の 1 コマだけ、隠すはずの人物（出陣の手前の会話の相手など）・支度の兵が映った）
            for (const v of this.views.values()) {
                if (!this.hiddenCast.has(v.member.id)) continue;
                v.root.visible = false;
                v.label.hidden = true;
            }
            if (this.ambient) this.updateAmbient(cam);
            this.updateCast(cam);
            this.host.renderOnce();
            this.stageActors.placeLabels(cam);
            this.castActors.placeLabels(cam);
        }
    }

    /**
     * 冒頭の出来事で主人公を立たせる（位置・向きだけ。見回しのカメラ（orbit）は触らない。始める前の位置・向きは stageBefore にあり、片付けで戻す）。
     * 歩きの速さは 0（操作は止めてあるので、その場で待機の動き）
     */
    private placeStageHero(p: StageHero): void {
        const h = this.host.hero;
        h.x = p.x;
        h.z = p.z;
        h.heading = p.heading;
        h.dirX = Math.sin(p.heading);
        h.dirZ = Math.cos(p.heading);
        h.speed = 0;
    }

    private endStage(): void {
        if (!this.stageKey && !this.stageBefore && !this.stageShot) return;
        // 町の急報を終わりまで見た（飛ばしていない・動きを減らしていない）：使者と忠勝は、同じ人物のまま話せる位置へ歩いて行く（操作の間に）。
        // 飛ばした・動きを減らした：みな置き場所に置く（使者は話せる位置、忠勝は城門の前）
        const ev = this.stageKey ? (JSON.parse(this.stageKey) as StageEvent) : null;
        const end = ev ? afterWalkEnd(ev) : null;
        // 置き場所に座っている人物を出来事が立たせて動かしていた（見直し）ときは、後の歩きをせず置き場所へ戻す（座った人物と二人にしない）
        const seatedLinked = [...this.stageLinked.keys()].some((id) => this.views.get(id)?.stander === false);
        if (ev && end !== null && this.stageOrigin && !this.stageReduced && !seatedLinked && this.stageT >= end - 0.05) {
            this.epilogue = { ev, origin: this.stageOrigin, t0: this.time, end, walkers: new Set(afterWalkers(ev)), done: new Set() };
        }
        // 出来事が動かしていた会話の相手は、最後の形の所から続ける（後の歩き・置き場所へ戻すのは updateCast）
        for (const [id, o] of this.stageLinked) {
            const v = this.views.get(id);
            if (!v || !v.stander) continue;
            v.x = o.x;
            v.z = o.z;
            v.heading = o.heading;
            v.driven = true;
        }
        this.stageLinked = new Map();
        this.stageActors.clear();
        this.host.heroStageClock?.(null);
        this.stageKey = null;
        this.stageFirstPending = false;
        this.setHiddenCast([]);
        this.hiddenAmbient = new Set();
        this.stageShot = null;
        const before = this.stageBefore;
        this.stageBefore = null;
        if (before) {
            // 主人公を始める前の位置・向きへ（町の急報はその場で振り向いただけなので、そのまま）。
            // カメラの見回しは始める前の向き・高さ・距離へ（背後へは戻さない。演出の画から肩越しへは main.ts がなめらかに戻す）
            if (!this.stageHeroStays) this.host.setHeroPose(before.pose, { keepCamera: true });
            Object.assign(this.host.orbit, before.orbit);
        }
        this.stageHeroStays = false;
        this.appliedShot = null;
        this.applyShot(true);
    }

    /**
     * 町の急報の後の歩きの、今の形（会話の相手の id → その人。みな着いたら null にして終える）。
     * 出来事と同じ純粋な関数（stage.ts）を、場面の長さより後の時刻で呼ぶ（時刻は探索の時計 this.time。止まっている間は進まない）
     */
    private epilogueFrame(): Map<string, StagePerson> | null {
        const e = this.epilogue;
        if (!e) return null;
        const f = stageFrame(e.ev, e.end + Math.max(0, this.time - e.t0), false, this.castInfo(), e.origin);
        if (f.settled) {
            this.epilogue = null;
            return null;
        }
        // 着いて向き直った人（settled）は返さない：その人は置き場所の人物に戻り、ほかの人がまだ歩いていても話しかけられる
        return new Map(f.people.filter((p) => p.cast && e.walkers.has(p.cast) && !e.done.has(p.cast) && !p.settled).map((p) => [p.cast!, p]));
    }

    /**
     * 立つ会話の相手を描く（castActors）。出来事・出来事の後の歩きが動かしている人はその形、ほかは置き場所で、話しかけられたら
     * 足を踏み替えて主人公の方へ向き直り、話す間は主人公の顔を見る。まだ配役に居ない人（町の急報の間の使者）も同じ id で描く
     */
    private updateCast(cam: THREE.Camera): void {
        const over = new Map<string, StagePerson>(this.stageKey ? this.stageLinked : (this.epilogueFrame() ?? []));
        const list: StagePerson[] = [];
        const h = this.host.hero;
        for (const v of this.views.values()) {
            if (!v.stander) continue;
            const m = v.member;
            const o = over.get(m.id);
            if (o) {
                over.delete(m.id);
                v.x = o.x;
                v.z = o.z;
                v.heading = o.heading;
                v.targetHeading = o.heading;
                v.turn = null;
                v.driven = true;
                list.push(o);
                continue;
            }
            if (v.driven) {
                // 出来事が動かすのをやめた（飛ばした・着いた）：置き場所・置き場所の向きへ
                v.driven = false;
                v.x = m.x;
                v.z = m.z;
                v.heading = m.heading;
                v.targetHeading = m.heading;
            }
            if (this.hiddenCast.has(m.id)) continue;
            if (v.turn) {
                const k = (this.time - v.turn.at) / v.turn.dur;
                v.heading = wrap(v.turn.from + wrap(v.turn.to - v.turn.from) * smooth(k));
                if (k >= 1) v.turn = null;
            }
            const look = this.talkWith === m.id ? { ...NO_ACT, look: { x: h.x, y: 1.45, z: h.z }, lookWeight: 0.85 } : undefined;
            list.push({ key: m.id, cast: m.id, look: m.look ?? 'genzo', name: m.label, x: v.x, z: v.z, heading: v.heading, walked: 0, moving: 0, label: false, ...(look ? { act: look } : {}) });
        }
        // まだ配役に居ない人（町の急報の間・後の使者）
        for (const o of over.values()) list.push(o);
        this.castActors.setPeople(list, this.castTime, cam, false, null);
    }

    /** 町の人々（見た目だけ。null で消す）。同じ中身なら置き直さない */
    setAmbient(spec: AmbientSpec | null): void {
        if (JSON.stringify(spec) === JSON.stringify(this.ambient)) return;
        this.ambient = spec;
        this.plan = ambientPlan(spec);
        // 休み場の負傷兵・援兵の並び（いるときだけ）を歩きの当たり判定に足す（人物・高札の分と合わせて渡す）
        this.ambientRects = ambientColliders(this.plan);
        this.applyColliders();
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

    /** 今の町を 1 コマ描き直す（演出の後。覆われていても描く：次の画面の下が最後の 3D の画のままにならないように） */
    redraw(): void {
        this.host.renderOnce();
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
        this.applyColliders();
    }

    /** 歩きの当たり判定に足す物：置いている人物・高札と、町の人々の兵の並び（休み場の負傷兵・援兵） */
    private applyColliders(): void {
        this.host.setExtraColliders([...castColliders(this.cast), ...this.ambientRects]);
    }

    private build(cast: CastMember<string>[], keep: ReadonlyMap<string, NpcView> = new Map()): void {
        this.cast = cast.slice();
        this.applyColliders();
        for (const m of cast) {
            if (keep.has(m.id)) continue;
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
        l.className = labelClass(m);
        l.textContent = m.label;
        l.dataset.id = m.id;
        this.labels.appendChild(l);
        return l;
    }

    private makeStatic(m: CastMember<string>, obj: THREE.Object3D, labelY: number): NpcView {
        obj.position.set(m.x, groundY(m.x, m.z), m.z);
        obj.rotation.y = m.heading;
        this.group.add(obj);
        return { member: m, root: obj, mixer: null, bones: new Map(), stander: false, heading: m.heading, targetHeading: m.heading, turn: null, x: m.x, z: m.z, driven: false, label: this.makeLabel(m), labelY };
    }

    private makePerson(m: CastMember<string>): NpcView | null {
        if (m.pose === 'stand') {
            // 立つ人物：形は castActors が描く（町の人々・演出の人と同じ足・顔の向き。人ごとの拍子は id から：explore/rhythm.ts）。
            // 素材を読む前は代わりの形（読み終えたら castActors が作り直す）
            if (!this.ready) void this.preload();
            const root = new THREE.Group();
            this.group.add(root);
            const o = this.stageLinked.get(m.id) ?? this.epilogueFrame()?.get(m.id);
            return {
                member: m,
                root,
                mixer: null,
                bones: new Map(),
                stander: true,
                heading: o?.heading ?? m.heading,
                targetHeading: o?.heading ?? m.heading,
                turn: null,
                x: o?.x ?? m.x,
                z: o?.z ?? m.z,
                driven: !!o,
                label: this.makeLabel(m),
                labelY: 2.05,
            };
        }
        if (!this.ready) {
            // 素材を読み終えたら作る（preload の最後で作り直す）。名前の札だけは先に出さない
            void this.preload();
            return null;
        }
        // 座った人物（床几）：人ごとの拍子（待機の動きの速さ・始めの位置。皆が同じ周期で揺れない：explore/rhythm.ts）
        const p = this.people.make(m.look ?? 'genzo', { rhythm: rhythmOfId(m.id) });
        const root = p.root;
        root.add(makeStool());
        root.position.set(m.x, groundY(m.x, m.z), m.z);
        root.rotation.y = m.heading;
        this.group.add(root);
        const v: NpcView = { member: m, root, mixer: p.mixer, bones: p.bones, stander: false, heading: m.heading, targetHeading: m.heading, turn: null, x: m.x, z: m.z, driven: false, label: this.makeLabel(m), labelY: 1.65 };
        if (p.mixer) {
            p.mixer.update(0);
            sitPose(p.bones);
        }
        return v;
    }

    /** 出来事の間だけ隠す人物（同じ人が歩いて来る） */
    private setHiddenCast(ids: readonly string[]): void {
        this.hiddenCast = new Set(ids);
    }

    /** 出来事の行き先を決めるための、置いている相手の見た目と場所 */
    private castInfo(): StageCastInfo[] {
        return this.cast.map((c) => ({ id: c.id, kind: c.kind, ...(c.look ? { look: c.look } : {}), x: c.x, z: c.z, heading: c.heading, ...(c.pose === 'sit' ? { pose: 'sit' as const } : {}) }));
    }

    // ---------------- 毎フレーム ----------------

    frame(dt: number): void {
        this.time += dt;
        // 演出の出来事の間は、演出の時計が進めた分（stage）
        if (!this.stageKey) this.castTime += dt;
        this.ambientTime += dt;
        this.lookout?.frame();
        const h = this.host.hero;
        // 話しかけた相手の方へ、主人公が 0.3〜0.5 秒で向き直る（描く体は足を踏み替える）
        if (this.heroTurn) {
            const k = (this.time - this.heroTurn.at) / this.heroTurn.dur;
            h.heading = wrap(this.heroTurn.from + wrap(this.heroTurn.to - this.heroTurn.from) * smooth(k));
            h.dirX = Math.sin(h.heading);
            h.dirZ = Math.cos(h.heading);
            if (k >= 1) this.heroTurn = null;
        }
        const { w, h: vh } = this.host.viewSize();
        const cam = this.host.camera;
        cam.updateMatrixWorld();
        this.pv.multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.pv);
        // 立つ会話の相手（castActors）：先に今の位置・向きを決める（名札はその位置に置く）
        this.updateCast(cam);
        const shown: { v: NpcView; x: number; y: number; depth: number }[] = [];
        for (const v of this.views.values()) {
            const m = v.member;
            const hidden = this.hiddenCast.has(m.id);
            // 画面の外（影の届く分を足す）の人物は描かない。出来事の間に隠す人物も（立つ人物は castActors が決める）
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
            // 名前の札：頭の上（今の位置）。遠い・画面の外・カメラの後ろでは出さない
            tmp.set(v.x, groundY(v.x, v.z) + v.labelY, v.z).project(cam);
            const dist = Math.hypot(v.x - h.x, v.z - h.z);
            const show = !hidden && tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && dist < (m.key ? LABEL_FAR.key : LABEL_FAR.other);
            if (!show) {
                if (!v.label.hidden) v.label.hidden = true;
                continue;
            }
            v.label.hidden = false;
            shown.push({ v, x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * vh, depth: tmp.z });
            v.label.classList.toggle('far', dist > 12);
        }
        // 名札が重なるときは、近い人の名札をそのままにし、遠い人の名札を上へずらす（演出の人の名札と同じ。城門の前の家臣と使者が並ぶ画）
        shown.sort((a, b) => a.depth - b.depth);
        // 大きさは文と字の大きさ（far）が変わったときだけ測る（毎フレーム測ると、名札ごとに配置の計算をやり直させる）。書くのは測った後
        const boxes = shown.map((s) => labelBox(s.v.label));
        const ys = stackLabels(shown.map((s, i) => ({ x: s.x, y: s.y, w: boxes[i]!.w, h: boxes[i]!.h })));
        const keyAt = new Map<NpcView, { x: number; y: number }>();
        shown.forEach((s, i) => {
            s.v.label.style.transform = `translate(${s.x.toFixed(1)}px, ${ys[i]!.toFixed(1)}px) translate(-50%, -100%)`;
            keyAt.set(s.v, { x: s.x, y: ys[i]! - boxes[i]!.h });
        });
        this.updateGuide(cam, w, vh, keyAt);
        if (this.ambient) this.updateAmbient(cam);
        // 演出の人の名札：描く直前のカメラで置き直す（演出の時計は探索の描画と別の時に進む）
        if (this.stageKey) {
            this.stageActors.placeLabels(cam);
            this.castActors.placeLabels(cam);
        }
    }

    /**
     * 案内の印（目前の目的の相手＝key の相手）。演出の出来事・物見の間は出さない（会話・メニューなどの間は名札の入れ物ごと隠れる）。
     * 話せる所（届く範囲の少し外）まで来たら消す（「話す」のボタンが出る）。画面の中なら名札の上に小さな ▼、外なら画面の端に向きと名前。
     */
    private updateGuide(cam: THREE.Camera, w: number, vh: number, labelTops: ReadonlyMap<NpcView, { x: number; y: number }>): void {
        const off = (): void => {
            if (!this.guide.hidden) this.guide.hidden = true;
            this.guideState = { mode: null, id: null, side: null };
        };
        if (this.stageKey || this.lookout?.active) return off();
        let v: NpcView | null = null;
        for (const x of this.views.values()) if (x.member.key && !this.hiddenCast.has(x.member.id)) v = x;
        if (!v) return off();
        const m = v.member;
        const hero = this.host.hero;
        if (Math.hypot(v.x - hero.x, v.z - hero.z) <= m.reach + 0.4) return off();
        const gy = groundY(v.x, v.z) + v.labelY;
        tmp.set(v.x, gy, v.z).project(cam);
        const onScreen = tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) < 0.92 && Math.abs(tmp.y) < 0.9;
        this.guide.hidden = false;
        if (this.guideName.textContent !== m.label) this.guideName.textContent = m.label;
        if (onScreen) {
            // 名札（頭の上）のさらに上（名札を出していなければ頭の上）
            const top = labelTops.get(v);
            const sx = top ? top.x : (tmp.x * 0.5 + 0.5) * w;
            const sy = (top ? top.y : (-tmp.y * 0.5 + 0.5) * vh) - 3;
            this.guide.className = 'npc-guide over';
            if (this.guideArrow.textContent !== '▼') this.guideArrow.textContent = '▼';
            this.guide.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
            this.guideState = { mode: 'over', id: m.id, side: null };
            return;
        }
        // 画面の外・後ろ：カメラから見て左右どちらか（カメラの中の座標の x）
        tmp.set(v.x, gy, v.z).applyMatrix4(cam.matrixWorldInverse);
        const right = tmp.x >= 0;
        this.guide.className = `npc-guide edge ${right ? 'right' : 'left'}`;
        const arrow = right ? '▶' : '◀';
        if (this.guideArrow.textContent !== arrow) this.guideArrow.textContent = arrow;
        const sy = vh * 0.46;
        this.guide.style.transform = right ? `translate(${(w - 10).toFixed(1)}px, ${sy.toFixed(1)}px) translate(-100%, -50%)` : `translate(10px, ${sy.toFixed(1)}px) translate(0, -50%)`;
        this.guideState = { mode: 'edge', id: m.id, side: right ? 'right' : 'left' };
    }

    /** 確認用：案内の印（出ているか・誰へ・画面の端なら左右） */
    guideProbe(): GuideProbe {
        return { ...this.guideState, mode: this.guide.hidden ? null : this.guideState.mode };
    }

    /**
     * 町の人々を今の時計の形に置く（出来事が同じ所に同じ人々を出している間は、その種類を隠す）。
     * 店の人は、近くを主人公が通ると会釈する（出来事の間は主人公を渡さない）
     */
    private updateAmbient(cam: THREE.Camera): void {
        const hide = this.hiddenAmbient;
        const people = this.plan.walkers.filter((w) => !hide.has(w.role)).map((w) => walkerAt(w, this.ambientTime));
        this.ambientActors.setPeople(people, this.ambientTime, cam, true, this.stageKey ? null : this.host.hero);
        const figs = hide.size ? this.plan.figures.filter((f) => !hide.has(f.kind)) : this.plan.figures;
        const bans = hide.size ? this.plan.banners.filter((b) => !hide.has(b.kind)) : this.plan.banners;
        this.ambientActors.setFigures(figs, bans, [], this.ambientTime, cam);
    }

    /**
     * 確認用：置いている人物（id・姿勢・置き場所 x・z・置き場所の向き heading）と、今の位置・向き（at・now。町の急報の後の歩きの間は置き場所と違う）・
     * 出来事が動かしているか（driven）
     */
    probe(): { id: string; pose: string; x: number; z: number; heading: number; model: boolean; at: [number, number]; now: number; driven: boolean }[] {
        return [...this.views.values()].map((v) => ({
            id: v.member.id,
            pose: v.member.pose,
            x: v.member.x,
            z: v.member.z,
            heading: v.member.heading,
            model: v.stander ? this.people.hasModel : !!v.mixer,
            at: [Math.round(v.x * 1000) / 1000, Math.round(v.z * 1000) / 1000],
            now: Math.round(v.heading * 1000) / 1000,
            driven: v.driven,
        }));
    }

    /**
     * 確認用：町の急報の後の歩き（歩いている会話の相手の id）・出来事が動かしている会話の相手・主人公の向き直りの途中か。
     * linkedAt：出来事が動かしている会話の相手の今の形（位置・向き・歩きの重み・片膝。まだ配役に居ない人も）
     */
    eventProbe(): { epilogue: string[]; linked: string[]; linkedAt: Record<string, { x: number; z: number; heading: number; moving: number; kneel: number }>; heroTurning: boolean; talkWith: string | null } {
        const r = (v: number) => Math.round(v * 1000) / 1000;
        const linkedAt = Object.fromEntries([...this.stageLinked].map(([id, p]) => [id, { x: r(p.x), z: r(p.z), heading: r(p.heading), moving: p.moving, kneel: p.act?.kneel ?? 0 }]));
        return { epilogue: [...(this.epilogue ? (this.epilogueFrame()?.keys() ?? []) : [])], linked: [...this.stageLinked.keys()], linkedAt, heroTurning: !!this.heroTurn, talkWith: this.talkWith };
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

/** 名札の種類（目前の目的・城門・物見櫓） */
function labelClass(m: CastMember<string>): string {
    return `npc-label${m.key ? ' key' : ''}${m.kind === 'gate' ? ' gate' : ''}${m.kind === 'lookout' ? ' lookout' : ''}`;
}

/** 測った名札の大きさ（文と far の組ごと。変わったときだけ測り直す） */
const labelSizes = new WeakMap<HTMLElement, { key: string; w: number; h: number }>();
/** 名札の大きさ（描かれていれば実際の大きさを測って覚える。測れなければ字数からの見積もり：覚えずに次に測る） */
function labelBox(el: HTMLElement): { w: number; h: number } {
    const key = `${el.textContent ?? ''}|${el.classList?.contains('far') ? 1 : 0}`;
    const known = labelSizes.get(el);
    if (known && known.key === key) return known;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
        const m = { key, w, h };
        labelSizes.set(el, m);
        return m;
    }
    return { w: [...(el.textContent ?? '')].length * 12.8 + 20, h: 22 };
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

/** 床几（腰掛け）：町の小物の床几（Blender で作った props28.glb の形。town/view.ts）。素材を読み終える前だけ簡単な箱 */
function makeStool(): THREE.Object3D {
    const m = townPropModel('stool');
    if (m) return m;
    const g = new THREE.Group();
    g.add(box(0.46, 0.06, 0.36, WOOD, 0, 0.42, 0.02));
    for (const sx of [-1, 1]) g.add(box(0.05, 0.42, 0.3, WOOD, sx * 0.19, 0.21, 0.02));
    return g;
}

/**
 * 高札（2 本の柱・板・3 枚の札・小さな切妻の板屋根）：町の小物の高札（Blender で作った props28.glb の形。town/view.ts）。
 * 素材を読み終える前だけ簡単な箱。表（文字の面）は +z。向きは cast の heading で回す
 */
function makeNoticeBoard(): THREE.Object3D {
    const m = townPropModel('kosatsu');
    if (m) return m;
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
