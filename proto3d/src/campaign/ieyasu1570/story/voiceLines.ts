/**
 * 声を付ける短い台詞の表（歴史分岐「元亀元年・家康」）。docs/v20-feedback-request.md【3】。
 *
 * - 表示の文（text）と話し手の id（speaker）を 1 か所にそろえる。音にする側（proto3d/src/audio/）は id で音を引く。
 *   読み（音声用のかな）は音の側が id ごとに持つ（表示の漢字と分けて管理する）。
 * - 演出の字幕は、この表の文をそのまま使い、字幕に voice（id）を付ける（cinematics.ts の voiceCap）。
 * - 会話の行（ScenarioLine）は findVoiceLine(行の speaker, 行の text) で id を引ける（文が表と同じ行だけ声が付く）。
 * - 合戦の短い掛け声（撤退・能力の発動）は、合戦の側に今は字幕が無い。声を流すときは、この表の文を字幕（知らせ）として同時に出す。
 * - 全会話の読み上げはしない。ここに載せるのは冒頭の使者・主要人物の短い返答・出陣・撤退・能力の発動だけ。
 * - 新しい史実・逸話は足さない（今のシナリオの言葉と、能力の名前の言い換えだけ）。特定の俳優・作品の言い回しをまねない。
 */
import { generalById } from '../../../battle/generals';
import { profileOf, readingFor } from '../../../audio/readings';

/** 話し手の id（会話の行の speaker と同じ id：hero は家康。村の使いは village） */
export type VoiceSpeaker = 'hero' | 'tadakatsu' | 'sakai' | 'ishikawa' | 'sakakibara' | 'nagamasa' | 'oda_envoy' | 'asai_envoy' | 'village';

/** 字幕・会話の名前の欄に出す名前（会話の行の name と同じ） */
export const VOICE_SPEAKER_NAMES: Readonly<Record<VoiceSpeaker, string>> = {
    hero: '家康',
    tadakatsu: '忠勝',
    sakai: generalById('sakai')!.name,
    ishikawa: generalById('ishikawa')!.name,
    sakakibara: generalById('sakakibara')!.name,
    nagamasa: generalById('nagamasa')!.name,
    oda_envoy: '織田家の使者',
    asai_envoy: '浅井家の使者',
    village: '村の使い',
};

/** どこで流れるか（確かめと、音の側の読み込みの単位） */
export type VoiceWhere = 'ch1_open' | 'ch2_open' | 'talk' | 'departure' | 'battle';

export interface VoiceLine {
    id: string;
    speaker: VoiceSpeaker;
    /** 表示の文（字幕・会話の行と同じ） */
    text: string;
    where: VoiceWhere;
}

const L = (id: string, speaker: VoiceSpeaker, where: VoiceWhere, text: string): VoiceLine => ({ id, speaker, text, where });

/** 声を付ける台詞（id は重ならない。文は字幕の上限 30 字まで） */
export const VOICE_LINES: readonly VoiceLine[] = [
    // ---- 第一章の冒頭（使者の短い一言・家臣とのやり取り） ----
    L('ch1.oda_envoy.ask', 'oda_envoy', 'ch1_open', '徳川殿にも、兵を出していただきたい。'),
    L('ch1.asai_envoy.ask', 'asai_envoy', 'ch1_open', '主は、徳川殿と手を結びたいと。'),
    L('ch1.tadakatsu.council', 'tadakatsu', 'ch1_open', '殿、軍議を開きましょう。城門の前でお待ちします。'),
    L('ch1.hero.gather', 'hero', 'ch1_open', 'うむ。皆を集めよ。'),
    // ---- 第二章の冒頭（使いの言葉は約束の結果で変わる。感謝は守ったときだけ） ----
    L('ch2.oda_envoy.first.kept', 'oda_envoy', 'ch2_open', '先の戦では、援軍の退路を守っていただいた。'),
    L('ch2.oda_envoy.first.broken', 'oda_envoy', 'ch2_open', '約束の退路は守られなんだ。されど手が足りぬ。'),
    L('ch2.oda_envoy.first.declined', 'oda_envoy', 'ch2_open', '頼みを断られたのは、徳川殿のお考え。'),
    L('ch2.oda_envoy.mission', 'oda_envoy', 'ch2_open', '主の本隊が近江の陣を引く。撤収をお支えくだされ。'),
    L('ch2.asai_envoy.first.kept', 'asai_envoy', 'ch2_open', '先の戦では、主の隊の退き口を守っていただいた。'),
    L('ch2.asai_envoy.first.broken', 'asai_envoy', 'ch2_open', '約束の退き口は守られなんだ。されど頼れるのは徳川殿だけ。'),
    L('ch2.asai_envoy.first.declined', 'asai_envoy', 'ch2_open', '先の頼みのことは、それはそれと主も申しております。'),
    L('ch2.asai_envoy.mission', 'asai_envoy', 'ch2_open', '丘の上の者たちを、どうか救っていただきたい。'),
    L('ch2.village.first.victory', 'village', 'ch2_open', '先には浪人どもを追い払っていただきました。'),
    L('ch2.village.first.other', 'village', 'ch2_open', '浪人どもが、また村へ来ると噂しております。'),
    L('ch2.village.mission', 'village', 'ch2_open', '村の者だけでは守れませぬ。どうかお助けを。'),
    L('ch2.tadakatsu.council', 'tadakatsu', 'ch2_open', '軍議を開きましょう。城門の前でお待ちします。'),
    // ---- 会話の短い返答（両章の会話の行と同じ文） ----
    L('talk.hero.same_day', 'hero', 'talk', '両家から、同じ日にか。'),
    L('talk.tadakatsu.again', 'tadakatsu', 'talk', '皆、陣幕の内に控えております。軍議を開かれますか。'),
    // ---- 出陣（出陣の演出の最初の字幕） ----
    L('depart.hero', 'hero', 'departure', '皆の者、出陣じゃ。'),
    // ---- 合戦（撤退の命令・能力の発動。能力の名前の言い換え。味方の武将だけ） ----
    L('battle.retreat', 'hero', 'battle', '退け。兵をまとめて引くぞ。'),
    L('battle.ability.ieyasu_rally', 'hero', 'battle', '崩れるな。立て直せ。'),
    L('battle.ability.tadakatsu_rearguard', 'tadakatsu', 'battle', '退く者は、拙者が守る。'),
    L('battle.ability.nagamasa_support', 'nagamasa', 'battle', '徳川殿の隊を支えよ。'),
    L('battle.ability.sakai_flank', 'sakai', 'battle', '両翼、押し出せ。'),
    L('battle.ability.ishikawa_reserve', 'ishikawa', 'battle', '後詰め、前へ。'),
    L('battle.ability.sakakibara_vanguard', 'sakakibara', 'battle', '先駆けいたす。'),
];

const BY_ID: ReadonlyMap<string, VoiceLine> = new Map(VOICE_LINES.map((v) => [v.id, v]));

/** id の台詞（無い id は作る側の誤りなので投げる） */
export function voiceLine(id: string): VoiceLine {
    const v = BY_ID.get(id);
    if (!v) throw new Error(`声の台詞 ${id} が表に無い`);
    return v;
}

/**
 * 話し手と表示の文から台詞を引く（会話の行・字幕から）。speaker は話し手の id（'hero' など）か、名前の欄の名前（'忠勝' など）。
 * 文が表と違えば undefined（声は付けない。字幕だけ）。
 */
export function findVoiceLine(speaker: string, text: string): VoiceLine | undefined {
    for (const v of VOICE_LINES) {
        if (v.text !== text) continue;
        if (v.speaker === speaker || VOICE_SPEAKER_NAMES[v.speaker] === speaker) return v;
    }
    return undefined;
}

/** 演出の字幕の材料（話し手の名前・表示の文・声の id） */
export function voiceCap(id: string): { speaker: string; text: string; voice: string } {
    const v = voiceLine(id);
    return { speaker: VOICE_SPEAKER_NAMES[v.speaker], text: v.text, voice: v.id };
}

// ---------------------------------------------------------------- 読み上げの長さの見積もり（字幕を声より先に替えないため）

/** 1 秒に読む拍の数（端末の読み上げの速さ 1 のとき）と、言い始め・言い終わりの余白（秒） */
export const VOICE_MORA_PER_SEC = 7;
export const VOICE_PAD_SEC = 0.8;
const SMALL_KANA = /[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/;
const KANA = /[ぁ-ゖァ-ヺー]/;
const KANJI = /[\u4e00-\u9fff々]/;

/** 読み（audio/readings.ts の音声用のかな。漢字が残っていれば 1 字 2 拍と見る）の拍の数。小さいかな・句読点は数えない */
export function moraCount(reading: string): number {
    let n = 0;
    for (const ch of reading) {
        if (SMALL_KANA.test(ch)) continue;
        if (KANA.test(ch)) n += 1;
        else if (KANJI.test(ch)) n += 2;
        else if (/[0-9０-９]/.test(ch)) n += 2;
    }
    return n;
}

/**
 * 声の台詞を読み終えるまでの見積もり（秒）：拍の数 ÷（7 × 話し手の読み上げの速さ）＋ 0.8。
 * 読みは音の側（audio/readings.ts）の物（表の文に対して書いた読みが無ければ辞書で開いた文）。速さは話し手ごとの rate。
 */
export function voiceSecFor(id: string): number {
    const v = voiceLine(id);
    const rate = Math.max(0.5, profileOf(v.speaker).rate);
    return moraCount(readingFor(v)) / (VOICE_MORA_PER_SEC * rate) + VOICE_PAD_SEC;
}
