/**
 * 演出の再生器（層の種類 'cine'）。設計：docs/story-rpg-design.md §1・§3。中身の形は story/timeline.ts の純粋な関数で決める。
 *
 * - 時計は実時間（requestAnimationFrame の時刻の差。1 コマの上限 1 秒）。ページが隠れる・窓が外れる・pagehide で自動の一時停止。
 * - 地図の場面は不透明な層（探索の描画を止める）。3D の場面は字幕と操作だけの透明な層で、毎フレーム onStage(出来事, 場面の始めからの秒, 減らすか)。
 * - 終わり・スキップ・abandon（dispose）では必ず onStage(null, 0, …) を 1 回呼んで片付ける。
 * - ボタン：一時停止／再開・前の場面・次の場面・スキップ・動きを減らす。キー：Space／K 一時停止、←→ 場面、Esc スキップ。
 *   押し始めの守り（InputGate・CHOICE_GUARD_MS）：演出を始めたタップ・キーでは何も起きない。背景を押しても飛ばない。
 * - 確かめ用：層に data-cine（台本の id）・data-beat・data-state（playing／paused／done）・data-t・data-info・data-mode。
 */
import type { CinematicOptions } from '../campaign/game';
import type { CineSpec } from '../story/types';
import { CineClock, type CineFrame } from '../story/timeline';
import { el, nowMs, onPress } from './dom';
import { CHOICE_GUARD_MS, InputGate } from './guard';
import { createMap, type MapDom } from './mapDom';
import { startedAt, type LayerHost, type Modal } from './modal';

type CineButton = 'pause' | 'prev' | 'next' | 'skip' | 'reduce';

export interface CinePlayerHooks {
    /** 利用者が「動きを減らす」を切り替えた（設定に書く） */
    onReducedChange?(on: boolean): void;
    /** 再生中の様子（開発ビルドの __game.cine。閉じたら null） */
    onProbe?(m: Modal | null): void;
}

/** 演出を再生する（終わり 'done'・スキップ 'skipped'。abandon で閉じたときは答えを返さない） */
export function playCinematic(host: LayerHost, spec: CineSpec, opts: CinematicOptions, hooks: CinePlayerHooks = {}): Promise<'done' | 'skipped'> {
    return new Promise((resolve) => {
        const clock = new CineClock(spec);
        let reduced = !!opts.reduced;
        const layer = host.openLayer('cine', 'g-cine');
        layer.dataset.cine = spec.id;
        layer.dataset.moment = spec.moment;
        layer.setAttribute('role', 'region');
        layer.setAttribute('aria-label', `演出：${spec.title}`);

        // 上：見出し（いつ・どこ）と操作
        const top = el('div', 'g-cine-top');
        const head = el('div', 'g-cine-head');
        const heading = el('h2', 'g-cine-heading');
        const sub = el('p', 'g-cine-title', spec.title);
        head.append(heading, sub);
        const ctrl = el('div', 'g-cine-ctrl');
        top.append(head, ctrl);
        // 真ん中：地図（地図の場面だけ）
        const mapBox = el('div', 'g-cine-map');
        // 下：進み具合と字幕（不透明な帯）
        const bottom = el('div', 'g-cine-bottom');
        const bar = el('div', 'g-cine-bar');
        const fill = el('div', 'fill');
        bar.append(fill);
        const cap = el('div', 'g-cine-cap');
        cap.setAttribute('aria-live', 'polite');
        const who = el('b', 'who');
        const txt = el('span', 'txt');
        cap.append(who, txt);
        const hint = el('p', 'g-cine-hint');
        hint.hidden = true;
        bottom.append(bar, cap, hint);
        layer.append(top, mapBox, bottom);
        // 場面の区切りの印（進み具合の帯の上）
        for (const b of clock.beats) {
            if (b.start <= 0) continue;
            const tick = el('i', 'tick');
            tick.style.left = `${(b.start / spec.duration) * 100}%`;
            bar.append(tick);
        }

        const gate = new InputGate(host.keys, nowMs(), CHOICE_GUARD_MS);
        const btn: Record<CineButton, HTMLButtonElement> = {
            pause: el('button', 'g-cine-btn', '一時停止'),
            prev: el('button', 'g-cine-btn', '◀ 前の場面'),
            next: el('button', 'g-cine-btn', '次の場面 ▶'),
            skip: el('button', 'g-cine-btn skip', 'スキップ'),
            reduce: el('button', 'g-cine-btn reduce', '動きを減らす'),
        };
        const labels = (): { id: string; label: string; disabled: boolean }[] =>
            (Object.keys(btn) as CineButton[]).map((id) => ({ id, label: btn[id].textContent ?? '', disabled: btn[id].disabled }));
        for (const id of Object.keys(btn) as CineButton[]) {
            const b = btn[id];
            b.type = 'button';
            b.dataset.id = id;
            onPress(b, (e) => {
                if (gate.pointer(nowMs(), startedAt(e, nowMs()))) act(id);
            });
            ctrl.append(b);
        }

        let done = false;
        let raf = 0;
        let last = -1;
        let beatShown = -1;
        let map: MapDom | null = null;
        let stageActive = false;
        let mode: 'map' | 'stage' = 'map';
        let frame: CineFrame = clock.frame(reduced);
        let capKey = '';
        let autoPaused = false;

        const setPaused = (on: boolean, auto = false) => {
            if (done || clock.ended) return;
            clock.setPaused(on);
            autoPaused = on && auto;
            hint.hidden = !autoPaused;
            hint.textContent = autoPaused ? '画面を離れたので一時停止しました。「再開」で続きから。' : '';
            render();
        };

        const act = (id: CineButton | 'resume') => {
            if (done) return;
            switch (id) {
                case 'pause':
                    setPaused(!clock.paused);
                    break;
                case 'resume':
                    setPaused(false);
                    break;
                case 'prev':
                    clock.prev();
                    render();
                    break;
                case 'next':
                    clock.next();
                    render();
                    if (clock.ended) finish('done');
                    break;
                case 'skip':
                    clock.skip();
                    finish('skipped');
                    break;
                case 'reduce':
                    reduced = !reduced;
                    hooks.onReducedChange?.(reduced);
                    render();
                    break;
            }
        };

        const render = () => {
            frame = clock.frame(reduced);
            const f = frame;
            // 場面が変わった：地図を作り直す・覆いを切り替える
            if (f.beatIndex !== beatShown) {
                beatShown = f.beatIndex;
                mode = f.beat.kind;
                layer.dataset.beat = String(f.beatIndex);
                layer.dataset.mode = mode;
                layer.classList.toggle('stage', mode === 'stage');
                document.body.classList.toggle('g-cine-stage', mode === 'stage');
                if (f.beat.kind === 'map') {
                    // 3D の場面から地図の場面へ：出来事を片付ける（地図が覆う間に）
                    if (stageActive) {
                        stageActive = false;
                        safeStage(null, 0);
                    }
                    map = createMap(f.beat.scene, { name: `${spec.id}#${f.beatIndex}` });
                    mapBox.replaceChildren(map.svg);
                    mapBox.hidden = false;
                } else {
                    map = null;
                    mapBox.replaceChildren();
                    mapBox.hidden = true;
                }
                host.refreshCover();
            }
            if (f.map && map) map.apply(f.map);
            if (f.stage) {
                stageActive = true;
                safeStage(f.stage.event, f.stage.local);
            }
            heading.textContent = f.heading;
            const ck = f.caption ? `${f.caption.speaker ?? ''}\u0000${f.caption.text}` : '';
            if (ck !== capKey) {
                capKey = ck;
                who.textContent = f.caption?.speaker ?? '';
                who.hidden = !f.caption?.speaker;
                txt.textContent = f.caption?.text ?? '';
                cap.classList.toggle('empty', !f.caption);
            }
            fill.style.width = `${(f.t / spec.duration) * 100}%`;
            const state = done || f.ended ? 'done' : clock.paused ? 'paused' : 'playing';
            layer.dataset.state = state;
            layer.dataset.t = f.t.toFixed(1);
            layer.dataset.info = f.info.join(',');
            layer.dataset.reduced = reduced ? '1' : '0';
            btn.pause.textContent = clock.paused ? '再開' : '一時停止';
            btn.pause.classList.toggle('on', clock.paused);
            btn.pause.setAttribute('aria-pressed', clock.paused ? 'true' : 'false');
            btn.prev.disabled = f.t <= 0.001;
            btn.reduce.textContent = reduced ? '動きを減らす：入' : '動きを減らす';
            btn.reduce.classList.toggle('on', reduced);
            btn.reduce.setAttribute('aria-pressed', reduced ? 'true' : 'false');
        };

        const safeStage = (ev: Parameters<CinematicOptions['onStage']>[0], t: number) => {
            try {
                opts.onStage(ev, t, reduced);
            } catch (e) {
                // 3D の出来事が置けなくても、演出（字幕・地図）は進める
                console.error(e);
            }
        };

        const loop = (ts: number) => {
            if (done) return;
            const now = Number.isFinite(ts) ? ts : nowMs();
            if (last >= 0) clock.tick((now - last) / 1000);
            last = now;
            render();
            if (clock.ended) {
                finish('done');
                return;
            }
            raf = requestAnimationFrame(loop);
        };

        // アプリの切り替え・窓が外れた・ページを離れる：自動で一時停止（戻っても勝手には進めない）
        const onVis = () => {
            if (document.visibilityState === 'hidden') setPaused(true, true);
            last = -1;
        };
        const onBlur = () => setPaused(true, true);
        const onHide = () => setPaused(true, true);
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pagehide', onHide);

        const finish = (result: 'done' | 'skipped') => {
            if (done) return;
            done = true;
            layer.dataset.state = 'done';
            host.closeModal(m);
            resolve(result);
        };

        const m: Modal = {
            kind: 'cine',
            layer,
            key: (e) => {
                const code = e.code;
                let id: CineButton | null = null;
                if (code === 'Space' || code === 'KeyK') id = 'pause';
                else if (code === 'ArrowLeft') id = 'prev';
                else if (code === 'ArrowRight') id = 'next';
                else if (code === 'Escape') id = 'skip';
                if (!id) return;
                e.preventDefault();
                // 出る前から押さえていたキー・出たばかり・自動の繰り返しでは何もしない
                if (gate.key(code, e.repeat, nowMs())) act(id);
            },
            probe: () => ({
                kind: 'cine',
                id: spec.id,
                beat: frame.beatIndex,
                count: frame.beatCount,
                t: Math.round(frame.t * 1000) / 1000,
                paused: clock.paused,
                caption: frame.caption ? { ...(frame.caption.speaker ? { speaker: frame.caption.speaker } : {}), text: frame.caption.text } : null,
                state: done || frame.ended ? 'done' : clock.paused ? 'paused' : 'playing',
                info: [...frame.info],
                mode,
                reduced,
                buttons: labels(),
            }),
            // 確かめ用：次の場面
            advance: () => act('next'),
            press: (id) => {
                if (id !== 'resume' && !(id in btn)) return false;
                act(id as CineButton | 'resume');
                return true;
            },
            reexpose: () => gate.reset(nowMs()),
            covers: () => mode === 'map',
            dispose: () => {
                done = true;
                cancelAnimationFrame(raf);
                document.removeEventListener('visibilitychange', onVis);
                window.removeEventListener('blur', onBlur);
                window.removeEventListener('pagehide', onHide);
                document.body.classList.remove('g-cine-stage');
                // 終わり・スキップ・タイトルへ戻る（abandon）：必ず片付ける
                stageActive = false;
                safeStage(null, 0);
                hooks.onProbe?.(null);
            },
        };
        render();
        host.pushModal(m);
        hooks.onProbe?.(m);
        if (clock.ended) {
            finish('done');
            return;
        }
        raf = requestAnimationFrame(loop);
    });
}
