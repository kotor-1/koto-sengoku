/**
 * 人物の名札（Version 28 の直し。本番の録画とコマ撮りで、町の急報の間「浅井家の使者」「織田家の使者」の名札が、使者が歩いて来た後も
 * 木戸の梁の辺りに浮き、大写しの「本多忠勝」の名札が城門の辺りに残って見えた。名札は足もとから決まった 2.05 m に置かれ、片膝の使者・
 * 近い人では頭から 100〜170 px 上に浮いていた）。
 * - 演出の 3D の出来事（町の急報・使者の到着・使いの急報など）の間は、誰にも名札を出さない（字幕が話し手の名前を出す）。
 * - 出来事の後、会話の相手が置き場所へ歩いて行く間、名札は描いた人の頭の上（描いた位置・頭の骨 + LABEL_ABOVE_HEAD）に付いて行く。
 * 本物の ExploreWorld と、ゲームが読む町の人物の GLB（hero_v2b.glb）で確かめる（DOM は偽物）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { ieyasuCastFor } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ActorLayer, LABEL_ABOVE_HEAD } from '../proto3d/src/explore/actors';
import { PersonFactory } from '../proto3d/src/explore/people';
import { REPORT_LINE_Z, type StagePerson } from '../proto3d/src/explore/stage';
import { createHero } from '../proto3d/src/game/motion';
import { NO_ACT } from '../proto3d/src/explore/rhythm';
import type { StageEvent } from '../proto3d/src/story/types';
import { loadGlb } from './proto3d-hero-rig';

const SPEC = ieyasuCinematic(newIeyasuGame(), 'ch1_report')!;
const EV = (SPEC.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'street_report' }>;
const E = EV.cue.end;
const DT = 1 / 60;
const VIEW = { w: 800, h: 400 };
const gltf = await loadGlb('hero_v2b');

type El = Record<string, unknown> & { className: string; hidden: boolean; children: El[]; dataset: Record<string, string>; style: Record<string, string>; textContent: string };

/** DOM の代わり（ExploreWorld が使う所だけ） */
function fakeElement(tag = 'div'): El {
    const children: El[] = [];
    const classes = new Set<string>();
    const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children,
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
        },
        appendChild: (c: El) => children.push(c),
        append: (...c: El[]) => children.push(...c),
        remove: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
        width: 0,
        height: 0,
    };
    return el as unknown as El;
}

/** 入れ物の中の名札（.npc-label）をみな集める */
function labelsIn(root: El): El[] {
    const out: El[] = [];
    const walk = (e: El) => {
        for (const c of e.children ?? []) {
            if (typeof c.className === 'string' && c.className.split(' ').includes('npc-label')) out.push(c);
            walk(c);
        }
    };
    walk(root);
    return out;
}

/** 名札の置いた所（style.transform の translate(x px, y px)） */
function labelAt(el: El): { x: number; y: number } {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform ?? '');
    if (!m) throw new Error(`名札の置き所が無い：${el.textContent}`);
    return { x: Number(m[1]), y: Number(m[2]) };
}

async function makeWorld() {
    const g = globalThis as Record<string, unknown>;
    g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body') };
    g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
    const { ExploreWorld } = await import('../proto3d/src/explore/world');
    const camera = new THREE.PerspectiveCamera(48, VIEW.w / VIEW.h, 0.1, 2000);
    const hero = createHero(0.3, REPORT_LINE_Z - 0.05, Math.PI);
    hero.speed = 1.55;
    const overlay = fakeElement();
    const host = {
        scene: new THREE.Scene(),
        camera,
        overlay: overlay as unknown as HTMLElement,
        hero,
        low: true,
        // ゲームが読む町の人物の GLB（頭の骨がある）
        load: () => Promise.resolve(gltf),
        prepare: () => undefined,
        setHeroPose: (p: { x: number; z: number; heading: number }) => Object.assign(hero, { x: p.x, z: p.z, heading: p.heading }),
        setControl: () => undefined,
        setRenderPaused: () => undefined,
        setExtraColliders: () => undefined,
        onFrame: () => undefined,
        viewSize: () => VIEW,
        orbit: { yaw: 0, pitch: 0.1, dist: 2.1 },
        // 本物と同じく、演出のカメラはすぐ置く
        setCameraShot: (s: { px: number; py: number; pz: number; tx: number; ty: number; tz: number } | null) => {
            if (!s) return;
            camera.position.set(s.px, s.py, s.pz);
            camera.lookAt(s.tx, s.ty, s.tz);
            camera.updateMatrixWorld();
        },
        renderOnce: () => undefined,
        setLookHandler: () => undefined,
        setHeroGaze: () => undefined,
    };
    const world = new ExploreWorld(host as never);
    await world.preload();
    const full = ieyasuCastFor(newIeyasuGame());
    return { world, hero, camera, overlay, full, pending: full.filter((c) => c.id !== 'oda_envoy' && c.id !== 'asai_envoy') };
}

describe('演出の 3D の出来事の間は、誰にも名札を出さない（字幕が話し手の名前を出す）', () => {
    it('町の急報：使者が走って来て片膝をつき・忠勝が歩いて来て大写しになる間、出来事の人・会話の相手のどの名札も出ない', async () => {
        const { world, overlay, pending } = await makeWorld();
        world.setCast(pending as never);
        let checked = 0;
        for (let t = 0; t <= E + 1e-9; t += 0.25) {
            world.stage(EV, Math.min(t, E), false);
            world.frame(0.25);
            const tags = labelsIn(overlay);
            const shown = tags.filter((l) => !l.hidden).map((l) => `${l.textContent}`);
            expect(shown, `t=${t}`).toEqual([]);
            checked += tags.length;
        }
        // 名札の要素はある（会話の相手の名札）が、出来事の間はみな隠れている
        expect(checked).toBeGreaterThan(0);
    });

    it('使者の到着・使いの急報（演出の人の層）でも名札を出さない', async () => {
        const { world, overlay, full } = await makeWorld();
        world.setCast(full as never);
        const events: StageEvent[] = [
            { id: 'envoys_arrive', envoys: [{ look: 'tashiro_envoy', name: '織田家の使者' }, { look: 'omori_envoy', name: '浅井家の使者' }] },
            { id: 'messenger_arrive', look: 'tashiro_envoy', name: '村の使い' },
        ];
        for (const ev of events) {
            for (const t of [0, 1, 2.5, 4]) {
                world.stage(ev, t, false);
                world.frame(DT);
                expect(world.stageProbe().people, `${ev.id} t=${t}`).toBeGreaterThan(0);
                expect(labelsIn(overlay).filter((l) => !l.hidden).map((l) => l.textContent), `${ev.id} t=${t}`).toEqual([]);
            }
            world.stage(null, 0, false);
            world.frame(DT);
        }
    });
});

describe('出来事の後、置き場所へ歩いて行く会話の相手の名札は、描いた人の頭の上に付いて行く', () => {
    it('町の急報の後の歩き：名札は描いた位置（置き場所ではない）の頭の骨の上。近い人の名札は高さも合う（足もとから決まった 2.05 m ではない）', async () => {
        const { world, hero, camera, overlay, full, pending } = await makeWorld();
        world.setCast(pending as never);
        for (let t = 0; t <= E + 1e-9; t += 0.25) {
            world.stage(EV, Math.min(t, E), false);
            world.frame(0.25);
        }
        world.stage(EV, E, false);
        world.frame(DT);
        world.stage(null, 0, false);
        world.setCast(full as never);
        expect(world.castArriving().sort()).toEqual(['asai_envoy', 'oda_envoy', 'tadakatsu']);
        // 主人公の後ろ・少し上から、北（城門・使者の置き場所の方）を見る
        camera.position.set(hero.x, 1.8, hero.z + 2.5);
        camera.lookAt(hero.x, 1.1, hero.z - 10);
        camera.updateMatrixWorld();
        const people = (world as unknown as { castActors: { people: Map<string, { body: { root: THREE.Object3D; bones: Map<string, THREE.Bone> } }> } }).castActors.people;
        let frames = 0;
        let checks = 0;
        let near = 0;
        let offSpot = 0;
        while (world.castArriving().length && frames < 60 * 40) {
            world.frame(DT);
            frames++;
            if (frames % 20) continue;
            const walking = new Set(world.castArriving());
            const spots = new Map(world.probe().map((p) => [p.id, p]));
            const rows: { id: string; at: { x: number; y: number }; want: { x: number; y: number; d: number } }[] = [];
            for (const l of labelsIn(overlay)) {
                const id = l.dataset.id;
                if (!id || !walking.has(id) || l.hidden) continue;
                const p = people.get(id);
                expect(p, id).toBeDefined();
                const body = p!.body;
                const head = body.bones.get('Head')!.getWorldPosition(new THREE.Vector3());
                const scale = body.root.children[0]!.scale.y;
                const w = head.clone().setY(head.y + LABEL_ABOVE_HEAD * scale);
                const d = w.clone().applyMatrix4(camera.matrixWorldInverse).z;
                w.project(camera);
                rows.push({ id, at: labelAt(l), want: { x: (w.x * 0.5 + 0.5) * VIEW.w, y: (-w.y * 0.5 + 0.5) * VIEW.h, d } });
                const s = spots.get(id)!;
                if (Math.hypot(body.root.position.x - s.x, body.root.position.z - s.z) > 0.5) offSpot++;
            }
            if (!rows.length) continue;
            // 横は描いた人に合う（名札が重なったときは上へずらすので、縦は上へだけ）。いちばん近い人の名札は縦も合う
            rows.sort((a, b) => b.want.d - a.want.d);
            for (const r of rows) {
                expect(Math.abs(r.at.x - r.want.x), `${r.id} 横`).toBeLessThan(1.5);
                expect(r.at.y, `${r.id} 縦`).toBeLessThanOrEqual(r.want.y + 1.5);
                checks++;
            }
            expect(Math.abs(rows[0]!.at.y - rows[0]!.want.y), `${rows[0]!.id} 縦（いちばん近い人）`).toBeLessThan(1.5);
            near++;
        }
        expect(frames).toBeLessThan(60 * 40);
        expect(checks).toBeGreaterThan(10);
        expect(near).toBeGreaterThan(5);
        // 置き場所から離れて歩いている間の名札を確かめた
        expect(offSpot).toBeGreaterThan(5);
    }, 60_000);

    it('名札を置く所は描いた頭の上：会釈・片膝で頭が下がると下がる（立っているとき約 1.88 m、片膝で 0.4 m 以上低い）。描いていない人は無し', () => {
        const f = new PersonFactory(() => {}, true);
        f.setBase(gltf);
        const cam = new THREE.PerspectiveCamera(48, 2, 0.1, 500);
        cam.position.set(0, 2, 6);
        cam.lookAt(0, 1, 0);
        cam.updateMatrixWorld();
        const layer = new ActorLayer('t', f, null, () => VIEW, 4, true);
        const base: StagePerson = { key: 'p', look: 'tashiro_envoy', name: '織田家の使者', x: 0, z: 0, heading: 0, walked: 0, moving: 0, label: true };
        const at = new THREE.Vector3();
        layer.setPeople([base], 1, cam);
        expect(layer.labelAnchor('p', at)).toBe(true);
        const stand = at.y;
        expect(stand).toBeGreaterThan(1.75);
        expect(stand).toBeLessThan(1.95);
        expect(Math.hypot(at.x, at.z)).toBeLessThan(0.15);
        layer.setPeople([{ ...base, act: { ...NO_ACT, kneel: 1 } }], 1.1, cam);
        layer.labelAnchor('p', at);
        expect(stand - at.y).toBeGreaterThan(0.4);
        // 画面の外（描いていない）・いない人は置き所なし
        layer.setPeople([{ ...base, x: 0, z: 200 }], 1.2, cam);
        expect(layer.labelAnchor('p', at)).toBe(false);
        expect(layer.labelAnchor('nobody', at)).toBe(false);
    });
});
