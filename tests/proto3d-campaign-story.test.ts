/**
 * 第一章の台詞と結末の文章（proto3d/src/campaign/story.ts）：仮シナリオの明示、選択と結果で会話・場面・結末が変わること。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { finishTalk, newGame, presentTalks, talk } from '../proto3d/src/campaign/flow';
import { ALLIANCES, type CampaignState } from '../proto3d/src/campaign/state';
import { CHAPTER_END_LABEL, PROVISIONAL_NOTE, endingView, objectiveText, phaseIntro } from '../proto3d/src/campaign/story';
import { toAftermath, toBattle, toMuster } from './proto3d-campaign-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];
const text = (s: CampaignState, id: Parameters<typeof talk>[1]) => talk(s, id).lines.map((l) => `${l.name}「${l.text}」`).join('\n');

describe('仮シナリオの明示', () => {
    it('story.ts の先頭に仮シナリオの注記がある', async () => {
        // node の型を入れずに読む（tests/proto3d-hero-v2.test.ts と同じやり方）
        const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (p: URL, enc: 'utf8') => string };
        const src = fs.readFileSync(new URL('../proto3d/src/campaign/story.ts', import.meta.url), 'utf8');
        expect(src.slice(0, 600)).toContain('仮シナリオ');
        expect(src.slice(0, 600)).toContain('史実として確認したものではありません');
    });
    it('高札・合戦の説明・結末に仮シナリオと出る', () => {
        expect(text(newGame(), 'notice')).toContain(PROVISIONAL_NOTE);
        expect(CHAPTER_END_LABEL).toContain('仮シナリオ');
    });
});

describe('会話', () => {
    it('どの台詞も空でなく、名前の欄は話し手に合う', () => {
        const states: CampaignState[] = [newGame(), finishTalk(newGame(), 'genzo', 'open_council')];
        for (const al of ALLIANCES) {
            states.push(toMuster(al));
            for (const r of RESULTS) states.push(toAftermath(al, r));
        }
        for (const s of states) {
            for (const id of presentTalks(s)) {
                for (const l of talk(s, id).lines) {
                    expect(l.text.trim().length).toBeGreaterThan(0);
                    if (l.speaker === 'narration') expect(l.name).toBe('');
                    else expect(l.name.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('出陣の支度の会話は選んだ陣営で変わる', () => {
        const g = ALLIANCES.map((al) => text(toMuster(al), 'genzo'));
        expect(new Set(g).size).toBe(3);
        expect(text(toMuster('tashiro'), 'tashiro_envoy')).toContain('田代兵庫');
        expect(text(toMuster('omori'), 'omori_envoy')).toContain('大森弥左衛門');
    });

    it('戦後の源蔵の会話は、選択 × 結果の 9 通りすべてで違う', () => {
        const seen = new Set<string>();
        for (const al of ALLIANCES) for (const r of RESULTS) seen.add(text(toAftermath(al, r), 'genzo'));
        expect(seen.size).toBe(9);
    });

    it('戦後の使者の会話は結果と関係で変わる（敗北で関係が負なら盟約を考え直す）', () => {
        const win = text(toAftermath('tashiro', 'victory'), 'tashiro_envoy');
        const lose = text(toAftermath('tashiro', 'defeat'), 'tashiro_envoy');
        const sacrificed = text(toAftermath('tashiro', 'defeat', { units: { a_tashiro: { status: 'destroyed', end: 0 } } }), 'tashiro_envoy');
        expect(new Set([win, lose, sacrificed]).size).toBe(3);
        expect(lose).toContain('身を寄せられよ');
        expect(sacrificed).toContain('捨て石');
        expect(text(toAftermath('omori', 'retreat'), 'omori_envoy')).not.toBe(text(toAftermath('omori', 'victory'), 'omori_envoy'));
    });

    it('捕らわれた新八は居ない。負傷した人物は台詞で分かる', () => {
        const a = toAftermath('tashiro', 'victory', { units: { a_shinpachi: { status: 'destroyed', end: 0 } } });
        expect(presentTalks(a)).not.toContain('shinpachi');
        expect(text(a, 'genzo')).toContain('捕らわれ');
        const w = toAftermath('omori', 'victory', { units: { a_shinpachi: { status: 'routed', end: 50 } } });
        expect(text(w, 'shinpachi')).toContain('射られ');
    });

    it('戦後の場面の見出しは結果で変わる', () => {
        const titles = RESULTS.map((r) => phaseIntro(toAftermath('alone', r)).title);
        expect(new Set(titles).size).toBe(3);
        expect(objectiveText(newGame())).toContain('源蔵');
        expect(phaseIntro(toBattle('alone')).title).toBe('国境の原');
    });
});

describe('結末の画面', () => {
    const end = (al: (typeof ALLIANCES)[number], r: BattleResultKind, opts?: Parameters<typeof toAftermath>[2]) =>
        endingView(finishTalk(toAftermath(al, r, opts), 'genzo', 'end_chapter'));

    it('題・本文・記録（選択・結果・兵・人物・関係）・「第一章 完（仮シナリオ）」がある', () => {
        const v = end('tashiro', 'victory');
        expect(v.id).toBe('tashiro_victory');
        expect(v.title).toBe('山の盟約');
        expect(v.body.length).toBeGreaterThan(0);
        expect(v.footer).toBe('第一章 完（仮シナリオ）');
        const labels = v.record.map((r) => r.label);
        for (const l of ['協力陣営', '合戦の結果', '琴坂の兵', '人物', '関係']) expect(labels).toContain(l);
        const rec = Object.fromEntries(v.record.map((r) => [r.label, r.value]));
        expect(rec['協力陣営']).toBe('田代家と組んだ');
        expect(rec['合戦の結果']).toContain('勝利');
        expect(rec['関係']).toContain('田代家 +40');
        expect(rec['関係']).toContain('大森家 -20');
    });

    it('結末の題は 6 通り', () => {
        const titles = new Set([
            end('tashiro', 'victory').title,
            end('omori', 'victory').title,
            end('alone', 'victory').title,
            end('alone', 'retreat').title,
            end('omori', 'defeat').title,
            end('alone', 'defeat').title,
        ]);
        expect([...titles].sort()).toEqual(['山の盟約', '川湊の富', '独り立つ若殿', '雌伏', '盟友の庇護', '落ち延びる'].sort());
    });

    it('雌伏（撤退）の文は、関係と兵の残りで変わる', () => {
        const kept = end('tashiro', 'retreat');
        const cut = end('tashiro', 'retreat', { units: { a_tashiro: { status: 'destroyed', end: 0 }, a_genzo: { end: 50 }, a_shinpachi: { end: 30 } } });
        expect(kept.body.join()).toContain('盟約を保つ');
        expect(cut.body.join()).toContain('何も言わずに');
        expect(kept.body.join()).toContain('再び戦う力');
        expect(cut.body.join()).toContain('立て直し');
        expect(end('alone', 'retreat').body.join()).toContain('国衆は、黙って');
    });

    it('捕らわれた新八は結末でも触れる', () => {
        const v = end('alone', 'defeat', { units: { a_shinpachi: { status: 'destroyed', end: 0 } } });
        expect(v.body.join()).toContain('新八を取り戻す');
        expect(v.record.find((r) => r.label === '人物')?.value).toContain('新八 捕らわれ');
    });
});
