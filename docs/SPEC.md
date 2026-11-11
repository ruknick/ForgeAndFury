# Game Spec: Warrior Match-3 with Tradable Relics (working title: "Relic Clash")

> **For Claude Code:** This is the design brief for a playable prototype. Read the whole thing before writing code. Build in the milestone order in Section 10. Where something is marked **OPEN QUESTION**, make a sensible default, note it in `DECISIONS.md`, and keep going. Ask Kevin only when a choice would be expensive to undo.

---

## 1. Concept

This is a match-3 puzzle game in the style of Candy Crush, themed around ancient and medieval warriors. Instead of candy, players match primitive resources like stone, wood, fire and iron. Some tiles hide **buried relics**: weapons and war tools that are revealed when the tile above them is cleared. Relics come in rarity tiers. When used, they trigger powerful board effects that help clear hard levels.

Relics don't have to be used right away. Players keep them in an inventory. Players can also **mint a relic as an NFT on the XRP Ledger (XRPL)**, then trade or sell it outside the game. A relic NFT can be **brought back into the game** and used by whoever owns it.

**Core loop:** play level → match tiles → uncover relics → keep or use relics → beat harder levels → (optional) mint, trade, or buy relics.

---

## 2. Prototype goals and non-goals

**Goals**
- A playable match-3 board that feels good: swapping, cascades, gravity, refills, and readable animations
- 3–5 levels with different objectives
- A working hidden-relic system with rarity rolls
- A working inventory, plus at least 4 relic effects used from the inventory during a level
- XRPL integration on **Testnet only**: mint a relic, see it in a wallet, deposit it back, use it

**Non-goals for the prototype**
- No real money, no Mainnet, no in-app purchases
- No final art. Colored shapes and emoji or simple SVG icons are fine.
- No accounts or backend hosting beyond what runs locally
- No App Store or Play Store builds

---

## 3. Tech stack (recommended defaults)

- **Language:** TypeScript
- **Game engine:** Phaser 3 (web, runs on mobile browsers). Plain Canvas or PixiJS is acceptable if it's simpler.
- **Build tool:** Vite
- **Backend (local):** Node + Express (or Fastify), run alongside the client. This is required because of the anti-cheat rule in Section 7.
- **Blockchain:** `xrpl` (xrpl.js) against XRPL **Testnet** (`wss://s.altnet.rippletest.net:51233`)
- **Storage:** SQLite (via better-sqlite3) or a JSON file for the prototype
- **Tests:** Vitest for the board logic and the drop-rate logic

Keep **game logic pure and separate from rendering**. Board state, match detection, cascades, and relic effects should be plain TypeScript functions that can be unit-tested without Phaser.

Suggested structure:
```
/client        Phaser game, UI, scenes
/shared        pure logic: board, matching, relics, rarity tables, types
/server        drop rolls, inventory, XRPL mint/deposit, level data
/docs          this spec, DECISIONS.md
```

---

## 4. The board

### 4.1 Grid
- Default size: 8 columns × 8 rows. Levels can override this and mark some cells as blocked (non-playable).
- Swap two orthogonally adjacent tiles. If the swap makes no match, animate it swapping back.
- After matches clear, tiles fall down (gravity) and new tiles spawn from the top. Repeat until no matches remain (cascades).
- If no valid moves exist, shuffle the board with an animation.
- The starting board must contain no pre-made matches and at least one valid move.

### 4.2 Tile types (6)
| Tile | Color/feel | Notes |
|---|---|---|
| Stone | grey | most common |
| Wood (Tree) | green/brown | |
| Fire | orange/red | |
| Iron (Ore) | steel blue | |
| Water | blue | |
| Hide (Leather/Bone) | tan | |

**OPEN QUESTION:** Kevin may swap or rename tile types later. Keep tile types data-driven in a single config file.

### 4.3 Match rules and special tiles (standard match-3 conventions)
| Match | Result |
|---|---|
| 3 in a line | clear |
| 4 in a line | creates a **Battle Axe** tile (clears its row or column when matched, depending on the match direction) |
| L or T shape (5 tiles) | creates a **Powder Keg** tile (3×3 explosion when matched) |
| 5 in a line | creates a **War Drum** tile (swap it with any tile to clear all tiles of that type) |

Special tiles are temporary board pieces and **are not relics**. They are never minted.

### 4.4 Resource meters
Every cleared tile adds to a per-level meter for its type. This is a light system for the prototype. Display the counts, because level objectives use them (e.g. "Collect 40 Iron"). **Stretch goal:** combined meters (Iron + Fire = "Forge") charge a free board ability.

---

## 5. Hidden relics

### 5.1 Buried tiles
- Some cells have a **buried relic** under the tile. Show these with a subtle crack or glow on the tile.
- Clearing the tile above a buried cell **once** reveals the relic. Some levels can use "deep" burials that need 2 clears (show the crack growing).
- When a relic is revealed, play a short reveal animation with a rarity-colored flash and show the item card.
- Revealed relics go to the player's **inventory**. They are not used automatically.

### 5.2 Where burials come from
- Each level defines how many buried cells it has and where (fixed positions or "random N").
- **Which relic is under each burial is decided by the server** when the player clears it, not by the client (see Section 7).

### 5.3 Rarity tiers and default drop rates
| Tier | Color | Default chance |
|---|---|---|
| Common | white/grey | 60% |
| Rare | blue | 25% |
| Epic | purple | 12% |
| Legendary | gold | 3% |

Drop tables must be config-driven. Levels can override them (e.g. boss levels have a better Legendary chance). Write a test that runs 100,000 rolls and confirms the observed rates are within tolerance.

---

## 6. Relic catalogue (prototype set)

Each relic has an `id`, `name`, `rarity`, `effect`, `targeting`, and `flavorText`. A relic is **single-use** and is consumed when used.

| Relic | Rarity | Targeting | Effect |
|---|---|---|---|
| Sling Stone | Common | tap a tile | destroys 1 tile |
| Torch | Common | tap a tile | burns the tile plus its 4 orthogonal neighbors |
| War Horn | Common | none | +3 moves |
| Spear | Rare | tap a tile, then pick row or column | clears that entire row or column |
| Sword | Rare | tap a tile | **spinning slash**: clears the 3×3 area centered on that tile, with a sweeping arc animation |
| Fire Arrow | Rare | tap a tile | clears both diagonals through that tile |
| War Hammer | Epic | none | shatters every Stone tile on the board |
| Catapult | Epic | none | hurls 3 boulders at 3 random clusters (3×3 each) |
| Shield Wall | Epic | none | the next 3 moves don't consume a move |
| Twin Axes | Epic | tap a tile | clears the row **and** the column through that tile |
| Warlord's Banner | Legendary | pick a tile type | converts every tile of that type into Powder Kegs, then detonates them |
| Dragonfire Blade | Legendary | none | clears the whole board once (cascades follow) |

**Sword detail (Kevin's original example):** the sword visibly swings around in a circle over the target area, clearing each tile as the blade passes. Make this one look good, because it's the hero item for the demo.

### 6.1 Using relics during a level
- An inventory bar at the bottom of the level screen shows the relics the player owns.
- Tap a relic → enter targeting mode (if it needs a target) → confirm → play the effect → cascades resolve normally.
- Using a relic does **not** cost a move unless the relic says it does.
- Limit: **OPEN QUESTION.** The default is a maximum of 3 relics per level, to protect balance.
- Relics that were minted as NFTs and are currently on-chain (outside the game) **cannot** be used until they are deposited back (Section 8).

---

## 7. Anti-cheat rule (important)

Relics can be worth real money once they're tradable, so **the client must never decide what a player wins.**

- The server holds the RNG and the drop tables.
- When a burial is cleared, the client reports it to the server with the level ID, burial ID, and a move log or level session ID. The server validates it, rolls the rarity and relic, writes the result to inventory, and returns it.
- For the prototype, validation can be light (e.g. one reveal per burial per session, with sessions issued by the server), but **the architecture must put the roll on the server** so it can be tightened later.
- Inventory is server-side. The client only displays it.

---

## 8. XRPL integration (Testnet)

### 8.1 Model: "in-game" vs "on-chain"
Every relic is in exactly one of these states:
- **In-game (off-chain):** a row in the server's inventory DB. It can be used in levels. This is free and fast, and most players never leave this state.
- **On-chain (minted):** an XRPL NFT held in the player's own wallet. It can be traded or sold on any XRPL marketplace. It **cannot** be used in levels until it's deposited.

Players move relics between the states:
- **Withdraw / Mint:** in-game → on-chain
- **Deposit:** on-chain → in-game

### 8.2 Accounts
- **Game issuer account:** a Testnet account owned by the game. It mints all relic NFTs. Fund it from the Testnet faucet. Keep the seed in `.env` and never commit it.
- **Player wallet:** for the prototype, the server can generate a Testnet wallet per player and store its seed locally (dev only). **Stretch goal:** connect a real wallet via Xaman (formerly Xumm) instead.

### 8.3 Minting (withdraw)
1. The player taps "Mint to wallet" on an in-game relic.
2. The server marks the inventory row `pending_mint` so it can't be used or minted twice.
3. The issuer submits `NFTokenMint` with:
   - `NFTokenTaxon`: one taxon per relic type (e.g. Sword = 5)
   - `Flags`: `tfTransferable` (so it can be traded). Also consider `tfBurnable` (lets the issuer burn it, which helps with deposits).
   - `TransferFee`: royalty on secondary sales. **OPEN QUESTION:** the default is 5% (`5000`; the field is in units of 1/100,000, max 50,000 = 50%).
   - `URI`: hex-encoded link to the metadata JSON (Section 8.5)
4. The issuer creates a sell offer for 0 XRP with `Destination` set to the player's address (`NFTokenCreateOffer`).
5. The player accepts it (`NFTokenAcceptOffer`). For server-held dev wallets, the server can do this automatically.
6. The inventory row becomes `on_chain` with the `NFTokenID` stored.

### 8.4 Deposit
1. The player picks an NFT in their wallet that the game issuer minted. Reject NFTs from any other issuer, and check the taxon against the catalogue.
2. The player creates a sell offer for 0 XRP with `Destination` set to the game account. The game accepts it.
3. The game then **burns** the NFT (`NFTokenBurn`) and credits an in-game relic of that type to the depositing player.
   - Burning on deposit means each item exists in only one place at a time, so there's no double-spending between game and chain.
4. The inventory row becomes `in_game`, now owned by the depositor. That might be a different player from the original finder; that's the point of trading.

### 8.5 Metadata (served by the game or IPFS)
```json
{
  "name": "Sword",
  "description": "A spinning slash that clears a 3x3 area.",
  "image": "https://.../sword.png",
  "attributes": [
    { "trait_type": "Rarity", "value": "Rare" },
    { "trait_type": "Effect", "value": "3x3 spin clear" },
    { "trait_type": "Game", "value": "Relic Clash" },
    { "trait_type": "Season", "value": "1" }
  ]
}
```

### 8.6 Practical notes
- XRPL accounts need an XRP reserve, and owning NFTs adds owner reserve (NFT pages). Check current reserve values in the XRPL docs rather than hard-coding them. Surface reserve costs in the UI later.
- All XRPL calls go through the server. The client never holds the issuer seed.
- Log every transaction hash to the inventory row for traceability.
- Write an integration test script (`npm run xrpl:smoke`) that mints a test relic, transfers it, deposits it, and burns it on Testnet.

---

## 9. Levels

Each level is a JSON file:
```json
{
  "id": 1,
  "name": "The Quarry",
  "rows": 8, "cols": 8,
  "blocked": [],
  "moves": 25,
  "objective": { "type": "collect", "tile": "stone", "count": 30 },
  "burials": { "mode": "random", "count": 3, "depth": 1 },
  "dropTableOverride": null,
  "stars": [1000, 2500, 4000]
}
```

**Objective types for the prototype:**
- `collect`: clear N of a tile type
- `score`: reach a score
- `unearth`: reveal all buried relics within the move limit
- `fortress`: clear "wall" tiles (blockers that break when matched next to). Stretch goal.

**Prototype level set:**
1. The Quarry: collect Stone (tutorial, with a guaranteed Common relic)
2. The Forest Camp: collect Wood, 3 burials
3. The Forge: collect Iron and Fire, with a guaranteed Sword drop to show off the hero item
4. The Burial Mound: unearth 5 relics, including 1 deep burial
5. Warlord's Keep: a harder score target with better Legendary odds

Show a win/lose screen with stars, relics found, and a "Next level" button.

---

## 10. Build milestones (do these in order)

**M1. Board core (no art, no backend)**
- Pure logic: grid, swap, match detection (lines, L, T), gravity, refill, cascades, no-moves shuffle
- Unit tests for match detection and cascades
- Rendering in Phaser with colored shapes, plus swap and clear animations
- *Done when:* you can play an endless board on desktop and phone browsers.

**M2. Levels and special tiles**
- Level JSON loader, move counter, objectives, win/lose screens
- Battle Axe, Powder Keg, and War Drum special tiles
- *Done when:* levels 1–2 can be played start to finish.

**M3. Relics (local server)**
- Server with sessions, a burial reveal endpoint, rarity rolls, and inventory
- Burial visuals, reveal animation, item card
- Inventory bar and targeting mode, with all relics in Section 6 implemented (the Sword's spinning slash gets polish)
- Drop-rate test (100k rolls)
- *Done when:* relics found in level 2 can be used in level 3.

**M4. XRPL Testnet**
- Issuer setup script, mint (withdraw) flow, deposit and burn flow
- Simple "Armory" screen listing in-game relics and on-chain relics, with Mint and Deposit buttons
- A Testnet explorer link for each minted item
- `xrpl:smoke` test
- *Done when:* Kevin can mint a Sword, send it to a second Testnet wallet, deposit it from that wallet, and use it in a level.

**M5. Polish (if time allows)**
- Sound effects, juicier particles, simple medieval UI frame
- Resource "Forge" meter ability
- Xaman wallet connect

---

## 11. Data model (starting point)

```ts
type TileType = 'stone' | 'wood' | 'fire' | 'iron' | 'water' | 'hide';
type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

interface RelicDef {
  id: string;            // 'sword'
  name: string;
  rarity: Rarity;
  taxon: number;         // XRPL NFTokenTaxon
  targeting: 'none' | 'tile' | 'tile+axis' | 'tileType';
  usesMove: boolean;
  flavorText: string;
}

interface RelicInstance {
  instanceId: string;
  relicId: string;
  ownerPlayerId: string;
  state: 'in_game' | 'pending_mint' | 'on_chain' | 'consumed';
  nftokenId?: string;
  txHashes: string[];
  foundInLevel?: number;
  createdAt: string;
}
```

---

## 12. Things to keep in mind (not for the prototype, but don't design against them)

- **App Store rules:** Apple's guidelines allow minting, selling, and viewing NFTs through in-app purchase, but an NFT's ownership must not unlock features or functionality in the app. A relic bought off-platform and then used in the game would conflict with that on iOS. The likely plan is web and Android first, with an iOS build that treats NFTs as view-only or cosmetic. Keep the deposit feature behind a platform flag (`ENABLE_NFT_DEPOSIT`).
- **Gambling / loot-box law:** random drops that can be sold for real money may be regulated in some countries. Don't add paid random drops (e.g. buying chests) without legal review. Keep drop rates published in-game.
- **Economy:** single-use relics plus burn-on-use keep supply in check. Track total minted and burned per relic type so rarity stays meaningful.
- **Pay-to-win:** consider limits like relics per level, or relic-free leaderboards, so buying Legendaries doesn't trivialize the game.

---

## 13. Open questions for Kevin

1. Final name and art direction (Spartan / Viking / samurai / mixed "ancient warriors"?)
2. Final tile set: are stone, wood, fire, iron, water, and hide right?
3. Should relics ever be reusable (durability, e.g. 3 uses), or always single-use?
4. Royalty percentage on resales
5. Should players need their own XRPL wallet from day one, or can it be optional and set up later? (The recommendation is optional.)
6. Seasons: should older relics stay usable forever, or rotate out?
