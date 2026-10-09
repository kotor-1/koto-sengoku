/**
 * 出たばかりの選択肢・ボタンの見張り（proto3d/src/ui/guard.ts）：
 * 会話を進めた入力（タップ・クリック・Enter／Space／E、キーの自動の繰り返し、スマホの素早い二度押し）で、直後に出た選択肢が決まらないこと。
 */
import { describe, expect, it } from 'vitest';
import { ADVANCE_GUARD_MS, CHOICE_GUARD_MS, HeldKeys, InputGate, TAP_SLOP_PX, TapTracker } from '../proto3d/src/ui/guard';

describe('選択肢の見張り（時間）', () => {
    it('出てから CHOICE_GUARD_MS の間は、出た後に押し始めたタップでも決まらない', () => {
        const keys = new HeldKeys();
        const g = new InputGate(keys, 1000);
        expect(CHOICE_GUARD_MS).toBeGreaterThanOrEqual(300);
        // 素早い二度押し（2 回目のタップは出た 120 ms 後）
        expect(g.pointer(1120, 1120)).toBe(false);
        expect(g.pointer(1000 + CHOICE_GUARD_MS - 1, 1000 + CHOICE_GUARD_MS - 1)).toBe(false);
        expect(g.pointer(1000 + CHOICE_GUARD_MS, 1000 + CHOICE_GUARD_MS)).toBe(true);
    });
    it('出る前に押し始めた指・マウスでは、時間がたっても決まらない（押し始めが出た後であること）', () => {
        const g = new InputGate(new HeldKeys(), 1000);
        // 会話を進めた pointerdown（出る前の 998 ms に押し始めた）が、後から選択肢に届いても決まらない
        expect(g.pointer(2000, 998)).toBe(false);
        expect(g.pointer(2000, 1500)).toBe(true);
    });
    it('会話を進める見張りは短い（二度押しで 2 行進まない）', () => {
        const g = new InputGate(new HeldKeys(), 0, ADVANCE_GUARD_MS);
        expect(g.pointer(ADVANCE_GUARD_MS - 1, ADVANCE_GUARD_MS - 1)).toBe(false);
        expect(g.pointer(ADVANCE_GUARD_MS, ADVANCE_GUARD_MS)).toBe(true);
    });
});

describe('キー：出た時に押さえていたキーは、離して押し直すまで決めない', () => {
    it('Enter で会話を進めた → そのまま出た選択肢は、押さえたままの Enter（自動の繰り返し）では決まらない', () => {
        const keys = new HeldKeys();
        keys.down('Enter', false); // 会話を進めた Enter
        const g = new InputGate(keys, 1000);
        // 自動の繰り返し（repeat 付き）
        keys.down('Enter', true);
        expect(g.key('Enter', true, 1600)).toBe(false);
        // repeat が付かないブラウザでも、離していなければ同じ押し方のまま
        keys.down('Enter', false);
        expect(g.key('Enter', false, 1700)).toBe(false);
        // 離して押し直すと決まる
        keys.up('Enter');
        keys.down('Enter', false);
        expect(g.key('Enter', false, 1800)).toBe(true);
    });
    it('Space・E も同じ。出た後に初めて押したキーは、見張りの時間を過ぎていれば決まる', () => {
        const keys = new HeldKeys();
        keys.down('Space', false);
        keys.down('KeyE', false);
        const g = new InputGate(keys, 0);
        expect(g.key('Space', false, 1000)).toBe(false);
        expect(g.key('KeyE', false, 1000)).toBe(false);
        keys.down('Digit1', false);
        expect(g.key('Digit1', false, 100)).toBe(false); // 出たばかり
        expect(g.key('Digit1', false, CHOICE_GUARD_MS)).toBe(true);
    });
    it('素早い押し直し（離して、見張りの時間の中でまた押す）は決まらない', () => {
        const keys = new HeldKeys();
        keys.down('Enter', false);
        const g = new InputGate(keys, 0);
        keys.up('Enter');
        keys.down('Enter', false);
        expect(g.key('Enter', false, 80)).toBe(false);
    });
    it('画面を離れた（blur）ら、押さえているキーは無いことにする', () => {
        const keys = new HeldKeys();
        keys.down('Enter', false);
        const g = new InputGate(keys, 0);
        keys.clear();
        keys.down('Enter', false);
        expect(g.key('Enter', false, 1000)).toBe(true);
    });
});

describe('上に重なった画面（メニュー）を閉じて戻ったとき', () => {
    it('reset で、戻った時刻から見張り直す（閉じたタップ・キーで会話が進まない・選択肢が決まらない）', () => {
        const keys = new HeldKeys();
        const g = new InputGate(keys, 0);
        expect(g.pointer(5000, 5000)).toBe(true);
        keys.down('Escape', false);
        g.reset(6000);
        expect(g.pointer(6100, 6100)).toBe(false);
        expect(g.pointer(6500, 5990)).toBe(false); // メニューを閉じる前に押し始めた
        expect(g.key('Escape', false, 7000)).toBe(false);
        expect(g.pointer(6400, 6400)).toBe(true);
    });
});

describe('動かせる並びの選択肢：離した時に決める（InputGate.tap）', () => {
    it('押し始めが見張りの時間の中なら、離したのが後でも決まらない（350 ms の見張りはそのまま）', () => {
        const g = new InputGate(new HeldKeys(), 1000);
        // 出た 300 ms 後に押し始め、500 ms 後に離した
        expect(g.tap(1500, 1300)).toBe(false);
        expect(g.tap(1000 + CHOICE_GUARD_MS + 200, 1000 + CHOICE_GUARD_MS)).toBe(true);
    });
    it('出る前に押し始めた指では決まらない', () => {
        const g = new InputGate(new HeldKeys(), 1000);
        expect(g.tap(3000, 990)).toBe(false);
    });
    it('押している間に出直した（メニューが閉じた・reset）なら、離しても決まらない', () => {
        const g = new InputGate(new HeldKeys(), 0);
        expect(g.tap(900, 800)).toBe(true);
        g.reset(850);
        expect(g.tap(1300, 800)).toBe(false);
        expect(g.tap(1300, 1250)).toBe(true);
    });
});

describe('たたきとなぞりの見分け（TapTracker）', () => {
    it('その場で押して離せば、たたき', () => {
        const t = new TapTracker();
        t.down(1, 100, 200, 0);
        expect(t.active).toBe(true);
        t.move(1, 103, 204);
        expect(t.up(1, 104, 203, 0)).toBe(true);
        expect(t.active).toBe(false);
    });
    it('縦になぞった（TAP_SLOP_PX より動いた）押しは、離してもたたきにしない', () => {
        const t = new TapTracker();
        t.down(1, 100, 200, 0);
        t.move(1, 100, 200 - TAP_SLOP_PX - 1);
        expect(t.active).toBe(false);
        // 元の所へ戻して離しても、たたきにしない
        t.move(1, 100, 200);
        expect(t.up(1, 100, 200, 0)).toBe(false);
    });
    it('動きの途中を見ずに離した所だけ遠い押し・横へずらした押しも、たたきにしない', () => {
        const t = new TapTracker();
        t.down(1, 100, 200, 0);
        expect(t.up(1, 100 + TAP_SLOP_PX + 1, 200, 0)).toBe(false);
        t.down(2, 100, 200, 0);
        t.move(2, 160, 200);
        expect(t.up(2, 160, 200, 0)).toBe(false);
    });
    it('ブラウザが並びを動かし始めた（pointercancel）押しは、たたきにしない', () => {
        const t = new TapTracker();
        t.down(5, 10, 10, 40);
        t.cancel(5);
        expect(t.up(5, 10, 10, 40)).toBe(false);
    });
    it('押している間に並びが動いた（指は動いていない）押しは、たたきにしない', () => {
        const t = new TapTracker();
        t.down(1, 10, 10, 40);
        expect(t.up(1, 10, 10, 120)).toBe(false);
    });
    it('動いている並びを止めた押し（settled が false）は、たたきにしない', () => {
        const t = new TapTracker();
        t.down(1, 10, 10, 40, false);
        expect(t.active).toBe(false);
        expect(t.up(1, 10, 10, 40)).toBe(false);
    });
    it('別の指の動き・取り消し・離しでは、今の押しを変えない', () => {
        const t = new TapTracker();
        t.down(1, 10, 10, 0);
        t.move(2, 300, 300);
        t.cancel(2);
        expect(t.up(2, 10, 10, 0)).toBe(false);
        expect(t.up(1, 11, 11, 0)).toBe(true);
    });
});
