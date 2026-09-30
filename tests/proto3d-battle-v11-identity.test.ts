/**
 * Version 11 の合戦が「同じ命令なら 1 刻みも同じ結果」のままであることを確かめる（データ駆動の戦場の土台を入れる前に取った基準と比べる）。
 * - 架空の第一章「国境の原」（maps.ts の demoSetup。協力陣営ごと）と、歴史分岐「元亀元年・家康」（ieyasu1570Setup。3 方針 × 約束の有無）を、
 *   決まった命令の台本（scripts.ts の台本・放置・撤退・寄り道の移動）で runToEnd する。
 * - 結果（BattleOutcome）と、30 秒ごとの全部隊の x・z・兵・士気・向き・命令・状態（丸めない値）のハッシュ、出来事の文のハッシュを比べる。
 * - 基準は tests/fixtures/v11-baseline.json（変更前のコードで WRITE_V11_BASELINE=1 npx vitest run tests/proto3d-battle-v11-identity.test.ts で作った）。
 * 早送り（台本で最後まで一気に進める）。状態の直接変更はしない。
 *
 * Version 13 候補（docs/troops-abilities-design.md §2）で家康・忠勝の能力の数値を強めたため、プレイヤーが能力を使う台本だけ基準を作り直した
 * （REBASED_V13 の 14 台本。ほかの 62 台本の基準は Version 11 のまま 1 字も変えていない）。作り直した台本も、勝敗・終わった理由・約束の結果・
 * 能力を使った時刻は前と同じ。変わったのは兵・士気・位置と、それに続く出来事。例（前 → 後）：
 * （退路の守護は忠勝隊の受ける損害 ×1.15 → ×1.4・退く味方の損害 −50% → −80%・追っ手の引きつけ、号令は士気 +25 → +40・与える損害 ×0.5 → ×0.3 など）
 * - ieyasu:asai:*:retreatSave：忠勝隊の兵 147 → 86、長政隊 359 → 374
 * - ieyasu:oda:*:retreatSave：忠勝隊 278 → 251、織田援軍 273 → 290
 * - ieyasu:oda:*:planKeep：勝利の時刻 259.1 → 241.6 秒。敵方の長政の援護の時刻 213.1 → 184.1 秒
 * - ieyasu:asai:*:planKeep：勝利の時刻 157.7 → 157.4 秒、家康本陣 268 → 209
 * - ieyasu:home:*:planKeep・planBreak：勝利の時刻 235.6 → 233.8 秒・258.5 → 257.0 秒
 * - ieyasu:home:*:retreatSave：撤退の時刻 166.5 → 166.9 秒、砦の守備隊 162 → 175
 */
import { describe, expect, it } from 'vitest';
import baselineJson from './fixtures/v11-baseline.json';
import { createBattle, issueOrder, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup, type Alliance, type IeyasuPolicy } from '../proto3d/src/battle/maps';
import {
    frontalNoHqScript,
    frontalScript,
    holdScript,
    hqAloneScript,
    ieyasuFrontalScript,
    ieyasuPlanScript,
    ieyasuRetreatScript,
    lureScript,
    planScript,
    retreatAt,
    type Script,
} from '../proto3d/src/battle/scripts';
import type { BattleSetup } from '../proto3d/src/battle/types';

/** 基準を書くときだけ使う（型の確かめ tsc に node の型が無いので、実行時に読み込む） */
const FIXTURE_URL = new URL('./fixtures/v11-baseline.json', import.meta.url);
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** FNV-1a（32 bit）。同じ文字列なら同じ値 */
function fnv(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** period 秒ごとにしか命令を出さない（利用者の反応の遅れ） */
function slow(script: Script, period: number): Script {
    let last = -1;
    return (s) => {
        const k = Math.floor(s.t / period);
        if (k === last) return;
        last = k;
        script(s);
    };
}

/** 寄り道の移動：味方の全部隊を、決まった時刻に丘・林・湿地・道を通る地点へ順に動かす（地形ごとの速さ・よけ方を通す） */
function wanderScript(): Script {
    const legs: [number, number, number][] = [
        [0, -120, 40],
        [25, 140, 20],
        [60, 0, -40],
        [95, -60, 60],
        [130, 30, 100],
    ];
    const done = new Set<string>();
    return (s) => {
        for (const [t, x, z] of legs) {
            if (s.t < t || done.has(`${t}`)) continue;
            done.add(`${t}`);
            let k = 0;
            for (const u of s.units) {
                if (u.side !== 'ally') continue;
                issueOrder(s, u.id, { type: 'move', x: x + (k % 3) * 22 - 22, z: z + Math.floor(k / 3) * 22, face: k * 0.7 });
                k++;
            }
        }
    };
}

interface Case {
    name: string;
    setup: () => BattleSetup;
    script: () => Script;
}

function cases(): Case[] {
    const out: Case[] = [];
    const ALL: Alliance[] = ['tashiro', 'omori', 'alone'];
    for (const al of ALL) {
        const S = () => demoSetup(al);
        out.push(
            { name: `border:${al}:hold`, setup: S, script: () => holdScript },
            { name: `border:${al}:frontal`, setup: S, script: () => frontalScript },
            { name: `border:${al}:frontalNoHq`, setup: S, script: () => frontalNoHqScript },
            { name: `border:${al}:retreat60`, setup: S, script: () => retreatAt(60) },
            { name: `border:${al}:hqAlone`, setup: S, script: () => hqAloneScript() },
            { name: `border:${al}:plan`, setup: S, script: () => planScript(al) },
            { name: `border:${al}:planSlow`, setup: S, script: () => slow(planScript(al), 3) },
            { name: `border:${al}:wander`, setup: S, script: () => wanderScript() },
        );
    }
    out.push({ name: 'border:alone:lure', setup: () => demoSetup('alone'), script: () => lureScript() });
    out.push({ name: 'border:alone:weak', setup: () => demoSetup('alone', { strength: { a_genzo: 420 }, morale: { a_hq: 70 } }), script: () => planScript('alone') });
    const POL: IeyasuPolicy[] = ['oda', 'asai', 'home'];
    for (const p of POL) {
        for (const pledge of [true, false]) {
            const S = () => ieyasu1570Setup(p, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: pledge });
            const tag = `ieyasu:${p}:${pledge ? 'pledge' : 'nopledge'}`;
            out.push(
                { name: `${tag}:hold`, setup: S, script: () => holdScript },
                { name: `${tag}:frontal`, setup: S, script: () => ieyasuFrontalScript(p) },
                { name: `${tag}:frontalNoHq`, setup: S, script: () => ieyasuFrontalScript(p, false) },
                { name: `${tag}:planKeep`, setup: S, script: () => ieyasuPlanScript(p, 'keep') },
                { name: `${tag}:planBreak`, setup: S, script: () => ieyasuPlanScript(p, 'break') },
                { name: `${tag}:retreatSave`, setup: S, script: () => ieyasuRetreatScript(p) },
                { name: `${tag}:retreat90`, setup: S, script: () => retreatAt(90) },
                { name: `${tag}:wander`, setup: S, script: () => wanderScript() },
            );
        }
    }
    const weak = { honjin: 120, tadakatsu: 200, yumi: 0, reserve: 90 };
    out.push({ name: 'ieyasu:home:weak:plan', setup: () => ieyasu1570Setup('home', { troops: weak, pledgeAccepted: true }), script: () => ieyasuPlanScript('home') });
    return out;
}

/** 1 つの台本を最後まで進め、比べる記録を作る */
function record(c: Case): { outcome: unknown; snaps: string[]; events: string; eventCount: number } {
    const s: BattleState = createBattle(c.setup());
    const script = c.script();
    const snaps: string[] = [];
    let next = 0;
    const snap = () => {
        const rows = s.units.map((u) => [u.id, u.x, u.z, u.strength, u.morale, u.facing, u.status, JSON.stringify(u.order), u.engagedWith, u.shootingAt].join(','));
        snaps.push(`${s.tick}:${fnv(rows.join('|'))}`);
    };
    const outcome = runToEnd(s, (st) => {
        if (st.t >= next - 1e-9) {
            snap();
            next += 30;
        }
        script(st);
    });
    snap();
    const events = fnv(s.events.map((e) => `${e.t}|${e.kind}|${e.text}|${e.unitId ?? ''}|${e.targetId ?? ''}`).join('\n'));
    // 目標の記録（outcome.objectives）は、後から章に副目標を足しても勝敗・動きは変わらないので比べない（勝敗・部隊の結果・約束・能力は比べる）
    const { objectives: _objectives, ...rest } = outcome;
    return { outcome: JSON.parse(JSON.stringify(rest)), snaps, events, eventCount: s.events.length };
}

const WRITE = env.WRITE_V11_BASELINE === '1';

/** Version 13 候補で基準を作り直した台本（プレイヤーが家康・忠勝・長政の能力を使う台本だけ） */
const REBASED_V13 = [
    'ieyasu:oda:pledge:planKeep',
    'ieyasu:oda:pledge:retreatSave',
    'ieyasu:oda:nopledge:planKeep',
    'ieyasu:oda:nopledge:retreatSave',
    'ieyasu:asai:pledge:planKeep',
    'ieyasu:asai:pledge:retreatSave',
    'ieyasu:asai:nopledge:planKeep',
    'ieyasu:asai:nopledge:retreatSave',
    'ieyasu:home:pledge:planKeep',
    'ieyasu:home:pledge:planBreak',
    'ieyasu:home:pledge:retreatSave',
    'ieyasu:home:nopledge:planKeep',
    'ieyasu:home:nopledge:planBreak',
    'ieyasu:home:nopledge:retreatSave',
];

describe('Version 11 の合戦は、同じ命令なら 1 刻みも同じ結果（基準 tests/fixtures/v11-baseline.json）', () => {
    const all = cases();
    if (WRITE) {
        it('基準を書く', async () => {
            const out: Record<string, unknown> = {};
            for (const c of all) out[c.name] = record(c);
            const fsName = 'node:fs';
            const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync(p: URL, text: string): void };
            fs.writeFileSync(FIXTURE_URL, JSON.stringify(out, null, 1) + '\n');
        });
        return;
    }
    const base = baselineJson as unknown as Record<string, ReturnType<typeof record>>;
    it('基準に全部の台本がある', () => {
        expect(Object.keys(base).sort()).toEqual(all.map((c) => c.name).sort());
    });
    it('Version 13 候補で作り直した基準は、プレイヤーが能力を使う台本だけ（能力を使わない台本は Version 11 の基準のまま）', () => {
        const allyUsed = (name: string) => {
            const used = (base[name]!.outcome as { abilitiesUsed?: Record<string, number> }).abilitiesUsed ?? {};
            return Object.keys(used).some((id) => id.startsWith('t_') || id.startsWith('a_'));
        };
        expect(all.filter((c) => allyUsed(c.name)).map((c) => c.name).sort()).toEqual([...REBASED_V13].sort());
    });
    for (const c of all) {
        it(c.name, () => {
            const b = base[c.name];
            expect(b).toBeDefined();
            const r = record(c);
            expect(r.outcome).toEqual(b.outcome);
            expect(r.snaps).toEqual(b.snaps);
            expect(r.eventCount).toBe(b.eventCount);
            expect(r.events).toBe(b.events);
        });
    }
});
