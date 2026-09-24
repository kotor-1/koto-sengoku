/**
 * アプリ全体のつなぎ役。
 *   入力（platform）→ ゲーム状態（core）→ 表示（render / ui）
 * の流れをここで 1 か所にまとめる。
 */
import { objectiveText } from './core/dialogue';
import { InputState } from './core/input';
import { AREA_NAMES, areaAtPixel } from './core/map';
import { SaveStore, fromSaveData, getBrowserStorage } from './core/save';
import { GameSession } from './core/session';
import type { WorldSource } from './render/WorldScene';
import { bindKeyboard } from './platform/keyboard';
import { isTouchDevice, onInputInterrupt, preventPageGestures, watchOrientation } from './platform/page';
import { TouchControls } from './platform/touchControls';
import { Hud, type HudView, type TitleInfo } from './ui/hud';

type Mode = 'title' | 'play' | 'menu';

export class App implements WorldSource {
    private session: GameSession | null = null;
    private mode: Mode = 'title';
    private readonly input = new InputState();
    private readonly store = new SaveStore(getBrowserStorage());
    private readonly hud: Hud;
    private readonly touch: TouchControls;
    private touchUI = false;
    private isPortraitBlocked: () => boolean = () => false;
    /** このプレイ中に最後に保存できた時刻 */
    private lastSavedAt: Date | null = null;

    constructor() {
        this.hud = new Hud({
            onNewGame: () => this.startNew(),
            onContinue: () => this.continueFromSave(),
            onOpenMenu: () => this.openMenu(),
            onCloseMenu: () => this.closeMenu(),
            onSave: () => this.save(),
            onBackToTitle: () => this.backToTitle(),
        });

        const el = (id: string) => document.getElementById(id)!;
        this.touch = new TouchControls(
            { zone: el('stick-zone'), base: el('stick-base'), knob: el('stick-knob'), action: el('action-btn') },
            this.input,
            {
                canMove: () => this.isGameplayActive() && !this.session?.state.dialogue,
                canAct: () => this.isGameplayActive(),
            },
        );
        el('dialogue').addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (this.isGameplayActive()) this.input.pressAction();
        });

        bindKeyboard(this.input, {
            isGameplayActive: () => this.isGameplayActive(),
            onMenuKey: () => {
                if (this.mode === 'menu') this.closeMenu();
                else if (this.mode === 'play') this.openMenu();
            },
        });

        preventPageGestures();
        onInputInterrupt(() => this.releaseInput());

        this.setTouchUI(isTouchDevice());
        // タッチ端末の判定をすり抜けても、実際に指で触れたらスマホ用表示にする
        window.addEventListener(
            'pointerdown',
            (e) => {
                if (e.pointerType === 'touch') this.setTouchUI(true);
            },
            { capture: true },
        );
        this.isPortraitBlocked = watchOrientation(
            () => this.touchUI,
            () => this.releaseInput(),
        );

        this.showTitle();
    }

    // ---- WorldSource（Phaser から毎フレーム呼ばれる） ----

    getSession(): GameSession | null {
        return this.session;
    }

    tick(dtSec: number): void {
        const s = this.session;
        if (!s) return;
        if (this.isGameplayActive()) {
            const events = s.step(this.input.poll(), dtSec);
            for (const e of events) {
                if (e.type === 'areaChanged') this.hud.showArea(AREA_NAMES[e.area]);
            }
        } else {
            // 止まっている間に押されたボタンを、再開後に遅れて処理しない
            this.input.poll();
        }
        this.hud.render(this.hudView(s));
    }

    // ---- 画面遷移 ----

    private isGameplayActive(): boolean {
        return this.mode === 'play' && this.session !== null && !this.isPortraitBlocked();
    }

    private releaseInput(): void {
        this.input.releaseAll();
        this.touch.reset();
    }

    private setTouchUI(on: boolean): void {
        this.touchUI = on;
        document.body.classList.toggle('touch-ui', on);
    }

    private setMode(mode: Mode): void {
        this.mode = mode;
        this.releaseInput();
        this.hud.setMode(mode);
    }

    private showTitle(): void {
        this.session = null;
        this.mode = 'title';
        this.releaseInput();
        this.hud.showTitle(this.titleInfo());
    }

    private startNew(): void {
        this.session = new GameSession();
        this.lastSavedAt = null;
        this.setMode('play');
        this.hud.showArea(AREA_NAMES[this.session.state.area]);
    }

    private continueFromSave(): void {
        const res = this.store.load();
        if (res.status !== 'ok') {
            const msg = res.status === 'none' ? '保存データがありません。' : res.message;
            this.hud.toast(`続きから始められません：${msg}`, 'error', 4000);
            this.hud.showTitle(this.titleInfo());
            return;
        }
        this.session = new GameSession(fromSaveData(res.data));
        this.lastSavedAt = new Date(res.data.savedAt);
        this.setMode('play');
        this.hud.showArea(AREA_NAMES[this.session.state.area]);
    }

    private openMenu(): void {
        if (this.mode !== 'play' || !this.session) return;
        this.hud.showMenu(this.lastSavedText());
        this.setMode('menu');
    }

    private closeMenu(): void {
        if (this.mode !== 'menu') return;
        this.setMode('play');
    }

    private backToTitle(): void {
        this.showTitle();
    }

    // ---- 保存 ----

    private save(): void {
        const s = this.session;
        if (!s) return;
        const res = this.store.save(s.state);
        if (res.ok) {
            this.lastSavedAt = new Date(res.savedAt);
            this.hud.setMenuStatus('保存しました。', 'ok');
            this.hud.setMenuSaveInfo(this.lastSavedText());
            this.hud.toast('保存しました', 'ok');
        } else {
            // 失敗したときは「保存しました」とは絶対に表示しない
            this.hud.setMenuStatus(`保存に失敗しました。${res.message}`, 'error');
            this.hud.toast('保存に失敗しました', 'error', 4000);
        }
    }

    private lastSavedText(): string {
        if (!this.store.available) return 'この環境では端末内に保存できません。';
        if (!this.lastSavedAt) return 'このプレイはまだ保存していません。';
        return `最後の保存：${formatTime(this.lastSavedAt)}`;
    }

    private titleInfo(): TitleInfo {
        const res = this.store.load();
        switch (res.status) {
            case 'ok': {
                const d = res.data;
                const area = AREA_NAMES[areaAtPixel(d.player.x, d.player.y)];
                const mins = Math.floor(d.playTimeSec / 60);
                return {
                    canContinue: true,
                    saveText: `保存データ：${formatTime(new Date(d.savedAt))}　${area}　${mins}分`,
                };
            }
            case 'none':
                return { canContinue: false, saveText: '保存データはありません。' };
            case 'corrupt':
                return { canContinue: false, saveText: '保存データを読み込めません。', warning: res.message };
            case 'unavailable':
                return {
                    canContinue: false,
                    saveText: '保存データを確認できません。',
                    warning: `${res.message} 遊ぶことはできますが、保存はできません。`,
                };
        }
    }

    private hudView(s: GameSession): HudView {
        const line = s.currentLine();
        const d = s.state.dialogue;
        const near = d ? null : s.nearbyInteractable();
        return {
            objective: objectiveText(s.state.flags),
            dialogue: line && d ? { ...line, isLast: d.index >= d.script.lines.length - 1 } : null,
            prompt: near ? { verb: near.verb, name: near.name } : null,
        };
    }
}

function formatTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
