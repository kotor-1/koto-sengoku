/**
 * 合戦の武将の顔（Version 22。art/ids.ts の FACE_OF：素材の届いた武将だけ。ほかの人の顔で代用しない）。部隊の札・能力の欄・発動の知らせ・演習の編成の表で使う。
 * Version 23：能力の欄（選んだ武将）と演習の編成の表では顔を大きく（欄 40〜60 px・表 34〜38 px。大きさは battle.css）。地図の上の名札には顔を出さない。
 *
 * - 画像は art/registry.ts の loadArtBitmap（fetch → createImageBitmap）だけで読み、<canvas class="b-face" data-art-id> に描く
 *   （<img>・CSS の背景・data: の URL は使わない）。canvas は 1 度描けば、置き場所を移しても描き直さない（毎秒作り直す欄の中でもちらつかない）。
 * - 旧表示（?art=old）・一覧に無い・読めないときは何も作らない（Version 21 と同じ画面。代わりの絵は描かない）。
 * - 顔があるのは 6 人（家康・忠勝・酒井・石川・榊原・長政）だけ（Version 25 から素材パック sengoku_individual_art_v2 の人物画から切り出した顔。Version 24 までは sengoku_art_pack_v1）。顔の ID は武将の id から引く
 *   （酒井忠次・本多忠勝・榊原康政を取り違えない）。ほかの武将・部隊（弓隊・騎馬隊・織田援軍など）・主人公・架空の人物には顔を出さない。
 * - 部隊の札の見出しでは、顔のせいで部隊の名前が切れるなら、細い顔（両脇を切った縦長）にし、それでも切れるなら顔を出さない
 *   （fitFaceBeforeName。名前を Version 21 より短く切らない。札の大きさ・押せる所は変えない）。
 * - 名前・数字は画像にしない（今までどおりの文字）。顔は飾りで、押せない・読み上げない（aria-hidden）。
 */
import { FACE_OF, type ArtId } from '../art/ids';
import { artMode, loadArtBitmap } from '../art/registry';
import type { GeneralId } from './generals';

/** canvas の画素の大きさ（CSS では 14〜60 px で出す。端末の画素の比 2 で 64 px まで細かく見える大きさ。素材は 256 px） */
const FACE_PX = 128;

/** その武将の顔の素材の ID（旧表示・顔の無い武将は null） */
export function faceIdOf(generalId: string | null | undefined): ArtId | null {
    if (!generalId || artMode() === 'old') return null;
    return FACE_OF[generalId as GeneralId] ?? null;
}

const ready = new Map<ArtId, ImageBitmap>();
const loading = new Map<ArtId, Promise<ImageBitmap | null>>();

/** 顔を読む（同じ ID は 1 回だけ）。読めた物は peekFace ですぐ描ける。旧表示・無い・失敗は null */
export function loadFace(id: ArtId): Promise<ImageBitmap | null> {
    let p = loading.get(id);
    if (!p) {
        p = loadArtBitmap(id).then((b) => {
            if (b) ready.set(id, b);
            // 読めなかった：覚えずに外す（次に呼ばれたとき、登録の読み込みが間を空けて読み直す）
            else loading.delete(id);
            return b;
        });
        loading.set(id, p);
    }
    return p;
}

/** もう読めている顔（まだ・無い・失敗は null） */
export function peekFace(id: ArtId): ImageBitmap | null {
    return ready.get(id) ?? null;
}

/** 顔の canvas（class b-face・data-art-id）を作って描く。大きさは CSS で決める */
export function faceCanvas(id: ArtId, bmp: ImageBitmap): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.className = 'b-face';
    c.dataset.artId = id;
    c.setAttribute('aria-hidden', 'true');
    c.draggable = false;
    c.width = c.height = FACE_PX;
    drawFace(c, bmp);
    return c;
}

/** 顔を canvas に描く（正方形に切り出す。縦横の比は保つ。顔の素材は正方形） */
function drawFace(c: HTMLCanvasElement, bmp: ImageBitmap): void {
    const g = c.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const s = Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, FACE_PX, FACE_PX);
}

/**
 * 武将の顔を、読めたら parent の先頭に置く（読めなければ何もしない）。isLive が false になっていたら置かない（画面を閉じた後）。
 * 置いた canvas を返す（置かなかったら null）
 */
export function attachFaceWhenReady(generalId: string | null | undefined, parent: HTMLElement, isLive: () => boolean, cls = ''): Promise<HTMLCanvasElement | null> {
    const id = faceIdOf(generalId);
    if (!id) return Promise.resolve(null);
    return loadFace(id).then((bmp) => {
        if (!bmp || !isLive()) return null;
        const c = faceCanvas(id, bmp);
        if (cls) c.classList.add(cls);
        parent.prepend(c);
        return c;
    });
}

/**
 * 顔の置き場を先に取る（演習の編成の表。顔が後から届いて、表の行の高さ・列の幅が後から変わらないように）。
 * 旧表示・顔の無い武将は null（何も置かない）。読めていればすぐ描いた canvas。まだなら空の canvas（class b-face-wait。data-art-id はまだ付けない）を返し、
 * 読めたら描いて data-art-id を付ける。読めなかったら場所ごと外す（文字だけの並びに戻る。ほかの人の顔は描かない）。
 * 画面を閉じた後に届いても、外れた canvas に描くだけ（何も表示しない）
 */
export function faceSlot(generalId: string | null | undefined): HTMLCanvasElement | null {
    const id = faceIdOf(generalId);
    if (!id) return null;
    const bmp = peekFace(id);
    if (bmp) return faceCanvas(id, bmp);
    const c = document.createElement('canvas');
    c.className = 'b-face b-face-wait';
    c.setAttribute('aria-hidden', 'true');
    c.draggable = false;
    c.width = c.height = FACE_PX;
    void loadFace(id).then((b) => {
        if (!b) {
            c.remove();
            return;
        }
        drawFace(c, b);
        c.dataset.artId = id;
        c.classList.remove('b-face-wait');
    });
    return c;
}

/** 名前の文字が枠に収まっているか（文字の幅 ≦ 枠の幅。切れて「…」になっていない） */
function nameFits(name: HTMLElement): boolean {
    const r = document.createRange();
    r.selectNodeContents(name);
    const text = r.getBoundingClientRect().width;
    return text <= name.getBoundingClientRect().width + 0.05;
}

export type FaceFit = 'full' | 'narrow' | 'off';

/**
 * 部隊の札の見出しの顔の大きさを決める（同じ行の名前 name が切れないように）。
 * full：今の大きさ。narrow：両脇を切った細い顔（b-face-narrow。高さはそのまま）。off：顔を出さない（b-face-off。Version 21 と同じ並び）。
 * 顔を出さなくても名前が切れる（状態の印「撤退済み」などで、Version 21 でも切れていた）ときは off（Version 21 より短く切らない）。
 * 文字の幅を測るので、札の幅・種類・状態の印が変わった時だけ呼ぶ
 */
export function fitFaceBeforeName(face: HTMLElement, name: HTMLElement): FaceFit {
    face.classList.remove('b-face-narrow', 'b-face-off');
    if (nameFits(name)) return 'full';
    face.classList.add('b-face-narrow');
    if (nameFits(name)) return 'narrow';
    face.classList.remove('b-face-narrow');
    face.classList.add('b-face-off');
    return 'off';
}
