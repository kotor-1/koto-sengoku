/**
 * 第3群の前に整える操作（docs/fields-group3-design.md §2-2）のうち、画面の決まり（control.ts）で確かめられる分：
 * - 畳んだ目標の欄の見出し（objectiveSummaryText）：主目標の進みを 1 行で。数を含む短い括弧（「（あと 2）」など）は残す。
 *   既存の 10 戦場では、前の書き方（括弧の中をすべて省く）と同じ文になる。
 * - 移動先指定（§2-1）で、通れない所（第3群の家屋の中）を押したとき：命令は押した点で出し、issueOrder が近くの通れる所へ直す（状態を直接見るテスト）。
 * 移動先指定・対象選びの優先は tests/proto3d-battle-control.test.ts、号令の確かめは tests/proto3d-battle-rally-check.test.ts。
 * 早送り（stepBattle で時間を進める。命令は出さない）と、文を直接与えるテスト。
 */
import { describe, expect, it } from 'vitest';
import { objectivePanelModel, objectiveSummaryText, resolveTap, type ObjectiveRowModel } from '../proto3d/src/battle/control';
import { createBattle, issueOrder, stepBattle, unitById } from '../proto3d/src/battle/sim';
import { buildBattleSetup, practiceFields } from '../proto3d/src/battle/fields';
import { isPassable } from '../proto3d/src/battle/pathfind';

const row = (progressText: string, state: ObjectiveRowModel['state'] = 'active' as ObjectiveRowModel['state']): ObjectiveRowModel => ({
    id: 'p',
    role: 'primary',
    label: '主目標',
    state,
    progressText,
    tone: 'progress',
});
/** 前の見出しの書き方（battleUi.ts の updateGoals にあったもの） */
const oldSummary = (p: ObjectiveRowModel | null) => (p ? (p.state === 'done' ? '主目標 ✓ 達成' : p.state === 'failed' ? '主目標 ✗' : p.progressText.replace(/（[^）]*）/g, '')) : '');

describe('畳んだ目標の欄の見出し（objectiveSummaryText）', () => {
    it('数を含む短い括弧（6 字まで）は残す。長い説明・数の無い括弧は省く', () => {
        expect(objectiveSummaryText(row('突破 1／許容 3（あと 2）'))).toBe('突破 1／許容 3（あと 2）');
        expect(objectiveSummaryText(row('確保 3／60 秒（敵のいない区域に味方がいる間だけ数える）'))).toBe('確保 3／60 秒');
        expect(objectiveSummaryText(row('守っている 3／3（2 以上で残り 120 秒）・西 ○'))).toBe('守っている 3／3・西 ○');
        expect(objectiveSummaryText(row('段階 1／2（門）'))).toBe('段階 1／2');
        // 段階目標：段の名前を省いて、今の段の数を前に寄せる（スマホの見出しで「…」に切れないように）
        expect(objectiveSummaryText(row('段階 1／2：外門の制圧・外門 制圧 5／20 秒・門の前に味方がいない（門の前の輪へ移動させる）（次：最初の曲輪の確保）'))).toBe(
            '段階 1／2・外門 制圧 5／20 秒・門の前に味方がいない',
        );
        expect(objectiveSummaryText(row('段階 2／2：最初の曲輪の確保・確保 12／60 秒（最後の段）'))).toBe('段階 2／2・確保 12／60 秒');
        // 同時確保：要所ごとの様子を前に出す（スマホの見出しで 2 つ目の要所が「…」に切れないように。秒は後ろ）
        expect(objectiveSummaryText(row('同時確保 0／60 秒・山門 敵・本堂前 空（すべてを敵なしで味方が占める間だけ数える）'))).toBe('山門 敵・本堂前 空・0／60 秒');
        expect(objectiveSummaryText(null)).toBe('');
        expect(objectiveSummaryText(row('x', 'done' as ObjectiveRowModel['state']))).toBe('主目標 ✓ 達成');
        expect(objectiveSummaryText(row('x', 'failed' as ObjectiveRowModel['state']))).toBe('主目標 ✗');
    });

    it('既存の 10 戦場：始め・60 秒・180 秒（早送り。命令なし）の見出しは前の書き方と同じ', () => {
        const EXISTING = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy'];
        const fields = practiceFields().filter((f) => EXISTING.includes(f.id));
        expect(fields.map((f) => f.id).sort()).toEqual([...EXISTING].sort());
        for (const f of fields) {
            const s = createBattle(buildBattleSetup(f, f.presets[0]!.id));
            for (const until of [0, 60, 180]) {
                while (s.t < until - 1e-9 && !s.result) stepBattle(s, 0.1);
                const p = objectivePanelModel(s)?.primary ?? null;
                expect(objectiveSummaryText(p), `${f.id} ${until} 秒`).toBe(oldSummary(p));
            }
        }
        // 10 戦場を 180 秒ずつ進めるので、1 本だけなら 4 秒ほど。ほかの作業者のテスト・ブラウザで負荷が高い（load 10）と 5.6 秒かかり、
        // 既定の 5 秒で時間切れになった（確かめの中身は変えない。ほかの戦場のテストと同じく時間の枠だけ広げる）
    }, 60_000);
});

describe('移動先指定で通れない所を押す（第3群の家屋）', () => {
    it('村落の庄屋の屋敷（building）の真ん中に味方が立つ所を移動先指定で押す → 選び直さず移動。行き先は屋敷の外の通れる所に直る', () => {
        const f = practiceFields().find((x) => x.id === 'village')!;
        const s = createBattle(buildBattleSetup(f, f.presets[0]!.id));
        const nav = s.field.nav!;
        expect(nav).toBeTruthy();
        // 屋敷（x -30〜30・z -12〜16）の真ん中は通れない
        expect(isPassable(nav, 0, 2)).toBe(false);
        const allies = s.units.filter((u) => u.side === 'ally' && !u.isHq);
        const mover = allies[0]!;
        const other = s.units.find((u) => u.side === 'ally' && u.id !== mover.id)!;
        // 押した所に別の味方の体がある（行き先に味方が立っている）想定
        const act = resolveTap({ id: mover.id, side: 'ally', commandable: true }, 'move', { kind: 'unit', unitId: other.id, side: 'ally', x: 0, z: 2 });
        expect(act).toEqual({ type: 'order', unitId: mover.id, order: { type: 'move', x: 0, z: 2 } });
        if (act.type !== 'order') return;
        expect(issueOrder(s, act.unitId, act.order)).toBe(true);
        const o = unitById(s, mover.id)!.order;
        expect(o.type).toBe('move');
        if (o.type !== 'move') return;
        // 近くの通れる所（屋敷の外。押した点から屋敷の半分の奥行き＋格子 1 つほど）
        expect(isPassable(nav, o.x, o.z)).toBe(true);
        expect(Math.hypot(o.x - 0, o.z - 2)).toBeLessThan(25);
        // 指定なしで同じ所を押すと、今までどおりその味方を選ぶ
        expect(resolveTap({ id: mover.id, side: 'ally', commandable: true }, 'none', { kind: 'unit', unitId: other.id, side: 'ally', x: 0, z: 2 })).toEqual({ type: 'select', unitId: other.id });
    });
});
