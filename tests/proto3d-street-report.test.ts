/**
 * 第一章の町の急報（Version 28 §4.3・§4.4。docs/v28-town-motion-voice.md）：
 * - 冒頭は短い始め（字幕 1 行・町の入口の主人公へ寄る 1 つのカメラの動き。終わりの画は操作の肩越しのカメラと同じ）。
 * - 急報は操作の途中に、主人公が通りを北へ進んで決めた所へ入ったとき、「はじめから」の回の中だけで 1 回。城門へ行くどの道もそこを通る。
 * - 使者は走って来て止まり、片膝をついて言う（骨の形）。浅井の使者は少し遅れて急ぎ足で来て止まる。忠勝は城門の前から歩いて来て止まってから言う。
 *   家康は短い間の後に答える。台詞の時刻は声の長さ（音声ファイルの実際の長さ）と返答の間から。15 秒前後。
 * - 終わると使者は話せる位置へ、忠勝は城門の前へ歩いて行き、会話の相手の人物になる（入れ替えない。置き場所・向きは配役と同じ）。
 * - カメラは 2〜3 の画。カメラ除けの箱に入らない。人がカメラに重ならない。人と主人公の向きは 1 コマで 12° を超えて変わらない。
 * - 見ても飛ばしても状態・保存は変わらない。つづきから・確認用・第二章では起こさない（使者は始めから居る）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
    ChapterGame,
    type CinematicOptions,
    type ConfirmOptions,
    type EndingAction,
    type GameView,
    type GameWorld,
    type HudInfo,
    type MenuAction,
    type ScriptOptions,
    type TitleAction,
} from '../proto3d/src/campaign/game';
import { IEYASU_LOOKS, IEYASU_TOWN_EVENT, ieyasuCastFor, ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { CH1_OPEN_FIRST, CH1_REPORT_LINES, ieyasuCinematic, ieyasuReplays, reportCues } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { VOICE_SPEAKER_NAMES, voiceLine, voiceSecFor } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { devIeyasuState, newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import { voiceFileFor } from '../proto3d/src/audio/voiceManifest';
import { TALK_REACH, type CastMember } from '../proto3d/src/explore/cast';
import {
    ENTRY_FOLLOW_SHOT,
    ESTABLISH_SEC,
    FOLLOW_GEOM,
    REPORT_DEFAULT_ORIGIN,
    REPORT_LINE_Z,
    afterWalkEnd,
    inReportZone,
    reportLayout,
    stageFrame,
    type StageOrigin,
    type StagePerson,
    type StageShot,
} from '../proto3d/src/explore/stage';
import { FOLLOW, blockersForTest, createOrbit, placeFollow } from '../proto3d/src/game/follow';
import { HERO_RADIUS, createHero } from '../proto3d/src/game/motion';
import { BOUNDS, START, cameraBlockers, colliders, type Rect } from '../proto3d/src/layout';
import { LOOKOUT, ENTRY_POSE } from '../proto3d/src/town/spots';
import type { CineMoment, CineSpec, SituationView, StageEvent } from '../proto3d/src/story/types';
import { CINE_LENGTH_RANGE, specProblems } from '../proto3d/src/story/timeline';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { ActorLayer, KNEEL } from '../proto3d/src/explore/actors';
import { PersonFactory } from '../proto3d/src/explore/people';
import { SOLE } from '../proto3d/src/game/legs';
import { groundY } from '../proto3d/src/layout';
import { loadGlb } from './proto3d-hero-rig';
import { ch2Starts, ch1Cases } from './proto3d-ieyasu-story-states';

const DT = 1 / 60;
const J = (v: unknown) => JSON.stringify(v);
const deg = (r: number) => (Math.abs(r) * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ALL = colliders();
/** 人の大きさ（半径 m）を足した当たり判定の中か */
const PERSON_R = 0.25;
const touches = (r: Rect, x: number, z: number, pad = PERSON_R) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

const SPEC = ieyasuCinematic(newIeyasuGame(), 'ch1_report')!;
const EV = (SPEC.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'street_report' }>;
const OPEN = ieyasuCinematic(newIeyasuGame(), 'ch1_open')!;

/** 始めた時の主人公の例：通りを北へ歩く・走る（左右の端まで）、脇の道から広場へ入る、城内から城門をくぐる、止まっていた（見直し） */
const ORIGINS: { name: string; o: StageOrigin }[] = [];
for (const x of [-3.2, -2.0, -0.8, 0.3, 1.5, 2.6, 3.3]) {
    ORIGINS.push({ name: `歩き x=${x}`, o: { x, z: REPORT_LINE_Z - 0.03, heading: Math.PI, dirX: 0, dirZ: -1, speed: 1.55, yaw: 0 } });
    ORIGINS.push({ name: `走り x=${x}`, o: { x, z: REPORT_LINE_Z - 0.06, heading: Math.PI, dirX: 0, dirZ: -1, speed: 3.41, yaw: 0.6 } });
}
ORIGINS.push({ name: '斜めに北東へ', o: { x: -1.0, z: 5.9, heading: 2.4, dirX: Math.sin(2.4), dirZ: Math.cos(2.4), speed: 1.55, yaw: -0.7 } });
ORIGINS.push({ name: '見回しが南（後ろ向きに歩く）', o: { x: 0.6, z: 5.95, heading: Math.PI, dirX: 0, dirZ: -1, speed: 1.55, yaw: Math.PI } });
ORIGINS.push({ name: '見回しが東', o: { x: 0.6, z: 5.95, heading: Math.PI, dirX: 0, dirZ: -1, speed: 1.55, yaw: -Math.PI / 2 } });
ORIGINS.push({ name: '脇の道から広場へ（西から）', o: { x: -4.1, z: -10.0, heading: Math.PI / 2, dirX: 1, dirZ: 0, speed: 1.55, yaw: -Math.PI / 2 } });
ORIGINS.push({ name: '城内から城門をくぐる', o: { x: 0.2, z: -11.5, heading: 0, dirX: 0, dirZ: 1, speed: 1.55, yaw: Math.PI } });
ORIGINS.push({ name: '止まっていた（見直し：城門の前）', o: { x: -0.5, z: -5.0, heading: Math.PI, dirX: 0, dirZ: -1, speed: 0, yaw: 0 } });
ORIGINS.push({ name: '止まっていた（見直し：物見の所）', o: { x: LOOKOUT.x, z: LOOKOUT.z, heading: 0, dirX: 0, dirZ: 1, speed: 0, yaw: 0.3 } });
// 見直し（止まっていた）：城門の前の広場の北東・北西の隅（城門の柱・扉のすぐ南。忠勝が東の柱の中に止まっていた所）
for (const [x, z] of [
    [1.1, -11.35],
    [3.5, -11.1],
    [1.5, -11.55],
    [0.62, -11.0],
    [-1.1, -11.35],
    [-3.5, -11.1],
] as const)
    ORIGINS.push({ name: `止まっていた（見直し：広場の隅 ${x}, ${z}）`, o: { x, z, heading: Math.PI, dirX: 0, dirZ: -1, speed: 0, yaw: 0 } });

/** 出来事の後の歩きが終わる時刻（settled）。60 秒までに終わる */
function settleT(o: StageOrigin): number {
    for (let t = EV.cue.end; t < EV.cue.end + 60; t += 0.25) if (stageFrame(EV, t, false, [], o).settled) return t;
    return Infinity;
}

// ================================================================ 冒頭（短い始め）

describe('第一章の冒頭（短い始め）：字幕 1 行と、町の入口の主人公へ寄る 1 つのカメラの動き', () => {
    it('3D の場面 1 つ・字幕 1 行（時代・主人公・急報）。4 秒前後（CINE_LENGTH_RANGE 3.5〜6 秒）', () => {
        expect(specProblems(OPEN)).toEqual([]);
        expect(OPEN.beats).toHaveLength(1);
        expect(OPEN.beats[0]!.kind).toBe('stage');
        expect((OPEN.beats[0] as { event: StageEvent }).event).toEqual({ id: 'town_life', hero: true, establish: true });
        expect(OPEN.captions.map((c) => c.text)).toEqual([CH1_OPEN_FIRST]);
        expect(OPEN.duration).toBe(ESTABLISH_SEC);
        expect(CINE_LENGTH_RANGE.ch1_open).toEqual([3.5, 6]);
        expect(OPEN.info).toMatchObject({ when: 0, where: 0, crisis: 0 });
    });
    it('終わりの画は、操作の始めの肩越しのカメラ（町の入口・見回し北・START.pitch）と同じ（切らずに操作へ渡す）', () => {
        expect(FOLLOW_GEOM).toEqual({ height: FOLLOW.height, shoulder: FOLLOW.shoulder, distance: FOLLOW.distance });
        const o = createOrbit(0, START.pitch);
        const p = placeFollow(o, ENTRY_POSE.x, ENTRY_POSE.z, 0);
        // 町の入口では壁に当たらない（距離は縮まない）
        expect(o.dist).toBeCloseTo(FOLLOW.distance, 6);
        const end = stageFrame((OPEN.beats[0] as { event: StageEvent }).event, OPEN.duration, false).shot;
        expect(end).toEqual(ENTRY_FOLLOW_SHOT);
        for (const [a, b] of [
            [end.px, p.position.x],
            [end.py, p.position.y],
            [end.pz, p.position.z],
            [end.tx, p.target.x],
            [end.ty, p.target.y],
            [end.tz, p.target.z],
        ] as const)
            expect(a).toBeCloseTo(b, 5);
    });
    it('1 つのなめらかな動き：途中で切らない（1 コマ 0.1 m 以内・向き 1 コマ 1° 以内）、終わりで速さ 0、カメラ除けの箱に入らない。町の人々を隠さない', () => {
        const ev = (OPEN.beats[0] as { event: StageEvent }).event;
        const boxes = blockersForTest(cameraBlockers());
        let prev: StageShot | null = null;
        const dir = (s: StageShot) => new THREE.Vector3(s.tx - s.px, s.ty - s.py, s.tz - s.pz).normalize();
        for (let t = 0; t <= OPEN.duration + 1e-9; t += DT) {
            const f = stageFrame(ev, t, false);
            expect(f.people).toEqual([]);
            expect(f.hideAmbient).toEqual([]);
            expect(f.hero).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
            const v = new THREE.Vector3(f.shot.px, f.shot.py, f.shot.pz);
            for (const b of boxes) expect(b.containsPoint(v), `t=${t.toFixed(2)}`).toBe(false);
            if (prev) {
                expect(Math.hypot(f.shot.px - prev.px, f.shot.py - prev.py, f.shot.pz - prev.pz)).toBeLessThan(0.1);
                expect(deg(dir(f.shot).angleTo(dir(prev)))).toBeLessThan(1);
            }
            prev = f.shot;
        }
        const a = stageFrame(ev, OPEN.duration - DT, false).shot;
        const b = stageFrame(ev, OPEN.duration, false).shot;
        expect(Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz) / DT).toBeLessThan(0.05);
        // 動きを減らす：終わりの画のまま
        expect(stageFrame(ev, 0, true).shot).toEqual(ENTRY_FOLLOW_SHOT);
    });
});

// ================================================================ 始める所

describe('急報を始める所：城門へ行くどの道も通る', () => {
    it('町の入口から忠勝の話せる所まで、始める所を通らずには行けない（当たり判定の地図で調べる。脇の道・城内回りも）。入口・物見の所では始めない', () => {
        const step = 0.25;
        const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / step);
        const nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / step);
        const R = HERO_RADIUS;
        const free = (x: number, z: number) => x > BOUNDS.x0 + R && x < BOUNDS.x1 - R && z > BOUNDS.z0 + R && z < BOUNDS.z1 - R && !ALL.some((r) => x > r.x0 - R && x < r.x1 + R && z > r.z0 - R && z < r.z1 + R);
        const seen = new Uint8Array(nx * nz);
        const ix = (x: number) => Math.round((x - BOUNDS.x0) / step);
        const iz = (z: number) => Math.round((z - BOUNDS.z0) / step);
        const q = [ix(ENTRY_POSE.x) + iz(ENTRY_POSE.z) * nx];
        seen[q[0]!] = 1;
        let reached = 0;
        while (q.length) {
            const c = q.pop()!;
            const i = c % nx;
            const j = (c - i) / nx;
            for (const [di, dj] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ] as const) {
                const a = i + di;
                const b = j + dj;
                if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
                const k = a + b * nx;
                if (seen[k]) continue;
                const x = BOUNDS.x0 + a * step;
                const z = BOUNDS.z0 + b * step;
                if (!free(x, z) || inReportZone(x, z)) continue;
                seen[k] = 1;
                reached++;
                q.push(k);
                // 忠勝（城門の前）の話せる所へ着いてしまったら失敗
                expect(Math.hypot(x - -1.5, z - -7.2) > TALK_REACH + 0.05, `(${x}, ${z}) から忠勝と話せる`).toBe(true);
            }
        }
        // 入口から始める所の手前まで（物見の所も）は歩ける
        expect(reached).toBeGreaterThan(1000);
        expect(seen[ix(LOOKOUT.x) + iz(LOOKOUT.z) * nx]).toBe(1);
        expect(inReportZone(ENTRY_POSE.x, ENTRY_POSE.z)).toBe(false);
        expect(inReportZone(LOOKOUT.x, LOOKOUT.z)).toBe(false);
        // 入口から北へまっすぐ歩けば、z 6 で始まる
        expect(inReportZone(ENTRY_POSE.x, REPORT_LINE_Z + 0.01)).toBe(false);
        expect(inReportZone(ENTRY_POSE.x, REPORT_LINE_Z - 0.01)).toBe(true);
        // 城内（城門の北）では始めない
        expect(inReportZone(0, -13)).toBe(false);
        expect(IEYASU_TOWN_EVENT.zone).toBe(inReportZone);
    });
});

// ================================================================ 台本（時刻と声）

describe('急報の台本：同じ台詞・同じ順。時刻は声の長さと返答の間から（15 秒前後）', () => {
    it('字幕は 織田の使者 → 浅井の使者 → 忠勝 → 家康（表と同じ文・同じ話し手）。台本の決まりどおり（10〜16 秒）', () => {
        expect(specProblems(SPEC)).toEqual([]);
        expect(SPEC.moment).toBe('ch1_report');
        expect(CINE_LENGTH_RANGE.ch1_report).toEqual([10, 16]);
        expect(SPEC.duration).toBeGreaterThanOrEqual(13);
        expect(SPEC.duration).toBeLessThanOrEqual(15.6);
        expect(SPEC.captions.map((c) => c.voice)).toEqual([...CH1_REPORT_LINES]);
        for (const c of SPEC.captions) {
            const v = voiceLine(c.voice!);
            expect(c.text).toBe(v.text);
            expect(c.speaker).toBe(VOICE_SPEAKER_NAMES[v.speaker]);
        }
        expect(SPEC.captions.map((c) => c.speaker)).toEqual(['織田家の使者', '浅井家の使者', '忠勝', '家康']);
        // 新しい台詞・地の文は足さない
        expect(SPEC.captions.filter((c) => !c.voice)).toEqual([]);
        expect(SPEC.info).toEqual({ crisis: SPEC.captions[0]!.start, decide: SPEC.captions[2]!.start });
    });
    it('字幕の時間は声の長さ（音声ファイルの長さ＋余白）以上で、次の話し手は前の声が終わって返答の間（台本の gapBefore）を置いてから', () => {
        const caps = SPEC.captions;
        caps.forEach((c, i) => {
            expect(c.end - c.start + 1e-6).toBeGreaterThanOrEqual(voiceSecFor(c.voice!));
            const next = caps[i + 1];
            if (!next) return;
            expect(next.start).toBeCloseTo(c.end, 6);
            const f = voiceFileFor(c.voice!)!;
            const nf = voiceFileFor(next.voice!)!;
            expect(f && nf).toBeTruthy();
            // 前の声の終わり（ファイルの後ろの無音を除く）から、次の声の始め（前の無音を除く）までの間
            const gap = next.start + nf.lead - (c.start + f.sec - f.tail);
            expect(gap + 1e-6, `${c.voice} → ${next.voice}`).toBeGreaterThanOrEqual(nf.gapBefore ?? 0.5);
        });
        // 家康の返答の前の間（急報の後、少し間を置いて答える）
        const t = caps[2]!;
        const h = caps[3]!;
        const tf = voiceFileFor(t.voice!)!;
        expect(h.start - (t.start + tf.sec - tf.tail)).toBeGreaterThanOrEqual(0.6);
        // 3D の出来事の時刻は字幕と同じ
        const cue = reportCues();
        expect(EV.cue).toEqual({ say: cue.say, end: cue.end });
        expect(EV.cue.say.map((x) => x[0])).toEqual(caps.map((c) => c.start));
        expect(EV.cue.end).toBe(SPEC.duration);
    });
    it('使者・家臣は会話の相手そのもの（同じ id・見た目・置き場所・向き）。第二章には急報が無い', () => {
        const cast = ieyasuCastFor(newIeyasuGame());
        for (const p of [...EV.envoys, EV.retainer]) {
            const m = cast.find((c) => c.id === p.cast)!;
            expect(m, p.cast).toBeDefined();
            expect(p.look).toBe(m.look);
            expect(p.spot[0]).toBe(m.x);
            expect(p.spot[1]).toBe(m.z);
            expect(p.spot[2]).toBeCloseTo(m.heading, 9);
        }
        expect(EV.envoys.map((e) => e.cast)).toEqual(['oda_envoy', 'asai_envoy']);
        expect(EV.retainer.cast).toBe('tadakatsu');
        expect(EV.retainer.look).toBe(IEYASU_LOOKS.tadakatsu);
        for (const c of ch2Starts(ch1Cases()).slice(0, 8)) expect(ieyasuCinematic(c.state, 'ch1_report')).toBeNull();
        // 情勢の画面から見直せる（第一章の間）
        expect(ieyasuReplays(newIeyasuGame()).map((r) => r.moment)).toEqual(['ch1_intro', 'ch1_open', 'ch1_report']);
    });
    it('見直し（支度・戦後・結末）：置き場所は今の段階の城下の配役。居ない使者は後の歩きをせず（after: false）、場面の後は描かない。居る人は置き場所へ歩いて着く', () => {
        const o = REPORT_DEFAULT_ORIGIN;
        for (const [phase, policy] of [
            ['muster', 'oda'],
            ['muster', 'asai'],
            ['muster', 'home'],
            ['aftermath', 'oda'],
            ['aftermath', 'asai'],
            ['ending', 'asai'],
        ] as const) {
            const name = `${phase}/${policy}`;
            const st = devIeyasuState(phase, policy);
            const spec = ieyasuCinematic(st, 'ch1_report')!;
            const ev = (spec.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'street_report' }>;
            // 字幕・時刻は同じ
            expect(ev.cue, name).toEqual(EV.cue);
            expect(spec.captions, name).toEqual(SPEC.captions);
            const cast = ieyasuCastFor(st);
            const present: string[] = [];
            for (const p of [...ev.envoys, ev.retainer]) {
                const m = cast.find((c) => c.id === p.cast && c.pose === 'stand');
                if (m) {
                    present.push(p.cast);
                    expect(p.after, `${name} ${p.cast}`).toBeUndefined();
                    expect(p.spot, `${name} ${p.cast}`).toEqual([m.x, m.z, m.heading]);
                } else expect(p.after, `${name} ${p.cast}`).toBe(false);
            }
            const E = ev.cue.end;
            expect(afterWalkEnd(ev), name).toBe(present.length ? E : null);
            // 場面の最後のコマまでは 3 人とも描く
            expect(
                stageFrame(ev, E, false, [], o)
                    .people.map((p) => p.cast)
                    .sort(),
                name,
            ).toEqual(['asai_envoy', 'oda_envoy', 'tadakatsu']);
            // 場面の後：居る人だけ（歩いて置き場所へ。1 コマで飛ばない）。着いたら置き場所・置き場所の向き
            let prev: StagePerson[] | null = null;
            let t = E + DT;
            for (; t < E + 40; t += DT) {
                const f = stageFrame(ev, t, false, [], o);
                expect(f.people.map((p) => p.cast).sort(), `${name} t=${t.toFixed(2)}`).toEqual([...present].sort());
                for (const p of f.people) {
                    const q = prev?.find((x) => x.cast === p.cast);
                    if (q) expect(Math.hypot(p.x - q.x, p.z - q.z), `${name} ${p.cast} t=${t.toFixed(2)}`).toBeLessThan(0.1);
                    for (const r of ALL) if (touches(r, p.x, p.z)) throw new Error(`${name} t=${t.toFixed(2)}：${p.cast} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) が当たり判定 ${J(r)} にかかる`);
                }
                prev = f.people;
                if (f.settled) break;
            }
            expect(t, name).toBeLessThan(E + 40);
            for (const id of present) {
                const p = stageFrame(ev, t, false, [], o).people.find((x) => x.cast === id)!;
                const m = cast.find((c) => c.id === id)!;
                expect([p.x, p.z], `${name} ${id}`).toEqual([m.x, m.z]);
                expect(p.heading, `${name} ${id}`).toBeCloseTo(m.heading, 5);
            }
        }
    });
});

// ================================================================ 人とカメラ

/** 出来事（と後の歩き）を 1/60 秒ずつ */
function track(o: StageOrigin, until = settleT(o) + 0.5) {
    const out: { t: number; people: StagePerson[]; hero: { x: number; z: number; heading: number } | null; shot: StageShot; settled: boolean }[] = [];
    for (let i = 0; i * DT <= until; i++) {
        const t = i * DT;
        const f = stageFrame(EV, t, false, [], o);
        out.push({ t, people: f.people, hero: f.hero, shot: f.shot, settled: !!f.settled });
    }
    return out;
}

describe('急報の人：走って来て止まり、言う前に止まる。向きは 1 コマで飛ばない。当たり判定の中を通らない', () => {
    it('どの所で始めても：使者・忠勝は言い始める前に止まり、主人公から 1.5〜3.3 m の所に立つ。終わりは置き場所・置き場所の向き', () => {
        for (const { name, o } of ORIGINS) {
            const L = reportLayout(EV, o);
            const say = EV.cue.say;
            const at = (t: number, id: string) => stageFrame(EV, t, false, [], o).people.find((p) => p.cast === id)!;
            // 織田の使者：最初の台詞の時には止まっている（片膝をつきかける）
            expect(at(say[0]![0], 'oda_envoy').moving, name).toBe(0);
            expect(at(say[1]![0] - 0.35, 'asai_envoy').moving, name).toBe(0);
            expect(at(say[2]![0] - 0.3, 'tadakatsu').moving, name).toBe(0);
            for (const s of [L.stops.oda, L.stops.asai, L.stops.retainer]) {
                const d = Math.hypot(s[0] - L.hero[0], s[1] - L.hero[1]);
                expect(d, `${name}：止まる所 ${s} と主人公 ${L.hero}`).toBeGreaterThan(1.3);
                expect(d, `${name}：止まる所 ${s} と主人公 ${L.hero}`).toBeLessThan(3.4);
                // 止まる所（台詞を言う所）は、人の大きさを足しても当たり判定（城門の柱・礎石・扉・塀）にかからない
                for (const r of ALL) expect(touches(r, s[0], s[1]), `${name}：止まる所 ${s} が当たり判定 ${J(r)} にかかる`).toBe(false);
            }
            const T = settleT(o);
            expect(T, name).toBeLessThan(EV.cue.end + 25);
            const f = stageFrame(EV, T, false, [], o);
            for (const p of [...EV.envoys, EV.retainer]) {
                const q = f.people.find((x) => x.cast === p.cast)!;
                expect([q.x, q.z, q.moving], name).toEqual([p.spot[0], p.spot[1], 0]);
                expect(q.heading).toBeCloseTo(p.spot[2], 5);
            }
            // 出来事の始め（t 0）は、使者は話せる位置に立っていない（南から来る途中で、動いている）
            const f0 = stageFrame(EV, 0, false, [], o);
            for (const e of EV.envoys) {
                const q = f0.people.find((x) => x.cast === e.cast)!;
                expect(Math.hypot(q.x - e.spot[0], q.z - e.spot[1]), name).toBeGreaterThan(1);
                expect(q.moving, name).toBe(1);
                expect(q.z, name).toBeGreaterThan(L.hero[1] + 2);
            }
        }
    });
    it('人・主人公の向きは、出来事の間も後の歩きの間も、1 コマ（60 コマ/秒）で 12° を超えて変わらない。人は当たり判定の中を通らない', () => {
        let maxPerson = 0;
        let maxHero = 0;
        for (const { name, o } of ORIGINS) {
            const tr = track(o);
            for (let i = 1; i < tr.length; i++) {
                const a = tr[i - 1]!;
                const b = tr[i]!;
                for (const p of b.people) {
                    const q = a.people.find((x) => x.key === p.key);
                    if (!q) continue;
                    // 着いて置き場所に替わるコマ（同じ所・同じ向き）も含めて
                    const d = deg(wrap(p.heading - q.heading));
                    maxPerson = Math.max(maxPerson, d);
                    expect(d, `${name} t=${b.t.toFixed(2)} ${p.key}`).toBeLessThanOrEqual(12);
                    expect(Math.hypot(p.x - q.x, p.z - q.z), `${name} t=${b.t.toFixed(2)} ${p.key} が飛ぶ`).toBeLessThan(0.1);
                    for (const r of ALL) if (touches(r, p.x, p.z)) throw new Error(`${name} t=${b.t.toFixed(2)}：${p.key} (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) が当たり判定 ${J(r)} にかかる（人の大きさ ${PERSON_R} m）`);
                }
                if (a.hero && b.hero) {
                    const d = deg(wrap(b.hero.heading - a.hero.heading));
                    maxHero = Math.max(maxHero, d);
                    expect(Math.hypot(b.hero.x - a.hero.x, b.hero.z - a.hero.z)).toBeLessThan(0.07);
                }
            }
        }
        expect(maxPerson).toBeGreaterThan(1);
        // 主人公の向きは演出が決める向き（描く体は game/heroAnim.ts が 1 コマ 7°〜11.5° までで追い、足を踏み替える）。急に回し過ぎない
        expect(maxHero).toBeLessThan(14);
    }, 60_000);
    it('織田の使者は走って来る（走りの重み 1）→ 止まりで歩き・待機へ混ぜる → 片膝（骨の形。0→1 を 0.5 秒ほどで）。周期の数は止まりかけで飛ばない', () => {
        const o = REPORT_DEFAULT_ORIGIN;
        const p0 = stageFrame(EV, 0.1, false, [], o).people.find((p) => p.cast === 'oda_envoy')!;
        expect(p0.run).toBe(1);
        expect(p0.moving).toBe(1);
        let prevC = 0;
        let maxDc = 0;
        let kneelAt = -1;
        for (let t = 0; t <= EV.cue.say[0]![0] + 1.2; t += DT) {
            const p = stageFrame(EV, t, false, [], o).people.find((x) => x.cast === 'oda_envoy')!;
            maxDc = Math.max(maxDc, (p.cycle ?? 0) - prevC);
            expect((p.cycle ?? 0) + 1e-9).toBeGreaterThanOrEqual(prevC);
            prevC = p.cycle ?? 0;
            if (kneelAt < 0 && (p.act?.kneel ?? 0) >= 0.99) kneelAt = t;
        }
        // 1 コマの周期の進みは、走りの周期（3.6 m/秒で 1.65 周期/秒）を超えない
        expect(maxDc * 60).toBeLessThan(1.8);
        expect(kneelAt).toBeGreaterThan(1.2);
        expect(kneelAt).toBeLessThan(EV.cue.say[0]![0] + 0.6);
        // 家臣は家康の命に軽く礼をする（返事の間）
        const bows = Array.from({ length: 200 }, (_, i) => stageFrame(EV, EV.cue.say[3]![0] + i * 0.02, false, [], o).people.find((x) => x.cast === 'tadakatsu')!.act?.bow ?? 0);
        expect(Math.max(...bows)).toBeGreaterThan(0.95);
    });
    it('主人公：始めた所で減速して止まり（操作の止まりと同じ 12 m/秒²）、走って来る使者へ振り向き、忠勝が来ると向き直る。顔と目線は話し手へ', () => {
        const o = { ...REPORT_DEFAULT_ORIGIN, speed: 3.41 };
        const L = reportLayout(EV, o);
        const f0 = stageFrame(EV, 0, false, [], o);
        expect(f0.hero).toMatchObject({ x: o.x, z: o.z });
        expect(f0.heroStays).toBe(true);
        const f1 = stageFrame(EV, 1.0, false, [], o);
        // 止まる距離 v²/24（3.41 m/秒で約 0.48 m）
        expect(o.z - f1.hero!.z).toBeCloseTo((3.41 * 3.41) / 24, 2);
        const toOda = Math.atan2(L.stops.oda[0] - L.hero[0], L.stops.oda[1] - L.hero[1]);
        expect(deg(wrap(f1.hero!.heading - toOda))).toBeLessThan(1);
        // 話し手を目で追う：織田の使者（片膝の頭の高さ）→ 浅井の使者 → 忠勝
        const g1 = stageFrame(EV, EV.cue.say[0]![0] + 0.5, false, [], o).heroGaze!;
        expect(g1.y).toBeLessThan(1.3);
        const g2 = stageFrame(EV, EV.cue.say[1]![0] + 0.5, false, [], o).heroGaze!;
        expect([g2.x, g2.z]).toEqual([L.stops.asai[0], L.stops.asai[1]].map((v) => Math.round(v * 1000) / 1000));
        const f3 = stageFrame(EV, EV.cue.say[2]![0] + 0.5, false, [], o);
        const toRet = Math.atan2(L.stops.retainer[0] - L.hero[0], L.stops.retainer[1] - L.hero[1]);
        expect(deg(wrap(f3.hero!.heading - toRet))).toBeLessThan(1);
        expect([f3.heroGaze!.x, f3.heroGaze!.z]).toEqual([L.stops.retainer[0], L.stops.retainer[1]].map((v) => Math.round(v * 1000) / 1000));
        // 出来事の後は主人公を動かさない（操作）
        expect(stageFrame(EV, EV.cue.end + 0.5, false, [], o).hero).toBeNull();
    });
    it('動きを減らす：人は止まる所に現れ（歩かない）、カメラは動かない。出来事の後の歩きもしない（すぐ置き場所）', () => {
        const a = stageFrame(EV, 0, true);
        for (let t = 0; t <= EV.cue.end; t += 0.5) {
            const f = stageFrame(EV, t, true);
            expect(f.shot).toEqual(a.shot);
            expect(f.people.map((p) => [p.x, p.z, p.moving])).toEqual(a.people.map((p) => [p.x, p.z, p.moving]));
        }
        expect(stageFrame(EV, EV.cue.end + 0.1, true).settled).toBe(true);
    });
    it('同じ出来事・同じ t・同じ origin なら同じ形（呼ぶ順によらない）', () => {
        const ts = [0, 0.5, 2, 5.6, 8, 12.5, EV.cue.end, EV.cue.end + 3, EV.cue.end + 9];
        for (const { o } of ORIGINS.slice(0, 6)) {
            const a = ts.map((t) => stageFrame(EV, t, false, [], o));
            const b = [...ts].reverse().map((t) => stageFrame(EV, t, false, [], o)).reverse();
            expect(b).toEqual(a);
            expect(JSON.parse(J(a))).toEqual(a);
        }
    });
});

describe('急報のカメラ：2〜3 の画（話す人と聞く人）。大きな旋回・寄りを繰り返さない', () => {
    it('どの所で始めても：切り替えは 2 回まで、画の中の動きはゆっくり（毎秒 0.5 m・12° まで）、カメラ除けの箱に入らない、人がカメラに重ならない', () => {
        const boxes = blockersForTest(cameraBlockers());
        const dir = (s: StageShot) => new THREE.Vector3(s.tx - s.px, s.ty - s.py, s.tz - s.pz).normalize();
        const v = new THREE.Vector3();
        for (const { name, o } of ORIGINS) {
            let cuts = 0;
            let prev: StageShot | null = null;
            for (let t = 0; t <= EV.cue.end + 1e-9; t += DT) {
                const f = stageFrame(EV, t, false, [], o);
                const s = f.shot;
                v.set(s.px, s.py, s.pz);
                for (const b of boxes) if (b.containsPoint(v)) throw new Error(`${name} t=${t.toFixed(2)}：カメラ (${s.px}, ${s.py}, ${s.pz}) が箱の中`);
                expect(s.py).toBeGreaterThan(0.6);
                for (const p of f.people) expect(Math.hypot(p.x - s.px, p.z - s.pz), `${name} t=${t.toFixed(2)}：${p.key} がカメラに重なる`).toBeGreaterThan(0.55);
                if (f.hero) expect(Math.hypot(f.hero.x - s.px, f.hero.z - s.pz), `${name} t=${t.toFixed(2)}：主人公がカメラに重なる`).toBeGreaterThan(0.55);
                if (prev) {
                    const move = Math.hypot(s.px - prev.px, s.py - prev.py, s.pz - prev.pz);
                    const turn = deg(dir(s).angleTo(dir(prev)));
                    if (move > 0.2 || turn > 5) cuts++;
                    else {
                        expect(move / DT, `${name} t=${t.toFixed(2)} の動き`).toBeLessThan(0.5);
                        expect(turn / DT, `${name} t=${t.toFixed(2)} の向き`).toBeLessThan(12);
                    }
                }
                prev = s;
            }
            expect(cuts, name).toBeGreaterThanOrEqual(1);
            expect(cuts, name).toBeLessThanOrEqual(2);
        }
    });
    it('見回しが北（ふだん）なら画は 2 つで、最後の画は肩越しのカメラの側（南）から：操作のカメラへ戻るとき主人公を突き抜けない', () => {
        const o = REPORT_DEFAULT_ORIGIN;
        const L = reportLayout(EV, o);
        expect(L.cuts[1]).toBe(Infinity);
        const end = stageFrame(EV, EV.cue.end, false, [], o).shot;
        const pivot = { x: L.hero[0] + FOLLOW.shoulder, z: L.hero[1] };
        const follow = { x: pivot.x, z: pivot.z + FOLLOW.distance };
        // 最後の画のカメラから肩越しのカメラへの線分が、主人公（半径 0.6 m）を通らない
        const segDist = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => {
            const dx = bx - ax;
            const dz = bz - az;
            const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
            return Math.hypot(ax + dx * k - px, az + dz * k - pz);
        };
        expect(segDist(end.px, end.pz, follow.x, follow.z, L.hero[0], L.hero[1])).toBeGreaterThan(0.6);
        // 見回しが南・東のときも、最後の画はその見回しの側
        for (const yaw of [Math.PI, -Math.PI / 2]) {
            const oo = { ...o, yaw };
            const LL = reportLayout(EV, oo);
            const e = stageFrame(EV, EV.cue.end, false, [], oo).shot;
            const back = [Math.sin(yaw), Math.cos(yaw)];
            expect((e.px - LL.hero[0]) * back[0]! + (e.pz - LL.hero[1]) * back[1]!, `yaw ${yaw}`).toBeGreaterThan(1);
        }
    });
});

// ================================================================ ゲームの流れ（偽の画面・本物のシナリオと台本）

type Req =
    | { kind: 'title'; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'cinematic'; spec: CineSpec; opts: CinematicOptions; answer: (r: 'done' | 'skipped') => void }
    | { kind: 'situation'; view: SituationView; answer: (r?: { replay?: CineMoment }) => void };

class View implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    promptInfo: { id: string } | null = null;
    title() {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', answer }));
    }
    script(script: ScenarioScript, _o: ScriptOptions) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu() {
        return new Promise<MenuAction>(() => undefined);
    }
    ending() {
        return new Promise<EndingAction | void>(() => undefined);
    }
    record(_v: ScenarioEndingView) {
        return new Promise<void>(() => undefined);
    }
    hud(info: HudInfo | null) {
        this.hudInfo = info;
    }
    prompt(p: { id: string } | null) {
        this.promptInfo = p;
    }
    intro() {}
    toast() {}
    abandon() {
        this.reqs = [];
    }
    cinematic(spec: CineSpec, opts: CinematicOptions) {
        return new Promise<'done' | 'skipped'>((resolve) =>
            this.reqs.push({
                kind: 'cinematic',
                spec,
                opts,
                answer: (r) => {
                    opts.onStage(null, 0, opts.reduced);
                    resolve(r);
                },
            }),
        );
    }
    situation(view: SituationView) {
        return new Promise<{ replay?: CineMoment } | void>((answer) => this.reqs.push({ kind: 'situation', view, answer: (r) => answer(r) }));
    }
}

class World implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    control = false;
    arriving: string[] = [];
    stages: (string | null)[] = [];
    private readonly w = colliders();
    walls(): Rect[] {
        return this.w;
    }
    setCast(c: CastMember<string>[]) {
        this.cast = c;
    }
    heroPose() {
        return { ...this.pose };
    }
    poseCalls: { pose: ExplorePose; keepCamera: boolean }[] = [];
    setHeroPose(p: ExplorePose, opts?: { keepCamera?: boolean }) {
        this.pose = { ...p };
        this.poseCalls.push({ pose: { ...p }, keepCamera: !!opts?.keepCamera });
    }
    setControl(on: boolean) {
        this.control = on;
    }
    stage(ev: StageEvent | null) {
        this.stages.push(ev?.id ?? null);
    }
    castArriving() {
        return this.arriving;
    }
}

async function flush(n = 40): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}
async function next<K extends Req['kind']>(v: View, kind: K): Promise<Extract<Req, { kind: K }>> {
    for (let i = 0; i < 200; i++) {
        const k = v.reqs.findIndex((r) => r.kind === kind);
        if (k >= 0) return v.reqs.splice(k, 1)[0] as Extract<Req, { kind: K }>;
        await flush(5);
    }
    throw new Error(`${kind} が来ない（${v.reqs.map((r) => r.kind).join(',')}）`);
}

function setup(storage = new MemoryStorage()) {
    const view = new View();
    const world = new World();
    const g = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
    return { g, view, world, storage };
}

/** はじめから → 冒頭（短い始め）を見る → 城下の入口で操作 */
async function newGame(how: 'done' | 'skipped' = 'done') {
    const s = setup();
    void s.g.start();
    (await next(s.view, 'title')).answer('new:ieyasu1570');
    const c = await next(s.view, 'cinematic');
    expect(c.spec.id).toBe('ch1_open');
    c.answer(how);
    await flush();
    expect(s.g.screen).toBe('explore');
    return s;
}

const ids = (w: World) => w.cast.map((c) => c.id);
const writes = (st: MemoryStorage) => st.touched.filter((t) => t.op !== 'get').map((t) => t.key);

describe('ゲームの流れ：「はじめから」の回の中で 1 回だけ。見ても飛ばしても状態・保存は同じ', () => {
    for (const how of ['done', 'skipped'] as const) {
        it(`はじめから → 短い始め → 操作（使者はまだ町に居ない）→ 通りを北へ → 急報（${how}）→ 操作（使者は町に居る）。戻ってもう一度北へ来ても起きない`, async () => {
            const { g, view, world, storage } = await newGame();
            expect(g.townEventPending).toBe('ch1_report');
            expect(ids(world)).toContain('tadakatsu');
            expect(ids(world)).not.toContain('oda_envoy');
            expect(ids(world)).not.toContain('asai_envoy');
            const s0 = J(g.state);
            // 入口から北へ、線の手前まで：まだ起きない
            world.pose = { x: ENTRY_POSE.x, z: REPORT_LINE_Z + 0.4, heading: Math.PI };
            g.tick(1 / 30);
            expect(view.reqs).toEqual([]);
            expect(world.control).toBe(true);
            // 線を越えた
            world.pose = { x: ENTRY_POSE.x, z: REPORT_LINE_Z - 0.05, heading: Math.PI };
            g.tick(1 / 30);
            const c = await next(view, 'cinematic');
            expect(c.spec.id).toBe('ch1_report');
            expect(g.screen).toBe('cinematic');
            expect(world.control).toBe(false);
            expect(g.townEventPending).toBeNull();
            // 演出中の入力（会話・メニュー・情勢）は漏れない
            void g.interact('tadakatsu');
            void g.openMenu();
            void g.openSituation();
            await flush();
            expect(view.reqs).toEqual([]);
            const posesBefore = world.poseCalls.length;
            c.answer(how);
            await flush();
            expect(g.screen).toBe('explore');
            expect(world.control).toBe(true);
            // 主人公はその場（振り向いただけ）：始める前の位置へ戻さない
            expect(world.poseCalls.length).toBe(posesBefore);
            // 使者が町に居る（話せる）
            expect(ids(world)).toEqual(expect.arrayContaining(['tadakatsu', 'oda_envoy', 'asai_envoy']));
            expect(J(g.state)).toBe(s0);
            expect(writes(storage)).toEqual([]);
            expect(g.cineLog).toEqual(['ch1_open', 'ch1_report']);
            // 南へ戻って、もう一度北へ：起きない
            world.pose = { x: 0, z: 9, heading: 0 };
            g.tick(1 / 30);
            world.pose = { x: 0, z: 2, heading: Math.PI };
            g.tick(1 / 30);
            await flush();
            expect(view.reqs).toEqual([]);
            expect(g.cineLog).toEqual(['ch1_open', 'ch1_report']);
        });
    }

    it('急報の後：話せる位置へ歩いている相手には「話す」を出さない。着いたら出す。使者・忠勝と話せ、忠勝から軍議へ進める', async () => {
        const { g, view, world } = await newGame();
        world.pose = { x: 0.3, z: 5.9, heading: Math.PI };
        g.tick(1 / 30);
        (await next(view, 'cinematic')).answer('done');
        await flush();
        world.arriving = ['oda_envoy', 'asai_envoy', 'tadakatsu'];
        world.pose = { x: 2.0, z: -5.6, heading: Math.PI };
        g.tick(1 / 30);
        expect(view.promptInfo).toBeNull();
        world.arriving = [];
        g.tick(1 / 30);
        expect(view.promptInfo?.id).toBe('oda_envoy');
        void g.interact();
        (await next(view, 'script')).answer(null);
        await flush();
        world.pose = { x: 4.0, z: -2.4, heading: Math.PI / 2 };
        g.tick(1 / 30);
        expect(view.promptInfo?.id).toBe('asai_envoy');
        void g.interact();
        (await next(view, 'script')).answer(null);
        await flush();
        world.pose = { x: -1.5, z: -5.6, heading: Math.PI };
        g.tick(1 / 30);
        expect(view.promptInfo?.id).toBe('tadakatsu');
        void g.interact();
        const s = await next(view, 'script');
        expect(s.script.choices?.map((c) => c.id)).toContain('open_council');
        s.answer('open_council');
        await flush();
        // 軍議が開く（今までどおり）
        const council = await next(view, 'script');
        expect(g.screen).toBe('council');
        expect(council.script.lines.length).toBeGreaterThan(0);
    });

    it('つづきから・確認用（begin）・第二章では起こさない（使者は始めから町に居る）', async () => {
        // 確認用の始め（begin）
        const a = setup();
        a.g.begin(newIeyasuGame() as never, 'ieyasu1570');
        expect(a.g.townEventPending).toBeNull();
        expect(ids(a.world)).toEqual(expect.arrayContaining(['oda_envoy', 'asai_envoy']));
        a.world.pose = { x: 0.3, z: 0, heading: Math.PI };
        a.g.tick(1 / 30);
        await flush();
        expect(a.view.reqs).toEqual([]);
        // つづきから（探索の段階の保存）
        const st = new MemoryStorage();
        const b0 = setup(st);
        void b0.g.start();
        (await next(b0.view, 'title')).answer('new:ieyasu1570');
        (await next(b0.view, 'cinematic')).answer('skipped');
        await flush();
        // 保存を作る（メニューの手動の保存と同じ口：シナリオの store）
        const sc = ieyasuScenario(st);
        expect(sc.store.save(newIeyasuGame(), 'manual').ok).toBe(true);
        const b = setup(st);
        void b.g.start();
        (await next(b.view, 'title')).answer('continue:ieyasu1570');
        await flush();
        expect(b.g.screen).toBe('explore');
        expect(b.g.townEventPending).toBeNull();
        expect(ids(b.world)).toEqual(expect.arrayContaining(['oda_envoy', 'asai_envoy']));
        b.world.pose = { x: 0.3, z: 0, heading: Math.PI };
        b.g.tick(1 / 30);
        await flush();
        expect(b.view.reqs).toEqual([]);
        // 第二章の状態：町の急報は無い
        const c2 = ch2Starts(ch1Cases())[0]!.state;
        expect(ieyasuScenario(null).townEvent!(c2)).toBeNull();
        expect(st.data.has(IEYASU_SAVE_KEY)).toBe(true);
    });

    it('まだ起きていない急報を情勢の画面から見直した：この回ではもう起こさない（使者は町に居る）。状態は変えない', async () => {
        const { g, view, world } = await newGame();
        const s0 = J(g.state);
        void g.openSituation();
        const sit = await next(view, 'situation');
        expect(sit.view.replays.map((r) => r.moment)).toContain('ch1_report');
        sit.answer({ replay: 'ch1_report' });
        (await next(view, 'cinematic')).answer('skipped');
        (await next(view, 'situation')).answer();
        await flush();
        expect(g.townEventPending).toBeNull();
        expect(ids(world)).toEqual(expect.arrayContaining(['oda_envoy', 'asai_envoy']));
        world.pose = { x: 0.3, z: 0, heading: Math.PI };
        g.tick(1 / 30);
        await flush();
        expect(view.reqs).toEqual([]);
        expect(J(g.state)).toBe(s0);
    });

    it('急報を待つ間に段階が変わった（確認用の話しかけで軍議へ）：もう起こさない', async () => {
        const { g, view, world } = await newGame();
        void g.interact('tadakatsu');
        (await next(view, 'script')).answer('open_council');
        await flush();
        expect(g.townEventPending).toBeNull();
        void world;
    });
});

// ================================================================ 探索の場面（explore/world.ts）：入れ替えない・後の歩き・話すときの向き直り

function fakeElement(tag = 'div'): Record<string, unknown> {
    const children: unknown[] = [];
    const classes = new Set<string>();
    return {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        dataset: {},
        style: {},
        children,
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
        },
        appendChild: (c: unknown) => children.push(c),
        append: (...c: unknown[]) => children.push(...c),
        remove: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
        width: 0,
        height: 0,
    };
}

async function makeWorld() {
    const g = globalThis as Record<string, unknown>;
    g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body') };
    g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
    const { ExploreWorld } = await import('../proto3d/src/explore/world');
    const camera = new THREE.PerspectiveCamera(48, 2, 0.1, 2000);
    camera.position.set(0.3, 30, 0);
    camera.lookAt(0.3, 0, 0);
    const hero = createHero(0.3, REPORT_LINE_Z - 0.05, Math.PI);
    hero.speed = 1.55;
    const orbit = { yaw: 0.2, pitch: 0.1, dist: 2.1 };
    const poses: { x: number; z: number; heading: number }[] = [];
    const host = {
        scene: new THREE.Scene(),
        camera,
        overlay: fakeElement() as unknown as HTMLElement,
        hero,
        low: true,
        load: () => Promise.reject(new Error('素材なし（テスト）')),
        prepare: () => undefined,
        setHeroPose: (p: { x: number; z: number; heading: number }) => {
            poses.push(p);
            hero.x = p.x;
            hero.z = p.z;
            hero.heading = p.heading;
        },
        setControl: () => undefined,
        setRenderPaused: () => undefined,
        setExtraColliders: () => undefined,
        onFrame: () => undefined,
        viewSize: () => ({ w: 800, h: 400 }),
        orbit,
        setCameraShot: () => undefined,
        renderOnce: () => undefined,
        setLookHandler: () => undefined,
        setHeroGaze: () => undefined,
    };
    const world = new ExploreWorld(host as never);
    await world.preload();
    const full = ieyasuCastFor(newIeyasuGame());
    return { world, hero, orbit, poses, full, pending: full.filter((c) => c.id !== 'oda_envoy' && c.id !== 'asai_envoy') };
}

/** 立つ会話の相手を描く層（castActors）へ渡した時刻と人の名前の鍵を覚える（確かめ用に、world の中の層の setPeople を包む） */
function spyCastActors(world: object): { time: number; keys: string[] }[] {
    const layer = (world as { castActors: { setPeople: (list: { key: string }[], time: number, ...rest: unknown[]) => void } }).castActors;
    const calls: { time: number; keys: string[] }[] = [];
    const orig = layer.setPeople.bind(layer);
    layer.setPeople = (list, time, ...rest) => {
        calls.push({ time, keys: list.map((p) => p.key) });
        orig(list, time, ...rest);
    };
    return calls;
}

/** 急報を最後まで見る（演出の時計と探索の毎フレームを交互に）。終われば片付ける */
function watchToEnd(world: { stage(ev: StageEvent | null, t: number, r: boolean): void; frame(dt: number): void }, ev: StageEvent = EV) {
    const E = (ev as Extract<StageEvent, { id: 'street_report' }>).cue.end;
    for (let t = 0; t <= E + 1e-9; t += 0.25) {
        world.stage(ev, Math.min(t, E), false);
        world.frame(0.25);
    }
    world.stage(ev, E, false);
    world.frame(DT);
    world.stage(null, 0, false);
}

describe('探索の場面：急報の人は会話の相手そのもの（入れ替えない）。後の歩き・話すときの向き直り', () => {
    it('見終えた：使者・忠勝は同じ人物のまま話せる位置へ歩く（その間は話せない）。着いた所は置き場所・置き場所の向きで、位置・向きは飛ばない', async () => {
        const { world, hero, orbit, poses, full, pending } = await makeWorld();
        world.setCast(pending as never);
        const orbitBefore = { ...orbit };
        // 本物と同じく、演出の時計（stage）と探索の毎フレーム（frame）を交互に
        for (let t = 0; t <= EV.cue.end + 1e-9; t += 0.25) {
            world.stage(EV, Math.min(t, EV.cue.end), false);
            world.frame(0.25);
        }
        world.stage(EV, EV.cue.end, false);
        world.frame(DT);
        expect(world.eventProbe().linked.sort()).toEqual(['asai_envoy', 'oda_envoy', 'tadakatsu']);
        const heroEnd = { x: hero.x, z: hero.z, heading: hero.heading };
        world.stage(null, 0, false);
        // 主人公はその場・見回しは出来事の前
        expect(poses).toEqual([]);
        expect({ x: hero.x, z: hero.z, heading: hero.heading }).toEqual(heroEnd);
        expect(orbit).toEqual(orbitBefore);
        // 配役に使者が加わる（ゲームが出来事の後に置く）
        world.setCast(full as never);
        let prev = new Map(world.probe().map((p) => [p.id, p]));
        expect(world.castArriving().sort()).toEqual(['asai_envoy', 'oda_envoy', 'tadakatsu']);
        let maxJump = 0;
        let maxTurn = 0;
        let frames = 0;
        while (world.castArriving().length && frames < 60 * 40) {
            world.frame(DT);
            frames++;
            for (const p of world.probe()) {
                const q = prev.get(p.id);
                if (!q) continue;
                maxJump = Math.max(maxJump, Math.hypot(p.at[0] - q.at[0], p.at[1] - q.at[1]));
                maxTurn = Math.max(maxTurn, deg(wrap(p.now - q.now)));
            }
            prev = new Map(world.probe().map((p) => [p.id, p]));
        }
        expect(frames).toBeLessThan(60 * 40);
        expect(maxJump).toBeLessThan(0.05);
        expect(maxTurn).toBeLessThanOrEqual(12);
        world.frame(DT);
        for (const p of world.probe().filter((x) => ['oda_envoy', 'asai_envoy', 'tadakatsu'].includes(x.id))) {
            expect(p.at).toEqual([p.x, p.z]);
            expect(p.now).toBeCloseTo(p.heading, 2);
            expect(p.driven).toBe(false);
        }
    });

    it('飛ばした（途中で終えた）：後の歩きはせず、みな置き場所（使者は話せる位置、忠勝は城門の前）。すぐ話せる', async () => {
        const { world, full, pending } = await makeWorld();
        world.setCast(pending as never);
        world.stage(EV, 0, false);
        world.frame(DT);
        world.stage(EV, 6.2, false);
        world.frame(DT);
        world.stage(null, 0, false);
        world.setCast(full as never);
        world.frame(DT);
        expect(world.castArriving()).toEqual([]);
        for (const p of world.probe().filter((x) => ['oda_envoy', 'asai_envoy', 'tadakatsu'].includes(x.id))) {
            expect(p.at).toEqual([p.x, p.z]);
            expect(p.now).toBeCloseTo(p.heading, 2);
        }
    });

    it('話しかけたとき：主人公は 1 コマで回らず 0.3〜0.5 秒で向き直る（顔はすぐ向け始める）。相手も 1 コマで回らず、足を踏み替えて向き直る', async () => {
        const { world, hero, full } = await makeWorld();
        world.setCast(full as never);
        world.frame(DT);
        hero.x = 1.0;
        hero.z = -5.6;
        hero.heading = 0;
        const target = Math.atan2(-1.5 - hero.x, -7.2 - hero.z);
        world.faceTalk('tadakatsu');
        expect(hero.heading).toBe(0);
        const npc0 = world.probe().find((p) => p.id === 'tadakatsu')!.now;
        let doneAt = -1;
        let npcMax = 0;
        let prevNpc = npc0;
        for (let i = 1; i <= 60; i++) {
            world.frame(DT);
            const n = world.probe().find((p) => p.id === 'tadakatsu')!.now;
            npcMax = Math.max(npcMax, deg(wrap(n - prevNpc)));
            prevNpc = n;
            if (doneAt < 0 && Math.abs(wrap(hero.heading - target)) < 1e-6) doneAt = i * DT;
        }
        expect(doneAt).toBeGreaterThanOrEqual(0.3 - 1e-6);
        expect(doneAt).toBeLessThanOrEqual(0.5 + DT);
        const toHero = Math.atan2(hero.x - -1.5, hero.z - -7.2);
        expect(deg(wrap(prevNpc - toHero))).toBeLessThan(0.5);
        expect(npcMax).toBeLessThan(12);
        expect(world.eventProbe().talkWith).toBe('tadakatsu');
        world.setControl(true);
        expect(world.eventProbe().talkWith).toBeNull();
    });

    it('後の歩き：着いて向き直った人から話せる（忠勝が着いたら、使者がまだ歩いていても忠勝には話せる）。通りの真ん中・広場で始めたとき', async () => {
        for (const plaza of [false, true]) {
            const where = plaza ? '広場（西の脇の道から）' : '通りの真ん中';
            const { world, hero, full, pending } = await makeWorld();
            if (plaza) {
                hero.x = -4.1;
                hero.z = -10;
                hero.heading = Math.PI / 2;
                hero.dirX = 1;
                hero.dirZ = 0;
            }
            world.setCast(pending as never);
            watchToEnd(world);
            world.setCast(full as never);
            expect(world.castArriving().sort(), where).toEqual(['asai_envoy', 'oda_envoy', 'tadakatsu']);
            let free = 0;
            let frames = 0;
            while (world.castArriving().length && frames < 60 * 40) {
                world.frame(DT);
                frames++;
                const a = world.castArriving();
                const tk = world.probe().find((p) => p.id === 'tadakatsu')!;
                if (a.includes('tadakatsu')) continue;
                // 着いた人は置き場所・置き場所の向きの人物（出来事はもう動かしていない）
                expect(tk.at, where).toEqual([tk.x, tk.z]);
                expect(tk.now, where).toBeCloseTo(tk.heading, 2);
                expect(tk.driven, where).toBe(false);
                if (a.length) free++;
            }
            expect(frames, where).toBeLessThan(60 * 40);
            // 忠勝が着いてから使者が着くまで（使者はまだ歩いている。始めた所によって 4〜6.5 秒）、忠勝にはもう話せる
            expect(free / 60, where).toBeGreaterThan(2);
        }
    });

    it('見直し（支度・戦後）を最後まで見た：その段階の城下に立つ人だけが置き場所へ歩いて戻る（飛ばない）。居ない使者は後の歩きに出ず、描かない', async () => {
        for (const [phase, policy] of [
            ['muster', 'asai'],
            ['muster', 'oda'],
            ['aftermath', 'oda'],
        ] as const) {
            const name = `${phase}/${policy}`;
            const st = devIeyasuState(phase, policy);
            const ev = (ieyasuCinematic(st, 'ch1_report')!.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'street_report' }>;
            const cast = ieyasuCastFor(st);
            const ids = new Set(cast.map((c) => c.id as string));
            const present = [...ev.envoys, ev.retainer].filter((p) => p.after !== false).map((p) => p.cast);
            expect(present.length, name).toBe(2);
            const { world } = await makeWorld();
            const drawn = spyCastActors(world);
            world.setCast(cast as never);
            world.frame(DT);
            watchToEnd(world, ev);
            expect(world.castArriving().sort(), name).toEqual([...present].sort());
            const n0 = drawn.length;
            let prev = new Map(world.probe().map((p) => [p.id, p]));
            let maxJump = 0;
            let frames = 0;
            while (world.castArriving().length && frames < 60 * 40) {
                world.frame(DT);
                frames++;
                for (const id of world.castArriving()) expect(present, name).toContain(id);
                for (const p of world.probe()) {
                    const q = prev.get(p.id);
                    if (q) maxJump = Math.max(maxJump, Math.hypot(p.at[0] - q.at[0], p.at[1] - q.at[1]));
                }
                prev = new Map(world.probe().map((p) => [p.id, p]));
            }
            expect(frames, name).toBeLessThan(60 * 40);
            expect(maxJump, name).toBeLessThan(0.05);
            // 後の歩きの間に描いた人は、今の段階の配役の人だけ（居ない使者は場面の終わりで消え、歩かない）
            for (const c of drawn.slice(n0)) for (const k of c.keys) expect(ids.has(k), `${name}：${k}`).toBe(true);
            world.frame(DT);
            for (const p of world.probe().filter((x) => present.includes(x.id))) {
                expect(p.at, `${name} ${p.id}`).toEqual([p.x, p.z]);
                expect(p.now, `${name} ${p.id}`).toBeCloseTo(p.heading, 2);
                expect(p.driven, `${name} ${p.id}`).toBe(false);
            }
        }
    });
});

// ================================================================ ゲームの町人の GLB で動かす（走って来る・止まる・片膝・後の歩き）

describe('ゲームの町人の GLB（hero_v2b）で急報の人を動かす', async () => {
    const gltf = await loadGlb('hero_v2b');
    const cam = new THREE.PerspectiveCamera(150, 1, 0.1, 500);
    cam.position.set(0.3, 40, 0);
    cam.lookAt(0.3, 0, 0);
    cam.updateMatrixWorld();
    type Body = { root: THREE.Object3D; bones: Map<string, THREE.Bone> };
    const peopleOf = (l: ActorLayer) => (l as unknown as { people: Map<string, { body: Body }> }).people;
    const soles = (b: Body) => {
        b.root.updateMatrixWorld(true);
        const out: [number, number, number][] = [];
        for (const n of ['LeftFoot', 'RightFoot']) {
            const fb = b.bones.get(n)!;
            for (const p of [SOLE.heel, SOLE.ball, SOLE.tip]) {
                const w = p.clone().applyMatrix4(fb.matrixWorld);
                out.push([w.x, w.z, w.y - groundY(w.x, w.z)]);
            }
        }
        return out;
    };

    it('着いた足の速さは 0.3 m/秒以下（走りから止まる・向き直り・後の歩き。片膝をつく・立つ間は骨の形を変えるので除く）。片膝は縮めずに腰を下げる', () => {
        const f = new PersonFactory(() => {}, true);
        f.setBase(gltf);
        const l = new ActorLayer('t', f, null, () => ({ w: 800, h: 600 }), 40, true);
        const o = REPORT_DEFAULT_ORIGIN;
        const end = settleT(o);
        const tracks = new Map<string, { frames: [number, number, number][][]; skip: Set<number> }>();
        let kneelHips = Infinity;
        let rootScale: number[] = [];
        for (let i = 0; i * DT <= end; i++) {
            const t = i * DT;
            const people = stageFrame(EV, t, false, [], o).people;
            l.setPeople(people, t, cam);
            for (const [k, a] of peopleOf(l)) {
                let tr = tracks.get(k);
                if (!tr) tracks.set(k, (tr = { frames: [], skip: new Set() }));
                const p = people.find((x) => x.key === k)!;
                const kn = p.act?.kneel ?? 0;
                if (kn > 0 && kn < 1) tr.skip.add(tr.frames.length);
                tr.frames.push(soles(a.body));
                if (k === 'oda_envoy' && kn >= 1) {
                    a.body.root.updateMatrixWorld(true);
                    kneelHips = Math.min(kneelHips, new THREE.Vector3().setFromMatrixPosition(a.body.bones.get('Hips')!.matrixWorld).y - groundY(p.x, p.z));
                    rootScale = [a.body.root.scale.x, a.body.root.scale.y, a.body.root.scale.z, ...a.body.root.children[0]!.scale.toArray()];
                }
            }
        }
        const out: Record<string, { n: number; max: number }> = {};
        // 片膝の間（0〜1 の途中）は骨の形を変えるので測らない（片膝のまま止まっている間・立った後は測る）
        for (const [k, tr] of tracks) {
            const sp: number[] = [];
            for (let i = 1; i < tr.frames.length; i++) {
                if (tr.skip.has(i) || tr.skip.has(i - 1)) continue;
                for (const side of [0, 1]) {
                    const A = tr.frames[i - 1]!.slice(side * 3, side * 3 + 3);
                    const B = tr.frames[i]!.slice(side * 3, side * 3 + 3);
                    const low = (q: [number, number, number][]) => q.reduce((m, c, j) => (c[2] < q[m]![2] ? j : m), 0);
                    if (low(A) !== low(B)) continue;
                    const pa = A[low(A)]!;
                    const pb = B[low(B)]!;
                    if (pa[2] > 0.02 || pb[2] > 0.02 || Math.abs(pb[2] - pa[2]) / DT > 0.15) continue;
                    sp.push(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / DT);
                }
            }
            out[k] = { n: sp.length, max: Math.max(...sp) };
            expect(sp.length, k).toBeGreaterThan(100);
            expect(Math.max(...sp), `${k} の着いた足の速さ`).toBeLessThanOrEqual(0.3);
        }
        // 片膝：腰は 0.6 m より下（立つ腰 0.9 m 前後）。大きさ（根と形の拡大）は縦・横・奥で同じ（縮めていない）
        expect(kneelHips).toBeLessThan(0.62);
        expect(kneelHips).toBeGreaterThan(0.35);
        expect(new Set(rootScale.slice(0, 3)).size).toBe(1);
        expect(new Set(rootScale.slice(3)).size).toBe(1);
        expect(Object.keys(KNEEL.bones).length).toBeGreaterThan(8);
        void out;
    }, 120_000);
});
