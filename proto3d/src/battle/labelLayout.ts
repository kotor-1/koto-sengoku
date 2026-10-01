/**
 * 部隊の名札の優先表示（docs/fields-group2-design.md §2）。純粋な TypeScript（three・DOM なし）。battleUi.ts の declutterLabels が毎フレーム使う。
 *
 * 名札が密集したとき、優先の高い名札から置き、重なる低い名札は「小さくする（名前だけ・小さい字）→ それでも重なれば一時的に隠す」。
 * 優先の順：
 *   0. 選んでいる部隊（確かめ中・対象選びの持ち主も選んでいる）
 *   1. 能力を使える武将（点滅）・対象選びで選べる味方（名札全体が当たり）
 *   2. 重要な武将（generalId・leaderId のある部隊・本陣・約束や目標の印の付いた部隊）
 *   3. そのほか
 *   同じ順の中は、画面の中央に近い名札が先。
 * 0・1 の名札（keep）は小さくも隠しもしない。重なれば今までどおり上へずらす（最大で名札 4 つ分）。点滅する能力の印はいつも見えて押せる。
 * 2・3 の名札は、重ならなければその位置のまま。重なれば小さく（その位置か、小さい名札 1 つ分まで上へずらして）、それでも重なれば隠す。
 * 小さく・隠すのは、重なりが解ければ次のフレームで戻る（行ったり来たりしないよう、戻すときは少し余裕を見る）。
 */

/** 名札の見せ方：full＝そのまま／mini＝名前だけ・小さい字／hide＝一時的に隠す */
export type LabelFit = 'full' | 'mini' | 'hide';

/** 並べる名札（CSS px。x は名札の横の真ん中、y は名札の下の縁＝部隊の上の点） */
export interface LabelLayoutItem {
    id: string;
    x: number;
    y: number;
    /** そのままの大きさ */
    w: number;
    h: number;
    /** 小さくした大きさ */
    mw: number;
    mh: number;
    /** 選んでいる */
    sel: boolean;
    /** 能力を使える（点滅）・対象選びの持ち主・選べる対象（押せる名札） */
    ready: boolean;
    /** 重要な武将（武将のいる部隊・本陣・約束や目標の印） */
    important: boolean;
    /** 前のフレームの見せ方（戻すときの余裕に使う。省けば full） */
    prev?: LabelFit;
}

export interface LabelPlacement {
    fit: LabelFit;
    /** 上へずらした量（px。0 か負。keep の名札と、少しずらして小さく見せる名札） */
    dy: number;
}

/** 重なりとみなす余白（px）。小さく・隠した名札を戻すときは HYSTERESIS だけ多く空いていること */
export const LABEL_GAP = 1;
export const LABEL_HYSTERESIS = 4;

/** 優先の順（小さいほど先）：0 選んでいる・1 能力を使える（点滅）・2 重要な武将・3 そのほか */
export function labelRank(it: Pick<LabelLayoutItem, 'sel' | 'ready' | 'important'>): number {
    return it.sel ? 0 : it.ready ? 1 : it.important ? 2 : 3;
}

/** 置く順（優先の順、同じ順の中は画面の中央 (cx, cy) に近い順。同じなら id の順で決まった並びにする） */
export function labelOrder<T extends LabelLayoutItem>(items: readonly T[], cx: number, cy: number): T[] {
    const d = (it: LabelLayoutItem) => Math.hypot(it.x - cx, it.y - it.h / 2 - cy);
    return [...items].sort((a, b) => labelRank(a) - labelRank(b) || d(a) - d(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

interface Box {
    l: number;
    t: number;
    r: number;
    b: number;
}

function boxOf(x: number, y: number, w: number, h: number): Box {
    return { l: x - w / 2, r: x + w / 2, t: y - h, b: y };
}

function hits(me: Box, placed: readonly Box[], gap: number): Box | undefined {
    return placed.find((p) => me.l < p.r + gap && me.r > p.l - gap && me.t < p.b + gap && me.b > p.t - gap);
}

/**
 * 名札を並べる（画面の中央 (cx, cy)）。返すのは id → 見せ方と上へのずれ。
 * keep（選んでいる・点滅）の名札はそのまま置き、重なれば上の縁から 2 px あけて上へずらす（最大で名札 4 つ分）。
 * そのほかは、その位置で重ならなければそのまま、重なれば小さく（その位置か、小さい名札 1 つ分まで上）、それでも重なれば隠す。
 */
export function layoutLabels(items: readonly LabelLayoutItem[], cx: number, cy: number): Map<string, LabelPlacement> {
    const out = new Map<string, LabelPlacement>();
    const placed: Box[] = [];
    for (const it of labelOrder(items, cx, cy)) {
        const keep = labelRank(it) <= 1;
        if (keep) {
            let dy = 0;
            for (let i = 0; i < 6; i++) {
                const hit = hits(boxOf(it.x, it.y + dy, it.w, it.h), placed, LABEL_GAP);
                if (!hit) break;
                // 先に置いた名札の上の縁から 2 px あける
                dy = hit.t - 2 - it.y;
            }
            dy = Math.min(0, Math.max(dy, -4 * Math.max(it.h, 12)));
            placed.push(boxOf(it.x, it.y + dy, it.w, it.h));
            out.set(it.id, { fit: 'full', dy });
            continue;
        }
        const prev = it.prev ?? 'full';
        // 前のフレームより大きく見せるときは、余裕を見る（境目で毎フレーム切り替わらないように）
        const fullGap = prev === 'full' ? LABEL_GAP : LABEL_GAP + LABEL_HYSTERESIS;
        const miniGap = prev === 'hide' ? LABEL_GAP + LABEL_HYSTERESIS : LABEL_GAP;
        const full = boxOf(it.x, it.y, it.w, it.h);
        if (!hits(full, placed, fullGap)) {
            placed.push(full);
            out.set(it.id, { fit: 'full', dy: 0 });
            continue;
        }
        const mini = boxOf(it.x, it.y, it.mw, it.mh);
        const hit = hits(mini, placed, miniGap);
        if (!hit) {
            placed.push(mini);
            out.set(it.id, { fit: 'mini', dy: 0 });
            continue;
        }
        // 小さくして、ぶつかった名札の上の縁のすぐ上へ少しだけずらす（小さい名札 1 つ分まで。部隊から離れすぎない）
        const dy = hit.t - 2 - it.y;
        if (dy < 0 && dy >= -(it.mh + 2)) {
            const up = boxOf(it.x, it.y + dy, it.mw, it.mh);
            if (!hits(up, placed, miniGap)) {
                placed.push(up);
                out.set(it.id, { fit: 'mini', dy });
                continue;
            }
        }
        out.set(it.id, { fit: 'hide', dy: 0 });
    }
    return out;
}
