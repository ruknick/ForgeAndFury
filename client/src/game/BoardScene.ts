import Phaser from 'phaser';
import { idx } from '../../../shared/board';
import { tileTypeDef } from '../../../shared/config/tiles';
import type { ActionResult } from '../../../shared/game';
import { sweepAngle } from '../../../shared/relicEffects';
import { RARITY_INFO, relicDef } from '../../../shared/relics';
import { sfx } from '../audio';
import type { BoardState, Burial, BurialHit, ClearedTile, Fx, Pos, Step, Tile } from '../../../shared/types';

export const CELL = 80;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

export interface BoardHooks {
  onSwap(a: Pos, b: Pos): void;
  onTap(pos: Pos): void;
  isTargeting(): boolean;
  canInteract(): boolean;
  onReady(scene: BoardScene): void;
}

type Img = Phaser.GameObjects.Image;

const cx = (c: number) => c * CELL + CELL / 2;
const cy = (r: number) => r * CELL + CELL / 2;
const shade = (color: number, f: number) => {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const k = (v: number) => Phaser.Math.Clamp(Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)), 0, 255);
  return Phaser.Display.Color.GetColor(k(c.red), k(c.green), k(c.blue));
};

export class BoardScene extends Phaser.Scene {
  private board!: BoardState;
  private hooks!: BoardHooks;
  private sprites = new Map<number, Img>();
  private burialViews = new Map<string, Phaser.GameObjects.Container>();
  private wallViews = new Map<number, Phaser.GameObjects.Container>();
  private tileLayer!: Phaser.GameObjects.Container;
  private overlayLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private selectGfx!: Phaser.GameObjects.Graphics;
  private previewGfx!: Phaser.GameObjects.Graphics;
  private selected: Pos | null = null;
  private down: { pos: Pos; x: number; y: number } | null = null;
  private hintTimer?: Phaser.Time.TimerEvent;
  private hintTween?: Phaser.Tweens.Tween;

  constructor() {
    super('board');
  }

  init(data: { board: BoardState; hooks: BoardHooks }) {
    this.board = data.board;
    this.hooks = data.hooks;
    this.sprites = new Map();
    this.burialViews = new Map();
    this.wallViews = new Map();
    this.selected = null;
    this.down = null;
  }

  create() {
    const b = this.board;
    const bg = this.add.graphics();
    bg.fillStyle(0x140e09, 1).fillRect(0, 0, b.cols * CELL, b.rows * CELL);
    for (let r = 0; r < b.rows; r++)
      for (let c = 0; c < b.cols; c++) {
        if (b.blocked[idx(b, r, c)] && !b.walls[idx(b, r, c)]) {
          bg.fillStyle(0x0b0805, 1).fillRect(c * CELL, r * CELL, CELL, CELL);
          bg.lineStyle(2, 0x2a1f15, 1).strokeRect(c * CELL + 8, r * CELL + 8, CELL - 16, CELL - 16);
          continue;
        }
        bg.fillStyle((r + c) % 2 ? 0x2e2117 : 0x3a2a1d, 1).fillRoundedRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 10);
      }
    this.tileLayer = this.add.container();
    this.overlayLayer = this.add.container();
    this.selectGfx = this.add.graphics();
    this.previewGfx = this.add.graphics();
    this.fxLayer = this.add.container();

    b.tiles.forEach((t, i) => t && this.addSprite(t, { r: Math.floor(i / b.cols), c: i % b.cols }));
    b.burials.forEach((bur, i) => bur && this.drawBurial(bur, { r: Math.floor(i / b.cols), c: i % b.cols }));
    b.walls.forEach((hp, i) => hp > 0 && this.drawWall(i, hp));
    // Mask so spawning tiles appear from the top edge, not over the HUD.
    const maskShape = this.make.graphics({}).fillStyle(0xffffff).fillRect(0, 0, b.cols * CELL, b.rows * CELL);
    this.tileLayer.setMask(maskShape.createGeometryMask());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.scheduleHint();
    this.hooks.onReady(this);
  }

  // ------------------------------------------------------------ textures

  private textureFor(t: Tile): string {
    const key = `tile:${t.type}:${t.special ?? ''}`;
    if (this.textures.exists(key)) return key;
    const rt = this.make.renderTexture({ width: CELL, height: CELL }, false);
    const g = this.make.graphics({}, false);
    const pad = 5;
    const s = CELL - pad * 2;
    if (t.special === 'drum') {
      g.fillStyle(0x1c0f06).fillRoundedRect(pad, pad + 3, s, s, 16);
      g.fillStyle(0x6b3a12).fillRoundedRect(pad, pad, s, s, 16);
      g.lineStyle(4, 0xf5c84c).strokeRoundedRect(pad + 2, pad + 2, s - 4, s - 4, 14);
      for (let k = 0; k < 6; k++) {
        const colors = [0x8d8f94, 0x5f8f3a, 0xe0582a, 0x4f7896, 0x2d74d6, 0xc9a46b];
        g.fillStyle(colors[k]).fillCircle(CELL / 2 + Math.cos((k / 6) * Math.PI * 2) * 26, CELL / 2 + Math.sin((k / 6) * Math.PI * 2) * 26, 5);
      }
    } else {
      const color = tileTypeDef(t.type!).color;
      g.fillStyle(shade(color, 0.45)).fillRoundedRect(pad, pad + 4, s, s, 16);
      g.fillStyle(color).fillRoundedRect(pad, pad, s, s, 16);
      g.fillStyle(shade(color, 1.35), 0.55).fillRoundedRect(pad + 5, pad + 4, s - 10, s * 0.38, 12);
      if (t.special === 'axeRow' || t.special === 'axeCol') {
        g.fillStyle(0xffffff, 0.55);
        for (let k = -1; k <= 1; k++) {
          if (t.special === 'axeRow') g.fillRect(pad + 4, CELL / 2 + k * 14 - 3, s - 8, 6);
          else g.fillRect(CELL / 2 + k * 14 - 3, pad + 4, 6, s - 8);
        }
      }
      if (t.special === 'keg') {
        g.lineStyle(5, 0x2a1406).strokeCircle(CELL / 2, CELL / 2, 30);
        g.lineStyle(3, 0xffd166).strokeCircle(CELL / 2, CELL / 2, 30);
      }
    }
    rt.draw(g);
    const glyph = t.special === 'drum' ? '🥁' : tileTypeDef(t.type!).glyph;
    const txt = this.make.text({ text: glyph, style: { fontFamily: EMOJI_FONT, fontSize: '38px' } }, false).setOrigin(0.5);
    rt.draw(txt, CELL / 2, CELL / 2 + 2);
    if (t.special && t.special !== 'drum') {
      const badge = this.make.text({ text: t.special === 'keg' ? '💣' : '🪓', style: { fontFamily: EMOJI_FONT, fontSize: '22px' } }, false).setOrigin(0.5);
      const bg = this.make.graphics({}, false).fillStyle(0x1a120c, 0.85).fillCircle(CELL - 18, CELL - 18, 14);
      rt.draw(bg);
      rt.draw(badge, CELL - 18, CELL - 17);
      badge.destroy();
      bg.destroy();
    }
    rt.saveTexture(key);
    g.destroy();
    txt.destroy();
    return key;
  }

  private addSprite(t: Tile, pos: Pos, fromRow?: number): Img {
    const img = this.add.image(cx(pos.c), cy(fromRow ?? pos.r), this.textureFor(t));
    img.setData('cell', pos).setData('tile', t);
    this.tileLayer.add(img);
    this.sprites.set(t.id, img);
    return img;
  }

  private setTile(img: Img, t: Tile) {
    img.setTexture(this.textureFor(t)).setData('tile', t);
  }

  spriteAt(pos: Pos): Img | undefined {
    for (const img of this.sprites.values()) {
      const p = img.getData('cell') as Pos;
      if (p.r === pos.r && p.c === pos.c) return img;
    }
    return undefined;
  }

  // ------------------------------------------------------------ burials

  private drawBurial(bur: Burial, pos: Pos) {
    this.burialViews.get(bur.id)?.destroy();
    const v = this.add.container(cx(pos.c), cy(pos.r));
    const glow = this.add.graphics();
    const stage = bur.depth - bur.remaining + 1; // 1 = fresh, 2 = cracked once (deep)
    glow.fillStyle(0xffd27a, 0.12 + 0.08 * stage).fillCircle(0, 0, 34);
    glow.lineStyle(2, 0xffd27a, 0.35 + 0.15 * stage).strokeRoundedRect(-CELL / 2 + 4, -CELL / 2 + 4, CELL - 8, CELL - 8, 14);
    const crack = this.add.graphics();
    let h = 0;
    for (const ch of bur.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const branches = bur.depth > 1 ? 2 + stage * 2 : 4;
    const len = bur.depth > 1 ? 10 + stage * 10 : 22;
    crack.lineStyle(bur.depth > 1 && stage === 1 ? 2 : 3, 0x1a0f05, 0.85);
    for (let k = 0; k < branches; k++) {
      let x = (rnd() - 0.5) * 8;
      let y = (rnd() - 0.5) * 8;
      const a0 = (k / branches) * Math.PI * 2 + rnd();
      crack.beginPath().moveTo(x, y);
      for (let seg = 0; seg < 3; seg++) {
        const a = a0 + (rnd() - 0.5) * 0.9;
        x += Math.cos(a) * (len / 3);
        y += Math.sin(a) * (len / 3);
        crack.lineTo(x, y);
      }
      crack.strokePath();
    }
    v.add([glow, crack]);
    if (bur.depth > 1) {
      const t = this.add.text(CELL / 2 - 14, -CELL / 2 + 6, '⛏'.repeat(bur.remaining), { fontSize: '12px', fontFamily: EMOJI_FONT }).setOrigin(1, 0);
      v.add(t);
    }
    this.tweens.add({ targets: glow, alpha: { from: 1, to: 0.45 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.overlayLayer.add(v);
    this.burialViews.set(bur.id, v);
  }

  private hitBurials(hits: BurialHit[]) {
    for (const h of hits) {
      const v = this.burialViews.get(h.burialId);
      if (h.revealed) {
        if (v) this.tweens.add({ targets: v, scale: 1.6, alpha: 0, duration: 300, onComplete: () => v.destroy() });
        this.burialViews.delete(h.burialId);
        this.ring(h.pos, 0xffe08a, 1.6);
      } else {
        sfx.crack();
        const bur = { id: h.burialId, depth: 2, remaining: h.remaining };
        this.drawBurial(bur, h.pos);
        this.cameras.main.shake(80, 0.004);
      }
    }
  }

  // ------------------------------------------------------------ walls (fortress)

  private drawWall(i: number, hp: number) {
    this.wallViews.get(i)?.destroy();
    const pos = { r: Math.floor(i / this.board.cols), c: i % this.board.cols };
    const v = this.add.container(cx(pos.c), cy(pos.r));
    const g = this.add.graphics();
    const s = CELL - 8;
    // wooden palisade: vertical stakes with pointed tops, iron bands if reinforced
    for (let k = 0; k < 4; k++) {
      const x = -s / 2 + k * (s / 4);
      const w = s / 4 - 2;
      g.fillStyle(k % 2 ? 0x7a4a24 : 0x8b5a2b).fillRect(x + 1, -s / 2 + 10, w, s - 10);
      g.fillTriangle(x + 1, -s / 2 + 10, x + 1 + w, -s / 2 + 10, x + 1 + w / 2, -s / 2);
      g.lineStyle(2, 0x3b2410, 0.8).strokeRect(x + 1, -s / 2 + 10, w, s - 10);
    }
    if (hp > 1) {
      g.fillStyle(0x6f7a86).fillRect(-s / 2, -6, s, 8).fillRect(-s / 2, s / 2 - 16, s, 8);
      for (let k = 0; k < 4; k++) g.fillStyle(0xcfd6de).fillCircle(-s / 2 + 8 + k * (s / 4), -2, 2.5);
    }
    v.add(g);
    this.overlayLayer.add(v);
    this.wallViews.set(i, v);
  }

  private hitWalls(hits: { pos: Pos; remaining: number }[]) {
    if (!hits.length) return;
    sfx.crack();
    this.cameras.main.shake(90, 0.004);
    for (const h of hits) {
      const i = idx(this.board, h.pos.r, h.pos.c);
      this.burst(h.pos, 0x8b5a2b, 10);
      if (h.remaining > 0) {
        this.drawWall(i, h.remaining);
        const v = this.wallViews.get(i)!;
        this.tweens.add({ targets: v, angle: { from: -6, to: 0 }, duration: 200, ease: 'Back.easeOut' });
      } else {
        const v = this.wallViews.get(i);
        this.wallViews.delete(i);
        if (v) this.tweens.add({ targets: v, y: v.y + 20, alpha: 0, angle: 12, duration: 280, onComplete: () => v.destroy() });
        this.ring(h.pos, 0xd9a066, 1.8);
      }
    }
  }

  /** Called once the server has rolled the relic: rarity-colored flash at the burial cell. */
  flashReveal(pos: Pos, rarityColor: number, glyph: string) {
    this.ring(pos, rarityColor, 2.6, 600);
    const flash = this.add.rectangle(cx(pos.c), cy(pos.r), CELL, CELL, rarityColor, 0.8);
    this.fxLayer.add(flash);
    this.tweens.add({ targets: flash, alpha: 0, scale: 3, duration: 500, onComplete: () => flash.destroy() });
    const g = this.add.text(cx(pos.c), cy(pos.r), glyph, { fontFamily: EMOJI_FONT, fontSize: '52px' }).setOrigin(0.5);
    this.fxLayer.add(g);
    this.tweens.add({ targets: g, y: g.y - 60, scale: 1.4, duration: 700, ease: 'Back.easeOut' });
    this.tweens.add({ targets: g, alpha: 0, delay: 600, duration: 300, onComplete: () => g.destroy() });
  }

  // ------------------------------------------------------------ input

  private cellAt(x: number, y: number): Pos | null {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r < 0 || c < 0 || r >= this.board.rows || c >= this.board.cols || this.board.blocked[idx(this.board, r, c)]) return null;
    return { r, c };
  }

  private pointerDown(p: Phaser.Input.Pointer) {
    this.scheduleHint();
    if (!this.hooks.canInteract()) return;
    const pos = this.cellAt(p.x, p.y);
    if (!pos) return;
    if (this.hooks.isTargeting()) {
      this.hooks.onTap(pos);
      return;
    }
    this.down = { pos, x: p.x, y: p.y };
  }

  private pointerMove(p: Phaser.Input.Pointer) {
    if (!this.down || !p.isDown) return;
    const dx = p.x - this.down.x;
    const dy = p.y - this.down.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < CELL * 0.35) return;
    const a = this.down.pos;
    const b = Math.abs(dx) > Math.abs(dy) ? { r: a.r, c: a.c + Math.sign(dx) } : { r: a.r + Math.sign(dy), c: a.c };
    this.down = null;
    this.select(null);
    this.hooks.onSwap(a, b);
  }

  private pointerUp(_p: Phaser.Input.Pointer) {
    if (!this.down) return;
    const pos = this.down.pos;
    this.down = null;
    const s = this.selected;
    if (s && Math.abs(s.r - pos.r) + Math.abs(s.c - pos.c) === 1) {
      this.select(null);
      this.hooks.onSwap(s, pos);
    } else if (s && s.r === pos.r && s.c === pos.c) {
      this.select(null);
    } else {
      this.select(pos);
      sfx.select();
    }
  }

  select(pos: Pos | null) {
    this.selected = pos;
    this.selectGfx.clear();
    if (pos) this.selectGfx.lineStyle(4, 0xffffff, 0.95).strokeRoundedRect(pos.c * CELL + 3, pos.r * CELL + 3, CELL - 6, CELL - 6, 14);
  }

  showPreview(cells: Pos[], color = 0xffffff) {
    this.previewGfx.clear();
    for (const p of cells) {
      this.previewGfx.fillStyle(color, 0.28).fillRoundedRect(p.c * CELL + 2, p.r * CELL + 2, CELL - 4, CELL - 4, 12);
      this.previewGfx.lineStyle(3, color, 0.9).strokeRoundedRect(p.c * CELL + 3, p.r * CELL + 3, CELL - 6, CELL - 6, 12);
    }
  }

  scheduleHint(move?: [Pos, Pos] | null) {
    this.hintTimer?.remove();
    this.hintTween?.stop();
    this.sprites.forEach((s) => s.setScale(1));
    this.hintTimer = this.time.delayedCall(7000, () => {
      if (!this.hooks.canInteract() || this.hooks.isTargeting()) return this.scheduleHint();
      const pair = move ?? this.hint?.();
      if (!pair) return;
      const targets = pair.map((p) => this.spriteAt(p)).filter(Boolean);
      this.hintTween = this.tweens.add({ targets, scale: 1.12, duration: 350, yoyo: true, repeat: 5, ease: 'Sine.easeInOut' });
    });
  }
  hint?: () => [Pos, Pos] | null;

  // ------------------------------------------------------------ animation helpers

  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ ...cfg, onComplete: () => resolve() }));
  }
  private wait(ms: number) {
    return new Promise<void>((r) => this.time.delayedCall(ms, r));
  }

  private ring(pos: Pos, color: number, scale = 1.8, duration = 350) {
    const ring = this.add.circle(cx(pos.c), cy(pos.r), CELL * 0.4).setStrokeStyle(5, color).setFillStyle(color, 0.15);
    this.fxLayer.add(ring);
    this.tweens.add({ targets: ring, scale, alpha: 0, duration, onComplete: () => ring.destroy() });
  }

  private burst(pos: Pos, color: number, n = 6) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 20 + Math.random() * 30;
      const dot = this.add.circle(cx(pos.c), cy(pos.r), 4 + Math.random() * 4, color);
      this.fxLayer.add(dot);
      this.tweens.add({ targets: dot, x: dot.x + Math.cos(a) * d, y: dot.y + Math.sin(a) * d, alpha: 0, scale: 0.3, duration: 300 + Math.random() * 200, onComplete: () => dot.destroy() });
    }
  }

  private floatText(text: string, x: number, y: number, color = '#ffe08a', size = 34) {
    const t = this.add.text(x, y, text, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, stroke: '#2a1406', strokeThickness: 6, fontStyle: 'bold' }).setOrigin(0.5);
    this.fxLayer.add(t);
    this.tweens.add({ targets: t, y: y - 50, alpha: { from: 1, to: 0 }, scale: { from: 0.6, to: 1.15 }, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private bigGlyph(glyph: string, x = (this.board.cols * CELL) / 2, y = (this.board.rows * CELL) / 2) {
    const t = this.add.text(x, y, glyph, { fontFamily: EMOJI_FONT, fontSize: '120px' }).setOrigin(0.5).setScale(0.2).setAlpha(0);
    this.fxLayer.add(t);
    return this.tween({ targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' }).then(() => {
      this.tweens.add({ targets: t, alpha: 0, scale: 1.4, duration: 250, onComplete: () => t.destroy() });
    });
  }

  // ------------------------------------------------------------ playback

  async animateSwap(a: Pos, b: Pos, valid: boolean) {
    const sa = this.spriteAt(a);
    const sb = this.spriteAt(b);
    if (!sa || !sb) return;
    const go = (s: Img, p: Pos) => this.tween({ targets: s, x: cx(p.c), y: cy(p.r), duration: 150, ease: 'Quad.easeInOut' });
    sfx.swap();
    await Promise.all([go(sa, b), go(sb, a)]);
    if (!valid) {
      sfx.invalid();
      await Promise.all([go(sa, a), go(sb, b)]);
      this.cameras.main.shake(60, 0.002);
      return;
    }
    sa.setData('cell', b);
    sb.setData('cell', a);
  }

  async play(result: ActionResult) {
    this.hintTimer?.remove();
    this.hintTween?.stop();
    this.sprites.forEach((s) => s.setScale(1));
    this.select(null);
    this.previewGfx.clear();
    if (result.relic) await this.relicIntro(result.relic.relicId, result.relic.app.fx);
    if (result.converted?.length) {
      if (!result.relic) {
        sfx.forgeReady();
        sfx.blast();
        await this.bigGlyph('⚒️');
      }
      await this.animateConvert(result.converted);
    }
    for (const [k, step] of result.steps.entries()) {
      let already = new Set<number>();
      if (k === 0 && result.relic) already = await this.relicStrike(result.relic.relicId, result.relic.app.fx, step);
      await this.playStep(step, k, already);
    }
    if (result.shuffle) await this.animateShuffle(result.shuffle.placements);
    this.scheduleHint();
  }

  private async playStep(step: Step, k: number, already: Set<number>) {
    this.playFx(step.fx.filter((f) => f.kind !== 'relic'));
    if (k >= 1) this.floatText(k >= 3 ? `Unstoppable! x${k + 1}` : `Cascade x${k + 1}`, (this.board.cols * CELL) / 2, (this.board.rows * CELL) / 2, '#ffd166', 30);
    const toClear = step.cleared.filter((c) => !already.has(c.tile.id));
    if (toClear.length) sfx.clear(k);
    await this.animateClear(toClear);
    this.hitBurials(step.burialHits);
    this.hitWalls(step.wallHits ?? []);
    if (step.score) {
      const p = step.cleared[Math.floor(step.cleared.length / 2)]?.pos;
      if (p) this.floatText(`+${step.score}`, cx(p.c), cy(p.r), '#ffffff', 26);
    }
    for (const cr of step.created) {
      const img = this.addSprite(cr.tile, cr.pos).setScale(0);
      this.tweens.add({ targets: img, scale: 1, duration: 260, ease: 'Back.easeOut' });
      this.ring(cr.pos, 0xffffff, 1.6);
    }
    if (step.created.length) {
      sfx.special();
      await this.wait(160);
    }
    await this.animateFalls(step);
  }

  private async animateClear(cleared: ClearedTile[]) {
    if (!cleared.length) return;
    await Promise.all(cleared.map((c, n) => this.clearOne(c, Math.min(n * 6, 120))));
  }

  private clearOne(c: ClearedTile, delay = 0): Promise<void> {
    const img = this.sprites.get(c.tile.id);
    if (!img) return Promise.resolve();
    this.sprites.delete(c.tile.id);
    const color = c.tile.type ? tileTypeDef(c.tile.type).color : 0xf5c84c;
    return this.tween({
      targets: img, scale: 0, alpha: 0, angle: 25, delay, duration: 170, ease: 'Back.easeIn',
      onStart: () => this.burst(c.pos, color),
    }).then(() => img.destroy());
  }

  private async animateFalls(step: Step) {
    const tasks: Promise<void>[] = [];
    for (const f of step.falls) {
      const img = this.sprites.get(f.tileId);
      if (!img) continue;
      img.setData('cell', f.to);
      tasks.push(this.tween({ targets: img, y: cy(f.to.r), duration: 120 + 45 * (f.to.r - f.from.r), ease: 'Bounce.easeOut' }));
    }
    for (const s of step.spawns) {
      const img = this.addSprite(s.tile, s.to, s.fromRow);
      tasks.push(this.tween({ targets: img, y: cy(s.to.r), duration: 140 + 45 * (s.to.r - s.fromRow), ease: 'Bounce.easeOut' }));
    }
    await Promise.all(tasks);
  }

  private async animateConvert(conv: ClearedTile[]) {
    await Promise.all(conv.map((c, n) => {
      const img = this.sprites.get(c.tile.id);
      if (!img) return Promise.resolve();
      return this.wait(n * 30).then(() => {
        this.setTile(img, c.tile);
        this.ring(c.pos, 0xffd166, 1.5);
        return this.tween({ targets: img, scale: { from: 1.4, to: 1 }, duration: 200 });
      });
    }));
    await this.wait(250);
  }

  async animateShuffle(placements: { tileId: number; to: Pos; type: string | null }[]) {
    sfx.shuffle();
    this.floatText('No moves — shuffling!', (this.board.cols * CELL) / 2, (this.board.rows * CELL) / 2, '#ffffff', 30);
    const mid = { x: (this.board.cols * CELL) / 2, y: (this.board.rows * CELL) / 2 };
    const imgs = placements.map((p) => this.sprites.get(p.tileId)).filter((x): x is Img => !!x);
    await this.tween({ targets: imgs, x: mid.x, y: mid.y, scale: 0.6, duration: 250, ease: 'Quad.easeIn' });
    await Promise.all(placements.map((p) => {
      const img = this.sprites.get(p.tileId);
      if (!img) return Promise.resolve();
      const t = img.getData('tile') as Tile;
      if (t.type !== p.type) this.setTile(img, { ...t, type: p.type });
      img.setData('cell', p.to);
      return this.tween({ targets: img, x: cx(p.to.c), y: cy(p.to.r), scale: 1, duration: 320, ease: 'Back.easeOut' });
    }));
  }

  // ------------------------------------------------------------ effects

  private playFx(fx: Fx[]) {
    const W = this.board.cols * CELL;
    const H = this.board.rows * CELL;
    for (const f of fx) {
      if (f.kind === 'row' || f.kind === 'col') {
        sfx.axe();
        const beam = f.kind === 'row'
          ? this.add.rectangle(W / 2, cy(f.r), W, CELL * 0.5, 0xfff3c4, 0.9)
          : this.add.rectangle(cx(f.c), H / 2, CELL * 0.5, H, 0xfff3c4, 0.9);
        this.fxLayer.add(beam);
        if (f.kind === 'row') beam.scaleX = 0.05;
        else beam.scaleY = 0.05;
        this.tweens.add({ targets: beam, ...(f.kind === 'row' ? { scaleX: 1 } : { scaleY: 1 }), duration: 130, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: beam, alpha: 0, delay: 130, duration: 220, onComplete: () => beam.destroy() });
        const axe = this.add.text(cx(f.from.c), cy(f.from.r), '🪓', { fontFamily: EMOJI_FONT, fontSize: '44px' }).setOrigin(0.5);
        this.fxLayer.add(axe);
        this.tweens.add({ targets: axe, angle: 720, alpha: 0, scale: 1.6, duration: 400, onComplete: () => axe.destroy() });
      } else if (f.kind === 'blast') {
        sfx.blast();
        const boom = this.add.circle(cx(f.center.c), cy(f.center.r), CELL * (f.radius + 0.5), 0xffa23a, 0.75);
        this.fxLayer.add(boom);
        boom.setScale(0.2);
        this.tweens.add({ targets: boom, scale: 1.1, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => boom.destroy() });
        this.cameras.main.shake(120, 0.006);
      } else if (f.kind === 'drum') {
        sfx.drum();
        const g = this.add.graphics();
        this.fxLayer.add(g);
        g.lineStyle(3, 0xfff0a0, 0.9);
        for (const p of f.cells) g.lineBetween(cx(f.from.c), cy(f.from.r), cx(p.c), cy(p.r));
        this.tweens.add({ targets: g, alpha: 0, duration: 450, onComplete: () => g.destroy() });
        this.ring(f.from, 0xfff0a0, 3, 500);
        this.cameras.main.shake(150, 0.005);
      }
    }
  }

  private async relicIntro(relicId: string, _fx: Fx[]) {
    const def = relicDef(relicId);
    if (relicId === 'war_horn') {
      sfx.horn();
      await this.bigGlyph(def.glyph);
      this.floatText('+3 Moves!', (this.board.cols * CELL) / 2, (this.board.rows * CELL) / 2 + 60, '#9cf09a', 40);
    } else if (relicId === 'shield_wall') {
      sfx.shield();
      await this.bigGlyph(def.glyph);
      this.floatText('Next 3 moves free!', (this.board.cols * CELL) / 2, (this.board.rows * CELL) / 2 + 60, '#9cc2ff', 34);
    } else if (relicId === 'warlords_banner' || relicId === 'war_hammer' || relicId === 'dragonfire_blade') {
      await this.bigGlyph(def.glyph);
    }
  }

  /** Relic-specific strike animation. Returns tile ids it already cleared. */
  private async relicStrike(relicId: string, fx: Fx[], step: Step): Promise<Set<number>> {
    const f = fx.find((x): x is Extract<Fx, { kind: 'relic' }> => x.kind === 'relic');
    const target = f?.target;
    const color = RARITY_INFO[relicDef(relicId).rarity].color;
    const W = this.board.cols * CELL;
    const H = this.board.rows * CELL;
    const done = new Set<number>();
    const byPos = new Map(step.cleared.map((c) => [`${c.pos.r},${c.pos.c}`, c]));

    switch (relicId) {
      case 'sword':
        if (target) await this.swordSpin(target, step, done);
        break;
      case 'sling_stone':
      case 'torch':
      case 'fire_arrow':
      case 'spear':
      case 'twin_axes': {
        if (!target) break;
        const glyph = relicDef(relicId).glyph;
        sfx.launch();
        const p = this.add.text(W / 2, H + 40, glyph, { fontFamily: EMOJI_FONT, fontSize: '56px' }).setOrigin(0.5);
        this.fxLayer.add(p);
        await this.tween({ targets: p, x: cx(target.c), y: cy(target.r), angle: 360, duration: 280, ease: 'Quad.easeIn' });
        p.destroy();
        this.ring(target, color, 2.2);
        if (relicId === 'torch' || relicId === 'fire_arrow') sfx.fire();
        else sfx.crack();
        if (relicId === 'torch') {
          const flame = this.add.circle(cx(target.c), cy(target.r), CELL * 1.5, 0xff7a1a, 0.6);
          this.fxLayer.add(flame);
          this.tweens.add({ targets: flame, alpha: 0, scale: 1.3, duration: 400, onComplete: () => flame.destroy() });
        } else if (relicId === 'fire_arrow') {
          const g = this.add.graphics().lineStyle(16, 0xff6a00, 0.8);
          this.fxLayer.add(g);
          const m = Math.max(W, H);
          g.lineBetween(cx(target.c) - m, cy(target.r) - m, cx(target.c) + m, cy(target.r) + m);
          g.lineBetween(cx(target.c) - m, cy(target.r) + m, cx(target.c) + m, cy(target.r) - m);
          this.tweens.add({ targets: g, alpha: 0, duration: 450, onComplete: () => g.destroy() });
        } else if (relicId === 'spear' || relicId === 'twin_axes') {
          const rows = relicId === 'twin_axes' || f?.axis === 'row';
          const cols = relicId === 'twin_axes' || f?.axis === 'col';
          if (rows) this.playFx([{ kind: 'row', r: target.r, from: target }]);
          if (cols) this.playFx([{ kind: 'col', c: target.c, from: target }]);
        }
        break;
      }
      case 'catapult': {
        const blasts = fx.filter((x): x is Extract<Fx, { kind: 'blast' }> => x.kind === 'blast');
        await Promise.all(blasts.map((b, n) => {
          this.time.delayedCall(n * 120, () => sfx.launch());
          const rock = this.add.text(n * (W / 2), H + 30, '🪨', { fontFamily: EMOJI_FONT, fontSize: '54px' }).setOrigin(0.5);
          this.fxLayer.add(rock);
          const sx = rock.x;
          const sy = rock.y;
          const tx = cx(b.center.c);
          const ty = cy(b.center.r);
          const o = { t: 0 };
          return this.tween({
            targets: o, t: 1, duration: 520, delay: n * 120, ease: 'Linear',
            onUpdate: () => {
              rock.x = sx + (tx - sx) * o.t;
              rock.y = sy + (ty - sy) * o.t - Math.sin(o.t * Math.PI) * 180;
              rock.angle = o.t * 540;
              rock.setScale(1 + Math.sin(o.t * Math.PI) * 0.5);
            },
          }).then(() => {
            rock.destroy();
            this.playFx([b]);
          });
        }));
        break;
      }
      case 'war_hammer':
        sfx.blast();
        this.cameras.main.shake(300, 0.012);
        for (const c of step.cleared) if (c.tile.type === 'stone') this.ring(c.pos, 0xcfd3da, 1.6);
        break;
      case 'dragonfire_blade': {
        sfx.fire();
        sfx.blast();
        const wave = this.add.rectangle(W / 2, H + H / 2, W, H, 0xff4a1a, 0.7);
        this.fxLayer.add(wave);
        this.cameras.main.shake(500, 0.01);
        const o = { y: H + H / 2 };
        await this.tween({
          targets: o, y: -H / 2, duration: 650, ease: 'Sine.easeIn',
          onUpdate: () => {
            wave.y = o.y;
            for (const [key, c] of byPos) {
              if (!done.has(c.tile.id) && cy(c.pos.r) > o.y - H / 2) {
                done.add(c.tile.id);
                void this.clearOne(c);
                byPos.delete(key);
              }
            }
          },
        });
        wave.destroy();
        break;
      }
      case 'warlords_banner':
        sfx.drum();
        this.cameras.main.shake(250, 0.01);
        break;
    }
    return done;
  }

  /** The hero item: a blade sweeps a full circle over the 3×3, clearing tiles as it passes. */
  private async swordSpin(center: Pos, step: Step, done: Set<number>) {
    const x = cx(center.c);
    const y = cy(center.r);
    const reach = CELL * 1.62;
    const blade = this.add.container(x, y);
    const g = this.add.graphics();
    // blade (pointing up), drawn from the hilt outward
    g.fillStyle(0x7a8a9a).fillRect(-8, -reach + 18, 16, reach - 30);
    g.fillStyle(0xe9eef4).fillRect(-6, -reach + 18, 9, reach - 30);
    g.fillStyle(0xffffff, 0.9).fillRect(-1, -reach + 22, 2, reach - 40);
    g.fillStyle(0xe9eef4).fillTriangle(-8, -reach + 18, 8, -reach + 18, 0, -reach - 4);
    g.fillStyle(0xc8962c).fillRoundedRect(-26, -16, 52, 10, 4); // crossguard
    g.fillStyle(0x5a3416).fillRect(-5, -6, 10, 22); // grip
    g.fillStyle(0xf2c14e).fillCircle(0, 19, 7); // pommel
    blade.add(g);
    const trail = this.add.graphics();
    this.fxLayer.add([trail, blade]);
    blade.setScale(0.2).setAlpha(0);
    await this.tween({ targets: blade, scale: 1, alpha: 1, angle: -25, duration: 180, ease: 'Back.easeOut' });

    const center0 = step.cleared.find((c) => c.pos.r === center.r && c.pos.c === center.c);
    if (center0) {
      done.add(center0.tile.id);
      void this.clearOne(center0);
      this.ring(center, 0xffffff, 2);
    }
    const pending = step.cleared
      .filter((c) => c !== center0 && Math.abs(c.pos.r - center.r) <= 1 && Math.abs(c.pos.c - center.c) <= 1)
      .map((c) => ({ c, a: sweepAngle(center, c.pos) }));
    sfx.swordWhoosh();
    const o = { a: -0.44 };
    await this.tween({
      targets: o, a: Math.PI * 2, duration: 620, ease: 'Cubic.easeInOut',
      onUpdate: () => {
        blade.rotation = o.a;
        trail.clear();
        const start = Math.max(-0.44, o.a - 1.6) - Math.PI / 2;
        const end = o.a - Math.PI / 2;
        if (end > start) {
          trail.fillStyle(0xbfe3ff, 0.28).slice(x, y, reach, start, end, false).fillPath();
          trail.lineStyle(4, 0xffffff, 0.8).beginPath().arc(x, y, reach - 4, Math.max(start, end - 0.6), end, false).strokePath();
        }
        for (const p of pending) {
          if (!done.has(p.c.tile.id) && o.a >= p.a) {
            done.add(p.c.tile.id);
            void this.clearOne(p.c);
            this.burst(p.c.pos, 0xffffff, 4);
          }
        }
      },
    });
    trail.clear();
    sfx.swordRing();
    this.cameras.main.shake(140, 0.006);
    await this.tween({ targets: blade, alpha: 0, scale: 1.25, duration: 200 });
    blade.destroy();
    trail.destroy();
  }
}
