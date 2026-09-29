/**
 * 探索の場面に置く人物・高札・城門（proto3d/src/explore/cast.ts）：
 * 段階と状態で誰が居るか（捕らわれた人物は居ない・負傷は座る・使者は選んだ陣営だけ）、
 * 置き場所が壁や家に重ならず、開始の位置から歩いて話しかけられ、城門へ抜けられること。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { applyBattleOutcome, battleSetupFor, finishTalk, newGame, outcomeFromSetup } from '../proto3d/src/campaign/flow';
import type { Alliance, CampaignState } from '../proto3d/src/campaign/state';
import { DEFAULT_POSE, castColliders, castFor, inGateZone, keyTalk, nearestInteractable, safePose, type CastMember } from '../proto3d/src/explore/cast';
import { BOUNDS, GATE, START, colliders, type Rect } from '../proto3d/src/layout';
import { HERO_RADIUS, isFree } from '../proto3d/src/game/motion';
import { toBattle, toMuster } from './proto3d-campaign-helpers';

const WALLS = colliders();
const ALLIANCES: Alliance[] = ['tashiro', 'omori', 'alone'];
const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];

/** 戦後の状態（部隊の結果を指定できる） */
function aftermath(a: Alliance, r: BattleResultKind, units?: Record<string, { end?: number; status?: 'ready' | 'routed' | 'withdrawn' | 'destroyed' }>): CampaignState {
    const s = toBattle(a);
    return applyBattleOutcome(s, outcomeFromSetup(battleSetupFor(s), r, { units }));
}

/** 調べる状態の一覧（段階・陣営・結果・負傷・捕らわれ） */
function allStates(): { name: string; s: CampaignState }[] {
    const out = [{ name: 'explore', s: newGame() }];
    for (const a of ALLIANCES) {
        out.push({ name: `muster ${a}`, s: toMuster(a) });
        for (const r of RESULTS) out.push({ name: `aftermath ${a} ${r}`, s: aftermath(a, r) });
        out.push({ name: `aftermath ${a} 全員負傷`, s: aftermath(a, 'defeat', { a_genzo: { status: 'routed' }, a_shinpachi: { status: 'routed' }, a_tashiro: { status: 'routed' }, a_omori: { status: 'routed' } }) });
        out.push({ name: `aftermath ${a} 新八捕らわれ`, s: aftermath(a, 'retreat', { a_shinpachi: { status: 'destroyed', end: 0 } }) });
    }
    return out;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/** 開始の位置から歩いて行ける所（0.2 m の格子。当たり判定は主人公の円と四角形） */
function reachable(rects: Rect[]): (x: number, z: number) => boolean {
    const step = 0.2;
    const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / step) + 1;
    const nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / step) + 1;
    const idx = (i: number, k: number) => k * nx + i;
    const free = new Uint8Array(nx * nz);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) free[idx(i, k)] = isFree(BOUNDS.x0 + i * step, BOUNDS.z0 + k * step, rects) ? 1 : 0;
    const seen = new Uint8Array(nx * nz);
    const si = Math.round((START.x - BOUNDS.x0) / step);
    const sk = Math.round((START.z - BOUNDS.z0) / step);
    expect(free[idx(si, sk)], '開始の位置が塞がれていない').toBe(1);
    const q = [idx(si, sk)];
    seen[q[0]!] = 1;
    while (q.length) {
        const c = q.pop()!;
        const i = c % nx;
        const k = Math.floor(c / nx);
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di!;
            const kk = k + dk!;
            if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
            const n = idx(ii, kk);
            if (seen[n] || !free[n]) continue;
            seen[n] = 1;
            q.push(n);
        }
    }
    return (x, z) => {
        const i = Math.round((x - BOUNDS.x0) / step);
        const k = Math.round((z - BOUNDS.z0) / step);
        return i >= 0 && k >= 0 && i < nx && k < nz && seen[idx(i, k)] === 1;
    };
}

/** その相手に話しかけられる（届く範囲の中で、歩いて行ける所がある） */
function talkable(m: CastMember, canReach: (x: number, z: number) => boolean): boolean {
    for (let r = 0.5; r <= m.reach - 0.1; r += 0.1) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
            const x = m.x + Math.sin(a) * r;
            const z = m.z + Math.cos(a) * r;
            if (canReach(x, z) && nearestInteractable([m], x, z) === m) return true;
        }
    }
    return false;
}

describe('誰が居るか', () => {
    it('探索：源蔵・新八・高札。城門の出陣の場所は無い。目印は源蔵', () => {
        const c = castFor(newGame());
        expect(c.map((m) => m.id).sort()).toEqual(['genzo', 'notice', 'shinpachi']);
        expect(c.find((m) => m.key)?.id).toBe('genzo');
        expect(keyTalk(newGame())).toBe('genzo');
    });
    it('出陣の支度：選んだ陣営の使者だけが居る。城門の出陣の場所に目印', () => {
        for (const a of ALLIANCES) {
            const ids = castFor(toMuster(a)).map((m) => m.id);
            expect(ids).toContain('gate');
            expect(ids.includes('tashiro_envoy')).toBe(a === 'tashiro');
            expect(ids.includes('omori_envoy')).toBe(a === 'omori');
            expect(castFor(toMuster(a)).find((m) => m.key)?.id).toBe('gate');
        }
    });
    it('合戦中・軍議中は街路に誰も置かない', () => {
        expect(castFor(toBattle('tashiro'))).toEqual([]);
        const council = finishTalk(newGame(), 'genzo', 'open_council');
        expect(castFor(council)).toEqual([]);
    });
    it('戦後：負傷した人物は座る、捕らわれた新八は居ない、城門の出陣の場所は無い', () => {
        const d = aftermath('tashiro', 'defeat');
        const genzo = castFor(d).find((m) => m.id === 'genzo')!;
        expect(d.characters.genzo).toBe('wounded');
        expect(genzo.pose).toBe('sit');
        expect(castFor(aftermath('tashiro', 'victory')).find((m) => m.id === 'genzo')!.pose).toBe('stand');
        const cap = aftermath('omori', 'retreat', { a_shinpachi: { status: 'destroyed', end: 0 } });
        expect(cap.characters.shinpachi).toBe('captured');
        expect(castFor(cap).map((m) => m.id)).not.toContain('shinpachi');
        expect(castFor(cap).map((m) => m.id)).not.toContain('gate');
    });
});

describe('置き場所', () => {
    const states = allStates();
    it('人物・高札は壁・家・木・互いに重ならず、開始の位置も塞がない', () => {
        for (const { name, s } of states) {
            const cast = castFor(s);
            const solids = castColliders(cast);
            for (const r of solids) {
                for (const w of WALLS) expect(overlaps(r, w), `${name}：${JSON.stringify(r)} が ${JSON.stringify(w)} に重なる`).toBe(false);
                for (const o of solids) if (o !== r) expect(overlaps(r, o), `${name}：置いたもの同士が重なる`).toBe(false);
            }
            expect(isFree(START.x, START.z, [...WALLS, ...solids]), `${name}：開始の位置が塞がれている`).toBe(true);
        }
    });
    it('開始の位置から歩いて、居る相手すべてに話しかけられる', () => {
        for (const { name, s } of states) {
            const cast = castFor(s);
            const canReach = reachable([...WALLS, ...castColliders(cast)]);
            for (const m of cast) expect(talkable(m, canReach), `${name}：${m.id} に話しかけられない`).toBe(true);
        }
    });
    it('人物を置いても、開始の位置から城門をくぐって城内へ抜けられる', () => {
        for (const { name, s } of states) {
            const canReach = reachable([...WALLS, ...castColliders(castFor(s))]);
            expect(canReach(GATE.x, GATE.z + 1.5), `${name}：門の手前`).toBe(true);
            expect(canReach(GATE.x, GATE.z - 4), `${name}：門の奥`).toBe(true);
        }
    });
    it('人物は主人公がすり抜けない大きさ（当たり判定がある）。城門の出陣の場所は通れる', () => {
        const cast = castFor(toMuster('tashiro'));
        for (const m of cast) {
            if (m.kind === 'gate') expect(m.solid).toBeNull();
            else expect(isFree(m.x, m.z, castColliders(cast))).toBe(false);
        }
        expect(HERO_RADIUS).toBeGreaterThan(0);
    });
});

describe('話しかけの判定', () => {
    const cast = castFor(toMuster('tashiro'));
    const genzo = cast.find((m) => m.id === 'genzo')!;
    const gate = cast.find((m) => m.id === 'gate')!;
    it('届く範囲の一番近い相手。遠ければ誰もいない', () => {
        expect(nearestInteractable(cast, genzo.x + 1, genzo.z)?.id).toBe('genzo');
        expect(nearestInteractable(cast, START.x, START.z + 6)).toBeNull();
    });
    it('城門の出陣の場所：中に入ったら城門。人物と重なるときは人物が先', () => {
        expect(nearestInteractable(cast, gate.x, gate.z)?.id).toBe('gate');
        expect(inGateZone(cast, gate.x, gate.z)).toBe(true);
        expect(inGateZone(cast, START.x, START.z)).toBe(false);
        expect(inGateZone(castFor(newGame()), gate.x, gate.z)).toBe(false);
    });
});

describe('保存の位置から立たせる（safePose）', () => {
    const cast = castFor(toMuster('omori'));
    const genzo = cast.find((m) => m.id === 'genzo')!;
    const gate = cast.find((m) => m.id === 'gate')!;
    it('歩ける所ならそのまま', () => {
        expect(safePose({ x: 1, z: -3, heading: 2 }, cast, WALLS)).toEqual({ x: 1, z: -3, heading: 2 });
    });
    it('位置が無い・壁や家の中・人物の中・城門の出陣の場所の中・範囲の外なら開始の位置へ', () => {
        expect(safePose(null, cast, WALLS)).toEqual(DEFAULT_POSE);
        expect(safePose({ x: -7, z: -5, heading: 0 }, cast, WALLS)).toEqual(DEFAULT_POSE); // 町家 A の中
        expect(safePose({ x: genzo.x, z: genzo.z, heading: 0 }, cast, WALLS)).toEqual(DEFAULT_POSE);
        expect(safePose({ x: gate.x, z: gate.z, heading: 0 }, cast, WALLS)).toEqual(DEFAULT_POSE);
        expect(safePose({ x: 150, z: 0, heading: 0 }, cast, WALLS)).toEqual(DEFAULT_POSE);
    });
});
