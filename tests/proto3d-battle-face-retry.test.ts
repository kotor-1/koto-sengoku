/**
 * 合戦の武将の顔（battle/faceArt.ts）：読めなかった顔を覚えたままにしない（次に呼ばれたら、登録の読み込みにもう一度頼む）。
 * 読めた顔は 1 回だけ読む（同じ ID を重ねて読まない）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadArtBitmap = vi.fn();
vi.mock('../proto3d/src/art/registry', () => ({
    artMode: () => 'new',
    loadArtBitmap: (id: string) => loadArtBitmap(id),
}));

describe('合戦の顔：読めなかった顔は覚えない', () => {
    beforeEach(() => {
        vi.resetModules();
        loadArtBitmap.mockReset();
    });

    it('1 回目に読めなければ、2 回目にもう一度読みに行き、読めたら覚える', async () => {
        const { loadFace, peekFace } = await import('../proto3d/src/battle/faceArt');
        const bmp = { width: 256, height: 256 } as unknown as ImageBitmap;
        loadArtBitmap.mockResolvedValueOnce(null).mockResolvedValueOnce(bmp);
        expect(await loadFace('face.ieyasu')).toBeNull();
        expect(peekFace('face.ieyasu')).toBeNull();
        expect(await loadFace('face.ieyasu')).toBe(bmp);
        expect(peekFace('face.ieyasu')).toBe(bmp);
        // 読めた後は読み直さない
        expect(await loadFace('face.ieyasu')).toBe(bmp);
        expect(loadArtBitmap).toHaveBeenCalledTimes(2);
    });

    it('読んでいる途中に重ねて呼んでも 1 回だけ読む', async () => {
        const { loadFace } = await import('../proto3d/src/battle/faceArt');
        const bmp = { width: 256, height: 256 } as unknown as ImageBitmap;
        loadArtBitmap.mockResolvedValue(bmp);
        const [a, b] = await Promise.all([loadFace('face.tadakatsu'), loadFace('face.tadakatsu')]);
        expect(a).toBe(bmp);
        expect(b).toBe(bmp);
        expect(loadArtBitmap).toHaveBeenCalledTimes(1);
    });
});
