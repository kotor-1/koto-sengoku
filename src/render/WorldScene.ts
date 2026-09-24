/**
 * 探索画面（2.5D 表現）。
 *
 * ゲームの状態（GameSession）を読んで絵を合わせるだけで、状態を書き換えるのは
 * source.tick() の中（core 側）だけ。当たり判定・移動は core の 2D のまま。
 *
 * 描画の層（depth）：
 *   地面 → 地面の質感 → 水面のきらめき → 橋・花 → 影
 *   → 【立っている物：民家・木・城壁・人物・草むら …】（足元の Y 座標で前後を決める）
 *   → 煙・漂う粒子 → 光のかぶせ（乗算・加算・周辺減光）→ 灯り → 吹き出し
 */
import { BlendModes, Geom, Scene } from 'phaser';
import { ACTOR_HALF_H } from '../core/constants';
import { MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, tileCenter } from '../core/map';
import type { GameSession } from '../core/session';
import type { ActorState } from '../core/state';
import { bridgeArt, gateArt, houseArt, houseKey, houseShadowKey, keepArt, propArt, wallArt } from './art/buildings';
import type { ArtPiece } from './art/canvas';
import { characterAtlas, characterFrameName, type CharacterStyle } from './art/character';
import { fxArt } from './art/fx';
import { groundArt } from './art/ground';
import { TREE_KEYS, treeArt, tuftArt } from './art/nature';
import { CHARACTER, FLOWER_VARIANTS, GATE, HOUSE_FRONT_H, SHADOW_DIR, WALK_FRAMES, WALL_H, houseSpec } from './art/spec';
import type { Viewport } from './viewport';
import { CameraFollower } from './world/camera';
import { HeadingTracker } from './world/heading';
import { bridges, gateRect, grassTuftSpots, houseRects, keepRect, tilesOf, trees, wallTiles, waterRects } from './world/layout';
import { PRESETS, effectiveTint, lerpPreset, type AmbientKind, type LightPreset, type TimeOfDay } from './world/lighting';
import { ResolutionGovernor, type QualityProfile } from './world/quality';

/** 描画側が必要とするものだけを受け取る */
export interface WorldSource {
    getSession(): GameSession | null;
    /** 1 フレーム分ゲームを進める（入力の読み取りと状態更新） */
    tick(dtSec: number): void;
    getTimeOfDay(): TimeOfDay;
}

const T = 16;
const DEPTH = {
    GROUND: -100000,
    DETAIL: -99990,
    WATER: -99980,
    DECAL: -99970,
    SHADOW: -99960,
    SMOKE: 90000,
    LIGHT: 100000,
    UI: 110000,
} as const;

/** 立っている物（前後関係・半透明化・画面外の間引きの対象） */
interface Standing {
    obj: Phaser.GameObjects.Image;
    /** 見た目の範囲（ワールド px） */
    left: number;
    top: number;
    right: number;
    bottom: number;
    /** 足元の Y（描画順） */
    baseY: number;
    /** 主人公が後ろに入ったら半透明にする */
    occluder: boolean;
    /** 半透明にするときの濃さ */
    fadeTo: number;
    /** 揺れ（0 なら揺れない） */
    sway: number;
    swaySpeed: number;
    phase: number;
    /** この物に付属して一緒に表示・非表示にする物（影など） */
    attached: Phaser.GameObjects.Image[];
}

interface ActorView {
    sprite: Phaser.GameObjects.Sprite;
    contact: Phaser.GameObjects.Image;
    cast: Phaser.GameObjects.Image;
    heading: HeadingTracker;
    baseScale: number;
    prevX: number;
    prevY: number;
    velX: number;
    velY: number;
    style: CharacterStyle;
}

interface Glow {
    img: Phaser.GameObjects.Image;
    phase: number;
}

interface CastShadow {
    img: Phaser.GameObjects.Image;
    baseScaleX: number;
    /** 時間帯で影を伸ばす度合い（1 = castLength をそのまま、0 = 伸ばさない）。
     *  家や天守の影は基準点の左右に広がっているので、伸ばしすぎると左へはみ出す。 */
    stretch: number;
}

export class WorldScene extends Scene {
    private hero!: ActorView;
    private retainer!: ActorView;
    private bound: GameSession | null = null;

    private readonly artSpecs = new Map<string, ArtPiece>();
    private readonly standing: Standing[] = [];
    private readonly tufts: Standing[] = [];
    private readonly waterLayers: { ts: Phaser.GameObjects.TileSprite; vx: number; vy: number; weight: number }[] = [];
    private readonly castShadows: CastShadow[] = [];
    private readonly glows: Glow[] = [];
    private readonly smoke: { emitter: Phaser.GameObjects.Particles.ParticleEmitter; x: number; y: number }[] = [];
    private ambient: Record<AmbientKind, Phaser.GameObjects.Particles.ParticleEmitter> | null = null;
    private readonly ambientZone = new Geom.Rectangle(0, 0, 10, 10);

    private tintLayer!: Phaser.GameObjects.Image;
    private sunLayer!: Phaser.GameObjects.Image;
    private vignette!: Phaser.GameObjects.Image;
    private bubble!: Phaser.GameObjects.Image;

    private readonly follow = new CameraFollower();
    private readonly governor = new ResolutionGovernor();
    private elapsed = 0;
    private tod: TimeOfDay = 'evening';
    private light: LightPreset = PRESETS.evening;
    private lightFrom: LightPreset = PRESETS.evening;
    private lightT = 1;
    private lastCull = { x: -1e9, y: -1e9, zoom: 0, frame: 0 };
    private frame = 0;
    private fpsEl: HTMLElement | null = null;
    private fpsTimer = 0;
    /** 起動時の計測（素材の生成時間など）。開発時の確認用。 */
    readonly stats = { artMs: 0, createMs: 0, textureBytes: 0 };

    constructor(
        private readonly source: WorldSource,
        private readonly viewport: Viewport,
        private readonly quality: QualityProfile,
        private readonly showFps: boolean,
    ) {
        super('World');
    }

    // ------------------------------------------------------------------
    // 作成
    // ------------------------------------------------------------------

    create(): void {
        const t0 = performance.now();
        const q = this.quality;
        const tex = q.objectTex;
        this.registerArt(groundArt(q.groundTex));
        for (const list of [houseArt(tex), wallArt(tex), gateArt(tex), keepArt(tex), bridgeArt(tex), propArt(tex), treeArt(tex), tuftArt(tex), fxArt()]) {
            for (const p of list) this.registerArt(p);
        }
        this.registerArt(characterAtlas('hero', 'hero', tex));
        this.registerArt(characterAtlas('retainer', 'retainer', tex));
        this.makeWhite();
        this.stats.artMs = Math.round(performance.now() - t0);

        this.createGround();
        this.createWater();
        this.createBridges();
        this.createWalls();
        this.createCastle();
        this.createHouses();
        this.createTrees();
        this.createProps();
        this.createGrass();
        this.hero = this.createActor('hero');
        this.retainer = this.createActor('retainer');
        this.createSmoke();
        this.createAmbient();
        this.createLighting();
        this.bubble = this.placeArt('fx-bubble', 0, 0).setDepth(DEPTH.UI).setVisible(false);

        const cam = this.cameras.main;
        cam.setBounds(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT);
        cam.setRoundPixels(false);
        this.viewport.onChange(() => this.applyZoom());
        this.applyZoom();
        this.tod = this.source.getTimeOfDay();
        this.light = this.lightFrom = PRESETS[this.tod];
        this.applyLight(this.light);
        this.showIdleView();

        this.stats.createMs = Math.round(performance.now() - t0);
        if (this.showFps) {
            this.fpsEl = document.createElement('div');
            this.fpsEl.id = 'fps-meter';
            document.body.appendChild(this.fpsEl);
        }
    }

    private registerArt(p: ArtPiece): void {
        if (this.textures.exists(p.key)) return;
        const tex = this.textures.createCanvas(p.key, p.width, p.height);
        if (!tex) throw new Error(`テクスチャ ${p.key} を作れませんでした`);
        p.draw(tex.context);
        for (const f of p.frames ?? []) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
        tex.refresh();
        this.artSpecs.set(p.key, p);
        this.stats.textureBytes += p.width * p.height * 4;
    }

    /** 素材を「基準点（地面に接する点）」に置いた Image を作る。大きさは spec のワールド px。 */
    private placeArt(key: string, x: number, y: number): Phaser.GameObjects.Image {
        const p = this.artSpecs.get(key);
        if (!p) throw new Error(`素材 ${key} がありません`);
        return this.add.image(x, y, key).setOrigin(p.spec.ox, p.spec.oy).setScale(p.spec.w / p.width, p.spec.h / p.height);
    }

    private makeWhite(): void {
        if (this.textures.exists('white')) return;
        const t = this.textures.createCanvas('white', 4, 4)!;
        t.context.fillStyle = '#fff';
        t.context.fillRect(0, 0, 4, 4);
        t.refresh();
    }

    private addStanding(
        obj: Phaser.GameObjects.Image,
        baseY: number,
        opts: Partial<Pick<Standing, 'occluder' | 'fadeTo' | 'sway' | 'swaySpeed' | 'phase' | 'attached'>> = {},
        list: Standing[] = this.standing,
    ): Standing {
        obj.setDepth(baseY);
        const b = obj.getBounds();
        const s: Standing = {
            obj,
            left: b.x,
            top: b.y,
            right: b.x + b.width,
            bottom: b.y + b.height,
            baseY,
            occluder: opts.occluder ?? true,
            fadeTo: opts.fadeTo ?? 0.42,
            sway: opts.sway ?? 0,
            swaySpeed: opts.swaySpeed ?? 1,
            phase: opts.phase ?? 0,
            attached: opts.attached ?? [],
        };
        list.push(s);
        return s;
    }

    private createGround(): void {
        this.placeArt('ground', 0, 0).setDepth(DEPTH.GROUND);
        if (this.quality.groundDetail) {
            // 細かい質感を乗算で重ねる（地面の絵を大きくせずに、近くで見ても粗く見えないように）
            this.add
                .tileSprite(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT, 'fx-detail')
                .setOrigin(0)
                .setTileScale(0.25)
                .setBlendMode(BlendModes.MULTIPLY)
                .setDepth(DEPTH.DETAIL);
        }
    }

    private createWater(): void {
        for (const r of waterRects()) {
            const x = r.tx * T;
            const y = r.ty * T;
            const w = r.tw * T;
            const h = r.th * T;
            const river = r.th > r.tw; // 川（南へ流れる）か堀か
            const a = this.add.tileSprite(x, y, w, h, 'fx-ripple').setOrigin(0).setTileScale(0.25).setBlendMode(BlendModes.ADD).setDepth(DEPTH.WATER);
            const b = this.add.tileSprite(x, y, w, h, 'fx-ripple').setOrigin(0).setTileScale(0.36).setBlendMode(BlendModes.ADD).setDepth(DEPTH.WATER);
            b.tilePositionX = 37;
            b.tilePositionY = 53;
            this.waterLayers.push({ ts: a, vx: river ? 1.5 : 6, vy: river ? -14 : 1.2, weight: 1 });
            this.waterLayers.push({ ts: b, vx: river ? -2 : -4, vy: river ? -9 : -1.5, weight: 0.7 });
        }
    }

    private createBridges(): void {
        for (const br of bridges()) {
            const cx = (br.tx + br.tw / 2) * T;
            const top = br.ty * T;
            const bottom = (br.ty + br.th) * T;
            if (br.dir === 'ns') {
                this.placeArt('bridge-ns', cx, bottom).setDepth(DEPTH.DECAL);
            } else {
                this.placeArt('bridge-ew', cx, bottom).setDepth(DEPTH.DECAL);
                // 北の欄干は人物の後ろ、南の欄干は手前（橋の上の人物の足元が隠れる）
                this.addStanding(this.placeArt('bridge-ew-rail', cx, top + 3), top + 3, { occluder: false });
                this.addStanding(this.placeArt('bridge-ew-rail', cx, bottom + 1), bottom + 1, { occluder: false });
            }
        }
    }

    private createWalls(): void {
        for (const w of wallTiles()) {
            const key = `wall-${w.horizontal ? 'h' : 'v'}${w.front ? '-front' : ''}`;
            const baseY = w.ty * T + T;
            const img = this.placeArt(key, w.tx * T, w.front ? baseY : baseY - WALL_H);
            // 壁の根元の柔らかい陰り
            const attached = w.front ? [this.shadowBlob(w.tx * T + 8, baseY + 1, 22, 6, 0.3)] : [];
            this.addStanding(img, baseY, { attached, fadeTo: 0.5 });
        }
    }

    private createCastle(): void {
        const k = keepRect();
        const kx = (k.tx + k.tw / 2) * T;
        const ky = (k.ty + k.th) * T;
        const shadow = this.castShadow('shadow-keep', kx, ky, 0.25);
        this.addStanding(this.placeArt('keep', kx, ky), ky, { attached: [shadow], fadeTo: 0.5 });

        const g = gateRect();
        const gx = (g.tx + g.tw / 2) * T;
        const gy = (g.ty + g.th) * T;
        // 門は同じ行の城壁より手前に
        this.addStanding(this.placeArt('gate', gx, gy), gy + 0.5, { fadeTo: 0.45 });
        for (const dx of [-GATE.w / 2 + 14, GATE.w / 2 - 14]) this.addGlow(gx + dx, gy - 26, 26);
    }

    private createHouses(): void {
        houseRects().forEach((r, i) => {
            const cx = (r.tx + r.tw / 2) * T;
            const bottom = (r.ty + r.th) * T;
            const shadow = this.castShadow(houseShadowKey(r.tw), cx, bottom, 0.3);
            this.addStanding(this.placeArt(houseKey(r.tw, i), cx, bottom), bottom, { attached: [shadow] });
            // 夜の灯り：軒先の提灯と窓
            const spec = houseSpec(r.tw);
            this.addGlow(cx - spec.w / 2 + 12, bottom - HOUSE_FRONT_H + 8, 30);
            this.addGlow(cx + spec.w / 2 - 16, bottom - 14, 20);
        });
    }

    private createTrees(): void {
        for (const t of trees()) {
            const h = hash(t.tx, t.ty);
            // 外周は林らしく松を多めに
            const key = t.border ? TREE_KEYS[h < 0.55 ? 0 : h < 0.8 ? 1 : 2] : TREE_KEYS[h < 0.35 ? 0 : h < 0.7 ? 1 : 2];
            const x = t.tx * T + 8 + (h - 0.5) * 3;
            const y = t.ty * T + 14;
            const shadow = this.castShadow('shadow-tree', x, y);
            const img = this.placeArt(key, x, y);
            if (h > 0.5) img.setFlipX(true);
            this.addStanding(img, y, { attached: [shadow], fadeTo: 0.5, sway: 0.012, swaySpeed: 0.7 + h * 0.5, phase: h * 10 });
        }
    }

    private createProps(): void {
        const place = (key: string, tx: number, ty: number) => {
            const c = tileCenter(tx, ty);
            const y = ty * T + T - 2;
            this.addStanding(this.placeArt(key, c.x, y), y, { occluder: false, attached: [this.shadowBlob(c.x + 2, y, 16, 6, 0.35)] });
        };
        for (const p of tilesOf('o')) place('prop-well', p.tx, p.ty);
        for (const p of tilesOf('N')) place('prop-notice', p.tx, p.ty);
        for (const p of tilesOf('M')) place('prop-milestone', p.tx, p.ty);
        for (const p of tilesOf('X')) place('prop-barricade', p.tx, p.ty);
        const fences = tilesOf('F');
        for (const p of fences) {
            const horizontal = fences.some((o) => o.ty === p.ty && Math.abs(o.tx - p.tx) === 1);
            const y = p.ty * T + T;
            this.addStanding(this.placeArt(horizontal ? 'prop-fence-h' : 'prop-fence-v', p.tx * T, y), y, { occluder: false });
        }
        // 地面の花（揺れない・影なし）
        for (const p of tilesOf('b')) {
            for (let k = 0; k < 3; k++) {
                const h = hash(p.tx * 3 + k, p.ty * 7);
                this.placeArt(`flower-${Math.floor(h * FLOWER_VARIANTS)}`, p.tx * T + 3 + h * 10, p.ty * T + 3 + hash(p.ty, p.tx + k) * 10).setDepth(DEPTH.DECAL + 1);
            }
        }
    }

    private createGrass(): void {
        for (const s of grassTuftSpots(this.quality.grassTufts)) {
            const img = this.placeArt(`tuft-${s.variant}`, s.x, s.y);
            if (hash(Math.round(s.x), Math.round(s.y)) > 0.5) img.setFlipX(true);
            this.addStanding(img, s.y, { occluder: false, sway: 0.09, swaySpeed: 1.8, phase: s.x * 0.06 }, this.tufts);
        }
    }

    private createActor(style: CharacterStyle): ActorView {
        const contact = this.add.image(0, 0, 'fx-shadow').setDepth(DEPTH.SHADOW + 1).setDisplaySize(16, 6);
        const cast = this.add.image(0, 0, 'fx-cast').setOrigin(0, 0.5).setDepth(DEPTH.SHADOW).setDisplaySize(24, 7);
        cast.setRotation(Math.atan2(SHADOW_DIR.y, SHADOW_DIR.x));
        this.castShadows.push({ img: cast, baseScaleX: cast.scaleX, stretch: 1 });
        const p = this.artSpecs.get(style)!;
        const baseScale = CHARACTER.w / p.frames![0].w;
        const sprite = this.add.sprite(0, 0, style, characterFrameName(0, null)).setOrigin(CHARACTER.ox, CHARACTER.oy).setScale(baseScale);
        return { sprite, contact, cast, heading: new HeadingTracker('down'), baseScale, prevX: 0, prevY: 0, velX: 0, velY: 0, style };
    }

    private createSmoke(): void {
        // 城門から近い家から順に煙を出す
        const order = [...houseRects()].sort((a, b) => dist(a.tx, a.ty, 26, 20) - dist(b.tx, b.ty, 26, 20));
        for (const r of order.slice(0, this.quality.smokeSources)) {
            const spec = houseSpec(r.tw);
            const x = (r.tx + r.tw / 2) * T + spec.w * 0.18;
            const y = (r.ty + r.th) * T - spec.h + 10;
            const emitter = this.add.particles(x, y, 'fx-smoke', {
                lifespan: 3800,
                frequency: 480,
                quantity: 1,
                speedY: { min: -9, max: -6 },
                speedX: { min: 1.5, max: 4.5 },
                scale: { start: 0.06, end: 0.3 },
                alpha: { start: 0.34, end: 0 },
                rotate: { min: 0, max: 360 },
                maxAliveParticles: 9,
            });
            emitter.setDepth(DEPTH.SMOKE);
            this.smoke.push({ emitter, x, y });
        }
    }

    private createAmbient(): void {
        // 粒子を出す範囲は毎フレーム「いま見えている範囲」に合わせる（ambientZone を書き換える）
        const area = this.ambientZone;
        const zone = {
            type: 'random' as const,
            source: {
                getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => {
                    p.x = area.x + Math.random() * area.width;
                    p.y = area.y + Math.random() * area.height;
                },
            },
        };
        const max = this.quality.ambientParticles;
        const motes = this.add.particles(0, 0, 'fx-mote', {
            emitZone: zone,
            lifespan: { min: 4000, max: 6500 },
            frequency: 380,
            speedX: { min: 1, max: 4 },
            speedY: { min: -3, max: 1 },
            scale: { start: 0.06, end: 0.1 },
            alpha: { start: 0.45, end: 0 },
            blendMode: BlendModes.ADD,
            maxAliveParticles: max,
            emitting: false,
        });
        const leaves = this.add.particles(0, 0, 'fx-leaf', {
            emitZone: zone,
            lifespan: { min: 4500, max: 7000 },
            frequency: 520,
            speedX: { min: 5, max: 12 },
            speedY: { min: 3, max: 8 },
            rotate: { start: 0, end: 540 },
            scale: { min: 0.22, max: 0.32 },
            alpha: { start: 0.85, end: 0 },
            maxAliveParticles: Math.ceil(max * 0.6),
            emitting: false,
        });
        const fireflies = this.add.particles(0, 0, 'fx-mote', {
            emitZone: zone,
            lifespan: { min: 3000, max: 5500 },
            frequency: 300,
            speedX: { min: -5, max: 5 },
            speedY: { min: -5, max: 3 },
            scale: { start: 0.14, end: 0.08 },
            alpha: { start: 0.9, end: 0 },
            tint: 0xd8f59a,
            blendMode: BlendModes.ADD,
            maxAliveParticles: max,
            emitting: false,
        });
        for (const e of [motes, leaves, fireflies]) e.setDepth(DEPTH.SMOKE + 1);
        this.ambient = { motes, leaves, fireflies };
    }

    private createLighting(): void {
        this.tintLayer = this.add.image(0, 0, 'white').setOrigin(0).setBlendMode(BlendModes.MULTIPLY).setDepth(DEPTH.LIGHT);
        this.sunLayer = this.add.image(0, 0, 'fx-sun').setOrigin(0).setBlendMode(BlendModes.ADD).setDepth(DEPTH.LIGHT + 1);
        this.vignette = this.add.image(0, 0, 'fx-vignette').setOrigin(0).setDepth(DEPTH.LIGHT + 2);
    }

    private addGlow(x: number, y: number, size: number): void {
        const img = this.add.image(x, y, 'fx-glow').setBlendMode(BlendModes.ADD).setDepth(DEPTH.LIGHT + 3).setDisplaySize(size, size).setAlpha(0).setVisible(false);
        this.glows.push({ img, phase: hash(Math.round(x), Math.round(y)) * 10 });
    }

    /** 地面に落ちる柔らかい楕円の影 */
    private shadowBlob(x: number, y: number, w: number, h: number, alpha: number): Phaser.GameObjects.Image {
        return this.add.image(x, y, 'fx-shadow').setDisplaySize(w, h).setAlpha(alpha).setDepth(DEPTH.SHADOW);
    }

    /** 時間帯で濃さ・長さが変わる、伸びる影 */
    private castShadow(key: string, x: number, y: number, stretch = 1): Phaser.GameObjects.Image {
        const img = this.placeArt(key, x, y).setDepth(DEPTH.SHADOW);
        this.castShadows.push({ img, baseScaleX: img.scaleX, stretch });
        return img;
    }

    // ------------------------------------------------------------------
    // 毎フレーム
    // ------------------------------------------------------------------

    update(_time: number, delta: number): void {
        const dt = Math.min(delta / 1000, 0.1);
        this.elapsed += dt;
        this.frame++;
        this.source.tick(dt);
        const session = this.source.getSession();
        if (session !== this.bound) this.bind(session);

        if (session) {
            this.syncActor(this.hero, session.state.player, dt);
            this.syncActor(this.retainer, session.state.retainer, dt);
            const c = this.follow.update(this.hero.sprite.x, this.hero.sprite.y - 12, this.hero.velX, this.hero.velY, dt);
            this.cameras.main.centerOn(c.x, c.y);
            this.updateBubble(session);
        }

        this.updateLight(dt);
        this.cull();
        this.animate(dt);
        this.fadeOccluders(dt, session !== null);
        this.fitScreenLayers();

        const next = this.governor.sample(delta / 1000, this.viewport.renderScale);
        if (next !== null && next >= this.quality.minRenderScale) this.viewport.setRenderScale(next);
        this.updateFps(dt);
    }

    private bind(session: GameSession | null): void {
        this.bound = session;
        if (!session) {
            this.showIdleView();
            return;
        }
        for (const [view, a] of [[this.hero, session.state.player], [this.retainer, session.state.retainer]] as const) {
            view.heading.reset(a.facing);
            view.prevX = a.x;
            view.prevY = a.y;
            view.velX = view.velY = 0;
            this.setActorVisible(view, true);
            this.syncActor(view, a, 0);
        }
        this.follow.snap(this.hero.sprite.x, this.hero.sprite.y - 12);
        this.cameras.main.centerOn(this.follow.x, this.follow.y);
        this.lastCull.frame = -999;
    }

    /** タイトル表示中は城下町の十字路あたりを映す */
    private showIdleView(): void {
        this.setActorVisible(this.hero, false);
        this.setActorVisible(this.retainer, false);
        this.bubble.setVisible(false);
        const c = tileCenter(28, 24);
        this.follow.snap(c.x, c.y);
        this.cameras.main.centerOn(c.x, c.y);
        this.lastCull.frame = -999;
    }

    private setActorVisible(v: ActorView, on: boolean): void {
        v.sprite.setVisible(on);
        v.contact.setVisible(on);
        v.cast.setVisible(on);
    }

    private syncActor(v: ActorView, a: ActorState, dt: number): void {
        const dx = a.x - v.prevX;
        const dy = a.y - v.prevY;
        v.prevX = a.x;
        v.prevY = a.y;
        if (dt > 0) {
            // 速度はカメラの先読みに使うので少しならす
            const k = 1 - Math.exp(-12 * dt);
            v.velX += (dx / dt - v.velX) * k;
            v.velY += (dy / dt - v.velY) * k;
        }
        v.heading.update(dx, dy, dt, a.facing, a.moving);
        const walking = v.heading.moving && v.style === 'hero';
        v.sprite.setFrame(characterFrameName(v.heading.dir, walking ? v.heading.walkFrame(WALK_FRAMES) : null));

        const footY = a.y + ACTOR_HALF_H;
        v.sprite.setPosition(a.x, footY);
        v.sprite.setDepth(footY);
        // 待機中の呼吸（ごくわずかに縦に伸び縮み。足元を基準にしているので浮かない）
        v.sprite.scaleY = walking ? v.baseScale : v.baseScale * (1 + Math.sin(this.elapsed * 2.1 + (v.style === 'hero' ? 0 : 1.7)) * 0.012);
        v.contact.setPosition(a.x, footY - 0.5);
        v.cast.setPosition(a.x, footY - 1);
    }

    private updateBubble(session: GameSession): void {
        const near = session.state.dialogue ? null : session.nearbyInteractable();
        if (!near) {
            this.bubble.setVisible(false);
            return;
        }
        const top = near.target === 'retainer' ? near.center.y + ACTOR_HALF_H - CHARACTER.h * CHARACTER.oy - 4 : near.rect.y - 10;
        this.bubble.setVisible(true).setPosition(near.center.x, top + Math.sin(this.elapsed * 3) * 1.2);
    }

    /** 画面外の物は描かない・動かさない。カメラが少し動いたときだけ判定し直す。 */
    private cull(): void {
        const cam = this.cameras.main;
        const v = cam.worldView;
        const moved = Math.abs(v.x - this.lastCull.x) + Math.abs(v.y - this.lastCull.y);
        if (moved < 6 && cam.zoom === this.lastCull.zoom && this.frame - this.lastCull.frame < 30) return;
        this.lastCull = { x: v.x, y: v.y, zoom: cam.zoom, frame: this.frame };
        const m = 48; // 余白（揺れ・影のはみ出し）
        const L = v.x - m;
        const R = v.right + m;
        const Tp = v.y - m;
        const B = v.bottom + m;
        const vis = (s: Standing) => s.right > L && s.left < R && s.bottom > Tp && s.top < B;
        for (const s of this.standing) {
            const on = vis(s);
            if (s.obj.visible !== on) {
                s.obj.setVisible(on);
                for (const a of s.attached) a.setVisible(on);
            }
        }
        for (const s of this.tufts) s.obj.setVisible(vis(s));
        const lit = this.light.lanternAlpha > 0.01;
        for (const g of this.glows) g.img.setVisible(lit && g.img.x > L && g.img.x < R && g.img.y > Tp && g.img.y < B);
        for (const s of this.smoke) {
            const on = s.x > L - 40 && s.x < R + 40 && s.y > Tp - 60 && s.y < B + 40;
            if (s.emitter.emitting !== on) s.emitter.emitting = on;
        }
    }

    /** 環境の動き（見えている物だけ） */
    private animate(dt: number): void {
        const t = this.elapsed;
        for (const w of this.waterLayers) {
            w.ts.tilePositionX += w.vx * dt;
            w.ts.tilePositionY += w.vy * dt;
        }
        // 風：ゆっくり強弱がつく
        const gust = 0.75 + 0.25 * Math.sin(t * 0.37) + 0.15 * Math.sin(t * 1.13);
        for (const s of this.tufts) {
            if (s.obj.visible) s.obj.rotation = Math.sin(t * s.swaySpeed + s.phase) * s.sway * gust;
        }
        for (const s of this.standing) {
            if (s.sway !== 0 && s.obj.visible) s.obj.rotation = Math.sin(t * s.swaySpeed + s.phase) * s.sway * gust;
        }
        const la = this.light.lanternAlpha;
        if (la > 0.01) {
            for (const g of this.glows) {
                if (!g.img.visible) continue;
                const flicker = 0.88 + 0.08 * Math.sin(t * 7.3 + g.phase) + 0.04 * Math.sin(t * 13.1 + g.phase * 2);
                g.img.setAlpha(la * flicker);
            }
        }
        if (this.ambient) {
            // 漂う粒子は「いま見えている範囲」にだけ出す（粒子自体はワールドに留まる）
            const v = this.cameras.main.worldView;
            this.ambientZone.setTo(v.x - 20, v.y - 20, v.width + 40, v.height + 40);
        }
    }

    /** 主人公が建物や木の後ろに入ったら、その物を半透明にする */
    private fadeOccluders(dt: number, active: boolean): void {
        const k = 1 - Math.exp(-10 * dt);
        const h = this.hero.sprite;
        // 主人公の体（頭〜膝）の範囲
        const hl = h.x - 7;
        const hr = h.x + 7;
        const ht = h.y - 30;
        const hb = h.y - 4;
        for (const s of this.standing) {
            if (!s.occluder) continue;
            if (!s.obj.visible) {
                if (s.obj.alpha !== 1) s.obj.setAlpha(1);
                continue;
            }
            const behind = active && h.y < s.baseY && hr > s.left && hl < s.right && hb > s.top && ht < s.bottom;
            const target = behind ? s.fadeTo : 1;
            const a = s.obj.alpha;
            if (Math.abs(a - target) > 0.004) s.obj.setAlpha(a + (target - a) * k);
            else if (a !== target) s.obj.setAlpha(target);
        }
    }

    private updateLight(dt: number): void {
        const want = this.source.getTimeOfDay();
        if (want !== this.tod) {
            this.lightFrom = this.light;
            this.tod = want;
            this.lightT = 0;
        }
        if (this.lightT < 1) {
            this.lightT = Math.min(1, this.lightT + dt / 0.9);
            const e = this.lightT * this.lightT * (3 - 2 * this.lightT);
            this.light = lerpPreset(this.lightFrom, PRESETS[this.tod], e);
            this.applyLight(this.light);
            this.lastCull.frame = -999;
        }
    }

    private applyLight(p: LightPreset): void {
        this.tintLayer.setTint(effectiveTint(p));
        this.sunLayer.setTint(p.sunColor).setAlpha(p.sunAlpha);
        this.vignette.setAlpha(p.vignetteAlpha);
        for (const c of this.castShadows) {
            c.img.setAlpha(p.castAlpha / 0.3);
            c.img.scaleX = c.baseScaleX * (1 + (p.castLength - 1) * c.stretch);
        }
        for (const v of [this.hero, this.retainer]) v.contact.setAlpha(p.contactAlpha);
        for (const w of this.waterLayers) w.ts.setAlpha(p.waterAlpha * w.weight);
        if (p.lanternAlpha <= 0.01) for (const g of this.glows) g.img.setAlpha(0);
        if (this.ambient) {
            for (const [kind, e] of Object.entries(this.ambient)) e.emitting = kind === p.ambient;
        }
    }

    /** 画面全体にかぶせる層を、いま見えている範囲に合わせる */
    private fitScreenLayers(): void {
        const v = this.cameras.main.worldView;
        for (const layer of [this.tintLayer, this.sunLayer, this.vignette]) {
            layer.setPosition(v.x - 2, v.y - 2).setDisplaySize(v.width + 4, v.height + 4);
        }
    }

    /** 画面の大きさに合わせた拡大率。縦に約 12.5 タイル見える程度（スマホ横向きで 2 倍前後）。 */
    private applyZoom(): void {
        const w = this.viewport.cssWidth;
        const h = this.viewport.cssHeight;
        const cssZoom = Math.max(1.5, Math.min(3.2, Math.min(h / (T * 12.5), w / (T * 20))));
        this.cameras.main.setZoom(cssZoom * this.viewport.renderScale);
        this.cameras.main.centerOn(this.follow.x, this.follow.y);
        this.lastCull.frame = -999;
    }

    private updateFps(dt: number): void {
        if (!this.fpsEl) return;
        this.fpsTimer += dt;
        if (this.fpsTimer < 0.5) return;
        this.fpsTimer = 0;
        const visible = this.standing.filter((s) => s.obj.visible).length + this.tufts.filter((s) => s.obj.visible).length;
        const mb = (this.stats.textureBytes / 1048576).toFixed(1);
        this.fpsEl.textContent = `${Math.round(this.game.loop.actualFps)} fps ・解像度 ×${this.viewport.renderScale} ・${this.quality.tier} ・表示物 ${visible} ・素材 ${mb}MB / 生成 ${this.stats.artMs}ms`;
    }
}

function hash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}
