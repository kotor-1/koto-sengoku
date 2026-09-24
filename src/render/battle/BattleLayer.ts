/**
 * 模擬戦の表示（Phaser）。BattleSession の状態を読んで絵を合わせるだけで、状態は書き換えない。
 *
 * - 人物は既存の素材を使い回す：若殿（主人公の絵）・源蔵（家臣の絵）・新八（家臣の絵を青みに）・
 *   訓練相手（主人公の絵を灰青に）。家臣の絵には歩きのコマがないので、歩くときは小さく上下させる。
 * - 倒れた姿は、立ち絵を 90° 回した絵を起動時に作っておく（表示時に回転しない）。
 * - 体力の棒・命令の印（移動先・攻撃目標・選択中の家臣）は光のかぶせより上に描き、夜でも読めるようにする。
 * - 指揮中（時間停止）は人物の動き・効果も止め、画面を少し暗くする。
 */
import { TintModes } from 'phaser';
import { ACTOR_HALF_H } from '../../core/constants';
import { ARENA, RETAINER_IDS, STATS, createBattle, type RetainerId, type Unit } from '../../core/battle/model';
import type { BattleSession } from '../../core/battle/session';
import { characterFrameName, type CharacterStyle } from '../art/character';
import { CHARACTER, WALK_FRAMES } from '../art/spec';
import { dirFromVector, type HeadingTracker } from '../world/heading';
import { SLASH_WORLD, slashFrame } from './battleArt';

/** 描画側に渡す、模擬戦の画面の状態 */
export interface BattleView {
    session: BattleSession;
    /** 指揮中（戦闘の時間が止まっている） */
    commanding: boolean;
    /** 指揮で選んでいる家臣 */
    selected: RetainerId | null;
    /** 地図で選ぶ待ち（移動先・攻撃目標） */
    pick: 'move' | 'attack' | null;
}

/** WorldScene の人物表示と同じ形（sprite・足元の影・伸びる影・向き） */
export interface ActorParts {
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

export interface BattleLayerDeps {
    scene: Phaser.Scene;
    makeActor(style: CharacterStyle): ActorParts;
    /** 光のかぶせより上（UI 扱い）の奥行き */
    overlayDepth: number;
    /** 光のかぶせのすぐ上（指揮中の暗さ） */
    dimDepth: number;
}

/** 家臣ごとの色（命令の印・指揮画面の札で同じ色を使う） */
export const RETAINER_COLORS: Record<RetainerId, number> = { genzo: 0xe9c274, shinpachi: 0x7fd3dc };
const ENEMY_COLOR = 0xec6f5c;
const HERO_COLOR = 0xf3dc9c;
const ALLY_HP = 0x9fd38f;

interface Look {
    style: CharacterStyle;
    tint: number;
}

function lookOf(u: Unit): Look {
    if (u.kind === 'hero') return { style: 'hero', tint: 0xffffff };
    if (u.id === 'genzo') return { style: 'retainer', tint: 0xffffff };
    if (u.id === 'shinpachi') return { style: 'retainer', tint: 0xa9c6ee };
    return { style: 'hero', tint: 0x9aaac6 };
}

interface UnitView {
    id: string;
    actor: ActorParts;
    look: Look;
    down: Phaser.GameObjects.Image;
    seenHits: number;
    flash: number;
    prevSwing: number;
    pendingSlash: boolean;
    slashDir: number;
    lunge: number;
    lungeX: number;
    lungeY: number;
    /** 家臣の絵の「歩き」：歩いた距離で上下させる */
    stepPhase: number;
    wasDown: boolean;
}

interface Slash {
    img: Phaser.GameObjects.Image;
    t: number;
}

interface Popup {
    text: Phaser.GameObjects.Text;
    t: number;
}

const SLASH_TIME = 0.2;
const POPUP_TIME = 0.8;

export class BattleLayer {
    private readonly units = new Map<string, UnitView>();
    private readonly slashes: Slash[] = [];
    private readonly popups: Popup[] = [];
    private readonly labels = new Map<string, Phaser.GameObjects.Text>();
    private readonly overlay: Phaser.GameObjects.Graphics;
    private readonly dim: Phaser.GameObjects.Image;
    private bound: BattleSession | null = null;
    private visible = false;
    private clock = 0;
    private slashScale = 1;

    constructor(private readonly d: BattleLayerDeps) {
        const s = d.scene;
        this.makeDownTextures();
        const slashTex = s.textures.get('fx-slash');
        this.slashScale = SLASH_WORLD / slashTex.get(slashFrame(0)).width;
        this.overlay = s.add.graphics().setDepth(d.overlayDepth).setVisible(false);
        this.dim = s.add.image(0, 0, 'white').setOrigin(0).setTint(0x0e1522).setAlpha(0).setDepth(d.dimDepth).setVisible(false);
        // 人物は最初に全員ぶん作っておく（影の濃さ・長さが時間帯の設定にそろうように）
        for (const u of createBattle().units) this.viewFor(u);
        this.hideAll();
    }

    private viewFor(u: Unit): UnitView {
        const look = lookOf(u);
        let v = this.units.get(u.id);
        if (v && v.look.style === look.style) return v;
        const actor = this.d.makeActor(look.style);
        const down = this.d.scene.add.image(0, 0, `${look.style}-down`).setOrigin(0.5, 0.62).setVisible(false).setScale(actor.baseScale);
        v = {
            id: u.id, actor, look, down,
            seenHits: 0, flash: 0, prevSwing: 0, pendingSlash: false, slashDir: 0,
            lunge: 0, lungeX: 0, lungeY: 0, stepPhase: 0, wasDown: false,
        };
        this.units.set(u.id, v);
        return v;
    }

    /** 模擬戦で動く人物（光の設定で足元の影の濃さを合わせるため） */
    actors(): ActorParts[] {
        return [...this.units.values()].map((v) => v.actor);
    }

    get active(): boolean {
        return this.visible;
    }

    /** 味方の体の範囲（建物・木の半透明化に使う） */
    allyBodies(): { x: number; y: number }[] {
        const out: { x: number; y: number }[] = [];
        const s = this.bound;
        if (!s) return out;
        for (const u of s.state.units) if (u.side === 'ally' && !u.down) out.push({ x: u.x, y: u.y + ACTOR_HALF_H });
        return out;
    }

    /** 毎フレーム：view が null なら何も出さない */
    sync(view: BattleView | null, dt: number, worldView: Phaser.Geom.Rectangle): void {
        if (!view) {
            if (this.visible) this.hideAll();
            return;
        }
        if (view.session !== this.bound) this.bind(view.session);
        this.visible = true;
        this.clock += dt;
        // 指揮中は時間が止まっているので、人物の動きや効果も止める（印の点滅だけは動かす）
        const animDt = view.commanding ? 0 : dt;
        for (const u of view.session.state.units) this.syncUnit(u, view.session, animDt);
        this.updateSlashes(animDt);
        this.updatePopups(animDt);
        this.drawOverlay(view);
        const dimTarget = view.commanding ? 0.24 : 0;
        const a = this.dim.alpha + (dimTarget - this.dim.alpha) * (1 - Math.exp(-14 * dt));
        this.dim.setVisible(a > 0.005).setAlpha(a).setPosition(worldView.x - 2, worldView.y - 2).setDisplaySize(worldView.width + 4, worldView.height + 4);
    }

    // ------------------------------------------------------------------

    private bind(session: BattleSession): void {
        this.bound = session;
        for (const u of session.state.units) {
            const v = this.viewFor(u);
            const look = lookOf(u);
            v.look = look;
            v.seenHits = u.hitCount;
            v.flash = 0;
            v.prevSwing = u.swing;
            v.pendingSlash = false;
            v.lunge = 0;
            v.wasDown = u.down;
            v.actor.heading.reset(u.facing);
            v.actor.prevX = u.x;
            v.actor.prevY = u.y;
            v.actor.velX = v.actor.velY = 0;
            v.actor.sprite.setTint(look.tint).setTintMode(TintModes.MULTIPLY);
            v.down.setTint(look.tint);
        }
        for (const sl of this.slashes) sl.img.destroy();
        this.slashes.length = 0;
        for (const p of this.popups) p.text.setVisible(false);
    }

    private hideAll(): void {
        this.visible = false;
        this.bound = null;
        for (const v of this.units.values()) {
            v.actor.sprite.setVisible(false);
            v.actor.contact.setVisible(false);
            v.actor.cast.setVisible(false);
            v.down.setVisible(false);
        }
        for (const sl of this.slashes) sl.img.destroy();
        this.slashes.length = 0;
        for (const p of this.popups) p.text.setVisible(false);
        for (const l of this.labels.values()) l.setVisible(false);
        this.overlay.clear().setVisible(false);
        this.dim.setVisible(false).setAlpha(0);
    }

    private syncUnit(u: Unit, session: BattleSession, dt: number): void {
        const v = this.units.get(u.id);
        if (!v) return;
        const a = v.actor;
        const footY = u.y + ACTOR_HALF_H;

        // 攻撃を受けた：白く光らせ、減った量を出す
        if (u.hitCount > v.seenHits) {
            v.seenHits = u.hitCount;
            v.flash = 0.13;
            this.popup(u.x, footY - CHARACTER.h * CHARACTER.oy - 2, `-${u.lastDamage}`, u.side === 'enemy' ? '#ffe3a8' : '#ffb4a4');
        }
        if (u.down) {
            if (!v.wasDown) this.popup(u.x, footY - 22, '戦闘不能', '#d8d2c4');
            v.wasDown = true;
            a.sprite.setVisible(false);
            a.cast.setVisible(false);
            a.contact.setVisible(true).setPosition(u.x, footY - 1).setDisplaySize(26, 7);
            v.down.setVisible(true).setPosition(u.x, footY - 3).setDepth(footY - 6);
            v.down.setAlpha(0.92);
            return;
        }
        v.wasDown = false;
        v.down.setVisible(false);
        a.sprite.setVisible(true);
        a.contact.setVisible(true).setDisplaySize(16, 6);
        a.cast.setVisible(true);

        // 攻撃の動き：振り始めを見つけ、振りかぶりが終わった瞬間に弧を出して半歩踏み込む
        if (u.swing > v.prevSwing + 1e-6) {
            v.pendingSlash = true;
            const t = u.windupTargetId ? session.unit(u.windupTargetId) : undefined;
            v.slashDir = t ? dirFromVector(t.x - u.x, t.y - u.y) : u.kind === 'hero' ? dirFromVector(u.aimX, u.aimY) : a.heading.dir;
        }
        v.prevSwing = u.swing;
        if (v.pendingSlash && u.windup <= 0) {
            v.pendingSlash = false;
            // 振りかぶりを命令で取りやめたとき（swing が 0 に戻る）は弧を出さない
            if (u.swing > 0) this.spawnSlash(u, v, footY);
        }

        // 向きと歩き
        const dx = u.x - a.prevX;
        const dy = u.y - a.prevY;
        a.prevX = u.x;
        a.prevY = u.y;
        if (dt > 0) {
            const k = 1 - Math.exp(-12 * dt);
            a.velX += (dx / dt - a.velX) * k;
            a.velY += (dy / dt - a.velY) * k;
            a.heading.update(dx, dy, dt, u.facing, u.moving);
        }
        if (v.lunge > 0) a.heading.dir = v.slashDir;
        const walking = a.heading.moving;
        let lift = 0;
        if (a.style === 'hero') {
            a.sprite.setFrame(characterFrameName(a.heading.dir, walking ? a.heading.walkFrame(WALK_FRAMES) : null));
        } else {
            a.sprite.setFrame(characterFrameName(a.heading.dir, null));
            // 家臣の絵には歩きのコマがないので、歩いた距離に合わせて小さく弾ませる
            if (walking) v.stepPhase += Math.hypot(dx, dy) / 13 * Math.PI;
            lift = walking ? Math.abs(Math.sin(v.stepPhase)) * 1.3 : 0;
        }

        // 踏み込み
        v.lunge = Math.max(0, v.lunge - dt);
        const lk = v.lunge > 0 ? Math.sin((v.lunge / 0.14) * Math.PI) * 2.2 : 0;
        const x = u.x + v.lungeX * lk;
        const y = footY + v.lungeY * lk * 0.6;
        a.sprite.setPosition(x, y - lift).setDepth(footY);
        a.sprite.scaleY = a.baseScale * (walking ? 1 : 1 + Math.sin(this.clock * 2.1 + x * 0.1) * 0.012);
        a.contact.setPosition(x, footY - 0.5);
        a.cast.setPosition(x, footY - 1);

        // 攻撃を受けた光
        v.flash = Math.max(0, v.flash - dt);
        if (v.flash > 0) a.sprite.setTintMode(TintModes.ADD).setTint(0x6a625a);
        else if (a.sprite.tintMode !== TintModes.MULTIPLY) a.sprite.setTintMode(TintModes.MULTIPLY).setTint(v.look.tint);
    }

    private spawnSlash(u: Unit, v: UnitView, footY: number): void {
        const ang = Math.PI / 2 - v.slashDir * (Math.PI / 4);
        const vx = Math.cos(ang);
        const vy = Math.sin(ang);
        v.lunge = 0.14;
        v.lungeX = vx;
        v.lungeY = vy;
        const img = this.d.scene.add
            .image(u.x + vx * 9, footY - 13 + vy * 5, 'fx-slash', slashFrame(v.slashDir))
            .setScale(this.slashScale * 0.8)
            .setDepth(footY + (vy > 0 ? 2 : -2))
            .setAlpha(u.side === 'enemy' ? 0.75 : 0.95);
        if (u.side === 'enemy') img.setTint(0xffc9b8);
        this.slashes.push({ img, t: 0 });
    }

    private updateSlashes(dt: number): void {
        for (let i = this.slashes.length - 1; i >= 0; i--) {
            const s = this.slashes[i];
            s.t += dt;
            const k = s.t / SLASH_TIME;
            if (k >= 1) {
                s.img.destroy();
                this.slashes.splice(i, 1);
                continue;
            }
            s.img.setScale(this.slashScale * (0.8 + 0.35 * k));
            s.img.setAlpha((1 - k * k) * 0.95);
        }
    }

    private popup(x: number, y: number, text: string, color: string): void {
        let p = this.popups.find((q) => !q.text.visible);
        if (!p) {
            if (this.popups.length >= 12) p = this.popups.reduce((a, b) => (a.t > b.t ? a : b));
            else {
                const t = this.d.scene.add
                    .text(0, 0, '', {
                        fontFamily: '"Hiragino Sans", "Noto Sans JP", sans-serif',
                        fontSize: '8px',
                        fontStyle: 'bold',
                        color: '#ffffff',
                        stroke: '#2a1c16',
                        strokeThickness: 2.4,
                    })
                    .setOrigin(0.5, 1)
                    .setResolution(6)
                    .setDepth(this.d.overlayDepth + 2);
                p = { text: t, t: 0 };
                this.popups.push(p);
            }
        }
        p.t = 0;
        p.text.setText(text).setColor(color).setPosition(x + ((this.popups.indexOf(p) % 3) - 1) * 3, y).setAlpha(1).setVisible(true);
    }

    private updatePopups(dt: number): void {
        for (const p of this.popups) {
            if (!p.text.visible) continue;
            p.t += dt;
            if (p.t >= POPUP_TIME) {
                p.text.setVisible(false);
                continue;
            }
            p.text.y -= 16 * dt * (1 - p.t / POPUP_TIME);
            p.text.setAlpha(p.t < POPUP_TIME * 0.6 ? 1 : 1 - (p.t - POPUP_TIME * 0.6) / (POPUP_TIME * 0.4));
        }
    }

    // ------------------------------------------------------------------
    // 体力・命令の印
    // ------------------------------------------------------------------

    private drawOverlay(view: BattleView): void {
        const g = this.overlay.clear().setVisible(true);
        const s = view.session;
        const cmd = view.commanding;
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 5);

        // 移動先を選ぶとき：行ける範囲（訓練場）を示す
        if (cmd && view.pick === 'move') {
            g.lineStyle(1, 0xf3e6c4, 0.35 + 0.25 * pulse);
            dashedRect(g, ARENA.x0 + 6, ARENA.y0 + 6, ARENA.x1 - ARENA.x0 - 12, ARENA.y1 - ARENA.y0 - 12, 4, 3);
        }

        // 家臣の命令（指揮中ははっきり、戦闘中は薄く）
        for (const id of RETAINER_IDS) {
            const r = s.unit(id);
            if (!r || r.down || !r.order) continue;
            const c = RETAINER_COLORS[id];
            const sel = cmd && view.selected === id;
            const alpha = cmd ? (sel ? 1 : 0.7) : 0.38;
            const o = r.order;
            if (o.kind === 'move' || o.kind === 'hold') {
                const far = Math.hypot(o.x - r.x, o.y - r.y) > 6;
                if (far) {
                    g.lineStyle(sel ? 1.4 : 1, c, alpha);
                    dashedLine(g, r.x, r.y + ACTOR_HALF_H - 1, o.x, o.y + ACTOR_HALF_H - 1, 3, 2.5);
                }
                if (far || cmd) this.drawPoint(g, o.x, o.y + ACTOR_HALF_H - 1, c, alpha, o.kind === 'move', sel ? pulse : 0);
            } else if (o.kind === 'attack') {
                const t = s.unit(o.targetId);
                if (t && !t.down) {
                    g.lineStyle(sel ? 1.4 : 1, c, alpha);
                    dashedLine(g, r.x, r.y - 10, t.x, t.y - 10, 3, 2.5);
                    this.drawTargetMark(g, t.x, t.y + ACTOR_HALF_H - 1, c, alpha, sel ? pulse : 0);
                }
            }
        }

        // 攻撃目標を選ぶとき：選べる相手に赤い輪
        if (cmd && view.pick === 'attack') {
            for (const e of s.activeEnemies()) {
                g.lineStyle(1.3, ENEMY_COLOR, 0.55 + 0.4 * pulse);
                g.strokeEllipse(e.x, e.y + ACTOR_HALF_H - 1, 18 + pulse * 3, 8 + pulse * 1.4);
            }
        }

        // 選んでいる家臣：足元の輪
        if (cmd && view.selected) {
            const r = s.unit(view.selected);
            if (r && !r.down) {
                const c = RETAINER_COLORS[view.selected];
                g.lineStyle(1.6, c, 0.95);
                g.strokeEllipse(r.x, r.y + ACTOR_HALF_H - 1, 19 + pulse * 2, 8.5 + pulse);
                g.fillStyle(c, 0.16);
                g.fillEllipse(r.x, r.y + ACTOR_HALF_H - 1, 19, 8.5);
            }
        }

        // 若殿の足元の印（同じ装いの訓練相手と見分けやすく）
        const h = s.hero;
        if (!h.down) {
            g.lineStyle(1, HERO_COLOR, 0.55);
            g.strokeEllipse(h.x, h.y + ACTOR_HALF_H - 1, 15, 6);
        }

        // 体力の棒
        for (const u of s.state.units) {
            if (u.down) continue;
            const w = 16;
            const x = u.x - w / 2;
            const y = u.y + ACTOR_HALF_H - CHARACTER.h * CHARACTER.oy - 4;
            const k = Math.max(0, Math.min(1, u.hp / STATS[u.kind].maxHp));
            const col = u.side === 'enemy' ? ENEMY_COLOR : u.kind === 'hero' ? HERO_COLOR : ALLY_HP;
            g.fillStyle(0x16120e, 0.72);
            g.fillRoundedRect(x - 0.8, y - 0.8, w + 1.6, 3.6, 1.4);
            g.fillStyle(col, 1);
            if (k > 0) g.fillRoundedRect(x, y, Math.max(1, w * k), 2, 0.8);
        }

        // 指揮中：家臣の名前
        for (const id of RETAINER_IDS) {
            const r = s.unit(id);
            const label = this.label(id);
            if (!cmd || !r) {
                label.setVisible(false);
                continue;
            }
            const y = r.down ? r.y - 6 : r.y + ACTOR_HALF_H - CHARACTER.h * CHARACTER.oy - 6;
            label
                .setVisible(true)
                .setText(r.down ? `${r.name}（戦闘不能）` : r.name)
                .setColor(r.down ? '#bdb6a8' : `#${RETAINER_COLORS[id].toString(16).padStart(6, '0')}`)
                .setPosition(r.x, y);
        }
    }

    private drawPoint(g: Phaser.GameObjects.Graphics, x: number, y: number, c: number, alpha: number, flag: boolean, pulse: number): void {
        g.lineStyle(1.3, c, alpha);
        if (flag) {
            // 移動先：輪と中心の点
            g.strokeEllipse(x, y, 13 + pulse * 2, 6 + pulse);
            g.fillStyle(c, alpha);
            g.fillCircle(x, y, 1.6);
            // 小さな旗
            g.lineBetween(x, y, x, y - 11);
            g.fillTriangle(x, y - 11, x + 6, y - 9, x, y - 7);
        } else {
            // 待機の場所：四角
            g.strokeRect(x - 4.5, y - 2.5, 9, 5);
        }
    }

    private drawTargetMark(g: Phaser.GameObjects.Graphics, x: number, y: number, c: number, alpha: number, pulse: number): void {
        g.lineStyle(1.5, ENEMY_COLOR, alpha);
        g.strokeEllipse(x, y, 20 + pulse * 2, 9 + pulse);
        g.lineStyle(1.1, c, alpha);
        g.strokeEllipse(x, y, 14, 6);
        // 照準の刻み
        g.lineStyle(1.2, ENEMY_COLOR, alpha);
        for (const [dx, dy] of [[-1, 0], [1, 0]] as const) g.lineBetween(x + dx * 12, y + dy, x + dx * 15.5, y + dy);
    }

    private label(id: string): Phaser.GameObjects.Text {
        let t = this.labels.get(id);
        if (!t) {
            t = this.d.scene.add
                .text(0, 0, '', {
                    fontFamily: '"Hiragino Sans", "Noto Sans JP", sans-serif',
                    fontSize: '7px',
                    fontStyle: 'bold',
                    color: '#ffffff',
                    stroke: '#1a1410',
                    strokeThickness: 2.2,
                })
                .setOrigin(0.5, 1)
                .setResolution(6)
                .setDepth(this.d.overlayDepth + 1);
            this.labels.set(id, t);
        }
        return t;
    }

    /** 倒れた姿：右向きの立ち絵を 90° 回し、仰向けに寝た形にする */
    private makeDownTextures(): void {
        const s = this.d.scene;
        for (const style of ['hero', 'retainer'] as const) {
            const key = `${style}-down`;
            if (s.textures.exists(key)) continue;
            const src = s.textures.get(style);
            const f = src.get(characterFrameName(2, null));
            const img = src.getSourceImage() as HTMLCanvasElement;
            const tex = s.textures.createCanvas(key, f.height, f.width)!;
            const ctx = tex.context;
            ctx.translate(f.height / 2, f.width / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, f.cutX, f.cutY, f.width, f.height, -f.width / 2, -f.height / 2, f.width, f.height);
            // 少し暗く（気を失っている）
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = 'rgba(40, 34, 30, 0.28)';
            ctx.fillRect(-f.width, -f.height, f.width * 2, f.height * 2);
            tex.refresh();
        }
    }
}

function dashedLine(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, dash: number, gap: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) return;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let t = 0; t < len; t += dash + gap) {
        const e = Math.min(len, t + dash);
        g.lineBetween(x0 + ux * t, y0 + uy * t, x0 + ux * e, y0 + uy * e);
    }
}

function dashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number): void {
    dashedLine(g, x, y, x + w, y, dash, gap);
    dashedLine(g, x + w, y, x + w, y + h, dash, gap);
    dashedLine(g, x + w, y + h, x, y + h, dash, gap);
    dashedLine(g, x, y + h, x, y, dash, gap);
}
