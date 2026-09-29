/**
 * 合戦の画面の部品（DOM）。three は使わない。表示する中身はつなぎ（entry.ts）から受け取り、押されたら handlers を呼ぶだけ。
 * 置くもの（docs/chapter1-spec.md §4 表示と操作）：
 * - 左上：戦場の名前・仮シナリオ・日没までの残り時間・勝ち負けの条件・両軍の様子（スマホでは畳める）
 * - 上の真ん中：指揮中（一時停止）の印と、出来事の知らせ（押すとその部隊へカメラを寄せる）
 * - 右上：指揮（一時停止）／再開・速さ ×1 ×2・全軍撤退（確かめてから）
 * - 右：寄る・引く・全体
 * - 下：味方の部隊の札（兵・士気・今の命令・交戦相手）と、命令のボタン（移動・攻撃・防衛・待機・撤退）
 * - 地図の上の名札、合戦の前の説明、全軍撤退の確かめ、結果
 * ボタンは押した瞬間（pointerdown）に反応し、その後の click は無視する（キーボードの Enter／Space の click だけ受ける）。
 * 画面を押して地図を動かす面（input）は一番下に敷き、つなぎがそこへ指・マウスの処理を付ける。
 */
import type { BattleState } from './sim';
import { CONDITIONS, armySummary, cardModel, timeText, type CardModel, type Pending, type ResultRow } from './control';
import type { Side } from './types';

export type CommandKind = 'move' | 'attack' | 'hold' | 'retreat';

export interface UiHandlers {
    start(): void;
    togglePause(): void;
    setSpeed(k: 1 | 2): void;
    command(c: CommandKind): void;
    cancelPending(): void;
    allRetreat(): void;
    selectUnit(id: string): void;
    /** 1 寄る・-1 引く・0 全体 */
    zoom(dir: 1 | -1 | 0): void;
    continueAfterResult(): void;
}

export interface UiState {
    selectedId: string | null;
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

interface CardEls {
    root: HTMLButtonElement;
    badge: HTMLElement;
    strBar: HTMLElement;
    strText: HTMLElement;
    morBar: HTMLElement;
    morText: HTMLElement;
    ord: HTMLElement;
    eng: HTMLElement;
    last: string;
}

export class BattleUi {
    readonly root: HTMLDivElement;
    /** 地図を押す・動かす面（つなぎが指・マウスの処理を付ける） */
    readonly input: HTMLDivElement;
    private readonly labels: HTMLDivElement;
    private readonly labelEls = new Map<string, { e: HTMLElement; x: number; y: number; shown: boolean; text: string }>();
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
    private readonly cmdBtns: Record<CommandKind, HTMLButtonElement>;
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
        this.root = r;
        if (opts.touch) r.classList.add('b-touch');
        this.maxToasts = opts.touch ? 3 : 4;

        this.input = el('div', 'b-input');
        this.labels = el('div', 'b-labels');
        r.append(this.input, this.labels);

        // ---- 左上：戦場・残り時間・条件 ----
        const obj = el('div', 'b-obj');
        this.objHead = button('b-obj-head', '', '勝ち負けの条件を開く／閉じる');
        this.objHead.append(el('b', 'b-obj-name', s.map.name), el('span', 'b-tag', '仮シナリオ'));
        this.objTime = el('span', 'b-time');
        this.objHead.append(this.objTime, el('span', 'b-caret', '条件'));
        const body = el('div', 'b-obj-body');
        for (const c of CONDITIONS) {
            const row = el('div', `b-cond ${c.tone}`);
            row.append(el('b', '', c.label), el('span', '', c.text));
            body.append(row);
        }
        this.objArmy = { enemy: el('div', 'b-army enemy'), ally: el('div', 'b-army ally') };
        body.append(this.objArmy.enemy, this.objArmy.ally);
        obj.append(this.objHead, body);
        if (opts.touch) obj.classList.add('closed');
        press(this.objHead, () => obj.classList.toggle('closed'));
        this.inspect = el('div', 'b-inspect');
        this.inspect.hidden = true;
        const left = el('div', 'b-topleft');
        left.append(obj, this.inspect);

        // ---- 上の真ん中：一時停止の印・知らせ ----
        const mid = el('div', 'b-topmid');
        this.pausePill = el('div', 'b-pausepill');
        this.pausePill.innerHTML = '<b>指揮中（一時停止）</b><span>　命令を出せます</span>';
        this.toasts = el('div', 'b-toasts');
        this.toasts.setAttribute('aria-live', 'polite');
        mid.append(this.pausePill, this.toasts);

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
        let key = 1;
        for (const u of s.units) {
            if (u.side !== 'ally') continue;
            const c = this.makeCard(u.id, u.name, key++);
            cards.append(c.root);
        }
        const cmds = el('div', 'b-cmds');
        this.cmdBtns = {
            move: button('b-btn b-cmd', '移動', '移動（この後で地面を押す）'),
            attack: button('b-btn b-cmd', '攻撃', '攻撃（この後で敵を押す）'),
            hold: button('b-btn b-cmd', '防衛・待機', '防衛・待機'),
            retreat: button('b-btn b-cmd', '撤退', 'この部隊を撤退させる'),
        };
        for (const k of Object.keys(this.cmdBtns) as CommandKind[]) {
            press(this.cmdBtns[k], () => h.command(k));
            cmds.append(this.cmdBtns[k]);
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
        root.append(head, str, mor, ord, eng);
        press(root, () => this.h.selectUnit(id));
        const c: CardEls = { root, badge, strBar, strText, morBar, morText, ord, eng, last: '' };
        (kind as HTMLElement).dataset.kind = '';
        this.cards.set(id, c);
        return c;
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
            this.fillCard(c, m, st.selectedId === u.id);
        }
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
            setClass(this.cmdBtns[k], 'off', !can);
            setClass(this.cmdBtns[k], 'on', can && st.pending === k);
        }
        setClass(this.root, 'paused', st.paused && st.started && !ended);
        setClass(this.root, 'pending-attack', st.pending === 'attack');
        setClass(this.root, 'pending-move', st.pending === 'move');
        this.pausePill.hidden = !(st.paused && st.started && !ended);

        // 命令の途中の案内（または短い知らせ）
        let hint = '';
        if (st.pending === 'move') hint = `${sel?.name ?? ''}：移動先の地面を押してください`;
        else if (st.pending === 'attack') hint = `${sel?.name ?? ''}：攻撃する敵の部隊を押してください`;
        const now = performance.now();
        const flash = now < this.flashTimer ? this.flashText : '';
        const text = hint || flash;
        this.hintEl.hidden = !text;
        this.hintCancel.hidden = !hint;
        setText(this.hintText, text);
    }

    private fillCard(c: CardEls, m: CardModel, selected: boolean): void {
        const sig = `${m.strength}|${m.morale}|${m.orderText}|${m.engageText}|${m.badge}|${selected}|${m.commandable}`;
        if (sig === c.last) return;
        c.last = sig;
        const kindEl = c.root.querySelector('.b-kind') as HTMLElement;
        setText(kindEl, m.kind);
        setText(c.badge, m.badge);
        c.strBar.style.width = `${Math.round(m.strengthRatio * 100)}%`;
        setText(c.strText, `兵 ${m.strength}`);
        c.morBar.style.width = `${m.morale}%`;
        c.morBar.dataset.tone = m.moraleTone;
        setText(c.morText, `士気 ${m.morale}`);
        setText(c.ord, m.orderText);
        setText(c.eng, m.engageText === 'なし' ? '' : `⚔ ${m.engageText}`);
        setClass(c.root, 'sel', selected);
        setClass(c.root, 'engaged', m.engageText !== 'なし');
        setClass(c.root, 'gone', !m.commandable && m.badge !== '' && m.badge !== '到着待ち');
        setClass(c.root, 'waiting', m.badge === '到着待ち');
        c.root.setAttribute('aria-pressed', String(selected));
    }

    // ---------------------------------------------------------------- 名札

    /** 地図の上の名札（CSS px の位置。shown が false なら隠す） */
    label(id: string, text: string, side: Side | 'terrain', x: number, y: number, shown: boolean, extra = ''): void {
        let l = this.labelEls.get(id);
        if (!l) {
            const e = el('div', `b-label ${side}`);
            this.labels.append(e);
            l = { e, x: NaN, y: NaN, shown: true, text: '' };
            this.labelEls.set(id, l);
        }
        if (l.shown !== shown) {
            l.shown = shown;
            l.e.hidden = !shown;
        }
        if (!shown) return;
        if (l.text !== text + extra) {
            l.text = text + extra;
            l.e.innerHTML = extra ? `${escapeHtml(text)}<small>${escapeHtml(extra)}</small>` : escapeHtml(text);
        }
        if (!(Math.abs(l.x - x) <= 0.4 && Math.abs(l.y - y) <= 0.4)) {
            l.x = x;
            l.y = y;
            l.e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        }
    }

    /** 選んだ名札を目立たせる */
    markLabel(id: string, cls: string, on: boolean): void {
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
            '部隊（または下の札）を押して選ぶ → 地面を押すと移動、敵を押すと攻撃。選んだ部隊をもう一度押すと選択を外す（敵を調べられる）。',
            '「防衛・待機」「撤退」はボタン。1 本指で地図を動かす、2 本指で寄る・引く。',
            '「指揮（一時停止）」で時を止めて命令を出せる。',
        ];
        const pcLines = [
            'クリック（または下の札・1〜4 キー）で部隊を選ぶ → 地面をクリックで移動、敵をクリックで攻撃（右クリックでも命令）。',
            'ドラッグで地図を動かす、ホイールで寄る・引く。M 移動・A 攻撃・H 防衛・待機・R 撤退・Esc 取り消し。',
            'Space で指揮（一時停止）／再開。止めたまま命令を出せる。',
        ];
        for (const l of this.opts.touch ? touchLines : pcLines) how.append(el('p', '', l));
        box.append(how);
        const b = button('b-btn b-primary', ready ? '合戦を始める' : '準備中…', '合戦を始める');
        if (!ready) b.classList.add('off');
        press(b, () => this.h.start());
        this.startBtn = b;
        const row = el('div', 'b-modal-row');
        row.append(b);
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
        head.append(el('h2', '', m.title), el('span', 'b-tag', '仮シナリオ'));
        box.append(head, el('p', 'b-reason', m.reason));
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
