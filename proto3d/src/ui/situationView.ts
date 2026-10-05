/**
 * 情勢の画面（層の種類 'situation'。板と同じ作りで探索を覆う）。設計：docs/story-rpg-design.md §4。
 *
 * 中身は SituationView（物語の側が状態から作る）：地図（模式図）・いつ・今いる所・協力・敵対・前の章・今の危機・今回の目的・物見の記録・演出の見直し。
 * 軍議から開いたとき（options がある）は、選択肢ごとのタブ（押すと強調と説明が変わるだけ。閉じない・選ばない）。
 * 返り：閉じた（undefined）・「見直す」（{ replay }）。選択肢の id は返さない。
 */
import type { CineMoment, MapScene, SituationView } from '../story/types';
import { el, nowMs, onPress } from './dom';
import { CHOICE_GUARD_MS, InputGate } from './guard';
import { createMap } from './mapDom';
import { startedAt, type LayerHost, type Modal } from './modal';

export interface SituationOpenOptions {
    /** 最初に選ぶタブ（軍議でいま選ばれている選択肢の id） */
    option?: string;
    /** 開いた所 */
    from?: 'explore' | 'council';
}

/** 情勢の画面を開く */
export function openSituation(host: LayerHost, v: SituationView, o: SituationOpenOptions = {}): Promise<{ replay?: CineMoment } | void> {
    return new Promise((resolve) => {
        const layer = host.openLayer('situation', 'g-sheet-layer g-sit');
        layer.dataset.sheet = 'situation';
        const from = o.from ?? (v.options && v.options.length > 0 ? 'council' : 'explore');
        layer.dataset.from = from;
        const scroll = el('div', 'g-sheet g-scroll');
        const inner = el('div', 'g-sheet-inner g-sit-inner');
        // 見出し
        const head = el('header', 'g-sit-head');
        head.append(el('p', 'kicker', from === 'council' ? '情勢（軍議で確かめる・まだ決めない）' : '情勢'), el('h1', undefined, v.title));
        inner.append(head);

        const cols = el('div', 'g-sit-cols');
        // 左：地図（物見の記録の場所・線も足す）とタブ
        const left = el('section', 'g-sit-left');
        const scene = withScouted(v.map, v);
        const scoutedIds = v.scouted.flatMap((s) => [...(s.places ?? []).map((p) => p.id), ...(s.routes ?? []).map((r) => r.id)]);
        const map = createMap(scene, { name: 'situation', scouted: scoutedIds });
        const mapBox = el('div', 'g-sit-map');
        if (scene.heading) mapBox.append(el('p', 'g-sit-map-head', scene.heading));
        mapBox.append(map.svg);
        left.append(mapBox);
        const options = v.options ?? [];
        const tabs = el('div', 'g-sit-tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', '軍議の選択肢（見るだけ。選ぶのは軍議で）');
        const optText = el('p', 'g-sit-opt-text');
        optText.setAttribute('aria-live', 'polite');
        const tabBtns: HTMLButtonElement[] = [];
        let current: string | null = null;
        const tabGate = new InputGate(host.keys, nowMs(), CHOICE_GUARD_MS);
        const selectTab = (id: string | null) => {
            const opt = options.find((x) => x.id === id) ?? null;
            current = opt?.id ?? null;
            for (const b of tabBtns) {
                const on = b.dataset.option === current;
                b.classList.toggle('sel', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            }
            map.highlight(opt ? opt.highlight : (scene.highlight ?? []));
            optText.textContent = opt ? opt.text : '';
            optText.hidden = !opt;
            if (current) layer.dataset.option = current;
            else delete layer.dataset.option;
        };
        if (options.length > 0) {
            options.forEach((op, k) => {
                const b = el('button', 'g-sit-tab');
                b.type = 'button';
                b.dataset.option = op.id;
                b.setAttribute('role', 'tab');
                b.append(el('span', 'n', String(k + 1)), document.createTextNode(op.label));
                onPress(b, (e) => {
                    if (tabGate.pointer(nowMs(), startedAt(e, nowMs()))) selectTab(op.id);
                });
                tabBtns.push(b);
                tabs.append(b);
            });
            const note = el('p', 'g-sit-tabs-note', 'タブは地図で見るだけです。方針・判断は軍議の選択肢で決めます。');
            left.append(tabs, optText, note);
        }
        cols.append(left);

        // 右：短い説明
        const right = el('section', 'g-sit-right');
        const dl = el('dl', 'g-status g-sit-facts');
        const row = (label: string, value: string, key: string) => {
            const dt = el('dt', undefined, label);
            const dd = el('dd', undefined, value);
            dd.dataset.fact = key;
            dl.append(dt, dd);
        };
        row('いつ', v.when, 'when');
        row('今いる所', v.where, 'where');
        row('協力', v.allies.length ? v.allies.join('・') : 'なし', 'allies');
        row('敵対', v.enemies.length ? v.enemies.join('・') : 'なし', 'enemies');
        if (v.prev) row('前の章', v.prev, 'prev');
        row('今の危機', v.crisis, 'crisis');
        row('今回の目的', v.objective, 'objective');
        right.append(dl);
        const scoutSec = el('div', 'g-sit-scout');
        scoutSec.append(el('h2', undefined, '物見の記録'));
        if (v.scouted.length > 0) {
            const ul = el('ul');
            for (const s of v.scouted) {
                const li = el('li');
                li.dataset.scout = s.id;
                li.append(el('b', undefined, `◇ ${s.label}`), document.createTextNode(`：${s.text}`));
                ul.append(li);
            }
            scoutSec.append(ul);
        } else {
            scoutSec.append(el('p', 'g-note', v.scoutHint ?? 'まだ物見をしていません（任意）。'));
        }
        right.append(scoutSec);
        const replayBox = el('div', 'g-sit-replays');
        if (v.replays.length > 0) {
            replayBox.append(el('h2', undefined, '演出を見直す'));
            right.append(replayBox);
        }
        cols.append(right);
        inner.append(cols);
        const btns = el('div', 'g-sheet-btns');
        inner.append(btns);
        scroll.append(inner);
        layer.append(scroll);

        const items = [
            ...v.replays.map((r) => ({ id: `replay:${r.moment}`, label: `見直す：${r.title}`, parent: replayBox })),
            { id: 'close', label: '閉じる', parent: btns },
        ];
        const m: Modal = {
            kind: 'situation',
            layer,
            key: (e) => {
                if ((e.code === 'Escape' || e.code === 'KeyJ') && !e.repeat) {
                    e.preventDefault();
                    row2.press('close');
                    return;
                }
                if (/^Digit[1-9]$/.test(e.code) && options.length > 0) {
                    const k = Number(e.code.slice(5)) - 1;
                    e.preventDefault();
                    if (k < options.length && tabGate.key(e.code, e.repeat, nowMs())) selectTab(options[k]!.id);
                    return;
                }
                row2.key(e);
            },
            probe: () => ({
                kind: 'situation',
                sheet: 'situation',
                from,
                id: v.title,
                buttons: row2.buttons,
                text: inner.textContent ?? '',
                option: current,
                options: options.map((x) => x.id),
                highlight: (map.svg.dataset.hl ?? '').split(',').filter(Boolean),
            }),
            press: (id) => {
                if (id.startsWith('tab:')) {
                    const t = id.slice(4);
                    if (!options.some((x) => x.id === t)) return false;
                    selectTab(t);
                    return true;
                }
                return row2.press(id);
            },
            reexpose: () => {
                row2.reexpose();
                tabGate.reset(nowMs());
            },
        };
        const row2 = host.buttonRowFor(btns, items, items.length - 1, (id) => {
            host.closeModal(m);
            if (id.startsWith('replay:')) resolve({ replay: id.slice(7) as CineMoment });
            else resolve();
        });
        // 最初のタブ：軍議でいま選ばれている選択肢（無ければ最初の選択肢）
        selectTab(options.length > 0 ? (options.some((x) => x.id === o.option) ? o.option! : options[0]!.id) : null);
        host.pushModal(m);
    });
}

/** 地図に物見の記録の場所・線を足す（同じ id は足さない） */
function withScouted(scene: MapScene, v: SituationView): MapScene {
    const places = [...scene.places];
    const routes = [...scene.routes];
    for (const s of v.scouted) {
        for (const p of s.places ?? []) if (!places.some((x) => x.id === p.id)) places.push(p);
        for (const r of s.routes ?? []) if (!routes.some((x) => x.id === r.id)) routes.push(r);
    }
    return { ...scene, places, routes };
}
