/**
 * 演出の再生器（ui/cinePlayer.ts）と、それを呼ぶゲームの側（campaign/game.ts）を Node で動かす道具（テストの共有）。
 * - 偽の DOM（描かない）・手で回す requestAnimationFrame（コマの時刻をテストが決める：frame）。
 * - 音：偽の AudioContext・偽の fetch で組んだ本物の AudioSystem を登録する（sound。後片付けは resetCine）。
 * - ゲーム：偽の画面（演出を頼まれたら記録して待つ。prepareCinematic も記録）・偽の場面。
 * このファイルを読み込むと、全体の document・window・requestAnimationFrame を偽物に替える（読み込んだテストのファイルの中だけ）。
 */
import { installAudio, uninstallAudio, type AudioSystem, type VoiceTable } from '../proto3d/src/audio/index';
import { VOICE_MANIFEST } from '../proto3d/src/audio/voiceManifest';
import type { VoiceSource } from '../proto3d/src/audio/settings';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import type {
    CinematicOptions,
    ConfirmOptions,
    EndingAction,
    GameView,
    GameWorld,
    HudInfo,
    MenuAction,
    ScriptOptions,
    TitleAction,
} from '../proto3d/src/campaign/game';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import type { CastMember } from '../proto3d/src/explore/cast';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import type { CineMoment, CineSpec, SituationView, StageEvent } from '../proto3d/src/story/types';
import type { Modal } from '../proto3d/src/ui/modal';
import { FakeFetch, FakePage, FakeSynth, FakeTimers, FakeUtterance, fakeContext, memoryStorage, type FakeAudioContext } from './proto3d-audio-fakes';

// ---------------------------------------------------------------- 偽の DOM と、手で回す requestAnimationFrame

function fakeElement(tag = 'div'): Record<string, unknown> {
    const children: unknown[] = [];
    const classes = new Set<string>();
    const attrs = new Map<string, string>();
    return {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        disabled: false,
        dataset: {},
        style: {},
        children,
        clientWidth: 800,
        clientHeight: 400,
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        appendChild: (c: unknown) => children.push(c),
        append: (...c: unknown[]) => children.push(...c),
        replaceChildren: (...c: unknown[]) => children.splice(0, children.length, ...c),
        remove: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
}

export type El = ReturnType<typeof fakeElement> & { dataset: Record<string, string>; classList: { contains(c: string): boolean } };
export const body = fakeElement('body') as El;
const g = globalThis as Record<string, unknown>;
g.document = { createElement: (t: string) => fakeElement(t), body, addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: 'visible' };
g.window = { addEventListener: () => undefined, removeEventListener: () => undefined };
let rafs: ((ts: number) => void)[] = [];
g.requestAnimationFrame = (cb: (ts: number) => void) => {
    rafs.push(cb);
    return rafs.length;
};
g.cancelAnimationFrame = () => undefined;

/** 1 コマ（時刻 ts ms）：待っている requestAnimationFrame を呼ぶ */
export function frame(ts: number): void {
    const list = rafs;
    rafs = [];
    for (const cb of list) cb(ts);
}

export const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- 音（偽の AudioContext・fetch）

const TABLE: VoiceTable = {
    byId: (id) => VOICE_LINES.find((v) => v.id === id),
    find: (s, t) => findVoiceLine(s, t),
    nameOf: (s) => (VOICE_SPEAKER_NAMES as Record<string, string>)[s] ?? '',
};
const secOfUrl = (url: string) => VOICE_MANIFEST.lines.find((e) => url.endsWith(e.file))?.sec ?? 2;

export function sound(opts: { override?: VoiceSource | null; unlock?: boolean } = {}): { sys: AudioSystem; ctx: FakeAudioContext; fetch: FakeFetch } {
    const { ctx, create } = fakeContext();
    const fetch = new FakeFetch(secOfUrl);
    const sys = installAudio({
        storage: memoryStorage(),
        voices: TABLE,
        createContext: create,
        page: new FakePage(),
        speech: { synth: new FakeSynth(), makeUtterance: (t) => new FakeUtterance(t) },
        timers: new FakeTimers(),
        renderer: null,
        voiceFiles: { fetchBytes: fetch.fetchBytes },
        voiceSourceOverride: opts.override ?? null,
    })!;
    if (opts.unlock !== false) sys.unlock();
    return { sys, ctx, fetch };
}

/** 後片付け（afterEach）：登録した音を外し、待っている requestAnimationFrame を捨てる */
export function resetCine(): void {
    uninstallAudio();
    rafs = [];
}

// ---------------------------------------------------------------- 再生器

export async function play(spec: CineSpec, opts: Partial<CinematicOptions> = {}) {
    const { playCinematic } = await import('../proto3d/src/ui/cinePlayer');
    const { HeldKeys } = await import('../proto3d/src/ui/guard');
    let modal: Modal | null = null;
    let layer: El | null = null;
    const covers: boolean[] = [];
    const host = {
        keys: new HeldKeys(),
        openLayer: () => (layer = fakeElement() as El) as unknown as HTMLElement,
        pushModal: (m: Modal) => {
            modal = m;
            covers.push(!!m.covers?.());
        },
        closeModal: (m: Modal) => m.dispose?.(),
        refreshCover: () => {
            if (modal) covers.push(!!modal.covers?.());
        },
        buttonRowFor: () => {
            throw new Error('使わない');
        },
    };
    const stages: { ev: StageEvent | null; t: number }[] = [];
    let settled: 'done' | 'skipped' | null = null;
    const done = playCinematic(host as never, spec, { reduced: false, onStage: (ev, t) => stages.push({ ev, t }), ...opts });
    void done.then((r) => (settled = r));
    return {
        done,
        stages,
        covers,
        settled: () => settled,
        modal: () => modal!,
        layer: () => layer!,
        probe: () => modal!.probe(),
        /** ts から step ms ごとに n コマ回す（最後の時刻を返す） */
        run: (ts: number, n: number, step = 100) => {
            for (let i = 0; i < n; i++) frame(ts + i * step);
            return ts + (n - 1) * step;
        },
    };
}

export const report = () => ieyasuCinematic(newIeyasuGame(), 'ch1_report')!;
export const firstVoiced = (spec: CineSpec) => spec.captions.find((c) => c.voice)!;

/** 町の急報の始め（探索の所から）を、最初の声の字幕の手前まで 100 ms ごとに回す（始めの待ち 2 コマ・最初の画の次のコマを含む） */
export async function untilFirstVoice(p: Awaited<ReturnType<typeof play>>, spec: CineSpec): Promise<number> {
    const c = firstVoiced(spec);
    let ts = 1000;
    for (let i = 0; i < 400; i++) {
        frame(ts);
        await flush();
        if (p.layer().dataset.voiceWait === '1' || (p.probe().t ?? 0) >= c.start) break;
        ts += 100;
    }
    return ts;
}

// ---------------------------------------------------------------- ゲームの側の口（campaign/game.ts）

export type Req =
    | { kind: 'title'; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'cinematic'; spec: CineSpec; opts: CinematicOptions; answer: (r: 'done' | 'skipped') => void }
    | { kind: 'situation'; view: SituationView; answer: (r?: { replay?: CineMoment }) => void };

export class View implements GameView {
    reqs: Req[] = [];
    prepared: (string | null)[] = [];
    title() {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', answer }));
    }
    script(script: ScenarioScript, _o: ScriptOptions) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu() {
        return new Promise<MenuAction>(() => undefined);
    }
    ending() {
        return new Promise<EndingAction | void>(() => undefined);
    }
    record(_v: ScenarioEndingView) {
        return new Promise<void>(() => undefined);
    }
    hud(_i: HudInfo | null) {}
    prompt() {}
    intro() {}
    toast() {}
    abandon() {
        this.reqs = [];
    }
    cinematic(spec: CineSpec, opts: CinematicOptions) {
        return new Promise<'done' | 'skipped'>((resolve) =>
            this.reqs.push({
                kind: 'cinematic',
                spec,
                opts,
                answer: (r) => {
                    opts.onStage(null, 0, opts.reduced);
                    resolve(r);
                },
            }),
        );
    }
    prepareCinematic(spec: CineSpec | null) {
        this.prepared.push(spec?.id ?? null);
    }
    situation(view: SituationView) {
        return new Promise<{ replay?: CineMoment } | void>((answer) => this.reqs.push({ kind: 'situation', view, answer: (r) => answer(r) }));
    }
}

export class World implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    private readonly w = colliders();
    walls(): Rect[] {
        return this.w;
    }
    setCast(c: CastMember<string>[]) {
        this.cast = c;
    }
    heroPose() {
        return { ...this.pose };
    }
    setHeroPose(p: ExplorePose) {
        this.pose = { ...p };
    }
    setControl() {}
    stage() {}
}

export async function next<K extends Req['kind']>(v: View, kind: K): Promise<Extract<Req, { kind: K }>> {
    for (let i = 0; i < 200; i++) {
        const k = v.reqs.findIndex((r) => r.kind === kind);
        if (k >= 0) return v.reqs.splice(k, 1)[0] as Extract<Req, { kind: K }>;
        for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    throw new Error(`${kind} が来ない（${v.reqs.map((r) => r.kind).join(',')}）`);
}
