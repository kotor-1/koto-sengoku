/**
 * 生成イラスト素材（Version 22）の会話の人物画（PortraitSlot）・軍議の背景（CouncilBackdrop）の DOM の部品（ui/artCanvas.ts）。
 * Node には DOM が無いので、部品が使う所だけの小さな偽の DOM（要素・canvas・getComputedStyle・窓の見張り・フレーム）で確かめる。
 * - 旧表示（?art=old）・素材の一覧が空・読めない：要素を一つも作らない（Version 21 と同じ画面）。
 * - 画像が読めたら作る（人物画は見出し・選択肢の前、背景は層のいちばん前）。手前の幕は奥の画と同じ大きさで、揺れの幅だけ広い。
 * - 絵の無い人物の行は、前の人の絵を同じ位置のまま暗く残す。地の文・高札では下げる。点滅させない。動きを減らすときは時間を掛けない。
 * - 後片付け：見張り・フレーム・時計・body の印を外す。片付けの後に読めた画像では何も作らない。
 * 本物のブラウザでの位置・重なりの確かめは、開発サーバーで ?artFixture=1（仮の確かめ用の画像。見た目の素材ではない）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS } from '../proto3d/src/art/ids';
import type { ArtId } from '../proto3d/src/art/ids';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { CouncilBackdrop, PortraitSlot, __clearArtReadyForTest, fitArt, loadArt, parallaxAmp, type Box } from '../proto3d/src/ui/artCanvas';

// ================= 偽の DOM =================

type Call = { fn: string; args: unknown[]; op?: string; alpha?: number };

class FakeCtx {
    calls: Call[] = [];
    globalAlpha = 1;
    globalCompositeOperation = 'source-over';
    fillStyle = '';
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

function slot(l: ReturnType<typeof councilLayer>, reduced = false) {
    return new PortraitSlot(l.layer as unknown as HTMLElement, l.head as unknown as HTMLElement, l.dialog as unknown as HTMLElement, resolve, () => reduced, () => []);
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
    it('読めたら canvas.g-portrait を見出しの前に作る。台詞の枠の後ろは透明に抜く。見出しの後ろの暗さも避ける', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('tadakatsu');
        expect(portraitOf(l)).toBeNull();
        await flush();
        const c = portraitOf(l)!;
        expect(c).not.toBeNull();
        expect(l.layer.tree()).toEqual(['div.g-council-head', 'button.g-council-map', 'div.g-choices[hidden]', 'div.g-dialog'].flatMap((x, i) => (i === 0 ? ['canvas.g-portrait on', x] : [x])));
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
        const headArt: Box = { left: 529 - 34, top: 18 - 8, right: 750 + 34, bottom: 69 + 10 };
        expect(r.right <= headArt.left || r.top >= headArt.bottom).toBe(true);
        // 元の画像より細かくしない（端末の比 1 → 1 倍）
        expect(c.width).toBe(w);
        // 台詞の枠の後ろは抜く（destination-out の角の丸い四角が枠の所）
        const cut = c.ctx!.calls.find((k) => k.fn === 'roundRect')!;
        expect(cut.op).toBe('destination-out');
        expect(cut.args.slice(0, 2)).toEqual([250 - 24, 614 - (720 - h)]);
        p.dispose();
    });

    it('見出しの後ろの暗さ（::before）が人物画にかかる画面では、その分だけ人物画を小さくする', async () => {
        // 縦横の比 2:3 の人物画（余白を切り詰める前の形）
        art({ assets: { ...ASSETS, [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 1024, h: 1536, kind: 'portrait' } } });
        // 667×375 の軍議の台詞の行：見出しの箱は 222〜444（Version 21 と同じ）。後ろの暗さは 188〜478・10〜79
        const { layer } = installDom(667, 375);
        const head = new FakeEl('div');
        head.className = 'g-council-head';
        head.rect = box(222, 18, 222, 51);
        head.scrim = [-8, -34, -10, -34];
        const map = new FakeEl('button');
        map.className = 'g-council-map';
        map.rect = box(12, 12, 122, 45);
        const dialog = new FakeEl('div');
        dialog.className = 'g-dialog';
        dialog.rect = box(14, 270, 639, 92);
        layer.append(head, map, dialog);
        const p = new PortraitSlot(layer as unknown as HTMLElement, head as unknown as HTMLElement, dialog as unknown as HTMLElement, resolve, () => false, () => []);
        p.set('tadakatsu');
        await flush();
        const c = layer.querySelector('.g-portrait')!;
        // 暗さの下端 79＋8 → 375−87＝288（暗さを数えなければ 300）
        expect(parseFloat(String(c.style.height))).toBe(288);
        p.dispose();
        // 同じ画面で暗さが無い（::before が無い）なら 300
        head.scrim = null;
        const p2 = new PortraitSlot(layer as unknown as HTMLElement, head as unknown as HTMLElement, dialog as unknown as HTMLElement, resolve, () => false, () => []);
        layer.querySelector('.g-portrait')!.remove();
        p2.set('tadakatsu');
        expect(parseFloat(String(layer.querySelector('.g-portrait')!.style.height))).toBe(300);
        p2.dispose();
    });

    it('絵の無い人物の行は、前の人の絵を同じ位置のまま暗く残す。地の文・高札で下げる。点滅させない', async () => {
        art();
        const l = councilLayer();
        const p = slot(l);
        p.set('narration');
        await flush();
        expect(portraitOf(l)).toBeNull();
        // 絵の無い人物から始まる：何も出さない
        p.set('sakai');
        await flush();
        expect(portraitOf(l)).toBeNull();
        p.set('tadakatsu');
        await flush();
        const c = portraitOf(l)!;
        const size = [c.style.width, c.style.height, c.width, c.height];
        const draws = () => c.ctx!.draws().length;
        const n0 = draws();
        // 酒井：忠勝の絵を暗く残す（同じ絵・同じ大きさ・描き直さない・消さない）
        p.set('sakai');
        await flush();
        frames(3);
        expect(c.classList.contains('on')).toBe(true);
        expect(c.classList.contains('dim')).toBe(true);
        expect(c.hidden).toBe(false);
        expect(c.dataset.artId).toBe(ART_IDS.portraitTadakatsu);
        expect([c.style.width, c.style.height, c.width, c.height]).toEqual(size);
        expect(draws()).toBe(n0);
        expect(c.style.transition).toBe('');
        // 石川も続けて：暗いまま
        p.set('ishikawa');
        expect(c.classList.contains('dim')).toBe(true);
        expect(draws()).toBe(n0);
        // 忠勝に戻る：明るく（出し直さない）
        p.set('tadakatsu');
        expect(c.classList.contains('dim')).toBe(false);
        expect(c.classList.contains('on')).toBe(true);
        expect(draws()).toBe(n0);
        // 家康（読めている）：重ね変わり。暗くはしない
        await loadArt(ART_IDS.portraitIeyasu);
        p.set('sakai');
        p.set('hero');
        expect(c.classList.contains('dim')).toBe(false);
        expect(c.dataset.artId).toBe(ART_IDS.portraitIeyasu);
        frames(20, 2e6);
        const last = c.ctx!.draws().slice(-1)[0]!;
        expect(last.op).toBe('lighter');
        // 地の文：下げる（薄くしてから隠す）
        p.set('narration');
        expect(c.classList.contains('on')).toBe(false);
        await new Promise((r) => setTimeout(r, 200));
        expect(c.hidden).toBe(true);
        // 地の文の後の絵の無い人物：出さない（暗い絵も出さない）
        p.set('oda_envoy');
        expect(c.hidden).toBe(true);
        expect(c.classList.contains('on')).toBe(false);
        p.dispose();
    });

    it('動きを減らす：暗くする・戻す・出す・下げるに時間を掛けない（transition none、すぐ隠す）', async () => {
        art();
        const l = councilLayer();
        const p = slot(l, true);
        await loadArt(ART_IDS.portraitIeyasu);
        p.set('hero');
        const c = portraitOf(l)!;
        expect(c.style.transition).toBe('none');
        expect(c.classList.contains('on')).toBe(true);
        p.set('asai_envoy');
        expect(c.classList.contains('dim')).toBe(true);
        expect(c.style.transition).toBe('none');
        p.set('hero');
        expect(c.classList.contains('dim')).toBe(false);
        p.set('notice');
        expect(c.hidden).toBe(true);
        expect(dom.timers.size).toBe(0);
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

    it('canvas は元の画像より細かくしない（端末の比 2 のスマホ・元の画像より大きな画面）', async () => {
        art();
        installDom(844, 390, 2);
        const layer = dom.body.children[0]!.children[0]!;
        const b = new CouncilBackdrop(layer as unknown as HTMLElement, COUNCIL, () => false, () => true);
        b.start();
        await flush();
        const [base, front] = layer.firstChild!.children as [FakeEl, FakeEl];
        const r = fitArt(1536, 1024, 844, 390, 'cover', { maxCropY: 0.18 });
        // 描く元の画像の幅（sw）より多い画素は持たない
        expect(base.width).toBeLessThanOrEqual(Math.ceil(r.sw));
        expect(base.width).toBeGreaterThan(844);
        expect(base.height).toBeLessThanOrEqual(Math.ceil(r.sh));
        expect(front.height).toBe(base.height);
        b.dispose();
        // 1920×1080（端末の比 1）：元の画像（1536）が画面より粗い → canvas も 1536（CSS の 1920 に拡げて見せる）
        installDom(1920, 1080, 1);
        const big = dom.body.children[0]!.children[0]!;
        const b2 = new CouncilBackdrop(big as unknown as HTMLElement, COUNCIL, () => false, () => true);
        b2.start();
        await flush();
        const [base2] = big.firstChild!.children as [FakeEl];
        expect([base2.width, base2.height]).toEqual([1536, 864]);
        expect(base2.style.width).toBe('1920px');
        b2.dispose();
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
