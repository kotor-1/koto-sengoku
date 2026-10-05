/**
 * 歴史分岐「元亀元年・家康」第二章の合戦の設定（物語側の編成）。設計：docs/chapter2-design.md §5・§7・§8。純粋な TypeScript。
 *
 * ＊＊ 第一章の直後の、分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない ＊＊
 *
 * - 演習の戦場データ（battle/fields/*.ts）は書き換えない。地形・道・退き口・目標の仕組みだけを使い、登場する部隊・所属・兵・支援・
 *   救出や離脱の対象・目標・説明・地図の名前は、ここで物語の状態から作る（buildBattleSetup(field, 部隊の並び, opts)）。
 * - 方針ごとの任務：A 織田 → 退却戦の地形で織田勢の撤収を支える／B 浅井 → 援軍救出の地形で孤立した浅井勢を救う／
 *   C 自領 → 村落の地形で領内の村を守る。
 * - 入力（Ch2BattleInput）は値だけ。同じ入力なら同じ設定（合戦の設定を作るたびに状態から求める。支援は兵に足さない）。
 * - 主目標の値（B の連れ帰る兵の割合・C の守る時間）と始めの陣は、軍議で判断を決めた時に第一章の終わりの兵で 1 回だけ求めた
 *   「確定した任務の条件」（Ch2Terms・ch2DecideTerms）から作る。補充で兵が戻っても求め直さない。
 * - 徳川の部隊の id は第一章と同じ（t_honjin・t_tadakatsu・t_yumi・t_reserve）。合戦の結果を部隊ごとの兵へ戻すのに使う。
 *
 * 数値（兵・士気・閾値・敵の勢い）は CH2_RULES と各任務の表の 1 か所。釣り合いの確かめ（tests/proto3d-ieyasu-ch2-battle.test.ts）で直す。
 */
import type { BattleMap, BattleResultKind, BattleSetup, BattleStoryNote, ObjectiveDef, UnitDef, Zone } from '../../../battle/types';
import { IEYASU_UNIT_IDS } from '../../../battle/maps';
import { RULES } from '../../../battle/sim';
import { buildBattleSetup, fieldMap } from '../../../battle/fields/build';
import { createFieldEnv, inZone, zoneCenter } from '../../../battle/fieldRules';
import { isPassable, reachable } from '../../../battle/pathfind';
import { ABILITY_DATA } from '../../../battle/abilities';
import { REARGUARD } from '../../../battle/fields/rearguard';
import { RELIEF } from '../../../battle/fields/relief';
import { VILLAGE } from '../../../battle/fields/village';
import type { BattlefieldDef } from '../../../battle/fields/types';
import { endRuleBriefingLine } from '../../../battle/objectives';
import type { IeyasuCharacterId, IeyasuCharacterStatus, PledgeResult, Policy, TokugawaUnitId, TrustId } from '../state';

// ================================================================ 入力と出力

/**
 * 軍議の判断（設計 §6）。
 * - commit：判断 1（A 殿を引き受ける／B 南から急いで救う／C 全軍で村を守る）。岡崎の守備隊も出す（兵が CH2_RULES.minUnitTroops 未満なら出ない）。
 * - hold：判断 2（A 退き口の手前を固める／B 西の筋から救う／C 守備隊は城に残す）。岡崎の守備隊は城に残す。
 */
export type Ch2Plan = 'commit' | 'hold';
export const CH2_PLANS: readonly Ch2Plan[] = ['commit', 'hold'];

export interface Ch2BattleInput {
    policy: Policy;
    plan: Ch2Plan;
    /** 徳川の部隊ごとの今の兵（補充の後） */
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    trust: Record<TrustId, number>;
    /** 第一章の合戦の結果（敵の勢い） */
    ch1Result: BattleResultKind;
    /** 第一章の約束の結果（A・B で破ったら、相手の部隊の士気 −CH2_RULES.coldMorale。信頼 0 未満と重ねない。会話と説明の区別にも使う） */
    ch1Pledge: PledgeResult;
    /** 補充で「負傷兵の戻りを待つ」を選んだ（敵の後詰め・次の波が CH2_RULES.waitDelaySec 早く着く） */
    waited: boolean;
    /**
     * 確定した任務の条件（軍議で判断を決めた時に、第一章の終わりの兵で求めた物。Ieyasu2State.terms）。
     * 渡せば、今の兵（補充の後）から求め直さない。省けば、troops を第一章の終わりの兵とみなして ch2DecideTerms で求める
     * （軍議の選択肢の説明・確かめの台本など、補充の前の兵の入力のため）。
     */
    terms?: Ch2Terms;
}

/**
 * 確定した任務の条件（設計 §5.3・§6）。軍議で判断を決めた時に、第一章の終わりの兵を基準に 1 回だけ求めて状態に残す（ch2DecideTerms）。
 * その後の補充・保存・読み込み直し・出陣・戦後では求め直さない。判断を変えられるのは、軍議で決める前（「考え直す」）だけ。
 * 始めの陣も thin で選ぶ（A は兵が少ないとき家康本陣を切れ目寄りから始める）。
 */
export interface Ch2Terms {
    /** 求めたときの方針・判断（状態の方針・判断と同じ） */
    policy: Policy;
    plan: Ch2Plan;
    /** 基準の兵：第一章の終わりの兵で数えた、この判断で出陣する徳川の兵の合計（本陣は最低の兵で数える） */
    basisTroops: number;
    /** 兵が少ないときの調整をする（basisTroops が CH2_RULES.thinTroops 未満） */
    thin: boolean;
    /** B：連れ帰る兵の条件（割合）。A・C は null */
    escortMinRatio: number | null;
    /** C：庄屋の屋敷前を守る秒数。A・B は null */
    holdSec: number | null;
}

/** 加わる支援の部隊 */
export type Ch2SupportId = 'oda_teppo' | 'asai_guide' | 'village';

export interface Ch2BattleInfo {
    setup: BattleSetup;
    /** 使った任務の条件（渡された確定の条件。渡されなければ求めた物） */
    terms: Ch2Terms;
    /** 出陣する徳川の部隊 */
    sortie: TokugawaUnitId[];
    /** 加わる支援の部隊 */
    support: Ch2SupportId[];
    /** 兵が少ないときの調整をした（terms.thin と同じ） */
    thin: boolean;
    /** 説明に出した調整の文（兵が少ない・待った・敵の勢い・冷えた関係・負傷） */
    adjustments: string[];
    /** 敵の兵の倍率（第一章の勝敗） */
    enemyFactor: number;
    /** 物語の味方の部隊の id（織田勢・浅井勢・村の衆。徳川以外） */
    partnerUnitIds: string[];
}

// ================================================================ 決まり（1 か所）

export const CH2_RULES = {
    /** この兵より少ない徳川の部隊は出陣しない（家康本陣は除く） */
    minUnitTroops: 40,
    /** 家康本陣の最低の兵（第一章と同じ） */
    honjinMin: 50,
    /** 出陣する徳川の兵の合計がこれより少なければ「兵が少ないとき」の調整をする */
    thinTroops: 650,
    /** 判断 2（守備隊を残す）で、出陣する徳川の部隊がこれより少なければ選べない */
    holdMinUnits: 2,
    /** 補充で待ったときに、敵の後詰め・次の波が早く着く秒数 */
    waitDelaySec: 40,
    /** 敵の勢い（第一章の勝敗）：敵の兵の倍率 */
    enemyFactor: { victory: 0.85, retreat: 1, defeat: 1.1 } as Readonly<Record<BattleResultKind, number>>,
    /** 支援：A は織田の信頼がこれ以上で「織田の鉄砲隊」、B は浅井の信頼がこれ以上で「浅井の道案内」 */
    supportTrust: { oda: 50, asai: 40 },
    /** 相手の家の信頼がこれより低い、または第一章の約束を破ったと、相手の部隊の士気 −coldMorale（徳川を頼みにしない。どちらでも 1 回だけ） */
    coldTrust: 0,
    coldMorale: 10,
    /** 本多忠勝の信頼：hi 以上で忠勝隊の士気 +5、lo 未満で −5 */
    tadakatsuTrust: { hi: 60, lo: 30, delta: 5 },
    /** 負傷：家康 → 本陣の士気 −5、忠勝 → 忠勝隊の士気 −10 */
    woundedMorale: { ieyasu: 5, tadakatsu: 10 },
} as const;

/** 主目標の値（ふだん／兵が少ないとき）：B の連れ帰る兵の条件（割合）・C の庄屋の屋敷前を守る秒数（村の者が南へ逃げ終わるまで） */
export const CH2_TERMS_TABLE = {
    escortMinRatio: { normal: 0.4, thin: 0.3 },
    holdSec: { normal: 360, thin: 180 },
} as const;

/** 地図の名前（地形は演習の戦場のまま。名前だけ物語の内容にする） */
export const CH2_MAP_NAMES: Readonly<Record<Policy, string>> = {
    oda: '織田勢の退き口',
    asai: '浅井勢の孤立した丘',
    home: '領内の村',
};
/** 使う演習の戦場（地形・道・退き口） */
export const CH2_FIELDS: Readonly<Record<Policy, BattlefieldDef>> = { oda: REARGUARD, asai: RELIEF, home: VILLAGE };

/** 物語の味方の部隊の id */
export const CH2_UNIT = {
    odaRear: 'a_oda_rear',
    odaBaggage: 'a_oda_baggage',
    odaTeppo: 'a_oda_teppo',
    asai: 'a_asai',
    asaiGuide: 'a_asai_guide',
    village: 'a_village',
} as const;

// ================================================================ 出陣する部隊・判断の可否

const ORDER: readonly TokugawaUnitId[] = ['honjin', 'tadakatsu', 'yumi', 'reserve'];

/** 判断ごとに出陣する徳川の部隊（兵が minUnitTroops 未満の部隊は出ない。本陣はいつも出る） */
export function ch2SortieUnits(plan: Ch2Plan, troops: Record<TokugawaUnitId, number>): TokugawaUnitId[] {
    return ORDER.filter((k) => {
        if (k === 'honjin') return true;
        if (k === 'reserve' && plan !== 'commit') return false;
        return (troops[k] ?? 0) >= CH2_RULES.minUnitTroops;
    });
}

/** 出陣する徳川の兵の合計（本陣は最低の兵で数える） */
export function ch2SortieTroops(plan: Ch2Plan, troops: Record<TokugawaUnitId, number>): number {
    return ch2SortieUnits(plan, troops).reduce((n, k) => n + (k === 'honjin' ? Math.max(CH2_RULES.honjinMin, troops.honjin) : troops[k]), 0);
}

/** 判断を選べるか（選べないときは理由）。判断 1 はいつも選べる（守備隊がいなくても本陣は出る） */
export function ch2PlanAvailability(plan: Ch2Plan, troops: Record<TokugawaUnitId, number>): { available: boolean; reason: string | null } {
    if (plan === 'commit') return { available: true, reason: null };
    const n = ch2SortieUnits('hold', troops).length;
    if (n < CH2_RULES.holdMinUnits) {
        // 判断 1 でも部隊が増えないとき（守備隊も兵が少ない）は、そう書く（補充で兵を戻せば出られる）
        const commitOnlyHq = ch2SortieUnits('commit', troops).length < CH2_RULES.holdMinUnits;
        return {
            available: false,
            reason: `第一章の損害で、守備隊を城に残すと出せる部隊が足りない（本陣だけになる）${commitOnlyHq ? '。判断 1 でも、補充しないと出るのは家康本陣だけ（守備隊も兵が少なく出られない）' : ''}`,
        };
    }
    return { available: true, reason: null };
}

/**
 * 任務の条件を求める（軍議で判断を決めた時に 1 回だけ。basis は第一章の終わりの兵＝補充の前）。
 * 兵が少ない（この判断で出陣する徳川の兵が CH2_RULES.thinTroops 未満）なら、主目標の値と始めの陣を改める。
 * 補充で兵が戻っても、決めた条件は求め直さない（状態の terms を使う）。
 */
export function ch2DecideTerms(policy: Policy, plan: Ch2Plan, basis: Record<TokugawaUnitId, number>): Ch2Terms {
    const basisTroops = ch2SortieTroops(plan, basis);
    const thin = basisTroops < CH2_RULES.thinTroops;
    const T = CH2_TERMS_TABLE;
    const key = thin ? 'thin' : 'normal';
    return {
        policy,
        plan,
        basisTroops,
        thin,
        escortMinRatio: policy === 'asai' ? T.escortMinRatio[key] : null,
        holdSec: policy === 'home' ? T.holdSec[key] : null,
    };
}

/** 任務の条件の形が方針・判断と合っているか（保存の検査・合戦の設定で使う。値は CH2_TERMS_TABLE のどちらかで、thin と合う） */
export function ch2TermsProblem(t: Ch2Terms, policy: Policy, plan: Ch2Plan): string | null {
    if (t.policy !== policy || t.plan !== plan) return `任務の条件の方針・判断（${t.policy}・${t.plan}）が、今の方針・判断（${policy}・${plan}）と違う`;
    const key = t.thin ? 'thin' : 'normal';
    const T = CH2_TERMS_TABLE;
    if (policy === 'asai' ? t.escortMinRatio !== T.escortMinRatio[key] : t.escortMinRatio !== null) return '任務の条件の連れ帰る兵の割合が正しくない';
    if (policy === 'home' ? t.holdSec !== T.holdSec[key] : t.holdSec !== null) return '任務の条件の守る時間が正しくない';
    return null;
}

/** 加わる支援の部隊（状態から毎回求める。兵には足さない） */
export function ch2Support(input: Pick<Ch2BattleInput, 'policy' | 'trust' | 'ch1Result'>): Ch2SupportId[] {
    if (input.policy === 'oda') return input.trust.oda >= CH2_RULES.supportTrust.oda ? ['oda_teppo'] : [];
    if (input.policy === 'asai') return input.trust.asai >= CH2_RULES.supportTrust.asai ? ['asai_guide'] : [];
    return input.ch1Result === 'victory' ? ['village'] : [];
}

// ================================================================ 合戦の設定

type Pos = { x: number; z: number; facing: number };
const N = 0;
const S = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

const clampMorale = (m: number) => Math.max(20, Math.min(100, Math.round(m)));
const scaled = (n: number, f: number) => Math.max(1, Math.round(n * f));

/** 徳川の部隊（第一章と同じ id・名前・能力。武将の印は leaderId） */
function tokugawaUnit(k: TokugawaUnitId, input: Ch2BattleInput, at: Pos): UnitDef {
    const t = input.troops;
    const R = CH2_RULES;
    switch (k) {
        case 'honjin':
            return { id: IEYASU_UNIT_IDS.honjin, side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', leaderId: 'ieyasu', strength: Math.max(R.honjinMin, Math.round(t.honjin)), morale: clampMorale(90 - (input.characters.ieyasu === 'wounded' ? R.woundedMorale.ieyasu : 0)), ability: 'ieyasu_rally', ...at };
        case 'tadakatsu': {
            const tr = input.trust.tadakatsu;
            const d = tr >= R.tadakatsuTrust.hi ? R.tadakatsuTrust.delta : tr < R.tadakatsuTrust.lo ? -R.tadakatsuTrust.delta : 0;
            return { id: IEYASU_UNIT_IDS.tadakatsu, side: 'ally', clan: 'tokugawa', kind: 'yari', name: '本多忠勝隊', leaderId: 'tadakatsu', strength: Math.round(t.tadakatsu), morale: clampMorale(85 + d - (input.characters.tadakatsu === 'wounded' ? R.woundedMorale.tadakatsu : 0)), ability: 'tadakatsu_rearguard', ...at };
        }
        case 'yumi':
            return { id: IEYASU_UNIT_IDS.yumi, side: 'ally', clan: 'tokugawa', kind: 'yumi', name: '徳川弓隊', strength: Math.round(t.yumi), morale: 75, ...at };
        case 'reserve':
            return { id: IEYASU_UNIT_IDS.reserve, side: 'ally', clan: 'tokugawa', kind: 'yari', name: '岡崎の守備隊', strength: Math.round(t.reserve), morale: 75, ...at };
    }
}

/** 地図（地形・退き口は演習の戦場の物そのまま。名前だけ物語の内容） */
function storyMap(policy: Policy): BattleMap {
    const base = fieldMap(CH2_FIELDS[policy]);
    return { ...base, id: `ieyasu2_${base.id}`, name: CH2_MAP_NAMES[policy] };
}

const FIRST_LINE = '第一章の直後の、分岐した世界での出来事（ゲーム用の創作）。特定の史実の合戦の再現ではない。戦場・兵数・配置は創作。';

/** 判断 1 の説明の、岡崎の守備隊の行（実際に出陣する部隊で決める。兵が少なく出ないときは、城は空かない） */
function reserveLine(sortie: readonly TokugawaUnitId[]): string {
    if (sortie.includes('reserve')) return '岡崎の守備隊も出ている（城は空になる）。';
    return `岡崎の守備隊は兵が少なく（${CH2_RULES.minUnitTroops} 未満）出ていない（城は空かない）。${sortie.length === 1 ? '出たのは家康本陣だけ。' : ''}`;
}

/** 秒を「1 分 50 秒」「20 秒」の形に */
function fmtSec(sec: number): string {
    const m = Math.floor(sec / 60);
    const r = Math.round(sec % 60);
    return m > 0 ? `${m} 分${r ? ` ${r} 秒` : ''}` : `${r} 秒`;
}

/** 敵の勢いの文 */
function enemyMoodLine(r: BattleResultKind): string {
    return r === 'victory' ? '第一章で勝ったため、敵の勢いは鈍っている（敵の兵 ×0.85）。' : r === 'defeat' ? '第一章で敗れたため、敵は勢いづいている（敵の兵 ×1.1）。' : '第一章は決着がつかなかった（敵の兵はそのまま）。';
}

// ---------------------------------------------------------------- A：織田勢の撤収を支える（退却戦の地形）

/** 退却戦の退き口（南の端）・敵の攻め進む先（切れ目の北の口） */
const A_EXIT: Zone = { rect: { x0: -60, x1: 60, z0: 190, z1: 220 } };
const A_NECK = { x: 0, z: 72, r: 30 };
const A_NECK_MOUTH = { x: 0, z: 80, r: 25 };

/** 判断ごとの陣（thin は兵が少ないとき） */
const A_POS: Record<Ch2Plan, { thin: boolean; at: Record<TokugawaUnitId | 'odaRear' | 'odaBaggage' | 'odaTeppo', Pos> }[]> = {
    commit: [
        {
            thin: false,
            at: {
                tadakatsu: { x: 0, z: -10, facing: N },
                yumi: { x: -25, z: 25, facing: N },
                reserve: { x: -55, z: 15, facing: N },
                honjin: { x: 0, z: 40, facing: N },
                odaRear: { x: -35, z: 62, facing: N },
                odaBaggage: { x: 35, z: 62, facing: N },
                odaTeppo: { x: 55, z: 15, facing: N },
            },
        },
        {
            thin: true,
            at: {
                tadakatsu: { x: 0, z: -10, facing: N },
                yumi: { x: -25, z: 25, facing: N },
                reserve: { x: -55, z: 15, facing: N },
                honjin: { x: 0, z: 80, facing: N },
                odaRear: { x: -35, z: 62, facing: N },
                odaBaggage: { x: 35, z: 62, facing: N },
                odaTeppo: { x: 55, z: 15, facing: N },
            },
        },
    ],
    hold: [
        {
            thin: false,
            at: {
                tadakatsu: { x: 0, z: 70, facing: N },
                yumi: { x: -30, z: 72, facing: N },
                reserve: { x: 30, z: 72, facing: N },
                honjin: { x: 0, z: 150, facing: N },
                odaRear: { x: -55, z: 15, facing: N },
                odaBaggage: { x: 55, z: 15, facing: N },
                odaTeppo: { x: 30, z: 72, facing: N },
            },
        },
        {
            thin: true,
            at: {
                tadakatsu: { x: 0, z: 75, facing: N },
                yumi: { x: -30, z: 75, facing: N },
                reserve: { x: 30, z: 75, facing: N },
                honjin: { x: 0, z: 160, facing: N },
                odaRear: { x: -55, z: 15, facing: N },
                odaBaggage: { x: 55, z: 15, facing: N },
                odaTeppo: { x: 30, z: 75, facing: N },
            },
        },
    ],
};

/**
 * 相手の部隊（A 織田勢・B 浅井勢）の士気の下げ幅（設計 §5.1）：第一章の約束を破った、または相手の家の信頼が CH2_RULES.coldTrust 未満なら
 * −coldMorale（どちらか・両方でも 1 回だけ。重ねない）。引き受けなかったのは約束違反ではないので、信頼だけで決まる。
 */
export function ch2PartnerColdMorale(input: Pick<Ch2BattleInput, 'policy' | 'trust' | 'ch1Pledge'>): number {
    if (input.policy === 'home') return 0;
    const t = input.policy === 'oda' ? input.trust.oda : input.trust.asai;
    return t < CH2_RULES.coldTrust || input.ch1Pledge === 'broken' ? CH2_RULES.coldMorale : 0;
}

function odaUnits(input: Ch2BattleInput, at: (k: 'odaRear' | 'odaBaggage' | 'odaTeppo') => Pos, support: Ch2SupportId[]): UnitDef[] {
    const cold = ch2PartnerColdMorale(input);
    const out: UnitDef[] = [
        { id: CH2_UNIT.odaRear, side: 'ally', clan: 'oda', kind: 'yari', name: '織田勢の後備え', strength: 380, morale: clampMorale(75 - cold), ...at('odaRear') },
        { id: CH2_UNIT.odaBaggage, side: 'ally', clan: 'oda', kind: 'yari', name: '織田勢の小荷駄', strength: 260, morale: clampMorale(65 - cold), ...at('odaBaggage') },
    ];
    if (support.includes('oda_teppo')) out.push({ id: CH2_UNIT.odaTeppo, side: 'ally', clan: 'oda', kind: 'yumi', name: '織田の鉄砲隊', strength: 220, morale: 75, ...at('odaTeppo') });
    return out;
}

function enemiesA(input: Ch2BattleInput, f: number): UnitDef[] {
    const delay = input.waited ? CH2_RULES.waitDelaySec : 0;
    const e = (id: string, kind: UnitDef['kind'], name: string, strength: number, morale: number, x: number, z: number, extra: Partial<UnitDef> = {}): UnitDef => ({
        id,
        side: 'enemy',
        clan: id.includes('asakura') ? 'asakura' : 'asai',
        kind,
        name,
        strength: scaled(strength, f),
        morale,
        x,
        z,
        facing: S,
        ...extra,
    });
    return [
        e('e_pursuit_hq', 'honjin', '浅井・朝倉の追撃の本隊', 300, 85, 0, -200, { aiRole: 'guard_hq' }),
        e('e_asakura_kiba', 'kiba', '朝倉の騎馬', 220, 75, 40, -95, { aiRole: 'assault', aiTarget: { ...A_NECK } }),
        e('e_asai_yari1', 'yari', '浅井の追っ手（一）', 340, 80, -50, -190, { aiRole: 'assault', aiTarget: { ...A_NECK } }),
        e('e_asai_yari2', 'yari', '浅井の追っ手（二）', 340, 80, 50, -190, { aiRole: 'assault', aiTarget: { ...A_NECK } }),
        e('e_asai_yumi', 'yumi', '浅井の弓', 200, 75, 0, -120, { aiRole: 'assault', aiTarget: { ...A_NECK } }),
        e('e_asakura_amb', 'kiba', '朝倉の伏兵の騎馬', 180, 80, -90, 65, { aiRole: 'assault', aiTarget: { ...A_NECK_MOUTH }, arriveAt: 45, facing: EAST }),
        // 後詰め：東の林を抜けて切れ目の口へ向かう騎馬（70 秒。補充で待てば 30 秒）
        e('e_asai_late', 'kiba', '浅井の後詰めの騎馬', 200, 80, 150, 30, { aiRole: 'assault', aiTarget: { ...A_NECK }, arriveAt: Math.max(1, 70 - delay), facing: WEST }),
    ];
}

function setupA(input: Ch2BattleInput, sortie: TokugawaUnitId[], support: Ch2SupportId[], terms: Ch2Terms, f: number, adj: string[]): BattleSetup {
    const pos = A_POS[input.plan].find((p) => p.thin === terms.thin)!.at;
    const units: UnitDef[] = [...sortie.map((k) => tokugawaUnit(k, input, pos[k])), ...odaUnits(input, (k) => pos[k], support), ...enemiesA(input, f)];
    const primary: ObjectiveDef = {
        id: 'ch2_oda_withdraw',
        type: 'withdraw',
        label: '家康本陣と織田勢の 2 隊（後備え・小荷駄）を南の退き口から離脱させる',
        exit: A_EXIT,
        count: 2,
        required: [CH2_UNIT.odaRear, CH2_UNIT.odaBaggage],
        name: '南の退き口',
    };
    const secondary: ObjectiveDef[] = [{ id: 'ch2_oda_losses', type: 'limit_losses', label: '損害を 2 割以内に抑える', maxRatio: 0.2 }];
    if (sortie.includes('tadakatsu')) secondary.push({ id: 'ch2_oda_tadakatsu', type: 'preserve_unit', label: '本多忠勝隊を崩さずに退く（兵 3 割以上）', unitId: IEYASU_UNIT_IDS.tadakatsu, minRatio: 0.3 });
    const briefing = [
        FIRST_LINE + '地形は「退却戦」の演習の地形を使う。',
        '方針：織田との協力を続けた。織田勢が北の陣から兵を引く。徳川は撤収を支え、織田勢の後備え・小荷駄を南の退き口まで退かせる。追ってくるのは浅井・朝倉の勢（長政は出ない）。',
        `追っ手：朝倉の騎馬が北から間を置かずに来る。${
            input.waited
                ? `${fmtSec(70 - CH2_RULES.waitDelaySec)}ほどで東の林から浅井の後詰めの騎馬が、45 秒ほどで切れ目の北の口の西の林から朝倉の伏兵の騎馬が出る`
                : '45 秒ほどで切れ目の北の口の西の林から朝倉の伏兵の騎馬が、70 秒ほどで東の林から浅井の後詰めの騎馬が出る'
        }（地図の「援軍の出る所」）。撤退の命令で退く隊は騎馬に追われる。`,
        input.plan === 'commit'
            ? `判断：殿を引き受けた。徳川は北の丘の前で殿を務め、織田勢は先に切れ目へ向かう。${reserveLine(sortie)}`
            : '判断：退き口の手前を固めた。徳川は切れ目の北の口を固め、織田勢は北の原から自分で退いてくる。岡崎の守備隊は城に残した。',
        ...adj,
        '勝利：家康本陣と、織田勢の後備え・小荷駄が、南の退き口の輪から離脱する（輪に入った部隊は戦場を離れる。撤退の命令でも移動でもよい）。家康本陣が退き口から離れても負けではない（合戦は続く）。',
        '敗北：家康本陣が崩れる、または織田勢のどちらかが崩れる・退き口でない所から退く（家康は落ち延びる。一度の負けで家が滅ぶことはない）。',
        `副目標：${secondary.map((d) => d.label).join('・')}。`,
        '追い討ち：撤退の命令で退く部隊は、近くの敵に追われる。本多忠勝隊の「退路の守護」の範囲で退けば、追っ手は忠勝隊に阻まれる。',
    ];
    const reinf: ReinfGroup[] = [
        { id: 'ch2_oda_ambush', unitIds: ['e_asakura_amb'] },
        { id: 'ch2_oda_late', unitIds: ['e_asai_late'] },
    ];
    return finishSetup(input.policy, units, { primary, secondary }, briefing, reinf);
}

// ---------------------------------------------------------------- B：孤立した浅井勢を救う（援軍救出の地形）

const B_HILL = { x: 60, z: -150 };
const B_MEET: Zone = { circle: { cx: B_HILL.x, cz: B_HILL.z, r: 50 } };
const B_SAFE: Zone = { circle: { cx: 0, cz: 175, r: 40 } };

const B_POS: Record<Ch2Plan, Record<TokugawaUnitId | 'guide', Pos>> = {
    commit: {
        honjin: { x: 0, z: 200, facing: N },
        tadakatsu: { x: 0, z: 140, facing: N },
        yumi: { x: -25, z: 165, facing: N },
        reserve: { x: 60, z: 150, facing: N },
        guide: { x: -60, z: 150, facing: N },
    },
    hold: {
        honjin: { x: -30, z: 135, facing: N },
        tadakatsu: { x: -55, z: 70, facing: N },
        yumi: { x: -50, z: 100, facing: N },
        reserve: { x: -20, z: 100, facing: N },
        guide: { x: -40, z: 115, facing: N },
    },
};

function asaiUnits(input: Ch2BattleInput, support: Ch2SupportId[], plan: Ch2Plan): UnitDef[] {
    const cold = ch2PartnerColdMorale(input);
    const nagamasa = input.characters.nagamasa === 'alive';
    const isolated: UnitDef = nagamasa
        ? { id: CH2_UNIT.asai, side: 'ally', clan: 'asai', kind: 'yari', name: '浅井長政隊', leaderId: 'nagamasa', strength: 380, morale: clampMorale(80 - cold), ability: 'nagamasa_support', x: B_HILL.x, z: B_HILL.z, facing: N }
        : { id: CH2_UNIT.asai, side: 'ally', clan: 'asai', kind: 'yari', name: '浅井勢の後備え', strength: 380, morale: clampMorale(75 - cold), x: B_HILL.x, z: B_HILL.z, facing: N };
    const out = [isolated];
    if (support.includes('asai_guide')) out.push({ id: CH2_UNIT.asaiGuide, side: 'ally', clan: 'asai', kind: 'yari', name: '浅井の道案内', strength: 220, morale: 75, ...B_POS[plan].guide });
    return out;
}

function enemiesB(input: Ch2BattleInput, f: number): UnitDef[] {
    const delay = input.waited ? CH2_RULES.waitDelaySec : 0;
    const e = (id: string, kind: UnitDef['kind'], name: string, strength: number, morale: number, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef => ({
        id,
        side: 'enemy',
        clan: 'oda',
        kind,
        name,
        strength: scaled(strength, f),
        morale,
        x,
        z,
        facing,
        ...extra,
    });
    const hill = { x: B_HILL.x, z: B_HILL.z, r: 30 };
    return [
        e('e_oda_hq', 'honjin', '織田方の本陣', 350, 85, -140, -225, S, { aiRole: 'guard_hq' }),
        e('e_oda_attack', 'yari', '織田方の丘の攻め手', 220, 75, 60, -205, S, { aiRole: 'assault', aiTarget: { ...hill } }),
        e('e_oda_ring_w', 'yari', '織田方の丘の西の囲み', 360, 85, -35, -150, EAST, { aiRole: 'hold_line', aiLeash: 200 }),
        e('e_oda_ring_e', 'kiba', '織田方の丘の東の囲み（騎馬）', 200, 80, 120, -95, WEST, { aiRole: 'hold_zone', aiTarget: { x: 120, z: -95, r: 30 }, aiLeash: 60 }),
        e('e_oda_ring_s', 'yari', '織田方の丘の南の囲み', 400, 85, 60, -85, S, { aiRole: 'hold_zone', aiTarget: { x: 60, z: -85, r: 30 }, aiLeash: 70 }),
        e('e_oda_block', 'yari', '織田方の中央の押さえ', 400, 85, 10, -5, S, { aiRole: 'hold_zone', aiTarget: { x: 10, z: -5, r: 18 }, aiLeash: 35 }),
        e('e_oda_teppo', 'yumi', '織田方の鉄砲隊', 200, 80, 100, -30, S, { aiRole: 'hold_line' }),
        e('e_oda_late', 'yari', '織田方の援軍', 340, 85, 200, -220, S, { aiRole: 'assault', aiTarget: { ...hill }, arriveAt: Math.max(1, 240 - delay) }),
    ];
}

function setupB(input: Ch2BattleInput, sortie: TokugawaUnitId[], support: Ch2SupportId[], terms: Ch2Terms, f: number, adj: string[]): BattleSetup {
    const pos = B_POS[input.plan];
    const asai = asaiUnits(input, support, input.plan);
    const target = asai[0]!;
    const minRatio = terms.escortMinRatio ?? CH2_TERMS_TABLE.escortMinRatio.normal;
    const units: UnitDef[] = [...sortie.map((k) => tokugawaUnit(k, input, pos[k])), ...asai, ...enemiesB(input, f)];
    const primary: ObjectiveDef = {
        id: 'ch2_asai_escort',
        type: 'rescue_escort',
        label: `${target.name}と合流し、南の安全地点まで連れ帰る（兵 ${Math.round(minRatio * 10)} 割以上）`,
        unitId: CH2_UNIT.asai,
        meetZone: B_MEET,
        safeZone: B_SAFE,
        minRatio,
        meetSec: 5,
    };
    const secondary: ObjectiveDef[] = [
        { id: 'ch2_asai_losses', type: 'limit_losses', label: '損害を 2 割以内に抑える', maxRatio: 0.2 },
        { id: 'ch2_asai_ring_s', type: 'break_unit', label: '丘の南の囲みを崩す', unitId: 'e_oda_ring_s' },
    ];
    const briefing = [
        FIRST_LINE + '地形は「援軍救出」の演習の地形を使う。',
        `方針：浅井との協力を選んだ（史実から分かれた道）。北東の丘で${target.name}が織田方に囲まれて孤立している。合流し、南の安全地点まで連れ帰る。信長本人・織田の武将は出ない。`,
        input.characters.nagamasa === 'alive' ? '浅井長政隊は味方として指揮でき、「盟友への援護」も使える。' : '長政は第一章の手傷が癒えず、後方に残った。丘にいるのは浅井勢の後備え（武将なし）。',
        input.plan === 'commit'
            ? `判断：南から急いで救う。南の陣から丘へ向かう。${reserveLine(sortie)}`
            : '判断：西の筋から救う。西の林の縁の筋（小丘の近く）から始める。丘の西の囲みは、矢を浴び続けると射手へ打って出る（誘い出せる）。岡崎の守備隊は城に残した。',
        ...adj,
        `合流：${target.name}とほかの味方が、丘の上の合流の輪に一緒に 5 秒いると合流する。合流の前に安全地点へ入っても数えない（触れただけ・能力だけでは果たさない）。`,
        `勝利：合流した${target.name}が、崩れずに兵 ${Math.round(minRatio * 10)} 割以上で南の安全地点の輪に入る。`,
        `敗北：${target.name}が崩れる・撤退する・兵が ${Math.round(minRatio * 10)} 割を切る、または家康本陣が崩れる（家康は落ち延びる）。`,
        `${fmtSec(240 - (input.waited ? CH2_RULES.waitDelaySec : 0))}ほどで、北東から織田方の援軍が丘へ攻めかかる（地図の「援軍の出る所」）。`,
        `副目標：${secondary.map((d) => d.label).join('・')}。`,
        '追い討ち：撤退の命令で退く部隊は、近くの敵に追われる。本多忠勝隊の「退路の守護」の範囲で退けば、追っ手は忠勝隊に阻まれる。',
    ];
    return finishSetup(input.policy, units, { primary, secondary }, briefing, [{ id: 'ch2_asai_late', unitIds: ['e_oda_late'] }]);
}

// ---------------------------------------------------------------- C：領内の村を守る（村落の地形）

const C_KEY: Zone = { circle: { cx: 0, cz: 42, r: 22 } };
const C_STORE: Zone = { circle: { cx: -135, cz: -23, r: 12 } };

/** 徳川の陣（村の南。兵が少なくても同じ所から始める＝広場へ入る前に第一波を見る） */
const C_POS: Record<TokugawaUnitId | 'village', Pos> = {
    honjin: { x: 0, z: 175, facing: N },
    tadakatsu: { x: 0, z: 135, facing: N },
    yumi: { x: -32, z: 150, facing: N },
    reserve: { x: -72, z: 135, facing: N },
    village: { x: 72, z: 135, facing: N },
};
/** C の波の着く時刻（待たないとき。待てば CH2_RULES.waitDelaySec 早い） */
const C_WAVE_SEC = [20, 110, 200] as const;
function enemiesC(input: Ch2BattleInput, f: number): UnitDef[] {
    const delay = input.waited ? CH2_RULES.waitDelaySec : 0;
    const at = (t: number) => Math.max(1, t - delay);
    const e = (id: string, kind: UnitDef['kind'], name: string, strength: number, x: number, z: number, arriveAt: number | undefined, aim: { x: number; z: number; r: number } | null): UnitDef => ({
        id,
        side: 'enemy',
        clan: 'ronin',
        kind,
        name,
        strength: scaled(strength, f),
        morale: 80,
        x,
        z,
        facing: S,
        ...(arriveAt !== undefined ? { arriveAt } : {}),
        ...(aim ? { aiRole: 'assault' as const, aiTarget: aim } : { aiRole: 'guard_hq' as const }),
    });
    const key = { x: 0, z: 42, r: 22 };
    const lane = { x: 0, z: -23, r: 15 };
    const store = { x: -135, z: -23, r: 12 };
    return [
        e('e_ronin_hq', 'honjin', '浪人衆の頭', 300, 0, -180, undefined, null),
        e('e_ronin_w1_yari', 'yari', '浪人衆の槍（一）', 300, 0, -195, at(C_WAVE_SEC[0]), key),
        e('e_ronin_w1_yumi', 'yumi', '浪人衆の弓（一）', 120, 0, -195, at(C_WAVE_SEC[0]), lane),
        e('e_ronin_w2_yari', 'yari', '浪人衆の槍（二）', 260, -72, -195, at(C_WAVE_SEC[1]), key),
        e('e_ronin_w2_kiba', 'kiba', '浪人衆の騎馬', 180, -72, -195, at(C_WAVE_SEC[1]), store),
        e('e_ronin_w3_yari', 'yari', '浪人衆の槍（三）', 280, 72, -195, at(C_WAVE_SEC[2]), key),
        e('e_ronin_w3_yumi', 'yumi', '浪人衆の弓（二）', 120, 72, -195, at(C_WAVE_SEC[2]), lane),
    ];
}

function setupC(input: Ch2BattleInput, sortie: TokugawaUnitId[], support: Ch2SupportId[], terms: Ch2Terms, f: number, adj: string[]): BattleSetup {
    const pos = C_POS;
    const units: UnitDef[] = [...sortie.map((k) => tokugawaUnit(k, input, pos[k]))];
    if (support.includes('village')) units.push({ id: CH2_UNIT.village, side: 'ally', clan: 'tokugawa', kind: 'yari', name: '村の衆', strength: 150, morale: 70, ...pos.village });
    units.push(...enemiesC(input, f));
    const sec = terms.holdSec ?? CH2_TERMS_TABLE.holdSec.normal;
    const primary: ObjectiveDef = { id: 'ch2_home_hold', type: 'defend_time', label: `庄屋の屋敷前を ${sec / 60} 分守る`, sec, zone: C_KEY, loseSec: 15 };
    const secondary: ObjectiveDef[] = [
        { id: 'ch2_home_store', type: 'defend_zones', label: '米蔵を荒らさせない', sec, zones: [C_STORE], minHeld: 1, loseSec: 15, names: ['米蔵の前'] },
        { id: 'ch2_home_losses', type: 'limit_losses', label: '損害を 3 割以内に抑える', maxRatio: 0.3 },
    ];
    const ronin = input.ch1Result === 'victory' ? '第一章で散った浪人の残りが、別の一団と合わさって' : '第一章の後も国境に居座った浪人衆が、勢いづいて';
    const briefing = [
        FIRST_LINE + '地形は「村落」の演習の地形を使う。',
        `方針：自領の防衛を優先した。${ronin}領内の村へ押し入ろうとしている。織田・浅井のどちらとも戦わない。`,
        input.plan === 'commit' ? `判断：全軍で村を守る。${reserveLine(sortie)}` : '判断：守備隊は城に残し、主力で村を守る。',
        ...adj,
        // 波の時刻。守る時間より後に着く波は、守り切れば合戦が終わるので「守る時間のうちには来ない」
        `敵は北から 3 つの波で来る（${C_WAVE_SEC.map((t0) => {
            const t = Math.max(1, t0 - (input.waited ? CH2_RULES.waitDelaySec : 0));
            const when = t <= 1 ? 'すぐ' : fmtSec(t);
            return t >= sec ? `${when}。守る時間のうちには来ない` : when;
        }).join('・')}。地図の「援軍の出る所」）。槍は庄屋の屋敷前へ攻め進み、騎馬は横道の西の端の米蔵を荒らしに行く。家屋は通れず、矢も通さない。`,
        `勝利：庄屋の屋敷前（広場の真ん中の輪）を ${sec / 60} 分守る。敵だけが 15 秒続けて輪を占めると負け。`,
        '敗北：屋敷前を奪われる、または家康本陣が崩れる（家康は落ち延びる。一度の負けで家が滅ぶことはない）。',
        `副目標：${secondary.map((d) => d.label).join('・')}。`,
        '追い討ち：撤退の命令で退く部隊は、近くの敵に追われる。本多忠勝隊の「退路の守護」の範囲で退けば、追っ手は忠勝隊に阻まれる。',
    ];
    const reinf: ReinfGroup[] = [
        { id: 'ch2_home_wave1', unitIds: ['e_ronin_w1_yari', 'e_ronin_w1_yumi'] },
        { id: 'ch2_home_wave2', unitIds: ['e_ronin_w2_yari', 'e_ronin_w2_kiba'] },
        { id: 'ch2_home_wave3', unitIds: ['e_ronin_w3_yari', 'e_ronin_w3_yumi'] },
    ];
    return finishSetup(input.policy, units, { primary, secondary }, briefing, reinf, sec + 60);
}

// ---------------------------------------------------------------- 共通

/** 合戦の画面の言葉（BattleSetup.story）：題の添え書き・上の札・結果の添え書き。第二章には戦前の約束が無いので約束の欄を出さない */
export const CH2_STORY_NOTE: Readonly<BattleStoryNote> = {
    titleNote: '第一章の直後の、分岐した世界での出来事（創作）',
    tag: '第二章（創作）',
    notes: {
        victory: '第二章の任務を果たした。一度の勝ち戦で情勢が決まるわけではない。',
        defeat: '敗れはしたが、家康は生きている。兵をまとめ直して次に備える。一度の敗北で家が滅ぶことはない。',
        retreat: '勝敗は決まらなかった。兵を失いすぎないうちに引いた。',
    },
    noPledgeRow: true,
};

/** 時刻で現れる敵の組（地図の「援軍の出る所」の名札と、着いた知らせのため。補充で待って時刻が変わっても付ける） */
type ReinfGroup = { id: string; unitIds: string[] };

function finishSetup(
    policy: Policy,
    units: UnitDef[],
    objectives: { primary: ObjectiveDef; secondary: ObjectiveDef[] },
    briefing: string[],
    reinf: ReinfGroup[],
    timeLimitSec?: number,
): BattleSetup {
    const field = CH2_FIELDS[policy];
    const setup = buildBattleSetup(field, units, {
        objectives,
        briefing,
        pursuit: true,
        generalInitiative: false,
        ...(timeLimitSec ? { timeLimitSec } : {}),
    });
    // 地図は演習の戦場の地図の写し（地形・退き口は同じ物。id と名前だけ物語の物。共有の地図は書き換えない）
    setup.map = storyMap(policy);
    // 時刻で現れる敵の組は物語側で付ける（buildBattleSetup が演習の戦場の援軍の地点・時刻から作った物は使わない）
    const ids = new Set(units.map((u) => u.id));
    const groups = reinf.map((g) => ({ id: g.id, side: 'enemy' as const, unitIds: g.unitIds.filter((id) => ids.has(id)) })).filter((g) => g.unitIds.length > 0);
    if (groups.length) setup.reinforcements = groups;
    else delete setup.reinforcements;
    setup.story = { ...CH2_STORY_NOTE, notes: { ...CH2_STORY_NOTE.notes } };
    // 終わり方の判定の順（戦場に決まりがあるときだけ）：説明を渡したので buildBattleSetup は足さない。ここで足す
    const line = setup.endRules ? endRuleBriefingLine(setup) : null;
    if (line) setup.briefing.push(line);
    return setup;
}

/** 兵が少ないときの調整の文（軍議で決めた条件。説明・軍議・結果確認に出す。頭は「第一章の損害で兵が少ないため」） */
export function ch2ThinLine(terms: Ch2Terms): string | null {
    if (!terms.thin) return null;
    const T = CH2_TERMS_TABLE;
    const basis = `軍議の時に出せる兵 ${terms.basisTroops}`;
    return terms.policy === 'oda'
        ? `第一章の損害で兵が少ないため（${basis}）、家康本陣を切れ目寄り（南）から始める（主目標は同じ）。`
        : terms.policy === 'asai'
          ? `第一章の損害で兵が少ないため（${basis}）、連れ帰る兵の条件を ${Math.round(T.escortMinRatio.thin * 10)} 割以上に改めた（ふだんは ${Math.round(T.escortMinRatio.normal * 10)} 割）。`
          : `第一章の損害で兵が少ないため（${basis}）、村の者を南へ逃がすあいだ（${T.holdSec.thin / 60} 分）だけ屋敷前を守ることに改めた（ふだんは ${T.holdSec.normal / 60} 分）。`;
}

/** 調整の文（説明・軍議・結果確認に出す） */
function adjustmentLines(input: Ch2BattleInput, terms: Ch2Terms, support: Ch2SupportId[]): string[] {
    const out: string[] = [enemyMoodLine(input.ch1Result)];
    if (input.waited) out.push(`補充で負傷兵の戻りを待ったため、敵の後詰め・次の波が ${CH2_RULES.waitDelaySec} 秒早く着く。`);
    const thinLine = ch2ThinLine(terms);
    if (thinLine) out.push(thinLine);
    if (support.includes('oda_teppo')) out.push('支援：織田の信頼が厚く、織田の鉄砲隊（弓の扱い）が残って加わる（指揮できる）。');
    if (support.includes('asai_guide')) out.push('支援：浅井の信頼が厚く、浅井の道案内の一隊が加わる（指揮できる）。');
    if (support.includes('village')) out.push('支援：第一章で国境の浪人を退けたことを恩に感じ、村の衆が自ら加わる（指揮できる。兵は少ない）。');
    // 相手の部隊の士気（約束を破った・信頼が冷えた。重ねない）
    if (ch2PartnerColdMorale(input) > 0) {
        const m = CH2_RULES.coldMorale;
        const broke = input.ch1Pledge === 'broken';
        if (input.policy === 'oda') out.push(broke ? `第一章で約束を破ったため、織田勢は徳川を頼みにしていない（織田勢の士気 −${m}）。` : `織田との間は冷えていて、織田勢は徳川を頼みにしていない（織田勢の士気 −${m}）。`);
        else out.push(broke ? `第一章で約束を破ったため、孤立した浅井勢は徳川を頼みにしていない（士気 −${m}）。` : `浅井との間は冷えていて、孤立した浅井勢は徳川を頼みにしていない（士気 −${m}）。`);
    }
    if (input.characters.ieyasu === 'wounded') out.push('家康は第一章の傷が残る（家康本陣の士気 −5）。');
    if (input.characters.tadakatsu === 'wounded') out.push('忠勝は第一章の傷が残る（本多忠勝隊の士気 −10。能力は使える）。');
    return out;
}

/**
 * 第二章の合戦の設定（方針・判断・今の兵・人物・信頼・第一章の結果・補充で待ったか・確定した任務の条件 から毎回同じに作る）。
 * 出陣する部隊と兵は今の兵（補充の後）から、主目標の値と始めの陣は確定した任務の条件（input.terms）から作る（今の兵から求め直さない）。
 * 判断が選べない（ch2PlanAvailability）・条件が方針や判断と合わないときは投げる。
 */
export function ch2BattleSetup(input: Ch2BattleInput): Ch2BattleInfo {
    const av = ch2PlanAvailability(input.plan, input.troops);
    if (!av.available) throw new Error(`この判断は選べません：${av.reason}`);
    const terms = input.terms ?? ch2DecideTerms(input.policy, input.plan, input.troops);
    const bad = ch2TermsProblem(terms, input.policy, input.plan);
    if (bad) throw new Error(bad);
    const sortie = ch2SortieUnits(input.plan, input.troops);
    const support = ch2Support(input);
    const f = CH2_RULES.enemyFactor[input.ch1Result];
    const adj = adjustmentLines(input, terms, support);
    const setup = input.policy === 'oda' ? setupA(input, sortie, support, terms, f, adj) : input.policy === 'asai' ? setupB(input, sortie, support, terms, f, adj) : setupC(input, sortie, support, terms, f, adj);
    const tokugawaIds = new Set<string>(Object.values(IEYASU_UNIT_IDS));
    const partnerUnitIds = setup.units.filter((u) => u.side === 'ally' && !tokugawaIds.has(u.id)).map((u) => u.id);
    return { setup, terms: { ...terms }, sortie, support, thin: terms.thin, adjustments: adj, enemyFactor: f, partnerUnitIds };
}

/**
 * 物語側の合戦の設定の検査（設計 §8）。空なら問題なし。fields/build.ts の validateField・validatePreset と同じ考え方で、
 * 物語が自分で決めた座標（枠を使わない）も確かめる：
 * - 部隊：id の重なり・兵・士気・陣営ごとの数の上限（味方 8・敵 10。sim は数を止めないのでここで止める）・陣営ごとの本陣・
 *   味方の最初の本陣が家康本陣（総大将。sim は陣営の最初の本陣を総大将にする）・置き場所が戦場の中で通れる所・そこから自分の陣営の退き口へ道がある・
 *   敵の行き先（aiTarget）が通れる所でその陣営の退き口から行ける・能力が有る。
 * - 時刻で現れる部隊：着く時刻が合戦の時間の中・時刻で現れる敵はどれも援軍の組（setup.reinforcements）に入っている・組の部隊が有ってその陣営。
 * - 目標：指す部隊の陣営・離脱で要る数 ≤ 本陣のほかの味方の部隊の数・必ず離れる部隊が味方にいる・区域の中心が通れて味方の退き口から行ける・
 *   離脱の出口に味方の退き口が入る・救出の合流区域と安全区域が離れている。
 * - 地図：演習の戦場の地図そのもの（共有の物）ではない写しで、id が ieyasu2_ で始まる。
 */
export function validateChapter2Setup(setup: BattleSetup): string[] {
    const out: string[] = [];
    const map = setup.map;
    const field = Object.values(CH2_FIELDS).find((f) => map.id === `ieyasu2_${f.id}`);
    if (!map.id.startsWith('ieyasu2_')) out.push(`地図の id ${map.id} が ieyasu2_ で始まらない（演習の戦場の地図をそのまま使っている）`);
    if (field && map === fieldMap(field)) out.push('地図が演習の戦場の地図そのもの（共有の物）になっている');
    const env = createFieldEnv(map, { ...(setup.fieldRules ?? {}), pathfinding: true });
    const nav = env.nav!;
    const inside = (x: number, z: number) => Math.abs(x) <= map.width / 2 && Math.abs(z) <= map.depth / 2;
    const ok = (x: number, z: number) => inside(x, z) && isPassable(nav, x, z);
    const exitOf = (side: 'ally' | 'enemy') => map.exits[side];
    const fromExit = (side: 'ally' | 'enemy', x: number, z: number) => {
        const e = exitOf(side);
        return ok(e.x, e.z) && reachable(nav, 'yari', e.x, e.z, x, z);
    };
    for (const side of ['ally', 'enemy'] as const) {
        const e = exitOf(side);
        if (!ok(e.x, e.z)) out.push(`${side} の退き口が通れる所にない`);
    }
    const ids = new Set<string>();
    for (const u of setup.units) {
        if (ids.has(u.id)) out.push(`部隊の id が重なっている：${u.id}`);
        ids.add(u.id);
        if (!(u.strength >= 1)) out.push(`${u.id} の兵が 1 未満`);
        if (!(u.morale > 0 && u.morale <= 100)) out.push(`${u.id} の士気が正しくない`);
        if (u.arriveAt !== undefined && !(u.arriveAt > 0 && u.arriveAt < setup.timeLimitSec)) out.push(`${u.id} の着く時刻 ${u.arriveAt} が合戦の時間の外`);
        if (!ok(u.x, u.z)) out.push(`${u.id} の置き場所 (${u.x},${u.z}) が通れる所にない`);
        else if (!fromExit(u.side, u.x, u.z)) out.push(`${u.id} の置き場所 (${u.x},${u.z}) へ ${u.side} の退き口から道がない`);
        if (u.aiTarget) {
            if (!ok(u.aiTarget.x, u.aiTarget.z)) out.push(`${u.id} の敵の考えの地点が通れる所にない`);
            else if (!fromExit(u.side, u.aiTarget.x, u.aiTarget.z)) out.push(`${u.id} の敵の考えの地点へ ${u.side} の退き口から道がない`);
        }
        if (u.ability !== undefined && !(u.ability in ABILITY_DATA)) out.push(`${u.id} の能力 ${u.ability} がない`);
        if (u.ability !== undefined && !u.leaderId && !u.generalId) out.push(`${u.id} は率いる人物がいないのに能力を持つ`);
    }
    for (const side of ['ally', 'enemy'] as const) {
        const n = setup.units.filter((u) => u.side === side).length;
        if (n > RULES.maxUnitsPerSide[side]) out.push(`${side} の部隊が ${n}（上限 ${RULES.maxUnitsPerSide[side]}）`);
        if (!setup.units.some((u) => u.side === side && u.kind === 'honjin')) out.push(`${side} の本陣がない`);
    }
    // 総大将：味方の最初の本陣が家康本陣（その前に別の本陣を置かない）
    const firstHq = setup.units.find((u) => u.side === 'ally' && u.kind === 'honjin');
    if (firstHq && firstHq.id !== IEYASU_UNIT_IDS.honjin) out.push(`味方の最初の本陣が家康本陣でない（${firstHq.id}）`);
    // 時刻で現れる部隊と援軍の組
    const groups = setup.reinforcements ?? [];
    const gids = new Set<string>();
    for (const g of groups) {
        if (gids.has(g.id)) out.push(`援軍の組の id が重なっている：${g.id}`);
        gids.add(g.id);
        if (g.unitIds.length === 0) out.push(`援軍の組 ${g.id} に部隊がない`);
        for (const id of g.unitIds) {
            const u = setup.units.find((x) => x.id === id);
            if (!u) out.push(`援軍の組 ${g.id} の部隊 ${id} がいない`);
            else if (u.side !== g.side) out.push(`援軍の組 ${g.id} の部隊 ${id} の陣営が違う`);
            else if (u.arriveAt === undefined) out.push(`援軍の組 ${g.id} の部隊 ${id} に着く時刻がない`);
        }
    }
    for (const u of setup.units) {
        if (u.side === 'enemy' && u.arriveAt !== undefined && !groups.some((g) => g.unitIds.includes(u.id))) out.push(`時刻で現れる敵 ${u.id} が援軍の組に入っていない（地図に出る所の名札が無い）`);
    }
    const ally = (id: string) => setup.units.find((u) => u.id === id && u.side === 'ally');
    const enemy = (id: string) => setup.units.find((u) => u.id === id && u.side === 'enemy');
    const defs = [setup.objectives?.primary, ...(setup.objectives?.secondary ?? [])].filter((d): d is ObjectiveDef => !!d);
    const zoneOk = (d: ObjectiveDef, z: Zone, what: string) => {
        const c = zoneCenter(z);
        if (!ok(c.x, c.z)) out.push(`目標 ${d.id} の${what}の中心が通れる所にない`);
        else if (!fromExit('ally', c.x, c.z)) out.push(`目標 ${d.id} の${what}へ味方の退き口から道がない`);
    };
    for (const d of defs) {
        if ((d.type === 'rescue_escort' || d.type === 'preserve_unit' || d.type === 'rescue') && !ally(d.unitId)) out.push(`目標 ${d.id} の部隊 ${d.unitId} が味方にいない`);
        if (d.type === 'break_unit' && !enemy(d.unitId)) out.push(`目標 ${d.id} の部隊 ${d.unitId} が敵にいない`);
        if (d.type === 'withdraw' || d.type === 'escape') {
            for (const r of d.required ?? []) {
                const u = ally(r);
                if (!u) out.push(`目標 ${d.id} の必ず離れる部隊 ${r} が味方にいない`);
                else if (u.kind === 'honjin') out.push(`目標 ${d.id} の必ず離れる部隊 ${r} が本陣（総大将は別に数える）`);
            }
            const others = setup.units.filter((u) => u.side === 'ally' && u.kind !== 'honjin').length;
            if (d.count > others) out.push(`目標 ${d.id} の要る数 ${d.count} が、本陣のほかの味方の部隊 ${others} より多い`);
            if ((d.required ?? []).length > d.count) out.push(`目標 ${d.id} の必ず離れる部隊の数が count より多い`);
            const exits = d.type === 'escape' ? d.exits : [d.exit];
            const e = exitOf('ally');
            if (!exits.some((z) => inZone(z, e.x, e.z))) out.push(`目標 ${d.id}：味方の退き口が出口の区域の中にない（撤退の命令で退いた部隊を数えられない）`);
            exits.forEach((z, i) => zoneOk(d, z, `出口 ${i + 1}`));
        }
        if (d.type === 'rescue_escort') {
            zoneOk(d, d.meetZone, '合流区域');
            zoneOk(d, d.safeZone, '安全区域');
            const mc = zoneCenter(d.meetZone);
            const sc = zoneCenter(d.safeZone);
            if (inZone(d.meetZone, sc.x, sc.z) || inZone(d.safeZone, mc.x, mc.z)) out.push(`目標 ${d.id} の合流区域と安全区域が重なっている`);
            if (!(d.minRatio > 0 && d.minRatio <= 1)) out.push(`目標 ${d.id} の minRatio は 0 より大きく 1 以下`);
        }
        if (d.type === 'defend_time' && d.zone) zoneOk(d, d.zone, '守る区域');
        if (d.type === 'defend_zones') d.zones.forEach((z, i) => zoneOk(d, z, `守る区域 ${i + 1}`));
    }
    return out;
}

/** 物語の味方の部隊の名前（結果確認・会話で使う） */
export function ch2PartnerNames(info: Ch2BattleInfo): string[] {
    return info.setup.units.filter((u) => info.partnerUnitIds.includes(u.id)).map((u) => u.name);
}

/** 確認用：第一章の結果の勢いの倍率（テスト・説明） */
export function ch2EnemyFactor(r: BattleResultKind): number {
    return CH2_RULES.enemyFactor[r];
}
