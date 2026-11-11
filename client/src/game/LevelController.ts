import type Phaser from 'phaser';
import { cloneBoard, findValidMove, posOf } from '../../../shared/board';
import { TILE_TYPES, tileTypeDef } from '../../../shared/config/tiles';
import { LevelRun, type ActionResult, type LevelDef } from '../../../shared/game';
import { applyRelic } from '../../../shared/relicEffects';
import { RARITY_INFO } from '../../../shared/relics';
import { createRng } from '../../../shared/rng';
import type { Pos, RelicTarget } from '../../../shared/types';
import { api, ApiError, type OwnedRelic, type SessionInfo } from '../api';
import { $, h, rarityCss, showModal, toast } from '../ui';
import { BoardScene, CELL, type BoardHooks } from './BoardScene';

export interface LevelOutcome {
  status: 'won' | 'lost' | 'quit';
  score: number;
  stars: number;
  found: OwnedRelic[];
}

interface Targeting {
  relic: OwnedRelic;
  target: RelicTarget;
}

/** Glue between the pure LevelRun, the Phaser board scene, the DOM HUD, and the server. */
export class LevelController implements BoardHooks {
  run!: LevelRun;
  private scene?: BoardScene;
  private busy = false;
  private targeting: Targeting | null = null;
  private inventory: OwnedRelic[] = [];
  private found: OwnedRelic[] = [];
  private done!: (o: LevelOutcome) => void;
  private session: SessionInfo | null = null;

  constructor(private game: Phaser.Game, private level: LevelDef, private playerId: string | null) {}

  async start(): Promise<LevelOutcome> {
    let seed = Math.floor(Math.random() * 2 ** 31);
    let burials: SessionInfo['burials'] = [];
    let maxRelics = 3;
    if (this.playerId) {
      try {
        this.session = await api.startSession(this.playerId, this.level.id);
        ({ seed, burials, maxRelics } = this.session);
        this.inventory = (await api.inventory(this.playerId)).relics.filter((r) => r.state === 'in_game');
      } catch (e) {
        toast(`Offline: ${(e as Error).message}. Relics are disabled.`, 'error', 4000);
      }
    }
    this.run = new LevelRun(this.level, seed, burials, maxRelics);
    this.showHud(true);
    this.renderHud();
    this.renderRelicBar();
    $('btn-quit').onclick = () => this.quit();

    this.game.scale.setGameSize(this.level.cols * CELL, this.level.rows * CELL);
    // The board container was hidden while in menus; make Phaser re-measure it.
    this.game.scale.refresh();
    requestAnimationFrame(() => this.game.scale.refresh());
    this.game.scene.stop('board');
    this.game.scene.start('board', { board: this.run.board, hooks: this });
    return new Promise((resolve) => (this.done = resolve));
  }

  // ------------------------------------------------------------ BoardHooks

  onReady(scene: BoardScene) {
    this.scene = scene;
    scene.hint = () => findValidMove(this.run.board);
  }
  canInteract() {
    return !this.busy && this.run.status === 'playing';
  }
  isTargeting() {
    return !!this.targeting;
  }

  async onSwap(a: Pos, b: Pos) {
    if (!this.canInteract() || !this.scene) return;
    if (b.r < 0 || b.c < 0 || b.r >= this.run.board.rows || b.c >= this.run.board.cols) return;
    this.busy = true;
    try {
      const result = this.run.swap(a, b);
      await this.scene.animateSwap(a, b, !!result);
      if (result) await this.after(result);
    } finally {
      this.busy = false;
    }
  }

  onTap(pos: Pos) {
    if (!this.targeting) return;
    this.targeting.target.pos = pos;
    this.updatePreview();
    this.renderTargetBar();
  }

  // ------------------------------------------------------------ results

  private async after(result: ActionResult) {
    await this.scene!.play(result);
    this.renderHud();
    // Show reveal cards one at a time before letting the player continue.
    for (const hit of result.revealed) await this.reveal(hit.burialId, hit.pos);
    this.renderRelicBar();
    if (this.run.status !== 'playing') await this.end();
  }

  private async reveal(burialId: string, pos: Pos) {
    if (!this.session) {
      toast('A relic glints... but the server is offline.', 'error');
      return;
    }
    try {
      const { relic } = await api.reveal(this.session.sessionId, burialId, this.run.log);
      this.scene?.flashReveal(pos, RARITY_INFO[relic.def.rarity].color, relic.def.glyph);
      this.found.push(relic);
      this.inventory.push(relic);
      await new Promise((r) => setTimeout(r, 450));
      await revealCard(relic);
    } catch (e) {
      toast(`Relic reveal failed: ${(e as Error).message}`, 'error', 4000);
    }
  }

  private async end() {
    const status = this.run.status as 'won' | 'lost';
    if (this.session) await api.finish(this.session.sessionId, this.run.log).catch((e: Error) => toast(e.message, 'error'));
    await new Promise((r) => setTimeout(r, status === 'won' ? 500 : 300));
    this.finish({ status, score: this.run.score, stars: this.run.stars(), found: this.found });
  }

  private finish(o: LevelOutcome) {
    this.cancelTargeting();
    this.showHud(false);
    this.game.scene.stop('board');
    this.done(o);
  }

  private async quit() {
    if (this.busy) return;
    const ok = await showModal((close) =>
      h('div', { class: 'card' },
        h('h1', {}, 'Retreat?'),
        h('p', { class: 'muted' }, 'Leave this level? Relics you already found are kept. Relics you used are gone.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn secondary', onclick: () => close(false) }, 'Keep fighting'),
          h('button', { class: 'btn', onclick: () => close(true) }, 'Leave'))));
    if (ok) this.finish({ status: 'quit', score: this.run.score, stars: 0, found: this.found });
  }

  // ------------------------------------------------------------ relics

  private selectRelic(relic: OwnedRelic) {
    if (!this.canInteract()) return;
    if (this.targeting?.relic.relicId === relic.relicId) return this.cancelTargeting();
    const why = this.run.canUseRelic(relic.relicId);
    if (why) return toast(why, 'error');
    if (!this.session) return toast('Relics need the game server.', 'error');
    this.targeting = { relic, target: relic.def.targeting === 'tile+axis' ? { axis: 'row' } : {} };
    this.scene?.select(null);
    this.updatePreview();
    this.renderTargetBar();
    this.renderRelicBar();
  }

  private cancelTargeting() {
    this.targeting = null;
    this.scene?.showPreview([]);
    $('targetbar').hidden = true;
    this.renderRelicBar();
  }

  private ready(t: Targeting) {
    const k = t.relic.def.targeting;
    return k === 'none' || (k === 'tileType' ? !!t.target.tileType : !!t.target.pos);
  }

  private updatePreview() {
    const t = this.targeting;
    if (!t || !this.scene) return;
    if (!this.ready(t) || t.relic.relicId === 'catapult') return this.scene.showPreview([]);
    try {
      const b = cloneBoard(this.run.board);
      const app = applyRelic(b, t.relic.relicId, t.target, createRng(1));
      this.scene.showPreview(app.cells.map((i) => posOf(b, i)), RARITY_INFO[t.relic.def.rarity].color);
    } catch {
      this.scene.showPreview([]);
    }
  }

  private renderTargetBar() {
    const t = this.targeting;
    const bar = $('targetbar');
    if (!t) return void (bar.hidden = true);
    const d = t.relic.def;
    const hint =
      d.targeting === 'none' ? `${d.name}: ${d.effectText}.`
      : d.targeting === 'tileType' ? `${d.name}: pick a tile type.`
      : t.target.pos ? `${d.name}: ${d.effectText}.` : `${d.name}: tap a tile on the board.`;
    const kids: HTMLElement[] = [h('div', { class: 'hint' }, `${d.glyph} ${hint}`)];
    if (d.targeting === 'tile+axis') {
      for (const axis of ['row', 'col'] as const)
        kids.push(h('button', { class: `btn chip secondary ${t.target.axis === axis ? 'on' : ''}`, onclick: () => { t.target.axis = axis; this.updatePreview(); this.renderTargetBar(); } }, axis === 'row' ? '↔ Row' : '↕ Column'));
    }
    if (d.targeting === 'tileType') {
      for (const tt of TILE_TYPES.filter((x) => this.run.board.tileTypes.includes(x.id)))
        kids.push(h('button', { class: `btn chip secondary ${t.target.tileType === tt.id ? 'on' : ''}`, title: tt.name, onclick: () => { t.target.tileType = tt.id; this.updatePreview(); this.renderTargetBar(); } }, tt.glyph));
    }
    kids.push(h('button', { class: 'btn small secondary', onclick: () => this.cancelTargeting() }, 'Cancel'));
    kids.push(h('button', { class: 'btn small', disabled: !this.ready(t), onclick: () => this.confirmRelic() }, 'Use'));
    bar.replaceChildren(...kids);
    bar.hidden = false;
  }

  private async confirmRelic() {
    const t = this.targeting;
    if (!t || !this.ready(t) || !this.session || !this.canInteract()) return;
    this.busy = true;
    $('targetbar').hidden = true;
    try {
      await api.useRelic(this.session.sessionId, t.relic.instanceId);
      this.inventory = this.inventory.filter((r) => r.instanceId !== t.relic.instanceId);
      this.targeting = null;
      this.scene?.showPreview([]);
      const result = this.run.useRelic(t.relic.relicId, t.target, t.relic.instanceId);
      this.renderRelicBar();
      await this.after(result);
    } catch (e) {
      toast((e as ApiError).message, 'error', 3500);
      this.renderTargetBar();
    } finally {
      this.busy = false;
      this.renderRelicBar();
    }
  }

  // ------------------------------------------------------------ HUD

  private showHud(on: boolean) {
    $('hud').hidden = !on;
    $('relicbar').hidden = !on;
    $('board').hidden = !on;
    if (!on) $('targetbar').hidden = true;
  }

  private renderHud() {
    const r = this.run;
    $('hud-level').textContent = r.level.id ? `${r.level.id}. ${r.level.name}` : r.level.name;
    $('hud-moves').textContent = r.level.moves > 999 ? '∞' : String(r.movesLeft);
    $('hud-moves').parentElement!.classList.toggle('low', r.movesLeft <= 5);
    const shield = $('hud-shield');
    shield.hidden = !r.freeMoves;
    shield.textContent = `🛡️${r.freeMoves}`;
    $('hud-score').textContent = r.score.toLocaleString();
    const top = r.level.stars[2];
    $('hud-starfill').style.width = `${Math.min(100, (r.score / top) * 100)}%`;
    $('tick1').style.left = `${(r.level.stars[0] / top) * 100}%`;
    $('tick2').style.left = `${(r.level.stars[1] / top) * 100}%`;

    $('hud-objectives').replaceChildren(
      ...r.objectives().map((o) => {
        const glyph = o.tile ? tileTypeDef(o.tile).glyph : o.label === 'relics' ? '⚱️' : '🏆';
        const fmt = (n: number) => (o.label === 'score' ? n.toLocaleString() : n);
        return h('div', { class: `obj ${o.current >= o.target ? 'done' : ''}` }, h('span', { class: 'g' }, glyph), `${fmt(o.current)} / ${fmt(o.target)}`);
      }),
    );
    $('hud-meters').replaceChildren(
      ...r.board.tileTypes.map((t) => h('div', { class: 'meter', title: tileTypeDef(t).name }, `${tileTypeDef(t).glyph} `, h('b', {}, r.collected[t] ?? 0))),
    );
  }

  private renderRelicBar() {
    const items = $('relic-items');
    const groups = new Map<string, OwnedRelic[]>();
    for (const r of this.inventory) groups.set(r.relicId, [...(groups.get(r.relicId) ?? []), r]);
    const left = this.run?.relicsLeft ?? 0;
    if (!groups.size) {
      items.replaceChildren(h('div', { class: 'relic-empty' }, this.session ? 'No relics yet. Clear cracked tiles to dig them up.' : 'Relics need the game server.'));
    } else {
      items.replaceChildren(
        ...[...groups.values()].map((list) => {
          const r = list[0];
          return h('button', {
            class: `relic-btn ${this.targeting?.relic.relicId === r.relicId ? 'active' : ''}`,
            style: `--rc:${rarityCss(r.def.rarity)}`,
            title: `${r.def.name}: ${r.def.effectText}`,
            disabled: left <= 0 || this.run?.status !== 'playing',
            onclick: () => this.selectRelic(r),
          }, r.def.glyph, list.length > 1 ? h('span', { class: 'count' }, list.length) : null);
        }),
      );
    }
    $('relic-limit').replaceChildren(h('div', {}, `${left}/${this.run?.maxRelics ?? 3}`), h('div', {}, 'uses left'));
  }
}

export function revealCard(relic: OwnedRelic) {
  const d = relic.def;
  return showModal((close) =>
    h('div', { class: 'card reveal', style: `--rc:${rarityCss(d.rarity)}` },
      h('div', { class: 'muted small' }, 'Relic unearthed!'),
      h('div', { class: 'big' }, d.glyph),
      h('div', { class: 'rarity' }, RARITY_INFO[d.rarity].name),
      h('h1', {}, d.name),
      h('div', {}, d.effectText),
      h('div', { class: 'flavor' }, `“${d.flavorText}”`),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close() }, 'Add to inventory'))));
}
