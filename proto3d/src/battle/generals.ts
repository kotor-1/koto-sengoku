/**
 * 武将のデータ（データだけ。純粋な TypeScript。three も DOM も使わない）。
 * 設計：docs/battlefields-design.md §1。依頼本文：docs/battlefields-generals-request.md。史実と解釈の記録：docs/generals-history.md。
 *
 * - 1 部隊を 1 人の武将が率いる（部隊との結び付けは UnitDef の leaderId／generalId。ここは武将の側のデータだけ）。
 * - 固有能力（abilityId）は battle/abilities.ts の ABILITY_DATA を指す id。差し替えできるよう、ここでは id だけを持つ。
 *   酒井・石川・榊原の能力は差し替え前提の仮のデータ（数値は abilities.ts）。
 * - 主人公との関係状態は relationKey で、シナリオの状態（歴史分岐なら IeyasuState.trust）の鍵を指す。
 * - history は「資料で確かめたこと」「一般に知られる事柄（今回の資料では未確認）」「ゲーム用の解釈」を分けて持つ。
 *   確かめた資料は docs/historical-source-notes.md のメモだけ（ChatGPT が公式ページの本文を確認したもの。Claude は公式ページに到達できなかった）。
 *   役割・能力・AI の方針・台詞はすべてゲーム用の創作で、史実の人物の能力や発言ではない。
 */
import type { AbilityId, ClanId } from './types';

/** 部隊での役割 */
export type GeneralRole =
    | 'commander' // 総大将
    | 'vanguard' // 前線の主将
    | 'tactician' // 采配・軍議
    | 'reserve' // 後詰め
    | 'ally_lord'; // 同盟の大将

/** 敵方・同盟として動くときの考えの基本方針 */
export type GeneralAiPolicy = 'aggressive' | 'steady' | 'cautious' | 'support';

export type GeneralId = 'ieyasu' | 'tadakatsu' | 'nagamasa' | 'sakai' | 'ishikawa' | 'sakakibara';

/** 主人公本人の relationKey（関係状態を持たない） */
export const RELATION_SELF = 'self';

export interface GeneralHistory {
    /** 資料で確かめたこと（docs/historical-source-notes.md にある事柄だけ） */
    verified: string[];
    /** 一般に知られる事柄・伝承（今回の資料では確かめていない。事実として画面に出さない） */
    commonlyKnown: string[];
    /** ゲーム用の解釈（役割・能力・AI の方針・台詞は創作） */
    interpretation: string[];
    /** 出どころの注記 */
    sourceNote: string;
}

export interface GeneralDef {
    id: GeneralId;
    /** 表示名 */
    name: string;
    /** 所属（既定。シナリオの設定で上書きできる） */
    clan: ClanId;
    role: GeneralRole;
    /** 固有能力の id（battle/abilities.ts の ABILITY_DATA の鍵）。部隊に ability が無ければ、generalId からこの能力を使う */
    abilityId: AbilityId;
    aiPolicy: GeneralAiPolicy;
    /** 主人公との関係状態の鍵（歴史分岐では IeyasuState.trust の鍵。主人公本人は RELATION_SELF） */
    relationKey: string;
    history: GeneralHistory;
}

/** 役割の呼び方（説明・一覧に出す） */
export const GENERAL_ROLE_LABELS: Readonly<Record<GeneralRole, string>> = {
    commander: '総大将',
    vanguard: '前線の主将',
    tactician: '采配・軍議',
    reserve: '後詰め',
    ally_lord: '同盟の大将',
};

/** AI の基本方針の呼び方 */
export const GENERAL_AI_POLICY_LABELS: Readonly<Record<GeneralAiPolicy, string>> = {
    aggressive: '攻めかかる',
    steady: '持ち場を保つ',
    cautious: '慎重に守る',
    support: '味方を支える',
};

const NOTE_SOURCE = 'docs/historical-source-notes.md（ChatGPT が公式ページの本文を確認したメモ。Claude は公式ページに到達できず、本文を直接は確かめていない）';
const NOTE_NONE = '今回の資料メモ（docs/historical-source-notes.md）には記載がない。年代・所属・役割は確かめていない。';
const UNVERIFIED = '（通説・今回の資料では未確認）';

export const GENERALS: readonly GeneralDef[] = [
    {
        id: 'ieyasu',
        name: '徳川家康',
        clan: 'tokugawa',
        role: 'commander',
        abilityId: 'ieyasu_rally',
        aiPolicy: 'cautious',
        relationKey: RELATION_SELF,
        history: {
            verified: [
                '元亀元年（1570年）の姉川の戦いは、織田・徳川の側と浅井・朝倉の側の対戦として紹介されている（長浜城歴史博物館「姉川合戦図」の説明）。',
                '本多忠勝が家康の旗本として活動したと紹介されている（岡崎市観光協会）。',
            ],
            commonlyKnown: [`三河の大名${UNVERIFIED}。`, `のちに江戸幕府を開いた${UNVERIFIED}。`],
            interpretation: [
                '役割：総大将。家康本陣を率いる（歴史分岐の主人公）。',
                '固有能力「立て直しの号令」（ieyasu_rally）と数値はゲーム用の創作。',
                'AI の基本方針：慎重に守る（本陣を守る）。',
                '台詞・方針の分岐と、その後の出来事は創作。',
            ],
            sourceNote: NOTE_SOURCE,
        },
    },
    {
        id: 'tadakatsu',
        name: '本多忠勝',
        clan: 'tokugawa',
        role: 'vanguard',
        abilityId: 'tadakatsu_rearguard',
        aiPolicy: 'aggressive',
        relationKey: 'tadakatsu',
        history: {
            verified: ['1560年の初陣以降、家康の旗本として活動した（岡崎市観光協会「徳川十六将」内「本多忠勝」）。特定の合戦での配置や個別の行動までは、この記載では確定しない。'],
            commonlyKnown: [
                `「徳川四天王」の一人に数えられる${UNVERIFIED}。`,
                '生涯の多くの戦いで負傷しなかったという伝承が、岡崎市観光協会の記事で伝承として紹介されている（事実としては扱わない）。',
                '姉川での個別の働きとして語られる逸話は、今回の資料では裏付けを確かめていない（伝承）。',
            ],
            interpretation: [
                '役割：前線の主将。参謀としては扱わない。',
                '固有能力「退路の守護」（tadakatsu_rearguard）と数値はゲーム用の創作。無敵にはしない（忠勝隊が崩れると負傷する）。',
                'AI の基本方針：攻めかかる。',
                '台詞はすべて創作。',
            ],
            sourceNote: NOTE_SOURCE,
        },
    },
    {
        id: 'nagamasa',
        name: '浅井長政',
        clan: 'asai',
        role: 'ally_lord',
        abilityId: 'nagamasa_support',
        aiPolicy: 'steady',
        relationKey: 'asai',
        history: {
            verified: ['元亀元年（1570年）の姉川の戦いは、織田・徳川の側と浅井・朝倉の側の対戦として紹介されている（長浜城歴史博物館）。長政の名と地位は、この資料メモには書かれていない。'],
            commonlyKnown: [`近江の大名・浅井家の当主${UNVERIFIED}。`],
            interpretation: [
                '役割：同盟の大将。方針 B（浅井と組む。史実から分かれた道）では味方の同盟、方針 A では敵の本陣。',
                '固有能力「盟友への援護」（nagamasa_support）と数値はゲーム用の創作。',
                'AI の基本方針：持ち場を保つ。',
                '関係状態は浅井家への信頼（trust.asai）で持つ。書状・台詞は創作。',
            ],
            sourceNote: NOTE_SOURCE,
        },
    },
    {
        id: 'sakai',
        name: '酒井忠次',
        clan: 'tokugawa',
        role: 'tactician',
        abilityId: 'sakai_flank',
        aiPolicy: 'steady',
        relationKey: 'sakai',
        history: {
            verified: [],
            commonlyKnown: [`徳川家の重臣で、「徳川四天王」の一人に数えられる${UNVERIFIED}。`, `家康より年長の家臣とされる${UNVERIFIED}。`, `1570年の時点で徳川家に仕えていた${UNVERIFIED}。`],
            interpretation: [
                '役割：采配・軍議。歴史分岐の軍議で、方針ごとに戦の段取りの意見を述べる（台詞は創作）。',
                '仮の能力「両翼の采配」（sakai_flank）：差し替え前提の仮データ（数値は battle/abilities.ts）。',
                'AI の基本方針：持ち場を保つ。',
                '歴史分岐の章の合戦には部隊として出ない（Version 11 の釣り合いを守る）。',
            ],
            sourceNote: NOTE_NONE,
        },
    },
    {
        id: 'ishikawa',
        name: '石川数正',
        clan: 'tokugawa',
        role: 'reserve',
        abilityId: 'ishikawa_reserve',
        aiPolicy: 'support',
        relationKey: 'ishikawa',
        history: {
            verified: [],
            commonlyKnown: [`徳川家の重臣とされる${UNVERIFIED}。`, `のちに徳川家を離れ、豊臣秀吉に仕えたとされる${UNVERIFIED}。`, `1570年の時点で徳川家に仕えていた${UNVERIFIED}。`],
            interpretation: [
                '役割：後詰め。歴史分岐の軍議で、方針ごとに兵と退き口の備えの意見を述べる（台詞は創作）。',
                '仮の能力「後詰めの差配」（ishikawa_reserve）：差し替え前提の仮データ（数値は battle/abilities.ts）。',
                'AI の基本方針：味方を支える。',
                '歴史分岐の章の合戦には部隊として出ない（Version 11 の釣り合いを守る）。',
            ],
            sourceNote: NOTE_NONE,
        },
    },
    {
        id: 'sakakibara',
        name: '榊原康政',
        clan: 'tokugawa',
        role: 'vanguard',
        abilityId: 'sakakibara_vanguard',
        aiPolicy: 'aggressive',
        relationKey: 'sakakibara',
        history: {
            verified: [],
            commonlyKnown: [`徳川家の家臣で、「徳川四天王」の一人に数えられる${UNVERIFIED}。`, `家康より年少の家臣とされる${UNVERIFIED}。`],
            interpretation: [
                '役割：前線の主将。',
                '仮の能力「先駆けの号」（sakakibara_vanguard）：差し替え前提の仮データ（数値は battle/abilities.ts）。',
                'AI の基本方針：攻めかかる。',
                '歴史分岐の章には登場しない（関係状態の値だけを持つ）。',
            ],
            sourceNote: NOTE_NONE,
        },
    },
];

export const GENERAL_IDS: readonly GeneralId[] = GENERALS.map((g) => g.id);

const BY_ID: ReadonlyMap<string, GeneralDef> = new Map(GENERALS.map((g) => [g.id, g]));

/** id から武将を引く（知らない id は undefined） */
export function generalById(id: string): GeneralDef | undefined {
    return BY_ID.get(id);
}
