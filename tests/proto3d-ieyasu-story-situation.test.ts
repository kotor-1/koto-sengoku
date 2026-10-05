/**
 * 歴史分岐「元亀元年・家康」の情勢の画面の中身（story/situation.ts）と町の人々（story/ambient.ts）。直接状態変更のテスト
 * （状態は flow の関数を普通の順に呼び、合戦は確認用の偽の結果：tests/proto3d-ieyasu-story-states.ts）。
 *
 * - 情勢：いつ・今いる所・協力と敵対（記号と名前）・前の章（第二章）・危機・目的（物見をしなくても分かる。第二章で判断を決めた後は確定した条件の主目標）・
 *   模式図の地図（注記・線の端・強調）・物見の記録・見直し。軍議から開いたときは選択肢ごとの強調と説明（見るだけ）。
 *   出さないもの：伏兵・援軍の出る所・後詰め・敵の配置（地図に敵の部隊の場所を置かない）。
 * - 町の人々：第一章の始めは負傷兵 0／損害が大きいほど負傷兵が多い（上限あり）／援兵は recovered > 0 のときだけ・その旗／支度は出陣を待つ兵。
 * - 純粋さ：同じ状態から同じ中身。作っても状態は変わらない。
 */
import { describe, expect, it } from 'vitest';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuAmbient } from '../proto3d/src/campaign/ieyasu1570/story/ambient';
import { VISUAL_MAX, outcomeTroops, visualCount } from '../proto3d/src/campaign/ieyasu1570/story/counts';
import { MAP_NOTE } from '../proto3d/src/campaign/ieyasu1570/story/geo';
import { ieyasuScout, SCOUT_MARK_IDS } from '../proto3d/src/campaign/ieyasu1570/story/scout';
import { ieyasuSituation } from '../proto3d/src/campaign/ieyasu1570/story/situation';
import type { IeyasuAnyState, Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { isChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { talkIeyasu2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { newIeyasuGame, talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import type { SituationView } from '../proto3d/src/story/types';
import { ch1BeforeBattle, ch1Cases, ch1Ending, ch2Cases, ch2Starts, checkBannedWords } from './proto3d-ieyasu-story-states';

const CH1 = ch1Cases();
const CH2_STARTS = ch2Starts(CH1);
const CH2 = ch2Cases(CH2_STARTS.filter((c) => c.ch1.loss !== 'light'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function viewTexts(v: SituationView): string[] {
    return [
        v.title,
        v.when,
        v.where,
        ...v.allies,
        ...v.enemies,
        v.prev ?? '',
        v.crisis,
        v.objective,
        v.scoutHint ?? '',
        v.map.heading ?? '',
        v.map.note,
        ...v.map.places.flatMap((p) => [p.name, p.note ?? '']),
        ...v.map.routes.map((r) => r.label ?? ''),
        ...(v.options ?? []).flatMap((o) => [o.label, o.text]),
        ...v.scouted.flatMap((e) => [e.label, e.text]),
        ...v.replays.map((r) => r.title),
    ];
}

function checkView(v: SituationView, name: string): void {
    for (const k of ['title', 'when', 'where', 'crisis', 'objective'] as const) expect(v[k], `${name}：${k}`).toBeTruthy();
    expect(v.allies.length + v.enemies.length, name).toBeGreaterThan(0);
    expect(v.map.note).toBe(MAP_NOTE);
    expect(v.map.heading).toBeTruthy();
    const pids = new Set(v.map.places.map((p) => p.id));
    expect(pids.size, `${name}：場所の id が重なる`).toBe(v.map.places.length);
    const ids = new Set([...pids, ...v.map.routes.map((r) => r.id)]);
    for (const r of v.map.routes) expect(pids.has(r.from) && pids.has(r.to), `${name}：線 ${r.id}`).toBe(true);
    for (const id of v.map.highlight ?? []) expect(ids.has(id), `${name}：強調 ${id}`).toBe(true);
    for (const o of v.options ?? []) for (const id of o.highlight) expect(ids.has(id), `${name}：選択肢 ${o.id} の強調 ${id}`).toBe(true);
    // 関係は記号と名前で（色だけにしない）
    for (const a of [...v.allies, ...v.enemies]) if (!a.startsWith('まだ') && !a.startsWith('協力する家')) expect(a, name).toMatch(/^[◎○✕△？] /);
    for (const p of v.map.places) expect(['self', 'ally', 'enemy', 'neutral', 'unknown']).toContain(p.side);
    // 見直しは今の状態で作れる演出だけ
    expect(v.replays.length).toBeGreaterThan(0);
    // 出さないもの：伏兵・援軍の出る所・後詰め・敵の配置（敵の部隊の名前の場所を置かない）
    const all = viewTexts(v).join('\n');
    expect(all, name).not.toMatch(/伏兵|援軍の出る所|後詰め|出る所|秒ほどで|第一波|第二波|第三波/);
    for (const p of v.map.places) expect(p.id, name).not.toMatch(/^e_|^a_|^t_/);
}

describe('情勢の画面：どの状態でも作れ、地図と短い説明がそろう', () => {
    it('第一章（合戦の前・戦後・結末）', () => {
        for (const { name, state } of ch1BeforeBattle()) {
            const v = ieyasuSituation(state, { from: 'explore' })!;
            checkView(v, name);
            expect(v.prev).toBeNull();
            expect(v.when).toBe('元亀元年（1570年）');
            expect(v.where).toContain('徳川の城下（三河）');
        }
        for (const c of CH1) {
            checkView(ieyasuSituation(c.state, { from: 'explore' })!, c.name);
            checkView(ieyasuSituation(ch1Ending(c.state), { from: 'explore' })!, `${c.name}.ending`);
        }
    }, 60_000);
    it('第二章（前の章の結果・確定した条件の主目標）', () => {
        for (const { name, state } of CH2) {
            const v = ieyasuSituation(state, { from: 'explore' })!;
            checkView(v, name);
            expect(v.prev, name).toContain('第一章：');
            const s2 = state as Ieyasu2State;
            if (s2.plan && s2.terms && s2.phase !== 'aftermath' && s2.phase !== 'ending') expect(v.objective, name).toContain('主目標（軍議で確定）');
        }
    }, 60_000);
    it('関係：方針の前は「織田と協力してきた」まで。A 織田と協力・浅井と朝倉は敵対／B 浅井と協力・織田は敵対／C 両家と戦わない・浪人と敵対', () => {
        const v0 = ieyasuSituation(newIeyasuGame(), { from: 'explore' })!;
        expect(v0.allies).toEqual(['○ 織田家（これまで共に動いてきた）']);
        expect(v0.enemies.join('')).not.toContain('✕');
        const side = (v: SituationView, id: string) => v.map.places.find((p) => p.id === id)?.side;
        expect(side(v0, 'asai')).toBe('neutral');
        for (const p of ['oda', 'asai', 'home'] as const) {
            const st = CH1.find((c) => c.policy === p)!.state;
            for (const s of [st, CH2_STARTS.find((c) => c.state.policy === p)!.state] as IeyasuAnyState[]) {
                const v = ieyasuSituation(s, { from: 'explore' })!;
                if (p === 'oda') {
                    expect([side(v, 'oda'), side(v, 'asai'), side(v, 'asakura')]).toEqual(['ally', 'enemy', 'enemy']);
                    expect(v.allies.join('')).toContain('○ 織田家');
                    expect(v.enemies.join('')).toMatch(/✕ 浅井家.*✕ 朝倉家/);
                } else if (p === 'asai') {
                    expect([side(v, 'oda'), side(v, 'asai')]).toEqual(['enemy', 'ally']);
                    expect(v.allies.join('')).toContain('史実から分かれた道');
                    expect(v.enemies.join('')).toContain('✕ 織田家');
                } else {
                    expect([side(v, 'oda'), side(v, 'asai'), side(v, 'border')]).toEqual(['neutral', 'neutral', 'enemy']);
                    expect(v.enemies.join('')).toContain('✕ 浪人の一団');
                    expect(v.allies.join('')).toContain('△ 織田家（戦わない）');
                }
            }
        }
    });
    it('今回の目的は物見をしなくても分かる（物見の記録の有無で、目的・危機・協力と敵対は同じ）', () => {
        const samples = [...ch1BeforeBattle().map((x) => x.state), ...CH2.filter((x) => x.state.phase === 'explore' || x.state.phase === 'muster').slice(0, 40).map((x) => x.state)];
        for (const s of samples) {
            if (s.phase !== 'explore' && s.phase !== 'muster') continue;
            const ids = SCOUT_MARK_IDS[isChapter2(s) ? ({ oda: 'rear', asai: 'relief', home: 'village' } as const)[s.policy] : 'border'];
            const scouted = ieyasuScout(s, 'lookout', [...ids]);
            const a = ieyasuSituation(s, { from: 'explore' })!;
            const b = ieyasuSituation(scouted, { from: 'explore' })!;
            expect(b.objective).toBe(a.objective);
            expect(b.crisis).toBe(a.crisis);
            expect(b.allies).toEqual(a.allies);
            expect(b.enemies).toEqual(a.enemies);
            expect(a.scouted).toEqual([]);
            expect(a.scoutHint).toContain('任意');
            expect(b.scouted.map((e) => e.id)).toEqual([...ids]);
            expect(b.scoutHint).toBeUndefined();
            // 物見の場所が地図に入る
            for (const e of b.scouted) for (const p of e.places ?? []) expect(b.map.places.some((x) => x.id === p.id)).toBe(true);
        }
    });
    it('禁止の言葉が無い（史実・地名・信長・年月日）', () => {
        const all: string[] = [];
        for (const { state } of ch1BeforeBattle()) all.push(...viewTexts(ieyasuSituation(state, { from: 'explore' })!));
        for (const c of CH1) all.push(...viewTexts(ieyasuSituation(ch1Ending(c.state), { from: 'explore' })!));
        for (const { state } of CH2) all.push(...viewTexts(ieyasuSituation(state, { from: 'explore' })!));
        checkBannedWords(all.join('\n'));
    }, 60_000);
});

describe('軍議から開いたとき：選択肢ごとの強調と説明（見るだけ。決めない）', () => {
    it('第一章：3 つの方針のタブ。方針ごとに違う所を強調し、説明に B は「史実から分かれた道」・C は「宣戦ではない」', () => {
        const council = ch1BeforeBattle().find((x) => x.name === 'council')!.state;
        const options = talkIeyasu(council, 'council').choices!.map((c) => ({ id: c.id, label: c.label }));
        const before = clone(council);
        const v = ieyasuSituation(council, { from: 'council', options })!;
        expect(council).toEqual(before);
        expect(v.options!.map((o) => o.id)).toEqual(['policy_oda', 'policy_asai', 'policy_home']);
        const [a, b, c] = v.options!;
        expect(a!.highlight).toContain('oda');
        expect(b!.highlight).toContain('asai');
        expect(c!.highlight).toContain('border');
        expect(new Set(v.options!.map((o) => o.highlight.join(','))).size).toBe(3);
        expect(b!.text).toContain('史実から分かれた道');
        expect(c!.text).toContain('宣戦ではない');
        // 探索から開いたときはタブが無い
        expect(ieyasuSituation(council, { from: 'explore' })!.options).toBeUndefined();
        // 確かめの段（決める／考え直す）：決める方は選んだ方針を強調
        for (const p of ['oda', 'asai', 'home'] as const) {
            const pend = ch1BeforeBattle().find((x) => x.name === `council.pending.${p}`)!.state;
            const opts = talkIeyasu(pend, 'council').choices!.map((c) => ({ id: c.id, label: c.label }));
            const vv = ieyasuSituation(pend, { from: 'council', options: opts })!;
            expect(vv.options!.map((o) => o.id)).toEqual(['confirm_policy', 'reconsider']);
            expect(vv.options![0]!.text).toContain('決めると変えられない');
        }
    });
    it('第二章：選べる判断のタブ（確定する主目標の文・代償・物見の記録があれば「物見：」）', () => {
        let n = 0;
        for (const c of CH2_STARTS.filter((x) => x.ch1.loss !== 'light')) {
            const s = ieyasuScenario(null).finishTalk(c.state, 'tadakatsu', 'open_council') as Ieyasu2State;
            const opts = talkIeyasu2(s, 'council').choices!.map((x) => ({ id: x.id, label: x.label }));
            const v = ieyasuSituation(s, { from: 'council', options: opts })!;
            expect(v.options!.map((o) => o.id)).toEqual(opts.map((o) => o.id));
            for (const o of v.options!) {
                expect(o.text, c.name).toContain('主目標：');
                expect(o.highlight, c.name).toContain(({ oda: 'site_oda', asai: 'site_asai', home: 'site_home' } as const)[s.policy]);
                expect(o.text).not.toContain('物見：');
            }
            const scouted = ieyasuScout(s, 'lookout', ['rear.field', 'rear.neck', 'rear.hill', 'relief.field', 'relief.hill', 'relief.west', 'village.field', 'village.square', 'village.fence']);
            // 軍議の段では物見できない（記録は増えない）。支度の前の探索で記録した状態を作る
            expect(scouted).toBe(s);
            const explored = ieyasuScout(c.state, 'lookout', ['rear.neck', 'relief.west', 'village.square']);
            const s2 = ieyasuScenario(null).finishTalk(explored, 'tadakatsu', 'open_council') as Ieyasu2State;
            const v2 = ieyasuSituation(s2, { from: 'council', options: opts })!;
            for (const o of v2.options!) expect(o.text).toContain('物見：');
            n++;
        }
        expect(n).toBeGreaterThan(20);
    });
});

describe('町の人々（見た目だけ。保存の兵とは別）', () => {
    const count = (s: IeyasuAnyState, kind: string) => (ieyasuAmbient(s)?.groups ?? []).filter((g) => g.kind === kind).reduce((n, g) => n + g.count, 0);
    it('第一章の始めは負傷兵 0。支度は出陣を待つ兵。結末は無し', () => {
        expect(count(newIeyasuGame(), 'wounded')).toBe(0);
        expect(count(newIeyasuGame(), 'preparing')).toBe(0);
        for (const { name, state } of ch1BeforeBattle()) {
            expect(count(state, 'wounded'), name).toBe(0);
            expect(count(state, 'reinforcement'), name).toBe(0);
            if (state.phase === 'muster') expect(count(state, 'preparing'), name).toBeGreaterThan(0);
        }
        expect(ieyasuAmbient(ch1Ending(CH1[0]!.state))).toBeNull();
    });
    it('損害が大きいほど負傷兵が多い（上限あり）。援兵は兵が実際に戻ったときだけ、その旗', () => {
        for (const c of CH1) {
            const w = count(c.state, 'wounded');
            expect(w).toBeLessThanOrEqual(VISUAL_MAX.wounded);
            // 負傷兵は失った兵から（見た目の数。失った兵が無ければ 0）
            const lost = outcomeTroops(c.state.battle!).lost;
            expect(w, c.name).toBe(visualCount(lost, VISUAL_MAX.wounded));
            if (lost === 0) expect(w, c.name).toBe(0);
            if (c.loss === 'heavy') {
                const light = CH1.find((x) => x.name === c.name.replace(/heavy$/, 'light'))!;
                expect(w, c.name).toBeGreaterThan(count(light.state, 'wounded'));
            }
            const sup = c.state.support!;
            const r = (ieyasuAmbient(c.state)?.groups ?? []).filter((g) => g.kind === 'reinforcement');
            if (sup.recovered > 0) {
                expect(r.length, c.name).toBe(1);
                expect(r[0]!.mark).toBe(sup.from === 'oda' ? '織' : sup.from === 'asai' ? '浅' : '徳');
                expect(r[0]!.count).toBe(visualCount(sup.recovered, VISUAL_MAX.reinforcement));
            } else expect(r.length, c.name).toBe(0);
        }
    });
    it('第二章：第一章の損害が残り、補充で待てば戻った分だけ減る。戦後は第二章の損害も足す', () => {
        for (const { name, state } of CH2) {
            const s = state as Ieyasu2State;
            const g = ieyasuAmbient(s);
            if (s.phase === 'ending') {
                expect(g).toBeNull();
                continue;
            }
            expect(g, name).not.toBeNull();
            for (const x of g!.groups) expect(x.count).toBeGreaterThanOrEqual(0);
            if (s.phase === 'muster') expect(count(s, 'preparing'), name).toBeGreaterThan(0);
            if (s.phase !== 'battle') expect(count(s, 'reinforcement') > 0, name).toBe(s.chapter1.support.recovered > 0);
        }
    }, 60_000);
    it('純粋：同じ状態から同じ中身。作っても状態は変わらない（情勢・町の人々）', () => {
        const sc = ieyasuScenario(null);
        for (const { state } of [...ch1BeforeBattle(), ...CH2.slice(0, 50)]) {
            const before = clone(state);
            expect(ieyasuAmbient(state)).toEqual(ieyasuAmbient(clone(state)));
            expect(sc.ambient!(state)).toEqual(ieyasuAmbient(state));
            expect(ieyasuSituation(state, { from: 'explore' })).toEqual(ieyasuSituation(clone(state), { from: 'explore' }));
            expect(sc.situation!(state, { from: 'explore' })).toEqual(ieyasuSituation(state, { from: 'explore' }));
            expect(state).toEqual(before);
        }
    }, 60_000);
});
