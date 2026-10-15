/**
 * 演出の声を待つ（Version 28 の本番の確かめで見つかった A1）：本番の実時間の録画（第一章の町の急報）で、最初の声（織田の使者）が鳴らなかった
 * （出来事の声の読み込み・ほどきが演出を始めた時に初めて始まり、字幕より 2.9 秒遅れてほどけ、遅れすぎた声は流さない決まりで捨てられた）。
 * - 演出の再生器（ui/cinePlayer.ts）：次の声の字幕の時刻が来ても、その声がまだほどけていなければ、時計をその字幕の境目の手前で止めて
 *   （場面・字幕を進めない）、ほどけるか CINE_VOICE_WAIT_SEC 秒（実時間）たつまで待つ。過ぎたら字幕を出して進める（遅れすぎた声は流さない：
 *   今までどおり）。端末の読み上げ（旧）・ミュート・声 0・音を始めていないときは待たない。一時停止・スキップで待ちをやめる。遅れて鳴らす・
 *   2 度鳴らすことはない。
 * - ゲームの側（campaign/game.ts）：町の出来事を待ち始めたら、その演出の声を先に読んでほどいておく（GameView.prepareCinematic）。
 * 画面は偽の DOM（描かない）。requestAnimationFrame は手で回す（コマの時刻をテストが決める）。音は偽の AudioContext・偽の fetch
 * （tests/proto3d-cine-harness.ts）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CINE_VOICE_WAIT_SEC } from '../proto3d/src/audio/index';
import { voiceCap } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { CH1_REPORT_LINES } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ChapterGame } from '../proto3d/src/campaign/game';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import { REPORT_LINE_Z } from '../proto3d/src/explore/stage';
import { ENTRY_POSE } from '../proto3d/src/town/spots';
import type { CineSpec, StageEvent } from '../proto3d/src/story/types';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { View, World, firstVoiced, flush, frame, next, play, report, resetCine, sound, untilFirstVoice } from './proto3d-cine-harness';

afterEach(() => resetCine());

describe('A1 声を待つ：声の字幕の境目で、声がほどけるまで時計を止める（最長 CINE_VOICE_WAIT_SEC 秒）', () => {
    it('本番の録画の再現：1 コマに約 3 秒かかる端末で、最初の声のほどきが字幕の時刻の約 2.9 秒後に終わる → 声は捨てられず、字幕と同じ処理の中で鳴る', async () => {
        const o = sound();
        const spec = report();
        const c = firstVoiced(spec);
        const p = await play(spec);
        // 字幕の時刻が来るコマまで回す（直す前：そのコマで字幕を出して声を頼む。直した後：字幕の手前で待つ）
        let ts = 1000;
        for (let i = 0; i < 100; i++) {
            frame(ts);
            o.ctx.advance(0.1);
            if (p.probe().caption?.text === c.text || p.layer().dataset.voiceWait === '1') break;
            ts += 100;
        }
        // 次のコマは約 3 秒後。その間にほどきが終わった（音の時計は 2.9 秒進んだ）
        o.ctx.advance(2.9);
        o.fetch.answer();
        await flush();
        ts += 3000;
        frame(ts);
        expect(p.probe().caption?.text).toBe(c.text);
        expect(o.sys.voiceFiles.stats.late).toBe(0);
        expect(o.sys.voiceFiles.stats.played).toBe(1);
        expect(o.sys.voiceFiles.playingId).toBe(c.voice);
        p.modal().press('skip');
        await p.done;
    });

    it('町の急報：最初の声（織田の使者）がまだほどけていない → 字幕の手前で止まり、字幕も声も出さない。ほどけた次のコマで字幕と声が同時に出る（遅れで捨てない）', async () => {
        const o = sound();
        const spec = report();
        const c = firstVoiced(spec);
        expect(c.voice).toBe(CH1_REPORT_LINES[0]);
        expect(c.start).toBeGreaterThan(1);
        const p = await play(spec);
        let ts = await untilFirstVoice(p, spec);
        expect(p.layer().dataset.voiceWait).toBe('1');
        const t0 = p.probe().t!;
        expect(t0).toBeLessThan(c.start);
        expect(t0).toBeGreaterThan(c.start - 0.15);
        expect(p.probe().caption).toBeNull();
        expect(o.sys.voiceFiles.stats.requested).toBe(0);
        // 待つ間（1 秒）は時計が進まない
        for (let i = 0; i < 10; i++) {
            ts += 100;
            frame(ts);
        }
        expect(p.probe().t).toBe(t0);
        expect(p.probe().beat).toBe(0);
        // ほどけた
        o.fetch.answer();
        await flush();
        ts += 100;
        frame(ts);
        expect(p.layer().dataset.voiceWait).toBe('0');
        expect(p.probe().caption?.text).toBe(c.text);
        expect(o.sys.voiceFiles.playingId).toBe(c.voice);
        expect(o.sys.voiceFiles.stats).toMatchObject({ requested: 1, played: 1, late: 0, cacheHits: 1 });
        // 待った時間は数えない：止めた所から 1 コマ分だけ進んだ
        expect(p.probe().t!).toBeLessThan(c.start + 0.15);
        p.modal().press('skip');
        await expect(p.done).resolves.toBe('skipped');
    });

    it('時間切れ：CINE_VOICE_WAIT_SEC 秒たってもほどけない → 字幕を出して進める（声は今までどおり：遅れて届いた声は流さない・2 度鳴らさない）', async () => {
        const o = sound();
        const spec = report();
        const c = firstVoiced(spec);
        const p = await play(spec);
        let ts = await untilFirstVoice(p, spec);
        expect(p.layer().dataset.voiceWait).toBe('1');
        const since = ts;
        while (ts - since < CINE_VOICE_WAIT_SEC * 1000 - 100) {
            ts += 100;
            frame(ts);
            expect(p.probe().caption, `${ts - since} ms`).toBeNull();
        }
        ts += 200;
        frame(ts);
        expect(p.layer().dataset.voiceWait).toBe('0');
        expect(p.probe().caption?.text).toBe(c.text);
        expect(p.probe().t!).toBeGreaterThanOrEqual(c.start);
        // 字幕は出た。声は読み込みを待っている（まだ鳴らない）
        expect(o.sys.voiceFiles.playingId).toBeNull();
        expect(o.sys.voiceFiles.stats.requested).toBe(1);
        // 0.5 秒（音の時計）遅れて届いた：流さない
        o.ctx.advance(0.5);
        o.fetch.answer();
        await flush();
        expect(o.sys.voiceFiles.playingId).toBeNull();
        expect(o.sys.voiceFiles.stats.late).toBe(1);
        // 同じ字幕の間はもう待たない・もう頼まない
        for (let i = 0; i < 5; i++) {
            ts += 100;
            frame(ts);
        }
        expect(p.layer().dataset.voiceWait).toBe('0');
        expect(o.sys.voiceFiles.stats.requested).toBe(1);
        expect(o.sys.voiceFiles.stats.played).toBe(0);
    });

    it('次の声の字幕も、ほどけていれば待たない（取り置き：歩いている間に 4 台詞すべてをほどいた）', async () => {
        const o = sound();
        o.fetch.auto = true;
        o.sys.prepareVoices([...CH1_REPORT_LINES]);
        await flush();
        const spec = report();
        const p = await play(spec);
        let ts = 1000;
        const waits: string[] = [];
        for (let i = 0; i < 400 && !p.settled(); i++) {
            frame(ts);
            waits.push(p.layer().dataset.voiceWait ?? '');
            ts += 100;
            await flush();
        }
        expect(p.settled()).toBe('done');
        expect(waits).not.toContain('1');
        // 4 台詞すべて、字幕と同じ処理の中で鳴り始めた（遅れで捨てない）
        expect(o.sys.voiceFiles.stats).toMatchObject({ requested: 4, played: 4, late: 0, cacheHits: 4 });
    });

    for (const how of ['tts', 'muted', 'voice0', 'locked', 'noaudio'] as const) {
        it(`待たない：${how}（声の字幕の時刻が来たら、そのまま字幕を出す）`, async () => {
            if (how !== 'noaudio') {
                const o = sound({ override: how === 'tts' ? 'tts' : null, unlock: how !== 'locked' });
                if (how === 'muted') o.sys.settings.set({ muted: true });
                if (how === 'voice0') o.sys.settings.set({ voice: 0 });
            }
            const spec = report();
            const c = firstVoiced(spec);
            const p = await play(spec);
            const ts = await untilFirstVoice(p, spec);
            frame(ts + 100);
            expect(p.layer().dataset.voiceWait).toBe('0');
            expect(p.probe().caption?.text).toBe(c.text);
        });
    }

    it('待っている間の一時停止（自動の一時停止も同じ）：待ちをやめる。再開してまだほどけていなければまた待つ。スキップ：すぐ終わり、後から声を鳴らさない', async () => {
        const o = sound();
        const spec = report();
        const p = await play(spec);
        let ts = await untilFirstVoice(p, spec);
        expect(p.layer().dataset.voiceWait).toBe('1');
        p.modal().press('pause');
        expect(p.layer().dataset.voiceWait).toBe('0');
        expect(p.probe().paused).toBe(true);
        const t0 = p.probe().t;
        for (let i = 0; i < 40; i++) {
            ts += 100;
            frame(ts);
        }
        expect(p.probe().t).toBe(t0);
        expect(p.probe().caption).toBeNull();
        p.modal().press('pause');
        ts += 100;
        frame(ts);
        ts += 100;
        frame(ts);
        expect(p.layer().dataset.voiceWait).toBe('1');
        expect(p.probe().caption).toBeNull();
        // スキップ
        expect(p.modal().press('skip')).toBe(true);
        await expect(p.done).resolves.toBe('skipped');
        o.fetch.answer();
        await flush();
        expect(o.sys.voiceFiles.playingId).toBeNull();
        expect(o.sys.voiceFiles.stats.played).toBe(0);
    });

    it('始めの字幕が声の字幕：ほどけるまで字幕を出さずに待つ（時計は 0 のまま）。ほどけたら字幕と声が同時に出る', async () => {
        const o = sound();
        const ev: StageEvent = { id: 'town_life', hero: true };
        const cap = voiceCap('ch1.hero.gather');
        const spec: CineSpec = {
            id: 'test.voice-at-0',
            moment: 'ch1_open',
            title: '確かめ',
            duration: 4,
            beats: [{ kind: 'stage', start: 0, end: 4, event: ev }],
            captions: [{ start: 0, end: 4, ...cap }],
            info: {},
        };
        const p = await play(spec);
        expect(p.layer().dataset.voiceWait).toBe('1');
        expect(p.probe().caption).toBeNull();
        let ts = p.run(1000, 6);
        expect(p.probe().t).toBe(0);
        expect(p.probe().caption).toBeNull();
        expect(o.sys.voiceFiles.stats.requested).toBe(0);
        o.fetch.answer();
        await flush();
        ts += 100;
        frame(ts);
        expect(p.probe().caption?.text).toBe(cap.text);
        expect(o.sys.voiceFiles.playingId).toBe('ch1.hero.gather');
        expect(o.sys.voiceFiles.stats).toMatchObject({ requested: 1, played: 1, late: 0 });
        p.modal().press('skip');
        await p.done;
    });
});

describe('ゲームの側の口：町の出来事を待つ間の声の取り置き（prepareCinematic）', () => {
    it('はじめから：出来事を待ち始めた時（冒頭の前）に町の急報の台本で取り置く。線を越えて急報を流す時に取り置きをやめる（流す演出が字幕の声を捨てずに持つ）。状態は変えない', async () => {
        const storage = new MemoryStorage();
        const view = new View();
        const world = new World();
        const game = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
        void game.start();
        (await next(view, 'title')).answer('new:ieyasu1570');
        const open = await next(view, 'cinematic');
        expect(open.spec.id).toBe('ch1_open');
        // 冒頭が始まる前に、待っている町の出来事（急報）の声を取り置いた
        expect(view.prepared).toEqual(['ch1_report']);
        open.answer('done');
        for (let j = 0; j < 40; j++) await Promise.resolve();
        expect(game.townEventPending).toBe('ch1_report');
        const s0 = JSON.stringify(game.state);
        world.pose = { x: ENTRY_POSE.x, z: REPORT_LINE_Z - 0.05, heading: Math.PI };
        game.tick(1 / 30);
        const c = await next(view, 'cinematic');
        expect(c.spec.id).toBe('ch1_report');
        expect(view.prepared).toEqual(['ch1_report', null]);
        c.answer('done');
        for (let j = 0; j < 40; j++) await Promise.resolve();
        // 状態は変えない
        expect(JSON.stringify(game.state)).toBe(s0);
        expect(view.prepared).toEqual(['ch1_report', null]);
    });

    it('つづきから（出来事を待たない）：取り置かない。タイトルへ戻った：やめる', async () => {
        const storage = new MemoryStorage();
        const view = new View();
        const world = new World();
        const sc = ieyasuScenario(storage);
        const game = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [sc], battleRunner: async () => null });
        game.begin(newIeyasuGame() as never, 'ieyasu1570');
        expect(game.townEventPending).toBeNull();
        expect(view.prepared).toEqual([]);
        // はじめからの回で待っている途中にタイトルへ
        void game.start();
        (await next(view, 'title')).answer('new:ieyasu1570');
        (await next(view, 'cinematic')).answer('skipped');
        for (let j = 0; j < 40; j++) await Promise.resolve();
        expect(view.prepared).toEqual(['ch1_report']);
        void game.title();
        expect(view.prepared).toEqual(['ch1_report', null]);
    });
});
