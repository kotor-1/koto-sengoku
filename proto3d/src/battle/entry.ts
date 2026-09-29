/**
 * 合戦の画面のつなぎ。import すると app/modes.ts に合戦の始め方（registerBattleRunner）を登録する。
 *
 *   const outcome = await getBattleRunner()!(setup);   // 章の進行（campaign）・開発の確認（?dev=battle）から
 *
 * 1 回の合戦（BattleRun）でしていること：
 * - 探索と同じ描画器で、別の場面（view.ts）を描く。場面に入る（enterMode('battle')）と探索の入力・描画は止まる。
 * - 合戦の計算（sim.ts）を進める。指揮（一時停止）中は進めない（命令は出せる）。速さ ×1・×2。
 * - 画面の部品（battleUi.ts）：部隊の札・命令のボタン・条件・知らせ・説明・確かめ・結果。
 * - 入力（docs/design-policy.md の入力の決まりにならう）：
 *   - 地図：1 本指・左ドラッグで動かす、2 本指・ホイール・ボタンで寄る／引く。押して離す（動かさない）と「押した」扱い。
 *   - 指を離した・キャンセル・捕捉が外れたら、その指の操作は終わり（触り直すまで再開しない）。
 *   - 画面を離れた（blur・visibilitychange・pagehide）ら、自動で指揮（一時停止）にして入力を離す。
 *   - キー：Space 指揮／再開、1〜8 部隊（札の順）、M 移動・A 攻撃・H 防衛・待機・R 撤退、Esc 取り消し、矢印で地図、+ − 0 で寄る・引く・全体。
 *     特殊能力のある合戦（歴史分岐）は F（または「能力」）で選んだ部隊の能力を使う。援護（対象を選ぶ能力）は、その後で味方の部隊・札を押す。
 *     不適切な対象は理由を出すだけで回数を減らさない（abilities.ts の useAbility が確かめる）。指揮中（一時停止）も使える。
 * - 選んでいる部隊は id の並び（selection。今は 0 か 1 部隊）で持ち、命令は control.ts の orderUnits で並びの部隊へ出す
 *   （複数の選択・部隊のまとまりは、この並びを広げれば足せる）。
 * - 戦前の約束（BattleSetup.pledge）：対象の部隊の名札を目立たせ、南の「味方の陣」を地図に描き、条件の欄に進み具合、結果の画面に勝敗と別に結果を出す。
 * - 合戦場のデータの戦場（fields/ の buildBattleSetup）：目標の区域・援軍の出る所・狭い正面を地図に描き（view.ts）、名札（control.ts の mapLabels）、
 *   目標の欄に進み具合、結果の画面に主目標・副目標を勝敗・約束と別の行で出す。
 * - 結果を出し、「続ける」で後片付け（形・材質・画像・DOM・listener）をして探索へ戻り（exitMode）、結果を返す。
 */
import { appContext, enterMode, exitMode, registerBattleRunner, type AppContext, type Mode } from '../app/modes';
import { loadModel } from '../app/models';
import type { BattleOutcome, BattleRunHooks, BattleSetup, Order } from './types';
import { canCommand, createBattle, elevationAt, issueOrder, orderAllRetreat, stepBattle, unitById, type BattleEvent, type BattleState } from './sim';
import { BattleView } from './view';
import { BattleUi, type CommandKind } from './battleUi';
import { useAbility } from './abilities';
import {
    RESULT_LABEL,
    abilitiesUsedText,
    abilityPanelModel,
    commandableIds,
    eventTone,
    fmtClock,
    leadOf,
    mapLabels,
    objectiveResultModel,
    objectiveUnitMarks,
    orderUnits,
    orderUnitsText,
    pledgeResultModel,
    pruneSelection,
    refusalText,
    resolveTap,
    resultRows,
    scenarioTexts,
    selectOnly,
    selectedOf,
    unitMarksText,
    type MapLabel,
    type Pending,
    type Selected,
    type TapTarget,
} from './control';

/** 木の読み込みを待つ最長（これを過ぎたら円すいの木のまま始められる） */
const TREE_TIMEOUT_MS = 12000;
/** 押したとみなす指・マウスの動きの上限（px） */
const TAP_SLOP = { touch: 12, mouse: 6 };
/**
 * 部隊「そのもの」を押したとみなす最小の半径（px。隊列の広がりが画面でこれより大きければ、そちら）。
 * これより外で、押しやすくするための余白（タッチ 30 px・マウス 20 px）の中は「すぐ近く」（control.ts の resolveTap の near）。
 */
const TAP_EXACT_PX = { touch: 16, mouse: 10 };

let current: BattleRun | null = null;

/**
 * 合戦を始めて、「続ける」を押したら結果を返す。
 * 勝ち負けが決まった時（結果の画面を出す前）に hooks.onDecided を 1 回だけ呼び、返った文（保存の結果）を結果の画面に出す。
 */
export function runBattle(setup: BattleSetup, hooks: BattleRunHooks = {}): Promise<BattleOutcome> {
    if (current) return Promise.reject(new Error('合戦はすでに始まっています'));
    return new Promise<BattleOutcome>((resolve, reject) => {
        try {
            current = new BattleRun(setup, hooks, (o) => {
                current = null;
                resolve(o);
            });
        } catch (e) {
            current = null;
            reject(e);
        }
    });
}
registerBattleRunner(runBattle);

interface Ptr {
    id: number;
    type: string;
    button: number;
    sx: number;
    sy: number;
    x: number;
    y: number;
    moved: boolean;
}

class BattleRun implements Mode {
    readonly s: BattleState;
    readonly view: BattleView;
    readonly ui: BattleUi;
    private readonly ctx: AppContext;
    paused = true;
    started = false;
    speed: 1 | 2 = 1;
    /** 開発時の確認用の早回し（本番では 1 のまま） */
    devScale = 1;
    /** 選んでいる部隊（id の並び。今は 0 か 1 部隊） */
    selection: string[] = [];
    pending: Pending = 'none';
    private realT = 0;
    /** 利用者がカメラを動かした（画面の大きさが変わっても「全体」に戻さない） */
    private camTouched = false;
    private endAt = -1;
    resultShown = false;
    /** 勝ち負けが決まった知らせ（hooks.onDecided）を送った後の、その返事（保存の結果）。まだ送っていなければ undefined */
    decidedNote: { ok: boolean; text: string } | null | undefined = undefined;
    private finished = false;
    private readonly off: (() => void)[] = [];
    private readonly ptrs = new Map<number, Ptr>();
    private pinch: { d: number; mx: number; my: number } | null = null;
    /** 2 本指になった・動かした：指をすべて離すまで「押した」にしない */
    private gesture = false;
    private readonly panKeys = new Set<string>();
    script: ((s: BattleState) => void) | null = null;
    private scriptAcc = 0;
    /** 知らせに出した出来事の数（止めている間に使った能力の知らせを 1 回だけ出すため） */
    private seenEvents = 0;
    private readonly terrainLabels: MapLabel[];
    /** 目標が指す部隊の名札の印（救出・守る・崩す） */
    private readonly unitMarks: Map<string, string>;

    constructor(
        setup: BattleSetup,
        private readonly hooks: BattleRunHooks,
        private readonly done: (o: BattleOutcome) => void,
    ) {
        this.ctx = appContext();
        this.s = createBattle(setup);
        this.view = new BattleView(this.s, { low: this.ctx.low });
        this.ui = new BattleUi(this.ctx.app, this.s, {
            start: () => this.start(),
            togglePause: () => this.togglePause(),
            setSpeed: (k) => (this.speed = k),
            command: (c) => this.command(c),
            ability: () => this.ability(),
            cancelPending: () => (this.pending = 'none'),
            allRetreat: () => void this.askAllRetreat(),
            selectUnit: (id) => this.selectFromCard(id),
            zoom: (d) => this.zoomButton(d),
            continueAfterResult: () => this.finish(),
        }, { touch: this.ctx.touch });
        this.terrainLabels = mapLabels(this.s);
        this.unitMarks = objectiveUnitMarks(this.s);

        enterMode('battle', this);
        this.bindInput();
        const c = this.ctx.renderer.domElement;
        this.resize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight);
        this.ui.showBriefing(`合戦「${this.s.map.name}」（${scenarioTexts(this.s).titleNote}）`, setup.briefing, false);
        this.loadTrees();
        if (import.meta.env.DEV) exposeDev(this);
    }

    // ---------------------------------------------------------------- 準備

    private loadTrees(): void {
        let settled = false;
        const ready = () => {
            if (settled || this.finished) return;
            settled = true;
            this.ui.setBriefingReady(true);
        };
        const timer = window.setTimeout(ready, TREE_TIMEOUT_MS);
        this.off.push(() => window.clearTimeout(timer));
        loadModel('tree_pine_far')
            .then((g) => {
                if (this.finished) return;
                this.view.setTrees(g.scene);
                ready();
            })
            .catch((e: unknown) => {
                // 読めなければ円すいの木のまま（見た目だけの問題。合戦はできる）
                console.warn('林の木を読み込めませんでした（円すいの木で続けます）', e);
                ready();
            });
    }

    /** 主に選んでいる部隊（selection の先頭） */
    get selectedId(): string | null {
        return leadOf(this.selection);
    }

    /** 1 部隊だけを選ぶ（null で外す） */
    select(id: string | null): void {
        this.selection = selectOnly(id);
    }

    start(): void {
        if (this.started || this.finished) return;
        this.started = true;
        this.paused = false;
        this.ui.closeModal();
        this.ui.toast('合戦が始まった。部隊を選んで命令を出す（指揮で一時停止）', 'info');
    }

    // ---------------------------------------------------------------- 毎フレーム

    frame(dt: number): void {
        if (this.finished) return;
        this.realT += dt;
        if (this.panKeys.size) {
            const k = this.view.cam.dist * 0.9 * dt;
            let dx = 0;
            let dz = 0;
            if (this.panKeys.has('ArrowLeft')) dx -= k;
            if (this.panKeys.has('ArrowRight')) dx += k;
            if (this.panKeys.has('ArrowUp')) dz -= k;
            if (this.panKeys.has('ArrowDown')) dz += k;
            this.view.centerOn(this.view.cam.tx + dx, this.view.cam.tz + dz);
            this.camTouched = true;
        }
        if (this.started && !this.paused && !this.s.result) {
            const sim = dt * this.speed * this.devScale;
            let events: BattleEvent[];
            if (this.script) {
                events = [];
                this.scriptAcc += sim;
                while (this.scriptAcc >= 0.1 - 1e-9 && !this.s.result) {
                    this.scriptAcc -= 0.1;
                    this.script(this.s);
                    events.push(...stepBattle(this.s, 0.1));
                }
            } else events = stepBattle(this.s, sim);
            this.onEvents(events);
        }
        if (this.s.result && this.endAt < 0) {
            this.endAt = this.realT;
            this.pending = 'none';
            // 勝ち負けが決まった：すぐに章の進行へ知らせる（結果の反映と戦後の自動保存。結果の画面を出す前）
            this.decide();
        }
        if (this.endAt >= 0 && !this.resultShown && this.realT - this.endAt > 1.6) this.showResult();
        // 見えなくなった敵・戦場を離れた敵の選択は外す
        const pruned = pruneSelection(this.s, this.selection);
        if (pruned !== this.selection) this.selection = [...pruned];
        const sel = this.selectedId ? unitById(this.s, this.selectedId) : undefined;
        if (sel && sel.side === 'ally' && this.pending !== 'ability' && !canCommand(this.s, sel)) this.pending = 'none';
        // 援護の対象選び：選んだ部隊の能力が使えなくなったら（崩れた・合戦が終わった）やめる
        if (this.pending === 'ability' && !(sel && abilityPanelModel(this.s, sel.id)?.usable)) this.pending = 'none';

        this.view.update(this.s, dt, { selectedId: this.selectedId, pending: this.pending });
        this.placeLabels();
        this.ui.update(this.s, { selectedId: this.selectedId, selection: this.selection, pending: this.pending, paused: this.paused, started: this.started, speed: this.speed });
        this.view.render(this.ctx.renderer);
    }

    resize(w: number, h: number): void {
        if (this.finished) return;
        this.view.resize(w, h);
        this.view.fit(this.ui.insets(), this.camTouched);
        // スマホの縦画面：止めて、横向きの案内（CSS）を出す
        const portrait = this.ctx.touch && h > w;
        if (portrait && this.started && !this.paused && !this.s.result) {
            this.releaseInput();
            this.paused = true;
        }
    }

    private onEvents(events: BattleEvent[]): void {
        this.seenEvents = this.s.events.length;
        for (const e of events) {
            const tone = eventTone(this.s, e);
            if (tone) this.ui.toast(e.text, tone, e.unitId);
        }
    }

    private placeLabels(): void {
        const s = this.s;
        const hasAbilities = s.abilityList.length > 0;
        const pledgeId = s.pledge?.targetId ?? null;
        // 同じ所で着くのを待つ味方（援軍）の名札は、上へ積んで重ならないように
        const waitingAt = new Map<string, number>();
        for (let i = 0; i < s.units.length; i++) {
            const u = s.units[i];
            const a = this.view.labelAnchor(i);
            if (a.shown) {
                const p = this.view.project(a.x, a.y, a.z);
                let extra = u.status === 'routed' ? ' 敗走' : ` ${Math.round(u.strength)}`;
                // 特殊能力が効いている印（号令・踏みとどまる・退路の守り・援護など）
                if (hasAbilities) {
                    const marks = unitMarksText(s, u.id);
                    if (marks) extra += `［${marks}］`;
                }
                this.ui.label(u.id, u.name, u.side, p.x, p.y, !p.off, extra);
            } else if (u.side === 'ally' && !u.arrived && u.status === 'ready') {
                const p = this.view.project(u.x, 4, u.z);
                const key = `${Math.round(u.x)},${Math.round(u.z)}`;
                const k = waitingAt.get(key) ?? 0;
                waitingAt.set(key, k + 1);
                this.ui.label(u.id, u.name, 'ally', p.x, p.y - k * 18, !p.off, ` 到着まで ${Math.max(0, Math.ceil(u.arriveAt - s.t))} 秒`);
            } else this.ui.label(u.id, '', u.side, 0, 0, false);
            this.ui.markLabel(u.id, 'sel', this.selection.includes(u.id));
            if (pledgeId) this.ui.markLabel(u.id, 'pledge', pledgeId === u.id);
            if (this.unitMarks.size) this.ui.labelMark(u.id, u.status === 'ready' ? (this.unitMarks.get(u.id) ?? '') : '');
        }
        for (const t of this.terrainLabels) {
            const p = this.view.project(t.x, t.y, t.z);
            this.ui.label(t.id, t.text, 'terrain', p.x, p.y, !p.off);
        }
    }

    // ---------------------------------------------------------------- 命令

    private selected(): Selected | null {
        return selectedOf(this.s, this.selection);
    }

    /** 命令を部隊の並びへ出す（今は選んでいる 1 部隊）。1 部隊でも出せたら命令の途中（移動・攻撃）を終える */
    private order(unitIds: readonly string[], o: Order): boolean {
        const r = orderUnits(this.s, unitIds, o);
        this.ui.flash(orderUnitsText(this.s, o, r));
        const ok = r.issued.length > 0;
        if (ok) this.pending = 'none';
        return ok;
    }

    /** 選んでいる部隊のうち命令を出せるもの（今は 1 部隊。命令できなければ先頭の部隊＝断る理由を出すため） */
    private orderTargets(): string[] {
        const ids = commandableIds(this.s, this.selection);
        return ids.length ? ids : this.selection.slice(0, 1);
    }

    private command(c: CommandKind): void {
        if (this.s.result) return;
        const sel = this.selected();
        if (!sel || sel.side !== 'ally') {
            this.ui.flash('先に味方の部隊を選んでください');
            return;
        }
        if (!sel.commandable) {
            this.ui.flash(refusalText(this.s, sel.id, { type: 'hold' }));
            return;
        }
        if (c === 'move' || c === 'attack') this.pending = this.pending === c ? 'none' : c;
        else this.order(this.orderTargets(), { type: c });
    }

    /** 「能力」・F：選んだ味方の部隊の特殊能力を使う（援護は対象選びへ。使えなければ理由を出すだけで回数は減らない） */
    private ability(): void {
        if (this.s.result || !this.started) return;
        const sel = this.selectedId ? unitById(this.s, this.selectedId) : undefined;
        if (!sel) {
            this.ui.flash('先に味方の部隊を選んでください');
            return;
        }
        if (sel.side !== 'ally') {
            const em = abilityPanelModel(this.s, sel.id);
            this.ui.flash(em ? `「${em.name}」は敵方の武将の能力。操作できない（敵の考えが使う）` : '敵の部隊は操作できない（先に味方の部隊を選んでください）', 2600);
            return;
        }
        const m = abilityPanelModel(this.s, sel.id);
        if (!m) {
            this.ui.flash(`${sel.name}には特殊能力がない（率いる武将のいない部隊）`);
            return;
        }
        if (this.pending === 'ability') {
            // もう一度押すと取り消し
            this.pending = 'none';
            this.ui.flash('援護の対象選びをやめた');
            return;
        }
        if (!m.usable) {
            this.ui.flash(`「${m.name}」は使えない：${m.reason || m.stateText}`, 2600);
            return;
        }
        if (m.info.target === 'ally_unit') {
            this.pending = 'ability';
            return;
        }
        this.useAbilityOn(undefined);
    }

    /** 能力を使う（targetId は援護の対象）。断られたら理由を出す（対象選びは続ける） */
    private useAbilityOn(targetId: string | undefined): void {
        const sel = this.selectedId ? unitById(this.s, this.selectedId) : undefined;
        if (!sel) return;
        const name = abilityPanelModel(this.s, sel.id)?.name ?? '能力';
        const r = useAbility(this.s, sel.id, targetId);
        if (r.ok) {
            this.pending = 'none';
            const tgt = targetId ? unitById(this.s, targetId)?.name : null;
            this.ui.flash(`${sel.name}：「${name}」${tgt ? `— ${tgt}を援護` : ''}${this.paused ? '（再開すると時間が進む）' : ''}`, 2400);
            // 使った知らせ（sim が記録した ability の出来事）をすぐ出す（止めている間も）
            this.onEvents(this.s.events.slice(this.seenEvents));
        } else this.ui.flash(`${targetId ? '対象にできない' : '使えない'}：${r.reason ?? ''}`, 2600);
    }

    private selectFromCard(id: string): void {
        if (this.pending === 'ability' && this.selectedId) {
            // 援護の対象選びの途中：札（1〜4 キー）でも対象を選べる
            this.useAbilityOn(id);
            return;
        }
        if (this.selectedId === id) {
            this.focusUnit(id);
            return;
        }
        this.select(id);
        this.pending = 'none';
    }

    private focusUnit(id: string): void {
        const i = this.s.units.findIndex((u) => u.id === id);
        if (i < 0) return;
        const u = this.s.units[i];
        const p = this.view.unitPos(i);
        if (u.side === 'enemy' && !p.shown) return;
        this.camTouched = true;
        this.view.centerOn(p.shown ? p.x : u.x, p.shown ? p.z : u.z);
    }

    private async askAllRetreat(): Promise<void> {
        if (this.s.result || !this.started || this.s.allRetreatAt !== null || this.ui.modalOpen) return;
        const was = this.paused;
        this.paused = true;
        const yes = await this.ui.confirm('全軍撤退しますか？', '味方の全部隊が南の退き口へ下がります。戦場を離れると合戦は「撤退」で終わります（兵は残ります）。', '撤退する', 'やめる');
        if (this.finished) return;
        if (yes && orderAllRetreat(this.s)) {
            this.pending = 'none';
            this.paused = false;
        } else this.paused = was;
    }

    togglePause(): void {
        if (!this.started) {
            if (this.ui.modalOpen === 'briefing') this.ui.modalKey('primary');
            return;
        }
        if (this.s.result || this.ui.modalOpen) return;
        this.paused = !this.paused;
    }

    private autoPause(): void {
        this.releaseInput();
        if (this.started && !this.s.result) this.paused = true;
    }

    private zoomButton(d: 1 | -1 | 0): void {
        if (d === 0) {
            this.camTouched = false;
            this.view.fit(this.ui.insets());
            return;
        }
        this.camTouched = true;
        const r = this.ctx.renderer.domElement.getBoundingClientRect();
        this.view.zoomAt(d > 0 ? 0.7 : 1 / 0.7, r.width / 2, r.height / 2);
    }

    // ---------------------------------------------------------------- 結果

    /** 勝ち負けが決まったことを 1 回だけ知らせる（章の進行が結果を反映して保存する）。保存の結果は結果の画面に出す */
    private decide(): void {
        if (this.decidedNote !== undefined || !this.s.result) return;
        this.decidedNote = null;
        try {
            this.decidedNote = this.hooks.onDecided?.(this.s.result) ?? null;
        } catch (e) {
            console.error(e);
            this.decidedNote = { ok: false, text: `結果を保存できませんでした：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    private showResult(): void {
        const o = this.s.result!;
        this.decide();
        this.resultShown = true;
        this.releaseInput();
        const { rows, lost, start } = resultRows(this.s, o);
        const sc = scenarioTexts(this.s);
        this.ui.showResult({
            kind: o.result,
            title: RESULT_LABEL[o.result],
            reason: sc.reasons[o.reason],
            time: fmtClock(o.elapsedSec),
            rows,
            lost,
            start,
            note: sc.notes[o.result],
            save: this.decidedNote ?? null,
            pledge: pledgeResultModel(this.s, o),
            abilities: abilitiesUsedText(this.s, o),
            objectives: objectiveResultModel(o),
        });
    }

    private finish(): void {
        if (this.finished || !this.s.result) return;
        this.decide();
        this.finished = true;
        const o = this.s.result;
        for (const f of this.off) f();
        this.off.length = 0;
        this.ui.dispose();
        this.view.dispose();
        exitMode();
        if (import.meta.env.DEV) {
            const w = window as unknown as { __battle?: { active: boolean } };
            if (w.__battle) w.__battle.active = false;
        }
        this.done(o);
    }

    // ---------------------------------------------------------------- 入力

    private listen<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen<K extends keyof DocumentEventMap>(t: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen<K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
    private listen(t: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
        const h = fn as unknown as EventListener;
        t.addEventListener(type, h, opts);
        this.off.push(() => t.removeEventListener(type, h, opts));
    }

    /** 指・マウス・キーをすべて離す（その指を動かし続けても、触り直すまで地図は動かない） */
    releaseInput(): void {
        for (const p of this.ptrs.values()) {
            try {
                if (this.ui.input.hasPointerCapture(p.id)) this.ui.input.releasePointerCapture(p.id);
            } catch {
                /* 捕捉が既に外れている */
            }
        }
        this.ptrs.clear();
        this.pinch = null;
        this.gesture = false;
        this.panKeys.clear();
        this.ui.input.classList.remove('dragging');
    }

    private local(e: PointerEvent | WheelEvent): [number, number] {
        const r = this.ctx.renderer.domElement.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    private bindInput(): void {
        const layer = this.ui.input;
        this.listen(layer, 'pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
            e.preventDefault();
            if (this.resultShown || this.ui.modalOpen) return;
            const [x, y] = this.local(e);
            try {
                layer.setPointerCapture(e.pointerId);
            } catch {
                /* 捕捉できない場合もそのまま */
            }
            this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, button: e.button, sx: x, sy: y, x, y, moved: false });
            if (this.ptrs.size >= 2) {
                this.gesture = true;
                const [a, b] = [...this.ptrs.values()];
                this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
            }
        });
        this.listen(layer, 'pointermove', (e) => {
            const p = this.ptrs.get(e.pointerId);
            const [x, y] = this.local(e);
            if (!p) {
                if (e.pointerType === 'mouse') this.hover(x, y);
                return;
            }
            const px = p.x;
            const py = p.y;
            p.x = x;
            p.y = y;
            if (this.ptrs.size >= 2 && this.pinch) {
                const [a, b] = [...this.ptrs.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                this.camTouched = true;
                this.view.zoomAt(this.pinch.d / d, mx, my);
                this.view.panByScreen(this.pinch.mx, this.pinch.my, mx, my);
                this.pinch = { d, mx, my };
                return;
            }
            if (!p.moved) {
                const slop = p.type === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
                if (Math.hypot(x - p.sx, y - p.sy) <= slop) return;
                p.moved = true;
                this.gesture = true;
                this.camTouched = true;
                layer.classList.add('dragging');
                this.view.panByScreen(p.sx, p.sy, x, y);
                return;
            }
            this.view.panByScreen(px, py, x, y);
        });
        const end = (e: PointerEvent, tap: boolean) => {
            const p = this.ptrs.get(e.pointerId);
            if (!p) return;
            this.ptrs.delete(e.pointerId);
            if (this.ptrs.size < 2) this.pinch = null;
            const wasGesture = this.gesture;
            if (this.ptrs.size === 0) {
                this.gesture = false;
                layer.classList.remove('dragging');
            }
            if (tap && !p.moved && !wasGesture && this.ptrs.size === 0) this.tap(p.x, p.y, p.type === 'mouse' && p.button === 2);
        };
        this.listen(layer, 'pointerup', (e) => end(e, true));
        this.listen(layer, 'pointercancel', (e) => end(e, false));
        this.listen(layer, 'lostpointercapture', (e) => end(e, false));
        this.listen(layer, 'contextmenu', (e) => e.preventDefault());
        this.listen(
            layer,
            'wheel',
            (e) => {
                e.preventDefault();
                if (this.ui.modalOpen) return;
                const [x, y] = this.local(e);
                this.camTouched = true;
                const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
                this.view.zoomAt(Math.exp(Math.max(-0.5, Math.min(0.5, dy * 0.0016))), x, y);
            },
            { passive: false },
        );
        this.listen(window, 'blur', () => this.autoPause());
        this.listen(window, 'pagehide', () => this.autoPause());
        this.listen(document, 'visibilitychange', () => {
            if (document.visibilityState !== 'visible') this.autoPause();
        });
        this.listen(window, 'keydown', (e) => this.keyDown(e));
        this.listen(window, 'keyup', (e) => {
            this.panKeys.delete(e.code);
            // Mac で Cmd を押している間の keyup が届かないことがあるので、Cmd を離したら全部離す
            if (e.key === 'Meta') this.panKeys.clear();
        });
    }

    private hover(x: number, y: number): void {
        if (this.ui.modalOpen) return;
        const id = this.view.pick(this.s, x, y, 18);
        const u = id ? unitById(this.s, id) : undefined;
        const layer = this.ui.input;
        const sel = this.selected();
        let cur = '';
        if (u && this.pending === 'ability') cur = 'copy';
        else if (u && u.side === 'ally') cur = 'pointer';
        else if (u && sel?.commandable) cur = 'crosshair';
        else if (u) cur = 'help';
        else if (sel?.commandable) cur = 'cell';
        if (layer.style.cursor !== cur) layer.style.cursor = cur;
    }

    /** 地図を押した（動かさずに離した）。command は右クリック（味方を選んでいれば命令だけ） */
    private tap(x: number, y: number, command: boolean): void {
        if (this.resultShown || this.ui.modalOpen) return;
        // 部隊そのもの（隊列の広がり＋少し）を押したか、押しやすくするための余白（タッチ 30 px・マウス 20 px）を押したか
        const exactId = this.view.pick(this.s, x, y, this.ctx.touch ? TAP_EXACT_PX.touch : TAP_EXACT_PX.mouse);
        const id = exactId ?? this.view.pick(this.s, x, y, this.ctx.touch ? 30 : 20);
        const g = this.view.groundAt(x, y);
        const u = id ? unitById(this.s, id) : undefined;
        let target: TapTarget;
        if (u) target = { kind: 'unit', unitId: u.id, side: u.side, x: g?.x ?? u.x, z: g?.z ?? u.z, near: !exactId };
        else if (g) target = { kind: 'ground', x: g.x, z: g.z };
        else return;
        const sel = this.selected();
        if (command) {
            // 右クリック：選んでいる味方への命令だけ（選び直しはしない）。味方のすぐ近くなら、その地点へ移動
            if (!sel || !sel.commandable) return;
            if (target.kind === 'unit' && target.side === 'ally' && !target.near) return;
            if (target.kind === 'unit' && target.side === 'ally') target = { kind: 'ground', x: target.x, z: target.z };
            const o: Order = target.kind === 'unit' ? { type: 'attack', targetId: target.unitId } : { type: 'move', x: target.x, z: target.z };
            this.order(this.orderTargets(), o);
            return;
        }
        const act = resolveTap(sel, this.pending, target);
        switch (act.type) {
            case 'select':
            case 'inspect':
                this.select(act.unitId);
                this.pending = 'none';
                break;
            case 'order':
                // act.unitId は先頭の部隊。命令は選んでいる並びの部隊へ出す（今は同じ 1 部隊）
                this.order(this.selection.includes(act.unitId) ? this.orderTargets() : [act.unitId], act.order);
                break;
            case 'deselect':
                this.select(null);
                this.pending = 'none';
                break;
            case 'hint':
                this.ui.flash(act.text);
                break;
            case 'abilityTarget':
                this.useAbilityOn(act.unitId);
                break;
            case 'none':
                break;
        }
    }

    private keyDown(e: KeyboardEvent): void {
        if (this.finished) return;
        const modal = this.ui.modalOpen;
        const onButton = document.activeElement instanceof HTMLButtonElement && this.ui.root.contains(document.activeElement);
        if (modal) {
            if (e.key === 'Enter' && !onButton) {
                e.preventDefault();
                this.ui.modalKey('primary');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.ui.modalKey('cancel');
            } else if (e.code === 'Space' && modal === 'briefing' && !onButton) {
                e.preventDefault();
                this.ui.modalKey('primary');
            }
            return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code.startsWith('Arrow')) {
            e.preventDefault();
            this.panKeys.add(e.code);
            return;
        }
        if (e.repeat) return;
        if (e.code === 'Space') {
            if (onButton) return; // ボタンに合っているときは、そのボタンを押す
            e.preventDefault();
            this.togglePause();
            return;
        }
        // 1〜8：札の順の味方（味方は最大 8 部隊）
        const allies = this.s.units.filter((u) => u.side === 'ally');
        const digit = /^(Digit|Numpad)([1-8])$/.exec(e.code);
        if (digit) {
            const u = allies[Number(digit[2]) - 1];
            if (u) this.selectFromCard(u.id);
            return;
        }
        switch (e.code) {
            case 'Escape':
                if (this.pending !== 'none') this.pending = 'none';
                else this.select(null);
                break;
            case 'KeyM':
                this.command('move');
                break;
            case 'KeyA':
                this.command('attack');
                break;
            case 'KeyH':
                this.command('hold');
                break;
            case 'KeyR':
                this.command('retreat');
                break;
            case 'KeyF':
                if (this.s.abilityList.length === 0) return;
                this.ability();
                break;
            case 'Equal':
            case 'NumpadAdd':
                this.zoomButton(1);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                this.zoomButton(-1);
                break;
            case 'Digit0':
            case 'Numpad0':
                this.zoomButton(0);
                break;
            default:
                return;
        }
        e.preventDefault();
    }
}

// ---------------------------------------------------------------- 開発時の確認用（本番には入らない）

function exposeDev(run: BattleRun): void {
    const api = {
        active: true,
        get state() {
            return run.s;
        },
        get ui() {
            return { selectedId: run.selectedId, selection: [...run.selection], pending: run.pending, paused: run.paused, started: run.started, speed: run.speed, resultShown: run.resultShown, modal: run.ui.modalOpen, decided: run.decidedNote };
        },
        get camera() {
            return { ...run.view.cam, maxDist: run.view.maxDist };
        },
        /** 表示（three の場面・カメラ）。確認用 */
        get view() {
            return run.view;
        },
        /** 合戦の時間を一気に進める（命令の台本 script を刻みごとに呼べる） */
        fastForward(seconds: number, script?: (s: BattleState) => void) {
            const end = run.s.t + seconds;
            const events: BattleEvent[] = [];
            while (run.s.t < end - 1e-9 && !run.s.result) {
                script?.(run.s);
                events.push(...stepBattle(run.s, 0.1));
            }
            for (const e of events.slice(-4)) {
                const tone = eventTone(run.s, e);
                if (tone) run.ui.toast(e.text, tone, e.unitId);
            }
            return { t: run.s.t, result: run.s.result, events: events.length };
        },
        order: (unitId: string, o: Order) => issueOrder(run.s, unitId, o),
        /** 状態を直接書き換える確認用（画面の確認では使わず、報告では「直接操作」と書く） */
        useAbility: (unitId: string, targetId?: string) => useAbility(run.s, unitId, targetId),
        allRetreat: () => orderAllRetreat(run.s),
        setTimeScale(k: number) {
            run.devScale = Math.max(0, Math.min(40, k));
        },
        pause(p?: boolean) {
            run.paused = p ?? !run.paused;
        },
        start: () => run.start(),
        select(id: string | null) {
            run.select(id);
        },
        /** 部隊の画面の位置（CSS px、ページの左上から）。実際のクリック・タップの確認に使う */
        screenOf(unitId: string) {
            const i = run.s.units.findIndex((u) => u.id === unitId);
            if (i < 0) return null;
            const p = run.view.unitPos(i);
            const u = run.s.units[i];
            const r = appContext().renderer.domElement.getBoundingClientRect();
            const x = p.shown ? p.x : u.x;
            const z = p.shown ? p.z : u.z;
            // 丘の上の部隊（敵本陣など）も、描かれている高さで押せるように（地面の高さ + 2 m）
            const q = run.view.project(x, elevationAt(run.s.map, x, z) + 2, z);
            return { x: q.x + r.left, y: q.y + r.top, shown: p.shown };
        },
        screenOfGround(x: number, z: number) {
            const r = appContext().renderer.domElement.getBoundingClientRect();
            const q = run.view.project(x, elevationAt(run.s.map, x, z), z);
            return { x: q.x + r.left, y: q.y + r.top };
        },
        centerOn: (x: number, z: number, dist?: number) => {
            if (dist) run.view.cam.dist = dist;
            run.view.centerOn(x, z);
        },
        /** 台本を実時間の進みに合わせて刻みごとに呼ぶ（null で外す） */
        setScript(fn: ((s: BattleState) => void) | null) {
            run.script = fn;
        },
        info() {
            const i = appContext().renderer.info;
            return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
        },
    };
    Object.assign(window, { __battle: api });
}
