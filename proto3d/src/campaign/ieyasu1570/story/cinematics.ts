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
import { PLEDGE_SPECS, type PledgeResult, type Policy } from '../state';
import { IEYASU_RESULT_LABELS, supportSourceName } from '../story';
import { VISUAL_MAX, ch1GateTroops, ch2BattleTroops, ch2Sortie, heavyLoss, outcomeTroops, visualCount } from './counts';
import { CH2_SITE } from './geo';
import {
    ch2SitePlace,
    conflictRoutes,
    envoyRoutes,
    field1Place,
    homePlace,
    marchRoute,
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
    return policy === 'oda' ? '国境の原で勝ち、浅井・朝倉の勢は退いた。' : policy === 'asai' ? '国境の原で勝ち、織田方の追撃は止まった。' : '国境の原で勝ち、浪人どもは国境の外へ散った。';
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
                { text: '元亀元年（1570年）。徳川の城下（三河）。', info: ['when', 'where'], show: ['home'], focus: ['home'] },
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
                { text: 'A：織田と組み、浅井・朝倉と戦う。', focus: ['oda', 'rel.oda'] },
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
            mission: '織田勢が陣を引く。撤収を支えていただきたい。',
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
    if (s.policy === 'oda') return { crisis: '織田勢の退き口に、浅井・朝倉の追っ手が迫る。', objective: '織田勢の後備え・小荷駄を、南の退き口から退かせる。' };
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
    const places = [homePlace(), ...partyPlaces(p), field1Place(r), ch2SitePlace(p)];
    const routes = [...relationRoutes(p), threatRoute(p), marchRoute(site)];
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
        {
            kind: 'map',
            scene: base,
            min: 3.5,
            caps: [{ text: relationLine(p), info: ['ally'], show: relationRoutes(p).map((x) => x.id), focus: relationRoutes(p).map((x) => x.id) }],
        },
    ];
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
        const text = sup.from === 'tadakatsu' ? `守備隊の者たち ${sup.recovered} が、そのまま加わった。` : `${supportSourceName(sup.from)}からの援兵 ${sup.recovered} が着いた。`;
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
    plans.push({
        kind: 'map',
        scene: base,
        min: 6,
        caps: [
            { text: cl.crisis, info: ['crisis'], show: [site, `threat.${p}`], focus: [site, `threat.${p}`] },
            { text: cl.objective, focus: [site] },
        ],
    });
    // 地図：判断（軍議で 2 つの手から 1 つ・出陣の前に補充を決める。量・代償はここで変えない）
    const plansAvail = availableCh2Plans(s);
    const L = CH2_PLAN_LABELS[p];
    const planText = plansAvail.length >= 2 ? `「${L.commit}」か、「${L.hold}」か。` : `「${L[plansAvail[0] ?? 'commit']}」（もう一つは兵が足りない）。`;
    plans.push({
        kind: 'map',
        scene: base,
        min: 6,
        caps: [
            { text: '軍議で、今回の手を一つ選ぶ。', info: ['decide'], show: [`march.${site}`], focus: [site, `march.${site}`] },
            { text: planText, focus: [site] },
            { text: '出陣の前に、石川数正と兵の補充を決める。', focus: ['home'] },
        ],
    });
    const key = `ch2_intro.${POLICY_TAG[p]}.${r}.${pl}`;
    const title = `第二章への移り（${CH2_MISSION_TITLES[p]}）`;
    const withWound = (short: boolean) => {
        const b = woundBeat(short);
        const ps = [...plans];
        if (b) ps.splice(at, 0, b);
        return build(key, 'ch2_intro', title, ps);
    };
    const full = withWound(false);
    return full.duration <= INTRO_MAX_SEC ? full : withWound(true);
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
            { kind: 'map', scene: sc, min: 3.5, caps: [{ text: `行き先：${ch2SitePlace(p).name}。`, info: ['where'], show: [`march.${site}`], focus: [`march.${site}`, site] }] },
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

/** 帰還の言葉（勝敗・損害で変える。損害の大きい帰還を無傷に見せない） */
function returnLines(o: { result: 'victory' | 'retreat' | 'defeat'; reason: string; units: { id: string; status: string }[] }, t: { sortie: number; lost: number; left: number }): string[] {
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
    const loss = t.lost <= 0 ? '兵を失わずに戻った。' : heavyLoss(t) ? `出た兵 ${n(t.sortie)} のうち、${n(t.lost)} を失った。` : `兵の多くは戻った（失った兵 ${n(t.lost)}）。`;
    return [head, loss];
}

function returnSpec(s: IeyasuAnyState): CineSpec | null {
    if (isChapter2(s)) {
        if (!s.battle || !s.result) return null;
        const p = s.policy;
        const r = s.battle.result;
        const site = CH2_SITE[p];
        const t = ch2BattleTroops(s)!;
        const [head, loss] = returnLines(s.battle, t);
        const sc = scene([homePlace(), ch2SitePlace(p, r)], [returnRoute(site)], { heading: `帰還：${ch2SitePlace(p).name} → 徳川の城下` });
        const prim = s.result.primary;
        const prev = `${CH2_MISSION_TITLES[p]}：${IEYASU_RESULT_LABELS[r]}${prim ? `（主目標を${prim.achieved ? '果たした' : '果たせなかった'}）` : ''}。`;
        return build(`return.ch2.${POLICY_TAG[p]}.${r}`, 'return', `帰還（${CH2_MISSION_TITLES[p]}）`, [
            { kind: 'map', scene: sc, min: 3.5, caps: [{ text: prev.length > CINE_CAPTION_MAX ? `${CH2_MISSION_TITLES[p]}：${IEYASU_RESULT_LABELS[r]}。` : prev, info: ['prev'], show: [`return.${site}`], focus: [site, `return.${site}`] }] },
            {
                kind: 'stage',
                event: { id: 'column_return', count: visualCount(t.left, VISUAL_MAX.column), wounded: woundedOf(t), mark: '徳', victory: r === 'victory' },
                min: 6,
                caps: [{ text: head }, { text: loss }],
            },
        ]);
    }
    if (!s.battle || !s.policy || (s.phase !== 'aftermath' && s.phase !== 'ending')) return null;
    const r = s.battle.result;
    const t = outcomeTroops(s.battle);
    const [head, loss] = returnLines(s.battle, t);
    const sc = scene([homePlace(), field1Place(r)], [returnRoute('field1')], { heading: '帰還：国境の原 → 徳川の城下' });
    return build(`return.ch1.${POLICY_TAG[s.policy]}.${r}`, 'return', '帰還（国境の原から）', [
        { kind: 'map', scene: sc, min: 3.5, caps: [{ text: `国境の原の戦い：${IEYASU_RESULT_LABELS[r]}。`, info: ['prev'], show: ['return.field1'], focus: ['field1', 'return.field1'] }] },
        {
            kind: 'stage',
            event: { id: 'column_return', count: visualCount(t.left, VISUAL_MAX.column), wounded: woundedOf(t), mark: '徳', victory: r === 'victory' },
            min: 6,
            caps: [{ text: head }, { text: loss }],
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
