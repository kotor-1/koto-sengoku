/**
 * 生成イラスト素材（Version 22）の素材の ID と、どこで何を使うかの対応（差し替え先はここ 1 か所）。
 * 素材の中身・寸法・作り方の記録は proto3d/assets-src/art-v22/manifest.json（原画の一覧）と、
 * そこから proto3d/tools/art-build.py が作る manifest.gen.json（ゲームが読む一覧）にある。
 *
 * 人物画は「登場人物の id」で引く（3D の見た目の id では引かない：同じ見た目を別の人物が使い回しているため）。
 * ほかの武将（酒井・石川・榊原・長政など）には、この二人の顔を代わりに使わない。
 */
import type { GeneralId } from '../battle/generals';

export const ART_IDS = {
    portraitIeyasu: 'portrait.ieyasu',
    portraitTadakatsu: 'portrait.tadakatsu',
    faceIeyasu: 'face.ieyasu',
    faceTadakatsu: 'face.tadakatsu',
    bgCouncil: 'bg.council',
    bgCouncilFront: 'bg.council.front',
    plainsGrass: 'tex.plains.grass',
    plainsDirt: 'tex.plains.dirt',
    plainsRoad: 'tex.plains.road',
    plainsForest: 'tex.plains.forest',
} as const;

export type ArtId = (typeof ART_IDS)[keyof typeof ART_IDS];

/** 歴史分岐の登場人物 → 会話の人物画（無い人物は名前だけ） */
export const PORTRAIT_OF: Readonly<Record<string, ArtId>> = {
    ieyasu: ART_IDS.portraitIeyasu,
    tadakatsu: ART_IDS.portraitTadakatsu,
};

/** 合戦の武将 → 顔（部隊情報・能力表示・編成）。無い武将は顔を出さない */
export const FACE_OF: Readonly<Partial<Record<GeneralId, ArtId>>> = {
    ieyasu: ART_IDS.faceIeyasu,
    tadakatsu: ART_IDS.faceTadakatsu,
};

/** 戦場ごとの地面の素材（まだ大平原だけ。ほかの戦場は今までの色の地面） */
export interface FieldArt {
    grass: ArtId;
    dirt: ArtId;
    road: ArtId;
    forest: ArtId;
}
export const FIELD_ART: Readonly<Record<string, FieldArt>> = {
    plains: { grass: ART_IDS.plainsGrass, dirt: ART_IDS.plainsDirt, road: ART_IDS.plainsRoad, forest: ART_IDS.plainsForest },
};
