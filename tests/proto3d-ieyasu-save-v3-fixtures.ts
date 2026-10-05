/**
 * 歴史分岐シナリオ「元亀元年・家康」第一章の版 3 の保存データ（結末 9 つと戦後 1 つ）。
 * 第二章を足す前のコード（保存の形を変える前）の IeyasuSaveStore.save が実際に書いた文字列を、そのまま JSON のファイルに残した物
 * （tests/fixtures/ieyasu-ch1-v3/。作り方は同じ所の README.md と generate.ts。状態は直接作った：直接状態変更）。
 * 第二章のテスト・e2e は、このファイルの文字列を localStorage に入れて「すでに第一章を終えた保存から第二章へ進める」ことを確かめる。
 */
import { IEYASU_CH1_V3_FIXTURE_NAMES, type IeyasuCh1V3FixtureName } from './fixtures/ieyasu-ch1-v3/generate';

export { IEYASU_CH1_V3_FIXTURE_NAMES, type IeyasuCh1V3FixtureName };

const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (p: URL, enc: 'utf8') => string };

/** 名前 → 保存の文字列（ファイルの中身そのもの） */
export const IEYASU_V3_FIXTURES: Readonly<Record<IeyasuCh1V3FixtureName, string>> = Object.fromEntries(
    IEYASU_CH1_V3_FIXTURE_NAMES.map((n) => [n, fs.readFileSync(new URL(`./fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8')]),
) as Record<IeyasuCh1V3FixtureName, string>;
