/**
 * 合戦の地面の素材の、素材ごとの採用・フォールバック（Version 23。battle/groundArt.ts・view.ts の setGroundArt）の確かめ。
 * - URL の ?artOff=（#artOff=）：grass・dirt・road・forest をコンマで区切って、その種類だけ外す。grass は土のむら（dirt）も外す（草地の上の斑なので、
 *   Version 21 の緑に斑を出さない）。ground は 4 種類とも。知らない語は無視。保存には書かない。
 * - 読みに行く種類（fieldArtIds）：一覧に載る・?artOff で外していない種類だけ（草地を読まないなら土も読まない）。全部外す・旧表示・一覧に無いなら読まない（型紙も作らない・開始のボタンも待たない）。
 * - 読み込み（loadFieldArt）：1 枚だけ読めないときは、その種類だけ null（Version 21 の見た目）。草地が読めなければ土も null。
 * - 描き方（makeGroundArtMaterial）：素材のある種類だけ画像を読む（GA_GRASS など）。無い種類の色は Version 21 の色（view.ts の groundColor と同じ）、
 *   むらの式も groundColor と同じ。道の素材が無ければ道は描かず、Version 21 の道の帯（view.ts の roadMesh）を見せる。
 * - 表示（BattleView.setGroundArt）：林床の無い組では円の林に木を植えない（林の見た目は Version 21 の色のまま）。素材の無い組は受け取らない。
 *   道の帯は道の素材があるときだけ隠す（無ければ Version 21 の道の帯をそのまま見せる）。
 *   素材ごとの組で毎刻み描いても、合戦の状態・押す判定・名札の位置・見えている兵士の数・カメラの「全体」は素材なしと同じ。
 * - 本物の一覧（manifest.gen.json）：大平原は草地・土・道の 3 枚（林床は不採用で載らない）。草地は 1 枚 4 m（暫定）。
 * 画像は WebGL なしで作れる DataTexture（確かめ用の 4×4 の色）か、fetch・createImageBitmap の偽物（本物の画像は読まない）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBattle, issueOrder, stepBattle, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import {
    V21_GRASS,
    V21_ROAD,
    V21_WOODS,
    __clearGroundCacheForTest,
    buildGroundNoise,
    buildTerrainMask,
    disposeGroundArtSet,
    fieldArtIds,
    fieldArtWanted,
    groundArtMaterials,
    groundArtOff,
    groundDataCached,
    loadFieldArt,
    makeGroundArtMaterial,
    type GroundArtSet,
} from '../proto3d/src/battle/groundArt';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { ART_IDS, FIELD_ART, GROUND_MATERIALS, type GroundMaterial } from '../proto3d/src/art/ids';
import generated from '../proto3d/src/art/manifest.gen.json';
import type { BattleMap } from '../proto3d/src/battle/types';

const plains = () => createBattle(buildBattleSetup(getField('plains')!, 'standard'));

/** 確かめ用の地面の素材の組（4×4 の色。本物の画像ではない）。have に入れた種類だけ素材を持つ */
function fakeSet(map: BattleMap, have: readonly GroundMaterial[], low = false): GroundArtSet {
    const tex = (v: number) => {
        const t = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(v), 4, 4);
        t.needsUpdate = true;
        return { texture: t as THREE.Texture, tileMeters: 5 };
    };
    const mask = buildTerrainMask(map);
    const set: GroundArtSet = { grass: null, dirt: null, road: null, forest: null, ground: { mask, noise: buildGroundNoise(mask) }, low };
    have.forEach((m, k) => (set[m] = tex(60 + 30 * k)));
    return set;
}

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

/** 一覧の偽物（大平原の 4 枚。確かめ用）と fetch・createImageBitmap の偽物。fail に入れた画像は 404。読んだ URL を返す */
const ALL4 = {
    [ART_IDS.plainsGrass]: { file: 'art/battle/plains_grass.webp', w: 512, h: 512, kind: 'texture' as const, meta: { tileMeters: 4 } },
    [ART_IDS.plainsDirt]: { file: 'art/battle/plains_dirt.webp', w: 512, h: 512, kind: 'texture' as const, meta: { tileMeters: 6 } },
    [ART_IDS.plainsRoad]: { file: 'art/battle/plains_road.webp', w: 512, h: 512, kind: 'texture' as const, meta: { tileMeters: 5 } },
    [ART_IDS.plainsForest]: { file: 'art/battle/plains_forest.webp', w: 512, h: 512, kind: 'texture' as const, meta: { tileMeters: 4 } },
};
function fakeArt(o: { fail?: string[]; assets?: Record<string, unknown>; search?: string; hash?: string } = {}): string[] {
    __setArtManifestForTest({ version: 1, assets: (o.assets ?? ALL4) as never });
    const urls: string[] = [];
    vi.stubGlobal('location', { search: o.search ?? '', hash: o.hash ?? '' });
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        const bad = (o.fail ?? []).some((f) => String(url).endsWith(f));
        return bad ? { ok: false, status: 404 } : { ok: true, status: 200, blob: async () => ({ url: String(url) }) };
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 512, height: 512, close() {} }));
    return urls;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __setArtManifestForTest(null);
    __clearGroundCacheForTest();
});

describe('URL の ?artOff=（素材ごとに Version 21 の見た目へ戻す）', () => {
    it('grass・dirt・road・forest をコンマ・空白で区切る。ground は 4 種類とも。大文字・知らない語・空は無視。? が先で、無ければ #', () => {
        const off = (search: string, hash = '') => {
            vi.stubGlobal('location', { search, hash });
            return [...groundArtOff()].sort();
        };
        expect(off('')).toEqual([]);
        // grass は土のむら（dirt）も外す（草地の上の斑なので、Version 21 の緑に斑を出さない）。dirt だけ外すのはできる
        expect(off('?artOff=grass')).toEqual(['dirt', 'grass']);
        expect(off('?artOff=grass,dirt')).toEqual(['dirt', 'grass']);
        expect(off('?artOff=Grass,%20ROAD')).toEqual(['dirt', 'grass', 'road']);
        expect(off('?artOff=grass+dirt')).toEqual(['dirt', 'grass']);
        expect(off('?artOff=dirt,road')).toEqual(['dirt', 'road']);
        expect(off('?artOff=ground')).toEqual([...GROUND_MATERIALS].sort());
        expect(off('?artOff=face,tree,,')).toEqual([]);
        expect(off('', '#artOff=road')).toEqual(['road']);
        expect(off('?q=low', '#art=new&artOff=dirt')).toEqual(['dirt']);
        // ? と # の両方にあれば ? の方（art/registry.ts の ?art=old と同じ読み方）
        expect(off('?artOff=grass', '#artOff=road')).toEqual(['dirt', 'grass']);
        // 保存（localStorage）には触らない：node には localStorage が無いので、触れば例外になる
        expect(typeof (globalThis as { localStorage?: unknown }).localStorage).toBe('undefined');
    });

    it('外した種類は読みに行かない。全部外す（ground）・旧表示なら読みに行かず型紙も作らない（Version 21 と同じ・開始のボタンも待たない）', async () => {
        const map = plains().map;
        let urls = fakeArt({ search: '?artOff=road' });
        expect(Object.keys(fieldArtIds('plains')).sort()).toEqual(['dirt', 'forest', 'grass']);
        let set = await loadFieldArt(map, { anisotropy: 4, low: false });
        expect(groundArtMaterials(set!)).toEqual(['grass', 'dirt', 'forest']);
        expect(set!.road).toBeNull();
        expect(urls.some((u) => u.includes('plains_road'))).toBe(false);
        disposeGroundArtSet(set);

        // 草地を外す：土のむらも読まない（草地の上の斑なので）
        urls = fakeArt({ search: '?artOff=grass' });
        expect(Object.keys(fieldArtIds('plains')).sort()).toEqual(['forest', 'road']);
        set = await loadFieldArt(map, { anisotropy: 4, low: false });
        expect(groundArtMaterials(set!)).toEqual(['road', 'forest']);
        expect(urls.some((u) => /plains_(grass|dirt)/.test(u))).toBe(false);
        disposeGroundArtSet(set);

        // 草地が一覧に無い（読めない種類と同じ）：土も読まない
        urls = fakeArt({ assets: { [ART_IDS.plainsDirt]: ALL4[ART_IDS.plainsDirt], [ART_IDS.plainsRoad]: ALL4[ART_IDS.plainsRoad] } });
        await loadFieldArt(map, { anisotropy: 4, low: false }).then((x) => {
            expect(groundArtMaterials(x!)).toEqual(['road']);
            disposeGroundArtSet(x);
        });
        expect(urls.map((u) => u.replace(/^.*\//, ''))).toEqual(['plains_road.webp']);
        // 土だけが一覧にある：何も読まない（Version 21 の地面）
        urls = fakeArt({ assets: { [ART_IDS.plainsDirt]: ALL4[ART_IDS.plainsDirt] } });
        expect(fieldArtWanted('plains')).toBe(false);
        expect(await loadFieldArt(map, { anisotropy: 4, low: false })).toBeNull();
        expect(urls).toEqual([]);

        urls = fakeArt({ hash: '#artOff=grass,dirt' });
        set = await loadFieldArt(map, { anisotropy: 4, low: false });
        expect(groundArtMaterials(set!)).toEqual(['road', 'forest']);
        expect(urls.map((u) => u.replace(/^.*\//, '')).sort()).toEqual(['plains_forest.webp', 'plains_road.webp']);
        disposeGroundArtSet(set);

        __clearGroundCacheForTest();
        for (const o of [{ search: '?artOff=ground' }, { search: '?artOff=grass,dirt,road,forest' }, { search: '?art=old' }, { search: '?art=old&artOff=grass' }]) {
            urls = fakeArt(o);
            expect(fieldArtWanted('plains'), JSON.stringify(o)).toBe(false);
            expect(await loadFieldArt(map, { anisotropy: 4, low: false })).toBeNull();
            expect(urls).toEqual([]);
            expect(groundDataCached(map)).toBe(false);
        }
    });
});

describe('読み込み：1 枚だけ読めないときは、その種類だけ Version 21 の色', () => {
    it.each(GROUND_MATERIALS.map((m) => [m]))('%s だけ読めない：ほかの種類は使う（草地が読めなければ土のむらも使わない）', async (bad) => {
        const urls = fakeArt({ fail: [`plains_${bad}.webp`] });
        const set = await loadFieldArt(plains().map, { anisotropy: 4, low: false });
        expect(urls.length).toBe(4);
        expect(set![bad]).toBeNull();
        // 土のむらは草地の素材の上の斑：草地が読めなければ土も使わない（Version 21 の緑に斑を出さない）
        const lost: GroundMaterial[] = bad === 'grass' ? ['grass', 'dirt'] : [bad];
        expect(groundArtMaterials(set!)).toEqual(GROUND_MATERIALS.filter((m) => !lost.includes(m)));
        // 1 枚の大きさは種類ごとの meta.tileMeters
        const tm: Record<GroundMaterial, number> = { grass: 4, dirt: 6, road: 5, forest: 4 };
        for (const m of groundArtMaterials(set!)) expect(set![m]!.tileMeters).toBe(tm[m]);
        disposeGroundArtSet(set);
    });
});

describe('描き方：素材のある種類だけ読み、無い種類は Version 21 の色', () => {
    it('GA_GRASS などは素材のある種類だけ。無い種類の画像の uniform は渡さない。プログラムの鍵は組ごとに違う', () => {
        const s = plains();
        const keys = new Set<string>();
        for (const have of [['grass', 'dirt', 'road'], ['dirt', 'road'], ['road'], ['grass'], ['grass', 'dirt', 'road', 'forest']] as GroundMaterial[][]) {
            for (const low of [false, true]) {
                const set = fakeSet(s.map, have, low);
                const m = makeGroundArtMaterial(s.map, null, set);
                const c = compiled(m.material);
                for (const g of GROUND_MATERIALS) {
                    const name = `GA_${g.toUpperCase()}`;
                    expect(name in (m.material.defines ?? {}), `${have} ${name}`).toBe(have.includes(g));
                    const u = `ga${g[0].toUpperCase()}${g.slice(1)}`;
                    expect(u in c.uniforms, `${have} ${u}`).toBe(have.includes(g));
                    if (have.includes(g)) expect(c.uniforms[u].value).toBe(set[g]!.texture);
                }
                expect('GA_LOW' in (m.material.defines ?? {})).toBe(low);
                keys.add(m.material.customProgramCacheKey());
                // 素材の無い種類の色（Version 21）
                expect((c.uniforms.gaGrassC.value as THREE.Color).getHex()).toBe(new THREE.Color(V21_GRASS).getHex());
                expect((c.uniforms.gaWoodsC.value as THREE.Color).getHex()).toBe(new THREE.Color(V21_WOODS).getHex());
                // 道の素材が無いときは道を描かない（Version 21 の道の帯 roadMesh を見せる）ので、道の色の uniform は無い
                expect('gaRoadC' in c.uniforms).toBe(false);
                // 素材の無い種類の 1 枚の大きさの uniform は既定（使わない）。ある種類は 1 / tileMeters
                const tile = c.uniforms.gaTile.value as THREE.Vector4;
                expect([tile.x, tile.y, tile.z, tile.w].map((v, k) => (have.includes(GROUND_MATERIALS[k]) ? v : null))).toEqual(GROUND_MATERIALS.map((g) => (have.includes(g) ? 1 / 5 : null)));
                m.material.dispose();
                m.mask.dispose();
                m.noise.dispose();
                disposeGroundArtSet(set);
            }
        }
        expect(keys.size).toBe(10);
    });

    it('Version 21 の色とむらの式は view.ts（groundColor・道の帯）と同じ。素材の無い種類は #else の側で、その色とむらを使う（道は Version 21 の道の帯を見せる）', async () => {
        const fsName = 'node:fs';
        const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: URL, enc: 'utf8'): string };
        const view = fs.readFileSync(new URL('../proto3d/src/battle/view.ts', import.meta.url), 'utf8');
        expect(view).toContain(`out.set('${V21_GRASS}');`);
        expect(view).toContain(`else if (inTerrain(map, 'woods', x, z)) out.set('${V21_WOODS}');`);
        expect(view).toContain(`new THREE.MeshLambertMaterial({ color: '${V21_ROAD}'`);
        expect(view).toContain('const n = Math.sin(x * 0.047 + 0.3) * 0.5 + Math.sin(z * 0.039 + 1.1) * 0.5 + Math.sin((x + z) * 0.021) * 0.6 + Math.sin(x * 0.19 - z * 0.13) * 0.25;');
        expect(view).toContain('out.multiplyScalar(1 + n * 0.05);');
        const s = plains();
        const set = fakeSet(s.map, ['road']);
        const m = makeGroundArtMaterial(s.map, null, set);
        const frag = compiled(m.material).frag;
        expect(frag).toContain('return sin(p.x * 0.047 + 0.3) * 0.5 + sin(p.y * 0.039 + 1.1) * 0.5 + sin((p.x + p.y) * 0.021) * 0.6 + sin(p.x * 0.19 - p.y * 0.13) * 0.25;');
        expect(frag).toContain('float n21 = 1.0 + 0.05 * gaV21Noise(w);');
        expect(frag).toMatch(/#else\s+vec3 col = gaGrassC \* n21;/);
        expect(frag).toMatch(/#else\s+col = mix\(col, gaWoodsC \* n21, forestW\);/);
        // 道の素材が無い：ここでは道を描かない（草地のまま・丘の色も草地と同じ。上に Version 21 の道の帯を見せる）
        expect(frag).toMatch(/#else\s+\/\/[^\n]*\n\s+roadW = 0\.0;\s+#endif/);
        expect(frag).not.toContain('gaRoadC');
        // 土の素材が無ければ土のむらは出さない（式ごと #ifdef GA_DIRT の中）
        expect(frag.indexOf('float dirtW')).toBeGreaterThan(frag.indexOf('#ifdef GA_DIRT'));
        // 大きな濃淡は草地の素材を使うときだけ（Version 21 の色の草地には掛けない）
        const grassBlock = frag.slice(frag.indexOf('#ifdef GA_GRASS\n    // 草地'), frag.indexOf('vec3 col = gaGrassC * n21;'));
        expect(grassBlock).toContain('col *= mix(vec3(0.9, 0.93, 0.9)');
        m.material.dispose();
        m.mask.dispose();
        m.noise.dispose();
        disposeGroundArtSet(set);
    });
});

// ---------------------------------------------------------------- 表示は合戦の状態を変えない（素材ごとの組）

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

function snapshot(s: BattleState): string {
    return JSON.stringify(s, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
}

function script(s: BattleState): void {
    const t = Math.round(s.t * 10) / 10;
    if (t === 5) issueOrder(s, 'a_kiba', { type: 'move', x: -150, z: -40 });
    if (t === 30) issueOrder(s, 'a_kiba', { type: 'attack', targetId: 'e_left' });
}

describe('表示：林床の無い組は円の林に木を植えない。素材ごとの組でも合戦の状態・押す判定・名札・兵士の数・カメラは同じ', () => {
    it('草地・土・道（本番の形）・道だけ・草地だけの組：木 0・道の帯は道の素材があるときだけ隠す（無ければ Version 21 の道の帯）。素材の無い組は受け取らない', async () => {
        await withFakeDocument(async () => {
            const { BattleView } = await import('../proto3d/src/battle/view');
            for (const have of [['grass', 'dirt', 'road'], ['road'], ['grass']] as GroundMaterial[][]) {
                const s = plains();
                const v = new BattleView(s, { low: false });
                expect(v.setGroundArt(fakeSet(s.map, []))).toBe(false);
                expect(v.artProbe().ground).toBe('vertex');
                expect(v.setGroundArt(fakeSet(s.map, have))).toBe(true);
                expect(v.artProbe()).toMatchObject({ ground: 'textured', materials: have, trees: 0, roadStrip: !have.includes('road') });
                expect(v.treeSpots()).toEqual([]);
                const road = (v as unknown as { roadMesh: THREE.Mesh | null }).roadMesh;
                expect(road?.visible).toBe(!have.includes('road'));
                v.dispose();
            }
        });
    });

    it('草地・土・道の組で 60 秒ぶん毎刻み描いても、表示なしと状態が同じ。押す判定・名札の位置・見えている兵士の数・「全体」のカメラも素材なしと同じ', async () => {
        await withFakeDocument(async () => {
            const { BattleView } = await import('../proto3d/src/battle/view');
            const a = plains();
            const plain: string[] = [];
            while (a.t < 60) {
                script(a);
                stepBattle(a, 0.1);
                if (Math.round(a.t * 10) % 100 === 0) plain.push(snapshot(a));
            }
            const b = plains();
            const on = new BattleView(b, { low: false });
            const off = new BattleView(b, { low: false });
            const insets = { top: 60, bottom: 110, left: 10, right: 10 };
            for (const v of [on, off]) {
                v.resize(844, 390);
                v.fit(insets);
            }
            expect(on.setGroundArt(fakeSet(b.map, ['grass', 'dirt', 'road']))).toBe(true);
            const drawn: string[] = [];
            let k = 0;
            let picks = 0;
            while (b.t < 60) {
                script(b);
                stepBattle(b, 0.1);
                const ui = { selectedId: k % 40 < 20 ? 'a_tadakatsu' : null, pending: 'none' as const, speed: 1 };
                on.update(b, 1 / 30, ui);
                off.update(b, 1 / 30, ui);
                if (k % 50 === 0) {
                    for (let sx = 30; sx < 844; sx += 90) {
                        for (let sy = 30; sy < 390; sy += 60) {
                            expect(on.pick(b, sx, sy, 20)).toBe(off.pick(b, sx, sy, 20));
                            picks++;
                        }
                    }
                    for (let i = 0; i < b.units.length; i++) expect(on.labelAnchor(i)).toEqual(off.labelAnchor(i));
                    expect(on.troopStats().visibleSoldiers).toBe(off.troopStats().visibleSoldiers);
                }
                if (Math.round(b.t * 10) % 100 === 0) drawn.push(snapshot(b));
                k++;
            }
            expect(drawn).toEqual(plain);
            expect(picks).toBeGreaterThan(500);
            // カメラの「全体」（fit）は素材によらない
            for (const v of [on, off]) v.fit(insets);
            const cam = (v: typeof on) => ({ tx: v.cam.tx, tz: v.cam.tz, dist: v.cam.dist });
            expect(cam(on)).toEqual(cam(off));
            on.dispose();
            off.dispose();
        });
    }, 120000);
});

describe('本物の一覧（manifest.gen.json）', () => {
    it('大平原は草地・土・道の 3 枚（林床は不採用で載らない）。草地は 1 枚 4 m（暫定）・土 6 m・道 5 m。512 px（拡大しない）', () => {
        const assets = (generated as { assets: Record<string, { w: number; h: number; meta?: { tileMeters?: number } }> }).assets;
        expect(FIELD_ART.plains.forest).toBe(ART_IDS.plainsForest);
        expect(assets[ART_IDS.plainsForest]).toBeUndefined();
        expect([ART_IDS.plainsGrass, ART_IDS.plainsDirt, ART_IDS.plainsRoad].map((id) => assets[id]?.meta?.tileMeters)).toEqual([4, 6, 5]);
        for (const id of [ART_IDS.plainsGrass, ART_IDS.plainsDirt, ART_IDS.plainsRoad]) expect([assets[id].w, assets[id].h], id).toEqual([512, 512]);
        vi.stubGlobal('location', { search: '', hash: '' });
        expect(fieldArtIds('plains')).toEqual({ grass: ART_IDS.plainsGrass, dirt: ART_IDS.plainsDirt, road: ART_IDS.plainsRoad });
        // ほかの戦場には地面の素材が無い（今までの地面）
        expect(fieldArtWanted('forest')).toBe(false);
    });
});
