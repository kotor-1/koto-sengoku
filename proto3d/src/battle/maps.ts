/**
 * 戦場の地図と、開発・テスト用の標準の布陣（仮シナリオ）。純粋な TypeScript。
 *
 * > 仮シナリオ：部隊名・人物・家は架空の仮の設定（docs/chapter1-spec.md §0）。
 *
 * - BORDER_FIELD：戦場「国境の原」（border_field）。360 m × 300 m。味方は南、敵は北。
 * - BORDER_FIELD_POS：布陣の位置（章の進行が部隊を作るときにも使える）。
 * - demoUnits(alliance, opts)：協力陣営ごとの標準の部隊（兵・士気・位置・役割）。合戦の釣り合いのテストはこの布陣で確かめている。
 *   章の進行（campaign）は、これを元に兵・名前・率いる人物を差し替えて使うと、釣り合いを保ちやすい。
 * - demoSetup(alliance)：合戦の設定一式（開発の確認用。説明文は仮）。
 */
import type { BattleMap, BattleSetup, UnitDef } from './types';

/** 協力陣営の選択 */
export type Alliance = 'tashiro' | 'omori' | 'alone';

/**
 * 戦場「国境の原」。
 * - 北の中央に丘（敵本陣。中心 (0,-100)、半径 70 m、高さ 12 m）。
 * - 西に林（山道の続き。x -180〜-85）。中の部隊は相手から見えない（60 m 以内に来るまで）。
 * - 東に川沿いの湿地（x 122〜180、z -45〜150）。とても遅い。その西側（x 90〜120）は乾いた川沿いの道筋。
 * - 中央を南北に道。
 * - 退き口：味方は南の端、敵は北の端。
 */
export const BORDER_FIELD: BattleMap = {
    id: 'border_field',
    name: '国境の原',
    width: 360,
    depth: 300,
    terrain: [
        { kind: 'road', rect: { x0: -7, x1: 7, z0: -150, z1: 150 } },
        { kind: 'hill', circle: { cx: 0, cz: -100, r: 70 }, height: 12 },
        { kind: 'woods', rect: { x0: -180, x1: -85, z0: -150, z1: 95 } },
        { kind: 'marsh', rect: { x0: 122, x1: 180, z0: -45, z1: 150 } },
    ],
    exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } },
};

const N = 0; // 北向き
const S = Math.PI; // 南向き

/** 布陣の位置（x, z, 向き） */
export const BORDER_FIELD_POS = {
    /** 味方 */
    allyHq: { x: 0, z: 110, facing: N },
    allyFront: { x: 0, z: 50, facing: N },
    allyRight: { x: 45, z: 70, facing: N },
    /** 右翼（大森勢と組んだとき） */
    allyRightWing: { x: 85, z: 55, facing: N },
    /** 左の林（山道から着く別働隊） */
    allyWoods: { x: -140, z: 80, facing: N },
    /** 本陣の後ろ（予備隊） */
    allyReserve: { x: 0, z: 135, facing: N },
    /** 敵 */
    enemyHq: { x: 0, z: -105, facing: S },
    enemyFront: { x: 0, z: -50, facing: S },
    enemyRight: { x: 45, z: -70, facing: S },
    /** 東の湿地の北（右から回り込む） */
    enemyEast: { x: 110, z: -95, facing: S },
    /** 西の林（左から回り込む） */
    enemyWoods: { x: -135, z: -60, facing: S },
    /** 丘の後ろ（予備隊） */
    enemyReserve: { x: 0, z: -138, facing: S },
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
export const BORDER_FIELD_TIME_LIMIT = 480;

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
        '敗北：味方の本陣が敗走する（若殿は落ち延びる）。または、味方の本陣以外の部隊がすべて戦えなくなる。',
        '撤退：「全軍撤退」を命じる。または、日没（8 分）で両軍が引く。',
        '丘の上の敵を正面から押すと不利。林は敵から見えない。側面・背後を突くと大きく崩せる。',
    ];
}

/** 開発・確認用の合戦の設定一式 */
export function demoSetup(alliance: Alliance, opts: DemoOptions = {}): BattleSetup {
    return {
        map: BORDER_FIELD,
        units: demoUnits(alliance, opts),
        timeLimitSec: BORDER_FIELD_TIME_LIMIT,
        briefing: standardBriefing(alliance),
    };
}
