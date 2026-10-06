/**
 * 物語の見せ方（演出・情勢の画面・町の人々・物見）の共通の約束（型だけ。three も DOM も使わない）。
 * 設計：docs/story-rpg-design.md。依頼本文：docs/story-rpg-request.md。
 *
 * - 演出・情勢・町の人々は、状態を読んで作る「データ」。再生・表示する側（ui・explore）は、このデータだけを見る。
 * - 地図は模式図（位置・道・距離は正確ではない）。座標は地図の上の点（0〜100 の正方形の中。x は東、y は南）。
 */

// ================================================================ 地図（模式図）

/** 関係（色だけでなく、記号と名前で区別する） */
export type MapSide = 'self' | 'ally' | 'enemy' | 'neutral' | 'unknown';

/** 場所 */
export interface MapPlace {
    id: string;
    /** 地図に出す名前（例：「徳川の城下」「近江」「国境の原」） */
    name: string;
    /** 地図の上の点（0〜100） */
    x: number;
    y: number;
    /** 種類（記号の形）：本拠・国（広い所）・合戦の場所・村・使いの来た方角など */
    kind: 'home' | 'region' | 'field' | 'village' | 'site';
    side: MapSide;
    /** 旗の一文字（例：徳・織・浅・朝・浪。無ければ省く） */
    mark?: string;
    /** 短い添え書き（例：「第一章：勝利」「孤立している」） */
    note?: string;
}

/** 進路・関係の線 */
export interface MapRoute {
    id: string;
    from: string;
    to: string;
    /** 種類：行軍（出陣）・撤収・脅かす向き（敵の動き。正確な位置ではない）・使い・協力・敵対 */
    kind: 'march' | 'withdraw' | 'threat' | 'envoy' | 'alliance' | 'hostile';
    side: MapSide;
    /** 曲げる点（省けばまっすぐ） */
    via?: { x: number; y: number }[];
    label?: string;
}

/** 地図の一場面（演出の地図の場面・情勢の画面で同じ形） */
export interface MapScene {
    places: MapPlace[];
    routes: MapRoute[];
    /** 強調する場所・線の id */
    highlight?: string[];
    /** 地図の上の見出し（いつ・どこ。例：「元亀元年（1570年）・徳川の城下」） */
    heading?: string;
    /** 模式図の注記（必ず出す） */
    note: string;
}

// ================================================================ 演出

/** 演出の時（どこで流すか） */
export type CineMoment = 'ch1_intro' | 'ch2_intro' | 'departure' | 'return';

/** 字幕 1 行 */
export interface CineCaption {
    /** 出す時刻・消す時刻（秒。演出の始めから） */
    start: number;
    end: number;
    /** 話し手の名前（地の文は省く） */
    speaker?: string;
    text: string;
}

/** 地図の場面：時刻ごとに、場所・線が現れる（appear 秒）。強調も時刻ごと */
export interface CineMapBeat {
    kind: 'map';
    start: number;
    end: number;
    scene: MapScene;
    /** 場所・線の id → 現れる時刻（秒。beat の始めから。省いた物は始めからある） */
    appear?: Record<string, number>;
    /** 強調の切り替え（beat の始めからの秒 → 強調する id） */
    highlights?: { at: number; ids: string[] }[];
}

/** 3D の場面（町の中の出来事）。中身は町の側（explore）が event の id と params で作る */
export interface CineStageBeat {
    kind: 'stage';
    start: number;
    end: number;
    event: StageEvent;
}

/**
 * 町の中の出来事（町の側が実装する）。人数は見た目だけ（保存の兵とは別）。
 * - envoys_arrive：使者が街道口から町へ入り、置き場所へ歩く（looks は人物の見た目の鍵。名前は字幕と名札で出す）
 * - messenger_arrive：使い（第二章の使者・村の使い）が着く
 * - wounded_rest：詰所で負傷兵が休む（count 人。見た目だけ）
 * - reinforcement_arrive：援兵が街道口から着く（count 人・旗の一文字 mark）
 * - column_depart：城内で隊列が整い、城門から町を通って街道口へ（count 人・旗 mark）
 * - column_return：街道口から隊列が戻る（count 人・負傷 wounded 人。victory なら旗を掲げる）
 */
export type StageEvent =
    /**
     * 町の様子（章の冒頭の最初の画。docs/v20-feedback-request.md【1】【2】）：街道口の木戸のあたりから北の城門へ向かう通りを見る。
     * 荷を運ぶ人・店の人・門番・（あれば）詰所の負傷兵・援兵が働いている。hero：主人公を入口の位置（town/spots.ts の ENTRY_POSE）に立たせて見せる
     */
    | { id: 'town_life'; hero: boolean }
    /** 使者が街道口から城門の前へ。showHero：主人公（入口に立つ）を画に入れる（冒頭）。省けば前どおり描かない */
    | { id: 'envoys_arrive'; envoys: { look: string; name: string }[]; showHero?: boolean }
    /**
     * 家臣が主人公のもとへ来て短く話す（冒頭の「主人公と家臣の短いやり取り」）。主人公（入口）と家臣の二人の画。
     * 字幕（話し手つき）は台本が出す。終わると家臣は自分の置き場所（城門の前）へ戻る（演出の外で、会話の相手の人物に替わる）
     */
    | { id: 'retainer_report'; look: string; name: string; castId: string }
    | { id: 'messenger_arrive'; look: string; name: string }
    | { id: 'wounded_rest'; count: number }
    | { id: 'reinforcement_arrive'; count: number; mark: string; name: string }
    | { id: 'column_depart'; count: number; mark: string }
    | { id: 'column_return'; count: number; wounded: number; mark: string; victory: boolean };

/** 演出の台本 */
export interface CineSpec {
    /** 確認用の名前（例：'ch2_intro.oda.victory.kept'） */
    id: string;
    moment: CineMoment;
    /** 演出の名前（見直しの一覧に出す） */
    title: string;
    /** 長さ（秒） */
    duration: number;
    beats: (CineMapBeat | CineStageBeat)[];
    captions: CineCaption[];
    /**
     * 伝える情報の札（いつ・どこ・協力・前の結果・危機・判断）。確かめで「全部出たか」を見る。
     * 値は出した時刻（秒）
     */
    info: Partial<Record<'when' | 'where' | 'ally' | 'prev' | 'crisis' | 'decide', number>>;
}

// ================================================================ 情勢の画面

/** 物見で記録した 1 件（地図の印と短い文。今の任務の戦場の地形から作る） */
export interface ScoutEntry {
    id: string;
    label: string;
    text: string;
    /** 地図に足す場所・線（省けば文だけ） */
    places?: MapPlace[];
    routes?: MapRoute[];
}

/** 軍議の選択肢と地図の対応（見るだけ。決めない） */
export interface SituationOption {
    /** 会話の選択肢の id（例：policy_oda・plan_commit） */
    id: string;
    label: string;
    /** 強調する場所・線の id */
    highlight: string[];
    /** その選択肢の短い説明（地図の下に出す） */
    text: string;
}

export interface SituationView {
    title: string;
    /** いつ・今いる所 */
    when: string;
    where: string;
    /** 協力している相手・敵対している相手（名前と記号） */
    allies: string[];
    enemies: string[];
    /** 前の章の選択と結果（第一章では null） */
    prev: string | null;
    /** 今の危機 */
    crisis: string;
    /** 今回の目的（主目標の基本の説明。物見をしなくても分かる） */
    objective: string;
    map: MapScene;
    /** 軍議の選択肢（軍議から開いたとき・方針を決める前） */
    options?: SituationOption[];
    /** 物見で記録したこと */
    scouted: ScoutEntry[];
    /** まだ物見をしていない所があるときの案内（任意であること） */
    scoutHint?: string;
    /** 見直せる演出（id と名前） */
    replays: { moment: CineMoment; title: string }[];
}

// ================================================================ 町の人々と物見

/** 町の人々（話しかけられない。見た目だけ。保存の兵とは別） */
export interface AmbientGroup {
    kind: 'wounded' | 'preparing' | 'reinforcement' | 'porter' | 'merchant' | 'guard';
    /** 人数（見た目だけ） */
    count: number;
    /** 旗の一文字（兵の群れ） */
    mark?: string;
    place: 'guardpost' | 'street' | 'gate' | 'castle' | 'highway';
}
export interface AmbientSpec {
    groups: AmbientGroup[];
}

/** 物見の地点（町の物見櫓）と、その方角の印 */
export interface ScoutPoint {
    id: string;
    /** 見る方角の印（地図の場所の id と、町から見た向き（ラジアン。0 が北、時計回り）・名前） */
    marks: { id: string; heading: number; label: string }[];
}
