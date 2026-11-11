# Relic Clash (ForgeAndFury)

A match-3 game themed around ancient and medieval warriors. You match stone, wood, fire, iron, water and hide, dig up **buried relics**, and wield them in battle. Any relic can be **minted as an NFT on the XRP Ledger Testnet**, traded, and **deposited back** to be used by whoever owns it.

> Prototype. **XRPL Testnet only.** No real money.

- Design brief: [`docs/SPEC.md`](docs/SPEC.md)
- Choices made where the brief was open: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Quick start

```bash
npm install
cp .env.example .env        # optional; defaults work without XRPL
npm run dev                 # server on :8787 + client on :5173
```

Open http://localhost:5173. To play on a phone on the same Wi-Fi, use the "Network" URL that Vite prints.

### Enable XRPL (milestone M4)

```bash
npm run xrpl:setup          # funds a Testnet issuer from the faucet, writes XRPL_ISSUER_SEED to .env
npm run xrpl:smoke          # mint → transfer → deposit → burn on Testnet, prints explorer links
npm run dev
```

**M4 demo** ("mint a Sword, send it to a second wallet, deposit it from that wallet, and use it in a level"):

1. Play **Level 3, The Forge**. Its Sword burial is guaranteed. Or set `DEV_GRANT=true` in `.env` and grant one in the Armory.
2. **Armory → In-game relics → Mint to wallet.** The server creates a Testnet wallet for the player, mints, and transfers. An explorer link appears.
3. **Armory → + New player** creates player B, then switch back to A with the dropdown.
4. On A's on-chain Sword: **Send to… → B → Send.**
5. Switch to **B → Deposit** on the Sword. The game accepts it and burns the NFT, and the Sword is now in B's in-game inventory.
6. Play any level as B, tap the Sword in the relic bar, tap a tile, then **Use**.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API server (tsx watch) + Vite client |
| `npm test` | Vitest: board logic, specials, cascades, relic effects, 100k-roll drop-rate test, run replay, API and XRPL flows against a fake chain |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Builds the client to `dist/`. `npm run start:server` then serves the game and the API on :8787. |
| `npm run xrpl:setup` | Creates and funds the issuer account (Testnet faucet) |
| `npm run xrpl:smoke` | End-to-end Testnet check: mint, transfer, deposit, burn |

## How it fits together

```
shared/   pure TypeScript, no Phaser, no I/O
  board.ts         grid, swap, match detection (lines/L/T), specials, gravity, refill, cascades, shuffle
  relicEffects.ts  all 12 relic effects as pure functions
  game.ts          LevelRun: moves, objectives, stars; deterministic, so the server can replay it
  rarity.ts        drop tables and rolls
  relics.ts        relic catalogue (taxons, rarity, targeting)
  config/tiles.ts  tile types (data-driven)
  levels/*.json    level definitions
server/   Express API, the only place relics are rolled or chain calls are made
  app.ts           sessions, reveal (replays the move log), use, finish, inventory, mint/transfer/deposit
  xrpl.ts          xrpl.js wrapper (NFTokenMint / CreateOffer / AcceptOffer / Burn)
  store.ts         JSON-file DB
client/   Phaser 3 board + DOM UI
  game/BoardScene.ts       rendering, input (drag or tap-tap), animations, the Sword's spinning slash
  game/LevelController.ts  glue: LevelRun ↔ scene ↔ HUD ↔ server
  main.ts                  menu, results, Armory, drop-rate table
```

**Anti-cheat:** the client never decides what a player wins. The server issues a seeded session with burial positions. When a burial is uncovered, the client sends its action log, and the server replays it with the same pure logic before rolling the relic with a CSPRNG. See `docs/DECISIONS.md`.

## Config (`.env`)

| Var | Default | |
|---|---|---|
| `XRPL_NETWORK` | `wss://s.altnet.rippletest.net:51233` | Mainnet endpoints are refused |
| `XRPL_ISSUER_SEED` | – | Written by `xrpl:setup`. **Never commit.** |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Used in the NFT metadata URI |
| `XRPL_TRANSFER_FEE` | `5000` | 5% royalty (units of 1/100,000) |
| `ENABLE_NFT_DEPOSIT` | `true` | Platform flag; set `false` for view-only NFT builds (iOS) |
| `MAX_RELICS_PER_LEVEL` | `3` | |
| `DEV_GRANT` | `false` | Dev-only relic granting. Bypasses anti-cheat. |
