/**
 * 特殊能力の発動 UI の決まり（battle/control.ts。docs/troops-abilities-design.md §4・依頼本文【5】）。
 * - 名札の点滅の条件（labelAbilityModel）と点滅の明るさ（abilityBlink：0.55〜1.0・周期 1.6 秒・表示の時計）。
 * - ワンクリック発動（resolveLabelTap：対象の要らない能力は use）と対象選び（対象の要る能力は chooseTarget → target）、取り消し（cancel・地面）。
 * - 名札の当たり判定（labelHit：見た目より少し広い・隣の部隊の中心より外へは広げない）と、連打・漏れの守り（inTapGuard）。
 * 大平原（演習）の「徳川の七隊」で確かめる。つなぎ（entry.ts）の tap は「守り → 名札 → 地図」の順に呼ぶので、ここでも同じ順に組み合わせる。
 * 一部は状態を直接変える（部隊の状態・位置を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import { ieyasu1570Setup, IEYASU_INITIAL_TROOPS } from '../proto3d/src/battle/maps';
import {
    ABILITY_ARM,
    ABILITY_BLINK,
    LABEL_HIT_PX,
    TAP_GUARD_SEC,
    abilityBlink,
    guardTap,
    abilityEndText,
    abilityNoticeModel,
    abilityPanelModel,
    abilityTargetHint,
    armDecision,
    armLive,
    flankStatus,
    flankStatusText,
    inTapGuard,
    labelAbilityModel,
    labelHit,
    labelTapCandidates,
    labelTopAt,
    refusalText,
    resolveLabelTap,
    resolveTap,
    type LabelBox,
    type LabelCover,
    type Pending,
    type TapGuard,
} from '../proto3d/src/battle/control';

const GENERALS = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
const plains = (): BattleState => createBattle(buildBattleSetup(getField('plains')!, 'standard'));
function advance(s: BattleState, sec: number): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) stepBattle(s, 0.1);
}
const readyIds = (s: BattleState, pending: Pending = 'none', sel: string | null = null) => s.units.filter((u) => labelAbilityModel(s, u.id, pending, sel).mode === 'ready').map((u) => u.id);

describe('点滅の明るさ（表示の時計）', () => {
    it('0.55〜1.0 を周期 1.6 秒で往復する（t=0 で 1.0、半周期で 0.55）', () => {
        expect(ABILITY_BLINK).toEqual({ min: 0.55, max: 1.0, periodSec: 1.6 });
        expect(abilityBlink(0)).toBeCloseTo(1.0, 6);
        expect(abilityBlink(0.8)).toBeCloseTo(0.55, 6);
        expect(abilityBlink(1.6)).toBeCloseTo(1.0, 6);
        for (let t = 0; t < 5; t += 0.037) {
            const k = abilityBlink(t);
            expect(k).toBeGreaterThanOrEqual(0.55 - 1e-9);
            expect(k).toBeLessThanOrEqual(1.0 + 1e-9);
        }
    });
    it('合戦の時刻（s.t）ではなく表示の時計だけで決まる：一時停止中（s.t が進まない）でも値が変わる', () => {
        const s = plains();
        const t0 = s.t;
        const a = abilityBlink(10.0);
        const b = abilityBlink(10.4);
        expect(s.t).toBe(t0);
        expect(Math.abs(a - b)).toBeGreaterThan(0.1);
    });
});

describe('名札の点滅の条件（labelAbilityModel）', () => {
    it('大平原の始め：徳川の 5 武将だけ点滅する（弓隊・騎馬隊・敵は点滅しない）', () => {
        const s = plains();
        expect(readyIds(s).sort()).toEqual([...GENERALS].sort());
        for (const id of GENERALS) expect(labelAbilityModel(s, id, 'none', null).text).toMatch(/^◆/);
        expect(labelAbilityModel(s, 'a_yumi', 'none', null).mode).toBe('');
        expect(labelAbilityModel(s, 'a_kiba', 'none', null).mode).toBe('');
        for (const u of s.units.filter((x) => x.side === 'enemy')) expect(labelAbilityModel(s, u.id, 'none', null).mode).toBe('');
    });
    it('選んでいても・移動や攻撃の途中でも点滅は変わらない（選択の印とは別）', () => {
        const s = plains();
        expect(readyIds(s, 'none', 'a_ieyasu').sort()).toEqual([...GENERALS].sort());
        expect(readyIds(s, 'move', 'a_kiba').sort()).toEqual([...GENERALS].sort());
    });
    it('使った後は点滅しない（効果中は残り秒数、切れたら印なし）。一時停止中（刻みを進めない）は残りが減らない', () => {
        const s = plains();
        expect(useAbility(s, 'a_ieyasu').ok).toBe(true);
        const m = labelAbilityModel(s, 'a_ieyasu', 'none', null);
        expect(m.mode).toBe('active');
        expect(m.text).toBe('残り 35 秒');
        expect(readyIds(s)).not.toContain('a_ieyasu');
        // 止めている間（刻みを進めない）は同じ
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', null).text).toBe('残り 35 秒');
        advance(s, 10);
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', null).text).toBe('残り 25 秒');
        advance(s, 26);
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', null).mode).toBe('');
    });
    it('状態を直接変える：敗走・撤退済み・全滅・まだ着いていない部隊は点滅しない', () => {
        for (const st of ['routed', 'withdrawn', 'destroyed'] as const) {
            const s = plains();
            (unitById(s, 'a_tadakatsu') as { status: string }).status = st;
            expect(readyIds(s)).not.toContain('a_tadakatsu');
        }
        const s = plains();
        (unitById(s, 'a_sakai') as { present: boolean }).present = false;
        expect(readyIds(s)).not.toContain('a_sakai');
    });
    it('状態を直接変える：対象の要る能力（石川）は、180 m 以内に選べる味方がいなければ点滅しない', () => {
        const s = plains();
        const ishi = unitById(s, 'a_ishikawa')!;
        for (const u of s.units) {
            if (u.side !== 'ally' || u === ishi) continue;
            u.x = ishi.x + 190;
            u.z = ishi.z - 200;
        }
        expect(readyIds(s)).not.toContain('a_ishikawa');
        expect(abilityPanelModel(s, 'a_ishikawa')!.reason).toContain('180 m 以内に対象にできる味方の部隊がいない');
    });
    it('合戦が終わったら点滅しない', () => {
        const s = plains();
        const hq = unitById(s, 'e_hq')!;
        hq.status = 'routed';
        advance(s, 0.2);
        expect(s.result).not.toBeNull();
        expect(readyIds(s)).toEqual([]);
    });
    it('敵方の武将の能力（歴史分岐の敵の長政）は点滅しない', () => {
        const s = createBattle(ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true }));
        expect(labelAbilityModel(s, 'e_nagamasa', 'none', null).mode).toBe('');
        expect(labelAbilityModel(s, 't_honjin', 'none', null).mode).toBe('ready');
    });
});

describe('名札を押したときの決まり（resolveLabelTap）', () => {
    it('対象の要らない能力（家康・忠勝・榊原・酒井）は、名札を 1 回押すだけで使う', () => {
        const s = plains();
        for (const id of ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai']) expect(resolveLabelTap(s, id, 'none', null)).toEqual({ type: 'use', unitId: id });
        // 別の部隊を選んで移動の途中でも、名札の操作が先
        expect(resolveLabelTap(s, 'a_sakai', 'move', 'a_kiba')).toEqual({ type: 'use', unitId: 'a_sakai' });
    });
    it('対象の要る能力（石川）は対象選びに入る（まだ使わない）', () => {
        const s = plains();
        expect(resolveLabelTap(s, 'a_ishikawa', 'none', null)).toEqual({ type: 'chooseTarget', unitId: 'a_ishikawa' });
        expect(s.abilities.a_ishikawa.usedAt).toBeNull();
    });
    it('名札に当たっていない・点滅していない名札（弓隊・使用済み）は地図を押した扱い（null）', () => {
        const s = plains();
        expect(resolveLabelTap(s, null, 'none', null)).toBeNull();
        expect(resolveLabelTap(s, 'a_yumi', 'none', null)).toBeNull();
        expect(resolveLabelTap(s, 'e_hq', 'none', null)).toBeNull();
        useAbility(s, 'a_ieyasu');
        expect(resolveLabelTap(s, 'a_ieyasu', 'none', null)).toBeNull();
    });
    it('対象選びの間：持ち主の名札をもう一度でやめる・ほかの味方の名札は対象にする（その武将の能力は使わない）', () => {
        const s = plains();
        expect(resolveLabelTap(s, 'a_ishikawa', 'ability', 'a_ishikawa')).toEqual({ type: 'cancel', unitId: 'a_ishikawa' });
        expect(resolveLabelTap(s, 'a_kiba', 'ability', 'a_ishikawa')).toEqual({ type: 'target', userId: 'a_ishikawa', targetId: 'a_kiba' });
        expect(resolveLabelTap(s, 'a_sakai', 'ability', 'a_ishikawa')).toEqual({ type: 'target', userId: 'a_ishikawa', targetId: 'a_sakai' });
        expect(s.abilities.a_sakai.usedAt).toBeNull();
    });
    it('対象選びの流れ：石川の名札 → 不適切な対象（敵・自分）は回数を減らさず続く → 地面でやめる → もう一度 → 騎馬隊で使う', () => {
        const s = plains();
        let pending: Pending = 'none';
        let sel: string | null = null;
        const a1 = resolveLabelTap(s, 'a_ishikawa', pending, sel)!;
        expect(a1.type).toBe('chooseTarget');
        pending = 'ability';
        sel = 'a_ishikawa';
        // 対象選びの間の名札の印：持ち主・選べる・選べない
        expect(labelAbilityModel(s, 'a_ishikawa', pending, sel).mode).toBe('choosing');
        expect(labelAbilityModel(s, 'a_kiba', pending, sel).mode).toBe('target');
        expect(labelAbilityModel(s, 'e_sente', pending, sel).mode).toBe('untargetable');
        // 対象選びの間は、ほかの武将も点滅しない（押せば対象になる）
        expect(readyIds(s, pending, sel)).toEqual([]);
        // 敵の部隊を押す（地図の決まり）→ 対象として断られる
        const selected = { id: 'a_ishikawa', side: 'ally' as const, commandable: true };
        const e = resolveTap(selected, pending, { kind: 'unit', unitId: 'e_sente', side: 'enemy', x: 0, z: 0 });
        expect(e).toEqual({ type: 'abilityTarget', unitId: 'e_sente' });
        expect(useAbility(s, 'a_ishikawa', 'e_sente').ok).toBe(false);
        expect(useAbility(s, 'a_ishikawa', 'a_ishikawa').ok).toBe(false);
        expect(s.abilities.a_ishikawa.usedAt).toBeNull();
        // 地面を押す → やめる（移動の命令にしない）
        const g = resolveTap(selected, pending, { kind: 'ground', x: 10, z: 10 });
        expect(g.type).toBe('abilityCancel');
        pending = 'none';
        expect(s.abilities.a_ishikawa.usedAt).toBeNull();
        expect(unitById(s, 'a_ishikawa')!.order.type).toBe('hold');
        // もう一度名札 → 騎馬隊の名札で使う
        expect(resolveLabelTap(s, 'a_ishikawa', pending, sel)!.type).toBe('chooseTarget');
        pending = 'ability';
        const a2 = resolveLabelTap(s, 'a_kiba', pending, sel)!;
        expect(a2).toEqual({ type: 'target', userId: 'a_ishikawa', targetId: 'a_kiba' });
        expect(useAbility(s, 'a_ishikawa', 'a_kiba').ok).toBe(true);
        expect(s.abilities.a_ishikawa.targetId).toBe('a_kiba');
        // 使った後は点滅しない・名札に残り秒数
        expect(labelAbilityModel(s, 'a_ishikawa', 'none', sel)).toEqual({ mode: 'active', text: '残り 30 秒' });
    });
    it('連打：1 回目で使い、2 回目以降は守り（0.5 秒）で何もしない。守りの後も、使った名札は点滅しないので能力は 2 回目を使わない', () => {
        const s = plains();
        const now = 12.0;
        const act = resolveLabelTap(s, 'a_tadakatsu', 'none', null)!;
        expect(act.type).toBe('use');
        expect(useAbility(s, 'a_tadakatsu').ok).toBe(true);
        const usedAt = s.abilities.a_tadakatsu.usedAt;
        const guard: TapGuard = { x: 300, y: 200, until: now + TAP_GUARD_SEC, r: LABEL_HIT_PX.touch / 2 };
        expect(TAP_GUARD_SEC).toBe(0.5);
        // 同じ所の 2 回目（0.1 秒後・少しずれた所）→ 守りで何もしない（地面の移動・部隊の選択に回さない）
        expect(inTapGuard(guard, 303, 204, now + 0.1)).toBe(true);
        expect(inTapGuard(guard, 300 + 23, 200, now + 0.4)).toBe(true);
        // 離れた所・守りの後は、ふつうのタップ
        expect(inTapGuard(guard, 380, 200, now + 0.1)).toBe(false);
        expect(inTapGuard(guard, 300, 200, now + 0.6)).toBe(false);
        expect(inTapGuard(null, 300, 200, now)).toBe(false);
        // 守りの後に同じ名札：もう点滅していないので名札の操作にならない（能力も 2 回目は断られる）
        expect(resolveLabelTap(s, 'a_tadakatsu', 'none', null)).toBeNull();
        expect(useAbility(s, 'a_tadakatsu').ok).toBe(false);
        expect(s.abilities.a_tadakatsu.usedAt).toBe(usedAt);
    });
    it('連打が続く間は守りを延ばす（0.4 秒ごとに 5 回押しても、すべて何もしない）。0.5 秒あければ、ふつうのタップ', () => {
        let g: TapGuard | null = { x: 100, y: 100, until: 1 + TAP_GUARD_SEC, r: 18 };
        for (let k = 1; k <= 5; k++) {
            const r = guardTap(g, 101, 99, 1 + 0.4 * k);
            expect(r.swallow).toBe(true);
            g = r.guard;
        }
        expect(g!.until).toBeCloseTo(1 + 0.4 * 5 + TAP_GUARD_SEC, 9);
        expect(guardTap(g, 101, 99, 1 + 0.4 * 5 + 0.51).swallow).toBe(false);
        // 離れた所は延ばさない
        expect(guardTap(g, 160, 99, 1 + 0.4 * 5 + 0.1)).toEqual({ swallow: false, guard: g });
        expect(guardTap(null, 0, 0, 0)).toEqual({ swallow: false, guard: null });
    });
    it('ワンクリックで使っても、ほかの部隊の命令・位置・選択は変わらない（名札の操作は地図の決まりを通らない）', () => {
        const s = plains();
        issueOrder(s, 'a_kiba', { type: 'move', x: -150, z: 40 });
        const before = s.units.map((u) => ({ id: u.id, x: u.x, z: u.z, order: JSON.stringify(u.order) }));
        const act = resolveLabelTap(s, 'a_sakakibara', 'move', 'a_kiba')!;
        expect(act).toEqual({ type: 'use', unitId: 'a_sakakibara' });
        useAbility(s, 'a_sakakibara');
        const after = s.units.map((u) => ({ id: u.id, x: u.x, z: u.z, order: JSON.stringify(u.order) }));
        expect(after).toEqual(before);
    });
});

describe('名札の当たり判定（labelHit）', () => {
    // 名札（見た目 70×16 px）の中心 (200, 100)
    const box: LabelBox = { id: 'a', l: 165, t: 92, r: 235, b: 108 };
    it('見た目の名札の中は当たり', () => {
        expect(labelHit([box], [], 170, 95, 36)).toBe('a');
        expect(labelHit([box], [], 234, 107, 36)).toBe('a');
    });
    it('見た目より少し広い：PC 36 px・スマホ 48 px 四方まで（縦に 18／24 px）', () => {
        expect(LABEL_HIT_PX).toEqual({ mouse: 36, touch: 48 });
        expect(labelHit([box], [], 200, 100 + 17, LABEL_HIT_PX.mouse)).toBe('a');
        expect(labelHit([box], [], 200, 100 + 19, LABEL_HIT_PX.mouse)).toBeNull();
        expect(labelHit([box], [], 200, 100 - 23, LABEL_HIT_PX.touch)).toBe('a');
        expect(labelHit([box], [], 200, 100 + 25, LABEL_HIT_PX.touch)).toBeNull();
        // 横は名札の幅が 36 px より広いので広げない
        expect(labelHit([box], [], 237, 100, LABEL_HIT_PX.touch)).toBeNull();
    });
    it('小さな名札（20×14 px）は 48 px 四方まで広げる', () => {
        const small: LabelBox = { id: 's', l: 90, t: 93, r: 110, b: 107 };
        expect(labelHit([small], [], 100 + 22, 100 - 22, LABEL_HIT_PX.touch)).toBe('s');
        expect(labelHit([small], [], 100 + 25, 100, LABEL_HIT_PX.touch)).toBeNull();
    });
    it('広げた所は、隣の部隊の中心より近いときだけ（隣の部隊の中心より外へは広げない）', () => {
        // 名札のすぐ下（22 px）に隣の部隊の中心。名札から 20 px 下のタップは隣の方が近い → 名札にしない
        const others = [{ id: 'b', x: 200, y: 122 }];
        expect(labelHit([box], others, 200, 120, LABEL_HIT_PX.touch)).toBeNull();
        // 名札から 10 px 下（隣より名札の中心に近い）→ 名札
        expect(labelHit([box], others, 200, 110, LABEL_HIT_PX.touch)).toBe('a');
        // 見た目の名札の中は、隣が近くても名札
        expect(labelHit([box], [{ id: 'b', x: 200, y: 106 }], 200, 107, LABEL_HIT_PX.touch)).toBe('a');
        // 自分の部隊の中心は比べない
        expect(labelHit([box], [{ id: 'a', x: 200, y: 118 }], 200, 118, LABEL_HIT_PX.touch)).toBe('a');
    });
    it('2 つの名札に当たれば、名札の中心に近い方', () => {
        const b2: LabelBox = { id: 'b', l: 180, t: 110, r: 250, b: 126 };
        // a の見た目の中（b の広げた所でもある）→ a
        expect(labelHit([box, b2], [], 215, 105, LABEL_HIT_PX.touch)).toBe('a');
        // 2 つの間（どちらの見た目の外）→ 中心の近い b（中心 (215,118) まで 9 px、a の中心まで 18 px）
        expect(labelHit([box, b2], [], 215, 109, LABEL_HIT_PX.touch)).toBe('b');
    });
});

describe('名札の重なり（labelHit の covers・labelTopAt。Version 13 候補の確認で直した）', () => {
    // 確認で見つかった形（スマホの全体表示）：忠勝の名札（印は右端）の上に、後から足した榊原の名札が重なって描かれ、忠勝の印は見えない。
    // 前は榊原の名札の名前を押すと、下に隠れた忠勝の印の当たりに入り、忠勝の「退路の守護」が発動していた
    const tadaLabel: LabelCover = { id: 'a_tadakatsu', l: 380, t: 190, r: 470, b: 205, z: 100003 };
    const tadaBadge: LabelBox = { id: 'a_tadakatsu', l: 432, t: 192, r: 468, b: 203, z: 100003 };
    const sakaLabel: LabelCover = { id: 'a_sakakibara', l: 420, t: 192, r: 505, b: 207, z: 100005 };
    const sakaBadge: LabelBox = { id: 'a_sakakibara', l: 470, t: 194, r: 503, b: 205, z: 100005 };
    const covers = [tadaLabel, sakaLabel];
    it('上に重なって見えている名札の所は、下に隠れた名札の印に当てない（榊原の名札の名前を押しても忠勝は発動しない）', () => {
        // (444,199)：忠勝の印の四角の中だが、榊原の名札が上に見えている
        expect(labelHit([tadaBadge, sakaBadge], [], 444, 199, LABEL_HIT_PX.touch, covers)).toBeNull();
        expect(labelTopAt(covers, 444, 199)).toBe('a_sakakibara');
        // 重なりを渡さない（前の判定）と、隠れた忠勝の印に当たっていた
        expect(labelHit([tadaBadge, sakaBadge], [], 444, 199, LABEL_HIT_PX.touch)).toBe('a_tadakatsu');
    });
    it('見えている印は今までどおり当たる（榊原の印・重なっていない忠勝の名札の左の所は忠勝の名前）', () => {
        expect(labelHit([tadaBadge, sakaBadge], [], 486, 199, LABEL_HIT_PX.touch, covers)).toBe('a_sakakibara');
        expect(labelTopAt(covers, 400, 197)).toBe('a_tadakatsu');
        expect(labelHit([tadaBadge, sakaBadge], [], 400, 197, LABEL_HIT_PX.touch, covers)).toBeNull();
    });
    it('広げた当たりは、名札の上（自分の名札の名前の所も）では効かない。名札の外なら今までどおり', () => {
        const label: LabelCover = { id: 'a', l: 140, t: 90, r: 240, b: 110, z: 1 };
        const badge: LabelBox = { id: 'a', l: 205, t: 93, r: 238, b: 107, z: 1 };
        // 名前の所（印の左 6 px）：印の広げた当たりの中だが、名札の上なので印には当てない（名前の所＝確かめ）
        expect(labelHit([badge], [], 199, 100, LABEL_HIT_PX.touch, [label])).toBeNull();
        expect(labelHit([badge], [], 199, 100, LABEL_HIT_PX.touch)).toBe('a');
        // 名札の外（印の下 8 px）：広げた当たり
        expect(labelHit([badge], [], 221, 116, LABEL_HIT_PX.touch, [label])).toBe('a');
    });
    it('重なりの順が同じ名札どうしでは、z の大きい方が上（下の名札の中でも、上の名札の外なら当たる）', () => {
        expect(labelTopAt(covers, 475, 200)).toBe('a_sakakibara');
        expect(labelTopAt(covers, 385, 200)).toBe('a_tadakatsu');
        expect(labelTopAt(covers, 300, 200)).toBeNull();
    });
});

describe('名札の名前・部隊の体を押したときの確かめ（armDecision）', () => {
    it('1 回目は確かめ（arm）。3 秒のうちに同じ武将をもう一度押すと使う（fire）。0.25 秒より早い 2 回目は何もしない（wait）', () => {
        expect(armDecision(null, 'a_ieyasu', 10)).toBe('arm');
        const arm = { id: 'a_ieyasu', at: 10 };
        expect(armDecision(arm, 'a_ieyasu', 10.1)).toBe('wait');
        expect(armDecision(arm, 'a_ieyasu', 10 + ABILITY_ARM.minGapSec)).toBe('fire');
        expect(armDecision(arm, 'a_ieyasu', 12.9)).toBe('fire');
        expect(armDecision(arm, 'a_ieyasu', 10 + ABILITY_ARM.windowSec + 0.01)).toBe('arm');
        // ほかの武将は確かめからやり直し
        expect(armDecision(arm, 'a_sakai', 11)).toBe('arm');
    });
    it('確かめの間は、名札の印が「もう一度で◆号令」になる（点滅は続く）。時間が過ぎれば元の「◆号令」', () => {
        const s = plains();
        const arm = { id: 'a_ieyasu', at: 5 };
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', 'a_ieyasu', armLive(arm, 6))).toEqual({ mode: 'ready', text: 'もう一度で◆号令' });
        expect(labelAbilityModel(s, 'a_sakai', 'none', 'a_ieyasu', armLive(arm, 6))).toEqual({ mode: 'ready', text: '◆両翼' });
        expect(armLive(arm, 9)).toBeNull();
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', 'a_ieyasu', armLive(arm, 9))).toEqual({ mode: 'ready', text: '◆号令' });
    });
});

describe('両翼の采配の包囲の条件の表示（flankStatus）', () => {
    it('効果中だけ。正面だけで斬っている間は「包囲なし」。能力の欄・名札にも出る', () => {
        const s = plains();
        expect(flankStatus(s, 'a_sakai')).toBeNull();
        useAbility(s, 'a_sakai');
        const f = flankStatus(s, 'a_sakai')!;
        expect(f).toEqual({ flankers: 0, encircled: 0 });
        expect(flankStatusText(f)).toBe('包囲なし');
        expect(abilityPanelModel(s, 'a_sakai')!.stateText).toContain('包囲なし');
        expect(labelAbilityModel(s, 'a_sakai', 'none', null).text).toMatch(/^残り 25 秒・包囲なし$/);
        // ほかの能力には出ない
        useAbility(s, 'a_ieyasu');
        expect(flankStatus(s, 'a_ieyasu')).toBeNull();
        expect(labelAbilityModel(s, 'a_ieyasu', 'none', null).text).toBe('残り 35 秒');
    });
    it('文：包囲があれば「包囲 N」、側背だけなら「包囲なし・側背 N」', () => {
        expect(flankStatusText({ flankers: 2, encircled: 1 })).toBe('包囲 1');
        expect(flankStatusText({ flankers: 1, encircled: 0 })).toBe('包囲なし・側背 1');
    });
});

describe('当たり判定を付ける名札・知らせの文', () => {
    it('ふつうは点滅している名札だけ。対象選びの間は戦える味方の名札すべて', () => {
        const s = plains();
        expect(labelTapCandidates(s, 'none', null).sort()).toEqual([...GENERALS].sort());
        useAbility(s, 'a_sakai');
        expect(labelTapCandidates(s, 'none', null)).not.toContain('a_sakai');
        const pend = labelTapCandidates(s, 'ability', 'a_ishikawa');
        expect(pend).toContain('a_kiba');
        expect(pend).toContain('a_ishikawa');
        expect(pend.some((id) => id.startsWith('e_'))).toBe(false);
    });
    it('移動先指定の間は、点滅している名札の印も当たりにしない（その点への移動にする。第4群の確かめの決定）。向きの指定の間は今までどおり', () => {
        const s = plains();
        expect(labelTapCandidates(s, 'move', 'a_yumi')).toEqual([]);
        expect(labelTapCandidates(s, 'face', 'a_yumi').sort()).toEqual([...GENERALS].sort());
    });
    it('発動の知らせ：能力名・武将・対象（範囲・選んだ部隊・自隊）', () => {
        const s = plains();
        useAbility(s, 'a_ieyasu');
        expect(abilityNoticeModel(s, 'a_ieyasu')).toEqual({ title: '「立て直しの号令」', general: '徳川家康', target: '半径 110 m（家康本陣の周り）' });
        useAbility(s, 'a_sakakibara');
        const sk = abilityNoticeModel(s, 'a_sakakibara')!;
        expect(sk.general).toBe('榊原康政');
        expect(sk.target).toBe('榊原康政隊');
        useAbility(s, 'a_ishikawa', 'a_kiba');
        const ik = abilityNoticeModel(s, 'a_ishikawa')!;
        expect(ik.general).toBe('石川数正');
        expect(ik.target).toBe('徳川騎馬隊');
        expect(abilityEndText('ieyasu_rally')).toBe('「立て直しの号令」の効果が切れた');
    });
    it('能力の欄：範囲・残り時間・使い方。石川は「へ差配中」、断る理由は「差配に専念している」', () => {
        const s = plains();
        const m0 = abilityPanelModel(s, 'a_ieyasu')!;
        expect(m0.rangeText).toBe('半径 110 m（家康本陣の周り）');
        expect(m0.remainText).toBe('');
        expect(m0.howTo).toContain('印（◆）を押すだけ');
        expect(abilityPanelModel(s, 'a_ishikawa')!.howTo).toContain('輪の付いた味方');
        expect(abilityTargetHint(s, 'a_ishikawa')).toContain('対象の味方を押してください');
        useAbility(s, 'a_ishikawa', 'a_kiba');
        const m1 = abilityPanelModel(s, 'a_ishikawa')!;
        expect(m1.stateText).toContain('徳川騎馬隊へ差配中');
        expect(m1.remainText).toBe('残り 30 秒');
        expect(m1.howTo).toBe('');
        expect(refusalText(s, 'a_ishikawa', { type: 'move', x: 0, z: 0 })).toContain('差配に専念している（残り 30 秒');
    });
});
