/**
 * 「利用者の采配」の台本（純粋な TypeScript）。合戦の釣り合いのテスト（tests/proto3d-battle-balance.test.ts）と、
 * 開発時の早送り（dev フック・e2e：例 runToEnd(state, planScript('tashiro')) で勝利まで一気に進める）に使う。
 * 本番の画面からは使わない。
 *
 * 台本は刻みごと（または毎フレーム）に呼ぶ関数で、条件がそろった時に 1 回だけ命令を出す。
 * maps.ts の demoUnits(alliance) の布陣（部隊の id）に合わせてある。
 */
import { isActive, issueOrder, orderAllRetreat, unitById, type BattleState } from './sim';
import { useAbility } from './abilities';
import type { Alliance, IeyasuPolicy } from './maps';
import type { Order } from './types';

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
/** いると分かっている部隊（alive で確かめてから使う） */
const U = (s: BattleState, id: string) => unitById(s, id)!;
const alive = (s: BattleState, id: string) => {
    const u = unitById(s, id);
    return !!u && isActive(u);
};
const seen = (s: BattleState, id: string) => alive(s, id) && U(s, id).seenBy.ally;
const at = (s: BattleState, id: string, x: number, z: number, r = 6) => {
    const u = unitById(s, id);
    return !!u && Math.hypot(u.x - x, u.z - z) <= r;
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
            ['omori-sente', (s) => alive(s, 'a_genzo') && U(s, 'a_genzo').order.type === 'attack' && !alive(s, 'e_tashiro'), (s) => attack(s, 'a_omori', 'e_sente')],
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
        // 源蔵隊・予備隊は先手の持ち場から 90 m（AI.provokeCalm）より離れて左右に構える（先手が安心して打って出るように）
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

/**
 * 独力のときの家臣の助言どおりの采配（仮シナリオの源蔵の台詞）：布陣は動かさず、新八隊（弓）で先手を射続ける。
 * 先手が丘を下りて新八隊に斬りかかったら、源蔵隊と予備隊で両の横から挟む。崩れたら、見えている敵へ次々に当てる。
 */
export function lureScript(): Script {
    const engagedWithArchers = (s: BattleState) => alive(s, 'e_sente') && U(s, 'e_sente').engagedWith === 'a_shinpachi';
    const next = (id: string) => (s: BattleState) => {
        const t = ['e_reserve', 'e_yumi', 'e_hq'].find((e) => seen(s, e));
        return t ? attack(s, id, t) : false;
    };
    const follow = (id: string) =>
        [1, 2, 3].map((k) => [`${id}-next${k}`, (s: BattleState) => !alive(s, 'e_sente') && idle(s, id) && (k === 1 || !alive(s, k === 2 ? 'e_reserve' : 'e_yumi')), next(id)] as [string, (s: BattleState) => boolean, (s: BattleState) => boolean]);
    return scripted([
        ['archers', () => true, (s) => attack(s, 'a_shinpachi', 'e_sente')],
        ['genzo-sente', engagedWithArchers, (s) => attack(s, 'a_genzo', 'e_sente')],
        ['res-sente', engagedWithArchers, (s) => attack(s, 'a_reserve', 'e_sente')],
        ...follow('a_genzo'),
        ...follow('a_reserve'),
    ]);
}

// ================================================================ 歴史分岐「元亀元年・家康」（maps.ts の ieyasu1570Setup の布陣）

/** 方針ごとの敵の id（先手 → 本陣 → 残りの順。正面押しの台本が使う） */
const IEYASU_ENEMY_ORDER: Record<IeyasuPolicy, string[]> = {
    oda: ['e_asai_sente', 'e_nagamasa', 'e_asai_yumi', 'e_asakura'],
    asai: ['e_oda_sente', 'e_oda_hq', 'e_oda_teppo', 'e_oda_kiba'],
    home: ['e_ronin_yari', 'e_ronin_hq', 'e_ronin_yumi', 'e_ronin_kiba'],
};

/** 正面から押す（歴史分岐）：味方の全部隊（withHq=false なら本陣以外）が、見えている敵の先手 → 本陣 → 残りの順に攻めかかる */
export function ieyasuFrontalScript(policy: IeyasuPolicy, withHq = true): Script {
    return (s) => {
        for (const u of s.units) {
            if (u.side !== 'ally' || (!withHq && u.isHq) || !isActive(u) || u.order.type === 'attack') continue;
            const tgt = IEYASU_ENEMY_ORDER[policy].map((id) => unitById(s, id)).find((e) => e && isActive(e) && e.seenBy.ally);
            if (tgt) attack(s, u.id, tgt.id);
        }
    };
}

/** 部隊が崩れた（敗走・撤退・全滅）。まだ着いていない部隊は崩れていない */
const broken = (s: BattleState, id: string) => {
    const u = unitById(s, id);
    return !!u && u.status !== 'ready';
};
const near = (s: BattleState, a: string, b: string, r: number) => alive(s, a) && alive(s, b) && Math.hypot(U(s, a).x - U(s, b).x, U(s, a).z - U(s, b).z) <= r;
/** 最初の敵（first）が崩れたら、手の空いた部隊（units）を見えている残りの敵（rest の順）へ次々に当てる */
function follow(units: string[], rest: string[], first: string): [string, (s: BattleState) => boolean, (s: BattleState) => boolean][] {
    const out: [string, (s: BattleState) => boolean, (s: BattleState) => boolean][] = [];
    for (const id of units) {
        for (let k = 0; k < 3; k++) {
            out.push([`${id}-next${k}`, (s) => broken(s, first) && idle(s, id) && rest.slice(0, k).every((e) => broken(s, e)), pressNext(rest, id)]);
        }
    }
    return out;
}
/** 次に見えている敵へ当てる（台本の道具） */
function pressNext(ids: string[], unitId: string) {
    return (s: BattleState) => {
        const t = ids.find((id) => seen(s, id));
        return t ? attack(s, unitId, t) : false;
    };
}

/**
 * 考えた采配（歴史分岐・方針ごと）。variant：
 * - keep：約束の対象を早めに退かせ（撤退の命令で退き口へ）、忠勝隊の「退路の守護」で追撃を止めてから、敵を崩す。
 * - break：約束の対象は前に置いたまま（捨て石）、徳川の部隊だけで敵を崩す。
 * 台本は 1 回の合戦ごとに作り直す。
 */
export function ieyasuPlanScript(policy: IeyasuPolicy, variant: 'keep' | 'break' = 'keep'): Script {
    const keep = variant === 'keep';
    if (policy === 'oda') {
        const rest = ['e_asai_sente', 'e_asai_yumi', 'e_nagamasa'];
        const sallied = (s: BattleState) => alive(s, 'e_asai_sente') && U(s, 'e_asai_sente').engagedWith === 't_yumi';
        const all = ['t_tadakatsu', 't_yumi', 't_honjin', 'a_oda'];
        return scripted([
            // keep：織田援軍を南の味方の陣へ下げる（20 秒とどまれば約束の条件を満たす）
            ['oda-back', () => keep, (s) => order(s, 'a_oda', { type: 'move', x: 25, z: 135, face: 0 })],
            // 忠勝隊は右前へ出て、東から回り込む朝倉勢を待つ。弓隊は忠勝隊の後ろ
            ['tada-east', () => true, (s) => order(s, 't_tadakatsu', { type: 'move', x: 80, z: 45, face: 0.6 })],
            ['yumi-east', () => true, (s) => order(s, 't_yumi', { type: 'move', x: 45, z: 75 })],
            // 朝倉勢が見えたら、弓で射て、忠勝隊が受ける。朝倉勢が忠勝隊と組み合ったら、本陣が横を突き、号令で支える
            ['yumi-asa', (s) => seen(s, 'e_asakura') && U(s, 'e_asakura').z > -40, (s) => attack(s, 't_yumi', 'e_asakura')],
            ['tada-asa', (s) => seen(s, 'e_asakura') && U(s, 'e_asakura').z > -20, (s) => attack(s, 't_tadakatsu', 'e_asakura')],
            ['hq-asa', (s) => alive(s, 'e_asakura') && U(s, 'e_asakura').engagedWith === 't_tadakatsu', (s) => attack(s, 't_honjin', 'e_asakura')],
            ['rally', (s) => alive(s, 'e_asakura') && U(s, 'e_asakura').engagedWith === 't_tadakatsu' && near(s, 't_honjin', 'e_asakura', 60), (s) => useAbility(s, 't_honjin').ok],
            // 朝倉勢を崩したら、本陣は陣へ戻り、忠勝隊は右・織田援軍は左に構え、弓で先手を射て丘から誘い出す
            ['hq-back', (s) => broken(s, 'e_asakura'), (s) => order(s, 't_honjin', { type: 'move', x: 0, z: 100, face: 0 })],
            ['tada-wait', (s) => broken(s, 'e_asakura'), (s) => order(s, 't_tadakatsu', { type: 'move', x: 75, z: 60 })],
            ['oda-wait', (s) => broken(s, 'e_asakura') && alive(s, 'a_oda') && (s.pledge === null || s.pledge.secured), (s) => order(s, 'a_oda', { type: 'move', x: -45, z: 75 })],
            ['yumi-sente', (s) => broken(s, 'e_asakura'), (s) => attack(s, 't_yumi', 'e_asai_sente')],
            // 先手が弓隊へ打って出たら、忠勝隊・織田援軍・本陣で囲む
            ['tada-sente', sallied, (s) => attack(s, 't_tadakatsu', 'e_asai_sente')],
            ['oda-sente', (s) => sallied(s) && alive(s, 'a_oda'), (s) => attack(s, 'a_oda', 'e_asai_sente')],
            ['hq-sente', sallied, (s) => attack(s, 't_honjin', 'e_asai_sente')],
            ...follow(all, rest, 'e_asai_sente'),
        ]);
    }
    if (policy === 'asai') {
        const rest = ['e_oda_kiba', 'e_oda_teppo', 'e_oda_hq'];
        const all = ['t_tadakatsu', 't_yumi', 't_honjin', 'a_nagamasa'];
        const onTada = (s: BattleState) => alive(s, 'e_oda_sente') && U(s, 'e_oda_sente').engagedWith === 't_tadakatsu';
        return scripted([
            // keep：浅井長政隊を忠勝隊の後ろへ下げ、「盟友への援護」で忠勝隊を支える（長政隊は戦える形で終わる）
            ['naga-back', () => keep, (s) => order(s, 'a_nagamasa', { type: 'move', x: -25, z: 75, face: 0 })],
            ['tada-front', () => true, (s) => order(s, 't_tadakatsu', { type: 'move', x: -35, z: 30, face: 0 })],
            ['yumi-front', () => true, (s) => order(s, 't_yumi', { type: 'move', x: 25, z: 55 })],
            // 追ってきた織田先手を忠勝隊が受け止めたら、長政隊が援護し、弓と本陣が横を突く
            ['naga-support', (s) => keep && onTada(s) && near(s, 'a_nagamasa', 't_tadakatsu', 60), (s) => useAbility(s, 'a_nagamasa', 't_tadakatsu').ok],
            ['yumi-sente', (s) => alive(s, 'e_oda_sente') && !!U(s, 'e_oda_sente').engagedWith, (s) => attack(s, 't_yumi', 'e_oda_sente')],
            ['hq-sente', onTada, (s) => attack(s, 't_honjin', 'e_oda_sente')],
            ['rally', (s) => onTada(s) && near(s, 't_honjin', 't_tadakatsu', 80), (s) => useAbility(s, 't_honjin').ok],
            // 西の林から来る織田騎馬は、長政隊（槍）で正面から受ける
            ['naga-kiba', (s) => keep && seen(s, 'e_oda_kiba') && near(s, 'a_nagamasa', 'e_oda_kiba', 90), (s) => attack(s, 'a_nagamasa', 'e_oda_kiba')],
            ...follow(all, rest, 'e_oda_sente'),
        ]);
    }
    // home：浪人衆
    const rest = ['e_ronin_yumi', 'e_ronin_kiba', 'e_ronin_hq'];
    const all = ['t_tadakatsu', 't_yumi', 't_honjin', 't_reserve'];
    const sallied = (s: BattleState) => alive(s, 'e_ronin_yari') && U(s, 'e_ronin_yari').engagedWith === 't_yumi';
    const kibaFighting = (s: BattleState) => alive(s, 'e_ronin_kiba') && ['t_tadakatsu', 't_yumi'].includes(U(s, 'e_ronin_kiba').engagedWith ?? '');
    return scripted([
        // keep：砦の守備隊を南の味方の陣へ下げる（20 秒とどまってから戻す）
        ['res-back', () => keep, (s) => order(s, 't_reserve', { type: 'move', x: -20, z: 130, face: 0 })],
        // 西の林から来る浪人衆の騎馬は、忠勝隊（槍）で正面から受け、弓と本陣で横を突く
        ['tada-west', () => true, (s) => order(s, 't_tadakatsu', { type: 'move', x: -45, z: 55, face: -0.6 })],
        ['yumi-back', () => true, (s) => order(s, 't_yumi', { type: 'move', x: -5, z: 85 })],
        ['tada-kiba', (s) => seen(s, 'e_ronin_kiba'), (s) => attack(s, 't_tadakatsu', 'e_ronin_kiba')],
        ['yumi-kiba', (s) => seen(s, 'e_ronin_kiba'), (s) => attack(s, 't_yumi', 'e_ronin_kiba')],
        ['hq-kiba', kibaFighting, (s) => attack(s, 't_honjin', 'e_ronin_kiba')],
        // 騎馬を崩したら、本陣は陣へ戻り、忠勝隊・守備隊は左右に構え、弓で浪人衆の槍を誘い出す
        ['hq-back', (s) => broken(s, 'e_ronin_kiba'), (s) => order(s, 't_honjin', { type: 'move', x: 0, z: 100, face: 0 })],
        ['tada-wait', (s) => broken(s, 'e_ronin_kiba'), (s) => order(s, 't_tadakatsu', { type: 'move', x: -45, z: 75 })],
        ['res-wait', (s) => broken(s, 'e_ronin_kiba') && alive(s, 't_reserve') && (s.pledge === null || s.pledge.secured || !keep), (s) => order(s, 't_reserve', { type: 'move', x: 50, z: 80 })],
        ['yumi-yari', (s) => broken(s, 'e_ronin_kiba'), (s) => attack(s, 't_yumi', 'e_ronin_yari')],
        ['tada-yari', sallied, (s) => attack(s, 't_tadakatsu', 'e_ronin_yari')],
        ['res-yari', (s) => sallied(s) && alive(s, 't_reserve'), (s) => attack(s, 't_reserve', 'e_ronin_yari')],
        ['hq-yari', sallied, (s) => attack(s, 't_honjin', 'e_ronin_yari')],
        ['rally', (s) => sallied(s) && near(s, 't_honjin', 't_yumi', 90), (s) => useAbility(s, 't_honjin').ok],
        ...follow(all, rest, 'e_ronin_yari'),
    ]);
}

/**
 * 退いて味方を救う（歴史分岐）：忠勝隊を約束の対象の退路に置き、対象が敵と斬り合ったら（約束の場面）撤退を命じる。
 * 追ってくる敵がいて、対象が忠勝隊の近くまで退いたら「退路の守護」で追っ手を阻む。
 * 対象が戦場を離れたら（または崩れたら）全軍撤退。結果は「撤退」、約束は守れる見込み。台本は 1 回の合戦ごとに作り直す。
 */
export function ieyasuRetreatScript(policy: IeyasuPolicy): Script {
    const target = policy === 'oda' ? 'a_oda' : policy === 'asai' ? 'a_nagamasa' : 't_reserve';
    const cover = policy === 'oda' ? { x: 70, z: 45 } : policy === 'asai' ? { x: -45, z: 40 } : { x: -65, z: 50 };
    const pressed = (s: BattleState) => {
        const t = unitById(s, target);
        if (!t || !isActive(t)) return false;
        return !!t.engagedWith || s.units.some((e) => e.side === 'enemy' && isActive(e) && e.engagedWith === target);
    };
    const chased = (s: BattleState) => {
        const t = unitById(s, target);
        if (!t || !isActive(t) || t.order.type !== 'retreat') return false;
        return s.units.some((e) => e.side === 'enemy' && isActive(e) && e.order.type === 'attack' && e.order.targetId === target);
    };
    return scripted([
        ['tada-cover', () => true, (s) => order(s, 't_tadakatsu', { type: 'move', x: cover.x, z: cover.z })],
        ['target-out', (s) => pressed(s), (s) => order(s, target, { type: 'retreat' })],
        ['rearguard', (s) => chased(s) && near(s, 't_tadakatsu', target, 60), (s) => useAbility(s, 't_tadakatsu').ok],
        ['all-out', (s) => broken(s, target), (s) => orderAllRetreat(s)],
    ]);
}
