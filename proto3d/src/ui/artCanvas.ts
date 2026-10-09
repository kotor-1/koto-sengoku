/**
 * 生成イラスト素材（Version 22）を <canvas> に描く小道具と、会話の人物画（PortraitSlot）・台詞の枠の顔（DialogFace）・軍議の背景（CouncilBackdrop）。
 *
 * - 画像は art/registry.ts の loadArtBitmap で読んだ ImageBitmap だけを描く（<img>・CSS の背景・data: の URL は使わない）。
 * - 合わせ方：contain（全部を見せる）／cover（箱を埋める。はみ出しは切る）。引き伸ばしはしない（縦横の比は保つ）。
 * - 描く細かさ：端末の画素の比（devicePixelRatio）は 2 まで。元の画像より細かくはしない（大きな画面で余計な画素を持たない）。
 * - 大きさが変わったら描き直す（watchResize）。
 * - 旧表示（?art=old）・一覧に無い・読めないときは、要素を一つも作らない（Version 21 と同じ画面）。
 * 前半の計算（fitArt・fitArtBleed・backingScale・portraitLayout・portraitStep）と dialogFaceIds・dialogFaceFor は DOM を使わない純粋な関数（Node のテストで確かめる）。
 */
import { artAvailable, artMode, loadArtBitmap } from '../art/registry';
import { ART_IDS, type ArtId } from '../art/ids';

// ================= 純粋な計算 =================

export type ArtFit = 'contain' | 'cover';

/** drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh) にそのまま渡す、元の画像の切り出しと、箱の中の描く所（CSS の px） */
export interface ArtDrawRect {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
}

export interface FitOptions {
    /** 余りや切り取りを、左（0）〜右（1）のどこに寄せるか（既定 0.5） */
    alignX?: number;
    /** 上（0）〜下（1）のどこに寄せるか（既定 0.5） */
    alignY?: number;
    /**
     * cover のときに、上下それぞれで切ってよい元の画像の高さの割合（例 0.18：上下 18% より内側は必ず見せる）。
     * それ以上切らないと埋まらない横長の画面では、縮めて左右に余り（帯）を残す（引き伸ばさない）。
     */
    maxCropY?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 元の画像（srcW×srcH）を箱（boxW×boxH）に合わせる。どちらの合わせ方でも縦横の比は保つ。
 * 返す描く所（dx..dx+dw）が箱からはみ出すことはない（はみ出す分は sx..sw の切り出しで落とす）。
 */
export function fitArt(srcW: number, srcH: number, boxW: number, boxH: number, fit: ArtFit, opts: FitOptions = {}): ArtDrawRect {
    const ax = clamp01(opts.alignX ?? 0.5);
    const ay = clamp01(opts.alignY ?? 0.5);
    if (!(srcW > 0 && srcH > 0 && boxW > 0 && boxH > 0)) return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH), dx: 0, dy: 0, dw: 0, dh: 0 };
    let scale = fit === 'contain' ? Math.min(boxW / srcW, boxH / srcH) : Math.max(boxW / srcW, boxH / srcH);
    if (fit === 'cover' && opts.maxCropY !== undefined) {
        // 上下で切ってよいのは maxCropY ずつまで：見せる高さの下限 srcH×(1−2×maxCropY) が箱の高さに収まる大きさまでしか拡げない
        const keep = Math.max(0.05, 1 - 2 * clamp01(opts.maxCropY));
        scale = Math.min(scale, boxH / (srcH * keep));
    }
    // 描いた大きさ（箱より大きければ、はみ出す分を元の画像の切り出しで落とす）
    const fullW = srcW * scale;
    const fullH = srcH * scale;
    const dw = Math.min(boxW, fullW);
    const dh = Math.min(boxH, fullH);
    const sw = dw / scale;
    const sh = dh / scale;
    return {
        sx: (srcW - sw) * ax,
        sy: (srcH - sh) * ay,
        sw,
        sh,
        dx: (boxW - dw) * ax,
        dy: (boxH - dh) * ay,
        dw,
        dh,
    };
}

/**
 * fitArt で箱（boxW×boxH）に合わせた絵を、左右に bleed ずつ広い canvas（幅 boxW＋2×bleed）へ、同じ大きさ・同じ位置で描く所
 * （canvas の左端は箱の左端より bleed だけ左。だから描く所は bleed だけ右へずれる）。
 * 広げた分には、元の画像に続きがあればそれを描く（無ければ透明のまま）。軍議の手前の幕を左右に揺らしても、奥の画と大きさ・位置がずれない。
 */
export function fitArtBleed(srcW: number, srcH: number, boxW: number, boxH: number, fit: ArtFit, opts: FitOptions, bleed: number): ArtDrawRect {
    const r = fitArt(srcW, srcH, boxW, boxH, fit, opts);
    const b = Number.isFinite(bleed) ? Math.max(0, bleed) : 0;
    if (!(r.dw > 0 && r.sw > 0) || b === 0) return { ...r, dx: r.dx + b };
    // CSS の 1px あたりの元の画素（箱に合わせた大きさのまま。広げた分も同じ大きさで描く）
    const per = r.sw / r.dw;
    const extraL = Math.max(0, Math.min(r.sx, b * per));
    const extraR = Math.max(0, Math.min(srcW - r.sx - r.sw, b * per));
    return {
        sx: r.sx - extraL,
        sy: r.sy,
        sw: r.sw + extraL + extraR,
        sh: r.sh,
        dx: b + r.dx - extraL / per,
        dy: r.dy,
        dw: r.dw + (extraL + extraR) / per,
        dh: r.dh,
    };
}

/** 描く所の、CSS の 1px に入る元の画素（sizeArtCanvas の srcPerCss。これより細かい canvas は持たない） */
export function srcPerCssOf(r: ArtDrawRect): number {
    return r.dw > 0 && r.sw > 0 ? r.sw / r.dw : Number.POSITIVE_INFINITY;
}

/** canvas の細かさの下限（CSS の 1px あたりの画素。大きさのおかしな値で canvas が潰れないように） */
const MIN_BACKING = 0.25;

/**
 * canvas の画素の細かさ（CSS の 1px あたりの画素）。端末の比は 1〜2 に収め、元の画像の細かさ（srcPerCss：CSS の 1px に入る元の画素）より細かくしない。
 * 元の画像が画面より粗い（1920 幅に 1536 の背景：0.8）ときは、CSS の 1px より粗い canvas にして、ブラウザが拡げて見せる（同じ見た目で画素を持たない）。
 */
export function backingScale(dpr: number, srcPerCss = Number.POSITIVE_INFINITY): number {
    const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(2, Math.max(1, dpr)) : 1;
    if (!(srcPerCss > 0)) return d;
    return Math.max(MIN_BACKING, Math.min(d, srcPerCss));
}

/** 画面の上の四角（CSS の px。getBoundingClientRect と同じ向き） */
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface PortraitLayoutInput {
    /** 画面（会話の層）の幅・高さ */
    vw: number;
    vh: number;
    /** 人物画の左端（CSS が決めた所。安全域の分を含む） */
    left: number;
    /** 人物画の下端（画面の下の端。人物画は腰で切れた下端を画面の端に合わせる） */
    bottom: number;
    /** 人物画の幅÷高さ */
    aspect: number;
    /** 重ねてはいけない物（選択肢・軍議の見出し・詳しく見る・メニュー・目的の札）。台詞の枠は入れない（人物画の下の方は枠の後ろに隠れてよい） */
    avoid: Box[];
    /** 避ける物との間（既定 8） */
    gap?: number;
}

/** 人物画の大きさの決まり（docs：art-v22。測った所は Version 21 の会話・軍議の画面） */
export const PORTRAIT_RULES = {
    /** これより低い画面では出さない */
    minViewportH: 340,
    /** スマホ横（高さ 430 以下）の目安の高さと、PC の上限 */
    phoneH: 300,
    pcH: 620,
    /** 画面の高さに対する割合の上限（スマホ横・PC） */
    phoneFrac: 0.8,
    pcFrac: 0.86,
    /** 左下の空き（人物画の左端から、その高さの範囲で一番近い避ける物まで）がこれより狭ければ出さない */
    minFreeW: 150,
    /** 人物画がこれより低くなるなら出さない（顔が小さすぎる） */
    minH: 210,
} as const;

/**
 * 人物画の大きさ（左下に置き、下端は画面の下の端）。避ける物と重ならない一番大きな大きさを返す。小さすぎれば null（出さない）。
 * 下から上・左から右へ広がる四角なので、避ける物ごとに「幅で避ける」か「高さで避ける」かの大きい方までは広げてよい。
 * 出さないのは：画面が低い（340 未満）・人物画が低くなりすぎる（210 未満）・その高さの範囲で左下の空きの幅が 150 未満。
 */
export function portraitLayout(p: PortraitLayoutInput): { w: number; h: number } | null {
    const R = PORTRAIT_RULES;
    if (!(p.vw > 0 && p.vh >= R.minViewportH && p.aspect > 0)) return null;
    const gap = p.gap ?? 8;
    const phone = p.vh <= 430;
    let h = phone ? Math.min(R.phoneH, p.vh * R.phoneFrac) : Math.min(R.pcH, p.vh * R.pcFrac);
    // 画面の右へははみ出さない
    h = Math.min(h, (p.vw - p.left - gap) / p.aspect);
    const live = p.avoid.filter((o) => o.right > o.left && o.bottom > o.top && o.right > p.left && o.top < p.bottom);
    for (const o of live) {
        const byWidth = (o.left - gap - p.left) / p.aspect;
        const byHeight = p.bottom - (o.bottom + gap);
        h = Math.min(h, Math.max(byWidth, byHeight));
    }
    h = Math.floor(h);
    const w = Math.floor(h * p.aspect);
    if (h < R.minH) return null;
    // その高さの範囲（上端〜下端）にある避ける物までの、左下の空きの幅
    const top = p.bottom - h;
    let free = p.vw - gap - p.left;
    for (const o of live) if (o.bottom > top) free = Math.min(free, o.left - gap - p.left);
    if (free < R.minFreeW) return null;
    return { w, h };
}

/** 軍議の背景の手前の幕・柱の、ゆっくりした横の揺れの幅（CSS の px。1280 で 7.5・844 で 5 まで） */
export function parallaxAmp(vw: number): number {
    return Math.max(0, Math.min(8, vw / 170));
}

/**
 * 揺れの位置（t 秒。12 秒で 1 往復の正弦。−amp〜amp）。画面では JS で毎フレーム動かさず、CSS の @keyframes g-council-sway
 * （ui.css。ease-in-out で −amp〜amp を往復し、−3 秒から始めて 0 から右へ）がこの形に近い動きをする。
 */
export function parallaxOffset(t: number, amp: number): number {
    return amp * Math.sin((2 * Math.PI * t) / 12);
}

/** 行の話し手から、人物画をどうするか */
export type PortraitStep = { kind: 'show'; id: ArtId } | { kind: 'dim' } | { kind: 'hide' };

/** 人物でない話し手（地の文・高札）。この行では人物画を下げる */
export const NON_PERSON_SPEAKERS: readonly string[] = ['narration', 'notice'];

/**
 * 行の話し手から、人物画をどうするか（docs/art-v22：決めた見せ方）。
 * - 絵のある人（家康・忠勝）：その人の絵を明るく出す。
 * - 絵の無い人物（酒井・石川・使者・村の使い）：前の人の絵を、同じ位置のまま暗くして残す（出ていなければ何も出さない）。
 * - 地の文・高札：下げる（会話が終われば層ごと消える）。
 */
export function portraitStep(speaker: string, id: ArtId | null): PortraitStep {
    if (NON_PERSON_SPEAKERS.includes(speaker)) return { kind: 'hide' };
    return id ? { kind: 'show', id } : { kind: 'dim' };
}

// ================= 読み込み（同じ画像の約束を共有し、読めた物はすぐ描けるようにしておく） =================

const ready = new Map<ArtId, ImageBitmap>();

/**
 * 読む（art/registry.ts の loadArtBitmap と同じ約束。読めた物は peekArt で同じフレームのうちに描ける）。旧表示・無い・失敗は null。
 * 先に読んでおく（忠勝との会話の間に軍議の背景・城下に入ったら人物画）ときも、これを通す（peekArt で待たずに出せるように）。
 */
export function loadArt(id: ArtId): Promise<ImageBitmap | null> {
    return loadArtBitmap(id).then((b) => {
        if (b) ready.set(id, b);
        return b;
    });
}

/** もう読めている画像（まだ・無い・失敗・旧表示 ?art=old は null）。待たずに描くときに使う */
export function peekArt(id: ArtId): ImageBitmap | null {
    if (artMode() === 'old') return null;
    return ready.get(id) ?? null;
}

/** テスト用：読めた画像の控えを空にする */
export function __clearArtReadyForTest(): void {
    ready.clear();
}

// ================= 描く（DOM） =================

/** 1 枚の画像を描く指示 */
export interface ArtLayer {
    bitmap: ImageBitmap;
    fit: ArtFit;
    opts?: FitOptions;
    /** 描く所（省けば fit・opts で箱に合わせる。fitArtBleed などで先に決めた所を渡す） */
    rect?: ArtDrawRect;
    /** 0〜1（既定 1） */
    alpha?: number;
    /** 重ね方（既定 'source-over'。重ね変わりの後の画は 'lighter' で足すと、途中で薄くならない） */
    op?: GlobalCompositeOperation;
}

/**
 * canvas の画素の大きさを CSS の大きさに合わせる（変わったときだけ。変えると中身は消える）。返りは CSS の 1px あたりの画素。
 * srcPerCss は「元の画像の画素 ÷ 描く CSS の px」（srcPerCssOf。元の画像より細かくしない。省けば端末の比のまま）。
 */
export function sizeArtCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, srcPerCss?: number): number {
    const k = backingScale(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, srcPerCss);
    const w = Math.max(1, Math.round(cssW * k));
    const h = Math.max(1, Math.round(cssH * k));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    return k;
}

/** 描いた後に透明へ抜く角の丸い四角（CSS の px。canvas の左上から。人物画の、台詞の枠の後ろに入る所） */
export interface ArtCut {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
}

/**
 * canvas を消して、画像を順に描く（CSS の大きさ cssW×cssH の箱に合わせる）。fill を渡せば、先にその色で塗る（帯の色）。
 * cut を渡せば、最後にその四角を透明へ抜く。canvas の画素の大きさは sizeArtCanvas で先に合わせておく。
 */
export function paintArt(canvas: HTMLCanvasElement, cssW: number, cssH: number, layers: ArtLayer[], fill?: string, cut?: ArtCut | null): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const kx = canvas.width / Math.max(1, cssW);
    const ky = canvas.height / Math.max(1, cssH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(kx, 0, 0, ky, 0, 0);
    for (const l of layers) {
        const a = l.alpha ?? 1;
        if (a <= 0) continue;
        const r = l.rect ?? fitArt(l.bitmap.width, l.bitmap.height, cssW, cssH, l.fit, l.opts);
        if (r.dw <= 0 || r.dh <= 0) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.globalCompositeOperation = l.op ?? 'source-over';
        ctx.drawImage(l.bitmap, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    }
    ctx.globalAlpha = 1;
    if (cut && cut.w > 0 && cut.h > 0) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(cut.x, cut.y, cut.w, cut.h, cut.r);
        else ctx.rect(cut.x, cut.y, cut.w, cut.h);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** 押せない・選べない・長押しで画像の menu を出さない、飾りの canvas を作る */
export function artCanvasEl(cls: string, id: ArtId): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = cls;
    c.dataset.artId = id;
    c.setAttribute('aria-hidden', 'true');
    c.draggable = false;
    return c;
}

/**
 * 画面の大きさが変わったら fn を呼ぶ（同じフレームの何回分もまとめて 1 回。向きの変更・アドレスバーの出入りも）。返りは見張りをやめる関数。
 */
export function watchResize(fn: () => void): () => void {
    let raf = 0;
    const kick = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            fn();
        });
    };
    window.addEventListener('resize', kick);
    window.addEventListener('orientationchange', kick);
    const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
    vv?.addEventListener('resize', kick);
    return () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        window.removeEventListener('resize', kick);
        window.removeEventListener('orientationchange', kick);
        vv?.removeEventListener('resize', kick);
    };
}

// ================= 会話の人物画・軍議の背景（ui/view.ts の script() が作る） =================
//
// どちらも、画像が読めてから初めて要素を作る（旧表示 ?art=old・一覧に無い・読めないときは何も作らない＝Version 21 と同じ画面）。
// 押せない飾り（pointer-events: none。ui.css）。層の押し方（どこを押しても進む）・キー・声・見張りには触れない。

/** 人物画の入れ替え（話し手が変わった）の重ね変わりの時間（ミリ秒。動きを減らすときは無し）。暗くする・戻すのも同じ長さ（ui.css） */
export const PORTRAIT_FADE_MS = 140;

/** 人物画は左下に寄せる（下端を画面の下の端に） */
const PORTRAIT_FIT: FitOptions = { alignX: 0, alignY: 1 };

/** 軍議の背景：上下 18% より内側は切らない */
const COUNCIL_CROP: FitOptions = { maxCropY: 0.18 };

/**
 * 出ている（hidden・display: none でない）物の四角。outside（層の外の物：目的の札・メニュー）は visibility: hidden も「無い」とみなす。
 * 層の中の物は visibility を見ない（見直しの演出の下で層ごと隠れている間に測っても、選択肢・台詞の枠を避ける）。
 */
function visibleBox(e: Element | null, origin: { left: number; top: number }, outside = false): Box | null {
    if (!e || (e as HTMLElement).hidden) return null;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || (outside && cs.visibility === 'hidden')) return null;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
}

/**
 * 箱の外へ広がる飾りの ::before（背景が出ている間の軍議の見出しの後ろの薄い暗さ。ui.css）の分だけ広げた四角。
 * 負の top・right・bottom・left だけを数える（::before が無ければそのまま）。
 */
function withScrim(e: Element, b: Box): Box {
    const ps = getComputedStyle(e, '::before');
    if (!ps || !ps.content || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') return b;
    const out = (v: string) => {
        const n = parseFloat(v);
        return Number.isFinite(n) && n < 0 ? -n : 0;
    };
    return { left: b.left - out(ps.left), top: b.top - out(ps.top), right: b.right + out(ps.right), bottom: b.bottom + out(ps.bottom) };
}

/**
 * 会話・軍議の話し手の人物画（左下。<canvas class="g-portrait" data-art-id>）。選択肢・台詞の枠より下に重なる（DOM で前に置く）。
 * 大きさは、選択肢・軍議の見出し（後ろの薄い暗さを含む）・詳しく見る・メニュー・目的の札と重ならない一番大きな物（portraitLayout）。
 * 下の方は台詞の枠の後ろ（枠の中は描かない）。空きが小さすぎれば出さない。左右の反転はしない（着物の合わせが逆になる）。
 * 行ごとの出し方は portraitStep：絵の無い人物の行は、前の人の絵を同じ位置のまま暗く残す（class "dim"）。地の文・高札では下げる。
 */
export class PortraitSlot {
    private canvas: HTMLCanvasElement | null = null;
    /** 見せている人物画（出ている・出かけている。無ければ null） */
    private shown: ArtId | null = null;
    /** 見せたい人物画（絵の無い人物の行では、前の人の絵のまま） */
    private want: ArtId | null = null;
    /** 絵の無い人物の行：前の人の絵を暗くしている */
    private dimmed = false;
    /** 今の大きさと、台詞の枠で抜いた所（同じなら描き直さない） */
    private key = '';
    private fadeRaf = 0;
    private hideTimer = 0;
    private stopResize: (() => void) | null = null;
    private disposed = false;
    /**
     * 出ている人物画が変わった（出た人物画の ID。下げた・出ていないなら null）。台詞の枠の顔（DialogFace）が、
     * その人の人物画が出ている行では顔を出さないために使う（同じ人を 2 つ並べない）
     */
    onShown: ((id: ArtId | null) => void) | null = null;
    /** 最後に知らせた onShown の値（同じ値は知らせ直さない） */
    private told: ArtId | null = null;

    constructor(
        private readonly layer: HTMLElement,
        /** この要素の前に置く（軍議は見出し、会話は選択肢） */
        private readonly anchor: HTMLElement,
        /** 台詞の枠（人物画の、この枠の後ろに入る所は描かない：枠の半透明の地から透けて字の後ろに出ないように） */
        private readonly dialog: HTMLElement,
        private readonly resolve: (speaker: string) => ArtId | null,
        private readonly reduced: () => boolean,
        private readonly outside: () => Element[],
    ) {}

    /** この会話で使う人物画を先に読み始める（待たない） */
    preload(speakers: string[]): void {
        const ids = new Set<ArtId>();
        for (const sp of speakers) {
            const id = this.resolve(sp);
            if (id) ids.add(id);
        }
        for (const id of ids) void loadArt(id);
    }

    /** 今の行の話し手 */
    set(speaker: string): void {
        if (this.disposed) return;
        const step = portraitStep(speaker, this.resolve(speaker));
        if (step.kind === 'hide') {
            this.want = null;
            this.dimmed = false;
            this.hide();
            return;
        }
        if (step.kind === 'dim') {
            // 前の人の絵が出ていれば、同じ位置のまま暗くする。出ていなければ何も出さない（後から読めても、この行では出さない）
            if (this.shown) this.setDim(true);
            else this.want = null;
            return;
        }
        const id = step.id;
        this.want = id;
        this.dimmed = false;
        const bmp = peekArt(id);
        if (bmp) {
            this.show(id, bmp);
            return;
        }
        // まだ読めていない：前の人の絵は下げ、読めたときにまだその人の行なら出す
        if (this.shown !== id) this.hide();
        void loadArt(id).then((b) => {
            if (b && !this.disposed && this.want === id && !this.dimmed) this.show(id, b);
        });
    }

    /** 暗くする・戻す（位置・大きさは変えない。動きを減らすときはすぐ） */
    private setDim(on: boolean): void {
        this.dimmed = on;
        const c = this.canvas;
        if (!c || c.classList.contains('dim') === on) return;
        c.style.transition = this.reduced() ? 'none' : '';
        c.classList.toggle('dim', on);
    }

    private ensureCanvas(id: ArtId): HTMLCanvasElement {
        if (this.canvas) return this.canvas;
        const c = artCanvasEl('g-portrait', id);
        c.hidden = true;
        this.layer.insertBefore(c, this.anchor.parentNode === this.layer ? this.anchor : null);
        this.canvas = c;
        this.stopResize = watchResize(() => this.relayout());
        return c;
    }

    /** 大きさと、台詞の枠の後ろで抜く所を測る（canvas は出ている前提。左端は CSS が決める：安全域を含む）。狭すぎれば null */
    private measure(c: HTMLCanvasElement, bmp: ImageBitmap): { w: number; h: number; cut: ArtCut | null } | null {
        const origin = this.layer.getBoundingClientRect();
        const avoid: Box[] = [];
        for (const sel of ['.g-choices', '.g-council-head', '.g-council-map']) {
            const e = this.layer.querySelector(sel);
            const b = visibleBox(e, origin);
            if (b && e) avoid.push(sel === '.g-council-head' ? withScrim(e, b) : b);
        }
        for (const e of this.outside()) {
            const b = visibleBox(e, origin, true);
            if (b) avoid.push(b);
        }
        const left = c.getBoundingClientRect().left - origin.left;
        const size = portraitLayout({ vw: origin.width, vh: origin.height, left, bottom: origin.height, aspect: bmp.width / bmp.height, avoid });
        if (!size) return null;
        const d = visibleBox(this.dialog, origin);
        const top = origin.height - size.h;
        const cut = d && d.left < left + size.w && d.right > left && d.bottom > top ? { x: d.left - left, y: d.top - top, w: d.right - d.left, h: d.bottom - d.top, r: 14 } : null;
        return { ...size, cut };
    }

    private paint(c: HTMLCanvasElement, m: { w: number; h: number; cut: ArtCut | null }, layers: ArtLayer[]): void {
        paintArt(c, m.w, m.h, layers, undefined, m.cut);
    }

    private show(id: ArtId, bmp: ImageBitmap): void {
        const c = this.ensureCanvas(id);
        clearTimeout(this.hideTimer);
        const wasShown = this.shown;
        const prev = wasShown && wasShown !== id ? peekArt(wasShown) : null;
        c.hidden = false;
        const m = this.measure(c, bmp);
        if (!m) {
            // 空きが小さすぎる（低い画面・選択肢が左まで来る）：出さない
            this.hide(true);
            return;
        }
        const key = `${m.w}x${m.h}|${m.cut ? `${Math.round(m.cut.x)},${Math.round(m.cut.y)},${Math.round(m.cut.w)},${Math.round(m.cut.h)}` : '-'}`;
        const changed = key !== this.key;
        this.key = key;
        // 元の画像より細かい canvas は持たない（contain で合わせた大きさから）
        sizeArtCanvas(c, m.w, m.h, srcPerCssOf(fitArt(bmp.width, bmp.height, m.w, m.h, 'contain', PORTRAIT_FIT)));
        c.dataset.artId = id;
        this.shown = id;
        const reduced = this.reduced();
        c.style.transition = reduced ? 'none' : '';
        c.classList.toggle('dim', this.dimmed);
        const visible = c.classList.contains('on');
        if (prev && !reduced && visible) {
            // 話し手が変わった：同じ枠の中で重ね変わる（後の絵は足し合わせで重ね、途中で薄くならない）
            cancelAnimationFrame(this.fadeRaf);
            const t0 = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - t0) / PORTRAIT_FADE_MS);
                this.paint(c, m, [
                    { bitmap: prev, fit: 'contain', opts: PORTRAIT_FIT, alpha: 1 - t },
                    { bitmap: bmp, fit: 'contain', opts: PORTRAIT_FIT, alpha: t, op: 'lighter' },
                ]);
                this.fadeRaf = t < 1 && !this.disposed ? requestAnimationFrame(step) : 0;
            };
            step(t0);
        } else if (wasShown !== id || changed || !visible) {
            cancelAnimationFrame(this.fadeRaf);
            this.fadeRaf = 0;
            this.paint(c, m, [{ bitmap: bmp, fit: 'contain', opts: PORTRAIT_FIT }]);
        }
        if (!visible) {
            // 出る：薄い所から（動きを減らすときはすぐ）
            if (!reduced) void c.offsetWidth;
            c.classList.add('on');
        }
        this.tell(id);
    }

    /** 出ている人物画を知らせる（変わったときだけ） */
    private tell(id: ArtId | null): void {
        if (id === this.told) return;
        this.told = id;
        this.onShown?.(id);
    }

    private hide(now = false): void {
        const c = this.canvas;
        this.shown = null;
        this.key = '';
        cancelAnimationFrame(this.fadeRaf);
        this.fadeRaf = 0;
        this.tell(null);
        if (!c || c.hidden) return;
        clearTimeout(this.hideTimer);
        const instant = now || this.reduced() || !c.classList.contains('on');
        c.style.transition = instant ? 'none' : '';
        c.classList.remove('on');
        if (instant) c.hidden = true;
        else this.hideTimer = window.setTimeout(() => (c.hidden = true), PORTRAIT_FADE_MS + 20);
    }

    /**
     * 画面の大きさが変わった・台詞の枠の幅が変わった（顔の空きを取った）：測り直して描き直す
     * （重ね変わりはしない。暗さはそのまま。狭くて隠していた絵は、広がれば出す）
     */
    relayout(): void {
        if (this.disposed || !this.canvas) return;
        const id = this.want;
        const bmp = id ? peekArt(id) : null;
        if (!id || !bmp) return;
        if (this.shown === id) {
            // 重ね変わりの途中なら、新しい大きさで描き切る
            cancelAnimationFrame(this.fadeRaf);
            this.fadeRaf = 0;
            this.key = '';
        }
        this.show(id, bmp);
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.fadeRaf);
        this.fadeRaf = 0;
        clearTimeout(this.hideTimer);
        this.stopResize?.();
        this.stopResize = null;
    }
}

// ================= 台詞の枠の顔（ui/view.ts の script() が作る） =================

/**
 * 台詞の枠の顔の大きさ（CSS の px。ui.css の .g-dialog.has-face の --g-face と同じ）。実際の大きさは CSS が決め、
 * DialogFace は canvas の画素の数だけを合わせる（測れないときの控え）。
 * - pc：高さ 431 以上・幅 968 以上。枠の左の中（上下の真ん中）。
 * - tablet：タブレットの縦・小さな窓（高さ 431 以上・幅 541〜967）。phone：スマホ横（高さ 430 以下）。
 *   small：スマホの縦（幅 540 まで）・幅 640 までのスマホ横。この 3 つは枠の左上の角（名前の行の左。上へはみ出す）。
 */
export const DIALOG_FACE_PX = { pc: 72, tablet: 52, phone: 44, small: 36 } as const;

/**
 * 顔を出してよいか（純粋）：画面の中（view が null なら見ない）で、avoid のどれとも重ならない（0.5px までの接しは許す）。
 * 狭い画面の顔は台詞の枠の上へはみ出すので、選択肢・軍議の見出し・詳しく見る・目的の札・メニューに届く行がある。その行は顔を出さない。
 */
export function faceClear(face: Box, avoid: readonly Box[], view: { w: number; h: number } | null): boolean {
    const tol = 0.5;
    if (view && (face.left < -tol || face.top < -tol || face.right > view.w + tol || face.bottom > view.h + tol)) return false;
    return !avoid.some((o) => o.left < face.right - tol && face.left < o.right - tol && o.top < face.bottom - tol && face.top < o.bottom - tol);
}

/**
 * この台本で使える顔の ID（話し手の順・重なり無し）。顔の無い話し手・一覧に無い ID・旧表示（?art=old）は入らない（available が false）。
 * 空なら台詞の枠は Version 21 のまま（左の空きも要素も作らない）。
 */
export function dialogFaceIds(speakers: readonly string[], faceOf: (speaker: string) => ArtId | null, available: (id: ArtId) => boolean): ArtId[] {
    const out: ArtId[] = [];
    for (const sp of speakers) {
        const id = faceOf(sp);
        if (id && !out.includes(id) && available(id)) out.push(id);
    }
    return out;
}

/**
 * 行の話し手に出す顔（無ければ null：左の空きはそのまま、顔だけ出さない）。
 * - 顔の無い話し手（地の文・高札・使者・村の使い）：出さない。
 * - その人の人物画（PortraitSlot）が出ている行：顔は出さない（同じ人を大きな絵と小さな顔の 2 つで並べない）。人物画が出ていなければ顔を出す。
 */
export function dialogFaceFor(faceId: ArtId | null, portraitId: ArtId | null, portraitShown: ArtId | null): ArtId | null {
    if (!faceId) return null;
    if (portraitId && portraitId === portraitShown) return null;
    return faceId;
}

/**
 * 台詞の枠の、今の話し手の顔（<canvas class="g-face" data-art-id> を枠の先頭に置く。aria-hidden・押せない・反転しない）。
 * - 顔の空き（枠の class "has-face"）：台本のどこかの行の顔が読めたら、台本の終わりまで取ったまま（顔の無い行も空けておく）。
 *   名前・台詞の始まりの位置が行ごとに動かない。どの大きさでも台詞の字・幅・折り返しは Version 21 と同じ（ui.css）：
 *   PC では枠を左へ広げて左の中に顔を置き、狭い・低い画面では枠は Version 21 のままで、顔は枠の左上の角（名前の左。上へはみ出す）。
 * - 顔が画面の外へ出る・avoid（選択肢・軍議の見出し・詳しく見る・目的の札・メニュー・台詞）と重なる行（狭い画面の選択肢の出る行）は、
 *   顔を名前の行の高さに縮めて枠の中に収める（class "compact"）。それでも重なれば顔を出さない（data-blocked。空きはそのまま。faceClear）。
 * - 開いた時に読めている顔があれば、すぐ空きを取る（城下で先に読んでおく：ChapterGame の preloadFaces）。まだなら読み始め、
 *   最初の顔が読めた時に空きを取る（遅い端末で 1 回だけ字が右へ寄る）。どの顔も読めなければ空きも要素も作らない（Version 21 と同じ枠）。
 * - 旧表示（?art=old）・一覧に無い・顔の無い台本（架空の章・使者だけの会話）：何もしない。
 * - 描く細かさは端末の比 2 まで（元の 256 画素より細かくしない）。大きさが変わったら（向きの変更など）描き直す。
 */
export class DialogFace {
    private canvas: HTMLCanvasElement | null = null;
    /** この台本で使える顔（一覧にある物だけ） */
    private readonly ids: ArtId[];
    /** 今の行の話し手（まだ行を出していなければ null） */
    private speaker: string | null = null;
    /** 出ている人物画（PortraitSlot.onShown） */
    private portraitShown: ArtId | null = null;
    /** 描いた顔と canvas の画素の大きさ（同じなら描き直さない） */
    private drawn = '';
    private stopResize: (() => void) | null = null;
    private disposed = false;

    constructor(
        /** 台詞の枠（.g-dialog） */
        private readonly box: HTMLElement,
        speakers: readonly string[],
        private readonly resolve: (speaker: string) => ArtId | null,
        /** 話し手の人物画（その人物画が出ている行は顔を出さない。省けば見ない） */
        private readonly portraitOf: ((speaker: string) => ArtId | null) | null = null,
        /** 左の空きを取った（台詞の枠の幅が変わった。人物画の測り直しに使う） */
        private readonly onGutter: (() => void) | null = null,
        /** 顔と重ねない物（行ごとに測る。出ていない物・大きさの無い物は数えない）。省けば画面の中かだけを見る */
        private readonly avoid: (() => readonly (Element | null)[]) | null = null,
    ) {
        this.ids = dialogFaceIds(speakers, resolve, artAvailable);
    }

    /** 左の空きを取っているか（確認用） */
    get reserved(): boolean {
        return this.canvas !== null;
    }

    /** 台本を開いた：読めている顔があれば同じフレームのうちに空きを取る。無い顔は読み始める */
    start(): void {
        if (this.disposed || !this.ids.length) return;
        if (this.ids.some((id) => peekArt(id))) this.reserve();
        for (const id of this.ids) {
            if (peekArt(id)) continue;
            void loadArt(id).then((b) => {
                if (!b || this.disposed) return;
                if (!this.canvas) this.reserve();
                this.refresh();
            });
        }
    }

    /** 今の行の話し手 */
    set(speaker: string): void {
        if (this.disposed) return;
        this.speaker = speaker;
        this.refresh();
    }

    /** 出ている人物画が変わった（PortraitSlot.onShown） */
    portrait(id: ArtId | null): void {
        if (this.disposed || id === this.portraitShown) return;
        this.portraitShown = id;
        this.refresh();
    }

    private reserve(): void {
        if (this.canvas || !this.ids[0]) return;
        const c = artCanvasEl('g-face', this.ids[0]);
        c.hidden = true;
        this.box.insertBefore(c, this.box.firstChild);
        this.box.classList.add('has-face');
        this.canvas = c;
        this.stopResize = watchResize(() => {
            this.drawn = '';
            this.refresh();
        });
        this.onGutter?.();
    }

    private refresh(): void {
        const c = this.canvas;
        if (this.disposed || !c || this.speaker === null) return;
        const faceId = this.resolve(this.speaker);
        const want = dialogFaceFor(faceId && this.ids.includes(faceId) ? faceId : null, this.portraitOf?.(this.speaker) ?? null, this.portraitShown);
        const bmp = want ? peekArt(want) : null;
        if (!want || !bmp) {
            // 顔の無い行・まだ読めていない（読めた時にまだその人の行なら出す：start の読み込みの後の refresh）
            c.hidden = true;
            c.classList.remove('compact');
            delete c.dataset.blocked;
            return;
        }
        c.hidden = false;
        c.classList.remove('compact');
        delete c.dataset.blocked;
        let r = c.getBoundingClientRect();
        if (!this.clear(r)) {
            // 狭い画面で枠の上へはみ出した顔が、選択肢などに届く行（ui.css）：名前の行の高さに縮めて枠の中に収める。それでも重なれば出さない
            c.classList.add('compact');
            r = c.getBoundingClientRect();
            if (!this.clear(r)) {
                c.classList.remove('compact');
                c.hidden = true;
                c.dataset.blocked = '1';
                return;
            }
        }
        const css = r.width > 0 ? r.width : DIALOG_FACE_PX.pc;
        // 元の画像より細かい canvas は持たない（端末の比は 2 まで）
        const k = backingScale(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, Math.min(bmp.width, bmp.height) / css);
        const px = Math.max(1, Math.round(css * k));
        const key = `${want}|${px}`;
        if (key === this.drawn) return;
        this.drawn = key;
        if (c.width !== px) c.width = px;
        if (c.height !== px) c.height = px;
        c.dataset.artId = want;
        // 正方形の顔の素材を、そのまま箱いっぱいに（縦横の比は保つ。左右の反転はしない）
        paintArt(c, css, css, [{ bitmap: bmp, fit: 'cover', opts: { alignY: 0.35 } }]);
    }

    /** 測り直す（上の画面：情勢・見直しの演出・メニューが閉じて会話に戻った。隠れている間に窓の大きさが変わっていても、今の四角で決め直す） */
    relayout(): void {
        if (this.disposed) return;
        this.drawn = '';
        this.refresh();
    }

    /** 出した顔の四角が、画面の中で avoid のどれとも重ならないか（測れない・大きさの無い顔は見ない） */
    private clear(r: { left: number; top: number; right: number; bottom: number; width: number; height: number }): boolean {
        if (!(r.width > 0 && r.height > 0)) return true;
        const zero = { left: 0, top: 0 };
        const avoid: Box[] = [];
        // 台本の層の中の物（選択肢・見出し・詳しく見る・名前・台詞）は visibility を見ない：見直しの演出の下で層ごと隠れている間（g-under-cine）に
        // 窓の大きさ・向きが変わって測り直しても、層が戻った時の選択肢などを避ける。層の外の物（目的の札・メニュー）は visibility: hidden なら無いとみなす
        const layer = this.box.parentElement;
        for (const e of this.avoid?.() ?? []) {
            const b = visibleBox(e, zero, !(e && layer?.contains(e)));
            if (b) avoid.push(b);
        }
        const view = typeof innerWidth === 'number' && typeof innerHeight === 'number' && innerWidth > 0 && innerHeight > 0 ? { w: innerWidth, h: innerHeight } : null;
        return faceClear({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, avoid, view);
    }

    dispose(): void {
        this.disposed = true;
        this.stopResize?.();
        this.stopResize = null;
    }
}

/** 生成イラスト素材を使っているときにタイトルに出す、AI 生成の明示（素材パックの利用条件・共有の決まりの求め） */
export const AI_ART_NOTE = '一部の人物・背景画像はAI生成画像を加工して使用';

/** 生成イラスト素材を使っているか（旧表示 ?art=old でなく、ゲームが読む素材の一覧に 1 つ以上ある）。タイトルの AI 生成の明示に使う */
export function artInUse(): boolean {
    if (artMode() === 'old') return false;
    return Object.values(ART_IDS).some((id) => artAvailable(id));
}

/**
 * 軍議の背景（<div class="g-council-bg"> を軍議の層のいちばん前に置く。中に canvas.g-council-bg-base と、あれば canvas.g-council-bg-front）。
 * - 奥の画は箱を埋める（cover）。大事な物を置く上下 18%〜82% の内側は切らない（それ以上の横長では左右に暗い帯）。引き伸ばさない。
 * - 手前の幕・柱は、奥の画と同じ大きさ・位置で描き（fitArtBleed）、左右に揺れの幅だけ広く持つ。
 * - 揺れは CSS の animation（ui.css の g-council-sway。JS で毎フレーム動かさない）。動くのは body.g-council-art の間
 *   （軍議の層が一番上：ui/view.ts の syncUnder が付け外す）だけで、それ以外（情勢・メニュー・演出・確認が重なる）は止まる。
 *   ページが隠れている間はブラウザが止める。動きを減らすときは揺らさない（class "sway" を付けない・CSS の prefers-reduced-motion でも止める）。
 * - 背景が出ている間は、層の暗い覆いの代わりに弱い周辺の暗さ（CSS）。見出しには、その後ろだけ薄い暗さ（CSS の .g-art）。
 * - 下の 3D の陣幕の画（showCouncilHall）はそのまま（画像が読めなければ、今までの画面のまま）。
 */
export class CouncilBackdrop {
    private root: HTMLDivElement | null = null;
    private base: HTMLCanvasElement | null = null;
    private front: HTMLCanvasElement | null = null;
    private baseBmp: ImageBitmap | null = null;
    private frontBmp: ImageBitmap | null = null;
    /** 手前の幕の揺れの幅（CSS の px。動きを減らすときは 0） */
    private amp = 0;
    private stopResize: (() => void) | null = null;
    private disposed = false;

    constructor(
        private readonly layer: HTMLElement,
        private readonly art: { base: ArtId; front?: ArtId },
        private readonly reduced: () => boolean,
        /** 軍議がいちばん上か（情勢・メニュー・演出が重なっている間は、知らせを上げない・揺らさない） */
        private readonly isTop: () => boolean,
    ) {}

    start(): void {
        const b = peekArt(this.art.base);
        const f = this.art.front ? peekArt(this.art.front) : null;
        if (b) {
            // もう読めている（忠勝との会話の間に先に読んだ・2 回目からの軍議の画面・考え直す）：同じフレームのうちに出す（ちらつかせない）
            this.build(b, f, false);
        } else {
            void loadArt(this.art.base).then((bmp) => {
                if (bmp && !this.disposed && this.layer.isConnected) this.build(bmp, this.art.front ? peekArt(this.art.front) : null, true);
            });
        }
        if (this.art.front && !f) {
            const fid = this.art.front;
            void loadArt(fid).then((bmp) => {
                if (bmp && !this.disposed && this.root && !this.front) this.addFront(bmp);
            });
        }
    }

    private build(bmp: ImageBitmap, front: ImageBitmap | null, fade: boolean): void {
        const root = document.createElement('div');
        root.className = 'g-council-bg';
        root.setAttribute('aria-hidden', 'true');
        const base = artCanvasEl('g-council-bg-base', this.art.base);
        root.append(base);
        this.root = root;
        this.base = base;
        this.baseBmp = bmp;
        this.layer.insertBefore(root, this.layer.firstChild);
        this.layer.classList.add('g-art');
        // 軍議が一番上の間だけ（知らせを層の上へ・手前の幕を揺らす）。後で上に何か重なれば、view の syncUnder が外す
        if (this.isTop()) document.body.classList.add('g-council-art');
        if (front && this.art.front) {
            const c = artCanvasEl('g-council-bg-front', this.art.front);
            root.append(c);
            this.front = c;
            this.frontBmp = front;
        }
        this.draw();
        this.stopResize = watchResize(() => this.draw());
        if (fade && !this.reduced()) {
            void root.offsetWidth;
        } else {
            root.style.transition = 'none';
        }
        root.classList.add('on');
    }

    private addFront(bmp: ImageBitmap): void {
        if (!this.root || !this.art.front) return;
        const c = artCanvasEl('g-council-bg-front', this.art.front);
        this.root.append(c);
        this.front = c;
        this.frontBmp = bmp;
        this.draw();
    }

    private draw(): void {
        if (this.disposed || !this.root || !this.base || !this.baseBmp) return;
        const r = this.layer.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        const b = this.baseBmp;
        const rb = fitArt(b.width, b.height, w, h, 'cover', COUNCIL_CROP);
        sizeArtCanvas(this.base, w, h, srcPerCssOf(rb));
        // 横に余りが出る（とても横長の画面）ときの帯は、今までの軍議の覆いに近い暗い色
        paintArt(this.base, w, h, [{ bitmap: b, fit: 'cover', rect: rb }], '#0e0c0a');
        if (this.front && this.frontBmp) {
            const f = this.frontBmp;
            this.amp = this.reduced() ? 0 : parallaxAmp(w);
            // 揺らしても端に隙間が出ないよう、左右に揺れの幅ずつ広い canvas に、奥の画と同じ大きさで描く（はみ出しの分は左へずらして置く）
            const m = Math.ceil(this.amp);
            const rf = fitArtBleed(f.width, f.height, w, h, 'cover', COUNCIL_CROP, m);
            sizeArtCanvas(this.front, w + 2 * m, h, srcPerCssOf(rf));
            this.front.style.left = `${-m}px`;
            paintArt(this.front, w + 2 * m, h, [{ bitmap: f, fit: 'cover', rect: rf }]);
            this.sway();
        }
    }

    /** 揺れの幅を CSS へ（--g-sway）。幅が 0（動きを減らす）なら揺らさない */
    private sway(): void {
        const c = this.front;
        if (!c) return;
        const on = this.amp > 0;
        if (on) c.style.setProperty('--g-sway', `${this.amp.toFixed(2)}px`);
        else c.style.removeProperty('--g-sway');
        c.classList.toggle('sway', on);
    }

    /** 上の画面（情勢・見直しの演出・メニュー）が閉じて、また一番上になった：動きを減らす設定が変わっていれば描き直す（揺れの有無と幅） */
    resume(): void {
        if (this.disposed || !this.front) return;
        const swaying = this.amp > 0;
        if (swaying === this.reduced()) this.draw();
    }

    dispose(): void {
        this.disposed = true;
        this.stopResize?.();
        this.stopResize = null;
        if (this.root) document.body.classList.remove('g-council-art');
    }
}
