/**
 * 演習の編成で使う部隊の小道具（データを短く書くため）。武将の表示名は「家康本陣」「本多忠勝隊」など。
 * 敵は架空の「敵勢」（家 rival）。部隊の名前・兵・配置はゲーム用の創作（史実の合戦の再現ではない）。
 *
 * 能力：家康本陣・本多忠勝隊は今ある能力（立て直しの号令・退路の守護）を持たせる。酒井・石川・榊原の仮の能力は、
 * 武将のデータ（battle/generals.ts の abilityId）と abilities.ts の担当が結び付ける（ここでは generalId だけを入れる）。
 */
import type { UnitKind } from '../types';
import type { PresetUnit } from './types';

type Extra = Partial<Omit<PresetUnit, 'id' | 'side' | 'clan' | 'kind' | 'name' | 'strength' | 'morale'>>;

/** 徳川方の武将の部隊（味方） */
export const T = {
    ieyasu: (slot: string, strength = 300, x: Extra = {}): PresetUnit => ({ id: 'a_ieyasu', side: 'ally', clan: 'tokugawa', kind: 'honjin', name: '家康本陣', generalId: 'ieyasu', strength, morale: 90, ability: 'ieyasu_rally', slot, ...x }),
    tadakatsu: (slot: string, strength = 450, x: Extra = {}): PresetUnit => ({ id: 'a_tadakatsu', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '本多忠勝隊', generalId: 'tadakatsu', strength, morale: 85, ability: 'tadakatsu_rearguard', slot, ...x }),
    sakakibara: (slot: string, kind: UnitKind = 'yari', strength = 400, x: Extra = {}): PresetUnit => ({ id: 'a_sakakibara', side: 'ally', clan: 'tokugawa', kind, name: '榊原康政隊', generalId: 'sakakibara', strength, morale: 80, slot, ...x }),
    sakai: (slot: string, strength = 400, x: Extra = {}): PresetUnit => ({ id: 'a_sakai', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '酒井忠次隊', generalId: 'sakai', strength, morale: 80, slot, ...x }),
    ishikawa: (slot: string, strength = 350, x: Extra = {}): PresetUnit => ({ id: 'a_ishikawa', side: 'ally', clan: 'tokugawa', kind: 'yari', name: '石川数正隊', generalId: 'ishikawa', strength, morale: 80, slot, ...x }),
    yumi: (slot: string, strength = 350, x: Extra = {}): PresetUnit => ({ id: 'a_yumi', side: 'ally', clan: 'tokugawa', kind: 'yumi', name: '徳川弓隊', strength, morale: 75, slot, ...x }),
    kiba: (slot: string, strength = 250, x: Extra = {}): PresetUnit => ({ id: 'a_kiba', side: 'ally', clan: 'tokugawa', kind: 'kiba', name: '徳川騎馬隊', strength, morale: 80, slot, ...x }),
};

/** 敵勢の部隊（架空の相手） */
export function E(id: string, kind: UnitKind, name: string, strength: number, morale: number, slot: string, x: Extra = {}): PresetUnit {
    return { id, side: 'enemy', clan: 'rival', kind, name, strength, morale, slot, ...x };
}
