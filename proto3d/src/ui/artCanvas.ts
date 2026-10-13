/**
 * 生成イラスト素材（Version 22）を <canvas> に描く小道具と、会話の人物画（PortraitSlot）・台詞の枠の顔（DialogFace）・軍議の背景（CouncilBackdrop）。
 *
 * - 画像は art/registry.ts の loadArtBitmap で読んだ ImageBitmap だけを描く（<img>・CSS の背景・data: の URL は使わない）。
 * - 合わせ方：contain（全部を見せる）／cover（箱を埋める。はみ出しは切る）。引き伸ばしはしない（縦横の比は保つ）。
 * - 描く細かさ：端末の画素の比（devicePixelRatio）は 2 まで。元の画像より細かくはしない（大きな画面で余計な画素を持たない）。
 * - 大きさが変わったら描き直す（watchResize）。
 * - 旧表示（?art=old）・一覧に無い・読めないときは、要素を一つも作らない（Version 21 と同じ画面）。
 * 前半の計算（fitArt・fitArtBleed・backingScale・portraitLayout・portraitPlacement・portraitStep・councilArtLayout）と dialogFaceIds・dialogFaceFor は DOM を使わない純粋な関数（Node のテストで確かめる）。
 */
import { artAvailable, artEntry, artMode, loadArtBitmap } from '../art/registry';
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
    return bleedArtRect(fitArt(srcW, srcH, boxW, boxH, fit, opts), srcW, bleed);
}

/** 先に決めた描く所 r（箱の中）を、左右に bleed ずつ広い canvas へ同じ大きさ・同じ位置で描く所に直す（fitArtBleed と同じ。軍議の背景の councilArtLayout から使う） */
export function bleedArtRect(r: ArtDrawRect, srcW: number, bleed: number): ArtDrawRect {
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
 * canvas の画素の細かさ（CSS の 1px あたりの画素）。端末の比は 1〜maxDpr（既定 2）に収め、元の画像の細かさ（srcPerCss：CSS の 1px に入る元の画素）より細かくしない。
 * 元の画像が画面より粗い（1920 幅に 1536 の背景：0.8）ときは、CSS の 1px より粗い canvas にして、ブラウザが拡げて見せる（同じ見た目で画素を持たない）。
 * 人物画は maxDpr 3（大きさを原寸÷端末の比までに抑えるので、端末の比 3 の画面でも原寸の画素で描ける：PortraitSlot）
 */
export function backingScale(dpr: number, srcPerCss = Number.POSITIVE_INFINITY, maxDpr = 2): number {
    const d = Number.isFinite(dpr) && dpr > 0 ? Math.min(Math.max(1, maxDpr), Math.max(1, dpr)) : 1;
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
    /**
     * 高さの上限（CSS の px）：人物画の画像の高さ ÷ 端末の画素の比。これより大きく出さない（元の画像を拡大しない）。省けば上限なし
     */
    maxH?: number;
    /**
     * 台詞の枠（人物画の、枠の後ろに入る所は描かない）。人物画と横に重なるなら、枠の上に肩まで（shoulderY）見えなければ出さない
     */
    dialog?: Box | null;
    /** 肩が見え切る高さ（画像の上からの割合。art-build.py の set-anchor の shoulderY。省けば PORTRAIT_RULES.shoulderY） */
    shoulderY?: number;
    /**
     * 大きさの元にする枠（Version 27。portraitPlacement の frame）：軍議の背景を画面より小さく描いている間の、描いた所（画面の中に見えている所）。
     * 高さの上限は画面でなくこの枠の高さの割合（pcFrac・phoneFrac）、右の端もこの枠まで。left・bottom は呼ぶ側が枠に合わせて渡す。
     * 省けば（null）画面（vw×vh）が元（Version 26 と同じ）
     */
    frame?: Box | null;
}

/**
 * 人物画を置く所（Version 27。docs/v25-portraits.md の 13）。軍議の背景を画面より小さく真ん中に描いている（描いた所が層の幅・高さに足りない。
 * 表示の倍率を 1.25 倍に抑えた 2560×1440・1920×1200・1024×1366 など）間は、人物画もその描いた所（層の中に見えている所 bg）を元にする：
 * 左端は描いた所の左端＋inset（CSS の左の空き cssLeft と、背景の左の縁をなじませる幅 fadeLeft の大きい方）、下端は描いた所の下端、
 * 大きさの元（frame）は描いた所。背景が画面いっぱい・出ていない（bg が null）ときは Version 26 と同じ（左端は CSS、下端は層の下の端、枠なし）。
 */
export function portraitPlacement(vw: number, vh: number, cssLeft: number, bg: (Box & { fadeLeft?: number }) | null): { left: number; bottom: number; frame: Box | null } {
    const full = { left: cssLeft, bottom: vh, frame: null };
    if (!bg || !(vw > 0 && vh > 0)) return full;
    const f: Box = { left: Math.max(0, bg.left), top: Math.max(0, bg.top), right: Math.min(vw, bg.right), bottom: Math.min(vh, bg.bottom) };
    if (!(f.right - f.left >= 1 && f.bottom - f.top >= 1)) return full;
    // 画面いっぱい（丸めの誤差の 0.5px まで）：枠を使わない（Version 26 と同じ四角）
    if (f.left <= 0.5 && f.top <= 0.5 && f.right >= vw - 0.5 && f.bottom >= vh - 0.5) return full;
    const fade = f.left > 0.5 && Number.isFinite(bg.fadeLeft) ? Math.max(0, bg.fadeLeft ?? 0) : 0;
    return { left: f.left + Math.max(cssLeft, fade), bottom: f.bottom, frame: f };
}

/** 人物画の大きさの決まり（docs：art-v22・v25-portraits。測った所は Version 21〜24 の会話・軍議の画面） */
export const PORTRAIT_RULES = {
    /** これより低い画面では出さない（顔だけ台詞の枠に出す） */
    minViewportH: 340,
    /**
     * 画面の高さに対する割合の上限（スマホ横＝高さ 430 以下・それより高い画面）。Version 25 から PC の 620px・スマホ横の 300px の上限を外し、
     * 画面と元の画像の画素（maxH）が許すだけ大きくする
     */
    phoneFrac: 0.8,
    pcFrac: 0.86,
    /** 左下の空き（人物画の左端から、その高さの範囲で一番近い避ける物まで）がこれより狭ければ出さない */
    minFreeW: 150,
    /** 人物画がこれより低くなるなら出さない（顔が小さすぎる） */
    minH: 210,
    /** 肩が見え切る高さの既定（画像の上からの割合。素材の meta.shoulderY が無いとき。第 2 版の 6 枚は 0.40〜0.46） */
    shoulderY: 0.46,
} as const;

/**
 * 人物画の大きさ（左下に置き、下端は画面の下の端）。避ける物と重ならない一番大きな大きさを返す。小さすぎれば null（出さない）。
 * 下から上・左から右へ広がる四角なので、避ける物ごとに「幅で避ける」か「高さで避ける」かの大きい方までは広げてよい。
 * 出さないのは：画面が低い（340 未満）・人物画が低くなりすぎる（210 未満）・その高さの範囲で左下の空きの幅が 150 未満・
 * 台詞の枠の上に肩まで見えない（頭・髷・肩を枠の後ろに隠さない。下の方＝腰から下だけが枠の後ろに入ってよい）。
 * 元の画像の画素より大きくしない（maxH：画像の高さ ÷ 端末の画素の比）。
 */
export function portraitLayout(p: PortraitLayoutInput): { w: number; h: number } | null {
    const R = PORTRAIT_RULES;
    if (!(p.vw > 0 && p.vh >= R.minViewportH && p.aspect > 0)) return null;
    const gap = p.gap ?? 8;
    const phone = p.vh <= 430;
    // 大きさの元：画面、または軍議の背景を画面より小さく描いている間はその描いた所（Version 27。縦横の比は保ち、切って収めない）
    const f = p.frame && p.frame.right > p.frame.left && p.frame.bottom > p.frame.top ? p.frame : null;
    const baseH = f ? Math.min(p.vh, f.bottom - f.top) : p.vh;
    const right = f ? Math.min(p.vw, f.right) : p.vw;
    let h = baseH * (phone ? R.phoneFrac : R.pcFrac);
    // 元の画像を拡大しない（端末の画素で原寸まで）
    if (p.maxH !== undefined && Number.isFinite(p.maxH)) h = Math.min(h, Math.max(0, p.maxH));
    // 画面（枠）の右へははみ出さない
    h = Math.min(h, (right - p.left - gap) / p.aspect);
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
    let free = right - gap - p.left;
    for (const o of live) if (o.bottom > top) free = Math.min(free, o.left - gap - p.left);
    if (free < R.minFreeW) return null;
    // 台詞の枠の後ろに入るのは腰から下だけ：枠が人物画と横に重なるなら、枠の上端より上に肩まで（shoulderY）見えていること
    // （小さくすると上端が下がって見える割合が減るので、縮めずに出さない。顔は台詞の枠に出る）
    const d = p.dialog;
    if (d && d.right > d.left && d.bottom > d.top && d.left < p.left + w && d.right > p.left && d.top < p.bottom) {
        const sy = p.shoulderY !== undefined && p.shoulderY > 0 && p.shoulderY < 1 ? p.shoulderY : R.shoulderY;
        if (d.top - top < sy * h) return null;
    }
    return { w, h };
}

/**
 * 軍議の背景の見せ方の決まり（Version 26。docs/v25-portraits.md の 5・5a）。倍率はどれも「描く CSS の px ÷ 元の画像の画素」（表示の倍率）で、
 * 端末の画素の比（devicePixelRatio）は見ない（端末の画素の密度だけを理由に、背景を外したり小さくしたりしない）。
 */
export const COUNCIL_ART = {
    /**
     * 表示の倍率の上限（S_MAX）。1664×936 の素材を 1920×1080 に描く 1.154 倍は利用者が認めた（Version 26 の依頼）。
     * 1.15・1.25・1.35・1.5 倍を同じ画面の画素で並べて比べ（docs 5a）、1.25 までは 1.15 倍と見分けにくく、1.35 から城の屋根・幕の織り目の甘さが目に付き、
     * 1.5 では明らかにぼやけるので 1.25 にした。これを超える画面（2560×1440 の 1.54 倍など）は、この倍率で描いて周りを暗くする（引き伸ばさない・外さない）
     */
    maxScale: 1.25,
    /** 上下で切ってよい割合（それより内側の大事な物は切らない。それ以上の横長の画面は左右に暗い帯） */
    maxCropY: 0.18,
    /**
     * 画面より縦長・横長で素材を切る時に、見せる所の真ん中（元の画像の幅・高さに対する割合）。縦向きのスマホは素材の幅の 25〜32% しか見えない。
     * 0.42・0.5・0.58・0.66 を 390×844 で比べ（docs 5a）、真ん中（0.5：柱・陣幕・梁。見出しの後ろが一番暗い）にした。
     * 0.58 から右の明るい空と天守がメニュー・見出しの横に入り、0.42 は明るい陣幕が広い
     */
    focusX: 0.5,
    focusY: 0.5,
    /** 倍率を抑えて画面より小さく描いた時、絵の縁を周りの暗い色へなじませる幅（描いた絵の短い辺に対する割合と、その上限・下限の CSS の px） */
    feather: 0.07,
    featherMinPx: 24,
    featherMaxPx: 110,
} as const;

/** 軍議の背景をこの画面にどう描くか（councilArtLayout） */
export interface CouncilArtLayout {
    /** 画面を埋める（cover。上下は maxCropY まで切る）のに要る表示の倍率（CSS の px ÷ 元の画素） */
    need: number;
    /** 描く表示の倍率（need と maxScale の小さい方。縦横同じ倍率） */
    scale: number;
    /** 倍率を抑えた（need > maxScale）：画面より小さく真ん中に描き、周りは暗い色（表示の範囲を限る） */
    limited: boolean;
    /** 元の画像の切り出し（sx..sw）と、画面（層）の中の描く所（dx..dw。CSS の px）。dw÷sw ＝ dh÷sh ＝ scale */
    rect: ArtDrawRect;
}

/**
 * 軍議の背景の描き方（純粋）。画面（vw×vh。CSS の px）を cover で埋め（上下は maxCropY まで切る）、その倍率が maxScale を超えるなら maxScale で描く。
 * 縦横は同じ倍率（引き伸ばさない・形を変えない）。切る所は focusX・focusY を真ん中に（画像の外へは出ない）。画面より小さい向きは真ん中に置く。
 * 端末の画素の比は使わない。大きさのおかしな値は null（描かない）。
 */
export function councilArtLayout(srcW: number, srcH: number, vw: number, vh: number, rules: { maxScale: number; maxCropY: number; focusX: number; focusY: number } = COUNCIL_ART): CouncilArtLayout | null {
    if (!(srcW > 0 && srcH > 0 && vw > 0 && vh > 0 && Number.isFinite(vw) && Number.isFinite(vh))) return null;
    const W = Math.max(1, Math.round(vw));
    const H = Math.max(1, Math.round(vh));
    const keep = Math.max(0.05, 1 - 2 * clamp01(rules.maxCropY));
    const need = Math.min(Math.max(W / srcW, H / srcH), H / (srcH * keep));
    const cap = rules.maxScale > 0 ? rules.maxScale : need;
    const scale = Math.min(need, cap);
    // 画面いっぱい（丸めの誤差で 1px の 1 億分の 1 だけ足りない時も）は、画面の幅・高さちょうどに
    const dw = srcW * scale >= W - 1e-6 ? W : srcW * scale;
    const dh = srcH * scale >= H - 1e-6 ? H : srcH * scale;
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = Math.min(srcW - sw, Math.max(0, clamp01(rules.focusX) * srcW - sw / 2));
    const sy = Math.min(srcH - sh, Math.max(0, clamp01(rules.focusY) * srcH - sh / 2));
    return { need, scale, limited: need > cap + 1e-9, rect: { sx, sy, sw, sh, dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh } };
}

/** 画面を埋めるのに要る表示の倍率（councilArtLayout の need。記録・確かめ用。大きさのおかしな値は Infinity） */
export function councilArtScale(srcW: number, srcH: number, vw: number, vh: number): number {
    return councilArtLayout(srcW, srcH, vw, vh)?.need ?? Number.POSITIVE_INFINITY;
}

/**
 * 画面より小さく描いた絵の縁をなじませる幅（CSS の px）。描いた絵の短い辺の 7%（24〜110px）で、周りの暗い帯（band：片側の幅）が細いときは
 * その 2 倍まで（1920×1200 の上下 15px の帯で、絵の上下 80px を暗くしない）。帯が無い向き（band ≦ 0.5）は 0
 */
export function councilFeatherPx(dw: number, dh: number, band = Number.POSITIVE_INFINITY): number {
    if (!(band > 0.5)) return 0;
    const r = COUNCIL_ART;
    const base = Math.min(r.featherMaxPx, Math.max(r.featherMinPx, r.feather * Math.min(dw, dh)));
    return Math.round(Math.max(1, Math.min(base, 2 * band)));
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
export type PortraitStep = { kind: 'show'; id: ArtId } | { kind: 'hide' };

/** 人物でない話し手（地の文・高札）。この行では人物画を下げる */
export const NON_PERSON_SPEAKERS: readonly string[] = ['narration', 'notice'];

/**
 * 行の話し手から、人物画をどうするか（docs/v25-portraits.md：決めた見せ方）。
 * - 絵のある人（家康・忠勝・酒井・石川・榊原・長政）：その人の絵を出す。
 * - 絵の無い話し手（使者・村の使い・知らない話し手）と、地の文・高札：下げる（前の人の絵を残さない）。
 *   Version 22〜24 は「絵の無い人物の行は前の人の絵を暗く残す」だったが、使者の行に家康・忠勝の絵が話し手のように残るので、Version 25 で下げるに変えた
 *   （暗く残っていた行は、ほとんど酒井・石川の行で、今は本人の絵が出る）。
 */
export function portraitStep(speaker: string, id: ArtId | null): PortraitStep {
    if (NON_PERSON_SPEAKERS.includes(speaker)) return { kind: 'hide' };
    return id ? { kind: 'show', id } : { kind: 'hide' };
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
export function sizeArtCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, srcPerCss?: number, maxDpr?: number): number {
    const k = backingScale(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, srcPerCss, maxDpr);
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

/**
 * 描いた絵（img：canvas の CSS の px）の縁を透明へ抜いて、後ろの暗い地になじませる（軍議の背景の、倍率を抑えて画面より小さく描いた時）。
 * 左右の縁を幅 fx、上下の縁を幅 fy（CSS の px。0 ならその向きは抜かない）で 1→0 へ抜く。canvas の画素の大きさは sizeArtCanvas で合わせてある前提。
 */
export function featherArt(canvas: HTMLCanvasElement, cssW: number, cssH: number, img: { x: number; y: number; w: number; h: number }, fx: number, fy: number): void {
    const x = fx > 0;
    const y = fy > 0;
    if (!x && !y) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ax = Math.min(fx, img.w / 2);
    const ay = Math.min(fy, img.h / 2);
    ctx.setTransform(canvas.width / Math.max(1, cssW), 0, 0, canvas.height / Math.max(1, cssH), 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    const band = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
    };
    const { x: l, y: t, w, h } = img;
    if (x) {
        band(l, 0, l + ax, 0, l, t, ax, h);
        band(l + w, 0, l + w - ax, 0, l + w - ax, t, ax, h);
    }
    if (y) {
        band(0, t, 0, t + ay, l, t, w, ay);
        band(0, t + h, 0, t + h - ay, l, t + h - ay, w, ay);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * canvas の下の縁を幅 px（CSS の px）で 1→0 へ透明に抜く（Version 27。範囲を限って描いた軍議の背景の下の縁と同じ所・同じ幅で、人物画の腰の切り口をなじませる）。
 * 0 以下なら何もしない。canvas の画素の大きさは sizeArtCanvas で合わせてある前提
 */
export function fadeArtBottom(canvas: HTMLCanvasElement, cssW: number, cssH: number, px: number): void {
    if (!(px > 0)) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const a = Math.min(px, cssH);
    ctx.setTransform(canvas.width / Math.max(1, cssW), 0, 0, canvas.height / Math.max(1, cssH), 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(0, cssH, 0, cssH - a);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cssH - a, cssW, a);
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

/** 人物画の入れ替え（話し手が変わった）の重ね変わりの時間（ミリ秒。動きを減らすときは無し）。出る・下がるのも同じ長さ（ui.css） */
export const PORTRAIT_FADE_MS = 140;

/** 人物画の canvas の細かさの上限（端末の画素の比。大きさを原寸 ÷ 端末の比までにするので、3 の画面でも元の画素で描ける） */
const PORTRAIT_MAX_DPR = 3;

/** 端末の画素の比（ブラウザの拡大を含む。測れなければ 1） */
function currentDpr(): number {
    return typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

/** 人物画は左下に寄せる（下端を画面の下の端に） */
const PORTRAIT_FIT: FitOptions = { alignX: 0, alignY: 1 };

/**
 * 軍議の背景を画面より小さく描いている間の、描いた所（層の中の CSS の px。CouncilBackdrop.frame）と、その縁を暗い地へなじませる幅
 * （左右の縁 fadeLeft・上下の縁 fadeBottom。帯の無い向きは 0）。人物画の大きさ・位置の元にする（Version 27）
 */
export interface ArtFrame extends Box {
    fadeLeft: number;
    fadeBottom: number;
}

/** 人物画の大きさ・位置（PortraitSlot が測った物） */
interface PortraitMeasure {
    w: number;
    h: number;
    /** 台詞の枠の後ろで抜く所 */
    cut: ArtCut | null;
    /** 左端（層の左から） */
    left: number;
    /** 下端の、層の下の端からの高さ（枠が無ければ 0） */
    inset: number;
    /** 描いた背景を元にした（Version 27） */
    framed: boolean;
    /** 下の縁をなじませる幅（CSS の px。0 ならなじませない） */
    fade: number;
}


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
 * 会話・軍議の話し手の人物画（左下。<canvas class="g-portrait" data-art-id>）。選択肢・台詞の枠より下に重なる（DOM で前に置く）。
 * 大きさは、選択肢・軍議の見出し・詳しく見る・メニュー・目的の札と重ならない一番大きな物（portraitLayout）で、
 * 元の画像の画素より大きくしない（画像の高さ ÷ 端末の画素の比まで）。下の方（腰から下）は台詞の枠の後ろ（枠の中は描かない）。
 * 枠の上に肩まで見えない・空きが小さすぎるときは出さない（台詞の枠の顔がその人を示す）。左右の反転はしない（着物の合わせが逆になる）。
 * 行ごとの出し方は portraitStep：絵のある人の行はその人の絵、絵の無い話し手・地の文・高札の行は下げる（前の人の絵を話し手のように残さない）。
 * 位置は absolute で、出ても下がっても台詞・選択肢の位置は動かない（遅れて読めた絵も、押そうとしている選択肢をずらさない）。
 */
export class PortraitSlot {
    private canvas: HTMLCanvasElement | null = null;
    /** 見せている人物画（出ている・出かけている。無ければ null） */
    private shown: ArtId | null = null;
    /** 見せたい人物画（今の行の話し手の絵。絵の無い話し手・地の文の行は null） */
    private want: ArtId | null = null;
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
    /**
     * 軍議の背景を画面より小さく描いている間の、描いた所（CouncilBackdrop.frame。ui/view.ts が付ける）。四角を返す間は、人物画の大きさ・左端・下端を
     * その描いた所に合わせ、腰の切り口を背景の下の縁と同じになじませる（Version 27）。null・付けていない（会話の画面）なら Version 26 と同じ（画面が元）
     */
    frameOf: (() => ArtFrame | null) | null = null;

    constructor(
        private readonly layer: HTMLElement,
        /** この要素の前に置く（会話・軍議とも選択肢：選択肢・台詞の枠より後ろ、軍議の見出しとその後ろの薄い暗さより手前。Version 26） */
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
            // 絵の無い話し手（使者・村の使い）・地の文・高札：前の人の絵を下げる（話し手のように残さない）
            this.want = null;
            this.hide();
            return;
        }
        const id = step.id;
        this.want = id;
        const bmp = peekArt(id);
        if (bmp) {
            this.show(id, bmp);
            return;
        }
        // まだ読めていない：前の人の絵は下げ、読めたときにまだその人の行なら出す（読めなければ出さない。名前・台詞・操作はそのまま）
        if (this.shown !== id) this.hide();
        void loadArt(id).then((b) => {
            if (b && !this.disposed && this.want === id) this.show(id, b);
        });
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

    /**
     * 大きさと、台詞の枠の後ろで抜く所を測る（canvas は出ている前提。左端は CSS が決める：安全域を含む）。狭すぎれば null。
     * 軍議の背景を画面より小さく描いている間（frameOf が四角を返す）は、その描いた所を元に大きさ・左端・下端を決め、腰の切り口を背景の下の縁と同じになじませる（Version 27）
     */
    private measure(c: HTMLCanvasElement, id: ArtId, bmp: ImageBitmap): PortraitMeasure | null {
        const origin = this.layer.getBoundingClientRect();
        const avoid: Box[] = [];
        for (const sel of ['.g-choices', '.g-council-head', '.g-council-map']) {
            const e = this.layer.querySelector(sel);
            const b = visibleBox(e, origin);
            // 軍議の見出しは文字の箱だけ（Version 26）。背景が出ている間の見出しの後ろの薄い暗さ（ui.css の ::before）は数えない：
            // 背景の有無で立ち絵の大きさを変えない。人物画は見出しより後ろの DOM（ui/view.ts の anchor が選択肢）なので、暗さの上に描かれ、暗くならない
            if (b) avoid.push(b);
        }
        for (const e of this.outside()) {
            const b = visibleBox(e, origin, true);
            if (b) avoid.push(b);
        }
        // 左端は CSS が決める（安全域を含む）。前に描いた所へ合わせて動かした位置（style の left・bottom）を外してから測る
        if (c.style.left || c.style.bottom) {
            c.style.left = '';
            c.style.bottom = '';
        }
        const cssLeft = c.getBoundingClientRect().left - origin.left;
        // 軍議の背景を画面より小さく描いている間は、その描いた所が元（画面いっぱい・出ていない・会話の画面は null で Version 26 と同じ）
        const bg = this.frameOf?.() ?? null;
        const place = portraitPlacement(origin.width, origin.height, cssLeft, bg);
        const left = place.left;
        const d = visibleBox(this.dialog, origin);
        const sy = Number(artEntry(id)?.meta?.shoulderY);
        const shoulder = Number.isFinite(sy) && sy > 0 && sy < 1 ? sy : undefined;
        const size = portraitLayout({
            vw: origin.width,
            vh: origin.height,
            left,
            bottom: place.bottom,
            aspect: bmp.width / bmp.height,
            avoid,
            // 元の画像を拡大しない（端末の画素で原寸まで）
            maxH: bmp.height / currentDpr(),
            dialog: d,
            frame: place.frame,
            ...(shoulder !== undefined ? { shoulderY: shoulder } : {}),
        });
        if (!size) return null;
        const top = place.bottom - size.h;
        const cut = d && d.left < left + size.w && d.right > left && d.bottom > top && d.top < place.bottom ? { x: d.left - left, y: d.top - top, w: d.right - d.left, h: d.bottom - d.top, r: 14 } : null;
        // 腰の切り口（画像の下の端）が描いた背景の下の縁に来る：背景と同じ幅でなじませる（肩より下の、さらに下半分まで。頭・髷・肩は抜かない）
        const fade = place.frame && bg ? Math.round(Math.min(Math.max(0, bg.fadeBottom), (size.h * (1 - (shoulder ?? PORTRAIT_RULES.shoulderY))) / 2)) : 0;
        return { ...size, cut, left, inset: Math.max(0, origin.height - place.bottom), framed: !!place.frame, fade };
    }

    private paint(c: HTMLCanvasElement, m: PortraitMeasure, layers: ArtLayer[]): void {
        paintArt(c, m.w, m.h, layers, undefined, m.cut);
        fadeArtBottom(c, m.w, m.h, m.fade);
    }

    private show(id: ArtId, bmp: ImageBitmap): void {
        const c = this.ensureCanvas(id);
        clearTimeout(this.hideTimer);
        const wasShown = this.shown;
        const prev = wasShown && wasShown !== id ? peekArt(wasShown) : null;
        c.hidden = false;
        const m = this.measure(c, id, bmp);
        if (!m) {
            // 空きが小さすぎる（低い画面・選択肢が左まで来る）：出さない
            this.hide(true);
            return;
        }
        const key = `${m.w}x${m.h}|${m.cut ? `${Math.round(m.cut.x)},${Math.round(m.cut.y)},${Math.round(m.cut.w)},${Math.round(m.cut.h)}` : '-'}|${m.framed ? `${Math.round(m.left)},${Math.round(m.inset)},${m.fade}` : '-'}`;
        const changed = key !== this.key;
        this.key = key;
        // 描いた背景に合わせた位置（Version 27）。画面が元の時は CSS のまま（measure が外した）
        if (m.framed) {
            c.style.left = `${m.left}px`;
            c.style.bottom = `${m.inset}px`;
        }
        // 元の画像より細かい canvas は持たない（contain で合わせた大きさから）。端末の比 3 までは端末の画素で描く（大きさは原寸 ÷ 端末の比まで）
        sizeArtCanvas(c, m.w, m.h, srcPerCssOf(fitArt(bmp.width, bmp.height, m.w, m.h, 'contain', PORTRAIT_FIT)), PORTRAIT_MAX_DPR);
        c.dataset.artId = id;
        this.shown = id;
        const reduced = this.reduced();
        c.style.transition = reduced ? 'none' : '';
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
     * 画面の大きさが変わった・台詞の枠の幅が変わった（顔の空きを取った）・選択肢の並びを収め直した・軍議の背景が出入りした：測り直して描き直す
     * （重ね変わりはしない。狭くて隠していた絵は、広がれば出す）
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
 * - Version 26 から、どの大きさの画面でも出す（端末の画素の比では外さない）。描き方は councilArtLayout：画面を cover で埋め（上下は 18% まで切る）、
 *   その表示の倍率（CSS の px ÷ 元の画素）が COUNCIL_ART.maxScale（1.25）を超える画面（2560×1440 など）は 1.25 倍で真ん中に描き、
 *   周りは暗い色（.g-council-bg の地の色）にして、絵の縁をなじませる（表示の範囲を限る。引き伸ばさない・形を変えない）。
 *   Version 25 までは「cover の倍率 × 端末の画素の比 ≦ 1」の画面だけで、1920×1080・端末の比 2 の多くの画面では出さなかった。
 * - canvas は描く所（倍率を抑えた時は画面より小さい）だけの大きさで、画素は元の画像の画素まで（端末の比 2 まで。sizeArtCanvas）。
 *   展開した画像のほかに持つのは、多くても元の画像と同じ画素の数（1664×936）。
 * - 窓の大きさ・向きが変わったら描き直す。画面の大きさが測れない（0）間は出さない。
 * - 横を切る縦向きのスマホでは、見せる所の真ん中を COUNCIL_ART.focusX・focusY に合わせる。文字・ボタンは絵に描き込まない（DOM のまま）。
 * - 手前の幕・柱は、奥の画と同じ大きさ・位置で描き（bleedArtRect）、左右に揺れの幅だけ広く持つ。
 * - 揺れは CSS の animation（ui.css の g-council-sway。JS で毎フレーム動かさない）。動くのは body.g-council-art の間
 *   （軍議の層が一番上：ui/view.ts の syncUnder が付け外す）だけで、それ以外（情勢・メニュー・演出・確認が重なる）は止まる。
 *   ページが隠れている間はブラウザが止める。動きを減らすときは揺らさない（class "sway" を付けない・CSS の prefers-reduced-motion でも止める）。
 * - 背景が出ている間は、層の暗い覆いの代わりに弱い周辺の暗さ（CSS）。見出しには、その後ろだけ薄い暗さ（CSS の .g-art）。
 * - 下の 3D の陣幕の画（showCouncilHall）はそのまま（画像が読めなければ、今までの画面のまま）。
 * - 出入りした（層の g-art が変わった）ら onChange を呼ぶ（人物画の測り直し）。背景と見出しの後ろの薄い暗さは、立ち絵の大きさを変えない
 *   （PortraitSlot は見出しの文字の箱だけを避け、暗さより手前に描く。Version 26）。
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
    /** 読み始めた（出せる大きさになった時に 1 回だけ読む） */
    private loading = false;
    /** 今出している（層に g-art が付いている） */
    private active = false;

    constructor(
        private readonly layer: HTMLElement,
        private readonly art: { base: ArtId; front?: ArtId },
        private readonly reduced: () => boolean,
        /** 軍議がいちばん上か（情勢・メニュー・演出が重なっている間は、知らせを上げない・揺らさない） */
        private readonly isTop: () => boolean,
        /** 背景が出た・外れた（人物画の測り直し） */
        private readonly onChange: (() => void) | null = null,
    ) {}

    /** 今の画面の大きさで描けるか（画像の大きさは一覧の記録から。読んでいなくても決められる）。Version 26 からは、層の大きさが測れれば描ける */
    private fitsNow(): boolean {
        const e = this.baseBmp ? { w: this.baseBmp.width, h: this.baseBmp.height } : artEntry(this.art.base);
        if (!e) return false;
        const r = this.layer.getBoundingClientRect();
        return councilArtLayout(e.w, e.h, r.width, r.height) !== null;
    }

    start(): void {
        // 旧表示・?art=v24・?artOff=council・一覧に無い：何もしない（見張りも付けない。Version 21／24 と同じ画面）
        if (this.disposed || !artEntry(this.art.base)) return;
        if (this.fitsNow()) this.begin();
        // 層の大きさが測れない（0）：読まずに待ち、測れる大きさになったら読む
        else this.watch();
    }

    /** 大きさ・向きが変わったら決め直す（描ける大きさになったら読む・描き直す・測れなくなったら外す） */
    private watch(): void {
        if (!this.stopResize && !this.disposed) this.stopResize = watchResize(() => this.refit());
    }

    private unwatch(): void {
        this.stopResize?.();
        this.stopResize = null;
    }

    /** 読み始める（もう読めていれば同じフレームのうちに出す） */
    private begin(): void {
        if (this.loading || this.disposed) return;
        this.loading = true;
        const b = peekArt(this.art.base);
        const f = this.art.front ? peekArt(this.art.front) : null;
        if (b) {
            // もう読めている（忠勝との会話の間に先に読んだ・2 回目からの軍議の画面・考え直す）：同じフレームのうちに出す（ちらつかせない）
            this.build(b, f, false);
        } else {
            void loadArt(this.art.base).then((bmp) => {
                if (bmp && !this.disposed && this.layer.isConnected) this.build(bmp, this.art.front ? peekArt(this.art.front) : null, true);
                // 読めない：この軍議の画面では出さない（見張りも外す。名前・台詞・選択肢はそのまま）
                else if (!bmp) this.unwatch();
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
        if (front && this.art.front) {
            const c = artCanvasEl('g-council-bg-front', this.art.front);
            root.append(c);
            this.front = c;
            this.frontBmp = front;
        }
        if (fade && !this.reduced()) {
            void root.offsetWidth;
        } else {
            root.style.transition = 'none';
        }
        this.watch();
        this.refit();
    }

    private addFront(bmp: ImageBitmap): void {
        if (!this.root || !this.art.front) return;
        const c = artCanvasEl('g-council-bg-front', this.art.front);
        this.root.append(c);
        this.front = c;
        this.frontBmp = bmp;
        this.draw();
    }

    /** 今の大きさで出すか外すかを決め直し、出すなら描く */
    private refit(): void {
        if (this.disposed) return;
        const fits = this.fitsNow();
        if (fits && !this.loading) {
            this.begin();
            return;
        }
        const root = this.root;
        if (!root) return;
        if (fits) {
            this.draw();
            if (!this.active) {
                this.active = true;
                root.hidden = false;
                this.layer.classList.add('g-art');
                // 軍議が一番上の間だけ（知らせを層の上へ・手前の幕を揺らす）。後で上に何か重なれば、view の syncUnder が外す
                if (this.isTop()) document.body.classList.add('g-council-art');
                root.classList.add('on');
                this.onChange?.();
            }
        } else if (this.active || !root.hidden) {
            // 層の大きさが測れなくなった（0）：外して Version 24 と同じ軍議の画面に戻す
            this.active = false;
            root.hidden = true;
            root.classList.remove('on');
            this.layer.classList.remove('g-art');
            document.body.classList.remove('g-council-art');
            this.onChange?.();
        }
    }

    private draw(): void {
        if (this.disposed || !this.root || !this.base || !this.baseBmp) return;
        const r = this.layer.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        const b = this.baseBmp;
        const lay = councilArtLayout(b.width, b.height, w, h);
        if (!lay) return;
        const rb = lay.rect;
        // canvas は描く所だけ（倍率を抑えた・とても横長の画面では画面より小さい。周りは .g-council-bg の地の暗い色）
        const inner: ArtDrawRect = { ...rb, dx: 0, dy: 0 };
        // 画面の中にある縁（周りが暗い向き）だけ、暗い色へなじませる（幅は向きごと。帯が細ければ細く）
        const fx = councilFeatherPx(rb.dw, rb.dh, rb.dx);
        const fy = councilFeatherPx(rb.dw, rb.dh, rb.dy);
        sizeArtCanvas(this.base, rb.dw, rb.dh, srcPerCssOf(rb));
        this.base.style.left = `${rb.dx}px`;
        this.base.style.top = `${rb.dy}px`;
        paintArt(this.base, rb.dw, rb.dh, [{ bitmap: b, fit: 'cover', rect: inner }]);
        featherArt(this.base, rb.dw, rb.dh, { x: 0, y: 0, w: rb.dw, h: rb.dh }, fx, fy);
        if (this.front && this.frontBmp) {
            const f = this.frontBmp;
            this.amp = this.reduced() ? 0 : parallaxAmp(w);
            // 揺らしても端に隙間が出ないよう、左右に揺れの幅ずつ広い canvas に、奥の画と同じ大きさで描く（はみ出しの分は左へずらして置く）
            const m = Math.ceil(this.amp);
            const lf = councilArtLayout(f.width, f.height, w, h);
            if (lf) {
                const rf = bleedArtRect({ ...lf.rect, dx: 0, dy: 0 }, f.width, m);
                sizeArtCanvas(this.front, lf.rect.dw + 2 * m, lf.rect.dh, srcPerCssOf(rf));
                this.front.style.left = `${lf.rect.dx - m}px`;
                this.front.style.top = `${lf.rect.dy}px`;
                paintArt(this.front, lf.rect.dw + 2 * m, lf.rect.dh, [{ bitmap: f, fit: 'cover', rect: rf }]);
                featherArt(this.front, lf.rect.dw + 2 * m, lf.rect.dh, { x: rf.dx, y: 0, w: rf.dw, h: lf.rect.dh }, fx, fy);
            }
            this.sway();
        }
        if (import.meta.env?.DEV) {
            // 開発用の確かめ（本番には出ない）：元の画像の寸法と、この画面での表示の寸法（CSS の px・端末の画素）・倍率
            const dpr = currentDpr();
            const n = (v: number) => Math.round(v * 1000) / 1000;
            this.root.dataset.probe = JSON.stringify({
                file: [b.width, b.height],
                view: [w, h],
                dpr,
                need: n(lay.need),
                scale: n(lay.scale),
                limited: lay.limited,
                src: [rb.sx, rb.sy, rb.sw, rb.sh].map(n),
                css: [rb.dx, rb.dy, rb.dw, rb.dh].map(n),
                device: [rb.dw * dpr, rb.dh * dpr].map(n),
                deviceScale: n(lay.scale * dpr),
                canvas: [this.base.width, this.base.height],
                feather: [fx, fy],
            });
        }
    }

    /**
     * 描いた背景の、層の中に見えている所（CSS の px。層の左上から）と縁をなじませる幅（Version 27。人物画の元：PortraitSlot.frameOf）。
     * 出ていない（読めていない・読めない・層が測れない・片付けた）時は null。今の層の大きさから councilArtLayout で決め直す
     * （窓の大きさが変わったフレームで、背景の描き直しより先に人物画が測っても、古い四角を使わない）。画面いっぱいの時も四角を返す（使うかは portraitPlacement が決める）
     */
    frame(): ArtFrame | null {
        if (this.disposed || !this.active || !this.baseBmp) return null;
        const r = this.layer.getBoundingClientRect();
        const lay = councilArtLayout(this.baseBmp.width, this.baseBmp.height, Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
        if (!lay) return null;
        const rb = lay.rect;
        return {
            left: rb.dx,
            top: rb.dy,
            right: rb.dx + rb.dw,
            bottom: rb.dy + rb.dh,
            fadeLeft: councilFeatherPx(rb.dw, rb.dh, rb.dx),
            fadeBottom: councilFeatherPx(rb.dw, rb.dh, rb.dy),
        };
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
        if (this.disposed || !this.front || !this.active) return;
        const swaying = this.amp > 0;
        if (swaying === this.reduced()) this.draw();
    }

    dispose(): void {
        this.disposed = true;
        this.unwatch();
        if (this.root) document.body.classList.remove('g-council-art');
    }
}
