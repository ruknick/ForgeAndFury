import { allPlayable, areaCells, cellsOfType, colCells, idx, isPlayable, posOf, rowCells } from './board';
import type { Rng } from './rng';
import type { BoardState, ClearedTile, Fx, Pos, RelicTarget } from './types';

export interface RelicApplication {
  /** Cells to clear, in visual order (the Sword's are sorted by sweep angle). */
  cells: number[];
  /** Tiles turned into specials before detonation (Warlord's Banner). */
  convert?: number[];
  fx: Fx[];
  movesDelta?: number;
  freeMoves?: number;
}

export class RelicTargetError extends Error {}

function need(target: RelicTarget, b: BoardState): Pos {
  const p = target.pos;
  if (!p || !isPlayable(b, p.r, p.c)) throw new RelicTargetError('This relic needs a target tile');
  return p;
}

/** Angle (0 = 12 o'clock, clockwise) of a cell around a center, used for the Sword's sweep. */
export function sweepAngle(center: Pos, p: Pos): number {
  if (center.r === p.r && center.c === p.c) return -1;
  const a = Math.atan2(p.c - center.c, -(p.r - center.r));
  return (a + Math.PI * 2) % (Math.PI * 2);
}

function diagonals(b: BoardState, p: Pos): number[] {
  const out = [idx(b, p.r, p.c)];
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    for (let k = 1; ; k++) {
      const r = p.r + dr * k;
      const c = p.c + dc * k;
      if (r < 0 || c < 0 || r >= b.rows || c >= b.cols) break;
      if (isPlayable(b, r, c)) out.push(idx(b, r, c));
    }
  }
  return out;
}

/**
 * Computes what a relic does to the board. Pure except for `rng`, which only
 * the Catapult consumes. Does not mutate the board.
 */
export function applyRelic(b: BoardState, relicId: string, target: RelicTarget, rng: Rng): RelicApplication {
  const mk = (cells: number[], extra: Partial<Fx & { kind: 'relic' }> = {}): RelicApplication => {
    const uniq = [...new Set(cells)].filter((i) => b.tiles[i]);
    return { cells: uniq, fx: [{ kind: 'relic', relicId, ...extra, cells: uniq.map((i) => posOf(b, i)) } as Fx] };
  };
  switch (relicId) {
    case 'sling_stone': {
      const p = need(target, b);
      return mk([idx(b, p.r, p.c)], { target: p });
    }
    case 'torch': {
      const p = need(target, b);
      const cells = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
        .map(([dr, dc]) => ({ r: p.r + dr, c: p.c + dc }))
        .filter((q) => isPlayable(b, q.r, q.c))
        .map((q) => idx(b, q.r, q.c));
      return mk(cells, { target: p });
    }
    case 'war_horn':
      return { cells: [], fx: [{ kind: 'relic', relicId, cells: [] }], movesDelta: 3 };
    case 'spear': {
      const p = need(target, b);
      const axis = target.axis ?? 'row';
      return mk(axis === 'row' ? rowCells(b, p.r) : colCells(b, p.c), { target: p, axis });
    }
    case 'sword': {
      const p = need(target, b);
      const cells = areaCells(b, p, 1).sort((x, y) => sweepAngle(p, posOf(b, x)) - sweepAngle(p, posOf(b, y)));
      return mk(cells, { target: p });
    }
    case 'fire_arrow': {
      const p = need(target, b);
      return mk(diagonals(b, p), { target: p });
    }
    case 'war_hammer':
      return mk(cellsOfType(b, 'stone'));
    case 'catapult': {
      // Three boulders aimed at random 3×3 clusters (centers kept off the very edge where possible).
      const centers: Pos[] = [];
      const candidates = allPlayable(b).map((i) => posOf(b, i)).filter((q) => q.r > 0 && q.c > 0 && q.r < b.rows - 1 && q.c < b.cols - 1);
      const pool = candidates.length >= 3 ? candidates : allPlayable(b).map((i) => posOf(b, i));
      for (let k = 0; k < 3 && pool.length; k++) centers.push(pool.splice(rng.int(pool.length), 1)[0]);
      const cells = centers.flatMap((c) => areaCells(b, c, 1));
      const app = mk(cells);
      app.fx.push(...centers.map((center) => ({ kind: 'blast', center, radius: 1 }) as Fx));
      return app;
    }
    case 'shield_wall':
      return { cells: [], fx: [{ kind: 'relic', relicId, cells: [] }], freeMoves: 3 };
    case 'twin_axes': {
      const p = need(target, b);
      return mk([...rowCells(b, p.r), ...colCells(b, p.c)], { target: p });
    }
    case 'warlords_banner': {
      const type = target.tileType;
      if (!type || !b.tileTypes.includes(type)) throw new RelicTargetError('Pick a tile type');
      const cells = cellsOfType(b, type);
      const app = mk(cells, { tileType: type });
      app.convert = app.cells;
      return app;
    }
    case 'dragonfire_blade':
      return mk(allPlayable(b));
    default:
      throw new RelicTargetError(`Unknown relic ${relicId}`);
  }
}

/** Converts tiles to Powder Kegs in place (mutates). Returns the converted tiles for rendering. */
export function convertToKegs(b: BoardState, cells: number[]): ClearedTile[] {
  return cells
    .filter((i) => b.tiles[i])
    .map((i) => {
      b.tiles[i] = { ...b.tiles[i]!, special: 'keg' };
      return { pos: posOf(b, i), tile: b.tiles[i]! };
    });
}
