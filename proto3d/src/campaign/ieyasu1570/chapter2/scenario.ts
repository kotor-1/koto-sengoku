/**
 * 歴史分岐「元亀元年・家康」第二章の城下の配役とメニューの「状態」。シナリオの差し替え口（ieyasu1570/scenario.ts）が、
 * 状態が第二章のときにここへ振り分ける。
 *
 * 置き場所は第一章と同じ場所（explore/cast.ts の SPOTS。通り道を塞がない）：忠勝＝源蔵の所、石川数正＝新八の所、使い＝支度の使者の所、
 * 高札、城門（支度だけ）。人物の見た目は、既存の人物の見た目を暫定の素材として使う（美術の作り直しはしない）。
 */
import { GATE_REACH, SPOTS, TALK_REACH, headingToward, type CastMember, type Spot } from '../../../explore/cast';
import { START, type Rect } from '../../../layout';
import { formatSavedTime, type StatusLine } from '../../scenario';
import type { CharacterId } from '../../state';
import { presentIeyasu2Talks } from './flow';
import type { Ieyasu2State, Ieyasu2TalkId } from './state';
import { ieyasu2StatusRows, ieyasu2TalkName } from './story';
import { lookoutCast } from '../story/lookout';

const WEST = -Math.PI / 2;
const SOUTH = 0;
const rectAround = (x: number, z: number, hx: number, hz = hx): Rect => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz });

/** 人物の見た目（既存の人物の見た目を暫定で使う。忠勝は第一章と同じ、石川は源蔵の見た目、使いは方針ごと） */
export function ieyasu2LookOf(state: Ieyasu2State, id: 'tadakatsu' | 'ishikawa' | 'envoy'): CharacterId {
    if (id === 'tadakatsu') return 'shinpachi';
    if (id === 'ishikawa') return 'genzo';
    return state.policy === 'asai' ? 'omori_envoy' : 'tashiro_envoy';
}

function spotFor(phase: 'explore' | 'muster' | 'aftermath', id: Ieyasu2TalkId, sit: boolean): Spot | undefined {
    const S = SPOTS;
    switch (id) {
        case 'tadakatsu':
            return phase === 'explore' ? S.explore.genzo : sit ? S.aftermath.genzo_sit : S[phase].genzo;
        case 'ishikawa':
            return S[phase].shinpachi;
        case 'envoy':
            return S.muster.envoy;
        case 'notice':
            return S[phase].notice;
        case 'gate':
            return S.muster.gate;
        default:
            return undefined;
    }
}

/** 物語を進める相手（目印）：探索・戦後は忠勝、支度は補充を答えるまで石川数正、答えた後は城門 */
export function ieyasu2KeyTalk(state: Ieyasu2State): Ieyasu2TalkId | null {
    switch (state.phase) {
        case 'explore':
        case 'aftermath':
            return 'tadakatsu';
        case 'muster':
            return state.recovery ? 'gate' : 'ishikawa';
        default:
            return null;
    }
}

/** 城下に置く相手（話す人物・高札・城門）と、物見できる段階（探索・支度）の物見櫓（kind 'lookout'。目印は付けない） */
export function ieyasu2CastFor(state: Ieyasu2State): CastMember<Ieyasu2TalkId | 'lookout'>[] {
    const phase = state.phase;
    if (phase !== 'explore' && phase !== 'muster' && phase !== 'aftermath') return [];
    const key = ieyasu2KeyTalk(state);
    const out: CastMember<Ieyasu2TalkId | 'lookout'>[] = [];
    for (const id of presentIeyasu2Talks(state)) {
        if (id === 'council') continue;
        if (id === 'gate') {
            const [x, z, h] = spotFor(phase, id, false)!;
            out.push({ id, kind: 'gate', x, z, heading: h ?? SOUTH, pose: 'stand', label: ieyasu2TalkName(state.policy, 'gate'), verb: '出陣', reach: GATE_REACH, key: key === id, solid: null });
            continue;
        }
        if (id === 'notice') {
            const [x, z, h] = spotFor(phase, id, false)!;
            const heading = h ?? WEST;
            const alongZ = Math.abs(Math.sin(heading)) > 0.5;
            out.push({ id, kind: 'notice', x, z, heading, pose: 'stand', label: ieyasu2TalkName(state.policy, 'notice'), verb: '読む', reach: TALK_REACH, key: key === id, solid: alongZ ? rectAround(x, z, 0.2, 0.8) : rectAround(x, z, 0.8, 0.2) });
            continue;
        }
        const sit = id === 'tadakatsu' && phase === 'aftermath' && state.characters.tadakatsu === 'wounded';
        const spot = spotFor(phase, id, sit);
        if (!spot) continue;
        const [x, z, h] = spot;
        out.push({
            id,
            kind: 'person',
            look: ieyasu2LookOf(state, id as 'tadakatsu' | 'ishikawa' | 'envoy'),
            x,
            z,
            heading: h ?? headingToward(x, z, START.x, START.z),
            pose: sit ? 'sit' : 'stand',
            label: ieyasu2TalkName(state.policy, id as 'tadakatsu' | 'ishikawa' | 'envoy'),
            verb: '話す',
            reach: TALK_REACH,
            key: key === id,
            solid: rectAround(x, z, sit ? 0.4 : 0.25),
        });
    }
    out.push(...lookoutCast(state));
    return out;
}

/** メニューの「状態」（第二章。第一章の行も残す） */
export function ieyasu2StatusLines(s: Ieyasu2State, extraPlaySec = 0): StatusLine[] {
    const lines: StatusLine[] = ieyasu2StatusRows(s);
    const sec = Math.floor(s.playTimeSec + extraPlaySec);
    lines.push({ label: '最後の保存', value: formatSavedTime(s.savedAt) });
    lines.push({ label: '遊んだ時間', value: `${Math.floor(sec / 60)} 分` });
    return lines;
}
