/**
 * 章の冒頭（docs/v20-feedback-request.md【1】）：歴史分岐「元亀元年・家康」の第一章・第二章の冒頭の台本（ch1_open・ch2_open）と、
 * 操作を始める位置・目前の目的・情勢の図解を任意で見る口・声の台詞の表。直接状態変更のテスト（状態は flow の関数を普通の順に呼ぶ：
 * tests/proto3d-ieyasu-story-states.ts）と、偽の画面での流れ（ChapterGame。本物のシナリオと本物の台本）。
 *
 * - 冒頭は 3D の場面だけ（地図の場面が無い）：町の様子 → 急報 → 主人公と家臣の短いやり取り → 操作。長さはロード完了から操作まで 15〜20 秒の目安の中。
 * - 目前の目的（城門の前の本多忠勝と話し、軍議を開く）が字幕と HUD の目的で分かる。地図を見なくてよい。
 * - 第二章の冒頭は前章の結果に合う（負傷兵・援兵・使いの言葉）。矛盾を避ける決まり（感謝は守ったときだけ・援兵は戻ったときだけ・勝ちを前提にしない）。
 * - 情勢の図解（ch1_intro・ch2_intro）は自動で流さず、情勢の画面と軍議の「詳しく見る」（同じ情勢の画面）の「図解を見る」から任意で見られる。
 */
import { describe, expect, it } from 'vitest';
import {
    ChapterGame,
    type CinematicOptions,
    type ConfirmOptions,
    type EndingAction,
    type GameView,
    type GameWorld,
    type HudInfo,
    type MenuAction,
    type ScriptOptions,
    type TitleAction,
} from '../proto3d/src/campaign/game';
import { ieyasuCastFor, ieyasuScenario, ieyasuStartPose, IEYASU_LOOKS } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasuCinematic, ieyasuReplays, CINE_CAPTION_MAX } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { ieyasuSituation } from '../proto3d/src/campaign/ieyasu1570/story/situation';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine, moraCount, voiceLine, voiceSecFor } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { VISUAL_MAX, outcomeTroops, visualCount } from '../proto3d/src/campaign/ieyasu1570/story/counts';
import { ieyasu2CastFor } from '../proto3d/src/campaign/ieyasu1570/chapter2/scenario';
import { ieyasu2Objective } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuObjective, ieyasuPhaseIntro } from '../proto3d/src/campaign/ieyasu1570/story';
import { talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import type { CastMember } from '../proto3d/src/explore/cast';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { ENTRY_POSE } from '../proto3d/src/town/spots';
import type { CineMoment, CineSpec, SituationView, StageEvent } from '../proto3d/src/story/types';
import { CINE_LENGTH_RANGE, specProblems } from '../proto3d/src/story/timeline';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';
import { ch1BeforeBattle, ch1Cases, ch2Starts, checkBannedWords } from './proto3d-ieyasu-story-states';

const CH1 = ch1Cases();
const CH2_STARTS = ch2Starts(CH1);
const events = (spec: CineSpec): StageEvent[] => spec.beats.flatMap((b) => (b.kind === 'stage' ? [b.event] : []));
const said = (spec: CineSpec) => spec.captions.map((c) => `${c.speaker ?? ''}：${c.text}`).join('\n');
const J = (v: unknown) => JSON.stringify(v);
/** 「はじめから」から操作の開始までの、演出の外の待ち（タイトルを閉じて城下を整える・演出の層の出入り）の見積もり（秒。開発サーバーの描画の省略で 0.3 秒ほど） */
const OUTSIDE_SEC = 1.0;

/** 声の付いた字幕は、表と同じ文・同じ話し手 */
function checkVoices(spec: CineSpec, name: string): number {
    let n = 0;
    for (const c of spec.captions) {
        if (!c.voice) continue;
        const v = voiceLine(c.voice);
        expect(c.text, `${name}：${c.voice}`).toBe(v.text);
        expect(c.speaker, `${name}：${c.voice}`).toBe(VOICE_SPEAKER_NAMES[v.speaker]);
        n++;
    }
    return n;
}

describe('第一章の冒頭（ch1_open）', () => {
    const spec = ieyasuCinematic(newIeyasuGame(), 'ch1_open')!;
    it('3D の場面だけ：町の様子 → 急報（使者 2 人・主人公を画に入れる）→ 家臣（本多忠勝）とのやり取り。地図の場面は無い', () => {
        expect(spec.beats.every((b) => b.kind === 'stage')).toBe(true);
        expect(events(spec).map((e) => e.id)).toEqual(['town_life', 'envoys_arrive', 'retainer_report']);
        const [town, envoys, retainer] = events(spec) as [Extract<StageEvent, { id: 'town_life' }>, Extract<StageEvent, { id: 'envoys_arrive' }>, Extract<StageEvent, { id: 'retainer_report' }>];
        expect(town.hero).toBe(true);
        expect(envoys.showHero).toBe(true);
        expect(envoys.envoys).toEqual([
            { look: IEYASU_LOOKS.oda_envoy, name: '織田家の使者' },
            { look: IEYASU_LOOKS.asai_envoy, name: '浅井家の使者' },
        ]);
        // 家臣は城下で軍議を開く相手（配役の id）と同じ人物
        expect(retainer.castId).toBe('tadakatsu');
        expect(retainer.look).toBe(IEYASU_LOOKS.tadakatsu);
        expect(ieyasuCastFor(newIeyasuGame()).some((c) => c.id === retainer.castId && c.key)).toBe(true);
    });
    it('長さ：台本の決まりどおり（12〜19 秒）。ロード完了から操作まで 15〜20 秒の目安に収まる', () => {
        expect(specProblems(spec)).toEqual([]);
        expect(CINE_LENGTH_RANGE.ch1_open).toEqual([12, 19]);
        expect(spec.duration).toBeGreaterThanOrEqual(12);
        expect(spec.duration).toBeLessThanOrEqual(19);
        expect(spec.duration + OUTSIDE_SEC).toBeLessThanOrEqual(20);
        // 長いナレーションにしない：地の文は 1 つ・字幕は 5 つまで・1 つ 30 字まで
        expect(spec.captions.filter((c) => !c.speaker)).toHaveLength(1);
        expect(spec.captions.length).toBeLessThanOrEqual(5);
        for (const c of spec.captions) expect([...c.text].length).toBeLessThanOrEqual(CINE_CAPTION_MAX);
    });
    it('字幕：時代と主人公と急報（1 行）→ 使者の一言 → 家臣とのやり取り（目前の目的：城門の前の本多忠勝と話し、軍議を開く）', () => {
        const t = spec.captions.map((c) => c.text);
        expect(t[0]).toBe('元亀元年、徳川家康の城下に、織田と浅井の使者が同じ日に来た。');
        // 1570年・三河は見出し（台本の題）で出す
        expect(spec.title).toBe('元亀元年（1570年）・徳川の城下（三河）');
        expect(spec.captions[1]).toMatchObject({ speaker: '織田家の使者', text: '徳川殿にも、兵を出していただきたい。' });
        expect(spec.captions[2]).toMatchObject({ speaker: '浅井家の使者', text: '主は、徳川殿と手を結びたいと。' });
        // 家臣の言葉は家臣の場面の中。城門の前・軍議（目的）を言う
        const rb = spec.beats[2]!;
        const ret = spec.captions.filter((c) => c.start >= rb.start - 1e-6);
        expect(ret.map((c) => c.speaker)).toEqual(['忠勝', '家康']);
        expect(ret[0]!.text).toContain('城門の前');
        expect(ret[0]!.text).toContain('軍議');
        // 情報の札：いつ・どこ・危機（急報。最初の 1 行）・判断（軍議）
        expect(spec.info.when).toBe(0);
        expect(spec.info.where).toBe(0);
        expect(spec.info.crisis).toBe(0);
        expect(spec.info.decide).toBeDefined();
        // 使者の一言は、情勢の図解（今までの導入）・会話と同じ文
        const diagram = ieyasuCinematic(newIeyasuGame(), 'ch1_intro')!;
        for (const c of spec.captions.filter((x) => x.speaker?.endsWith('使者'))) expect(diagram.captions.some((d) => d.text === c.text && d.speaker === c.speaker)).toBe(true);
    });
    it('HUD の目的・段階の案内でも目前の目的が分かる（地図を見なくてよい）', () => {
        const s = newIeyasuGame();
        expect(ieyasuObjective(s)).toMatch(/^城門の前の本多忠勝と話し、軍議を開く/);
        expect(ieyasuPhaseIntro(s).text).toContain('城門の前の本多忠勝と話し、軍議を開こう');
    });
    it('声：使者・忠勝・家康の字幕に声の id。表の文・話し手と同じ', () => {
        expect(checkVoices(spec, 'ch1_open')).toBe(4);
        expect(spec.captions.filter((c) => c.speaker && !c.voice)).toEqual([]);
    });
    it('情勢の図解（ch1_intro）は残る（地図の台本・30〜45 秒）。どの状態から作っても冒頭は同じ', () => {
        const d = ieyasuCinematic(newIeyasuGame(), 'ch1_intro')!;
        expect(d.title).toBe('情勢の図解（第一章の始め）');
        expect(d.beats.some((b) => b.kind === 'map')).toBe(true);
        expect(specProblems(d)).toEqual([]);
        for (const c of [CH1[0]!, CH1[40]!]) expect(ieyasuCinematic(c.state, 'ch1_open')).toEqual(spec);
        expect(ieyasuCinematic(CH2_STARTS[3]!.state, 'ch1_open')).toEqual(spec);
        // 第一章の状態に第二章の冒頭は無い
        for (const { name, state } of ch1BeforeBattle()) expect(ieyasuCinematic(state, 'ch2_open'), name).toBeNull();
    });
});

describe('第二章の冒頭（ch2_open）：前章の結果に合った人物・町の場面', () => {
    const THANKS = /守っていただいた|ご恩|感謝|かたじけ|礼を/;
    const specs = CH2_STARTS.map((c) => ({ c, spec: ieyasuCinematic(c.state, 'ch2_open')! }));
    it('すべての組み合わせ：3D の場面だけ・台本の決まりどおり（12〜26 秒）・最後は家臣の一言（城門の前・軍議）', () => {
        expect(specs.length).toBeGreaterThan(50);
        let max = 0;
        for (const { c, spec } of specs) {
            expect(specProblems(spec), c.name).toEqual([]);
            expect(spec.beats.every((b) => b.kind === 'stage'), c.name).toBe(true);
            const ev = events(spec);
            const last = ev[ev.length - 1]!;
            expect(last.id, c.name).toBe('retainer_report');
            if (last.id === 'retainer_report') {
                expect(last.castId).toBe('tadakatsu');
                expect(ieyasu2CastFor(c.state).some((m) => m.id === last.castId && m.key), c.name).toBe(true);
            }
            const lastCap = spec.captions[spec.captions.length - 1]!;
            expect(lastCap.speaker).toBe('忠勝');
            expect(lastCap.text).toBe('軍議を開きましょう。城門の前でお待ちします。');
            for (const k of ['when', 'where', 'prev', 'crisis', 'decide'] as const) expect(spec.info[k], `${c.name}：${k}`).toBeDefined();
            for (const x of spec.captions) expect([...x.text].length, `${c.name}：${x.text}`).toBeLessThanOrEqual(CINE_CAPTION_MAX);
            checkVoices(spec, c.name);
            max = Math.max(max, spec.duration);
        }
        expect(max).toBeLessThanOrEqual(26);
        // いつと前の結果は 1 行（「数日前、」＋第一章の結果）
        for (const { c, spec } of specs) expect(spec.captions[0]!.text, c.name).toMatch(/^数日前、国境の原/);
    });
    it('最初の場面：第一章で兵を失っていれば詰所の負傷兵（失った兵から）、失っていなければ町の様子（主人公を画に入れる）', () => {
        let w = 0;
        let t = 0;
        for (const { c, spec } of specs) {
            const first = events(spec)[0]!;
            const lost = outcomeTroops(c.state.chapter1.battle).lost;
            const n = visualCount(lost, VISUAL_MAX.wounded);
            if (n > 0) {
                expect(first, c.name).toEqual({ id: 'wounded_rest', count: n });
                w++;
            } else {
                expect(first, c.name).toEqual({ id: 'town_life', hero: true });
                t++;
            }
        }
        expect(w).toBeGreaterThan(0);
        expect(t).toBeGreaterThan(0);
    });
    it('援兵は第一章で約束を守り、兵が実際に戻ったとき（recovered > 0）だけ', () => {
        let some = 0;
        for (const { c, spec } of specs) {
            const sup = c.state.chapter1.support;
            const ev = events(spec).find((e) => e.id === 'reinforcement_arrive');
            if (c.state.chapter1.pledge.result === 'kept' && sup.recovered > 0) {
                expect(ev, c.name).toBeDefined();
                some++;
            } else {
                expect(ev, c.name).toBeUndefined();
                expect(said(spec), c.name).not.toMatch(/援兵.*加わった/);
            }
        }
        expect(some).toBeGreaterThan(5);
    });
    it('感謝は約束を守ったときだけ。約束の結果を言う（A・B は使い、C は字幕）', () => {
        for (const { c, spec } of specs) {
            const pl = c.state.chapter1.pledge.result;
            const voiced = spec.captions.filter((x) => x.speaker).map((x) => x.text).join('\n');
            if (pl !== 'kept') expect(voiced, c.name).not.toMatch(THANKS);
            const p = c.state.policy;
            if (p === 'home') {
                const all = said(spec);
                if (pl === 'kept') expect(all, c.name).toContain('約束どおり');
                if (pl === 'declined') expect(all, c.name).toContain('引き受けなかった');
                if (pl === 'broken') expect(all, c.name).toMatch(/刃を交える前に兵を引き|約束は、果たせなかった/);
            } else {
                if (pl === 'kept') expect(voiced, c.name).toContain('守っていただいた');
                if (pl === 'broken') expect(voiced, c.name).toContain('守られなんだ');
            }
        }
    });
    it('勝ちを前提にしない：第一章が撤退・敗北なら、どの字幕も勝ちと言わない', () => {
        for (const { c, spec } of specs) {
            if (c.ch1.result === 'victory') continue;
            for (const x of spec.captions) expect(x.text, c.name).not.toMatch(/勝ち|勝利|勝った|追い払っていただ/);
        }
    });
    it('今回の危機：A は撤収のわけ（本隊が陣を引く。援軍とは言わない）、B は丘の上の隊（長政が負傷なら後備え）、C は村の使い', () => {
        for (const { c, spec } of specs) {
            const t = spec.captions.map((x) => x.text);
            const p = c.state.policy;
            if (p === 'oda') {
                expect(t, c.name).toContain('主の本隊が近江の陣を引く。撤収をお支えくだされ。');
                expect(t, c.name).toContain('近江の浅井・朝倉が健在のため、織田の本隊は陣を引く。');
                for (const x of t) if (x.includes('援軍')) expect(x, c.name).not.toMatch(/陣を引|撤収|後備え|小荷駄|退き口/);
            }
            if (p === 'asai') {
                const alive = c.state.characters.nagamasa === 'alive';
                expect(t, c.name).toContain(alive ? '長政の一隊が、丘の上で織田方に囲まれた。' : '浅井勢の後備えが、丘の上で織田方に囲まれた。');
                if (!alive) expect(said(spec) + J(events(spec)), c.name).not.toContain('長政');
                expect(said(spec) + J(events(spec)), c.name).not.toMatch(/織田家の使者|織田援軍/);
            }
            if (p === 'home') {
                expect(t, c.name).toContain('村の者だけでは守れませぬ。どうかお助けを。');
                expect(J(events(spec)), c.name).not.toMatch(/織田|浅井/);
            }
            expect(said(spec), c.name).not.toContain('信長');
        }
    });
    it('禁止の言葉が無い（史実・地名・信長・年月日）。HUD の目的も城門の前の忠勝', () => {
        checkBannedWords(specs.flatMap(({ spec }) => [spec.title, ...spec.captions.map((c) => c.text)]).join('\n'));
        for (const { c } of specs.slice(0, 10)) expect(ieyasu2Objective(c.state), c.name).toMatch(/^城門の前の本多忠勝と話し、軍議を開く/);
    });
    it('情勢の図解（ch2_intro）は残る（地図の台本）', () => {
        for (const { c } of specs.slice(0, 12)) {
            const d = ieyasuCinematic(c.state, 'ch2_intro')!;
            expect(d.title, c.name).toMatch(/^情勢の図解（第二章：/);
            expect(d.beats.some((b) => b.kind === 'map')).toBe(true);
        }
    });
});

describe('情勢の図解は任意（情勢の画面・軍議の「詳しく見る」から）', () => {
    it('情勢の画面（探索・軍議から）の見直しの一覧に、図解（diagram）と冒頭（scene）がある', () => {
        const s = newIeyasuGame();
        for (const from of ['explore', 'council'] as const) {
            const v = ieyasuSituation(s, { from, ...(from === 'council' ? { options: [{ id: 'policy_oda', label: 'A' }] } : {}) })!;
            expect(v.replays.map((r) => [r.moment, r.kind])).toEqual([
                ['ch1_intro', 'diagram'],
                ['ch1_open', 'scene'],
            ]);
        }
        const c2 = CH2_STARTS[0]!.state;
        const v2 = ieyasuSituation(c2, { from: 'explore' })!;
        expect(v2.replays.filter((r) => r.kind === 'diagram').map((r) => r.moment)).toEqual(['ch2_intro', 'ch1_intro']);
        expect(ieyasuReplays(c2).map((r) => r.moment)).toContain('ch2_open');
    });
});

describe('操作を始める位置（保存に位置が無いとき：町の入口）', () => {
    it('両章の探索の始めは ENTRY_POSE。支度・戦後は今までの開始の位置（null）。状態は変えない', () => {
        const s = newIeyasuGame();
        const before = J(s);
        expect(ieyasuStartPose(s)).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
        expect(J(s)).toBe(before);
        expect(s.explore).toBeNull();
        expect(ieyasuStartPose(CH2_STARTS[0]!.state)).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
        for (const c of CH1.slice(0, 5)) expect(ieyasuStartPose(c.state), c.name).toBeNull();
        expect(ieyasuScenario(null).startPose!(s)).toEqual(ieyasuStartPose(s));
    });
});

describe('声の付いた字幕は、読み上げの見積もりより短くない（字幕が替わると前の声を止めるので、声を途中で切らない）', () => {
    it('冒頭・図解・出陣・帰還のすべての組み合わせ：声の付いた字幕の秒 ≥ 読み（audio/readings.ts）の拍 ÷（7 × 話し手の速さ）＋ 0.8', () => {
        const specs: CineSpec[] = [ieyasuCinematic(newIeyasuGame(), 'ch1_open')!, ieyasuCinematic(newIeyasuGame(), 'ch1_intro')!];
        for (const c of CH1) for (const m of ['departure', 'return'] as const) { const x = ieyasuCinematic(c.state, m); if (x) specs.push(x); }
        for (const c of CH2_STARTS) for (const m of ['ch2_open', 'ch2_intro'] as const) specs.push(ieyasuCinematic(c.state, m)!);
        let n = 0;
        const ids = new Set<string>();
        for (const sp of specs) {
            const caps = [...sp.captions].sort((a, b) => a.start - b.start);
            caps.forEach((c, i) => {
                if (!c.voice) return;
                const need = voiceSecFor(c.voice);
                expect(c.end - c.start + 1e-6, `${sp.id}：${c.voice}（${c.text}）`).toBeGreaterThanOrEqual(need);
                // 次の字幕は、声が終わる見積もりより前に来ない
                const next = caps[i + 1];
                if (next) expect(next.start + 1e-6, `${sp.id}：${c.voice} の次`).toBeGreaterThanOrEqual(c.start + need);
                n++;
                ids.add(c.voice);
            });
        }
        expect(n).toBeGreaterThan(100);
        // 冒頭と出陣の声の台詞はすべて現れる
        for (const v of VOICE_LINES.filter((x) => x.where !== 'talk' && x.where !== 'battle')) expect(ids.has(v.id), v.id).toBe(true);
    });
    it('見積もりの例：忠勝の「殿、軍議を開きましょう。…」は 4 秒を超え、拍の数は読みのかなから数える', () => {
        expect(moraCount('との、ぐんぎを')).toBe(6);
        expect(moraCount('じょうもん')).toBe(4);
        expect(voiceSecFor('ch1.tadakatsu.council')).toBeGreaterThan(4);
        expect(voiceSecFor('ch2.asai_envoy.first.broken')).toBeGreaterThan(5);
    });
});

describe('声の台詞の表（voiceLines.ts）', () => {
    it('id は重ならない。文は 30 字まで。話し手の名前は会話の行の名前と同じ', () => {
        const ids = VOICE_LINES.map((v) => v.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const v of VOICE_LINES) {
            expect([...v.text].length, v.id).toBeLessThanOrEqual(CINE_CAPTION_MAX);
            expect(VOICE_SPEAKER_NAMES[v.speaker], v.id).toBeTruthy();
        }
        expect(VOICE_SPEAKER_NAMES.hero).toBe('家康');
        expect(VOICE_SPEAKER_NAMES.tadakatsu).toBe('忠勝');
        expect(VOICE_SPEAKER_NAMES.ishikawa).toBe('石川数正');
        checkBannedWords(VOICE_LINES.map((v) => v.text).join('\n'));
    });
    it('冒頭・出陣の字幕に声の id（第二章の使いの言葉はすべての組み合わせで表から）', () => {
        const used = new Set<string>();
        const add = (sp: CineSpec | null) => sp?.captions.forEach((c) => c.voice && used.add(c.voice));
        add(ieyasuCinematic(newIeyasuGame(), 'ch1_open'));
        for (const c of CH2_STARTS) add(ieyasuCinematic(c.state, 'ch2_open'));
        for (const c of CH1) add(ieyasuCinematic(c.state, 'departure'));
        for (const v of VOICE_LINES.filter((x) => x.where === 'ch1_open' || x.where === 'ch2_open' || x.where === 'departure')) expect(used.has(v.id), v.id).toBe(true);
    });
    it('会話の行から引ける（話し手の id でも名前の欄でも）', () => {
        const s = newIeyasuGame();
        const script = talkIeyasu(s, 'tadakatsu');
        const hit = script.lines.map((l) => findVoiceLine(l.speaker, l.text)).filter(Boolean);
        expect(hit.map((v) => v!.id)).toContain('talk.hero.same_day');
        expect(findVoiceLine('忠勝', '軍議を開きましょう。城門の前でお待ちします。')?.id).toBe('ch2.tadakatsu.council');
        expect(findVoiceLine('tadakatsu', '違う文。')).toBeUndefined();
        expect(findVoiceLine('hero', '皆の者、出陣じゃ。')?.id).toBe('depart.hero');
    });
});

// ================================================================ 偽の画面での流れ（本物のシナリオ・本物の台本）

type Req =
    | { kind: 'title'; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'ending'; answer: (a?: EndingAction) => void }
    | { kind: 'record'; view: ScenarioEndingView; answer: () => void }
    | { kind: 'cinematic'; spec: CineSpec; opts: CinematicOptions; answer: (r: 'done' | 'skipped') => void }
    | { kind: 'situation'; view: SituationView; answer: (r?: { replay?: CineMoment }) => void };

class View implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    title() {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', answer }));
    }
    script(script: ScenarioScript, _o: ScriptOptions) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu() {
        return new Promise<MenuAction>(() => undefined);
    }
    ending() {
        return new Promise<EndingAction | void>((answer) => this.reqs.push({ kind: 'ending', answer }));
    }
    record(view: ScenarioEndingView) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'record', view, answer }));
    }
    hud(info: HudInfo | null) {
        this.hudInfo = info;
    }
    prompt() {}
    intro() {}
    toast() {}
    abandon() {
        this.reqs = [];
    }
    cinematic(spec: CineSpec, opts: CinematicOptions) {
        return new Promise<'done' | 'skipped'>((resolve) =>
            this.reqs.push({
                kind: 'cinematic',
                spec,
                opts,
                answer: (r) => {
                    opts.onStage(null, 0, opts.reduced);
                    resolve(r);
                },
            }),
        );
    }
    situation(view: SituationView) {
        return new Promise<{ replay?: CineMoment } | void>((answer) => this.reqs.push({ kind: 'situation', view, answer: (r) => answer(r) }));
    }
}

class World implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    control = false;
    private readonly w = colliders();
    walls(): Rect[] {
        return this.w;
    }
    setCast(c: CastMember<string>[]) {
        this.cast = c;
    }
    heroPose() {
        return { ...this.pose };
    }
    setHeroPose(p: ExplorePose) {
        this.pose = { ...p };
    }
    setControl(on: boolean) {
        this.control = on;
    }
    stage() {}
}

async function flush(n = 40): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

async function next<K extends Req['kind']>(v: View, kind: K): Promise<Extract<Req, { kind: K }>> {
    for (let i = 0; i < 200; i++) {
        const k = v.reqs.findIndex((r) => r.kind === kind);
        if (k >= 0) return v.reqs.splice(k, 1)[0] as Extract<Req, { kind: K }>;
        await flush(5);
    }
    throw new Error(`${kind} が来ない（${v.reqs.map((r) => r.kind).join(',')}）`);
}

function game(storage: MemoryStorage) {
    const view = new View();
    const world = new World();
    const g = new ChapterGame({ view, world, store: new CampaignSaveStore(storage), scenarios: [ieyasuScenario(storage)], battleRunner: async () => null });
    return { g, view, world };
}

describe('流れ：自動で流すのは冒頭だけ。図解は情勢の画面から任意（偽の画面・本物の台本）', () => {
    it('第一章：はじめから → 冒頭（本物の台本 ch1_open）→ 町の入口から操作。図解を見なくても忠勝と話して軍議へ進める', async () => {
        const storage = new MemoryStorage();
        const { g, view, world } = game(storage);
        void g.start();
        (await next(view, 'title')).answer('new:ieyasu1570');
        const c = await next(view, 'cinematic');
        expect(c.spec.id).toBe('ch1_open');
        c.answer('done');
        await flush();
        expect(g.screen).toBe('explore');
        expect(g.cineLog).toEqual(['ch1_open']);
        expect(world.pose).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
        expect(view.hudInfo?.objective).toMatch(/^城門の前の本多忠勝と話し、軍議を開く/);
        // 保存はまだ無い（位置の無い状態のまま）
        expect(storage.data.has(IEYASU_SAVE_KEY)).toBe(false);
        // 情勢 → 図解を見る（任意）→ 情勢へ戻る → 閉じる
        void g.openSituation();
        const s1 = await next(view, 'situation');
        expect(s1.view.replays.find((r) => r.kind === 'diagram')?.moment).toBe('ch1_intro');
        s1.answer({ replay: 'ch1_intro' });
        const d = await next(view, 'cinematic');
        expect(d.spec.id).toBe('ch1_intro');
        d.answer('skipped');
        (await next(view, 'situation')).answer();
        await flush();
        expect(g.screen).toBe('explore');
        expect(g.cineLog).toEqual(['ch1_open', 'ch1_intro']);
    });
    it('第二章：「第二章へ進む」→ 結果確認 → 冒頭（ch2_open）→ 町の入口から操作。図解（ch2_intro）は流れない', async () => {
        const storage = new MemoryStorage();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        const { g, view, world } = game(storage);
        void g.start();
        (await next(view, 'title')).answer('continue:ieyasu1570');
        (await next(view, 'ending')).answer('next_chapter');
        (await next(view, 'record')).answer();
        const c = await next(view, 'cinematic');
        expect(c.spec.moment).toBe('ch2_open');
        expect(c.spec.id).toMatch(/^ch2_open\.oda\.defeat\.broken$/);
        // 感謝しない（約束を破った）・勝ちと言わない（第一章は敗北）
        expect(said(c.spec)).not.toMatch(/守っていただいた|勝ち/);
        c.answer('done');
        await flush();
        expect(g.screen).toBe('explore');
        expect(g.cineLog).toEqual([c.spec.id]);
        expect(world.pose).toEqual({ x: ENTRY_POSE.x, z: ENTRY_POSE.z, heading: ENTRY_POSE.heading });
        expect(JSON.parse(storage.data.get(IEYASU_SAVE_KEY)!).explore).toBeNull();
    });
});
