/**
 * 台詞の枠の顔（Version 22。ui/artCanvas.ts の DialogFace・dialogFaceIds・dialogFaceFor・artInUse）と、歴史分岐の話し手 → 顔（ieyasuFaceOf）。
 * Node には DOM が無いので、部品が使う所だけの小さな偽の DOM（台詞の枠・canvas・窓の見張り）で確かめる。
 * - 旧表示（?art=old）・素材の一覧が空・顔の無い台本・どの顔も読めない：枠に何も足さない（class も要素も無い＝Version 21 と同じ枠）。
 * - 読めている顔があれば、開いた同じフレームのうちに左の空き（has-face）と canvas.g-face を作り、台本の終わりまで空きは取ったまま。
 * - 行の話し手の顔だけを出す。顔の無い行（地の文・使者・村の使い・高札）は空きだけ。人物画が出ている人の行は顔を出さない。
 * - 描く細かさは端末の比 2 まで（元の 256 画素より細かくしない）。左右の反転はしない。後片付けで見張りを外す。
 * 本物の画面での位置・大きさ・重なりの確かめは開発サーバー（本物の顔の素材）で行う。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS, FACE_OF, type ArtId } from '../proto3d/src/art/ids';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { AI_ART_NOTE, DIALOG_FACE_PX, DialogFace, PortraitSlot, __clearArtReadyForTest, artInUse, dialogFaceFor, dialogFaceIds, loadArt } from '../proto3d/src/ui/artCanvas';
import { ieyasuFaceOf, ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { devIeyasuState } from '../proto3d/src/campaign/ieyasu1570/flow';
import { startChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { fictionalScenario } from '../proto3d/src/campaign/fictional';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import generated from '../proto3d/src/art/manifest.gen.json';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { ch1Aftermath, ch1Ending } from './proto3d-ieyasu-story-states';

// ================= 偽の DOM =================

type Call = { fn: string; args: unknown[] };

class FakeCtx {
    calls: Call[] = [];
    globalAlpha = 1;
    globalCompositeOperation = 'source-over';
    fillStyle = '';
    imageSmoothingEnabled = true;
    imageSmoothingQuality = 'low';
    setTransform(...a: unknown[]) {
        this.calls.push({ fn: 'setTransform', args: a });
    }
    clearRect(...a: unknown[]) {
        this.calls.push({ fn: 'clearRect', args: a });
    }
    fillRect() {}
    drawImage(...a: unknown[]) {
        this.calls.push({ fn: 'drawImage', args: a });
    }
    beginPath() {}
    roundRect() {}
    rect() {}
    fill() {}
    draws() {
        return this.calls.filter((c) => c.fn === 'drawImage');
    }
}

class FakeEl {
    children: FakeEl[] = [];
    parentNode: FakeEl | null = null;
    readonly classes = new Set<string>();
    readonly classList = {
        add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
        remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
        contains: (c: string) => this.classes.has(c),
        toggle: (c: string, f?: boolean) => {
            const on = f ?? !this.classes.has(c);
            if (on) this.classes.add(c);
            else this.classes.delete(c);
            return on;
        },
    };
    readonly dataset: Record<string, string> = {};
    readonly style: Record<string, string> & { setProperty?: unknown } = {};
    readonly attrs = new Map<string, string>();
    hidden = false;
    draggable = true;
    width = 300;
    height = 150;
    /** CSS の大きさ（顔の canvas は CSS の --g-face。出ていなければ 0） */
    cssSize = 0;
    rect: { left: number; top: number; width: number; height: number } | null = null;
    ctx: FakeCtx | null = null;
    constructor(readonly tagName: string) {}
    get className() {
        return [...this.classes].join(' ');
    }
    set className(v: string) {
        this.classes.clear();
        for (const c of v.split(/\s+/)) if (c) this.classes.add(c);
    }
    get firstChild() {
        return this.children[0] ?? null;
    }
    get isConnected() {
        return true;
    }
    insertBefore(n: FakeEl, ref: FakeEl | null) {
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(n);
        else this.children.splice(i, 0, n);
        n.parentNode = this;
        return n;
    }
    append(...ns: FakeEl[]) {
        for (const n of ns) this.insertBefore(n, null);
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
    getBoundingClientRect() {
        const r = this.rect ?? { left: 0, top: 0, width: this.hidden ? 0 : this.cssSize, height: this.hidden ? 0 : this.cssSize };
        return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height, x: r.left, y: r.top };
    }
    get offsetWidth() {
        return this.getBoundingClientRect().width;
    }
    querySelector(sel: string): FakeEl | null {
        const c = sel.replace(/^\./, '');
        for (const ch of this.children) {
            if (ch.classes.has(c)) return ch;
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
    tree(): string[] {
        return this.children.map((c) => `${c.tagName}.${c.className}${c.hidden ? '[hidden]' : ''}`);
    }
}

let listeners: Map<string, Set<() => void>>;
let rafs: Map<number, () => void>;

/** 偽の DOM を置く。faceCss は CSS が決める顔の大きさ（PC 72・スマホ横 52） */
function installDom(o: { dpr?: number; faceCss?: number } = {}) {
    listeners = new Map();
    rafs = new Map();
    let seq = 0;
    const add = (t: string, f: () => void) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t)!.add(f);
    };
    const del = (t: string, f: () => void) => void listeners.get(t)?.delete(f);
    vi.stubGlobal('document', {
        createElement: (tag: string) => {
            const e = new FakeEl(tag);
            if (tag === 'canvas') e.cssSize = o.faceCss ?? 72;
            return e;
        },
    });
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: del });
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
        rafs.set(++seq, f);
        return seq;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => void rafs.delete(id));
    vi.stubGlobal('devicePixelRatio', o.dpr ?? 1);
    vi.stubGlobal('getComputedStyle', (e: FakeEl) => ({ display: e.hidden ? 'none' : 'block', visibility: 'visible', content: 'none' }));
    // 台詞の枠（名前・台詞・行の数・▼）
    const box = new FakeEl('div');
    box.className = 'g-dialog';
    for (const c of ['name', 'text', 'count', 'more']) {
        const e = new FakeEl('div');
        e.className = c;
        box.append(e);
    }
    return box;
}

const listenerCount = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
const resize = () => {
    for (const f of listeners.get('resize') ?? []) f();
    const q = [...rafs.values()];
    rafs.clear();
    for (const f of q) f();
};

const flush = async (n = 30) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

const FACE = (name: string) => ({ file: `art/faces/${name}.webp`, w: 256, h: 256, kind: 'face' as const });
const FACES = {
    [ART_IDS.faceIeyasu]: FACE('ieyasu'),
    [ART_IDS.faceTadakatsu]: FACE('tadakatsu'),
    [ART_IDS.faceSakai]: FACE('sakai'),
    [ART_IDS.faceIshikawa]: FACE('ishikawa'),
};

/** 素材の一覧と読み込み（fetch → createImageBitmap）の偽物。fail に入れた名前のファイルは 404。読んだ URL を返す */
function art(o: { assets?: Record<string, { file: string; w: number; h: number; kind: 'face' | 'portrait' }>; fail?: string[] } = {}) {
    const assets = o.assets ?? FACES;
    __setArtManifestForTest({ version: 1, assets });
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        if (o.fail?.some((f) => String(url).includes(f))) return { ok: false, status: 404 };
        return { ok: true, status: 200, blob: async () => ({ url: String(url) }) };
    });
    vi.stubGlobal('createImageBitmap', async (b: { url: string }) => {
        const e = Object.values(assets).find((a) => b.url.endsWith(a.file))!;
        return { width: e.w, height: e.h, close() {}, file: e.file };
    });
    return urls;
}

/** 歴史分岐の口（第一章・第二章で同じ） */
const faceOf = (sp: string) => ieyasuFaceOf(sp);
/** 忠勝との会話・軍議に出る話し手（地の文・家康・忠勝・酒井・石川・使者） */
const COUNCIL_SPEAKERS = ['narration', 'tadakatsu', 'hero', 'sakai', 'ishikawa', 'oda_envoy', 'tadakatsu'];

function make(box: FakeEl, speakers: string[] = COUNCIL_SPEAKERS, portraitOf: ((sp: string) => ArtId | null) | null = null, onGutter: (() => void) | null = null) {
    return new DialogFace(box as unknown as HTMLElement, speakers, faceOf, portraitOf, onGutter);
}
const faceEl = (box: FakeEl) => box.querySelector('.g-face');
const V21_TREE = ['div.name', 'div.text', 'div.count', 'div.more'];

beforeEach(() => {
    __clearArtReadyForTest();
});
afterEach(() => {
    vi.unstubAllGlobals();
    __setArtManifestForTest(null);
    __clearArtReadyForTest();
});

// ================= 口（純粋） =================

describe('話し手 → 台詞の枠の顔（歴史分岐）', () => {
    it('家康（hero）・忠勝・酒井・石川だけ。使者・村の使い・高札・地の文・ほかの id は出さない', () => {
        expect(ieyasuFaceOf('hero')).toBe(ART_IDS.faceIeyasu);
        expect(ieyasuFaceOf('tadakatsu')).toBe(ART_IDS.faceTadakatsu);
        expect(ieyasuFaceOf('sakai')).toBe(ART_IDS.faceSakai);
        expect(ieyasuFaceOf('ishikawa')).toBe(ART_IDS.faceIshikawa);
        // 酒井忠次・本多忠勝・榊原康政を取り違えない（それぞれ別の顔）
        expect(new Set(['hero', 'tadakatsu', 'sakai', 'ishikawa'].map(ieyasuFaceOf)).size).toBe(4);
        expect(ieyasuFaceOf('sakai')).not.toBe(FACE_OF.sakakibara);
        expect(ieyasuFaceOf('tadakatsu')).not.toBe(FACE_OF.sakakibara);
        for (const sp of ['narration', 'notice', 'oda_envoy', 'asai_envoy', 'village', 'envoy', 'gate', 'council', '', 'ieyasu', 'sakakibara', 'nagamasa', 'nobunaga', 'yoshikage']) {
            expect(ieyasuFaceOf(sp), sp).toBeNull();
        }
    });

    it('シナリオの faceOf：第一章・第二章（負傷していても同じ顔）。架空の章は持たない（主人公 hero は宗真で、家康の顔を付けない）', () => {
        const sc = ieyasuScenario(new MemoryStorage());
        const s1 = devIeyasuState('explore');
        expect(sc.faceOf?.(s1, 'hero')).toBe(ART_IDS.faceIeyasu);
        expect(sc.faceOf?.(s1, 'asai_envoy')).toBeNull();
        const s2 = startChapter2(ch1Ending(ch1Aftermath('oda', 'defeat', 'kept', 'heavy')));
        expect(s2.characters.tadakatsu).not.toBe('alive');
        expect(sc.faceOf?.(s2, 'tadakatsu')).toBe(ART_IDS.faceTadakatsu);
        expect(sc.faceOf?.(s2, 'ishikawa')).toBe(ART_IDS.faceIshikawa);
        expect(sc.faceOf?.(s2, 'village')).toBeNull();
        const fic = fictionalScenario(new CampaignSaveStore(new MemoryStorage()));
        expect(fic.faceOf).toBeUndefined();
    });

    it('dialogFaceIds：使える顔だけ（話し手の順・重なり無し）。dialogFaceFor：人物画が出ている人の行は顔を出さない', () => {
        expect(dialogFaceIds(COUNCIL_SPEAKERS, faceOf, () => true)).toEqual([ART_IDS.faceTadakatsu, ART_IDS.faceIeyasu, ART_IDS.faceSakai, ART_IDS.faceIshikawa]);
        expect(dialogFaceIds(COUNCIL_SPEAKERS, faceOf, (id) => id === ART_IDS.faceSakai)).toEqual([ART_IDS.faceSakai]);
        expect(dialogFaceIds(['narration', 'oda_envoy', 'notice'], faceOf, () => true)).toEqual([]);
        expect(dialogFaceFor(ART_IDS.faceTadakatsu, null, null)).toBe(ART_IDS.faceTadakatsu);
        expect(dialogFaceFor(ART_IDS.faceTadakatsu, ART_IDS.portraitTadakatsu, null)).toBe(ART_IDS.faceTadakatsu);
        expect(dialogFaceFor(ART_IDS.faceTadakatsu, ART_IDS.portraitTadakatsu, ART_IDS.portraitIeyasu)).toBe(ART_IDS.faceTadakatsu);
        expect(dialogFaceFor(ART_IDS.faceTadakatsu, ART_IDS.portraitTadakatsu, ART_IDS.portraitTadakatsu)).toBeNull();
        expect(dialogFaceFor(null, null, null)).toBeNull();
    });

    it('artInUse（タイトルの AI 生成の明示）：素材の一覧に 1 つ以上あり、旧表示でないときだけ', () => {
        expect(AI_ART_NOTE).toBe('一部の人物・背景画像はAI生成画像を加工して使用');
        // ゲームが読む一覧（manifest.gen.json）：今は顔が入っている
        expect(Object.keys((generated as { assets: object }).assets).length).toBeGreaterThan(0);
        expect(artInUse()).toBe(true);
        __setArtManifestForTest({ version: 1, assets: {} });
        expect(artInUse()).toBe(false);
        __setArtManifestForTest(null);
        vi.stubGlobal('location', { search: '?art=old', hash: '' });
        expect(artInUse()).toBe(false);
        vi.stubGlobal('location', { search: '', hash: '#art=old' });
        expect(artInUse()).toBe(false);
    });
});

// ================= 何も足さない（Version 21 と同じ枠） =================

describe('台詞の枠に何も足さない（Version 21 と同じ枠）', () => {
    const run = async (box: FakeEl, speakers = COUNCIL_SPEAKERS) => {
        const f = make(box, speakers);
        f.start();
        for (const sp of speakers) {
            f.set(sp);
            await flush();
        }
        expect(box.tree()).toEqual(V21_TREE);
        expect(box.className).toBe('g-dialog');
        expect(f.reserved).toBe(false);
        expect(listenerCount()).toBe(0);
        f.dispose();
    };

    it('旧表示（?art=old・#art=old）：何も読まず、何も作らない', async () => {
        const urls = art();
        vi.stubGlobal('location', { search: '?art=old', hash: '' });
        await run(installDom());
        vi.stubGlobal('location', { search: '', hash: '#art=old' });
        await run(installDom());
        expect(urls).toEqual([]);
    });

    it('旧表示に変えた後は、先に読めていた顔も使わない', async () => {
        const urls = art();
        expect(await loadArt(ART_IDS.faceTadakatsu)).not.toBeNull();
        vi.stubGlobal('location', { search: '', hash: '#art=old' });
        await run(installDom());
        expect(urls).toHaveLength(1);
    });

    it('素材の一覧が空：何も読まず、何も作らない', async () => {
        const urls = art({ assets: {} });
        await run(installDom());
        expect(urls).toEqual([]);
    });

    it('顔の無い台本（地の文・使者・高札・村の使いだけ）：何も読まず、何も作らない', async () => {
        const urls = art();
        await run(installDom(), ['narration', 'oda_envoy', 'asai_envoy', 'notice', 'village']);
        expect(urls).toEqual([]);
    });

    it('どの顔も読めない（404）：空きも要素も作らない', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const urls = art({ fail: ['faces/'] });
        await run(installDom());
        expect(urls.length).toBe(4);
    });
});

// ================= 顔を出す =================

describe('台詞の枠の顔（DialogFace）', () => {
    it('読めている顔があれば、開いた同じフレームのうちに左の空きと canvas.g-face（先頭・aria-hidden・ドラッグ不可）を作る', async () => {
        art();
        await loadArt(ART_IDS.faceTadakatsu);
        await loadArt(ART_IDS.faceIeyasu);
        const box = installDom();
        const f = make(box);
        f.start();
        // 待たずに（同じフレーム）
        expect(box.className).toBe('g-dialog has-face');
        expect(box.tree()).toEqual(['canvas.g-face[hidden]', ...V21_TREE]);
        const c = faceEl(box)!;
        expect(c.attrs.get('aria-hidden')).toBe('true');
        expect(c.draggable).toBe(false);
        f.set('narration');
        expect(c.hidden).toBe(true);
        f.set('tadakatsu');
        expect(c.hidden).toBe(false);
        expect(c.dataset.artId).toBe(ART_IDS.faceTadakatsu);
        // 元の 256×256 を全部、72×72 の箱へ（反転しない：幅・高さは正。拡大縮小の変換も正）
        const d = c.ctx!.draws().pop()!;
        expect(d.args.slice(1)).toEqual([0, 0, 256, 256, 0, 0, 72, 72]);
        expect(c.ctx!.calls.filter((k) => k.fn === 'setTransform').every((k) => (k.args[0] as number) > 0 && (k.args[3] as number) > 0)).toBe(true);
        f.dispose();
    });

    it('行ごとに今の話し手の顔。顔の無い行（地の文・使者）は空きだけ残す。同じ人が続けば描き直さない', async () => {
        art();
        for (const id of Object.keys(FACES)) await loadArt(id as ArtId);
        const box = installDom();
        const f = make(box);
        f.start();
        const c = faceEl(box)!;
        const seen: (string | null)[] = [];
        for (const sp of ['narration', 'tadakatsu', 'tadakatsu', 'hero', 'sakai', 'ishikawa', 'oda_envoy', 'notice', 'village', 'tadakatsu']) {
            f.set(sp);
            seen.push(c.hidden ? null : c.dataset.artId!);
            // 空きは取ったまま（名前・台詞の始まりの位置が動かない）
            expect(box.classes.has('has-face')).toBe(true);
        }
        expect(seen).toEqual([null, ART_IDS.faceTadakatsu, ART_IDS.faceTadakatsu, ART_IDS.faceIeyasu, ART_IDS.faceSakai, ART_IDS.faceIshikawa, null, null, null, ART_IDS.faceTadakatsu]);
        // 描いたのは話し手が変わった時だけ（忠勝 → 家康 → 酒井 → 石川 → 忠勝）
        expect(c.ctx!.draws()).toHaveLength(5);
        expect(box.tree()).toEqual(['canvas.g-face', ...V21_TREE]);
        f.dispose();
    });

    it('まだ読めていない：最初の顔が読めた時に空きを取り、まだその人の行なら出す（読み込み中の行・地の文では出さない）', async () => {
        const urls = art();
        const box = installDom();
        let gutter = 0;
        const f = make(box, COUNCIL_SPEAKERS, null, () => gutter++);
        f.start();
        f.set('narration');
        expect(box.tree()).toEqual(V21_TREE);
        await flush();
        // 4 人の顔を 1 回ずつ読んだ
        expect([...urls].sort()).toEqual(['./art/faces/ieyasu.webp', './art/faces/ishikawa.webp', './art/faces/sakai.webp', './art/faces/tadakatsu.webp']);
        expect(box.className).toBe('g-dialog has-face');
        expect(gutter).toBe(1);
        expect(faceEl(box)!.hidden).toBe(true);
        f.set('sakai');
        expect(faceEl(box)!.dataset.artId).toBe(ART_IDS.faceSakai);
        f.dispose();
    });

    it('読み込み中に話し手が変わった：読めた顔が今の行の人でなければ出さない', async () => {
        art();
        const box = installDom();
        const f = make(box);
        f.start();
        f.set('tadakatsu');
        f.set('oda_envoy');
        await flush();
        expect(box.classes.has('has-face')).toBe(true);
        expect(faceEl(box)!.hidden).toBe(true);
        f.dispose();
    });

    it('一部の顔だけ読めない：空きは取り、読めない人の行は空きだけ', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        art({ fail: ['sakai'] });
        const box = installDom();
        const f = make(box);
        f.start();
        await flush();
        f.set('sakai');
        expect(faceEl(box)!.hidden).toBe(true);
        f.set('ishikawa');
        expect(faceEl(box)!.dataset.artId).toBe(ART_IDS.faceIshikawa);
        expect(faceEl(box)!.hidden).toBe(false);
        f.dispose();
    });

    it('描く細かさ：端末の比 2 まで（72 → 144 画素・スマホ横 52 → 104）。大きさが変われば（向きの変更）描き直す', async () => {
        art();
        await loadArt(ART_IDS.faceTadakatsu);
        for (const [dpr, css, px] of [
            [1, 72, 72],
            [2, 72, 144],
            [3, 72, 144],
            [2, 52, 104],
            [3, 52, 104],
        ] as const) {
            const box = installDom({ dpr, faceCss: css });
            const f = make(box);
            f.start();
            f.set('tadakatsu');
            const c = faceEl(box)!;
            expect([dpr, css, c.width, c.height]).toEqual([dpr, css, px, px]);
            expect(c.ctx!.draws().pop()!.args.slice(5)).toEqual([0, 0, css, css]);
            f.dispose();
        }
        // PC → スマホ横（CSS の大きさ 72 → 52）：描き直す
        const box = installDom({ dpr: 2, faceCss: 72 });
        const f = make(box);
        f.start();
        f.set('tadakatsu');
        const c = faceEl(box)!;
        expect(c.width).toBe(144);
        c.cssSize = DIALOG_FACE_PX.phone;
        resize();
        expect(c.width).toBe(104);
        expect(c.ctx!.draws()).toHaveLength(2);
        f.dispose();
    });

    it('人物画が出ている人の行は顔を出さない（人物画が下がれば顔を出す）。絵の無い人の行は、前の人の人物画が暗く残っていても顔を出す', async () => {
        art({ assets: { ...FACES, [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 745, h: 1453, kind: 'portrait' } } });
        for (const id of Object.keys(FACES)) await loadArt(id as ArtId);
        const portraitOf = (sp: string): ArtId | null => (sp === 'tadakatsu' ? ART_IDS.portraitTadakatsu : null);
        const box = installDom();
        const f = make(box, COUNCIL_SPEAKERS, portraitOf);
        f.start();
        f.set('tadakatsu');
        expect(faceEl(box)!.hidden).toBe(false);
        // 人物画が出た（PortraitSlot.onShown）：同じ人の顔は下げる。空きはそのまま
        f.portrait(ART_IDS.portraitTadakatsu);
        expect(faceEl(box)!.hidden).toBe(true);
        expect(box.classes.has('has-face')).toBe(true);
        // 次は酒井（人物画は無い。忠勝の人物画が暗く残る）：酒井の顔
        f.set('sakai');
        expect(faceEl(box)!.dataset.artId).toBe(ART_IDS.faceSakai);
        expect(faceEl(box)!.hidden).toBe(false);
        f.set('tadakatsu');
        expect(faceEl(box)!.hidden).toBe(true);
        // 人物画が下がった（狭い画面・地の文）：顔を出す
        f.portrait(null);
        expect(faceEl(box)!.hidden).toBe(false);
        expect(faceEl(box)!.dataset.artId).toBe(ART_IDS.faceTadakatsu);
        f.dispose();
    });

    it('PortraitSlot の onShown：人物画を出した・下げた時に知らせる（同じ値は知らせ直さない）', async () => {
        art({ assets: { [ART_IDS.portraitTadakatsu]: { file: 'art/portraits/tadakatsu.webp', w: 745, h: 1453, kind: 'portrait' } } });
        const box = installDom();
        const layer = new FakeEl('div');
        layer.rect = { left: 0, top: 0, width: 1280, height: 720 };
        const choices = new FakeEl('div');
        choices.className = 'g-choices';
        choices.hidden = true;
        box.rect = { left: 250, top: 614, width: 780, height: 92 };
        layer.append(choices, box);
        const p = new PortraitSlot(
            layer as unknown as HTMLElement,
            choices as unknown as HTMLElement,
            box as unknown as HTMLElement,
            (sp) => (sp === 'tadakatsu' ? ART_IDS.portraitTadakatsu : null),
            () => true,
            () => [],
        );
        const told: (ArtId | null)[] = [];
        p.onShown = (id) => told.push(id);
        p.set('tadakatsu');
        await flush();
        p.set('sakai');
        p.set('narration');
        p.set('narration');
        expect(told).toEqual([ART_IDS.portraitTadakatsu, null]);
        p.dispose();
    });

    it('後片付け：窓の見張りを外す。片付けの後に読めた顔では何も作らない', async () => {
        art();
        const box = installDom();
        const f = make(box);
        f.start();
        f.dispose();
        await flush();
        expect(box.tree()).toEqual(V21_TREE);
        expect(listenerCount()).toBe(0);
        // 空きを取った後の片付け
        const box2 = installDom();
        const f2 = make(box2);
        f2.start();
        f2.set('hero');
        expect(listenerCount()).toBeGreaterThan(0);
        f2.dispose();
        expect(listenerCount()).toBe(0);
        f2.set('tadakatsu');
        expect(faceEl(box2)!.dataset.artId).toBe(ART_IDS.faceIeyasu);
    });
});
