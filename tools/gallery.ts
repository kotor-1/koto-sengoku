/**
 * 開発用：すべての仮素材を並べて表示する。人物は 8 方向の歩行を再生する。
 * 使い方：npm run dev のあと http://localhost:8080/tools/gallery.html
 */
import { bridgeArt, gateArt, houseArt, keepArt, propArt, wallArt } from '../src/render/art/buildings';
import type { ArtPiece } from '../src/render/art/canvas';
import { characterAtlas, characterFrameName } from '../src/render/art/character';
import { fxArt } from '../src/render/art/fx';
import { groundArt } from '../src/render/art/ground';
import { treeArt, tuftArt } from '../src/render/art/nature';
import { DIRECTIONS, WALK_FRAMES } from '../src/render/art/spec';

const params = new URLSearchParams(location.search);
const zoom = Number(params.get('zoom') ?? 4);
const tex = Number(params.get('tex') ?? 4);
const only = params.get('only');
const list = document.getElementById('list')!;
document.getElementById('info')!.textContent = `zoom=${zoom} tex=${tex}`;

function render(p: ArtPiece): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = p.width;
    c.height = p.height;
    p.draw(c.getContext('2d')!);
    return c;
}

function show(p: ArtPiece, dark = false, scale = zoom): void {
    if (only && !p.key.includes(only)) return;
    const fig = document.createElement('figure');
    if (dark) fig.className = 'dark';
    const c = render(p);
    const isFx = p.key.startsWith('fx-');
    c.style.width = `${(isFx ? p.width / 4 : p.spec.w) * scale}px`;
    c.style.height = `${(isFx ? p.height / 4 : p.spec.h) * scale}px`;
    fig.appendChild(c);
    const cap = document.createElement('figcaption');
    cap.textContent = `${p.key} ${p.width}×${p.height}px`;
    fig.appendChild(cap);
    list.appendChild(fig);
}

function animate(style: 'hero' | 'retainer'): void {
    if (only && !style.includes(only)) return;
    const atlas = characterAtlas(style, style, tex);
    const src = render(atlas);
    const byName = new Map(atlas.frames!.map((f) => [f.name, f]));
    for (let d = 0; d < DIRECTIONS; d++) {
        const fig = document.createElement('figure');
        const c = document.createElement('canvas');
        const f0 = atlas.frames![0];
        c.width = f0.w * 2 + 8;
        c.height = f0.h;
        c.style.width = `${(atlas.spec.w * 2 + 2) * zoom}px`;
        c.style.height = `${atlas.spec.h * zoom}px`;
        fig.appendChild(c);
        const cap = document.createElement('figcaption');
        cap.textContent = `${style} 方向${d}（左：待機 右：歩行）`;
        fig.appendChild(cap);
        list.appendChild(fig);
        const ctx = c.getContext('2d')!;
        let i = 0;
        setInterval(() => {
            ctx.clearRect(0, 0, c.width, c.height);
            const idle = byName.get(characterFrameName(d, null))!;
            ctx.drawImage(src, idle.x, idle.y, idle.w, idle.h, 0, 0, idle.w, idle.h);
            const w = byName.get(characterFrameName(d, style === 'hero' ? i % WALK_FRAMES : null))!;
            ctx.drawImage(src, w.x, w.y, w.w, w.h, idle.w + 8, 0, w.w, w.h);
            i++;
        }, 1000 / 12);
    }
    show(atlas, false, zoom / 2);
}

animate('hero');
animate('retainer');
for (const p of [...houseArt(tex), ...wallArt(tex), ...gateArt(tex), ...keepArt(tex), ...bridgeArt(tex), ...propArt(tex), ...treeArt(tex), ...tuftArt(tex)]) show(p);
for (const p of fxArt()) show(p, true);
if (!only || 'ground'.includes(only)) show(groundArt(1), false, 1);
