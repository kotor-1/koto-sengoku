/**
 * 歴史分岐シナリオ「元亀元年・家康」の進め方（純粋な関数。three も DOM も使わない）。設計：docs/ieyasu1570-design.md。
 *
 * - 段階は explore → council → muster → battle → aftermath → ending の一方向にだけ進む（架空の第一章と同じ）。
 *   それ以外の進め方は FlowError を投げて受け付けない。どの関数も受け取った状態を書き換えず、新しい状態を返す。
 * - 軍議で 3 つの方針（A 織田・B 浅井・C 自領の防衛）を見比べて選び、確かめて決める。
 * - 支度で、方針ごとの相手から戦前の約束を 1 つ頼まれる（引き受ける／引き受けない／あとで）。答えるまで出陣できない。
 * - 合戦の設定は battle/maps.ts の ieyasu1570Setup（方針・徳川の兵・約束を引き受けたか）。
 * - 合戦の結果は合戦の id（battleId）ごとに 1 回だけ反映する（applyIeyasuOutcomeOnce）。勝敗と約束の結果は別々に記録する。
 * - どの方針 × 勝敗でも、戦後と結末（6 つ）へ着く。家康は死なない。一度の局地戦で家が滅ぶことはない。
 *
 * 1570年の情勢を背景にした歴史分岐シナリオ。会話・分岐・戦場・数値・能力・約束・戦後はゲーム用の創作（story.ts の先頭）。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, BattleSetup, UnitStatus } from '../../battle/types';
import { IEYASU_UNIT_IDS, ieyasu1570Setup, ieyasuTroopKeysInBattle } from '../../battle/maps';
import { FlowError } from '../flow';
import { EXPLORE_LIMIT, isBattleId } from '../state';
import type { ScenarioScript } from '../scenario';
import {
    IEYASU_CHARACTER_IDS,
    IEYASU_SCENARIO_ID,
    IEYASU_TROOPS_MAX,
    INITIAL_TOKUGAWA_TROOPS,
    INITIAL_TRUST,
    PLEDGE_SPECS,
    TOKUGAWA_UNIT_IDS,
    clampTrust,
    cloneIeyasuOutcome,
    cloneIeyasuState,
    ieyasuTalkFlag,
    parseIeyasuOutcome,
    type CampaignPhase,
    type CarryFlag,
    type ExplorePose,
    type IeyasuCharacterId,
    type IeyasuCharacterStatus,
    type IeyasuChoiceId,
    type IeyasuEndingId,
    type IeyasuState,
    type IeyasuTalkId,
    type PledgeResult,
    type Policy,
    type SupportState,
    type TokugawaUnitId,
} from './state';
import { ieyasuScriptFor } from './story';

export { FlowError };

const NEXT_PHASE: Readonly<Record<CampaignPhase, CampaignPhase | null>> = {
    explore: 'council',
    council: 'muster',
    muster: 'battle',
    battle: 'aftermath',
    aftermath: 'ending',
    ending: null,
};

export function newIeyasuGame(): IeyasuState {
    const characters = {} as Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    for (const c of IEYASU_CHARACTER_IDS) characters[c] = 'alive';
    return {
        scenario: IEYASU_SCENARIO_ID,
        phase: 'explore',
        policy: null,
        pendingPolicy: null,
        trust: { ...INITIAL_TRUST },
        troops: { ...INITIAL_TOKUGAWA_TROOPS },
        characters,
        talked: {},
        pledge: null,
        battle: null,
        battleId: null,
        appliedBattleId: null,
        support: null,
        ending: null,
        explore: null,
        playTimeSec: 0,
        savedAt: null,
    };
}

function advanceTo(state: IeyasuState, to: CampaignPhase): IeyasuState {
    if (NEXT_PHASE[state.phase] !== to) throw new FlowError(`${state.phase} から ${to} へは進めません`);
    const s = cloneIeyasuState(state);
    s.phase = to;
    switch (to) {
        case 'muster':
            if (!s.policy) throw new FlowError('方針が決まっていません');
            if (s.battle) throw new FlowError('合戦の結果がすでにあります');
            s.pendingPolicy = null;
            break;
        case 'battle':
            if (!s.policy) throw new FlowError('方針が決まっていません');
            if (!s.pledge) throw new FlowError('約束の返事をしていません');
            if (s.battle) throw new FlowError('合戦の結果がすでにあります');
            break;
        case 'aftermath':
        case 'ending':
            if (!s.policy || !s.battle || !s.pledge || !s.support) throw new FlowError('合戦の結果がありません');
            break;
        default:
            break;
    }
    return s;
}

// ================= 会話 =================

/** 今の段階で話しかけられる相手（城下に置く人物・物） */
export function presentIeyasuTalks(state: IeyasuState): IeyasuTalkId[] {
    const p = state.policy;
    switch (state.phase) {
        case 'explore':
            return ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice'];
        case 'council':
            return ['council'];
        case 'muster':
            // 約束の相手の使者だけが残る（C は両家の使者とも帰った。忠勝が約束の相手）
            return ['tadakatsu', ...(p === 'oda' ? (['oda_envoy'] as const) : p === 'asai' ? (['asai_envoy'] as const) : []), 'notice', 'gate'];
        case 'aftermath':
            // C は織田の使者が不満を伝えに来る（敵になるわけではない）
            return ['tadakatsu', ...(p === 'asai' ? (['asai_envoy'] as const) : (['oda_envoy'] as const)), 'notice'];
        default:
            return [];
    }
}

function isTalkId(id: string): id is IeyasuTalkId {
    return (['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice', 'gate', 'council'] as const).includes(id as IeyasuTalkId);
}

export function canTalkIeyasu(state: IeyasuState, id: string): boolean {
    return isTalkId(id) && presentIeyasuTalks(state).includes(id);
}

export function talkIeyasu(state: IeyasuState, id: string): ScenarioScript {
    if (!canTalkIeyasu(state, id)) throw new FlowError(`今（${state.phase}）は ${id} と話せません`);
    return ieyasuScriptFor(state, id as IeyasuTalkId);
}

export function hasTalkedIeyasu(state: IeyasuState, id: IeyasuTalkId, phase: CampaignPhase = state.phase): boolean {
    return state.talked[ieyasuTalkFlag(phase, id)] === true;
}

/**
 * 会話を読み終えた。済み印を立て、選択肢の結果を反映した新しい状態を返す。
 * 選択肢のある会話では choiceId が必須で、その会話の選択肢の中の物でなければ投げる（出陣は departIeyasu で）。
 */
export function finishTalkIeyasu(state: IeyasuState, id: string, choiceId?: string): IeyasuState {
    const script = talkIeyasu(state, id);
    const tid = id as IeyasuTalkId;
    if (script.choices) {
        if (!choiceId || !script.choices.some((c) => c.id === choiceId)) throw new FlowError(`この会話（${script.id}）の選択肢に ${String(choiceId)} はありません`);
    } else if (choiceId) {
        throw new FlowError(`この会話（${script.id}）に選択肢はありません`);
    }
    // 信頼は会話だけでは動かさない（動くのは合戦の結果と約束の結果だけ：数の出どころを 1 つにする）
    let s = cloneIeyasuState(state);
    s.talked[ieyasuTalkFlag(s.phase, tid)] = true;
    if (choiceId) s = chooseIeyasu(s, choiceId as IeyasuChoiceId);
    return s;
}

/** 今の段階で選べる選択肢 */
export function legalIeyasuChoices(state: IeyasuState): IeyasuChoiceId[] {
    switch (state.phase) {
        case 'explore':
            return ['open_council', 'not_yet'];
        case 'council':
            return state.pendingPolicy ? ['confirm_policy', 'reconsider'] : ['policy_oda', 'policy_asai', 'policy_home'];
        case 'muster':
            return state.pledge ? ['depart', 'stay'] : ['pledge_accept', 'pledge_decline', 'pledge_later', 'stay'];
        case 'aftermath':
            return ['end_chapter', 'not_yet'];
        default:
            return [];
    }
}

const POLICY_OF: Partial<Record<IeyasuChoiceId, Policy>> = { policy_oda: 'oda', policy_asai: 'asai', policy_home: 'home' };

export function chooseIeyasu(state: IeyasuState, choiceId: IeyasuChoiceId): IeyasuState {
    if (!legalIeyasuChoices(state).includes(choiceId)) throw new FlowError(`今（${state.phase}）は ${choiceId} を選べません`);
    switch (choiceId) {
        case 'open_council':
            return advanceTo(state, 'council');
        case 'not_yet':
        case 'stay':
        case 'pledge_later':
            return cloneIeyasuState(state);
        case 'policy_oda':
        case 'policy_asai':
        case 'policy_home': {
            const s = cloneIeyasuState(state);
            s.pendingPolicy = POLICY_OF[choiceId]!;
            return s;
        }
        case 'confirm_policy': {
            const s = cloneIeyasuState(state);
            s.policy = s.pendingPolicy;
            return advanceTo(s, 'muster');
        }
        case 'reconsider': {
            const s = cloneIeyasuState(state);
            s.pendingPolicy = null;
            return s;
        }
        case 'pledge_accept':
        case 'pledge_decline': {
            const s = cloneIeyasuState(state);
            const spec = PLEDGE_SPECS[s.policy!];
            const accepted = choiceId === 'pledge_accept';
            s.pledge = { accepted, partner: spec.partner, targetId: spec.targetId, result: accepted ? null : 'declined' };
            return s;
        }
        case 'depart':
            return departIeyasu(state);
        case 'end_chapter':
            return finishIeyasuChapter(state);
    }
}

// ================= 出陣・合戦 =================

export const IEYASU_DEFAULT_BATTLE_ID = 'ieyasu1570-field';

/** 出陣する（muster → battle）。約束の返事が済んでいること */
export function departIeyasu(state: IeyasuState): IeyasuState {
    if (state.phase !== 'muster') throw new FlowError(`今（${state.phase}）は出陣できません`);
    const s = advanceTo(state, 'battle');
    s.battleId = IEYASU_DEFAULT_BATTLE_ID;
    s.appliedBattleId = null;
    return s;
}

export function withIeyasuBattleId(state: IeyasuState, id: string): IeyasuState {
    if (state.phase !== 'battle' || state.appliedBattleId !== null) throw new FlowError('合戦の id を付けられるのは、出陣した直後だけです');
    if (!isBattleId(id)) throw new FlowError(`合戦の id の形が正しくありません：${id}`);
    const s = cloneIeyasuState(state);
    s.battleId = id;
    return s;
}

/** 合戦の設定（phase が battle のときだけ）。battle/maps.ts の ieyasu1570Setup に、方針・今の徳川の兵・約束を渡す */
export function ieyasuBattleSetup(state: IeyasuState): BattleSetup {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦を始められません`);
    if (!state.policy) throw new FlowError('方針が決まっていません');
    if (!state.pledge) throw new FlowError('約束の返事をしていません');
    return ieyasu1570Setup(state.policy, { troops: { ...state.troops }, pledgeAccepted: state.pledge.accepted });
}

/** 合戦の部隊 id → 徳川の部隊（兵を持ち越す単位） */
export const TOKUGAWA_UNIT_OF: Readonly<Record<string, TokugawaUnitId>> = Object.fromEntries(TOKUGAWA_UNIT_IDS.map((k) => [IEYASU_UNIT_IDS[k], k]));

/**
 * 信頼の変化（設計 §5・§6。ゲーム用の数値）
 * - partner：方針の相手（A は織田・B は浅井）への、結果ごとの変化。
 * - opposed：A で浅井と戦った／B で織田と手を切った。
 * - home：C（兵を出さなかった）。織田は不満、浅井は変わらない（両家への宣戦ではない）。
 * - tadakatsu：家臣の信頼（勝てば少し上がる）。
 * - sakai：酒井忠次（采配・軍議）。合戦の結果を見る（勝てば上がり、負ければ下がる）。
 * - ishikawa：石川数正（後詰め）。退き口を守る約束の結果を見る（引き受けなかったときは 0）。
 *   榊原康政はこの章に出ないので動かない。どの家臣の信頼も、合戦・約束の判定そのものには使わない。
 * - pledge：約束の相手への変化。引き受けなかったときは 0（約束違反とは別）。
 */
export const TRUST_DELTA = {
    partner: { victory: 15, retreat: 0, defeat: -10 } as Readonly<Record<BattleResultKind, number>>,
    opposed: { oda: { asai: -15 }, asai: { oda: -30 } } as const,
    home: { oda: -10, asai: 0 } as const,
    tadakatsu: { victory: 5, retreat: 0, defeat: 0 } as Readonly<Record<BattleResultKind, number>>,
    sakai: { victory: 5, retreat: 0, defeat: -5 } as Readonly<Record<BattleResultKind, number>>,
    ishikawa: { kept: 5, broken: -5, declined: 0 } as Readonly<Record<PledgeResult, number>>,
    pledge: { kept: 25, broken: -25, declined: 0 } as Readonly<Record<PledgeResult, number>>,
};
/** 約束を守ったときの援兵：徳川の部隊の兵を合わせてこれだけ戻す（各部隊の上限＝章の始めの兵の中で） */
export const REINFORCEMENT_TROOPS = 150;

const broken = (s: UnitStatus) => s === 'routed' || s === 'destroyed';

/** 約束の判定。合戦の計算（sim）の結果があればそれを使い、無ければ（確認用の偽の結果など）最後の状態から同じ決まりで判定する */
function judgePledge(state: IeyasuState, o: BattleOutcome): PledgeResult {
    const pl = state.pledge!;
    if (!pl.accepted) return 'declined';
    if (o.pledge) {
        if (o.pledge.targetId !== pl.targetId) throw new FlowError(`約束の対象が食い違っています（${o.pledge.targetId}／${pl.targetId}）`);
        return o.pledge.result;
    }
    const u = o.units.find((x) => x.id === pl.targetId);
    if (!u || u.side !== 'ally') return 'broken';
    if (broken(u.status)) return 'broken';
    return u.startStrength > 0 && u.endStrength >= u.startStrength * 0.4 - 1e-9 ? 'kept' : 'broken';
}

/** 援兵の兵を徳川の部隊へ配る（足りない部隊へ均等に。各部隊は章の始めの兵まで）。戻した兵の合計を返す */
export function distributeReinforcement(troops: Record<TokugawaUnitId, number>, amount: number): number {
    let left = Math.max(0, Math.floor(amount));
    let given = 0;
    for (;;) {
        const short = TOKUGAWA_UNIT_IDS.filter((k) => troops[k] < INITIAL_TOKUGAWA_TROOPS[k]);
        if (left <= 0 || short.length === 0) break;
        const share = Math.max(1, Math.floor(left / short.length));
        for (const k of short) {
            if (left <= 0) break;
            const add = Math.min(share, left, INITIAL_TOKUGAWA_TROOPS[k] - troops[k]);
            troops[k] += add;
            left -= add;
            given += add;
        }
    }
    return given;
}

/**
 * 合戦の結果を反映する（battle → aftermath）。
 * - 徳川の部隊の兵：生き残った兵を戻す（合戦に出なかった部隊はそのまま）。
 * - 人物：家康本陣・忠勝隊・（B の）浅井長政隊が敗走・全滅 → その武将は負傷（死亡・捕らわれは無い）。
 * - 約束：勝敗とは別に判定（kept／broken。引き受けなければ declined）。
 * - 信頼：TRUST_DELTA。約束の相手は ±25（declined は 0）。酒井は勝敗、石川は約束の結果で ±5。
 * - 支援：約束を守れば援兵（兵 +150、上限の中）と、次の章へ持ち越す印。
 */
export function applyIeyasuOutcome(state: IeyasuState, outcome: BattleOutcome): IeyasuState {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦の結果を受け取れません`);
    if (!state.battleId || state.appliedBattleId !== null) throw new FlowError('この合戦の結果は、すでに反映したか、合戦の id がありません');
    const o = parseIeyasuOutcome(outcome);
    if (!o) throw new FlowError('合戦の結果の形が正しくありません');
    const hq = o.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin);
    if (!hq || hq.side !== 'ally' || hq.clan !== 'tokugawa') throw new FlowError('合戦の結果に家康本陣がありません');
    const s = cloneIeyasuState(state);
    const p = s.policy!;
    s.battle = cloneIeyasuOutcome(o);

    // 兵（出た部隊だけ）
    const inBattle = new Set(ieyasuTroopKeysInBattle(p));
    for (const u of o.units) {
        const k = TOKUGAWA_UNIT_OF[u.id];
        if (!k || !inBattle.has(k) || u.side !== 'ally' || u.clan !== 'tokugawa') continue;
        s.troops[k] = Math.max(0, Math.min(IEYASU_TROOPS_MAX, Math.round(u.endStrength)));
    }

    // 人物（味方の武将だけ。敵方の長政（A）は負傷させない）
    const unitOf = (id: string) => o.units.find((u) => u.id === id);
    if (broken(hq.status)) s.characters.ieyasu = 'wounded';
    const tk = unitOf(IEYASU_UNIT_IDS.tadakatsu);
    if (tk && broken(tk.status)) s.characters.tadakatsu = 'wounded';
    const ng = unitOf(PLEDGE_SPECS.asai.targetId);
    if (p === 'asai' && ng && ng.side === 'ally' && broken(ng.status)) s.characters.nagamasa = 'wounded';

    // 信頼（方針 × 結果）
    if (p === 'oda') {
        s.trust.oda = clampTrust(s.trust.oda + TRUST_DELTA.partner[o.result]);
        s.trust.asai = clampTrust(s.trust.asai + TRUST_DELTA.opposed.oda.asai);
    } else if (p === 'asai') {
        s.trust.asai = clampTrust(s.trust.asai + TRUST_DELTA.partner[o.result]);
        s.trust.oda = clampTrust(s.trust.oda + TRUST_DELTA.opposed.asai.oda);
    } else {
        s.trust.oda = clampTrust(s.trust.oda + TRUST_DELTA.home.oda);
        s.trust.asai = clampTrust(s.trust.asai + TRUST_DELTA.home.asai);
    }
    s.trust.tadakatsu = clampTrust(s.trust.tadakatsu + TRUST_DELTA.tadakatsu[o.result]);
    s.trust.sakai = clampTrust(s.trust.sakai + TRUST_DELTA.sakai[o.result]);

    // 約束（勝敗とは別）
    const result = judgePledge(s, o);
    s.pledge = { ...s.pledge!, result };
    const partner = s.pledge.partner;
    s.trust[partner] = clampTrust(s.trust[partner] + TRUST_DELTA.pledge[result]);
    s.trust.ishikawa = clampTrust(s.trust.ishikawa + TRUST_DELTA.ishikawa[result]);

    // 支援
    const carry: CarryFlag[] = [`policy_${p}`, `pledge_${result}`];
    const support: SupportState = { reinforcement: false, from: null, recovered: 0, carryOver: carry };
    if (result === 'kept') {
        support.reinforcement = true;
        support.from = partner;
        support.recovered = distributeReinforcement(s.troops, REINFORCEMENT_TROOPS);
        carry.push(`reinforcement_${partner}`);
    }
    s.support = support;

    const next = advanceTo(s, 'aftermath');
    next.appliedBattleId = next.battleId;
    next.explore = null;
    return next;
}

/** 合戦の結果を、その合戦（battleId）に対して 1 回だけ反映する（済んでいれば状態はそのままで applied: false） */
export function applyIeyasuOutcomeOnce(state: IeyasuState, battleId: string, outcome: BattleOutcome): { state: IeyasuState; applied: boolean } {
    if (state.appliedBattleId !== null && state.appliedBattleId === battleId && state.battle) return { state, applied: false };
    if (state.phase !== 'battle' || state.battleId !== battleId) throw new FlowError(`合戦 ${battleId} の結果を今の状態（${state.phase}・${state.battleId ?? 'なし'}）へは反映できません`);
    return { state: applyIeyasuOutcome(state, outcome), applied: true };
}

// ================= 結末 =================

/**
 * 方針 × 結果（× 信頼）で結末を決める（設計 §6）。
 * 勝利は方針ごと、撤退は共通、敗北は A・B で相手の信頼 ≥ 0 なら「盟友に支えられて退く」、C か信頼 < 0 なら「三河へ退く」。
 */
export function ieyasuEndingFor(state: IeyasuState): IeyasuEndingId {
    const p = state.policy;
    const o = state.battle;
    if (!p || !o) throw new FlowError('合戦の結果がないので結末を決められません');
    switch (o.result) {
        case 'victory':
            return p === 'oda' ? 'oda_victory' : p === 'asai' ? 'asai_victory' : 'home_victory';
        case 'retreat':
            return 'retreat';
        case 'defeat':
            return p !== 'home' && state.trust[PLEDGE_SPECS[p].partner] >= 0 ? 'defeat_sheltered' : 'defeat_mikawa';
    }
}

export function finishIeyasuChapter(state: IeyasuState): IeyasuState {
    if (state.phase !== 'aftermath') throw new FlowError(`今（${state.phase}）は章を締めくくれません`);
    const s = advanceTo(state, 'ending');
    s.ending = ieyasuEndingFor(s);
    return s;
}

// ================= 探索の位置・遊んだ時間・保存できるか =================

export function setIeyasuExplorePose(state: IeyasuState, pose: ExplorePose | null): IeyasuState {
    if (pose && !(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.heading))) throw new FlowError('探索の位置が数ではありません');
    const s = cloneIeyasuState(state);
    s.explore = pose
        ? {
              x: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.x)),
              z: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.z)),
              heading: Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading)),
          }
        : null;
    return s;
}

export const IEYASU_PLAY_TIME_MAX = 1e8;

export function addIeyasuPlayTime(state: IeyasuState, sec: number): IeyasuState {
    const s = cloneIeyasuState(state);
    if (Number.isFinite(sec) && sec > 0) s.playTimeSec = Math.min(IEYASU_PLAY_TIME_MAX, s.playTimeSec + sec);
    return s;
}

export function canSaveIeyasuManually(state: IeyasuState): boolean {
    return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
}

// ================= 確認用 =================

/**
 * 確認用（テスト・開発の早送り）：合戦の設定から、指定した結果の BattleOutcome を作る。
 * 実際の合戦の計算（battle/sim.ts）の代わりにはならない。本番の画面の流れでは使わない。
 * pledge を渡すと、その約束の結果（kept／broken）を結果に入れる（合戦の計算が入れるのと同じ形）。
 */
export function ieyasuOutcomeFromSetup(
    setup: BattleSetup,
    result: BattleResultKind,
    opts: {
        reason?: BattleEndReason;
        elapsedSec?: number;
        units?: Record<string, { end?: number; status?: UnitStatus }>;
        pledge?: 'kept' | 'broken';
        abilitiesUsed?: Record<string, number>;
    } = {},
): BattleOutcome {
    const reason: BattleEndReason = opts.reason ?? (result === 'victory' ? 'enemy_hq_routed' : result === 'defeat' ? 'ally_hq_routed' : 'ordered_retreat');
    const units = setup.units.map((u) => {
        const o = opts.units?.[u.id];
        let status: UnitStatus = 'ready';
        if (reason === 'enemy_hq_routed' && u.side === 'enemy' && u.kind === 'honjin') status = 'routed';
        if (reason === 'ally_hq_routed' && u.side === 'ally' && u.kind === 'honjin') status = 'routed';
        if (reason === 'ordered_retreat' && u.side === 'ally') status = 'withdrawn';
        status = o?.status ?? status;
        const end = Math.max(0, Math.min(u.strength, Math.round(o?.end ?? (status === 'destroyed' ? 0 : u.strength * 0.8))));
        const r: BattleOutcome['units'][number] = { id: u.id, side: u.side, clan: u.clan, startStrength: u.strength, endStrength: end, status };
        if (u.leaderId) r.leaderId = u.leaderId;
        return r;
    });
    const out: BattleOutcome = { result, reason, elapsedSec: opts.elapsedSec ?? 300, units };
    if (setup.pledge && opts.pledge) out.pledge = { targetId: setup.pledge.targetId, result: opts.pledge };
    if (opts.abilitiesUsed) out.abilitiesUsed = { ...opts.abilitiesUsed };
    return out;
}

const POLICY_CHOICE: Record<Policy, IeyasuChoiceId> = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' };

/**
 * 確認用：指定の段階の状態を、普通の遊び方と同じ関数の順で作る（テスト・開発の早送り専用）。
 * pledge：'accept'（引き受ける。結果は pledgeResult）／'decline'。
 */
export function devIeyasuState(
    phase: 'explore' | 'muster' | 'aftermath' | 'ending',
    policy: Policy = 'oda',
    result: BattleResultKind = 'victory',
    opts: { pledge?: 'accept' | 'decline'; pledgeResult?: 'kept' | 'broken'; answerPledge?: boolean } = {},
): IeyasuState {
    let s = newIeyasuGame();
    if (phase === 'explore') return s;
    s = finishTalkIeyasu(s, 'tadakatsu', 'open_council');
    s = finishTalkIeyasu(s, 'council', POLICY_CHOICE[policy]);
    s = finishTalkIeyasu(s, 'council', 'confirm_policy');
    const giver = PLEDGE_SPECS[policy].giver;
    const pledge = opts.pledge ?? 'accept';
    if (phase === 'muster' && opts.answerPledge === false) return s;
    s = finishTalkIeyasu(s, giver, pledge === 'accept' ? 'pledge_accept' : 'pledge_decline');
    if (phase === 'muster') return s;
    s = finishTalkIeyasu(s, 'gate', 'depart');
    s = applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), result, { pledge: opts.pledgeResult ?? 'kept' }));
    if (phase === 'aftermath') return s;
    return finishTalkIeyasu(s, 'tadakatsu', 'end_chapter');
}
