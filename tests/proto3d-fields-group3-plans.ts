/**
 * 第3群の 5 戦場の作戦の台本（早送り。docs/fields-group3-design.md §1・§4）。tests/proto3d-fields-group3.test.ts が使う。
 * 台本は、人が画面でできる程度の命令の数・間隔にしている（「見てから押す」行は、敵が崩れた・部隊が着いたのを見てから押すのと同じ）。
 * 作戦の名前：
 * - 無計画（unplanned）：全部隊で、見えている一番近い敵へ当て直すだけ（地形を見ない）。
 * - 待つ（hold）：命令を出さない。
 * - ほかは戦場ごとの準備した作戦（地形・兵種・予備・弓を使う）。
 */
import type { BattleState } from '../proto3d/src/battle/sim';
import { atk, arrived, gone, near, route, tap, type Step } from './proto3d-group3-helpers';

const MELEE = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
/** 無計画：10 秒ごとに、見えている一番近い敵へ当て直す（全部隊。本陣は動かさない） */
export function unplanned(until: number): Step[] {
    const o: Step[] = [];
    for (const id of MELEE) for (let t = 1; t < until; t += 10) o.push([t, id, 'nearest']);
    return o;
}
/** 部隊の士気が th を切った・戦えなくなった */
const low = (id: string, th = 40) => (s: BattleState) => {
    const u = s.units.find((x) => x.id === id)!;
    return u.morale < th || u.status !== 'ready';
};

// ---------------------------------------------------------------- 湿地

const ISLES: [number, number][] = [
    [-95, 112],
    [-140, 62],
    [-160, 4],
    [-165, -52],
    [-135, -108],
    [-120, -180],
];
/** k 番目の部隊の足場の上の位置（同じ足場で重ならないように少しずらす。最後は出口に横に並べる） */
const isles = (k: number) => ISLES.map(([x, z], i) => (i === ISLES.length - 1 ? [x + k * 22 - 40, z] : [x + (k % 2) * 16 - 8, z + Math.floor(k / 2) * 16 - 8]) as [number, number]);

export const MARSH_PLANS = {
    /** 足場を伝って西から回る：槍 2・騎馬 2 が島から島へ（着いたのを見てから次の島を押す）。忠勝隊・弓も後から西へ */
    west: [
        ...route('a_sakai', isles(0)),
        ...route('a_ishikawa', isles(1)),
        ...route('a_kiba', isles(2)),
        ...route('a_sakakibara', isles(3)),
        ...route('a_tadakatsu', isles(2), 20),
        ...route('a_yumi', ISLES.slice(0, 3), 10),
    ] as Step[],
    /** 準備した土手道の攻め：弓で押さえを射つつ、忠勝隊が正面から押さえ、酒井隊は西の泥へ降りて横から、石川隊は東の足場の弓へ。押さえが崩れたら全部隊で北へ */
    causeway: [
        [0, 'a_yumi', tap(0, 62)],
        [8, 'a_yumi', atk('e_block')],
        [0, 'a_tadakatsu', tap(0, 45)],
        [0, 'a_sakai', tap(0, 75)],
        [0, 'a_ishikawa', tap(0, 100)],
        [25, 'a_sakai', tap(-22, 10)],
        [25, 'a_ishikawa', tap(22, 25)],
        [near('a_sakai', -22, 10, 8), 'a_sakai', atk('e_block')],
        [near('a_sakai', -22, 10, 8), 'a_tadakatsu', atk('e_block')],
        [near('a_ishikawa', 22, 25, 8), 'a_ishikawa', atk('e_yumi_e')],
        [0, 'a_kiba', tap(0, 125)],
        [0, 'a_sakakibara', tap(0, 145)],
        [gone('e_block'), 'a_tadakatsu', tap(30, -170)],
        [gone('e_block'), 'a_sakai', tap(-30, -170)],
        [gone('e_block'), 'a_kiba', tap(-60, -170)],
        [gone('e_block'), 'a_sakakibara', tap(0, -175)],
        [gone('e_block'), 'a_yumi', atk('e_yumi_w')],
        [gone('e_yumi_e'), 'a_ishikawa', tap(60, -165)],
    ] as Step[],
    unplanned: unplanned(600),
    hold: [] as Step[],
};

// ---------------------------------------------------------------- 村落

export const VILLAGE_PLANS = {
    /** 広場を固める：忠勝隊を屋敷前、酒井隊を西の通りの口、騎馬を東の抜け道の口、石川隊・弓を後ろ、榊原隊を南の予備に */
    plaza: [
        [0, 'a_tadakatsu', tap(0, 30)],
        [0, 'a_sakai', tap(-48, 40)],
        [0, 'a_kiba', tap(48, 40)],
        [0, 'a_ishikawa', tap(18, 52)],
        [0, 'a_yumi', tap(-18, 55)],
        [0, 'a_sakakibara', tap(30, 80)],
        [0, 'a_ieyasu', tap(0, 125)],
    ] as Step[],
    /** 通りの口を分けて受け、波を見て予備（石川隊）を回す。弓は広場の東の柵の内側から東の通りを射る */
    shift: [
        [0, 'a_tadakatsu', tap(-10, 30)],
        [0, 'a_sakai', tap(-50, 32)],
        [0, 'a_kiba', tap(52, 38)],
        [0, 'a_ishikawa', tap(18, 55)],
        [0, 'a_yumi', tap(50, 52)],
        [0, 'a_sakakibara', tap(0, 75)],
        [0, 'a_ieyasu', tap(0, 125)],
        [arrived('e_w_yari'), 'a_ishikawa', tap(-45, 50)],
        [arrived('e_e_yari1'), 'a_ishikawa', tap(40, 45)],
        [arrived('e_e_yari1'), 'a_yumi', tap(60, 4)],
    ] as Step[],
    unplanned: unplanned(480),
    hold: [] as Step[],
};

// ---------------------------------------------------------------- 寺社周辺

export const TEMPLE_PLANS = {
    /** 分けて入る：弓で山門の槍を射て、忠勝隊が石段から山門へ。榊原隊・酒井隊・騎馬は東の脇道を回って本堂前へ。押し返しが来たら石川隊・弓を山門へ */
    split: [
        [0, 'a_yumi', tap(0, 5)],
        [20, 'a_yumi', atk('e_gate')],
        [0, 'a_tadakatsu', tap(0, -12)],
        [0, 'a_ishikawa', tap(0, 20)],
        [70, 'a_tadakatsu', atk('e_gate')],
        [gone('e_gate'), 'a_tadakatsu', tap(0, -62)],
        [gone('e_gate'), 'a_ishikawa', tap(-15, -70)],
        [gone('e_gate'), 'a_yumi', atk('e_yumi_gate')],
        ...route('a_sakakibara', [
            [174, 60],
            [174, -142],
            [140, -142],
            [40, -150],
        ]),
        ...route('a_sakai', [
            [174, 80],
            [174, -120],
            [140, -142],
            [40, -140],
        ]),
        ...route('a_kiba', [
            [174, 100],
            [174, -100],
            [140, -142],
            [55, -155],
        ]),
        [gone('e_hall'), 'a_sakai', tap(40, -150)],
        [gone('e_hall'), 'a_kiba', tap(55, -135)],
        [arrived('e_counter'), 'a_ishikawa', tap(15, -60)],
        [arrived('e_counter'), 'a_yumi', tap(-10, -80)],
    ] as Step[],
    /** 正面の石段だけ（準備あり）：弓で山門の弓を射すくめてから、忠勝隊・酒井隊が順に山門へ。全部隊が石段から上がる */
    front: [
        [0, 'a_yumi', tap(-20, 5)],
        [20, 'a_yumi', atk('e_yumi_gate')],
        [gone('e_yumi_gate'), 'a_yumi', atk('e_gate')],
        [0, 'a_tadakatsu', tap(0, -12)],
        [0, 'a_sakai', tap(-10, 10)],
        [0, 'a_ishikawa', tap(10, 20)],
        [0, 'a_kiba', tap(0, 40)],
        [0, 'a_sakakibara', tap(20, 40)],
        [gone('e_yumi_gate'), 'a_tadakatsu', atk('e_gate')],
        [low('a_tadakatsu'), 'a_tadakatsu', tap(-20, 20)],
        [low('a_tadakatsu'), 'a_sakai', atk('e_gate')],
        [gone('e_gate'), 'a_sakai', tap(0, -62)],
        [gone('e_gate'), 'a_ishikawa', tap(20, -100)],
        [gone('e_gate'), 'a_kiba', tap(40, -120)],
        [gone('e_gate'), 'a_sakakibara', tap(30, -140)],
        [gone('e_gate'), 'a_yumi', tap(0, -40)],
        [near('a_sakakibara', 30, -140, 15), 'a_sakakibara', tap(40, -150)],
        [near('a_ishikawa', 20, -100, 15), 'a_ishikawa', tap(45, -145)],
        [gone('e_hall'), 'a_ishikawa', tap(40, -150)],
        [gone('e_hall'), 'a_sakakibara', tap(60, -140)],
        [gone('e_hall'), 'a_kiba', tap(20, -150)],
    ] as Step[],
    unplanned: unplanned(600),
    hold: [] as Step[],
};

// ---------------------------------------------------------------- 城下町外縁

export const TOWN_PLANS = {
    /** 進路を見て組み替える：大通りに忠勝隊と石川隊・弓、西の脇道に酒井隊、東に騎馬。榊原隊は横道で待ち、東の騎馬・槍が見えたら東へ。西の騎馬が見えたら石川隊を西へ、大通りの三が見えたら戻す */
    watch: [
        [0, 'a_tadakatsu', tap(0, 45)],
        [0, 'a_ishikawa', tap(0, 70)],
        [0, 'a_yumi', tap(0, 125)],
        [0, 'a_sakai', tap(-140, 30)],
        [0, 'a_kiba', tap(140, 40)],
        [0, 'a_sakakibara', tap(60, 102)],
        [arrived('e_e_kiba'), 'a_sakakibara', tap(140, 70)],
        [arrived('e_w_kiba'), 'a_ishikawa', tap(-140, 60)],
        [arrived('e_e_yari'), 'a_sakakibara', tap(140, 70)],
        [arrived('e_m_yari3'), 'a_ishikawa', tap(0, 70)],
    ] as Step[],
    /** 大通りに集中する（脇道・門口は空ける） */
    main: [
        [0, 'a_tadakatsu', tap(0, 45)],
        [0, 'a_sakai', tap(-20, 30)],
        [0, 'a_ishikawa', tap(20, 30)],
        [0, 'a_kiba', tap(0, 60)],
        [0, 'a_sakakibara', tap(0, 75)],
        [0, 'a_yumi', tap(0, 15)],
    ] as Step[],
    /** 出口の前で受ける */
    exits: [
        [0, 'a_sakai', tap(-140, 160)],
        [0, 'a_ishikawa', tap(-140, 135)],
        [0, 'a_tadakatsu', tap(0, 150)],
        [0, 'a_yumi', tap(0, 120)],
        [0, 'a_kiba', tap(140, 135)],
        [0, 'a_sakakibara', tap(140, 140)],
        [0, 'a_ieyasu', tap(0, 175)],
    ] as Step[],
    unplanned: unplanned(450),
    hold: [] as Step[],
};

// ---------------------------------------------------------------- 城攻め前面

const opened = (s: BattleState) => s.field.gates[0]!.open;
/** 門が開いた後：門の裏の槍に順に当たり、曲輪の槍を破って曲輪の輪を占める */
const INSIDE: Step[] = [
    [opened, 'a_tadakatsu', atk('e_gate_guard')],
    [opened, 'a_ishikawa', atk('e_gate_guard')],
    [opened, 'a_sakai', atk('e_gate_guard')],
    [opened, 'a_yumi', atk('e_tower_w')],
    [low('a_tadakatsu'), 'a_tadakatsu', tap(-40, -20)],
    [gone('e_gate_guard'), 'a_ishikawa', atk('e_inner')],
    [gone('e_gate_guard'), 'a_sakai', atk('e_inner')],
    [gone('e_gate_guard'), 'a_kiba', atk('e_inner')],
    [gone('e_gate_guard'), 'a_sakakibara', tap(10, -100)],
    [gone('e_inner'), 'a_ishikawa', tap(-12, -120)],
    [gone('e_inner'), 'a_sakai', tap(12, -125)],
    [gone('e_inner'), 'a_kiba', tap(0, -110)],
];

export const SIEGE_PLANS = {
    /** 側面の拠点を先に落とす：酒井隊・榊原隊・騎馬で東の外の拠点へ。崩れたら門の前の出張りへ全部で当たり、門の前の輪を占める */
    bastion: [
        [0, 'a_sakai', tap(110, 20)],
        [0, 'a_sakakibara', tap(150, 40)],
        [0, 'a_kiba', tap(130, 45)],
        [near('a_sakai', 110, 20, 15), 'a_sakai', atk('e_bast_yari')],
        [near('a_sakai', 110, 20, 15), 'a_sakakibara', atk('e_bast_yumi')],
        [near('a_sakai', 110, 20, 15), 'a_kiba', atk('e_bast_yari')],
        [0, 'a_tadakatsu', tap(0, 40)],
        [0, 'a_ishikawa', tap(20, 50)],
        [0, 'a_yumi', tap(-20, 50)],
        [gone('e_bast_yari'), 'a_tadakatsu', atk('e_sortie')],
        [gone('e_bast_yari'), 'a_ishikawa', atk('e_sortie')],
        [gone('e_bast_yari'), 'a_sakai', atk('e_sortie')],
        [gone('e_bast_yari'), 'a_yumi', atk('e_tower_e')],
        [gone('e_sortie'), 'a_tadakatsu', tap(0, -42)],
        [gone('e_sortie'), 'a_ishikawa', tap(-15, -38)],
        [gone('e_sortie'), 'a_sakai', tap(15, -38)],
        ...INSIDE,
    ] as Step[],
    /** 弓で櫓の弓を射すくめる：弓は西の櫓、次に東の櫓。槍 3 隊で出張りを破って門の前の輪を占める（拠点は放っておく） */
    archers: [
        [0, 'a_yumi', tap(-40, 30)],
        [10, 'a_yumi', atk('e_tower_w')],
        [gone('e_tower_w'), 'a_yumi', atk('e_tower_e')],
        [0, 'a_tadakatsu', tap(0, 40)],
        [0, 'a_ishikawa', tap(20, 50)],
        [0, 'a_sakai', tap(-20, 55)],
        [0, 'a_kiba', tap(-60, 60)],
        [60, 'a_tadakatsu', atk('e_sortie')],
        [60, 'a_ishikawa', atk('e_sortie')],
        [60, 'a_sakai', atk('e_sortie')],
        [gone('e_sortie'), 'a_tadakatsu', tap(0, -42)],
        [gone('e_sortie'), 'a_ishikawa', tap(-15, -38)],
        [gone('e_sortie'), 'a_sakai', tap(15, -38)],
        ...INSIDE,
    ] as Step[],
    unplanned: unplanned(660),
    hold: [] as Step[],
};
