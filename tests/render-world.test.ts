import { describe, expect, it } from 'vitest';
import { bridges, coverWithRects, grassTuftSpots, houseRects, trees, wallTiles, waterRects } from '../src/render/world/layout';
import { HeadingTracker, dirFromFacing, dirFromVector, turnStep } from '../src/render/world/heading';
import { CameraFollower } from '../src/render/world/camera';
import { ResolutionGovernor, chooseQuality, initialRenderScale } from '../src/render/world/quality';
import { PRESETS, effectiveTint, lerpColor, lerpPreset, nextTime } from '../src/render/world/lighting';
import { isSolidTile, tileAt } from '../src/core/map';

describe('layout（マップからの配置抽出）', () => {
    it('民家は 13 軒で、どれも奥行き 3 タイル', () => {
        const hs = houseRects();
        expect(hs).toHaveLength(13);
        for (const h of hs) {
            expect(h.th).toBe(3);
            expect([3, 5]).toContain(h.tw);
        }
    });

    it('水面の矩形は水のタイルだけをちょうど覆う', () => {
        const rects = waterRects();
        let area = 0;
        for (const r of rects) {
            area += r.tw * r.th;
            for (let y = r.ty; y < r.ty + r.th; y++) for (let x = r.tx; x < r.tx + r.tw; x++) expect(tileAt(x, y)).toBe('~');
        }
        const all = coverWithRects((c) => c === '~').reduce((n, r) => n + r.tw * r.th, 0);
        expect(area).toBe(all);
        expect(rects.length).toBeGreaterThanOrEqual(3);
    });

    it('橋は堀（南北）と川（東西）の 2 本', () => {
        const bs = bridges();
        expect(bs.map((b) => b.dir).sort()).toEqual(['ew', 'ns']);
    });

    it('城壁は前面の有無と向きが決まる', () => {
        const ws = wallTiles();
        expect(ws.length).toBeGreaterThan(50);
        // 南の城壁（y=13）は前面が見える
        expect(ws.filter((w) => w.ty === 13).every((w) => w.front)).toBe(true);
        // 西の城壁の途中（x=12, y=5）は縦向きで前面なし
        expect(ws.find((w) => w.tx === 12 && w.ty === 5)).toMatchObject({ horizontal: false, front: false });
    });

    it('外周の木を見分ける', () => {
        const ts = trees();
        expect(ts.some((t) => t.border)).toBe(true);
        expect(ts.some((t) => !t.border)).toBe(true);
    });

    it('草むらは草地にだけ、上限数以内で、毎回同じ配置', () => {
        const a = grassTuftSpots(100);
        expect(a).toHaveLength(100);
        expect(grassTuftSpots(100)).toEqual(a);
        for (const s of a) expect(isSolidTile(Math.floor(s.x / 16), Math.floor(s.y / 16))).toBe(false);
    });
});

describe('heading（8 方向の向き）', () => {
    it('移動ベクトルから 8 方向', () => {
        expect(dirFromVector(0, 1)).toBe(0);
        expect(dirFromVector(1, 1)).toBe(1);
        expect(dirFromVector(1, 0)).toBe(2);
        expect(dirFromVector(1, -1)).toBe(3);
        expect(dirFromVector(0, -1)).toBe(4);
        expect(dirFromVector(-1, -1)).toBe(5);
        expect(dirFromVector(-1, 0)).toBe(6);
        expect(dirFromVector(-1, 1)).toBe(7);
        expect(dirFromFacing('left')).toBe(6);
        expect(turnStep(0, 6)).toBe(-1);
        expect(turnStep(0, 2)).toBe(1);
    });

    it('斜めに歩いて止まると斜めのまま待機する', () => {
        const h = new HeadingTracker('down');
        for (let i = 0; i < 20; i++) h.update(1, -1, 1 / 60, 'right', true);
        expect(h.dir).toBe(3);
        for (let i = 0; i < 20; i++) h.update(0, 0, 1 / 60, 'right', false);
        expect(h.dir).toBe(3);
        expect(h.moving).toBe(false);
    });

    it('大きく向きを変えると間の向きを経由する', () => {
        const h = new HeadingTracker('down');
        h.update(0, -1, 1 / 60, 'up', true); // 真後ろへ
        expect(h.dir).not.toBe(4);
        for (let i = 0; i < 30; i++) h.update(0, -1, 1 / 60, 'up', true);
        expect(h.dir).toBe(4);
    });

    it('動かずに core の向きが変わったら振り向く（話しかけられた家臣など）', () => {
        const h = new HeadingTracker('left');
        for (let i = 0; i < 30; i++) h.update(0, 0, 1 / 60, 'up', false);
        expect(h.dir).toBe(4);
    });

    it('歩行コマは歩いた距離で進む', () => {
        const h = new HeadingTracker('down', 20);
        h.update(0, 5, 1 / 60, 'down', true);
        expect(h.walkFrame(8)).toBe(2);
    });

    it('境目付近の小さな揺れでは向きが変わらない', () => {
        const h = new HeadingTracker('right');
        for (let i = 0; i < 10; i++) h.update(1, 0, 1 / 60, 'right', true);
        h.update(1, 0.45, 1 / 60, 'right', true); // 約 24°
        expect(h.dir).toBe(2);
    });
});

describe('camera（追従）', () => {
    it('滑らかに近づき、行き過ぎない', () => {
        const c = new CameraFollower();
        c.snap(0, 0);
        let prev = 0;
        for (let i = 0; i < 120; i++) {
            const p = c.update(100, 0, 0, 0, 1 / 60);
            expect(p.x).toBeGreaterThanOrEqual(prev);
            expect(p.x).toBeLessThanOrEqual(100);
            prev = p.x;
        }
        expect(prev).toBeGreaterThan(99);
    });

    it('先読みは最大 10px 程度に抑える', () => {
        const c = new CameraFollower();
        c.snap(0, 0);
        let p = { x: 0, y: 0 };
        for (let i = 0; i < 600; i++) p = c.update(0, 0, 500, 0, 1 / 60);
        expect(p.x).toBeGreaterThan(5);
        expect(p.x).toBeLessThanOrEqual(10.01);
    });

    it('フレームレートが違っても同じくらいの位置になる', () => {
        const a = new CameraFollower();
        const b = new CameraFollower();
        a.snap(0, 0);
        b.snap(0, 0);
        for (let i = 0; i < 30; i++) a.update(50, 0, 0, 0, 1 / 30);
        for (let i = 0; i < 60; i++) b.update(50, 0, 0, 0, 1 / 60);
        expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    });

    it('遠くへ移ったら瞬時に合わせる', () => {
        const c = new CameraFollower();
        c.snap(0, 0);
        expect(c.update(500, 500, 0, 0, 1 / 60)).toEqual({ x: 500, y: 500 });
    });
});

describe('quality（品質と解像度）', () => {
    it('メモリやコアが少ない端末は low', () => {
        expect(chooseQuality({ devicePixelRatio: 3, deviceMemory: 2, touch: true }).tier).toBe('low');
        expect(chooseQuality({ devicePixelRatio: 2, deviceMemory: 8, hardwareConcurrency: 8, touch: false }).tier).toBe('high');
        expect(chooseQuality({ devicePixelRatio: 2, deviceMemory: 2, touch: true, forced: 'high' }).tier).toBe('high');
    });

    it('解像度は端末の倍率を上限 2 までに抑える', () => {
        const q = chooseQuality({ devicePixelRatio: 3, deviceMemory: 8, hardwareConcurrency: 8, touch: true });
        expect(initialRenderScale(q, 3)).toBe(2);
        expect(initialRenderScale(q, 1)).toBe(1);
    });

    it('遅いときだけ一段ずつ下げる（起動直後は見ない）', () => {
        const g = new ResolutionGovernor([2, 1.5, 1], 45, 1, 0.5);
        let r: number | null = null;
        for (let i = 0; i < 20; i++) r = g.sample(1 / 30, 2) ?? r; // 0.66 秒：まだ見ない〜判定前
        const fast = new ResolutionGovernor([2, 1.5, 1], 45, 1, 0.5);
        let rf: number | null = null;
        for (let i = 0; i < 200; i++) rf = fast.sample(1 / 60, 2) ?? rf;
        expect(rf).toBeNull();
        for (let i = 0; i < 60; i++) r = g.sample(1 / 30, 2) ?? r;
        expect(r).toBe(1.5);
    });
});

describe('lighting（時間帯）', () => {
    it('昼→夕→夜→昼', () => {
        expect(nextTime('day')).toBe('evening');
        expect(nextTime('night')).toBe('day');
    });

    it('補間の端は元の値と一致し、色も成分ごとに補間する', () => {
        expect(lerpPreset(PRESETS.day, PRESETS.night, 0).tintAlpha).toBe(PRESETS.day.tintAlpha);
        expect(lerpPreset(PRESETS.day, PRESETS.night, 1).tintAlpha).toBe(PRESETS.night.tintAlpha);
        expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
        expect(effectiveTint({ ...PRESETS.day, tintAlpha: 0 })).toBe(0xffffff);
    });
});
