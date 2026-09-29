/**
 * 戦場「山道・峠」（mountain_pass）の釣り合い：地形に合わない作戦（放置・峠道の外の開けた所で迎え撃つ・全部隊で北へ攻め出る）は
 * 援軍を待たずに本陣が崩れて負ける、地形に合った作戦（関に槍を横に並べ、弓を関の後ろの坂に置く）は援軍が着いてから 60 秒耐えて勝つ、
 * 副目標（関を失わない）は作戦（本陣を関の後ろへ上げて号令で支えるか）によって達成／未達成に分かれる。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。数字（兵の残り・時間）は mountain_pass.ts の釣り合いの目安。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, type BattleEvent, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const PASS_FIELD = getField('mountain_pass')!;
/** 峠道（狭い正面の区域）と関（副目標の区域） */
const PASS_ZONE = { rect: { x0: -20, x1: 20, z0: -130, z1: 110 } };
const GATE_ZONE = { circle: { cx: 0, cz: 40, r: 22 } };

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力 */
type Step = [number, string, Order | 'ability'];

const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
/** 本陣以外の、始めからいる味方の部隊 */
const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_yumi'];

interface Run {
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1。援軍も含む） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    events: BattleEvent[];
    /** 峠道の中の味方 1 部隊へ同時に斬りかかっていた敵の数の最大／峠道の外の味方への最大 */
    maxInPass: number;
    maxOutside: number;
}

function play(steps: Step[]): Run {
    const s = createBattle(buildBattleSetup(PASS_FIELD, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    let maxInPass = 0;
    let maxOutside = 0;
    const o = runToEnd(s, (st: BattleState) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            if (ord === 'ability') {
                if (!useAbility(st, id).ok) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, ord)) refused.push(`${t}:${id}`);
        }
        for (const a of st.units) {
            if (a.side !== 'ally' || !a.present || a.status !== 'ready') continue;
            const n = st.units.filter((e) => e.side === 'enemy' && e.status === 'ready' && e.engagedWith === a.id).length;
            if (inZone(PASS_ZONE, a.x, a.z)) maxInPass = Math.max(maxInPass, n);
            else maxOutside = Math.max(maxOutside, n);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, events: s.events, maxInPass, maxOutside };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const gateHeld = (r: Run) => r.o.objectives!.secondary.find((x) => x.id === 'pass_gate')!.achieved;
/** 関を失った時刻（失わなければ null） */
const gateLostAt = (r: Run) => r.events.find((e) => e.kind === 'objective' && e.text.includes('関を失わない') && e.text.includes('果たせなく'))?.t ?? null;

// ---------------------------------------------------------------- 台本

/**
 * 関の守り：忠勝隊・酒井隊を関（幅 30 m）に横に並べ（0 秒）、弓は少し遅らせて関の後ろの坂へ（20 秒。弓の方が足が速いので、
 * 一緒に出すと峠道で槍の前に出て、槍の行く手を塞ぐ）。
 */
const GATE: Step[] = [
    [0, 'a_tadakatsu', mv(-10, 42)],
    [0, 'a_sakai', mv(10, 42)],
    [20, 'a_yumi', mv(0, 78)],
];
/** 本陣を峠道の南の口まで上げ（関から 70 m。号令の届く 90 m の内）、関の隊が疲れた頃に立て直しの号令 */
const HQ_UP: Step[] = [
    [20, 'a_ieyasu', mv(0, 110)],
    [120, 'a_ieyasu', 'ability'],
];
/** 援軍が着いたら関の後ろへ上げ、石川隊の後詰めの差配で足を速める */
const RELIEF_UP: Step[] = [
    [180, 'a_sakakibara', mv(-10, 62)],
    [180, 'a_ishikawa', mv(10, 62)],
    [181, 'a_ishikawa', 'ability'],
];

/** 地形に合った作戦：命令は 9 回（0・20・120・180 秒） */
const FIT: Step[] = [...GATE, ...HQ_UP, ...RELIEF_UP];

describe('山道・峠のデータ', () => {
    it('検査を通る。味方 4＋援軍 2／敵 10（敵はすべて敵勢）。狭い正面・関の坂の守り・崖（道探しを使う）', () => {
        expect(validateField(PASS_FIELD)).toEqual([]);
        const us = presetUnits(PASS_FIELD, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakai', 'a_yumi', 'a_sakakibara', 'a_ishikawa']);
        expect(us.filter((u) => u.side === 'ally' && u.arriveAt === 180).map((u) => u.id)).toEqual(['a_sakakibara', 'a_ishikawa']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(10);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(PASS_FIELD.specialRules).toEqual([{ type: 'narrow_frontage', zone: PASS_ZONE, maxEngaged: 2 }]);
        expect(PASS_FIELD.highGround).toMatchObject({ defenseVsLower: 0.5, minDiff: 2 });
        expect(createBattle(buildBattleSetup(PASS_FIELD, 'standard')).field.nav).not.toBeNull();
        // 道（速い筋）は峠道の中に無い（並んで進む部隊が真ん中へ寄り合って詰まらないように）
        const roads = PASS_FIELD.terrain.filter((a) => a.kind === 'road');
        for (let z = -125; z < 110; z += 5) expect(roads.some((a) => inZone(a, 0, z))).toBe(false);
    });

    it('布陣：味方は峠道の外（南の開けた所）で始まる。関は坂の上', () => {
        const s = createBattle(buildBattleSetup(PASS_FIELD, 'standard'));
        for (const u of s.units.filter((x) => x.side === 'ally' && x.present)) expect(inZone(PASS_ZONE, u.x, u.z)).toBe(false);
        const hill = PASS_FIELD.terrain.find((a) => a.kind === 'hill')!;
        expect(inZone(hill, 0, 42)).toBe(true);
    });

    it('敵の考え：槍・騎馬は 3 回に分かれて（0・30・60 秒）南の本陣へ攻め込み、弓は 90 秒に来て関へ射に出る。本陣は守る', () => {
        const us = presetUnits(PASS_FIELD, 'standard').filter((u) => u.side === 'enemy');
        const row = (id: string) => us.find((u) => u.id === id)!;
        expect(row('e_hq').aiRole).toBe('guard_hq');
        const waves: Record<string, string[]> = {};
        for (const u of us.filter((x) => x.kind === 'yari' || x.kind === 'kiba')) {
            expect(u.aiRole).toBe('assault');
            expect(u.aiTarget!.z).toBeGreaterThan(110);
            (waves[String(u.arriveAt ?? 0)] ??= []).push(u.id);
        }
        expect(waves).toEqual({ '0': ['e_w1a', 'e_w1b', 'e_w1c'], '30': ['e_w2a', 'e_w2b', 'e_w2c'], '60': ['e_w3a', 'e_w3b'] });
        expect(row('e_yumi')).toMatchObject({ kind: 'yumi', aiRole: 'assault', arriveAt: 90 });
        expect(inZone(GATE_ZONE, row('e_yumi').aiTarget!.x, row('e_yumi').aiTarget!.z)).toBe(true);
    });
});

describe('山道・峠：地形に合わない作戦（早送り）', () => {
    it('何もしない（南の開けた所で待つ）→ 峠道を抜けてきた敵に囲まれ、援軍が着く前後に本陣が崩れて負ける', () => {
        const r = play([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.reason).toBe('ally_hq_routed');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(gateHeld(r)).toBe(false);
        expect(r.o.elapsedSec).toBeLessThan(200);
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('全部隊で北へ攻め出る（峠道を抜けて北の開けた所へ）→ 大軍に押し潰され、150 秒より前に負ける', () => {
        const r = play(FIGHTERS.map((id) => [0, id, mv(0, -150)] as Step));
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.elapsedSec).toBeLessThan(150);
        // 敵の一番手はほとんど減らない
        expect(r.left.e_w1a).toBeGreaterThan(500);
    });

    it('峠道の北の出口の外で迎え撃つ → 3 部隊以上に囲まれ、負ける', () => {
        const r = play([
            [0, 'a_tadakatsu', mv(-10, -120)],
            [0, 'a_sakai', mv(10, -120)],
            [0, 'a_yumi', mv(0, -90)],
        ]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.maxOutside).toBeGreaterThanOrEqual(3);
    });

    it('南の開けた所に横に広がって迎え撃つ → 峠道から出てくる敵に次々に当たられ、負ける', () => {
        const r = play([
            [0, 'a_tadakatsu', mv(-30, 140)],
            [0, 'a_sakai', mv(30, 140)],
            [0, 'a_yumi', mv(0, 150)],
        ]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
    });
});

describe('山道・峠：地形に合った作戦（早送り）', () => {
    it('関に槍を横に並べ、弓を後ろの坂に、本陣を峠道の南の口へ上げて号令、援軍を関の後ろへ → 勝つ（副目標も達成）', () => {
        const r = play(FIT);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.elapsedSec).toBeCloseTo(240, 0);
        expect(gateHeld(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.35);
        // 峠道の中では、関の 1 部隊へ同時に斬りかかれる敵は 2 部隊まで
        expect(r.maxInPass).toBeLessThanOrEqual(2);
        // 本陣・弓は無傷のまま。関の二隊のうち酒井隊は最後まで踏みとどまる
        expect(r.left.a_ieyasu).toBe(300);
        expect(r.left.a_yumi).toBe(350);
        expect(statusOf(r, 'a_sakai')).toBe('ready');
    });

    it('関の二隊と弓だけ（本陣・援軍は動かさない。命令 3 回）でも勝つ（ただし関は失う）', () => {
        const r = play(GATE);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(gateHeld(r)).toBe(false);
        expect(r.maxInPass).toBeLessThanOrEqual(2);
    });

    it('同じ作戦で、命令の時刻を ±15 秒ずらした 16 通りのすべてで勝ち、15 通り以上で関を失わない（決まった乱数で作る。確かめた時は 16 通り）', () => {
        let seed = 11;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        let wins = 0;
        let held = 0;
        for (let k = 0; k < 16; k++) {
            const steps = FIT.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
            const r = play(steps);
            if (r.o.result === 'victory') wins++;
            if (gateHeld(r)) held++;
        }
        expect(wins).toBe(16);
        expect(held).toBeGreaterThanOrEqual(15);
    }, 60_000);
});

describe('山道・峠：副目標（関を失わない）は作戦で分かれる（早送り）', () => {
    it('関の守りと援軍の動きが同じでも、本陣を上げて号令 → 関を守り切る／本陣を動かさない → 勝っても 200 秒ごろに関を失う', () => {
        const up = play(FIT);
        const stay = play([...GATE, ...RELIEF_UP]);
        expect(up.o.result).toBe('victory');
        expect(stay.o.result).toBe('victory');
        expect(gateHeld(up)).toBe(true);
        expect(gateHeld(stay)).toBe(false);
        expect(gateLostAt(up)).toBeNull();
        const lost = gateLostAt(stay)!;
        expect(lost).toBeGreaterThan(180);
        expect(lost).toBeLessThan(215);
        // 関の二隊は、号令が無いと関を失う前に崩れる
        expect(statusOf(stay, 'a_tadakatsu')).not.toBe('ready');
        expect(statusOf(stay, 'a_sakai')).not.toBe('ready');
        // 勝敗・主目標・副目標は別の欄
        expect(stay.o.objectives!.primary!.achieved).toBe(true);
    });
});
