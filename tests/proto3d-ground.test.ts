import { describe, expect, it } from 'vitest';
import { START, groundY } from '../proto3d/src/layout';

describe('3D 比較版：地面の高さ', () => {
    it('道の起伏は数 cm の範囲で、足の置き場所が極端にずれない', () => {
        for (let z = -11; z <= 15; z += 0.5) {
            for (let x = -3; x <= 3; x += 0.5) {
                const y = groundY(x, z);
                expect(Math.abs(y)).toBeLessThan(0.1);
            }
        }
    });
    it('始めの位置はほぼ 0、格子の外は 0', () => {
        expect(Math.abs(groundY(START.x, START.z))).toBeLessThan(0.03);
        expect(groundY(500, 500)).toBe(0);
    });
    it('格子の間はなめらか（0.1 m 動いて 2 cm 以上跳ばない）', () => {
        for (let z = -11; z <= 15; z += 0.1) {
            expect(Math.abs(groundY(0.3, z + 0.1) - groundY(0.3, z))).toBeLessThan(0.02);
        }
    });
});
