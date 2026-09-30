/**
 * 武将のデータ（proto3d/src/battle/generals.ts）：
 * - 6 人（家康・本多忠勝・浅井長政・酒井忠次・石川数正・榊原康政）。id・所属・役割・固有能力・AI の方針・関係状態の鍵を持つ。
 * - 本多忠勝は前線の主将（参謀として扱わない）。酒井は采配・軍議、石川は後詰め。
 * - 今の 3 人の能力は battle/abilities.ts のデータを指す。部隊の leaderId（maps.ts）と武将の id が同じ。
 * - 関係状態の鍵は、歴史分岐の状態の信頼（trust）の鍵と同じ（主人公本人は持たない）。
 * - 史実の記録：確かめたのは資料メモ（docs/historical-source-notes.md）にある事柄だけ。ほかは「未確認」「伝承」と明記する。
 */
import { describe, expect, it } from 'vitest';
import { ABILITY_DATA } from '../proto3d/src/battle/abilities';
import { GENERALS, GENERAL_IDS, GENERAL_ROLE_LABELS, RELATION_SELF, generalById } from '../proto3d/src/battle/generals';
import { IEYASU_LEADER_IDS } from '../proto3d/src/battle/maps';
import { TRUST_IDS } from '../proto3d/src/campaign/ieyasu1570/state';

describe('武将のデータ', () => {
    it('6 人。id は重ならず、GENERAL_IDS・generalById と合う', () => {
        expect(GENERAL_IDS).toEqual(['ieyasu', 'tadakatsu', 'nagamasa', 'sakai', 'ishikawa', 'sakakibara']);
        expect(new Set(GENERAL_IDS).size).toBe(GENERALS.length);
        for (const g of GENERALS) expect(generalById(g.id)).toBe(g);
        expect(generalById('genzo')).toBeUndefined();
    });
    // Version 13 候補（docs/troops-abilities-design.md §3）：忠勝の AI の方針を「攻めかかる」から「持ち場を保つ」（前線維持・殿）へ変え、
    // 味方として待機中の基本方針（initiative）を 4 人に足した（家康本陣・長政隊は持たない）
    it('表示名・所属・役割・固有能力・AI の方針・味方としての基本方針', () => {
        const row = (id: string) => {
            const g = generalById(id)!;
            return [g.name, g.clan, g.role, g.abilityId, g.aiPolicy, g.initiative ?? null];
        };
        expect(row('ieyasu')).toEqual(['徳川家康', 'tokugawa', 'commander', 'ieyasu_rally', 'cautious', null]);
        expect(row('tadakatsu')).toEqual(['本多忠勝', 'tokugawa', 'vanguard', 'tadakatsu_rearguard', 'steady', 'rearguard']);
        expect(row('nagamasa')).toEqual(['浅井長政', 'asai', 'ally_lord', 'nagamasa_support', 'steady', null]);
        expect(row('sakai')).toEqual(['酒井忠次', 'tokugawa', 'tactician', 'sakai_flank', 'steady', 'coordinate']);
        expect(row('ishikawa')).toEqual(['石川数正', 'tokugawa', 'reserve', 'ishikawa_reserve', 'support', 'support']);
        expect(row('sakakibara')).toEqual(['榊原康政', 'tokugawa', 'vanguard', 'sakakibara_vanguard', 'aggressive', 'pursuit']);
        for (const g of GENERALS) expect(GENERAL_ROLE_LABELS[g.role]).toBeTruthy();
    });
    it('本多忠勝は前線の主将（参謀＝tactician にしない）', () => {
        expect(generalById('tadakatsu')!.role).toBe('vanguard');
        expect(GENERALS.filter((g) => g.role === 'tactician').map((g) => g.id)).toEqual(['sakai']);
    });
    it('今の 3 人の能力は abilities.ts のデータを指し、部隊の leaderId（maps.ts）と武将の id が同じ', () => {
        for (const id of ['ieyasu', 'tadakatsu', 'nagamasa'] as const) {
            const g = generalById(id)!;
            expect(Object.keys(ABILITY_DATA)).toContain(g.abilityId);
            expect(IEYASU_LEADER_IDS[id]).toBe(g.id);
        }
    });
    it('関係状態の鍵は、歴史分岐の信頼の鍵（主人公本人は持たない。長政は浅井家への信頼）', () => {
        expect(generalById('ieyasu')!.relationKey).toBe(RELATION_SELF);
        expect(generalById('nagamasa')!.relationKey).toBe('asai');
        for (const g of GENERALS) if (g.relationKey !== RELATION_SELF) expect(TRUST_IDS as readonly string[]).toContain(g.relationKey);
        for (const id of ['tadakatsu', 'sakai', 'ishikawa', 'sakakibara']) expect(generalById(id)!.relationKey).toBe(id);
    });
});

describe('史実と解釈を分ける', () => {
    it('確かめた事柄は資料メモにある人物だけ。酒井・石川・榊原は確かめた事柄を持たない', () => {
        for (const id of ['sakai', 'ishikawa', 'sakakibara']) {
            const h = generalById(id)!.history;
            expect(h.verified).toEqual([]);
            expect(h.sourceNote).toContain('記載がない');
        }
        expect(generalById('tadakatsu')!.history.verified.join('')).toContain('旗本');
        for (const g of GENERALS) {
            expect(g.history.interpretation.length).toBeGreaterThan(0);
            expect(g.history.sourceNote).toContain('historical-source-notes.md');
        }
    });
    it('一般に知られる事柄は、どれも「未確認」か「伝承」と書く', () => {
        for (const g of GENERALS) for (const t of g.history.commonlyKnown) expect(t).toMatch(/未確認|伝承/);
    });
    it('資料で確かめていない逸話を事実として書かない（単騎・無傷の語を使わない）・能力と役割は創作と書く', () => {
        const all = GENERALS.flatMap((g) => [...g.history.verified, ...g.history.commonlyKnown, ...g.history.interpretation]).join('\n');
        expect(all).not.toMatch(/単騎|無傷|傷ひとつ/);
        expect(all).not.toMatch(/義兄|妹|お市|縁戚|婚姻/);
        expect(all).toContain('創作');
        for (const id of ['sakai', 'ishikawa', 'sakakibara']) expect(generalById(id)!.history.interpretation.join('')).toContain('仮');
    });
    it('データだけ（three・DOM を使わない）', async () => {
        // 型の確かめ（ルートの tsc）に node の型が無いので、node:fs は実行時に読み込む（proto3d-battle-v11-identity.test.ts と同じやり方）
        const fsName = 'node:fs';
        const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: URL, enc: 'utf8'): string };
        const src = fs.readFileSync(new URL('../proto3d/src/battle/generals.ts', import.meta.url), 'utf8');
        expect(src).not.toMatch(/from 'three'|document\.|window\./);
    });
});
