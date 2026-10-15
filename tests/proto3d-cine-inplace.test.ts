/**
 * 演出の始めに暗い画を挟まない（Version 28 の本番の確かめで見つかった A2）：町の急報の始めに、演出の層が不透明な地の色で 3D の画を
 * 1〜2 コマ覆った（コマ撮りのコマ 191・192 が暗い）。演出の再生器（ui/cinePlayer.ts）は 3D の場面に入るとき、先に見出しを不透明な層で
 * 見せてから層を透明にして最初の画を描く（押した直後に画面が何秒も変わらないのを避けるため）。
 * - 探索の画が見えている所から始まる演出（opts.inPlace：町の急報・出陣）で最初の場面が 3D なら、始めの待ちの間も層を透明にする
 *   （探索の描画は止めるので、最初の 3D の画を描くまで今の画が見えたまま）。
 * - 別の画面（タイトル・結果確認・合戦の後・情勢の画面からの見直し）・地図の場面から始まる演出は今までどおり。
 * 画面は偽の DOM（描かない）。requestAnimationFrame は手で回す（tests/proto3d-cine-harness.ts）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { devIeyasuState } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ChapterGame } from '../proto3d/src/campaign/game';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import { REPORT_LINE_Z } from '../proto3d/src/explore/stage';
import { ENTRY_POSE } from '../proto3d/src/town/spots';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { View, World, body, frame, next, play, report, resetCine, sound } from './proto3d-cine-harness';

afterEach(() => resetCine());

describe('A2 探索の所から始まる演出（opts.inPlace）：始めに不透明な層で覆わない', () => {
    it('町の急報（inPlace）：始めの待ちの間も層は透明・出来事もまだ置かない（今の町の画を見せたまま。探索の描画は止める）→ 次のコマで 3D を始める', async () => {
        sound();
        const p = await play(report(), { inPlace: true });
        // 積んだ時点：層は透明・待ちの間（探索の描画は止める）。3D の出来事はまだ置かない（今の町の画のまま）。演出の人の名札はまだ出さない
        expect(p.layer().classList.contains('stage')).toBe(true);
        expect(p.layer().dataset.wait).toBe('1');
        expect(p.covers).toEqual([true]);
        expect(body.classList.contains('g-cine-stage')).toBe(false);
        expect(p.stages).toEqual([]);
        frame(1000);
        expect(p.layer().classList.contains('stage')).toBe(true);
        expect(p.stages).toEqual([]);
        // 待ちを終えた：覆いを外してから出来事を置く（置いた所で探索の側が最初の画を描く）
        frame(1100);
        expect(p.layer().dataset.wait).toBe('0');
        expect(p.covers[p.covers.length - 1]).toBe(false);
        expect(body.classList.contains('g-cine-stage')).toBe(true);
        expect(p.layer().classList.contains('stage')).toBe(true);
        expect(p.stages[0]?.ev?.id).toBe('street_report');
        expect(p.stages[0]?.t).toBe(0);
        // 待ちの間と最初の画の次のコマは時計を進めない
        expect(p.probe().t).toBe(0);
        p.modal().press('skip');
        await p.done;
    });

    it('今までどおり（inPlace なし：タイトル・情勢の見直し・合戦の後などから始まる演出）：始めは不透明な層で見出しを先に見せる', async () => {
        sound();
        const p = await play(report());
        expect(p.layer().classList.contains('stage')).toBe(false);
        expect(p.layer().dataset.wait).toBe('1');
        expect(p.covers).toEqual([true]);
        // 出来事は積んだ時に置く（今までどおり。覆っている間は探索の側が描かない）
        expect(p.stages[0]?.ev?.id).toBe('street_report');
        frame(1000);
        expect(p.layer().classList.contains('stage')).toBe(false);
        frame(1100);
        expect(p.layer().classList.contains('stage')).toBe(true);
        expect(p.covers[p.covers.length - 1]).toBe(false);
        p.modal().press('skip');
        await p.done;
    });
});

describe('ゲームの側の口：探索の所から始まる演出（町の急報・出陣）だけ inPlace', () => {
    it('はじめから：冒頭（タイトルから）は inPlace なし。通りの線を越えた町の急報は inPlace。情勢の画面からの見直しは inPlace なし', async () => {
        const storage = new MemoryStorage();
        const view = new View();
        const world = new World();
        const game = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
        void game.start();
        (await next(view, 'title')).answer('new:ieyasu1570');
        const open = await next(view, 'cinematic');
        expect(open.spec.id).toBe('ch1_open');
        expect(open.opts.inPlace).toBeUndefined();
        open.answer('done');
        for (let j = 0; j < 40; j++) await Promise.resolve();
        world.pose = { x: ENTRY_POSE.x, z: REPORT_LINE_Z - 0.05, heading: Math.PI };
        game.tick(1 / 30);
        const c = await next(view, 'cinematic');
        expect(c.spec.id).toBe('ch1_report');
        expect(c.opts.inPlace).toBe(true);
        c.answer('done');
        for (let j = 0; j < 40; j++) await Promise.resolve();
        // 情勢の画面から見直す（別の画面から始まる）
        void game.openSituation();
        const sv = await next(view, 'situation');
        sv.answer({ replay: 'ch1_report' });
        const r = await next(view, 'cinematic');
        expect(r.spec.moment).toBe('ch1_report');
        expect(r.opts.inPlace).toBeUndefined();
        r.answer('skipped');
        (await next(view, 'situation')).answer();
    });

    it('出陣（城門の会話で「出陣する」の後、同じ城門の画から）は inPlace', async () => {
        const storage = new MemoryStorage();
        const view = new View();
        const world = new World();
        const game = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
        game.begin(devIeyasuState('muster') as never, 'ieyasu1570');
        void game.interact('gate');
        const talk = await next(view, 'script');
        expect(talk.script.choices?.some((c) => c.id === 'depart')).toBe(true);
        talk.answer('depart');
        const d = await next(view, 'cinematic');
        expect(d.spec.moment).toBe('departure');
        expect(d.opts.inPlace).toBe(true);
    });
});
