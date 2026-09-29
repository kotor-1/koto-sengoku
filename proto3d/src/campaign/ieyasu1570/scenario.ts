/**
 * 歴史分岐シナリオ「元亀元年・家康」を、シナリオの差し替え口（campaign/scenario.ts の Scenario）の形にしたもの。
 * 城下の配役（誰をどこに置くか）もここで決める。置き場所は架空の第一章と同じ場所（explore/cast.ts の SPOTS。通り道を塞がない）。
 * 人物の見た目は、既存の人物の見た目を暫定の素材として使う（美術の作り直しはしない）。
 */
import { GATE_REACH, SPOTS, TALK_REACH, headingToward, type CastMember, type Spot } from '../../explore/cast';
import { START, type Rect } from '../../layout';
import type { Scenario, StatusLine } from '../scenario';
import { formatSavedTime, signed } from '../scenario';
import type { CharacterId } from '../state';
import {
    addIeyasuPlayTime,
    applyIeyasuOutcomeOnce,
    canSaveIeyasuManually,
    canTalkIeyasu,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    newIeyasuGame,
    presentIeyasuTalks,
    setIeyasuExplorePose,
    talkIeyasu,
    withIeyasuBattleId,
} from './flow';
import { IeyasuSaveStore } from './save';
import { PLEDGE_SPECS, TOKUGAWA_UNIT_IDS, type IeyasuCharacterId, type IeyasuState, type IeyasuTalkId } from './state';
import {
    IEYASU_CHAPTER_TITLE,
    IEYASU_CHARACTER_NAMES,
    IEYASU_LABEL,
    IEYASU_NOTE,
    IEYASU_PHASE_LABELS,
    IEYASU_RESULT_LABELS,
    IEYASU_STATUS_LABELS,
    IEYASU_TALK_NAMES,
    POLICY_DONE_LABELS,
    SHOWN_TRUST_IDS,
    TOKUGAWA_UNIT_NAMES,
    TRUST_NAMES,
    ieyasuEndingView,
    ieyasuObjective,
    ieyasuPhaseIntro,
    ieyasuReasonLabel,
    pledgeRecordText,
    sideObjectiveRecordText,
    supportRecordText,
} from './story';
import type { StorageLike } from '../save';

// ================= 城下の配役 =================

/** 人物の見た目（既存の人物の見た目を暫定で使う。explore/world.ts の LOOKS の鍵） */
export const IEYASU_LOOKS: Readonly<Record<'tadakatsu' | 'oda_envoy' | 'asai_envoy', CharacterId>> = {
    tadakatsu: 'shinpachi',
    oda_envoy: 'tashiro_envoy',
    asai_envoy: 'omori_envoy',
};

const WEST = -Math.PI / 2;
const SOUTH = 0;
const rectAround = (x: number, z: number, hx: number, hz = hx): Rect => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });

/** 置き場所（架空の第一章と同じ場所を使う） */
function spotFor(phase: 'explore' | 'muster' | 'aftermath', id: IeyasuTalkId, sit: boolean): Spot | undefined {
    const S = SPOTS;
    switch (id) {
        case 'tadakatsu':
            // 探索：源蔵の場所。支度・戦後：支度の源蔵の場所（負傷なら床几）
            return phase === 'explore' ? S.explore.genzo : sit ? S.aftermath.genzo_sit : S[phase].genzo;
        case 'oda_envoy':
            // 探索：使者の場所（支度の使者と同じ所）。支度・戦後：使者の場所
            return S.muster.envoy;
        case 'asai_envoy':
            // 探索：織田の使者と離して、東の空き地（新八の場所）。支度・戦後：使者の場所
            return phase === 'explore' ? S.explore.shinpachi : S.muster.envoy;
        case 'notice':
            return S[phase].notice;
        case 'gate':
            return S.muster.gate;
        default:
            return undefined;
    }
}

/** 物語を進める相手（目印）：探索・戦後は忠勝、支度は約束の相手（答える前）か城門 */
export function ieyasuKeyTalk(state: IeyasuState): IeyasuTalkId | null {
    switch (state.phase) {
        case 'explore':
        case 'aftermath':
            return 'tadakatsu';
        case 'muster':
            return state.pledge || !state.policy ? 'gate' : PLEDGE_SPECS[state.policy].giver;
        default:
            return null;
    }
}

export function ieyasuCastFor(state: IeyasuState): CastMember<IeyasuTalkId>[] {
    const phase = state.phase;
    if (phase !== 'explore' && phase !== 'muster' && phase !== 'aftermath') return [];
    const key = ieyasuKeyTalk(state);
    const out: CastMember<IeyasuTalkId>[] = [];
    for (const id of presentIeyasuTalks(state)) {
        if (id === 'council') continue;
        if (id === 'gate') {
            const [x, z, h] = spotFor(phase, id, false)!;
            out.push({ id, kind: 'gate', x, z, heading: h ?? SOUTH, pose: 'stand', label: IEYASU_TALK_NAMES.gate, verb: '出陣', reach: GATE_REACH, key: key === id, solid: null });
            continue;
        }
        if (id === 'notice') {
            const [x, z, h] = spotFor(phase, id, false)!;
            const heading = h ?? WEST;
            const alongZ = Math.abs(Math.sin(heading)) > 0.5;
            out.push({ id, kind: 'notice', x, z, heading, pose: 'stand', label: IEYASU_TALK_NAMES.notice, verb: '読む', reach: TALK_REACH, key: key === id, solid: alongZ ? rectAround(x, z, 0.2, 0.8) : rectAround(x, z, 0.8, 0.2) });
            continue;
        }
        const sit = id === 'tadakatsu' && phase === 'aftermath' && state.characters.tadakatsu === 'wounded';
        const spot = spotFor(phase, id, sit);
        if (!spot) continue;
        const [x, z, h] = spot;
        out.push({
            id,
            kind: 'person',
            look: IEYASU_LOOKS[id],
            x,
            z,
            heading: h ?? headingToward(x, z, START.x, START.z),
            pose: sit ? 'sit' : 'stand',
            label: IEYASU_TALK_NAMES[id],
            verb: '話す',
            reach: TALK_REACH,
            key: key === id,
            solid: rectAround(x, z, sit ? 0.4 : 0.25),
        });
    }
    return out;
}

// ================= メニューの「状態」 =================

export function ieyasuStatusLines(s: IeyasuState, extraPlaySec = 0): StatusLine[] {
    const people: IeyasuCharacterId[] = ['ieyasu', 'tadakatsu'];
    if (s.policy === 'asai') people.push('nagamasa');
    const lines: StatusLine[] = [
        { label: '章', value: `${IEYASU_CHAPTER_TITLE}（${IEYASU_LABEL}）` },
        { label: '今', value: IEYASU_PHASE_LABELS[s.phase] },
        { label: '目的', value: ieyasuObjective(s) },
        { label: '方針', value: s.policy ? POLICY_DONE_LABELS[s.policy] : 'まだ決めていない' },
        { label: '信頼', value: SHOWN_TRUST_IDS.map((c) => `${TRUST_NAMES[c]} ${signed(s.trust[c])}`).join('・') },
        { label: '徳川の兵', value: TOKUGAWA_UNIT_IDS.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${s.troops[k]}`).join('・') },
        { label: '人物', value: people.map((c) => `${IEYASU_CHARACTER_NAMES[c]} ${IEYASU_STATUS_LABELS[s.characters[c]]}`).join('・') },
    ];
    if (s.policy) lines.push({ label: '約束', value: pledgeRecordText(s) });
    if (s.policy) lines.push({ label: '副目標', value: sideObjectiveRecordText(s) });
    if (s.battle && s.policy) lines.push({ label: '合戦', value: `${IEYASU_RESULT_LABELS[s.battle.result]}（${ieyasuReasonLabel(s.policy, s.battle.reason)}）` });
    if (s.support) lines.push({ label: '支援', value: supportRecordText(s) });
    const sec = Math.floor(s.playTimeSec + extraPlaySec);
    lines.push({ label: '最後の保存', value: formatSavedTime(s.savedAt) });
    lines.push({ label: '遊んだ時間', value: `${Math.floor(sec / 60)} 分` });
    return lines;
}

// ================= シナリオ =================

export function ieyasuScenario(storage: StorageLike | null, store: IeyasuSaveStore = new IeyasuSaveStore(storage)): Scenario<IeyasuState> {
    return {
        id: 'ieyasu1570',
        chapterTitle: IEYASU_CHAPTER_TITLE,
        label: IEYASU_LABEL,
        note: IEYASU_NOTE,
        store,
        battleIdPrefix: 'ieyasu1570',
        newGame: newIeyasuGame,
        cast: ieyasuCastFor,
        canTalk: canTalkIeyasu,
        talk: talkIeyasu,
        finishTalk: finishTalkIeyasu,
        isDeparture: (id, choice) => id === 'gate' && choice === 'depart',
        depart: (s, id, choice) => {
            if (id !== 'gate' || choice !== 'depart') throw new Error('出陣は城門の「出陣する」だけです');
            // 会話の済み印も立てる（架空の第一章の finishTalk と同じ）
            return finishTalkIeyasu(s, id, choice);
        },
        withBattleId: withIeyasuBattleId,
        battleSetup: ieyasuBattleSetup,
        applyOutcomeOnce: applyIeyasuOutcomeOnce,
        setExplorePose: setIeyasuExplorePose,
        addPlayTime: addIeyasuPlayTime,
        canSaveManually: canSaveIeyasuManually,
        phaseLabel: (p) => IEYASU_PHASE_LABELS[p],
        objective: ieyasuObjective,
        phaseIntro: ieyasuPhaseIntro,
        statusLines: ieyasuStatusLines,
        endingView: ieyasuEndingView,
    };
}
