/**
 * 歴史分岐「元亀元年・家康」の情勢の画面の中身（状態を読むだけの純粋な関数）。設計：docs/story-rpg-design.md §4。型：story/types.ts（SituationView）。
 *
 * - いつ・今いる所・協力・敵対（記号と名前）・前の章の結果（第二章）・今の危機・今回の目的（主目標の基本の説明。物見をしなくても分かる。
 *   第二章で判断を決めた後は確定した条件の主目標の文）・模式図の地図・物見の記録・演出の見直し。
 * - 軍議から開いたとき（opts.options）は、方針（第一章 policy_*）・判断（第二章 plan_*）ごとに強調する場所・進路と短い説明（見るだけ。決めない）。
 * - 出さないもの：未発見の敵の位置・合戦の前の説明でしか言っていない伏兵・援軍の出る所・敵の配置（地図は場所と関係と進路だけ。
 *   危機の「脅かす向き」は推定の向きで、正確な位置ではない）。
 * 文は既存の分岐の文（軍議の選択肢・使者・高札・結果確認）を短くした物。新しい史実・地名・日付は足さない。
 */
import type { MapPlace, MapRoute, SituationOption, SituationView } from '../../../story/types';
import type { Ch2Plan } from '../chapter2/battle';
import { ch2ThinLine } from '../chapter2/battle';
import { availableCh2Plans, ieyasu2BattleInfo } from '../chapter2/rules';
import { isChapter2, type Ieyasu2State, type IeyasuAnyState } from '../chapter2/state';
import { CH2_MISSION_TITLES, CH2_PLAN_LABELS, CH2_SUPPORT_NAMES, IEYASU2_PHASE_LABELS, ch1SummaryText, planChoice, planPos, termsText } from '../chapter2/story';
import { PLEDGE_SPECS, type IeyasuState, type Policy } from '../state';
import { IEYASU_PHASE_LABELS, IEYASU_RESULT_LABELS, IEYASU_TALK_NAMES, POLICY_LABELS, ieyasuObjective, ieyasuReasonLabel, pledgeRecordText } from '../story';
import { ieyasu2Objective, ieyasu2ReasonLabel } from '../chapter2/story';
import { ieyasuReplays, crisisLines } from './cinematics';
import { CH2_SITE } from './geo';
import {
    ch1ResultOf,
    ch2SitePlace,
    conflictRoutes,
    field1Place,
    homePlace,
    marchRoute,
    partyLine,
    partyPlaces,
    relationRoutes,
    relationsOf,
    returnRoute,
    scene,
    threatRoute,
} from './map';
import { scoutCouncilLine, scoutEntries, scoutHint, scoutedMarks } from './scout';

type Opts = { from: 'explore' | 'council'; options?: { id: string; label: string }[] };

const WHEN = '元亀元年（1570年）';
const HOME = '徳川の城下（三河）';

/** 今いる所（徳川の城下と今の段階）。段階の名前の「城下」は今いる所と重なるので省く（「徳川の城下（三河）・城下」にしない） */
function whereOf(phaseLabel: string, extra = ''): string {
    const ph = phaseLabel.replace(/・?城下$/, '');
    return `${HOME}${ph ? `・${ph}` : ''}${extra}`;
}

/** 物見の記録の場所・線を地図に足す */
function withScout(places: MapPlace[], routes: MapRoute[], s: IeyasuAnyState): { places: MapPlace[]; routes: MapRoute[] } {
    const es = scoutEntries(s);
    return { places: [...places, ...es.flatMap((e) => e.places ?? [])], routes: [...routes, ...es.flatMap((e) => e.routes ?? [])] };
}

/** 物見の記録のうち、選択肢に関わる場所の id（地図の強調に足す） */
function scoutHighlight(s: IeyasuAnyState, choice: string): string[] {
    const line = scoutCouncilLine(s, choice);
    if (!line) return [];
    // 選択肢に関わる記録（scoutCouncilLine と同じ選び方）の場所
    const marks = scoutedMarks(s);
    // 物見の場所の id は印の id と同じ（scoutEntries）
    return marks.filter((d) => line.includes(d.short)).map((d) => d.id);
}

// ================================================================ 第一章

/** 方針の選択肢の短い説明（軍議の選択肢の説明を短くした物。数は書かない） */
const CH1_OPTION_TEXT: Readonly<Record<Policy, string>> = {
    oda: '国境の原で、浅井・朝倉の勢と戦う。味方に織田援軍（前に出て孤立しやすい）。戦後、浅井とは敵味方のまま。',
    asai: '史実から分かれた道（創作）。国境の原で、浅井の退き口を守り、織田方の一隊の追撃を止める。味方に浅井長政隊。戦後、織田の信頼は大きく下がる。',
    home: '両家への宣戦ではない。どちらにも兵を出さず、国境の村を荒らす浪人衆を退ける。味方に岡崎の守備隊（国境の砦に孤立）。戦後、織田は不満を持つ。',
};
const CH1_OPTION_HL: Readonly<Record<Policy, string[]>> = {
    oda: ['oda', 'asai', 'asakura', 'field1', 'march.field1'],
    asai: ['asai', 'oda', 'field1', 'march.field1'],
    home: ['border', 'field1', 'march.field1'],
};
const POLICY_OF_CHOICE: Readonly<Record<string, Policy>> = { policy_oda: 'oda', policy_asai: 'asai', policy_home: 'home' };

function ch1Option(s: IeyasuState, id: string, label: string): SituationOption | null {
    let p: Policy | undefined = POLICY_OF_CHOICE[id];
    let prefix = '';
    if (!p && id === 'confirm_policy' && s.pendingPolicy) {
        p = s.pendingPolicy;
        prefix = '決めると変えられない。';
    }
    if (id === 'reconsider') return { id, label, highlight: ['home'], text: '方針を選び直す（まだ何も決まらない）。' };
    if (!p) return null;
    const scout = scoutCouncilLine(s, `policy_${p}`);
    return {
        id,
        label,
        highlight: [...CH1_OPTION_HL[p], ...scoutHighlight(s, `policy_${p}`)],
        text: `${prefix}${CH1_OPTION_TEXT[p]}${scout ? ` ${scout}` : ''}`,
    };
}

/** 第一章の方針ごとの危機（軍議・支度の会話で言っていることだけ） */
const CH1_CRISIS: Readonly<Record<Policy, string>> = {
    oda: '国境の原で、浅井長政隊（敵の本陣）・浅井の先手と弓・朝倉勢と戦う。織田援軍は前に出て孤立しやすい。',
    asai: '国境の原で、浅井長政隊の退き口を守り、織田方の一隊の追撃を止める（史実から分かれた道）。',
    home: '国境の村を荒らす浪人衆を退ける。岡崎の守備隊が国境の砦で囲まれかけている。',
};
/** 第一章の方針ごとの目的の基本（主目標の基本の説明） */
const CH1_OBJECTIVE: Readonly<Record<Policy, string>> = {
    oda: '浅井・朝倉の攻勢を退ける（敵の本陣：浅井長政隊）。',
    asai: '浅井の退き口を守り、織田方の追撃を止める。',
    home: '国境の村を荒らす浪人衆を退ける。',
};

function ch1View(s: IeyasuState, opts: Opts): SituationView {
    const p = s.policy;
    const rel = relationsOf(p);
    const result = ch1ResultOf(s);
    const places: MapPlace[] = [homePlace(), ...partyPlaces(p), field1Place(result)];
    const routes: MapRoute[] = [...relationRoutes(p)];
    // 方針の前：近江の対立（背景）だけ。両家の使者の線は演出で見せる（情勢の地図には出さない：線が多いと場所の名前が読みにくい）
    if (!p) routes.push(...conflictRoutes().slice(0, 1));
    // 進路：方針の前（軍議で見比べる）と支度は出陣の先、戦後は帰還
    if (s.phase === 'aftermath' || s.phase === 'ending') routes.push(returnRoute('field1'));
    else routes.push(marchRoute('field1'));
    const sc = withScout(places, routes, s);
    const highlight: string[] = p ? ['field1'] : ['oda', 'asai'];
    const allies: string[] = [];
    const enemies: string[] = [];
    if (p === null) {
        allies.push(partyLine('oda', rel.oda, 'これまで共に動いてきた'));
        enemies.push('まだ無い（軍議で方針を決めると決まる）');
    } else if (p === 'oda') {
        allies.push(partyLine('oda', rel.oda, '協力を続ける'));
        enemies.push(partyLine('asai', rel.asai), partyLine('asakura', rel.asakura));
    } else if (p === 'asai') {
        allies.push(partyLine('asai', rel.asai, '史実から分かれた道'));
        enemies.push(partyLine('oda', rel.oda, '織田方の一隊'));
    } else {
        allies.push(`${partyLine('oda', rel.oda, '戦わない')}・${partyLine('asai', rel.asai, '戦わない')}`);
        enemies.push(partyLine('ronin', rel.ronin, '国境の村を荒らす'));
    }
    let crisis: string;
    let objective: string;
    if (!p) {
        crisis = '近江で、織田と浅井・朝倉が敵味方に分かれた。両家から、同じ日に使者が来ている。国境では浪人の一団が村を荒らしている。';
        objective = s.phase === 'council' ? '軍議で方針を選ぶ（選ぶまで何も決まらない）。' : '本多忠勝と話し、軍議で方針を選ぶ（織田・浅井・自領の防衛）。';
    } else if (s.phase === 'aftermath' || s.phase === 'ending') {
        const o = s.battle!;
        crisis = `国境の原の戦い：${IEYASU_RESULT_LABELS[o.result]}（${ieyasuReasonLabel(p, o.reason)}）。約束：${pledgeRecordText(s)}。`;
        objective = ieyasuObjective(s);
    } else {
        crisis = CH1_CRISIS[p];
        const pl = s.pledge;
        const pledge = !pl ? `${IEYASU_TALK_NAMES[PLEDGE_SPECS[p].giver]}の頼みに答える（引き受けるかは任意）。` : pl.accepted ? `約束：${PLEDGE_SPECS[p].targetName}の退路を守る（勝敗とは別）。` : '約束：引き受けていない（約束違反にはならない）。';
        objective = `${CH1_OBJECTIVE[p]}${pledge}`;
    }
    const view: SituationView = {
        title: '情勢（第一章）',
        when: WHEN,
        where: whereOf(IEYASU_PHASE_LABELS[s.phase]),
        allies,
        enemies,
        prev: null,
        crisis,
        objective,
        map: scene(sc.places, sc.routes, { heading: `${WHEN}・${HOME}`, highlight }),
        scouted: scoutEntries(s),
        replays: ieyasuReplays(s),
    };
    if (p) view.where = whereOf(IEYASU_PHASE_LABELS[s.phase], `（方針：${POLICY_LABELS[p]}）`);
    const hint = scoutHint(s);
    if (hint) view.scoutHint = hint;
    if (opts.from === 'council' && opts.options?.length) {
        const os = opts.options.map((o) => ch1Option(s, o.id, o.label)).filter((o): o is SituationOption => !!o);
        if (os.length) view.options = os;
    }
    return view;
}

// ================================================================ 第二章

const PLAN_OF_CHOICE: Readonly<Record<string, Ch2Plan>> = { plan_commit: 'commit', plan_hold: 'hold' };

function ch2Option(s: Ieyasu2State, id: string, label: string): SituationOption | null {
    let plan: Ch2Plan | undefined = PLAN_OF_CHOICE[id];
    let prefix = '';
    if (!plan && id === 'confirm_plan' && s.pendingPlan) {
        plan = s.pendingPlan;
        prefix = '決めると、主目標の条件が確定する。';
    }
    const site = CH2_SITE[s.policy];
    if (id === 'reconsider') return { id, label, highlight: [site], text: '判断を選び直す（まだ何も決まらない）。' };
    if (!plan || !availableCh2Plans(s).includes(plan)) return null;
    const info = ieyasu2BattleInfo(s, plan);
    const choice = planChoice(s, plan);
    const choiceId = plan === 'commit' ? 'plan_commit' : 'plan_hold';
    const scout = scoutCouncilLine(s, choiceId);
    // 判断 1 で守備隊が実際に出るときは、城が空く（城下を強調する）
    const hl: string[] = [site, `march.${site}`, ...(info.sortie.includes('reserve') ? ['home'] : []), ...scoutHighlight(s, choiceId)];
    return {
        id,
        label,
        highlight: hl,
        text: `${prefix}${CH2_PLAN_LABELS[s.policy][plan]}：${planPos(s.policy, plan, info.sortie)}。${choice.summary ?? ''}。主目標：${termsText(info)}。${scout ? ` ${scout}` : ''}`.replace(/。。/g, '。'),
    };
}

function ch2View(s: Ieyasu2State, opts: Opts): SituationView {
    const p = s.policy;
    const c = s.chapter1;
    const rel = relationsOf(p);
    const site = CH2_SITE[p];
    const r2 = s.battle?.result ?? null;
    const places: MapPlace[] = [homePlace(), ...partyPlaces(p), field1Place(c.battle.result), ch2SitePlace(p, r2)];
    const routes: MapRoute[] = [...relationRoutes(p)];
    if (s.phase === 'aftermath' || s.phase === 'ending') routes.push(returnRoute(site));
    else routes.push(threatRoute(p), marchRoute(site));
    const sc = withScout(places, routes, s);
    const allies: string[] = [];
    const enemies: string[] = [];
    const sup = s.result ? s.result.support : (safeInfo(s)?.support ?? null);
    const supText = sup && sup.length ? `${sup.map((x) => CH2_SUPPORT_NAMES[x]).join('・')}が加わる` : '';
    const cold = c.pledge.result === 'broken';
    if (p === 'oda') {
        allies.push(partyLine('oda', rel.oda, [`信頼 ${s.trust.oda}`, supText, cold || s.trust.oda < 0 ? '徳川をあまり頼みにしていない' : ''].filter(Boolean).join('・')));
        enemies.push(partyLine('asai', rel.asai, '追っ手'), partyLine('asakura', rel.asakura, '追っ手'));
    } else if (p === 'asai') {
        allies.push(partyLine('asai', rel.asai, [`史実から分かれた道・信頼 ${s.trust.asai}`, supText, cold || s.trust.asai < 0 ? '徳川をあまり頼みにしていない' : ''].filter(Boolean).join('・')));
        enemies.push(partyLine('oda', rel.oda, '丘を囲む織田方'));
    } else {
        if (c.battle.result === 'victory') allies.push('○ 村の衆（第一章で浪人を退けた。自ら加わる）');
        allies.push(`${partyLine('oda', rel.oda, '戦わない')}・${partyLine('asai', rel.asai, '戦わない')}`);
        enemies.push(partyLine('ronin', rel.ronin, '浪人衆'));
    }
    const cl = crisisLines(s);
    let crisis = cl.crisis;
    let objective: string;
    if (s.phase === 'aftermath' || s.phase === 'ending') {
        const o = s.battle!;
        const prim = s.result?.primary;
        crisis = `${CH2_MISSION_TITLES[p]}：${IEYASU_RESULT_LABELS[o.result]}（${ieyasu2ReasonLabel(p, o.reason)}）${prim ? `。主目標「${prim.label}」は${prim.achieved ? '果たした' : '果たせなかった'}` : ''}。`;
        objective = ieyasu2Objective(s);
    } else if (s.plan && s.terms) {
        // 判断を決めた後：確定した条件の主目標の文
        const info = safeInfo(s);
        objective = info ? `主目標（軍議で確定）：${termsText(info)}。` : `${cl.objective}`;
        if (!s.recovery) objective += '出陣の前に、石川数正と兵の補充を決める。';
    } else {
        objective = `${cl.objective}（軍議で判断を決めると、主目標の条件が確定する）`;
    }
    const thin = s.terms ? ch2ThinLine(s.terms) : null;
    if (thin && s.phase !== 'aftermath' && s.phase !== 'ending' && !objective.includes(thin.replace(/。$/, ''))) objective += thin;
    const highlight: string[] = s.phase === 'aftermath' || s.phase === 'ending' ? [site, `return.${site}`] : [site, `threat.${p}`];
    const view: SituationView = {
        title: '情勢（第二章）',
        when: `${WHEN}・第一章の戦から数日後`,
        where: whereOf(IEYASU2_PHASE_LABELS[s.phase], `（任務：${CH2_MISSION_TITLES[p]}）`),
        allies,
        enemies,
        prev: `第一章：${ch1SummaryText(c)}`,
        crisis,
        objective,
        map: scene(sc.places, sc.routes, { heading: `${WHEN}・第一章の戦から数日後`, highlight }),
        scouted: scoutEntries(s),
        replays: ieyasuReplays(s),
    };
    const hint = scoutHint(s);
    if (hint) view.scoutHint = hint;
    if (opts.from === 'council' && opts.options?.length) {
        const os = opts.options.map((o) => ch2Option(s, o.id, o.label)).filter((o): o is SituationOption => !!o);
        if (os.length) view.options = os;
    }
    return view;
}

/** 合戦の設定の見込み（判断が決まっていて、今の兵で作れるときだけ） */
function safeInfo(s: Ieyasu2State): ReturnType<typeof ieyasu2BattleInfo> | null {
    if (!s.plan) return null;
    try {
        return ieyasu2BattleInfo(s);
    } catch {
        return null;
    }
}

/** 情勢の画面の中身（状態を読むだけ。同じ状態・同じ開き方なら同じ中身） */
export function ieyasuSituation(s: IeyasuAnyState, opts: Opts): SituationView | null {
    return isChapter2(s) ? ch2View(s, opts) : ch1View(s, opts);
}

