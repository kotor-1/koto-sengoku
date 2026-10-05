/**
 * 画面を覆う層（DomView の modals）の約束。ui/view.ts と、層を作る小さな部品（ui/cinePlayer.ts・ui/situationView.ts）が共有する。
 */
import type { HeldKeys } from './guard';

export type ModalKind = 'title' | 'script' | 'confirm' | 'menu' | 'ending' | 'record' | 'sheet' | 'cine' | 'situation';

/** 確認用（開発ビルドの __game）：今の画面の中身と、押す操作 */
export interface ModalProbe {
    kind: ModalKind;
    /** 会話：台詞の id（story.ts の Script.id）・今の行・全部の行・選択肢。演出：台本の id */
    id?: string;
    line?: { name: string; text: string };
    index?: number;
    count?: number;
    choices?: string[];
    selected?: string | null;
    /** 確認・メニュー・タイトル・結末・演出・情勢：ボタンの id と文字 */
    buttons?: { id: string; label: string; disabled: boolean }[];
    text?: string;
    /** 板（sheet）の名前（例：practice-list） */
    sheet?: string;
    /** 演出：今の場面の番号（count が場面の数）・時刻（秒）・止まっているか・今の字幕・状態・出した情報の札・場面の種類・動きを減らしているか */
    beat?: number;
    t?: number;
    paused?: boolean;
    caption?: { speaker?: string; text: string } | null;
    state?: 'playing' | 'paused' | 'done';
    info?: string[];
    mode?: 'map' | 'stage';
    reduced?: boolean;
    /** 情勢：開いた所・選んでいるタブ（軍議の選択肢の id）・タブの並び・地図の強調 */
    from?: 'explore' | 'council';
    option?: string | null;
    options?: string[];
    highlight?: string[];
}

export interface Modal {
    kind: ModalKind;
    layer: HTMLElement;
    key(e: KeyboardEvent): void;
    probe(): ModalProbe;
    /** 確認用：進める（会話。演出は次の場面） */
    advance?(): void;
    /** 確認用：押す（選択肢・ボタンの id）。押せなければ false */
    press(id: string): boolean;
    /** 上に重なった画面が閉じて、また一番上に戻った（出たばかりと同じ見張りにする） */
    reexpose?(): void;
    /** 閉じた（答えを返して閉じた・abandon で捨てた）ときの後片付け（演出の時計・窓の見張り・3D の出来事） */
    dispose?(): void;
    /** 探索の場面を覆っているか（省けば：会話以外・軍議は覆う）。演出は地図の場面だけ覆う */
    covers?(): boolean;
}

/** 層を作る部品が使う DomView の口 */
export interface LayerHost {
    readonly keys: HeldKeys;
    openLayer(kind: ModalKind, cls: string): HTMLElement;
    pushModal(m: Modal): void;
    closeModal(m: Modal): void;
    /** 覆い（探索の描画を止めるか）を、今の層から決め直す */
    refreshCover(): void;
    /** 見張り付きのボタンの並び（1 回だけ押せる） */
    buttonRowFor(
        container: HTMLElement,
        items: { id: string; label: string; sub?: string; disabled?: boolean; parent?: HTMLElement }[],
        defaultIndex: number,
        onPick: (id: string) => void,
    ): { key(e: KeyboardEvent): boolean; buttons: { id: string; label: string; disabled: boolean }[]; press(id: string): boolean; reexpose(): void };
}

/** 押し始めの時刻（イベントの timeStamp。performance.now() と同じ時計。おかしな値なら今） */
export function startedAt(e: Event, now: number): number {
    const t = e.timeStamp;
    return Number.isFinite(t) && t > 0 && t <= now + 1000 ? t : now;
}

/**
 * 組み立ての途中で失敗した層を片付ける（まだ積んでいない層。地図の組み立てが投げたときなど）。
 * 層を外し、覆い・body の印を今の層から決め直す（画面をふさいだまま残さない）。
 */
export function dropLayer(host: LayerHost, kind: ModalKind, layer: HTMLElement): void {
    host.closeModal({ kind, layer, key: () => {}, probe: () => ({ kind }), press: () => false });
}
