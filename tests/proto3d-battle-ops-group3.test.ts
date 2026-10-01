/**
 * 第3群の前に整える操作（docs/fields-group3-design.md §2-2）のうち、画面の決まり（control.ts）で確かめられる分：
 * - 畳んだ目標の欄の見出し（objectiveSummaryText）：主目標の進みを 1 行で。数を含む短い括弧（「（あと 2）」など）は残す。
 *   既存の 10 戦場では、前の書き方（括弧の中をすべて省く）と同じ文になる。
 * 移動先指定・対象選びの優先は tests/proto3d-battle-control.test.ts、号令の確かめは tests/proto3d-battle-rally-check.test.ts。
 * 早送り（stepBattle で時間を進める。命令は出さない）と、文を直接与えるテスト。
 */
import { describe, expect, it } from 'vitest';
import { objectivePanelModel, objectiveSummaryText, type ObjectiveRowModel } from '../proto3d/src/battle/control';
import { createBattle, stepBattle } from '../proto3d/src/battle/sim';
import { buildBattleSetup, practiceFields } from '../proto3d/src/battle/fields';

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
    });
});
