/**
 * 合戦の表示（three.js）。探索と同じ描画器で描く別の場面（docs/chapter1-spec.md §4 表示と操作）。
 * 見た目は暫定で安く作る（新しい高精細の素材は作らない）：
 * - 地面：丘（sim.ts の elevationAt と同じ式で盛り上げる）・林（既存の松 tree_pine_far を小さくして並べる。読めなければ円すい）・
 *   湿地（水たまりと葦）・道・戦場の縁・退き口の印。
 * - 部隊：1 部隊を 20〜40 人の兵士の軍勢として描く（人数・隊列・LOD の決まりは troops.ts、描画は troopsView.ts の TroopLayer）。
 *   種類×部品ごとに 1 つの InstancedMesh にまとめ、画面外の部隊は描かない。兵が減ると後ろの列から 1 人ずつ抜け、敗走すると散って逃げる。
 *   家の色と紋の旗（のぼり。これも InstancedMesh）・陣営の輪（前の向きの印つき）・選んだ部隊の輪（輪は兵士より手前に描く）。
 *   部隊の輪・押す判定の広さは Version 12 のまま（control.ts の formationExtent と figureCount。兵士の人数を増やしても押しやすさは変えない）。
 * - 命令の線（移動・攻撃・撤退）と矢の線、斬り合いの印（正面は白・側面は橙・背後は赤）。
 * - 見えない敵（林の中で味方から見えていない）は描かない。
 * - 特殊能力（歴史分岐・演習）：効果中の範囲の輪（持つ部隊について動く。後詰めの差配は対象の部隊を囲む）、選んだ部隊のまだ使っていない能力の範囲（薄く点滅）、
 *   援護の結びの線（効いている間は実線、離れて外れている間は灰色の破線）。
 *   対象を選んでいる間は、選べる味方の輪を淡い青緑で点滅させ、選べない部隊の輪を薄くする。
 *   能力を使った瞬間に、持つ部隊（対象の要る能力は対象も）の周りに 0.8 秒の波紋（広がって消える）。効果が切れたときは小さく縮む波紋。
 *   状態の能力の記録（usedAt・ended）を毎フレーム見て出すので、敵方の能力・早送りの中で使った能力でも出る。
 * - 戦前の約束：南の「味方の陣」（安全地点）の輪と、対象の部隊を囲む輪（同じ色）。
 * - 合戦場のデータの地形（簡単な形と色だけ）：深い川（水の面）・浅瀬（浅い色の水と石）・崖（暗い岩の盛り上がり）・
 *   橋（板の床・継ぎ目・欄干・橋脚）・水田（水を張った区画・畦・苗の列）・尾根（カプセルの丘。sim.ts の elevationAt で盛り上げ、等高線を引く）。
 *   通れる範囲（fieldRules.passable）の外は暗くする。
 * - 目標の区域（確保する地点・守る地点・救出の地点・突破する地点）の輪（主目標は金・副目標は水色。果たしたら緑、果たせなければ灰）、
 *   援軍の出る所の小さな印、狭い正面の区域の縁。名札（短い名前）は battleUi.ts が control.ts の mapLabels で出す。
 * 描画命令は部隊の数では増えない（兵士・旗で 7〜10。のぼりは合戦に出る家の数 × 大きさ）。戦場の地形・印が増えると 10 ほど増える。影・画面の仕上げは使わない。
 * 状態は読むだけ（sim.ts の BattleState を書き換えない）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BattleMap, ClanId, Side, Zone } from './types';
import { attackArc, elevationAt, exitPointFor, inTerrain, type BattleState, type UnitState } from './sim';
import {
    CAM,
    clampCam,
    clashShift,
    figureCount,
    formationExtent,
    hash01,
    objectiveStateOf,
    objectiveZoneCounting,
    objectiveZoneMarks,
    reinforcementMarks,
    type CamState,
    type Pending,
} from './control';
import { ABILITY_DATA, abilityInfo } from './abilities';
import { troopTier } from './troops';
import { POLE_H, TroopLayer, type TroopStats } from './troopsView';

/** 特殊能力の範囲の輪の色（敵方の能力は赤みの色） */
const ABILITY_COLOR: Record<string, string> = {
    ieyasu_rally: '#ffd76a',
    tadakatsu_rearguard: '#b8f36b',
    nagamasa_support: '#c9a7ff',
    sakai_flank: '#ffae5c',
    ishikawa_reserve: '#7fd6ff',
    sakakibara_vanguard: '#ff8fc0',
    enemy: '#ff8a7a',
};
/** 能力の対象選びの輪・名札の印の色（淡い青緑。選択の黄・陣営の水色とは別。battle.css の #7ef0de と同じ） */
const ABILITY_READY_COLOR = '#7ef0de';
/** 能力を使ったときの波紋の長さ（秒）と、同時に出せる数 */
const RIPPLE_SEC = 0.8;
const RIPPLE_POOL = 6;
/** 自分だけに効く能力（範囲 0 m）の輪の半径（部隊を囲む大きさ） */
const SELF_RING_R = 14;
/** 目標の区域の色：主目標・副目標・果たした・果たせない */
const OBJ_COLOR = { primary: '#ffd76a', secondary: '#9fd0ff', done: '#8ed57a', failed: '#8a8a8a' };
/** 狭い正面の区域の縁の色 */
const NARROW_COLOR = '#f0a040';
/** 約束の安全地点と対象の輪の色 */
const PLEDGE_COLOR = '#5fe0c0';

/** 家の色（旗・兵の鎧） */
export const CLAN_COLOR: Record<ClanId, string> = {
    kotosaka: '#2f55a8', washio: '#a8322a', tashiro: '#2f7d45', omori: '#c08d22',
    tokugawa: '#2f55a8', oda: '#c9a227', asai: '#3b3f8f', asakura: '#7a3b8f', ronin: '#6b6259',
    rival: '#8a3a2e',
};
/** 家の旗の字（仮） */
export const CLAN_CHAR: Record<ClanId, string> = { kotosaka: '琴', washio: '鷲', tashiro: '田', omori: '森', tokugawa: '徳', oda: '織', asai: '浅', asakura: '朝', ronin: '浪', rival: '敵' };
/** 陣営の色（輪・名札）。同じ家が味方にも敵にもなるので、敵味方はこちらで見分ける */
export const SIDE_COLOR: Record<Side, string> = { ally: '#8fdcff', enemy: '#ff5b4c' };

/** 地面の外側の余白（m） */
const MARGIN = 300;

export interface ViewOptions {
    /** 画質「低」：木を減らし、地面を粗くする。兵士の上限と LOD も一段下げる */
    low: boolean;
    /** 触る端末（スマホ）：兵士の上限と LOD を一段下げる */
    touch?: boolean;
}

interface UnitVis {
    id: string;
    side: Side;
    kind: UnitState['kind'];
    /** 部隊の輪・押す判定・斬り合いの寄せの広さ（Version 12 のまま） */
    halfW: number;
    halfD: number;
    hq: boolean;
    /** 表示の位置と向き（計算の刻みの間をなめらかに） */
    px: number;
    pz: number;
    face: number;
    /** 斬り合いの寄せ */
    sx: number;
    sz: number;
    /** 敗走してからの時間（秒。-1 は敗走していない） */
    routT: number;
    shown: boolean;
    /** 旗の根元（地面）・敗走で傾く角度・のぼりのはためき（描くのは TroopLayer） */
    flagX: number;
    flagY: number;
    flagZ: number;
    flagTilt: number;
    bannerYaw: number;
    seed: number;
}

/** 画面の中の位置（CSS px。canvas の左上から） */
export interface ScreenPt {
    x: number;
    y: number;
    /** カメラの後ろ・画面の外 */
    off: boolean;
}

export class BattleView {
    readonly scene = new THREE.Scene();
    readonly camera: THREE.PerspectiveCamera;
    cam: CamState = { tx: 0, tz: 0, dist: 400 };
    maxDist: number = CAM.maxDistFallback;
    /** 「全体」（fit）のカメラの距離（名札を小さくする引いた画面の目安。fit の前は既定の上限） */
    private fitDist: number = CAM.maxDistFallback;
    private width = 1;
    private height = 1;
    private readonly map: BattleMap;
    private readonly low: boolean;
    private readonly owned: { dispose(): void }[] = [];
    private readonly vis: UnitVis[] = [];
    /** 兵士と旗（種類×部品ごとの InstancedMesh） */
    private readonly troops: TroopLayer;
    /** 直前のフレームの描画の呼び出しの数（開発用の数え上げ） */
    private lastCalls = 0;
    private readonly ringMesh: THREE.InstancedMesh;
    private readonly selRing: THREE.Mesh;
    private readonly ribbon: Ribbon;
    private readonly clashSprites: THREE.Sprite[] = [];
    private readonly clashMats: Record<'front' | 'flank' | 'rear', THREE.SpriteMaterial>;
    private trees: THREE.Object3D | null = null;
    /** 特殊能力の範囲の輪（s.abilityList の順） */
    private readonly abilRings: { ring: THREE.Mesh; fill: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; fillMat: THREE.MeshBasicMaterial; rad: number }[] = [];
    /** 能力の記録の見張り（s.abilityList の順。使った・終わったの変わり目で波紋を出す） */
    private readonly abilSeen: { usedAt: number | null; ended: boolean }[] = [];
    /** 波紋（使い回す）。unit は部隊の番号、t0 は表示の時計で出した時刻 */
    private readonly ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; unit: number; t0: number; kind: 'use' | 'end' }[] = [];
    /** 約束の安全地点（輪と塗り）と、対象を囲む輪 */
    private safeZone: { ring: THREE.Mesh; fill: THREE.Mesh } | null = null;
    private pledgeRing: THREE.Mesh | null = null;
    /** 目標の区域の輪（主目標 → 副目標） */
    private readonly objZones: { id: string; role: 'primary' | 'secondary'; ringMat: THREE.MeshBasicMaterial; fillMat: THREE.MeshBasicMaterial; state: string }[] = [];
    /** 援軍の出る所の印（着いたら薄く） */
    private readonly reinfMarks: { at: number; mat: THREE.MeshBasicMaterial }[] = [];
    /** 通れる範囲（fieldRules.passable。無ければ null） */
    private readonly passable: { x0: number; x1: number; z0: number; z1: number } | null;
    private time = 0;
    private readonly m4 = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly v3 = new THREE.Vector3();
    private readonly s3 = new THREE.Vector3();
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
    private readonly ray = new THREE.Raycaster();

    constructor(s: BattleState, opts: ViewOptions) {
        this.map = s.map;
        this.low = opts.low;
        this.passable = s.setup.fieldRules?.passable ?? null;
        const bg = new THREE.Color('#56653f');
        this.scene.background = bg;
        this.scene.fog = new THREE.Fog(bg, 600, 1400);
        this.camera = new THREE.PerspectiveCamera(CAM.fovDeg, 1, 1, 5000);

        // 光：空の明るさと、南西の高い日差し（影は落とさない）
        const hemi = new THREE.HemisphereLight('#e4edf5', '#6b5c42', 1.5);
        const sun = new THREE.DirectionalLight('#fff0d6', 1.7);
        sun.position.set(-160, 260, 120);
        this.scene.add(hemi, sun);

        this.buildGround();
        this.buildRoad();
        this.buildMarsh();
        this.buildWater();
        this.buildPaddies();
        this.buildBridges();
        this.buildCliffs();
        this.buildEdges();
        this.buildFieldMarks(s);
        this.setTrees(null);

        // ---- 部隊 ----
        for (const u of s.units) {
            // 部隊の輪・押す判定の広さは Version 12 と同じ（兵士の人数によらない）
            const ext = formationExtent(u.kind, figureCount(u.startStrength));
            this.vis.push({
                id: u.id,
                side: u.side,
                kind: u.kind,
                halfW: ext.halfW,
                halfD: ext.halfD,
                hq: u.isHq,
                px: u.x,
                pz: u.z,
                face: u.facing,
                sx: 0,
                sz: 0,
                routT: -1,
                shown: false,
                flagX: u.x,
                flagY: 0,
                flagZ: u.z,
                flagTilt: 0,
                bannerYaw: 0,
                seed: hash01(u.id, 7) * 100,
            });
        }
        this.troops = new TroopLayer(
            s,
            this.vis.map((v) => ({ halfW: v.halfW, halfD: v.halfD })),
            { tier: troopTier(opts), clanColor: (c) => CLAN_COLOR[c], bannerMaterial: (c) => this.bannerMaterial(c) },
        );
        this.scene.add(this.troops.group);

        // 陣営の輪（前の向きの印つき）・選んだ部隊の輪
        const ringGeo = this.own(makeRingGeometry(0.9, 1.0, true));
        const ringMat = this.own(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, toneMapped: false }));
        this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, Math.max(1, s.units.length));
        this.ringMesh.renderOrder = 10;
        this.ringMesh.frustumCulled = false;
        for (let i = 0; i < s.units.length; i++) this.ringMesh.setColorAt(i, new THREE.Color(SIDE_COLOR[s.units[i].side]));
        this.scene.add(this.ringMesh);
        const selGeo = this.own(makeRingGeometry(0.88, 1.0, false));
        const selMat = this.own(new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
        this.selRing = new THREE.Mesh(selGeo, selMat);
        this.selRing.renderOrder = 11;
        this.selRing.visible = false;
        this.scene.add(this.selRing);

        this.buildAbilityRings(s);

        this.ribbon = new Ribbon(this.map, 9000);
        this.own(this.ribbon);
        this.scene.add(this.ribbon.mesh);

        const clashTex = this.own(makeClashTexture());
        this.clashMats = {
            front: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#fff6e0', depthTest: false, depthWrite: false, toneMapped: false })),
            flank: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#ffae3a', depthTest: false, depthWrite: false, toneMapped: false })),
            rear: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#ff4b3a', depthTest: false, depthWrite: false, toneMapped: false })),
        };
        // 斬り合いの印（組ごとに 1 つ。味方 8・敵 10 部隊まで）
        for (let i = 0; i < 12; i++) {
            const sp = new THREE.Sprite(this.clashMats.front);
            sp.renderOrder = 12;
            sp.visible = false;
            this.clashSprites.push(sp);
            this.scene.add(sp);
        }
        this.applyCam();
    }

    /** 特殊能力の範囲の輪（能力ごと）・約束の安全地点と対象の輪。能力も約束もない合戦（架空の第一章）では何も作らない */
    private buildAbilityRings(s: BattleState): void {
        const flat = (geo: THREE.BufferGeometry) => {
            geo.rotateX(-Math.PI / 2);
            return geo;
        };
        for (const r of s.abilityList) {
            const rad = Math.max(ABILITY_DATA[r.id].radius, SELF_RING_R);
            const col = r.side === 'ally' ? (ABILITY_COLOR[r.id] ?? ABILITY_COLOR.ieyasu_rally) : ABILITY_COLOR.enemy;
            const ringMat = this.own(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }));
            const fillMat = this.own(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthTest: false, depthWrite: false, toneMapped: false }));
            const ring = new THREE.Mesh(this.own(flat(new THREE.RingGeometry(rad - 2.2, rad, 72, 1))), ringMat);
            const fill = new THREE.Mesh(this.own(flat(new THREE.CircleGeometry(rad - 2.2, 72))), fillMat);
            ring.renderOrder = 8;
            fill.renderOrder = 7;
            ring.visible = fill.visible = false;
            ring.frustumCulled = fill.frustumCulled = false;
            this.scene.add(fill, ring);
            this.abilRings.push({ ring, fill, ringMat, fillMat, rad });
            // 最初の状態を覚える（作った時点で使ってあれば波紋は出さない）
            this.abilSeen.push({ usedAt: r.usedAt, ended: r.ended });
        }
        if (s.abilityList.length) {
            const geo = this.own(makeRingGeometry(0.84, 1.0, false));
            for (let k = 0; k < RIPPLE_POOL; k++) {
                const mat = this.own(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
                const mesh = new THREE.Mesh(geo, mat);
                mesh.renderOrder = 9;
                mesh.visible = false;
                mesh.frustumCulled = false;
                this.scene.add(mesh);
                this.ripples.push({ mesh, mat, unit: -1, t0: -1e9, kind: 'use' });
            }
        }
        const pl = s.pledge;
        if (pl) {
            const z = pl.safeZone;
            const y = elevationAt(this.map, z.cx, z.cz) + 0.35;
            const ringMat = this.own(new THREE.MeshBasicMaterial({ color: PLEDGE_COLOR, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, toneMapped: false }));
            const fillMat = this.own(new THREE.MeshBasicMaterial({ color: PLEDGE_COLOR, transparent: true, opacity: 0.13, depthTest: false, depthWrite: false, toneMapped: false }));
            const ring = new THREE.Mesh(this.own(flat(new THREE.RingGeometry(z.r - 1.6, z.r, 64, 1))), ringMat);
            const fill = new THREE.Mesh(this.own(flat(new THREE.CircleGeometry(z.r - 1.6, 64))), fillMat);
            ring.position.set(z.cx, y, z.cz);
            fill.position.set(z.cx, y - 0.05, z.cz);
            ring.renderOrder = 7;
            fill.renderOrder = 6;
            this.scene.add(fill, ring);
            this.safeZone = { ring, fill };
            const pm = this.own(new THREE.MeshBasicMaterial({ color: PLEDGE_COLOR, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
            this.pledgeRing = new THREE.Mesh(this.own(makeRingGeometry(0.9, 1.0, false)), pm);
            this.pledgeRing.renderOrder = 11;
            this.pledgeRing.visible = false;
            this.scene.add(this.pledgeRing);
        }
    }

    /** 毎フレーム：能力の輪・援護の結び・約束の輪 */
    private updateAbilityMarks(s: BattleState, ui: { selectedId: string | null; pending: Pending }, t: number): void {
        for (let k = 0; k < s.abilityList.length; k++) {
            const r = s.abilityList[k];
            const g = this.abilRings[k];
            const i = s.units.findIndex((u) => u.id === r.unitId);
            const v = i >= 0 ? this.vis[i] : null;
            const u = i >= 0 ? s.units[i] : null;
            const info = abilityInfo(s, r.unitId);
            let mode: 'off' | 'active' | 'preview' = 'off';
            if (v && u && v.shown && info) {
                if (info.state === 'active') mode = 'active';
                else if (info.state === 'unused' && ui.selectedId === r.unitId && u.status === 'ready') mode = 'preview';
            }
            // 使った・終わったの変わり目：波紋（持つ部隊。対象の要る能力は対象の部隊にも）
            const seen = this.abilSeen[k];
            if (seen && i >= 0) {
                if (seen.usedAt === null && r.usedAt !== null) {
                    this.startRipple(i, 'use', r.id, r.side, t);
                    const j = r.targetId ? s.units.findIndex((o) => o.id === r.targetId) : -1;
                    if (j >= 0) this.startRipple(j, 'use', r.id, r.side, t);
                }
                if (!seen.ended && r.ended) this.startRipple(i, 'end', r.id, r.side, t);
                seen.usedAt = r.usedAt;
                seen.ended = r.ended;
            }
            g.ring.visible = g.fill.visible = mode !== 'off';
            if (mode === 'off' || !v) continue;
            let x = v.px + v.sx * 0.5;
            let z = v.pz + v.sz * 0.5;
            // 後詰めの差配（対象の要る能力で、離れても効く）：効果中は、選べる距離の輪ではなく、対象の部隊を囲む小さな輪
            let scale = 1;
            if (mode === 'active' && info && info.target === 'ally_unit' && !ABILITY_DATA[r.id].leash && info.targetId) {
                const j = s.units.findIndex((o) => o.id === info.targetId);
                const e = j >= 0 ? this.vis[j] : null;
                if (e && e.shown) {
                    x = e.px + e.sx * 0.5;
                    z = e.pz + e.sz * 0.5;
                    scale = (Math.max(e.halfW, e.halfD) + 8) / g.rad;
                }
            }
            const y = elevationAt(this.map, x, z) + 0.4;
            g.ring.position.set(x, y, z);
            g.fill.position.set(x, y - 0.05, z);
            g.ring.scale.set(scale, 1, scale);
            g.fill.scale.set(scale, 1, scale);
            if (mode === 'active') {
                g.ringMat.opacity = 0.75 + Math.sin(t * 3) * 0.15;
                g.fillMat.opacity = 0.11;
            } else {
                // 使う前の範囲の見本（選んだ部隊）。援護の対象選びの間は少し濃く
                const choose = ui.pending === 'ability';
                g.ringMat.opacity = (choose ? 0.6 : 0.35) + Math.sin(t * 4) * 0.12;
                g.fillMat.opacity = choose ? 0.08 : 0.04;
            }
            // 援護の結び（効いている：実線／離れて外れている：灰色の破線）
            if (mode === 'active' && info && info.target === 'ally_unit' && info.targetId) {
                const j = s.units.findIndex((o) => o.id === info.targetId);
                const e = j >= 0 ? this.vis[j] : null;
                if (e && e.shown) {
                    const col = info.linked ? (r.side === 'ally' ? [0.85, 0.72, 1, 0.95] : [1, 0.55, 0.48, 0.9]) : [0.7, 0.7, 0.7, 0.75];
                    this.ribbon.path([[v.px, v.pz], [e.px, e.pz]], info.linked ? 1.6 : 1.1, col, info.linked ? null : { on: 3, off: 4, offset: 0 }, false, v.halfD + 1, e.halfD + 1);
                }
            }
        }
        this.updateRipples(t);
        // 約束：対象を囲む輪（戦える間）
        if (this.pledgeRing && s.pledge) {
            const i = s.units.findIndex((u) => u.id === s.pledge!.targetId);
            const v = i >= 0 ? this.vis[i] : null;
            const u = i >= 0 ? s.units[i] : null;
            if (v && u && v.shown && u.status === 'ready') {
                const x = v.px + v.sx * 0.5;
                const z = v.pz + v.sz * 0.5;
                const pulse = 1 + Math.sin(t * 2.5) * 0.05;
                this.pledgeRing.position.set(x, elevationAt(this.map, x, z) + 0.55, z);
                this.pledgeRing.rotation.set(0, -v.face, 0);
                this.pledgeRing.scale.set((v.halfW + 9) * pulse, 1, (v.halfD + 9) * pulse);
                this.pledgeRing.visible = true;
            } else this.pledgeRing.visible = false;
            // 対象が陣の中にいる間は、陣の塗りを少し濃く（数えている印）
            if (this.safeZone && u) {
                const z = s.pledge.safeZone;
                const inside = u.present && u.status === 'ready' && Math.hypot(u.x - z.cx, u.z - z.cz) <= z.r;
                (this.safeZone.fill.material as THREE.MeshBasicMaterial).opacity = inside ? 0.2 + Math.sin(t * 4) * 0.06 : 0.12;
            }
        }
    }

    /** 波紋を出す（部隊の番号 i の周り）。空きが無ければいちばん古いものを使う */
    private startRipple(i: number, kind: 'use' | 'end', id: string, side: Side, t: number): void {
        if (!this.ripples.length) return;
        let best = this.ripples[0];
        for (const p of this.ripples) if (p.t0 < best.t0) best = p;
        best.unit = i;
        best.t0 = t;
        best.kind = kind;
        best.mat.color.set(side === 'ally' ? (ABILITY_COLOR[id] ?? ABILITY_READY_COLOR) : ABILITY_COLOR.enemy);
        if (kind === 'end') best.mat.color.multiplyScalar(0.75);
    }

    /** 波紋：使った＝0.8 秒で部隊の輪の大きさから 2.6 倍へ広がって消える。終わった＝2 倍から輪の大きさへ縮んで消える（薄く） */
    private updateRipples(t: number): void {
        for (const p of this.ripples) {
            const age = t - p.t0;
            const v = p.unit >= 0 ? this.vis[p.unit] : null;
            if (!v || !v.shown || age < 0 || age > RIPPLE_SEC) {
                p.mesh.visible = false;
                continue;
            }
            const k = age / RIPPLE_SEC;
            const ease = 1 - (1 - k) * (1 - k);
            const r0 = Math.max(v.halfW, v.halfD) + 3;
            const r = p.kind === 'use' ? r0 * (1 + 1.6 * ease) : r0 * (2 - ease);
            const x = v.px + v.sx * 0.5;
            const z = v.pz + v.sz * 0.5;
            p.mesh.position.set(x, elevationAt(this.map, x, z) + 0.7, z);
            p.mesh.scale.set(r, 1, r);
            p.mat.opacity = (p.kind === 'use' ? 0.9 : 0.55) * (1 - k);
            p.mesh.visible = true;
        }
    }

    /** 後片付け（dispose）するものとして覚える。最初のものを返す */
    private own<T extends { dispose(): void }>(first: T, ...rest: { dispose(): void }[]): T {
        this.owned.push(first, ...rest);
        return first;
    }

    // ---------------------------------------------------------------- 地面

    private buildGround(): void {
        const map = this.map;
        const step = this.low ? 6 : 4;
        const W = map.width + MARGIN * 2;
        const D = map.depth + MARGIN * 2;
        const geo = new THREE.PlaneGeometry(W, D, Math.round(W / step), Math.round(D / step));
        geo.rotateX(-Math.PI / 2);
        geo.deleteAttribute('uv');
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const col = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const y = elevationAt(map, x, z);
            pos.setY(i, y);
            groundColor(map, this.passable, x, z, y, c);
            col[i * 3] = c.r;
            col[i * 3 + 1] = c.g;
            col[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.own(geo, mat);
        this.scene.add(new THREE.Mesh(geo, mat));
    }

    /**
     * 道（四角の道の区域ごとに 1 本の帯。南北に長い道は南北に、東西に長い道（水田の畦道・街道）は東西に引く）。
     * 戦場の端に触れる道は、戦場の外まで伸ばす。道の区域が 1 つの戦場（Version 14 までの戦場）は、今までと同じ形
     */
    private buildRoad(): void {
        const roads = this.map.terrain.filter((a) => a.kind === 'road' && a.rect);
        if (!roads.length) return;
        const hd = this.map.depth / 2;
        const hwMap = this.map.width / 2;
        const pts: number[] = [];
        const idx: number[] = [];
        let n = 0;
        for (const road of roads) {
            const r = road.rect!;
            const alongZ = r.z1 - r.z0 >= r.x1 - r.x0;
            // 道の長い向き（a0〜a1）と、横の真ん中・半分の幅
            const a0 = alongZ ? (r.z0 <= -hd + 1 ? -hd - MARGIN : r.z0) : r.x0 <= -hwMap + 1 ? -hwMap - MARGIN : r.x0;
            const a1 = alongZ ? (r.z1 >= hd - 1 ? hd + MARGIN : r.z1) : r.x1 >= hwMap - 1 ? hwMap + MARGIN : r.x1;
            const c = alongZ ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
            const hw = (alongZ ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2) * 0.8;
            let first = true;
            for (let a = a0; a <= a1 + 0.01; a += 4) {
                const wob = Math.sin(a * 0.03) * 1.2;
                // 東西の道は、面の表が上を向くように左右の順を入れ替える（裏の面は描かれない）
                for (const sx of alongZ ? [-1, 1] : [1, -1]) {
                    const x = alongZ ? c + wob + sx * hw : a;
                    const z = alongZ ? a : c + wob + sx * hw;
                    pts.push(x, elevationAt(this.map, x, z) + 0.12, z);
                }
                if (!first) idx.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1);
                first = false;
                n++;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ color: '#a48c63', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.own(geo, mat);
        this.scene.add(new THREE.Mesh(geo, mat));
    }

    /**
     * 水田：水を張った田の面（区域ごとに少し内側へ縮めた薄い水色の面を、15〜20 m の区画に分ける）と、区画の間の畦（低い土の盛り上がり）、
     * 苗の列（細い円すいを決まった位置に。軽い表示では間を広く）。田の中の速さ・斬り合いの不利は sim.ts の地形の決まり
     */
    private buildPaddies(): void {
        const water: THREE.BufferGeometry[] = [];
        const levees: THREE.BufferGeometry[] = [];
        const sprouts: [number, number][] = [];
        const sp = this.low ? 9 : 6;
        let k = 0;
        for (const a of this.map.terrain) {
            if (a.kind !== 'paddy' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            const nx = Math.max(1, Math.round((x1 - x0) / 18));
            const nz = Math.max(1, Math.round((z1 - z0) / 18));
            const cw = (x1 - x0) / nx;
            const cd = (z1 - z0) / nz;
            for (let i = 0; i < nx; i++) {
                for (let j = 0; j < nz; j++, k++) {
                    const g = new THREE.PlaneGeometry(cw - 1.6, cd - 1.6);
                    g.rotateX(-Math.PI / 2);
                    g.translate(x0 + (i + 0.5) * cw, 0.16, z0 + (j + 0.5) * cd);
                    g.deleteAttribute('uv');
                    water.push(g);
                }
            }
            // 畦：区画の境目（外周を含む）に、幅 1.4 m・高さ 0.5 m の土の帯
            for (let i = 0; i <= nx; i++) {
                const g = new THREE.BoxGeometry(1.4, 0.5, z1 - z0);
                levees.push(part(g, '#7d6a48', x0 + i * cw, 0.25, (z0 + z1) / 2));
            }
            for (let j = 0; j <= nz; j++) {
                const g = new THREE.BoxGeometry(x1 - x0, 0.5, 1.4);
                levees.push(part(g, '#7d6a48', (x0 + x1) / 2, 0.25, z0 + j * cd));
            }
            for (let z = z0 + sp / 2; z < z1; z += sp) {
                for (let x = x0 + sp / 2; x < x1; x += sp) {
                    if (hash01('sprout', sprouts.length + k) < 0.25) continue;
                    sprouts.push([x + (hash01('spx', sprouts.length) - 0.5) * 1.5, z + (hash01('spz', sprouts.length) - 0.5) * 1.5]);
                }
            }
        }
        if (water.length) {
            const geo = mergeGeometries(water)!;
            for (const g of water) g.dispose();
            const mat = new THREE.MeshBasicMaterial({ color: '#8fb3ad', transparent: true, opacity: 0.7, depthWrite: false });
            this.own(geo, mat);
            const m = new THREE.Mesh(geo, mat);
            m.renderOrder = 1;
            this.scene.add(m);
        }
        if (levees.length) {
            const geo = merge(levees);
            geo.computeVertexNormals();
            const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
            this.own(geo, mat);
            this.scene.add(new THREE.Mesh(geo, mat));
        }
        if (sprouts.length) {
            const g = new THREE.ConeGeometry(0.35, 1.1, 4);
            g.translate(0, 0.55, 0);
            const mat = new THREE.MeshLambertMaterial({ color: '#7fa04a' });
            this.own(g, mat);
            const m = new THREE.InstancedMesh(g, mat, sprouts.length);
            sprouts.forEach(([x, z], i) => {
                this.m4.compose(this.v3.set(x, 0.1, z), this.q.identity(), this.s3.setScalar(0.8 + hash01('sps', i) * 0.5));
                m.setMatrixAt(i, this.m4);
            });
            m.computeBoundingSphere();
            this.scene.add(m);
        }
    }

    /**
     * 橋：板の橋（区域の長い向きに渡した床板と、横に並ぶ板の継ぎ目・両側の欄干と柱）。床は川の水面より上。
     * 部隊の兵士は地面の高さ（橋の上も 0）に立つので、床は低め（0.35 m）にして兵士の足が埋もれないようにする
     */
    private buildBridges(): void {
        const parts: THREE.BufferGeometry[] = [];
        for (const a of this.map.terrain) {
            if (a.kind !== 'bridge' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            const alongZ = z1 - z0 >= x1 - x0;
            const len = alongZ ? z1 - z0 : x1 - x0;
            const wid = alongZ ? x1 - x0 : z1 - z0;
            const cx = (x0 + x1) / 2;
            const cz = (z0 + z1) / 2;
            // 床（少し岸へはみ出す）
            const deck = alongZ ? new THREE.BoxGeometry(wid, 0.3, len + 4) : new THREE.BoxGeometry(len + 4, 0.3, wid);
            parts.push(part(deck, '#8a6a44', cx, 0.2, cz));
            // 板の継ぎ目（2 m ごとの暗い細い帯）
            for (let t = -len / 2; t <= len / 2; t += 2) {
                const g = alongZ ? new THREE.BoxGeometry(wid * 0.98, 0.05, 0.18) : new THREE.BoxGeometry(0.18, 0.05, wid * 0.98);
                parts.push(part(g, '#5e4630', alongZ ? cx : cx + t, 0.37, alongZ ? cz + t : cz));
            }
            // 欄干（両側の横木）と柱（6 m ごと）
            for (const side of [-1, 1]) {
                const off = side * (wid / 2 - 0.3);
                const rail = alongZ ? new THREE.BoxGeometry(0.3, 0.25, len + 4) : new THREE.BoxGeometry(len + 4, 0.25, 0.3);
                parts.push(part(rail, '#6b4f33', alongZ ? cx + off : cx, 1.3, alongZ ? cz : cz + off));
                for (let t = -len / 2 - 2; t <= len / 2 + 2.01; t += 6) {
                    const post = new THREE.BoxGeometry(0.4, 1.4, 0.4);
                    parts.push(part(post, '#5a4128', alongZ ? cx + off : cx + t, 0.85, alongZ ? cz + t : cz + off));
                }
            }
            // 橋脚（川の中に、床の下の太い柱を 8 m ごと）
            for (let t = -len / 2 + 4; t <= len / 2 - 4; t += 8) {
                for (const side of [-1, 1]) {
                    const off = side * (wid / 2 - 1);
                    const pier = new THREE.CylinderGeometry(0.5, 0.6, 2.4, 6);
                    parts.push(part(pier, '#4d3a26', alongZ ? cx + off : cx + t, -0.9, alongZ ? cz + t : cz + off));
                }
            }
        }
        if (!parts.length) return;
        const geo = merge(parts);
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        this.own(geo, mat);
        const m = new THREE.Mesh(geo, mat);
        // 水面（透ける面）より後に描く
        m.renderOrder = 3;
        this.scene.add(m);
    }

    private buildMarsh(): void {
        const parts: THREE.BufferGeometry[] = [];
        for (const a of this.map.terrain) {
            if (a.kind !== 'marsh' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            // 水たまり（決まった位置に楕円）
            const n = Math.round(((x1 - x0) * (z1 - z0)) / 900);
            for (let i = 0; i < n; i++) {
                const g = new THREE.CircleGeometry(1, 14);
                g.rotateX(-Math.PI / 2);
                const rx = 6 + hash01('marsh', i) * 12;
                const rz = 4 + hash01('marsh', i + 50) * 9;
                g.scale(rx, 1, rz);
                g.rotateY(hash01('marsh', i + 90) * Math.PI);
                const x = x0 + 8 + hash01('marsh', i + 130) * (x1 - x0 - 16);
                const z = z0 + 8 + hash01('marsh', i + 170) * (z1 - z0 - 16);
                g.translate(x, 0.14, z);
                g.deleteAttribute('uv');
                g.deleteAttribute('normal');
                parts.push(g.index ? g.toNonIndexed() : g);
                g.dispose();
            }
        }
        if (parts.length) {
            const geo = mergeGeometries(parts)!;
            for (const p of parts) p.dispose();
            const mat = new THREE.MeshBasicMaterial({ color: '#7f9ea6', transparent: true, opacity: 0.75, depthWrite: false });
            this.own(geo, mat);
            const m = new THREE.Mesh(geo, mat);
            m.renderOrder = 1;
            this.scene.add(m);
        }
        // 葦の株（細い円すい）
        const reeds: [number, number, number][] = [];
        for (const a of this.map.terrain) {
            if (a.kind !== 'marsh' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            const n = Math.round(((x1 - x0) * (z1 - z0)) / 110);
            for (let i = 0; i < n; i++) {
                reeds.push([x0 + 3 + hash01('reed', i) * (x1 - x0 - 6), z0 + 3 + hash01('reed', i + 999) * (z1 - z0 - 6), 0.7 + hash01('reed', i + 555) * 0.7]);
            }
        }
        if (reeds.length) {
            const g = new THREE.ConeGeometry(0.9, 2.6, 5);
            g.translate(0, 1.3, 0);
            const mat = new THREE.MeshLambertMaterial({ color: '#7c8a4a' });
            this.own(g, mat);
            const m = new THREE.InstancedMesh(g, mat, reeds.length);
            reeds.forEach(([x, z, k], i) => {
                this.m4.compose(this.v3.set(x, 0, z), this.q.identity(), this.s3.set(k, k * (0.8 + hash01('rh', i) * 0.5), k));
                m.setMatrixAt(i, this.m4);
            });
            this.scene.add(m);
        }
    }

    /** 深い川（水の面）と浅瀬（浅い色の水と石）。川・浅瀬のない戦場では何も作らない */
    private buildWater(): void {
        const flatRect = (r: { x0: number; x1: number; z0: number; z1: number }, y: number): THREE.BufferGeometry => {
            const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
            g.rotateX(-Math.PI / 2);
            g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
            g.deleteAttribute('uv');
            return g;
        };
        const add = (kind: 'river' | 'ford', color: string, opacity: number, y: number, order: number) => {
            const parts = this.map.terrain.filter((a) => a.kind === kind && a.rect).map((a) => flatRect(a.rect!, y));
            if (!parts.length) return;
            const geo = mergeGeometries(parts)!;
            for (const p of parts) p.dispose();
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
            this.own(geo, mat);
            const m = new THREE.Mesh(geo, mat);
            m.renderOrder = order;
            this.scene.add(m);
        };
        add('river', '#3f6f8c', 0.88, 0.22, 1);
        add('ford', '#9cc3c8', 0.55, 0.3, 2);
        // 浅瀬の石（平たい多面体を決まった位置に散らす）
        const stones: [number, number, number, number][] = [];
        let k = 0;
        for (const a of this.map.terrain) {
            if (a.kind !== 'ford' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            const n = Math.round(((x1 - x0) * (z1 - z0)) / 45);
            for (let i = 0; i < n; i++, k++) {
                stones.push([x0 + 1.5 + hash01('stone', k) * (x1 - x0 - 3), z0 + 1.5 + hash01('stone', k + 700) * (z1 - z0 - 3), 0.6 + hash01('stone', k + 1400) * 1.1, hash01('stone', k + 2100) * Math.PI]);
            }
        }
        if (stones.length) {
            const g = new THREE.IcosahedronGeometry(1, 0);
            g.scale(1.3, 0.45, 1);
            const mat = new THREE.MeshLambertMaterial({ color: '#8d8a80', flatShading: true });
            this.own(g, mat);
            const m = new THREE.InstancedMesh(g, mat, stones.length);
            stones.forEach(([x, z, sc, rot], i) => {
                this.q.setFromAxisAngle(this.yAxis, rot);
                this.m4.compose(this.v3.set(x, 0.25, z), this.q, this.s3.setScalar(sc));
                m.setMatrixAt(i, this.m4);
            });
            m.computeBoundingSphere();
            this.scene.add(m);
        }
    }

    /** 崖・岩（暗い岩の盛り上がり）：区域を 8 m ほどの升に分け、高さの違う箱を並べる（1 つの形にまとめる） */
    private buildCliffs(): void {
        const parts: THREE.BufferGeometry[] = [];
        let k = 0;
        for (const a of this.map.terrain) {
            if (a.kind !== 'cliff' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            const nx = Math.max(1, Math.round((x1 - x0) / 8));
            const nz = Math.max(1, Math.round((z1 - z0) / 8));
            const cw = (x1 - x0) / nx;
            const cd = (z1 - z0) / nz;
            for (let i = 0; i < nx; i++) {
                for (let j = 0; j < nz; j++, k++) {
                    // 高さ 3〜8 m（通り道の部隊を隠しすぎないように低めに）。色は升ごとに少し明暗を変える
                    const h = 3 + hash01('cliff', k) * 5;
                    // 丘・尾根の面にある崖は、升のいちばん低い所から、いちばん高い所の上 h まで（地面に埋もれない・浮かない）
                    const mx = x0 + (i + 0.5) * cw;
                    const mz = z0 + (j + 0.5) * cd;
                    let lo = Infinity;
                    let hi = -Infinity;
                    for (const [px, pz] of [[mx, mz], [mx - cw / 2, mz - cd / 2], [mx + cw / 2, mz - cd / 2], [mx - cw / 2, mz + cd / 2], [mx + cw / 2, mz + cd / 2]] as const) {
                        const e = elevationAt(this.map, px, pz);
                        lo = Math.min(lo, e);
                        hi = Math.max(hi, e);
                    }
                    const tall = h + (hi - lo);
                    const g = new THREE.BoxGeometry(cw * 1.02, tall, cd * 1.02);
                    g.translate(mx, lo + tall / 2, mz);
                    const shade = 0.34 + hash01('cliff', k + 500) * 0.12;
                    parts.push(part(g, shade, 0, 0, 0));
                }
            }
        }
        if (!parts.length) return;
        const geo = merge(parts);
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#b0a590', flatShading: true });
        this.own(geo, mat);
        this.scene.add(new THREE.Mesh(geo, mat));
    }

    /**
     * 目標の区域の輪（地面の起伏に沿わせる）・援軍の出る所の印・狭い正面の区域の縁。
     * 目標も援軍も特殊ルールもない合戦（国境の原・歴史分岐の章）では何も作らない。
     */
    private buildFieldMarks(s: BattleState): void {
        for (const m of objectiveZoneMarks(s)) {
            const col = OBJ_COLOR[m.role];
            const ringMat = this.own(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            const fillMat = this.own(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            const { ring, fill } = this.zoneShapes(m.zone, 2);
            const rm = new THREE.Mesh(this.own(ring), ringMat);
            const fm = new THREE.Mesh(this.own(fill), fillMat);
            rm.renderOrder = 7;
            fm.renderOrder = 6;
            this.scene.add(fm, rm);
            this.objZones.push({ id: m.id, role: m.role, ringMat, fillMat, state: 'active' });
        }
        for (const r of s.setup.fieldRules?.specialRules ?? []) {
            if (r.type !== 'narrow_frontage') continue;
            const mat = this.own(new THREE.MeshBasicMaterial({ color: NARROW_COLOR, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            const { ring, fill } = this.zoneShapes(r.zone, 1.2);
            fill.dispose();
            const rm = new THREE.Mesh(this.own(ring), mat);
            rm.renderOrder = 5;
            this.scene.add(rm);
        }
        // 援軍の出る所：地面の菱形と、細い竿の小旗（陣営の色）
        for (const r of reinforcementMarks(s)) {
            const mat = this.own(new THREE.MeshBasicMaterial({ color: SIDE_COLOR[r.side], transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
            const y = elevationAt(this.map, r.x, r.z);
            const dia = new THREE.CircleGeometry(6, 4);
            dia.rotateX(-Math.PI / 2);
            dia.translate(r.x, y + 0.35, r.z);
            const pole = new THREE.CylinderGeometry(0.25, 0.25, 9, 5);
            pole.translate(r.x, y + 4.5, r.z);
            const flag = new THREE.BufferGeometry();
            flag.setAttribute('position', new THREE.Float32BufferAttribute([r.x, y + 9, r.z, r.x + 4.5, y + 7.8, r.z, r.x, y + 6.6, r.z], 3));
            flag.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
            for (const g of [dia, pole]) g.deleteAttribute('uv');
            const geo = mergeGeometries([dia.toNonIndexed(), pole.toNonIndexed(), flag])!;
            dia.dispose();
            pole.dispose();
            flag.dispose();
            this.own(geo);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.renderOrder = 4;
            this.scene.add(mesh);
            this.reinfMarks.push({ at: r.at, mat });
        }
    }

    /** 区域の縁の帯（幅 w）と塗り。地面の起伏（丘）に沿わせる */
    private zoneShapes(z: Zone, w: number): { ring: THREE.BufferGeometry; fill: THREE.BufferGeometry } {
        let ring: THREE.BufferGeometry;
        let fill: THREE.BufferGeometry;
        if (z.circle) {
            const { cx, cz, r } = z.circle;
            ring = new THREE.RingGeometry(Math.max(0.5, r - w), r, 72, 1);
            fill = new THREE.RingGeometry(0.01, Math.max(0.5, r - w), 48, 6);
            for (const g of [ring, fill]) {
                g.rotateX(-Math.PI / 2);
                g.translate(cx, 0, cz);
            }
        } else if (z.rect) {
            const { x0, x1, z0, z1 } = z.rect;
            const strip = (ax: number, az: number, bx: number, bz: number) => {
                const len = Math.hypot(bx - ax, bz - az);
                const g = new THREE.PlaneGeometry(len, w, Math.max(1, Math.round(len / 6)), 1);
                g.rotateX(-Math.PI / 2);
                g.rotateY(-Math.atan2(bz - az, bx - ax));
                g.translate((ax + bx) / 2, 0, (az + bz) / 2);
                g.deleteAttribute('uv');
                const out = g.toNonIndexed();
                g.dispose();
                return out;
            };
            const h = w / 2;
            const sides = [strip(x0, z0 + h, x1, z0 + h), strip(x0, z1 - h, x1, z1 - h), strip(x0 + h, z0 + w, x0 + h, z1 - w), strip(x1 - h, z0 + w, x1 - h, z1 - w)];
            ring = mergeGeometries(sides)!;
            for (const g of sides) g.dispose();
            fill = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(1, Math.round((x1 - x0) / 8)), Math.max(1, Math.round((z1 - z0) / 8)));
            fill.rotateX(-Math.PI / 2);
            fill.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
        } else {
            ring = new THREE.BufferGeometry();
            fill = new THREE.BufferGeometry();
        }
        for (const g of [ring, fill]) {
            const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
            if (!pos) continue;
            for (let i = 0; i < pos.count; i++) pos.setY(i, elevationAt(this.map, pos.getX(i), pos.getZ(i)) + 0.45);
            pos.needsUpdate = true;
        }
        return { ring, fill };
    }

    /** 毎フレーム：目標の区域の色（果たした・果たせない）、確保を数えている間は塗りを濃く。援軍が着いたら印を薄く */
    private updateFieldMarks(s: BattleState, t: number): void {
        for (const z of this.objZones) {
            const st = objectiveStateOf(s, z.id);
            if (st !== z.state) {
                z.state = st;
                const col = st === 'done' ? OBJ_COLOR.done : st === 'failed' ? OBJ_COLOR.failed : OBJ_COLOR[z.role];
                z.ringMat.color.set(col);
                z.fillMat.color.set(col);
            }
            const counting = st === 'active' && objectiveZoneCounting(s, z.id);
            z.ringMat.opacity = st === 'active' ? (counting ? 0.8 + Math.sin(t * 5) * 0.15 : 0.8) : 0.55;
            z.fillMat.opacity = counting ? 0.16 + Math.sin(t * 5) * 0.05 : st === 'active' ? 0.08 : 0.05;
        }
        for (const r of this.reinfMarks) r.mat.opacity = s.t >= r.at ? 0.35 : 0.65 + Math.sin(t * 3) * 0.2;
    }

    /** 戦場の縁の線と、退き口の印（味方は水色・敵は赤の山形） */
    private buildEdges(): void {
        const hw = this.map.width / 2;
        const hd = this.map.depth / 2;
        const pts: THREE.Vector3[] = [];
        const edge = (x: number, z: number) => pts.push(new THREE.Vector3(x, elevationAt(this.map, x, z) + 0.3, z));
        for (let x = -hw; x < hw; x += 20) edge(x, -hd);
        for (let z = -hd; z < hd; z += 20) edge(hw, z);
        for (let x = hw; x > -hw; x -= 20) edge(x, hd);
        for (let z = hd; z > -hd; z -= 20) edge(-hw, z);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const m = new THREE.LineBasicMaterial({ color: '#efe3bf', transparent: true, opacity: 0.45 });
        this.own(g, m);
        this.scene.add(new THREE.LineLoop(g, m));

        // 丘の等高線（3 m ごと。丘の広がりと高さが見て分かるように）
        const seg: number[] = [];
        for (const a of this.map.terrain) {
            if (a.kind !== 'hill' || !a.circle) continue;
            const H = a.height ?? 10;
            for (let h = 0.4; h < H; h += 3) {
                const r = a.circle.r * Math.sqrt(1 - h / H);
                const n = 64;
                for (let i = 0; i < n; i++) {
                    const t0 = (i / n) * Math.PI * 2;
                    const t1 = ((i + 1) / n) * Math.PI * 2;
                    seg.push(a.circle.cx + Math.cos(t0) * r, h + 0.25, a.circle.cz + Math.sin(t0) * r, a.circle.cx + Math.cos(t1) * r, h + 0.25, a.circle.cz + Math.sin(t1) * r);
                }
            }
        }
        // カプセルの丘（尾根）の等高線：線分の両側の直線と、両端の半円（線分から同じ距離の輪）
        for (const a of this.map.terrain) {
            if (a.kind !== 'hill' || !a.capsule) continue;
            const { ax, az, bx, bz } = a.capsule;
            const H = a.height ?? 10;
            const ang = Math.atan2(bz - az, bx - ax);
            for (let h = 0.4; h < H; h += 3) {
                const r = a.capsule.r * Math.sqrt(1 - h / H);
                const y = h + 0.25;
                const n = 24;
                // 輪の点：b の端の半円（ang−90°〜ang+90°）→ a の端の半円（ang+90°〜ang+270°）
                const ring: [number, number][] = [];
                for (let i = 0; i <= n; i++) {
                    const t = ang - Math.PI / 2 + (i / n) * Math.PI;
                    ring.push([bx + Math.cos(t) * r, bz + Math.sin(t) * r]);
                }
                for (let i = 0; i <= n; i++) {
                    const t = ang + Math.PI / 2 + (i / n) * Math.PI;
                    ring.push([ax + Math.cos(t) * r, az + Math.sin(t) * r]);
                }
                for (let i = 0; i < ring.length; i++) {
                    const p0 = ring[i]!;
                    const p1 = ring[(i + 1) % ring.length]!;
                    seg.push(p0[0], y, p0[1], p1[0], y, p1[1]);
                }
            }
        }
        if (seg.length) {
            const cg = new THREE.BufferGeometry();
            cg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
            const cm = new THREE.LineBasicMaterial({ color: '#4f5a2a', transparent: true, opacity: 0.55 });
            this.own(cg, cm);
            this.scene.add(new THREE.LineSegments(cg, cm));
        }

        const pos: number[] = [];
        const col: number[] = [];
        const chevron = (x: number, z: number, dir: number, color: string) => {
            const c = new THREE.Color(color);
            // dir：+1 は南向き（+z）、-1 は北向き
            const w = 9;
            const t = 2.2;
            const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
                pos.push(ax, 0.3, az, bx, 0.3, bz, cx, 0.3, cz);
                for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
            };
            const tip = z + dir * 5;
            // 左の腕・右の腕（太さ t）
            tri(x - w, z, x, tip, x - w, z + dir * t);
            tri(x - w, z + dir * t, x, tip, x, tip + dir * t);
            tri(x, tip, x + w, z, x + w, z + dir * t);
            tri(x, tip, x + w, z + dir * t, x, tip + dir * t);
        };
        for (const side of ['ally', 'enemy'] as Side[]) {
            const e = this.map.exits[side];
            const dir = e.z > 0 ? 1 : -1;
            for (let i = 0; i < 3; i++) chevron(e.x, e.z - dir * (22 - i * 8), dir, SIDE_COLOR[side]);
        }
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        eg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const em = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        this.own(eg, em);
        const mesh = new THREE.Mesh(eg, em);
        mesh.renderOrder = 2;
        this.scene.add(mesh);
    }

    /**
     * 林の木：既存の松（tree_pine_far）を小さくして並べる（素材の部品ごとに InstancedMesh）。src が null なら円すいの木。
     * 読み込みが後から終わったら、もう一度呼んで差し替える。
     */
    setTrees(src: THREE.Object3D | null): void {
        if (this.trees) {
            this.scene.remove(this.trees);
            this.trees.traverse((o) => {
                const m = o as THREE.InstancedMesh;
                if (m.isInstancedMesh) m.dispose();
            });
        }
        const spots = this.treeSpots();
        const group = new THREE.Group();
        const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
        if (src) {
            src.updateMatrixWorld(true);
            src.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (!mesh.isMesh) return;
                parts.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material, local: mesh.matrixWorld.clone() });
                this.own(mesh.geometry);
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const m of mats) {
                    this.own(m);
                    const std = m as THREE.MeshStandardMaterial;
                    for (const t of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.alphaMap]) if (t) this.own(t);
                }
            });
        } else {
            const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 5);
            trunk.translate(0, 1.5, 0);
            const crown = new THREE.ConeGeometry(3.2, 7.5, 7);
            crown.translate(0, 6.2, 0);
            const tm = new THREE.MeshLambertMaterial({ color: '#5a4630' });
            const cm = new THREE.MeshLambertMaterial({ color: '#2f5a33' });
            this.own(trunk, crown, tm, cm);
            parts.push({ geo: trunk, mat: tm, local: new THREE.Matrix4() }, { geo: crown, mat: cm, local: new THREE.Matrix4() });
        }
        if (src) {
            // 遠くから見ると松の葉（切り抜きの画像）は細かすぎて消えるので、葉の塊の芯（濃い緑の多面体）を中に入れる。林が遠くからも林に見えるように
            const core = new THREE.IcosahedronGeometry(1, 1);
            const cm = new THREE.MeshLambertMaterial({ color: '#2d4a2b', flatShading: true });
            this.own(core, cm);
            parts.push({ geo: core, mat: cm, local: new THREE.Matrix4().compose(new THREE.Vector3(0, 7.9, 0), new THREE.Quaternion(), new THREE.Vector3(3.6, 2.9, 3.6)) });
        }
        for (const p of parts) {
            const im = new THREE.InstancedMesh(p.geo, p.mat, spots.length);
            spots.forEach((t, i) => {
                this.q.setFromAxisAngle(this.yAxis, t.rot);
                this.m4.compose(this.v3.set(t.x, elevationAt(this.map, t.x, t.z) - 0.1, t.z), this.q, this.s3.setScalar(t.scale));
                this.m4.multiply(p.local);
                im.setMatrixAt(i, this.m4);
            });
            im.computeBoundingSphere();
            group.add(im);
        }
        this.trees = group;
        this.scene.add(group);
    }

    /** 林の木の位置（決まった配置。格子を少しずらす） */
    private treeSpots(): { x: number; z: number; rot: number; scale: number }[] {
        const out: { x: number; z: number; rot: number; scale: number }[] = [];
        const sp = this.low ? 24 : 16;
        for (const a of this.map.terrain) {
            if (a.kind !== 'woods' || !a.rect) continue;
            const { x0, x1, z0, z1 } = a.rect;
            let i = 0;
            for (let z = z0 + sp / 2; z < z1; z += sp) {
                for (let x = x0 + sp / 2; x < x1; x += sp) {
                    i++;
                    const jx = (hash01('tx', i) - 0.5) * sp * 0.7;
                    const jz = (hash01('tz', i) - 0.5) * sp * 0.7;
                    const px = Math.min(x1 - 3, Math.max(x0 + 3, x + jx));
                    const pz = Math.min(z1 - 3, Math.max(z0 + 3, z + jz));
                    out.push({ x: px, z: pz, rot: hash01('tr', i) * Math.PI * 2, scale: 0.5 + hash01('ts', i) * 0.2 });
                }
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- 旗

    private flagMats = new Map<string, THREE.Material>();

    /** のぼりの材質（家ごとに 1 つ。紋の画像） */
    private bannerMaterial(clan: ClanId): THREE.Material {
        let mat = this.flagMats.get(clan);
        if (!mat) {
            const tex = this.own(makeBannerTexture(clan));
            mat = this.own(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: '#222222', emissiveMap: tex }));
            this.flagMats.set(clan, mat);
        }
        return mat;
    }

    // ---------------------------------------------------------------- 毎フレーム

    /**
     * 状態に合わせて描くものを動かす（読むだけ）。dt は実時間（秒。一時停止中も動く：旗のはためき・選んだ輪）。
     */
    update(s: BattleState, dt: number, ui: { selectedId: string | null; pending: Pending }): void {
        this.time += dt;
        const t = this.time;
        const kPos = 1 - Math.exp(-14 * dt);
        const kFace = 1 - Math.exp(-8 * dt);
        const kShift = 1 - Math.exp(-3 * dt);
        this.ribbon.begin();
        let clashN = 0;
        const seenPairs = new Set<string>();
        const tmpC = new THREE.Color();
        // 援護の対象を選んでいる間：選べる味方の輪を明るく点滅
        const validTargets = ui.pending === 'ability' && ui.selectedId ? (abilityInfo(s, ui.selectedId)?.validTargets ?? null) : null;

        for (let i = 0; i < this.vis.length; i++) {
            const v = this.vis[i];
            const u = s.units[i];
            const visible = u.present && (u.side === 'ally' || u.seenBy.ally);
            // 出てきた・大きく跳んだ（早送りなど）ときは、なめらかにせずその場へ
            if (visible && (!v.shown || Math.abs(u.x - v.px) + Math.abs(u.z - v.pz) > 30)) {
                v.px = u.x;
                v.pz = u.z;
                v.face = u.facing;
                v.sx = v.sz = 0;
            }
            v.shown = visible;
            if (visible) {
                v.px += (u.x - v.px) * kPos;
                v.pz += (u.z - v.pz) * kPos;
                v.face += angleDelta(v.face, u.facing) * kFace;
            }
            if (u.status === 'routed') v.routT = v.routT < 0 ? 0 : v.routT + dt;
            // 斬り合い：前の列どうしが触れ合う所まで見た目を寄せる
            let wantX = 0;
            let wantZ = 0;
            if (visible && u.engagedWith) {
                const j = s.units.findIndex((o) => o.id === u.engagedWith);
                const e = j >= 0 ? this.vis[j] : null;
                if (e && e.shown) {
                    const dx = e.px - v.px;
                    const dz = e.pz - v.pz;
                    const d = Math.hypot(dx, dz) || 1;
                    const sh = clashShift(d, v.halfD, e.halfD);
                    wantX = (dx / d) * sh;
                    wantZ = (dz / d) * sh;
                    // 斬り合いの印（組ごとに 1 つ。当たる向きで色を変える）
                    const key = u.id < e.id ? `${u.id}|${e.id}` : `${e.id}|${u.id}`;
                    if (!seenPairs.has(key) && clashN < this.clashSprites.length) {
                        seenPairs.add(key);
                        const o = s.units[j];
                        const a1 = attackArc(o, u.x, u.z);
                        const a2 = o.engagedWith === u.id ? attackArc(u, o.x, o.z) : 'front';
                        const worst = a1 === 'rear' || a2 === 'rear' ? 'rear' : a1 === 'flank' || a2 === 'flank' ? 'flank' : 'front';
                        const sp = this.clashSprites[clashN++];
                        sp.material = this.clashMats[worst];
                        const mx = (v.px + e.px) / 2;
                        const mz = (v.pz + e.pz) / 2;
                        sp.position.set(mx, elevationAt(this.map, mx, mz) + 7, mz);
                        const pulse = 1 + Math.sin(t * 8) * 0.12;
                        sp.scale.setScalar((worst === 'front' ? 7 : 9) * pulse);
                        sp.visible = true;
                    }
                }
            }
            v.sx += (wantX - v.sx) * kShift;
            v.sz += (wantZ - v.sz) * kShift;

            // 旗の位置（描くのは TroopLayer）
            if (visible) {
                // 隊列の後ろ（向きの反対）に立てる。本陣は真ん中
                const back = u.isHq ? 0 : v.halfD + 1.5;
                const bx = v.px + v.sx - Math.sin(v.face) * back;
                const bz = v.pz + v.sz + Math.cos(v.face) * back;
                v.flagX = bx;
                v.flagY = elevationAt(this.map, bx, bz);
                v.flagZ = bz;
                v.bannerYaw = Math.sin(t * 1.7 + v.seed) * 0.18;
                v.flagTilt = u.status === 'routed' ? Math.min(0.55, v.routT * 0.4) : 0;
            }

            // 陣営の輪（前の向きの印つき）
            if (visible && u.status === 'ready') {
                const rx = v.halfW + 3;
                const rz = v.halfD + 3;
                this.q.setFromAxisAngle(this.yAxis, -v.face);
                const cx = v.px + v.sx * 0.5;
                const cz = v.pz + v.sz * 0.5;
                this.m4.compose(this.v3.set(cx, elevationAt(this.map, cx, cz) + 0.5, cz), this.q, this.s3.set(rx, 1, rz));
                this.ringMesh.setMatrixAt(i, this.m4);
                let k = 1;
                let col = SIDE_COLOR[u.side];
                if (ui.pending === 'attack' && u.side === 'enemy') k = 1.25 + Math.sin(t * 7) * 0.35;
                if (validTargets) {
                    // 能力の対象選び：選べる部隊は淡い青緑で点滅、選べない部隊（持ち主を除く）は薄く
                    if (validTargets.includes(u.id)) {
                        col = ABILITY_READY_COLOR;
                        k = 1.05 + Math.sin(t * 6) * 0.3;
                    } else if (u.id !== ui.selectedId) k = 0.3;
                }
                tmpC.set(col).multiplyScalar(k);
                this.ringMesh.setColorAt(i, tmpC);
            } else if (!u.arrived && u.status === 'ready' && u.side === 'ally') {
                // 着く前の味方：着く所に薄い輪
                this.q.setFromAxisAngle(this.yAxis, -u.facing);
                this.m4.compose(this.v3.set(u.x, elevationAt(this.map, u.x, u.z) + 0.5, u.z), this.q, this.s3.set(v.halfW + 3, 1, v.halfD + 3));
                this.ringMesh.setMatrixAt(i, this.m4);
                tmpC.set(SIDE_COLOR.ally).multiplyScalar(0.35 + 0.15 * Math.sin(t * 3));
                this.ringMesh.setColorAt(i, tmpC);
            } else {
                this.ringMesh.setMatrixAt(i, this.zero);
            }

            // 命令の線（味方のみ。選んだ部隊は太く明るく）
            if (u.side === 'ally' && u.status === 'ready') this.orderLine(s, u, v, ui.selectedId === u.id);
            // 矢の線（見えている部隊どうし）
            if (visible && u.shootingAt) {
                const j = s.units.findIndex((o) => o.id === u.shootingAt);
                const e = j >= 0 ? this.vis[j] : null;
                if (e && e.shown) {
                    const col = u.side === 'ally' ? [1, 0.9, 0.45, 0.8] : [1, 0.45, 0.35, 0.8];
                    this.ribbon.path([[v.px, v.pz], [e.px, e.pz]], 0.9, col, { on: 4, off: 5, offset: t * 18 }, false, v.halfD, e.halfD);
                }
            }
        }
        this.ringMesh.instanceMatrix.needsUpdate = true;
        if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
        // 兵士と旗（画面外の部隊は書かない。カメラの行列は applyCam で今のもの）
        this.troops.update(s, this.vis, this.camera, t, dt);
        for (let i = clashN; i < this.clashSprites.length; i++) this.clashSprites[i].visible = false;

        // 選んだ部隊の輪
        const si = ui.selectedId ? s.units.findIndex((u) => u.id === ui.selectedId) : -1;
        const sv = si >= 0 ? this.vis[si] : null;
        const su = si >= 0 ? s.units[si] : null;
        if (sv && su && (sv.shown || (!su.arrived && su.status === 'ready'))) {
            const x = sv.shown ? sv.px + sv.sx * 0.5 : su.x;
            const z = sv.shown ? sv.pz + sv.sz * 0.5 : su.z;
            const pulse = 1 + Math.sin(t * 5) * 0.04;
            this.selRing.position.set(x, elevationAt(this.map, x, z) + 0.6, z);
            this.selRing.rotation.set(0, -(sv.shown ? sv.face : su.facing), 0);
            this.selRing.scale.set((sv.halfW + 5.5) * pulse, 1, (sv.halfD + 5.5) * pulse);
            this.selRing.visible = true;
        } else this.selRing.visible = false;

        if (this.abilRings.length || this.pledgeRing) this.updateAbilityMarks(s, ui, t);
        if (this.objZones.length || this.reinfMarks.length) this.updateFieldMarks(s, t);
        this.ribbon.end();
    }

    /** 命令の線：移動は白っぽい水色、攻撃は橙、撤退は灰色。着く所に矢じり。道探しの戦場では、たどる道（川・崖を回る）に沿って引く */
    private orderLine(s: BattleState, u: UnitState, v: UnitVis, selected: boolean): void {
        const from: [number, number] = v.shown ? [v.px, v.pz] : [u.x, u.z];
        const w = selected ? 2.0 : 1.2;
        const a = selected ? 0.95 : 0.55;
        const o = u.order;
        if (o.type === 'move') {
            if (Math.hypot(o.x - from[0], o.z - from[1]) < 4) return;
            this.ribbon.polyline(this.routeTo(u, from, o.x, o.z), w, [0.75, 0.95, 1, a], null, true, v.halfD, 0);
        } else if (o.type === 'attack') {
            const j = s.units.findIndex((x) => x.id === o.targetId);
            const e = j >= 0 ? this.vis[j] : null;
            if (!e || !e.shown) return;
            this.ribbon.path([from, [e.px, e.pz]], w, [1, 0.55, 0.25, a], null, true, v.halfD, e.halfD + 2);
        } else if (o.type === 'retreat') {
            const ex = exitPointFor(s, u);
            this.ribbon.polyline(this.routeTo(u, from, ex.x, ex.z), w, [0.8, 0.8, 0.8, a * 0.8], { on: 6, off: 4, offset: 0 }, true, v.halfD, 0);
        }
    }

    /** from から (x, z) までの線の点：その行き先の道（sim の道探し）があれば、まだ通っていない点を通る。無ければまっすぐ */
    private routeTo(u: UnitState, from: [number, number], x: number, z: number): [number, number][] {
        const p = u.path;
        if (!p || p.idx >= p.pts.length || Math.hypot(p.goalX - x, p.goalZ - z) > 6) return [from, [x, z]];
        const pts: [number, number][] = [from];
        for (let i = p.idx; i < p.pts.length; i++) pts.push([p.pts[i].x, p.pts[i].z]);
        const last = pts[pts.length - 1];
        if (Math.hypot(last[0] - x, last[1] - z) > 1) pts.push([x, z]);
        return pts;
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
        this.lastCalls = renderer.info.render.calls;
    }

    /** 開発用の数え上げ：見えている兵士の数・部隊ごとの人数・描画の呼び出しの数（直前のフレーム）・InstancedMesh ごとの数 */
    troopStats(): TroopStats & { drawCalls: number } {
        return { ...this.troops.stats(), drawCalls: this.lastCalls };
    }

    // ---------------------------------------------------------------- カメラ

    resize(w: number, h: number): void {
        this.width = Math.max(1, w);
        this.height = Math.max(1, h);
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.applyCam();
    }

    applyCam(): void {
        this.cam = clampCam(this.cam, this.map, this.maxDist);
        const p = THREE.MathUtils.degToRad(CAM.pitchDeg);
        const { tx, tz, dist } = this.cam;
        this.camera.position.set(tx, Math.sin(p) * dist, tz + Math.cos(p) * dist);
        this.camera.lookAt(tx, 0, tz);
        this.camera.updateMatrixWorld();
        const fog = this.scene.fog as THREE.Fog;
        fog.near = dist * 1.6;
        fog.far = dist * 3.4;
    }

    /**
     * 戦場全体が、UI に隠れない所（insets：上下左右の px）に収まる距離と位置にする。引ける上限もこれで決める。
     */
    fit(insets: { top: number; bottom: number; left: number; right: number }, keepCamera = false): void {
        const prev = { ...this.cam };
        const hw = this.map.width / 2;
        const hd = this.map.depth / 2;
        const freeW = Math.max(50, this.width - insets.left - insets.right);
        const freeH = Math.max(50, this.height - insets.top - insets.bottom);
        const cx = insets.left + freeW / 2;
        const cy = insets.top + freeH / 2;
        const corners = [
            [-hw, -hd],
            [hw, -hd],
            [hw, hd],
            [-hw, hd],
        ];
        const tryDist = (dist: number): boolean => {
            this.maxDist = 1e5;
            this.cam = { tx: 0, tz: 0, dist };
            this.applyCam();
            // 戦場の真ん中（北の縁と南の縁の中間）が、UI に隠れない所の中心に来るように平行に動かす（地面の上では平行移動で正確に合う）
            const top = this.project(0, 0, -hd).y;
            const bot = this.project(0, 0, hd).y;
            const mid = this.groundAtPlane(this.width / 2, (top + bot) / 2, 0);
            const at = this.groundAtPlane(cx, cy, 0);
            if (mid && at) {
                this.cam.tx += mid.x - at.x;
                this.cam.tz += mid.z - at.z;
                this.applyCam();
            }
            for (const [x, z] of corners) {
                const p = this.project(x, 0, z);
                if (p.off || p.x < insets.left - 1 || p.x > this.width - insets.right + 1 || p.y < insets.top - 1 || p.y > this.height - insets.bottom + 1) return false;
            }
            return true;
        };
        let lo = 50;
        let hi = 3000;
        for (let i = 0; i < 22; i++) {
            const mid = (lo + hi) / 2;
            if (tryDist(mid)) hi = mid;
            else lo = mid;
        }
        tryDist(hi);
        const fitted = { ...this.cam };
        this.maxDist = Math.max(CAM.minDist * 2, hi * 1.2);
        this.fitDist = hi;
        // 利用者が動かしたカメラは、画面の大きさが変わっても（スマホのツールバーの出入りなど）そのまま（引ける上限だけ直す）
        this.cam = keepCamera ? prev : fitted;
        this.applyCam();
    }

    /** 見ている地点を、画面の上で (x0,y0) から (x1,y1) へ動かしたように（地図をつかんで動かす） */
    panByScreen(x0: number, y0: number, x1: number, y1: number): void {
        const a = this.groundAtPlane(x0, y0, 0);
        const b = this.groundAtPlane(x1, y1, 0);
        if (!a || !b) return;
        this.cam.tx += a.x - b.x;
        this.cam.tz += a.z - b.z;
        this.applyCam();
    }

    /** カメラの距離の、「全体」の距離に対する割合（1 で全体。寄るほど小さい） */
    zoomRatio(): number {
        return this.cam.dist / Math.max(1, this.fitDist);
    }

    /** 寄る（factor < 1）・引く（> 1）。画面の (sx, sy) の下の地点が動かないように */
    zoomAt(factor: number, sx: number, sy: number): void {
        const a = this.groundAtPlane(sx, sy, 0);
        this.cam.dist *= factor;
        this.applyCam();
        const b = this.groundAtPlane(sx, sy, 0);
        if (a && b) {
            this.cam.tx += a.x - b.x;
            this.cam.tz += a.z - b.z;
            this.applyCam();
        }
    }

    centerOn(x: number, z: number): void {
        this.cam.tx = x;
        this.cam.tz = z;
        this.applyCam();
    }

    /** 世界の点 → 画面（CSS px） */
    project(x: number, y: number, z: number): ScreenPt {
        const v = this.v3.set(x, y, z).project(this.camera);
        return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, off: v.z > 1 || v.z < -1 };
    }

    /** 画面の点の下の、高さ h の水平面上の点 */
    private groundAtPlane(sx: number, sy: number, h: number): { x: number; z: number } | null {
        this.ray.setFromCamera(new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1), this.camera);
        const r = this.ray.ray;
        if (Math.abs(r.direction.y) < 1e-6) return null;
        const k = (h - r.origin.y) / r.direction.y;
        if (k <= 0) return null;
        return { x: r.origin.x + r.direction.x * k, z: r.origin.z + r.direction.z * k };
    }

    /** 画面の点の下の地面（丘の高さも考える） */
    groundAt(sx: number, sy: number): { x: number; z: number } | null {
        let h = 0;
        let p = this.groundAtPlane(sx, sy, h);
        for (let i = 0; i < 4 && p; i++) {
            h = elevationAt(this.map, p.x, p.z);
            p = this.groundAtPlane(sx, sy, h);
        }
        return p;
    }

    /** 画面の点に一番近い、見えている部隊（隊列の広がりか tolPx の近さの中） */
    pick(s: BattleState, sx: number, sy: number, tolPx: number): string | null {
        let best: string | null = null;
        let bestScore = 1;
        for (let i = 0; i < this.vis.length; i++) {
            const v = this.vis[i];
            const u = s.units[i];
            if (!v.shown) continue;
            const y = elevationAt(this.map, v.px, v.pz);
            const c = this.project(v.px + v.sx * 0.5, y + 1.5, v.pz + v.sz * 0.5);
            if (c.off) continue;
            const edge = this.project(v.px + v.sx * 0.5 + Math.max(v.halfW, v.halfD) + 2, y + 1.5, v.pz + v.sz * 0.5);
            const r = Math.max(tolPx, Math.hypot(edge.x - c.x, edge.y - c.y));
            // 旗のあたりも部隊の一部として押せる
            const fl = this.project(v.flagX, v.flagY + POLE_H * 0.7, v.flagZ);
            const d = Math.min(Math.hypot(sx - c.x, sy - c.y), Math.hypot(sx - fl.x, sy - fl.y) * 1.3);
            const score = d / r;
            if (score < bestScore) {
                bestScore = score;
                best = u.id;
            }
        }
        return best;
    }

    /** 部隊の名札の位置（旗の上。本陣は旗が高い）。能力の印の点滅も、この位置の名札で出す */
    labelAnchor(i: number): { x: number; y: number; z: number; shown: boolean } {
        const v = this.vis[i];
        const top = v.flagY + POLE_H * (v.hq ? 1.3 : 1) + 1.5;
        return { x: v.flagX, y: top, z: v.flagZ, shown: v.shown };
    }

    /** 旗の根元（地面）の位置。旗の周りの光・波紋を出すときに使う */
    flagBase(i: number): { x: number; y: number; z: number; shown: boolean } {
        const v = this.vis[i];
        return { x: v.flagX, y: v.flagY, z: v.flagZ, shown: v.shown };
    }

    /**
     * 部隊の輪の中心（なめらかにした位置に斬り合いの寄せの半分を足す。陣営の輪・選んだ輪と同じ所）と、輪の半径（広い方の半分 + 3 m）。
     * 能力の波紋・範囲の輪を部隊の周りに出すときに使う。
     */
    unitCenter(i: number): { x: number; y: number; z: number; r: number; shown: boolean } {
        const v = this.vis[i];
        const x = v.px + v.sx * 0.5;
        const z = v.pz + v.sz * 0.5;
        return { x, y: elevationAt(this.map, x, z), z, r: Math.max(v.halfW, v.halfD) + 3, shown: v.shown };
    }

    /** 部隊の表示の位置（なめらかにした中心） */
    unitPos(i: number): { x: number; z: number; shown: boolean } {
        const v = this.vis[i];
        return { x: v.px, z: v.pz, shown: v.shown };
    }

    dispose(): void {
        this.setTreesDisposeOnly();
        for (const o of this.owned) o.dispose();
        this.owned.length = 0;
        this.troops.dispose();
        this.ringMesh.dispose();
        this.scene.clear();
    }

    private setTreesDisposeOnly(): void {
        if (!this.trees) return;
        this.trees.traverse((o) => {
            const m = o as THREE.InstancedMesh;
            if (m.isInstancedMesh) m.dispose();
        });
        this.trees = null;
    }
}

// ---------------------------------------------------------------- 形と画像

function angleDelta(from: number, to: number): number {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** 地面の色（草・林の下草・湿地・丘の乾いた草・川底・浅瀬の砂・崖の岩。戦場の外・通れる範囲の外は暗く） */
function groundColor(map: BattleMap, passable: { x0: number; x1: number; z0: number; z1: number } | null, x: number, z: number, y: number, out: THREE.Color): void {
    const n = Math.sin(x * 0.047 + 0.3) * 0.5 + Math.sin(z * 0.039 + 1.1) * 0.5 + Math.sin((x + z) * 0.021) * 0.6 + Math.sin(x * 0.19 - z * 0.13) * 0.25;
    out.set('#7a8f4c');
    if (inTerrain(map, 'cliff', x, z)) out.set('#4a463f');
    else if (inTerrain(map, 'ford', x, z)) out.set('#9a916c');
    else if (inTerrain(map, 'paddy', x, z)) out.set('#6c7a4e');
    else if (inTerrain(map, 'river', x, z)) out.set('#35505c');
    else if (inTerrain(map, 'woods', x, z)) out.set('#465f33');
    else if (inTerrain(map, 'marsh', x, z)) out.set('#5b7359');
    else if (y > 0.05) {
        const k = Math.min(1, y / 12);
        out.lerp(new THREE.Color('#a2a462'), k * 0.8);
    }
    out.multiplyScalar(1 + n * 0.05);
    const inside = Math.abs(x) <= map.width / 2 && Math.abs(z) <= map.depth / 2;
    if (!inside) {
        const d = Math.max(Math.abs(x) - map.width / 2, Math.abs(z) - map.depth / 2);
        out.lerp(new THREE.Color('#56653f'), Math.min(1, 0.45 + d / 200));
    } else if (passable && (x < passable.x0 || x > passable.x1 || z < passable.z0 || z > passable.z1)) {
        // 通れる範囲の外（戦場の中）：暗くする
        out.lerp(new THREE.Color('#252a1e'), 0.55);
    }
}

/** 部分の形に色を付けて置く（まとめる前の部品） */
function part(g: THREE.BufferGeometry, color: string | number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.BufferGeometry {
    const geo = g;
    geo.deleteAttribute('uv');
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    const c = typeof color === 'number' ? new THREE.Color(color, color, color) : new THREE.Color(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    for (const p of parts) p.dispose();
    return g;
}

/** 平らな輪（半径 1。withTick なら前（-z）に向きの印の三角） */
function makeRingGeometry(inner: number, outer: number, withTick: boolean): THREE.BufferGeometry {
    const g = new THREE.RingGeometry(inner, outer, 48, 1);
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    if (!withTick) return g;
    const tick = new THREE.BufferGeometry();
    // 前（-z）の外側に三角（向きの印）
    const p = [-0.16, 0, -outer + 0.02, 0.16, 0, -outer + 0.02, 0, 0, -outer - 0.26];
    tick.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    tick.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const out = mergeGeometries([g.toNonIndexed(), tick])!;
    g.dispose();
    tick.dispose();
    return out;
}

/** のぼりの画像：家の色の地に、白い丸の中の紋（簡単な図形）と家の字 */
function makeBannerTexture(clan: ClanId): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 300;
    const g = cv.getContext('2d')!;
    g.fillStyle = CLAN_COLOR[clan];
    g.fillRect(0, 0, 128, 300);
    // 上の帯（乳＝竿に通す輪のあたり）
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, 128, 14);
    // 紋の丸
    const cx = 64;
    const cy = 78;
    g.fillStyle = '#f4efe2';
    g.beginPath();
    g.arc(cx, cy, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1712';
    g.strokeStyle = '#1b1712';
    g.lineWidth = 7;
    if (clan === 'kotosaka') {
        // 丸に一文字
        g.beginPath();
        g.arc(cx, cy, 33, 0, Math.PI * 2);
        g.stroke();
        g.fillRect(cx - 26, cy - 6, 52, 12);
    } else if (clan === 'washio') {
        // 三つ鱗
        const tri = (x: number, y: number, s: number) => {
            g.beginPath();
            g.moveTo(x, y - s);
            g.lineTo(x + s * 0.95, y + s * 0.65);
            g.lineTo(x - s * 0.95, y + s * 0.65);
            g.closePath();
            g.fill();
        };
        tri(cx, cy - 15, 17);
        tri(cx - 18, cy + 16, 17);
        tri(cx + 18, cy + 16, 17);
    } else if (clan === 'tashiro') {
        // 菱
        g.beginPath();
        g.moveTo(cx, cy - 34);
        g.lineTo(cx + 26, cy);
        g.lineTo(cx, cy + 34);
        g.lineTo(cx - 26, cy);
        g.closePath();
        g.fill();
        g.fillStyle = '#f4efe2';
        g.fillRect(cx - 26, cy - 3, 52, 6);
    } else {
        // 丸に三つ引
        g.beginPath();
        g.arc(cx, cy, 33, 0, Math.PI * 2);
        g.stroke();
        for (const dy of [-14, 0, 14]) g.fillRect(cx - 24, cy + dy - 4, 48, 8);
    }
    g.fillStyle = '#f4efe2';
    g.font = 'bold 84px "Hiragino Mincho ProN", "Noto Serif CJK JP", "Noto Sans CJK JP", "Yu Mincho", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(CLAN_CHAR[clan], cx, 210);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/** 斬り合いの印（交差した 2 本の刀と火花） */
function makeClashTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(20,14,8,0.85)';
    g.lineWidth = 11;
    const blades = () => {
        g.beginPath();
        g.moveTo(12, 12);
        g.lineTo(52, 52);
        g.moveTo(52, 12);
        g.lineTo(12, 52);
        g.stroke();
    };
    blades();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    blades();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/**
 * 地面に沿った帯（命令の線・矢の線）。毎フレーム作り直す 1 つの形（描画命令 1 回）。
 * 色は頂点ごとの RGBA。
 */
class Ribbon {
    readonly mesh: THREE.Mesh;
    private readonly pos: Float32Array;
    private readonly col: Float32Array;
    private n = 0;
    private readonly geo: THREE.BufferGeometry;
    private readonly mat: THREE.MeshBasicMaterial;

    constructor(
        private readonly map: BattleMap,
        private readonly cap: number,
    ) {
        this.pos = new Float32Array(cap * 3);
        this.col = new Float32Array(cap * 4);
        this.geo = new THREE.BufferGeometry();
        this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
        this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        this.mesh = new THREE.Mesh(this.geo, this.mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9;
    }

    begin(): void {
        this.n = 0;
    }

    private vert(x: number, z: number, c: number[]): void {
        if (this.n >= this.cap) return;
        const i = this.n++;
        this.pos[i * 3] = x;
        this.pos[i * 3 + 1] = elevationAt(this.map, x, z) + 0.7;
        this.pos[i * 3 + 2] = z;
        this.col[i * 4] = c[0];
        this.col[i * 4 + 1] = c[1];
        this.col[i * 4 + 2] = c[2];
        this.col[i * 4 + 3] = c[3];
    }

    /**
     * 2 点の間の帯（startCut・endCut だけ両端を削る）。dash があれば破線（offset で流れる）。arrow なら終わりに矢じり。
     */
    path(pts: [number, number][], width: number, color: number[], dash: { on: number; off: number; offset: number } | null, arrow: boolean, startCut: number, endCut: number): void {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1) return;
        const ux = dx / len;
        const uz = dz / len;
        const nx = -uz * (width / 2);
        const nz = ux * (width / 2);
        const s0 = Math.min(startCut, len * 0.4);
        const head = arrow ? Math.min(6 + width * 1.5, len * 0.5) : 0;
        const s1 = Math.max(s0, len - endCut - head);
        const seg = 8;
        const quad = (p0: number, p1: number) => {
            const x0 = a[0] + ux * p0;
            const z0 = a[1] + uz * p0;
            const x1 = a[0] + ux * p1;
            const z1 = a[1] + uz * p1;
            this.vert(x0 - nx, z0 - nz, color);
            this.vert(x0 + nx, z0 + nz, color);
            this.vert(x1 + nx, z1 + nz, color);
            this.vert(x0 - nx, z0 - nz, color);
            this.vert(x1 + nx, z1 + nz, color);
            this.vert(x1 - nx, z1 - nz, color);
        };
        if (dash) {
            const period = dash.on + dash.off;
            let p = s0 - (dash.offset % period);
            while (p < s1) {
                const q0 = Math.max(p, s0);
                const q1 = Math.min(p + dash.on, s1);
                if (q1 > q0) {
                    for (let q = q0; q < q1; q += seg) quad(q, Math.min(q + seg, q1));
                }
                p += period;
            }
        } else {
            for (let q = s0; q < s1; q += seg) quad(q, Math.min(q + seg, s1));
        }
        if (arrow && head > 0) {
            const bx = a[0] + ux * s1;
            const bz = a[1] + uz * s1;
            const tx = a[0] + ux * (s1 + head);
            const tz = a[1] + uz * (s1 + head);
            const hwx = -uz * (width * 1.6 + 2);
            const hwz = ux * (width * 1.6 + 2);
            this.vert(bx - hwx, bz - hwz, color);
            this.vert(bx + hwx, bz + hwz, color);
            this.vert(tx, tz, color);
        }
    }

    /** 折れ線の帯（最初の区間だけ startCut、最後の区間だけ endCut と矢じり）。点が 2 つなら path と同じ */
    polyline(pts: [number, number][], width: number, color: number[], dash: { on: number; off: number; offset: number } | null, arrow: boolean, startCut: number, endCut: number): void {
        if (pts.length <= 2) {
            this.path(pts, width, color, dash, arrow, startCut, endCut);
            return;
        }
        for (let i = 0; i + 1 < pts.length; i++) {
            const lastSeg = i + 2 === pts.length;
            this.path([pts[i], pts[i + 1]], width, color, dash, arrow && lastSeg, i === 0 ? startCut : 0, lastSeg ? endCut : 0);
        }
    }

    end(): void {
        this.geo.setDrawRange(0, this.n);
        (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }

    dispose(): void {
        this.geo.dispose();
        this.mat.dispose();
    }
}
