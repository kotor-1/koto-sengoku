/**
 * 確かめ用の仮の台本と情勢（演出の再生器・情勢の画面・地図の描き方を、物語の中身と切り離して確かめる）。
 * 単体テスト（tests/proto3d-story-*.test.ts）と、開発ビルドの __game.sampleCine()／sampleSituation() だけで使う。本番の流れでは使わない。
 * 文は確かめ用（史実の言葉・地名は使わない）。
 */
import type { CineSpec, MapScene, SituationView } from './types';

const NOTE = '模式図（確かめ用）。位置と距離は正確ではない';

/** 確かめ用の地図 */
export function sampleScene(): MapScene {
    return {
        heading: '確かめ用・ある年の城下',
        note: NOTE,
        places: [
            { id: 'home', name: '味方の城下', x: 70, y: 72, kind: 'home', side: 'self', mark: '自' },
            { id: 'east', name: '東の国', x: 22, y: 26, kind: 'region', side: 'ally', mark: '東' },
            { id: 'north', name: '北の国', x: 62, y: 18, kind: 'region', side: 'enemy', mark: '北' },
            { id: 'field', name: '境の原', x: 40, y: 50, kind: 'field', side: 'neutral', note: '合戦の場所' },
            { id: 'village', name: '小さな村', x: 86, y: 40, kind: 'village', side: 'unknown' },
        ],
        routes: [
            { id: 'r_march', from: 'home', to: 'field', kind: 'march', side: 'self', label: '出陣' },
            { id: 'r_threat', from: 'north', to: 'field', kind: 'threat', side: 'enemy' },
            { id: 'r_ally', from: 'east', to: 'home', kind: 'alliance', side: 'ally', via: [{ x: 40, y: 80 }] },
            { id: 'r_envoy', from: 'village', to: 'home', kind: 'envoy', side: 'unknown' },
        ],
    };
}

/** 確かめ用の台本（地図の場面 2 つ・3D の場面 1 つ・地図の場面 1 つ。長さ 32 秒） */
export function sampleCineSpec(moment: CineSpec['moment'] = 'ch1_intro'): CineSpec {
    const scene = sampleScene();
    const short = moment === 'departure' || moment === 'return';
    if (short) {
        return {
            id: `sample.${moment}`,
            moment,
            title: moment === 'departure' ? '確かめ用の出陣' : '確かめ用の帰還',
            duration: 10,
            beats: [
                { kind: 'stage', start: 0, end: 6, event: moment === 'departure' ? { id: 'column_depart', count: 6, mark: '自' } : { id: 'column_return', count: 4, wounded: 2, mark: '自', victory: false } },
                { kind: 'map', start: 6, end: 10, scene: { ...scene, highlight: ['r_march'] }, appear: { r_march: 0.5 } },
            ],
            captions: [
                { start: 0.5, end: 4, text: '確かめ用：隊列が動く場面。' },
                { start: 6.2, end: 9.8, text: '確かめ用：地図の矢印。' },
            ],
            info: { where: 6 },
        };
    }
    return {
        id: `sample.${moment}`,
        moment,
        title: '確かめ用の導入',
        duration: 32,
        beats: [
            {
                kind: 'map',
                start: 0,
                end: 10,
                scene: { ...scene, places: scene.places.filter((p) => p.id !== 'village'), routes: scene.routes.filter((r) => r.id !== 'r_envoy') },
                appear: { east: 1.5, north: 3, field: 5, r_ally: 2.5, r_threat: 6, r_march: 7.5 },
                highlights: [
                    { at: 0, ids: ['home'] },
                    { at: 5, ids: ['field', 'r_threat'] },
                ],
            },
            { kind: 'stage', start: 10, end: 18, event: { id: 'envoys_arrive', envoys: [{ look: 'oda_envoy', name: '東の使者' }] } },
            { kind: 'map', start: 18, end: 26, scene: { ...scene, highlight: ['village'] }, appear: { village: 1, r_envoy: 2 } },
            { kind: 'stage', start: 26, end: 32, event: { id: 'wounded_rest', count: 3 } },
        ],
        captions: [
            { start: 0.5, end: 4.5, text: '確かめ用：いつ・どこにいるかの字幕。' },
            { start: 5, end: 9.5, speaker: '語り', text: '確かめ用：脅かす向きを地図で示す。' },
            { start: 10.5, end: 15, speaker: '使者', text: '確かめ用：使者が町へ入る場面です。' },
            { start: 18.5, end: 23, text: '確かめ用：村からの使いの線。' },
            { start: 26.5, end: 31.5, text: '確かめ用：判断は軍議で選ぶ。' },
        ],
        info: { when: 0.5, where: 0.5, ally: 2.5, crisis: 6, prev: 18.5, decide: 26.5 },
    };
}

/** 確かめ用の情勢（軍議の選択肢 2 つ） */
export function sampleSituation(withOptions = false): SituationView {
    const scene = sampleScene();
    return {
        title: '情勢（確かめ用）',
        when: 'ある年（確かめ用）',
        where: '味方の城下',
        allies: ['○ 東の国'],
        enemies: ['✕ 北の国'],
        prev: null,
        crisis: '北の国が境の原へ出てくるおそれ（確かめ用）',
        objective: '境の原で味方を守る（確かめ用）',
        map: scene,
        ...(withOptions
            ? {
                  options: [
                      { id: 'opt_a', label: '原へ出る', highlight: ['field', 'r_march'], text: '確かめ用：原へ出て受け止める。' },
                      { id: 'opt_b', label: '村を守る', highlight: ['village', 'r_envoy'], text: '確かめ用：村の方を固める。' },
                  ],
              }
            : {}),
        scouted: [],
        scoutHint: '確かめ用：物見櫓で物見をすると、ここに記録が入る（任意）。',
        replays: [{ moment: 'ch1_intro', title: '確かめ用の導入' }],
    };
}
