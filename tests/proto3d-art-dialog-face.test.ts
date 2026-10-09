/**
 * 台詞の枠の顔（Version 22・23。ui/artCanvas.ts の DialogFace・dialogFaceIds・dialogFaceFor・faceClear・artInUse）と、歴史分岐の話し手 → 顔（ieyasuFaceOf）。
 * Node には DOM が無いので、部品が使う所だけの小さな偽の DOM（台詞の枠・canvas・窓の見張り）で確かめる。
 * - 旧表示（?art=old）・素材の一覧が空・顔の無い台本・どの顔も読めない：枠に何も足さない（class も要素も無い＝Version 21 と同じ枠）。
 * - 読めている顔があれば、開いた同じフレームのうちに左の空き（has-face）と canvas.g-face を作り、台本の終わりまで空きは取ったまま。
 * - 行の話し手の顔だけを出す。顔の無い行（地の文・使者・村の使い・高札）は空きだけ。人物画が出ている人の行は顔を出さない。
 * - 描く細かさは端末の比 2 まで（元の 256 画素より細かくしない）。左右の反転はしない。後片付けで見張りを外す。
 * - 狭い画面で枠の上へはみ出した顔が選択肢などに届く行：名前の行の高さに縮め（compact）、それでも重なれば出さない（Version 23）。
 * - CSS（ui.css）：顔のために台詞の字・字の間・行の高さ・上下の余白を変えない。狭い画面の顔の下端は台詞の 1 行目より上（Version 23）。
 * 本物の画面での位置・大きさ・重なりの確かめは開発サーバー（本物の顔の素材）で行う。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_IDS, FACE_OF, type ArtId } from '../proto3d/src/art/ids';
import { __setArtManifestForTest } from '../proto3d/src/art/registry';
import { AI_ART_NOTE, DIALOG_FACE_PX, DialogFace, PortraitSlot, __clearArtReadyForTest, artInUse, dialogFaceFor, dialogFaceIds, faceClear, loadArt } from '../proto3d/src/ui/artCanvas';
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
    /** 四角を class などで変えたいとき（狭い画面の顔：いつもの大きさ・縮めた大きさ） */
    rectFn: (() => { left: number; top: number; width: number; height: number }) | null = null;
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
        const r = (this.hidden ? null : this.rectFn?.()) ?? this.rect ?? { left: 0, top: 0, width: this.hidden ? 0 : this.cssSize, height: this.hidden ? 0 : this.cssSize };
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

/** 偽の DOM を置く。faceCss は CSS が決める顔の大きさ（PC 72・スマホ横 44）。faceRect は顔の canvas の四角（class で変えるとき） */
function installDom(o: { dpr?: number; faceCss?: number; faceRect?: (c: FakeEl) => { left: number; top: number; width: number; height: number } } = {}) {
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
            if (tag === 'canvas') {
                e.cssSize = o.faceCss ?? 72;
                if (o.faceRect) e.rectFn = () => o.faceRect!(e);
            }
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

    it('描く細かさ：端末の比 2 まで（72 → 144 画素・タブレットの縦 52 → 104・スマホ横 44 → 88・スマホの縦 36 → 72）。大きさが変われば（向きの変更）描き直す', async () => {
        art();
        await loadArt(ART_IDS.faceTadakatsu);
        for (const [dpr, css, px] of [
            [1, 72, 72],
            [2, 72, 144],
            [3, 72, 144],
            [2, 52, 104],
            [3, 52, 104],
            [2, 44, 88],
            [3, 44, 88],
            [2, 36, 72],
            [1, 36, 36],
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
        // PC → スマホ横（CSS の大きさ 72 → 44）：描き直す
        const box = installDom({ dpr: 2, faceCss: 72 });
        const f = make(box);
        f.start();
        f.set('tadakatsu');
        const c = faceEl(box)!;
        expect(c.width).toBe(144);
        c.cssSize = DIALOG_FACE_PX.phone;
        resize();
        expect(c.width).toBe(88);
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

    it('faceClear：画面の中で、避ける物のどれとも重ならない（0.5px までの接しは許す。view が null なら画面の端は見ない）', () => {
        const face = { left: 49, top: 274, right: 93, bottom: 318 };
        expect(faceClear(face, [], { w: 844, h: 390 })).toBe(true);
        expect(faceClear(face, [{ left: 272, top: 100, right: 812, bottom: 280 }], { w: 844, h: 390 })).toBe(true);
        expect(faceClear(face, [{ left: 14, top: 100, right: 554, bottom: 280 }], { w: 844, h: 390 })).toBe(false);
        expect(faceClear(face, [{ left: 14, top: 100, right: 554, bottom: 274.4 }], { w: 844, h: 390 })).toBe(true);
        expect(faceClear(face, [{ left: 93.4, top: 100, right: 554, bottom: 380 }], { w: 844, h: 390 })).toBe(true);
        expect(faceClear({ ...face, top: -6, bottom: 38 }, [], { w: 844, h: 390 })).toBe(false);
        expect(faceClear({ ...face, left: 820, right: 864 }, [], { w: 844, h: 390 })).toBe(false);
        expect(faceClear({ ...face, top: -6, bottom: 38 }, [], null)).toBe(true);
    });

    it('狭い画面で枠の上へはみ出した顔が選択肢に届く行：名前の行の高さに縮める（compact）。縮めても重なれば出さない（空きはそのまま）。選択肢が下がれば戻す', async () => {
        art();
        for (const id of Object.keys(FACES)) await loadArt(id as ArtId);
        // 568×320 の枠（左 14・上 213）：顔 36px は上へ 10px はみ出す（上 203）。縮めた顔（25px）は枠の中（上 214）
        const box = installDom({ dpr: 2, faceRect: (c) => (c.classes.has('compact') ? { left: 31, top: 214, width: 25, height: 25 } : { left: 31, top: 203, width: 36, height: 36 }) });
        const choices = new FakeEl('div');
        choices.className = 'g-choices';
        choices.hidden = true;
        const head = new FakeEl('div');
        head.rect = { left: 190, top: 18, width: 188, height: 60 };
        const avoided: unknown[] = [];
        const f = new DialogFace(box as unknown as HTMLElement, COUNCIL_SPEAKERS, faceOf, null, null, () => {
            avoided.push(1);
            return [choices as unknown as Element, head as unknown as Element, null];
        });
        f.start();
        f.set('tadakatsu');
        const c = faceEl(box)!;
        const state = () => [c.hidden, c.classes.has('compact'), c.dataset.blocked ?? null, c.hidden ? null : c.width];
        expect(state()).toEqual([false, false, null, 72]);
        expect(avoided.length).toBeGreaterThan(0);
        // 選択肢が出た：下の端（209）が顔の上の方（203）に届く。縮めた顔（214〜）には届かない
        choices.hidden = false;
        choices.rect = { left: 14, top: 40, width: 540, height: 169 };
        f.set('hero');
        expect(state()).toEqual([false, true, null, 50]);
        expect(c.dataset.artId).toBe(ART_IDS.faceIeyasu);
        // 選択肢が枠の中まで来る（Version 21 の枠がもう選択肢に重なっている所）：縮めても重なる → この行は出さない。空きはそのまま
        choices.rect = { left: 14, top: 40, width: 540, height: 190 };
        f.set('tadakatsu');
        expect(state()).toEqual([true, false, '1', null]);
        expect(box.classes.has('has-face')).toBe(true);
        expect(box.tree()).toEqual(['canvas.g-face[hidden]', ...V21_TREE]);
        // 選択肢が下がった（次の台本の行）：いつもの大きさに戻す
        choices.hidden = true;
        f.set('sakai');
        expect(state()).toEqual([false, false, null, 72]);
        expect(c.dataset.artId).toBe(ART_IDS.faceSakai);
        // 顔の無い行：縮め・重なりの印は残さない
        choices.hidden = false;
        choices.rect = { left: 14, top: 40, width: 540, height: 190 };
        f.set('tadakatsu');
        f.set('narration');
        expect(state()).toEqual([true, false, null, null]);
        f.dispose();
    });

    it('画面の外へ出る顔（低い画面で枠が高い）も縮め、それでも出るなら出さない。窓の大きさが変われば測り直す', async () => {
        art();
        await loadArt(ART_IDS.faceTadakatsu);
        vi.stubGlobal('innerWidth', 568);
        vi.stubGlobal('innerHeight', 320);
        let top = -6;
        const box = installDom({ dpr: 2, faceRect: (c) => (c.classes.has('compact') ? { left: 31, top: top + 11, width: 25, height: 25 } : { left: 31, top, width: 36, height: 36 }) });
        const f = new DialogFace(box as unknown as HTMLElement, ['tadakatsu'], faceOf, null, null, () => []);
        f.start();
        f.set('tadakatsu');
        const c = faceEl(box)!;
        expect([c.hidden, c.classes.has('compact')]).toEqual([false, true]);
        top = -20;
        resize();
        expect([c.hidden, c.dataset.blocked]).toEqual([true, '1']);
        top = 150;
        resize();
        expect([c.hidden, c.classes.has('compact'), c.dataset.blocked ?? null]).toEqual([false, false, null]);
        f.dispose();
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

describe('台詞の枠の顔の CSS（Version 23）：どの大きさでも台詞の字・幅・余白は Version 21 のまま。PC は枠の左の中、狭い・低い画面は枠の左上の角', () => {
    // テストは Node で動く。Node の型定義は入れていないので、使う関数だけ型を付ける
    const fsName = 'node:fs';
    type Rule = { media: string; sel: string; body: string };
    async function rules(): Promise<Rule[]> {
        const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: URL, enc: 'utf8'): string };
        const css = fs.readFileSync(new URL('../proto3d/src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const out: Rule[] = [];
        const re = /@media([^{]+)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(css))) {
            if (m[1] !== undefined) {
                const inner = /([^{}]+)\{([^{}]*)\}/g;
                let n: RegExpExecArray | null;
                while ((n = inner.exec(m[2]))) out.push({ media: m[1].trim(), sel: n[1].trim().replace(/\s+/g, ' '), body: n[2] });
            } else out.push({ media: '', sel: m[3].trim().replace(/\s+/g, ' '), body: m[4] });
        }
        return out;
    }
    const prop = (body: string, name: string): string | null => {
        const m = new RegExp(`(?:^|;)\\s*${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(body);
        return m ? m[1].trim() : null;
    };
    const px = (v: string | null) => parseFloat(v ?? 'NaN');
    const get = (all: Rule[], media: string, sel: string) => {
        const r = all.find((x) => x.media === media && x.sel.split(',').map((y) => y.trim()).includes(sel));
        if (!r) throw new Error(`no rule ${media} ${sel}`);
        return r;
    };
    const LOW = '(max-height: 430px)';
    const PC = '(min-height: 430.02px) and (min-width: 967.02px)';
    const FACE_SELS = ['.g-dialog.has-face', '.g-dialog.has-face .name', '.g-dialog .g-face', '.g-dialog .g-face[hidden]', '.g-dialog .g-face.compact'];

    it('顔の決まりは顔のある枠（has-face）と顔の canvas だけに掛かる（旧表示・顔の無い枠は Version 21 のまま）。台詞の字・字の間・行の高さ・上下の余白・枠の高さは変えない', async () => {
        const all = await rules();
        const face = all.filter((r) => /has-face|g-face/.test(r.sel));
        expect(face.length).toBeGreaterThanOrEqual(9);
        for (const r of face) for (const sel of r.sel.split(',').map((x) => x.trim())) expect(FACE_SELS).toContain(sel);
        for (const r of face.filter((x) => x.sel.includes('has-face'))) {
            for (const n of ['font-size', 'letter-spacing', 'line-height', 'padding', 'padding-top', 'padding-bottom', 'min-height', 'height', 'bottom']) expect(prop(r.body, n), `${r.media} ${r.sel} ${n}`).toBeNull();
        }
        // Version 21 の台詞の字（PC・縦に長い画面 16px、高さ 430 以下 15px。字の間 0.03em）
        expect(prop(get(all, '', '.g-dialog .text').body, 'font-size')).toBe('16px');
        expect(prop(get(all, '', '.g-dialog .text').body, 'letter-spacing')).toBe('0.03em');
        expect(prop(get(all, LOW, '.g-dialog .text').body, 'font-size')).toBe('15px');
    });

    it('顔の大きさ：PC 72（枠の左の中）・タブレットの縦 52・スマホ横 44・スマホの縦（幅 540 まで）と幅 640 までのスマホ横 36（枠の左上の角）', async () => {
        const all = await rules();
        const size = (media: string) => prop(get(all, media, '.g-dialog.has-face').body, '--g-face');
        expect(size('')).toBe(`${DIALOG_FACE_PX.tablet}px`);
        expect(size('(max-width: 540px)')).toBe(`${DIALOG_FACE_PX.small}px`);
        expect(size(LOW)).toBe(`${DIALOG_FACE_PX.phone}px`);
        expect(size('(max-height: 430px) and (max-width: 640px)')).toBe(`${DIALOG_FACE_PX.small}px`);
        expect(size(PC)).toBe(`${DIALOG_FACE_PX.pc}px`);
        // PC だけ枠の左の中（上下の真ん中）。縮めた顔（compact）も PC では同じ大きさ
        const pcFace = get(all, PC, '.g-dialog .g-face.compact');
        expect(prop(pcFace.body, 'top')).toBe('50%');
        expect(prop(pcFace.body, 'width')).toBe('var(--g-face)');
        expect(prop(get(all, PC, '.g-dialog.has-face .name').body, 'margin-left')).toBe('0');
        // PC の枠を左へ広げる幅（顔の空き − 元の左の余白 18px）が、幅 968px 以上で右の端を動かさずに取れる（.g-dialog.has-face の width の式と同じ）
        const pc = get(all, PC, '.g-dialog.has-face');
        const extra = px(prop(pc.body, '--g-face-x')) + px(prop(pc.body, '--g-face')) + px(prop(pc.body, '--g-face-gap')) - px(prop(pc.body, '--g-pad-l'));
        const fits = (w: number) => w / 2 - 14 - extra >= Math.min(w - 28, 780) / 2 - 0.01;
        expect(fits(968)).toBe(true);
        expect(fits(967)).toBe(false);
    });

    it('狭い・低い画面の顔：左端は台詞の始まり、下端は名前の行の下〜台詞の 1 行目の上（Version 21 の余白・名前の字・台詞の上の間から）。名前は顔の右', async () => {
        const all = await rules();
        const nameMin = px(prop(get(all, '', '.g-dialog .name').body, 'font-size'));
        expect(prop(get(all, '', '.g-dialog .name').body, 'min-height')).toBe('1em');
        const textGap = px(prop(get(all, '', '.g-dialog .text').body, 'margin-top'));
        for (const media of ['', LOW]) {
            const [padTop, padLeft] = prop(get(all, media, '.g-dialog').body, 'padding')!.split(/\s+/).map((v) => px(v));
            const face = get(all, media, '.g-dialog.has-face').body;
            const bottom = px(prop(face, '--g-face-bottom'));
            expect(bottom, media).toBeGreaterThanOrEqual(padTop + nameMin);
            expect(bottom, media).toBeLessThan(padTop + nameMin + textGap);
            expect(px(prop(face, '--g-face-left')), media).toBe(padLeft);
        }
        const canvas = get(all, '', '.g-dialog .g-face').body;
        expect(prop(canvas, 'left')).toBe('var(--g-face-left)');
        expect(prop(canvas, 'top')).toBe('calc(var(--g-face-bottom) - var(--g-face))');
        expect(prop(get(all, '', '.g-dialog.has-face .name').body, 'margin-left')).toBe('calc(var(--g-face) + var(--g-face-gap))');
        // 縮めた顔：枠の上の内側から名前の行の下まで（はみ出さない）
        const compact = get(all, '', '.g-dialog .g-face.compact').body;
        expect([prop(compact, 'top'), prop(compact, 'width'), prop(compact, 'height')]).toEqual(['0', 'var(--g-face-bottom)', 'var(--g-face-bottom)']);
    });

    it('はみ出しが選択肢に届かない所：1 行の台詞の枠の上と選択肢の間に収まるか、選択肢が左の顔の上まで来ない（届く行は DialogFace が縮める）', async () => {
        const all = await rules();
        const bottomOf = (media: string, sel: string) => px(/\+\s*([\d.]+)px/.exec(prop(get(all, media, sel).body, 'bottom') ?? '')?.[1] ?? null);
        const minH = (media: string) => px(prop(get(all, media, '.g-dialog').body, 'min-height'));
        const face = (media: string, n: string) => px(prop(get(all, media, '.g-dialog.has-face').body, n));
        const dialogBottom = bottomOf('', '.g-dialog');
        // スマホ横の幅 640 まで（軍議の方針の選択肢は幅いっぱい）：はみ出し 36 − 25 − 縁 1 = 10 < 110 − 14 − 84 = 12
        const lowGap = bottomOf(LOW, '.g-choices') - dialogBottom - minH(LOW);
        expect(face('(max-height: 430px) and (max-width: 640px)', '--g-face') - face(LOW, '--g-face-bottom') - 1).toBeLessThan(lowGap);
        // スマホの縦（幅 540 まで。選択肢は幅いっぱい）：36 − 28 − 1 = 7 < 122 − 14 − 92 = 16
        const tallGap = bottomOf('', '.g-choices') - dialogBottom - minH('');
        expect(face('(max-width: 540px)', '--g-face') - face('', '--g-face-bottom') - 1).toBeLessThan(tallGap);
        // それより広い所：選択肢（右寄せ。会話 420px・高さ 430 以下の要点つき 540px）の左端は、顔の右端より右
        const faceRight = (vw: number, low: boolean, safeL = 0) => Math.max(14 + safeL, (vw - Math.min(vw - 28 - 2 * safeL, 780)) / 2) + 1 + (low ? 16 : 18) + (low ? 44 : 52);
        const choicesLeft = (vw: number, width: number, safeR = 0) => vw - Math.max(vw / 2 - 390, safeR + 14) - Math.min(vw - 28, width);
        for (let vw = 641; vw <= 1400; vw++) {
            expect(choicesLeft(vw, 540), `low ${vw}`).toBeGreaterThan(faceRight(vw, true));
            expect(choicesLeft(vw, 420), `low ${vw}`).toBeGreaterThan(faceRight(vw, true));
        }
        for (let vw = 812; vw <= 932; vw++) expect(choicesLeft(vw, 540, 47), `notch ${vw}`).toBeGreaterThan(faceRight(vw, true, 47));
        for (let vw = 541; vw <= 967; vw++) expect(choicesLeft(vw, 420), `tall ${vw}`).toBeGreaterThan(faceRight(vw, false));
    });
});

describe('公開の素材の一覧（manifest.gen.json）は武将 6 人の顔と、大平原の地面の 3 枚（Version 23 から）だけ', () => {
    it('人物画・軍議の背景・林床は入れていない（人物画・背景は新しい原画の到着待ち、林床は不採用）。顔の画像は art/faces/、地面は art/battle/ の WebP', () => {
        const assets = (generated as { assets: Record<string, { file: string; kind?: string }> }).assets;
        const faces = ['face.ieyasu', 'face.ishikawa', 'face.nagamasa', 'face.sakai', 'face.sakakibara', 'face.tadakatsu'];
        const ground = ['tex.plains.dirt', 'tex.plains.grass', 'tex.plains.road'];
        expect(Object.keys(assets).sort()).toEqual([...faces, ...ground].sort());
        for (const id of faces) expect(assets[id].file, id).toBe(`art/faces/${id.slice(5)}.webp`);
        for (const id of ground) expect(assets[id].file, id).toBe(`art/battle/${id.slice(4).replace('.', '_')}.webp`);
        expect(Object.keys(assets).some((id) => /^(portrait|bg)\.|forest/.test(id))).toBe(false);
    });
});
