/**
 * 歴史分岐「元亀元年・家康」の模式図の地図の部品（場所・関係の線・進路）。純粋な関数（状態を読むだけ）。
 * 設計：docs/story-rpg-design.md §2・§4。型：story/types.ts（MapPlace・MapRoute・MapScene）。位置は geo.ts。
 *
 * ＊＊ 模式図。国・城・道の位置と距離は正確ではない（MAP_NOTE を必ず出す） ＊＊
 * - 関係（色だけでなく記号と名前で区別する）は状態から決める：
 *   第一章の方針の前は「織田と協力してきた」「浅井とは別の家」まで（朝倉・浪人はまだ分からない）。
 *   方針の後（第二章も同じ）は A 織田と協力・浅井と朝倉は敵対／B 浅井と協力・織田は敵対（史実から分かれた道）／
 *   C 両家と戦わない・浪人は敵対。
 * - 場所の名前は今ある文の言葉だけ（徳川の城下・三河・近江・国境・国境の原・第二章の任務の名前）。城・町の名前は出さない。
 */
import type { BattleResultKind } from '../../../battle/types';
import type { MapPlace, MapRoute, MapScene, MapSide } from '../../../story/types';
import { CH2_MAP_NAMES } from '../chapter2/battle';
import { isChapter2, type IeyasuAnyState } from '../chapter2/state';
import { IEYASU_RESULT_LABELS } from '../story';
import type { Policy } from '../state';
import { CH2_SITE, MAP_NOTE, MAP_POS, type GeoId } from './geo';

export { MAP_NOTE };

/** 相手の家・一団 */
export type PartyId = 'oda' | 'asai' | 'asakura' | 'ronin';
export const PARTY_NAMES: Readonly<Record<PartyId, string>> = { oda: '織田家', asai: '浅井家', asakura: '朝倉家', ronin: '浪人の一団' };
export const PARTY_MARKS: Readonly<Record<PartyId, string>> = { oda: '織', asai: '浅', asakura: '朝', ronin: '浪' };
/** 関係の記号（地図の凡例と同じ：◎ 自分・○ 協力・✕ 敵対・△ 敵対していない・？ まだ分からない） */
export const SIDE_SYMBOLS: Readonly<Record<MapSide, string>> = { self: '◎', ally: '○', enemy: '✕', neutral: '△', unknown: '？' };

/** 方針ごとの関係（方針の前は null） */
export function relationsOf(policy: Policy | null): Record<PartyId, MapSide> {
    switch (policy) {
        case null:
            return { oda: 'ally', asai: 'neutral', asakura: 'unknown', ronin: 'unknown' };
        case 'oda':
            return { oda: 'ally', asai: 'enemy', asakura: 'enemy', ronin: 'unknown' };
        case 'asai':
            return { oda: 'enemy', asai: 'ally', asakura: 'unknown', ronin: 'unknown' };
        case 'home':
            return { oda: 'neutral', asai: 'neutral', asakura: 'unknown', ronin: 'enemy' };
    }
}

/** 第一章の合戦の結果（第一章の戦後・結末、第二章では記録から。合戦の前は null） */
export function ch1ResultOf(s: IeyasuAnyState): BattleResultKind | null {
    if (isChapter2(s)) return s.chapter1.battle.result;
    return s.battle?.result ?? null;
}

/** 家・一団の場所（関係は rel から） */
export function partyPlace(id: PartyId, rel: Record<PartyId, MapSide>): MapPlace {
    if (id === 'ronin') return { id: 'border', name: '国境', ...MAP_POS.border, kind: 'region', side: rel.ronin, mark: PARTY_MARKS.ronin, note: '浪人の一団が村を荒らす' };
    const pos = MAP_POS[id];
    const note = id === 'asai' ? '近江' : undefined;
    return { id, name: PARTY_NAMES[id], ...pos, kind: 'site', side: rel[id], mark: PARTY_MARKS[id], ...(note ? { note } : {}) };
}

/** 徳川の城下（自分） */
export function homePlace(): MapPlace {
    return { id: 'home', name: '徳川の城下', ...MAP_POS.home, kind: 'home', side: 'self', mark: '徳', note: '三河' };
}

/**
 * 第一章の合戦の場所「国境の原」。結果があれば印（勝利は自分が保った・撤退と敗北は相手が残った）。
 * result を省けば、結果の前（まだ分からない）。
 */
export function field1Place(result: BattleResultKind | null): MapPlace {
    const base = { id: 'field1', name: '国境の原', ...MAP_POS.field1, kind: 'field' as const };
    if (!result) return { ...base, side: 'unknown', note: '架空の局地戦' };
    return { ...base, side: result === 'victory' ? 'self' : 'enemy', note: `第一章：${IEYASU_RESULT_LABELS[result]}` };
}

/** 第二章の任務の場所（救う相手・守る所。結果があれば印） */
export function ch2SitePlace(policy: Policy, result: BattleResultKind | null = null): MapPlace {
    const id = CH2_SITE[policy];
    // 誰がいる所か：A 退いてくる織田勢（協力）・B 囲まれた浅井勢（協力）・C 領内の村（自分）
    const side: MapSide = result && result !== 'victory' && policy === 'home' ? 'enemy' : policy === 'home' ? 'self' : 'ally';
    const note = result ? `第二章：${IEYASU_RESULT_LABELS[result]}` : policy === 'oda' ? '織田勢が退く' : policy === 'asai' ? '囲まれている' : '浪人衆が迫る';
    return { id, name: CH2_MAP_NAMES[policy], ...MAP_POS[id], kind: policy === 'home' ? 'village' : 'field', side, note };
}

/** 方針ごとの関係の線（自分の城下から。C は浪人へ。方針の前は織田との協力だけ） */
export function relationRoutes(policy: Policy | null): MapRoute[] {
    switch (policy) {
        case null:
            return [{ id: 'rel.oda', from: 'home', to: 'oda', kind: 'alliance', side: 'ally', label: 'これまで協力' }];
        case 'oda':
            return [
                { id: 'rel.oda', from: 'home', to: 'oda', kind: 'alliance', side: 'ally', label: '協力' },
                { id: 'rel.asai', from: 'home', to: 'asai', kind: 'hostile', side: 'enemy', label: '敵対' },
                { id: 'rel.asakura', from: 'home', to: 'asakura', kind: 'hostile', side: 'enemy' },
            ];
        case 'asai':
            return [
                { id: 'rel.asai', from: 'home', to: 'asai', kind: 'alliance', side: 'ally', label: '協力（分かれた道）' },
                { id: 'rel.oda', from: 'home', to: 'oda', kind: 'hostile', side: 'enemy', label: '敵対' },
            ];
        case 'home':
            return [{ id: 'rel.border', from: 'home', to: 'border', kind: 'hostile', side: 'enemy', label: '浪人を討つ' }];
    }
}

/** 背景の対立（近江で織田と浅井・朝倉が敵味方に分かれた。徳川の関係とは別なので「敵対していない」の色） */
export function conflictRoutes(): MapRoute[] {
    return [
        { id: 'conflict.asai', from: 'oda', to: 'asai', kind: 'hostile', side: 'neutral', label: '近江で対立' },
        { id: 'conflict.asakura', from: 'oda', to: 'asakura', kind: 'hostile', side: 'neutral' },
    ];
}

/** 両家の使者（第一章の始め） */
export function envoyRoutes(): MapRoute[] {
    return [
        { id: 'envoy.oda', from: 'oda', to: 'home', kind: 'envoy', side: 'ally', label: '使者' },
        { id: 'envoy.asai', from: 'asai', to: 'home', kind: 'envoy', side: 'neutral', label: '使者（人目を避けて）' },
    ];
}

/** 出陣の進路（城下から戦場へ） */
export function marchRoute(to: GeoId, label = '出陣'): MapRoute {
    return { id: `march.${to}`, from: 'home', to, kind: 'march', side: 'self', label };
}

/** 帰還の進路（戦場から城下へ） */
export function returnRoute(from: GeoId, label = '帰還'): MapRoute {
    return { id: `return.${from}`, from, to: 'home', kind: 'withdraw', side: 'self', label };
}

/** 第二章の危機の脅かす向き（誰が来るか。向きは推定で、正確な位置ではない） */
export function threatRoute(policy: Policy): MapRoute {
    const site = CH2_SITE[policy];
    switch (policy) {
        case 'oda':
            return { id: 'threat.oda', from: 'asai', to: site, kind: 'threat', side: 'enemy', label: '浅井・朝倉の追っ手' };
        case 'asai':
            return { id: 'threat.asai', from: 'oda', to: site, kind: 'threat', side: 'enemy', label: '織田方の囲み' };
        case 'home':
            return { id: 'threat.home', from: 'border', to: site, kind: 'threat', side: 'enemy', label: '浪人衆' };
    }
}

/** 地図の場面を組み立てる（同じ id の場所・線は 1 つにまとめる。注記は必ず付ける） */
export function scene(places: MapPlace[], routes: MapRoute[], opts: { heading?: string; highlight?: string[] } = {}): MapScene {
    const ps = new Map<string, MapPlace>();
    for (const p of places) if (!ps.has(p.id)) ps.set(p.id, p);
    const rs = new Map<string, MapRoute>();
    for (const r of routes) if (!rs.has(r.id) && ps.has(r.from) && ps.has(r.to)) rs.set(r.id, r);
    const out: MapScene = { places: [...ps.values()], routes: [...rs.values()], note: MAP_NOTE };
    if (opts.heading) out.heading = opts.heading;
    if (opts.highlight?.length) out.highlight = opts.highlight.filter((id) => ps.has(id) || rs.has(id));
    return out;
}

/** 家・一団の場所をまとめて（関係は方針から） */
export function partyPlaces(policy: Policy | null): MapPlace[] {
    const rel = relationsOf(policy);
    return (['oda', 'asai', 'asakura', 'ronin'] as const).map((id) => partyPlace(id, rel));
}

/** 関係の 1 行（記号＋名前＋添え書き）。情勢の画面の協力・敵対の欄 */
export function partyLine(id: PartyId, side: MapSide, note?: string): string {
    return `${SIDE_SYMBOLS[side]} ${PARTY_NAMES[id]}${note ? `（${note}）` : ''}`;
}
