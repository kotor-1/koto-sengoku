/**
 * 合戦の釣り合いのテストで使う「利用者の采配」の台本（刻みごとに呼ぶ。条件がそろった時に 1 回だけ命令を出す）。
 * proto3d/src/battle の demoSetup(alliance) の布陣に合わせてある。
 */
import { isActive, issueOrder, orderAllRetreat, unitById, type BattleState } from '../proto3d/src/battle/sim';
import type { Alliance } from '../proto3d/src/battle/maps';
import type { Order } from '../proto3d/src/battle/types';

export type Script = (s: BattleState) => void;

/** 台本の道具：key ごとに 1 回だけ、条件がそろった時に実行する */
function scripted(steps: [key: string, when: (s: BattleState) => boolean, act: (s: BattleState) => boolean | void][]): Script {
    const done = new Set<string>();
    return (s) => {
        for (const [key, when, act] of steps) {
            if (done.has(key) || !when(s)) continue;
            if (act(s) !== false) done.add(key);
        }
    };
}
const U = (s: BattleState, id: string) => unitById(s, id)!;
const alive = (s: BattleState, id: string) => {
    const u = unitById(s, id);
    return !!u && isActive(u);
};
const seen = (s: BattleState, id: string) => alive(s, id) && U(s, id).seenBy.ally;
const at = (s: BattleState, id: string, x: number, z: number, r = 6) => {
    const u = U(s, id);
    return Math.hypot(u.x - x, u.z - z) <= r;
};
const order = (s: BattleState, id: string, o: Order) => issueOrder(s, id, o);
const attack = (s: BattleState, id: string, targetId: string) => issueOrder(s, id, { type: 'attack', targetId });
const idle = (s: BattleState, id: string) => alive(s, id) && U(s, id).order.type === 'hold' && !U(s, id).engagedWith;

/** 何もしない（全部隊その場で待機） */
export const holdScript: Script = () => {};

/**
 * 正面から全軍で丘を押す：味方の全部隊（本陣も）が、見えている敵の先手 → 本陣 → 残り、の順に攻めかかる
 */
export const frontalScript: Script = (s) => {
    for (const u of s.units) {
        if (u.side !== 'ally' || !isActive(u) || u.order.type === 'attack') continue;
        const tgt = ['e_sente', 'e_hq', 'e_yumi', 'e_reserve', 'e_omori', 'e_tashiro']
            .map((id) => unitById(s, id))
            .find((e) => e && isActive(e) && e.seenBy.ally);
        if (tgt) attack(s, u.id, tgt.id);
    }
};

/** 正面から押す（本陣は残す）：本陣以外の全部隊が、先手 → 本陣 → 残りの順に攻めかかる */
export const frontalNoHqScript: Script = (s) => {
    for (const u of s.units) {
        if (u.side !== 'ally' || u.isHq || !isActive(u) || u.order.type === 'attack') continue;
        const tgt = ['e_sente', 'e_hq', 'e_yumi', 'e_reserve', 'e_omori', 'e_tashiro']
            .map((id) => unitById(s, id))
            .find((e) => e && isActive(e) && e.seenBy.ally);
        if (tgt) attack(s, u.id, tgt.id);
    }
};

/** 開始 t 秒で全軍撤退 */
export function retreatAt(t: number): Script {
    return (s) => {
        if (s.t >= t && s.allRetreatAt === null) orderAllRetreat(s);
    };
}

/** 本陣だけで先手へ突っ込む（本陣の敗走で負ける）。台本は 1 回の合戦ごとに作り直す */
export function hqAloneScript(): Script {
    return scripted([['hq', () => true, (s) => attack(s, 'a_hq', 'e_sente')]]);
}

/**
 * 考えた采配（協力陣営ごと）：別働隊・予備隊・側面への回り込みを使う。台本は 1 回の合戦ごとに作り直す。
 */
export function planScript(alliance: Alliance): Script {
    if (alliance === 'tashiro') {
        return scripted([
            // 田代騎馬隊は着いたら林の中を北へ（敵に気づかれない）
            ['cav-woods', (s) => alive(s, 'a_tashiro'), (s) => order(s, 'a_tashiro', { type: 'move', x: -100, z: -135 })],
            // 騎馬隊が林の北の端へ近づいたら、源蔵隊（槍）で先手を正面から押さえる（先手を本陣の守りに回らせない）
            ['genzo-sente', (s) => alive(s, 'a_tashiro') && U(s, 'a_tashiro').z < -60, (s) => attack(s, 'a_genzo', 'e_sente')],
            // 先手が源蔵隊と組み合ったら、騎馬隊が敵本陣の横（西）から突く
            ['cav-hq', (s) => alive(s, 'a_tashiro') && at(s, 'a_tashiro', -100, -135) && alive(s, 'e_sente') && U(s, 'e_sente').engagedWith === 'a_genzo', (s) => attack(s, 'a_tashiro', 'e_hq')],
            // 右から回り込む大森勢が新八隊（弓）に取り付いたら、本陣で大森勢の横を突く
            ['hq-omori', (s) => alive(s, 'e_omori') && U(s, 'e_omori').engagedWith === 'a_shinpachi', (s) => attack(s, 'a_hq', 'e_omori')],
            ['hq-back', (s) => !alive(s, 'e_omori') && alive(s, 'a_hq') && U(s, 'a_hq').order.type === 'hold', (s) => order(s, 'a_hq', { type: 'move', x: 0, z: 110, face: 0 })],
        ]);
    }
    if (alliance === 'omori') {
        return scripted([
            // 大森槍隊は右の川沿いへ寄って待つ（鷲尾弓隊の矢の届かない所）
            ['omori-wait', () => true, (s) => order(s, 'a_omori', { type: 'move', x: 110, z: 40 })],
            // 左の林から来る田代騎馬隊は、見えたら源蔵隊（槍）で受ける
            ['genzo-cav', (s) => seen(s, 'e_tashiro'), (s) => attack(s, 'a_genzo', 'e_tashiro')],
            // 田代勢を退けたら、源蔵隊が先手を正面から押さえ、同時に大森槍隊が先手の横（東）へ回る
            ['genzo-sente', (s) => !alive(s, 'e_tashiro') && idle(s, 'a_genzo'), (s) => attack(s, 'a_genzo', 'e_sente')],
            ['omori-sente', (s) => U(s, 'a_genzo').order.type === 'attack' && !alive(s, 'e_tashiro'), (s) => attack(s, 'a_omori', 'e_sente')],
            // 先手が崩れたら本陣へ
            ['omori-hq', (s) => !alive(s, 'e_sente') && alive(s, 'a_omori'), (s) => attack(s, 'a_omori', 'e_hq')],
            ['genzo-hq', (s) => !alive(s, 'e_sente') && alive(s, 'a_genzo'), (s) => attack(s, 'a_genzo', 'e_hq')],
        ]);
    }
    // 独力：弓で先手を丘から誘い出し、平地で源蔵隊と予備隊が両側から挟む。崩れた所へ次々に当てる
    const next = (s: BattleState) => ['e_reserve', 'e_yumi', 'e_hq'].find((id) => seen(s, id));
    const press = (id: string) => (s: BattleState) => {
        const t = next(s);
        return t ? attack(s, id, t) : false;
    };
    return scripted([
        // 源蔵隊・予備隊は先手の持ち場から 110 m より離れて左右に構える（先手が安心して打って出るように）
        ['genzo-wait', () => true, (s) => order(s, 'a_genzo', { type: 'move', x: -45, z: 75 })],
        ['res-wait', () => true, (s) => order(s, 'a_reserve', { type: 'move', x: 50, z: 80 })],
        // 新八隊（弓）は前へ出て先手を射る
        ['archers', () => true, (s) => order(s, 'a_shinpachi', { type: 'move', x: 15, z: 40 })],
        // 先手が新八隊へ打って出たら、両側から挟む
        ['genzo-sente', (s) => alive(s, 'e_sente') && U(s, 'e_sente').order.type === 'attack', (s) => attack(s, 'a_genzo', 'e_sente')],
        ['res-sente', (s) => alive(s, 'e_sente') && U(s, 'e_sente').order.type === 'attack', (s) => attack(s, 'a_reserve', 'e_sente')],
        // 先手が崩れたら、予備隊 → 弓隊 → 本陣 の順に（見えているもの）
        ['genzo-next', (s) => !alive(s, 'e_sente') && idle(s, 'a_genzo'), press('a_genzo')],
        ['res-next', (s) => !alive(s, 'e_sente') && idle(s, 'a_reserve'), press('a_reserve')],
        ['genzo-next2', (s) => !alive(s, 'e_sente') && !alive(s, 'e_reserve') && idle(s, 'a_genzo'), press('a_genzo')],
        ['res-next2', (s) => !alive(s, 'e_sente') && !alive(s, 'e_reserve') && idle(s, 'a_reserve'), press('a_reserve')],
    ]);
}
