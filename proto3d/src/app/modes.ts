/**
 * 画面の切り替え（探索 ⇄ 合戦）のつなぎ。
 * main.ts（探索）は毎フレーム、合戦などの「場面」が入っていればそちらへ進めと描画を任せ、探索の入力と描画を止める。
 * 合戦の画面（battle/）はここに自分を登録し、章の進行（campaign/）はここを通して合戦を始める。互いの中身は直接 import しない。
 */
import type * as THREE from 'three';
import type { BattleOutcome, BattleSetup } from '../battle/types';

/** 探索以外の場面（合戦など）。入っている間は main.ts の代わりに毎フレーム呼ばれる */
export interface Mode {
    /** 1 フレーム進めて描く（dt は秒。0.1 秒で切り詰め済み） */
    frame(dt: number): void;
    /** 画面の大きさが変わった */
    resize?(width: number, height: number): void;
}

/** 場面が使える共有のもの（main.ts が起動時に渡す） */
export interface AppContext {
    renderer: THREE.WebGLRenderer;
    /** 描画の入れ物（#view）と、UI を置く入れ物（#app） */
    view: HTMLElement;
    app: HTMLElement;
    /** 画質「低」（?q=low） */
    low: boolean;
    /** タッチ端末 */
    touch: boolean;
    /** 探索の入力（スティック・キー・見回し）をすべて離す */
    releaseExploreInput(): void;
}

let ctx: AppContext | null = null;
let active: Mode | null = null;
const listeners = new Set<(name: string | null) => void>();
let activeName: string | null = null;

export function setAppContext(c: AppContext): void {
    ctx = c;
}
export function appContext(): AppContext {
    if (!ctx) throw new Error('AppContext がまだ設定されていません');
    return ctx;
}

/** 場面に入る（探索の入力を離し、body に mode-<name> の印を付ける） */
export function enterMode(name: string, mode: Mode): void {
    appContext().releaseExploreInput();
    if (activeName) document.body.classList.remove(`mode-${activeName}`);
    active = mode;
    activeName = name;
    document.body.classList.add(`mode-${name}`);
    for (const l of listeners) l(name);
}
/** 場面を出て探索へ戻る */
export function exitMode(): void {
    if (activeName) document.body.classList.remove(`mode-${activeName}`);
    active = null;
    activeName = null;
    for (const l of listeners) l(null);
}
export function activeMode(): Mode | null {
    return active;
}
export function activeModeName(): string | null {
    return activeName;
}
export function onModeChange(fn: (name: string | null) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 合戦を始めて、終わったら結果を返す（battle/ が登録する） */
export type BattleRunner = (setup: BattleSetup) => Promise<BattleOutcome>;
let battleRunner: BattleRunner | null = null;
export function registerBattleRunner(fn: BattleRunner): void {
    battleRunner = fn;
}
export function getBattleRunner(): BattleRunner | null {
    return battleRunner;
}
