/**
 * 会話・軍議の選択肢の並びを、台詞の枠と上の部品（軍議の見出し・詳しく見る・メニュー・目的の札）の間に収める（Version 24）。
 *
 * Version 23 までの並びは、画面の下から決まった高さ（ui.css の .g-choices の bottom）に置いていた。縦長のスマホでは、台詞が 3 行になると
 * 台詞の枠がその高さを越えて伸び、軍議の選択肢 C の下の方を隠していた（Version 21 から）。
 *
 * 決まり：
 * - CSS のままの並びが、台詞の枠にも、上に重なって描かれる部品（詳しく見る・メニュー）にもかからず、画面の上の端からも出ていなければ、
 *   何もしない（Version 23 と同じ画面。横長のスマホ・PC の多くはここ）。並びの下に描かれる物（軍議の見出し・目的の札）に
 *   かかるだけでは動かさない（隠れるのは選択肢ではないので）。
 * - 横長のスマホでも、選択肢が詳しく見る・メニューの下に隠れる、画面の上へ出る場面（568×320・640×360 の軍議の方針の A、
 *   第二章の補充の最初の選択肢など。Version 21 から）は、同じ決まりで収める。
 * - かかるときだけ、並びを「台詞の枠の上端 − gapBelow」の上に置き、上は上の部品の下端 + gapAbove までにする（class "g-fit"）。
 *   入りきらなければ、並びの中だけを縦に動かす（class "g-scroll"。なぞり・ホイール。ページ・3D の場面は動かさない）。
 *   "g-scroll" は、ほかの動く欄（タイトルの一覧・メニュー・結末）と同じ印で、main.ts のページ全体の touchmove の抑止から外れる。
 *   台詞の字・顔の大きさは変えない。
 * - それでも並びに minList の高さが取れないとき（とても低い画面）だけ、台詞の欄の高さを（行 2 つ分までは残して）縮め、台詞の中を動かせるようにする。
 * - 境は毎回、本物の四角（台詞の枠・上の部品・並び）から求める（1 行・何行の台詞でも、安全域があっても同じ）。
 *
 * 前半（fitChoices・revealScrollTop）は DOM を使わない純粋な計算（tests/proto3d-ui-choice-fit.test.ts）。後半の ChoiceFit が DOM に当てる。
 */

/** 並べ方の決まりの数（CSS の px） */
export const CHOICE_FIT = {
    /** 並びの下端と台詞の枠の上端の間（狭い画面の顔が枠の上へ 8px はみ出しても選択肢に届かない） */
    gapBelow: 12,
    /** 上の部品の下端と並びの上端の間 */
    gapAbove: 8,
    /** 並びに少なくとも取りたい高さ（これより低ければ台詞の欄を縮める） */
    minList: 96,
    /** 接しているだけは重なりにしない */
    tol: 0.5,
    /** 動く並びの端の薄れ（その先にまだ選択肢があるしるし。ui.css の mask と同じ） */
    fade: 24,
    /** 見出し・目的の札を避けた見える高さがこれより低く、入りきらないときは、見出し・目的の札の上も使う */
    roomy: 192,
} as const;

export interface ChoiceFitInput {
    /** 層（画面）の高さ */
    layerH: number;
    /** CSS のままの並びの上端・下端（層の中の座標） */
    natural: { top: number; bottom: number };
    /** 並びの中身の高さ（すべての選択肢とその間） */
    contentH: number;
    /** 台詞の枠の上端 */
    dialogTop: number;
    /** 並びの上に重なって描かれる部品（詳しく見る・メニュー）のうち、並びと左右が重なる物の下端の一番下（無ければ 0）。CSS のままの並びがこれより上へ出ていたら収める */
    coverBottom: number;
    /** 収めるときに避ける上の部品（軍議の見出し・詳しく見る・メニュー・目的の札。並びと左右が重なる物）の下端の一番下（無ければ 0） */
    topBottom: number;
    /** 台詞の欄の高さと、縮めてよい下限（省けば台詞は縮めない） */
    text?: { h: number; min: number };
}

export interface ChoiceFitResult {
    /** false：CSS のまま（Version 23 と同じ） */
    fit: boolean;
    /** 並びの下端の、層の下の端からの距離 */
    bottom: number;
    /** 並びの見える高さの上限 */
    maxH: number;
    /** 入りきらず、並びの中を動かす */
    scroll: boolean;
    /** 台詞の欄の高さの上限（縮めるときだけ。それ以外 null） */
    textMax: number | null;
}

const NATURAL: ChoiceFitResult = { fit: false, bottom: 0, maxH: 0, scroll: false, textMax: null };

/** 並びを収めるか・どこに・どの高さまで（純粋） */
export function fitChoices(i: ChoiceFitInput): ChoiceFitResult {
    const { tol, gapBelow, gapAbove, minList } = CHOICE_FIT;
    const overDialog = i.natural.bottom > i.dialogTop + tol;
    // 上に重なって描かれる部品の下、または画面の上の端より上へ出ている（選択肢が隠れる・押せない）
    const underCover = i.natural.top < Math.max(i.coverBottom, 0) - tol;
    if (!overDialog && !underCover) return NATURAL;
    // 上は、並びの下に描かれる物（軍議の見出し・目的の札）も避ける。それでは入りきらず、見える高さも狭い（低い横長の画面）ときだけ、
    // 並びの上に描かれる物（詳しく見る・メニュー）の下までを使う（見出し・目的の札は Version 23 と同じく並びの後ろになる）
    const hardTop = Math.max(i.coverBottom, 0) + gapAbove;
    const softTop = Math.max(i.topBottom, hardTop - gapAbove) + gapAbove;
    const room = (t: number) => i.dialogTop - gapBelow - t;
    const top = i.contentH > room(softTop) + tol && (i.contentH <= room(hardTop) + tol || room(softTop) < CHOICE_FIT.roomy) ? hardTop : softTop;
    let dialogTop = i.dialogTop;
    let avail = dialogTop - gapBelow - top;
    let textMax: number | null = null;
    const need = Math.min(i.contentH, minList);
    if (avail < need - tol && i.text) {
        const cut = Math.min(need - avail, i.text.h - i.text.min);
        if (cut > tol) {
            textMax = i.text.h - cut;
            dialogTop += cut;
            avail += cut;
        }
    }
    // それでも取れなければ、押せる高さ（44px）だけは取る（上の部品に少しかかっても、選択肢を無くさない）
    const maxH = Math.max(Math.min(i.contentH, 44), avail);
    return { fit: true, bottom: i.layerH - dialogTop + gapBelow, maxH: Math.min(maxH, i.contentH), scroll: i.contentH > maxH + tol, textMax };
}

/**
 * 動く並びで、k 番目の選択肢が端の薄れにかからず見える scrollTop（今のままで見えていれば今の値）。
 * top・h：選択肢の、並びの中身の中での上端と高さ。view：並びの見える高さ。max：動かせる一番下（scrollHeight − clientHeight）。
 * 端の薄れは、その先にまだ中身があるときだけ（一番上・一番下に寄せた時は無い）。
 */
export function revealScrollTop(cur: number, item: { top: number; h: number }, view: number, max: number, fade: number = CHOICE_FIT.fade): number {
    let st = cur;
    if (item.top - fade < st) st = item.top - fade;
    else if (item.top + item.h + fade > st + view) st = item.top + item.h + fade - view;
    return Math.max(0, Math.min(max, st));
}

// ================= DOM =================

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

const shown = (e: Element | null | undefined, outside: boolean): Rect | null => {
    if (!e || (e as HTMLElement).hidden) return null;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || (outside && cs.visibility === 'hidden')) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
};

export interface ChoiceFitParts {
    /** 会話の層 */
    layer: HTMLElement;
    /** 選択肢の並び（.g-choices） */
    list: HTMLElement;
    /** 台詞の枠（.g-dialog）と台詞の欄（.text） */
    box: HTMLElement;
    text: HTMLElement;
    /** 並びの上に重なって描かれる部品（詳しく見る・メニュー） */
    covers: () => readonly (Element | null)[];
    /** 収めるときに避ける上の部品（軍議の見出し・目的の札など。covers も避ける） */
    above: () => readonly (Element | null)[];
    /** 並べ方が変わった（顔の測り直しなど） */
    onChange?: () => void;
}

/**
 * 選択肢の並びを台詞の枠と上の部品の間に収める（fitChoices を DOM に当てる）。
 * - 収める必要の無い時は、並び・台詞の枠に class も style も付けない（Version 23 と同じ DOM）。
 * - 選択肢が出た時・選び直した時（低い画面では選ばれた物だけ説明を出すので高さが変わる）は fit() を呼ぶ側が呼ぶ。
 *   画面の大きさ・向きが変わった時は ResizeObserver の中で（同じフレームのうちに）、台詞の枠・選択肢の大きさが変わった時（字の読み込み）は
 *   次のフレームで測り直す。
 * - 動く並びでは、端の薄れ（class "more-above"・"more-below"）を今の位置に合わせる。
 */
export class ChoiceFit {
    private result: ChoiceFitResult = NATURAL;
    /** 動く並びの間だけの「上にも・下にも選択肢」の札 */
    private cues: { up: HTMLElement; down: HTMLElement } | null = null;
    private ro: ResizeObserver | null = null;
    private raf = 0;
    private disposed = false;
    /** 並びが最後に人の手（なぞり・ホイール）で動いた時刻（performance.now。動いている途中・止めた直後の押しを選びにしない：ui/dom.ts の onPress） */
    scrolledAt = Number.NEGATIVE_INFINITY;
    /** こちらで動かした先（↑↓で選んだ物を見せる・測り直しで戻す）。その scroll は人の手の動きに数えない */
    private selfTop: number | null = null;

    constructor(private readonly p: ChoiceFitParts) {
        p.list.addEventListener(
            'scroll',
            () => {
                if (this.selfTop !== null && Math.abs(p.list.scrollTop - this.selfTop) < 1) this.selfTop = null;
                else this.scrolledAt = performance.now();
                this.edges();
            },
            { passive: true },
        );
    }

    /** こちらで並びを動かす（人の手の動きに数えない） */
    private scrollTo(top: number): void {
        const list = this.p.list;
        if (Math.abs(top - list.scrollTop) <= 0.5) return;
        list.scrollTop = top;
        this.selfTop = list.scrollTop;
    }

    /** 並びの中を動かしているか（入りきらない） */
    get scrolls(): boolean {
        return this.result.scroll;
    }

    /** 見張りを始める（選択肢が出た時） */
    watch(): void {
        if (this.disposed || this.ro || typeof ResizeObserver === 'undefined') return;
        // 画面の大きさ・向きが変わった（層の大きさ）：同じフレームのうちに並べ直す（古い並べ方を 1 フレームも見せない。層は見張る物の中で
        // 一番浅いので、並べ直しで台詞の枠の大きさが変わっても ResizeObserver の繰り返しの誤りにならない）。それ以外は次のフレームで
        this.ro = new ResizeObserver((entries) => {
            if (entries.some((e) => e.target === this.p.layer)) this.fit();
            else this.later();
        });
        this.ro.observe(this.p.layer);
        this.ro.observe(this.p.box);
        for (const b of this.p.list.children) this.ro.observe(b);
    }

    private later(): void {
        if (this.raf || this.disposed) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.fit();
        });
    }

    /** 測って並べ直す。sel：見えるようにする選択肢（省けば今の位置を保つ） */
    fit(sel?: HTMLElement | null): void {
        const { layer, list, box, text } = this.p;
        if (this.disposed || list.hidden) return;
        const before = this.result;
        const keep = list.scrollTop;
        // CSS のままの並びを測る（同じ処理の中で戻すので、画面には出ない）
        this.clear();
        const L = layer.getBoundingClientRect();
        const n = list.getBoundingClientRect();
        const d = box.getBoundingClientRect();
        const lineH = parseFloat(getComputedStyle(text).lineHeight);
        const tr = text.getBoundingClientRect();
        // 上の部品：並びと左右が重なり、台詞の枠より上にある物
        const cols = (r: Rect) => r.left < n.right - CHOICE_FIT.tol && n.left < r.right - CHOICE_FIT.tol && r.bottom <= d.top + CHOICE_FIT.tol;
        const lowest = (els: readonly (Element | null)[]) => {
            let b = 0;
            for (const e of els) {
                const r = shown(e, !(e && layer.contains(e)));
                if (r && cols(r)) b = Math.max(b, r.bottom - L.top);
            }
            return b;
        };
        const coverBottom = lowest(this.p.covers());
        const r = fitChoices({
            layerH: L.height,
            natural: { top: n.top - L.top, bottom: n.bottom - L.top },
            contentH: n.height,
            dialogTop: d.top - L.top,
            coverBottom,
            topBottom: Math.max(coverBottom, lowest(this.p.above())),
            text: Number.isFinite(lineH) && lineH > 0 ? { h: tr.height, min: Math.min(tr.height, lineH * 2) } : undefined,
        });
        this.result = r;
        if (r.fit) {
            list.style.setProperty('--g-choices-bottom', `${r.bottom.toFixed(2)}px`);
            list.style.setProperty('--g-choices-max', `${r.maxH.toFixed(2)}px`);
            list.classList.add('g-fit');
            if (r.scroll) list.classList.add('g-scroll');
            if (r.textMax !== null) {
                text.style.setProperty('--g-text-max', `${r.textMax.toFixed(2)}px`);
                box.classList.add('g-text-fit');
            }
        }
        this.placeCues();
        if (r.scroll) {
            this.scrollTo(keep);
            if (sel) this.reveal(sel);
        }
        this.edges();
        const changed = before.fit !== r.fit || before.scroll !== r.scroll || Math.abs(before.bottom - r.bottom) > 0.5 || Math.abs(before.maxH - r.maxH) > 0.5 || before.textMax !== r.textMax;
        if (changed) this.p.onChange?.();
    }

    /** 動く並びで、sel が端の薄れにかからず見えるまで動かす（動かない並びでは何もしない） */
    reveal(sel: HTMLElement | null | undefined): void {
        const list = this.p.list;
        if (!sel || !this.result.scroll) return;
        const lr = list.getBoundingClientRect();
        const br = sel.getBoundingClientRect();
        const top = br.top - lr.top - list.clientTop + list.scrollTop;
        const st = revealScrollTop(list.scrollTop, { top, h: br.height }, list.clientHeight, list.scrollHeight - list.clientHeight);
        this.scrollTo(st);
        this.edges();
    }

    /** 端の薄れと「上にも・下にも選択肢」の札：上・下にまだ選択肢があるか */
    private edges(): void {
        const list = this.p.list;
        const on = this.result.scroll;
        // scrollHeight・clientHeight は整数に丸めた値、scrollTop は端数を持つので、2px までは端とみなす
        const above = on && list.scrollTop > 2;
        const below = on && list.scrollTop < list.scrollHeight - list.clientHeight - 2;
        if (list.classList.contains('more-above') !== above) list.classList.toggle('more-above', above);
        if (list.classList.contains('more-below') !== below) list.classList.toggle('more-below', below);
        if (this.cues) {
            if (this.cues.up.hidden === above) this.cues.up.hidden = !above;
            if (this.cues.down.hidden === below) this.cues.down.hidden = !below;
        }
    }

    /**
     * 動く並びの間だけ：並びの見える所の上の端・下の端の真ん中に、小さな札「▲ 上にも選択肢」「▼ 下にも選択肢」を置く（押せない。読み上げない）。
     * 端の薄れだけでは、選択肢の切れ目で切れた時に続きがあると分かりにくいので。動かない並びでは作らない（Version 23 と同じ DOM）
     */
    private placeCues(): void {
        const { layer, list } = this.p;
        if (!this.result.scroll) {
            this.cues?.up.remove();
            this.cues?.down.remove();
            this.cues = null;
            return;
        }
        if (!this.cues) {
            const mk = (dir: 'up' | 'down', label: string) => {
                const e = document.createElement('div');
                e.className = `g-choices-cue ${dir}`;
                e.setAttribute('aria-hidden', 'true');
                e.textContent = label;
                e.hidden = true;
                return e;
            };
            this.cues = { up: mk('up', '▲ 上にも選択肢'), down: mk('down', '▼ 下にも選択肢') };
            list.after(this.cues.up, this.cues.down);
        }
        const L = layer.getBoundingClientRect();
        const r = list.getBoundingClientRect();
        const cx = `${(r.left - L.left + r.width / 2).toFixed(2)}px`;
        this.cues.up.style.left = cx;
        this.cues.up.style.top = `${(r.top - L.top + 2).toFixed(2)}px`;
        this.cues.down.style.left = cx;
        this.cues.down.style.top = `${(r.bottom - L.top - 2).toFixed(2)}px`;
    }

    /** 付けた物をすべて外す（CSS のまま。何も付いていなければ DOM に触れない） */
    private clear(): void {
        const { list, box, text } = this.p;
        for (const c of ['g-fit', 'g-scroll', 'more-above', 'more-below']) if (list.classList.contains(c)) list.classList.remove(c);
        unsetVars(list, ['--g-choices-bottom', '--g-choices-max']);
        if (box.classList.contains('g-text-fit')) box.classList.remove('g-text-fit');
        unsetVars(text, ['--g-text-max']);
    }

    dispose(): void {
        this.disposed = true;
        this.ro?.disconnect();
        this.ro = null;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }
}

/** style の変数を外す。ほかに何も無くなれば style の属性ごと外す（Version 23 と同じ DOM に戻す） */
function unsetVars(e: HTMLElement, names: readonly string[]): void {
    if (!e.hasAttribute('style')) return;
    for (const n of names) e.style.removeProperty(n);
    if (e.style.length === 0) e.removeAttribute('style');
}
