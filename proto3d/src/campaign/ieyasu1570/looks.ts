/**
 * 歴史分岐「元亀元年・家康」の第一章の人物の見た目（既存の人物の見た目を暫定の素材として使う。explore/world.ts の LOOKS の鍵）。
 * 城下の配役（scenario.ts）と演出の台本（story/cinematics.ts）が同じ物を使う（ここに 1 か所。scenario.ts から今までどおり再び出す）。
 */
import type { CharacterId } from '../state';

export const IEYASU_LOOKS: Readonly<Record<'tadakatsu' | 'oda_envoy' | 'asai_envoy', CharacterId>> = {
    tadakatsu: 'shinpachi',
    oda_envoy: 'tashiro_envoy',
    asai_envoy: 'omori_envoy',
};

/**
 * 第二章 C の村の使いの見た目：町の人（explore/people.ts の LOOKS の townsman_a。くすんだ黄土の小袖に濃い袴。
 * 武家の使者の見た目＝織田家の使者の赤茶・浅井家の使者の明るい藍と違う色）。城下の配役（chapter2/scenario.ts）と
 * 演出の使いの到着（story/cinematics.ts の messenger_arrive）で同じ物を使う（演出の使いは、見た目の鍵で城下の配役を探して、その置き場所へ歩く）。
 * 配役の見た目の型（explore/cast.ts の CastMember.look）は今は人物の id（CharacterId）なので、その型で渡す。中身は見た目の鍵の文字列で、
 * 表示（explore/world.ts・people.ts）は LOOKS をこの文字列で引く。型を見た目の鍵へ広げるのは町の担当に頼んだ。
 */
export const VILLAGER_LOOK = 'townsman_a' as string as CharacterId;
