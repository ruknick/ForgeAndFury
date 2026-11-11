# Decisions log

Defaults chosen while building the prototype, mostly where the spec marked an **OPEN QUESTION** or left room. Each one is cheap to change unless it says otherwise.

## Stack and structure

| Decision | Why / how to change |
|---|---|
| **Phaser 3.90** (latest v3) for the board only. Menus, HUD, relic bar, Armory and modals are plain DOM. | DOM is faster to build, accessible, and better for lists and links on phones. The board, animations and input are Phaser. |
| **One npm package** with `client/`, `shared/`, `server/` folders, not workspaces. | Simpler for a prototype. `shared/` is imported by relative path from both sides. |
| **JSON file store** (`server/data/db.json`, atomic write) instead of SQLite. | The spec allows it, and it avoids a native `better-sqlite3` build. `server/store.ts` is the only file to swap. |
| **Express 5** on port 8787. Vite proxies `/api`. `npm run build` puts the client in `dist/`, and the server then serves it too. | |
| Tile glyphs and relic icons are **emoji**. Tile textures are rendered at runtime into Phaser textures. | No art pipeline needed. Swap `glyph` and `color` in the configs. |

## Board rules (§4)

- **Tile types are data-driven** in `shared/config/tiles.ts` (id, name, color, glyph, spawn weight). Stone has weight 1.3 because it's "most common"; the others have 1.0. Levels can restrict the set with `tileTypes`.
- **Battle Axe direction:** a *horizontal* 4-match makes an axe that clears its **row**; a vertical one clears its **column**. Shown as horizontal or vertical stripes plus a 🪓 badge.
- **Special priority** when shapes overlap: War Drum (5 in a line) > Powder Keg (L/T) > Battle Axe (4).
- **Where specials appear:** on the swapped cell if it's part of the match. In cascades they appear on a cell that just moved, otherwise the keg intersection or the middle of the line.
- **War Drum:** swapping it with a tile clears every tile of that type, and a special swapped in also fires. Drum + Drum clears the whole board. A drum caught in another explosion clears a random type still on the board.
- **Special + special swap** (axe/keg): valid even without a match, and both fire.
- **Blocked cells:** tiles fall *through* them, so a column never gets cut off, and blocked cells break line matches.
- **Refills are random**, so lucky cascades can happen, which is standard for the genre. The starting board and post-shuffle boards never contain matches and always have a valid move.
- **Scoring:** 10 per tile × cascade depth, +30 per special created, and +60 per unused move on a win. Stars come from the level's `stars` thresholds, and a win always earns at least 1 star.
- **Hint:** after 7 s idle, a valid move pulses.

## Relics (§5, §6)

- **Burials are a property of the cell**, not the tile. Clearing whatever tile sits on the cell counts as a hit. A deep burial shows ⛏⛏ pips and a growing crack.
- **Random burial placement** avoids the top row, so refills don't instantly uncover relics.
- **Relics per level: 3** (`MAX_RELICS_PER_LEVEL`, enforced by both the client run and the server). The free-move relics (War Horn, Shield Wall) count toward it.
- **Relic use never costs a move** (`usesMove: false` for the whole prototype set; the engine supports `true`).
- **When a relic is consumed:** the server marks it `consumed` when it confirms the use, *before* the effect plays. If the tab crashes mid-animation, the relic is gone. This is simplest and can't be exploited for duplication.
- **Relics are single-use** (Q3), and "used" means burned. There is no durability system yet.
- **Catapult** targets come from the run's seeded RNG, so the server's replay matches the client exactly. Centers stay off the outer ring when possible.
- **Warlord's Banner** turns every tile of the chosen type into a Powder Keg (shown), then detonates them all, so chain reactions follow.
- Glyph choices: the Torch is 🪔 (there's no torch emoji), the Spear is 🔱, and the Catapult is ☄️.

## Anti-cheat (§7): stronger than the minimum

- The server issues each level **session** with a random `seed` and the burial positions. The **contents** of burials are never sent to the client.
- The whole level is a deterministic, pure `LevelRun` (`shared/game.ts`): the same seed plus the same action log gives the same board.
- On `/reveal` (and `/finish`), the client sends its **action log**. The server **replays** it and only rolls a relic if that burial really was uncovered. Every relic action in the log must match a relic that was paid for via `/use` in this session.
- Rolls use `crypto.randomInt` on the server and are independent of the board seed, so knowing the seed doesn't let a player predict drops.
- Reveals are idempotent: retrying returns the same relic.
- **Known limit:** the client knows the seed, so a bot could search for strong move sequences. That's still "legit" play. If it matters later, stream refill randomness from the server.

## XRPL (§8)

- **Testnet only.** The server refuses to start with a Mainnet-looking endpoint.
- **Taxon = one per relic type**, 1–12 (the Sword is 5, as in the spec example). Never reuse a taxon.
- **Flags:** `tfTransferable | tfBurnable`. **TransferFee:** 5000 (5%), configurable via `XRPL_TRANSFER_FEE` (Q4).
- **Mint:** the row goes `pending_mint` → issuer `NFTokenMint` → 0-XRP sell offer with `Destination` = player → the player (server-held dev wallet) accepts → `on_chain`. If the offer or accept step fails, the issuer **burns** the fresh NFT and the row reverts to `in_game`, so supply stays honest. Every tx hash is logged on the row.
- **Deposit:** reject anything not minted by our issuer or with an unknown taxon → player creates a 0-XRP offer to the game → game accepts → game **burns**. If an inventory row with that `NFTokenID` exists, it's reused (history kept, owner changed to the depositor). Otherwise a new row is created.
- **Wallets are optional** (Q5). A player's Testnet wallet is created and faucet-funded on first mint, or from the Armory. Seeds are stored server-side **for dev only**.
- **Trading for the demo:** the Armory can *send* an on-chain relic to another local player (offer + accept, both server-held), or create a 0-XRP offer to any external address (the API supports this; the UI uses players).
- **Player switcher** in the Armory lets one device act as several players, which the M4 "second wallet" demo needs.
- **Reserves** are read from `server_info` and shown in the Armory, not hard-coded.
- **Metadata URI** is `PUBLIC_BASE_URL/api/metadata/<relicId>.json`, with an SVG image at `/api/relic-image/<relicId>.svg`. For marketplaces to render it, `PUBLIC_BASE_URL` must be publicly reachable (or move it to IPFS later).
- **Supply stats** (found / minted / burned per relic type) are tracked server-side and shown in the Armory (§12 Economy).
- `ENABLE_NFT_DEPOSIT=false` hides and blocks deposits (the iOS plan in §12).

- **Verified on Testnet:** `npm run xrpl:smoke` passes (mint → transfer → deposit → burn), and the full M4 demo was run through the real UI: grant a Sword → Mint → send to player B → B deposits → B uses it in level 2. Minting takes about 25 s on Testnet (faucet funding plus 3 validated transactions).
- **Proxy support:** when `HTTPS_PROXY` is set, the XRPL WebSocket and the faucet requests go through it (`server/proxy.ts`). Without it, nothing changes.
- **Alternative Testnet node:** if `s.altnet.rippletest.net` is unreachable from your network, set `XRPL_NETWORK=wss://testnet.xrpl-labs.com` (XRPL Labs, port 443). Same ledger, same faucet.

## Levels (§9)

| # | Setup | Greedy-bot win rate (no relics) |
|---|---|---|
| 1 The Quarry | 25 moves, collect 26 Stone, 1 fixed burial guaranteed **Common** | ~92% |
| 2 The Forest Camp | 27 moves, collect 26 Wood, 3 random burials | ~56% |
| 3 The Forge | 28 moves, 25 Iron + 25 Fire, corners blocked, 2 burials, one guaranteed **Sword** | ~61% |
| 4 The Burial Mound | 9×8, 22 moves, unearth all 5 (1 deep), 2 blocked cells | ~63% |
| 5 Warlord's Keep | 9×9, 26 moves, score 3,200, 3 deep burials, boss drop table (10% Legendary) | ~20% |
| 0 Endless | the M1 sandbox: unlimited moves, no burials | – |

Targets and star thresholds were tuned with `npm run balance`. That script plays each level 60+ times with a greedy bot and reports win rate and score percentiles. Stars sit at roughly the 30th, 70th and 90th percentile of winning scores. The original guesses (e.g. 9,000 points for level 5) turned out to be unwinnable.

All levels can be selected from the start (no lock), so it's easy to demo. Progress (best stars and score) is stored per player.

## Dev conveniences

- `DEV_GRANT=true` enables `POST /api/dev/grant` and a "Grant relic" panel in the Armory. **It bypasses anti-cheat; never enable it on a shared server.**
- In dev builds, the current level controller is exposed as `window.__ctrl` for automated play-testing.

## Not done yet

- M5 polish: sound, the Forge meter ability, and Xaman wallet connect are not implemented. The `fortress` objective (stretch goal) is not implemented.
