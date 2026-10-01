/**
 * 戦場「水田」（paddy）。水を張った田の間を、細い街道と畦道が通る。孤立した味方の荷駄隊を、南の退き口まで退かせる（撤退支援）。
 *
 * - 420 m × 400 m。南北の街道（x -6〜6）と、東西の畦道 2 本（z -128〜-118 の北の畦道、z -6〜6 の中の畦道）。どれも道（動き ×1.2）。
 *   その間は水田（4 区画）：動き 槍・本陣 ×0.3・騎馬 ×0.2・弓 ×0.35（部隊の種類ごとの補正。地形の決まり paddy の kindSpeed）、
 *   中で斬り合うと与える損害 ×0.85・受ける損害 ×1.1。北の畦道より北と、z 120 より南は乾いた原。
 * - 味方の荷駄隊（徳川荷駄隊。槍の扱い・兵 220・士気 60）は北西（-160,-123）の畦道の上に孤立している。街道へ出て南へ下り、
 *   南の退き口（救出の地点。中心 (0,185)、半径 35 m）に着くか、撤退の命令で戦場を離れれば果たす。
 * - 敵勢は北に本陣。騎馬（一）は始めから北の畦道と街道の交わりを押さえに走り（assault）、騎馬（二）は 30 秒から中の畦道の交わりへ、
 *   槍 2 隊が 40 秒から街道を南へ攻め下る。
 *   北西の隅の乾いた原に見張り（近づいた相手にだけ当たる）。
 * - 主目標：荷駄隊を南の退き口まで無事に退かせる（崩れたら負け）。副目標：敵勢の騎馬（一）を崩す・損害を 4 割以内に抑える。
 *
 * 地形に合った作戦（設計 docs/fields-group2-design.md §4）：
 * - 荷駄隊はすぐ畦道を東へ、街道を南へ退かせる。街道の交わり（中の畦道）を槍で押さえて追っ手を止め、
 *   別の隊が水田を横切って（遅いが）街道の追っ手の横を突く。
 * - 街道だけで押し合うと、細い街道に部隊が詰まり、追っ手の騎馬に荷駄隊が追いつかれる。
 *
 * 武将との相性：榊原の先駆けの号は街道では速いが、水田の中では動きの補正（騎馬 ×0.2）をそのまま受ける。
 * 忠勝の退路の守護は、街道を退く荷駄隊の殿で追っ手を引きつける。
 *
 * 最初の案（第2群の 5 戦場の制作。動いて決着がつくこと・作戦で結果が変わることまで。釣り合いは後で整える）。
 */
import type { BattlefieldDef, PresetUnit } from './types';
import { E, T } from './roster';

const N = 0;
const S = Math.PI;

/** 孤立した荷駄隊（救出の対象） */
const KONIDA: PresetUnit = { id: 'a_konida', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '徳川荷駄隊', strength: 220, morale: 60, slot: 'konida' };

export const PADDY: BattlefieldDef = {
    id: 'paddy',
    name: '水田',
    kind: 'paddy',
    summary: '水田の間の細い街道。孤立した荷駄隊を退かせる。街道を押さえ、田を横切って追っ手の横を突く',
    width: 420,
    depth: 400,
    terrain: [
        // 街道と畦道（道）
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -200, z1: 200 } },
        { kind: 'road', rect: { x0: -210, x1: 210, z0: -128, z1: -118 } },
        { kind: 'road', rect: { x0: -210, x1: 210, z0: -6, z1: 6 } },
        // 水田（街道・畦道に重ねない）
        { kind: 'paddy', rect: { x0: -210, x1: -6, z0: -118, z1: -6 } },
        { kind: 'paddy', rect: { x0: 6, x1: 210, z0: -118, z1: -6 } },
        { kind: 'paddy', rect: { x0: -210, x1: -6, z0: 6, z1: 120 } },
        { kind: 'paddy', rect: { x0: 6, x1: 210, z0: 6, z1: 120 } },
        { kind: 'woods', rect: { x0: 140, x1: 210, z0: 140, z1: 200 } },
    ],
    // 川・崖は無いが、部隊が街道・畦道を選んで進むように道探しを使う（水田をまっすぐ横切るより道を回る方が早い所では道を通る）
    pathfinding: true,
    deployments: {
        ally: [
            { id: 'hq', x: 0, z: 175, facing: N, note: '本陣' },
            { id: 'road', x: 0, z: 135, facing: N, note: '街道の南の口' },
            { id: 'left', x: -70, z: 140, facing: N, note: '左（西の水田の南）' },
            { id: 'right', x: 70, z: 140, facing: N, note: '右（東の水田の南）' },
            { id: 'archers', x: -30, z: 150, facing: N, note: '弓' },
            { id: 'reserve', x: 35, z: 165, facing: N, note: '予備' },
            { id: 'konida', x: -160, z: -123, facing: S, note: '孤立した荷駄隊（北西の畦道）' },
        ],
        enemy: [
            { id: 'hq', x: 60, z: -180, facing: S, note: '本陣' },
            { id: 'kiba1', x: 90, z: -155, facing: S, note: '追っ手の騎馬（一）（北の畦道と街道の交わりを押さえる）' },
            { id: 'kiba2', x: 160, z: -170, facing: S, note: '追っ手の騎馬（二）' },
            { id: 'yari1', x: 20, z: -165, facing: S, note: '攻め下る槍（一）' },
            { id: 'yari2', x: -20, z: -175, facing: S, note: '攻め下る槍（二）' },
            { id: 'watch', x: -185, z: -180, facing: S, note: '北西の見張り' },
            { id: 'yumi', x: 50, z: -145, facing: S, note: '弓' },
        ],
    },
    exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } },
    objectives: {
        primary: { id: 'paddy_rescue', type: 'rescue', label: '荷駄隊を南の退き口まで退かせる', unitId: 'a_konida', zone: { circle: { cx: 0, cz: 185, r: 35 } } },
        secondary: [
            { id: 'paddy_kiba', type: 'break_unit', label: '敵勢の騎馬（一）を崩す', unitId: 'e_kiba1' },
            { id: 'paddy_losses', type: 'limit_losses', label: '損害を 4 割以内に抑える', maxRatio: 0.4 },
        ],
    },
    // 武将の基本方針による自由な動き（命令を受けていない待機中だけ。演習の戦場だけ入れる）
    generalInitiative: true,
    timeLimitSec: 420,
    briefing: [
        'ゲーム用の演習（架空の相手）。水を張った田の間を、南北の街道と東西の畦道（北・中）が通る。街道・畦道は速いが細い。',
        '水田の中は動きがとても遅い（槍・本陣 ×0.3・騎馬 ×0.2・弓 ×0.35）。中で斬り合うと与える損害 ×0.85・受ける損害 ×1.1。ただし田を横切れば街道の横へ回れる。',
        '味方の荷駄隊が北西の畦道に孤立している。敵勢の騎馬（一）は始めから北の畦道と街道の交わりを塞ぎに走る。騎馬（二）は 30 秒から中の交わりへ、槍 2 隊は 40 秒から街道を南へ攻め下る。',
        '勝利：荷駄隊を南の退き口（救出の地点）まで退かせる（撤退の命令で戦場を離れてもよい）。荷駄隊が崩れたら負け。',
        '副目標：敵勢の騎馬（一）を崩す・味方の兵の損害を 4 割以内に抑える。',
    ],
    tactics: [
        '荷駄隊はすぐ畦道を東へ、街道へ出たら南へ退かせる（撤退の命令でもよい）',
        '中の畦道と街道の交わりを槍で押さえて追っ手を止め、別の隊を水田に入れて街道の追っ手の横を突く（遅いので早めに動かす）',
        '街道に部隊を並べて押し合わない（細い街道で詰まり、荷駄隊が追いつかれる）。忠勝の退路の守護は、退く荷駄隊の殿に使う',
    ],
    presets: [
        {
            id: 'standard',
            name: '荷駄の救い',
            summary: '味方 7（荷駄隊を含む）／敵 7。家康・本多忠勝・榊原康政（騎馬）・酒井忠次・石川数正と、徳川弓隊・徳川荷駄隊',
            units: [
                T.ieyasu('hq'),
                T.tadakatsu('road'),
                T.sakakibara('right', 'kiba', 300),
                T.sakai('left'),
                T.ishikawa('reserve'),
                T.yumi('archers'),
                KONIDA,
                E('e_hq', 'honjin', '敵勢の本陣', 350, 85, 'hq', { aiRole: 'guard_hq' }),
                // 追っ手の騎馬（一）：北の畦道と街道の交わりへ走って押さえる（荷駄隊の退き道を塞ぐ）
                E('e_kiba1', 'kiba', '敵勢の騎馬（一）', 280, 80, 'kiba1', { aiRole: 'assault', aiTarget: { x: 0, z: -123, r: 30 } }),
                E('e_kiba2', 'kiba', '敵勢の騎馬（二）', 250, 75, 'kiba2', { aiRole: 'assault', aiTarget: { x: 0, z: 40, r: 30 }, arriveAt: 30 }),
                E('e_yari1', 'yari', '敵勢の槍（一）', 400, 75, 'yari1', { aiRole: 'assault', aiTarget: { x: 0, z: 135, r: 30 }, arriveAt: 40 }),
                E('e_yari2', 'yari', '敵勢の槍（二）', 380, 75, 'yari2', { aiRole: 'assault', aiTarget: { x: 0, z: 60, r: 30 }, arriveAt: 50 }),
                E('e_watch', 'yari', '敵勢の見張り', 250, 70, 'watch', { aiRole: 'hold_zone', aiTarget: { x: -185, z: -180, r: 25 } }),
                E('e_yumi', 'yumi', '敵勢の弓', 220, 70, 'yumi', { aiRole: 'hold_line' }),
            ],
        },
    ],
};
