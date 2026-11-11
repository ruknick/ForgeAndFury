import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';
import { LevelRun } from '../../shared/game';
import { getLevel } from '../../shared/levels';
import { relicByTaxon, relicDef } from '../../shared/relics';
import { createApp } from '../app';
import { config } from '../config';
import { Store } from '../store';
import type { ChainNft, XrplService } from '../xrpl';

/** In-memory stand-in for the XRPL so API flows can be tested offline. */
class FakeChain {
  issuerWallet = Wallet.generate();
  owners = new Map<string, { owner: string; taxon: number }>();
  n = 0;
  configured = true;
  issuer() { return this.issuerWallet; }
  explorerTx(h: string) { return `tx/${h}`; }
  explorerNft(h: string) { return `nft/${h}`; }
  explorerAccount(h: string) { return `acct/${h}`; }
  async fundNewWallet() { return Wallet.generate(); }
  async balance() { return 100; }
  async reserves() { return { baseXrp: 1, ownerXrp: 0.2 }; }
  async listGameNfts(address: string): Promise<ChainNft[]> {
    return [...this.owners].filter(([, v]) => v.owner === address)
      .map(([id, v]) => ({ nftokenId: id, taxon: v.taxon, issuer: this.issuerWallet.address, relicId: relicByTaxon(v.taxon)?.id }));
  }
  async mintToPlayer(def: { taxon: number }, w: Wallet) {
    const id = `NFT${++this.n}`;
    this.owners.set(id, { owner: w.address, taxon: def.taxon });
    return { nftokenId: id, hashes: [`m${this.n}`, `o${this.n}`, `a${this.n}`] };
  }
  async transfer(_from: Wallet, to: Wallet, id: string) { this.owners.get(id)!.owner = to.address; return ['t1', 't2']; }
  async depositAndBurn(_from: Wallet, id: string) { this.owners.delete(id); return ['d1', 'd2', 'burn']; }
}

let base = '';
let close: () => void;
const chain = new FakeChain();

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const app = createApp({ ...config, enableNftDeposit: true, maxRelicsPerLevel: 3 }, new Store(null), chain as unknown as XrplService);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

/** Plays the session locally with relics until the given burial is uncovered. */
function clearBurial(run: LevelRun, burialId: string) {
  const b = run.burials.find((x) => x.id === burialId)!;
  for (let k = 0; k < b.depth && !run.revealed.includes(burialId); k++) run.useRelic('sling_stone', { pos: b.pos });
}

describe('relic flow', () => {
  it('reveals only uncovered burials, rolls on the server, and lets the relic be used in another level', async () => {
    const { body: p } = await api('POST', '/api/players', { name: 'Kevin' });
    const { body: s } = await api('POST', '/api/sessions', { playerId: p.id, levelId: 3 });
    expect(s.burials.length).toBe(2);
    expect(s.burials[0]).not.toHaveProperty('relicId');

    // Claiming a burial without uncovering it is rejected.
    const early = await api('POST', `/api/sessions/${s.sessionId}/reveal`, { burialId: s.burials[0].id, log: [] });
    expect(early.status).toBe(409);

    // A log that uses relics not paid for in the session is rejected.
    const run = new LevelRun(getLevel(3)!, s.seed, s.burials);
    clearBurial(run, s.burials[0].id);
    const forged = await api('POST', `/api/sessions/${s.sessionId}/reveal`, { burialId: s.burials[0].id, log: run.log });
    expect(forged.status).toBe(409);

    // Uncover it with real swaps instead, preferring moves near the burial.
    const honest = new LevelRun(getLevel(3)!, s.seed, s.burials);
    const target = s.burials[0];
    for (let guard = 0; guard < 400 && !honest.revealed.includes(target.id) && honest.status === 'playing'; guard++) {
      let moved = false;
      for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]]) {
        const a = { r: target.pos.r + dr, c: target.pos.c + dc };
        for (const z of [{ r: a.r, c: a.c + 1 }, { r: a.r + 1, c: a.c }, { r: a.r - 1, c: a.c }, { r: a.r, c: a.c - 1 }]) {
          if (honest.swap(a, z)) { moved = true; break; }
        }
        if (moved) break;
      }
      if (!moved) {
        outer: for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) if (honest.swap({ r, c }, { r, c: c + 1 })) break outer;
      }
    }
    expect(honest.revealed).toContain(target.id);
    {
      const ok = await api('POST', `/api/sessions/${s.sessionId}/reveal`, { burialId: target.id, log: honest.log });
      expect(ok.status).toBe(200);
      expect(ok.body.relic.relicId).toBe('sword'); // level 3 guarantees the Sword
      const again = await api('POST', `/api/sessions/${s.sessionId}/reveal`, { burialId: target.id, log: honest.log });
      expect(again.body.relic.instanceId).toBe(ok.body.relic.instanceId);
    }
  });

  it('paid relic use + replay → reveal; then use the relic in the next level; limit enforced', async () => {
    const { body: p } = await api('POST', '/api/players', {});
    // Spending a relic you don't own fails.
    const { body: s1 } = await api('POST', '/api/sessions', { playerId: p.id, levelId: 1 });
    const bad = await api('POST', `/api/sessions/${s1.sessionId}/use`, { instanceId: 'nope' });
    expect(bad.status).toBe(404);

    // A second player gets relics by depositing NFTs (covers the deposit path too).
    const { body: rich } = await api('POST', '/api/players', {});
    const { body: rs } = await api('POST', '/api/sessions', { playerId: rich.id, levelId: 4 });
    await api('POST', `/api/players/${rich.id}/wallet`);
    const { body: wallet } = await api('GET', `/api/players/${rich.id}/wallet`);
    const w = Wallet.generate();
    for (let i = 0; i < 4; i++) {
      const { nftokenId } = await chain.mintToPlayer(relicDef('dragonfire_blade'), w);
      chain.owners.get(nftokenId)!.owner = wallet.address;
    }
    for (const n of (await api('GET', `/api/players/${rich.id}/wallet`)).body.nfts) {
      const dep = await api('POST', `/api/players/${rich.id}/deposit`, { nftokenId: n.nftokenId });
      expect(dep.status).toBe(200);
      expect(dep.body.relic.state).toBe('in_game');
    }
    const inv = (await api('GET', `/api/players/${rich.id}/inventory`)).body.relics;
    expect(inv).toHaveLength(4);

    const run = new LevelRun(getLevel(4)!, rs.seed, rs.burials);
    // Two board clears uncover everything (one may be enough if cascades hit the deep burial twice).
    let spent = 0;
    while (run.status === 'playing') {
      const use = await api('POST', `/api/sessions/${rs.sessionId}/use`, { instanceId: inv[spent].instanceId });
      expect(use.status).toBe(200);
      run.useRelic('dragonfire_blade', {}, inv[spent++].instanceId);
    }
    expect(run.revealed).toHaveLength(5);
    for (const id of run.revealed) {
      const r = await api('POST', `/api/sessions/${rs.sessionId}/reveal`, { burialId: id, log: run.log });
      expect(r.status).toBe(200);
    }
    // Using the same instance twice fails, and the per-level limit (3) holds.
    expect((await api('POST', `/api/sessions/${rs.sessionId}/use`, { instanceId: inv[0].instanceId })).status).toBe(409);
    while (spent < 3) expect((await api('POST', `/api/sessions/${rs.sessionId}/use`, { instanceId: inv[spent++].instanceId })).status).toBe(200);
    expect((await api('POST', `/api/sessions/${rs.sessionId}/use`, { instanceId: inv[3].instanceId })).status).toBe(409);

    const fin = await api('POST', `/api/sessions/${rs.sessionId}/finish`, { log: run.log });
    expect(fin.body.status).toBe('won');
    expect(fin.body.progress['4'].stars).toBeGreaterThanOrEqual(1);

    // Found relics are in inventory and usable in a different level's session.
    const after = (await api('GET', `/api/players/${rich.id}/inventory`)).body.relics.filter((r: any) => r.foundInLevel === 4);
    expect(after).toHaveLength(5);
    const { body: next } = await api('POST', '/api/sessions', { playerId: rich.id, levelId: 5 });
    expect((await api('POST', `/api/sessions/${next.sessionId}/use`, { instanceId: after[0].instanceId })).status).toBe(200);
  });
});

describe('XRPL flows (fake chain)', () => {
  it('mint → transfer → deposit by another player → usable by them; on-chain relics cannot be used', async () => {
    const { body: a } = await api('POST', '/api/players', { name: 'A' });
    const { body: b } = await api('POST', '/api/players', { name: 'B' });
    // give A a relic by depositing a fresh sword NFT
    await api('POST', `/api/players/${a.id}/wallet`);
    const addrA = (await api('GET', `/api/players/${a.id}/wallet`)).body.address;
    const { nftokenId: seedNft } = await chain.mintToPlayer(relicDef('sword'), Wallet.generate());
    chain.owners.get(seedNft)!.owner = addrA;
    const dep = await api('POST', `/api/players/${a.id}/deposit`, { nftokenId: seedNft });
    const relic = dep.body.relic;

    const mint = await api('POST', `/api/relics/${relic.instanceId}/mint`, { playerId: a.id });
    expect(mint.status).toBe(200);
    expect(mint.body.relic.state).toBe('on_chain');
    const nft = mint.body.relic.nftokenId;

    const { body: sess } = await api('POST', '/api/sessions', { playerId: a.id, levelId: 1 });
    expect((await api('POST', `/api/sessions/${sess.sessionId}/use`, { instanceId: relic.instanceId })).status).toBe(409);
    expect((await api('POST', `/api/relics/${relic.instanceId}/mint`, { playerId: a.id })).status).toBe(409);

    const tr = await api('POST', `/api/players/${a.id}/transfer`, { nftokenId: nft, toPlayerId: b.id });
    expect(tr.status).toBe(200);
    expect((await api('POST', `/api/players/${a.id}/deposit`, { nftokenId: nft })).status).toBe(404);

    const depB = await api('POST', `/api/players/${b.id}/deposit`, { nftokenId: nft });
    expect(depB.status).toBe(200);
    expect(depB.body.relic.ownerPlayerId).toBe(b.id);
    expect(depB.body.relic.instanceId).toBe(relic.instanceId);
    expect(depB.body.relic.txHashes.length).toBeGreaterThan(5);

    const { body: sb } = await api('POST', '/api/sessions', { playerId: b.id, levelId: 3 });
    expect((await api('POST', `/api/sessions/${sb.sessionId}/use`, { instanceId: relic.instanceId })).status).toBe(200);

    const stats = (await api('GET', '/api/stats')).body;
    expect(stats.minted.sword).toBe(1);
    expect(stats.burned.sword).toBe(2);
  });

  it('serves NFT metadata in the spec format', async () => {
    const { body } = await api('GET', '/api/metadata/sword.json');
    expect(body.name).toBe('Sword');
    expect(body.attributes).toContainEqual({ trait_type: 'Rarity', value: 'Rare' });
    expect(body.attributes).toContainEqual({ trait_type: 'Game', value: 'Relic Clash' });
  });
});
