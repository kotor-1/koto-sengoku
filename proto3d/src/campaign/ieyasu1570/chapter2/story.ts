/**
 * 歴史分岐「元亀元年・家康」第二章の台詞・選択肢・結果確認・区切りの文章。設計：docs/chapter2-design.md §2・§5〜§7。
 *
 * ＊＊ 第一章の直後の、分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない ＊＊
 * - 会話と台詞はすべてゲーム用の創作（実在の人物の実際の発言ではない）。第一章の言葉づかいに合わせる。
 * - 資料で確かめていないこと（地名・日付・人物の動き・逸話）は足さない。信長は出さない（使者が「主」と言うだけ）。
 * - A で長政を味方にしない、B で織田の武将を出さない、C で両家の部隊を出さない（合戦の編成は chapter2/battle.ts）。
 * - 選択肢・説明の数字は、決まり（chapter2/rules.ts・chapter2/battle.ts の CH2_RULES）と合戦の設定から作る（台詞に直書きしない）。
 *
 * ここは文章を作るだけ（状態を書き換えない。three も DOM も使わない）。誰と話せるか・話した後にどう進むかは chapter2/flow.ts。
 */
import type { BattleEndReason, BattleResultKind, ObjectiveResult } from '../../../battle/types';
import { IEYASU_PLEDGE_MIN_RATIO, IEYASU_UNIT_IDS } from '../../../battle/maps';
import { generalById, type GeneralId } from '../../../battle/generals';
import type { ScenarioChoice, ScenarioEndingView, ScenarioLine, ScenarioScript } from '../../scenario';
import {
    INITIAL_TOKUGAWA_TROOPS,
    PLEDGE_SPECS,
    TOKUGAWA_UNIT_IDS,
    type IeyasuCharacterId,
    type PledgeResult,
    type Policy,
    type TokugawaUnitId,
    type TrustId,
} from '../state';
import {
    IEYASU_CHARACTER_NAMES,
    IEYASU_ENDING_TITLES,
    IEYASU_RESULT_LABELS,
    IEYASU_STATUS_LABELS,
    POLICY_DONE_LABELS,
    SHOWN_TRUST_IDS,
    TOKUGAWA_UNIT_NAMES,
    TRUST_NAMES,
    ieyasuReasonLabel,
    supportSourceName,
} from '../story';
import { CH2_RULES, ch2PartnerNames, ch2PlanAvailability, ch2SortieTroops, type Ch2Plan, type Ch2SupportId } from './battle';
import { CH2_RECOVERY, availableCh2Plans, ch2Losses, ch2PartnerOf, ch2RecoveryOptions, ch2TrustDelta, ieyasu2BattleInfo, type RecoveryOption } from './rules';
import { ieyasu2TalkFlag, type Chapter1Record, type Ieyasu2EndingId, type Ieyasu2State, type Ieyasu2TalkId, type RecoveryChoice } from './state';

// ---- 画面に常に出す注記・名前 ----

export const IEYASU2_CHAPTER_TITLE = '歴史分岐　元亀元年・家康　第二章';
export const IEYASU2_NOTE =
    '第二章は、第一章の直後の、分岐した世界での出来事です。特定の史実の合戦を再現したものではありません。会話・出来事・戦場・兵数・特殊能力・結末はゲーム用の創作です。';
/** 合戦の場の呼び方 */
export const IEYASU2_FIELD_LABEL = '第一章の直後の分岐した世界（創作）';
export const IEYASU2_END_LABEL = '元亀元年・家康　第二章　完（歴史分岐シナリオ。この先は未実装。会話と分岐後の出来事は創作）';
export const IEYASU2_RECORD_TITLE = '第一章の結果（第二章へ引き継ぐもの）';

export const IEYASU2_PHASE_LABELS: Readonly<Record<Ieyasu2State['phase'], string>> = {
    explore: '第二章・城下',
    council: '第二章・軍議',
    muster: '第二章・出陣の支度',
    battle: '第二章・出陣前',
    aftermath: '第二章・戦の後',
    ending: '第二章の区切り',
};

/** 任務の名前（方針ごと） */
export const CH2_MISSION_TITLES: Readonly<Record<Policy, string>> = { oda: '織田勢の撤収を支える', asai: '孤立した浅井勢を救う', home: '領内の村を守る' };

/** 判断の名前（方針ごと。判断 1 commit・判断 2 hold） */
export const CH2_PLAN_LABELS: Readonly<Record<Policy, Readonly<Record<Ch2Plan, string>>>> = {
    oda: { commit: '殿を引き受ける', hold: '退き口の手前を固める' },
    asai: { commit: '南から急いで救う', hold: '西の筋から救う' },
    home: { commit: '全軍で村を守る', hold: '守備隊は城に残す' },
};
/** 判断ごとの始めの陣（説明。数は合戦の設定から） */
const PLAN_POS: Readonly<Record<Policy, Readonly<Record<Ch2Plan, string>>>> = {
    oda: { commit: '北の丘の前で殿を務める（織田勢は先に切れ目へ退く）', hold: '切れ目の北の口を固める（織田勢は北の原から自分で退いてくる）' },
    asai: { commit: '南の陣から丘へ向かう', hold: '西の林の縁の筋（小丘の近く）から始める' },
    home: { commit: '村の南に、守備隊も並べて陣を敷く', hold: '村の南に、主力で陣を敷く（守備隊は城に残る）' },
};
export const RECOVERY_LABELS: Readonly<Record<RecoveryChoice, string>> = { wait: '負傷兵の戻りを待つ', transfer: '守備隊から兵を回す', none: '今の兵で出る' };
export const CH2_SUPPORT_NAMES: Readonly<Record<Ch2SupportId, string>> = { oda_teppo: '織田の鉄砲隊', asai_guide: '浅井の道案内', village: '村の衆' };

const generalName = (id: GeneralId) => generalById(id)!.name;

/** 城下の人物・物の名前（使いは方針ごと） */
export function ieyasu2TalkName(policy: Policy, id: Exclude<Ieyasu2TalkId, 'council'>): string {
    switch (id) {
        case 'tadakatsu':
            return '本多忠勝';
        case 'ishikawa':
            return generalName('ishikawa');
        case 'envoy':
            return policy === 'oda' ? '織田家の使者' : policy === 'asai' ? '浅井家の使者' : '村の使い';
        case 'notice':
            return '高札';
        case 'gate':
            return '城門（出陣）';
    }
}

/** 第二章の合戦の終わった理由 */
export function ieyasu2ReasonLabel(policy: Policy, reason: BattleEndReason): string {
    switch (reason) {
        case 'objective_done':
            return '主目標を果たした';
        case 'objective_failed':
            return '主目標を果たせなかった（家康は落ち延びた）';
        case 'enemy_hq_routed':
            return policy === 'oda' ? '浅井・朝倉の追撃の本隊が崩れた' : policy === 'asai' ? '織田方の本陣が崩れた' : '浪人衆の頭が崩れた';
        case 'enemy_army_broken':
            return '敵の本陣以外の部隊がすべて戦えなくなった';
        case 'ally_hq_routed':
            return '家康本陣が崩れた（家康は落ち延びた）';
        case 'ally_army_broken':
            return '味方の部隊が崩れ、戦える部隊がなくなった';
        case 'ordered_retreat':
            return '撤退を命じ、兵をまとめて退いた';
        case 'nightfall':
            return '日が暮れ、両軍が兵を引いた';
    }
}

// ---- 行を作る小道具 ----

type Speaker = 'hero' | 'tadakatsu' | 'sakai' | 'ishikawa' | 'oda_envoy' | 'asai_envoy' | 'village';
const SPEAKER_NAMES: Record<Speaker, string> = {
    hero: '家康',
    tadakatsu: '忠勝',
    sakai: generalName('sakai'),
    ishikawa: generalName('ishikawa'),
    oda_envoy: '織田家の使者',
    asai_envoy: '浅井家の使者',
    village: '村の使い',
};
const say = (speaker: Speaker, text: string): ScenarioLine => ({ speaker, name: SPEAKER_NAMES[speaker], text });
const narrate = (text: string): ScenarioLine => ({ speaker: 'narration', name: '', text });
const notice = (text: string): ScenarioLine => ({ speaker: 'notice', name: '高札', text });
const H = (t: string) => say('hero', t);
const T = (t: string) => say('tadakatsu', t);
const SK = (t: string) => say('sakai', t);
const IK = (t: string) => say('ishikawa', t);
const envoySpeaker = (p: Policy): Speaker => (p === 'oda' ? 'oda_envoy' : p === 'asai' ? 'asai_envoy' : 'village');
const E = (p: Policy, t: string) => say(envoySpeaker(p), t);

const talked = (s: Ieyasu2State, id: Ieyasu2TalkId, phase: Ieyasu2State['phase'] = s.phase) => s.talked[ieyasu2TalkFlag(phase, id)] === true;
export const signed = (n: number): string => (n > 0 ? `+${n}` : n === 0 ? '±0' : String(n));
const pct = (r: number) => `${Math.round(r * 100)}%`;
const sum = (r: Partial<Record<TokugawaUnitId, number>>) => TOKUGAWA_UNIT_IDS.reduce((n, k) => n + (r[k] ?? 0), 0);

// ---- 第一章の記録の読み方 ----

/** 第一章の約束の読み方（引き受けなかったのは約束違反ではない） */
export function ch1PledgeText(rec: Chapter1Record): string {
    const t = PLEDGE_SPECS[rec.policy].targetName;
    const r = rec.pledge.result;
    if (r === 'declined') return `引き受けなかった（${t}の退路を守る約束。引き受けなかったのは約束違反ではない）`;
    if (r === 'kept') return `守った（${t}の退路を守る約束）`;
    return `守れなかった（${t}の退路を守る約束）`;
}

/** 第一章の約束を、斬り合う前に退いて果たせなかったか（第一章の pledgeUnfought と同じ決まり） */
function ch1Unfought(rec: Chapter1Record): boolean {
    if (rec.pledge.result !== 'broken') return false;
    const u = rec.battle.units.find((x) => x.id === rec.pledge.targetId);
    if (!u || u.status === 'routed' || u.status === 'destroyed') return false;
    return u.startStrength > 0 && u.endStrength >= u.startStrength * IEYASU_PLEDGE_MIN_RATIO - 1e-9;
}

/** 第一章の援兵の読み方（第一章で受け取り済み・兵に含む。第二章では足さない） */
export function ch1ReinforcementText(rec: Chapter1Record): string {
    const s = rec.support;
    if (!s.reinforcement || !s.from) return 'なし';
    return `${supportSourceName(s.from)}から兵 +${s.recovered}（第一章で受け取り済み・今の兵に含む。第二章では足さない）`;
}

function ch1SideText(rec: Chapter1Record): string {
    const rows = rec.sideObjectives;
    if (rows === null) return '記録なし（副目標を記録していなかった版の保存から続けた）';
    if (rows.length === 0) return '記録なし';
    return rows.map((r) => `${r.label}：${r.achieved ? '果たした' : '果たせなかった'}`).join('・');
}

const unitsLine = (from: Record<TokugawaUnitId, number>, to: Record<TokugawaUnitId, number>) => TOKUGAWA_UNIT_IDS.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${from[k]} → ${to[k]}`).join('・');
const troopsNow = (t: Record<TokugawaUnitId, number>) => TOKUGAWA_UNIT_IDS.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${t[k]}`).join('・');
const trustLine = (t: Record<TrustId, number>) => SHOWN_TRUST_IDS.map((c) => `${TRUST_NAMES[c]} ${signed(t[c])}`).join('・');
function peopleOf(policy: Policy): IeyasuCharacterId[] {
    return policy === 'asai' ? ['ieyasu', 'tadakatsu', 'nagamasa'] : ['ieyasu', 'tadakatsu'];
}
const peopleLine = (s: Pick<Ieyasu2State, 'policy' | 'characters'>) => peopleOf(s.policy).map((c) => `${IEYASU_CHARACTER_NAMES[c]} ${IEYASU_STATUS_LABELS[s.characters[c]]}`).join('・');

// ---- 第二章で効くこと（結果確認・状態の説明。数は決まりから） ----

/** 支援の有無とその理由 */
export function ch2SupportOutlook(s: Pick<Ieyasu2State, 'policy' | 'trust' | 'chapter1'>): string {
    const R = CH2_RULES;
    if (s.policy === 'oda')
        return s.trust.oda >= R.supportTrust.oda
            ? `織田の鉄砲隊が加わる（織田家の信頼 ${s.trust.oda} が ${R.supportTrust.oda} 以上）`
            : `なし（織田家の信頼 ${s.trust.oda} が ${R.supportTrust.oda} に届かない）`;
    if (s.policy === 'asai')
        return s.trust.asai >= R.supportTrust.asai
            ? `浅井の道案内が加わる（浅井家の信頼 ${s.trust.asai} が ${R.supportTrust.asai} 以上）`
            : `なし（浅井家の信頼 ${s.trust.asai} が ${R.supportTrust.asai} に届かない）`;
    return s.chapter1.battle.result === 'victory' ? '村の衆が自ら加わる（第一章で国境の浪人衆を退けた）' : 'なし（第一章で浪人衆を退けられなかった）';
}

/** 相手の部隊の士気・忠勝隊の士気 */
function moraleOutlook(s: Pick<Ieyasu2State, 'policy' | 'trust'>): string {
    const R = CH2_RULES;
    const out: string[] = [];
    const partner = ch2PartnerOf(s.policy);
    if (partner) {
        const v = s.trust[partner];
        out.push(v < R.coldTrust ? `${s.policy === 'oda' ? '織田勢' : '浅井勢'}の士気 −${R.coldMorale}（${TRUST_NAMES[partner]}の信頼 ${v} が ${R.coldTrust} 未満。徳川を頼みにしない）` : `${s.policy === 'oda' ? '織田勢' : '浅井勢'}の士気は変わらない（${TRUST_NAMES[partner]}の信頼 ${v}）`);
    } else out.push('両家の部隊は出ない（自領の防衛）');
    const t = s.trust.tadakatsu;
    const tk = R.tadakatsuTrust;
    out.push(t >= tk.hi ? `本多忠勝隊の士気 +${tk.delta}（忠勝の信頼 ${t} が ${tk.hi} 以上）` : t < tk.lo ? `本多忠勝隊の士気 −${tk.delta}（忠勝の信頼 ${t} が ${tk.lo} 未満）` : `本多忠勝隊の士気は変わらない（忠勝の信頼 ${t}）`);
    return out.join('。');
}

/** 負傷の影響 */
function woundOutlook(s: Pick<Ieyasu2State, 'policy' | 'characters'>): string {
    const R = CH2_RULES;
    const out: string[] = [];
    if (s.characters.ieyasu === 'wounded') out.push(`家康：家康本陣の士気 −${R.woundedMorale.ieyasu}`);
    if (s.characters.tadakatsu === 'wounded') out.push(`忠勝：本多忠勝隊の士気 −${R.woundedMorale.tadakatsu}（能力は使える）`);
    if (s.policy === 'asai' && s.characters.nagamasa === 'wounded') out.push('長政：孤立した隊は「浅井勢の後備え」（武将なし・能力なし）になる');
    return out.length ? out.join('。') : 'なし（負傷した人物はいない）';
}

/** 兵が少ないときの調整の見込み */
function thinOutlook(s: Pick<Ieyasu2State, 'policy' | 'troops'>): string {
    const R = CH2_RULES;
    const parts: string[] = [];
    for (const plan of ['commit', 'hold'] as const) {
        const av = ch2PlanAvailability(plan, s.troops);
        const label = CH2_PLAN_LABELS[s.policy][plan];
        if (!av.available) {
            parts.push(`「${label}」は選べない見込み（${av.reason}）`);
            continue;
        }
        const n = ch2SortieTroops(plan, s.troops);
        if (n < R.thinTroops) parts.push(`「${label}」では出る兵 ${n}（${R.thinTroops} 未満）のため、陣・主目標を改める見込み`);
    }
    return parts.length ? parts.join('。') : `なし（どちらの判断でも出る兵が ${R.thinTroops} 以上）`;
}

/** 補充で戻る割合 */
function recoveryOutlook(s: Pick<Ieyasu2State, 'trust' | 'troops'>): string {
    const R = CH2_RECOVERY;
    const rate = s.trust.ishikawa >= R.trustedAt ? R.trustedRate : R.rate;
    const lost = sum(ch2Losses(s.troops));
    return `負傷兵の戻りを待つと、第一章で失った兵（${lost}）の ${pct(rate)}（石川数正の信頼 ${s.trust.ishikawa}${s.trust.ishikawa >= R.trustedAt ? ` が ${R.trustedAt} 以上` : ''}）が戻る。代わりに敵の後詰めが ${CH2_RULES.waitDelaySec} 秒早く着く`;
}

function enemyOutlook(r: BattleResultKind): string {
    const f = CH2_RULES.enemyFactor[r];
    return `敵の兵 ×${f}（第一章の${IEYASU_RESULT_LABELS[r]}${r === 'victory' ? '。敵の勢いは鈍っている' : r === 'defeat' ? '。敵は勢いづいている' : '。勢いはそのまま'}）`;
}

// ================= 第一章の結果確認（移った直後に 1 回） =================

export function ieyasu2Chapter1RecordView(s: Ieyasu2State): ScenarioEndingView {
    const c = s.chapter1;
    const record = [
        { label: '方針', value: POLICY_DONE_LABELS[c.policy] },
        { label: '合戦の結果', value: `${IEYASU_RESULT_LABELS[c.battle.result]}：${ieyasuReasonLabel(c.policy, c.battle.reason)}` },
        { label: '部隊ごとの兵', value: `${unitsLine(INITIAL_TOKUGAWA_TROOPS, c.troops)}（第一章のはじめ → 今）` },
        { label: '約束', value: ch1PledgeText(c) },
        { label: '援兵', value: ch1ReinforcementText(c) },
        { label: '信頼', value: trustLine(c.trust) },
        { label: '人物', value: peopleLine({ policy: c.policy, characters: c.characters }) },
        { label: '副目標', value: ch1SideText(c) },
        { label: '第二章の任務', value: CH2_MISSION_TITLES[c.policy] },
        { label: '効くこと：支援', value: ch2SupportOutlook(s) },
        { label: '効くこと：補充', value: recoveryOutlook(s) },
        { label: '効くこと：敵の勢い', value: enemyOutlook(c.battle.result) },
        { label: '効くこと：士気', value: moraleOutlook(s) },
        { label: '効くこと：負傷', value: woundOutlook(s) },
        { label: '効くこと：兵が少ないとき', value: thinOutlook(s) },
    ];
    const body = [
        `第一章の結末「${IEYASU_ENDING_TITLES[c.ending]}」。この結果を引き継いで、第二章を始める。`,
        IEYASU2_NOTE,
    ];
    return { id: `ch1_record_${c.policy}`, title: IEYASU2_RECORD_TITLE, body, record, footer: '方針・兵・信頼・人物・約束の結果は、第二章でも変わらずに残る（第一章の記録は書き換えない）。' };
}

/** メニューの「状態」の第一章の行 */
export function ch1SummaryText(c: Chapter1Record): string {
    return `${POLICY_DONE_LABELS[c.policy]}・${IEYASU_RESULT_LABELS[c.battle.result]}・約束：${c.pledge.result ? { kept: '守った', broken: '守れなかった', declined: '引き受けなかった' }[c.pledge.result] : '—'}・援兵：${c.support.reinforcement ? `+${c.support.recovered}（受け取り済み）` : 'なし'}`;
}

// ================= 台詞 =================

/** 今の段階の、その相手の台詞。居るかどうかの検査は flow.ts（talk）が先に行う */
export function ieyasu2ScriptFor(state: Ieyasu2State, id: Ieyasu2TalkId): ScenarioScript {
    switch (state.phase) {
        case 'explore':
            return exploreScript(state, id);
        case 'council':
            return councilScript(state);
        case 'muster':
            return musterScript(state, id);
        case 'aftermath':
            return aftermathScript(state, id);
        default:
            throw new Error(`この段階（${state.phase}）に会話はありません`);
    }
}

// ================= 探索 =================

const SITUATION: Readonly<Record<Policy, Readonly<Record<BattleResultKind, string>>>> = {
    oda: {
        victory: '先の戦で、浅井・朝倉の勢は退きました。されど、近江の戦はまだ続いております。',
        retreat: '先の戦は決着がつかぬまま、兵を引きました。浅井・朝倉の勢は、なお近くに構えております。',
        defeat: '先の戦で本陣が崩れ、浅井・朝倉の勢は勢いづいております。',
    },
    asai: {
        victory: '先の戦で、織田方の追撃は止まりました。ただ、織田方はまだ兵を引いておりませぬ。',
        retreat: '先の戦は決着がつかず、織田方の兵はなお近くにおります。',
        defeat: '先の戦で本陣が崩れ、織田方は勢いづいております。',
    },
    home: {
        victory: '先の戦で国境の浪人どもは散りました。されど、その残りが別の一団と合わさり、また動いております。',
        retreat: '国境の浪人どもは居座ったまま、勢いづいております。',
        defeat: '国境の浪人どもは居座ったまま、勢いづいております。先の戦で崩れた陣を、侮っておるのでしょう。',
    },
};
const MISSION_LINE: Readonly<Record<Policy, string>> = {
    oda: '織田家の使者が来ております。織田勢が陣を引くので、その撤収を支えてほしいとのこと。',
    asai: '浅井家の使者が来ております。浅井勢の一隊が、丘の上で織田方に囲まれているとのこと。',
    home: '村の使いが来ております。浪人衆が、領内の村へ押し入ろうとしていると。',
};

const INTRO_LINE: Readonly<Record<Policy, string>> = {
    oda: '織田家の使者が来ている。織田勢の撤収を支えてほしいという。',
    asai: '浅井家の使者が来ている。浅井勢の一隊が、丘の上で囲まれているという。',
    home: '村の使いが来ている。浪人衆が、領内の村へ押し入ろうとしているという。',
};

function exploreScript(state: Ieyasu2State, id: Ieyasu2TalkId): ScenarioScript {
    const p = state.policy;
    const c = state.chapter1;
    const again = talked(state, id);
    switch (id) {
        case 'tadakatsu': {
            const choices: ScenarioChoice[] = [
                { id: 'open_council', label: '軍議を開く', detail: '今回の判断（2 つのうち 1 つ）を決める軍議へ進みます' },
                { id: 'not_yet', label: 'もう少し話を聞いて回る' },
            ];
            if (again) return { id: 'ch2.explore.tadakatsu.again', talk: id, lines: [T('皆、広間に控えております。軍議を開かれますか。')], choices, defaultChoice: 0 };
            const lines: ScenarioLine[] = [
                narrate('第一章の戦から、数日がたった。（ここからは、第一章の直後の分岐した世界での出来事。会話と出来事はゲーム用の創作）'),
                T('殿。'),
                T(SITUATION[p][c.battle.result]),
                T(MISSION_LINE[p]),
            ];
            let key = `${p}.${c.battle.result}`;
            if (p === 'home') {
                // C の約束の相手は忠勝（守備隊を退かせる約束）
                key += `.${c.pledge.result}`;
                const pl = c.pledge.result;
                lines.push(
                    pl === 'kept'
                        ? T('先の戦では、守備隊を退かせる約束を果たしていただきました。あの者たちも、また働くと申しております。')
                        : pl === 'broken'
                          ? T('先の戦で、守備隊を退かせきれなんだのは……拙者の頼みでもございました。こたびは、取り返しましょう。')
                          : T('先の戦で拙者の頼みを引き受けられなかったのは、殿のお考え。責める者はおりませぬ。'),
                );
            }
            if (state.characters.tadakatsu === 'wounded') lines.push(T('拙者の傷は、まだ癒えきっておりませぬ。されど、槍は振るえます。'));
            if (state.characters.ieyasu === 'wounded') lines.push(H('（先の戦の傷が、まだ痛む。）'));
            lines.push(
                talked(state, 'ishikawa') && talked(state, 'envoy')
                    ? T('皆の話はお聞きになりましたな。軍議を開きましょう。')
                    : T('石川殿が、先の戦の後の兵の数をまとめております。使いの話も聞かれてから、軍議を開きましょう。'),
            );
            return { id: `ch2.explore.tadakatsu.${key}`, talk: id, lines, choices, defaultChoice: 0 };
        }
        case 'ishikawa': {
            if (again) return { id: 'ch2.explore.ishikawa.again', talk: id, lines: [IK('兵の数は、先に申し上げたとおりにございます。補うかどうかは、出陣の前に。')] };
            const lost = ch2Losses(state.troops);
            const lines: ScenarioLine[] = [
                IK('先の戦の後の兵を、まとめてまいりました。'),
                narrate(`（${TOKUGAWA_UNIT_IDS.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${state.troops[k]}／${INITIAL_TOKUGAWA_TROOPS[k]}`).join('・')}。第一章で失ったまま：${sum(lost)}）`),
            ];
            const pl = c.pledge.result as PledgeResult;
            if (pl === 'kept' && c.support.reinforcement && c.support.from) {
                lines.push(
                    c.support.recovered > 0
                        ? IK(`${supportSourceName(c.support.from)}からの援兵 ${c.support.recovered} は、すでに受け取り、この数に入っております。重ねて数えることはございませぬ。`)
                        : IK(`${supportSourceName(c.support.from)}からの援兵は、兵に欠けがなかったゆえ、受け取るまでもございませなんだ。`),
                );
            } else if (pl === 'broken') lines.push(IK('先の約束を果たせなんだゆえ、援兵はございませぬ。'));
            else lines.push(IK('先の頼みは引き受けなんだゆえ、援兵はございませぬ。約束を破ったわけではございませぬゆえ、責められる筋もございませぬ。'));
            const heavy = TOKUGAWA_UNIT_IDS.some((k) => state.troops[k] < INITIAL_TOKUGAWA_TROOPS[k] * 0.4);
            lines.push(heavy ? IK('失った兵は少なくありませぬ。兵を補うかどうかは、出陣の前に決めねばなりませぬ。') : IK('兵を補うかどうかは、出陣の前に決めねばなりませぬ。軍議の後に、改めて申し上げます。'));
            return { id: `ch2.explore.ishikawa.${pl}`, talk: id, lines };
        }
        case 'envoy':
            return exploreEnvoy(state, again);
        case 'notice':
            return {
                id: `ch2.explore.notice.${p}`,
                talk: id,
                lines: [
                    notice('一、先の戦の後なり。町の者は騒がず、家業に励むべし。'),
                    notice(p === 'oda' ? '一、近江より兵が戻る。道を空けておくべし。' : p === 'asai' ? '一、他家への助勢の噂あり。みだりに言いふらすべからず。' : '一、国境の村々に浪人の一団あり。村の者は城の指図を待つべし。'),
                    narrate(`（${IEYASU2_NOTE}）`),
                ],
            };
        default:
            throw new Error(`第二章の城下に ${id} は居ません`);
    }
}

function exploreEnvoy(state: Ieyasu2State, again: boolean): ScenarioScript {
    const p = state.policy;
    const c = state.chapter1;
    const pl = c.pledge.result as PledgeResult;
    if (p === 'home') {
        const key = c.battle.result === 'victory' ? 'victory' : 'other';
        if (again) return { id: `ch2.explore.envoy.home.${key}.again`, talk: 'envoy', lines: [E(p, '村の者は、殿のお出ましを待っております。')] };
        const lines: ScenarioLine[] =
            key === 'victory'
                ? [
                      E(p, '先には国境の浪人どもを追い払っていただき、村の者は皆、恩に感じております。'),
                      E(p, 'その残りが、また村へ来ると噂しております。若い者が、槍を持って加わると申しております。'),
                  ]
                : [E(p, '浪人どもが、また村へ来ると噂しております。'), E(p, '村の者だけでは、とても守れませぬ。どうか、お助けを。')];
        lines.push(narrate('（村の使いの言葉と、この頼みはゲーム用の創作）'));
        return { id: `ch2.explore.envoy.home.${key}`, talk: 'envoy', lines };
    }
    const partner = p === 'oda' ? 'oda' : 'asai';
    const trust = state.trust[partner];
    const R = CH2_RULES;
    if (again) return { id: `ch2.explore.envoy.${p}.${pl}.again`, talk: 'envoy', lines: [E(p, p === 'oda' ? '織田勢の撤収のこと、よきご返事を。' : '丘の上の者たちのこと、どうか。')] };
    const lines: ScenarioLine[] = [];
    // 第一章の約束の結果で言い方を変える（守った＝厚い・破った＝冷たい・引き受けなかった＝違反としては扱わない）
    if (p === 'oda') {
        lines.push(
            pl === 'kept'
                ? E(p, '先の戦では、援軍の退路を守っていただいた。主は徳川殿を頼みにしております。')
                : pl === 'broken'
                  ? E(p, '……先の戦では、約束の退路は守られなんだ。主は、それを忘れてはおりませぬ。されど、今は手が足りませぬ。')
                  : E(p, '先の戦では、頼みは引き受けていただけなんだが、それは徳川殿のお考え。約束を違えたとは申しませぬ。'),
            E(p, '織田勢が陣を引きます。その撤収を、徳川殿に支えていただきたい。'),
        );
        if (trust >= R.supportTrust.oda) lines.push(E(p, '鉄砲の一隊を残して、徳川殿の指図に従わせよと、主は申しております。'));
        if (trust < R.coldTrust) lines.push(E(p, '……正直に申せば、織田勢の者どもは徳川殿をあまり頼みにしておりませぬ。'));
    } else {
        const nagamasa = state.characters.nagamasa === 'alive';
        lines.push(
            pl === 'kept'
                ? E(p, '先の戦では、主の隊の退き口を守っていただいた。そのご恩は忘れませぬ。')
                : pl === 'broken'
                  ? E(p, '……先の戦では、約束の退き口は守られなんだ。皆、まだ胸に残しております。されど、頼れるのは徳川殿だけ。')
                  : E(p, '先の戦では、頼みは引き受けていただけなんだ。それはそれと、主も申しております。'),
            nagamasa
                ? E(p, '主の長政が率いる一隊が、丘の上で織田方に囲まれております。どうか、救っていただきたい。')
                : E(p, '主の長政は先の戦の傷が癒えず、後に残っております。丘の上で囲まれているのは、浅井勢の後備えです。どうか、救っていただきたい。'),
        );
        if (trust >= R.supportTrust.asai) lines.push(E(p, '道を知る者を一隊お付けします。徳川殿の指図に従わせます。'));
        if (trust < R.coldTrust) lines.push(E(p, '……丘の上の者どもは、徳川殿が来るとは思うておらぬでしょう。'));
    }
    lines.push(narrate('（使者の言葉と、この頼みはゲーム用の創作）'));
    return { id: `ch2.explore.envoy.${p}.${pl}`, talk: 'envoy', lines };
}

// ================= 軍議 =================

const COUNCIL_OPINIONS: Readonly<Record<Policy, readonly ScenarioLine[]>> = {
    oda: [
        SK('殿を引き受ければ、織田勢は先に退けまする。ただ、追っ手を正面から受けるのは徳川になりまする。'),
        IK('退き口の手前を固めるなら、守備隊は城に残せまする。織田勢が自分で退いてくる間が、危のうございますが。'),
    ],
    asai: [
        SK('南から急げば、早く丘に着けまする。囲みの南を破るのが要にござる。'),
        IK('西の筋から行けば、守備隊は城に残せまする。西の囲みを矢で誘い出す手もございます。'),
    ],
    home: [
        SK('全軍で守れば、屋敷の前は厚くなりまする。浪人の騎馬は、米蔵を狙ってまいりましょう。'),
        IK('守備隊まで出せば、城は空になりまする。拙者は、守備隊は残したく存じます。'),
    ],
};

const CONFIRM_LINES: Readonly<Record<Policy, Readonly<Record<Ch2Plan, readonly ScenarioLine[]>>>> = {
    oda: {
        commit: [SK('殿を務めるなら、本陣も退き口へ急がれませ。追っ手は忠勝が止めまする。'), IK('城は空きますが、守備隊の働きどころにございます。')],
        hold: [SK('織田勢が北から退いてくる間、切れ目の口を空けてはなりませぬ。'), IK('守備隊は城に残します。出る兵は少のうございますぞ。')],
    },
    asai: {
        commit: [SK('急げば、援軍が来る前に丘へ着けまする。'), IK('城は空きますが、急ぐなら兵は多い方がよい。')],
        hold: [SK('西の囲みを誘い出せば、丘への道が開きまする。'), IK('守備隊は城に残します。出る兵は少のうございますぞ。')],
    },
    home: {
        commit: [SK('屋敷の前は厚くなりまする。'), IK('……城は空になります。拙者は気が進みませぬが、お決めなら従いまする。')],
        hold: [SK('主力だけでも、屋敷の前は守れまする。'), IK('城の守りは、守備隊にお任せを。')],
    },
};

/** 判断の選択肢の説明（出る部隊・始めの陣・主目標・戦後の信頼・代償。数は合戦の設定と決まりから） */
export function planChoice(state: Ieyasu2State, plan: Ch2Plan): ScenarioChoice {
    const p = state.policy;
    const info = ieyasu2BattleInfo(state, plan);
    const strengthOf = (k: TokugawaUnitId) => info.setup.units.find((u) => u.id === IEYASU_UNIT_IDS[k])?.strength ?? state.troops[k];
    const units = info.sortie.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${strengthOf(k)}`).join('・');
    const total = info.sortie.reduce((n, k) => n + strengthOf(k), 0);
    const partners = ch2PartnerNames(info);
    const prim = info.setup.objectives?.primary?.label ?? '—';
    const dv = ch2TrustDelta(p, plan, 'victory');
    const dr = ch2TrustDelta(p, plan, 'retreat');
    const dd = ch2TrustDelta(p, plan, 'defeat');
    const partner = ch2PartnerOf(p);
    const trustText = partner
        ? `${TRUST_NAMES[partner]}：勝利 ${signed(dv[partner])}・撤退 ${signed(dr[partner])}・敗北 ${signed(dd[partner])}`
        : '織田家・浅井家：動かない（両家の部隊は出ない）';
    const cost =
        plan === 'commit'
            ? `岡崎の守備隊も出す（城が空く。戦後、${TRUST_NAMES.ishikawa}の信頼 ${signed(dv.ishikawa)}）`
            : '岡崎の守備隊は城に残る（出る兵が少ない）';
    const thinLine = info.adjustments.find((l) => l.startsWith('第一章の損害で兵が少ないため'));
    return {
        id: plan === 'commit' ? 'plan_commit' : 'plan_hold',
        label: CH2_PLAN_LABELS[p][plan],
        detail: `出る部隊：${units}（合わせて ${total}）。味方：${partners.length ? partners.join('・') : 'なし'}。始めの陣：${PLAN_POS[p][plan]}。主目標：${prim}。戦後の信頼：${trustText}。代償：${cost}。${thinLine ?? ''}`,
        summary: `出る兵 ${total}・${plan === 'commit' ? '守備隊も出す' : '守備隊は城に残す'}`,
    };
}

function councilScript(state: Ieyasu2State): ScenarioScript {
    const p = state.policy;
    const pend = state.pendingPlan;
    if (pend) {
        return {
            id: `ch2.council.confirm.${p}.${pend}`,
            talk: 'council',
            lines: [T(`${CH2_PLAN_LABELS[p][pend]}。${PLAN_POS[p][pend]}。`), ...CONFIRM_LINES[p][pend], T('この手で、よろしいか。')],
            choices: [
                { id: 'confirm_plan', label: 'それで決める', detail: '決めた後は変えられません' },
                { id: 'reconsider', label: '考え直す' },
            ],
            defaultChoice: 0,
        };
    }
    const plans = availableCh2Plans(state);
    const choices = plans.map((pl) => planChoice(state, pl));
    // 選べない判断は選択肢に出さず、理由を 1 行述べる
    const blocked: ScenarioLine[] = (['commit', 'hold'] as const)
        .filter((pl) => !plans.includes(pl))
        .map((pl) => T(`「${CH2_PLAN_LABELS[p][pl]}」は取れませぬ。${ch2PlanAvailability(pl, state.troops).reason ?? ''}。`));
    // 兵が少ないときの調整（合戦の設定の調整の文から）
    const thin: ScenarioLine[] = [];
    for (const pl of plans) {
        const line = ieyasu2BattleInfo(state, pl).adjustments.find((l) => l.startsWith('第一章の損害で兵が少ないため'));
        if (line) thin.push(T(plans.length > 1 ? `（${CH2_PLAN_LABELS[p][pl]}の場合）${line}` : line));
    }
    if (talked(state, 'council')) {
        return { id: 'ch2.council.again', talk: 'council', lines: [T('改めて、いずれの手を取られますか。'), ...blocked], choices, defaultChoice: 0 };
    }
    const lines: ScenarioLine[] = [
        narrate('城の広間に、主だった者が集まった。酒井忠次・石川数正の顔も見える。（ここからの話し合いと選択は、ゲーム用の創作）'),
        T(`こたびの務めは「${CH2_MISSION_TITLES[p]}」。手は二つと存じます。`),
        ...COUNCIL_OPINIONS[p],
        ...thin,
        ...blocked,
        ...(thin.length || blocked.length ? [IK('兵の補い方は、軍議の後の支度で申し上げます。補えば、出せる部隊も増えましょう。ただし、どの手にも代わりに払うものがございます。')] : []),
        T('いずれを選んでも、一度の戦で家が決まるわけではございませぬ。殿、いかがなさいます。'),
    ];
    return { id: `ch2.council.${p}`, talk: 'council', lines, choices, defaultChoice: 0 };
}

// ================= 出陣の支度 =================

function deltaText(d: Record<TokugawaUnitId, number>): string {
    const parts = TOKUGAWA_UNIT_IDS.filter((k) => d[k] !== 0).map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${signed(d[k])}`);
    return parts.length ? parts.join('・') : '変わらない';
}

/** 補充の選択肢の説明（部隊ごとに戻る兵と代償。数は決まりから） */
function recoveryChoice(state: Ieyasu2State, o: RecoveryOption): ScenarioChoice {
    const R = CH2_RECOVERY;
    switch (o.choice) {
        case 'wait':
            return {
                id: 'recovery_wait',
                label: RECOVERY_LABELS.wait,
                detail: `戻る兵：${deltaText(o.delta)}（第一章で失った兵の ${pct(o.rate ?? R.rate)}。${TRUST_NAMES.ishikawa}の信頼 ${state.trust.ishikawa}${state.trust.ishikawa >= R.trustedAt ? ` が ${R.trustedAt} 以上のため ${pct(R.trustedRate)}` : ''}）。代償：敵の後詰め・次の波が ${CH2_RULES.waitDelaySec} 秒早く着く。`,
                summary: `兵 +${sum(o.delta)}・敵の後詰めが早い`,
            };
        case 'transfer':
            return {
                id: 'recovery_transfer',
                label: RECOVERY_LABELS.transfer,
                detail: `回す兵：${deltaText(o.delta)}（最大 ${R.transferMax}。守備隊は ${R.reserveFloor} より減らさない。合計は変わらない）。代償：岡崎の守備隊の兵が減る（第二章の後も減ったまま）。`,
                summary: `守備隊から ${-o.delta.reserve} を回す`,
            };
        case 'none':
            return { id: 'recovery_none', label: RECOVERY_LABELS.none, detail: '兵は変えない。代償なし。', summary: '兵はそのまま' };
    }
}

function musterScript(state: Ieyasu2State, id: Ieyasu2TalkId): ScenarioScript {
    const p = state.policy;
    const plan = state.plan;
    if (!plan) throw new Error('判断が決まっていません');
    const again = talked(state, id);
    switch (id) {
        case 'ishikawa': {
            const rec = state.recovery;
            if (rec) {
                const n = sum(rec.delta);
                const line =
                    rec.choice === 'wait'
                        ? IK(`負傷した者の戻りを待ちました。兵が ${n} 戻っております。その間に、敵の後詰めも近づいておりましょう。`)
                        : rec.choice === 'transfer'
                          ? IK(`守備隊から ${-rec.delta.reserve} を回しました。守備隊は ${state.troops.reserve} になっております。`)
                          : IK('今の兵のままで参りましょう。');
                return { id: `ch2.muster.ishikawa.${rec.choice}`, talk: id, lines: [line, narrate(`（今の兵：${troopsNow(state.troops)}）`)] };
            }
            const opts = ch2RecoveryOptions(state);
            const lines: ScenarioLine[] = [
                IK('出陣の前に、兵のことを決めねばなりませぬ。'),
                narrate(`（今の兵：${troopsNow(state.troops)}）`),
                IK('負傷した者の戻りを待てば兵は戻りますが、その間に敵の後詰めも近づきまする。守備隊から回せば、城の守りが薄くなりまする。'),
            ];
            if (!opts.wait.available) lines.push(IK(`負傷した者を待っても、戻る兵はほとんどございませぬ（${opts.wait.reason}）。`));
            if (!opts.transfer.available) lines.push(IK(`守備隊から兵を回すことは、できませぬ（${opts.transfer.reason}）。`));
            lines.push(narrate('（この判断は 1 回だけ。答えた後は変えられない）'));
            const choices: ScenarioChoice[] = [];
            if (opts.wait.available) choices.push(recoveryChoice(state, opts.wait));
            if (opts.transfer.available) choices.push(recoveryChoice(state, opts.transfer));
            choices.push(recoveryChoice(state, opts.none), { id: 'recovery_later', label: '少し考える', detail: '出陣の前に、もう一度話しかけて答える', summary: 'あとで答える' });
            return { id: 'ch2.muster.ishikawa.recovery', talk: id, lines, choices, defaultChoice: choices.length - 1 };
        }
        case 'gate': {
            if (!state.recovery) {
                return {
                    id: 'ch2.muster.gate.recovery_pending',
                    talk: id,
                    lines: [narrate('城門の外に、兵が揃っている。'), H(`（出陣の前に、${generalName('ishikawa')}と兵の補充のことを決めておこう。）`)],
                };
            }
            const info = ieyasu2BattleInfo(state);
            const strengthOf = (k: TokugawaUnitId) => info.setup.units.find((u) => u.id === IEYASU_UNIT_IDS[k])?.strength ?? state.troops[k];
            const units = info.sortie.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${strengthOf(k)}`).join('・');
            const support = info.support.map((x) => CH2_SUPPORT_NAMES[x]);
            return {
                id: 'ch2.muster.gate',
                talk: id,
                lines: [
                    narrate('城門の外に、兵が揃っている。'),
                    narrate(
                        `（判断：${CH2_PLAN_LABELS[p][plan]}。補充：${RECOVERY_LABELS[state.recovery.choice]}${state.recovery.choice === 'none' ? '' : `（${deltaText(state.recovery.delta)}）`}。出る部隊：${units}。支援：${support.length ? support.join('・') : 'なし'}）`,
                    ),
                    H(`（ここを出れば、「${CH2_MISSION_TITLES[p]}」の戦だ。）`),
                ],
                choices: [
                    { id: 'depart', label: '出陣する', detail: '出陣の前に自動で保存します' },
                    { id: 'stay', label: 'まだ支度をする' },
                ],
                defaultChoice: 1,
            };
        }
        case 'tadakatsu': {
            const advice: Record<Policy, Record<Ch2Plan, ScenarioLine[]>> = {
                oda: {
                    commit: [T('殿は拙者が務めます。織田勢が切れ目を抜けるまで、北の丘の前で支えましょう。'), T('織田勢を南の退き口から離れさせれば、務めは果たせます。殿の本陣も、同じ退き口から。')],
                    hold: [T('切れ目の北の口を固めます。織田勢は北の原から、自分の足で退いてきます。'), T('織田勢が切れ目を抜けて南の退き口から離れるまで、追っ手を止めましょう。')],
                },
                asai: {
                    commit: [T('南から丘へ急ぎます。囲みの南を破れば、浅井勢と合流できましょう。'), T('合流したら、南の安全な所まで連れ帰ります。合流の前に戻っても、救ったことにはなりませぬ。')],
                    hold: [T('西の筋から参ります。西の囲みに矢を浴びせれば、打って出てまいりましょう。'), T('囲みが崩れたら丘へ上がって浅井勢と合流し、南へ連れ帰ります。')],
                },
                home: {
                    commit: [T('屋敷の前を、守備隊も並べて厚く守りましょう。浪人の騎馬は米蔵を狙ってくるはず。')],
                    hold: [T('守備隊は城に残し、主力で屋敷の前を守ります。浪人の騎馬は米蔵を狙ってくるはず。')],
                },
            };
            const lines = again ? [advice[p][plan][0]!] : [...advice[p][plan]];
            if (state.recovery?.choice === 'wait') lines.push(T('負傷した者を待ったぶん、敵の後詰めも早く来ましょう。'));
            if (state.characters.tadakatsu === 'wounded') lines.push(T('傷はまだ痛みますが、槍は振るえます。'));
            lines.push(T('支度ができたら、城門へ。'));
            return { id: `ch2.muster.tadakatsu.${p}.${plan}`, talk: id, lines };
        }
        case 'envoy': {
            const line = p === 'oda' ? '織田勢の撤収、よろしくお頼み申します。' : p === 'asai' ? '丘の上の者たちを、どうか。' : '村の者は、庄屋の屋敷に集まって待っております。';
            return { id: `ch2.muster.envoy.${p}`, talk: id, lines: [E(p, line)] };
        }
        case 'notice':
            return {
                id: `ch2.muster.notice.${p}`,
                talk: id,
                lines: [
                    notice('一、この度の陣触れにつき、足軽は城門前に集まるべし。'),
                    notice(plan === 'commit' ? '一、守備の者も出陣す。留守の町の火の始末を怠るな。' : '一、守備の者は城に残る。町の者は騒がぬこと。'),
                ],
            };
        default:
            throw new Error(`第二章の支度に ${id} は居ません`);
    }
}

// ================= 戦後 =================

function objectiveText(r: ObjectiveResult | null): string {
    if (!r) return '記録なし';
    return `${r.label}：${r.achieved ? '果たした' : '果たせなかった'}`;
}
function secondaryText(rows: ObjectiveResult[]): string {
    return rows.length ? rows.map(objectiveText).join('・') : 'なし';
}

const AFTER_RESULT: Readonly<Record<Policy, Readonly<Record<BattleResultKind, string>>>> = {
    oda: {
        victory: '織田勢の後備えと小荷駄は、南の退き口を抜けました。撤収は支えきれましたぞ。',
        retreat: '織田勢を退かせきる前に、兵を引きました。織田勢は、自分の足で退いていきました。',
        defeat: '……本陣が崩れました。されど殿はご無事。それが何よりです。',
    },
    asai: {
        victory: '丘の上の浅井勢を、南まで連れ帰りました。囲みは破れましたぞ。',
        retreat: '浅井勢を連れ帰る前に、兵を引きました。丘の上の者たちがどうなったか、まだ知らせはございませぬ。',
        defeat: '……本陣が崩れました。されど殿はご無事。それが何よりです。',
    },
    home: {
        victory: '浪人どもは、庄屋の屋敷の前を抜けられず、引いていきました。村は守れましたぞ。',
        retreat: '屋敷の前を守りきる前に、兵を引きました。村は荒らされましたが、兵は残っております。',
        defeat: '……本陣が崩れました。されど殿はご無事。それが何よりです。',
    },
};

function aftermathScript(state: Ieyasu2State, id: Ieyasu2TalkId): ScenarioScript {
    const o = state.battle;
    const r = state.result;
    const p = state.policy;
    if (!o || !r) throw new Error('戦後なのに合戦の結果がありません');
    switch (id) {
        case 'tadakatsu': {
            const choices: ScenarioChoice[] = [
                { id: 'end_chapter', label: '第二章を締めくくる', detail: '第二章の区切りへ進みます' },
                { id: 'not_yet', label: 'まだ皆と話す' },
            ];
            if (talked(state, 'tadakatsu')) return { id: 'ch2.aftermath.tadakatsu.again', talk: id, lines: [T('今日のことを、締めくくりましょうか。')], choices, defaultChoice: 1 };
            const c = state.chapter1;
            const lines: ScenarioLine[] = [T(AFTER_RESULT[p][o.result])];
            lines.push(narrate(`（主目標：${objectiveText(r.primary)}。副目標：${secondaryText(r.secondary)}）`));
            // 第一章とのつながり
            const pl = c.pledge.result as PledgeResult;
            if (p === 'oda' || p === 'asai') {
                const who = p === 'oda' ? '織田勢' : '浅井勢';
                lines.push(
                    pl === 'kept'
                        ? T(`先の戦で守った約束があったゆえ、${who}もこちらを頼みにしておりました。`)
                        : pl === 'broken'
                          ? T(`先の約束のことがあっても、こたびは手を貸しました。${who}がどう見るかは、これからです。`)
                          : T('先の頼みを引き受けなかったことは、こたびの働きとは別の話にございます。'),
                );
            } else {
                lines.push(c.battle.result === 'victory' ? T('先の戦で浪人どもを退けたゆえ、村の者も力を貸してくれました。') : T('先の戦で退けられなかった浪人どもと、こたびも向き合いました。'));
            }
            lines.push(T('一度の戦で、家が決まるわけではございませぬ。'));
            if (state.characters.tadakatsu === 'wounded') lines.push(T('拙者の傷は浅手です。お気になさらず。'));
            if (state.characters.ieyasu === 'wounded') lines.push(H('（傷が痛む。だが、生きている。）'));
            if (p === 'asai' && state.characters.nagamasa === 'wounded' && c.characters.nagamasa === 'alive') lines.push(T('長政殿も手傷を負われたそうですが、命に別状はないとのこと。'));
            lines.push(T('皆とも話されたら、第二章を締めくくりましょう。'));
            return { id: `ch2.aftermath.tadakatsu.${p}.${o.result}`, talk: id, lines, choices, defaultChoice: 1 };
        }
        case 'ishikawa': {
            const lost = sum(r.lost);
            const lines: ScenarioLine[] = [
                IK('こたびの戦の兵を、まとめました。'),
                narrate(`（失った兵：${lost}${lost ? `（${TOKUGAWA_UNIT_IDS.filter((k) => r.lost[k]).map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${r.lost[k]}`).join('・')}）` : ''}。今の兵：${troopsNow(state.troops)}）`),
            ];
            if (r.recovery === 'transfer') lines.push(IK('守備隊から回したぶん、城の守りは薄いままにございます。'));
            if (r.plan === 'commit') lines.push(IK('守備隊まで出して城を空けたこと、二度は続けとうございませぬ。'));
            return { id: `ch2.aftermath.ishikawa.${r.plan}`, talk: id, lines };
        }
        case 'envoy':
            return aftermathEnvoy(state, o.result, r.plan);
        case 'notice': {
            const text: Record<BattleResultKind, string[]> = {
                victory: [p === 'home' ? '一、領内の村を荒らす浪人の一団、退く。村の者は家へ戻るべし。' : '一、この度の戦、お味方の務めは果たされた。', '一、戦に出た者の家には、米を下される。'],
                retreat: ['一、兵は城へ戻った。町の者は騒がぬこと。', '一、夜の火の始末を怠らぬこと。'],
                defeat: ['一、お味方、兵を引く。殿はご無事。', '一、町の者は騒がず、城の指図を待つべし。'],
            };
            return { id: `ch2.aftermath.notice.${o.result}`, talk: id, lines: text[o.result].map(notice) };
        }
        default:
            throw new Error(`第二章の戦後に ${id} は居ません`);
    }
}

function aftermathEnvoy(state: Ieyasu2State, result: BattleResultKind, plan: Ch2Plan): ScenarioScript {
    const p = state.policy;
    const lines: ScenarioLine[] = [];
    if (p === 'home') {
        lines.push(
            result === 'victory'
                ? E(p, '村は守られました。皆、殿のご恩は忘れませぬ。')
                : result === 'retreat'
                  ? E(p, '……村は荒らされましたが、命のある者は皆、逃げのびました。')
                  : E(p, '殿がご無事で何よりです。村の者は、しばらく山へ逃れております。'),
        );
        return { id: `ch2.aftermath.envoy.home.${result}`, talk: 'envoy', lines };
    }
    if (result === 'victory') {
        lines.push(
            p === 'oda'
                ? E(p, plan === 'commit' ? '殿を務めていただいたこと、主に必ず伝えます。' : '退き口を固めていただいたおかげで、織田勢は退けました。')
                : E(p, plan === 'commit' ? 'よくぞ急いで来てくださった。丘の者たちは、皆、命拾いいたしました。' : '囲みを破っていただいたこと、主に必ず伝えます。'),
        );
    } else if (result === 'retreat') {
        lines.push(E(p, p === 'oda' ? '兵を退かれたか……。主には、ありのままを申し上げます。' : '……丘の者たちを、置いてゆかれたか。主には、ありのままを申し上げます。'));
    } else {
        lines.push(E(p, '徳川殿も崩れたか。……こちらも苦しい。しばらくは、互いに立て直すほかありませぬ。'));
    }
    return { id: `ch2.aftermath.envoy.${p}.${result}`, talk: 'envoy', lines };
}

// ================= 段階の案内・目的 =================

export function ieyasu2PhaseIntro(state: Ieyasu2State): { title: string; text: string } {
    const p = state.policy;
    switch (state.phase) {
        case 'explore':
            return { title: '第二章　分かれ道の後', text: `第一章の戦の後。${INTRO_LINE[p]}本多忠勝と話そう。（第一章の直後の、分岐した世界での出来事。創作）` };
        case 'council':
            return { title: '軍議', text: '今回の判断を決める。' };
        case 'muster':
            return { title: '出陣の支度', text: state.recovery ? '支度ができたら城門へ。' : `${generalName('ishikawa')}が兵の補充のことで話があるという。話を聞き、支度ができたら城門へ。` };
        case 'battle':
            return { title: CH2_MISSION_TITLES[p], text: '合戦' };
        case 'aftermath': {
            const r = state.battle?.result ?? 'retreat';
            const t: Record<BattleResultKind, { title: string; text: string }> = {
                victory: { title: '務めを果たして', text: '城へ戻った。皆の様子を見て、忠勝と話そう。' },
                retreat: { title: '城へ引いた夜', text: '兵をまとめて城へ戻った。皆の様子を見て、忠勝と話そう。' },
                defeat: { title: '落ち延びた夜', text: '本陣は崩れたが、家康は城へ落ち延びた。皆の様子を見て、忠勝と話そう。' },
            };
            const prim = state.result?.primary;
            return prim ? { title: t[r].title, text: `${t[r].text}（主目標「${prim.label}」は${prim.achieved ? '果たした' : '果たせなかった'}）` } : t[r];
        }
        case 'ending':
            return { title: state.ending ? IEYASU2_ENDING_TITLES[state.ending] : '第二章の区切り', text: '' };
    }
}

export function ieyasu2Objective(state: Ieyasu2State): string {
    switch (state.phase) {
        case 'explore':
            return `本多忠勝と話す（${generalName('ishikawa')}・${ieyasu2TalkName(state.policy, 'envoy')}の話も聞ける）`;
        case 'council':
            return '今回の判断を選ぶ';
        case 'muster':
            if (!state.recovery) return `${generalName('ishikawa')}と話し、兵の補充を決める`;
            return '支度を整え、城門で出陣する';
        case 'battle':
            return `${CH2_MISSION_TITLES[state.policy]}（${IEYASU2_FIELD_LABEL}）`;
        case 'aftermath':
            return '皆と話し、忠勝と話して第二章を締めくくる';
        case 'ending':
            return '元亀元年・家康　第二章　完';
    }
}

// ================= 第二章の区切り（結末） =================

export const IEYASU2_ENDING_TITLES: Readonly<Record<Ieyasu2EndingId, string>> = {
    ch2_oda_victory: '撤収を支えきる',
    ch2_oda_retreat: '兵を残して引く',
    ch2_oda_defeat: '崩れても生き延びる',
    ch2_asai_victory: '丘から連れ帰る',
    ch2_asai_retreat: '届かなかった丘',
    ch2_asai_defeat: '救えなかった丘',
    ch2_home_victory: '村を守りきる',
    ch2_home_retreat: '村を離れて立て直す',
    ch2_home_defeat: '城へ退いて備える',
};

const ENDING_MAIN: Readonly<Record<Ieyasu2EndingId, readonly string[]>> = {
    ch2_oda_victory: ['織田勢の後備えと小荷駄は、南の退き口を抜けた。徳川は撤収を支えきり、織田家の信頼を得た。', '浅井・朝倉の勢が滅んだわけではない。近江の戦は、なお続いていく。一度の勝ちで大勢が決まるわけではない。'],
    ch2_oda_retreat: ['織田勢を退かせきる前に、家康は兵を引いた。織田勢は自分の足で退いていった。', '織田は多くを語らなかった。徳川は兵を残し、次に備える。一度の戦で家が決まるわけではない。'],
    ch2_oda_defeat: ['本陣が崩れ、家康はわずかな供回りとともに退いた。織田勢の撤収を支えきることはできなかった。', '家康は生きて城へ戻った。一度の負けで徳川の家が終わるわけではない。'],
    ch2_asai_victory: ['囲まれていた浅井勢は、徳川の兵とともに丘を下り、南の安全な所まで退いた。（この分岐はゲームの創作）', '織田方との溝は深まった。浅井との結びつきは強まったが、一度の勝ちで大勢が決まるわけではなく、難しい日々はこれからだ。'],
    ch2_asai_retreat: ['浅井勢を連れ帰る前に、家康は兵を引いた。丘の上の兵がどうなったか、知らせはまだ届かない。', '徳川は兵を残し、次に備える。一度の戦で家が決まるわけではない。'],
    ch2_asai_defeat: ['本陣が崩れ、家康は落ち延びた。浅井勢を救うことはできなかった。', '家康は生きて城へ戻った。一度の負けで徳川の家が終わるわけではない。'],
    ch2_home_victory: ['浪人衆は庄屋の屋敷の前を抜けられず、領内から退いた。村の者は家へ戻り始めた。', '織田・浅井の両家とは刃を交えなかった。両家の争いの行方は、まだ見えない。一度の勝ちで大勢が決まるわけではない。'],
    ch2_home_retreat: ['家康は兵を引き、村は浪人衆に荒らされた。それでも、兵は残った。', '立て直して、また村を守る日が来る。一度の戦で家が決まるわけではない。'],
    ch2_home_defeat: ['本陣が崩れ、家康は城へ退いた。村は浪人衆に荒らされた。', '家康は生きている。城に籠もり、次の備えを急ぐ。一度の負けで徳川の家が終わるわけではない。'],
};

function endingBody(state: Ieyasu2State, id: Ieyasu2EndingId): string[] {
    const body = [...ENDING_MAIN[id]];
    const c = state.chapter1;
    const pl = c.pledge.result as PledgeResult;
    // 第一章とのつながり（引き受けなかったのは約束違反として扱わない）
    if (state.policy === 'home') body.push(c.battle.result === 'victory' ? '第一章で浪人衆を退けたことは、村の者の心に残り、この日の力になった。' : '第一章で退けられなかった浪人衆との因縁に、この日、一つの区切りがついた。');
    else
        body.push(
            pl === 'kept'
                ? `第一章で守った約束は、${TRUST_NAMES[ch2PartnerOf(state.policy)!]}の信頼として、この日も残っていた。`
                : pl === 'broken'
                  ? (ch1Unfought(c) ? '第一章で、敵と刃を交える前に兵を引いて果たせなかった約束のことは、まだ先方の胸に残っている。' : '第一章で果たせなかった約束のことは、まだ先方の胸に残っている。')
                  : '第一章で頼みを引き受けなかったことは、約束違反としては扱われていない。',
        );
    const tail: string[] = [];
    if (state.characters.tadakatsu === 'wounded') tail.push('忠勝の傷が癒えるまで、しばらくかかりそうだ。');
    if (state.result?.recovery === 'transfer') tail.push('岡崎の守備隊は兵を回したぶん、薄いままだ。');
    if (state.result?.plan === 'commit') tail.push('城を空けて出たことを、石川数正は案じている。');
    if (tail.length) body.push(tail.join(''));
    return body.slice(0, 4);
}

export function ieyasu2EndingView(state: Ieyasu2State): ScenarioEndingView {
    const id = state.ending;
    const o = state.battle;
    const r = state.result;
    if (!id || !o || !r) throw new Error('第二章の区切りがまだ決まっていません');
    const c = state.chapter1;
    const start = c.troops;
    const total = (t: Record<TokugawaUnitId, number>) => TOKUGAWA_UNIT_IDS.reduce((n, k) => n + t[k], 0);
    const min = Math.floor(o.elapsedSec / 60);
    const sec = Math.floor(o.elapsedSec % 60);
    const used = Object.keys(o.abilitiesUsed ?? {}).length;
    const trustChange = SHOWN_TRUST_IDS.map((k) => `${TRUST_NAMES[k]} ${signed(state.trust[k] - c.trust[k])}`).join('・');
    const rec = state.recovery;
    const record = [
        { label: '方針', value: POLICY_DONE_LABELS[state.policy] },
        { label: '第一章', value: `${IEYASU_RESULT_LABELS[c.battle.result]}・約束：${ch1PledgeText(c)}・援兵：${c.support.reinforcement ? `+${c.support.recovered}（第一章で受け取り済み）` : 'なし'}` },
        { label: '判断', value: `${CH2_PLAN_LABELS[state.policy][r.plan]}（${CH2_MISSION_TITLES[state.policy]}）` },
        { label: '補充', value: `${RECOVERY_LABELS[r.recovery]}${rec && r.recovery !== 'none' ? `（${deltaText(rec.delta)}）` : ''}` },
        { label: '合戦の結果', value: `${IEYASU_RESULT_LABELS[o.result]}：${ieyasu2ReasonLabel(state.policy, o.reason)}` },
        { label: '合戦の時間', value: `${min} 分 ${String(sec).padStart(2, '0')} 秒` },
        { label: '主目標', value: objectiveText(r.primary) },
        { label: '副目標', value: secondaryText(r.secondary) },
        { label: '徳川の兵', value: `${total(start).toLocaleString('ja-JP')} → ${total(state.troops).toLocaleString('ja-JP')}（第二章のはじめ → 今）` },
        { label: '部隊ごとの兵', value: unitsLine(start, state.troops) },
        { label: '支援', value: r.support.length ? r.support.map((x) => CH2_SUPPORT_NAMES[x]).join('・') : 'なし' },
        { label: '信頼', value: trustLine(state.trust) },
        { label: '信頼の変化', value: `${trustChange}（第二章のはじめから）` },
        { label: '人物', value: peopleLine(state) },
        { label: '特殊能力', value: `${used > 0 ? `${used} 回使った` : '使わなかった'}（能力はゲーム用の創作）` },
        { label: '史実と創作', value: '第二章は、第一章の直後の分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない。会話・戦場・兵数・結末は創作。' },
    ];
    return { id, title: IEYASU2_ENDING_TITLES[id], body: endingBody(state, id), record, footer: IEYASU2_END_LABEL };
}

/** メニューの「状態」（第二章） */
export function ieyasu2StatusRows(s: Ieyasu2State): { label: string; value: string }[] {
    const rows = [
        { label: '章', value: `${IEYASU2_CHAPTER_TITLE}（歴史分岐・創作を含む）` },
        { label: '今', value: IEYASU2_PHASE_LABELS[s.phase] },
        { label: '目的', value: ieyasu2Objective(s) },
        { label: '第一章', value: ch1SummaryText(s.chapter1) },
        { label: '方針', value: `${POLICY_DONE_LABELS[s.policy]}（任務：${CH2_MISSION_TITLES[s.policy]}）` },
        { label: '判断', value: s.plan ? CH2_PLAN_LABELS[s.policy][s.plan] : 'まだ決めていない' },
        { label: '補充', value: s.recovery ? `${RECOVERY_LABELS[s.recovery.choice]}${s.recovery.choice === 'none' ? '' : `（${deltaText(s.recovery.delta)}）`}` : 'まだ決めていない' },
        { label: '信頼', value: trustLine(s.trust) },
        { label: '徳川の兵', value: troopsNow(s.troops) },
        { label: '人物', value: peopleLine(s) },
    ];
    if (s.battle && s.result) {
        rows.push({ label: '合戦', value: `${IEYASU_RESULT_LABELS[s.battle.result]}（${ieyasu2ReasonLabel(s.policy, s.battle.reason)}）` });
        rows.push({ label: '主目標', value: objectiveText(s.result.primary) });
        rows.push({ label: '支援', value: s.result.support.length ? s.result.support.map((x) => CH2_SUPPORT_NAMES[x]).join('・') : 'なし' });
    } else {
        rows.push({ label: '支援の見込み', value: ch2SupportOutlook(s) });
    }
    return rows;
}
