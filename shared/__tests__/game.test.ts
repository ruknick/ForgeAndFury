import { describe, expect, it } from 'vitest';
import { findRuns, findValidMove, idx } from '../board';
import { LevelRun, placeBurials, replayRun, type LevelDef } from '../game';
import { ENDLESS, LEVELS } from '../levels';
import { applyRelic, sweepAngle } from '../relicEffects';
import { RELICS } from '../relics';
import { createRng } from '../rng';
import type { Pos } from '../types';
import { boardFrom } from './helpers';

function allValidMoves(run: LevelRun): [Pos, Pos][] {
  const out: [Pos, Pos][] = [];
  const b = run.board;
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++)
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (r + dr >= b.rows || c + dc >= b.cols) continue;
        out.push([{ r, c }, { r: r + dr, c: c + dc }]);
      }
  return out;
}

/** Plays random valid moves (and occasionally a relic) until the run ends. */
function autoplay(level: LevelDef, seed: number, maxActions = 80) {
  const run = new LevelRun(level, seed, placeBurials(level, createRng(seed ^ 0xabc)));
  const pick = createRng(seed + 1);
  for (let k = 0; k < maxActions && run.status === 'playing'; k++) {
    if (k % 9 === 4 && run.relicsLeft > 0) {
      const relic = RELICS[pick.int(RELICS.length)];
      run.useRelic(relic.id, { pos: { r: 3, c: 3 }, axis: 'col', tileType: 'fire' });
    } else {
      const moves = allValidMoves(run);
      for (let tries = 0; tries < moves.length; tries++) {
        const [a, b] = moves[pick.int(moves.length)];
        if (run.swap(a, b)) break;
      }
    }
    // invariants after every action
    expect(findRuns(run.board)).toHaveLength(0);
    expect(findValidMove(run.board)).not.toBeNull();
    run.board.tiles.forEach((t, i) => expect(!!t).toBe(!run.board.blocked[i]));
  }
  return run;
}

describe('LevelRun', () => {
  it('every level loads and is playable to completion without breaking invariants', () => {
    for (const level of LEVELS) for (let s = 1; s <= 6; s++) autoplay(level, s * 7919);
  });

  it('replaying the action log reproduces the run exactly (server anti-cheat)', () => {
    for (const level of [LEVELS[1], LEVELS[3]]) {
      const burials = placeBurials(level, createRng(4));
      const run = new LevelRun(level, 777, burials);
      const pick = createRng(1);
      for (let k = 0; k < 15 && run.status === 'playing'; k++) {
        if (k === 5) run.useRelic('catapult', {});
        const moves = allValidMoves(run);
        while (!run.swap(...moves[pick.int(moves.length)]));
      }
      const replay = replayRun(level, 777, burials, run.log);
      expect(replay.score).toBe(run.score);
      expect(replay.revealed).toEqual(run.revealed);
      expect(JSON.stringify(replay.board.tiles)).toBe(JSON.stringify(run.board.tiles));
    }
  });

  it('replay rejects a forged log', () => {
    const level = LEVELS[0];
    const burials = placeBurials(level, createRng(1));
    expect(() => replayRun(level, 1, burials, [{ kind: 'swap', a: { r: 0, c: 0 }, b: { r: 5, c: 5 } }])).toThrow();
  });

  it('spends moves, honors Shield Wall and War Horn', () => {
    const run = new LevelRun(ENDLESS, 3, []);
    const start = run.movesLeft;
    run.useRelic('war_horn', {});
    expect(run.movesLeft).toBe(start + 3);
    run.useRelic('shield_wall', {});
    const moves = allValidMoves(run);
    const pick = createRng(2);
    for (let n = 0; n < 4; n++) while (!run.swap(...moves[pick.int(moves.length)]));
    expect(run.movesLeft).toBe(start + 3 - 1); // 3 free, 1 paid
  });

  it('caps relics per level', () => {
    const run = new LevelRun(ENDLESS, 3, [], 3);
    for (let i = 0; i < 3; i++) run.useRelic('war_horn', {});
    expect(run.canUseRelic('war_horn')).toMatch(/limit/i);
    expect(() => run.useRelic('war_horn', {})).toThrow();
  });

  it('wins when the objective is met and loses when moves run out', () => {
    const win = new LevelRun({ ...ENDLESS, objective: { type: 'score', score: 1 } }, 5, []);
    const moves = allValidMoves(win);
    const pick = createRng(3);
    while (!win.swap(...moves[pick.int(moves.length)]));
    expect(win.status).toBe('won');
    expect(win.stars()).toBeGreaterThanOrEqual(1);

    const lose = new LevelRun({ ...ENDLESS, moves: 1, objective: { type: 'score', score: 10 ** 9 } }, 5, []);
    while (!lose.swap(...moves[pick.int(moves.length)]));
    expect(lose.status).toBe('lost');
  });

  it('unearth objective tracks revealed burials', () => {
    const level = LEVELS[3];
    const burials = placeBurials(level, createRng(8));
    expect(burials).toHaveLength(5);
    expect(burials.filter((b) => b.depth === 2)).toHaveLength(1);
    const run = new LevelRun(level, 8, burials);
    run.useRelic('dragonfire_blade', {});
    expect(run.revealed.length).toBe(4); // the deep one needs a second clear
    run.useRelic('dragonfire_blade', {});
    expect(run.revealed.length).toBe(5);
    expect(run.status).toBe('won');
  });
});

describe('relic effects', () => {
  const b = () => boardFrom(['SWFIA', 'IAHFW', 'WFIAH', 'HSWFI', 'AIHWS']);
  const rng = createRng(1);
  const mid = { r: 2, c: 2 };

  it('Sling Stone hits one tile', () => expect(applyRelic(b(), 'sling_stone', { pos: mid }, rng).cells).toHaveLength(1));
  it('Torch hits a plus shape', () => expect(applyRelic(b(), 'torch', { pos: mid }, rng).cells).toHaveLength(5));
  it('Torch at a corner hits 3', () => expect(applyRelic(b(), 'torch', { pos: { r: 0, c: 0 } }, rng).cells).toHaveLength(3));
  it('Spear clears a row or a column', () => {
    expect(applyRelic(b(), 'spear', { pos: mid, axis: 'row' }, rng).cells).toHaveLength(5);
    const bb = b();
    expect(applyRelic(bb, 'spear', { pos: mid, axis: 'col' }, rng).cells.every((i) => i % 5 === 2)).toBe(true);
  });
  it('Sword clears 3×3, ordered as a clockwise sweep', () => {
    const bb = b();
    const app = applyRelic(bb, 'sword', { pos: mid }, rng);
    expect(app.cells).toHaveLength(9);
    expect(app.cells[0]).toBe(idx(bb, 2, 2)); // center first
    expect(app.cells[1]).toBe(idx(bb, 1, 2)); // then 12 o'clock
    const angles = app.cells.slice(1).map((i) => sweepAngle(mid, { r: Math.floor(i / 5), c: i % 5 }));
    expect([...angles].sort((x, y) => x - y)).toEqual(angles);
  });
  it('Fire Arrow clears both diagonals', () => expect(applyRelic(b(), 'fire_arrow', { pos: mid }, rng).cells).toHaveLength(9));
  it('War Hammer hits every Stone', () => expect(applyRelic(b(), 'war_hammer', {}, rng).cells).toHaveLength(3));
  it('Catapult hits up to 3 clusters', () => {
    const app = applyRelic(b(), 'catapult', {}, rng);
    expect(app.cells.length).toBeGreaterThanOrEqual(9);
    expect(app.fx.filter((f) => f.kind === 'blast')).toHaveLength(3);
  });
  it('Twin Axes clears row + column', () => expect(applyRelic(b(), 'twin_axes', { pos: mid }, rng).cells).toHaveLength(9));
  it("Warlord's Banner converts a type to kegs", () => {
    const app = applyRelic(b(), 'warlords_banner', { tileType: 'fire' }, rng);
    expect(app.convert).toHaveLength(4);
  });
  it('Dragonfire Blade clears everything', () => expect(applyRelic(b(), 'dragonfire_blade', {}, rng).cells).toHaveLength(25));
  it('targeted relics require a target', () => expect(() => applyRelic(b(), 'sword', {}, rng)).toThrow());
});

describe('Forge meter', () => {
  it('charges from Iron and Fire, then turns 3 tiles into specials, and replays exactly', async () => {
    const { FORGE } = await import('../config/forge');
    const run = new LevelRun(ENDLESS, 21, []);
    expect(run.canForge()).toBe(false);
    expect(() => run.forge()).toThrow();
    const moves = allValidMoves(run);
    const pick = createRng(4);
    for (let n = 0; n < 200 && !run.canForge(); n++) while (!run.swap(...moves[pick.int(moves.length)]));
    expect(run.forgeCharge).toBe(FORGE.cost);
    const res = run.forge();
    expect(res.converted).toHaveLength(3);
    expect(res.converted!.map((c) => c.tile.special).sort()).toEqual(['axeCol', 'axeRow', 'keg']);
    expect(run.forgeCharge).toBe(0);
    expect(run.relicsUsed).toBe(0);
    const replay = replayRun(ENDLESS, 21, [], run.log);
    expect(JSON.stringify(replay.board.tiles)).toBe(JSON.stringify(run.board.tiles));
  });

  it('can be disabled per level', () => {
    const run = new LevelRun({ ...ENDLESS, forge: false }, 21, []);
    run.useRelic('dragonfire_blade', {});
    expect(run.forgeCharge).toBe(0);
  });
});

describe('fortress objective', () => {
  it('wins when every wall is broken', () => {
    const level = LEVELS.find((l) => l.objective.type === 'fortress')!;
    const run = new LevelRun(level, 5, placeBurials(level, createRng(5)));
    expect(run.objectives()[0]).toMatchObject({ current: 0, target: level.walls!.length });
    for (let k = 0; k < 3 && run.status === 'playing'; k++) run.useRelic('dragonfire_blade', {});
    expect(run.objectives()[0].current).toBe(level.walls!.length);
    expect(run.status).toBe('won');
  });
});
