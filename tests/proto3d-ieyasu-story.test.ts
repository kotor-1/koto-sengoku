/**
 * 歴史分岐シナリオ「元亀元年・家康」の文章と城下の配役（proto3d/src/campaign/ieyasu1570/story.ts・scenario.ts）：
 * - 史実と創作の区別：注記がある、B は「史実から分かれた道」、C は宣戦ではない、合戦は「架空の局地戦」で姉川の再現とは書かない、
 *   資料で確かめていない逸話（単騎突入・生涯無傷）を事実として書かない、家が滅ぶ・家康が死ぬ文が無い。
 * - どの段階・方針・結果でも台詞と結末が作れる。
 * - 城下の配役：置き場所が壁や互いに重ならず、開始の位置から歩いて話しかけられる。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { finishTalkIeyasu, newIeyasuGame, presentIeyasuTalks, talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuCastFor, ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { POLICIES, PLEDGE_SPECS, type IeyasuState, type PledgeResult } from '../proto3d/src/campaign/ieyasu1570/state';
import {
    IEYASU_FIELD_LABEL,
    IEYASU_LABEL,
    IEYASU_NOTE,
    ieyasuEndingView,
    ieyasuObjective,
    ieyasuPhaseIntro,
} from '../proto3d/src/campaign/ieyasu1570/story';
import { castColliders, nearestInteractable, type CastMember } from '../proto3d/src/explore/cast';
import { BOUNDS, START, colliders, type Rect } from '../proto3d/src/layout';
import { isFree } from '../proto3d/src/game/motion';
import { ieyasuToAftermath, ieyasuToBattle, ieyasuToMuster, answerPledge } from './proto3d-ieyasu-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];
const PLEDGES: PledgeResult[] = ['kept', 'broken', 'declined'];

function aftermath(p: (typeof POLICIES)[number], r: BattleResultKind, pl: PledgeResult): IeyasuState {
    return pl === 'declined' ? ieyasuToAftermath(p, r, 'decline') : ieyasuToAftermath(p, r, 'accept', { pledge: pl });
}

/** 画面に出る文を、どの状態からも集める */
function allTexts(): string[] {
    const out: string[] = [IEYASU_NOTE, IEYASU_LABEL];
    const states: IeyasuState[] = [newIeyasuGame(), finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council')];
    for (const p of POLICIES) {
        const m = ieyasuToMuster(p, { talkEnvoys: true });
        states.push(m, answerPledge(m, 'accept'), answerPledge(m, 'decline'));
        for (const r of RESULTS) for (const pl of PLEDGES) states.push(aftermath(p, r, pl), finishTalkIeyasu(aftermath(p, r, pl), 'tadakatsu', 'end_chapter'));
    }
    // 軍議の確認の台詞
    for (const p of POLICIES) states.push(finishTalkIeyasu(finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council'), 'council', `policy_${p}`));
    for (const s of states) {
        const intro = ieyasuPhaseIntro(s);
        out.push(intro.title, intro.text, ieyasuObjective(s));
        for (const id of presentIeyasuTalks(s)) {
            const sc = talkIeyasu(s, id);
            out.push(...sc.lines.map((l) => l.text), ...(sc.choices ?? []).flatMap((c) => [c.label, c.detail ?? '', c.summary ?? '']));
        }
        if (s.phase === 'ending') {
            const e = ieyasuEndingView(s);
            out.push(e.title, ...e.body, ...e.record.map((r) => r.value), e.footer);
        }
    }
    return out;
}

describe('史実と創作の区別', () => {
    const texts = allTexts();
    const all = texts.join('\n');
    it('注記：1570年の情勢を背景にした歴史分岐シナリオで、創作を含み、姉川の再現ではない', () => {
        expect(IEYASU_NOTE).toContain('1570年');
        expect(IEYASU_NOTE).toContain('歴史分岐シナリオ');
        expect(IEYASU_NOTE).toContain('創作');
        expect(IEYASU_NOTE).toContain('姉川の戦いの再現ではありません');
        expect(IEYASU_FIELD_LABEL).toBe('1570年の情勢を背景にした架空の局地戦');
        expect(ieyasuScenario(null).note).toBe(IEYASU_NOTE);
    });
    it('B は「史実から分かれた道」と明示する（軍議の選択肢・説明）', () => {
        const s = finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council');
        const b = talkIeyasu(s, 'council').choices!.find((c) => c.id === 'policy_asai')!;
        expect(b.label).toContain('史実から分かれた道');
        expect(b.detail).toContain('創作');
        expect(b.summary).toContain('史実から分岐');
    });
    it('C は両家への宣戦ではない', () => {
        const s = finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council');
        const c = talkIeyasu(s, 'council').choices!.find((x) => x.id === 'policy_home')!;
        expect(c.detail).toContain('宣戦ではない');
        expect(all).not.toMatch(/宣戦布告する|両家を敵に/);
    });
    it('姉川の再現・史実の浅井方の家康・逸話を事実として書かない', () => {
        expect(all).not.toMatch(/姉川の戦いを再現|姉川を再現|史実どおり/);
        expect(all).not.toMatch(/史実でも浅井|史実では浅井に付/);
        expect(all).not.toMatch(/単騎/);
        expect(all).not.toMatch(/無傷|傷ひとつ/);
        // 資料で確かめていない事柄（同盟の成立年・縁戚）を台詞で断定しない
        expect(all).not.toMatch(/同盟を結んで|年来の同盟|義兄|妹|お市|縁戚|婚姻/);
        // 実在の人物の発言の引用として出さない（書状は趣旨を伝える形で、創作と注記する）
        expect(all).toContain('実際の書状の引用ではない');
    });
    it('家康は死なず、一度の局地戦で家が滅ばない', () => {
        expect(all).not.toMatch(/討ち死に|戦死|自害|滅亡した|滅ぼした|家は滅んだ/);
        expect(all).toContain('滅んだわけではない');
    });
    it('能力はゲーム用の創作として記録される', () => {
        expect(all).toContain('能力はゲーム用の創作');
    });
});

describe('どの状態でも台詞と結末が作れ、関係・損害・方針を失わない', () => {
    it('結末の記録に、方針・勝敗・約束・信頼・兵・支援が入る', () => {
        for (const p of POLICIES)
            for (const r of RESULTS)
                for (const pl of PLEDGES) {
                    const e = ieyasuEndingView(finishTalkIeyasu(aftermath(p, r, pl), 'tadakatsu', 'end_chapter'));
                    const rec = Object.fromEntries(e.record.map((x) => [x.label, x.value]));
                    expect(rec['方針']).toBeTruthy();
                    expect(rec['合戦の結果']).toContain({ victory: '勝利', retreat: '撤退', defeat: '敗北' }[r]);
                    expect(rec['約束']).toContain({ kept: '守った', broken: '守れなかった', declined: '引き受けなかった' }[pl]);
                    expect(rec['信頼']).toContain('織田家');
                    expect(rec['徳川の兵']).toContain('出陣前');
                    expect(rec['支援']).toEqual(pl === 'kept' ? expect.stringContaining('援兵') : 'なし');
                    expect(e.body.length).toBeGreaterThan(1);
                }
    });
    it('（プレイテストの指摘）敵と斬り合う前に退いて約束を守れなかったときは、「守りきれなかった」ではなく「刃を交える前に退いた」と語る', () => {
        const target = { oda: 'a_oda', asai: 'a_nagamasa', home: 't_reserve' } as const;
        for (const p of POLICIES) {
            const unfought = ieyasuToAftermath(p, 'retreat', 'accept', { pledge: 'broken', units: { [target[p]]: { status: 'withdrawn' } } });
            const tl = talkIeyasu(unfought, 'tadakatsu').lines.map((l) => l.text).join('\n');
            expect(tl).toContain('刃を交える前に兵を引きました');
            expect(tl).not.toContain('守りきれませなんだ');
            const end = ieyasuEndingView(finishTalkIeyasu(unfought, 'tadakatsu', 'end_chapter'));
            expect(end.body.join('\n')).toContain('敵と刃を交える前に兵を引いたため');
            const fell = ieyasuToAftermath(p, 'retreat', 'accept', { pledge: 'broken', units: { [target[p]]: { status: 'routed', end: 50 } } });
            expect(talkIeyasu(fell, 'tadakatsu').lines.map((l) => l.text).join('\n')).toContain('守りきれませなんだ');
        }
    });
    it('（プレイテストの指摘）C で約束を守った援兵は「岡崎の守備隊（忠勝の約束）」と呼ぶ（本多忠勝からの援兵とは書かない）', () => {
        const e = ieyasuEndingView(finishTalkIeyasu(ieyasuToAftermath('home', 'victory', 'accept', { pledge: 'kept' }), 'tadakatsu', 'end_chapter'));
        const rec = Object.fromEntries(e.record.map((x) => [x.label, x.value]));
        expect(rec['支援']).toContain('援兵（岡崎の守備隊（忠勝の約束））');
        expect(e.body.join('\n')).toContain('岡崎の守備隊');
        expect(e.body.join('\n')).not.toContain('本多忠勝からの援兵');
        const a = ieyasuEndingView(finishTalkIeyasu(ieyasuToAftermath('oda', 'victory', 'accept', { pledge: 'kept' }), 'tadakatsu', 'end_chapter'));
        expect(Object.fromEntries(a.record.map((x) => [x.label, x.value]))['支援']).toContain('援兵（織田家）');
    });
    it('支度の目的は、約束に答える前は約束の相手と話すこと', () => {
        for (const p of POLICIES) {
            const m = ieyasuToMuster(p);
            expect(ieyasuObjective(m)).toContain('約束');
            expect(ieyasuObjective(answerPledge(m, 'decline'))).toContain('城門');
        }
    });
});

// ---------------- 城下の配役 ----------------

const WALLS = colliders();
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

function reachable(rects: Rect[]): (x: number, z: number) => boolean {
    const step = 0.2;
    const nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / step) + 1;
    const nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / step) + 1;
    const idx = (i: number, k: number) => k * nx + i;
    const free = new Uint8Array(nx * nz);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) free[idx(i, k)] = isFree(BOUNDS.x0 + i * step, BOUNDS.z0 + k * step, rects) ? 1 : 0;
    const seen = new Uint8Array(nx * nz);
    const start = idx(Math.round((START.x - BOUNDS.x0) / step), Math.round((START.z - BOUNDS.z0) / step));
    const q = [start];
    seen[start] = 1;
    while (q.length) {
        const c = q.pop()!;
        const i = c % nx;
        const k = Math.floor(c / nx);
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di!;
            const kk = k + dk!;
            if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
            const n = idx(ii, kk);
            if (seen[n] || !free[n]) continue;
            seen[n] = 1;
            q.push(n);
        }
    }
    return (x, z) => {
        const i = Math.round((x - BOUNDS.x0) / step);
        const k = Math.round((z - BOUNDS.z0) / step);
        return i >= 0 && k >= 0 && i < nx && k < nz && seen[idx(i, k)] === 1;
    };
}

function talkable(m: CastMember<string>, canReach: (x: number, z: number) => boolean): boolean {
    for (let r = 0.5; r <= m.reach - 0.1; r += 0.1)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
            const x = m.x + Math.sin(a) * r;
            const z = m.z + Math.cos(a) * r;
            if (canReach(x, z) && nearestInteractable([m], x, z) === m) return true;
        }
    return false;
}

describe('城下の配役', () => {
    const states: { name: string; s: IeyasuState }[] = [{ name: 'explore', s: newIeyasuGame() }];
    for (const p of POLICIES) {
        states.push({ name: `muster ${p}`, s: ieyasuToMuster(p) });
        states.push({ name: `muster ${p} 答えた`, s: answerPledge(ieyasuToMuster(p), 'accept') });
        for (const r of RESULTS) states.push({ name: `aftermath ${p} ${r}`, s: aftermath(p, r, 'kept') });
        states.push({ name: `aftermath ${p} 忠勝負傷`, s: ieyasuToAftermath(p, 'defeat', 'decline', { units: { t_tadakatsu: { status: 'routed' } } }) });
    }
    it('誰が居るか：探索は忠勝・両家の使者・高札（目印は忠勝）。合戦中は誰も置かない', () => {
        const c = ieyasuCastFor(newIeyasuGame());
        expect(c.map((m) => m.id).sort()).toEqual(['asai_envoy', 'notice', 'oda_envoy', 'tadakatsu']);
        expect(c.find((m) => m.key)?.id).toBe('tadakatsu');
        expect(ieyasuCastFor(ieyasuToBattle('oda', 'accept'))).toEqual([]);
        for (const p of POLICIES) expect(ieyasuCastFor(ieyasuToMuster(p)).find((m) => m.key)?.id).toBe(PLEDGE_SPECS[p].giver);
        const hurt = states.find((x) => x.name === 'aftermath home 忠勝負傷')!.s;
        expect(hurt.characters.tadakatsu).toBe('wounded');
        expect(ieyasuCastFor(hurt).find((m) => m.id === 'tadakatsu')?.pose).toBe('sit');
    });
    it('置いたものは壁・家・互いに重ならず、開始の位置を塞がない。歩いて全員に話しかけられる', () => {
        for (const { name, s } of states) {
            const cast = ieyasuCastFor(s);
            const solids = castColliders(cast);
            for (const r of solids) {
                for (const w of WALLS) expect(overlaps(r, w), `${name}：壁に重なる`).toBe(false);
                for (const o of solids) if (o !== r) expect(overlaps(r, o), `${name}：置いたもの同士が重なる`).toBe(false);
            }
            expect(isFree(START.x, START.z, [...WALLS, ...solids]), `${name}：開始の位置`).toBe(true);
            const canReach = reachable([...WALLS, ...solids]);
            for (const m of cast) expect(talkable(m, canReach), `${name}：${m.id} に話しかけられない`).toBe(true);
        }
    });
});
