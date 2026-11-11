import { emptyBoard, idx } from '../board';
import type { BoardState, SpecialKind } from '../types';

export const TYPES = ['stone', 'wood', 'fire', 'iron', 'water', 'hide'];
const CODE: Record<string, string> = { S: 'stone', W: 'wood', F: 'fire', I: 'iron', A: 'water', H: 'hide' };

/**
 * Builds a board from strings. Letters: S W F I A H. Lowercase = no special.
 * Suffixes after a letter are not supported; use setSpecial(). '#' = blocked, '.' = empty.
 */
export function boardFrom(rows: string[]): BoardState {
  const grid = rows.map((r) => r.replace(/\s+/g, ''));
  const b = emptyBoard({ rows: grid.length, cols: grid[0].length, tileTypes: TYPES });
  grid.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      const i = idx(b, r, c);
      if (ch === '#') b.blocked[i] = true;
      else if (ch === 'D') b.tiles[i] = { id: b.nextId++, type: null, special: 'drum' };
      else if (ch !== '.') b.tiles[i] = { id: b.nextId++, type: CODE[ch] };
    }),
  );
  return b;
}

export function setSpecial(b: BoardState, r: number, c: number, s: SpecialKind) {
  b.tiles[idx(b, r, c)]!.special = s;
}

export function typesOf(b: BoardState): string[] {
  const inv = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
  const out: string[] = [];
  for (let r = 0; r < b.rows; r++) {
    let s = '';
    for (let c = 0; c < b.cols; c++) {
      const i = idx(b, r, c);
      const t = b.tiles[i];
      s += b.blocked[i] ? '#' : !t ? '.' : t.special === 'drum' ? 'D' : inv[t.type!];
    }
    out.push(s);
  }
  return out;
}
