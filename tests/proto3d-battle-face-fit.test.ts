/**
 * 合戦の部隊の札の見出しの顔（battle/faceArt.ts の fitFaceBeforeName）：部隊の名前が切れるなら細い顔、それでも切れるなら顔を出さない。
 * 名前を Version 21（顔なし）より短く切らない（顔を出さなくても切れる＝状態の印で Version 21 でも切れていた時は、顔を出さない＝同じ並び）。
 * 札の見出しの並びを、測る口（document.createRange・getBoundingClientRect）の偽物で表す（DOM は使わない）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../proto3d/src/art/registry', () => ({ artMode: () => 'new', loadArtBitmap: () => Promise.resolve(null) }));

/** 札の見出し：名前に使える幅は avail − 顔の分（full 18 px・narrow 8 px・off 0 px）。名前の文字の幅は text */
function fakeHead(avail: number, text: number) {
    const classes = new Set<string>();
    const face = {
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            contains: (c: string) => classes.has(c),
        },
    };
    const used = () => (classes.has('b-face-off') ? 0 : classes.has('b-face-narrow') ? 8 : 18);
    const name = { text, getBoundingClientRect: () => ({ width: Math.min(text, avail - used()) }) };
    return { face: face as unknown as HTMLElement, name: name as unknown as HTMLElement, classes, set text(v: number) { name.text = v; } };
}

const g = globalThis as unknown as { document?: unknown };
afterEach(() => {
    delete g.document;
});
function withRange() {
    g.document = {
        createRange: () => {
            let node: { text: number } | null = null;
            return { selectNodeContents: (n: { text: number }) => (node = n), getBoundingClientRect: () => ({ width: node!.text }) };
        },
    };
}

describe('札の見出しの顔：名前を Version 21 より短く切らない', () => {
    it('顔があっても名前が収まる：今の大きさ（印なし）', async () => {
        withRange();
        const { fitFaceBeforeName } = await import('../proto3d/src/battle/faceArt');
        const h = fakeHead(80, 57.5);
        expect(fitFaceBeforeName(h.face, h.name)).toBe('full');
        expect([...h.classes]).toEqual([]);
    });
    it('今の大きさでは切れ、細い顔なら収まる（小さな札の騎馬の榊原康政隊）：細い顔', async () => {
        withRange();
        const { fitFaceBeforeName } = await import('../proto3d/src/battle/faceArt');
        const h = fakeHead(68, 57.5);
        expect(fitFaceBeforeName(h.face, h.name)).toBe('narrow');
        expect([...h.classes]).toEqual(['b-face-narrow']);
    });
    it('細い顔でも切れる：顔を出さない（Version 21 と同じ並び）。顔なしでも切れる（状態の印）時も出さない', async () => {
        withRange();
        const { fitFaceBeforeName } = await import('../proto3d/src/battle/faceArt');
        const h = fakeHead(62, 57.5);
        expect(fitFaceBeforeName(h.face, h.name)).toBe('off');
        expect([...h.classes]).toEqual(['b-face-off']);
        const v21cut = fakeHead(41, 57.5);
        expect(fitFaceBeforeName(v21cut.face, v21cut.name)).toBe('off');
        expect([...v21cut.classes]).toEqual(['b-face-off']);
    });
    it('測り直すと前の決め方を残さない（状態の印が消えたら、また今の大きさの顔）', async () => {
        withRange();
        const { fitFaceBeforeName } = await import('../proto3d/src/battle/faceArt');
        const h = fakeHead(62, 57.5);
        expect(fitFaceBeforeName(h.face, h.name)).toBe('off');
        h.text = 40;
        expect(fitFaceBeforeName(h.face, h.name)).toBe('full');
        expect([...h.classes]).toEqual([]);
        h.text = 52;
        expect(fitFaceBeforeName(h.face, h.name)).toBe('narrow');
        expect([...h.classes]).toEqual(['b-face-narrow']);
    });
});

/** 発動の知らせ（真ん中そろえ）：Version 21 の大きさ 228 px、顔 34 px＋すき間 9 px を足すと 271 px。上の端 60・高さ 45 */
function fakeNote(withFace: boolean) {
    const cx = 640;
    const textW = 228;
    const state = { face: withFace, classes: new Set(withFace ? ['with-face'] : []) };
    const w = () => textW + (state.face ? 43 : 0);
    const rect = (l: number, r: number) => ({ left: l, right: r, top: 60, bottom: 105, width: r - l, height: 45 });
    const note = () => rect(cx - w() / 2, cx + w() / 2);
    const faceEl = {
        getBoundingClientRect: () => rect(note().left + 16, note().left + 16 + 34),
        remove: () => (state.face = false),
    };
    const title = { getBoundingClientRect: () => rect(note().left + 16 + (state.face ? 43 : 0), note().left + 16 + (state.face ? 43 : 0) + 180) };
    const el = {
        getBoundingClientRect: note,
        querySelector: (q: string) => (q === ':scope > .b-face' ? (state.face ? faceEl : null) : q === ':scope > b' ? title : null),
        classList: { remove: (c: string) => state.classes.delete(c) },
    };
    return { el, state };
}

describe('発動の知らせの顔は、知らせの畳み方（名札を覆う時に畳む）を変えない', () => {
    type Box = { l: number; t: number; r: number; b: number };
    async function run(withFace: boolean, labels: Box[], fold = 0) {
        const { BattleUi } = await import('../proto3d/src/battle/battleUi');
        const n = fakeNote(withFace);
        let cur: Box | null = null;
        const addBox = (q: Box) => {
            cur = cur ? { l: Math.min(cur.l, q.l), t: Math.min(cur.t, q.t), r: Math.max(cur.r, q.r), b: Math.max(cur.b, q.b) } : q;
        };
        const add = (e: { getBoundingClientRect(): { left: number; top: number; right: number; bottom: number } }) => {
            const r = e.getBoundingClientRect();
            addBox({ l: r.left, t: r.top, r: r.right, b: r.bottom });
        };
        const hits = (b: Box | null) => !!b && labels.some((r) => r.l < b.r && r.r > b.l && r.t < b.b && r.b > b.t);
        const self = { abNote: n.el, noticeFold: fold };
        (BattleUi.prototype as unknown as { addNoteBox: (...a: unknown[]) => void }).addNoteBox.call(self, add, addBox, hits);
        return { box: cur as Box | null, hit: hits(cur), face: n.state.face, withFace: n.state.classes.has('with-face') };
    }
    it('名札にかからない：顔は残し、数える四角は顔の無い知らせと同じ', async () => {
        const plain = await run(false, []);
        const face = await run(true, []);
        expect(face.face).toBe(true);
        expect(face.box).toEqual(plain.box);
        expect(face.box).toEqual({ l: 526, t: 60, r: 754, b: 105 });
    });
    it('顔を足した分だけが名札にかかる：この知らせの顔を外す（畳まない＝Version 21 と同じ）', async () => {
        const label = { l: 745, t: 80, r: 820, b: 95 }; // 顔なしの右の端 754 の外・顔ありの右の端 775.5 の内
        const label2 = { l: 760, t: 80, r: 820, b: 95 };
        const plain = await run(false, [label2]);
        const face = await run(true, [label2]);
        expect(plain.hit).toBe(false);
        expect(face.hit).toBe(false);
        expect(face.face).toBe(false);
        expect(face.withFace).toBe(false);
        expect(face.box).toEqual(plain.box);
        // 顔の無い知らせでもかかる名札：畳むのは Version 21 と同じ（顔は外さず、畳む 1 段目で CSS が隠す）
        const both = await run(true, [label]);
        expect(both.hit).toBe(true);
        expect((await run(false, [label])).hit).toBe(true);
        expect(both.face).toBe(true);
    });
});

/**
 * 発動の知らせ（abilityNotice）：顔とすき間の分だけ文字の幅が狭くなり、折り返しが増えて知らせが高くなる（縦の狭いスマホの細い列）なら
 * 顔を置かない。高さは畳まない時の見せ方で比べる（畳んでいる間も）。比べた後は畳み方を元に戻す
 */
function fakeAbNote(opts: { grows: boolean; fold?: string }) {
    const classes = new Set<string>();
    const st = { attached: false, html: '', measuredFold: [] as (string | undefined)[] };
    const topmid = { dataset: {} as Record<string, string> };
    if (opts.fold) topmid.dataset.fold = opts.fold;
    const face = { remove: () => (st.attached = false) };
    const e = {
        dataset: {} as Record<string, string>,
        hidden: true,
        set innerHTML(v: string) {
            st.html = v;
            st.attached = false;
        },
        get innerHTML() {
            return st.html;
        },
        classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
        prepend: (f: unknown) => {
            if (f === face) st.attached = true;
        },
        getBoundingClientRect: () => {
            st.measuredFold.push(topmid.dataset.fold);
            // 畳んだ時は見出しだけ（顔は CSS で隠れて Version 21 と同じ 25 px）。畳まない時は 2 行の 45 px、顔で折り返しが増えれば 60 px
            const h = topmid.dataset.fold ? 25 : st.attached && classes.has('with-face') && opts.grows ? 60 : 45;
            return { left: 0, top: 0, right: 100, bottom: h, width: 100, height: h };
        },
    };
    return { e, face, topmid, classes, st };
}

describe('発動の知らせの顔で知らせを Version 21 より高くしない', () => {
    async function run(opts: { grows: boolean; fold?: string }) {
        const w = globalThis as unknown as { window?: unknown };
        w.window = { setTimeout: () => 1, clearTimeout: () => {} };
        try {
            const { BattleUi } = await import('../proto3d/src/battle/battleUi');
            const n = fakeAbNote(opts);
            const self = { abNote: n.e, topmid: n.topmid, abNoteTimer: 0, timers: new Set<number>(), faceEl: () => n.face };
            (BattleUi.prototype as unknown as { abilityNotice: (...a: unknown[]) => void }).abilityNotice.call(self, 'use', '譜代の結束', '徳川家康隊（35 秒）', 2500, 'ieyasu');
            return n;
        } finally {
            delete w.window;
        }
    }
    it('顔を足しても高さが同じ（PC の広い列）：顔を置く', async () => {
        const n = await run({ grows: false });
        expect(n.st.attached).toBe(true);
        expect(n.classes.has('with-face')).toBe(true);
        expect(n.e.hidden).toBe(false);
    });
    it('顔で折り返しが増えて高くなる（667×375 の 103 px の列）：顔を置かない（Version 21 と同じ知らせ）', async () => {
        const n = await run({ grows: true });
        expect(n.st.attached).toBe(false);
        expect(n.classes.has('with-face')).toBe(false);
        expect(n.e.hidden).toBe(false);
    });
    it('畳んでいる間も、畳まない時の高さで比べる（畳み方は元に戻す）', async () => {
        const n = await run({ grows: true, fold: '1' });
        expect(n.st.measuredFold.length).toBeGreaterThanOrEqual(2);
        expect(n.st.measuredFold.every((f) => f === undefined)).toBe(true);
        expect(n.st.attached).toBe(false);
        expect(n.topmid.dataset.fold).toBe('1');
        const k = await run({ grows: false, fold: '2' });
        expect(k.st.attached).toBe(true);
        expect(k.topmid.dataset.fold).toBe('2');
    });
});

describe('札の顔は、窓の高さの境（520 px）を越えて札の高さだけが変わった時も測り直す', () => {
    it('小さな札（幅 114 px のまま）：高さが変わると測り直し、名前が切れるなら細い顔にする', async () => {
        withRange();
        const { BattleUi } = await import('../proto3d/src/battle/battleUi');
        // 縦の狭い画面（札の高さ 64 px・字 11.5 px）では名前が顔と並んで収まる。広い画面（86 px・字 12 px）では名前の字が広く、今の顔では切れる
        // 名前の枠は 60 px − 顔の分。名前の文字の幅は h.text
        const h = fakeHead(60, 100);
        h.text = 40;
        const root = { clientWidth: 114, clientHeight: 64, dataset: {} as Record<string, string> };
        const c = { face: h.face, name: h.name, root, kind: { textContent: '本陣' }, badge: { textContent: '' }, faceSig: '' };
        const self = { cards: new Map([['a_ieyasu', c]]) };
        const fit = (BattleUi.prototype as unknown as { fitCardFaces: () => void }).fitCardFaces;
        fit.call(self);
        expect(root.dataset.face).toBe('full');
        // 窓を 1000×500 → 1000×640 にした：札の幅は同じ 114 px、高さと字の大きさだけが変わる
        h.text = 48;
        root.clientHeight = 86;
        fit.call(self);
        expect(root.dataset.face).toBe('narrow');
        // 同じ大きさのままなら測り直さない（毎フレーム文字の幅を測らない）
        h.text = 30;
        fit.call(self);
        expect(root.dataset.face).toBe('narrow');
    });
});
