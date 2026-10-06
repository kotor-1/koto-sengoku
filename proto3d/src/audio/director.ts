/**
 * どの画面で、どの曲・環境音にするか（純粋。three も DOM も Web Audio も使わない）。
 *
 * - 城下（探索・会話・物見・戦後・結末）：城下町の曲。風と、荷の作業の音（荷置き場の近く）。
 * - 危機／軍議：軍議の画面・章の冒頭の急報（使者・使い・家臣の報告の場面）・情勢の図解。
 * - 合戦：合戦の画面（読み込みの待ちを含む）・出陣の演出（隊列が出る）。
 * - 帰還の演出：勝てば城下の曲、ほかは危機の曲（負けて戻る町を明るい曲で迎えない）。
 * - タイトル・演習の一覧：曲なし（風もなし）。
 * - 'keep'：前の曲のまま（メニュー・情勢の画面を開いた・演出の場面の間など、画面の行き来で曲を切り替えない）。
 */
import type { SongId } from './songs';

export type MusicChoice = SongId | null | 'keep';

export interface SceneChoice {
    music: MusicChoice;
    /** 風の大きさ（0 で止める） */
    wind: number;
    /** 町の環境音（荷の作業）を出すか */
    town: boolean;
}

/** 演出の今の場面（3D の出来事の id と、地図の場面か）。演出の外は null */
export interface CineBeatInfo {
    moment: string;
    kind: 'map' | 'stage';
    /** 3D の出来事の id（stage のとき） */
    event?: string;
    /** 帰還の隊列が勝って戻るか（column_return） */
    victory?: boolean;
}

/** 演出の場面の曲 */
export function cineMusic(b: CineBeatInfo): SceneChoice {
    if (b.kind === 'stage') {
        switch (b.event) {
            case 'town_life':
            case 'wounded_rest':
            case 'reinforcement_arrive':
                return { music: 'town', wind: 0.3, town: true };
            case 'envoys_arrive':
            case 'messenger_arrive':
            case 'retainer_report':
                return { music: 'crisis', wind: 0.3, town: true };
            case 'column_depart':
                return { music: 'battle', wind: 0.3, town: true };
            case 'column_return':
                return { music: b.victory ? 'town' : 'crisis', wind: 0.3, town: true };
            default:
                return { music: 'keep', wind: 0.3, town: true };
        }
    }
    // 地図の場面
    switch (b.moment) {
        case 'departure':
            return { music: 'battle', wind: 0, town: false };
        case 'return':
            return { music: 'keep', wind: 0, town: false };
        default:
            return { music: 'crisis', wind: 0, town: false };
    }
}

/** 木戸・城門を通る出来事（場面の頭でにきしみを鳴らす。返りは何秒後か。鳴らさなければ null） */
export function creakDelay(event: string | undefined): number | null {
    switch (event) {
        case 'envoys_arrive':
        case 'messenger_arrive':
        case 'reinforcement_arrive':
        case 'column_return':
            return 0.4;
        case 'column_depart':
            return 0.2;
        default:
            return null;
    }
}

export interface ScreenInput {
    /** 章の進行の画面（campaign/game.ts の GameScreen） */
    screen: string;
    /** 合戦の画面に入っている（app/modes.ts の activeModeName が 'battle'） */
    battle: boolean;
    /** 演出の今の場面（演出の外は null） */
    cine: CineBeatInfo | null;
}

/** 画面から曲と環境音を決める */
export function sceneFor(i: ScreenInput): SceneChoice {
    if (i.battle) return { music: 'battle', wind: 0.18, town: false };
    if (i.cine) return cineMusic(i.cine);
    switch (i.screen) {
        case 'boot':
        case 'title':
        case 'practice':
            return { music: null, wind: 0, town: false };
        case 'explore':
        case 'talk':
        case 'lookout':
            return { music: 'town', wind: 0.3, town: true };
        case 'council':
            return { music: 'crisis', wind: 0.15, town: false };
        case 'battle':
            return { music: 'battle', wind: 0.18, town: false };
        case 'ending':
        case 'record':
            return { music: 'town', wind: 0.15, town: false };
        default:
            // menu・situation・cinematic（場面の間）など：前のまま
            return { music: 'keep', wind: -1, town: false };
    }
}
