/**
 * 戦場の地図と、開発・テスト用の標準の布陣（仮シナリオ）。純粋な TypeScript。
 * 戦場（地形・配置の枠・退き口・日没）は fields/border_field.ts のデータ（BORDER_FIELD_DEF）から作る。
 *
 * > 仮シナリオ：部隊名・人物・家は架空の仮の設定（docs/chapter1-spec.md §0）。
 *
 * - BORDER_FIELD：戦場「国境の原」（border_field）。360 m × 300 m。味方は南、敵は北。
 * - BORDER_FIELD_POS：布陣の位置（章の進行が部隊を作るときにも使える）。
 * - demoUnits(alliance, opts)：協力陣営ごとの標準の部隊（兵・士気・位置・役割）。合戦の釣り合いのテストはこの布陣で確かめている。
 *   章の進行（campaign）は、これを元に兵・名前・率いる人物を差し替えて使うと、釣り合いを保ちやすい。
 * - demoSetup(alliance)：合戦の設定一式（開発の確認用。説明文は仮）。
 *
 * 歴史分岐「元亀元年・家康」（docs/ieyasu1570-design.md §3〜§5。ファイルの後半）：
 * - ieyasu1570Setup(policy, { troops, pledgeAccepted })：方針（oda／asai／home）ごとの布陣・目的・説明・約束。国境の原を流用した
 *   「1570年の情勢を背景にした架空の局地戦」（姉川の戦いの再現ではない）。
 * - IEYASU_UNIT_IDS・IEYASU_INITIAL_TROOPS・ieyasuTroopKeysInBattle：徳川の部隊の id・最初の兵・合戦に出る部隊。
 * - IEYASU_PLEDGE_TARGET・IEYASU_SAFE_ZONE：約束の対象・南の「味方の陣」（安全地点）。
 */
import type { BattleMap, BattleSetup, UnitDef } from './types';
import { RULES } from './sim';
import { BORDER_FIELD_DEF, borderSlot } from './fields/border_field';
import { buildBattleSetup, fieldMap } from './fields/build';

/** 協力陣営の選択 */
export type Alliance = 'tashiro' | 'omori' | 'alone';

/**
 * 戦場「国境の原」（fields/border_field.ts のデータから作る地図）。
 * - 北の中央に丘（敵本陣。中心 (0,-100)、半径 70 m、高さ 12 m）。
 * - 西に林（山道の続き。x -180〜-85）。中の部隊は相手から見えない（60 m 以内に来るまで）。
 * - 東に川沿いの湿地（x 122〜180、z -45〜150）。とても遅い。その西側（x 90〜120）は乾いた川沿いの道筋。
 * - 中央を南北に道。
 * - 退き口：味方は南の端、敵は北の端。
 */
export const BORDER_FIELD: BattleMap = fieldMap(BORDER_FIELD_DEF);

/** 布陣の位置（x, z, 向き。fields/border_field.ts の配置の枠） */
export const BORDER_FIELD_POS = {
    /** 味方 */
    allyHq: borderSlot('ally', 'allyHq'),
    allyFront: borderSlot('ally', 'allyFront'),
    allyRight: borderSlot('ally', 'allyRight'),
    /** 右翼（大森勢と組んだとき） */
    allyRightWing: borderSlot('ally', 'allyRightWing'),
    /** 左の林（山道から着く別働隊） */
    allyWoods: borderSlot('ally', 'allyWoods'),
    /** 本陣の後ろ（予備隊） */
    allyReserve: borderSlot('ally', 'allyReserve'),
    /** 敵 */
    enemyHq: borderSlot('enemy', 'enemyHq'),
    enemyFront: borderSlot('enemy', 'enemyFront'),
    enemyRight: borderSlot('enemy', 'enemyRight'),
    /** 東の湿地の北（右から回り込む） */
    enemyEast: borderSlot('enemy', 'enemyEast'),
    /** 西の林（左から回り込む） */
    enemyWoods: borderSlot('enemy', 'enemyWoods'),
    /** 丘の後ろ（予備隊） */
    enemyReserve: borderSlot('enemy', 'enemyReserve'),
} as const;

/** 田代の別働隊が林に着く時刻（秒） */
export const TASHIRO_ARRIVE_SEC = 40;

export interface DemoOptions {
    /** 部隊ごとの兵の数の差し替え（id → 兵） */
    strength?: Partial<Record<string, number>>;
    /** 部隊ごとの士気の差し替え（id → 士気） */
    morale?: Partial<Record<string, number>>;
}

/**
 * 協力陣営ごとの標準の部隊（仮シナリオ）。
 * 味方の id：a_hq（本陣・hero）・a_genzo（源蔵隊）・a_shinpachi（新八隊）・4 部隊目は a_tashiro / a_omori / a_reserve。
 * 敵の id：e_hq（鷲尾本陣・washio_gen）・e_sente（鷲尾先手）・e_yumi（鷲尾弓隊）・4 部隊目は e_omori / e_tashiro / e_reserve。
 */
export function demoUnits(alliance: Alliance, opts: DemoOptions = {}): UnitDef[] {
    const P = BORDER_FIELD_POS;
    const at = (p: { x: number; z: number; facing: number }) => ({ x: p.x, z: p.z, facing: p.facing });
    const units: UnitDef[] = [
        { id: 'a_hq', side: 'ally', clan: 'kotosaka', kind: 'honjin', name: '若殿本陣', leaderId: 'hero', strength: 300, morale: 90, ...at(P.allyHq) },
        { id: 'a_genzo', side: 'ally', clan: 'kotosaka', kind: 'yari', name: '源蔵隊', leaderId: 'genzo', strength: 500, morale: 80, ...at(P.allyFront) },
        { id: 'a_shinpachi', side: 'ally', clan: 'kotosaka', kind: 'yumi', name: '新八隊', leaderId: 'shinpachi', strength: 350, morale: 75, ...at(P.allyRight) },
    ];
    if (alliance === 'tashiro') {
        units.push({ id: 'a_tashiro', side: 'ally', clan: 'tashiro', kind: 'kiba', name: '田代騎馬隊', leaderId: 'tashiro_envoy', strength: 250, morale: 80, arriveAt: TASHIRO_ARRIVE_SEC, ...at(P.allyWoods) });
    } else if (alliance === 'omori') {
        units.push({ id: 'a_omori', side: 'ally', clan: 'omori', kind: 'yari', name: '大森槍隊', leaderId: 'omori_envoy', strength: 400, morale: 70, ...at(P.allyRightWing) });
    } else {
        units.push({ id: 'a_reserve', side: 'ally', clan: 'kotosaka', kind: 'yari', name: '琴坂予備隊', strength: 300, morale: 75, ...at(P.allyReserve) });
    }
    units.push(
        { id: 'e_hq', side: 'enemy', clan: 'washio', kind: 'honjin', name: '鷲尾本陣', leaderId: 'washio_gen', strength: 350, morale: 90, aiRole: 'guard_hq', ...at(P.enemyHq) },
        { id: 'e_sente', side: 'enemy', clan: 'washio', kind: 'yari', name: '鷲尾先手', strength: 550, morale: 80, aiRole: 'hold_line', ...at(P.enemyFront) },
        { id: 'e_yumi', side: 'enemy', clan: 'washio', kind: 'yumi', name: '鷲尾弓隊', strength: 350, morale: 75, aiRole: 'hold_line', ...at(P.enemyRight) },
    );
    if (alliance === 'tashiro') {
        units.push({ id: 'e_omori', side: 'enemy', clan: 'omori', kind: 'yari', name: '大森槍隊', leaderId: 'omori_envoy', strength: 400, morale: 65, aiRole: 'flank', ...at(P.enemyEast) });
    } else if (alliance === 'omori') {
        units.push({ id: 'e_tashiro', side: 'enemy', clan: 'tashiro', kind: 'kiba', name: '田代騎馬隊', leaderId: 'tashiro_envoy', strength: 250, morale: 75, aiRole: 'flank', ...at(P.enemyWoods) });
    } else {
        units.push({ id: 'e_reserve', side: 'enemy', clan: 'washio', kind: 'yari', name: '鷲尾予備隊', strength: 350, morale: 75, aiRole: 'reserve', ...at(P.enemyReserve) });
    }
    for (const u of units) {
        const st = opts.strength?.[u.id];
        if (st !== undefined) u.strength = st;
        const mo = opts.morale?.[u.id];
        if (mo !== undefined) u.morale = mo;
    }
    return units;
}

/** 日没までの秒数（8 分） */
export const BORDER_FIELD_TIME_LIMIT = BORDER_FIELD_DEF.timeLimitSec;

/** 勝ち負けの条件の説明（画面に出す。章の進行が自分の文に差し替えてもよい） */
export function standardBriefing(alliance: Alliance): string[] {
    const who =
        alliance === 'tashiro'
            ? '田代騎馬隊が、開始から 40 秒ほどで左の林（山道）に着く。大森勢は鷲尾に付き、右の川沿いから回り込んでくる。'
            : alliance === 'omori'
              ? '大森槍隊が右翼に付いている。田代勢は鷲尾に付き、左の林から回り込んでくる。'
              : '田代・大森はどちらも静観。本陣の後ろに琴坂の予備隊がいる。敵にも丘の後ろに予備隊がいる。';
    return [
        '（仮シナリオ）国境の原で、丘に陣取る鷲尾勢を迎え撃つ。',
        who,
        '勝利：敵の本陣を敗走させる。または、敵の本陣以外の部隊をすべて戦えなくする（敵兵を全員倒す必要はない）。',
        '敗北：味方の本陣が敗走する（若殿は落ち延びる）。または、本陣以外の味方がすべて戦えなくなり、崩れた部隊の方が多い。',
        '撤退：「全軍撤退」を命じる。本陣以外の部隊をすべて退かせる。または、日没（8 分）で両軍が引く。',
        '丘の上の敵を正面から押すと不利。同じ敵の正面へ重ねても効きが薄い。林は敵から見えない。側面・背後を突くと大きく崩せる。',
        '丘の前の先手は、矢を浴び続けると丘を下りて打って出る（近くに味方の槍・騎馬・本陣がいると動かない）。',
    ];
}

/** 開発・確認用の合戦の設定一式 */
export function demoSetup(alliance: Alliance, opts: DemoOptions = {}): BattleSetup {
    // 目標は付けない（今までの勝ち負け）。国境の原には地形の上書き・特殊ルールが無いので fieldRules も付かない
    return buildBattleSetup(BORDER_FIELD_DEF, demoUnits(alliance, opts), { objectives: 'none', timeLimitSec: BORDER_FIELD_TIME_LIMIT, briefing: standardBriefing(alliance) });
}

// ================================================================ 歴史分岐「元亀元年・家康」（docs/ieyasu1570-design.md §3〜§5）
//
// 1570年の情勢を背景にした架空の局地戦（ゲーム用の創作）。姉川の戦いの再現ではない。
// 戦場は「国境の原」をそのまま流用し、兵数・配置・能力・約束はすべて創作。一般の部隊は部隊名で呼ぶ（架空の個人名を足さない）。

/** 協力方針：A 織田との協力を続ける／B 浅井との協力を選ぶ（史実から分かれた道）／C 自領の防衛を優先する */
export type IeyasuPolicy = 'oda' | 'asai' | 'home';

/** 徳川の部隊（章の進行が兵を持ち越す単位） */
export type IeyasuTroopKey = 'honjin' | 'tadakatsu' | 'yumi' | 'reserve';

/** 徳川の部隊の id（合戦の部隊 id） */
export const IEYASU_UNIT_IDS: Record<IeyasuTroopKey, string> = {
    honjin: 't_honjin',
    tadakatsu: 't_tadakatsu',
    yumi: 't_yumi',
    reserve: 't_reserve',
};

/** 徳川の部隊の最初の兵（章の始め） */
export const IEYASU_INITIAL_TROOPS: Record<IeyasuTroopKey, number> = {
    honjin: 300,
    tadakatsu: 450,
    yumi: 350,
    reserve: 300,
};

/** 方針ごとに合戦へ出る徳川の部隊（A・B では岡崎の守備隊は国元に残る） */
export function ieyasuTroopKeysInBattle(policy: IeyasuPolicy): IeyasuTroopKey[] {
    return policy === 'home' ? ['honjin', 'tadakatsu', 'yumi', 'reserve'] : ['honjin', 'tadakatsu', 'yumi'];
}

/** 率いる人物の id（章の人物の状態に結びつける） */
export const IEYASU_LEADER_IDS = { ieyasu: 'ieyasu', tadakatsu: 'tadakatsu', nagamasa: 'nagamasa' } as const;

/** 戦前の約束の対象（方針ごと。その経路に実際に出る味方の部隊） */
export const IEYASU_PLEDGE_TARGET: Record<IeyasuPolicy, string> = { oda: 'a_oda', asai: 'a_nagamasa', home: 't_reserve' };

/** 約束の安全地点（戦場の南の「味方の陣」）。家康本陣の布陣の後ろ */
export const IEYASU_SAFE_ZONE = { cx: 0, cz: 125, r: 30 } as const;
/** 約束の達成：安全地点にこの秒数以上続けていること・兵がこの割合以上残っていること */
export const IEYASU_PLEDGE_HOLD_SEC = 20;
export const IEYASU_PLEDGE_MIN_RATIO = 0.4;

/** 方針ごとの布陣の位置（x, z, 向き。fields/border_field.ts の配置の枠） */
export const IEYASU_POS = {
    /** A：前に突出した織田援軍（右前。浅井弓隊の矢が届き、東から朝倉勢が回り込む） */
    odaForward: borderSlot('ally', 'odaForward'),
    /** B：前に出た浅井長政隊（左前。西の林から織田騎馬が回り込む） */
    nagamasaForward: borderSlot('ally', 'nagamasaForward'),
    /** C：国境の砦に孤立した岡崎の守備隊（左前。浪人衆の弓が届く） */
    fort: borderSlot('ally', 'fort'),
    /** C：浪人衆の弓（丘の西の肩） */
    enemyLeft: borderSlot('enemy', 'enemyLeft'),
} as const;

export interface IeyasuSetupOptions {
    /** 徳川の部隊ごとの兵（章の進行が持ち越した兵。合戦に出ない部隊の値は使わない） */
    troops: Record<IeyasuTroopKey, number>;
    /** 出陣前の会話で約束を引き受けた（引き受けたときだけ BattleSetup.pledge を付ける） */
    pledgeAccepted: boolean;
}

/** 方針の名前（画面の説明用） */
export const IEYASU_POLICY_LABEL: Record<IeyasuPolicy, string> = {
    oda: '織田との協力を続ける',
    asai: '浅井との協力を選ぶ（史実から分かれた道）',
    home: '自領の防衛を優先する',
};

/**
 * 方針ごとの部隊（味方 4・敵 4。C は徳川 4 部隊）。
 * - 徳川：t_honjin 家康本陣（本陣・ieyasu・立て直しの号令）／t_tadakatsu 本多忠勝隊（槍・tadakatsu・退路の守護）／t_yumi 徳川弓隊／
 *   t_reserve 岡崎の守備隊（C だけ。砦に孤立）。
 * - A：a_oda 織田援軍（前に突出。約束の対象）。敵：e_nagamasa 浅井長政隊（本陣・nagamasa・盟友への援護は敵の考えが使う）・
 *   e_asai_sente 浅井先手・e_asai_yumi 浅井弓隊・e_asakura 朝倉勢（東から回り込む）。
 * - B：a_nagamasa 浅井長政隊（同盟。指揮できる。盟友への援護はプレイヤーが使う。約束の対象）。敵：e_oda_hq 織田方の本陣
 *   （信長本人は出ない）・e_oda_sente 織田先手・e_oda_teppo 織田鉄砲隊（弓の性質で流用）・e_oda_kiba 織田騎馬（西の林から回り込む）。
 * - C：敵は国境を荒らす浪人衆（架空の一団）4 部隊。織田・浅井とは戦わない。
 */
export function ieyasuUnits(policy: IeyasuPolicy, troops: Record<IeyasuTroopKey, number>): UnitDef[] {
    const P = BORDER_FIELD_POS;
    const Q = IEYASU_POS;
    const at = (p: { x: number; z: number; facing: number }) => ({ x: p.x, z: p.z, facing: p.facing });
    const n = (k: IeyasuTroopKey) => {
        const v = troops[k];
        return Number.isFinite(v) ? Math.max(0, Math.round(v)) : IEYASU_INITIAL_TROOPS[k];
    };
    const L = IEYASU_LEADER_IDS;
    const units: UnitDef[] = [
        { id: IEYASU_UNIT_IDS.honjin, side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', leaderId: L.ieyasu, strength: Math.max(50, n('honjin')), morale: 90, ability: 'ieyasu_rally', ...at(P.allyHq) },
        { id: IEYASU_UNIT_IDS.tadakatsu, side: 'ally', clan: 'tokugawa', kind: 'yari', name: '本多忠勝隊', leaderId: L.tadakatsu, strength: n('tadakatsu'), morale: 85, ability: 'tadakatsu_rearguard', ...at(P.allyFront) },
        { id: IEYASU_UNIT_IDS.yumi, side: 'ally', clan: 'tokugawa', kind: 'yumi', name: '徳川弓隊', strength: n('yumi'), morale: 75, ...at(P.allyRight) },
    ];
    if (policy === 'oda') {
        units.push({ id: 'a_oda', side: 'ally', clan: 'oda', kind: 'yari', name: '織田援軍', strength: 400, morale: 75, ...at(Q.odaForward) });
        units.push(
            { id: 'e_nagamasa', side: 'enemy', clan: 'asai', kind: 'honjin', name: '浅井長政隊', leaderId: L.nagamasa, strength: 400, morale: 90, aiRole: 'guard_hq', ability: 'nagamasa_support', ...at(P.enemyHq) },
            { id: 'e_asai_sente', side: 'enemy', clan: 'asai', kind: 'yari', name: '浅井先手', strength: 600, morale: 85, aiRole: 'hold_line', ...at(P.enemyFront) },
            { id: 'e_asai_yumi', side: 'enemy', clan: 'asai', kind: 'yumi', name: '浅井弓隊', strength: 300, morale: 75, aiRole: 'hold_line', ...at(P.enemyRight) },
            { id: 'e_asakura', side: 'enemy', clan: 'asakura', kind: 'yari', name: '朝倉勢', strength: 450, morale: 70, aiRole: 'flank', ...at(P.enemyEast) },
        );
    } else if (policy === 'asai') {
        units.push({ id: 'a_nagamasa', side: 'ally', clan: 'asai', kind: 'yari', name: '浅井長政隊', leaderId: L.nagamasa, strength: 400, morale: 65, ability: 'nagamasa_support', ...at(Q.nagamasaForward) });
        units.push(
            { id: 'e_oda_hq', side: 'enemy', clan: 'oda', kind: 'honjin', name: '織田方の本陣', strength: 350, morale: 90, aiRole: 'guard_hq', ...at(P.enemyHq) },
            { id: 'e_oda_sente', side: 'enemy', clan: 'oda', kind: 'yari', name: '織田先手', strength: 550, morale: 80, aiRole: 'hold_line', ...at(P.enemyFront) },
            { id: 'e_oda_teppo', side: 'enemy', clan: 'oda', kind: 'yumi', name: '織田鉄砲隊', strength: 350, morale: 75, aiRole: 'hold_line', ...at(P.enemyRight) },
            { id: 'e_oda_kiba', side: 'enemy', clan: 'oda', kind: 'kiba', name: '織田騎馬', strength: 250, morale: 75, aiRole: 'flank', ...at(P.enemyWoods) },
        );
    } else {
        units.push({ id: IEYASU_UNIT_IDS.reserve, side: 'ally', clan: 'tokugawa', kind: 'yari', name: '岡崎の守備隊', strength: n('reserve'), morale: 75, ...at(Q.fort) });
        units.push(
            { id: 'e_ronin_hq', side: 'enemy', clan: 'ronin', kind: 'honjin', name: '浪人衆の本隊', strength: 350, morale: 85, aiRole: 'guard_hq', ...at(P.enemyHq) },
            { id: 'e_ronin_yari', side: 'enemy', clan: 'ronin', kind: 'yari', name: '浪人衆の槍', strength: 550, morale: 80, aiRole: 'hold_line', ...at(P.enemyFront) },
            { id: 'e_ronin_yumi', side: 'enemy', clan: 'ronin', kind: 'yumi', name: '浪人衆の弓', strength: 300, morale: 70, aiRole: 'hold_line', ...at(Q.enemyLeft) },
            { id: 'e_ronin_kiba', side: 'enemy', clan: 'ronin', kind: 'kiba', name: '浪人衆の騎馬', strength: 250, morale: 75, aiRole: 'flank', ...at(P.enemyWoods) },
        );
    }
    // 兵のいない徳川の部隊は出さない（本陣は最低 50）
    return units.filter((u) => u.strength >= 1);
}

/** 合戦の前の説明（方針・約束ごと）。架空の局地戦であること、勝ち負けの条件、能力、約束の対象と達成の条件 */
export function ieyasuBriefing(policy: IeyasuPolicy, pledgeAccepted: boolean): string[] {
    const lines = ['1570年の情勢を背景にした架空の局地戦（ゲーム用の創作）。姉川の戦いの再現ではない。戦場・兵数・配置は創作。'];
    if (policy === 'oda') {
        lines.push(
            '方針：織田との協力を続ける。丘に陣取る浅井長政隊（敵の本陣）と浅井先手・浅井弓隊、東から回り込む朝倉勢を退ける。',
            '織田援軍が右前に突出して孤立している。浅井弓隊の矢が届き、朝倉勢に横を突かれやすい。',
            '敵の浅井長政隊は「盟友への援護」で近く（60 m）の浅井の部隊を支える（敵の考えが使う。こちらからは操作できない）。先手を丘から離すと支えが外れる。',
            '勝利：浅井長政隊（敵の本陣）を敗走させる。または、敵の本陣以外の部隊をすべて戦えなくする。',
        );
    } else if (policy === 'asai') {
        lines.push(
            '方針：浅井との協力を選ぶ（史実から分かれた道。史実の家康がこの側に付いたという意味ではない）。',
            '浅井長政隊は同盟の味方で、指揮できる。左前に出ていて、西の林から織田騎馬が回り込んでくる。浅井の退き口を守りつつ、織田の追撃を止める。',
            '敵は織田方の本陣（部将の率いる一隊。信長本人は出ない）・織田先手・織田鉄砲隊（ここでは弓と同じ扱い）・織田騎馬。',
            '勝利：織田方の本陣を敗走させる。または、敵の本陣以外の部隊をすべて戦えなくする。',
        );
    } else {
        lines.push(
            '方針：自領の防衛を優先する。国境の村を荒らす浪人衆（架空の一団）を退ける。織田・浅井のどちらとも戦わない。',
            '岡崎の守備隊が左前の国境の砦に孤立している。浪人衆の弓が届き、西の林から浪人衆の騎馬が回り込んでくる。',
            '勝利：浪人衆の本隊を敗走させる。または、浪人衆の本隊以外の部隊をすべて戦えなくする。',
        );
    }
    lines.push(
        '敗北：家康本陣が敗走する（家康は落ち延びる）。または、本陣以外の味方がすべて戦えなくなり、崩れた部隊の方が多い。一度の敗北で家が滅ぶことはない。',
        '撤退：「全軍撤退」を命じる。本陣以外の部隊をすべて退かせる。または、日没（8 分）で両軍が引く。',
    );
    // 約束は画面の上の方に（説明の枠が小さい画面でも、下まで送らずに読める）
    const target = policy === 'oda' ? '織田援軍' : policy === 'asai' ? '浅井長政隊' : '岡崎の守備隊';
    if (pledgeAccepted) {
        lines.push(
            `約束（引き受けた）：${target}の退路を守る。`,
            `達成：${target}が、南の「味方の陣」（家康本陣の後ろの輪）に ${IEYASU_PLEDGE_HOLD_SEC} 秒以上とどまる、または撤退の命令で退き口から離れる、または合戦の終わりに戦えている — そのうえで兵が最初の ${Math.round(IEYASU_PLEDGE_MIN_RATIO * 100)}% 以上残っていること。`,
            `${target}が敗走・全滅すると守れない。近くに一瞬立っただけでは達成にならない。敵と斬り合う前に（${target}が斬り合うか、味方が合わせて ${RULES.pledgeContestMeleeSec} 秒斬り結ぶ前に）撤退・敗北で終えると、守ったことにならない（勝利・日没なら要らない）。勝敗とは別に判定する。`,
        );
    } else {
        lines.push(`約束：引き受けていない（${target}の退路を守る約束はない。約束違反にはならない）。`);
    }
    lines.push(
        '特殊能力（ゲーム用の創作。各 1 合戦 1 回）：家康本陣「立て直しの号令」・本多忠勝隊「退路の守護」' + (policy === 'asai' ? '・浅井長政隊「盟友への援護」' : '') + '。部隊を選ぶと効果と代償が見える。',
        '追い討ち：撤退の命令で退く部隊は、近くの敵に追われて背後を突かれる（騎馬は遠くからでも追う）。退路の守護の範囲で退けば、追っ手は忠勝隊に阻まれる。',
    );
    return lines;
}

/** 歴史分岐「元亀元年・家康」の合戦の設定一式（国境の原を流用。約束を引き受けたときだけ pledge を付ける） */
export function ieyasu1570Setup(policy: IeyasuPolicy, opts: IeyasuSetupOptions): BattleSetup {
    const setup: BattleSetup = buildBattleSetup(BORDER_FIELD_DEF, ieyasuUnits(policy, opts.troops), {
        objectives: 'none',
        timeLimitSec: BORDER_FIELD_TIME_LIMIT,
        briefing: ieyasuBriefing(policy, opts.pledgeAccepted),
        // 退く部隊への追い討ち（歴史分岐の合戦だけ。退路の守護・約束の退路に意味を持たせる）
        pursuit: true,
    });
    // 約束は、対象の部隊が合戦に出るときだけ（兵のいない部隊は出ない）
    if (opts.pledgeAccepted && setup.units.some((u) => u.id === IEYASU_PLEDGE_TARGET[policy])) {
        setup.pledge = {
            targetId: IEYASU_PLEDGE_TARGET[policy],
            safeZone: { ...IEYASU_SAFE_ZONE },
            holdSec: IEYASU_PLEDGE_HOLD_SEC,
            minStrengthRatio: IEYASU_PLEDGE_MIN_RATIO,
        };
    }
    return setup;
}
