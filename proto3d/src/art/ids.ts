/**
 * 生成イラスト素材（Version 22）の素材の ID と、どこで何を使うかの対応（差し替え先はここ 1 か所）。
 * 素材の中身・寸法・作り方の記録は proto3d/assets-src/art-v22/manifest.json（原画の一覧）と、
 * そこから proto3d/tools/art-build.py が作る manifest.gen.json（ゲームが読む一覧）にある。
 *
 * 人物画は「登場人物の id」で引く（3D の見た目の id では引かない：同じ見た目を別の人物が使い回しているため）。
 * 絵の無い人物には、ほかの人の顔を代わりに使わない（酒井忠次・本多忠勝・榊原康政を取り違えない）。
 */
import type { GeneralId } from '../battle/generals';

export const ART_IDS = {
    portraitIeyasu: 'portrait.ieyasu',
    portraitTadakatsu: 'portrait.tadakatsu',
    portraitSakai: 'portrait.sakai',
    portraitIshikawa: 'portrait.ishikawa',
    portraitSakakibara: 'portrait.sakakibara',
    portraitNagamasa: 'portrait.nagamasa',
    faceIeyasu: 'face.ieyasu',
    faceTadakatsu: 'face.tadakatsu',
    faceSakai: 'face.sakai',
    faceIshikawa: 'face.ishikawa',
    faceSakakibara: 'face.sakakibara',
    faceNagamasa: 'face.nagamasa',
    bgCouncil: 'bg.council',
    bgCouncilFront: 'bg.council.front',
    plainsGrass: 'tex.plains.grass',
    plainsDirt: 'tex.plains.dirt',
    plainsRoad: 'tex.plains.road',
    plainsForest: 'tex.plains.forest',
} as const;

export type ArtId = (typeof ART_IDS)[keyof typeof ART_IDS];

/** 歴史分岐の登場人物 → 人物画（無い人物は名前だけ）。キーは合戦の武将の id と同じ */
export const PORTRAIT_OF: Readonly<Partial<Record<GeneralId, ArtId>>> = {
    ieyasu: ART_IDS.portraitIeyasu,
    tadakatsu: ART_IDS.portraitTadakatsu,
    sakai: ART_IDS.portraitSakai,
    ishikawa: ART_IDS.portraitIshikawa,
    sakakibara: ART_IDS.portraitSakakibara,
    nagamasa: ART_IDS.portraitNagamasa,
};

/**
 * 武将 → 顔（会話・軍議の台詞の枠、合戦の部隊情報・能力表示・編成）。無い武将は顔を出さない。
 * 素材パック sengoku_art_pack_v1 の織田信長・朝倉義景の絵は、画面に登場する人物・部隊が無いので使わない
 * （画像のために部隊や出来事を足さない）
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
