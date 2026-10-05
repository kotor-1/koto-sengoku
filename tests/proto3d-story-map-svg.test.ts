/**
 * 情勢の地図（模式図）の SVG の木（proto3d/src/story/map-svg.ts）と、演出の設定（story/prefs.ts）。
 * 凡例（記号＋名前＋色）・模式図の注記・確かめ用の属性・文字の大きさ・線の種類・物見の印。設定は切り替えたときだけ書く。
 */
import { describe, expect, it } from 'vitest';
import { MAP_FONT, MAP_VIEW, ROUTE_STYLE, SIDE_STYLE, findNodes, mapPoint, mapSvgTree, nodeText, svgToString, type SvgNode } from '../proto3d/src/story/map-svg';
import { PREFS_KEY, StoryPrefsStore, effectiveReduced, loadStoryPrefs, saveStoryPrefs } from '../proto3d/src/story/prefs';
import { sampleScene } from '../proto3d/src/story/sample';
import type { MapScene } from '../proto3d/src/story/types';
import { MemoryStorage } from './proto3d-campaign-helpers';

const byAttr = (root: SvgNode, k: string, v?: string) => findNodes(root, (n) => (v === undefined ? n.attrs[k] !== undefined : String(n.attrs[k]) === v));

describe('地図の SVG の木', () => {
    const scene = sampleScene();
    const tree = mapSvgTree(scene, { uid: 'u1', name: 'test' });
    const str = svgToString(tree);

    it('viewBox は固定、名前・読み上げの説明つき', () => {
        expect(tree.tag).toBe('svg');
        expect(tree.attrs['viewBox']).toBe(`0 0 ${MAP_VIEW.w} ${MAP_VIEW.h}`);
        expect(tree.attrs['data-map']).toBe('test');
        expect(String(tree.attrs['aria-label'])).toContain('模式図');
        expect(String(tree.attrs['aria-label'])).toContain('味方の城下');
    });
    it('模式図の注記を必ず出す（台本の注記の文。空なら既定の文）', () => {
        const note = byAttr(tree, 'data-note', '1');
        expect(note).toHaveLength(1);
        expect(nodeText(note[0]!)).toBe(scene.note);
        const empty = mapSvgTree({ ...scene, note: '' });
        expect(nodeText(byAttr(empty, 'data-note', '1')[0]!)).toContain('模式図');
    });
    it('場所・線は全部、data-place／data-route・data-side・data-kind・data-state・data-hl つき', () => {
        const places = byAttr(tree, 'data-place');
        expect(places.map((p) => p.attrs['data-place']).sort()).toEqual(scene.places.map((p) => p.id).sort());
        for (const p of places) {
            const src = scene.places.find((x) => x.id === p.attrs['data-place'])!;
            expect(p.attrs['data-side']).toBe(src.side);
            expect(p.attrs['data-kind']).toBe(src.kind);
            expect(p.attrs['data-state']).toBe('shown');
            expect(p.attrs['data-hl']).toBe('0');
        }
        const routes = byAttr(tree, 'data-route');
        expect(routes.map((r) => r.attrs['data-route']).sort()).toEqual(scene.routes.map((r) => r.id).sort());
        for (const r of routes) expect(r.attrs['data-side']).toBe(scene.routes.find((x) => x.id === r.attrs['data-route'])!.side);
    });
    it('場所の名前は「記号＋名前」（色だけで区別しない）。旗の一文字・添え書きも出す', () => {
        for (const p of scene.places) {
            const g = byAttr(tree, 'data-place', p.id)[0]!;
            const label = findNodes(g, (n) => n.attrs['class'] === 'g-map-label')[0]!;
            expect(nodeText(label)).toBe(`${SIDE_STYLE[p.side].symbol}${p.name}`);
            const sym = findNodes(label, (n) => n.tag === 'tspan')[0]!;
            expect(sym.attrs['fill']).toBe(SIDE_STYLE[p.side].color);
            if (p.mark) expect(nodeText(findNodes(g, (n) => n.attrs['class'] === 'g-map-flag')[0]!)).toBe(p.mark);
            if (p.note) expect(nodeText(g)).toContain(p.note);
        }
    });
    it('凡例：使っている関係（記号＋名前＋色、旗の字）と線の種類だけ', () => {
        const sides = byAttr(tree, 'data-legend-side');
        expect(sides.map((s) => s.attrs['data-legend-side'])).toEqual(['self', 'ally', 'enemy', 'neutral', 'unknown']);
        const enemy = sides.find((s) => s.attrs['data-legend-side'] === 'enemy')!;
        expect(nodeText(enemy)).toBe(`${SIDE_STYLE.enemy.symbol} ${SIDE_STYLE.enemy.name}（北）`);
        expect(findNodes(enemy, (n) => n.tag === 'tspan')[0]!.attrs['fill']).toBe(SIDE_STYLE.enemy.color);
        const kinds = byAttr(tree, 'data-legend-route').map((r) => r.attrs['data-legend-route']);
        expect(kinds).toEqual(['march', 'threat', 'envoy', 'alliance']);
        for (const k of kinds) expect(str).toContain(ROUTE_STYLE[k as keyof typeof ROUTE_STYLE].name);
        // 使っていない関係・線は出さない
        const only: MapScene = { ...scene, places: scene.places.filter((p) => p.side === 'self' || p.side === 'neutral'), routes: [] };
        const t2 = mapSvgTree(only);
        expect(byAttr(t2, 'data-legend-side').map((s) => s.attrs['data-legend-side'])).toEqual(['self', 'neutral']);
        expect(byAttr(t2, 'data-legend-route')).toHaveLength(0);
    });
    it('線の種類：実線（行軍・協力）・破線（脅かす向き・敵対）・点線（使い）、矢印は向きのある物だけ', () => {
        const line = (id: string) => findNodes(byAttr(tree, 'data-route', id)[0]!, (n) => n.attrs['class'] === 'g-map-line')[0]!;
        const arrow = (id: string) => findNodes(byAttr(tree, 'data-route', id)[0]!, (n) => n.attrs['class'] === 'g-map-arrow').length;
        expect(line('r_march').attrs['stroke-dasharray']).toBeUndefined();
        expect(line('r_threat').attrs['stroke-dasharray']).toBe(ROUTE_STYLE.threat.dash);
        expect(line('r_envoy').attrs['stroke-dasharray']).toBe(ROUTE_STYLE.envoy.dash);
        expect(line('r_ally').attrs['stroke-dasharray']).toBeUndefined();
        expect(arrow('r_march')).toBe(1);
        expect(arrow('r_threat')).toBe(1);
        expect(arrow('r_ally')).toBe(0);
        // 線の名前（label）は線の真ん中に
        expect(nodeText(byAttr(tree, 'data-route', 'r_march')[0]!)).toContain('出陣');
    });
    it('伸びる線の覆い：線ごとに 1 つ（data-draw）、id は uid でぶつからない', () => {
        const draws = byAttr(tree, 'data-draw');
        expect(draws.map((d) => d.attrs['data-draw']).sort()).toEqual(scene.routes.map((r) => r.id).sort());
        const masks = findNodes(tree, (n) => n.tag === 'mask').map((m) => String(m.attrs['id']));
        expect(new Set(masks).size).toBe(masks.length);
        expect(masks.every((m) => m.startsWith('u1-'))).toBe(true);
        const other = findNodes(mapSvgTree(scene, { uid: 'u2' }), (n) => n.tag === 'mask').map((m) => String(m.attrs['id']));
        expect(other.some((m) => masks.includes(m))).toBe(false);
    });
    it('文字は 14 単位以上（スマホ横で 12px 以上にするため）', () => {
        const sizes = findNodes(tree, (n) => n.attrs['font-size'] !== undefined).map((n) => Number(n.attrs['font-size']));
        expect(sizes.length).toBeGreaterThan(10);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
        expect(Math.min(...Object.values(MAP_FONT))).toBeGreaterThanOrEqual(14);
    });
    it('地図の点（0〜100）は枠の中に収まる（外の値も枠の中へ）', () => {
        for (const [x, y] of [
            [0, 0],
            [100, 100],
            [-20, 140],
        ] as const) {
            const p = mapPoint(x, y);
            expect(p.x).toBeGreaterThanOrEqual(4);
            expect(p.x).toBeLessThanOrEqual(320);
            expect(p.y).toBeGreaterThanOrEqual(4);
            expect(p.y).toBeLessThanOrEqual(244);
        }
    });
    it('物見で確かめた場所・線は印（data-scout）と凡例の行がつく', () => {
        const t = mapSvgTree(scene, { scouted: ['field', 'r_march'] });
        expect(byAttr(t, 'data-scout', '1').map((n) => n.attrs['data-place'] ?? n.attrs['data-route']).sort()).toEqual(['field', 'r_march']);
        expect(byAttr(t, 'data-legend-scout')).toHaveLength(1);
        expect(byAttr(tree, 'data-legend-scout')).toHaveLength(0);
    });
    it('端の場所が無い線は描かない（落ちない）', () => {
        const t = mapSvgTree({ ...scene, routes: [...scene.routes, { id: 'x', from: 'home', to: 'nowhere', kind: 'march', side: 'self' }] });
        expect(byAttr(t, 'data-route', 'x')).toHaveLength(0);
    });
    it('文字列は書き出せる（特別な字を逃がす）', () => {
        const t = mapSvgTree({ ...scene, note: '<模式図> & "注記"' });
        const s = svgToString(t);
        expect(s).toContain('&lt;模式図&gt; &amp; &quot;注記&quot;');
        expect(s.startsWith('<svg')).toBe(true);
    });
    it('同じ地図からは同じ木（純粋）', () => {
        expect(svgToString(mapSvgTree(sampleScene(), { uid: 'u1', name: 'test' }))).toBe(str);
    });
});

describe('動きを減らす設定（koto-sengoku/3d-prefs）', () => {
    it('書いていなければ端末の設定に従う。読むだけでは書かない', () => {
        const s = new MemoryStorage();
        const store = new StoryPrefsStore(s, () => true);
        expect(store.reduced).toBe(true);
        expect(new StoryPrefsStore(s, () => false).reduced).toBe(false);
        expect([...s.data.keys()]).toEqual([]);
    });
    it('切り替えたときだけ書く。書いた物は端末の設定より強い', () => {
        const s = new MemoryStorage();
        const store = new StoryPrefsStore(s, () => true);
        expect(store.setReduced(false)).toBe(true);
        expect(store.reduced).toBe(false);
        expect([...s.data.keys()]).toEqual([PREFS_KEY]);
        expect(new StoryPrefsStore(s, () => true).reduced).toBe(false);
        expect(loadStoryPrefs(s)).toEqual({ reducedMotion: false });
    });
    it('壊れた・読めない・書けない保存でも落ちない', () => {
        const s = new MemoryStorage();
        s.setItem(PREFS_KEY, '{oops');
        expect(loadStoryPrefs(s)).toEqual({ reducedMotion: null });
        s.setItem(PREFS_KEY, JSON.stringify({ reducedMotion: 'yes' }));
        expect(loadStoryPrefs(s)).toEqual({ reducedMotion: null });
        expect(loadStoryPrefs(null)).toEqual({ reducedMotion: null });
        const broken = {
            getItem: () => {
                throw new Error('x');
            },
            setItem: () => {
                throw new Error('quota');
            },
        };
        expect(loadStoryPrefs(broken)).toEqual({ reducedMotion: null });
        expect(saveStoryPrefs(broken, { reducedMotion: true })).toBe(false);
        const st = new StoryPrefsStore(broken, () => {
            throw new Error('no media');
        });
        expect(st.reduced).toBe(false);
        expect(st.setReduced(true)).toBe(false);
        expect(st.reduced).toBe(true);
        expect(effectiveReduced({ reducedMotion: null }, true)).toBe(true);
    });
});
