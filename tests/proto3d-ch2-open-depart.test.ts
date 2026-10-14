/**
 * Version 28 §4.3 の最後の項（docs/v28-town-motion-voice.md §13）：第二章の冒頭の使いの到着・出陣・帰還にも、第一章の町の急報と同じ動きの直しを使う。
 * - 第二章の冒頭：使いは木戸から走って来て、減速して止まり、主人公の方を向いて片膝をついてから言う（主人公は足を踏み替えて振り向く）。
 *   その間に家臣（忠勝）が城門の前の置き場所から歩いて来て、止まってから言う（主人公は使いが話し終えてから家臣へ向き直る）。
 *   使いの言葉の間も主人公が画に入る（主人公の居ない止まった画を続けない）。カメラは 3 つの画で、最後の画は操作の肩越しのカメラで終わる。
 *   使い・家臣は会話の相手そのもの（入れ替えない）：家臣は始めに置き場所に居て、終われば使いと家臣は置き場所へ歩いて行く（瞬間移動しない）。
 *   字幕は今までと同じ文・同じ順。長さは決まり（12〜26 秒）の中。
 * - 出陣：主人公は城門の前で号令し、隊列の道を空けて脇に立って見送る。会話の相手の人物は隠さず、置き場所で隊列の方を向き、旗に礼をする。
 *   隊列は号令の後に歩き出し、主人公・人物に重ならない。兵ごとの位相（M2）は変わらない。カメラは切らずにゆっくり引く。
 * - 帰還：会話の相手を隠さない（今までどおり）。長さは決まり（8〜15 秒）の中。
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
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { ieyasu2CastFor } from '../proto3d/src/campaign/ieyasu1570/chapter2/scenario';
import { voiceSecFor } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import type { CastMember } from '../proto3d/src/explore/cast';
import {
    ENTRY_FOLLOW_SHOT,
    MESSENGER_LEAD,
    afterWalkEnd,
    arrivingCast,
    columnGait,
    departLayout,
    messengerLayout,
    messengerRetainerEarliest,
    shotsOver,
    stageFrame,
    type MessengerReportEvent,
    type StageCastInfo,
    type StageOrigin,
    type StageShot,
} from '../proto3d/src/explore/stage';
import { ActorLayer, KNEEL } from '../proto3d/src/explore/actors';
import { PersonFactory } from '../proto3d/src/explore/people';
import { SOLE } from '../proto3d/src/game/legs';
import { blockersForTest } from '../proto3d/src/game/follow';
import { START, cameraBlockers, colliders, groundY, type Rect } from '../proto3d/src/layout';
import { ENTRY_POSE } from '../proto3d/src/town/spots';
import type { CineMoment, CineSpec, SituationView, StageEvent } from '../proto3d/src/story/types';
import { CINE_LENGTH_RANGE, specProblems } from '../proto3d/src/story/timeline';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';
import { IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import { ch1Cases, ch2Starts, ch2Cases, ch2Muster, ch2Battle, ch2Aftermath } from './proto3d-ieyasu-story-states';
import { loadGlb } from './proto3d-hero-rig';

const DT = 1 / 60;
const J = (v: unknown) => JSON.stringify(v);
const deg = (r: number) => (Math.abs(r) * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ALL = colliders();
const inside = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
const BOXES = blockersForTest(cameraBlockers());
const dirOf = (s: StageShot) => new THREE.Vector3(s.tx - s.px, s.ty - s.py, s.tz - s.pz).normalize();

const CH1 = ch1Cases();
const CH2_STARTS = ch2Starts(CH1);
const OPENS = CH2_STARTS.map((c) => ({ c, spec: ieyasuCinematic(c.state, 'ch2_open')! }));
const msgBeat = (spec: CineSpec) => spec.beats.find((b) => b.kind === 'stage' && b.event.id === 'messenger_arrive')!;
const msgEvent = (spec: CineSpec) => (msgBeat(spec) as { event: StageEvent }).event as MessengerReportEvent;
const castInfo = (s: Ieyasu2State): StageCastInfo[] => ieyasu2CastFor(s).map((m) => ({ id: m.id, kind: m.kind, ...(m.look ? { look: m.look } : {}), x: m.x, z: m.z, heading: m.heading }));
/** 方針ごとに 1 つ（A・B・C。援兵の有る・無い） */
const SAMPLES = (() => {
    const out: typeof OPENS = [];
    for (const p of ['oda', 'asai', 'home']) {
        for (const rein of [false, true]) {
            const hit = OPENS.find(({ c, spec }) => c.state.policy === p && spec.beats.some((b) => b.kind === 'stage' && b.event.id === 'reinforcement_arrive') === rein);
            if (hit) out.push(hit);
        }
    }
    return out;
})();
/** 出来事の後の歩きが終わる時刻（settled）まで、60 コマ/秒で */
function framesOf(ev: MessengerReportEvent, cast: StageCastInfo[] = []) {
    const L = messengerLayout(ev);
    const out: { t: number; f: ReturnType<typeof stageFrame> }[] = [];
    for (let i = 0; i * DT <= L.settledAt + 0.5; i++) out.push({ t: i * DT, f: stageFrame(ev, i * DT, false, cast) });
    return out;
}

// ================================================================ 台本

describe('第二章の冒頭の台本：同じ字幕・同じ順。使いの急報と家臣の一言は 1 つの場面', () => {
    it('すべての組み合わせ：台本の決まりどおり・長さは 12〜26 秒・字幕は切れ目なく、使い 2 つ →（A・B は地の文）→ 家臣の順', () => {
        expect(OPENS.length).toBeGreaterThan(50);
        const [lo, hi] = CINE_LENGTH_RANGE.ch2_open;
        for (const { c, spec } of OPENS) {
            expect(specProblems(spec), c.name).toEqual([]);
            expect(spec.duration, c.name).toBeGreaterThanOrEqual(lo);
            expect(spec.duration, c.name).toBeLessThanOrEqual(hi);
            for (let i = 1; i < spec.captions.length; i++) expect(spec.captions[i]!.start, c.name).toBeCloseTo(spec.captions[i - 1]!.end, 5);
            const b = msgBeat(spec);
            expect(b, c.name).toBe(spec.beats[spec.beats.length - 1]);
            const caps = spec.captions.filter((x) => x.start >= b.start + MESSENGER_LEAD - 1e-6);
            const ev = msgEvent(spec);
            const names = caps.map((x) => x.speaker ?? '');
            const narration = c.state.policy === 'home' ? [] : [''];
            expect(names, c.name).toEqual([ev.name, ev.name, ...narration, '忠勝']);
            expect(caps[caps.length - 1]!.text).toBe('軍議を開きましょう。城門の前でお待ちします。');
            // 声の付いた字幕は声の長さ以上（声を途中で切らない）
            for (const x of caps) if (x.voice) expect(x.end - x.start + 1e-6, `${c.name}：${x.text}`).toBeGreaterThanOrEqual(Math.ceil(voiceSecFor(x.voice) * 10) / 10 - 1e-6);
        }
    });

    it('使いの最初の台詞は場面の始めから MESSENGER_LEAD 秒（走って来て止まってから）。家臣の台詞は、城門の前から歩いて着ける時刻より後', () => {
        for (const { c, spec } of OPENS) {
            const b = msgBeat(spec);
            const ev = msgEvent(spec);
            const caps = spec.captions.filter((x) => x.start >= b.start - 1e-6);
            expect(caps[0]!.start - b.start, c.name).toBeCloseTo(MESSENGER_LEAD, 5);
            expect(ev.report.cue.messenger[0]![0]).toBe(MESSENGER_LEAD);
            const ret = caps[caps.length - 1]!;
            expect(ret.start - b.start, c.name).toBeCloseTo(ev.report.cue.retainer[0], 5);
            expect(ev.report.cue.retainer[0] + 1e-6, c.name).toBeGreaterThanOrEqual(messengerRetainerEarliest(ev.report.retainer.spot));
            expect(ev.report.cue.end, c.name).toBeCloseTo(b.end - b.start, 5);
        }
    });

    it('長さの決まりを超えるときだけ、使いの場面を前の場面の終わりより早く始める（前の場面の画は 2.5 秒以上・前の字幕は使いが来る間も出たまま）', () => {
        let early = 0;
        for (const { c, spec } of OPENS) {
            const b = msgBeat(spec);
            const before = spec.captions.filter((x) => x.start < b.start - 1e-6);
            const prevCap = before[before.length - 1]!;
            const prevBeat = spec.beats[spec.beats.indexOf(b) - 1]!;
            expect(prevBeat.end - prevBeat.start, c.name).toBeGreaterThanOrEqual(2.5);
            // 前の字幕は使いの最初の台詞まで
            expect(prevCap.end, c.name).toBeCloseTo(b.start + MESSENGER_LEAD, 5);
            if (spec.duration > CINE_LENGTH_RANGE.ch2_open[1] - 0.05) early++;
        }
        expect(early).toBeGreaterThan(0);
    });

    it('使い・家臣は会話の相手そのもの（第二章の探索の配役と同じ id・見た目・置き場所・向き）。使いは演出の中で町へ来る相手', () => {
        for (const { c, spec } of OPENS) {
            const ev = msgEvent(spec);
            const cast = ieyasu2CastFor(c.state);
            const m = cast.find((x) => x.id === ev.report.messenger.cast)!;
            const r = cast.find((x) => x.id === ev.report.retainer.cast)!;
            expect(m.look).toBe(ev.look);
            expect(ev.report.messenger.spot).toEqual([m.x, m.z, m.heading]);
            expect(r.look).toBe(ev.report.retainer.look);
            expect(ev.report.retainer.spot).toEqual([r.x, r.z, r.heading]);
            expect(arrivingCast(spec.beats.flatMap((b) => (b.kind === 'stage' ? [b.event] : [])))).toEqual(['envoy']);
            expect(afterWalkEnd(ev)).toBe(ev.report.cue.end);
        }
    });
});

// ================================================================ 動き（出来事の形。60 コマ/秒）

describe('第二章の冒頭の使い・家臣・主人公の動き', () => {
    it('使いは減速して止まってから言う（主人公から 1.8〜2.6 m・主人公の方を向いて片膝）。家臣は始めに置き場所に居て、言う 0.3 秒以上前に止まり、主人公の方を向く', () => {
        for (const { c, spec } of SAMPLES) {
            const ev = msgEvent(spec);
            const cast = castInfo(c.state);
            const L = messengerLayout(ev);
            const line1 = ev.report.cue.messenger[0]![0];
            const lineR = ev.report.cue.retainer[0];
            const at = (t: number, key: string) => stageFrame(ev, t, false, cast).people.find((p) => p.key === key)!;
            // 使い：言う 0.1 秒前から止まっている。速さは走りから 0 へなめらかに（1 コマで止まらない）
            const m0 = at(line1 - 0.1, 'envoy');
            const m1 = at(line1, 'envoy');
            expect(m0.moving, c.name).toBe(0);
            expect([m0.x, m0.z]).toEqual([m1.x, m1.z]);
            const d = Math.hypot(m1.x - ENTRY_POSE.x, m1.z - ENTRY_POSE.z);
            expect(d).toBeGreaterThan(1.8);
            expect(d).toBeLessThan(2.6);
            const mk = at(line1 + 0.6, 'envoy');
            expect(deg(wrap(mk.heading - Math.atan2(ENTRY_POSE.x - mk.x, ENTRY_POSE.z - mk.z)))).toBeLessThan(3);
            expect(mk.act?.kneel ?? 0).toBeGreaterThan(0.95);
            let maxDv = 0;
            let pz = at(0, 'envoy').z;
            let pv = (pz - at(DT, 'envoy').z) / DT;
            for (let t = DT; t <= line1; t += DT) {
                const z = at(t, 'envoy').z;
                const v = (pz - z) / DT;
                maxDv = Math.max(maxDv, Math.abs(v - pv));
                pz = z;
                pv = v;
            }
            expect(maxDv, `${c.name}：使いの 1 コマの速さの変化`).toBeLessThan(0.2);
            // 始めは木戸の外寄り（主人公の南 3 m より遠く）を走っている
            expect(at(0, 'envoy').z - ENTRY_POSE.z).toBeGreaterThan(3);
            expect(at(0, 'envoy').run ?? 0).toBeGreaterThan(0.5);
            // 家臣：始めは置き場所・置き場所の向き（瞬間移動しない）
            const r0 = at(0, 'tadakatsu');
            const rc = cast.find((x) => x.id === 'tadakatsu')!;
            expect([r0.x, r0.z, r0.heading]).toEqual([rc.x, rc.z, Math.round(rc.heading * 1e6) / 1e6]);
            const rA = at(lineR - 0.3, 'tadakatsu');
            const rB = at(lineR, 'tadakatsu');
            expect(rA.moving, c.name).toBe(0);
            expect([rA.x, rA.z]).toEqual([rB.x, rB.z]);
            const dr = Math.hypot(rB.x - ENTRY_POSE.x, rB.z - ENTRY_POSE.z);
            expect(dr).toBeGreaterThan(1.5);
            expect(dr).toBeLessThan(2.6);
            expect(deg(wrap(rB.heading - Math.atan2(ENTRY_POSE.x - rB.x, ENTRY_POSE.z - rB.z)))).toBeLessThan(5);
            expect(L.retSpeed).toBeLessThanOrEqual(1.9 + 1e-9);
            // 家臣は言い終えて軽く礼をする
            let bow = 0;
            for (let t = ev.report.cue.retainer[1]; t < ev.report.cue.end + 2; t += 0.05) bow = Math.max(bow, at(t, 'tadakatsu').act?.bow ?? 0);
            expect(bow).toBeGreaterThan(0.9);
        }
    });

    it('主人公は場面の間ずっと町の入口に立ち（画から消えない）、走って来る使いへ振り向き、使いが話し終えてから家臣へ向き直る。顔と目線は話し手へ', () => {
        for (const { c, spec } of SAMPLES) {
            const ev = msgEvent(spec);
            const L = messengerLayout(ev);
            const E = ev.report.cue.end;
            for (let t = 0; t <= E; t += 0.1) {
                const f = stageFrame(ev, t, false);
                expect(f.hero, `${c.name} t=${t}`).not.toBeNull();
                expect([f.hero!.x, f.hero!.z]).toEqual([ENTRY_POSE.x, ENTRY_POSE.z]);
            }
            const line1 = ev.report.cue.messenger[0]![0];
            const toMsg = Math.atan2(L.messenger[0] - ENTRY_POSE.x, L.messenger[1] - ENTRY_POSE.z);
            const toRet = Math.atan2(L.retainer[0] - ENTRY_POSE.x, L.retainer[1] - ENTRY_POSE.z);
            expect(deg(wrap(stageFrame(ev, line1, false).hero!.heading - toMsg)), c.name).toBeLessThan(2);
            // 使いの声の終わりまでは使いを向いたまま
            const msgEnd = ev.report.cue.messenger[1]![1];
            expect(deg(wrap(stageFrame(ev, msgEnd, false).hero!.heading - toMsg)), c.name).toBeLessThan(2);
            expect(L.turnR).toBeGreaterThanOrEqual(msgEnd);
            expect(deg(wrap(stageFrame(ev, ev.report.cue.retainer[0], false).hero!.heading - toRet)), c.name).toBeLessThan(2);
            const g1 = stageFrame(ev, line1 + 0.5, false).heroGaze!;
            expect(Math.hypot(g1.x - L.messenger[0], g1.z - L.messenger[1])).toBeLessThan(0.05);
            expect(g1.y).toBeLessThan(1.2);
            const g2 = stageFrame(ev, ev.report.cue.retainer[0] + 0.5, false).heroGaze!;
            expect(Math.hypot(g2.x - L.retainer[0], g2.z - L.retainer[1])).toBeLessThan(0.05);
        }
    });

    it('人・主人公の向きは 1 コマ（60 コマ/秒）で 12° を超えて変わらず、位置も 1 コマで飛ばない（出来事の後の歩きを含む）。当たり判定の中を通らない', () => {
        for (const { c, spec } of SAMPLES) {
            const ev = msgEvent(spec);
            const fr = framesOf(ev, castInfo(c.state));
            let maxTurn = 0;
            let maxHero = 0;
            let maxStep = 0;
            for (let i = 1; i < fr.length; i++) {
                const a = fr[i - 1]!.f;
                const b = fr[i]!.f;
                for (const p of b.people) {
                    const q = a.people.find((x) => x.key === p.key);
                    if (!q) continue;
                    maxTurn = Math.max(maxTurn, deg(wrap(p.heading - q.heading)));
                    maxStep = Math.max(maxStep, Math.hypot(p.x - q.x, p.z - q.z));
                    for (const r of ALL) if (inside(r, p.x, p.z)) throw new Error(`${c.name} t=${fr[i]!.t.toFixed(2)} ${p.key} が当たり判定 ${J(r)} の中`);
                }
                if (a.hero && b.hero) maxHero = Math.max(maxHero, deg(wrap(b.hero.heading - a.hero.heading)));
            }
            expect(maxTurn, c.name).toBeLessThanOrEqual(12);
            expect(maxHero, c.name).toBeLessThanOrEqual(12);
            expect(maxStep, c.name).toBeLessThan(0.07);
        }
    });

    it('出来事の後：使いは立ち上がって、家臣は礼の後に、置き場所へ歩いて着き、置き場所の向きへ向き直る（settled の後は置き場所の人物のまま）', () => {
        for (const { c, spec } of SAMPLES) {
            const ev = msgEvent(spec);
            const L = messengerLayout(ev);
            const E = ev.report.cue.end;
            expect(L.settledAt - E, c.name).toBeLessThan(20);
            const last = stageFrame(ev, L.settledAt - DT, false);
            const end = stageFrame(ev, L.settledAt, false);
            expect(last.settled).toBe(false);
            expect(end.settled).toBe(true);
            for (const who of [ev.report.messenger, ev.report.retainer]) {
                const a = last.people.find((p) => p.key === who.cast)!;
                const b = end.people.find((p) => p.key === who.cast)!;
                expect([b.x, b.z]).toEqual([who.spot[0], who.spot[1]]);
                expect(Math.hypot(a.x - b.x, a.z - b.z), `${c.name} ${who.cast}`).toBeLessThan(0.01);
                expect(deg(wrap(a.heading - b.heading)), `${c.name} ${who.cast}`).toBeLessThan(0.5);
                expect(a.moving).toBe(0);
            }
            // 使いは場面の後に立ち上がる（片膝 0 になってから歩き出す）
            for (let t = E; t < E + 3; t += DT) {
                const m = stageFrame(ev, t, false).people.find((p) => p.key === 'envoy')!;
                if (m.moving > 0) expect(m.act?.kneel ?? 0).toBe(0);
            }
            // 場面の間は名札あり、後は名札なし
            expect(stageFrame(ev, 3, false).people.every((p) => p.label)).toBe(true);
            expect(stageFrame(ev, E + 1, false).people.every((p) => !p.label)).toBe(true);
        }
    });

    it('動きを減らす：人は止まる所に現れ（歩かない）、カメラは動かない。主人公は画に入る', () => {
        const { spec } = SAMPLES[0]!;
        const ev = msgEvent(spec);
        const f0 = stageFrame(ev, 0, true);
        for (const t of [0, 1, 5, 10, ev.report.cue.end]) {
            const f = stageFrame(ev, t, true);
            expect(f.shot).toEqual(f0.shot);
            expect(f.people.map((p) => [p.key, p.x, p.z, p.moving])).toEqual(f0.people.map((p) => [p.key, p.x, p.z, p.moving]));
            expect(f.hero).not.toBeNull();
        }
    });
});

describe('第二章の冒頭のカメラ：3 つの画（話す人と聞く人）。最後は操作の肩越しのカメラで終わる', () => {
    it('切り替えは 2 回、画の中の動きはゆっくり（毎秒 0.5 m・12° まで）、カメラ除けの箱に入らない、人に 0.75 m より近づかない。主人公はいつも画の中（見る向きから 35° 以内）', () => {
        for (const { c, spec } of SAMPLES) {
            const ev = msgEvent(spec);
            const E = ev.report.cue.end;
            const list = shotsOver(ev, false, E + 1, 0.05);
            let cuts = 0;
            let maxMove = 0;
            let maxAng = 0;
            const v = new THREE.Vector3();
            for (let i = 0; i < list.length; i++) {
                const { t, shot } = list[i]!;
                v.set(shot.px, shot.py, shot.pz);
                for (const b of BOXES) if (b.containsPoint(v)) throw new Error(`${c.name} t=${t}：カメラが箱の中`);
                const f = stageFrame(ev, t, false);
                for (const p of f.people) expect(Math.hypot(p.x - shot.px, p.z - shot.pz), `${c.name} t=${t} ${p.key}`).toBeGreaterThan(0.75);
                const toHero = new THREE.Vector3(ENTRY_POSE.x - shot.px, 1.3 - shot.py, ENTRY_POSE.z - shot.pz).normalize();
                expect(deg(toHero.angleTo(dirOf(shot))), `${c.name} t=${t}：主人公が画の外`).toBeLessThan(35);
                if (i === 0) continue;
                const a = list[i - 1]!.shot;
                const jump = Math.hypot(shot.px - a.px, shot.py - a.py, shot.pz - a.pz);
                const ang = deg(dirOf(a).angleTo(dirOf(shot)));
                if (jump > 0.2 || ang > 5) {
                    cuts++;
                    continue;
                }
                maxMove = Math.max(maxMove, jump / 0.05);
                maxAng = Math.max(maxAng, ang / 0.05);
            }
            expect(cuts, c.name).toBe(2);
            expect(maxMove, c.name).toBeLessThan(0.5);
            expect(maxAng, c.name).toBeLessThan(12);
            // 最後の画は操作の肩越しのカメラ（町の入口・見回し北）と同じ所で終わる
            const end = stageFrame(ev, E, false).shot;
            for (const k of ['px', 'py', 'pz', 'tx', 'ty', 'tz'] as const) expect(end[k], k).toBeCloseTo(ENTRY_FOLLOW_SHOT[k], 6);
            // 画の切り替えは、使いの使命の台詞の始めと、家臣が着く 2 秒より前
            const L = messengerLayout(ev);
            expect(L.cuts[0]).toBe(ev.report.cue.messenger[1]![0]);
            expect(L.cuts[1]).toBeLessThanOrEqual(L.retArrive - 2 + 1e-9);
        }
    });
});

// ================================================================ 探索の場面（本物の ExploreWorld・偽の描画の口）

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

async function makeWorld(state: Ieyasu2State) {
    const g = globalThis as Record<string, unknown>;
    g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body') };
    g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
    const { ExploreWorld } = await import('../proto3d/src/explore/world');
    const { createHero } = await import('../proto3d/src/game/motion');
    const camera = new THREE.PerspectiveCamera(48, 2, 0.1, 2000);
    const hero = createHero(ENTRY_POSE.x, ENTRY_POSE.z, ENTRY_POSE.heading);
    const orbit = { yaw: 0, pitch: START.pitch, dist: 2.1 };
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
    const full = ieyasu2CastFor(state);
    return { world, hero, full, pending: full.filter((c) => c.id !== 'envoy') };
}

describe('探索の場面：使い・家臣は会話の相手そのもの（入れ替えない・瞬間移動しない）', () => {
    const { c, spec } = SAMPLES[0]!;
    const ev = msgEvent(spec);
    const E = ev.report.cue.end;

    it('見終えた：使い・家臣は同じ人物のまま置き場所へ歩く（その間は話せない）。位置・向きは 1 コマで飛ばず、着いた所は置き場所・置き場所の向き', async () => {
        const { world, full, pending } = await makeWorld(c.state);
        world.setCast(pending as never);
        world.frame(DT);
        // 家臣は始めに置き場所（演出の前の画と同じ所）
        const before = world.probe().find((p) => p.id === 'tadakatsu')!;
        for (let t = 0; t <= E + 1e-9; t += 0.25) {
            world.stage(ev, Math.min(t, E), false);
            world.frame(0.25);
            if (t === 0) {
                const now = world.probe().find((p) => p.id === 'tadakatsu')!;
                expect(now.at).toEqual(before.at);
            }
        }
        world.stage(ev, E, false);
        world.frame(DT);
        expect(world.eventProbe().linked.sort()).toEqual(['envoy', 'tadakatsu']);
        world.stage(null, 0, false);
        world.setCast(full as never);
        expect(world.castArriving().sort()).toEqual(['envoy', 'tadakatsu']);
        let prev = new Map(world.probe().map((p) => [p.id, p]));
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
        expect(frames).toBeLessThan(60 * 25);
        expect(maxJump).toBeLessThan(0.05);
        expect(maxTurn).toBeLessThanOrEqual(12);
        world.frame(DT);
        for (const p of world.probe().filter((x) => x.id === 'envoy' || x.id === 'tadakatsu')) {
            expect(p.at).toEqual([p.x, p.z]);
            expect(p.now).toBeCloseTo(p.heading, 2);
            expect(p.driven).toBe(false);
        }
    });

    it('飛ばした（途中で終えた）：後の歩きはせず、みな置き場所。すぐ話せる', async () => {
        const { world, full, pending } = await makeWorld(c.state);
        world.setCast(pending as never);
        world.stage(ev, 0, false);
        world.frame(DT);
        world.stage(ev, 6.2, false);
        world.frame(DT);
        world.stage(null, 0, false);
        world.setCast(full as never);
        world.frame(DT);
        expect(world.castArriving()).toEqual([]);
        for (const p of world.probe().filter((x) => x.id === 'envoy' || x.id === 'tadakatsu')) expect(p.at).toEqual([p.x, p.z]);
    });
});

// ================================================================ ゲームの流れ（偽の画面・本物のシナリオと台本）

type Req =
    | { kind: 'title'; answer: (a: TitleAction) => void }
    | { kind: 'ending'; answer: (a?: EndingAction) => void }
    | { kind: 'record'; answer: () => void }
    | { kind: 'cinematic'; spec: CineSpec; opts: CinematicOptions; answer: (r: 'done' | 'skipped') => void };

class View implements GameView {
    reqs: Req[] = [];
    title() {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', answer }));
    }
    script(_s: ScenarioScript, _o: ScriptOptions) {
        return new Promise<string | null>(() => undefined);
    }
    confirm(_o: ConfirmOptions) {
        return new Promise<string>(() => undefined);
    }
    menu() {
        return new Promise<MenuAction>(() => undefined);
    }
    ending() {
        return new Promise<EndingAction | void>((answer) => this.reqs.push({ kind: 'ending', answer }));
    }
    record(_v: ScenarioEndingView) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'record', answer }));
    }
    hud(_i: HudInfo | null) {}
    prompt() {}
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
    situation(_v: SituationView) {
        return new Promise<{ replay?: CineMoment } | void>(() => undefined);
    }
}

class World implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
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
    setHeroPose(p: ExplorePose) {
        this.pose = { ...p };
    }
    setControl() {}
    stage() {}
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

describe('ゲームの流れ：第二章の冒頭の間、使いはまだ城下に居ない（木戸から来る）。冒頭の後は配役に戻る。状態・保存は見ても飛ばしても同じ', () => {
    for (const how of ['done', 'skipped'] as const) {
        it(`第二章へ進む → 結果確認 → 冒頭（${how}）→ 操作`, async () => {
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
            const view = new View();
            const world = new World();
            const g = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
            void g.start();
            (await next(view, 'title')).answer('continue:ieyasu1570');
            (await next(view, 'ending')).answer('next_chapter');
            (await next(view, 'record')).answer();
            const cine = await next(view, 'cinematic');
            expect(cine.spec.moment).toBe('ch2_open');
            const ids = world.cast.map((c) => c.id);
            expect(ids).toContain('tadakatsu');
            expect(ids).not.toContain('envoy');
            const saved = storage.data.get(IEYASU_SAVE_KEY);
            cine.answer(how);
            await flush();
            expect(g.screen).toBe('explore');
            expect(world.cast.map((c) => c.id)).toContain('envoy');
            expect(world.pose).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
            expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(saved);
        });
    }
});

// ================================================================ 出陣・帰還

const GATE_CAST: StageCastInfo[] = [
    { id: 'tadakatsu', kind: 'person', look: 'genzo', x: -2.0, z: -7.4, heading: 2.9 },
    { id: 'envoy', kind: 'person', look: 'tashiro_envoy', x: 2.0, z: -7.1, heading: -2.9 },
    { id: 'ishikawa', kind: 'person', look: 'genzo', x: 5.3, z: -2.4, heading: -Math.PI / 2 },
    { id: 'notice', kind: 'notice', x: 5.5, z: -8.3, heading: -Math.PI / 2 },
    { id: 'gate', kind: 'gate', x: 0, z: -10.9, heading: 0 },
];
/** 城門の輪（半径 1.6 m）に入って出陣を選んだ所の例（南から・斜めから・城門の中から）と、遠くからの見直し */
const GATE_ORIGINS: StageOrigin[] = [
    [0.1, -9.35],
    [-0.9, -9.6],
    [1.3, -10.0],
    [-1.3, -10.0],
    [0.0, -12.0],
    [0.6, -9.4],
    [5.0, 3.0],
].map(([x, z]) => ({ x: x!, z: z!, heading: Math.PI, dirX: 0, dirZ: -1, speed: 1.55, yaw: 0 }));

/** 出陣・帰還の台本（第一章・第二章の、出陣の後の状態） */
const DEPARTS = (() => {
    const out: { name: string; spec: CineSpec }[] = [];
    for (const c of CH1.slice(0, 40)) {
        const d = ieyasuCinematic(c.state, 'departure');
        if (d) out.push({ name: c.name, spec: d });
    }
    for (const c of ch2Cases(CH2_STARTS.slice(0, 12))) {
        const d = ieyasuCinematic(c.state, 'departure');
        if (d) out.push({ name: c.name, spec: d });
    }
    const s2 = ch2Battle(ch2Muster(CH2_STARTS[0]!.state, 'commit'));
    const d2 = ieyasuCinematic(s2, 'departure');
    if (d2) out.push({ name: 'ch2.battle', spec: d2 });
    return out;
})();

describe('出陣：主人公の号令と見送り。会話の相手を隠さない', () => {
    it('台本：出陣の場面に号令の声の終わり（order）。長さは 8〜15 秒・決まりどおり', () => {
        expect(DEPARTS.length).toBeGreaterThan(3);
        for (const { name, spec } of DEPARTS) {
            expect(specProblems(spec), name).toEqual([]);
            const ev = (spec.beats[0] as { event: StageEvent }).event;
            expect(ev.id).toBe('column_depart');
            if (ev.id !== 'column_depart') continue;
            const cap = spec.captions[0]!;
            expect(cap.voice).toBe('depart.hero');
            expect(ev.order, name).toBeGreaterThan(0.8);
            expect(ev.order!, name).toBeLessThan(cap.end);
        }
    });

    it('主人公は号令の間は城門の方を向いて立ち、道を空けて脇へ歩き、隊列は主人公・人物に 0.9 m より近づかない。人・主人公の向きは 1 コマ 12° まで', () => {
        const ev = (DEPARTS[0]!.spec.beats[0] as { event: StageEvent }).event as Extract<StageEvent, { id: 'column_depart' }>;
        const end = DEPARTS[0]!.spec.beats[0]!.end;
        for (const o of GATE_ORIGINS) {
            const L = departLayout(ev.order!, o);
            let minHero = Infinity;
            let minPerson = Infinity;
            let maxTurn = 0;
            let maxHero = 0;
            let prev = stageFrame(ev, 0, false, GATE_CAST, o);
            for (let t = DT; t <= end; t += DT) {
                const f = stageFrame(ev, t, false, GATE_CAST, o);
                expect(f.hero, J(o)).not.toBeNull();
                for (const g of f.figures) {
                    minHero = Math.min(minHero, Math.hypot(g.x - f.hero!.x, g.z - f.hero!.z));
                    for (const p of f.people) minPerson = Math.min(minPerson, Math.hypot(g.x - p.x, g.z - p.z));
                }
                for (const r of ALL) if (inside(r, f.hero!.x, f.hero!.z)) throw new Error(`主人公が当たり判定の中 ${J(o)} t=${t}`);
                maxHero = Math.max(maxHero, deg(wrap(f.hero!.heading - prev.hero!.heading)));
                for (const p of f.people) maxTurn = Math.max(maxTurn, deg(wrap(p.heading - prev.people.find((q) => q.key === p.key)!.heading)));
                prev = f;
            }
            expect(minHero, J(o)).toBeGreaterThan(0.9);
            expect(minPerson, J(o)).toBeGreaterThan(0.9);
            expect(maxHero, J(o)).toBeLessThanOrEqual(12);
            expect(maxTurn, J(o)).toBeLessThanOrEqual(12);
            // 号令の間は動かない（城門の方を向く）・隊列は号令の後に歩き出す
            expect(L.start).toBeGreaterThanOrEqual(ev.order!);
            const f0 = stageFrame(ev, L.stepAt - 0.05, false, GATE_CAST, o);
            expect([f0.hero!.x, f0.hero!.z]).toEqual(Math.hypot(o.x, o.z + 10.9) <= 4 ? [o.x, o.z] : L.from);
            expect(deg(wrap(f0.hero!.heading - Math.atan2(0 - L.from[0], -12 - L.from[1])))).toBeLessThan(2);
            expect(stageFrame(ev, L.start - 0.05, false, GATE_CAST, o).figures.every((x) => x.pose === 'stand')).toBe(true);
            // 終わりは脇で隊列の方を向く
            const fe = stageFrame(ev, end, false, GATE_CAST, o);
            expect([fe.hero!.x, fe.hero!.z]).toEqual(L.aside);
        }
    });

    it('会話の相手の人物は隠さない（会話の相手そのもの：cast）。隊列の方を向き、旗が前を通ると礼。座っている人・城門の輪は今までどおり', () => {
        const ev = (DEPARTS[0]!.spec.beats[0] as { event: StageEvent }).event;
        const cast = [...GATE_CAST, { id: 'sitter', kind: 'person', look: 'genzo', x: -3.1, z: -5.4, heading: Math.PI / 2, pose: 'sit' as const }];
        const o = GATE_ORIGINS[0]!;
        const f = stageFrame(ev, 3, false, cast, o);
        expect(f.hideCast).toEqual(['gate']);
        expect(f.people.map((p) => p.cast).sort()).toEqual(['envoy', 'ishikawa', 'tadakatsu']);
        for (const p of f.people) {
            const c = cast.find((x) => x.id === p.cast)!;
            expect([p.x, p.z, p.look]).toEqual([c.x, c.z, c.look]);
        }
        let bowT = 0;
        let bow = 0;
        for (let t = 0; t < 12; t += 0.05) {
            const p = stageFrame(ev, t, false, cast, o).people.find((x) => x.cast === 'tadakatsu')!;
            if ((p.act?.bow ?? 0) > bow) {
                bow = p.act!.bow!;
                bowT = t;
            }
        }
        expect(bow).toBeGreaterThan(0.9);
        // 礼の時、旗は忠勝の横（z の差 1.5 m 以内）
        const flag = stageFrame(ev, bowT, false, cast, o).banners[0]!;
        expect(Math.abs(flag.z - -7.4)).toBeLessThan(1.5);
        // 隊列の方（道の真ん中の少し北：出て来る城門の側）を向く
        const late = stageFrame(ev, 10, false, cast, o).people.find((x) => x.cast === 'tadakatsu')!;
        expect(deg(wrap(late.heading - Math.atan2(0 - -2.0, -8.2 - -7.4)))).toBeLessThan(1);
    });

    it('カメラ：切らずにゆっくり引く（毎秒 0.5 m・12° まで）。カメラ除けの箱に入らない。主人公の号令の画に城門と主人公が入る', () => {
        for (const { name, spec } of DEPARTS.slice(0, 3)) {
            const ev = (spec.beats[0] as { event: StageEvent }).event;
            const list = shotsOver(ev, false, spec.beats[0]!.end, 0.05, GATE_CAST, GATE_ORIGINS[0]);
            const v = new THREE.Vector3();
            for (let i = 1; i < list.length; i++) {
                const a = list[i - 1]!.shot;
                const b = list[i]!.shot;
                v.set(b.px, b.py, b.pz);
                for (const bx of BOXES) expect(bx.containsPoint(v), name).toBe(false);
                expect(Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz) / 0.05, name).toBeLessThan(0.5);
                expect(deg(dirOf(a).angleTo(dirOf(b))) / 0.05, name).toBeLessThan(12);
            }
            const s0 = list[0]!.shot;
            const toHero = new THREE.Vector3(GATE_ORIGINS[0]!.x - s0.px, 1.3 - s0.py, GATE_ORIGINS[0]!.z - s0.pz).normalize();
            expect(deg(toHero.angleTo(dirOf(s0)))).toBeLessThan(20);
        }
    });

    it('隊列の兵は兵ごとに歩幅と位相が違い、横に並ぶ兵が一斉に上下しない（号令ありの出陣でも）', () => {
        const ev = (DEPARTS[0]!.spec.beats[0] as { event: StageEvent }).event;
        let same = 0;
        let pairs = 0;
        for (let t = 3; t < 9; t += 0.1) {
            const walking = stageFrame(ev, t, false, GATE_CAST, GATE_ORIGINS[0]).figures.filter((x) => x.pose === 'walk');
            for (let i = 0; i < walking.length; i++) {
                for (let j = i + 1; j < walking.length; j++) {
                    const a = walking[i]!;
                    const b = walking[j]!;
                    if (Math.abs((a.x - b.x) * Math.sin(a.heading) + (a.z - b.z) * Math.cos(a.heading)) > 0.3) continue;
                    pairs++;
                    if (Math.abs(Math.abs(Math.sin(a.phase * Math.PI * 2)) - Math.abs(Math.sin(b.phase * Math.PI * 2))) < 0.05) same++;
                }
            }
        }
        expect(pairs).toBeGreaterThan(50);
        expect(same / pairs).toBeLessThan(0.3);
        expect(new Set(Array.from({ length: 24 }, (_, i) => columnGait(i).offset)).size).toBe(24);
    });

    it('動きを減らす：主人公は脇に、人物は隊列の方を向いて、隊列は城門の外に並んで立つ（t によらない）', () => {
        const ev = (DEPARTS[0]!.spec.beats[0] as { event: StageEvent }).event;
        const f0 = stageFrame(ev, 0, true, GATE_CAST, GATE_ORIGINS[0]);
        for (const t of [0, 2, 6, 9]) {
            const f = stageFrame(ev, t, true, GATE_CAST, GATE_ORIGINS[0]);
            expect(f.shot).toEqual(f0.shot);
            expect(f.hero).toEqual(f0.hero);
            expect(f.figures.every((x) => x.pose === 'stand')).toBe(true);
            expect(f.people.map((p) => p.heading)).toEqual(f0.people.map((p) => p.heading));
        }
    });
});

describe('帰還：会話の相手を隠さない。長さは決まりの中', () => {
    it('第一章・第二章の帰還：8〜15 秒・決まりどおり。3D の場面は会話の相手を隠さず、カメラを切らない', () => {
        const specs: { name: string; spec: CineSpec }[] = [];
        for (const c of CH1.slice(0, 30)) {
            const r = ieyasuCinematic(c.state, 'return');
            if (r) specs.push({ name: c.name, spec: r });
        }
        const a2 = ch2Aftermath(ch2Battle(ch2Muster(CH2_STARTS[0]!.state, 'commit')), 'victory');
        const r2 = ieyasuCinematic(a2, 'return');
        if (r2) specs.push({ name: 'ch2', spec: r2 });
        expect(specs.length).toBeGreaterThan(3);
        for (const { name, spec } of specs) {
            expect(specProblems(spec), name).toEqual([]);
            const b = spec.beats.find((x) => x.kind === 'stage')!;
            const ev = (b as { event: StageEvent }).event;
            expect(stageFrame(ev, 3, false, GATE_CAST).hideCast, name).toEqual([]);
            const list = shotsOver(ev, false, b.end - b.start, 0.05, GATE_CAST);
            for (let i = 1; i < list.length; i++) expect(Math.hypot(list[i]!.shot.px - list[i - 1]!.shot.px, list[i]!.shot.pz - list[i - 1]!.shot.pz) / 0.05, name).toBeLessThan(0.5);
        }
    });
});

// ================================================================ ゲームの町人の GLB で動かす（走って来る・止まる・片膝・後の歩き）

describe('ゲームの町人の GLB（hero_v2b）で第二章の冒頭の使い・家臣を動かす', async () => {
    const gltf = await loadGlb('hero_v2b');
    const cam = new THREE.PerspectiveCamera(150, 1, 0.1, 500);
    cam.position.set(0, 40, 4);
    cam.lookAt(0, 0, 4);
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

    it('着いた足の速さは 0.3 m/秒以下（走りから止まる・向き直り・家臣の歩き・後の歩き。片膝をつく・立つ間は除く）', () => {
        const f = new PersonFactory(() => {}, true);
        f.setBase(gltf);
        const l = new ActorLayer('t', f, null, () => ({ w: 800, h: 600 }), 40, true);
        const { spec } = SAMPLES.find((x) => x.c.state.policy === 'home')!;
        const ev = msgEvent(spec);
        const end = messengerLayout(ev).settledAt;
        const tracks = new Map<string, { frames: [number, number, number][][]; skip: Set<number> }>();
        for (let i = 0; i * DT <= end; i++) {
            const t = i * DT;
            const people = stageFrame(ev, t, false).people;
            l.setPeople(people, t, cam);
            for (const [k, a] of peopleOf(l)) {
                let tr = tracks.get(k);
                if (!tr) tracks.set(k, (tr = { frames: [], skip: new Set() }));
                const p = people.find((x) => x.key === k)!;
                const kn = p.act?.kneel ?? 0;
                if (kn > 0 && kn < 1) tr.skip.add(tr.frames.length);
                tr.frames.push(soles(a.body));
            }
        }
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
            expect(sp.length, k).toBeGreaterThan(100);
            expect(Math.max(...sp), `${k} の着いた足の速さ`).toBeLessThanOrEqual(0.3);
        }
        expect(Object.keys(KNEEL.bones).length).toBeGreaterThan(8);
    }, 120_000);
});
