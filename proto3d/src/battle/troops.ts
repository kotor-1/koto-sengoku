/**
 * 兵士の表示の決まりごと（純粋な TypeScript。three・DOM なし）。docs/troops-abilities-design.md §1。
 * 描画（three の InstancedMesh）は troopsView.ts、つなぎは view.ts。ここは数と並びと揺れだけを決め、テスト（tests/proto3d-battle-troops.test.ts）で確かめる。
 * - 表示の人数：最初の兵力から 1 部隊 20〜40 人（300 → 24・500 → 32・800 以上 → 40。間は直線で補う）。
 *   画面の兵士 1 人＝実際の兵 1 人ではない（兵力は sim.ts の部隊単位の数のまま）。
 * - 兵が減ると ceil(最大 × 今の兵 ÷ 最初の兵) へ、1 人ずつ 0.3 秒あけて減る（全滅で 0）。後ろの列から抜ける。
 * - 隊列：槍は横に広い密な列・弓は間の空いた 2〜3 列（互い違い）・騎馬は楔形・本陣は旗を囲む方陣（真ん中は空ける）。
 * - LOD：カメラからの距離で 100%／60%／35%（閾値はデータ）。画質「低」（?q=low）と触る端末では、上限と LOD を一段下げる。
 * - 揺れ：歩く揺れ・交戦で前へ詰める・敗走で散る。
 * 合戦の計算には一切かかわらない（BattleState を読むのは view.ts。ここは数を受け取って数を返すだけ）。
 */
import type { UnitKind } from './types';

/** 描き方の段（high：PC の既定／low：画質「低」か触る端末） */
export type TroopTier = 'high' | 'low';

export const TROOP_DATA = {
    /** 最初の兵力 → 表示の最大人数（間は直線で補う。端より外は端の傾きのまま伸ばし、min〜max に収める） */
    anchors: {
        high: [
            [300, 24],
            [500, 32],
            [800, 40],
        ],
        // 一段下げる：おおよそ 85%（300 → 22・500 → 28・800 → 34）
        low: [
            [300, 22],
            [500, 28],
            [800, 34],
        ],
    } as Record<TroopTier, [number, number][]>,
    min: { high: 20, low: 18 } as Record<TroopTier, number>,
    max: { high: 40, low: 34 } as Record<TroopTier, number>,
    /** 兵が減ったときに 1 人抜ける間（秒） */
    dropInterval: 0.3,
    /** 抜ける人数がこれより多くたまったら（早送りの後など）、間を縮めて追いつく（間 × この数 ÷ たまった数） */
    catchUpGap: 6,
    /**
     * LOD：カメラから部隊の中心までの距離（m）で表示の割合を決める。upTo 以下ならその割合。
     * 大平原（400 m × 320 m）の全体表示（カメラの距離 PC 約 440 m・スマホ横約 500 m。部隊までは 440〜640 m）ではおおむね 100%。
     * そこから引く（上限まで）・もっと広い戦場では、奥の部隊から 60%・35% に落ちる。
     */
    lod: {
        high: [
            { upTo: 660, ratio: 1 },
            { upTo: 920, ratio: 0.6 },
            { upTo: Infinity, ratio: 0.35 },
        ],
        low: [
            { upTo: 600, ratio: 1 },
            { upTo: 780, ratio: 0.6 },
            { upTo: Infinity, ratio: 0.35 },
        ],
    } as Record<TroopTier, { upTo: number; ratio: number }[]>,
};

/** 描き方の段を決める（画質「低」か触る端末なら low） */
export function troopTier(opts: { low: boolean; touch?: boolean }): TroopTier {
    return opts.low || opts.touch ? 'low' : 'high';
}

/** 最初の兵力から、表示の最大人数（1 部隊）。兵がいなければ 0 */
export function troopMax(startStrength: number, tier: TroopTier = 'high'): number {
    if (!(startStrength >= 1)) return 0;
    const a = TROOP_DATA.anchors[tier];
    let v: number;
    if (startStrength <= a[0][0]) v = a[0][1] + ((startStrength - a[0][0]) * (a[1][1] - a[0][1])) / (a[1][0] - a[0][0]);
    else if (startStrength >= a[a.length - 1][0]) v = a[a.length - 1][1];
    else {
        let k = 0;
        while (k < a.length - 2 && startStrength > a[k + 1][0]) k++;
        v = a[k][1] + ((startStrength - a[k][0]) * (a[k + 1][1] - a[k][1])) / (a[k + 1][0] - a[k][0]);
    }
    return Math.max(TROOP_DATA.min[tier], Math.min(TROOP_DATA.max[tier], Math.round(v)));
}

/** 今の兵力で見せる人数：ceil(最大 × 今 ÷ 最初)。兵が 1 人未満なら 0（全滅・崩れた） */
export function troopTarget(max: number, strength: number, startStrength: number): number {
    if (!(strength >= 1) || !(startStrength > 0) || max <= 0) return 0;
    return Math.min(max, Math.max(1, Math.ceil((max * strength) / startStrength - 1e-9)));
}

/** 見せている人数の数え（部隊ごと）。shown は今見せている人数、wait は次の 1 人が抜けるまでの残り（秒） */
export interface TroopCounter {
    shown: number;
    wait: number;
}

/**
 * 見せる人数を目標へ近づける（表示の時計の dt 秒）。減るときは 1 人ずつ dropInterval あけて（最初の 1 人はすぐ）。
 * 増えるときは（援軍の合流など）すぐ合わせる。たまった数が catchUpGap を超えたら、間を縮めて追いつく。
 */
export function stepTroopCount(c: TroopCounter, target: number, dt: number): void {
    if (target >= c.shown) {
        c.shown = target;
        c.wait = 0;
        return;
    }
    c.wait -= dt;
    while (c.shown > target && c.wait <= 0) {
        c.shown--;
        const gap = c.shown - target;
        const k = gap > TROOP_DATA.catchUpGap ? TROOP_DATA.catchUpGap / gap : 1;
        c.wait += TROOP_DATA.dropInterval * k;
    }
    if (c.shown === target) c.wait = Math.max(0, c.wait);
}

/** カメラからの距離で、表示の割合（1・0.6・0.35） */
export function lodRatio(dist: number, tier: TroopTier = 'high'): number {
    for (const l of TROOP_DATA.lod[tier]) if (dist <= l.upTo) return l.ratio;
    return TROOP_DATA.lod[tier][TROOP_DATA.lod[tier].length - 1].ratio;
}

/** LOD の後に描く人数（見せている人数 × 割合。1 人以上いれば 1 人は描く） */
export function lodCount(shown: number, ratio: number): number {
    if (shown <= 0) return 0;
    return Math.max(1, Math.min(shown, Math.ceil(shown * ratio - 1e-9)));
}

/**
 * LOD で描く兵士を選ぶ：残る順（keep）の先頭 shown 人のうち、均等に間引いて count 人（隊列の形は保ち、全体が薄くなる）。
 * 戻り値は keep の中の順位（0..shown-1）の並び。
 */
export function lodPick(shown: number, count: number): number[] {
    const out: number[] = [];
    if (count <= 0 || shown <= 0) return out;
    if (count >= shown) {
        for (let i = 0; i < shown; i++) out.push(i);
        return out;
    }
    // 先頭（最前列）を必ず含め、shown の中に等間隔に
    for (let i = 0; i < count; i++) out.push(Math.min(shown - 1, Math.floor((i * shown) / count)));
    return out;
}

// ---------------------------------------------------------------- 隊列

/** 隊列の中の 1 人の位置（部隊の中心から。x は右、z は後ろ、メートル）と列（0 が最前列。本陣は内側の輪が 0） */
export interface TroopSlot {
    x: number;
    z: number;
    row: number;
}

/** 隊列を収める広さ（半分の幅・半分の奥行き。view.ts の部隊の輪・押す判定と同じ広さ）。これに近い大きさに並べる */
export interface TroopBox {
    halfW: number;
    halfD: number;
}

/** 種類ごとの隊列の間隔（m）。広さに合わせて min〜max の間で決める */
export const TROOP_FORMATION = {
    /** 槍：横に広い密な列（3〜5 列） */
    yari: { rows: [3, 5], dx: [1.5, 2.1], dz: [1.7, 2.3] },
    /** 弓：間の空いた 2〜3 列（列ごとに半分ずらす） */
    yumi: { rows: [2, 3], dx: [2.0, 2.8], dz: [2.3, 3.0] },
    /** 騎馬：楔形（前の 3 騎から、後ろの列ほど 2 騎ずつ広がる） */
    kiba: { dx: 2.1, dz: 3.0, first: 3, grow: 2 },
    /** 本陣：旗（真ん中）を囲む四角の輪 */
    honjin: { d: 2.0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 横の列の並び（最後の列は中央に寄せる。stagger なら奇数の列を半分ずらす） */
function lines(n: number, rows: number, dx: number, dz: number, stagger: boolean): TroopSlot[] {
    const cols = Math.ceil(n / rows);
    const out: TroopSlot[] = [];
    for (let r = 0; r < rows; r++) {
        const inRow = Math.min(cols, n - cols * r);
        if (inRow <= 0) break;
        const off = stagger && r % 2 === 1 ? dx / 2 : 0;
        for (let c = 0; c < inRow; c++) out.push({ x: (c - (inRow - 1) / 2) * dx + off, z: (r - (rows - 1) / 2) * dz, row: r });
    }
    return out;
}

/**
 * 隊列の並び（n 人）。box（部隊の輪の広さ）に近い大きさに並べる。
 * 同じ種類・人数・広さなら、いつも同じ並び。
 */
export function troopSlots(kind: UnitKind, n: number, box: TroopBox): TroopSlot[] {
    if (n <= 0) return [];
    if (kind === 'yari' || kind === 'yumi') {
        const f = TROOP_FORMATION[kind];
        const W = Math.max(2, 2 * (box.halfW - 1.0));
        const D = Math.max(2, 2 * (box.halfD - 1.0));
        const ideal = (f.dx[0] + f.dx[1]) / 2;
        // 幅に並ぶ横の数から列の数を決める
        const rows = clamp(Math.round(n / (W / ideal + 1)), f.rows[0], f.rows[1]);
        const cols = Math.ceil(n / rows);
        const realRows = Math.ceil(n / cols);
        const dx = clamp(W / Math.max(1, cols - 1), f.dx[0], f.dx[1]);
        const dz = clamp(D / Math.max(1, realRows - 1), f.dz[0], f.dz[1]);
        return lines(n, realRows, dx, dz, kind === 'yumi');
    }
    if (kind === 'kiba') {
        const f = TROOP_FORMATION.kiba;
        const counts: number[] = [];
        let left = n;
        for (let w = f.first; left > 0; w += f.grow) {
            counts.push(Math.min(w, left));
            left -= w;
        }
        const out: TroopSlot[] = [];
        const rows = counts.length;
        counts.forEach((c, r) => {
            for (let i = 0; i < c; i++) out.push({ x: (i - (c - 1) / 2) * f.dx, z: (r - (rows - 1) / 2) * f.dz, row: r });
        });
        return out;
    }
    // 本陣：輪 k（1, 2, 3…）は一辺 2k の四角の周り（8k 人）。内側の輪から埋め、最後の輪は前から埋める
    const d = TROOP_FORMATION.honjin.d;
    const out: TroopSlot[] = [];
    for (let k = 1; out.length < n; k++) {
        const ring: TroopSlot[] = [];
        for (let i = -k; i <= k; i++) {
            for (let j = -k; j <= k; j++) {
                if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
                ring.push({ x: i * d, z: j * d, row: k - 1 });
            }
        }
        ring.sort((a, b) => a.z - b.z || Math.abs(a.x) - Math.abs(b.x) || a.x - b.x);
        for (const p of ring) {
            if (out.length >= n) break;
            out.push(p);
        }
    }
    return out;
}

/** 隊列の広がり（半分の幅・半分の奥行き。人の大きさの分を足す）と、中心からいちばん遠い人までの距離 */
export function troopExtent(slots: TroopSlot[]): { halfW: number; halfD: number; radius: number } {
    let w = 0;
    let d = 0;
    let r = 0;
    for (const p of slots) {
        w = Math.max(w, Math.abs(p.x));
        d = Math.max(d, Math.abs(p.z));
        r = Math.max(r, Math.hypot(p.x, p.z));
    }
    return { halfW: w + 1, halfD: d + 1.5, radius: r + 1.5 };
}

/** 文字列から決まった数（0〜1）。乱数の代わり（同じ部隊はいつも同じ見た目） */
export function troopHash(key: string, i: number): number {
    let h = 2166136261 ^ i;
    for (let k = 0; k < key.length; k++) {
        h ^= key.charCodeAt(k);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/**
 * 兵が減ったときに残る順（先頭ほど最後まで残る）。後ろの列から、少しばらつきを付けて抜ける（隣の列と少しだけ混ざる）。
 * 戻り値はスロットの番号の並び。見せる人数 k なら先頭の k 個を描く。
 */
export function troopKeepOrder(slots: TroopSlot[], seed: string): number[] {
    const rank = slots.map((s, i) => s.row + troopHash(seed, i) * 0.9);
    return slots.map((_, i) => i).sort((a, b) => rank[a] - rank[b] || a - b);
}

// ---------------------------------------------------------------- 揺れ

/** 1 人の揺れを決める部隊の様子 */
export interface TroopMotion {
    /** 表示の時計（秒） */
    t: number;
    moving: boolean;
    /** 斬り合っている */
    melee: boolean;
    /** 敗走してからの散り具合（0〜1） */
    scatter: number;
    cavalry: boolean;
}

/** 1 人の見た目の位置の差（部隊の中の位置 lx・lz、浮き lift、向きの差 yaw） */
export interface TroopPose {
    lx: number;
    lz: number;
    lift: number;
    yaw: number;
}

/**
 * 1 人の揺れ（idx はスロットの番号、seed は部隊の id）。
 * - いつも：少しずつ位置と向きをばらす（整列しすぎない）。
 * - 歩く：上下の揺れと小さな左右の揺れ。
 * - 斬り合い：隊列を前へ詰め（奥行きを縮めて前へ寄る）、前の 2 列は突き出す動き。
 * - 敗走：外へ散って向きもばらける。
 */
export function troopPose(slot: TroopSlot, idx: number, seed: string, m: TroopMotion, out: TroopPose): TroopPose {
    const h1 = troopHash(seed, idx);
    const h2 = troopHash(seed, idx + 500);
    let lx = slot.x + (h1 - 0.5) * 0.5;
    let lz = slot.z + (h2 - 0.5) * 0.5;
    let lift = 0;
    let yaw = (h1 - 0.5) * 0.22 + Math.sin(m.t * 0.7 + idx) * 0.04;
    if (m.scatter > 0) {
        lx = lx * (1 + m.scatter * 1.6) + (h1 - 0.5) * 10 * m.scatter;
        lz = lz * (1 + m.scatter * 1.2) + (h2 - 0.5) * 8 * m.scatter;
        yaw += (h2 - 0.5) * 1.2 * m.scatter;
    } else if (m.melee) {
        lz = lz * 0.8 - 0.6;
        if (slot.row <= 1) lz += Math.sin(m.t * 7 + idx * 1.7) * 0.45 - 0.3;
    }
    if (m.moving) {
        lift = Math.abs(Math.sin(m.t * (m.cavalry ? 7 : 9) + idx * 1.3)) * (m.cavalry ? 0.35 : 0.22);
        lx += Math.sin(m.t * 4.5 + idx * 0.9) * 0.08;
    }
    out.lx = lx;
    out.lz = lz;
    out.lift = lift;
    out.yaw = yaw;
    return out;
}
