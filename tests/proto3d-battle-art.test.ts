/**
 * 合戦の画面の生成イラスト素材（Version 22）の確かめ（battle/groundArt.ts・unitFx.ts・faceArt.ts・view.ts の setGroundArt）。
 * - 地面の型紙：決まりの地形の形（sim.ts の inTerrain）と、型紙の中・外の分け方が一致する（大平原の道・円の林。ほかの戦場の道・林も）。
 *   混ぜる帯は決まりの縁を中心に 2 m 以内。
 * - 円の林の木：決まりの区域の内側だけ（縁から 3 m 内側）。素材の地面を使わない間は Version 21 と同じ（円の林には植えない）。
 * - 素材の地面・足元の影・砂ぼこりを使って毎刻み更新しても、合戦の状態は表示なし・素材なしと 1 刻みも同じ。押す判定（pick）・名札の位置も同じ。
 * - 旧表示（?art=old）・素材の一覧に無い戦場では使わない。顔は絵の届いた武将の自分の顔だけ（ほかの人の顔で代用しない）。
 * - 読み込み（loadFieldArt）：素材ごとに読み、読めた種類だけ使う（Version 23 から。meta.tileMeters・低い画質の anisotropy 1）。読めない種類は null
 *   （その種類だけ Version 21 の色）。旧表示・一覧に 1 種類も無い・全部読めないなら null（一覧に無ければ型紙も作らない）。
 *   型紙と雑音は戦場の形ごとに 1 度だけ作り（区切って作る・同じ中身）、覚えておく。素材ごとの採用・?artOff は tests/proto3d-ground-art.test.ts。
 * - 開始のボタンの待ち（BriefingGate）：素材の無いときは Version 21 と同じ（木だけ・12 秒で打ち切り）。素材は木の後 ART_WAIT_MS まで。
 *   出した後・合戦が始まった後に届いた素材は使わずに捨てる（takeGroundArt。地面は今までのまま）。
 * - 能力の欄の顔（battle.css）：顔は流れの外の小さな絵で、能力の見出しの行の幅・欄の高さを変えない（第二章の忠勝の「信頼」の行でも）。
 * 画像は WebGL なしで作れる DataTexture（確かめ用の 4×4 の色）を渡す（本物の画像は読まない）。状態は台本の命令と stepBattle だけで進める。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBattle, inTerrain, issueOrder, stepBattle, type BattleState } from '../proto3d/src/battle/sim';
import { FIELDS, buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import {
    ART_WAIT_MS,
    BriefingGate,
    DIRT_MAX,
    DIRT_ROAD_M,
    DIRT_WOODS_M,
    MASK_RANGE_M,
    ROAD_BAND_M,
    WOODS_BAND_M,
    __clearGroundCacheForTest,
    areaSignedDist,
    buildGroundData,
    buildGroundNoise,
    buildTerrainMask,
    coverageFromSd,
    dirtWeight,
    disposeGroundArtSet,
    groundDataCached,
    groundNoiseAt,
    fieldArtWanted,
    fieldHasArt,
    loadFieldArt,
    makeGroundArtMaterial,
    roundWoodsSpots,
    sampleMaskSd,
    takeGroundArt,
    type GroundArtSet,
    type MaskChannel,
} from '../proto3d/src/battle/groundArt';
import { DUST_MAX, UnitFx, type FxPose } from '../proto3d/src/battle/unitFx';
import { faceIdOf } from '../proto3d/src/battle/faceArt';
import { hash01 } from '../proto3d/src/battle/control';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { ART_IDS } from '../proto3d/src/art/ids';
import type { BattleMap, TerrainKind } from '../proto3d/src/battle/types';

const plains = () => createBattle(buildBattleSetup(getField('plains')!, 'standard'));

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

/** その種類の地形の区域の縁からの、本当の符号付き距離（同じ種類の区域の重なりは一番近いもの） */
function trueSd(map: BattleMap, kind: TerrainKind, x: number, z: number): number {
    let d = Number.POSITIVE_INFINITY;
    for (const a of map.terrain) if (a.kind === kind) d = Math.min(d, areaSignedDist(a, x, z));
    return d;
}

/**
 * 型紙と決まりの比べ：戦場の中の点で、縁から 0.15 m より離れた所は中・外が一致。
 * 混ぜる帯の中（縁から 1 m 以内）の距離のずれは distTol まで（戦場の端から 2 m 以内は除く：端に触れる道は、見た目だけ戦場の外へ伸ばしている）。
 * 同じ種類の区域が重なる・接する所（継ぎ目）の内側も、本当の縁までの距離（継ぎ目に混ぜる帯の筋を出さない）
 */
function checkMask(map: BattleMap, n: number, seed: number, distTol = 0.2): { inside: Record<string, number>; checked: number } {
    const mask = buildTerrainMask(map);
    const r = rng(seed);
    const kinds: [TerrainKind, MaskChannel][] = [
        ['road', 0],
        ['woods', 1],
    ];
    const inside: Record<string, number> = { road: 0, woods: 0 };
    let checked = 0;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) pts.push([(r() - 0.5) * map.width, (r() - 0.5) * map.depth]);
    // 縁のすぐ近くの点（区域ごとに、縁をはさんで ±0.2〜3 m）
    for (const a of map.terrain) {
        if (a.kind !== 'road' && a.kind !== 'woods') continue;
        for (let k = 0; k < 400; k++) {
            const x = (r() - 0.5) * map.width;
            const z = (r() - 0.5) * map.depth;
            // 縁の上の点へ寄せる：中心から外へ向かう線の上で距離 0 の所を二分で探す
            const c = a.circle ? { x: a.circle.cx, z: a.circle.cz } : a.rect ? { x: (a.rect.x0 + a.rect.x1) / 2, z: (a.rect.z0 + a.rect.z1) / 2 } : a.capsule ? { x: a.capsule.ax, z: a.capsule.az } : null;
            if (!c) continue;
            let lo = 0;
            let hi = 1;
            for (let i = 0; i < 40; i++) {
                const m = (lo + hi) / 2;
                if (areaSignedDist(a, c.x + (x - c.x) * m, c.z + (z - c.z) * m) <= 0) lo = m;
                else hi = m;
            }
            const ex = c.x + (x - c.x) * lo;
            const ez = c.z + (z - c.z) * lo;
            const off = (r() < 0.5 ? -1 : 1) * (0.2 + r() * 2.8);
            const len = Math.hypot(x - c.x, z - c.z) || 1;
            pts.push([ex + ((x - c.x) / len) * off, ez + ((z - c.z) / len) * off]);
        }
    }
    for (const [x, z] of pts) {
        if (Math.abs(x) > map.width / 2 || Math.abs(z) > map.depth / 2) continue;
        for (const [kind, ch] of kinds) {
            const t = trueSd(map, kind, x, z);
            const s = sampleMaskSd(mask, ch, x, z);
            const nearEdge = Math.abs(x) > map.width / 2 - 2 || Math.abs(z) > map.depth / 2 - 2;
            // 距離の比べは、その種類の区域が 1 つだけ近い所（区域の距離がそのまま縁までの距離）。継ぎ目は下の別の確かめ
            const single = map.terrain.filter((a) => a.kind === kind && areaSignedDist(a, x, z) < 3).length === 1;
            if (Math.abs(t) < 1 && !nearEdge && single) expect(Math.abs(s - t), `${map.id} ${kind} (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThan(distTol);
            if (Math.abs(t) <= 0.15) continue;
            const rule = inTerrain(map, kind, x, z);
            expect(s <= 0, `${map.id} ${kind} (${x.toFixed(2)}, ${z.toFixed(2)}) 決まり ${rule} 距離 ${t.toFixed(3)} 型紙 ${s.toFixed(3)}`).toBe(rule);
            if (rule) inside[kind]++;
            checked++;
        }
    }
    return { inside, checked };
}

describe('地面の型紙は決まりの地形の形と一致する', () => {
    it('大平原：道（x −7〜7）と円の林（中心 (130,−20)・半径 38）。多くの点で inTerrain と中・外が同じ', () => {
        const map = plains().map;
        const r = checkMask(map, 20000, 1570);
        expect(r.checked).toBeGreaterThan(40000);
        expect(r.inside.road).toBeGreaterThan(500);
        expect(r.inside.woods).toBeGreaterThan(500);
        const mask = buildTerrainMask(map);
        // 決まりの縁の上で混ざり具合は半分、縁から帯の半分（道 0.75 m・林 1 m）で完全に切り替わる
        expect(coverageFromSd(sampleMaskSd(mask, 0, 7, 50), ROAD_BAND_M)).toBeCloseTo(0.5, 1);
        expect(coverageFromSd(sampleMaskSd(mask, 0, 7 + ROAD_BAND_M / 2 + 0.1, 50), ROAD_BAND_M)).toBe(0);
        expect(coverageFromSd(sampleMaskSd(mask, 0, 7 - ROAD_BAND_M / 2 - 0.1, 50), ROAD_BAND_M)).toBe(1);
        expect(coverageFromSd(sampleMaskSd(mask, 1, 130 + 38, -20), WOODS_BAND_M)).toBeCloseTo(0.5, 1);
        expect(coverageFromSd(sampleMaskSd(mask, 1, 130 + 38 + WOODS_BAND_M / 2 + 0.1, -20), WOODS_BAND_M)).toBe(0);
        expect(coverageFromSd(sampleMaskSd(mask, 1, 130 + 38 - WOODS_BAND_M / 2 - 0.1, -20), WOODS_BAND_M)).toBe(1);
        expect(ROAD_BAND_M).toBeLessThanOrEqual(2);
        expect(WOODS_BAND_M).toBeLessThanOrEqual(2);
        // 道は戦場の端に触れるので、戦場の外へも続く（見た目だけ。戦場の中の幅は決まりのまま）
        expect(sampleMaskSd(mask, 0, 0, -200)).toBeLessThan(-5);
        expect(sampleMaskSd(mask, 0, 0, 200)).toBeLessThan(-5);
        expect(sampleMaskSd(mask, 0, 7.5, 159)).toBeGreaterThan(0);
        // ほかの地形（湿地・川など）は大平原には無い
        expect(sampleMaskSd(mask, 2, 0, 0)).toBeGreaterThan(MASK_RANGE_M - 0.2);
    });

    it('ほかの戦場の道・林（四角・円・カプセル）でも中・外が同じ（素材は大平原だけだが、形の作り方は同じ）', () => {
        let total = 0;
        for (const f of FIELDS) {
            const map = createBattle(buildBattleSetup(f, f.presets[0].id)).map;
            if (!map.terrain.some((a) => a.kind === 'road' || a.kind === 'woods')) continue;
            // 四角の角（中の距離が折れ曲がる所）は、1 m の画素の間の補間で 1/4 画素＋8 bit の刻みまでずれる（0.32 m まで。角がわずかに丸くなるだけ）
            total += checkMask(map, 1500, f.id.length * 97, 0.32).checked;
        }
        expect(total).toBeGreaterThan(20000);
    }, 60000);

    it('同じ種類の区域が接する所（継ぎ目）に混ぜる帯の筋を出さない（森林の西の林：四角が 4 つ接する。空き地の縁は縁のまま）', () => {
        const map = createBattle(buildBattleSetup(getField('forest')!, 'standard')).map;
        const mask = buildTerrainMask(map);
        // 四角どうしが接する線の上（林の奥）は林のまま
        for (const [x, z] of [
            [-190, -55],
            [-190, -95],
            [-135, -95],
            [-135, -55],
        ] as const) {
            expect(inTerrain(map, 'woods', x, z)).toBe(true);
            expect(coverageFromSd(sampleMaskSd(mask, 1, x, z), WOODS_BAND_M), `(${x}, ${z})`).toBe(1);
        }
        // 林の中の空き地（x −180〜−140・z −95〜−55）の縁は、決まりの縁で半分
        expect(coverageFromSd(sampleMaskSd(mask, 1, -180, -75), WOODS_BAND_M)).toBeCloseTo(0.5, 1);
        expect(coverageFromSd(sampleMaskSd(mask, 1, -160, -55), WOODS_BAND_M)).toBeCloseTo(0.5, 1);
        expect(coverageFromSd(sampleMaskSd(mask, 1, -160, -75), WOODS_BAND_M)).toBe(0);
    });
});

describe('土のむら（低い周波数の雑音）は草地の中の薄い不ぞろいの斑で、道・川・障害物・決まりのある地形に見えない', () => {
    it('大平原：道の縁から 6 m・林の縁から 5 m の内側には出ない。斑（少しでも土の混ざる所の全体）は丸みがあり（80 m² 以上の斑は長さと幅の比 2 まで）、長さ 22 m まで。覆う所は原の 1〜20%', () => {
        const map = plains().map;
        const mask = buildTerrainMask(map);
        const W = map.width;
        const D = map.depth;
        const vis = new Uint8Array(W * D);
        let covered = 0;
        for (let j = 0; j < D; j++) {
            for (let i = 0; i < W; i++) {
                const x = -W / 2 + i + 0.5;
                const z = -D / 2 + j + 0.5;
                const d = dirtWeight(groundNoiseAt(x, z).dirt, sampleMaskSd(mask, 0, x, z), sampleMaskSd(mask, 1, x, z), sampleMaskSd(mask, 2, x, z));
                // 道の縁から 6 m・林の縁から 5 m の内側には出さない（型紙の 8 bit の刻み 0.125 m の分だけ内側で確かめる）
                expect(DIRT_ROAD_M[0]).toBeGreaterThanOrEqual(6);
                expect(DIRT_WOODS_M[0]).toBeGreaterThanOrEqual(5);
                if (Math.abs(x) <= 7 + 6 - 0.2 || Math.hypot(x - 130, z + 20) <= 38 + 5 - 0.2) expect(d, `(${x}, ${z})`).toBe(0);
                // 斑は「少しでも土の混ざる所」の全体で形を見る（濃い真ん中だけでなく、薄い縁まで含めた広がり）
                if (d > 0.02) {
                    vis[j * W + i] = 1;
                    covered++;
                }
            }
        }
        const frac = covered / (W * D);
        expect(frac).toBeGreaterThan(0.01);
        expect(frac).toBeLessThan(0.2);
        // つながった斑ごとに：長さ（主な向きの広がり）と平均の幅（面積 ÷ 長さ）。筋（長く細い）にならない
        const seen = new Uint8Array(W * D);
        const blobs: { area: number; len: number; width: number; ratio: number; edge: boolean }[] = [];
        for (let k = 0; k < W * D; k++) {
            if (!vis[k] || seen[k]) continue;
            const stack = [k];
            seen[k] = 1;
            const cells: number[] = [];
            while (stack.length) {
                const c = stack.pop()!;
                cells.push(c);
                const ci = c % W;
                const cj = (c - ci) / W;
                for (const [di, dj] of [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ]) {
                    const ni = ci + di;
                    const nj = cj + dj;
                    if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
                    const n = nj * W + ni;
                    if (vis[n] && !seen[n]) {
                        seen[n] = 1;
                        stack.push(n);
                    }
                }
            }
            if (cells.length < 30) continue;
            // 調べた範囲（戦場）の端で切れた斑は、形を比べない（長さだけ）
            const edge = cells.some((c) => c % W === 0 || c % W === W - 1 || c < W || c >= W * (D - 1));
            let mx = 0;
            let mz = 0;
            for (const c of cells) {
                mx += c % W;
                mz += Math.floor(c / W);
            }
            mx /= cells.length;
            mz /= cells.length;
            let sxx = 0;
            let szz = 0;
            let sxz = 0;
            for (const c of cells) {
                const dx = (c % W) - mx;
                const dz = Math.floor(c / W) - mz;
                sxx += dx * dx;
                szz += dz * dz;
                sxz += dx * dz;
            }
            sxx /= cells.length;
            szz /= cells.length;
            sxz /= cells.length;
            const tr = sxx + szz;
            const det = sxx * szz - sxz * sxz;
            const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
            const l2 = Math.max(1e-6, tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det)));
            const len = Math.sqrt(12 * l1);
            blobs.push({ area: cells.length, len, width: cells.length / len, ratio: Math.sqrt(l1 / l2), edge });
        }
        expect(blobs.length).toBeGreaterThan(3);
        for (const b of blobs) {
            expect(b.len, JSON.stringify(b)).toBeLessThan(22);
            // 丸い（道・林の縁の近くで削られた斑は三日月形になるが、短い）。細長い筋（長さと幅の比が大きく長いもの）は無い
            if (!b.edge) expect(b.ratio, JSON.stringify(b)).toBeLessThan(b.area >= 80 ? 2 : 3.5);
        }
    });
    it('土のむらは薄く、縁はなだらか（くっきりした楕円にしない）：混ぜる割合は 0.4 まで。描く側が読む 2 m の画素の隣どうしの差は 0.6 まで・1 m で変わる混ぜる割合は 0.12 まで', () => {
        expect(DIRT_MAX).toBeLessThanOrEqual(0.4);
        const map = plains().map;
        const mask = buildTerrainMask(map);
        const nm = buildGroundNoise(mask);
        let maxStep = 0;
        let maxV = 0;
        let some = 0;
        for (let j = 0; j + 1 < nm.h; j++) {
            for (let i = 0; i + 1 < nm.w; i++) {
                const v = nm.data[(j * nm.w + i) * 4 + 2];
                const r = nm.data[(j * nm.w + i + 1) * 4 + 2];
                const b = nm.data[((j + 1) * nm.w + i) * 4 + 2];
                maxV = Math.max(maxV, v);
                if (v > 0) some++;
                maxStep = Math.max(maxStep, Math.abs(r - v), Math.abs(b - v));
            }
        }
        expect(some).toBeGreaterThan(100);
        expect(maxV).toBeGreaterThan(200);
        expect(maxStep / 255, '隣の画素との差（斑の濃さ 0〜1 に対して）').toBeLessThanOrEqual(0.6);
        // CPU の式でも、1 m 動いたときの混ぜる割合の変わりは 0.12 まで（0 から上限 0.35 まで 3 m 以上かけて変わる。
        // 前の斑（上限 0.7・縁は半径の 45% の幅）は 1 m で 0.47 まで変わり、くっきりした楕円に見えた）
        let maxGrad = 0;
        for (let k = 0; k < 40000; k++) {
            const x = ((k * 7919) % 400) - 200 + 0.37;
            const z = ((k * 104729) % 320) - 160 + 0.61;
            const w = (px: number, pz: number) => dirtWeight(groundNoiseAt(px, pz).dirt, sampleMaskSd(mask, 0, px, pz), sampleMaskSd(mask, 1, px, pz), sampleMaskSd(mask, 2, px, pz));
            const d = w(x, z);
            maxGrad = Math.max(maxGrad, Math.abs(w(x + 0.5, z) - d) * 2, Math.abs(w(x, z + 0.5) - d) * 2);
        }
        expect(maxGrad).toBeLessThanOrEqual(0.12);
        expect(maxGrad).toBeGreaterThan(0);
    });
    it('雑音の画像は CPU の式（groundNoiseAt）と同じ値（2 m の画素）', () => {
        const mask = buildTerrainMask(plains().map);
        const nm = buildGroundNoise(mask);
        expect(nm.cell).toBe(2);
        for (const [i, j] of [
            [10, 10],
            [160, 140],
            [300, 250],
        ]) {
            const n = groundNoiseAt(nm.x0 + (i + 0.5) * nm.cell, nm.z0 + (j + 0.5) * nm.cell);
            const o = (j * nm.w + i) * 4;
            expect(nm.data[o]).toBe(Math.round(n.big * 255));
            expect(nm.data[o + 2]).toBe(Math.round(n.dirt * 255));
            expect(nm.data[o + 3]).toBe(Math.round(n.tile * 255));
        }
    });
});

describe('円の林の木（素材の地面を使うときだけ）', () => {
    it('大平原の東の林：決まりの区域の内側（縁から 3 m 内側）だけに植える', () => {
        const wood = getField('plains')!.terrain.find((a) => a.kind === 'woods')!;
        const map = plains().map;
        for (const sp of [16, 24]) {
            const spots = roundWoodsSpots(wood, sp, hash01);
            expect(spots.length).toBeGreaterThan(sp === 16 ? 10 : 4);
            for (const t of spots) {
                expect(inTerrain(map, 'woods', t.x, t.z)).toBe(true);
                expect(Math.hypot(t.x - 130, t.z + 20)).toBeLessThanOrEqual(38 - 3 + 1e-9);
            }
            // 同じ配置（決まった乱数）
            expect(roundWoodsSpots(wood, sp, hash01)).toEqual(spots);
        }
    });
});

// ---------------------------------------------------------------- 表示は合戦の状態を変えない

/** 確かめ用の地面の素材（4×4 の色。本物の画像ではない）。型紙と雑音はその戦場の物 */
function fakeSet(map: BattleMap = plains().map, low = false): GroundArtSet {
    const tex = (v: number) => {
        const t = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(v), 4, 4);
        t.needsUpdate = true;
        return { texture: t as THREE.Texture, tileMeters: 8 };
    };
    const mask = buildTerrainMask(map);
    return { grass: tex(120), dirt: tex(90), road: tex(160), forest: tex(60), ground: { mask, noise: buildGroundNoise(mask) }, low };
}

/** 大平原の台本：騎馬を回し、時間で攻めかかる（斬り合い・敗走が起きる。能力は使わない） */
function plainsScript(s: BattleState): void {
    const t = Math.round(s.t * 10) / 10;
    if (t === 5) issueOrder(s, 'a_kiba', { type: 'move', x: -150, z: -40 });
    if (t === 60) issueOrder(s, 'a_kiba', { type: 'attack', targetId: 'e_left' });
    if (t === 90) issueOrder(s, 'a_ishikawa', { type: 'attack', targetId: 'e_sente' });
    if (t === 150) for (const id of ['a_tadakatsu', 'a_sakai', 'a_sakakibara']) issueOrder(s, id, { type: 'attack', targetId: 'e_hq' });
}

function snapshot(s: BattleState): string {
    return JSON.stringify(s, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
}

function run(s: BattleState, script: (s: BattleState) => void, each: ((s: BattleState) => void) | null, maxSec: number): string[] {
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

/** のぼりの画像の canvas だけ、何もしない仮にする（node には document が無い） */
async function withFakeDocument<T>(fn: () => Promise<T>): Promise<T> {
    const g = globalThis as unknown as { document?: unknown };
    const had = 'document' in g;
    const prev = g.document;
    const ctx2d = new Proxy({}, { get: () => () => undefined, set: () => true });
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
    try {
        return await fn();
    } finally {
        if (had) g.document = prev;
        else delete g.document;
    }
}

describe('素材の地面・足元の影・砂ぼこりは合戦の状態を変えない', () => {
    it('BattleView に素材の地面を付けて毎刻み update しても、表示なしと同じ。押す判定・名札の位置も素材なしと同じ', async () => {
        await withFakeDocument(async () => {
            const { BattleView } = await import('../proto3d/src/battle/view');
            const a = plains();
            const plain = run(a, plainsScript, null, 240);

            const b = plains();
            const on = new BattleView(b, { low: false });
            const off = new BattleView(b, { low: false });
            for (const v of [on, off]) {
                v.resize(1280, 720);
                v.fit({ top: 60, bottom: 110, left: 10, right: 10 });
            }
            // 作っただけでは今までの地面（画像は読まない）。円の林には木を植えない（Version 21 と同じ）
            expect(on.artProbe()).toEqual({ ground: 'vertex', materials: [], trees: 0, shadows: 0, dust: 0 });
            expect(on.treeSpots()).toEqual([]);
            expect(on.setGroundArt(fakeSet(b.map))).toBe(true);
            expect(on.setGroundArt(fakeSet(b.map))).toBe(false);
            expect(on.groundArtActive).toBe(true);
            expect(off.groundArtActive).toBe(false);
            expect(on.artProbe().ground).toBe('textured');
            expect(on.artProbe().materials).toEqual(['grass', 'dirt', 'road', 'forest']);
            // 確かめ用の組は林床もあるので、円の林に木を植える（林床を使わない組は tests/proto3d-ground-art.test.ts）
            expect(on.artProbe().trees).toBeGreaterThan(10);
            let k = 0;
            let maxShadows = 0;
            let maxDust = 0;
            let pickChecks = 0;
            const drawn = run(
                b,
                plainsScript,
                (s) => {
                    const ui = { selectedId: k % 50 < 25 ? 'a_tadakatsu' : null, pending: 'none' as const, speed: k % 400 < 200 ? 1 : 2 };
                    on.update(s, 1 / 30, ui);
                    off.update(s, 1 / 30, ui);
                    const p = on.artProbe();
                    maxShadows = Math.max(maxShadows, p.shadows);
                    maxDust = Math.max(maxDust, p.dust);
                    expect(p.dust).toBeLessThanOrEqual(DUST_MAX);
                    if (k % 97 === 0) {
                        for (let sx = 40; sx < 1280; sx += 120) {
                            for (let sy = 40; sy < 720; sy += 90) {
                                expect(on.pick(s, sx, sy, 20)).toBe(off.pick(s, sx, sy, 20));
                                pickChecks++;
                            }
                        }
                        for (let i = 0; i < s.units.length; i++) expect(on.labelAnchor(i)).toEqual(off.labelAnchor(i));
                    }
                    k++;
                },
                240,
            );
            expect(drawn).toEqual(plain);
            expect(b.result).toEqual(a.result);
            expect(pickChecks).toBeGreaterThan(1000);
            // 影は見えている部隊に出ていた・斬り合い・騎馬の動きで砂ぼこりも出た（上限の中）
            expect(maxShadows).toBeGreaterThanOrEqual(7);
            expect(maxDust).toBeGreaterThan(0);
            expect(on.troopStats().visibleSoldiers).toBe(off.troopStats().visibleSoldiers);
            on.dispose();
            off.dispose();
        });
    }, 120000);

    it('影と砂ぼこりは見えている部隊だけ（見えていない敵には出さず、見えなくなった部隊の煙はすぐ消す）', () => {
        const s = plains();
        const fx = new UnitFx(s.map, s.units.length);
        const poses: FxPose[] = s.units.map((u) => ({ px: u.x, pz: u.z, sx: 0, sz: 0, face: u.facing, halfW: 10, halfD: 5, shown: u.side === 'ally', routT: -1 }));
        // 騎馬（味方）を動かしている扱い：合戦の時計を進めながら
        const kiba = s.units.findIndex((u) => u.id === 'a_kiba');
        const ekiba = s.units.findIndex((u) => u.id === 'e_kiba');
        s.units[kiba].moving = true;
        s.units[ekiba].moving = true;
        let t = 0;
        for (let i = 0; i < 60; i++) {
            s.t = Math.round(i / 3) * 0.1;
            fx.update(s, poses, t, 1 / 30, 1);
            t += 1 / 30;
        }
        const c = fx.counts();
        expect(c.shadows).toBe(s.units.filter((u) => u.side === 'ally').length);
        expect(c.dust).toBeGreaterThan(0);
        // 見えなくなったら、その部隊の煙はその場で消える
        poses[kiba].shown = false;
        fx.update(s, poses, t, 1 / 30, 1);
        expect(fx.counts().dust).toBe(0);
        expect(fx.counts().shadows).toBe(c.shadows - 1);
        // 止めている間（合戦の時計が進まない）は新しく出さない
        poses[kiba].shown = true;
        for (let i = 0; i < 30; i++) {
            t += 1 / 30;
            fx.update(s, poses, t, 1 / 30, 1);
        }
        expect(fx.counts().dust).toBe(0);
        fx.dispose();
    });
});

describe('使うかどうか（旧表示・素材の一覧）', () => {
    const g = globalThis as unknown as { location?: unknown };
    afterEach(() => {
        delete g.location;
        __setArtManifestForTest(null);
    });
    it('素材の地面は大平原だけ。旧表示（?art=old）では使わない。一覧に無ければ読まずに null（今までの地面）', async () => {
        expect(fieldHasArt('plains')).toBe(true);
        expect(fieldHasArt('forest')).toBe(false);
        const forest = createBattle(buildBattleSetup(getField('forest')!, 'standard')).map;
        expect(await loadFieldArt(plains().map, { anisotropy: 4, low: false })).toBeNull();
        expect(await loadFieldArt(forest, { anisotropy: 4, low: false })).toBeNull();
        g.location = { search: '?art=old', hash: '' };
        expect(fieldHasArt('plains')).toBe(false);
        expect(await loadFieldArt(plains().map, { anisotropy: 4, low: false })).toBeNull();
    });
    it('顔は絵の届いた武将の自分の顔だけ（ほかの人の顔で代用しない・主人公や架空の人物には出さない）。旧表示では出さない', () => {
        // 素材パック sengoku_art_pack_v1 で届いた 6 人。酒井・本多・榊原を取り違えない（武将 id と素材の ID が一致）
        for (const id of ['ieyasu', 'tadakatsu', 'sakai', 'ishikawa', 'sakakibara', 'nagamasa']) expect(faceIdOf(id)).toBe(`face.${id}`);
        // 主人公（国境の原の若殿）・架空の人物・画面に出ない人物（信長・義景）には出さない
        for (const id of ['hero', 'genzo', 'shinpachi', 'washio_gen', 'nobunaga', 'yoshikage', '', null, undefined]) expect(faceIdOf(id)).toBeNull();
        g.location = { search: '?art=old', hash: '' };
        expect(faceIdOf('ieyasu')).toBeNull();
    });
});

// ---------------------------------------------------------------- 読み込み・型紙の覚え・開始のボタンの待ち・遅れて届いた素材

/** 大平原の地面の素材 4 枚の記録（確かめ用。本物の画像ではない） */
const GROUND_ASSETS = {
    [ART_IDS.plainsGrass]: { file: 'art/tex/plains_grass.webp', w: 1024, h: 1024, kind: 'texture' as const, meta: { tileMeters: 6 } },
    [ART_IDS.plainsDirt]: { file: 'art/tex/plains_dirt.webp', w: 1024, h: 1024, kind: 'texture' as const },
    [ART_IDS.plainsRoad]: { file: 'art/tex/plains_road.webp', w: 1024, h: 1024, kind: 'texture' as const, meta: { tileMeters: 4 } },
    [ART_IDS.plainsForest]: { file: 'art/tex/plains_forest.webp', w: 1024, h: 1024, kind: 'texture' as const, meta: { tileMeters: 'x' } },
};

/** 素材の一覧と読み込み（fetch → createImageBitmap）の偽物。fail に入れた画像は 404。読んだ URL を返す */
function fakeArt(o: { fail?: string[]; assets?: Record<string, unknown> } = {}): string[] {
    __setArtManifestForTest({ version: 1, assets: (o.assets ?? GROUND_ASSETS) as never });
    const urls: string[] = [];
    vi.stubGlobal('location', { search: '', hash: '' });
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        const bad = (o.fail ?? []).some((f) => String(url).endsWith(f));
        return bad ? { ok: false, status: 404 } : { ok: true, status: 200, blob: async () => ({ url: String(url) }) };
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1024, height: 1024, close() {} }));
    return urls;
}

/** 大きなバイト列が同じか（toEqual は 1 要素ずつで遅い） */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** 4 枚の素材が捨てられたか（three の dispose の知らせを数える） */
function watchDispose(set: GroundArtSet): () => number {
    let n = 0;
    for (const t of [set.grass, set.dirt, set.road, set.forest]) t!.texture.addEventListener('dispose', () => n++);
    return () => n;
}

describe('地面の素材の読み込み（loadFieldArt）と型紙・雑音の覚え', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        __setArtManifestForTest(null);
        __clearGroundCacheForTest();
    });
    it('一覧に載った素材を全部読めたら全部使う：1 枚の大きさは meta.tileMeters（無い・数でない時は 8 m）。anisotropy は 4 まで、低い画質では 1。型紙と雑音は大平原の物', async () => {
        const urls = fakeArt();
        const map = plains().map;
        expect(fieldArtWanted('plains')).toBe(true);
        const set = await loadFieldArt(map, { anisotropy: 16, low: false });
        expect(set).not.toBeNull();
        expect(urls.length).toBe(4);
        expect([set!.grass!.tileMeters, set!.dirt!.tileMeters, set!.road!.tileMeters, set!.forest!.tileMeters]).toEqual([6, 8, 4, 8]);
        expect(set!.grass!.texture.anisotropy).toBe(4);
        expect(set!.low).toBe(false);
        // 型紙と雑音は一度に作った物と同じ中身（区切って作っても同じ）
        const mask = buildTerrainMask(map);
        expect(sameBytes(set!.ground.mask.data, mask.data)).toBe(true);
        expect(sameBytes(set!.ground.noise.data, buildGroundNoise(mask).data)).toBe(true);
        // 低い画質：anisotropy 1。型紙は覚えている物をそのまま使う（作り直さない）
        const low = await loadFieldArt(map, { anisotropy: 16, low: true });
        expect(low!.grass!.texture.anisotropy).toBe(1);
        expect(low!.low).toBe(true);
        expect(low!.ground).toBe(set!.ground);
        // 画像は同じ ID を 2 度読まない（読み込みの登録が覚えている）
        expect(urls.length).toBe(4);
        disposeGroundArtSet(set);
        disposeGroundArtSet(low);
    }, 30000);
    it('読めない素材はその種類だけ null（Version 21 の色）・ほかの種類は使う。全部読めなければ null（今までの地面）。作り始めた型紙は次の合戦のために覚えておく', async () => {
        // Version 22 は 1 枚でも読めなければ全部使わなかった（Version 23 から素材ごと）
        let urls = fakeArt({ fail: ['plains_road.webp'] });
        const map = plains().map;
        const set = await loadFieldArt(map, { anisotropy: 4, low: false });
        expect(urls.length).toBe(4);
        expect(set!.road).toBeNull();
        expect([!!set!.grass, !!set!.dirt, !!set!.forest]).toEqual([true, true, true]);
        disposeGroundArtSet(set);
        __clearGroundCacheForTest();
        urls = fakeArt({ fail: ['plains_grass.webp', 'plains_dirt.webp', 'plains_road.webp', 'plains_forest.webp'] });
        expect(await loadFieldArt(map, { anisotropy: 4, low: false })).toBeNull();
        expect(urls.length).toBe(4);
        expect(groundDataCached(map)).toBe(true);
    }, 30000);
    it('一覧に 1 枚も無い・旧表示・素材の無い戦場：画像を読みに行かず、型紙も作らない（Version 21 と同じ。開始のボタンも待たない）。一覧に 3 枚だけなら 3 枚を使う', async () => {
        const map = plains().map;
        // 一覧が空（Version 22 の本番）
        __setArtManifestForTest(null);
        const urls = fakeArt({ assets: {} });
        expect(fieldArtWanted('plains')).toBe(false);
        expect(await loadFieldArt(map, { anisotropy: 4, low: false })).toBeNull();
        // 旧表示
        fakeArt();
        vi.stubGlobal('location', { search: '?art=old', hash: '' });
        expect(fieldArtWanted('plains')).toBe(false);
        expect(await loadFieldArt(map, { anisotropy: 4, low: false })).toBeNull();
        // 素材の無い戦場
        vi.stubGlobal('location', { search: '', hash: '' });
        expect(fieldArtWanted('forest')).toBe(false);
        expect(urls.length).toBe(0);
        expect(groundDataCached(map)).toBe(false);
        // 一覧に 3 枚だけ（林床が無い＝Version 23 の本番と同じ形）：3 枚を使い、林床は null（林は Version 21 の色）。林床の画像は読みに行かない
        const { [ART_IDS.plainsForest]: _f, ...three } = GROUND_ASSETS;
        const urls3 = fakeArt({ assets: three });
        expect(fieldArtWanted('plains')).toBe(true);
        const set = await loadFieldArt(map, { anisotropy: 4, low: false });
        expect(set!.forest).toBeNull();
        expect([!!set!.grass, !!set!.dirt, !!set!.road]).toEqual([true, true, true]);
        expect(urls3.some((u) => u.includes('forest'))).toBe(false);
        expect(urls3.length).toBe(3);
        disposeGroundArtSet(set);
    }, 30000);
    it('型紙と雑音は戦場の形ごとに 1 度だけ作る（同時に呼んでも同じ約束）。区切って作る（間に他の処理が入る）。形が違えば別の物', async () => {
        const map = plains().map;
        let ticks = 0;
        const iv = setInterval(() => ticks++, 0);
        const p1 = buildGroundData(map, 2);
        const p2 = buildGroundData(map, 2);
        expect(p2).toBe(p1);
        const g = await p1;
        clearInterval(iv);
        // 2 ms ずつ区切ったので、作る間に他の処理（ここでは時計）が何度も動いた
        expect(ticks).toBeGreaterThan(3);
        expect(sameBytes(g.mask.data, buildTerrainMask(map).data)).toBe(true);
        expect(await buildGroundData(map)).toBe(g);
        // 同じ id でも地形の形が違えば取り違えない
        const other = { ...map, terrain: map.terrain.filter((a) => a.kind !== 'woods') };
        const g2 = await buildGroundData(other);
        expect(g2).not.toBe(g);
        expect(sampleMaskSd(g2.mask, 1, 130, -20)).toBeGreaterThan(MASK_RANGE_M - 0.2);
    }, 30000);
});

describe('開始のボタンの待ち（BriefingGate）と遅れて届いた素材（takeGroundArt）', () => {
    /** 手で進める時計 */
    function clock() {
        let now = 0;
        const timers: { at: number; fn: () => void; live: boolean }[] = [];
        const timer = (fn: () => void, ms: number) => {
            const t = { at: now + ms, fn, live: true };
            timers.push(t);
            return () => void (t.live = false);
        };
        const advance = (ms: number) => {
            now += ms;
            for (const t of timers) if (t.live && t.at <= now) (t.live = false), t.fn();
        };
        return { timer, advance, live: () => timers.filter((t) => t.live).length };
    }
    it('素材を読みに行かない（wantArt false）：Version 21 と同じ。木が済んだその時に出す・木が来なければ 12 秒で出す。1 度だけ', () => {
        for (const late of [false, true]) {
            const c = clock();
            let ready = 0;
            const g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: false, onReady: () => ready++, timer: c.timer });
            if (!late) {
                c.advance(800);
                expect(ready).toBe(0);
                g.treesDone();
                expect(ready).toBe(1);
                expect(c.live()).toBe(0);
            } else {
                c.advance(11999);
                expect(ready).toBe(0);
                c.advance(1);
                expect(ready).toBe(1);
                g.treesDone();
            }
            c.advance(20000);
            expect(ready).toBe(1);
            expect(g.settled).toBe(true);
        }
    });
    it('素材を読みに行く：木の後 ART_WAIT_MS まで待つ。先に届けば木と同時、間に届けばその時、過ぎたら待たずに出す（12 秒の打ち切りは同じ）', () => {
        expect(ART_WAIT_MS).toBeLessThanOrEqual(3000);
        // 素材が先
        let c = clock();
        let ready = 0;
        let g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: true, onReady: () => ready++, timer: c.timer });
        g.artDone();
        expect(ready).toBe(0);
        c.advance(500);
        g.treesDone();
        expect(ready).toBe(1);
        // 木の後、待ちの間に届く
        c = clock();
        ready = 0;
        g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: true, onReady: () => ready++, timer: c.timer });
        g.treesDone();
        c.advance(ART_WAIT_MS - 1);
        expect(ready).toBe(0);
        expect(g.settled).toBe(false);
        g.artDone();
        expect(ready).toBe(1);
        // 届かない：木の後 ART_WAIT_MS で出す。その後に届いても何もしない（settled）
        c = clock();
        ready = 0;
        g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: true, onReady: () => ready++, timer: c.timer });
        c.advance(1000);
        g.treesDone();
        c.advance(ART_WAIT_MS);
        expect(ready).toBe(1);
        expect(g.settled).toBe(true);
        g.artDone();
        expect(ready).toBe(1);
        // 木も来ない：12 秒で出す（Version 21 より遅くしない）
        c = clock();
        ready = 0;
        g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: true, onReady: () => ready++, timer: c.timer });
        c.advance(12000);
        expect(ready).toBe(1);
        // 片付けた後は出さない
        c = clock();
        ready = 0;
        g = new BriefingGate({ treeTimeoutMs: 12000, artWaitMs: ART_WAIT_MS, wantArt: true, onReady: () => ready++, timer: c.timer });
        g.dispose();
        g.treesDone();
        g.artDone();
        c.advance(20000);
        expect(ready).toBe(0);
        expect(c.live()).toBe(0);
    });
    it('開始のボタンを出した後・合戦が始まった後に届いた素材は使わずに捨てる（地面は今までのまま）。間に合えば使う', async () => {
        await withFakeDocument(async () => {
            const { BattleView } = await import('../proto3d/src/battle/view');
            const s = plains();
            const v = new BattleView(s, { low: false });
            // 遅れて届いた（open = false）：使わない・4 枚とも捨てる
            const late = fakeSet(s.map);
            const lateDisposed = watchDispose(late);
            let applied = 0;
            expect(
                takeGroundArt(late, false, (a) => {
                    applied++;
                    return v.setGroundArt(a);
                }),
            ).toBe(false);
            expect(applied).toBe(0);
            expect(lateDisposed()).toBe(4);
            expect(v.artProbe().ground).toBe('vertex');
            expect(v.treeSpots()).toEqual([]);
            // 間に合った：使う（捨てない）
            const ok = fakeSet(s.map);
            const okDisposed = watchDispose(ok);
            expect(takeGroundArt(ok, true, (a) => v.setGroundArt(a))).toBe(true);
            expect(okDisposed()).toBe(0);
            expect(v.artProbe().ground).toBe('textured');
            // もう使っている（2 組目）：受け取らないので捨てる
            const dup = fakeSet(s.map);
            const dupDisposed = watchDispose(dup);
            expect(takeGroundArt(dup, true, (a) => v.setGroundArt(a))).toBe(false);
            expect(dupDisposed()).toBe(4);
            expect(takeGroundArt(null, true, () => true)).toBe(false);
            // 片付けで、使った素材も捨てる
            v.dispose();
            expect(okDisposed()).toBe(4);
            // 片付けた後の表示には使わない
            const after = fakeSet(s.map);
            const afterDisposed = watchDispose(after);
            expect(takeGroundArt(after, true, (a) => v.setGroundArt(a))).toBe(false);
            expect(afterDisposed()).toBe(4);
        });
    });
});

describe('地面の材質：背景の色（昼・夜）と低い画質', () => {
    /** onBeforeCompile に渡る形（three の WebGL なしで、足した uniform と式を見る） */
    function compiled(mat: THREE.Material): { uniforms: Record<string, { value: unknown }>; frag: string } {
        const shader = {
            uniforms: {} as Record<string, { value: unknown }>,
            vertexShader: '#include <common>\n#include <begin_vertex>',
            fragmentShader: '#include <common>\n#include <color_fragment>',
        };
        (mat.onBeforeCompile as (s: typeof shader, r: unknown) => void)(shader, null);
        return { uniforms: shader.uniforms, frag: shader.fragmentShader };
    }
    it('戦場の外を薄める色は表示の背景の色（夜の合戦は夜の背景）。低い画質では草地を 1 回だけ読む（GA_LOW）', async () => {
        await withFakeDocument(async () => {
            const { BattleView } = await import('../proto3d/src/battle/view');
            const day = plains();
            const setup = buildBattleSetup(getField('plains')!, 'standard');
            const night = createBattle({ ...setup, night: { sight: 90, detectRange: 70 } });
            for (const [s, low] of [
                [day, false],
                [night, true],
            ] as const) {
                const v = new BattleView(s, { low });
                expect(v.setGroundArt(fakeSet(s.map, low))).toBe(true);
                const mesh = (v as unknown as { groundMesh: THREE.Mesh }).groundMesh;
                const mat = mesh.material as THREE.MeshLambertMaterial;
                const c = compiled(mat);
                const bg = (v as unknown as { scene: THREE.Scene }).scene.background as THREE.Color;
                expect((c.uniforms.gaBg.value as THREE.Color).getHex()).toBe(bg.getHex());
                expect(bg.getHex()).toBe(s === night ? 0x26301f : 0x56653f);
                expect(!!mat.defines && 'GA_LOW' in mat.defines).toBe(low);
                expect(mat.customProgramCacheKey()).toBe(low ? 'battle-ground-art-5-grass-dirt-road-forest-low' : 'battle-ground-art-5-grass-dirt-road-forest');
                expect(c.frag).toContain('#ifdef GA_LOW');
                v.dispose();
            }
        });
    });
    it('makeGroundArtMaterial：背景の色を渡さなければ昼の背景', () => {
        const s = plains();
        const set = fakeSet(s.map);
        const m = makeGroundArtMaterial(s.map, null, set);
        expect((compiled(m.material).uniforms.gaBg.value as THREE.Color).getHex()).toBe(0x56653f);
        m.material.dispose();
        m.mask.dispose();
        m.noise.dispose();
        disposeGroundArtSet(set);
    });
});

// ---------------------------------------------------------------- 能力の欄の顔（battle.css）

describe('合戦の顔の規則（battle.css）：能力の欄は顔を大きく・欄の幅と位置は変えない。札・発動の知らせは Version 22 のまま', () => {
    // テストは Node で動く。Node の型定義は入れていないので、使う関数だけ型を付ける
    const fsName = 'node:fs';
    const cssText = (async () => {
        const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: URL, enc: 'utf8'): string };
        return fs.readFileSync(new URL('../proto3d/public/battle.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    })();
    let css = '';
    beforeAll(async () => {
        css = await cssText;
    });
    /** 規則（選ぶ側 → 中身）の一覧。@media の中は media に入れる */
    function rules(): { media: string; sel: string; body: string }[] {
        const out: { media: string; sel: string; body: string }[] = [];
        const re = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(css))) {
            if (m[1] !== undefined) {
                const inner = /([^{}]+)\{([^{}]*)\}/g;
                let n: RegExpExecArray | null;
                while ((n = inner.exec(m[2]))) out.push({ media: m[1].trim(), sel: n[1].trim(), body: n[2] });
            } else out.push({ media: '', sel: m[3].trim(), body: m[4] });
        }
        return out;
    }
    const prop = (body: string, name: string): string | null => {
        const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body);
        return m ? m[1].trim() : null;
    };
    it('能力の欄の with-face：欄の幅・余白・位置・最大の高さは変えない。顔の右に並べるのは武将の行と能力の見出しだけ（ほかの行は欄の幅いっぱい）', () => {
        const rs = rules().filter((r) => r.sel.includes('.b-abil.with-face'));
        expect(rs.length).toBeGreaterThan(4);
        const sels = (r: { sel: string }) => r.sel.split(',').map((x) => x.trim());
        for (const r of rs) {
            for (const sel of sels(r)) {
                // 使い方・残り・対象・範囲・効果・代償・回数・断りの行には、個別の規則を掛けない（文字の大きさ・折り返しは Version 22 と同じ）
                expect(sel, sel).not.toMatch(/\.b-ab-r|\.b-ab-why|\.b-ab-long|\.b-ab-note|\.b-ab-st/);
                // 欄そのものの大きさ・余白・位置は変えない。[hidden] の欄を出さない（display を変える規則は :not([hidden]) 付きだけ）
                if (/^\.b-abil\.with-face(:not\(\[hidden\]\))?$/.test(sel)) {
                    for (const p of ['padding', 'height', 'min-height', 'max-height', 'margin', 'width', 'position', 'left', 'top', 'overflow', 'font-size', 'line-height']) expect(prop(r.body, p), `${sel} ${p}`).toBeNull();
                    if (prop(r.body, 'display') !== null) expect(sel).toBe('.b-abil.with-face:not([hidden])');
                }
            }
        }
        const find = (media: string, sel: string) => rs.find((r) => (media ? r.media.includes(media) : r.media === '') && sels(r).includes(sel));
        expect(prop(find('', '.b-abil.with-face:not([hidden])')!.body, 'display')).toBe('grid');
        // ほかの行は 2 列をまたぐ（欄の幅いっぱい）。顔は 1 列目で武将の行と能力の見出しの 2 行をまたぐ
        expect(prop(find('', '.b-abil.with-face > *')!.body, 'grid-column')).toBe('1 / -1');
        const face = find('', '.b-abil.with-face > .b-face')!;
        expect(prop(face.body, 'grid-column')).toBe('1');
        expect(prop(face.body, 'grid-row')).toBe('1 / span 2');
        const gen = find('', '.b-abil.with-face > .b-gen')!;
        const head = find('', '.b-abil.with-face > .b-ab-h')!;
        expect([prop(gen.body, 'grid-column'), prop(gen.body, 'grid-row')]).toEqual(['2', '1']);
        expect([prop(head.body, 'grid-column'), prop(head.body, 'grid-row')]).toEqual(['2', '2']);
        // 能力の見出しは並べる場所と、顔の右で折り返した時の行の間だけ（字・余白・区切り・横のすき間は今までどおり）
        for (const p of head.body.split(';').map((x) => x.split(':')[0]!.trim()).filter(Boolean)) expect(['grid-column', 'grid-row', 'align-self', 'row-gap']).toContain(p);
        // 武将の行の「固有能力「…」」は省く（すぐ下の見出しと同じ名前）
        expect(prop(find('', '.b-abil.with-face > .b-gen > .b-gen-ab')!.body, 'display')).toBe('none');
        // 顔の規則は地図の上の名札（.b-label）に掛けない（名札は大きくしない）
        expect(rules().filter((r) => /b-face/.test(r.sel) && /\.b-label/.test(r.sel))).toEqual([]);
    });
    it('能力の欄の顔の大きさ：PC 48〜64 px（大きな画面も）・縦の狭い画面 40 px 以上（1 列目の幅＝顔の幅）。欄が高くなるのは顔が 2 行より高い分だけ（PC 16 px・大きな画面 24 px・縦の狭い画面 14 px まで）', () => {
        const all = rules();
        const px = (v: string | null) => (v === null ? NaN : parseFloat(v));
        const find = (media: string, sel: string) => all.find((r) => (media ? r.media.includes(media) : r.media === '') && r.sel.split(',').map((x) => x.trim()).includes(sel));
        const firstCol = (media: string) => px(prop(find(media, '.b-abil.with-face:not([hidden])')!.body, 'grid-template-columns')!.split(/\s+/)[0]!);
        // PC（12 px・行の高さ 1.45）：武将の行 1 行＋能力の見出し（上の余白 3＋3・区切り 1 px）
        const f = find('', '.b-abil.with-face > .b-face')!;
        const w = px(prop(f.body, 'width'));
        const mb = px(prop(f.body, 'margin-bottom') ?? '0');
        expect(px(prop(f.body, 'height'))).toBe(w);
        expect(w).toBeGreaterThanOrEqual(48);
        expect(w).toBeLessThanOrEqual(64);
        expect(firstCol('')).toBe(w);
        expect(w + mb - (12 * 1.45 + 12 * 1.45 + 7)).toBeLessThanOrEqual(16);
        // 大きな画面（1600×900 以上）：少し大きく。それでも 64 px まで
        const wf = find('min-width: 1600px', '.b-abil.with-face > .b-face')!;
        const ww = px(prop(wf.body, 'width'));
        expect(px(prop(wf.body, 'height'))).toBe(ww);
        expect(ww).toBeGreaterThanOrEqual(w);
        expect(ww).toBeLessThanOrEqual(64);
        expect(firstCol('min-width: 1600px')).toBe(ww);
        expect(ww + mb - (12 * 1.45 + 12 * 1.45 + 7)).toBeLessThanOrEqual(24);
        // 縦の狭い画面（武将の行 10.5 px・行の高さ 1.2、能力の見出し 11 px・1.35、すき間 1＋1 px）
        const cf = find('max-height: 520px', '.b-abil.with-face > .b-face')!;
        const cw = px(prop(cf.body, 'width'));
        expect(px(prop(cf.body, 'height'))).toBe(cw);
        expect(cw).toBeGreaterThanOrEqual(40);
        expect(cw).toBeLessThan(w);
        expect(firstCol('max-height: 520px')).toBe(cw);
        expect(cw + mb - (10.5 * 1.2 + 11 * 1.35 + 2)).toBeLessThanOrEqual(14);
        const compactHide = find('max-height: 520px', '.b-gen:has(+ .b-ab-h) .b-gen-ab');
        expect(compactHide && prop(compactHide.body, 'display')).toBe('none');
        // PC で目標の欄を開いたまま（左上の列の高さに上限）：顔は 40 px 以上で、2 行（武将の行・能力の見出し）の高さを超えない＝欄を高くしない
        const go = find('min-height: 521px', '.b-root.goals-open .b-abil.with-face > .b-face')!;
        const gw = px(prop(go.body, 'width'));
        const gmb = px(prop(go.body, 'margin-bottom') ?? '0');
        expect(px(prop(go.body, 'height'))).toBe(gw);
        expect(gw).toBeGreaterThanOrEqual(40);
        expect(gw + gmb).toBeLessThanOrEqual(12 * 1.45 + 12 * 1.45 + 7);
        expect(px(prop(find('min-height: 521px', '.b-root.goals-open .b-abil.with-face:not([hidden])')!.body, 'grid-template-columns')!.split(/\s+/)[0]!)).toBe(gw);
    });
    it('札の見出しの顔：細い顔は高さを変えずに幅とすき間を詰め、出さない時は並びから外す（札・見出しの大きさの規則は足さない）', () => {
        const all = rules();
        const px = (v: string | null) => (v === null ? NaN : parseFloat(v));
        const find = (media: string, sel: string) => all.find((r) => (media ? r.media.includes(media) : r.media === '') && r.sel.split(',').map((x) => x.trim()).includes(sel));
        for (const media of ['', 'max-height: 520px']) {
            const full = find(media, '.b-card-h > .b-face')!;
            const narrow = find(media, '.b-card-h > .b-face.b-face-narrow')!;
            expect(full && narrow, media).toBeTruthy();
            // 高さはそのまま（見出しの行の高さ＝札の高さを変えない）。幅とすき間で 6 px 以上詰める（小さな札の騎馬の榊原康政隊で名前が収まる）
            expect(prop(narrow.body, 'height'), media).toBeNull();
            const saved = px(prop(full.body, 'width')) - px(prop(narrow.body, 'width')) - px(prop(narrow.body, 'margin-right'));
            expect(saved, media).toBeGreaterThanOrEqual(6);
            expect(px(prop(narrow.body, 'width')), media).toBeGreaterThanOrEqual(8);
        }
        expect(prop(find('', '.b-card-h > .b-face.b-face-narrow')!.body, 'object-fit')).toBe('cover');
        expect(prop(find('', '.b-card-h > .b-face.b-face-off')!.body, 'display')).toBe('none');
        // 顔のある見出しだけ、空の状態の印を並びから外す（文字のある印・顔の無い見出し＝旧表示には掛からない）
        const badgeRules = all.filter((r) => r.sel.includes('.b-badge') && r.sel.includes('has-face'));
        expect(badgeRules.map((r) => r.sel)).toEqual(['.b-card-h.has-face > .b-badge:empty']);
        expect(prop(badgeRules[0]!.body, 'display')).toBe('none');
        // 顔の規則は札そのもの・見出しの行の大きさを変えない
        for (const r of all.filter((x) => /b-face/.test(x.sel))) for (const sel of r.sel.split(',').map((x) => x.trim())) expect(sel, sel).not.toMatch(/\.b-card(-h)?$|\.b-card(-h)?\s*[,{]|\.b-cards$/);
    });
    it('発動の知らせの顔：畳んだ時は Version 21 と同じ縦の並び（顔とのすき間を残さない）。スマホのすき間の規則は顔の並びの規則に負けない', () => {
        const all = rules();
        const find = (media: string, sel: string) => all.find((r) => (media ? r.media.includes(media) : r.media === '') && r.sel.split(',').map((x) => x.trim()).includes(sel));
        const grid = find('', '.b-abnote.with-face:not([hidden])')!;
        expect(prop(grid.body, 'display')).toBe('grid');
        // 畳んだ時（data-fold="1"）：顔の並び（grid）より強い選ぶ側で、元の flex に戻す。隠した知らせ（[hidden]）には掛けない
        const folded = find('', '.b-topmid[data-fold="1"] .b-abnote.with-face:not([hidden])')!;
        expect(folded && prop(folded.body, 'display')).toBe('flex');
        expect(all.indexOf(folded)).toBeGreaterThan(all.indexOf(grid));
        expect(prop(find('', '.b-topmid[data-fold="1"] .b-abnote > .b-face')!.body, 'display')).toBe('none');
        // 縦の狭い画面のすき間：顔の並びの規則と同じ選ぶ側（後に書いてあるので勝つ）
        const gap = find('max-height: 520px', '.b-abnote.with-face:not([hidden])')!;
        expect(gap && prop(gap.body, 'column-gap')).toBe('7px');
        expect(all.indexOf(gap)).toBeGreaterThan(all.indexOf(grid));
        expect(all.filter((r) => r.sel.split(',').map((x) => x.trim()).includes('.b-abnote.with-face'))).toEqual([]);
    });
});
