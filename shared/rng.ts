/** Small deterministic RNG (mulberry32). Shared so the server can replay a client's moves exactly. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Internal state, so a run can be checkpointed. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    state: () => a,
  };
}

export function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, r: number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let x = r * total;
  for (const item of items) {
    x -= weight(item);
    if (x < 0) return item;
  }
  return items[items.length - 1];
}
