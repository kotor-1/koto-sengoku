/**
 * 第一章「国境の砦」の台詞・選択肢・結末の文章。
 *
 * ＊＊ 仮シナリオ ＊＊
 * 人物（琴坂宗真・源蔵・新八・田代兵庫・大森弥左衛門・鷲尾玄蕃）、家（琴坂・鷲尾・田代・大森）、地名（国境の原・国境の砦）、
 * 出来事は、すべて架空の仮の設定です。史実として確認したものではありません。
 * 元の企画（武将の生涯が史実から分岐する RPG）の最初の完成単位として、分岐の仕組みを先に作るための仮の話です。
 *
 * ここは文章を作るだけ（状態を書き換えない。three も DOM も使わない）。
 * 誰と話せるか・話した後にどう進むかは flow.ts が決める。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, ClanId } from '../battle/types';
import {
    KOTOSAKA_UNIT_IDS,
    talkFlag,
    type Alliance,
    type CampaignPhase,
    type CampaignState,
    type CharacterId,
    type CharacterStatus,
    type ChoiceId,
    type EndingId,
    type KotosakaUnitId,
    type TalkId,
} from './state';

/** 画面に常に出す注記 */
export const PROVISIONAL_LABEL = '仮シナリオ';
export const PROVISIONAL_NOTE = '仮シナリオ：人物・家・地名・出来事はすべて架空の仮の設定で、史実として確認したものではありません。';
export const CHAPTER_TITLE = '第一章　国境の砦';

/** 話し手（人物・地の文・高札・城門） */
export type SpeakerId = CharacterId | 'narration' | 'notice' | 'gate';

export interface Line {
    speaker: SpeakerId;
    /** 名前の欄に出す文字（地の文は空） */
    name: string;
    text: string;
}
export interface Choice {
    id: ChoiceId;
    label: string;
    /** 選ぶ前に添える説明（何が変わるか） */
    detail?: string;
}
export interface Script {
    /** 確認用の名前（例：'explore.genzo'、'council.confirm'） */
    id: string;
    talk: TalkId;
    lines: Line[];
    /** 最後の行で出す選択肢（選ぶと会話が終わる） */
    choices?: Choice[];
    /** 最初に選ばれている選択肢の番号（戻れない選択は「まだ」の側にしておき、連打で勝手に進まないようにする） */
    defaultChoice?: number;
}

// ---- 名前 ----

export const CHARACTER_NAMES: Readonly<Record<CharacterId, string>> = {
    hero: '宗真',
    genzo: '源蔵',
    shinpachi: '新八',
    tashiro_envoy: '田代兵庫',
    omori_envoy: '大森弥左衛門',
    washio_gen: '鷲尾玄蕃',
};
export const CHARACTER_FULL_NAMES: Readonly<Record<CharacterId, string>> = {
    hero: '琴坂 宗真（若殿）',
    genzo: '源蔵（老臣・侍大将）',
    shinpachi: '新八（物頭）',
    tashiro_envoy: '田代 兵庫（田代家の使者）',
    omori_envoy: '大森 弥左衛門（大森家の使者）',
    washio_gen: '鷲尾 玄蕃（鷲尾家の侍大将）',
};
export const CLAN_NAMES: Readonly<Record<ClanId, string>> = { kotosaka: '琴坂家', washio: '鷲尾家', tashiro: '田代家', omori: '大森家' };
export const ALLIANCE_LABELS: Readonly<Record<Alliance, string>> = { tashiro: '田代家と組む', omori: '大森家と組む', alone: '独力で戦う' };
/** 結末・記録で使う（過去形） */
export const ALLIANCE_DONE_LABELS: Readonly<Record<Alliance, string>> = { tashiro: '田代家と組んだ', omori: '大森家と組んだ', alone: '独力で戦った' };
export const RESULT_LABELS: Readonly<Record<BattleResultKind, string>> = { victory: '勝利', defeat: '敗北', retreat: '撤退' };
export const REASON_LABELS: Readonly<Record<BattleEndReason, string>> = {
    enemy_hq_routed: '鷲尾本陣が敗走した',
    enemy_army_broken: '鷲尾の本陣以外の部隊がすべて戦えなくなった',
    ally_hq_routed: '若殿の本陣が敗走した（若殿は落ち延びた）',
    ally_army_broken: '味方の本陣以外の部隊が崩れ、戦える部隊がなくなった',
    ordered_retreat: '撤退を命じ、兵をまとめて退いた',
    nightfall: '日没で両軍が兵を引いた',
};
export const STATUS_LABELS: Readonly<Record<CharacterStatus, string>> = { alive: '無事', wounded: '負傷', captured: '捕らわれ' };
export const TROOP_UNIT_NAMES: Readonly<Record<KotosakaUnitId, string>> = { honjin: '若殿本陣', genzo: '源蔵隊', shinpachi: '新八隊', reserve: '琴坂予備隊' };
/** タイトルの「つづきから」に添える段階の名前（battle は出陣の確認の前から再開するので「出陣前」） */
export const PHASE_LABELS: Readonly<Record<CampaignPhase, string>> = {
    explore: '城下',
    council: '軍議',
    muster: '出陣の支度',
    battle: '出陣前',
    aftermath: '戦の後',
    ending: '章の結末',
};

// ---- 行を作る小道具 ----

const say = (speaker: CharacterId, text: string): Line => ({ speaker, name: CHARACTER_NAMES[speaker], text });
const narrate = (text: string): Line => ({ speaker: 'narration', name: '', text });
const notice = (text: string): Line => ({ speaker: 'notice', name: '高札', text });

const G = (t: string) => say('genzo', t);
const S = (t: string) => say('shinpachi', t);
const H = (t: string) => say('hero', t);
const TE = (t: string) => say('tashiro_envoy', t);
const OE = (t: string) => say('omori_envoy', t);

const talked = (s: CampaignState, id: TalkId) => s.talked[talkFlag(s.phase, id)] === true;

/** 今の段階の、その相手の台詞。居るかどうかの検査は flow.ts（talk）が先に行う */
export function scriptFor(state: CampaignState, id: TalkId): Script {
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

function exploreScript(state: CampaignState, id: TalkId): Script {
    const again = talked(state, id);
    const choices: Choice[] = [
        { id: 'open_council', label: '軍議を開く', detail: '協力陣営を決める軍議へ進みます' },
        { id: 'not_yet', label: 'もう少し町を見る' },
    ];
    switch (id) {
        case 'genzo':
            if (again) return { id: 'explore.genzo.again', talk: id, lines: [G('軍議の支度はできております。皆を集めましょうか。')], choices, defaultChoice: 0 };
            return {
                id: 'explore.genzo',
                talk: id,
                lines: [
                    G('若殿、お待ちしておりました。'),
                    G('国境の砦から早馬です。隣国の鷲尾勢が、国境の原に陣を敷いたとのこと。'),
                    H('数は。'),
                    G('千二百余り。率いるは侍大将、鷲尾玄蕃。'),
                    G('国境の国衆、田代と大森の出方も気がかりです。急ぎ軍議を開きましょう。'),
                    G('……町の様子を見てからでも、構いませぬが。'),
                ],
                choices,
                defaultChoice: 0,
            };
        case 'shinpachi':
            if (again)
                return {
                    id: 'explore.shinpachi.again',
                    talk: id,
                    lines: [S('丘を正面から攻めるのは損です。横か後ろを突きましょう。')],
                };
            return {
                id: 'explore.shinpachi',
                talk: id,
                lines: [
                    S('若殿！ 弓隊、いつでも出られます。'),
                    S('国境の原は、西に林、東に川沿いの湿地。真ん中の丘に陣取られると厄介です。'),
                    S('林の中には山道が通っていて、中にいる兵は外から見えないそうです。'),
                    H('林を抜ければ、気づかれずに回り込める……か。覚えておこう。'),
                ],
            };
        case 'notice':
            return {
                id: 'explore.notice',
                talk: id,
                lines: [
                    notice('一、鷲尾勢、国境に迫る。町の者は落ち着いて家業に励むべし。'),
                    notice('一、兵糧の買い占め、かたく禁ず。'),
                    narrate(`（${PROVISIONAL_NOTE}）`),
                ],
            };
        default:
            throw new Error(`探索に ${id} は居ません`);
    }
}

// ================= 軍議 =================

const ALLIANCE_CHOICES: Choice[] = [
    { id: 'ally_tashiro', label: '田代家と組む', detail: '田代の騎馬隊が、合戦の途中で左の林から別働隊として現れる。大森は鷲尾に付き、右の川沿いから回り込んでくる。' },
    { id: 'ally_omori', label: '大森家と組む', detail: '大森の槍隊が、はじめから右翼に布陣する。田代は鷲尾に付き、左の林から騎馬で回り込んでくる。' },
    { id: 'ally_alone', label: '独力で戦う', detail: '琴坂の予備隊を本陣の後ろに置く。田代・大森はどちらも静観する。鷲尾も丘の後ろに予備隊を置く。' },
];

function councilScript(state: CampaignState): Script {
    const p = state.pendingAlliance;
    if (p) {
        const lines: Record<Alliance, Line[]> = {
            tashiro: [
                G('田代家と組む。……大森は鷲尾に付くことになりますが、よろしいか。'),
                S('田代の騎馬は、合図から四十数えるほどで林から出てくるはずです。それまで正面を持ちこたえねば。'),
            ],
            omori: [
                G('大森家と組む。田代の騎馬が敵に回ります。左の林には、よくよく気をつけねばなりませぬ。'),
                G('よろしいか。'),
            ],
            alone: [
                G('独力で戦う。国衆の助けはありませぬが、借りも作りませぬ。'),
                G('城の予備の兵を出しましょう。本陣の後ろに置き、崩れかけた所へ入れるのが肝要です。よろしいか。'),
            ],
        };
        return {
            id: `council.confirm.${p}`,
            talk: 'council',
            lines: lines[p],
            choices: [
                { id: 'confirm_alliance', label: 'それで決める', detail: '決めた後は変えられません' },
                { id: 'reconsider', label: '考え直す' },
            ],
            defaultChoice: 0,
        };
    }
    if (talked(state, 'council')) {
        return { id: 'council.again', talk: 'council', lines: [G('改めて、いずれと組まれますか。')], choices: ALLIANCE_CHOICES, defaultChoice: 0 };
    }
    const lines: Line[] = [
        narrate('城の広間に、主だった者が集まった。'),
        G('では、軍議を始めます。'),
        G('鷲尾勢は千二百余り。北の丘の上に本陣を置き、その前に先手の槍と弓を並べております。'),
        G('こちらは若殿の本陣、わしの槍、新八の弓。合わせて千百五十。正面から丘を攻めれば、分が悪い。'),
        S('国境の国衆、北の山の田代家と、川湊の大森家が、どちらに付くか様子を見ています。'),
        G('田代は騎馬に長け、林の山道を知っております。組めば、戦の途中で敵の横腹を突けましょう。'),
        G('大森は槍が多く、川沿いの守りに強い。組めば、はじめから右翼を固められます。'),
        G('ただし、片方と組めば、もう片方は鷲尾に付くでしょう。'),
        S('どちらとも組まずに戦う手もあります。国衆は静観し、こちらは城の予備の兵を出せます。'),
    ];
    if (state.talked[talkFlag('explore', 'shinpachi')]) lines.push(S('林の中の兵は、外から見えません。回り込む兵を林に通せば、敵は気づかないはずです。'));
    lines.push(G('若殿、いかがなさいます。'));
    return { id: 'council', talk: 'council', lines, choices: ALLIANCE_CHOICES, defaultChoice: 0 };
}

// ================= 出陣の支度 =================

function musterScript(state: CampaignState, id: TalkId): Script {
    const a = state.alliance ?? 'alone';
    const again = talked(state, id);
    switch (id) {
        case 'gate':
            return {
                id: 'muster.gate',
                talk: id,
                lines: [narrate('城門の外に、兵が揃っている。'), H('（ここを出れば、国境の原だ。）')],
                choices: [
                    { id: 'depart', label: '出陣する', detail: '出陣の前に自動で保存します' },
                    { id: 'stay', label: 'まだ支度をする' },
                ],
                defaultChoice: 1,
            };
        case 'genzo': {
            const plan: Record<Alliance, Line[]> = {
                tashiro: [
                    G('わしの槍で正面を支えます。田代の騎馬が林から出てくるまで、無理に丘へ登らぬことです。'),
                    G('大森勢は右の川沿いから来ましょう。新八の弓で足を止めさせます。'),
                ],
                omori: [
                    G('右は大森が固めます。気がかりは左の林。田代の騎馬は、見えぬ所から来ますぞ。'),
                    G('騎馬が林から出たら、わしの槍で正面から受け止めます。弓は騎馬に弱い。新八を前に出しすぎぬことです。'),
                    G('騎馬を退けたら、大森勢を先に右（東）へ回しておき、わしが先手の正面に当たるのと同じ時に、横から突かせるのです。'),
                ],
                alone: [
                    G('丘の上の先手に、下から当たってはなりませぬ。新八の弓で射かけ続ければ、先手は嫌って丘を下りて来ましょう。'),
                    G('ただし、わしの槍や本陣が先手の近くにいると、先手は動きませぬ。わしと予備の兵は左右に離して構えます。'),
                    G('先手が新八に向かって下りて来たところを、わしと予備の兵で両の横から挟むのです。正面に重ねても効きませぬ。'),
                    G('林は敵から見えませぬが、足が遅い。予備の兵を林に通すなら、早めに動かすことです。'),
                ],
            };
            const lines = again ? [plan[a][0]!] : [...plan[a], G('支度ができたら、城門へ。')];
            return { id: `muster.genzo.${a}`, talk: id, lines };
        }
        case 'shinpachi': {
            const lines: Line[] = again
                ? [S('弓は近くで斬り合うと弱い。前に出しすぎないでくださいね。')]
                : [
                      S('弓は遠くから射られますが、斬り合いには弱い。前に出しすぎないでくださいね。'),
                      S('林の中の敵には、矢が通りにくいです。'),
                      a === 'alone'
                          ? S('国衆の助けがないなら、なおさら兵を無駄にできません。')
                          : a === 'tashiro'
                            ? S('大森が敵に付くとは……。川沿いの湿地は足を取られます。そこで迎え撃ちましょう。')
                            : S('田代の騎馬が相手とは……。弓は騎馬に弱い。槍の後ろに置いてください。'),
                  ];
            return { id: `muster.shinpachi.${a}`, talk: id, lines };
        }
        case 'tashiro_envoy':
            if (again) return { id: 'muster.tashiro_envoy.again', talk: id, lines: [TE('林から出るのは、戦が始まって四十数えたころ。それまで持ちこたえられよ。')] };
            return {
                id: 'muster.tashiro_envoy',
                talk: id,
                lines: [
                    TE('田代兵庫にござる。主の命により、騎馬二百五十を連れて参った。'),
                    TE('我らは山道を抜け、林から敵の横へ出る。戦が始まって四十数えるころだ。'),
                    H('頼りにしている。'),
                    TE('大森は鷲尾に付いたと聞く。右の川沿いに気をつけられよ。'),
                ],
            };
        case 'omori_envoy':
            if (again) return { id: 'muster.omori_envoy.again', talk: id, lines: [OE('右翼はお任せを。正面をお頼みします。')] };
            return {
                id: 'muster.omori_envoy',
                talk: id,
                lines: [
                    OE('大森弥左衛門でございます。槍四百、右翼を預かります。'),
                    OE('川沿いの湿地は足を取られます。我らが右を塞いでいる間に、正面をお頼みします。'),
                    H('頼りにしている。'),
                    OE('田代の騎馬が鷲尾に付きました。左の林は、見えぬ所から来ますぞ。'),
                ],
            };
        case 'notice':
            return {
                id: 'muster.notice',
                talk: id,
                lines: [
                    notice('一、この度の陣触れにつき、足軽は城門前に集まるべし。'),
                    notice(
                        a === 'alone'
                            ? '一、城の備えの兵も出陣す。留守は町の者で固めよ。'
                            : `一、${CLAN_NAMES[a]}の兵、お味方として参陣す。乱暴狼藉、かたく禁ず。`,
                    ),
                ],
            };
        default:
            throw new Error(`出陣の支度に ${id} は居ません`);
    }
}

// ================= 戦後 =================

/** 協力陣営の部隊の結果（独力なら null） */
export function alliedUnitOf(state: CampaignState): BattleOutcome['units'][number] | null {
    const a = state.alliance;
    if (!state.battle || !a || a === 'alone') return null;
    return state.battle.units.find((u) => u.side === 'ally' && u.clan === a) ?? null;
}
/** 協力陣営の兵を多く失わせた（全滅、または 6 割より多く失った） */
export function alliedUnitSacrificed(u: BattleOutcome['units'][number] | null): boolean {
    if (!u) return false;
    return u.status === 'destroyed' || u.endStrength < u.startStrength * 0.4;
}

function aftermathScript(state: CampaignState, id: TalkId): Script {
    const o = state.battle;
    const a = state.alliance;
    if (!o || !a) throw new Error('戦後なのに合戦の結果がありません');
    switch (id) {
        case 'genzo':
            return aftermathGenzo(state, o, a);
        case 'shinpachi':
            return aftermathShinpachi(state, o, a);
        case 'tashiro_envoy':
        case 'omori_envoy':
            return aftermathEnvoy(state, o, id);
        case 'notice': {
            const text: Record<BattleResultKind, string[]> = {
                victory: ['一、鷲尾勢、国境の原より退く。', '一、戦に出た者の家には、米を下される。'],
                retreat: ['一、鷲尾勢、なお国境に留まる。', '一、町の者は夜の火の始末を怠らぬこと。'],
                defeat: ['一、国境の砦、鷲尾の手に落つ。', '一、町の者は騒がず、城の指図を待つべし。'],
            };
            return { id: `aftermath.notice.${o.result}`, talk: id, lines: text[o.result].map(notice) };
        }
        default:
            throw new Error(`戦後に ${id} は居ません`);
    }
}

function aftermathGenzo(state: CampaignState, o: BattleOutcome, a: Alliance): Script {
    const choices: Choice[] = [
        { id: 'end_chapter', label: 'この章を締めくくる', detail: '章の結末へ進みます' },
        { id: 'not_yet', label: 'まだ皆と話す' },
    ];
    if (talked(state, 'genzo')) {
        return { id: 'aftermath.genzo.again', talk: 'genzo', lines: [G('皆とは話されましたか。今日のことを、締めくくりましょう。')], choices, defaultChoice: 1 };
    }
    const lines: Line[] = [];
    const wounded = state.characters.genzo === 'wounded';
    if (o.result === 'victory') {
        lines.push(G('勝ち戦にございます。鷲尾勢は丘を捨て、国境の向こうへ退きました。'));
        if (o.reason === 'enemy_army_broken') lines.push(G('本陣を落とさずとも、手足をもげば敵は戦えませぬ。'));
        lines.push(
            a === 'tashiro'
                ? G('田代の騎馬が林から出てきたのが、効きましたな。')
                : a === 'omori'
                  ? G('大森が右を塞いでくれたおかげで、正面に力を集められました。')
                  : G('国衆の手を借りずに勝ったこと、近隣にもすぐ聞こえましょう。'),
        );
        if (wounded) lines.push(G('わしの傷は浅手です。お気になさるな。'));
    } else if (o.result === 'retreat') {
        lines.push(
            o.reason === 'nightfall'
                ? G('日が落ち、両軍とも兵を引きました。決着は持ち越しです。')
                : G('兵を退いたのは、間違いではありませぬ。兵が残れば、次があります。'),
        );
        lines.push(G('ただ、国境の原は鷲尾の手に残りました。'));
        lines.push(
            a === 'tashiro'
                ? G('田代の騎馬は山へ戻りました。大森の槍は、まだ鷲尾の陣におります。')
                : a === 'omori'
                  ? G('大森の槍は川湊へ引きました。田代の騎馬は、まだ鷲尾の陣におります。')
                  : G('田代も大森も動かず、こちらの様子を見ております。'),
        );
        if (wounded) lines.push(G('……わしも、この通り手傷を負いましたが。'));
    } else {
        lines.push(G('……面目ない。殿（しんがり）を務めましたが、この傷です。'));
        lines.push(
            o.reason === 'ally_hq_routed'
                ? G('本陣が崩れたとき、若殿を落とすことだけを考えました。')
                : G('前の備えがすべて崩れては、どうにもなりませなんだ。'),
        );
        lines.push(G('若殿がご無事なら、琴坂家は終わりませぬ。'));
        if (a === 'alone') lines.push(G('頼れる国衆はおりませぬ。城を固め、時を稼ぎましょう。'));
        else if (state.relations[a] >= 0)
            lines.push(G(a === 'tashiro' ? '田代が、山の館へ若殿をお迎えすると申しております。' : '大森が、川湊の屋敷に身を隠されよと申しております。'));
        else lines.push(G(`${CLAN_NAMES[a]}は、兵を捨て石にされたと怒っております。頼れませぬ。`));
    }
    if (state.characters.hero === 'wounded') lines.push(H('（傷が痛む。だが、生きている。）'));
    if (state.characters.shinpachi === 'captured') lines.push(G('新八が鷲尾に捕らわれました。……いずれ、必ず取り戻しましょう。'));
    else if (state.characters.shinpachi === 'wounded') lines.push(G('新八も手傷を負いましたが、命に別状はありませぬ。'));
    lines.push(G('皆とも話されたら、今日のことを締めくくりましょう。'));
    return { id: `aftermath.genzo.${a}.${o.result}`, talk: 'genzo', lines, choices, defaultChoice: 1 };
}

function aftermathShinpachi(state: CampaignState, o: BattleOutcome, a: Alliance): Script {
    const lines: Line[] = [];
    if (state.characters.shinpachi === 'wounded') lines.push(S('腕を射られました。しばらく弓は引けそうにありません。'));
    if (o.result === 'victory') {
        lines.push(S('若殿、勝ちましたね！'));
        lines.push(
            a === 'tashiro'
                ? S('田代の騎馬が林から飛び出したときは、胸がすく思いでした。')
                : a === 'omori'
                  ? S('右の大森勢、最後まで崩れませんでしたね。')
                  : S('国衆がいなくても、やれるものですね。'),
        );
    } else if (o.result === 'retreat') {
        lines.push(S('悔しいですが、あのまま続けていたら危なかった。'));
    } else {
        lines.push(S('……次は、負けません。'));
    }
    if (a === 'tashiro') lines.push(S('大森が鷲尾に付いたこと、町でも噂になっています。'));
    else if (a === 'omori') lines.push(S('田代の騎馬が敵にいたこと、山の村の者は驚いていました。'));
    return { id: `aftermath.shinpachi.${a}.${o.result}`, talk: 'shinpachi', lines };
}

function aftermathEnvoy(state: CampaignState, o: BattleOutcome, id: 'tashiro_envoy' | 'omori_envoy'): Script {
    const clan = id === 'tashiro_envoy' ? 'tashiro' : 'omori';
    const E = id === 'tashiro_envoy' ? TE : OE;
    const rel = state.relations[clan];
    const lost = alliedUnitSacrificed(alliedUnitOf(state));
    const lines: Line[] = [];
    if (state.characters[id] === 'wounded') lines.push(narrate(`（${CHARACTER_NAMES[id]}は、腕に血の滲んだ布を巻いている。）`));
    const t = {
        tashiro: {
            victory: ['見事な采配であった。主も、琴坂家との盟約を喜ぼう。'],
            retreatGood: ['退き際を知る大将は、長生きする。主にはそう伝えよう。'],
            retreatBad: ['戦い切らずに退くとは……。主に何と伝えたものか。'],
            defeatGood: ['負け戦だが、盟約は盟約。しばらく我らの山に身を寄せられよ。'],
            defeatBad: ['我らの騎馬を捨て石にされた。主は、この盟約を考え直すであろう。'],
            lost: '……ただ、我らの騎馬は多くが戻らなかった。その重さは覚えておかれよ。',
        },
        omori: {
            victory: ['勝ち戦、おめでとうございます。これで川湊の荷も、安心して城下へ運べます。'],
            retreatGood: ['兵が残っているなら、商いと同じで、また取り返せます。'],
            retreatBad: ['……損の多い戦でしたな。主には、ありのままを申し上げます。'],
            defeatGood: ['川湊の屋敷へお越しください。船があれば、どこへでも逃げられます。'],
            defeatBad: ['我らの槍を盾にして、ご自分だけ退かれた。主は、手を引くと申すでしょう。'],
            lost: '……ただ、我らの槍は多くが戻りませんでした。その損は、覚えておいていただきたい。',
        },
    }[clan];
    let key: string;
    if (o.result === 'victory') {
        key = 'victory';
        lines.push(...t.victory.map(E));
        if (lost) lines.push(E(t.lost));
    } else if (o.result === 'retreat') {
        key = rel >= 15 ? 'retreat_good' : 'retreat_bad';
        lines.push(...(rel >= 15 ? t.retreatGood : t.retreatBad).map(E));
    } else {
        key = rel >= 0 ? 'defeat_good' : 'defeat_bad';
        lines.push(...(rel >= 0 ? t.defeatGood : t.defeatBad).map(E));
    }
    return { id: `aftermath.${id}.${key}`, talk: id, lines };
}

// ================= 段階の案内 =================

/** 段階に入ったときに出す見出しと一言（場面の案内） */
export function phaseIntro(state: CampaignState): { title: string; text: string } {
    switch (state.phase) {
        case 'explore':
            return { title: CHAPTER_TITLE, text: '隣国・鷲尾家の兵が国境に迫っている。老臣の源蔵を探して話を聞こう。' };
        case 'council':
            return { title: '軍議', text: '協力を求める陣営を決める。' };
        case 'muster':
            return {
                title: '出陣の支度',
                text:
                    state.alliance === 'alone'
                        ? '城の予備の兵も揃った。支度ができたら城門へ。'
                        : `${CLAN_NAMES[state.alliance ?? 'tashiro']}の使者が着いた。支度ができたら城門へ。`,
            };
        case 'battle':
            return { title: '国境の原', text: '合戦' };
        case 'aftermath': {
            const r = state.battle?.result ?? 'retreat';
            const t: Record<BattleResultKind, { title: string; text: string }> = {
                victory: { title: '凱旋', text: '鷲尾勢を退け、城へ戻った。皆の様子を見て、源蔵と話そう。' },
                retreat: { title: '城へ引いた夜', text: '兵をまとめて城へ戻った。皆の様子を見て、源蔵と話そう。' },
                defeat: { title: '落ち延びた夜', text: '本陣は崩れたが、若殿は城へ落ち延びた。皆の様子を見て、源蔵と話そう。' },
            };
            return t[r];
        }
        case 'ending':
            return { title: state.ending ? ENDING_TITLES[state.ending] : '章の結末', text: '' };
    }
}

/** 今の目的（画面の隅に出す一行） */
export function objectiveText(state: CampaignState): string {
    switch (state.phase) {
        case 'explore':
            return '源蔵と話す';
        case 'council':
            return '協力陣営を選ぶ';
        case 'muster':
            return '支度を整え、城門で出陣する';
        case 'battle':
            return '国境の原で鷲尾勢と戦う';
        case 'aftermath':
            return '皆と話し、源蔵と話して章を締めくくる';
        case 'ending':
            return '第一章 完';
    }
}

// ================= 合戦の前の説明 =================

/** 合戦の前に出す、目的と勝ち負けの条件（仕様 §4「勝ち負け」） */
export function briefingFor(alliance: Alliance, timeLimitSec: number): string[] {
    const min = Math.round(timeLimitSec / 60);
    const lines = [
        '（仮シナリオ）目的：国境の原に陣取る鷲尾勢を退ける。',
        '勝利：鷲尾本陣（北の丘の上）を敗走させる。または、鷲尾の本陣以外の部隊をすべて戦えなくする（敵兵を全員倒す必要はない）。',
        '敗北：若殿の本陣が敗走する（若殿は落ち延びる）。または、本陣以外の味方がすべて戦えなくなり、崩れた（敗走・全滅）部隊の方が多い。',
        `撤退：「全軍撤退」を命じる。本陣以外の部隊をすべて退かせる。または日没（${min} 分）で両軍が兵を引く。`,
        '丘の上の敵は、下から攻めると手強い。同じ敵の正面へ何部隊も重ねても効きが薄い。側面・背後を突くと大きな損害を与えられる。',
        '丘の前の鷲尾先手は、矢を浴び続けると丘を下りて射手へ打って出る（持ち場の近くに味方の槍・騎馬・本陣がいると動かない）。',
    ];
    const plan: Record<Alliance, string> = {
        tashiro: '味方：田代騎馬隊が、開始から 40 秒ほどで左（西）の林から現れる。敵：大森槍隊が鷲尾に付き、右（東）の川沿いから回り込んでくる。',
        omori: '味方：大森槍隊が、はじめから右翼に布陣している。敵：田代騎馬隊が鷲尾に付き、左（西）の林から回り込んでくる。',
        alone: '味方：琴坂の予備隊が本陣の後ろに控える。敵：鷲尾の予備隊が丘の後ろに控える。国衆は静観。',
    };
    lines.splice(1, 0, plan[alliance]);
    return lines;
}

// ================= 結末 =================

export const ENDING_TITLES: Readonly<Record<EndingId, string>> = {
    tashiro_victory: '山の盟約',
    omori_victory: '川湊の富',
    alone_victory: '独り立つ若殿',
    retreat: '雌伏',
    defeat_sheltered: '盟友の庇護',
    defeat_alone: '落ち延びる',
};
export const CHAPTER_END_LABEL = '第一章 完（仮シナリオ）';

export interface EndingView {
    id: EndingId;
    title: string;
    body: string[];
    /** 記録：選択・結果・兵の残り・人物の状態・関係 */
    record: { label: string; value: string }[];
    footer: string;
}

/** 兵の合計（戦の前と後）。合戦に出なかった部隊は、前も後も今の兵 */
export function troopTotals(state: CampaignState): { before: number; after: number } {
    const after = KOTOSAKA_UNIT_IDS.reduce((n, k) => n + state.troops[k], 0);
    if (!state.battle) return { before: after, after };
    const lost = state.battle.units
        .filter((u) => u.side === 'ally' && u.clan === 'kotosaka')
        .reduce((n, u) => n + (u.startStrength - u.endStrength), 0);
    return { before: after + lost, after };
}

function endingBody(state: CampaignState, id: EndingId): string[] {
    const a = state.alliance ?? 'alone';
    const other = a === 'tashiro' ? 'omori' : a === 'omori' ? 'tashiro' : null;
    const body: string[] = [];
    switch (id) {
        case 'tashiro_victory':
            body.push('鷲尾勢は国境の原から退いた。田代家は琴坂家との盟約を正式に結び、北の山道は琴坂家に開かれた。');
            body.push('一方、鷲尾に付いた大森家とのあいだには深い溝が残った。川湊の荷は、しばらく城下に届かない。');
            break;
        case 'omori_victory':
            body.push('鷲尾勢を退けた若殿のもとに、大森家の船が荷を運び込む。川湊の富は、琴坂家の兵を養う力となった。');
            body.push('鷲尾方として敗れた田代家は、琴坂家を恨んでいる。北の山道は閉ざされたままだ。');
            break;
        case 'alone_victory':
            body.push('国衆の手を借りずに勝った若殿の名は、国境の村々に広まった。');
            body.push('田代家も大森家も、次はどちらに付くべきか、改めて琴坂家の様子をうかがっている。');
            break;
        case 'retreat': {
            body.push('若殿は兵をまとめて城へ引いた。国境の原は、鷲尾勢の手に残った。');
            const t = troopTotals(state);
            body.push(
                t.after >= t.before * 0.7
                    ? '兵の多くは無事に戻り、再び戦う力は残っている。'
                    : '失った兵は少なくない。立て直しには、しばらく時がかかる。',
            );
            if (a === 'alone') body.push('国衆は、黙って琴坂家の様子を見ている。');
            else if (state.relations[a] >= 15) body.push(`${CLAN_NAMES[a]}は、退き際を見届けたうえで、なお盟約を保つと伝えてきた。`);
            else body.push(`${CLAN_NAMES[a]}の使者は、何も言わずに帰っていった。`);
            body.push('今は耐えて、力を蓄える時だ。');
            break;
        }
        case 'defeat_sheltered': {
            const clan = a === 'omori' ? 'omori' : 'tashiro';
            const place = clan === 'tashiro' ? '北の山の館' : '川湊の屋敷';
            body.push('本陣が崩れ、若殿はわずかな供回りとともに落ち延びた。国境の砦には、鷲尾の旗が立った。');
            body.push(`${CLAN_NAMES[clan]}は約束を守り、若殿を${place}にかくまった。敗れはしたが、命と盟約は残った。`);
            break;
        }
        case 'defeat_alone':
            body.push('本陣が崩れ、若殿はわずかな供とともに、夜の山道を城へ落ち延びた。国境の砦には、鷲尾の旗が立った。');
            if (a !== 'alone') body.push(`${CLAN_NAMES[a]}は、兵を捨て石にされたと怒り、門を閉ざした。`);
            else body.push('頼れる国衆はない。城に籠もり、次の戦に備えるほかない。');
            body.push('それでも、若殿は生きている。');
            break;
    }
    if (other && id !== 'tashiro_victory' && id !== 'omori_victory') body.push(`鷲尾に付いた${CLAN_NAMES[other]}とは、敵味方に分かれたままだ。`);
    if (state.characters.shinpachi === 'captured') body.push('鷲尾に捕らわれた新八を取り戻すことが、次の務めとなる。');
    if (state.characters.genzo === 'wounded') body.push('源蔵の傷が癒えるまで、しばらくかかりそうだ。');
    if (state.characters.washio_gen === 'wounded') body.push('鷲尾玄蕃は、手傷を負って国へ引いたという。');
    return body;
}

/** 結末の画面に出すもの（state.ending が決まっていること） */
export function endingView(state: CampaignState): EndingView {
    const id = state.ending;
    if (!id || !state.battle || !state.alliance) throw new Error('結末がまだ決まっていません');
    const o = state.battle;
    const t = troopTotals(state);
    const min = Math.floor(o.elapsedSec / 60);
    const sec = Math.floor(o.elapsedSec % 60);
    const people: CharacterId[] = ['hero', 'genzo', 'shinpachi'];
    if (state.alliance === 'tashiro') people.push('tashiro_envoy');
    if (state.alliance === 'omori') people.push('omori_envoy');
    const record = [
        { label: '協力陣営', value: ALLIANCE_DONE_LABELS[state.alliance] },
        { label: '合戦の結果', value: `${RESULT_LABELS[o.result]}：${REASON_LABELS[o.reason]}` },
        { label: '合戦の時間', value: `${min} 分 ${String(sec).padStart(2, '0')} 秒` },
        { label: '琴坂の兵', value: `${t.after.toLocaleString('ja-JP')}（出陣前 ${t.before.toLocaleString('ja-JP')}）` },
        { label: '部隊ごとの兵', value: KOTOSAKA_UNIT_IDS.map((k) => `${TROOP_UNIT_NAMES[k]} ${state.troops[k]}`).join('・') },
        { label: '人物', value: people.map((c) => `${CHARACTER_NAMES[c]} ${STATUS_LABELS[state.characters[c]]}`).join('・') },
        { label: '関係', value: (['tashiro', 'omori', 'washio'] as const).map((c) => `${CLAN_NAMES[c]} ${signed(state.relations[c])}`).join('・') },
    ];
    return { id, title: ENDING_TITLES[id], body: endingBody(state, id), record, footer: CHAPTER_END_LABEL };
}

function signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
}
