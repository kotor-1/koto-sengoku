/**
 * 情勢の地図（模式図）を SVG の要素の木にする（純粋な TypeScript。DOM を使わない。画面は ui/ がこの木から要素を作る）。
 * 設計：docs/story-rpg-design.md §3・§4。型：story/types.ts の MapScene。
 *
 * 決まり：
 * - viewBox は固定（MAP_VIEW）。地図の点（0〜100）は左の枠の中へ写す。右の欄は凡例。下の行は模式図の注記（必ず出す）。
 * - 文字は 14 単位以上（スマホ横 844×390 で 12px 以上になる大きさ。画面の側で縮みすぎないように置く）。場所の名前は 16、添え書き・線の名前は 15。
 * - 文字は線・国の輪より上に重ね（重ねる順：線 → 国 → 場所）、背景の色の太い縁取り（halo）を付ける。線や輪が字の上を通っても読める。
 * - 関係は色だけでなく記号（◎○✕△？）と名前で区別する。凡例は「記号＋名前＋色」。線は種類ごとに実線・破線・点線と矢印。
 * - 要素の属性（確かめ用）：場所 data-place・線 data-route・関係 data-side・種類 data-kind・出方 data-state（hidden／appearing／shown）・強調 data-hl。
 * - 現れる途中の線は、線の上に重ねた覆い（mask）の破線の長さで伸ばす（画面の側が data-draw の要素の stroke-dashoffset を 1−割合にする）。
 */
import type { MapPlace, MapRoute, MapScene, MapSide } from './types';

/** SVG の要素の木（文字列は文字の子） */
export interface SvgNode {
    tag: string;
    attrs: Record<string, string | number>;
    children: (SvgNode | string)[];
}

/**
 * 地図の割り付け：viewBox（幅・高さ）と、地図の枠・凡例の欄・注記の行。
 * - standard：480×270（情勢の画面・縦長の画面）。
 * - wide：640×270（横長の演出の画面。高さは同じなので文字の大きさは変わらず、地図の枠だけ横に広い）。
 *   置く所の縦横の比（aspect）を渡すと、その比いっぱいまで横に広げる（fitLayout。スマホ横 844×390 の演出の地図は約 3.3：1）。
 */
export interface MapLayout {
    w: number;
    h: number;
    frame: { x: number; y: number; w: number; h: number };
    legendX: number;
    legendW: number;
    noteY: number;
}
export const MAP_LAYOUTS: Readonly<Record<'standard' | 'wide' | 'full', MapLayout>> = {
    standard: { w: 480, h: 270, frame: { x: 4, y: 4, w: 316, h: 240 }, legendX: 328, legendW: 150, noteY: 262 },
    wide: { w: 640, h: 270, frame: { x: 4, y: 4, w: 474, h: 240 }, legendX: 486, legendW: 152, noteY: 262 },
    /** 凡例を地図の外（画面の文字）に出すとき：枠を幅いっぱいに */
    full: { w: 480, h: 270, frame: { x: 4, y: 4, w: 472, h: 240 }, legendX: 480, legendW: 0, noteY: 262 },
};
/** 横に広げる上限：地図の枠（縦 240）の横は 2.8 倍まで（模式図が横に伸びすぎない）。残りの幅は凡例の欄へ */
const FIT_FRAME_MAX_W = 672;

/**
 * 置く所の縦横の比（幅 ÷ 高さ）に合わせた横長の割り付け（高さ 270 は同じ。文字の大きさは変わらない）。
 * 比が wide（640×270）より小さいときは wide のまま。大きいときは地図の枠を広げ（上限 FIT_FRAME_MAX_W）、残りは凡例の欄を広げる。
 */
export function fitLayout(aspect: number): MapLayout {
    const base = MAP_LAYOUTS.wide;
    const w = Math.round(Math.min(1100, base.h * (Number.isFinite(aspect) ? aspect : 0)));
    if (w <= base.w) return base;
    const frameW = Math.min(FIT_FRAME_MAX_W, w - 2 - base.legendW - 12);
    const legendX = frameW + 4 + 8;
    return { w, h: base.h, frame: { ...base.frame, w: frameW }, legendX, legendW: w - legendX - 2, noteY: base.noteY };
}

/** 既定の割り付けの viewBox（互換） */
export const MAP_VIEW = { w: MAP_LAYOUTS.standard.w, h: MAP_LAYOUTS.standard.h } as const;
/** 文字の大きさ（単位）。どれも 14 以上 */
export const MAP_FONT = { label: 16, note: 15, legend: 14, legendTitle: 14, mark: 14, route: 15, foot: 14 } as const;

/** 地図の点（0〜100）→ 枠の中の座標 */
export function mapPoint(x: number, y: number, layout: MapLayout = MAP_LAYOUTS.standard): { x: number; y: number } {
    const f = layout.frame;
    const cx = Math.max(0, Math.min(100, x));
    const cy = Math.max(0, Math.min(100, y));
    return { x: round(f.x + 22 + (cx / 100) * (f.w - 44)), y: round(f.y + 22 + (cy / 100) * (f.h - 44)) };
}

/** 関係ごとの色・記号・名前（凡例の言葉） */
export const SIDE_STYLE: Record<MapSide, { color: string; symbol: string; name: string }> = {
    self: { color: '#f2c14e', symbol: '◎', name: '自分' },
    ally: { color: '#74c8f2', symbol: '○', name: '協力' },
    enemy: { color: '#ff6b57', symbol: '✕', name: '敵対' },
    neutral: { color: '#cfc6b2', symbol: '△', name: '敵対していない' },
    unknown: { color: '#b7a3ec', symbol: '？', name: 'まだ分からない' },
};
export const SIDE_ORDER: readonly MapSide[] = ['self', 'ally', 'enemy', 'neutral', 'unknown'];

/** 線の種類ごとの見た目（dash：破線の並び。null は実線）と凡例の言葉 */
export const ROUTE_STYLE: Record<MapRoute['kind'], { dash: string | null; arrow: boolean; width: number; name: string }> = {
    march: { dash: null, arrow: true, width: 3.2, name: '行軍' },
    withdraw: { dash: '12 4 3 4', arrow: true, width: 2.6, name: '撤収・帰還' },
    threat: { dash: '8 6', arrow: true, width: 2.6, name: '脅かす向き（推定）' },
    envoy: { dash: '2 5', arrow: true, width: 2.4, name: '使い' },
    alliance: { dash: null, arrow: false, width: 2.4, name: '協力の間柄' },
    hostile: { dash: '8 6', arrow: false, width: 2.4, name: '敵対の間柄' },
};
export const ROUTE_ORDER: readonly MapRoute['kind'][] = ['march', 'withdraw', 'threat', 'envoy', 'alliance', 'hostile'];

/** 物見で確かめた場所・線の印（凡例の言葉） */
export const SCOUT_LEGEND = { symbol: '◇', name: '物見で確かめた' } as const;

const INK = '#f3ead8';
const INK_SOFT = '#cbbfa6';
/** 添え書き・線の名前・注記（小さい字）は明るめに（暗い地の上で、灰色に沈まない） */
const INK_NOTE = '#e6dcc6';
const BG = '#191510';
const HALO = '#0f0c09';

export interface MapSvgOptions {
    /** 同じ文書に地図が 2 つあっても覆い（mask）の id がぶつからないための頭（英数字と -） */
    uid?: string;
    /** 物見で確かめた場所・線の id（印を変える） */
    scouted?: ReadonlySet<string> | readonly string[];
    /** 凡例を地図の中に出さない（画面の側が legendEntries で文字の凡例を出す。注記は必ず出す）。枠は幅いっぱい（full） */
    noLegend?: boolean;
    /** 確かめ用の名前（svg の data-map） */
    name?: string;
    /** 割り付け（省けば standard） */
    layout?: 'standard' | 'wide';
    /** layout が wide のとき：置く所の縦横の比（幅 ÷ 高さ）。wide より横に長ければ、その比いっぱいまで広げる（fitLayout） */
    aspect?: number;
}

/** 地図の 1 場面を SVG の要素の木にする（場所・線は全部入れ、出方・強調は data-state・data-hl で切り替える） */
export function mapSvgTree(scene: MapScene, opts: MapSvgOptions = {}): SvgNode {
    const L = opts.noLegend ? MAP_LAYOUTS.full : opts.layout === 'wide' && opts.aspect ? fitLayout(opts.aspect) : MAP_LAYOUTS[opts.layout ?? 'standard'];
    const uid = (opts.uid ?? 'm').replace(/[^A-Za-z0-9-]/g, '');
    const scouted = new Set(opts.scouted ?? []);
    const byId = new Map(scene.places.map((p) => [p.id, p]));
    const defs: SvgNode[] = [];
    const f = L.frame;
    // 背景と枠
    const back: SvgNode[] = [
        n('rect', { x: 0, y: 0, width: L.w, height: L.h, fill: HALO, class: 'g-map-bg' }),
        n('rect', { x: f.x, y: f.y, width: f.w, height: f.h, rx: 8, fill: BG, stroke: 'rgba(200,168,106,0.45)', 'stroke-width': 1.2, class: 'g-map-frame' }),
    ];
    // 名前の置き場所を決める（重ならないように。先に印・国の名前を障害物として置く）
    const placer = new LabelPlacer(f);
    for (const p of scene.places) {
        const { x, y } = mapPoint(p.x, p.y, L);
        if (p.kind === 'region') continue;
        placer.block({ x0: x - 12, y0: y - 14, x1: x + 12, y1: y + 10 });
        if (p.mark) placer.block({ x0: x + 6, y0: y - 28, x1: x + 30, y1: y - 6 });
    }
    // 線をなぞる小さな箱を障害物に（場所の名前・線の名前を、線の上に置かないように。場所の名前を選ぶ前に置く）
    for (const r of scene.routes) {
        const a = byId.get(r.from);
        const b = byId.get(r.to);
        if (!a || !b) continue;
        const pts = [mapPoint(a.x, a.y, L), ...(r.via ?? []).map((v) => mapPoint(v.x, v.y, L)), mapPoint(b.x, b.y, L)];
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1]!;
            const q = pts[i]!;
            const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
            for (let k = 0; k <= steps; k++) {
                const x = p.x + ((q.x - p.x) * k) / steps;
                const y = p.y + ((q.y - p.y) * k) / steps;
                placer.block({ x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 });
            }
        }
    }
    // 広い所（国）は一番下、線、場所の印、名前の順に重ねる
    const regions: SvgNode[] = [];
    const routes: SvgNode[] = [];
    const marks: SvgNode[] = [];
    for (const p of scene.places) {
        if (p.kind !== 'region') continue;
        regions.push(regionNode(p, L, placer, scouted.has(p.id)));
    }
    for (const p of scene.places) {
        if (p.kind === 'region') continue;
        marks.push(placeNode(p, L, placer, scouted.has(p.id)));
    }
    for (const r of scene.routes) {
        const a = byId.get(r.from);
        const b = byId.get(r.to);
        if (!a || !b) continue;
        const { node, mask } = routeNode(r, a, b, L, uid, placer, scouted.has(r.id));
        routes.push(node);
        defs.push(mask);
    }
    // 重ねる順：線 → 国（薄い塗りと名前）→ 場所（印と名前）。名前・添え書きが線の下に隠れない
    const children: SvgNode[] = [n('defs', {}, defs), ...back, n('g', { class: 'g-map-routes' }, routes), n('g', { class: 'g-map-regions' }, regions), n('g', { class: 'g-map-places' }, marks)];
    if (!opts.noLegend) children.push(legendNode(scene, scouted, L));
    // 模式図の注記（必ず出す）
    children.push(n('text', { x: f.x + 4, y: L.noteY, 'font-size': MAP_FONT.foot, fill: INK_NOTE, class: 'g-map-note', 'data-note': '1' }, [scene.note || '模式図。位置と距離は正確ではない']));
    return n(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: `0 0 ${L.w} ${L.h}`,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img',
            'aria-label': mapAriaLabel(scene, scouted),
            class: 'g-map',
            'data-layout': opts.noLegend ? 'full' : (opts.layout ?? 'standard'),
            ...(opts.name ? { 'data-map': opts.name } : {}),
        },
        children,
    );
}

/** 読み上げ用の短い説明（地図の中身を文字で。物見で確かめた場所は ◇） */
export function mapAriaLabel(scene: MapScene, scouted: ReadonlySet<string> | readonly string[] = []): string {
    const sc = new Set(scouted);
    const parts = scene.places.map((p) => `${placeSymbol(p, sc.has(p.id))}${p.name}${p.note ? `（${p.note}）` : ''}`);
    return `模式図：${parts.join('、')}。${scene.note}`;
}

/** 名前の頭の記号：関係の記号。物見で確かめた場所（地形）は関係を持たないので ◇ */
function placeSymbol(p: MapPlace, scout: boolean): string {
    return scout ? SCOUT_LEGEND.symbol : SIDE_STYLE[p.side].symbol;
}

// ---------------------------------------------------------------- 名前の置き場所（重ならないように）

/** 文字の幅の見積もり（全角は 1 字、半角は 0.6 字） */
export function textWidth(s: string, size: number): number {
    let w = 0;
    for (const ch of s) w += (ch.codePointAt(0) ?? 0) < 0x2e80 ? size * 0.6 : size;
    return w;
}

interface Box {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** 置いた物の箱を覚え、候補の中から重なりの一番少ない所を選ぶ（貪欲。純粋） */
export class LabelPlacer {
    readonly boxes: Box[] = [];
    constructor(private readonly frame: { x: number; y: number; w: number; h: number }) {}
    block(b: Box): void {
        this.boxes.push(b);
    }
    /** 候補（並びが好みの順）から選んで覚える。返りは選んだ番号 */
    choose(cands: Box[]): number {
        let best = 0;
        let bestScore = Infinity;
        cands.forEach((c, i) => {
            let score = i * 4; // 好みの順の小さな重み
            for (const b of this.boxes) score += overlapArea(c, b);
            // 枠の外へはみ出す分は大きく嫌う
            const f = this.frame;
            const out = Math.max(0, f.x + 2 - c.x0) + Math.max(0, c.x1 - (f.x + f.w - 2)) + Math.max(0, f.y + 2 - c.y0) + Math.max(0, c.y1 - (f.y + f.h - 2));
            score += out * 400;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        });
        this.boxes.push(cands[best]!);
        return best;
    }
}

/** 名前の行から添え書きの行までの下の線の間（単位） */
const LINE2 = 17;

/** 文字の塊（1〜2 行）の箱：anchor の位置 x と、1 行目の文字の下の線 y から */
function blockBox(anchor: 'start' | 'middle' | 'end', x: number, y: number, w: number, lines: number): Box {
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return { x0: x0 - 2, y0: y - MAP_FONT.label + 1, x1: x0 + w + 2, y1: y + (lines - 1) * LINE2 + 4 };
}

function regionNode(p: MapPlace, L: MapLayout, placer: LabelPlacer, scout: boolean): SvgNode {
    const st = SIDE_STYLE[p.side];
    const { x, y } = mapPoint(p.x, p.y, L);
    const attrs = { 'data-place': p.id, 'data-side': p.side, 'data-kind': p.kind, 'data-state': 'shown', 'data-hl': '0', class: 'g-map-place', ...(scout ? { 'data-scout': '1' } : {}) };
    const kids: SvgNode[] = [];
    // 広い所（国）：薄く塗った楕円（破線の縁）と、真ん中の名前
    kids.push(n('ellipse', { cx: x, cy: y, rx: 40, ry: 24, fill: st.color, 'fill-opacity': 0.1, stroke: st.color, 'stroke-opacity': 0.6, 'stroke-width': 1.4, 'stroke-dasharray': '4 4', class: 'g-map-glow-r' }));
    const lw = textWidth(`${placeSymbol(p, scout)}${p.name}`, MAP_FONT.label);
    const nw = p.note ? textWidth(p.note, MAP_FONT.note) : 0;
    const w = Math.max(lw + (p.mark ? 26 : 0), nw);
    placer.block(blockBox('middle', x, y + 5, w, p.note ? 2 : 1));
    kids.push(labelNode(p, x - (p.mark ? 13 : 0), y + 5, 'middle', scout));
    if (p.mark) kids.push(flagNode(p.mark, st.color, x - 13 + lw / 2 + 4, y - 10));
    if (p.note) kids.push(n('text', { x, y: y + 22, 'text-anchor': 'middle', 'font-size': MAP_FONT.note, fill: INK_NOTE, class: 'g-map-pnote', ...halo() }, [p.note]));
    return n('g', attrs, kids);
}

function placeNode(p: MapPlace, L: MapLayout, placer: LabelPlacer, scout: boolean): SvgNode {
    const st = SIDE_STYLE[p.side];
    const { x, y } = mapPoint(p.x, p.y, L);
    const attrs = { 'data-place': p.id, 'data-side': p.side, 'data-kind': p.kind, 'data-state': 'shown', 'data-hl': '0', class: 'g-map-place', ...(scout ? { 'data-scout': '1' } : {}) };
    const kids: SvgNode[] = [];
    // 強調の光（強調のときだけ見える）
    kids.push(n('circle', { cx: x, cy: y, r: 15, fill: st.color, 'fill-opacity': 0.28, class: 'g-map-glow' }));
    kids.push(symbolShape(p, x, y, st.color));
    if (scout) kids.push(n('rect', { x: x - 11, y: y - 11, width: 22, height: 22, fill: 'none', stroke: INK, 'stroke-width': 1.2, 'stroke-dasharray': '3 2', transform: `rotate(45 ${x} ${y})`, class: 'g-map-scout' }));
    if (p.mark) kids.push(flagNode(p.mark, st.color, x + 8, y - 27));
    // 名前（＋添え書き）の置き場所：下・上・右・左・斜めの中から、重なりの少ない所
    const lines = p.note ? 2 : 1;
    const w = Math.max(textWidth(`${placeSymbol(p, scout)}${p.name}`, MAP_FONT.label), p.note ? textWidth(p.note, MAP_FONT.note) : 0);
    const up = (p.mark ? 30 : 16) + (lines - 1) * LINE2;
    const cands: { anchor: 'start' | 'middle' | 'end'; x: number; y: number }[] = [
        { anchor: 'middle', x, y: y + 27 },
        { anchor: 'middle', x, y: y - up },
        { anchor: 'start', x: x + (p.mark ? 32 : 15), y: y + 5 - (lines - 1) * 8 },
        { anchor: 'end', x: x - 15, y: y + 5 - (lines - 1) * 8 },
        { anchor: 'start', x: x + 10, y: y + 27 },
        { anchor: 'end', x: x - 10, y: y + 27 },
        { anchor: 'start', x: x + 10, y: y - up },
        { anchor: 'end', x: x - 10, y: y - up },
    ];
    const k = placer.choose(cands.map((c) => blockBox(c.anchor, c.x, c.y, w, lines)));
    const c = cands[k]!;
    kids.push(labelNode(p, c.x, c.y, c.anchor, scout));
    if (p.note) kids.push(n('text', { x: c.x, y: c.y + LINE2, 'text-anchor': c.anchor, 'font-size': MAP_FONT.note, fill: INK_NOTE, class: 'g-map-pnote', ...halo() }, [p.note]));
    return n('g', attrs, kids);
}

/** 場所の種類ごとの印の形（本拠：城の形・合戦の場所：菱形に×・村：家の形・その他：丸） */
function symbolShape(p: MapPlace, x: number, y: number, color: string): SvgNode {
    const stroke = { stroke: HALO, 'stroke-width': 1.5 };
    switch (p.kind) {
        case 'home':
            return n('g', { class: 'g-map-sym' }, [
                n('rect', { x: x - 9, y: y - 5, width: 18, height: 12, fill: color, ...stroke }),
                n('path', { d: `M${x - 11} ${y - 5} L${x} ${y - 13} L${x + 11} ${y - 5} Z`, fill: color, ...stroke }),
            ]);
        case 'field':
            return n('g', { class: 'g-map-sym' }, [
                n('rect', { x: x - 8, y: y - 8, width: 16, height: 16, fill: color, 'fill-opacity': 0.35, stroke: color, 'stroke-width': 2, transform: `rotate(45 ${x} ${y})` }),
                n('path', { d: `M${x - 5} ${y - 5} L${x + 5} ${y + 5} M${x + 5} ${y - 5} L${x - 5} ${y + 5}`, stroke: color, 'stroke-width': 2, fill: 'none' }),
            ]);
        case 'village':
            return n('path', { d: `M${x - 8} ${y + 7} L${x - 8} ${y - 2} L${x} ${y - 9} L${x + 8} ${y - 2} L${x + 8} ${y + 7} Z`, fill: color, ...stroke, class: 'g-map-sym' });
        default:
            return n('circle', { cx: x, cy: y, r: 6.5, fill: color, ...stroke, class: 'g-map-sym' });
    }
}

/** 旗（一文字）：関係の色の地に濃い字 */
function flagNode(mark: string, color: string, x: number, y: number): SvgNode {
    return n('g', { class: 'g-map-flag' }, [
        n('rect', { x, y, width: 20, height: 19, rx: 2, fill: color, stroke: HALO, 'stroke-width': 1.2 }),
        n('text', { x: x + 10, y: y + 15, 'text-anchor': 'middle', 'font-size': MAP_FONT.mark, 'font-weight': 700, fill: HALO }, [[...mark][0] ?? mark]),
    ]);
}

/** 名前：関係の記号（色）＋名前（明るい字）。物見で確かめた場所は ◇（関係の記号・色を付けない） */
function labelNode(p: MapPlace, x: number, y: number, anchor: 'start' | 'middle' | 'end', scout = false): SvgNode {
    const st = SIDE_STYLE[p.side];
    return n('text', { x, y, 'text-anchor': anchor, 'font-size': MAP_FONT.label, 'font-weight': 600, fill: INK, class: 'g-map-label', ...halo() }, [
        n('tspan', { fill: scout ? INK : st.color, 'data-sym': scout ? 'scout' : p.side }, [placeSymbol(p, scout)]),
        p.name,
    ]);
}

/** 字の縁取り（地の色の太い線を字の下に描く）。線・国の輪・矢印が字の上や間を通っても、字の形が切れない */
function halo(): Record<string, string | number> {
    return { stroke: HALO, 'stroke-width': 5, 'stroke-opacity': 0.92, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
}

/** 線（進路・関係）：端は場所の印から少し離す。矢印は終わりの端。名前は線の途中の、重なりの少ない所に */
function routeNode(r: MapRoute, a: MapPlace, b: MapPlace, L: MapLayout, uid: string, placer: LabelPlacer, scout: boolean): { node: SvgNode; mask: SvgNode } {
    const st = SIDE_STYLE[r.side];
    const style = ROUTE_STYLE[r.kind];
    const raw = [mapPoint(a.x, a.y, L), ...(r.via ?? []).map((v) => mapPoint(v.x, v.y, L)), mapPoint(b.x, b.y, L)];
    const pts = trimEnds(raw, a.kind === 'region' ? 20 : 13, b.kind === 'region' ? 20 : 15);
    const ptsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const maskId = `${uid}-rm-${safeId(r.id)}`;
    const mask = n('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: L.w, height: L.h }, [
        n('polyline', { points: ptsAttr, fill: 'none', stroke: '#fff', 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 0, 'data-draw': r.id }),
    ]);
    const kids: SvgNode[] = [
        n('polyline', { points: ptsAttr, fill: 'none', stroke: st.color, 'stroke-opacity': 0.35, 'stroke-width': style.width + 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'g-map-glow' }),
        n('polyline', {
            points: ptsAttr,
            fill: 'none',
            stroke: st.color,
            'stroke-width': style.width,
            'stroke-linecap': style.dash ? 'butt' : 'round',
            'stroke-linejoin': 'round',
            ...(style.dash ? { 'stroke-dasharray': style.dash } : {}),
            mask: `url(#${maskId})`,
            class: 'g-map-line',
        }),
    ];
    if (style.arrow && pts.length >= 2) kids.push(arrowHead(pts[pts.length - 2]!, pts[pts.length - 1]!, st.color, style.width));
    if (r.label) {
        const w = textWidth(r.label, MAP_FONT.route);
        const cands: { x: number; y: number }[] = [];
        for (const k of [0.5, 0.35, 0.65]) {
            const m = pointAt(pts, k);
            cands.push({ x: m.x, y: m.y - 7 }, { x: m.x, y: m.y + 19 });
        }
        const i = placer.choose(cands.map((c) => ({ x0: c.x - w / 2 - 2, y0: c.y - MAP_FONT.route + 1, x1: c.x + w / 2 + 2, y1: c.y + 4 })));
        const c = cands[i]!;
        kids.push(n('text', { x: c.x, y: c.y, 'text-anchor': 'middle', 'font-size': MAP_FONT.route, fill: INK_NOTE, class: 'g-map-rlabel', ...halo() }, [r.label]));
    }
    return {
        node: n('g', { 'data-route': r.id, 'data-side': r.side, 'data-kind': r.kind, 'data-state': 'shown', 'data-hl': '0', class: 'g-map-route', ...(scout ? { 'data-scout': '1' } : {}) }, kids),
        mask,
    };
}

function arrowHead(p: { x: number; y: number }, q: { x: number; y: number }, color: string, w: number): SvgNode {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = 7 + w;
    const bx = q.x - ux * s;
    const by = q.y - uy * s;
    const pts = [
        [q.x, q.y],
        [bx - uy * s * 0.55, by + ux * s * 0.55],
        [bx + uy * s * 0.55, by - ux * s * 0.55],
    ]
        .map(([x, y]) => `${round(x!)},${round(y!)}`)
        .join(' ');
    return n('polygon', { points: pts, fill: color, stroke: HALO, 'stroke-width': 1, class: 'g-map-arrow' });
}

/** 折れ線の両端を、始めは d0・終わりは d1 だけ縮める（短すぎる線は縮めない） */
function trimEnds(pts: { x: number; y: number }[], d0: number, d1: number): { x: number; y: number }[] {
    const total = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0);
    if (total < (d0 + d1) * 1.5) return pts;
    const out = pts.map((p) => ({ ...p }));
    const cut = (from: number, dir: 1 | -1, d: number) => {
        const a = out[from]!;
        const b = out[from + dir]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l <= d + 2) return;
        out[from] = { x: round(a.x + ((b.x - a.x) * d) / l), y: round(a.y + ((b.y - a.y) * d) / l) };
    };
    cut(0, 1, d0);
    cut(out.length - 1, -1, d1);
    return out;
}

/** 折れ線の、長さの割合 k（0〜1）の点 */
function pointAt(pts: { x: number; y: number }[], k: number): { x: number; y: number } {
    const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
    const target = segs.reduce((s, l) => s + l, 0) * k;
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
        const l = segs[i]!;
        if (acc + l >= target && l > 0) {
            const t = (target - acc) / l;
            return { x: round(pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t), y: round(pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t) };
        }
        acc += l;
    }
    return pts[0]!;
}

/** 凡例の 1 行（地図の中の凡例と、画面の文字の凡例で同じ中身） */
export type LegendEntry =
    | { type: 'side'; side: MapSide; symbol: string; name: string; color: string; marks: string[] }
    | { type: 'route'; kind: MapRoute['kind']; name: string; dash: string | null; arrow: boolean; width: number }
    | { type: 'scout'; symbol: string; name: string };

/** 凡例の中身：使っている関係（記号＋名前＋色・旗の字）・線の種類・物見の印 */
export function legendEntries(scene: MapScene, scouted: ReadonlySet<string> | readonly string[] = []): LegendEntry[] {
    const out: LegendEntry[] = [];
    // 物見で確かめた場所・線（地形）は関係を持たないので、関係の凡例に数えない（◇ の行で出す）
    const sc = new Set(scouted);
    const places = scene.places.filter((p) => !sc.has(p.id));
    const routes = scene.routes.filter((r) => !sc.has(r.id));
    for (const s of SIDE_ORDER) {
        if (!places.some((p) => p.side === s) && !routes.some((r) => r.side === s)) continue;
        const st = SIDE_STYLE[s];
        const marks = [...new Set(places.filter((p) => p.side === s && p.mark).map((p) => [...p.mark!][0]!))];
        out.push({ type: 'side', side: s, symbol: st.symbol, name: st.name, color: st.color, marks });
    }
    for (const k of ROUTE_ORDER) {
        if (!scene.routes.some((r) => r.kind === k)) continue;
        const style = ROUTE_STYLE[k];
        out.push({ type: 'route', kind: k, name: style.name, dash: style.dash, arrow: style.arrow, width: style.width });
    }
    if (sc.size > 0) out.push({ type: 'scout', symbol: SCOUT_LEGEND.symbol, name: SCOUT_LEGEND.name });
    return out;
}

/** 凡例：使っている関係（記号＋名前＋色。旗の字も添える。長ければ 2 行）・線の種類・物見の印 */
function legendNode(scene: MapScene, scouted: ReadonlySet<string>, L: MapLayout): SvgNode {
    const X = L.legendX;
    const rows: SvgNode[] = [n('text', { x: X, y: 20, 'font-size': MAP_FONT.legendTitle, fill: INK_SOFT, 'font-weight': 600, class: 'g-map-legend-title' }, ['凡例'])];
    let y = 40;
    const entries = legendEntries(scene, scouted);
    for (const e of entries) {
        if (e.type !== 'side') continue;
        const s = e.side;
        const st = SIDE_STYLE[s];
        const marks = e.marks;
        const head = ` ${st.name}`;
        const tail = marks.length ? `（${marks.join('・')}）` : '';
        const one = textWidth(`${st.symbol}${head}${tail}`, MAP_FONT.legend) <= L.legendW;
        rows.push(
            n('text', { x: X, y, 'font-size': MAP_FONT.legend, fill: INK, 'data-legend-side': s }, [
                n('tspan', { fill: st.color, 'font-weight': 700 }, [st.symbol]),
                one ? `${head}${tail}` : head,
                ...(one || !tail ? [] : [n('tspan', { x: X + 16, dy: 17 }, [tail])]),
            ]),
        );
        y += one || !tail ? 19 : 36;
    }
    const kinds = entries.flatMap((e) => (e.type === 'route' ? [e.kind] : []));
    if (kinds.length) y += 4;
    for (const k of kinds) {
        const style = ROUTE_STYLE[k];
        const ly = y - 5;
        rows.push(
            n('g', { 'data-legend-route': k }, [
                n('line', { x1: X, y1: ly, x2: X + 24, y2: ly, stroke: INK_SOFT, 'stroke-width': style.width, ...(style.dash ? { 'stroke-dasharray': style.dash } : {}) }),
                ...(style.arrow ? [arrowHead({ x: X, y: ly }, { x: X + 30, y: ly }, INK_SOFT, style.width - 1)] : []),
                n('text', { x: X + 34, y, 'font-size': MAP_FONT.legend, fill: INK }, [style.name]),
            ]),
        );
        y += 19;
    }
    if (scouted.size > 0) {
        y += 4;
        rows.push(n('text', { x: X, y, 'font-size': MAP_FONT.legend, fill: INK, 'data-legend-scout': '1' }, [SCOUT_LEGEND.symbol, ` ${SCOUT_LEGEND.name}`]));
    }
    return n('g', { class: 'g-map-legend' }, rows);
}

// ---------------------------------------------------------------- 文字列（確かめ・書き出し用）

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]!);

/** 要素の木を SVG の文字列にする */
export function svgToString(node: SvgNode): string {
    const attrs = Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
        .join('');
    if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
    return `<${node.tag}${attrs}>${node.children.map((c) => (typeof c === 'string' ? esc(c) : svgToString(c))).join('')}</${node.tag}>`;
}

/** 木の中の要素を探す（確かめ用） */
export function findNodes(node: SvgNode, pred: (n: SvgNode) => boolean, out: SvgNode[] = []): SvgNode[] {
    if (pred(node)) out.push(node);
    for (const c of node.children) if (typeof c !== 'string') findNodes(c, pred, out);
    return out;
}

/** 要素の中の文字（子の文字を順につなぐ） */
export function nodeText(node: SvgNode): string {
    return node.children.map((c) => (typeof c === 'string' ? c : nodeText(c))).join('');
}

function n(tag: string, attrs: Record<string, string | number>, children: (SvgNode | string)[] = []): SvgNode {
    return { tag, attrs, children };
}

function round(v: number): number {
    return Math.round(v * 10) / 10;
}

function safeId(id: string): string {
    return id.replace(/[^A-Za-z0-9_-]/g, '_');
}
