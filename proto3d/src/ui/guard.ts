/**
 * 出たばかりの選択肢・ボタンを、直前の入力で決めてしまわないための見張り（純粋な TypeScript。DOM を使わない。テスト：tests/proto3d-ui-guard.test.ts）。
 *
 * 決まり：
 * - 出てからしばらく（guardMs）は、押しても決まらない（選んだ印も動かさない）。
 * - 出た後に「始まった」入力だけを受け付ける：
 *   - 指・マウス：押し始め（pointerdown）の時刻が、出た時刻より後。
 *   - キー：出た時に押さえていたキーは、一度離して押し直すまで受け付けない。キーの自動の繰り返し（repeat）は受け付けない。
 * - 上に重なった画面（メニューなど）が閉じて、また一番上に戻ったときも、出たばかりと同じに扱う（reset）。
 */

/** 出たばかりの選択肢・ボタンを押しても決まらない時間（ミリ秒） */
export const CHOICE_GUARD_MS = 350;
/** 会話を続けて進めるときの最短の間（ミリ秒。二度押しで 2 行進まないように） */
export const ADVANCE_GUARD_MS = 140;

/** 押さえているキー（押すたびに通し番号を振る。離すと消える） */
export class HeldKeys {
    private readonly held = new Map<string, number>();
    private serial = 0;

    /** keydown。自動の繰り返し、または離さないまま来た keydown は、同じ押し方のまま（番号を変えない） */
    down(code: string, repeat: boolean): void {
        if (repeat || this.held.has(code)) return;
        this.held.set(code, ++this.serial);
    }
    up(code: string): void {
        this.held.delete(code);
    }
    /** 画面を離れた（blur）ときなど：押さえているものは無いことにする */
    clear(): void {
        this.held.clear();
    }
    /** 今押さえているキーの押し方の番号（押さえていなければ undefined） */
    pressOf(code: string): number | undefined {
        return this.held.get(code);
    }
    snapshot(): Map<string, number> {
        return new Map(this.held);
    }
}

export class InputGate {
    private openedAt = 0;
    private blocked = new Map<string, number>();

    constructor(
        private readonly keys: HeldKeys,
        now: number,
        private guardMs: number = CHOICE_GUARD_MS,
    ) {
        this.reset(now);
    }

    /** 出た（一番上に戻った）時刻と、その時に押さえていたキーを覚え直す */
    reset(now: number, guardMs: number = this.guardMs): void {
        this.openedAt = now;
        this.guardMs = guardMs;
        this.blocked = this.keys.snapshot();
    }

    /** 見張りの時間の中か */
    guarding(now: number): boolean {
        return now - this.openedAt < this.guardMs;
    }

    /** 指・マウスで押した（startedAt：押し始めの時刻＝pointerdown の timeStamp）を受け付けるか */
    pointer(now: number, startedAt: number): boolean {
        if (this.guarding(now)) return false;
        return startedAt >= this.openedAt;
    }

    /** キーを受け付けるか（出た時に押さえていたキーは、押し直すまで受け付けない） */
    key(code: string, repeat: boolean, now: number): boolean {
        if (repeat) return false;
        const was = this.blocked.get(code);
        if (was !== undefined && this.keys.pressOf(code) === was) return false;
        return !this.guarding(now);
    }
}
