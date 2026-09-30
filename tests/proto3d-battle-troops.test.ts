/**
 * 兵士の表示（大軍感。docs/troops-abilities-design.md §1）の確かめ。
 * - troops.ts（純粋）：兵力 → 表示の人数（300 → 24・500 → 32・800 → 40）・兵が減ったときの人数（ceil）と 1 人ずつの減り方・LOD・隊列・揺れ。
 * - troopsView.ts（three。WebGL なしで作れる）：画面外の部隊は描かない・描画の呼び出しの数（InstancedMesh の数）が部隊の数で増えない。
 * - 表示を作って毎フレーム更新しても、合戦の状態（BattleState）が 1 刻みも変わらない（表示あり／なしで同じ台本を進めて比べる）。
 *   合戦の画面の表示（view.ts の BattleView）ごと作る方は、のぼりの画像に使う canvas だけ仮のものにする（document の仮）。
 * 状態は直接書き換えない（台本の命令と stepBattle だけ）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    TROOP_DATA,
    lodCount,
    lodPick,
    lodRatio,
    stepTroopCount,
    troopExtent,
    troopKeepOrder,
    troopMax,
    troopPose,
    troopSlots,
    troopTarget,
    troopTier,
    type TroopCounter,
} from '../proto3d/src/battle/troops';
import { TroopLayer, type TroopUnitPose } from '../proto3d/src/battle/troopsView';
import { createBattle, issueOrder, stepBattle, type BattleState } from '../proto3d/src/battle/sim';
import { demoSetup } from '../proto3d/src/battle/maps';
import { planScript } from '../proto3d/src/battle/scripts';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import { figureCount, formationExtent } from '../proto3d/src/battle/control';
import type { UnitKind } from '../proto3d/src/battle/types';

const plains = () => createBattle(buildBattleSetup(getField('plains')!, 'standard'));

describe('表示の人数（兵力 → 1 部隊 20〜40 人）', () => {
    it('300 → 24・500 → 32・800 以上 → 40。間は直線で補い、20〜40 に収める', () => {
        expect(troopMax(300)).toBe(24);
        expect(troopMax(500)).toBe(32);
        expect(troopMax(800)).toBe(40);
        expect(troopMax(5000)).toBe(40);
        expect(troopMax(400)).toBe(28);
        expect(troopMax(650)).toBe(36);
        expect(troopMax(250)).toBe(22);
        expect(troopMax(50)).toBe(20);
        expect(troopMax(0)).toBe(0);
        expect(troopMax(Number.NaN)).toBe(0);
        let prev = 0;
        for (let st = 1; st <= 1200; st += 7) {
            const n = troopMax(st);
            expect(n).toBeGreaterThanOrEqual(prev);
            expect(n).toBeGreaterThanOrEqual(20);
            expect(n).toBeLessThanOrEqual(40);
            prev = n;
        }
    });
    it('画質「低」・触る端末では一段下げる（上限 34）', () => {
        expect(troopTier({ low: false })).toBe('high');
        expect(troopTier({ low: true })).toBe('low');
        expect(troopTier({ low: false, touch: true })).toBe('low');
        expect(troopMax(300, 'low')).toBe(22);
        expect(troopMax(500, 'low')).toBe(28);
        expect(troopMax(800, 'low')).toBe(34);
        for (const st of [200, 300, 450, 600, 900]) expect(troopMax(st, 'low')).toBeLessThan(troopMax(st, 'high'));
    });
    it('兵が減ると ceil(最大 × 今 ÷ 最初)。全滅（1 未満）で 0', () => {
        expect(troopTarget(32, 500, 500)).toBe(32);
        expect(troopTarget(32, 250, 500)).toBe(16);
        expect(troopTarget(32, 251, 500)).toBe(17);
        expect(troopTarget(32, 3, 500)).toBe(1);
        expect(troopTarget(32, 0.5, 500)).toBe(0);
        expect(troopTarget(32, 0, 500)).toBe(0);
        expect(troopTarget(40, 1000, 800)).toBe(40);
    });
    it('人数は 1 人ずつ 0.3 秒あけて減る（最初の 1 人はすぐ）。増えるときはすぐ合わせる', () => {
        const c: TroopCounter = { shown: 30, wait: 0 };
        stepTroopCount(c, 27, 1 / 60);
        expect(c.shown).toBe(29);
        // 0.3 秒たつまでは次が抜けない
        for (let i = 0; i < 16; i++) stepTroopCount(c, 27, 1 / 60);
        expect(c.shown).toBe(29);
        for (let i = 0; i < 3; i++) stepTroopCount(c, 27, 1 / 60);
        expect(c.shown).toBe(28);
        for (let i = 0; i < 60; i++) stepTroopCount(c, 27, 1 / 60);
        expect(c.shown).toBe(27);
        stepTroopCount(c, 30, 1 / 60);
        expect(c.shown).toBe(30);
        expect(TROOP_DATA.dropInterval).toBe(0.3);
    });
    it('早送りの後などで大きく離れたときは、間を縮めて追いつく（それでも 1 フレームで一度に消えない）', () => {
        const c: TroopCounter = { shown: 40, wait: 0 };
        stepTroopCount(c, 4, 1 / 60);
        expect(c.shown).toBe(39);
        let tSec = 0;
        while (c.shown > 4 && tSec < 20) {
            stepTroopCount(c, 4, 1 / 60);
            tSec += 1 / 60;
        }
        expect(c.shown).toBe(4);
        // 36 人を 1 人 0.3 秒なら 10.8 秒。追いつくので短い
        expect(tSec).toBeLessThan(6);
        expect(tSec).toBeGreaterThan(1.5);
    });
});

describe('LOD（カメラからの距離で 100%／60%／35%）', () => {
    it('閾値はデータ（TROOP_DATA.lod）。低い段は近い所から落とす', () => {
        const [a, b] = TROOP_DATA.lod.high;
        expect(lodRatio(100)).toBe(1);
        expect(lodRatio(a.upTo)).toBe(1);
        expect(lodRatio(a.upTo + 1)).toBe(0.6);
        expect(lodRatio(b.upTo + 1)).toBe(0.35);
        expect(lodRatio(1e6)).toBe(0.35);
        expect(TROOP_DATA.lod.low[0].upTo).toBeLessThan(a.upTo);
        expect(lodRatio(a.upTo, 'low')).toBeLessThan(1);
    });
    it('描く人数と選び方：均等に間引き、最前列（残る順の先頭）は必ず含む。1 人以上いれば 1 人は描く', () => {
        expect(lodCount(40, 1)).toBe(40);
        expect(lodCount(40, 0.6)).toBe(24);
        expect(lodCount(40, 0.35)).toBe(14);
        expect(lodCount(1, 0.35)).toBe(1);
        expect(lodCount(0, 1)).toBe(0);
        const p = lodPick(40, 14);
        expect(p.length).toBe(14);
        expect(new Set(p).size).toBe(14);
        expect(p[0]).toBe(0);
        expect(Math.max(...p)).toBeGreaterThan(30);
        expect(lodPick(10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
});

describe('隊列（種類ごと）', () => {
    const box = (kind: UnitKind, st: number) => formationExtent(kind, figureCount(st));
    it('人数ぶんの位置を返し、重ならない', () => {
        for (const kind of ['yari', 'yumi', 'kiba', 'honjin'] as UnitKind[]) {
            for (const st of [200, 300, 450, 500, 800, 1200]) {
                const n = troopMax(st);
                const s = troopSlots(kind, n, box(kind, st));
                expect(s.length).toBe(n);
                const keys = new Set(s.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
                expect(keys.size).toBe(n);
                let minD = Infinity;
                for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) minD = Math.min(minD, Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z));
                expect(minD).toBeGreaterThanOrEqual(1.4);
            }
        }
    });
    it('槍は横に広い密な列（3〜5 列）、弓は間の空いた 2〜3 列（互い違い）', () => {
        const yari = troopSlots('yari', 32, box('yari', 500));
        const rows = new Set(yari.map((p) => p.row)).size;
        expect(rows).toBeGreaterThanOrEqual(3);
        expect(rows).toBeLessThanOrEqual(5);
        const e = troopExtent(yari);
        expect(e.halfW).toBeGreaterThan(e.halfD * 1.4);
        const yumi = troopSlots('yumi', 28, box('yumi', 400));
        const yr = new Set(yumi.map((p) => p.row)).size;
        expect(yr).toBeGreaterThanOrEqual(2);
        expect(yr).toBeLessThanOrEqual(3);
        const dxYari = Math.abs(yari[1].x - yari[0].x);
        const dxYumi = Math.abs(yumi[1].x - yumi[0].x);
        expect(dxYumi).toBeGreaterThan(dxYari);
        // 2 列目は半分ずれる
        const r0 = yumi.filter((p) => p.row === 0).map((p) => p.x);
        const r1 = yumi.filter((p) => p.row === 1).map((p) => p.x);
        expect(r1.some((x) => r0.every((y) => Math.abs(x - y) > 0.5))).toBe(true);
    });
    it('騎馬は楔形（前の列ほど狭い）、本陣は旗（真ん中）を囲む方陣', () => {
        const kiba = troopSlots('kiba', 22, box('kiba', 250));
        const width = (r: number) => kiba.filter((p) => p.row === r).length;
        expect(width(0)).toBe(3);
        expect(width(1)).toBe(5);
        expect(width(2)).toBeGreaterThan(width(1));
        const front = kiba.filter((p) => p.row === 0);
        const back = kiba.filter((p) => p.row === 2);
        expect(front[0].z).toBeLessThan(back[0].z);
        const hq = troopSlots('honjin', 24, box('honjin', 300));
        expect(hq.some((p) => Math.hypot(p.x, p.z) < 1)).toBe(false);
        // 内側の輪（8 人）が全部埋まり、旗を囲む
        expect(hq.filter((p) => p.row === 0).length).toBe(8);
        expect(Math.min(...hq.map((p) => p.x))).toBeLessThan(0);
        expect(Math.max(...hq.map((p) => p.x))).toBeGreaterThan(0);
    });
    it('隊列の大きさは、部隊の輪・押す判定の広さ（Version 12 のまま）に近い', () => {
        for (const kind of ['yari', 'yumi', 'kiba', 'honjin'] as UnitKind[]) {
            for (const st of [250, 350, 450, 525, 800]) {
                const b = box(kind, st);
                const e = troopExtent(troopSlots(kind, troopMax(st), b));
                // 押す判定の半径（max(halfW, halfD) + 2）から大きくはみ出さない
                expect(Math.max(e.halfW, e.halfD)).toBeLessThanOrEqual(Math.max(b.halfW, b.halfD) + 4);
            }
        }
    });
    it('兵が減ると後ろの列から抜ける（最前列は最後まで残りやすい）。同じ部隊はいつも同じ順', () => {
        const s = troopSlots('yari', 40, box('yari', 800));
        const k = troopKeepOrder(s, 'a_tadakatsu');
        expect([...k].sort((a, b) => a - b)).toEqual(s.map((_, i) => i));
        expect(troopKeepOrder(s, 'a_tadakatsu')).toEqual(k);
        const lastRow = Math.max(...s.map((p) => p.row));
        const pos = (row: number) => {
            const o = k.map((slot, order) => ({ slot, order })).filter((x) => s[x.slot].row === row);
            return o.reduce((a, x) => a + x.order, 0) / o.length;
        };
        expect(pos(0)).toBeLessThan(pos(lastRow));
        // 半分に減ったとき、残る人は最前列を全部含む
        const kept = new Set(k.slice(0, 20));
        expect(s.every((p, i) => p.row !== 0 || kept.has(i))).toBe(true);
    });
    it('揺れ：斬り合いで前へ詰める・敗走で散る・歩くと上下に揺れる', () => {
        const slot = { x: 2, z: 3, row: 2 };
        const base = { t: 1, moving: false, melee: false, scatter: 0, cavalry: false };
        const o = { lx: 0, lz: 0, lift: 0, yaw: 0 };
        const idle = { ...troopPose(slot, 5, 'u', base, o) };
        const melee = { ...troopPose(slot, 5, 'u', { ...base, melee: true }, o) };
        const rout = { ...troopPose(slot, 5, 'u', { ...base, scatter: 1 }, o) };
        expect(melee.lz).toBeLessThan(idle.lz);
        expect(Math.hypot(rout.lx, rout.lz)).toBeGreaterThan(Math.hypot(idle.lx, idle.lz) + 2);
        expect(idle.lift).toBe(0);
        let maxLift = 0;
        for (let t = 0; t < 1; t += 0.05) maxLift = Math.max(maxLift, troopPose(slot, 5, 'u', { ...base, t, moving: true }, o).lift);
        expect(maxLift).toBeGreaterThan(0.1);
    });
});

// ---------------------------------------------------------------- 描画（three。WebGL なし）

/** 大平原を上から見下ろすカメラ（view.ts と同じ向き：俯角 56°・画角 40°） */
function camAt(tx: number, tz: number, dist: number, aspect = 16 / 9): THREE.PerspectiveCamera {
    const c = new THREE.PerspectiveCamera(40, aspect, 1, 5000);
    const p = THREE.MathUtils.degToRad(56);
    c.position.set(tx, Math.sin(p) * dist, tz + Math.cos(p) * dist);
    c.lookAt(tx, 0, tz);
    c.updateMatrixWorld();
    return c;
}

function posesOf(s: BattleState): TroopUnitPose[] {
    return s.units.map((u) => ({
        px: u.x,
        pz: u.z,
        sx: 0,
        sz: 0,
        face: u.facing,
        routT: u.status === 'routed' ? 1 : -1,
        shown: u.present && (u.side === 'ally' || u.seenBy.ally),
        flagX: u.x,
        flagY: 0,
        flagZ: u.z,
        flagTilt: 0,
        bannerYaw: 0,
    }));
}

function layerFor(s: BattleState, tier: 'high' | 'low' = 'high'): TroopLayer {
    return new TroopLayer(
        s,
        s.units.map((u) => formationExtent(u.kind, figureCount(u.startStrength))),
        { tier, clanColor: () => '#2f55a8', bannerMaterial: () => new THREE.MeshBasicMaterial() },
    );
}

describe('兵士の描画（TroopLayer）', () => {
    it('全体を見ると、見えている部隊の兵士をすべて描く（大平原・味方 7／敵 7 で 300 人以上）', () => {
        const s = plains();
        const layer = layerFor(s);
        layer.update(s, posesOf(s), camAt(0, 40, 440), 0, 1 / 60);
        const st = layer.stats();
        const shownUnits = s.units.filter((u) => u.present && (u.side === 'ally' || u.seenBy.ally));
        expect(st.visibleSoldiers).toBe(Object.values(st.perUnit).reduce((a, b) => a + b, 0));
        expect(st.visibleSoldiers).toBeGreaterThanOrEqual(300);
        expect(st.instancesByMesh.body).toBe(st.visibleSoldiers);
        expect(st.instancesByMesh.pole).toBe(shownUnits.length);
        for (const u of shownUnits) expect(st.perUnit[u.id]).toBeGreaterThanOrEqual(20);
        layer.dispose();
    });
    it('画面外の部隊は描かない（行列を書かない）', () => {
        const s = plains();
        const layer = layerFor(s);
        // 味方の陣（南）だけを近くから見る：北の敵は画面の外
        layer.update(s, posesOf(s), camAt(0, 130, 90), 0, 1 / 60);
        const st = layer.stats();
        const enemies = s.units.filter((u) => u.side === 'enemy' && u.seenBy.ally);
        expect(enemies.length).toBeGreaterThan(0);
        for (const u of enemies) {
            expect(st.culledUnits).toContain(u.id);
            expect(st.perUnit[u.id]).toBe(0);
        }
        expect(st.visibleSoldiers).toBeGreaterThan(0);
        // 戦場の外を見ると何も描かない
        layer.update(s, posesOf(s), camAt(3000, 3000, 100), 0, 1 / 60);
        expect(layer.stats().visibleSoldiers).toBe(0);
        expect(layer.stats().instancesByMesh.pole).toBe(0);
        layer.dispose();
    });
    it('遠くから見ると LOD で人数を減らす', () => {
        const s = plains();
        const layer = layerFor(s);
        layer.update(s, posesOf(s), camAt(0, 40, 440), 0, 1 / 60);
        const near = layer.stats().visibleSoldiers;
        layer.update(s, posesOf(s), camAt(0, 40, 1400), 0, 1 / 60);
        const far = layer.stats();
        expect(far.visibleSoldiers).toBeLessThan(near * 0.5);
        expect(Object.values(far.lodByUnit).every((r) => r === 0.35)).toBe(true);
        layer.dispose();
    });
    it('InstancedMesh の数（描画の呼び出しの上限）は部隊の数で増えない（のぼりだけ家 × 大きさの数）', () => {
        const big = plains();
        const kinds = new Set(big.units.map((u) => `${u.clan}:${u.isHq}`));
        const a = layerFor(big);
        // 兵士 4（体・槍・弓・馬）＋旗竿・本陣の頭＋のぼり（徳川・敵勢 × 本陣／ほか）
        expect(a.meshCount()).toBe(6 + kinds.size);
        expect(kinds.size).toBe(4);
        // 同じ家の部隊を 3 倍にしても（45 部隊）、InstancedMesh の数は同じ
        const triple = { ...big, units: [...big.units, ...big.units, ...big.units] } as BattleState;
        const b = layerFor(triple);
        expect(b.meshCount()).toBe(a.meshCount());
        b.update(triple, posesOf(triple), camAt(0, 40, 440), 0, 1 / 60);
        expect(b.stats().instancesByMesh.body).toBeGreaterThan(900);
        a.dispose();
        b.dispose();
    });
});

// ---------------------------------------------------------------- 表示は合戦の状態を変えない

/** 大平原の台本：正面で待ち、騎馬を回し、時間で攻めかかる（能力は使わない） */
function plainsScript(s: BattleState): void {
    const t = Math.round(s.t * 10) / 10;
    if (t === 5) issueOrder(s, 'a_kiba', { type: 'move', x: -150, z: -40 });
    if (t === 60) issueOrder(s, 'a_kiba', { type: 'attack', targetId: 'e_left' });
    if (t === 90) issueOrder(s, 'a_ishikawa', { type: 'attack', targetId: 'e_sente' });
    if (t === 150) for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara']) issueOrder(s, id, { type: 'attack', targetId: 'e_hq' });
}

/** 状態の写し（比べる用。関数は含まない） */
function snapshot(s: BattleState): string {
    return JSON.stringify(s, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
}

/** 最後まで（または maxSec まで）進める。each は毎刻みの後（表示の更新をまねる） */
function run(s: BattleState, script: (s: BattleState) => void, each: ((s: BattleState) => void) | null, maxSec = 400): string[] {
    const snaps: string[] = [];
    let k = 0;
    while (!s.result && s.t < maxSec) {
        script(s);
        stepBattle(s, 0.1);
        each?.(s);
        if (++k % 100 === 0) snaps.push(snapshot(s));
    }
    snaps.push(snapshot(s));
    return snaps;
}

describe('兵士の表示は合戦の状態を変えない', () => {
    it('TroopLayer を毎刻み更新しても、表示なしと 1 刻みも同じ（大平原・架空の第一章）', () => {
        for (const make of [plains, () => createBattle(demoSetup('tashiro'))]) {
            const scriptOf = make === plains ? () => plainsScript : () => planScript('tashiro');
            const a = make();
            const plain = run(a, scriptOf(), null);
            const b = make();
            const layer = layerFor(b);
            const cams = [camAt(0, 40, 440), camAt(0, 130, 90), camAt(0, 40, 1400)];
            let f = 0;
            const drawn = run(b, scriptOf(), (s) => {
                layer.update(s, posesOf(s), cams[f++ % cams.length], s.t, 0.1);
            });
            expect(drawn).toEqual(plain);
            expect(b.result).toEqual(a.result);
            layer.dispose();
        }
    });

    it('合戦の画面の表示（BattleView）ごと作って毎刻み update しても、表示なしと同じ', async () => {
        // のぼり・斬り合いの印の画像は canvas で描く。node には無いので、何もしない 2D の仮を置く
        const g = globalThis as unknown as { document?: unknown };
        const had = 'document' in g;
        const prev = g.document;
        const ctx2d = new Proxy({}, { get: () => () => undefined, set: () => true });
        g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
        try {
            const { BattleView } = await import('../proto3d/src/battle/view');
            const a = plains();
            const plain = run(a, plainsScript, null, 240);
            const b = plains();
            const view = new BattleView(b, { low: false });
            view.resize(1280, 720);
            view.fit({ top: 60, bottom: 110, left: 10, right: 10 });
            let k = 0;
            const drawn = run(
                b,
                plainsScript,
                (s) => {
                    view.update(s, 1 / 30, { selectedId: k++ % 50 < 25 ? 'a_tadakatsu' : null, pending: 'none' });
                },
                240,
            );
            expect(drawn).toEqual(plain);
            // 表示は実際に兵士を並べていた
            expect(view.troopStats().visibleSoldiers).toBeGreaterThan(0);
            view.dispose();
        } finally {
            if (had) g.document = prev;
            else delete g.document;
        }
    });
});
