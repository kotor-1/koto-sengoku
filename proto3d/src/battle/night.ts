/**
 * 夜（第4群。docs/fields-group4-design.md §4）：視界と発見。純粋な TypeScript（three・DOM なし）。
 *
 * BattleSetup.night のある合戦だけ、sim.ts の updateVisibility が nightSeen で「その部隊が相手の陣営に発見されているか」（seenBy）を決める。
 * - 未発見の部隊は、相手の戦える部隊のどれかから detectRange m 以内に来たら発見される（林など隠れる地形の中なら、その地形の距離との短い方）。
 * - 篝火の区域（torchZones）の中にいる部隊は、torchRange m（省けば detectRange の 2 倍）から見つかる（隠れる地形の中でも）。
 * - 物見（lookouts）の部隊は range m から見つける（隠れる地形の中の相手は、その地形の距離まで）。
 * - 高所の見通し（highGround.sightBonus）は、昼と同じく見つける側が高い所にいれば足す。
 * - 発見済みの部隊は、相手の戦える部隊のどれかから sight m 以内にいる間は見え続ける（離れると見失う）。
 * - 斬り合う・矢を射ると、その相手の陣営に発見される（前の刻みの斬り合い・射撃を見る）。
 * 発見していない相手は、攻撃の命令の相手にならない（sim.ts の issueOrder）。敵の考え（ai.ts）・武将の自由な動き・待機の弓の相手選びは、
 * もともと見えている相手（seenBy）だけを見るので、夜は発見済みの相手だけを狙う・追う。
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleSetup, NightRule, Side, Zone } from './types';
import type { BattleState, UnitState } from './sim';
import { hideSightIn, inZone, terrainElevation, zoneCenter } from './fieldRules';

function active(u: UnitState): boolean {
    return u.present && u.status === 'ready';
}

/** 篝火の区域の中か */
export function inTorch(n: NightRule, x: number, z: number): boolean {
    return !!n.torchZones?.some((t) => inZone(t, x, z));
}

/** 篝火の中の部隊が見つかる距離 */
export function torchRangeOf(n: NightRule): number {
    return n.torchRange ?? n.detectRange * 2;
}

/**
 * 夜：部隊 u が、相手の陣営に発見されているか（was は前の刻みに発見されていたか）。戦場にいない部隊は false
 */
export function nightSeen(s: BattleState, u: UnitState, was: boolean): boolean {
    const n = s.setup.night!;
    if (!u.present) return false;
    const opp: Side = u.side === 'ally' ? 'enemy' : 'ally';
    const torch = inTorch(n, u.x, u.z);
    const hide = hideSightIn(s.map, s.field, u.x, u.z);
    const base = torch ? torchRangeOf(n) : hide !== null ? Math.min(n.detectRange, hide) : n.detectRange;
    const high = s.field.high;
    for (const o of s.units) {
        if (o.side !== opp || !active(o)) continue;
        // 斬り合い・射撃の相手には見つかる
        if (o.engagedWith === u.id || u.engagedWith === o.id || u.shootingAt === o.id) return true;
        const d = Math.hypot(o.x - u.x, o.z - u.z);
        let r = base;
        const look = n.lookouts?.find((l) => l.unitId === o.id);
        if (look) r = !torch && hide !== null ? Math.max(base, Math.min(look.range, hide)) : Math.max(base, look.range);
        if (high.sightBonus > 0 && terrainElevation(s.map, o.x, o.z) >= high.minDiff) r += high.sightBonus;
        if (d <= r) return true;
        if (was && d <= n.sight) return true;
    }
    return false;
}

/** 地図の名札（篝火の区域）。夜でない合戦は空 */
export function nightLabels(setup: BattleSetup): { id: string; text: string; x: number; z: number; y: number }[] {
    const n = setup.night;
    if (!n) return [];
    return (n.torchZones ?? []).map((z: Zone, i) => {
        const c = zoneCenter(z);
        const r = z.circle ? z.circle.r : z.rect ? (z.rect.z1 - z.rect.z0) / 2 : 0;
        return { id: `torch${i}`, text: `${n.torchNames?.[i] ?? '篝火'}（中は見つかりやすい）`, x: c.x, z: c.z + r + 4, y: 1 };
    });
}

/** 戦場の決まりの短い説明（夜・追い討ち）。夜でも追い討ちでもない合戦は空 */
export function nightRuleTexts(setup: BattleSetup): string[] {
    const out: string[] = [];
    const n = setup.night;
    if (n) {
        out.push(`夜：敵も味方も、発見した相手だけが見える。未発見の相手は ${n.detectRange} m まで近づくと見つかる（林の中はもっと近く）。見つけた相手は ${n.sight} m より離れると見失う`);
        if (n.torchZones?.length) out.push(`篝火：中にいる部隊は ${torchRangeOf(n)} m から見つかる（敵味方とも）`);
        if (n.lookouts?.length) out.push(`物見：敵の見張りは ${Math.max(...n.lookouts.map((l) => l.range))} m 先まで見つける`);
        out.push('斬り合う・矢を射ると、その相手に見つかる。見つかっていない部隊は攻撃の相手に選べない（敵も同じ）');
    }
    if (setup.pursuit) out.push('追い討ち：敵は、撤退の命令で退く部隊を追って斬りかかる（退路の守護の範囲の中では、追っ手が守護の部隊に阻まれる）');
    return out;
}
