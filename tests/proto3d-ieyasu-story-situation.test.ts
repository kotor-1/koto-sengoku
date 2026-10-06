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
import { finishTalkIeyasu2, legalIeyasu2Choices, talkIeyasu2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { availableCh2Plans } from '../proto3d/src/campaign/ieyasu1570/chapter2/rules';
import { newIeyasuGame, talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import type { SituationView } from '../proto3d/src/story/types';
import { ch1BeforeBattle, ch1Cases, ch1Ending, ch2Aftermath, ch2Cases, ch2Muster, ch2Starts, checkBannedWords } from './proto3d-ieyasu-story-states';

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
                    // 戦わないだけの両家（△）は協力の欄に入れない（点検の指摘：協力している相手のように読めた）。協力する家は無いと書く
                    expect(v.allies.join(''), '協力の欄に △ を入れない').not.toMatch(/[△✕]/);
                    if (isChapter2(s) && s.chapter1.battle.result === 'victory') expect(v.allies).toEqual([`○ 村の衆（第一章で浪人を退けた。自ら${s.result ? '加わった' : '加わる'}）`]);
                    else expect(v.allies).toEqual(['協力する家は無い（織田家・浅井家とは戦わない）']);
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

describe('第二章 A の情勢：織田勢が撤収するわけ（ゲーム用の創作と書く・本隊と援軍を分ける・勝ちを前提にしない）', () => {
    it('地図に織田の本隊の陣と撤収の線。危機の文に、わけ・どの隊か・創作であること・援軍とは別の隊であること', () => {
        const A = CH2.filter((x) => x.state.policy === 'oda');
        expect(A.length).toBeGreaterThan(0);
        for (const x of A) {
            const v = ieyasuSituation(x.state, { from: 'explore' })!;
            expect(v.map.places.find((p) => p.id === 'oda_camp')?.name, x.name).toBe('織田の本隊');
            expect(v.map.routes.map((r) => r.id), x.name).toContain('withdraw.oda_main');
            const s = x.state as Ieyasu2State;
            if (s.phase === 'aftermath' || s.phase === 'ending') {
                // 戦後：後備え・小荷駄の撤収の線は、主目標を果たした（二隊が退き口から離れた）ときだけ
                expect(v.map.routes.some((r) => r.id === 'withdraw.oda_rear'), x.name).toBe(!!s.result?.primary?.achieved);
                continue;
            }
            expect(v.crisis, x.name).toContain('そのため織田の本隊は、近江の陣を引き払うと決めた（この撤収はゲーム用の創作）');
            expect(v.crisis, x.name).toContain('本隊の最後尾、後備え・小荷駄を浅井・朝倉が追う');
            expect(v.crisis, x.name).toContain('織田援軍とは別の隊');
            // 第一章の勝敗によらず同じ文（勝ちを前提にしない）
            expect(v.crisis, x.name).not.toMatch(/勝ち|勝利|勝った/);
        }
        // B・C には出さない
        for (const x of CH2.filter((y) => y.state.policy !== 'oda').slice(0, 40)) {
            const v = ieyasuSituation(x.state, { from: 'explore' })!;
            expect(v.map.places.some((p) => p.id === 'oda_camp'), x.name).toBe(false);
        }
    });
});

describe('協力の欄の言い方', () => {
    it('C（自領の防衛）：どの段階でも協力の欄に △（戦わないだけの相手）を入れない', () => {
        const all = [...ch1BeforeBattle().map((x) => x.state), ...CH1.map((c) => c.state), ...CH1.map((c) => ch1Ending(c.state)), ...CH2.map((x) => x.state)];
        let n = 0;
        for (const s of all) {
            if (s.policy !== 'home') continue;
            const v = ieyasuSituation(s, { from: 'explore' })!;
            expect(v.allies.join('・')).not.toMatch(/[△✕]/);
            expect(v.allies.length).toBe(1);
            n++;
        }
        expect(n).toBeGreaterThan(100);
    }, 60_000);
    it('第二章の支援の部隊：戦後・結末は「加わった」、合戦の前は「加わる」', () => {
        let after = 0;
        let before = 0;
        for (const { name, state } of CH2) {
            const s = state as Ieyasu2State;
            const allies = ieyasuSituation(s, { from: 'explore' })!.allies.join('・');
            // 支援の部隊（織田の鉄砲隊・浅井の道案内は「…が加わる／加わった」、村の衆は「自ら加わる／加わった」）
            if (s.result) {
                expect(allies, name).not.toMatch(/加わる/);
                if (s.result.support.length) {
                    expect(allies, name).toMatch(/加わった/);
                    after++;
                }
            } else if (allies.includes('加わ')) {
                expect(allies, name).toMatch(/加わる/);
                expect(allies, name).not.toMatch(/加わった/);
                before++;
            }
        }
        expect(after).toBeGreaterThan(5);
        expect(before).toBeGreaterThan(5);
    }, 60_000);
});

describe('模式図の置き場所', () => {
    it('国境の原（第一章の合戦の場所）は国境（浪人の一団）のすぐそば（地図の上でいちばん近い場所が国境）', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const v = ieyasuSituation(ch1BeforeBattle().find((x) => x.name === `muster.${p}`)!.state, { from: 'explore' })!;
            const f = v.map.places.find((x) => x.id === 'field1')!;
            const others = v.map.places.filter((x) => x.id !== 'field1');
            const nearest = [...others].sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0]!;
            expect(nearest.id).toBe('border');
            expect(Math.hypot(nearest.x - f.x, nearest.y - f.y)).toBeLessThanOrEqual(20);
        }
    });
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
        // 方針ごとの見込みの関係の線（点検の指摘：A と B の強調がほぼ同じだった）。その方針の線だけを強調し、ほかの方針の線は強調しない
        const route = (id: string) => v.map.routes.find((r) => r.id === id);
        const want: Record<string, { kind: string; side: string; to: string }> = {
            'opt.oda.asai': { kind: 'hostile', side: 'enemy', to: 'asai' },
            'opt.oda.asakura': { kind: 'hostile', side: 'enemy', to: 'asakura' },
            'opt.asai.asai': { kind: 'alliance', side: 'ally', to: 'asai' },
            'opt.asai.oda': { kind: 'hostile', side: 'enemy', to: 'oda' },
            'opt.home.border': { kind: 'hostile', side: 'enemy', to: 'border' },
        };
        for (const [id, w] of Object.entries(want)) expect(route(id), id).toMatchObject({ from: 'home', ...w });
        expect(route('rel.oda')).toMatchObject({ from: 'home', to: 'oda', kind: 'alliance', side: 'ally' });
        const lines = (o: { highlight: string[] }) => o.highlight.filter((id) => id.startsWith('opt.') || id.startsWith('rel.')).sort();
        expect(lines(a!)).toEqual(['opt.oda.asai', 'opt.oda.asakura', 'rel.oda']);
        expect(lines(b!)).toEqual(['opt.asai.asai', 'opt.asai.oda']);
        expect(lines(c!)).toEqual(['opt.home.border']);
        // B のタブでは、今の協力（○ 織田家）を強調しない（B を選ぶと織田方が敵になる線を強調する）
        expect(b!.highlight).not.toContain('oda');
        expect(b!.highlight).not.toContain('rel.oda');
        // 同じ相手への線は曲げて、重ねない（A と B の浅井への線・今の協力と B の織田への線）
        expect(route('opt.asai.asai')!.via?.length).toBeGreaterThan(0);
        expect(route('opt.asai.oda')!.via?.length).toBeGreaterThan(0);
        // 探索から開いたとき（タブが無い）は、見込みの線を出さない
        expect(ieyasuSituation(council, { from: 'explore' })!.map.routes.some((r) => r.id.startsWith('opt.'))).toBe(false);
        // 地図で見るだけ：関係の記号（場所の side）は方針を決める前の今の関係のまま
        expect(v.map.places.find((x) => x.id === 'oda')!.side).toBe('ally');
        expect(v.map.places.find((x) => x.id === 'asai')!.side).toBe('neutral');
        // 探索から開いたときはタブが無い
        expect(ieyasuSituation(council, { from: 'explore' })!.options).toBeUndefined();
        // 確かめの段（決める／考え直す）：決める方は選んだ方針を強調
        for (const p of ['oda', 'asai', 'home'] as const) {
            const pend = ch1BeforeBattle().find((x) => x.name === `council.pending.${p}`)!.state;
            const opts = talkIeyasu(pend, 'council').choices!.map((c) => ({ id: c.id, label: c.label }));
            const vv = ieyasuSituation(pend, { from: 'council', options: opts })!;
            expect(vv.options!.map((o) => o.id)).toEqual(['confirm_policy', 'reconsider']);
            expect(vv.options![0]!.text).toContain('決めると変えられない');
            // 決める方は、選んだ方針の見込みの線を強調する
            expect(vv.options![0]!.highlight.some((id) => id.startsWith(`opt.${p}.`))).toBe(true);
            expect(vv.options![0]!.highlight.some((id) => id.startsWith('opt.') && !id.startsWith(`opt.${p}.`))).toBe(false);
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
        // 負傷兵の元（見た目の数の前）：第一章で失った徳川の兵 − 補充で「待つ」を選んで戻った兵 ＋ 第二章で失った徳川の兵
        const ch1LostOf = (s: Ieyasu2State) => outcomeTroops(s.chapter1.battle).lost;
        const backOf = (s: Ieyasu2State) => (s.recovery?.choice === 'wait' ? Object.values(s.recovery.delta).reduce((n, x) => n + Math.max(0, x), 0) : 0);
        const ch2LostOf = (s: Ieyasu2State) => (s.result ? Object.values(s.result.lost).reduce((n, x) => n + (x ?? 0), 0) : 0);
        const expected = (s: Ieyasu2State) => visualCount(Math.max(0, ch1LostOf(s) - backOf(s)) + ch2LostOf(s), VISUAL_MAX.wounded);
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
            if (s.phase !== 'battle') expect(count(s, 'wounded'), name).toBe(expected(s));
        }
        // 同じ支度の状態から補充の答えを変えて比べる：待てば戻った分だけ減り、ほかの答え（守備隊から回す・今の兵で出る）では減らない。
        // 戦後は、補充の後の数に第二章で失った兵を足す
        let reduced = 0;
        let waited = 0;
        for (const c of CH2_STARTS.filter((x) => x.ch1.loss !== 'none')) {
            const start = count(c.state, 'wounded');
            // 第一章の損害が残る（第二章のはじめ）
            expect(start, c.name).toBe(visualCount(ch1LostOf(c.state), VISUAL_MAX.wounded));
            expect(start, c.name).toBeGreaterThan(0);
            for (const plan of availableCh2Plans(c.state)) {
                const m = ch2Muster(c.state, plan);
                expect(count(m, 'wounded'), c.name).toBe(start);
                const legal = legalIeyasu2Choices(m);
                for (const other of ['recovery_transfer', 'recovery_none'] as const) {
                    if (legal.includes(other)) expect(count(finishTalkIeyasu2(m, 'ishikawa', other), 'wounded'), `${c.name}.${plan}.${other}`).toBe(start);
                }
                if (!legal.includes('recovery_wait')) continue;
                const w = finishTalkIeyasu2(m, 'ishikawa', 'recovery_wait');
                const back = backOf(w);
                expect(back, c.name).toBeGreaterThan(0);
                waited++;
                const after = count(w, 'wounded');
                expect(after, c.name).toBe(visualCount(Math.max(0, ch1LostOf(c.state) - back), VISUAL_MAX.wounded));
                expect(after, c.name).toBeLessThanOrEqual(start);
                if (after < start) reduced++;
                // 戦後：補充の後の数に、第二章で失った兵を足す（失えば減らない）
                const a = ch2Aftermath(finishTalkIeyasu2(w, 'gate', 'depart'), 'retreat');
                expect(ch2LostOf(a), c.name).toBeGreaterThan(0);
                expect(count(a, 'wounded'), c.name).toBe(visualCount(Math.max(0, ch1LostOf(c.state) - back) + ch2LostOf(a), VISUAL_MAX.wounded));
                expect(count(a, 'wounded'), c.name).toBeGreaterThanOrEqual(after);
            }
        }
        // 見た目の数が実際に減った組み合わせがある（上限 12 に張り付く損害の大きい組み合わせでは、減っても見た目は同じことがある）
        expect(waited).toBeGreaterThan(10);
        expect(reduced).toBeGreaterThan(5);
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
