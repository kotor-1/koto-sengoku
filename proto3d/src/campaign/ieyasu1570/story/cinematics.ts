/**
 * 歴史分岐「元亀元年・家康」の演出の台本（第一章の導入・第二章への移行・出陣・帰還）。状態から作る純粋な関数（状態を読むだけ）。
 * 設計：docs/story-rpg-design.md §2。型：story/types.ts（CineSpec）。再生は ui の共通の再生器（story/timeline.ts）、3D の出来事は町の側。
 *
 * ＊＊ 1570年の情勢を背景にした歴史分岐シナリオ。演出の言葉は既存の分岐の文を短くした物（新しい出来事・地名・日付・逸話は足さない） ＊＊
 *
 * 矛盾を避ける決まり（ここで守り、tests/proto3d-ieyasu-story-cinematics.test.ts で確かめる）：
 * - 感謝の言葉は約束を守ったときだけ（破った・引き受けなかったときは、使者は感謝しない）。
 * - 敵方の人物を味方に出さない（A の長政、B の織田の武将）。信長は出さない。
 * - 帰る兵の数は残った兵から、負傷兵は失った兵から（損害の大きい帰還を無傷に見せない）。
 * - 帰還の失った兵の字幕は、結果の画面と同じ数え方（味方全体＝徳川と援軍・味方の家の部隊）で、主語（徳川・織田援軍など）を言う。
 *   味方のだれかが兵を失っていれば「兵を失わずに戻った」と言わない。約束の行は結果の画面の約束の欄と同じ言葉（引き受けなかったときは出さない）。
 * - 援兵の到着は第一章の support.recovered > 0 のときだけ（0 なら出さない）。忠勝の約束の援兵は守備隊（旗は徳）。
 * - C の第一章で、岡崎の守備隊は国境の砦にいて城門から出陣しない。支援の部隊は戦場で加わる（城下から出ない）。
 * - 長政が負傷なら、第二章 B に長政を出さない（丘にいるのは浅井勢の後備え）。
 * - 字幕は短く（1 つ 30 字まで）、場面ごとに十分な時間（文字数 ÷ 8 秒と 2.5 秒の大きい方以上）。長文の自動送りにしない。
 */
import type { CineCaption, CineMapBeat, CineMoment, CineSpec, CineStageBeat, MapScene, StageEvent } from '../../../story/types';
import { CAPTION_CHARS_PER_SEC, CAPTION_MIN_SEC } from '../../../story/timeline';
import { availableCh2Plans } from '../chapter2/rules';
import { isChapter2, type Chapter1Record, type Ieyasu2State, type IeyasuAnyState } from '../chapter2/state';
import { CH2_MISSION_TITLES, CH2_PLAN_LABELS, CH2_SUPPORT_NAMES } from '../chapter2/story';
import { ieyasu2LookOf } from '../chapter2/scenario';
import { IEYASU_LOOKS } from '../looks';
import { IEYASU_PLEDGE_MIN_RATIO } from '../../../battle/maps';
import { PLEDGE_SPECS, type PledgeResult, type PledgeState, type Policy } from '../state';
import { IEYASU_RESULT_LABELS, supportSourceName } from '../story';
import { VISUAL_MAX, allyLosses, ch1GateTroops, ch2BattleTroops, ch2Sortie, heavyLoss, outcomeTroops, visualCount, type AllyLosses } from './counts';
import { CH2_SITE } from './geo';
import {
    ch2SitePlace,
    conflictRoutes,
    envoyRoutes,
    field1Place,
    homePlace,
    marchRoute,
    odaCampPlace,
    odaWithdrawRoutes,
    partyPlaces,
    relationRoutes,
    returnRoute,
    scene,
    threatRoute,
} from './map';

/** 1 つの字幕の文字数の上限（1 行の目安 20〜30 字） */
export const CINE_CAPTION_MAX = 30;
/** 字幕と字幕の間の余白（秒。読み終えてから次へ） */
const CAPTION_PAD_SEC = 0.3;
/** 章の導入の長さの上限（秒。設計 §2 の 30〜45 秒） */
const INTRO_MAX_SEC = 45;

type InfoKey = keyof CineSpec['info'];

/** 字幕の計画（show：この字幕の始めに現れる場所・線の id、focus：この字幕の間の強調、info：出す情報の札） */
interface CapPlan {
    speaker?: string;
    text: string;
    info?: InfoKey[];
    show?: string[];
    focus?: string[];
}
type BeatPlan = { kind: 'map'; scene: MapScene; caps: CapPlan[]; min?: number } | { kind: 'stage'; event: StageEvent; caps: CapPlan[]; min?: number };

const len = (t: string) => [...t].length;
/** 字幕を出す時間（文字数 ÷ 8 秒と 2.5 秒の大きい方に、読み終える余白） */
export function captionSec(text: string): number {
    return Math.ceil((Math.max(CAPTION_MIN_SEC, len(text) / CAPTION_CHARS_PER_SEC) + CAPTION_PAD_SEC) * 10) / 10;
}
const r1 = (x: number) => Math.round(x * 100) / 100;

/** 最初の字幕で現れる物も、場面の頭から少し遅らせて現れる様子を見せる（秒） */
const FIRST_APPEAR_SEC = 0.3;

/**
 * 台本の場所・線が最初に現れる時刻（秒。台本の始めから。確かめ用：字幕の show から決めた時刻）。
 * 台本の中身（CineSpec）には入れない（型は共通の物のまま）。build が作った台本ごとに覚える。
 */
const FIRST_SHOWN = new WeakMap<CineSpec, ReadonlyMap<string, number>>();
export function cineFirstShown(spec: CineSpec): ReadonlyMap<string, number> | undefined {
    return FIRST_SHOWN.get(spec);
}

/**
 * 計画から台本を作る（場面の長さは字幕の時間の和と最短の長さの大きい方。余りは字幕に均して足す）。
 * 地図の場所・線の出方は台本全体で決める（場面の切り替わりで一度消えて引き直されないように）：
 * - 字幕の show にある物は、その字幕の時刻（場面の最初の字幕なら頭から 0.3 秒）に初めて現れる。それより前の地図の場面では隠れたまま
 *   （appear を場面の長さより後にする。場面の中身は同じなので、名前の置き場所は場面が変わっても動かない）。
 * - 前の地図の場面で現れた物は、後の地図の場面では始めから出たまま（appear を付けない）。
 * - どの字幕の show にも無い物（背景の場所）は始めからある。線は、両端の場所が現れるまで現れない。
 */
function build(id: string, moment: CineMoment, title: string, plans: BeatPlan[]): CineSpec {
    // 1) 場面と字幕の時刻
    const timed = plans.map((p) => {
        const secs = p.caps.map((c) => captionSec(c.text));
        const sum = secs.reduce((a, b) => a + b, 0);
        const dur = Math.max(p.min ?? 0, sum);
        const extra = p.caps.length ? (dur - sum) / p.caps.length : 0;
        let local = 0;
        const caps = p.caps.map((c, i) => {
            const d = secs[i]! + extra;
            const x = { c, local, d };
            local += d;
            return x;
        });
        return { p, dur, caps };
    });
    // 2) 台本全体で、場所・線が最初に現れる時刻（その字幕のある地図の場面の中にある物だけ）
    const first = new Map<string, number>();
    {
        let t = 0;
        for (const b of timed) {
            if (b.p.kind === 'map') {
                const sc = b.p.scene;
                const has = new Set([...sc.places.map((x) => x.id), ...sc.routes.map((x) => x.id)]);
                for (const x of b.caps) for (const s of x.c.show ?? []) if (has.has(s) && !first.has(s)) first.set(s, t + Math.max(FIRST_APPEAR_SEC, x.local));
            }
            t += b.dur;
        }
    }
    // 線は、両端の場所が現れてから（背景の場所は始めからある）
    const shownAt = (sc: MapScene, id: string): number | undefined => {
        const r = sc.routes.find((x) => x.id === id);
        if (!r) return first.get(id);
        const ts = [first.get(id), first.get(r.from), first.get(r.to)].filter((x): x is number => x !== undefined);
        return ts.length ? Math.max(...ts) : undefined;
    };
    // 3) 台本
    const beats: (CineMapBeat | CineStageBeat)[] = [];
    const captions: CineCaption[] = [];
    const info: CineSpec['info'] = {};
    const firstShown = new Map<string, number>();
    let t = 0;
    for (const { p, dur, caps } of timed) {
        const highlights: { at: number; ids: string[] }[] = [];
        for (const { c, local, d } of caps) {
            const start = r1(t + local);
            const end = r1(t + local + d);
            captions.push({ start, end, ...(c.speaker ? { speaker: c.speaker } : {}), text: c.text });
            for (const k of c.info ?? []) if (info[k] === undefined || info[k]! > start) info[k] = start;
            if (c.focus) highlights.push({ at: r1(local), ids: [...c.focus] });
        }
        const start = r1(t);
        const end = r1(t + dur);
        if (p.kind === 'map') {
            const appear: Record<string, number> = {};
            for (const id of [...p.scene.places.map((x) => x.id), ...p.scene.routes.map((x) => x.id)]) {
                const at = shownAt(p.scene, id);
                // 前の場面までに現れた物・背景の物は始めから出たまま
                if (at === undefined || at < t - 1e-9) continue;
                // この場面で初めて現れる物はその時刻に。後の場面で現れる物は、この場面の長さより後（隠れたまま）
                appear[id] = r1(at - t);
                if (!firstShown.has(id)) firstShown.set(id, r1(at));
            }
            const b: CineMapBeat = { kind: 'map', start, end, scene: p.scene };
            if (Object.keys(appear).length) b.appear = appear;
            if (highlights.length) b.highlights = highlights;
            beats.push(b);
        } else {
            beats.push({ kind: 'stage', start, end, event: p.event });
        }
        t += dur;
    }
    const spec: CineSpec = { id, moment, title, duration: r1(t), beats, captions, info };
    FIRST_SHOWN.set(spec, firstShown);
    return spec;
}

// ================================================================ 共通の言葉

const POLICY_TAG: Readonly<Record<Policy, string>> = { oda: 'oda', asai: 'asai', home: 'home' };
const HOUSE_MARK: Readonly<Record<'oda' | 'asai' | 'tadakatsu', string>> = { oda: '織', asai: '浅', tadakatsu: '徳' };

/** 家康本陣が崩れて負けたか（敗北の理由で言い分ける：本陣が崩れた／諸隊が崩れた／主目標を果たせなかった） */
function hqRouted(o: { reason: string; units: { id: string; status: string }[] }): boolean {
    if (o.reason === 'ally_hq_routed') return true;
    const hq = o.units.find((u) => u.id === 't_honjin');
    return !!hq && (hq.status === 'routed' || hq.status === 'destroyed');
}

/** 第一章の合戦の結果の 1 文（国境の原。方針 × 勝敗。敗北は本陣が崩れたかで言い分ける） */
function ch1ResultLine(policy: Policy, o: Chapter1Record['battle']): string {
    const r = o.result;
    if (r === 'retreat') return '国境の原は決着がつかず、兵を引いた。';
    if (r === 'defeat') return hqRouted(o) ? '国境の原で本陣が崩れ、家康は落ち延びた。' : '国境の原で味方の諸隊が崩れ、兵を引いた。';
    // A：国境の原の勝ちは局地戦（第二章で織田の本隊が近江の陣を引き払うことと矛盾しないように。docs/ch2a-reason.md）
    return policy === 'oda' ? '国境の原の局地戦に勝ち、浅井・朝倉は退いた。' : policy === 'asai' ? '国境の原で勝ち、織田方の追撃は止まった。' : '国境の原で勝ち、浪人どもは国境の外へ散った。';
}

/** 第一章の約束の 1 文（守った／守れなかった／引き受けなかった。破ったのに感謝しない） */
function ch1PledgeLine(rec: Pick<Chapter1Record, 'policy' | 'pledge' | 'battle'>): string {
    const t = PLEDGE_SPECS[rec.policy].targetName;
    const r = rec.pledge.result as PledgeResult;
    if (r === 'kept') return `約束どおり、${t}の退路を守った。`;
    if (r === 'declined') return `${t}の退路を守る頼みは、引き受けなかった。`;
    return unfought(rec) ? '刃を交える前に兵を引き、約束を果たせなかった。' : `${t}の退路を守る約束は、果たせなかった。`;
}

/** 約束を「守れなかった」うち、対象は無事だが斬り合う前に退いたもの（第一章の pledgeUnfought と同じ決まり） */
function unfought(rec: Pick<Chapter1Record, 'pledge' | 'battle'>): boolean {
    if (rec.pledge.result !== 'broken') return false;
    const u = rec.battle.units.find((x) => x.id === rec.pledge.targetId);
    if (!u || u.status === 'routed' || u.status === 'destroyed') return false;
    return u.startStrength > 0 && u.endStrength >= u.startStrength * IEYASU_PLEDGE_MIN_RATIO - 1e-9;
}

/** 方針ごとの協力と敵対の 1 文 */
function relationLine(policy: Policy): string {
    return policy === 'oda' ? '織田と協力し、浅井・朝倉とは敵味方のまま。' : policy === 'asai' ? '浅井と組み、織田とは手を切った（分かれた道）。' : '両家とは戦わず、国を守る道を選んだ。';
}

// ================================================================ 第一章の導入

const CH1_HEADING = '元亀元年（1570年）・徳川の城下（三河）';

function ch1Intro(): CineSpec {
    const places = [homePlace(), ...partyPlaces(null), field1Place(null)];
    const base = scene(places, [...relationRoutes(null), ...conflictRoutes(), ...envoyRoutes()], { heading: CH1_HEADING });
    return build('ch1_intro', 'ch1_intro', '第一章の始め（元亀元年）', [
        {
            kind: 'map',
            scene: base,
            min: 9,
            caps: [
                // 自分が徳川家康だと分かるように（見出しの「徳川の城下（三河）」と同じ所。城・町の名前は出さない）
                { text: '元亀元年（1570年）。三河、徳川家康の城下。', info: ['when', 'where'], show: ['home'], focus: ['home'] },
                { text: '近江で、織田と浅井・朝倉が敵味方に分かれた。', info: ['crisis'], show: ['oda', 'asai', 'asakura', 'conflict.asai', 'conflict.asakura'], focus: ['conflict.asai', 'conflict.asakura'] },
                // 国境の原（合戦の場所）は、ここでは出さない（判断の場面で「どの道でも国境の原で戦う」と出す）
                { text: '国境では、浪人の一団が村を荒らしている。', show: ['border'], focus: ['border'] },
            ],
        },
        {
            kind: 'map',
            scene: base,
            min: 5,
            caps: [
                { text: '徳川は、これまで織田と共に動いてきた。', info: ['ally'], show: ['rel.oda'], focus: ['oda', 'rel.oda'] },
                { text: 'その織田と浅井から、同じ日に使者が来た。', show: ['envoy.oda', 'envoy.asai'], focus: ['envoy.oda', 'envoy.asai'] },
            ],
        },
        {
            kind: 'stage',
            event: {
                id: 'envoys_arrive',
                envoys: [
                    { look: IEYASU_LOOKS.oda_envoy, name: '織田家の使者' },
                    { look: IEYASU_LOOKS.asai_envoy, name: '浅井家の使者' },
                ],
            },
            min: 9,
            caps: [
                { speaker: '織田家の使者', text: '徳川殿にも、兵を出していただきたい。' },
                { speaker: '浅井家の使者', text: '主は、徳川殿と手を結びたいと。' },
                { text: '本多忠勝が、城下で待っている。' },
            ],
        },
        {
            kind: 'map',
            scene: base,
            min: 9,
            caps: [
                { text: '軍議で、進む道を一つ選ぶ。', info: ['decide'], focus: ['home'] },
                // A は今までの道（方針の名前「織田との協力を続ける」の言い方。B の「史実から分かれた道」と並べて分かる）
                { text: 'A：織田との協力を続け、浅井・朝倉と戦う。', focus: ['oda', 'rel.oda'] },
                { text: 'B：浅井と組み、織田方の一隊と戦う（史実から分かれた道）。', focus: ['asai', 'envoy.asai', 'oda'] },
                { text: 'C：両家とは戦わず、国境の浪人を討つ。', focus: ['border'] },
                // 第一章の合戦の場所はどの方針でも同じ（geo.ts：国境の原は架空の局地戦。出陣の行き先と同じ言葉）
                { text: 'どの道でも、戦うのは国境の原（架空の局地戦）。', show: ['field1'], focus: ['field1', 'border'] },
            ],
        },
    ]);
}

// ================================================================ 第二章への移行

/** 第二章の使いの言葉（約束の結果で言い方を変える。破った・引き受けなかったときは感謝しない） */
function messengerLines(s: Ieyasu2State): { speaker: string; first: string; mission: string } {
    const c = s.chapter1;
    const pl = c.pledge.result as PledgeResult;
    if (s.policy === 'home') {
        return {
            speaker: '村の使い',
            first: c.battle.result === 'victory' ? '先には浪人どもを追い払っていただきました。' : '浪人どもが、また村へ来ると噂しております。',
            mission: '村の者だけでは守れませぬ。どうかお助けを。',
        };
    }
    if (s.policy === 'oda') {
        return {
            speaker: '織田家の使者',
            first: pl === 'kept' ? '先の戦では、援軍の退路を守っていただいた。' : pl === 'broken' ? '約束の退路は守られなんだ。されど手が足りぬ。' : '頼みを断られたのは、徳川殿のお考え。',
            // 退くのは近江にいた織田の本隊（第一章の織田援軍ではない）。支えるのは、その後備え（と小荷駄）の撤収
            mission: '主の本隊が近江の陣を引く。撤収をお支えくだされ。',
        };
    }
    return {
        speaker: '浅井家の使者',
        first: pl === 'kept' ? '先の戦では、主の隊の退き口を守っていただいた。' : pl === 'broken' ? '約束の退き口は守られなんだ。されど頼れるのは徳川殿だけ。' : '先の頼みのことは、それはそれと主も申しております。',
        mission: '丘の上の者たちを、どうか救っていただきたい。',
    };
}

/** 第二章の危機と目的の 2 文（主目標の基本の説明。物見をしなくても分かる）。情勢の画面でも使う */
export function crisisLines(s: Ieyasu2State): { crisis: string; objective: string } {
    if (s.policy === 'oda') return { crisis: '本隊の最後尾、後備え・小荷駄を浅井・朝倉が追う。', objective: '後備え・小荷駄が南の退き口を抜けるまで、徳川が守る。' };
    if (s.policy === 'asai') {
        // 長政が負傷なら、丘にいるのは浅井勢の後備え（長政は出ない）
        const alive = s.characters.nagamasa === 'alive';
        return {
            crisis: alive ? '長政の一隊が、丘の上で織田方に囲まれた。' : '浅井勢の後備えが、丘の上で織田方に囲まれた。',
            objective: `${alive ? '浅井長政隊' : '浅井勢の後備え'}と合流し、南の安全地点へ連れ帰る。`,
        };
    }
    return { crisis: '浪人衆が、領内の村へ押し入ろうとしている。', objective: '庄屋の屋敷前を、浪人衆から守る。' };
}

function ch2Intro(s: Ieyasu2State): CineSpec {
    const c = s.chapter1;
    const p = s.policy;
    const r = c.battle.result;
    const site = CH2_SITE[p];
    // A は、近江の織田の本隊の陣と撤収の線も出す（どの隊が・なぜ退くか。docs/ch2a-reason.md）
    const places = [homePlace(), ...partyPlaces(p), field1Place(r), ch2SitePlace(p), ...(p === 'oda' ? [odaCampPlace()] : [])];
    const routes = [...relationRoutes(p), threatRoute(p), marchRoute(site), ...(p === 'oda' ? odaWithdrawRoutes() : [])];
    const heading = '元亀元年（1570年）・第一章の戦から数日後';
    const base = scene(places, routes, { heading });
    const pl = c.pledge.result as PledgeResult;
    const plans: BeatPlan[] = [
        {
            kind: 'map',
            scene: base,
            min: 8,
            caps: [
                { text: '第一章の戦から数日。徳川の城下（三河）。', info: ['when', 'where'], show: ['home'], focus: ['home'] },
                { text: ch1ResultLine(p, c.battle), info: ['prev'], show: ['field1'], focus: ['field1'] },
                { text: ch1PledgeLine(c), info: ['prev'], focus: ['field1'] },
            ],
        },
    ];
    // 協力と敵対の 1 行（A は後の「撤収のわけ」の地図の場面で、近江の浅井・朝倉の 1 行として言う）
    if (p !== 'oda') {
        plans.push({
            kind: 'map',
            scene: base,
            min: 3.5,
            caps: [{ text: relationLine(p), info: ['ally'], show: relationRoutes(p).map((x) => x.id), focus: relationRoutes(p).map((x) => x.id) }],
        });
    }
    // 3D：負傷兵（第一章で失った兵から。見た目の数）
    const lost = outcomeTroops(c.battle);
    const wounded = visualCount(lost.lost, VISUAL_MAX.wounded);
    // 忠勝の傷の 1 行は、導入が長くなりすぎるときは省く（下の short）
    const woundBeat = (short: boolean): BeatPlan | null => {
        if (wounded <= 0) return null;
        const caps: CapPlan[] = [{ text: heavyLoss(lost) ? '先の戦の負傷兵が、詰所で手当てを受けている。' : '詰所では、先の戦で傷を負った兵が休む。' }];
        if (!short && s.characters.tadakatsu === 'wounded') caps.push({ text: '忠勝の傷も、まだ癒えきっていない。' });
        return { kind: 'stage', event: { id: 'wounded_rest', count: wounded }, min: 4.5, caps };
    };
    const at = plans.length;
    // 3D：援兵（第一章で約束を守り、兵が実際に戻ったときだけ。0 なら出さない）
    const sup = c.support;
    if (pl === 'kept' && sup.reinforcement && sup.from && sup.recovered > 0) {
        // 援兵は第一章の戦後に受け取り済みで、今の兵に入っている（記録の「第一章で受け取り済み・今の兵に含む。第二章では足さない」と同じ時点）。
        // 3D の場面（援兵が木戸を入る）はそのままに、字幕は「先の戦の後に着き、すでに隊に加わった」と言う
        const text =
            sup.from === 'tadakatsu'
                ? `守備隊の者たち ${sup.recovered} は、先の戦の後に隊に加わった。`
                : `${supportSourceName(sup.from)}の援兵 ${sup.recovered} は、先の戦の後に着き、隊に加わった。`;
        plans.push({
            kind: 'stage',
            event: { id: 'reinforcement_arrive', count: visualCount(sup.recovered, VISUAL_MAX.reinforcement), mark: HOUSE_MARK[sup.from], name: supportSourceName(sup.from) },
            min: 4.5,
            caps: [{ text }],
        });
    }
    // 3D：使い（第二章の使者・村の使い）。言葉は約束の結果で変える
    const m = messengerLines(s);
    plans.push({
        kind: 'stage',
        event: { id: 'messenger_arrive', look: ieyasu2LookOf(s, 'envoy'), name: m.speaker },
        min: 6,
        caps: [
            { speaker: m.speaker, text: m.first },
            { speaker: m.speaker, text: m.mission, info: ['crisis'] },
        ],
    });
    // 地図：今回の危機の場所と脅かす向き・目的
    const cl = crisisLines(s);
    if (p === 'oda') {
        // A：撤収のわけ（ゲーム用の創作。docs/ch2a-reason.md）。第一章の勝敗によらず同じ文（勝ちを前提にしない）：
        // 近江の浅井・朝倉は健在で、織田の本隊は近江の陣を引き払う → 本隊の最後尾（後備え・小荷駄）を浅井・朝倉が追う → 徳川が守る。
        // 導入の長さ（45 秒まで）に収めるため、わけは 1 行にまとめ、目的は直前の行の「後備え・小荷駄」を受けて「二隊」と言う
        const rel = relationRoutes(p).map((x) => x.id);
        plans.push({
            kind: 'map',
            scene: base,
            min: 6,
            caps: [
                {
                    text: '近江の浅井・朝倉は健在。織田の本隊は陣を引き払う。',
                    info: ['ally'],
                    show: [...rel, 'oda_camp', 'withdraw.oda_main'],
                    focus: ['asai', 'asakura', 'oda_camp', 'withdraw.oda_main'],
                },
                { text: cl.crisis, info: ['crisis'], show: [site, 'withdraw.oda_rear', `threat.${p}`], focus: [site, 'withdraw.oda_rear', `threat.${p}`] },
                { text: '二隊が南の退き口を抜けるまで、徳川が守る。', focus: [site] },
            ],
        });
    } else {
        plans.push({
            kind: 'map',
            scene: base,
            min: 6,
            caps: [
                { text: cl.crisis, info: ['crisis'], show: [site, `threat.${p}`], focus: [site, `threat.${p}`] },
                { text: cl.objective, focus: [site] },
            ],
        });
    }
    // 地図：判断（軍議で 2 つの手から 1 つ・出陣の前に補充を決める。量・代償はここで変えない）。長さに収まる言い方を decideCaps で選ぶ
    const decide = (compact: boolean): BeatPlan => ({ kind: 'map', scene: base, min: 6, caps: decideCaps(s, site, compact) });
    const key = `ch2_intro.${POLICY_TAG[p]}.${r}.${pl}`;
    const title = `第二章への移り（${CH2_MISSION_TITLES[p]}）`;
    const variant = (short: boolean, compact: boolean) => {
        const b = woundBeat(short);
        const ps = [...plans, decide(compact)];
        if (b) ps.splice(at, 0, b);
        return build(key, 'ch2_intro', title, ps);
    };
    // 導入の長さ（45 秒まで）に収まる最初の物：全部 → 判断の字幕を詰める → 忠勝の傷の 1 行も省く
    for (const [short, compact] of [
        [false, false],
        [false, true],
    ] as const) {
        const spec = variant(short, compact);
        if (spec.duration <= INTRO_MAX_SEC) return spec;
    }
    return variant(true, true);
}

/**
 * 判断の手の違いの一言（今ある文の言い方から：軍議の酒井・石川の言葉 COUNCIL_OPINIONS・決める時の言葉・始めの陣 PLAN_POS。chapter2/story.ts）。
 * 量・代償・主目標は言わない（軍議の選択肢の説明が言う）。
 */
const PLAN_GIST: Readonly<Record<Policy, Readonly<Record<'commit' | 'hold', string>>>> = {
    oda: { commit: '追っ手を正面から受ける', hold: '織田勢は自分で退いてくる' },
    asai: { commit: '早く丘に着ける', hold: '西の囲みを誘い出す' },
    home: { commit: '屋敷の前が厚くなる', hold: '主力だけで屋敷の前を守る' },
};

/**
 * 第二章への移行の判断の字幕。
 * - 2 つの手を選べる：「軍議で、今回の手を一つ選ぶ」→ 手ごとに「「名前」：違いの一言」→ 出陣の前の補充。
 *   compact（導入が長くなりすぎるとき）は前置きを省き、終わりの 1 行を「軍議でどちらかを選び、出陣の前に兵の補充を決める」にする。
 * - 1 つしか選べない（第一章の損害で判断 2 の兵が足りない）：選べる手の名前・選べない手の名前と理由（兵が足りない）・
 *   今回決めるのは兵の補充だ、と言う（「一つ選ぶ」と言いながら手が 1 つ、にしない）。
 */
function decideCaps(s: Ieyasu2State, site: string, compact: boolean): CapPlan[] {
    const p = s.policy;
    const L = CH2_PLAN_LABELS[p];
    const avail = availableCh2Plans(s);
    const head = { info: ['decide'] as InfoKey[], show: [`march.${site}`], focus: [site, `march.${site}`] };
    if (avail.length < 2) {
        const only = avail[0] ?? 'commit';
        const blocked = only === 'commit' ? 'hold' : 'commit';
        return [
            { text: `軍議の手は「${L[only]}」だけ。`, ...head },
            { text: `「${L[blocked]}」は、兵が足りず取れない。`, focus: [site] },
            { text: '今回決めるのは兵の補充。出陣の前に石川数正と話す。', focus: ['home'] },
        ];
    }
    const plans: CapPlan[] = (['commit', 'hold'] as const).map((pl) => ({ text: `「${L[pl]}」：${PLAN_GIST[p][pl]}。`, focus: [site] }));
    if (compact) return [{ ...plans[0]!, ...head }, plans[1]!, { text: '軍議でどちらかを選び、出陣の前に兵の補充を決める。', focus: ['home'] }];
    return [{ text: '軍議で、今回の手を一つ選ぶ。', ...head }, ...plans, { text: '出陣の前に、石川数正と兵の補充を決める。', focus: ['home'] }];
}

// ================================================================ 出陣

function departure(s: IeyasuAnyState): CineSpec | null {
    if (isChapter2(s)) {
        if (s.phase !== 'battle' && s.phase !== 'aftermath' && s.phase !== 'ending') return null;
        const so = ch2Sortie(s);
        if (!so) return null;
        const p = s.policy;
        const site = CH2_SITE[p];
        const caps: CapPlan[] = [{ text: so.units.includes('reserve') ? '守備隊も出陣し、城は空になる。' : '城門から、徳川の兵が出陣する。' }];
        const sup = so.support;
        if (sup.length) caps.push({ text: `${sup.map((x) => CH2_SUPPORT_NAMES[x]).join('・')}は、戦場で加わる。` });
        else if (!so.units.includes('reserve') && s.plan === 'hold') caps.push({ text: '岡崎の守備隊は、城に残る。' });
        const sc = scene([homePlace(), ch2SitePlace(p)], [marchRoute(site)], { heading: `出陣：徳川の城下 → ${ch2SitePlace(p).name}` });
        return build(`departure.ch2.${POLICY_TAG[p]}.${s.plan ?? 'none'}`, 'departure', `出陣（${CH2_MISSION_TITLES[p]}）`, [
            { kind: 'stage', event: { id: 'column_depart', count: visualCount(so.troops, VISUAL_MAX.column), mark: '徳' }, min: 6, caps },
            {
                kind: 'map',
                scene: sc,
                min: 3.5,
                caps: [
                    { text: `行き先：${ch2SitePlace(p).name}。`, info: ['where'], show: [`march.${site}`], focus: [`march.${site}`, site] },
                    // A：何を守りに行くか（移行の「撤収のわけ」とつなぐ）
                    ...(p === 'oda' ? [{ text: '本隊の後備え・小荷駄が抜けるまで、退き口を守る。', focus: [site] }] : []),
                ],
            },
        ]);
    }
    if (s.phase !== 'battle' && s.phase !== 'aftermath' && s.phase !== 'ending') return null;
    if (!s.policy) return null;
    const p = s.policy;
    const troops = ch1GateTroops(s);
    // 岡崎の守備隊は城門から出ない（A・B は国元に残る。C は国境の砦にいる）。味方の部隊は先に戦場にいる
    // C の守備隊は、支度の文（国境の砦の守備隊が、浪人どもに囲まれかけている）と同じく、危ういまま待つ
    const second = p === 'oda' ? '織田援軍は、先に戦場の右前へ出ている。' : p === 'asai' ? '浅井長政隊は、先に戦場の左前へ出ている。' : '岡崎の守備隊は、国境の砦で囲まれかけている。';
    const sc = scene([homePlace(), field1Place(null)], [marchRoute('field1')], { heading: '出陣：徳川の城下 → 国境の原' });
    return build(`departure.ch1.${POLICY_TAG[p]}`, 'departure', '出陣（国境の原へ）', [
        { kind: 'stage', event: { id: 'column_depart', count: visualCount(troops, VISUAL_MAX.column), mark: '徳' }, min: 6, caps: [{ text: '城門から、徳川の兵が出陣する。' }, { text: second }] },
        { kind: 'map', scene: sc, min: 3.5, caps: [{ text: '行き先：国境の原（架空の局地戦）。', info: ['where'], show: ['march.field1'], focus: ['march.field1', 'field1'] }] },
    ]);
}

// ================================================================ 帰還

/**
 * 帰還の言葉（勝敗・損害で変える。損害の大きい帰還を無傷に見せない）。損害の数は結果の画面と同じ数え方（allyLosses：
 * 味方全体＝徳川と、援軍・味方の家の部隊）。主語をはっきりさせる：
 * - 味方のだれも兵を失わなかったときだけ「兵を失わずに戻った」。
 * - 徳川は失わず、ほかの味方が失ったときは「徳川の兵は失わずに戻った（織田援軍は N を失った）」。
 * - 徳川が失ったときは徳川の数（損害が大きいと「徳川の兵 N のうち、M を失った」）。ほかの味方も失っていれば、その 1 行を続ける。
 */
function returnLines(o: { result: 'victory' | 'retreat' | 'defeat'; reason: string; units: { id: string; status: string }[] }, losses: AllyLosses): string[] {
    const result = o.result;
    const head =
        result === 'victory'
            ? '旗を掲げて、兵が城へ戻る。'
            : result === 'retreat'
              ? '兵をまとめて、城へ引いた。'
              : hqRouted(o)
                ? '本陣は崩れたが、家康は城へ落ち延びた。'
                : o.reason === 'objective_failed'
                  ? '務めを果たせず、兵を引いて城へ戻った。'
                  : '諸隊が崩れ、兵を引いて城へ戻った。';
    const n = (x: number) => x.toLocaleString('ja-JP');
    if (losses.total <= 0) return [head, '兵を失わずに戻った。'];
    const t = losses.tokugawa;
    const hurt = losses.others.filter((x) => x.lost > 0);
    const othersLost = hurt.reduce((a, x) => a + x.lost, 0);
    // ほかの味方の失った兵（呼び名が 1 つならその名前で。まれに 2 つ以上なら合わせて）
    const others = hurt.length === 0 ? null : hurt.length === 1 ? `${hurt[0]!.name}は ${n(othersLost)} を失った` : `ほかの味方は ${n(othersLost)} を失った`;
    if (t.lost <= 0 && others) {
        const one = `徳川の兵は失わずに戻った（${others}）。`;
        return len(one) <= CINE_CAPTION_MAX ? [head, one] : [head, '徳川の兵は失わずに戻った。', `${others}。`];
    }
    const mine = heavyLoss(t) ? `徳川の兵 ${n(t.sortie)} のうち、${n(t.lost)} を失った。` : `徳川の兵の多くは戻った（失った兵 ${n(t.lost)}）。`;
    return others ? [head, mine, `${others}。`] : [head, mine];
}

/**
 * 帰還の約束の 1 行（その合戦に戦前の約束があったときだけ：第一章。第二章の合戦には約束が無く、結果の画面にも約束の欄が無いので出さない）。
 * 結果の画面の約束の欄（battle/control.ts の pledgeResultModel）と同じ言葉：守った／守れなかった（対象が崩れた・兵が減りすぎた）／
 * 守れなかった（対象は無事だが、敵と斬り合う前に退いた・敗れた）。引き受けなかったときは何も出さない。
 */
function returnPledgeLine(policy: Policy, pledge: PledgeState | null, battle: Chapter1Record['battle']): string | null {
    const r = pledge?.result;
    if (!pledge || !r || r === 'declined') return null;
    const t = PLEDGE_SPECS[policy].targetName;
    if (r === 'kept') return `約束を守った：${t}の退路を守る。`;
    if (unfought({ pledge, battle })) return `約束を守れなかった：敵と斬り合う前に${battle.result === 'defeat' ? '敗れた' : '退いた'}。`;
    return `約束を守れなかった：${t}の退路を守る。`;
}

function returnSpec(s: IeyasuAnyState): CineSpec | null {
    if (isChapter2(s)) {
        if (!s.battle || !s.result) return null;
        const p = s.policy;
        const r = s.battle.result;
        const site = CH2_SITE[p];
        const t = ch2BattleTroops(s)!;
        const [head, ...loss] = returnLines(s.battle, allyLosses(s.battle));
        const sc = scene([homePlace(), ch2SitePlace(p, r)], [returnRoute(site)], { heading: `帰還：${ch2SitePlace(p).name} → 徳川の城下` });
        const prim = s.result.primary;
        const prev = `${CH2_MISSION_TITLES[p]}：${IEYASU_RESULT_LABELS[r]}${prim ? `（主目標を${prim.achieved ? '果たした' : '果たせなかった'}）` : ''}。`;
        // A で主目標（家康本陣と後備え・小荷駄が南の退き口から離れる）を果たしたときは、守った二隊がどうなったかを言う。
        // 果たせなかったとき（撤退・敗北）は今までの言い方のまま（二隊がどうなったかは結果しだいなので、言い切らない）
        const head2 = p === 'oda' && prim?.achieved ? '撤収を支えきった：後備え・小荷駄は南の退き口を抜けた。' : prev.length > CINE_CAPTION_MAX ? `${CH2_MISSION_TITLES[p]}：${IEYASU_RESULT_LABELS[r]}。` : prev;
        const mapCaps: CapPlan[] = [{ text: head2, info: ['prev'], show: [`return.${site}`], focus: [site, `return.${site}`] }];
        return build(`return.ch2.${POLICY_TAG[p]}.${r}`, 'return', `帰還（${CH2_MISSION_TITLES[p]}）`, [
            { kind: 'map', scene: sc, min: 3.5, caps: mapCaps },
            {
                kind: 'stage',
                event: { id: 'column_return', count: visualCount(t.left, VISUAL_MAX.column), wounded: woundedOf(t), mark: '徳', victory: r === 'victory' },
                min: 6,
                caps: [{ text: head! }, ...loss.map((text) => ({ text }))],
            },
        ]);
    }
    if (!s.battle || !s.policy || (s.phase !== 'aftermath' && s.phase !== 'ending')) return null;
    const r = s.battle.result;
    const t = outcomeTroops(s.battle);
    const [head, ...loss] = returnLines(s.battle, allyLosses(s.battle));
    const sc = scene([homePlace(), field1Place(r)], [returnRoute('field1')], { heading: '帰還：国境の原 → 徳川の城下' });
    // 約束の結果（結果の画面と同じ言葉。引き受けなかったときは出さない）は、地図の結果の印の後に
    const pledge = returnPledgeLine(s.policy, s.pledge, s.battle);
    const mapCaps: CapPlan[] = [{ text: `国境の原の戦い：${IEYASU_RESULT_LABELS[r]}。`, info: ['prev'], show: ['return.field1'], focus: ['field1', 'return.field1'] }];
    if (pledge) mapCaps.push({ text: pledge, focus: ['field1'] });
    return build(`return.ch1.${POLICY_TAG[s.policy]}.${r}`, 'return', '帰還（国境の原から）', [
        { kind: 'map', scene: sc, min: 3.5, caps: mapCaps },
        {
            kind: 'stage',
            event: { id: 'column_return', count: visualCount(t.left, VISUAL_MAX.column), wounded: woundedOf(t), mark: '徳', victory: r === 'victory' },
            min: 6,
            caps: [{ text: head! }, ...loss.map((text) => ({ text }))],
        },
    ]);
}

/** 帰る隊列の負傷兵（失った兵から。失った兵がいれば 1 人以上。帰る人数より多くしない） */
function woundedOf(t: { lost: number; left: number }): number {
    const w = visualCount(t.lost, VISUAL_MAX.wounded);
    const back = visualCount(t.left, VISUAL_MAX.column);
    return Math.min(w, Math.max(back, 0));
}

// ================================================================ 入り口

/**
 * 演出の台本（状態を読むだけ。同じ状態なら同じ台本）。その時に流す物が無ければ null。
 * - ch1_intro：いつでも作れる（第一章の始めの情勢。第二章からの見直しでも同じ）。
 * - ch2_intro：第二章の状態だけ。
 * - departure：出陣の後（出陣中・戦後・結末）。帰還：戦後・結末（直前の合戦）。
 */
export function ieyasuCinematic(s: IeyasuAnyState, moment: CineMoment): CineSpec | null {
    switch (moment) {
        case 'ch1_intro':
            return ch1Intro();
        case 'ch2_intro':
            return isChapter2(s) ? ch2Intro(s) : null;
        case 'departure':
            return departure(s);
        case 'return':
            return returnSpec(s);
    }
}

/** 見直せる演出（情勢の画面の「演出を見直す」）：今の章の導入と、今の段階で意味のある出陣・帰還（戦後なら直前の合戦の出陣・帰還） */
export function ieyasuReplays(s: IeyasuAnyState): { moment: CineMoment; title: string }[] {
    const out: { moment: CineMoment; title: string }[] = [];
    const add = (m: CineMoment) => {
        const spec = ieyasuCinematic(s, m);
        if (spec) out.push({ moment: m, title: spec.title });
    };
    if (isChapter2(s)) add('ch2_intro');
    add('ch1_intro');
    if (s.phase === 'aftermath' || s.phase === 'ending') {
        add('departure');
        add('return');
    }
    return out;
}
