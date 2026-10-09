/**
 * 第一章の画面（DOM）：目的・メニューのボタン・話すボタン・段階の案内・知らせと、
 * 画面を覆うもの（タイトル・会話と選択肢・軍議・確認・メニュー・結末）。
 *
 * campaign/game.ts の GameView を満たす。状態は持たない（見せて、押されたものを返すだけ）。
 * 入力の決まり（docs/design-policy.md §2）：ボタンは押した瞬間（pointerdown）に反応し、
 * 出たばかりの選択肢・ボタンはしばらく押しても決まらない（連打で次の選択まで進まないように）。
 * さらに、出た後に始まった入力（出た後の pointerdown・出た後に押し直したキー。キーの自動の繰り返しは無視）だけで決まる（ui/guard.ts）。
 * キーボード：会話は Enter／Space／E で進む、選択肢は ↑↓（W／S）で選んで Enter、数字でも選べる。Esc はメニュー・やめる。
 * 会話・軍議の途中も、右上の「メニュー」（Esc／M）でメニューを開ける。メニューは会話の上に重なり、閉じれば同じ行・同じ選び方に戻る（会話は進まない）。
 */
import './ui.css';
import type { CinematicOptions, ConfirmOptions, EndingAction, EndingOptions, GameView, HudInfo, MenuAction, MenuInfo, PromptInfo, ScriptOptions, TitleAction, TitleInfo, TitleScenarioInfo } from '../campaign/game';
import type { ScenarioEndingView, ScenarioScript } from '../campaign/scenario';
import { CHAPTER_TITLE, PROVISIONAL_LABEL } from '../campaign/story';
import type { CineMoment, CineSpec, SituationView } from '../story/types';
import type { StoryPrefsStore } from '../story/prefs';
import { PRACTICE_TITLE_TEXT, SCENARIO_TITLE_TEXT } from './scenarioTitles';
import { el, nowMs, onPress } from './dom';
import { ADVANCE_GUARD_MS, CHOICE_GUARD_MS, HeldKeys, InputGate } from './guard';
import type { LayerHost, Modal, ModalKind, ModalProbe } from './modal';
import { playCinematic } from './cinePlayer';
import { openSituation } from './situationView';
import { soundPanel } from './soundPanel';
import { audio } from '../audio';
import { deviceReducedMotion } from '../story/prefs';
import type { ArtId } from '../art/ids';
import { AI_ART_NOTE, CouncilBackdrop, DialogFace, PortraitSlot, artInUse, loadArt } from './artCanvas';

export type { ModalProbe } from './modal';

/** ページの題（タブ）の頭。シナリオが決まったら章の名前と札を足す */
export const PAGE_TITLE = '戦国探索記 3D';

/** 押し始めの時刻（イベントの timeStamp。performance.now() と同じ時計。おかしな値なら今） */
function startedAt(e: Event): number {
    const now = nowMs();
    const t = e.timeStamp;
    return Number.isFinite(t) && t > 0 && t <= now + 1000 ? t : now;
}

/** 画面いっぱいの板（sheet）：中身は呼ぶ側が作り、ボタンの並びは見張り（ui/guard.ts）付きで置く */
export interface SheetOptions {
    /** 板の名前（層の data-sheet と ModalProbe.sheet に入る） */
    name: string;
    /** 中身（ボタンを置く所 parent も、この中に作っておく） */
    body: HTMLElement;
    /** ボタン（parent を省けば中身の最後の並びに置く） */
    buttons: { id: string; label: string; sub?: string; disabled?: boolean; parent?: HTMLElement }[];
    defaultIndex?: number;
    /** Esc で選ぶボタン */
    cancelId?: string;
}

const isGo = (e: KeyboardEvent) => e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyE';
const isUp = (e: KeyboardEvent) => e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ArrowLeft' || e.code === 'KeyA';
const isDown = (e: KeyboardEvent) => e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Tab';

export class DomView implements GameView, LayerHost {
    readonly root: HTMLElement;
    private readonly hudEl: HTMLElement;
    private readonly hudPhase: HTMLElement;
    private readonly hudChapter: HTMLElement;
    private readonly hudObj: HTMLElement;
    private readonly menuBtn: HTMLButtonElement;
    /** 情勢のボタン（右上、メニューの下。J） */
    private readonly sitBtn: HTMLButtonElement;
    private readonly talkBtn: HTMLButtonElement;
    private readonly talkVerb: HTMLElement;
    private readonly talkWho: HTMLElement;
    private readonly introEl: HTMLElement;
    private readonly toastEl: HTMLElement;
    private readonly modals: Modal[] = [];
    /** 押さえているキー（出たばかりの選択肢を、出る前から押さえていたキーで決めないように） */
    readonly keys = new HeldKeys();
    private introTimers: number[] = [];
    private toastTimer = 0;
    /** 「話す」ボタン・E／Enter／Space */
    onTalk: () => void = () => {};
    /** メニューのボタン・Esc／M */
    onMenu: () => void = () => {};
    /** 探索の場面を覆う画面（会話以外：タイトル・軍議・確認・メニュー・結末）が開いた／閉じた。覆っている間は探索の描画を止めてよい */
    onCover: (covered: boolean) => void = () => {};
    /** 情勢のボタン・J（探索中と軍議の上） */
    onSituation: () => void = () => {};
    /** 演出の「動きを減らす」の設定（boot がつなぐ。無ければ切り替えはこの再生の間だけ） */
    prefs: StoryPrefsStore | null = null;
    /** 確認用：再生中の演出（開発ビルドの __game.cine） */
    private cineModal: Modal | null = null;

    constructor(app: HTMLElement) {
        this.root = el('div');
        this.root.id = 'g-root';
        // 目的（左上）
        this.hudEl = el('div', 'g-hud');
        this.hudEl.hidden = true;
        this.hudChapter = el('div', 'g-hud-chapter');
        this.hudPhase = el('span', 'g-phase');
        this.hudObj = el('div', 'g-hud-obj');
        this.hudEl.append(this.hudChapter, this.hudObj);
        // メニュー（右上）
        this.menuBtn = el('button', 'g-menu-btn', 'メニュー');
        this.menuBtn.type = 'button';
        this.menuBtn.hidden = true;
        this.menuBtn.setAttribute('aria-label', 'メニュー（状態・保存・タイトルへ）');
        // 会話の上にも出す（押しても会話は進まない）。会話以外の画面（メニュー・確認など）が開いている間は押せない
        onPress(this.menuBtn, () => {
            if (this.menuReachable()) this.onMenu();
        });
        // 情勢（右上、メニューの下）：探索中だけ押せる（会話・メニューなどが開いている間は、その下に隠れる）
        this.sitBtn = el('button', 'g-sit-btn');
        this.sitBtn.type = 'button';
        this.sitBtn.hidden = true;
        this.sitBtn.append(document.createTextNode('情勢'), el('kbd', undefined, 'J'));
        this.sitBtn.setAttribute('aria-label', '情勢（地図・協力と敵対・今回の目的。J）');
        onPress(this.sitBtn, () => {
            if (this.modals.length === 0 && !this.sitBtn.hidden) this.onSituation();
        });
        // 話す（右下）
        this.talkBtn = el('button', 'g-talk');
        this.talkBtn.type = 'button';
        this.talkBtn.hidden = true;
        this.talkVerb = el('span', 'verb', '話す');
        this.talkWho = el('span', 'who');
        const kbd = el('kbd', undefined, 'E');
        this.talkBtn.append(this.talkVerb, this.talkWho, kbd);
        onPress(this.talkBtn, () => this.onTalk());
        // 案内・知らせ
        this.introEl = el('div', 'g-intro');
        this.introEl.hidden = true;
        this.toastEl = el('div', 'g-toast');
        this.toastEl.hidden = true;
        // 知らせは読むだけ（pointer-events: none。下のスティック・見回し・ボタンへの押し始めを奪わない）
        this.toastEl.setAttribute('role', 'status');
        this.root.append(this.hudEl, this.menuBtn, this.sitBtn, this.talkBtn, this.introEl, this.toastEl);
        app.appendChild(this.root);
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('keyup', (e) => this.keys.up(e.code));
        window.addEventListener('blur', () => this.keys.clear());
    }

    /** メニューのボタンを押せるか（何も開いていない・一番上が会話） */
    private menuReachable(): boolean {
        if (this.menuBtn.hidden) return false;
        const top = this.modals[this.modals.length - 1];
        return !top || top.kind === 'script';
    }
    private syncMenuBtn(): void {
        // 会話の上では押せる（前に出す）。メニュー・確認などが開いている間は、その下に隠す
        this.menuBtn.classList.toggle('over', this.modals.length > 0 && this.menuReachable());
        this.menuBtn.classList.toggle('under', !this.menuReachable());
    }

    // ---------------- 常に出ているもの ----------------

    hud(info: HudInfo | null): void {
        const show = !!info;
        this.hudEl.hidden = !show;
        this.menuBtn.hidden = !show;
        this.sitBtn.hidden = !info?.situation;
        if (!info) return;
        // ページの題（タブ）も、遊んでいるシナリオの章の名前と札にする（歴史分岐を遊んでいる間に「仮シナリオ」と出さない）
        document.title = `${PAGE_TITLE} ${info.chapter}（${info.provisional}）`;
        this.hudChapter.textContent = info.chapter;
        this.hudPhase.textContent = info.phase;
        const tag = el('span', 'g-tag', info.provisional);
        this.hudChapter.append(this.hudPhase, tag);
        this.hudObj.replaceChildren(el('b', undefined, '目的'), document.createTextNode(info.objective));
    }

    prompt(p: PromptInfo | null): void {
        this.talkBtn.hidden = !p;
        if (!p) return;
        this.talkVerb.textContent = p.verb;
        this.talkWho.textContent = p.label;
        this.talkBtn.dataset.target = p.id;
        this.talkBtn.setAttribute('aria-label', `${p.verb}：${p.label}`);
    }

    intro(title: string, text: string): void {
        for (const t of this.introTimers) clearTimeout(t);
        this.introEl.replaceChildren(el('h2', undefined, title), ...(text ? [el('p', undefined, text)] : []));
        this.introEl.hidden = false;
        this.introEl.classList.remove('fade');
        this.introTimers = [
            window.setTimeout(() => this.introEl.classList.add('fade'), 3600),
            window.setTimeout(() => (this.introEl.hidden = true), 4300),
        ];
    }

    toast(text: string, kind: 'ok' | 'error' | 'info'): void {
        clearTimeout(this.toastTimer);
        this.toastEl.textContent = text;
        this.toastEl.className = `g-toast ${kind}`;
        this.toastEl.hidden = false;
        this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), kind === 'error' ? 9000 : 4000);
    }

    // ---------------- 画面を覆うもの ----------------

    // ---- 層を作る部品（ui/cinePlayer.ts・ui/situationView.ts）の口（LayerHost） ----
    openLayer(kind: ModalKind, cls: string): HTMLElement {
        return this.open(kind, cls);
    }
    pushModal(m: Modal): void {
        this.push(m);
    }
    closeModal(m: Modal): void {
        this.close(m);
    }
    refreshCover(): void {
        this.updateCover();
    }
    buttonRowFor(...args: Parameters<DomView['buttonRow']>): ReturnType<DomView['buttonRow']> {
        return this.buttonRow(...args);
    }

    private open(kind: ModalKind, cls: string): HTMLElement {
        const layer = el('div', `g-layer ${cls}`.trim());
        layer.dataset.kind = kind;
        // 覆っている間は、下の探索（見回し・スティック）に触れさせない
        layer.addEventListener('pointerdown', (e) => e.preventDefault());
        this.root.appendChild(layer);
        this.introEl.hidden = true;
        document.body.classList.add('g-modal');
        if (kind === 'title') document.body.classList.add('g-title');
        return layer;
    }

    private push(m: Modal): void {
        this.modals.push(m);
        this.updateCover();
        this.syncMenuBtn();
        this.syncUnder();
    }

    /**
     * 演出が一番上の間は、下の層（軍議など）を見えなくする（3D の場面で町を見せる）。HUD・メニュー・情勢のボタンも隠す（押せないので）。
     */
    private syncUnder(): void {
        const top = this.modals[this.modals.length - 1];
        const cine = top?.kind === 'cine';
        for (const m of this.modals) m.layer.classList.toggle('g-under-cine', cine && m !== top);
        document.body.classList.toggle('g-cine', cine);
        // 軍議の間は、下に透けて見える目的の札・情勢のボタンを隠す（軍議の「詳しく見る」と重ねない）
        document.body.classList.toggle('g-council-open', this.modals.some((m) => m.layer.classList.contains('council')));
        // 軍議の背景（Version 22。層に g-art）が一番上の間だけ：知らせ・案内をその層の上へ出し、手前の幕を揺らす（ui.css）。
        // メニュー・情勢・演出・確認が重なれば外す（今までどおり、それらの層の下）。背景が無ければ付かない（Version 21 と同じ）
        document.body.classList.toggle('g-council-art', !!top && top.layer.classList.contains('g-art'));
        // 何か開いている間は情勢のボタンを隠す（押せないので）
        this.sitBtn.classList.toggle('covered', this.modals.length > 0);
    }

    private covered = false;
    /** 画面を覆うものが無い間も探索を覆ったままにする（合戦場の演習の間。holdCover） */
    private coverHeld = false;
    private loadingEl: HTMLElement | null = null;
    private updateCover(): void {
        // 一番上が演出なら、演出の場面で決める（地図の場面は覆う・3D の場面は覆わない。下の層は見えなくしてある）
        const top = this.modals[this.modals.length - 1];
        const c = this.coverHeld || (top?.kind === 'cine' ? !!top.covers?.() : this.modals.some((m) => (m.covers ? m.covers() : m.kind !== 'script' || m.layer.classList.contains('council'))));
        if (c === this.covered) return;
        this.covered = c;
        this.onCover(c);
    }

    /**
     * 探索を覆ったままにする（合戦場の演習の間：画面の切り替え・読み込みの待ちの間も、探索の描画を止めたまま）。
     * 合戦の場面に入っている間は、合戦の画面が描く（app/modes.ts）。
     */
    holdCover(on: boolean): void {
        this.coverHeld = on;
        // 探索の操作部品（歩く・走る・WASD の案内）と名札も隠す（町へ戻ったように見せない）
        document.body.classList.toggle('g-hold', on);
        this.updateCover();
    }

    /**
     * 読み込みの待ちの間の画面（押せるものは無い。text を null で消す）。opaque は下の画を透かさない（出陣の後、合戦の画面が出るまで）。
     * 出ている間も、知らせ（toast）はこの覆いの上に出る。
     */
    loading(text: string | null, opts: { opaque?: boolean } = {}): void {
        this.loadingEl?.remove();
        this.loadingEl = null;
        this.root.classList.toggle('g-loading-on', text !== null);
        if (text === null) return;
        const layer = el('div', `g-layer solid g-loading${opts.opaque ? ' opaque' : ''}`);
        layer.dataset.kind = 'loading';
        layer.addEventListener('pointerdown', (e) => e.preventDefault());
        layer.append(el('p', undefined, text));
        this.introEl.hidden = true;
        this.root.appendChild(layer);
        this.loadingEl = layer;
    }

    private close(m: Modal): void {
        const i = this.modals.indexOf(m);
        const wasTop = i >= 0 && i === this.modals.length - 1;
        if (i >= 0) this.modals.splice(i, 1);
        m.layer.remove();
        // 後片付け（演出の時計・窓の見張り・3D の出来事）。後片付けの誤りで閉じるのを止めない
        try {
            m.dispose?.();
        } catch (e) {
            console.error(e);
        }
        this.syncUnder();
        this.updateCover();
        if (this.modals.length === 0) document.body.classList.remove('g-modal');
        if (!this.modals.some((x) => x.kind === 'title')) document.body.classList.remove('g-title');
        // 下の画面がまた一番上になった：出たばかりと同じに見張る（メニューを閉じた指・キーで会話が進まないように）
        const top = this.modals[this.modals.length - 1];
        if (wasTop && top) top.reexpose?.();
        this.syncMenuBtn();
    }

    private onKey = (e: KeyboardEvent): void => {
        this.keys.down(e.code, e.repeat);
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const top = this.modals[this.modals.length - 1];
        // 会話・軍議の途中の Esc／M：メニューを重ねて開く（会話は進めない）
        if (top?.kind === 'script' && (e.code === 'Escape' || e.code === 'KeyM')) {
            e.preventDefault();
            if (!e.repeat && this.menuReachable()) this.onMenu();
            return;
        }
        // 軍議の途中の J：情勢（詳しく見る）を重ねて開く（会話は進めない・選ばない）
        if (top?.kind === 'script' && e.code === 'KeyJ' && top.layer.querySelector('.g-council-map')) {
            e.preventDefault();
            if (!e.repeat) this.onSituation();
            return;
        }
        if (top) {
            top.key(e);
            return;
        }
        if (e.repeat) return;
        if (isGo(e) && !this.talkBtn.hidden) {
            e.preventDefault();
            this.onTalk();
            return;
        }
        if ((e.code === 'Escape' || e.code === 'KeyM') && !this.menuBtn.hidden) {
            e.preventDefault();
            this.onMenu();
            return;
        }
        if (e.code === 'KeyJ' && !this.sitBtn.hidden) {
            e.preventDefault();
            this.onSituation();
        }
    };

    /** 確認用：一番上の画面 */
    probe(): ModalProbe | null {
        const top = this.modals[this.modals.length - 1];
        return top ? top.probe() : null;
    }
    /** 確認用：再生中の演出（無ければ null。上に別の画面が重なっていても演出の様子） */
    cineProbe(): ModalProbe | null {
        return this.cineModal ? this.cineModal.probe() : null;
    }
    /** 開いている画面をすべて閉じる（答えは返さない。待っている流れは捨てる） */
    abandon(): void {
        for (const m of [...this.modals].reverse()) this.close(m);
    }
    /** 確認用：開いている画面をすべて閉じる（開発ビルドの __game.setPhase だけ） */
    devReset(): void {
        this.abandon();
    }
    /** 確認用：会話を 1 行進める */
    devAdvance(): boolean {
        const top = this.modals[this.modals.length - 1];
        if (!top?.advance) return false;
        top.advance();
        return true;
    }
    /** 確認用：選択肢・ボタンを押す（出たばかりでも決める） */
    devPress(id: string): boolean {
        const top = this.modals[this.modals.length - 1];
        return top ? top.press(id) : false;
    }

    /**
     * ボタンの並び（確認・メニュー・タイトル・結末で共用）。
     * ↑↓←→ で選び Enter／Space で押す。出たばかり（CHOICE_GUARD_MS）は押しても何も起きない。
     * 出た後に始まった入力（pointerdown・押し直したキー）だけで決まる。
     */
    private buttonRow(
        container: HTMLElement,
        items: { id: string; label: string; sub?: string; disabled?: boolean; /** 置く所（省けば container） */ parent?: HTMLElement }[],
        defaultIndex: number,
        onPick: (id: string) => void,
    ): { key(e: KeyboardEvent): boolean; buttons: { id: string; label: string; disabled: boolean }[]; press(id: string): boolean; reexpose(): void } {
        const gate = new InputGate(this.keys, nowMs(), CHOICE_GUARD_MS);
        const btns: HTMLButtonElement[] = [];
        let sel = Math.max(0, Math.min(items.length - 1, defaultIndex));
        if (items[sel]?.disabled) sel = Math.max(0, items.findIndex((i) => !i.disabled));
        const mark = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
        let done = false;
        const pick = (i: number) => {
            if (done || items[i]!.disabled) return false;
            done = true;
            onPick(items[i]!.id);
            return true;
        };
        items.forEach((it, i) => {
            const b = el('button', 'g-btn', it.label);
            b.type = 'button';
            b.dataset.id = it.id;
            if (it.sub) b.append(el('small', undefined, it.sub));
            b.disabled = !!it.disabled;
            onPress(b, (e) => {
                if (gate.pointer(nowMs(), startedAt(e))) pick(i);
            });
            btns.push(b);
            (it.parent ?? container).appendChild(b);
        });
        mark();
        const move = (d: number) => {
            for (let k = 0; k < items.length; k++) {
                sel = (sel + d + items.length) % items.length;
                if (!items[sel]!.disabled) break;
            }
            mark();
        };
        return {
            key(e) {
                if (isUp(e)) move(-1);
                else if (isDown(e)) move(1);
                else if (isGo(e)) {
                    if (gate.key(e.code, e.repeat, nowMs())) pick(sel);
                } else return false;
                e.preventDefault();
                return true;
            },
            buttons: items.map((i) => ({ id: i.id, label: i.label, disabled: !!i.disabled })),
            press: (id) => {
                const i = items.findIndex((x) => x.id === id);
                return i >= 0 && pick(i);
            },
            reexpose: () => gate.reset(nowMs()),
        };
    }

    title(info: TitleInfo): Promise<TitleAction> {
        // ページの題（タブ）：タイトルでは遊ぶシナリオが決まっていないので、シナリオの名前を付けない
        document.title = info.scenarios.length > 1 ? PAGE_TITLE : `${PAGE_TITLE} ${CHAPTER_TITLE}（${PROVISIONAL_LABEL}）`;
        if (info.scenarios.length > 1) return this.titleMulti(info.scenarios, !!info.practice);
        return new Promise((resolve) => {
            const layer = this.open('title', 'solid g-title-layer');
            const box = el('div', 'g-title-box');
            box.append(el('p', 'kicker', '戦国探索記 3D'), el('h1', undefined, CHAPTER_TITLE));
            const prov = el('p', 'prov');
            prov.append(el('span', 'g-tag', PROVISIONAL_LABEL));
            box.append(prov);
            // 仮シナリオの注記は、最初に目に入るよう題のすぐ下（ボタンより前）に大きめに出す
            box.append(
                el('p', 'g-prov-lead', 'この第一章は、歴史分岐 RPG の仕組みを完成させるために作った仮シナリオです。史実として確認したものではありません。'),
                el('p', 'g-note', info.note),
            );
            const btnBox = el('div');
            box.append(btnBox);
            const items = [
                { id: 'new', label: 'はじめから' },
                { id: 'continue', label: 'つづきから', sub: info.save ? info.save.summary : '保存がありません', disabled: !info.save },
            ];
            const m: Modal = {
                kind: 'title',
                layer,
                key: (e) => void row.key(e),
                probe: () => ({ kind: 'title', buttons: row.buttons, text: box.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(btnBox, items, info.save ? 1 : 0, (id) => {
                this.close(m);
                resolve(id as TitleAction);
            });
            if (info.problem) box.append(el('p', 'problem', info.problem));
            layer.append(box);
            this.push(m);
        });
    }

    /**
     * シナリオを並べたタイトル：シナリオごとの札（名前・札・史実と創作の注記・はじめから／つづきから（それぞれの保存））。
     * ボタンは 'new:<id>'／'continue:<id>' を返す。低い画面（スマホ横）では札を左右に並べ、はみ出す分は縦に動かせる。
     * practice なら、札の下に合戦場の演習の入口（1 行。ボタン 'practice'）を足す（シナリオのボタンの並び・id は変えない）。
     */
    private titleMulti(list: TitleScenarioInfo[], practice = false): Promise<TitleAction> {
        return new Promise((resolve) => {
            const layer = this.open('title', 'solid g-title-layer');
            const scroll = el('div', 'g-title-scroll g-scroll');
            const box = el('div', 'g-title-box multi');
            box.append(el('p', 'kicker', '戦国探索記 3D'), el('h1', undefined, 'シナリオを選ぶ'));
            // 生成イラスト素材を使っているときだけ、見出しのすぐ下に小さく AI 生成の明示（スマホ横でも最初の画面に入る所。
            // 旧表示 ?art=old・素材の一覧が空なら出さない＝Version 21 と同じタイトル）
            if (artInUse()) box.append(el('p', 'g-note g-art-note', AI_ART_NOTE));
            const cards = el('div', 'g-scn-list');
            box.append(cards);
            const items: { id: string; label: string; sub?: string; disabled?: boolean; parent: HTMLElement }[] = [];
            for (const sc of list) {
                const t = SCENARIO_TITLE_TEXT[sc.id] ?? { name: sc.title, lead: '' };
                const card = el('section', 'g-scn');
                card.dataset.scenario = sc.id;
                const head = el('h2', undefined, t.name);
                const prov = el('p', 'prov');
                prov.append(el('span', 'g-tag', sc.label));
                card.append(head, prov);
                if (t.lead) card.append(el('p', 'g-scn-lead', t.lead));
                const btns = el('div', 'g-scn-btns');
                card.append(btns);
                items.push(
                    { id: `new:${sc.id}`, label: 'はじめから', parent: btns },
                    { id: `continue:${sc.id}`, label: 'つづきから', sub: sc.save ? sc.save.summary : '保存がありません', disabled: !sc.save, parent: btns },
                );
                if (sc.problem) card.append(el('p', 'problem', sc.problem));
                card.append(el('p', 'g-note', sc.note));
                cards.append(card);
            }
            if (practice) {
                // 合戦場の演習の入口（シナリオとは別。章の状態・保存には触れない）
                const pr = el('section', 'g-practice-entry');
                pr.dataset.practice = 'entry';
                const txt = el('div', 'txt');
                const h = el('h2', undefined, PRACTICE_TITLE_TEXT.name);
                h.append(el('span', 'g-tag', PRACTICE_TITLE_TEXT.label));
                txt.append(h, el('p', undefined, PRACTICE_TITLE_TEXT.lead));
                pr.append(txt);
                box.append(pr);
                items.push({ id: 'practice', label: '演習を選ぶ', parent: pr });
            }
            // 最初に選ばれている：保存のある最初のシナリオの「つづきから」。どれにも保存が無ければ最初のシナリオの「はじめから」
            const firstSave = list.findIndex((x) => !!x.save);
            const m: Modal = {
                kind: 'title',
                layer,
                key: (e) => void row.key(e),
                probe: () => ({ kind: 'title', buttons: row.buttons, text: box.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(box, items, firstSave >= 0 ? firstSave * 2 + 1 : 0, (id) => {
                this.close(m);
                resolve(id as TitleAction);
            });
            scroll.append(box);
            layer.append(scroll);
            this.push(m);
        });
    }

    script(sc: ScenarioScript, opts: ScriptOptions): Promise<string | null> {
        return new Promise((resolve) => {
            const council = opts.mode === 'council';
            const layer = this.open('script', council ? 'council' : '');
            let head: HTMLElement | null = null;
            if (council) {
                head = el('div', 'g-council-head');
                head.append(el('h2', undefined, '軍議'), el('p', undefined, `城内の軍議所・${opts.label ?? PROVISIONAL_LABEL}`));
                layer.append(head);
            }
            // 軍議の「詳しく見る」（情勢の画面を重ねて開く。地図・情勢の図解。会話は進まない・選ばない）。左上（選択肢・台詞・見出しと重ならない所）
            let mapGate: InputGate | null = null;
            if (council && opts.situation) {
                const mb = el('button', 'g-council-map');
                mb.type = 'button';
                mb.append(document.createTextNode('詳しく見る'), el('kbd', undefined, 'J'));
                mb.setAttribute('aria-label', '詳しく見る（情勢の地図と図解。見るだけで、選択は決まらない。J）');
                mapGate = new InputGate(this.keys, nowMs(), CHOICE_GUARD_MS);
                const g = mapGate;
                onPress(mb, (e) => {
                    if (g.pointer(nowMs(), startedAt(e))) this.onSituation();
                });
                layer.append(mb);
            }
            const box = el('div', 'g-dialog');
            const name = el('div', 'name');
            const text = el('div', 'text');
            const more = el('div', 'more', '▼');
            const count = el('div', 'count');
            box.append(name, text, count, more);
            const choicesEl = el('div', 'g-choices');
            choicesEl.hidden = true;
            layer.append(choicesEl, box);
            const lines = sc.lines.length ? sc.lines : [{ speaker: 'narration', name: '', text: '……' }];
            // 生成イラスト素材（Version 22）：話し手の人物画（左下）と軍議の背景。素材が無い・旧表示（?art=old）・読めないときは何も作らない
            const reduced = () => this.motionReduced();
            const portrait = opts.portraitOf ? new PortraitSlot(layer, head ?? choicesEl, box, opts.portraitOf, reduced, () => this.portraitAvoid()) : null;
            portrait?.preload(lines.map((l) => l.speaker));
            // 台詞の枠の顔（台本のどこかの行の顔が読めたら、台本の終わりまで空きを取る。人物画が出ている人の行は顔を出さない）。
            // 狭い画面では顔が枠の上へはみ出す（ui.css）：選択肢・軍議の見出し・詳しく見る・目的の札・メニュー・台詞に届く行は、顔を縮めて枠の中に収め、
            // それでも重なれば出さない（DialogFace）
            const faceAvoid = () => [choicesEl, head, layer.querySelector('.g-council-map'), name, text, count, more, ...this.portraitAvoid()];
            const face = opts.faceOf ? new DialogFace(box, lines.map((l) => l.speaker), opts.faceOf, opts.portraitOf ?? null, () => portrait?.relayout(), faceAvoid) : null;
            if (face && portrait) portrait.onShown = (id) => face.portrait(id);
            const backdrop = council && opts.councilArt ? new CouncilBackdrop(layer, opts.councilArt, reduced, () => this.modals[this.modals.length - 1] === m) : null;
            const choices = sc.choices ?? [];
            let i = 0;
            let sel = Math.max(0, Math.min(choices.length - 1, sc.defaultChoice ?? 0));
            // 行を進める見張り（二度押しで 2 行進まない・話しかけたキーを押さえたままでは進まない）と、選択肢の見張り
            const lineGate = new InputGate(this.keys, nowMs(), ADVANCE_GUARD_MS);
            const choiceGate = new InputGate(this.keys, nowMs(), CHOICE_GUARD_MS);
            let done = false;
            const choiceBtns: HTMLButtonElement[] = [];
            const mark = () => choiceBtns.forEach((b, k) => b.classList.toggle('sel', k === sel));
            const finish = (v: string | null) => {
                if (done) return;
                done = true;
                this.close(m);
                resolve(v);
            };
            const pick = (k: number) => {
                if (done || choicesEl.hidden || !choices[k]) return false;
                finish(choices[k]!.id);
                return true;
            };
            const showChoices = () => {
                choicesEl.replaceChildren();
                choiceBtns.length = 0;
                choices.forEach((c, k) => {
                    const b = el('button', 'g-choice');
                    b.type = 'button';
                    b.dataset.id = c.id;
                    b.append(el('span', 'n', String(k + 1)), document.createTextNode(c.label));
                    if (c.detail) b.append(el('span', 'd', c.detail));
                    if (c.summary) b.append(el('span', 's', c.summary));
                    // 出たばかり・出る前に始まった押し方では決まらない（選んだ印も動かさない）
                    onPress(b, (e) => {
                        if (choiceGate.pointer(nowMs(), startedAt(e))) pick(k);
                    });
                    choiceBtns.push(b);
                    choicesEl.append(b);
                });
                choicesEl.classList.toggle('has-summary', choices.some((c) => !!c.summary));
                choicesEl.hidden = false;
                choiceGate.reset(nowMs(), CHOICE_GUARD_MS);
                mark();
            };
            const render = () => {
                const line = lines[i]!;
                name.textContent = line.name;
                name.classList.toggle('hero', line.speaker === 'hero');
                text.textContent = line.text;
                text.classList.toggle('narration', line.speaker === 'narration');
                box.dataset.speaker = line.speaker;
                count.textContent = lines.length > 1 ? `${i + 1}/${lines.length}` : '';
                const atEnd = i === lines.length - 1;
                more.hidden = atEnd && choices.length > 0;
                if (atEnd && choices.length > 0 && choicesEl.hidden) showChoices();
                // 顔：この行の話し手の顔（無い・人物画が出ている人の行は空きだけ）。人物画より先に（人物画が出れば、同じ行のうちに顔を下げる）
                face?.set(line.speaker);
                // 人物画：この行の話し手に絵があれば出す。絵の無い人物の行は前の人の絵を暗く残し、地の文・高札では下げる（選択肢が出た後の空きで大きさを決める）
                portrait?.set(line.speaker);
                // 声：表にある短い台詞だけ読む（前の行の声は止める。docs/audio.md）
                audio()?.line(line.speaker, line.name, line.text);
            };
            const advance = () => {
                if (done) return;
                lineGate.reset(nowMs(), ADVANCE_GUARD_MS);
                if (i < lines.length - 1) {
                    i++;
                    render();
                } else if (choices.length === 0) {
                    finish(null);
                }
            };
            // 画面のどこを押しても進む（選択肢が出ている間は、選択肢を押す）
            layer.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                if (lineGate.pointer(nowMs(), startedAt(e))) advance();
            });
            const m: Modal = {
                kind: 'script',
                layer,
                key: (e) => {
                    if (!choicesEl.hidden) {
                        if (isUp(e)) sel = (sel + choices.length - 1) % choices.length;
                        else if (isDown(e)) sel = (sel + 1) % choices.length;
                        else if (isGo(e)) {
                            if (choiceGate.key(e.code, e.repeat, nowMs())) pick(sel);
                        } else if (/^Digit[1-9]$/.test(e.code)) {
                            const k = Number(e.code.slice(5)) - 1;
                            if (k < choices.length && choiceGate.key(e.code, e.repeat, nowMs())) pick(k);
                        } else return;
                        mark();
                        e.preventDefault();
                        return;
                    }
                    if (isGo(e)) {
                        e.preventDefault();
                        if (lineGate.key(e.code, e.repeat, nowMs())) advance();
                    }
                },
                probe: () => ({
                    kind: 'script',
                    id: sc.id,
                    line: { name: lines[i]!.name, text: lines[i]!.text },
                    index: i,
                    count: lines.length,
                    choices: choicesEl.hidden ? [] : choices.map((c) => c.id),
                    selected: choicesEl.hidden ? null : (choices[sel]?.id ?? null),
                }),
                advance: () => advance(),
                press: (id) => {
                    const k = choices.findIndex((c) => c.id === id);
                    return k >= 0 && pick(k);
                },
                // メニューなどを閉じて会話に戻った：同じ行・同じ選び方のまま、閉じた入力では進まない・決まらない
                reexpose: () => {
                    lineGate.reset(nowMs(), CHOICE_GUARD_MS);
                    if (!choicesEl.hidden) choiceGate.reset(nowMs(), CHOICE_GUARD_MS);
                    mapGate?.reset(nowMs(), CHOICE_GUARD_MS);
                    // 上の画面（情勢・見直しの演出・メニュー）が閉じた：手前の幕の揺れを続ける。台詞の枠の顔は今の四角で測り直す
                    backdrop?.resume();
                    face?.relayout();
                },
                // 会話を閉じた（選んだ・終わった・タイトルへ）：声を止める。人物画・背景の見張りと揺れも止める
                dispose: () => {
                    audio()?.stopVoice();
                    portrait?.dispose();
                    face?.dispose();
                    backdrop?.dispose();
                },
            };
            this.push(m);
            backdrop?.start();
            face?.start();
            render();
        });
    }

    confirm(o: ConfirmOptions): Promise<string> {
        return new Promise((resolve) => {
            const layer = this.open('confirm', 'dim');
            const panel = el('div', 'g-panel');
            panel.append(el('h2', undefined, o.title), ...o.lines.map((t) => el('p', undefined, t)));
            const btns = el('div', 'btns');
            panel.append(btns);
            layer.append(panel);
            const m: Modal = {
                kind: 'confirm',
                layer,
                key: (e) => {
                    if (e.code === 'Escape' && o.cancelId) {
                        e.preventDefault();
                        row.press(o.cancelId);
                        return;
                    }
                    row.key(e);
                },
                probe: () => ({ kind: 'confirm', buttons: row.buttons, text: panel.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(btns, o.buttons, o.defaultIndex ?? 0, (id) => {
                this.close(m);
                resolve(id);
            });
            this.push(m);
        });
    }

    menu(info: MenuInfo): Promise<MenuAction> {
        return new Promise((resolve) => {
            const layer = this.open('menu', 'dim');
            const panel = el('div', 'g-panel g-scroll');
            panel.append(el('h2', undefined, 'メニュー'));
            const dl = el('dl', 'g-status');
            for (const s of info.status) dl.append(el('dt', undefined, s.label), el('dd', undefined, s.value));
            panel.append(dl);
            if (info.message) panel.append(el('div', `g-msg${info.message.ok ? '' : ' ng'}`, info.message.text));
            if (info.saveNote) panel.append(el('p', 'g-note', info.saveNote));
            const btns = el('div', 'btns');
            panel.append(btns);
            // 音の設定（ミュートと 3 つの音量。ボタンの下に小さく。docs/audio.md）
            const sound = soundPanel();
            if (sound) panel.append(sound);
            layer.append(panel);
            const items = [
                { id: 'save', label: '保存する', disabled: !info.canSave },
                { id: 'title', label: 'タイトルへ戻る' },
                { id: 'close', label: '閉じる' },
            ];
            const m: Modal = {
                kind: 'menu',
                layer,
                key: (e) => {
                    if (e.code === 'Escape' || e.code === 'KeyM') {
                        e.preventDefault();
                        if (!e.repeat) row.press('close');
                        return;
                    }
                    row.key(e);
                },
                probe: () => ({ kind: 'menu', buttons: row.buttons, text: panel.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(btns, items, info.message ? 2 : info.canSave ? 0 : 2, (id) => {
                this.close(m);
                resolve(id as MenuAction);
            });
            this.push(m);
        });
    }

    /**
     * 画面いっぱいの板（合戦場の演習の一覧・説明・結果）。中身は呼ぶ側（ui/practiceView.ts）が作る。
     * 覆っている間は探索の描画を止める（onCover）。ボタンは確認・メニューと同じ見張り付きの並び（出たばかりは決まらない）。
     */
    sheet(o: SheetOptions): Promise<string> {
        return new Promise((resolve) => {
            const layer = this.open('sheet', 'g-sheet-layer');
            layer.dataset.sheet = o.name;
            const scroll = el('div', 'g-sheet g-scroll');
            const inner = el('div', 'g-sheet-inner');
            inner.append(o.body);
            const btns = el('div', 'g-sheet-btns');
            inner.append(btns);
            scroll.append(inner);
            layer.append(scroll);
            const m: Modal = {
                kind: 'sheet',
                layer,
                key: (e) => {
                    if (e.code === 'Escape' && o.cancelId) {
                        e.preventDefault();
                        if (!e.repeat) row.press(o.cancelId);
                        return;
                    }
                    row.key(e);
                },
                probe: () => ({ kind: 'sheet', sheet: o.name, buttons: row.buttons, text: inner.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(btns, o.buttons, o.defaultIndex ?? 0, (id) => {
                this.close(m);
                resolve(id);
            });
            if (!btns.childElementCount) btns.remove();
            this.push(m);
        });
    }

    /**
     * 結末の画面。opts.next があれば「次の章へ進む」（data-id 'next_chapter'。既定の選択。sub の小さな説明つき）を「タイトルへ」（'title'）の上に並べ、
     * 押したボタンの id を返す。opts.next が無ければ今までと同じ（ボタンは「タイトルへ」1 つ・既定 'title'・返りは 'title'）。
     */
    ending(v: ScenarioEndingView, opts?: EndingOptions): Promise<EndingAction> {
        const items: { id: EndingAction; label: string; sub?: string }[] = opts?.next
            ? [{ id: 'next_chapter', label: opts.next.label, ...(opts.next.sub ? { sub: opts.next.sub } : {}) }, { id: 'title', label: 'タイトルへ' }]
            : [{ id: 'title', label: 'タイトルへ' }];
        return this.endingLike('ending', v, `${opts?.chapter ?? CHAPTER_TITLE}　${opts?.heading ?? '結末'}`, opts, items) as Promise<EndingAction>;
    }

    /**
     * 次の章へ移った直後の、前の章の結果確認（結末の画面と同じ作りの枠：見出し・記録の表・ボタン 1 つ「城下へ」data-id 'to_town'）。
     */
    record(v: ScenarioEndingView, opts?: EndingOptions): Promise<void> {
        return this.endingLike('record', v, `${opts?.chapter ?? CHAPTER_TITLE}　はじめに`, opts, [{ id: 'to_town', label: '城下へ' }]).then(() => undefined);
    }

    // ---------------- 生成イラスト素材（Version 22）の小道具 ----------------

    /** 動きを減らすか（演出の「動きを減らす」の設定。無ければ端末の設定） */
    private motionReduced(): boolean {
        return this.prefs ? this.prefs.reduced : deviceReducedMotion();
    }

    /** 人物画と重ねてはいけない、層の外の常に出ている物（目的の札・メニュー・情勢のボタン。見えている物だけ） */
    private portraitAvoid(): Element[] {
        return [this.hudEl, this.menuBtn, this.sitBtn];
    }

    /**
     * 使いそうな素材を先に読み始める（待たない。城下に入ったら人物画・忠勝と話している間に軍議の背景）。
     * 読めた物は、会話・軍議の画面が開いた同じフレームのうちに出せる（artCanvas の peekArt）。旧表示・一覧に無いときは何も読まない。
     */
    preloadArt(ids: ArtId[]): void {
        for (const id of new Set(ids)) void loadArt(id);
    }

    // ---------------- 演出・情勢 ----------------

    /**
     * 演出を再生する（ui/cinePlayer.ts）。「動きを減らす」を切り替えたら設定に書く（prefs があれば）。
     * 終わり・スキップ・abandon では必ず opts.onStage(null, 0, …) で片付ける。
     */
    cinematic(spec: CineSpec, opts: CinematicOptions): Promise<'done' | 'skipped'> {
        return playCinematic(this, spec, opts, {
            onReducedChange: (on) => {
                this.prefs?.setReduced(on);
            },
            onProbe: (m) => {
                this.cineModal = m;
            },
        });
    }

    /**
     * 情勢の画面（ui/situationView.ts）。opts.option を省いたときは、下の軍議でいま選ばれている選択肢のタブを選んでおく。
     */
    situation(v: SituationView, opts?: { option?: string }): Promise<{ replay?: CineMoment } | void> {
        const council = [...this.modals].reverse().find((m) => m.kind === 'script' && m.layer.classList.contains('council'));
        const option = opts?.option ?? council?.probe().selected ?? undefined;
        return openSituation(this, v, { ...(option ? { option } : {}), from: council ? 'council' : 'explore' });
    }

    /** 結末の画面と結果確認の画面の共通の作り（ボタンは見張り付きの並び。上に重なった画面が閉じたら出たばかりと同じに見張る） */
    private endingLike(kind: 'ending' | 'record', v: ScenarioEndingView, kicker: string, opts: EndingOptions | undefined, items: { id: string; label: string; sub?: string }[]): Promise<string> {
        return new Promise((resolve) => {
            const layer = this.open(kind, 'solid');
            const scroll = el('div', 'g-ending g-scroll');
            const inner = el('div', 'g-ending-inner');
            inner.dataset.scenario = opts?.scenario ?? 'fictional';
            if (kind === 'record') inner.dataset.record = v.id;
            inner.append(el('p', 'kicker', kicker));
            if (opts?.label) {
                const tag = el('p', 'prov');
                tag.append(el('span', 'g-tag', opts.label));
                inner.append(tag);
            }
            inner.append(el('h1', undefined, v.title));
            const body = el('div', 'body');
            for (const p of v.body) body.append(el('p', undefined, p));
            inner.append(body);
            const rec = el('div', 'record');
            rec.append(el('h2', undefined, kind === 'record' ? '引き継ぐもの' : '記録'));
            const dl = el('dl', 'g-status');
            for (const r of v.record) dl.append(el('dt', undefined, r.label), el('dd', undefined, r.value));
            rec.append(dl);
            inner.append(rec);
            if (v.footer) inner.append(el('p', 'footer', v.footer));
            const btns = el('div');
            inner.append(btns);
            scroll.append(inner);
            layer.append(scroll);
            const m: Modal = {
                kind,
                layer,
                key: (e) => void row.key(e),
                probe: () => ({ kind, buttons: row.buttons, text: inner.textContent ?? '' }),
                press: (id) => row.press(id),
                reexpose: () => row.reexpose(),
            };
            const row = this.buttonRow(btns, items, 0, (id) => {
                this.close(m);
                resolve(id);
            });
            this.push(m);
        });
    }
}
