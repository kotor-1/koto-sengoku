/**
 * 合戦の兵の形と旗の絵（家の色・字・のぼりの画像）。合戦の画面（battle/troopsView.ts・battle/view.ts）と
 * 町（explore/・town/）で共有する。three だけを使い、合戦の状態（sim）には触れない（町が合戦の画面の塊を読み込まないように）。
 * 中身は合戦の画面から移したもの（合戦の見た目は変えない）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ClanId } from '../battle/types';

/** 旗の高さ（m。合戦の旗竿） */
export const POLE_H = 10;

/** 家の色（旗・兵の鎧） */
export const CLAN_COLOR: Record<ClanId, string> = {
    kotosaka: '#2f55a8', washio: '#a8322a', tashiro: '#2f7d45', omori: '#c08d22',
    tokugawa: '#2f55a8', oda: '#c9a227', asai: '#3b3f8f', asakura: '#7a3b8f', ronin: '#6b6259',
    rival: '#8a3a2e',
};
/** 家の旗の字（仮） */
export const CLAN_CHAR: Record<ClanId, string> = { kotosaka: '琴', washio: '鷲', tashiro: '田', omori: '森', tokugawa: '徳', oda: '織', asai: '浅', asakura: '朝', ronin: '浪', rival: '敵' };

/** のぼりの紋の形（琴坂：丸に一文字、鷲尾：三つ鱗、田代：菱、ほか：丸に三つ引） */
export type BannerCrest = 'kotosaka' | 'washio' | 'tashiro' | 'other';
const crestOf = (clan: ClanId): BannerCrest => (clan === 'kotosaka' || clan === 'washio' || clan === 'tashiro' ? clan : 'other');

/** のぼりの画像：家の色の地に、白い丸の中の紋（簡単な図形）と家の字（合戦の画面と同じ） */
export function makeBannerTexture(clan: ClanId): THREE.CanvasTexture {
    return paintBanner(CLAN_COLOR[clan], CLAN_CHAR[clan], crestOf(clan));
}

/**
 * 旗の一文字（例：徳・織・浅）ののぼりの画像（町の兵・演出の旗）。合戦の家の字なら、その家と同じ画像。
 * 知らない字は、くすんだ色の地に丸に三つ引の紋とその字。
 */
export function makeMarkBannerTexture(mark: string): THREE.CanvasTexture {
    const clan = clanOfMark(mark);
    return clan ? makeBannerTexture(clan) : paintBanner('#6b6259', [...mark][0] ?? '', 'other');
}

/** 旗の一文字の家（CLAN_CHAR を逆に引く。同じ字が無ければ null） */
export function clanOfMark(mark: string): ClanId | null {
    for (const [k, v] of Object.entries(CLAN_CHAR) as [ClanId, string][]) if (v === mark) return k;
    return null;
}

function paintBanner(color: string, char: string, crest: BannerCrest): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 300;
    const g = cv.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 300);
    // 上の帯（乳＝竿に通す輪のあたり）
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, 128, 14);
    // 紋の丸
    const cx = 64;
    const cy = 78;
    g.fillStyle = '#f4efe2';
    g.beginPath();
    g.arc(cx, cy, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1712';
    g.strokeStyle = '#1b1712';
    g.lineWidth = 7;
    if (crest === 'kotosaka') {
        // 丸に一文字
        g.beginPath();
        g.arc(cx, cy, 33, 0, Math.PI * 2);
        g.stroke();
        g.fillRect(cx - 26, cy - 6, 52, 12);
    } else if (crest === 'washio') {
        // 三つ鱗
        const tri = (x: number, y: number, s: number) => {
            g.beginPath();
            g.moveTo(x, y - s);
            g.lineTo(x + s * 0.95, y + s * 0.65);
            g.lineTo(x - s * 0.95, y + s * 0.65);
            g.closePath();
            g.fill();
        };
        tri(cx, cy - 15, 17);
        tri(cx - 18, cy + 16, 17);
        tri(cx + 18, cy + 16, 17);
    } else if (crest === 'tashiro') {
        // 菱
        g.beginPath();
        g.moveTo(cx, cy - 34);
        g.lineTo(cx + 26, cy);
        g.lineTo(cx, cy + 34);
        g.lineTo(cx - 26, cy);
        g.closePath();
        g.fill();
        g.fillStyle = '#f4efe2';
        g.fillRect(cx - 26, cy - 3, 52, 6);
    } else {
        // 丸に三つ引
        g.beginPath();
        g.arc(cx, cy, 33, 0, Math.PI * 2);
        g.stroke();
        for (const dy of [-14, 0, 14]) g.fillRect(cx - 24, cy + dy - 4, 48, 8);
    }
    g.fillStyle = '#f4efe2';
    g.font = 'bold 84px "Hiragino Mincho ProN", "Noto Serif CJK JP", "Noto Sans CJK JP", "Yu Mincho", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(char, cx, 210);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ---------------------------------------------------------------- 兵の形（battle/troopsView.ts から移した。中身は同じ）

/** 部分の形に色を付けて置く（まとめる前の部品） */
export function part(g: THREE.BufferGeometry, color: string | number, x: number, y: number, z: number, rx = 0, rz = 0): THREE.BufferGeometry {
    const geo = g;
    geo.deleteAttribute('uv');
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    const c = typeof color === 'number' ? new THREE.Color(color, color, color) : new THREE.Color(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    for (const p of parts) p.dispose();
    return g;
}

/**
 * 兵士の形（前は -z。1 m 単位で作り、置くときに TROOP_FIG 倍にする）と旗の形。簡単な箱と円すいだけ（美術の作り込みはしない）。
 * - body：足・胴・袖・陣笠・背中の小旗（家の色に染める。明暗だけ頂点の色で付ける）
 * - spear：頭と槍（槍・本陣・騎馬）、bow：頭と弓と矢筒（弓）
 * - horse：馬（騎馬。乗り手は body を高くして置く）
 * - pole：旗竿（根元が原点）、top：本陣の旗の頭の玉、banner・big：のぼり（竿の横に張る。大きい方は本陣）
 */
export function makeTroopGeometries(): Record<'body' | 'spear' | 'bow' | 'horse' | 'pole' | 'top' | 'banner' | 'big', THREE.BufferGeometry> {
    const body = merge([
        part(new THREE.BoxGeometry(0.42, 0.8, 0.28), 0.42, 0, 0.4, 0),
        part(new THREE.BoxGeometry(0.62, 0.72, 0.38), 1.0, 0, 1.16, 0),
        part(new THREE.BoxGeometry(0.9, 0.16, 0.42), 0.78, 0, 1.46, 0),
        part(new THREE.ConeGeometry(0.44, 0.24, 6), 0.9, 0, 1.94, 0),
        part(new THREE.BoxGeometry(0.05, 0.62, 0.36), 1.15, 0, 2.02, 0.26),
    ]);
    // 頭は角の少ない球（数百人を描くので、1 人あたりの三角を少なく。体・槍で約 130）
    const head = () => part(new THREE.SphereGeometry(0.19, 6, 4), '#d8b28a', 0, 1.72, 0);
    const spear = merge([
        head(),
        part(new THREE.BoxGeometry(0.06, 4.4, 0.06), '#6e5436', 0.36, 2.0, -0.2, -0.22),
        part(new THREE.ConeGeometry(0.1, 0.45, 4), '#e2e2e2', 0.36, 2.0 + 2.2 * Math.cos(0.22) + 0.2, -0.2 - 2.2 * Math.sin(0.22) - 0.05, -0.22),
    ]);
    const bow = merge([
        head(),
        part(new THREE.BoxGeometry(0.06, 1.9, 0.08), '#3a2a18', -0.4, 1.35, -0.1, 0, 0.12),
        part(new THREE.BoxGeometry(0.16, 0.55, 0.16), '#5c3b22', 0.18, 1.3, 0.28, 0.3),
    ]);
    const horse = merge([
        part(new THREE.BoxGeometry(0.56, 0.62, 1.8), '#6b4a2e', 0, 1.15, 0),
        part(new THREE.BoxGeometry(0.3, 0.75, 0.36), '#5e3f26', 0, 1.62, -0.82, -0.55),
        part(new THREE.BoxGeometry(0.26, 0.28, 0.62), '#5e3f26', 0, 1.98, -1.18),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', -0.2, 0.43, -0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', 0.2, 0.43, -0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', -0.2, 0.43, 0.7),
        part(new THREE.BoxGeometry(0.14, 0.86, 0.14), '#4a321e', 0.2, 0.43, 0.7),
        part(new THREE.BoxGeometry(0.62, 0.1, 0.8), '#b8a27a', 0, 1.5, 0.05),
    ]);
    const pole = new THREE.CylinderGeometry(0.13, 0.16, POLE_H, 5);
    pole.translate(0, POLE_H / 2, 0);
    const banner = new THREE.PlaneGeometry(2.4, 5.6);
    banner.translate(1.3, 0, 0);
    const big = new THREE.PlaneGeometry(3.4, 7.2);
    big.translate(1.8, 0, 0);
    const top = new THREE.SphereGeometry(0.75, 10, 8);
    return { body, spear, bow, horse, pole, top, banner, big };
}
