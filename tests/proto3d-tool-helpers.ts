// 公開の道具（proto3d/tools/*.mjs）をコマンドとして動かすテストの手伝い（Version 27）。
// テストは Node で動く。Node の型定義は入れていないので、使う関数だけ型を付ける（tests/proto3d-art-manifest.test.ts と同じやり方）。
export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
export const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as {
    existsSync(p: string): boolean;
    mkdirSync(p: string, o?: { recursive?: boolean }): void;
    mkdtempSync(prefix: string): string;
    readFileSync(p: string): Uint8Array;
    readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
    rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
    symlinkSync(target: string, path: string): void;
    unlinkSync(p: string): void;
    writeFileSync(p: string, data: string | Uint8Array): void;
};
export const path = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as {
    join(...parts: string[]): string;
    dirname(p: string): string;
};
const os = (await import(/* @vite-ignore */ 'node:' + 'os')) as unknown as { tmpdir(): string };
const cp = (await import(/* @vite-ignore */ 'node:' + 'child_process')) as unknown as {
    spawnSync(cmd: string, args: string[], o: { encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string };
};
const nodeCrypto = (await import(/* @vite-ignore */ 'node:' + 'crypto')) as unknown as {
    createHash(alg: string): { update(b: Uint8Array): { digest(enc: 'hex'): string } };
};
const nodeProcess = (globalThis as unknown as { process: { execPath: string } }).process;

/** リポジトリの中のファイルの絶対パス */
export const repoPath = (rel: string) => decodeURIComponent(new URL(`../${rel}`, import.meta.url).pathname);

/** コマンドを動かす（終わりの番号・標準出力・標準エラー） */
export function sh(cmd: string, args: string[]) {
    return cp.spawnSync(cmd, args, { encoding: 'utf8' });
}

/** Node で道具（.mjs）を動かす */
export function node(tool: string, args: string[]) {
    return sh(nodeProcess.execPath, [tool, ...args]);
}

/** 一時の置き場（テストの終わりに消す） */
export const makeTemp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export const sha256 = (b: Uint8Array) => nodeCrypto.createHash('sha256').update(b).digest('hex');

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export const readText = (p: string) => new TextDecoder().decode(fs.readFileSync(p));

// 1×1 の PNG・2×2 の JPEG・2×2 の WebP（中身は本物の画像。Pillow で作って開けることを確かめた）
export const PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
export const JPEG = fromBase64(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCKiiivjz74/9k=',
);
export const WEBP = fromBase64('UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoCAAIAAUAmJaACdLoB+AAEyAAA/q4X/zYEDND6YP/SbPE2eJs+OYAA');
