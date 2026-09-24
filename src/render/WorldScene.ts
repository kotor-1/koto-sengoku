/**
 * 探索画面の描画。ゲームの状態（GameSession）を読んで絵を合わせるだけで、
 * 状態を書き換えるのは source.tick() の中（core 側）だけにしている。
 */
import { Scene } from 'phaser';
import { TILE_SIZE } from '../core/constants';
import { GATE_RECT, KEEP_RECT, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, mapIndexGrid, tileCenter } from '../core/map';
import type { GameSession } from '../core/session';
import type { ActorState } from '../core/state';
import {
    CHAR_FACINGS, CHAR_H, CHAR_W, GATE_KEY, HERO_KEY, KEEP_KEY, RETAINER_KEY, SHADOW_KEY, TILESET_KEY,
    TILE_MARGIN, TILE_SPACING, charFrameName, drawCharacterSheet, drawGateRoof, drawKeep, drawShadow,
    drawTileset, tilesetSize,
} from './textures';

/** 描画側が必要とするものだけを受け取る */
export interface WorldSource {
    getSession(): GameSession | null;
    /** 1 フレーム分ゲームを進める（入力の読み取りと状態更新） */
    tick(dtSec: number): void;
}

interface ActorView {
    sprite: Phaser.GameObjects.Sprite;
    shadow: Phaser.GameObjects.Image;
}

/** 人物の足元から絵の下端までのずれ */
const FOOT_OFFSET = 4;
/** 城門の屋根は人物より手前 */
const DEPTH_OVERHEAD = 100000;

export class WorldScene extends Scene {
    private hero!: ActorView;
    private retainer!: ActorView;
    private bound: GameSession | null = null;

    constructor(private readonly source: WorldSource) {
        super('World');
    }

    create(): void {
        this.createTextures();

        const map = this.make.tilemap({ data: mapIndexGrid(), tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
        const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, TILE_MARGIN, TILE_SPACING);
        if (!tileset) throw new Error('タイルセットを作れませんでした');
        map.createLayer(0, tileset, 0, 0)?.setDepth(0);

        this.add.image(KEEP_RECT.tx * TILE_SIZE, KEEP_RECT.ty * TILE_SIZE, KEEP_KEY).setOrigin(0, 0).setDepth(1);
        this.add
            .image((GATE_RECT.tx - 1) * TILE_SIZE, GATE_RECT.ty * TILE_SIZE - 12, GATE_KEY)
            .setOrigin(0, 0)
            .setDepth(DEPTH_OVERHEAD);

        this.hero = this.createActorView(HERO_KEY);
        this.retainer = this.createActorView(RETAINER_KEY);

        const cam = this.cameras.main;
        cam.setBounds(0, 0, MAP_PIXEL_WIDTH, MAP_PIXEL_HEIGHT);
        cam.setRoundPixels(true);
        cam.setBackgroundColor('#1b1f16');
        this.applyZoom();
        this.scale.on('resize', this.applyZoom, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.applyZoom, this));
        this.showIdleView();
    }

    update(_time: number, delta: number): void {
        this.source.tick(delta / 1000);
        const session = this.source.getSession();
        if (session !== this.bound) this.bind(session);
        if (!session) return;
        this.syncActor(this.hero, session.state.player);
        this.syncActor(this.retainer, session.state.retainer);
    }

    private bind(session: GameSession | null): void {
        this.bound = session;
        const cam = this.cameras.main;
        if (!session) {
            this.showIdleView();
            return;
        }
        this.setActorsVisible(true);
        this.syncActor(this.hero, session.state.player);
        this.syncActor(this.retainer, session.state.retainer);
        // 読み込み直後にカメラが滑ってこないよう、先に中心を合わせてから追従させる
        cam.centerOn(this.hero.sprite.x, this.hero.sprite.y);
        cam.startFollow(this.hero.sprite, true, 0.2, 0.2);
    }

    /** タイトル表示中は城門あたりを映す */
    private showIdleView(): void {
        this.setActorsVisible(false);
        const cam = this.cameras.main;
        cam.stopFollow();
        const c = tileCenter(GATE_RECT.tx + 2, GATE_RECT.ty - 2);
        cam.centerOn(c.x, c.y);
    }

    private setActorsVisible(v: boolean): void {
        for (const a of [this.hero, this.retainer]) {
            a.sprite.setVisible(v);
            a.shadow.setVisible(v);
        }
    }

    private createActorView(key: string): ActorView {
        const shadow = this.add.image(0, 0, SHADOW_KEY).setOrigin(0.5, 0.5);
        const sprite = this.add.sprite(0, 0, key, charFrameName('down', 0)).setOrigin(0.5, 1);
        return { sprite, shadow };
    }

    private syncActor(view: ActorView, a: ActorState): void {
        const step = a.moving && Math.floor(a.walkTime * 8) % 2 === 1 ? 1 : 0;
        view.sprite.setFrame(charFrameName(a.facing, step));
        view.sprite.setPosition(a.x, a.y + FOOT_OFFSET);
        view.sprite.setDepth(10 + a.y);
        view.shadow.setPosition(a.x, a.y + FOOT_OFFSET - 1);
        view.shadow.setDepth(9 + a.y);
    }

    /** 画面の大きさに合わせて拡大率を決める（縦に約 13 タイル見える程度） */
    private applyZoom(): void {
        const { width, height } = this.scale.gameSize;
        const raw = Math.min(height / (TILE_SIZE * 13), width / (TILE_SIZE * 18));
        let zoom = raw >= 3 ? Math.floor(raw) : Math.round(raw * 2) / 2;
        zoom = Math.max(1, Math.min(zoom, 5));
        this.cameras.main.setZoom(zoom);
    }

    private createTextures(): void {
        if (this.textures.exists(TILESET_KEY)) return;
        const ts = tilesetSize();
        this.makeCanvas(TILESET_KEY, ts.width, ts.height, drawTileset);
        for (const [key, style] of [[HERO_KEY, 'hero'], [RETAINER_KEY, 'retainer']] as const) {
            const tex = this.makeCanvas(key, CHAR_W * 8, CHAR_H, (ctx) => drawCharacterSheet(ctx, style));
            CHAR_FACINGS.forEach((facing, fi) => {
                for (const step of [0, 1] as const) {
                    tex.add(charFrameName(facing, step), 0, (fi * 2 + step) * CHAR_W, 0, CHAR_W, CHAR_H);
                }
            });
        }
        this.makeCanvas(KEEP_KEY, 192, 80, drawKeep);
        this.makeCanvas(GATE_KEY, 96, 24, drawGateRoof);
        this.makeCanvas(SHADOW_KEY, 12, 5, drawShadow);
    }

    private makeCanvas(
        key: string,
        w: number,
        h: number,
        draw: (ctx: CanvasRenderingContext2D) => unknown,
    ): Phaser.Textures.CanvasTexture {
        const tex = this.textures.createCanvas(key, w, h);
        if (!tex) throw new Error(`テクスチャ ${key} を作れませんでした`);
        draw(tex.context);
        tex.refresh();
        return tex;
    }
}
