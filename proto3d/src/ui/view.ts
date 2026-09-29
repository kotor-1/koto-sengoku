/**
 * 第一章の画面（DOM）：目的・メニューのボタン・話すボタン・段階の案内・知らせと、
 * 画面を覆うもの（タイトル・会話と選択肢・軍議・確認・メニュー・結末・開発用の合戦の仮の選択）。
 *
 * campaign/game.ts の GameView を満たす。状態は持たない（見せて、押されたものを返すだけ）。
 * 入力の決まり（docs/design-policy.md §2）：ボタンは押した瞬間（pointerdown）に反応し、
 * 出たばかりの選択肢・ボタンはしばらく押しても決まらない（連打で次の選択まで進まないように）。
 * キーボード：会話は Enter／Space／E で進む、選択肢は ↑↓（W／S）で選んで Enter、数字でも選べる。Esc はメニュー・やめる。
 */
import './ui.css';
import type { BattleResultKind, BattleSetup } from '../battle/types';
import type { ConfirmOptions, GameView, HudInfo, MenuAction, MenuInfo, PromptInfo, ScriptOptions, TitleAction, TitleInfo } from '../campaign/game';
import type { ChoiceId } from '../campaign/state';
import { CHAPTER_TITLE, PROVISIONAL_LABEL, type EndingView, type Script } from '../campaign/story';
import { el, nowMs, onPress } from './dom';

/** 出たばかりの選択肢・ボタンを押しても決まらない時間（ミリ秒） */
const CHOICE_GUARD_MS = 350;
/** 会話を続けて進めるときの最短の間（ミリ秒。二度押しで 2 行進まないように） */
const ADVANCE_GUARD_MS = 140;

type ModalKind = 'title' | 'script' | 'confirm' | 'menu' | 'ending' | 'devBattle';

/** 確認用（開発ビルドの __game）：今の画面の中身と、押す操作 */
export interface ModalProbe {
    kind: ModalKind;
    /** 会話：台詞の id（story.ts の Script.id）・今の行・全部の行・選択肢 */
    id?: string;
    line?: { name: string; text: string };
    index?: number;
    count?: number;
    choices?: string[];
    selected?: string | null;
    /** 確認・メニュー・タイトル・結末：ボタンの id と文字 */
    buttons?: { id: string; label: string; disabled: boolean }[];
    text?: string;
}

interface Modal {
    kind: ModalKind;
    layer: HTMLElement;
    key(e: KeyboardEvent): void;
    probe(): ModalProbe;
    /** 確認用：進める（会話） */
    advance?(): void;
    /** 確認用：押す（選択肢・ボタンの id）。押せなければ false */
    press(id: string): boolean;
}

const isGo = (e: KeyboardEvent) => e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyE';
const isUp = (e: KeyboardEvent) => e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ArrowLeft' || e.code === 'KeyA';
const isDown = (e: KeyboardEvent) => e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Tab';

export class DomView implements GameView {
    readonly root: HTMLElement;
    private readonly hudEl: HTMLElement;
    private readonly hudPhase: HTMLElement;
    private readonly hudChapter: HTMLElement;
    private readonly hudObj: HTMLElement;
    private readonly menuBtn: HTMLButtonElement;
    private readonly talkBtn: HTMLButtonElement;
    private readonly talkVerb: HTMLElement;
    private readonly talkWho: HTMLElement;
    private readonly introEl: HTMLElement;
    private readonly toastEl: HTMLElement;
    private readonly modals: Modal[] = [];
    private introTimers: number[] = [];
    private toastTimer = 0;
    /** 「話す」ボタン・E／Enter／Space */
    onTalk: () => void = () => {};
    /** メニューのボタン・Esc／M */
    onMenu: () => void = () => {};
    /** 探索の場面を覆う画面（会話以外：タイトル・軍議・確認・メニュー・結末）が開いた／閉じた。覆っている間は探索の描画を止めてよい */
    onCover: (covered: boolean) => void = () => {};

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
        onPress(this.menuBtn, () => this.onMenu());
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
        this.toastEl.setAttribute('role', 'status');
        this.toastEl.addEventListener('pointerdown', () => (this.toastEl.hidden = true));
        this.root.append(this.hudEl, this.menuBtn, this.talkBtn, this.introEl, this.toastEl);
        app.appendChild(this.root);
        window.addEventListener('keydown', this.onKey);
    }

    // ---------------- 常に出ているもの ----------------

    hud(info: HudInfo | null): void {
        const show = !!info;
        this.hudEl.hidden = !show;
        this.menuBtn.hidden = !show;
        if (!info) return;
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
    }

    private covered = false;
    private updateCover(): void {
        const c = this.modals.some((m) => m.kind !== 'script' || m.layer.classList.contains('council'));
        if (c === this.covered) return;
        this.covered = c;
        this.onCover(c);
    }

    private close(m: Modal): void {
        const i = this.modals.indexOf(m);
        if (i >= 0) this.modals.splice(i, 1);
        m.layer.remove();
        this.updateCover();
        if (this.modals.length === 0) document.body.classList.remove('g-modal');
        if (!this.modals.some((x) => x.kind === 'title')) document.body.classList.remove('g-title');
    }

    private onKey = (e: KeyboardEvent): void => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const top = this.modals[this.modals.length - 1];
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
        }
    };

    /** 確認用：一番上の画面 */
    probe(): ModalProbe | null {
        const top = this.modals[this.modals.length - 1];
        return top ? top.probe() : null;
    }
    /** 確認用：開いている画面をすべて閉じる（待っている流れは捨てる。開発ビルドの __game.setPhase だけ） */
    devReset(): void {
        for (const m of [...this.modals]) this.close(m);
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
     * ボタンの並び（確認・メニュー・タイトル・結末・合戦の仮の選択で共用）。
     * ↑↓←→ で選び Enter／Space で押す。出たばかりは押しても決まらない（選ぶだけ）。
     */
    private buttonRow(
        container: HTMLElement,
        items: { id: string; label: string; sub?: string; disabled?: boolean }[],
        defaultIndex: number,
        onPick: (id: string) => void,
    ): { key(e: KeyboardEvent): boolean; buttons: { id: string; label: string; disabled: boolean }[]; press(id: string): boolean } {
        const shownAt = nowMs();
        const btns: HTMLButtonElement[] = [];
        let sel = Math.max(0, Math.min(items.length - 1, defaultIndex));
        if (items[sel]?.disabled) sel = Math.max(0, items.findIndex((i) => !i.disabled));
        const mark = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
        let done = false;
        const pick = (i: number, force = false) => {
            if (done || items[i]!.disabled) return false;
            if (!force && nowMs() - shownAt < CHOICE_GUARD_MS) {
                sel = i;
                mark();
                return false;
            }
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
            onPress(b, () => pick(i));
            btns.push(b);
            container.appendChild(b);
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
                    if (!e.repeat) pick(sel);
                } else return false;
                e.preventDefault();
                return true;
            },
            buttons: items.map((i) => ({ id: i.id, label: i.label, disabled: !!i.disabled })),
            press: (id) => {
                const i = items.findIndex((x) => x.id === id);
                return i >= 0 && pick(i, true);
            },
        };
    }

    title(info: TitleInfo): Promise<TitleAction> {
        return new Promise((resolve) => {
            const layer = this.open('title', 'solid g-title-layer');
            const box = el('div', 'g-title-box');
            box.append(el('p', 'kicker', '戦国探索記 3D'), el('h1', undefined, CHAPTER_TITLE));
            const prov = el('p', 'prov');
            prov.append(el('span', 'g-tag', PROVISIONAL_LABEL));
            box.append(prov);
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
            };
            const row = this.buttonRow(btnBox, items, info.save ? 1 : 0, (id) => {
                this.close(m);
                resolve(id as TitleAction);
            });
            if (info.problem) box.append(el('p', 'problem', info.problem));
            box.append(el('p', 'g-note', info.note));
            layer.append(box);
            this.push(m);
        });
    }

    script(sc: Script, opts: ScriptOptions): Promise<ChoiceId | null> {
        return new Promise((resolve) => {
            const council = opts.mode === 'council';
            const layer = this.open('script', council ? 'council' : '');
            if (council) {
                const head = el('div', 'g-council-head');
                head.append(el('h2', undefined, '軍議'), el('p', undefined, `城の広間・${PROVISIONAL_LABEL}`));
                layer.append(head);
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
            const lines = sc.lines.length ? sc.lines : [{ speaker: 'narration' as const, name: '', text: '……' }];
            const choices = sc.choices ?? [];
            let i = 0;
            let sel = Math.max(0, Math.min(choices.length - 1, sc.defaultChoice ?? 0));
            let choicesAt = 0;
            let last = nowMs();
            let done = false;
            const choiceBtns: HTMLButtonElement[] = [];
            const mark = () => choiceBtns.forEach((b, k) => b.classList.toggle('sel', k === sel));
            const finish = (v: ChoiceId | null) => {
                if (done) return;
                done = true;
                this.close(m);
                resolve(v);
            };
            const pick = (k: number, force = false) => {
                if (done || choicesEl.hidden || !choices[k]) return false;
                if (!force && nowMs() - choicesAt < CHOICE_GUARD_MS) {
                    sel = k;
                    mark();
                    return false;
                }
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
                    onPress(b, () => pick(k));
                    choiceBtns.push(b);
                    choicesEl.append(b);
                });
                choicesEl.hidden = false;
                choicesAt = nowMs();
                mark();
            };
            const render = () => {
                const line = lines[i]!;
                name.textContent = line.name;
                name.classList.toggle('hero', line.speaker === 'hero');
                text.textContent = line.text;
                text.classList.toggle('narration', line.speaker === 'narration');
                count.textContent = lines.length > 1 ? `${i + 1}/${lines.length}` : '';
                const atEnd = i === lines.length - 1;
                more.hidden = atEnd && choices.length > 0;
                if (atEnd && choices.length > 0 && choicesEl.hidden) showChoices();
            };
            const advance = (force = false) => {
                if (done) return;
                if (!force && nowMs() - last < ADVANCE_GUARD_MS) return;
                last = nowMs();
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
                advance();
            });
            const m: Modal = {
                kind: 'script',
                layer,
                key: (e) => {
                    if (!choicesEl.hidden) {
                        if (isUp(e)) sel = (sel + choices.length - 1) % choices.length;
                        else if (isDown(e)) sel = (sel + 1) % choices.length;
                        else if (isGo(e)) {
                            if (!e.repeat) pick(sel);
                        } else if (/^Digit[1-9]$/.test(e.code)) {
                            const k = Number(e.code.slice(5)) - 1;
                            if (k < choices.length && !e.repeat) pick(k);
                        } else return;
                        mark();
                        e.preventDefault();
                        return;
                    }
                    if (isGo(e)) {
                        e.preventDefault();
                        if (!e.repeat) advance();
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
                advance: () => advance(true),
                press: (id) => {
                    const k = choices.findIndex((c) => c.id === id);
                    return k >= 0 && pick(k, true);
                },
            };
            this.push(m);
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
                    if (e.code === 'Escape' || (e.code === 'KeyM' && !e.repeat)) {
                        e.preventDefault();
                        row.press('close');
                        return;
                    }
                    row.key(e);
                },
                probe: () => ({ kind: 'menu', buttons: row.buttons, text: panel.textContent ?? '' }),
                press: (id) => row.press(id),
            };
            const row = this.buttonRow(btns, items, info.message ? 2 : info.canSave ? 0 : 2, (id) => {
                this.close(m);
                resolve(id as MenuAction);
            });
            this.push(m);
        });
    }

    ending(v: EndingView): Promise<void> {
        return new Promise((resolve) => {
            const layer = this.open('ending', 'solid');
            const scroll = el('div', 'g-ending g-scroll');
            const inner = el('div', 'g-ending-inner');
            inner.append(el('p', 'kicker', `${CHAPTER_TITLE}　結末`), el('h1', undefined, v.title));
            const body = el('div', 'body');
            for (const p of v.body) body.append(el('p', undefined, p));
            inner.append(body);
            const rec = el('div', 'record');
            rec.append(el('h2', undefined, '記録'));
            const dl = el('dl', 'g-status');
            for (const r of v.record) dl.append(el('dt', undefined, r.label), el('dd', undefined, r.value));
            rec.append(dl);
            inner.append(rec, el('p', 'footer', v.footer));
            const btns = el('div');
            inner.append(btns);
            scroll.append(inner);
            layer.append(scroll);
            const m: Modal = {
                kind: 'ending',
                layer,
                key: (e) => void row.key(e),
                probe: () => ({ kind: 'ending', buttons: row.buttons, text: inner.textContent ?? '' }),
                press: (id) => row.press(id),
            };
            const row = this.buttonRow(btns, [{ id: 'title', label: 'タイトルへ' }], 0, () => {
                this.close(m);
                resolve();
            });
            this.push(m);
        });
    }

    /** 開発ビルドだけ：合戦の画面がまだ無いときの、テスト用の結果の選択（本番のビルドには入らない） */
    readonly devBattle = import.meta.env.DEV ? (setup: BattleSetup): Promise<BattleResultKind> => this.devBattleScreen(setup) : undefined;

    private devBattleScreen(setup: BattleSetup): Promise<BattleResultKind> {
        if (!import.meta.env.DEV) return Promise.reject(new Error('開発ビルドだけ'));
        return new Promise((resolve) => {
            const layer = this.open('devBattle', 'solid');
            const panel = el('div', 'g-panel g-scroll');
            panel.append(
                el('h2', undefined, '合戦（テスト用の仮の画面）'),
                el('p', 'g-test', '【テスト用・開発ビルドだけ】合戦の画面が登録されていないため、結果を選んで先へ進めます。本番の画面ではこの選択は出ません。'),
                ...setup.briefing.map((t) => el('p', 'g-note', t)),
                el('p', 'g-note', `部隊：${setup.units.map((u) => `${u.side === 'ally' ? '味方' : '敵'}・${u.name} ${u.strength}`).join('／')}`),
            );
            const btns = el('div', 'btns');
            panel.append(btns);
            layer.append(panel);
            const m: Modal = {
                kind: 'devBattle',
                layer,
                key: (e) => void row.key(e),
                probe: () => ({ kind: 'devBattle', buttons: row.buttons, text: panel.textContent ?? '' }),
                press: (id) => row.press(id),
            };
            const row = this.buttonRow(
                btns,
                [
                    { id: 'victory', label: '勝利にする' },
                    { id: 'defeat', label: '敗北にする' },
                    { id: 'retreat', label: '撤退にする' },
                ],
                0,
                (id) => {
                    this.close(m);
                    resolve(id as BattleResultKind);
                },
            );
            this.push(m);
        });
    }
}
