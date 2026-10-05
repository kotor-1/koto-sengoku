/**
 * 情勢の地図（模式図）を SVG の要素の木にする（純粋な TypeScript。DOM を使わない。画面は ui/ がこの木から要素を作る）。
 * 設計：docs/story-rpg-design.md §3・§4。型：story/types.ts の MapScene。
 *
 * 決まり：
 * - viewBox は固定（MAP_VIEW）。地図の点（0〜100）は左の枠の中へ写す。右の欄は凡例。下の行は模式図の注記（必ず出す）。
 * - 文字は 14 単位以上（スマホ横 844×390 で 12px 以上になる大きさ。画面の側で縮みすぎないように置く）。
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

/** viewBox（幅・高さ）と、地図の枠・凡例の欄・注記の行 */
export const MAP_VIEW = { w: 480, h: 270 } as const;
const FRAME = { x: 4, y: 4, w: 316, h: 240 };
const LEGEND_X = 328;
const NOTE_Y = 262;
/** 文字の大きさ（単位）。どれも 14 以上 */
export const MAP_FONT = { label: 15, note: 14, legend: 14, legendTitle: 14, mark: 14, route: 14, foot: 14 } as const;

/** 地図の点（0〜100）→ 枠の中の座標 */
export function mapPoint(x: number, y: number): { x: number; y: number } {
    const cx = Math.max(0, Math.min(100, x));
    const cy = Math.max(0, Math.min(100, y));
    return { x: round(FRAME.x + 16 + (cx / 100) * (FRAME.w - 32)), y: round(FRAME.y + 14 + (cy / 100) * (FRAME.h - 28)) };
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
const BG = '#191510';
const HALO = '#0f0c09';

export interface MapSvgOptions {
    /** 同じ文書に地図が 2 つあっても覆い（mask）の id がぶつからないための頭（英数字と -） */
    uid?: string;
    /** 物見で確かめた場所・線の id（印を変える） */
    scouted?: ReadonlySet<string> | readonly string[];
    /** 凡例を出さない（狭い所に小さく出すとき。注記は必ず出す） */
    noLegend?: boolean;
    /** 確かめ用の名前（svg の data-map） */
    name?: string;
}

/** 地図の 1 場面を SVG の要素の木にする（場所・線は全部入れ、出方・強調は data-state・data-hl で切り替える） */
export function mapSvgTree(scene: MapScene, opts: MapSvgOptions = {}): SvgNode {
    const uid = (opts.uid ?? 'm').replace(/[^A-Za-z0-9-]/g, '');
    const scouted = new Set(opts.scouted ?? []);
    const byId = new Map(scene.places.map((p) => [p.id, p]));
    const defs: SvgNode[] = [];
    // 背景と枠
    const back: SvgNode[] = [
        n('rect', { x: 0, y: 0, width: MAP_VIEW.w, height: MAP_VIEW.h, fill: HALO, class: 'g-map-bg' }),
        n('rect', { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 8, fill: BG, stroke: 'rgba(200,168,106,0.45)', 'stroke-width': 1.2, class: 'g-map-frame' }),
    ];
    // 広い所（国）は一番下、線、場所の印、名前の順に重ねる
    const regions: SvgNode[] = [];
    const routes: SvgNode[] = [];
    const marks: SvgNode[] = [];
    for (const p of scene.places) {
        const g = placeNode(p, scouted.has(p.id));
        if (p.kind === 'region') regions.push(g);
        else marks.push(g);
    }
    for (const r of scene.routes) {
        const a = byId.get(r.from);
        const b = byId.get(r.to);
        if (!a || !b) continue;
        const { node, mask } = routeNode(r, a, b, uid, scouted.has(r.id));
        routes.push(node);
        defs.push(mask);
    }
    const children: SvgNode[] = [n('defs', {}, defs), ...back, n('g', { class: 'g-map-regions' }, regions), n('g', { class: 'g-map-routes' }, routes), n('g', { class: 'g-map-places' }, marks)];
    if (!opts.noLegend) children.push(legendNode(scene, scouted));
    // 模式図の注記（必ず出す）
    children.push(
        n('text', { x: FRAME.x + 4, y: NOTE_Y, 'font-size': MAP_FONT.foot, fill: INK_SOFT, class: 'g-map-note', 'data-note': '1' }, [scene.note || '模式図。位置と距離は正確ではない']),
    );
    const svg = n(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: `0 0 ${MAP_VIEW.w} ${MAP_VIEW.h}`,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img',
            'aria-label': mapAriaLabel(scene),
            class: 'g-map',
            ...(opts.name ? { 'data-map': opts.name } : {}),
        },
        children,
    );
    return svg;
}

/** 読み上げ用の短い説明（地図の中身を文字で） */
export function mapAriaLabel(scene: MapScene): string {
    const parts = scene.places.map((p) => `${SIDE_STYLE[p.side].symbol}${p.name}${p.note ? `（${p.note}）` : ''}`);
    return `模式図：${parts.join('、')}。${scene.note}`;
}

function placeNode(p: MapPlace, scout: boolean): SvgNode {
    const st = SIDE_STYLE[p.side];
    const { x, y } = mapPoint(p.x, p.y);
    const attrs = { 'data-place': p.id, 'data-side': p.side, 'data-kind': p.kind, 'data-state': 'shown', 'data-hl': '0', class: 'g-map-place', ...(scout ? { 'data-scout': '1' } : {}) };
    const kids: SvgNode[] = [];
    if (p.kind === 'region') {
        // 広い所（国）：薄く塗った楕円（破線の縁）と、真ん中の名前
        kids.push(n('ellipse', { cx: x, cy: y, rx: 50, ry: 30, fill: st.color, 'fill-opacity': 0.1, stroke: st.color, 'stroke-opacity': 0.6, 'stroke-width': 1.4, 'stroke-dasharray': '4 4', class: 'g-map-glow-r' }));
        kids.push(labelNode(p, x, y + 5, 'middle'));
        if (p.mark) kids.push(flagNode(p.mark, st.color, x + labelWidth(p) / 2 + 4, y - 9));
        if (p.note) kids.push(n('text', { x, y: y + 22, 'text-anchor': 'middle', 'font-size': MAP_FONT.note, fill: INK_SOFT, class: 'g-map-pnote', ...halo() }, [p.note]));
        return n('g', attrs, kids);
    }
    // 強調の光（強調のときだけ見える）
    kids.push(n('circle', { cx: x, cy: y, r: 15, fill: st.color, 'fill-opacity': 0.28, class: 'g-map-glow' }));
    kids.push(symbolShape(p, x, y, st.color));
    if (scout) kids.push(n('rect', { x: x - 11, y: y - 11, width: 22, height: 22, fill: 'none', stroke: INK, 'stroke-width': 1.2, 'stroke-dasharray': '3 2', transform: `rotate(45 ${x} ${y})`, class: 'g-map-scout' }));
    if (p.mark) kids.push(flagNode(p.mark, st.color, x + 8, y - 26));
    // 名前は印の下（地図の下の方なら上）。左右の端では寄せる
    const below = y < FRAME.y + FRAME.h - 46;
    const anchor = x < FRAME.x + 56 ? 'start' : x > FRAME.x + FRAME.w - 56 ? 'end' : 'middle';
    const lx = anchor === 'start' ? x - 8 : anchor === 'end' ? x + 8 : x;
    const ly = below ? y + 25 : y - 15 - (p.note ? 16 : 0) - (p.mark ? 18 : 0);
    kids.push(labelNode(p, lx, ly, anchor));
    if (p.note) kids.push(n('text', { x: lx, y: ly + 16, 'text-anchor': anchor, 'font-size': MAP_FONT.note, fill: INK_SOFT, class: 'g-map-pnote', ...halo() }, [p.note]));
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

/** 名前：関係の記号（色）＋名前（明るい字） */
function labelNode(p: MapPlace, x: number, y: number, anchor: 'start' | 'middle' | 'end'): SvgNode {
    const st = SIDE_STYLE[p.side];
    return n('text', { x, y, 'text-anchor': anchor, 'font-size': MAP_FONT.label, 'font-weight': 600, fill: INK, class: 'g-map-label', ...halo() }, [
        n('tspan', { fill: st.color, 'data-sym': p.side }, [st.symbol]),
        p.name,
    ]);
}

function labelWidth(p: MapPlace): number {
    return ([...p.name].length + 1) * MAP_FONT.label;
}

function halo(): Record<string, string | number> {
    return { stroke: HALO, 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
}

/** 線（進路・関係）：端は場所の印から少し離す。矢印は終わりの端。名前は真ん中に */
function routeNode(r: MapRoute, a: MapPlace, b: MapPlace, uid: string, scout: boolean): { node: SvgNode; mask: SvgNode } {
    const st = SIDE_STYLE[r.side];
    const style = ROUTE_STYLE[r.kind];
    const raw = [mapPoint(a.x, a.y), ...(r.via ?? []).map((v) => mapPoint(v.x, v.y)), mapPoint(b.x, b.y)];
    const pts = trimEnds(raw, a.kind === 'region' ? 26 : 13, b.kind === 'region' ? 26 : 15);
    const ptsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const maskId = `${uid}-rm-${safeId(r.id)}`;
    const mask = n('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: MAP_VIEW.w, height: MAP_VIEW.h }, [
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
        const m = midPoint(pts);
        kids.push(n('text', { x: m.x, y: m.y - 7, 'text-anchor': 'middle', 'font-size': MAP_FONT.route, fill: INK, class: 'g-map-rlabel', ...halo() }, [r.label]));
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

function midPoint(pts: { x: number; y: number }[]): { x: number; y: number } {
    const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
    const half = segs.reduce((s, l) => s + l, 0) / 2;
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
        const l = segs[i]!;
        if (acc + l >= half && l > 0) {
            const k = (half - acc) / l;
            return { x: round(pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * k), y: round(pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * k) };
        }
        acc += l;
    }
    return pts[0]!;
}

/** 凡例：使っている関係（記号＋名前＋色。旗の字も添える）・線の種類・物見の印 */
function legendNode(scene: MapScene, scouted: ReadonlySet<string>): SvgNode {
    const rows: SvgNode[] = [n('text', { x: LEGEND_X, y: 20, 'font-size': MAP_FONT.legendTitle, fill: INK_SOFT, 'font-weight': 600, class: 'g-map-legend-title' }, ['凡例'])];
    let y = 40;
    const sides = SIDE_ORDER.filter((s) => scene.places.some((p) => p.side === s) || scene.routes.some((r) => r.side === s));
    for (const s of sides) {
        const st = SIDE_STYLE[s];
        const marks = [...new Set(scene.places.filter((p) => p.side === s && p.mark).map((p) => [...p.mark!][0]!))];
        rows.push(
            n('text', { x: LEGEND_X, y, 'font-size': MAP_FONT.legend, fill: INK, 'data-legend-side': s }, [
                n('tspan', { fill: st.color, 'font-weight': 700 }, [st.symbol]),
                ` ${st.name}${marks.length ? `（${marks.join('・')}）` : ''}`,
            ]),
        );
        y += 19;
    }
    const kinds = ROUTE_ORDER.filter((k) => scene.routes.some((r) => r.kind === k));
    if (kinds.length) y += 4;
    for (const k of kinds) {
        const style = ROUTE_STYLE[k];
        const ly = y - 5;
        rows.push(
            n('g', { 'data-legend-route': k }, [
                n('line', { x1: LEGEND_X, y1: ly, x2: LEGEND_X + 24, y2: ly, stroke: INK_SOFT, 'stroke-width': style.width, ...(style.dash ? { 'stroke-dasharray': style.dash } : {}) }),
                ...(style.arrow ? [arrowHead({ x: LEGEND_X, y: ly }, { x: LEGEND_X + 30, y: ly }, INK_SOFT, style.width - 1)] : []),
                n('text', { x: LEGEND_X + 34, y, 'font-size': MAP_FONT.legend, fill: INK }, [style.name]),
            ]),
        );
        y += 19;
    }
    if (scouted.size > 0) {
        y += 4;
        rows.push(n('text', { x: LEGEND_X, y, 'font-size': MAP_FONT.legend, fill: INK, 'data-legend-scout': '1' }, [SCOUT_LEGEND.symbol, ` ${SCOUT_LEGEND.name}`]));
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
