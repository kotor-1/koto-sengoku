/**
 * 作戦の比べの「記録」（docs/chapter2-request.md【1. 判断待ち事項】：「この台本が必ず負ける」を機能の必須の合格条件にしない）。
 *
 * 正面突破・無計画な押し込みなど、特定の台本の勝敗・損害・所要時間は expect にせず、ここで記録として出す（数字はテストのコメントにも残す）。
 * 合格条件に残すのは、地形の効果・目標の判定・移動や命令の正常な動き（必須）と、作戦どうしの相対の比べ（「作戦の比べ」の describe）。
 * 目標を無視した手順の失敗（何もしない・荷駄をすぐ退かせる・触れるだけ・目標の前の全軍撤退・総大将の喪失など）の確かめは、目標の判定として残す。
 *
 * RECORD_LOG=1 npx vitest run <ファイル> で数字を出す（コメントの数字を作り直すとき）。ふだんは何も出さない。
 */
const ENV = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const RECORD_LOG = !!ENV?.RECORD_LOG;

const fmt = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : Array.isArray(v) ? v.map(fmt).join(',') : String(v));

/** 記録を 1 行出す（RECORD_LOG のときだけ）。合格条件にはしない */
export function logRecord(label: string, values: Record<string, unknown>): void {
    if (!RECORD_LOG) return;
    console.log(`[記録] ${label}：${Object.entries(values)
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join('・')}`);
}

/** 勝敗の順（比べに使う。勝ち ＞ 撤退 ＞ 負け） */
export function outcomeRank(result: string | null | undefined): number {
    return result === 'victory' ? 2 : result === 'retreat' ? 1 : 0;
}
