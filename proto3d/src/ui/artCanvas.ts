/**
 * 生成イラスト素材（Version 22）を <canvas> に描く小道具（会話の人物画・軍議の背景・合戦の顔で共用）。
 *
 * - 画像は art/registry.ts の loadArtBitmap で読んだ ImageBitmap だけを描く（<img>・CSS の背景・data: の URL は使わない）。
 * - 合わせ方：contain（全部を見せる）／cover（箱を埋める。はみ出しは切る）。引き伸ばしはしない（縦横の比は保つ）。
 * - 描く細かさ：端末の画素の比（devicePixelRatio）は 2 まで。元の画像より細かくはしない（大きな画面で余計な画素を持たない）。
 * - 大きさが変わったら描き直す（watchResize）。
 * 前半の計算（fitArt・backingScale・portraitLayout）は DOM を使わない純粋な関数（Node のテストで確かめる）。
 */
import { loadArtBitmap } from '../art/registry';
import type { ArtId } from '../art/ids';

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
 * canvas の画素の細かさ（CSS の 1px あたりの画素）。端末の比は 1〜2 に収め、元の画像の細かさ（srcPerCss：CSS の 1px に入る元の画素）より細かくしない。
 */
export function backingScale(dpr: number, srcPerCss = Number.POSITIVE_INFINITY): number {
    const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(2, Math.max(1, dpr)) : 1;
    return Math.max(1, Math.min(d, srcPerCss));
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

/** 揺れの位置（t 秒。12 秒で 1 往復の正弦。−amp〜amp） */
export function parallaxOffset(t: number, amp: number): number {
    return amp * Math.sin((2 * Math.PI * t) / 12);
}

// ================= 読み込み（同じ画像の約束を共有し、読めた物はすぐ描けるようにしておく） =================

const ready = new Map<ArtId, ImageBitmap>();

/** 読む（art/registry.ts の loadArtBitmap と同じ。読めた物は peekArt で同じフレームのうちに描ける）。旧表示・無い・失敗は null */
export function loadArt(id: ArtId): Promise<ImageBitmap | null> {
    return loadArtBitmap(id).then((b) => {
        if (b) ready.set(id, b);
        return b;
    });
}

/** もう読めている画像（まだ・無い・失敗は null）。待たずに描くときに使う */
export function peekArt(id: ArtId): ImageBitmap | null {
    return ready.get(id) ?? null;
}

// ================= 描く（DOM） =================

/** 1 枚の画像を描く指示 */
export interface ArtLayer {
    bitmap: ImageBitmap;
    fit: ArtFit;
    opts?: FitOptions;
    /** 0〜1（既定 1） */
    alpha?: number;
    /** 重ね方（既定 'source-over'。重ね変わりの後の画は 'lighter' で足すと、途中で薄くならない） */
    op?: GlobalCompositeOperation;
}

/**
 * canvas の画素の大きさを CSS の大きさに合わせる（変わったときだけ。変えると中身は消える）。返りは CSS の 1px あたりの画素。
 * srcPerCss は「元の画像の画素 ÷ 描く CSS の px」（元の画像より細かくしない。省けば端末の比のまま）。
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
        const r = fitArt(l.bitmap.width, l.bitmap.height, cssW, cssH, l.fit, l.opts);
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
