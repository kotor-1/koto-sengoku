/**
 * 演習の編成の表の「率いる武将」（Version 23。ui/practiceView.ts と battle/faceArt.ts の faceSlot）：
 * - 素材を使う表示：顔（その武将の顔だけ。data-art-id は face.<武将の id>）・名前・役割（generals.ts の GENERAL_ROLE_LABELS）。
 *   顔はまだ読めていなくても先に場所（空の canvas.b-face-wait）を取り、読めたら描いて data-art-id を付ける。読めなければ場所ごと外し、名前・役割の文字は残る。
 * - 旧表示（?art=old）：Version 21 と同じ（名前の文字だけ。顔の場所・役割・class を足さない）。
 * - 率いる武将のいない部隊（弓隊・騎馬隊）は「—」だけ（顔・役割なし）。
 * Node には DOM が無いので、表を作る所が使う所だけの小さな偽の DOM で確かめる。本物の画面での大きさ・並びは開発サーバーで確かめる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const art = vi.hoisted(() => ({ mode: 'new' as 'new' | 'v24' | 'old', fail: new Set<string>(), loads: [] as string[], resolvers: [] as (() => void)[], hold: false }));
vi.mock('../proto3d/src/art/registry', async () => {
    // 見せ方ごとの顔の選び方は本物の対応（art/ids.ts の FACE_OF・V24_FACE_OF）で引く（art/registry.ts の faceArtIdOf と同じ）
    const ids = await import('../proto3d/src/art/ids');
    return {
        artMode: () => art.mode,
        faceArtIdOf: (g: string | null | undefined) => (!g || art.mode === 'old' ? null : ((art.mode === 'v24' ? ids.V24_FACE_OF : ids.FACE_OF) as Record<string, string | undefined>)[g] ?? null),
        loadArtBitmap: (id: string) => {
            if (art.mode === 'old') return Promise.resolve(null);
            art.loads.push(id);
            const bmp = art.fail.has(id) ? null : ({ width: 256, height: 256, id } as unknown as ImageBitmap);
            if (!art.hold) return Promise.resolve(bmp);
            return new Promise((r) => art.resolvers.push(() => r(bmp)));
        },
    };
});

import { practiceBriefingInfo } from '../proto3d/src/campaign/practice';
import { getField } from '../proto3d/src/battle/fields';
import { GENERAL_ROLE_LABELS, generalById } from '../proto3d/src/battle/generals';

// 顔の読み込みの覚え（faceArt.ts の中）をテストごとに空にする：表の部品はテストごとに読み直す
let PracticeDomView: typeof import('../proto3d/src/ui/practiceView').PracticeDomView;

class FakeEl {
    children: FakeEl[] = [];
    parentNode: FakeEl | null = null;
    readonly classes = new Set<string>();
    readonly classList = {
        add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
        remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
        contains: (c: string) => this.classes.has(c),
    };
    readonly dataset: Record<string, string> = {};
    readonly attrs = new Map<string, string>();
    draggable = true;
    width = 300;
    height = 150;
    draws = 0;
    private text = '';
    constructor(readonly tagName: string) {}
    get className() {
        return [...this.classes].join(' ');
    }
    set className(v: string) {
        this.classes.clear();
        for (const c of v.split(/\s+/)) if (c) this.classes.add(c);
    }
    get textContent(): string {
        return this.text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v: string) {
        this.children = [];
        this.text = v;
    }
    get isConnected() {
        return true;
    }
    append(...ns: (FakeEl | string)[]) {
        for (const n of ns) {
            if (typeof n === 'string') this.text += n;
            else {
                n.parentNode = this;
                this.children.push(n);
            }
        }
    }
    prepend(n: FakeEl) {
        n.parentNode = this;
        this.children.unshift(n);
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
    getContext(kind: string) {
        if (kind !== '2d' || this.tagName !== 'canvas') return null;
        return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: () => void this.draws++ };
    }
    all(pred: (e: FakeEl) => boolean): FakeEl[] {
        const out: FakeEl[] = [];
        for (const c of this.children) {
            if (pred(c)) out.push(c);
            out.push(...c.all(pred));
        }
        return out;
    }
}

beforeEach(async () => {
    vi.resetModules();
    ({ PracticeDomView } = await import('../proto3d/src/ui/practiceView'));
    art.mode = 'new';
    art.fail.clear();
    art.loads = [];
    art.resolvers = [];
    art.hold = false;
    vi.stubGlobal('document', {
        createElement: (tag: string) => new FakeEl(tag),
        createTextNode: (t: string) => t,
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

const flush = async (n = 20) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

/** 説明の表を作る（DomView.sheet の偽物が body を受け取るだけ。押しは待たない） */
function briefingTable(fieldId = 'plains') {
    let body: FakeEl | null = null;
    const view = { sheet: (o: { body: FakeEl }) => ((body = o.body), new Promise(() => {})) };
    void new PracticeDomView(view as never).practiceBriefing(practiceBriefingInfo(getField(fieldId)!));
    const rows = body!.all((e) => e.tagName === 'tr' && !!e.dataset.unit);
    return rows.map((tr) => {
        const gen = tr.children[3]!;
        const faces = gen.all((e) => e.tagName === 'canvas');
        return { tr, unit: tr.dataset.unit!, gen, faces };
    });
}

describe('演習の編成の表：率いる武将の顔・名前・役割', () => {
    it('素材を使う表示：武将のいる行は、その武将の顔・名前・役割（合戦の能力の欄と同じ呼び方）。いない行は「—」だけ', async () => {
        const info = practiceBriefingInfo(getField('plains')!);
        const rows = briefingTable();
        expect(rows.length).toBe(info.allies.length);
        let withGen = 0;
        for (const r of rows) {
            const u = info.allies.find((a) => a.id === r.unit)!;
            if (!u.general) {
                expect(r.gen.textContent).toBe('—');
                expect(r.faces).toEqual([]);
                expect(r.tr.classes.has('with-gen')).toBe(false);
                continue;
            }
            withGen++;
            const g = generalById(u.generalId!)!;
            const box = r.gen.children[0]!;
            expect(box.className).toBe('g-pr-gen');
            expect(r.tr.classes.has('with-gen')).toBe(true);
            const name = box.all((e) => e.classes.has('g-pr-gname'))[0]!;
            const role = box.all((e) => e.classes.has('g-pr-grole'))[0]!;
            expect(name.textContent).toBe(u.general);
            expect(role.textContent).toBe(GENERAL_ROLE_LABELS[g.role]);
            expect(r.faces.length).toBe(1);
        }
        // 大平原の演習：家康（総大将）・忠勝（前線の主将）・榊原（前線の主将）・酒井（采配・軍議）・石川（後詰め）の 5 人
        expect(withGen).toBe(5);
        await flush();
        for (const r of rows.filter((x) => x.faces.length)) {
            const u = info.allies.find((a) => a.id === r.unit)!;
            const f = r.faces[0]!;
            // 読めたら描いて、その武将の顔の印（酒井忠次・本多忠勝・榊原康政を取り違えない）
            expect(f.dataset.artId).toBe(`face.${u.generalId}`);
            expect(f.classes.has('b-face')).toBe(true);
            expect(f.classes.has('b-face-wait')).toBe(false);
            expect(f.draws).toBe(1);
            expect(f.attrs.get('aria-hidden')).toBe('true');
            // 名前・役割より前（左）
            expect(r.gen.children[0]!.children[0]).toBe(f);
        }
    });
    it('まだ読めていない間は空の枠で場所を取る（印なし・描かない）。届いたら同じ canvas に描く（行が後から動かない）', async () => {
        art.hold = true;
        const rows = briefingTable().filter((r) => r.faces.length);
        expect(rows.length).toBe(5);
        for (const r of rows) {
            expect(r.faces[0]!.classes.has('b-face-wait')).toBe(true);
            expect(r.faces[0]!.dataset.artId).toBeUndefined();
            expect(r.faces[0]!.draws).toBe(0);
        }
        for (const go of art.resolvers) go();
        await flush();
        for (const r of rows) {
            const f = r.gen.all((e) => e.tagName === 'canvas');
            expect(f).toEqual([r.faces[0]]);
            expect(f[0]!.classes.has('b-face-wait')).toBe(false);
            expect(f[0]!.dataset.artId).toMatch(/^face\./);
        }
    });
    it('顔が読めない：その行の顔の場所を外し、名前・役割の文字は残す（ほかの武将の顔で代用しない）', async () => {
        art.fail.add('face.sakai');
        const rows = briefingTable();
        await flush();
        const sakai = rows.find((r) => r.unit === 'a_sakai')!;
        expect(sakai.gen.all((e) => e.tagName === 'canvas')).toEqual([]);
        expect(sakai.gen.textContent).toBe(`酒井忠次${GENERAL_ROLE_LABELS[generalById('sakai')!.role]}`);
        // ほかの行は自分の顔のまま
        for (const r of rows.filter((x) => x.unit !== 'a_sakai' && x.faces.length)) expect(r.faces[0]!.dataset.artId).not.toBe('face.sakai');
    });
    it('どの顔も読めない：表は名前・役割の文字だけ（空の枠を残さない）', async () => {
        art.fail = new Set(['face.ieyasu', 'face.tadakatsu', 'face.sakai', 'face.ishikawa', 'face.sakakibara']);
        const none = briefingTable();
        await flush();
        for (const r of none) expect(r.gen.all((e) => e.tagName === 'canvas')).toEqual([]);
        expect(none.filter((r) => r.gen.children.length).length).toBe(5);
    });
    it('旧表示（?art=old）：Version 21 と同じ名前の文字だけ（顔の場所・役割・class を足さない。素材を読まない）', async () => {
        art.mode = 'old';
        const info = practiceBriefingInfo(getField('plains')!);
        const rows = briefingTable();
        await flush();
        for (const r of rows) {
            const u = info.allies.find((a) => a.id === r.unit)!;
            expect(r.gen.children).toEqual([]);
            expect(r.gen.textContent).toBe(u.general ?? '—');
            expect(r.gen.className).toBe('');
            expect(r.tr.className).toBe('');
        }
        expect(art.loads).toEqual([]);
    });
    it('援軍救出（浅井長政＝同盟の大将の隊がいる演習）でも、その武将の顔と役割', async () => {
        const info = practiceBriefingInfo(getField('relief')!);
        const rows = briefingTable('relief');
        await flush();
        const nag = info.allies.find((a) => a.generalId === 'nagamasa');
        expect(nag).toBeTruthy();
        const r = rows.find((x) => x.unit === nag!.id)!;
        expect(r.faces[0]!.dataset.artId).toBe('face.nagamasa');
        expect(r.gen.all((e) => e.classes.has('g-pr-grole'))[0]!.textContent).toBe(GENERAL_ROLE_LABELS.ally_lord);
    });
});
