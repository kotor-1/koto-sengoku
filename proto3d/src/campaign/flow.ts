/**
 * 第一章の進め方（純粋な関数。three も DOM も使わない）。仕様：docs/chapter1-spec.md §1・§3〜5。
 *
 * - 段階は explore → council → muster → battle → aftermath → ending の一方向にだけ進む。
 *   それ以外の進め方（段階を飛ばす・戻る・合戦の結果なしに戦後へ等）は FlowError を投げて受け付けない。
 * - どの関数も受け取った状態を書き換えず、新しい状態を返す。
 * - 画面（ui/）の使い方：
 *     talk(state, id) で台詞を得て表示 → 読み終えたら（選択肢があれば選ばせて）finishTalk(state, id, choiceId) で次の状態へ。
 *     軍議は id 'council'。選んだ後はもう一度 talk(state, 'council') で確認の台詞が出る。
 *     城門の「出陣する」で phase は battle になる → 保存（出陣前の自動保存）→ battleSetupFor(state) で合戦を始める
 *     → 合戦の結果を applyBattleOutcome(state, outcome) へ（phase は aftermath）→ 保存（戦後の自動保存）。
 *     戦後に源蔵の「この章を締めくくる」で phase は ending。結末の文章は story.ts の endingView(state)。
 */
import type { BattleEndReason, BattleMap, BattleOutcome, BattleResultKind, BattleSetup, TerrainArea, UnitStatus } from '../battle/types';
import { BORDER_FIELD, BORDER_FIELD_TIME_LIMIT, demoUnits } from '../battle/maps';
import {
    CHARACTER_IDS,
    EXPLORE_LIMIT,
    INITIAL_RELATIONS,
    INITIAL_TROOPS,
    TROOPS_MAX,
    clampRelation,
    cloneOutcome,
    cloneState,
    parseBattleOutcome,
    talkFlag,
    type CampaignPhase,
    type CampaignState,
    type CharacterId,
    type CharacterStatus,
    type ChoiceId,
    type EndingId,
    type ExplorePose,
    type KotosakaUnitId,
    type TalkId,
} from './state';
import { alliedUnitOf, alliedUnitSacrificed, briefingFor, scriptFor, type Script } from './story';

/** 進め方として受け付けない操作（画面の作りの誤り。普通の遊び方では起きない） */
export class FlowError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FlowError';
    }
}

/** 段階の次（これ以外へは進めない） */
const NEXT_PHASE: Readonly<Record<CampaignPhase, CampaignPhase | null>> = {
    explore: 'council',
    council: 'muster',
    muster: 'battle',
    battle: 'aftermath',
    aftermath: 'ending',
    ending: null,
};

export function newGame(): CampaignState {
    const characters = {} as Record<CharacterId, CharacterStatus>;
    for (const c of CHARACTER_IDS) characters[c] = 'alive';
    return {
        phase: 'explore',
        alliance: null,
        pendingAlliance: null,
        relations: { ...INITIAL_RELATIONS },
        troops: { ...INITIAL_TROOPS },
        characters,
        talked: {},
        battle: null,
        ending: null,
        explore: null,
        playTimeSec: 0,
        savedAt: null,
    };
}

/** 段階を 1 つ進める（決まった順だけ。前提が欠けていれば投げる） */
function advanceTo(state: CampaignState, to: CampaignPhase): CampaignState {
    if (NEXT_PHASE[state.phase] !== to) throw new FlowError(`${state.phase} から ${to} へは進めません`);
    const s = cloneState(state);
    s.phase = to;
    switch (to) {
        case 'muster':
        case 'battle':
            if (!s.alliance) throw new FlowError('協力陣営が決まっていません');
            if (s.battle) throw new FlowError('合戦の結果がすでにあります');
            s.pendingAlliance = null;
            break;
        case 'aftermath':
        case 'ending':
            if (!s.alliance || !s.battle) throw new FlowError('合戦の結果がありません');
            break;
        default:
            break;
    }
    return s;
}

// ================= 会話 =================

/** 今の段階で話しかけられる相手（探索の場面に置く人物・物。捕らわれた人物は居ない） */
export function presentTalks(state: CampaignState): TalkId[] {
    const a = state.alliance;
    const envoy: TalkId[] = a === 'tashiro' ? ['tashiro_envoy'] : a === 'omori' ? ['omori_envoy'] : [];
    let ids: TalkId[];
    switch (state.phase) {
        case 'explore':
            ids = ['genzo', 'shinpachi', 'notice'];
            break;
        case 'council':
            ids = ['council'];
            break;
        case 'muster':
            ids = ['genzo', 'shinpachi', ...envoy, 'notice', 'gate'];
            break;
        case 'aftermath':
            ids = ['genzo', 'shinpachi', ...envoy, 'notice'];
            break;
        default:
            ids = [];
    }
    return ids.filter((id) => !isCharacter(id) || state.characters[id] !== 'captured');
}

/** 探索の場面に置く人物（presentTalks のうち人物だけ） */
export function presentCharacters(state: CampaignState): CharacterId[] {
    return presentTalks(state).flatMap((id) => (isCharacter(id) ? [id] : []));
}

function isCharacter(id: string): id is CharacterId {
    return (CHARACTER_IDS as readonly string[]).includes(id);
}

export function canTalk(state: CampaignState, id: TalkId): boolean {
    return presentTalks(state).includes(id);
}

/** 話しかけたときの台詞（状態は変えない）。居ない相手なら投げる */
export function talk(state: CampaignState, id: TalkId): Script {
    if (!canTalk(state, id)) throw new FlowError(`今（${state.phase}）は ${id} と話せません`);
    return scriptFor(state, id);
}

/** その段階（省けば今の段階）で、その相手と話し終えたか */
export function hasTalked(state: CampaignState, id: TalkId, phase: CampaignPhase = state.phase): boolean {
    return state.talked[talkFlag(phase, id)] === true;
}

/** 出陣前に使者と話したときの関係の上がり幅 */
export const ENVOY_COURTESY = 5;

/**
 * 会話を読み終えた。済み印を立て、会話の効果（使者と話すと関係 +5。1 回だけ）と選択肢の結果を反映した新しい状態を返す。
 * 選択肢のある会話では choiceId が必須で、その会話の選択肢の中の物でなければ投げる。選択肢の無い会話で choiceId を渡しても投げる。
 */
export function finishTalk(state: CampaignState, id: TalkId, choiceId?: ChoiceId): CampaignState {
    const script = talk(state, id);
    if (script.choices) {
        if (!choiceId || !script.choices.some((c) => c.id === choiceId)) throw new FlowError(`この会話（${script.id}）の選択肢に ${String(choiceId)} はありません`);
    } else if (choiceId) {
        throw new FlowError(`この会話（${script.id}）に選択肢はありません`);
    }
    let s = cloneState(state);
    const first = !hasTalked(s, id);
    s.talked[talkFlag(s.phase, id)] = true;
    // 出陣前に使者と話す：礼を尽くしたので関係 +5（1 回だけ）
    if (first && s.phase === 'muster' && (id === 'tashiro_envoy' || id === 'omori_envoy')) {
        const clan = id === 'tashiro_envoy' ? 'tashiro' : 'omori';
        s.relations[clan] = clampRelation(s.relations[clan] + ENVOY_COURTESY);
    }
    if (choiceId) s = choose(s, choiceId);
    return s;
}

/** 今の段階で選べる選択肢 */
export function legalChoices(state: CampaignState): ChoiceId[] {
    switch (state.phase) {
        case 'explore':
            return ['open_council', 'not_yet'];
        case 'council':
            return state.pendingAlliance ? ['confirm_alliance', 'reconsider'] : ['ally_tashiro', 'ally_omori', 'ally_alone'];
        case 'muster':
            return ['depart', 'stay'];
        case 'aftermath':
            return ['end_chapter', 'not_yet'];
        default:
            return [];
    }
}

/** 選択肢を選ぶ（今の段階で選べない物なら投げる） */
export function choose(state: CampaignState, choiceId: ChoiceId): CampaignState {
    if (!legalChoices(state).includes(choiceId)) throw new FlowError(`今（${state.phase}）は ${choiceId} を選べません`);
    switch (choiceId) {
        case 'open_council':
            return advanceTo(state, 'council');
        case 'not_yet':
        case 'stay':
            return cloneState(state);
        case 'ally_tashiro':
        case 'ally_omori':
        case 'ally_alone': {
            const s = cloneState(state);
            s.pendingAlliance = choiceId === 'ally_tashiro' ? 'tashiro' : choiceId === 'ally_omori' ? 'omori' : 'alone';
            return s;
        }
        case 'confirm_alliance': {
            const s = cloneState(state);
            s.alliance = s.pendingAlliance;
            return advanceTo(s, 'muster');
        }
        case 'reconsider': {
            const s = cloneState(state);
            s.pendingAlliance = null;
            return s;
        }
        case 'depart':
            return departure(state);
        case 'end_chapter':
            return finishChapter(state);
    }
}

// ================= 出陣・合戦 =================

/** 出陣する（muster → battle）。この直後の状態を「出陣前の自動保存」として保存する */
export function departure(state: CampaignState): CampaignState {
    if (state.phase !== 'muster') throw new FlowError(`今（${state.phase}）は出陣できません`);
    return advanceTo(state, 'battle');
}

/**
 * 合戦の部隊の id（battle/maps.ts の標準の布陣 demoUnits と同じ）。
 * 4 部隊目：田代と組めば a_tashiro（味方）・e_omori（敵）、大森と組めば a_omori・e_tashiro、独力なら a_reserve・e_reserve。
 */
export const UNIT_IDS = {
    allyHonjin: 'a_hq',
    genzo: 'a_genzo',
    shinpachi: 'a_shinpachi',
    allyReserve: 'a_reserve',
    allyTashiro: 'a_tashiro',
    allyOmori: 'a_omori',
    enemyHonjin: 'e_hq',
    sente: 'e_sente',
    enemyYumi: 'e_yumi',
    enemyReserve: 'e_reserve',
    enemyOmori: 'e_omori',
    enemyTashiro: 'e_tashiro',
} as const;

/** 合戦の部隊 id → 琴坂家の部隊（兵を持ち越す単位） */
export const KOTOSAKA_UNIT_OF: Readonly<Record<string, KotosakaUnitId>> = {
    [UNIT_IDS.allyHonjin]: 'honjin',
    [UNIT_IDS.genzo]: 'genzo',
    [UNIT_IDS.shinpachi]: 'shinpachi',
    [UNIT_IDS.allyReserve]: 'reserve',
};
/** 合戦の部隊 id → 率いる人物（結果に leaderId が無いときの控え） */
const LEADER_OF: Readonly<Record<string, CharacterId>> = {
    [UNIT_IDS.allyHonjin]: 'hero',
    [UNIT_IDS.genzo]: 'genzo',
    [UNIT_IDS.shinpachi]: 'shinpachi',
    [UNIT_IDS.allyTashiro]: 'tashiro_envoy',
    [UNIT_IDS.allyOmori]: 'omori_envoy',
    [UNIT_IDS.enemyHonjin]: 'washio_gen',
};
/** 鷲尾に付いた国衆の部隊の表示名（どちらの側か分かるように） */
const TURNCOAT_NAMES: Readonly<Record<string, string>> = {
    [UNIT_IDS.enemyOmori]: '大森槍隊（鷲尾方）',
    [UNIT_IDS.enemyTashiro]: '田代騎馬隊（鷲尾方）',
};

function cloneMap(m: BattleMap): BattleMap {
    return {
        ...m,
        terrain: m.terrain.map((t) => {
            const c: TerrainArea = { kind: t.kind };
            if (t.rect) c.rect = { ...t.rect };
            if (t.circle) c.circle = { ...t.circle };
            if (t.height !== undefined) c.height = t.height;
            return c;
        }),
        exits: { ally: { ...m.exits.ally }, enemy: { ...m.exits.enemy } },
    };
}

/**
 * 合戦の設定を作る（phase が battle のときだけ）。戦場は「国境の原」（battle/maps.ts の BORDER_FIELD）。
 * 部隊は battle/maps.ts の標準の布陣（合戦の釣り合いを確かめてある）を元に、琴坂家の兵を今の troops に差し替える。
 * 協力陣営の選択で、4 部隊目の所属・味方か敵か・置き場所が変わる（仕様 §3）。
 * 琴坂家の兵が 0 の部隊は出さない（本陣だけは兵が尽きていても 1 は置く：本陣の無い合戦は作らない）。
 */
export function battleSetupFor(state: CampaignState): BattleSetup {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦を始められません`);
    const a = state.alliance;
    if (!a) throw new FlowError('協力陣営が決まっていません');
    const t = state.troops;
    const strength: Record<string, number> = {
        [UNIT_IDS.allyHonjin]: Math.max(1, t.honjin),
        [UNIT_IDS.genzo]: t.genzo,
        [UNIT_IDS.shinpachi]: t.shinpachi,
        [UNIT_IDS.allyReserve]: t.reserve,
    };
    const units = demoUnits(a, { strength })
        .filter((u) => !(u.clan === 'kotosaka' && u.side === 'ally' && u.strength <= 0))
        .map((u) => (TURNCOAT_NAMES[u.id] ? { ...u, name: TURNCOAT_NAMES[u.id]! } : u));
    return {
        map: cloneMap(BORDER_FIELD),
        units,
        timeLimitSec: BORDER_FIELD_TIME_LIMIT,
        briefing: briefingFor(a, BORDER_FIELD_TIME_LIMIT),
    };
}

/** 関係の変化（仕様 §5）：協力陣営は結果により、組まなかった陣営は -30、鷲尾は勝利で -10 */
export const RELATION_DELTA = {
    ally: { victory: 30, retreat: 5, defeat: -10 } as Record<BattleResultKind, number>,
    /** 協力陣営の兵を多く失わせた（全滅、または 6 割より多く失った）ときの追加 */
    sacrificed: -15,
    notChosen: -30,
    washio: { victory: -10, retreat: 0, defeat: 0 } as Record<BattleResultKind, number>,
};

const WORSE: Readonly<Record<CharacterStatus, number>> = { alive: 0, wounded: 1, captured: 2 };
function worse(a: CharacterStatus, b: CharacterStatus): CharacterStatus {
    return WORSE[b] > WORSE[a] ? b : a;
}
const broken = (s: UnitStatus) => s === 'routed' || s === 'destroyed';

/**
 * 合戦の結果を反映する（battle → aftermath）。
 * - 琴坂家の部隊の兵：生き残った兵を戻す（合戦に出なかった部隊はそのまま）。
 * - 人物：率いた部隊が敗走・全滅 → 負傷。敗北なら源蔵は殿で負傷。新八の部隊が全滅 → 捕らわれ。鷲尾本陣の敗走・全滅 → 鷲尾玄蕃が負傷。
 * - 関係：RELATION_DELTA。
 * 結果の形がおかしい・味方本陣の結果が無い・段階が違う、は投げる。
 */
export function applyBattleOutcome(state: CampaignState, outcome: BattleOutcome): CampaignState {
    if (state.phase !== 'battle') throw new FlowError(`今（${state.phase}）は合戦の結果を受け取れません`);
    const o = parseBattleOutcome(outcome);
    if (!o) throw new FlowError('合戦の結果の形が正しくありません');
    const hq = o.units.find((u) => u.id === UNIT_IDS.allyHonjin);
    if (!hq || hq.side !== 'ally' || hq.clan !== 'kotosaka') throw new FlowError('合戦の結果に若殿本陣がありません');
    const s = cloneState(state);
    const a = s.alliance!;
    s.battle = cloneOutcome(o);

    // 兵
    for (const u of o.units) {
        const k = KOTOSAKA_UNIT_OF[u.id];
        if (!k || u.side !== 'ally' || u.clan !== 'kotosaka') continue;
        s.troops[k] = Math.max(0, Math.min(TROOPS_MAX, Math.round(u.endStrength)));
    }

    // 人物
    for (const u of o.units) {
        const leader = (u.leaderId && isCharacter(u.leaderId) ? u.leaderId : undefined) ?? LEADER_OF[u.id];
        if (!leader) continue;
        if (u.side === 'ally' && broken(u.status)) s.characters[leader] = worse(s.characters[leader], 'wounded');
        if (u.side === 'enemy' && leader === 'washio_gen' && broken(u.status)) s.characters.washio_gen = worse(s.characters.washio_gen, 'wounded');
    }
    if (o.result === 'defeat') s.characters.genzo = worse(s.characters.genzo, 'wounded');
    const shin = o.units.find((u) => u.id === UNIT_IDS.shinpachi);
    if (shin && shin.status === 'destroyed') s.characters.shinpachi = 'captured';

    // 関係
    if (a !== 'alone') {
        const other = a === 'tashiro' ? 'omori' : 'tashiro';
        let d = RELATION_DELTA.ally[o.result];
        if (alliedUnitSacrificed(alliedUnitOf(s))) d += RELATION_DELTA.sacrificed;
        s.relations[a] = clampRelation(s.relations[a] + d);
        s.relations[other] = clampRelation(s.relations[other] + RELATION_DELTA.notChosen);
    }
    s.relations.washio = clampRelation(s.relations.washio + RELATION_DELTA.washio[o.result]);

    const next = advanceTo(s, 'aftermath');
    // 戦後は城下の最初の位置から
    next.explore = null;
    return next;
}

// ================= 結末 =================

/** 選択 × 結果（× 関係）で結末を決める（仕様 §5 の表） */
export function endingFor(state: CampaignState): EndingId {
    const a = state.alliance;
    const o = state.battle;
    if (!a || !o) throw new FlowError('合戦の結果がないので結末を決められません');
    switch (o.result) {
        case 'victory':
            return a === 'tashiro' ? 'tashiro_victory' : a === 'omori' ? 'omori_victory' : 'alone_victory';
        case 'retreat':
            return 'retreat';
        case 'defeat':
            return a !== 'alone' && state.relations[a] >= 0 ? 'defeat_sheltered' : 'defeat_alone';
    }
}

/** 章を締めくくる（aftermath → ending） */
export function finishChapter(state: CampaignState): CampaignState {
    if (state.phase !== 'aftermath') throw new FlowError(`今（${state.phase}）は章を締めくくれません`);
    const s = advanceTo(state, 'ending');
    s.ending = endingFor(s);
    return s;
}

// ================= 探索の位置・遊んだ時間・保存できるか =================

export function setExplorePose(state: CampaignState, pose: ExplorePose | null): CampaignState {
    if (pose && !(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.heading))) throw new FlowError('探索の位置が数ではありません');
    const s = cloneState(state);
    s.explore = pose
        ? {
              x: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.x)),
              z: Math.max(-EXPLORE_LIMIT, Math.min(EXPLORE_LIMIT, pose.z)),
              heading: Math.atan2(Math.sin(pose.heading), Math.cos(pose.heading)),
          }
        : null;
    return s;
}

/** 遊んだ時間を足す（負・数でない値は無視） */
export function addPlayTime(state: CampaignState, sec: number): CampaignState {
    const s = cloneState(state);
    if (Number.isFinite(sec) && sec > 0) s.playTimeSec = Math.min(PLAY_TIME_MAX, s.playTimeSec + sec);
    return s;
}
export const PLAY_TIME_MAX = 1e8;

/** メニューから手動で保存できる段階（探索中：出陣前・支度・戦後。合戦の途中は保存しない） */
export function canSaveManually(state: CampaignState): boolean {
    return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
}

// ================= 確認用 =================

/**
 * 確認用（テスト・?dev= の早送り）：合戦の設定から、指定した結果の BattleOutcome を作る。
 * 実際の合戦の計算（battle/sim.ts）の代わりにはならない。本番の画面の流れでは使わない。
 */
export function outcomeFromSetup(
    setup: BattleSetup,
    result: BattleResultKind,
    opts: {
        reason?: BattleEndReason;
        elapsedSec?: number;
        /** 部隊ごとの最後の兵・状態（省けば、兵は 2 割減・状態は結果に合わせる） */
        units?: Record<string, { end?: number; status?: UnitStatus }>;
    } = {},
): BattleOutcome {
    const reason: BattleEndReason = opts.reason ?? (result === 'victory' ? 'enemy_hq_routed' : result === 'defeat' ? 'ally_hq_routed' : 'ordered_retreat');
    const units = setup.units.map((u) => {
        const o = opts.units?.[u.id];
        let status: UnitStatus = 'ready';
        if (reason === 'enemy_hq_routed' && u.id === UNIT_IDS.enemyHonjin) status = 'routed';
        if (reason === 'ally_hq_routed' && u.id === UNIT_IDS.allyHonjin) status = 'routed';
        if (reason === 'ordered_retreat' && u.side === 'ally') status = 'withdrawn';
        status = o?.status ?? status;
        const end = Math.max(0, Math.min(u.strength, Math.round(o?.end ?? (status === 'destroyed' ? 0 : u.strength * 0.8))));
        const r: BattleOutcome['units'][number] = { id: u.id, side: u.side, clan: u.clan, startStrength: u.strength, endStrength: end, status };
        if (u.leaderId) r.leaderId = u.leaderId;
        return r;
    });
    return { result, reason, elapsedSec: opts.elapsedSec ?? 300, units };
}
