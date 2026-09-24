/**
 * 会話データ。台詞は短く、状況（フラグ）で内容が変わる。
 */
import type { Flags } from './state';

export interface DialogueLine {
    speaker: string;
    text: string;
}

export interface DialogueScript {
    id: string;
    lines: DialogueLine[];
    /** 会話を始めた時点で立てるフラグ */
    setFlags?: Partial<Flags>;
}

export type TalkTarget = 'retainer' | 'notice' | 'milestone' | 'well';

export const RETAINER_NAME = '源蔵';
export const HERO_NAME = '若殿';

const R = RETAINER_NAME;
const H = HERO_NAME;

export function scriptFor(target: TalkTarget, flags: Flags): DialogueScript {
    switch (target) {
        case 'retainer':
            return retainerScript(flags);
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

/** 画面上部に出す今の目的 */
export function objectiveText(flags: Flags): string {
    if (!flags.metRetainer) return `城門の家臣・${RETAINER_NAME}に話しかけよう`;
    if (!(flags.visitedTown && flags.visitedRoad)) {
        const mark = (b: boolean) => (b ? '済' : '未');
        return `見回り　城下町：${mark(flags.visitedTown)}　街道：${mark(flags.visitedRoad)}`;
    }
    if (!flags.reported) return `${RETAINER_NAME}に報告しよう`;
    return '見回り完了。自由に歩いてみよう';
}
