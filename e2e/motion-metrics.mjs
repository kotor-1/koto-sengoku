/**
 * 主人公の足運びの測り（e2e/motion-probe.mjs が集めた毎コマの値）の集計。単独でも動く：
 *   node e2e/motion-metrics.mjs <motion-<ラベル>.json>
 * - 着いた足：足の裏の「かかと」「母指球」の点のうち低い方が、前後 2 コマとも地面から 2cm 以内で、上下の速さが 0.15m/秒 未満の足
 *  （振り出した足が地面すれすれを通るコマは数えない）。その点の水平の速さを数える。
 * - 体の向き：描いた主人公の根の向き（rotation.y）の 1 コマの変化の最大（度）。
 * - 腰の高さ：Hips の骨の高さ − 腰の下の地面（最小・最大）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const R2 = (v) => Math.round(v * 100) / 100;
/** 足の裏の点（かかと・母指球・足先。足先が無い記録はかかと・母指球）のうち低いもの */
const lowest = (f) => ['heel', 'ball', 'tip'].filter((k) => f[k]).reduce((m, k) => (f[k][2] < f[m][2] ? k : m), 'heel');
const R3 = (v) => Math.round(v * 1000) / 1000;

export function footStats(rows, dt) {
    const speeds = [];
    let slide = 0;
    for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1];
        const b = rows[i];
        if (!a.L || !b.L) continue;
        for (const s of ['L', 'R']) {
            const pb = lowest(b[s]);
            // 地面に着く点が移った（踵 → 足裏 → 足先へ転がった）コマは数えない（意図した転がり）
            if (lowest(a[s]) !== pb) continue;
            const ha = a[s][pb];
            const hb = b[s][pb];
            if (ha[2] > 0.02 || hb[2] > 0.02) continue;
            if (Math.abs(hb[2] - ha[2]) / dt > 0.15) continue;
            const v = Math.hypot(hb[0] - ha[0], hb[1] - ha[1]) / dt;
            speeds.push(v);
            if (v > 0.3) slide += v * dt;
        }
    }
    speeds.sort((x, y) => x - y);
    const q = (p) => (speeds.length ? speeds[Math.min(speeds.length - 1, Math.floor(p * speeds.length))] : 0);
    return { n: speeds.length, max: R2(q(1)), p95: R2(q(0.95)), over: R2(speeds.filter((v) => v > 0.3).length / Math.max(1, speeds.length)), slideM: R3(slide) };
}

export function rotStats(rows) {
    let max = 0;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].yaw === undefined || rows[i - 1].yaw === undefined) continue;
        const d = Math.abs(Math.atan2(Math.sin(rows[i].yaw - rows[i - 1].yaw), Math.cos(rows[i].yaw - rows[i - 1].yaw)));
        max = Math.max(max, d);
    }
    return R2((max * 180) / Math.PI);
}

export function hipStats(rows) {
    const ys = rows.map((r) => r.hipY).filter((v) => v !== undefined);
    if (!ys.length) return null;
    return [R3(Math.min(...ys)), R3(Math.max(...ys))];
}

/** 場面ごと・区切り（tag）ごとの集計 */
export function summarize(scenarios, dt) {
    const summary = {};
    for (const sc of scenarios) {
        const tags = [...new Set(sc.rows.map((r) => r.tag))];
        const per = {};
        for (const tag of tags) {
            const rows = sc.rows.filter((r) => r.tag === tag);
            per[tag] = { foot: footStats(rows, dt), rotMaxDeg: rotStats(rows), hip: hipStats(rows) };
        }
        summary[sc.name] = { all: { foot: footStats(sc.rows, dt), rotMaxDeg: rotStats(sc.rows), hip: hipStats(sc.rows) }, ...per };
    }
    return summary;
}

/** 表（1 場面 1 行：区切りごとの 着いた足の最大/95% m/秒、体の向きの最大 °/コマ） */
export function table(summary) {
    const lines = [];
    for (const [name, s] of Object.entries(summary)) {
        const parts = Object.entries(s)
            .filter(([k]) => k !== 'all')
            .map(([k, v]) => `${k} ${v.foot.max}/${v.foot.p95}`);
        lines.push(`${name}: rot ${s.all.rotMaxDeg}° hip ${JSON.stringify(s.all.hip)} | ${parts.join(' | ')}`);
    }
    return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const s = summarize(d.scenarios, d.dt);
    console.log(table(s));
}
