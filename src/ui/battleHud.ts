/**
 * 模擬戦の画面の文字・ボタン（DOM）。表示するだけで、戦闘の状態は持たない。
 * - 上部：味方の体力と命令、残りの訓練相手、「指揮」ボタン
 * - 指揮中：家臣の札（選択）、命令のボタン、案内、「再開」「撤退」
 * - 終わったら：結果のカード（城へ戻る）
 */
import { OUTCOME_LABELS, ORDER_LABELS, RETAINER_IDS, STATS, type BattleResult, type OrderKind, type RetainerId, type Unit } from '../core/battle/model';
import type { BattleSession } from '../core/battle/session';
import { onPress } from './press';

export interface BattleHudHandlers {
    onCommand(): void;
    onResume(): void;
    onRetreat(): void;
    onSelectRetainer(id: RetainerId): void;
    onOrder(kind: OrderKind): void;
    onReturn(): void;
}

export interface BattleHudView {
    session: BattleSession;
    commanding: boolean;
    selected: RetainerId | null;
    pick: 'move' | 'attack' | null;
    /** 指揮中の案内（直前の操作の結果など） */
    hint: string;
}

/** 家臣ごとの色（描画側の RETAINER_COLORS と同じ） */
const RETAINER_CSS: Record<RetainerId, string> = { genzo: '#e9c274', shinpachi: '#7fd3dc' };

function $(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} が index.html にありません`);
    return el;
}

/** 命令を短い文にする（札・上部の表示用） */
export function orderText(u: Unit, session: BattleSession): string {
    if (u.down) return '戦闘不能';
    const o = u.order;
    if (!o) return '';
    if (o.kind === 'attack') {
        const t = session.unit(o.targetId);
        return `攻撃：${t ? shortName(t.name) : '相手'}`;
    }
    if (o.kind === 'move') return '移動中';
    return ORDER_LABELS[o.kind];
}

/** 「訓練相手・二」→「二」 */
function shortName(name: string): string {
    const i = name.indexOf('・');
    return i >= 0 ? `相手${name.slice(i + 1)}` : name;
}

export class BattleHud {
    private readonly hud = $('battle-hud');
    private readonly party = $('battle-party');
    private readonly foes = $('battle-foes');
    private readonly panel = $('command-panel');
    private readonly actions = $('command-actions');
    private readonly retainers = $('cmd-retainers');
    private readonly orders = $('cmd-orders');
    private readonly hint = $('cmd-hint');
    private readonly retreatBtn = $('cmd-retreat') as HTMLButtonElement;
    private readonly result = $('battle-result');
    private confirmRetreat = false;
    private retreatTimer = 0;
    private lastKey = '';

    constructor(h: BattleHudHandlers) {
        // 模擬戦のボタンは押した瞬間に反応させる（スティックを押さえたまま別の指で押せるように）
        const click = (el: HTMLElement, fn: () => void) => onPress(el, () => fn());
        click($('command-btn'), () => h.onCommand());
        click($('cmd-resume'), () => h.onResume());
        click(this.retreatBtn, () => {
            if (!this.confirmRetreat) {
                this.confirmRetreat = true;
                this.retreatBtn.textContent = 'もう一度押すと撤退';
                this.retreatBtn.classList.add('confirm');
                window.clearTimeout(this.retreatTimer);
                this.retreatTimer = window.setTimeout(() => this.resetRetreat(), 3500);
                return;
            }
            this.resetRetreat();
            h.onRetreat();
        });
        for (const b of this.orders.querySelectorAll<HTMLButtonElement>('button[data-order]')) {
            click(b, () => h.onOrder(b.dataset.order as OrderKind));
        }
        for (const id of RETAINER_IDS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cmd-ret';
            b.dataset.id = id;
            b.setAttribute('role', 'radio');
            b.style.setProperty('--c', RETAINER_CSS[id]);
            b.innerHTML = `<span class="ret-name"></span><span class="ret-order"></span><span class="hp"><i></i></span>`;
            click(b, () => h.onSelectRetainer(id));
            this.retainers.appendChild(b);
        }
        click($('btn-return'), () => h.onReturn());
    }

    private resetRetreat(): void {
        this.confirmRetreat = false;
        window.clearTimeout(this.retreatTimer);
        this.retreatBtn.textContent = '撤退';
        this.retreatBtn.classList.remove('confirm');
    }

    /** 模擬戦の表示を出す／隠す */
    show(on: boolean): void {
        this.hud.hidden = !on;
        if (!on) {
            this.panel.hidden = true;
            this.actions.hidden = true;
            this.result.hidden = true;
            this.lastKey = '';
        }
    }

    setCommanding(on: boolean): void {
        this.panel.hidden = !on;
        this.actions.hidden = !on;
        this.resetRetreat();
    }

    render(v: BattleHudView): void {
        const s = v.session;
        // 変わったときだけ書き換える（毎フレーム DOM を触らない）
        const key = JSON.stringify([
            s.state.units.map((u) => [u.hp, u.down, u.order]),
            v.commanding, v.selected, v.pick, v.hint,
        ]);
        if (key === this.lastKey) return;
        this.lastKey = key;

        // 上部：味方
        const allies = s.state.units.filter((u) => u.side === 'ally');
        this.party.innerHTML = allies
            .map((u) => {
                const pct = Math.round((u.hp / STATS[u.kind].maxHp) * 100);
                const color = u.kind === 'retainer' ? RETAINER_CSS[u.id as RetainerId] : '#f3dc9c';
                const sub = u.kind === 'hero' ? (u.down ? '戦闘不能' : `${u.hp}`) : orderText(u, s);
                return `<div class="chip${u.down ? ' down' : ''}" style="--c:${color}"><span class="chip-name">${u.name}</span><span class="chip-sub">${sub}</span><span class="hp"><i style="width:${pct}%"></i></span></div>`;
            })
            .join('');
        const left = s.activeEnemies().length;
        this.foes.innerHTML = `<span class="foe-label">訓練相手</span><b>${left}</b><span class="foe-total">/ ${s.enemies().length}</span>`;

        if (!v.commanding) return;
        // 指揮：家臣の札
        for (const b of this.retainers.querySelectorAll<HTMLButtonElement>('.cmd-ret')) {
            const u = s.unit(b.dataset.id!)!;
            b.querySelector('.ret-name')!.textContent = u.name;
            b.querySelector('.ret-order')!.textContent = orderText(u, s);
            (b.querySelector('.hp i') as HTMLElement).style.width = `${Math.round((u.hp / STATS.retainer.maxHp) * 100)}%`;
            const sel = v.selected === u.id;
            b.classList.toggle('selected', sel);
            b.classList.toggle('down', u.down);
            b.setAttribute('aria-checked', String(sel));
        }
        const r = v.selected ? s.unit(v.selected) : undefined;
        const current = r?.order?.kind ?? null;
        for (const b of this.orders.querySelectorAll<HTMLButtonElement>('button[data-order]')) {
            const k = b.dataset.order as OrderKind;
            b.disabled = !r || r.down;
            // 地図で選ぶ待ちの命令、または今の命令を目立たせる
            b.classList.toggle('armed', v.pick === k);
            b.classList.toggle('current', v.pick === null && current === k);
        }
        this.hint.textContent = v.hint;
    }

    showResult(r: BattleResult, s: BattleSession): void {
        $('result-title').textContent = OUTCOME_LABELS[r.outcome];
        this.result.dataset.outcome = r.outcome;
        $('result-lead').textContent =
            r.outcome === 'victory' ? '訓練相手を全員打ち負かした。' : r.outcome === 'defeat' ? '若殿が打ち倒された。' : '模擬戦を切り上げた。';
        const hero = s.hero;
        const rows: [string, string][] = [
            ['倒した訓練相手', `${r.defeated} / ${s.enemies().length}`],
            ['若殿', hero.down ? '戦闘不能' : `無事（体力 ${hero.hp}）`],
            ...RETAINER_IDS.map((id): [string, string] => {
                const u = s.unit(id)!;
                return [u.name, r.retainersDown[id] ? '戦闘不能' : `無事（体力 ${u.hp}）`];
            }),
            ['かかった時間', `${r.seconds} 秒`],
        ];
        $('result-list').innerHTML = rows.map(([k, val]) => `<div><dt>${k}</dt><dd class="${val === '戦闘不能' ? 'down' : ''}">${val}</dd></div>`).join('');
        this.panel.hidden = true;
        this.actions.hidden = true;
        this.result.hidden = false;
    }

    hideResult(): void {
        this.result.hidden = true;
    }
}
