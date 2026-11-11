export type TileType = string; // ids from shared/config/tiles.ts (data-driven)
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type SpecialKind = 'axeRow' | 'axeCol' | 'keg' | 'drum';

export interface Pos {
  r: number;
  c: number;
}

export interface Tile {
  id: number;
  /** null only for the War Drum, which has no type and never line-matches. */
  type: TileType | null;
  special?: SpecialKind;
}

export interface Burial {
  id: string;
  depth: number;
  remaining: number;
}

export interface BoardState {
  rows: number;
  cols: number;
  blocked: boolean[];
  tiles: (Tile | null)[];
  burials: (Burial | null)[];
  tileTypes: TileType[];
  tileWeights: number[];
  nextId: number;
}

/** Visual hints for the renderer. Pure logic never depends on these. */
export type Fx =
  | { kind: 'row'; r: number; from: Pos }
  | { kind: 'col'; c: number; from: Pos }
  | { kind: 'blast'; center: Pos; radius: number }
  | { kind: 'drum'; from: Pos; type: TileType | null; cells: Pos[] }
  | { kind: 'relic'; relicId: string; target?: Pos; axis?: 'row' | 'col'; tileType?: TileType; cells: Pos[] };

export interface ClearedTile {
  pos: Pos;
  tile: Tile;
}

export interface BurialHit {
  burialId: string;
  pos: Pos;
  remaining: number;
  revealed: boolean;
}

export interface Step {
  cleared: ClearedTile[];
  created: ClearedTile[];
  converted: ClearedTile[];
  fx: Fx[];
  burialHits: BurialHit[];
  falls: { tileId: number; from: Pos; to: Pos }[];
  spawns: { tile: Tile; to: Pos; fromRow: number }[];
  score: number;
  collected: Record<TileType, number>;
}

export interface RelicDef {
  id: string;
  name: string;
  rarity: Rarity;
  taxon: number;
  targeting: 'none' | 'tile' | 'tile+axis' | 'tileType';
  usesMove: boolean;
  glyph: string;
  effectText: string;
  flavorText: string;
}

export type RelicState = 'in_game' | 'pending_mint' | 'on_chain' | 'consumed';

export interface RelicInstance {
  instanceId: string;
  relicId: string;
  ownerPlayerId: string;
  state: RelicState;
  nftokenId?: string;
  txHashes: string[];
  foundInLevel?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface RelicTarget {
  pos?: Pos;
  axis?: 'row' | 'col';
  tileType?: TileType;
}
