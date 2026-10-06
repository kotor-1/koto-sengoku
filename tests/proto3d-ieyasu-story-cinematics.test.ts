/**
 * 歴史分岐「元亀元年・家康」の演出の台本（proto3d/src/campaign/ieyasu1570/story/cinematics.ts）。直接状態変更のテスト
 * （状態は flow の関数を普通の順に呼び、合戦は確認用の偽の結果で作る：tests/proto3d-ieyasu-story-states.ts）。
 *
 * - 長さ（章の導入 30〜45 秒・出陣と帰還 8〜15 秒）・情報の札（いつ・どこ・協力・前の結果・危機・判断）・字幕の長さと出す時間・場面のつながり。
 * - 矛盾を避ける決まり（設計 docs/story-rpg-design.md §2）を、3 方針 × 勝利・撤退・敗北 × 約束（守った・破った・斬り合う前に退いた・引き受けなかった）
 *   × 損害（無し・小・大）× 長政の負傷 × 援兵 0／>0 の組み合わせで：感謝は守ったときだけ／敵方の人物を味方に出さない・信長を出さない／
 *   帰る兵は残った兵から・負傷は失った兵から／援兵の到着は recovered > 0 だけ／C の第一章で守備隊は城門から出ない／長政が負傷なら第二章 B に出さない。
 * - 純粋さ：同じ状態から同じ台本。台本を作っても状態は変わらない。
 */
import { describe, expect, it } from 'vitest';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import { IEYASU_LOOKS } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuCinematic, ieyasuReplays, CINE_CAPTION_MAX, cineFirstShown } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { VISUAL_MAX, outcomeTroops, visualCount } from '../proto3d/src/campaign/ieyasu1570/story/counts';
import { MAP_NOTE } from '../proto3d/src/campaign/ieyasu1570/story/geo';
import type { IeyasuAnyState, Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { isChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import type { CineMapBeat, CineMoment, CineSpec, StageEvent } from '../proto3d/src/story/types';
import { CAPTION_CHARS_PER_SEC, CAPTION_MAX_CHARS, CAPTION_MIN_SEC, INFO_KEYS, PLACE_APPEAR_SEC, ROUTE_DRAW_SEC, frameAt, orderedBeats } from '../proto3d/src/story/timeline';
import { CH2_DEFEATS, RESULTS, ch1BeforeBattle, ch1Cases, ch1Ending, ch2Aftermath, ch2Battle, ch2Cases, ch2Muster, ch2Starts, checkBannedWords, type Ch1Case } from './proto3d-ieyasu-story-states';
import { ieyasuToBattle } from './proto3d-ieyasu-helpers';
import { createBattle } from '../proto3d/src/battle/sim';
import { pledgeResultModel, resultRows } from '../proto3d/src/battle/control';
import { ieyasuBattleSetup } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasu2BattleSetup } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { availableCh2Plans } from '../proto3d/src/campaign/ieyasu1570/chapter2/rules';
import { CH2_PLAN_LABELS } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';

const CH1 = ch1Cases();
const CH2_STARTS = ch2Starts(CH1);
/** 第二章は第一章の結末を間引いて進める（損害 none と heavy・約束 4 つ・結果 3 つ × 方針 3 つ） */
const CH2 = ch2Cases(CH2_STARTS.filter((c) => c.ch1.loss !== 'light'));

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const texts = (spec: CineSpec) => spec.captions.map((c) => `${c.speaker ?? ''}：${c.text}`).join('\n');
const events = (spec: CineSpec): StageEvent[] => spec.beats.flatMap((b) => (b.kind === 'stage' ? [b.event] : []));
const eventOf = <K extends StageEvent['id']>(spec: CineSpec, id: K) => events(spec).find((e): e is Extract<StageEvent, { id: K }> => e.id === id);

/** 台本の形の検査（どの台本にも当てはまる決まり） */
function checkShape(spec: CineSpec, name: string): void {
    const intro = spec.moment === 'ch1_intro' || spec.moment === 'ch2_intro';
    if (intro) {
        expect(spec.duration, `${name}：章の導入の長さ`).toBeGreaterThanOrEqual(30);
        expect(spec.duration, `${name}：章の導入の長さ`).toBeLessThanOrEqual(45);
    } else {
        expect(spec.duration, `${name}：出陣・帰還の長さ`).toBeGreaterThanOrEqual(8);
        expect(spec.duration, `${name}：出陣・帰還の長さ`).toBeLessThanOrEqual(15);
    }
    // 場面はすき間なく続き、最初は地図（見出し：いつ・どこ）
    expect(spec.beats.length).toBeGreaterThan(1);
    expect(spec.beats[0]!.start).toBe(0);
    for (let i = 1; i < spec.beats.length; i++) expect(spec.beats[i]!.start, name).toBeCloseTo(spec.beats[i - 1]!.end, 5);
    expect(spec.beats[spec.beats.length - 1]!.end).toBeCloseTo(spec.duration, 5);
    const first = spec.beats.find((b) => b.kind === 'map');
    expect(first && first.kind === 'map' && first.scene.heading, `${name}：地図の見出し`).toBeTruthy();
    // 字幕：短く（30 字まで）、出す時間は文字数 ÷ 8 秒と 2.5 秒の大きい方以上、重ならず、長さの中
    let prevEnd = 0;
    for (const c of spec.captions) {
        const n = [...c.text].length;
        expect(n, `${name}：字幕「${c.text}」が長い`).toBeLessThanOrEqual(CINE_CAPTION_MAX);
        expect(n).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
        expect(c.end - c.start + 1e-6, `${name}：字幕「${c.text}」の時間`).toBeGreaterThanOrEqual(Math.max(CAPTION_MIN_SEC, n / CAPTION_CHARS_PER_SEC));
        expect(c.start + 1e-6).toBeGreaterThanOrEqual(prevEnd);
        expect(c.end).toBeLessThanOrEqual(spec.duration + 1e-6);
        prevEnd = c.end;
    }
    // 字幕は始めから終わりまで切れ目なく（長文の自動送りではなく、場面ごとの短い字幕）
    expect(spec.captions[0]!.start).toBe(0);
    expect(prevEnd).toBeCloseTo(spec.duration, 5);
    // 情報の札の時刻は長さの中
    for (const k of Object.keys(spec.info) as (keyof CineSpec['info'])[]) {
        expect(INFO_KEYS).toContain(k);
        expect(spec.info[k]!).toBeLessThanOrEqual(spec.duration);
    }
    // 地図：模式図の注記・現れる時刻と強調は場面の中の場所・線を指す・線の両端の場所がある
    for (const b of spec.beats) {
        if (b.kind !== 'map') continue;
        expect(b.scene.note).toBe(MAP_NOTE);
        const ids = new Set([...b.scene.places.map((p) => p.id), ...b.scene.routes.map((r) => r.id)]);
        const pids = new Set(b.scene.places.map((p) => p.id));
        for (const r of b.scene.routes) expect(pids.has(r.from) && pids.has(r.to), `${name}：線 ${r.id} の端`).toBe(true);
        for (const id of Object.keys(b.appear ?? {})) expect(ids.has(id), `${name}：現れる ${id}`).toBe(true);
        for (const h of b.highlights ?? []) for (const id of h.ids) expect(ids.has(id), `${name}：強調 ${id}`).toBe(true);
        for (const p of b.scene.places) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(100);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(100);
        }
    }
    // 3D の出来事の人数は見た目だけ（上限の中・負でない）
    for (const e of events(spec)) {
        if ('count' in e) expect(e.count).toBeGreaterThanOrEqual(0);
        if (e.id === 'column_depart' || e.id === 'column_return') expect(e.count).toBeLessThanOrEqual(VISUAL_MAX.column);
        if (e.id === 'wounded_rest') expect(e.count).toBeLessThanOrEqual(VISUAL_MAX.wounded);
        if (e.id === 'column_return') expect(e.wounded).toBeLessThanOrEqual(e.count);
    }
}

/** 台本の文（字幕・題・見出し・場所と線の名前・出来事の名前）をまとめる */
function cineTexts(spec: CineSpec): string[] {
    const out = [spec.title, ...spec.captions.flatMap((c) => [c.speaker ?? '', c.text])];
    for (const b of spec.beats) {
        if (b.kind === 'map') out.push(b.scene.heading ?? '', b.scene.note, ...b.scene.places.flatMap((p) => [p.name, p.note ?? '']), ...b.scene.routes.map((r) => r.label ?? ''));
        else out.push(JSON.stringify(b.event));
    }
    return out;
}

const MOMENTS: readonly CineMoment[] = ['ch1_intro', 'ch2_intro', 'departure', 'return'];
function allSpecs(s: IeyasuAnyState): CineSpec[] {
    return MOMENTS.map((m) => ieyasuCinematic(s, m)).filter((x): x is CineSpec => !!x);
}

describe('第一章の導入', () => {
    const spec = ieyasuCinematic(newIeyasuGame(), 'ch1_intro')!;
    it('30〜45 秒。いつ・どこ・協力・危機・判断の札がすべて出る（前の章は無い）', () => {
        checkShape(spec, 'ch1_intro');
        for (const k of ['when', 'where', 'ally', 'crisis', 'decide'] as const) expect(spec.info[k], k).toBeDefined();
        expect(spec.info.prev).toBeUndefined();
    });
    it('地図：1570 年・徳川の城下（三河）・近江の対立・国境の浪人。3D：両家の使者（今の見た目の鍵）。軍議で 3 つの道', () => {
        const all = texts(spec);
        expect(all).toContain('元亀元年（1570年）');
        // 最初の字幕で、自分が徳川家康だと分かる（点検の指摘）。場所は見出し「徳川の城下（三河）」と同じ（城・町の名前は出さない）
        expect(spec.captions[0]!.text).toBe('元亀元年（1570年）。三河、徳川家康の城下。');
        const first = spec.beats[0]!;
        expect(first.kind === 'map' && first.scene.heading).toBe('元亀元年（1570年）・徳川の城下（三河）');
        // A は今までの道（方針の名前「織田との協力を続ける」の言い方）
        expect(all).toContain('A：織田との協力を続け、浅井・朝倉と戦う。');
        expect(all).toContain('近江で、織田と浅井・朝倉が敵味方に分かれた');
        expect(all).toContain('浪人');
        expect(all).toMatch(/A：.*\n.*B：.*史実から分かれた道.*\n.*C：/);
        const ev = eventOf(spec, 'envoys_arrive')!;
        expect(ev.envoys).toEqual([
            { look: IEYASU_LOOKS.oda_envoy, name: '織田家の使者' },
            { look: IEYASU_LOOKS.asai_envoy, name: '浅井家の使者' },
        ]);
    });
    it('どの状態から作っても同じ（見直し：第二章からも見られる）', () => {
        for (const c of [CH1[0]!, CH1[40]!]) expect(ieyasuCinematic(c.state, 'ch1_intro')).toEqual(spec);
        expect(ieyasuCinematic(CH2_STARTS[5]!.state, 'ch1_intro')).toEqual(spec);
    });
});

describe('どの組み合わせでも台本の形が決まりどおり（長さ・札・字幕・地図）', () => {
    it('第一章の合戦の前・戦後・結末', () => {
        for (const { name, state } of ch1BeforeBattle()) for (const sp of allSpecs(state)) checkShape(sp, `${name}.${sp.moment}`);
        for (const c of CH1) {
            for (const sp of allSpecs(c.state)) checkShape(sp, `${c.name}.${sp.moment}`);
            for (const sp of allSpecs(ch1Ending(c.state))) checkShape(sp, `${c.name}.ending.${sp.moment}`);
        }
    }, 60_000);
    it('第二章（移行はすべての札が出る）', () => {
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            checkShape(sp, c.name);
            for (const k of INFO_KEYS) expect(sp.info[k], `${c.name}：${k}`).toBeDefined();
        }
        for (const { name, state } of CH2) for (const sp of allSpecs(state)) checkShape(sp, `${name}.${sp.moment}`);
    }, 60_000);
    it('禁止の言葉が無い（史実・地名・信長・年月日）', () => {
        const all: string[] = [];
        for (const { state } of ch1BeforeBattle()) for (const sp of allSpecs(state)) all.push(...cineTexts(sp));
        for (const c of CH1) for (const sp of allSpecs(ch1Ending(c.state))) all.push(...cineTexts(sp));
        for (const { state } of CH2) for (const sp of allSpecs(state)) all.push(...cineTexts(sp));
        expect(all.length).toBeGreaterThan(5000);
        checkBannedWords(all.join('\n'));
    }, 60_000);
});

/**
 * 地図の出方（frameAt で確かめる。点検の指摘：後の字幕で現れる場所・線が前の場面の頭から出ていて、場面の切り替わりで一度消えて引き直されていた）：
 * - 字幕の show で現れる物は、その時刻（cineFirstShown）より前には、どの地図の場面でも出ていない（隠れている）。
 * - 一度出た物は、後の地図の場面の頭で消えない（その場面にある限り、頭から出ている）。現れ始めたら、現れる時間の後は出ている。
 * - どの字幕の show にも無い物（背景の場所）は、地図の場面の頭から出ている。線は両端の場所より先に出ない。
 * 動きを減らすとき（reduced）も同じ（現れる時刻は同じで、すぐ出る）。
 */
function checkAppearance(spec: CineSpec, name: string): number {
    const shown = cineFirstShown(spec);
    expect(shown, `${name}：現れる時刻`).toBeDefined();
    const beats = orderedBeats(spec);
    let checked = 0;
    for (const b of beats) {
        if (b.kind !== 'map') continue;
        const mb = b as CineMapBeat;
        const ids = [...mb.scene.places.map((p) => ({ id: p.id, route: false })), ...mb.scene.routes.map((r) => ({ id: r.id, route: true }))];
        // 線は両端の場所より先に出ない
        for (const r of mb.scene.routes) {
            const tr = shown!.get(r.id) ?? -Infinity;
            for (const end of [r.from, r.to]) expect(tr, `${name}：線 ${r.id} が端 ${end} より先に出る`).toBeGreaterThanOrEqual((shown!.get(end) ?? -Infinity) - 1e-6);
        }
        // 調べる時刻：場面の頭と終わりの手前・字幕の切り替わりの前後・現れる時刻の前後
        const ts = new Set<number>([b.start + 0.01, b.end - 0.01]);
        for (const c of spec.captions) if (c.start > b.start && c.start < b.end) ts.add(c.start - 0.01).add(c.start + 0.01);
        for (const { id, route } of ids) {
            const at = shown!.get(id);
            if (at === undefined || at < b.start || at >= b.end) continue;
            ts.add(at - 0.01);
            ts.add(at + (route ? ROUTE_DRAW_SEC : PLACE_APPEAR_SEC) + 0.01);
        }
        for (const t of ts) {
            if (t < b.start || t >= b.end) continue;
            for (const reduced of [false, true]) {
                const f = frameAt(spec, t, reduced, beats);
                expect(f.beat, `${name}：t=${t}`).toBe(b);
                for (const { id, route } of ids) {
                    const st = (route ? f.map!.routes : f.map!.places)[id]!.state;
                    const at = shown!.get(id);
                    if (at !== undefined && t < at - 1e-6) expect(st, `${name}：${id} は ${at} 秒に現れる（t=${t.toFixed(2)} で出ている）`).toBe('hidden');
                    else if (at === undefined || at < b.start) expect(st, `${name}：${id} は前から出ている（t=${t.toFixed(2)} の場面 ${b.start} の中で消えた）`).toBe('shown');
                    else if (reduced || t >= at + (route ? ROUTE_DRAW_SEC : PLACE_APPEAR_SEC)) expect(st, `${name}：${id}（t=${t.toFixed(2)}）`).toBe('shown');
                    else expect(st, `${name}：${id}（t=${t.toFixed(2)}）`).not.toBe('hidden');
                    checked++;
                }
            }
        }
    }
    // 字幕の show で現れる時刻は、その物のある地図の場面の中（場面の外の時刻を指さない）
    for (const [id, at] of shown!) {
        const inBeat = beats.some((b) => b.kind === 'map' && at >= b.start && at < b.end && [...b.scene.places, ...b.scene.routes].some((x) => x.id === id));
        expect(inBeat, `${name}：${id} の現れる時刻 ${at}`).toBe(true);
    }
    return checked;
}

describe('地図の出方：字幕より先に出ない・場面の切り替わりで消えない（frameAt）', () => {
    it('すべての組み合わせ（第一章の合戦の前・戦後・結末、第二章の移行・支度・出陣・戦後）', () => {
        const uniq = new Map<string, { spec: CineSpec; name: string }>();
        const add = (s: IeyasuAnyState, name: string) => {
            for (const sp of allSpecs(s)) {
                const k = JSON.stringify(sp);
                if (!uniq.has(k)) uniq.set(k, { spec: sp, name: `${name}.${sp.moment}` });
            }
        };
        for (const { name, state } of ch1BeforeBattle()) add(state, name);
        for (const c of CH1) {
            add(c.state, c.name);
            add(ch1Ending(c.state), `${c.name}.ending`);
        }
        for (const c of CH2_STARTS) add(c.state, c.name);
        for (const { name, state } of CH2) add(state, name);
        let n = 0;
        const moments = new Set<string>();
        for (const { spec, name } of uniq.values()) {
            n += checkAppearance(spec, name);
            moments.add(spec.moment);
        }
        expect([...moments].sort()).toEqual(['ch1_intro', 'ch2_intro', 'departure', 'return']);
        expect(uniq.size).toBeGreaterThan(100);
        expect(n).toBeGreaterThan(10000);
    }, 120_000);
    it('第一章の導入：使いと協力の線は「徳川は、これまで…」「使者が来た」の字幕まで出ない。国境の原は浪人の字幕では出さず、判断の場面で「どの道でも国境の原で戦う」と出す', () => {
        const spec = ieyasuCinematic(newIeyasuGame(), 'ch1_intro')!;
        const cap = (re: RegExp) => spec.captions.find((c) => re.test(c.text))!;
        const ronin = cap(/浪人の一団が村を荒らしている/);
        const ally = cap(/これまで織田と共に動いてきた/);
        const envoy = cap(/同じ日に使者が来た/);
        const where = cap(/どの道でも、戦うのは国境の原/);
        const st = (t: number, id: string) => {
            const f = frameAt(spec, t, false);
            return f.map ? (f.map.places[id] ?? f.map.routes[id])?.state ?? 'absent' : 'stage';
        };
        for (const t of [0.05, 4, ronin.start + 0.5, ally.start - 0.05]) for (const id of ['rel.oda', 'envoy.oda', 'envoy.asai']) expect(st(t, id), `t=${t} ${id}`).toBe('hidden');
        expect(st(ally.start + 2, 'rel.oda')).toBe('shown');
        expect(st(envoy.start - 0.05, 'envoy.oda')).toBe('hidden');
        expect(st(envoy.start + 2, 'envoy.oda')).toBe('shown');
        // 国境の原：浪人の字幕・使いの字幕の間は出ない。判断の場面の「どの道でも」の字幕で現れ、その間は強調
        for (const t of [ronin.start + 0.5, ronin.end - 0.05, envoy.start + 1, where.start - 0.05]) expect(['hidden', 'stage']).toContain(st(t, 'field1'));
        expect(st(where.start + 1, 'field1')).toBe('shown');
        expect(frameAt(spec, where.start + 1, false).map!.highlight).toContain('field1');
        expect(st(ronin.start + 1, 'border')).toBe('shown');
        // B：浅井と組み、織田方と戦うと分かる字幕（強調に織田家も）
        const b = cap(/^B：/);
        expect(b.text).toMatch(/浅井と組み、織田方の一隊と戦う/);
        expect(b.text).toContain('史実から分かれた道');
        const hl = frameAt(spec, b.start + 0.5, false).map!.highlight;
        expect(hl).toContain('asai');
        expect(hl).toContain('oda');
    });
    it('第二章の移行：危機の場所・脅かす向き・出陣の進路・関係の線は、それぞれの字幕まで出ず、出た後の地図の場面では頭から出ている', () => {
        for (const c of CH2_STARTS.filter((x) => x.ch1.loss !== 'light')) {
            const spec = ieyasuCinematic(c.state, 'ch2_intro')!;
            const p = c.state.policy;
            const site = ({ oda: 'site_oda', asai: 'site_asai', home: 'site_home' } as const)[p];
            const maps = orderedBeats(spec).filter((b): b is CineMapBeat => b.kind === 'map');
            // 最初の地図の場面の頭：城下だけ（ほかの関係の線・危機・進路は出ていない）
            const f0 = frameAt(spec, 0.05, false).map!;
            for (const id of [site, `threat.${p}`, `march.${site}`, ...Object.keys(f0.routes)]) expect((f0.places[id] ?? f0.routes[id])!.state, `${c.name}：${id}`).toBe('hidden');
            // 最後の地図の場面の頭：全部出ている（消えて引き直さない）
            const last = maps[maps.length - 1]!;
            const fl = frameAt(spec, last.start + 0.01, false).map!;
            for (const id of [site, `threat.${p}`, 'home', 'field1']) expect((fl.places[id] ?? fl.routes[id])!.state, `${c.name}：${id}`).toBe('shown');
            expect(fl.routes[`march.${site}`]!.state).toBe('hidden');
            expect(frameAt(spec, last.start + 0.3 + ROUTE_DRAW_SEC + 0.01, false).map!.routes[`march.${site}`]!.state).toBe('shown');
        }
    });
});

describe('流す時が無ければ null（状態に無いことを見せない）', () => {
    it('第一章の状態に第二章への移行は無い。出陣の前に出陣・帰還は無い。合戦の前に帰還は無い', () => {
        for (const { name, state } of ch1BeforeBattle()) {
            expect(ieyasuCinematic(state, 'ch2_intro'), name).toBeNull();
            expect(ieyasuCinematic(state, 'return'), name).toBeNull();
            expect(ieyasuCinematic(state, 'departure') !== null, name).toBe(state.phase === 'battle');
        }
        for (const c of CH2_STARTS) {
            expect(ieyasuCinematic(c.state, 'departure')).toBeNull();
            expect(ieyasuCinematic(c.state, 'return')).toBeNull();
        }
    });
    it('見直しの一覧：今の章の導入（第二章は第一章の導入も）。戦後は直前の合戦の出陣・帰還', () => {
        expect(ieyasuReplays(newIeyasuGame()).map((r) => r.moment)).toEqual(['ch1_intro']);
        expect(ieyasuReplays(CH1[0]!.state).map((r) => r.moment)).toEqual(['ch1_intro', 'departure', 'return']);
        expect(ieyasuReplays(CH2_STARTS[0]!.state).map((r) => r.moment)).toEqual(['ch2_intro', 'ch1_intro']);
        const after = CH2.find((x) => x.state.phase === 'aftermath')!.state;
        expect(ieyasuReplays(after).map((r) => r.moment)).toEqual(['ch2_intro', 'ch1_intro', 'departure', 'return']);
        for (const r of ieyasuReplays(after)) expect(r.title.length).toBeGreaterThan(1);
    });
});

describe('矛盾を避ける決まり', () => {
    const THANKS = /守っていただいた|ご恩|感謝|かたじけ|礼を/;
    it('感謝の言葉は約束を守ったときだけ（破った・引き受けなかったときは、使者は感謝しない）', () => {
        let kept = 0;
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            const said = sp.captions.filter((x) => x.speaker).map((x) => x.text).join('\n');
            const pl = c.state.chapter1.pledge.result;
            if (pl !== 'kept') expect(said, c.name).not.toMatch(THANKS);
            if (pl === 'kept' && c.state.policy !== 'home') {
                expect(said, c.name).toMatch(/守っていただいた/);
                kept++;
            }
            // 約束の結果の 1 文：守った／果たせなかった（斬り合う前に退いた）／引き受けなかった
            const all = texts(sp);
            if (pl === 'kept') expect(all).toContain('約束どおり');
            if (pl === 'declined') expect(all).toContain('引き受けなかった');
            if (pl === 'broken') expect(all).toContain(c.ch1.pledge === 'unfought' ? '刃を交える前に兵を引き' : '約束は、果たせなかった');
        }
        expect(kept).toBeGreaterThan(10);
    });
    it('敵方の人物を味方に出さない・信長を出さない（A に長政は出ない／B の味方に織田は出ない／C に両家の部隊は出ない）', () => {
        const check = (s: IeyasuAnyState, name: string) => {
            for (const sp of allSpecs(s)) {
                if (sp.moment === 'ch1_intro') continue;
                const all = cineTexts(sp).join('\n');
                expect(all, name).not.toContain('信長');
                const policy = isChapter2(s) ? s.policy : s.policy;
                for (const e of events(sp)) {
                    const who = 'name' in e ? e.name : 'envoys' in e ? e.envoys.map((x) => x.name).join('・') : '';
                    if (policy === 'oda') expect(who, `${name}.${sp.id}`).not.toMatch(/浅井|朝倉|長政/);
                    if (policy === 'asai') expect(who, `${name}.${sp.id}`).not.toMatch(/織田/);
                    if (policy === 'home') expect(who, `${name}.${sp.id}`).not.toMatch(/織田|浅井/);
                    if (e.id === 'reinforcement_arrive') expect(e.mark).toBe(policy === 'oda' ? '織' : policy === 'asai' ? '浅' : '徳');
                }
                if (policy === 'oda' && isChapter2(s)) expect(all, name).not.toContain('長政');
            }
        };
        for (const c of CH1) check(ch1Ending(c.state), c.name);
        for (const { name, state } of CH2) check(state, name);
    }, 60_000);
    it('長政が負傷なら、第二章 B に長政を出さない（丘にいるのは浅井勢の後備え）', () => {
        let wounded = 0;
        for (const { name, state } of CH2) {
            if (state.policy !== 'asai') continue;
            if (state.characters.nagamasa !== 'wounded' || state.chapter1.characters.nagamasa !== 'wounded') continue;
            wounded++;
            for (const sp of allSpecs(state)) {
                if (sp.moment === 'ch1_intro') continue;
                // 第一章の振り返り（約束の対象の名前「浅井長政隊」）は第一章の出来事なので除き、第二章の今の場面（関係の行より後の字幕と 3D の出来事）を見る
                const now = sp.moment === 'ch2_intro' ? sp.captions.filter((c) => c.start >= sp.info.ally!) : sp.captions;
                const all = [...now.map((c) => `${c.speaker ?? ''}${c.text}`), ...events(sp).map((e) => JSON.stringify(e))].join('\n');
                expect(all, `${name}.${sp.moment}`).not.toContain('長政');
                if (sp.moment === 'ch2_intro') expect(all).toContain('浅井勢の後備え');
            }
        }
        expect(wounded).toBeGreaterThan(3);
    }, 60_000);
    it('援兵の到着は第一章で兵が実際に戻ったとき（recovered > 0）だけ。0 なら出さない。忠勝の約束の援兵は守備隊（徳）', () => {
        let zero = 0;
        let some = 0;
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            const ev = eventOf(sp, 'reinforcement_arrive');
            const sup = c.state.chapter1.support;
            if (sup.recovered > 0) {
                some++;
                expect(ev, c.name).toBeDefined();
                expect(ev!.count).toBe(visualCount(sup.recovered, VISUAL_MAX.reinforcement));
                if (sup.from === 'tadakatsu') expect(ev!.name).toContain('守備隊');
            } else {
                if (sup.reinforcement) zero++;
                expect(ev, c.name).toBeUndefined();
                expect(texts(sp), c.name).not.toMatch(/援兵.*着いた|加わった/);
            }
        }
        expect(zero).toBeGreaterThan(0);
        expect(some).toBeGreaterThan(0);
    });
    it('帰る兵は残った兵から・負傷は失った兵から（損害が大きいと帰る兵が少なく、負傷が多い。損害を無傷に見せない）', () => {
        const byKey = new Map<string, Ch1Case>(CH1.map((c) => [c.name, c]));
        let compared = 0;
        for (const c of CH1) {
            const sp = ieyasuCinematic(c.state, 'return')!;
            const ev = eventOf(sp, 'column_return')!;
            const t = outcomeTroops(c.state.battle!);
            expect(ev.count, c.name).toBe(visualCount(t.left, VISUAL_MAX.column));
            expect(ev.victory).toBe(c.result === 'victory');
            if (t.lost >= 25) expect(ev.wounded, c.name).toBeGreaterThan(0);
            if (t.lost === 0) expect(ev.wounded).toBe(0);
            if (c.loss === 'heavy') {
                const light = byKey.get(c.name.replace(/heavy$/, 'light'))!;
                const lev = eventOf(ieyasuCinematic(light.state, 'return')!, 'column_return')!;
                // 帰る人数は少なく、そのうち負傷して見える人の割合は大きい（負傷は帰る人数のうちの数）
                expect(ev.count, c.name).toBeLessThan(lev.count);
                expect(ev.wounded / ev.count, c.name).toBeGreaterThan(lev.wounded / lev.count);
                expect(texts(sp)).toMatch(/のうち、.* を失った/);
                compared++;
            }
        }
        expect(compared).toBe(36);
        // 第二章の帰還も、記録の残った兵から
        for (const { name, state } of CH2) {
            if (state.phase !== 'aftermath') continue;
            const s2 = state as Ieyasu2State;
            const ev = eventOf(ieyasuCinematic(s2, 'return')!, 'column_return')!;
            const out = Object.values(s2.result!.sortieTroops).reduce((n, x) => n + (x ?? 0), 0);
            const lost = Object.values(s2.result!.lost).reduce((n, x) => n + (x ?? 0), 0);
            expect(ev.count, name).toBe(visualCount(out - lost, VISUAL_MAX.column));
            if (lost >= 25) expect(ev.wounded, name).toBeGreaterThan(0);
        }
    }, 60_000);
    it('敗北の言葉は理由に合わせる（本陣が崩れていないのに「本陣は崩れた」と言わない）', () => {
        for (const { name, state } of CH2) {
            if (state.phase !== 'aftermath' || state.battle?.result !== 'defeat') continue;
            const all = texts(ieyasuCinematic(state, 'return')!);
            const hq = state.battle.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin)!;
            const routed = state.battle.reason === 'ally_hq_routed' || hq.status === 'routed' || hq.status === 'destroyed';
            if (!routed) expect(all, name).not.toContain('本陣は崩れた');
            else expect(all, name).toContain('本陣は崩れた');
        }
    }, 60_000);
    it('C の第一章で、岡崎の守備隊は国境の砦にいて城門から出陣しない（隊列は本陣・忠勝隊・弓隊の兵）', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const b = ch1BeforeBattle().find((x) => x.name === `battle.${p}.accept`)!.state;
            const sp = ieyasuCinematic(b, 'departure')!;
            const ev = eventOf(sp, 'column_depart')!;
            const gate = Math.max(50, b.troops.honjin) + b.troops.tadakatsu + b.troops.yumi;
            expect(ev.count).toBe(visualCount(gate, VISUAL_MAX.column));
            if (p === 'home') {
                // 支度の文（国境の砦の守備隊が、浪人どもに囲まれかけております）・情勢の危機と同じ言い方（「待っている」では危機が弱まる）
                expect(texts(sp)).toContain('岡崎の守備隊は、国境の砦で囲まれかけている');
                expect(texts(sp)).not.toContain('守備隊も出陣');
            }
            // 支援・味方の部隊は戦場にいる（城下から出ない）
            if (p === 'oda') expect(texts(sp)).toContain('織田援軍は、先に戦場の右前へ出ている');
            if (p === 'asai') expect(texts(sp)).toContain('浅井長政隊は、先に戦場の左前へ出ている');
        }
    });
    it('第二章の出陣は実際に出陣する部隊から（守備隊が出るときだけ「城は空になる」）。支援の部隊は戦場で加わる', () => {
        for (const { name, state } of CH2) {
            if (state.phase !== 'battle') continue;
            const sp = ieyasuCinematic(state, 'departure')!;
            const reserveOut = (state as Ieyasu2State).plan === 'commit' && state.troops.reserve >= 40;
            expect(texts(sp).includes('城は空になる'), name).toBe(reserveOut);
            expect(texts(sp)).not.toMatch(/城下から.*加わる/);
        }
    }, 60_000);
});

/**
 * 帰還の字幕と、直前の結果の画面（battle/control.ts の resultRows・pledgeResultModel。本物の合戦の状態 createBattle を作って呼ぶ）が食い違わない
 * （点検の blocker：撤退の結果の画面は「味方の失った兵 23」「織田援軍 400 → 377」なのに、帰還が「兵を失わずに戻った。」だった）：
 * - 味方全体（徳川・援軍・味方の家の部隊）で損失があれば、「兵を失わずに戻った」（主語の無い無傷の言い方）を出さない。
 * - 字幕の失った兵（徳川の数＋ほかの味方の数）の合計は、結果の画面の「味方の失った兵」と同じ。徳川の数は徳川の部隊の行の合計と同じ。
 * - 約束の行は結果の画面の約束の欄と同じ言葉（守った／守れなかった／斬り合う前に退いた）。引き受けなかったとき・約束の無い第二章は出さない。
 */
describe('帰還の字幕は結果の画面と合う（損失の主語と数・約束の行）', () => {
    const num = (x: string) => Number(x.replace(/,/g, ''));
    const TOKUGAWA_IDS = new Set<string>(Object.values(IEYASU_UNIT_IDS));
    /** 帰還の字幕から、徳川の失った兵とほかの味方の失った兵を読む（字幕の言い方の決まりも確かめる） */
    function lossesIn(sp: CineSpec, name: string): { tokugawa: number; others: { name: string; lost: number }[]; bare: boolean } {
        const stage = sp.beats.find((b) => b.kind === 'stage')!;
        const caps = sp.captions.filter((c) => c.start >= stage.start - 1e-6).slice(1);
        let tokugawa = 0;
        const others: { name: string; lost: number }[] = [];
        let bare = false;
        for (const c of caps) {
            let m: RegExpMatchArray | null;
            if (c.text === '兵を失わずに戻った。') bare = true;
            else if ((m = c.text.match(/^徳川の兵 ([\d,]+) のうち、([\d,]+) を失った。$/))) tokugawa = num(m[2]!);
            else if ((m = c.text.match(/^徳川の兵の多くは戻った（失った兵 ([\d,]+)）。$/))) tokugawa = num(m[1]!);
            else if ((m = c.text.match(/^徳川の兵は失わずに戻った（(.+)は ([\d,]+) を失った）。$/))) others.push({ name: m[1]!, lost: num(m[2]!) });
            else if ((m = c.text.match(/^(.+)は ([\d,]+) を失った。$/))) others.push({ name: m[1]!, lost: num(m[2]!) });
            else if (c.text !== '徳川の兵は失わずに戻った。') throw new Error(`${name}：帰還の損失の字幕「${c.text}」が決まりの形でない`);
        }
        return { tokugawa, others, bare };
    }
    it('第一章：3 方針 × 勝敗 × 約束 × 損害のすべて（結果の画面の数・約束の欄と比べる）', () => {
        let alliesOnly = 0;
        let both = 0;
        const pledgeSeen = new Set<string>();
        for (const c of CH1) {
            const bs = createBattle(ieyasuBattleSetup(ieyasuToBattle(c.policy, c.pledge === 'declined' ? 'decline' : 'accept')));
            const o = c.state.battle!;
            const rows = resultRows(bs, o);
            for (const s of [c.state, ch1Ending(c.state)]) {
                const sp = ieyasuCinematic(s, 'return')!;
                const got = lossesIn(sp, c.name);
                // 味方全体で損失があれば、主語の無い「兵を失わずに戻った」を出さない
                expect(got.bare, `${c.name}：味方の失った兵 ${rows.lost.ally}`).toBe(rows.lost.ally === 0);
                // 数は結果の画面と同じ（合計＝味方の失った兵。徳川の数＝徳川の部隊の行の合計。ほかの味方は行の名前で）
                const tokugawaRows = rows.rows.filter((r) => r.side === 'ally' && TOKUGAWA_IDS.has(r.id));
                const otherRows = rows.rows.filter((r) => r.side === 'ally' && !TOKUGAWA_IDS.has(r.id) && r.lost > 0);
                expect(got.tokugawa + got.others.reduce((a, x) => a + x.lost, 0), c.name).toBe(rows.lost.ally);
                expect(got.tokugawa, c.name).toBe(tokugawaRows.reduce((a, r) => a + r.lost, 0));
                expect(got.others, c.name).toEqual(otherRows.map((r) => ({ name: r.name, lost: r.lost })));
                if (got.tokugawa === 0 && got.others.length) alliesOnly++;
                if (got.tokugawa > 0 && got.others.length) both++;
                // 約束の行：結果の画面の約束の欄と同じ言葉。引き受けなかったときは出さない
                const pm = pledgeResultModel(bs, o)!;
                const caps = sp.captions.map((x) => x.text);
                pledgeSeen.add(`${pm.result}.${c.pledge}`);
                if (pm.result === 'declined') expect(texts(sp), c.name).not.toContain('約束');
                else if (pm.result === 'kept') expect(caps, c.name).toContain(`${pm.title}。`);
                else if (pm.text.includes('斬り合う前に')) {
                    expect(c.pledge, c.name).toBe('unfought');
                    expect(caps, c.name).toContain(`約束を守れなかった：敵と斬り合う前に${o.result === 'defeat' ? '敗れた' : '退いた'}。`);
                } else expect(caps, c.name).toContain(`${pm.title}。`);
                // 約束の行は 1 つだけで、地図の場面（結果の印の後）にある
                if (pm.result !== 'declined') {
                    const lines = sp.captions.filter((x) => x.text.startsWith('約束を'));
                    expect(lines.length, c.name).toBe(1);
                    expect(frameAt(sp, lines[0]!.start + 0.1, false).map, c.name).toBeTruthy();
                }
                checkShape(sp, `${c.name}.return`);
            }
        }
        // 「徳川は失わず、援軍だけが失った」（点検の場面）と「両方が失った」の組み合わせを、どちらも確かめた
        expect(alliesOnly).toBeGreaterThan(10);
        expect(both).toBeGreaterThan(10);
        expect([...pledgeSeen].sort()).toEqual(['broken.broken', 'broken.unfought', 'declined.declined', 'kept.kept']);
    }, 120_000);
    it('第二章：判断 × 結果 × 敗北の理由（結果の画面の数と比べる。第二章の合戦には約束が無いので約束の行は出さない）', () => {
        let alliesLost = 0;
        for (const c of CH2_STARTS.filter((x) => x.ch1.loss !== 'light' && x.ch1.pledge !== 'unfought')) {
            for (const plan of availableCh2Plans(c.state)) {
                const b = ch2Battle(ch2Muster(c.state, plan));
                const bs = createBattle(ieyasu2BattleSetup(b));
                for (const r of RESULTS) {
                    for (const reason of r === 'defeat' ? CH2_DEFEATS : [undefined]) {
                        const a = ch2Aftermath(b, r, reason ? { reason, heavy: reason === 'ally_hq_routed' } : {});
                        const name = `${c.name}.${plan}.${r}.${reason ?? ''}`;
                        const rows = resultRows(bs, a.battle!);
                        const sp = ieyasuCinematic(a, 'return')!;
                        const got = lossesIn(sp, name);
                        expect(got.bare, name).toBe(rows.lost.ally === 0);
                        expect(got.tokugawa + got.others.reduce((x, y) => x + y.lost, 0), name).toBe(rows.lost.ally);
                        expect(got.tokugawa, name).toBe(rows.rows.filter((x) => x.side === 'ally' && TOKUGAWA_IDS.has(x.id)).reduce((x, y) => x + y.lost, 0));
                        if (got.others.length) alliesLost++;
                        // 長政の名は出さない（浅井の部隊は「浅井勢」）
                        for (const x of got.others) expect(['織田勢', '浅井勢', '村の衆'], name).toContain(x.name);
                        expect(pledgeResultModel(bs, a.battle!), name).toBeNull();
                        expect(texts(sp), name).not.toContain('約束');
                        checkShape(sp, `${name}.return`);
                    }
                }
            }
        }
        expect(alliesLost).toBeGreaterThan(50);
    }, 120_000);
});

describe('第二章への移行：援兵の時点・判断の字幕・村の使いの見た目（点検の指摘）', () => {
    it('援兵は「先の戦の後に着き、隊に加わった」（記録の「第一章で受け取り済み・今の兵に含む」と同じ時点。今着いた、と言わない）', () => {
        let n = 0;
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            const sup = c.state.chapter1.support;
            if (!(sup.recovered > 0)) continue;
            n++;
            const all = texts(sp);
            expect(all, c.name).toContain(`${sup.recovered} は、先の戦の後に`);
            expect(all, c.name).toContain('隊に加わった。');
            expect(all, c.name).not.toMatch(/援兵 \d+ が着いた/);
        }
        expect(n).toBeGreaterThan(10);
    });
    it('判断：2 つ選べるときは手ごとに名前と違いの一言（「殿（しんがり）」と読みを添える）。1 つしか選べないときは選べない手の名前と理由・今回決めるのは兵の補充と言う', () => {
        let two = 0;
        let one = 0;
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            const caps = sp.captions.map((x) => x.text);
            const all = caps.join('\n');
            const L = CH2_PLAN_LABELS[c.state.policy];
            const avail = availableCh2Plans(c.state);
            // 判断の札は判断の場面の最初の字幕の時刻
            expect(sp.captions.find((x) => x.start === sp.info.decide), c.name).toBeDefined();
            if (avail.length === 2) {
                two++;
                for (const pl of ['commit', 'hold'] as const) expect(caps.some((t) => t.startsWith(`「${L[pl]}」：`)), `${c.name}：${pl}`).toBe(true);
                expect(all, c.name).toMatch(/一つ選ぶ|どちらかを選び/);
            } else {
                one++;
                expect(avail).toEqual(['commit']);
                expect(caps, c.name).toContain(`軍議の手は「${L.commit}」だけ。`);
                expect(caps, c.name).toContain(`「${L.hold}」は、兵が足りず取れない。`);
                expect(all, c.name).toContain('今回決めるのは兵の補充');
                // 「一つ選ぶ」と言いながら手が 1 つ、にしない
                expect(all, c.name).not.toMatch(/一つ選ぶ|もう一つは/);
            }
            if (c.state.policy === 'oda') expect(all, c.name).toContain('殿（しんがり）を引き受ける');
            expect(all, c.name).not.toContain('「殿を引き受ける」');
        }
        expect(two).toBeGreaterThan(10);
        expect(one).toBeGreaterThan(3);
    });
    it('村の使い（C）は町の人の見た目で、配役と演出で同じ見た目（武家の使者の見た目の鍵を使わない）', () => {
        const sc = ieyasuScenario(null);
        for (const c of CH2_STARTS) {
            const sp = ieyasuCinematic(c.state, 'ch2_intro')!;
            const ev = eventOf(sp, 'messenger_arrive')!;
            const muster = ch2Muster(c.state, availableCh2Plans(c.state)[0]!);
            const cast = sc.cast(muster).find((x) => x.id === 'envoy');
            if (c.state.policy === 'home') {
                expect(ev.look, c.name).toBe('townsman_a');
                expect(Object.values(IEYASU_LOOKS)).not.toContain(ev.look);
            } else expect(ev.look).toBe(c.state.policy === 'oda' ? IEYASU_LOOKS.oda_envoy : IEYASU_LOOKS.asai_envoy);
            // 同じ人は配役と演出で同じ見た目（演出の使いは城下の使いの置き場所へ歩く：explore/stage.ts は見た目の鍵で配役を探す）
            expect(cast?.look, c.name).toBe(ev.look);
        }
    });
});

describe('第二章 A：織田勢が撤収するわけ（どの隊が・なぜ・家康が何を守るか。docs/ch2a-reason.md）', () => {
    const A_STARTS = CH2_STARTS.filter((c) => c.state.policy === 'oda');
    const A = CH2.filter((x) => x.state.policy === 'oda');
    it('移行：近江の浅井・朝倉は健在で、織田の本隊が陣を引き払う → 本隊の最後尾（後備え・小荷駄）を追っ手が追う → 徳川が二隊を守る。地図に本隊の陣と撤収の線', () => {
        expect(A_STARTS.length).toBeGreaterThan(0);
        for (const c of A_STARTS) {
            const spec = ieyasuCinematic(c.state, 'ch2_intro')!;
            const lines = spec.captions.map((x) => x.text);
            const reason = lines.findIndex((t) => t.includes('織田の本隊は陣を引く'));
            const who = lines.findIndex((t) => t.includes('本隊の最後尾、後備え・小荷駄'));
            const guard = lines.findIndex((t) => t.includes('二隊が南の退き口を抜けるまで、徳川が守る'));
            expect(reason, c.name).toBeGreaterThanOrEqual(0);
            // なぜ：因果の言葉でつなぐ（「健在のため」）
            expect(lines[reason], c.name).toBe('近江の浅井・朝倉が健在のため、織田の本隊は陣を引く。');
            expect(who, c.name).toBe(reason + 1);
            expect(guard, c.name).toBe(who + 1);
            // 使者の頼み：本隊が近江の陣を引く（援軍が退くとは言わない）
            expect(lines.some((t) => t.includes('主の本隊が近江の陣を引く')), c.name).toBe(true);
            // 地図：本隊の陣・本隊の撤収（織田家へ）・後備えと小荷駄の撤収（退き口へ）は、わけの字幕で現れる
            const first = cineFirstShown(spec)!;
            const at = spec.captions[reason]!.start;
            expect(first.get('oda_camp'), c.name).toBeCloseTo(at + 0.3, 1);
            expect(first.get('withdraw.oda_main'), c.name).toBeCloseTo(at + 0.3, 1);
            expect(first.get('withdraw.oda_rear'), c.name).toBeCloseTo(spec.captions[who]!.start, 1);
            const map = spec.beats.find((b): b is CineMapBeat => b.kind === 'map')!;
            const camp = map.scene.places.find((p) => p.id === 'oda_camp')!;
            expect(camp.name).toBe('織田の本隊');
            expect(camp.side).toBe('ally');
            expect(map.scene.routes.filter((r) => r.id.startsWith('withdraw.oda_')).map((r) => `${r.from}>${r.to}:${r.kind}`).sort()).toEqual(['oda_camp>oda:withdraw', 'oda_camp>site_oda:withdraw']);
        }
    });
    it('勝ちを前提にしない：第一章が撤退・敗北なら、どの字幕も勝ちと言わない（局地戦の勝ちの 1 文は第一章で勝ったときだけ）', () => {
        for (const c of A_STARTS) {
            const spec = ieyasuCinematic(c.state, 'ch2_intro')!;
            const won = spec.captions.some((x) => x.text.includes('国境の原の局地戦に勝ち'));
            expect(won, c.name).toBe(c.ch1.result === 'victory');
            if (c.ch1.result !== 'victory') for (const x of spec.captions) expect(x.text, c.name).not.toMatch(/勝ち|勝利|勝った/);
        }
    });
    it('織田の本隊と援軍を混同しない：援軍の出る字幕は第一章の約束の話だけで、退く・撤収するのは本隊（後備え・小荷駄）', () => {
        for (const x of A) {
            for (const m of ['ch2_intro', 'departure', 'return'] as const) {
                const spec = ieyasuCinematic(x.state, m);
                if (!spec) continue;
                for (const cap of spec.captions) {
                    if (!cap.text.includes('援軍')) continue;
                    expect(cap.text, `${x.name}.${m}`).not.toMatch(/陣を引|撤収|後備え|小荷駄|退き口/);
                }
            }
        }
    });
    it('出陣：何を守りに行くか。帰還：主目標を果たしたときだけ「支えきった・二隊は退き口を抜けた」。果たせなかったときは言い切らない', () => {
        for (const x of A) {
            const dep = ieyasuCinematic(x.state, 'departure');
            if (dep) expect(texts(dep), x.name).toContain('本隊の後備え・小荷駄が抜けるまで、退き口を守る。');
            const ret = ieyasuCinematic(x.state, 'return');
            if (!ret) continue;
            const s = x.state as Ieyasu2State;
            const achieved = !!s.result?.primary?.achieved;
            expect(texts(ret).includes('撤収を支えきった：後備え・小荷駄は南の退き口を抜けた。'), x.name).toBe(achieved);
            if (!achieved) expect(texts(ret), x.name).not.toMatch(/支えきった|抜けた/);
        }
    });
});

describe('純粋さ（状態を読むだけ）', () => {
    it('同じ状態から同じ台本。作っても状態は変わらない。シナリオの口も同じ物を返す', () => {
        const sc = ieyasuScenario(null);
        const samples: IeyasuAnyState[] = [newIeyasuGame(), ...CH1.slice(0, 30).map((c) => c.state), ...CH2.slice(0, 60).map((c) => c.state)];
        for (const s of samples) {
            const before = clone(s);
            for (const m of MOMENTS) {
                const a = ieyasuCinematic(s, m);
                const b = ieyasuCinematic(clone(s), m);
                expect(a).toEqual(b);
                expect(sc.cinematic!(s, m)).toEqual(a);
                expect(sc.cinematic!(s, m, { replay: true })).toEqual(a);
            }
            expect(s).toEqual(before);
        }
    }, 60_000);
});
