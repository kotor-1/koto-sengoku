/**
 * 合戦の道探し（純粋な TypeScript。乱数なし）。通れない所（深い川・崖・通れる範囲の外）がある戦場だけで使う。
 *
 * - 戦場を 5 m の格子に分け、格子の中心で「通れるか」と「動きの速さ」を決める。
 * - 道は A*（8 方向。斜めは角を削らない）。1 マスの重みは「距離 ÷ 速さ」（速い道・遅い浅瀬を地形の速さで比べる）。
 * - 見つけた道は、まっすぐ行ける所（通れて、途中の速さが元の道より遅くならず、かかる時間が元の道の SMOOTH_SLACK 倍を超えない所）を飛ばして短くする。
 * - 行き先へまっすぐ行ける（途中に出発点・行き先より遅い所が無い）ときも、まっすぐの方がかかる時間で A* の道より
 *   STRAIGHT_SLACK 倍より遅ければ、A* の道を使う（行き先が水田の中でも、街道・畦道を回る方がずっと早ければ回る）。
 * - 行き先が通れない所なら、いちばん近い通れる格子の中心へ向かう。
 * - 第3群の動きの直し（buildNav の refined。FieldRules.refinedMoves の戦場だけ。既存の 10 戦場は今までどおり）：
 *   - 出発点・行き先の格子の中心がとても遅い地形（SLOW_TERRAIN 未満。泥など）でも、その点そのものが速い地形（乾いた足場・土手道）なら、
 *     隣の格子のうち、その点の速さ以上でいちばん近い格子を出発・行き先の格子にする（幅 24 m の土手道の縁 x=10 の行き先が、中心 12.5 の
 *     泥の升に入って、泥をまっすぐ突っ切らないように）。
 *   - 出発点がとても遅い地形の中なら、道を短くする区間のかかる時間の上限を SMOOTH_SLACK（2 倍）ではなく STRAIGHT_SLACK（1.1 倍）にする
 *     （泥の中から、土手道へ戻らずに泥を突っ切る区間を選ばない）。
 *
 * sim.ts から：buildNav（合戦の始めに 1 回）・findPath（部隊が道を作り直すとき）・isPassable・nearestPassable。
 * 同じ入力なら同じ道になる（探す順・同じ重みのときの順は決まっている）。
 */
import type { UnitKind } from './types';

/** 格子の 1 マスの大きさ（m） */
export const NAV_CELL = 5;
/**
 * 行き先へまっすぐ行く（道探しを飛ばす）のを使ってよい、かかる時間の上限（A* の道の時間に対する倍率）。
 * 格子の道は 8 方向の折れ線なので、同じ地形ならまっすぐの方が短い。地形の境目をかすめる程度の差では今までどおりまっすぐ
 * （1.1 倍まで）。道・畦道を回る方がはっきり早いときだけ回り道になる。
 */
export const STRAIGHT_SLACK = 1.1;
/**
 * 道を短くする（途中の点を飛ばす）区間の、かかる時間の上限（元の道の時間に対する倍率）。
 * 2 倍：遅い所（浅瀬・水田）に立っている部隊が、そこから遅い所をまっすぐ突っ切る区間を、速い道を回るより 2 倍以上遅いときだけ外す
 * （例：水田の中から田を突っ切るより、畦道・街道を回る方が早い）。河川・浅瀬の浅瀬の中から岸へ斜めに出る区間（元の道の 1.66 倍まで）は
 * 今までどおり飛ばす（第1群の戦場の動きを 1 刻みも変えないため）。
 */
export const SMOOTH_SLACK = 2;
/**
 * 第3群の動きの直し（refined）で「とても遅い地形」とみなす速さの倍率の上限（これ未満。泥 0.35・浅瀬 0.4・水田 0.3。林 0.5 は含めない）。
 * 出発点・行き先の格子の選び直しと、道を短くする上限を STRAIGHT_SLACK にするのは、この地形から出る道だけ
 */
export const SLOW_TERRAIN = 0.5;

export interface NavGrid {
    readonly cell: number;
    /** 格子の左上（x・z の最小）の角 */
    readonly x0: number;
    readonly z0: number;
    readonly cols: number;
    readonly rows: number;
    /** 1 なら通れない */
    readonly blocked: Uint8Array;
    /** 部隊の種類ごとの 1 マスの速さ（通れない所は 0）。必要になったときに作る */
    readonly speedOf: (kind: UnitKind) => Float32Array;
    /** 格子の中でいちばん速い速さ（A* の見積もりに使う） */
    readonly maxSpeed: number;
    /** 第3群の動きの直し（出発点・行き先の格子をその点の速さで選び直す・道を短くする上限を STRAIGHT_SLACK に）。省けば false */
    readonly refined: boolean;
    /** その点そのものの速さ（格子の中心ではなく。refined の出発点・行き先の格子の選び直しに使う） */
    readonly pointSpeed: (kind: UnitKind, x: number, z: number) => number;
    // A* の作業場所（使い回す）
    g: Float64Array;
    from: Int32Array;
    stamp: Uint32Array;
    closed: Uint32Array;
    gen: number;
    heap: Int32Array;
    heapF: Float64Array;
}

/**
 * 格子を作る。passableAt(x, z) は通れるか、speedAt(kind, x, z) はその種類の部隊の動きの速さの倍率（0 より大きい）。
 */
export function buildNav(
    width: number,
    depth: number,
    passableAt: (x: number, z: number) => boolean,
    speedAt: (kind: UnitKind, x: number, z: number) => number,
    refined = false,
): NavGrid {
    const cell = NAV_CELL;
    const cols = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(depth / cell));
    const x0 = -width / 2;
    const z0 = -depth / 2;
    const n = cols * rows;
    const blocked = new Uint8Array(n);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = x0 + (c + 0.5) * cell;
            const z = z0 + (r + 0.5) * cell;
            blocked[r * cols + c] = passableAt(x, z) ? 0 : 1;
        }
    }
    const cache = new Map<UnitKind, Float32Array>();
    let maxSpeed = 0;
    const speedOf = (kind: UnitKind): Float32Array => {
        let a = cache.get(kind);
        if (a) return a;
        a = new Float32Array(n);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                if (blocked[i]) continue;
                a[i] = Math.max(0.05, speedAt(kind, x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell));
            }
        }
        cache.set(kind, a);
        return a;
    };
    // 見積もりの上限：どの種類でも、この格子でいちばん速い倍率（道 1.2 など）を超えない
    for (const k of ['honjin', 'yari', 'yumi', 'kiba'] as UnitKind[]) {
        const a = speedOf(k);
        for (let i = 0; i < n; i++) if (a[i]! > maxSpeed) maxSpeed = a[i]!;
    }
    return {
        cell,
        x0,
        z0,
        cols,
        rows,
        blocked,
        speedOf,
        maxSpeed: maxSpeed || 1,
        refined,
        pointSpeed: (kind, x, z) => (passableAt(x, z) ? Math.max(0.05, speedAt(kind, x, z)) : 0),
        g: new Float64Array(n),
        from: new Int32Array(n),
        stamp: new Uint32Array(n),
        closed: new Uint32Array(n),
        gen: 0,
        heap: new Int32Array(n * 8 + 16),
        heapF: new Float64Array(n * 8 + 16),
    };
}

function cellOf(nav: NavGrid, x: number, z: number): number {
    const c = Math.min(nav.cols - 1, Math.max(0, Math.floor((x - nav.x0) / nav.cell)));
    const r = Math.min(nav.rows - 1, Math.max(0, Math.floor((z - nav.z0) / nav.cell)));
    return r * nav.cols + c;
}
function centerOf(nav: NavGrid, i: number): { x: number; z: number } {
    const c = i % nav.cols;
    const r = (i - c) / nav.cols;
    return { x: nav.x0 + (c + 0.5) * nav.cell, z: nav.z0 + (r + 0.5) * nav.cell };
}

/** その地点が通れるか（その地点を含む格子で決める） */
export function isPassable(nav: NavGrid, x: number, z: number): boolean {
    return nav.blocked[cellOf(nav, x, z)] === 0;
}

/** いちばん近い通れる格子の中心（その地点が通れるなら、その地点のまま） */
export function nearestPassable(nav: NavGrid, x: number, z: number): { x: number; z: number } {
    const i0 = cellOf(nav, x, z);
    if (nav.blocked[i0] === 0) return { x, z };
    // 広がる輪で探す（同じ輪の中では距離が近い順、同じ距離なら並びの順）
    const c0 = i0 % nav.cols;
    const r0 = (i0 - c0) / nav.cols;
    const maxR = Math.max(nav.cols, nav.rows);
    for (let k = 1; k <= maxR; k++) {
        let best = -1;
        let bd = Infinity;
        for (let dr = -k; dr <= k; dr++) {
            for (let dc = -k; dc <= k; dc++) {
                if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
                const r = r0 + dr;
                const c = c0 + dc;
                if (r < 0 || c < 0 || r >= nav.rows || c >= nav.cols) continue;
                const i = r * nav.cols + c;
                if (nav.blocked[i]) continue;
                const p = centerOf(nav, i);
                const d = Math.hypot(p.x - x, p.z - z);
                if (d < bd) {
                    bd = d;
                    best = i;
                }
            }
        }
        if (best >= 0) return centerOf(nav, best);
    }
    return { x, z };
}

/** a から b へ、格子の上でまっすぐ行けるか（通れない格子を踏まず、どの格子の速さも minSpeed 以上） */
function straight(nav: NavGrid, spd: Float32Array, ax: number, az: number, bx: number, bz: number, minSpeed: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (nav.cell * 0.4)));
    for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const i = cellOf(nav, ax + (bx - ax) * t, az + (bz - az) * t);
        if (nav.blocked[i] || spd[i]! < minSpeed - 1e-6) return false;
    }
    return true;
}

/**
 * a から b へまっすぐ行くときのかかる時間（straight と同じ点で速さを見て、点と点の間は両端の速さの半分ずつで足す）。
 * 通れるかは呼ぶ側が straight で確かめておく
 */
function straightTime(nav: NavGrid, spd: Float32Array, ax: number, az: number, bx: number, bz: number): number {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (nav.cell * 0.4)));
    const half = d / steps / 2;
    let t = 0;
    let prev = 1 / Math.max(0.05, spd[cellOf(nav, ax, az)]!);
    for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const cur = 1 / Math.max(0.05, spd[cellOf(nav, ax + (bx - ax) * f, az + (bz - az) * f)]!);
        t += half * (prev + cur);
        prev = cur;
    }
    return t;
}

/**
 * 第3群の動きの直し（nav.refined）：点 (x, z) を含む格子 i の中心の速さが、その点そのものの速さより遅い（升の中心は泥、点は乾いた足場の縁）なら、
 * まわり 8 つの格子のうち、通れて速さがその点の速さ以上の、点にいちばん近い格子（同じ距離なら並びの順）。無ければ i のまま
 */
function snapCell(nav: NavGrid, spd: Float32Array, kind: UnitKind, i: number, x: number, z: number): number {
    if (!nav.refined || nav.blocked[i] || spd[i]! >= SLOW_TERRAIN - 1e-6) return i;
    const want = nav.pointSpeed(kind, x, z);
    if (!(want > spd[i]! + 1e-6)) return i;
    const c0 = i % nav.cols;
    const r0 = (i - c0) / nav.cols;
    let best = i;
    let bd = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const r = r0 + dr;
            const c = c0 + dc;
            if ((dr === 0 && dc === 0) || r < 0 || c < 0 || r >= nav.rows || c >= nav.cols) continue;
            const j = r * nav.cols + c;
            if (nav.blocked[j] || spd[j]! < want - 1e-6) continue;
            const p = centerOf(nav, j);
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < bd - 1e-9) {
                bd = d;
                best = j;
            }
        }
    }
    return best;
}

/**
 * from から to への道（通る点の並び。最後の点が行き先。from は含まない）。道が無ければ null。
 * 行き先が通れない所なら、いちばん近い通れる所を行き先にする。
 */
export function findPath(
    nav: NavGrid,
    kind: UnitKind,
    fx: number,
    fz: number,
    tx: number,
    tz: number,
    /** 探す道のかかる時間の上限（A* の f がこれを超える升は広げない。省けば上限なし＝今までと同じ） */
    maxCost: number = Infinity,
): { x: number; z: number }[] | null {
    const spd = nav.speedOf(kind);
    const goalPt = nearestPassable(nav, tx, tz);
    let start = cellOf(nav, fx, fz);
    // 出発点の格子がとても遅い地形（泥など）か（第3群の直し：道を短くする上限を STRAIGHT_SLACK にする）
    const slowStart = nav.refined && !nav.blocked[start] && spd[start]! < SLOW_TERRAIN - 1e-6;
    if (nav.blocked[start]) {
        const p = nearestPassable(nav, fx, fz);
        start = cellOf(nav, p.x, p.z);
    } else start = snapCell(nav, spd, kind, start, fx, fz);
    const startSnapped = start !== cellOf(nav, fx, fz) && !nav.blocked[cellOf(nav, fx, fz)];
    const goal = snapCell(nav, spd, kind, cellOf(nav, goalPt.x, goalPt.z), goalPt.x, goalPt.z);
    if (start === goal) return [goalPt];
    // まっすぐ行けて、途中に出発点・行き先より遅い所が無ければ、まっすぐ行く候補。途中がどこも格子でいちばん速い所なら、それより早い道は無い。
    // そうでなければ A* の道と、かかる時間で比べる（下の straightT）
    let straightT = Infinity;
    if (straight(nav, spd, fx, fz, goalPt.x, goalPt.z, Math.min(spd[start]!, spd[goal]!))) {
        if (straight(nav, spd, fx, fz, goalPt.x, goalPt.z, nav.maxSpeed)) return [goalPt];
        const s0 = centerOf(nav, start);
        const g0 = centerOf(nav, goal);
        straightT = straightTime(nav, spd, s0.x, s0.z, g0.x, g0.z);
    }

    nav.gen++;
    if (nav.gen >= 0xffffffff) {
        nav.stamp.fill(0);
        nav.closed.fill(0);
        nav.gen = 1;
    }
    const gen = nav.gen;
    const { g, from, stamp, closed, heap, heapF, cols, rows, blocked } = nav;
    const cell = nav.cell;
    const inv = 1 / nav.maxSpeed;
    const gc = goal % cols;
    const gr = (goal - gc) / cols;
    const h = (i: number) => {
        const c = i % cols;
        const r = (i - c) / cols;
        const dx = Math.abs(c - gc);
        const dz = Math.abs(r - gr);
        return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * cell * inv;
    };
    let hn = 0;
    const push = (i: number, f: number) => {
        let k = hn++;
        heap[k] = i;
        heapF[k] = f;
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (heapF[p]! < heapF[k]! || (heapF[p] === heapF[k] && heap[p]! <= heap[k]!)) break;
            const ti = heap[p]!;
            const tf = heapF[p]!;
            heap[p] = heap[k]!;
            heapF[p] = heapF[k]!;
            heap[k] = ti;
            heapF[k] = tf;
            k = p;
        }
    };
    const pop = (): number => {
        const top = heap[0]!;
        hn--;
        heap[0] = heap[hn]!;
        heapF[0] = heapF[hn]!;
        let k = 0;
        for (;;) {
            const l = k * 2 + 1;
            const r = l + 1;
            let m = k;
            if (l < hn && (heapF[l]! < heapF[m]! || (heapF[l] === heapF[m] && heap[l]! < heap[m]!))) m = l;
            if (r < hn && (heapF[r]! < heapF[m]! || (heapF[r] === heapF[m] && heap[r]! < heap[m]!))) m = r;
            if (m === k) break;
            const ti = heap[m]!;
            const tf = heapF[m]!;
            heap[m] = heap[k]!;
            heapF[m] = heapF[k]!;
            heap[k] = ti;
            heapF[k] = tf;
            k = m;
        }
        return top;
    };
    stamp[start] = gen;
    g[start] = 0;
    from[start] = -1;
    push(start, h(start));
    let found = false;
    const DC = [1, -1, 0, 0, 1, 1, -1, -1];
    const DR = [0, 0, 1, -1, 1, -1, 1, -1];
    while (hn > 0) {
        const cur = pop();
        if (closed[cur] === gen) continue;
        closed[cur] = gen;
        if (cur === goal) {
            found = true;
            break;
        }
        const cc = cur % cols;
        const cr = (cur - cc) / cols;
        const sc = spd[cur]!;
        for (let k = 0; k < 8; k++) {
            const nc = cc + DC[k]!;
            const nr = cr + DR[k]!;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = nr * cols + nc;
            if (blocked[ni] || closed[ni] === gen) continue;
            const diag = k >= 4;
            // 斜めは、両脇の格子が通れるときだけ（崖の角を削らない）
            if (diag && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue;
            const len = diag ? cell * Math.SQRT2 : cell;
            const ng = g[cur]! + (len * 0.5) / sc + (len * 0.5) / spd[ni]!;
            if (stamp[ni] === gen && ng >= g[ni]!) continue;
            if (ng + h(ni) > maxCost) continue;
            stamp[ni] = gen;
            g[ni] = ng;
            from[ni] = cur;
            if (hn >= heap.length) return straightT < Infinity ? [goalPt] : null;
            push(ni, ng + h(ni));
        }
    }
    if (!found) return straightT < Infinity ? [goalPt] : null;
    // まっすぐの方が、A* の道（格子の中心から中心まで）の STRAIGHT_SLACK 倍より早ければ、まっすぐ行く（今までと同じ）
    if (straightT <= g[goal]! * STRAIGHT_SLACK) return [goalPt];
    // 格子の並び（行き先 → 出発）を逆にして、点の並びにする
    const cells: number[] = [];
    for (let i = goal; i !== -1 && i !== start; i = from[i]!) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => centerOf(nav, i));
    pts[pts.length - 1] = goalPt;
    // まっすぐ行ける所を飛ばす（途中の速さが、飛ばす区間の元の道のいちばん遅い速さより遅くならず、
    // かかる時間が元の道（格子の中心から中心までの A* の時間 g）の SMOOTH_SLACK 倍を超えないときだけ）
    const out: { x: number; z: number }[] = [];
    let ax = fx;
    let az = fz;
    let g0 = 0; // 今の点（出発点、または前の格子の中心）までの元の道の時間
    let k = 0;
    const minTo = new Float64Array(pts.length);
    const slack = slowStart ? STRAIGHT_SLACK : SMOOTH_SLACK;
    while (k < pts.length) {
        // minTo[j]：今の点から j までの元の道のいちばん遅い速さ（第3群の直しでは、出発点の速さは選び直した出発の格子の速さ）
        let m = startSnapped && k === 0 ? spd[start]! : spd[cellOf(nav, ax, az)]!;
        for (let q = k; q < pts.length; q++) {
            m = Math.min(m, spd[cells[q]!]!);
            minTo[q] = m;
        }
        let j = pts.length - 1;
        for (; j > k; j--) {
            if (!straight(nav, spd, ax, az, pts[j]!.x, pts[j]!.z, minTo[j]!)) continue;
            // 元の道が同じ速さだけなら、まっすぐの方が早い（時間を比べるまでもない）
            if (minTo[j]! >= nav.maxSpeed - 1e-6) break;
            const c = centerOf(nav, cells[j]!);
            if (straightTime(nav, spd, ax, az, c.x, c.z) <= (g[cells[j]!]! - g0) * slack + 1e-9) break;
        }
        out.push(pts[j]!);
        ax = pts[j]!.x;
        az = pts[j]!.z;
        g0 = g[cells[j]!]!;
        k = j + 1;
    }
    return out;
}

/** 通れる升のつながり（上下左右でつながる升に同じ番号。通れない升は -1）。格子ごとに 1 回だけ数える（門が開くと格子を作り直すので数え直す） */
const regionMemo = new WeakMap<NavGrid, Int32Array>();
function regionsOf(nav: NavGrid): Int32Array {
    let lab = regionMemo.get(nav);
    if (lab) return lab;
    const { cols, rows, blocked } = nav;
    const n = cols * rows;
    lab = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let id = 0;
    for (let i0 = 0; i0 < n; i0++) {
        if (blocked[i0] || lab[i0] !== -1) continue;
        let sp = 0;
        stack[sp++] = i0;
        lab[i0] = id;
        while (sp > 0) {
            const cur = stack[--sp]!;
            const c = cur % cols;
            const r = (cur - c) / cols;
            const nb = [c > 0 ? cur - 1 : -1, c < cols - 1 ? cur + 1 : -1, r > 0 ? cur - cols : -1, r < rows - 1 ? cur + cols : -1];
            for (const ni of nb) {
                if (ni < 0 || blocked[ni] || lab[ni] !== -1) continue;
                lab[ni] = id;
                stack[sp++] = ni;
            }
        }
        id++;
    }
    regionMemo.set(nav, lab);
    return lab;
}

/**
 * 道があるか（合戦の中で何度も聞く sim.ts の meleeUnreachable 用。A* を回さず、通れる升のつながりで見る）。
 * findPath は斜めに進むとき両脇の升が通れることを求めるので、上下左右のつながりと同じ。通れない所に立つ点は、いちばん近い通れる升から見る
 */
export function pathExists(nav: NavGrid, fx: number, fz: number, tx: number, tz: number): boolean {
    const lab = regionsOf(nav);
    const a = nearestPassable(nav, fx, fz);
    const b = nearestPassable(nav, tx, tz);
    return lab[cellOf(nav, a.x, a.z)] === lab[cellOf(nav, b.x, b.z)];
}

/** その点のつながりの番号（通れない所に立つ点は、いちばん近い通れる升の番号）。同じ番号の点どうしは道がある（pathExists と同じ） */
export function regionAt(nav: NavGrid, x: number, z: number): number {
    const p = nearestPassable(nav, x, z);
    return regionsOf(nav)[cellOf(nav, p.x, p.z)]!;
}

/** 種類ごとの、格子の通れる升でいちばん遅い速さ（findPathAvoiding の探す範囲の上限に使う。格子ごとに 1 回だけ数える） */
const slowestOf = new WeakMap<NavGrid, Map<UnitKind, number>>();
function slowestSpeed(nav: NavGrid, kind: UnitKind): number {
    let m = slowestOf.get(nav);
    if (!m) slowestOf.set(nav, (m = new Map()));
    let v = m.get(kind);
    if (v === undefined) {
        const spd = nav.speedOf(kind);
        v = Infinity;
        for (let i = 0; i < spd.length; i++) if (!nav.blocked[i] && spd[i]! < v) v = spd[i]!;
        if (!Number.isFinite(v)) v = 0.05;
        m.set(kind, v);
    }
    return v;
}

/**
 * 味方の隊を避けた道（第4群の設計 §1：味方だけに塞がれたときの短い迂回。sim.ts の tryAllyDetour）。avoid の円の中に中心がある升を
 * 通れないものとして findPath で道を探す（出発点・行き先の升は塞がない）。格子はすぐ元に戻す。道が無ければ null。
 * maxLen（道の長さの上限。m）を渡すと、それより長い道しか無いときに格子の全体を探さずに打ち切る（null）：長さ maxLen 以内の道は、格子の
 * 升をたどる道（8 方向の歩みの分 1.0824 倍に余裕を見て 1.1 倍と、升への寄せ・角の升 4 つ分を足した長さ）を、いちばん遅い升の速さで歩いた時間を超えない。
 * その時間を A* の上限（findPath の maxCost）にするので、長さ maxLen 以内の道があれば、上限の無いときと同じ道を返す
 * （第4群の確かめの指摘：見つからない場合に城下町外縁で 1 回 3.4 ms かかっていた）
 */
export function findPathAvoiding(
    nav: NavGrid,
    kind: UnitKind,
    fx: number,
    fz: number,
    tx: number,
    tz: number,
    avoid: readonly { x: number; z: number; r: number }[],
    maxLen: number = Infinity,
): { x: number; z: number }[] | null {
    const maxCost = Number.isFinite(maxLen) ? (maxLen * 1.1 + nav.cell * 4 * Math.SQRT2) / slowestSpeed(nav, kind) : Infinity;
    // 速さの表は塞ぐ前に作っておく（塞いだ升の速さを 0 のまま覚えないように。buildNav が 4 種類とも作るので、ふつうは作り済み）
    nav.speedOf(kind);
    const keepA = cellOf(nav, fx, fz);
    const g = nearestPassable(nav, tx, tz);
    const keepB = cellOf(nav, g.x, g.z);
    const changed: number[] = [];
    for (const c of avoid) {
        const c0 = Math.max(0, Math.floor((c.x - c.r - nav.x0) / nav.cell));
        const c1 = Math.min(nav.cols - 1, Math.floor((c.x + c.r - nav.x0) / nav.cell));
        const r0 = Math.max(0, Math.floor((c.z - c.r - nav.z0) / nav.cell));
        const r1 = Math.min(nav.rows - 1, Math.floor((c.z + c.r - nav.z0) / nav.cell));
        for (let r = r0; r <= r1; r++) {
            for (let k = c0; k <= c1; k++) {
                const i = r * nav.cols + k;
                if (nav.blocked[i] || i === keepA || i === keepB) continue;
                const p = centerOf(nav, i);
                if (Math.hypot(p.x - c.x, p.z - c.z) >= c.r) continue;
                nav.blocked[i] = 1;
                changed.push(i);
            }
        }
    }
    try {
        return findPath(nav, kind, fx, fz, tx, tz, maxCost);
    } finally {
        for (const i of changed) nav.blocked[i] = 0;
    }
}

/** start から goal まで道があるか（戦場データの検査用） */
export function reachable(nav: NavGrid, kind: UnitKind, fx: number, fz: number, tx: number, tz: number): boolean {
    if (!isPassable(nav, tx, tz)) return false;
    return findPath(nav, kind, fx, fz, tx, tz) !== null;
}
