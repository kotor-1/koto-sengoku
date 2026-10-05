/**
 * 歴史分岐「元亀元年・家康」第一章の結末（と戦後）の保存データ（版 3）を作る。
 *
 * 状態は直接作った（直接状態変更）：第一章の flow の関数を普通の遊び方の順に呼び（devIeyasuState と同じ順。
 * 会話 → 軍議 → 約束の返事 → 城門で出陣）、合戦は遊ばずに ieyasuOutcomeFromSetup（確認用の偽の結果）で結果を作って反映し、
 * 戦後に忠勝と話して章を締めくくる。それを今のコードの IeyasuSaveStore.save（版 3）で MemoryStorage へ書き、書かれた文字列をそのまま返す。
 * 手で書いた文字列ではない。損害の大きい物は、部隊の残りの兵（end）を小さく、状態を routed にしている。
 *
 * 使い方（README.md）：esbuild でまとめて node で動かし、writeIeyasuCh1V3Fixtures('tests/fixtures/ieyasu-ch1-v3') で JSON を書く。
 * テスト（tests/proto3d-ieyasu-ch2-fixtures.test.ts）は、この関数が今のコードでも同じ文字列を作ることを確かめる
 * （第一章の状態の保存の形・中身を変えていないことの確かめ）。
 */
import type { BattleResultKind, UnitStatus } from '../../../proto3d/src/battle/types';
import {
    addIeyasuPlayTime,
    applyIeyasuOutcome,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    ieyasuOutcomeFromSetup,
    newIeyasuGame,
} from '../../../proto3d/src/campaign/ieyasu1570/flow';
import { IeyasuSaveStore, IEYASU_SAVE_KEY } from '../../../proto3d/src/campaign/ieyasu1570/save';
import { PLEDGE_SPECS, type IeyasuState, type Policy } from '../../../proto3d/src/campaign/ieyasu1570/state';
import type { StorageLike } from '../../../proto3d/src/campaign/save';

export const IEYASU_CH1_V3_FIXTURE_NAMES = [
    'oda_victory_kept',
    'oda_defeat_broken_heavy',
    'oda_retreat_declined',
    'asai_victory_kept',
    'asai_defeat_broken_heavy',
    'asai_retreat_declined',
    'home_victory_kept',
    'home_defeat_broken_heavy',
    'home_retreat_declined',
    'oda_victory_kept_aftermath',
] as const;
export type IeyasuCh1V3FixtureName = (typeof IEYASU_CH1_V3_FIXTURE_NAMES)[number];

/** 保存の時刻（固定。同じ文字列を作り直せるように） */
export const IEYASU_CH1_V3_SAVED_AT = new Date('2026-10-05T01:00:00.000Z');

interface Spec {
    policy: Policy;
    result: BattleResultKind;
    pledge: 'accept' | 'decline';
    pledgeResult?: 'kept' | 'broken';
    units?: Record<string, { end?: number; status?: UnitStatus }>;
    elapsedSec: number;
    sideObjective?: boolean;
    abilitiesUsed?: Record<string, number>;
    playSec: number;
    talkEnvoys?: boolean;
    phase: 'ending' | 'aftermath';
}

/** 損害の大きい敗北：本陣が崩れ（家康は負傷）、忠勝隊・弓隊はほぼ失われる（忠勝も負傷） */
const HEAVY: Record<string, { end?: number; status?: UnitStatus }> = {
    t_honjin: { end: 140, status: 'routed' },
    t_tadakatsu: { end: 25, status: 'routed' },
    t_yumi: { end: 20, status: 'routed' },
};

const SPECS: Record<IeyasuCh1V3FixtureName, Spec> = {
    oda_victory_kept: { policy: 'oda', result: 'victory', pledge: 'accept', pledgeResult: 'kept', elapsedSec: 352, sideObjective: true, abilitiesUsed: { t_tadakatsu: 61 }, playSec: 1500, talkEnvoys: true, phase: 'ending' },
    oda_defeat_broken_heavy: {
        policy: 'oda',
        result: 'defeat',
        pledge: 'accept',
        pledgeResult: 'broken',
        units: { ...HEAVY, a_oda: { end: 70, status: 'routed' } },
        elapsedSec: 418,
        playSec: 1620,
        phase: 'ending',
    },
    oda_retreat_declined: { policy: 'oda', result: 'retreat', pledge: 'decline', elapsedSec: 240, playSec: 1100, phase: 'ending' },
    asai_victory_kept: { policy: 'asai', result: 'victory', pledge: 'accept', pledgeResult: 'kept', elapsedSec: 398, sideObjective: true, abilitiesUsed: { a_nagamasa: 75 }, playSec: 1710, talkEnvoys: true, phase: 'ending' },
    asai_defeat_broken_heavy: {
        policy: 'asai',
        result: 'defeat',
        pledge: 'accept',
        pledgeResult: 'broken',
        units: { ...HEAVY, a_nagamasa: { end: 60, status: 'routed' } },
        elapsedSec: 455,
        playSec: 1800,
        phase: 'ending',
    },
    asai_retreat_declined: { policy: 'asai', result: 'retreat', pledge: 'decline', elapsedSec: 262, playSec: 1180, phase: 'ending' },
    home_victory_kept: { policy: 'home', result: 'victory', pledge: 'accept', pledgeResult: 'kept', elapsedSec: 330, sideObjective: true, abilitiesUsed: { t_honjin: 120 }, playSec: 1450, phase: 'ending' },
    home_defeat_broken_heavy: {
        policy: 'home',
        result: 'defeat',
        pledge: 'accept',
        pledgeResult: 'broken',
        units: { ...HEAVY, t_reserve: { end: 30, status: 'routed' } },
        elapsedSec: 401,
        playSec: 1560,
        phase: 'ending',
    },
    home_retreat_declined: { policy: 'home', result: 'retreat', pledge: 'decline', elapsedSec: 230, playSec: 1050, phase: 'ending' },
    oda_victory_kept_aftermath: { policy: 'oda', result: 'victory', pledge: 'accept', pledgeResult: 'kept', elapsedSec: 352, sideObjective: true, abilitiesUsed: { t_tadakatsu: 61 }, playSec: 1500, talkEnvoys: true, phase: 'aftermath' },
};

const POLICY_CHOICE = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' } as const;

/** 状態を普通の遊び方の関数の順で作る（合戦の結果だけ偽の結果） */
export function ieyasuCh1V3State(name: IeyasuCh1V3FixtureName): IeyasuState {
    const sp = SPECS[name];
    let s = newIeyasuGame();
    if (sp.talkEnvoys) {
        s = finishTalkIeyasu(s, 'oda_envoy');
        s = finishTalkIeyasu(s, 'asai_envoy');
    }
    s = finishTalkIeyasu(s, 'tadakatsu', 'open_council');
    s = finishTalkIeyasu(s, 'council', POLICY_CHOICE[sp.policy]);
    s = finishTalkIeyasu(s, 'council', 'confirm_policy');
    s = finishTalkIeyasu(s, PLEDGE_SPECS[sp.policy].giver, sp.pledge === 'accept' ? 'pledge_accept' : 'pledge_decline');
    s = finishTalkIeyasu(s, 'gate', 'depart');
    const outcome = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), sp.result, {
        elapsedSec: sp.elapsedSec,
        ...(sp.units ? { units: sp.units } : {}),
        ...(sp.pledgeResult ? { pledge: sp.pledgeResult } : {}),
        ...(sp.abilitiesUsed ? { abilitiesUsed: sp.abilitiesUsed } : {}),
        ...(sp.sideObjective !== undefined ? { sideObjective: sp.sideObjective } : {}),
    });
    s = applyIeyasuOutcome(s, outcome);
    s = finishTalkIeyasu(s, 'tadakatsu', 'not_yet');
    s = addIeyasuPlayTime(s, sp.playSec);
    if (sp.phase === 'aftermath') return s;
    return finishTalkIeyasu(s, 'tadakatsu', 'end_chapter');
}

class Mem implements StorageLike {
    data = new Map<string, string>();
    getItem(k: string): string | null {
        return this.data.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
        this.data.set(k, v);
    }
    removeItem(k: string): void {
        this.data.delete(k);
    }
}

/** その保存の文字列（今のコードの IeyasuSaveStore.save が localStorage に書く物そのもの） */
export function ieyasuCh1V3String(name: IeyasuCh1V3FixtureName): string {
    const mem = new Mem();
    const st = ieyasuCh1V3State(name);
    const r = new IeyasuSaveStore(mem).save(st, SPECS[name].phase === 'ending' ? 'ending' : 'aftermath', IEYASU_CH1_V3_SAVED_AT);
    if (!r.ok) throw new Error(`${name} を保存できない：${r.message}`);
    const json = mem.getItem(IEYASU_SAVE_KEY);
    if (json === null) throw new Error(`${name} の保存が無い`);
    return json;
}

export function generateIeyasuCh1V3(): Record<IeyasuCh1V3FixtureName, string> {
    const out = {} as Record<IeyasuCh1V3FixtureName, string>;
    for (const n of IEYASU_CH1_V3_FIXTURE_NAMES) out[n] = ieyasuCh1V3String(n);
    return out;
}

/** JSON のファイルに書く（中身は localStorage に入る文字列そのもの。最後に改行を足さない） */
export async function writeIeyasuCh1V3Fixtures(dir: string): Promise<string[]> {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { writeFileSync: (p: string, s: string, enc: 'utf8') => void };
    const all = generateIeyasuCh1V3();
    const written: string[] = [];
    for (const n of IEYASU_CH1_V3_FIXTURE_NAMES) {
        const p = `${dir}/${n}.json`;
        fs.writeFileSync(p, all[n], 'utf8');
        written.push(p);
    }
    return written;
}
