/**
 * 生成イラスト素材（Version 22）の会話の人物画（PortraitSlot）・軍議の背景（CouncilBackdrop）の DOM の部品（ui/artCanvas.ts）。
 * Node には DOM が無いので、部品が使う所だけの小さな偽の DOM（要素・canvas・getComputedStyle・窓の見張り・フレーム）で確かめる。
 * - 旧表示（?art=old）・素材の一覧が空・読めない：要素を一つも作らない（Version 21 と同じ画面）。
 * - 画像が読めたら作る（人物画は選択肢の前＝軍議の見出しとその後ろの暗さより手前、背景は層のいちばん前）。手前の幕は奥の画と同じ大きさで、揺れの幅だけ広い。
 * - 見出しの後ろの暗さ（背景が出ている間）は人物画の大きさを変えない（Version 26。背景の有無で立ち絵の大きさが変わらない）。
 * - 絵の無い話し手（使者・村の使い）・地の文・高札の行は下げる（Version 25 から。前の人の絵を暗く残さない）。動きを減らすときは時間を掛けない。
 * - 人物画は元の画像の画素より大きくしない（端末の比で割った高さまで）。台詞の枠の上に肩まで見えなければ出さない。
 * - 軍議の背景は Version 26 からどの画面でも出す（端末の比で外さない）。表示の倍率が 1.25 倍を超える画面は 1.25 倍で真ん中に描き、縁を暗い地へなじませる。
 *   層の大きさが測れない間は読まずに待つ。?art=v24・?artOff=council は作らない。
 * - 後片付け：見張り・フレーム・時計・body の印を外す。片付けの後に読めた画像では何も作らない。
 * 本物のブラウザでの位置・重なりの確かめは、開発サーバーで ?artFixture=1（仮の確かめ用の画像。見た目の素材ではない）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS } from '../proto3d/src/art/ids';
import type { ArtId } from '../proto3d/src/art/ids';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { COUNCIL_ART, CouncilBackdrop, PortraitSlot, __clearArtReadyForTest, councilArtLayout, councilFeatherPx, fitArt, loadArt, parallaxAmp, type Box } from '../proto3d/src/ui/artCanvas';

// ================= 偽の DOM =================

type Call = { fn: string; args: unknown[]; op?: string; alpha?: number };

class FakeCtx {
    calls: Call[] = [];
    globalAlpha = 1;
    globalCompositeOperation = 'source-over';
    fillStyle: unknown = '';
    imageSmoothingEnabled = true;
    imageSmoothingQuality = 'low';
    private rec(fn: string, args: unknown[]) {
        this.calls.push({ fn, args, op: this.globalCompositeOperation, alpha: this.globalAlpha });
    }
    setTransform(...a: unknown[]) {
        this.rec('setTransform', a);
    }
    clearRect(...a: unknown[]) {
        this.rec('clearRect', a);
    }
    fillRect(...a: unknown[]) {
        this.rec('fillRect', a);
    }
    drawImage(...a: unknown[]) {
        this.rec('drawImage', a);
    }
    beginPath() {}
    roundRect(...a: unknown[]) {
        this.rec('roundRect', a);
    }
    rect(...a: unknown[]) {
        this.rec('rect', a);
    }
    fill() {
        this.rec('fill', []);
    }
    createLinearGradient(...a: unknown[]) {
        this.rec('createLinearGradient', a);
        const stops: [number, string][] = [];
        return { stops, addColorStop: (o: number, c: string) => void stops.push([o, c]) };
    }
    draws() {
        return this.calls.filter((c) => c.fn === 'drawImage');
    }
}

class FakeClassList {
    readonly set = new Set<string>();
    add(...c: string[]) {
        for (const x of c) this.set.add(x);
    }
    remove(...c: string[]) {
        for (const x of c) this.set.delete(x);
    }
    toggle(c: string, force?: boolean) {
        const on = force ?? !this.set.has(c);
        if (on) this.set.add(c);
        else this.set.delete(c);
        return on;
    }
    contains(c: string) {
        return this.set.has(c);
    }
}

class FakeStyle {
    [k: string]: unknown;
    private readonly props = new Map<string, string>();
    setProperty(k: string, v: string) {
        this.props.set(k, v);
    }
    removeProperty(k: string) {
        this.props.delete(k);
        return '';
    }
    getPropertyValue(k: string) {
        return this.props.get(k) ?? '';
    }
}

type Rect = { left: number; top: number; width: number; height: number };

class FakeEl {
    children: FakeEl[] = [];
    parentNode: FakeEl | null = null;
    readonly classList = new FakeClassList();
    readonly dataset: Record<string, string> = {};
    readonly style = new FakeStyle();
    readonly attrs = new Map<string, string>();
    hidden = false;
    draggable = true;
    width = 300;
    height = 150;
    /** 画面の上の四角（測る物だけ。無ければ 0 の大きさ） */
    rect: Rect | (() => Rect) = { left: 0, top: 0, width: 0, height: 0 };
    /** 箱の外へ広がる ::before（軍議の見出しの後ろの暗さ）の top・right・bottom・left */
    scrim: [number, number, number, number] | null = null;
    ctx: FakeCtx | null = null;
    constructor(readonly tagName: string) {}
    get className() {
        return [...this.classList.set].join(' ');
    }
    set className(v: string) {
        this.classList.set.clear();
        for (const c of v.split(/\s+/)) if (c) this.classList.set.add(c);
    }
    get firstChild() {
        return this.children[0] ?? null;
    }
    get isConnected(): boolean {
        let p: FakeEl | null = this;
        while (p) {
            if (p === dom.body) return true;
            p = p.parentNode;
        }
        return false;
    }
    insertBefore(n: FakeEl, ref: FakeEl | null) {
        n.remove();
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(n);
        else this.children.splice(i, 0, n);
        n.parentNode = this;
        return n;
    }
    append(...ns: FakeEl[]) {
        for (const n of ns) this.insertBefore(n, null);
    }
    appendChild(n: FakeEl) {
        return this.insertBefore(n, null);
    }
    remove() {
        if (!this.parentNode) return;
        const s = this.parentNode.children;
        s.splice(s.indexOf(this), 1);
        this.parentNode = null;
    }
    setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
    }
    getAttribute(k: string) {
        return this.attrs.get(k) ?? null;
    }
    getBoundingClientRect() {
        const r = typeof this.rect === 'function' ? this.rect() : this.rect;
        return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height, x: r.left, y: r.top };
    }
    get offsetWidth() {
        return this.getBoundingClientRect().width;
    }
    /** '.a' だけ（部品が探すのは class 1 つの物だけ） */
    querySelector(sel: string): FakeEl | null {
        const c = sel.replace(/^\./, '');
        for (const ch of this.children) {
            if (ch.classList.contains(c)) return ch;
            const d = ch.querySelector(sel);
            if (d) return d;
        }
        return null;
    }
    getContext(kind: string) {
        if (kind !== '2d' || this.tagName !== 'canvas') return null;
        this.ctx ??= new FakeCtx();
        return this.ctx;
    }
    /** 子の並び（タグと class。テストの読みやすさのため） */
    tree(): string[] {
        return this.children.map((c) => `${c.tagName}.${c.className}${c.hidden ? '[hidden]' : ''}`);
    }
}

/** 本物の時計（偽の DOM の時計の中から呼ぶ。全体を差し替えた clearTimeout から自分を呼ばないように） */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

interface Dom {
    body: FakeEl;
    listeners: Map<string, Set<unknown>>;
    docListeners: Map<string, Set<unknown>>;
    raf: Map<number, (t: number) => void>;
    rafSeq: number;
    timers: Set<ReturnType<typeof setTimeout>>;
    dpr: number;
}
let dom: Dom;

function installDom(W: number, H: number, dpr = 1) {
    dom = { body: new FakeEl('body'), listeners: new Map(), docListeners: new Map(), raf: new Map(), rafSeq: 0, timers: new Set(), dpr };
    const add = (m: Map<string, Set<unknown>>) => (t: string, f: unknown) => {
        if (!m.has(t)) m.set(t, new Set());
        m.get(t)!.add(f);
    };
    const del = (m: Map<string, Set<unknown>>) => (t: string, f: unknown) => void m.get(t)?.delete(f);
    vi.stubGlobal('document', {
        body: dom.body,
        visibilityState: 'visible',
        createElement: (tag: string) => {
            const e = new FakeEl(tag);
            // 人物画の canvas の左端（CSS の left：安全域＋24、低い画面は＋8）
            if (tag === 'canvas') e.rect = () => ({ left: H <= 430 ? 8 : 24, top: 0, width: 0, height: 0 });
            return e;
        },
        addEventListener: add(dom.docListeners),
        removeEventListener: del(dom.docListeners),
    });
    vi.stubGlobal('window', {
        addEventListener: add(dom.listeners),
        removeEventListener: del(dom.listeners),
        setTimeout: (f: () => void, ms: number) => {
            const t = realSetTimeout(() => {
                dom.timers.delete(t);
                f();
            }, ms);
            dom.timers.add(t);
            return t;
        },
        clearTimeout: (t: ReturnType<typeof setTimeout>) => {
            dom.timers.delete(t);
            realClearTimeout(t);
        },
    });
    vi.stubGlobal('clearTimeout', (t: ReturnType<typeof setTimeout> | undefined) => {
        if (t === undefined) return;
        dom.timers.delete(t);
        realClearTimeout(t);
    });
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => {
        const id = ++dom.rafSeq;
        dom.raf.set(id, f);
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void dom.raf.delete(id));
    vi.stubGlobal('devicePixelRatio', dpr);
    vi.stubGlobal('getComputedStyle', (e: FakeEl, pseudo?: string) => {
        if (pseudo === '::before') {
            const s = e.scrim;
            return s ? { content: '""', display: 'block', top: `${s[0]}px`, right: `${s[1]}px`, bottom: `${s[2]}px`, left: `${s[3]}px` } : { content: 'none', display: 'block', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto' };
        }
        return { display: e.hidden ? 'none' : 'block', visibility: 'visible' };
    });
    // 層（画面いっぱい）と、その中の台詞の枠・選択肢・見出し
    const root = new FakeEl('div');
    dom.body.append(root);
    const layer = new FakeEl('div');
    layer.className = 'g-layer council';
    layer.rect = { left: 0, top: 0, width: W, height: H };
    root.append(layer);
    return { layer };
}

/** フレームを n 回進める（そのとき待っている物だけ） */
function frames(n = 1, now = 1e6) {
    for (let i = 0; i < n; i++) {
        const q = [...dom.raf.entries()];
        dom.raf.clear();
        for (const [, f] of q) f(now + i * 16);
    }
}

const flush = async (n = 30) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

const box = (x: number, y: number, w: number, h: number): Rect => ({ left: x, top: y, width: w, height: h });

/** 1280×720 の軍議（Version 21 の画面で測った物）：見出し・詳しく見る・台詞の枠・（あれば）方針の選択肢 */
function councilLayer(o: { choices?: boolean; scrim?: boolean } = {}) {
    const { layer } = installDom(1280, 720);
    const map = new FakeEl('button');
    map.className = 'g-council-map';
    map.rect = box(12, 12, 142, 39);
    const head = new FakeEl('div');
    head.className = 'g-council-head';
    head.rect = box(529, 18, 221, 51);
    if (o.scrim !== false) head.scrim = [-8, -34, -10, -34];
    const choices = new FakeEl('div');
    choices.className = 'g-choices';
    choices.hidden = !o.choices;
    choices.rect = box(610, 246, 420, 352);
    const dialog = new FakeEl('div');
    dialog.className = 'g-dialog';
    dialog.rect = box(250, 614, 780, 92);
    layer.append(head, map, choices, dialog);
    return { layer, head, map, choices, dialog };
}

const ASSETS = {
    [ART_IDS.portraitIeyasu]: { file: 'art/portraits/ieyasu.webp', w: 745, h: 1453, kind: 'portrait' as const },
    [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 745, h: 1453, kind: 'portrait' as const },
    [ART_IDS.bgCouncil]: { file: 'art/bg/council.webp', w: 1536, h: 1024, kind: 'background' as const },
    [ART_IDS.bgCouncilFront]: { file: 'art/bg/council_front.webp', w: 1536, h: 1024, kind: 'overlay' as const },
};

/** 素材の一覧と読み込み（fetch → createImageBitmap）の偽物。読んだ URL を返す */
function art(o: { assets?: Record<string, (typeof ASSETS)[keyof typeof ASSETS]>; ok?: boolean } = {}) {
    __setArtManifestForTest({ version: 1, assets: o.assets ?? ASSETS });
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        return o.ok === false ? { ok: false, status: 404 } : { ok: true, status: 200, blob: async () => ({ url: String(url) }) };
    });
    vi.stubGlobal('createImageBitmap', async (b: { url: string }) => {
        const e = Object.values(o.assets ?? ASSETS).find((a) => b.url.endsWith(a.file))!;
        return { width: e.w, height: e.h, close() {} };
    });
    return urls;
}

const resolve = (sp: string): ArtId | null => (sp === 'hero' ? ART_IDS.portraitIeyasu : sp === 'tadakatsu' ? ART_IDS.portraitTadakatsu : null);
const COUNCIL = { base: ART_IDS.bgCouncil, front: ART_IDS.bgCouncilFront };

/** ui/view.ts と同じく、人物画は選択肢の前に置く（Version 26：軍議の見出しとその後ろの薄い暗さより手前） */
function slot(l: ReturnType<typeof councilLayer>, reduced = false) {
    return new PortraitSlot(l.layer as unknown as HTMLElement, l.choices as unknown as HTMLElement, l.dialog as unknown as HTMLElement, resolve, () => reduced, () => []);
}
function backdrop(l: ReturnType<typeof councilLayer>, o: { reduced?: boolean; top?: boolean } = {}) {
    return new CouncilBackdrop(
        l.layer as unknown as HTMLElement,
        COUNCIL,
        () => !!o.reduced,
        () => o.top !== false,
    );
}
const portraitOf = (l: ReturnType<typeof councilLayer>) => l.layer.querySelector('.g-portrait');
const listenerCount = () => [...dom.listeners.values()].reduce((n, s) => n + s.size, 0) + [...dom.docListeners.values()].reduce((n, s) => n + s.size, 0);

beforeEach(() => {
    __clearArtReadyForTest();
});
afterEach(() => {
    for (const t of dom?.timers ?? []) realClearTimeout(t);
    vi.unstubAllGlobals();
    __setArtManifestForTest(null);
    __clearArtReadyForTest();
});

// ================= 素材が無い・旧表示 =================

describe('素材が無い・旧表示（?art=old）・読めない：要素を一つも作らない（Version 21 と同じ画面）', () => {
    const before = ['div.g-council-head', 'button.g-council-map', 'div.g-choices[hidden]', 'div.g-dialog'];
    const run = async (l: ReturnType<typeof councilLayer>) => {
        const p = slot(l);
        const b = backdrop(l);
        b.start();
        p.preload(['hero', 'tadakatsu', 'sakai']);
        for (const sp of ['narration', 'tadakatsu', 'sakai', 'hero']) {
            p.set(sp);
            await flush();
            frames(2);
        }
        expect(l.layer.tree()).toEqual(before);
        expect(l.layer.className).toBe('g-layer council');
        expect(dom.body.className).toBe('');
        expect(listenerCount()).toBe(0);
        expect(dom.raf.size).toBe(0);
        p.dispose();
        b.dispose();
        expect(dom.body.className).toBe('');
    };

    it('旧表示：何も読まず、何も作らない', async () => {
        const urls = art();
        vi.stubGlobal('location', { search: '?art=old', hash: '' });
        await run(councilLayer());
        expect(urls).toEqual([]);
    });

    it('旧表示に変えた後は、先に読めていた画像も描かない（peekArt は旧表示で null）', async () => {
        const urls = art();
        expect(await loadArt(ART_IDS.bgCouncil)).not.toBeNull();
        expect(await loadArt(ART_IDS.portraitTadakatsu)).not.toBeNull();
        vi.stubGlobal('location', { search: '', hash: '#art=old' });
        await run(councilLayer());
        expect(urls).toHaveLength(2);
    });

    it('素材の一覧が空（今の公開版）：何も読まず、何も作らない', async () => {
        const urls = art({ assets: {} });
        await run(councilLayer());
        expect(urls).toEqual([]);
    });

    it('読めない（404）：何も作らない', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        art({ ok: false });
        await run(councilLayer());
    });
});

// ================= 画像が読めたとき =================

describe('人物画（PortraitSlot）', () => {
    it('読めたら canvas.g-portrait を選択肢の前（見出しの後ろ）に作る。台詞の枠の後ろは透明に抜く。見出しの文字の箱を避ける', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('tadakatsu');
        expect(portraitOf(l)).toBeNull();
        await flush();
        const c = portraitOf(l)!;
        expect(c).not.toBeNull();
        expect(l.layer.tree()).toEqual(['div.g-council-head', 'button.g-council-map', 'canvas.g-portrait on', 'div.g-choices[hidden]', 'div.g-dialog']);
        expect(c.dataset.artId).toBe(ART_IDS.portraitTadakatsu);
        expect(c.attrs.get('aria-hidden')).toBe('true');
        expect(c.draggable).toBe(false);
        expect(c.hidden).toBe(false);
        expect(c.classList.contains('dim')).toBe(false);
        // 大きさ：1280×720 は 619 の高さまで（見出し・詳しく見る・メニューと重ならない）。左端 24・下端は画面の下の端
        const w = parseFloat(String(c.style.width));
        const h = parseFloat(String(c.style.height));
        expect(h).toBe(619);
        expect(w).toBe(Math.floor(619 * (745 / 1453)));
        const r: Box = { left: 24, top: 720 - h, right: 24 + w, bottom: 720 };
        const headBox: Box = { left: 529, top: 18, right: 750, bottom: 69 };
        expect(r.right <= headBox.left || r.top >= headBox.bottom).toBe(true);
        // 元の画像より細かくしない（端末の比 1 → 1 倍）
        expect(c.width).toBe(w);
        // 台詞の枠の後ろは抜く（destination-out の角の丸い四角が枠の所）
        const cut = c.ctx!.calls.find((k) => k.fn === 'roundRect')!;
        expect(cut.op).toBe('destination-out');
        expect(cut.args.slice(0, 2)).toEqual([250 - 24, 614 - (720 - h)]);
        p.dispose();
    });

    it('Version 26：見出しの後ろの暗さ（背景が出ている間の ::before）は、人物画の大きさを変えない（背景の有無で立ち絵の大きさが変わらない）', async () => {
        // 縦横の比 2:3 の人物画（余白を切り詰める前の形）
        art({ assets: { ...ASSETS, [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 1024, h: 1536, kind: 'portrait' } } });
        // 667×375 の軍議の台詞の行：見出しの箱は 222〜444（Version 21 と同じ）。後ろの暗さは 188〜478・10〜79
        // （Version 25 は暗さも避けて 288 だった。背景を出さない画面・?artOff=council は 300 で、Version 26 はどちらも 300）
        const { layer } = installDom(667, 375);
        const head = new FakeEl('div');
        head.className = 'g-council-head';
        head.rect = box(222, 18, 222, 51);
        head.scrim = [-8, -34, -10, -34];
        const map = new FakeEl('button');
        map.className = 'g-council-map';
        map.rect = box(12, 12, 122, 45);
        const choices = new FakeEl('div');
        choices.className = 'g-choices';
        choices.hidden = true;
        const dialog = new FakeEl('div');
        dialog.className = 'g-dialog';
        dialog.rect = box(14, 270, 639, 92);
        layer.append(head, map, choices, dialog);
        const heights: number[] = [];
        for (const scrim of [[-8, -34, -10, -34] as [number, number, number, number], null]) {
            head.scrim = scrim;
            layer.querySelector('.g-portrait')?.remove();
            const p = new PortraitSlot(layer as unknown as HTMLElement, choices as unknown as HTMLElement, dialog as unknown as HTMLElement, resolve, () => false, () => []);
            p.set('tadakatsu');
            await flush();
            const c = layer.querySelector('.g-portrait')!;
            heights.push(parseFloat(String(c.style.height)));
            // 人物画は見出し（とその後ろの暗さ）より後ろの DOM：暗さの上に描かれる。選択肢・台詞の枠より前（その下に重なる）
            expect(layer.tree()).toEqual(['div.g-council-head', 'button.g-council-map', 'canvas.g-portrait on', 'div.g-choices[hidden]', 'div.g-dialog']);
            // 見出しの文字の箱（222〜444・18〜69）とは重ならない
            const top = 375 - heights[heights.length - 1]!;
            const right = 24 + parseFloat(String(c.style.width));
            expect(right <= 222 || top >= 69).toBe(true);
            p.dispose();
        }
        expect(heights).toEqual([300, 300]);
    });

    it('絵の無い話し手（使者・村の使い）・地の文・高札の行は下げる（前の人の絵を話し手のように残さない）。同じ人の続く行は描き直さない', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('narration');
        await flush();
        expect(portraitOf(l)).toBeNull();
        // 絵の無い話し手から始まる：何も出さない
        p.set('oda_envoy');
        await flush();
        expect(portraitOf(l)).toBeNull();
        p.set('tadakatsu');
        await flush();
        const c = portraitOf(l)!;
        expect(c.classList.contains('on')).toBe(true);
        expect(c.dataset.artId).toBe(ART_IDS.portraitTadakatsu);
        const draws = () => c.ctx!.draws().length;
        const n0 = draws();
        // 同じ人の続く行：同じ絵・同じ大きさのまま（描き直さない）
        p.set('tadakatsu');
        expect(draws()).toBe(n0);
        // 使者：忠勝の絵を下げる（暗くして残さない）。薄くしてから隠す
        p.set('asai_envoy');
        expect(c.classList.contains('on')).toBe(false);
        expect(c.classList.contains('dim')).toBe(false);
        expect(c.style.transition).toBe('');
        await new Promise((r) => setTimeout(r, 200));
        expect(c.hidden).toBe(true);
        // 村の使い・知らない話し手も同じ（出さない）
        for (const sp of ['village', 'someone']) {
            p.set(sp);
            await flush();
            expect(c.hidden).toBe(true);
            expect(c.classList.contains('on')).toBe(false);
        }
        // 忠勝に戻る：出し直す
        p.set('tadakatsu');
        expect(c.hidden).toBe(false);
        expect(c.classList.contains('on')).toBe(true);
        // 家康（読めている）：重ね変わり（後の絵は足し合わせ）
        await loadArt(ART_IDS.portraitIeyasu);
        p.set('hero');
        expect(c.dataset.artId).toBe(ART_IDS.portraitIeyasu);
        frames(20, 2e6);
        const last = c.ctx!.draws().slice(-1)[0]!;
        expect(last.op).toBe('lighter');
        // 地の文：下げる
        p.set('narration');
        expect(c.classList.contains('on')).toBe(false);
        await new Promise((r) => setTimeout(r, 200));
        expect(c.hidden).toBe(true);
        p.dispose();
    });

    it('動きを減らす：出す・下げるに時間を掛けない（transition none、すぐ隠す）', async () => {
        art();
        const l = councilLayer();
        const p = slot(l, true);
        await loadArt(ART_IDS.portraitIeyasu);
        p.set('hero');
        const c = portraitOf(l)!;
        expect(c.style.transition).toBe('none');
        expect(c.classList.contains('on')).toBe(true);
        p.set('asai_envoy');
        expect(c.hidden).toBe(true);
        expect(c.style.transition).toBe('none');
        p.set('hero');
        expect(c.hidden).toBe(false);
        expect(c.classList.contains('on')).toBe(true);
        p.set('notice');
        expect(c.hidden).toBe(true);
        expect(dom.timers.size).toBe(0);
        p.dispose();
    });

    it('元の画像を拡大しない：高さは画像の高さ ÷ 端末の比まで（端末の比 3 でも原寸の画素で描く）', async () => {
        // 1280×720 で忠勝の画像（高さ 1453）：端末の比 1 は 619（画面で決まる）、2 は 619（1453÷2＝726 より小さい）、3 は 484（1453÷3）
        for (const [dpr, want] of [
            [1, 619],
            [2, 619],
            [3, Math.floor(1453 / 3)],
        ] as const) {
            art();
            __clearArtReadyForTest();
            const { layer } = installDom(1280, 720, dpr);
            const head = new FakeEl('div');
            head.className = 'g-council-head';
            head.rect = box(529, 18, 221, 51);
            const dialog = new FakeEl('div');
            dialog.className = 'g-dialog';
            dialog.rect = box(250, 614, 780, 92);
            layer.append(head, dialog);
            const p = new PortraitSlot(layer as unknown as HTMLElement, head as unknown as HTMLElement, dialog as unknown as HTMLElement, resolve, () => false, () => []);
            p.set('tadakatsu');
            await flush();
            const c = layer.querySelector('.g-portrait')!;
            const h = parseFloat(String(c.style.height));
            expect(h).toBe(want);
            // 端末の画素での高さ（CSS の高さ × 端末の比）は元の画像の高さ以下。canvas の画素は端末の比 3 まで
            expect(h * dpr).toBeLessThanOrEqual(1453);
            expect(c.height).toBeLessThanOrEqual(1453);
            expect(c.height).toBe(Math.round(h * Math.min(dpr, 3, 1453 / h)));
            p.dispose();
        }
    });

    it('台詞の枠の上に肩まで見えない（枠が高い・人物画が低い）なら出さない。頭・髷・肩を枠の後ろに隠さない', async () => {
        art({ assets: { ...ASSETS, [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 745, h: 1453, kind: 'portrait', meta: { shoulderY: 0.45 } } as never } });
        // 667×375：人物画は 300 の高さ（上端 75）。枠の上端 250 → 見える割合 175/300＝58% ≧ 45% で出す
        const { layer } = installDom(667, 375);
        const head = new FakeEl('div');
        head.className = 'g-council-head';
        head.rect = box(222, 18, 222, 51);
        const dialog = new FakeEl('div');
        dialog.className = 'g-dialog';
        dialog.rect = box(14, 250, 639, 111);
        layer.append(head, dialog);
        const p = new PortraitSlot(layer as unknown as HTMLElement, head as unknown as HTMLElement, dialog as unknown as HTMLElement, resolve, () => false, () => []);
        p.set('tadakatsu');
        await flush();
        const c = layer.querySelector('.g-portrait')!;
        expect(c.hidden).toBe(false);
        const h = parseFloat(String(c.style.height));
        expect((250 - (375 - h)) / h).toBeGreaterThanOrEqual(0.45);
        // 枠が高くなった（3 行の台詞）：上端 200 → 見える割合 125/300＝42% < 45%：出さない（縮めると見える割合はもっと減る）
        dialog.rect = box(14, 200, 639, 161);
        p.set('tadakatsu');
        expect(c.hidden).toBe(true);
        expect(c.classList.contains('on')).toBe(false);
        // 枠が元に戻った：出す
        dialog.rect = box(14, 250, 639, 111);
        p.set('tadakatsu');
        expect(c.hidden).toBe(false);
        p.dispose();
    });

    it('読み終わる前に話し手が変わった：前の人の読み込みが後から終わっても出さない', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('tadakatsu');
        p.set('sakai');
        await flush();
        expect(portraitOf(l)).toBeNull();
        p.dispose();
    });

    it('後片付け：窓の見張り・フレーム・時計を外す。片付けの後に読めた画像では作らない', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('tadakatsu');
        await flush();
        expect(listenerCount()).toBeGreaterThan(0);
        p.set('narration');
        expect(dom.timers.size).toBe(1);
        p.dispose();
        expect(listenerCount()).toBe(0);
        expect(dom.raf.size).toBe(0);
        expect(dom.timers.size).toBe(0);
        // 片付けの後に読めた
        const l2 = councilLayer();
        const p2 = slot(l2);
        p2.set('hero');
        p2.dispose();
        await flush();
        expect(portraitOf(l2)).toBeNull();
        expect(listenerCount()).toBe(0);
    });
});

describe('軍議の背景（CouncilBackdrop）', () => {
    it('読めたら div.g-council-bg を層のいちばん前に作る（奥の画と手前の幕）。層に g-art、一番上なら body に g-council-art', async () => {
        art();
        const l = councilLayer();
        const b = backdrop(l);
        b.start();
        expect(l.layer.querySelector('.g-council-bg')).toBeNull();
        await flush();
        const root = l.layer.firstChild!;
        expect(root.className).toBe('g-council-bg on');
        expect(root.attrs.get('aria-hidden')).toBe('true');
        expect(root.tree()).toEqual(['canvas.g-council-bg-base', 'canvas.g-council-bg-front sway']);
        expect(l.layer.classList.contains('g-art')).toBe(true);
        expect(dom.body.classList.contains('g-council-art')).toBe(true);
        const [base, front] = root.children as [FakeEl, FakeEl];
        expect(base.dataset.artId).toBe(ART_IDS.bgCouncil);
        expect(front.dataset.artId).toBe(ART_IDS.bgCouncilFront);
        // 揺れは CSS（--g-sway）。JS で毎フレーム動かさない（フレームを頼まない・transform を書かない）
        const m = Math.ceil(parallaxAmp(1280));
        expect(front.style.getPropertyValue('--g-sway')).toBe(`${parallaxAmp(1280).toFixed(2)}px`);
        expect(front.style.left).toBe(`${-m}px`);
        expect(front.style.transform).toBeUndefined();
        expect(dom.raf.size).toBe(0);
        // 手前の幕は奥の画と同じ大きさ・同じ位置（canvas の左端の −m の分だけ右へ）
        const [db] = base.ctx!.draws();
        const [df] = front.ctx!.draws();
        const sc = (d: Call) => (d.args[7] as number) / (d.args[3] as number);
        expect(sc(df!)).toBeCloseTo(sc(db!), 9);
        const at = (d: Call, sx: number) => (d.args[5] as number) + (sx - (d.args[1] as number)) * sc(d);
        expect(at(df!, 768) - m).toBeCloseTo(at(db!, 768), 6);
        expect(at(df!, 300) - m).toBeCloseTo(at(db!, 300), 6);
        // canvas の幅：端末の比 1 → CSS と同じ。手前は左右に m ずつ広い
        expect([base.width, base.height]).toEqual([1280, 720]);
        expect([front.width, front.height]).toEqual([1280 + 2 * m, 720]);
        b.dispose();
        expect(dom.body.classList.contains('g-council-art')).toBe(false);
    });

    it('canvas は元の画像より細かくしない（端末の比 2 のスマホ横で原寸以内のとき）', async () => {
        art();
        installDom(667, 375, 2);
        const layer = dom.body.children[0]!.children[0]!;
        const b = new CouncilBackdrop(layer as unknown as HTMLElement, COUNCIL, () => false, () => true);
        b.start();
        await flush();
        const [base, front] = layer.firstChild!.children as [FakeEl, FakeEl];
        const r = fitArt(1536, 1024, 667, 375, 'cover', { maxCropY: 0.18 });
        // 描く元の画像の幅（sw）より多い画素は持たない
        expect(base.width).toBeLessThanOrEqual(Math.ceil(r.sw));
        expect(base.width).toBeGreaterThan(667);
        expect(base.height).toBeLessThanOrEqual(Math.ceil(r.sh));
        expect(front.height).toBe(base.height);
        b.dispose();
    });

    /** 公開している素材と同じ寸法（art/story/council_day.webp：1664×936。手前の幕はまだ届いていない） */
    const V25 = { [ART_IDS.bgCouncil]: { file: 'art/story/council_day.webp', w: 1664, h: 936, kind: 'background' as const } };
    const resize = (layer: FakeEl, W: number, H: number, dpr: number) => {
        layer.rect = { left: 0, top: 0, width: W, height: H };
        vi.stubGlobal('devicePixelRatio', dpr);
        for (const f of dom.listeners.get('resize') ?? []) (f as () => void)();
        frames(1);
    };

    it('Version 26：端末の画素の比では外さない（1920×1080 の比 1・2、844×390・390×844 の比 2・3 でも出す）。倍率は CSS の px ÷ 元の画素で、比に依らない', async () => {
        for (const [W, H, dpr] of [
            [1920, 1080, 1],
            [1920, 1080, 2],
            [844, 390, 2],
            [844, 390, 3],
            [390, 844, 2],
            [390, 844, 3],
        ] as const) {
            const urls = art({ assets: V25 });
            __clearArtReadyForTest();
            installDom(W, H, dpr);
            const layer = dom.body.children[0]!.children[0]!;
            const b = new CouncilBackdrop(layer as unknown as HTMLElement, { base: ART_IDS.bgCouncil }, () => false, () => true);
            b.start();
            await flush();
            const root = layer.querySelector('.g-council-bg')!;
            expect(root, `${W}x${H}@${dpr}`).not.toBeNull();
            expect(root.hidden).toBe(false);
            expect(layer.classList.contains('g-art')).toBe(true);
            expect(urls).toEqual(['./art/story/council_day.webp']);
            const base = root.children[0]!;
            const lay = councilArtLayout(1664, 936, W, H)!;
            expect(lay.limited).toBe(false);
            // 画面いっぱい・縦横同じ倍率（drawImage の 4 つ目〜：sw・sh と dw・dh）
            expect([base.style.left, base.style.top, base.style.width, base.style.height]).toEqual(['0px', '0px', `${W}px`, `${H}px`]);
            const [d] = base.ctx!.draws();
            const [, sx, sy, sw, sh, dx, dy, dw, dh] = d!.args as number[];
            expect([dx, dy]).toEqual([0, 0]);
            expect(dw / sw).toBeCloseTo(dh / sh, 9);
            expect(dw / sw).toBeCloseTo(lay.scale, 9);
            expect([sx, sy, sw, sh]).toEqual([lay.rect.sx, lay.rect.sy, lay.rect.sw, lay.rect.sh]);
            // canvas の画素は元の画像の切り出しより多くしない（端末の比 3 でも）。縁は抜かない（画面いっぱい）
            expect(base.width).toBeLessThanOrEqual(Math.ceil(sw));
            expect(base.height).toBeLessThanOrEqual(Math.ceil(sh));
            expect(base.ctx!.calls.some((c) => c.fn === 'createLinearGradient')).toBe(false);
            // 開発用の記録：元の寸法と表示の寸法（CSS の px・端末の画素）
            const pr = JSON.parse(root.dataset.probe!);
            expect(pr.file).toEqual([1664, 936]);
            expect(pr.view).toEqual([W, H]);
            expect(pr.dpr).toBe(dpr);
            expect(pr.limited).toBe(false);
            expect(pr.feather).toEqual([0, 0]);
            expect(pr.scale).toBeCloseTo(lay.scale, 3);
            expect(pr.css).toEqual([0, 0, W, H]);
            expect(pr.device).toEqual([W * dpr, H * dpr]);
            expect(pr.canvas).toEqual([base.width, base.height]);
            b.dispose();
        }
    });

    it('1.25 倍を超える画面（2560×1440 は 1.538 倍が要る）：外さず、引き伸ばさず、1.25 倍で真ん中に描いて縁を暗い地へなじませる。大きさが変われば描き直す', async () => {
        art({ assets: V25 });
        installDom(2560, 1440, 1);
        const layer = dom.body.children[0]!.children[0]!;
        let changes = 0;
        const b = new CouncilBackdrop(layer as unknown as HTMLElement, { base: ART_IDS.bgCouncil }, () => false, () => true, () => changes++);
        b.start();
        await flush();
        const root = layer.querySelector('.g-council-bg')!;
        expect(root.hidden).toBe(false);
        expect(changes).toBe(1);
        const base = root.children[0]!;
        // canvas は描く所だけ（2080×1170。画素は元の 1664×936 まで）を (240, 135) に
        expect([base.style.left, base.style.top, base.style.width, base.style.height]).toEqual(['240px', '135px', '2080px', '1170px']);
        expect([base.width, base.height]).toEqual([1664, 936]);
        const [d] = base.ctx!.draws();
        expect(d!.args.slice(1)).toEqual([0, 0, 1664, 936, 0, 0, 2080, 1170]);
        // 縁：上下左右の 4 本を destination-out で抜く（幅は短い辺の 7%）
        const grads = base.ctx!.calls.filter((c) => c.fn === 'createLinearGradient');
        expect(grads).toHaveLength(4);
        const fw = councilFeatherPx(2080, 1170);
        expect(fw).toBe(82);
        const outs = base.ctx!.calls.filter((c) => c.fn === 'fillRect' && c.op === 'destination-out');
        expect(outs.map((c) => c.args)).toEqual([
            [0, 0, fw, 1170],
            [2080 - fw, 0, fw, 1170],
            [0, 0, 2080, fw],
            [0, 1170 - fw, 2080, fw],
        ]);
        const pr = JSON.parse(root.dataset.probe!);
        expect(pr).toMatchObject({ file: [1664, 936], view: [2560, 1440], limited: true, scale: COUNCIL_ART.maxScale, css: [240, 135, 2080, 1170], device: [2080, 1170], feather: [fw, fw] });
        expect(pr.need).toBeCloseTo(1.538, 3);
        // 1280×720 へ（1.25 倍以内）：画面いっぱいに描き直し、縁は抜かない。出したまま（出し入れの知らせは無い）
        base.ctx!.calls.length = 0;
        resize(layer, 1280, 720, 1);
        expect([base.style.left, base.style.top, base.style.width, base.style.height]).toEqual(['0px', '0px', '1280px', '720px']);
        expect(base.ctx!.calls.some((c) => c.fn === 'createLinearGradient')).toBe(false);
        expect(root.hidden).toBe(false);
        expect(changes).toBe(1);
        b.dispose();
        expect(listenerCount()).toBe(0);
    });

    it('手前の幕は、範囲を限った時も奥の画と同じ所・同じ倍率で描き、同じ縁をなじませる', async () => {
        const both = { ...V25, [ART_IDS.bgCouncilFront]: { file: 'art/story/council_front.webp', w: 1664, h: 936, kind: 'overlay' as const } };
        art({ assets: both });
        installDom(2560, 1440, 1);
        const layer = dom.body.children[0]!.children[0]!;
        const b = new CouncilBackdrop(layer as unknown as HTMLElement, COUNCIL, () => false, () => true);
        b.start();
        await flush();
        const [base, front] = layer.querySelector('.g-council-bg')!.children as [FakeEl, FakeEl];
        const m = Math.ceil(parallaxAmp(2560));
        expect([front.style.left, front.style.top, front.style.width]).toEqual([`${240 - m}px`, '135px', `${2080 + 2 * m}px`]);
        const [db] = base.ctx!.draws();
        const [df] = front.ctx!.draws();
        // 画面の上の位置：奥の画は canvas の左端 240、手前は 240 − m。元の画像の同じ点が同じ画面の位置に来る
        const scr = (d: Call, left: number, sx: number) => left + (d.args[5] as number) + (sx - (d.args[1] as number)) * ((d.args[7] as number) / (d.args[3] as number));
        expect(scr(df!, 240 - m, 800)).toBeCloseTo(scr(db!, 240, 800), 6);
        expect(front.ctx!.calls.filter((c) => c.fn === 'createLinearGradient')).toHaveLength(4);
        b.dispose();
    });

    it('層の大きさが測れない（0）間は読まずに待ち、大きさが付いたら読んで出す。0 に戻れば外して Version 24 の画面に戻す', async () => {
        const urls = art({ assets: V25 });
        installDom(0, 0, 2);
        const layer = dom.body.children[0]!.children[0]!;
        let changes = 0;
        const b = new CouncilBackdrop(layer as unknown as HTMLElement, { base: ART_IDS.bgCouncil }, () => false, () => true, () => changes++);
        b.start();
        await flush();
        expect(layer.querySelector('.g-council-bg')).toBeNull();
        expect(layer.className).toBe('g-layer council');
        expect(urls).toEqual([]);
        resize(layer, 844, 390, 2);
        await flush();
        const root = layer.querySelector('.g-council-bg')!;
        expect(root.hidden).toBe(false);
        expect(layer.classList.contains('g-art')).toBe(true);
        expect(dom.body.classList.contains('g-council-art')).toBe(true);
        expect(urls).toEqual(['./art/story/council_day.webp']);
        expect(changes).toBe(1);
        resize(layer, 0, 0, 2);
        expect(root.hidden).toBe(true);
        expect(layer.classList.contains('g-art')).toBe(false);
        expect(dom.body.classList.contains('g-council-art')).toBe(false);
        expect(changes).toBe(2);
        b.dispose();
        expect(listenerCount()).toBe(0);
    });

    it('?art=v24・?artOff=council：作らない・読まない・見張りも付けない（人物画も ?art=v24・?artOff=portrait では作らない）', async () => {
        for (const search of ['?art=v24', '?artOff=council,portrait', '?artOff=grass,council&x=1']) {
            const urls = art();
            __clearArtReadyForTest();
            vi.stubGlobal('location', { search, hash: '' });
            const l = councilLayer();
            const b = backdrop(l);
            b.start();
            const p = slot(l);
            p.preload(['hero', 'tadakatsu']);
            p.set('tadakatsu');
            await flush();
            frames(2);
            expect(l.layer.querySelector('.g-council-bg')).toBeNull();
            expect(l.layer.className).toBe('g-layer council');
            expect(urls.filter((u) => u.includes('/bg/'))).toEqual([]);
            if (search !== '?artOff=grass,council&x=1') {
                expect(portraitOf(l)).toBeNull();
                expect(urls).toEqual([]);
                expect(listenerCount()).toBe(0);
            } else {
                // 人物画は外していない：出る
                expect(portraitOf(l)).not.toBeNull();
            }
            b.dispose();
            p.dispose();
        }
    });

    it('先に読めていれば（忠勝との会話の間に読んだ）、最初の軍議でも同じフレームのうちに出す（薄い所から出さない）', async () => {
        art();
        await loadArt(ART_IDS.bgCouncil);
        await loadArt(ART_IDS.bgCouncilFront);
        const l = councilLayer();
        const b = backdrop(l);
        b.start();
        const root = l.layer.firstChild!;
        expect(root.className).toBe('g-council-bg on');
        expect(root.style.transition).toBe('none');
        expect(root.children).toHaveLength(2);
        b.dispose();
    });

    it('一番上でない（メニューなどが重なっている間に読めた）なら body の印は付けない（知らせを上げない・揺らさない）', async () => {
        art();
        const l = councilLayer();
        const b = backdrop(l, { top: false });
        b.start();
        await flush();
        expect(l.layer.classList.contains('g-art')).toBe(true);
        expect(dom.body.classList.contains('g-council-art')).toBe(false);
        b.dispose();
    });

    it('動きを減らす：揺らさない（sway も --g-sway も無し、手前の幕は奥の画と同じ幅）。設定が変われば戻ったときに描き直す', async () => {
        art();
        let reduced = true;
        const l = councilLayer();
        const b = new CouncilBackdrop(l.layer as unknown as HTMLElement, COUNCIL, () => reduced, () => true);
        b.start();
        await flush();
        const front = l.layer.firstChild!.children[1]!;
        expect(front.className).toBe('g-council-bg-front');
        expect(front.style.getPropertyValue('--g-sway')).toBe('');
        expect(front.style.left).toBe('0px');
        expect(front.width).toBe(1280);
        reduced = false;
        b.resume();
        expect(front.classList.contains('sway')).toBe(true);
        expect(front.width).toBe(1280 + 2 * Math.ceil(parallaxAmp(1280)));
        reduced = true;
        b.resume();
        expect(front.classList.contains('sway')).toBe(false);
        b.dispose();
    });

    it('後片付け：窓の見張りと body の印を外す。片付けの後に読めた画像では作らない', async () => {
        art();
        const l = councilLayer();
        const b = backdrop(l);
        b.start();
        await flush();
        expect(listenerCount()).toBeGreaterThan(0);
        b.dispose();
        expect(listenerCount()).toBe(0);
        expect(dom.raf.size).toBe(0);
        expect(dom.body.className).toBe('');
        const l2 = councilLayer();
        const b2 = backdrop(l2);
        __clearArtReadyForTest();
        __setArtManifestForTest({ version: 1, assets: ASSETS });
        b2.start();
        b2.dispose();
        await flush();
        expect(l2.layer.querySelector('.g-council-bg')).toBeNull();
        expect(l2.layer.className).toBe('g-layer council');
        expect(dom.body.className).toBe('');
    });
});
