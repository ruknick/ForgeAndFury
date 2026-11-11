/**
 * LevelRun: the full, deterministic state machine for one play-through of a level.
 * The client drives it for gameplay; the server replays the same action log to
 * validate burial reveals (spec §7). Same seed + same actions = same board.
 */
import { allPlayable, createBoard, findValidMove, posOf, resolveBoard, shuffleBoard, trySwap, type ShuffleResult } from './board';
import { FORGE } from './config/forge';
import { TILE_TYPES } from './config/tiles';
import type { DropTable } from './rarity';
import { applyRelic, convertToKegs, type RelicApplication } from './relicEffects';
import { relicDef } from './relics';
import { createRng, type Rng } from './rng';
import type { BoardState, BurialHit, ClearedTile, Pos, Rarity, RelicTarget, Step, TileType } from './types';

export type Objective =
  | { type: 'collect'; tile?: TileType; count?: number; targets?: { tile: TileType; count: number }[] }
  | { type: 'score'; score: number }
  | { type: 'unearth' }
  | { type: 'fortress' };

export interface BurialConfig {
  mode: 'random' | 'fixed';
  count?: number;
  depth?: number;
  /** In random mode, how many of the burials are "deep" (2 clears). */
  deep?: number;
  cells?: { r: number; c: number; depth?: number }[];
  /** Server-side only: forced results for the first N burials (tutorial drops). */
  guaranteed?: { relicId?: string; rarity?: Rarity }[];
}

export interface LevelDef {
  id: number;
  name: string;
  intro?: string;
  rows: number;
  cols: number;
  blocked: Pos[];
  moves: number;
  objective: Objective;
  burials: BurialConfig;
  dropTableOverride: Partial<DropTable> | null;
  stars: [number, number, number];
  tileTypes?: TileType[];
  /** Palisade walls (fortress levels). They break when tiles next to them are cleared. */
  walls?: { r: number; c: number; hp?: number }[];
  /** Set false to disable the Forge meter on this level. */
  forge?: boolean;
}

/** A burial as the client sees it: position and depth, never its contents. */
export interface PlacedBurial {
  id: string;
  pos: Pos;
  depth: number;
}

export type Action =
  | { kind: 'swap'; a: Pos; b: Pos }
  | { kind: 'relic'; relicId: string; instanceId?: string; target: RelicTarget }
  | { kind: 'forge' };

export interface ActionResult {
  steps: Step[];
  shuffle?: ShuffleResult;
  converted?: ClearedTile[];
  relic?: { relicId: string; app: RelicApplication };
  revealed: BurialHit[];
  moveSpent: boolean;
  scoreGained: number;
  status: RunStatus;
}

export type RunStatus = 'playing' | 'won' | 'lost';

export const MOVE_BONUS = 60;
export const DEFAULT_MAX_RELICS = 3;

export interface ObjectiveProgress {
  label: string;
  tile?: TileType;
  current: number;
  target: number;
}

export function placeBurials(level: LevelDef, rng: Rng): PlacedBurial[] {
  const cfg = level.burials;
  const blocked = new Set([...level.blocked, ...(level.walls ?? [])].map((p) => p.r * level.cols + p.c));
  if (cfg.mode === 'fixed') {
    return (cfg.cells ?? []).map((c, k) => ({ id: `b${k + 1}`, pos: { r: c.r, c: c.c }, depth: c.depth ?? cfg.depth ?? 1 }));
  }
  const free: Pos[] = [];
  // Keep burials off the top row so they're not instantly cleared by refills.
  for (let r = 1; r < level.rows; r++) for (let c = 0; c < level.cols; c++) if (!blocked.has(r * level.cols + c)) free.push({ r, c });
  const out: PlacedBurial[] = [];
  const count = Math.min(cfg.count ?? 0, free.length);
  for (let k = 0; k < count; k++) {
    const pos = free.splice(rng.int(free.length), 1)[0];
    out.push({ id: `b${k + 1}`, pos, depth: k < (cfg.deep ?? 0) ? 2 : cfg.depth ?? 1 });
  }
  return out;
}

export class LevelRun {
  readonly board: BoardState;
  readonly rng: Rng;
  movesLeft: number;
  score = 0;
  collected: Record<TileType, number> = {};
  freeMoves = 0;
  relicsUsed = 0;
  forgeCharge = 0;
  revealed: string[] = [];
  status: RunStatus = 'playing';
  readonly log: Action[] = [];

  constructor(
    readonly level: LevelDef,
    readonly seed: number,
    readonly burials: PlacedBurial[],
    readonly maxRelics = DEFAULT_MAX_RELICS,
  ) {
    this.rng = createRng(seed);
    const types = level.tileTypes ?? TILE_TYPES.map((t) => t.id);
    const weights = types.map((id) => TILE_TYPES.find((t) => t.id === id)?.weight ?? 1);
    this.board = createBoard(
      { rows: level.rows, cols: level.cols, blocked: level.blocked, walls: level.walls, tileTypes: types, tileWeights: weights, burials },
      this.rng,
    );
    this.movesLeft = level.moves;
  }

  get relicsLeft() {
    return Math.max(0, this.maxRelics - this.relicsUsed);
  }

  swap(a: Pos, b: Pos): ActionResult | null {
    if (this.status !== 'playing') return null;
    const res = trySwap(this.board, a, b, this.rng);
    if (!res.valid) return null;
    this.log.push({ kind: 'swap', a, b });
    this.spendMove();
    return this.finish(res.steps, true);
  }

  canUseRelic(relicId: string): string | null {
    if (this.status !== 'playing') return 'The level is over';
    if (this.relicsUsed >= this.maxRelics) return `Relic limit reached (${this.maxRelics} per level)`;
    relicDef(relicId);
    return null;
  }

  useRelic(relicId: string, target: RelicTarget, instanceId?: string): ActionResult {
    const why = this.canUseRelic(relicId);
    if (why) throw new Error(why);
    const def = relicDef(relicId);
    const app = applyRelic(this.board, relicId, target, this.rng);
    this.log.push({ kind: 'relic', relicId, instanceId, target });
    this.relicsUsed++;
    if (app.movesDelta) this.movesLeft += app.movesDelta;
    if (app.freeMoves) this.freeMoves += app.freeMoves;
    let converted: ClearedTile[] | undefined;
    if (app.convert) converted = convertToKegs(this.board, app.convert);
    const steps = app.cells.length ? resolveBoard(this.board, this.rng, { initial: { cells: app.cells, fx: app.fx, converted } }) : [];
    if (def.usesMove) this.spendMove();
    const result = this.finish(steps, def.usesMove);
    result.relic = { relicId, app };
    result.converted = converted;
    return result;
  }

  get forgeEnabled() {
    return this.level.forge !== false;
  }

  canForge(): boolean {
    return this.forgeEnabled && this.status === 'playing' && this.forgeCharge >= FORGE.cost;
  }

  /** Spends a full Forge meter: turns random plain tiles into specials. Free: no move, no relic slot. */
  forge(): ActionResult {
    if (!this.canForge()) throw new Error('The Forge is not ready');
    this.forgeCharge = 0;
    this.log.push({ kind: 'forge' });
    const plain = allPlayable(this.board).filter((i) => this.board.tiles[i] && !this.board.tiles[i]!.special);
    const converted: ClearedTile[] = [];
    for (const special of FORGE.produces) {
      if (!plain.length) break;
      const i = plain.splice(this.rng.int(plain.length), 1)[0];
      this.board.tiles[i] = { ...this.board.tiles[i]!, special };
      converted.push({ pos: posOf(this.board, i), tile: this.board.tiles[i]! });
    }
    const result = this.finish([], false);
    result.converted = converted;
    return result;
  }

  private spendMove() {
    if (this.freeMoves > 0) this.freeMoves--;
    else this.movesLeft--;
  }

  private finish(steps: Step[], moveSpent: boolean): ActionResult {
    let gained = 0;
    const revealed: BurialHit[] = [];
    for (const s of steps) {
      gained += s.score;
      for (const [t, n] of Object.entries(s.collected)) {
        this.collected[t] = (this.collected[t] ?? 0) + n;
        if (this.forgeEnabled && FORGE.inputs.includes(t)) this.forgeCharge = Math.min(FORGE.cost, this.forgeCharge + n);
      }
      for (const h of s.burialHits) if (h.revealed) {
        this.revealed.push(h.burialId);
        revealed.push(h);
      }
    }
    this.score += gained;
    let shuffle: ShuffleResult | undefined;
    if (!findValidMove(this.board)) shuffle = shuffleBoard(this.board, this.rng);
    this.evaluate();
    return { steps, shuffle, revealed, moveSpent, scoreGained: gained, status: this.status };
  }

  objectives(): ObjectiveProgress[] {
    const o = this.level.objective;
    switch (o.type) {
      case 'collect': {
        const targets = o.targets ?? [{ tile: o.tile!, count: o.count! }];
        return targets.map((t) => ({ label: t.tile, tile: t.tile, current: Math.min(this.collected[t.tile] ?? 0, t.count), target: t.count }));
      }
      case 'score':
        return [{ label: 'score', current: Math.min(this.score, o.score), target: o.score }];
      case 'unearth':
        return [{ label: 'relics', current: this.revealed.length, target: this.burials.length }];
      case 'fortress': {
        const total = this.level.walls?.length ?? 0;
        return [{ label: 'walls', current: total - this.board.walls.filter((w) => w > 0).length, target: total }];
      }
    }
  }

  objectiveDone(): boolean {
    return this.objectives().every((p) => p.current >= p.target);
  }

  private evaluate() {
    if (this.status !== 'playing') return;
    if (this.objectiveDone()) {
      this.status = 'won';
      this.score += Math.max(0, this.movesLeft) * MOVE_BONUS;
    } else if (this.movesLeft <= 0) {
      this.status = 'lost';
    }
  }

  stars(): number {
    if (this.status !== 'won') return 0;
    return Math.max(1, this.level.stars.filter((s) => this.score >= s).length);
  }
}

/** Rebuilds a run from its action log. Throws if any action is invalid. Used by the server for anti-cheat. */
export function replayRun(level: LevelDef, seed: number, burials: PlacedBurial[], log: Action[], maxRelics = DEFAULT_MAX_RELICS): LevelRun {
  const run = new LevelRun(level, seed, burials, maxRelics);
  for (const [k, a] of log.entries()) {
    if (a.kind === 'swap') {
      if (!run.swap(a.a, a.b)) throw new Error(`Replay: invalid swap at action ${k}`);
    } else if (a.kind === 'relic') {
      run.useRelic(a.relicId, a.target, a.instanceId);
    } else if (a.kind === 'forge') {
      run.forge();
    } else {
      throw new Error(`Replay: unknown action at ${k}`);
    }
  }
  return run;
}
