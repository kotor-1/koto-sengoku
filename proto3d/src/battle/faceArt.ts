/**
 * 合戦の武将の顔（Version 22。art/ids.ts の FACE_OF：素材の届いた武将だけ。ほかの人の顔で代用しない）。部隊の札・能力の欄・発動の知らせ・演習の編成の表で使う。
 *
 * - 画像は art/registry.ts の loadArtBitmap（fetch → createImageBitmap）だけで読み、<canvas class="b-face" data-art-id> に描く
 *   （<img>・CSS の背景・data: の URL は使わない）。canvas は 1 度描けば、置き場所を移しても描き直さない（毎秒作り直す欄の中でもちらつかない）。
 * - 旧表示（?art=old）・一覧に無い・読めないときは何も作らない（Version 21 と同じ画面。代わりの絵は描かない）。
 * - ほかの武将（酒井・石川・榊原・長政・主人公など）には顔を出さない（この二人の顔で代用しない）。
 * - 名前・数字は画像にしない（今までどおりの文字）。顔は飾りで、押せない・読み上げない（aria-hidden）。
 */
import { FACE_OF, type ArtId } from '../art/ids';
import { artMode, loadArtBitmap } from '../art/registry';
import type { GeneralId } from './generals';

/** canvas の画素の大きさ（CSS では 14〜40 px で出す。端末の画素の比 2 まで細かく見える大きさ） */
const FACE_PX = 96;

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
    const g = c.getContext('2d');
    if (g) {
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        // 正方形に切り出して描く（縦横の比は保つ。顔の素材は正方形）
        const s = Math.min(bmp.width, bmp.height);
        g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, FACE_PX, FACE_PX);
    }
    return c;
}

/**
 * 武将の顔を、読めたら parent の先頭に置く（読めなければ何もしない）。isLive が false になっていたら置かない（画面を閉じた後）
 */
export function attachFaceWhenReady(generalId: string | null | undefined, parent: HTMLElement, isLive: () => boolean, cls = ''): void {
    const id = faceIdOf(generalId);
    if (!id) return;
    void loadFace(id).then((bmp) => {
        if (!bmp || !isLive()) return;
        const c = faceCanvas(id, bmp);
        if (cls) c.classList.add(cls);
        parent.prepend(c);
    });
}
