/**
 * 合戦場の演習（5 戦場）の、能力を使わない台本の結果の記録：武将の基本方針（自由な動き。BattleSetup.generalInitiative。Version 13 候補で入れた）の
 * あり／なしで比べる（docs/troops-abilities-design.md §3・§5。Version 13 候補の確認で「能力を使わない演習の台本の結果も、自由な動きで変わる。
 * 1 刻みの基準が無く変化が隠れうるので、前後を記録すべき」と指摘された）。どれも「早送り」。
 *
 * - なし（generalInitiative: false）：Version 12（17a3144 のコード）で同じ台本を進めた結果と、勝敗・理由・時刻・損害・断られた命令・副目標・
 *   全部隊の兵の残りまで同じ（基準 tests/fixtures/v12-fields-noability.json。17a3144 の作業木で tests/proto3d-fields-noability-scripts.ts の
 *   playRecord(…, true) を進めて作った。Version 12 には自由な動きが無いので、それが Version 12 の動き）。
 *   ＝ Version 13 候補で変えた能力の数値・兵士の表示・名札の UI は、能力を使わない演習の台本を 1 つも変えていない。変えたのは自由な動きだけ。
 * - あり（Version 13 候補の演習の既定）：基準 tests/fixtures/v13-fields-noability-initiative.json と同じ。17 台本のうち 5 台本で結果の数字が変わる。
 *   勝敗・理由・副目標の達成は、どの台本も Version 12 と同じ。
 *
 * 変わる台本（Version 12 → Version 13 候補。2026-09-30）：
 * - 大平原・地形に合った作戦（FIT）：勝ち 213.8 → 213.4 秒・味方の損害 46.0 → 46.6%（忠勝隊 204 → 153・石川隊 280 → 319）。
 * - 大平原・予備隊を始めから右翼へ（RESERVE_EARLY）：勝ち 204.7 → 215.4 秒・味方の損害 37.4 → 48.3%（酒井隊 200 → 114・弓隊 350 → 168。
 *   待機中の酒井隊・忠勝隊が隣の味方の相手へ自分から当たる）。副目標（予備隊を崩さず）は前後とも果たせない。
 * - 丘陵・回り込み（FLANK）：勝ち 324.7 秒のまま・損害 11.8 → 10.3%。酒井隊が東の坂で待つ間に後詰めへ横から当たり、後詰めが先に崩れるので
 *   134 秒の榊原隊の攻撃の命令が断られる（前は断られた命令なし）。tests/proto3d-field-hills.test.ts の注と同じ。
 * - 丘陵・回り込み・弓を崩さない（FLANK_NO_ARCHERS）：勝ち 279.6 → 275.9 秒・損害 34.0 → 33.6%。同じく 134 秒の榊原隊の攻撃が断られる。
 * - 山道・何もしない：負け 169.6 → 174.1 秒・損害 43.6 → 44.8%（忠勝隊が関へ出て受ける＝忠勝隊 97 → 255・酒井隊 136 → 35・弓隊 103 → 0）。
 * 変わらない台本（12）：大平原・何もしない／丘陵・何もしない・頂を取る・正面から（2 通り）／河川・浅瀬の 3 台本／森林の 2 台本／山道・関の守り（2 通り）。
 */
import { describe, expect, it } from 'vitest';
import { SCRIPTS, playRecord, type Rec } from './proto3d-fields-noability-scripts';
import v12Json from './fixtures/v12-fields-noability.json';
import v13Json from './fixtures/v13-fields-noability-initiative.json';

const V12 = v12Json as Record<string, Rec>;
const V13 = v13Json as Record<string, Rec>;
/** 自由な動きで数字が変わる台本（上の注の 5 台本） */
const CHANGED = ['plains／地形に合った作戦（FIT）', 'plains／予備隊を始めから右翼へ（RESERVE_EARLY）', 'hills／回り込み（FLANK）', 'hills／回り込み・弓を崩さない（FLANK_NO_ARCHERS）', 'mountain_pass／何もしない'];

describe('演習の能力を使わない台本：武将の自由な動き なし は Version 12 と同じ（兵の残りまで）', () => {
    for (const [field, name, steps] of SCRIPTS) {
        it(`${field}／${name}`, () => {
            expect(playRecord(field, steps, false)).toEqual(V12[`${field}／${name}`]);
        });
    }
});

describe('演習の能力を使わない台本：武将の自由な動き あり（Version 13 候補の既定）の記録', () => {
    for (const [field, name, steps] of SCRIPTS) {
        const key = `${field}／${name}`;
        it(`${key}：記録と同じ。勝敗・理由・副目標は Version 12 と同じ${CHANGED.includes(key) ? '（数字は変わる）' : '（数字も同じ）'}`, () => {
            const on = playRecord(field, steps, true);
            expect(on).toEqual(V13[key]);
            const v12 = V12[key]!;
            expect([on.result, on.reason, on.secondary]).toEqual([v12.result, v12.reason, v12.secondary]);
            if (CHANGED.includes(key)) expect(on).not.toEqual(v12);
            else expect(on).toEqual(v12);
        });
    }
    it('記録の一覧は台本と同じ 17 台本（変わる台本は 5）', () => {
        expect(Object.keys(V12).sort()).toEqual(SCRIPTS.map(([f, n]) => `${f}／${n}`).sort());
        expect(Object.keys(V13).sort()).toEqual(Object.keys(V12).sort());
        expect(Object.keys(V13).filter((k) => JSON.stringify(V13[k]) !== JSON.stringify(V12[k])).sort()).toEqual([...CHANGED].sort());
    });
});
