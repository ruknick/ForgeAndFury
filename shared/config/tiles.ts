/**
 * Tile types are data-driven (spec §4.2 OPEN QUESTION): rename, recolor, add or
 * remove entries here and the rest of the game follows. Keep at least 4 types,
 * or "no pre-made matches" generation gets very constrained.
 */
export interface TileTypeDef {
  id: string;
  name: string;
  /** Fill color (hex number) used by the renderer. */
  color: number;
  /** Glyph drawn on the tile. Emoji are fine for the prototype. */
  glyph: string;
  /** Relative spawn weight. Stone is "most common" per the spec. */
  weight: number;
}

export const TILE_TYPES: TileTypeDef[] = [
  { id: 'stone', name: 'Stone', color: 0x8d8f94, glyph: '🪨', weight: 1.3 },
  { id: 'wood', name: 'Wood', color: 0x5f8f3a, glyph: '🪵', weight: 1 },
  { id: 'fire', name: 'Fire', color: 0xe0582a, glyph: '🔥', weight: 1 },
  { id: 'iron', name: 'Iron', color: 0x4f7896, glyph: '⛏️', weight: 1 },
  { id: 'water', name: 'Water', color: 0x2d74d6, glyph: '💧', weight: 1 },
  { id: 'hide', name: 'Hide', color: 0xc9a46b, glyph: '🦴', weight: 1 },
];

export const TILE_TYPE_IDS = TILE_TYPES.map((t) => t.id);

export function tileTypeDef(id: string): TileTypeDef {
  const def = TILE_TYPES.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown tile type: ${id}`);
  return def;
}
