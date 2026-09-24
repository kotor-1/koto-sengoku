/**
 * アプリ全体のつなぎ役。
 *   入力（platform）→ ゲーム状態（core）→ 表示（render / ui）
 * の流れをここで 1 か所にまとめる。
 *
 * 画面（mode）：
 *   title → play（探索）⇄ menu
 *   play →（源蔵との会話で「模擬戦をする」）→ battle ⇄ command（指揮・時間停止）→ result → play（城へ戻る）
 */
import { ARENA, OUTCOME_LABELS, RETAINER_IDS, RETAINER_NAMES, type BattleRecord, type OrderKind, type RetainerId } from './core/battle/model';
import { BattleSession } from './core/battle/session';
import { MAX_STEP_SEC } from './core/constants';
import { objectiveText } from './core/dialogue';
import { InputState } from './core/input';
import { AREA_NAMES, areaAtPixel } from './core/map';
import { SaveStore, fromSaveData, getBrowserStorage } from './core/save';
import { GameSession, type GameEvent } from './core/session';
import type { BattleView } from './render/battle/BattleLayer';
import type { WorldSource } from './render/WorldScene';
import { TIME_LABELS, isTimeOfDay, nextTime, type TimeOfDay } from './render/world/lighting';
import { bindKeyboard } from './platform/keyboard';
import { isTouchDevice, onInputInterrupt, preventPageGestures, watchOrientation } from './platform/page';
import { TouchControls } from './platform/touchControls';
import { BattleHud, type BattleHudView } from './ui/battleHud';
import { Hud, type HudMode, type HudView, type TitleInfo } from './ui/hud';

type Mode = HudMode;

/** 戦いが終わってから結果を出すまでの間（倒れる様子が見えるように） */
const RESULT_DELAY_SEC = 1.1;
/** 地図を「押した」とみなす指の動きと時間の上限 */
const TAP_SLOP_PX = 14;
const TAP_MAX_MS = 800;

interface CommandState {
    selected: RetainerId | null;
    /** 地図で選ぶ待ち */
    pick: 'move' | 'attack' | null;
    hint: string;
}

export class App implements WorldSource {
    private session: GameSession | null = null;
    /** 模擬戦（中でなければ null）。探索の状態はそのまま残し、終わったら戻る。 */
    private battle: BattleSession | null = null;
    private cmd: CommandState = { selected: 'genzo', pick: null, hint: '' };
    private resultDelay = RESULT_DELAY_SEC;
    private screenToWorld: ((x: number, y: number) => { x: number; y: number } | null) | null = null;
    private tap: { id: number; x: number; y: number; t: number } | null = null;
    private readonly battleHud: BattleHud;
    private mode: Mode = 'title';
    private readonly input = new InputState();
    private readonly store = new SaveStore(getBrowserStorage());
    private readonly hud: Hud;
    private readonly touch: TouchControls;
    private touchUI = false;
    private isPortraitBlocked: () => boolean = () => false;
    /** このプレイ中に最後に保存できた時刻 */
    private lastSavedAt: Date | null = null;
    /** 見た目の設定（時間帯）。ゲームの保存データとは別に、端末に覚えておくだけ。 */
    private timeOfDay: TimeOfDay = loadVisualPref();

    constructor() {
        this.hud = new Hud({
            onNewGame: () => this.startNew(),
            onContinue: () => this.continueFromSave(),
            onOpenMenu: () => this.openMenu(),
            onCloseMenu: () => this.closeMenu(),
            onSave: () => this.save(),
            onBackToTitle: () => this.backToTitle(),
            onCycleTime: () => this.cycleTime(),
            onChoice: (i) => this.chooseDialogue(i),
        });
        this.hud.setTimeLabel(TIME_LABELS[this.timeOfDay]);
        this.battleHud = new BattleHud({
            onCommand: () => this.openCommand(),
            onResume: () => this.resumeBattle(),
            onRetreat: () => this.retreat(),
            onSelectRetainer: (id) => this.selectRetainer(id),
            onOrder: (k) => this.order(k),
            onReturn: () => this.returnToCastle(),
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
            // 選択肢が出ているときは、枠を押しても決定しない（選択肢のボタンを押す）
            if (this.isGameplayActive() && !this.session?.currentChoices()) this.input.pressAction();
        });

        bindKeyboard(this.input, {
            isGameplayActive: () => this.isGameplayActive(),
            onMenuKey: () => {
                if (this.mode === 'menu') this.closeMenu();
                else if (this.mode === 'play') this.openMenu();
                else if (this.mode === 'battle') this.openCommand();
                else if (this.mode === 'command') {
                    if (this.cmd.pick) this.cancelPick();
                    else this.resumeBattle();
                }
            },
            onTimeKey: () => this.cycleTime(),
            onKey: (code) => this.handleKey(code),
        });

        // 指揮中：地図を押して移動先・攻撃目標・家臣を選ぶ（押して離すまでがほぼ動かなかったときだけ）
        const container = el('game-container');
        container.addEventListener('pointerdown', (e) => {
            this.tap = this.mode === 'command' ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
        });
        container.addEventListener('pointerup', (e) => {
            const t = this.tap;
            this.tap = null;
            if (!t || t.id !== e.pointerId || this.mode !== 'command') return;
            if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP_PX || performance.now() - t.t > TAP_MAX_MS) return;
            this.pickAt(e.clientX, e.clientY);
        });
        container.addEventListener('pointercancel', () => (this.tap = null));

        preventPageGestures();
        onInputInterrupt(() => this.releaseInput());
        // 模擬戦の最中にアプリ・タブを切り替えたら、指揮（時間停止）にしておく（戻ったときに不意を突かれない）
        const pauseOnLeave = () => {
            if (this.mode === 'battle') this.openCommand('画面を離れたので、時を止めました。');
        };
        window.addEventListener('blur', pauseOnLeave);
        window.addEventListener('pagehide', pauseOnLeave);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') pauseOnLeave();
        });

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

    getBattle(): BattleView | null {
        if (!this.battle) return null;
        return { session: this.battle, commanding: this.mode === 'command', selected: this.cmd.selected, pick: this.cmd.pick };
    }

    setScreenToWorld(fn: (x: number, y: number) => { x: number; y: number } | null): void {
        this.screenToWorld = fn;
    }

    getTimeOfDay(): TimeOfDay {
        return this.timeOfDay;
    }

    /** 時間帯（昼→夕→夜）を切り替える。見た目だけで、ゲームの進行には影響しない。 */
    private cycleTime(): void {
        this.timeOfDay = nextTime(this.timeOfDay);
        this.hud.setTimeLabel(TIME_LABELS[this.timeOfDay]);
        saveVisualPref(this.timeOfDay);
    }

    tick(dtSec: number): void {
        const s = this.session;
        if (!s) return;
        if (this.battle) {
            this.tickBattle(this.battle, s, dtSec);
            return;
        }
        if (this.isGameplayActive()) {
            const events = s.step(this.input.poll(), dtSec);
            for (const e of events) this.onGameEvent(e);
        } else {
            // 止まっている間に押されたボタンを、再開後に遅れて処理しない
            this.input.poll();
        }
        if (!this.battle) this.hud.render(this.hudView(s));
    }

    private onGameEvent(e: GameEvent): void {
        if (e.type === 'areaChanged') this.hud.showArea(AREA_NAMES[e.area]);
        else if (e.type === 'choiceSelected' && e.choice === 'spar') this.startBattle();
    }

    /** 会話の選択肢のボタンを押した */
    private chooseDialogue(index: number): void {
        if (!this.isGameplayActive() || !this.session) return;
        for (const e of this.session.selectChoice(index)) this.onGameEvent(e);
    }

    // ---- 模擬戦 ----

    private tickBattle(b: BattleSession, s: GameSession, dt: number): void {
        if (this.mode === 'battle' && !this.isPortraitBlocked()) {
            const wasOver = b.isOver;
            b.step(this.input.poll(), dt);
            if (!wasOver) s.state.playTimeSec += Math.min(Math.max(dt, 0), MAX_STEP_SEC);
            if (b.isOver) {
                this.resultDelay -= dt;
                if (this.resultDelay <= 0) this.showBattleResult();
            }
        } else {
            // 指揮中・結果表示中に押された攻撃などを、再開後に遅れて処理しない
            this.input.poll();
        }
        this.battleHud.render(this.battleHudView(b));
    }

    private battleHudView(b: BattleSession): BattleHudView {
        return { session: b, commanding: this.mode === 'command', selected: this.cmd.selected, pick: this.cmd.pick, hint: this.cmd.hint };
    }

    /** 模擬戦を始める（何度でも。毎回、全員全快・同じ配置から） */
    private startBattle(): void {
        if (!this.session || this.battle) return;
        // 会話の表示（会話中・選択肢の印）を先に消しておく（模擬戦中は探索の表示を描き直さないため）
        this.hud.render(this.hudView(this.session));
        this.battle = new BattleSession();
        this.cmd = { selected: 'genzo', pick: null, hint: '' };
        this.resultDelay = RESULT_DELAY_SEC;
        this.battleHud.show(true);
        this.hud.setBattleAction(true);
        this.setMode('battle');
        this.hud.showArea('東の原・訓練場');
        // 地名の表示と重ならないよう、少し遅れて案内する
        const b = this.battle;
        window.setTimeout(() => {
            if (this.battle === b && this.mode === 'battle') this.hud.toast('「指揮」を押すと時が止まり、家臣に命令できます', 'info', 4000);
        }, 1900);
    }

    /** 指揮：戦闘の時間を止めて、命令を選べるようにする */
    private openCommand(hint?: string): void {
        const b = this.battle;
        if (this.mode !== 'battle' || !b || b.isOver) return;
        b.pause();
        const alive = RETAINER_IDS.filter((id) => !b.unit(id)!.down);
        if (!this.cmd.selected || !alive.includes(this.cmd.selected)) this.cmd.selected = alive[0] ?? null;
        this.cmd.pick = null;
        this.cmd.hint = hint ?? (alive.length ? '家臣を選び、命令を押してください。' : '家臣は二人とも戦闘不能です。');
        this.setMode('command');
        this.battleHud.setCommanding(true);
    }

    /** 再開：全員が同時に動き出す */
    private resumeBattle(): void {
        const b = this.battle;
        if (this.mode !== 'command' || !b) return;
        this.cmd.pick = null;
        b.resume();
        this.battleHud.setCommanding(false);
        this.setMode('battle'); // 入力はここで全部解除される（指揮中の操作が若殿の移動・攻撃にならない）
    }

    private selectRetainer(id: RetainerId): void {
        const b = this.battle;
        if (this.mode !== 'command' || !b) return;
        const u = b.unit(id)!;
        if (u.down) {
            this.cmd.hint = `${u.name}は戦闘不能です。`;
            return;
        }
        this.cmd.selected = id;
        this.cmd.pick = null;
        this.cmd.hint = `${u.name}を選びました。命令を押してください。`;
    }

    private cycleRetainer(): void {
        const b = this.battle;
        if (!b) return;
        const alive = RETAINER_IDS.filter((id) => !b.unit(id)!.down);
        if (alive.length === 0) return;
        const i = this.cmd.selected ? alive.indexOf(this.cmd.selected) : -1;
        this.selectRetainer(alive[(i + 1) % alive.length]);
    }

    private order(kind: OrderKind): void {
        const b = this.battle;
        const id = this.cmd.selected;
        if (this.mode !== 'command' || !b || !id) return;
        const u = b.unit(id)!;
        if (u.down) {
            this.cmd.hint = `${u.name}は戦闘不能です。`;
            return;
        }
        switch (kind) {
            case 'follow':
                b.giveOrder(id, { kind: 'follow' });
                this.cmd.pick = null;
                this.cmd.hint = `${u.name}：若殿について戦います。`;
                break;
            case 'hold':
                b.giveOrder(id, { kind: 'hold', x: u.x, y: u.y });
                this.cmd.pick = null;
                this.cmd.hint = `${u.name}：その場で待ち構えます。`;
                break;
            case 'move':
            case 'attack':
                if (this.cmd.pick === kind) {
                    this.cancelPick();
                    break;
                }
                this.cmd.pick = kind;
                this.cmd.hint = kind === 'move' ? `${u.name}の移動先を、地図で押してください。` : `${u.name}が攻撃する相手を、地図で押してください。`;
                break;
        }
    }

    private cancelPick(): void {
        this.cmd.pick = null;
        this.cmd.hint = '選ぶのをやめました。';
    }

    /** 指揮中に地図を押した */
    private pickAt(clientX: number, clientY: number): void {
        const b = this.battle;
        const p = this.screenToWorld?.(clientX, clientY);
        if (!b || !p || this.mode !== 'command') return;
        const id = this.cmd.selected;
        // 家臣を押したら、その家臣を選ぶ（移動先を選んでいる最中は地点として、攻撃目標を選んでいる最中は近くの相手を優先）
        if (this.cmd.pick === null || (this.cmd.pick === 'attack' && !b.enemyNear(p.x, p.y, 16))) {
            const ally = RETAINER_IDS.map((r) => b.unit(r)!).find((u) => !u.down && Math.min(Math.hypot(u.x - p.x, u.y - p.y), Math.hypot(u.x - p.x, u.y - 14 - p.y)) <= 13);
            if (ally) {
                this.selectRetainer(ally.id as RetainerId);
                return;
            }
        }
        if (!id) return;
        const u = b.unit(id)!;
        if (this.cmd.pick === 'attack') {
            const e = b.enemyNear(p.x, p.y, 16);
            if (!e) {
                this.cmd.hint = '訓練相手（赤い輪）を押してください。';
                return;
            }
            b.giveOrder(id, { kind: 'attack', targetId: e.id });
            this.cmd.pick = null;
            this.cmd.hint = `${u.name}：${e.name}を攻撃します。`;
        } else if (this.cmd.pick === 'move') {
            const inside = p.x > ARENA.x0 - 8 && p.x < ARENA.x1 + 8 && p.y > ARENA.y0 - 8 && p.y < ARENA.y1 + 8;
            // 押した所が足元になるように少しだけ下げる（人物の体を押しがちなため）
            const q = inside ? b.validPoint(p.x, p.y + 2) : null;
            if (!q) {
                this.cmd.hint = 'そこへは行けません。訓練場（点線の内側）を押してください。';
                return;
            }
            b.giveOrder(id, { kind: 'move', x: q.x, y: q.y });
            this.cmd.pick = null;
            this.cmd.hint = `${u.name}：指定した場所へ向かいます。`;
        } else {
            this.cmd.hint = '先に命令（移動・攻撃）を押してから、地図を押してください。';
        }
    }

    private retreat(): void {
        const b = this.battle;
        if (this.mode !== 'command' || !b) return;
        b.retreat();
        this.showBattleResult();
    }

    private showBattleResult(): void {
        const b = this.battle;
        const r = b?.result();
        if (!b || !r || this.mode === 'result') return;
        this.battleHud.showResult(r, b);
        this.setMode('result');
    }

    /** 城へ戻る：結果を記録し、源蔵の隣に立って結果の会話を始める */
    private returnToCastle(): void {
        const b = this.battle;
        const s = this.session;
        const r = b?.result();
        if (this.mode !== 'result' || !b || !s || !r) return;
        this.battle = null;
        this.battleHud.show(false);
        this.hud.setBattleAction(false);
        s.returnFromBattle(r);
        this.setMode('play');
        this.hud.showArea(AREA_NAMES[s.state.area]);
        s.talkTo('retainer');
        this.hud.render(this.hudView(s));
    }

    /** 画面ごとの追加のキー */
    private handleKey(code: string): boolean {
        if (this.mode === 'battle') {
            if (code === 'KeyC' || code === 'KeyQ') {
                this.openCommand();
                return true;
            }
            return false;
        }
        if (this.mode === 'command') {
            const orders: Record<string, OrderKind> = { Digit1: 'follow', Digit2: 'hold', Digit3: 'move', Digit4: 'attack' };
            if (code === 'KeyC' || code === 'KeyQ') this.resumeBattle();
            else if (code === 'Tab') this.cycleRetainer();
            else if (orders[code]) this.order(orders[code]);
            else return false;
            return true;
        }
        if (this.mode === 'result' && (code === 'Enter' || code === 'Space' || code === 'NumpadEnter')) {
            this.returnToCastle();
            return true;
        }
        return false;
    }

    // ---- 画面遷移 ----

    private isGameplayActive(): boolean {
        return (this.mode === 'play' || this.mode === 'battle') && this.session !== null && !this.isPortraitBlocked();
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
        this.battle = null;
        this.battleHud.show(false);
        this.hud.setBattleAction(false);
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
        this.hud.showMenu(this.lastSavedText(), battleRecordText(this.session.state.battle));
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
                const b = d.battle;
                const tally = b.last ? `　模擬戦 ${b.victories}勝${b.defeats}敗${b.retreats}撤退` : '';
                return {
                    canContinue: true,
                    saveText: `保存データ：${formatTime(new Date(d.savedAt))}　${area}　${mins}分${tally}`,
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
        const choices = s.currentChoices();
        return {
            objective: objectiveText(s.state.flags, s.state.battle),
            dialogue:
                line && d
                    ? { ...line, isLast: d.index >= d.script.lines.length - 1, choices: choices ? choices.map((c) => c.label) : null, choice: d.choice }
                    : null,
            prompt: near ? { verb: near.verb, name: near.name } : null,
        };
    }
}

/** メニューに出す模擬戦の記録 */
function battleRecordText(b: BattleRecord): string {
    if (!b.last) return '模擬戦の記録：まだありません。';
    const down = RETAINER_IDS.filter((id) => b.last!.retainersDown[id]).map((id) => RETAINER_NAMES[id]);
    const detail = down.length ? `${down.join('・')} 戦闘不能` : '家臣は無事';
    return `模擬戦の記録：前回 ${OUTCOME_LABELS[b.last.outcome]}（${detail}）・通算 ${b.victories}勝 ${b.defeats}敗 ${b.retreats}撤退`;
}

const VISUAL_KEY = 'koto-sengoku/visual';

function loadVisualPref(): TimeOfDay {
    try {
        const v = JSON.parse(localStorage.getItem(VISUAL_KEY) ?? 'null') as { timeOfDay?: unknown } | null;
        if (v && isTimeOfDay(v.timeOfDay)) return v.timeOfDay;
    } catch {
        /* 読めなければ既定値 */
    }
    return 'evening';
}

function saveVisualPref(t: TimeOfDay): void {
    try {
        localStorage.setItem(VISUAL_KEY, JSON.stringify({ timeOfDay: t }));
    } catch {
        /* 見た目の好みなので、覚えられなくても支障はない */
    }
}

function formatTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
