/**
 * 生成イラスト素材（Version 22）の会話の人物画・軍議の背景の口（DOM は使わない）。
 * - ui/artCanvas.ts の計算：画像の合わせ方（引き伸ばさない・軍議の背景は上下 18% までしか切らない）・描く細かさ（2 倍まで）・
 *   人物画の大きさ（Version 21 の画面で測った選択肢・見出し・ボタンの四角と重ならない。狭ければ出さない）・手前の幕の揺れの幅。
 * - シナリオ：歴史分岐は家康（hero）・忠勝だけに人物画、ほかは名前だけ。架空の章は何も持たない。
 * - ChapterGame：会話・軍議の画面へ人物画と背景の口を渡す。忠勝との会話・軍議の始めで背景を先に読む。旧表示（?art=old）・素材が無いときは読まない。
 * 本物の画面での確認（位置・重なり・旧表示の同一）は、開発サーバーで ?artFixture=1（仮の確かめ用の画像）と ?art=old で行う。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ChapterGame,
    type ConfirmOptions,
    type EndingOptions,
    type GameView,
    type GameWorld,
    type HudInfo,
    type MenuAction,
    type MenuInfo,
    type PromptInfo,
    type ScriptOptions,
    type TitleAction,
    type TitleInfo,
} from '../proto3d/src/campaign/game';
import { devIeyasuState } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_COUNCIL_ART, ieyasuPortraitOf, ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { startChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { fictionalScenario } from '../proto3d/src/campaign/fictional';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import { devStateFor } from '../proto3d/src/campaign/game';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import { createScenarios } from '../proto3d/src/campaign/scenarios';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import type { CastMember } from '../proto3d/src/explore/cast';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { ART_IDS } from '../proto3d/src/art/ids';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { PORTRAIT_RULES, backingScale, fitArt, parallaxAmp, parallaxOffset, portraitLayout, type Box } from '../proto3d/src/ui/artCanvas';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { ch1Aftermath, ch1Ending } from './proto3d-ieyasu-story-states';

// ================= 計算 =================

describe('画像の合わせ方（fitArt）', () => {
    const ratio = (r: { sw: number; sh: number; dw: number; dh: number }) => r.dw / r.dh / (r.sw / r.sh);

    it('contain：全部を見せ、縦横の比を保つ。左下に寄せられる', () => {
        const r = fitArt(1024, 1536, 413, 620, 'contain', { alignX: 0, alignY: 1 });
        expect(r.sx).toBe(0);
        expect(r.sy).toBe(0);
        expect(r.sw).toBe(1024);
        expect(r.sh).toBe(1536);
        expect(r.dw).toBeCloseTo(413, 0);
        expect(r.dh).toBeCloseTo(619.5, 0);
        expect(r.dx).toBe(0);
        expect(r.dy + r.dh).toBeCloseTo(620, 6);
        expect(ratio(r)).toBeCloseTo(1, 9);
        // 横長の箱：左に寄せて右に余り
        const w = fitArt(1024, 1536, 800, 300, 'contain', { alignX: 0, alignY: 1 });
        expect(w.dx).toBe(0);
        expect(w.dh).toBeCloseTo(300, 9);
        expect(w.dw).toBeCloseTo(200, 9);
    });

    it('cover：箱を埋める。16:9・スマホ横では上下の 18% より内側は切らない。引き伸ばさない', () => {
        for (const [W, H] of [
            [1280, 720],
            [1920, 1080],
            [844, 390],
            [667, 375],
            [1024, 768],
        ] as const) {
            const r = fitArt(1536, 1024, W, H, 'cover', { maxCropY: 0.18 });
            expect(r.dw).toBeCloseTo(W, 6);
            expect(r.dh).toBeCloseTo(H, 6);
            expect(r.dx).toBeCloseTo(0, 9);
            expect(r.dy).toBeCloseTo(0, 9);
            expect(r.sy / 1024).toBeLessThanOrEqual(0.18 + 1e-9);
            expect((1024 - r.sy - r.sh) / 1024).toBeLessThanOrEqual(0.18 + 1e-9);
            expect(ratio(r)).toBeCloseTo(1, 9);
        }
        // 1280×720 は上下 8% ずつ・844×390 は約 15.5% ずつ切る（報告の見積もりと同じ）
        expect(fitArt(1536, 1024, 1280, 720, 'cover').sy / 1024).toBeCloseTo(0.078, 2);
        expect(fitArt(1536, 1024, 844, 390, 'cover').sy / 1024).toBeCloseTo(0.154, 2);
    });

    it('cover：とても横長（21:9 より横長）なら、上下を 18% より多く切らずに左右へ帯を残す（引き伸ばさない）', () => {
        const r = fitArt(1536, 1024, 1000, 400, 'cover', { maxCropY: 0.18 });
        expect(r.dh).toBeCloseTo(400, 6);
        expect(r.dw).toBeLessThan(1000);
        expect(r.dx).toBeCloseTo((1000 - r.dw) / 2, 6);
        expect(r.sx).toBeCloseTo(0, 9);
        expect(r.sw).toBeCloseTo(1536, 6);
        expect(r.sy / 1024).toBeCloseTo(0.18, 6);
        expect(ratio(r)).toBeCloseTo(1, 9);
        // 縦長の画面（スマホ縦）：左右を切って埋める（上下は切らない）
        const p = fitArt(1536, 1024, 390, 844, 'cover', { maxCropY: 0.18 });
        expect(p.sy).toBeCloseTo(0, 9);
        expect(p.dw).toBeCloseTo(390, 6);
        expect(p.dh).toBeCloseTo(844, 6);
    });

    it('大きさ 0 の箱・画像では描かない', () => {
        expect(fitArt(0, 10, 10, 10, 'cover').dw).toBe(0);
        expect(fitArt(10, 10, 0, 10, 'contain').dw).toBe(0);
    });
});

describe('描く細かさ（backingScale）', () => {
    it('端末の比は 1〜2 に収める・元の画像より細かくしない', () => {
        expect(backingScale(1)).toBe(1);
        expect(backingScale(2)).toBe(2);
        expect(backingScale(3)).toBe(2);
        expect(backingScale(0.5)).toBe(1);
        expect(backingScale(Number.NaN)).toBe(1);
        // 1920 幅に 1536 の画像：元の画素は CSS の 1px に 0.8 → 細かくしても意味が無いので 1
        expect(backingScale(2, 1536 / 1920)).toBe(1);
        // 620 の高さに 1536 の人物画：2.48 → 端末の 2 まで
        expect(backingScale(2, 1536 / 620)).toBe(2);
        expect(backingScale(3, 1.5)).toBe(1.5);
    });
});

describe('人物画の大きさ（portraitLayout）：Version 21 の画面で測った四角と重ならない', () => {
    const A = 1024 / 1536;
    const box = (x: number, y: number, w: number, h: number): Box => ({ left: x, top: y, right: x + w, bottom: y + h });
    const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // 測った四角（docs の報告 conversation.md・story.md。x, y, w, h）
    const HUD = box(12, 10, 466, 74);
    const MENU_PC = box(1164, 10, 104, 41);
    const MAP_PC = box(12, 12, 142, 39);
    const HEAD_PC = box(529, 18, 221, 51);
    const MENU_PH = box(724, 10, 108, 47);
    const MAP_PH = box(12, 12, 122, 45);
    const HEAD_PH = box(311, 18, 222, 51);
    const cases: { name: string; vw: number; vh: number; left: number; avoid: Box[]; expectH?: number; hidden?: boolean }[] = [
        { name: '1280×720 会話（選択肢あり）', vw: 1280, vh: 720, left: 24, avoid: [HUD, MENU_PC, box(610, 483, 420, 115)], expectH: 619 },
        { name: '1280×720 軍議（方針の選択肢）', vw: 1280, vh: 720, left: 24, avoid: [MAP_PC, HEAD_PC, MENU_PC, box(610, 246, 420, 352)], expectH: 619 },
        { name: '1920×1080 軍議', vw: 1920, vh: 1080, left: 24, avoid: [MAP_PC, box(849, 18, 221, 51), box(1824, 10, 84, 41), box(1030, 600, 420, 352)], expectH: 620 },
        { name: '844×390 会話（選択肢あり）', vw: 844, vh: 390, left: 8, avoid: [HUD, MENU_PH, box(392, 159, 420, 121)], expectH: 298 },
        { name: '844×390 軍議（方針の選択肢・要点）', vw: 844, vh: 390, left: 8, avoid: [MAP_PH, HEAD_PH, MENU_PH, box(272, 73, 540, 207)], expectH: 300 },
        // 切り欠きのある端末（左右 47・下 21 の安全域）：選択肢が左へ寄るので小さく
        { name: '844×390 切り欠き 軍議', vw: 844, vh: 390, left: 55, avoid: [box(59, 12, 122, 45), HEAD_PH, box(677, 10, 108, 47), box(243, 52, 540, 207)], expectH: 270 },
        { name: '844×390 切り欠き 会話', vw: 844, vh: 390, left: 55, avoid: [box(59, 10, 466, 74), box(677, 10, 108, 47), box(363, 138, 420, 121)], expectH: 298 },
        // 667×375：軍議の方針の選択肢は左の 113 まで来る → 空きが狭いので出さない。会話の行（選択肢なし）は出す
        { name: '667×375 軍議（方針の選択肢）', vw: 667, vh: 375, left: 8, avoid: [MAP_PH, box(222, 18, 222, 51), box(547, 10, 108, 47), box(113, 58, 540, 207)], hidden: true },
        { name: '667×375 軍議（台詞の行）', vw: 667, vh: 375, left: 8, avoid: [MAP_PH, box(222, 18, 222, 51), box(547, 10, 108, 47)], expectH: 300 },
        { name: '667×375 会話（選択肢あり）', vw: 667, vh: 375, left: 8, avoid: [HUD, box(547, 10, 108, 47), box(233, 144, 420, 121)], expectH: 283 },
        { name: '低すぎる画面（高さ 320）', vw: 700, vh: 320, left: 8, avoid: [], hidden: true },
    ];
    for (const c of cases) {
        it(c.name, () => {
            const r = portraitLayout({ vw: c.vw, vh: c.vh, left: c.left, bottom: c.vh, aspect: A, avoid: c.avoid });
            if (c.hidden) {
                expect(r).toBeNull();
                return;
            }
            expect(r).not.toBeNull();
            const { w, h } = r!;
            if (c.expectH !== undefined) expect(h).toBe(c.expectH);
            expect(w).toBe(Math.floor(h * A));
            expect(h).toBeGreaterThanOrEqual(PORTRAIT_RULES.minH);
            const rect = { left: c.left, top: c.vh - h, right: c.left + w, bottom: c.vh };
            // 左下の空き（その高さの範囲で一番近い避ける物まで）は 150 以上
            const free = Math.min(c.vw, ...c.avoid.filter((o) => o.right > c.left && o.bottom > rect.top).map((o) => o.left)) - c.left;
            expect(free).toBeGreaterThanOrEqual(PORTRAIT_RULES.minFreeW);
            for (const o of c.avoid) expect(overlaps(rect, o), JSON.stringify(o)).toBe(false);
            expect(rect.right).toBeLessThanOrEqual(c.vw);
            expect(rect.top).toBeGreaterThanOrEqual(0);
            // PC は 620 まで・スマホ横は 300 まで
            expect(h).toBeLessThanOrEqual(c.vh <= 430 ? 300 : 620);
        });
    }
});

describe('人物画の大きさ：余白を切り詰めた細い人物画（加工版の縦横比 745×1453）', () => {
    const A = 745 / 1453;
    const box = (x: number, y: number, w: number, h: number): Box => ({ left: x, top: y, right: x + w, bottom: y + h });
    it('細くても、空きが広ければ出す（幅ではなく空きの幅で決める）', () => {
        // 667×375 の会話：目的の札で高さ 283 まで → 幅 145 だが、選択肢までの空きは 217 ある
        const r = portraitLayout({ vw: 667, vh: 375, left: 8, bottom: 375, aspect: A, avoid: [box(12, 10, 466, 74), box(547, 10, 108, 47), box(233, 144, 420, 121)] });
        expect(r).toEqual({ w: Math.floor(283 * A), h: 283 });
        // 1280×720：619 の高さで幅 317
        expect(portraitLayout({ vw: 1280, vh: 720, left: 24, bottom: 720, aspect: A, avoid: [box(12, 10, 466, 74), box(610, 483, 420, 115)] })).toEqual({ w: Math.floor(619 * A), h: 619 });
    });
    it('空きの幅が 150 未満・高さが 210 未満なら出さない', () => {
        // 667×375 の軍議の方針の選択肢（左の 113 まで）
        expect(portraitLayout({ vw: 667, vh: 375, left: 8, bottom: 375, aspect: A, avoid: [box(12, 12, 122, 45), box(113, 58, 540, 207)] })).toBeNull();
        // 選択肢が左の 150 まで来て、高さで避けると 210 未満
        expect(portraitLayout({ vw: 800, vh: 400, left: 8, bottom: 400, aspect: A, avoid: [box(150, 150, 600, 120)] })).toBeNull();
    });
});

describe('手前の幕の揺れ', () => {
    it('1280 で 8px 以下・844 で 5px 以下。往復する', () => {
        expect(parallaxAmp(1280)).toBeLessThanOrEqual(8);
        expect(parallaxAmp(844)).toBeLessThanOrEqual(5);
        expect(parallaxAmp(3840)).toBe(8);
        const a = parallaxAmp(1280);
        expect(parallaxOffset(0, a)).toBeCloseTo(0, 9);
        expect(parallaxOffset(3, a)).toBeCloseTo(a, 9);
        expect(parallaxOffset(9, a)).toBeCloseTo(-a, 9);
    });
});

// ================= シナリオ =================

describe('シナリオの人物画と軍議の背景', () => {
    it('歴史分岐：家康（hero）と忠勝だけ。地の文・高札・ほかの人物は出さない', () => {
        expect(ieyasuPortraitOf('hero')).toBe(ART_IDS.portraitIeyasu);
        expect(ieyasuPortraitOf('tadakatsu')).toBe(ART_IDS.portraitTadakatsu);
        for (const sp of ['narration', 'notice', 'sakai', 'ishikawa', 'oda_envoy', 'asai_envoy', 'village', '', 'ieyasu']) expect(ieyasuPortraitOf(sp)).toBeNull();
        const sc = ieyasuScenario(new MemoryStorage());
        const s1 = devIeyasuState('explore');
        expect(sc.portraitOf?.(s1, 'hero')).toBe(ART_IDS.portraitIeyasu);
        expect(sc.portraitOf?.(s1, 'sakai')).toBeNull();
        // 第二章（同じシナリオの口。負傷していても同じ絵）
        const s2 = startChapter2(ch1Ending(ch1Aftermath('oda', 'defeat', 'kept', 'heavy')));
        expect(sc.portraitOf?.(s2, 'tadakatsu')).toBe(ART_IDS.portraitTadakatsu);
        expect(sc.portraitOf?.(s2, 'village')).toBeNull();
        expect(sc.councilArt).toEqual({ base: ART_IDS.bgCouncil, front: ART_IDS.bgCouncilFront });
        expect(IEYASU_COUNCIL_ART.base).toBe('bg.council');
    });

    it('架空の章は持たない（話し手 hero が別の人物のため。今までの見た目のまま）', () => {
        const sc = fictionalScenario(new CampaignSaveStore(new MemoryStorage()));
        expect(sc.portraitOf).toBeUndefined();
        expect(sc.councilArt).toBeUndefined();
    });
});

// ================= 章のつなぎ（偽の画面） =================

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; opts: ScriptOptions; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: ScenarioEndingView; opts?: EndingOptions; answer: () => void };

class FakeView implements GameView {
    reqs: Req[] = [];
    title(info: TitleInfo) {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', info, answer }));
    }
    script(script: ScenarioScript, opts: ScriptOptions) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, opts, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu(info: MenuInfo) {
        return new Promise<MenuAction>((answer) => this.reqs.push({ kind: 'menu', info, answer }));
    }
    ending(view: ScenarioEndingView, opts?: EndingOptions) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'ending', view, opts, answer }));
    }
    hud(_i: HudInfo | null) {}
    prompt(_p: PromptInfo | null) {}
    intro() {}
    toast() {}
    abandon() {
        this.reqs = [];
    }
}

class FakeWorld implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    hall: boolean[] = [];
    private readonly w = colliders();
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
    walls(): Rect[] {
        return this.w;
    }
    showCouncilHall(on: boolean) {
        this.hall.push(on);
    }
}

const flush = async (n = 30) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

function boot() {
    const view = new FakeView();
    const world = new FakeWorld();
    const { scenarios, fictionalStore } = createScenarios(new MemoryStorage());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = new ChapterGame<any>({ view, world, store: fictionalStore, scenarios, battleRunner: async () => null });
    const next = async <K extends Req['kind']>(kind: K): Promise<Extract<Req, { kind: K }>> => {
        await flush();
        const r = view.reqs.shift();
        if (!r || r.kind !== kind) throw new Error(`${kind} を待っていたが ${r?.kind ?? '無し'}`);
        return r as Extract<Req, { kind: K }>;
    };
    const talkTo = (id: string) => {
        const t = world.cast.find((c) => c.id === id)!;
        world.setHeroPose({ x: t.x + 0.9, z: t.z, heading: 0 });
        game.tick(1 / 30);
        void game.interact();
    };
    return { view, world, game, next, talkTo };
}

/** 素材の一覧に軍議の背景と人物画を入れ、読み込み（fetch → createImageBitmap）を記録する偽物に差し替える */
function fakeArt() {
    __setArtManifestForTest({
        version: 1,
        assets: {
            [ART_IDS.bgCouncil]: { file: 'art/bg/council.webp', w: 1536, h: 1024, kind: 'background' },
            [ART_IDS.bgCouncilFront]: { file: 'art/bg/council_front.webp', w: 1536, h: 1024, kind: 'overlay' },
            [ART_IDS.portraitIeyasu]: { file: 'art/portraits/ieyasu.webp', w: 1024, h: 1536, kind: 'portrait' },
        },
    });
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        return { ok: true, status: 200, blob: async () => ({}) };
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10, close() {} }));
    return urls;
}

afterEach(() => {
    vi.unstubAllGlobals();
    __setArtManifestForTest(null);
});

describe('ChapterGame：会話・軍議の画面へ渡す人物画と背景の口', () => {
    it('歴史分岐：会話には人物画の口だけ、軍議には背景も。人物画はシナリオの portraitOf のとおり', async () => {
        const { game, next, talkTo } = boot();
        game.begin(devIeyasuState('explore'), 'ieyasu1570');
        talkTo('tadakatsu');
        const talk = await next('script');
        expect(talk.opts.mode).toBe('talk');
        expect(talk.opts.portraitOf?.('hero')).toBe(ART_IDS.portraitIeyasu);
        expect(talk.opts.portraitOf?.('tadakatsu')).toBe(ART_IDS.portraitTadakatsu);
        expect(talk.opts.portraitOf?.('narration')).toBeNull();
        expect(talk.opts.councilArt).toBeUndefined();
        // 話し手の id は台本の行のまま（地の文・忠勝・家康）
        expect(new Set(talk.script.lines.map((l) => l.speaker))).toEqual(new Set(['narration', 'tadakatsu', 'hero']));
        talk.answer('open_council');
        const council = await next('script');
        expect(council.opts.mode).toBe('council');
        expect(council.opts.councilArt).toEqual({ base: ART_IDS.bgCouncil, front: ART_IDS.bgCouncilFront });
        expect(council.opts.portraitOf?.('sakai')).toBeNull();
        expect(council.opts.portraitOf?.('ishikawa')).toBeNull();
        expect(council.opts.portraitOf?.('tadakatsu')).toBe(ART_IDS.portraitTadakatsu);
        // 考え直す → 確かめの台本・選び直しの軍議にも、同じ背景
        const policy = council.script.choices![0]!.id;
        council.answer(policy);
        const confirm = await next('script');
        expect(confirm.opts.councilArt).toEqual(council.opts.councilArt);
        const again = confirm.script.choices!.find((c) => c.id !== 'confirm_policy')!.id;
        confirm.answer(again);
        const council2 = await next('script');
        expect(council2.opts.mode).toBe('council');
        expect(council2.opts.councilArt).toEqual(council.opts.councilArt);
    });

    it('第二章（同じシナリオ）：忠勝との会話と軍議にも、人物画と背景の口', async () => {
        const { game, next, talkTo } = boot();
        game.begin(startChapter2(ch1Ending(ch1Aftermath('oda', 'victory', 'kept', 'light'))), 'ieyasu1570');
        talkTo('tadakatsu');
        const talk = await next('script');
        expect(talk.opts.portraitOf?.('tadakatsu')).toBe(ART_IDS.portraitTadakatsu);
        expect(talk.opts.councilArt).toBeUndefined();
        expect(talk.script.choices?.map((c) => c.id)).toContain('open_council');
        talk.answer('open_council');
        const council = await next('script');
        expect(council.opts.mode).toBe('council');
        expect(council.opts.councilArt).toEqual({ base: ART_IDS.bgCouncil, front: ART_IDS.bgCouncilFront });
        expect(council.opts.portraitOf?.('village')).toBeNull();
    });

    it('架空の章：人物画・背景の口を渡さない（Version 21 と同じ画面）', async () => {
        const { game, next, talkTo, world } = boot();
        game.begin(devStateFor('explore'), 'fictional');
        const key = world.cast.find((c) => c.kind === 'person' && c.key) ?? world.cast.find((c) => c.kind === 'person')!;
        talkTo(key.id);
        const talk = await next('script');
        expect(talk.opts.portraitOf).toBeUndefined();
        expect(talk.opts.councilArt).toBeUndefined();
    });

    it('忠勝との会話の始めに軍議の背景を先に読み、軍議の始めでも頼む（同じ画像は 1 回だけ読む）', async () => {
        const urls = fakeArt();
        const { game, next, talkTo } = boot();
        game.begin(devIeyasuState('explore'), 'ieyasu1570');
        talkTo('tadakatsu');
        const talk = await next('script');
        await flush();
        expect(urls).toEqual(['./art/bg/council.webp', './art/bg/council_front.webp']);
        talk.answer('open_council');
        await next('script');
        await flush();
        // 読み込みの約束は共有：軍議の始めで頼み直しても、もう一度は読まない
        expect(urls).toEqual(['./art/bg/council.webp', './art/bg/council_front.webp']);
    });

    it('旧表示（?art=old）：何も読まない', async () => {
        const urls = fakeArt();
        vi.stubGlobal('location', { search: '?art=old', hash: '' });
        const { game, next, talkTo } = boot();
        game.begin(devIeyasuState('explore'), 'ieyasu1570');
        talkTo('tadakatsu');
        const talk = await next('script');
        talk.answer('open_council');
        await next('script');
        await flush();
        expect(urls).toEqual([]);
    });

    it('素材の一覧が空（今の公開版）：何も読まない', async () => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => {
            urls.push(String(url));
            return { ok: false, status: 404 };
        });
        vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
        const { game, next, talkTo } = boot();
        game.begin(devIeyasuState('explore'), 'ieyasu1570');
        talkTo('tadakatsu');
        const talk = await next('script');
        talk.answer('open_council');
        await next('script');
        await flush();
        expect(urls).toEqual([]);
    });
});
