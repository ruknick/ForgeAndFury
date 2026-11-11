import { RELICS, RARITIES } from './relics';
import type { Rarity, RelicDef } from './types';

export type DropTable = Record<Rarity, number>;

/** Default drop rates (spec §5.3). Published in-game (spec §12). */
export const DEFAULT_DROP_TABLE: DropTable = { common: 0.6, rare: 0.25, epic: 0.12, legendary: 0.03 };

export function normalizeTable(t: Partial<DropTable>): DropTable {
  const full = { ...DEFAULT_DROP_TABLE, ...t };
  const sum = RARITIES.reduce((s, r) => s + Math.max(0, full[r]), 0);
  if (sum <= 0) throw new Error('Drop table has no weight');
  return Object.fromEntries(RARITIES.map((r) => [r, Math.max(0, full[r]) / sum])) as DropTable;
}

/** `rand` returns a float in [0,1). On the server this must be a CSPRNG (see server/rolls.ts). */
export function rollRarity(table: DropTable, rand: () => number): Rarity {
  let x = rand();
  for (const r of RARITIES) {
    x -= table[r];
    if (x < 0) return r;
  }
  return 'common';
}

export function relicsOfRarity(rarity: Rarity, catalogue: RelicDef[] = RELICS): RelicDef[] {
  return catalogue.filter((r) => r.rarity === rarity);
}

export interface RollSpec {
  table: DropTable;
  /** Force a specific relic (e.g. the tutorial Sword drop). */
  relicId?: string;
  /** Force a rarity tier; the relic within it is still random. */
  rarity?: Rarity;
}

export function rollRelic(spec: RollSpec, rand: () => number, catalogue: RelicDef[] = RELICS): RelicDef {
  if (spec.relicId) {
    const r = catalogue.find((x) => x.id === spec.relicId);
    if (!r) throw new Error(`Unknown relic ${spec.relicId}`);
    return r;
  }
  let rarity = spec.rarity ?? rollRarity(spec.table, rand);
  let pool = relicsOfRarity(rarity, catalogue);
  // A tier with no relics falls back toward common so a roll never fails.
  while (!pool.length && rarity !== 'common') {
    rarity = RARITIES[RARITIES.indexOf(rarity) - 1];
    pool = relicsOfRarity(rarity, catalogue);
  }
  return pool[Math.floor(rand() * pool.length)];
}
