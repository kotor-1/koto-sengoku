/**
 * 架空の第一章「国境の砦」を、シナリオの差し替え口（scenario.ts の Scenario）の形にしたもの。
 * 中身は今までの flow.ts・story.ts・save.ts・explore/cast.ts をそのまま呼ぶだけ（動き・台詞・保存の形は変えない）。
 *
 * 仮シナリオ：人物・家・出来事はすべて架空の仮の設定（story.ts の先頭の注記）。
 */
import { castFor } from '../explore/cast';
import {
    addPlayTime,
    applyBattleOutcomeOnce,
    battleSetupFor,
    canSaveManually,
    canTalk,
    finishTalk,
    newGame,
    setExplorePose,
    talk,
    withBattleId,
} from './flow';
import { CampaignSaveStore, describeSave } from './save';
import type { Scenario, ScenarioStore, StatusLine } from './scenario';
import { formatSavedTime, signed } from './scenario';
import { KOTOSAKA_UNIT_IDS, type Alliance, type CampaignState, type ChoiceId, type TalkId } from './state';
import {
    ALLIANCE_DONE_LABELS,
    CHAPTER_TITLE,
    CHARACTER_NAMES,
    CLAN_NAMES,
    PHASE_LABELS,
    PROVISIONAL_LABEL,
    PROVISIONAL_NOTE,
    REASON_LABELS,
    RESULT_LABELS,
    STATUS_LABELS,
    TROOP_UNIT_NAMES,
    endingView,
    objectiveText,
    phaseIntro,
} from './story';

/** 架空の第一章の保存（CampaignSaveStore）を、差し替え口の保存の形で包む（キー 'koto-sengoku/3d-chapter1' のまま） */
function wrapStore(store: CampaignSaveStore): ScenarioStore<CampaignState> {
    return {
        get available() {
            return store.available;
        },
        save: (s, point, now) => store.save(s, point, now),
        load: () => {
            const r = store.load();
            return r.status === 'ok' ? { status: 'ok', state: r.state, summary: describeSave(r.data) } : r;
        },
        archivePrevious: () => store.archivePrevious(),
    };
}

export function fictionalScenario(store: CampaignSaveStore): Scenario<CampaignState> {
    return {
        id: 'fictional',
        chapterTitle: CHAPTER_TITLE,
        label: PROVISIONAL_LABEL,
        note: PROVISIONAL_NOTE,
        store: wrapStore(store),
        battleIdPrefix: 'ch1',
        newGame,
        cast: (s) => castFor(s),
        canTalk: (s, id) => canTalk(s, id as TalkId),
        talk: (s, id) => talk(s, id as TalkId),
        finishTalk: (s, id, choice) => finishTalk(s, id as TalkId, choice as ChoiceId | undefined),
        isDeparture: (id, choice) => id === 'gate' && choice === 'depart',
        depart: (s, id, choice) => finishTalk(s, id as TalkId, choice as ChoiceId),
        withBattleId,
        battleSetup: battleSetupFor,
        applyOutcomeOnce: applyBattleOutcomeOnce,
        setExplorePose,
        addPlayTime,
        canSaveManually,
        phaseLabel: (p) => PHASE_LABELS[p],
        objective: objectiveText,
        phaseIntro,
        statusLines,
        endingView,
    };
}

/** メニューの「状態」（段階・目的・協力陣営・関係・兵・人物・合戦・保存・遊んだ時間） */
export function statusLines(s: CampaignState, extraPlaySec = 0): StatusLine[] {
    const lines: StatusLine[] = [
        { label: '章', value: `${CHAPTER_TITLE}（${PROVISIONAL_LABEL}）` },
        { label: '今', value: PHASE_LABELS[s.phase] },
        { label: '目的', value: objectiveText(s) },
        { label: '協力陣営', value: s.alliance ? ALLIANCE_DONE_LABELS[s.alliance] : 'まだ決めていない' },
        { label: '関係', value: (['tashiro', 'omori', 'washio'] as const).map((c) => `${CLAN_NAMES[c]} ${signed(s.relations[c])}`).join('・') },
        { label: '琴坂の兵', value: KOTOSAKA_UNIT_IDS.map((k) => `${TROOP_UNIT_NAMES[k]} ${s.troops[k]}`).join('・') },
        { label: '人物', value: peopleOf(s.alliance).map((c) => `${CHARACTER_NAMES[c]} ${STATUS_LABELS[s.characters[c]]}`).join('・') },
    ];
    if (s.battle) lines.push({ label: '合戦', value: `${RESULT_LABELS[s.battle.result]}（${REASON_LABELS[s.battle.reason]}）` });
    const sec = Math.floor(s.playTimeSec + extraPlaySec);
    lines.push({ label: '最後の保存', value: formatSavedTime(s.savedAt) });
    lines.push({ label: '遊んだ時間', value: `${Math.floor(sec / 60)} 分` });
    return lines;
}

function peopleOf(a: Alliance | null): ('hero' | 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy')[] {
    const p: ('hero' | 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy')[] = ['hero', 'genzo', 'shinpachi'];
    if (a === 'tashiro') p.push('tashiro_envoy');
    if (a === 'omori') p.push('omori_envoy');
    return p;
}
