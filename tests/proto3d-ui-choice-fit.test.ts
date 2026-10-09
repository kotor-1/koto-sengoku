/**
 * 会話・軍議の選択肢の並びを、台詞の枠と上の部品の間に収める計算（proto3d/src/ui/choiceFit.ts。Version 24）。
 * 縦長のスマホで 3 行の台詞の枠が軍議の選択肢 C を隠していた（Version 21〜23）。かからない画面は何も変えない（Version 23 のまま）。
 */
import { describe, expect, it } from 'vitest';
import { CHOICE_FIT, fitChoices, revealScrollTop } from '../proto3d/src/ui/choiceFit';

// 390×844 の軍議（Version 23 で測った値）：並びは 319〜722、3 行の台詞の枠の上端は 698.4、詳しく見る・メニューの下端は 56、見出しの下端は 70
const council390 = { layerH: 844, natural: { top: 319, bottom: 722 }, contentH: 403, dialogTop: 698.4, coverBottom: 56, topBottom: 70 };

describe('fitChoices', () => {
    it('台詞の枠にも上の部品にもかからなければ、CSS のまま（Version 23 と同じ）', () => {
        // 844×390 の 1 行の台詞：並びの下端 280、枠の上端 292
        const r = fitChoices({ layerH: 390, natural: { top: 120, bottom: 280 }, contentH: 160, dialogTop: 292, coverBottom: 50, topBottom: 60 });
        expect(r.fit).toBe(false);
        // 接しているだけ（0.5px まで）も重なりにしない
        expect(fitChoices({ layerH: 390, natural: { top: 50, bottom: 292.4 }, contentH: 242, dialogTop: 292, coverBottom: 50, topBottom: 60 }).fit).toBe(false);
    });
    it('上の見出し・目的の札（並びの下に描かれる）にかかるだけでは動かさない（隠れるのは選択肢ではない）', () => {
        expect(fitChoices({ layerH: 390, natural: { top: 40, bottom: 280 }, contentH: 240, dialogTop: 292, coverBottom: 30, topBottom: 70 }).fit).toBe(false);
    });
    it('台詞の枠にかかる（縦長のスマホの軍議）：枠の上 12px に下端を置き、入るので動かさない', () => {
        const r = fitChoices(council390);
        expect(r.fit).toBe(true);
        expect(r.scroll).toBe(false);
        // 並びの下端 = 枠の上端 − 12
        expect(844 - r.bottom).toBeCloseTo(698.4 - CHOICE_FIT.gapBelow, 5);
        expect(r.maxH).toBe(403);
        expect(r.textMax).toBeNull();
    });
    it('入りきらなければ、上の部品の下 8px までを見える高さにして、並びの中を動かす', () => {
        const r = fitChoices({ ...council390, layerH: 640, natural: { top: 68, bottom: 518 }, contentH: 450, dialogTop: 494.4 });
        expect(r.fit).toBe(true);
        expect(r.scroll).toBe(true);
        expect(r.maxH).toBeCloseTo(494.4 - CHOICE_FIT.gapBelow - (70 + CHOICE_FIT.gapAbove), 5);
        expect(640 - r.bottom).toBeCloseTo(494.4 - CHOICE_FIT.gapBelow, 5);
    });
    it('詳しく見る・メニュー（並びの上に描かれる）にかかるときも収める（台詞の枠にかかっていなくても）', () => {
        const r = fitChoices({ layerH: 320, natural: { top: 20, bottom: 210 }, contentH: 190, dialogTop: 222, coverBottom: 52, topBottom: 66 });
        expect(r.fit).toBe(true);
        expect(r.scroll).toBe(true);
        // 入りきらず見える高さも狭いので、見出し（並びの下に描かれる）の上も使い、詳しく見る・メニューの下 8px まで
        expect(r.maxH).toBeCloseTo(222 - 12 - (52 + 8), 5);
    });
    it('低い横長の画面で入りきらないときは、見出し・目的の札（並びの下に描かれる）の上も使う。縦長で高さがあれば見出しを避けたまま動かす', () => {
        // 568×320 の約束：目的の札の下端 101、メニューの下端 56
        const low = fitChoices({ layerH: 320, natural: { top: 15, bottom: 210 }, contentH: 211, dialogTop: 222, coverBottom: 56, topBottom: 101 });
        expect(low.scroll).toBe(true);
        expect(low.maxH).toBeCloseTo(222 - 12 - (56 + 8), 5);
        // 入りきるなら見出しの上も使う（動かさずに済む）
        const fits = fitChoices({ layerH: 320, natural: { top: 15, bottom: 210 }, contentH: 140, dialogTop: 222, coverBottom: 56, topBottom: 101 });
        expect(fits.scroll).toBe(false);
        // 360×640 の軍議：見出しを避けても 408px 見える。見出しは避けたまま
        const tall = fitChoices({ layerH: 640, natural: { top: 79, bottom: 518 }, contentH: 447, dialogTop: 494.4, coverBottom: 56, topBottom: 66 });
        expect(tall.scroll).toBe(true);
        expect(tall.maxH).toBeCloseTo(494.4 - 12 - (66 + 8), 5);
    });
    it('画面の上の端より上へ出ている（上に部品が無くても）ときは収める', () => {
        const r = fitChoices({ layerH: 320, natural: { top: -68, bottom: 210 }, contentH: 278, dialogTop: 222, coverBottom: 0, topBottom: 0 });
        expect(r.fit).toBe(true);
        expect(r.scroll).toBe(true);
        expect(r.maxH).toBeCloseTo(222 - 12 - 8, 5);
    });
    it('それでも並びの高さが取れない、とても低い画面：台詞の欄を（2 行分は残して）縮める', () => {
        const r = fitChoices({ layerH: 320, natural: { top: 40, bottom: 210 }, contentH: 170, dialogTop: 150, coverBottom: 52, topBottom: 66, text: { h: 96, min: 48 } });
        expect(r.fit).toBe(true);
        // 縮める前の高さ 150 − 12 − (52 + 8) = 78 < 96：18 だけ縮める
        expect(r.textMax).toBeCloseTo(96 - 18, 5);
        expect(r.maxH).toBeCloseTo(CHOICE_FIT.minList, 5);
        expect(320 - r.bottom).toBeCloseTo(150 + 18 - 12, 5);
        // 2 行より下へは縮めない
        const s = fitChoices({ layerH: 320, natural: { top: 40, bottom: 210 }, contentH: 170, dialogTop: 120, coverBottom: 52, topBottom: 66, text: { h: 60, min: 48 } });
        expect(s.textMax).toBeCloseTo(48, 5);
    });
    it('台詞の枠の上端が上の部品のすぐ下でも、押せる高さ 44px は残す', () => {
        const r = fitChoices({ layerH: 300, natural: { top: 0, bottom: 200 }, contentH: 200, dialogTop: 80, coverBottom: 50, topBottom: 60 });
        expect(r.maxH).toBeGreaterThanOrEqual(44);
        expect(r.scroll).toBe(true);
    });
});

describe('revealScrollTop（動く並びで、選んだ物を端の薄れにかけずに見せる）', () => {
    it('見えていれば動かさない', () => {
        expect(revealScrollTop(100, { top: 160, h: 50 }, 200, 400)).toBe(100);
    });
    it('下に隠れていれば、下の端の薄れの分だけ余して見せる', () => {
        expect(revealScrollTop(0, { top: 300, h: 60 }, 200, 400)).toBe(300 + 60 + CHOICE_FIT.fade - 200);
    });
    it('上に隠れていれば、上の端の薄れの分だけ余して見せる。一番上・一番下を越えない', () => {
        expect(revealScrollTop(300, { top: 120, h: 50 }, 200, 400)).toBe(120 - CHOICE_FIT.fade);
        expect(revealScrollTop(300, { top: 4, h: 50 }, 200, 400)).toBe(0);
        expect(revealScrollTop(0, { top: 560, h: 60 }, 200, 400)).toBe(400);
    });
});
