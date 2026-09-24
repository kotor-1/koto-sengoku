/**
 * 会話データ。台詞は短く、状況（フラグ・模擬戦の記録）で内容が変わる。
 */
import { RETAINER_IDS, RETAINER_NAMES, type BattleRecord, type BattleResult } from './battle/model';
import type { Flags } from './state';

export interface DialogueLine {
    speaker: string;
    text: string;
}

/** 会話の最後に出す選択肢 */
export type ChoiceId = 'spar' | 'decline';

export interface DialogueChoice {
    id: ChoiceId;
    label: string;
}

export interface DialogueScript {
    id: string;
    lines: DialogueLine[];
    /** 会話を始めた時点で立てるフラグ */
    setFlags?: Partial<Flags>;
    /** 最後の行で出す選択肢（選ぶと会話が終わる） */
    choices?: DialogueChoice[];
    /** 最初に選ばれている選択肢の番号 */
    defaultChoice?: number;
    /** 会話を始めた時点で「模擬戦の結果を話した」ことにする */
    clearsDebrief?: boolean;
}

/** 模擬戦の誘い（家臣との会話の最後に出る） */
export const SPAR_CHOICES: readonly DialogueChoice[] = [
    { id: 'spar', label: '模擬戦をする' },
    { id: 'decline', label: '今はやめておく' },
];
/**
 * 最初は「今はやめておく」を選んでおく。
 * 会話を送るつもりで決定を連打しても、模擬戦が勝手に始まらない（始めるには選び直す）。
 */
const SPAR_DEFAULT = 1;

export type TalkTarget = 'retainer' | 'notice' | 'milestone' | 'well';

export const RETAINER_NAME = '源蔵';
export const HERO_NAME = '若殿';

const R = RETAINER_NAME;
const H = HERO_NAME;

export function scriptFor(target: TalkTarget, flags: Flags, battle: BattleRecord): DialogueScript {
    switch (target) {
        case 'retainer':
            return battle.debriefPending && battle.last ? debriefScript(battle.last) : withSparOffer(retainerScript(flags), battle);
        case 'notice':
            return {
                id: 'notice',
                lines: [
                    { speaker: '高札', text: '一、けんか口論、かたく禁ず。' },
                    { speaker: '高札', text: '一、押し買い・乱暴狼藉、禁ず。' },
                ],
            };
        case 'milestone':
            return {
                id: 'milestone',
                lines: [
                    { speaker: '道標', text: '「これより東、関所を経て隣国へ」と刻まれている。' },
                    { speaker: H, text: '（関所の先へは、今日は行けぬな。）' },
                ],
            };
        case 'well':
            return {
                id: 'well',
                lines: [{ speaker: '井戸', text: '冷たい水がたたえられている。町の者の大事な水場だ。' }],
            };
    }
}

function retainerScript(flags: Flags): DialogueScript {
    if (!flags.metRetainer) {
        return {
            id: 'retainer-first',
            setFlags: { metRetainer: true },
            lines: [
                { speaker: R, text: '若殿、お目覚めにございますか。' },
                { speaker: R, text: '本日は城下と街道の見回りをお願いしとうございます。' },
                { speaker: R, text: '城門を出て南が城下町、東の橋を渡れば街道にございます。' },
                { speaker: H, text: 'うむ。行ってまいる。' },
            ],
        };
    }
    if (!(flags.visitedTown && flags.visitedRoad)) {
        const rest = [!flags.visitedTown ? '城下町' : null, !flags.visitedRoad ? '街道' : null]
            .filter((v): v is string => v !== null)
            .join('と');
        return {
            id: 'retainer-remind',
            lines: [
                { speaker: R, text: `まだ${rest}の見回りがお済みでないようですな。` },
                { speaker: R, text: 'お気をつけて行ってらっしゃいませ。' },
            ],
        };
    }
    if (!flags.reported) {
        return {
            id: 'retainer-report',
            setFlags: { reported: true },
            lines: [
                { speaker: R, text: 'おお、お戻りになりましたか。' },
                { speaker: H, text: '城下も街道も、変わりはなかったぞ。' },
                { speaker: R, text: '何よりにございます。本日はゆるりとお休みくだされ。' },
            ],
        };
    }
    return {
        id: 'retainer-after',
        lines: [{ speaker: R, text: 'ご苦労さまにございました。いずれ隣国の噂もお聞かせいたしましょう。' }],
    };
}

/** 家臣との会話の最後に、模擬戦の誘いを付ける */
function withSparOffer(script: DialogueScript, battle: BattleRecord): DialogueScript {
    const played = battle.victories + battle.defeats + battle.retreats > 0;
    const text = played
        ? '模擬戦のお相手は、いつでもいたしますぞ。いかがなさいますか。'
        : '時に若殿、東の原に訓練場を設けてございます。新八と訓練の者を相手に、模擬戦をなさいますか。';
    return { ...script, lines: [...script.lines, { speaker: R, text }], choices: [...SPAR_CHOICES], defaultChoice: SPAR_DEFAULT };
}

/** 模擬戦から戻ったときの会話（結果・家臣の戦闘不能で変わる。最後にもう一度挑むか聞く） */
export function debriefScript(r: BattleResult): DialogueScript {
    const down = RETAINER_IDS.filter((id) => r.retainersDown[id]);
    const downLine = (): DialogueLine => {
        if (down.length === 2) return { speaker: R, text: 'それがしも新八も途中で打ち倒されましたが、手当てを受けてこのとおりにございます。' };
        if (down[0] === 'genzo') return { speaker: R, text: 'それがしは途中で一本取られましたが、手当てを受けてこのとおりにございます。' };
        if (down[0] === 'shinpachi') return { speaker: R, text: `${RETAINER_NAMES.shinpachi}は途中で倒れましたが、手当てを受けてもう起きております。` };
        return { speaker: R, text: `それがしも${RETAINER_NAMES.shinpachi}も、大きな怪我なく済みました。` };
    };
    const lines: DialogueLine[] = [];
    switch (r.outcome) {
        case 'victory':
            lines.push(
                { speaker: R, text: 'お見事にございました！ 訓練の者たち、みな参ったと申しております。' },
                downLine(),
            );
            break;
        case 'defeat':
            lines.push(
                { speaker: R, text: '若殿、お加減はいかがにございますか。' },
                { speaker: H, text: '……不覚を取った。' },
                { speaker: R, text: '模擬戦ゆえ、打ち身だけで済みました。ご安心くだされ。' },
                downLine(),
                { speaker: R, text: '囲まれる前に「指揮」で我らへ指図をくだされ。指揮の間は、戦いの時が止まりますぞ。' },
            );
            break;
        case 'retreat':
            lines.push(
                { speaker: R, text: '引き際を見極めるのも、将の務めにございます。' },
                downLine(),
            );
            break;
    }
    lines.push({ speaker: R, text: '皆の手当ては済んでおります。もう一度、模擬戦をなさいますか。' });
    return { id: `debrief-${r.outcome}`, lines, choices: [...SPAR_CHOICES], defaultChoice: SPAR_DEFAULT, clearsDebrief: true };
}

/** 画面上部に出す今の目的 */
export function objectiveText(flags: Flags, battle?: BattleRecord): string {
    if (battle?.debriefPending) return `${RETAINER_NAME}に模擬戦の結果を話そう`;
    if (!flags.metRetainer) return `城門の家臣・${RETAINER_NAME}に話しかけよう`;
    if (!(flags.visitedTown && flags.visitedRoad)) {
        const mark = (b: boolean) => (b ? '済' : '未');
        return `見回り　城下町：${mark(flags.visitedTown)}　街道：${mark(flags.visitedRoad)}`;
    }
    if (!flags.reported) return `${RETAINER_NAME}に報告しよう`;
    return '見回り完了。自由に歩いてみよう';
}
