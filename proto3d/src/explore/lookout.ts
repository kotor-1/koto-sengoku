/**
 * 物見の眺め（物見櫓の上から見回して、印の方角を調べる）。設計：docs/story-rpg-design.md §5.2。
 * - カメラを櫓の上の高さへ上げる（動きを減らすときはすぐ）→ 引きずり（見回しの面）・←→／A・D で見回す
 *   → point.marks の方角に印（DOM の札。#npc-labels と同じ作り）→ 向きが印に近い（±12°）とき「調べる」が押せる → 押した印を記録
 *   → 「終える」（Esc）で戻る。返りは調べた印の id の並び（調べずに終えれば []）。
 * - 主人公は動かさない（櫓の下に立ったまま。保存の位置は変わらない）。終わればカメラと操作を必ず戻す。
 * 向き（heading）は印と同じ決まり：0 が北、時計回り（東が π/2）。
 */
import type { ScoutPoint } from '../story/types';
import { CHOICE_GUARD_MS, HeldKeys, InputGate } from '../ui/guard';
import { LOOKOUT_EYE } from '../town/plan';
import type { StageShot } from './stage';

/** 調べられる向きのずれ（ラジアン。±12°） */
export const LOOKOUT_TOLERANCE = (12 * Math.PI) / 180;
/** ←→／A・D の見回しの速さ（ラジアン／秒） */
export const LOOKOUT_KEY_SPEED = (55 * Math.PI) / 180;
/** 引きずりの見回しの速さ（ラジアン／画面の 1px。肩越しのカメラと同じ） */
export const LOOKOUT_DRAG = 0.0055;
/** カメラを上げる時間（秒） */
export const LOOKOUT_RISE_SEC = 1.4;
/** 上下の見回しの範囲（下向きが +） */
const PITCH_MIN = -0.25;
const PITCH_MAX = 0.45;

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 向き h（0 が北・時計回り）の地面の向き（x 東・z 南） */
export function headingVector(h: number): { x: number; z: number } {
    return { x: Math.sin(h), z: -Math.cos(h) };
}

/** 一番近い印と、そのずれ（印が無ければ null） */
export function nearestMark(marks: ScoutPoint['marks'], heading: number): { id: string; diff: number } | null {
    let best: { id: string; diff: number } | null = null;
    for (const m of marks) {
        const d = wrapAngle(m.heading - heading);
        if (!best || Math.abs(d) < Math.abs(best.diff)) best = { id: m.id, diff: d };
    }
    return best;
}

/** 今「調べる」を押せる印（向きが ±12° の中。無ければ null） */
export function examinable(marks: ScoutPoint['marks'], heading: number): string | null {
    const n = nearestMark(marks, heading);
    return n && Math.abs(n.diff) <= LOOKOUT_TOLERANCE + 1e-9 ? n.id : null;
}

/** 櫓の上のカメラ（目の位置から、向き heading・下向き pitch を見る） */
export function lookoutShot(heading: number, pitch: number): StageShot {
    const v = headingVector(heading);
    const cp = Math.cos(pitch);
    const d = 20;
    return { px: LOOKOUT_EYE.x, py: LOOKOUT_EYE.y, pz: LOOKOUT_EYE.z, tx: LOOKOUT_EYE.x + v.x * cp * d, ty: LOOKOUT_EYE.y - Math.sin(pitch) * d, tz: LOOKOUT_EYE.z + v.z * cp * d };
}

/** 始めの向き：最初の印から少し（40°）ずらす（印の札が画面の端に見え、見回せば合わせられる）。印が無ければ南 */
export function startHeading(point: ScoutPoint): number {
    const m = point.marks[0];
    return m ? wrapAngle(m.heading + (40 * Math.PI) / 180) : Math.PI;
}

/** 物見の眺めが使う探索の口（ExploreHost の一部） */
export interface LookoutHost {
    overlay: HTMLElement;
    camera: { position: { x: number; y: number; z: number } };
    setCameraShot(shot: (StageShot & { hideHero?: boolean }) | null): void;
    setLookHandler(fn: ((dx: number, dy: number) => void) | null): void;
    /** 見える点を画面の座標へ（画面の外・後ろなら null） */
    project(x: number, y: number, z: number): { x: number; y: number } | null;
    now(): number;
}

/** 確かめ用（__game.world.lookoutProbe()） */
export interface LookoutProbe {
    active: boolean;
    heading: number;
    pitch: number;
    /** 印ごとの向きのずれ（ラジアン）・調べたか・画面に札が出ているか */
    marks: { id: string; label: string; heading: number; diff: number; done: boolean; shown: boolean }[];
    /** 今押せる印（無ければ null） */
    can: string | null;
    examined: string[];
    rising: boolean;
}

/**
 * 物見の眺めの 1 回分。start で始め、終えると Promise が調べた印の id の並びで決まる。
 * frame は探索の毎フレーム（描く前）に呼ぶ。cancel は外から終わらせる（タイトルへ戻るなど。調べた分は返さない）。
 */
export class LookoutSession {
    heading: number;
    pitch = 0.06;
    readonly examined: string[] = [];
    private readonly layer: HTMLElement;
    private readonly marksBox: HTMLElement;
    private readonly labels = new Map<string, HTMLElement>();
    private readonly examineBtn: HTMLButtonElement;
    private readonly doneBtn: HTMLButtonElement;
    private readonly hint: HTMLElement;
    private readonly gate: InputGate;
    private readonly held = new Set<string>();
    private readonly startedAt: number;
    private readonly from: StageShot;
    private resolve!: (ids: string[]) => void;
    readonly done: Promise<string[]>;
    private finished = false;
    private lastNow: number;
    private can: string | null = null;

    constructor(
        private readonly host: LookoutHost,
        private readonly point: ScoutPoint,
        private readonly reduced: boolean,
        keys: HeldKeys,
    ) {
        this.done = new Promise((r) => (this.resolve = r));
        this.heading = startHeading(point);
        this.startedAt = host.now();
        this.lastNow = this.startedAt;
        this.gate = new InputGate(keys, this.startedAt, CHOICE_GUARD_MS);
        const c = host.camera.position;
        const s0 = lookoutShot(this.heading, this.pitch);
        this.from = { px: c.x, py: c.y, pz: c.z, tx: s0.tx, ty: s0.ty, tz: s0.tz };
        // ---- 画面の部品（小さな層。#npc-labels と同じ作りの札・下の操作の帯）
        this.marksBox = el('div', 'lookout-marks');
        this.marksBox.id = 'lookout-marks';
        for (const m of point.marks) {
            const l = el('div', 'npc-label lookout-mark', m.label);
            l.dataset.id = m.id;
            l.hidden = true;
            this.marksBox.appendChild(l);
            this.labels.set(m.id, l);
        }
        this.layer = el('div', 'g-lookout-bar');
        this.layer.dataset.kind = 'lookout';
        this.hint = el('p', 'g-lookout-hint', '引きずる・←→ で見回す。印の方を向いて「調べる」');
        const row = el('div', 'g-lookout-row');
        this.examineBtn = el('button', 'g-lookout-btn examine', '調べる') as HTMLButtonElement;
        this.examineBtn.type = 'button';
        this.examineBtn.dataset.id = 'examine';
        this.doneBtn = el('button', 'g-lookout-btn done', '終える') as HTMLButtonElement;
        this.doneBtn.type = 'button';
        this.doneBtn.dataset.id = 'done';
        row.append(this.examineBtn, this.doneBtn);
        this.layer.append(this.hint, row);
        // 押し始め（出たばかり・出る前からの押し）では決めない。指・マウスは押し始めの時刻、キーボード（Enter）はその時刻で見る
        const wire = (btn: HTMLElement, act: () => void) => {
            let downAt = -Infinity;
            btn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                downAt = e.timeStamp;
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const started = e.detail === 0 ? e.timeStamp : downAt;
                if (this.gate.pointer(this.host.now(), started)) act();
            });
        };
        wire(this.examineBtn, () => this.examine());
        wire(this.doneBtn, () => this.finish());
        this.layer.addEventListener('pointerdown', (e) => e.stopPropagation());
        host.overlay.append(this.marksBox, this.layer);
        document.body.classList.add('g-lookout');
        window.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('keyup', this.onKeyUp, true);
        window.addEventListener('blur', this.onBlur);
        host.setLookHandler((dx, dy) => {
            if (this.finished) return;
            this.heading = wrapAngle(this.heading + dx * LOOKOUT_DRAG);
            this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dy * LOOKOUT_DRAG));
            this.apply();
        });
        this.apply();
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        if (this.finished) return;
        const code = e.code;
        const turn = code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD';
        const act = code === 'Enter' || code === 'Space' || code === 'KeyE' || code === 'Escape';
        if (!turn && !act && code !== 'KeyW' && code !== 'KeyS' && code !== 'ArrowUp' && code !== 'ArrowDown') return;
        // 探索・画面の他のキー（メニュー・情勢・会話）へ渡さない
        e.preventDefault();
        e.stopPropagation();
        if (turn) {
            // 出る前から押さえていたキーは、押し直すまで効かない
            if (this.gate.key(code, false, this.host.now()) || this.held.has(code)) this.held.add(code);
            return;
        }
        if (!act || !this.gate.key(code, e.repeat, this.host.now())) return;
        if (code === 'Escape') this.finish();
        else this.examine();
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.held.delete(e.code);
    };

    private onBlur = (): void => {
        this.held.clear();
    };

    /** 毎フレーム（実際の経過時間で回す。1 コマの上限 0.25 秒） */
    frame(): void {
        if (this.finished) return;
        const now = this.host.now();
        const dt = Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000));
        this.lastNow = now;
        let turn = 0;
        if (this.held.has('ArrowLeft') || this.held.has('KeyA')) turn -= 1;
        if (this.held.has('ArrowRight') || this.held.has('KeyD')) turn += 1;
        if (turn) this.heading = wrapAngle(this.heading + turn * LOOKOUT_KEY_SPEED * dt);
        this.apply();
    }

    /** カメラ・札・ボタンを今の向きに合わせる */
    private apply(): void {
        const target = lookoutShot(this.heading, this.pitch);
        const k = this.reduced ? 1 : Math.min(1, (this.host.now() - this.startedAt) / 1000 / LOOKOUT_RISE_SEC);
        const e = k * k * (3 - 2 * k);
        const lerp = (a: number, b: number) => a + (b - a) * e;
        this.host.setCameraShot({
            px: lerp(this.from.px, target.px),
            py: lerp(this.from.py, target.py),
            pz: lerp(this.from.pz, target.pz),
            tx: target.tx,
            ty: target.ty,
            tz: target.tz,
            hideHero: true,
        });
        this.can = k >= 1 ? examinable(this.point.marks, this.heading) : null;
        this.examineBtn.disabled = !this.can;
        this.examineBtn.classList.toggle('ready', !!this.can);
        this.layer.dataset.heading = this.heading.toFixed(3);
        this.layer.dataset.can = this.can ?? '';
        this.layer.dataset.examined = this.examined.join(',');
        // 印の札：その方角の遠く（目の高さより少し下）
        for (const m of this.point.marks) {
            const l = this.labels.get(m.id)!;
            const v = headingVector(m.heading);
            const p = k >= 1 ? this.host.project(LOOKOUT_EYE.x + v.x * 60, LOOKOUT_EYE.y - 3, LOOKOUT_EYE.z + v.z * 60) : null;
            if (!p) {
                l.hidden = true;
                continue;
            }
            l.hidden = false;
            l.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
            l.classList.toggle('key', this.can === m.id);
            l.classList.toggle('done', this.examined.includes(m.id));
        }
    }

    /** 今向いている印を調べる（同じ印は 1 回だけ記録） */
    examine(): void {
        if (this.finished || !this.can) return;
        const id = this.can;
        if (!this.examined.includes(id)) this.examined.push(id);
        const label = this.point.marks.find((m) => m.id === id)?.label ?? id;
        this.hint.textContent = `調べた：${label}（${this.examined.length}／${this.point.marks.length}）。「終える」で戻る`;
        this.apply();
    }

    /** 終える（調べた印の id の並びを返す） */
    finish(): void {
        this.end([...this.examined]);
    }

    /** 外から終わらせる（調べた分は返さない） */
    cancel(): void {
        this.end([]);
    }

    private end(ids: string[]): void {
        if (this.finished) return;
        this.finished = true;
        window.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('keyup', this.onKeyUp, true);
        window.removeEventListener('blur', this.onBlur);
        this.host.setLookHandler(null);
        this.host.setCameraShot(null);
        this.layer.remove();
        this.marksBox.remove();
        document.body.classList.remove('g-lookout');
        this.resolve(ids);
    }

    get active(): boolean {
        return !this.finished;
    }

    probe(): LookoutProbe {
        const now = this.host.now();
        return {
            active: !this.finished,
            heading: this.heading,
            pitch: this.pitch,
            marks: this.point.marks.map((m) => ({ id: m.id, label: m.label, heading: m.heading, diff: wrapAngle(m.heading - this.heading), done: this.examined.includes(m.id), shown: !this.labels.get(m.id)!.hidden })),
            can: this.can,
            examined: [...this.examined],
            rising: !this.reduced && (now - this.startedAt) / 1000 < LOOKOUT_RISE_SEC,
        };
    }

    /** 確かめ用：向きを直接決める（開発のみ） */
    devFace(heading: number): void {
        this.heading = wrapAngle(heading);
        this.apply();
    }
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}
