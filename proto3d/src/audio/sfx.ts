/**
 * 環境音と効果音（必要最小限）。どれも効果音／環境音のバス（engine.sfx）へ出す。
 *
 * - 足音：主人公の歩き・走りの位相（main.ts の stride。進んだ距離から決まる）の半周ごと（片足ずつ）に 1 つ。止まっている間は鳴らさない。
 * - 環境音：風（全体に薄く。探索・演出・合戦）、荷の作業の音（荷置き場の近くで。近いほど大きい）、木戸のきしみ（木戸を通る演出の頭）。
 * - 合戦：刃の当たり・矢・太鼓・法螺。兵全員の分を鳴らさず、斬り合い・射撃をしている部隊の数から出す割合を決め、
 *   同時に鳴る数（発音数）と 1 秒あたりの数を VoiceLimiter で制限する。倍速では 1 秒あたりの数を減らす（間引く）。
 */
import type { AudioEngine } from './engine';
import { arrow, cargo, clash, creak, footstep, horagai, rng, taiko, windLoop } from './instruments';

/** 同時に鳴る数と 1 秒あたりの数の制限（純粋。時刻は渡す） */
export class VoiceLimiter {
    private ends: number[] = [];
    private starts: number[] = [];
    /** 確かめ用：断った数 */
    refused = 0;
    constructor(
        readonly maxVoices: number,
        readonly perSecond: number,
    ) {}
    /** 鳴らしてよいか（よければ数える）。rateScale で 1 秒あたりの数を減らす（倍速） */
    tryStart(now: number, dur: number, rateScale = 1): boolean {
        this.ends = this.ends.filter((e) => e > now);
        this.starts = this.starts.filter((s) => s > now - 1);
        if (this.ends.length >= this.maxVoices || this.starts.length >= Math.max(1, Math.floor(this.perSecond * rateScale))) {
            this.refused++;
            return false;
        }
        this.ends.push(now + dur);
        this.starts.push(now);
        return true;
    }
    /** 今鳴っている数 */
    active(now: number): number {
        return this.ends.filter((e) => e > now).length;
    }
    /** 直近 1 秒に始めた数 */
    lastSecond(now: number): number {
        return this.starts.filter((s) => s > now - 1).length;
    }
}

/** 足音の拍：歩き・走りの位相の半周ごとに 1 歩（純粋） */
export class FootstepTracker {
    private last: number | null = null;
    /** 位相のどこで足が着くか（0〜0.5。歩き・走りの素材は 0 と 0.5 の近くで着く） */
    constructor(readonly phase = 0.02) {}
    /** strideTotal：これまでに進めた周期の合計。speed：今の速さ（m/秒）。返りは鳴らす歩（無ければ null） */
    update(strideTotal: number, speed: number, run: boolean): 'walk' | 'run' | null {
        const k = Math.floor((strideTotal - this.phase) * 2);
        const prev = this.last;
        this.last = k;
        // 止まっている（ほぼ動かない）間は鳴らさない。歩き出しの最初の数え合わせでも鳴らさない
        if (speed < 0.3 || prev === null) return null;
        return k > prev ? (run ? 'run' : 'walk') : null;
    }
    reset(): void {
        this.last = null;
    }
}

/** 荷置き場（荷車と俵のあたり。town/plan.ts の cart_w・bales_w の近く） */
export const CARGO_SPOT = { x: -7.8, z: 10.6 } as const;
/** 荷の作業の音が聞こえる距離（m） */
export const CARGO_RANGE = 16;

export interface SfxOptions {
    random?: () => number;
}

export class Sfx {
    private readonly r: () => number;
    private wind: ReturnType<typeof windLoop> | null = null;
    private windLevel = 0;
    private town = false;
    private listener = { x: 0, z: 0 };
    private nextCargo = 0;
    /** 合戦の音の制限：刃・矢（同時に 4・1 秒に 6）、出来事（太鼓・法螺。同時に 2・1 秒に 3） */
    readonly melee = new VoiceLimiter(4, 6);
    readonly cues = new VoiceLimiter(2, 3);
    private clashAcc = 0;
    private arrowAcc = 0;
    /** 確かめ用：鳴らした数 */
    readonly stats = { footsteps: 0, cargo: 0, creaks: 0, clashes: 0, arrows: 0, cues: 0 };

    constructor(
        private readonly engine: AudioEngine,
        opts: SfxOptions = {},
    ) {
        this.r = opts.random ?? rng(97);
        engine.onReady(() => this.applyWind());
    }

    private get out(): AudioNode | null {
        return this.engine.live ? this.engine.sfx : null;
    }

    // ---------------- 足音

    step(kind: 'walk' | 'run'): void {
        const out = this.out;
        if (!out) return;
        footstep(this.engine.ctx!, out, this.engine.now() + 0.005, kind === 'run', this.r());
        this.stats.footsteps++;
    }

    // ---------------- 環境音

    /** 風の強さ（0 で止める）と、町の環境音（荷の作業）を出すか */
    setAmbience(wind: number, town: boolean): void {
        this.town = town;
        if (wind === this.windLevel) return;
        this.windLevel = wind;
        this.applyWind();
    }
    private applyWind(): void {
        const ctx = this.engine.ctx;
        const out = this.engine.sfx;
        if (!ctx || !out) return;
        const t = ctx.currentTime;
        if (this.windLevel > 0 && !this.wind) {
            try {
                this.wind = windLoop(ctx, out, t);
            } catch (e) {
                console.error(e);
                return;
            }
        }
        if (this.wind) {
            const g = this.wind.gain.gain;
            g.cancelScheduledValues(t);
            g.setTargetAtTime(this.windLevel, t, 0.4);
        }
    }

    /** 聞く位置（探索のカメラ・主人公のあたり） */
    setListener(x: number, z: number): void {
        this.listener.x = x;
        this.listener.z = z;
    }

    /** 荷の作業の音の大きさ（0〜1。荷置き場からの距離） */
    cargoLevel(): number {
        const d = Math.hypot(this.listener.x - CARGO_SPOT.x, this.listener.z - CARGO_SPOT.z);
        return Math.max(0, 1 - d / CARGO_RANGE);
    }

    /** 環境音の時計（tick ごと。荷の作業の音を時々） */
    tickAmbience(): void {
        const out = this.out;
        if (!out || !this.town) return;
        const now = this.engine.now();
        if (now < this.nextCargo) return;
        const lv = this.cargoLevel();
        this.nextCargo = now + 0.7 + this.r() * 1.8;
        if (lv < 0.05) return;
        const kind = this.r() < 0.72 ? 'knock' : 'thud';
        const pan = Math.max(-0.8, Math.min(0.8, (CARGO_SPOT.x - this.listener.x) / 12));
        cargo(this.engine.ctx!, out, now + 0.02, kind, 0.32 * lv, this.r(), pan);
        // 木を打つ音は 2〜3 回続けて
        if (kind === 'knock' && this.r() < 0.5) cargo(this.engine.ctx!, out, now + 0.22 + this.r() * 0.06, 'knock', 0.26 * lv, this.r(), pan);
        this.stats.cargo++;
    }

    /** 木戸のきしみ（delay 秒後） */
    creak(delay = 0): void {
        const out = this.out;
        if (!out) return;
        creak(this.engine.ctx!, out, this.engine.now() + 0.02 + delay, 1.1, 0.28);
        this.stats.creaks++;
    }

    // ---------------- 合戦

    /**
     * 合戦の毎フレーム：斬り合っている部隊の数・射っている部隊の数から、刃と矢の音を出す割合を決める（実時間 dt 秒）。
     * 倍速（speed 2）では 1 秒あたりの数を減らす。止まっている（指揮・結果）間は出さない。
     */
    battleTick(dt: number, engaged: number, shooting: number, speed: number, running: boolean): void {
        if (!running || !(dt > 0)) {
            this.clashAcc = 0;
            this.arrowAcc = 0;
            return;
        }
        const out = this.out;
        if (!out) return;
        const now = this.engine.now();
        const thin = speed > 1 ? 0.6 : 1;
        // 1 秒あたりの見込み（部隊の数に比べて少なく。上限あり）
        this.clashAcc += Math.min(5, engaged * 0.8) * thin * Math.min(dt, 0.25);
        this.arrowAcc += Math.min(3, shooting * 0.6) * thin * Math.min(dt, 0.25);
        while (this.clashAcc >= 1) {
            this.clashAcc -= 1;
            if (!this.melee.tryStart(now, 0.3, thin)) continue;
            clash(this.engine.ctx!, out, now + this.r() * 0.08, 0.22 + this.r() * 0.12, this.r(), this.r() * 1.2 - 0.6);
            this.stats.clashes++;
        }
        while (this.arrowAcc >= 1) {
            this.arrowAcc -= 1;
            if (!this.melee.tryStart(now, 0.35, thin)) continue;
            arrow(this.engine.ctx!, out, now + this.r() * 0.1, 0.2 + this.r() * 0.1, this.r(), this.r() * 1.2 - 0.6);
            this.stats.arrows++;
        }
    }

    /** 合戦の出来事の音（始まり・ぶつかり・敗走・能力・終わり）。制限を超えたら鳴らさない */
    battleCue(kind: 'start' | 'engage' | 'rout' | 'ability' | 'end', speed = 1): void {
        const out = this.out;
        if (!out) return;
        const ctx = this.engine.ctx!;
        const now = this.engine.now();
        const thin = speed > 1 ? 0.6 : 1;
        const dur = kind === 'start' || kind === 'end' ? 2.2 : 0.8;
        if (!this.cues.tryStart(now, dur, thin)) return;
        this.stats.cues++;
        switch (kind) {
            case 'start':
                horagai(ctx, out, now + 0.05, 2.0, 0.35, 55);
                taiko(ctx, out, now + 0.1, 0.7, 1);
                break;
            case 'engage':
                taiko(ctx, out, now + 0.02, 0.55, 1);
                if (this.melee.tryStart(now, 0.3, thin)) clash(ctx, out, now + 0.06, 0.3, this.r(), 0);
                break;
            case 'rout':
                taiko(ctx, out, now + 0.02, 0.5, 1);
                taiko(ctx, out, now + 0.32, 0.4, 1);
                break;
            case 'ability':
                taiko(ctx, out, now + 0.02, 0.45, 0, 0);
                taiko(ctx, out, now + 0.14, 0.55, 0, 0);
                taiko(ctx, out, now + 0.3, 0.6, 1);
                break;
            case 'end':
                horagai(ctx, out, now + 0.05, 2.4, 0.32, 53);
                break;
        }
    }
}
