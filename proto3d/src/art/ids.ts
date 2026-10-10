/**
 * 生成イラスト素材（Version 22 から）の素材の ID と、どこで何を使うかの対応（差し替え先はここ 1 か所）。
 * 素材の中身・寸法・作り方の記録は proto3d/assets-src/art-v22/manifest.json（原画の一覧）と、
 * そこから proto3d/tools/art-build.py が作る manifest.gen.json（ゲームが読む一覧）にある。
 *
 * 人物画は「登場人物の id」で引く（3D の見た目の id では引かない：同じ見た目を別の人物が使い回しているため）。
 * 絵の無い人物には、ほかの人の顔を代わりに使わない（酒井忠次・本多忠勝・榊原康政を取り違えない）。
 *
 * Version 25 から：portrait.<武将>・face.<武将> は素材パック sengoku_individual_art_v2（1 人ずつ単独に生成した 1024×1536 の人物画）の物で、
 * 顔は立ち絵と同じ原画から切り出す。bg.council は同じパックの昼の軍議所（原寸 1664×936）。
 * 立ち絵（portrait.<武将>）は会話・軍議で話す 4 人（家康・忠勝・酒井・石川）だけ。榊原康政・浅井長政は今の台本で話さないので、
 * 立ち絵は公開しない（原画は顔の元としてだけ記録：正本の記録の sourceOnly）。顔は 6 人とも（合戦の札・能力の欄・編成の表）。
 * Version 24 までの顔（素材パック sengoku_art_pack_v1 から切り出した物）は face.pack1.<武将> に名前を変えて残し、
 * Version 24 と比べる表示でだけ使う（V24_FACE_OF）。第 1 版の人物画は低解像度のため不採用のままで、ID も無い（原画の記録だけ）。
 */
import type { GeneralId } from '../battle/generals';

export const ART_IDS = {
    portraitIeyasu: 'portrait.ieyasu',
    portraitTadakatsu: 'portrait.tadakatsu',
    portraitSakai: 'portrait.sakai',
    portraitIshikawa: 'portrait.ishikawa',
    faceIeyasu: 'face.ieyasu',
    faceTadakatsu: 'face.tadakatsu',
    faceSakai: 'face.sakai',
    faceIshikawa: 'face.ishikawa',
    faceSakakibara: 'face.sakakibara',
    faceNagamasa: 'face.nagamasa',
    // Version 24 までの顔（素材パック第 1 版から切り出し。ファイルも中身も Version 24 と同じ）。Version 24 と比べる表示だけで使う
    facePack1Ieyasu: 'face.pack1.ieyasu',
    facePack1Tadakatsu: 'face.pack1.tadakatsu',
    facePack1Sakai: 'face.pack1.sakai',
    facePack1Ishikawa: 'face.pack1.ishikawa',
    facePack1Sakakibara: 'face.pack1.sakakibara',
    facePack1Nagamasa: 'face.pack1.nagamasa',
    bgCouncil: 'bg.council',
    bgCouncilFront: 'bg.council.front',
    plainsGrass: 'tex.plains.grass',
    plainsDirt: 'tex.plains.dirt',
    plainsRoad: 'tex.plains.road',
    plainsForest: 'tex.plains.forest',
} as const;

export type ArtId = (typeof ART_IDS)[keyof typeof ART_IDS];

/**
 * 歴史分岐の登場人物 → 人物画（無い人物は名前だけ）。キーは合戦の武将の id と同じ。
 * 会話・軍議で話す 4 人だけ（榊原康政・浅井長政は話さないので公開しない。話し手になった行は人物画を出さず、本人の顔だけ。ほかの人の絵を代わりに使わない）
 */
export const PORTRAIT_OF: Readonly<Partial<Record<GeneralId, ArtId>>> = {
    ieyasu: ART_IDS.portraitIeyasu,
    tadakatsu: ART_IDS.portraitTadakatsu,
    sakai: ART_IDS.portraitSakai,
    ishikawa: ART_IDS.portraitIshikawa,
};

/**
 * 武将 → 顔（会話・軍議の台詞の枠、合戦の部隊情報・能力表示・編成）。無い武将は顔を出さない。
 * 素材パックの織田信長・朝倉義景の絵は、画面に登場する人物・部隊が無いので使わない（予約。画像のために部隊や出来事を足さない）。
 * Version 25 から、顔は立ち絵（PORTRAIT_OF）と同じ原画（素材パック sengoku_individual_art_v2）から切り出した物
 */
export const FACE_OF: Readonly<Partial<Record<GeneralId, ArtId>>> = {
    ieyasu: ART_IDS.faceIeyasu,
    tadakatsu: ART_IDS.faceTadakatsu,
    sakai: ART_IDS.faceSakai,
    ishikawa: ART_IDS.faceIshikawa,
    sakakibara: ART_IDS.faceSakakibara,
    nagamasa: ART_IDS.faceNagamasa,
};

/**
 * Version 24 の顔（素材パック sengoku_art_pack_v1 から切り出した物。ファイル art/faces/<武将>.webp も中身も Version 24 と同じ）。
 * Version 24 の表示を再現して比べるときだけ使う（そのときは人物画・軍議の背景は使わない：Version 24 には無かった）。
 * キーは FACE_OF と同じ 6 人。ほかの人の顔を代わりに使わない
 */
export const V24_FACE_OF: Readonly<Partial<Record<GeneralId, ArtId>>> = {
    ieyasu: ART_IDS.facePack1Ieyasu,
    tadakatsu: ART_IDS.facePack1Tadakatsu,
    sakai: ART_IDS.facePack1Sakai,
    ishikawa: ART_IDS.facePack1Ishikawa,
    sakakibara: ART_IDS.facePack1Sakakibara,
    nagamasa: ART_IDS.facePack1Nagamasa,
};

/**
 * 地面の素材の種類（Version 23 から素材ごとに採用・フォールバック）。grass＝草地・dirt＝草地の中の土のむら・road＝道・forest＝林の地面（林床）
 */
export type GroundMaterial = 'grass' | 'dirt' | 'road' | 'forest';
export const GROUND_MATERIALS: readonly GroundMaterial[] = ['grass', 'dirt', 'road', 'forest'];

/**
 * 戦場ごとの地面の素材（まだ大平原だけ。ほかの戦場は今までの色の地面）。どの種類も無くてよい：
 * 素材の一覧（manifest.gen.json）に無い・読めない・URL の ?artOff= で外した種類は、その種類だけ Version 21 の色で描く（battle/groundArt.ts）。
 * 林床（forest）は 2026-10-09 の判断で不採用（素材パックの林床は焼き込まれた木漏れ日が縞に見える）。一覧に載らないので、林は Version 21 の色のまま。
 * 新しい林床の原画が届いて確認済みになれば、ここは変えずに使われる
 */
export type FieldArt = Readonly<Partial<Record<GroundMaterial, ArtId>>>;
export const FIELD_ART: Readonly<Record<string, FieldArt>> = {
    plains: { grass: ART_IDS.plainsGrass, dirt: ART_IDS.plainsDirt, road: ART_IDS.plainsRoad, forest: ART_IDS.plainsForest },
};
