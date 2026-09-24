/**
 * 画面の文字・ボタン類（DOM）。表示するだけで、ゲームの状態は持たない。
 * App から渡された HudView をそのまま画面に反映する。
 */

export interface HudView {
    objective: string;
    dialogue: { speaker: string; text: string; isLast: boolean } | null;
    /** 近くに話しかけ／調べられるものがあるとき */
    prompt: { verb: string; name: string } | null;
}

export interface TitleInfo {
    canContinue: boolean;
    saveText: string;
    /** 保存できない環境などの注意書き */
    warning?: string;
}

export type ToastKind = 'ok' | 'error' | 'info';

export interface HudHandlers {
    onNewGame(): void;
    onContinue(): void;
    onOpenMenu(): void;
    onCloseMenu(): void;
    onSave(): void;
    onBackToTitle(): void;
    onCycleTime(): void;
}

function $(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} が index.html にありません`);
    return el;
}

export class Hud {
    private readonly title = $('title');
    private readonly btnContinue = $('btn-continue') as HTMLButtonElement;
    private readonly saveInfo = $('save-info');
    private readonly saveWarning = $('save-warning');
    private readonly menu = $('menu');
    private readonly menuSaveInfo = $('menu-save-info');
    private readonly menuStatus = $('menu-status');
    private readonly btnTitle = $('btn-title');
    private readonly objective = $('objective');
    private readonly areaBanner = $('area-banner');
    private readonly dialogue = $('dialogue');
    private readonly speaker = $('dialogue-speaker');
    private readonly text = $('dialogue-text');
    private readonly next = $('dialogue-next');
    private readonly prompt = $('prompt');
    private readonly actionBtn = $('action-btn');
    private readonly toastEl = $('toast');
    private readonly timeBtn = $('time-btn');

    private last = { objective: '', dialogueKey: '', promptKey: '' };
    private confirmTitle = false;
    private toastTimer = 0;

    constructor(h: HudHandlers) {
        $('btn-new').addEventListener('click', () => h.onNewGame());
        this.btnContinue.addEventListener('click', () => h.onContinue());
        $('menu-btn').addEventListener('click', () => h.onOpenMenu());
        this.timeBtn.addEventListener('click', () => {
            h.onCycleTime();
            this.timeBtn.blur();
        });
        $('btn-close').addEventListener('click', () => h.onCloseMenu());
        $('btn-save').addEventListener('click', () => h.onSave());
        this.btnTitle.addEventListener('click', () => {
            if (!this.confirmTitle) {
                this.confirmTitle = true;
                this.btnTitle.textContent = 'もう一度押すとタイトルへ（未保存の進行は失われます）';
                return;
            }
            h.onBackToTitle();
        });
        // 暗い背景を押したらメニューを閉じる
        this.menu.addEventListener('click', (e) => {
            if (e.target === this.menu) h.onCloseMenu();
        });
    }

    setTimeLabel(label: string): void {
        this.timeBtn.querySelector('.time-label')!.textContent = label;
        this.timeBtn.setAttribute('aria-label', `時間帯：${label}（押すと切り替え）`);
    }

    setMode(mode: 'title' | 'play' | 'menu'): void {
        const b = document.body.classList;
        b.toggle('mode-title', mode === 'title');
        b.toggle('mode-play', mode === 'play');
        b.toggle('mode-menu', mode === 'menu');
        this.title.hidden = mode !== 'title';
        this.menu.hidden = mode !== 'menu';
        // キーボード操作が、前に押したボタンへ流れないようにフォーカスを外す
        (document.activeElement as HTMLElement | null)?.blur?.();
    }

    showTitle(info: TitleInfo): void {
        this.btnContinue.disabled = !info.canContinue;
        this.saveInfo.textContent = info.saveText;
        this.saveWarning.textContent = info.warning ?? '';
        this.saveWarning.hidden = !info.warning;
        this.setMode('title');
    }

    showMenu(lastSavedText: string): void {
        this.menuSaveInfo.textContent = lastSavedText;
        this.menuStatus.textContent = '';
        this.menuStatus.className = '';
        this.confirmTitle = false;
        this.btnTitle.textContent = 'タイトルへ戻る';
        this.setMode('menu');
    }

    setMenuStatus(text: string, kind: ToastKind): void {
        this.menuStatus.textContent = text;
        this.menuStatus.className = `status-${kind}`;
    }

    setMenuSaveInfo(text: string): void {
        this.menuSaveInfo.textContent = text;
    }

    showArea(name: string): void {
        const el = this.areaBanner;
        el.textContent = name;
        el.classList.remove('show');
        void el.offsetWidth; // アニメーションを最初からやり直す
        el.classList.add('show');
    }

    toast(text: string, kind: ToastKind, ms = 2600): void {
        const el = this.toastEl;
        el.textContent = text;
        el.className = `toast-${kind} show`;
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
    }

    render(v: HudView): void {
        if (v.objective !== this.last.objective) {
            this.last.objective = v.objective;
            this.objective.textContent = v.objective;
        }

        const dKey = v.dialogue ? `${v.dialogue.speaker}\u0000${v.dialogue.text}` : '';
        if (dKey !== this.last.dialogueKey) {
            this.last.dialogueKey = dKey;
            document.body.classList.toggle('in-dialogue', v.dialogue !== null);
            this.dialogue.hidden = v.dialogue === null;
            if (v.dialogue) {
                this.speaker.textContent = v.dialogue.speaker;
                this.text.textContent = v.dialogue.text;
                this.next.textContent = v.dialogue.isLast ? '■' : '▼';
            }
        }

        const pKey = v.dialogue ? 'dialogue' : v.prompt ? `${v.prompt.verb}:${v.prompt.name}` : '';
        if (pKey !== this.last.promptKey) {
            this.last.promptKey = pKey;
            this.prompt.hidden = !v.prompt || v.dialogue !== null;
            if (v.prompt) {
                const particle = v.prompt.verb === '話す' ? 'と' : 'を';
                this.prompt.querySelector('.prompt-label')!.textContent = `${v.prompt.name}${particle}${v.prompt.verb}`;
            }
            const label = v.dialogue ? '次へ' : v.prompt ? v.prompt.verb : '話す';
            this.actionBtn.textContent = label;
            this.actionBtn.classList.toggle('idle', !v.dialogue && !v.prompt);
        }
    }
}
