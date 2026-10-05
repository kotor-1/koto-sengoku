/**
 * 歴史分岐「元亀元年・家康」第二章の進め方（純粋な関数。three も DOM も使わない）。設計：docs/chapter2-design.md。
 *
 * ＊＊ 第一章の直後の、分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない ＊＊
 *
 * - 第一章の結末の状態から、第二章のはじめの状態を作る（startChapter2。純粋。同じ入力なら同じ結果。足し算を重ねない）。
 * - 段階は explore → council → muster → battle → aftermath → ending の一方向にだけ進む。それ以外は FlowError。
 *   どの関数も受け取った状態を書き換えず、新しい状態を返す。
 * - 軍議で今回の判断（判断 1・判断 2）を選び、確かめて決める。決めた時に、第一章の終わりの兵を基準に任務の条件（terms：兵が少ないときの
 *   調整・主目標の値・始めの陣）を確定する（以後は求め直さない。判断を変えられるのは決める前の「考え直す」だけ）。
 *   支度で石川数正と補充を決める（1 回だけ。答えるまで出陣できない。補充で兵が戻っても任務の条件は変わらない）。
 * - 合戦の設定は chapter2/battle.ts の ch2BattleSetup（合戦の担当の物。ここは呼ぶだけ）。支援は設定を作るたびに状態から求める（兵に足さない）。
 * - 合戦の結果は合戦の id（battleId）ごとに 1 回だけ反映する（applyIeyasu2OutcomeOnce）。
 * - どの方針 × 勝敗でも、戦後と第二章の区切り（9 つ）へ着く。家康は死なない。一度の局地戦で家が滅ぶことはない。
 *
 * 補充の決まり（CH2_RECOVERY）と第二章の信頼の動き（CH2_TRUST_DELTA）は chapter2/rules.ts の 1 か所（ゲーム用の数値。ここから再び出す）。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, BattleSetup, ObjectiveDef, ObjectiveResult, UnitStatus } from '../../../battle/types';
import { IEYASU_UNIT_IDS } from '../../../battle/maps';
import { FlowError } from '../../flow';
import { EXPLORE_LIMIT, isBattleId, isFiniteNumber, isObject } from '../../state';
import type { ScenarioScript } from '../../scenario';
import {
    applyIeyasuOutcome,
    finishTalkIeyasu,
    IEYASU_PLAY_TIME_MAX,
    ieyasuBattleSetup,
    ieyasuOutcomeFromSetup,
    newIeyasuGame,
} from '../flow';
import { IEYASU_TROOPS_MAX, PLEDGE_SPECS, TOKUGAWA_UNIT_IDS, TRUST_IDS, clampTrust, parseIeyasuOutcome, type IeyasuState, type PledgeResult, type Policy, type TokugawaUnitId, type TrustId } from '../state';
import { CH2_UNIT, ch2DecideTerms, ch2PlanAvailability, type Ch2Plan } from './battle';
import { availableCh2Plans, ch2RecoveryOptions, ch2TrustDelta, ieyasu2BattleInfo } from './rules';
import {
    IEYASU2_TALK_SLOTS,
    OBJECTIVE_TYPES_ALL,
    cloneChapter1Record,
    cloneIeyasu2Outcome,
    cloneIeyasu2State,
    cloneObjectiveResult,
    ieyasu2TalkFlag,
    isChapter2,
    type Ieyasu2ChoiceId,
    type Ieyasu2EndingId,
    type Ieyasu2Result,
    type Ieyasu2State,
    type Ieyasu2TalkId,
    type RecoveryChoice,
    type RecoveryState,
} from './state';
import { ieyasu2ScriptFor } from './story';

export * from './rules';
export { FlowError };

/** 第二章の合戦の id（出陣の時に付く。ChapterGame が出陣ごとの id に付け替える） */
export const IEYASU2_DEFAULT_BATTLE_ID = 'ieyasu1570-ch2-field';

// ================= 第一章 → 第二章 =================

const NEXT_PHASE = { explore: 'council', council: 'muster', muster: 'battle', battle: 'aftermath', aftermath: 'ending', ending: null } as const;

/**
 * 第一章の結末の状態から、第二章のはじめの状態を作る（純粋。同じ入力なら同じ結果。何度呼んでも足し算を重ねない）。
 * phase が 'ending' で結末がある第一章の状態だけ（それ以外は FlowError）。
 * 兵・信頼・人物は第一章の終わりの値をそのまま写す（援兵はもう兵に入っている。足さない）。遊んだ時間も引き継ぐ。
 */
export function startChapter2(ch1: IeyasuState): Ieyasu2State {
    if (isChapter2(ch1)) throw new FlowError('すでに第二章の状態です');
    if (ch1.phase !== 'ending' || !ch1.ending) throw new FlowError('第一章の結末に着いていないので、第二章へ進めません');
    if (!ch1.policy || !ch1.battle || !ch1.pledge || ch1.pledge.result === null || !ch1.support) throw new FlowError('第一章の結果がそろっていません');
    const chapter1 = cloneChapter1Record({
        policy: ch1.policy,
        battle: ch1.battle,
        pledge: ch1.pledge,
        support: ch1.support,
        sideObjectives: ch1.sideObjectives,
        ending: ch1.ending,
        trust: ch1.trust,
        troops: ch1.troops,
        characters: ch1.characters,
        playTimeSec: ch1.playTimeSec,
    });
    return {
        scenario: ch1.scenario,
        chapter: 2,
        phase: 'explore',
        chapter1,
        policy: ch1.policy,
        trust: { ...ch1.trust },
        troops: { ...ch1.troops },
        characters: { ...ch1.characters },
        talked: {},
        plan: null,
        pendingPlan: null,
        terms: null,
        recovery: null,
        battle: null,
        battleId: null,
        appliedBattleId: null,
        result: null,
        ending: null,
        explore: null,
        playTimeSec: ch1.playTimeSec,
        savedAt: null,
    };
}

function advanceTo(state: Ieyasu2State, to: Ieyasu2State['phase']): Ieyasu2State {
    if (NEXT_PHASE[state.phase] !== to) throw new FlowError(`${state.phase} から ${to} へは進めません`);
    const s = cloneIeyasu2State(state);
    s.phase = to;
    switch (to) {
        case 'muster':
            if (!s.plan || !s.terms) throw new FlowError('判断が決まっていません');
            if (s.battle) throw new FlowError('合戦の結果がすでにあります');
            s.pendingPlan = null;
            break;
        case 'battle':
            if (!s.plan || !s.terms) throw new FlowError('判断が決まっていません');
            if (!s.recovery) throw new FlowError('補充の判断をしていません');
            if (s.battle) throw new FlowError('合戦の結果がすでにあります');
            break;
        case 'aftermath':
        case 'ending':
            if (!s.plan || !s.terms || !s.recovery || !s.battle || !s.result) throw new FlowError('合戦の結果がありません');
            break;
        default:
            break;
    }
    return s;
}

// ================= 補充 =================

/** 補充を選んだ：1 回だけ兵を変え、recovery に残す（答えた後は選べない） */
function applyRecovery(state: Ieyasu2State, choice: RecoveryChoice): Ieyasu2State {
    if (state.phase !== 'muster') throw new FlowError(`今（${state.phase}）は補充を決められません`);
    if (state.recovery) throw new FlowError('補充はもう決めました（1 回だけ）');
    const opt = ch2RecoveryOptions(state)[choice];
    if (!opt.available) throw new FlowError(`この補充は選べません：${opt.reason}`);
    const s = cloneIeyasu2State(state);
    for (const k of TOKUGAWA_UNIT_IDS) s.troops[k] = Math.max(0, Math.min(IEYASU_TROOPS_MAX, s.troops[k] + opt.delta[k]));
    const rec: RecoveryState = { choice, delta: { ...opt.delta } };
    s.recovery = rec;
    return s;
}

// ================= 会話 =================

/** 今の段階で話しかけられる相手 */
export function presentIeyasu2Talks(state: Ieyasu2State): Ieyasu2TalkId[] {
    return [...IEYASU2_TALK_SLOTS[state.phase]];
}

function isTalkId(id: string): id is Ieyasu2TalkId {
    return (['tadakatsu', 'ishikawa', 'envoy', 'notice', 'gate', 'council'] as const).includes(id as Ieyasu2TalkId);
}

export function canTalkIeyasu2(state: Ieyasu2State, id: string): boolean {
    return isTalkId(id) && presentIeyasu2Talks(state).includes(id);
}

export function talkIeyasu2(state: Ieyasu2State, id: string): ScenarioScript {
    if (!canTalkIeyasu2(state, id)) throw new FlowError(`今（${state.phase}）は ${id} と話せません`);
    return ieyasu2ScriptFor(state, id as Ieyasu2TalkId);
}

export function hasTalkedIeyasu2(state: Ieyasu2State, id: Ieyasu2TalkId, phase: Ieyasu2State['phase'] = state.phase): boolean {
    return state.talked[ieyasu2TalkFlag(phase, id)] === true;
}

/**
 * 会話を読み終えた。済み印を立て、選択肢の結果を反映した新しい状態を返す。
 * 選択肢のある会話では choiceId が必須で、その会話の選択肢の中の物でなければ投げる。
 */
export function finishTalkIeyasu2(state: Ieyasu2State, id: string, choiceId?: string): Ieyasu2State {
    const script = talkIeyasu2(state, id);
    if (script.choices) {
        if (!choiceId || !script.choices.some((c) => c.id === choiceId)) throw new FlowError(`この会話（${script.id}）の選択肢に ${String(choiceId)} はありません`);
    } else if (choiceId) {
        throw new FlowError(`この会話（${script.id}）に選択肢はありません`);
    }
    // 信頼は会話だけでは動かさない（動くのは合戦の結果だけ）
    let s = cloneIeyasu2State(state);
    s.talked[ieyasu2TalkFlag(s.phase, id as Ieyasu2TalkId)] = true;
    if (choiceId) s = chooseIeyasu2(s, choiceId as Ieyasu2ChoiceId);
    return s;
}

/** 今の段階で選べる選択肢 */
export function legalIeyasu2Choices(state: Ieyasu2State): Ieyasu2ChoiceId[] {
    switch (state.phase) {
        case 'explore':
            return ['open_council', 'not_yet'];
        case 'council':
            return state.pendingPlan ? ['confirm_plan', 'reconsider'] : availableCh2Plans(state).map((p) => (p === 'commit' ? 'plan_commit' : 'plan_hold'));
        case 'muster': {
            if (state.recovery) return ['depart', 'stay'];
            const o = ch2RecoveryOptions(state);
            const out: Ieyasu2ChoiceId[] = [];
            if (o.wait.available) out.push('recovery_wait');
            if (o.transfer.available) out.push('recovery_transfer');
            out.push('recovery_none', 'recovery_later', 'stay');
            return out;
        }
        case 'aftermath':
            return ['end_chapter', 'not_yet'];
        default:
            return [];
    }
}

export function chooseIeyasu2(state: Ieyasu2State, choiceId: Ieyasu2ChoiceId): Ieyasu2State {
    if (!legalIeyasu2Choices(state).includes(choiceId)) throw new FlowError(`今（${state.phase}）は ${choiceId} を選べません`);
    switch (choiceId) {
        case 'open_council':
            return advanceTo(state, 'council');
        case 'not_yet':
        case 'stay':
        case 'recovery_later':
            return cloneIeyasu2State(state);
        case 'plan_commit':
        case 'plan_hold': {
            const s = cloneIeyasu2State(state);
            s.pendingPlan = choiceId === 'plan_commit' ? 'commit' : 'hold';
            return s;
        }
        case 'confirm_plan': {
            // 判断を決めた時に、第一章の終わりの兵を基準に任務の条件を確定する（この後の補充・保存・読み込み直しでは求め直さない）
            const s = cloneIeyasu2State(state);
            s.plan = s.pendingPlan;
            s.terms = ch2DecideTerms(s.policy, s.plan!, s.chapter1.troops);
            return advanceTo(s, 'muster');
        }
        case 'reconsider': {
            const s = cloneIeyasu2State(state);
            s.pendingPlan = null;
            return s;
        }
        case 'recovery_wait':
            return applyRecovery(state, 'wait');
        case 'recovery_transfer':
            return applyRecovery(state, 'transfer');
        case 'recovery_none':
            return applyRecovery(state, 'none');
        case 'depart':
            return departIeyasu2(state);
        case 'end_chapter':
            return finishIeyasu2Chapter(state);
    }
}

// ================= 出陣・合戦 =================

/** 出陣する（muster → battle）。判断と補充が済んでいること */
export function departIeyasu2(state: Ieyasu2State): Ieyasu2State {
    if (state.phase !== 'muster') throw new FlowError(`今（${state.phase}）は出陣できません`);
    if (state.plan && !ch2PlanAvailability(state.plan, state.troops).available) throw new FlowError('この判断では出陣できません');
    const s = advanceTo(state, 'battle');
    s.battleId = IEYASU2_DEFAULT_BATTLE_ID;
    s.appliedBattleId = null;
    return s;
}

export function withIeyasu2BattleId(state: Ieyasu2State, id: string): Ieyasu2State {
    if (state.phase !== 'battle' || state.appliedBattleId !== null) throw new FlowError('合戦の id を付けられるのは、出陣した直後だけです');
    if (!isBattleId(id)) throw new FlowError(`合戦の id の形が正しくありません：${id}`);
    const s = cloneIeyasu2State(state);
    s.battleId = id;
    return s;
}

/** 合戦の設定（phase が battle のときだけ）。武将の行に出す信頼（relations）を足す（合戦の計算には使わない） */
export function ieyasu2BattleSetup(state: Ieyasu2State): BattleSetup {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦を始められません`);
    const info = ieyasu2BattleInfo(state);
    return { ...info.setup, relations: { ...state.trust } };
}

const brokenStatus = (s: UnitStatus) => s === 'routed' || s === 'destroyed';

/** 目標の 1 行（設定の定義の名前・種類を使い、達成は結果から） */
function objectiveRow(def: ObjectiveDef & { id: string; label: string }, o: BattleOutcome, fallback: boolean, primary: boolean): ObjectiveResult {
    const rows = primary ? (o.objectives?.primary ? [o.objectives.primary] : []) : (o.objectives?.secondary ?? []);
    const row = rows.find((r) => r.id === def.id);
    const out: ObjectiveResult = row ? cloneObjectiveResult(row) : { id: def.id, type: def.type, label: def.label, achieved: fallback };
    out.id = def.id;
    out.type = def.type;
    out.label = def.label;
    return out;
}

/**
 * 合戦の結果を反映する（battle → aftermath）。
 * - 徳川の部隊の兵：出陣した部隊の生き残った兵を戻す（出なかった部隊はそのまま）。
 * - 人物：家康本陣・忠勝隊・（B で長政が率いた）浅井の隊が敗走・全滅 → その武将は負傷（死亡・捕らわれは無い）。
 * - 信頼：CH2_TRUST_DELTA。
 * - 記録（result）：出陣した兵・失った兵・主目標・副目標・支援・判断・補充・退いて終わった区別。
 */
export function applyIeyasu2Outcome(state: Ieyasu2State, outcome: BattleOutcome): Ieyasu2State {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦の結果を受け取れません`);
    if (!state.battleId || state.appliedBattleId !== null) throw new FlowError('この合戦の結果は、すでに反映したか、合戦の id がありません');
    const o = parseIeyasu2Outcome(outcome);
    if (!o) throw new FlowError('合戦の結果の形が正しくありません');
    const hq = o.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin);
    if (!hq || hq.side !== 'ally' || hq.clan !== 'tokugawa') throw new FlowError('合戦の結果に家康本陣がありません');
    const info = ieyasu2BattleInfo(state);
    const s = cloneIeyasu2State(state);
    const plan = s.plan!;
    s.battle = cloneIeyasu2Outcome(o);

    // 兵（出陣した部隊だけ）
    const sortieTroops: Partial<Record<TokugawaUnitId, number>> = {};
    const lost: Partial<Record<TokugawaUnitId, number>> = {};
    for (const k of info.sortie) {
        const u = o.units.find((x) => x.id === IEYASU_UNIT_IDS[k]);
        if (!u || u.side !== 'ally' || u.clan !== 'tokugawa') continue;
        sortieTroops[k] = u.startStrength;
        lost[k] = Math.max(0, u.startStrength - u.endStrength);
        s.troops[k] = Math.max(0, Math.min(IEYASU_TROOPS_MAX, Math.round(u.endStrength)));
    }

    // 人物（味方の武将だけ）
    if (brokenStatus(hq.status)) s.characters.ieyasu = 'wounded';
    const tk = o.units.find((u) => u.id === IEYASU_UNIT_IDS.tadakatsu);
    if (tk && tk.side === 'ally' && brokenStatus(tk.status)) s.characters.tadakatsu = 'wounded';
    const ng = o.units.find((u) => u.id === CH2_UNIT.asai);
    if (s.policy === 'asai' && ng && ng.side === 'ally' && ng.leaderId === 'nagamasa' && brokenStatus(ng.status)) s.characters.nagamasa = 'wounded';

    // 信頼
    const delta = ch2TrustDelta(s.policy, plan, o.result);
    for (const k of TRUST_IDS) s.trust[k] = clampTrust(s.trust[k] + delta[k]);
    const trustDelta = Object.fromEntries(TRUST_IDS.map((k) => [k, s.trust[k] - state.trust[k]])) as Record<TrustId, number>;

    // 目標（定義は設定から。達成は結果から）
    const defs = info.setup.objectives;
    const primary = defs?.primary ? objectiveRow(defs.primary, o, o.result === 'victory', true) : null;
    const secondary = (defs?.secondary ?? []).map((d) => objectiveRow(d, o, false, false));

    const result: Ieyasu2Result = {
        plan,
        recovery: s.recovery!.choice,
        sortie: [...info.sortie],
        sortieTroops,
        lost,
        support: [...info.support],
        thin: info.terms.thin,
        primary,
        secondary,
        withdrawal: o.withdrawal ?? null,
        trustDelta,
    };
    s.result = result;

    const next = advanceTo(s, 'aftermath');
    next.appliedBattleId = next.battleId;
    next.explore = null;
    return next;
}

/** 合戦の結果を、その合戦（battleId）に対して 1 回だけ反映する（済んでいれば状態はそのままで applied: false） */
export function applyIeyasu2OutcomeOnce(state: Ieyasu2State, battleId: string, outcome: BattleOutcome): { state: Ieyasu2State; applied: boolean } {
    if (state.appliedBattleId !== null && state.appliedBattleId === battleId && state.battle) return { state, applied: false };
    if (state.phase !== 'battle' || state.battleId !== battleId) throw new FlowError(`合戦 ${battleId} の結果を今の状態（${state.phase}・${state.battleId ?? 'なし'}）へは反映できません`);
    return { state: applyIeyasu2Outcome(state, outcome), applied: true };
}

// ================= 結果の検査 =================

/** 目標の結果の 1 行を検査して写す */
export function parseObjectiveResultRow(v: unknown): ObjectiveResult | null {
    if (!isObject(v)) return null;
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v.id)) return null;
    if (!OBJECTIVE_TYPES_ALL.includes(v.type as ObjectiveResult['type'])) return null;
    if (typeof v.label !== 'string' || v.label.length === 0 || v.label.length > 200) return null;
    if (typeof v.achieved !== 'boolean') return null;
    const r: ObjectiveResult = { id: v.id, type: v.type as ObjectiveResult['type'], label: v.label, achieved: v.achieved };
    for (const key of ['steps', 'count'] as const) {
        if (v[key] === undefined) continue;
        const x = v[key];
        if (!isObject(x) || !Number.isInteger(x.done) || !Number.isInteger(x.total)) return null;
        const done = x.done as number;
        const total = x.total as number;
        if (done < 0 || total < 0 || done > 100 || total > 100) return null;
        r[key] = { done, total };
    }
    if (v.met !== undefined) {
        if (typeof v.met !== 'boolean') return null;
        r.met = v.met;
    }
    return r;
}

/**
 * 第二章の合戦の結果を検査して写す（第一章の検査に、主目標で終わった理由・目標の結果・退いて終わった区別を足す）。
 * 理由 objective_done は勝利、objective_failed は敗北だけ。
 */
export function parseIeyasu2Outcome(v: unknown): BattleOutcome | null {
    if (!isObject(v)) return null;
    const reason = v.reason as BattleEndReason;
    let sub: BattleEndReason | null = null;
    if (reason === 'objective_done') {
        if (v.result !== 'victory') return null;
        sub = 'enemy_hq_routed';
    } else if (reason === 'objective_failed') {
        if (v.result !== 'defeat') return null;
        sub = 'ally_hq_routed';
    }
    const base = parseIeyasuOutcome(sub ? { ...v, reason: sub } : v);
    if (!base) return null;
    if (sub) base.reason = reason;
    if (v.objectives !== undefined) {
        const ob = v.objectives;
        if (!isObject(ob) || !Array.isArray(ob.secondary) || ob.secondary.length > 8) return null;
        const secondary: ObjectiveResult[] = [];
        for (const r of ob.secondary as unknown[]) {
            const x = parseObjectiveResultRow(r);
            if (!x) return null;
            secondary.push(x);
        }
        const out: NonNullable<BattleOutcome['objectives']> = { secondary };
        if (ob.primary !== undefined) {
            const p = parseObjectiveResultRow(ob.primary);
            if (!p) return null;
            out.primary = p;
        }
        base.objectives = out;
    }
    if (v.withdrawal !== undefined) {
        if (v.withdrawal !== 'objective' && v.withdrawal !== 'abandoned') return null;
        base.withdrawal = v.withdrawal;
    }
    return base;
}

// ================= 結末 =================

export function ieyasu2EndingFor(state: Ieyasu2State): Ieyasu2EndingId {
    if (!state.battle) throw new FlowError('合戦の結果がないので結末を決められません');
    return `ch2_${state.policy}_${state.battle.result}`;
}

export function finishIeyasu2Chapter(state: Ieyasu2State): Ieyasu2State {
    if (state.phase !== 'aftermath') throw new FlowError(`今（${state.phase}）は章を締めくくれません`);
    const s = advanceTo(state, 'ending');
    s.ending = ieyasu2EndingFor(s);
    return s;
}

// ================= 探索の位置・遊んだ時間・保存できるか =================

export function setIeyasu2ExplorePose(state: Ieyasu2State, pose: { x: number; z: number; heading: number } | null): Ieyasu2State {
    if (pose && !(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.heading))) throw new FlowError('探索の位置が数ではありません');
    const s = cloneIeyasu2State(state);
    s.explore = pose
        ? {
              x: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.x)),
              z: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.z)),
              heading: Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading)),
          }
        : null;
    return s;
}

export function addIeyasu2PlayTime(state: Ieyasu2State, sec: number): Ieyasu2State {
    const s = cloneIeyasu2State(state);
    if (isFiniteNumber(sec) && sec > 0) s.playTimeSec = Math.min(IEYASU_PLAY_TIME_MAX, s.playTimeSec + sec);
    return s;
}

export function canSaveIeyasu2Manually(state: Ieyasu2State): boolean {
    return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
}

// ================= 確認用（テスト・開発の早送り。本番の画面の流れでは使わない） =================

/**
 * 確認用：第二章の合戦の設定から、指定した結果の BattleOutcome を作る（実際の合戦の計算の代わりにはならない）。
 * 勝利は「主目標を果たした」、敗北は「家康本陣が崩れた」、撤退は「撤退の命令」。主目標の行を入れ、副目標は secondary（省けば果たせなかった）。
 */
export function ieyasu2OutcomeFromSetup(
    setup: BattleSetup,
    result: BattleResultKind,
    opts: { units?: Record<string, { end?: number; status?: UnitStatus }>; elapsedSec?: number; secondary?: boolean; abilitiesUsed?: Record<string, number> } = {},
): BattleOutcome {
    const reason: BattleEndReason = result === 'victory' ? 'objective_done' : result === 'defeat' ? 'ally_hq_routed' : 'ordered_retreat';
    const base = ieyasuOutcomeFromSetup(setup, result, {
        reason,
        elapsedSec: opts.elapsedSec ?? 360,
        ...(opts.units ? { units: opts.units } : {}),
        ...(opts.abilitiesUsed ? { abilitiesUsed: opts.abilitiesUsed } : {}),
    });
    const P = setup.objectives?.primary;
    const S = setup.objectives?.secondary ?? [];
    base.objectives = {
        ...(P ? { primary: { id: P.id, type: P.type, label: P.label, achieved: result === 'victory' } } : {}),
        secondary: S.map((d) => ({ id: d.id, type: d.type, label: d.label, achieved: opts.secondary ?? false })),
    };
    if (setup.endRules) {
        if (result === 'retreat') base.withdrawal = 'abandoned';
        else if (result === 'victory' && P && (P.type === 'withdraw' || P.type === 'escape')) base.withdrawal = 'objective';
    }
    return base;
}

const POLICY_CHOICE = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' } as const;

/** 確認用：第一章の結末の状態（普通の遊び方と同じ関数の順。合戦は偽の結果。heavy は忠勝隊・弓隊（C は守備隊も）がほぼ失われた敗北） */
export function devIeyasuCh1Ending(policy: Policy, result: BattleResultKind, pledge: PledgeResult, opts: { heavy?: boolean } = {}): IeyasuState {
    let s = newIeyasuGame();
    s = finishTalkIeyasu(s, 'tadakatsu', 'open_council');
    s = finishTalkIeyasu(s, 'council', POLICY_CHOICE[policy]);
    s = finishTalkIeyasu(s, 'council', 'confirm_policy');
    s = finishTalkIeyasu(s, PLEDGE_SPECS[policy].giver, pledge === 'declined' ? 'pledge_decline' : 'pledge_accept');
    s = finishTalkIeyasu(s, 'gate', 'depart');
    const units: Record<string, { end?: number; status?: UnitStatus }> = {};
    if (opts.heavy) {
        units.t_tadakatsu = { end: 25, status: 'routed' };
        units.t_yumi = { end: 20, status: 'routed' };
        if (result === 'defeat') units.t_honjin = { end: 140, status: 'routed' };
        if (policy === 'home') units.t_reserve = { end: 30, status: 'routed' };
    }
    const o = ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), result, { units, ...(pledge === 'declined' ? {} : { pledge }) });
    s = applyIeyasuOutcome(s, o);
    return finishTalkIeyasu(s, 'tadakatsu', 'end_chapter');
}

export interface DevIeyasu2Options {
    /** 第一章の合戦の結果（省けば victory） */
    ch1Result?: BattleResultKind;
    /** 第一章の約束（省けば kept） */
    ch1Pledge?: PledgeResult;
    /** 第一章の損害が大きい */
    heavy?: boolean;
    /** 第二章の判断（省けば選べる最初の判断） */
    plan?: Ch2Plan;
    /** 補充（省けば none。false なら支度で補充に答える前） */
    recovery?: RecoveryChoice | false;
    /** 第二章の合戦の結果（省けば victory） */
    result?: BattleResultKind;
}

/**
 * 確認用：第二章の指定の段階の状態を、普通の遊び方と同じ関数の順で作る（テスト・開発の早送り専用。直接状態変更）。
 * 第一章の結末（devIeyasuCh1Ending）→ startChapter2 → 忠勝と話して軍議 → 判断 → 石川と補充 → 城門で出陣 → 偽の結果 → 戦後 → 区切り。
 */
export function devIeyasu2State(phase: 'explore' | 'muster' | 'aftermath' | 'ending', policy: Policy = 'oda', opts: DevIeyasu2Options = {}): Ieyasu2State {
    let s = startChapter2(devIeyasuCh1Ending(policy, opts.ch1Result ?? 'victory', opts.ch1Pledge ?? 'kept', { heavy: opts.heavy }));
    if (phase === 'explore') return s;
    s = finishTalkIeyasu2(s, 'tadakatsu', 'open_council');
    const plan = opts.plan ?? availableCh2Plans(s)[0]!;
    s = finishTalkIeyasu2(s, 'council', plan === 'commit' ? 'plan_commit' : 'plan_hold');
    s = finishTalkIeyasu2(s, 'council', 'confirm_plan');
    if (opts.recovery === false && phase === 'muster') return s;
    const rec = opts.recovery || 'none';
    s = finishTalkIeyasu2(s, 'ishikawa', `recovery_${rec}`);
    if (phase === 'muster') return s;
    s = finishTalkIeyasu2(s, 'gate', 'depart');
    s = applyIeyasu2Outcome(s, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(s), opts.result ?? 'victory'));
    if (phase === 'aftermath') return s;
    return finishTalkIeyasu2(s, 'tadakatsu', 'end_chapter');
}
