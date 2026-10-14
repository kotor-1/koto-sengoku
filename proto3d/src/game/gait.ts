/**
 * 歩き・走りの動きの元の決まり（Version 28）。人物の GLB の動き（Idle / Walk / Run）は proto3d/assets-src/hero_v2/hero_motion.py で作り、
 * proto3d/assets-src/hero_v2/write_clips.py で GLB に入れた（hero_v2b.glb・hero_v3b_mpfb.glb）。ここの値はその GAITS と同じ（GLB の extras にもある。
 * tests/proto3d-gait.test.ts が GLB と照らし合わせる）。
 * - 位相 0 = 左の踵が着いた瞬間、0.5 = 右の踵が着いた瞬間（歩き・走りとも。足音もこの位相で鳴らす）。
 * - stride：1 周期（2 歩）で進む距離。ゲームは位相を「実際に進んだ距離 ÷ stride」で進める（足が地面の上で滑らない）。
 * - duty：片足が地面に着いている割合（歩き 0.60 は両足が着く間がある、走り 0.38 は両足が浮く間がある）。
 */
export const GAIT = {
    walk: { cycle: 0.84, speed: 1.55, stride: 1.55 * 0.84, duty: 0.6 },
    run: { cycle: 0.64, speed: 3.41, stride: 3.41 * 0.64, duty: 0.38 },
} as const;

/** 歩きと走りを混ぜた割合 run（0〜1）での 1 周期の距離 */
export function strideFor(run: number): number {
    return GAIT.walk.stride + (GAIT.run.stride - GAIT.walk.stride) * Math.max(0, Math.min(1, run));
}

/** 歩きと走りを混ぜた割合 run での、片足が着いている割合 */
export function dutyFor(run: number): number {
    return GAIT.walk.duty + (GAIT.run.duty - GAIT.walk.duty) * Math.max(0, Math.min(1, run));
}

/**
 * 歩きと走りを混ぜる割合（速さから）。歩きの上限の少し上から走りの 7 割の速さまでで混ぜる。
 * 実際に進んだ速さ（壁に沿って滑る間は遅い）を渡す。
 */
export function runBlendFor(speed: number, walk: number, run: number): number {
    const a = walk * 1.02;
    const b = walk + (run - walk) * 0.7;
    const t = Math.max(0, Math.min(1, (speed - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
