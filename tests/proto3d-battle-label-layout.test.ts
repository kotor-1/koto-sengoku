/**
 * 部隊の名札の優先表示（battle/labelLayout.ts。docs/fields-group2-design.md §2）の並べ方の関数。DOM なし（数の上だけ）。
 * 優先：選んでいる > 能力を使える（点滅）> 重要な武将 > 画面の中央に近い。重なる低い名札は小さく → それでも重なれば一時的に隠す。
 * 選んでいる・点滅の名札は小さくも隠しもしない（重なれば上へずらす）。小さくした名札は、小さい名札 1 つ分まで上へずらしてよい。
 */
import { describe, expect, it } from 'vitest';
import { LABEL_GAP, labelOrder, labelRank, layoutLabels, type LabelLayoutItem } from '../proto3d/src/battle/labelLayout';

const CX = 480;
const CY = 270;

function L(id: string, x: number, y: number, o: Partial<LabelLayoutItem> = {}): LabelLayoutItem {
    return { id, x, y, w: 90, h: 16, mw: 40, mh: 12, sel: false, ready: false, important: false, ...o };
}

interface Box {
    l: number;
    t: number;
    r: number;
    b: number;
}
/** 置いた後の見えている四角（隠した名札は null） */
function shownBox(it: LabelLayoutItem, p: { fit: string; dy: number }): Box | null {
    if (p.fit === 'hide') return null;
    const w = p.fit === 'mini' ? it.mw : it.w;
    const h = p.fit === 'mini' ? it.mh : it.h;
    return { l: it.x - w / 2, r: it.x + w / 2, t: it.y + p.dy - h, b: it.y + p.dy };
}
const overlap = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

describe('名札の優先の順', () => {
    it('選んでいる（0）> 能力を使える（1）> 重要な武将（2）> そのほか（3）', () => {
        expect(labelRank({ sel: true, ready: true, important: true })).toBe(0);
        expect(labelRank({ sel: false, ready: true, important: true })).toBe(1);
        expect(labelRank({ sel: false, ready: false, important: true })).toBe(2);
        expect(labelRank({ sel: false, ready: false, important: false })).toBe(3);
    });
    it('同じ順の中は画面の中央に近い順。順が違えば中央からの距離より順が先', () => {
        const items = [L('far', CX + 300, CY), L('near', CX + 10, CY + 8), L('imp_far', CX - 400, CY, { important: true }), L('ready_far', 10, 10, { ready: true }), L('sel_far', 900, 500, { sel: true })];
        expect(labelOrder(items, CX, CY).map((i) => i.id)).toEqual(['sel_far', 'ready_far', 'imp_far', 'near', 'far']);
    });
});

describe('名札を並べる', () => {
    it('重ならなければ、どれもそのまま（ずらさない）', () => {
        const items = [L('a', 100, 100), L('b', 300, 100), L('c', 500, 300, { important: true })];
        const lay = layoutLabels(items, CX, CY);
        for (const it of items) expect(lay.get(it.id)).toEqual({ fit: 'full', dy: 0 });
    });

    it('同じ所に 4 つ：選んだ名札はそのまま、点滅の名札は上へずらして見せる（小さくしない）。重要な武将・そのほかは小さく・隠す', () => {
        const items = [L('other', CX, CY), L('imp', CX + 4, CY + 2, { important: true }), L('ready', CX - 3, CY + 1, { ready: true }), L('sel', CX + 2, CY - 1, { sel: true })];
        const lay = layoutLabels(items, CX, CY);
        expect(lay.get('sel')).toEqual({ fit: 'full', dy: 0 });
        expect(lay.get('ready')!.fit).toBe('full');
        expect(lay.get('ready')!.dy).toBeLessThan(0);
        expect(lay.get('imp')!.fit).not.toBe('full');
        expect(lay.get('other')!.fit).toBe('hide');
        // 選んだ名札と点滅の名札は重ならない（点滅する印が見えて押せる）
        const sel = shownBox(items[3]!, lay.get('sel')!)!;
        const ready = shownBox(items[2]!, lay.get('ready')!)!;
        expect(overlap(sel, ready)).toBe(false);
    });

    it('そのままだと重なるが、小さくすれば重ならない名札は小さく（隠さない）', () => {
        // 幅 90 の名札が横に 60 px 離れて並ぶ：そのままだと重なり、小さく（幅 40）すれば重ならない
        const items = [L('imp', CX, CY, { important: true }), L('other', CX + 66, CY)];
        const lay = layoutLabels(items, CX, CY);
        expect(lay.get('imp')).toEqual({ fit: 'full', dy: 0 });
        expect(lay.get('other')).toEqual({ fit: 'mini', dy: 0 });
    });

    it('その位置では小さくしても重なるが、小さい名札 1 つ分まで上なら空いている名札は、小さくして少し上へずらす（それより遠ければ隠す）', () => {
        // 置いた名札（下の縁 CY・上の縁 CY−16）より 4 px 上に下の縁がある名札：小さく（高さ 12）してもその位置では重なる → 上の縁の 2 px 上へ（14 px）
        const near = layoutLabels([L('imp', CX, CY, { important: true }), L('other', CX + 10, CY - 4)], CX, CY);
        expect(near.get('other')).toEqual({ fit: 'mini', dy: -14 });
        // 下の縁が 12 px 下：ずらす量が 30 px になるので隠す
        const far = layoutLabels([L('imp', CX, CY, { important: true }), L('other', CX + 10, CY + 12)], CX, CY);
        expect(far.get('other')).toEqual({ fit: 'hide', dy: 0 });
    });

    it('同じ順の 2 つが重なれば、画面の中央に近い方をそのまま見せる', () => {
        const a = layoutLabels([L('near', CX + 5, CY), L('far', CX + 15, CY)], CX, CY);
        expect(a.get('near')!.fit).toBe('full');
        expect(a.get('far')!.fit).toBe('hide');
        const b = layoutLabels([L('near', CX - 5, CY), L('far', CX - 15, CY)], CX, CY);
        expect(b.get('near')!.fit).toBe('full');
        expect(b.get('far')!.fit).toBe('hide');
    });

    it('重要な武将は、中央に近いだけの名札より先に置く', () => {
        const lay = layoutLabels([L('center', CX, CY), L('imp', CX + 20, CY + 3, { important: true })], CX, CY);
        expect(lay.get('imp')!.fit).toBe('full');
        expect(lay.get('center')!.fit).not.toBe('full');
    });

    it('点滅の名札どうしが重なれば、画面の下の名札をそのままに、上の名札を上へずらす（どちらも隠さない）', () => {
        const items = [L('r1', CX, CY, { ready: true }), L('r2', CX + 30, CY + 4, { ready: true })];
        const lay = layoutLabels(items, CX, CY);
        expect(lay.get('r2')).toEqual({ fit: 'full', dy: 0 });
        expect(lay.get('r1')!.fit).toBe('full');
        expect(lay.get('r1')!.dy).toBeLessThan(0);
        expect(overlap(shownBox(items[0]!, lay.get('r1')!)!, shownBox(items[1]!, lay.get('r2')!)!)).toBe(false);
    });

    it('確認で見つかった密集（スマホの丘陵の全体表示）：点滅の 5 武将の名札は、ずらす上限に当たらず、どれも互いに重ならない', () => {
        // e2e/ability-fixes.mjs で、中央に近い順に置いたとき家康の名札が 4 つ分（56 px）ずれても忠勝の名札に重なっていた時の値
        const R = (id: string, x: number, y: number, w: number) => L(id, x, y, { w, h: 14, mw: 47, mh: 12, ready: true, important: true });
        const items = [R('a_ieyasu', 396.3, 275.5, 93), R('a_tadakatsu', 364.6, 234.5, 102), R('a_sakai', 432.3, 235.9, 102), R('a_sakakibara', 332.0, 202.6, 112), R('a_ishikawa', 396.9, 261.9, 112)];
        const lay = layoutLabels(items, 422, 195);
        const boxes = items.map((it) => shownBox(it, lay.get(it.id)!)!);
        for (const it of items) expect(lay.get(it.id)!.dy).toBeGreaterThan(-4 * 14);
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
    });

    it('戻すときは少し余裕を見る（境目で毎フレーム切り替わらない）：前に隠した名札は、すき間が余白 + 4 px 以上になってから小さく見せる', () => {
        // 小さくした名札（幅 40）の左の縁と、置いた名札の右の縁のすき間 gap
        const at = (gap: number, prev: 'hide' | 'full') => {
            const items = [L('imp', CX, CY, { important: true }), L('other', CX + 45 + gap + 20, CY, { prev })];
            return layoutLabels(items, CX, CY).get('other')!.fit;
        };
        expect(at(LABEL_GAP + 1, 'full')).toBe('mini');
        expect(at(LABEL_GAP + 1, 'hide')).toBe('hide');
        expect(at(LABEL_GAP + 6, 'hide')).toBe('mini');
    });

    it('いろいろな密集（決まった乱数で 300 通り）：選んだ・点滅の名札はいつもそのまま見え、見えている名札はどれも選んだ・点滅の名札に重ならない', () => {
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        for (let n = 0; n < 300; n++) {
            const items: LabelLayoutItem[] = [];
            const count = 6 + Math.floor(rnd() * 14);
            for (let i = 0; i < count; i++) {
                const r = rnd();
                items.push(
                    L(`u${i}`, CX + (rnd() - 0.5) * 260, CY + (rnd() - 0.5) * 120, {
                        w: 50 + rnd() * 80,
                        sel: i === 0 && r < 0.5,
                        ready: i > 0 && i < 4 && rnd() < 0.6,
                        important: rnd() < 0.4,
                    }),
                );
            }
            const lay = layoutLabels(items, CX, CY);
            const keep = items.filter((it) => it.sel || it.ready);
            const keepBoxes = keep.map((it) => shownBox(it, lay.get(it.id)!)!);
            for (const it of keep) expect(lay.get(it.id)!.fit).toBe('full');
            const others = items.filter((it) => !it.sel && !it.ready);
            const shown = others.map((it) => shownBox(it, lay.get(it.id)!)).filter((b): b is Box => !!b);
            for (const b of shown) for (const k of keepBoxes) expect(overlap(b, k)).toBe(false);
            // 選んだ・点滅でない名札どうしも重ならない
            for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(overlap(shown[i]!, shown[j]!)).toBe(false);
        }
    });
});
