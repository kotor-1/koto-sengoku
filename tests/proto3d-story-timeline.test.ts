/**
 * 演出の時計と、時刻 t の純粋な関数（proto3d/src/story/timeline.ts）。
 * 時刻 → 場面・字幕・強調・出した情報の札。一時停止・飛ばし・見直しで同じ t なら同じ結果。1 コマの上限。台本の点検。
 */
import { describe, expect, it } from 'vitest';
import {
    CineClock,
    FRAME_CAP_SEC,
    PREV_RESTART_SEC,
    beatIndexAt,
    captionAt,
    captionNeedSec,
    frameAt,
    highlightAt,
    infoAt,
    mapFrameAt,
    orderedBeats,
    specProblems,
} from '../proto3d/src/story/timeline';
import { sampleCineSpec } from '../proto3d/src/story/sample';
import type { CineMapBeat, CineSpec } from '../proto3d/src/story/types';

const spec = sampleCineSpec('ch1_intro');

describe('時刻 → 場面・字幕・情報の札', () => {
    it('場面：始まりが t 以下で一番遅い場面（境目はその場面の頭）', () => {
        const beats = orderedBeats(spec);
        expect(beatIndexAt(beats, 0)).toBe(0);
        expect(beatIndexAt(beats, 9.99)).toBe(0);
        expect(beatIndexAt(beats, 10)).toBe(1);
        expect(beatIndexAt(beats, 25)).toBe(2);
        expect(beatIndexAt(beats, 32)).toBe(3);
    });
    it('場面の並びが台本で前後していても、始まりの順に並べる', () => {
        const s: CineSpec = { ...spec, beats: [...spec.beats].reverse() };
        expect(orderedBeats(s).map((b) => b.start)).toEqual([0, 10, 18, 26]);
        expect(frameAt(s, 12, false).beat.kind).toBe('stage');
    });
    it('字幕：出ている間だけ。出ていない間は null。話し手の名前も返す', () => {
        expect(captionAt(spec, 0.2)).toBeNull();
        expect(captionAt(spec, 1)?.text).toContain('いつ・どこ');
        expect(captionAt(spec, 4.6)).toBeNull();
        expect(captionAt(spec, 11)?.speaker).toBe('使者');
        expect(captionAt(spec, 31.5)).toBeNull();
    });
    it('情報の札：その時刻までに出した物（決まった順）', () => {
        expect(infoAt(spec, 0)).toEqual([]);
        expect(infoAt(spec, 0.5)).toEqual(['when', 'where']);
        expect(infoAt(spec, 7)).toEqual(['when', 'where', 'ally', 'crisis']);
        expect(infoAt(spec, 32)).toEqual(['when', 'where', 'ally', 'prev', 'crisis', 'decide']);
    });
    it('見出し：地図の場面の見出し。3D の場面では前の地図の場面の見出し', () => {
        expect(frameAt(spec, 1, false).heading).toBe('確かめ用・ある年の城下');
        expect(frameAt(spec, 12, false).heading).toBe('確かめ用・ある年の城下');
        const noHead: CineSpec = { ...spec, beats: spec.beats.map((b) => (b.kind === 'map' ? { ...b, scene: { ...b.scene, heading: undefined } } : b)) };
        expect(frameAt(noHead, 12, false).heading).toBe(spec.title);
    });
    it('3D の場面：出来事と、場面の始めからの秒', () => {
        const f = frameAt(spec, 13.5, false);
        expect(f.map).toBeNull();
        expect(f.stage).toEqual({ event: { id: 'envoys_arrive', envoys: [{ look: 'oda_envoy', name: '東の使者' }] }, local: 3.5 });
    });
    it('t は 0〜長さに収める（終わりで ended）', () => {
        expect(frameAt(spec, -5, false).t).toBe(0);
        expect(frameAt(spec, 999, false).t).toBe(32);
        expect(frameAt(spec, 32, false).ended).toBe(true);
        expect(frameAt(spec, Number.NaN, false).t).toBe(0);
    });
});

describe('地図の場面：現れ方と強調', () => {
    const beat = spec.beats[0] as CineMapBeat;
    it('現れる時刻の前は hidden、現れている途中は appearing（割合）、後は shown', () => {
        expect(mapFrameAt(beat, 1, false).places['east']).toEqual({ state: 'hidden', progress: 0, hl: false });
        const mid = mapFrameAt(beat, 1.8, false).places['east']!;
        expect(mid.state).toBe('appearing');
        expect(mid.progress).toBeCloseTo(0.5, 5);
        expect(mapFrameAt(beat, 3, false).places['east']!.state).toBe('shown');
        // 線は伸びる（1.2 秒）
        const r = mapFrameAt(beat, 6.6, false).routes['r_threat']!;
        expect(r.state).toBe('appearing');
        expect(r.progress).toBeCloseTo(0.5, 5);
    });
    it('現れる時刻を省いた物は始めからある', () => {
        expect(mapFrameAt(beat, 0, false).places['home']).toEqual({ state: 'shown', progress: 1, hl: true });
    });
    it('動きを減らす：途中が無く、現れる時刻にそのまま出る（位置は変えない）', () => {
        expect(mapFrameAt(beat, 1.8, true).places['east']).toEqual({ state: 'shown', progress: 1, hl: false });
        expect(mapFrameAt(beat, 1.4, true).places['east']!.state).toBe('hidden');
        expect(mapFrameAt(beat, 6.1, true).routes['r_threat']!.state).toBe('shown');
    });
    it('強調の切り替え：時刻ごと。無ければ scene.highlight', () => {
        expect(highlightAt(beat, 0)).toEqual(['home']);
        expect(highlightAt(beat, 4.9)).toEqual(['home']);
        expect(highlightAt(beat, 5)).toEqual(['field', 'r_threat']);
        const f = mapFrameAt(beat, 6, false);
        expect(f.places['field']!.hl).toBe(true);
        expect(f.places['home']!.hl).toBe(false);
        expect(f.routes['r_threat']!.hl).toBe(true);
        const third = spec.beats[2] as CineMapBeat;
        expect(highlightAt(third, 3)).toEqual(['village']);
    });
});

describe('時計：実時間・一時停止・次／前の場面・スキップ・見直し', () => {
    it('実時間で進む。1 コマの上限は 1 秒（隠れていた後に大きく飛ばない）', () => {
        const c = new CineClock(spec);
        c.tick(0.25);
        c.tick(0.25);
        expect(c.t).toBeCloseTo(0.5, 9);
        c.tick(30);
        expect(c.t).toBeCloseTo(0.5 + FRAME_CAP_SEC, 9);
        c.tick(-1);
        c.tick(Number.NaN);
        expect(c.t).toBeCloseTo(1.5, 9);
    });
    it('一時停止の間は進まない。再開すれば続きから', () => {
        const c = new CineClock(spec);
        c.tick(0.9);
        c.setPaused(true);
        for (let i = 0; i < 100; i++) c.tick(0.016);
        expect(c.t).toBeCloseTo(0.9, 9);
        c.setPaused(false);
        c.tick(0.1);
        expect(c.t).toBeCloseTo(1.0, 9);
    });
    it('次の場面：次の場面の頭へ。最後の場面なら終わり', () => {
        const c = new CineClock(spec);
        c.tick(0.5);
        c.next();
        expect(c.t).toBe(10);
        c.next();
        c.next();
        expect(c.t).toBe(26);
        c.next();
        expect(c.ended).toBe(true);
        expect(c.t).toBe(32);
    });
    it('前の場面：頭から少し後なら今の場面の頭、すぐなら 1 つ前の場面の頭', () => {
        const c = new CineClock(spec);
        c.seek(10 + PREV_RESTART_SEC + 0.5);
        c.prev();
        expect(c.t).toBe(10);
        c.prev();
        expect(c.t).toBe(0);
        c.prev();
        expect(c.t).toBe(0);
        c.skip();
        c.prev();
        expect(c.ended).toBe(false);
        expect(c.t).toBe(26);
    });
    it('スキップ：終わりへ。止まっていても飛ぶ。その後は進まない', () => {
        const c = new CineClock(spec);
        c.setPaused(true);
        c.skip();
        expect(c.ended).toBe(true);
        expect(c.t).toBe(32);
        c.setPaused(false);
        c.tick(0.5);
        expect(c.t).toBe(32);
    });
    it('同じ t なら同じ形（普通に見た・止めた・飛ばして戻った・見直した）', () => {
        const watch = new CineClock(spec);
        for (let i = 0; i < 200; i++) watch.tick(0.0625); // 12.5 秒
        const paused = new CineClock(spec);
        paused.tick(0.5);
        paused.setPaused(true);
        paused.tick(5);
        paused.setPaused(false);
        for (let i = 0; i < 12; i++) paused.tick(1);
        const jumped = new CineClock(spec);
        jumped.skip();
        jumped.seek(12.5);
        const replay = new CineClock(spec);
        replay.seek(12.5);
        for (const r of [false, true]) {
            const a = watch.frame(r);
            expect(paused.frame(r)).toEqual(a);
            expect(jumped.frame(r)).toEqual(a);
            expect(replay.frame(r)).toEqual(a);
        }
        // 地図の場面でも
        const m1 = new CineClock(spec);
        m1.seek(6.3);
        expect(frameAt(spec, 6.3, false)).toEqual(m1.frame(false));
    });
    it('台本を読むだけ（再生しても台本は変わらない）', () => {
        const s = sampleCineSpec('ch1_intro');
        const before = JSON.stringify(s);
        const c = new CineClock(s);
        for (let i = 0; i < 50; i++) {
            c.tick(0.7);
            c.frame(i % 2 === 0);
        }
        c.prev();
        c.next();
        c.skip();
        expect(JSON.stringify(s)).toBe(before);
    });
    it('場面の無い台本は作れない', () => {
        expect(() => new CineClock({ ...spec, beats: [] })).toThrow();
    });
});

describe('台本の点検（specProblems）', () => {
    it('確かめ用の台本は決まりを満たす', () => {
        expect(specProblems(sampleCineSpec('ch1_intro'))).toEqual([]);
        expect(specProblems(sampleCineSpec('departure'))).toEqual([]);
        expect(specProblems(sampleCineSpec('return'))).toEqual([]);
    });
    it('字幕の時間が短い・長すぎる・長さの目安の外・隙間・地図に無い id を見つける', () => {
        const bad: CineSpec = {
            ...spec,
            duration: 50,
            beats: [{ ...(spec.beats[0] as CineMapBeat), highlights: [{ at: 1, ids: ['nowhere'] }] }, { ...spec.beats[2]!, start: 20 } as CineMapBeat],
            captions: [
                { start: 0, end: 1, text: '短すぎる' },
                { start: 2, end: 30, text: 'あ'.repeat(70) },
            ],
        };
        const p = specProblems(bad).join('\n');
        expect(p).toContain('目安');
        expect(p).toContain('短い');
        expect(p).toContain('60 字');
        expect(p).toContain('隙間');
        expect(p).toContain('nowhere');
        expect(p).toContain('届かない');
    });
    it('字幕に要る時間：文字数 ÷ 8 秒と 2.5 秒の大きい方', () => {
        expect(captionNeedSec({ start: 0, end: 1, text: 'あ'.repeat(8) })).toBe(2.5);
        expect(captionNeedSec({ start: 0, end: 1, text: 'あ'.repeat(40) })).toBe(5);
    });
});
