/**
 * 合戦の表示（three.js）。探索と同じ描画器で描く別の場面（docs/chapter1-spec.md §4 表示と操作）。
 * 見た目は暫定で安く作る（新しい高精細の素材は作らない）：
 * - 地面：丘（sim.ts の elevationAt と同じ式で盛り上げる）・林（既存の松 tree_pine_far を小さくして並べる。読めなければ円すい）・
 *   湿地（水たまりと葦）・道・戦場の縁・退き口の印。
 * - 部隊：簡単な形の兵の人形（兵 25 人ごとに 1 体、最大 30 体）を InstancedMesh でまとめて描き、隊列を組んで向きに合わせて回す。
 *   兵が減ると人形が抜け、敗走すると散って逃げる。家の色と紋の旗（のぼり）・陣営の輪（前の向きの印つき）・選んだ部隊の輪。
 * - 命令の線（移動・攻撃・撤退）と矢の線、斬り合いの印（正面は白・側面は橙・背後は赤）。
 * - 見えない敵（林の中で味方から見えていない）は描かない。
 * 描画命令はおよそ 30 前後（部隊 8 のとき）。影・画面の仕上げは使わない。
 * 状態は読むだけ（sim.ts の BattleState を書き換えない）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BattleMap, ClanId, Side } from './types';
import { attackArc, elevationAt, exitPointFor, inTerrain, unitById, type BattleState, type UnitState } from './sim';
import { CAM, clampCam, clashShift, figureCount, formationExtent, formationSlots, hash01, keepOrder, type CamState, type Pending, type Slot } from './control';

/** 家の色（旗・兵の鎧） */
export const CLAN_COLOR: Record<ClanId, string> = {
    kotosaka: '#2f55a8', washio: '#a8322a', tashiro: '#2f7d45', omori: '#c08d22',
    tokugawa: '#2f55a8', oda: '#c9a227', asai: '#3b3f8f', asakura: '#7a3b8f', ronin: '#6b6259',
};
/** 家の旗の字（仮） */
export const CLAN_CHAR: Record<ClanId, string> = { kotosaka: '琴', washio: '鷲', tashiro: '田', omori: '森', tokugawa: '徳', oda: '織', asai: '浅', asakura: '朝', ronin: '浪' };
/** 陣営の色（輪・名札）。同じ家が味方にも敵にもなるので、敵味方はこちらで見分ける */
export const SIDE_COLOR: Record<Side, string> = { ally: '#8fdcff', enemy: '#ff5b4c' };

/** 人形の大きさ（実寸の約 1.6 倍。遠くから見ても隊列が読めるように） */
const FIG = 1.6;
/** 旗の高さ（m） */
const POLE_H = 10;
/** 地面の外側の余白（m） */
const MARGIN = 300;

export interface ViewOptions {
    /** 画質「低」：木を減らし、地面を粗くする */
    low: boolean;
}

interface Range {
    start: number;
    n: number;
}
interface UnitVis {
    id: string;
    side: Side;
    kind: UnitState['kind'];
    slots: Slot[];
    keep: number[];
    halfW: number;
    halfD: number;
    body: Range;
    spear: Range | null;
    bow: Range | null;
    horse: Range | null;
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
    flag: THREE.Group;
    banner: THREE.Mesh;
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
    private width = 1;
    private height = 1;
    private readonly map: BattleMap;
    private readonly low: boolean;
    private readonly owned: { dispose(): void }[] = [];
    private readonly vis: UnitVis[] = [];
    private readonly bodyMesh: THREE.InstancedMesh;
    private readonly spearMesh: THREE.InstancedMesh;
    private readonly bowMesh: THREE.InstancedMesh;
    private readonly horseMesh: THREE.InstancedMesh;
    private readonly ringMesh: THREE.InstancedMesh;
    private readonly selRing: THREE.Mesh;
    private readonly ribbon: Ribbon;
    private readonly clashSprites: THREE.Sprite[] = [];
    private readonly clashMats: Record<'front' | 'flank' | 'rear', THREE.SpriteMaterial>;
    private trees: THREE.Object3D | null = null;
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
        this.buildEdges();
        this.setTrees(null);

        // ---- 部隊 ----
        let nBody = 0;
        let nSpear = 0;
        let nBow = 0;
        let nHorse = 0;
        for (const u of s.units) {
            const n = figureCount(u.startStrength);
            const slots = formationSlots(u.kind, n);
            const ext = formationExtent(u.kind, n);
            const body = { start: nBody, n };
            nBody += n;
            let spear: Range | null = null;
            let bow: Range | null = null;
            let horse: Range | null = null;
            if (u.kind === 'yumi') {
                bow = { start: nBow, n };
                nBow += n;
            } else {
                spear = { start: nSpear, n };
                nSpear += n;
            }
            if (u.kind === 'kiba') {
                horse = { start: nHorse, n };
                nHorse += n;
            }
            const { flag, banner } = this.makeFlag(u.clan, u.isHq);
            this.scene.add(flag);
            this.vis.push({
                id: u.id,
                side: u.side,
                kind: u.kind,
                slots,
                keep: keepOrder(slots, u.id),
                halfW: ext.halfW,
                halfD: ext.halfD,
                body,
                spear,
                bow,
                horse,
                px: u.x,
                pz: u.z,
                face: u.facing,
                sx: 0,
                sz: 0,
                routT: -1,
                shown: false,
                flag,
                banner,
                seed: hash01(u.id, 7) * 100,
            });
        }
        const figs = makeFigureGeometries();
        this.own(figs.body, figs.spear, figs.bow, figs.horse);
        const tinted = this.own(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
        const neutral = this.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
        this.bodyMesh = this.instanced(figs.body, tinted, nBody);
        this.spearMesh = this.instanced(figs.spear, neutral, nSpear);
        this.bowMesh = this.instanced(figs.bow, neutral, nBow);
        this.horseMesh = this.instanced(figs.horse, neutral, nHorse);
        // 鎧の色（家の色。1 体ずつ少し明暗を変える）
        const c = new THREE.Color();
        for (const v of this.vis) {
            const u = unitById(s, v.id)!;
            const base = new THREE.Color(CLAN_COLOR[u.clan]);
            for (let i = 0; i < v.body.n; i++) {
                const k = 0.86 + hash01(v.id, i + 31) * 0.24;
                c.copy(base).multiplyScalar(k);
                this.bodyMesh.setColorAt(v.body.start + i, c);
            }
        }
        if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;

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

        this.ribbon = new Ribbon(this.map, 9000);
        this.own(this.ribbon);
        this.scene.add(this.ribbon.mesh);

        const clashTex = this.own(makeClashTexture());
        this.clashMats = {
            front: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#fff6e0', depthTest: false, depthWrite: false, toneMapped: false })),
            flank: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#ffae3a', depthTest: false, depthWrite: false, toneMapped: false })),
            rear: this.own(new THREE.SpriteMaterial({ map: clashTex, color: '#ff4b3a', depthTest: false, depthWrite: false, toneMapped: false })),
        };
        for (let i = 0; i < 8; i++) {
            const sp = new THREE.Sprite(this.clashMats.front);
            sp.renderOrder = 12;
            sp.visible = false;
            this.clashSprites.push(sp);
            this.scene.add(sp);
        }
        this.applyCam();
    }

    /** 後片付け（dispose）するものとして覚える。最初のものを返す */
    private own<T extends { dispose(): void }>(first: T, ...rest: { dispose(): void }[]): T {
        this.owned.push(first, ...rest);
        return first;
    }

    private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
        m.count = n;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) m.setMatrixAt(i, this.zero);
        this.scene.add(m);
        return m;
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
            groundColor(map, x, z, y, c);
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

    private buildRoad(): void {
        const road = this.map.terrain.find((a) => a.kind === 'road' && a.rect);
        if (!road || !road.rect) return;
        const r = road.rect;
        const z0 = r.z0 <= -this.map.depth / 2 + 1 ? -this.map.depth / 2 - MARGIN : r.z0;
        const z1 = r.z1 >= this.map.depth / 2 - 1 ? this.map.depth / 2 + MARGIN : r.z1;
        const cx = (r.x0 + r.x1) / 2;
        const hw = ((r.x1 - r.x0) / 2) * 0.8;
        const pts: number[] = [];
        const idx: number[] = [];
        let n = 0;
        for (let z = z0; z <= z1 + 0.01; z += 4) {
            const wob = Math.sin(z * 0.03) * 1.2;
            for (const sx of [-1, 1]) {
                const x = cx + wob + sx * hw;
                pts.push(x, elevationAt(this.map, x, z) + 0.12, z);
            }
            if (n > 0) idx.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1);
            n++;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ color: '#a48c63', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        this.own(geo, mat);
        this.scene.add(new THREE.Mesh(geo, mat));
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
    private flagGeos: { pole: THREE.BufferGeometry; banner: THREE.BufferGeometry; big: THREE.BufferGeometry; top: THREE.BufferGeometry } | null = null;
    private poleMat: THREE.Material | null = null;
    private topMat: THREE.Material | null = null;

    private makeFlag(clan: ClanId, hq: boolean): { flag: THREE.Group; banner: THREE.Mesh } {
        if (!this.flagGeos) {
            const pole = new THREE.CylinderGeometry(0.13, 0.16, POLE_H, 5);
            pole.translate(0, POLE_H / 2, 0);
            const banner = new THREE.PlaneGeometry(2.4, 5.6);
            banner.translate(1.3, 0, 0);
            const big = new THREE.PlaneGeometry(3.4, 7.2);
            big.translate(1.8, 0, 0);
            const top = new THREE.SphereGeometry(0.75, 10, 8);
            this.flagGeos = { pole, banner, big, top };
            this.own(pole, banner, big, top);
            this.poleMat = this.own(new THREE.MeshLambertMaterial({ color: '#3b2c1c' }));
            this.topMat = this.own(new THREE.MeshLambertMaterial({ color: '#d8b24a', emissive: '#4a3a10' }));
        }
        let mat = this.flagMats.get(clan);
        if (!mat) {
            const tex = this.own(makeBannerTexture(clan));
            mat = this.own(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: '#222222', emissiveMap: tex }));
            this.flagMats.set(clan, mat);
        }
        const g = this.flagGeos;
        const flag = new THREE.Group();
        const pole = new THREE.Mesh(g.pole, this.poleMat!);
        pole.scale.y = hq ? 1.3 : 1;
        const banner = new THREE.Mesh(hq ? g.big : g.banner, mat);
        banner.position.y = hq ? POLE_H * 1.3 - 3.9 : POLE_H - 3.0;
        flag.add(pole, banner);
        if (hq) {
            const top = new THREE.Mesh(g.top, this.topMat!);
            top.position.y = POLE_H * 1.3 + 0.4;
            flag.add(top);
        }
        flag.visible = false;
        return { flag, banner };
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

            this.placeFigures(u, v, t);

            // 旗
            v.flag.visible = visible;
            if (visible) {
                // 隊列の後ろ（向きの反対）に立てる。本陣は真ん中
                const back = u.isHq ? 0 : v.halfD + 1.5;
                const bx = v.px + v.sx - Math.sin(v.face) * back;
                const bz = v.pz + v.sz + Math.cos(v.face) * back;
                v.flag.position.set(bx, elevationAt(this.map, bx, bz), bz);
                v.banner.rotation.y = Math.sin(t * 1.7 + v.seed) * 0.18;
                v.flag.rotation.z = u.status === 'routed' ? Math.min(0.55, v.routT * 0.4) : 0;
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
                if (ui.pending === 'attack' && u.side === 'enemy') k = 1.25 + Math.sin(t * 7) * 0.35;
                tmpC.set(SIDE_COLOR[u.side]).multiplyScalar(k);
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
        for (const m of [this.bodyMesh, this.spearMesh, this.bowMesh, this.horseMesh]) m.instanceMatrix.needsUpdate = true;
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

        this.ribbon.end();
    }

    /** 人形を隊列に並べる（兵が減ると抜け、敗走すると散って逃げる） */
    private placeFigures(u: UnitState, v: UnitVis, t: number): void {
        const n = v.shown ? Math.min(v.slots.length, figureCount(u.strength)) : 0;
        const routed = u.status === 'routed';
        const scatter = routed ? Math.min(1, v.routT / 2.5) : 0;
        const fwdX = Math.sin(v.face);
        const fwdZ = -Math.cos(v.face);
        const rgtX = Math.cos(v.face);
        const rgtZ = Math.sin(v.face);
        const moving = u.moving || routed;
        const melee = !!u.engagedWith;
        const yawBase = -v.face;
        const cav = u.kind === 'kiba';
        for (let k = 0; k < v.slots.length; k++) {
            const idx = v.keep[k];
            const bodyI = v.body.start + idx;
            const gear = v.spear ? this.spearMesh : this.bowMesh;
            const gearI = (v.spear ?? v.bow)!.start + idx;
            if (k >= n) {
                this.bodyMesh.setMatrixAt(bodyI, this.zero);
                gear.setMatrixAt(gearI, this.zero);
                if (v.horse) this.horseMesh.setMatrixAt(v.horse.start + idx, this.zero);
                continue;
            }
            const sl = v.slots[idx];
            const h1 = hash01(v.id, idx);
            const h2 = hash01(v.id, idx + 500);
            let lx = sl.x + (h1 - 0.5) * 0.6;
            let lz = sl.z + (h2 - 0.5) * 0.6;
            if (scatter > 0) {
                lx = lx * (1 + scatter * 1.6) + (h1 - 0.5) * 10 * scatter;
                lz = lz * (1 + scatter * 1.2) + (h2 - 0.5) * 8 * scatter;
            }
            if (melee && sl.row <= 1) lz += Math.sin(t * 7 + idx * 1.7) * 0.45 - 0.3;
            const wx = v.px + v.sx + rgtX * lx - fwdX * lz;
            const wz = v.pz + v.sz + rgtZ * lx - fwdZ * lz;
            let y = elevationAt(this.map, wx, wz);
            if (moving) y += Math.abs(Math.sin(t * (cav ? 7 : 9) + idx * 1.3)) * (cav ? 0.35 : 0.22);
            const yaw = yawBase + (h1 - 0.5) * 0.25 + (scatter > 0 ? (h2 - 0.5) * 1.2 * scatter : 0);
            this.q.setFromAxisAngle(this.yAxis, yaw);
            const riderY = cav ? 0.8 * FIG : 0;
            this.m4.compose(this.v3.set(wx, y + riderY, wz), this.q, this.s3.setScalar(FIG));
            this.bodyMesh.setMatrixAt(bodyI, this.m4);
            gear.setMatrixAt(gearI, this.m4);
            if (v.horse) {
                this.m4.compose(this.v3.set(wx, y, wz), this.q, this.s3.setScalar(FIG));
                this.horseMesh.setMatrixAt(v.horse.start + idx, this.m4);
            }
        }
    }

    /** 命令の線：移動は白っぽい水色、攻撃は橙、撤退は灰色。着く所に矢じり */
    private orderLine(s: BattleState, u: UnitState, v: UnitVis, selected: boolean): void {
        const from: [number, number] = v.shown ? [v.px, v.pz] : [u.x, u.z];
        const w = selected ? 2.0 : 1.2;
        const a = selected ? 0.95 : 0.55;
        const o = u.order;
        if (o.type === 'move') {
            if (Math.hypot(o.x - from[0], o.z - from[1]) < 4) return;
            this.ribbon.path([from, [o.x, o.z]], w, [0.75, 0.95, 1, a], null, true, v.halfD, 0);
        } else if (o.type === 'attack') {
            const j = s.units.findIndex((x) => x.id === o.targetId);
            const e = j >= 0 ? this.vis[j] : null;
            if (!e || !e.shown) return;
            this.ribbon.path([from, [e.px, e.pz]], w, [1, 0.55, 0.25, a], null, true, v.halfD, e.halfD + 2);
        } else if (o.type === 'retreat') {
            const ex = exitPointFor(s, u);
            this.ribbon.path([from, [ex.x, ex.z]], w, [0.8, 0.8, 0.8, a * 0.8], { on: 6, off: 4, offset: 0 }, true, v.halfD, 0);
        }
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
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
            const fl = this.project(v.flag.position.x, v.flag.position.y + POLE_H * 0.7, v.flag.position.z);
            const d = Math.min(Math.hypot(sx - c.x, sy - c.y), Math.hypot(sx - fl.x, sy - fl.y) * 1.3);
            const score = d / r;
            if (score < bestScore) {
                bestScore = score;
                best = u.id;
            }
        }
        return best;
    }

    /** 部隊の名札の位置（旗の上） */
    labelAnchor(i: number): { x: number; y: number; z: number; shown: boolean } {
        const v = this.vis[i];
        const top = v.flag.position.y + POLE_H * (v.flag.children.length > 2 ? 1.3 : 1) + 1.5;
        return { x: v.flag.position.x, y: top, z: v.flag.position.z, shown: v.shown };
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
        for (const m of [this.bodyMesh, this.spearMesh, this.bowMesh, this.horseMesh, this.ringMesh]) m.dispose();
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

/** 地面の色（草・林の下草・湿地・丘の乾いた草。戦場の外は暗く） */
function groundColor(map: BattleMap, x: number, z: number, y: number, out: THREE.Color): void {
    const n = Math.sin(x * 0.047 + 0.3) * 0.5 + Math.sin(z * 0.039 + 1.1) * 0.5 + Math.sin((x + z) * 0.021) * 0.6 + Math.sin(x * 0.19 - z * 0.13) * 0.25;
    out.set('#7a8f4c');
    if (inTerrain(map, 'woods', x, z)) out.set('#465f33');
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

/**
 * 兵の人形（前は -z）。1 体の大きさは 1 m 単位で作り、置くときに FIG 倍にする。
 * - body：足・胴・袖・陣笠・背中の小旗（家の色に染める。明暗だけ頂点の色で付ける）
 * - spear：頭と槍（槍・本陣・騎馬）、bow：頭と弓と矢筒（弓）
 * - horse：馬（騎馬。乗り手は body を高くして置く）
 */
function makeFigureGeometries(): { body: THREE.BufferGeometry; spear: THREE.BufferGeometry; bow: THREE.BufferGeometry; horse: THREE.BufferGeometry } {
    const body = merge([
        part(new THREE.BoxGeometry(0.42, 0.8, 0.28), 0.42, 0, 0.4, 0),
        part(new THREE.BoxGeometry(0.62, 0.72, 0.38), 1.0, 0, 1.16, 0),
        part(new THREE.BoxGeometry(0.9, 0.16, 0.42), 0.78, 0, 1.46, 0),
        part(new THREE.ConeGeometry(0.44, 0.24, 8), 0.9, 0, 1.94, 0),
        part(new THREE.BoxGeometry(0.05, 0.62, 0.36), 1.15, 0, 2.02, 0.26),
    ]);
    const head = () => part(new THREE.SphereGeometry(0.19, 8, 6), '#d8b28a', 0, 1.72, 0);
    const spear = merge([
        head(),
        part(new THREE.BoxGeometry(0.06, 4.4, 0.06), '#6e5436', 0.36, 2.0, -0.2, -0.22),
        part(new THREE.ConeGeometry(0.1, 0.45, 4), '#e2e2e2', 0.36, 2.0 + 2.2 * Math.cos(0.22) + 0.2, -0.2 - 2.2 * Math.sin(0.22) - 0.05, -0.22),
    ]);
    const bow = merge([
        head(),
        part(new THREE.BoxGeometry(0.06, 1.9, 0.08), '#3a2a18', -0.4, 1.35, -0.1, 0, 0.12),
        part(new THREE.BoxGeometry(0.16, 0.55, 0.16), '#5c3b22', 0.18, 1.3, 0.28, 0.3),
    ]);
    const horse = merge([
        part(new THREE.BoxGeometry(0.56, 0.62, 1.8), '#6b4a2e', 0, 1.15, 0),
        part(new THREE.BoxGeometry(0.3, 0.75, 0.36), '#5e3f26', 0, 1.62, -0.82, -0.55),
        part(new THREE.BoxGeometry(0.26, 0.28, 0.62), '#5e3f26', 0, 1.98, -1.18),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', -0.2, 0.43, -0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', 0.2, 0.43, -0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', -0.2, 0.43, 0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', 0.2, 0.43, 0.7),
        part(new THREE.BoxGeometry(0.62, 0.1, 0.8), '#b8a27a', 0, 1.5, 0.05),
    ]);
    return { body, spear, bow, horse };
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
