/**
 * 合戦の道探し（純粋な TypeScript。乱数なし）。通れない所（深い川・崖・通れる範囲の外）がある戦場だけで使う。
 *
 * - 戦場を 5 m の格子に分け、格子の中心で「通れるか」と「動きの速さ」を決める。
 * - 道は A*（8 方向。斜めは角を削らない）。1 マスの重みは「距離 ÷ 速さ」（速い道・遅い浅瀬を地形の速さで比べる）。
 * - 見つけた道は、まっすぐ行ける所（通れて、途中の速さが元の道より遅くならない所）を飛ばして短くする。
 * - 行き先が通れない所なら、いちばん近い通れる格子の中心へ向かう。
 *
 * sim.ts から：buildNav（合戦の始めに 1 回）・findPath（部隊が道を作り直すとき）・isPassable・nearestPassable。
 * 同じ入力なら同じ道になる（探す順・同じ重みのときの順は決まっている）。
 */
import type { UnitKind } from './types';

/** 格子の 1 マスの大きさ（m） */
export const NAV_CELL = 5;

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
 * from から to への道（通る点の並び。最後の点が行き先。from は含まない）。道が無ければ null。
 * 行き先が通れない所なら、いちばん近い通れる所を行き先にする。
 */
export function findPath(nav: NavGrid, kind: UnitKind, fx: number, fz: number, tx: number, tz: number): { x: number; z: number }[] | null {
    const spd = nav.speedOf(kind);
    const goalPt = nearestPassable(nav, tx, tz);
    let start = cellOf(nav, fx, fz);
    if (nav.blocked[start]) {
        const p = nearestPassable(nav, fx, fz);
        start = cellOf(nav, p.x, p.z);
    }
    const goal = cellOf(nav, goalPt.x, goalPt.z);
    // まっすぐ行けて、途中に行き先より遅い所が無ければ、道探しは要らない
    if (start === goal || straight(nav, spd, fx, fz, goalPt.x, goalPt.z, Math.min(spd[start]!, spd[goal]!))) return [goalPt];

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
            stamp[ni] = gen;
            g[ni] = ng;
            from[ni] = cur;
            if (hn >= heap.length) return null;
            push(ni, ng + h(ni));
        }
    }
    if (!found) return null;
    // 格子の並び（行き先 → 出発）を逆にして、点の並びにする
    const cells: number[] = [];
    for (let i = goal; i !== -1 && i !== start; i = from[i]!) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => centerOf(nav, i));
    pts[pts.length - 1] = goalPt;
    // まっすぐ行ける所を飛ばす（途中の速さが、飛ばす区間の元の道のいちばん遅い速さより遅くならないときだけ）
    const out: { x: number; z: number }[] = [];
    let ax = fx;
    let az = fz;
    let k = 0;
    const minTo = new Float64Array(pts.length);
    while (k < pts.length) {
        // minTo[j]：今の点から j までの元の道のいちばん遅い速さ
        let m = spd[cellOf(nav, ax, az)]!;
        for (let q = k; q < pts.length; q++) {
            m = Math.min(m, spd[cells[q]!]!);
            minTo[q] = m;
        }
        let j = pts.length - 1;
        for (; j > k; j--) {
            if (straight(nav, spd, ax, az, pts[j]!.x, pts[j]!.z, minTo[j]!)) break;
        }
        out.push(pts[j]!);
        ax = pts[j]!.x;
        az = pts[j]!.z;
        k = j + 1;
    }
    return out;
}

/** start から goal まで道があるか（戦場データの検査用） */
export function reachable(nav: NavGrid, kind: UnitKind, fx: number, fz: number, tx: number, tz: number): boolean {
    if (!isPassable(nav, tx, tz)) return false;
    return findPath(nav, kind, fx, fz, tx, tz) !== null;
}
