/**
 * Pure match-3 board logic. No rendering, no I/O. Everything that changes the
 * board returns a list of `Step`s that describe what happened so the client
 * can animate it, and so the server can replay a move log deterministically.
 */
import { pickWeighted, type Rng } from './rng';
import type { BoardState, Burial, BurialHit, ClearedTile, Fx, Pos, SpecialKind, Step, Tile, TileType, WallHit } from './types';

export const SCORE_PER_TILE = 10;
export const SCORE_PER_SPECIAL = 30;

// ---------------------------------------------------------------- helpers

export const idx = (b: BoardState, r: number, c: number) => r * b.cols + c;
export const posOf = (b: BoardState, i: number): Pos => ({ r: Math.floor(i / b.cols), c: i % b.cols });
export const inBounds = (b: BoardState, r: number, c: number) => r >= 0 && r < b.rows && c >= 0 && c < b.cols;
export const isPlayable = (b: BoardState, r: number, c: number) => inBounds(b, r, c) && !b.blocked[idx(b, r, c)];

export function tileAt(b: BoardState, r: number, c: number): Tile | null {
  return isPlayable(b, r, c) ? b.tiles[idx(b, r, c)] : null;
}

/** Type that participates in line matches at (r,c), or null (empty, blocked, War Drum). */
function matchTypeAt(b: BoardState, r: number, c: number): TileType | null {
  const t = tileAt(b, r, c);
  return t && t.special !== 'drum' ? t.type : null;
}

export function newTile(b: BoardState, type: TileType | null, special?: SpecialKind): Tile {
  const t: Tile = { id: b.nextId++, type };
  if (special) t.special = special;
  return t;
}

function randomType(b: BoardState, rng: Rng, exclude?: Set<TileType>): TileType {
  let pool = b.tileTypes.map((t, i) => ({ t, w: b.tileWeights[i] ?? 1 }));
  if (exclude && exclude.size) {
    const filtered = pool.filter((p) => !exclude.has(p.t));
    if (filtered.length) pool = filtered;
  }
  return pickWeighted(pool, (p) => p.w, rng.next()).t;
}

export function cloneBoard(b: BoardState): BoardState {
  return {
    ...b,
    blocked: [...b.blocked],
    tiles: b.tiles.map((t) => (t ? { ...t } : null)),
    burials: b.burials.map((x) => (x ? { ...x } : null)),
    walls: [...b.walls],
    tileTypes: [...b.tileTypes],
    tileWeights: [...b.tileWeights],
  };
}

export function allPlayable(b: BoardState): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.tiles.length; i++) if (!b.blocked[i]) out.push(i);
  return out;
}

// ---------------------------------------------------------------- creation

export interface BoardOptions {
  rows: number;
  cols: number;
  blocked?: Pos[];
  tileTypes: TileType[];
  tileWeights?: number[];
  burials?: { id: string; pos: Pos; depth: number }[];
  walls?: { r: number; c: number; hp?: number }[];
}

export function emptyBoard(opts: BoardOptions): BoardState {
  const n = opts.rows * opts.cols;
  const b: BoardState = {
    rows: opts.rows,
    cols: opts.cols,
    blocked: new Array(n).fill(false),
    tiles: new Array(n).fill(null),
    burials: new Array(n).fill(null),
    walls: new Array(n).fill(0),
    tileTypes: [...opts.tileTypes],
    tileWeights: opts.tileWeights ? [...opts.tileWeights] : opts.tileTypes.map(() => 1),
    nextId: 1,
  };
  for (const p of opts.blocked ?? []) b.blocked[idx(b, p.r, p.c)] = true;
  for (const w of opts.walls ?? []) {
    const i = idx(b, w.r, w.c);
    b.walls[i] = Math.max(1, w.hp ?? 1);
    b.blocked[i] = true; // walls block play until broken
  }
  for (const bur of opts.burials ?? []) {
    const i = idx(b, bur.pos.r, bur.pos.c);
    if (b.blocked[i]) throw new Error(`Burial ${bur.id} placed on blocked cell`);
    b.burials[i] = { id: bur.id, depth: bur.depth, remaining: bur.depth } satisfies Burial;
  }
  return b;
}

/** Fill every empty playable cell without creating any line of 3. */
function fillNoMatches(b: BoardState, rng: Rng) {
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      if (!isPlayable(b, r, c) || b.tiles[idx(b, r, c)]) continue;
      const exclude = new Set<TileType>();
      const l1 = matchTypeAt(b, r, c - 1);
      if (l1 && l1 === matchTypeAt(b, r, c - 2)) exclude.add(l1);
      const u1 = matchTypeAt(b, r - 1, c);
      if (u1 && u1 === matchTypeAt(b, r - 2, c)) exclude.add(u1);
      // Also look right/down so this works for partially-filled boards.
      const r1 = matchTypeAt(b, r, c + 1);
      if (r1 && r1 === matchTypeAt(b, r, c + 2)) exclude.add(r1);
      if (l1 && l1 === r1) exclude.add(l1);
      const d1 = matchTypeAt(b, r + 1, c);
      if (d1 && d1 === matchTypeAt(b, r + 2, c)) exclude.add(d1);
      if (u1 && u1 === d1) exclude.add(u1);
      b.tiles[idx(b, r, c)] = newTile(b, randomType(b, rng, exclude));
    }
  }
}

/** A fresh board with no pre-made matches and at least one valid move (spec §4.1). */
export function createBoard(opts: BoardOptions, rng: Rng): BoardState {
  if (opts.tileTypes.length < 3) throw new Error('Need at least 3 tile types');
  for (let attempt = 0; attempt < 200; attempt++) {
    const b = emptyBoard(opts);
    fillNoMatches(b, rng);
    if (findRuns(b).length === 0 && findValidMove(b)) return b;
  }
  throw new Error('Could not generate a playable board');
}

// ---------------------------------------------------------------- matching

export interface Run {
  cells: number[];
  dir: 'h' | 'v';
  type: TileType;
}

export function findRuns(b: BoardState): Run[] {
  const runs: Run[] = [];
  for (let r = 0; r < b.rows; r++) {
    let c = 0;
    while (c < b.cols) {
      const t = matchTypeAt(b, r, c);
      let e = c + 1;
      if (t) while (e < b.cols && matchTypeAt(b, r, e) === t) e++;
      if (t && e - c >= 3) runs.push({ dir: 'h', type: t, cells: range(c, e).map((x) => idx(b, r, x)) });
      c = e;
    }
  }
  for (let c = 0; c < b.cols; c++) {
    let r = 0;
    while (r < b.rows) {
      const t = matchTypeAt(b, r, c);
      let e = r + 1;
      if (t) while (e < b.rows && matchTypeAt(b, e, c) === t) e++;
      if (t && e - r >= 3) runs.push({ dir: 'v', type: t, cells: range(r, e).map((y) => idx(b, y, c)) });
      r = e;
    }
  }
  return runs;
}

export type MatchKind = 'plain' | SpecialKind;

export interface MatchGroup {
  cells: number[];
  runs: Run[];
  type: TileType;
  kind: MatchKind;
}

/**
 * Groups runs that share a cell (L and T shapes) and classifies each group:
 * 5+ in a line → War Drum, L/T → Powder Keg, 4 in a line → Battle Axe.
 * A horizontal 4 makes an axe that clears its row; a vertical 4 clears its column.
 */
export function findMatchGroups(b: BoardState): MatchGroup[] {
  const runs = findRuns(b);
  if (!runs.length) return [];
  const parent = runs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map<number, number>();
  runs.forEach((run, ri) => {
    for (const cell of run.cells) {
      const prev = owner.get(cell);
      if (prev !== undefined) parent[find(ri)] = find(prev);
      else owner.set(cell, ri);
    }
  });
  const byRoot = new Map<number, Run[]>();
  runs.forEach((run, ri) => {
    const root = find(ri);
    byRoot.set(root, [...(byRoot.get(root) ?? []), run]);
  });
  const groups: MatchGroup[] = [];
  for (const rs of byRoot.values()) {
    const cells = [...new Set(rs.flatMap((r) => r.cells))];
    const maxLen = Math.max(...rs.map((r) => r.cells.length));
    const hasH = rs.some((r) => r.dir === 'h');
    const hasV = rs.some((r) => r.dir === 'v');
    let kind: MatchKind = 'plain';
    if (maxLen >= 5) kind = 'drum';
    else if (hasH && hasV) kind = 'keg';
    else if (maxLen === 4) kind = rs[0].dir === 'h' ? 'axeRow' : 'axeCol';
    groups.push({ cells, runs: rs, type: rs[0].type, kind });
  }
  return groups;
}

function pivotOf(g: MatchGroup, prefer: number[]): number {
  for (const p of prefer) if (g.cells.includes(p)) return p;
  if (g.kind === 'keg') {
    const h = new Set(g.runs.filter((r) => r.dir === 'h').flatMap((r) => r.cells));
    const cross = g.runs.filter((r) => r.dir === 'v').flatMap((r) => r.cells).find((c) => h.has(c));
    if (cross !== undefined) return cross;
  }
  const longest = g.runs.reduce((a, r) => (r.cells.length > a.cells.length ? r : a));
  return longest.cells[Math.floor((longest.cells.length - 1) / 2)];
}

// ---------------------------------------------------------------- clearing

export function rowCells(b: BoardState, r: number): number[] {
  return range(0, b.cols).filter((c) => isPlayable(b, r, c)).map((c) => idx(b, r, c));
}
export function colCells(b: BoardState, c: number): number[] {
  return range(0, b.rows).filter((r) => isPlayable(b, r, c)).map((r) => idx(b, r, c));
}
export function areaCells(b: BoardState, center: Pos, radius: number): number[] {
  const out: number[] = [];
  for (let r = center.r - radius; r <= center.r + radius; r++)
    for (let c = center.c - radius; c <= center.c + radius; c++) if (isPlayable(b, r, c)) out.push(idx(b, r, c));
  return out;
}
export function cellsOfType(b: BoardState, type: TileType): number[] {
  return allPlayable(b).filter((i) => b.tiles[i]?.type === type && b.tiles[i]?.special !== 'drum');
}

/**
 * Expands a set of seed cells through special-tile chain reactions.
 * `skip` holds cells whose special effect was already applied (e.g. a swapped War Drum).
 */
export function computeClear(b: BoardState, seeds: number[], rng: Rng, skip: Set<number> = new Set()) {
  const cleared = new Set<number>();
  const fx: Fx[] = [];
  const queue = [...seeds];
  while (queue.length) {
    const i = queue.shift()!;
    if (cleared.has(i) || b.blocked[i] || !b.tiles[i]) continue;
    cleared.add(i);
    const t = b.tiles[i]!;
    if (!t.special || skip.has(i)) continue;
    const p = posOf(b, i);
    switch (t.special) {
      case 'axeRow':
        fx.push({ kind: 'row', r: p.r, from: p });
        queue.push(...rowCells(b, p.r));
        break;
      case 'axeCol':
        fx.push({ kind: 'col', c: p.c, from: p });
        queue.push(...colCells(b, p.c));
        break;
      case 'keg':
        fx.push({ kind: 'blast', center: p, radius: 1 });
        queue.push(...areaCells(b, p, 1));
        break;
      case 'drum': {
        // Set off by another effect: beat the drum for a random type still on the board.
        const present = [...new Set(allPlayable(b).filter((x) => !cleared.has(x)).map((x) => b.tiles[x]?.type).filter((x): x is TileType => !!x))];
        if (!present.length) break;
        const type = present[rng.int(present.length)];
        const cells = cellsOfType(b, type);
        fx.push({ kind: 'drum', from: p, type, cells: cells.map((x) => posOf(b, x)) });
        queue.push(...cells);
        break;
      }
    }
  }
  return { cleared: [...cleared], fx };
}

// ---------------------------------------------------------------- gravity

export function applyGravity(b: BoardState, rng: Rng): Pick<Step, 'falls' | 'spawns'> {
  const falls: Step['falls'] = [];
  const spawns: Step['spawns'] = [];
  for (let c = 0; c < b.cols; c++) {
    const rows = range(0, b.rows).filter((r) => isPlayable(b, r, c));
    let w = rows.length - 1;
    for (let k = rows.length - 1; k >= 0; k--) {
      const i = idx(b, rows[k], c);
      const t = b.tiles[i];
      if (!t) continue;
      if (k !== w) {
        b.tiles[idx(b, rows[w], c)] = t;
        b.tiles[i] = null;
        falls.push({ tileId: t.id, from: { r: rows[k], c }, to: { r: rows[w], c } });
      }
      w--;
    }
    const count = w + 1;
    for (let k = 0; k <= w; k++) {
      const tile = newTile(b, randomType(b, rng));
      b.tiles[idx(b, rows[k], c)] = tile;
      spawns.push({ tile, to: { r: rows[k], c }, fromRow: rows[k] - count });
    }
  }
  return { falls, spawns };
}

// ---------------------------------------------------------------- resolution

export interface ResolveOptions {
  /** Extra cells to clear in the first step (relics, War Drum swaps, special+special swaps). */
  initial?: { cells: number[]; fx?: Fx[]; skip?: number[]; converted?: ClearedTile[] };
  /** Preferred cells for placing newly created specials (the swapped cells). */
  prefer?: number[];
}

/** Clears matches/effects, applies gravity and refill, and repeats until stable (cascades). */
export function resolveBoard(b: BoardState, rng: Rng, opts: ResolveOptions = {}): Step[] {
  const steps: Step[] = [];
  let prefer = opts.prefer ?? [];
  for (let cascade = 0; cascade < 100; cascade++) {
    const groups = findMatchGroups(b);
    const seeds: number[] = [];
    const fx: Fx[] = [];
    let skip = new Set<number>();
    let converted: ClearedTile[] = [];
    if (cascade === 0 && opts.initial) {
      seeds.push(...opts.initial.cells);
      fx.push(...(opts.initial.fx ?? []));
      skip = new Set(opts.initial.skip ?? []);
      converted = opts.initial.converted ?? [];
    }
    if (!groups.length && !seeds.length) break;

    const creations: { i: number; kind: SpecialKind; type: TileType | null }[] = [];
    for (const g of groups) {
      seeds.push(...g.cells);
      if (g.kind !== 'plain') {
        const i = pivotOf(g, prefer);
        if (!creations.some((c) => c.i === i)) creations.push({ i, kind: g.kind, type: g.kind === 'drum' ? null : g.type });
      }
    }
    const res = computeClear(b, seeds, rng, skip);
    fx.push(...res.fx);

    const cleared: ClearedTile[] = [];
    const burialHits: BurialHit[] = [];
    const collected: Record<TileType, number> = {};
    for (const i of res.cleared) {
      const tile = b.tiles[i]!;
      const pos = posOf(b, i);
      cleared.push({ pos, tile });
      if (tile.type) collected[tile.type] = (collected[tile.type] ?? 0) + 1;
      b.tiles[i] = null;
      const bur = b.burials[i];
      if (bur && bur.remaining > 0) {
        bur.remaining--;
        const revealed = bur.remaining === 0;
        burialHits.push({ burialId: bur.id, pos, remaining: bur.remaining, revealed });
        if (revealed) b.burials[i] = null;
      }
    }
    // Walls take one hit per step from any orthogonally adjacent cleared tile ("matched next to").
    const wallHits: WallHit[] = [];
    const hitWalls = new Set<number>();
    for (const i of res.cleared) {
      const { r, c } = posOf(b, i);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (!inBounds(b, r + dr, c + dc)) continue;
        const j = idx(b, r + dr, c + dc);
        if (b.walls[j] > 0) hitWalls.add(j);
      }
    }
    for (const j of hitWalls) {
      b.walls[j]--;
      if (b.walls[j] === 0) b.blocked[j] = false; // opens up; gravity fills it below
      wallHits.push({ pos: posOf(b, j), remaining: b.walls[j] });
    }
    const created: ClearedTile[] = [];
    for (const cr of creations) {
      if (b.tiles[cr.i]) continue;
      const tile = newTile(b, cr.type, cr.kind);
      b.tiles[cr.i] = tile;
      created.push({ pos: posOf(b, cr.i), tile });
    }
    const score = cleared.length * SCORE_PER_TILE * (cascade + 1) + created.length * SCORE_PER_SPECIAL;
    const { falls, spawns } = applyGravity(b, rng);
    steps.push({ cleared, created, converted, fx, burialHits, wallHits, falls, spawns, score: score + wallHits.length * SCORE_PER_SPECIAL, collected });
    prefer = [...falls.map((f) => idx(b, f.to.r, f.to.c)), ...spawns.map((s) => idx(b, s.to.r, s.to.c))];
  }
  return steps;
}

// ---------------------------------------------------------------- swapping

export function areAdjacent(a: Pos, b: Pos) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function swapCells(b: BoardState, i: number, j: number) {
  const t = b.tiles[i];
  b.tiles[i] = b.tiles[j];
  b.tiles[j] = t;
}

export type SwapResult = { valid: false } | { valid: true; steps: Step[] };

export function trySwap(b: BoardState, a: Pos, c: Pos, rng: Rng): SwapResult {
  if (!areAdjacent(a, c) || !isPlayable(b, a.r, a.c) || !isPlayable(b, c.r, c.c)) return { valid: false };
  const ia = idx(b, a.r, a.c);
  const ic = idx(b, c.r, c.c);
  const ta = b.tiles[ia];
  const tc = b.tiles[ic];
  if (!ta || !tc) return { valid: false };
  swapCells(b, ia, ic); // ta now at ic, tc now at ia

  if (ta.special === 'drum' || tc.special === 'drum') {
    const drumIdx = ta.special === 'drum' ? ic : ia;
    const otherIdx = drumIdx === ic ? ia : ic;
    const other = b.tiles[otherIdx]!;
    let cells: number[];
    let type: TileType | null = null;
    if (other.special === 'drum') {
      cells = allPlayable(b); // drum + drum: clear the whole board
    } else {
      type = other.type;
      cells = [drumIdx, otherIdx, ...(type ? cellsOfType(b, type) : [])];
    }
    const fx: Fx[] = [{ kind: 'drum', from: posOf(b, drumIdx), type, cells: cells.map((x) => posOf(b, x)) }];
    const skip = other.special === 'drum' ? [drumIdx, otherIdx] : [drumIdx];
    return { valid: true, steps: resolveBoard(b, rng, { initial: { cells, fx, skip } }) };
  }
  if (ta.special && tc.special) {
    return { valid: true, steps: resolveBoard(b, rng, { initial: { cells: [ia, ic] }, prefer: [ic, ia] }) };
  }
  if (!lineThrough(b, ia) && !lineThrough(b, ic)) {
    swapCells(b, ia, ic);
    return { valid: false };
  }
  return { valid: true, steps: resolveBoard(b, rng, { prefer: [ic, ia] }) };
}

/** True if cell i is part of a horizontal or vertical line of 3+. */
function lineThrough(b: BoardState, i: number): boolean {
  const { r, c } = posOf(b, i);
  const t = matchTypeAt(b, r, c);
  if (!t) return false;
  let h = 1;
  for (let x = c - 1; matchTypeAt(b, r, x) === t; x--) h++;
  for (let x = c + 1; matchTypeAt(b, r, x) === t; x++) h++;
  if (h >= 3) return true;
  let v = 1;
  for (let y = r - 1; matchTypeAt(b, y, c) === t; y--) v++;
  for (let y = r + 1; matchTypeAt(b, y, c) === t; y++) v++;
  return v >= 3;
}

/** Returns a valid swap if one exists (also used for hints). */
export function findValidMove(b: BoardState): [Pos, Pos] | null {
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const t = tileAt(b, r, c);
      if (!t) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const o = tileAt(b, r + dr, c + dc);
        if (!o) continue;
        const a = { r, c };
        const z = { r: r + dr, c: c + dc };
        if (t.special === 'drum' || o.special === 'drum' || (t.special && o.special)) return [a, z];
        const i = idx(b, r, c);
        const j = idx(b, z.r, z.c);
        swapCells(b, i, j);
        const ok = lineThrough(b, i) || lineThrough(b, j);
        swapCells(b, i, j);
        if (ok) return [a, z];
      }
    }
  }
  return null;
}

export interface ShuffleResult {
  placements: { tileId: number; to: Pos; type: TileType | null }[];
}

/** Rearranges tiles when no valid move exists. Burials stay with their cells. */
export function shuffleBoard(b: BoardState, rng: Rng): ShuffleResult {
  const cells = allPlayable(b).filter((i) => b.tiles[i]);
  const tiles = cells.map((i) => b.tiles[i]!);
  for (let attempt = 0; attempt < 300; attempt++) {
    for (let k = tiles.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      [tiles[k], tiles[j]] = [tiles[j], tiles[k]];
    }
    cells.forEach((cell, k) => (b.tiles[cell] = tiles[k]));
    if (findRuns(b).length === 0 && findValidMove(b)) return placementsOf(b);
  }
  // Extremely unlikely: re-roll plain tile types in place.
  for (let attempt = 0; attempt < 300; attempt++) {
    for (const cell of cells) if (!b.tiles[cell]!.special) b.tiles[cell] = null;
    fillNoMatchesKeepIds(b, rng, cells, tiles);
    if (findRuns(b).length === 0 && findValidMove(b)) return placementsOf(b);
  }
  throw new Error('Shuffle failed');
}

function fillNoMatchesKeepIds(b: BoardState, rng: Rng, cells: number[], tiles: Tile[]) {
  const plain = tiles.filter((t) => !t.special);
  const nextId = b.nextId;
  fillNoMatches(b, rng);
  let k = 0;
  for (const cell of cells) {
    const t = b.tiles[cell]!;
    if (t.id >= nextId) {
      plain[k].type = t.type;
      b.tiles[cell] = plain[k++];
    }
  }
  b.nextId = nextId;
}

function placementsOf(b: BoardState): ShuffleResult {
  return {
    placements: allPlayable(b)
      .filter((i) => b.tiles[i])
      .map((i) => ({ tileId: b.tiles[i]!.id, to: posOf(b, i), type: b.tiles[i]!.type })),
  };
}

export function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}
