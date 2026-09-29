/**
 * 合戦の画面の決まりごと（proto3d/src/battle/control.ts）のテスト：
 * 兵の人形の数・隊列・兵が減ったときの抜け方・斬り合いの寄せ・地図を押したときの動作・札と結果の言葉・カメラの範囲。
 */
import { describe, expect, it } from 'vitest';
import {
    CAM,
    FORMATION,
    MAX_FIGURES,
    REASON_TEXT,
    armySummary,
    cardModel,
    clampCam,
    clashShift,
    eventTone,
    figureCount,
    fmtClock,
    formationExtent,
    formationSlots,
    keepOrder,
    moraleTone,
    orderAck,
    refusalText,
    resolveTap,
    resultRows,
    type Selected,
} from '../proto3d/src/battle/control';
import { createBattle, issueOrder, orderAllRetreat, runToEnd, unitById } from '../proto3d/src/battle/sim';
import { BORDER_FIELD, demoSetup } from '../proto3d/src/battle/maps';
import { hqAloneScript, planScript } from '../proto3d/src/battle/scripts';
import type { UnitKind } from '../proto3d/src/battle/types';

describe('兵の人形の数', () => {
    it('兵 25 人ごとに 1 体、最大 30 体。兵が 1 人でもいれば 1 体', () => {
        expect(figureCount(0)).toBe(0);
        expect(figureCount(0.6)).toBe(0);
        expect(figureCount(1)).toBe(1);
        expect(figureCount(25)).toBe(1);
        expect(figureCount(26)).toBe(2);
        expect(figureCount(500)).toBe(20);
        expect(figureCount(750)).toBe(MAX_FIGURES);
        expect(figureCount(5000)).toBe(MAX_FIGURES);
        expect(figureCount(Number.NaN)).toBe(0);
    });
});

describe('隊列', () => {
    const kinds: UnitKind[] = ['yari', 'yumi', 'kiba', 'honjin'];
    it('どの種類・数でも、数どおりに並び、横に中央ぞろえ', () => {
        for (const k of kinds) {
            for (let n = 1; n <= MAX_FIGURES; n++) {
                const s = formationSlots(k, n);
                expect(s).toHaveLength(n);
                const rows = new Map<number, number[]>();
                for (const p of s) rows.set(p.row, [...(rows.get(p.row) ?? []), p.x]);
                for (const xs of rows.values()) expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length)).toBeLessThan(1e-9);
            }
        }
    });
    it('槍は 3 列・弓は 2 列の横長、最前列（row 0）が前（-z）', () => {
        const yari = formationSlots('yari', 20);
        expect(Math.max(...yari.map((p) => p.row))).toBe(2);
        const yumi = formationSlots('yumi', 14);
        expect(Math.max(...yumi.map((p) => p.row))).toBe(1);
        const front = yari.filter((p) => p.row === 0);
        const back = yari.filter((p) => p.row === 2);
        expect(front[0].z).toBeLessThan(back[0].z);
        // 横の間隔
        expect(front[1].x - front[0].x).toBeCloseTo(FORMATION.yari.dx);
    });
    it('本陣は四角く固まる', () => {
        const s = formationSlots('honjin', 12);
        expect(new Set(s.map((p) => p.row)).size).toBe(3);
    });
    it('広がりは人形が多いほど大きい', () => {
        const a = formationExtent('yari', 8);
        const b = formationExtent('yari', 30);
        expect(b.halfW).toBeGreaterThan(a.halfW);
        expect(a.halfD).toBeGreaterThan(0);
    });
    it('兵が減ると後ろの列から抜ける（最前列は最後まで残りやすい）。同じ部隊はいつも同じ順', () => {
        const s = formationSlots('yari', 24);
        const k = keepOrder(s, 'a_genzo');
        expect([...k].sort((x, y) => x - y)).toEqual(s.map((_, i) => i));
        expect(keepOrder(s, 'a_genzo')).toEqual(k);
        const pos = (row: number) => {
            const idx = k.map((slot, order) => ({ slot, order })).filter((o) => s[o.slot].row === row);
            return idx.reduce((a, o) => a + o.order, 0) / idx.length;
        };
        expect(pos(0)).toBeLessThan(pos(2));
    });
});

describe('斬り合いの見た目の寄せ', () => {
    it('離れていれば前の列が触れ合う所まで寄せる（上限 9 m）。重なっていれば寄せない', () => {
        expect(clashShift(10, 5, 5)).toBe(0);
        expect(clashShift(20, 4, 4)).toBeCloseTo((20 - 8 - 1.2) / 2);
        expect(clashShift(60, 4, 4)).toBe(9);
    });
});

describe('地図を押したとき', () => {
    const ally: Selected = { id: 'a_genzo', side: 'ally', commandable: true };
    const gone: Selected = { id: 'a_genzo', side: 'ally', commandable: false };
    const enemySel: Selected = { id: 'e_sente', side: 'enemy', commandable: false };
    const enemy = { kind: 'unit' as const, unitId: 'e_sente', side: 'enemy' as const, x: 3, z: -50 };
    const friend = { kind: 'unit' as const, unitId: 'a_hq', side: 'ally' as const, x: 0, z: 110 };
    const ground = { kind: 'ground' as const, x: 12, z: 34 };
    it('味方を押すと選ぶ（命令の途中でも選び直し）。選んでいる部隊をもう一度押すと外す', () => {
        expect(resolveTap(null, 'none', friend)).toEqual({ type: 'select', unitId: 'a_hq' });
        expect(resolveTap(ally, 'attack', friend)).toEqual({ type: 'select', unitId: 'a_hq' });
        const hqSel: Selected = { id: 'a_hq', side: 'ally', commandable: true };
        expect(resolveTap(hqSel, 'none', friend)).toEqual({ type: 'deselect' });
        expect(resolveTap(hqSel, 'move', friend)).toEqual({ type: 'select', unitId: 'a_hq' });
    });
    it('味方を選んで敵を押すと攻撃。「移動」の途中ならその地点へ移動', () => {
        expect(resolveTap(ally, 'none', enemy)).toEqual({ type: 'order', unitId: 'a_genzo', order: { type: 'attack', targetId: 'e_sente' } });
        expect(resolveTap(ally, 'attack', enemy)).toEqual({ type: 'order', unitId: 'a_genzo', order: { type: 'attack', targetId: 'e_sente' } });
        expect(resolveTap(ally, 'move', enemy)).toEqual({ type: 'order', unitId: 'a_genzo', order: { type: 'move', x: 3, z: -50 } });
    });
    it('味方を選んでいないとき・命令できない味方のとき、敵を押すと調べる', () => {
        expect(resolveTap(null, 'none', enemy)).toEqual({ type: 'inspect', unitId: 'e_sente' });
        expect(resolveTap(gone, 'none', enemy)).toEqual({ type: 'inspect', unitId: 'e_sente' });
    });
    it('味方を選んで地面を押すと移動。「攻撃」の途中なら案内だけ', () => {
        expect(resolveTap(ally, 'none', ground)).toEqual({ type: 'order', unitId: 'a_genzo', order: { type: 'move', x: 12, z: 34 } });
        expect(resolveTap(ally, 'move', ground)).toEqual({ type: 'order', unitId: 'a_genzo', order: { type: 'move', x: 12, z: 34 } });
        expect(resolveTap(ally, 'attack', ground).type).toBe('hint');
    });
    it('命令できない味方・敵を選んでいて地面を押すと、選択を外す。何も選んでいなければ何もしない', () => {
        expect(resolveTap(gone, 'none', ground)).toEqual({ type: 'deselect' });
        expect(resolveTap(enemySel, 'none', ground)).toEqual({ type: 'deselect' });
        expect(resolveTap(null, 'none', ground)).toEqual({ type: 'none' });
    });
});

describe('札・条件・知らせの言葉', () => {
    it('着く前の別働隊は「到着待ち」、ほかは戦える。全軍撤退の後は命令できない', () => {
        const s = createBattle(demoSetup('tashiro'));
        const cav = cardModel(s, unitById(s, 'a_tashiro')!);
        expect(cav.badge).toBe('到着待ち');
        expect(cav.orderText).toContain('到着待ち');
        expect(cav.commandable).toBe(true);
        const g = cardModel(s, unitById(s, 'a_genzo')!);
        expect(g).toMatchObject({ name: '源蔵隊', kind: '槍', strength: 500, strengthRatio: 1, morale: 80, moraleTone: 'good', badge: '', engageText: 'なし', commandable: true });
        expect(issueOrder(s, 'a_genzo', { type: 'attack', targetId: 'e_sente' })).toBe(true);
        expect(cardModel(s, unitById(s, 'a_genzo')!).orderText).toBe('攻撃：鷲尾先手');
        orderAllRetreat(s);
        expect(cardModel(s, unitById(s, 'a_genzo')!).commandable).toBe(false);
    });
    it('士気の色分け', () => {
        expect(moraleTone(80)).toBe('good');
        expect(moraleTone(40)).toBe('mid');
        expect(moraleTone(20)).toBe('low');
    });
    it('両軍の様子（本陣・本陣以外で戦える部隊）', () => {
        const s = createBattle(demoSetup('omori'));
        expect(armySummary(s, 'enemy')).toEqual({ hq: '健在', able: 3, total: 3 });
        expect(armySummary(s, 'ally')).toEqual({ hq: '健在', able: 3, total: 3 });
    });
    it('残り時間の表示', () => {
        expect(fmtClock(480)).toBe('8:00');
        expect(fmtClock(59.2)).toBe('1:00');
        expect(fmtClock(5)).toBe('0:05');
        expect(fmtClock(-3)).toBe('0:00');
    });
    it('命令を出せなかった理由・出した知らせ', () => {
        const s = createBattle(demoSetup('omori'));
        // 林の中の田代騎馬隊（敵）は見えていない
        expect(issueOrder(s, 'a_genzo', { type: 'attack', targetId: 'e_tashiro' })).toBe(false);
        expect(refusalText(s, 'a_genzo', { type: 'attack', targetId: 'e_tashiro' })).toBe('その部隊は見えていません');
        expect(orderAck(s, 'a_genzo', { type: 'attack', targetId: 'e_sente' })).toBe('源蔵隊：鷲尾先手へ攻撃');
        expect(orderAck(s, 'a_genzo', { type: 'hold' })).toBe('源蔵隊：防衛・待機');
        orderAllRetreat(s);
        expect(refusalText(s, 'a_genzo', { type: 'hold' })).toBe('全軍撤退の最中です');
    });
    it('知らせの色分け：味方の敗走は悪い、敵の敗走・味方が側面を突いたのは良い', () => {
        const s = createBattle(demoSetup('tashiro'));
        expect(eventTone(s, { t: 1, kind: 'rout', text: '', unitId: 'a_genzo' })).toBe('bad');
        expect(eventTone(s, { t: 1, kind: 'rout', text: '', unitId: 'e_sente' })).toBe('good');
        expect(eventTone(s, { t: 1, kind: 'flank', text: '', unitId: 'a_tashiro', targetId: 'e_hq' })).toBe('good');
        expect(eventTone(s, { t: 1, kind: 'rear', text: '', unitId: 'e_omori', targetId: 'a_shinpachi' })).toBe('bad');
        expect(eventTone(s, { t: 1, kind: 'spotted', text: '', unitId: 'e_omori' })).toBe('warn');
        expect(eventTone(s, { t: 0, kind: 'start', text: '' })).toBeNull();
        expect(eventTone(s, { t: 9, kind: 'end', text: '' })).toBeNull();
    });
});

describe('結果の表', () => {
    it('敗北（本陣だけで突っ込む）：部隊ごとの最初と最後の兵・失った兵・状態。敗北の文は討死と同じにしない', () => {
        const s = createBattle(demoSetup('alone'));
        const o = runToEnd(s, hqAloneScript());
        expect(o.result).toBe('defeat');
        const { rows, lost, start } = resultRows(s, o);
        expect(rows).toHaveLength(s.units.length);
        const hq = rows.find((r) => r.id === 'a_hq')!;
        expect(hq.name).toBe('若殿本陣');
        expect(hq.status).toBe('敗走');
        expect(hq.end).toBeGreaterThan(0);
        expect(lost.ally).toBe(rows.filter((r) => r.side === 'ally').reduce((a, r) => a + r.lost, 0));
        expect(start.enemy).toBe(350 + 550 + 350 + 350);
        expect(REASON_TEXT[o.reason]).toContain('落ち延び');
    });
    it('勝利（別働隊の回り込み）：健在の部隊は「健在」', () => {
        const s = createBattle(demoSetup('tashiro'));
        const o = runToEnd(s, planScript('tashiro'));
        expect(o.result).toBe('victory');
        const rows = resultRows(s, o).rows;
        expect(rows.find((r) => r.id === 'a_hq')!.status).toBe('健在');
    });
});

describe('見下ろしカメラ', () => {
    it('戦場の外を見に行きすぎない・寄りすぎない・引きすぎない', () => {
        const c = clampCam({ tx: 999, tz: -999, dist: 5 }, BORDER_FIELD, 500);
        expect(c.tx).toBe(BORDER_FIELD.width / 2);
        expect(c.tz).toBe(-BORDER_FIELD.depth / 2 - 20);
        expect(c.dist).toBe(CAM.minDist);
        expect(clampCam({ tx: 0, tz: 0, dist: 9999 }, BORDER_FIELD, 500).dist).toBe(500);
    });
});
