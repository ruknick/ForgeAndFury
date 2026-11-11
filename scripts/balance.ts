/**
 * npm run balance — plays every level N times (default 60) with a greedy bot that uses no relics,
 * and prints win rate, stars, and score percentiles. Use it to tune moves, targets and star thresholds.
 * Rough targets: tutorial ~90%, mid levels 55–70%, boss ~20–30% (players with relics do better).
 */
import { cloneBoard, trySwap } from '../shared/board';
import { LevelRun, placeBurials } from '../shared/game';
import { LEVELS } from '../shared/levels';
import { createRng } from '../shared/rng';

// Greedy bot: tries every swap on a clone (with a throwaway rng) and picks the best by objective-weighted value.
function bestMove(run: LevelRun) {
  const b = run.board;
  const o = run.level.objective;
  const want = new Set(o.type === 'collect' ? (o.targets ?? [{ tile: o.tile!, count: o.count! }]).filter((t) => (run.collected[t.tile] ?? 0) < t.count).map((t) => t.tile) : []);
  let best: any = null, bestV = -1;
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const clone = cloneBoard(b);
    const res = trySwap(clone, { r, c }, { r: r + dr, c: c + dc }, createRng(r * 31 + c));
    if (!res.valid) continue;
    const s0 = res.steps[0];
    let v = s0.score;
    for (const [t, n] of Object.entries(s0.collected)) if (want.has(t)) v += n * 40;
    if (o.type === 'unearth') v += s0.burialHits.length * 200;
    v += s0.created.length * 25;
    if (v > bestV) { bestV = v; best = [{ r, c }, { r: r + dr, c: c + dc }]; }
  }
  return best;
}

for (const level of LEVELS) {
  let wins = 0, stars = 0, movesLeft = 0; const scores: number[] = []; const winScores: number[] = []; const prog: number[] = [];
  const N = Number(process.env.N ?? 60);
  for (let s = 1; s <= N; s++) {
    const run = new LevelRun(level, s * 1009, placeBurials(level, createRng(s)));
    while (run.status === 'playing') { const m = bestMove(run); if (!m || !run.swap(m[0], m[1])) break; }
    scores.push(run.score); prog.push(Math.min(...run.objectives().map((o) => o.current / o.target)));
    if (run.status === 'won') { wins++; stars += run.stars(); movesLeft += run.movesLeft; winScores.push(run.score); }
  }
  console.log(`L${level.id} ${level.name.padEnd(18)} greedy win ${(wins / N * 100).toFixed(0)}%  avg stars ${(stars / Math.max(1, wins)).toFixed(2)}  avg moves left ${(movesLeft / Math.max(1, wins)).toFixed(1)}`);
  const q = (a: number[], p: number) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.floor(p * (x.length - 1))] : 0; };
  console.log(`    all scores p25/p50/p90 ${q(scores, .25)}/${q(scores, .5)}/${q(scores, .9)}  win scores p30/p70/p90 ${q(winScores, .3)}/${q(winScores, .7)}/${q(winScores, .9)}  median objective progress ${(q(prog, .5) * 100).toFixed(0)}%`);
}
