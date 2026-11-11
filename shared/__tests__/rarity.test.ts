import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DROP_TABLE, normalizeTable, rollRarity, rollRelic, type DropTable } from '../rarity';
import { RARITIES, RELICS } from '../relics';
import { createRng } from '../rng';
import type { Rarity } from '../types';

const N = 100_000;
const TOL = 0.01; // ±1 percentage point; std-dev at p=0.6, n=100k is ~0.15pp

function observe(table: DropTable, rand: () => number) {
  const counts: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < N; i++) counts[rollRarity(table, rand)]++;
  return counts;
}

describe('drop rates', () => {
  it(`default table: ${N.toLocaleString()} rolls land within ±${TOL * 100}pp (seeded)`, () => {
    const rng = createRng(12345);
    const counts = observe(DEFAULT_DROP_TABLE, rng.next);
    for (const r of RARITIES) expect(Math.abs(counts[r] / N - DEFAULT_DROP_TABLE[r])).toBeLessThan(TOL);
  });

  it(`default table: ${N.toLocaleString()} rolls land within tolerance (crypto RNG, as the server uses)`, () => {
    const rand = () => randomInt(0, 2 ** 48 - 1) / 2 ** 48;
    const counts = observe(DEFAULT_DROP_TABLE, rand);
    for (const r of RARITIES) expect(Math.abs(counts[r] / N - DEFAULT_DROP_TABLE[r])).toBeLessThan(TOL);
  });

  it('level overrides are respected (boss table)', () => {
    const table = normalizeTable({ common: 0.45, rare: 0.28, epic: 0.17, legendary: 0.1 });
    const counts = observe(table, createRng(99).next);
    expect(Math.abs(counts.legendary / N - 0.1)).toBeLessThan(TOL);
  });

  it('normalizes partial tables', () => {
    const t = normalizeTable({ legendary: 0.5 });
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('rollRelic returns relics of the rolled rarity, and honors guarantees', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const r = rollRelic({ table: DEFAULT_DROP_TABLE, rarity: 'epic' }, rng.next);
      expect(r.rarity).toBe('epic');
    }
    expect(rollRelic({ table: DEFAULT_DROP_TABLE, relicId: 'sword' }, rng.next).id).toBe('sword');
  });

  it('every relic has a unique XRPL taxon', () => {
    expect(new Set(RELICS.map((r) => r.taxon)).size).toBe(RELICS.length);
  });
});
