/**
 * 演出の再生器（層の種類 'cine'）。設計：docs/story-rpg-design.md §1・§3。中身の形は story/timeline.ts の純粋な関数で決める。
 *
 * - 時計は実時間（requestAnimationFrame の時刻の差。1 コマの上限 1 秒。場面の境目をまたぐコマは次の場面の頭で止め、場面が替わった
 *   次のコマは進めない（替わり目の重い描画の時間を数えない））。ページが隠れる・窓が外れる・pagehide で自動の一時停止。
 * - 地図の場面は不透明な層（探索の描画を止める）。3D の場面は字幕と操作だけの透明な層で、毎フレーム onStage(出来事, 場面の始めからの秒, 減らすか)。
 * - 地図の場面・始めから 3D の場面に入ったら、先に字幕と見出し（と前の地図）を不透明な層で 1 コマ見せてから、層を透明にして 3D の最初の画を
 *   見せる（最初の画は重く、押した直後に画面が何秒も変わらないことがあった）。出来事は場面に入ったときに置く（onStage）が、その間は探索を
 *   覆うので、探索の側（explore/world.ts）は最初の画を覆いが外れるまで描かない。待ちの間と、最初の画を描いた次のコマは時計を進めない。
 *   層の data-wait="1" が待ちの間（mode・data-mode は場面に入ったときから 'stage'。出来事も置かれている）。
 * - 声を待つ：次の声の字幕の時刻が来ても、その声がまだほどけていなければ（audio の cineVoiceReady）、時計をその字幕の境目の手前で止め
 *   （場面・字幕を先へ進めない）、ほどけるか CINE_VOICE_WAIT_SEC 秒（実時間）たつまで待つ。過ぎたら字幕を出して進める（声は今までどおり：
 *   遅れすぎた声は流さない）。始めの字幕・前後の場面へ動かした所の字幕なら、その字幕を出さずに待つ。端末の読み上げ（旧）・ミュート・
 *   声の音量 0・音を始めていないときは待たない。一時停止（自動の一時停止も）・前後の場面・スキップで待ちをやめる。層の data-voice-wait="1"。
 * - 終わり・スキップ・abandon（dispose）では必ず onStage(null, 0, …) を 1 回呼んで片付ける。
 * - ボタン：一時停止／再開・前の場面・次の場面・スキップ・動きを減らす。キー：Space／K 一時停止、←→ 場面、Esc スキップ。
 *   押し始めの守り（InputGate・CHOICE_GUARD_MS）：演出を始めたタップ・キーでは何も起きない。背景を押しても飛ばない。
 * - 確かめ用：層に data-cine（台本の id）・data-beat・data-state（playing／paused／done）・data-t・data-info・data-mode。
 */
import type { CinematicOptions } from '../campaign/game';
import type { CineCaption, CineSpec } from '../story/types';
import { CineClock, type CineFrame } from '../story/timeline';
import { el, nowMs, onPress } from './dom';
import { CHOICE_GUARD_MS, InputGate } from './guard';
import { createMap, type MapDom } from './mapDom';
import { dropLayer, startedAt, type LayerHost, type Modal } from './modal';
import { CINE_VOICE_WAIT_SEC, audio } from '../audio';

/** 声を待つときに時計を止める所：その字幕の始めのこの秒数だけ手前（字幕・場面の始めの判定の許し 1e-9 秒より大きく、目に見えない短さ） */
const VOICE_WAIT_EDGE_SEC = 0.001;

/** 台本の字幕の声の id（出る順） */
function voiceIdsOf(spec: CineSpec): string[] {
    return spec.captions.flatMap((c) => (c.voice ? [c.voice] : []));
}

/**
 * これから流す演出（待っている町の出来事）の字幕の声を、今のうちに読んでほどいておく（GameView.prepareCinematic。null でやめる）
 */
export function prepareCinematicVoices(spec: CineSpec | null): void {
    audio()?.prepareVoices(spec ? voiceIdsOf(spec) : []);
}

type CineButton = 'pause' | 'prev' | 'next' | 'skip' | 'reduce';

export interface CinePlayerHooks {
    /** 利用者が「動きを減らす」を切り替えた（設定に書く） */
    onReducedChange?(on: boolean): void;
    /** 再生中の様子（開発ビルドの __game.cine。閉じたら null） */
    onProbe?(m: Modal | null): void;
}

/** 演出を再生する（終わり 'done'・スキップ 'skipped'。abandon で閉じたときは答えを返さない） */
export function playCinematic(host: LayerHost, spec: CineSpec, opts: CinematicOptions, hooks: CinePlayerHooks = {}): Promise<'done' | 'skipped'> {
    return new Promise((resolve, reject) => {
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
        // 字幕の無い始め（町の急報は最初の台詞まで 1.55 秒）に、話す人の「：」だけが出ないように、空で始める
        who.hidden = true;
        cap.classList.add('empty');
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
        /**
         * 声を待っている字幕（その声がまだほどけていない。時計を止める）と、待ち始めたコマの時刻（ms。まだコマが来ていなければ -1）。
         * waived：待ちが時間切れになった字幕（もう待たない。字幕が替われば戻す）
         */
        let voiceWait: { cap: CineCaption; since: number } | null = null;
        let waived: CineCaption | null = null;
        let map: MapDom | null = null;
        let stageActive = false;
        let mode: 'map' | 'stage' = 'map';
        let frame: CineFrame = clock.frame(reduced);
        let capKey = '';
        /** 出している字幕（声を待つ間は、待っている字幕をまだ出していない） */
        let shownCap: CineCaption | null = null;
        let autoPaused = false;
        /** 場面が替わった：次のコマは時計を進めない（替わり目の重い描画の時間を、次の場面に数えない） */
        let holdTick = false;
        /** 3D の場面に入った：字幕と見出しを不透明な層で画面に出してから、層を透明にする（その間は探索を覆う＝3D の最初の画は描かれない） */
        let stageWait = false;
        /** 層を画面の層に積んだ（積む前は探索を覆っていないので、出来事を置くと最初の画がすぐ描かれる。積んでから置く） */
        let pushed = false;
        /** 待ちの字幕を出したコマが画面に出た（次のコマで 3D を始める） */
        let waitPainted = false;

        /** 字幕 c の声がまだ鳴らせない（ほどけていない）か。止めている・終わった・声の無い字幕・音が無い（audio() が無い）なら待たない */
        const voiceNotReady = (c: CineCaption): boolean => {
            if (done || clock.paused || clock.ended || (!c.voice && !c.speaker)) return false;
            const a = audio();
            return !!a && !a.cineVoiceReady(c);
        };
        /** 字幕 c を出す前に声を待つか（時間切れにした字幕は、もう待たない） */
        const mustWait = (c: CineCaption | null): c is CineCaption => !!c && c !== waived && voiceNotReady(c);
        /** 声の待ちをやめる（一時停止・前後の場面・スキップ）。時間切れにした覚えも消す */
        const dropVoiceWait = () => {
            voiceWait = null;
            waived = null;
        };
        /**
         * 時計を dt 秒進める。進めた間に始まる声の字幕のうち、声がまだほどけていない最初の物があれば、その字幕の始めの手前へ戻して待つ
         * （場面・字幕を先へ進めない。声の無い字幕・ほどけている字幕は待たない）
         */
        const advance = (dt: number, now: number) => {
            const from = clock.t;
            clock.tick(dt);
            const to = clock.t;
            if (!(to > from)) return;
            let next: CineCaption | null = null;
            for (const c of spec.captions) {
                if (c.start > from + 1e-9 && c.start <= to + 1e-9 && (!next || c.start < next.start)) {
                    if (c.voice || c.speaker) next = c;
                }
            }
            if (next && mustWait(next)) {
                clock.seek(Math.max(from, next.start - VOICE_WAIT_EDGE_SEC));
                voiceWait = { cap: next, since: now };
            }
        };

        const setPaused = (on: boolean, auto = false) => {
            if (done || clock.ended) return;
            dropVoiceWait();
            clock.setPaused(on);
            // 声：止めたら今の声を止める（再開しても読み直さない。たまった声を鳴らさない）
            audio()?.cinePaused(on);
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
                    dropVoiceWait();
                    clock.prev();
                    render();
                    break;
                case 'next':
                    // 最後の場面の「次の場面」（→ キー）はスキップと同じ：終わりの画を描かずに終える（描くと、探索の側は最後まで見たとして、
                    // 町の急報の人を止まる所へ飛ばしてから置き場所へ歩かせた。スキップは置き場所に置く）
                    dropVoiceWait();
                    if (!clock.beats[clock.beatIndex + 1]) {
                        clock.skip();
                        finish('skipped');
                        break;
                    }
                    clock.next();
                    render();
                    if (clock.ended) finish('done');
                    break;
                case 'skip':
                    dropVoiceWait();
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
            // 見出し・字幕を先に（場面が替わったときの地図の枠の大きさは、見出し・字幕の行が入った後の高さで測る）
            heading.textContent = f.heading;
            const ck = f.caption ? `${f.caption.speaker ?? ''}\u0000${f.caption.text}` : '';
            if (ck !== capKey && f.caption !== voiceWait?.cap && f.caption !== waived) waived = null;
            if (ck !== capKey && mustWait(f.caption)) {
                // 新しく出る声の字幕（始め・前後の場面へ動かした所）の声がまだほどけていない：字幕を出さずに待つ（時計は loop が止める）
                if (voiceWait?.cap !== f.caption) voiceWait = { cap: f.caption, since: -1 };
            } else if (ck !== capKey) {
                capKey = ck;
                shownCap = f.caption;
                who.textContent = f.caption?.speaker ?? '';
                who.hidden = !f.caption?.speaker;
                txt.textContent = f.caption?.text ?? '';
                cap.classList.toggle('empty', !f.caption);
                // 声：字幕が替わったら前の声を止め、表の台詞なら読む（字幕と同じ言葉。止めている間は読まない）
                if (!clock.paused) audio()?.caption(f.caption ?? null);
                else audio()?.stopVoice();
            }
            // 場面が変わった：地図を作り直す・覆いを切り替える
            if (f.beatIndex !== beatShown) {
                beatShown = f.beatIndex;
                holdTick = true;
                layer.dataset.beat = String(f.beatIndex);
                // 音：場面ごとの曲（町の様子・急報・出陣・帰還）と、木戸を通る出来事のきしみ
                const ev = f.beat.kind === 'stage' ? f.beat.event : null;
                audio()?.cineBeat({ moment: spec.moment, kind: f.beat.kind, ...(ev ? { event: ev.id } : {}), ...(ev?.id === 'column_return' ? { victory: ev.victory } : {}) });
                // 3D の場面の mode（data-mode・確かめの probe の mode）は、3D の出来事を始めた時に 'stage' にする（beginStage）。
                // mode が 'stage' なら、もう出来事が置かれている（world の stageProbe が出来事を返す）
                mode = f.beat.kind;
                layer.dataset.mode = mode;
                // 3D の場面の待ちは、前が地図・始めのときだけ（不透明なまま・前の地図を残して待つ）。前も 3D の場面なら、その画が出ているので待たない
                stageWait = f.beat.kind === 'stage' && !stageActive;
                waitPainted = false;
                layer.dataset.wait = stageWait ? '1' : '0';
                if (f.beat.kind === 'map' || !stageActive) {
                    layer.classList.remove('stage');
                    document.body.classList.remove('g-cine-stage');
                }
                if (f.beat.kind === 'map') {
                    // 3D の場面から地図の場面へ：出来事を片付ける（地図が覆う間に）
                    if (stageActive) {
                        stageActive = false;
                        safeStage(null, 0);
                    }
                    // 横に長い所（スマホ横・PC）では地図の枠を横に広げる（文字の大きさは同じ）。置く所の比いっぱいまで広げる
                    //（スマホ横 844×390 では約 3.3：1。640×270 のままでは左右が空き、地図が約 435×220 にしかならなかった）
                    mapBox.hidden = false;
                    mapBox.replaceChildren();
                    const aspect = mapBox.clientWidth / Math.max(1, mapBox.clientHeight);
                    const wide = aspect >= 2;
                    map = createMap(f.beat.scene, { name: `${spec.id}#${f.beatIndex}`, layout: wide ? 'wide' : 'standard', ...(wide ? { aspect } : {}) });
                    mapBox.append(map.svg);
                }
                host.refreshCover();
            }
            if (f.map && map) map.apply(f.map);
            if (f.stage && pushed) {
                stageActive = true;
                safeStage(f.stage.event, f.stage.local);
            }
            fill.style.width = `${(f.t / spec.duration) * 100}%`;
            const state = done || f.ended ? 'done' : clock.paused ? 'paused' : 'playing';
            layer.dataset.state = state;
            layer.dataset.t = f.t.toFixed(1);
            layer.dataset.info = f.info.join(',');
            layer.dataset.reduced = reduced ? '1' : '0';
            layer.dataset.voiceWait = voiceWait ? '1' : '0';
            btn.pause.textContent = clock.paused ? '再開' : '一時停止';
            btn.pause.classList.toggle('on', clock.paused);
            btn.pause.setAttribute('aria-pressed', clock.paused ? 'true' : 'false');
            btn.prev.disabled = f.t <= 0.001;
            btn.reduce.textContent = reduced ? '動きを減らす：入' : '動きを減らす';
            btn.reduce.classList.toggle('on', reduced);
            btn.reduce.setAttribute('aria-pressed', reduced ? 'true' : 'false');
        };

        /**
         * 待ちを終えて 3D の場面を見せる：地図を外し、層を透明にし、探索の覆いを外す。続く onStage で探索の側が出来事の最初の画を描く
         * （重い。この時間は時計に数えない）
         */
        const beginStage = () => {
            stageWait = false;
            layer.dataset.wait = '0';
            map = null;
            mapBox.replaceChildren();
            mapBox.hidden = true;
            layer.classList.add('stage');
            document.body.classList.add('g-cine-stage');
            host.refreshCover();
            holdTick = true;
            render();
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
            // 3D の場面の始めの待ち：字幕と見出しを出したコマが画面に出てから（次のコマで）3D を始める。待ちの間は時計を進めない
            if (stageWait) {
                last = now;
                if (waitPainted) {
                    try {
                        beginStage();
                    } catch (e) {
                        console.error(e);
                        clock.skip();
                        finish('skipped');
                        return;
                    }
                } else waitPainted = true;
                raf = requestAnimationFrame(loop);
                return;
            }
            // 声を待っている：ほどけたか、待ち始めてから CINE_VOICE_WAIT_SEC 秒たったらやめる（時間切れなら、その字幕はもう待たない）。
            // 待つ間は時計を進めない（待った時間を次の字幕・場面に数えない）
            let waiting = false;
            if (voiceWait) {
                if (voiceWait.since < 0) voiceWait.since = now;
                const ready = !voiceNotReady(voiceWait.cap);
                if (ready || now - voiceWait.since >= CINE_VOICE_WAIT_SEC * 1000) {
                    if (!ready) waived = voiceWait.cap;
                    voiceWait = null;
                } else waiting = true;
            }
            // 場面が替わった次のコマは進めない：替わり目の重い描画（3D の場面の最初の画・最後の画の仕上げ・地図の組み立て）は、
            // コマとコマの間（描画の仕上げ）にかかるので、その時間を次の場面に数えると、場面の頭とその字幕が出ないまま進む
            if (last >= 0) {
                if (holdTick) holdTick = false;
                else if (!waiting) advance((now - last) / 1000, now);
            }
            last = now;
            try {
                render();
            } catch (e) {
                // 場面を組み立てられない（地図の組み立てが投げた）：止まったままにせず、演出を終える（同じ情報は情勢の画面で見られる）
                console.error(e);
                clock.skip();
                finish('skipped');
                return;
            }
            if (clock.ended) {
                finish('done');
                return;
            }
            // このコマで 3D の場面に入った：このコマの後の画面に字幕が出るので、次のコマで 3D を始める
            if (stageWait) waitPainted = true;
            raf = requestAnimationFrame(loop);
        };

        // アプリの切り替え・窓が外れた・ページを離れる：自動で一時停止（戻っても勝手には進めない）
        const onVis = () => {
            if (document.visibilityState === 'hidden') setPaused(true, true);
            last = -1;
        };
        const onBlur = () => setPaused(true, true);
        const onHide = () => setPaused(true, true);

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
                caption: shownCap ? { ...(shownCap.speaker ? { speaker: shownCap.speaker } : {}), text: shownCap.text } : null,
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
            // 地図の場面と、3D の場面の始めの待ち（前が地図・始めのとき。層は不透明）は探索を覆う
            covers: () => mode === 'map' || (stageWait && !layer.classList.contains('stage')),
            dispose: () => {
                done = true;
                cancelAnimationFrame(raf);
                document.removeEventListener('visibilitychange', onVis);
                window.removeEventListener('blur', onBlur);
                window.removeEventListener('pagehide', onHide);
                document.body.classList.remove('g-cine-stage');
                // 声を止め、演出の曲の決めを外す（後の曲は画面で決まる）
                audio()?.cineEnd();
                // 終わり・スキップ・タイトルへ戻る（abandon）：必ず片付ける
                stageActive = false;
                safeStage(null, 0);
                hooks.onProbe?.(null);
            },
        };
        // 声：字幕の声（出る順）を先に読んでおく（新しい声のとき。字幕が出た時に読み込みを待たない）
        audio()?.prefetchVoices(voiceIdsOf(spec));
        try {
            render();
        } catch (e) {
            // 最初の場面を組み立てられない：開いた層・置いた出来事を残さない（画面をふさいだままにしない）。呼ぶ側は演出なしで進める
            done = true;
            document.body.classList.remove('g-cine-stage');
            safeStage(null, 0);
            audio()?.cineEnd();
            dropLayer(host, 'cine', layer);
            reject(e);
            return;
        }
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pagehide', onHide);
        host.pushModal(m);
        // 積んだ（3D の場面で始まるなら、ここで探索を覆った）：最初の場面の 3D の出来事を置く（最初の画は覆いが外れてから描かれる）
        pushed = true;
        if (frame.stage) {
            stageActive = true;
            safeStage(frame.stage.event, frame.stage.local);
        }
        hooks.onProbe?.(m);
        if (clock.ended) {
            finish('done');
            return;
        }
        raf = requestAnimationFrame(loop);
    });
}
