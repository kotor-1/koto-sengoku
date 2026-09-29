/**
 * 歴史分岐シナリオ「元亀元年・家康」の台詞・選択肢・結末の文章。
 *
 * ＊＊ 1570年の情勢を背景にした歴史分岐シナリオ（創作を含む） ＊＊
 * - 資料で確かめた開始の情勢（docs/ieyasu1570-history.md）：元亀元年（1570）に、織田・徳川の側と浅井・朝倉の側が戦った。
 *   本多忠勝は家康の家臣（旗本）。
 * - 会話と台詞はすべてゲーム用の創作（実在の人物の実際の発言・書状の引用ではない）。書状は趣旨を使者が伝える形にしている。
 * - 方針 B（浅井と組む）は史実から分かれた道。家康が史実で浅井側にいたとは書かない。
 * - 方針 C（自領の防衛）は、両家への宣戦ではない。選ばなかった家が必ず敵になる、という形にはしない。
 * - 戦場は「1570年の情勢を背景にした架空の局地戦」。姉川の戦いの再現とは書かない。
 * - 資料で確かめていないこと（同盟の成立年・縁戚・離反の経緯・忠勝の逸話）は、台詞で事実として述べない。
 * - 酒井忠次・石川数正は軍議で方針ごとに意見を述べる（台詞・役割は創作。年代・所属・役割は資料で確かめていない：docs/generals-history.md）。
 *
 * ここは文章を作るだけ（状態を書き換えない。three も DOM も使わない）。誰と話せるか・話した後にどう進むかは flow.ts。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind } from '../../battle/types';
import { IEYASU_PLEDGE_HOLD_SEC, IEYASU_PLEDGE_MIN_RATIO, IEYASU_UNIT_IDS } from '../../battle/maps';
import { RULES } from '../../battle/sim';
import { generalById, type GeneralId } from '../../battle/generals';
import type { ScenarioChoice, ScenarioLine, ScenarioScript } from '../scenario';
import {
    INITIAL_TRUST,
    PLEDGE_SPECS,
    TOKUGAWA_UNIT_IDS,
    type CarryFlag,
    ieyasuTalkFlag,
    type CampaignPhase,
    type IeyasuCharacterId,
    type IeyasuCharacterStatus,
    type IeyasuEndingId,
    type IeyasuState,
    type IeyasuTalkId,
    type PledgePartner,
    type PledgeResult,
    type Policy,
    type TokugawaUnitId,
    type TrustId,
} from './state';

// ---- 画面に常に出す注記 ----

export const IEYASU_CHAPTER_TITLE = '歴史分岐　元亀元年・家康';
export const IEYASU_LABEL = '歴史分岐・創作を含む';
export const IEYASU_NOTE =
    '1570年（元亀元年）の織田・浅井の対立を背景にした歴史分岐シナリオです。開始の年代と人物の所属は資料で確かめた範囲に合わせ、' +
    '会話・方針の分岐と、その後の出来事・戦場・兵数・特殊能力・約束・戦後は、ゲーム用の創作です。合戦は姉川の戦いの再現ではありません。';
/** 合戦の場の呼び方 */
export const IEYASU_FIELD_LABEL = '1570年の情勢を背景にした架空の局地戦';
export const IEYASU_END_LABEL = '元亀元年・家康 完（歴史分岐シナリオ。会話と分岐後の出来事は創作）';

// ---- 名前 ----

export const IEYASU_CHARACTER_NAMES: Readonly<Record<IeyasuCharacterId, string>> = {
    ieyasu: '家康',
    tadakatsu: '忠勝',
    nobunaga: '信長',
    nagamasa: '長政',
};
export const IEYASU_CHARACTER_FULL_NAMES: Readonly<Record<IeyasuCharacterId, string>> = {
    ieyasu: '徳川 家康（主人公）',
    tadakatsu: '本多 忠勝（徳川家の家臣）',
    nobunaga: '織田 信長（書状と使者で登場）',
    nagamasa: '浅井 長政（使者と書状で登場。方針によって戦場に出る）',
};
/** 城下に立つ人物・物の名前 */
export const IEYASU_TALK_NAMES: Readonly<Record<Exclude<IeyasuTalkId, 'council'>, string>> = {
    tadakatsu: '本多忠勝',
    oda_envoy: '織田家の使者',
    asai_envoy: '浅井家の使者',
    notice: '高札',
    gate: '城門（出陣）',
};
const generalName = (id: GeneralId) => generalById(id)!.name;
export const TRUST_NAMES: Readonly<Record<TrustId, string>> = {
    oda: '織田家',
    asai: '浅井家',
    tadakatsu: '本多忠勝',
    sakai: generalName('sakai'),
    ishikawa: generalName('ishikawa'),
    sakakibara: generalName('sakakibara'),
};
/** 画面（状態・結末の記録）に出す信頼の相手。榊原康政はこの章に登場しないので出さない（値は持ち越す） */
export const SHOWN_TRUST_IDS: readonly TrustId[] = ['oda', 'asai', 'tadakatsu', 'sakai', 'ishikawa'];
export const POLICY_LABELS: Readonly<Record<Policy, string>> = {
    oda: 'A. 織田との協力を続ける',
    asai: 'B. 浅井との協力を選ぶ（史実から分かれた道）',
    home: 'C. 自領の防衛を優先する',
};
/** 記録で使う（過去形） */
export const POLICY_DONE_LABELS: Readonly<Record<Policy, string>> = {
    oda: '織田との協力を続けた',
    asai: '浅井との協力を選んだ（史実から分かれた道）',
    home: '自領の防衛を優先した',
};
export const IEYASU_RESULT_LABELS: Readonly<Record<BattleResultKind, string>> = { victory: '勝利', defeat: '敗北', retreat: '撤退' };
export const PLEDGE_RESULT_LABELS: Readonly<Record<PledgeResult, string>> = { kept: '守った', broken: '守れなかった', declined: '引き受けなかった' };
export const IEYASU_STATUS_LABELS: Readonly<Record<IeyasuCharacterStatus, string>> = { alive: '無事', wounded: '負傷' };
export const TOKUGAWA_UNIT_NAMES: Readonly<Record<TokugawaUnitId, string>> = { honjin: '家康本陣', tadakatsu: '本多忠勝隊', yumi: '徳川弓隊', reserve: '岡崎の守備隊' };
export const IEYASU_PHASE_LABELS: Readonly<Record<CampaignPhase, string>> = {
    explore: '城下',
    council: '軍議',
    muster: '出陣の支度',
    battle: '出陣前',
    aftermath: '戦の後',
    ending: '章の結末',
};
/** 敵の本陣の名前（方針ごと） */
const ENEMY_HQ: Readonly<Record<Policy, string>> = { oda: '浅井長政隊', asai: '織田方の本陣', home: '浪人衆の本隊' };

export function ieyasuReasonLabel(policy: Policy, reason: BattleEndReason): string {
    switch (reason) {
        case 'enemy_hq_routed':
            return `${ENEMY_HQ[policy]}が敗走した`;
        case 'enemy_army_broken':
            return '敵の本陣以外の部隊がすべて戦えなくなった';
        case 'ally_hq_routed':
            return '家康本陣が敗走した（家康は落ち延びた）';
        case 'ally_army_broken':
            return '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった';
        case 'ordered_retreat':
            return '撤退を命じ、兵をまとめて退いた';
        case 'nightfall':
            return '日没で両軍が兵を引いた';
        default:
            // この章の合戦は主目標を持たない（今の勝ち負けの決まりのまま）。目標で決着する理由が増えても文が空にならないように
            return '合戦の目標の判定で決着した';
    }
}

// ---- 行を作る小道具 ----

type Speaker = 'hero' | 'tadakatsu' | 'sakai' | 'ishikawa' | 'oda_envoy' | 'asai_envoy';
const SPEAKER_NAMES: Record<Speaker, string> = {
    hero: '家康',
    tadakatsu: '忠勝',
    sakai: generalName('sakai'),
    ishikawa: generalName('ishikawa'),
    oda_envoy: '織田家の使者',
    asai_envoy: '浅井家の使者',
};
const say = (speaker: Speaker, text: string): ScenarioLine => ({ speaker, name: SPEAKER_NAMES[speaker], text });
const narrate = (text: string): ScenarioLine => ({ speaker: 'narration', name: '', text });
const notice = (text: string): ScenarioLine => ({ speaker: 'notice', name: '高札', text });
const H = (t: string) => say('hero', t);
const T = (t: string) => say('tadakatsu', t);
const SK = (t: string) => say('sakai', t);
const IK = (t: string) => say('ishikawa', t);
const OE = (t: string) => say('oda_envoy', t);
const AE = (t: string) => say('asai_envoy', t);

const talked = (s: IeyasuState, id: IeyasuTalkId, phase: CampaignPhase = s.phase) => s.talked[ieyasuTalkFlag(phase, id)] === true;

/** 約束の達成の条件（出陣の前の会話・確認に出す） */
export function pledgeConditionText(policy: Policy): string {
    const t = PLEDGE_SPECS[policy].targetName;
    return (
        `対象：${t}。達成：${t}が南の「味方の陣」（家康本陣の後ろ）に ${IEYASU_PLEDGE_HOLD_SEC} 秒以上とどまる、撤退の命令で退き口から離れる、` +
        `または合戦の終わりに戦えている — そのうえで兵が最初の ${Math.round(IEYASU_PLEDGE_MIN_RATIO * 100)}% 以上残っていること。` +
        `${t}が敗走・全滅すると守れない。敵と斬り合う前に（${t}が斬り合うか、味方が合わせて ${RULES.pledgeContestMeleeSec} 秒斬り結ぶ前に）撤退で終えると、守ったことにならない。勝敗とは別に判定する。`
    );
}

/**
 * 約束を「守れなかった」のうち、対象は無事だったが、敵と斬り合う前に撤退・敗北で終えたもの（約束の場面を果たしていない）。
 * 合戦の結果（対象の状態と兵）から判じる（保存に新しい項目を足さない）。
 */
export function pledgeUnfought(state: IeyasuState, o: BattleOutcome | null = state.battle): boolean {
    const pl = state.pledge;
    if (!pl || pl.result !== 'broken' || !o) return false;
    const u = o.units.find((x) => x.id === pl.targetId);
    if (!u || u.status === 'routed' || u.status === 'destroyed') return false;
    return u.startStrength > 0 && u.endStrength >= u.startStrength * IEYASU_PLEDGE_MIN_RATIO - 1e-9;
}

/** 援兵の出どころの呼び方（C は忠勝の約束に応えた岡崎の守備隊） */
export function supportSourceName(from: PledgePartner): string {
    return from === 'tadakatsu' ? '岡崎の守備隊（忠勝の約束）' : TRUST_NAMES[from];
}

/** 今の段階の、その相手の台詞。居るかどうかの検査は flow.ts（talk）が先に行う */
export function ieyasuScriptFor(state: IeyasuState, id: IeyasuTalkId): ScenarioScript {
    switch (state.phase) {
        case 'explore':
            return exploreScript(state, id);
        case 'council':
            return councilScript(state);
        case 'muster':
            return musterScript(state, id);
        case 'aftermath':
            return aftermathScript(state, id);
        default:
            throw new Error(`この段階（${state.phase}）に会話はありません`);
    }
}

// ================= 探索（出陣の前） =================

function exploreScript(state: IeyasuState, id: IeyasuTalkId): ScenarioScript {
    const again = talked(state, id);
    switch (id) {
        case 'tadakatsu': {
            const choices: ScenarioChoice[] = [
                { id: 'open_council', label: '軍議を開く', detail: '方針（織田・浅井・自領の防衛）を決める軍議へ進みます' },
                { id: 'not_yet', label: 'もう少し話を聞いて回る' },
            ];
            if (again) return { id: 'explore.tadakatsu.again', talk: id, lines: [T('皆、広間に控えております。軍議を開かれますか。')], choices, defaultChoice: 0 };
            const lines: ScenarioLine[] = [
                narrate('元亀元年（1570年）。織田と浅井・朝倉が敵味方に分かれ、近江の情勢が張りつめている。（この章の会話と、この先の出来事はゲーム用の創作）'),
                T('殿、お戻りなさいませ。'),
                T('織田家から使者が参っております。浅井家からも、別の使者が。'),
                H('両家から、同じ日にか。'),
                T('はい。どちらも殿のお考えを聞きたいと申しております。'),
                T('話を聞かれてから、軍議を開きましょう。拙者はここでお待ちします。'),
            ];
            if (talked(state, 'oda_envoy') && talked(state, 'asai_envoy')) lines.splice(3, 3, T('両家の使者の話は、もうお聞きになりましたな。'), T('軍議を開きましょう。'));
            return { id: 'explore.tadakatsu', talk: id, lines, choices, defaultChoice: 0 };
        }
        case 'oda_envoy':
            if (again) return { id: 'explore.oda_envoy.again', talk: id, lines: [OE('主は、徳川殿の兵をあてにしております。よきご返事を。')] };
            return {
                id: 'explore.oda_envoy',
                talk: id,
                lines: [
                    OE('織田家の使いにございます。主・信長の書状をお持ちしました。'),
                    narrate('（書状の趣旨を使者が伝える。文面はゲーム用の創作で、実際の書状の引用ではない）'),
                    OE('浅井・朝倉の勢が兵を集めております。徳川殿にも兵を出していただきたい、とのことです。'),
                    H('織田殿とは、これまで共に動いてきた。……よく考えて返事をしよう。'),
                ],
            };
        case 'asai_envoy':
            if (again) return { id: 'explore.asai_envoy.again', talk: id, lines: [AE('主は、徳川殿のご返事をお待ちしております。')] };
            return {
                id: 'explore.asai_envoy',
                talk: id,
                lines: [
                    AE('浅井家の使いにございます。人目を避けて参りました。'),
                    AE('主・長政の書状です。織田と浅井は、いま敵味方に分かれております。'),
                    narrate('（書状の趣旨を使者が伝える。文面はゲーム用の創作で、実際の書状の引用ではない）'),
                    AE('徳川殿が浅井と手を結んでくださるなら、主は心強い、と。'),
                    H('思いもよらぬ話だ。軽くは答えられぬ。'),
                ],
            };
        case 'notice':
            return {
                id: 'explore.notice',
                talk: id,
                lines: [
                    notice('一、近江にて戦の噂あり。町の者は騒がず家業に励むべし。'),
                    notice('一、国境の村々を荒らす浪人の一団あり。見かけた者は城へ知らせよ。'),
                    narrate(`（${IEYASU_NOTE}）`),
                ],
            };
        default:
            throw new Error(`探索に ${id} は居ません`);
    }
}

// ================= 軍議 =================

const POLICY_CHOICES: ScenarioChoice[] = [
    {
        id: 'policy_oda',
        label: POLICY_LABELS.oda,
        detail: '味方に織田援軍（前に突出して孤立しやすい）。敵は浅井長政隊（敵の本陣）・浅井先手・浅井弓隊・朝倉勢。浅井・朝倉の攻勢を退ける。戦後、織田の信頼は結果しだい。浅井とは敵味方のまま。',
        summary: '味方に織田援軍／敵は浅井・朝倉（長政隊が敵の本陣）',
    },
    {
        id: 'policy_asai',
        label: POLICY_LABELS.asai,
        detail: '史実から分かれた道（ゲームの創作）。味方に浅井長政隊（同盟。指揮でき「盟友への援護」を使える）。敵は織田方の一隊（信長本人は出ない）。浅井の退き口を守り、織田の追撃を止める。戦後、織田の信頼は大きく下がる。',
        summary: '史実から分岐：味方に浅井長政隊／敵は織田方の一隊',
    },
    {
        id: 'policy_home',
        label: POLICY_LABELS.home,
        detail: '両家への宣戦ではない。どちらにも兵を出さず、国境の村を荒らす浪人衆（架空の一団）を退ける。味方に岡崎の守備隊（国境の砦に孤立）。戦後、織田は兵を出さなかったことに不満を持つ。浅井との関係は変わらない。',
        summary: '両家とは戦わない：敵は浪人衆／味方に岡崎の守備隊',
    },
];
const POLICY_CHOICE_OF: Readonly<Record<Policy, string>> = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' };
export { POLICY_CHOICE_OF };

/**
 * 方針を選んだ後の確かめの台詞。忠勝が方針をまとめ、酒井忠次（采配）と石川数正（後詰め・兵の備え）が意見を述べる（台詞は創作）。
 * 酒井の意見は、その方針の戦場で効く采配の目安（先に当たる相手・退かせ方）に合わせてある。
 */
const COUNCIL_CONFIRM_LINES: Readonly<Record<Policy, readonly ScenarioLine[]>> = {
    oda: [
        T('織田との協力を続ける。浅井・朝倉の勢と向き合うことになります。'),
        T('織田の援軍は前に出たがります。崩れたときの退き場を、考えておかねばなりませぬ。'),
        SK('浅井は丘に構え、朝倉は東から回り込んでまいりましょう。先に朝倉を叩き、丘の敵が下りてくるのを待つのが上策にござる。'),
        IK('岡崎の守備隊は城に残しましょう。国の守りを空にはできませぬ。援軍の退き口は、先に決めておくべきかと。'),
        T('皆の考えは出揃いました。この道で、よろしいか。'),
    ],
    asai: [
        T('浅井と組む。……これまでの道から、大きく外れることになります。'),
        T('織田方の一隊が、浅井の兵を追ってくるでしょう。織田との間には、深い溝が残ります。'),
        SK('織田方の追い足は速うござる。長政殿の隊を退かせるなら、忠勝の隊を間に入れて盾とするのがよい。'),
        IK('一度手を切れば、元へは戻せませぬ。浅井の兵を退かせる道だけは、先に確かめておきましょう。'),
        T('皆の考えは出揃いました。この道で、よろしいか。'),
    ],
    home: [
        T('どちらにも兵を出さず、国を守る。両家に刃を向けるわけではございませぬ。'),
        T('ただ、織田は快く思いますまい。国境の浪人どもを追い払い、守備隊を無事に戻しましょう。'),
        SK('浪人どもは、まず騎馬が林から出てきましょう。騎馬を先に止めれば、残りはまとまりを欠きまする。'),
        IK('兵を損なわぬ道にございます。両家への申し開きは、戦の後に拙者が文を整えまする。'),
        T('皆の考えは出揃いました。この道で、よろしいか。'),
    ],
};

function councilScript(state: IeyasuState): ScenarioScript {
    const p = state.pendingPolicy;
    if (p) {
        return {
            id: `council.confirm.${p}`,
            talk: 'council',
            lines: [...COUNCIL_CONFIRM_LINES[p]],
            choices: [
                { id: 'confirm_policy', label: 'それで決める', detail: '決めた後は変えられません' },
                { id: 'reconsider', label: '考え直す' },
            ],
            defaultChoice: 0,
        };
    }
    if (talked(state, 'council')) {
        return { id: 'council.again', talk: 'council', lines: [T('改めて、いずれの道を取られますか。')], choices: POLICY_CHOICES, defaultChoice: 0 };
    }
    const lines: ScenarioLine[] = [
        narrate('城の広間に、主だった者が集まった。酒井忠次・石川数正の顔も見える。（ここからの話し合いと選択は、ゲーム用の創作）'),
        T('では、軍議を始めます。'),
        T('道は三つと存じます。'),
        T('一つ。織田との協力を続け、浅井・朝倉の勢と戦う。'),
        T('二つ。浅井と手を結ぶ。これまでの道を変える、大きな賭けです。'),
        T('三つ。どちらにも兵を出さず、国の守りを固める。国境には、浪人どもが村を荒らしております。'),
    ];
    if (talked(state, 'oda_envoy', 'explore')) lines.push(H('織田の使者は、兵を出してほしいと言っていた。'));
    if (talked(state, 'asai_envoy', 'explore')) lines.push(H('浅井の使者は、手を結びたいと。'));
    lines.push(
        SK('いずれの道を取られても、戦の段取りは拙者が組みまする。'),
        IK('兵の備えも、道によって変わりまする。お決めになる前に、申し上げましょう。'),
        T('いずれを選んでも、一度の戦で家が決まるわけではございませぬ。殿、いかがなさいます。'),
    );
    return { id: 'council', talk: 'council', lines, choices: POLICY_CHOICES, defaultChoice: 0 };
}

// ================= 出陣の支度 =================

const PLEDGE_CHOICES = (policy: Policy): ScenarioChoice[] => [
    {
        id: 'pledge_accept',
        label: '引き受ける',
        detail: `${pledgeConditionText(policy)} 守れば${partnerName(policy)}の信頼 +25 と援兵（徳川の兵 +150）。守れなければ信頼 −25。`,
        summary: `${PLEDGE_SPECS[policy].targetName}の退路を守る（守れば援兵）`,
    },
    { id: 'pledge_decline', label: '引き受けない', detail: '信頼は変わらず、援兵もない。約束違反にはならない。', summary: '約束なし（信頼は変わらない）' },
    { id: 'pledge_later', label: '少し考える', detail: '出陣の前に、もう一度話しかけて答える', summary: 'あとで答える' },
];

function partnerName(policy: Policy): string {
    return TRUST_NAMES[PLEDGE_SPECS[policy].partner];
}

/** 約束の会話（支度の段階で、約束の相手と話したとき。まだ答えていなければ選択肢） */
function pledgeScript(state: IeyasuState, policy: Policy): ScenarioScript {
    const spec = PLEDGE_SPECS[policy];
    const id = spec.giver;
    const pl = state.pledge;
    const S = policy === 'oda' ? OE : policy === 'asai' ? AE : T;
    if (pl) {
        const lines = pl.accepted
            ? [S(policy === 'home' ? '守備隊のこと、よろしくお頼み申します。' : `${spec.targetName}の退路、よろしくお頼みします。`), narrate(`（約束：${pledgeConditionText(policy)}）`)]
            : [S(policy === 'home' ? '承知しました。守備隊には、自分の足で退けと伝えておきます。' : '承知しました。こちらで何とかいたします。')];
        return { id: `muster.${id}.pledge.${pl.accepted ? 'accepted' : 'declined'}`, talk: id, lines };
    }
    const intro: Record<Policy, ScenarioLine[]> = {
        oda: [
            OE('徳川殿、一つお頼みがございます。'),
            OE('織田援軍は、右の前へ出て敵の横を突く手はずです。ただ、崩れれば退き場がない。'),
            OE('そのときは、援軍の退路を守っていただけませぬか。'),
        ],
        asai: [
            AE('徳川殿、主からの頼みがございます。'),
            AE('主の隊は左の前へ出て、織田の追撃を受け止めるつもりです。'),
            AE('退くときの退き口を、徳川殿に守っていただきたいのです。'),
        ],
        home: [
            T('殿、国境の砦の守備隊が、浪人どもに囲まれかけております。'),
            T('拙者の隊で道を開きます。守備隊を必ず退かせると、約束していただけませぬか。'),
        ],
    };
    return {
        id: `muster.${id}.pledge`,
        talk: id,
        lines: [...intro[policy], narrate(`（約束の中身：${pledgeConditionText(policy)}）`), narrate('（この約束と、その後の出来事はゲーム用の創作）')],
        choices: PLEDGE_CHOICES(policy),
        defaultChoice: 2,
    };
}

function musterScript(state: IeyasuState, id: IeyasuTalkId): ScenarioScript {
    const policy = state.policy;
    if (!policy) throw new Error('方針が決まっていません');
    const spec = PLEDGE_SPECS[policy];
    const again = talked(state, id);
    // 約束の相手：まだ答えていなければ約束の会話。使者は答えた後も約束の念押し（忠勝は答えた後は下の段取りの話）
    if (id === spec.giver && (state.pledge === null || id !== 'tadakatsu')) return pledgeScript(state, policy);
    switch (id) {
        case 'gate': {
            if (!state.pledge) {
                return {
                    id: 'muster.gate.pledge_pending',
                    talk: id,
                    lines: [narrate('城門の外に、兵が揃っている。'), H(`（出陣の前に、${IEYASU_TALK_NAMES[spec.giver]}の頼みに答えておこう。）`)],
                };
            }
            const pl = state.pledge;
            return {
                id: 'muster.gate',
                talk: id,
                lines: [
                    narrate('城門の外に、兵が揃っている。'),
                    narrate(`（方針：${POLICY_LABELS[policy]}。約束：${pl.accepted ? `引き受けた — ${spec.targetName}の退路を守る` : '引き受けていない'}）`),
                    H(`（ここを出れば、${IEYASU_FIELD_LABEL}だ。）`),
                ],
                choices: [
                    { id: 'depart', label: '出陣する', detail: '出陣の前に自動で保存します' },
                    { id: 'stay', label: 'まだ支度をする' },
                ],
                defaultChoice: 1,
            };
        }
        case 'tadakatsu': {
            const plan: Record<Policy, ScenarioLine[]> = {
                oda: [
                    T('拙者の隊で正面を支えます。丘の上の敵に、下から無理に当たらぬことです。'),
                    T('織田援軍が崩れかけたら、拙者が踏みとどまって退く兵を守ります。そのときは、お声がけを。'),
                ],
                asai: [
                    T('浅井長政隊は左の前。西の林から織田の騎馬が来ましょう。'),
                    T('長政殿の隊の近くにいる味方は、支えを受けられるそうです。離れすぎぬよう、並べて置くのが肝要かと。'),
                ],
                home: [
                    T('守備隊は左前の砦。浪人の弓がそこへ届きます。'),
                    T('守備隊を南の味方の陣まで退かせる間、拙者が踏みとどまって追っ手を止めます。'),
                ],
            };
            const lines = again && policy !== 'home' ? [plan[policy][0]!] : [...plan[policy], T('支度ができたら、城門へ。')];
            return { id: `muster.tadakatsu.${policy}`, talk: id, lines };
        }
        case 'oda_envoy':
        case 'asai_envoy':
            // 約束の相手でない使者は、この段階には居ない（flow.ts の presentTalks）
            throw new Error(`出陣の支度に ${id} は居ません`);
        case 'notice':
            return {
                id: 'muster.notice',
                talk: id,
                lines: [
                    notice('一、この度の陣触れにつき、足軽は城門前に集まるべし。'),
                    notice(
                        policy === 'home'
                            ? '一、国境の村を荒らす浪人の一団を討つ。留守の備えを怠るな。'
                            : policy === 'oda'
                              ? '一、織田家のお味方として出陣す。乱暴狼藉、かたく禁ず。'
                              : '一、浅井家と手を結び出陣す。乱暴狼藉、かたく禁ず。',
                    ),
                ],
            };
        default:
            throw new Error(`出陣の支度に ${id} は居ません`);
    }
}

// ================= 戦後 =================

function aftermathScript(state: IeyasuState, id: IeyasuTalkId): ScenarioScript {
    const o = state.battle;
    const p = state.policy;
    if (!o || !p) throw new Error('戦後なのに合戦の結果がありません');
    switch (id) {
        case 'tadakatsu':
            return aftermathTadakatsu(state, o, p);
        case 'oda_envoy':
        case 'asai_envoy':
            return aftermathEnvoy(state, o, p, id);
        case 'notice': {
            const text: Record<BattleResultKind, string[]> = {
                victory: [
                    p === 'home' ? '一、国境の浪人の一団、退散す。村の者は家へ戻るべし。' : '一、この度の戦、お味方の勝ち。',
                    '一、戦に出た者の家には、米を下される。',
                ],
                retreat: ['一、兵は城へ戻った。町の者は騒がぬこと。', '一、夜の火の始末を怠らぬこと。'],
                defeat: ['一、お味方、兵を引く。殿はご無事。', '一、町の者は騒がず、城の指図を待つべし。'],
            };
            return { id: `aftermath.notice.${o.result}`, talk: id, lines: text[o.result].map(notice) };
        }
        default:
            throw new Error(`戦後に ${id} は居ません`);
    }
}

function aftermathTadakatsu(state: IeyasuState, o: BattleOutcome, p: Policy): ScenarioScript {
    const choices: ScenarioChoice[] = [
        { id: 'end_chapter', label: 'この章を締めくくる', detail: '章の結末へ進みます' },
        { id: 'not_yet', label: 'まだ皆と話す' },
    ];
    if (talked(state, 'tadakatsu')) {
        return { id: 'aftermath.tadakatsu.again', talk: 'tadakatsu', lines: [T('今日のことを、締めくくりましょうか。')], choices, defaultChoice: 1 };
    }
    const lines: ScenarioLine[] = [];
    if (o.result === 'victory') {
        lines.push(
            p === 'oda'
                ? T('勝ち戦にございます。浅井・朝倉の勢は、この場から退きました。')
                : p === 'asai'
                  ? T('織田方の追撃は止まりました。浅井の兵は、北へ引いていきます。')
                  : T('浪人どもは国境の外へ散りました。村の者も戻り始めております。'),
        );
        lines.push(T('とはいえ、一度の勝ちで大勢が決まるわけではございませぬ。'));
    } else if (o.result === 'retreat') {
        lines.push(o.reason === 'nightfall' ? T('日が落ち、両軍とも兵を引きました。決着は持ち越しです。') : T('兵を退かれたのは、間違いではございませぬ。兵が残れば、次がございます。'));
    } else {
        lines.push(T('……本陣が崩れました。されど殿はご無事。それが何よりです。'));
        lines.push(T('一度の負けで、徳川の家が終わるわけではございませぬ。'));
        if (p !== 'home') {
            const partner = PLEDGE_SPECS[p].partner;
            lines.push(
                state.trust[partner] >= 0
                    ? T(`${TRUST_NAMES[partner]}の兵が、退く道を開けてくれております。`)
                    : T(`${TRUST_NAMES[partner]}は、こちらを頼みにならぬと見ております。自力で三河へ戻りましょう。`),
            );
        } else if (p === 'home') lines.push(T('城へ戻り、守りを固め直しましょう。'));
    }
    const pl = state.pledge;
    const spec = PLEDGE_SPECS[p];
    if (pl) {
        if (pl.result === 'kept') {
            lines.push(T(`約束は果たせました。${spec.targetName}は、無事に退いております。`));
            if (state.support?.reinforcement) {
                const from = state.support.from ? TRUST_NAMES[state.support.from] : '';
                lines.push(
                    state.support.recovered > 0
                        ? T(`${p === 'home' ? '守備隊の者たちが、そのまま加わってくれました' : `${from}から援兵が着きました`}。兵が ${state.support.recovered} 戻っております。`)
                        : T(`${p === 'home' ? '守備隊の者たちが加わると申しております' : `${from}が援兵を出すと申しております`}。今は兵に欠けがないので、次の戦で頼みにしましょう。`),
                );
            }
        } else if (pl.result === 'broken') {
            lines.push(
                pledgeUnfought(state, o)
                    ? T(`${spec.targetName}は無事ですが、敵と刃を交える前に兵を引きました。退路を守ると申した約束を、果たしたとは言えませぬ。`)
                    : T(`${spec.targetName}を守りきれませなんだ。……約束を果たせなかったこと、先方は忘れますまい。`),
            );
        } else {
            lines.push(T('頼みは引き受けておりませなんだゆえ、そのことで責められる筋はございませぬ。'));
        }
    }
    if (state.characters.tadakatsu === 'wounded') lines.push(T('拙者の傷は浅手です。お気になさらず。'));
    if (state.characters.ieyasu === 'wounded') lines.push(H('（傷が痛む。だが、生きている。）'));
    if (state.characters.nagamasa === 'wounded' && p === 'asai') lines.push(T('長政殿も手傷を負われたそうですが、命に別状はないとのこと。'));
    lines.push(T('皆とも話されたら、今日のことを締めくくりましょう。'));
    return { id: `aftermath.tadakatsu.${p}.${o.result}`, talk: 'tadakatsu', lines, choices, defaultChoice: 1 };
}

function aftermathEnvoy(state: IeyasuState, o: BattleOutcome, p: Policy, id: 'oda_envoy' | 'asai_envoy'): ScenarioScript {
    const E = id === 'oda_envoy' ? OE : AE;
    const clan: TrustId = id === 'oda_envoy' ? 'oda' : 'asai';
    const lines: ScenarioLine[] = [];
    let key: string;
    if (p === 'home') {
        // C：織田の使者が不満を伝えに来る（敵になるわけではない）
        key = 'home';
        lines.push(E('徳川殿が兵を出されなかったこと、主は快く思っておりませぬ。'), E('されど、国を守るのも大名の務め。主にはありのままを申し上げます。'));
        if (o.result === 'victory') lines.push(E('国境を鎮められたことは、聞き及んでおります。'));
        return { id: `aftermath.${id}.${key}`, talk: id, lines };
    }
    const pl = state.pledge;
    if (o.result === 'victory') {
        key = 'victory';
        lines.push(clan === 'oda' ? E('見事な戦ぶりでした。主も喜びましょう。') : E('主の兵を、よくぞ守り抜いてくださった。'));
    } else if (o.result === 'retreat') {
        key = state.trust[clan] >= 20 ? 'retreat_good' : 'retreat_bad';
        lines.push(key === 'retreat_good' ? E('退き際を誤らぬのも、大将の器量。主にはそう伝えます。') : E('戦い切らずに退かれたか……。主に何と伝えたものか。'));
    } else {
        key = state.trust[clan] >= 0 ? 'defeat_good' : 'defeat_bad';
        lines.push(key === 'defeat_good' ? E('負け戦ですが、手は結んだまま。退く道は、こちらで開けます。') : E('こちらの兵を盾にされた、と皆が申しております。しばらくは頼りになさいますな。'));
    }
    if (pl?.result === 'kept') lines.push(E(clan === 'oda' ? '援軍の退路を守っていただいたこと、主に必ず伝えます。' : '主の隊の退き口を守っていただいたこと、決して忘れませぬ。'));
    else if (pl?.result === 'broken')
        lines.push(
            pledgeUnfought(state, o)
                ? E('……ただ、刃を交える前に退かれた。退路を守るとのお約束は、果たされなかったと主に申し上げねばなりませぬ。')
                : E('……ただ、約束の退路は守られなかった。そのことは、主に申し上げねばなりませぬ。'),
        );
    return { id: `aftermath.${id}.${key}.${pl?.result ?? 'none'}`, talk: id, lines };
}

// ================= 段階の案内・目的 =================

export function ieyasuPhaseIntro(state: IeyasuState): { title: string; text: string } {
    switch (state.phase) {
        case 'explore':
            return { title: '元亀元年・家康', text: '織田と浅井の両家から使者が来ている。本多忠勝と話そう。（1570年の情勢を背景にした歴史分岐シナリオ。会話と分岐後は創作）' };
        case 'council':
            return { title: '軍議', text: '方針を決める。' };
        case 'muster': {
            const p = state.policy ?? 'oda';
            const giver = IEYASU_TALK_NAMES[PLEDGE_SPECS[p].giver];
            return { title: '出陣の支度', text: state.pledge ? '支度ができたら城門へ。' : `${giver}から頼みがあるという。話を聞き、支度ができたら城門へ。` };
        }
        case 'battle':
            return { title: IEYASU_FIELD_LABEL, text: '合戦' };
        case 'aftermath': {
            const r = state.battle?.result ?? 'retreat';
            const t: Record<BattleResultKind, { title: string; text: string }> = {
                victory: { title: '凱旋', text: '城へ戻った。皆の様子を見て、忠勝と話そう。' },
                retreat: { title: '城へ引いた夜', text: '兵をまとめて城へ戻った。皆の様子を見て、忠勝と話そう。' },
                defeat: { title: '落ち延びた夜', text: '本陣は崩れたが、家康は城へ落ち延びた。皆の様子を見て、忠勝と話そう。' },
            };
            return t[r];
        }
        case 'ending':
            return { title: state.ending ? IEYASU_ENDING_TITLES[state.ending] : '章の結末', text: '' };
    }
}

export function ieyasuObjective(state: IeyasuState): string {
    switch (state.phase) {
        case 'explore':
            return '本多忠勝と話す（両家の使者の話も聞ける）';
        case 'council':
            return '方針を選ぶ';
        case 'muster':
            if (!state.pledge && state.policy) return `${IEYASU_TALK_NAMES[PLEDGE_SPECS[state.policy].giver]}と話し、約束を引き受けるか決める`;
            return '支度を整え、城門で出陣する';
        case 'battle':
            return IEYASU_FIELD_LABEL;
        case 'aftermath':
            return '皆と話し、忠勝と話して章を締めくくる';
        case 'ending':
            return '元亀元年・家康 完';
    }
}

// ================= 結末 =================

export const IEYASU_ENDING_TITLES: Readonly<Record<IeyasuEndingId, string>> = {
    oda_victory: '織田との協力を保つ',
    asai_victory: '分かれ道の先へ',
    home_victory: '国を守る',
    retreat: '兵を残して退く',
    defeat_sheltered: '盟友に支えられて退く',
    defeat_mikawa: '三河へ退く',
};

/** 徳川の兵の合計（戦の前と後）。戦の前 = 今 − 援兵で戻った兵 + 合戦で失った兵 */
export function tokugawaTotals(state: IeyasuState): { before: number; after: number } {
    const after = TOKUGAWA_UNIT_IDS.reduce((n, k) => n + state.troops[k], 0);
    if (!state.battle) return { before: after, after };
    const ids = new Set(Object.values(IEYASU_UNIT_IDS));
    const lost = state.battle.units.filter((u) => u.side === 'ally' && u.clan === 'tokugawa' && ids.has(u.id)).reduce((n, u) => n + (u.startStrength - u.endStrength), 0);
    const recovered = state.support?.recovered ?? 0;
    return { before: after - recovered + lost, after };
}

function endingBody(state: IeyasuState, id: IeyasuEndingId): string[] {
    const p = state.policy!;
    const body: string[] = [];
    switch (id) {
        case 'oda_victory':
            body.push('浅井・朝倉の勢は、この局地戦の場から退いた。家康は織田との協力を保ち、織田家の信頼を得た。');
            body.push('ただ、浅井・朝倉の両家が滅んだわけではない。近江の戦は、なお続いていく。');
            break;
        case 'asai_victory':
            body.push('家康は浅井と手を結び、織田方の追撃を止めた。史実とは違う道を、徳川家は歩み始めた。（この分岐はゲームの創作）');
            body.push('織田との間には深い溝が残った。一度の勝ちで織田家が揺らぐわけではなく、難しい日々はこれからだ。');
            break;
        case 'home_victory':
            body.push('家康はどちらの家にも兵を出さず、国境の村を荒らす浪人衆を退けた。村の者は家へ戻った。');
            body.push('織田は兵を出さなかったことに不満を残したが、敵に回ったわけではない。浅井との関係も変わらない。');
            break;
        case 'retreat': {
            body.push('家康は兵をまとめて城へ引いた。決着は持ち越しとなった。');
            const t = tokugawaTotals(state);
            body.push(t.after >= t.before * 0.7 ? '兵の多くは無事に戻り、再び戦う力は残っている。' : '失った兵は少なくない。立て直しには、しばらく時がかかる。');
            if (p === 'home') body.push('浪人衆は国境に居座ったまま。織田は、兵を出さなかった徳川を静かに見ている。');
            else {
                const partner = PLEDGE_SPECS[p].partner;
                body.push(state.trust[partner] >= 20 ? `${TRUST_NAMES[partner]}は、退き際を見届けたうえで、なお手を結ぶと伝えてきた。` : `${TRUST_NAMES[partner]}の使者は、多くを語らずに帰っていった。`);
            }
            body.push('今は耐えて、力を蓄える時だ。');
            break;
        }
        case 'defeat_sheltered': {
            const partner = PLEDGE_SPECS[p].partner;
            body.push('本陣が崩れ、家康はわずかな供回りとともに退いた。');
            body.push(`${TRUST_NAMES[partner]}の兵が退く道を開け、家康は無事に三河へ戻った。敗れはしたが、命と盟約は残った。`);
            break;
        }
        case 'defeat_mikawa':
            body.push('本陣が崩れ、家康はわずかな供とともに、夜の道を三河へ退いた。');
            if (p !== 'home') body.push(`${TRUST_NAMES[PLEDGE_SPECS[p].partner]}の助けは得られなかった。`);
            else body.push('浪人衆は国境に居座ったまま。城に籠もり、次の備えを急ぐほかない。');
            body.push('それでも、家康は生きている。一度の負けで徳川の家が終わるわけではない。');
            break;
    }
    const pl = state.pledge;
    if (pl?.result === 'kept') body.push(`${PLEDGE_SPECS[p].targetName}の退路を守るという約束は、果たされた。`);
    else if (pl?.result === 'broken')
        body.push(
            pledgeUnfought(state)
                ? `${PLEDGE_SPECS[p].targetName}は無事に退いたが、敵と刃を交える前に兵を引いたため、退路を守るという約束は果たせなかった。`
                : `${PLEDGE_SPECS[p].targetName}の退路を守るという約束は、果たせなかった。`,
        );
    if (state.support?.reinforcement)
        body.push(state.support.from === 'tadakatsu' ? '忠勝の約束に応えて加わった岡崎の守備隊は、次の戦でも頼りにできる。' : `${TRUST_NAMES[state.support.from!]}からの援兵は、次の戦でも頼りにできる。`);
    if (state.characters.tadakatsu === 'wounded') body.push('忠勝の傷が癒えるまで、しばらくかかりそうだ。');
    body.push(retainerTrustLine(state));
    return body;
}

/**
 * 結末の本文の 1 行：軍議で意見を述べた酒井忠次（合戦の結果を見る）と石川数正（退き口を守る約束の結果を見る）の信頼の変化。
 * 信頼の動き方は flow.ts の TRUST_DELTA.sakai／ishikawa。文は実際の変化（章のはじめとの差）の向きで選ぶ
 * （版 1 の保存から続けた戦後など、家臣の信頼が動いていないときは「動かなかった」文になる）。ここは文を作るだけ。
 */
export function retainerTrustLine(state: IeyasuState): string {
    const d = (id: 'sakai' | 'ishikawa') => state.trust[id] - INITIAL_TRUST[id];
    const ds = d('sakai');
    const di = d('ishikawa');
    const sakai = ds > 0 ? '酒井忠次は、この日の采配を認めた' : ds < 0 ? '酒井忠次は、崩れた陣の采配を厳しく振り返った' : '酒井忠次は、この日の采配を黙って見届けた';
    const ishikawa =
        di > 0
            ? '石川数正は、退き口を守る約束が果たされたことを重く見ている'
            : di < 0
              ? '石川数正は、約束を果たせなかったことを案じている'
              : state.pledge?.result === 'declined'
                ? '石川数正は、約束を引き受けなかったことを咎めなかった'
                : '石川数正は、約束の件で多くを語らなかった';
    const n = (x: number) => (x === 0 ? '±0' : signed(x));
    return `${sakai}。${ishikawa}。（信頼：酒井 ${n(ds)}・石川 ${n(di)}）`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function pledgeRecordText(state: IeyasuState): string {
    const p = state.policy;
    const pl = state.pledge;
    if (!p || !pl) return 'まだ答えていない';
    const t = PLEDGE_SPECS[p].targetName;
    if (!pl.accepted) return `引き受けなかった（${t}の退路を守る約束）`;
    return `${t}の退路を守る：${pl.result ? PLEDGE_RESULT_LABELS[pl.result] : '合戦の前'}`;
}

export function supportRecordText(state: IeyasuState): string {
    const s = state.support;
    if (!s) return 'まだない';
    if (!s.reinforcement) return 'なし';
    return `援兵（${supportSourceName(s.from!)}）：兵 +${s.recovered}（次の章へ持ち越す）`;
}

/** 次の章へ持ち越す印の読み方 */
export const CARRY_FLAG_LABELS: Readonly<Record<CarryFlag, string>> = {
    policy_oda: '方針：織田との協力',
    policy_asai: '方針：浅井との協力',
    policy_home: '方針：自領の防衛',
    pledge_kept: '約束を守った',
    pledge_broken: '約束を守れなかった',
    pledge_declined: '約束を引き受けなかった',
    reinforcement_oda: '援兵：織田家',
    reinforcement_asai: '援兵：浅井家',
    reinforcement_tadakatsu: '援兵：守備隊（忠勝の約束）',
};

export function carryOverText(state: IeyasuState): string {
    const f = state.support?.carryOver ?? [];
    return f.length ? f.map((x) => CARRY_FLAG_LABELS[x]).join('・') : 'なし';
}

/** 信頼の変化（章のはじめ → 今） */
export function trustChangeText(state: IeyasuState): string {
    return SHOWN_TRUST_IDS.map((c) => {
        const d = state.trust[c] - INITIAL_TRUST[c];
        return `${TRUST_NAMES[c]} ${d === 0 ? '±0' : signed(d)}`;
    }).join('・');
}

export interface IeyasuEndingView {
    id: IeyasuEndingId;
    title: string;
    body: string[];
    record: { label: string; value: string }[];
    footer: string;
}

export function ieyasuEndingView(state: IeyasuState): IeyasuEndingView {
    const id = state.ending;
    if (!id || !state.battle || !state.policy) throw new Error('結末がまだ決まっていません');
    const o = state.battle;
    const t = tokugawaTotals(state);
    const min = Math.floor(o.elapsedSec / 60);
    const sec = Math.floor(o.elapsedSec % 60);
    const people: IeyasuCharacterId[] = ['ieyasu', 'tadakatsu'];
    if (state.policy === 'asai') people.push('nagamasa');
    const used = Object.keys(o.abilitiesUsed ?? {}).length;
    const record = [
        { label: '方針', value: POLICY_DONE_LABELS[state.policy] },
        { label: '合戦の結果', value: `${IEYASU_RESULT_LABELS[o.result]}：${ieyasuReasonLabel(state.policy, o.reason)}` },
        { label: '合戦の時間', value: `${min} 分 ${String(sec).padStart(2, '0')} 秒` },
        { label: '約束', value: pledgeRecordText(state) },
        { label: '徳川の兵', value: `${t.after.toLocaleString('ja-JP')}（出陣前 ${t.before.toLocaleString('ja-JP')}）` },
        { label: '部隊ごとの兵', value: TOKUGAWA_UNIT_IDS.map((k) => `${TOKUGAWA_UNIT_NAMES[k]} ${state.troops[k]}`).join('・') },
        { label: '支援', value: supportRecordText(state) },
        { label: '信頼', value: SHOWN_TRUST_IDS.map((c) => `${TRUST_NAMES[c]} ${signed(state.trust[c])}`).join('・') },
        { label: '信頼の変化', value: `${trustChangeText(state)}（章のはじめから）` },
        { label: '次の章へ', value: carryOverText(state) },
        { label: '人物', value: people.map((c) => `${IEYASU_CHARACTER_NAMES[c]} ${IEYASU_STATUS_LABELS[state.characters[c]]}`).join('・') },
        { label: '特殊能力', value: `${used > 0 ? `${used} 回使った` : '使わなかった'}（能力はゲーム用の創作）` },
        { label: '史実と創作', value: '開始の情勢（1570年、織田・徳川と浅井・朝倉の対立）は資料に合わせた。会話・分岐・戦場・結末は創作。' },
    ];
    return { id, title: IEYASU_ENDING_TITLES[id], body: endingBody(state, id), record, footer: IEYASU_END_LABEL };
}
