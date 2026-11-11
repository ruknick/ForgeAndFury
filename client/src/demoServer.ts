/**
 * DEMO BUILD ONLY (VITE_DEMO=1): an in-browser stand-in for the game server so a
 * static build can be played anywhere (e.g. on a phone) with no backend.
 *
 * It mirrors the server's routes using the same shared logic, and stores data in
 * this browser only. There is no anti-cheat and no XRPL here; real builds always
 * use server/app.ts.
 */
import { placeBurials, replayRun, type Action, type PlacedBurial } from '../../shared/game';
import { getLevel, LEVELS } from '../../shared/levels';
import { DEFAULT_DROP_TABLE, normalizeTable, rollRelic } from '../../shared/rarity';
import { RARITY_INFO, RELICS, relicDef } from '../../shared/relics';
import { createRng } from '../../shared/rng';
import type { Rarity, RelicInstance } from '../../shared/types';

const KEY = 'relic-clash.demo-db';
const MAX_RELICS = 3;

interface Player { id: string; name: string; createdAt: string; progress: Record<string, { stars: number; bestScore: number }> }
interface Session {
  id: string; playerId: string; levelId: number; seed: number; burials: PlacedBurial[];
  guaranteed: Record<string, { relicId?: string; rarity?: Rarity }>; revealed: Record<string, string>; used: string[]; done: boolean;
}
interface DB {
  players: Record<string, Player>;
  relics: Record<string, RelicInstance>;
  sessions: Record<string, Session>;
  stats: { minted: Record<string, number>; burned: Record<string, number>; found: Record<string, number> };
}

let memory: DB | null = null;
function load(): DB {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (memory = JSON.parse(raw));
  } catch { /* private mode */ }
  return (memory = { players: {}, relics: {}, sessions: {}, stats: { minted: {}, burned: {}, found: {} } });
}
function save() {
  try {
    // Finished sessions aren't needed after the level ends; keep storage small.
    for (const [id, s] of Object.entries(memory!.sessions)) if (s.done) delete memory!.sessions[id];
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch { /* fine: in-memory only */ }
}

const rand = () => {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
};
const id = (p: string) => `${p}_${Math.floor(rand() * 2 ** 48).toString(36)}`;
const now = () => new Date().toISOString();

export class DemoError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const fail = (status: number, msg: string): never => { throw new DemoError(status, msg); };

export function demoHandle(method: string, path: string, body: any): unknown {
  const db = load();
  const pub = (p: Player) => ({ id: p.id, name: p.name, createdAt: p.createdAt, walletAddress: null, progress: p.progress });
  const player = (pid: string) => db.players[pid] ?? fail(404, 'Unknown player');
  const withDef = (r: RelicInstance) => ({ ...r, def: relicDef(r.relicId) });
  const m = (re: RegExp) => path.match(re);
  let g: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/config') {
    return {
      relics: RELICS, rarities: RARITY_INFO, dropTable: DEFAULT_DROP_TABLE,
      levels: LEVELS.map((l) => ({ id: l.id, name: l.name, dropTable: l.dropTableOverride ? normalizeTable(l.dropTableOverride) : DEFAULT_DROP_TABLE })),
      flags: { devGrant: true, enableNftDeposit: false, xrplConfigured: false, maxRelicsPerLevel: MAX_RELICS, demo: true },
      network: { endpoint: '', explorer: 'https://testnet.xrpl.org', issuer: null },
    };
  }
  if (method === 'GET' && path === '/api/players') return Object.values(db.players).map(pub);
  if (method === 'POST' && path === '/api/players') {
    const p: Player = { id: id('pl'), name: String(body?.name ?? '').trim().slice(0, 24) || `Warrior ${Object.keys(db.players).length + 1}`, createdAt: now(), progress: {} };
    db.players[p.id] = p;
    save();
    return pub(p);
  }
  if (method === 'GET' && (g = m(/^\/api\/players\/([^/]+)$/))) return pub(player(g[1]));
  if (method === 'GET' && (g = m(/^\/api\/players\/([^/]+)\/inventory$/))) {
    const p = player(g[1]);
    return { relics: Object.values(db.relics).filter((r) => r.ownerPlayerId === p.id && r.state !== 'consumed').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(withDef) };
  }
  if (method === 'GET' && m(/^\/api\/players\/[^/]+\/wallet$/)) return { configured: false };
  if (method === 'POST' && path === '/api/sessions') {
    const p = player(String(body?.playerId));
    const level = getLevel(Number(body?.levelId)) ?? fail(404, 'Unknown level');
    const seed = Math.floor(rand() * 2 ** 31);
    const burials = placeBurials(level, createRng(Math.floor(rand() * 2 ** 31)));
    const guaranteed: Session['guaranteed'] = {};
    (level.burials.guaranteed ?? []).forEach((gg, k) => burials[k] && (guaranteed[burials[k].id] = gg));
    const s: Session = { id: id('ss'), playerId: p.id, levelId: level.id, seed, burials, guaranteed, revealed: {}, used: [], done: false };
    db.sessions[s.id] = s;
    save();
    return { sessionId: s.id, levelId: level.id, seed, burials, maxRelics: MAX_RELICS };
  }
  if (method === 'POST' && (g = m(/^\/api\/sessions\/([^/]+)\/reveal$/))) {
    const s = db.sessions[g[1]] ?? fail(404, 'Unknown session');
    const bid = String(body?.burialId);
    if (s.revealed[bid]) return { relic: withDef(db.relics[s.revealed[bid]]) };
    const level = getLevel(s.levelId)!;
    const gg = s.guaranteed[bid];
    const def = rollRelic({ table: level.dropTableOverride ? normalizeTable(level.dropTableOverride) : DEFAULT_DROP_TABLE, relicId: gg?.relicId, rarity: gg?.rarity }, rand);
    const inst: RelicInstance = { instanceId: id('rl'), relicId: def.id, ownerPlayerId: s.playerId, state: 'in_game', txHashes: [], foundInLevel: level.id, createdAt: now() };
    db.relics[inst.instanceId] = inst;
    s.revealed[bid] = inst.instanceId;
    db.stats.found[def.id] = (db.stats.found[def.id] ?? 0) + 1;
    save();
    return { relic: withDef(inst) };
  }
  if (method === 'POST' && (g = m(/^\/api\/sessions\/([^/]+)\/use$/))) {
    const s = db.sessions[g[1]] ?? fail(404, 'Unknown session');
    const r = db.relics[String(body?.instanceId)] ?? fail(404, 'Unknown relic');
    if (r.ownerPlayerId !== s.playerId || r.state !== 'in_game') fail(409, `Relic is ${r.state}`);
    if (s.used.length >= MAX_RELICS) fail(409, `Relic limit reached (${MAX_RELICS} per level)`);
    r.state = 'consumed';
    s.used.push(r.instanceId);
    save();
    return { ok: true, relic: withDef(r) };
  }
  if (method === 'POST' && (g = m(/^\/api\/sessions\/([^/]+)\/finish$/))) {
    const s = db.sessions[g[1]] ?? fail(404, 'Unknown session');
    const run = replayRun(getLevel(s.levelId)!, s.seed, s.burials, (body?.log ?? []) as Action[], MAX_RELICS);
    s.done = true;
    const p = player(s.playerId);
    if (run.status === 'won' && s.levelId > 0) {
      const prev = p.progress[s.levelId] ?? { stars: 0, bestScore: 0 };
      p.progress[s.levelId] = { stars: Math.max(prev.stars, run.stars()), bestScore: Math.max(prev.bestScore, run.score) };
    }
    save();
    return { ok: true, status: run.status, score: run.score, stars: run.stars(), progress: p.progress };
  }
  if (method === 'POST' && path === '/api/dev/grant') {
    const p = player(String(body?.playerId));
    const def = relicDef(String(body?.relicId));
    const inst: RelicInstance = { instanceId: id('rl'), relicId: def.id, ownerPlayerId: p.id, state: 'in_game', txHashes: [], createdAt: now() };
    db.relics[inst.instanceId] = inst;
    save();
    return { relic: withDef(inst) };
  }
  if (method === 'GET' && path === '/api/stats') return db.stats;
  return fail(501, 'Not available in the demo build (XRPL needs the real server)');
}
