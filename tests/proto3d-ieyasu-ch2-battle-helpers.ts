/**
 * 第二章の合戦の釣り合いのテスト（tests/proto3d-ieyasu-ch2-battle-{oda,asai,home}.test.ts）の道具。
 *
 * どれも「早送り」：第一章の結果の段階（chapter2/scripts.ts の ch2TierInput）から合戦の設定を作り、作戦の台本（CH2_TACTICS。
 * 画面で出せる命令だけ：移動・攻撃・防衛・撤退・全軍撤退・能力）を runToEnd で最後まで進める（画面の操作ではない）。
 * 16 通りのずらし（乱数の種 7。時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ）で数える。
 */
import { createBattle, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import type { BattleOutcome } from '../proto3d/src/battle/types';
import { ch2BattleSetup, type Ch2BattleInfo, type Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { ch2TacticScript, ch2TierInput, type Ch2Tier } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import type { Policy } from '../proto3d/src/campaign/ieyasu1570/state';

export interface Ch2Run {
    o: BattleOutcome;
    /** 終わった時刻（秒） */
    t: number;
    /** 味方の兵の損害の割合（物語の味方＝織田勢・浅井勢・村の衆を含む） */
    loss: number;
    /** 徳川の部隊だけの損害の割合 */
    tokLoss: number;
    /** 最後に残った味方の部隊（戦える・離脱した）の数と、味方の部隊の数 */
    standing: number;
    allies: number;
    /** 副目標の id → 果たした */
    sec: Record<string, boolean>;
    /** 出した命令の時刻・断られた命令 */
    cmds: number[];
    refused: string[];
    s: BattleState;
}

export const won = (r: Ch2Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;

/** 合戦の設定（同じ入力なら同じ物を返す） */
const infos = new Map<string, Ch2BattleInfo>();
export function ch2Info(policy: Policy, plan: Ch2Plan, tier: Ch2Tier, tweak?: (i: ReturnType<typeof ch2TierInput>) => void, key = ''): Ch2BattleInfo {
    const k = `${policy}/${plan}/${tier}/${key}`;
    let info = infos.get(k);
    if (!info) {
        const input = ch2TierInput(policy, plan, tier);
        tweak?.(input);
        info = ch2BattleSetup(input);
        infos.set(k, info);
    }
    return info;
}

/** 1 回（揺らぎ k。省けば揺らぎ無し） */
export function playCh2(info: Ch2BattleInfo, policy: Policy, tactic: string, k?: number): Ch2Run {
    const s = createBattle(info.setup);
    const sc = ch2TacticScript(policy, tactic, info.setup, k);
    const o = runToEnd(s, sc);
    const al = o.units.filter((u) => u.side === 'ally');
    const tok = al.filter((u) => u.clan === 'tokugawa' && u.id.startsWith('t_'));
    const sum = (a: typeof al, f: (u: (typeof al)[number]) => number) => a.reduce((x, u) => x + f(u), 0);
    return {
        o,
        t: s.t,
        loss: 1 - sum(al, (u) => u.endStrength) / sum(al, (u) => u.startStrength),
        tokLoss: 1 - sum(tok, (u) => u.endStrength) / Math.max(1, sum(tok, (u) => u.startStrength)),
        standing: al.filter((u) => u.status === 'ready' || u.status === 'withdrawn').length,
        allies: al.length,
        sec: Object.fromEntries((o.objectives?.secondary ?? []).map((x) => [x.id, x.achieved])),
        cmds: sc.log.cmds,
        refused: sc.log.refused,
        s,
    };
}

/** 16 通り（覚えておく） */
const memo = new Map<string, Ch2Run[]>();
export function sixteenCh2(policy: Policy, plan: Ch2Plan, tier: Ch2Tier, tactic: string, tweak?: (i: ReturnType<typeof ch2TierInput>) => void, key = ''): Ch2Run[] {
    const k = `${policy}/${plan}/${tier}/${tactic}/${key}`;
    let rs = memo.get(k);
    if (!rs) {
        const info = ch2Info(policy, plan, tier, tweak, key);
        rs = Array.from({ length: 16 }, (_, i) => playCh2(info, policy, tactic, i));
        memo.set(k, rs);
    }
    return rs;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

export interface Ch2Summary {
    wins: number;
    /** 勝った回の平均の時間（勝ちが無ければ null） */
    winSec: number | null;
    loss: number;
    tokLoss: number;
    standing: number;
    /** 副目標の id → 果たした回数 */
    sec: Record<string, number>;
    /** 副目標を果たした回数の合計 */
    secTotal: number;
}
export function summarize(rs: Ch2Run[]): Ch2Summary {
    const ws = rs.filter(won);
    const sec: Record<string, number> = {};
    for (const r of rs) for (const [id, a] of Object.entries(r.sec)) sec[id] = (sec[id] ?? 0) + (a ? 1 : 0);
    return {
        wins: ws.length,
        winSec: ws.length ? mean(ws.map((r) => r.t)) : null,
        loss: mean(rs.map((r) => r.loss)),
        tokLoss: mean(rs.map((r) => r.tokLoss)),
        standing: mean(rs.map((r) => r.standing)),
        sec,
        secTotal: Object.values(sec).reduce((a, b) => a + b, 0),
    };
}
export function fmt(x: Ch2Summary): string {
    const p = (v: number) => `${(v * 100).toFixed(1)}%`;
    return `${x.wins}/16 勝・${x.winSec === null ? '—' : `${x.winSec.toFixed(0)} 秒`}・損害 ${p(x.loss)}（徳川 ${p(x.tokLoss)}）・残る ${x.standing.toFixed(1)}・副目標 ${Object.values(x.sec).join('／')}`;
}

/** 10 秒のうちに出した命令の数の最大 */
export const densest = (r: Ch2Run) => Math.max(0, ...r.cmds.map((t) => r.cmds.filter((u) => u >= t - 1e-9 && u < t + 10 - 1e-9).length));

/** CH2_LOG=1 で数字を出す（docs/chapter2-battles.md の表を作るとき） */
const LOG = !!(globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CH2_LOG;
export const log = (...a: unknown[]) => LOG && console.log(...a);
