/**
 * 合戦の画面の部品（DOM）。three は使わない。表示する中身はつなぎ（entry.ts）から受け取り、押されたら handlers を呼ぶだけ。
 * 置くもの（docs/chapter1-spec.md §4 表示と操作）：
 * - 左上：戦場の名前・仮シナリオ・日没までの残り時間・勝ち負けの条件・両軍の様子（スマホでは畳める）
 * - 上の真ん中：指揮中（一時停止）の印と、出来事の知らせ（押すとその部隊へカメラを寄せる）
 * - 右上：指揮（一時停止）／再開・速さ ×1 ×2・全軍撤退（確かめてから）
 * - 右：寄る・引く・全体
 * - 左上（目標のある合戦＝合戦場の演習だけ）：目標の欄（主目標と副目標を分けて進み具合・戦場の特殊ルール。約束の行とは別。スマホでは畳める）
 * - 下：味方の部隊の札（兵・士気・今の命令・交戦相手。最大 8 部隊。PC は並べて 1〜8 キー、スマホは小さくして横になぞってずらす）と、
 *   命令のボタン（移動・攻撃・防衛・待機・撤退）
 * - 部隊を選ぶと、左上の能力の欄の先頭に率いる武将（名前・役割・固有能力。仮の能力は「仮」の印）
 * - 特殊能力のある合戦（歴史分岐）だけ：命令のボタンに「能力」、左上に選んだ部隊の能力の欄（能力名・対象・範囲・効果・代償・
 *   使えるか／使えない理由。ゲーム用の創作と断る）。
 * - 戦前の約束のある合戦だけ：左上の条件の見出しのすぐ下に約束の行（対象・陣に入った秒数・兵の割合。畳んでも見える）。
 * - 地図の上の名札、合戦の前の説明、全軍撤退の確かめ、結果（勝敗・主目標・副目標・約束を別々の行に）
 * - 特殊能力の発動 UI（設計 §4）：発動できる武将の名札に能力の印（淡い青緑。明るさはつなぎが表示の時計で毎フレーム渡す＝一時停止中も点滅）、
 *   効果中は名札に残り秒数、対象選びの間は選べる名札・選べない名札（薄く）。発動の知らせ（能力名・武将・対象。2.5 秒）と、効果が切れた知らせ。
 *   名札そのものは押せない（pointer-events: none）。名札・能力の印の四角（labelRect）をつなぎが読んで、地図を押した所と比べる。
 * e2e が使える印：.b-root[data-field]（戦場 id）・.b-card[data-id][data-key]・.b-cards[data-count]・.b-goals の .b-goal[data-id][data-role][data-state]・
 *   .b-gen[data-general]・結果の .b-robj の行 [data-role][data-achieved]・名札 .b-label[data-mark]（救出・守る・崩す）・
 *   部隊の名札 .b-label[data-id][data-ab]（ready・active・choosing・target・untargetable）・発動の知らせ .b-abnote[data-kind]・
 *   名札の優先表示 .b-label[data-fit]（mini＝小さく・hide＝一時的に隠す。付いていなければそのまま）。
 * ボタンは押した瞬間（pointerdown）に反応し、その後の click は無視する（キーボードの Enter／Space の click だけ受ける）。
 * 画面を押して地図を動かす面（input）は一番下に敷き、つなぎがそこへ指・マウスの処理を付ける。
 */
import { FREE_HOLD_LABEL, FREE_HOLD_NOTE, type BattleState } from './sim';
import {
    abilityPanelModel,
    abilityTargetHint,
    armySummary,
    cardAbilityText,
    cardModel,
    conditionsFor,
    generalLineModel,
    objectivePanelModel,
    objectiveSummaryText,
    pledgeLineModel,
    scenarioTexts,
    timeText,
    type CardModel,
    type LabelAbilityModel,
    type ObjectiveResultModel,
    type ObjectiveRowModel,
    type Pending,
    type ResultRow,
} from './control';
import type { Side } from './types';
import { layoutLabels, layoutMapLabels, type LabelFit, type LabelLayoutItem, type MapLabelItem } from './labelLayout';

export type CommandKind = 'move' | 'attack' | 'hold' | 'retreat' | 'face';

export interface UiHandlers {
    start(): void;
    togglePause(): void;
    setSpeed(k: 1 | 2): void;
    command(c: CommandKind): void;
    /** 選んだ部隊の特殊能力を使う（対象を選ぶ能力は、この後で味方の部隊を押す） */
    ability(): void;
    cancelPending(): void;
    allRetreat(): void;
    selectUnit(id: string): void;
    /** 1 寄る・-1 引く・0 全体 */
    zoom(dir: 1 | -1 | 0): void;
    continueAfterResult(): void;
}

export interface UiState {
    /** 主に選んでいる部隊（selection の先頭） */
    selectedId: string | null;
    /** 選んでいる部隊の並び（今は 0 か 1 部隊。札の印はこの並びで付ける） */
    selection: readonly string[];
    pending: Pending;
    paused: boolean;
    started: boolean;
    speed: 1 | 2;
}

export interface ResultModel {
    kind: 'victory' | 'defeat' | 'retreat';
    title: string;
    reason: string;
    time: string;
    rows: ResultRow[];
    lost: Record<Side, number>;
    start: Record<Side, number>;
    note: string;
    /** 結果の保存（章の進行が、勝ち負けが決まった時に保存した結果）。null なら出さない */
    save?: { ok: boolean; text: string } | null;
    /** 戦前の約束の結果（勝敗とは別の欄）。約束の仕組みのない合戦は null */
    pledge?: { result: 'kept' | 'broken' | 'declined'; title: string; text: string } | null;
    /** 使った特殊能力（能力のない合戦は空） */
    abilities?: string;
    /** 主目標・副目標の結果（勝敗・約束とは別の行）。目標の無い合戦は null */
    objectives?: ObjectiveResultModel | null;
}

type Tone = 'good' | 'bad' | 'warn' | 'info';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

/**
 * 押した瞬間（pointerdown）に反応するボタン。その後の click は無視し、キーボード（Enter・Space）の click だけ受ける。
 * 指・マウスの click は pointerType を持つか、直前にこのボタンの pointerdown がある（click の detail は環境によって 0 のことがあるので使わない）。
 */
function press(target: HTMLElement, fn: () => void): void {
    let downAt = -1e9;
    target.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        downAt = performance.now();
        if (target.classList.contains('off')) return;
        fn();
    });
    target.addEventListener('click', (e) => {
        e.preventDefault();
        const pt = (e as PointerEvent).pointerType;
        if (pt || performance.now() - downAt < 1500 || target.classList.contains('off')) return;
        fn();
    });
}

function button(cls: string, html: string, label: string): HTMLButtonElement {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    return b;
}

/** 文字を変わったときだけ書き換える */
function setText(e: HTMLElement, text: string): void {
    if (e.textContent !== text) e.textContent = text;
}
function setClass(e: HTMLElement, cls: string, on: boolean): void {
    if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

interface LabelEls {
    e: HTMLElement;
    name: HTMLElement;
    small: HTMLElement;
    ab: HTMLElement;
    x: number;
    y: number;
    shown: boolean;
    text: string;
    abMode: string;
    abText: string;
    blink: number;
    /** 名札の重なりをほどくために上へずらした量（px。0 か負） */
    dy: number;
    /** 優先表示の見せ方（full・mini＝名前だけ小さく・hide＝一時的に隠す。labelLayout.ts） */
    fit: LabelFit;
    /** 重要な武将（武将のいる部隊・本陣・約束や目標の印）。優先表示の順に使う */
    imp: boolean;
    /** 見せ方ごとの大きさ（最後に測った値。0 ならまだ測っていない）と、名前の所の幅 */
    fw: number;
    fh: number;
    mw: number;
    mh: number;
    nw: number;
    /** いま書いてある位置（x, y + dy。同じなら transform を書き直さない） */
    px: number;
    py: number;
}

interface CardEls {
    root: HTMLButtonElement;
    badge: HTMLElement;
    strBar: HTMLElement;
    strText: HTMLElement;
    morBar: HTMLElement;
    morText: HTMLElement;
    ord: HTMLElement;
    eng: HTMLElement;
    abl: HTMLElement;
    last: string;
}

export class BattleUi {
    readonly root: HTMLDivElement;
    /** 地図を押す・動かす面（つなぎが指・マウスの処理を付ける） */
    readonly input: HTMLDivElement;
    private readonly labels: HTMLDivElement;
    private readonly labelEls = new Map<string, LabelEls>();
    /** 発動の知らせ（能力名・武将・対象）と、効果が切れた知らせ */
    private readonly abNote: HTMLDivElement;
    private abNoteTimer = 0;
    private readonly objHead: HTMLButtonElement;
    private readonly objTime: HTMLElement;
    private readonly objArmy: Record<Side, HTMLElement>;
    private readonly inspect: HTMLDivElement;
    private readonly toasts: HTMLDivElement;
    private readonly pausePill: HTMLDivElement;
    private readonly pauseBtn: HTMLButtonElement;
    private readonly speedBtns: Record<1 | 2, HTMLButtonElement>;
    private readonly allRetBtn: HTMLButtonElement;
    private readonly cards = new Map<string, CardEls>();
    /** 札の列（スマホでは横になぞってずらす） */
    private readonly cardsEl: HTMLDivElement;
    /** 札の列を最後にずらして見せた部隊（選び直したときだけ、その札が見えるようにずらす） */
    private shownCardId: string | null = null;
    /** 目標の欄（目標のある合戦だけ） */
    private readonly goals: HTMLDivElement | null = null;
    private readonly goalSum: HTMLElement | null = null;
    /** 能力の欄を最後に作ったときに選んでいた部隊（縦の狭い画面で、選び直したら目標の欄を畳むため） */
    private lastAbilSel: string | null = null;
    private readonly goalRows = new Map<string, { e: HTMLElement; text: HTMLElement; last: string }>();
    /** 命令のボタン（「向き」は能力のある合戦だけ） */
    private readonly cmdBtns: Partial<Record<CommandKind, HTMLButtonElement>> & Record<'move' | 'attack' | 'hold' | 'retreat', HTMLButtonElement>;
    /** 「能力」のボタン（特殊能力のある合戦だけ） */
    private readonly abilBtn: HTMLButtonElement | null = null;
    /** 選んだ部隊の能力の欄 */
    private readonly abil: HTMLDivElement;
    /** 条件の見出しの下の、約束の行 */
    private readonly pledgeEl: HTMLDivElement;
    private readonly hasAbility: boolean;
    private readonly tag: string;
    private readonly hintEl: HTMLDivElement;
    private readonly hintText: HTMLElement;
    private readonly hintCancel: HTMLButtonElement;
    private modal: HTMLDivElement | null = null;
    private modalKind: 'briefing' | 'confirm' | 'result' | null = null;
    private modalPrimary: (() => void) | null = null;
    private modalCancel: (() => void) | null = null;
    private flashTimer = 0;
    private flashText = '';
    private readonly timers = new Set<number>();
    private readonly maxToasts: number;

    constructor(
        parent: HTMLElement,
        s: BattleState,
        private readonly h: UiHandlers,
        private readonly opts: { touch: boolean },
    ) {
        const r = el('div', 'b-root');
        r.id = 'battle-ui';
        r.dataset.field = s.map.id;
        this.root = r;
        if (opts.touch) r.classList.add('b-touch');
        this.maxToasts = opts.touch ? 3 : 4;

        this.input = el('div', 'b-input');
        this.labels = el('div', 'b-labels');
        r.append(this.input, this.labels);

        // ---- 左上：戦場・残り時間・条件 ----
        const sc = scenarioTexts(s);
        this.tag = sc.tag;
        this.hasAbility = s.abilityList.some((a) => a.side === 'ally');
        const obj = el('div', 'b-obj');
        this.objHead = button('b-obj-head', '', '勝ち負けの条件を開く／閉じる');
        this.objHead.append(el('b', 'b-obj-name', s.map.name), el('span', 'b-tag', sc.tag));
        this.objTime = el('span', 'b-time');
        this.objHead.append(this.objTime, el('span', 'b-caret', '条件'));
        const body = el('div', 'b-obj-body');
        for (const c of conditionsFor(s)) {
            const row = el('div', `b-cond ${c.tone}`);
            row.append(el('b', '', c.label), el('span', '', c.text));
            body.append(row);
        }
        this.objArmy = { enemy: el('div', 'b-army enemy'), ally: el('div', 'b-army ally') };
        body.append(this.objArmy.enemy, this.objArmy.ally);
        // 約束の行（畳んでも見える。約束のない合戦では出さない）
        this.pledgeEl = el('div', 'b-pledge');
        this.pledgeEl.hidden = true;
        obj.append(this.objHead, this.pledgeEl, body);
        // 目標のある合戦（合戦場の演習）は、勝ち負けを目標の欄が示すので、条件の欄は PC でも畳んでおく（左上の縦の長さを抑える）
        const hasGoals = !!s.objectives;
        if (opts.touch || hasGoals) obj.classList.add('closed');
        if (hasGoals) r.classList.add('with-goals');
        press(this.objHead, () => obj.classList.toggle('closed'));
        this.inspect = el('div', 'b-inspect');
        this.inspect.hidden = true;
        this.abil = el('div', 'b-abil');
        this.abil.hidden = true;
        const left = el('div', 'b-topleft');
        left.append(obj);
        // 目標の欄（主目標・副目標・戦場の特殊ルール）。約束の行とは別の欄。スマホでは畳んで主目標の一行だけ
        const om = objectivePanelModel(s);
        if (om) {
            const g = el('div', 'b-goals');
            const head = button('b-goals-head', '', '目標を開く／閉じる');
            this.goalSum = el('span', 'b-goals-sum');
            head.append(el('b', '', '目標'), this.goalSum, el('span', 'b-caret', ''));
            const gb = el('div', 'b-goals-body');
            for (const row of [...(om.primary ? [om.primary] : []), ...om.secondary]) {
                const e = el('div', `b-goal ${row.role}`);
                e.dataset.id = row.id;
                e.dataset.role = row.role;
                const text = el('span', 'b-goal-p');
                e.append(el('i', '', row.role === 'primary' ? '主目標' : '副目標'), el('b', '', row.label), text);
                gb.append(e);
                this.goalRows.set(row.id, { e, text, last: '' });
            }
            if (om.rules.length) {
                const rules = el('div', 'b-goal-rules');
                for (const t of om.rules) rules.append(el('div', '', t));
                gb.append(rules);
            }
            g.append(head, gb);
            if (opts.touch) g.classList.add('closed');
            press(head, () => g.classList.toggle('closed'));
            this.goals = g;
            left.append(g);
        }
        left.append(this.inspect, this.abil);

        // ---- 上の真ん中：一時停止の印・知らせ ----
        const mid = el('div', 'b-topmid');
        this.pausePill = el('div', 'b-pausepill');
        this.pausePill.innerHTML = '<b>指揮中（一時停止）</b><span>　命令を出せます</span>';
        this.toasts = el('div', 'b-toasts');
        this.toasts.setAttribute('aria-live', 'polite');
        // 発動の知らせ（押しても何も起きない。pointer-events: none）
        this.abNote = el('div', 'b-abnote');
        this.abNote.hidden = true;
        this.abNote.setAttribute('aria-live', 'polite');
        mid.append(this.pausePill, this.abNote, this.toasts);

        // ---- 右上：一時停止・速さ・全軍撤退 ----
        const ctrl = el('div', 'b-ctrl');
        this.pauseBtn = button('b-btn b-pause', '', '指揮（一時停止）／再開');
        press(this.pauseBtn, () => h.togglePause());
        const speed = el('div', 'b-speed');
        this.speedBtns = { 1: button('b-btn b-seg', '×1', '速さ ×1'), 2: button('b-btn b-seg', '×2', '速さ ×2') };
        press(this.speedBtns[1], () => h.setSpeed(1));
        press(this.speedBtns[2], () => h.setSpeed(2));
        speed.append(this.speedBtns[1], this.speedBtns[2]);
        this.allRetBtn = button('b-btn b-allret', '全軍撤退', '全軍撤退');
        press(this.allRetBtn, () => h.allRetreat());
        ctrl.append(this.pauseBtn, speed, this.allRetBtn);

        // ---- 右：寄る・引く ----
        const zoom = el('div', 'b-zoom');
        const zin = button('b-btn b-z', '＋', '寄る');
        const zout = button('b-btn b-z', '－', '引く');
        const zall = button('b-btn b-z b-zall', '全体', '戦場の全体を見る');
        press(zin, () => h.zoom(1));
        press(zout, () => h.zoom(-1));
        press(zall, () => h.zoom(0));
        zoom.append(zin, zout, zall);

        // ---- 下：部隊の札・命令 ----
        const bottom = el('div', 'b-bottom');
        const cards = el('div', 'b-cards');
        this.cardsEl = cards;
        let key = 1;
        for (const u of s.units) {
            if (u.side !== 'ally') continue;
            const c = this.makeCard(u.id, u.name, key++);
            cards.append(c.root);
        }
        // 札が 5 部隊以上なら小さな札にする（PC は 8 部隊まで並べる。スマホは横になぞってずらす）
        cards.dataset.count = String(key - 1);
        if (key - 1 > 4) {
            cards.classList.add('many');
            bottom.classList.add('many');
        }
        this.bindCardList(cards);
        const cmds = el('div', 'b-cmds');
        this.cmdBtns = {
            move: button('b-btn b-cmd', '移動', '移動先指定（この後で押した所へ移動。味方の立つ所を押しても選び直さない）'),
            attack: button('b-btn b-cmd', '攻撃', '攻撃（この後で敵を押す）'),
            hold: button('b-btn b-cmd', '防衛・待機', '防衛・待機'),
            retreat: button('b-btn b-cmd', '撤退', 'この部隊を撤退させる'),
        };
        for (const k of Object.keys(this.cmdBtns) as CommandKind[]) {
            press(this.cmdBtns[k]!, () => h.command(k));
            cmds.append(this.cmdBtns[k]!);
        }
        if (this.hasAbility) {
            // 特殊能力のある合戦だけ（架空の第一章の命令のボタンは今までどおり 4 つ）
            cmds.classList.add('with-ability');
            this.abilBtn = button('b-btn b-cmd b-abil-btn', '能力', '選んだ部隊の特殊能力を使う');
            press(this.abilBtn, () => h.ability());
            cmds.insertBefore(this.abilBtn, this.cmdBtns.hold);
            // 向きの指定（第3群の確かめ：移動の後は進んできた向きのまま待つので、出口の前へ下ろした部隊が攻め手に背を向けていた）
            const face = button('b-btn b-cmd', '向き', '向きを変える（この後で向く方を押す。その場で向き直る）');
            press(face, () => h.command('face'));
            cmds.insertBefore(face, this.abilBtn);
            this.cmdBtns.face = face;
        }
        bottom.append(cards, cmds);

        // ---- 命令の途中の案内 ----
        this.hintEl = el('div', 'b-hint');
        this.hintText = el('span');
        this.hintCancel = button('b-btn b-hint-x', 'やめる', '命令をやめる');
        press(this.hintCancel, () => h.cancelPending());
        this.hintEl.append(this.hintText, this.hintCancel);
        this.hintEl.hidden = true;

        const portrait = el('div', 'b-portrait', '横向きにしてください（合戦は止めてあります）');
        r.append(left, mid, ctrl, zoom, bottom, this.hintEl, portrait);
        parent.append(r);
    }

    private makeCard(id: string, name: string, key: number): CardEls {
        const root = button('b-card', '', `${name}を選ぶ`);
        root.dataset.id = id;
        const head = el('div', 'b-card-h');
        const kind = el('span', 'b-kind');
        const nm = el('b', 'b-name', name);
        const badge = el('span', 'b-badge');
        head.append(kind, nm, badge, el('span', 'b-key', String(key)));
        const str = el('div', 'b-bar str');
        const strBar = el('i');
        const strText = el('span');
        str.append(strBar, strText);
        const mor = el('div', 'b-bar mor');
        const morBar = el('i');
        const morText = el('span');
        mor.append(morBar, morText);
        const ord = el('div', 'b-ord');
        const eng = el('div', 'b-eng');
        const abl = el('span', 'b-abl');
        const line = el('div', 'b-card-l');
        line.append(ord, eng, abl);
        root.append(head, str, mor, line);
        root.dataset.key = String(key);
        const c: CardEls = { root, badge, strBar, strText, morBar, morText, ord, eng, abl, last: '' };
        (kind as HTMLElement).dataset.kind = '';
        this.cards.set(id, c);
        return c;
    }

    /**
     * 札の列の押し方：マウスは押した瞬間に選ぶ（今までどおり）。指は、離したときに選ぶ（横になぞったら選ばずに列をずらす）。
     * キーボード（Enter・Space）の click でも選ぶ。PC でホイールを回すと、はみ出した列を横にずらす。
     */
    private bindCardList(list: HTMLDivElement): void {
        let drag: { id: number; x: number; sl: number; moved: boolean; card: string | null } | null = null;
        let downAt = -1e9;
        const cardOf = (t: EventTarget | null) => ((t as HTMLElement | null)?.closest?.('.b-card') as HTMLElement | null)?.dataset.id ?? null;
        list.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            downAt = performance.now();
            const id = cardOf(e.target);
            if (e.pointerType === 'mouse') {
                if (id) this.h.selectUnit(id);
                return;
            }
            drag = { id: e.pointerId, x: e.clientX, sl: list.scrollLeft, moved: false, card: id };
            try {
                list.setPointerCapture(e.pointerId);
            } catch {
                /* 捕捉できない場合もそのまま */
            }
        });
        list.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x;
            if (!drag.moved && Math.abs(dx) > 10) drag.moved = true;
            if (drag.moved) list.scrollLeft = drag.sl - dx;
        });
        const end = (e: PointerEvent, tap: boolean) => {
            if (!drag || e.pointerId !== drag.id) return;
            const d = drag;
            drag = null;
            if (tap && !d.moved && d.card) this.h.selectUnit(d.card);
        };
        list.addEventListener('pointerup', (e) => end(e, true));
        list.addEventListener('pointercancel', (e) => end(e, false));
        list.addEventListener('lostpointercapture', (e) => end(e, false));
        list.addEventListener('click', (e) => {
            e.preventDefault();
            const pt = (e as PointerEvent).pointerType;
            if (pt || performance.now() - downAt < 1500) return;
            const id = cardOf(e.target);
            if (id) this.h.selectUnit(id);
        });
        list.addEventListener(
            'wheel',
            (e) => {
                if (list.scrollWidth <= list.clientWidth + 1) return;
                e.preventDefault();
                list.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            },
            { passive: false },
        );
        // 指でなぞる間、ページ全体の touchmove の抑止（main.ts）まで届かせない
        list.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
        list.addEventListener('scroll', () => this.updateCardEdges(), { passive: true });
    }

    /** 札の列の左右に、まだ札があることの影（はみ出していなければ付けない） */
    private updateCardEdges(): void {
        const l = this.cardsEl;
        setClass(l, 'more-l', l.scrollLeft > 2);
        setClass(l, 'more-r', l.scrollLeft + l.clientWidth < l.scrollWidth - 2);
    }

    /** 選んだ部隊の札が列の外なら、見える所までずらす（選び直したときだけ） */
    private revealCard(id: string | null): void {
        if (id === this.shownCardId) return;
        this.shownCardId = id;
        const c = id ? this.cards.get(id) : undefined;
        const l = this.cardsEl;
        if (!c || l.scrollWidth <= l.clientWidth + 1) return;
        const a = c.root.offsetLeft - l.offsetLeft;
        const b = a + c.root.offsetWidth;
        if (a < l.scrollLeft) l.scrollLeft = a - 6;
        else if (b > l.scrollLeft + l.clientWidth) l.scrollLeft = b - l.clientWidth + 6;
    }

    // ---------------------------------------------------------------- 毎フレーム

    update(s: BattleState, st: UiState): void {
        setText(this.objTime, `日没まで ${timeText(s)}`);
        for (const side of ['enemy', 'ally'] as Side[]) {
            const a = armySummary(s, side);
            setText(this.objArmy[side], `${side === 'enemy' ? '敵' : '味方'}　本陣：${a.hq}　ほか ${a.total} 部隊のうち ${a.able} が戦える`);
        }
        // 札
        for (const u of s.units) {
            if (u.side !== 'ally') continue;
            const c = this.cards.get(u.id)!;
            const m = cardModel(s, u);
            this.fillCard(c, m, st.selection.includes(u.id), this.hasAbility ? cardAbilityText(s, u.id) : '');
        }
        this.revealCard(st.selectedId && this.cards.has(st.selectedId) ? st.selectedId : null);
        this.updateCardEdges();
        this.updatePledge(s);
        this.updateGoals(s);
        // 敵を調べている
        const sel = st.selectedId ? s.units.find((u) => u.id === st.selectedId) : undefined;
        if (sel && sel.side === 'enemy') {
            const m = cardModel(s, sel);
            this.inspect.hidden = false;
            const html = `<b>${escapeHtml(m.name)}</b><span class="b-kind">敵・${m.kind}</span><div class="b-irow">兵 ${m.strength}・士気 ${m.morale}${m.badge ? `・${m.badge}` : ''}</div><div class="b-irow">${escapeHtml(m.engageText === 'なし' ? '交戦なし' : m.engageText)}</div>`;
            if (this.inspect.dataset.html !== html) {
                this.inspect.dataset.html = html;
                this.inspect.innerHTML = html;
            }
        } else if (!this.inspect.hidden) this.inspect.hidden = true;
        this.updateAbility(s, sel?.id ?? null, st.pending);

        // ボタン
        const ended = !!s.result;
        setText(this.pauseBtn, !st.started ? '開始前' : st.paused ? '▶ 再開' : '指揮（一時停止）');
        setClass(this.pauseBtn, 'on', st.paused && st.started);
        setClass(this.pauseBtn, 'off', ended || !st.started);
        setClass(this.speedBtns[1], 'on', st.speed === 1);
        setClass(this.speedBtns[2], 'on', st.speed === 2);
        setClass(this.allRetBtn, 'off', ended || !st.started || s.allRetreatAt !== null);
        const ally = sel && sel.side === 'ally' ? cardModel(s, sel) : null;
        const can = !!ally && ally.commandable;
        for (const k of Object.keys(this.cmdBtns) as CommandKind[]) {
            setClass(this.cmdBtns[k]!, 'off', !can);
            setClass(this.cmdBtns[k]!, 'on', can && st.pending === k);
        }
        if (this.abilBtn) {
            // 押せる：選んだ味方の能力が今使える（使えない時も押すと理由を出すので、見た目だけ薄くする）
            const pm = sel && sel.side === 'ally' ? abilityPanelModel(s, sel.id) : null;
            setClass(this.abilBtn, 'dim', !(pm && pm.usable));
            setClass(this.abilBtn, 'on', st.pending === 'ability');
            // 敵を調べているときも押せる（押すと「敵方の能力は操作できない」と出す）
            setClass(this.abilBtn, 'off', ended || !st.started || !sel);
        }
        setClass(this.root, 'paused', st.paused && st.started && !ended);
        setClass(this.root, 'pending-attack', st.pending === 'attack');
        setClass(this.root, 'pending-move', st.pending === 'move');
        setClass(this.root, 'pending-face', st.pending === 'face');
        setClass(this.root, 'pending-ability', st.pending === 'ability');
        this.pausePill.hidden = !(st.paused && st.started && !ended);

        // 命令の途中の案内（または短い知らせ）
        let hint = '';
        // 移動先指定：味方の上を押しても選び直さず、その点へ（通れなければ近くの通れる所）
        if (st.pending === 'move') hint = `移動先指定中：${sel?.name ?? ''}の行き先を押す（味方の上も可）`;
        else if (st.pending === 'attack') hint = `${sel?.name ?? ''}：攻撃する敵の部隊を押してください`;
        else if (st.pending === 'face') hint = `向き指定中：${sel?.name ?? ''}が向く方を押す（その場で向き直る）`;
        else if (st.pending === 'ability') hint = abilityTargetHint(s, sel?.id ?? null);
        const now = performance.now();
        const flash = now < this.flashTimer ? this.flashText : '';
        // 短い知らせ（断った理由など）は、命令の途中の案内より先に出す（案内の「やめる」は残す）
        const text = flash || hint;
        this.hintEl.hidden = !text;
        this.hintCancel.hidden = !hint;
        setClass(this.hintEl, 'note-only', !hint);
        setText(this.hintText, text);
    }

    private fillCard(c: CardEls, m: CardModel, selected: boolean, abl: string): void {
        const sig = `${m.strength}|${m.morale}|${m.orderText}|${m.engageText}|${m.badge}|${selected}|${m.commandable}|${abl}`;
        if (sig === c.last) return;
        c.last = sig;
        setText(c.abl, abl);
        c.abl.hidden = !abl;
        c.abl.dataset.state = abl.endsWith('可') ? 'ready' : abl.endsWith('秒') ? 'active' : 'spent';
        const kindEl = c.root.querySelector('.b-kind') as HTMLElement;
        setText(kindEl, m.kind);
        setText(c.badge, m.badge);
        c.strBar.style.width = `${Math.round(m.strengthRatio * 100)}%`;
        setText(c.strText, `兵 ${m.strength}`);
        c.morBar.style.width = `${m.morale}%`;
        c.morBar.dataset.tone = m.moraleTone;
        setText(c.morText, `士気 ${m.morale}`);
        setText(c.ord, m.orderText);
        // 命令を受けていない待機（武将任せ）は、札の文の上に説明を出す（命じた「防衛・待機」と分ける）
        const ordTitle = m.orderText === FREE_HOLD_LABEL ? FREE_HOLD_NOTE : '';
        if (c.ord.title !== ordTitle) c.ord.title = ordTitle;
        setText(c.eng, m.engageText === 'なし' ? '' : `⚔ ${m.engageText}`);
        setClass(c.root, 'sel', selected);
        setClass(c.root, 'engaged', m.engageText !== 'なし');
        setClass(c.root, 'gone', !m.commandable && m.badge !== '' && m.badge !== '到着待ち');
        setClass(c.root, 'waiting', m.badge === '到着待ち');
        c.root.setAttribute('aria-pressed', String(selected));
    }

    /** 約束の行（約束のない合戦は隠す） */
    private updatePledge(s: BattleState): void {
        const p = pledgeLineModel(s);
        if (!p) {
            if (!this.pledgeEl.hidden) this.pledgeEl.hidden = true;
            return;
        }
        this.pledgeEl.hidden = false;
        const html = `<b>${escapeHtml(p.title)}</b><span>${escapeHtml(p.status)}</span>`;
        if (this.pledgeEl.dataset.html !== html) {
            this.pledgeEl.dataset.html = html;
            this.pledgeEl.innerHTML = html;
        }
        if (this.pledgeEl.dataset.tone !== p.tone) this.pledgeEl.dataset.tone = p.tone;
    }

    /** 目標の欄（主目標・副目標の進み具合。畳んでいるときは見出しに主目標の短い進み） */
    private updateGoals(s: BattleState): void {
        if (!this.goals) return;
        const m = objectivePanelModel(s);
        if (!m) return;
        const rows: ObjectiveRowModel[] = [...(m.primary ? [m.primary] : []), ...m.secondary];
        for (const r of rows) {
            const g = this.goalRows.get(r.id);
            if (!g) continue;
            const sig = `${r.state}|${r.progressText}`;
            if (sig === g.last) continue;
            g.last = sig;
            g.e.dataset.state = r.state;
            g.e.dataset.tone = r.tone;
            // 進みの文が目標の名前と同じ（敵本陣を崩す など）なら出さない
            setText(g.text, r.state === 'done' ? '✓ 達成' : r.state === 'failed' ? '✗ 果たせない' : r.progressText === r.label ? '' : r.progressText);
            g.text.hidden = !g.text.textContent;
        }
        const p = m.primary;
        // 見出しの短い進み（括弧の中の説明は省く）
        const sum = objectiveSummaryText(p);
        if (this.goalSum) setText(this.goalSum, sum);
        if (p && this.goals.dataset.state !== p.state) this.goals.dataset.state = p.state;
    }

    /** 選んだ部隊の能力の欄（先頭に率いる武将。能力名・対象・範囲・効果・代償・使えるか） */
    /** 縦の狭い画面（スマホの横向き。battle.css の @media (max-height: 520px) と同じ） */
    private compactScreen(): boolean {
        try {
            return typeof matchMedia === 'function' && matchMedia('(max-height: 520px)').matches;
        } catch {
            return false;
        }
    }

    private updateAbility(s: BattleState, selId: string | null, pending: Pending): void {
        // 縦の狭い画面：目標の欄と能力の欄を同時に開くと、左上の列が札の列まで伸びて重なり、地図の左も覆う。
        // 部隊を選び直したら目標の欄を畳み、目標の欄を開いている間は能力の欄を隠す（目標の見出しを押して畳めば戻る）
        if (this.goals && this.compactScreen()) {
            const open = !this.goals.classList.contains('closed');
            if (open && selId && selId !== this.lastAbilSel) this.goals.classList.add('closed');
            this.lastAbilSel = selId;
            if (!this.goals.classList.contains('closed')) {
                if (!this.abil.hidden) this.abil.hidden = true;
                return;
            }
        } else if (this.goals) {
            // PC（第3群の確かめ）：目標の欄は開いたまま始まるので、部隊を選ぶと能力の欄と 2 つで画面の左の 3 割近く（幅 330 px）を覆い、
            // 湿地の西の島・村落の西の家並みが隠れ、城攻め前面では能力の欄の下が札の列に重なっていた。部隊を選び直したら目標の欄を畳む
            // （見出しの 1 行に主目標の進みが出る。見出しを押せば開き直せ、そのときは能力の欄の長い説明を省く：battle.css の .goals-open）
            if (!this.goals.classList.contains('closed') && selId && selId !== this.lastAbilSel) this.goals.classList.add('closed');
            this.lastAbilSel = selId;
        } else this.lastAbilSel = selId;
        if (this.goals) {
            const gOpen = !this.goals.classList.contains('closed');
            if (this.root.classList.contains('goals-open') !== gOpen) this.root.classList.toggle('goals-open', gOpen);
        }
        const u = selId ? s.units.find((x) => x.id === selId) : undefined;
        const m = u ? abilityPanelModel(s, u.id) : null;
        const gm = u ? generalLineModel(s, u.id) : null;
        // 率いる武将の行（名前・役割・主人公との関係（歴史分岐の信頼）・固有能力。仮の能力は「仮」の印）
        const gen = gm
            ? `<div class="b-gen" data-general="${escapeHtml(gm.generalId)}"><b>${escapeHtml(gm.name)}</b><span class="b-gen-role">${escapeHtml(gm.roleLabel)}</span>${
                  gm.relation ? `<span class="b-gen-rel">${escapeHtml(gm.relation.label)} ${gm.relation.value}</span>` : ''
              }${gm.abilityName ? `<span class="b-gen-ab">固有能力「${escapeHtml(gm.abilityName)}」${gm.provisional ? '<em class="b-prov">仮</em>' : ''}</span>` : ''}</div>`
            : '';
        let html = '';
        let side = '';
        if (m) {
            side = m.info.side;
            const rows: string[] = [];
            rows.push(`<div class="b-ab-h"><b>能力「${escapeHtml(m.name)}」</b><span class="b-ab-st ${m.tone}">${escapeHtml(m.stateText)}</span></div>`);
            if (m.reason && (m.tone === 'blocked' || m.tone === 'enemy')) rows.push(`<div class="b-ab-why">${escapeHtml(m.info.controllable ? `使えない：${m.reason}` : m.reason)}</div>`);
            if (pending === 'ability' && m.usable)
                rows.push(`<div class="b-ab-why go">${m.info.id === 'nagamasa_support' ? '援護する味方' : '対象の味方'}を押す（${m.info.range} m 以内・${m.info.validTargets.length} 部隊）</div>`);
            else if (m.howTo && m.info.controllable) rows.push(`<div class="b-ab-why go">${escapeHtml(m.howTo)}</div>`);
            if (m.remainText) rows.push(`<div class="b-ab-r b-ab-left"><i>残り</i>${escapeHtml(m.remainText)}</div>`);
            rows.push(`<div class="b-ab-r"><i>対象</i>${escapeHtml(m.short.target)}（範囲 ${m.info.range} m）</div>`);
            rows.push(`<div class="b-ab-r b-ab-range"><i>範囲</i>${escapeHtml(m.rangeText)}</div>`);
            rows.push(`<div class="b-ab-r"><i>効果</i>${escapeHtml(m.short.effect)}</div>`);
            rows.push(`<div class="b-ab-r"><i>代償</i>${escapeHtml(m.short.cost)}</div>`);
            rows.push(`<div class="b-ab-r b-ab-uses"><i>回数</i>${escapeHtml(m.uses)}${m.info.controllable ? '' : '・プレイヤーは操作できない'}</div>`);
            rows.push(`<div class="b-ab-long">${escapeHtml(m.effectText)}／代償：${escapeHtml(m.costText)}</div>`);
            rows.push(`<div class="b-ab-note">${escapeHtml(m.note)}</div>`);
            html = gen + rows.join('');
        } else if (u && u.side === 'ally' && this.hasAbility) {
            html = `${gen}<div class="b-ab-h"><b>特殊能力なし</b></div><div class="b-ab-r">率いる武将（能力を持つ人物）のいない部隊は、特殊能力を使えない</div>`;
            side = 'ally';
        } else if (gen) {
            html = gen;
            side = u!.side;
        }
        if (!html) {
            if (!this.abil.hidden) this.abil.hidden = true;
            return;
        }
        this.abil.hidden = false;
        if (this.abil.dataset.html !== html) {
            this.abil.dataset.html = html;
            this.abil.innerHTML = html;
        }
        if (this.abil.dataset.side !== side) this.abil.dataset.side = side;
    }

    // ---------------------------------------------------------------- 名札

    /** 地図の上の名札（CSS px の位置。shown が false なら隠す）。部隊の名札は data-id に部隊 id（地形の名札は付けない） */
    label(id: string, text: string, side: Side | 'terrain', x: number, y: number, shown: boolean, extra = ''): void {
        let l = this.labelEls.get(id);
        if (!l) {
            const e = el('div', `b-label ${side}`);
            if (side !== 'terrain') e.dataset.id = id;
            const name = el('span', 'b-lab-n');
            const small = el('small');
            const ab = el('span', 'b-lab-ab');
            small.hidden = true;
            ab.hidden = true;
            e.append(name, small, ab);
            this.labels.append(e);
            l = { e, name, small, ab, x: NaN, y: NaN, shown: true, text: '', abMode: '', abText: '', blink: -1, dy: 0, px: NaN, py: NaN, fit: 'full', imp: false, fw: 0, fh: 0, mw: 0, mh: 0, nw: 0 };
            this.labelEls.set(id, l);
        }
        if (l.shown !== shown) {
            l.shown = shown;
            l.e.hidden = !shown;
            // 隠した名札は、名前・兵の数・位置を DOM に残さない（第4群の夜：発見していない敵の名札が、隠れた要素から読めないように）
            if (!shown && side !== 'terrain') {
                l.text = '';
                setText(l.name, '');
                setText(l.small, '');
                l.small.hidden = true;
                l.px = l.py = NaN;
                l.e.style.transform = '';
            }
        }
        if (!shown) return;
        if (l.text !== text + '\u0000' + extra) {
            l.text = text + '\u0000' + extra;
            setText(l.name, text);
            setText(l.small, extra);
            l.small.hidden = !extra;
        }
        l.x = x;
        l.y = y;
        this.placeLabel(l);
    }

    /** 名札を (x, y + dy) に置く（前と 0.4 px 以内なら書き直さない） */
    private placeLabel(l: LabelEls): void {
        const y = l.y + l.dy;
        if (Math.abs(l.px - l.x) <= 0.4 && Math.abs(l.py - y) <= 0.4) return;
        l.px = l.x;
        l.py = y;
        l.e.style.transform = `translate(${l.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }

    /**
     * 部隊の名札の重なりをほどく・優先表示（特殊能力のある合戦だけ。つなぎが毎フレーム、名札を置いた後に呼ぶ）。
     * 並べ方は labelLayout.ts の layoutLabels（docs/fields-group2-design.md §2）：選んだ名札 > 能力を使える（点滅）・対象選びで選べる名札 >
     * 重要な武将 > 画面の中央に近い、の順に置く。選んだ・点滅の名札はそのまま（重なれば上へずらす。小さくも隠しもしない＝点滅する印は
     * いつも見えて押せる）。ほかの名札は、重なれば小さく（名前だけ・小さい字）、小さくしても重なれば一時的に隠す（data-fit）。
     * 名札の大きさは毎フレーム読む（書き込みの後にまとめて読むので、並べ直しは 1 フレーム 1 回）。いまと違う見せ方の大きさは、最後に測った値
     * （まだ測っていなければ名前の幅からの見積もり）を使う。
     */
    declutterLabels(on: boolean): void {
        this.declutterMapLabels(on);
        const list: { l: LabelEls; it: LabelLayoutItem }[] = [];
        for (const l of this.labelEls.values()) {
            const id = l.e.dataset.id;
            if (!id) continue;
            if (!on || !l.shown) {
                if (l.fit !== 'full') this.setFit(l, 'full');
                if (l.dy !== 0) {
                    l.dy = 0;
                    if (l.shown) this.placeLabel(l);
                }
                continue;
            }
            const keep = l.abMode === 'ready' || l.abMode === 'choosing' || l.abMode === 'target';
            const it: LabelLayoutItem = { id, x: l.x, y: l.y, w: 0, h: 0, mw: 0, mh: 0, sel: l.e.classList.contains('sel'), ready: keep, important: l.imp, prev: l.fit };
            list.push({ l, it });
        }
        if (list.length === 0) return;
        // 選んだ・点滅の名札が小さい・隠れたままなら、測る前にそのままの見せ方へ戻す（大きさをそのままで測る）
        for (const { l, it } of list) if ((it.sel || it.ready) && l.fit !== 'full') this.setFit(l, 'full');
        for (const { l, it } of list) {
            const w = l.e.offsetWidth;
            const h = l.e.offsetHeight;
            if (l.fit === 'full') {
                l.fw = w;
                l.fh = h;
                l.nw = l.name.offsetWidth;
            } else {
                l.mw = w;
                l.mh = h;
            }
            it.w = l.fw || w;
            it.h = l.fh || h;
            // 小さくした大きさ：測っていなければ、名前の幅（小さい字）と枠の余白から見積もる
            it.mw = l.mw || Math.min(it.w, Math.round((l.nw || it.w * 0.6) * 0.82 + 8));
            it.mh = l.mh || Math.min(it.h, Math.round(it.h * 0.85));
        }
        const W = this.labels.clientWidth || window.innerWidth;
        const H = this.labels.clientHeight || window.innerHeight;
        const items = list.map((k) => k.it);
        const lay = layoutLabels(items, W / 2, H / 2);
        this.lastLayout = { items, out: [...lay].map(([id, p]) => ({ id, ...p })) };
        for (const { l, it } of list) {
            const p = lay.get(it.id);
            if (!p) continue;
            if (p.fit !== l.fit) this.setFit(l, p.fit);
            if (Math.abs(l.dy - p.dy) > 0.4) {
                l.dy = p.dy;
                this.placeLabel(l);
            }
        }
    }

    /**
     * 地図の名札（地形・目標・門・援軍・退き口・狭い正面。data-id の無い名札）の重なりをほどく（特殊能力のある合戦だけ。架空の第一章は今までどおり）。
     * 優先の順（labelLayout.ts の mapLabelRank：目標 > 門 > 援軍 > 退き口 > 狭い正面 > 地形の名前）に置き、先に置いた名札と重なる名札は
     * 一時的に隠す（data-fit="hide"。目標の輪の名札は隠さない）。部隊の名札とは比べない
     */
    private declutterMapLabels(on: boolean): void {
        const list: { l: LabelEls; it: MapLabelItem }[] = [];
        for (const [id, l] of this.labelEls) {
            if (l.e.dataset.id) continue;
            if (!on || !l.shown) {
                if (l.fit !== 'full') this.setFit(l, 'full');
                continue;
            }
            list.push({ l, it: { id, x: l.x, y: l.y + l.dy, w: l.e.offsetWidth, h: l.e.offsetHeight, prevHidden: l.fit === 'hide' } });
        }
        if (list.length === 0) return;
        const hidden = layoutMapLabels(list.map((k) => k.it));
        for (const { l, it } of list) {
            const fit: LabelFit = hidden.has(it.id) ? 'hide' : 'full';
            if (l.fit !== fit) this.setFit(l, fit);
        }
    }

    /** 名札の優先表示の見せ方を書く（data-fit：mini＝名前だけ小さく・hide＝一時的に隠す。full は付けない） */
    private setFit(l: LabelEls, fit: LabelFit): void {
        l.fit = fit;
        if (fit === 'full') delete l.e.dataset.fit;
        else l.e.dataset.fit = fit;
    }

    /** 名札の重要な武将の印（優先表示の順。武将のいる部隊・本陣・約束や目標の印の付いた部隊） */
    labelImportant(id: string, on: boolean): void {
        const l = this.labelEls.get(id);
        if (l) l.imp = on;
    }

    /** 最後に並べた名札（確かめ用。並べる前の項目と、並べた結果） */
    lastLayout: { items: LabelLayoutItem[]; out: { id: string; fit: LabelFit; dy: number }[] } | null = null;

    /** 名札の優先表示の見せ方（確かめ用。名札が無ければ null） */
    labelFit(id: string): LabelFit | null {
        return this.labelEls.get(id)?.fit ?? null;
    }

    /**
     * 名札の能力の印（control.ts の labelAbilityModel）。blink は点滅の明るさ（0.55〜1.0。ready のときだけ使う）。
     * 明るさは CSS の変数 --ab で渡す（表示の時計で毎フレーム。一時停止中も変わる）。
     */
    labelAbility(id: string, m: LabelAbilityModel, blink: number): void {
        const l = this.labelEls.get(id);
        if (!l) return;
        if (l.abMode !== m.mode) {
            l.abMode = m.mode;
            if (m.mode) l.e.dataset.ab = m.mode;
            else delete l.e.dataset.ab;
        }
        if (l.abText !== m.text) {
            l.abText = m.text;
            setText(l.ab, m.text);
            l.ab.hidden = !m.text;
        }
        const k = m.mode === 'ready' ? Math.round(blink * 100) / 100 : 1;
        if (k !== l.blink) {
            l.blink = k;
            l.e.style.setProperty('--ab', String(k));
        }
    }

    /**
     * 名札の四角（CSS px。ページの左上から。隠れていれば null）。part：'all' は名札全体、'badge' は能力の印（◆号令・対象を選ぶ）だけ
     * （印が無ければ null）。ワンクリック発動の当たりは印の方（名札の名前の所は、今までどおり部隊の選択）。
     */
    labelRect(id: string, part: 'all' | 'badge' = 'all'): DOMRect | null {
        const l = this.labelEls.get(id);
        // 優先表示で一時的に隠した名札は押せない（見えていない）
        if (!l || !l.shown || l.e.hidden || l.fit === 'hide') return null;
        if (part === 'badge' && l.ab.hidden) return null;
        const r = (part === 'badge' ? l.ab : l.e).getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
    }

    /**
     * 画面に出ている部隊の名札の四角（CSS px。ページの左上から）と、描く重なりの順 z（大きいほど上）。
     * battle.css と同じ決まり：発動できる名札・対象選びの持ち主（data-ab が ready・choosing。z-index: 2）が上、その中では後から足した名札が上。
     * つなぎが、隠れた名札の印を押したことにしないために使う（control.ts の labelHit の covers）。
     */
    labelCovers(): { id: string; rect: DOMRect; z: number }[] {
        const out: { id: string; rect: DOMRect; z: number }[] = [];
        let i = 0;
        for (const [id, l] of this.labelEls) {
            i++;
            if (!l.e.dataset.id || !l.shown || l.e.hidden || l.fit === 'hide') continue;
            const r = l.e.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) continue;
            const top = l.abMode === 'ready' || l.abMode === 'choosing';
            out.push({ id, rect: r, z: (top ? 100000 : 0) + i });
        }
        return out;
    }

    /** 地図を覆っている画面の部品の四角（左上の欄・能力の欄・下の札・案内の帯・右上・右の寄る引く。見えているものだけ） */
    blockerRects(): DOMRect[] {
        const out: DOMRect[] = [];
        for (const sel of ['.b-obj', '.b-goals', '.b-inspect', '.b-abil', '.b-bottom', '.b-hint', '.b-ctrl', '.b-zoom']) {
            const e = this.root.querySelector(sel) as HTMLElement | null;
            if (!e || e.hidden) continue;
            const r = e.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) out.push(r);
        }
        return out;
    }

    /**
     * 発動の知らせ（上の真ん中。能力名・武将・対象）と、効果が切れた知らせ。ms だけ出して消える（画面全体は光らせない）。
     */
    abilityNotice(kind: 'use' | 'end', title: string, sub: string, ms = kind === 'use' ? 2500 : 1800): void {
        const e = this.abNote;
        e.dataset.kind = kind;
        e.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<span>${escapeHtml(sub)}</span>` : ''}`;
        e.hidden = false;
        e.classList.remove('fade');
        if (this.abNoteTimer) {
            window.clearTimeout(this.abNoteTimer);
            this.timers.delete(this.abNoteTimer);
        }
        const id1 = window.setTimeout(() => {
            e.classList.add('fade');
            const id2 = window.setTimeout(() => {
                if (e.classList.contains('fade')) e.hidden = true;
                this.timers.delete(id2);
            }, 300);
            this.timers.add(id2);
            this.timers.delete(id1);
            if (this.abNoteTimer === id1) this.abNoteTimer = 0;
        }, ms);
        this.abNoteTimer = id1;
        this.timers.add(id1);
    }

    /** 名札に目標の印を添える（例：救出・守る・崩す。空なら外す）。CSS が data-mark を前に出す */
    labelMark(id: string, mark: string): void {
        const l = this.labelEls.get(id);
        if (!l) return;
        if ((l.e.dataset.mark ?? '') !== mark) {
            if (mark) l.e.dataset.mark = mark;
            else delete l.e.dataset.mark;
        }
    }

    /** 引いた画面の名札（小さく薄く。選んだ・点滅している・敗走の名札はそのまま）。battle.css の .b-labels.far */
    setLabelsFar(far: boolean): void {
        setClass(this.labels, 'far', far);
    }

    /** 選んだ名札を目立たせる */
    markLabel(id: string, cls: string, on: boolean): void {
        if (!this.labelEls.has(id)) return;
        const l = this.labelEls.get(id);
        if (l) setClass(l.e, cls, on);
    }

    // ---------------------------------------------------------------- 知らせ

    toast(text: string, tone: Tone, unitId?: string): void {
        // 知らせは読むだけ（押しても何も起きない。pointer-events: none で、下の地図のタップ・ドラッグを奪わない）
        const t = el('div', `b-toast ${tone}`, text);
        if (unitId) t.dataset.unit = unitId;
        this.toasts.prepend(t);
        while (this.toasts.children.length > this.maxToasts) this.toasts.lastElementChild?.remove();
        const id1 = window.setTimeout(() => {
            t.classList.add('fade');
            const id2 = window.setTimeout(() => {
                t.remove();
                this.timers.delete(id2);
            }, 500);
            this.timers.add(id2);
            this.timers.delete(id1);
        }, 5000);
        this.timers.add(id1);
    }

    /** 下の案内に短く出す（命令を出した・出せなかった） */
    flash(text: string, ms = 1800): void {
        this.flashText = text;
        this.flashTimer = performance.now() + ms;
    }

    // ---------------------------------------------------------------- 大きな枠（説明・確かめ・結果）

    get modalOpen(): 'briefing' | 'confirm' | 'result' | null {
        return this.modalKind;
    }

    /** キーボード：Enter（説明・確かめ・結果の主なボタン）・Esc（確かめのやめる） */
    modalKey(key: 'primary' | 'cancel'): boolean {
        if (!this.modal) return false;
        if (key === 'primary' && this.modalPrimary) {
            this.modalPrimary();
            return true;
        }
        if (key === 'cancel' && this.modalCancel) {
            this.modalCancel();
            return true;
        }
        return false;
    }

    private openModal(kind: 'briefing' | 'confirm' | 'result', cls: string): HTMLDivElement {
        this.closeModal();
        const back = el('div', `b-modal-back ${kind}`);
        const box = el('div', `b-modal ${cls}`);
        box.setAttribute('role', 'dialog');
        back.append(box);
        this.root.append(back);
        this.modal = back;
        this.modalKind = kind;
        // 枠の外を押しても地図には届かない
        back.addEventListener('pointerdown', (e) => e.stopPropagation());
        // 枠の中は指でなぞって送れるように（ページ全体の touchmove の抑止 main.ts まで届かせない）
        box.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
        return box;
    }

    closeModal(): void {
        this.modal?.remove();
        this.modal = null;
        this.modalKind = null;
        this.modalPrimary = null;
        this.modalCancel = null;
    }

    private startBtn: HTMLButtonElement | null = null;

    showBriefing(title: string, lines: string[], ready: boolean): void {
        const box = this.openModal('briefing', 'b-brief');
        box.append(el('h2', '', title));
        const list = el('div', 'b-brief-lines');
        for (const l of lines) list.append(el('p', '', l));
        box.append(list);
        const how = el('div', 'b-how');
        how.append(el('b', '', '操作'));
        const touchLines = [
            '部隊（または下の札）を押して選ぶ → 地面を押すと移動、敵を押すと攻撃（敵のすぐ近くの地面も攻撃になる。脇へ動かすには「移動」の後で地面を押す）。選んだ部隊をもう一度押すと選択を外す（敵を調べられる）。',
            '「移動」（移動先指定）の後は、味方の立つ所を押しても選び直さず、そこへ移動する。',
            ...(this.cards.size > 4 ? ['下の札は横になぞるとずらせる（隠れている部隊の札が出る）。'] : []),
            '「防衛・待機」「撤退」はボタン。1 本指で地図を動かす、2 本指で寄る・引く。',
            '「指揮（一時停止）」で時を止めて命令を出せる。',
        ];
        const nCards = this.cards.size;
        const pcLines = [
            `クリック（または下の札・1〜${Math.max(1, Math.min(8, nCards))} キー）で部隊を選ぶ → 地面をクリックで移動、敵をクリックで攻撃（右クリックでも命令。敵のすぐ近くの地面も攻撃になる。脇へ動かすには M の後で地面をクリック）。`,
            'M（移動先指定）の後は、味方の立つ所をクリックしても選び直さず、そこへ移動する。',
            'ドラッグで地図を動かす、ホイールで寄る・引く。M 移動・A 攻撃・H 防衛・待機・R 撤退・Esc 取り消し。',
            'Space で指揮（一時停止）／再開。止めたまま命令を出せる。',
        ];
        if (this.hasAbility) {
            touchLines.push(
                '特殊能力（ゲーム用の創作）：使える武将は地図の名札の印（◆）が青緑に点滅する。印をタップするだけで使える（対象を選ぶ能力は、その後で輪の付いた味方をタップ）。部隊を選んで「能力」でも使える。指揮中も使える。',
            );
            pcLines.push(
                '特殊能力（ゲーム用の創作）：使える武将は地図の名札の印（◆）が青緑に点滅する。印をクリックするだけで使える（対象を選ぶ能力は、その後で輪の付いた味方をクリック。Esc で取り消し）。部隊を選んで「能力」ボタンか F で使うこともできる。',
            );
        }
        for (const l of this.opts.touch ? touchLines : pcLines) how.append(el('p', '', l));
        box.append(how);
        const b = button('b-btn b-primary', ready ? '合戦を始める' : '準備中…', '合戦を始める');
        if (!ready) b.classList.add('off');
        press(b, () => this.h.start());
        this.startBtn = b;
        const row = el('div', 'b-modal-row');
        // 説明が枠に収まらないときは、続きがあることを添える（「合戦を始める」は枠の下に貼りついて常に見える）
        const more = el('span', 'b-more', this.opts.touch ? '↓ 続きがある（なぞって読む）' : '↓ 続きがある（ホイールで読む）');
        const updateMore = () => {
            more.hidden = box.scrollHeight - box.clientHeight - box.scrollTop <= 4;
        };
        box.addEventListener('scroll', updateMore, { passive: true });
        requestAnimationFrame(updateMore);
        row.append(more, b);
        box.append(row);
        this.modalPrimary = () => {
            if (!b.classList.contains('off')) this.h.start();
        };
    }

    setBriefingReady(ready: boolean): void {
        if (!this.startBtn) return;
        setClass(this.startBtn, 'off', !ready);
        setText(this.startBtn, ready ? '合戦を始める' : '準備中…');
    }

    confirm(title: string, text: string, yes: string, no: string): Promise<boolean> {
        return new Promise((resolve) => {
            const box = this.openModal('confirm', 'b-confirm');
            box.append(el('h2', '', title), el('p', '', text));
            const row = el('div', 'b-modal-row');
            const y = button('b-btn b-primary danger', yes, yes);
            const n = button('b-btn', no, no);
            const done = (v: boolean) => {
                this.closeModal();
                resolve(v);
            };
            press(y, () => done(true));
            press(n, () => done(false));
            row.append(n, y);
            box.append(row);
            this.modalPrimary = () => done(true);
            this.modalCancel = () => done(false);
        });
    }

    showResult(m: ResultModel): void {
        const box = this.openModal('result', `b-result ${m.kind}`);
        const head = el('div', 'b-result-head');
        head.append(el('h2', '', m.title), el('span', 'b-tag', this.tag));
        box.append(head, el('p', 'b-reason', m.reason));
        if (m.objectives) {
            // 主目標・副目標の結果（勝敗・約束とは別の行）
            const ob = el('div', 'b-robj');
            const line = (role: 'primary' | 'secondary', label: string, achieved: boolean) => {
                const r = el('div', `b-robj-row ${achieved ? 'ok' : 'ng'}`);
                r.dataset.role = role;
                r.dataset.achieved = String(achieved);
                r.append(el('i', '', role === 'primary' ? '主目標' : '副目標'), el('b', '', label), el('span', '', achieved ? '達成' : '未達成'));
                ob.append(r);
            };
            if (m.objectives.primary) line('primary', m.objectives.primary.label, m.objectives.primary.achieved);
            for (const r of m.objectives.secondary) line('secondary', r.label, r.achieved);
            box.append(ob);
        }
        if (m.pledge) {
            // 約束の結果は勝敗とは別の欄に出す（勝っても守れない・撤退しても守れた、がある）
            const pl = el('div', `b-rpledge ${m.pledge.result}`);
            pl.append(el('b', '', m.pledge.title), el('span', '', m.pledge.text));
            box.append(pl);
        }
        box.append(el('p', 'b-rtime', `合戦の時間 ${m.time}・味方の失った兵 ${m.lost.ally} / ${m.start.ally}・敵の失った兵 ${m.lost.enemy} / ${m.start.enemy}`));
        const table = el('table', 'b-rtable');
        const thead = el('tr');
        for (const t of ['部隊', '兵（始め→終わり）', '状態']) thead.append(el('th', '', t));
        table.append(thead);
        for (const side of ['ally', 'enemy'] as Side[]) {
            const sep = el('tr', 'sep');
            const td = el('td', '', side === 'ally' ? '味方' : '敵');
            td.colSpan = 3;
            sep.append(td);
            table.append(sep);
            for (const r of m.rows.filter((x) => x.side === side)) {
                const tr = el('tr', side);
                tr.append(el('td', '', r.name), el('td', 'num', `${r.start} → ${r.end}（-${r.lost}）`), el('td', '', r.status));
                table.append(tr);
            }
        }
        const wrap = el('div', 'b-rtable-wrap');
        wrap.append(table);
        box.append(wrap);
        if (m.note) box.append(el('p', 'b-note', m.note));
        if (m.abilities) box.append(el('p', 'b-note b-rabil', m.abilities));
        if (m.save) {
            const sv = el('p', `b-rsave ${m.save.ok ? 'ok' : 'ng'}`, m.save.text);
            sv.setAttribute('role', m.save.ok ? 'status' : 'alert');
            box.append(sv);
        }
        const row = el('div', 'b-modal-row');
        const b = button('b-btn b-primary', '続ける', '続ける');
        press(b, () => this.h.continueAfterResult());
        row.append(b);
        box.append(row);
        this.modalPrimary = () => this.h.continueAfterResult();
    }

    /** UI に隠れる地図の端（px）。カメラの「全体」をこの内側に収める */
    insets(): { top: number; bottom: number; left: number; right: number } {
        const H = this.root.clientHeight || window.innerHeight;
        const W = this.root.clientWidth || window.innerWidth;
        const q = (sel: string) => this.root.querySelector(sel)?.getBoundingClientRect();
        const head = q('.b-obj-head');
        const ctrl = q('.b-ctrl');
        const bottom = q('.b-bottom');
        const zoom = q('.b-zoom');
        const top = Math.max(head?.bottom ?? 0, ctrl?.bottom ?? 0) + 6;
        const bot = bottom ? H - bottom.top + 6 : 0;
        const right = zoom ? W - zoom.left + 4 : 0;
        return { top, bottom: bot, left: 8, right };
    }

    dispose(): void {
        for (const t of this.timers) window.clearTimeout(t);
        this.timers.clear();
        this.closeModal();
        this.root.remove();
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
