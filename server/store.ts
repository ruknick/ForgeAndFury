import fs from 'node:fs';
import path from 'node:path';
import type { BurialConfig, PlacedBurial } from '../shared/game';
import type { RelicInstance } from '../shared/types';

export interface Player {
  id: string;
  name: string;
  createdAt: string;
  /** DEV ONLY: server-held Testnet wallet (spec §8.2). Never do this on Mainnet. */
  wallet?: { address: string; seed: string };
  progress: Record<string, { stars: number; bestScore: number }>;
}

export interface Session {
  id: string;
  playerId: string;
  levelId: number;
  seed: number;
  burials: PlacedBurial[];
  /** Server-only: forced drops keyed by burial id. */
  guaranteed: Record<string, NonNullable<BurialConfig['guaranteed']>[number]>;
  /** burialId -> relic instanceId */
  revealed: Record<string, string>;
  usedInstances: string[];
  status: 'active' | 'finished';
  createdAt: string;
}

export interface DB {
  players: Record<string, Player>;
  relics: Record<string, RelicInstance>;
  sessions: Record<string, Session>;
  stats: { minted: Record<string, number>; burned: Record<string, number>; found: Record<string, number> };
}

const empty = (): DB => ({ players: {}, relics: {}, sessions: {}, stats: { minted: {}, burned: {}, found: {} } });

/**
 * JSON-file store (spec §3 allows this for the prototype). Writes are atomic
 * (write temp + rename). Swap for SQLite when it matters.
 */
export class Store {
  db: DB;
  constructor(private file: string | null) {
    this.db = empty();
    if (file && fs.existsSync(file)) this.db = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  bump(kind: keyof DB['stats'], relicId: string) {
    this.db.stats[kind][relicId] = (this.db.stats[kind][relicId] ?? 0) + 1;
  }
}
