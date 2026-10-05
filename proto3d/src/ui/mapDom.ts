/**
 * 情勢の地図（story/map-svg.ts の要素の木）を DOM の SVG にし、時刻ごとの形（story/timeline.ts の MapFrame）を当てる。
 * 演出の再生器（ui/cinePlayer.ts）と情勢の画面（ui/situationView.ts）が使う。
 */
import { mapSvgTree, type MapSvgOptions, type SvgNode } from '../story/map-svg';
import type { MapFrame } from '../story/timeline';
import type { MapScene } from '../story/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 要素の木から DOM の SVG を作る */
export function buildSvg(node: SvgNode): SVGElement {
    const e = document.createElementNS(SVG_NS, node.tag);
    for (const [k, v] of Object.entries(node.attrs)) {
        if (k === 'xmlns') continue;
        e.setAttribute(k, String(v));
    }
    for (const c of node.children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : buildSvg(c));
    return e as SVGElement;
}

let uidSeq = 0;

/** 地図を作る（覆いの id がぶつからないように、作るたびに別の頭を付ける） */
export function createMap(scene: MapScene, opts: Omit<MapSvgOptions, 'uid'> = {}): MapDom {
    const svg = buildSvg(mapSvgTree(scene, { ...opts, uid: `gm${++uidSeq}` })) as SVGSVGElement;
    return new MapDom(svg);
}

/** DOM の地図に時刻ごとの形を当てる（出方・現れている途中の割合・強調） */
export class MapDom {
    private readonly places = new Map<string, SVGGElement>();
    private readonly routes = new Map<string, { g: SVGGElement; draw: SVGElement | null; arrow: SVGElement | null }>();
    private last = '';
    constructor(readonly svg: SVGSVGElement) {
        svg.querySelectorAll<SVGGElement>('[data-place]').forEach((g) => this.places.set(g.dataset.place!, g));
        svg.querySelectorAll<SVGGElement>('[data-route]').forEach((g) => {
            const id = g.dataset.route!;
            const draw = svg.querySelector<SVGElement>(`[data-draw="${cssEscape(id)}"]`);
            const arrow = g.querySelector<SVGElement>('.g-map-arrow');
            this.routes.set(id, { g, draw, arrow });
        });
    }

    /** 形を当てる（前と同じなら何もしない） */
    apply(f: MapFrame): void {
        const key = JSON.stringify(f);
        if (key === this.last) return;
        this.last = key;
        this.svg.classList.toggle('has-hl', f.highlight.length > 0);
        this.svg.dataset.hl = f.highlight.join(',');
        for (const [id, g] of this.places) {
            const st = f.places[id] ?? { state: 'shown', progress: 1, hl: false };
            g.dataset.state = st.state;
            g.dataset.hl = st.hl ? '1' : '0';
            g.style.opacity = st.state === 'hidden' ? '0' : st.state === 'appearing' ? String(round3(st.progress)) : '';
        }
        for (const [id, r] of this.routes) {
            const st = f.routes[id] ?? { state: 'shown', progress: 1, hl: false };
            r.g.dataset.state = st.state;
            r.g.dataset.hl = st.hl ? '1' : '0';
            r.g.style.opacity = st.state === 'hidden' ? '0' : '';
            // 線は、覆いの破線の長さで伸ばす（1：何も見えない・0：全部）
            const p = st.state === 'hidden' ? 0 : st.state === 'appearing' ? st.progress : 1;
            r.draw?.setAttribute('stroke-dashoffset', String(round3(1 - p)));
            if (r.arrow) r.arrow.style.opacity = p >= 0.92 ? '' : '0';
        }
    }

    /** 強調だけを変える（情勢の画面のタブ。全部出ている） */
    highlight(ids: readonly string[]): void {
        const hl = new Set(ids);
        const places: MapFrame['places'] = {};
        const routes: MapFrame['routes'] = {};
        for (const id of this.places.keys()) places[id] = { state: 'shown', progress: 1, hl: hl.has(id) };
        for (const id of this.routes.keys()) routes[id] = { state: 'shown', progress: 1, hl: hl.has(id) };
        this.apply({ highlight: [...ids], places, routes });
    }
}

function round3(v: number): number {
    return Math.round(v * 1000) / 1000;
}

function cssEscape(s: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
