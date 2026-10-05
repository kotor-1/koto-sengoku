/**
 * 城下の配役の物見櫓の相手（会話の相手ではない。「物見」で押すと物見の眺めへ。ChapterGame が kind 'lookout' を見て物見へ進める）。
 * 置き場所は town/spots.ts の LOOKOUT（町の側が場所を整える。物語の側は読むだけ）。物見できる段階（探索・支度）だけ置く。
 * 当たり判定は持たない（solid: null。櫓の当たり判定は町の配置の側）。物語を進める目印は付けない（物見は任意）。
 */
import { TALK_REACH, type CastMember } from '../../../explore/cast';
import { LOOKOUT } from '../../../town/spots';
import type { IeyasuAnyState } from '../chapter2/state';
import { LOOKOUT_ID, canScout } from './scout';

export function lookoutMember(): CastMember<typeof LOOKOUT_ID> {
    return { id: LOOKOUT_ID, kind: 'lookout', x: LOOKOUT.x, z: LOOKOUT.z, heading: 0, pose: 'stand', label: '物見櫓', verb: '物見', reach: TALK_REACH, key: false, solid: null };
}

/** 今の状態で置く物見櫓の相手（物見できない段階では空） */
export function lookoutCast(s: Pick<IeyasuAnyState, 'phase'>): CastMember<typeof LOOKOUT_ID>[] {
    return canScout(s) ? [lookoutMember()] : [];
}
