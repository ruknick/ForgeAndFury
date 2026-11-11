import type { LevelDef } from '../game';
import l1 from './level1.json';
import l2 from './level2.json';
import l3 from './level3.json';
import l4 from './level4.json';
import l5 from './level5.json';
import l6 from './level6.json';

/** Level 0 is the endless sandbox board from milestone M1. */
export const ENDLESS: LevelDef = {
  id: 0,
  name: 'Endless Training',
  intro: 'No goal, no limit. Practice your swaps.',
  rows: 8,
  cols: 8,
  blocked: [],
  moves: 9999,
  objective: { type: 'score', score: 99999999 },
  burials: { mode: 'random', count: 0, depth: 1 },
  dropTableOverride: null,
  stars: [5000, 15000, 40000],
};

export const LEVELS: LevelDef[] = [l1, l2, l3, l4, l5, l6] as LevelDef[];

export function getLevel(id: number): LevelDef | undefined {
  return id === 0 ? ENDLESS : LEVELS.find((l) => l.id === id);
}
