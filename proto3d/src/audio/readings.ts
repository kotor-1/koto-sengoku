/**
 * 声の台詞の読み（音声用のかな。表示の漢字とは分けて持つ）と、話し手ごとの声の高さ・速さ。
 *
 * - 台詞の表（表示の文・話し手）は campaign/ieyasu1570/story/voiceLines.ts（担当 I）。ここは id ごとに「どの表示の文に対して書いた読みか」と読みを持つ。
 *   表の文が変わったら、テスト（tests/proto3d-audio.test.ts）が読みの書き直しを求める（字幕と声の言葉をそろえるため）。
 * - 読みは言葉を変えない（漢字をかなに開くだけ・読み違えやすい名前と語をかなにする）。
 * - 表に読みの無い台詞（後から足された物）は、名前・語の辞書（WORDS）でかなに開いた文を読む。
 * - 声の高さ・速さは人物ごとに少し変える（端末の読み上げの声のまま。特定の俳優・作品の声をまねない）。
 */

/** 読み違えやすい名前と語（長い方から当てる）。殿（との／しんがり／〜どの）は文ごとに読みを書く */
export const WORDS: readonly (readonly [string, string])[] = [
    ['徳川殿', 'とくがわどの'],
    ['家康', 'いえやす'],
    ['忠勝', 'ただかつ'],
    ['数正', 'かずまさ'],
    ['本多', 'ほんだ'],
    ['石川', 'いしかわ'],
    ['酒井', 'さかい'],
    ['忠次', 'ただつぐ'],
    ['榊原', 'さかきばら'],
    ['康政', 'やすまさ'],
    ['浅井', 'あざい'],
    ['朝倉', 'あさくら'],
    ['長政', 'ながまさ'],
    ['元亀', 'げんき'],
    ['三河', 'みかわ'],
    ['近江', 'おうみ'],
    ['後備え', 'あとぞなえ'],
    ['後備', 'あとぞなえ'],
    ['小荷駄', 'こにだ'],
    ['退き口', 'のきぐち'],
    ['後詰め', 'ごづめ'],
    ['先駆け', 'さきがけ'],
    ['拙者', 'せっしゃ'],
];

/** 読みを必ずかなにする語（表の文にあれば、読みには残さない） */
export const MUST_KANA: readonly string[] = ['家康', '忠勝', '数正', '本多', '石川', '浅井', '朝倉', '長政', '元亀', '三河', '近江', '後備え', '小荷駄', '殿', '退き口', '酒井', '榊原'];

/** 辞書でかなに開く（読みの無い台詞のため） */
export function autoReading(text: string): string {
    let out = text;
    for (const [w, k] of WORDS) out = out.split(w).join(k);
    return out;
}

/** id → { 書いた時の表示の文, 読み } */
export const READINGS: Readonly<Record<string, { text: string; reading: string }>> = {
    'ch1.oda_envoy.ask': { text: '徳川殿にも、兵を出していただきたい。', reading: 'とくがわどのにも、へいを出していただきたい。' },
    'ch1.asai_envoy.ask': { text: '主は、徳川殿と手を結びたいと。', reading: 'あるじは、とくがわどのと、手を結びたいと。' },
    'ch1.tadakatsu.council': { text: '殿、軍議を開きましょう。城門の前でお待ちします。', reading: 'との、ぐんぎを開きましょう。じょうもんの前でお待ちします。' },
    'ch1.hero.gather': { text: 'うむ。皆を集めよ。', reading: 'うむ。みなを集めよ。' },
    'ch2.oda_envoy.first.kept': { text: '先の戦では、援軍の退路を守っていただいた。', reading: 'さきのいくさでは、えんぐんの退路を守っていただいた。' },
    'ch2.oda_envoy.first.broken': { text: '約束の退路は守られなんだ。されど手が足りぬ。', reading: 'やくそくの退路は守られなんだ。されど、手が足りぬ。' },
    'ch2.oda_envoy.first.declined': { text: '頼みを断られたのは、徳川殿のお考え。', reading: 'たのみを断られたのは、とくがわどののお考え。' },
    'ch2.oda_envoy.mission': { text: '主の本隊が近江の陣を引く。撤収をお支えくだされ。', reading: 'あるじの本隊が、おうみの陣を引く。撤収を、おささえくだされ。' },
    'ch2.asai_envoy.first.kept': { text: '先の戦では、主の隊の退き口を守っていただいた。', reading: 'さきのいくさでは、あるじの隊の、のきぐちを守っていただいた。' },
    'ch2.asai_envoy.first.broken': { text: '約束の退き口は守られなんだ。されど頼れるのは徳川殿だけ。', reading: 'やくそくの、のきぐちは守られなんだ。されど、頼れるのは、とくがわどのだけ。' },
    'ch2.asai_envoy.first.declined': { text: '先の頼みのことは、それはそれと主も申しております。', reading: 'さきのたのみのことは、それはそれと、あるじも申しております。' },
    'ch2.asai_envoy.mission': { text: '丘の上の者たちを、どうか救っていただきたい。', reading: 'おかの上のものたちを、どうか救っていただきたい。' },
    'ch2.village.first.victory': { text: '先には浪人どもを追い払っていただきました。', reading: 'さきには、ろうにんどもを追い払っていただきました。' },
    'ch2.village.first.other': { text: '浪人どもが、また村へ来ると噂しております。', reading: 'ろうにんどもが、また村へ来ると、うわさしております。' },
    'ch2.village.mission': { text: '村の者だけでは守れませぬ。どうかお助けを。', reading: 'むらのものだけでは守れませぬ。どうか、おたすけを。' },
    'ch2.tadakatsu.council': { text: '軍議を開きましょう。城門の前でお待ちします。', reading: 'ぐんぎを開きましょう。じょうもんの前でお待ちします。' },
    'talk.hero.same_day': { text: '両家から、同じ日にか。', reading: 'りょうけから、おなじ日にか。' },
    'talk.tadakatsu.again': { text: '皆、陣幕の内に控えております。軍議を開かれますか。', reading: 'みな、じんまくのうちに控えております。ぐんぎを開かれますか。' },
    'depart.hero': { text: '皆の者、出陣じゃ。', reading: 'みなのもの、しゅつじんじゃ。' },
    'battle.retreat': { text: '退け。兵をまとめて引くぞ。', reading: 'ひけ。へいをまとめて引くぞ。' },
    'battle.ability.ieyasu_rally': { text: '崩れるな。立て直せ。', reading: 'くずれるな。立て直せ。' },
    'battle.ability.tadakatsu_rearguard': { text: '退く者は、拙者が守る。', reading: 'ひくものは、せっしゃが守る。' },
    'battle.ability.nagamasa_support': { text: '徳川殿の隊を支えよ。', reading: 'とくがわどのの隊を、ささえよ。' },
    'battle.ability.sakai_flank': { text: '両翼、押し出せ。', reading: 'りょうよく、押し出せ。' },
    'battle.ability.ishikawa_reserve': { text: '後詰め、前へ。', reading: 'ごづめ、前へ。' },
    'battle.ability.sakakibara_vanguard': { text: '先駆けいたす。', reading: 'さきがけ、いたす。' },
};

/** 台詞の読み（読みが表の今の文に対して書いてあればそれ、無ければ辞書で開いた文） */
export function readingFor(line: { id: string; text: string }): string {
    const r = READINGS[line.id];
    if (r && r.text === line.text) return r.reading;
    return autoReading(line.text);
}

/** 話し手ごとの声の高さ（pitch 0〜2、1 が端末の既定）・速さ（rate。1 が既定） */
export interface VoiceProfile {
    pitch: number;
    rate: number;
}
export const PROFILES: Readonly<Record<string, VoiceProfile>> = {
    hero: { pitch: 0.92, rate: 1.0 },
    tadakatsu: { pitch: 0.72, rate: 1.04 },
    sakai: { pitch: 0.84, rate: 0.96 },
    ishikawa: { pitch: 0.98, rate: 0.94 },
    sakakibara: { pitch: 1.04, rate: 1.06 },
    nagamasa: { pitch: 1.08, rate: 1.0 },
    oda_envoy: { pitch: 1.1, rate: 1.06 },
    asai_envoy: { pitch: 0.96, rate: 1.02 },
    village: { pitch: 1.2, rate: 1.1 },
};
export const DEFAULT_PROFILE: VoiceProfile = { pitch: 1, rate: 1 };

export function profileOf(speaker: string): VoiceProfile {
    return PROFILES[speaker] ?? DEFAULT_PROFILE;
}
