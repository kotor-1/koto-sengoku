/**
 * 合戦場の演習の画面（DOM）：戦場の一覧・合戦の前の説明・結果（campaign/practice.ts の PracticeView を満たす）。
 * 画面の板・ボタンの見張りは DomView（ui/view.ts の sheet・confirm）を使う。状態は持たない（見せて、押されたものを返すだけ）。
 *
 * タイトルの「合戦場の演習」から ui/boot.ts が読み込む（別の塊。選んだときだけ読む）。
 * DOM の印（e2e 用）：層に data-sheet（practice-list／practice-briefing／practice-result）、戦場の札に data-field、
 * ボタンに data-id（'field:<戦場id>'／'back'／'go'／'list'）。目標の行に data-objective（primary／secondary）と data-achieved。
 */
import {
    PracticeMode,
    PracticeRecordStore,
    type PracticeBriefingInfo,
    type PracticeListAction,
    type PracticeListInfo,
    type PracticeResultInfo,
    type PracticeRunner,
    type PracticeView,
} from '../campaign/practice';
import type { StorageLike } from '../campaign/save';
import { el } from './dom';
import type { DomView } from './view';

/** 札（小さな枠の文字） */
function tag(text: string): HTMLElement {
    return el('span', 'g-tag', text);
}

/** 見出しの並び（題・札） */
function head(kicker: string, title: string, note: string): HTMLElement {
    const h = el('header', 'g-pr-head');
    const p = el('p', 'prov');
    p.append(tag(note));
    h.append(el('p', 'kicker', kicker), el('h1', undefined, title), p);
    return h;
}

/** 見出し付きの区切り */
function section(title: string, cls = ''): HTMLElement {
    const s = el('section', `g-pr-sec ${cls}`.trim());
    s.append(el('h2', undefined, title));
    return s;
}

export class PracticeDomView implements PracticeView {
    constructor(private readonly view: DomView) {}

    practiceList(info: PracticeListInfo): Promise<PracticeListAction> {
        const body = el('div', 'g-pr g-pr-list');
        body.append(head('戦国探索記 3D', '合戦場の演習', info.note));
        body.append(el('p', 'g-pr-lead', 'ゲーム用の演習です。相手は架空の「敵勢」で、史実の合戦の再現ではありません。戦場を選ぶと、地形・目標・編成の説明の後に出陣します。'));
        if (info.problem) body.append(el('p', 'problem', info.problem));
        const list = el('div', 'g-pr-fields');
        const buttons: { id: string; label: string; sub?: string; parent?: HTMLElement }[] = [];
        for (const f of info.fields) {
            const card = el('section', 'g-pr-field');
            card.dataset.field = f.id;
            card.append(el('h2', undefined, f.name), el('p', 'sum', f.summary));
            const dl = el('dl', 'g-status');
            dl.append(el('dt', undefined, '主目標'), el('dd', undefined, f.primary));
            if (f.secondary.length) dl.append(el('dt', undefined, '副目標'), el('dd', undefined, f.secondary.join('／')));
            dl.append(el('dt', undefined, '最後'), el('dd', f.last ? 'rec' : 'rec none', f.last ?? 'まだ遊んでいません'));
            if (f.best) dl.append(el('dt', undefined, '最高'), el('dd', 'rec best', `${f.best}（${f.plays} 回）`));
            card.append(dl);
            const bx = el('div', 'g-pr-field-btn');
            card.append(bx);
            list.append(card);
            buttons.push({ id: `field:${f.id}`, label: `${f.name}へ`, parent: bx });
        }
        body.append(list);
        buttons.push({ id: 'back', label: 'タイトルへ戻る' });
        return this.view.sheet({ name: 'practice-list', body, buttons, defaultIndex: 0, cancelId: 'back' }) as Promise<PracticeListAction>;
    }

    practiceBriefing(info: PracticeBriefingInfo): Promise<'go' | 'back'> {
        const body = el('div', 'g-pr g-pr-brief');
        body.dataset.field = info.id;
        body.append(head('合戦の前の説明', info.name, info.note));
        body.append(el('p', 'g-pr-lead', info.summary));
        const cols = el('div', 'g-pr-cols');
        const left = el('div', 'col');
        const right = el('div', 'col');
        // 目標（主目標・副目標を別々の行に）
        const obj = section('目標', 'obj');
        const dl = el('dl', 'g-status');
        const pd = el('dd', undefined, info.primary);
        pd.dataset.objective = 'primary';
        dl.append(el('dt', undefined, '主目標'), pd);
        for (const s of info.secondary) {
            const sd = el('dd', undefined, s);
            sd.dataset.objective = 'secondary';
            dl.append(el('dt', undefined, '副目標'), sd);
        }
        dl.append(el('dt', undefined, '日没'), el('dd', undefined, `${info.timeLimit} で両軍が兵を引く（撤退）`));
        obj.append(dl);
        left.append(obj);
        // 地形・状況
        const ter = section('地形・状況', 'terrain');
        for (const t of info.terrain) ter.append(el('p', undefined, t));
        left.append(ter);
        // 特殊ルール
        const rules = section('戦場の決まり', 'rules');
        if (info.rules.length) {
            const ul = el('ul');
            for (const r of info.rules) ul.append(el('li', undefined, r));
            rules.append(ul);
        } else rules.append(el('p', undefined, '特別な決まりはありません（ふつうの野戦）。'));
        left.append(rules);
        // 編成
        const units = section('味方の編成', 'units');
        const table = el('table', 'g-pr-units');
        const thead = el('tr');
        for (const h of ['部隊', '種類', '兵', '率いる武将', '固有能力']) thead.append(el('th', undefined, h));
        table.append(thead);
        for (const u of info.allies) {
            const tr = el('tr');
            tr.dataset.unit = u.id;
            const name = el('td', 'name', u.name);
            if (u.arriveAt !== null) name.append(el('small', undefined, `援軍・${Math.round(u.arriveAt)} 秒で着く`));
            const ab = el('td', 'ab');
            if (u.ability) {
                ab.append(document.createTextNode(u.ability.name));
                if (u.ability.provisional) ab.append(tag('仮'));
            } else ab.textContent = '—';
            tr.append(name, el('td', undefined, u.kind), el('td', 'num', String(u.strength)), el('td', undefined, u.general ?? '—'), ab);
            table.append(tr);
        }
        units.append(table, el('p', 'g-note', `相手：${info.enemies}。能力はゲーム用の創作で、「仮」は数値・効果を差し替える予定の能力です。`));
        right.append(units);
        cols.append(left, right);
        body.append(cols);
        return this.view.sheet({
            name: 'practice-briefing',
            body,
            buttons: [
                { id: 'go', label: '出陣' },
                { id: 'back', label: '一覧へ戻る' },
            ],
            defaultIndex: 0,
            cancelId: 'back',
        }) as Promise<'go' | 'back'>;
    }

    practiceLoadFailed(message: string): Promise<'retry' | 'back'> {
        return this.view.confirm({
            title: '合戦を始められませんでした',
            lines: [message, '演習の記録には何も書いていません。'],
            buttons: [
                { id: 'retry', label: 'もう一度' },
                { id: 'back', label: '一覧へ戻る' },
            ],
            defaultIndex: 0,
            cancelId: 'back',
        }) as Promise<'retry' | 'back'>;
    }

    practiceLoading(on: boolean): void {
        this.view.loading(on ? '合戦の画面を読み込んでいます…' : null);
    }

    async practiceResult(info: PracticeResultInfo): Promise<void> {
        const body = el('div', 'g-pr g-pr-result');
        body.dataset.field = info.fieldId;
        body.dataset.result = info.result;
        body.append(head('演習の結果', info.name, info.note));
        const dl = el('dl', 'g-status g-pr-outcome');
        const res = el('dd', `res ${info.result}`, info.resultLabel);
        res.dataset.outcome = info.result;
        dl.append(el('dt', undefined, '勝敗'), res);
        if (info.reasonText) dl.append(el('dt', undefined, '終わり方'), el('dd', undefined, info.reasonText));
        const mark = (ok: boolean) => (ok ? '達成' : '未達成');
        const pd = el('dd', info.primary.achieved ? 'ok' : 'ng', `${mark(info.primary.achieved)}：${info.primary.label}`);
        pd.dataset.objective = 'primary';
        pd.dataset.achieved = String(info.primary.achieved);
        dl.append(el('dt', undefined, '主目標'), pd);
        for (const s of info.secondary) {
            const sd = el('dd', s.achieved ? 'ok' : 'ng', `${mark(s.achieved)}：${s.label}`);
            sd.dataset.objective = 'secondary';
            sd.dataset.achieved = String(s.achieved);
            dl.append(el('dt', undefined, '副目標'), sd);
        }
        dl.append(el('dt', undefined, 'かかった時間'), el('dd', undefined, info.elapsed));
        if (info.best) dl.append(el('dt', undefined, '最高の記録'), el('dd', undefined, `${info.best}${info.isBest ? '（更新）' : ''}`));
        body.append(dl);
        const msg = el('div', `g-msg${info.saved.ok ? '' : ' ng'}`, info.saved.text);
        msg.dataset.saved = String(info.saved.ok);
        body.append(msg);
        await this.view.sheet({ name: 'practice-result', body, buttons: [{ id: 'list', label: '一覧へ' }], defaultIndex: 0, cancelId: 'list' });
    }
}

/** 演習を 1 回（一覧の「戻る」まで）。boot.ts がタイトルの入口から呼ぶ */
export function createPractice(view: DomView, storage: StorageLike | null, battleRunner: () => Promise<PracticeRunner | null>): { mode: PracticeMode; store: PracticeRecordStore } {
    const store = new PracticeRecordStore(storage);
    const mode = new PracticeMode({ view: new PracticeDomView(view), store, battleRunner });
    return { mode, store };
}
