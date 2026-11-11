import { describe, expect, it } from 'vitest';
import {
  applyGravity, computeClear, createBoard, findMatchGroups, findRuns, findValidMove, idx, resolveBoard, shuffleBoard, trySwap,
} from '../board';
import { createRng } from '../rng';
import { boardFrom, setSpecial, TYPES } from './helpers';

describe('match detection', () => {
  it('finds a horizontal 3', () => {
    const b = boardFrom(['SSSW', 'WFIA', 'AHFI']);
    const g = findMatchGroups(b);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe('plain');
    expect(g[0].cells.sort()).toEqual([0, 1, 2]);
  });

  it('finds a vertical 3', () => {
    const b = boardFrom(['SWF', 'SIA', 'SHF']);
    const g = findMatchGroups(b);
    expect(g).toHaveLength(1);
    expect(g[0].runs[0].dir).toBe('v');
  });

  it('classifies 4 in a row as a row axe and 4 in a column as a column axe', () => {
    expect(findMatchGroups(boardFrom(['SSSS', 'WFIA']))[0].kind).toBe('axeRow');
    expect(findMatchGroups(boardFrom(['SW', 'SF', 'SI', 'SA']))[0].kind).toBe('axeCol');
  });

  it('classifies 5 in a line as a War Drum', () => {
    expect(findMatchGroups(boardFrom(['SSSSS', 'WFIAH']))[0].kind).toBe('drum');
  });

  it('classifies L and T shapes as Powder Kegs', () => {
    const L = boardFrom(['SWF', 'SIA', 'SSS']);
    const gl = findMatchGroups(L);
    expect(gl).toHaveLength(1);
    expect(gl[0].kind).toBe('keg');
    expect(gl[0].cells).toHaveLength(5);
    const T = boardFrom(['SSS', 'WSA', 'FSI']);
    const gt = findMatchGroups(T);
    expect(gt[0].kind).toBe('keg');
    expect(gt[0].cells).toHaveLength(5);
  });

  it('blocked cells break runs', () => {
    expect(findRuns(boardFrom(['SS#SS', 'WFIAH']))).toHaveLength(0);
  });

  it('War Drums never line-match', () => {
    expect(findRuns(boardFrom(['DDD', 'WFI']))).toHaveLength(0);
  });
});

describe('board generation', () => {
  it('creates boards with no matches and at least one move', () => {
    for (let s = 1; s <= 200; s++) {
      const b = createBoard({ rows: 8, cols: 8, tileTypes: TYPES }, createRng(s));
      expect(findRuns(b)).toHaveLength(0);
      expect(findValidMove(b)).not.toBeNull();
      expect(b.tiles.every((t) => t)).toBe(true);
    }
  });

  it('respects blocked cells', () => {
    const b = createBoard({ rows: 8, cols: 8, tileTypes: TYPES, blocked: [{ r: 0, c: 0 }, { r: 3, c: 3 }] }, createRng(7));
    expect(b.tiles[idx(b, 0, 0)]).toBeNull();
    expect(b.tiles[idx(b, 3, 3)]).toBeNull();
  });
});

describe('swapping', () => {
  it('rejects swaps that make no match and leaves the board unchanged', () => {
    const b = boardFrom(['SWF', 'IAH', 'WFI']);
    const before = JSON.stringify(b.tiles);
    expect(trySwap(b, { r: 0, c: 0 }, { r: 0, c: 1 }, createRng(1)).valid).toBe(false);
    expect(JSON.stringify(b.tiles)).toBe(before);
  });

  it('rejects non-adjacent swaps', () => {
    const b = boardFrom(['SWS', 'IAH', 'WFI']);
    expect(trySwap(b, { r: 0, c: 0 }, { r: 1, c: 1 }, createRng(1)).valid).toBe(false);
  });

  it('accepts a swap that makes a match and clears it', () => {
    const b = boardFrom(['SWSS', 'IAHF', 'WFIA']);
    const res = trySwap(b, { r: 0, c: 0 }, { r: 0, c: 1 }, createRng(1));
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(res.steps[0].cleared.map((c) => c.pos.c).sort()).toEqual([1, 2, 3]);
    expect(res.steps[0].collected.stone).toBe(3);
    expect(b.tiles.every((t) => t)).toBe(true);
  });

  it('creates a Battle Axe at the swapped cell for a 4-match', () => {
    const b = boardFrom(['SSWS', 'IAST', 'WFIA'].map((s) => s.replace('T', 'H')));
    // move S at (1,2) up to (0,2)
    const res = trySwap(b, { r: 1, c: 2 }, { r: 0, c: 2 }, createRng(3));
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(res.steps[0].created).toHaveLength(1);
    expect(res.steps[0].created[0].tile.special).toBe('axeRow');
    expect(res.steps[0].created[0].pos).toEqual({ r: 0, c: 2 });
  });

  it('War Drum swap clears every tile of the swapped type', () => {
    const b = boardFrom(['DWSF', 'WIWA', 'HFWI']);
    const res = trySwap(b, { r: 0, c: 0 }, { r: 0, c: 1 }, createRng(1));
    expect(res.valid).toBe(true);
    if (!res.valid) return;
    const first = res.steps[0];
    expect(first.cleared.filter((c) => c.tile.type === 'wood')).toHaveLength(4);
    expect(first.cleared.some((c) => c.tile.special === 'drum')).toBe(true);
  });
});

describe('specials', () => {
  it('row axe clears its whole row when cleared', () => {
    const b = boardFrom(['SWFI', 'IAHF', 'WFIA']);
    setSpecial(b, 1, 1, 'axeRow');
    const res = computeClear(b, [idx(b, 1, 1)], createRng(1));
    expect(res.cleared.sort()).toEqual([4, 5, 6, 7]);
  });

  it('powder keg clears 3×3 and chains into other specials', () => {
    const b = boardFrom(['SWFIA', 'IAHFW', 'WFIAH', 'HSWFI']);
    setSpecial(b, 1, 1, 'keg');
    setSpecial(b, 2, 2, 'axeCol');
    const res = computeClear(b, [idx(b, 1, 1)], createRng(1));
    // 3×3 around (1,1) = 9 cells, plus column 2 adds (3,2)
    expect(res.cleared).toHaveLength(10);
    expect(res.cleared).toContain(idx(b, 3, 2));
  });
});

describe('gravity and cascades', () => {
  it('drops tiles down and refills from the top', () => {
    const b = boardFrom(['S', '.', 'W', '.']);
    const { falls, spawns } = applyGravity(b, createRng(1));
    expect(falls).toEqual([
      { tileId: 2, from: { r: 2, c: 0 }, to: { r: 3, c: 0 } },
      { tileId: 1, from: { r: 0, c: 0 }, to: { r: 2, c: 0 } },
    ]);
    expect(spawns).toHaveLength(2);
    expect(spawns.map((s) => s.to.r)).toEqual([0, 1]);
    expect(b.tiles.every((t) => t)).toBe(true);
  });

  it('tiles fall through blocked cells', () => {
    const b = boardFrom(['S', '#', '.']);
    applyGravity(b, createRng(1));
    expect(b.tiles[2]!.type).toBe('stone');
  });

  it('resolves a guaranteed cascade with a score multiplier', () => {
    // Clearing the S row drops W onto two Ws in column 0 -> second step.
    const b = boardFrom(['WIF', 'SSS', 'WAH', 'WHA']);
    const steps = resolveBoard(b, createRng(5));
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].cleared).toHaveLength(3);
    expect(steps[0].score).toBe(30);
    expect(steps[1].cleared.filter((c) => c.tile.type === 'wood').length).toBeGreaterThanOrEqual(3);
    expect(steps[1].score).toBeGreaterThanOrEqual(60);
    expect(findRuns(b)).toHaveLength(0);
  });
});

describe('burials', () => {
  it('reveals a depth-1 burial when the tile above it clears', () => {
    const b = boardFrom(['SSSW', 'WFIA']);
    b.burials[idx(b, 0, 1)] = { id: 'b1', depth: 1, remaining: 1 };
    const steps = resolveBoard(b, createRng(1));
    expect(steps[0].burialHits).toEqual([{ burialId: 'b1', pos: { r: 0, c: 1 }, remaining: 0, revealed: true }]);
    expect(b.burials[idx(b, 0, 1)]).toBeNull();
  });

  it('deep burials need two clears', () => {
    const b = boardFrom(['SSSW', 'WFIA']);
    b.burials[idx(b, 0, 1)] = { id: 'b1', depth: 2, remaining: 2 };
    const steps = resolveBoard(b, createRng(1));
    expect(steps[0].burialHits[0]).toMatchObject({ remaining: 1, revealed: false });
    expect(b.burials[idx(b, 0, 1)]!.remaining).toBe(1);
  });
});

describe('shuffle', () => {
  it('produces a board with a valid move and no matches', () => {
    const b = boardFrom(['SWFI', 'AHSW', 'FIAH', 'SWFI']);
    shuffleBoard(b, createRng(3));
    expect(findValidMove(b)).not.toBeNull();
    expect(findRuns(b)).toHaveLength(0);
  });
});
