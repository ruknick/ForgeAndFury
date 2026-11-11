import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Wallet } from 'xrpl';
import { placeBurials, replayRun, type Action } from '../shared/game';
import { getLevel, LEVELS } from '../shared/levels';
import { DEFAULT_DROP_TABLE, normalizeTable, rollRelic } from '../shared/rarity';
import { RARITY_INFO, RELICS, relicByTaxon, relicDef } from '../shared/relics';
import { createRng } from '../shared/rng';
import type { RelicInstance } from '../shared/types';
import type { Config } from './config';
import { newId, secureRandom, secureSeed } from './rolls';
import type { Player, Session, Store } from './store';
import type { XrplService } from './xrpl';

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}
const fail = (status: number, msg: string, extra?: Record<string, unknown>): never => {
  throw new HttpError(status, msg, extra);
};

export function createApp(cfg: Config, store: Store, xrpl: XrplService) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const db = () => store.db;
  const now = () => new Date().toISOString();

  const player = (id: string): Player => db().players[id] ?? fail(404, 'Unknown player');
  const session = (id: string): Session => db().sessions[id] ?? fail(404, 'Unknown session');
  const withDef = (r: RelicInstance) => ({ ...r, def: relicDef(r.relicId) });
  const touch = (r: RelicInstance) => (r.updatedAt = now());

  /** Serializes chain operations per relic/player so double-clicks can't double-mint. */
  const locks = new Set<string>();
  async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (locks.has(key)) fail(409, 'Another operation is already in progress for this item');
    locks.add(key);
    try {
      return await fn();
    } finally {
      locks.delete(key);
    }
  }

  // ------------------------------------------------------------ config

  app.get('/api/config', (_req, res) => {
    res.json({
      relics: RELICS,
      rarities: RARITY_INFO,
      dropTable: DEFAULT_DROP_TABLE,
      levels: LEVELS.map((l) => ({ id: l.id, name: l.name, dropTable: l.dropTableOverride ? normalizeTable(l.dropTableOverride) : DEFAULT_DROP_TABLE })),
      flags: { devGrant: cfg.devGrant, enableNftDeposit: cfg.enableNftDeposit, xrplConfigured: xrpl.configured, maxRelicsPerLevel: cfg.maxRelicsPerLevel },
      network: { endpoint: cfg.xrplNetwork, explorer: cfg.xrplExplorer, issuer: xrpl.configured ? xrpl.issuer().address : null },
    });
  });

  // ------------------------------------------------------------ players

  const publicPlayer = (p: Player) => ({ id: p.id, name: p.name, createdAt: p.createdAt, walletAddress: p.wallet?.address ?? null, progress: p.progress });

  app.get('/api/players', (_req, res) => {
    res.json(Object.values(db().players).map(publicPlayer));
  });

  app.post('/api/players', (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 24) || `Warrior ${Object.keys(db().players).length + 1}`;
    const p: Player = { id: newId('pl'), name, createdAt: now(), progress: {} };
    db().players[p.id] = p;
    store.save();
    res.json(publicPlayer(p));
  });

  app.get('/api/players/:id', (req, res) => {
    res.json(publicPlayer(player(req.params.id)));
  });

  app.get('/api/players/:id/inventory', (req, res) => {
    const p = player(req.params.id);
    const relics = Object.values(db().relics)
      .filter((r) => r.ownerPlayerId === p.id && r.state !== 'consumed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(withDef);
    res.json({ relics });
  });

  // ------------------------------------------------------------ level sessions (spec §7)

  app.post('/api/sessions', (req, res) => {
    const p = player(String(req.body?.playerId));
    const level = getLevel(Number(req.body?.levelId)) ?? fail(404, 'Unknown level');
    const seed = secureSeed();
    const burials = placeBurials(level, createRng(secureSeed()));
    const guaranteed: Session['guaranteed'] = {};
    (level.burials.guaranteed ?? []).forEach((g, k) => burials[k] && (guaranteed[burials[k].id] = g));
    const s: Session = { id: newId('ss'), playerId: p.id, levelId: level.id, seed, burials, guaranteed, revealed: {}, usedInstances: [], status: 'active', createdAt: now() };
    db().sessions[s.id] = s;
    store.save();
    res.json({ sessionId: s.id, levelId: level.id, seed, burials, maxRelics: cfg.maxRelicsPerLevel });
  });

  /** Replays the client's action log and checks every relic action was paid for in this session. */
  function verifyLog(s: Session, log: unknown) {
    if (!Array.isArray(log) || log.length > 5000) fail(400, 'Bad action log');
    const actions = log as Action[];
    const used = [...s.usedInstances];
    for (const a of actions) {
      if (a.kind !== 'relic') continue;
      const k = used.indexOf(a.instanceId ?? '');
      if (k < 0) fail(409, 'Action log uses a relic that was not spent in this session');
      if (db().relics[used[k]].relicId !== a.relicId) fail(409, 'Action log relic mismatch');
      used.splice(k, 1);
    }
    try {
      return replayRun(getLevel(s.levelId)!, s.seed, s.burials, actions, cfg.maxRelicsPerLevel);
    } catch (e) {
      return fail(409, `Action log rejected: ${(e as Error).message}`);
    }
  }

  app.post('/api/sessions/:id/reveal', (req, res) => {
    const s = session(req.params.id);
    if (s.status !== 'active') fail(409, 'Session is finished');
    const burialId = String(req.body?.burialId);
    const burial = s.burials.find((b) => b.id === burialId) ?? fail(404, 'Unknown burial');
    // Idempotent: a retried request gets the same relic back.
    if (s.revealed[burial.id]) return res.json({ relic: withDef(db().relics[s.revealed[burial.id]]), repeat: true });
    const run = verifyLog(s, req.body?.log);
    if (!run.revealed.includes(burial.id)) fail(409, 'That burial has not been uncovered');

    const level = getLevel(s.levelId)!;
    const table = level.dropTableOverride ? normalizeTable(level.dropTableOverride) : DEFAULT_DROP_TABLE;
    const g = s.guaranteed[burial.id];
    const def = rollRelic({ table, relicId: g?.relicId, rarity: g?.rarity }, secureRandom);
    const inst: RelicInstance = {
      instanceId: newId('rl'), relicId: def.id, ownerPlayerId: s.playerId, state: 'in_game', txHashes: [], foundInLevel: level.id, createdAt: now(),
    };
    db().relics[inst.instanceId] = inst;
    s.revealed[burial.id] = inst.instanceId;
    store.bump('found', def.id);
    store.save();
    res.json({ relic: withDef(inst) });
  });

  app.post('/api/sessions/:id/use', (req, res) => {
    const s = session(req.params.id);
    if (s.status !== 'active') fail(409, 'Session is finished');
    const r = db().relics[String(req.body?.instanceId)] ?? fail(404, 'Unknown relic');
    if (r.ownerPlayerId !== s.playerId) fail(403, 'Not your relic');
    if (r.state === 'on_chain') fail(409, 'This relic is on-chain. Deposit it back into the game first.');
    if (r.state !== 'in_game') fail(409, `Relic is ${r.state}`);
    if (s.usedInstances.length >= cfg.maxRelicsPerLevel) fail(409, `Relic limit reached (${cfg.maxRelicsPerLevel} per level)`);
    r.state = 'consumed';
    touch(r);
    s.usedInstances.push(r.instanceId);
    store.save();
    res.json({ ok: true, relic: withDef(r) });
  });

  app.post('/api/sessions/:id/finish', (req, res) => {
    const s = session(req.params.id);
    if (s.status !== 'active') return res.json({ ok: true, repeat: true });
    const run = verifyLog(s, req.body?.log);
    s.status = 'finished';
    const p = player(s.playerId);
    if (run.status === 'won' && s.levelId > 0) {
      const prev = p.progress[s.levelId] ?? { stars: 0, bestScore: 0 };
      p.progress[s.levelId] = { stars: Math.max(prev.stars, run.stars()), bestScore: Math.max(prev.bestScore, run.score) };
    }
    store.save();
    res.json({ ok: true, status: run.status, score: run.score, stars: run.stars(), progress: p.progress });
  });

  // ------------------------------------------------------------ NFT metadata (spec §8.5)

  app.get('/api/metadata/:file', (req, res) => {
    const id = req.params.file.replace(/\.json$/, '');
    const def = RELICS.find((r) => r.id === id) ?? fail(404, 'Unknown relic');
    res.json({
      name: def.name,
      description: `${def.effectText}. ${def.flavorText}`,
      image: `${cfg.publicBaseUrl}/api/relic-image/${def.id}.svg`,
      attributes: [
        { trait_type: 'Rarity', value: RARITY_INFO[def.rarity].name },
        { trait_type: 'Effect', value: def.effectText },
        { trait_type: 'Game', value: 'Relic Clash' },
        { trait_type: 'Season', value: '1' },
      ],
    });
  });

  app.get('/api/relic-image/:file', (req, res) => {
    const id = req.params.file.replace(/\.svg$/, '');
    const def = RELICS.find((r) => r.id === id) ?? fail(404, 'Unknown relic');
    const color = RARITY_INFO[def.rarity].css;
    res.type('image/svg+xml').send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
        `<rect width="512" height="512" rx="48" fill="#1d1712"/><rect x="16" y="16" width="480" height="480" rx="40" fill="none" stroke="${color}" stroke-width="12"/>` +
        `<text x="256" y="300" font-size="220" text-anchor="middle">${def.glyph}</text>` +
        `<text x="256" y="430" font-size="44" font-family="Georgia,serif" fill="${color}" text-anchor="middle">${def.name.replace(/'/g, '&#39;')}</text></svg>`,
    );
  });

  // ------------------------------------------------------------ XRPL (spec §8)

  const requireXrpl = () => {
    if (!xrpl.configured) fail(503, 'XRPL is not configured on this server. Run `npm run xrpl:setup`.');
  };
  const walletOf = (p: Player) => (p.wallet ? Wallet.fromSeed(p.wallet.seed) : fail(409, 'Player has no wallet yet'));
  async function ensureWallet(p: Player): Promise<Wallet> {
    if (p.wallet) return Wallet.fromSeed(p.wallet.seed);
    const w = await xrpl.fundNewWallet();
    p.wallet = { address: w.address, seed: w.seed! };
    store.save();
    return w;
  }

  app.post('/api/players/:id/wallet', async (req, res) => {
    requireXrpl();
    const p = player(req.params.id);
    await locked(`wallet:${p.id}`, () => ensureWallet(p));
    res.json({ address: p.wallet!.address, explorer: xrpl.explorerAccount(p.wallet!.address) });
  });

  app.get('/api/players/:id/wallet', async (req, res) => {
    const p = player(req.params.id);
    if (!xrpl.configured) return res.json({ configured: false });
    if (!p.wallet) return res.json({ configured: true, address: null });
    const [balance, nfts, reserves] = await Promise.all([xrpl.balance(p.wallet.address), xrpl.listGameNfts(p.wallet.address), xrpl.reserves().catch(() => null)]);
    res.json({
      configured: true,
      address: p.wallet.address,
      explorer: xrpl.explorerAccount(p.wallet.address),
      balance,
      reserves,
      nfts: nfts.map((n) => ({ ...n, def: n.relicId ? relicDef(n.relicId) : null, explorer: xrpl.explorerNft(n.nftokenId) })),
    });
  });

  /** Withdraw / mint: in-game → on-chain (spec §8.3). */
  app.post('/api/relics/:instanceId/mint', async (req, res) => {
    requireXrpl();
    const r = db().relics[req.params.instanceId] ?? fail(404, 'Unknown relic');
    const p = player(String(req.body?.playerId));
    if (r.ownerPlayerId !== p.id) fail(403, 'Not your relic');
    if (r.state !== 'in_game') fail(409, `Relic is ${r.state}`);
    await locked(`relic:${r.instanceId}`, async () => {
      r.state = 'pending_mint';
      touch(r);
      store.save();
      try {
        const wallet = await ensureWallet(p);
        const { nftokenId, hashes } = await xrpl.mintToPlayer(relicDef(r.relicId), wallet);
        r.state = 'on_chain';
        r.nftokenId = nftokenId;
        r.txHashes.push(...hashes);
        store.bump('minted', r.relicId);
      } catch (e) {
        r.state = 'in_game';
        r.txHashes.push(...((e as { hashes?: string[] }).hashes ?? []));
        throw new HttpError(502, `Mint failed: ${(e as Error).message}`);
      } finally {
        touch(r);
        store.save();
      }
    });
    res.json({ relic: withDef(r), explorer: xrpl.explorerNft(r.nftokenId!), txs: r.txHashes.map((h) => xrpl.explorerTx(h)) });
  });

  /** Sends an on-chain relic to another player's wallet (or creates an offer for any address). */
  app.post('/api/players/:id/transfer', async (req, res) => {
    requireXrpl();
    const from = player(req.params.id);
    const nftokenId = String(req.body?.nftokenId);
    const owned = await xrpl.listGameNfts(walletOf(from).address);
    if (!owned.some((n) => n.nftokenId === nftokenId)) fail(404, 'That NFT is not in your wallet');
    await locked(`nft:${nftokenId}`, async () => {
      if (req.body?.toPlayerId) {
        const to = player(String(req.body.toPlayerId));
        const toWallet = await ensureWallet(to);
        const hashes = await xrpl.transfer(walletOf(from), toWallet, nftokenId);
        const row = Object.values(db().relics).find((r) => r.nftokenId === nftokenId);
        row?.txHashes.push(...hashes);
        store.save();
        res.json({ ok: true, hashes, txs: hashes.map((h) => xrpl.explorerTx(h)) });
      } else {
        const dest = String(req.body?.toAddress ?? '');
        if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(dest)) fail(400, 'Provide toPlayerId or a valid toAddress');
        const hashes: string[] = [];
        const offerId = await xrpl.createFreeTransferOffer(walletOf(from), nftokenId, dest, hashes);
        res.json({ ok: true, offerId, hashes, note: 'The recipient must accept this 0 XRP sell offer from their wallet.' });
      }
    });
  });

  /** Deposit: on-chain → in-game, burning the NFT (spec §8.4). */
  app.post('/api/players/:id/deposit', async (req, res) => {
    if (!cfg.enableNftDeposit) fail(403, 'NFT deposits are disabled on this platform');
    requireXrpl();
    const p = player(req.params.id);
    const nftokenId = String(req.body?.nftokenId);
    const wallet = walletOf(p);
    const nft = (await xrpl.listGameNfts(wallet.address)).find((n) => n.nftokenId === nftokenId) ?? fail(404, 'That NFT is not in your wallet or was not minted by the game');
    const def = relicByTaxon(nft.taxon) ?? fail(400, `Unknown relic taxon ${nft.taxon}`);
    const row = await locked(`nft:${nftokenId}`, async () => {
      const hashes = await xrpl.depositAndBurn(wallet, nftokenId);
      let r = Object.values(db().relics).find((x) => x.nftokenId === nftokenId);
      if (!r) {
        r = { instanceId: newId('rl'), relicId: def.id, ownerPlayerId: p.id, state: 'in_game', nftokenId, txHashes: [], createdAt: now() };
        db().relics[r.instanceId] = r;
      }
      r.ownerPlayerId = p.id; // may differ from the original finder: that's trading
      r.state = 'in_game';
      r.txHashes.push(...hashes);
      touch(r);
      store.bump('burned', def.id);
      store.save();
      return r;
    });
    res.json({ relic: withDef(row), txs: row.txHashes.map((h) => xrpl.explorerTx(h)) });
  });

  /** DEV ONLY (DEV_GRANT=true): put a relic straight into a player's inventory, for testing effects. */
  if (cfg.devGrant) {
    app.post('/api/dev/grant', (req, res) => {
      const p = player(String(req.body?.playerId));
      const def = relicDef(String(req.body?.relicId));
      const inst: RelicInstance = { instanceId: newId('rl'), relicId: def.id, ownerPlayerId: p.id, state: 'in_game', txHashes: [], createdAt: now() };
      db().relics[inst.instanceId] = inst;
      store.save();
      res.json({ relic: withDef(inst) });
    });
  }

  app.get('/api/stats', (_req, res) => {
    res.json(db().stats);
  });

  // ------------------------------------------------------------ static client (after `npm run build`)

  const dist = path.resolve('dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error(err);
    res.status(500).json({ error: (err as Error).message ?? 'Server error' });
  });

  return app;
}
