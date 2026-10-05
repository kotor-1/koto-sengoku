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
