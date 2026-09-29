/**
 * 戦場「国境の原」（border_field）のデータ。架空の第一章と、歴史分岐「元亀元年・家康」の章の合戦の戦場（Version 11 と同じ）。
 * battle/maps.ts の BORDER_FIELD・BORDER_FIELD_POS・IEYASU_POS・demoSetup・ieyasu1570Setup は、このデータから作る。
 * 値を変えると Version 11 の合戦の結果が変わる（tests/proto3d-battle-v11-identity.test.ts が見張る）。
 *
 * - 360 m × 300 m。味方は南、敵は北。
 * - 北の中央に丘（敵本陣。中心 (0,-100)、半径 70 m、高さ 12 m）。
 * - 西に林（山道の続き。x -180〜-85）。中の部隊は相手から見えない（60 m 以内に来るまで）。
 * - 東に川沿いの湿地（x 122〜180、z -45〜150）。とても遅い。その西側（x 90〜120）は乾いた川沿いの道筋。
 * - 中央を南北に道。
 * - 退き口：味方は南の端、敵は北の端。
 * - 地形の上書き・特殊ルールは無い（既定の決まりのまま）。章の合戦は目標を付けない（今までの勝ち負け）。演習の編成は仮シナリオの標準の布陣。
 */
import type { BattlefieldDef, DeploySlot } from './types';

const N = 0; // 北向き
const S = Math.PI; // 南向き

/** 味方の配置の枠（maps.ts の BORDER_FIELD_POS・IEYASU_POS の味方の分） */
const ALLY: DeploySlot[] = [
    { id: 'allyHq', x: 0, z: 110, facing: N, note: '本陣' },
    { id: 'allyFront', x: 0, z: 50, facing: N, note: '正面' },
    { id: 'allyRight', x: 45, z: 70, facing: N, note: '右' },
    { id: 'allyRightWing', x: 85, z: 55, facing: N, note: '右翼（大森勢と組んだとき）' },
    { id: 'allyWoods', x: -140, z: 80, facing: N, note: '左の林（山道から着く別働隊）' },
    { id: 'allyReserve', x: 0, z: 135, facing: N, note: '本陣の後ろ（予備隊）' },
    { id: 'odaForward', x: 60, z: 5, facing: N, note: '右前（歴史分岐 A：突出した織田援軍）' },
    { id: 'nagamasaForward', x: -45, z: -5, facing: N, note: '左前（歴史分岐 B：浅井長政隊）' },
    { id: 'fort', x: -75, z: 5, facing: N, note: '左前の国境の砦（歴史分岐 C：岡崎の守備隊）' },
];
/** 敵の配置の枠 */
const ENEMY: DeploySlot[] = [
    { id: 'enemyHq', x: 0, z: -105, facing: S, note: '丘の上の本陣' },
    { id: 'enemyFront', x: 0, z: -50, facing: S, note: '丘の前の先手' },
    { id: 'enemyRight', x: 45, z: -70, facing: S, note: '丘の東の肩' },
    { id: 'enemyEast', x: 110, z: -95, facing: S, note: '東の湿地の北（右から回り込む）' },
    { id: 'enemyWoods', x: -135, z: -60, facing: S, note: '西の林（左から回り込む）' },
    { id: 'enemyReserve', x: 0, z: -138, facing: S, note: '丘の後ろ（予備隊）' },
    { id: 'enemyLeft', x: -45, z: -70, facing: S, note: '丘の西の肩' },
];

export const BORDER_FIELD_DEF: BattlefieldDef = {
    id: 'border_field',
    name: '国境の原',
    kind: 'plains',
    summary: '丘に陣取る敵を、林と湿地に挟まれた原で迎え撃つ（架空の第一章・歴史分岐の章の戦場）',
    width: 360,
    depth: 300,
    terrain: [
        { kind: 'road', rect: { x0: -7, x1: 7, z0: -150, z1: 150 } },
        { kind: 'hill', circle: { cx: 0, cz: -100, r: 70 }, height: 12 },
        { kind: 'woods', rect: { x0: -180, x1: -85, z0: -150, z1: 95 } },
        { kind: 'marsh', rect: { x0: 122, x1: 180, z0: -45, z1: 150 } },
    ],
    deployments: { ally: ALLY, enemy: ENEMY },
    exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } },
    objectives: {
        primary: { id: 'border_hq', type: 'destroy_hq', label: '敵の本陣を崩す' },
        secondary: [],
    },
    timeLimitSec: 480,
    briefing: [
        '（仮シナリオ）国境の原で、丘に陣取る鷲尾勢を迎え撃つ。',
        '丘の上の敵を正面から押すと不利。林は敵から見えない。側面・背後を突くと大きく崩せる。',
    ],
    tactics: ['弓で丘の前の先手を誘い出し、平地で両側から挟む', '林の中を見られずに進み、本陣の横を突く'],
    presets: [
        {
            id: 'alone',
            name: '独力（仮シナリオの標準の布陣）',
            summary: '味方 4／敵 4。架空の第一章で田代・大森と組まないときと同じ布陣',
            units: [
                { id: 'a_hq', side: 'ally', clan: 'kotosaka', kind: 'honjin', name: '若殿本陣', leaderId: 'hero', strength: 300, morale: 90, slot: 'allyHq' },
                { id: 'a_genzo', side: 'ally', clan: 'kotosaka', kind: 'yari', name: '源蔵隊', leaderId: 'genzo', strength: 500, morale: 80, slot: 'allyFront' },
                { id: 'a_shinpachi', side: 'ally', clan: 'kotosaka', kind: 'yumi', name: '新八隊', leaderId: 'shinpachi', strength: 350, morale: 75, slot: 'allyRight' },
                { id: 'a_reserve', side: 'ally', clan: 'kotosaka', kind: 'yari', name: '琴坂予備隊', strength: 300, morale: 75, slot: 'allyReserve' },
                { id: 'e_hq', side: 'enemy', clan: 'washio', kind: 'honjin', name: '鷲尾本陣', leaderId: 'washio_gen', strength: 350, morale: 90, aiRole: 'guard_hq', slot: 'enemyHq' },
                { id: 'e_sente', side: 'enemy', clan: 'washio', kind: 'yari', name: '鷲尾先手', strength: 550, morale: 80, aiRole: 'hold_line', slot: 'enemyFront' },
                { id: 'e_yumi', side: 'enemy', clan: 'washio', kind: 'yumi', name: '鷲尾弓隊', strength: 350, morale: 75, aiRole: 'hold_line', slot: 'enemyRight' },
                { id: 'e_reserve', side: 'enemy', clan: 'washio', kind: 'yari', name: '鷲尾予備隊', strength: 350, morale: 75, aiRole: 'reserve', slot: 'enemyReserve' },
            ],
        },
    ],
};

/** 配置の枠を名前で引く（maps.ts が布陣の位置の表を作るのに使う） */
export function borderSlot(side: 'ally' | 'enemy', id: string): { x: number; z: number; facing: number } {
    const d = BORDER_FIELD_DEF.deployments[side].find((s) => s.id === id);
    if (!d) throw new Error(`国境の原に配置の枠 ${id} がありません`);
    return { x: d.x, z: d.z, facing: d.facing };
}
